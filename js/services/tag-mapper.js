/**
 * Tag Mapper Service: Converts HFST / Giellatekno morphological analysis strings
 * into structured components: Lemma, POS, UPOS (Universal Dependencies), and FEATS.
 */

// UPOS mapping from Giellatekno tags
export const POS_TO_UPOS = {
  'N': 'NOUN',
  'Noun': 'NOUN',
  'NOUN': 'NOUN',
  'Prop': 'PROPN',
  'PROPN': 'PROPN',
  'V': 'VERB',
  'Verb': 'VERB',
  'VERB': 'VERB',
  'Aux': 'AUX',
  'AUX': 'AUX',
  'A': 'ADJ',
  'Adj': 'ADJ',
  'ADJ': 'ADJ',
  'Adv': 'ADV',
  'ADV': 'ADV',
  'Pron': 'PRON',
  'PRON': 'PRON',
  'Num': 'NUM',
  'NUM': 'NUM',
  'Po': 'ADP',
  'Pr': 'ADP',
  'Adp': 'ADP',
  'ADP': 'ADP',
  'CC': 'CCONJ',
  'CCONJ': 'CCONJ',
  'CS': 'SCONJ',
  'SCONJ': 'SCONJ',
  'Conj': 'CCONJ',
  'Pcle': 'PART',
  'Pcl': 'PART',
  'Part': 'PART',
  'PART': 'PART',
  'Interj': 'INTJ',
  'Inj': 'INTJ',
  'INTJ': 'INTJ',
  'CLB': 'PUNCT',
  'Punct': 'PUNCT',
  'PUNCT': 'PUNCT',
  'Sym': 'SYM',
  'SYM': 'SYM',
  'Det': 'DET',
  'DET': 'DET',
  'X': 'X'
};

// Reciprocal mapping: Universal Dependencies UPOS to canonical morphological tag
export const UPOS_TO_POS = {
  'NOUN': 'N',
  'PROPN': 'Prop',
  'VERB': 'V',
  'ADJ': 'A',
  'ADV': 'Adv',
  'PRON': 'Pron',
  'NUM': 'Num',
  'ADP': 'Po',
  'AUX': 'Aux',
  'CCONJ': 'CC',
  'SCONJ': 'CS',
  'PART': 'Pcle',
  'INTJ': 'Interj',
  'PUNCT': 'CLB',
  'SYM': 'Sym',
  'DET': 'Det',
  'X': 'X'
};

