/**
 * Ve'rdd Exporter: Generates dictionary development output for Ve'rdd / Uralic lexicography.
 * For each selected word and lemma:
 * - Lemma
 * - Part of speech (POS / UPOS)
 * - Source language ISO code
 * - Target language ISO code
 * - Gloss
 * - Example sentence in source language
 * - Translation of example sentence in target language
 * 
 * Provides:
 * 1. Lexicographical Human-Readable Block format
 * 2. Ve'rdd XML format
 * 3. Tabular TSV format
 */

import { TagMapper, stripGuessTags } from './tag-mapper.js';

export class VerddExporter {
  /**
   * Generates human-readable lexicographical card blocks.
   * @param {Array<Object>} sentences
   * @param {Array<Object>} translations
   * @param {string} srcLang
   * @param {string} defaultTgtLang
   * @returns {string}
   */
  static exportBlock(sentences, translations = [], srcLang = 'myv', defaultTgtLang = 'eng') {
    if (!sentences || sentences.length === 0) return '';

    const entries = this.collectEntries(sentences, translations, srcLang, defaultTgtLang);
    const blocks = [];

    entries.forEach((e, idx) => {
      const lines = [
        `============================================================`,
        `ENTRY #${idx + 1}:  ${e.lemma}`,
        `POS:       ${e.upos} (${e.pos})`,
        `LANG:      ${e.srcLang.toUpperCase()} → ${e.tgtLang.toUpperCase()}`,
        `WORD FORM: ${e.form}`,
        `MORPH:     ${e.morph}`,
        `GLOSS:     ${e.gloss}`,
        `EXAMPLE [${e.srcLang}]:      ${e.exampleSentence}`,
      ];

      if (e.exampleTranslations.length > 0) {
        e.exampleTranslations.forEach(tr => {
          lines.push(`TRANSLATION [${tr.lang}]:  ${tr.text}`);
        });
      } else {
        lines.push(`TRANSLATION:      (None entered)`);
      }

      blocks.push(lines.join('\n'));
    });

    return blocks.join('\n\n');
  }

  /**
   * Generates Ve'rdd XML format for direct dictionary system ingestion.
   */
  static exportXML(sentences, translations = [], srcLang = 'myv', defaultTgtLang = 'eng') {
    if (!sentences || sentences.length === 0) return '';

    const entries = this.collectEntries(sentences, translations, srcLang, defaultTgtLang);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<verdd:lexicon xmlns:verdd="http://giellatekno.uit.no/verdd" source-lang="${escapeXml(srcLang)}">\n`;

    entries.forEach(e => {
      xml += `  <entry id="${escapeXml(e.srcLang)}_${escapeXml(e.lemma)}">\n`;
      xml += `    <lemma xml:lang="${escapeXml(e.srcLang)}">${escapeXml(e.lemma)}</lemma>\n`;
      xml += `    <pos>${escapeXml(e.upos)}</pos>\n`;
      xml += `    <xpos>${escapeXml(e.pos)}</xpos>\n`;
      xml += `    <analysis>${escapeXml(e.morph)}</analysis>\n`;
      xml += `    <translations>\n`;
      xml += `      <tr xml:lang="${escapeXml(e.tgtLang)}">${escapeXml(e.gloss)}</tr>\n`;
      xml += `    </translations>\n`;
      xml += `    <examples>\n`;
      xml += `      <example>\n`;
      xml += `        <quote xml:lang="${escapeXml(e.srcLang)}">${escapeXml(e.exampleSentence)}</quote>\n`;
      if (e.exampleTranslations.length > 0) {
        e.exampleTranslations.forEach(tr => {
          xml += `        <trans xml:lang="${escapeXml(tr.lang)}">${escapeXml(tr.text)}</trans>\n`;
        });
      }
      xml += `      </example>\n`;
      xml += `    </examples>\n`;
      xml += `  </entry>\n`;
    });

    xml += `</verdd:lexicon>`;
    return xml;
  }

  /**
   * Generates Tabular TSV format for spreadsheet and relational databases.
   */
  static exportTSV(sentences, translations = [], srcLang = 'myv', defaultTgtLang = 'eng') {
    if (!sentences || sentences.length === 0) return '';

    const entries = this.collectEntries(sentences, translations, srcLang, defaultTgtLang);
    const headers = [
      'LEMMA',
      'POS',
      'UPOS',
      'SRC_LANG',
      'GLOSS',
      'TGT_LANG',
      'WORD_FORM',
      'MORPH_TAG',
      'EXAMPLE_SENTENCE',
      'EXAMPLE_TRANSLATIONS'
    ].join('\t');

    const rows = entries.map(e => {
      const transStr = e.exampleTranslations.map(tr => `[${tr.lang}] ${tr.text}`).join('; ');
      return [
        e.lemma,
        e.pos,
        e.upos,
        e.srcLang,
        e.gloss,
        e.tgtLang,
        e.form,
        e.morph,
        e.exampleSentence,
        transStr
      ].join('\t');
    });

    return [headers, ...rows].join('\n');
  }

  /**
   * Helper to aggregate unique lemma/gloss occurrences with their context sentences.
   */
  static collectEntries(sentences, translations = [], srcLang = 'myv', defaultTgtLang = 'eng') {
    const list = [];
    const validTranslations = (translations || []).filter(t => t.text && t.text.trim());

    sentences.forEach(sent => {
      (sent.tokens || []).forEach(tok => {
        // Skip pure punctuation tokens for dictionary entries
        if (tok.isPunct) return;

        const reading = tok.customReading || tok.selectedReading || {};
        const lemma = tok.lemma || reading.lemma || tok.form;
        const upos = tok.upos || reading.upos || TagMapper.deriveUpos(reading.raw || tok.form);
        const pos = reading.pos || TagMapper.uposToPosTag(upos);
        const morph = reading.cleanRaw || stripGuessTags(reading.raw) || lemma;

        const gloss = tok.customGloss || (tok.selectedGloss ? tok.selectedGloss.gloss : '');
        const tgtLang = tok.customGlossLang || (tok.selectedGloss ? tok.selectedGloss.lang : defaultTgtLang);

        list.push({
          lemma,
          pos,
          upos,
          srcLang: (srcLang || 'myv').toLowerCase(),
          tgtLang: (tgtLang || defaultTgtLang || 'eng').toLowerCase(),
          gloss: gloss || '(no gloss selected)',
          form: tok.form,
          morph,
          exampleSentence: sent.text || '',
          exampleTranslations: validTranslations
        });
      });
    });

    return list;
  }
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
