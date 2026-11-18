/**
 * Constraint Grammar disambiguation (VISL CG-3 grammars such as GiellaLT's src/cg3/disambiguator.cg3), run in the
 * browser by @rueter/jscg3 (js/lib/jscg3, MIT). The grammars are the user's own: they are uploaded in Manage HFST
 * Models & Dictionaries, kept in this browser per language and never sent anywhere.
 *
 * Several grammars for one language run in the order they were added, each taking the previous one's output
 * (disambiguator.cg3, then functions.cg3, then dependency.cg3 ...).
 */

import { storageService } from './storage-service.js';
import { HfstRawExporter } from './hfst-raw-exporter.js';

const key = (lang) => `cg3_grammars_${String(lang || '').toLowerCase()}`;

export class Cg3Service {
  constructor() {
    this._engines = new Map(); // lang -> { signature, cg }
  }

  /** @returns {Promise<Array<{name: string, text: string, timestamp: number}>>} grammars of the language, in run order */
  async getGrammars(lang) {
    const list = await storageService.getSetting(key(lang), []);
    return Array.isArray(list) ? list : [];
  }

  /** Adds a grammar for the language; a grammar with the same file name is replaced in its place. */
  async saveGrammar(lang, name, text) {
    if (!/\S/.test(String(text || ''))) throw new Error(`"${name}" is empty.`);
    if (/^CG3B|\x00/.test(String(text).slice(0, 16))) {
      throw new Error(`"${name}" looks like a compiled .bin grammar. Upload the .cg3 source file.`);
    }
    const { Cg } = await import('../lib/jscg3/index.js');
    new Cg([text]); // throws a GrammarError at once if it cannot be read, so a broken file is not kept
    const list = await this.getGrammars(lang);
    const entry = { name, text, timestamp: Date.now() };
    const i = list.findIndex(g => g.name === name);
    if (i >= 0) list[i] = entry; else list.push(entry);
    await storageService.setSetting(key(lang), list);
    this._engines.delete(lang);
    return list;
  }

  async removeGrammar(lang, name) {
    const list = (await this.getGrammars(lang)).filter(g => g.name !== name);
    await storageService.setSetting(key(lang), list);
    this._engines.delete(lang);
    return list;
  }

  async hasGrammar(lang) {
    return (await this.getGrammars(lang)).length > 0;
  }

  async _engine(lang) {
    const grammars = await this.getGrammars(lang);
    if (!grammars.length) return null;
    const signature = grammars.map(g => `${g.name}:${g.timestamp}`).join('|');
    const cached = this._engines.get(lang);
    if (cached && cached.signature === signature) return cached.cg;
    const { Cg } = await import('../lib/jscg3/index.js');
    const cg = new Cg(grammars.map(g => g.text), { names: grammars.map(g => g.name) });
    this._engines.set(lang, { signature, cg });
    return cg;
  }

  /**
   * Runs the language's grammars over analyzed sentences, one sentence at a time.
   * @param {Array<{tokens: Array<Object>}>} sentences  analyzerService.analyzeText output
   * @param {string} lang
   * @returns {Promise<string|null>} the CG stream after disambiguation, or null when the language has no grammar
   */
  async disambiguate(sentences, lang) {
    const cg = await this._engine(lang);
    if (!cg) return null;
    const out = [];
    for (const sent of sentences || []) {
      const stream = HfstRawExporter.export([sent], { forCg: true });
      if (stream) out.push(cg.runText(stream + '\n').replace(/\n+$/, ''));
    }
    return out.join('\n\n');
  }
}

export const cg3Service = new Cg3Service();
