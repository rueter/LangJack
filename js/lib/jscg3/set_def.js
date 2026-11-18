// Set definitions and evaluation for VISL CG-3.

import { TagPattern } from './tag.js';

export function isLiteral(p) {
  return !(p.isAny || p.isRegex || p.isCaseInsensitive || p.isFailfast || p.numValue !== null);
}

function patternMatches(p, have) {
  if (p.isAny) return true;
  if (isLiteral(p)) return have.has(p.raw);
  for (const t of have) if (p.matchesTag(t)) return true;
  return false;
}

/** A composite tag (tag1 tag2 ...): every element must be found on the same reading. */
export class CompositeTag {
  constructor(elements) {
    this.elements = elements;
    this._lits = new Set(elements.filter((e) => isLiteral(e)).map((e) => e.raw));
    this._pats = elements.filter((e) => !isLiteral(e));
  }

  matchesReading(reading) {
    const have = reading.matchSet();
    for (const l of this._lits) if (!have.has(l)) return false;
    for (const p of this._pats) if (!patternMatches(p, have)) return false;
    return true;
  }

  toString() {
    return `CompositeTag(${this.elements.map((e) => e.raw).join(' ')})`;
  }
}

// While the contexts of one rule are tried on one target reading, $$Set / &&Set operands must agree on
// which member of the set they matched. The rule sets the state to a fresh Map for each target reading.
let unifState = null;

export function getUnif() {
  return unifState;
}

export function setUnif(value) {
  unifState = value;
}

function sameItem(a, b) {
  return a === b || (a instanceof TagPattern && b instanceof TagPattern && a.raw === b.raw);
}

/**
 * $$Name (any tag of the set) or &&Name (a whole composite tag): every use inside one rule has to match
 * the same member of the set. Outside a rule (no unification state) it is just the set.
 */
export class UnifySet {
  constructor(name, kind, registry) {
    this.name = name;
    this.kind = kind;
    this.registry = registry;
  }

  matchesReading(reading) {
    const target = this.registry.get(this.name);
    const unif = getUnif();
    if (unif === null || !target.items.length) return target.matchesReading(reading);
    const have = reading.matchSet();
    const hits = [];
    for (const item of target.items) {
      if (item instanceof CompositeTag) {
        if (item.matchesReading(reading)) hits.push(item);
      } else if (patternMatches(item, have)) {
        hits.push(item);
      }
    }
    if (!hits.length) return false;
    const key = this.kind + this.name;
    const bound = unif.get(key);
    if (bound === undefined) {
      unif.set(key, hits);
      return true;
    }
    const both = hits.filter((h) => bound.some((b) => sameItem(h, b)));
    if (!both.length) return false;
    unif.set(key, both);
    return true;
  }

  toString() {
    return `${this.kind}${this.name}`;
  }
}

/**
 * A named or anonymous set.
 *
 * A LIST has `items` (TagPattern or CompositeTag alternatives). A SET expression has `groups`:
 * a list of OR-groups, each a left-to-right chain [[null, operand], [op, operand], ...] with op one of
 * 'and' (+), 'minus' (-), 'xor' (^); an operand is a SetDefinition or the name of one.
 */
export class SetDefinition {
  constructor(name = '', lineNumber = 0, isOrdered = false, registry = null) {
    this.name = name;
    this.lineNumber = lineNumber;
    this.isOrdered = isOrdered;
    this.items = [];
    this.groups = [];
    this.registry = registry !== null ? registry : new Map();
  }

  isEmpty() {
    return !this.items.length && !this.groups.length;
  }

  addItem(item) {
    this.items.push(item);
  }

  _resolve(operand) {
    if (operand instanceof SetDefinition || operand instanceof UnifySet) return operand;
    const found = this.registry.get(operand);
    if (found === undefined) {
      throw new Error(`Undefined set ${JSON.stringify(operand)} (used in ${this.name ? JSON.stringify(this.name) : 'an inline set'})`);
    }
    return found;
  }

  matchesReading(reading) {
    if (this.groups.length) {
      for (const group of this.groups) {
        let res = this._resolve(group[0][1]).matchesReading(reading);
        for (let k = 1; k < group.length; k++) {
          const [op, operand] = group[k];
          const other = this._resolve(operand).matchesReading(reading);
          if (op === 'and') res = res && other;
          else if (op === 'minus') res = res && !other;
          else if (op === 'xor') res = res !== other;
        }
        if (res) return true;
      }
      return false;
    }
    const have = reading.matchSet();
    for (const item of this.items) {
      if (item instanceof CompositeTag) {
        if (item.matchesReading(reading)) return true;
      } else if (patternMatches(item, have)) {
        return true;
      }
    }
    return false;
  }

  /** At least one active reading matches. */
  matchesCohortNormal(cohort) {
    for (const r of cohort.readings) if (!r.deleted && this.matchesReading(r)) return true;
    return false;
  }

  /** Every active reading matches. */
  matchesCohortCareful(cohort) {
    let seen = false;
    for (const r of cohort.readings) {
      if (r.deleted) continue;
      seen = true;
      if (!this.matchesReading(r)) return false;
    }
    return seen;
  }

  toString() {
    return `SetDefinition(${this.name}, items=${this.items.length}, groups=${this.groups.length})`;
  }
}
