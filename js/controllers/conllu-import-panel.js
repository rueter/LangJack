/**
 * CoNLL-U Import panel: load an existing UD treebank, review and apply dictionary glosses sentence by
 * sentence (or for the whole file), compare against the original, revert, and export as a new file.
 * All data logic lives in services/conllu-import-service.js; this file only draws the panel and wires events.
 */

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const STATUS_LABEL = {
  new: 'new gloss', same: 'already glossed', consistent: 'already glossed (segmented)',
  conflict: 'different gloss exists', none: 'no dictionary entry'
};

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
    this.glossLang = '';
    this.suggestions = new Map(); // `${sentIndex}:${lineIdx}` -> suggestion (with .checked, .gloss, .overwrite)
    this.fileSummary = null; // counts after a whole-file suggestion run
  }

  async init() {
    await this.service.init();
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
    const fileBar = fs ? `<div class="ci-filesummary">Whole file: <b>${fs.new}</b> new,
      <b>${fs.consistent + fs.same}</b> already glossed, <b>${fs.conflict}</b> differing (review per sentence),
      <b>${fs.none}</b> without dictionary entry.
      <button class="btn btn-primary btn-sm" data-action="apply-all-new" ${fs.new ? '' : 'disabled'}>Apply all ${fs.new} new glosses</button>
      <button class="btn btn-secondary btn-sm" data-action="clear-file-summary">Dismiss</button></div>` : '';

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
        <button class="btn btn-secondary btn-sm" data-action="suggest-file" title="Look up every lemma in the dictionary; nothing is written yet">🔎 Suggest glosses for whole file</button>
        <button class="btn btn-secondary btn-sm" data-action="revert-all" ${sum.editedCount ? '' : 'disabled'}>↩ Revert all edits</button>
        <label class="ci-inline"><input type="checkbox" data-role="edited-only" ${this.editedOnly ? 'checked' : ''}> edited sentences only</label>
      </div>
      <p class="vw-hint">${convText}</p>
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

  renderIssues() {
    const issues = this.service.issues(this.currentId);
    if (!issues.length) return '<div class="vw-empty">No problems found.</div>';
    const shown = issues.slice(0, 50).map((i) => `<tr><td>${i.line}</td><td>${esc(i.severity)}</td><td>${esc(i.sentId || `sentence ${i.sentIndex + 1}`)}</td>
      <td>${esc(i.message)}</td><td><code>${esc(String(i.raw).slice(0, 60))}</code></td></tr>`).join('');
    return `<div class="ci-issues"><table class="dict-table"><thead><tr><th>Line</th><th></th><th>Sentence</th><th>Problem</th><th>Text</th></tr></thead>
      <tbody>${shown}</tbody></table>${issues.length > 50 ? `<div class="vw-hint">…and ${issues.length - 50} more. Rows with problems are kept as they are.</div>` : ''}</div>`;
  }

  renderSentence() {
    const parsed = this.service.parsed(this.currentId);
    const sent = parsed.sentences[this.currentSent];
    if (!sent) return '<div class="vw-empty">Select a sentence.</div>';
    const edited = this.service.isEdited(this.currentId, sent.index);
    const rows = sent.lines.map((line, lineIdx) => ({ line, lineIdx })).filter((r) => r.line.kind === 'token' || r.line.kind === 'mwt' || r.line.kind === 'malformed' || r.line.kind === 'empty');
    const suggestions = [...this.suggestions.values()].filter((s) => s.sentIndex === sent.index);
    const bySent = new Map(suggestions.map((s) => [s.lineIdx, s]));
    const overrides = this.service.overrides(this.currentId)[sent.index];

    const body = rows.map(({ line, lineIdx }) => {
      if (line.kind === 'malformed') {
        return `<tr class="ci-bad"><td colspan="6" title="${esc(line.issue)}">⚠ malformed row kept as is: <code>${esc(line.text)}</code></td></tr>`;
      }
      const cols = line.cols;
      if (line.kind !== 'token') {
        return `<tr class="ci-muted"><td>${esc(cols[0])}</td><td>${esc(cols[1])}</td><td colspan="4">${line.kind === 'mwt' ? 'multiword token' : 'empty node'}</td></tr>`;
      }
      const miscEdits = overrides && overrides.misc && overrides.misc[lineIdx];
      const miscNow = this.service.workingCols(this.currentId, sent.index, lineIdx)[9];
      const gloss = (miscNow || '_').split('|').filter((s) => /^gloss[[_]/i.test(s)).join(' ') || '—';
      const sug = bySent.get(lineIdx);
      return `<tr><td>${esc(cols[0])}</td><td>${esc(cols[1])}</td><td>${esc(cols[2])}</td><td>${esc(cols[3])}</td>
        <td class="${miscEdits ? 'ci-changed' : ''}"><code>${esc(gloss)}</code></td><td>${sug ? this.renderSuggestion(sug) : ''}</td></tr>`;
    }).join('');

    const actionable = suggestions.filter((s) => s.status === 'new' || s.status === 'conflict').length;
    const diff = edited ? this.renderDiff(sent.index) : '<div class="vw-hint">No edits in this sentence: it is exported exactly as in the original.</div>';
    return `
      <div class="ci-detail-head"><b>${esc(sent.sentId || `Sentence ${sent.index + 1}`)}</b>
        <span class="vw-hint">${esc(sent.text)}</span></div>
      <div class="vw-actions">
        <button class="btn btn-secondary btn-sm" data-action="suggest-sent">🔎 Suggest glosses</button>
        <button class="btn btn-primary btn-sm" data-action="apply-sent" ${actionable ? '' : 'disabled'}>Apply checked</button>
        <button class="btn btn-secondary btn-sm" data-action="revert-sent" ${edited ? '' : 'disabled'}>↩ Revert sentence</button>
      </div>
      <div class="ci-tablewrap"><table class="dict-table"><thead><tr><th>ID</th><th>Form</th><th>Lemma</th><th>UPOS</th><th>Gloss now</th><th>Dictionary suggestion</th></tr></thead>
        <tbody>${body}</tbody></table></div>
      <h5 class="ci-h">Changes against the original</h5>${diff}`;
  }

  renderSuggestion(sug) {
    const key = `${sug.sentIndex}:${sug.lineIdx}`;
    if (sug.status === 'none') return '<span class="ci-muted">no dictionary entry</span>';
    if (sug.status === 'same' || sug.status === 'consistent') return `<span class="ci-muted">✓ ${esc(STATUS_LABEL[sug.status])}</span>`;
    const options = sug.candidates.map((c) => `<option value="${esc(c.gloss)}"${c.gloss === sug.pick ? ' selected' : ''}>${esc(c.gloss)}${c.via === 'analyzer' ? ' (via analyzer)' : ''}</option>`).join('');
    const warn = sug.status === 'conflict' ? `<span class="ci-warn" title="Existing: ${esc(sug.existing)}">replace <code>${esc(sug.existing)}</code>?</span>` : '';
    return `<label class="ci-inline"><input type="checkbox" data-role="sug-check" data-key="${esc(key)}"${sug.checked ? ' checked' : ''}>
      <select data-role="sug-pick" data-key="${esc(key)}">${options}</select></label> ${warn}`;
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
        case 'suggest-sent': this.suggestSentence(); break;
        case 'suggest-file': this.suggestFile(); break;
        case 'apply-sent': await this.applySentence(); break;
        case 'apply-all-new': await this.applyAllNew(); break;
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
      } else if (role === 'sug-check') {
        const sug = this.suggestions.get(el.dataset.key);
        if (sug) sug.checked = el.checked;
      } else if (role === 'sug-pick') {
        const sug = this.suggestions.get(el.dataset.key);
        if (sug) { sug.pick = el.value; sug.gloss = el.value; }
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
    const fromName = file.name.match(/^([a-z]{2,3})_/); // UD file names start with the language code: apu_ufpa-ud-test.conllu
    if (fromName) this.srcLang = fromName[1];
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
    return { srcLang: this.srcLang || this.getSrcLang() || 'apu', tgtLang: this.glossLang || undefined };
  }

  _remember(list) {
    for (const s of list) {
      s.pick = s.gloss;
      s.checked = s.status === 'new'; // conflicts are never pre-checked
      this.suggestions.set(`${s.sentIndex}:${s.lineIdx}`, s);
    }
  }

  suggestSentence() {
    const list = this.service.suggestGlosses(this.currentId, this.currentSent, this._options());
    for (const key of [...this.suggestions.keys()]) if (key.startsWith(`${this.currentSent}:`)) this.suggestions.delete(key);
    this._remember(list);
    this.render();
    const n = list.filter((s) => s.status === 'new').length;
    this.showToast(n ? `${n} gloss suggestion${n > 1 ? 's' : ''} found. Review and click "Apply checked".` : 'No new glosses to suggest for this sentence.', n ? 'success' : 'info');
  }

  suggestFile() {
    const list = this.service.suggestGlosses(this.currentId, null, this._options());
    this.suggestions.clear();
    this._remember(list);
    const count = (status) => list.filter((s) => s.status === status).length;
    this.fileSummary = { new: count('new'), same: count('same'), consistent: count('consistent'), conflict: count('conflict'), none: count('none') };
    this.render();
  }

  async applySentence() {
    const items = [...this.suggestions.values()].filter((s) => s.sentIndex === this.currentSent && s.checked);
    if (!items.length) { this.showToast('Nothing checked.', 'info'); return; }
    const conflicts = items.filter((s) => s.status === 'conflict');
    if (conflicts.length) {
      const list = conflicts.map((s) => `  ${s.form}: ${s.existing}  →  ${s.pick}`).join('\n');
      if (!this.confirmAction(`Replace ${conflicts.length} existing gloss${conflicts.length > 1 ? 'es' : ''}?\n\n${list}\n\nThe original file keeps the old values; you can revert the sentence at any time.`)) {
        conflicts.forEach((s) => { s.checked = false; });
        this.render();
        return;
      }
      conflicts.forEach((s) => { s.overwrite = true; });
    }
    const res = await this.service.applyGlossSuggestions(this.currentId, items);
    for (const s of items) this.suggestions.delete(`${s.sentIndex}:${s.lineIdx}`);
    this.render();
    this.showToast(`Glosses written: ${res.written} new, ${res.replaced} replaced.`, 'success');
  }

  async applyAllNew() {
    const items = [...this.suggestions.values()].filter((s) => s.status === 'new');
    if (!items.length) return;
    const sentences = new Set(items.map((s) => s.sentIndex)).size;
    if (!this.confirmAction(`Add ${items.length} new glosses in ${sentences} sentence(s)?\n\nExisting glosses are not touched. You can review the changes per sentence and revert any of them.`)) return;
    const res = await this.service.applyGlossSuggestions(this.currentId, items);
    this.suggestions.clear();
    this.fileSummary = null;
    this.render();
    this.showToast(`Added ${res.written} glosses.`, 'success');
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
