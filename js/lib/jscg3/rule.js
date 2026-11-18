// Rule representation and execution for VISL CG-3.

import { Cohort, Reading } from './cohort.js';
import { AttachState, ContextualTest, byOrder, resetSeenBarrier, runContextualTest, seenBarrier, setAttach } from './context.js';
import { CompositeTag, SetDefinition, UnifySet, getUnif, setUnif } from './set_def.js';
import { TagPattern, isBaseform } from './tag.js';

const DEP_TYPES = ['SETPARENT', 'SETCHILD'];
const REL_TYPES = ['ADDRELATION', 'SETRELATION', 'REMRELATION', 'ADDRELATIONS', 'SETRELATIONS', 'REMRELATIONS'];
const TO_TYPES = new Set([...DEP_TYPES, ...REL_TYPES]);
const DEDUPE_AFTER = new Set(['SUBSTITUTE', 'REPLACE', 'ADD', 'MAP', 'UNMAP', 'COPY', 'APPEND']);

/** A single CG-3 rule: TYPE[:name] [flags] [action] [TARGET] set [IF test...]. */
export class Rule {
  constructor(ruleType, target, {
    name = '', lineNumber = 0, contextTests = null, actionTags = null, substOld = null, targetModifiers = '',
    wordformFilter = null, substOldTag = null,
  } = {}) {
    this.type = ruleType.toUpperCase();
    this.name = name;
    // the trace label vislcg3 -t prints after a changed reading: TYPE:line[:name]
    this.label = `${this.type}:${lineNumber}${name ? ':' + name : ''}`;
    this.lineNumber = lineNumber;
    this.target = target;
    this.targetModifiers = targetModifiers;
    this.contextTests = contextTests ? [...contextTests] : [];
    this.actionTags = actionTags ? [...actionTags] : [];
    this.substOld = substOld;
    this.substOldTag = substOldTag;
    this.wordformFilter = wordformFilter;
    this.direction = 'AFTER';
    this.flags = new Set();
    this.isCareful = targetModifiers.toLowerCase().includes('c');
    this.usesUnify = false;
    this._maps = null;
    this.sub = null;             // SUB:n - the target set is matched against the n-th sub-reading
    this.copyExcept = null;      // COPY (tags) EXCEPT set TARGET ... - the copy leaves out the tags in this set
    this.depTests = [];          // SETPARENT / SETCHILD ... TO (tests)
    this.relSub = [];            // ADDRELATIONS (a) (b): the names b, for the cohort found
    this.childset = null;        // WITHCHILD set: SWITCHPARENT takes along the siblings it matches
  }

  /**
   * Does a change by this rule send its section round again? As in vislcg3, only SELECT, REMOVE, IFF,
   * REMCOHORT, MOVE and SWITCH do, unless the rule says ITERATE / NOITERATE.
   */
  get iterates() {
    if (this.flags.has('ITERATE')) return true;
    if (this.flags.has('NOITERATE')) return false;
    return ['SELECT', 'REMOVE', 'IFF', 'DELIMIT', 'REMCOHORT', 'MOVE', 'SWITCH'].includes(this.type);
  }

