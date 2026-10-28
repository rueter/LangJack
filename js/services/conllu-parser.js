/**
 * CoNLL-U Parser / Patcher: reads an existing UD file without losing anything and writes it back,
 * changing only what was explicitly edited.
 *
 * Design:
 * - parseConllu() keeps every line of every sentence verbatim (text plus its own line ending), so an
 *   untouched sentence serialises to exactly the bytes that were read, whatever the file contained
 *   (CRLF, missing final newline, BOM, multiword ranges, empty nodes, malformed rows, odd comments).
 * - Edits live outside the parsed file as small per-sentence "overrides" (changed columns / MISC keys /
 *   comment keys only). serializeConllu() re-emits the original lines and patches just those.
 * - Pure functions only; storage and the dictionary live in conllu-import-service.js.
 */

export const CONLLU_COLUMNS = ['id', 'form', 'lemma', 'upos', 'xpos', 'feats', 'head', 'deprel', 'deps', 'misc'];
const MISC_COL = CONLLU_COLUMNS.indexOf('misc');

// ---------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------

/** Splits text into lines, remembering each line's own terminator ('\n', '\r\n' or '' for a last line without one). */
function splitLines(text) {
  const out = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) {
      out.push({ text: text.slice(pos), eol: '' });
      break;
    }
    const cr = nl > pos && text[nl - 1] === '\r';
    out.push({ text: text.slice(pos, cr ? nl - 1 : nl), eol: cr ? '\r\n' : '\n' });
    pos = nl + 1;
  }
  return out;
}

const COMMENT_META = /^#\s*([^=\s][^=]*?)\s*=\s?(.*)$/;

/** Classifies one non-blank line; returns the stored line object (text, eol, kind, plus cols/meta/issue). */
function classifyLine(line) {
  if (line.text.startsWith('#')) {
    const m = line.text.match(COMMENT_META);
    return { ...line, kind: 'comment', meta: m ? { key: m[1], value: m[2] } : null };
  }
  const cols = line.text.split('\t');
  if (cols.length !== CONLLU_COLUMNS.length) {
    const hint = cols.length === 1 && /\s{2,}| /.test(line.text) ? ' (columns look space-separated instead of tab-separated)' : '';
    return { ...line, kind: 'malformed', issue: `expected 10 tab-separated columns, found ${cols.length}${hint}` };
  }
  const id = cols[0];
  let kind;
  if (/^\d+$/.test(id)) kind = 'token';
  else if (/^\d+-\d+$/.test(id)) kind = 'mwt';
  else if (/^\d+\.\d+$/.test(id)) kind = 'empty';
  else return { ...line, kind: 'malformed', issue: `invalid ID "${id}"` };
  const blank = cols.findIndex((c) => c === '');
  if (blank !== -1) {
    return { ...line, kind: 'malformed', issue: `empty ${CONLLU_COLUMNS[blank]} column (use "_" for no value)` };
  }
  return { ...line, kind, cols };
}

/**
 * Parses CoNLL-U text.
 * @param {string} text
 * @returns {{ bom: string, preamble: Array, sentences: Array, issues: Array, lineCount: number, eol: string }}
 *   Each sentence: { index, startLine, lines: [{text, eol, kind, cols?, meta?, issue?}], tail: [{text, eol}],
 *   sentId, text }. `tail` holds the blank line(s) that followed the sentence.
 */
