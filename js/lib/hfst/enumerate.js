import { TRANSITION_TARGET_TABLE_START, NO_SYMBOL_NUMBER } from './constants.js';
import { State } from './state.js';
import { FlagDiacriticOperator } from './flag_diacritic_operation.js';

/**
 * Lists the paths of an optimised-lookup transducer (hfstol) that start with a given string, which hfst-lookup
 * cannot do: lookup needs the whole input, here only the beginning of one side is known.
 *
 * For an analyser (surface -> analysis) the lemma is the beginning of the OUTPUT side: side 'output'.
 * For a generator (analysis -> surface) it is the beginning of the INPUT side: side 'input'.
 * After the lemma only tag symbols ("+N", "+Sg", ...) may follow on that side, so "kala" does not run on into
 * "kalan" or "kala#puu"; the other side (the surface form) is free.
 *
 * The walk is bounded: a number of tags after the lemma, derivation tags only when asked for (and then at most
 * maxDer of them), a time limit and a step limit. `truncated` in the result says whether a limit stopped it.
 */

/** @param {import('./flag_diacritic_operation.js').FlagDiacriticOperation} flag @param {number[]} top @returns {number[]|null} the new flag state, null when the flag blocks the path */
function applyFlag(flag, top) {
  const next = top.slice();
  switch (flag.op) {
    case FlagDiacriticOperator.P: next[flag.feature] = flag.value; return next;
    case FlagDiacriticOperator.N: next[flag.feature] = -1 * flag.value; return next;
    case FlagDiacriticOperator.R:
      if (flag.value === 0) return top[flag.feature] === 0 ? null : next;
      return top[flag.feature] === flag.value ? next : null;
    case FlagDiacriticOperator.D:
      if (flag.value === 0) return top[flag.feature] !== 0 ? null : next;
      return top[flag.feature] === flag.value ? null : next;
    case FlagDiacriticOperator.C: next[flag.feature] = 0; return next;
    case FlagDiacriticOperator.U:
      if (top[flag.feature] === 0 || top[flag.feature] === flag.value || top[flag.feature] < 0) {
        next[flag.feature] = flag.value;
        return next;
      }
      return null;
    default: return null;
  }
}

const isDerTag = (s) => /^\+Der(?:[/\d]|$)/.test(s);
const isErrTag = (s) => /^\+Err(?:\/|$)/.test(s);

/**
 * @param {import('./core.js').Hfst} hfst  a loaded transducer
 * @param {string} lemma  the beginning of the fixed side (the headword)
 * @param {Object} [options]
 * @param {'input'|'output'} [options.side='output']  the side the lemma is on
 * @param {boolean} [options.allowDer=false]  let derivation tags (+Der/...) through
 * @param {number} [options.maxDer=1]  most derivation tags on one path
 * @param {RegExp|null} [options.skipTags=null]  tags that are never taken (for example clitics)
 * @param {RegExp|null} [options.skipAfterDer=null]  tags that end a path once a derivation tag has been taken
 *   (a derived word's possessive suffixes and clitics, which would multiply every derivation)
 * @param {number} [options.maxTags=14]  most tags after the lemma on one path
 * @param {number} [options.maxMs=20000]
 * @param {number} [options.maxSteps=4000000]
 * @param {number} [options.maxPaths=50000]
 * @returns {{paths: Array<{tags: string[], surface: string, weight: number}>, truncated: boolean, steps: number}}
 *   tags: the tag symbols after the lemma, in transducer order; tagIds: their symbol numbers in the transducer's
 *   alphabet; surface: the other side
 */
