/**
 * Chrome Service Worker (Manifest V3 background script)
 * - Registers context menu items for dictionary translation and moving selections to the Annotator UI.
 * - Dynamically updates context menu with quick dictionary translations when text is selected.
 * - Dispatches full morphological analysis and dictionary lookups to the in-page Dictionary UI.
 * - Handles navigation to the Annotator UI with pre-loaded text and language.
 */

import { analyzerService, normalizeLangCode, KNOWN_LANGUAGES } from './js/services/analyzer-service.js';
import { dictionaryService } from './js/services/dictionary-service.js';
import { storageService } from './js/services/storage-service.js';
import { stripGuessTags } from './js/services/tag-mapper.js';

// Cross-browser WebExtension compatibility alias: maps browser to chrome if needed
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser;
}

let isServicesInitialized = false;

export async function ensureServices(lang = null) {
  try {
    const targetLang = normalizeLangCode(lang || (await storageService.getSetting('ui_src_lang', 'myv')));
    await analyzerService.ensureModelForLanguage(targetLang);
    await dictionaryService.init();
    isServicesInitialized = true;
  } catch (err) {
    console.warn('Background service init warning:', err);
  }
}

// Retains active source language per tab/webpage for instant subsequent lookups
export const tabLanguageCache = new Map();

if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabLanguageCache.delete(tabId);
  });
}

/**
 * Detects language heuristics based on characteristic orthography and alphabet markers.
 * Used as fallback recognition when manually selected/preferred language yields 0 readings.
 */
export function detectLanguageForWord(word, defaultLang = 'myv') {
  if (!word || typeof word !== 'string') return defaultLang;
  const clean = word.trim();

  // 0. Lushootseed (lut) and Southern Lushootseed (slh) – checked first, since their «č, š, ǰ»
  //    would otherwise route to Sámi and «ts» (tsi, huyutsut) to Apurinã
  if (isLushootseedWord(clean)) {
    return detectLushootseedVariety(clean, defaultLang);
  }
  // Unmarked words (kawič, stubš, huyutsut) stay with a lut/slh default if spelled in its alphabet
  if ((defaultLang === 'lut' || defaultLang === 'slh') && /^[abcdghijklmnpqstuwxy̌]+$/i.test(clean.normalize('NFD'))) {
    return detectLushootseedVariety(clean, defaultLang);
  }

  // 0b. Cyrillic script, with most of the token's letters Cyrillic. Checked before the Skolt Sámi rule below: the modifier
  //     letters «ʼ» (U+02BC) and «ˮ» (U+02EE) occur in Cyrillic Nenets (пыдоʼ, ханаˮ) and must not make it sms.
  if (isMostlyCyrillic(clean)) {
    return detectCyrillicLanguage(clean, defaultLang);
  }

  // 1. Skolt Sámi specific characters (ǥ, ǧ, ǩ, ǯ, ʒ, å, ʹ, ʼ, ˈ, ẹ), all precomposed on the sms keyboard;
  //    «õ» is shared with Võro
  if (/[ǩǧǯʒʼåʹǥˈẹ]/i.test(clean) || /^[kK]åʹll/i.test(clean)) {
    return 'sms';
  }

  // 1b. Võro (vro) – before Apurinã («ts» in latsi) and the Finnish «ä…ä» rule (pühändi)
  const voro = detectVoroWord(clean, defaultLang);
  if (voro) {
    return voro;
  }

  // 2. Apurinã specific patterns
  // «ts» is ordinary in Skolt, Inari, North Sámi and Southern Sámi, Võro, Estonian and Finnish words (tuõttsõs, latsi, otsa):
  // with one of those as the default only «tx», «awapu» and the nasal vowels mean Apurinã
  const tsOrdinary = /^(sms|smn|sme|sma|vro|est|fin)$/.test(defaultLang || '');
  if (/[ãẽĩỹ]/i.test(clean) || (tsOrdinary ? /(tx|awapu)/i : /(tx|ts|awapu)/i).test(clean)) {
    return 'apu';
  }

  // 3. Finnish vowel harmony indicator: 'ä' across separate syllables separated by consonants
  if (/[ä].*?[bcdfghjklmnpqrstvwxz]+.*?[ä]/i.test(clean)) {
    return 'fin';
  }

  // 4. North Sámi specific letter ŧ (exclusive to North Sámi; does not exist in sms or smn)
  if (/ŧ/i.test(clean)) {
    return 'sme';
  }

  // 5. General Sámi characters (č, đ, ŋ, š, ž, â)
  if (/[čđŋšžâ]/i.test(clean)) {
    // If the word has 'ä', it cannot be North Sámi (sme uses á and ea, no ä)
    if (/ä/i.test(clean)) {
      return defaultLang === 'smn' ? 'smn' : 'sms';
    }
    // 'á' is used in North Sámi (sme) and Inari Sámi (smn), but not standard Skolt Sámi
    if (/[á]/i.test(clean)) {
      return /[â]/i.test(clean) ? 'smn' : 'sme';
    }
    // 'â' is shared between Skolt Sámi (sms, e.g. piânnai, čâcc, jânnam) and Inari Sámi (smn)
    if (/[â]/i.test(clean)) {
      return defaultLang === 'smn' ? 'smn' : 'sms';
    }
    if (defaultLang && /^(sms|sme|smn|sma)$/.test(defaultLang)) {
      return defaultLang;
    }
    return 'sms';
  }

  // 6. Cyrillic mixed with Latin letters in one token: as before, by the Cyrillic letters alone
  if (/[Ѐ-ӿ]/.test(clean)) {
    return detectCyrillicLanguage(clean, defaultLang);
  }

  return defaultLang || 'myv';
}

/**
 * True when most of the token's letters are Cyrillic: Cyrillic words carry stray Latin letters in some sources
 * (susoj.html: хаãвхэкомʼ, ялаýсаванодоʼ, ниоãта), and a Latin-script word with a stray Cyrillic homoglyph stays Latin.
 * Latin counts Latin-1 Supplement/Extended-A/B and Latin Extended Additional letters too.
 */
function isMostlyCyrillic(word) {
  const cyr = (word.match(/[\u0400-\u04FF]/g) || []).length;
  const lat = (word.match(/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g) || []).length;
  return cyr > 0 && cyr > lat;
}

/**
 * Removes paired quotation marks so that a closing «”» or «’» is not mistaken for a glottal-stop letter:
 * a quote char with no letter before it, and a letter after it, opens (“ „ ” ‘ ‚ ’); a «” “ ’ ‘» straight after a letter
 * closes the latest compatible opener. Both become a space. «« »» are never glottal stops and are left alone.
 * An unpaired «”» or «’» after a letter stays: that is what the Nenets «ненэцянд’ хана”» looks like.
 */
export function stripQuotePairs(text) {
  const OPEN = '“„”‘‚’«‹';
  const CLOSES = { '”': '“„”«', '“': '„', '’': '‘‚’‹', '‘': '‚', '»': '«', '›': '‹' };
  const chars = Array.from(text);
  const isLetter = c => !!c && /[\p{L}\p{M}]/u.test(c);
  const stack = [];
  const blank = new Set();
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (!(c in CLOSES) && !OPEN.includes(c)) continue;
    if (isLetter(chars[i - 1])) {
      const compat = CLOSES[c];
      if (compat) {
        for (let k = stack.length - 1; k >= 0; k--) {
          if (compat.includes(chars[stack[k]])) {
            blank.add(stack[k]);
            blank.add(i);
            stack.length = k;
            break;
          }
        }
      }
    } else if (isLetter(chars[i + 1]) && OPEN.includes(c)) {
      stack.push(i);
    }
  }
  return blank.size ? chars.map((c, i) => (blank.has(i) ? ' ' : c)).join('') : text;
}

/**
 * «э» after «в г м х» or the letter for ŋ (хэбта, мэвы, вэрдамбидов, ненэцяӊэ). Nenets writes «э» after any consonant, hard or
 * soft (the palatal vowels are «я ё ю е и»), while Erzya and Komi write it almost only after the dentals «з с т н д л р ц»
 * (сонзэ, партизантнэ, тесэ) and Moksha hardly at all. The set is limited to these letters, the non-dentals before which
 * Nenets regularly has «э»; «п» (пэвдя, 80 more Bible tokens) and the rest are left out, as Russian loans have them (мэр, пэр,
 * кэш, шэф). Measured on UD tokens: Nenets Bible 1,403 of 13,720, UD_Nenets-Tundra 69 of 912, Erzya 3 of 15,837, Moksha 0 of
 * 3,613, Komi 0, Russian 115 of 600,000 (глэм, егэ, гэс). Weak evidence: a phrase needs three such words (detectLanguageForText).
 */
