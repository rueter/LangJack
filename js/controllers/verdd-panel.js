/**
 * Ve'rdd Workbench panel: send entries to Ve'rdd, browse and edit what is there, and
 * manage the connection. All data logic lives in services/verdd-api-service.js; this file
 * only draws the panel and wires events.
 */
import {
  VerddApi, signInToVerdd, describeAccess, VERDD_POS_FALLBACK, POS_UNDETERMINED, describeApiError, ensureOriginPermission, loadVerddConfig,
  normalizeBaseUrl, saveVerddConfig, newRow, draftsFromSentences, blockingReasons, homoState,
  nextHomoId, checkRow, sendRows, rowToPairPayload, validateRow, describeCounts, describeMerge,
  describeSplit, isUndetermined, tidyHeadword, mergeVerdict, findTwins, describeById, findEditCollision, exampleWarnings,
  parseInitials, describeInitials, bulkPlan, scanCapitalisedNouns, scanCapitalisedByPos, runBulkMerge, runBulkConvert,
  TRANSLATION_TYPES, TRANSLATION_TYPE, DESCRIPTION_TYPE
} from '../services/verdd-api-service.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const LOOKUP_FIELDS = new Set(['lemma', 'srcLang', 'pos', 'translation', 'tgtLang', 'tgtPos']);
const HOMO_FIELDS = new Set(['srcHomoId', 'tgtHomoId']);
const RELATION_TYPES = {
  ...TRANSLATION_TYPES, 1: 'Etymology', 2: 'Compound', 3: 'Has derivative', 4: 'Has variant', 5: 'Phraseology',
  6: 'Synonym', 7: 'Antonym', 8: 'Hyponymy', 9: 'Hyperonymy', 10: 'Holonymy', 11: 'Meronymy', 12: 'Co-hyponym',
  14: 'Is variant of', 99: 'Other'
};
// Relations that exist as a pair of rows (A -> B and B -> A); Ve'rdd keeps the pair together.
const MIRROR_TYPE = { 4: 14, 14: 4, 6: 6, 7: 7, 8: 9, 9: 8, 12: 12 };
const PAGE_SIZE = 25;
const CAPITALISED_NOUN = 'capitalised-noun'; // merge-candidates mode: nouns (N) whose headword begins with a capital
/** The entry a merge group is about: the capitalised noun, or the undetermined-POS entry. */
const groupEntry = (group) => group.entry || group.undetermined;