// UD Features mapping
export const TAG_TO_FEATS = {
  // Number
  'Sg': { feature: 'Number', value: 'Sing' },
  'Pl': { feature: 'Number', value: 'Plur' },
  'SP': { feature: 'Number', value: 'Plur,Sing' },
  'Du': { feature: 'Number', value: 'Dual' },

  // Case
  'Abe': { feature: 'Case', value: 'Abe' },
  'Abl': { feature: 'Case', value: 'Abl' },
  'Acc': { feature: 'Case', value: 'Acc' },
  'Ade': { feature: 'Case', value: 'Ade' },
  'Adp': { feature: 'Case', value: 'Adp' },
  'All': { feature: 'Case', value: 'All' },
  'Apr': { feature: 'Case', value: 'Apr' },
  'AprEla': { feature: 'Case', value: 'AprEla' },
  'AprIll': { feature: 'Case', value: 'AprIll' },
  'AprIne': { feature: 'Case', value: 'AprIne' },
  'Com': { feature: 'Case', value: 'Com' },
  'Dat': { feature: 'Case', value: 'Dat' },
  'Gen': { feature: 'Case', value: 'Gen' },
  'Ela': { feature: 'Case', value: 'Ela' },
  'Ess': { feature: 'Case', value: 'Ess' },
  'Ill': { feature: 'Case', value: 'Ill' },
  'Ine': { feature: 'Case', value: 'Ine' },
  'Lat': { feature: 'Case', value: 'Lat' },
  'Loc': { feature: 'Case', value: 'Loc' },
  'Nom': { feature: 'Case', value: 'Nom' },
  'Par': { feature: 'Case', value: 'Par' },
  'Prl': { feature: 'Case', value: 'Prl' },
  'Ter': { feature: 'Case', value: 'Ter' },
  'Tra': { feature: 'Case', value: 'Tra' },

  // Definiteness
  'Def': { feature: 'Definite', value: 'Def' },
  'Indef': { feature: 'Definite', value: 'Ind' },

  // Gender
  'Fem': { feature: 'Gender', value: 'Fem' },
  'Msc': { feature: 'Gender', value: 'Masc' },
    
  // Tense
  'Fut': { feature: 'Tense', value: 'Fut' },
  'NFut': { feature: 'Tense', value: 'Past,Pres' }, // non-future: UD lists several values alphabetically, comma-separated
  'Past': { feature: 'Tense', value: 'Past' },
  'Prs': { feature: 'Tense', value: 'Pres' },
  'Prt': { feature: 'Tense', value: 'Past' },
  'Prt1': { feature: 'Tense', value: 'Past' },
  'Prt2': { feature: 'Tense', value: 'Past' },

  // Mood
  'Cond': { feature: 'Mood', value: 'Cnd' },
  'Des': { feature: 'Mood', value: 'Des' },
  'Ind': { feature: 'Mood', value: 'Ind' },
  'Imprt': { feature: 'Mood', value: 'Imp' },
  'Opt': { feature: 'Mood', value: 'Opt' },
  'Pot': { feature: 'Mood', value: 'Pot' },

  // Pronoun type
  'Dem': { feature: 'PronType', value: 'Dem' },
  'Interr': { feature: 'PronType', value: 'Int' },
  'Pers': { feature: 'PronType', value: 'Prs' },

  // Verb form
  'Der/NomAct': { feature: 'VerbForm', value: 'Vnoun' },
  'NomAct': { feature: 'VerbForm', value: 'Vnoun' },

  // Voice
  'Act': { feature: 'Voice', value: 'Act' },
  'Pass': { feature: 'Voice', value: 'Pass' },

  // Transitivity
  'IV': { feature: 'Subcat', value: 'Intr' },
  'TV': { feature: 'Subcat', value: 'Tran' },

  // Person / Number (General & Subject Conjugation)
  'Sg1': [{ feature: 'Person', value: '1' }, { feature: 'Number', value: 'Sing' }],
  'Sg2': [{ feature: 'Person', value: '2' }, { feature: 'Number', value: 'Sing' }],
  'Sg3': [{ feature: 'Person', value: '3' }, { feature: 'Number', value: 'Sing' }],
  'Pl1': [{ feature: 'Person', value: '1' }, { feature: 'Number', value: 'Plur' }],
  'Pl2': [{ feature: 'Person', value: '2' }, { feature: 'Number', value: 'Plur' }],
  'Pl3': [{ feature: 'Person', value: '3' }, { feature: 'Number', value: 'Plur' }],

  // Uralic Subject Agreement
  'ScSg1': [{ feature: 'Person[subj]', value: '1' }, { feature: 'Number[subj]', value: 'Sing' }],
  'ScSg2': [{ feature: 'Person[subj]', value: '2' }, { feature: 'Number[subj]', value: 'Sing' }],
  'ScSg3': [{ feature: 'Person[subj]', value: '3' }, { feature: 'Number[subj]', value: 'Sing' }],
  'ScSg3F': [{ feature: 'Person[subj]', value: '3' }, { feature: 'Number[subj]', value: 'Sing' }, { feature: 'Gender[subj]', value: 'Fem' }],
  'ScSg3M': [{ feature: 'Person[subj]', value: '3' }, { feature: 'Number[subj]', value: 'Sing' }, { feature: 'Gender[subj]', value: 'Masc' }],
  'ScPl1': [{ feature: 'Person[subj]', value: '1' }, { feature: 'Number[subj]', value: 'Plur' }],
  'ScPl2': [{ feature: 'Person[subj]', value: '2' }, { feature: 'Number[subj]', value: 'Plur' }],
  'ScPl3': [{ feature: 'Person[subj]', value: '3' }, { feature: 'Number[subj]', value: 'Plur' }],
  'ScPl3F': [{ feature: 'Person[subj]', value: '3' }, { feature: 'Number[subj]', value: 'Plur' }, { feature: 'Gender[subj]', value: 'Fem' }],
  'ScPl3M': [{ feature: 'Person[subj]', value: '3' }, { feature: 'Number[subj]', value: 'Plur' }, { feature: 'Gender[subj]', value: 'Masc' }],

  // Uralic Object Agreement
  'OcSg1': [{ feature: 'Person[obj]', value: '1' }, { feature: 'Number[obj]', value: 'Sing' }],
  'OcSg2': [{ feature: 'Person[obj]', value: '2' }, { feature: 'Number[obj]', value: 'Sing' }],
  'OcSg3': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Sing' }],
  'OcSg3F': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Sing' }, { feature: 'Gender[obj]', value: 'Fem' }],
  'OcSg3M': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Sing' }, { feature: 'Gender[obj]', value: 'Masc' }],
  'OcPl1': [{ feature: 'Person[obj]', value: '1' }, { feature: 'Number[obj]', value: 'Plur' }],
  'OcPl2': [{ feature: 'Person[obj]', value: '2' }, { feature: 'Number[obj]', value: 'Plur' }],
  'OcPl3': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Plur' }],
  'OcPl3F': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Plur' }, { feature: 'Gender[obj]', value: 'Fem' }],
  'OcPl3M': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Plur' }, { feature: 'Gender[obj]', value: 'Masc' }],
  'Oc3F': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Plur,Sing' }, { feature: 'Gender[obj]', value: 'Fem' }],
  'Oc3M': [{ feature: 'Person[obj]', value: '3' }, { feature: 'Number[obj]', value: 'Plur,Sing' }, { feature: 'Gender[obj]', value: 'Masc' }],

  // Possessive Suffixes
  'PxSg1': [{ feature: 'Person[psor]', value: '1' }, { feature: 'Number[psor]', value: 'Sing' }],
  'PxSg2': [{ feature: 'Person[psor]', value: '2' }, { feature: 'Number[psor]', value: 'Sing' }],
  'PxSg3': [{ feature: 'Person[psor]', value: '3' }, { feature: 'Number[psor]', value: 'Sing' }],
  'PxSg3F': [{ feature: 'Person[psor]', value: '3' }, { feature: 'Number[psor]', value: 'Sing' }, { feature: 'Gender[psor]', value: 'Fem' }],
  'PxSg3M': [{ feature: 'Person[psor]', value: '3' }, { feature: 'Number[psor]', value: 'Sing' }, { feature: 'Gender[psor]', value: 'Masc' }],
  'PxPl1': [{ feature: 'Person[psor]', value: '1' }, { feature: 'Number[psor]', value: 'Plur' }],
  'PxPl2': [{ feature: 'Person[psor]', value: '2' }, { feature: 'Number[psor]', value: 'Plur' }],
  'PxPl3': [{ feature: 'Person[psor]', value: '3' }, { feature: 'Number[psor]', value: 'Plur' }],
  'PxPl3F': [{ feature: 'Person[psor]', value: '3' }, { feature: 'Number[psor]', value: 'Plur' }, { feature: 'Gender[psor]', value: 'Fem' }],
  'PxPl3M': [{ feature: 'Person[psor]', value: '3' }, { feature: 'Number[psor]', value: 'Plur' }, { feature: 'Gender[psor]', value: 'Masc' }],

  // Possessed Suffixes
  'NPossd': [{ feature: 'Possessed', value: 'No' }],
  'Possd': [{ feature: 'Possessed', value: 'Yes' }],
    
  // Connegative
  'ConNeg': { feature: 'Connegative', value: 'Yes' },

  // Adposition Type (subcategories of UPOS ADP)
  'Po': { feature: 'AdpType', value: 'Post' },
  'Pr': { feature: 'AdpType', value: 'Prep' },
  'Post': { feature: 'AdpType', value: 'Post' },
  'Prep': { feature: 'AdpType', value: 'Prep' },

  // Orthographical / Typographical Variation (keyboard accommodation & dialect variance)
  'Err/Orth': { feature: 'Typo', value: 'Yes' },
  'SplRlx': { feature: 'Typo', value: 'Yes' },
};