const YRK_NON_DENTAL_E = /[вгмхӈңӊ]э/i;

/**
 * Tundra Nenets (yrk) suffixes that mark a word spelled with no marker letter. Taken from the affix lattice of
 * lang-yrk (src/fst/morphology/affixes/nouns.lexc, verbs.lexc; labels from its analyser) and kept only when the
 * ending is absent from the UD treebanks of Erzya, Moksha, Komi-Zyrian and Komi-Permyak, and has at most four
 * tokens in 600,000 words of UD Russian (names such as Ильхана). A stem of two letters or more is required.
 * «к» of the suffix is voiced to «г» after м and the letter for ŋ (phonology.twolc к:г: нумʼ+Sg+Loc → нумгана);
 * «-гана» alone is Russian too (органа, хулигана), so it counts only after those.
 * The Bible and UD_Nenets-Tundra were used to check the endings occur in running text, not to choose them by frequency.
 * Each rule keeps its morphological label so the rule table can later explain a classification.
 */
export const YRK_SUFFIX_RULES = [
  { re: /[\u0400-\u04FF]{2,}(?:х|[мӈңӊ]г)ана$/i, label: 'Sg+Loc -хана' },
  { re: /[\u0400-\u04FF]{2,}(?:х|[мӈңӊ]г)ад$/i, label: 'Sg+Abl -хад' },
  { re: /[\u0400-\u04FF]{2,}(?:х|[мӈңӊ]г)анда$/i, label: 'Sg+Dat+PxSg3 -ханда' },
  { re: /[\u0400-\u04FF]{2,}(?:х|[мӈңӊ]г)ата$/i, label: 'Pl+Dat+PxSg3 -хата' },
  { re: /[\u0400-\u04FF]{2,}нан(?:да|и|д)$/i, label: 'Sg+Pros/Loc+PxSg3/1/2 -нанда -нани -нанд' },
  { re: /[\u0400-\u04FF]{2,}дан(?:да|и)$/i, label: 'Sg+Abl, Pred+Gen +PxSg3/1 -данда -дани' },
  { re: /[\u0400-\u04FF]{2,}(?:дамда|амд)$/i, label: 'Acc+PxSg3/2 -дамда -амд' },
  { re: /[\u0400-\u04FF]{2,}[мн]зь$/i, label: 'Nom+Der/Cop+Ind+Prt1+Sc -мзь -нзь' },
  { re: /[\u0400-\u04FF]{2,}анзь$/i, label: 'Prt1+ScDu3 -анзь' }
];

/**
 * Komi-Zyrian (kpv) and Komi-Permyak (koi) suffixes. Both write «ӧ і», so letters cannot tell them apart; the paradigms can.
 * Taken from lang-kpv and lang-koi (analyser and generator, 200 nouns, 200 verbs, adjectives, pronouns and numerals of the
 * Bible corpora × every cell attested there), labels from the generator's tags. An ending is kept when it
 * - is common in the paradigms of one variety and absent from the other,
 * - is frequent in that variety's Bible corpus (xml_kpv 143,073 tokens, xml_koi 172,482) and nearly absent from the other's,
 * - holds in the separate UD treebanks (UD_Komi_Zyrian-IKDP/-Lattice 8,465 tokens, UD_Komi_Permyak-UH 898) and the Zyrian text of vidzanin (810,149 tokens: Permyak
 *   endings there at most 0.12%, «-ӧт»; Zyrian endings in the Permyak literature at most 0.04%), and
 * - stays under 0.06% of tokens in every other Cyrillic corpus: Erzya, Moksha, Russian, Udmurt, Hill and Meadow Mari, Mansi
 *   and Nenets.
 * The Permyak endings were checked again on the Permyak literature (langs/perm/permic/literature, 96 files, 3.9 million tokens,
 * split by file into a training and a test half): «-ісь» 1.14/1.35% of tokens (train/test), «-ӧт» 0.96/0.89, «-ісӧ» 0.91/0.82,
 * «-тӧн» 0.57/0.57, «-кӧт» 0.47/0.42; against Zyrian at most 0.04%. The Zyrian endings against that literature: «-сны» 0.014%,
 * «-кӧд» 0.043%, «-сӧс» 0.007%.
 * That last test removed endings that are common in Komi but shared: Zyrian «-ысь» and «-лы» (Udmurt), «-ыд» and «-ныд»,
 * Permyak «-ыт» (Meadow Mari 3pl: лийыт), «-ись» (Russian); and Zyrian «-ӧй» and «-ӧд» (also in the Permyak treebank).
 * Russian short adjectives end in «-сны» (согласны, интересны, весны) and «-ыслы» (смыслы, замыслы): 60,000 Russian UD sentences gave
 * 67 false Zyrian verdicts with the plain endings, so «-сны» needs the Komi «і/и» or «ӧ» before it and «-ыслы» no «м».
 * Share of tokens, Bible own/other and UD own/other: «-сны» 2.7/0 1.2/0, «-ъяс» 0.8/0 1.5/0, «-ыслы» 0.4/0 0.1/0;
 * «-ісь» 2.6/0 0.5/0, «-ісӧ» 1.5/0 0.9/0.01, «-ӧт» 1.3/0.01 1.1/0.05, «-кӧт» 0.9/0 0.6/0.01, «-слӧ» 0.7/0 0.2/0.
 */
export const KOMI_SUFFIX_RULES = [
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}[іи]сны$/i, label: 'V+Ind+Prt1+Pl3 -исны -існы' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}ӧсны$/i, label: 'V+Ind+Fut+Pl3 -ӧсны' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}[ъь]яс$/i, label: 'N+Der/Dimin+Pl+Nom -ъяс -ьяс' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}(?:(?<!м)ы|я)слы$/i, label: 'Dat+Px3/Pl3 -яслы -ыслы' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}нныд$/i, label: 'Px+PxPl2 -нныд' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}йӧс$/i, label: 'N+Pl+Acc -йӧс' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}сӧс$/i, label: 'N/A+Pl+Acc -сӧс' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}кӧд$/i, label: 'N+Sg/Pl+Com (+Px) -кӧд' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}ӧд(?:іс|ны)$/i, label: 'V+Prt1+Sg3, V+Inf/ConNeg+Pl3 -ӧдіс -ӧдны' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}янлы$/i, label: 'N+Pl+Dat -янлы' },
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}джык/i, label: 'A+Comp -джык (ыджыдджык; 0 in Udmurt, Mari, Erzya, Moksha, Russian, Permyak)' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}л?ісь$/i, label: 'Abl+Px -ісь -лісь' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}[лтіи]?[іи]сӧ$/i, label: 'V+Ind+Prt1+Pl3 -ісӧ -исӧ -лісӧ -тісӧ' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}(?:с?кӧт|ӧт)$/i, label: 'Com+Px, Prl -ӧт -кӧт -скӧт' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}ы?слӧ$/i, label: 'Dat+Px3 -слӧ -ыслӧ' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}тӧн$/i, label: 'N+Sg+Ins -тӧн' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}ӧтчис$/i, label: 'V+Ind+Prt1+Sg3 -ӧтчис' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}ӧт(?:ны|ӧ|іс)$/i, label: 'Com/Prl+Px forms -ӧтны -ӧтӧ -ӧтіс' }
];

/** 'kpv' or 'koi' when a Cyrillic word ends in a suffix of one Komi variety (KOMI_SUFFIX_RULES), else null. */
export function komiSuffixLanguage(word) {
  const w = (word || '').normalize('NFC');
  const hit = KOMI_SUFFIX_RULES.find(r => r.re.test(w));
  return hit ? hit.lang : null;
}