  // -- application ------------------------------------------------------------------------
  /** Apply the rule to every cohort of the window once. True if anything changed. */
  applyToWindow(window, grammar) {
    let changed = false;
    let stuck = false;                 // IFF: a cohort whose every reading was to go was met (see _iffRemove)
    let i = 0;
    if (this._maps === null) this._maps = this._mentionsMappingTag(grammar);
    const mp = grammar ? grammar.mappingPrefix : '@';
    while (i < window.cohorts.length) {
      const cohort = window.cohorts[i];
      if (this.wordformFilter && cohort.wordform !== this.wordformFilter) {
        i++;
        continue;
      }
      if (this._maps && cohort.readings.some((r) => !r.deleted && r.mappingTags.size > 1)) {
        // vislcg3 makes one reading of each mapping tag when a rule's target matches one of them
        if (cohort.readings.some((r) => !r.deleted && r.mappingTags.size > 1 && this._targetMatches(r))) cohort.splitMappings(mp);
      }
      let targets;
      let testsOk;
      if (this.usesUnify && TO_TYPES.has(this.type)) {
        targets = cohort.readings.filter((r) => !r.deleted);      // _setDependency binds the $$Sets itself
        testsOk = true;
        if (!targets.length) {
          i++;
          continue;
        }
      } else if (this.usesUnify) {
        [targets, testsOk] = this._unifyTargets(window, i, cohort, grammar);
        if (!targets.length) {
          i++;
          continue;
        }
      } else {
        targets = cohort.readings.filter((r) => !r.deleted && this._targetMatches(r));
        testsOk = null;
      }
      if (!targets.length && this.type !== 'SETVARIABLE' && this.type !== 'REMVARIABLE') {     // ADDCOHORT / REMCOHORT need a target too
        i++;
        continue;
      }
      if ((this.type === 'REMPARENT' || this.type === 'SWITCHPARENT') && cohort.depParent === null) {
        i++;                                      // no parent: nothing to remove or switch
        continue;
      }
      if (cohort.depParent !== null && (this.flags.has('NOPARENT') || (this.type === 'SETPARENT' && this.flags.has('SAFE')))) {
        i++;                                      // SETPARENT SAFE (and NOPARENT) leave a cohort that already has a parent alone
        continue;
      }
      if (testsOk === null) testsOk = this.contextTests.every((t) => t.evaluate(window, i, grammar));
      if (!testsOk) {
        if (this.type === 'IFF') {                    // IFF: SELECT where the contexts hold, REMOVE where they do not
          const [did, nowStuck] = this._iffRemove(cohort, targets, stuck);
          stuck = nowStuck;
          changed = did || changed;
        }
        i++;
        continue;
      }
      const [did, delta] = this._act(window, i, cohort, targets, grammar);
      if (did && DEDUPE_AFTER.has(this.type)) cohort.dedupeReadings(Boolean(grammar && grammar.traceMode));
      changed = changed || did;
      i += 1 + delta;
    }
    return changed;
  }

  /** Does the target set of this rule name a mapping tag (@SUBJ ...)? */
  _mentionsMappingTag(grammar) {
    const prefix = grammar ? grammar.mappingPrefix : '@';
    const seen = new Set();

    const walk = (obj) => {
      if (obj === null || obj === undefined || typeof obj === 'number') return false;
      if (typeof obj === 'string') {
        obj = grammar ? grammar.sets.get(obj) : undefined;
        if (obj === undefined || seen.has(obj)) return false;
      } else if (seen.has(obj)) {
        return false;
      }
      seen.add(obj);
      if (obj instanceof TagPattern) return obj.raw.replace(/^!+/, '').startsWith(prefix);
      if (obj instanceof CompositeTag) return obj.elements.some(walk);
      if (obj instanceof UnifySet) return walk(obj.registry.get(obj.name));
      if (obj instanceof SetDefinition) {
        if (obj.items.some(walk)) return true;
        return obj.groups.some((chain) => chain.some(([, operand]) => walk(operand)));
      }
      if (obj instanceof ContextualTest) {
        return walk(obj.target) || walk(obj.barrier) || walk(obj.cbarrier) || walk(obj.linkedTest) || obj.ors.some(walk);
      }
      return false;
    };

    return walk(this.target);           // only the target: a mapping tag in a context does not split anything
  }

  /**
   * With $$Set / &&Set in the rule each target reading is tried on its own: the contexts have to agree
   * with what that reading matched. Returns [readings that pass, true].
   */
  _unifyTargets(window, i, cohort, grammar) {
    const good = [];
    try {
      for (const r of cohort.readings) {
        if (r.deleted) continue;
        setUnif(new Map());
        if (this._targetMatches(r) && this.contextTests.every((t) => t.evaluate(window, i, grammar))) good.push(r);
      }
    } finally {
      setUnif(null);
    }
    return [good, true];
  }

