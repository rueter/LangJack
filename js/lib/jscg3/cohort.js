// Cohort, Reading, and SingleWindow data structures.

import { cg3Hash } from './tag.js';

/** A single reading of a cohort. */
export class Reading {
  constructor(baseform = '', tags = null, parentCohort = null) {
    this.baseform = baseform;
    this.tags = tags !== null ? [...tags] : [];
    this.tagSet = new Set(this.tags);
    this.subReadings = [];
    this.deleted = false;
    this.changed = false;
    this.trace = [];
    this.parentCohort = parentCohort;
    this.mappingTags = new Set();
    this.id = null;
    this.parentId = null;
    this.relName = null;
    this.matchCache = null;
    this.mapped = false;
    this.number = -1;            // place in the output: vislcg3 prints readings by number, whatever order it keeps them in

    // dependency / relation tags: #1->2 or #1->2:rel
    for (const t of this.tags) {
      if (t.startsWith('#') && t.includes('->')) {
        const parts = t.slice(1).split('->');
        const id = parsePyInt(parts[0]);
        if (id === null) continue;
        this.id = id;
        const colon = parts[1].indexOf(':');
        if (colon >= 0) {
          const pid = parsePyInt(parts[1].slice(0, colon));
          if (pid === null) continue;
          this.parentId = pid;
          this.relName = parts[1].slice(colon + 1);
        } else {
          const pid = parsePyInt(parts[1]);
          if (pid !== null) this.parentId = pid;
        }
      }
    }
  }

  /** Add a tag to the reading if not already present. */
  addTag(tag, mappingPrefix = '@') {
    if (!this.tagSet.has(tag)) {
      this.matchCache = null;
      this.tags.push(tag);
      this.tagSet.add(tag);
      if (tag.startsWith(mappingPrefix)) this.mappingTags.add(tag);
      this.changed = true;
    }
  }

  /** Remove a tag from the reading. */
  removeTag(tag) {
    if (this.tagSet.has(tag)) {
      this.matchCache = null;
      this.tags = this.tags.filter((t) => t !== tag);
      this.tagSet.delete(tag);
      this.mappingTags.delete(tag);
      this.changed = true;
    }
  }

  /** Replace oldTag with one or more newTags in-place. */
  replaceTag(oldTag, newTags, mappingPrefix = '@') {
    if (!this.tagSet.has(oldTag)) return;
    this.matchCache = null;
    const out = [];
    let replaced = false;
    for (const t of this.tags) {
      if (t === oldTag && !replaced) {
        out.push(...newTags);
        replaced = true;
      } else if (t !== oldTag) {
        out.push(t);
      }
    }
    this.tags = out;
    this.tagSet = new Set(out);
    this.mappingTags = new Set(out.filter((t) => t.startsWith(mappingPrefix)));
    this.changed = true;
  }

  /** What makes two readings the same: base form and tag set (order does not matter), sub-readings in order. */
  identity() {
    return JSON.stringify([this.baseform, [...new Set(this.tags)].sort(), this.subReadings.map((s) => s.identity())]);
  }

  /** The sub-readings in the order the stream lists them (1 = the first line below this reading). */
  subChain() {
    const out = [];
    const stack = [...this.subReadings].reverse();
    while (stack.length) {
      const r = stack.pop();
      out.push(r);
      for (const s of [...r.subReadings].reverse()) stack.push(s);
    }
    return out;
  }

  /** Sub-reading n as vislcg3 numbers them: 1, 2, ... from the first, -1, -2, ... from the last, 0 = this reading. */
  subReading(n) {
    if (n === 0) return this;
    const chain = this.subChain();
    if (n > 0) return n <= chain.length ? chain[n - 1] : null;
    return -n <= chain.length ? chain[chain.length + n] : null;
  }

  /** Check if reading contains exact tag. */
  hasTag(tag) {
    return this.tagSet.has(tag) || tag === this.baseform;
  }

  /** Every tag a set can match on this reading, base form and word form included (cached). */
  matchSet() {
    if (this.matchCache === null) this.matchCache = new Set(this.allTags());
    return this.matchCache;
  }