/**
 * Komi variety markers that only tell Zyrian from Permyak once the text is known to be Komi («і» or a Komi suffix): taken from the
 * Px2, adjective, Prl, ordinal, Ela, Comp and plural cells of lang-kpv and lang-koi nouns.lexc. Zyrian ends in «-д», Permyak in «-т»:
 * PxSg2 and adjective «-ыд / -ыт» (-яд / -ят after a vowel), Prl and ordinal «-ӧд / -ӧт» (PxSg2 never has -ӧд or -ӧт); Ela «-ысь / -ись»;
 * Comp «-джык / -жык»; plural Zyrian «-ъяс/-ьяс» (+ case), Permyak «-эз» with a doubled consonant. Share of tokens, Zyrian
 * (vidzanin list) / Permyak (literature): final «-ыд» 2.15/0.01, «-ыт» 0.01/1.13, «-ӧд» 0.92/0.13, «-ӧт» 0.12/0.92.
 * Not usable alone: «-ыд» and «-ыт» are also Udmurt and Meadow Mari endings, and Udmurt has «Иоаннэз» (doubled «нн» + «эз»).
 */
export const KOMI_VARIETY_MARKERS = [
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}ыд$/i, label: 'N+PxSg2, A -ыд (Zyrian -д)' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}ыт$/i, label: 'N+PxSg2, A -ыт (Permyak -т)' },
  // Prl and Ord, not PxSg2 (PxSg2 is only -ыд/-ыт, -яд/-ят): пельпомӧд / пельпонӧт, нёльӧд / нёльӧт
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}(?:ӧд|ід)$/i, label: 'Prl, Ord -ӧд (Zyrian -д)' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}(?:ӧт|іт)$/i, label: 'Prl, Ord -ӧт (Permyak -т)' },
  { lang: 'kpv', re: /(?!.*объяс)[\u0400-\u04FF]{2,}[ъь]яс/i, label: 'N+Pl -ъяс -ьяс, also before a case suffix (Zyrian)' },
  // lang-koi nouns.lexc: +Pl is «%>^1Cnsэз», the plural-initial consonant doubled before «эз» (lang-kpv: «%>ъяс»)
  { lang: 'koi', re: /[\u0400-\u04FF]+([бвгджзклмнпрстфхцчшщ])\1эз/i, label: 'N+Pl, consonant doubled before -эз (-ттэз, -ннэз ...)' },
  // Ela: Zyrian «-ысь» (Мӧскуысь), Permyak «-ись/-ісь» (Мӧскуись); Udmurt and Russian have both endings, hence gated
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}ысь$/i, label: 'Ela -ысь (Zyrian)' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}[иі]сь$/i, label: 'Ela -ись -ісь (Permyak)' },
  // Comp: Zyrian «-джык» (ыджыдджык), Permyak «-жык» (ыджытжык); «-джык» also contains «жык», so Permyak excludes a preceding д
  { lang: 'kpv', re: /[\u0400-\u04FF]{2,}джык/i, label: 'A+Comp -джык (Zyrian)' },
  { lang: 'koi', re: /[\u0400-\u04FF]{2,}(?<!д)жык/i, label: 'A+Comp -жык (Permyak)' }
];

/** 'kpv' or 'koi' by a variety marker (KOMI_VARIETY_MARKERS), else null; use only for text that is already Komi. */
export function komiVarietyMarker(word) {
  const w = (word || '').normalize('NFC');
  const hit = KOMI_VARIETY_MARKERS.find(r => r.re.test(w));
  return hit ? hit.lang : null;
}

/**
 * Cyrillic-script heuristics. Letters, checked against the Bible/UD corpora (korp_pabivus xml_mns, xml_mrj, xml_mhr,
 * xml_udm, xml_yrk, UD) and the Alphabet sections of GiellaLT lang-mns/-mrj/-mhr/-udm/-yrk:
 * - Mansi (mns): long vowels with a macron, precomposed «ӣ ӯ» or a vowel + U+0304 (о̄, а̄, ы̄); no other language here has them
 * - Udmurt (udm): «ӥ ӟ ӝ ӵ»
 * - Hill Mari (mrj): «ӹ»; Meadow Mari (mhr): «ҥ» (U+04A5; both alphabets have it, only mrj has «ӹ»). Both have «ӱ ӧ ӓ»:
 *   «ӱ» alone is Meadow Mari unless the default is mrj. «ӈ» is never Mari: they write «ҥ». Meadow Mari has labial harmony,
 *   Hill Mari does not: a word with «ӱ» and «а» or «ы», or two of «ӱ ӧ», is Meadow Mari (corpora: 86% of mhr ӱ/ӧ word types
 *   have а/ы/о/у and 13% two rounded vowels; mrj 6% and 2%, where 88% have «ӹ ӓ» instead).
 * - Kildin Sámi (sjd): «ҋ ҍ ӆ ӎ ҏ»; «ӓ» alone is Hill Mari unless the default is sjd
 * - «ӧ» alone is shared by Komi, Udmurt and both Maris: a default among them is kept, else Komi (kpv; koi with a koi
 *   default); «і» is Komi (Ukrainian and Belarusian have it too)
 * - Tundra Nenets (yrk): the letter for ŋ, written «ӈ» (UD_Nenets-Tundra, Mansi has it too) or «ӊ» / «ң» (the Nenets Bible), or the modifier letters «ʼ» (U+02BC) and «ˮ» (U+02EE) that its orthography
 *   writes after a letter (glottal stop/palatalization). Neither Erzya, Moksha, Komi nor Udmurt uses them.
 *   Kildin Sámi and Mansi share «ӈ» (Kildin «ӊ» too, and «ʼ»), which is why their own letters are tested first; a word
 *   with only «ӈ» keeps an sjd or mns default and otherwise goes to Nenets, and cannot be told apart by characters alone.
 *   Mansi marks long vowels with a macron from the 2000 orthography on, but not every word consistently, so older or
 *   unmarked Mansi text with «ӈ» looks like Nenets.
 * - Keyboards often give «’» (U+2019) and «”» (U+201D) instead of «ʼ» and «ˮ»: after a Cyrillic letter they count
 *   as Nenets too, unless they close a quotation opened earlier in the text (see stripQuotePairs). An ASCII «'» never counts.
 *   Ukrainian and Belarusian also write an apostrophe after a letter (п’ять, об’єкт). In the Nenets corpora «ʼ» is
 *   word-final (Bible, 3386 of 3386) or before a consonant (UD), never before a vowel, so «ʼ» and «’» before a vowel
 *   do not count; «ˮ» does occur before vowels (Bible 178, UD 26) and counts anywhere. The letters «ї є ґ ў» also
 *   keep a word from counting as Nenets by an apostrophe alone.
 * - Tundra Nenets paradigm suffixes (YRK_SUFFIX_RULES) on a word with no marker letter
 * - otherwise the default language if it is a Cyrillic-script one, else Erzya
 */
export function detectCyrillicLanguage(word, defaultLang = null) {
  word = stripQuotePairs(word);
  if (/[\u0304\u0305]/.test(word.normalize('NFD'))) return 'mns'; // also the precomposed «ӣ ӯ»
  if (/[ӟӝӥӵ]/i.test(word)) return 'udm';
  if (/ӹ/i.test(word)) return 'mrj';
  if (/ҥ/i.test(word)) return defaultLang === 'mrj' ? 'mrj' : 'mhr';
  if (/[ҋҍӆӎҏ]/i.test(word)) return 'sjd';
  if (/ӓ/i.test(word)) return defaultLang === 'sjd' ? 'sjd' : 'mrj';
  if (/ӱ/i.test(word)) {
    // Meadow Mari has labial harmony: ӱ/ӧ with а/ы, or a second rounded ӱ/ӧ, in one word (тӱҥалыныт, ӱдырамаш, тӱня);
    // Hill Mari does not (ӱ/ӧ words take ӹ ӓ: шӱлӹш, мӱлӓндӹ)
    if (/[аы]/i.test(word) || (word.match(/[ӱӧ]/gi) || []).length > 1) return 'mhr';
    return defaultLang === 'mrj' ? 'mrj' : 'mhr';
  }
  // a Komi suffix that only one variety has (KOMI_SUFFIX_RULES), with or without «ӧ і»
  const komiSuffix = komiSuffixLanguage(word);
  if (komiSuffix) return komiSuffix;
  // with a Komi default the variety markers count without «ӧ і» too (кывыд, кывыт)
  if (/^(kpv|koi)$/.test(defaultLang || '')) { const v = komiVarietyMarker(word); if (v) return v; }
  if (/[ӧі]/i.test(word)) {
    if (/ӧ/i.test(word) && !/і/i.test(word) && /^(udm|mhr|mrj)$/.test(defaultLang || '')) return defaultLang;
    // only with «і» (or a kpv/koi default): «ӧ» alone with «-ыт/-ыд» is Udmurt or Mari as well (ӧрыныт, уйвӧт)
    const variety = /і/i.test(word) || /^(kpv|koi)$/.test(defaultLang || '') ? komiVarietyMarker(word) : null;
    if (variety) return variety;
    return defaultLang === 'koi' ? 'koi' : 'kpv';
  }
  if (/[ӈңӊ]/i.test(word)) return defaultLang === 'sjd' || defaultLang === 'mns' ? defaultLang : 'yrk';
  // «ʼ» / «’» never stand before a vowel in Nenets (word-final in the Bible, before a consonant twice in UD), unlike
  // the Ukrainian/Belarusian apostrophe (п’ять, пʼять, сім’я); «ˮ» / «”» do occur before vowels (нюртеˮэʼ)
  const NENETS_APOSTROPHE = /ʼ(?![аеёиіїоуыэєюяӧӓӥ])|[\u0400-\u04FF]’(?![аеёиіїоуыэєюяӧӓӥ])/i;
  if ((NENETS_APOSTROPHE.test(word) || /ˮ|[\u0400-\u04FF]”/.test(word)) && !/[їєґў]/i.test(word)) {
    return defaultLang === 'sjd' ? 'sjd' : 'yrk';
  }
  // Weak evidence, for words with no marker letter: «э» after a non-dental consonant, and the paradigm suffixes
  if (YRK_NON_DENTAL_E.test(word) || YRK_SUFFIX_RULES.some(r => r.re.test(word))) return defaultLang === 'sjd' ? 'sjd' : 'yrk';
  if (defaultLang === 'und') return 'und'; // detectLanguageForText: no marker, no vote
  return defaultLang && /^(myv|mdf|kpv|koi|udm|sjd|yrk|mhr|mrj|mns)$/.test(defaultLang) ? defaultLang : 'myv';
}

