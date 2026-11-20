/**
 * Language choices in ISO order, with pins.
 *
 * Every language selector of LangJack (the workbench, the toolbar popup and the floating card on a web page) lists its
 * languages alphabetically by ISO code. A 📌 button next to a selector pins the language that is selected: pinned
 * languages are listed first (also alphabetically) under "📌 Pinned", all others follow under "All languages".
 * "all" (🌐 All Languages) stays at the very top and "custom" (Custom ISO...) at the very bottom.
 *
 * Two pin lists are kept, because the languages one reads are not those one translates into:
 *   'src'  the language of the text (analyser) selectors
 *   'tgt'  the translation (gloss) language selectors
 * They are kept in chrome.storage.local when it exists (so the workbench, the popup and the floater share them),
 * otherwise in localStorage.
 *
 * A classic script with no imports, so that the content script, the extension pages and the module app can all load
 * it: it sets globalThis.LangPins.
 */
(function (root) {
  const KEY = (kind) => `pinned_langs_${kind}`;
  const KINDS = ['src', 'tgt'];
  const SPECIAL = new Set(['all', 'custom', '']);
  const cache = { src: [], tgt: [] };
  const refreshers = { src: new Set(), tgt: new Set() };

  const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

  const clean = (list) => {
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
      const code = String(c || '').trim().toLowerCase();
      if (code && !SPECIAL.has(code) && !out.includes(code)) out.push(code);
    }
    return out;
  };

  const compareCodes = (a, b) => {
    const x = String(a).toLowerCase();
    const y = String(b).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  };

  /**
   * Orders language codes: pinned first, then the rest, each alphabetical. "all" leads, "custom" ends.
   * @param {string[]} codes
   * @param {string[]} [pinned]
   * @returns {{first: string[], pinned: string[], rest: string[], last: string[]}}
   */
  function order(codes, pinned = []) {
    const pins = new Set(clean(pinned));
    const list = Array.from(new Set(codes));
    const lower = (c) => String(c).toLowerCase();
    return {
      first: list.filter(c => lower(c) === 'all'),
      pinned: list.filter(c => pins.has(lower(c))).sort(compareCodes),
      rest: list.filter(c => !pins.has(lower(c)) && lower(c) !== 'all' && lower(c) !== 'custom').sort(compareCodes),
      last: list.filter(c => lower(c) === 'custom')
    };
  }

  function notify(kind) {
    for (const fn of Array.from(refreshers[kind])) {
      try { fn(); } catch (_) { refreshers[kind].delete(fn); }
    }
  }

  async function load(kind) {
    let value = null;
    try {
      if (hasChrome()) {
        value = await new Promise(resolve => chrome.storage.local.get([KEY(kind)], (res) => resolve(res ? res[KEY(kind)] : null)));
      } else if (typeof localStorage !== 'undefined') {
        value = JSON.parse(localStorage.getItem(KEY(kind)) || 'null');
      }
    } catch (_) { /* storage unavailable: no pins */ }
    cache[kind] = clean(value);
    return cache[kind].slice();
  }

  async function set(kind, list) {
    cache[kind] = clean(list);
    try {
      if (hasChrome()) {
        await new Promise(resolve => chrome.storage.local.set({ [KEY(kind)]: cache[kind] }, resolve));
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KEY(kind), JSON.stringify(cache[kind]));
      }
    } catch (_) { /* kept for this page only */ }
    notify(kind);
    return cache[kind].slice();
  }

  async function toggle(kind, code) {
    const c = String(code || '').trim().toLowerCase();
    if (!c || SPECIAL.has(c)) return get(kind);
    const now = cache[kind];
    return set(kind, now.includes(c) ? now.filter(x => x !== c) : [...now, c]);
  }

  const get = (kind) => cache[kind].slice();

  // Pins changed in another part of the extension (popup, workbench, another tab): follow them
  if (hasChrome() && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const kind of KINDS) {
        if (changes[KEY(kind)]) {
          cache[kind] = clean(changes[KEY(kind)].newValue);
          notify(kind);
        }
      }
    });
  }

  /** Puts the options of a <select> in ISO order with the pinned ones in their own group on top. The value is kept. */
  function regroup(select, kind) {
    const doc = select.ownerDocument;
    const options = Array.from(select.options);
    const chosen = select.selectedOptions && select.selectedOptions[0];
    const byCode = new Map();
    for (const o of options) if (!byCode.has(o.value)) byCode.set(o.value, o);
    const { first, pinned, rest, last } = order(Array.from(byCode.keys()), cache[kind]);
    const extra = options.filter(o => byCode.get(o.value) !== o); // duplicates of a value stay next to their twin

    while (select.firstChild) select.removeChild(select.firstChild);
    const put = (parent, code) => {
      parent.appendChild(byCode.get(code));
      for (const d of extra) if (d.value === code) parent.appendChild(d);
    };
    first.forEach(c => put(select, c));
    if (pinned.length) {
      const g = doc.createElement('optgroup');
      g.label = '📌 Pinned';
      pinned.forEach(c => put(g, c));
      select.appendChild(g);
      const h = doc.createElement('optgroup');
      h.label = 'All languages (ISO order)';
      rest.forEach(c => put(h, c));
      select.appendChild(h);
    } else {
      rest.forEach(c => put(select, c));
    }
    last.forEach(c => put(select, c));
    if (chosen) chosen.selected = true;
  }

  /**
   * Orders a selector and puts a 📌 button after it. Options added later (a language typed in as "Custom ISO...",
   * one from a dictionary) are placed in order as they appear. Returns a function that undoes it.
   * @param {HTMLSelectElement} select
   * @param {'src'|'tgt'} kind
   * @param {{wrap?: boolean}} [opts]  wrap: put the selector and the button in one row (for selectors that fill the width)
   */
  function attach(select, kind, opts = {}) {
    if (!select || select.__langPins) return () => {};
    const doc = select.ownerDocument;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-pin-btn';
    btn.textContent = '📌';
    if (opts.wrap) {
      const row = doc.createElement('div');
      row.className = 'lang-pin-row';
      select.replaceWith(row);
      row.append(select, btn);
    } else {
      select.insertAdjacentElement('afterend', btn);
    }

    const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => refresh()) : null;
    const watch = () => observer && observer.observe(select, { childList: true, subtree: true });

    function buttonState() {
      const code = String(select.value || '').toLowerCase();
      const special = SPECIAL.has(code);
      const on = !special && cache[kind].includes(code);
      btn.disabled = special;
      btn.classList.toggle('pinned', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = special ? 'Choose a language to pin it'
        : on ? `Unpin ${code}: it goes back among the others`
          : `Pin ${code}: keeps it at the top of the list`;
    }
    function refresh() {
      if (observer) observer.disconnect();
      regroup(select, kind);
      buttonState();
      watch();
    }
    const onPinsChanged = () => {
      if (!select.isConnected && select.__langPinsSeen) { dispose(); return; }
      if (select.isConnected) select.__langPinsSeen = true;
      refresh();
    };
    const onChange = () => buttonState();
    const onClick = (e) => { e.preventDefault(); e.stopPropagation(); toggle(kind, select.value); };
    function dispose() {
      if (observer) observer.disconnect();
      refreshers[kind].delete(onPinsChanged);
      select.removeEventListener('change', onChange);
      btn.removeEventListener('click', onClick);
      btn.remove();
      delete select.__langPins;
    }

    select.__langPins = { kind, refresh, dispose };
    select.addEventListener('change', onChange);
    btn.addEventListener('click', onClick);
    refreshers[kind].add(onPinsChanged);
    refresh();
    load(kind).then(() => { if (select.__langPins) refresh(); });
    return dispose;
  }

  root.LangPins = { KINDS, order, compareCodes, load, get, set, toggle, regroup, attach, clean };
})(typeof globalThis !== 'undefined' ? globalThis : this);
