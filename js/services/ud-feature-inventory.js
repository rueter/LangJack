/**
 * UD Feature Inventory: which Feature=Value pairs (and UPOS / DEPREL labels) are valid for a language.
 * Layers, checked in this order for a proposed value:
 *   file      already used in the imported file itself
 *   language  used in the language's own treebank(s) (data/ud-feature-inventory.json, or a docfeats.json you load)
 *   universal an unlayered pair from the universal UD feature list below
 *   uralic    (Uralic languages only) used in another Uralic language of the inventory, e.g. Person[psor]
 *   widespread used by WIDESPREAD_MIN or more other languages of the inventory, whatever their family
 *   other     used in one or two other languages of the inventory
 *   new       in none of them: the user has to confirm it
 * Pure data logic; the browser fetches the JSON, tests pass it in directly.
 */

// Universal UD features and values (https://universaldependencies.org/u/feat/). Layered keys such as
// Person[psor] are never universal: they must be documented for the language.
export const UNIVERSAL_FEATURES = {
  Abbr: ['Yes'],
  Animacy: ['Anim', 'Hum', 'Inan', 'Nhum'],
  Aspect: ['Hab', 'Imp', 'Iter', 'Perf', 'Prog', 'Prosp'],
  Case: ['Abe', 'Abl', 'Abs', 'Acc', 'Add', 'Ade', 'All', 'Ben', 'Cau', 'Cmp', 'Cns', 'Com', 'Dat', 'Del', 'Dis', 'Equ', 'Erg',
    'Ela', 'Ess', 'Gen', 'Ill', 'Ine', 'Ins', 'Lat', 'Loc', 'Nom', 'Par', 'Sub', 'Sup', 'Tem', 'Ter', 'Tra', 'Voc'],
  Clusivity: ['Ex', 'In'],
  Definite: ['Com', 'Cons', 'Def', 'Ind', 'Spec'],
  Degree: ['Abs', 'Cmp', 'Equ', 'Pos', 'Sup'],
  Evident: ['Fh', 'Nfh'],
  Foreign: ['Yes'],
  Gender: ['Com', 'Fem', 'Masc', 'Neut'],
  Mood: ['Adm', 'Cnd', 'Des', 'Imp', 'Ind', 'Irr', 'Jus', 'Nec', 'Opt', 'Pot', 'Prp', 'Qot', 'Sub'],
  NumType: ['Card', 'Dist', 'Frac', 'Mult', 'Ord', 'Range', 'Sets'],
  Number: ['Coll', 'Count', 'Dual', 'Grpa', 'Grpl', 'Inv', 'Pauc', 'Plur', 'Ptan', 'Sing', 'Tri'],
  Person: ['0', '1', '2', '3', '4'],
  Polarity: ['Neg', 'Pos'],
  Polite: ['Elev', 'Form', 'Humb', 'Infm'],
  Poss: ['Yes'],
  PronType: ['Art', 'Dem', 'Emp', 'Exc', 'Ind', 'Int', 'Neg', 'Prs', 'Rcp', 'Rel', 'Tot'],
  Reflex: ['Yes'],
  Tense: ['Fut', 'Imp', 'Past', 'Pqp', 'Pres'],
  Typo: ['Yes'],
  VerbForm: ['Conv', 'Fin', 'Gdv', 'Ger', 'Inf', 'Part', 'Sup', 'Vnoun'],
  Voice: ['Act', 'Antip', 'Bfoc', 'Cau', 'Dir', 'Inv', 'Lfoc', 'Mid', 'Pass', 'Rcp']
};

export const UNIVERSAL_UPOS = ['ADJ', 'ADP', 'ADV', 'AUX', 'CCONJ', 'DET', 'INTJ', 'NOUN', 'NUM', 'PART', 'PRON', 'PROPN', 'PUNCT', 'SCONJ', 'SYM', 'VERB', 'X'];

export const UNIVERSAL_DEPRELS = ['acl', 'advcl', 'advmod', 'amod', 'appos', 'aux', 'case', 'cc', 'ccomp', 'clf', 'compound', 'conj', 'cop', 'csubj',
  'dep', 'det', 'discourse', 'dislocated', 'expl', 'fixed', 'flat', 'goeswith', 'iobj', 'list', 'mark', 'nmod', 'nsubj', 'nummod', 'obj', 'obl',
  'orphan', 'parataxis', 'punct', 'reparandum', 'root', 'vocative', 'xcomp'];

// MISC keys UD itself documents; anything else a treebank uses (gloss[pt], CGdeprel, GTtags, ...) is "seen in this
// file" only and never part of the UD-valid layer.
export const UD_MISC_KEYS = ['SpaceAfter', 'SpacesAfter', 'SpacesBefore', 'SpacesInToken', 'Translit', 'LTranslit', 'Gloss', 'LId', 'LGloss', 'Lang'];