/**
 * Language of a selected phrase from the characteristic letters of its words: the language most of the words
 * with such letters point to. Returns null when no word carries one (the default language then stays).
 * Weak Nenets evidence («э» after a non-dental, paradigm suffixes) counts a third of a vote, and Nenets needs one whole vote (three weak words).
 */
export function detectLanguageForText(text) {
  if (!text || typeof text !== 'string') return null;
  const UND = 'und';
  const votes = new Map();
  const strongVotes = new Map();
  const add = (l, n, strong = true) => {
    votes.set(l, (votes.get(l) || 0) + n);
    if (strong) strongVotes.set(l, (strongVotes.get(l) || 0) + n);
  };
  const plain = stripQuotePairs(text);
  for (const tok of plain.match(/[\p{L}\p{M}][\p{L}\p{M}'’”ʼˮ\-]*/gu) || []) {
    // a Cyrillic word with no marker comes back as the default; 'und' keeps it from voting
    const lang = isMostlyCyrillic(tok) ? detectCyrillicLanguage(tok, UND) : detectLanguageForWord(tok, UND);
    // a short «ä ö ü» after the first syllable is Võro harmony, Finnish alike: a weak vote for each
    if (!isMostlyCyrillic(tok) && !/[čđŋâåǩǧǥǯʒʹˈẹ]/.test(tok) && hasFrontHarmonyVowel(tok)) {
      if (lang !== 'fin') add('fin', 1 / 3, false);
      if (lang !== 'vro') add('vro', 1 / 3, false);
    }
    // a Võro paradigm suffix (VRO_SUFFIX_RULES): a weak vote for Võro; Estonian shares some, so no vote for it either way
    if (!isMostlyCyrillic(tok) && !/[čđŋâåǩǧǥǯʒʹˈẹ]/.test(tok) && lang !== 'vro' && hasVroSuffix(tok)) add('vro', 1 / 3, false);
    if (!lang || lang === UND) continue;
    // «ӧ» alone is shared by Komi, Udmurt and both Maris: no vote for Komi from it
    if (lang === 'kpv' && /ӧ/i.test(tok) && !/і/i.test(tok)) continue;
    // «і» with no suffix is Komi, Zyrian and Permyak alike: a vote for each, a tie going to Zyrian
    if (lang === 'kpv' && isMostlyCyrillic(tok) && !komiSuffixLanguage(tok)) { add('kpv', 1); add('koi', 1); continue; }
    // weak evidence counts a third of a vote: for Nenets «э» after a non-dental, paradigm suffixes (Russian loans have
    // those too) and «’» «”» for «ʼ» «ˮ» (a closing quotation mark whose opener is in an earlier sentence looks the same);
    // for Apurinã «ts» alone (Võro, Estonian and Finnish have it: latsi, otsa); for Finnish «ä…ä» alone (Võro has it:
    // nälän, päävä). A language held only by weak votes needs one whole vote, so three such words.
    const weak =
      (lang === 'yrk' && isMostlyCyrillic(tok) && !/[ӈңӊʼˮ]/.test(tok)) ||
      (lang === 'apu' && !/[ãẽĩỹ]|tx|awapu/i.test(tok)) ||
      lang === 'fin';
    // «ӈ» with no «ʼ ˮ» is Mansi as much as Nenets (Mansi also has «ӈ»): a vote for each; a tie goes to Nenets
    if (lang === 'yrk' && /ӈ/i.test(tok) && !/[ʼˮ]/.test(tok) && !/[ӊң]/i.test(tok)) { add('yrk', 1); add('mns', 1); continue; }
    // «ӱ» with no labial harmony and no «ҥ» fits Hill Mari as well as Meadow Mari: a vote for each
    if (lang === 'mhr' && /ӱ/i.test(tok) && !/ҥ/i.test(tok) && !/[аы]/i.test(tok) && (tok.match(/[ӱӧ]/gi) || []).length === 1) { add('mhr', 1); add('mrj', 1); continue; }
    add(lang, weak ? 1 / 3 : 1, !weak);
  }
  // Komi evidence («і», a Komi suffix): the variety markers (Zyrian «-д» / Permyak «-т» Px2, plurals) decide between kpv and koi
  if (votes.has('kpv') || votes.has('koi')) {
    for (const tok of plain.match(/[\p{L}\p{M}]+/gu) || []) {
      const v = isMostlyCyrillic(tok) ? komiVarietyMarker(tok) : null;
      if (v) add(v, 1);
    }
  }
  let best = null;
  for (const [lang, n] of votes) if (!best || n > best[1]) best = [lang, n];
  if (!best) return null;
  // two languages level with each other and neither with a strong vote (Võro or Finnish «ä» words): no verdict
  for (const [lang, n] of votes) {
    if (lang !== best[0] && n === best[1] && !strongVotes.get(lang) && !strongVotes.get(best[0])) return null;
  }
  // a language held only by weak votes needs one whole vote
  return strongVotes.get(best[0]) || best[1] >= 1 ? best[0] : null;
}

/**
 * Võro (vro) evidence, measured on Võro Wikipedia against UD Estonian, UD Skolt Sámi and UD Finnish:
 * - word-final «q» (latsiq), or «'»/«’» after a letter: palatalization after a consonant (pall'oq, oll'), the
 *   glottal stop for «q» after a vowel (latsi'); Skolt Sámi writes «ʹ» and «ʼ» instead, never «'» or «’»
 * - a Latin consonant with acute: «ś ń ŕ» or b́ d́ t́ ... typed with U+0301 on the vro keyboard
 * - a single «õ» after the first syllable (pallõ, suurõlõ); Skolt Sámi has «õõ, uõ, iõ» there, and in Estonian
 *   «õ» stays in the first syllable of each compound member (seetõttu), so the rule is off with an Estonian default
 * - «ü», which Estonian also has: with an Estonian default it stays Estonian
 * - with a vro or est default: a front-harmonic polysyllable ending in «-ä» (Finnish has these too), and any
 *   word spelled in the Võro alphabet keeps a vro default
 * Words with the general Sámi letters «č đ ŋ â» are left to the Sámi rules. Returns 'vro', 'est' or null.
 */
export function detectVoroWord(word, defaultLang = null) {
  if (!word || typeof word !== 'string' || /[Ѐ-ӿ]/.test(word)) return null;
  const nfc = word.normalize('NFC').toLowerCase();
  if (/[čđŋâ]/.test(nfc)) return null;
  // «nj» at the end or the start of a word is Skolt Sámi (njikkõnj, njikkõnja), not Võro; a compound might have it inside
  if (/nj$|^nj/.test(nfc)) return null;
  // a hyphenated clitic that starts with «õ»: Skolt Sámi -õs, -ǥõs, -tõt (lang-sms clitics.lexc: ton-õs), a compound like
  // koummlo-õhtt, and Võro -õi, -õs (olõ-õi, which keeps its own «õ»)
  // and the Skolt Sámi derivational suffix «-õs/-õš» after a consonant cluster (vuõssmõs, pirstõs, tiõttlõs, kõjldõs): no
  // Skolt Sámi word ends in «-õ», nor has «õ» before a final «l n m r d t»; Võro «suurõs» keeps its single consonant
  const stem = nfc.replace(/-õ\p{L}*$/u, '').replace(/(?<=[^aeiouõäöüy'’ʹʼ-]{2})õ[sšzž]{1,2}$/u, '');

  if (/q$/.test(nfc)) return 'vro';
  // the apostrophe stands at the end or before a vowel (pall'oq, oll'); Skolt Sámi writes «ʼ ’» before a consonant, mostly
  // «j»: Jeänn’jam, koll’je (a word like that is not Võro, though a compound might be)
  if (/[\p{L}\p{M}]['’](?![bcdfghjklmnpqrstvwxzčšžđŋ])/u.test(nfc) && !/['’](s|t|d|ll|re|ve|m)$/.test(nfc)) return 'vro';
  if (/[bcdfghklmnprstvz]́/.test(nfc.normalize('NFD'))) return 'vro';
  // single «õ» after the first syllable; Skolt Sámi has «õõ» (jällmõõžž) and «uõ, iõ» there, Estonian compounds «õ»
  if (defaultLang !== 'est' && /^[^aeiouõäöüy]*[aeiouõäöüy]+[^aeiouõäöüy]+.*(?<![uiõ])õ(?!õ)/.test(stem)) return 'vro';
  if (/ü/.test(nfc)) return defaultLang === 'est' ? 'est' : 'vro';

  // front-vowel harmony: a short «ä ö ü» after the first syllable (jättäq, jürämäldäq, edimädse, midä). Estonian has only
  // the long «ää öö üü» there (and in compounds), Skolt and North Sámi have no vowel harmony. Finnish has it too
  // (isä, tämä), so the rule applies only where the work is in Võro or Sámi: with those defaults, never an est default.
  if (/^(vro|sms|smn|sme|sma)$/.test(defaultLang || '') && hasFrontHarmonyVowel(nfc)) return 'vro';
  // paradigm suffixes of lang-vro that Skolt, Inari and North Sámi do not have (VRO_SUFFIX_RULES), same condition
  if (/^(vro|sms|smn|sme|sma)$/.test(defaultLang || '') && hasVroSuffix(nfc)) return 'vro';
  if (defaultLang === 'vro' || defaultLang === 'est') {
    if (/^[^aeiouõäöüy]*[aeiouõäöüy]+[^aeiouõäöüy]+.*ä$/.test(nfc) && !/[aouõ]/.test(nfc)) return 'vro';
  }
  // Võro alphabet in NFD: Latin letters with acute, tilde (õ), diaeresis (ä ö ü) or caron (š ž)
  if (defaultLang === 'vro' && /^[a-z'’́̃̈̌-]+$/.test(nfc.normalize('NFD'))) {
    return 'vro';
  }
  return null;
}

/**
 * Võro (vro) suffixes that mark a word spelled with none of the Võro letters (q, ü, õ, acute, harmony «ä ö ü»). Taken from the
 * paradigms of lang-vro (src/fst/morphology/affixes: nouns.lexc, verbs.lexc), generated with its generator for the 150 most
 * frequent noun, 150 verb, 40 adjective, pronoun and numeral lemmas of Väiku printś × every case/person cell, labels from
 * the generator's tags. Kept only when the ending is absent from UD Skolt Sámi and UD North Sámi text and from the Skolt,
 * Inari and North Sámi forms generated from lang-sms/-smn/-sme (so the ending separates Võro from them), and frequent in
 * Võro. Endings that occur in Skolt, Inari or North Sámi paradigms are left out: «-ist» (smn 1.8% of forms), «-st», «-l»,
 * «-s», «-ma», «-le».
 * Estonian and Finnish share some of them («-lt» Estonian 2.1% of tokens, «-ile», «-isi» Finnish 0.8%), which is why
 * the rules apply only where the work is in Võro or Sámi, and in a phrase count a third of a vote.
 * The word-final «-q» (any Võro plural, finite or abessive form) and «õ» in a non-first syllable need no table:
 * they are rules of detectVoroWord.
 */
export const VRO_SUFFIX_RULES = [
  { re: /[aeiouõäöüy]mb$/, label: 'A+Comp+Sg+Nom -mb (inämb, parõmb)' },
  { re: /[\p{L}]{2,}lt$/u, label: 'N/A+Sg/Pl+Abl -lt' },
  { re: /[\p{L}]{2,}ile$/u, label: 'N/A+Pl+All, Sg+All -ile' },
  { re: /[\p{L}]{2,}isi$/u, label: 'N+Pl+Par/Gen -isi' },
  { re: /[\p{L}]{2,}[aei]he$/u, label: 'N/A+Sg/Pl+Ill -ahe -ihe -ehe' }
];

/** True when a Latin-script word ends in one of the Võro paradigm suffixes (VRO_SUFFIX_RULES). */
export function hasVroSuffix(word) {
  const w = (word || '').normalize('NFC').toLowerCase();
  return VRO_SUFFIX_RULES.some(r => r.re.test(w));
}

/**
 * A short «ä», «ö» or «ü» after the first syllable: Võro front-vowel harmony (jättäq, jürämäldäq, edimädse, midä, timä).
 * Measured on tokens: Võro (Väiku printś) 11.0%, Skolt Sámi UD 0.4% (compounds and «uä, eä» diphthongs), North Sámi 0%,
 * Estonian EDT 1.5% (compounds: seejärel, eesmärk), Finnish TDT 16.6% (että, tämä): Finnish cannot be told apart.
 */
export function hasFrontHarmonyVowel(word) {
  const w = (word || '').normalize('NFC').toLowerCase();
  const first = w.match(/^[^aeiouõäöüy]*[aeiouõäöüy]+/);
  if (!first) return false;
  return /(?<!ä)ä(?!ä)|(?<!ö)ö(?!ö)|(?<!ü)ü(?!ü)/.test(w.slice(first[0].length));
}

/**
 * Lushootseed letters not used by the other supported languages. lut and slh share one alphabet
 * (Alphabet section of phonology.twolc in lang-lut and lang-slh, also keyboard-lut): ə ʷ ʔ ƛ ɬ ᶻ,
 * x̌ (x + U+030C caron) and glottalization written with U+0313 COMBINING COMMA ABOVE or
 * U+0315 COMBINING COMMA ABOVE RIGHT (c̓ k̓ q̓ ƛ̕ l̕ t̕ w̓ y̓ ...). Community variants are accepted too:
 * «ǝ» for «ə», and «ɫ» (spellrelax) or «ƚ» (used in slh communities) for «ɬ».
 * «q, č, š, ǰ» are Lushootseed too but also occur in Sámi and Finnish loanwords, so they do not count alone.
 */
export function isLushootseedWord(word) {
  if (!word || typeof word !== 'string') return false;
  return /[əǝʷʔƛɬɫƚᶻ̓̕]|x̌/i.test(word.normalize('NFD'));
}

/**
 * Separates Lushootseed (lut) from Southern Lushootseed (slh). Both share one alphabet, so letters
 * never decide between them; only dialect word-forms in the lexicons do:
 * - lut: applicative «-yid» (kʷədyid, lək̓ʷyid)
 * - slh: «-šid» after a non-l (kʷədšid, lək̓ʷšid); reflexive «-tsut» (huyutsut)
 * - weak cue, only when no lut/slh default is set: lut inchoative «-il» (cəlacil) vs slh «-i» (cəlaci)
 */
export function detectLushootseedVariety(word, defaultLang = 'lut') {
  const w = word.normalize('NFD').toLowerCase();

  if (/yid/.test(w)) return 'lut';
  if (/[^l\s]šid|tsut/.test(w)) return 'slh';

  if (defaultLang === 'lut' || defaultLang === 'slh') return defaultLang;

  if (/il$/.test(w)) return 'lut';
  if (w.length >= 5 && /[^aiuəʔ]i$/.test(w) && !/ali$/.test(w)) return 'slh'; // -ali (locative) is shared
  return 'lut';
}

/**
 * A non-guessed reading that is only an accident of the lexicon: an abbreviation whose lemma is not the word itself.
 * The smn analyser reads Võro «Tõtõstõsündünüq» as the abbreviation «t+N+ABBR», so a preferred or candidate analyser
 * "recognized" a word of another language. Readings of the word as itself («t.», «Mi» for MI) stay plausible.
 */
export function isPlausibleReading(form, reading) {
  if (!reading || !reading.lemma) return false;
  const tags = reading.tags || [];
  if (tags.includes('ABBR')) {
    const norm = x => (x || '').toLowerCase().replace(/[.\s]+$/g, '');
    return norm(reading.lemma) === norm(form);
  }
  return true;
}

/** Languages whose letters, spelled out in detectLanguageForWord, are strong evidence even where LangJack has no analysis. */
const STRONG_EVIDENCE_LANGS = new Set(['vro', 'yrk', 'sjd', 'mns', 'mhr', 'mrj', 'udm', 'lut', 'slh']);

/**
 * Ensures the appropriate language analyzer model is loaded and analyzes the word.
 * Priority #1: Immediately checks the manually set / preferred language first for maximum speed.
 * Priority #2: Only if preferred language yields 0 valid readings does language recognition
 *              and candidate language fallback execute.
 */
export async function analyzeWordWithLanguageAssurance(word, preferredLang = 'myv') {
  const cleanWord = (word || '').trim();
  const primaryLang = normalizeLangCode(preferredLang || 'myv');
  if (!cleanWord) return { lang: primaryLang, readings: [] };

  // 1. Priority #1 (Fastest): Test the user's manual/preferred language directly first
  await analyzerService.ensureModelForLanguage(primaryLang);
  await dictionaryService.init();

  let readings = analyzerService.analyze_word(cleanWord, primaryLang);

  // If primaryLang produced valid readings with lemma, return immediately (instant 0ms path)
  if (readings.length > 0 && readings[0].lemma && !readings[0].isGuessed && isPlausibleReading(cleanWord, readings[0])) {
    return { lang: primaryLang, readings };
  }

  // If primaryLang has dictionary entries (in FST dictionary or custom TSV dictionary), retain primaryLang
  const directGlosses = dictionaryService.lookupGlosses(cleanWord, primaryLang, 'all');
  if (directGlosses && directGlosses.length > 0) {
    return { lang: primaryLang, readings };
  }

  // 2. Priority #2 (Fallback Recognition): Try language recognition heuristic if different from primaryLang
  const detectedLang = normalizeLangCode(detectLanguageForWord(cleanWord, primaryLang));
  let detectedReadings = [];
  if (detectedLang !== primaryLang) {
    try {
      await analyzerService.ensureModelForLanguage(detectedLang);
      detectedReadings = analyzerService.analyze_word(cleanWord, detectedLang);
      if (detectedReadings.length > 0 && detectedReadings[0].lemma && !detectedReadings[0].isGuessed && isPlausibleReading(cleanWord, detectedReadings[0])) {
        return { lang: detectedLang, readings: detectedReadings };
      }
    } catch (_) {}
  }

  // 3. Priority #3 (Fallback Candidate Search): Test other supported languages
  // Lushootseed models are only tried for words carrying Lushootseed letters
  const candidateLangs = (isLushootseedWord(cleanWord) ? ['lut', 'slh'] : ['sms', 'vro', 'myv', 'fin', 'kpv', 'koi', 'apu', 'sme', 'smn', 'mdf', 'udm', 'olo'])
    .filter(l => l !== primaryLang && l !== detectedLang);

  const isCyr = /[\u0400-\u04FF]/.test(cleanWord);

  for (const cand of candidateLangs) {
    const candIsCyr = ['myv', 'mdf', 'kpv', 'koi', 'udm', 'sjd'].includes(cand);
    if (isCyr !== candIsCyr && !['sms', 'vro', 'sme', 'smn', 'fin', 'apu', 'olo'].includes(cand)) {
      continue;
    }

    try {
      await analyzerService.ensureModelForLanguage(cand);
      const candReadings = analyzerService.analyze_word(cleanWord, cand);
      if (candReadings.length > 0 && candReadings[0].lemma && !candReadings[0].isGuessed && isPlausibleReading(cleanWord, candReadings[0])) {
        return { lang: cand, readings: candReadings };
      }
    } catch (_) {}
  }

  // Nothing recognized the word. When its letters point to a language with strong orthographic evidence (Võro «q ü ś»,
  // Nenets «ʼ ˮ», Udmurt «ӥ», ...), report that one: with its guessed readings if its analyzer gave any, none for Tundra
  // Nenets and Kildin Sámi, which have no analyzer in LangJack. Võro «Tõtõstõsündünüq» is vro, not the preferred sms/smn.
  if (detectedLang !== primaryLang && STRONG_EVIDENCE_LANGS.has(detectedLang)) {
    return { lang: detectedLang, readings: detectedReadings };
  }

  // If no language found valid morphological readings, return primaryLang with original readings
  return { lang: primaryLang, readings };
}

// 1. Context Menus Registration
let lastSelectedText = '';
let isSettingUpMenus = false;
let pendingMenuSetup = false;

export async function setupContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;

  if (isSettingUpMenus) {
    pendingMenuSetup = true;
    return;
  }

  isSettingUpMenus = true;
  try {
    const mode = await storageService.getSetting('ui_context_menu_mode', 'dict');
    const allContexts = ['selection', 'page', 'frame', 'link', 'editable'];

    await new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime?.lastError) {
          const _ = chrome.runtime.lastError;
        }

        const itemsToCreate = [];
        if (mode === 'dict' || mode === 'both') {
          // Direct button: «Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]»
          // Opens in-page floating Dictionary UI with single-token lemma viewing,
          // candidate lemma switching, UralicNLP morphology toggle, and translation language picker.
          itemsToCreate.push({
            id: 'hfst_dict_lookup',
            title: '📖 Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]',
            contexts: allContexts
          });
        }

        if (mode === 'annotator' || mode === 'both') {
          // Direct button: «Analyze Gloss with HFST»
          // Moves selection to the full HFST Workbench / Annotator UI.
          itemsToCreate.push({
            id: 'hfst_move_to_annotator',
            title: '📝 Analyze Gloss with HFST',
            contexts: allContexts
          });
        }

        itemsToCreate.forEach(item => {
          chrome.contextMenus.create(item, () => {
            // ALWAYS check chrome.runtime.lastError to prevent "Unchecked runtime.lastError"
            if (chrome.runtime?.lastError) {
              const _ = chrome.runtime.lastError;
            }
          });
        });

        resolve();
      });
    });
  } catch (_) {
  } finally {
    isSettingUpMenus = false;
    if (pendingMenuSetup) {
      pendingMenuSetup = false;
      await setupContextMenus();
    }
  }
}

