// The library entry point: analyses in the shape pyhfst gives, what the Constraint Grammars make of them out.
//
//   import { Cg } from 'jscg3';
//   const cg = new Cg([disambiguatorText, functionsText]);          // grammar texts you provide
//   const result = cg.disambiguate(['Time', 'flies'], morphologies);  // morphologies as pyhfst's lookup gives them
//   result[0]   ->  ['Time', [CgWord, CgWord, ...]]
//
// `morphologies` has one entry per word, each a list of [analysis, weight] pairs, e.g.
//   [[['time+N+Sg', 0.0], ['time+V+Inf', 0.0]], [['fly+V+Prs+Sg3', 0.0], ['fly+N+Pl', 0.0]]]
// jscg3 knows no language: the analyser and the grammars are yours. Several grammars run one after the other,
// each taking the previous one's output, like `vislcg3 -g a | vislcg3 -g b`.

import { Disambiguator } from './engine.js';
import { Grammar, GrammarParser } from './grammar.js';

const VARIANT = /^v\d+$/;            // +v1: a variant mark of some analysers, not a tag of the grammars
const WEIGHT = /^<W:([-+0-9.eE]+)>$/;

/** A number the way Python's str(float(x)) writes it: 0.0, 2.0, 0.5, 1e-05. */
export function pyFloat(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : (x > 0 ? 'inf' : '-inf');
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mant, exp] = x.toExponential().split('e');
  const e = parseInt(exp, 10);
  if (e < -4 || e >= 16) return `${mant}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  const s = String(x);
  return Number.isInteger(x) ? s + '.0' : s;
}

/**
 * One analysis string as the lines of a CG reading. A compound (parts joined by #) becomes a reading for the last
 * part with the earlier parts as sub-readings, each one tab deeper, as hfst-tokenise -g writes it.
 */
export function analysisToCg(analysis, weight = 0.0, { dropVariants = true } = {}) {
  const parts = analysis.split('#').map((part) => {
    const [lemma, ...rest] = part.split('+');
    return [lemma, dropVariants ? rest.filter((t) => !VARIANT.test(t)) : rest];
  });
  const lines = [];
  [...parts].reverse().forEach(([lemma, tags], k) => {
    const depth = k + 1;
    const w = depth === 1 ? ` <W:${pyFloat(weight)}>` : '';
    lines.push('\t'.repeat(depth) + `"${lemma}"` + (tags.length ? ' ' + tags.join(' ') : '') + w);
  });
  return lines;
}

/** The CG input stream for words and their pyhfst analyses. A word without analyses is unknown: "w" ? */
export function analysesToCg(words, morphologies, options = {}) {
  const out = [];
  words.forEach((word, index) => {
    if (!word) return;
    const analyses = index < morphologies.length ? morphologies[index] : [];
    out.push(`"<${word}>"`);
    const seen = new Set();
    for (const item of analyses) {
      const analysis = item[0];
      const weight = item.length > 1 ? item[1] : 0.0;
      if (seen.has(analysis)) continue;
      seen.add(analysis);
      out.push(...analysisToCg(analysis, weight, options));
    }
    if (!seen.size) out.push(`\t"${word}" ?`);
  });
  return out.join('\n') + '\n';
}

/**
 * One reading of one word as a grammar leaves it. Same attributes as UralicNLP's Cg3Word (form, lemma, morphology)
 * plus the pieces: tags (without the weight tag), weight, subReadings (compound parts) and trace (with trace: true).
 */
export class CgWord {
  constructor(form, lemma, morphology, subReadings = null, trace = null) {
    this.form = form;
    this.lemma = lemma;
    this.morphology = morphology;                       // all tags, as written, the <W:..> tag included
    this.tags = morphology.filter((t) => !WEIGHT.test(t));
    const m = morphology.map((t) => WEIGHT.exec(t)).find((x) => x);
    this.weight = m ? Number(m[1]) : 0.0;
    this.subReadings = subReadings || [];
    this.trace = trace || [];
  }

  /** Back to the shape pyhfst gives: ["lemma+Tag+Tag", weight]; the next tool can take it from there. */
  analysis() {
    return [this.lemma + this.tags.map((t) => '+' + t).join(''), this.weight];
  }

  toString() {
    return `<${this.lemma} - ${this.morphology.join(', ')}>`;
  }
}

function readingToWord(form, reading, keepTrace) {
  const subs = reading.subReadings.map((sub) => readingToWord(form, sub, keepTrace));
  return new CgWord(form, reading.baseform.replace(/^"+|"+$/g, ''), [...reading.tags], subs, keepTrace ? [...reading.trace] : null);
}

/** A chain of Constraint Grammars (disambiguator, then functions, then dependency, ...). */
export class Cg {
  /** grammars: parsed Grammar objects or grammar texts. names label the stages. */
  constructor(grammars, { names = null, trace = false } = {}) {
    const parsed = grammars.map((g) => (g instanceof Grammar ? g : new GrammarParser().parse(g)));
    this.names = names ? [...names] : parsed.map((_, i) => `stage${i + 1}`);
    this.trace = trace;
    this._engines = parsed.map((g, i) => new Disambiguator(g, { trace: trace && i === parsed.length - 1 }));
  }

  /** Grammar texts, run in the order given. */
  static fromTexts(texts, options = {}) {
    return new Cg(texts, options);
  }

  /** A CG stream through all the grammars; the stream out. */
  runText(cgInput) {
    let text = cgInput;
    this._engines.forEach((engine, number) => {
      const last = number === this._engines.length - 1;
      const windows = [...engine.runStream(text)];
      text = windows.map((w) => w.toText({ trace: this.trace && last, pipeDeleted: false }) + '\n').join('');
    });
    return text;
  }

  /**
   * [[word, [CgWord, ...]], ...] for the words, in order. morphologies: one list of [analysis, weight] pairs
   * per word, as pyhfst's lookup gives them. options go to analysisToCg (dropVariants).
   */
  disambiguate(words, morphologies, options = {}) {
    // empty words (UralicNLP ends a sentence with one) carry no cohort; drop them with their analyses
    const kept = [];
    words.forEach((w, i) => {
      if (w) kept.push([w, i < morphologies.length ? morphologies[i] : []]);
    });
    const ws = kept.map(([w]) => w);
    const ms = kept.map(([, m]) => m);
    const engines = this._engines;
    let text = analysesToCg(ws, ms, options);
    for (const engine of engines.slice(0, -1)) {
      text = [...engine.runStream(text)].map((w) => w.toText({ pipeDeleted: false }) + '\n').join('');
    }
    const out = [];
    for (const window of engines[engines.length - 1].runStream(text)) {
      for (const cohort of window.cohorts) {
        const form = cohort.wordform.slice(2, -2);
        out.push([form, cohort.orderedReadings().filter((r) => !r.deleted).map((r) => readingToWord(form, r, this.trace))]);
      }
    }
    return out;
  }

  /** A result as pyhfst-shaped analyses again. */
  toMorphologies(result) {
    return [...result].map(([, readings]) => readings.map((w) => w.analysis()));
  }
}