  _targetMatches(reading) {
    if (this.sub !== null) {
      reading = reading.subReading(this.sub);
      if (reading === null) return false;
    }
    const res = this.target instanceof SetDefinition ? this.target.matchesReading(reading) : false;
    return this.targetModifiers.includes('!') ? !res : res;
  }

  _act(window, i, cohort, targets, grammar) {
    const t = this.type;
    const mp = grammar ? grammar.mappingPrefix : '@';
    if (TO_TYPES.has(t)) return [this._setDependency(window, i, cohort, targets, grammar), 0];
    if (t === 'REMPARENT') {
      targets[0].trace.push(this.label);
      cohort.depParent = null;               // vislcg3 leaves the cohort in the old parent's list of children
      return [true, 0];
    }
    if (t === 'SWITCHPARENT') return [this._switchParent(window, cohort, targets[0], grammar), 0];
    if (t === 'SELECT') return [this._select(cohort, targets), 0];
    if (t === 'REMOVE') return [this._remove(cohort, targets), 0];
    if (t === 'IFF') return [this._select(cohort, targets), 0];
    if (t === 'ADD' || t === 'MAP') return [this._add(targets, mp, t === 'MAP'), 0];
    if (t === 'UNMAP') {
      let did = false;
      for (const r of targets) {
        for (const tag of [...r.mappingTags]) {
          r.removeTag(tag);
          did = true;
        }
        if (did) r.trace.push(this.label);
      }
      return [did, 0];
    }
    if (t === 'REPLACE') {
      targets = targets.filter((r) => !r.mapped);
      for (const r of targets) {
        r.tags = [...this.actionTags];
        r.tagSet = new Set(r.tags);
        r.matchCache = null;
        r.mappingTags = new Set(r.tags.filter((x) => x.startsWith(mp)));
        r.changed = true;
        r.trace.push(this.label);
      }
      return [targets.length > 0, 0];
    }
    if (t === 'SUBSTITUTE') return [this._substitute(targets, mp), 0];
    if (t === 'APPEND' && this.actionTags.length) {
      const nr = new Reading(this.actionTags[0], this.actionTags.slice(1), cohort);
      nr.changed = true;
      nr.trace.push(this.label);
      cohort.appendReading(nr);
      return [true, 0];
    }
    if (t === 'COPY') {
      for (const r of targets) {
        const nr = r.clone(cohort);
        if (this.copyExcept !== null) {
          const keep = nr.tags.filter((tag) => !this.copyExcept.matchesReading(new Reading(nr.baseform, [tag])));
          nr.tags = keep;
          nr.tagSet = new Set(keep);
          nr.mappingTags = new Set(keep.filter((x) => x.startsWith(mp)));
        }
        for (const tag of this.actionTags) nr.addTag(tag, mp);
        nr.trace.push(this.label);
        cohort.appendReading(nr);
      }
      return [targets.length > 0, 0];
    }
    if (t === 'REMCOHORT') {
      window.cohorts.splice(i, 1);
      return [true, -1];
    }
    if (t === 'ADDCOHORT') return this._addcohort(window, i);
    if (t === 'SETVARIABLE') {
      for (const tag of this.actionTags) {
        const eq = tag.indexOf('=');
        const k = eq < 0 ? tag : tag.slice(0, eq);
        const v = eq < 0 ? '' : tag.slice(eq + 1);
        window.variables.set(k, v || '1');
      }
      return [true, 0];
    }
    if (t === 'REMVARIABLE') {
      for (const tag of this.actionTags) window.variables.delete(tag);
      return [true, 0];
    }
    return [false, 0];
  }

