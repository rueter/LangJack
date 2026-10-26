import { TRANSITION_TARGET_TABLE_START, NO_SYMBOL_NUMBER } from './constants.js';
import { State } from './state.js';
import { Result } from './result.js';
import { FlagDiacriticOperator } from './flag_diacritic_operation.js';

/**
 * Returns current timestamp in seconds.
 * Uses performance.now if available, otherwise Date.now.
 * @returns {number}
 */
function getNowSeconds() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

/**
 * Core traversal analyzer for HFST transducers.
 */
export class Analyzer {
  /**
   * @param {import('./transducer.js').Transducer} transducer
   * @param {string} inputStr
   * @param {number} [timeCutoff=0.0] - Maximum time in seconds for the lookup operation (0.0 = no limit)
   */
  constructor(transducer, inputStr, timeCutoff = 0.0) {
    this.transducer = transducer;
    this.input_str = inputStr;
    this.inputStr = inputStr;
    this.state = new State(inputStr, this.transducer);
    this.time_cutoff = timeCutoff;
    this.timeCutoff = timeCutoff;
    this.start_time = timeCutoff > 0.0 ? getNowSeconds() : 0.0;
    this.startTime = this.start_time;
  }

  /**
   * Computes the pivot for the given index.
   * If i >= TRANSITION_TARGET_TABLE_START (2^31), shifts it to point into the transition table.
   * @param {number} i
   * @returns {number}
   */
  pivot(i) {
    if (i >= TRANSITION_TARGET_TABLE_START) {
      return i - TRANSITION_TARGET_TABLE_START;
    }
    return i;
  }

  /**
   * Checks if the time cutoff has been exceeded.
   * @returns {boolean}
   */
  isTimeExceeded() {
    if (this.timeCutoff > 0.0) {
      const elapsed = getNowSeconds() - this.startTime;
      return elapsed > this.timeCutoff;
    }
    return false;
  }

  is_time_exceeded() {
    return this.isTimeExceeded();
  }

  /**
   * Tries epsilon indices for the given index.
   * @param {number} index
   */
  tryEpsilonIndices(index) {
    if (this.transducer.index_table.getInput(index) === 0) {
      this.tryEpsilonTransitions(
        this.pivot(this.transducer.index_table.getTarget(index))
      );
    }
  }

  try_epsilon_indices(index) {
    this.tryEpsilonIndices(index);
  }

  /**
   * Tries epsilon transitions for the given index.
   * @param {number} index
   */
  tryEpsilonTransitions(index) {
    while (true) {
      const inputSymbol = this.transducer.transition_table.getInput(index);

      if (this.transducer.operations[inputSymbol]) {
        if (!this.pushState(this.transducer.operations[inputSymbol])) {
          index++;
          continue;
        }
        this.handleEpsilonTransition(index);
        index++;
        this.state.state_stack.pop();
        continue;
      } else if (inputSymbol === 0) {
        this.handleEpsilonTransition(index);
        index++;
        continue;
      } else {
        break;
      }
    }
  }

  try_epsilon_transitions(index) {
    this.tryEpsilonTransitions(index);
  }

  /**
   * Finds the index in the transducer for the given index.
   * @param {number} index
   */
  findIndex(index) {
    const prevSym = this.state.input_string[this.state.input_pointer - 1];
    if (this.transducer.index_table.getInput(index + prevSym) === prevSym) {
      this.findTransitions(
        this.pivot(this.transducer.index_table.getTarget(index + prevSym))
      );
    }
  }

  find_index(index) {
    this.findIndex(index);
  }

  /**
   * Handles epsilon transitions for the given index.
   * @param {number} index
   */
  handleEpsilonTransition(index) {
    this.updateOutputString(this.transducer.transition_table.getOutput(index));
    this.state.output_pointer++;

    if (this.transducer.is_weighted) {
      this.state.current_weight += this.transducer.transition_table.getWeight(index);
    }

    this.getAnalyses(this.transducer.transition_table.getTarget(index));

    if (this.transducer.is_weighted) {
      this.state.current_weight -= this.transducer.transition_table.getWeight(index);
    }

    this.state.output_pointer--;
  }

  handle_epsilon_transition(index) {
    this.handleEpsilonTransition(index);
  }

