import { NO_SYMBOL_NUMBER } from './constants.js';

/**
 * Enum representing flag diacritic operators in HFST.
 * Supports both name-to-value and value-to-name mappings.
 */
export const FlagDiacriticOperator = Object.freeze({
  P: 0, // Positive set
  N: 1, // Negative set
  R: 2, // Require
  D: 3, // Disallow
  C: 4, // Clear
  U: 5, // Unification
  0: 'P',
  1: 'N',
  2: 'R',
  3: 'D',
  4: 'C',
  5: 'U',
});

/**
 * Class representing a flag diacritic operation.
 */
export class FlagDiacriticOperation {
  /**
   * @param {number | null} [operation] - Flag diacritic operator (from FlagDiacriticOperator)
   * @param {number | null} [feat] - Feature index
   * @param {number | null} [val] - Value index
   */
  constructor(operation = null, feat = null, val = null) {
    if (operation !== null) {
      this.op = operation;
      this.feature = feat;
      this.value = val;
    } else {
      this.op = FlagDiacriticOperator.P;
      this.feature = NO_SYMBOL_NUMBER;
      this.value = 0;
    }
  }

  /**
   * Checks if the operation is a flag diacritic operation.
   * @returns {boolean}
   */
  isFlag() {
    return this.feature !== NO_SYMBOL_NUMBER;
  }

  is_flag() {
    return this.isFlag();
  }
}