  /**
   * SETPARENT: the cohort becomes a child of the cohort the TO tests lead to; SETCHILD: the other way round.
   * The cohort it leads to is the one of the test with the A flag, else where the last LINKed test ended;
   * a candidate that would make a loop is skipped (the scan goes on), and an earlier attachment is replaced.
   */
  _setDependency(window, i, cohort, targets, grammar) {
    if (!this.depTests.length) return false;
    let lead = targets.length ? targets[0] : null;      // the reading that gets the label
    let found = null;
    if (this.usesUnify) {
      // $$Sets bind on the first reading that matches the target and have to agree in the contexts and the TO
      // tests as well; vislcg3 does not go on to the next reading with a binding of its own
      for (const r of targets) {
        setUnif(new Map());
        try {
          if (!this._targetMatches(r)) continue;
          if (this.contextTests.every((t) => t.evaluate(window, i, grammar))) found = this._depSearch(window, i, cohort, grammar);
        } finally {
          setUnif(null);
        }
        lead = r;
        break;
      }
    } else {
      found = this._depSearch(window, i, cohort, grammar);
    }
    if (found === null) return false;
    const other = found;                             // the cohort the tests led to
    if (REL_TYPES.includes(this.type)) return this._relate(cohort, other, lead);
    const asChild = (this.type === 'SETPARENT') !== this.flags.has('REVERSE');      // FROM turns it round
    const [child, parent] = asChild ? [cohort, other] : [other, cohort];
    if (child.depParent !== parent) {           // vislcg3 labels the readings even when it attaches to the same parent again
      if (child.depParent !== null) {
        const sibs = child.depParent.depChildren;
        sibs.splice(sibs.indexOf(child), 1);
      }
      child.depParent = parent;
      parent.depChildren.push(child);
      parent.depChildren.sort(byOrder);
    }
    window.hasDep = true;
    if (child.parentWindow !== parent.parentWindow && grammar) grammar.depHasSpanned = true;
    if (lead !== null) lead.trace.push(this.label);           // vislcg3 labels the first reading that matched, not all of them
    return true;
  }

  /**
   * SWITCHPARENT WITHCHILD set target: the cohort becomes the parent of its own parent and of the siblings the set
   * matches, and takes the place of the parent under the grandparent.
   */
  _switchParent(window, child, lead, grammar) {
    const parent = child.depParent;
    const grand = parent.depParent;
    const siblings = window.cohorts.filter((c) => c.depParent === parent && (this.childset === null || this.childset.matchesCohortNormal(c)));
    lead.trace.push(this.label);
    child.depParent = null;
    parent.depParent = null;
    for (const s of siblings) s.depParent = null;

    const attach = (p, c) => {
      const state = new AttachState(window, c, true, false, false, Boolean(grammar && grammar.depBlockCrossing),
        grammar ? grammar.depBlockLoops !== false : true);
      if (!state.valid(p)) return;
      if (c.depParent !== null) {
        const sibs = c.depParent.depChildren;
        const at = sibs.indexOf(c);
        if (at >= 0) sibs.splice(at, 1);
      }
      c.depParent = p;
      p.depChildren.push(c);
      p.depChildren.sort(byOrder);
      if (c.parentWindow !== p.parentWindow && grammar) grammar.depHasSpanned = true;
    };

    if (grand !== null) attach(grand, child);
    attach(child, parent);
    for (const s of siblings) attach(child, s);
    return true;
  }

  /**
   * ADDRELATION / SETRELATION / REMRELATION (name): the target cohort gets a relation to the cohort found (FROM turns
   * it round); the plural rules also give the cohort found one back, under the second name.
   */
  _relate(cohort, other, lead) {
    const [target, attach] = this.flags.has('REVERSE') ? [other, cohort] : [cohort, other];
    let did = false;
    const kind = this.type.slice(0, 3);
    const apply = (owner, name, to) => {
      if (kind === 'ADD') {
        owner.related = true;
        return owner.addRelation(name, to.globalNumber);
      }
      if (kind === 'SET') {
        owner.related = true;
        return owner.setRelation(name, to.globalNumber);
      }
      return owner.remRelation(name, to.globalNumber);
    };
    for (const name of this.actionTags) {
      if (this.type === 'ADDRELATION' || this.type === 'SETRELATION') attach.related = true;
      did = apply(target, name, attach) || did;
    }
    for (const name of this.relSub) did = apply(attach, name, target) || did;
    if (did && lead !== null) lead.trace.push(this.label);
    return did;
  }