/**
 * GiellaLT variant tags (+v1, +v2, ... +v25) say which variant of a word an analysis is. They are not
 * Feature=Value pairs: v1 comes first, but every variant is allowed. Their place is the MISC column
 * (GTtags=..., the whole tag readout). Derivation tags (Der) likewise give no feature of their own.
 */
export const isVariantTag = (tag) => /^v\d+$/.test(tag);
/** The variant number of a tag list (v1 -> 1), or null when the analysis carries no variant tag. */
export const variantNumber = (tags) => {
  const tag = (tags || []).find(isVariantTag);
  return tag ? Number(tag.slice(1)) : null;
};

/**
 * Tag order carries meaning here. `Adp` straight after the lemma (vahel+Adp) is the adposition POS tag. After another
 * POS tag it is a case of Apurinã: the form of a pronoun used only before postpositions (ywa+Pron+Pers+Adp).
 */
export const adpIsCase = (tags) => {
  const at = (tags || []).indexOf('Adp');
  return at > 0 && tags.slice(0, at).some((t) => t !== 'Adp' && POS_TO_UPOS[t]);
};

/**
 * Strips all occurrences of +Guess, Guess+, «+Guess», «Guess», and adjacent
 * compound/boundary guess markers from an analysis or lemma string, while
 * strictly preserving the English lexical word "guess" (e.g., in guess+V+Inf).
 * @param {string} str
 * @returns {string}
 */