  /**
   * Finds transitions in the transducer for the given index.
   * @param {number} index
   */
  findTransitions(index) {
    const tableSize = this.transducer.transition_table.size();
    const prevSym = this.state.input_string[this.state.input_pointer - 1];

    for (let idx = index; idx < tableSize; idx++) {
      const inputSymbol = this.transducer.transition_table.getInput(idx);

      if (inputSymbol === NO_SYMBOL_NUMBER) {
        break;
      }

      if (inputSymbol === prevSym) {
        this.updateOutputString(this.transducer.transition_table.getOutput(idx));
        this.state.output_pointer++;

        if (this.transducer.is_weighted) {
          this.state.current_weight += this.transducer.transition_table.getWeight(idx);
        }

        this.getAnalyses(this.transducer.transition_table.getTarget(idx));

        if (this.transducer.is_weighted) {
          this.state.current_weight -= this.transducer.transition_table.getWeight(idx);
        }

        this.state.output_pointer--;
      } else {
        break;
      }
    }
  }

  find_transitions(index) {
    this.findTransitions(index);
  }

  /**
   * Gets analyses for the given index.
   * @param {number} idx
   */
  getAnalyses(idx) {
    if (this.isTimeExceeded()) {
      return;
    }

    const index = this.pivot(idx);
    const isTransition = idx >= TRANSITION_TARGET_TABLE_START;

    if (isTransition) {
      const nextV = this.transducer.is_weighted ? this.pivot(index) : index;
      this.tryEpsilonTransitions(nextV + 1);
    } else {
      this.tryEpsilonIndices(index + 1);
    }

    if (this.state.input_string[this.state.input_pointer] === NO_SYMBOL_NUMBER) {
      this.handleEndOfInputString(index, isTransition);
      return;
    }

    this.state.input_pointer++;

    if (isTransition) {
      this.findTransitions(index + 1);
    } else {
      this.findIndex(index + 1);
    }

    this.state.input_pointer--;
    this.resetOutputPointer();
  }

  get_analyses(idx) {
    this.getAnalyses(idx);
  }

  /**
   * Updates the output string in the state based on the output symbol.
   * @param {number} outputSymbol
   */
  updateOutputString(outputSymbol) {
    if (this.state.output_pointer === this.state.output_string.length) {
      this.state.output_string.push(outputSymbol);
    } else {
      this.state.output_string[this.state.output_pointer] = outputSymbol;
    }
  }

  update_output_string(outputSymbol) {
    this.updateOutputString(outputSymbol);
  }

  /**
   * Handles reaching the end of the input string.
   * @param {number} index
   * @param {boolean} isTransition
   */
  handleEndOfInputString(index, isTransition) {
    this.resetOutputPointer();

    const [isFinal, weight] = this.getFinalAndWeight(index, isTransition);
    if (isFinal) {
      this.updateAndNoteAnalysis(weight);
    }
  }

  handle_end_of_input_string(index, isTransition) {
    this.handleEndOfInputString(index, isTransition);
  }

  /**
   * Resets the output pointer in the state to NO_SYMBOL_NUMBER.
   */
  resetOutputPointer() {
    if (this.state.output_pointer === this.state.output_string.length) {
      this.state.output_string.push(NO_SYMBOL_NUMBER);
    } else {
      this.state.output_string[this.state.output_pointer] = NO_SYMBOL_NUMBER;
    }
  }

  reset_output_pointer() {
    this.resetOutputPointer();
  }

  /**
   * Gets the final state flag and weight based on the index and transition flag.
   * @param {number} index
   * @param {boolean} isTransition
   * @returns {[boolean, number]}
   */
  getFinalAndWeight(index, isTransition) {
    let isFinal = false;
    let weight = 0.0;

    if (isTransition) {
      if (this.transducer.transition_table.size() > index) {
        isFinal = this.transducer.transition_table.isFinal(index);
        weight = this.transducer.is_weighted
          ? this.transducer.transition_table.getWeight(index)
          : 0.0;
      } else {
        isFinal = false;
        weight = 0.0;
      }
    } else {
      isFinal = this.transducer.index_table.isFinal(index);
      if (isFinal && this.transducer.is_weighted) {
        weight = this.transducer.index_table.getFinalWeight(index);
      } else {
        weight = 0.0;
      }
    }

    return [isFinal, weight];
  }

