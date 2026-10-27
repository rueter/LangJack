/**
 * Ve'rdd API client plus the pure logic behind the Ve'rdd Workbench panel.
 *
 * No DOM access: fetch and the extension permissions API are injectable, so the whole
 * module runs under bare Node tests.
 *
 * A "row" is one draft dictionary entry:
 *   { id, srcLang, lemma, pos, srcHomoId, tgtLang, translation, tgtPos, tgtHomoId,
 *     exSrc, exTgt, exSource, guessed, origin, status, message, srcMatches, tgtMatches }
 * Ve'rdd requires every lexeme to have a POS; homoId is only needed to tell homonyms
 * (same lemma, POS and language) apart.
 */

export const MAX_LEXEME = 250;
export const MAX_POS = 25;
export const MAX_EXAMPLE = 250;
export const MAX_BULK_PAIRS = 100;

// Ve'rdd keeps one flat POS value per lexical class (Prop, Aux, Po and Pr stay distinct);
// the export formats map them (e.g. Prop -> N+Prop / np / PROPN) on their side.
// UND marks a word whose POS is undetermined. X is reserved in Ve'rdd for words meant
// for recycling, so LangJack never produces it.
export const POS_UNDETERMINED = 'UND';
const LANGJACK_TO_VERDD_POS = {
  N: 'N', Prop: 'Prop', V: 'V', Aux: 'Aux', A: 'A', Adv: 'Adv', Pron: 'Pron', Num: 'Num',
  Po: 'Po', Pr: 'Pr', CC: 'CC', CS: 'CS', Pcle: 'Pcle', Interj: 'Interj', Det: 'Det'
};

// Offered when Ve'rdd cannot be reached; the live list from GET /pos/ replaces it.
export const VERDD_POS_FALLBACK = ['A', 'Adv', 'Aux', 'CC', 'CS', 'Det', 'Interj', 'N', 'Num', 'Pcle', 'Po', 'Pr', 'Pron', 'Prop', 'UND', 'V'];

// The values Ve'rdd treats as "no real POS yet" (same list as api/merge.py).
const UNDETERMINED_VALUES = ['', 'ZERO', 'UND'];
export const isUndetermined = (pos) => UNDETERMINED_VALUES.includes(String(pos ?? '').trim());

/** The Ve'rdd POS for a LangJack/HFST tag; UND when it cannot be determined. */
export function toVerddPos(pos, knownPos = []) {
  if (String(pos).toUpperCase() === 'X') return POS_UNDETERMINED; // never reached through knownPos either
  const findKnown = (tag) => knownPos.find(k => k.toLowerCase() === String(tag).toLowerCase());
  const mapped = (Object.hasOwn(LANGJACK_TO_VERDD_POS, pos) ? LANGJACK_TO_VERDD_POS[pos] : findKnown(pos)) || POS_UNDETERMINED;
  return findKnown(mapped) || mapped;
}

// ---------------------------------------------------------------------------------------
// Connection settings
// ---------------------------------------------------------------------------------------

export function normalizeBaseUrl(input) {
  let text = String(input || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) {
    text = (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(text) ? 'http://' : 'https://') + text;
  }
  try {
    const url = new URL(text);
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    return url.origin + path;
  } catch {
    return '';
  }
}

export function originPattern(baseUrl) {
  return new URL(baseUrl).origin + '/*';
}

function defaultPermissionsApi() {
  return globalThis.browser?.permissions ?? globalThis.chrome?.permissions ?? null;
}

/** Ask the browser for access to the Ve'rdd origin. Must run from a click handler. */
export async function ensureOriginPermission(baseUrl, permissionsApi = defaultPermissionsApi()) {
  if (!permissionsApi?.request) return true; // plain web page / PWA: nothing to ask
  const query = { origins: [originPattern(baseUrl)] };
  if (permissionsApi.contains && await permissionsApi.contains(query)) return true;
  return Boolean(await permissionsApi.request(query));
}

const SETTING_URL = 'verdd_base_url';
const SETTING_TOKEN = 'verdd_token';

export async function loadVerddConfig(store) {
  return {
    baseUrl: await store.getSetting(SETTING_URL, ''),
    token: await store.getSetting(SETTING_TOKEN, '')
  };
}