export function stripGuessTags(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str.trim();

  // If explicit guess tag symbol (+Guess or «Guess» or «+Guess»)
  if (/^(?:\+guess|«\+?guess»)$/i.test(s)) return '';

  // Strip guillemet variants: «+Guess» or «Guess» anywhere
  s = s.replace(/«\+?guess»/gi, '');

  // Strip +Guess or +guess adjacent to +, #, or ends
  s = s.replace(/\+guess(?=\+|$|#)/gi, '');

  // Strip #+Guess or #Guess before +, #, or end
  s = s.replace(/#\+?guess(?=\+|$|#)/gi, '#');

  // Initial Guess+ or Guess# - only strip if NOT followed by a POS tag (e.g., preserve guess+V+Inf)
  const initMatch = s.match(/^guess(\+|#)(.*)/i);
  if (initMatch) {
    const nextPart = initMatch[2].split(/[+#]/)[0];
    if (!POS_TO_UPOS[nextPart]) {
      s = initMatch[2];
    }
  }

  // Final +Guess or #Guess
  s = s.replace(/(?:\+|#)guess$/i, '');

  // Clean up duplicate or trailing/leading delimiters
  s = s.replace(/\+{2,}/g, '+');
  s = s.replace(/^#?\+/, '').replace(/\+#/g, '#').replace(/#\+/g, '#');
  s = s.replace(/\+$/, '');

  if (/^(?:\+guess|«\+?guess»)$/i.test(s.trim())) return '';
  return s.trim();
}

export class TagMapper {
  /**
   * Directly derives Universal Dependencies UPOS from a morphological analysis string or tag array.
   * e.g., NOUN < +N, VERB < +V, PROPN < +Prop, ADJ < +A, ADV < +Adv
   * @param {string|string[]} analysisOrTags
   * @returns {string} UPOS tag (e.g. 'NOUN', 'VERB', 'ADJ', etc.)
   */
  static deriveUpos(analysisOrTags) {
    if (!analysisOrTags) return 'X';

    let tags = [];
    if (Array.isArray(analysisOrTags)) {
      tags = analysisOrTags;
    } else if (typeof analysisOrTags === 'string') {
      const parts = analysisOrTags.split('+');
      tags = parts.length > 1 ? parts.slice(1) : [parts[0]];
    }

    if (tags.length === 1 && /[.,!?;:\-–—«»"']/.test(tags[0])) {
      return 'PUNCT';
    }

    const tagSet = new Set(adpIsCase(tags) ? tags.filter((t) => t !== 'Adp') : tags);

    // 1. Proper Noun precedence (Prop, Sem/Plc, Sem/Sur, Sem/Mal, Sem/Fem, etc.)
    if (tagSet.has('Prop') || tagSet.has('PROPN') || tags.some(t => t.startsWith('Sem/') || t === 'Prop')) {
      return 'PROPN';
    }

    // 2. Auxiliary Verb precedence (Aux)
    if (tagSet.has('Aux') || tagSet.has('AUX')) {
      return 'AUX';
    }

    // 3. Determiner (Det)
    if (tagSet.has('Det') || tagSet.has('DET')) {
      return 'DET';
    }

    // 4. Subordinating Conjunction (CS, SCONJ)
    if (tagSet.has('CS') || tagSet.has('SCONJ')) {
      return 'SCONJ';
    }

    // 5. Coordinating Conjunction (CC, Conj, CCONJ)
    if (tagSet.has('CC') || tagSet.has('Conj') || tagSet.has('CCONJ')) {
      return 'CCONJ';
    }

    // 6. Postposition / Preposition / Adposition (Po, Pr, Adp, ADP)
    if (tagSet.has('Po') || tagSet.has('Pr') || tagSet.has('Adp') || tagSet.has('ADP')) {
      return 'ADP';
    }

    // 7. Core Parts of Speech: Noun < +N, Verb < +V, Adjective < +A, Adverb < +Adv, Pronoun < +Pron, Numeral < +Num
    if (tagSet.has('N') || tagSet.has('Noun') || tagSet.has('NOUN')) {
      return 'NOUN';
    }
    if (tagSet.has('V') || tagSet.has('Verb') || tagSet.has('VERB')) {
      return 'VERB';
    }
    if (tagSet.has('A') || tagSet.has('Adj') || tagSet.has('ADJ')) {
      return 'ADJ';
    }
    if (tagSet.has('Adv') || tagSet.has('ADV')) {
      return 'ADV';
    }
    if (tagSet.has('Pron') || tagSet.has('PRON')) {
      return 'PRON';
    }
    if (tagSet.has('Num') || tagSet.has('NUM')) {
      return 'NUM';
    }

    // 8. Particle, Interjection, Punctuation, Symbol
    if (tagSet.has('Pcle') || tagSet.has('Pcl') || tagSet.has('Part') || tagSet.has('PART')) {
      return 'PART';
    }
    if (tagSet.has('Interj') || tagSet.has('Inj') || tagSet.has('INTJ')) {
      return 'INTJ';
    }
    if (tagSet.has('CLB') || tagSet.has('Punct') || tagSet.has('PUNCT')) {
      return 'PUNCT';
    }
    if (tagSet.has('Sym') || tagSet.has('SYM')) {
      return 'SYM';
    }

    // Fallback: check POS_TO_UPOS directly for any tag
    for (const tag of tags) {
      if (POS_TO_UPOS[tag]) return POS_TO_UPOS[tag];
    }

    return 'X';
  }

  /**
   * Returns the canonical morphological POS tag corresponding to a UD UPOS.
   * e.g., NOUN -> N, VERB -> V, ADJ -> A, etc.
   * @param {string} upos
   * @returns {string}
   */
  static uposToPosTag(upos) {
    return UPOS_TO_POS[upos] || 'X';
  }

  /**
   * Utility to strip guess tags from an analysis string or lemma.
   * @param {string} str
   * @returns {string}
   */
  static stripGuessTags(str) {
    return stripGuessTags(str);
  }

  /**
   * Parse a raw analysis string (e.g., "вастома+N+Sg+Nom+Def") into structured fields.
   * @param {string} rawAnalysis
   * @param {number} [weight=0.0]
   * @returns {Object}
   */
  static parse(rawAnalysis, weight = 0.0) {
    if (!rawAnalysis || typeof rawAnalysis !== 'string') {
      return {
        raw: '',
        cleanRaw: '',
        lemma: '',
        pos: 'X',
        upos: 'X',
        tags: [],
        cleanTags: [],
        feats: '_',
        featsMap: {},
        weight: 0.0,
        isGuessed: false
      };
    }

    let isGuessed = false;

    // Detect if this analysis contains a guess tag:
    // +Guess, Guess+, «+Guess», «Guess», +Guess# or infix/suffix +Guess
    if (/«\+?guess»/i.test(rawAnalysis) || /\+guess(?:\+|$|#)/i.test(rawAnalysis) || /#\+?guess(?:\+|$|#)/i.test(rawAnalysis)) {
      isGuessed = true;
    } else if (/^guess(?:\+|#)/i.test(rawAnalysis)) {
      const after = rawAnalysis.slice(5).replace(/^[+#]/, '');
      const nextPart = after.split(/[+#]/)[0];
      if (!POS_TO_UPOS[nextPart]) {
        isGuessed = true;
      }
    } else if (/(?:\+|#)guess$/i.test(rawAnalysis)) {
      isGuessed = true;
    }

    const cleanRaw = stripGuessTags(rawAnalysis);

    // Extract compound lemma or simple lemma across '#' boundaries
    let lemma = '';
    if (cleanRaw.includes('#')) {
      const sections = cleanRaw.split('#').filter(Boolean);
      for (const sec of sections) {
        const secParts = sec.split('+').filter(Boolean);
        if (secParts.length > 0) lemma += secParts[0];
      }
    } else {
      const parts = cleanRaw.split('+').filter(Boolean);
      lemma = parts[0] || '';
    }
    lemma = lemma.replace(/#/g, '').trim();

    // Extract clean tags (without Guess and without compound lemma stems)
    let cleanTags = [];
    if (cleanRaw.includes('#')) {
      const sections = cleanRaw.split('#').filter(Boolean);
      for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const secParts = sections[sIdx].split('+').filter(Boolean);
        if (secParts.length > 1) {
          cleanTags.push(...secParts.slice(1));
        }
      }
    } else {
      const parts = cleanRaw.split('+').filter(Boolean);
      cleanTags = parts.slice(1);
    }
    cleanTags = cleanTags.filter(t => !/^«?\+?guess»?$/i.test(t));

    // Full tags array (preserves 'Guess' tag if isGuessed is true, for Paradigm Explorer & inspection)
    const tags = [...cleanTags];
    if (isGuessed && !tags.some(t => /^«?\+?guess»?$/i.test(t))) {
      tags.push('Guess');
    }

    // Directly derive UPOS from cleanTags (or lemma)
    const upos = TagMapper.deriveUpos(cleanTags.length > 0 ? cleanTags : [lemma]);
    let pos = TagMapper.uposToPosTag(upos);

    // If an explicit matching tag exists in tags, preserve that specific tag for pos
    for (const tag of cleanTags) {
      if (POS_TO_UPOS[tag] === upos) {
        pos = tag;
        break;
      }
    }

    // If punctuation mark
    if (lemma.length === 1 && !cleanTags.length && /[.,!?;:\-–—«»"']/.test(lemma)) {
      pos = 'CLB';
    }

    // Map features
    const featsMap = {};
    for (const tag of cleanTags) {
      if (tag === 'Adp' && !adpIsCase(cleanTags)) continue; // the POS tag, not a case
      if (TAG_TO_FEATS[tag]) {
        const item = TAG_TO_FEATS[tag];
        if (Array.isArray(item)) {
          for (const sub of item) {
            featsMap[sub.feature] = sub.value;
          }
        } else {
          featsMap[item.feature] = item.value;
        }
      } else if (/^Err\/Orth/i.test(tag) || /^Err\//i.test(tag) || /^SplRlx/i.test(tag)) {
        featsMap['Typo'] = 'Yes';
      }
    }

    // Identify language-specific orthography / keyboard accommodation tags (e.g. Err/Orth-no-pal)
    const orthErrTag = cleanTags.find(t => /^Err\/Orth/i.test(t) || /^Err\//i.test(t) || t === 'Err/Orth');
    const isOrthErr = Boolean(orthErrTag);

    // Identify spell relax tag (+SplRlx)
    const isSplRlx = cleanTags.includes('SplRlx') || cleanTags.some(t => /^SplRlx/i.test(t));

    // Sort features alphabetically according to Universal Dependencies guidelines
    const featKeys = Object.keys(featsMap).sort((a, b) => a.localeCompare(b));
    const feats = featKeys.length > 0
      ? featKeys.map(k => `${k}=${featsMap[k]}`).join('|')
      : '_';

    return {
      raw: rawAnalysis,
      cleanRaw,
      lemma,
      pos,
      upos,
      tags,
      cleanTags,
      feats,
      featsMap,
      weight,
      isGuessed,
      isOrthErr,
      orthErrTag: orthErrTag || null,
      isSplRlx
    };
  }

  /**
   * Builds an analysis string from lemma and tags.
   */
  static stringify(lemma, tags) {
    if (!tags || tags.length === 0) return lemma;
    return `${lemma}+${tags.join('+')}`;
  }
}
