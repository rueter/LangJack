/**
 * CoNLL-U Exporter: Generates Universal Dependencies (UD) format
 * complete with sentence-level metadata, translations, and morphological features.
 */

import { TagMapper, stripGuessTags } from './tag-mapper.js';
import { analyzerService } from './analyzer-service.js';
import { sortMiscSegments } from './conllu-parser.js';
import { parseFeats, featsToString } from './conllu-enhance.js';

/** A token made only of punctuation or symbols (the analyzer's own isPunct flag covers just a few marks). */
const isPunctForm = (form) => /^[\p{P}\p{S}]+$/u.test(form || '');

/**
 * XPOS is the tag readout only: the analysis without its lemma stem ("пек+Adv+Deg" -> "Adv+Deg"), tags in the
 * analyzer's order. Compound stems (# boundaries) and Guess markers are dropped too.
 * @param {string} raw  raw analysis string
 * @returns {string} tags joined by "+", or "" when there is none
 */
export function xposFromAnalysis(raw) {
  const tags = TagMapper.parse(stripGuessTags(raw || '')).cleanTags || [];
  return tags.join('+');
}

/**
 * Which tokens touch the next one in the sentence text (UD `SpaceAfter=No`). Each token form is searched for in
 * the text in order; a token whose form cannot be found leaves the cursor where it was and gets no flag. The last
 * token never gets one.
 * @param {string} text  the sentence text
 * @param {Array<{ form: string }>} tokens
 * @returns {boolean[]} true where no whitespace follows the token
 */
export function noSpaceAfter(text, tokens) {
  const out = [];
  let cursor = 0;
  for (const tok of tokens || []) {
    const form = tok.form || '';
    const at = form ? (text || '').indexOf(form, cursor) : -1;
    if (at < 0) { out.push(false); continue; }
    const end = at + form.length;
    cursor = end;
    out.push(end < text.length && !/\s/.test(text[end]));
  }
  return out;
}

/** A FEATS cell with its Feature=Value pairs in alphabetical order of the feature names ("_" stays "_"). */
const sortFeats = (feats) => (!feats || feats === '_' ? '_' : featsToString(parseFeats(feats)));