  /** The cohort the TO tests lead to for the cohort at window index i, or null. */
  _depSearch(window, i, cohort, grammar) {
    // As in vislcg3 the first TO test runs from the cohort and leads to one cohort (the one with the A flag, else where
    // the last LINKed test ended); the other TO tests have to hold from there. If that cohort cannot be attached to
    // (a loop, crossing branches) the test is run again from it - an offset other than 0 becomes +1 / -1 - and a cohort
    // seen before ends the search. A barrier met by the scan ends it as well, and so does the flag NEAREST.
    const check = DEP_TYPES.includes(this.type);
    const asChild = (this.type === 'SETPARENT') !== this.flags.has('REVERSE');
    const attacher = new AttachState(
      window, cohort, asChild, this.flags.has('ALLOWLOOP'), this.flags.has('ALLOWCROSS'),
      Boolean(grammar && grammar.depBlockCrossing), grammar ? grammar.depBlockLoops !== false : true, check);
    const state = new AttachState(window, cohort, true, false, false, false, true, false);       // only notes where the test ends up
    const first = this.depTests[0];
    const rest = this.depTests.slice(1);
    const orgOffset = first.offset;
    const seen = new Set([cohort]);
    let atWindow = window;
    let at = i + 1;
    try {
      for (;;) {
        const bindings = getUnif();
        const saved = bindings !== null && bindings !== undefined ? new Map([...bindings].map(([k, v]) => [k, [...v]])) : null;
        state.marked = state.final = null;
        setAttach(state);
        resetSeenBarrier();
        const led = runContextualTest(atWindow, at, first);
        setAttach(null);
        if (!led || state.final === null) return null;
        const attach = state.final;
        const stop = seenBarrier() || this.flags.has('NEAREST');
        const good = rest.every((t) => runContextualTest(attach.parentWindow, attach.parentWindow.indexOf(attach), t));
        if (good) {
          if (check) window.hasDep = true;       // vislcg3 prints dependencies once a rule has got this far
          if (attacher.valid(attach)) return attach;
        }
        if (stop || seen.has(attach)) return null;
        seen.add(attach);
        if (saved !== null) setUnif(saved);
        atWindow = attach.parentWindow;
        at = attach.parentWindow.indexOf(attach);
        if (first.offset !== 0) first.offset = first.offset < 0 ? -1 : 1;
      }
    } finally {
      first.offset = orgOffset;
      setAttach(null);
    }
  }

  _select(cohort, targets) {
    const active = cohort.readings.filter((r) => !r.deleted);
    if (active.length <= 1 || !targets.length || targets.length === active.length) return false;
    const keep = new Set(targets);
    for (const r of active) {
      if (!keep.has(r)) cohort.removeReading(r, this.sub !== null ? '' : this.label);
    }
    for (const r of targets) {
      r.changed = true;
      this._traceHolder(r).trace.push(this.label);
    }
    return true;
  }

  /** With SUB:n vislcg3 -t writes the rule on the line of the sub-reading it matched. */
  _traceHolder(reading) {
    if (this.sub !== null) return reading.subReading(this.sub) || reading;
    return reading;
  }

