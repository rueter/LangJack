import { FlagDiacriticOperator, FlagDiacriticOperation } from './flag_diacritic_operation.js';

/**
 * Class representing the alphabet of the transducer, including flag diacritics.
 */
export class TransducerAlphabet {
  /**
   * @param {import('./byte_array.js').BinaryReader} reader
   * @param {number} numberOfSymbols
   */
  constructor(reader, numberOfSymbols) {
    /** @type {string[]} */
    this.keyTable = [];
    /** @type {Record<number, FlagDiacriticOperation>} */
    this.operations = {};
    /** @type {Record<string, number>} */
    const featureBucket = {};
    /** @type {Record<string, number>} */
    const valueBucket = { '': 0 }; // neutral value is 0
    this.features = 0;
    let values = 1;

    const utf8Decoder = new TextDecoder('utf-8');
    const bytes = reader.bytes;

    for (let s = 0; s < numberOfSymbols; s++) {
      const startOffset = reader.offset;
      while (reader.offset < bytes.length && bytes[reader.offset] !== 0) {
        reader.offset++;
      }
      const ustring = utf8Decoder.decode(bytes.subarray(startOffset, reader.offset));
      if (reader.offset < bytes.length && bytes[reader.offset] === 0) {
        reader.offset++; // skip null terminator byte
      }

      if (
        ustring.length > 5 &&
        ustring.startsWith('@') &&
        ustring.endsWith('@') &&
        ustring[2] === '.'
      ) {
        // Flag diacritic identified
        const parts = ustring.slice(1, -1).split('.');
        if (parts.length < 2) {
          this.keyTable.push('');
          continue;
        }

        const ops = parts[0];
        const feats = parts[1];
        const vals = parts.length > 2 ? parts[2] : '';

        const op = FlagDiacriticOperator[ops];
        if (op === undefined || typeof op !== 'number') {
          // Not a valid operator, ignore the operation
          this.keyTable.push('');
          continue;
        }

        if (!(vals in valueBucket)) {
          valueBucket[vals] = values;
          values++;
        }
        if (!(feats in featureBucket)) {
          featureBucket[feats] = this.features;
          this.features++;
        }

        this.operations[this.keyTable.length] = new FlagDiacriticOperation(
          op,
          featureBucket[feats],
          valueBucket[vals]
        );
        this.keyTable.push('');
        continue;
      }

      this.keyTable.push(ustring);
    }

    this.keyTable[0] = ''; // epsilon is zero
  }
}