export class ConlluExporter {
  /**
   * Generates a CoNLL-U format string from annotated sentences and translations.
   * @param {Array<Object>} sentences - Array of sentence objects with tokens
   * @param {Array<{ lang: string, text: string }>} translations - Sentence or document translations
   * @param {string} [language=null] - Default language code for generation
   * @returns {string} CoNLL-U formatted text
   */
  static export(sentences, translations = [], language = null) {
    if (!sentences || sentences.length === 0) return '';

    const lines = [];

    sentences.forEach((sent, sIdx) => {
      // 1. Comments
      lines.push(`# sent_id = ${sent.sent_id || (sIdx + 1)}`);
      lines.push(`# text = ${sent.text || ''}`);

      // Translation comments: e.g. # text_en = ..., # text_fin = ...
      const trList = (sent.translations && sent.translations.length > 0)
        ? sent.translations
        : (translations && translations.length > 0 ? translations : []);
      if (trList.length > 0) {
        for (const tr of trList) {
          if (tr.text && tr.text.trim()) {
            const langCode = (tr.lang || 'en').toLowerCase().trim();
            lines.push(`# text_${langCode} = ${tr.text.trim()}`);
          }
        }
      }

      // 2. Token rows
      const spaceless = noSpaceAfter(sent.text, sent.tokens);
      (sent.tokens || []).forEach((tok, tIdx) => {
        const id = tok.id || (tIdx + 1);
        const form = tok.form || '';

        // Reading selection
        const reading = tok.customReading || tok.selectedReading || {};
        const punct = Boolean(tok.isPunct || tok.upos === 'PUNCT' || isPunctForm(form));
        const lemma = punct ? form : (tok.lemma || reading.lemma || form);
        const upos = punct ? 'PUNCT' : (tok.upos || reading.upos || TagMapper.deriveUpos(reading.raw || form));
        const fullRaw = reading.cleanRaw || stripGuessTags(reading.raw) || '';
        // column 5 holds the tags only, never a repeat of the whole analysis (lemma stem included)
        const xpos = punct
          ? (xposFromAnalysis(fullRaw) || '_')
          : (xposFromAnalysis(fullRaw) || reading.pos || upos || '_');
        let feats = punct ? '_' : (reading.feats || '_');
        if (!punct && feats === '_' && reading.raw) {
          const parsed = TagMapper.parse(reading.raw);
          feats = parsed.feats || '_';
        }

        // Ensure column 6 AdpType feature for ADP subcategories Po and Pr
        const isPost = !punct && (xpos && (xpos.split('+').includes('Po') || xpos === 'Po' || xpos.split('+').includes('Post') || xpos === 'Post')) ||
                       (reading.tags && (reading.tags.includes('Po') || reading.tags.includes('Post'))) ||
                       reading.pos === 'Po' || reading.pos === 'Post';
        const isPrep = !punct && (xpos && (xpos.split('+').includes('Pr') || xpos === 'Pr' || xpos.split('+').includes('Prep') || xpos === 'Prep')) ||
                       (reading.tags && (reading.tags.includes('Pr') || reading.tags.includes('Prep'))) ||
                       reading.pos === 'Pr' || reading.pos === 'Prep';

        if (isPost && !feats.includes('AdpType=')) {
          if (feats === '_') {
            feats = 'AdpType=Post';
          } else {
            const parts = feats.split('|').filter(Boolean);
            parts.push('AdpType=Post');
            parts.sort((a, b) => a.localeCompare(b));
            feats = parts.join('|');
          }
        } else if (isPrep && !feats.includes('AdpType=')) {
          if (feats === '_') {
            feats = 'AdpType=Prep';
          } else {
            const parts = feats.split('|').filter(Boolean);
            parts.push('AdpType=Prep');
            parts.sort((a, b) => a.localeCompare(b));
            feats = parts.join('|');
          }
        }

        const head = (tok.head !== undefined && tok.head !== null && tok.head !== '' && tok.head !== '_') ? tok.head : '_';
        const deprel = (tok.deprel && tok.deprel !== '_')
          ? tok.deprel
          : (punct ? 'punct' : '_');
        const deps = tok.deps || '_';

        // Check whether this token uses a spell relax or has an orthographical error
        const hasTypo = !punct && Boolean(
          reading.isSplRlx ||
          reading.isOrthErr ||
          (reading.featsMap && reading.featsMap.Typo === 'Yes') ||
          (xpos && (xpos.split('+').includes('SplRlx') || xpos.includes('Err/Orth'))) ||
          tok.isSplRlx ||
          tok.isOrthErr
        );

        // (1) In column 6 «Typo=Yes»
        if (hasTypo) {
          if (feats === '_') {
            feats = 'Typo=Yes';
          } else if (!feats.includes('Typo=Yes')) {
            const parts = feats.split('|').filter(Boolean);
            parts.push('Typo=Yes');
            parts.sort((a, b) => a.localeCompare(b));
            feats = parts.join('|');
          }
        }

        // MISC field: include CorrectForm=X, Gloss with language tag, etc.
        const miscParts = [];

        // a token that touches the next one in the sentence text (typically punctuation after a word)
        if (spaceless[tIdx]) miscParts.push('SpaceAfter=No');

        // (2) In column 10 «CorrectForm=X», where X = the generated form according to the Analyzer tags without SplRlx or Err/Orth type tags
        if (hasTypo) {
          const tokLang = tok.lang || sent.lang || language || analyzerService.activeLang || 'myv';
          const correctForm = analyzerService.generate(fullRaw || reading.raw || xpos, tokLang, form);
          if (correctForm && correctForm !== form) {
            miscParts.push(`CorrectForm=${correctForm}`);
          }
        }

        // punctuation is never glossed
        const gloss = punct ? '' : (tok.customGloss || (tok.selectedGloss ? tok.selectedGloss.gloss : ''));
        const glossLang = tok.customGlossLang || (tok.selectedGloss ? tok.selectedGloss.lang : '');

        if (gloss) {
          const cleanGloss = gloss.replace(/\s+/g, '_');
          if (glossLang) {
            miscParts.push(`Gloss[${glossLang}]=${cleanGloss}`);
          } else {
            miscParts.push(`Gloss=${cleanGloss}`);
          }
        }
        if (!punct && tok.readings && tok.readings.length > 1) {
          miscParts.push(`AltReadings=${tok.readings.length}`);
        }

        const misc = miscParts.length
          ? sortMiscSegments(miscParts.map((raw) => ({ key: raw.split('=')[0], raw }))).map((seg) => seg.raw).join('|')
          : '_';

        const row = [id, form, lemma, upos, xpos, sortFeats(feats), head, deprel, deps, misc].join('\t');
        lines.push(row);
      });

      // Blank line separating sentences
      lines.push('');
    });

    return lines.join('\n');
  }
}