if (typeof chrome !== 'undefined') {
  // Execute immediately on script load so context menu buttons are ready on extension reload/startup
  setupContextMenus();
  ensureServices();

  chrome.runtime?.onInstalled?.addListener(() => {
    setupContextMenus();
    ensureServices();
  });

  chrome.runtime?.onStartup?.addListener(() => {
    setupContextMenus();
    ensureServices();
  });
}

// 2. Context Menu Click Handler
export async function handleContextMenuClick(info, tab) {
  let selection = (info.selectionText || '').trim();
  let tabRetainedLang = null;

  // If tab exists, query it for target word and any page-retained language
  if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'get_target_word' });
      if (resp?.text && !selection) {
        selection = resp.text.trim();
      }
      if (resp?.srcLang) {
        tabRetainedLang = resp.srcLang;
      }
    } catch (_) {}
  }

  // Also check in-memory tab language cache if content script response didn't specify
  if (!tabRetainedLang && tab?.id && tabLanguageCache.has(tab.id)) {
    tabRetainedLang = tabLanguageCache.get(tab.id);
  }

  if (!selection && lastSelectedText) {
    selection = lastSelectedText.trim();
  }

  if (!selection) {
    selection = 'piânnai';
  }

  await ensureServices();
  const storedLang = await storageService.getSetting('ui_src_lang', 'myv');
  const srcLang = normalizeLangCode(tabRetainedLang || storedLang);
  const currentTgt = await storageService.getSetting('ui_tgt_lang', 'all');

  // 1. Glosser item (Move selection to Annotator/Glosser Workbench)
  if (info.menuItemId === 'hfst_move_to_annotator') {
    const encodedText = encodeURIComponent(selection);
    const url = `index.html?text=${encodedText}&lang=${srcLang}&tgt=${currentTgt || 'all'}`;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    }
    return { action: 'glosser', url, text: selection, srcLang, tgtLang: currentTgt };
  }

  // 2. Morphology Toggle items from context menu
  if (info.menuItemId === 'hfst_dict_morph_with') {
    await storageService.setSetting('ui_show_morphology', true);
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang, { showMorphology: true });
    return { action: 'morphology_toggle', showMorphology: true, cardData };
  }

  if (info.menuItemId === 'hfst_dict_morph_without') {
    await storageService.setSetting('ui_show_morphology', false);
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang, { showMorphology: false });
    return { action: 'morphology_toggle', showMorphology: false, cardData };
  }

  // 3. Translation Language Picker items from context menu
  if (info.menuItemId && info.menuItemId.startsWith('hfst_tgt_')) {
    const pickedLang = info.menuItemId.replace('hfst_tgt_', '');
    await storageService.setSetting('ui_tgt_lang', pickedLang);
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang, { tgtLang: pickedLang });
    return { action: 'pick_translation_language', tgtLang: pickedLang, cardData };
  }

  // 4. Single-token Lemma Viewing / Dictionary default item
  if (info.menuItemId === 'hfst_dict_menu' || info.menuItemId === 'hfst_dict_view_lemma' || info.menuItemId === 'hfst_dict_lookup') {
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang);
    return { action: 'view_lemma_dictionary', cardData };
  }

  return null;
}

