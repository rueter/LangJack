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
import { analyzerService, normalizeLangCode } from './analyzer-service.js';

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

const MIRRORS = [
  (lang, file) => `https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/${lang}/${file}`,
  (lang, file) => `https://cdn.jsdelivr.net/gh/Rootroo-ltd/uralicnlpmodels@main/nightly/${lang}/${file}`,
  (lang, file) => `http://models.uralicnlp.com/nightly/${lang}/${file}`,
  (lang, file) => `https://models.uralicnlp.com/nightly/${lang}/${file}`
];

/** The grammar files UralicNLP's nightly models may hold for a language, in run order. */
export const URALIC_CG3_FILES = ['disambiguator.cg3', 'functions.cg3', 'dependency.cg3'];

export class Cg3Service {
  constructor() {
    this._engines = new Map(); // lang -> { signature, parsed }
    this.lastRun = { analyser: 'main', note: '' }; // what the last disambiguate() read its cohorts from
  }

  /** @returns {Promise<Array<{name: string, text: string, timestamp: number}>>} grammars of the language, in run order */
  async getGrammars(lang) {
    const list = await storageService.getSetting(key(lang), []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Adds a grammar for the language; a grammar with the same file name is replaced in its place.
   * @param {string} [source='upload']  'upload' (the user's own file) or 'uralic' (UralicNLP's nightly model)
   */
  async saveGrammar(lang, name, text, source = 'upload') {
    if (!/\S/.test(String(text || ''))) throw new Error(`"${name}" is empty.`);
    if (/^CG3B|\x00/.test(String(text).slice(0, 16))) {
      throw new Error(`"${name}" looks like a compiled .bin grammar. Upload the .cg3 source file.`);
    }
    const { Cg } = await import('../lib/jscg3/index.js');
    new Cg([text]); // throws a GrammarError at once if it cannot be read, so a broken file is not kept
    const list = await this.getGrammars(lang);
    const entry = { name, text, timestamp: Date.now(), source };
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

  /**
   * Fetches the language's grammar files from UralicNLP's nightly models (disambiguator.cg3, and functions.cg3 and
   * dependency.cg3 where it has them) and keeps them in this browser, replacing the UralicNLP copies of earlier
   * fetches. A file of the same name that the user uploaded is left alone.
   * @returns {Promise<{added: string[], skipped: string[], missing: string[], errors: string[]}>}
   */
  async fetchFromUralic(lang) {
    const code = normalizeLangCode(lang);
    const res = { added: [], skipped: [], missing: [], errors: [] };
    for (const file of URALIC_CG3_FILES) {
      const have = (await this.getGrammars(code)).find(g => g.name === file);
      if (have && have.source !== 'uralic') { res.skipped.push(file); continue; } // the user's own file wins
      let text = null;
      let failure = null;
      for (const url of MIRRORS.map(m => m(code, file))) {
        try {
          const r = await fetch(`${url}?_t=${Date.now()}`, { cache: 'reload' });
          if (r.status === 404) { failure = 'missing'; if (url.includes('raw.githubusercontent.com')) break; continue; } // the repository has no such file
          if (!r.ok) { failure = `HTTP ${r.status} from ${url}`; continue; }
          const body = await r.text();
          if (/^version https:\/\/git-lfs/.test(body)) { failure = `${url} sent a Git LFS pointer`; continue; }
          text = body;
          break;
        } catch (err) {
          failure = err.message;
        }
      }
      if (text === null) {
        if (failure === 'missing') res.missing.push(file); else res.errors.push(`${file}: ${failure || 'no answer'}`);
        continue;
      }
      try {
        await this.saveGrammar(code, file, text, 'uralic');
        res.added.push(file);
      } catch (err) {
        res.errors.push(`${file}: ${err.message}`);
      }
    }
    return res;
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
   * @param {boolean} [options.trace]        like vislcg3 -t: each reading carries the rules that selected or mapped it (RULE:line); implies showDeleted
   * @param {boolean} [options.showDeleted]  like vislcg3 -p: removed readings stay, with a ";" in front (and their rule with trace)
   * @param {string}  [options.upTo]         file name of the last grammar to run; its output is what is shown (default: all)
   * @returns {Promise<string|null>} the CG stream after disambiguation, or null when the language has no grammar
   */
  async disambiguate(sentences, lang, { trace = false, showDeleted = false, upTo = null } = {}) {
    if (trace) showDeleted = true; // a trace without the removed readings does not show what a REMOVE or SELECT rule did
    let stages = await this._parsed(lang);
    if (!stages.length) return null;
    if (upTo) {
      const n = stages.findIndex(st => st.name === upTo);
      if (n >= 0) stages = stages.slice(0, n + 1);
    }
    const { Disambiguator } = await import('../lib/jscg3/index.js');

    // GiellaLT's grammars are written for analyser-disamb-gt-desc, which keeps the +Sem/, +Hom and +Err/Orth tags the
    // rules read. So the cohorts are made from that analyser's analyses when UralicNLP has it for the language (fetched
    // once, then kept in this browser); otherwise from the ordinary analyser, as UralicNLP's own Cg3 does.
    const grammars = await this.getGrammars(lang);
    let readingsFor = null;
    this.lastRun = { analyser: 'main', note: '' };
    const disamb = await analyzerService.ensureDisambAnalyserForLanguage(lang);
    if (disamb) {
      readingsFor = (tok) => analyzerService.analyzeForCg(tok.form, lang);
      this.lastRun = { analyser: 'disamb', note: analyzerService.disambNames.get(normalizeLangCode(lang)) || 'analyser-disamb-gt-desc' };
    } else if (grammars.some(g => /\b(?:Sem|Err)\/|\bHom\d/.test(g.text))) {
      this.lastRun = { analyser: 'main', note: 'no analyser-disamb-gt-desc for this language: the ordinary analyser feeds the grammar, so rules that read +Sem/, +Hom or +Err/ tags may not act' };
    }
    const engines = stages.map((st, i) => new Disambiguator(st.grammar, { trace: trace && i === stages.length - 1 }));
    const out = [];
    for (const sent of sentences || []) {
      let text = HfstRawExporter.export([sent], { forCg: true, readingsFor });
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
