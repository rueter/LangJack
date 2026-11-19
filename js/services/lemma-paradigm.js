/**
 * The paradigm of a lemma (headword), read out of the language's own transducer: every analysis that starts with the
 * lemma, with its surface forms, in the form
 *
 *   kala+N+Sg+Nom: kala
 *   kala+N+Pl+Gen: [kalojen, kalain]
 *
 * A cell with several forms lists them with the normative one first, but only as far as the transducer says which
 * that is: a form from an analysis without variant tags (+Dial..., +Use/...) comes before one from a variant, and a
 * lower weight before a higher one. When the transducer gives neither, its own order is kept. Nothing is added from
 * outside the transducer. Misspelling analyses (+Err/...) are left out.
 *
 * Two views come from one run: the inflection of the lemma without derivation, and the same with the derivations
 * (+Der/...) of the lemma and their inflection. A derived word's possessive suffixes and clitics are left out, which
 * would multiply every derivation by hundreds of cells.
 */

import { analyzerService, normalizeLangCode } from './analyzer-service.js';
import { enumerateFromLemma } from '../lib/hfst/enumerate.js';

/** Tags after which the form is not the prominent one, by what the transducer says about them. */
const VARIANT_TAG = /^\+(?:Dial|Use)(?:\/|$)/;
export const CLITIC_TAG = /^\+(?:Clt|Foc|Qst)(?:\/|$)/;
const DERIVED_SKIP = /^\+(?:Clt|Foc|Qst|Px)/;
const isDer = (t) => /^\+Der(?:[/\d]|$)/.test(t);

/** Display order of well-known tags (the transducer's own alphabet is alphabetical); others follow, alphabetically. */
const TAG_ORDER = [
  'N', 'V', 'A', 'Adv', 'Pron', 'Num', 'Adp', 'CC', 'CS', 'Interj', 'Pcle',
  'Sg', 'Du', 'Pl', 'SP',
  'Nom', 'Acc', 'Gen', 'Par', 'Ine', 'Ela', 'Ill', 'Ade', 'Abl', 'All', 'Ess', 'Tra', 'Abe', 'Com', 'Ins', 'Lat', 'Loc', 'Prl', 'Dat', 'Voc', 'Cmpr', 'Temp',
  'Indef', 'Def',
  'PxSg1', 'PxSg2', 'PxSg3', 'PxDu1', 'PxDu2', 'PxDu3', 'PxPl1', 'PxPl2', 'PxPl3', 'PxSP3',
  'Ind', 'Cond', 'Pot', 'Imprt', 'Opt', 'Prs', 'Prt', 'Prt1', 'Prt2',
  'Sg1', 'Sg2', 'Sg3', 'Du1', 'Du2', 'Du3', 'Pl1', 'Pl2', 'Pl3',
  'ScSg1', 'ScSg2', 'ScSg3', 'ScDu1', 'ScDu2', 'ScDu3', 'ScPl1', 'ScPl2', 'ScPl3',
  'ConNeg', 'Inf', 'PrfPrc', 'PrsPrc', 'Pos', 'Neg'
].map(t => '+' + t);
const RANK = new Map(TAG_ORDER.map((t, i) => [t, i]));
const rank = (t) => (RANK.has(t) ? RANK.get(t) : 1000);

export function compareTags(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const d = rank(a[i]) - rank(b[i]);
    if (d) return d;
    return a[i].localeCompare(b[i]);
  }
  return a.length - b.length;
}

