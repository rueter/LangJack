import { BinaryReader } from './byte_array.js';

/**
 * Class representing the header of an HFST optimized lookup transducer.
 */
export class TransducerHeader {
  /**
   * @param {BinaryReader} reader
   */
  constructor(reader) {
    let readBytes = reader.readBytes(5);
    if (this.beginsHfst3Header(readBytes)) {
      this.hfst3 = true;
      const remaining = reader.getUShort();
      // Skip remaining + 1 bytes (to match standard HFST format)
      reader.readBytes(remaining + 1);
      readBytes = reader.readBytes(56);
    } else {
      const rest = reader.readBytes(56 - 5);
      const combined = new Uint8Array(56);
      combined.set(readBytes);
      combined.set(rest, 5);
      readBytes = combined;
      this.hfst3 = false;
    }

    const subReader = new BinaryReader(readBytes);
    this.numberOfInputSymbols = subReader.getUShort();
    this.numberOfSymbols = subReader.getUShort();
    this.sizeOfTransitionIndexTable = subReader.getUInt();
    this.sizeOfTransitionTargetTable = subReader.getUInt();
    this.numberOfStates = subReader.getUInt();
    this.numberOfTransitions = subReader.getUInt();
    this.weighted = subReader.getBool();
    this.deterministic = subReader.getBool();
    this.inputDeterministic = subReader.getBool();
    this.minimized = subReader.getBool();
    this.cyclic = subReader.getBool();
    this.hasEpsilonEpsilonTransitions = subReader.getBool();
    this.hasInputEpsilonTransitions = subReader.getBool();
    this.hasInputEpsilonCycles = subReader.getBool();
    this.hasUnweightedInputEpsilonCycles = subReader.getBool();

    // Snake_case aliases matching pyhfst
    this.number_of_input_symbols = this.numberOfInputSymbols;
    this.number_of_symbols = this.numberOfSymbols;
    this.size_of_transition_index_table = this.sizeOfTransitionIndexTable;
    this.size_of_transition_target_table = this.sizeOfTransitionTargetTable;
    this.number_of_states = this.numberOfStates;
    this.number_of_transitions = this.numberOfTransitions;
    this.input_deterministic = this.inputDeterministic;
    this.has_epsilon_epsilon_transitions = this.hasEpsilonEpsilonTransitions;
    this.has_input_epsilon_transitions = this.hasInputEpsilonTransitions;
    this.has_input_epsilon_cycles = this.hasInputEpsilonCycles;
    this.has_unweighted_input_epsilon_cycles = this.hasUnweightedInputEpsilonCycles;
  }

  /**
   * Checks if the given bytes begin with the HFST3 header ("HFST\0").
   * @param {Uint8Array} bytes
   * @returns {boolean}
   */
  beginsHfst3Header(bytes) {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0x48 && // 'H'
      bytes[1] === 0x46 && // 'F'
      bytes[2] === 0x53 && // 'S'
      bytes[3] === 0x54 && // 'T'
      bytes[4] === 0x00
    );
  }

  begins_hfst3_header(bytes) {
    return this.beginsHfst3Header(bytes);
  }

  getInputSymbolCount() {
    return this.numberOfInputSymbols;
  }

  get_input_symbol_count() {
    return this.numberOfInputSymbols;
  }

  getSymbolCount() {
    return this.numberOfSymbols;
  }

  get_symbol_count() {
    return this.numberOfSymbols;
  }

  getIndexTableSize() {
    return this.sizeOfTransitionIndexTable;
  }

  get_index_table_size() {
    return this.sizeOfTransitionIndexTable;
  }

  getTargetTableSize() {
    return this.sizeOfTransitionTargetTable;
  }

  get_target_table_size() {
    return this.sizeOfTransitionTargetTable;
  }

  isWeighted() {
    return this.weighted;
  }

  is_weighted() {
    return this.weighted;
  }

  hasHfst3Header() {
    return Boolean(this.hfst3);
  }

  has_hfst3_header() {
    return this.hasHfst3Header();
  }
}
