/**
 * Class representing an analysis result with symbols and weight.
 */
export class Result {
  /**
   * @param {string[]} symbols - List of symbols in the result.
   * @param {number} weight - Weight associated with the result.
   */
  constructor(symbols, weight) {
    this.symbols = symbols;
    this.weight = weight;
  }

  /**
   * Returns the list of symbols in the result.
   * @returns {string[]}
   */
  getSymbols() {
    return this.symbols;
  }

  get_symbols() {
    return this.symbols;
  }

  /**
   * Returns the weight associated with the result.
   * @returns {number}
   */
  getWeight() {
    return this.weight;
  }

  get_weight() {
    return this.weight;
  }

  /**
   * Returns a string representation of the result in the format "(text: weight)".
   * @returns {string}
   */
  toString() {
    return this.symbols.join('') + ': ' + this.weight;
  }

  __str__() {
    return this.toString();
  }
}