  /** All tags including baseform and wordform. */
  allTags() {
    const res = [];
    if (this.baseform) res.push(this.baseform);
    res.push(...this.tags);
    if (this.parentCohort && this.parentCohort.wordform) res.push(this.parentCohort.wordform);
    if (this.parentCohort && this.parentCohort.isEnd) res.push('<<<');
    return res;
  }

  /** Format reading as VISL CG-3 text line(s). */
  toText({ indent = '\t', showRules = false, trace = false, dep = '' } = {}) {
    const parts = [];
    if (this.baseform) parts.push(this.baseform);
    parts.push(...this.tags.filter((t) => t !== '<<<' && t !== '>>>'));     // the window edge tags are never printed
    if (dep) parts.push(dep);           // #self->parent, after the tags and before the rule labels
    let line = indent + parts.join(' ');
    if (showRules && this.changed) line += ' <<<';
    if (trace && this.trace.length) line += ' ' + this.trace.join(' ');
    const lines = [line];
    for (const sub of this.subReadings) lines.push(sub.toText({ indent: indent + '\t', showRules, trace, dep }));
    return lines.join('\n');
  }

  /** Deep copy reading for cohort operations. */
  clone(parentCohort = null) {
    const nr = new Reading(this.baseform, [...this.tags], parentCohort);
    nr.deleted = this.deleted;
    nr.changed = this.changed;
    nr.trace = [...this.trace];
    nr.mappingTags = new Set(this.mappingTags);
    nr.id = this.id;
    nr.parentId = this.parentId;
    nr.relName = this.relName;
    nr.mapped = this.mapped;
    nr.number = this.number;
    nr.subReadings = this.subReadings.map((s) => s.clone(parentCohort));
    return nr;
  }

  toString() {
    return `Reading(${this.baseform} ${this.tags.join(' ')})`;
  }
}

/** Python's int(): whole-string integer or null. */
function parsePyInt(text) {
  const t = text.trim();
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : null;
}

/** A reading without its mapping tags: what vislcg3 compares (hash_plain) when it merges readings for output. */
function plainKey(r) {
  const tags = [...new Set(r.tags.filter((t) => !r.mappingTags.has(t)))].sort();
  return [r.baseform, tags, r.subReadings.map(plainKey)];
}

function hasMapping(r) {
  return r.mappingTags.size > 0 || r.subReadings.some(hasMapping);
}

/**
 * vislcg3 prints readings that differ only in their mapping tag as one reading with all the mapping tags, last
 * (mergeMappings; --split-mappings turns it off). Readings with a mapping tag only merge with others that have one.
 */
