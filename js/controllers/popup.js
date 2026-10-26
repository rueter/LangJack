/**
 * Popup Controller: Handles quick text entry, automatic tab text grabbing,
 * in-popup dictionary lookups, and launches the full workbench tab.
 */

// Cross-browser WebExtension compatibility alias: maps browser to chrome if needed
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser;
}

document.addEventListener('DOMContentLoaded', () => {
  const popupInput = document.getElementById('popupInput');
  const lookupDictBtn = document.getElementById('lookupDictBtn');
  const captureSelectionBtn = document.getElementById('captureSelectionBtn');
  const openWorkbenchBtn = document.getElementById('openWorkbenchBtn');
  const popupDictResult = document.getElementById('popupDictResult');
  const resultLemma = document.getElementById('resultLemma');
  const resultUpos = document.getElementById('resultUpos');
  const resultSrcLang = document.getElementById('resultSrcLang');
  const resultMorphology = document.getElementById('resultMorphology');
  const resultGlosses = document.getElementById('resultGlosses');

  const activeMenuBadge = document.getElementById('activeMenuBadge');
  const setModeDictBtn = document.getElementById('setModeDictBtn');
  const setModeAnnotatorBtn = document.getElementById('setModeAnnotatorBtn');
  const setModeBothBtn = document.getElementById('setModeBothBtn');
  const defaultLangSelect = document.getElementById('defaultLangSelect');
  const defaultTgtLangSelect = document.getElementById('defaultTgtLangSelect');

  // Load and display current context menu mode
  async function loadMenuMode() {
    let mode = 'dict';
    try {
      if (chrome?.storage?.local) {
        const data = await chrome.storage.local.get('ui_context_menu_mode');
        if (data.ui_context_menu_mode) mode = data.ui_context_menu_mode;
      }
    } catch (_) {}
    updateModeUI(mode);
  }

  // Load and display current default reading language
  async function loadDefaultLang() {
    let lang = 'sms';
    try {
      if (chrome?.storage?.local) {
        const data = await chrome.storage.local.get('ui_src_lang');
        if (data.ui_src_lang) lang = data.ui_src_lang;
      }
    } catch (_) {}

    // Synchronize available source languages from FST dictionary & custom TSV entries
    try {
      chrome?.runtime?.sendMessage?.({ action: 'get_source_languages' }, (response) => {
        if (response?.langs && defaultLangSelect) {
          const currentVal = defaultLangSelect.value || lang;
          for (const [code, name] of Object.entries(response.langs)) {
            const exists = Array.from(defaultLangSelect.options).some(o => o.value.toLowerCase() === code.toLowerCase());
            if (!exists) {
              const opt = document.createElement('option');
              opt.value = code;
              opt.textContent = `${name} (${code})`;
              defaultLangSelect.appendChild(opt);
            }
          }
          defaultLangSelect.value = currentVal;
        }
      });
    } catch (_) {}

    if (defaultLangSelect) {
      defaultLangSelect.value = lang;
    }
  }

  // Load and display current default translation target language
  async function loadDefaultTgtLang() {
    let tgtLang = 'all';
    try {
      if (chrome?.storage?.local) {
        const data = await chrome.storage.local.get('ui_tgt_lang');
        if (data.ui_tgt_lang) tgtLang = data.ui_tgt_lang;
      }
    } catch (_) {}
    if (defaultTgtLangSelect) {
      const exists = Array.from(defaultTgtLangSelect.options).some(o => o.value === tgtLang);
      if (!exists && tgtLang) {
        const opt = document.createElement('option');
        opt.value = tgtLang;
        opt.textContent = `${tgtLang.toUpperCase()} (${tgtLang})`;
        defaultTgtLangSelect.appendChild(opt);
      }
      defaultTgtLangSelect.value = tgtLang;
    }
  }

  function updateModeUI(mode) {
    setModeDictBtn?.classList.toggle('active', mode === 'dict');
    setModeAnnotatorBtn?.classList.toggle('active', mode === 'annotator');
    setModeBothBtn?.classList.toggle('active', mode === 'both');

    if (activeMenuBadge) {
      if (mode === 'dict') {
        activeMenuBadge.textContent = '📖 Dictionary [hfst_dict_lookup]';
      } else if (mode === 'annotator') {
        activeMenuBadge.textContent = '📝 Analyze Gloss with HFST';
      } else {
        activeMenuBadge.textContent = '🌐 Both (Dictionary & Glosser)';
      }
    }
  }

  async function setMenuMode(mode) {
    updateModeUI(mode);
    try {
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ ui_context_menu_mode: mode });
      }
      chrome?.runtime?.sendMessage?.({ action: 'set_context_menu_mode', mode });
    } catch (_) {}
  }

  setModeDictBtn?.addEventListener('click', () => setMenuMode('dict'));
  setModeAnnotatorBtn?.addEventListener('click', () => setMenuMode('annotator'));
  setModeBothBtn?.addEventListener('click', () => setMenuMode('both'));

  defaultLangSelect?.addEventListener('change', async (e) => {
    const newLang = e.target.value;
    try {
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ ui_src_lang: newLang });
      }
      chrome?.runtime?.sendMessage?.({ action: 'save_setting', key: 'ui_src_lang', value: newLang });
      chrome?.runtime?.sendMessage?.({ action: 'set_page_language', lang: newLang });
    } catch (_) {}

    // Re-run lookup if there is text in input
    const text = popupInput?.value.trim();
    if (text) {
      performLookup(text);
    }
  });

  defaultTgtLangSelect?.addEventListener('change', async (e) => {
    let newTgt = e.target.value;
    if (newTgt === 'custom') {
      const code = prompt('Enter 3-letter ISO language code for default translation target (e.g. fin, rus, deu, eng):', 'eng');
      if (!code || !code.trim()) {
        await loadDefaultTgtLang();
        return;
      }
      newTgt = code.trim().toLowerCase();
      const exists = Array.from(defaultTgtLangSelect.options).some(o => o.value === newTgt);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = newTgt;
        opt.textContent = `${newTgt.toUpperCase()} (${newTgt})`;
        defaultTgtLangSelect.insertBefore(opt, defaultTgtLangSelect.querySelector('option[value="custom"]'));
      }
      defaultTgtLangSelect.value = newTgt;
    }

    try {
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ ui_tgt_lang: newTgt });
      }
      chrome?.runtime?.sendMessage?.({ action: 'save_setting', key: 'ui_tgt_lang', value: newTgt });
    } catch (_) {}

    // Re-run lookup if there is text in input
    const text = popupInput?.value.trim();
    if (text) {
      performLookup(text);
    }
  });

  // Automatically grab active selection from tab or storage on popup open
  async function autoGrabSelection() {
    let text = '';
    try {
      if (chrome?.tabs?.query && chrome?.scripting?.executeScript) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.getSelection().toString()
          });
          if (results && results[0]?.result) {
            text = results[0].result.trim();
          }
        }
      }
    } catch (_) {}

    if (!text && chrome?.storage?.local) {
      try {
        const res = await chrome.storage.local.get(['last_selected_text']);
        if (res?.last_selected_text) {
          text = res.last_selected_text.trim();
        }
      } catch (_) {}
    }

    if (text && popupInput) {
      popupInput.value = text;
      performLookup(text);
    }
  }

  // Quick In-Popup Dictionary Lookup
  async function performLookup(text) {
    const cleanWord = (text || popupInput?.value || '').trim();
    if (!cleanWord) return;

    let srcLang = defaultLangSelect?.value || 'sms';
    let tgtLang = defaultTgtLangSelect?.value || 'all';
    try {
      if (chrome?.storage?.local) {
        const data = await chrome.storage.local.get(['ui_src_lang', 'ui_tgt_lang']);
        if (data.ui_src_lang) srcLang = data.ui_src_lang;
        if (data.ui_tgt_lang) tgtLang = data.ui_tgt_lang;
      }
    } catch (_) {}

    if (lookupDictBtn) {
      lookupDictBtn.textContent = '⏳ Looking up...';
      lookupDictBtn.disabled = true;
    }

    try {
      chrome.runtime?.sendMessage?.({
        action: 'lookup_word',
        text: cleanWord,
        srcLang: srcLang,
        tgtLang: tgtLang
      }, (response) => {
        if (lookupDictBtn) {
          lookupDictBtn.textContent = '📖 Look Up in Dictionary';
          lookupDictBtn.disabled = false;
        }

        if (response?.data) {
          renderPopupResult(response.data);
        } else {
          renderPopupNoResult(cleanWord, srcLang);
        }
      });
    } catch (err) {
      if (lookupDictBtn) {
        lookupDictBtn.textContent = '📖 Look Up in Dictionary';
        lookupDictBtn.disabled = false;
      }
      console.warn('Lookup failed:', err);
    }
  }

  // Safe DOM rendering of lookup results in popup
  function renderPopupResult(data) {
    if (!popupDictResult) return;
    popupDictResult.style.display = 'block';

    const lemma = data.lemma || data.text || '';
    const srcLang = data.srcLang || defaultLangSelect?.value || 'sms';
    const primaryReading = data.readings?.[0] || {};
    const upos = primaryReading.upos || 'X';
    const morphTag = primaryReading.reading || '';

    if (resultLemma) resultLemma.textContent = lemma;
    if (resultUpos) resultUpos.textContent = upos;
    if (resultSrcLang) resultSrcLang.textContent = srcLang.toUpperCase();

    if (resultMorphology) {
      if (morphTag) {
        resultMorphology.textContent = morphTag;
        resultMorphology.style.display = 'block';
      } else {
        resultMorphology.style.display = 'none';
      }
    }

    if (resultGlosses) {
      const glosses = data.glosses || [];
      const defaultTgt = (defaultTgtLangSelect?.value || data.tgtLang || 'all').toLowerCase();
      const items = [];

      if (glosses.length > 0) {
        // Prioritize default translation target language so it appears first, while keeping other languages accessible
        const sortedGlosses = [...glosses];
        if (defaultTgt && defaultTgt !== 'all') {
          sortedGlosses.sort((a, b) => {
            const aIsTgt = (a.lang || '').toLowerCase() === defaultTgt ? 1 : 0;
            const bIsTgt = (b.lang || '').toLowerCase() === defaultTgt ? 1 : 0;
            return bIsTgt - aIsTgt;
          });
        }

        sortedGlosses.slice(0, 15).forEach(g => {
          const itemEl = document.createElement('div');
          itemEl.className = 'result-gloss-item';
          const isTgt = defaultTgt !== 'all' && (g.lang || '').toLowerCase() === defaultTgt;

          const langBadge = document.createElement('span');
          langBadge.className = `result-gloss-lang ${isTgt ? 'result-gloss-lang-default' : ''}`;
          langBadge.textContent = `${(g.lang || 'all').toLowerCase()}${isTgt ? ' ★' : ''}`;
          if (isTgt) {
            langBadge.title = 'Default translation target language';
          }

          const glossText = document.createElement('span');
          glossText.textContent = g.gloss || '';
          if (isTgt) {
            glossText.style.fontWeight = '600';
            glossText.style.color = '#0284c7';
          }

          itemEl.append(langBadge, glossText);
          items.push(itemEl);
        });
      } else {
        const noGloss = document.createElement('div');
        noGloss.style.color = 'var(--text-muted)';
        noGloss.style.fontSize = '12px';
        noGloss.textContent = `No dictionary glosses found for "${lemma}".`;
        items.push(noGloss);
      }

      resultGlosses.replaceChildren(...items);
    }
  }

  function renderPopupNoResult(word, lang) {
    if (!popupDictResult) return;
    popupDictResult.style.display = 'block';
    if (resultLemma) resultLemma.textContent = word;
    if (resultUpos) resultUpos.textContent = 'OOV';
    if (resultSrcLang) resultSrcLang.textContent = lang.toUpperCase();
    if (resultMorphology) resultMorphology.style.display = 'none';

    if (resultGlosses) {
      const msg = document.createElement('div');
      msg.style.color = 'var(--text-muted)';
      msg.style.fontSize = '12px';
      msg.textContent = `No entry found in ${lang} dictionary.`;
      resultGlosses.replaceChildren(msg);
    }
  }

  // Lookup button click
  lookupDictBtn?.addEventListener('click', () => {
    performLookup(popupInput?.value);
  });

  // Enter key in input triggers lookup
  popupInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      performLookup(popupInput.value);
    }
  });

  // Open Full Workbench
  openWorkbenchBtn?.addEventListener('click', async () => {
    const text = popupInput ? popupInput.value.trim() : '';
    let srcLang = defaultLangSelect?.value || 'sms';
    let tgtLang = defaultTgtLangSelect?.value || 'all';
    try {
      if (chrome?.storage?.local) {
        const data = await chrome.storage.local.get(['ui_src_lang', 'ui_tgt_lang']);
        if (data.ui_src_lang) srcLang = data.ui_src_lang;
        if (data.ui_tgt_lang) tgtLang = data.ui_tgt_lang;
      }
    } catch (_) {}

    const targetUrl = text 
      ? `index.html?text=${encodeURIComponent(text)}&lang=${srcLang}&tgt=${tgtLang}` 
      : (tgtLang && tgtLang !== 'all' ? `index.html?tgt=${tgtLang}` : 'index.html');

    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank');
    }
  });

  // Manual grab selection from active tab
  captureSelectionBtn?.addEventListener('click', async () => {
    if (!chrome?.tabs?.query) {
      popupInput.value = 'Demo text from webpage.';
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection().toString()
        });

        if (results && results[0]?.result) {
          const grabbed = results[0].result.trim();
          popupInput.value = grabbed;
          performLookup(grabbed);
        } else {
          alert('No text selected on current webpage.');
        }
      }
    } catch (err) {
      console.warn('Could not grab selection:', err);
      alert('Could not access current tab selection. Make sure page has text selected.');
    }
  });

  loadMenuMode();
  loadDefaultLang();
  loadDefaultTgtLang();
  autoGrabSelection();
});
