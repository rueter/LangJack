/**
 * Browser & universal core entry point for hfst-js.
 * Zero Node.js dependencies: runs natively in all browsers, Web Workers, Deno, and Node.
 */

import {
  TRANSITION_TARGET_TABLE_START,
  INFINITE_WEIGHT,
  NO_SYMBOL_NUMBER,
  NO_TABLE_INDEX,
} from './constants.js';
import { ByteArray, BinaryReader, uint32BitsToFloat32 } from './byte_array.js';
import { FlagDiacriticOperator, FlagDiacriticOperation } from './flag_diacritic_operation.js';
import { TransducerHeader } from './transducer_header.js';
import { TransducerAlphabet } from './transducer_alphabet.js';
import { IndexTable, TransitionTable } from './tables.js';
import { Result } from './result.js';
import { State } from './state.js';
import { Transducer } from './transducer.js';
import { Analyzer } from './analyzer.js';

/**
 * Creates a Transducer instance from an ArrayBuffer, Uint8Array, or Buffer.
 * @param {Uint8Array | ArrayBuffer | BinaryReader} input
 * @returns {Transducer}
 */
export function getTransducer(input) {
  let buffer;
  if (
    input instanceof Uint8Array ||
    input instanceof ArrayBuffer ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(input))
  ) {
    buffer = input;
  } else if (input instanceof BinaryReader) {
    const reader = input;
    const header = new TransducerHeader(reader);
    const alphabet = new TransducerAlphabet(reader, header.getSymbolCount());
    return new Transducer(reader, header, alphabet, header.isWeighted());
  } else {
    throw new TypeError(
      'getTransducer: expected Uint8Array, ArrayBuffer, Buffer, or BinaryReader'
    );
  }

  const reader = new BinaryReader(buffer);
  const header = new TransducerHeader(reader);
  const alphabet = new TransducerAlphabet(reader, header.getSymbolCount());
  return new Transducer(reader, header, alphabet, header.isWeighted());
}

export const get_transducer = getTransducer;

/**
 * Class representing an HFST input stream.
 */
export class HfstInputStream {
  /**
   * @param {Uint8Array | ArrayBuffer | any} buffer
   * @param {boolean | { cache?: boolean }} [cache=true]
   */
  constructor(buffer, cache = true) {
    this.buffer = buffer;
    this.cache = typeof cache === 'boolean' ? cache : (cache?.cache ?? true);
  }

  /**
   * Reads the transducer and returns an Hfst wrapper instance.
   * @returns {Hfst}
   */
  read() {
    const tr = getTransducer(this.buffer);
    return new Hfst(tr, this.cache);
  }

  /**
   * Creates an HfstInputStream from a binary buffer.
   * @param {Uint8Array | ArrayBuffer} buffer
   * @param {boolean | { cache?: boolean }} [cache=true]
   * @returns {HfstInputStream}
   */
  static fromBuffer(buffer, cache = true) {
    return new HfstInputStream(buffer, cache);
  }

  /**
   * Fetches an HFST transducer binary from a URL and returns an Hfst instance.
   * @param {string | URL} url
   * @param {{ cache?: boolean, fetchOptions?: RequestInit }} [options]
   * @returns {Promise<Hfst>}
   */
  static async fromUrl(url, { cache = true, fetchOptions } = {}) {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`Failed to fetch transducer from ${url}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const tr = getTransducer(arrayBuffer);
    return new Hfst(tr, cache);
  }
}

/**
 * Main HFST interface class.
 */
export class Hfst {
  /**
   * @param {Transducer} tr - The transducer object.
   * @param {boolean} [cache=true] - Whether to cache lookup results.
   */
  constructor(tr, cache = true) {
    this.tr = tr;
    this.cache = cache;
    /** @type {Map<string, Result[]>} */
    this.mem = new Map();
  }

  static fromBuffer(buffer, cache = true) {
    return new HfstInputStream(buffer, cache).read();
  }

  static async fromUrl(url, options) {
    return HfstInputStream.fromUrl(url, options);
  }

  /**
   * Performs lookup on the input string and returns analyses as [analysis, weight] pairs.
   * @param {string} string
   * @param {number | { timeCutoff?: number, time_cutoff?: number }} [timeCutoff=0.0]
   * @returns {Array<[string, number]>}
   */
  lookup(string, timeCutoff = 0.0) {
    const cutoff =
      typeof timeCutoff === 'number'
        ? timeCutoff
        : (timeCutoff?.timeCutoff ?? timeCutoff?.time_cutoff ?? 0.0);

    let result;
    if (this.cache && cutoff === 0.0) {
      if (!this.mem.has(string)) {
        this.mem.set(string, new Analyzer(this.tr, string, cutoff).analyze());
      }
      result = this.mem.get(string);
    } else {
      result = new Analyzer(this.tr, string, cutoff).analyze();
    }
    return result.map((r) => [r.getSymbols().join(''), r.getWeight()]);
  }

  /**
   * Performs lookup on the input string and returns raw Result instances.
   * @param {string} string
   * @param {number | { timeCutoff?: number, time_cutoff?: number }} [timeCutoff=0.0]
   * @returns {Result[]}
   */
  lookupResults(string, timeCutoff = 0.0) {
    const cutoff =
      typeof timeCutoff === 'number'
        ? timeCutoff
        : (timeCutoff?.timeCutoff ?? timeCutoff?.time_cutoff ?? 0.0);

    if (this.cache && cutoff === 0.0) {
      if (!this.mem.has(string)) {
        this.mem.set(string, new Analyzer(this.tr, string, cutoff).analyze());
      }
      return this.mem.get(string);
    }
    return new Analyzer(this.tr, string, cutoff).analyze();
  }
}

export {
  TRANSITION_TARGET_TABLE_START,
  INFINITE_WEIGHT,
  NO_SYMBOL_NUMBER,
  NO_TABLE_INDEX,
  ByteArray,
  BinaryReader,
  uint32BitsToFloat32,
  FlagDiacriticOperator,
  FlagDiacriticOperation,
  TransducerHeader,
  TransducerAlphabet,
  IndexTable,
  TransitionTable,
  Result,
  State,
  Transducer,
  Analyzer,
};

const pyhfstCore = {
  TRANSITION_TARGET_TABLE_START,
  INFINITE_WEIGHT,
  NO_SYMBOL_NUMBER,
  NO_TABLE_INDEX,
  ByteArray,
  BinaryReader,
  uint32BitsToFloat32,
  FlagDiacriticOperator,
  FlagDiacriticOperation,
  TransducerHeader,
  TransducerAlphabet,
  IndexTable,
  TransitionTable,
  Result,
  State,
  Transducer,
  Analyzer,
  HfstInputStream,
  Hfst,
  getTransducer,
  get_transducer,
};

export default pyhfstCore;