export function mergeMappedReadings(readings, withTrace = false) {
  const groups = new Map();
  for (const r of readings) {
    const key = JSON.stringify([plainKey(r), withTrace ? r.trace : [], hasMapping(r)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  if (groups.size === readings.length) return [...readings];
  const out = [];
  for (const members of groups.values()) {
    const first = members[0];
    const nr = first.clone(first.parentCohort);
    const maps = [];
    for (const m of members) {
      for (const t of m.tags) if (m.mappingTags.has(t) && !maps.includes(t)) maps.push(t);
    }
    nr.tags = [...first.tags.filter((t) => !first.mappingTags.has(t)), ...maps];
    nr.tagSet = new Set(nr.tags);
    nr.mappingTags = new Set(maps);
    nr.matchCache = null;
    out.push(nr);
  }
  return out;
}

/** A cohort (a wordform with its readings and untouchable tags). */
export class Cohort {
  constructor({ wordform = '', untouchableTags = null, textBefore = null, lineNumber = 0, globalNumber = 0, parentWindow = null } = {}) {
    this.wordform = wordform;
    this.untouchableTags = untouchableTags !== null ? [...untouchableTags] : [];
    this.readings = [];
    this.deletedReadings = [];
    this.textBefore = textBefore !== null ? [...textBefore] : [];
    this.lineNumber = lineNumber;
    this.globalNumber = globalNumber;
    this.parentWindow = parentWindow;
    this.wread = null;
    this.nextNumber = 0;
    this.isEnd = false;          // the last cohort of a window: its readings answer to the tag <<<
    this.depParent = null;       // set by SETPARENT / SETCHILD; the begin cohort is the root
    this.depChildren = [];
    this.relations = new Map();  // relation name -> global numbers of the cohorts it points to
    this.related = false;        // prints ID:n (and the relations); set by a relation rule or input ID:/R: tags
    this.relIn = null;           // [own input id, Map name -> Set of input ids] from ID: and R:name:id tags
    this.depIn = null;           // [own number, parent number] as the input gave them in #n->m
  }

  /** Append a reading to this cohort. */
  appendReading(reading) {
    reading.parentCohort = this;
    if (reading.number < 0) reading.number = this.nextNumber;
    this.nextNumber = Math.max(this.nextNumber, reading.number + 1);
    this.readings.push(reading);
  }

  /**
   * A reading with several mapping tags becomes one reading per mapping tag (vislcg3 does this to every
   * cohort before it runs the next rule, so after a MAP (@A @B) the two are separate readings).
   */
  splitMappings(mappingPrefix = '@') {
    if (!this.readings.some((r) => r.mappingTags.size > 1)) return false;
    const out = [];
    for (const r of this.readings) {
      const mapping = r.tags.filter((t) => t.startsWith(mappingPrefix));
      if (mapping.length > 1) {
        const base = r.tags.filter((t) => !t.startsWith(mappingPrefix));
        for (const mt of mapping) {
          const nr = new Reading(r.baseform, [...base, mt], this);
          nr.number = r.number;
          nr.deleted = r.deleted;
          nr.changed = r.changed;
          nr.trace = [...r.trace];
          nr.subReadings = r.subReadings.map((x) => x.clone(this));
          nr.mappingTags = new Set([mt]);
          nr.mapped = true;
          out.push(nr);
        }
      } else {
        out.push(r);
      }
    }
    this.readings = out;
    return true;
  }

  addRelation(name, target) {
    if (!this.relations.has(name)) this.relations.set(name, []);
    const ids = this.relations.get(name);
    if (ids.includes(target)) return false;
    ids.push(target);
    ids.sort((a, b) => a - b);
    return true;
  }

  setRelation(name, target) {
    const ids = this.relations.get(name) || [];
    if (!this.relations.has(name)) this.relations.set(name, ids);
    if (ids.length === 1 && ids[0] === target) return false;
    this.relations.set(name, [target]);
    return true;
  }

  remRelation(name, target) {
    const ids = this.relations.get(name);
    const at = ids ? ids.indexOf(target) : -1;
    if (at < 0) return false;
    ids.splice(at, 1);
    return true;
  }

  /** ID:n R:name:m ... as vislcg3 prints them: the names in the order of their hashes. */
  relationText() {
    if (!this.related) return '';
    const parts = [`ID:${this.globalNumber}`];
    const names = [...this.relations.keys()].sort((a, b) => cg3Hash(a) - cg3Hash(b));
    for (const name of names) for (const target of this.relations.get(name)) parts.push(`R:${name}:${target}`);
    return parts.join(' ');
  }

  /** The readings in the order vislcg3 prints them (see removeReading for why that is not this.readings). */
  orderedReadings() {
    return [...this.readings].sort((a, b) => a.number - b.number);
  }

  /**
   * Drop later readings that have the same base form and the same set of tags as an earlier one
   * (vislcg3 does this silently, on input and after a rule has changed a reading). With -t the rules
   * that hit a reading are part of what it is, so readings with different traces stay apart.
   */
  dedupeReadings(withTrace = false) {
    const seen = new Set();
    const keep = [];
    for (const r of this.readings) {
      const key = r.identity() + '\u0000' + (withTrace ? JSON.stringify(r.trace) : '');
      if (seen.has(key) && !r.deleted) continue;
      seen.add(key);
      keep.push(r);
    }
    let changed = keep.length !== this.readings.length;
    this.readings = keep;
    if (this.deletedReadings.length > 1) {
      const seenDel = new Set();
      const keptDel = [];
      for (const r of this.deletedReadings) {
        const key = r.identity() + '\u0000' + (withTrace ? JSON.stringify(r.trace) : '');
        if (seenDel.has(key)) {
          changed = true;
          continue;
        }
        seenDel.add(key);
        keptDel.push(r);
      }
      this.deletedReadings = keptDel;
    }
    return changed;
  }

  /** Active (non-deleted) readings. */
  activeReadings() {
    return this.readings.filter((r) => !r.deleted);
  }

  /** Select this reading, removing all other non-matching readings. */
  selectReading(reading, ruleName = '') {
    for (const r of this.readings) {
      if (r !== reading && !r.deleted) {
        r.deleted = true;
        r.changed = true;
        if (ruleName) r.trace.push(ruleName);
        this.deletedReadings.push(r);
      }
    }
    this.readings = [reading];
    reading.changed = true;
    if (ruleName) reading.trace.push(ruleName);
  }

  /** Remove a reading. */
  removeReading(reading, ruleName = '') {
    if (reading.deleted) return;
    reading.deleted = true;
    reading.changed = true;
    if (ruleName) reading.trace.push(ruleName);
    this.deletedReadings.push(reading);
    for (let i = 0; i < this.readings.length; i++) {
      if (this.readings[i] === reading) {
        // vislcg3 fills the gap with the last reading instead of closing it up. The output is kept in
        // order by the reading numbers, but "first reading that matches" (the $$ unification binds to
        // it) goes by the order in the list.
        const last = this.readings.pop();
        if (i < this.readings.length) this.readings[i] = last;
        break;
      }
    }
  }

  /** Format cohort into VISL CG-3 stream format. */
  toText({ showRules = false, trace = false, pipeDeleted = false, dep = '' } = {}) {
    const out = [];
    if (this.textBefore.length) out.push(...this.textBefore);
    let header = this.wordform;
    if (this.untouchableTags.length) header += ' ' + this.untouchableTags.join(' ');
    out.push(header);
    for (const r of mergeMappedReadings(this.orderedReadings(), trace)) out.push(r.toText({ showRules, trace, dep }));
    if (pipeDeleted) {
      for (const r of [...this.deletedReadings].sort((a, b) => a.number - b.number)) {      // by number, as the readings are
        // vislcg3 prints a deleted reading, and each of its sub-reading lines, with a leading ';'
        for (const ln of r.toText({ showRules, trace }).split('\n')) out.push(';' + ln);
      }
    }
    return out.join('\n');
  }

  /** Deep copy cohort. */
  clone(parentWindow = null) {
    const nc = new Cohort({
      wordform: this.wordform,
      untouchableTags: this.untouchableTags,
      textBefore: this.textBefore,
      lineNumber: this.lineNumber,
      globalNumber: this.globalNumber,
      parentWindow,
    });
    for (const r of this.readings) nc.appendReading(r.clone(nc));
    nc.deletedReadings = this.deletedReadings.map((r) => r.clone(nc));
    return nc;
  }

  toString() {
    return `Cohort(${this.wordform}, ${this.readings.length} readings)`;
  }
}

/** A window (sentence / clause) of cohorts. */
export class SingleWindow {
  constructor(cohorts = null) {
    this.hasDep = false;         // a dependency rule attached something in this window
    this.number = 0;             // 1, 2, 3 ... in the order the windows were read
    this.depPrint = null;        // set when the engine hands the window on: were #n->m being written by then?
    this.depSpanned = false;     // a dependency has gone from one window to another: #<window><cohort>->#<window><cohort>
    this.previous = null;        // the windows around this one while the engine runs it;
    this.next = null;            // contextual tests with W < > look into them
    this.cohorts = cohorts !== null ? [...cohorts] : [];
    this.textAfter = [];
    this.variables = new Map();
    this.flushAfter = false;
    // CG-3 puts a begin cohort (tag >>>) before every window that only contextual tests can reach
    this.begin = this._edge('>>>');
    for (const c of this.cohorts) c.parentWindow = this;
  }

  _edge(tag) {
    const c = new Cohort({ wordform: '', parentWindow: this });
    c.appendReading(new Reading('', [tag]));
    return c;
  }

  /** The last cohort of the window gets the tag <<< (for matching only), as vislcg3 does. */
  markEnd() {
    for (const c of this.cohorts) {
      if (c.isEnd) {
        c.isEnd = false;
        for (const r of c.readings) r.matchCache = null;
      }
    }
    if (this.cohorts.length) {
      const last = this.cohorts[this.cohorts.length - 1];
      last.isEnd = true;
      for (const r of last.readings) r.matchCache = null;
    }
  }

  /** The number of cohorts vislcg3 sees in the window: the begin cohort and the real ones. */
  get size() {
    return this.cohorts.length + 1;
  }

  /** This window and the ones linked to it, from the first to the last. */
  * chain() {
    let w = this;
    while (w.previous !== null) w = w.previous;
    for (; w !== null; w = w.next) yield w;
  }

  /** Cohort at virtual index vi: 0 is the begin cohort, 1..n the real cohorts. */
  virtual(vi) {
    return vi === 0 ? this.begin : this.cohorts[vi - 1];
  }

  /** The virtual index of a cohort: 0 for the begin cohort, 1..n for the real ones (vislcg3's dependency numbers). */
  indexOf(cohort) {
    if (cohort === this.begin) return 0;
    for (let k = 0; k < this.cohorts.length; k++) if (this.cohorts[k] === cohort) return k + 1;
    return -1;
  }

  appendCohort(cohort) {
    cohort.parentWindow = this;
    this.cohorts.push(cohort);
  }

  /**
   * ID:n and R:name:m of the input: relationMap takes an input id to the cohort that carried it; relations to ids
   * not seen (yet) are dropped.
   */
  resolveInputRelations(relationMap) {
    for (const c of this.cohorts) if (c.relIn !== null && c.relIn[0]) relationMap.set(c.relIn[0], c);
    for (const c of this.cohorts) {
      if (c.relIn === null) continue;
      c.related = true;
      for (const [name, targets] of c.relIn[1]) {
        for (const t of [...targets].sort((a, b) => a - b)) {
          const other = relationMap.get(t);
          if (other !== undefined) c.addRelation(name, other.globalNumber);
        }
      }
    }
  }

  /**
   * The #n->m of the input become real links. n and m count the cohorts as the input numbered them (it may restart
   * in every window, or a repeated n starts a new numbering); a parent that does not exist leaves the cohort without
   * one, and 0 is the root (vislcg3's reflowDependencyWindow).
   */
  resolveInputDependencies() {
    const pending = [];
    let numbering = new Map();
    const byIndex = (a, b) => this.indexOf(a) - this.indexOf(b);
    const flush = () => {
      numbering.set(0, this.begin);
      for (const c of pending) {
        const [own, parent] = c.depIn;
        if (own === parent) continue;
        const target = numbering.get(parent);
        if (target === undefined || target === c) continue;
        c.depParent = target;
        target.depChildren.push(c);
      }
      for (const c of pending) c.depChildren.sort(byIndex);
      this.begin.depChildren.sort(byIndex);
      pending.length = 0;
      numbering = new Map();
    };
    for (const c of this.cohorts) {
      if (c.depIn === null) continue;
      this.hasDep = true;
      if (numbering.has(c.depIn[0])) flush();
      numbering.set(c.depIn[0], c);
      pending.push(c);
    }
    if (pending.length) flush();
  }

  /**
   * deps: print #self->parent on every reading (vislcg3 does once a dependency rule has attached anything);
   * null/undefined means: if this window has an attachment.
   */
  toText({ showRules = false, trace = false, pipeDeleted = false, deps = null } = {}) {
    if (deps === null || deps === undefined) deps = this.depPrint !== null ? this.depPrint : this.hasDep;
    const lines = [];
    this.cohorts.forEach((c, k) => {
      let dep = '';
      if (deps) {
        let parent = c.depParent;
        if (parent !== null && parent.parentWindow !== null && parent.parentWindow.number < this.number) {
          parent = null;         // that window has been written (and let go of) already: vislcg3 can no longer find the cohort
        }
        if (this.depSpanned) {
          // once a dependency spans windows vislcg3 numbers globally: window number, then the place in the window (3 digits)
          const pw = parent !== null && parent.parentWindow !== null ? parent.parentWindow : this;
          const pk = parent !== null ? pw.indexOf(parent) : k + 1;
          const pad = (n) => String(n).padStart(3, '0');
          dep = `#${this.number}${pad(k + 1)}->${parent !== null ? pw.number : this.number}${pad(pk)}`;
        } else {
          dep = `#${k + 1}->${parent !== null ? this.indexOf(parent) : k + 1}`;
        }
      }
      const rel = c.relationText();
      if (rel) dep = dep ? `${dep} ${rel}` : rel;
      lines.push(c.toText({ showRules, trace, pipeDeleted, dep }));
    });
    if (this.textAfter.length) lines.push(...this.textAfter);
    return lines.join('\n');
  }
}
