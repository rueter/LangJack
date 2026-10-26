/**
 * Interlinear Exporter: Generates standard 5-line linguistic interlinear glossing format:
 * a. Original text
 * b. Individual word forms
 * c. Selected morphology
 * d. Selected gloss
 * e. Selected translation(s)
 * 
 * Provides both:
 * 1. Plain text format (tab-separated, formatted for MS Word / LibreOffice paste)
 * 2. HTML table format (pastes as a perfectly aligned table in MS Word and LibreOffice Writer)
 */

import { stripGuessTags } from './tag-mapper.js';

export class InterlinearExporter {
  /**
   * Generates plain text interlinear lines.
   * @param {Array<Object>} sentences
   * @param {Array<Object>} translations
   * @returns {string}
   */
  static exportPlainText(sentences, translations = []) {
    if (!sentences || sentences.length === 0) return '';

    const outputBlocks = [];

    sentences.forEach((sent, sIdx) => {
      const blockLines = [];
      const tokens = sent.tokens || [];

      // a. Original text
      blockLines.push(`a. Original:     ${sent.text || ''}`);

      // b. Individual word forms (tab-separated)
      const forms = tokens.map(t => t.form || '').join('\t');
      blockLines.push(`b. Word form:    ${forms}`);

      // c. Selected morphology (tab-separated)
      const morphs = tokens.map(t => {
        const reading = t.customReading || t.selectedReading;
        return reading ? (reading.cleanRaw || stripGuessTags(reading.raw) || reading.lemma || t.form) : t.form;
      }).join('\t');
      blockLines.push(`c. Morphology:   ${morphs}`);

      // d. Selected gloss (tab-separated)
      const glosses = tokens.map(t => {
        const g = t.customGloss || (t.selectedGloss ? t.selectedGloss.gloss : '');
        return g || '***';
      }).join('\t');
      blockLines.push(`d. Gloss:        ${glosses}`);

      // e. Selected translation(s)
      if (translations && translations.length > 0) {
        translations.forEach(tr => {
          if (tr.text && tr.text.trim()) {
            blockLines.push(`e. Translation [${(tr.lang || 'eng').toUpperCase()}]: ${tr.text.trim()}`);
          }
        });
      } else {
        blockLines.push(`e. Translation:  (None entered)`);
      }

      outputBlocks.push(blockLines.join('\n'));
    });

    return outputBlocks.join('\n\n' + '='.repeat(60) + '\n\n');
  }

  /**
   * Generates HTML table representation for direct clipboard copy into MS Word / LibreOffice.
   * Word and LibreOffice parse this directly into a clean, aligned table without column overflow.
   * @param {Array<Object>} sentences
   * @param {Array<Object>} translations
   * @returns {string} HTML string
   */
  static exportHTML(sentences, translations = []) {
    if (!sentences || sentences.length === 0) return '';

    let html = `<div style="font-family: Calibri, 'Times New Roman', serif; font-size: 11pt; line-height: 1.4;">`;

    sentences.forEach((sent, sIdx) => {
      const tokens = sent.tokens || [];

      html += `<div style="margin-bottom: 24pt; page-break-inside: avoid;">`;
      
      // Line a: Original text
      html += `<p style="font-weight: bold; margin-bottom: 6pt;"><strong>(a) Original:</strong> <em>${escapeHtml(sent.text || '')}</em></p>`;

      // Interlinear Table for lines b, c, d
      html += `<table style="border-collapse: collapse; margin-bottom: 8pt; width: auto;">`;
      
      // Row b: Word forms
      html += `<tr><td style="font-weight: bold; color: #555; padding-right: 12pt; vertical-align: top;">(b) Word:</td>`;
      tokens.forEach(t => {
        html += `<td style="padding: 2pt 8pt; font-weight: bold; vertical-align: top; border-bottom: 1px solid #ddd;">${escapeHtml(t.form || '')}</td>`;
      });
      html += `</tr>`;

      // Row c: Morphology
      html += `<tr><td style="font-weight: bold; color: #555; padding-right: 12pt; vertical-align: top;">(c) Morph:</td>`;
      tokens.forEach(t => {
        const reading = t.customReading || t.selectedReading;
        const morph = reading ? (reading.cleanRaw || stripGuessTags(reading.raw) || reading.lemma || t.form) : t.form;
        html += `<td style="padding: 2pt 8pt; font-family: Consolas, monospace; font-size: 9.5pt; color: #0284c7; vertical-align: top; border-bottom: 1px solid #ddd;">${escapeHtml(morph)}</td>`;
      });
      html += `</tr>`;

      // Row d: Gloss
      html += `<tr><td style="font-weight: bold; color: #555; padding-right: 12pt; vertical-align: top;">(d) Gloss:</td>`;
      tokens.forEach(t => {
        const g = t.customGloss || (t.selectedGloss ? t.selectedGloss.gloss : '');
        html += `<td style="padding: 2pt 8pt; font-style: italic; color: #059669; vertical-align: top;">${escapeHtml(g || '***')}</td>`;
      });
      html += `</tr>`;

      html += `</table>`;

      // Line e: Translations
      html += `<div style="margin-top: 4pt;">`;
      if (translations && translations.length > 0) {
        translations.forEach(tr => {
          if (tr.text && tr.text.trim()) {
            html += `<p style="margin: 2pt 0;"><strong>(e) Translation [${escapeHtml((tr.lang || 'eng').toUpperCase())}]:</strong> "${escapeHtml(tr.text.trim())}"</p>`;
          }
        });
      } else {
        html += `<p style="margin: 2pt 0; color: #777;"><strong>(e) Translation:</strong> <em>(None entered)</em></p>`;
      }
      html += `</div>`;

      html += `</div>`;
    });

    html += `</div>`;
    return html;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
