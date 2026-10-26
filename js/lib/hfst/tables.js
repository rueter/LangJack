import { NO_SYMBOL_NUMBER, NO_TABLE_INDEX } from './constants.js';
import { uint32BitsToFloat32 } from './byte_array.js';

/**
 * A table to store input symbols and their corresponding target indices.
 */
export class IndexTable {
  /**
   * @param {import('./byte_array.js').BinaryReader} reader
   * @param {number} indicesCount
   */
  constructor(reader, indicesCount) {
    this.tiInputSymbols = new Uint16Array(indicesCount);
    this.tiTargets = new Uint32Array(indicesCount);

    const view = reader.view;
    let offset = reader.offset;
    for (let i = 0; i < indicesCount; i++) {
      this.tiInputSymbols[i] = view.getUint16(offset, true);
      this.tiTargets[i] = view.getUint32(offset + 2, true);
      offset += 6;
    }
    reader.offset = offset;

    // Snake_case aliases matching pyhfst
    this.ti_input_symbols = this.tiInputSymbols;
    this.ti_targets = this.tiTargets;
  }

  /**
   * Returns the input symbol at the given index.
   * @param {number} i
   * @returns {number}
   */
  getInput(i) {
    if (i < 0 || i >= this.tiInputSymbols.length) return NO_SYMBOL_NUMBER;
    return this.tiInputSymbols[i];
  }

  get_input(i) {
    return this.getInput(i);
  }

  /**
   * Returns the target index at the given index.
   * @param {number} i
   * @returns {number}
   */
  getTarget(i) {
    if (i < 0 || i >= this.tiTargets.length) return NO_TABLE_INDEX;
    return this.tiTargets[i];
  }

  get_target(i) {
    return this.getTarget(i);
  }

  /**
   * Checks if the given index is a final state.
   * @param {number} i
   * @returns {boolean}
   */
  isFinal(i) {
    if (i < 0 || i >= this.tiInputSymbols.length) return false;
    return (
      this.tiInputSymbols[i] === NO_SYMBOL_NUMBER &&
      this.tiTargets[i] !== NO_TABLE_INDEX
    );
  }

  is_final(i) {
    return this.isFinal(i);
  }

  /**
   * Returns the final weight for the given index.
   * In HFST index tables, the target uint32 bit pattern of a final state encodes a float32 weight.
   * @param {number} i
   * @returns {number}
   */
  getFinalWeight(i) {
    return uint32BitsToFloat32(this.tiTargets[i]);
  }

  get_final_weight(i) {
    return this.getFinalWeight(i);
  }

  /**
   * Returns the size of the index table.
   * @returns {number}
   */
  size() {
    return this.tiTargets.length;
  }
}

/**
 * A table to store transitions between states.
 */
export class TransitionTable {
  /**
   * @param {import('./byte_array.js').BinaryReader} reader
   * @param {number} transitionCount
   * @param {boolean} [isWeighted=true]
   */
  constructor(reader, transitionCount, isWeighted = true) {
    this.isWeighted = isWeighted;
    this.is_weighted = isWeighted;
    this.tiInputSymbols = new Uint16Array(transitionCount);
    this.tiOutputSymbols = new Uint16Array(transitionCount);
    this.tiTargets = new Uint32Array(transitionCount);
    this.tiWeights = isWeighted ? new Float32Array(transitionCount) : null;

    const view = reader.view;
    let offset = reader.offset;

    if (isWeighted) {
      for (let i = 0; i < transitionCount; i++) {
        this.tiInputSymbols[i] = view.getUint16(offset, true);
        this.tiOutputSymbols[i] = view.getUint16(offset + 2, true);
        this.tiTargets[i] = view.getUint32(offset + 4, true);
        this.tiWeights[i] = view.getFloat32(offset + 8, true);
        offset += 12;
      }
    } else {
      for (let i = 0; i < transitionCount; i++) {
        this.tiInputSymbols[i] = view.getUint16(offset, true);
        this.tiOutputSymbols[i] = view.getUint16(offset + 2, true);
        this.tiTargets[i] = view.getUint32(offset + 4, true);
        offset += 8;
      }
    }
    reader.offset = offset;

    // Snake_case aliases matching pyhfst
    this.ti_input_symbols = this.tiInputSymbols;
    this.ti_output_symbols = this.tiOutputSymbols;
    this.ti_targets = this.tiTargets;
    this.ti_weights = this.tiWeights;
  }

  /**
   * Returns the input symbol at the given position.
   * @param {number} pos
   * @returns {number}
   */
  getInput(pos) {
    if (pos < 0 || pos >= this.tiInputSymbols.length) return NO_SYMBOL_NUMBER;
    return this.tiInputSymbols[pos];
  }

  get_input(pos) {
    return this.getInput(pos);
  }

  /**
   * Returns the output symbol at the given position.
   * @param {number} pos
   * @returns {number}
   */
  getOutput(pos) {
    if (pos < 0 || pos >= this.tiOutputSymbols.length) return NO_SYMBOL_NUMBER;
    return this.tiOutputSymbols[pos];
  }

  get_output(pos) {
    return this.getOutput(pos);
  }

  /**
   * Returns the target index at the given position.
   * @param {number} pos
   * @returns {number}
   */
  getTarget(pos) {
    if (pos < 0 || pos >= this.tiTargets.length) return NO_TABLE_INDEX;
    return this.tiTargets[pos];
  }

  get_target(pos) {
    return this.getTarget(pos);
  }

  /**
   * Returns the weight at the given position.
   * @param {number} pos
   * @returns {number}
   */
  getWeight(pos) {
    if (!this.isWeighted) {
      throw new Error('Getting weights of unweighted FST.');
    }
    if (pos < 0 || pos >= this.tiWeights.length) return 0.0;
    return this.tiWeights[pos];
  }

  get_weight(pos) {
    return this.getWeight(pos);
  }

  /**
   * Checks if the given position is a final state.
   * @param {number} pos
   * @returns {boolean}
   */
  isFinal(pos) {
    if (pos < 0 || pos >= this.tiInputSymbols.length) return false;
    return (
      this.tiInputSymbols[pos] === NO_SYMBOL_NUMBER &&
      this.tiOutputSymbols[pos] === NO_SYMBOL_NUMBER &&
      this.tiTargets[pos] === 1
    );
  }

  is_final(pos) {
    return this.isFinal(pos);
  }

  /**
   * Returns the size of the transition table.
   * @returns {number}
   */
  size() {
    return this.tiTargets.length;
  }
}