export async function saveVerddConfig(store, { baseUrl, token }) {
  await store.setSetting(SETTING_URL, normalizeBaseUrl(baseUrl));
  await store.setSetting(SETTING_TOKEN, String(token || '').trim());
}

// ---------------------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------------------

export class VerddApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = 'VerddApiError';
    this.status = status;
    this.data = data;
  }
}

/** Flatten Django REST Framework error bodies into one readable line. */
export function describeApiError(errorOrData) {
  const data = errorOrData instanceof VerddApiError ? errorOrData.data : errorOrData;
  if (data == null) return errorOrData?.message || 'Unknown error';
  if (typeof data === 'string') return data;

  const parts = [];
  const walk = (value, label) => {
    if (Array.isArray(value)) {
      value.forEach(item => walk(item, label));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, inner]) => {
        const skip = key === 'non_field_errors' || key === 'detail';
        walk(inner, skip ? label : (label ? `${label}.${key}` : key));
      });
    } else if (value != null) {
      parts.push(label ? `${label}: ${value}` : String(value));
    }
  };
  walk(data, '');
  return parts.join('; ') || errorOrData?.message || 'Unknown error';
}

export class VerddApi {
  constructor({ baseUrl, token, fetchImpl = (...args) => globalThis.fetch(...args) }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = String(token || '').trim();
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.baseUrl && this.token);
  }

  async request(method, path, { query, body } = {}) {
    if (!this.configured) {
      throw new VerddApiError(0, "Set the Ve'rdd address and API token in the Connection tab first.");
    }
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const suffix = params.toString() ? `?${params}` : '';
    const url = `${this.baseUrl}/api/v1${path}${suffix}`;

    const headers = { Authorization: `Token ${this.token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        credentials: 'omit',
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new VerddApiError(0,
        `Cannot reach ${this.baseUrl}. Check the address, your connection, and that LangJack was granted access to that site.`);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) throw new VerddApiError(response.status, this.statusMessage(response.status, data), data);
    return data;
  }

  statusMessage(status, data) {
    if (status === 401) return "Ve'rdd rejected the API token.";
    if (status === 403) return "This Ve'rdd account has no editing rights (it must be staff).";
    if (status === 404 && typeof data === 'string') {
      return `No Ve'rdd API at ${this.baseUrl}. Use the Ve'rdd root address, for example https://host/verdd.`;
    }
    if (status === 429) return "Ve'rdd is limiting how fast requests arrive. Wait a few seconds and try again.";
    if (status >= 500) return `Ve'rdd reported a server error (${status}).`;
    return describeApiError(data) || `Request failed (${status}).`;
  }

  // -- reading ---------------------------------------------------------------------------
  me() { return this.request('GET', '/me/'); }
  languages() { return this.request('GET', '/languages/'); }
  pos() { return this.request('GET', '/pos/'); }

  async findLexemes({ language, lexeme, pos, q, limit = 100, offset }) {
    const page = await this.request('GET', '/lexemes/', { query: { language, lexeme, pos, q, limit, offset } });
    return page.results;
  }

  async searchLexemes(filters) {
    const { limit = 25, offset = 0 } = filters;
    const page = await this.request('GET', '/lexemes/', { query: { ...filters, limit, offset } });
    return { total: page.count, results: page.results };
  }

  getLexeme(id) { return this.request('GET', `/lexemes/${id}/`); }

  async relationsFrom(lexemeId, { limit = 200 } = {}) {
    return (await this.request('GET', '/relations/', { query: { lexeme_from: lexemeId, limit } })).results;
  }

  async relationsTo(lexemeId, { limit = 200 } = {}) {
    return (await this.request('GET', '/relations/', { query: { lexeme_to: lexemeId, limit } })).results;
  }

  // -- writing ---------------------------------------------------------------------------
  createLexeme(fields) { return this.request('POST', '/lexemes/', { body: fields }); }
  updateLexeme(id, fields) { return this.request('PATCH', `/lexemes/${id}/`, { body: fields }); }
  updateRelation(id, fields) { return this.request('PATCH', `/relations/${id}/`, { body: fields }); }
  deleteRelation(id) { return this.request('DELETE', `/relations/${id}/`); }
  createRelationExample(fields) { return this.request('POST', '/relation-examples/', { body: fields }); }
  updateRelationExample(id, fields) { return this.request('PATCH', `/relation-examples/${id}/`, { body: fields }); }
  deleteRelationExample(id) { return this.request('DELETE', `/relation-examples/${id}/`); }
  linkExamples(exampleFrom, exampleTo) {
    return this.request('POST', '/relation-example-links/', { body: { example_from: exampleFrom, example_to: exampleTo } });
  }

  /** Entries with undetermined POS that share headword and language with a real-POS entry. */
  async mergeCandidates({ language, limit = 10, offset = 0 } = {}) {
    const page = await this.request('GET', '/lexemes/merge-candidates/', { query: { language, limit, offset } });
    return { total: page.count, groups: page.results };
  }

  /**
   * Absorb one entry into another. dryRun previews without changing anything; entries whose
   * headwords or parts of speech differ are only joined with allowDifferentHeadword and
   * allowDifferentPos (the absorbed entry's value is then dropped, the kept entry's stays).
   */
  mergeLexeme(absorbedId, keeperId, { dryRun = false, allowDifferentHeadword = false, allowDifferentPos = false } = {}) {
    const body = { into: keeperId, dry_run: dryRun };
    if (allowDifferentHeadword) body.allow_different_headword = true;
    if (allowDifferentPos) body.allow_different_pos = true;
    return this.request('POST', `/lexemes/${absorbedId}/merge/`, { body });
  }

  async lexemeExamples(lexemeId, { limit = 200 } = {}) {
    return (await this.request('GET', '/examples/', { query: { lexeme: lexemeId, limit } })).results;
  }

  /**
   * Move the chosen relations and examples of an entry onto a new entry of the same language
   * (the inverse of a merge). `fields` may set lexeme, pos and homoId of the new entry.
   */
  splitLexeme(id, { relations = [], examples = [], dryRun = false, ...fields } = {}) {
    const body = { relations, examples, dry_run: dryRun };
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') body[key] = value;
    });
    return this.request('POST', `/lexemes/${id}/split/`, { body });
  }

  async sendPairs(payloads) {
    const results = [];
    for (let i = 0; i < payloads.length; i += MAX_BULK_PAIRS) {
      const chunk = payloads.slice(i, i + MAX_BULK_PAIRS);
      const response = await this.request('POST', '/pairs/bulk/', { body: { pairs: chunk } });
      results.push(...response.results);
    }
    return results;
  }
}

