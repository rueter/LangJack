/**
 * Treebank Service: Manages accumulated treebanks across sentences.
 * Enables:
 * 1. Saving completed sentence annotations sequentially as treebanks in order.
 * 2. Saving several treebanks into the same accumulative file for download.
 * 3. Downloading several treebanks simultaneously (both in a single combined file and as individual files).
 * 4. Manually removing the accumulative file after download or on demand.
 */

import { storageService } from './storage-service.js';
import { ConlluExporter } from './conllu-exporter.js';

export class TreebankService {
  constructor() {
    this.treebanks = []; // Array of accumulated treebank records
    this.isLoaded = false;
  }

  /**
   * Initializes treebank service from persistent storage.
   */
  async init() {
    try {
      this.treebanks = await storageService.getAllAccumulatedTreebanks();
      this.isLoaded = true;
    } catch (err) {
      console.warn('Failed to load accumulated treebanks from storage:', err);
      this.treebanks = [];
    }
    return this.treebanks;
  }

  /**
   * Returns all accumulated treebanks sorted in sequential order.
   * @returns {Array<Object>}
   */
  getTreebanks() {
    return this.treebanks;
  }

  /**
   * Returns total count of accumulated treebanks.
   * @returns {number}
   */
  getCount() {
    return this.treebanks.length;
  }

  /**
   * Returns next sequential sentence ID.
   * @returns {number}
   */
  getNextSentId() {
    return this.treebanks.length + 1;
  }

  /**
   * Normalizes sentence text for comparison (collapses whitespace, trims, case-folds).
   * @param {string} text
   * @returns {string}
   */
  normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * Finds an existing treebank matching the given sentence or text string.
   * @param {Object|string} sentence
   * @param {string} srcLang
   * @returns {Object|null}
   */
  findDuplicate(sentence, srcLang = null) {
    const text = typeof sentence === 'string'
      ? sentence
      : (sentence?.text || sentence?.tokens?.map(t => t.form).join(' ') || '');
    const norm = this.normalizeText(text);
    if (!norm) return null;

    const cleanLang = srcLang ? srcLang.toLowerCase().trim() : null;

    for (const tb of this.treebanks) {
      if (this.normalizeText(tb.text) === norm) {
        if (!cleanLang || !tb.srcLang || tb.srcLang.toLowerCase().trim() === cleanLang) {
          return tb;
        }
      }
    }
    return null;
  }

  /**
   * Checks whether a sentence or text already exists in the accumulated treebanks.
   * @param {Object|string} sentence
   * @param {string} srcLang
   * @returns {boolean}
   */
  isDuplicate(sentence, srcLang = null) {
    return this.findDuplicate(sentence, srcLang) !== null;
  }

  /**
   * Finds all existing treebanks matching any sentence in an array.
   * @param {Array<Object>} sentences
   * @param {string} srcLang
   * @returns {Array<{ sentence: Object, existing: Object }>}
   */
  findDuplicates(sentences, srcLang = null) {
    if (!Array.isArray(sentences)) return [];
    const duplicates = [];
    for (const sent of sentences) {
      const existing = this.findDuplicate(sent, srcLang);
      if (existing) {
        duplicates.push({ sentence: sent, existing });
      }
    }
    return duplicates;
  }