export const URALIC_CODES = new Set(['myv', 'mdf', 'koi', 'kpv', 'kv', 'sms', 'sme', 'smn', 'sjd', 'smj', 'sma', 'sju', 'fin', 'est', 'hun', 'vep',
  'olo', 'krl', 'liv', 'vro', 'izh', 'yrk', 'nio', 'sel', 'mns', 'mhr', 'mrj', 'udm', 'kca', 'vot']);

// UD file prefixes / 2-letter codes -> the ISO 639-3 codes the workbench uses
const CODE_ALIASES = { fi: 'fin', et: 'est', hu: 'hun', se: 'sme' };

// A pair used by this many other languages counts as widespread (no family restriction)
export const WIDESPREAD_MIN = 3;

const LANGUAGE_NAMES = {
  apu: 'Apurinã', bgs: 'Tagabawa', ceb: 'Cebuano', est: 'Estonian', fin: 'Finnish', koi: 'Komi-Permyak', kpv: 'Komi-Zyrian',
  krl: 'Karelian', kv: 'Old Permic', mdf: 'Moksha', mpu: 'Makurap', myu: 'Munduruku', myv: 'Erzya', olo: 'Livvi',
  pad: 'Paumari', sme: 'North Sami', sms: 'Skolt Sami', vep: 'Veps', yrk: 'Nenets'
};

const RANK = { file: 0, language: 0, universal: 0, uralic: 1, widespread: 1, other: 2, new: 3, unchecked: 0 };
const LAYER_LABEL = {
  file: 'used in this file', language: 'in the language inventory', universal: 'universal UD', uralic: 'shared (Uralic)',
  widespread: 'widespread (many languages)', other: 'in other languages', new: 'new: not in any inventory', unchecked: 'not checked (no inventory loaded)'
};

const baseKey = (key) => key.replace(/\[[^\]]*\]$/, '');
const splitPair = (pair) => { const i = pair.indexOf('='); return [pair.slice(0, i), pair.slice(i + 1)]; };

export class FeatureInventory {
  constructor(data = null) {
    this.languages = {}; // code -> { feats: Set('Key=Value'), upos: Set, deprel: Set, treebanks, tokens }
    this.sources = [];
    this.loaded = false;
    if (data) this.setData(data);
  }

