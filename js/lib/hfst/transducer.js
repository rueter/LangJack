import { IndexTable, TransitionTable } from './tables.js';
import { BinaryReader } from './byte_array.js';

/**
 * Class representing a finite state transducer for morphological analysis/generation.
 */
export class Transducer {
  /**
   * @param {BinaryReader | Uint8Array | ArrayBuffer | Buffer} file - Transducer data reader or buffer
   * @param {import('./transducer_header.js').TransducerHeader} h - Transducer header
   * @param {import('./transducer_alphabet.js').TransducerAlphabet} a - Transducer alphabet
   * @param {boolean} [isWeighted=true] - Whether the transducer is weighted
   */
  constructor(file, h, a, isWeighted = true) {
    const reader = file instanceof BinaryReader ? file : new BinaryReader(file);
    this.header = h;
    this.alphabet = a;
    this.is_weighted = isWeighted;
    this.isWeighted = isWeighted;
    this.operations = this.alphabet.operations;

    this.symbol_map = {};
    this.constructSymbolMap();

    this.index_table = new IndexTable(reader, h.getIndexTableSize());
    this.indexTable = this.index_table;

    this.transition_table = new TransitionTable(
      reader,
      h.getTargetTableSize(),
      this.is_weighted
    );
    this.transitionTable = this.transition_table;
  }

  get symbolMap() {
    return this.symbol_map;
  }
  set symbolMap(val) {
    this.symbol_map = val;
  }

  /**
   * Constructs the prefix trie / symbol map from the transducer alphabet.
   */
  constructSymbolMap() {
    for (let i = 0; i < this.header.getInputSymbolCount(); i++) {
      const w = this.alphabet.keyTable[i];
      if (w.length <= 1) {
        if (!(w in this.symbol_map)) {
          this.symbol_map[w] = { [null]: i };
        } else {
          this.symbol_map[w][null] = i;
        }
      } else {
        if (!(w[0] in this.symbol_map)) {
          this.symbol_map[w[0]] = {};
        }
        let o = this.symbol_map[w[0]];
        for (let j = 1; j < w.length; j++) {
          const c = w[j];
          if (!(c in o)) {
            o[c] = {};
          }
          o = o[c];
        }
        if (null in o) {
          throw new Error('Duplicate symbol in symbol map');
        }
        o[null] = i;
      }
    }
  }

  construct_symbol_map() {
    this.constructSymbolMap();
  }
}
