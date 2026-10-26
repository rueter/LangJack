/**
 * Constants used across HFST transducer operations and tables.
 */

/**
 * Marks transition targets that point into the transition table
 * rather than the index table (2^31).
 */
export const TRANSITION_TARGET_TABLE_START = 2147483648;

/**
 * Representation of infinite weight (equivalent to static_cast<float>(UINT_MAX)).
 */
export const INFINITE_WEIGHT = 4294967295.0;

/**
 * Sentinel value representing the absence of a symbol (USHRT_MAX = 65535).
 */
export const NO_SYMBOL_NUMBER = 65535;

/**
 * Sentinel value representing an invalid or non-existent table index (UINT_MAX = 4294967295).
 */
export const NO_TABLE_INDEX = 4294967295;
