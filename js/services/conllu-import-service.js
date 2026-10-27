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
import { featureInventory, usageOfFile } from './ud-feature-inventory.js';
import {
  ENHANCE_COLUMNS, LOCKED_COLUMNS, isEmptyCell, mergeFeats, featsFromGloss, summarizeReadings, baselineDependencies
} from './conllu-enhance.js';
import {
  parseConllu, serializeConllu, sentenceRaw, renderSentence, describeChanges, diffSentenceLines,
  detectGlossConvention, glossKeyFor, findExistingGloss, formatGlossValue, glossLangToIso3,
  editCell, editMiscKey, editComment, revertSentence, hasOverrides, applyMiscEdits, parseMisc, parseGlossKey, CONLLU_COLUMNS
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

export class ConlluImportService {
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
      importId, overrides: it.overrides, exportName: it.exportName
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
    await this._persist(importId);
  }

  async revertAll(importId) {
    const it = this._item(importId);
    it.overrides = {};
    await this._persist(importId);
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
      lines: diffSentenceLines(sent, ov, it.parsed.eol)
    };
  }

  /** The working file as CoNLL-U text. Untouched sentences are byte-identical to the original. */
  exportText(importId) {
    const it = this._item(importId);
    return serializeConllu(it.parsed, it.overrides);
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
      if (hasExisting) replaced++; else written++;
    }
    await this._persist(importId);
    return { written, replaced, skipped };
  }

  // ---- multi-column enhancement --------------------------------------------------------

  /**
   * Makes the analyzer for `srcLang` available for proposals, without disturbing the workbench: only a saved
   * or packaged model is loaded (no download, no starter fallback), and the active analyzer stays as it was.
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
      let buffer = null;
      let id = `analyser-${lang}`;
      let name = `${lang.toUpperCase()} Analyser`;
      const saved = await storageService.getModel(`uralic_${lang}_analyser`);
      if (saved && saved.buffer) {
        ({ buffer, id, name } = { buffer: saved.buffer, id: saved.id, name: saved.name });
      } else if (analyzerService.packagedModelPaths[lang]) {
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
   * @param {{ srcLang: string, tgtLang?: string, columns?: string[], inventoryLang?: string }} options
   *   inventoryLang: 'auto' (language of the text), 'none' (only what the file uses) or an inventory language code
   */
  suggestEnhancements(importId, sentIndex, { srcLang, tgtLang, columns, inventoryLang = 'auto' } = {}) {
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
    const needsReading = cols.some((c) => ['lemma', 'upos', 'xpos', 'feats'].includes(c));
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
            reading = summarizeReadings(analyzerService.analyze_word(form, srcLang), { lemma, upos });
          } catch (e) {
            reading = null; // analyzer failed for this word: no proposal from it
          }
        }
        const simple = (column, current, proposed) => {
          if (!reading || !proposed) return;
          let status = 'same';
          if (current !== proposed) status = isEmptyCell(current) ? 'fill' : 'conflict';
          const field = {
            ...base(w), column, from: current, to: proposed, status, source: 'analyzer',
            note: reading.readings > 1 ? `${reading.readings} matching readings; first used` : ''
          };
          fields.push(column === 'upos' && status !== 'same' ? flag(field, 'upos', [proposed]) : field);
        };
        if (cols.includes('lemma') && reading) simple('lemma', lemma, reading.lemma);
        if (cols.includes('upos') && reading) simple('upos', upos, reading.upos);
        if (cols.includes('xpos') && reading) simple('xpos', xpos, reading.xpos);

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
            if (reading && reading.readings > 1) notes.push(`${reading.readings} readings: shared features only`);
            let status = 'same';
            if (merge.added.length) status = isEmptyCell(feats) ? 'fill' : 'conflict';
            const field = {
              ...base(w), column: 'feats', from: feats, to: merge.merged, status, source: sources.join(' + '),
              note: notes.join('; '), added: merge.added
            };
            // only the pairs this proposal adds are validated; values already in the cell are the annotator's
            fields.push(status === 'same' ? field : flag(field, 'feats', merge.added.flatMap((k) => proposed.get(k).split(',').map((v) => `${k}=${v}`))));
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
    }
    await this._persist(importId);
    return result;
  }
}

export const conlluImportService = new ConlluImportService();
