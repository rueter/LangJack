/**
 * ParadigmService: Two-Level Morphology Paradigm Discoverer (Koskenniemi twol)
 * 
 * Provides:
 * 1. Paradigm alignment and zero-filling (twol-words2zerofilled)
 * 2. Morphophoneme derivation and formula extraction (twol-zerofilled2raw / twol-raw2named)
 * 3. Human-in-the-loop interactive adjustment of morph boundaries and morphophoneme naming
 * 4. Two-Level Rule (TWOL) generation with positive/negative context analysis
 * 5. LexC and LexD grammar coordination
 * 6. Regular expression derivation for stem type identification
 * 7. Paradigm classification & prediction for new words (with or without tags)
 */

import { POS_TO_UPOS, stripGuessTags } from './tag-mapper.js';

export class ParadigmService {
  constructor() {
    this.savedParadigms = [];
    this.defaultPresets = this.initDefaultPresets();
  }

  /**
   * Initializes built-in paradigm presets (e.g. Võro Type 41 kand, Võro Type 36 silm, Finnish käsi, mäki)
   */
  initDefaultPresets() {
    return [
      {
        id: 'vro_type_1_kala',
        name: 'Võro Noun: kala (fish) [Type 1 / VES 1]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 1,
        uralicNlpModelLemmas: ['kala'],
        uralicNlpGuesserTags: ['+N_1_kala', 'N_1_kala'],
        paradigmType: '+N_1_kala',
        continuationLexicon: 'N_1KALA',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü]+ [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] "+N":0 "+Guess":0 "+N_1_kala":0 > N_1KALA ;',
        text: `kala+N+Sg+Nom: kala\nkala+N+Sg+Gen: kala\nkala+N+Sg+Par: kalla\nkala+N+Sg+Ill: kalalõ\nkala+N+Pl+Gen: kallõ\nkala+N+Pl+Ine: kalon`,
        description: 'Võro ungradated vowel stem Type 1 (VES 1): invariant stem consonant (no gradation in Genitive), singular stem vowel a. Corresponds to UralicNLP guesser tag +N_1_kala.'
      },
      {
        id: 'vro_type_39_vido',
        name: 'Võro Noun: vido (twilight) [Type 39 / +N_39_vido]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 39,
        uralicNlpModelLemmas: ['vido'],
        uralicNlpGuesserTags: ['+N_39_vido', 'N_39_vido'],
        paradigmType: '+N_39_vido',
        continuationLexicon: 'N_39VIDO',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "o":0 "+N":0 "+Guess":0 "+N_39_vido":0 > N_39VIDO ;',
        text: `vido+N+Sg+Nom: vido\nvido+N+Sg+Gen: vio\nvido+N+Sg+Par: vito\nvido+N+Sg+Ill: vitto`,
        description: 'Võro gradation Type 39 (+N_39_vido): stop alternation d ~ 0 ~ t ~ tt (with g ~ 0 ~ k ~ kk and b ~ 0 ~ p ~ pp), stem vowel o. Corresponds to UralicNLP guesser tag +N_39_vido.'
      },
      {
        id: 'vro_type_39_luba',
        name: 'Võro Noun: luba (permission) [Type 39 / +N_39_luba]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 39,
        uralicNlpModelLemmas: ['luba'],
        uralicNlpGuesserTags: ['+N_39_luba', 'N_39_luba'],
        paradigmType: '+N_39_luba',
        continuationLexicon: 'N_39LUBA',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "a":0 "+N":0 "+Guess":0 "+N_39_luba":0 > N_39LUBA ;',
        text: `luba+N+Sg+Nom: luba\nluba+N+Sg+Gen: lua\nluba+N+Sg+Par: lupa\nluba+N+Sg+Ill: luppa\nluba+N+Pl+Gen: lupõ\nluba+N+Pl+Ill: luppõhe`,
        description: 'Võro gradation Type 39 (+N_39_luba): stop alternation b ~ 0 ~ p ~ pp (d ~ 0 ~ t ~ tt, g ~ 0 ~ k ~ kk), singular stem vowel a, plural stem vowel õ. Corresponds to UralicNLP guesser tag +N_39_luba.'
      },
      {
        id: 'vro_type_39_lugu',
        name: 'Võro Noun: lugu (story) [Type 39 / +N_39_lugu]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 39,
        uralicNlpModelLemmas: ['lugu'],
        uralicNlpGuesserTags: ['+N_39_lugu', 'N_39_lugu'],
        paradigmType: '+N_39_lugu',
        continuationLexicon: 'N_39LUGU',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "u":0 "+N":0 "+Guess":0 "+N_39_lugu":0 > N_39LUGU ;',
        text: `lugu+N+Sg+Nom: lugu\nlugu+N+Sg+Gen: luu\nlugu+N+Sg+Par: luku\nlugu+N+Sg+Ill: lukku\nlugu+N+Pl+Gen: lukõ\nlugu+N+Pl+Ill: lukkõhe`,
        description: 'Võro gradation Type 39 (+N_39_lugu): stop alternation g ~ 0 ~ k ~ kk (d ~ 0 ~ t ~ tt, b ~ 0 ~ p ~ pp), singular stem vowel u, plural stem vowel õ. Corresponds to UralicNLP guesser tag +N_39_lugu.'
      },
      {
        id: 'vro_type_40_talo',
        name: 'Võro Noun: talo (farm) [Type 40 / +N_40_talo]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 40,
        uralicNlpModelLemmas: ['talo'],
        uralicNlpGuesserTags: ['+N_40_talo', 'N_40_talo'],
        paradigmType: '+N_40_talo',
        continuationLexicon: 'N_40TALO',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] [0:"{0:0, 0:l}" l:l|0:"{0:0, 0:m}" m:m|0:"{0:0, 0:n}" n:n|0:"{0:0, 0:r}" r:r|0:"{0:0, 0:s}" s:s] "o":0 "+N":0 "+Guess":0 "+N_40_talo":0 > N_40TALO ;',
        text: `talo+N+Sg+Nom: talo\ntalo+N+Sg+Gen: talo\ntalo+N+Sg+Par: tallo\ntalo+N+Pl+Gen: tallõ\ntalo+N+Pl+Ill: tallõhe\ntalo+N+Pl+Ine: talõn`,
        description: 'Võro gradation Type 40 (+N_40_talo): consonant lengthening l ~ ll (single consonant in Nom/Gen, geminate in Par/Pl), singular stem vowel o, plural stem vowel õ. Corresponds to UralicNLP guesser tag +N_40_talo.'
      },
      {
        id: 'vro_type_41_kand',
        name: 'Võro Noun: kand (heel) [Type 41 / VES 36]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 41,
        uralicNlpModelLemmas: ['haik', 'ask'],
        uralicNlpGuesserTags: ['+N_41_haik', '+N_41_ask', 'N_41_haik', 'N_41_ask', '+N_41_kand'],
        paradigmType: '+N_41_kand',
        continuationLexicon: 'N_41KAND',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] n [d:"{d:d, d:n}"] [0:"{0:0, 0:o}"] [0:"{0:0, 0:õ}"] "+N":0 "+Guess":0 "+N_41_kand":0 > N_41KAND ;',
        text: `kand+N+Sg+Nom: kand00\nkand+N+Sg+Gen: kanno0\nkand+N+Sg+Par: kando0\nkand+N+Pl+Gen: kand0õ\nkand+N+Pl+Ine: kann0õn`,
        description: 'Strong stem kand- with consonant gradation nd ~ nn, separate singular stem vowel o and plural stem vowel õ columns. Note: In the UralicNLP analyzer, Type 41 uses model lemmas "haik" and "ask" (+N_41_haik, +N_41_ask); there is no +N_41_kand in the UralicNLP analyzer.'
      },
      {
        id: 'vro_type_41_tuekk',
        name: 'Võro Noun: tükk (piece) [Type 41 / VES 37]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 41,
        uralicNlpModelLemmas: ['tuekk', 'tükk'],
        uralicNlpGuesserTags: ['+N_41_tuekk', 'N_41_tuekk'],
        paradigmType: '+N_41_tuekk',
        continuationLexicon: 'N_41TUEKK',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] "kk":0 "+N":0 "+Guess":0 "+N_41_tuekk":0 > N_41TUEKK ;',
        text: `tükk+N+Sg+Nom: tükk\ntükk+N+Sg+Gen: tükü\ntükk+N+Sg+Par: tükkü\ntükk+N+Sg+Ill: tükkü\ntükk+N+Pl+Gen: tükke\ntükk+N+Pl+Ine: tüken`,
        description: 'Võro gradation Type 41 / VES 37 (tükk): geminate stop kk ~ k degemination in genitive, with plural stem vowel e (portmanteau *i)'
      },
      {
        id: 'vro_type_44_tsiga',
        name: 'Võro Noun: tsiga (pig) [Type 44 / VES 29]',
        lang: 'vro',
        pos: 'N',
        typeNumber: 44,
        uralicNlpModelLemmas: ['tsiga', 'sõda'],
        uralicNlpGuesserTags: ['+N_44_tsiga', 'N_44_tsiga'],
        paradigmType: '+N_44_tsiga',
        continuationLexicon: 'N_44TSIGA',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] a "+N":0 "+Guess":0 "+N_44_tsiga":0 > N_44TSIGA ;',
        text: `tsiga+N+Sg+Nom: tsiga\ntsiga+N+Sg+Gen: tsia\ntsiga+N+Sg+Par: tsika\ntsiga+N+Sg+Ill: tsikka\ntsiga+N+Pl+Gen: tsiko\ntsiga+N+Pl+Ill: tsikkohe\ntsiga+N+Pl+Ine: tsikon`,
        description: 'Võro gradation Type 44 / VES 29 (tsiga, sõda): stop alternation g ~ 0 ~ k ~ kk (d ~ 0 ~ t ~ tt, b ~ 0 ~ p ~ pp), singular stem vowel a, plural stem vowel o. Corresponds to UralicNLP guesser tag +N_44_tsiga.'
      },
      {
        id: 'vro_type_36_silm',
        name: 'Võro Noun: silm (eye) [Type 36]',
        lang: 'vro',
        pos: 'N',
        paradigmType: '+N_36_silm',
        continuationLexicon: 'N_36SILM',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] "lm":0 "+N":0 "+Guess":0 "+N_36_silm":0 > N_36SILM ;',
        text: `silm+N+Sg+Nom: silm\nsilm+N+Sg+Gen: silmä\nsilm+N+Sg+Par: silmä\nsilm+N+Pl+Gen: silmi\nsilm+N+Pl+Ine: silmih`,
        description: 'Võro stem with vowel alternation 0 ~ ä ~ i and inessive suffix -h'
      },
      {
        id: 'liv_type_1_kozon',
        name: 'Livonian Noun: kõzon (wedding) [Type 1 / Ungradated]',
        lang: 'liv',
        pos: 'N',
        paradigmType: '+N_1_kozon',
        continuationLexicon: 'N_1KOZON',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a-zäöõü]+ "+N":0 "+Guess":0 "+N_1_kozon":0 > N_1KOZON ;',
        text: `kõzon+N+Sg+Nom: kõzon\nkõzon+N+Sg+Gen: kõzon\nkõzon+N+Sg+Par: kõzond\nkõzon+N+Pl+Nom: kõzond\nkõzon+N+Pl+Gen: kõzond\nkõzon+N+Pl+Par: kõzondi`,
        description: 'Livonian ungradated noun stem Type 1 (kõzon)'
      },
      {
        id: 'liv_type_2_led',
        name: 'Livonian Noun: le’ḑ (leaf) [Gradating]',
        lang: 'liv',
        pos: 'N',
        paradigmType: '+N_led',
        continuationLexicon: 'N_LED',
        lexcRegexRule: '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a-zäöõü]+ [d|ḑ] "+N":0 "+Guess":0 "+N_led":0 > N_LED ;',
        text: `le’ḑ+N+Sg+Nom: le’ḑ\nle’ḑ+N+Sg+Gen: leḑ\nle’ḑ+N+Sg+Par: ledda\nle’ḑ+N+Pl+Nom: leḑõd\nle’ḑ+N+Pl+Gen: leḑõd\nle’ḑ+N+Pl+Par: leḑḑi`,
        description: 'Livonian gradating noun stem with broken tone and geminate alternation'
      },
      {
        id: 'fin_noun_kasi',
        name: 'Finnish Noun: käsi (hand)',
        lang: 'fin',
        pos: 'N',
        text: `käsi+N+Sg+Nom: käsi\nkäsi+N+Sg+Gen: käden\nkäsi+N+Sg+Par: kättä\nkäsi+N+Sg+Ine: kädessä\nkäsi+N+Pl+Ine: käsissä`,
        description: 'Consonant gradation s ~ d ~ t with stem vowel alternation i ~ e'
      },
      {
        id: 'fin_noun_maki',
        name: 'Finnish Noun: mäki (hill)',
        lang: 'fin',
        pos: 'N',
        text: `mäki+N+Sg+Nom: mäki0F#\nmäki+N+Sg+Gen: mä0e0F>n\nmäki+N+Sg+Par: mäke0F>ä\nmäki+N+Sg+Ine: mä0e0F>ssä\nmäki+N+Pl+Ine: mä00iF>ssä`,
        description: 'Consonant gradation k ~ 0 with stem vowel alternation i ~ e ~ 0 and stem trigger F (front-vowel harmony)'
      },
      {
        id: 'myv_noun_kudo',
        name: 'Erzya Noun: кудо (house)',
        lang: 'myv',
        pos: 'N',
        text: `кудо+N+SP+Nom: кудо\nкудо+N+Sg+Gen: кудонть\nкудо+N+Sg+Ine: кудосо\nкудо+N+Pl+Nom: кудот\nкудо+N+Pl+Ine: кудотнесэ`,
        description: 'Erzya non-gradation stem with definite/indefinite case affixes'
      }
    ];
  }

  /**
   * Saves a custom user-defined paradigm into the service library.
   */
  saveCustomParadigm(preset) {
    if (!preset || !preset.id) return null;
    const idx = this.savedParadigms.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      this.savedParadigms[idx] = preset;
    } else {
      this.savedParadigms.push(preset);
    }
    return preset;
  }

  /**
   * Parses user input lines in multiple possible formats:
   * - Tagged: "kand+N+Sg+Nom: kand"
   * - Space-separated: "kand+N+Sg+Nom  kand"
   * - Segmented: "kannõ.n" or "mäe.ssä"
   * - Plain word forms: "kand", "kanno", "kando"
   */
  parseInputForms(text, options = {}) {
    if (!text || typeof text !== 'string') return [];
    const isolateStem = options.isolateStem === true;
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);

    return lines.map((line, idx) => {
      let tag = '';
      let surface = '';

      if (line.includes(':')) {
        const colonIdx = line.indexOf(':');
        tag = line.substring(0, colonIdx).trim();
        surface = line.substring(colonIdx + 1).trim();
      } else if (/\s+/.test(line)) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[0].includes('+')) {
          tag = parts[0].trim();
          surface = parts.slice(1).join(' ').trim();
        } else {
          surface = parts[0].trim();
          tag = `#${idx + 1}`;
        }
      } else {
        surface = line.trim();
        tag = `#${idx + 1}`;
      }

      if (isolateStem) {
        if (tag.includes('#')) {
          const tagSections = tag.split('#');
          tag = tagSections[tagSections.length - 1].trim();
        } else if (tag.includes('+Cmp')) {
          const tagSections = tag.split('+Cmp');
          tag = tagSections[tagSections.length - 1].replace(/^[+#]/, '').trim();
        }
        tag = stripGuessTags(tag);

        if (surface.includes('#')) {
          const sParts = surface.split('#');
          surface = sParts[sParts.length - 1].trim();
        }
      }

      // Infer lemma from tag if possible (e.g. "kand+N+Sg+Nom" -> "kand", "+Guess+kand+N+Sg+Nom" -> "kand", "Guess+kand..." -> "kand")
      let lemma = '';
      if (tag && tag.includes('+')) {
        const tagParts = tag.split('+').filter(Boolean);
        if (tagParts.length > 0 && /^«?\+?guess»?$/i.test(tagParts[0])) {
          lemma = tagParts[1] || tagParts[0];
        } else {
          lemma = tagParts[0] || '';
        }
      } else {
        lemma = lines[0]?.split(/[:\s+]/)[0]?.trim() || surface;
      }
      lemma = lemma.replace(/(?:^«?\+?guess»?\+?|«?\+?guess»?$|\+«?\+?guess»?\+)/gi, '').trim() || lemma;

      if (isolateStem && lemma.includes('#')) {
        const lemParts = lemma.split('#');
        lemma = lemParts[lemParts.length - 1].trim();
      }

      return {
        id: idx + 1,
        tag,
        lemma,
        surface,
        rawLine: line
      };
    });
  }

  /**
   * Aligns paradigm forms letter-by-letter with zero-filling (twol-words2zerofilled).
   * Supports human-in-the-loop manual boundary hints (dots ".") or custom options.
   */
  alignParadigm(forms, options = {}) {
    if (!forms || forms.length === 0) {
      return { forms: [], morphophonemes: [], formula: '', rawExpansions: [] };
    }

    const zeroSym = options.zeroSymbol || '0';
    const boundarySym = options.boundarySymbol || '#';
    const affixSep = options.affixSeparator || '>';

    // 1. Morph segmentation: separate stem from suffixes
    const splitForms = forms.map(item => {
      let s = item.surface;
      let stem = s;
      let suffix = '';

      // Strip brackets if form was provided as variant list [form1, form2]
      let cleanS = s;
      if (cleanS.startsWith('[') && cleanS.endsWith(']')) {
        const inner = cleanS.slice(1, -1).split(',').map(v => v.trim()).filter(Boolean);
        if (inner.length > 0) {
          cleanS = inner[0];
          stem = cleanS;
        }
      }

      // Check explicit morpheme boundary '>' or word boundary '#' first
      if (s.includes('>')) {
        const parts = s.split('>');
        stem = parts[0].trim();
        suffix = parts.slice(1).join('>').trim();
        if (suffix.endsWith('#')) {
          suffix = suffix.slice(0, -1).trim();
        }
      } else if (s.includes('#')) {
        // e.g. "mäki0F#" or "kand#"
        stem = s.replace(/#+$/, '').trim();
        suffix = '';
      } else if (s.includes('.')) {
        // Dot segmentation (Koskenniemi twol convention: kannõ.n or mäe.ssä)
        const parts = s.split('.');
        stem = parts[0].trim();
        suffix = parts.slice(1).join('.').trim();
      } else if (options.customSplits && options.customSplits[item.id]) {
        stem = options.customSplits[item.id].stem;
        suffix = options.customSplits[item.id].suffix;
      } else {
        // Automatic heuristic segmentation for Uralic suffixes
        const tag = item.tag || '';
        const lemma = item.lemma || '';
        const isGeminateStopLemma = /(kk|tt|pp)$/.test(lemma);
        const weakLemmaStem = isGeminateStopLemma ? lemma.slice(0, -1) : '';

        if (tag.includes('Pl') && tag.includes('Gen')) {
          // Plural Genitive: plural stem vowel -e/-ä (portmanteau *i) after strong stem
          if (isGeminateStopLemma && cleanS.startsWith(lemma) && (cleanS.endsWith('e') || cleanS.endsWith('ä'))) {
            stem = lemma;
            suffix = cleanS.slice(lemma.length);
          } else if (cleanS.endsWith('de') || cleanS.endsWith('den')) {
            const cut = cleanS.endsWith('den') ? 3 : 2;
            stem = cleanS.slice(0, -cut);
            suffix = cleanS.slice(-cut);
          } else if (cleanS.endsWith('te') || cleanS.endsWith('ten')) {
            const cut = cleanS.endsWith('ten') ? 3 : 2;
            stem = cleanS.slice(0, -cut);
            suffix = cleanS.slice(-cut);
          }
        } else if (tag.includes('Pl') && tag.includes('Ine')) {
          // Plural Inessive: plural stem vowel + inessive -en/-än (or -ih) after weak stem
          if (isGeminateStopLemma && cleanS.startsWith(weakLemmaStem) && (cleanS.endsWith('en') || cleanS.endsWith('än'))) {
            stem = weakLemmaStem;
            suffix = cleanS.slice(weakLemmaStem.length);
          } else if (cleanS.endsWith('in') && cleanS.length > 3) {
            stem = cleanS.slice(0, -2);
            suffix = 'in';
          } else if (cleanS.endsWith('ih') && cleanS.length > 3) {
            stem = cleanS.slice(0, -2);
            suffix = 'ih';
          } else if (cleanS.endsWith('n') && cleanS.length > 4) {
            stem = cleanS.slice(0, -1);
            suffix = 'n';
          }
        } else if (isGeminateStopLemma && cleanS.startsWith(lemma) && (cleanS.endsWith('e') || cleanS.endsWith('ä')) && cleanS.length === lemma.length + 1) {
          // Untagged plural genitive for geminate stop lemma (e.g. tükke -> tükk > e)
          stem = lemma;
          suffix = cleanS.slice(lemma.length);
        } else if (isGeminateStopLemma && cleanS.startsWith(weakLemmaStem) && (cleanS.endsWith('en') || cleanS.endsWith('än')) && cleanS.length === weakLemmaStem.length + 2) {
          // Untagged plural inessive for geminate stop lemma (e.g. tüken -> tük > en)
          stem = weakLemmaStem;
          suffix = cleanS.slice(weakLemmaStem.length);
        } else if (tag.includes('Ine') && cleanS.endsWith('n') && cleanS.length > 4) {
          stem = cleanS.slice(0, -1);
          suffix = 'n';
        } else if (tag.includes('Ine') && (cleanS.endsWith('ssä') || cleanS.endsWith('ssa'))) {
          stem = cleanS.slice(0, -3);
          suffix = cleanS.slice(-3);
        } else if (tag.includes('Ine') && (cleanS.endsWith('со') || cleanS.endsWith('сэ'))) {
          stem = cleanS.slice(0, -2);
          suffix = cleanS.slice(-2);
        } else if (tag.includes('Ine') && cleanS.endsWith('h') && cleanS.length > 4) {
          stem = cleanS.slice(0, -1);
          suffix = 'h';
        } else if (tag.includes('Ela') && (cleanS.endsWith('st') || cleanS.endsWith('stä') || cleanS.endsWith('sta'))) {
          const cut = cleanS.endsWith('st') ? 2 : 3;
          stem = cleanS.slice(0, -cut);
          suffix = cleanS.slice(-cut);
        } else if (tag.includes('All') && (cleanS.endsWith('lõ') || cleanS.endsWith('lle'))) {
          stem = cleanS.slice(0, -2);
          suffix = cleanS.slice(-2);
        } else if (tag.includes('Ill') && (cleanS.endsWith('he') || cleanS.endsWith('h'))) {
          const cut = cleanS.endsWith('he') ? 2 : 1;
          stem = cleanS.slice(0, -cut);
          suffix = cleanS.slice(-cut);
        } else if (tag.includes('Gen') && cleanS.endsWith('n') && !tag.includes('Pl') && cleanS.length > 3) {
          // Finnish genitive -n
          stem = cleanS.slice(0, -1);
          suffix = 'n';
        } else if (tag.includes('Par') && cleanS.length > 3) {
          if (cleanS.endsWith('ttä') || cleanS.endsWith('tta')) {
            stem = cleanS.slice(0, -3);
            suffix = cleanS.slice(-3);
          } else if (cleanS.endsWith('tä') || cleanS.endsWith('ta')) {
            stem = cleanS.slice(0, -2);
            suffix = cleanS.slice(-2);
          } else if (cleanS.endsWith('ä') || cleanS.endsWith('a')) {
            // Only strip -ä/-a as partitive suffix if not an -a/-ä stem where -a/-ä is part of the stem
            // (e.g. vro tsiga -> tsika, sõda -> sõta, koda -> kota, luba -> lupa)
            const isAStem = (lemma.endsWith('a') && cleanS.endsWith('a') && !cleanS.endsWith('aa')) ||
                            (lemma.endsWith('ä') && cleanS.endsWith('ä') && !cleanS.endsWith('ää'));
            if (!isAStem && options.lang !== 'vro') {
              stem = cleanS.slice(0, -1);
              suffix = cleanS.slice(-1);
            }
          }
        }
      }

      return {
        ...item,
        stem,
        suffix
      };
    });

    // 2. Letter-by-letter multi-alignment of stems
    const parseStemChars = (st) => {
      let clean = (st || '').trim();
      if (clean.startsWith('[') && clean.endsWith(']')) {
        clean = clean.replace(/,\s*/g, ', ');
      }
      return clean.includes(' ') ? clean.split(/\s+/) : clean.split('');
    };
    const maxStemLen = Math.max(...splitForms.map(f => parseStemChars(f.stem).length));

    // Stems (split into characters or tokens)
    const splitStemChars = splitForms.map(f => parseStemChars(f.stem));
    const regularStems = splitStemChars.filter(c => !c[0] || !c[0].startsWith('['));

    // Common prefix of regular stems
    let commonPrefixLen = 0;
    if (regularStems.length > 0) {
      let pChars = regularStems[0];
      for (let i = 1; i < regularStems.length; i++) {
        let p = 0;
        while (p < pChars.length && p < regularStems[i].length && pChars[p] === regularStems[i][p]) {
          p++;
        }
        pChars = pChars.slice(0, p);
      }
      commonPrefixLen = pChars.length;
    }

    // Check if paradigm has distinct singular stem vowel and plural stem vowel marker (e.g. tsiga Sg -a vs Pl -o)
    const sgStems = splitForms.filter(f => (f.tag || '').includes('Sg'));
    const plStems = splitForms.filter(f => (f.tag || '').includes('Pl'));
    const sgVowels = Array.from(new Set(sgStems.map(f => f.stem.slice(-1)).filter(ch => /[aeiouõäöü]/i.test(ch))));
    const plVowels = Array.from(new Set(plStems.map(f => f.stem.slice(-1)).filter(ch => /[aeiouõäöü]/i.test(ch))));
    const lemmaEndsWithVowel = /[aeiouõäöü]$/i.test(splitForms[0]?.lemma || '');

    const separatePluralVowel = lemmaEndsWithVowel && sgVowels.length === 1 && plVowels.length === 1 && sgVowels[0] !== plVowels[0];

    let alignedForms;
    if (separatePluralVowel) {
      const sgVow = sgVowels[0];
      const plVow = plVowels[0];
      const cnsForms = splitForms.map(f => {
        const isPl = (f.tag || '').includes('Pl');
        const cnsStem = f.stem.slice(0, -1);
        return { ...f, cnsStem, isPl };
      });
      const maxCnsLen = Math.max(...cnsForms.map(f => f.cnsStem.length));

      let pChars = cnsForms[0].cnsStem.split('');
      for (let i = 1; i < cnsForms.length; i++) {
        let p = 0;
        const sChars = cnsForms[i].cnsStem.split('');
        while (p < pChars.length && p < sChars.length && pChars[p] === sChars[p]) p++;
        pChars = pChars.slice(0, p);
      }
      const commonPrefixLen = pChars.length;

      alignedForms = cnsForms.map(f => {
        let cChars = f.cnsStem.split('');
        if (cChars.length < maxCnsLen) {
          const lastChar = cChars[cChars.length - 1];
          const hasGeminate = cnsForms.some(cf => cf.cnsStem.length === maxCnsLen && cf.cnsStem.endsWith(lastChar + lastChar));

          if (hasGeminate) {
            // Consonant lengthening: shorter stem has single consonant, longer has geminate
            // Zero must be inserted before the final base consonant so that lengthening is in column 3
            const head = cChars.slice(0, -1);
            const tail = cChars.slice(-1);
            const mid = [];
            while (head.length + mid.length + tail.length < maxCnsLen) {
              mid.push(zeroSym);
            }
            cChars = [...head, ...mid, ...tail];
          } else {
            const head = cChars.slice(0, commonPrefixLen);
            const mid = cChars.slice(commonPrefixLen);
            while (mid.length < maxCnsLen - commonPrefixLen) {
              mid.unshift(zeroSym);
            }
            cChars = [...head, ...mid];
          }
        }
        const chars = f.isPl
          ? [...cChars, zeroSym, plVow]
          : [...cChars, sgVow, zeroSym];

        let boundaryPart = '';
        if (f.suffix) {
          const suffixClean = f.suffix.replace(/#+$/, '').trim();
          let suffixTokens = suffixClean.includes(' ') ? suffixClean.split(/\s+/) : suffixClean.split('');
          boundaryPart = `${affixSep} ${suffixTokens.join(' ')}`;
        } else {
          boundaryPart = boundarySym;
        }

        const expansion = `${chars.join(' ')} ${boundaryPart}`;
        const fullLine = f.tag && !f.tag.startsWith('#')
          ? `${f.tag}: ${expansion}`
          : `${f.surface}: ${expansion}`;

        return {
          ...f,
          stemChars: chars,
          boundaryPart,
          expansion,
          fullLine
        };
      });
    } else {
      const fullStems = regularStems.filter(c => c.length === maxStemLen);
      const defaultRefStem = fullStems[0] || regularStems[0] || [];

      alignedForms = splitForms.map(f => {
        let chars = parseStemChars(f.stem);
        
        // If manual alignment provided in options, use it
        if (options.manualChars && options.manualChars[f.id]) {
          chars = [...options.manualChars[f.id]];
        } else {
          // Zero-filling: insert zeros (before stem-trigger if present, else before common suffix or at end)
          if (chars.length < maxStemLen) {
            const lastChar = chars[chars.length - 1];
            if (/[A-Z]/.test(lastChar)) {
              // Keep stem trigger (e.g. F, B) at stem end, insert zero before trigger
              while (chars.length < maxStemLen) {
                chars.splice(chars.length - 1, 0, zeroSym);
              }
            } else if (chars[0] && chars[0].startsWith('[')) {
              // Bracketed variant list: pad with zeros at the end
              while (chars.length < maxStemLen) {
                chars.push(zeroSym);
              }
            } else {
              // Check if this shorter stem ends with the same stem vowel as a full reference stem
              const matchingRef = fullStems.find(ref => ref[ref.length - 1] === lastChar) || defaultRefStem;
              const refEndChar = matchingRef[matchingRef.length - 1];
              const isVowel = /[aeiouõäöüAEIOUÕÄÖÜаеёиоуыэюяАЕЁИОУЫЭЮЯ]/i.test(lastChar);

              if (isVowel && lastChar === refEndChar && chars.length > commonPrefixLen) {
                // Shorter stem has matching stem vowel (e.g. tükü ~ tükkü, vido/vio/vito ~ vitto)
                const lemma = splitForms[0]?.lemma || '';
                const lemmaStem = lemma.replace(/[aeiouõäöü]+$/i, '');
                const lemmaHasGeminate = lemmaStem.length >= 2 && lemmaStem[lemmaStem.length - 1] === lemmaStem[lemmaStem.length - 2];

                const hasGeminateBeforeVowel = !lemmaHasGeminate && matchingRef.length >= 3 &&
                  matchingRef[matchingRef.length - 2] === matchingRef[matchingRef.length - 3] &&
                  chars[chars.length - 2] === matchingRef[matchingRef.length - 2];

                if (hasGeminateBeforeVowel) {
                  // Consonant lengthening: insert zero before the single consonant (e.g. talo -> t a 0 l o)
                  const s = 2; // tail is consonant + stem vowel, e.g. ['l', 'o']
                  const head = chars.slice(0, chars.length - s);
                  const mid = [];
                  const tail = chars.slice(chars.length - s);
                  while (head.length + mid.length + tail.length < maxStemLen) {
                    mid.push(zeroSym);
                  }
                  chars = [...head, ...mid, ...tail];
                } else {
                  // Insert zero at the internal consonant alternation/degemination point
                  const s = 1;
                  const head = chars.slice(0, commonPrefixLen);
                  const mid = chars.slice(commonPrefixLen, chars.length - s);
                  const tail = chars.slice(chars.length - s);
                  const targetMidLen = maxStemLen - commonPrefixLen - s;
                  while (mid.length < targetMidLen) {
                    mid.unshift(zeroSym); // align to right: 0 d, 0 0, 0 k
                  }
                  chars = [...head, ...mid, ...tail];
                }
              } else {
                // Vowel elision in shorter stem (e.g. tükk, kand): pad with zeros at the end
                while (chars.length < maxStemLen) {
                  chars.push(zeroSym);
                }
              }
            }
          }
        }

        let boundaryPart = '';
        if (f.suffix) {
          const suffixClean = f.suffix.replace(/#+$/, '').trim();
          let suffixTokens = [];
          if (suffixClean.includes(' ')) {
            suffixTokens = suffixClean.split(/\s+/);
          } else {
            suffixTokens = suffixClean.split('');
          }
          boundaryPart = `${affixSep} ${suffixTokens.join(' ')}`;
        } else {
          boundaryPart = boundarySym;
        }

        const expansion = `${chars.join(' ')} ${boundaryPart}`;
        const fullLine = f.tag && !f.tag.startsWith('#')
          ? `${f.tag}: ${expansion}`
          : `${f.surface}: ${expansion}`;

        return {
          ...f,
          stemChars: chars,
          boundaryPart,
          expansion,
          fullLine
        };
      });
    }

    // 3. Extract Morphophonemic columns
    const numCols = Math.max(...alignedForms.map(a => a.stemChars.length));
    const morphophonemes = [];
    const regularAligned = alignedForms.filter(a => !a.stem.trim().startsWith('['));
    const sourceFormsForCols = regularAligned.length > 0 ? regularAligned : alignedForms;

    for (let c = 0; c < numCols; c++) {
      const colChars = sourceFormsForCols.map(a => a.stemChars[c] || zeroSym);
      const uniqueValues = Array.from(new Set(colChars));
      const isInvariant = uniqueValues.length === 1;
      const baseChar = colChars[0];

      let symbol = '';
      let type = 'invariant';

      if (isInvariant) {
        symbol = uniqueValues[0];
        type = 'invariant';
      } else {
        // Check custom rename if user provided one
        if (options.renamedMorphophonemes && options.renamedMorphophonemes[c]) {
          symbol = options.renamedMorphophonemes[c];
          type = 'custom';
        } else {
          const vowels = 'aeiouõäöüAEIOUÕÄÖÜ';
          const nonZeroValues = uniqueValues.filter(ch => ch !== zeroSym && ch !== 'Ø');
          const allNonZeroAreVowels = nonZeroValues.length > 0 && nonZeroValues.every(ch => vowels.includes(ch));

          if (allNonZeroAreVowels && nonZeroValues.length > 1) {
            // Multi-vowel alternation / deletion: e.g. {0oõ}
            symbol = '{' + uniqueValues.join('') + '}';
            type = 'vowel_alternation';
          } else {
            // Check standard stop gradation morphophonemes (e.g. {tØ}, {tdØ}, {kØ}, {kgØ}, {pØ}, {pbv})
            const nonZero = uniqueValues.filter(ch => ch !== zeroSym && ch !== 'Ø');
            const hasZero = uniqueValues.includes(zeroSym) || uniqueValues.includes('Ø');
            if (hasZero && baseChar === zeroSym && nonZero.length === 1 && nonZero[0] === 't') {
              symbol = '{tØ}';
              type = 'consonant_gradation';
            } else if (hasZero && baseChar === zeroSym && nonZero.length === 1 && nonZero[0] === 'k') {
              symbol = '{kØ}';
              type = 'consonant_gradation';
            } else if (hasZero && baseChar === zeroSym && nonZero.length === 1 && nonZero[0] === 'p') {
              symbol = '{pØ}';
              type = 'consonant_gradation';
            } else if (hasZero && nonZero.includes('d') && nonZero.includes('t')) {
              symbol = '{tdØ}';
              type = 'consonant_gradation';
            } else if (hasZero && nonZero.includes('g') && nonZero.includes('k')) {
              symbol = '{kgØ}';
              type = 'consonant_gradation';
            } else if (hasZero && nonZero.includes('b') && nonZero.includes('p')) {
              symbol = '{pbv}';
              type = 'consonant_gradation';
            } else {
              // Consonant gradation / pair alternation: e.g. {d:d, d:n}, {k:k, k:0}, {0:0, 0:ü}
              const pairs = uniqueValues.map(ch => `${baseChar}:${ch}`);
              symbol = '{' + pairs.join(', ') + '}';
              type = allNonZeroAreVowels ? 'vowel_alternation' : 'consonant_gradation';
            }
          }
        }
      }

      // Record contexts for this column
      const contexts = alignedForms.map((a, rIdx) => {
        const left = a.stemChars.slice(0, c).join(' ') || '.#.';
        const right = a.stemChars.slice(c + 1).join(' ') + ' ' + a.boundaryPart;
        return {
          rowId: a.id,
          tag: a.tag,
          surface: a.surface,
          char: a.stemChars[c],
          pair: `${baseChar}:${a.stemChars[c]}`,
          leftContext: left,
          rightContext: right.trim()
        };
      });

      morphophonemes.push({
        colIndex: c,
        isInvariant,
        type,
        baseChar,
        symbol,
        uniqueValues,
        colChars,
        contexts
      });
    }

    const formula = morphophonemes.map(m => m.symbol).join(', ');

    alignedForms.forEach(form => {
      const morphTokens = form.stemChars.map((ch, idx) => {
        const m = morphophonemes[idx];
        if (!m) return ch;
        if (m.isInvariant) {
          return `{${m.symbol}:${m.symbol}}`;
        }
        return m.symbol;
      });
      form.morphExpansion = `${morphTokens.join(', ')} ${form.boundaryPart}`;
      form.morphLine = form.tag && !form.tag.startsWith('#')
        ? `${form.tag}: ${form.morphExpansion}`
        : `${form.surface}: ${form.morphExpansion}`;
    });

    return {
      forms: alignedForms,
      morphophonemes,
      formula,
      rawExpansions: alignedForms.map(a => a.fullLine),
      morphLines: alignedForms.map(a => a.morphLine),
      lang: options.lang || ''
    };
  }

  /**
   * Generates Two-Level Rules (TWOL) based on the derived morphophonemes and contexts.
   */
  generateTwolRules(analysis, options = {}) {
    if (!analysis || !analysis.morphophonemes) return { rules: [], twolGrammar: '' };

    const lang = options.lang || analysis.lang || '';
    const rules = [];
    const alternations = analysis.morphophonemes.filter(m => !m.isInvariant);

    alternations.forEach(m => {
      const baseChar = m.baseChar;
      const uniqueVals = m.uniqueValues;

      if (m.type === 'consonant_gradation') {
        // e.g. d:n alternation
        const weakVals = uniqueVals.filter(v => v !== baseChar);
        weakVals.forEach(wVal => {
          // Find right contexts where weak value occurs
          const weakContexts = m.contexts.filter(ctx => ctx.char === wVal);
          const strongContexts = m.contexts.filter(ctx => ctx.char === baseChar);

          // Deduce common right contexts
          const rightVowels = Array.from(new Set(
            weakContexts.map(c => c.rightContext.split(' ')[0]).filter(v => v && v !== '#')
          ));
          const leftCons = Array.from(new Set(
            weakContexts.map(c => {
              const parts = c.leftContext.split(' ');
              return parts[parts.length - 1];
            }).filter(Boolean)
          ));

          const leftPart = leftCons.length > 0 ? leftCons.join(' | ') : '_';
          const rightPart = rightVowels.length > 0 ? `[ ${rightVowels.join(' | ')} ]` : '_';

          const ruleName = `Consonant gradation ${baseChar}:${wVal}`;
          const ruleBody = `"${ruleName}"\n${baseChar}:${wVal} <=> ${leftPart} _ ${rightPart} ;`;

          rules.push({
            name: ruleName,
            targetPair: `${baseChar}:${wVal}`,
            morphophoneme: m.symbol,
            twolText: ruleBody,
            positiveContexts: weakContexts.map(c => `${c.leftContext} _ ${c.rightContext}`),
            negativeContexts: strongContexts.map(c => `${c.leftContext} _ ${c.rightContext}`)
          });
        });
      } else if (m.type === 'vowel_alternation') {
        // e.g. {0oõ} or stem vowel elision
        const hasZero = uniqueVals.includes('0') || uniqueVals.includes('Ø');
        if (hasZero) {
          const zeroContexts = m.contexts.filter(c => c.char === '0' || c.char === 'Ø');
          const nonZeroContexts = m.contexts.filter(c => c.char !== '0' && c.char !== 'Ø');

          const ruleName = `Stem vowel elision ${m.symbol}:0`;
          const ruleBody = `"${ruleName}"\n${m.symbol}:0 <=> _ # ;`;

          rules.push({
            name: ruleName,
            targetPair: `${m.symbol}:0`,
            morphophoneme: m.symbol,
            twolText: ruleBody,
            positiveContexts: zeroContexts.map(c => `${c.leftContext} _ ${c.rightContext}`),
            negativeContexts: nonZeroContexts.map(c => `${c.leftContext} _ ${c.rightContext}`)
          });
        }
      }
    });

    // Check for stem triggers (e.g. F, B) indicating vowel harmony
    const hasFrontTrigger = analysis.morphophonemes.some(m => m.symbol === 'F' || m.colChars.includes('F'));
    const hasBackTrigger = analysis.morphophonemes.some(m => m.symbol === 'B' || m.colChars.includes('B'));

    if (hasFrontTrigger) {
      rules.push({
        name: 'Front vowel harmony stem trigger F:0',
        targetPair: 'F:0',
        morphophoneme: 'F',
        twolText: '"Front vowel harmony stem trigger F:0"\nF:0 <=> _ [ %> | # ] ;',
        positiveContexts: ['_ %>'],
        negativeContexts: []
      });
      rules.push({
        name: 'Front vowel harmony suffix agreement {A:ä}',
        targetPair: 'A:ä',
        morphophoneme: 'A',
        twolText: '"Front vowel harmony suffix agreement"\nä <=> F [ :Cns | %> ]+ _ ;',
        positiveContexts: ['F %> _'],
        negativeContexts: []
      });
    }

    if (hasBackTrigger) {
      rules.push({
        name: 'Back vowel harmony stem trigger B:0',
        targetPair: 'B:0',
        morphophoneme: 'B',
        twolText: '"Back vowel harmony stem trigger B:0"\nB:0 <=> _ [ %> | # ] ;',
        positiveContexts: ['_ %>'],
        negativeContexts: []
      });
      rules.push({
        name: 'Back vowel harmony suffix agreement {A:a}',
        targetPair: 'A:a',
        morphophoneme: 'A',
        twolText: '"Back vowel harmony suffix agreement"\na <=> B [ :Cns | %> ]+ _ ;',
        positiveContexts: ['B %> _'],
        negativeContexts: []
      });
    }

    const triggerAlphabet = [];
    if (hasFrontTrigger) triggerAlphabet.push('F');
    if (hasBackTrigger) triggerAlphabet.push('B');
    const triggerAlphaStr = triggerAlphabet.length > 0 ? ' ' + triggerAlphabet.join(' ') : '';
    const triggerSet = triggerAlphabet.length > 0 ? `  Triggers = ${triggerAlphabet.join(' ')} ;\n` : '';

    const langLine = lang ? `! Language: ${lang}\n` : '';
    const header = `! ==========================================================\n! Two-Level Rules (TWOL Formalism) - Generated by LangJack\n! Based on Koskenniemi (twol) Paradigm Discovery Model\n${langLine}! ==========================================================\n\nAlphabet\n  a b d e g h i j k l m n o p r s t u v õ ä ö ü š ž${triggerAlphaStr}\n  ${analysis.morphophonemes.filter(m => !m.isInvariant).map(m => m.symbol).join(' ')}\n;\n\nSets\n  Vow = a e i o u õ ä ö ü ;\n  Cns = b d g h j k l m n p r s t v š ž ;\n${triggerSet};\n\nRules\n\n`;

    const twolGrammar = header + rules.map(r => r.twolText).join('\n\n');

    return { rules, twolGrammar };
  }

  /**
   * Generates a LexC grammar in coordination with the discovered paradigm.
   */
  generateLexc(analysis, paradigmName = 'NounParadigm', options = {}) {
    if (!analysis || !analysis.forms || analysis.forms.length === 0) return '';

    const lang = options.lang || analysis.lang || '';
    const lemma = analysis.forms[0]?.lemma || 'Stem';
    const cleanName = (paradigmName || lemma).replace(/[^a-zA-Z0-9_]/g, '_');
    const morphSymbolStem = analysis.morphophonemes.map(m => m.symbol).join('');

    // Tags used in the paradigm
    const allTags = Array.from(new Set(
      analysis.forms.flatMap(f => (f.tag || '').split('+').filter(Boolean))
    ));
    const multichars = allTags.map(t => `+${t}`).join(' ');

    const regexInfo = this.deriveStemRegex(analysis);
    const lexcRegexRule = (options.lexcRegexRule || regexInfo.lexcRegex || '').trim();

    const langLine = lang ? `! Language: ${lang}\n` : '';
    let lexc = `! ==========================================================\n! LexC Grammar - Generated by LangJack Paradigm Discoverer\n! Model: ${lemma} (${cleanName})\n${langLine}! ==========================================================\n\n`;
    lexc += `Multichar_Symbols ${multichars} %<N%> %<V%> %<Sg%> %<Pl%> %<Nom%> %<Gen%> %<Par%> %<Ine%> +Guess +${cleanName}\n\n`;

    lexc += `LEXICON Root\n${lemma}    ${cleanName}_Stem ;\n`;
    if (lexcRegexRule) {
      lexc += `! Regular-expression description of lemma and stem (guesser entry):\n${lexcRegexRule}\n`;
    }
    lexc += `\n`;

    lexc += `LEXICON ${cleanName}_Stem\n`;
    lexc += `! Underlying morphophonemic representation:\n`;
    lexc += `${morphSymbolStem}    ${cleanName}_Cases ;\n\n`;

    lexc += `! Alternative: Allomorphic stem sublexicons:\n`;
    const distinctStems = Array.from(new Set(analysis.forms.map(f => f.stem)));
    distinctStems.forEach((st, idx) => {
      lexc += `! ${st}    ${cleanName}_Allomorph_${idx + 1} ;\n`;
    });
    lexc += `\n`;

    lexc += `LEXICON ${cleanName}_Cases\n`;
    analysis.forms.forEach(f => {
      const tagStr = f.tag && !f.tag.startsWith('#') ? f.tag : `+N+Form_${f.id}`;
      const suffixStr = f.suffix ? `>${f.suffix}` : '0';
      lexc += `${tagStr}:${suffixStr}    # ;\n`;
    });

    return lexc;
  }

  /**
   * Generates modern LexD grammar in coordination with the discovered paradigm.
   */
  generateLexd(analysis, paradigmName = 'NounParadigm', options = {}) {
    if (!analysis || !analysis.forms || analysis.forms.length === 0) return '';

    const lang = options.lang || analysis.lang || '';
    const lemma = analysis.forms[0]?.lemma || 'Stem';
    const cleanName = (paradigmName || lemma).replace(/[^a-zA-Z0-9_]/g, '_');

    const langLine = lang ? `# Language: ${lang}\n` : '';
    let lexd = `# ==========================================================\n# LexD Grammar - Generated by LangJack Paradigm Discoverer\n# Model: ${lemma} (${cleanName})\n${langLine}# ==========================================================\n\n`;

    lexd += `PATTERNS\n${cleanName}Stems ${cleanName}Affixes\n\n`;

    lexd += `LEXICON ${cleanName}Stems\n`;
    analysis.forms.forEach(f => {
      const tagTokens = (f.tag || '').split('+').filter(Boolean);
      const formattedTag = tagTokens.length > 0
        ? tagTokens.map(t => `<${t}>`).join('')
        : `<${lemma}><Form_${f.id}>`;
      lexd += `${formattedTag}:${f.stem}\n`;
    });

    lexd += `\nLEXICON ${cleanName}Affixes\n`;
    const uniqueSuffixes = Array.from(new Set(analysis.forms.map(f => f.suffix || '')));
    uniqueSuffixes.forEach(suf => {
      if (suf) {
        lexd += `:${suf}\n`;
      } else {
        lexd += `:\n`;
      }
    });

    return lexd;
  }

  /**
   * Derives regular expressions and phonotactic rules characterizing the stem type.
   */
  deriveStemRegex(analysis) {
    if (!analysis || !analysis.forms || analysis.forms.length === 0) {
      return { pattern: '', explanation: '', replacementRules: {} };
    }

    const rawNom = analysis.forms[0]?.surface || '';
    const rawGen = analysis.forms[1]?.surface || '';
    const nomForm = rawNom.replace(/[0-9FB#>.]/g, '').trim() || rawNom;
    const genForm = rawGen.replace(/[0-9FB#>.]/g, '').trim() || rawGen;

    let pattern = '';
    let explanation = '';
    let lexcRegex = '';
    let lexcExplanation = '';
    let paradigmType = analysis.paradigmType || '';
    let continuationLexicon = analysis.continuationLexicon || '';
    let replMap = {};

    // Check consonant gradation types:
    // 0a. Type 44 stop gradation with singular -a and plural -o (tsiga ~ tsia ~ tsika ~ tsikka ~ tsiko, sõda ~ sõa ~ sõta ~ sõttohe ~ sõto)
    const isType44 = (
      (nomForm.endsWith('da') || nomForm.endsWith('ga') || nomForm.endsWith('ba')) &&
      genForm.endsWith('a') &&
      analysis.forms.some(f => (f.surface || '').endsWith('ta') || (f.surface || '').endsWith('ka') || (f.surface || '').endsWith('pa')) &&
      analysis.forms.some(f => (f.surface || '').endsWith('to') || (f.surface || '').endsWith('ko') || (f.surface || '').endsWith('po') || (f.surface || '').endsWith('ttohe') || (f.surface || '').endsWith('kkohe') || (f.surface || '').endsWith('ppohe'))
    ) || analysis.forms[0]?.lemma === 'tsiga' || analysis.forms[0]?.lemma === 'sõda' || analysis.paradigmType === '+N_44_tsiga';

    // 0b. Type 39 stop gradation (d ~ 0 ~ t ~ tt, g ~ 0 ~ k ~ kk, b ~ 0 ~ p ~ pp, e.g. vido ~ vio ~ vito ~ vitto)
    const isVidoType = (
      (nomForm.endsWith('do') || nomForm.endsWith('go') || nomForm.endsWith('bo')) &&
      genForm.endsWith('o') &&
      analysis.forms.some(f => (f.surface || '').endsWith('to') || (f.surface || '').endsWith('ko') || (f.surface || '').endsWith('po')) &&
      analysis.forms.some(f => (f.surface || '').endsWith('tto') || (f.surface || '').endsWith('kko') || (f.surface || '').endsWith('ppo'))
    ) || analysis.forms[0]?.lemma === 'vido' || analysis.paradigmType === '+N_39_vido';

    // 0c. Type 39 luba stop gradation (b ~ 0 ~ p ~ pp, d ~ 0 ~ t ~ tt, g ~ 0 ~ k ~ kk) with singular stem vowel -a and plural stem vowel -õ
    const isLubaType = (
      (nomForm.endsWith('da') || nomForm.endsWith('ga') || nomForm.endsWith('ba')) &&
      genForm.endsWith('a') &&
      analysis.forms.some(f => (f.surface || '').endsWith('ta') || (f.surface || '').endsWith('ka') || (f.surface || '').endsWith('pa')) &&
      analysis.forms.some(f => (f.surface || '').endsWith('tõ') || (f.surface || '').endsWith('kõ') || (f.surface || '').endsWith('põ') || (f.surface || '').endsWith('ttõhe') || (f.surface || '').endsWith('kkõhe') || (f.surface || '').endsWith('ppõhe'))
    ) || analysis.forms[0]?.lemma === 'luba' || analysis.paradigmType === '+N_39_luba';

    // 0d. Type 39 lugu stop gradation (g ~ 0 ~ k ~ kk, d ~ 0 ~ t ~ tt, b ~ 0 ~ p ~ pp) with singular stem vowel -u and plural stem vowel -õ
    const isLuguType = (
      (nomForm.endsWith('du') || nomForm.endsWith('gu') || nomForm.endsWith('bu')) &&
      genForm.endsWith('u') &&
      analysis.forms.some(f => (f.surface || '').endsWith('tu') || (f.surface || '').endsWith('ku') || (f.surface || '').endsWith('pu')) &&
      analysis.forms.some(f => (f.surface || '').endsWith('tõ') || (f.surface || '').endsWith('kõ') || (f.surface || '').endsWith('põ') || (f.surface || '').endsWith('ttõhe') || (f.surface || '').endsWith('kkõhe') || (f.surface || '').endsWith('ppõhe'))
    ) || analysis.forms[0]?.lemma === 'lugu' || analysis.paradigmType === '+N_39_lugu';

    // 0e. Type 40 consonant lengthening (talo ~ tallo ~ tallõ ~ tallõhe ~ talõn)
    const isTaloType = (
      nomForm === genForm &&
      analysis.forms.some(f => (f.surface || '').length > nomForm.length && /(?:ll|mm|nn|rr|ss)/.test(f.surface || ''))
    ) || analysis.forms[0]?.lemma === 'talo' || analysis.paradigmType === '+N_40_talo';

    if (isType44) {
      pattern = '^([bdfghjklmnprstv]*)([aouõeiäöü])(d|g|b)a$';
      explanation = 'Võro Type 44 (+N_44_tsiga / VES 29) stop gradation (g~0~k~kk, d~0~t~tt, b~0~p~pp) with singular stem vowel -a and plural stem vowel -o.';
      lexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] a "+N":0 "+Guess":0 "+N_44_tsiga":0 > N_44TSIGA ;';
      lexcExplanation = 'One line of LexC regular-expression code describing lemma and stem: (1) consonant onset [b-v]*, (2) root vowel [a|o|u|õ], (3) stop gradation upper:lower morphophonemes (0:"{kØ}" g:"{kgØ}" | 0:"{tØ}" d:"{tdØ}" | 0:"{pØ}" b:"{pbv}"), (4) singular stem vowel a, (5) zero-mapped tags ("+N":0 "+Guess":0 "+N_44_tsiga":0), (6) continuation lexicon N_44TSIGA.';
      continuationLexicon = 'N_44TSIGA';
      paradigmType = '+N_44_tsiga';
      replMap = {
        type: 'vro_type_44_tsiga',
        rootSuffix: 'ga',
        templates: analysis.forms.map(f => ({ tag: f.tag, template: f.surface }))
      };
    } else if (isVidoType) {
      pattern = '^([bdfghjklmnprstv]*)([aouõeiäöü])(d|g|b)o$';
      explanation = 'Võro Type 39 (+N_39_vido) stop gradation (d~0~t~tt, g~0~k~kk, b~0~p~pp) with stem vowel -o.';
      lexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "o":0 "+N":0 "+Guess":0 "+N_39_vido":0 > N_39VIDO ;';
      lexcExplanation = 'One line of LexC regular-expression code describing lemma and stem: (1) consonant onset [b-v]*, (2) root vowel [a|o|u|õ], (3) stop gradation upper:lower morphophonemes (0:"{kØ}" g:"{kgØ}" | 0:"{tØ}" d:"{tdØ}" | 0:"{pØ}" b:"{pbv}"), (4) stem vowel "o":0, (5) zero-mapped tags ("+N":0 "+Guess":0 "+N_39_vido":0), (6) continuation lexicon N_39VIDO.';
      continuationLexicon = 'N_39VIDO';
      paradigmType = '+N_39_vido';
      replMap = {
        type: 'vro_type_39_vido',
        rootSuffix: 'do',
        templates: analysis.forms.map(f => ({ tag: f.tag, template: f.surface }))
      };
    } else if (isLubaType) {
      pattern = '^([bdfghjklmnprstv]*)([aouõeiäöü])(d|g|b)a$';
      explanation = 'Võro Type 39 (+N_39_luba) stop gradation (b~0~p~pp, d~0~t~tt, g~0~k~kk) with singular stem vowel -a and plural stem vowel -õ.';
      lexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "a":0 "+N":0 "+Guess":0 "+N_39_luba":0 > N_39LUBA ;';
      lexcExplanation = 'One line of LexC regular-expression code describing lemma and stem: (1) consonant onset [b-v]*, (2) root vowel [a|o|u|õ], (3) stop gradation upper:lower morphophonemes (0:"{kØ}" g:"{kgØ}" | 0:"{tØ}" d:"{tdØ}" | 0:"{pØ}" b:"{pbv}"), (4) stem vowel "a":0, (5) zero-mapped tags ("+N":0 "+Guess":0 "+N_39_luba":0), (6) continuation lexicon N_39LUBA.';
      continuationLexicon = 'N_39LUBA';
      paradigmType = '+N_39_luba';
      replMap = {
        type: 'vro_type_39_luba',
        rootSuffix: 'ba',
        templates: analysis.forms.map(f => ({ tag: f.tag, template: f.surface }))
      };
    } else if (isLuguType) {
      pattern = '^([bdfghjklmnprstv]*)([aouõeiäöü])(d|g|b)u$';
      explanation = 'Võro Type 39 (+N_39_lugu) stop gradation (g~0~k~kk, d~0~t~tt, b~0~p~pp) with singular stem vowel -u and plural stem vowel -õ.';
      lexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "u":0 "+N":0 "+Guess":0 "+N_39_lugu":0 > N_39LUGU ;';
      lexcExplanation = 'One line of LexC regular-expression code describing lemma and stem: (1) consonant onset [b-v]*, (2) root vowel [a|o|u|õ], (3) stop gradation upper:lower morphophonemes (0:"{kØ}" g:"{kgØ}" | 0:"{tØ}" d:"{tdØ}" | 0:"{pØ}" b:"{pbv}"), (4) stem vowel "u":0, (5) zero-mapped tags ("+N":0 "+Guess":0 "+N_39_lugu":0), (6) continuation lexicon N_39LUGU.';
      continuationLexicon = 'N_39LUGU';
      paradigmType = '+N_39_lugu';
      replMap = {
        type: 'vro_type_39_lugu',
        rootSuffix: 'gu',
        templates: analysis.forms.map(f => ({ tag: f.tag, template: f.surface }))
      };
    } else if (isTaloType) {
      pattern = '^([bdfghjklmnprstv]*)([aouõeiäöü])(l|m|n|r|s)o$';
      explanation = 'Võro Type 40 (+N_40_talo) consonant lengthening (l~ll, m~mm, n~nn, r~rr, s~ss) with singular stem vowel -o and plural stem vowel -õ.';
      lexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] [0:"{0:0, 0:l}" l:l|0:"{0:0, 0:m}" m:m|0:"{0:0, 0:n}" n:n|0:"{0:0, 0:r}" r:r|0:"{0:0, 0:s}" s:s] "o":0 "+N":0 "+Guess":0 "+N_40_talo":0 > N_40TALO ;';
      lexcExplanation = 'One line of LexC regular-expression code describing lemma and stem: (1) consonant onset [b-v]*, (2) root vowel, (3) consonant lengthening (0:"{0:0, 0:l}" l:l | ...), (4) stem vowel "o":0, (5) zero-mapped tags ("+N":0 "+Guess":0 "+N_40_talo":0), (6) continuation lexicon N_40TALO.';
      continuationLexicon = 'N_40TALO';
      paradigmType = '+N_40_talo';
      replMap = {
        type: 'vro_type_40_talo',
        rootSuffix: 'lo',
        templates: analysis.forms.map(f => ({ tag: f.tag, template: f.surface }))
      };
    } else if (nomForm.endsWith('nd') && (genForm.includes('nn') || rawGen.includes('nn'))) {
      pattern = '^([a-zõäöüšž]+)nd$';
      const hasTwoVowelCols = analysis.morphophonemes && analysis.morphophonemes.length >= 6 &&
        analysis.morphophonemes.some(m => m.symbol.includes('o') && !m.symbol.includes('õ')) &&
        analysis.morphophonemes.some(m => m.symbol.includes('õ') && !m.symbol.includes('o'));

      const vowelPart = hasTwoVowelCols
        ? ' [0:"{0:0, 0:o}"] [0:"{0:0, 0:õ}"]'
        : ' 0:"{0oõ}"';

      lexcRegex = `< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] n [d:"{d:d, d:n}"]${vowelPart} "+N":0 "+Guess":0 "+N_41_kand":0 > N_41KAND ;`;

      lexcExplanation = hasTwoVowelCols
        ? 'One line of LexC regular-expression code describing lemma and stem: (1) consonant onset [b-v]*, (2) root vowel [a|e|i|o|u|õ|ä|ö|ü], (3) invariant nasal consonant n, (4) alternating stop d [d:"{d:d, d:n}"], (5) singular stem vowel alternation [0:"{0:0, 0:o}"], (6) plural stem vowel marker [0:"{0:0, 0:õ}"], (7) zero-mapped tags ("+N":0 "+Guess":0 "+N_41_kand":0), (8) continuation lexicon N_41KAND.'
        : 'One line of LexC regular-expression code describing lemma and stem: (1) consonant onset [b-v]*, (2) root vowel [a|e|i|o|u|õ|ä|ö|ü], (3) invariant nasal consonant n, (4) alternating stop d [d:"{d:d, d:n}"], (5) stem vowel alternation 0:"{0oõ}", (6) zero-mapped tags ("+N":0 "+Guess":0 "+N_41_kand":0), (7) continuation lexicon N_41KAND.';
      continuationLexicon = 'N_41KAND';
      paradigmType = '+N_41_kand';
      replMap = {
        rootSuffix: 'nd',
        weakCluster: 'nn',
        templates: analysis.forms.map(f => {
          let tmpl = (f.surface || '').replace(/[0-9FB#>.]/g, '').trim() || f.surface;
          if (tmpl.startsWith(nomForm.slice(0, -2))) {
            tmpl = '$1' + tmpl.slice(nomForm.length - 2);
          }
          return { tag: f.tag, template: tmpl };
        })
      };
    } else if (nomForm.endsWith('kk') && (genForm.includes('k') || rawGen.includes('k'))) {
      // Geminate stop k ~ kk (e.g. tükk ~ tükü [Type 41 / VES 37])
      const isTukkType = nomForm === 'tükk' || analysis.paradigmType === '+N_41_tuekk';
      pattern = '^([a-zõäöüšž]+)kk$';
      explanation = isTukkType
        ? 'Võro Type 41 / VES 37 (tükk) stems ending in geminate stop -kk with weak grade degemination -k- and stem vowel alternation.'
        : 'Stems ending in geminate stop -kk with weak grade degemination -k-';
      const cleanUpper = isTukkType ? '41_TUEKK' : (analysis.forms[0]?.lemma || 'Stem').toUpperCase().replace(/[^A-Z0-9_]/g, '');
      continuationLexicon = isTukkType ? 'N_41TUEKK' : (analysis.continuationLexicon || `N_${cleanUpper}`);
      paradigmType = isTukkType ? '+N_41_tuekk' : (analysis.paradigmType || `+N_${cleanUpper}`);
      lexcRegex = isTukkType
        ? '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] "kk":0 "+N":0 "+Guess":0 "+N_41_tuekk":0 > N_41TUEKK ;'
        : `< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü]* "kk":0 "+N":0 "+Guess":0 "+N_${cleanUpper}":0 > N_${cleanUpper} ;`;
      lexcExplanation = isTukkType
        ? 'LexC regular-expression description for Type 41 (tükk / VES 37): (1) consonant onset [b-v]*, (2) root vowels, (3) geminate "kk":0, (4) tags "+N":0 "+Guess":0 "+N_41_tuekk":0, (5) continuation lexicon N_41TUEKK.'
        : `LexC regular-expression description for ${cleanUpper}`;
      replMap = {
        rootSuffix: 'kk',
        weakCluster: 'k',
        templates: analysis.forms.map(f => {
          const s = (f.surface || '').replace(/[0-9FB#>.]/g, '').trim();
          return { tag: f.tag, template: s || f.surface };
        })
      };
    } else if (nomForm.endsWith('si') && (genForm.includes('de') || rawGen.includes('de'))) {
      // Finnish käsi ~ käden
      pattern = '^([a-zõäöüšž]+)si$';
      explanation = 'Stems ending in -si with weak grade -de- and partitive -t-';
      lexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü]* "si":0 "+N":0 "+Guess":0 "+N_KASI":0 > N_KASI ;';
      continuationLexicon = 'N_KASI';
      paradigmType = '+N_Kasi';
      replMap = {
        rootSuffix: 'si',
        weakCluster: 'de',
        templates: analysis.forms.map(f => {
          const s = (f.surface || '').replace(/[0-9FB#>.]/g, '').trim();
          return { tag: f.tag, template: s || f.surface };
        })
      };
    } else if (nomForm.endsWith('ki') && (genForm.includes('e') || rawGen.includes('e'))) {
      // Finnish mäki ~ mäen
      pattern = '^([a-zõäöüšž]+)ki$';
      explanation = 'Stems ending in -ki with weak grade deletion of -k-';
      lexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü]* "ki":0 "+N":0 "+Guess":0 "+N_MAKI":0 > N_MAKI ;';
      continuationLexicon = 'N_MAKI';
      paradigmType = '+N_Maki';
      replMap = {
        rootSuffix: 'ki',
        weakCluster: 'e',
        templates: analysis.forms.map(f => {
          const s = (f.surface || '').replace(/[0-9FB#>.]/g, '').trim();
          return { tag: f.tag, template: s || f.surface };
        })
      };
    } else {
      // Generic stem regex
      const commonPrefix = this.findLongestCommonPrefix(analysis.forms.map(f => f.surface));
      pattern = `^(${commonPrefix.slice(0, Math.max(1, commonPrefix.length - 1))}[a-zõäöüšž]*)$`;
      explanation = `General stem type matching shared prefix "${commonPrefix}"`;
      const modelUpper = (analysis.forms[0]?.lemma || 'Stem').toUpperCase().replace(/[^A-Z0-9_]/g, '');
      lexcRegex = `< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü]* "+N":0 "+Guess":0 "+N_${modelUpper}":0 > N_${modelUpper} ;`;
      lexcExplanation = `LexC regular-expression description for model ${analysis.forms[0]?.lemma || 'Stem'}`;
      continuationLexicon = `N_${modelUpper}`;
      paradigmType = `+N_${modelUpper}`;
      replMap = {
        rootSuffix: '',
        templates: analysis.forms.map(f => ({ tag: f.tag, template: f.surface }))
      };
    }

    return {
      pattern,
      explanation,
      lexcRegex,
      lexcExplanation,
      paradigmType,
      continuationLexicon,
      replacementRules: replMap
    };
  }

  /**
   * Helper: finds longest common prefix among strings.
   */
  findLongestCommonPrefix(strings) {
    if (!strings || strings.length === 0) return '';
    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (!strings[i].startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
    }
    return prefix;
  }

  /**
   * Parses an UralicNLP / GiellaLT morphological transducer guesser tag (e.g. "mind+N+Guess+N_41_haik+Pl+Gen" or "+N_41_haik")
   * into its linguistic constituents and determines the corresponding LangJack Two-Level model.
   *
   * @param {string} rawTag - The raw tag from the UralicNLP analyzer
   * @returns {Object|null} Parsed guesser information or null
   */
  parseUralicNlpGuesserTag(rawTag) {
    if (!rawTag || typeof rawTag !== 'string') return null;

    // Pattern 1: lemma+POS+Guess+POS_TYPE_MODEL+SLOT or lemma+POS+POS_TYPE_MODEL+SLOT
    const fullMatch = rawTag.match(/^([a-zõäöüšž'’]+)\+([A-Za-z]+)(?:\+Guess)?\+([A-Za-z]+)_(\d+)_([a-zõäöüšž]+)(?:\+([A-Za-z0-9+]+))?$/i);
    let lemma = '', pos = 'N', fullCode = '', typeNumber = 0, modelLemma = '', slot = '';

    if (fullMatch) {
      lemma = fullMatch[1];
      pos = fullMatch[2];
      fullCode = `${fullMatch[3]}_${fullMatch[4]}_${fullMatch[5]}`;
      typeNumber = parseInt(fullMatch[4], 10);
      modelLemma = fullMatch[5];
      slot = fullMatch[6] || '';
    } else {
      // Pattern 2: Embedded POS_TYPE_MODEL e.g. +Guess+N_41_haik or N_41_ask
      const embeddedMatch = rawTag.match(/(?:\+Guess)?\+?([A-Za-z]+)_(\d+)_([a-zõäöüšž]+)/i);
      if (embeddedMatch) {
        pos = embeddedMatch[1];
        fullCode = `${embeddedMatch[1]}_${embeddedMatch[2]}_${embeddedMatch[3]}`;
        typeNumber = parseInt(embeddedMatch[2], 10);
        modelLemma = embeddedMatch[3];
        const parts = rawTag.split('+');
        lemma = parts[0] || '';
        slot = parts.filter(p => !p.includes('_') && !['Guess', pos, lemma].includes(p)).join('+');
      } else {
        return null;
      }
    }

    // Determine corresponding LangJack model preset
    let langJackEquivalent = '';
    let langJackPresetId = '';
    if (typeNumber === 41) {
      langJackEquivalent = '+N_41_kand (VES Type 41)';
      langJackPresetId = 'vro_type_41_kand';
    } else if (typeNumber === 39) {
      langJackEquivalent = '+N_39_vido / +N_39_luba / +N_39_lugu (VES Type 39)';
      langJackPresetId = 'vro_type_39_vido';
    } else if (typeNumber === 40) {
      langJackEquivalent = '+N_40_talo (VES Type 40)';
      langJackPresetId = 'vro_type_40_talo';
    } else if (typeNumber === 44) {
      langJackEquivalent = '+N_44_tsiga (VES Type 44)';
      langJackPresetId = 'vro_type_44_tsiga';
    } else if (typeNumber === 1) {
      langJackEquivalent = '+N_1_kala (VES Type 1)';
      langJackPresetId = 'vro_type_1_kala';
    }

    return {
      rawTag,
      lemma,
      pos,
      isGuessed: true,
      fullCode,
      typeNumber,
      modelLemma,
      slot,
      fullGuessTag: `+${pos}_${typeNumber}_${modelLemma}`,
      langJackEquivalent,
      langJackPresetId,
      source: 'uralicnlp',
      distinctionNote: `The UralicNLP analyzer cataloges Type ${typeNumber} under model lemma "${modelLemma}" (+${pos}_${typeNumber}_${modelLemma}). In LangJack, Type ${typeNumber} was developed as "${langJackEquivalent}". Note: There is NO "+N_41_kand" in the UralicNLP analyzer.`
    };
  }

  /**
   * Classifies a new word (entered with or without tags) against saved paradigm types
   * and predicts its entire inflectional paradigm.
   */
  classifyNewWord(newWordInput, paradigmLibraryOrAnalyzer = [], langFilter = null, options = {}) {
    if (!newWordInput || (typeof newWordInput !== 'string' && !Array.isArray(newWordInput))) {
      return { matched: false, reason: 'Please enter one or more word forms to classify.' };
    }

    const isolateStem = options.isolateStem !== false;
    const classifierEngine = options.classifierEngine || 'combined'; // 'combined' | 'uralicnlp' | 'langjack'
    const analyzerData = (paradigmLibraryOrAnalyzer && !Array.isArray(paradigmLibraryOrAnalyzer))
      ? paradigmLibraryOrAnalyzer
      : (options.analyzerData || options.analyzerReadings || {});
    const customPresets = Array.isArray(paradigmLibraryOrAnalyzer)
      ? paradigmLibraryOrAnalyzer
      : (options.paradigmLibrary || []);

    // 1. Parse words from input: supports single word, comma-separated, newline-separated,
    // tab-separated (from TSV/CSV), or tagged forms ("tsiga+N+Sg+Nom: tsiga")
    let rawTokens = [];
    if (Array.isArray(newWordInput)) {
      rawTokens = newWordInput;
    } else {
      rawTokens = String(newWordInput).split(/[\r\n,;\t]+/).map(s => s.trim()).filter(Boolean);
    }

    const parsedTokens = rawTokens.map(t => {
      let part = String(t).trim();
      let hintTag = '';
      if (part.includes(':')) {
        const colonParts = part.split(':');
        hintTag = colonParts[0].trim();
        part = (colonParts[1] || colonParts[0]).trim();
      }
      if (isolateStem) {
        if (part.includes('#')) {
          const hashParts = part.split('#');
          part = hashParts[hashParts.length - 1].trim();
        } else if (part.includes('+Cmp')) {
          const cmpParts = part.split('+Cmp');
          part = cmpParts[cmpParts.length - 1].replace(/^[+#]/, '').trim();
        }
      }
      if (part.includes('+')) {
        const subParts = part.split('+').filter(Boolean);
        const nonGuess = subParts.filter(p => !/^«?\+?guess»?$/i.test(p) && !POS_TO_UPOS[p] && !/^[A-Z]_\d+/.test(p));
        part = nonGuess[0] || subParts[0] || part;
      }
      const cleanSurface = part.replace(/(?:^«?\+?guess»?\+?|«?\+?guess»?$|\+«?\+?guess»?\+)/gi, '').trim();
      return cleanSurface ? { surface: cleanSurface, tag: hintTag } : null;
    }).filter(Boolean);

    if (parsedTokens.length === 0) return { matched: false, reason: 'No valid word forms found.' };

    const firstWord = parsedTokens[0].surface.toLowerCase();
    const uniqueSurfaces = Array.from(new Set(parsedTokens.map(t => t.surface.toLowerCase())));

    // 2. Consonant Gradation & Morphological Alternation Detection across input forms
    let gradationDetected = false;
    const gradationTraits = [];

    for (let i = 0; i < uniqueSurfaces.length; i++) {
      for (let j = 0; j < uniqueSurfaces.length; j++) {
        if (i === j) continue;
        const w1 = uniqueSurfaces[i];
        const w2 = uniqueSurfaces[j];

        // Stop weakening (g -> 0 in tsia vs tsiga; d -> 0 in vio vs vido; b -> 0 in lua vs luba)
        const mG = w1.match(/^([bdfghjklmnprstv]*)([aouõeiäöü]+)g([aouõeiäöü]+)$/);
        if (mG && w2.startsWith(`${mG[1]}${mG[2]}${mG[3]}`)) {
          gradationDetected = true;
          gradationTraits.push(`stop weakening g → Ø in "${w2}" vs "${w1}"`);
        }
        const mD = w1.match(/^([bdfghjklmnprstv]*)([aouõeiäöü]+)d([aouõeiäöü]+)$/);
        if (mD && w2.startsWith(`${mD[1]}${mD[2]}${mD[3]}`)) {
          gradationDetected = true;
          gradationTraits.push(`stop weakening d → Ø in "${w2}" vs "${w1}"`);
        }
        const mB = w1.match(/^([bdfghjklmnprstv]*)([aouõeiäöü]+)b([aouõeiäöü]+)$/);
        if (mB && w2.startsWith(`${mB[1]}${mB[2]}${mB[3]}`)) {
          gradationDetected = true;
          gradationTraits.push(`stop weakening b → Ø in "${w2}" vs "${w1}"`);
        }

        // Consonant lengthening (l -> ll in tallo vs talo; m, n, r, s)
        const mCns = w1.match(/^([bdfghjklmnprstv]*)([aouõeiäöü]+)(l|m|n|r|s)([aouõeiäöü]+)$/);
        if (mCns && (w2.startsWith(`${mCns[1]}${mCns[2]}${mCns[3]}${mCns[3]}`))) {
          gradationDetected = true;
          gradationTraits.push(`consonant lengthening ${mCns[3]} → ${mCns[3]}${mCns[3]} in "${w2}" vs "${w1}"`);
        }

        // Stop alternation/strengthening (g ~ k/kk, d ~ t/tt, b ~ p/pp)
        if (mG && (w2.includes(`${mG[1]}${mG[2]}k`) || w2.includes(`${mG[1]}${mG[2]}kk`))) {
          gradationDetected = true;
          gradationTraits.push(`stop alternation g ~ k/kk in "${w1}" vs "${w2}"`);
        }
        if (mD && (w2.includes(`${mD[1]}${mD[2]}t`) || w2.includes(`${mD[1]}${mD[2]}tt`))) {
          gradationDetected = true;
          gradationTraits.push(`stop alternation d ~ t/tt in "${w1}" vs "${w2}"`);
        }
        if (mB && (w2.includes(`${mB[1]}${mB[2]}p`) || w2.includes(`${mB[1]}${mB[2]}pp`))) {
          gradationDetected = true;
          gradationTraits.push(`stop alternation b ~ p/pp in "${w1}" vs "${w2}"`);
        }

        // nd -> nn cluster assimilation (kand vs kanno)
        if (w1.endsWith('nd') && w2.includes('nn')) {
          gradationDetected = true;
          gradationTraits.push(`nasal cluster assimilation nd → nn in "${w2}" vs "${w1}"`);
        }

        // kk -> k degemination (tükk vs tükü)
        if (w1.endsWith('kk') && (w2.endsWith('kü') || w2.endsWith('ku') || w2.endsWith('ko') || w2.includes('ken'))) {
          gradationDetected = true;
          gradationTraits.push(`stop degemination kk → k in "${w2}" vs "${w1}"`);
        }
      }
    }

    let allKnown = [...this.defaultPresets, ...(this.savedParadigms || []), ...customPresets];
    if (langFilter) {
      const matchLang = allKnown.filter(p => p.lang === langFilter);
      const otherLang = allKnown.filter(p => p.lang !== langFilter);
      allKnown = [...matchLang, ...otherLang];
    }

    const cnsPattern = '([bdfghjklmnprstv]*)';
    const vowPattern = '([aouõeiäöü])';

    // 3. Test each candidate paradigm against all supplied input tokens
    const candidates = [];

    for (const preset of allKnown) {
      const presetForms = this.parseInputForms(preset.text);
      const analysis = this.alignParadigm(presetForms);
      const regexInfo = this.deriveStemRegex(analysis);

      const matchedItems = [];
      let candidateLemma = null;
      let rootGroup = null;
      let eliminated = false;
      let eliminationReason = '';

      // Check Type 1 Ungradated Vowel Stems Constraint:
      // If ANY sign of consonant gradation is attested across forms, Type 1 is strictly eliminated!
      if (preset.id === 'vro_type_1_kala' || preset.paradigmType === '+N_1_kala') {
        if (gradationDetected) {
          eliminated = true;
          eliminationReason = `Eliminated: Supplied forms exhibit consonant gradation (${Array.from(new Set(gradationTraits)).join('; ')}), which rules out ungradated Type 1 (kala).`;
        }
      }

      for (const tokObj of parsedTokens) {
        const w = tokObj.surface.toLowerCase();

        // 3a. Type 1 Ungradated Vowel Stem (vro_type_1_kala)
        if (preset.id === 'vro_type_1_kala' || preset.paradigmType === '+N_1_kala') {
          if (/(?:tt|kk|pp)[aä]$/.test(w)) {
            // Geminate stops before vowel indicate strong grade of gradating paradigms, not ungradated Type 1
          } else if (/[aä]$/.test(w)) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -1);
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('n') && /[aä]n$/.test(w)) {
            const lemma = w.slice(0, -1);
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = lemma.slice(0, -1);
            matchedItems.push({ word: w, slot: 'Pl+Ine', tag: `${lemma}+N+Pl+Ine`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3b. Type 44 Stop Gradation with stem vowel -a, plural -o (vro_type_44_tsiga)
        if (preset.id === 'vro_type_44_tsiga' || preset.paradigmType === '+N_44_tsiga') {
          const ill = w.match(new RegExp(`^${cnsPattern}${vowPattern}(tt|kk|pp)a$`));
          if (ill) {
            const gem = ill[3];
            const stop = gem === 'kk' ? 'g' : (gem === 'pp' ? 'b' : 'd');
            const lemma = `${ill[1]}${ill[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${ill[1]}${ill[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Ill', tag: `${lemma}+N+Sg+Ill`, lemma, root: rootGroup });
            continue;
          }
          const par = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)a$`));
          if (par) {
            const single = par[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${par[1]}${par[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${par[1]}${par[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          const nom = w.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)a$`));
          if (nom) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${nom[1]}${nom[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          const gen = w.match(new RegExp(`^${cnsPattern}${vowPattern}a$`));
          if (gen && !/(?:[dgbtkp]|tt|kk|pp)a$/.test(w)) {
            const lemma = `${gen[1]}${gen[2]}ga`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${gen[1]}${gen[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Gen', tag: `${lemma}+N+Sg+Gen`, lemma, root: rootGroup });
            continue;
          }
          const plIll = w.match(new RegExp(`^${cnsPattern}${vowPattern}(tt|kk|pp)ohe$`));
          if (plIll) {
            const gem = plIll[3];
            const stop = gem === 'kk' ? 'g' : (gem === 'pp' ? 'b' : 'd');
            const lemma = `${plIll[1]}${plIll[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plIll[1]}${plIll[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Ill', tag: `${lemma}+N+Pl+Ill`, lemma, root: rootGroup });
            continue;
          }
          const plIne = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)on$`));
          if (plIne) {
            const single = plIne[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${plIne[1]}${plIne[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plIne[1]}${plIne[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Ine', tag: `${lemma}+N+Pl+Ine`, lemma, root: rootGroup });
            continue;
          }
          const plGen = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)o$`));
          if (plGen) {
            const single = plGen[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${plGen[1]}${plGen[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plGen[1]}${plGen[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Gen', tag: `${lemma}+N+Pl+Gen`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3c. Type 39 Stop Gradation with stem vowel -o (vro_type_39_vido)
        if (preset.id === 'vro_type_39_vido' || preset.paradigmType === '+N_39_vido') {
          const ill = w.match(new RegExp(`^${cnsPattern}${vowPattern}(tt|kk|pp)o$`));
          if (ill) {
            const gem = ill[3];
            const stop = gem === 'kk' ? 'g' : (gem === 'pp' ? 'b' : 'd');
            const lemma = `${ill[1]}${ill[2]}${stop}o`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${ill[1]}${ill[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Ill', tag: `${lemma}+N+Sg+Ill`, lemma, root: rootGroup });
            continue;
          }
          const par = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)o$`));
          if (par) {
            const single = par[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${par[1]}${par[2]}${stop}o`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${par[1]}${par[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          const nom = w.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)o$`));
          if (nom) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${nom[1]}${nom[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          const gen = w.match(new RegExp(`^${cnsPattern}${vowPattern}o$`));
          if (gen && !/(?:[dgbtkp]|tt|kk|pp)o$/.test(w)) {
            const lemma = `${gen[1]}${gen[2]}do`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${gen[1]}${gen[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Gen', tag: `${lemma}+N+Sg+Gen`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3d. Type 39 Stop Gradation with stem vowel -a, plural -õ (vro_type_39_luba)
        if (preset.id === 'vro_type_39_luba' || preset.paradigmType === '+N_39_luba') {
          const ill = w.match(new RegExp(`^${cnsPattern}${vowPattern}(tt|kk|pp)a$`));
          if (ill) {
            const gem = ill[3];
            const stop = gem === 'kk' ? 'g' : (gem === 'pp' ? 'b' : 'd');
            const lemma = `${ill[1]}${ill[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${ill[1]}${ill[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Ill', tag: `${lemma}+N+Sg+Ill`, lemma, root: rootGroup });
            continue;
          }
          const par = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)a$`));
          if (par) {
            const single = par[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${par[1]}${par[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${par[1]}${par[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          const nom = w.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)a$`));
          if (nom) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${nom[1]}${nom[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          const gen = w.match(new RegExp(`^${cnsPattern}${vowPattern}a$`));
          if (gen && !/(?:[dgbtkp]|tt|kk|pp)a$/.test(w)) {
            const lemma = `${gen[1]}${gen[2]}ba`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${gen[1]}${gen[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Gen', tag: `${lemma}+N+Sg+Gen`, lemma, root: rootGroup });
            continue;
          }
          const plGen = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)õ$`));
          if (plGen) {
            const single = plGen[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${plGen[1]}${plGen[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plGen[1]}${plGen[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Gen', tag: `${lemma}+N+Pl+Gen`, lemma, root: rootGroup });
            continue;
          }
          const plIll = w.match(new RegExp(`^${cnsPattern}${vowPattern}(tt|kk|pp)õhe$`));
          if (plIll) {
            const gem = plIll[3];
            const stop = gem === 'kk' ? 'g' : (gem === 'pp' ? 'b' : 'd');
            const lemma = `${plIll[1]}${plIll[2]}${stop}a`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plIll[1]}${plIll[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Ill', tag: `${lemma}+N+Pl+Ill`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3e. Type 39 Stop Gradation with stem vowel -u, plural -õ (vro_type_39_lugu)
        if (preset.id === 'vro_type_39_lugu' || preset.paradigmType === '+N_39_lugu') {
          const ill = w.match(new RegExp(`^${cnsPattern}${vowPattern}(tt|kk|pp)u$`));
          if (ill) {
            const gem = ill[3];
            const stop = gem === 'kk' ? 'g' : (gem === 'pp' ? 'b' : 'd');
            const lemma = `${ill[1]}${ill[2]}${stop}u`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${ill[1]}${ill[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Ill', tag: `${lemma}+N+Sg+Ill`, lemma, root: rootGroup });
            continue;
          }
          const par = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)u$`));
          if (par) {
            const single = par[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${par[1]}${par[2]}${stop}u`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${par[1]}${par[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          const nom = w.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)u$`));
          if (nom) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${nom[1]}${nom[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          const gen = w.match(new RegExp(`^${cnsPattern}${vowPattern}u$`));
          if (gen && !/(?:[dgbtkp]|tt|kk|pp)u$/.test(w)) {
            const lemma = `${gen[1]}${gen[2]}gu`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${gen[1]}${gen[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Gen', tag: `${lemma}+N+Sg+Gen`, lemma, root: rootGroup });
            continue;
          }
          const plGen = w.match(new RegExp(`^${cnsPattern}${vowPattern}(t|k|p)õ$`));
          if (plGen) {
            const single = plGen[3];
            const stop = single === 'k' ? 'g' : (single === 'p' ? 'b' : 'd');
            const lemma = `${plGen[1]}${plGen[2]}${stop}u`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plGen[1]}${plGen[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Gen', tag: `${lemma}+N+Pl+Gen`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3f. Type 40 Consonant Lengthening (vro_type_40_talo)
        if (preset.id === 'vro_type_40_talo' || preset.paradigmType === '+N_40_talo') {
          const par = w.match(new RegExp(`^${cnsPattern}${vowPattern}(ll|mm|nn|rr|ss)o$`));
          if (par) {
            const gem = par[3];
            const single = gem[0];
            const lemma = `${par[1]}${par[2]}${single}o`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${par[1]}${par[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          const plGen = w.match(new RegExp(`^${cnsPattern}${vowPattern}(ll|mm|nn|rr|ss)õ$`));
          if (plGen) {
            const gem = plGen[3];
            const single = gem[0];
            const lemma = `${plGen[1]}${plGen[2]}${single}o`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plGen[1]}${plGen[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Gen', tag: `${lemma}+N+Pl+Gen`, lemma, root: rootGroup });
            continue;
          }
          const plIll = w.match(new RegExp(`^${cnsPattern}${vowPattern}(ll|mm|nn|rr|ss)õhe$`));
          if (plIll) {
            const gem = plIll[3];
            const single = gem[0];
            const lemma = `${plIll[1]}${plIll[2]}${single}o`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plIll[1]}${plIll[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Ill', tag: `${lemma}+N+Pl+Ill`, lemma, root: rootGroup });
            continue;
          }
          const plIne = w.match(new RegExp(`^${cnsPattern}${vowPattern}(l|m|n|r|s)õn$`));
          if (plIne) {
            const single = plIne[3];
            const lemma = `${plIne[1]}${plIne[2]}${single}o`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${plIne[1]}${plIne[2]}`;
            matchedItems.push({ word: w, slot: 'Pl+Ine', tag: `${lemma}+N+Pl+Ine`, lemma, root: rootGroup });
            continue;
          }
          const nom = w.match(new RegExp(`^${cnsPattern}${vowPattern}(l|m|n|r|s)o$`));
          if (nom) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = `${nom[1]}${nom[2]}`;
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3g. Type 41 Consonant Gradation (vro_type_41_kand)
        if (preset.id === 'vro_type_41_kand' || preset.paradigmType === '+N_41_kand') {
          if (w.endsWith('nd')) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -2);
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('nno')) {
            const lemma = w.slice(0, -3) + 'nd';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -3);
            matchedItems.push({ word: w, slot: 'Sg+Gen', tag: `${lemma}+N+Sg+Gen`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('ndo')) {
            const lemma = w.slice(0, -3) + 'nd';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -3);
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('ndõ')) {
            const lemma = w.slice(0, -3) + 'nd';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -3);
            matchedItems.push({ word: w, slot: 'Pl+Gen', tag: `${lemma}+N+Pl+Gen`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('nnõn')) {
            const lemma = w.slice(0, -4) + 'nd';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -4);
            matchedItems.push({ word: w, slot: 'Pl+Ine', tag: `${lemma}+N+Pl+Ine`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3h. Type 41 Geminate Stop Degemination (vro_type_41_tuekk)
        if (preset.id === 'vro_type_41_tuekk' || preset.paradigmType === '+N_41_tuekk') {
          if (w.endsWith('kk')) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -2);
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('kü') || w.endsWith('ku') || w.endsWith('ko')) {
            const lemma = w.slice(0, -2) + 'kk';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -2);
            matchedItems.push({ word: w, slot: 'Sg+Gen', tag: `${lemma}+N+Sg+Gen`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('kkü') || w.endsWith('kku') || w.endsWith('kko')) {
            const lemma = w.slice(0, -3) + 'kk';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -3);
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('kke') || w.endsWith('kkä') || w.endsWith('kko')) {
            const lemma = w.slice(0, -3) + 'kk';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -3);
            matchedItems.push({ word: w, slot: 'Pl+Gen', tag: `${lemma}+N+Pl+Gen`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('ken') || w.endsWith('kän')) {
            const lemma = w.slice(0, -3) + 'kk';
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = w.slice(0, -3);
            matchedItems.push({ word: w, slot: 'Pl+Ine', tag: `${lemma}+N+Pl+Ine`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3i. Livonian Presets
        if (preset.id === 'liv_type_1_kozon' || preset.paradigmType === '+N_1_kozon') {
          if (w.endsWith('ond')) {
            const lemma = w.slice(0, -1);
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = lemma;
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('ondi')) {
            const lemma = w.slice(0, -2);
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = lemma;
            matchedItems.push({ word: w, slot: 'Pl+Par', tag: `${lemma}+N+Pl+Par`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('on') || w.endsWith('õn') || w.endsWith('an') || w.endsWith('en') || w.endsWith('in')) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = lemma;
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
        }

        if (preset.id === 'liv_type_2_led' || preset.paradigmType === '+N_led') {
          if (w.includes('’') || w.includes("'")) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = lemma.slice(0, -2);
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('ḑ') && !w.includes('’') && !w.includes("'")) {
            const root = w.slice(0, -1);
            const lemma = `${root}’ḑ`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = root;
            matchedItems.push({ word: w, slot: 'Sg+Gen', tag: `${lemma}+N+Sg+Gen`, lemma, root: rootGroup });
            continue;
          }
          if (w.endsWith('dda') || w.endsWith('tta')) {
            const root = w.slice(0, -3);
            const lemma = `${root}’ḑ`;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = root;
            matchedItems.push({ word: w, slot: 'Sg+Par', tag: `${lemma}+N+Sg+Par`, lemma, root: rootGroup });
            continue;
          }
        }

        // 3j. General regex match against nominative base
        if (regexInfo.pattern) {
          const re = new RegExp(regexInfo.pattern, 'i');
          const m = w.match(re);
          if (m) {
            const lemma = w;
            if (!candidateLemma) candidateLemma = lemma;
            rootGroup = m[1];
            matchedItems.push({ word: w, slot: 'Sg+Nom', tag: `${lemma}+N+Sg+Nom`, lemma, root: rootGroup });
            continue;
          }
        }
      }

      if (matchedItems.length === 0 && !eliminated) continue;

      const isConsistent = matchedItems.every(m => m.lemma === candidateLemma);

      // Check specific stop or stem vowel mismatches to set informative elimination reasons
      if (!eliminated && matchedItems.length < parsedTokens.length && parsedTokens.length > 1) {
        if (preset.id === 'vro_type_39_vido' && uniqueSurfaces.some(s => s.endsWith('a') || s.endsWith('u'))) {
          eliminated = true;
          eliminationReason = `Eliminated: Stems exhibit stem vowel -a or -u, incompatible with Type 39 vido stem vowel -o.`;
        } else if (preset.id === 'vro_type_39_luba' && uniqueSurfaces.some(s => s.includes('k') || s.includes('g'))) {
          eliminated = true;
          eliminationReason = `Eliminated: Stems exhibit velar stop alternation (g/k), incompatible with Type 39 luba labial stop (b/p).`;
        } else if (preset.id === 'vro_type_39_lugu' && uniqueSurfaces.some(s => s.endsWith('a') || s.endsWith('o'))) {
          eliminated = true;
          eliminationReason = `Eliminated: Stems exhibit stem vowel -a or -o, incompatible with Type 39 lugu stem vowel -u.`;
        } else if (preset.id === 'vro_type_40_talo' && uniqueSurfaces.some(s => s.includes('g') || s.includes('k') || s.includes('p') || s.includes('b'))) {
          eliminated = true;
          eliminationReason = `Eliminated: Stems exhibit plosive stop alternation, incompatible with Type 40 talo sonorant lengthening.`;
        }
      }

      // Generate full predicted paradigm for candidateLemma
      const predictedForms = [];
      if ((preset.id === 'vro_type_1_kala' || preset.paradigmType === '+N_1_kala') && candidateLemma) {
        const root = candidateLemma.slice(0, -1);
        const lastC = root.slice(-1);
        const origTags = (analysis.forms && analysis.forms.length >= 6) ? analysis.forms.map(f => f.tag) : [
          'kala+N+Sg+Nom', 'kala+N+Sg+Gen', 'kala+N+Sg+Par', 'kala+N+Sg+Ill', 'kala+N+Pl+Gen', 'kala+N+Pl+Ine'
        ];
        predictedForms.push(
          { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'kala' },
          { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: candidateLemma, originalModelSurface: 'kala' },
          { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${root}${lastC}a`, originalModelSurface: 'kalla' },
          { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Sg+Ill`, predictedSurface: `${candidateLemma}lõ`, originalModelSurface: 'kalalõ' },
          { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${root}${lastC}õ`, originalModelSurface: 'kallõ' },
          { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Ine`, predictedSurface: `${candidateLemma}n`, originalModelSurface: 'kalon' }
        );
      } else if ((preset.id === 'vro_type_39_vido' || preset.paradigmType === '+N_39_vido') && candidateLemma) {
        const lm = candidateLemma.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)o$`));
        if (lm) {
          const c = lm[1], v = lm[2], s = lm[3];
          const single = s === 'g' ? 'k' : (s === 'b' ? 'p' : 't');
          const gem = s === 'g' ? 'kk' : (s === 'b' ? 'pp' : 'tt');
          const origTags = (analysis.forms && analysis.forms.length >= 4) ? analysis.forms.map(f => f.tag) : [
            'vido+N+Sg+Nom', 'vido+N+Sg+Gen', 'vido+N+Sg+Par', 'vido+N+Sg+Ill'
          ];
          predictedForms.push(
            { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'vido' },
            { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: `${c}${v}o`, originalModelSurface: 'vio' },
            { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${c}${v}${single}o`, originalModelSurface: 'vito' },
            { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Sg+Ill`, predictedSurface: `${c}${v}${gem}o`, originalModelSurface: 'vitto' }
          );
        }
      } else if ((preset.id === 'vro_type_39_luba' || preset.paradigmType === '+N_39_luba') && candidateLemma) {
        const lm = candidateLemma.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)a$`));
        if (lm) {
          const c = lm[1], v = lm[2], s = lm[3];
          const single = s === 'g' ? 'k' : (s === 'b' ? 'p' : 't');
          const gem = s === 'g' ? 'kk' : (s === 'b' ? 'pp' : 'tt');
          const origTags = (analysis.forms && analysis.forms.length >= 6) ? analysis.forms.map(f => f.tag) : [
            'luba+N+Sg+Nom', 'luba+N+Sg+Gen', 'luba+N+Sg+Par', 'luba+N+Sg+Ill', 'luba+N+Pl+Gen', 'luba+N+Pl+Ill'
          ];
          predictedForms.push(
            { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'luba' },
            { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: `${c}${v}a`, originalModelSurface: 'lua' },
            { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${c}${v}${single}a`, originalModelSurface: 'lupa' },
            { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Sg+Ill`, predictedSurface: `${c}${v}${gem}a`, originalModelSurface: 'luppa' },
            { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${c}${v}${single}õ`, originalModelSurface: 'lupõ' },
            { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Ill`, predictedSurface: `${c}${v}${gem}õhe`, originalModelSurface: 'luppõhe' }
          );
        }
      } else if ((preset.id === 'vro_type_39_lugu' || preset.paradigmType === '+N_39_lugu') && candidateLemma) {
        const lm = candidateLemma.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)u$`));
        if (lm) {
          const c = lm[1], v = lm[2], s = lm[3];
          const single = s === 'g' ? 'k' : (s === 'b' ? 'p' : 't');
          const gem = s === 'g' ? 'kk' : (s === 'b' ? 'pp' : 'tt');
          const origTags = (analysis.forms && analysis.forms.length >= 6) ? analysis.forms.map(f => f.tag) : [
            'lugu+N+Sg+Nom', 'lugu+N+Sg+Gen', 'lugu+N+Sg+Par', 'lugu+N+Sg+Ill', 'lugu+N+Pl+Gen', 'lugu+N+Pl+Ill'
          ];
          predictedForms.push(
            { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'lugu' },
            { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: `${c}${v}u`, originalModelSurface: 'luu' },
            { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${c}${v}${single}u`, originalModelSurface: 'luku' },
            { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Sg+Ill`, predictedSurface: `${c}${v}${gem}u`, originalModelSurface: 'lukku' },
            { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${c}${v}${single}õ`, originalModelSurface: 'lukõ' },
            { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Ill`, predictedSurface: `${c}${v}${gem}õhe`, originalModelSurface: 'lukkõhe' }
          );
        }
      } else if ((preset.id === 'vro_type_44_tsiga' || preset.paradigmType === '+N_44_tsiga') && candidateLemma) {
        const lm = candidateLemma.match(new RegExp(`^${cnsPattern}${vowPattern}(d|g|b)a$`));
        if (lm) {
          const c = lm[1], v = lm[2], s = lm[3];
          const single = s === 'g' ? 'k' : (s === 'b' ? 'p' : 't');
          const gem = s === 'g' ? 'kk' : (s === 'b' ? 'pp' : 'tt');
          const origTags = (analysis.forms && analysis.forms.length >= 7) ? analysis.forms.map(f => f.tag) : [
            'tsiga+N+Sg+Nom', 'tsiga+N+Sg+Gen', 'tsiga+N+Sg+Par', 'tsiga+N+Sg+Ill', 'tsiga+N+Pl+Gen', 'tsiga+N+Pl+Ill', 'tsiga+N+Pl+Ine'
          ];
          predictedForms.push(
            { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'tsiga' },
            { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: `${c}${v}a`, originalModelSurface: 'tsia' },
            { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${c}${v}${single}a`, originalModelSurface: 'tsika' },
            { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Sg+Ill`, predictedSurface: `${c}${v}${gem}a`, originalModelSurface: 'tsikka' },
            { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${c}${v}${single}o`, originalModelSurface: 'tsiko' },
            { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Ill`, predictedSurface: `${c}${v}${gem}ohe`, originalModelSurface: 'tsikkohe' },
            { tag: origTags[6], reconstructedTag: `${candidateLemma}+N+Pl+Ine`, predictedSurface: `${c}${v}${single}on`, originalModelSurface: 'tsikon' }
          );
        }
      } else if ((preset.id === 'vro_type_40_talo' || preset.paradigmType === '+N_40_talo') && candidateLemma) {
        const lm = candidateLemma.match(new RegExp(`^${cnsPattern}${vowPattern}(l|m|n|r|s)o$`));
        if (lm) {
          const c = lm[1], v = lm[2], s = lm[3];
          const gem = `${s}${s}`;
          const origTags = (analysis.forms && analysis.forms.length >= 6) ? analysis.forms.map(f => f.tag) : [
            'talo+N+Sg+Nom', 'talo+N+Sg+Gen', 'talo+N+Sg+Par', 'talo+N+Pl+Gen', 'talo+N+Pl+Ill', 'talo+N+Pl+Ine'
          ];
          predictedForms.push(
            { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'talo' },
            { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: candidateLemma, originalModelSurface: 'talo' },
            { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${c}${v}${gem}o`, originalModelSurface: 'tallo' },
            { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${c}${v}${gem}õ`, originalModelSurface: 'tallõ' },
            { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Ill`, predictedSurface: `${c}${v}${gem}õhe`, originalModelSurface: 'tallõhe' },
            { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Ine`, predictedSurface: `${c}${v}${s}õn`, originalModelSurface: 'talõn' }
          );
        }
      } else if ((preset.id === 'vro_type_41_kand' || preset.paradigmType === '+N_41_kand') && candidateLemma) {
        const root = candidateLemma.endsWith('nd') ? candidateLemma.slice(0, -2) : candidateLemma;
        const origTags = (analysis.forms && analysis.forms.length >= 5) ? analysis.forms.map(f => f.tag) : [
          'kand+N+Sg+Nom', 'kand+N+Sg+Gen', 'kand+N+Sg+Par', 'kand+N+Pl+Gen', 'kand+N+Pl+Ine'
        ];
        predictedForms.push(
          { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'kand' },
          { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: `${root}nno`, originalModelSurface: 'kanno' },
          { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${root}ndo`, originalModelSurface: 'kando' },
          { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${root}ndõ`, originalModelSurface: 'kandõ' },
          { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Ine`, predictedSurface: `${root}nnõn`, originalModelSurface: 'kannõn' }
        );
      } else if ((preset.id === 'vro_type_41_tuekk' || preset.paradigmType === '+N_41_tuekk') && candidateLemma) {
        const root = candidateLemma.endsWith('kk') ? candidateLemma.slice(0, -2) : candidateLemma;
        const origTags = (analysis.forms && analysis.forms.length >= 6) ? analysis.forms.map(f => f.tag) : [
          'tükk+N+Sg+Nom', 'tükk+N+Sg+Gen', 'tükk+N+Sg+Par', 'tükk+N+Sg+Ill', 'tükk+N+Pl+Gen', 'tükk+N+Pl+Ine'
        ];
        predictedForms.push(
          { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'tükk' },
          { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: `${root}kü`, originalModelSurface: 'tükü' },
          { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${root}kkü`, originalModelSurface: 'tükkü' },
          { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Sg+Ill`, predictedSurface: `${root}kkü`, originalModelSurface: 'tükkü' },
          { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${root}kke`, originalModelSurface: 'tükke' },
          { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Ine`, predictedSurface: `${root}ken`, originalModelSurface: 'tüken' }
        );
      } else if ((preset.id === 'liv_type_1_kozon' || preset.paradigmType === '+N_1_kozon') && candidateLemma) {
        const origTags = (analysis.forms && analysis.forms.length >= 6) ? analysis.forms.map(f => f.tag) : [
          'kõzon+N+Sg+Nom', 'kõzon+N+Sg+Gen', 'kõzon+N+Sg+Par', 'kõzon+N+Pl+Nom', 'kõzon+N+Pl+Gen', 'kõzon+N+Pl+Par'
        ];
        predictedForms.push(
          { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'kõzon' },
          { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: candidateLemma, originalModelSurface: 'kõzon' },
          { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${candidateLemma}d`, originalModelSurface: 'kõzond' },
          { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Pl+Nom`, predictedSurface: `${candidateLemma}d`, originalModelSurface: 'kõzond' },
          { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${candidateLemma}d`, originalModelSurface: 'kõzond' },
          { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Par`, predictedSurface: `${candidateLemma}di`, originalModelSurface: 'kõzondi' }
        );
      } else if ((preset.id === 'liv_type_2_led' || preset.paradigmType === '+N_led') && candidateLemma) {
        const plain = candidateLemma.replace(/['’]/g, '');
        const plainRoot = plain.slice(0, -1);
        const origTags = (analysis.forms && analysis.forms.length >= 6) ? analysis.forms.map(f => f.tag) : [
          'le’ḑ+N+Sg+Nom', 'leḑ+N+Sg+Gen', 'ledda+N+Sg+Par', 'leḑõd+N+Pl+Nom', 'leḑõd+N+Pl+Gen', 'leḑḑi+N+Pl+Par'
        ];
        predictedForms.push(
          { tag: origTags[0], reconstructedTag: `${candidateLemma}+N+Sg+Nom`, predictedSurface: candidateLemma, originalModelSurface: 'le’ḑ' },
          { tag: origTags[1], reconstructedTag: `${candidateLemma}+N+Sg+Gen`, predictedSurface: plain, originalModelSurface: 'leḑ' },
          { tag: origTags[2], reconstructedTag: `${candidateLemma}+N+Sg+Par`, predictedSurface: `${plainRoot}dda`, originalModelSurface: 'ledda' },
          { tag: origTags[3], reconstructedTag: `${candidateLemma}+N+Pl+Nom`, predictedSurface: `${plain}õd`, originalModelSurface: 'leḑõd' },
          { tag: origTags[4], reconstructedTag: `${candidateLemma}+N+Pl+Gen`, predictedSurface: `${plain}õd`, originalModelSurface: 'leḑõd' },
          { tag: origTags[5], reconstructedTag: `${candidateLemma}+N+Pl+Par`, predictedSurface: `${plainRoot}ḑḑi`, originalModelSurface: 'leḑḑi' }
        );
      } else {
        const rawNomBase = analysis.forms[0]?.surface || '';
        const nomBase = rawNomBase.replace(/[0-9FB#>.]/g, '').trim() || rawNomBase;
        analysis.forms.forEach(origForm => {
          let predSurface = '';
          const rawOrig = origForm.surface || '';
          const origClean = rawOrig.replace(/[0-9FB#>.]/g, '').trim() || rawOrig;

          if (regexInfo.replacementRules.rootSuffix && nomBase.endsWith(regexInfo.replacementRules.rootSuffix)) {
            const stemAffix = origClean.slice(nomBase.length - regexInfo.replacementRules.rootSuffix.length);
            predSurface = rootGroup + stemAffix;
          } else {
            predSurface = rootGroup + origClean.slice(nomBase.length);
          }

          predictedForms.push({
            tag: origForm.tag,
            reconstructedTag: origForm.tag.replace(/^[^:+]+/, candidateLemma),
            predictedSurface: predSurface,
            originalModelSurface: origForm.surface
          });
        });
      }

      candidates.push({
        preset,
        reconstructedLemma: candidateLemma,
        rootGroup: rootGroup || candidateLemma,
        matchedTokens: matchedItems,
        matchedCount: matchedItems.length,
        totalCount: parsedTokens.length,
        ratio: matchedItems.length / parsedTokens.length,
        isConsistent,
        eliminated,
        eliminationReason,
        regexInfo,
        predictedForms
      });
    }

    if (candidates.length === 0) {
      return {
        matched: false,
        reason: `Word "${firstWord}" does not match any current paradigm regex. Add a new paradigm model or adjust regex.`
      };
    }

    // Sort candidates:
    // 1. Non-eliminated first
    // 2. Most forms matched
    // 3. Consistent lemma
    // 4. Language filter match
    candidates.sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (b.isConsistent !== a.isConsistent) return b.isConsistent ? 1 : -1;
      if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
      if (langFilter) {
        const aLang = a.preset.lang === langFilter ? 1 : 0;
        const bLang = b.preset.lang === langFilter ? 1 : 0;
        if (bLang !== aLang) return bLang - aLang;
      }
      return 0;
    });

    const bestMatch = candidates[0];
    const matchedSlot = bestMatch.matchedTokens[0]?.slot || 'Sg+Nom';
    const predictedTag = bestMatch.matchedTokens[0]?.tag || `${bestMatch.reconstructedLemma}+N+${matchedSlot}`;
    const matchedCount = bestMatch.matchedCount;
    const totalInputCount = parsedTokens.length;

    // 4. Step-by-Step Disambiguation & Narrowing Walkthrough
    const disambiguationSteps = [];
    const form1 = parsedTokens[0]?.surface || '';
    const form2 = parsedTokens[1]?.surface || '';
    const form3 = parsedTokens[2]?.surface || '';

    // Step 1: Form 1
    if (/[aouõeiäöü]$/.test(form1)) {
      disambiguationSteps.push(`• Form 1 ("${form1}"): Ends in a stem vowel. Fits both ungradated noun patterns (Type 1 kala) and gradated patterns (Type 44 tsiga, Type 39, Type 40).`);
    } else {
      disambiguationSteps.push(`• Form 1 ("${form1}"): Evaluated against nominal base patterns.`);
    }

    // Step 2: Form 2
    if (form2) {
      if (gradationDetected) {
        disambiguationSteps.push(`• Form 2 ("${form2}"): Exhibits consonant gradation (${gradationTraits[0] || 'stem alternation'}), which strictly eliminates ungradated Type 1 (kala). Candidate space narrowed to gradating types.`);
      } else if (form1.toLowerCase() === form2.toLowerCase()) {
        disambiguationSteps.push(`• Form 2 ("${form2}"): Identical to Form 1 without consonant alternation, eliminating gradating types and selecting ungradated Type 1 (kala).`);
      } else {
        disambiguationSteps.push(`• Form 2 ("${form2}"): Provides inflectional constraint to refine candidate stem vowel and grade.`);
      }
    }

    // Step 3: Form 3
    if (form3) {
      if (form3.includes('k') && bestMatch.preset.id === 'vro_type_44_tsiga') {
        disambiguationSteps.push(`• Form 3 ("${form3}"): Confirms velar stop alternation (g ~ 0 ~ k ~ kk) with stem vowel -a and plural -o, eliminating Type 39 (luba, vido) and uniquely isolating Type 44 (+N_44_tsiga).`);
      } else {
        disambiguationSteps.push(`• Form 3 ("${form3}"): Further disambiguates paradigm type to ${bestMatch.preset.name}.`);
      }
    }

    if (parsedTokens.length > 3) {
      disambiguationSteps.push(`• Additional Forms (${parsedTokens.length} total): Fully corroborate slots ${bestMatch.matchedTokens.map(m => m.slot).join(', ')}.`);
    }

    let narrowingMessage = '';
    if (totalInputCount > 1) {
      narrowingMessage = `Narrowed down: ${bestMatch.preset.name} matches ${matchedCount}/${totalInputCount} supplied forms for lemma "${bestMatch.reconstructedLemma}" (${bestMatch.matchedTokens.map(m => m.slot).join(', ')}).`;
    } else {
      narrowingMessage = `Form "${parsedTokens[0].surface}" matches ${bestMatch.preset.name} as ${matchedSlot} (predicted lemma: "${bestMatch.reconstructedLemma}"). ${candidates.length > 1 ? `${candidates.length} candidate guesses available. Enter more forms (e.g. Genitive or Partitive) to narrow down.` : ''}`;
    }

    // 5. Match with Analyzer +Guess readings if provided
    const analyzerMatches = [];
    const parsedUralicGuesses = [];
    for (const tok of parsedTokens) {
      const w = tok.surface;
      const readings = analyzerData[w] || analyzerData[w.toLowerCase()] || [];
      const guessReadings = readings.filter(r => r.isGuessed || (r.raw && r.raw.includes('+Guess')));
      const lexicalReadings = readings.filter(r => !r.isGuessed && (!r.raw || !r.raw.includes('+Guess')));

      const parsedGuessesForTok = [];
      guessReadings.forEach(r => {
        const p = this.parseUralicNlpGuesserTag(r.raw || '');
        if (p) {
          parsedGuessesForTok.push(p);
          parsedUralicGuesses.push(p);
        }
      });

      analyzerMatches.push({
        form: w,
        totalReadings: readings.length,
        hasGuess: guessReadings.length > 0,
        guessTags: guessReadings.map(r => r.raw || `${r.lemma}+${r.pos}`),
        lexicalTags: lexicalReadings.map(r => r.raw || `${r.lemma}+${r.pos}`),
        parsedUralicGuesses: parsedGuessesForTok
      });
    }

    // 6. Engine handling & Distinction between Analyzer vs LangJack Models
    if (classifierEngine === 'uralicnlp') {
      const engineDisplayName = '🌐 UralicNLP Transducer (+Guess FST)';
      if (parsedUralicGuesses.length > 0) {
        const topUralic = parsedUralicGuesses[0];
        const uniqueModelLemmas = Array.from(new Set(parsedUralicGuesses.map(g => g.modelLemma)));
        const allGuessCodes = Array.from(new Set(parsedUralicGuesses.map(g => g.fullGuessTag)));

        // Find matching LangJack generator counterpart for this type
        const ljCounterpart = allKnown.find(p => p.typeNumber === topUralic.typeNumber || p.id === topUralic.langJackPresetId || (topUralic.typeNumber === 41 && p.id === 'vro_type_41_kand')) || bestMatch.preset;

        const uDistinctionNote = `Analyzed using UralicNLP transducer +Guess readings (${allGuessCodes.join(', ')}). The UralicNLP analyzer cataloges Type ${topUralic.typeNumber} under model lemmas "${uniqueModelLemmas.join(', ')}". Note: There is NO "+N_${topUralic.typeNumber}_kand" in the UralicNLP analyzer; "+N_41_kand" was developed specifically for LangJack.`;

        // Generate predicted forms using the identified type
        const uPredictedForms = bestMatch ? bestMatch.predictedForms.map(f => ({
          ...f,
          originalModelSurface: `${uniqueModelLemmas[0]} (${f.originalModelSurface})`
        })) : [];

        return {
          matched: true,
          engine: 'uralicnlp',
          engineDisplayName,
          paradigmId: `uralicnlp_N_${topUralic.typeNumber}_${topUralic.modelLemma}`,
          paradigmName: `UralicNLP Type ${topUralic.typeNumber} (${uniqueModelLemmas.join(' / ')})`,
          paradigmType: allGuessCodes.join(' / '),
          continuationLexicon: ljCounterpart?.continuationLexicon || '',
          lexcRegexRule: ljCounterpart?.lexcRegexRule || '',
          lang: langFilter || 'vro',
          matchedWord: parsedTokens[0].surface,
          reconstructedLemma: topUralic.lemma || bestMatch.reconstructedLemma,
          matchedSlot: topUralic.slot || bestMatch.matchedSlot,
          predictedTag: topUralic.rawTag,
          root: bestMatch.rootGroup,
          explanation: `Classified directly by UralicNLP FST transducer as Type ${topUralic.typeNumber} (model lemmas: ${uniqueModelLemmas.join(', ')}).`,
          distinctionNote: uDistinctionNote,
          langJackEquivalent: ljCounterpart?.paradigmType || `Type ${topUralic.typeNumber}`,
          predictedForms: uPredictedForms,
          matchedCount: parsedTokens.length,
          totalInputCount,
          narrowingMessage: `UralicNLP transducer matched "${parsedTokens[0].surface}" to Type ${topUralic.typeNumber} (${allGuessCodes.join(', ')}). Reconstructed lemma: "${topUralic.lemma}".`,
          disambiguationSteps,
          gradationDetected,
          gradationTraits: Array.from(new Set(gradationTraits)),
          analyzerMatches,
          guesses: candidates.map(c => ({
            paradigmId: c.preset.id,
            paradigmName: c.preset.name,
            paradigmType: c.preset.paradigmType || '',
            continuationLexicon: c.preset.continuationLexicon || '',
            lexcRegexRule: c.preset.lexcRegexRule || '',
            reconstructedLemma: c.reconstructedLemma,
            matchedSlot: c.matchedTokens[0]?.slot,
            predictedTag: c.matchedTokens[0]?.tag,
            matchedCount: c.matchedTokens.length,
            totalInputCount,
            eliminated: !!c.eliminated,
            eliminationReason: c.eliminationReason || '',
            matchedTokens: c.matchedTokens,
            predictedForms: c.predictedForms
          }))
        };
      } else if (analyzerMatches.some(m => m.lexicalTags.length > 0)) {
        const lex = analyzerMatches.find(m => m.lexicalTags.length > 0);
        return {
          matched: true,
          engine: 'uralicnlp',
          engineDisplayName,
          paradigmId: 'uralicnlp_lexical',
          paradigmName: `UralicNLP Lexical Entry: ${lex.lexicalTags[0]}`,
          paradigmType: lex.lexicalTags[0],
          lang: langFilter || 'vro',
          matchedWord: lex.form,
          reconstructedLemma: lex.lexicalTags[0].split('+')[0],
          matchedSlot: 'Lexical',
          predictedTag: lex.lexicalTags[0],
          explanation: `Known dictionary word in UralicNLP analyzer (${lex.lexicalTags.join(', ')}).`,
          distinctionNote: 'Direct lexical lookup in the UralicNLP morphological analyzer transducer.',
          predictedForms: bestMatch?.predictedForms || [],
          matchedCount: 1,
          totalInputCount,
          narrowingMessage: `Form "${lex.form}" is directly recognized in the UralicNLP lexicon as ${lex.lexicalTags.join(', ')}.`,
          disambiguationSteps,
          gradationDetected,
          gradationTraits: Array.from(new Set(gradationTraits)),
          analyzerMatches,
          guesses: []
        };
      } else {
        return {
          matched: false,
          engine: 'uralicnlp',
          engineDisplayName,
          reason: `No UralicNLP transducer readings found for "${firstWord}". Check that the UralicNLP model for ${langFilter || 'vro'} is loaded in memory or switch to LangJack Two-Level mode.`
        };
      }
    }

    let distinctionNote = '';
    let engineDisplayName = '';
    if (classifierEngine === 'langjack') {
      engineDisplayName = '⚡ LangJack Two-Level Engine';
      const uTags = (bestMatch.preset.uralicNlpGuesserTags || []).filter(t => t.startsWith('+')).join(' / ');
      distinctionNote = `Classified using LangJack's internal Two-Level rules and preset "${bestMatch.preset.name}" (${bestMatch.preset.paradigmType}). Note: In the UralicNLP analyzer, this type is cataloged under ${uTags || 'GiellaLT model lemmas'} (there is NO "${bestMatch.preset.paradigmType}" in the UralicNLP analyzer).`;
    } else {
      // 'combined'
      engineDisplayName = '🔀 Combined Mode (UralicNLP Transducer + LangJack Two-Level)';
      if (parsedUralicGuesses.length > 0) {
        const topUralic = parsedUralicGuesses[0];
        const uniqueModelLemmas = Array.from(new Set(parsedUralicGuesses.map(g => g.modelLemma)));
        distinctionNote = `Cross-verified: The UralicNLP transducer produces ${parsedUralicGuesses.map(g => g.rawTag).join(' and ')} (Type ${topUralic.typeNumber} with model lemmas "${uniqueModelLemmas.join(', ')}"). This corresponds to LangJack's Type ${topUralic.typeNumber} model "${bestMatch.preset.paradigmType}". Note: There is NO "${bestMatch.preset.paradigmType}" in the UralicNLP analyzer.`;
      } else {
        distinctionNote = `LangJack Two-Level model matched (${bestMatch.preset.paradigmType}). (No active +Guess readings returned by the UralicNLP transducer for these forms).`;
      }
    }

    return {
      matched: !bestMatch.eliminated || matchedCount > 0,
      engine: classifierEngine,
      engineDisplayName,
      distinctionNote,
      paradigmId: bestMatch.preset.id,
      paradigmName: bestMatch.preset.name,
      paradigmType: bestMatch.preset.paradigmType || bestMatch.regexInfo.paradigmType || '',
      continuationLexicon: bestMatch.preset.continuationLexicon || bestMatch.regexInfo.continuationLexicon || '',
      lexcRegexRule: bestMatch.preset.lexcRegexRule || bestMatch.regexInfo.lexcRegex || '',
      lang: bestMatch.preset.lang || '',
      matchedWord: parsedTokens[0].surface,
      reconstructedLemma: bestMatch.reconstructedLemma,
      matchedSlot,
      predictedTag,
      root: bestMatch.rootGroup,
      explanation: bestMatch.regexInfo.explanation,
      pattern: bestMatch.regexInfo.pattern,
      predictedForms: bestMatch.predictedForms,
      matchedCount,
      totalInputCount,
      narrowingMessage,
      disambiguationSteps,
      gradationDetected,
      gradationTraits: Array.from(new Set(gradationTraits)),
      analyzerMatches,
      guesses: candidates.map(c => ({
        paradigmId: c.preset.id,
        paradigmName: c.preset.name,
        paradigmType: c.preset.paradigmType || '',
        continuationLexicon: c.preset.continuationLexicon || '',
        lexcRegexRule: c.preset.lexcRegexRule || '',
        reconstructedLemma: c.reconstructedLemma,
        matchedSlot: c.matchedTokens[0]?.slot,
        predictedTag: c.matchedTokens[0]?.tag,
        matchedCount: c.matchedTokens.length,
        totalInputCount,
        eliminated: !!c.eliminated,
        eliminationReason: c.eliminationReason || '',
        matchedTokens: c.matchedTokens,
        predictedForms: c.predictedForms
      }))
    };
  }

  /**
   * Checks whether a word fits a paradigm's LexC stem regex pattern or extends it.
   * If it extends the pattern, returns the enlarged pattern and details of what was expanded.
   *
   * @param {string} word - The candidate word/lemma (e.g. 'lado', 'mago', 'tego', 'vido')
   * @param {string} [patternStr] - LexC regex rule line. Defaults to Type 39 vido pattern.
   * @returns {object} {
   *   word,
   *   fits,
   *   extends,
   *   analysis: { onset, rootVowel, stop, stemVowel },
   *   extensions: { newConsonants, newVowels, newStops, newStemVowels },
   *   originalPattern,
   *   enlargedPattern,
   *   explanation
   * }
   */
  checkAndExtendStemPattern(word, patternStr) {
    const rawWord = (word || '').trim().toLowerCase();
    const pattern = (patternStr || '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] o "+N":0 "+Guess":0 "+N_39_vido":0 > N_39VIDO ;').trim();

    // 1. Parse pattern brackets: [consonants]* [vowels] [stops]
    const bracketMatches = [...pattern.matchAll(/\[([^\]]+)\](\*?)/g)];
    const cnsBracket = bracketMatches[0] ? bracketMatches[0][1] : 'b|d|f|g|h|j|k|l|m|n|p|r|s|t|v';
    const vowBracket = bracketMatches[1] ? bracketMatches[1][1] : 'a|o|u|õ';
    const stopBracket = bracketMatches[2] ? bracketMatches[2][1] : '0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"';

    const consonants = cnsBracket.split('|').map(s => s.trim()).filter(Boolean);
    const vowels = vowBracket.split('|').map(s => s.trim()).filter(Boolean);

    // Extract upper stops (e.g. g from g:"{kgØ}", d from d:"{tdØ}", b from b:"{pbv}")
    const stopPairs = stopBracket.split('|').map(s => s.trim()).filter(Boolean);
    const stopUpperChars = [];
    stopPairs.forEach(pair => {
      const m = pair.match(/([a-zõäöüšž]):"\{/i) || pair.match(/([a-zõäöüšž])$/i);
      if (m) stopUpperChars.push(m[1].toLowerCase());
    });
    if (stopUpperChars.length === 0) stopUpperChars.push('d', 'g', 'b');

    // Extract stem vowel (e.g. o or "o":0)
    const afterStops = pattern.slice(pattern.indexOf(bracketMatches[2] ? bracketMatches[2][0] : ']') + 1).trim();
    const stemVowelMatch = afterStops.match(/^(?:"([a-zõäöüšž])":0|"([a-zõäöüšž])"|([a-zõäöüšž]))/i);
    const stemVowel = stemVowelMatch ? (stemVowelMatch[1] || stemVowelMatch[2] || stemVowelMatch[3]).toLowerCase() : 'o';

    // 2. Decompose candidate word: [onset*][rootVowel+][stop][stemVowel]
    let onset = '';
    let rootVowel = '';
    let stop = '';
    let wordStemVowel = '';

    if (rawWord.endsWith(stemVowel)) {
      wordStemVowel = stemVowel;
      const rest = rawWord.slice(0, -stemVowel.length);
      if (rest.length >= 2) {
        stop = rest.slice(-1);
        const beforeStop = rest.slice(0, -1);
        const vowRegex = /[aouõeiäöü]+$/i;
        const vm = beforeStop.match(vowRegex);
        if (vm) {
          rootVowel = vm[0];
          onset = beforeStop.slice(0, -rootVowel.length);
        } else {
          rootVowel = beforeStop.slice(-1);
          onset = beforeStop.slice(0, -1);
        }
      }
    }

    // 3. Check membership & identify extensions
    const newConsonants = [];
    for (const ch of onset) {
      if (!consonants.includes(ch) && !newConsonants.includes(ch)) {
        newConsonants.push(ch);
      }
    }

    const newVowels = [];
    for (const ch of rootVowel) {
      if (!vowels.includes(ch) && !newVowels.includes(ch)) {
        newVowels.push(ch);
      }
    }

    const newStops = [];
    if (stop && !stopUpperChars.includes(stop)) {
      newStops.push(stop);
    }

    const newStemVowels = [];
    if (!rawWord.endsWith(stemVowel)) {
      newStemVowels.push(rawWord.slice(-1));
    }

    const fits = newConsonants.length === 0 && newVowels.length === 0 && newStops.length === 0 && newStemVowels.length === 0;
    const extendsPattern = !fits;

    const sortAlphabetical = (arr) => {
      return [...arr].sort((a, b) => a.localeCompare(b, 'et', { sensitivity: 'base' }));
    };

    const enlargedConsonants = sortAlphabetical([...new Set([...consonants, ...newConsonants])]);
    const enlargedVowels = sortAlphabetical([...new Set([...vowels, ...newVowels])]);

    // 4. Reconstruct enlarged pattern
    let enlargedPattern = pattern;
    if (extendsPattern) {
      const oldCnsStr = `[${cnsBracket}]*`;
      const newCnsStr = `[${enlargedConsonants.join('|')}]*`;
      const oldVowStr = `[${vowBracket}]`;
      const newVowStr = `[${enlargedVowels.join('|')}]`;

      enlargedPattern = enlargedPattern.replace(oldCnsStr, newCnsStr).replace(oldVowStr, newVowStr);
    }

    let explanation = '';
    if (fits) {
      explanation = `Word "${word}" fits pattern directly (onset: "${onset || 'Ø'}", root vowel: "${rootVowel}", stop: "${stop}", stem vowel: "${wordStemVowel}"). No adjustment required.`;
    } else {
      const parts = [];
      if (newConsonants.length > 0) parts.push(`adding consonant(s) "${newConsonants.join(', ')}" to [${enlargedConsonants.join('|')}]*`);
      if (newVowels.length > 0) parts.push(`adding vowel(s) "${newVowels.join(', ')}" to [${enlargedVowels.join('|')}]`);
      if (newStops.length > 0) parts.push(`new stop "${newStops.join(', ')}"`);
      if (newStemVowels.length > 0) parts.push(`new stem vowel "${newStemVowels.join(', ')}"`);
      explanation = `Word "${word}" extends pattern by ${parts.join(', ')}.`;
    }

    const contMatch = pattern.match(/>\s*([A-Za-z0-9_]+)\s*;/);
    const continuationLexicon = contMatch ? contMatch[1] : 'N_39VIDO';
    const lexcStemLine = this.generateLexcStemLine(word, { continuationLexicon });

    return {
      word,
      fits,
      extends: extendsPattern,
      analysis: { onset, rootVowel, stop, stemVowel: wordStemVowel },
      extensions: { newConsonants, newVowels, newStops, newStemVowels },
      originalPattern: pattern,
      enlargedPattern,
      lexcStemLine,
      explanation
    };
  }

  /**
   * Directly expands the initial consonant set in a LexC regex pattern with an additional letter or letters.
   *
   * @param {string} pattern - LexC regex rule line
   * @param {string|Array<string>} letters - Letter(s) to add
   * @returns {string} The enlarged LexC regex rule line
   */
  expandInitialConsonants(pattern, letters) {
    const rawPattern = (pattern || '').trim();
    const toAdd = Array.isArray(letters) ? letters : [letters];
    const bracketMatches = [...rawPattern.matchAll(/\[([^\]]+)\](\*?)/g)];
    if (bracketMatches.length === 0) return rawPattern;

    const cnsBracket = bracketMatches[0][1];
    const existing = cnsBracket.split('|').map(s => s.trim()).filter(Boolean);
    const combined = [...new Set([...existing, ...toAdd])].sort((a, b) => a.localeCompare(b, 'et', { sensitivity: 'base' }));

    const oldCnsStr = `[${cnsBracket}]*`;
    const newCnsStr = `[${combined.join('|')}]*`;
    return rawPattern.replace(oldCnsStr, newCnsStr);
  }

  /**
   * Distinguishes between attested letters (empirically confirmed by observed words)
   * and unconfirmed/projected letters (permitted by the generalized phonotactic pattern).
   *
   * @param {Array<string>} words - List of confirmed words/lemmas
   * @param {string} fullPattern - The generalized LexC regex rule line
   * @returns {object} {
   *   confirmedWords,
   *   attested: { consonants, vowels, stops, stemVowels },
   *   attestedLists: { consonants, vowels, stops },
   *   unconfirmedLists: { consonants, vowels, stops },
   *   attestedPattern,
   *   projectedPattern
   * }
   */
  trackPatternAttestations(words = [], fullPattern = '') {
    const defaultPattern = '< [b|d|f|g|h|j|k|ḱ|l|m|n|ń|p|r|ŕ|s|t|v]* [a|e|i|o|u|õ|ä] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] o "+N":0 "+Guess":0 "+N_39_vido":0 > N_39VIDO ;';
    const pattern = (fullPattern || defaultPattern).trim();
    const bracketMatches = [...pattern.matchAll(/\[([^\]]+)\](\*?)/g)];
    const cnsBracket = bracketMatches[0] ? bracketMatches[0][1] : '';
    const vowBracket = bracketMatches[1] ? bracketMatches[1][1] : '';
    const stopBracket = bracketMatches[2] ? bracketMatches[2][1] : '';

    const fullConsonants = cnsBracket.split('|').map(s => s.trim()).filter(Boolean);
    const fullVowels = vowBracket.split('|').map(s => s.trim()).filter(Boolean);

    const stopPairs = stopBracket.split('|').map(s => s.trim()).filter(Boolean);
    const fullStops = [];
    stopPairs.forEach(pair => {
      const m = pair.match(/([a-zõäöüšž]):"\{/i) || pair.match(/([a-zõäöüšž])$/i);
      if (m) fullStops.push(m[1].toLowerCase());
    });

    const attested = {
      consonants: {},
      vowels: {},
      stops: {},
      stemVowels: {}
    };

    const sortEt = (arr) => [...arr].sort((a, b) => a.localeCompare(b, 'et', { sensitivity: 'base' }) || a.localeCompare(b, 'et'));

    words.forEach(rawWord => {
      const w = rawWord.trim().toLowerCase();
      const stemVowel = w.slice(-1);
      if (!attested.stemVowels[stemVowel]) attested.stemVowels[stemVowel] = [];
      attested.stemVowels[stemVowel].push(w);

      const rest = w.slice(0, -1);
      if (rest.length >= 2) {
        const stop = rest.slice(-1);
        if (!attested.stops[stop]) attested.stops[stop] = [];
        attested.stops[stop].push(w);

        const beforeStop = rest.slice(0, -1);
        const vm = beforeStop.match(/[aouõeiäöü]+$/i);
        if (vm) {
          const vow = vm[0];
          for (const vChar of vow) {
            if (!attested.vowels[vChar]) attested.vowels[vChar] = [];
            if (!attested.vowels[vChar].includes(w)) attested.vowels[vChar].push(w);
          }
          const onset = beforeStop.slice(0, -vow.length);
          for (const cChar of onset) {
            if (!attested.consonants[cChar]) attested.consonants[cChar] = [];
            if (!attested.consonants[cChar].includes(w)) attested.consonants[cChar].push(w);
          }
        }
      }
    });

    const attestedCnsList = sortEt(Object.keys(attested.consonants));
    const unconfirmedCnsList = sortEt(fullConsonants.filter(c => !attested.consonants[c]));

    const attestedVowList = sortEt(Object.keys(attested.vowels));
    const unconfirmedVowList = sortEt(fullVowels.filter(v => !attested.vowels[v]));

    const attestedStopList = sortEt(Object.keys(attested.stops));
    const unconfirmedStopList = sortEt(fullStops.filter(s => !attested.stops[s]));

    const attestedPattern = pattern
      .replace(`[${cnsBracket}]*`, `[${attestedCnsList.join('|')}]*`)
      .replace(`[${vowBracket}]`, `[${attestedVowList.join('|')}]`);

    return {
      confirmedWords: words,
      attested: {
        consonants: attested.consonants,
        vowels: attested.vowels,
        stops: attested.stops,
        stemVowels: attested.stemVowels
      },
      attestedLists: {
        consonants: attestedCnsList,
        vowels: attestedVowList,
        stops: attestedStopList
      },
      unconfirmedLists: {
        consonants: unconfirmedCnsList,
        vowels: unconfirmedVowList,
        stops: unconfirmedStopList
      },
      attestedPattern,
      projectedPattern: pattern
    };
  }

  /**
   * Generates a single-line LexC stem entry in the format:
   * <lemma>+<POS>:<underlying_morphophonemic_stem> <continuation_lexicon> ;
   * e.g. "vido+N:vi{tØ}{tdØ}o N_39VIDO ;"
   *
   * @param {string} word - The lemma / dictionary form (e.g. 'vido', 'mago', 'kŕabo')
   * @param {object} [options] - Configuration options:
   *   - pos: Part of speech (e.g. 'N', 'A', 'V', defaults to 'N', or 'POS' if unknown)
   *   - posUnknown: boolean, if true outputs '+POS'
   *   - paradigmType: e.g. '+N_39_vido', defaults to '+N_39_vido'
   *   - continuationLexicon: e.g. 'N_39VIDO', defaults to 'N_39VIDO'
   * @returns {string} The formatted LexC line
   */
  generateLexcStemLine(word, options = {}) {
    const rawWord = (word || '').trim();
    if (!rawWord) return '';

    const paradigmType = options.paradigmType || '+N_39_vido';
    const continuation = options.continuationLexicon ||
      (paradigmType === '+N_39_vido' ? 'N_39VIDO' :
       paradigmType === '+N_39_luba' ? 'N_39LUBA' :
       paradigmType === '+N_39_lugu' ? 'N_39LUGU' :
       paradigmType === '+N_40_talo' ? 'N_40TALO' :
       paradigmType === '+N_44_tsiga' ? 'N_44TSIGA' :
       paradigmType === '+N_41_tuekk' ? 'N_41TUEKK' :
       paradigmType === '+N_41_kand' ? 'N_41KAND' : 'Root');
    const pos = options.pos !== undefined ? options.pos : (options.posUnknown ? 'POS' : 'N');
    const posTag = pos ? (pos.startsWith('+') ? pos : `+${pos}`) : '+POS';

    let morphStem = rawWord;

    if (paradigmType === '+N_39_vido' || continuation === 'N_39VIDO') {
      // Type 39 stop gradation: d -> {tØ}{tdØ}, g -> {kØ}{kgØ}, b -> {pØ}{pbv}
      const w = rawWord.toLowerCase();
      if (w.endsWith('o') && w.length >= 2) {
        const stop = w.slice(-2, -1);
        const prefix = rawWord.slice(0, -2);
        let stopMorph = stop;
        if (stop === 'd') {
          stopMorph = '{tØ}{tdØ}';
        } else if (stop === 'g') {
          stopMorph = '{kØ}{kgØ}';
        } else if (stop === 'b') {
          stopMorph = '{pØ}{pbv}';
        }
        morphStem = `${prefix}${stopMorph}o`;
      }
    } else if (paradigmType === '+N_39_luba' || continuation === 'N_39LUBA') {
      const w = rawWord.toLowerCase();
      if (w.endsWith('a') && w.length >= 2) {
        const stop = w.slice(-2, -1);
        const prefix = rawWord.slice(0, -2);
        let stopMorph = stop;
        if (stop === 'd') {
          stopMorph = '{tØ}{tdØ}';
        } else if (stop === 'g') {
          stopMorph = '{kØ}{kgØ}';
        } else if (stop === 'b') {
          stopMorph = '{pØ}{pbv}';
        }
        morphStem = `${prefix}${stopMorph}a`;
      }
    } else if (paradigmType === '+N_39_lugu' || continuation === 'N_39LUGU') {
      const w = rawWord.toLowerCase();
      if (w.endsWith('u') && w.length >= 2) {
        const stop = w.slice(-2, -1);
        const prefix = rawWord.slice(0, -2);
        let stopMorph = stop;
        if (stop === 'd') {
          stopMorph = '{tØ}{tdØ}';
        } else if (stop === 'g') {
          stopMorph = '{kØ}{kgØ}';
        } else if (stop === 'b') {
          stopMorph = '{pØ}{pbv}';
        }
        morphStem = `${prefix}${stopMorph}u`;
      }
    } else if (paradigmType === '+N_40_talo' || continuation === 'N_40TALO') {
      const w = rawWord.toLowerCase();
      if (w.endsWith('o') && w.length >= 2) {
        const cns = w.slice(-2, -1);
        const prefix = rawWord.slice(0, -2);
        morphStem = `${prefix}{0:0, 0:${cns}}${cns}o`;
      }
    } else if (paradigmType === '+N_41_tuekk' || continuation === 'N_41TUEKK') {
      // Type 41 geminate stop degemination: kk -> {k:k, k:0}{0:0, 0:ü}
      if (rawWord.endsWith('kk')) {
        const root = rawWord.slice(0, -2);
        morphStem = `${root}k{k:k, k:0}{0:0, 0:ü}`;
      }
    } else if (paradigmType === '+N_41_kand' || continuation === 'N_41KAND') {
      // Type 41 nd cluster assimilation: nd -> n{d:d, d:n}{0:0, 0:o}{0:0, 0:õ}
      if (rawWord.endsWith('nd')) {
        const root = rawWord.slice(0, -2);
        morphStem = `${root}n{d:d, d:n}{0:0, 0:o}{0:0, 0:õ}`;
      }
    } else if (paradigmType === '+N_44_tsiga' || continuation === 'N_44TSIGA' || paradigmType === '+N_44_swda' || continuation === 'N_44SWDA') {
      // Type 44 stop gradation: g -> {kØ}{kgØ}, d -> {tØ}{tdØ}, b -> {pØ}{pbv} with stem vowel {ao}
      const w = rawWord.toLowerCase();
      if (w.endsWith('a') && w.length >= 2) {
        const stop = w.slice(-2, -1);
        const prefix = rawWord.slice(0, -2);
        let stopMorph = stop;
        if (stop === 'd') {
          stopMorph = '{tØ}{tdØ}';
        } else if (stop === 'g') {
          stopMorph = '{kØ}{kgØ}';
        } else if (stop === 'b') {
          stopMorph = '{pØ}{pbv}';
        }
        morphStem = `${prefix}${stopMorph}{ao}`;
      }
    }

    return `${rawWord}${posTag}:${morphStem} ${continuation} ;`;
  }

  /**
   * Generates a complete accumulative LexC grammar file containing stem entries for all words.
   *
   * @param {Array<string>} words - List of lemmas
   * @param {object} [options] - Options (paradigmType, continuationLexicon, pos, etc.)
   * @returns {string} The full LexC accumulative file content
   */
  generateAccumulativeLexcFile(words = [], options = {}) {
    const paradigmType = options.paradigmType || '+N_39_vido';
    const continuation = options.continuationLexicon || (paradigmType === '+N_39_vido' ? 'N_39VIDO' : 'Noun_Cases');
    const lang = options.lang || 'vro';

    const lines = words.map(w => this.generateLexcStemLine(w, options));

    let lexc = `! ==========================================================\n`;
    lexc += `! Accumulative LexC Stem Entries\n`;
    lexc += `! Paradigm: ${paradigmType} | Continuation: ${continuation}\n`;
    if (lang) lexc += `! Language: ${lang}\n`;
    lexc += `! Total Lemmas: ${words.length}\n`;
    lexc += `! ==========================================================\n\n`;

    lexc += `Multichar_Symbols +N +A +V +Sg +Pl +Nom +Gen +Par +Ill +Ine +Ela +All +Ade +Abl +Tra +Ter +Abe +Com +POS +Guess ${paradigmType}\n\n`;

    lexc += `LEXICON Root\n`;
    lines.forEach(l => {
      lexc += `${l}\n`;
    });

    return lexc;
  }
}

export const paradigmService = new ParadigmService();