export function parseConllu(text) {
  const src = typeof text === 'string' ? text : '';
  const bom = src.charCodeAt(0) === 0xFEFF ? '﻿' : '';
  const rawLines = splitLines(bom ? src.slice(1) : src);

  const parsed = { bom, preamble: [], sentences: [], issues: [], lineCount: rawLines.length, eol: '\n' };
  const crlf = rawLines.filter((l) => l.eol === '\r\n').length;
  const lf = rawLines.filter((l) => l.eol === '\n').length;
  parsed.eol = crlf > lf ? '\r\n' : '\n';

  let cur = null;
  rawLines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.text.trim() === '') {
      if (cur) cur.tail.push(line);
      else parsed.preamble.push(line);
      return;
    }
    const isComment = line.text.startsWith('#');
    if (!cur || cur.tail.length > 0 || (isComment && cur.lines.some((l) => l.kind !== 'comment'))) {
      cur = { index: parsed.sentences.length, startLine: lineNo, lines: [], tail: [], sentId: '', text: '' };
      parsed.sentences.push(cur);
    }
    const classified = classifyLine(line);
    cur.lines.push(classified);
    if (classified.kind === 'comment' && classified.meta) {
      if (classified.meta.key === 'sent_id' && !cur.sentId) cur.sentId = classified.meta.value.trim();
      if (classified.meta.key === 'text' && !cur.text) cur.text = classified.meta.value;
    }
    if (classified.kind === 'malformed') {
      parsed.issues.push({
        severity: 'error', sentIndex: cur.index, sentId: cur.sentId, line: lineNo,
        message: classified.issue, raw: line.text
      });
    }
  });

  const seen = new Map();
  for (const sent of parsed.sentences) {
    if (!sent.lines.some((l) => l.kind === 'token' || l.kind === 'mwt' || l.kind === 'empty' || l.kind === 'malformed')) {
      parsed.issues.push({
        severity: 'warning', sentIndex: sent.index, sentId: sent.sentId, line: sent.startLine,
        message: 'comment block without token rows', raw: sent.lines[0]?.text || ''
      });
    }
    if (!sent.sentId) {
      parsed.issues.push({
        severity: 'warning', sentIndex: sent.index, sentId: '', line: sent.startLine,
        message: 'sentence has no "# sent_id" comment', raw: sent.lines[0]?.text || ''
      });
    } else if (seen.has(sent.sentId)) {
      parsed.issues.push({
        severity: 'warning', sentIndex: sent.index, sentId: sent.sentId, line: sent.startLine,
        message: `duplicate sent_id (also sentence ${seen.get(sent.sentId) + 1})`, raw: sent.sentId
      });
    } else {
      seen.set(sent.sentId, sent.index);
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------------------
// MISC helpers
// ---------------------------------------------------------------------------------------

/** Splits a MISC cell into ordered segments {key, value|null, raw}. "_" is no segments. */
export function parseMisc(misc) {
  if (!misc || misc === '_') return [];
  return misc.split('|').filter((s) => s !== '').map((raw) => {
    const eq = raw.indexOf('=');
    return eq === -1 ? { key: raw, value: null, raw } : { key: raw.slice(0, eq), value: raw.slice(eq + 1), raw };
  });
}

// Alphabetical, case-insensitive by code point (as UD sorts FEATS): "Gloss" before "Gloss[en]", "GTtags" after "Gloss"
const keyOrder = (a, b) => { const x = a.toLowerCase(); const y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

/** MISC segments in alphabetical order of their keys (stable for equal keys). */
export const sortMiscSegments = (segs) => [...segs].sort((p, q) => keyOrder(p.key, q.key));

/** A MISC cell with its Key=Value pairs in alphabetical order ("_" stays "_"). */
export function sortMisc(misc) {
  const segs = parseMisc(misc);
  return segs.length ? sortMiscSegments(segs).map((s) => s.raw).join('|') : '_';
}

/**
 * Sets (string) or removes (null) MISC keys, in place where the key already exists. Whenever a cell is edited the
 * whole cell comes out in alphabetical order of its keys; a cell nobody edits is never touched (see `applyOverrides`).
 */
export function applyMiscEdits(misc, edits) {
  const segs = parseMisc(misc);
  const entries = Object.entries(edits || {});
  for (const [key, value] of entries) {
    const idx = segs.findIndex((s) => s.key === key);
    if (value === null || value === undefined) {
      if (idx !== -1) segs.splice(idx, 1);
      continue;
    }
    const seg = { key, value, raw: value === '' ? key : `${key}=${value}` };
    if (idx !== -1) segs[idx] = seg;
    else segs.push(seg);
  }
  const ordered = entries.length ? sortMiscSegments(segs) : segs;
  return ordered.length ? ordered.map((s) => s.raw).join('|') : '_';
}

// ---------------------------------------------------------------------------------------
// Overrides (edits recorded on top of the immutable original)
// ---------------------------------------------------------------------------------------
// overrides = { [sentIndex]: { cells: {[lineIdx]: {[column]: value}},
//                              misc:  {[lineIdx]: {[key]: value|null}},
//                              comments: {[key]: value|null} } }

const FORBIDDEN = /[\t\r\n]/;

function ensureSent(overrides, sentIndex) {
  if (!overrides[sentIndex]) overrides[sentIndex] = { cells: {}, misc: {}, comments: {} };
  const ov = overrides[sentIndex];
  ov.cells = ov.cells || {};
  ov.misc = ov.misc || {};
  ov.comments = ov.comments || {};
  return ov;
}

/** Drops empty buckets so an override object only ever lists real changes. */
export function pruneOverrides(overrides, sentIndex) {
  const ov = overrides[sentIndex];
  if (!ov) return;
  for (const bucket of ['cells', 'misc']) {
    for (const [lineIdx, edits] of Object.entries(ov[bucket] || {})) {
      if (Object.keys(edits).length === 0) delete ov[bucket][lineIdx];
    }
  }
  if (!Object.keys(ov.cells || {}).length && !Object.keys(ov.misc || {}).length && !Object.keys(ov.comments || {}).length) {
    delete overrides[sentIndex];
  }
}

export function hasOverrides(overrides, sentIndex) {
  return Boolean(overrides && overrides[sentIndex]);
}

function rowAt(sentence, lineIdx) {
  const line = sentence.lines[lineIdx];
  if (!line) throw new Error(`Sentence ${sentence.index + 1} has no line ${lineIdx}`);
  if (!line.cols) throw new Error(`Line ${lineIdx} of sentence ${sentence.index + 1} is not an editable token row`);
  return line;
}

/** Records a column edit (value equal to the original removes the edit). Mutates `overrides`. */
export function editCell(overrides, sentence, lineIdx, column, value) {
  const col = CONLLU_COLUMNS.indexOf(column);
  if (col === -1) throw new Error(`Unknown CoNLL-U column "${column}"`);
  if (typeof value !== 'string' || value === '' || FORBIDDEN.test(value)) {
    throw new Error(`Invalid value for ${column}: must be non-empty text without tabs or line breaks`);
  }
  const line = rowAt(sentence, lineIdx);
  const ov = ensureSent(overrides, sentence.index);
  ov.cells[lineIdx] = ov.cells[lineIdx] || {};
  if (line.cols[col] === value) delete ov.cells[lineIdx][column];
  else ov.cells[lineIdx][column] = value;
  pruneOverrides(overrides, sentence.index);
}

/** Records a MISC key edit: string sets, null removes. Equal-to-original removes the edit. */
export function editMiscKey(overrides, sentence, lineIdx, key, value) {
  if (!key || /[=|\t\r\n]/.test(key)) throw new Error(`Invalid MISC key "${key}"`);
  if (value !== null && (typeof value !== 'string' || /[|\t\r\n]/.test(value))) {
    throw new Error(`Invalid MISC value for ${key}: no "|", tabs or line breaks allowed`);
  }
  const line = rowAt(sentence, lineIdx);
  const original = parseMisc(line.cols[MISC_COL]).find((s) => s.key === key);
  const originalValue = original ? (original.value === null ? '' : original.value) : null;
  const ov = ensureSent(overrides, sentence.index);
  ov.misc[lineIdx] = ov.misc[lineIdx] || {};
  if (value === originalValue) delete ov.misc[lineIdx][key];
  else ov.misc[lineIdx][key] = value;
  pruneOverrides(overrides, sentence.index);
}

/** Records a "# key = value" comment edit: string sets/inserts, null removes. */
export function editComment(overrides, sentence, key, value) {
  if (!key || /[=\t\r\n]/.test(key)) throw new Error(`Invalid comment key "${key}"`);
  if (value !== null && (typeof value !== 'string' || FORBIDDEN.test(value))) {
    throw new Error(`Invalid comment value for ${key}: no tabs or line breaks allowed`);
  }
  const original = sentence.lines.find((l) => l.kind === 'comment' && l.meta && l.meta.key === key);
  const ov = ensureSent(overrides, sentence.index);
  if ((original ? original.meta.value : null) === value) delete ov.comments[key];
  else ov.comments[key] = value;
  pruneOverrides(overrides, sentence.index);
}

/** Reverts one cell of a token row to the original (drops its override). */
export function revertCell(overrides, sentence, lineIdx, column) {
  const ov = overrides[sentence.index];
  if (ov && ov.cells && ov.cells[lineIdx]) delete ov.cells[lineIdx][column];
  pruneOverrides(overrides, sentence.index);
}

/** Reverts one MISC key of a token row to the original. */
export function revertMiscKey(overrides, sentence, lineIdx, key) {
  const ov = overrides[sentence.index];
  if (ov && ov.misc && ov.misc[lineIdx]) delete ov.misc[lineIdx][key];
  pruneOverrides(overrides, sentence.index);
}

/** Reverts every cell and MISC key of one token row to the original; other rows keep their edits. */
export function revertToken(overrides, sentence, lineIdx) {
  const ov = overrides[sentence.index];
  if (ov) {
    if (ov.cells) delete ov.cells[lineIdx];
    if (ov.misc) delete ov.misc[lineIdx];
  }
  pruneOverrides(overrides, sentence.index);
}

/** Removes every recorded edit of one sentence (revert). */
export function revertSentence(overrides, sentIndex) {
  delete overrides[sentIndex];
}

// ---------------------------------------------------------------------------------------
// Rendering / serialising
// ---------------------------------------------------------------------------------------

const lineString = (l) => l.text + l.eol;

/** The exact original text of a sentence block (lines plus the blank lines after it). */
export function sentenceRaw(sentence) {
  return sentence.lines.map(lineString).join('') + sentence.tail.map(lineString).join('');
}

function renderRow(line, lineIdx, ov) {
  const cellEdits = ov.cells && ov.cells[lineIdx];
  const miscEdits = ov.misc && ov.misc[lineIdx];
  if (!cellEdits && !miscEdits) return line.text;
  const cols = line.cols.slice();
  for (const [name, value] of Object.entries(cellEdits || {})) cols[CONLLU_COLUMNS.indexOf(name)] = value;
  if (miscEdits) cols[MISC_COL] = applyMiscEdits(cols[MISC_COL], miscEdits);
  const out = cols.join('\t');
  return out === line.text ? line.text : out;
}

/**
 * Lines of a sentence block after applying its overrides: [{text, eol}] for the body, tail untouched.
 * Without overrides this is exactly the original lines.
 */
export function renderSentenceLines(sentence, ov, fileEol = '\n') {
  if (!ov) return sentence.lines.map((l) => ({ text: l.text, eol: l.eol }));
  const comments = ov.comments || {};
  const handled = new Set();
  const out = [];
  const isComment = []; // parallel to `out`
  const push = (entry, comment) => { out.push(entry); isComment.push(comment); };
  sentence.lines.forEach((line, idx) => {
    if (line.kind === 'comment' && line.meta && Object.prototype.hasOwnProperty.call(comments, line.meta.key)) {
      const key = line.meta.key;
      if (handled.has(key)) { push({ text: line.text, eol: line.eol }, true); return; }
      handled.add(key);
      const value = comments[key];
      if (value === null) return;
      // keep the original "# key = value" spacing style: only swap the value part
      const m = line.text.match(/^(#\s*[^=\s][^=]*?\s*=\s?)(.*)$/);
      push({ text: (m ? m[1] : `# ${key} = `) + value, eol: line.eol }, true);
      return;
    }
    push({ text: line.cols ? renderRow(line, idx, ov) : line.text, eol: line.eol }, line.kind === 'comment');
  });

  // new comment keys go after the last comment line (or first, if the block has none)
  const additions = Object.entries(comments).filter(([key, value]) => value !== null && !handled.has(key));
  if (additions.length) {
    let at = 0;
    isComment.forEach((c, i) => { if (c) at = i + 1; });
    const inserted = additions.map(([key, value]) => ({ text: `# ${key} = ${value}`, eol: fileEol }));
    if (at === out.length && out.length && out[out.length - 1].eol === '' && sentence.tail.length === 0) {
      // block ended without a line break (end of file): give the old last line one, the new last line none
      out[out.length - 1] = { ...out[out.length - 1], eol: fileEol };
      inserted[inserted.length - 1].eol = '';
    }
    out.splice(at, 0, ...inserted);
  }
  return out;
}

/** Serialised block of one sentence (with its tail) after overrides. */
export function renderSentence(sentence, ov, fileEol = '\n') {
  if (!ov) return sentenceRaw(sentence);
  const body = renderSentenceLines(sentence, ov, fileEol).map(lineString).join('');
  return body + sentence.tail.map(lineString).join('');
}

/** Re-emits the whole file; sentences without overrides are the original bytes. */
export function serializeConllu(parsed, overrides = {}) {
  const parts = [parsed.bom, parsed.preamble.map(lineString).join('')];
  for (const sent of parsed.sentences) {
    parts.push(renderSentence(sent, overrides[sent.index], parsed.eol));
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------------------

const fieldLabel = (column) => column;

/**
 * Human-readable list of what differs between original and working sentence:
 * [{ kind: 'cell'|'misc'|'comment', lineIdx?, tokenId?, form?, field, from, to }]
 */
export function describeChanges(sentence, ov) {
  const out = [];
  if (!ov) return out;
  for (const [lineIdx, edits] of Object.entries(ov.cells || {})) {
    const line = sentence.lines[lineIdx];
    for (const [column, value] of Object.entries(edits)) {
      out.push({
        kind: 'cell', lineIdx: Number(lineIdx), tokenId: line.cols[0], form: line.cols[1],
        field: fieldLabel(column), from: line.cols[CONLLU_COLUMNS.indexOf(column)], to: value
      });
    }
  }
  for (const [lineIdx, edits] of Object.entries(ov.misc || {})) {
    const line = sentence.lines[lineIdx];
    const before = parseMisc(line.cols[MISC_COL]);
    for (const [key, value] of Object.entries(edits)) {
      const was = before.find((s) => s.key === key);
      out.push({
        kind: 'misc', lineIdx: Number(lineIdx), tokenId: line.cols[0], form: line.cols[1],
        field: `MISC ${key}`, from: was ? (was.value === null ? '' : was.value) : null, to: value
      });
    }
  }
  for (const [key, value] of Object.entries(ov.comments || {})) {
    const was = sentence.lines.find((l) => l.kind === 'comment' && l.meta && l.meta.key === key);
    out.push({ kind: 'comment', field: `# ${key}`, from: was ? was.meta.value : null, to: value });
  }
  return out.sort((a, b) => (a.lineIdx ?? -1) - (b.lineIdx ?? -1));
}

/** Line-level diff (LCS) of original vs. working sentence: [{ type: 'same'|'removed'|'added', text }]. */
export function diffSentenceLines(sentence, ov, fileEol = '\n') {
  const a = sentence.lines.map((l) => l.text);
  const b = renderSentenceLines(sentence, ov, fileEol).map((l) => l.text);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: 'removed', text: a[i++] });
    else out.push({ type: 'added', text: b[j++] });
  }
  while (i < n) out.push({ type: 'removed', text: a[i++] });
  while (j < m) out.push({ type: 'added', text: b[j++] });
  return out;
}

// ---------------------------------------------------------------------------------------
// Gloss convention
// ---------------------------------------------------------------------------------------

const GLOSS_BRACKET = /^(gloss)\[([^\]]+)\]$/i;
const GLOSS_UNDERSCORE = /^(gloss)_(.+)$/i;

const LANG2_TO_3 = {
  pt: 'por', en: 'eng', fi: 'fin', ru: 'rus', es: 'spa', de: 'deu', fr: 'fra', sv: 'swe', et: 'est',
  hu: 'hun', it: 'ita', nl: 'nld', no: 'nor', da: 'dan', cs: 'ces', pl: 'pol', uk: 'ukr', la: 'lat'
};

/** Normalises a gloss language code to ISO 639-3 where we know the 2-letter form ("pt" -> "por"). */
export function glossLangToIso3(lang) {
  const l = String(lang || '').toLowerCase().trim();
  return LANG2_TO_3[l] || l;
}

export const sameGlossLang = (a, b) => glossLangToIso3(a) === glossLangToIso3(b);

/** If `key` is a gloss key in either style, returns {prefix, lang, style}; otherwise null. */
export function parseGlossKey(key) {
  let m = key.match(GLOSS_BRACKET);
  if (m) return { prefix: m[1], lang: m[2], style: 'bracket' };
  m = key.match(GLOSS_UNDERSCORE);
  if (m) return { prefix: m[1], lang: m[2], style: 'underscore' };
  return null;
}

/**
 * Finds which gloss key(s) the file uses on its token rows (original MISC cells).
 * @returns {{ key: string|null, style: 'bracket'|'underscore'|null, prefix: string, lang: string|null,
 *   counts: Object<string, number>, mixed: boolean, total: number, spaceChar: string }}
 *   `key` is the dominant key (most used; ties prefer bracket style), null when the file has no glosses.
 */
export function detectGlossConvention(parsed) {
  const counts = {};
  let dotted = 0;
  let underscored = 0;
  for (const sent of parsed.sentences) {
    for (const line of sent.lines) {
      if (!line.cols) continue;
      for (const seg of parseMisc(line.cols[MISC_COL])) {
        if (parseGlossKey(seg.key)) {
          counts[seg.key] = (counts[seg.key] || 0) + 1;
          const v = seg.value || '';
          if (/\p{L}\.\p{L}/u.test(v)) dotted++;
          if (/\p{L}_\p{L}/u.test(v)) underscored++;
        }
      }
    }
  }
  const keys = Object.keys(counts).sort((a, b) => {
    if (counts[b] !== counts[a]) return counts[b] - counts[a];
    return (parseGlossKey(a).style === 'bracket' ? 0 : 1) - (parseGlossKey(b).style === 'bracket' ? 0 : 1);
  });
  const total = keys.reduce((n, k) => n + counts[k], 0);
  const dominant = keys[0] || null;
  const info = dominant ? parseGlossKey(dominant) : null;
  return {
    key: dominant,
    style: info ? info.style : null,
    prefix: info ? info.prefix : 'gloss',
    lang: info ? info.lang : null,
    counts,
    mixed: keys.length > 1,
    total,
    spaceChar: underscored > dotted ? '_' : (dotted > 0 ? '.' : '_')
  };
}

/** The MISC key to write a gloss in `lang`, following the file's dominant style. */
export function glossKeyFor(convention, lang) {
  const style = convention.style || 'bracket';
  const prefix = convention.prefix || 'gloss';
  if (convention.key && convention.lang && sameGlossLang(convention.lang, lang)) return convention.key;
  return style === 'underscore' ? `${prefix}_${lang}` : `${prefix}[${lang}]`;
}

/** Existing gloss segment of a token row (any style, matching language), or null. */
export function findExistingGloss(miscCell, lang) {
  return parseMisc(miscCell).find((s) => {
    const info = parseGlossKey(s.key);
    return info && sameGlossLang(info.lang, lang);
  }) || null;
}

/** Makes a dictionary gloss safe for a MISC value (no spaces, pipes, tabs); spaces become `spaceChar`. */
export function formatGlossValue(gloss, spaceChar = '_') {
  return String(gloss || '').trim().replace(/[|\t\r\n]/g, ' ').replace(/\s+/g, spaceChar);
}
