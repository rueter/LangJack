/**
 * SpellRelaxService
 * 
 * Provides keyboard accommodation and spelling relaxation rules across Uralic and minority languages.
 * When keyboards lack precomposed diacritics (e.g. palatalization in Võro: ĺ, ś, ń, ŕ...),
 * users type substitute digraphs or character combinations (e.g. l', s', n', r').
 * 
 * This service maps between relaxed input forms and canonical orthography, and tags
 * analyses derived from spell relax with the generic tag '+SplRlx'.
 */

export const SPELL_RELAX_RULES = {
  // Võro (vro): Palatalization marked with acute on consonants (ĺ, ś, ń, ŕ, t́, d́, b́, ṕ, ḿ, v́, f́, ǵ, ḱ, h́)
  // Keyboard workarounds type consonant + apostrophe / acute variations
  vro: [
    // Lowercase
    { canonical: 'ĺ', relaxed: ["l'", 'l’', 'lʼ', 'l´', 'l`', 'lˊ', 'l\u0301'] },
    { canonical: 'ś', relaxed: ["s'", 's’', 'sʼ', 's´', 's`', 'sˊ', 's\u0301'] },
    { canonical: 'ń', relaxed: ["n'", 'n’', 'nʼ', 'n´', 'n`', 'nˊ', 'n\u0301'] },
    { canonical: 'ŕ', relaxed: ["r'", 'r’', 'rʼ', 'r´', 'r`', 'rˊ', 'r\u0301'] },
    { canonical: 't́', relaxed: ["t'", 't’', 'tʼ', 't´', 't`', 'tˊ', 't\u0301'] },
    { canonical: 'd́', relaxed: ["d'", 'd’', 'dʼ', 'd´', 'd`', 'dˊ', 'd\u0301'] },
    { canonical: 'b́', relaxed: ["b'", 'b’', 'bʼ', 'b´', 'b`', 'bˊ', 'b\u0301'] },
    { canonical: 'ṕ', relaxed: ["p'", 'p’', 'pʼ', 'p´', 'p`', 'pˊ', 'p\u0301'] },
    { canonical: 'ḿ', relaxed: ["m'", 'm’', 'mʼ', 'm´', 'm`', 'mˊ', 'm\u0301'] },
    { canonical: 'v́', relaxed: ["v'", 'v’', 'vʼ', 'v´', 'v`', 'vˊ', 'v\u0301'] },
    { canonical: 'f́', relaxed: ["f'", 'f’', 'fʼ', 'f´', 'f`', 'fˊ', 'f\u0301'] },
    { canonical: 'ǵ', relaxed: ["g'", 'g’', 'gʼ', 'g´', 'g`', 'gˊ', 'g\u0301'] },
    { canonical: 'ḱ', relaxed: ["k'", 'k’', 'kʼ', 'k´', 'k`', 'kˊ', 'k\u0301'] },
    { canonical: 'h́', relaxed: ["h'", 'h’', 'hʼ', 'h´', 'h`', 'hˊ', 'h\u0301'] },
    // Uppercase
    { canonical: 'Ĺ', relaxed: ["L'", 'L’', 'Lʼ', 'L´', 'L`', 'Lˊ', 'L\u0301'] },
    { canonical: 'Ś', relaxed: ["S'", 'S’', 'Sʼ', 'S´', 'S`', 'Sˊ', 'S\u0301'] },
    { canonical: 'Ń', relaxed: ["N'", 'N’', 'Nʼ', 'N´', 'N`', 'Nˊ', 'N\u0301'] },
    { canonical: 'Ŕ', relaxed: ["R'", 'R’', 'Rʼ', 'R´', 'R`', 'Rˊ', 'R\u0301'] },
    { canonical: 'T́', relaxed: ["T'", 'T’', 'Tʼ', 'T´', 'T`', 'Tˊ', 'T\u0301'] },
    { canonical: 'D́', relaxed: ["D'", 'D’', 'Dʼ', 'D´', 'D`', 'Dˊ', 'D\u0301'] },
    { canonical: 'B́', relaxed: ["B'", 'B’', 'Bʼ', 'B´', 'B`', 'Bˊ', 'B\u0301'] },
    { canonical: 'Ṕ', relaxed: ["P'", 'P’', 'Pʼ', 'P´', 'P`', 'Pˊ', 'P\u0301'] },
    { canonical: 'Ḿ', relaxed: ["M'", 'M’', 'Mʼ', 'M´', 'M`', 'Mˊ', 'M\u0301'] },
    { canonical: 'V́', relaxed: ["V'", 'V’', 'Vʼ', 'V´', 'V`', 'Vˊ', 'V\u0301'] },
    { canonical: 'F́', relaxed: ["F'", 'F’', 'Fʼ', 'F´', 'F`', 'Fˊ', 'F\u0301'] },
    { canonical: 'Ǵ', relaxed: ["G'", 'G’', 'Gʼ', 'G´', 'G`', 'Gˊ', 'G\u0301'] },
    { canonical: 'Ḱ', relaxed: ["K'", 'K’', 'Kʼ', 'K´', 'K`', 'Kˊ', 'K\u0301'] },
    { canonical: 'H́', relaxed: ["H'", 'H’', 'Hʼ', 'H´', 'H`', 'Hˊ', 'H\u0301'] }
  ],

  // North Saami (sme)
  sme: [
    { canonical: 'á', relaxed: ["a'", 'a1'] },
    { canonical: 'č', relaxed: ["c'", 'c1', 'cz', 'ch'] },
    { canonical: 'đ', relaxed: ["d'", 'd1', 'dh'] },
    { canonical: 'ŋ', relaxed: ["n'", 'n1', 'ng'] },
    { canonical: 'š', relaxed: ["s'", 's1', 'sh'] },
    { canonical: 'ŧ', relaxed: ["t'", 't1', 'th'] },
    { canonical: 'ž', relaxed: ["z'", 'z1', 'zh'] },
    { canonical: 'Á', relaxed: ["A'", 'A1'] },
    { canonical: 'Č', relaxed: ["C'", 'C1', 'Cz', 'Ch'] },
    { canonical: 'Đ', relaxed: ["D'", 'D1', 'Dh'] },
    { canonical: 'Ŋ', relaxed: ["N'", 'N1', 'Ng'] },
    { canonical: 'Š', relaxed: ["S'", 'S1', 'Sh'] },
    { canonical: 'Ŧ', relaxed: ["T'", 'T1', 'Th'] },
    { canonical: 'Ž', relaxed: ["Z'", 'Z1', 'Zh'] }
  ],

  // Inari Saami (smn)
  smn: [
    { canonical: 'â', relaxed: ["a'", 'a^'] },
    { canonical: 'č', relaxed: ["c'", 'c1'] },
    { canonical: 'đ', relaxed: ["d'", 'd1'] },
    { canonical: 'ŋ', relaxed: ["n'", 'n1'] },
    { canonical: 'š', relaxed: ["s'", 's1'] },
    { canonical: 'ž', relaxed: ["z'", 'z1'] },
    { canonical: 'ä', relaxed: ['a"'] },
    { canonical: 'ö', relaxed: ['o"'] },
    { canonical: 'Â', relaxed: ["A'", 'A^'] },
    { canonical: 'Č', relaxed: ["C'", 'C1'] },
    { canonical: 'Đ', relaxed: ["D'", 'D1'] },
    { canonical: 'Ŋ', relaxed: ["N'", 'N1'] },
    { canonical: 'Š', relaxed: ["S'", 'S1'] },
    { canonical: 'Ž', relaxed: ["Z'", 'Z1'] },
    { canonical: 'Ä', relaxed: ['A"'] },
    { canonical: 'Ö', relaxed: ['O"'] }
  ],

  // Skolt Saami (sms)
  sms: [
    { canonical: 'â', relaxed: ["a'", 'a^'] },
    { canonical: 'č', relaxed: ["c'"] },
    { canonical: 'ʒ', relaxed: ['3', "z'"] },
    { canonical: 'ǯ', relaxed: ["3'", 'z"'] },
    { canonical: 'đ', relaxed: ["d'"] },
    { canonical: 'ǥ', relaxed: ["g'"] },
    { canonical: 'ǩ', relaxed: ["k'"] },
    { canonical: 'ŋ', relaxed: ["n'"] },
    { canonical: 'õ', relaxed: ['o~'] },
    { canonical: 'š', relaxed: ["s'"] },
    { canonical: 'ž', relaxed: ["z'"] },
    { canonical: 'Â', relaxed: ["A'", 'A^'] },
    { canonical: 'Č', relaxed: ["C'"] },
    { canonical: 'Ʒ', relaxed: ['3', "Z'"] },
    { canonical: 'Ǯ', relaxed: ["3'", 'Z"'] },
    { canonical: 'Đ', relaxed: ["D'"] },
    { canonical: 'Ǥ', relaxed: ["G'"] },
    { canonical: 'Ǩ', relaxed: ["K'"] },
    { canonical: 'Ŋ', relaxed: ["N'"] },
    { canonical: 'Õ', relaxed: ['O~'] },
    { canonical: 'Š', relaxed: ["S'"] },
    { canonical: 'Ž', relaxed: ["Z'"] }
  ],

  // Livonian (liv)
  liv: [
    { canonical: 'ā', relaxed: ['a-', 'aa'] },
    { canonical: 'ǟ', relaxed: ['ä-', 'ää'] },
    { canonical: 'ḑ', relaxed: ["d'", 'dj'] },
    { canonical: 'ē', relaxed: ['e-', 'ee'] },
    { canonical: 'ī', relaxed: ['i-', 'ii'] },
    { canonical: 'ļ', relaxed: ["l'", 'lj'] },
    { canonical: 'ņ', relaxed: ["n'", 'nj'] },
    { canonical: 'ō', relaxed: ['o-', 'oo'] },
    { canonical: 'ȱ', relaxed: ['ö-', 'öö'] },
    { canonical: 'ȓ', relaxed: ["r'", 'rj'] },
    { canonical: 'ŗ', relaxed: ["r'", 'rj'] },
    { canonical: 'ț', relaxed: ["t'", 'tj'] },
    { canonical: 'ū', relaxed: ['u-', 'uu'] },
    { canonical: 'ȳ', relaxed: ['y-', 'yy'] }
  ],

  // Komi-Zyrian (kpv) & Komi-Permyak (koi)
  kpv: [
    { canonical: 'ӧ', relaxed: ['ö', 'o"', "o'"] },
    { canonical: 'і', relaxed: ['i', 'i"', "i'"] },
    { canonical: 'Ӧ', relaxed: ['Ö', 'O"', "O'"] },
    { canonical: 'І', relaxed: ['I', 'I"', "I'"] }
  ],
  koi: [
    { canonical: 'ӧ', relaxed: ['ö', 'o"', "o'"] },
    { canonical: 'і', relaxed: ['i', 'i"', "i'"] },
    { canonical: 'Ӧ', relaxed: ['Ö', 'O"', "O'"] },
    { canonical: 'І', relaxed: ['I', 'I"', "I'"] }
  ],

  // Udmurt (udm)
  udm: [
    { canonical: 'ӝ', relaxed: ["ж'"] },
    { canonical: 'ӟ', relaxed: ["з'"] },
    { canonical: 'ӥ', relaxed: ["и'"] },
    { canonical: 'ӧ', relaxed: ['ö', "о'"] },
    { canonical: 'ӵ', relaxed: ["ч'"] },
    { canonical: 'Ӝ', relaxed: ["Ж'"] },
    { canonical: 'Ӟ', relaxed: ["З'"] },
    { canonical: 'Ӥ', relaxed: ["И'"] },
    { canonical: 'Ӧ', relaxed: ['Ö', "О'"] },
    { canonical: 'Ӵ', relaxed: ["Ч'"] }
  ],

  // Mari (mhr, mrj)
  mhr: [
    { canonical: 'ӓ', relaxed: ['ä', 'а"'] },
    { canonical: 'ӧ', relaxed: ['ö', 'о"'] },
    { canonical: 'ӱ', relaxed: ['ü', 'у"'] },
    { canonical: 'ӹ', relaxed: ['ы"'] },
    { canonical: 'ҥ', relaxed: ["н'"] }
  ],
  mrj: [
    { canonical: 'ӓ', relaxed: ['ä', 'а"'] },
    { canonical: 'ӧ', relaxed: ['ö', 'о"'] },
    { canonical: 'ӱ', relaxed: ['ü', 'у"'] },
    { canonical: 'ӹ', relaxed: ['ы"'] },
    { canonical: 'ҥ', relaxed: ["н'"] }
  ]
};