  /**
   * Saves a completed sentence as the next treebank in order.
   * @param {Object} sentence - The sentence object with tokens
   * @param {Array<Object>} translations - Translations list for the sentence
   * @param {string} srcLang - Source language ISO code
   * @param {string} targetLang - Target gloss language ISO code
   * @returns {Promise<Object>} The saved treebank record
   */
  async saveSentence(sentence, translations = [], srcLang = 'myv', targetLang = 'all') {
    if (!sentence || !sentence.tokens || sentence.tokens.length === 0) {
      throw new Error('Cannot save empty sentence to treebank.');
    }

    const nextOrder = this.treebanks.length + 1;
    const treebank = {
      id: `tb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      order: nextOrder,
      sent_id: nextOrder,
      srcLang: srcLang || 'myv',
      targetLang: targetLang || 'all',
      text: sentence.text || sentence.tokens.map(t => t.form).join(' '),
      tokens: JSON.parse(JSON.stringify(sentence.tokens || [])),
      translations: JSON.parse(JSON.stringify(translations || [])),
      timestamp: Date.now()
    };

    // Normalize token IDs within the treebank
    treebank.tokens.forEach((tok, idx) => {
      tok.id = idx + 1;
      const upos = tok.upos || tok.customReading?.upos || tok.selectedReading?.upos || (tok.isPunct ? 'PUNCT' : '');
      if (tok.isPunct || upos === 'PUNCT') {
        if (!tok.deprel || tok.deprel === '_') {
          tok.deprel = 'punct';
        }
      }
    });

    await storageService.saveAccumulatedTreebank(treebank);
    this.treebanks.push(treebank);
    return treebank;
  }

  /**
   * Saves multiple completed sentences sequentially in order.
   * @param {Array<Object>} sentences
   * @param {Array<Object>} translations
   * @param {string} srcLang
   * @param {string} targetLang
   * @returns {Promise<Array<Object>>}
   */
  async saveAllSentences(sentences, translations = [], srcLang = 'myv', targetLang = 'all') {
    if (!Array.isArray(sentences) || sentences.length === 0) {
      return [];
    }

    const saved = [];
    for (const sent of sentences) {
      const tb = await this.saveSentence(sent, translations, srcLang, targetLang);
      saved.push(tb);
    }
    return saved;
  }

  /**
   * Retrieves a single accumulated treebank by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getTreebank(id) {
    return this.treebanks.find(tb => tb.id === id) || null;
  }

  /**
   * Updates an existing accumulated treebank with modified tokens, annotations, or metadata.
   * Enables manual editing and dependency annotation of treebanks in the accumulative file.
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<Object>} The updated treebank record
   */
  async updateTreebank(id, updates = {}) {
    const idx = this.treebanks.findIndex(tb => tb.id === id);
    if (idx === -1) {
      throw new Error(`Treebank with id "${id}" not found.`);
    }

    const current = this.treebanks[idx];
    const updated = {
      ...current,
      ...updates,
      id: current.id,
      sent_id: current.sent_id,
      order: current.order,
      timestamp: Date.now()
    };

    if (updates.tokens) {
      updated.tokens = JSON.parse(JSON.stringify(updates.tokens));
      // Re-normalize token IDs within the treebank
      updated.tokens.forEach((tok, tIdx) => {
        tok.id = tIdx + 1;
        const upos = tok.upos || tok.customReading?.upos || tok.selectedReading?.upos || (tok.isPunct ? 'PUNCT' : '');
        if (tok.isPunct || upos === 'PUNCT') {
          if (!tok.deprel || tok.deprel === '_') {
            tok.deprel = 'punct';
          }
        }
      });
      if (!updates.text && !current.text) {
        updated.text = updated.tokens.map(t => t.form).join(' ');
      }
    }

    if (updates.translations) {
      updated.translations = JSON.parse(JSON.stringify(updates.translations));
    }

    await storageService.saveAccumulatedTreebank(updated);
    this.treebanks[idx] = updated;
    return updated;
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteTreebank(id) {
    await storageService.deleteAccumulatedTreebank(id);
    this.treebanks = this.treebanks.filter(tb => tb.id !== id);

    // Re-index remaining treebanks (sent_id = 1..N) to maintain strict order
    for (let i = 0; i < this.treebanks.length; i++) {
      const tb = this.treebanks[i];
      const newOrder = i + 1;
      if (tb.order !== newOrder || tb.sent_id !== newOrder) {
        tb.order = newOrder;
        tb.sent_id = newOrder;
        await storageService.saveAccumulatedTreebank(tb);
      }
    }
    return true;
  }

  /**
   * Manually removes the entire accumulative file (clears all accumulated treebanks).
   * @returns {Promise<boolean>}
   */
  async clearAccumulatedFile() {
    await storageService.clearAccumulatedTreebanks();
    this.treebanks = [];
    return true;
  }

  /**
   * Generates a single combined CoNLL-U string containing all accumulated treebanks in order.
   * @returns {string}
   */
  generateCombinedConllu() {
    if (this.treebanks.length === 0) return '';

    const sentences = this.treebanks.map(tb => ({
      sent_id: tb.sent_id,
      text: tb.text,
      tokens: tb.tokens,
      translations: tb.translations
    }));

    return ConlluExporter.export(sentences, null);
  }

  /**
   * Generates a single treebank CoNLL-U string.
   * @param {Object} treebank
   * @returns {string}
   */
  generateSingleConllu(treebank) {
    if (!treebank) return '';
    return ConlluExporter.export([{
      sent_id: treebank.sent_id,
      text: treebank.text,
      tokens: treebank.tokens,
      translations: treebank.translations
    }], null);
  }

  /**
   * Downloads several treebanks in the same accumulative file.
   * @param {string|null} customFilename
   * @returns {{ filename: string, count: number, size: number }}
   */
  downloadCombinedFile(customFilename = null) {
    if (this.treebanks.length === 0) {
      throw new Error('No accumulated treebanks to download.');
    }

    const content = this.generateCombinedConllu();
    const primaryLang = this.treebanks[0]?.srcLang || 'multi';
    const filename = customFilename || `accumulated_treebank_${primaryLang}_${this.treebanks.length}sents.conllu`;

    this._triggerBrowserDownload(content, filename, 'text/plain;charset=utf-8');
    return {
      filename,
      count: this.treebanks.length,
      size: content.length
    };
  }

  /**
   * Downloads all accumulated treebanks simultaneously as separate individual files.
   * Staggers triggers slightly (150ms) to ensure browsers do not block multiple simultaneous downloads.
   * @param {number} delayMs - Delay between download triggers in milliseconds
   * @returns {Promise<Array<string>>} List of downloaded filenames
   */
  async downloadAllSimultaneously(delayMs = 150) {
    if (this.treebanks.length === 0) {
      throw new Error('No accumulated treebanks to download.');
    }

    const downloadedFiles = [];
    for (let i = 0; i < this.treebanks.length; i++) {
      const tb = this.treebanks[i];
      const content = this.generateSingleConllu(tb);
      const filename = `treebank_sent_${String(tb.sent_id).padStart(2, '0')}_${tb.srcLang || 'lang'}.conllu`;
      downloadedFiles.push(filename);

      if (i > 0 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      this._triggerBrowserDownload(content, filename, 'text/plain;charset=utf-8');
    }
    return downloadedFiles;
  }

  /**
   * Downloads a single specific treebank by ID.
   * @param {string} id
   */
  downloadSingleTreebank(id) {
    const tb = this.treebanks.find(t => t.id === id);
    if (!tb) throw new Error(`Treebank ${id} not found.`);
    const content = this.generateSingleConllu(tb);
    const filename = `treebank_sent_${String(tb.sent_id).padStart(2, '0')}_${tb.srcLang || 'lang'}.conllu`;
    this._triggerBrowserDownload(content, filename, 'text/plain;charset=utf-8');
    return filename;
  }

  /**
   * Helper to trigger a file download in the browser.
   * @private
   */
  _triggerBrowserDownload(content, filename, mimeType) {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export const treebankService = new TreebankService();
