/**
 * CoNLL-U Import Service: loads an existing UD treebank, lets it be enhanced (glosses from the
 * dictionary / analyzer) and exports it again without losing anything that was in the original.
 *
 * - The imported text is stored once as an immutable original (file name, import time, SHA-256).
 * - All edits are per-sentence overrides on top of it (see conllu-parser.js), stored as a separate
 *   working copy. Importing never touches saved treebanks or an earlier import.
 * - Export re-emits the original lines and patches only what was edited.
 */

import { storageService } from './storage-service.js';
import { dictionaryService } from './dictionary-service.js';
import { analyzerService, normalizeLangCode } from './analyzer-service.js';
import { stripGuessTags } from './tag-mapper.js';
import { featureInventory, usageOfFile, UNIVERSAL_FEATURES, UNIVERSAL_UPOS, UNIVERSAL_DEPRELS } from './ud-feature-inventory.js';
import {
  ENHANCE_COLUMNS, LOCKED_COLUMNS, isEmptyCell, mergeFeats, featsToString, parseFeats, featsFromGloss, summarizeReadings, baselineDependencies
} from './conllu-enhance.js';
import {
  parseConllu, serializeConllu, sentenceRaw, renderSentence, describeChanges, diffSentenceLines,
  detectGlossConvention, glossKeyFor, findExistingGloss, formatGlossValue, glossLangToIso3,
  editCell, editMiscKey, editComment, revertSentence, revertCell, revertMiscKey, revertToken, hasOverrides, applyMiscEdits, parseMisc, parseGlossKey, CONLLU_COLUMNS
} from './conllu-parser.js';