  /**
   * The REMOVE half of IFF. Where a plain REMOVE would take every reading of a cohort and so does nothing, IFF still
   * writes its label on all of them (each time the section is run) although none is removed - and from then on, for the
   * rest of that run of the rule over the window, it only labels the readings it should have removed.
   */
  _iffRemove(cohort, targets, stuck) {
    const active = cohort.readings.filter((r) => !r.deleted);
    if (active.length <= 1) return [false, stuck];
    if (stuck || targets.length >= active.length) {
      for (const r of targets) this._traceHolder(r).trace.push(this.label);
      return [false, true];
    }
    return [this._remove(cohort, targets), stuck];
  }

  _remove(cohort, targets) {
    const active = cohort.readings.filter((r) => !r.deleted);
    if (active.length <= 1 || targets.length >= active.length) return false;      // a cohort never loses its last reading
    for (const r of targets) {
      if (this.sub !== null) {
        cohort.removeReading(r);
        this._traceHolder(r).trace.push(this.label);
      } else {
        cohort.removeReading(r, this.label);
      }
    }
    return true;
  }

  /** The order vislcg3 puts added tags in: the plain ones as written, then the mapping tags, last one first. */
  _orderedActionTags(mp) {
    const mapping = this.actionTags.filter((t) => t.startsWith(mp));
    if (mapping.length < 2) return this.actionTags;
    return [...this.actionTags.filter((t) => !t.startsWith(mp)), mapping[mapping.length - 1], ...mapping.slice(0, -1)];
  }

  _add(targets, mp, isMap) {
    let changed = false;
    for (const r of targets) {
      if (r.mapped) continue;                 // as in vislcg3, MAP, ADD and REPLACE leave a mapped reading alone
      // vislcg3 appends the tags every time the rule runs: a tag the reading has already is listed twice (the tag set,
      // and so the identity of the reading, stays the same) and the rule is traced once more.
      for (const tag of this._orderedActionTags(mp)) {
        r.tags.push(tag);
        r.tagSet.add(tag);
        if (tag.startsWith(mp)) r.mappingTags.add(tag);
      }
      r.matchCache = null;
      r.changed = true;
      if (isMap) r.mapped = true;
      r.trace.push(this.label);
      changed = true;
    }
    return changed;
  }

  _substitute(targets, mp) {
    if (this.substOld === null) return false;
    const next = this.actionTags.filter((x) => x !== '*');
    let changed = false;
    for (const r of targets) {
      const hits = [];
      r.tags.forEach((tag, k) => {
        if (this._oldMatches(tag)) hits.push(k);
      });
      if (!hits.length) continue;
      const first = hits[0];
      const out = [];
      // a base form in the new list ("lemma" Tag ...) is the reading's base form, not one more tag
      const plain = [];
      for (const x of next) {
        if (isBaseform(x)) r.baseform = x;
        else plain.push(x);
      }
      r.tags.forEach((tag, k) => {
        if (k === first) out.push(...plain);
        if (!hits.includes(k)) out.push(tag);
      });
      r.tags = out;
      r.tagSet = new Set(out);
      r.matchCache = null;
      r.mappingTags = new Set(out.filter((x) => x.startsWith(mp)));
      r.changed = true;
      r.trace.push(this.label);
      changed = true;
    }
    return changed;
  }

  _oldMatches(tag) {
    return this.substOld.matchesReading(new Reading('', [tag]));
  }

  _addcohort(window, i) {
    if (!this.actionTags.length) return [false, 0];
    const word = this.actionTags[0];
    const base = this.actionTags.length > 1 ? this.actionTags[1] : '""';
    const newC = new Cohort({ wordform: word, parentWindow: window });
    const r = new Reading(base, this.actionTags.slice(2), newC);
    r.changed = true;
    r.trace.push(this.label);
    newC.appendReading(r);
    if (this.direction === 'BEFORE') {
      window.cohorts.splice(i, 0, newC);
      return [true, 1];
    }
    window.cohorts.splice(i + 1, 0, newC);
    return [true, 0];
  }

  toString() {
    return `Rule(${this.label} ${this.target} ${this.contextTests.map(String).join(' ')})`;
  }
}