  /** Loads the compact inventory written by scripts/build-feature-inventory.mjs (replaces what was loaded). */
  setData(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || typeof data.languages !== 'object') throw new Error('Not a feature inventory file (no "languages")');
    this.languages = {};
    this.sources = (data.meta && data.meta.sources) || [];
    for (const [code, l] of Object.entries(data.languages)) {
      const feats = new Set();
      for (const [key, values] of Object.entries(l.feats || {})) for (const value of Object.keys(values)) feats.add(`${key}=${value}`);
      this.languages[code] = {
        feats, upos: new Set(Object.keys(l.upos || {})), deprel: new Set(Object.keys(l.deprel || {})),
        misc: new Set(Object.keys(l.misc || {})), treebanks: l.treebanks || [], tokens: l.tokens || 0
      };
    }
    this.loaded = Object.keys(this.languages).length > 0;
    return this;
  }

  /**
   * Adds the documented features of the UD tools' docfeats.json ({"lists": {code: ["Feat=Val", ...]}}) as extra
   * language data. Meant for a file the user loads from a local UD checkout; nothing is bundled.
   * @returns {{ languages: number, pairs: number }}
   */
  addDocfeats(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || typeof data.lists !== 'object') throw new Error('Not a docfeats.json file (no "lists")');
    let pairs = 0;
    for (const [rawCode, list] of Object.entries(data.lists)) {
      const code = CODE_ALIASES[rawCode] || rawCode;
      const lang = this.languages[code] || (this.languages[code] = { feats: new Set(), upos: new Set(), deprel: new Set(), misc: new Set(), treebanks: [], tokens: 0 });
      for (const pair of list) if (typeof pair === 'string' && pair.includes('=') && !lang.feats.has(pair)) { lang.feats.add(pair); pairs++; }
    }
    this.loaded = Object.keys(this.languages).length > 0;
    return { languages: Object.keys(data.lists).length, pairs };
  }

  /** Browser: fetches the bundled inventory. Resolves false (and stays empty) when it is not available. */
  async loadDefault(url = 'data/ud-feature-inventory.json') {
    try {
      const target = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(url) : url;
      const resp = await fetch(target);
      if (!resp.ok) return false;
      this.setData(await resp.json());
      return true;
    } catch (e) {
      return false;
    }
  }

  /** The inventory key for a language code the user or file gave ("fi" -> "fin"), or null if it has no data. */
  resolveLanguage(code) {
    const c = String(code || '').toLowerCase().trim();
    if (this.languages[c]) return c;
    if (CODE_ALIASES[c] && this.languages[CODE_ALIASES[c]]) return CODE_ALIASES[c];
    return null;
  }

  languageCodes() { return Object.keys(this.languages).sort(); }

  /** Display name of an inventory language ("Erzya"), falling back to the code. */
  languageName(code) { return LANGUAGE_NAMES[code] || code; }

  /** Languages (other than `except`) that use a pair / label. kind: 'feats' | 'upos' | 'deprel'. */
  languagesUsing(kind, item, except = null) {
    return Object.entries(this.languages).filter(([code, l]) => code !== except && l[kind].has(item)).map(([code]) => code).sort();
  }

  /** Pairs used by at least `min` languages of the inventory: the shared layer. */
  sharedPairs(min = 2) {
    const counts = new Map();
    for (const l of Object.values(this.languages)) for (const p of l.feats) counts.set(p, (counts.get(p) || 0) + 1);
    return [...counts].filter(([, n]) => n >= min).map(([p]) => p).sort();
  }

  /**
   * Classifies one pair or label for a language.
   * @param {'feats'|'upos'|'deprel'} kind
   * @param {string} item      "Person[psor]=3" for feats (one value), or the UPOS / DEPREL string
   * @param {{ lang?: string|null, file?: Set<string> }} options  lang: inventory language; file: items used in the imported file
   * @returns {{ item: string, layer: string, label: string, languages: string[] }}
   */
  classify(kind, item, { lang = null, file = null } = {}) {
    const result = (layer, languages = []) => ({ item, layer, label: LAYER_LABEL[layer], languages });
    if (file && file.has(item)) return result('file');
    const own = lang ? this.languages[lang] : null;
    if (own && own[kind].has(item)) return result('language');
    if (kind === 'feats') {
      const [key, value] = splitPair(item);
      if (UNIVERSAL_FEATURES[key] && UNIVERSAL_FEATURES[key].includes(value)) return result('universal');
    } else if (kind === 'upos') {
      if (UNIVERSAL_UPOS.includes(item)) return result('universal');
    } else if (kind === 'deprel') {
      if (UNIVERSAL_DEPRELS.includes(item)) return result('universal');
    }
    if (!this.loaded) return result('unchecked');
    const others = this.languagesUsing(kind, item, lang);
    // the Uralic layer exists for Uralic languages only; any other language leans on the all-languages layer
    const uralic = others.filter((c) => URALIC_CODES.has(c));
    if (lang && URALIC_CODES.has(lang) && uralic.length) return result('uralic', uralic);
    if (others.length >= WIDESPREAD_MIN) return result('widespread', others);
    if (others.length) return result('other', others);
    return result('new');
  }

  /**
   * Classifies every pair of a FEATS value ("Case=Nom|Number[psor]=Sing"); multi-values are checked one by one.
   * Returns an entry per pair with the weakest layer of its values.
   */
  classifyFeats(feats, options = {}) {
    if (!feats || feats === '_') return [];
    return feats.split('|').filter((p) => p.includes('=')).map((pair) => {
      const [key, value] = splitPair(pair);
      const parts = value.split(',').map((v) => this.classify('feats', `${key}=${v}`, options));
      const worst = parts.reduce((a, b) => (RANK[b.layer] > RANK[a.layer] ? b : a));
      return { ...worst, item: pair, languages: [...new Set(parts.flatMap((p) => p.languages))] };
    });
  }

  /**
   * MISC keys: 'ud' (documented by UD), 'seen' (used in this language's treebank but not a UD key: informational,
   * never part of the UD-valid layer) or 'unknown'.
   */
  classifyMiscKey(key, lang = null) {
    if (UD_MISC_KEYS.includes(key)) return 'ud';
    const l = lang ? this.languages[lang] : null;
    return l && l.misc.has(key) ? 'seen' : 'unknown';
  }

  /** Non-standard MISC keys a language's treebank uses, e.g. ['CGdeprel', 'GTtags', 'gloss[pt]']. */
  nonStandardMiscKeys(lang) {
    const l = lang ? this.languages[lang] : null;
    return l ? [...l.misc].filter((k) => !UD_MISC_KEYS.includes(k)).sort() : [];
  }

  /** Short summary of what is known about a language, for display. */
  describeLanguage(lang) {
    const l = lang ? this.languages[lang] : null;
    return l ? { pairs: l.feats.size, upos: l.upos.size, deprel: l.deprel.size, treebanks: l.treebanks, tokens: l.tokens, miscKeys: this.nonStandardMiscKeys(lang) } : null;
  }
}

/** Features, UPOS and DEPREL values the imported file itself already uses (its "own" layer). */
export function usageOfFile(parsed) {
  const feats = new Set();
  const upos = new Set();
  const deprel = new Set();
  for (const sent of parsed.sentences) {
    for (const line of sent.lines) {
      if (line.kind !== 'token') continue;
      if (line.cols[3] !== '_') upos.add(line.cols[3]);
      if (line.cols[7] !== '_') deprel.add(line.cols[7]);
      if (line.cols[5] === '_') continue;
      for (const pair of line.cols[5].split('|')) {
        const [key, value] = splitPair(pair);
        if (!key || !pair.includes('=')) continue;
        for (const v of value.split(',')) feats.add(`${key}=${v}`);
      }
    }
  }
  return { feats, upos, deprel };
}

export { baseKey };
export const featureInventory = new FeatureInventory();
