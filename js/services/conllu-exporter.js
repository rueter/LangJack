/**
 * CoNLL-U Exporter: Generates Universal Dependencies (UD) format
 * complete with sentence-level metadata, translations, and morphological features.
 */

import { TagMapper, stripGuessTags } from './tag-mapper.js';
import { analyzerService } from './analyzer-service.js';

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
      (sent.tokens || []).forEach((tok, tIdx) => {
        const id = tok.id || (tIdx + 1);
        const form = tok.form || '';

        // Reading selection
        const reading = tok.customReading || tok.selectedReading || {};
        const lemma = tok.lemma || reading.lemma || form;
        const upos = tok.upos || reading.upos || (tok.isPunct ? 'PUNCT' : TagMapper.deriveUpos(reading.raw || form));
        const xpos = reading.cleanRaw || stripGuessTags(reading.raw) || reading.pos || upos || '_';
        let feats = reading.feats || '_';
        if (feats === '_' && reading.raw) {
          const parsed = TagMapper.parse(reading.raw);
          feats = parsed.feats || '_';
        }

        // Ensure column 6 AdpType feature for ADP subcategories Po and Pr
        const isPost = (xpos && (xpos.split('+').includes('Po') || xpos === 'Po' || xpos.split('+').includes('Post') || xpos === 'Post')) ||
                       (reading.tags && (reading.tags.includes('Po') || reading.tags.includes('Post'))) ||
                       reading.pos === 'Po' || reading.pos === 'Post';
        const isPrep = (xpos && (xpos.split('+').includes('Pr') || xpos === 'Pr' || xpos.split('+').includes('Prep') || xpos === 'Prep')) ||
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
          : (upos === 'PUNCT' || tok.isPunct ? 'punct' : '_');
        const deps = tok.deps || '_';

        // Check whether this token uses a spell relax or has an orthographical error
        const hasTypo = Boolean(
          reading.isSplRlx ||
          reading.isOrthErr ||
          (reading.featsMap && reading.featsMap.Typo === 'Yes') ||
          (xpos && (xpos.includes('+SplRlx') || xpos.includes('+Err/Orth') || xpos.includes('Err/Orth'))) ||
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

        // (2) In column 10 «CorrectForm=X», where X = the generated form according to the Analyzer tags without SplRlx or Err/Orth type tags
        if (hasTypo) {
          const tokLang = tok.lang || sent.lang || language || analyzerService.activeLang || 'myv';
          const correctForm = analyzerService.generate(reading.cleanRaw || reading.raw || xpos, tokLang, form);
          if (correctForm && correctForm !== form) {
            miscParts.push(`CorrectForm=${correctForm}`);
          }
        }

        const gloss = tok.customGloss || (tok.selectedGloss ? tok.selectedGloss.gloss : '');
        const glossLang = tok.customGlossLang || (tok.selectedGloss ? tok.selectedGloss.lang : '');

        if (gloss) {
          const cleanGloss = gloss.replace(/\s+/g, '_');
          if (glossLang) {
            miscParts.push(`Gloss[${glossLang}]=${cleanGloss}`);
          } else {
            miscParts.push(`Gloss=${cleanGloss}`);
          }
        }
        if (tok.readings && tok.readings.length > 1) {
          miscParts.push(`AltReadings=${tok.readings.length}`);
        }

        const misc = miscParts.length > 0 ? miscParts.join('|') : '_';

        const row = [id, form, lemma, upos, xpos, feats, head, deprel, deps, misc].join('\t');
        lines.push(row);
      });

      // Blank line separating sentences
      lines.push('');
    });

    return lines.join('\n');
  }
}