async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5; // FNV-1a fallback where WebCrypto is unavailable (plain-http pages)
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`;
}

/** "apu_ufpa-ud-test.conllu" -> "apu_ufpa-ud-test.enhanced.conllu" (never the original name). */
export function defaultExportFileName(originalName) {
  const name = (originalName || 'treebank.conllu').trim() || 'treebank.conllu';
  const m = name.match(/^(.*?)(\.conllu?)?$/i);
  return `${m[1] || 'treebank'}.enhanced.conllu`;
}

/**
 * Thrown by the manual-edit methods. `code` tells the caller which confirmation is missing:
 * NEW_PAIR / NEW_VALUE (not in any inventory layer: pass confirmNew), REPLACE (a different value exists: pass replace),
 * REMOVE_ORIGINAL (the original file has it: pass confirmOriginal); INVALID and LOCKED cannot be confirmed.
 */
export class ManualEditError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ManualEditError';
    this.code = code;
    Object.assign(this, detail);
  }
}

const FEAT_PAIR = /^([A-Z][A-Za-z0-9]*(?:\[[a-z0-9]+\])?)=([A-Z0-9][A-Za-z0-9]*(?:,[A-Z0-9][A-Za-z0-9]*)*)$/;
const MISC_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9_-]+\])?$/;
const MANUAL_CELLS = ['lemma', 'upos', 'xpos', 'head', 'deprel', 'deps'];
const LEMMA_STATUS = ['uncertain', 'undecided'];
const lowerOrder = (a, b) => { const x = a.toLowerCase(); const y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

export class ConlluImportService {
  /** Saved options, with the old name `recordAnalysis` (Analysis=…) read as `recordTags` (GTtags=…). */
  static _options(saved) {
    const { recordAnalysis, ...rest } = saved;
    return { recordUncertainty: false, recordTags: false, ...rest, ...(recordAnalysis && rest.recordTags === undefined ? { recordTags: true } : {}) };
  }

  constructor(inventory = featureInventory) {
    this.items = new Map(); // importId -> { meta, parsed, overrides, exportName }
    this.inventory = inventory; // language-aware Feature=Value / UPOS / DEPREL inventory
  }

  /** Loads the list of previous imports (originals and working copies) from storage. */
  async init() {
    this.items.clear();
    const records = await storageService.getAllConlluRecords();
    const works = new Map(records.filter((r) => r.kind === 'working').map((r) => [r.importId, r]));
    for (const rec of records.filter((r) => r.kind === 'original')) {
      this._register(rec, works.get(rec.importId));
    }
    return this.list();
  }

  _register(original, working) {
    const parsed = parseConllu(original.text);
    const item = {
      meta: {
        importId: original.importId, fileName: original.fileName, importedAt: original.importedAt,
        hash: original.hash, size: original.size
      },
      parsed,
      overrides: (working && working.overrides) || {},
      readingChoices: (working && working.readingChoices) || {}, // { sentIndex: { lineIdx: raw analysis } }: which reading the user picked
      provenance: (working && working.provenance) || {}, // { sentIndex: { lineIdx: { 'lemma' | 'feats' | 'feats:Key' | 'misc:Key': { source, detail, at } } } }
      tokenNotes: (working && working.tokenNotes) || {}, // { sentIndex: { lineIdx: { lemmaStatus, alternatives: [lemma] } } }
      exportOptions: ConlluImportService._options((working && working.exportOptions) || {}),
      exportName: (working && working.exportName) || defaultExportFileName(original.fileName)
    };
    this.items.set(original.importId, item);
    return item;
  }

  /** Summaries, newest import first. */
  list() {
    return Array.from(this.items.values())
      .map((it) => this.summary(it.meta.importId))
      .sort((a, b) => b.importedAt - a.importedAt);
  }

  _item(importId) {
    const it = this.items.get(importId);
    if (!it) throw new Error('Unknown import');
    return it;
  }

  summary(importId) {
    const it = this._item(importId);
    return {
      ...it.meta,
      sentenceCount: it.parsed.sentences.length,
      editedCount: Object.keys(it.overrides).length,
      choiceCount: Object.values(it.readingChoices).reduce((n, c) => n + Object.keys(c).length, 0),
      reviewCount: this.reviewTokens(importId).length,
      issueCount: it.parsed.issues.length,
      exportName: it.exportName
    };
  }

  parsed(importId) { return this._item(importId).parsed; }
  overrides(importId) { return this._item(importId).overrides; }
  issues(importId) { return this._item(importId).parsed.issues; }
  glossConvention(importId) { return detectGlossConvention(this._item(importId).parsed); }

  /**
   * Imports CoNLL-U text as a new immutable original plus an empty working copy. Importing the same
   * content again returns the existing import (and its working copy) instead of replacing anything.
   * @returns {Promise<{ importId: string, duplicate: boolean, summary: Object }>}
   */
  async importText(text, fileName = 'treebank.conllu') {
    if (typeof text !== 'string' || text.trim() === '') throw new Error('The file is empty.');
    const hash = await hashText(text);
    const importId = `import_${hash.slice(0, 16)}`;
    if (this.items.has(importId)) {
      return { importId, duplicate: true, summary: this.summary(importId) };
    }
    const { record, existed } = await storageService.addConlluOriginal({
      importId, fileName, importedAt: Date.now(), hash, size: text.length, text
    });
    const working = existed ? await storageService.getConlluRecord(`work:${importId}`) : null;
    this._register(record, working);
    if (!existed) await this._persist(importId);
    return { importId, duplicate: existed, summary: this.summary(importId) };
  }

  async _persist(importId) {
    const it = this._item(importId);
    await storageService.saveConlluWorking({
      importId, overrides: it.overrides, exportName: it.exportName, readingChoices: it.readingChoices,
      provenance: it.provenance, tokenNotes: it.tokenNotes, exportOptions: it.exportOptions
    });
  }

  /** Removes the whole import (original and working copy). Callers must confirm with the user first. */
  async removeImport(importId) {
    this._item(importId);
    await storageService.deleteConlluImport(importId);
    this.items.delete(importId);
  }

  // ---- editing (recorded as overrides, original untouched) -------------------------------

  async setCell(importId, sentIndex, lineIdx, column, value) {
    const it = this._item(importId);
    editCell(it.overrides, it.parsed.sentences[sentIndex], lineIdx, column, value);
    await this._persist(importId);
  }

  async setMisc(importId, sentIndex, lineIdx, key, value) {
    const it = this._item(importId);
    editMiscKey(it.overrides, it.parsed.sentences[sentIndex], lineIdx, key, value);
    await this._persist(importId);
  }

  async setComment(importId, sentIndex, key, value) {
    const it = this._item(importId);
    editComment(it.overrides, it.parsed.sentences[sentIndex], key, value);
    await this._persist(importId);
  }

  async revertSentence(importId, sentIndex) {
    const it = this._item(importId);
    revertSentence(it.overrides, sentIndex);
    delete it.readingChoices[sentIndex];
    delete it.provenance[sentIndex];
    await this._persist(importId);
  }

  async revertAll(importId) {
    const it = this._item(importId);
    it.overrides = {};
    it.readingChoices = {};
    it.provenance = {};
    await this._persist(importId);
  }

  // ---- reading choices (which analyzer reading supplies LEMMA, UPOS, XPOS and FEATS of a token) ----

  /** The raw analysis string the user picked for a token, or null (default rule). */
  readingChoice(importId, sentIndex, lineIdx) {
    const c = this._item(importId).readingChoices[sentIndex];
    return (c && c[lineIdx]) || null;
  }

  /**
   * Records (raw analysis string) or resets (null) the reading chosen for one token. This only steers the
   * proposals; nothing is written to the file until the proposals are applied, with the usual
   * confirmation for non-empty cells.
   */
  async setReadingChoice(importId, sentIndex, lineIdx, raw) {
    const it = this._item(importId);
    if (!it.parsed.sentences[sentIndex] || !it.parsed.sentences[sentIndex].lines[lineIdx] || !it.parsed.sentences[sentIndex].lines[lineIdx].cols) {
      throw new Error('Not a token row');
    }
    if (raw === null || raw === undefined || raw === '') {
      const c = it.readingChoices[sentIndex];
      if (c) { delete c[lineIdx]; if (!Object.keys(c).length) delete it.readingChoices[sentIndex]; }
    } else {
      it.readingChoices[sentIndex] = it.readingChoices[sentIndex] || {};
      it.readingChoices[sentIndex][lineIdx] = String(raw);
    }
    await this._persist(importId);
  }

  /** Stored reading choices of a sentence: [{ lineIdx, tokenId, form, raw }]. */
  readingChoices(importId, sentIndex) {
    const it = this._item(importId);
    const c = it.readingChoices[sentIndex] || {};
    return Object.entries(c).map(([lineIdx, raw]) => {
      const cols = it.parsed.sentences[sentIndex].lines[lineIdx].cols;
      return { lineIdx: Number(lineIdx), tokenId: cols[0], form: cols[1], raw };
    });
  }

  async setExportName(importId, name) {
    const it = this._item(importId);
    it.exportName = this.safeExportName(importId, name);
    await this._persist(importId);
    return it.exportName;
  }

  /** A usable download name that is never the original file's name. */
  safeExportName(importId, name) {
    const it = this._item(importId);
    let out = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
    if (!out) return defaultExportFileName(it.meta.fileName);
    if (!/\.conllu?$/i.test(out)) out += '.conllu';
    if (out === it.meta.fileName) out = defaultExportFileName(out);
    return out;
  }

  // ---- views -----------------------------------------------------------------------------

  isEdited(importId, sentIndex) {
    return hasOverrides(this._item(importId).overrides, sentIndex);
  }

  /** Sentence text of the working copy (original lines patched with its overrides). */
  workingSentenceText(importId, sentIndex) {
    const it = this._item(importId);
    return renderSentence(it.parsed.sentences[sentIndex], it.overrides[sentIndex], it.parsed.eol);
  }

  originalSentenceText(importId, sentIndex) {
    return sentenceRaw(this._item(importId).parsed.sentences[sentIndex]);
  }

  /** Field-level and line-level diff of one sentence, original vs. working. */
  diff(importId, sentIndex) {
    const it = this._item(importId);
    const sent = it.parsed.sentences[sentIndex];
    const ov = it.overrides[sentIndex];
    return {
      changes: describeChanges(sent, ov),
      lines: diffSentenceLines(sent, ov, it.parsed.eol),
      choices: this.readingChoices(importId, sentIndex), // picked readings, applied or not
      notes: this.sentenceNotes(importId, sentIndex) // uncertainty notes: written to MISC only when the export option is on
    };
  }

  /** The working file as CoNLL-U text. Untouched sentences are byte-identical to the original. */
  exportText(importId) {
    const it = this._item(importId);
    return serializeConllu(it.parsed, it.exportOptions.recordUncertainty ? this._overridesWithNotes(it) : it.overrides);
  }

  /** The unchanged original text, exactly as imported. */
  originalText(importId) {
    const it = this._item(importId);
    return serializeConllu(it.parsed, {});
  }

  exportFileName(importId) {
    return this._item(importId).exportName;
  }

  // ---- glossing --------------------------------------------------------------------------

  /** Word rows of a sentence (syntactic words only; skips multiword ranges, empty nodes, malformed rows). */
  _wordRows(sentence) {
    const rows = [];
    sentence.lines.forEach((line, lineIdx) => {
      if (line.kind === 'token') rows.push({ line, lineIdx });
    });
    return rows;
  }

  _currentCols(it, sentIndex, lineIdx) {
    // Row values as they are in the working copy (original plus overrides)
    const ov = it.overrides[sentIndex];
    const line = it.parsed.sentences[sentIndex].lines[lineIdx];
    const cols = line.cols.slice();
    const cell = ov && ov.cells && ov.cells[lineIdx];
    if (cell) for (const [name, value] of Object.entries(cell)) cols[CONLLU_COLUMNS.indexOf(name)] = value;
    return cols;
  }

  _currentMisc(it, sentIndex, lineIdx) {
    const ov = it.overrides[sentIndex];
    const cols = this._currentCols(it, sentIndex, lineIdx);
    const edits = ov && ov.misc && ov.misc[lineIdx];
    return edits ? applyMiscEdits(cols[9], edits) : cols[9];
  }

  /** Columns of one row of the working copy (original plus overrides). */
  workingCols(importId, sentIndex, lineIdx) {
    const it = this._item(importId);
    const cols = this._currentCols(it, sentIndex, lineIdx);
    cols[9] = this._currentMisc(it, sentIndex, lineIdx);
    return cols;
  }

  /** Looks up candidate glosses for one word via lemma (dictionary), falling back to the analyzer on the form. */
  lookupCandidates(form, lemma, srcLang, tgtIso3) {
    const seen = new Set();
    const out = [];
    const add = (list, via) => {
      for (const g of list || []) {
        const key = `${g.lang}:${String(g.gloss).toLowerCase()}`;
        if (!seen.has(key)) { seen.add(key); out.push({ gloss: g.gloss, lang: g.lang, source: g.source || via, via }); }
      }
    };
    const lemmaClean = lemma && lemma !== '_' ? lemma : form;
    add(dictionaryService.lookupGlosses(lemmaClean, srcLang, tgtIso3), 'lemma');
    if (out.length === 0 && analyzerService.activeLang) {
      try {
        const readings = analyzerService.analyze_word(form, srcLang) || [];
        const lemmas = new Set();
        for (const r of readings) {
          if (r.isGuessed || !r.lemma) continue;
          const l = stripGuessTags(r.lemma);
          if (l && l !== lemmaClean) lemmas.add(l);
        }
        for (const l of lemmas) add(dictionaryService.lookupGlosses(l, srcLang, tgtIso3), 'analyzer');
      } catch (e) {
        // analyzer unavailable for this language: no fallback candidates
      }
    }
    return out;
  }

  /** True when a morpheme-segmented gloss ("ver-VBLZ-3SG.M.O") already holds one of the dictionary glosses. */
  _glossContainsCandidate(existing, candidates, spaceChar) {
    const parts = new Set(existing.split('-').map((p) => p.toLowerCase()));
    return candidates.some((c) => parts.has(formatGlossValue(c.gloss, spaceChar).toLowerCase()));
  }

  /**
   * Suggests glosses for one sentence (or every sentence when `sentIndex` is null) using the
   * dictionary FST, following the file's own gloss key convention. Nothing is written.
   * status: 'new' (no gloss yet), 'same', 'consistent' (the existing morpheme-segmented gloss, e.g.
   * "ver-3SG.M.O", already contains a dictionary gloss), 'conflict' (a different gloss exists),
   * 'none' (no candidate).
   * @param {string} importId
   * @param {number|null} sentIndex
   * @param {{ srcLang: string, tgtLang?: string }} options  tgtLang: gloss language as used in the file ("pt") or ISO3 ("por")
   */
  suggestGlosses(importId, sentIndex, { srcLang, tgtLang } = {}) {
    const it = this._item(importId);
    const conv = detectGlossConvention(it.parsed);
    const lang = tgtLang || conv.lang || 'eng';
    const tgtIso3 = glossLangToIso3(lang);
    const key = glossKeyFor(conv, lang);
    const indexes = sentIndex === null || sentIndex === undefined
      ? it.parsed.sentences.map((s) => s.index)
      : [sentIndex];
    const suggestions = [];
    for (const idx of indexes) {
      const sentence = it.parsed.sentences[idx];
      for (const { lineIdx } of this._wordRows(sentence)) {
        const cols = this._currentCols(it, idx, lineIdx);
        const [tokenId, form, lemma, upos] = cols;
        if (upos === 'PUNCT' || /^[\p{P}\p{S}]+$/u.test(form)) continue;
        const misc = this._currentMisc(it, idx, lineIdx);
        const existingSeg = findExistingGloss(misc, lang);
        const candidates = this.lookupCandidates(form, lemma, srcLang, tgtIso3);
        const proposed = candidates.length ? formatGlossValue(candidates[0].gloss, conv.spaceChar) : null;
        let status;
        if (!candidates.length) status = 'none';
        else if (!existingSeg) status = 'new';
        else if ((existingSeg.value || '') === proposed) status = 'same';
        else if (this._glossContainsCandidate(existingSeg.value || '', candidates, conv.spaceChar)) status = 'consistent';
        else status = 'conflict';
        suggestions.push({
          sentIndex: idx, lineIdx, tokenId, form, lemma, status, key: existingSeg ? existingSeg.key : key,
          existing: existingSeg ? (existingSeg.value || '') : null,
          candidates, gloss: proposed
        });
      }
    }
    return suggestions;
  }

  /**
   * Writes chosen suggestions into MISC. An existing gloss is only replaced when the item has
   * `overwrite: true` (the caller sets that after the user confirmed); otherwise it is skipped.
   * @param {Array} items  entries from suggestGlosses (optionally with `gloss` changed, `overwrite` set)
   * @returns {Promise<{ written: number, replaced: number, skipped: number }>}
   */
  async applyGlossSuggestions(importId, items) {
    const it = this._item(importId);
    let written = 0;
    let replaced = 0;
    let skipped = 0;
    for (const item of items) {
      if (!item.gloss || item.status === 'none' || item.status === 'same' || item.status === 'consistent') { skipped++; continue; }
      const hasExisting = item.existing !== null && item.existing !== undefined;
      if (hasExisting && !item.overwrite) { skipped++; continue; }
      const value = formatGlossValue(item.gloss, detectGlossConvention(it.parsed).spaceChar);
      editMiscKey(it.overrides, it.parsed.sentences[item.sentIndex], item.lineIdx, item.key, value);
      this._setProv(it, item.sentIndex, item.lineIdx, `misc:${item.key}`, { source: 'dictionary', detail: '' });
      if (hasExisting) replaced++; else written++;
    }
    await this._persist(importId);
    return { written, replaced, skipped };
  }

  // ---- provenance: why is a value there? ------------------------------------------------------

  _setProv(it, sentIndex, lineIdx, key, entry) {
    const bySent = (it.provenance[sentIndex] = it.provenance[sentIndex] || {});
    const byLine = (bySent[lineIdx] = bySent[lineIdx] || {});
    byLine[key] = { at: Date.now(), ...entry };
  }

  /** Drops provenance whose edit is gone (reverted, or set back to the original value). */
  _pruneProv(it, sentIndex) {
    const bySent = it.provenance[sentIndex];
    if (!bySent) return;
    const ov = it.overrides[sentIndex] || { cells: {}, misc: {} };
    for (const [lineIdx, entries] of Object.entries(bySent)) {
      const cells = (ov.cells && ov.cells[lineIdx]) || {};
      const misc = (ov.misc && ov.misc[lineIdx]) || {};
      for (const key of Object.keys(entries)) {
        const alive = key.startsWith('misc:') ? misc[key.slice(5)] !== undefined
          : key.startsWith('feats:') ? cells.feats !== undefined : cells[key] !== undefined;
        if (!alive) delete entries[key];
      }
      if (!Object.keys(entries).length) delete bySent[lineIdx];
    }
    if (!Object.keys(bySent).length) delete it.provenance[sentIndex];
  }

  /** Provenance of the edits of one token: { 'lemma' | 'feats' | 'feats:Key' | 'misc:Key': { source, detail, at } }. */
  provenance(importId, sentIndex, lineIdx) {
    const it = this._item(importId);
    this._pruneProv(it, sentIndex);
    return { ...((it.provenance[sentIndex] || {})[lineIdx] || {}) };
  }

  // ---- per-cell and per-token revert ----------------------------------------------------------

  async revertCell(importId, sentIndex, lineIdx, column) {
    const it = this._item(importId);
    revertCell(it.overrides, it.parsed.sentences[sentIndex], lineIdx, column);
    this._pruneProv(it, sentIndex);
    await this._persist(importId);
  }

  async revertMiscKey(importId, sentIndex, lineIdx, key) {
    const it = this._item(importId);
    revertMiscKey(it.overrides, it.parsed.sentences[sentIndex], lineIdx, key);
    this._pruneProv(it, sentIndex);
    await this._persist(importId);
  }

  /**
   * Back to the original for one token: its cell and MISC edits, its provenance and its reading choice go.
   * Uncertainty notes stay (they are the user's thinking, not an edit); other tokens are untouched.
   */
  async revertToken(importId, sentIndex, lineIdx) {
    const it = this._item(importId);
    revertToken(it.overrides, it.parsed.sentences[sentIndex], lineIdx);
    const c = it.readingChoices[sentIndex];
    if (c) { delete c[lineIdx]; if (!Object.keys(c).length) delete it.readingChoices[sentIndex]; }
    if (it.provenance[sentIndex]) delete it.provenance[sentIndex][lineIdx];
    this._pruneProv(it, sentIndex);
    await this._persist(importId);
  }

  /** Whether a cell / MISC key of the token differs from the original: { cells: [col], misc: [key] }. */
  editedFields(importId, sentIndex, lineIdx) {
    const ov = this._item(importId).overrides[sentIndex];
    return {
      cells: Object.keys((ov && ov.cells && ov.cells[lineIdx]) || {}),
      misc: Object.keys((ov && ov.misc && ov.misc[lineIdx]) || {})
    };
  }

  // ---- uncertainty notes ----------------------------------------------------------------------

  /** { lemmaStatus: null|'uncertain'|'undecided', alternatives: [lemma] } of a token. */
  tokenNote(importId, sentIndex, lineIdx) {
    const n = (this._item(importId).tokenNotes[sentIndex] || {})[lineIdx];
    return { lemmaStatus: (n && n.lemmaStatus) || null, alternatives: [...((n && n.alternatives) || [])] };
  }

  _writeNote(it, sentIndex, lineIdx, note) {
    const bySent = (it.tokenNotes[sentIndex] = it.tokenNotes[sentIndex] || {});
    if (!note.lemmaStatus && !note.alternatives.length) delete bySent[lineIdx];
    else bySent[lineIdx] = { lemmaStatus: note.lemmaStatus || null, alternatives: note.alternatives };
    if (!Object.keys(bySent).length) delete it.tokenNotes[sentIndex];
  }

  _checkToken(it, sentIndex, lineIdx) {
    const line = it.parsed.sentences[sentIndex] && it.parsed.sentences[sentIndex].lines[lineIdx];
    if (!line || line.kind !== 'token') throw new ManualEditError('INVALID', 'Not a token row');
  }

  /** Marks the lemma of a token 'uncertain' (a value is there but not sure) or 'undecided' (to be decided), or null to clear. */
  async setLemmaStatus(importId, sentIndex, lineIdx, status) {
    const it = this._item(importId);
    this._checkToken(it, sentIndex, lineIdx);
    if (status !== null && !LEMMA_STATUS.includes(status)) throw new ManualEditError('INVALID', `Lemma status must be ${LEMMA_STATUS.join(' or ')}`);
    const note = this.tokenNote(importId, sentIndex, lineIdx);
    note.lemmaStatus = status;
    this._writeNote(it, sentIndex, lineIdx, note);
    await this._persist(importId);
  }

  /** Remembers a lemma the user considered (e.g. awinhitxi next to awinhi). Does not change the LEMMA cell. */
  async addLemmaAlternative(importId, sentIndex, lineIdx, lemma) {
    const it = this._item(importId);
    this._checkToken(it, sentIndex, lineIdx);
    const value = String(lemma || '').trim();
    if (!value || /[\s|=,\t]/.test(value)) throw new ManualEditError('INVALID', 'An alternative lemma is one word without spaces, "|", "=" or ","');
    const note = this.tokenNote(importId, sentIndex, lineIdx);
    if (!note.alternatives.includes(value)) note.alternatives.push(value);
    this._writeNote(it, sentIndex, lineIdx, note);
    await this._persist(importId);
  }

  async removeLemmaAlternative(importId, sentIndex, lineIdx, lemma) {
    const it = this._item(importId);
    const note = this.tokenNote(importId, sentIndex, lineIdx);
    note.alternatives = note.alternatives.filter((a) => a !== lemma);
    this._writeNote(it, sentIndex, lineIdx, note);
    await this._persist(importId);
  }

  sentenceNotes(importId, sentIndex) {
    const it = this._item(importId);
    return Object.entries(it.tokenNotes[sentIndex] || {}).map(([lineIdx, n]) => {
      const cols = it.parsed.sentences[sentIndex].lines[lineIdx].cols;
      return { lineIdx: Number(lineIdx), tokenId: cols[0], form: cols[1], lemmaStatus: n.lemmaStatus, alternatives: [...n.alternatives] };
    });
  }

  /** Tokens to come back to: lemma marked uncertain or undecided. [{ sentIndex, lineIdx, tokenId, form, reason }] */
  reviewTokens(importId) {
    const it = this._item(importId);
    const out = [];
    for (const [sentIndex, byLine] of Object.entries(it.tokenNotes)) {
      for (const [lineIdx, n] of Object.entries(byLine)) {
        if (!n.lemmaStatus) continue;
        const cols = it.parsed.sentences[sentIndex].lines[lineIdx].cols;
        out.push({ sentIndex: Number(sentIndex), lineIdx: Number(lineIdx), tokenId: cols[0], form: cols[1], reason: n.lemmaStatus });
      }
    }
    return out.sort((a, b) => a.sentIndex - b.sentIndex || a.lineIdx - b.lineIdx);
  }

  // ---- optional record of uncertainty in the exported file ------------------------------------

  exportOptions(importId) { return { ...this._item(importId).exportOptions }; }

  /**
   * Optional extras, both off by default:
   * recordUncertainty: LemmaStatus=… and AltLemma=… in MISC of the exported file for tokens you marked;
   * recordTags: also propose GTtags=… (the analyzer's tag readout, comma-separated, as in the Apurinã file) in MISC for
   *   the reading a token is based on. These are ordinary proposals: an existing different GTtags is never replaced
   *   without confirmation. (The older name `recordAnalysis` is accepted as `recordTags`.)
   */
  async setExportOption(importId, key, value) {
    const it = this._item(importId);
    const name = key === 'recordAnalysis' ? 'recordTags' : key;
    if (name !== 'recordUncertainty' && name !== 'recordTags') throw new ManualEditError('INVALID', `Unknown export option "${key}"`);
    it.exportOptions[name] = Boolean(value);
    await this._persist(importId);
  }

  _overridesWithNotes(it) {
    const merged = JSON.parse(JSON.stringify(it.overrides));
    if (it.exportOptions.recordUncertainty) {
      for (const [sentIndex, byLine] of Object.entries(it.tokenNotes)) {
        const sentence = it.parsed.sentences[sentIndex];
        for (const [lineIdx, n] of Object.entries(byLine)) {
          if (n.lemmaStatus) editMiscKey(merged, sentence, Number(lineIdx), 'LemmaStatus', n.lemmaStatus);
          if (n.alternatives.length) editMiscKey(merged, sentence, Number(lineIdx), 'AltLemma', n.alternatives.join(','));
        }
      }
    }
    return merged;
  }

  // ---- manual editing of cells, FEATS pairs and MISC keys -------------------------------------

  _ctx(importId, { srcLang, inventoryLang = 'auto' } = {}) {
    return { lang: this.inventoryLanguage(srcLang, inventoryLang), file: this.fileUsage(importId).feats };
  }

  _row(importId, sentIndex, lineIdx) {
    const it = this._item(importId);
    this._checkToken(it, sentIndex, lineIdx);
    return { it, sentence: it.parsed.sentences[sentIndex], original: it.parsed.sentences[sentIndex].lines[lineIdx].cols };
  }

  async _afterManual(it, importId, sentIndex) {
    this._pruneProv(it, sentIndex);
    await this._persist(importId);
  }

  /** The FEATS pairs of a token as they are now: [{ key, value, pair, inOriginal, layer, label, languages, provenance }]. */
  featsPairs(importId, sentIndex, lineIdx, opts = {}) {
    const { original } = this._row(importId, sentIndex, lineIdx);
    const orig = parseFeats(original[5]);
    const now = parseFeats(this.workingCols(importId, sentIndex, lineIdx)[5]);
    const ctx = this._ctx(importId, opts);
    const prov = this.provenance(importId, sentIndex, lineIdx);
    return [...now].sort((a, b) => lowerOrder(a[0], b[0])).map(([key, value]) => {
      const c = this.inventory.classifyFeats(`${key}=${value}`, ctx)[0];
      return {
        key, value, pair: `${key}=${value}`, inOriginal: orig.get(key) === value, keyInOriginal: orig.has(key),
        layer: c.layer, label: c.label, languages: c.languages, provenance: prov[`feats:${key}`] || prov.feats || null
      };
    });
  }

  /**
   * Adds (or, with `replace`, changes) one Feature=Value pair by hand; FEATS stay sorted the UD way and layered keys
   * (Person[psor]) are kept. A pair found in no inventory layer needs `confirmNew`; changing the value of a key that is
   * already there needs `replace`.
   */
  async addFeature(importId, sentIndex, lineIdx, pair, { confirmNew = false, replace = false, ...opts } = {}) {
    const { it, sentence } = this._row(importId, sentIndex, lineIdx);
    const m = String(pair || '').trim().match(FEAT_PAIR);
    if (!m) throw new ManualEditError('INVALID', 'Write the pair as Feature=Value, for example Person[psor]=3 (values start with a capital letter or digit; several values are joined with ",").');
    const [, key, value] = m;
    const map = parseFeats(this.workingCols(importId, sentIndex, lineIdx)[5]);
    if (map.get(key) === value) return { changed: false };
    if (map.has(key) && !replace) throw new ManualEditError('REPLACE', `${key} is already ${map.get(key)}.`, { key, have: map.get(key), pair: `${key}=${value}` });
    const c = this.inventory.classifyFeats(`${key}=${value}`, this._ctx(importId, opts))[0];
    if (c.layer === 'new' && !confirmNew) throw new ManualEditError('NEW_PAIR', `${key}=${value} is not in the inventory.`, { pair: `${key}=${value}` });
    map.set(key, value);
    editCell(it.overrides, sentence, lineIdx, 'feats', featsToString(map));
    this._setProv(it, sentIndex, lineIdx, `feats:${key}`, { source: 'manual', detail: '' });
    this._setProv(it, sentIndex, lineIdx, 'feats', { source: 'manual', detail: '' });
    await this._afterManual(it, importId, sentIndex);
    return { changed: true, layer: c.layer };
  }

  /** Removes a feature (all its values). Removing something the original file has needs `confirmOriginal`. */
  async removeFeature(importId, sentIndex, lineIdx, key, { confirmOriginal = false } = {}) {
    const { it, sentence, original } = this._row(importId, sentIndex, lineIdx);
    const map = parseFeats(this.workingCols(importId, sentIndex, lineIdx)[5]);
    if (!map.has(key)) return { changed: false };
    const orig = parseFeats(original[5]);
    if (orig.has(key) && !confirmOriginal) throw new ManualEditError('REMOVE_ORIGINAL', `The original file has ${key}=${orig.get(key)}.`, { key, value: orig.get(key), column: 'feats' });
    map.delete(key);
    editCell(it.overrides, sentence, lineIdx, 'feats', featsToString(map));
    this._setProv(it, sentIndex, lineIdx, 'feats', { source: 'manual', detail: `removed ${key}` });
    if (it.provenance[sentIndex] && it.provenance[sentIndex][lineIdx]) delete it.provenance[sentIndex][lineIdx][`feats:${key}`];
    await this._afterManual(it, importId, sentIndex);
    return { changed: true };
  }

  /**
   * Sets one cell of a token by hand: LEMMA, UPOS, XPOS, HEAD, DEPREL or DEPS ("" becomes "_"). ID and FORM are locked.
   * A UPOS / DEPREL in no inventory layer needs `confirmNew`.
   */
  async setCellManual(importId, sentIndex, lineIdx, column, value, { confirmNew = false, ...opts } = {}) {
    const col = String(column).toLowerCase();
    if (LOCKED_COLUMNS.includes(col)) throw new ManualEditError('LOCKED', `${col.toUpperCase()} is locked: changing it would break token alignment and the sentence text.`);
    if (!MANUAL_CELLS.includes(col)) throw new ManualEditError('INVALID', `Use the Feature and MISC controls for ${col.toUpperCase()}`);
    const { it, sentence } = this._row(importId, sentIndex, lineIdx);
    const text = String(value ?? '').trim() || '_';
    if (/[\t\r\n]/.test(text)) throw new ManualEditError('INVALID', 'No tabs or line breaks in a cell');
    if (col === 'head' && !/^(_|\d+)$/.test(text)) throw new ManualEditError('INVALID', 'HEAD is a token number or "_"');
    if (this.workingCols(importId, sentIndex, lineIdx)[CONLLU_COLUMNS.indexOf(col)] === text) return { changed: false };
    if ((col === 'upos' || col === 'deprel') && text !== '_') {
      const usage = this.fileUsage(importId);
      const c = this.inventory.classify(col, text, { lang: this.inventoryLanguage(opts.srcLang, opts.inventoryLang || 'auto'), file: usage[col] });
      if (c.layer === 'new' && !confirmNew) throw new ManualEditError('NEW_VALUE', `${text} is not in the inventory.`, { value: text, column: col });
    }
    editCell(it.overrides, sentence, lineIdx, col, text);
    this._setProv(it, sentIndex, lineIdx, col, { source: 'manual', detail: '' });
    await this._afterManual(it, importId, sentIndex);
    return { changed: true };
  }

  /** MISC segments of a token as they are now: [{ key, value, inOriginal, provenance }]. */
  miscSegments(importId, sentIndex, lineIdx) {
    const { original } = this._row(importId, sentIndex, lineIdx);
    const orig = new Map(parseMisc(original[9]).map((seg) => [seg.key, seg.value]));
    const prov = this.provenance(importId, sentIndex, lineIdx);
    return parseMisc(this.workingCols(importId, sentIndex, lineIdx)[9]).map((seg) => ({
      key: seg.key, value: seg.value === null ? '' : seg.value, inOriginal: orig.has(seg.key) && orig.get(seg.key) === seg.value,
      keyInOriginal: orig.has(seg.key), provenance: prov[`misc:${seg.key}`] || null
    }));
  }

  /** Adds or changes one MISC key by hand. A key that is already there with another value needs `replace`. */
  async setMiscManual(importId, sentIndex, lineIdx, key, value, { replace = false } = {}) {
    const { it, sentence } = this._row(importId, sentIndex, lineIdx);
    const k = String(key || '').trim();
    const v = String(value ?? '').trim();
    if (!MISC_KEY_RE.test(k)) throw new ManualEditError('INVALID', 'A MISC key starts with a letter and has only letters, digits and "_" (or a [layer] like gloss[pt]).');
    if (/[|\t\r\n]/.test(v)) throw new ManualEditError('INVALID', 'A MISC value has no "|", tabs or line breaks.');
    const have = parseMisc(this.workingCols(importId, sentIndex, lineIdx)[9]).find((seg) => seg.key === k);
    if (have && (have.value === null ? '' : have.value) === v) return { changed: false };
    if (have && !replace) throw new ManualEditError('REPLACE', `${k} is already ${have.value === null ? 'set' : have.value}.`, { key: k, have: have.value, pair: `${k}=${v}` });
    editMiscKey(it.overrides, sentence, lineIdx, k, v);
    this._setProv(it, sentIndex, lineIdx, `misc:${k}`, { source: 'manual', detail: '' });
    await this._afterManual(it, importId, sentIndex);
    return { changed: true };
  }

  /** Removes a MISC key. Removing one the original file has needs `confirmOriginal`. */
  async removeMiscManual(importId, sentIndex, lineIdx, key, { confirmOriginal = false } = {}) {
    const { it, sentence, original } = this._row(importId, sentIndex, lineIdx);
    const have = parseMisc(this.workingCols(importId, sentIndex, lineIdx)[9]).find((seg) => seg.key === key);
    if (!have) return { changed: false };
    const orig = parseMisc(original[9]).find((seg) => seg.key === key);
    if (orig && !confirmOriginal) throw new ManualEditError('REMOVE_ORIGINAL', `The original file has ${orig.raw}.`, { key, value: orig.value, column: 'misc' });
    editMiscKey(it.overrides, sentence, lineIdx, key, null);
    this._setProv(it, sentIndex, lineIdx, `misc:${key}`, { source: 'manual', detail: 'removed' });
    await this._afterManual(it, importId, sentIndex);
    return { changed: true };
  }

  /** Features / values the editor offers: { own: [...], other: [...] } (own = this language, this file, universal). */
  featureChoices(importId, opts = {}) {
    const lang = this.inventoryLanguage(opts.srcLang, opts.inventoryLang || 'auto');
    const own = new Set([...this.inventory.featureMap(lang).keys(), ...Object.keys(UNIVERSAL_FEATURES)]);
    for (const pair of this.fileUsage(importId).feats) own.add(pair.slice(0, pair.indexOf('=')));
    const other = [...this.inventory.otherFeatureMap(lang).keys()].filter((k) => !own.has(k));
    return { own: [...own].sort(lowerOrder), other: other.sort(lowerOrder) };
  }

  valueChoices(importId, key, opts = {}) {
    const lang = this.inventoryLanguage(opts.srcLang, opts.inventoryLang || 'auto');
    const own = new Set(this.inventory.featureMap(lang).get(key) || []);
    for (const v of UNIVERSAL_FEATURES[key] || []) own.add(v);
    for (const pair of this.fileUsage(importId).feats) {
      if (pair.slice(0, pair.indexOf('=')) === key) own.add(pair.slice(pair.indexOf('=') + 1));
    }
    const other = [...(this.inventory.otherFeatureMap(lang).get(key) || [])].filter((v) => !own.has(v));
    return { own: [...own].sort(lowerOrder), other: other.sort(lowerOrder) };
  }

  /** UPOS or DEPREL values the editor offers: { own, other }. */
  labelChoices(importId, kind, opts = {}) {
    const lang = this.inventoryLanguage(opts.srcLang, opts.inventoryLang || 'auto');
    const own = new Set(kind === 'upos' ? UNIVERSAL_UPOS : UNIVERSAL_DEPRELS);
    for (const v of this.inventory.labelValues(kind, lang)) own.add(v);
    for (const v of this.fileUsage(importId)[kind]) own.add(v);
    const other = [...this.inventory.labelValues(kind, lang, true)].filter((v) => !own.has(v));
    return { own: [...own].sort(lowerOrder), other: other.sort(lowerOrder) };
  }

  // ---- multi-column enhancement --------------------------------------------------------

  /**
   * Makes the analyzer for `srcLang` available for proposals, without disturbing the workbench. It picks the model
   * the way the workbench does: a model that is already loaded; else the one saved as the active analyzer for that
   * language (downloaded, renewed or uploaded), else the saved UralicNLP one, else the packaged file in models/.
   * There is no download and no starter fallback, and the workbench's active analyzer stays as it was.
   * @returns {Promise<boolean>} whether an analyzer for the language is available
   */
  async prepareLanguage(srcLang) {
    const lang = normalizeLangCode(srcLang);
    if (analyzerService.hasModelForLanguage(lang)) return true;
    const keep = {
      activeLang: analyzerService.activeLang, activeModelId: analyzerService.activeModelId,
      activeModelName: analyzerService.activeModelName, isLoaded: analyzerService.isLoaded
    };
    try {
      let record = null;
      const activeId = await storageService.getSetting('active_analyser_id', null);
      if (activeId) {
        const candidate = await storageService.getModel(activeId);
        if (candidate && candidate.buffer && normalizeLangCode((candidate.metadata && candidate.metadata.lang) || '') === lang) record = candidate;
      }
      if (!record) {
        const saved = await storageService.getModel(`uralic_${lang}_analyser`);
        if (saved && saved.buffer) record = saved;
      }
      let buffer = record ? record.buffer : null;
      const id = record ? record.id : `analyser-${lang}`;
      const name = record ? record.name : `${lang.toUpperCase()} Analyser (${analyzerService.packagedModelPaths[lang] ? analyzerService.packagedModelPaths[lang].split('/').pop() : lang})`;
      if (!buffer && analyzerService.packagedModelPaths[lang]) {
        const path = analyzerService.packagedModelPaths[lang];
        const url = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(path) : path;
        const resp = await fetch(url);
        if (resp.ok) buffer = await resp.arrayBuffer();
      }
      if (!buffer) return false;
      await analyzerService.loadFromBuffer(buffer, id, name, lang, false);
      return analyzerService.hasModelForLanguage(lang);
    } catch (e) {
      return false;
    } finally {
      Object.assign(analyzerService, keep);
    }
  }

  /**
   * Which analyzer build produced the readings for a language: its name and id, where it came from (packaged file in
   * models/, or saved in this browser: downloaded, renewed or uploaded) and, for a saved model, when and how big.
   * @returns {Promise<null|{ lang: string, id: string, name: string, origin: string, savedAt: number|null, size: number|null }>}
   */
  async analyzerInfo(srcLang) {
    const lang = normalizeLangCode(srcLang);
    if (!analyzerService.hasModelForLanguage(lang)) return null;
    const id = analyzerService.modelIds.get(lang) || `analyser-${lang}`;
    const name = analyzerService.modelNames.get(lang) || id;
    let record = null;
    try { record = await storageService.getModel(id); } catch (e) { record = null; }
    let origin;
    if (record) origin = 'saved in this browser (downloaded, renewed or uploaded)';
    else if (id === 'bundled_analyser') origin = 'bundled starter analyzer (a fallback, not made for this language)';
    else if (id === `analyser-${lang}`) origin = `packaged file ${analyzerService.packagedModelPaths[lang] || 'in models/'}`;
    else origin = 'loaded in this session';
    return { lang, id, name, origin, savedAt: record ? record.timestamp || null : null, size: record ? record.size || null : null };
  }

  /** What the imported file itself uses (cached): its own layer of the inventory. */
  fileUsage(importId) {
    const it = this._item(importId);
    if (!it.usage) it.usage = usageOfFile(it.parsed);
    return it.usage;
  }

  /**
   * The inventory language to validate against: the explicit choice, else the language of the text. null means
   * "none": only what this file uses counts (the case for a language without any treebank, such as Apurinã).
   */
  inventoryLanguage(srcLang, choice = 'auto') {
    if (choice === 'none') return null;
    return this.inventory.resolveLanguage(choice && choice !== 'auto' ? choice : srcLang);
  }

  /** Validates a column selection: ID and FORM are locked, anything unknown is refused. */
  _checkColumns(columns) {
    const list = [...new Set((columns && columns.length ? columns : ['misc']).map((c) => String(c).toLowerCase()))];
    for (const c of list) {
      if (LOCKED_COLUMNS.includes(c)) throw new Error(`${c.toUpperCase()} is locked: changing it would break token alignment and the sentence text.`);
      if (!ENHANCE_COLUMNS.includes(c)) throw new Error(`Unknown column "${c}"`);
    }
    return list;
  }

  /** The gloss of a row (target language if present, otherwise the first gloss key). */
  _rowGloss(misc, lang) {
    const own = findExistingGloss(misc, lang);
    if (own) return own.value || '';
    const any = parseMisc(misc).find((seg) => parseGlossKey(seg.key));
    return any ? (any.value || '') : '';
  }

  /**
   * Proposes values for the chosen columns without writing anything. One entry per token and column:
   * { sentIndex, lineIdx, tokenId, form, column, key?, from, to, status, source, note, candidates? }
   * status: 'fill' (empty cell, may be filled), 'conflict' (a value exists and would change: needs
   * explicit acceptance), 'same' (nothing to do), 'none' (no source for this token).
   * Sources: LEMMA/UPOS/XPOS/FEATS from the analyzer reading (FEATS also from the grammatical morphemes of
   * the existing gloss), HEAD/DEPREL baseline guesses for sentences without any dependencies, MISC from the
   * dictionary. DEPS has no source. FEATS proposals only add features; existing values are never replaced.
   * @param {string} importId
   * @param {number|null} sentIndex  null = whole file
   * Proposed UPOS / DEPREL values and FEATS pairs missing from every inventory layer (file, language, universal,
   * Uralic, other languages) get `needsConfirm: true` and `newPairs`; applying them needs `confirmNew: true`.
   * @param {{ srcLang: string, tgtLang?: string, columns?: string[], inventoryLang?: string, xposStyle?: 'short'|'full' }} options
   *   xposStyle: what XPOS receives from a reading: its short POS tag (N, default) or the full analyzer tag string (as emitted)
   *   inventoryLang: 'auto' (language of the text), 'none' (only what the file uses) or an inventory language code
   */
  suggestEnhancements(importId, sentIndex, { srcLang, tgtLang, columns, inventoryLang = 'auto', xposStyle = 'short' } = {}) {
    const it = this._item(importId);
    const invLang = this.inventoryLanguage(srcLang, inventoryLang);
    const usage = this.fileUsage(importId);
    // Flags values missing from every inventory layer: they are proposed but need the user's confirmation
    const flag = (field, kind, items) => {
      const checked = items.map((item) => this.inventory.classify(kind, item, { lang: invLang, file: usage[kind] }));
      field.pairs = checked;
      field.newPairs = checked.filter((c) => c.layer === 'new').map((c) => c.item);
      field.needsConfirm = field.newPairs.length > 0;
      return field;
    };
    const cols = this._checkColumns(columns);
    const conv = detectGlossConvention(it.parsed);
    const lang = tgtLang || conv.lang || 'eng';
    const fields = [];
    const useAnalyzer = analyzerService.hasModelForLanguage(srcLang);
    const recordTags = Boolean(it.exportOptions.recordTags);
    const needsReading = recordTags || cols.some((c) => ['lemma', 'upos', 'xpos', 'feats'].includes(c));
    const indexes = sentIndex === null || sentIndex === undefined ? it.parsed.sentences.map((s) => s.index) : [sentIndex];

    for (const idx of indexes) {
      const sentence = it.parsed.sentences[idx];
      const words = this._wordRows(sentence).map(({ lineIdx }) => ({ lineIdx, cols: this.workingCols(importId, idx, lineIdx) }));
      const base = (w) => ({ sentIndex: idx, lineIdx: w.lineIdx, tokenId: w.cols[0], form: w.cols[1] });

      if (cols.includes('head') || cols.includes('deprel')) {
        const guesses = baselineDependencies(words.map((w) => ({ id: w.cols[0], upos: w.cols[3], head: w.cols[6] })));
        words.forEach((w, i) => {
          const g = guesses[i];
          if (!g) return;
          for (const [column, col, value] of [['head', 6, g.head], ['deprel', 7, g.deprel]]) {
            if (!cols.includes(column) || !isEmptyCell(w.cols[col])) continue;
            const field = { ...base(w), column, from: w.cols[col], to: value, status: 'fill', source: 'baseline guess from UPOS order', note: '' };
            fields.push(column === 'deprel' ? flag(field, 'deprel', [value]) : field);
          }
        });
      }

      for (const w of words) {
        const [, form, lemma, upos, xpos, feats] = w.cols;
        const punct = upos === 'PUNCT' || /^[\p{P}\p{S}]+$/u.test(form);
        if (punct) continue;

        let reading = null;
        if (needsReading && useAnalyzer) {
          try {
            reading = summarizeReadings(analyzerService.analyze_word(form, srcLang), { lemma, upos }, this.readingChoice(importId, idx, w.lineIdx));
          } catch (e) {
            reading = null; // analyzer failed for this word: no proposal from it
          }
        }
        // what the picker needs, shared by the token's LEMMA / UPOS / XPOS / FEATS proposals
        const tokenReading = reading && {
          ambiguous: reading.ambiguous, alternatives: reading.alternatives, choice: reading.choice, choiceStale: reading.choiceStale,
          candidates: reading.candidates, defaultReason: reading.defaultReason, sharedFeats: featsToString(reading.shared)
        };
        const readingNote = () => {
          if (reading.choice) return 'reading chosen by you';
          if (reading.readings > 1) return `${reading.readings} matching readings; first used, needs your choice`;
          return reading.alternatives ? `default from ${reading.defaultReason || 'the only matching reading'}; other readings exist` : '';
        };
        const readingFlags = () => ({ reading: tokenReading, needsChoice: Boolean(reading.ambiguous && !reading.choice) });
        // value of a column from the chosen reading, or from the default pool when its readings agree; null = they differ
        const fromReading = (column) => {
          const key = column === 'xpos' && xposStyle === 'full' ? 'tagString' : column;
          if (reading.ambiguous && !reading.choice && !reading.agree[key]) return null;
          return column === 'xpos' && xposStyle === 'full' ? reading.tagString : reading[column];
        };
        const simple = (column, current) => {
          if (!reading) return;
          const proposed = fromReading(column);
          if (proposed === null) {
            // the default readings disagree on this column: nothing is guessed, the user picks a reading
            fields.push({
              ...base(w), column, from: current, to: current, status: 'none', source: 'analyzer',
              note: 'the readings differ here; needs your choice', ...readingFlags()
            });
            return;
          }
          if (!proposed) return;
          let status = 'same';
          if (current !== proposed) status = isEmptyCell(current) ? 'fill' : 'conflict';
          const field = {
            ...base(w), column, from: current, to: proposed, status, source: 'analyzer',
            note: readingNote(), ...readingFlags()
          };
          fields.push(column === 'upos' && status !== 'same' ? flag(field, 'upos', [proposed]) : field);
        };
        // GTtags (the analyzer's tag readout) for the reading the token is based on: only when that is one reading
        if (recordTags && reading && (!reading.ambiguous || reading.choice) && reading.gtTags) {
          const have = parseMisc(w.cols[9]).find((seg) => seg.key === 'GTtags');
          const haveValue = have ? (have.value === null ? '' : have.value) : null;
          const status = haveValue === null ? 'fill' : haveValue === reading.gtTags ? 'same' : 'conflict';
          fields.push({
            ...base(w), column: 'misc', key: 'GTtags', from: haveValue, to: reading.gtTags, status, source: 'analyzer',
            note: reading.choice ? 'tags of the reading you chose' : 'tags of the default reading', ...readingFlags()
          });
        }
        if (cols.includes('lemma') && reading) simple('lemma', lemma);
        if (cols.includes('upos') && reading) simple('upos', upos);
        if (cols.includes('xpos') && reading) simple('xpos', xpos);

        if (cols.includes('feats')) {
          const gloss = featsFromGloss(this._rowGloss(w.cols[9], lang), upos);
          const proposed = new Map(gloss.feats);
          const sources = [];
          if (gloss.feats.size) sources.push('gloss');
          if (reading && reading.feats.size) {
            for (const [k, v] of reading.feats) proposed.set(k, v);
            sources.push('analyzer');
          }
          if (proposed.size) {
            const merge = mergeFeats(feats, proposed);
            const notes = [];
            if (merge.differing.length) notes.push(`kept existing ${merge.differing.map((d) => `${d.key}=${d.have} (source: ${d.proposed})`).join(', ')}`);
            if (gloss.unmapped.length) notes.push(`unmapped gloss: ${gloss.unmapped.join(', ')}`);
            if (reading && reading.choice) notes.push('reading chosen by you');
            else if (reading && reading.readings > 1) notes.push(`${reading.readings} readings: shared features only; needs your choice`);
            let status = 'same';
            if (merge.added.length) status = isEmptyCell(feats) ? 'fill' : 'conflict';
            const field = {
              ...base(w), column: 'feats', from: feats, to: merge.merged, status, source: sources.join(' + '),
              note: notes.join('; '), added: merge.added, ...(reading ? readingFlags() : {})
            };
            // only the pairs this proposal adds are validated; values already in the cell are the annotator's
            fields.push(status === 'same' ? field : flag(field, 'feats', merge.added.flatMap((k) => proposed.get(k).split(',').map((v) => `${k}=${v}`))));
          } else if (reading && reading.ambiguous) {
            // nothing is shared by the readings: no proposal, but the user can still pick one
            fields.push({
              ...base(w), column: 'feats', from: feats, to: feats, status: 'none', source: 'analyzer',
              note: `${reading.readings} readings share no features${reading.choice ? '' : '; needs your choice'}`, ...readingFlags()
            });
          }
        }
      }
    }

    if (cols.includes('misc')) {
      for (const g of this.suggestGlosses(importId, sentIndex, { srcLang, tgtLang })) {
        const status = { new: 'fill', same: 'same', consistent: 'same', conflict: 'conflict', none: 'none' }[g.status];
        fields.push({
          sentIndex: g.sentIndex, lineIdx: g.lineIdx, tokenId: g.tokenId, form: g.form, column: 'misc', key: g.key,
          from: g.existing, to: g.gloss, status, source: 'dictionary',
          note: g.status === 'consistent' ? 'existing segmented gloss already contains the dictionary gloss' : '',
          candidates: g.candidates
        });
      }
    }
    return fields.sort((a, b) => a.sentIndex - b.sentIndex || a.lineIdx - b.lineIdx);
  }

  /**
   * Writes accepted proposals. A non-empty value is only replaced when the field has `overwrite: true`
   * (the caller sets that after the user accepted it); empty cells are filled as they are. A proposal
   * whose old value no longer matches the working copy is skipped as stale. Everything else is untouched.
   * @returns {Promise<{ written: number, replaced: number, skipped: number, stale: number, unconfirmed: number, byColumn: Object<string, number> }>}
   */
  async applyEnhancements(importId, fields) {
    const it = this._item(importId);
    const result = { written: 0, replaced: 0, skipped: 0, stale: 0, unconfirmed: 0, byColumn: {} };
    const touched = new Set();
    for (const f of fields) {
      if (!ENHANCE_COLUMNS.includes(f.column) || !f.to || f.status === 'none' || f.status === 'same') { result.skipped++; continue; }
      const sentence = it.parsed.sentences[f.sentIndex];
      const col = CONLLU_COLUMNS.indexOf(f.column);
      const working = this.workingCols(importId, f.sentIndex, f.lineIdx);
      let current;
      if (f.column === 'misc') {
        const seg = parseMisc(working[9]).find((s) => s.key === f.key);
        current = seg ? (seg.value || '') : null;
      } else {
        current = working[col];
      }
      if (current !== f.from) { result.stale++; continue; }
      if (f.needsConfirm && !f.confirmNew) { result.unconfirmed++; result.skipped++; continue; }
      const empty = f.column === 'misc' ? current === null : isEmptyCell(current);
      if (!empty && !f.overwrite) { result.skipped++; continue; }
      try {
        if (f.column === 'misc') {
          editMiscKey(it.overrides, sentence, f.lineIdx, f.key, formatGlossValue(f.to, detectGlossConvention(it.parsed).spaceChar));
        } else {
          editCell(it.overrides, sentence, f.lineIdx, f.column, f.to);
        }
      } catch (err) {
        result.skipped++;
        continue;
      }
      if (empty) result.written++; else result.replaced++;
      result.byColumn[f.column] = (result.byColumn[f.column] || 0) + 1;
      // why the value is there: analyzer (and which reading), gloss, dictionary or baseline guess
      const detail = f.reading && f.reading.choice ? f.reading.choice
        : (f.reading && f.reading.ambiguous ? `default: shared features of ${f.reading.candidates.filter((c) => c.inDefault).length} readings` : (f.note || ''));
      this._setProv(it, f.sentIndex, f.lineIdx, f.column === 'misc' ? `misc:${f.key}` : f.column, { source: f.source, detail });
      if (f.column === 'feats') for (const k of f.added || []) this._setProv(it, f.sentIndex, f.lineIdx, `feats:${k}`, { source: f.source, detail });
      touched.add(f.sentIndex);
    }
    for (const si of touched) this._pruneProv(it, si);
    await this._persist(importId);
    return result;
  }
}

export const conlluImportService = new ConlluImportService();
