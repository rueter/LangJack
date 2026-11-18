/**
 * Constraint Grammar disambiguation (VISL CG-3 grammars such as GiellaLT's src/cg3/disambiguator.cg3), run in the
 * browser by @rueter/jscg3 (js/lib/jscg3, MIT). The grammars are the user's own: they are uploaded in Manage HFST
 * Models & Dictionaries, kept in this browser per language and never sent anywhere.
 *
 * Several grammars for one language run one after the other, each taking the previous one's output, in the order
 * GiellaLT uses: disambiguator.cg3, then functions.cg3, then dependency.cg3 (other files after those, in the order
 * they were added). The output can be shown after any one of them (`upTo`), with the rules that acted (`trace`, -t)
 * and the readings that were removed (`showDeleted`, -p).
 */

import { storageService } from './storage-service.js';
import { HfstRawExporter } from './hfst-raw-exporter.js';

const key = (lang) => `cg3_grammars_${String(lang || '').toLowerCase()}`;

/**
 * A file name may start with the language code and "_" or "-" (myv_disambiguator.cg3, sms-functions.cg3): that
 * language is then used, whatever is chosen in the language list. Without a prefix the file is for the chosen language.
 * @returns {{lang: string|null, base: string}}
 */
export function splitLangPrefix(name) {
  const m = /^([a-z]{3})[_-](.+)$/i.exec(String(name || ''));
  return m ? { lang: m[1].toLowerCase(), base: m[2] } : { lang: null, base: String(name || '') };
}

/** Where a grammar file belongs in the chain: disambiguator, then functions, then dependency, others last. */
export function grammarRank(name) {
  const n = splitLangPrefix(name).base.toLowerCase();
  if (/^disamb/.test(n)) return 0;
  if (/^function/.test(n)) return 1;
  if (/^dependenc/.test(n)) return 2;
  return 3;
}

export class Cg3Service {
  constructor() {
    this._engines = new Map(); // lang -> { signature, parsed }
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
    list.sort((x, y) => grammarRank(x.name) - grammarRank(y.name)); // stable: files of the same kind keep their order
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

  /** The language's grammars, parsed (once per set of uploaded files). */
  async _parsed(lang) {
    const grammars = await this.getGrammars(lang);
    if (!grammars.length) return [];
    const signature = grammars.map(g => `${g.name}:${g.timestamp}`).join('|');
    const cached = this._engines.get(lang);
    if (cached && cached.signature === signature) return cached.parsed;
    const { GrammarParser } = await import('../lib/jscg3/index.js');
    const parsed = grammars.map(g => ({ name: g.name, grammar: new GrammarParser().parse(g.text) }));
    this._engines.set(lang, { signature, parsed });
    return parsed;
  }

  /**
   * Runs the language's grammars over analyzed sentences, one sentence at a time.
   * @param {Array<{tokens: Array<Object>}>} sentences  analyzerService.analyzeText output
   * @param {string} lang
   * @param {Object} [options]
   * @param {boolean} [options.trace]        like vislcg3 -t: each reading carries the rules that selected or mapped it (RULE:line)
   * @param {boolean} [options.showDeleted]  like vislcg3 -p: removed readings stay, with a ";" in front (and their rule with trace)
   * @param {string}  [options.upTo]         file name of the last grammar to run; its output is what is shown (default: all)
   * @returns {Promise<string|null>} the CG stream after disambiguation, or null when the language has no grammar
   */
  async disambiguate(sentences, lang, { trace = false, showDeleted = false, upTo = null } = {}) {
    let stages = await this._parsed(lang);
    if (!stages.length) return null;
    if (upTo) {
      const n = stages.findIndex(st => st.name === upTo);
      if (n >= 0) stages = stages.slice(0, n + 1);
    }
    const { Disambiguator } = await import('../lib/jscg3/index.js');
    // engines are made afresh: a Disambiguator marks its grammar with the trace setting it is built with
    const engines = stages.map((st, i) => new Disambiguator(st.grammar, { trace: trace && i === stages.length - 1 }));
    const out = [];
    for (const sent of sentences || []) {
      let text = HfstRawExporter.export([sent], { forCg: true });
      if (!text) continue;
      text += '\n';
      engines.forEach((engine, i) => {
        const shown = i === engines.length - 1; // only what is shown carries trace and removed readings
        text = engine.runText(text, { trace: trace && shown, pipeDeleted: showDeleted && shown });
      });
      out.push(text.replace(/\n+$/, ''));
    }
    return out.join('\n\n');
  }
}

export const cg3Service = new Cg3Service();
