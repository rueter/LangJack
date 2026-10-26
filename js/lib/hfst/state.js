import { NO_SYMBOL_NUMBER } from './constants.js';

/**
 * Class representing the state during FST traversal and analysis.
 */
export class State {
  /**
   * @param {string} input - The input string to be analyzed.
   * @param {import('./transducer.js').Transducer} parent - The parent transducer.
   */
  constructor(input, parent) {
    this.parent = parent;
    this.state_stack = [];
    const neutral = new Array(parent.alphabet.features).fill(0);
    this.state_stack.push(neutral);
    this.output_string = new Array(1000).fill(NO_SYMBOL_NUMBER);
    this.input_string = Array.from(this.findKey(input));
    this.output_pointer = 0;
    this.input_pointer = 0;
    this.current_weight = 0.0;
    /** @type {import('./result.js').Result[]} */
    this.display_vector = [];
  }

  get stateStack() {
    return this.state_stack;
  }
  set stateStack(val) {
    this.state_stack = val;
  }

  get outputString() {
    return this.output_string;
  }
  set outputString(val) {
    this.output_string = val;
  }

  get inputString() {
    return this.input_string;
  }
  set inputString(val) {
    this.input_string = val;
  }

  get outputPointer() {
    return this.output_pointer;
  }
  set outputPointer(val) {
    this.output_pointer = val;
  }

  get inputPointer() {
    return this.input_pointer;
  }
  set inputPointer(val) {
    this.input_pointer = val;
  }

  get currentWeight() {
    return this.current_weight;
  }
  set currentWeight(val) {
    this.current_weight = val;
  }

  get displayVector() {
    return this.display_vector;
  }
  set displayVector(val) {
    this.display_vector = val;
  }

  /**
   * Tokenizes the index string into symbol IDs matching the transducer symbol map.
   * Uses longest-prefix matching, identical to pyhfst.
   * @param {string} indexString
   * @returns {Generator<number, void, unknown>}
   */
  *findKey(indexString) {
    let i = 0;
    while (i < indexString.length) {
      let matchFound = false;
      for (let length = indexString.length - i; length > 0; length--) {
        const substr = indexString.slice(i, i + length);
        let mapPointer = this.parent.symbol_map;
        let fullMatch = true;
        for (let k = 0; k < substr.length; k++) {
          const char = substr[k];
          if (mapPointer && char in mapPointer) {
            mapPointer = mapPointer[char];
          } else {
            fullMatch = false;
            break;
          }
        }
        if (fullMatch) {
          if (mapPointer && null in mapPointer) {
            yield mapPointer[null];
            i += length - 1;
            matchFound = true;
          }
          break;
        }
      }
      if (!matchFound) {
        yield NO_SYMBOL_NUMBER;
      }
      i++;
    }
    yield NO_SYMBOL_NUMBER;
  }

  find_key(indexString) {
    return this.findKey(indexString);
  }
}