if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
}

/**
 * Prepares morphological analysis & dictionary glosses, then instructs
 * the tab content script to display the floating Dictionary UI card.
 */
export async function handleShowDictionaryCard(tab, text, srcLang = null, options = {}) {
  const cleanText = (text || '').trim();
  const isPhrase = /\s+/.test(cleanText);
  let cardData = null;

  const tabRetained = (tab?.id && tabLanguageCache.has(tab.id)) ? tabLanguageCache.get(tab.id) : null;
  const storedLang = await storageService.getSetting('ui_src_lang', 'myv');
  const preferredLang = normalizeLangCode(srcLang || tabRetained || storedLang);

  if (!isPhrase) {
    // Single Word: Detailed morphological parsing with automatic language assurance & candidate glosses
    const { lang: resolvedLang, readings } = await analyzeWordWithLanguageAssurance(cleanText, preferredLang);

    // Retain this language for this tab for subsequent lookups on this webpage
    if (tab?.id && resolvedLang) {
      tabLanguageCache.set(tab.id, resolvedLang);
    }

    // Filter out and prioritize non-guessed readings for dictionary lookup
    const nonGuessedReadings = readings.filter(r => !r.isGuessed);
    const candidateReadings = nonGuessedReadings.length > 0 ? nonGuessedReadings : readings;

    // Prefer exact lemma match (e.g. 'aiku' over derivational 'awa')
    const exactMatch = candidateReadings.find(r => r.lemma && r.lemma.toLowerCase() === cleanText.toLowerCase());
    const primaryReading = exactMatch || candidateReadings[0] || {};
    let primaryLemma = options.lemma || primaryReading.lemma || cleanText;
    primaryLemma = stripGuessTags(primaryLemma || '') || cleanText;
    const allLemmas = Array.from(new Set([
      primaryLemma,
      ...candidateReadings.map(r => stripGuessTags(r.lemma || '')).filter(Boolean),
      cleanText
    ])).filter(l => !/^(?:\+guess|«\+?guess»)$/i.test(l) && !(/^guess$/i.test(l) && resolvedLang !== 'eng'));

    await dictionaryService.init();
    let glosses = dictionaryService.lookupGlosses(primaryLemma, resolvedLang, 'all');
    if ((!glosses || glosses.length === 0) && cleanText.toLowerCase() !== primaryLemma.toLowerCase()) {
      const fallbackGlosses = dictionaryService.lookupGlosses(cleanText, resolvedLang, 'all');
      if (fallbackGlosses && fallbackGlosses.length > 0) {
        glosses = fallbackGlosses;
      }
    }

    const availableTgtLangs = Array.from(new Set(
      glosses.map(g => (g.lang || '').toLowerCase()).filter(Boolean)
    ));
    const tgtLang = options.tgtLang || (await storageService.getSetting('ui_tgt_lang', 'all'));
    const storedMorph = await storageService.getSetting('ui_show_morphology', true);
    const showMorphology = options.showMorphology !== undefined ? options.showMorphology : (storedMorph !== false);

    cardData = {
      isPhrase: false,
      text: cleanText,
      lemma: primaryLemma,
      allLemmas,
      readings,
      hasMorphology: readings.length > 0 && readings[0].lemma !== undefined && !readings[0].isGuessed,
      showMorphology: showMorphology !== false,
      glosses,
      availableTgtLangs,
      srcLang: resolvedLang,
      tgtLang: tgtLang || 'all',
      availableLangs: dictionaryService.getSourceLanguages()
    };
  } else {
    // Phrase / Sentence: Tokenize and analyze each word
    await analyzerService.ensureModelForLanguage(preferredLang);
    await dictionaryService.init();
    let phraseLang = preferredLang;
    let sentences = await analyzerService.analyzeText(cleanText, phraseLang);
    let tokens = sentences[0]?.tokens || [];

    // Same rule as for a single word: the preferred language stays unless it does not recognize the phrase and the
    // characteristic letters of the phrase point to another one (Cyrillic Nenets «пыдоʼ ... ханаˮ» → yrk, not sms).
    // «Recognizes» means at least half of the words have a plausible, non-guessed reading, or all of them if the phrase
    // has one or two: a few words of another language are read by chance (smn reads «mi», «t» ...), and one lucky word
    // must not keep a Võro sentence at sms or smn.
    const words = tokens.filter(t => !t.isPunct);
    const known = words.filter(t => t.selectedReading && !t.selectedReading.isGuessed && isPlausibleReading(t.form, t.selectedReading)).length;
    const recognizes = known > 0 && known >= Math.min(words.length, Math.ceil(words.length / 2));
    if (!recognizes) {
      const detected = normalizeLangCode(detectLanguageForText(cleanText) || phraseLang);
      if (detected !== phraseLang) {
        try {
          phraseLang = detected;
          await analyzerService.ensureModelForLanguage(phraseLang);
          sentences = await analyzerService.analyzeText(cleanText, phraseLang);
          tokens = sentences[0]?.tokens || [];
        } catch (_) {
          // keep the tokens of the preferred language; the card still reports the detected one
        }
      }
    }

    for (const tok of tokens) {
      if (!tok.isPunct) {
        const nonGuessed = (tok.readings || []).find(r => !r.isGuessed);
        const bestReading = nonGuessed || tok.selectedReading;
        let lem = tok.lemma || (bestReading ? bestReading.lemma : tok.form);
        lem = stripGuessTags(lem || '') || tok.form;
        tok.glosses = dictionaryService.lookupGlosses(lem, phraseLang, 'all');
      }
    }

    if (tab?.id && phraseLang) {
      tabLanguageCache.set(tab.id, phraseLang);
    }

    const tgtLang = options.tgtLang || (await storageService.getSetting('ui_tgt_lang', 'all'));
    cardData = {
      isPhrase: true,
      text: cleanText,
      tokens,
      srcLang: phraseLang,
      tgtLang: tgtLang || 'all',
      availableLangs: dictionaryService.getSourceLanguages()
    };
  }

  // Ensure content script is injected in target tab
  if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch (_) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['js/content/content.js']
        });
      } catch (injErr) {
        console.warn('Could not inject content script:', injErr);
      }
    }

    // Send payload to tab to display the card
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'show_dict_card',
        data: cardData
      });
    } catch (msgErr) {
      console.warn('Failed to send show_dict_card message:', msgErr);
    }
  }

  return cardData;
}