export class SpellRelaxService {
  /**
   * Retrieves the rules list for the given language.
   * @param {string} lang
   * @returns {Array<{canonical: string, relaxed: string[]}>}
   */
  static getRules(lang) {
    if (!lang) return [];
    const cleanLang = lang.trim().toLowerCase();
    return SPELL_RELAX_RULES[cleanLang] || [];
  }

  /**
   * Checks whether the given word contains any spell-relax sequence for this language.
   * @param {string} word
   * @param {string} lang
   * @returns {boolean}
   */
  static hasRelaxPattern(word, lang) {
    if (!word || typeof word !== 'string') return false;
    const rules = this.getRules(lang);
    if (!rules.length) return false;

    for (const rule of rules) {
      for (const rel of rule.relaxed) {
        if (word.includes(rel)) return true;
      }
    }
    return false;
  }

  /**
   * Converts a word typed with keyboard spell relaxes into its canonical form.
   * E.g. "kiil'" in vro -> "kiiĺ"
   * @param {string} word
   * @param {string} lang
   * @returns {string}
   */
  static toCanonical(word, lang) {
    if (!word || typeof word !== 'string') return word || '';
    const rules = this.getRules(lang);
    if (!rules.length) return word;

    let res = word;
    for (const rule of rules) {
      for (const rel of rule.relaxed) {
        if (res.includes(rel)) {
          res = res.split(rel).join(rule.canonical);
        }
      }
    }
    return res;
  }

