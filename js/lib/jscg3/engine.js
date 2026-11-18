// Execution engine for VISL CG-3.

import { parseStream, linesOf } from './stream.js';
import { setAlwaysSpan } from './context.js';
import { SingleWindow } from './cohort.js';

/** Executes a VISL CG-3 grammar over a stream of SingleWindows. */
export class Disambiguator {
  constructor(grammar, {
    maxIterations = 50, trace = false, depNoCrossing = false, depAllowLoops = false, numWindows = 2, alwaysSpan = false,
  } = {}) {
    this.numWindows = numWindows;       // --num-windows: windows kept behind and read ahead for tests with W < >
    this.alwaysSpan = alwaysSpan;       // --always-span: every scan goes across window boundaries
    this.grammar = grammar;
    grammar.traceMode = trace;          // as with vislcg3 -t, readings that rules hit differently stay apart
    grammar.depBlockCrossing = depNoCrossing;        // --dep-no-crossing
    grammar.depBlockLoops = !depAllowLoops;          // --dep-allow-loops
    this.maxIterations = maxIterations;
    this._relationMap = new Map();      // input ID:n -> cohort, for the R:name:n tags of the input
  }

  /** Run all sections on a single window. */
  runWindow(window, numSections = null) {
    setAlwaysSpan(this.alwaysSpan);
    window.markEnd();
    window.resolveInputDependencies();
    if (this.grammar.hasRelations) window.resolveInputRelations(this._relationMap);
    // 1. BEFORE-SECTIONS
    for (const rule of this.grammar.beforeSections) rule.applyToWindow(window, this.grammar);

    // 2. SECTIONS. As in vislcg3, running section k means running the rules of sections 1..k, over and
    // over until a whole pass changes nothing; only then does the next section join in.
    let sectionsToRun = this.grammar.sections;
    if (numSections !== null && numSections !== undefined) sectionsToRun = sectionsToRun.slice(0, numSections);

    let rulesSoFar = [];
    for (const sectionRules of sectionsToRun) {
      rulesSoFar = rulesSoFar.concat(sectionRules);
      for (let n = 0; n < this.maxIterations; n++) {
        let changed = false;
        for (const rule of rulesSoFar) {
          if (rule.applyToWindow(window, this.grammar) && rule.iterates) changed = true;
        }
        if (!changed) break;
      }
    }

    // 3. AFTER-SECTIONS
    for (const rule of this.grammar.afterSections) rule.applyToWindow(window, this.grammar);

    // vislcg3 lets identical readings of the input be (rules see, and may trace, each of them) and merges them
    // when the window is done
    const traceMode = Boolean(this.grammar.traceMode);
    for (const cohort of window.cohorts) cohort.dedupeReadings(traceMode);
    return window;
  }

  /**
   * Streamingly process windows from an iterable of lines (or a string).
   *
   * Like vislcg3 this keeps a few windows around the one being run, so that contextual tests with W, < and > can look
   * into them: the windows already run (the last `numWindows` of them) and the ones read ahead (`numWindows` full ones,
   * and the begin cohort of the one after, which is there as soon as it has been started). A window is handed on once
   * it falls out of the windows behind. FLUSH in the input runs and hands on everything.
   */
  * runStream(lines, numSections = null) {
    const mp = this.grammar ? this.grammar.mappingPrefix : '@';
    if (typeof lines === 'string') lines = linesOf(lines);
    const ahead = this.numWindows + 2;     // vislcg3 runs a window when this many are waiting, the new one included
    this.grammar.depHasSpanned = false;    // becomes true when a dependency goes from one window to another
    let counter = 0;
    let depOn = false;                     // vislcg3 starts printing #n->m once dependencies are in play (read, or a rule tried to attach)
    const waiting = [];                    // read, not run yet
    const behind = [];                     // run, not handed on yet

    const handOn = (win) => {
      win.depSpanned = this.grammar.depHasSpanned;     // numbered globally if a dependency has spanned by the time it is written
      win.depPrint = depOn;                            // ... and only written with #n->m if dependencies were in play by then
      return win;
    };
    const runFirst = (phantom) => {
      const out = [];
      while (behind.length > this.numWindows) {        // vislcg3 writes the window that falls out of the ones behind before it runs the next
        const done = behind.shift();
        if (behind.length) behind[0].previous = null;
        out.push(handOn(done));
      }
      const win = waiting.shift();
      let hidden = null;
      if (phantom && waiting.length) {                 // the begin cohort of the window being started is already there
        hidden = waiting[waiting.length - 1];
        const stub = new SingleWindow();
        stub.begin = hidden.begin;
        stub.previous = waiting.length > 1 ? waiting[waiting.length - 2] : win;
        stub.next = null;
        stub.previous.next = stub;
        waiting[waiting.length - 1] = stub;
      }
      if (behind.length) {
        win.previous = behind[behind.length - 1];
        win.previous.next = win;
      }
      this.runWindow(win, numSections);
      depOn = depOn || win.hasDep;
      if (hidden !== null) {
        waiting[waiting.length - 1] = hidden;
        hidden.previous.next = hidden;
      }
      win.next = waiting.length ? waiting[0] : null;
      behind.push(win);
      return out;
    };

    for (const window of parseStream(lines, this.grammar.delimiters, mp, 500, this.grammar.hasRelations, this.grammar.hasDep)) {
      counter++;
      if (window.cohorts.some((c) => c.depIn !== null)) depOn = true;
      window.number = counter;
      window.markEnd();
      if (waiting.length) {
        waiting[waiting.length - 1].next = window;
        window.previous = waiting[waiting.length - 1];
      } else if (behind.length) {
        behind[behind.length - 1].next = window;
        window.previous = behind[behind.length - 1];
      }
      waiting.push(window);
      const flush = window.flushAfter;
      while (waiting.length >= ahead && !flush) yield* runFirst(true);
      if (flush) {
        while (waiting.length) yield* runFirst(false);
        while (behind.length) yield handOn(behind.shift());
      }
    }
    while (waiting.length) yield* runFirst(false);
    while (behind.length) yield handOn(behind.shift());
  }

  /** Run grammar on input string and return formatted output string. */
  runText(inputText, { numSections = null, showRules = false, trace = false, pipeDeleted = false } = {}) {
    const windows = [...this.runStream(inputText, numSections)];
    const parts = windows.map((w) => w.toText({ showRules, trace, pipeDeleted }));
    return parts.join('\n') + (parts.length ? '\n' : '');
  }
}