/**
 * Look up quick translation summary for context menu dynamic display.
 */
export async function getQuickTranslationSummary(word, srcLang = 'myv') {
  const cleanWord = (word || '').trim();
  if (!cleanWord) return null;

  const { lang: resolvedLang, readings } = await analyzeWordWithLanguageAssurance(cleanWord, srcLang);
  const nonGuessed = readings.filter(r => !r.isGuessed);
  const candidateReadings = nonGuessed.length > 0 ? nonGuessed : readings;
  const exactMatch = candidateReadings.find(r => r.lemma && r.lemma.toLowerCase() === cleanWord.toLowerCase());
  const primaryReading = exactMatch || candidateReadings[0] || {};
  let primaryLemma = primaryReading.lemma || cleanWord;
  primaryLemma = stripGuessTags(primaryLemma || '') || cleanWord;

  let glosses = dictionaryService.lookupGlosses(primaryLemma, resolvedLang, 'all');
  if ((!glosses || glosses.length === 0) && cleanWord.toLowerCase() !== primaryLemma.toLowerCase()) {
    const fallbackGlosses = dictionaryService.lookupGlosses(cleanWord, resolvedLang, 'all');
    if (fallbackGlosses && fallbackGlosses.length > 0) {
      glosses = fallbackGlosses;
    }
  }

  if (!glosses || glosses.length === 0) return null;

  // Pick top 2-3 glosses, prioritizing user target language setting or common lingua francas (eng, fin, rus, por)
  const prefTarget = (await storageService.getSetting('ui_tgt_lang', 'all') || 'all').toLowerCase();
  const langPriority = [prefTarget, 'eng', 'fin', 'por', 'rus', 'deu', 'swe', 'est'].filter(l => l && l !== 'all');

  const prioritized = [...glosses].sort((a, b) => {
    const aIdx = langPriority.indexOf((a.lang || '').toLowerCase());
    const bIdx = langPriority.indexOf((b.lang || '').toLowerCase());
    const aRank = aIdx === -1 ? 999 : aIdx;
    const bRank = bIdx === -1 ? 999 : bIdx;
    return aRank - bRank;
  });

  const seenLangs = new Set();
  const summaryParts = [];

  for (const g of prioritized) {
    if (!seenLangs.has(g.lang) && summaryParts.length < 3) {
      seenLangs.add(g.lang);
      summaryParts.push(`${g.gloss} (${g.lang})`);
    }
  }

  return summaryParts.length > 0 ? summaryParts.join(', ') : null;
}