export function enumerateFromLemma(hfst, lemma, options = {}) {
  const {
    side = 'output', allowDer = false, maxDer = 1, skipTags = null, skipAfterDer = null, maxTags = 14, maxMs = 20000, maxSteps = 4000000, maxPaths = 50000
  } = options;
  const tr = hfst.tr || hfst;
  const key = tr.alphabet.keyTable;
  const ops = tr.operations;
  const weighted = tr.is_weighted;
  const tt = tr.transition_table;
  const it = tr.index_table;
  const alphabetSize = key.length;

  const out = { paths: [], truncated: false, steps: 0 };
  const prefix = Array.from(new State(lemma, tr).input_string);
  prefix.pop(); // the end marker
  if (!prefix.length || prefix.includes(NO_SYMBOL_NUMBER)) return out; // a letter the transducer does not have

  const fixedIsOutput = side === 'output';
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const tags = [];
  const tagIds = [];
  const free = [];
  let fixedPos = 0;
  let derCount = 0;
  let weight = 0;
  let stop = false;

  const note = () => {
    if (fixedPos === prefix.length && tags.length > 0) {
      out.paths.push({ tags: tags.slice(), tagIds: tagIds.slice(), surface: free.join(''), weight });
      if (out.paths.length >= maxPaths) { out.truncated = true; stop = true; }
    }
  };

  /** One transition (position j of the transition table), taken from a state whose flag state is `flags`. */
  function take(j, flags, depth) {
    const inSym = tt.getInput(j);
    const outSym = tt.getOutput(j);
    const target = tt.getTarget(j);
    const w = weighted ? tt.getWeight(j) : 0;

    let nextFlags = flags;
    const op = ops[inSym];
    if (op) {
      nextFlags = applyFlag(op, flags);
      if (!nextFlags) return;
    }
    const fixedSym = fixedIsOutput ? outSym : inSym;
    const freeSym = fixedIsOutput ? inSym : outSym;

    // the fixed side: the lemma, then tags only
    const fixedStr = fixedSym !== 0 ? key[fixedSym] : ''; // flag diacritics and epsilon have the empty string
    let pushedTag = false;
    let advancedFixed = false;
    let wasDer = false;
    if (fixedStr !== '') {
      if (fixedPos < prefix.length) {
        if (fixedSym !== prefix[fixedPos]) return;
        fixedPos++;
        advancedFixed = true;
      } else {
        if (fixedStr.length < 2 || fixedStr[0] !== '+') return; // lemma over: only tags
        if (isErrTag(fixedStr)) return;
        if (isDerTag(fixedStr)) {
          if (!allowDer || derCount >= maxDer) return;
          // a derivation belongs to the stem: straight after the part of speech, or after the part of speech of an earlier derivation
          if (!(tags.length === 1 || (tags.length >= 3 && isDerTag(tags[tags.length - 2])))) return;
          derCount++;
          wasDer = true;
        }
        if (skipTags && skipTags.test(fixedStr)) return;
        if (derCount > 0 && !wasDer && skipAfterDer && skipAfterDer.test(fixedStr)) return;
        if (tags.length >= maxTags) return;
        tags.push(fixedStr);
        tagIds.push(fixedSym);
        pushedTag = true;
      }
    }
    // the free side
    let pushedFree = false;
    if (freeSym !== 0 && key[freeSym] !== '') {
      if (free.length > 90) { // a runaway surface form: undo and drop the path
        if (advancedFixed) fixedPos--;
        if (pushedTag) { tags.pop(); tagIds.pop(); }
        if (wasDer) derCount--;
        return;
      }
      free.push(key[freeSym]);
      pushedFree = true;
    }
    weight += w;
    walk(target, nextFlags, depth + 1);
    weight -= w;
    if (pushedFree) free.pop();
    if (pushedTag) { tags.pop(); tagIds.pop(); }
    if (wasDer) derCount--;
    if (advancedFixed) fixedPos--;
  }

  /** All transitions out of the state `target` (raw table pointer), and its final weight. */
  function walk(target, flags, depth) {
    if (stop) return;
    if ((++out.steps & 1023) === 0 && now() - start > maxMs) { out.truncated = true; stop = true; return; }
    if (out.steps > maxSteps || depth > 500) { out.truncated = true; stop = true; return; }

    const isTrans = target >= TRANSITION_TARGET_TABLE_START;
    const index = isTrans ? target - TRANSITION_TARGET_TABLE_START : target;

    // a final state ends a path
    if (isTrans) {
      if (tt.size() > index && tt.isFinal(index)) {
        const fw = weighted ? tt.getWeight(index) : 0;
        weight += fw; note(); weight -= fw;
      }
      for (let j = index + 1; j < tt.size() && !stop; j++) {
        if (tt.getInput(j) === NO_SYMBOL_NUMBER) break;
        take(j, flags, depth);
      }
    } else {
      if (it.isFinal(index)) {
        const fw = weighted ? it.getFinalWeight(index) : 0;
        weight += fw; note(); weight -= fw;
      }
      for (let s = 0; s < alphabetSize && !stop; s++) {
        const slot = index + 1 + s;
        if (it.getInput(slot) !== s) continue;
        let j = it.getTarget(slot);
        if (j >= TRANSITION_TARGET_TABLE_START) j -= TRANSITION_TARGET_TABLE_START;
        if (s === 0) {
          // epsilon and flag diacritic transitions
          for (; j < tt.size() && !stop; j++) {
            const inp = tt.getInput(j);
            if (inp === 0 || ops[inp]) take(j, flags, depth); else break;
          }
        } else {
          for (; j < tt.size() && !stop; j++) {
            if (tt.getInput(j) !== s) break;
            take(j, flags, depth);
          }
        }
      }
    }
  }

  const neutral = new Array(tr.alphabet.features).fill(0);
  walk(0, neutral, 0);
  return out;
}