  /**
   * Determines if a particular raw analysis string (or its lemma) was produced by
   * substituting a spell-relaxed pattern in surfaceWord with a canonical character.
   * 
   * For example, in vro:
   * surfaceWord: "kiil'"
   * analysisStr: "kiiĺ+N+Sg+Nom" -> TRUE (surface has "l'", reading has "ĺ")
   * analysisStr: "kiilma+V+Act+Ind+Prt+Sg3" -> FALSE (surface has "l'", but reading has "l", not "ĺ")
   * 
  /**
   * Determines if a particular raw analysis string (or its inflected/generated form) was produced by
   * substituting a spell-relaxed pattern in surfaceWord with a canonical character.
   * 
   * For example, in vro:
   * surfaceWord: "kiil'"
   * analysisStr: "kiiĺ+N+Sg+Nom" -> TRUE (surface has "l'", reading has "ĺ")
   * 
   * surfaceWord: "oll'"
   * analysisStr: "olõma+V+Act+Ind+Prt+Sg3" -> TRUE (surface has "l'", standard form is "olĺ")
   * 
   * @param {string} surfaceWord
   * @param {string} analysisStr
   * @param {string} lang
   * @param {string} [generatedForm=null]
   * @returns {boolean}
   */
  static isSpellRelaxReading(surfaceWord, analysisStr, lang, generatedForm = null) {
    if (!surfaceWord || !analysisStr || !lang) return false;
    const rules = this.getRules(lang);
    if (!rules.length) return false;

    // Check both lemma, the full analysis string, generated form, and canonical surface
    const lemma = analysisStr.split('+')[0] || '';
    const canonicalSurface = this.toCanonical(surfaceWord, lang);

    for (const rule of rules) {
      const canonical = rule.canonical;
      // Check if surface contains any of the relaxed forms for this canonical letter
      const matchingRelaxed = rule.relaxed.filter(rel => surfaceWord.includes(rel));
      if (matchingRelaxed.length > 0) {
        // If lemma contains canonical (e.g. kiiĺ for kiil')
        // OR generated form contains canonical (e.g. olĺ for oll')
        // OR canonicalSurface contains canonical (e.g. olĺ for oll')
        const targetContainsCanonical = lemma.includes(canonical) ||
                                       analysisStr.includes(canonical) ||
                                       (generatedForm && generatedForm.includes(canonical)) ||
                                       (canonicalSurface && canonicalSurface.includes(canonical) && canonicalSurface !== surfaceWord);

        if (targetContainsCanonical) {
          if (!surfaceWord.includes(canonical)) {
            return true;
          }
          const countInSurface = (surfaceWord.match(new RegExp(escapeRegExp(canonical), 'g')) || []).length;
          const countInTarget = Math.max(
            (lemma.match(new RegExp(escapeRegExp(canonical), 'g')) || []).length,
            (canonicalSurface.match(new RegExp(escapeRegExp(canonical), 'g')) || []).length,
            generatedForm ? (generatedForm.match(new RegExp(escapeRegExp(canonical), 'g')) || []).length : 0
          );
          if (countInTarget > countInSurface) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Strips all +SplRlx and +Err/Orth* type tags from an analysis string,
   * returning clean canonical tags suitable for generator lookup.
   * e.g., "olõma+V+Act+Ind+Prt+Sg3+SplRlx" -> "olõma+V+Act+Ind+Prt+Sg3"
   * e.g., "kiiĺ+N+Err/Orth-no-pal+Sg+Nom" -> "kiiĺ+N+Sg+Nom"
   * @param {string} tagStr
   * @returns {string}
   */
  static stripSplRlxAndOrthTags(tagStr) {
    if (!tagStr || typeof tagStr !== 'string') return '';
    return tagStr
      .replace(/\+SplRlx(?=\+|$)/gi, '')
      .replace(/\+Err\/[A-Za-z0-9_-]+(?=\+|$)/gi, '')
      .replace(/\+Err(?=\+|$)/gi, '')
      .replace(/\+{2,}/g, '+')
      .replace(/^#?\+/, '')
      .replace(/\+$/, '')
      .trim();
  }

  /**
   * Reconstructs the standard normative form (X for CorrectForm=X) from surfaceWord and analysisStr.
   * e.g. "oll'" -> "olĺ", "kiil'" -> "kiiĺ", "kiil" (+Err/Orth-no-pal) -> "kiiĺ"
   * @param {string} surfaceWord
   * @param {string} analysisStr
   * @param {string} lang
   * @returns {string}
   */
  static getCorrectForm(surfaceWord, analysisStr, lang) {
    if (this.hasRelaxPattern(surfaceWord, lang)) {
      const canon = this.toCanonical(surfaceWord, lang);
      if (canon && canon !== surfaceWord) return canon;
    }
    // If analysis had Err/Orth-no-pal (e.g. surface "kiil", reading "kiiĺ+N+Err/Orth-no-pal+Sg+Nom")
    if (analysisStr && (/Err\/Orth/i.test(analysisStr) || /Err\//i.test(analysisStr))) {
      const clean = this.stripSplRlxAndOrthTags(analysisStr);
      const lemma = clean.split('+')[0];
      if (lemma && lemma !== surfaceWord) return lemma;
    }
    return surfaceWord || '';
  }

  /**
   * Appends '+SplRlx' to an analysis string if not already present.
   * @param {string} analysisStr
   * @returns {string}
   */
  static appendSplRlx(analysisStr) {
    if (!analysisStr || typeof analysisStr !== 'string') return analysisStr;
    if (analysisStr.includes('+SplRlx') || analysisStr.endsWith('SplRlx')) {
      return analysisStr;
    }
    return `${analysisStr}+SplRlx`;
  }

  /**
   * Processes a list of raw analysis strings for surfaceWord, tagging matching spell-relax readings
   * with '+SplRlx'.
   * @param {string} surfaceWord
   * @param {Array<[string, number]>} rawResults - HFST lookup results [[analysis, weight], ...]
   * @param {string} lang
   * @returns {Array<[string, number]>}
   */
  static tagRawResults(surfaceWord, rawResults, lang) {
    if (!rawResults || !rawResults.length) return [];
    
    return rawResults.map(([analysis, weight]) => {
      const shouldTag = this.isSpellRelaxReading(surfaceWord, analysis, lang);
      if (shouldTag) {
        return [this.appendSplRlx(analysis), weight];
      }
      return [analysis, weight];
    });
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
