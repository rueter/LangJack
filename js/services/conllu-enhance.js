/**
 * CoNLL-U enhancement helpers (pure functions): turn readings and glosses into proposed values for the
 * LEMMA / UPOS / XPOS / FEATS / HEAD / DEPREL / DEPS / MISC columns of an imported treebank.
 * Nothing here writes anything; conllu-import-service.js decides what may be applied.
 */

import { TAG_TO_FEATS, stripGuessTags } from './tag-mapper.js';
import { dependencyService } from './dependency-service.js';

/** Columns the enhancement may fill. ID and FORM are locked: changing them breaks token alignment and `# text`. */
export const ENHANCE_COLUMNS = ['lemma', 'upos', 'xpos', 'feats', 'head', 'deprel', 'deps', 'misc'];
export const LOCKED_COLUMNS = ['id', 'form'];

/** True for a cell that carries no value ("_" or empty). */
export const isEmptyCell = (value) => value === null || value === undefined || value === '' || value === '_';

// ---------------------------------------------------------------------------------------
// FEATS
// ---------------------------------------------------------------------------------------

// UD sorts FEATS keys case-insensitively by code point ('Number' before 'NumType', 'Gender' before 'Gender[obj]')
const SORT = (a, b) => { const x = a.toLowerCase(); const y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

/** "A=x|B=y" -> Map, keeping value strings as written ("_" and "" give an empty map). */
export function parseFeats(feats) {
  const map = new Map();
  if (isEmptyCell(feats)) return map;
  for (const part of feats.split('|')) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return map;
}

export function featsToString(map) {
  const keys = [...map.keys()].sort(SORT);
  return keys.length ? keys.map((k) => `${k}=${map.get(k)}`).join('|') : '_';
}

/**
 * Adds proposed features to an existing FEATS cell without ever changing an existing value.
 * @param {string} existing  current cell
 * @param {Map<string,string>} proposed
 * @returns {{ merged: string, added: string[], differing: Array<{key, have, proposed}> }}
 */
export function mergeFeats(existing, proposed) {
  const map = parseFeats(existing);
  const added = [];
  const differing = [];
  for (const [key, value] of proposed) {
    if (!map.has(key)) { map.set(key, value); added.push(key); }
    else if (map.get(key) !== value) differing.push({ key, have: map.get(key), proposed: value });
  }
  // an existing cell that was not parseable as key=value pairs is left alone entirely
  if (!isEmptyCell(existing) && parseFeats(existing).size === 0) {
    return { merged: existing, added: [], differing: [] };
  }
  return { merged: added.length ? featsToString(map) : existing, added, differing };
}

// ---------------------------------------------------------------------------------------
// Gloss abbreviations (Leipzig style) -> FEATS
// ---------------------------------------------------------------------------------------

// Abbreviation -> tag of tag-mapper.js (TAG_TO_FEATS), so the analyzer and the gloss mapping agree.
const ABBR_TO_TAG = {
  NOM: 'Nom', GEN: 'Gen', ACC: 'Acc', DAT: 'Dat', INE: 'Ine', ELA: 'Ela', ILL: 'Ill', ADE: 'Ade', ABL: 'Abl',
  ALL: 'All', ESS: 'Ess', TRA: 'Tra', ABE: 'Abe', COM: 'Com', LAT: 'Lat', LOC: 'Loc', PAR: 'Par', PRL: 'Prl', TER: 'Ter',
  PST: 'Past', PAST: 'Past', PRS: 'Prs', IND: 'Ind', IMP: 'Imprt', COND: 'Cond', POT: 'Pot', OPT: 'Opt',
  PASS: 'Pass', ACT: 'Act', DEF: 'Def', INDEF: 'Indef'
};

// Abbreviations without a tag-mapper entry
const ABBR_EXTRA = {
  TEMP: { Case: 'Tem' },
  FUT: { Tense: 'Fut' },
  NEG: { Polarity: 'Neg' },
  DU: { Number: 'Dual' }
};

const NUMBERS = { SG: 'Sing', PL: 'Plur', DU: 'Dual' };
const GENDERS = { M: 'Masc', MASC: 'Masc', F: 'Fem', FEM: 'Fem' };
// Role letters of Leipzig person bundles: 3SG.M.O = third person singular masculine object
const ROLES = { S: 'subj', A: 'subj', SBJ: 'subj', O: 'obj', P: 'obj', OBJ: 'obj', PSR: 'psor', POSS: 'psor' };
const PERSON_NUMBER = /^([123])(SG|PL|DU)?$/;
const GRAMMATICAL = /^[\p{Lu}\d][\p{Lu}\d./]*$/u; // no lowercase letter: a grammatical morpheme, not a lexical gloss

const featsOfTag = (tag) => {
  const item = TAG_TO_FEATS[tag];
  if (!item) return null;
  return (Array.isArray(item) ? item : [item]).map((f) => [f.feature, f.value]);
};

function addValue(map, key, value) {
  if (!map.has(key)) { map.set(key, value); return; }
  const values = new Set(map.get(key).split(','));
  values.add(value);
  map.set(key, [...values].sort().join(','));
}

/**
 * Features implied by the grammatical morphemes of a gloss such as "ver-VBLZ-3SG.M.O".
 * Lexical morphemes (anything with a lowercase letter) are ignored; unknown grammatical ones are listed.
 * A person bundle without a role letter becomes [psor] on nouns/adpositions and [subj] on verbs.
 * @param {string} gloss
 * @param {string} [upos]
 * @returns {{ feats: Map<string,string>, mapped: string[], unmapped: string[] }}
 */
export function featsFromGloss(gloss, upos = '') {
  const feats = new Map();
  const mapped = [];
  const unmapped = [];
  if (isEmptyCell(gloss)) return { feats, mapped, unmapped };
  const defaultRole = /^(NOUN|PROPN|ADP|ADJ|NUM)$/.test(upos) ? 'psor' : (/^(VERB|AUX)$/.test(upos) ? 'subj' : '');

  for (const morpheme of gloss.split(/[-=]/).filter(Boolean)) {
    if (!GRAMMATICAL.test(morpheme)) continue;
    const parts = morpheme.split('.');
    let role = '';
    const last = parts[parts.length - 1];
    if (parts.length > 1 && ROLES[last]) role = ROLES[parts.pop()];
    const bundle = [];
    const found = [];
    let hasPerson = false;
    let unknown = false;
    for (const part of parts) {
      const pn = part.match(PERSON_NUMBER);
      if (pn) {
        hasPerson = true;
        bundle.push(['Person', pn[1]]);
        if (pn[2]) bundle.push(['Number', NUMBERS[pn[2]]]);
      } else if (NUMBERS[part]) {
        bundle.push(['Number', NUMBERS[part]]);
      } else if (GENDERS[part]) {
        bundle.push(['Gender', GENDERS[part]]);
      } else if (ABBR_TO_TAG[part] && featsOfTag(ABBR_TO_TAG[part])) {
        found.push(...featsOfTag(ABBR_TO_TAG[part]));
      } else if (ABBR_EXTRA[part]) {
        found.push(...Object.entries(ABBR_EXTRA[part]));
      } else {
        unknown = true;
      }
    }
    const bracket = role || (hasPerson ? defaultRole : '');
    for (const [key, value] of bundle) addValue(feats, bracket ? `${key}[${bracket}]` : key, value);
    for (const [key, value] of found) addValue(feats, key, value);
    if (bundle.length || found.length) mapped.push(morpheme);
    if (unknown && !bundle.length && !found.length) unmapped.push(morpheme);
  }
  return { feats, mapped, unmapped };
}

/** The mapping shown to the user before anything is applied: [{ abbreviation, features }]. */
export function describeGlossMapping() {
  const rows = [];
  for (const [abbr, tag] of Object.entries(ABBR_TO_TAG)) {
    const f = featsOfTag(tag);
    if (f) rows.push({ abbreviation: abbr, features: f.map(([k, v]) => `${k}=${v}`).join('|') });
  }
  for (const [abbr, f] of Object.entries(ABBR_EXTRA)) {
    rows.push({ abbreviation: abbr, features: Object.entries(f).map(([k, v]) => `${k}=${v}`).join('|') });
  }
  rows.push(
    { abbreviation: '1 / 2 / 3 (+SG PL DU)', features: 'Person=…|Number=…' },
    { abbreviation: 'M / F', features: 'Gender=Masc / Fem' },
    { abbreviation: '….S / A / O / PSR', features: 'bundle gets [subj] / [subj] / [obj] / [psor], e.g. 3SG.M.O → Person[obj]=3|Number[obj]=Sing|Gender[obj]=Masc' },
    { abbreviation: '3SG.M (no role)', features: '[psor] on NOUN, ADP, ADJ, NUM; [subj] on VERB, AUX; plain otherwise' }
  );
  return rows;
}

// ---------------------------------------------------------------------------------------
// Analyzer readings
// ---------------------------------------------------------------------------------------

/**
 * The tags of an analyzer reading, in the order the analyzer emitted them (lemma stem not included).
 * Uses the reading's own tag list when it has one, otherwise splits the raw analysis string.
 */
export function readingTags(r) {
  if (Array.isArray(r.cleanTags)) return r.cleanTags;
  const clean = stripGuessTags(r.raw || '');
  const sections = clean.includes('#') ? clean.split('#').filter(Boolean) : [clean];
  return sections.flatMap((sec) => sec.split('+').filter(Boolean).slice(1));
}

/** Derivation (Der, Der/...) anywhere among the tags, whatever their order. */
export const isDerivedReading = (r) => readingTags(r).some((t) => t === 'Der' || t.startsWith('Der/'));
/** Compounding (Cmp, Cmp/..., or a # boundary) anywhere in the analysis. */
export const isCompoundReading = (r) => readingTags(r).some((t) => t === 'Cmp' || t.startsWith('Cmp/')) || /#/.test(r.raw || '');

/** Identity of a reading independent of tag order: lemma plus the SET of tags. */
export const readingKey = (r) => `${stripGuessTags(r.lemma || '')}\u0000${[...new Set(readingTags(r))].sort().join('+')}`;

/**
 * What the analyzer says about a token, looked up by its FORM. The word form is primary: the file's LEMMA is a
 * hypothesis, never a filter. Every reading stays a candidate (`candidates`, in two groups: plain readings first, then
 * derived and compound ones). Readings that differ only in tag order are one reading (same lemma and tag set); its tags
 * are shown as the analyzer emitted them. Nothing here depends on the position of a tag.
 *
 * The default proposal comes from the plain readings (no Der, no Cmp), or from all readings when there are none; the
 * file's lemma and UPOS then only narrow that pool (stated in `defaultReason`). With several readings left the default
 * uses only what they share and the token is `ambiguous` ("needs your choice"). The user can pick any reading
 * (`choice` = its raw analysis string); LEMMA, UPOS, XPOS and FEATS then all come from that one reading, not intersected.
 * @param {Array<Object>} readings  analyzer readings
 * @param {{ lemma: string, upos: string }} row  the file's current values (hypotheses)
 * @param {string|null} [choice]  raw analysis of the reading the user picked; null = default rule
 * @returns {null|{ lemma: string, upos: string, xpos: string, tagString: string, feats: Map<string,string>, readings: number,
 *   ambiguous: boolean, alternatives: boolean, choice: string|null, choiceStale: boolean, shared: Map<string,string>,
 *   agree: { lemma: boolean, upos: boolean, xpos: boolean, tagString: boolean },
 *   defaultReason: string, candidates: Array<Object> }}
 */
export function summarizeReadings(readings, row, choice = null) {
  const seen = new Set();
  const usable = [];
  for (const r of readings || []) {
    if (!r || r.isGuessed || !r.lemma) continue;
    const key = readingKey(r);
    if (seen.has(key)) continue; // the same reading in another tag order
    seen.add(key);
    usable.push(r);
  }
  if (!usable.length) return null;

  const plainGroup = usable.filter((r) => !isDerivedReading(r) && !isCompoundReading(r));
  const base = plainGroup.length ? plainGroup : usable;
  const sameLemma = base.filter((r) => stripGuessTags(r.lemma) === row.lemma);
  const pool = sameLemma.length ? sameLemma : base;
  const sameUpos = pool.filter((r) => r.upos === row.upos);
  const chosen = sameUpos.length ? sameUpos : pool;
  const first = chosen[0];
  let shared = null;
  for (const r of chosen) {
    const own = new Map(Object.entries(r.featsMap || {}));
    if (shared === null) shared = own;
    else for (const [k, v] of [...shared]) if (own.get(k) !== v) shared.delete(k);
  }
  const reasons = [];
  if (plainGroup.length && plainGroup.length < usable.length) reasons.push('plain readings (no Der/Cmp)');
  if (sameLemma.length && sameLemma.length < base.length) reasons.push("the file's lemma");
  if (sameUpos.length && sameUpos.length < pool.length) reasons.push("the file's UPOS");

  const describe = (r) => {
    const derived = isDerivedReading(r);
    const compound = isCompoundReading(r);
    return {
      raw: r.raw || '', lemma: stripGuessTags(r.lemma), upos: r.upos, xpos: r.pos || '', tagString: readingTags(r).join('+'),
      feats: featsToString(new Map(Object.entries(r.featsMap || {}))), derived, compound,
      kind: derived && compound ? 'derived+compound' : derived ? 'derived' : compound ? 'compound' : 'plain',
      group: derived || compound ? 'other' : 'plain',
      matchesFileLemma: stripGuessTags(r.lemma) === row.lemma, inDefault: chosen.includes(r)
    };
  };
  // plain readings first, then derived and compound ones; the analyzer's own order inside each group
  const candidates = usable.map(describe).sort((a, b) => (a.group === b.group ? 0 : a.group === 'plain' ? -1 : 1));
  const same = (get) => chosen.every((r) => get(r) === get(first));
  const common = {
    ambiguous: chosen.length > 1, alternatives: usable.length > 1, shared: shared || new Map(), candidates,
    defaultReason: reasons.join(' and '),
    agree: {
      lemma: same((r) => stripGuessTags(r.lemma)), upos: same((r) => r.upos), xpos: same((r) => r.pos || ''),
      tagString: same((r) => [...new Set(readingTags(r))].sort().join('+'))
    }
  };
  const picked = choice ? usable.find((r) => r.raw === choice) : null;
  if (picked) {
    return {
      lemma: stripGuessTags(picked.lemma), upos: picked.upos, xpos: picked.pos || '', tagString: readingTags(picked).join('+'),
      feats: new Map(Object.entries(picked.featsMap || {})), readings: 1, choice: picked.raw, choiceStale: false, ...common,
      agree: { lemma: true, upos: true, xpos: true, tagString: true }
    };
  }
  return {
    lemma: stripGuessTags(first.lemma), upos: first.upos, xpos: first.pos || '', tagString: readingTags(first).join('+'),
    feats: common.shared, readings: chosen.length, choice: null, choiceStale: Boolean(choice), ...common
  };
}

// ---------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------

/**
 * Baseline HEAD/DEPREL guesses for a sentence that has no dependencies yet, from the UPOS sequence
 * (dependency-service heuristics). Returns [] when any word already has a head: partial trees are not guessed at.
 * @param {Array<{ id: string, upos: string, head: string }>} words  word rows in order, ids 1..n
 * @returns {Array<{ id: string, head: string, deprel: string }>}
 */
export function baselineDependencies(words) {
  if (!words.length || words.some((w) => !isEmptyCell(w.head))) return [];
  const tokens = words.map((w) => ({ upos: w.upos, isPunct: w.upos === 'PUNCT' }));
  const inferred = dependencyService.inferBaselineDependencies(tokens);
  return words.map((w, i) => ({
    id: w.id,
    head: String(words[(inferred[i].head || 0) - 1]?.id ?? inferred[i].head),
    deprel: inferred[i].deprel
  }));
}
