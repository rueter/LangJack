/**
 * CoNLL-U Import panel: load an existing UD treebank, review and apply dictionary glosses sentence by
 * sentence (or for the whole file), compare against the original, revert, and export as a new file.
 * All data logic lives in services/conllu-import-service.js; this file only draws the panel and wires events.
 */

import { ENHANCE_COLUMNS, LOCKED_COLUMNS, describeGlossMapping } from '../services/conllu-enhance.js';
import { KNOWN_LANGUAGES } from '../services/analyzer-service.js';
import { ManualEditError } from '../services/conllu-import-service.js';

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
const SOURCE_LABEL = { manual: 'by hand', analyzer: 'analyzer reading', gloss: 'gloss', dictionary: 'dictionary', 'gloss + analyzer': 'gloss + analyzer reading' };
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
    this.choiceOnly = false; // list only sentences with a token that needs review (several readings, or a lemma marked uncertain)
    this.editing = new Set(); // `${sentIndex}:${lineIdx}` of the tokens whose editor is open
    this.featDraft = new Map(); // `${sentIndex}:${lineIdx}` -> feature picked in the add control (to offer its values)
    this.focusLine = null; // line index of the token the user is working on (highlighted, scrolled into view)
    this.xposStyle = 'short'; // what XPOS receives from a reading: 'short' POS tag or the 'full' analyzer tag string
    this.analyzerInfo = null; // which analyzer build produced the readings (name, origin)
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
    this._refreshAnalyzerInfo();
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
    const needsChoice = this._sentencesNeedingReview();
    const items = sentences.filter((s) => (!this.editedOnly || this.service.isEdited(this.currentId, s.index)) && (!this.choiceOnly || needsChoice.has(s.index)))
      .map((s) => {
        const edited = this.service.isEdited(this.currentId, s.index);
        const marks = `${needsChoice.has(s.index) ? '<span class="ci-warn" title="Needs review: a token has several analyzer readings, or its lemma is marked uncertain or undecided">?</span>' : ''}${this.service.readingChoices(this.currentId, s.index).length ? '<span class="ci-edited" title="You picked a reading here">◆</span>' : ''}`;
        const active = s.index === this.currentSent ? ' ci-active' : '';
        return `<div class="ci-sent${active}" data-action="select-sent" data-index="${s.index}" title="${esc(s.text)}">
          <span class="treebank-order-badge">${s.index + 1}</span>
          <span class="ci-sent-text">${esc(s.sentId || '(no sent_id)')} · ${esc(s.text)}</span>
          ${marks}${edited ? '<span class="ci-edited" title="Edited">●</span>' : ''}</div>`;
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
        <label class="ci-inline" title="Tokens with several readings (after a Suggest run) or a lemma you marked uncertain or undecided"><input type="checkbox" data-role="choice-only" ${this.choiceOnly ? 'checked' : ''}> needing review only</label>
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
        <label class="ci-inline ci-grow" title="Off by default: the exported file then holds exactly your edits and nothing else"><input type="checkbox" data-role="export-uncertainty" ${this.service.exportOptions(this.currentId).recordUncertainty ? 'checked' : ''}>
          also record uncertain lemmas in MISC (<code>LemmaStatus=</code>, <code>AltLemma=</code>) — optional, off by default</label>
        <label class="ci-inline ci-grow" title="Off by default. Written only for tokens whose values were applied from the reading you chose."><input type="checkbox" data-role="export-analysis" ${this.service.exportOptions(this.currentId).recordAnalysis ? 'checked' : ''}>
          also record the chosen analysis in MISC (<code>Analysis=…</code>) — optional, off by default</label>
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
    return `${this.renderInventoryControl()}${this.renderAnalyzerLine()}<div class="ci-columns"><b>Columns to enhance:</b> ${locked} ${boxes}
      <a href="#" data-action="toggle-mapping">${this.showMapping ? 'hide' : 'show'} FEATS mapping</a></div>
      <p class="vw-hint">Empty cells (<code>_</code>) are filled when you click Apply. A cell that already has a value is only changed if you tick it yourself and confirm.
      ${[...this.columns].filter((c) => c === 'deps').length ? ' DEPS has no source, so nothing is proposed for it.' : ''}</p>${mapping}`;
  }

  /** Which analyzer build the readings come from, and what XPOS receives from a chosen reading. */
  renderAnalyzerLine() {
    const a = this.analyzerInfo;
    const text = a
      ? `Analyzer for <b>${esc(a.lang)}</b>: <b>${esc(a.name)}</b> <span class="ci-muted">(${esc(a.origin)}${a.savedAt ? `, saved ${esc(new Date(a.savedAt).toLocaleString())}` : ''})</span>`
      : 'No analyzer model for this language is loaded: LEMMA, UPOS, XPOS and FEATS cannot be proposed from the analyzer.';
    return `<p class="vw-hint ci-analyzer">${text}
      <label class="ci-inline" title="What the XPOS cell receives when a reading is used. A non-empty XPOS is never replaced without your confirmation.">XPOS gets
        <select data-role="xpos-style"><option value="short"${this.xposStyle === 'short' ? ' selected' : ''}>the short POS tag (N)</option>
          <option value="full"${this.xposStyle === 'full' ? ' selected' : ''}>the full analyzer tag string</option></select></label></p>`;
  }

  async _refreshAnalyzerInfo() {
    const lang = this.srcLang || this.getSrcLang() || 'apu';
    try {
      await this.service.prepareLanguage(lang);
      this.analyzerInfo = await this.service.analyzerInfo(lang);
    } catch (e) {
      this.analyzerInfo = null;
    }
    this.render();
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

  /** Sentences that have a token with several readings and no choice yet (from the current proposals). */
  _sentencesNeedingChoice() {
    const set = new Set();
    for (const f of this.suggestions.values()) if (f.needsChoice) set.add(f.sentIndex);
    return set;
  }

  /** Tokens to come back to: several readings without a choice (current proposals) or a lemma marked uncertain/undecided. */
  _reviewTargets() {
    const seen = new Map();
    for (const f of this.suggestions.values()) if (f.needsChoice) seen.set(`${f.sentIndex}:${f.lineIdx}`, [f.sentIndex, f.lineIdx]);
    for (const r of this.service.reviewTokens(this.currentId)) seen.set(`${r.sentIndex}:${r.lineIdx}`, [r.sentIndex, r.lineIdx]);
    return [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  _sentencesNeedingReview() {
    return new Set(this._reviewTargets().map((t) => t[0]));
  }

  renderFileSummary(fs) {
    const cols = [...this.columns].filter((c) => fs[c]);
    const rows = cols.map((c) => {
      const n = fs[c];
      return `<tr><td>${c.toUpperCase()}</td><td>${n.fill}</td><td>${n.conflict}</td><td>${n.same}</td><td>${n.none}</td><td>${n.flagged}</td><td>${n.choice}</td>
        <td><button class="btn btn-primary btn-sm" data-action="apply-col-fills" data-col="${c}" ${n.fill ? '' : 'disabled'}>Fill ${n.fill} empty</button>
        <button class="btn btn-secondary btn-sm" data-action="apply-col-replace" data-col="${c}" ${n.conflict ? '' : 'disabled'}>Accept ${n.conflict} changes…</button></td></tr>`;
    }).join('');
    const total = cols.reduce((n, c) => n + fs[c].fill, 0);
    const ambiguous = new Set([...this.suggestions.values()].filter((f) => f.needsChoice).map((f) => `${f.sentIndex}:${f.lineIdx}`)).size;
    return `<div class="ci-filesummary"><div><b>Whole file</b>: proposals for the selected columns. Nothing has been written yet.</div>
      <table class="dict-table"><thead><tr><th>Column</th><th>Empty, can fill</th><th>Value exists, would change</th><th>Same</th><th>No source</th><th>New pair: review per sentence</th><th>Several readings: needs your choice</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div><button class="btn btn-primary btn-sm" data-action="apply-all-fills" ${total ? '' : 'disabled'}>Fill all ${total} empty cells</button>
      <button class="btn btn-secondary btn-sm" data-action="clear-file-summary">Dismiss</button>
      ${ambiguous ? `<button class="btn btn-secondary btn-sm" data-action="next-ambiguous" title="Jump to the next token whose analyzer readings you have to choose between">Next token needing a choice ▶</button>
      <span class="ci-warn"><b>${ambiguous}</b> token${ambiguous === 1 ? ' has' : 's have'} several readings. They are not filled in bulk: choose a reading in the sentence, or tick the default.</span>` : ''}
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
    const readingOf = new Map(); // lineIdx -> { reading, needsChoice }
    for (const f of fields) if (f.reading && (f.reading.alternatives || f.reading.choice) && !readingOf.has(f.lineIdx)) readingOf.set(f.lineIdx, f);
    const overrides = this.service.overrides(this.currentId)[sent.index];
    const needsReading = ['lemma', 'upos', 'xpos', 'feats'].some((c) => this.columns.has(c));
    // the XPOS cell hosts the reading dropdown, so it is shown whenever an analyzer-based column is selected
    const shown = ENHANCE_COLUMNS.filter((c) => this.columns.has(c) || (c === 'xpos' && needsReading));
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
        const select = c === 'xpos' && readingOf.has(lineIdx) ? this.renderReadingSelect(sent.index, lineIdx, readingOf.get(lineIdx)) : '';
        return `<td class="${changed ? 'ci-changed' : ''}"><div class="ci-old"><code>${breakable(current)}</code></div>${select}${f ? this.renderProposal(f) : ''}</td>`;
      }).join('');
      const picker = '';
      const focus = lineIdx === this.focusLine ? ' class="ci-focus"' : '';
      const open = this.editing.has(`${sent.index}:${lineIdx}`);
      const editedHere = this.service.editedFields(this.currentId, sent.index, lineIdx);
      const hasNote = this.service.tokenNote(this.currentId, sent.index, lineIdx).lemmaStatus;
      const editBtn = `<button class="ci-edit-btn${open ? ' ci-edit-on' : ''}" data-action="toggle-edit" data-sent="${sent.index}" data-line="${lineIdx}" title="Edit this token by hand: FEATS pairs, UPOS, DEPREL, LEMMA, XPOS, MISC">✎</button>`;
      const editor = open ? `<tr class="ci-editor"><td colspan="${width}">${this.renderEditor(sent.index, lineIdx)}</td></tr>` : '';
      return `<tr${focus}><td>${esc(cols[0])} ${editBtn}${editedHere.cells.length || editedHere.misc.length ? '<span class="ci-edited" title="Edited">●</span>' : ''}${hasNote ? `<span class="ci-warn" title="Lemma ${esc(hasNote)}">≈</span>` : ''}</td><td class="ci-form">${esc(cols[1])}</td>${showLemma ? `<td><span class="ci-muted">file says</span> ${esc(cols[2])}${now[2] !== cols[2] ? ` <span class="ci-muted">· now</span> <b>${esc(now[2])}</b>` : ''}</td>` : ''}${cells}</tr>${picker}${editor}`;
    }).join('');

    const checked = fields.filter((f) => f.checked).length;
    const hasChoices = this.service.readingChoices(this.currentId, sent.index).length > 0;
    const hasNotes = this.service.sentenceNotes(this.currentId, sent.index).length > 0;
    const diff = edited || hasChoices || hasNotes ? this.renderDiff(sent.index) : '<div class="vw-hint">No edits in this sentence: it is exported exactly as in the original.</div>';
    return `
      <div class="ci-detail-head"><b>${esc(sent.sentId || `Sentence ${sent.index + 1}`)}</b>
        <span class="vw-hint">${esc(sent.text)}</span></div>
      <div class="vw-actions">
        <button class="btn btn-secondary btn-sm" data-action="suggest-sent">🔎 Suggest for this sentence</button>
        <button class="btn btn-primary btn-sm" data-action="apply-sent" ${checked ? '' : 'disabled'}>Apply ${checked} checked</button>
        <button class="btn btn-secondary btn-sm" data-action="reject-sent" ${fields.length ? '' : 'disabled'} title="Discard the proposals of this sentence; nothing is written">✗ Reject proposals</button>
        <button class="btn btn-secondary btn-sm" data-action="revert-sent" ${edited || hasChoices ? '' : 'disabled'}>↩ Revert sentence</button>
        <button class="btn btn-secondary btn-sm" data-action="next-ambiguous" ${this._reviewTargets().length ? '' : 'disabled'} title="Jump to the next token that needs review: several readings to choose between, or a lemma marked uncertain">Next token needing review ▶</button>
      </div>
      <div class="ci-tablewrap"><table class="dict-table"><thead><tr><th>ID 🔒</th><th>Form 🔒</th>${showLemma ? '<th>Lemma</th>' : ''}${head}</tr></thead>
        <tbody>${body}</tbody></table></div>
      <h5 class="ci-h">Changes against the original</h5>${diff}`;
  }

  /** "analyzer reading: awinhitxi+N… · 27/10/2026" or "by hand · …": why a value is there. */
  _prov(entry) {
    if (!entry) return '';
    const label = SOURCE_LABEL[entry.source] || entry.source;
    const when = entry.at ? ` · ${new Date(entry.at).toLocaleDateString()}` : '';
    return `${label}${entry.detail ? `: ${entry.detail}` : ''}${when}`;
  }

  _inv() {
    return { srcLang: this.srcLang || this.getSrcLang() || 'apu', inventoryLang: this.inventoryLang };
  }

  /** Lemma status select and the alternatives considered: shared by the picker and the editor. */
  renderLemmaNote(sentIndex, lineIdx) {
    const note = this.service.tokenNote(this.currentId, sentIndex, lineIdx);
    const data = `data-sent="${sentIndex}" data-line="${lineIdx}"`;
    const alts = note.alternatives.map((a) => `<span class="ci-chip"><code>${esc(a)}</code><button class="ci-chip-x" data-action="alt-remove" ${data} data-lemma="${esc(a)}" title="Forget this alternative">✕</button></span>`).join('');
    return `<div class="ci-lemma-note"><label class="ci-inline" title="The lemma is your hypothesis: say so if you are not sure. Optional; only written to the file if you turn that option on.">Lemma is
        <select data-role="lemma-status" ${data}>
          <option value=""${note.lemmaStatus ? '' : ' selected'}>decided</option>
          <option value="uncertain"${note.lemmaStatus === 'uncertain' ? ' selected' : ''}>uncertain</option>
          <option value="undecided"${note.lemmaStatus === 'undecided' ? ' selected' : ''}>undecided</option></select></label>
      <span class="ci-muted">alternatives considered:</span> ${alts || '<span class="ci-muted">none</span>'}
      <input type="text" data-role="alt-input" ${data} size="12" placeholder="another lemma">
      <button class="btn btn-secondary btn-sm" data-action="alt-add" ${data}>Add</button></div>`;
  }

  /**
   * The dropdown in the XPOS cell: the analyzer's readings of the FORM by their tag strings (as emitted), plain
   * readings (no Der, no Cmp) first and derived or compound ones in a second group. Picking one makes that single
   * reading supply LEMMA, UPOS, XPOS and FEATS; the default (features the plain readings share) is only a
   * pre-selection and an explicit choice always wins and is kept.
   */
  renderReadingSelect(sentIndex, lineIdx, f) {
    const r = f.reading;
    const data = `data-role="reading-pick" data-sent="${sentIndex}" data-line="${lineIdx}"`;
    const nDefault = r.candidates.filter((c) => c.inDefault).length;
    const label = (c) => `${c.tagString} · ${c.lemma} · ${c.upos} · ${c.feats}`;
    const option = (c) => `<option value="${esc(c.raw)}"${r.choice === c.raw ? ' selected' : ''} title="${esc(c.raw)}">${esc(label(c))}${c.inDefault ? '  ✓ default' : ''}</option>`;
    const plain = r.candidates.filter((c) => c.group === 'plain');
    const other = r.candidates.filter((c) => c.group === 'other');
    const defaultText = `Default: shared features of ${nDefault} reading${nDefault > 1 ? 's' : ''}${r.ambiguous ? ' — needs your choice' : ''}`;
    const sel = r.choice ? r.candidates.find((c) => c.raw === r.choice) : null;
    const status = sel
      ? `<span class="ci-fill">chosen by you</span> <a href="#" data-action="reading-reset" data-sent="${sentIndex}" data-line="${lineIdx}">reset to default</a>`
      : (r.ambiguous ? '<span class="ci-warn"><b>needs your choice</b></span>' : '<span class="ci-muted">default is clear; other readings exist</span>');
    const detail = sel
      ? `lemma <b>${esc(sel.lemma)}</b> · UPOS <b>${esc(sel.upos)}</b> · XPOS <b>${esc(this.xposStyle === 'full' ? sel.tagString : (sel.xpos || '—'))}</b> · FEATS <code>${breakable(sel.feats)}</code>`
      : `FEATS <code>${breakable(r.sharedFeats)}</code> <span class="ci-muted">(${esc(r.defaultReason || 'all readings')})</span>`;
    return `<div class="ci-xpos-pick" title="Readings of the form, by the analyzer's tags. The word form is primary; the lemma is a hypothesis.">
      <select ${data}><option value=""${r.choice ? '' : ' selected'}>${esc(defaultText)}</option>
        <optgroup label="Plain readings (no Der, no Cmp)">${plain.map(option).join('')}</optgroup>
        ${other.length ? `<optgroup label="Derived or compound readings">${other.map(option).join('')}</optgroup>` : ''}</select>
      <div class="ci-note">${status}<br>${detail}</div></div>`;
  }

  /** Hand-editing of one token: FEATS chips, UPOS / DEPREL / LEMMA / XPOS / HEAD / DEPS fields, MISC chips; ID and FORM are locked. */
  renderEditor(sentIndex, lineIdx) {
    const id = this.currentId;
    const key = `${sentIndex}:${lineIdx}`;
    const data = `data-sent="${sentIndex}" data-line="${lineIdx}"`;
    const opts = this._inv();
    const orig = this.service.parsed(id).sentences[sentIndex].lines[lineIdx].cols;
    const now = this.service.workingCols(id, sentIndex, lineIdx);
    const edited = this.service.editedFields(id, sentIndex, lineIdx);
    const prov = this.service.provenance(id, sentIndex, lineIdx);

    const field = (col, listId = null) => {
      const idx = COLUMN_INDEX[col];
      const changed = edited.cells.includes(col);
      const why = changed ? this._prov(prov[col]) || 'edited' : 'original';
      return `<label class="ci-ed-field">${col.toUpperCase()}
        <input type="text" data-role="cell-edit" ${data} data-col="${col}" value="${esc(now[idx])}"${listId ? ` list="${listId}"` : ''}>
        <span class="ci-prov">${esc(why)}${changed ? ` · <a href="#" data-action="revert-cell" ${data} data-col="${col}" title="Original: ${esc(orig[idx])}">↩ back to ${esc(orig[idx])}</a>` : ''}</span></label>`;
    };

    const pairs = this.service.featsPairs(id, sentIndex, lineIdx, opts);
    const chips = pairs.map((p) => {
      const cls = p.layer === 'new' ? ' ci-chip-new' : '';
      const tip = [p.label, p.languages.length ? `used in ${p.languages.slice(0, 6).join(', ')}` : '', p.inOriginal ? 'in the original file' : 'not in the original', p.provenance ? this._prov(p.provenance) : ''].filter(Boolean).join(' — ');
      return `<span class="ci-chip${cls}${p.inOriginal ? '' : ' ci-chip-added'}" title="${esc(tip)}"><code>${esc(p.pair)}</code>${p.layer === 'new' ? '<b class="ci-warn">new</b>' : ''}<button class="ci-chip-x" data-action="feat-remove" ${data} data-key="${esc(p.key)}" title="Remove ${esc(p.key)}">✕</button></span>`;
    }).join('') || '<span class="ci-muted">no features (<code>_</code>)</span>';
    const keys = this.service.featureChoices(id, opts);
    const draft = this.featDraft.get(key) || '';
    const vals = draft ? this.service.valueChoices(id, draft, opts) : { own: [], other: [] };
    const opt = (list, sel) => list.map((v) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
    const featAdd = `<div class="ci-add"><select data-role="feat-key" ${data}><option value="">Feature…</option>
        <optgroup label="This language, this file, universal">${opt(keys.own, draft)}</optgroup>
        ${keys.other.length ? `<optgroup label="Used in other languages">${opt(keys.other, draft)}</optgroup>` : ''}</select>
      <select data-role="feat-val" ${data}><option value="">Value…</option>
        <optgroup label="Known for this language">${opt(vals.own)}</optgroup>
        ${vals.other.length ? `<optgroup label="Used in other languages">${opt(vals.other)}</optgroup>` : ''}</select>
      <input type="text" data-role="feat-custom" ${data} size="18" placeholder="or type Feature=Value">
      <button class="btn btn-secondary btn-sm" data-action="feat-add" ${data}>Add feature</button></div>`;

    const segs = this.service.miscSegments(id, sentIndex, lineIdx);
    const miscChips = segs.map((m) => `<span class="ci-chip${m.inOriginal ? '' : ' ci-chip-added'}" title="${esc(m.inOriginal ? 'in the original file' : (m.provenance ? this._prov(m.provenance) : 'not in the original'))}"><code>${breakable(m.value === '' ? m.key : `${m.key}=${m.value}`)}</code><button class="ci-chip-x" data-action="misc-remove" ${data} data-key="${esc(m.key)}" title="Remove ${esc(m.key)}">✕</button></span>`).join('') || '<span class="ci-muted">no MISC (<code>_</code>)</span>';
    const miscAdd = `<div class="ci-add"><input type="text" data-role="misc-key" ${data} size="12" placeholder="Key"><input type="text" data-role="misc-val" ${data} size="16" placeholder="value"><button class="btn btn-secondary btn-sm" data-action="misc-add" ${data}>Add MISC</button></div>`;

    const anyEdit = edited.cells.length || edited.misc.length;
    return `<div class="ci-ed"><div class="ci-ed-head"><b>${esc(orig[1])}</b> (ID ${esc(orig[0])}) <span class="ci-muted">ID and FORM are locked. Everything below is written to the working copy at once; the original file is never touched, and each edit can be taken back.</span>
        ${anyEdit ? `<button class="btn btn-secondary btn-sm" data-action="revert-token" ${data}>↩ Revert this token to the original</button>` : ''}</div>
      <div class="ci-ed-grid">${field('lemma')}${field('upos', 'ci-dl-upos')}${field('xpos')}${field('head')}${field('deprel', 'ci-dl-deprel')}${field('deps')}</div>
      <div class="ci-ed-block"><b>Lemma</b> <span class="ci-muted">(the form is primary; the lemma is your hypothesis. File says: <code>${esc(orig[2])}</code>)</span>${this._analyzerLemmas(sentIndex, lineIdx, data)}${this.renderLemmaNote(sentIndex, lineIdx)}</div>
      <div class="ci-ed-block"><b>FEATS</b> <span class="ci-muted">${esc(prov.feats ? this._prov(prov.feats) : (edited.cells.includes('feats') ? 'edited' : 'original'))}</span>${edited.cells.includes('feats') ? ` · <a href="#" data-action="revert-cell" ${data} data-col="feats" title="Original: ${esc(orig[5])}">↩ back to ${esc(orig[5])}</a>` : ''}
        <div class="ci-chips">${chips}</div>${featAdd}</div>
      <div class="ci-ed-block"><b>MISC</b>${edited.misc.length ? ` <span class="ci-muted">edited keys:</span> ${edited.misc.map((k) => `<a href="#" data-action="revert-misc" ${data} data-key="${esc(k)}" title="Take this key back to the original">↩ ${esc(k)}</a>`).join(' · ')}` : ''}
        <div class="ci-chips">${miscChips}</div>${miscAdd}</div>
      <datalist id="ci-dl-upos">${this._labelOptions('upos', opts)}</datalist><datalist id="ci-dl-deprel">${this._labelOptions('deprel', opts)}</datalist></div>`;
  }

  /** Lemmas the analyzer offers for this token (from the current proposals), each one click away from "alternative". */
  _analyzerLemmas(sentIndex, lineIdx, data) {
    const f = [...this.suggestions.values()].find((x) => x.sentIndex === sentIndex && x.lineIdx === lineIdx && x.reading);
    if (!f) return '';
    const lemmas = [...new Set(f.reading.candidates.map((c) => c.lemma))];
    return `<div class="ci-lemma-note"><span class="ci-muted">analyzer lemmas:</span> ${lemmas.map((l) => `<button class="btn btn-secondary btn-sm" data-action="alt-add" ${data} data-lemma="${esc(l)}" title="Remember ${esc(l)} as an alternative without choosing it">+ ${esc(l)}</button>`).join(' ')}</div>`;
  }

  _labelOptions(kind, opts) {
    const c = this.service.labelChoices(this.currentId, kind, opts);
    return [...c.own, ...c.other].map((v) => `<option value="${esc(v)}">`).join('');
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
    const choices = diff.choices.map((c) => `<tr><td>${esc(c.tokenId)} ${esc(c.form)}</td><td>reading choice</td><td><i>(default rule)</i></td><td><code>${esc(c.raw)}</code></td></tr>`).join('');
    const notes = diff.notes.map((n) => `<tr><td>${esc(n.tokenId)} ${esc(n.form)}</td><td>lemma note</td><td><i>(none)</i></td><td>${esc(n.lemmaStatus || '')}${n.alternatives.length ? ` · also considered ${esc(n.alternatives.join(', '))}` : ''}</td></tr>`).join('');
    return `<table class="dict-table"><thead><tr><th>Token</th><th>Field</th><th>Original</th><th>Working copy</th></tr></thead><tbody>${choices}${changes}${notes}</tbody></table>
      ${diff.notes.length ? '<div class="vw-hint">Lemma notes are written to the exported file only if you turn on "also record uncertain lemmas in MISC".</div>' : ''}
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
        case 'next-ambiguous': this.nextAmbiguous(); break;
        case 'toggle-edit': this.toggleEdit(target.dataset); break;
        case 'feat-add': await this.featAdd(target); break;
        case 'feat-remove': await this.featRemove(target.dataset); break;
        case 'misc-add': await this.miscAdd(target); break;
        case 'misc-remove': await this.miscRemove(target.dataset); break;
        case 'revert-cell': await this.revertCell(target.dataset); break;
        case 'revert-misc': await this.revertMisc(target.dataset); break;
        case 'revert-token': await this.revertToken(target.dataset); break;
        case 'alt-add': await this.altAdd(target); break;
        case 'alt-remove': await this.altRemove(target.dataset); break;
        case 'reading-reset': await this.pickReading(Number(target.dataset.sent), Number(target.dataset.line), null); break;
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
        this._refreshAnalyzerInfo();
        this.suggestions.clear();
        this.fileSummary = null;
      } else if (role === 'gloss-lang') {
        this.glossLang = el.value.trim();
        this.suggestions.clear();
        this.fileSummary = null;
        this.render();
      } else if (role === 'reading-pick') {
        await this.pickReading(Number(el.dataset.sent), Number(el.dataset.line), el.value || null);
      } else if (role === 'cell-edit') {
        await this.cellEdit(el);
      } else if (role === 'feat-key') {
        this.featDraft.set(`${el.dataset.sent}:${el.dataset.line}`, el.value);
        this.render();
      } else if (role === 'lemma-status') {
        await this.service.setLemmaStatus(this.currentId, Number(el.dataset.sent), Number(el.dataset.line), el.value || null);
        this.render();
      } else if (role === 'xpos-style') {
        this.xposStyle = el.value;
        this.suggestions.clear();
        this.fileSummary = null;
        this.render();
      } else if (role === 'export-analysis') {
        await this.service.setExportOption(this.currentId, 'recordAnalysis', el.checked);
        this.showToast(el.checked ? 'Tokens whose values come from a reading you chose will carry Analysis=… in the exported file.' : 'The chosen analysis is not written to the exported file.', 'info');
      } else if (role === 'export-uncertainty') {
        await this.service.setExportOption(this.currentId, 'recordUncertainty', el.checked);
        this.showToast(el.checked ? 'The exported file will also carry LemmaStatus= and AltLemma= in MISC for tokens you marked.' : 'Uncertain lemmas are not written to the exported file.', 'info');
      } else if (role === 'choice-only') {
        this.choiceOnly = el.checked;
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
    this._refreshAnalyzerInfo();
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
    return { srcLang: this.srcLang || this.getSrcLang() || 'apu', tgtLang: this.glossLang || undefined, columns: [...this.columns], inventoryLang: this.inventoryLang, xposStyle: this.xposStyle };
  }

  _remember(list) {
    for (const f of list) {
      f.checked = f.status === 'fill' && !f.needsConfirm && !f.needsChoice; // changes to existing values, new pairs and tokens needing a reading choice are never pre-checked
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
    if (needs && await this.service.prepareLanguage(lang)) { this.analyzerInfo = await this.service.analyzerInfo(lang); return; }
    if (!needs) return;
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

  /** Stores (or resets) the reading chosen for a token and refreshes that sentence's proposals. */
  async pickReading(sentIndex, lineIdx, raw) {
    await this.service.setReadingChoice(this.currentId, sentIndex, lineIdx, raw);
    this.currentSent = sentIndex;
    this.focusLine = lineIdx;
    await this.suggestSentence(true);
    this.showToast(raw ? 'Reading chosen: LEMMA, UPOS, XPOS and FEATS of this token now follow it.' : 'Back to the default (shared features).', 'info');
  }

  /** Jumps to the next token that needs review (after the current one, across sentences): several readings, or a lemma marked uncertain. */
  nextAmbiguous() {
    const targets = this._reviewTargets();
    if (!targets.length) { this.showToast('Nothing needs review yet (run Suggest first, or mark a lemma uncertain).', 'info'); return; }
    const here = [this.currentSent, this.focusLine ?? -1];
    const next = targets.find((p) => p[0] > here[0] || (p[0] === here[0] && p[1] > here[1])) || targets[0];
    this.currentSent = next[0];
    this.focusLine = next[1];
    this.render();
    setTimeout(() => { const row = this.root.querySelector('.ci-focus'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' }); }, 0);
  }

  // ---- manual editing ---------------------------------------------------------------------

  toggleEdit({ sent, line }) {
    const key = `${sent}:${line}`;
    if (this.editing.has(key)) this.editing.delete(key); else this.editing.add(key);
    this.focusLine = Number(line);
    this.render();
  }

  _ask(err) {
    const lang = this.service.inventoryLanguage(this._inv().srcLang, this.inventoryLang);
    const where = lang ? `the ${lang} inventory` : 'the inventory';
    switch (err.code) {
      case 'NEW_PAIR':
        return { flag: 'confirmNew', message: `"${err.pair}" is not in ${where}, not used in this file and not used in any other language of the inventory.\n\nAdd it anyway? Check the language's UD documentation first.` };
      case 'NEW_VALUE':
        return { flag: 'confirmNew', message: `"${err.value}" is not a known ${String(err.column).toUpperCase()} value in ${where}, in this file or in other languages.\n\nUse it anyway?` };
      case 'REPLACE':
        return { flag: 'replace', message: `${err.message}\n\nChange it${err.pair ? ` to ${err.pair}` : ''}? The original file keeps its value; you can take the edit back.` };
      case 'REMOVE_ORIGINAL':
        return { flag: 'confirmOriginal', message: `${err.message}\n\nRemove it from the working copy? The original file stays untouched; you can take the removal back (revert the cell or the token).` };
      default:
        return null;
    }
  }

  /** Runs a manual edit; when the service asks for a confirmation (new pair, replace, remove an original), asks the user and retries. */
  async _manual(run) {
    let flags = {};
    for (let i = 0; i < 4; i++) {
      try {
        await run(flags);
        if ([...this.suggestions.values()].some((f) => f.sentIndex === this.currentSent)) await this.suggestSentence(true);
        else this.render();
        return true;
      } catch (err) {
        if (!(err instanceof ManualEditError)) throw err;
        const ask = this._ask(err);
        if (!ask) { this.showToast(err.message, 'error'); this.render(); return false; }
        if (!this.confirmAction(ask.message)) { this.render(); return false; }
        flags = { ...flags, [ask.flag]: true };
      }
    }
    return false;
  }

  _where({ sent, line }) {
    this.currentSent = Number(sent);
    this.focusLine = Number(line);
    return [Number(sent), Number(line)];
  }

  async cellEdit(el) {
    const [sent, line] = this._where(el.dataset);
    await this._manual((flags) => this.service.setCellManual(this.currentId, sent, line, el.dataset.col, el.value, { ...this._inv(), ...flags }));
  }

  async featAdd(button) {
    const [sent, line] = this._where(button.dataset);
    const box = button.closest('.ci-ed');
    const custom = box.querySelector('[data-role="feat-custom"]').value.trim();
    const key = box.querySelector('[data-role="feat-key"]').value;
    const val = box.querySelector('[data-role="feat-val"]').value;
    const pair = custom || (key && val ? `${key}=${val}` : '');
    if (!pair) { this.showToast('Pick a feature and a value, or type Feature=Value.', 'info'); return; }
    if (await this._manual((flags) => this.service.addFeature(this.currentId, sent, line, pair, { ...this._inv(), ...flags }))) this.featDraft.delete(`${sent}:${line}`);
  }

  async featRemove(d) {
    const [sent, line] = this._where(d);
    await this._manual((flags) => this.service.removeFeature(this.currentId, sent, line, d.key, flags));
  }

  async miscAdd(button) {
    const [sent, line] = this._where(button.dataset);
    const box = button.closest('.ci-ed');
    const key = box.querySelector('[data-role="misc-key"]').value.trim();
    const val = box.querySelector('[data-role="misc-val"]').value;
    if (!key) { this.showToast('Type a MISC key (and a value).', 'info'); return; }
    await this._manual((flags) => this.service.setMiscManual(this.currentId, sent, line, key, val, flags));
  }

  async miscRemove(d) {
    const [sent, line] = this._where(d);
    await this._manual((flags) => this.service.removeMiscManual(this.currentId, sent, line, d.key, flags));
  }

  async revertCell(d) {
    const [sent, line] = this._where(d);
    await this.service.revertCell(this.currentId, sent, line, d.col);
    await this._manual(async () => {});
    this.showToast(`${d.col.toUpperCase()} is back to the original.`, 'info');
  }

  async revertMisc(d) {
    const [sent, line] = this._where(d);
    await this.service.revertMiscKey(this.currentId, sent, line, d.key);
    await this._manual(async () => {});
  }

  async revertToken(d) {
    const [sent, line] = this._where(d);
    if (!this.confirmAction('Take every edit of this token back to the original? Your notes about its lemma stay.')) return;
    await this.service.revertToken(this.currentId, sent, line);
    await this._manual(async () => {});
    this.showToast('Token reverted to the original.', 'info');
  }

  async altAdd(button) {
    const [sent, line] = this._where(button.dataset);
    let lemma = button.dataset.lemma;
    if (lemma === undefined) {
      const input = button.closest('.ci-lemma-note').querySelector('[data-role="alt-input"]');
      lemma = input.value.trim();
    }
    try {
      await this.service.addLemmaAlternative(this.currentId, sent, line, lemma);
    } catch (err) {
      if (err instanceof ManualEditError) { this.showToast(err.message, 'error'); return; }
      throw err;
    }
    this.render();
    this.showToast(`Kept "${lemma}" as an alternative lemma (nothing is changed in the file).`, 'info');
  }

  async altRemove(d) {
    const [sent, line] = this._where(d);
    await this.service.removeLemmaAlternative(this.currentId, sent, line, d.lemma);
    this.render();
  }

  async suggestFile() {
    await this._prepare();
    const list = this.service.suggestEnhancements(this.currentId, null, this._options());
    this.suggestions.clear();
    this._remember(list);
    const summary = {};
    for (const c of this.columns) summary[c] = { fill: 0, conflict: 0, same: 0, none: 0, flagged: 0, choice: 0 };
    for (const f of list) {
      const actionable = f.status === 'fill' || f.status === 'conflict';
      if (f.needsConfirm && actionable) summary[f.column].flagged++;
      else if (f.needsChoice && actionable) summary[f.column].choice++;
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
    const fields = [...this.suggestions.values()].filter((f) => f.status === wanted && !f.needsConfirm && !f.needsChoice && (!column || f.column === column));
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
