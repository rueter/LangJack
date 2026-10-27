/**
 * CoNLL-U Import panel: load an existing UD treebank, review and apply dictionary glosses sentence by
 * sentence (or for the whole file), compare against the original, revert, and export as a new file.
 * All data logic lives in services/conllu-import-service.js; this file only draws the panel and wires events.
 */

import { ENHANCE_COLUMNS, LOCKED_COLUMNS, describeGlossMapping } from '../services/conllu-enhance.js';
import { KNOWN_LANGUAGES } from '../services/analyzer-service.js';

const COLUMN_INDEX = { id: 0, form: 1, lemma: 2, upos: 3, xpos: 4, feats: 5, head: 6, deprel: 7, deps: 8, misc: 9 };
const COLUMN_HINT = {
  lemma: 'from the analyzer reading', upos: 'from the analyzer reading', xpos: 'from the analyzer reading',
  feats: 'from the analyzer reading and the grammatical morphemes of the gloss; only adds features',
  head: 'baseline guess, only for sentences without any dependencies', deprel: 'baseline guess, only for sentences without any dependencies',
  deps: 'no source available: nothing is proposed', misc: 'dictionary gloss, written with the file\'s own gloss key'
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const breakable = (value) => esc(value).replace(/\|/g, '|<wbr>'); // lets long FEATS/MISC values wrap at the bars

export class ConlluImportPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.root           container the panel draws into
   * @param {Object} options.service             conlluImportService
   * @param {Function} options.getSrcLang        () => ISO code of the language being glossed
   * @param {Function} options.showToast         (message, type) => void
   * @param {Function} options.confirmAction     (message) => boolean
   */
  constructor({ root, service, getSrcLang, showToast, confirmAction }) {
    this.root = root;
    this.service = service;
    this.getSrcLang = getSrcLang;
    this.showToast = showToast;
    this.confirmAction = confirmAction;

    this.currentId = null;
    this.currentSent = 0;
    this.editedOnly = false;
    this.showIssues = false;
    this.srcLang = '';
    this.srcLangTouched = false; // true once the user typed a language: then it is never guessed again
    this.glossLang = '';
    this.columns = new Set(['misc']); // columns the enhancement may fill; MISC only keeps the original behaviour
    this.showMapping = false;
    this.inventoryLang = 'auto'; // 'auto' = language of the text, 'none' = only what this file uses, or an inventory language code
    this.suggestions = new Map(); // `${sentIndex}:${lineIdx}:${column}` -> proposal (with .checked, .pick)
    this.fileSummary = null; // counts after a whole-file suggestion run
  }

  async init() {
    await this.service.init();
    await this.service.inventory.loadDefault(); // optional: the panel works without it (only the file's own pairs count then)
    const list = this.service.list();
    this.currentId = list.length ? list[0].importId : null;
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('change', (event) => this.onChange(event));
    this.render();
  }

  /** Called when the dialog opens, so the source language follows the workbench. */
  refreshDefaults() {
    if (!this.srcLang) this.srcLang = this.getSrcLang() || 'apu';
    this.render();
  }

  // ---- rendering -------------------------------------------------------------------------

  render() {
    const list = this.service.list();
    if (this.currentId && !list.some((it) => it.importId === this.currentId)) this.currentId = list[0]?.importId || null;
    if (!this.srcLang) this.srcLang = this.getSrcLang() || 'apu';

    const options = list.map((it) => `<option value="${esc(it.importId)}"${it.importId === this.currentId ? ' selected' : ''}>
      ${esc(it.fileName)} — ${it.sentenceCount} sentences, imported ${esc(new Date(it.importedAt).toLocaleString())}</option>`).join('');

    this.root.innerHTML = `
      <div class="ci-toolbar">
        <label class="ci-field ci-grow">Imported files
          <select data-role="file" ${list.length ? '' : 'disabled'}>${options || '<option>(none yet)</option>'}</select>
        </label>
        <input type="file" data-role="file-input" accept=".conllu,.conll,.txt,text/plain" hidden>
        <button class="btn btn-primary btn-sm" data-action="pick-file">📥 Import file…</button>
        <button class="btn btn-secondary btn-sm" data-action="remove-import" ${this.currentId ? '' : 'disabled'}
          title="Remove this import (original and edits) from this browser">🗑️ Remove</button>
      </div>
      <p class="vw-hint">The imported file is kept unchanged as the original. Edits are stored separately, and only edited
        sentences differ in the exported file.</p>
      ${this.currentId ? this.renderFile() : '<div class="vw-empty">No treebank imported yet. Choose a .conllu file to load it.</div>'}`;
  }

  renderFile() {
    const sum = this.service.summary(this.currentId);
    const conv = this.service.glossConvention(this.currentId);
    if (!this.glossLang) this.glossLang = conv.lang || 'eng';
    if (!this.srcLangTouched) {
      const fromName = sum.fileName.match(/^([a-z]{2,3})_/); // UD file names start with the language code: apu_ufpa-ud-test.conllu
      this.srcLang = fromName ? fromName[1] : (this.getSrcLang() || 'apu');
    }
    const sentences = this.service.parsed(this.currentId).sentences;
    const items = sentences.filter((s) => !this.editedOnly || this.service.isEdited(this.currentId, s.index))
      .map((s) => {
        const edited = this.service.isEdited(this.currentId, s.index);
        const active = s.index === this.currentSent ? ' ci-active' : '';
        return `<div class="ci-sent${active}" data-action="select-sent" data-index="${s.index}" title="${esc(s.text)}">
          <span class="treebank-order-badge">${s.index + 1}</span>
          <span class="ci-sent-text">${esc(s.sentId || '(no sent_id)')} · ${esc(s.text)}</span>
          ${edited ? '<span class="ci-edited" title="Edited">●</span>' : ''}</div>`;
      }).join('');

    const convText = conv.key
      ? `Gloss key in this file: <code>${esc(conv.key)}</code>${conv.mixed
        ? ` (also: ${Object.entries(conv.counts).filter(([k]) => k !== conv.key).map(([k, n]) => `<code>${esc(k)}</code> ×${n}`).join(', ')})`
        : ''} — new glosses follow <code>${esc(conv.key)}</code>.`
      : 'This file has no glosses yet; new glosses use <code>gloss[…]</code> with the language below.';

    const fs = this.fileSummary;
    const fileBar = fs ? this.renderFileSummary(fs) : '';

    return `
      <div class="ci-meta">
        <span><b>${sum.sentenceCount}</b> sentences</span>
        <span><b>${sum.editedCount}</b> edited</span>
        <span>SHA-256 <code>${esc(String(sum.hash).slice(0, 12))}</code></span>
        <span>${esc(this.service.issues(this.currentId).filter((i) => i.severity === 'error').length)} malformed rows,
          ${esc(this.service.issues(this.currentId).filter((i) => i.severity === 'warning').length)} warnings
          <a href="#" data-action="toggle-issues">${this.showIssues ? 'hide' : 'show'}</a></span>
      </div>
      ${this.showIssues ? this.renderIssues() : ''}
      <div class="ci-toolbar">
        <label class="ci-field">Language of the text
          <input type="text" data-role="src-lang" value="${esc(this.srcLang)}" size="6" title="ISO code, e.g. apu"></label>
        <label class="ci-field">Gloss language
          <input type="text" data-role="gloss-lang" value="${esc(this.glossLang)}" size="6" title="As used in the file (pt) or ISO 639-3 (por)"></label>
        <button class="btn btn-secondary btn-sm" data-action="suggest-file" title="Look up proposals for the selected columns for every sentence; nothing is written yet">🔎 Suggest for whole file</button>
        <button class="btn btn-secondary btn-sm" data-action="revert-all" ${sum.editedCount ? '' : 'disabled'}>↩ Revert all edits</button>
        <label class="ci-inline"><input type="checkbox" data-role="edited-only" ${this.editedOnly ? 'checked' : ''}> edited sentences only</label>
      </div>
      <p class="vw-hint">${convText}</p>
      ${this.renderColumnSelector()}
      ${fileBar}
      <div class="ci-main">
        <div class="ci-list">${items || '<div class="vw-empty">No sentences to show.</div>'}</div>
        <div class="ci-detail">${this.renderSentence()}</div>
      </div>
      <div class="ci-export">
        <label class="ci-field ci-grow">Export as new file
          <input type="text" data-role="export-name" value="${esc(sum.exportName)}"></label>
        <button class="btn btn-primary" data-action="export-file">💾 Download working copy</button>
        <button class="btn btn-secondary" data-action="download-original" title="The file exactly as imported">⬇ Original</button>
      </div>`;
  }

  renderColumnSelector() {
    const locked = LOCKED_COLUMNS.map((c) => `<label class="ci-inline ci-locked" title="Locked: changing ${c.toUpperCase()} would break token alignment and the sentence text.">
      <input type="checkbox" disabled> ${c.toUpperCase()} 🔒</label>`).join('');
    const boxes = ENHANCE_COLUMNS.map((c) => `<label class="ci-inline" title="${esc(COLUMN_HINT[c])}">
      <input type="checkbox" data-role="column" data-col="${c}" ${this.columns.has(c) ? 'checked' : ''}> ${c.toUpperCase()}</label>`).join('');
    const mapping = this.showMapping ? `<table class="dict-table ci-mapping"><thead><tr><th>Gloss abbreviation</th><th>Becomes in FEATS</th></tr></thead>
      <tbody>${describeGlossMapping().map((r) => `<tr><td><code>${esc(r.abbreviation)}</code></td><td>${esc(r.features)}</td></tr>`).join('')}</tbody></table>
      <p class="vw-hint">Analyzer tags use the same feature names (tag-mapper). Existing FEATS values are never changed, only missing features are added; every proposal is shown before it is applied.</p>` : '';
    return `${this.renderInventoryControl()}<div class="ci-columns"><b>Columns to enhance:</b> ${locked} ${boxes}
      <a href="#" data-action="toggle-mapping">${this.showMapping ? 'hide' : 'show'} FEATS mapping</a></div>
      <p class="vw-hint">Empty cells (<code>_</code>) are filled when you click Apply. A cell that already has a value is only changed if you tick it yourself and confirm.
      ${[...this.columns].filter((c) => c === 'deps').length ? ' DEPS has no source, so nothing is proposed for it.' : ''}</p>${mapping}`;
  }

  renderInventoryControl() {
    const inv = this.service.inventory;
    const resolved = this.service.inventoryLanguage(this.srcLang, this.inventoryLang);
    const nameOf = (code) => inv.languageName(code) !== code ? inv.languageName(code) : KNOWN_LANGUAGES[code];
    const name = (code) => (nameOf(code) ? `${nameOf(code)} (${code})` : code);
    const options = [`<option value="auto"${this.inventoryLang === 'auto' ? ' selected' : ''}>Same as language of the text</option>`,
      `<option value="none"${this.inventoryLang === 'none' ? ' selected' : ''}>None: only what this file uses</option>`,
      ...inv.languageCodes().map((c) => `<option value="${esc(c)}"${this.inventoryLang === c ? ' selected' : ''}>${esc(name(c))}</option>`)].join('');
    const info = resolved ? inv.describeLanguage(resolved) : null;
    let status;
    if (!inv.loaded) status = 'No inventory file loaded: only universal features and what this file uses are recognised.';
    else if (info) {
      status = `${esc(name(resolved))}: ${info.pairs} Feature=Value pairs from ${info.treebanks.length ? esc(info.treebanks.join(', ')) : 'the loaded docfeats.json'}.`;
      if (info.miscKeys.length) status += ` Non-UD MISC keys seen there (not part of the valid layer): ${info.miscKeys.map((k) => `<code>${esc(k)}</code>`).join(', ')}.`;
    }
    else status = `No treebank in the inventory for "${esc(this.srcLang)}": proposals are checked against the universal list, the pairs this file already uses, and the other languages of the inventory.`;
    return `<div class="ci-toolbar ci-inventory"><label class="ci-field">Feature inventory
      <select data-role="inv-lang">${options}</select></label>
      <input type="file" data-role="docfeats-input" accept=".json,application/json" hidden>
      <button class="btn btn-secondary btn-sm" data-action="load-docfeats" title="Add the documented features of a local UD checkout (tools/data/docfeats.json)">Load docfeats.json…</button></div>
      <p class="vw-hint">${status} A proposed FEATS value that is in none of these layers is marked <b>new</b> and only applied after you confirm it.</p>`;
  }

  renderIssues() {
    const issues = this.service.issues(this.currentId);
    if (!issues.length) return '<div class="vw-empty">No problems found.</div>';
    const shown = issues.slice(0, 50).map((i) => `<tr><td>${i.line}</td><td>${esc(i.severity)}</td><td>${esc(i.sentId || `sentence ${i.sentIndex + 1}`)}</td>
      <td>${esc(i.message)}</td><td><code>${esc(String(i.raw).slice(0, 60))}</code></td></tr>`).join('');
    return `<div class="ci-issues"><table class="dict-table"><thead><tr><th>Line</th><th></th><th>Sentence</th><th>Problem</th><th>Text</th></tr></thead>
      <tbody>${shown}</tbody></table>${issues.length > 50 ? `<div class="vw-hint">…and ${issues.length - 50} more. Rows with problems are kept as they are.</div>` : ''}</div>`;
  }

  renderFileSummary(fs) {
    const cols = [...this.columns].filter((c) => fs[c]);
    const rows = cols.map((c) => {
      const n = fs[c];
      return `<tr><td>${c.toUpperCase()}</td><td>${n.fill}</td><td>${n.conflict}</td><td>${n.same}</td><td>${n.none}</td><td>${n.flagged}</td>
        <td><button class="btn btn-primary btn-sm" data-action="apply-col-fills" data-col="${c}" ${n.fill ? '' : 'disabled'}>Fill ${n.fill} empty</button>
        <button class="btn btn-secondary btn-sm" data-action="apply-col-replace" data-col="${c}" ${n.conflict ? '' : 'disabled'}>Accept ${n.conflict} changes…</button></td></tr>`;
    }).join('');
    const total = cols.reduce((n, c) => n + fs[c].fill, 0);
    return `<div class="ci-filesummary"><div><b>Whole file</b>: proposals for the selected columns. Nothing has been written yet.</div>
      <table class="dict-table"><thead><tr><th>Column</th><th>Empty, can fill</th><th>Value exists, would change</th><th>Same</th><th>No source</th><th>New pair: review per sentence</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div><button class="btn btn-primary btn-sm" data-action="apply-all-fills" ${total ? '' : 'disabled'}>Fill all ${total} empty cells</button>
      <button class="btn btn-secondary btn-sm" data-action="clear-file-summary">Dismiss</button>
      <span class="vw-hint">Values that already exist are only changed by "Accept … changes" (after confirmation) or by ticking them in a sentence.</span></div></div>`;
  }

  renderSentence() {
    const parsed = this.service.parsed(this.currentId);
    const sent = parsed.sentences[this.currentSent];
    if (!sent) return '<div class="vw-empty">Select a sentence.</div>';
    const edited = this.service.isEdited(this.currentId, sent.index);
    const rows = sent.lines.map((line, lineIdx) => ({ line, lineIdx })).filter((r) => r.line.kind === 'token' || r.line.kind === 'mwt' || r.line.kind === 'malformed' || r.line.kind === 'empty');
    const fields = [...this.suggestions.values()].filter((f) => f.sentIndex === sent.index);
    const byToken = new Map(fields.map((f) => [`${f.lineIdx}:${f.column}`, f]));
    const overrides = this.service.overrides(this.currentId)[sent.index];
    const shown = ENHANCE_COLUMNS.filter((c) => this.columns.has(c));
    const showLemma = !this.columns.has('lemma');
    const width = 2 + (showLemma ? 1 : 0) + shown.length;

    const head = shown.map((c) => `<th>${c.toUpperCase()}<div class="ci-colactions">
      <a href="#" data-action="col-check" data-col="${c}" data-mode="all">all</a> · <a href="#" data-action="col-check" data-col="${c}" data-mode="none">none</a></div></th>`).join('');

    const body = rows.map(({ line, lineIdx }) => {
      if (line.kind === 'malformed') {
        return `<tr class="ci-bad"><td colspan="${width}" title="${esc(line.issue)}">⚠ malformed row kept as is: <code>${esc(line.text)}</code></td></tr>`;
      }
      const cols = line.cols;
      if (line.kind !== 'token') {
        return `<tr class="ci-muted"><td>${esc(cols[0])}</td><td>${esc(cols[1])}</td><td colspan="${width - 2}">${line.kind === 'mwt' ? 'multiword token' : 'empty node'}</td></tr>`;
      }
      const now = this.service.workingCols(this.currentId, sent.index, lineIdx);
      const cells = shown.map((c) => {
        const f = byToken.get(`${lineIdx}:${c}`);
        const changed = c === 'misc' ? Boolean(overrides && overrides.misc && overrides.misc[lineIdx])
          : Boolean(overrides && overrides.cells && overrides.cells[lineIdx] && overrides.cells[lineIdx][c]);
        let current = now[COLUMN_INDEX[c]];
        if (c === 'misc') current = current.split('|').filter((x) => /^gloss[[_]/i.test(x)).join(' ') || '—';
        return `<td class="${changed ? 'ci-changed' : ''}"><div class="ci-old"><code>${breakable(current)}</code></div>${f ? this.renderProposal(f) : ''}</td>`;
      }).join('');
      return `<tr><td>${esc(cols[0])}</td><td>${esc(cols[1])}</td>${showLemma ? `<td>${esc(now[2])}</td>` : ''}${cells}</tr>`;
    }).join('');

    const checked = fields.filter((f) => f.checked).length;
    const diff = edited ? this.renderDiff(sent.index) : '<div class="vw-hint">No edits in this sentence: it is exported exactly as in the original.</div>';
    return `
      <div class="ci-detail-head"><b>${esc(sent.sentId || `Sentence ${sent.index + 1}`)}</b>
        <span class="vw-hint">${esc(sent.text)}</span></div>
      <div class="vw-actions">
        <button class="btn btn-secondary btn-sm" data-action="suggest-sent">🔎 Suggest for this sentence</button>
        <button class="btn btn-primary btn-sm" data-action="apply-sent" ${checked ? '' : 'disabled'}>Apply ${checked} checked</button>
        <button class="btn btn-secondary btn-sm" data-action="reject-sent" ${fields.length ? '' : 'disabled'} title="Discard the proposals of this sentence; nothing is written">✗ Reject proposals</button>
        <button class="btn btn-secondary btn-sm" data-action="revert-sent" ${edited ? '' : 'disabled'}>↩ Revert sentence</button>
      </div>
      <div class="ci-tablewrap"><table class="dict-table"><thead><tr><th>ID 🔒</th><th>Form 🔒</th>${showLemma ? '<th>Lemma</th>' : ''}${head}</tr></thead>
        <tbody>${body}</tbody></table></div>
      <h5 class="ci-h">Changes against the original</h5>${diff}`;
  }

  /** One proposal inside a cell: old value is shown above it; a tick accepts it. */
  renderProposal(f) {
    const key = `${f.sentIndex}:${f.lineIdx}:${f.column}`;
    const tip = esc(`${f.source}${f.note ? ` — ${f.note}` : ''}`);
    if (f.status === 'none') return '<div class="ci-muted" title="no source for this token">no source</div>';
    if (f.status === 'same') return `<div class="ci-muted" title="${tip}">✓ already there${f.column === 'misc' && f.note ? ' (segmented)' : ''}</div>`;
    const value = f.column === 'misc' && f.candidates && f.candidates.length > 1
      ? `<select data-role="sug-pick" data-key="${esc(key)}">${f.candidates.map((c) => `<option value="${esc(c.gloss)}"${c.gloss === f.to ? ' selected' : ''}>${esc(c.gloss)}${c.via === 'analyzer' ? ' (via analyzer)' : ''}</option>`).join('')}</select>`
      : `<code>${breakable(f.to)}</code>`;
    const label = f.status === 'conflict' ? '<span class="ci-warn">changes existing value</span>' : '<span class="ci-fill">fills empty cell</span>';
    const layers = (f.pairs || []).filter((p) => p.layer !== 'file' && p.layer !== 'language' && p.layer !== 'unchecked').map((p) => {
      const cls = p.layer === 'new' ? 'ci-warn' : 'ci-muted';
      const where = p.languages.length ? `: ${esc(p.languages.slice(0, 6).join(', '))}${p.languages.length > 6 ? '…' : ''}` : '';
      return `<span class="${cls}"><code>${esc(p.item)}</code> ${p.layer === 'new' ? '<b>NEW</b> (needs confirmation)' : esc(p.label)}${where}</span>`;
    }).join('<br>');
    return `<label class="ci-inline ci-proposal" title="${tip}"><input type="checkbox" data-role="sug-check" data-key="${esc(key)}"${f.checked ? ' checked' : ''}> ${value}</label>
      <div class="ci-note">${label} · ${esc(f.source)}${f.note ? `<br>${esc(f.note)}` : ''}${layers ? `<br>${layers}` : ''}</div>`;
  }

  renderDiff(sentIndex) {
    const diff = this.service.diff(this.currentId, sentIndex);
    const changes = diff.changes.map((c) => `<tr><td>${esc(c.tokenId || '')} ${esc(c.form || '')}</td><td>${esc(c.field)}</td>
      <td>${c.from === null ? '<i>(none)</i>' : `<code>${esc(c.from)}</code>`}</td><td>${c.to === null ? '<i>(removed)</i>' : `<code>${esc(c.to)}</code>`}</td></tr>`).join('');
    const lines = diff.lines.filter((l, i, all) => l.type !== 'same' || all.slice(Math.max(0, i - 1), i + 2).some((n) => n.type !== 'same'))
      .map((l) => `<div class="ci-line ci-line-${l.type}">${l.type === 'added' ? '+' : l.type === 'removed' ? '−' : ' '} ${esc(l.text)}</div>`).join('');
    return `<table class="dict-table"><thead><tr><th>Token</th><th>Field</th><th>Original</th><th>Working copy</th></tr></thead><tbody>${changes}</tbody></table>
      <details class="ci-rawdiff"><summary>Line diff</summary><pre class="export-preview-box ci-pre">${lines}</pre></details>`;
  }

  // ---- events ----------------------------------------------------------------------------

  async onClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (target.tagName === 'A') event.preventDefault();
    try {
      switch (action) {
        case 'pick-file': this.root.querySelector('[data-role="file-input"]').click(); break;
        case 'remove-import': await this.removeImport(); break;
        case 'select-sent': this.currentSent = Number(target.dataset.index); this.render(); break;
        case 'toggle-issues': this.showIssues = !this.showIssues; this.render(); break;
        case 'suggest-sent': await this.suggestSentence(); break;
        case 'load-docfeats': this.root.querySelector('[data-role="docfeats-input"]').click(); break;
        case 'toggle-mapping': this.showMapping = !this.showMapping; this.render(); break;
        case 'reject-sent': this.rejectSentence(); break;
        case 'col-check': this.checkColumn(target.dataset.col, target.dataset.mode); break;
        case 'apply-col-fills': await this.applyFile(target.dataset.col, 'fill'); break;
        case 'apply-col-replace': await this.applyFile(target.dataset.col, 'replace'); break;
        case 'apply-all-fills': await this.applyFile(null, 'fill'); break;
        case 'suggest-file': await this.suggestFile(); break;
        case 'apply-sent': await this.applySentence(); break;
        case 'clear-file-summary': this.fileSummary = null; this.render(); break;
        case 'revert-sent': await this.revertSentence(); break;
        case 'revert-all': await this.revertAll(); break;
        case 'export-file': this.exportFile(); break;
        case 'download-original': this.downloadOriginal(); break;
        default: break;
      }
    } catch (err) {
      console.error(err);
      this.showToast(`CoNLL-U: ${err.message}`, 'error');
    }
  }

  async onChange(event) {
    const el = event.target;
    const role = el.dataset.role;
    try {
      if (role === 'file-input') {
        const file = el.files && el.files[0];
        el.value = '';
        if (file) await this.importFile(file);
      } else if (role === 'file') {
        this.currentId = el.value;
        this.currentSent = 0;
        this.suggestions.clear();
        this.fileSummary = null;
        this.glossLang = '';
        this.render();
      } else if (role === 'src-lang') {
        this.srcLang = el.value.trim().toLowerCase();
        this.srcLangTouched = true;
        this.suggestions.clear();
        this.fileSummary = null;
      } else if (role === 'gloss-lang') {
        this.glossLang = el.value.trim();
        this.suggestions.clear();
        this.fileSummary = null;
        this.render();
      } else if (role === 'edited-only') {
        this.editedOnly = el.checked;
        this.render();
      } else if (role === 'export-name') {
        el.value = await this.service.setExportName(this.currentId, el.value);
      } else if (role === 'inv-lang') {
        this.inventoryLang = el.value;
        this.suggestions.clear();
        this.fileSummary = null;
        this.render();
      } else if (role === 'docfeats-input') {
        const file = el.files && el.files[0];
        el.value = '';
        if (file) {
          const res = this.service.inventory.addDocfeats(await file.text());
          this.suggestions.clear();
          this.fileSummary = null;
          this.render();
          this.showToast(`docfeats.json: ${res.pairs} new Feature=Value pairs for ${res.languages} languages added to the inventory (this session only).`, 'success');
        }
      } else if (role === 'column') {
        if (el.checked) this.columns.add(el.dataset.col); else this.columns.delete(el.dataset.col);
        if (!this.columns.size) { this.columns.add('misc'); this.showToast('At least one column must stay selected; MISC kept.', 'info'); }
        this.suggestions.clear();
        this.fileSummary = null;
        this.render();
      } else if (role === 'sug-check') {
        const sug = this.suggestions.get(el.dataset.key);
        if (sug) sug.checked = el.checked;
      } else if (role === 'sug-pick') {
        const sug = this.suggestions.get(el.dataset.key);
        if (sug) sug.to = el.value;
      }
    } catch (err) {
      console.error(err);
      this.showToast(`CoNLL-U: ${err.message}`, 'error');
    }
  }

  // ---- actions ---------------------------------------------------------------------------

  async importFile(file) {
    const text = await file.text();
    const res = await this.service.importText(text, file.name);
    this.currentId = res.importId;
    this.currentSent = 0;
    this.suggestions.clear();
    this.fileSummary = null;
    this.glossLang = '';
    this.render();
    const s = res.summary;
    if (res.duplicate) {
      this.showToast(`"${file.name}" was already imported (same content); opened the existing copy with its edits.`, 'info');
    } else {
      this.showToast(`Imported ${s.sentenceCount} sentences from ${file.name}${s.issueCount ? ` (${s.issueCount} issue${s.issueCount > 1 ? 's' : ''}, rows kept as they are)` : ''}.`, 'success');
    }
  }

  async removeImport() {
    if (!this.currentId) return;
    const sum = this.service.summary(this.currentId);
    const ok = this.confirmAction(`Remove "${sum.fileName}" from this browser?\n\nThe original copy and ${sum.editedCount} edited sentence(s) kept here will be deleted. Your own file on disk is not affected. Download the working copy first if you want to keep your edits.`);
    if (!ok) return;
    await this.service.removeImport(this.currentId);
    this.currentId = null;
    this.suggestions.clear();
    this.render();
    this.showToast('Import removed.', 'info');
  }

  _options() {
    return { srcLang: this.srcLang || this.getSrcLang() || 'apu', tgtLang: this.glossLang || undefined, columns: [...this.columns], inventoryLang: this.inventoryLang };
  }

  _remember(list) {
    for (const f of list) {
      f.checked = f.status === 'fill' && !f.needsConfirm; // changes to existing values and new pairs are never pre-checked
      this.suggestions.set(`${f.sentIndex}:${f.lineIdx}:${f.column}`, f);
    }
  }

  _dropSentence(index) {
    for (const key of [...this.suggestions.keys()]) if (key.startsWith(`${index}:`)) this.suggestions.delete(key);
  }

  /** Loads the analyzer for the text language when an analyzer-based column is selected; says so if there is none. */
  async _prepare() {
    const needs = ['lemma', 'upos', 'xpos', 'feats'].some((c) => this.columns.has(c));
    const lang = this.srcLang || this.getSrcLang() || 'apu';
    if (!needs || await this.service.prepareLanguage(lang)) return;
    this.showToast(`No analyzer model for "${lang}" is available here: LEMMA, UPOS, XPOS and FEATS are proposed from glosses only. Check the language of the text, or load the model in the workbench.`, 'info');
  }

  async suggestSentence(quiet = false) {
    await this._prepare();
    const list = this.service.suggestEnhancements(this.currentId, this.currentSent, this._options());
    this._dropSentence(this.currentSent);
    this._remember(list);
    this.render();
    if (quiet) return;
    const n = list.filter((f) => f.status === 'fill').length;
    const c = list.filter((f) => f.status === 'conflict').length;
    this.showToast(n || c ? `${n} empty cell${n === 1 ? '' : 's'} can be filled, ${c} existing value${c === 1 ? '' : 's'} would change. Tick what you want and click Apply.` : 'Nothing to propose for this sentence.', n || c ? 'success' : 'info');
  }

  async suggestFile() {
    await this._prepare();
    const list = this.service.suggestEnhancements(this.currentId, null, this._options());
    this.suggestions.clear();
    this._remember(list);
    const summary = {};
    for (const c of this.columns) summary[c] = { fill: 0, conflict: 0, same: 0, none: 0, flagged: 0 };
    for (const f of list) {
      if (f.needsConfirm && (f.status === 'fill' || f.status === 'conflict')) summary[f.column].flagged++;
      else summary[f.column][f.status]++;
    }
    this.fileSummary = summary;
    this.render();
  }

  _describe(f) {
    return `  ${f.form} ${f.column.toUpperCase()}${f.key ? ` (${f.key})` : ''}: ${f.from === null ? '(none)' : f.from}  →  ${f.to}`;
  }

  /**
   * Asks before any existing value is changed and before a Feature=Value (or UPOS / DEPREL) that is in no
   * inventory layer is added. Returns the fields to apply (flagged `overwrite` / `confirmNew`), or null if declined.
   */
  _confirmChanges(fields) {
    const changes = fields.filter((f) => f.status === 'conflict');
    if (changes.length) {
      const shown = changes.slice(0, 15).map((f) => this._describe(f)).join('\n');
      const more = changes.length > 15 ? `\n  …and ${changes.length - 15} more` : '';
      if (!this.confirmAction(`Change ${changes.length} existing value${changes.length > 1 ? 's' : ''}?\n\n${shown}${more}\n\nThe original file keeps the old values; you can revert a sentence at any time.`)) return null;
      changes.forEach((f) => { f.overwrite = true; });
    }
    const fresh = fields.filter((f) => f.needsConfirm);
    if (fresh.length) {
      const pairs = [...new Set(fresh.flatMap((f) => f.newPairs))];
      const lang = this.service.inventoryLanguage(this.srcLang, this.inventoryLang);
      if (!this.confirmAction(`Add ${pairs.length} value${pairs.length > 1 ? 's' : ''} that ${pairs.length > 1 ? 'are' : 'is'} not in the inventory${lang ? ` for ${lang}` : ''}, nor used in this file, nor in any other language?\n\n  ${pairs.slice(0, 15).join('\n  ')}${pairs.length > 15 ? `\n  …and ${pairs.length - 15} more` : ''}\n\nCheck them against the language's UD documentation first.`)) return null;
      fresh.forEach((f) => { f.confirmNew = true; });
    }
    return fields;
  }

  async _apply(fields) {
    const res = await this.service.applyEnhancements(this.currentId, fields);
    const parts = [`${res.written} filled`, `${res.replaced} changed`];
    if (res.skipped) parts.push(`${res.skipped} skipped`);
    if (res.stale) parts.push(`${res.stale} out of date`);
    if (res.unconfirmed) parts.push(`${res.unconfirmed} left out (new pair not confirmed)`);
    this.showToast(`Applied: ${parts.join(', ')}.`, res.stale ? 'info' : 'success');
    return res;
  }

  async applySentence() {
    const fields = [...this.suggestions.values()].filter((f) => f.sentIndex === this.currentSent && f.checked);
    if (!fields.length) { this.showToast('Nothing ticked.', 'info'); return; }
    const confirmed = this._confirmChanges(fields);
    if (!confirmed) { fields.filter((f) => f.status === 'conflict').forEach((f) => { f.checked = false; }); this.render(); return; }
    await this._apply(confirmed);
    await this.suggestSentence(true);
  }

  rejectSentence() {
    this._dropSentence(this.currentSent);
    this.render();
    this.showToast('Proposals rejected; nothing was written.', 'info');
  }

  checkColumn(column, mode) {
    for (const f of this.suggestions.values()) {
      if (f.sentIndex === this.currentSent && f.column === column && (f.status === 'fill' || f.status === 'conflict')) f.checked = mode === 'all';
    }
    this.render();
  }

  /** File-wide apply for one column ('fill' = empty cells only, 'replace' = changes to existing values) or all fills. */
  async applyFile(column, kind) {
    const wanted = kind === 'replace' ? 'conflict' : 'fill';
    const fields = [...this.suggestions.values()].filter((f) => f.status === wanted && !f.needsConfirm && (!column || f.column === column));
    if (!fields.length) return;
    const sentences = new Set(fields.map((f) => f.sentIndex)).size;
    const what = column ? column.toUpperCase() : 'the selected columns';
    if (kind !== 'replace' && !this.confirmAction(`Fill ${fields.length} empty cell${fields.length > 1 ? 's' : ''} of ${what} in ${sentences} sentence(s)?\n\nCells that already have a value are not touched. You can review each sentence and revert it.`)) return;
    const confirmed = this._confirmChanges(fields);
    if (!confirmed) return;
    await this._apply(confirmed);
    await this.suggestFile();
  }

  async revertSentence() {
    const sent = this.service.parsed(this.currentId).sentences[this.currentSent];
    if (!this.confirmAction(`Revert ${sent.sentId || `sentence ${sent.index + 1}`} to the original?`)) return;
    await this.service.revertSentence(this.currentId, this.currentSent);
    for (const key of [...this.suggestions.keys()]) if (key.startsWith(`${this.currentSent}:`)) this.suggestions.delete(key);
    this.render();
    this.showToast('Sentence reverted to the original.', 'info');
  }

  async revertAll() {
    const sum = this.service.summary(this.currentId);
    if (!this.confirmAction(`Revert all ${sum.editedCount} edited sentence(s) to the original?`)) return;
    await this.service.revertAll(this.currentId);
    this.suggestions.clear();
    this.fileSummary = null;
    this.render();
    this.showToast('All edits reverted.', 'info');
  }

  _download(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportFile() {
    const input = this.root.querySelector('[data-role="export-name"]');
    const name = this.service.safeExportName(this.currentId, input ? input.value : '');
    this._download(this.service.exportText(this.currentId), name);
    const sum = this.service.summary(this.currentId);
    this.showToast(`Downloaded ${name} (${sum.editedCount} of ${sum.sentenceCount} sentences edited).`, 'success');
  }

  downloadOriginal() {
    const sum = this.service.summary(this.currentId);
    this._download(this.service.originalText(this.currentId), sum.fileName);
    this.showToast(`Downloaded the original ${sum.fileName}.`, 'info');
  }
}