/**
 * Dynamically updates dictionary context menu items when user selects text.
 */
export async function updateContextMenuForSelection(text, srcLang = 'myv') {
  if (typeof chrome === 'undefined' || !chrome.contextMenus?.update) return;

  const cleanText = (text || '').trim();
  const baseTitle = '📖 Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]';

  if (!cleanText || cleanText.length > 50) {
    chrome.contextMenus.update('hfst_dict_lookup', {
      title: baseTitle
    }, () => chrome.runtime?.lastError);
    chrome.contextMenus.update('hfst_dict_menu', {
      title: baseTitle
    }, () => chrome.runtime?.lastError);
    chrome.contextMenus.update('hfst_move_to_annotator', {
      title: '📝 Analyze Gloss with HFST'
    }, () => chrome.runtime?.lastError);
    return;
  }

  const snippet = cleanText.length > 25 ? cleanText.substring(0, 22) + '...' : cleanText;
  const updatedTitle = `📖 Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup] ("${snippet}")`;

  chrome.contextMenus.update('hfst_dict_lookup', {
    title: updatedTitle
  }, () => chrome.runtime?.lastError);
  chrome.contextMenus.update('hfst_dict_menu', {
    title: updatedTitle
  }, () => chrome.runtime?.lastError);
  chrome.contextMenus.update('hfst_dict_view_lemma', {
    title: updatedTitle
  }, () => chrome.runtime?.lastError);
  chrome.contextMenus.update('hfst_move_to_annotator', {
    title: '📝 Analyze Gloss with HFST'
  }, () => chrome.runtime?.lastError);
}

// 3. Runtime Message Listener
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'selection_changed') {
      if (sender?.tab?.id && message.srcLang) {
        tabLanguageCache.set(sender.tab.id, message.srcLang);
      }
      if (message.text) {
        lastSelectedText = (message.text || '').trim();
        try {
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ last_selected_text: lastSelectedText });
          }
        } catch (_) {}
      }
      (async () => {
        try {
          const tabLang = sender?.tab?.id ? tabLanguageCache.get(sender.tab.id) : null;
          const stored = await storageService.getSetting('ui_src_lang', 'myv');
          const srcLang = normalizeLangCode(message.srcLang || tabLang || stored);
          await updateContextMenuForSelection(message.text, srcLang);
        } catch (_) {
          // Ignore transient errors
        }
      })();
      return true;
    }

    if (message.action === 'get_last_selection') {
      sendResponse({
        text: lastSelectedText,
        srcLang: (sender?.tab?.id && tabLanguageCache.has(sender.tab.id)) ? tabLanguageCache.get(sender.tab.id) : null
      });
      return true;
    }

    if (message.action === 'request_dict_card') {
      (async () => {
        try {
          const text = (message.text || lastSelectedText || '').trim();
          const targetTab = sender?.tab;
          const tabLang = targetTab?.id ? tabLanguageCache.get(targetTab.id) : null;
          const stored = await storageService.getSetting('ui_src_lang', 'myv');
          const srcLang = normalizeLangCode(message.srcLang || tabLang || stored);
          const cardData = await handleShowDictionaryCard(targetTab, text, srcLang, message.options || {});
          sendResponse({ ok: true, data: cardData });
        } catch (err) {
          console.warn('request_dict_card failed:', err);
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    if (message.action === 'set_page_language') {
      if (sender?.tab?.id && message.lang) {
        tabLanguageCache.set(sender.tab.id, message.lang);
      }
      (async () => {
        try {
          if (message.lang) {
            await storageService.setSetting('ui_src_lang', message.lang);
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    if (message.action === 'set_context_menu_mode') {
      (async () => {
        try {
          await storageService.setSetting('ui_context_menu_mode', message.mode);
          await setupContextMenus();
          sendResponse({ ok: true, mode: message.mode });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    if (message.action === 'open_annotator') {
      const text = encodeURIComponent((message.text || '').trim());
      const lang = normalizeLangCode(message.lang || 'myv');
      chrome.tabs?.create?.({ url: `index.html?text=${text}&lang=${lang}` });
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'lookup_word') {
      // Used by language switcher and in-page lookup inside the floating Dictionary UI
      (async () => {
        try {
          const text = (message.text || '').trim();
          const srcLang = normalizeLangCode(message.srcLang || 'myv');
          if (sender?.tab?.id) {
            tabLanguageCache.set(sender.tab.id, srcLang);
          }
          await storageService.setSetting('ui_src_lang', srcLang);
          await analyzerService.ensureModelForLanguage(srcLang);
          await dictionaryService.init();

          const readings = analyzerService.analyze_word(text, srcLang);
          let activeLemma = (message.lemma || '').trim() || readings[0]?.lemma || text;
          activeLemma = stripGuessTags(activeLemma || '') || text;
          const allLemmas = Array.from(new Set([
            activeLemma,
            ...readings.map(r => stripGuessTags(r.lemma || '')).filter(Boolean),
            text
          ])).filter(l => !/^(?:\+guess|«\+?guess»)$/i.test(l) && !(/^guess$/i.test(l) && srcLang !== 'eng'));
          const glosses = dictionaryService.lookupGlosses(activeLemma, srcLang, 'all');
          const availableTgtLangs = Array.from(new Set(
            glosses.map(g => (g.lang || '').toLowerCase()).filter(Boolean)
          ));
          const tgtLang = message.tgtLang || (await storageService.getSetting('ui_tgt_lang', 'all'));
          const showMorphology = message.showMorphology !== undefined
            ? !!message.showMorphology
            : (await storageService.getSetting('ui_show_morphology', true)) !== false;

          sendResponse({
            data: {
              isPhrase: false,
              text,
              lemma: activeLemma,
              allLemmas,
              readings,
              hasMorphology: readings.length > 0 && readings[0].lemma !== undefined && !readings[0].isGuessed,
              showMorphology,
              glosses,
              availableTgtLangs,
              srcLang,
              tgtLang: tgtLang || 'all',
              availableLangs: dictionaryService.getSourceLanguages()
            }
          });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true; // Keep channel open for async response
    }

    if (message.action === 'get_source_languages') {
      (async () => {
        try {
          await dictionaryService.init();
          sendResponse({ langs: dictionaryService.getSourceLanguages() });
        } catch (err) {
          sendResponse({ langs: KNOWN_LANGUAGES });
        }
      })();
      return true;
    }

    if (message.action === 'save_setting') {
      (async () => {
        try {
          if (message.key) {
            await storageService.setSetting(message.key, message.value);
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }
  });
}