// ---------------------------------------------------------------------------------------
// Merging undetermined entries
// ---------------------------------------------------------------------------------------

const MERGE_LABELS = {
  relations: ['relation', 'relations'],
  examples: ['example', 'examples'],
  metadata: ['metadata row', 'metadata rows'],
  paradigms: ['paradigm form', 'paradigm forms'],
  affiliations: ['affiliation', 'affiliations'],
  stems: ['stem', 'stems'],
  stem_metadata: ['stem metadata row', 'stem metadata rows'],
  relation_examples: ['translation example', 'translation examples'],
  relations_between_the_two: ['relation between the two entries', 'relations between the two entries']
};

const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

/** Short summary of what hangs off an entry, e.g. "2 relations, 1 example". */
export function describeCounts(counts) {
  const parts = [
    [(counts.relations_from || 0) + (counts.relations_to || 0), MERGE_LABELS.relations],
    [counts.examples || 0, MERGE_LABELS.examples],
    [counts.metadata || 0, MERGE_LABELS.metadata],
    [counts.paradigms || 0, MERGE_LABELS.paradigms],
    [counts.affiliations || 0, MERGE_LABELS.affiliations],
    [counts.stems || 0, MERGE_LABELS.stems]
  ].filter(([n]) => n > 0).map(([n, label]) => plural(n, label));
  return parts.length ? parts.join(', ') : 'empty';
}