  get_final_and_weight(index, isTransition) {
    return this.getFinalAndWeight(index, isTransition);
  }

  /**
   * Updates current weight and records the completed analysis.
   * @param {number} weight
   */
  updateAndNoteAnalysis(weight) {
    if (this.transducer.is_weighted) {
      this.state.current_weight += weight;
    }
    this.noteAnalysis();
    if (this.transducer.is_weighted) {
      this.state.current_weight -= weight;
    }
  }

  update_and_note_analysis(weight) {
    this.updateAndNoteAnalysis(weight);
  }

  /**
   * Gets the symbols for the given state.
   * @returns {string[]}
   */
  getSymbols() {
    const symbols = [];
    for (let i = 0; i < this.state.output_string.length; i++) {
      const sym = this.state.output_string[i];
      if (sym !== NO_SYMBOL_NUMBER) {
        symbols.push(this.transducer.alphabet.keyTable[sym]);
      }
    }
    return symbols;
  }

  get_symbols() {
    return this.getSymbols();
  }

  /**
   * Notes the current analysis result into display_vector.
   */
  noteAnalysis() {
    this.state.display_vector.push(
      new Result(
        this.getSymbols(),
        this.transducer.is_weighted ? this.state.current_weight : 0.0
      )
    );
  }

  note_analysis() {
    this.noteAnalysis();
  }

  /**
   * Returns the alphabet of the transducer.
   * @returns {string[]}
   */
  getAlphabet() {
    return this.transducer.alphabet.keyTable;
  }

  get_alphabet() {
    return this.getAlphabet();
  }

  /**
   * Analyzes the input string using the transducer.
   * @returns {Result[]}
   */
  analyze() {
    if (this.state.input_string[0] === NO_SYMBOL_NUMBER) {
      return [];
    } else {
      this.getAnalyses(0);
      return this.state.display_vector;
    }
  }

  /**
   * Evaluates and pushes state for a flag diacritic operation.
   * @param {import('./flag_diacritic_operation.js').FlagDiacriticOperation} flag
   * @returns {boolean}
   */
  pushState(flag) {
    const stack = this.state.state_stack;
    const top = stack[stack.length - 1];

    if (flag.op === FlagDiacriticOperator.P) {
      // Positive set
      const next = top.slice();
      next[flag.feature] = flag.value;
      stack.push(next);
      return true;
    } else if (flag.op === FlagDiacriticOperator.N) {
      // Negative set
      const next = top.slice();
      next[flag.feature] = -1 * flag.value;
      stack.push(next);
      return true;
    } else if (flag.op === FlagDiacriticOperator.R) {
      // Require
      if (flag.value === 0) {
        // Empty require: feature must not be 0 (neutral)
        if (top[flag.feature] === 0) {
          return false;
        } else {
          stack.push(top.slice());
          return true;
        }
      } else if (top[flag.feature] === flag.value) {
        stack.push(top.slice());
        return true;
      }
      return false;
    } else if (flag.op === FlagDiacriticOperator.D) {
      // Disallow
      if (flag.value === 0) {
        // Empty disallow: feature must be 0 (neutral)
        if (top[flag.feature] !== 0) {
          return false;
        } else {
          stack.push(top.slice());
          return true;
        }
      } else if (top[flag.feature] === flag.value) {
        return false;
      } else {
        stack.push(top.slice());
        return true;
      }
    } else if (flag.op === FlagDiacriticOperator.C) {
      // Clear
      const next = top.slice();
      next[flag.feature] = 0;
      stack.push(next);
      return true;
    } else if (flag.op === FlagDiacriticOperator.U) {
      // Unification
      if (
        top[flag.feature] === 0 ||
        top[flag.feature] === flag.value ||
        (top[flag.feature] !== flag.value && top[flag.feature] < 0)
      ) {
        const next = top.slice();
        next[flag.feature] = flag.value;
        stack.push(next);
        return true;
      }
      return false;
    }
    return false;
  }

  push_state(flag) {
    return this.pushState(flag);
  }
}