export class VerddPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.root           container the panel draws into
   * @param {Object} options.store               storageService (getSetting/setSetting)
   * @param {Function} options.getWorkspace      () => {sentences, translations, srcLang, targetLang}
   * @param {Function} options.showToast         (message, type) => void
   * @param {Function} options.confirmAction     (message) => boolean
   * @param {Function} [options.onStatus]        (text, state) => void, for the header badge
   * @param {Function} [options.onRowSent]       (row) => void, after a row that came from the custom lexicon was stored in Ve'rdd
   */
  constructor({ root, store, getWorkspace, showToast, confirmAction, onStatus = () => {}, onRowSent = () => {} }) {
    this.root = root;
    this.store = store;
    this.getWorkspace = getWorkspace;
    this.showToast = showToast;
    this.confirmAction = confirmAction;
    this.onStatus = onStatus;
    this.onRowSent = onRowSent;

    this.api = null;
    this.config = { baseUrl: '', token: '' };
    this.languages = [];
    this.posList = VERDD_POS_FALLBACK;
    this.rows = [];
    this.tab = 'send';
    this.merge = {
      mode: 'undetermined', language: '', groups: [], total: 0, loaded: false, previews: {}, open: null,
      initials: '', sourcePos: 'N', targetPos: 'Prop', selected: new Set(), busy: false, scanNote: ''
    };
    this.browse = { filters: { language: '', text: '', pos: '', contains: true }, results: [], total: 0, searched: false, detail: null };
  }

  async init() {
    this.config = await loadVerddConfig(this.store);
    this.api = new VerddApi(this.config);
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('change', (event) => this.onChange(event));
    this.root.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.target.dataset.form === 'merge-find') this.loadMergeCandidates(false);
      else if (event.target.dataset.form === 'sign-in') this.signIn();
      else this.search(false);
    });
    this.render();
    if (this.api.configured) this.refreshVocabulary().catch(() => {});
    else this.onStatus('Not connected', 'idle');
  }

  // ------------------------------------------------------------------------------------
  // Shell and tabs
  // ------------------------------------------------------------------------------------

  render() {
    const tabs = [['send', 'Send'], ['browse', 'Browse & edit'], ['merge', 'Merge'], ['connection', 'Connection']];
    this.root.innerHTML = `
      <div class="export-tabs vw-tabs">
        ${tabs.map(([id, label]) => `<div class="export-tab ${this.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</div>`).join('')}
      </div>
      <datalist id="vwLangs">${this.languages.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</datalist>
      <datalist id="vwPos">${this.posList.map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist>
      <div class="vw-view" data-view="send" ${this.tab === 'send' ? '' : 'hidden'}></div>
      <div class="vw-view" data-view="browse" ${this.tab === 'browse' ? '' : 'hidden'}></div>
      <div class="vw-view" data-view="merge" ${this.tab === 'merge' ? '' : 'hidden'}></div>
      <div class="vw-view" data-view="connection" ${this.tab === 'connection' ? '' : 'hidden'}></div>`;
    this.renderSend();
    this.renderBrowse();
    this.renderMerge();
    this.renderConnection();
  }

  view(name) {
    return this.root.querySelector(`[data-view="${name}"]`);
  }

  setTab(tab) {
    this.tab = tab;
    this.root.querySelectorAll('.vw-tabs .export-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    this.root.querySelectorAll('.vw-view').forEach(el => { el.hidden = el.dataset.view !== tab; });
  }

  refreshDatalists() {
    this.root.querySelector('#vwLangs').innerHTML = this.languages.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
    this.root.querySelector('#vwPos').innerHTML = this.posList.map(p => `<option value="${esc(p)}"></option>`).join('');
  }

  async guard(work) {
    try {
      return await work();
    } catch (error) {
      this.showToast(describeApiError(error), 'error');
      return undefined;
    }
  }

  requireApi() {
    if (this.api?.configured) return true;
    this.setTab('connection');
    this.showToast("Set the Ve'rdd address and API token first.", 'error');
    return false;
  }

  absoluteUrl(webUrl) {
    try { return new URL(webUrl, this.config.baseUrl + '/').href; } catch { return '#'; }
  }

  // ------------------------------------------------------------------------------------
  // Connection
  // ------------------------------------------------------------------------------------

  renderConnection() {
    const signedIn = Boolean(this.config.token);
    this.view('connection').innerHTML = `
      <div class="vw-form">
        <label>Ve'rdd address
          <input type="url" id="vwBaseUrl" placeholder="https://www.example.org/verdd" value="${esc(this.config.baseUrl)}" autocomplete="off">
        </label>
        <p class="vw-hint">The address is the Ve'rdd root, without <code>/api/v1</code>. The account must be a Ve'rdd staff user. Your sign-in is kept in this browser only and is sent to that address alone.</p>
        <form data-form="sign-in" class="vw-form">
          <h4>Sign in with your Ve'rdd account</h4>
          <label>Username or e-mail address
            <input type="text" id="vwUser" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(this.signedInAs || '')}">
          </label>
          <label>Password
            <input type="password" id="vwPassword" autocomplete="current-password">
          </label>
          <div class="vw-actions">
            <button class="btn btn-primary" type="submit">Sign in</button>
            ${signedIn ? '<button class="btn btn-secondary" type="button" data-action="sign-out">Sign out on this device</button>' : ''}
          </div>
          <p class="vw-hint">The password is checked by Ve'rdd and is never stored here; Ve'rdd answers with a token for your account, which is what is kept.</p>
        </form>
        <details ${signedIn && !this.signedInAs ? 'open' : ''}>
          <summary>Use an API token instead</summary>
          <label>API token
            <input type="password" id="vwToken" placeholder="From the Ve'rdd administrator" value="${esc(this.config.token)}" autocomplete="off">
          </label>
          <div class="vw-actions">
            <button class="btn btn-secondary" data-action="save-connection">Save &amp; test token</button>
          </div>
        </details>
        <div id="vwConnStatus" class="vw-hint" role="status"></div>
      </div>`;
  }

  /** The password sign-in: Ve'rdd checks it and hands back the account's token, which is what gets stored. */
  async signIn() {
    const baseUrl = normalizeBaseUrl(this.root.querySelector('#vwBaseUrl').value);
    const username = this.root.querySelector('#vwUser').value.trim();
    const passwordInput = this.root.querySelector('#vwPassword');
    const status = this.root.querySelector('#vwConnStatus');
    if (!baseUrl || !username || !passwordInput.value) {
      status.textContent = "Enter the address, your username (or e-mail address) and your password.";
      return;
    }
    // Must happen straight from the click or Enter key, before any other await.
    if (!(await ensureOriginPermission(baseUrl))) {
      status.textContent = 'LangJack needs permission to contact that address. Press Sign in again and allow it.';
      return;
    }
    status.textContent = 'Signing in…';
    try {
      const result = await signInToVerdd({ baseUrl, username, password: passwordInput.value });
      passwordInput.value = '';
      await saveVerddConfig(this.store, { baseUrl, token: result.token });
      this.config = { baseUrl, token: result.token };
      this.api = new VerddApi(this.config);
      this.signedInAs = result.username;
      const me = await this.refreshVocabulary();
      this.renderConnection();
      this.root.querySelector('#vwConnStatus').textContent = `Signed in to ${baseUrl} as ${me.username}. You can work on: ${describeAccess(me.access)}.`;
      this.showToast("Signed in to Ve'rdd.", 'success');
    } catch (error) {
      passwordInput.value = '';
      this.onStatus('Sign-in failed', 'error');
      status.textContent = describeApiError(error);
    }
  }

  /** Forget the token on this device. The account's token on the server is untouched (an administrator can delete it there). */
  async signOut() {
    await saveVerddConfig(this.store, { baseUrl: this.config.baseUrl, token: '' });
    this.config = { baseUrl: this.config.baseUrl, token: '' };
    this.api = new VerddApi(this.config);
    this.signedInAs = '';
    this.languages = [];
    this.refreshDatalists();
    this.renderConnection();
    this.onStatus('Not connected', 'idle');
    this.root.querySelector('#vwConnStatus').textContent = 'Signed out on this device.';
  }

  async saveConnection() {
    const baseUrl = normalizeBaseUrl(this.root.querySelector('#vwBaseUrl').value);
    const token = this.root.querySelector('#vwToken').value.trim();
    const status = this.root.querySelector('#vwConnStatus');
    if (!baseUrl || !token) {
      status.textContent = 'Enter both the address and the token.';
      return;
    }

    // Must happen straight from the click, before any other await.
    const granted = await ensureOriginPermission(baseUrl);
    if (!granted) {
      status.textContent = 'LangJack needs permission to contact that address. Press the button again and allow it.';
      return;
    }

    await saveVerddConfig(this.store, { baseUrl, token });
    this.config = { baseUrl, token };
    this.api = new VerddApi(this.config);
    status.textContent = 'Testing…';
    try {
      const me = await this.refreshVocabulary();
      status.textContent = `Connected to ${baseUrl} as ${me.username}. You can work on: ${describeAccess(me.access)}. ${this.languages.length} languages, ${this.posList.length} parts of speech.`;
      this.showToast("Connected to Ve'rdd.", 'success');
    } catch (error) {
      this.onStatus('Connection failed', 'error');
      status.textContent = describeApiError(error);
    }
  }

  async refreshVocabulary() {
    const [me, languages, pos] = await Promise.all([this.api.me(), this.api.languages(), this.api.pos().catch(() => [])]);
    this.languages = languages;
    if (pos.length) this.posList = [...new Set([...pos, ...VERDD_POS_FALLBACK])].sort();
    this.refreshDatalists();
    this.signedInAs = me.username;
    this.onStatus(`Connected: ${me.username}${me.access?.restricted ? ` (${describeAccess(me.access)})` : ''}`, 'ok');
    return me;
  }

  // ------------------------------------------------------------------------------------
  // Send tab
  // ------------------------------------------------------------------------------------

  renderSend() {
    this.view('send').innerHTML = `
      <p class="vw-hint">Every entry needs a <strong>part of speech</strong>. Add a <strong>homonym</strong> number only to tell apart entries with the same headword, language and POS; use <em>Check in Ve'rdd</em> to see what already exists.</p>
      <div class="vw-actions">
        <button class="btn btn-secondary btn-sm" data-action="add-from-analysis">➕ Add words from analysis</button>
        <button class="btn btn-secondary btn-sm" data-action="add-blank">➕ Add blank entry</button>
        <button class="btn btn-secondary btn-sm" data-action="check-all">🔎 Check in Ve'rdd</button>
        <button class="btn btn-primary btn-sm" data-action="send-all">📤 Send to Ve'rdd</button>
        <button class="btn btn-secondary btn-sm" data-action="clear-sent">Clear sent</button>
        <span class="vw-count" id="vwRowCount"></span>
      </div>
      <div id="vwCards" class="vw-cards"></div>`;
    this.renderCards();
  }

  renderCards() {
    const holder = this.view('send').querySelector('#vwCards');
    holder.innerHTML = this.rows.length
      ? this.rows.map((row, index) => this.cardHtml(row, index)).join('')
      : '<div class="vw-empty">No entries yet. Analyze some text and use “Add words from analysis”, or add a blank entry.</div>';
    this.updateCount();
  }

  updateCount() {
    const el = this.view('send').querySelector('#vwRowCount');
    if (!el) return;
    const sent = this.rows.filter(r => r.status === 'sent').length;
    el.textContent = this.rows.length ? `${this.rows.length} entries, ${sent} sent` : '';
  }

  knownLanguageIds() {
    return this.languages.length ? this.languages.map(l => l.id) : null;
  }

  /** Options for the relation-type select: a word-for-word translation, or a description in several words. */
  typeOptions(current) {
    const value = Number(current) === DESCRIPTION_TYPE ? DESCRIPTION_TYPE : TRANSLATION_TYPE;
    return Object.entries(TRANSLATION_TYPES)
      .map(([type, label]) => `<option value="${type}" ${Number(type) === value ? 'selected' : ''}>${esc(label)}</option>`)
      .join('');
  }

  cardHtml(row, index) {
    const field = (name, label, extra = '') => `
      <label><span>${label}</span>
        <input data-row="${row.id}" data-field="${name}" value="${esc(row[name])}" ${extra}>
      </label>`;
    return `
      <article class="vw-card" data-card="${row.id}">
        <header class="vw-card-head">
          <span class="vw-num">#${index + 1}</span>
          <span data-slot="badges" data-row="${row.id}">${this.badgesHtml(row)}</span>
          <button class="btn btn-secondary btn-sm vw-remove" data-action="remove-row" data-row="${row.id}" title="Remove this entry">✕</button>
        </header>
        <div class="vw-grid">
          ${field('lemma', 'Headword', 'lang="und"')}
          ${field('srcLang', 'Language', 'list="vwLangs" autocapitalize="off"')}
          ${field('pos', 'Part of speech <span class="vw-req">required</span>', 'list="vwPos" autocapitalize="off"')}
          <label><span>Homonym</span><span data-slot="src-homo" data-row="${row.id}">${this.homoControl(row, 'src')}</span></label>
        </div>
        <div class="vw-grid">
          ${field('translation', 'Translation', 'lang="und"')}
          ${field('tgtLang', 'Translation language', 'list="vwLangs" autocapitalize="off"')}
          ${field('tgtPos', 'Translation POS', `list="vwPos" placeholder="${esc(row.pos || 'same as headword')}" autocapitalize="off"`)}
          <label><span>Translation homonym</span><span data-slot="tgt-homo" data-row="${row.id}">${this.homoControl(row, 'tgt')}</span></label>
          <label><span>Relation type</span>
            <select data-row="${row.id}" data-field="relType" title="Description translation: the headword is explained in several words rather than translated word for word.">${this.typeOptions(row.relType)}</select>
          </label>
        </div>
        <div class="vw-grid vw-grid-wide">
          ${field('exSrc', 'Example sentence')}
          ${field('exTgt', 'Example translation')}
        </div>
        <div data-slot="notes" data-row="${row.id}">${this.notesHtml(row)}</div>
      </article>`;
  }

  homoControl(row, side) {
    const matches = row[`${side}Matches`];
    const name = `${side}HomoId`;
    const value = row[name];
    if (!matches || matches.length === 0) {
      return `<input type="number" min="0" step="1" data-row="${row.id}" data-field="${name}" value="${esc(value ?? '')}" placeholder="auto">`;
    }
    const hint = (m) => (m.translations.length ? ` → ${m.translations.join(', ')}` : '');
    const options = matches.map(m =>
      `<option value="${m.homoId}" ${Number(value) === m.homoId && value !== null && value !== '' ? 'selected' : ''}>homonym ${m.homoId} (#${m.id})${esc(hint(m))}</option>`);
    const fresh = nextHomoId(matches);
    const placeholder = matches.length === 1 ? `Use existing (#${matches[0].id})` : '— choose —';
    return `<select data-row="${row.id}" data-field="${name}">
        <option value="" ${value === null || value === '' || value === undefined ? 'selected' : ''}>${esc(placeholder)}</option>
        ${options.join('')}
        <option value="${fresh}" ${value !== null && value !== '' && Number(value) === fresh ? 'selected' : ''}>New homonym (${fresh})</option>
      </select>`;
  }

  badgesHtml(row) {
    const badges = [];
    if (row.guessed) badges.push('<span class="vw-badge vw-badge-warn" title="The analyzer guessed this reading; check lemma and POS.">guessed</span>');
    if (row.pos === POS_UNDETERMINED) badges.push('<span class="vw-badge vw-badge-warn" title="No part of speech could be determined; it will be stored as UND.">POS undetermined</span>');
    if (row.status === 'sent') badges.push('<span class="vw-badge vw-badge-ok">sent</span>');
    else if (row.status === 'error') badges.push('<span class="vw-badge vw-badge-bad">failed</span>');
    else if (blockingReasons(row, { languages: this.knownLanguageIds() }).length) badges.push('<span class="vw-badge vw-badge-bad">needs attention</span>');
    else if (row.srcMatches) badges.push('<span class="vw-badge vw-badge-ok">ready</span>');
    else badges.push('<span class="vw-badge">not checked</span>');
    return badges.join(' ');
  }

  matchLine(label, matches, homoId) {
    if (!matches || matches.length === 0) return '';
    const state = homoState(matches, homoId);
    const items = matches.map(m => `#${m.id} homonym ${m.homoId}${m.checked ? ' (approved)' : ''}${m.translations.length ? ' → ' + esc(m.translations.join(', ')) : ''}`);
    const verdict = { reuse: 'will be reused', choose: 'choose one above', chosen: 'selected', newHomonym: 'a new homonym will be created' }[state];
    return `<div class="vw-info">${label} exists in Ve'rdd: ${items.join('; ')} — <strong>${verdict}</strong></div>`;
  }

  notesHtml(row) {
    const parts = [];
    const reasons = row.status === 'sent' ? [] : blockingReasons(row, { languages: this.knownLanguageIds() });
    if (reasons.length) parts.push(`<ul class="vw-problems">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`);
    const advice = row.status === 'sent' ? [] : exampleWarnings(row);
    if (advice.length) parts.push(`<ul class="vw-warnings">${advice.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`);
    parts.push(this.matchLine('Headword', row.srcMatches, row.srcHomoId));
    if (row.translation) parts.push(this.matchLine('Translation', row.tgtMatches, row.tgtHomoId));
    if (row.message) {
      const link = row.webUrl ? ` <a href="${esc(this.absoluteUrl(row.webUrl))}" target="_blank" rel="noopener">Open in Ve'rdd</a>` : '';
      parts.push(`<div class="${row.status === 'error' ? 'vw-problems' : 'vw-ok'}">${esc(row.message)}${link}</div>`);
    }
    return parts.join('');
  }

  refreshCard(row) {
    ['src-homo', 'tgt-homo', 'notes', 'badges'].forEach(slot => {
      const el = this.root.querySelector(`[data-slot="${slot}"][data-row="${row.id}"]`);
      if (!el) return;
      if (slot === 'src-homo') el.innerHTML = this.homoControl(row, 'src');
      else if (slot === 'tgt-homo') el.innerHTML = this.homoControl(row, 'tgt');
      else if (slot === 'notes') el.innerHTML = this.notesHtml(row);
      else el.innerHTML = this.badgesHtml(row);
    });
  }

  addFromAnalysis() {
    const workspace = this.getWorkspace();
    const drafts = draftsFromSentences(workspace.sentences, workspace.translations, workspace.srcLang, workspace.targetLang, this.posList);
    const key = (r) => [r.lemma, r.pos, r.tgtLang, r.translation, r.exSrc].join('\u0001');
    const have = new Set(this.rows.map(key));
    const fresh = drafts.filter(r => !have.has(key(r)));
    if (!drafts.length) return this.showToast('Analyze some text first; there are no words to add.', 'info');
    this.rows.push(...fresh);
    this.renderCards();
    const undetermined = fresh.filter(r => r.pos === POS_UNDETERMINED).length;
    this.showToast(`Added ${fresh.length} entr${fresh.length === 1 ? 'y' : 'ies'}${undetermined ? `; ${undetermined} with undetermined POS (UND)` : ''}.`, 'success');
  }

  /**
   * Take rows built from entries of the custom lexicon into the Send tab and show them. A row that is already there for the
   * same entry (and not yet sent) is replaced, so pressing the button twice does not duplicate anything.
   * @returns {number} how many rows were added
   */
  addCustomRows(rows) {
    const entryIds = new Set(rows.map(r => r.entryId));
    this.rows = this.rows.filter(r => !(r.entryId && entryIds.has(r.entryId) && r.status !== 'sent'));
    this.rows.push(...rows);
    this.setTab('send');
    this.renderCards();
    return rows.length;
  }

  /** Tell the owner of the custom lexicon which of its entries have reached Ve'rdd. */
  announceSent(rows) {
    rows.filter(r => r.entryId && r.status === 'sent').forEach(row => {
      try { this.onRowSent(row); } catch (error) { console.warn("Could not record the Ve'rdd result:", error); }
    });
  }

  addBlank() {
    const workspace = this.getWorkspace();
    this.rows.push(newRow({ srcLang: workspace.srcLang || '', tgtLang: workspace.targetLang && workspace.targetLang !== 'all' ? workspace.targetLang : '' }));
    this.renderCards();
  }

  async checkRows(rows) {
    for (const row of rows) {
      if (validateRow(row).some(p => ['lemma', 'srcLang', 'pos'].includes(p.field))) continue;
      await checkRow(this.api, row);
      this.refreshCard(row);
    }
  }

  async checkAll() {
    if (!this.requireApi()) return;
    await this.guard(async () => {
      await this.checkRows(this.rows.filter(r => r.status !== 'sent'));
      this.showToast("Checked against Ve'rdd.", 'success');
    });
  }

  async sendAll() {
    if (!this.requireApi()) return;
    await this.guard(async () => {
      const pending = this.rows.filter(r => r.status !== 'sent');
      if (!pending.length) return this.showToast('Nothing to send.', 'info');

      await this.checkRows(pending.filter(r => !r.srcMatches));
      const options = { languages: this.knownLanguageIds() };
      const ready = pending.filter(r => blockingReasons(r, options).length === 0);
      const outcome = ready.length ? await sendRows(this.api, ready) : { sent: 0, failed: 0 };
      this.announceSent(ready);
      pending.forEach(row => this.refreshCard(row));
      this.updateCount();

      const held = pending.length - ready.length;
      const kind = outcome.failed || held ? 'error' : 'success';
      this.showToast(`Sent ${outcome.sent}${outcome.failed ? `, ${outcome.failed} failed` : ''}${held ? `, ${held} need attention` : ''}.`, kind);
    });
  }

  // ------------------------------------------------------------------------------------
  // Browse & edit tab
  // ------------------------------------------------------------------------------------

  renderBrowse() {
    const f = this.browse.filters;
    this.view('browse').innerHTML = `
      <form class="vw-search">
        <label>Language <input data-filter="language" list="vwLangs" value="${esc(f.language)}" autocapitalize="off"></label>
        <label>Word <input data-filter="text" value="${esc(f.text)}" lang="und"></label>
        <label>POS <input data-filter="pos" list="vwPos" value="${esc(f.pos)}" autocapitalize="off"></label>
        <label class="vw-check"><input type="checkbox" data-filter="contains" ${f.contains ? 'checked' : ''}> contains</label>
        <button class="btn btn-primary btn-sm" type="submit">Search</button>
      </form>
      <div id="vwBrowseBody"></div>`;
    this.renderBrowseBody();
  }

  renderBrowseBody() {
    const body = this.view('browse').querySelector('#vwBrowseBody');
    if (this.browse.detail) {
      body.innerHTML = this.detailHtml(this.browse.detail);
      return;
    }
    const { results, total, searched } = this.browse;
    if (!searched) {
      body.innerHTML = '<div class="vw-empty">Search Ve\'rdd by language and word to view and edit entries.</div>';
      return;
    }
    if (!results.length) {
      body.innerHTML = '<div class="vw-empty">Nothing found.</div>';
      return;
    }
    body.innerHTML = `
      <div class="vw-results">
        ${results.map(l => `
          <div class="vw-result">
            <span class="vw-lemma">${esc(l.lexeme)}</span>
            <span class="vw-meta">${esc(l.language)} · ${esc(l.pos || 'no POS')}${l.homoId ? ` · homonym ${l.homoId}` : ''} · #${l.id}</span>
            ${isUndetermined(l.pos) ? '<span class="vw-badge vw-badge-warn" title="Open the entry to choose a part of speech.">POS undetermined</span>' : ''}
            ${l.checked ? '<span class="vw-badge vw-badge-ok">approved</span>' : ''}
            <button class="btn btn-secondary btn-sm" data-action="open-lexeme" data-id="${l.id}">Open</button>
          </div>`).join('')}
      </div>
      ${results.length < total ? `<button class="btn btn-secondary btn-sm" data-action="more-results">Show more (${results.length} of ${total})</button>` : `<div class="vw-hint">${total} found.</div>`}`;
  }

  async search(append = false) {
    if (!this.requireApi()) return;
    const f = this.browse.filters;
    if (!f.text.trim() && !f.language.trim() && !f.pos.trim()) {
      return this.showToast('Enter a language, a word or a POS to search.', 'info');
    }
    await this.guard(async () => {
      const offset = append ? this.browse.results.length : 0;
      const query = { language: f.language.trim(), pos: f.pos.trim(), limit: PAGE_SIZE, offset };
      query[f.contains ? 'q' : 'lexeme'] = f.text.trim();
      const { total, results } = await this.api.searchLexemes(query);
      this.browse.results = append ? [...this.browse.results, ...results] : results;
      this.browse.total = total;
      this.browse.searched = true;
      this.browse.detail = null;
      this.renderBrowseBody();
    });
  }

  async openLexeme(id, notice = null) {
    if (!this.requireApi()) return;
    await this.guard(async () => {
      const [lexeme, outgoing, incoming, examples] = await Promise.all([
        this.api.getLexeme(id), this.api.relationsFrom(id), this.api.relationsTo(id), this.api.lexemeExamples(id)
      ]);
      const twins = await findTwins(this.api, lexeme).catch(() => []);
      const isTranslation = (r) => r.type in TRANSLATION_TYPES;
      this.browse.detail = {
        lexeme,
        relations: outgoing.filter(isTranslation),
        incoming: incoming.filter(isTranslation),
        otherCount: outgoing.filter(r => !isTranslation(r)).length,
        allOutgoing: outgoing, allIncoming: incoming, examples,
        twins, notice, mergePreview: null,
        form: { tgtLang: '', translation: '', tgtPos: '', tgtHomoId: '', exSrc: '', exTgt: '', relType: TRANSLATION_TYPE }
      };
      this.renderBrowseBody();
      this.view('browse').scrollIntoView({ block: 'start' });
    });
  }

  posSelect(current, attrs) {
    const values = [...new Set([...(current ? [current] : []), ...this.posList])];
    return `<select ${attrs}>
        ${current ? '' : '<option value="">— choose —</option>'}
        ${values.map(p => `<option value="${esc(p)}" ${p === current ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>`;
  }

  detailHtml(detail) {
    const { lexeme, relations, incoming, otherCount, form } = detail;
    const url = this.absoluteUrl(lexeme.web_url);
    const relationHtml = relations.map(r => this.relationHtml(r)).join('') || '<div class="vw-empty">No translations yet.</div>';
    const incomingHtml = incoming.map(r => `
      <div class="vw-result">
        <span class="vw-lemma">${esc(r.lexeme_from_info.lexeme)}</span>
        <span class="vw-meta">${esc(r.lexeme_from_info.language)} · ${esc(r.lexeme_from_info.pos)} → this entry</span>
        <button class="btn btn-secondary btn-sm" data-action="open-lexeme" data-id="${r.lexeme_from}">Open</button>
      </div>`).join('');
    const tidy = tidyHeadword(lexeme.lexeme);
    const undetermined = isUndetermined(lexeme.pos);
    const notice = detail.notice
      ? `<div class="vw-ok">${esc(detail.notice.text)}${detail.notice.openId ? ` <button class="btn btn-secondary btn-sm" data-action="open-lexeme" data-id="${detail.notice.openId}">Open #${detail.notice.openId}</button>` : ''}</div>`
      : '';
    return `
      <button class="btn btn-secondary btn-sm" data-action="back-to-results">← Results</button>
      <section class="vw-detail" data-lexeme="${lexeme.id}">
        <h4>${esc(lexeme.lexeme)} <span class="vw-meta">${esc(lexeme.language)} · #${lexeme.id}</span>
          ${lexeme.checked ? '<span class="vw-badge vw-badge-ok">approved</span>' : '<span class="vw-badge">unapproved</span>'}
          ${undetermined ? '<span class="vw-badge vw-badge-warn">POS undetermined</span>' : ''}
          <a href="${esc(url)}" target="_blank" rel="noopener">Open in Ve'rdd</a></h4>
        ${notice}
        <div class="vw-grid">
          <label>Headword <input data-edit="lexeme" value="${esc(lexeme.lexeme)}" lang="und"></label>
          <label><span>Part of speech <span class="vw-req">required</span></span> ${this.posSelect(lexeme.pos, 'data-edit="pos"')}</label>
          <label>Homonym <input data-edit="homoId" type="number" min="0" value="${esc(lexeme.homoId)}"></label>
          <label>Notes <input data-edit="notes" value="${esc(lexeme.notes)}"></label>
        </div>
        ${tidy && tidy !== lexeme.lexeme ? `<div class="vw-hint">Suggested headword: <strong>${esc(tidy)}</strong> <button class="btn btn-secondary btn-sm" data-action="use-tidy" data-value="${esc(tidy)}">Use it</button></div>` : ''}
        ${undetermined ? '<div class="vw-hint">This entry has no part of speech yet. Choose one and save; if the same word already exists below, merge the two instead.</div>' : ''}
        ${lexeme.checked ? '<div class="vw-hint">This entry is approved; saving a change marks it unapproved again so it gets reviewed.</div>' : ''}
        <div class="vw-actions"><button class="btn btn-primary btn-sm" data-action="save-lexeme">Save entry</button></div>
        <div data-slot="browse-collision"></div>

        <h5>Same word elsewhere</h5>
        <div class="vw-hint">Entries of this language with the same headword${tidy && tidy !== lexeme.lexeme ? ' (also with the suggested spelling)' : ''}. Merging joins everything on one entry and deletes the other.</div>
        <div data-slot="browse-twins">${this.twinsHtml(detail)}</div>
        <div class="vw-actions">
          <label class="vw-inline">Merge with entry # <input type="number" min="1" data-merge-id style="width:7em"></label>
          <button class="btn btn-secondary btn-sm" data-action="twin-add">Compare</button>
        </div>
        <div data-slot="browse-merge"></div>

        <h5>Translations</h5>
        ${relationHtml}
        ${otherCount ? `<div class="vw-hint">${otherCount} other relation${otherCount > 1 ? 's' : ''} (synonyms, etymology…) can be edited in Ve'rdd.</div>` : ''}
        ${incomingHtml ? `<h5>Translated from</h5>${incomingHtml}` : ''}

        <h5>Add a translation</h5>
        <div class="vw-grid" data-form="add-translation">
          <label>Translation <input data-add="translation" value="${esc(form.translation)}" lang="und"></label>
          <label>Language <input data-add="tgtLang" list="vwLangs" value="${esc(form.tgtLang)}" autocapitalize="off"></label>
          <label>Translation POS <input data-add="tgtPos" list="vwPos" placeholder="${esc(lexeme.pos)}" value="${esc(form.tgtPos)}" autocapitalize="off"></label>
          <label>Translation homonym <input data-add="tgtHomoId" type="number" min="0" placeholder="auto" value="${esc(form.tgtHomoId)}"></label>
          <label>Relation type <select data-add="relType">${this.typeOptions(form.relType)}</select></label>
        </div>
        <div class="vw-grid vw-grid-wide">
          <label>Example sentence <input data-add="exSrc" value="${esc(form.exSrc)}"></label>
          <label>Example translation <input data-add="exTgt" value="${esc(form.exTgt)}"></label>
        </div>
        <div class="vw-actions"><button class="btn btn-primary btn-sm" data-action="add-translation">Add translation</button></div>

        ${this.splitHtml(detail)}
      </section>`;
  }

  relationHtml(r) {
    const to = r.lexeme_to_info;
    const examples = r.examples.map(e => `
      <div class="vw-example" data-example="${e.id}">
        <span class="vw-badge">${esc(e.language)}</span>
        <input data-ex="text" value="${esc(e.text)}">
        <input data-ex="source" value="${esc(e.source)}" placeholder="source">
        <button class="btn btn-secondary btn-sm" data-action="save-example" data-id="${e.id}">Save</button>
        <button class="btn btn-secondary btn-sm vw-danger" data-action="delete-example" data-id="${e.id}">Delete</button>
        ${e.linked_to.length ? `<span class="vw-meta" title="Linked to example #${e.linked_to.join(', #')}">⇄</span>` : ''}
      </div>`).join('');
    return `
      <div class="vw-relation" data-relation="${r.id}">
        <div class="vw-relation-head">
          <span class="vw-lemma">${esc(to.lexeme)}</span>
          <span class="vw-meta">${esc(to.language)} · ${esc(to.pos)}${to.homoId ? ` · homonym ${to.homoId}` : ''} · ${esc(TRANSLATION_TYPES[r.type])}</span>
          ${r.checked ? '<span class="vw-badge vw-badge-ok">approved</span>' : ''}
          <button class="btn btn-secondary btn-sm" data-action="open-lexeme" data-id="${to.id}">Open</button>
        </div>
        <div class="vw-example">
          <select data-rel="type" title="Description translation: the headword is explained in several words rather than translated word for word.">${this.typeOptions(r.type)}</select>
          <input data-rel="notes" value="${esc(r.notes)}" placeholder="notes on this translation">
          <button class="btn btn-secondary btn-sm" data-action="save-relation" data-id="${r.id}">Save</button>
          <button class="btn btn-secondary btn-sm vw-danger" data-action="delete-relation" data-id="${r.id}">Delete translation</button>
        </div>
        ${examples}
        <div class="vw-example vw-new-example" data-new-example="${r.id}">
          <input data-nex="exSrc" placeholder="new example in ${esc(r.lexeme_from_info.language)}">
          <input data-nex="exTgt" placeholder="its translation in ${esc(to.language)}">
          <button class="btn btn-secondary btn-sm" data-action="add-example" data-id="${r.id}">Add example</button>
        </div>
      </div>`;
  }

  detailValues(selector, attr) {
    const out = {};
    this.view('browse').querySelectorAll(selector).forEach(el => { out[el.getAttribute(attr)] = el.value; });
    return out;
  }

  async saveLexeme() {
    const { lexeme } = this.browse.detail;
    const values = this.detailValues('[data-edit]', 'data-edit');
    const pos = values.pos.trim();
    if (!pos) return this.showToast("Part of speech is required by Ve'rdd.", 'error');
    if (!values.lexeme.trim()) return this.showToast('The headword cannot be empty.', 'error');
    const fields = { lexeme: values.lexeme.trim(), pos, notes: values.notes.trim() };
    if (values.homoId !== '') fields.homoId = Number(values.homoId);
    await this.guard(async () => {
      const clash = await findEditCollision(this.api, lexeme, fields);
      if (clash) return this.showCollision(clash);
      await this.api.updateLexeme(lexeme.id, fields);
      this.showToast('Entry saved.', 'success');
      await this.openLexeme(lexeme.id);
    });
  }

  /** Ve'rdd allows one entry per headword, POS and homonym number, so the edit becomes a merge. */
  showCollision(clash) {
    const detail = this.browse.detail;
    if (!detail.twins.some(t => t.id === clash.id)) detail.twins.push(clash);
    this.refreshTwins();
    const slot = this.view('browse').querySelector('[data-slot="browse-collision"]');
    const dropsPos = mergeVerdict(this.entryOf(detail.lexeme), clash, { allowDifferentPos: true }).differentPos;
    const posNote = dropsPos
      ? ` The merged entry stays <strong>${esc(clash.pos)}</strong>; this entry's saved part of speech (${esc(detail.lexeme.pos)}) is dropped.`
      : '';
    slot.innerHTML = `
      <div class="vw-problems">Not saved: entry #${clash.id} is already <strong>${esc(clash.lexeme)}</strong> · ${esc(clash.pos)}${clash.homoId ? ` · homonym ${clash.homoId}` : ''}.
        Two entries cannot share a headword, POS and homonym number. Merge this entry into #${clash.id}, or give it another homonym number.${posNote}
        <button class="btn btn-primary btn-sm" data-action="twin-merge-preview" data-absorbed="${detail.lexeme.id}" data-keeper="${clash.id}" data-allow-pos="${dropsPos ? 1 : ''}">Preview merge into #${clash.id}</button></div>`;
    slot.scrollIntoView({ block: 'nearest' });
  }

  async addTranslation() {
    const { lexeme } = this.browse.detail;
    const v = this.detailValues('[data-add]', 'data-add');
    const row = newRow({
      srcLang: lexeme.language, lemma: lexeme.lexeme, pos: lexeme.pos, srcHomoId: lexeme.homoId,
      tgtLang: v.tgtLang.trim(), translation: v.translation.trim(), tgtPos: v.tgtPos.trim(),
      tgtHomoId: v.tgtHomoId === '' ? null : Number(v.tgtHomoId), exSrc: v.exSrc.trim(), exTgt: v.exTgt.trim(),
      relType: Number(v.relType)
    });
    if (!row.translation) return this.showToast('Enter the translation.', 'error');
    const problems = validateRow(row, { languages: this.knownLanguageIds() });
    if (problems.length) return this.showToast(problems[0].message, 'error');
    await this.guard(async () => {
      const { failed } = await sendRows(this.api, [row]);
      if (failed) return this.showToast(row.message, 'error');
      this.showToast(row.message, 'success');
      await this.openLexeme(lexeme.id);
    });
  }

  async saveRelation(id) {
    const holder = this.view('browse').querySelector(`[data-relation="${id}"]`);
    const relation = this.browse.detail.relations.find(r => r.id === id);
    const notes = holder.querySelector('[data-rel="notes"]').value.trim();
    const type = Number(holder.querySelector('[data-rel="type"]').value);
    // only what changed is sent: Ve'rdd marks a relation unapproved when its type or notes change
    const fields = {};
    if (notes !== (relation.notes || '')) fields.notes = notes;
    if (type !== relation.type) fields.type = type;
    if (!Object.keys(fields).length) return this.showToast('Nothing changed.', 'info');
    await this.guard(async () => {
      await this.api.updateRelation(id, fields);
      this.showToast('type' in fields ? `Saved as ${TRANSLATION_TYPES[type].toLowerCase()}.` : 'Translation note saved.', 'success');
      await this.openLexeme(this.browse.detail.lexeme.id);
    });
  }

  async deleteRelation(id) {
    if (!this.confirmAction('Delete this translation and its examples from Ve\'rdd?')) return;
    await this.guard(async () => {
      await this.api.deleteRelation(id);
      this.showToast('Translation deleted.', 'success');
      await this.openLexeme(this.browse.detail.lexeme.id);
    });
  }

  async saveExample(id) {
    const holder = this.view('browse').querySelector(`[data-example="${id}"]`);
    const text = holder.querySelector('[data-ex="text"]').value.trim();
    if (!text) return this.showToast('The example cannot be empty; delete it instead.', 'error');
    await this.guard(async () => {
      await this.api.updateRelationExample(id, { text, source: holder.querySelector('[data-ex="source"]').value.trim() });
      this.showToast('Example saved.', 'success');
      await this.openLexeme(this.browse.detail.lexeme.id);
    });
  }

  async deleteExample(id) {
    if (!this.confirmAction('Delete this example from Ve\'rdd?')) return;
    await this.guard(async () => {
      await this.api.deleteRelationExample(id);
      this.showToast('Example deleted.', 'success');
      await this.openLexeme(this.browse.detail.lexeme.id);
    });
  }

  async addExample(relationId) {
    const relation = this.browse.detail.relations.find(r => r.id === relationId);
    const holder = this.view('browse').querySelector(`[data-new-example="${relationId}"]`);
    const exSrc = holder.querySelector('[data-nex="exSrc"]').value;
    const exTgt = holder.querySelector('[data-nex="exTgt"]').value;
    const from = relation.lexeme_from_info;
    const to = relation.lexeme_to_info;
    const row = newRow({
      srcLang: from.language, lemma: from.lexeme, pos: from.pos, srcHomoId: from.homoId,
      tgtLang: to.language, translation: to.lexeme, tgtPos: to.pos, tgtHomoId: to.homoId, exSrc, exTgt
    });
    if (!exSrc.trim()) return this.showToast('Enter the example sentence.', 'error');
    const problems = validateRow(row);
    if (problems.length) return this.showToast(problems[0].message, 'error');
    await this.guard(async () => {
      const payload = rowToPairPayload(row);
      payload.type = relation.type;
      const [result] = await this.api.sendPairs([payload]);
      if (!result.ok) return this.showToast(describeApiError(result.errors), 'error');
      this.showToast('Example added.', 'success');
      await this.openLexeme(this.browse.detail.lexeme.id);
    });
  }


  // ------------------------------------------------------------------------------------
  // Browse & edit: merge this entry with the same word elsewhere, or split it
  // ------------------------------------------------------------------------------------

  entryOf(lexeme) {
    return { id: lexeme.id, lexeme: lexeme.lexeme, language: lexeme.language, pos: lexeme.pos, homoId: lexeme.homoId };
  }

  twinsHtml(detail) {
    if (!detail.twins.length) return '<div class="vw-empty">No other entry with this headword.</div>';
    const here = this.entryOf(detail.lexeme);
    return detail.twins.map(twin => {
      const homo = twin.homoId ? ` · homonym ${twin.homoId}` : '';
      const verdict = mergeVerdict(here, twin);
      const actions = verdict.ok
        ? `<div class="vw-actions">
            <button class="btn btn-secondary btn-sm" data-action="twin-merge-preview" data-absorbed="${here.id}" data-keeper="${twin.id}">Merge this into #${twin.id}</button>
            <button class="btn btn-secondary btn-sm" data-action="twin-merge-preview" data-absorbed="${twin.id}" data-keeper="${here.id}">Merge #${twin.id} into this</button>
          </div>`
        : `<div class="vw-problems">${esc(verdict.reason)}</div>`;
      return `
        <div class="vw-result" data-twin="${twin.id}">
          <span class="vw-lemma">${esc(twin.lexeme)}</span>
          <span class="vw-meta">#${twin.id} · ${esc(twin.language)} · ${esc(twin.pos || 'no POS')}${esc(homo)}${twin.translations.length ? ` → ${esc(twin.translations.join(', '))}` : ''}</span>
          ${twin.checked ? '<span class="vw-badge vw-badge-ok">approved</span>' : ''}
          <button class="btn btn-secondary btn-sm" data-action="open-lexeme" data-id="${twin.id}">Open</button>
          ${actions}
        </div>`;
    }).join('');
  }

  refreshTwins() {
    const slot = this.view('browse').querySelector('[data-slot="browse-twins"]');
    if (slot) slot.innerHTML = this.twinsHtml(this.browse.detail);
  }

  async addTwin() {
    const detail = this.browse.detail;
    const input = this.view('browse').querySelector('[data-merge-id]');
    const id = Number(input.value);
    if (!Number.isInteger(id) || id < 1) return this.showToast('Enter the number of the other entry.', 'error');
    if (id === detail.lexeme.id) return this.showToast('That is this entry.', 'error');
    await this.guard(async () => {
      const other = await describeById(this.api, id);
      const verdict = mergeVerdict(this.entryOf(detail.lexeme), other);
      if (!verdict.ok) return this.showToast(verdict.reason, 'error');
      detail.twins = [...detail.twins.filter(t => t.id !== id), other];
      this.refreshTwins();
      input.value = '';
    });
  }

  async previewTwinMerge(absorbedId, keeperId, allowDifferentPos = false) {
    const detail = this.browse.detail;
    const entries = new Map([[detail.lexeme.id, this.entryOf(detail.lexeme)], ...detail.twins.map(t => [t.id, t])]);
    const [absorbed, keeper] = [entries.get(absorbedId), entries.get(keeperId)];
    if (!absorbed || !keeper) return;
    const verdict = mergeVerdict(absorbed, keeper, { allowDifferentPos });
    if (!verdict.ok) return this.showToast(verdict.reason, 'error');
    await this.guard(async () => {
      const options = { allowDifferentHeadword: verdict.differentHeadword, allowDifferentPos: verdict.differentPos };
      const report = await this.api.mergeLexeme(absorbedId, keeperId, { dryRun: true, ...options });
      detail.mergePreview = { absorbedId, keeperId, ...options, report };
      const slot = this.view('browse').querySelector('[data-slot="browse-merge"]');
      slot.innerHTML = `
        <div class="vw-merge-detail">
          <h5>Preview: join #${absorbedId} into #${keeperId}</h5>
          <div class="vw-merge-cols vw-merge-compare">
            <div class="vw-merge-col vw-merge-from"><div class="vw-meta">Absorbed (deleted afterwards)</div>${this.mergeEntryHtml(report.absorbed, true)}</div>
            <div class="vw-merge-arrow">→</div>
            <div class="vw-merge-col"><div class="vw-meta">Kept</div>${this.mergeEntryHtml(report.into, true)}</div>
          </div>
          <ul class="vw-merge-report">${describeMerge(report).map(line => `<li>${esc(line)}</li>`).join('')}</ul>
          <div class="vw-hint">Nothing has been changed yet.</div>
          <div class="vw-actions">
            <button class="btn btn-primary btn-sm" data-action="twin-merge-do">Join #${absorbedId} into #${keeperId}</button>
            <button class="btn btn-secondary btn-sm" data-action="twin-merge-cancel">Cancel</button>
          </div>
        </div>`;
      slot.scrollIntoView({ block: 'nearest' });
    });
  }

  async performTwinMerge() {
    const detail = this.browse.detail;
    const preview = detail?.mergePreview;
    if (!preview) return;
    const { absorbedId, keeperId, allowDifferentHeadword, allowDifferentPos, report } = preview;
    const lines = describeMerge(report).join('\n');
    const headwords = allowDifferentHeadword ? `\nThe headwords differ: "${report.absorbed.lexeme}" and "${report.into.lexeme}".\n` : '';
    // A note typed into the form but not saved would vanish with the absorbed entry.
    const typed = absorbedId === detail.lexeme.id ? this.detailValues('[data-edit]', 'data-edit').notes?.trim() : '';
    const carryNotes = typed && typed !== (detail.lexeme.notes || '') ? typed : '';
    const notesLine = carryNotes ? `\nYour notes "${carryNotes}" are added to the kept entry if it has none.\n` : '';
    if (!this.confirmAction(`Join #${absorbedId} into #${keeperId}? #${absorbedId} is deleted afterwards.${headwords}${notesLine}\n${lines}`)) return;
    await this.guard(async () => {
      if (carryNotes) await this.api.updateLexeme(absorbedId, { notes: carryNotes }); // the merge copies it when the kept entry has none
      const done = await this.api.mergeLexeme(absorbedId, keeperId, { allowDifferentHeadword, allowDifferentPos });
      this.browse.results = this.browse.results.filter(l => l.id !== absorbedId);
      this.browse.total = Math.max(0, this.browse.total - 1);
      this.showToast(`Joined #${absorbedId} into #${keeperId}.`, 'success');
      const kept = (done.notes || []).filter(n => n.startsWith('notes:')).join(' ');
      await this.openLexeme(keeperId, { text: `Joined #${absorbedId} into this entry.${kept ? ` ${kept}` : ''}` });
    });
  }

  relationLabel(r, direction) {
    const other = direction === 'out' ? r.lexeme_to_info : r.lexeme_from_info;
    const mirrored = r.type in MIRROR_TYPE ? ' (its mirror moves too)' : '';
    return `${direction === 'out' ? '→' : '←'} <strong>${esc(other?.lexeme ?? '')}</strong> <span class="vw-meta">${esc(other?.language ?? '')} · ${esc(other?.pos ?? '')} · ${esc(RELATION_TYPES[r.type] ?? 'Relation')}${mirrored}</span>`;
  }

  splitHtml(detail) {
    const { lexeme, allOutgoing, allIncoming, examples } = detail;
    // A mirrored pair is listed once: choosing either row moves both.
    const outgoingKeys = new Set(allOutgoing.map(r => `${r.type}|${r.lexeme_to}`));
    const incoming = allIncoming.filter(r => !(r.type in MIRROR_TYPE && outgoingKeys.has(`${MIRROR_TYPE[r.type]}|${r.lexeme_from}`)));
    const pick = (attr, id, html) => `<label class="vw-pick"><input type="checkbox" ${attr}="${id}"> <span>${html}</span></label>`;
    const rows = [
      ...allOutgoing.map(r => pick('data-split-rel', r.id, this.relationLabel(r, 'out'))),
      ...incoming.map(r => pick('data-split-rel', r.id, this.relationLabel(r, 'in'))),
      ...examples.map(e => pick('data-split-ex', e.id, `“${esc(e.text)}” <span class="vw-meta">example</span>`))
    ];
    return `
      <details class="vw-split">
        <summary>Split this entry</summary>
        <div class="vw-hint">Use this when one entry mixes two meanings, homonyms or parts of speech. Type the new entry's headword and tick what belongs to it; the rest stays here. Afterwards edit this entry's own headword if needed. Forms, stems and metadata stay on this entry.</div>
        <div class="vw-grid">
          <label>New headword <input data-split="lexeme" placeholder="${esc(lexeme.lexeme)}" lang="und"></label>
          <label><span>New part of speech</span> ${this.posSelect(lexeme.pos, 'data-split="pos"')}</label>
          <label>New homonym <input data-split="homoId" type="number" min="0" placeholder="next free"></label>
        </div>
        <div class="vw-picks">${rows.join('') || '<div class="vw-empty">This entry has no translations or examples to move.</div>'}</div>
        <label class="vw-pick"><input type="checkbox" data-split="copy"> <span><strong>Copy instead of move</strong>: the ticked translations and examples stay on this entry too, so both entries have the same ones (for example when a headword written gluck(s)en becomes glucksen and glucken).</span></label>
        <div class="vw-actions"><button class="btn btn-secondary btn-sm" data-action="split-preview">Preview split</button></div>
        <div data-slot="browse-split"></div>
      </details>`;
  }

  splitRequest() {
    const root = this.view('browse');
    const checked = (attr) => [...root.querySelectorAll(`[${attr}]:checked`)].map(el => Number(el.getAttribute(attr)));
    const field = (name) => root.querySelector(`[data-split="${name}"]`).value.trim();
    return {
      relations: checked('data-split-rel'),
      examples: checked('data-split-ex'),
      lexeme: field('lexeme'),
      pos: field('pos'),
      homoId: field('homoId') === '' ? undefined : Number(field('homoId')),
      copy: Boolean(root.querySelector('[data-split="copy"]')?.checked)
    };
  }

  async previewSplit() {
    const detail = this.browse.detail;
    const request = this.splitRequest();
    const newHeadword = request.lexeme && request.lexeme !== detail.lexeme.lexeme;
    if (!request.relations.length && !request.examples.length && !newHeadword) {
      return this.showToast('Type a new headword, or tick at least one translation or example to move (or copy) to the new entry.', 'error');
    }
    await this.guard(async () => {
      const report = await this.api.splitLexeme(detail.lexeme.id, { ...request, dryRun: true });
      detail.splitPreview = { request, report };
      const slot = this.view('browse').querySelector('[data-slot="browse-split"]');
      slot.innerHTML = `
        <div class="vw-merge-detail">
          <h5>Preview: new entry <span class="vw-lemma">${esc(report.new.lexeme)}</span> · ${esc(report.new.pos)}${report.new.homoId ? ` · homonym ${report.new.homoId}` : ''}</h5>
          <ul class="vw-merge-report">${describeSplit(report).map(line => `<li>${esc(line)}</li>`).join('')}</ul>
          <div class="vw-hint">Nothing has been changed yet. Afterwards this entry keeps ${esc(describeCounts(report.source.counts))}.</div>
          <div class="vw-actions">
            <button class="btn btn-primary btn-sm" data-action="split-do">Split now</button>
            <button class="btn btn-secondary btn-sm" data-action="split-cancel">Cancel</button>
          </div>
        </div>`;
    });
  }

  async performSplit() {
    const detail = this.browse.detail;
    const preview = detail?.splitPreview;
    if (!preview) return;
    const { request, report } = preview;
    if (!this.confirmAction(`Split ${report.new.lexeme} (${report.new.pos}) off #${detail.lexeme.id}?\n\n${describeSplit(report).join('\n')}`)) return;
    await this.guard(async () => {
      const done = await this.api.splitLexeme(detail.lexeme.id, request);
      this.showToast(`Created #${done.new.id}.`, 'success');
      await this.openLexeme(detail.lexeme.id, { text: `Split off as #${done.new.id} (${done.new.lexeme}, ${done.new.pos}).`, openId: done.new.id });
    });
  }

  // ------------------------------------------------------------------------------------
  // Merge tab: join entries with undetermined POS into the real-POS entry of the same word
  // ------------------------------------------------------------------------------------

  renderMerge() {
    const capital = this.merge.mode === CAPITALISED_NOUN;
    this.view('merge').innerHTML = `
      <p class="vw-hint">${capital
        ? 'Entries of <strong>one language</strong> (nouns, POS N, unless you choose another source POS) whose headword begins with a capital letter, optionally only with the chosen initial letter (told apart by Unicode value: Latin A and Cyrillic А are different): names that may be proper nouns (Prop), or capitalised by mistake. Whether that is wrong depends on the language (weekdays and months are common nouns in many), which is why a language is required. Where the same word exists in lower case or under another POS it is offered as the entry to join. Nothing is changed until you confirm.'
        : 'Entries whose part of speech is undetermined (empty, ZERO or UND) and that share their headword and language with an entry that has one. An <strong>empty</strong> entry can simply be absorbed; otherwise inspect both, then join them. Nothing is changed until you confirm.'}</p>
      <form class="vw-search" data-form="merge-find">
        <label>Find <select data-merge-filter="mode">
          <option value="undetermined" ${capital ? '' : 'selected'}>undetermined POS with a twin</option>
          <option value="${CAPITALISED_NOUN}" ${capital ? 'selected' : ''}>capitalised nouns (N)</option>
        </select></label>
        <label>Language <input data-merge-filter="language" list="vwLangs" value="${esc(this.merge.language)}" autocapitalize="off" placeholder="${capital ? 'e.g. fin' : 'all languages'}" ${capital ? 'required' : ''}></label>
        ${capital ? `
        <label>Initial letter <input data-merge-filter="initials" value="${esc(this.merge.initials)}" autocapitalize="off" size="8" placeholder="all, or e.g. А Б"></label>
        <label>POS of the entries (source) <input data-merge-filter="sourcePos" list="vwPos" value="${esc(this.merge.sourcePos)}" autocapitalize="off" size="6"></label>
        <label>POS to join or change into (target) <input data-merge-filter="targetPos" list="vwPos" value="${esc(this.merge.targetPos)}" autocapitalize="off" size="6"></label>` : ''}
        <button class="btn btn-primary btn-sm" type="submit">Find</button>
      </form>
      ${capital ? `<div class="vw-hint" id="vwInitialCodes">${esc(describeInitials(this.merge.initials))}</div>` : ''}
      <div class="vw-hint" id="vwMergeProgress" role="status"></div>
      <div id="vwMergeBody"></div>`;
    this.renderMergeBody();
  }

  setMergeProgress(text) {
    const el = this.root.querySelector('#vwMergeProgress');
    if (el) el.textContent = text;
  }

  renderMergeBody() {
    const body = this.view('merge').querySelector('#vwMergeBody');
    const { groups, total, loaded } = this.merge;
    if (!loaded) {
      body.innerHTML = '<div class="vw-empty">Press Find to list entries that can be merged.</div>';
    } else if (!groups.length) {
      body.innerHTML = `<div class="vw-empty">${this.merge.mode === CAPITALISED_NOUN ? `No nouns with a capital initial in ${esc(this.merge.language.trim())}.` : 'No mergeable entries found.'}</div>`;
    } else {
      body.innerHTML = `
        <div class="vw-hint">${total} ${this.merge.mode === CAPITALISED_NOUN ? (/^n$/i.test((this.merge.sourcePos || 'N').trim()) ? `capitalised ${total === 1 ? 'noun' : 'nouns'}` : `capitalised ${esc((this.merge.sourcePos || '').trim())} ${total === 1 ? 'entry' : 'entries'}`) : `mergeable ${total === 1 ? 'entry' : 'entries'}`}${esc(this.merge.scanNote)}.</div>
        ${this.merge.mode === CAPITALISED_NOUN ? this.bulkBarHtml() : ''}
        <div class="vw-cards">${groups.map(g => this.mergeGroupHtml(g)).join('')}</div>
        ${groups.length < total ? '<button class="btn btn-secondary btn-sm" data-action="merge-more">Show more</button>' : ''}`;
    }
  }

  mergeEntryHtml(entry, withHeadword = false) {
    const homo = entry.homoId ? ` · homonym ${entry.homoId}` : '';
    const translations = entry.translations.length ? `<div class="vw-meta">→ ${esc(entry.translations.join(', '))}</div>` : '';
    return `
      <div class="vw-lemma">${withHeadword ? `${esc(entry.lexeme)} ` : ''}#${entry.id} <span class="vw-badge ${entry.pos && entry.pos !== 'ZERO' && entry.pos !== 'UND' ? 'vw-badge-ok' : 'vw-badge-warn'}">${esc(entry.pos || 'no POS')}</span>
        ${entry.checked ? '<span class="vw-badge vw-badge-ok">approved</span>' : ''}</div>
      <div class="vw-meta">${esc(entry.language)}${esc(homo)}${entry.counts ? ` · ${esc(describeCounts(entry.counts))}` : ''}</div>
      ${translations}`;
  }

  mergeGroupHtml(group) {
    if (group.entry) return this.capitalGroupHtml(group);
    const u = group.undetermined;
    const candidates = group.candidates.map(c => `
      <div class="vw-merge-col">
        ${this.mergeEntryHtml(c)}
        <button class="btn ${u.empty ? 'btn-primary' : 'btn-secondary'} btn-sm" data-action="${u.empty ? 'merge-absorb' : 'merge-inspect'}" data-absorbed="${u.id}" data-keeper="${c.id}">
          ${u.empty ? `Absorb #${u.id} into this` : 'Inspect &amp; join into this'}
        </button>
      </div>`).join('');
    return `
      <article class="vw-card" data-merge-group="${u.id}">
        <header class="vw-card-head"><span class="vw-lemma">${esc(u.lexeme)}</span>${u.empty ? '<span class="vw-badge vw-badge-ok">empty</span>' : ''}</header>
        <div class="vw-merge-cols">
          <div class="vw-merge-col vw-merge-from"><div class="vw-meta">Undetermined POS</div>${this.mergeEntryHtml(u)}</div>
          <div class="vw-merge-arrow">→</div>
          <div class="vw-merge-targets">${candidates}</div>
        </div>
        <div data-slot="merge-detail" data-absorbed="${u.id}"></div>
      </article>`;
  }

  /** A capitalised noun and the entries it could be joined with (same word in lower case, or under another POS). */
  capitalGroupHtml(group) {
    const e = group.entry;
    const candidates = group.candidates.map(c => `
      <div class="vw-merge-col">
        ${this.mergeEntryHtml(c, true)}
        <button class="btn btn-secondary btn-sm" data-action="merge-inspect" data-absorbed="${e.id}" data-keeper="${c.id}">Inspect &amp; join #${e.id} into this</button>
      </div>`).join('');
    const plan = bulkPlan(group, this.merge.targetPos);
    const ticked = this.merge.selected.has(e.id) ? 'checked' : '';
    const pick = plan.kind === 'join'
      ? `<label class="vw-inline"><input type="checkbox" data-bulk-select="${e.id}" ${ticked}> Join into ${esc(this.merge.targetPos)} #${plan.keeper.id}</label>`
      : plan.kind === 'convert'
        ? `<label class="vw-inline"><input type="checkbox" data-bulk-select="${e.id}" ${ticked}> No ${esc(this.merge.targetPos)} entry: change this one to ${esc(this.merge.targetPos)}</label>`
        : `<span class="vw-meta">Not for bulk: ${esc(plan.reason)}.</span>`;
    return `
      <article class="vw-card" data-merge-group="${e.id}">
        <header class="vw-card-head"><span class="vw-lemma">${esc(e.lexeme)}</span>${e.empty ? '<span class="vw-badge vw-badge-ok">empty</span>' : ''}${pick}</header>
        <div class="vw-merge-cols">
          <div class="vw-merge-col vw-merge-from"><div class="vw-meta">Capital initial, tagged ${esc(this.merge.sourcePos || 'N')}</div>${this.mergeEntryHtml(e)}
            <button class="btn btn-secondary btn-sm" data-action="merge-open" data-id="${e.id}">Open to edit</button></div>
          <div class="vw-merge-arrow">→</div>
          <div class="vw-merge-targets">${candidates || '<div class="vw-meta">No lower-case or other-POS entry of this word. Open it to change its POS (for example to Prop) or its headword.</div>'}</div>
        </div>
        <div data-slot="merge-detail" data-absorbed="${e.id}"></div>
      </article>`;
  }

  async loadMergeCandidates(append) {
    if (!this.requireApi()) return;
    if (this.merge.mode === CAPITALISED_NOUN && !this.merge.language.trim()) {
      return this.showToast('Enter a language code first (for example fin): whether a capital initial is wrong depends on the language.', 'error');
    }
    if (this.merge.busy) return;
    const capital = this.merge.mode === CAPITALISED_NOUN;
    const initials = parseInitials(this.merge.initials);
    await this.guard(async () => {
      const sourcePos = (this.merge.sourcePos || 'N').trim() || 'N';
      const otherPos = capital && sourcePos.toLowerCase() !== 'n';
      if (capital && (initials.size || otherPos) && !append) {
        // the server cannot filter by initial letter (and only lists N): read the language's entries page by page and keep these
        this.merge.busy = true;
        this.merge.selected = new Set();
        try {
          const language = this.merge.language.trim();
          const scan = otherPos
            ? await scanCapitalisedByPos(this.api, {
              language, pos: sourcePos, initials,
              onProgress: ({ scanned, total, found, twins }) => this.setMergeProgress(twins
                ? `Looking for the same words: ${twins} of ${found}…`
                : `Reading ${sourcePos} entries: ${scanned} of ${total}, ${found} with a capital initial…`)
            })
            : await scanCapitalisedNouns(this.api, {
              language, initials,
              onProgress: ({ scanned, total, found }) => this.setMergeProgress(`Reading capitalised nouns: ${scanned} of ${total}, ${found} with the chosen initial…`)
            });
          this.merge.groups = scan.groups;
          this.merge.total = scan.groups.length;
          this.merge.scanNote = otherPos ? ` among the ${scan.total} ${sourcePos} entries of this language` : ` among the ${scan.total} of this language with a capital initial`;
        } finally {
          this.merge.busy = false;
          this.setMergeProgress('');
        }
      } else {
        const { total, groups } = await this.api.mergeCandidates({
          language: this.merge.language.trim(), mode: this.merge.mode, limit: capital ? 50 : 10, offset: append ? this.merge.groups.length : 0
        });
        this.merge.groups = append ? [...this.merge.groups, ...groups] : groups;
        this.merge.total = total;
        this.merge.scanNote = '';
        if (!append) this.merge.selected = new Set();
      }
      this.merge.loaded = true;
      this.renderMergeBody();
    });
  }

  // ---- bulk: several capitalised nouns at once, each joined into its same-headword twin ------------------------

  /** The groups a bulk action applies to: kind 'join' (one twin of the chosen POS) or 'convert' (no such twin at all). */
  bulkGroups(kind) {
    return this.merge.groups.filter(g => {
      if (!g.entry) return false;
      const planned = bulkPlan(g, this.merge.targetPos).kind;
      return kind ? planned === kind : planned !== 'none';
    });
  }

  bulkBarHtml() {
    const pos = esc(this.merge.targetPos);
    const part = (kind, text) => {
      const groups = this.bulkGroups(kind);
      const all = groups.length && groups.every(g => this.merge.selected.has(g.entry.id));
      return `<label class="vw-inline"><input type="checkbox" data-bulk-all="${kind}" ${all ? 'checked' : ''} ${groups.length ? '' : 'disabled'}> Select all ${groups.length} ${text}</label>`;
    };
    const chosen = [...this.merge.selected].map(id => this.merge.groups.find(g => g.entry?.id === id)).filter(Boolean).map(g => bulkPlan(g, this.merge.targetPos).kind);
    const joins = chosen.filter(k => k === 'join').length;
    const converts = chosen.filter(k => k === 'convert').length;
    const what = [joins ? `join ${joins}` : '', converts ? `change ${converts} to ${pos}` : ''].filter(Boolean).join(' and ');
    return `
      <div class="vw-actions vw-bulk-bar">
        ${part('join', `that can join a ${pos} entry`)}
        ${part('convert', `with no ${pos} entry (change to ${pos})`)}
        <button class="btn btn-primary btn-sm" data-action="bulk-join" ${chosen.length ? '' : 'disabled'}>${what ? `${what[0].toUpperCase()}${what.slice(1)}…` : 'Nothing selected'}</button>
      </div>
      <div class="vw-hint">A selected entry is joined into the ${pos} entry with exactly the same headword and then deleted; one with no ${pos} entry of that word just gets the part of speech ${pos}. Ve'rdd is asked to check every join first; you see the result and confirm before anything changes.</div>`;
  }

  /** Redraw only the bar, so ticking boxes does not scroll or reset the list. */
  refreshBulkBar() {
    const bar = this.root.querySelector('.vw-bulk-bar');
    if (!bar) return;
    const holder = document.createElement('div');
    holder.innerHTML = this.bulkBarHtml();
    bar.replaceWith(holder.querySelector('.vw-bulk-bar'));
  }

  async bulkJoin() {
    if (!this.requireApi() || this.merge.busy) return;
    const pos = this.merge.targetPos.trim();
    const items = [];
    const conversions = [];
    this.merge.groups.forEach(g => {
      if (!g.entry || !this.merge.selected.has(g.entry.id)) return;
      const plan = bulkPlan(g, pos);
      if (plan.kind === 'join') items.push({ absorbedId: g.entry.id, keeperId: plan.keeper.id, lexeme: g.entry.lexeme, options: this.mergeOptions(g.entry, plan.keeper) });
      else if (plan.kind === 'convert') conversions.push({ id: g.entry.id, lexeme: g.entry.lexeme });
    });
    if (!items.length && !conversions.length) return;
    this.merge.busy = true;
    try {
      await this.guard(async () => {
        const check = await runBulkMerge(this.api, items, {
          dryRun: true,
          onProgress: ({ done, total }) => this.setMergeProgress(`Checking joins: ${done} of ${total}…`)
        });
        const good = check.filter(r => r.ok);
        const bad = check.filter(r => !r.ok);
        const moved = good.reduce((n, r) => n + Object.values(r.report?.moved || {}).reduce((a, b) => a + b, 0), 0);
        const label = (r) => `${items.find(i => i.absorbedId === r.absorbedId).lexeme} #${r.absorbedId} → #${r.keeperId}`;
        const more = (list, n = 8) => (list.length > n ? [`  … and ${list.length - n} more`] : []);
        const lines = [
          ...(good.length ? [
            `Join ${good.length} ${good.length === 1 ? 'entry' : 'entries'} into the ${pos} entry of the same word? Each joined entry is deleted afterwards.`,
            `${moved} translations, examples and other items move to the kept entries.`,
            ...good.slice(0, 8).map(r => `  ${label(r)}`), ...more(good)
          ] : []),
          ...(conversions.length ? [
            ...(good.length ? [''] : []),
            `Change the part of speech of ${conversions.length} ${conversions.length === 1 ? 'entry' : 'entries'} to ${pos} (there is no ${pos} entry of the same word)?`,
            ...conversions.slice(0, 8).map(c => `  ${c.lexeme} #${c.id}`), ...more(conversions)
          ] : []),
          ...(bad.length ? ['', `${bad.length} cannot be joined and stay as they are:`, ...bad.slice(0, 8).map(r => `  ${label(r)}: ${r.error}`)] : [])
        ];
        this.setMergeProgress('');
        if (!good.length && !conversions.length) return this.showToast(`None of the selected entries can be joined: ${bad[0]?.error || 'refused by Ve\'rdd'}`, 'error');
        if (!this.confirmAction(lines.join('\n'))) return;

        const joinedRes = await runBulkMerge(this.api, good, { onProgress: ({ done, total }) => this.setMergeProgress(`Joining: ${done} of ${total}…`) });
        const convertedRes = await runBulkConvert(this.api, conversions, { pos, onProgress: ({ done, total }) => this.setMergeProgress(`Changing the part of speech: ${done} of ${total}…`) });
        const gone = new Set([...joinedRes.filter(r => r.ok).map(r => r.absorbedId), ...convertedRes.filter(r => r.ok).map(r => r.id)]);
        const failed = [...joinedRes, ...convertedRes].filter(r => !r.ok);
        const joined = joinedRes.filter(r => r.ok).length;
        const converted = convertedRes.filter(r => r.ok).length;
        this.merge.groups = this.merge.groups.filter(g => !gone.has(g.entry?.id));
        this.merge.total = Math.max(0, this.merge.total - gone.size);
        gone.forEach(id => this.merge.selected.delete(id));
        this.setMergeProgress('');
        this.renderMergeBody();
        const msg = [joined ? `Joined ${joined} into ${pos}.` : '', converted ? `Changed ${converted} to ${pos}.` : ''].filter(Boolean).join(' ') || 'Nothing was changed.';
        this.showToast(failed.length ? `${msg} ${failed.length} failed: ${failed[0].error}` : msg, failed.length ? 'error' : 'success');
      });
    } finally {
      this.merge.busy = false;
      this.setMergeProgress('');
    }
  }

  findMergeGroup(absorbedId) {
    return this.merge.groups.find(g => groupEntry(g).id === absorbedId);
  }

  closeMergeDetail(absorbedId) {
    const slot = this.root.querySelector(`[data-slot="merge-detail"][data-absorbed="${absorbedId}"]`);
    if (slot) slot.innerHTML = '';
  }

  relationLines(relations, keeperKeys, direction) {
    if (!relations.length) return '<div class="vw-meta">None.</div>';
    return relations.map(r => {
      const other = direction === 'out' ? r.lexeme_to_info : r.lexeme_from_info;
      const key = `${r.type}|${r.lexeme_to}`;
      const already = direction === 'out' && keeperKeys && keeperKeys.has(key);
      return `<div class="vw-info">${direction === 'out' ? '→' : '←'} <strong>${esc(other.lexeme)}</strong> (${esc(other.language)} ${esc(other.pos)})${r.examples.length ? ` · ${r.examples.length} example${r.examples.length > 1 ? 's' : ''}` : ''}${already ? ' <span class="vw-badge vw-badge-warn">also on kept entry</span>' : ''}</div>`;
    }).join('');
  }

  async inspectMerge(absorbedId, keeperId) {
    if (!this.requireApi()) return;
    const group = this.findMergeGroup(absorbedId);
    if (!group) return;
    const keeper = group.candidates.find(c => c.id === keeperId);
    const options = this.mergeOptions(groupEntry(group), keeper);
    await this.guard(async () => {
      const [report, outgoing, incoming, keeperOutgoing] = await Promise.all([
        this.api.mergeLexeme(absorbedId, keeperId, { dryRun: true, ...options }),
        this.api.relationsFrom(absorbedId), this.api.relationsTo(absorbedId), this.api.relationsFrom(keeperId)
      ]);
      this.merge.previews[`${absorbedId}>${keeperId}`] = { report, options };
      const keeperKeys = new Set(keeperOutgoing.map(r => `${r.type}|${r.lexeme_to}`));
      const slot = this.root.querySelector(`[data-slot="merge-detail"][data-absorbed="${absorbedId}"]`);
      slot.innerHTML = `
        <div class="vw-merge-detail">
          <div class="vw-merge-cols vw-merge-compare">
            <div><h5>#${absorbedId} ${esc(groupEntry(group).pos || 'no POS')} — absorbed</h5>
              ${this.relationLines(outgoing, keeperKeys, 'out')}${incoming.length ? `<div class="vw-meta">Pointing to it:</div>${this.relationLines(incoming, null, 'in')}` : ''}</div>
            <div><h5>#${keeperId} ${esc(keeper.pos)} — kept</h5>${this.relationLines(keeperOutgoing, null, 'out')}</div>
          </div>
          ${this.mergeDifferenceNote(groupEntry(group), keeper)}<ul class="vw-merge-report">${describeMerge(report).map(line => `<li>${esc(line)}</li>`).join('')}</ul>
          <div class="vw-actions">
            <button class="btn btn-primary btn-sm" data-action="merge-confirm" data-absorbed="${absorbedId}" data-keeper="${keeperId}">Join #${absorbedId} into #${keeperId}</button>
            <button class="btn btn-secondary btn-sm" data-action="merge-cancel" data-absorbed="${absorbedId}">Cancel</button>
          </div>
        </div>`;
    });
  }

  async absorbEmpty(absorbedId, keeperId) {
    const group = this.findMergeGroup(absorbedId);
    const keeper = group?.candidates.find(c => c.id === keeperId);
    if (!keeper) return;
    if (!this.confirmAction(`#${absorbedId} (${groupEntry(group).pos || 'no POS'}) is empty. Delete it and keep #${keeperId} (${keeper.pos})?`)) return;
    await this.performMerge(absorbedId, keeperId, this.mergeOptions(groupEntry(group), keeper));
  }

  async confirmMerge(absorbedId, keeperId) {
    const { report, options } = this.merge.previews[`${absorbedId}>${keeperId}`] || {};
    const summary = report ? describeMerge(report).join('\n') : '';
    const differs = options?.allowDifferentHeadword && report ? `\nThe headwords differ: "${report.absorbed.lexeme}" and "${report.into.lexeme}"; the kept entry's headword stays.\n` : '';
    if (!this.confirmAction(`Join #${absorbedId} into #${keeperId}? #${absorbedId} is deleted afterwards.${differs}\n${summary}`)) return;
    await this.performMerge(absorbedId, keeperId, options);
  }

  /** Merge options for an absorbed/kept pair: the user confirms differing headwords or POS through the preview and the dialog. */
  mergeOptions(absorbed, keeper) {
    const verdict = mergeVerdict(absorbed, keeper, { allowDifferentPos: this.merge.mode === CAPITALISED_NOUN });
    return { allowDifferentHeadword: Boolean(verdict.differentHeadword), allowDifferentPos: Boolean(verdict.differentPos) };
  }

  mergeDifferenceNote(absorbed, keeper) {
    const notes = [];
    if (absorbed.lexeme !== keeper.lexeme) notes.push(`headwords differ ("${absorbed.lexeme}" and "${keeper.lexeme}"): the kept entry's stays`);
    if (!isUndetermined(absorbed.pos) && !isUndetermined(keeper.pos) && absorbed.pos !== keeper.pos) notes.push(`parts of speech differ (${absorbed.pos} and ${keeper.pos}): the kept entry's stays`);
    return notes.length ? `<div class="vw-problems">Note: ${esc(notes.join('; '))}.</div>` : '';
  }

  async performMerge(absorbedId, keeperId, options = {}) {
    await this.guard(async () => {
      await this.api.mergeLexeme(absorbedId, keeperId, options);
      this.merge.groups = this.merge.groups.filter(g => groupEntry(g).id !== absorbedId);
      this.merge.total = Math.max(0, this.merge.total - 1);
      this.renderMergeBody();
      this.showToast(`Joined #${absorbedId} into #${keeperId}.`, 'success');
    });
  }

  // ------------------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------------------

  rowFor(el) {
    const id = Number(el.dataset.row);
    return this.rows.find(r => r.id === id);
  }

  onInput(event) {
    const el = event.target;
    if (el.dataset.mergeFilter === 'language') {
      this.merge.language = el.value;
      return;
    }
    if (['initials', 'sourcePos', 'targetPos'].includes(el.dataset.mergeFilter)) {
      this.merge[el.dataset.mergeFilter] = el.value;
      const codes = this.root.querySelector('#vwInitialCodes');
      if (codes && el.dataset.mergeFilter === 'initials') codes.textContent = describeInitials(el.value);
      return;
    }
    if (el.dataset.filter) {
      this.browse.filters[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
      return;
    }
    if (!el.dataset.field || !el.dataset.row) return;
    const row = this.rowFor(el);
    if (!row) return;
    const name = el.dataset.field;
    if (HOMO_FIELDS.has(name)) {
      row[name] = el.value === '' ? null : Number(el.value);
    } else {
      row[name] = el.value;
    }
    if (row.status === 'sent' || row.status === 'error') { row.status = 'draft'; row.message = ''; }

    if (LOOKUP_FIELDS.has(name)) {
      row.srcMatches = null;
      row.tgtMatches = null;
      ['src-homo', 'tgt-homo'].forEach(slot => {
        const holder = this.root.querySelector(`[data-slot="${slot}"][data-row="${row.id}"]`);
        const active = holder && holder.contains(document.activeElement);
        if (holder && !active) holder.innerHTML = this.homoControl(row, slot === 'src-homo' ? 'src' : 'tgt');
      });
    }
    ['notes', 'badges'].forEach(slot => {
      const holder = this.root.querySelector(`[data-slot="${slot}"][data-row="${row.id}"]`);
      if (holder) holder.innerHTML = slot === 'notes' ? this.notesHtml(row) : this.badgesHtml(row);
    });
  }

  onChange(event) {
    const el = event.target;
    if (el.tagName === 'SELECT' && el.dataset.field && el.dataset.row) {
      const row = this.rowFor(el);
      if (!row) return;
      row[el.dataset.field] = el.value === '' ? null : Number(el.value);
      // a changed choice makes a row that was already sent (or failed) a draft again, as typing does
      if (row.status === 'sent' || row.status === 'error') { row.status = 'draft'; row.message = ''; }
      this.refreshCard(row);
    } else if (el.dataset.bulkSelect) {
      const id = Number(el.dataset.bulkSelect);
      if (el.checked) this.merge.selected.add(id); else this.merge.selected.delete(id);
      this.refreshBulkBar();
    } else if (el.dataset.bulkAll !== undefined) {
      this.bulkGroups(el.dataset.bulkAll).forEach(g => { if (el.checked) this.merge.selected.add(g.entry.id); else this.merge.selected.delete(g.entry.id); });
      this.root.querySelectorAll('[data-bulk-select]').forEach(box => { box.checked = this.merge.selected.has(Number(box.dataset.bulkSelect)); });
      this.refreshBulkBar();
    } else if (el.dataset.mergeFilter === 'mode') {
      this.merge.mode = el.value;
      this.merge.groups = [];
      this.merge.total = 0;
      this.merge.loaded = false;
      this.renderMerge();
    } else if (el.dataset.filter === 'contains') {
      this.browse.filters.contains = el.checked;
    }
  }

  onClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = Number(el.dataset.id);
    const handlers = {
      tab: () => this.setTab(el.dataset.tab),
      'save-connection': () => this.saveConnection(),
      'add-from-analysis': () => this.addFromAnalysis(),
      'add-blank': () => this.addBlank(),
      'check-all': () => this.checkAll(),
      'send-all': () => this.sendAll(),
      'clear-sent': () => { this.rows = this.rows.filter(r => r.status !== 'sent'); this.renderCards(); },
      'remove-row': () => { this.rows = this.rows.filter(r => r.id !== Number(el.dataset.row)); this.renderCards(); },
      'open-lexeme': () => this.openLexeme(id),
      'back-to-results': () => { this.browse.detail = null; this.renderBrowseBody(); },
      'more-results': () => this.search(true),
      'save-lexeme': () => this.saveLexeme(),
      'use-tidy': () => { this.view('browse').querySelector('[data-edit="lexeme"]').value = el.dataset.value; },
      'twin-add': () => this.addTwin(),
      'twin-merge-preview': () => this.previewTwinMerge(Number(el.dataset.absorbed), Number(el.dataset.keeper), el.dataset.allowPos === '1'),
      'twin-merge-do': () => this.performTwinMerge(),
      'twin-merge-cancel': () => { this.view('browse').querySelector('[data-slot="browse-merge"]').innerHTML = ''; },
      'split-preview': () => this.previewSplit(),
      'split-do': () => this.performSplit(),
      'split-cancel': () => { this.view('browse').querySelector('[data-slot="browse-split"]').innerHTML = ''; },
      'add-translation': () => this.addTranslation(),
      'save-relation': () => this.saveRelation(id),
      'delete-relation': () => this.deleteRelation(id),
      'save-example': () => this.saveExample(id),
      'delete-example': () => this.deleteExample(id),
      'add-example': () => this.addExample(id),
      'sign-out': () => this.signOut(),
      'merge-find': () => this.loadMergeCandidates(false),
      'merge-more': () => this.loadMergeCandidates(true),
      'merge-open': () => { this.setTab('browse'); this.openLexeme(Number(el.dataset.id)); },
      'merge-inspect': () => this.inspectMerge(Number(el.dataset.absorbed), Number(el.dataset.keeper)),
      'merge-absorb': () => this.absorbEmpty(Number(el.dataset.absorbed), Number(el.dataset.keeper)),
      'merge-confirm': () => this.confirmMerge(Number(el.dataset.absorbed), Number(el.dataset.keeper)),
      'merge-cancel': () => this.closeMergeDetail(Number(el.dataset.absorbed)),
      'bulk-join': () => this.bulkJoin()
    };
    handlers[action]?.();
  }
}