/** The merge report as plain sentences, one per line. */
export function describeMerge(report) {
  const lines = [];
  const each = (group, make) => Object.entries(report[group] || {}).forEach(([key, n]) => {
    if (n > 0 && MERGE_LABELS[key]) lines.push(make(plural(n, MERGE_LABELS[key])));
  });
  each('moved', (what) => `Moves ${what} to the kept entry.`);
  each('deduplicated', (what) => `Folds ${what} into what the kept entry already has.`);
  each('dropped', (what) => `Drops ${what} (they would point an entry at itself).`);
  if (report.headword_dropped) lines.push(`The headword "${report.headword_dropped}" is dropped; the kept entry keeps its own.`);
  if (report.pos_dropped) lines.push(`The part of speech ${report.pos_dropped} of the absorbed entry is dropped; the kept entry stays ${report.into?.pos}.`);
  if (report.pos_set) lines.push(`The kept entry has no part of speech yet, so it becomes ${report.pos_set}.`);
  if (report.fields_copied?.length) lines.push(`Fills the kept entry's empty ${report.fields_copied.join(', ')}.`);
  (report.notes || []).forEach(note => lines.push(note));
  if (report.keeper_unapproved) lines.push('The kept entry becomes unapproved so it is reviewed again.');
  if (!lines.length) lines.push('Nothing to move: the absorbed entry is empty.');
  return lines;
}

const SPLIT_LABELS = {
  relations: ['relation', 'relations'],
  mirror_relations: ['mirrored relation', 'mirrored relations'],
  examples: ['example', 'examples']
};

/** The split report as plain sentences, one per line. */
export function describeSplit(report) {
  const lines = [];
  Object.entries(report.moved || {}).forEach(([key, n]) => {
    if (n > 0 && SPLIT_LABELS[key]) lines.push(`Moves ${plural(n, SPLIT_LABELS[key])} to the new entry.`);
  });
  lines.push('Forms, stems and metadata stay on the original entry.');
  (report.notes || []).forEach(note => lines.push(note));
  if (report.source_unapproved) lines.push('The original entry becomes unapproved so it is reviewed again.');
  lines.push('The new entry starts unapproved.');
  return lines;
}

// ---------------------------------------------------------------------------------------
// Editing a headword, finding the same word elsewhere, deciding what can be joined
// ---------------------------------------------------------------------------------------

const BRACKET_PLACEHOLDER = /[(\[{]\s*[.\u2026\u00b7_\u2013\u2014*?-]*\s*[)\]}]/gu;
const WHOLLY_BRACKETED = /^[(\[{]\s*([^()\[\]{}]+?)\s*[)\]}]$/u;

/**
 * A cleaner version of a headword: drops empty bracket placeholders such as "( )" or "(…)",
 * unwraps a headword that is entirely in brackets and tidies the spaces. Anything else that
 * looks like a deliberate part of the word is left alone.
 */