/** Forms of one cell, normative first; the capitalised twin of a form is dropped when the lemma is written otherwise. */
export function orderForms(entries, lemma) {
  const ordered = entries
    .map((e, i) => ({ ...e, surface: e.surface.normalize('NFC'), i })) // o + combining tilde and precomposed õ are one form
    .sort((a, b) => (a.variant - b.variant) || (a.weight - b.weight) || (a.i - b.i));
  const seen = new Set();
  const forms = [];
  for (const e of ordered) if (!seen.has(e.surface)) { seen.add(e.surface); forms.push(e.surface); }
  const first = lemma[0] || '';
  const lemmaLower = first !== first.toUpperCase();
  return forms.filter(f => {
    const c = f[0] || '';
    if (c.toLowerCase() === c.toUpperCase()) return true; // no case in this letter
    const sameCase = lemmaLower ? c === c.toLowerCase() : c === c.toUpperCase();
    if (sameCase) return true;
    const twin = (lemmaLower ? c.toLowerCase() : c.toUpperCase()) + f.slice(c.length);
    return !seen.has(twin); // keep it only when nothing else says the same
  });
}

/**
 * Cells from enumerated paths: [{tags, key, forms, derived}] in display order.
 * @param {Array<{tags: string[], surface: string, weight: number}>} paths
 * @param {string} lemma
 */
export function buildCells(paths, lemma) {
  const cells = new Map();
  for (const p of paths) {
    const base = p.tags.filter(t => !VARIANT_TAG.test(t));
    const key = base.join('');
    if (!cells.has(key)) cells.set(key, { tags: base, key, entries: [], derived: base.some(isDer) });
    cells.get(key).entries.push({ surface: p.surface, weight: p.weight, variant: base.length === p.tags.length ? 0 : 1 });
  }
  return [...cells.values()]
    .map(c => ({ tags: c.tags, key: c.key, derived: c.derived, forms: orderForms(c.entries, lemma) }))
    .filter(c => c.forms.length)
    .sort((a, b) => compareTags(a.tags, b.tags));
}

/** The lines `lemma+tags: form` or `lemma+tags: [form1, form2]`, a blank line between parts of speech. */
export function formatCells(cells, lemma, { derivation = false } = {}) {
  const lines = [];
  let pos = null;
  for (const c of cells) {
    if (c.derived && !derivation) continue;
    if (pos !== null && c.tags[0] !== pos) lines.push('');
    pos = c.tags[0];
    lines.push(`${lemma}${c.key}: ${c.forms.length > 1 ? '[' + c.forms.join(', ') + ']' : c.forms[0]}`);
  }
  return lines.join('\n');
}

/**
 * @param {string} lang
 * @param {string} lemma
 * @param {{clitics?: boolean, useGenerator?: boolean}} [options]  clitics: also the cells with clitics (+Clt/..., +Foc/..., +Qst/...);
 *   useGenerator: try the normative generator before the analyser (default true)
 * @returns {Promise<{cells: Array, truncated: boolean, source: string}>}
 *   source: 'generator' or 'analyser', the transducer the forms came from
 */
export async function generateLemmaParadigm(lang, lemma, { clitics = false, useGenerator = true, generatorWaitMs = 60000 } = {}) {
  const code = normalizeLangCode(lang);
  await analyzerService.ensureModelForLanguage(code);
  // The UralicNLP normative generator (analysis -> form) says the forms directly, and only the normative ones. It is
  // kept in this browser once it has been downloaded; when it cannot be had, the analyser is read backwards.
  let generator = analyzerService.generators.get(code) || null;
  if (!generator && useGenerator) {
    generator = await Promise.race([
      analyzerService.ensureGeneratorForLanguage(code).catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(null), generatorWaitMs))
    ]);
  }
  const hfst = generator || analyzerService.models.get(code);
  if (!hfst) throw new Error(`No analyser is loaded for ${code}.`);
  const res = enumerateFromLemma(hfst, lemma, {
    side: generator ? 'input' : 'output',
    allowDer: true,
    maxDer: 1,
    skipTags: clitics ? null : CLITIC_TAG,
    skipAfterDer: DERIVED_SKIP
  });
  return { cells: buildCells(res.paths, lemma), truncated: res.truncated, source: generator ? 'generator' : 'analyser' };
}