export function tidyHeadword(text) {
  let out = String(text ?? '').replace(BRACKET_PLACEHOLDER, ' ').replace(/\s+/g, ' ').trim();
  const wrapped = out.match(WHOLLY_BRACKETED);
  if (wrapped) out = wrapped[1];
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * The browser-side mirror of the server's merge rules, used to explain why two entries
 * cannot be joined before asking the server. `differentHeadword` and `differentPos` mean the
 * join needs the user's explicit confirmation; different parts of speech are only accepted
 * with `allowDifferentPos`, which the panel sets once the user has chosen the other
 * entry's POS for this one.
 */
export function mergeVerdict(absorbed, keeper, { allowDifferentPos = false } = {}) {
  if (absorbed.id === keeper.id) return { ok: false, reason: 'An entry cannot be merged into itself.' };
  if (absorbed.language !== keeper.language) return { ok: false, reason: 'Only entries of the same language can be merged.' };
  const differentPos = !isUndetermined(absorbed.pos) && !isUndetermined(keeper.pos) && absorbed.pos !== keeper.pos;
  if (differentPos && !allowDifferentPos) {
    return { ok: false, reason: `They have different parts of speech (${absorbed.pos} and ${keeper.pos}), so they may be different entries. If one has the wrong part of speech, set it to match the other and press Save entry; you will then be offered the merge.` };
  }
  return { ok: true, differentHeadword: absorbed.lexeme !== keeper.lexeme, differentPos, takesPos: isUndetermined(keeper.pos) && !isUndetermined(absorbed.pos) };
}

async function describeLexemes(api, lexemes) {
  return Promise.all(lexemes.slice(0, 12).map(async lexeme => {
    let translations = [];
    try {
      translations = (await api.relationsFrom(lexeme.id, { limit: 5 }))
        .map(r => r.lexeme_to_info?.lexeme).filter(Boolean);
    } catch { /* hints only; the entry itself is what matters */ }
    return {
      id: lexeme.id, lexeme: lexeme.lexeme, language: lexeme.language, pos: lexeme.pos,
      homoId: lexeme.homoId, checked: lexeme.checked, translations
    };
  }));
}

/**
 * Other entries of the same language that carry the same headword, as written or tidied
 * ("( ) word" finds "word"): the candidates for a merge.
 */
export async function findTwins(api, lexeme) {
  const spellings = [...new Set([lexeme.lexeme, tidyHeadword(lexeme.lexeme)].filter(Boolean))];
  const found = new Map();
  for (const spelling of spellings) {
    const matches = await api.findLexemes({ language: lexeme.language, lexeme: spelling });
    matches.forEach(m => { if (m.id !== lexeme.id) found.set(m.id, m); });
  }
  return describeLexemes(api, [...found.values()]);
}

/** Look one entry up by number, for merging with an entry the search did not suggest. */
export async function describeById(api, id) {
  const lexeme = await api.getLexeme(id);
  return (await describeLexemes(api, [lexeme]))[0];
}

/**
 * The other entry that already has the headword, POS and homonym number the edit would
 * give this one (Ve'rdd allows each combination once), or null.
 */
export async function findEditCollision(api, original, fields) {
  const lexeme = fields.lexeme ?? original.lexeme;
  const pos = fields.pos ?? original.pos;
  const homoId = fields.homoId ?? original.homoId;
  if (lexeme === original.lexeme && pos === original.pos && homoId === original.homoId) return null;
  const matches = await api.findLexemes({ language: original.language, lexeme, pos });
  const clash = matches.find(m => m.id !== original.id && m.homoId === homoId);
  return clash ? (await describeLexemes(api, [clash]))[0] : null;
}

// ---------------------------------------------------------------------------------------
// Draft rows
// ---------------------------------------------------------------------------------------

let rowSequence = 0;

export function newRow(fields = {}) {
  return {
    id: ++rowSequence,
    srcLang: '', lemma: '', pos: '', srcHomoId: null,
    tgtLang: '', translation: '', tgtPos: '', tgtHomoId: null,
    exSrc: '', exTgt: '', exSource: '',
    guessed: false, origin: 'manual',
    status: 'draft', message: '',
    srcMatches: null, tgtMatches: null,
    ...fields
  };
}

/**
 * Turn the analysed workspace into draft rows: one per distinct lemma/POS/gloss, carrying
 * the sentence as its example and the sentence translation in the gloss language.
 */
export function draftsFromSentences(sentences, translations, srcLang, defaultTgtLang, knownPos = []) {
  const usable = (translations || []).filter(t => t.text && t.text.trim());
  const rows = [];
  const seen = new Set();
  const fallbackLang = defaultTgtLang && defaultTgtLang !== 'all' ? defaultTgtLang : '';

  (sentences || []).forEach(sentence => {
    (sentence.tokens || []).forEach(token => {
      if (token.isPunct) return;
      const reading = token.customReading || token.selectedReading || {};
      const lemma = (token.lemma || reading.lemma || token.form || '').trim();
      if (!lemma) return;

      const glossText = (token.customGloss || token.selectedGloss?.gloss || '').trim();
      const tgtLang = (token.customGlossLang || token.selectedGloss?.lang || fallbackLang || '').toLowerCase();
      const pos = toVerddPos(reading.pos || '', knownPos);
      const sentenceText = (sentence.text || '').trim();
      const translated = usable.find(t => (t.lang || '').toLowerCase() === tgtLang);

      const key = [lemma, pos, tgtLang, glossText, sentenceText].join('\u0001');
      if (seen.has(key)) return;
      seen.add(key);

      rows.push(newRow({
        srcLang: (srcLang || '').toLowerCase(), lemma, pos,
        tgtLang, translation: glossText,
        exSrc: sentenceText, exTgt: translated ? translated.text.trim() : '',
        guessed: Boolean(reading.isGuessed), origin: 'analysis'
      }));
    });
  });
  return rows;
}

const isBlank = (value) => !String(value ?? '').trim();
const validHomoId = (value) => value === null || value === undefined || value === '' || (Number.isInteger(Number(value)) && Number(value) >= 0);

/** Problems that stop a row from being sent. An empty list means the row is complete. */
export function validateRow(row, { languages = null } = {}) {
  const problems = [];
  const add = (field, message) => problems.push({ field, message });
  const has = (text) => !isBlank(text);

  if (isBlank(row.lemma)) add('lemma', 'Enter the headword.');
  else if (row.lemma.trim().length > MAX_LEXEME) add('lemma', `Headword is longer than ${MAX_LEXEME} characters.`);
  if (isBlank(row.srcLang)) add('srcLang', 'Choose the headword language.');
  if (isBlank(row.pos)) add('pos', "Part of speech is required by Ve'rdd.");
  else if (row.pos.trim().length > MAX_POS) add('pos', `POS is longer than ${MAX_POS} characters.`);
  if (!validHomoId(row.srcHomoId)) add('srcHomoId', 'Homonym number must be 0 or a positive whole number.');

  const hasTranslation = has(row.translation);
  if (hasTranslation) {
    if (row.translation.trim().length > MAX_LEXEME) add('translation', `Translation is longer than ${MAX_LEXEME} characters.`);
    if (isBlank(row.tgtLang)) add('tgtLang', 'Choose the translation language.');
    else if (row.tgtLang.trim() === row.srcLang.trim()) add('tgtLang', 'Translation language must differ from the headword language.');
    if (has(row.tgtPos) && row.tgtPos.trim().length > MAX_POS) add('tgtPos', `POS is longer than ${MAX_POS} characters.`);
    if (!validHomoId(row.tgtHomoId)) add('tgtHomoId', 'Homonym number must be 0 or a positive whole number.');
  } else if (has(row.exSrc) || has(row.exTgt)) {
    add('translation', 'An example is stored with a translation; add one or clear the example.');
  }

  if (has(row.exTgt) && isBlank(row.exSrc)) add('exSrc', 'The translated example needs its source sentence.');
  [['exSrc', row.exSrc], ['exTgt', row.exTgt]].forEach(([field, text]) => {
    if (has(text) && text.trim().length > MAX_EXAMPLE) add(field, `Example is longer than ${MAX_EXAMPLE} characters.`);
  });

  if (languages) {
    const known = new Set(languages);
    if (has(row.srcLang) && !known.has(row.srcLang.trim())) add('srcLang', `Language "${row.srcLang}" does not exist in Ve'rdd.`);
    if (hasTranslation && has(row.tgtLang) && !known.has(row.tgtLang.trim())) add('tgtLang', `Language "${row.tgtLang}" does not exist in Ve'rdd.`);
  }
  return problems;
}

const optionalHomoId = (value) => (value === null || value === undefined || value === '' ? undefined : Number(value));

/** Request body for POST /pairs/ (a row with a translation). */
export function rowToPairPayload(row) {
  const lexeme = (text, language, pos, homoId) => {
    const out = { lexeme: text.trim(), language: language.trim() };
    if (!isBlank(pos)) out.pos = pos.trim();
    const homo = optionalHomoId(homoId);
    if (homo !== undefined) out.homoId = homo;
    return out;
  };

  const payload = {
    source: lexeme(row.lemma, row.srcLang, row.pos, row.srcHomoId),
    target: lexeme(row.translation, row.tgtLang, row.tgtPos, row.tgtHomoId)
  };
  if (!isBlank(row.exSrc)) {
    const example = { source_text: row.exSrc.trim() };
    if (!isBlank(row.exTgt)) example.target_text = row.exTgt.trim();
    // A provenance link too long for Ve'rdd's field would be cut into a broken link.
    if (!isBlank(row.exSource) && row.exSource.trim().length <= MAX_EXAMPLE) example.source = row.exSource.trim();
    payload.examples = [example];
  }
  return payload;
}

// ---------------------------------------------------------------------------------------
// Homonyms
// ---------------------------------------------------------------------------------------

export function nextHomoId(matches) {
  return (matches || []).reduce((highest, m) => Math.max(highest, m.homoId), -1) + 1;
}

/**
 * Where a lexeme stands against Ve'rdd:
 *  new          nothing matches; it will be created
 *  reuse        one match and no homoId given; the existing entry is used
 *  choose       several homonyms match and none was picked; sending is blocked
 *  chosen       the picked homoId is an existing entry
 *  newHomonym   the picked homoId is unused; a further homonym will be created
 */
export function homoState(matches, homoId) {
  const picked = optionalHomoId(homoId);
  if (!matches || matches.length === 0) return 'new';
  if (picked === undefined) return matches.length === 1 ? 'reuse' : 'choose';
  return matches.some(m => m.homoId === picked) ? 'chosen' : 'newHomonym';
}

async function describeMatches(api, lexemes) {
  return Promise.all(lexemes.slice(0, 6).map(async lexeme => {
    let translations = [];
    try {
      translations = (await api.relationsFrom(lexeme.id, { limit: 5 }))
        .map(r => r.lexeme_to_info?.lexeme).filter(Boolean);
    } catch { /* hints only; the match itself is what matters */ }
    return { id: lexeme.id, homoId: lexeme.homoId, checked: lexeme.checked, notes: lexeme.notes, translations };
  }));
}

/** Look the row's lexemes up in Ve'rdd so homonyms can be resolved before sending. */
export async function checkRow(api, row) {
  const canLookUpSource = !isBlank(row.lemma) && !isBlank(row.srcLang) && !isBlank(row.pos);
  const targetPos = isBlank(row.tgtPos) ? row.pos : row.tgtPos;
  const canLookUpTarget = !isBlank(row.translation) && !isBlank(row.tgtLang) && !isBlank(targetPos);

  const [source, target] = await Promise.all([
    canLookUpSource ? api.findLexemes({ language: row.srcLang.trim(), lexeme: row.lemma.trim(), pos: row.pos.trim() }) : [],
    canLookUpTarget ? api.findLexemes({ language: row.tgtLang.trim(), lexeme: row.translation.trim(), pos: targetPos.trim() }) : []
  ]);
  row.srcMatches = await describeMatches(api, source);
  row.tgtMatches = await describeMatches(api, target);
}

/** Why a row cannot be sent yet, or an empty list. */
export function blockingReasons(row, options) {
  const reasons = validateRow(row, options).map(p => p.message);
  if (homoState(row.srcMatches, row.srcHomoId) === 'choose') reasons.push('Several homonyms of the headword exist; choose which one.');
  if (!isBlank(row.translation) && homoState(row.tgtMatches, row.tgtHomoId) === 'choose') {
    reasons.push('Several homonyms of the translation exist; choose which one.');
  }
  return reasons;
}

/**
 * Send rows to Ve'rdd and record the outcome on each. Rows with a translation go through
 * the idempotent pair endpoint; a headword without a translation is created as a lexeme.
 * Returns {sent, failed}.
 */
export async function sendRows(api, rows) {
  const pairRows = rows.filter(r => !isBlank(r.translation));
  const wordRows = rows.filter(r => isBlank(r.translation));
  let sent = 0;
  let failed = 0;
  const record = (row, ok, message, extra = {}) => {
    row.status = ok ? 'sent' : 'error';
    row.message = message;
    Object.assign(row, extra);
    if (ok) sent += 1; else failed += 1;
  };

  if (pairRows.length) {
    let results;
    try {
      results = await api.sendPairs(pairRows.map(rowToPairPayload));
    } catch (error) {
      pairRows.forEach(row => record(row, false, describeApiError(error)));
      results = [];
    }
    results.forEach((result, index) => {
      const row = pairRows[index];
      if (!result.ok) return record(row, false, describeApiError(result.errors));
      const examples = result.examples.length ? ` + ${result.examples.length} example${result.examples.length > 1 ? 's' : ''}` : '';
      record(row, true, (result.created ? 'Stored' : 'Already in Ve\'rdd') + examples, {
        sourceId: result.source.id, targetId: result.target.id, webUrl: result.source.web_url
      });
    });
  }

  for (const row of wordRows) {
    try {
      const state = homoState(row.srcMatches, row.srcHomoId);
      if (state === 'reuse' || state === 'chosen') {
        const existing = row.srcMatches.find(m => row.srcHomoId == null || m.homoId === Number(row.srcHomoId)) || row.srcMatches[0];
        record(row, true, 'Already in Ve\'rdd', { sourceId: existing.id });
        continue;
      }
      const fields = { lexeme: row.lemma.trim(), language: row.srcLang.trim(), pos: row.pos.trim() };
      const homo = optionalHomoId(row.srcHomoId);
      if (homo !== undefined) fields.homoId = homo;
      const created = await api.createLexeme(fields);
      record(row, true, 'Stored', { sourceId: created.id, webUrl: created.web_url });
    } catch (error) {
      record(row, false, describeApiError(error));
    }
  }
  return { sent, failed };
}
