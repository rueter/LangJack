// Contextual tests, ported from vislcg3's runContextualTest / runSingleTest / doesSetMatchCohort*.
//
// The odd corners are deliberate: they are what the real engine does and real grammars depend on them.
//   * the window has a begin cohort (index 0, tag >>>) in front of the real cohorts; the last real cohort answers to <<<
//   * 0* scans both ways, alternating: one to the left, one to the right, two to the left, ...
//   * NOT is applied to the set match of every cohort tested - and to the BARRIER match of a NOT test as well
//   * a scan with * stops at the first cohort that matches the target (even if a LINKed test then fails)

import { Reading } from './cohort.js';

const TRV_BREAK = 1;
const TRV_BARRIER = 2;
const TRV_BREAK_DEFAULT = 4;

/** The dSMC_Context of the C++ code: state shared by the set matches of one cohort test. */
class Ctx {
  constructor(test = null, not = false, inBarrier = false, window = null, index = 0) {
    this.test = test;
    this.not = not;
    this.matchedTarget = false;
    this.matchedTests = false;
    this.didTest = false;
    this.inBarrier = inBarrier;
    this.window = window;
    this.index = index;
    this.rejected = false;       // SETPARENT: the chain failed on a candidate that cannot be attached to
  }
}

/** One contextual test with its barriers and LINKed tests. */
export class ContextualTest {
  constructor({
    target, offset = 0, scanFirst = false, scanAll = false, careful = false, not = false, negate = false,
    absolute = false, self = false, noBarrier = false, all = false, none = false, barrier = null, cbarrier = null,
    linkedTest = null, rawPos = '', sub = null, dep = null, attach = false, relation = null,
    spanLeft = false, spanRight = false, spanBoth = false,
  }) {
    this.spanLeft = spanLeft;    // < : the test may go on into the previous window
    this.spanRight = spanRight;  // > : ... into the next window
    this.spanBoth = spanBoth;    // W : ... into either
    this.relation = relation;    // r:name - the cohorts the relation `name` points to (r:* any relation)
    this.dep = dep;              // p parent, c children, s siblings, pp ancestors, cc descendants (dependency tests)
    this.attach = attach;        // the A flag: this test's cohort is the one a SETPARENT / SETCHILD attaches to
    this.target = target;
    this.offset = offset;
    this.scanFirst = scanFirst;
    this.scanAll = scanAll;
    this.careful = careful;
    this.not = not;
    this.negate = negate;
    this.absolute = absolute;
    this.self = self;
    this.noBarrier = noBarrier;
    this.all = all;
    this.none = none;
    this.barrier = barrier;
    this.cbarrier = cbarrier;
    this.linkedTest = linkedTest;
    this.rawPos = rawPos;
    this.sub = sub;
    this.ors = [];               // (test) OR (test): holds if any alternative does
  }

  get isScan() {
    return this.scanFirst || this.scanAll;
  }

  /** True if the test holds for the real cohort at window.cohorts[cohortIdx]. */
  evaluate(window, cohortIdx) {
    return runContextualTest(window, cohortIdx + 1, this);
  }

  toString() {
    return `(${this.negate ? 'NEGATE ' : ''}${this.not ? 'NOT ' : ''}${this.rawPos})`;
  }
}

/**
 * What a SETPARENT / SETCHILD rule is attaching while its TO tests run: the tests report the cohort to attach
 * to, and a candidate that would make a loop (or is the cohort itself) counts as a test that did not match, so a
 * scan goes on to the next cohort (as in vislcg3).
 */
export class AttachState {
  constructor(window, cohort, asChild = true, allowLoop = false, allowCross = false, blockCrossing = false, blockLoops = true, check = true) {
    this.window = window;
    this.cohort = cohort;        // the cohort the rule is on
    this.asChild = asChild;      // SETPARENT: it becomes the child of the cohort found; SETCHILD: the parent
    this.allowLoop = allowLoop || !blockLoops;
    this.allowCross = allowCross;
    this.blockCrossing = blockCrossing;
    this.blockLoops = blockLoops;
    this.check = check;          // relations may point anywhere, the cohort itself included
    this.marked = null;          // the cohort whose test has the A flag
    this.final = null;           // the cohort the last LINKed test ended on
    this.matched = false;        // the tests led somewhere, even if only to a cohort that cannot be attached
    this.rejections = 0;         // how many candidates were turned down as self or loop
  }

  /** wouldParentChildCross, quirks included: it only looks at the parent's parent and what that one hangs on. */
  _crosses(parent, child) {
    const a = this.window.indexOf(parent);
    const b = this.window.indexOf(child);
    if (a < 0 || b < 0) return false;                  // (a dependency from one window to another is not tested for crossing)
    const mn = Math.min(a, b);
    const mx = Math.max(a, b);
    if (mx - mn < 2) return false;
    const grand = parent.depParent;
    if (grand !== null && grand.depParent !== null) {
      const top = this.window.indexOf(grand.depParent);
      if (top < mn || top > mx) return true;
    }
    return false;
  }

  valid(other) {
    if (!this.check) return true;
    if (other === this.cohort || other.parentWindow === null) return false;
    // the child must not be an ancestor of the parent
    const [child, parent] = this.asChild ? [this.cohort, other] : [other, this.cohort];
    if (!this.allowLoop && child.depParent !== parent) {
      let node = parent;
      const seen = new Set();
      while (node !== null && !seen.has(node)) {          // a loop higher up in the tree (in the input) does not block
        if (node === child) return false;
        seen.add(node);
        node = node.depParent;
      }
    }
    if (this.blockCrossing && !this.allowCross && this._crosses(parent, child)) return false;
    return true;
  }
}

let ATTACH = null;
let SEEN_BARRIER = false;          // a BARRIER / CBARRIER stopped a scan (the SETPARENT loop does not go on after one)
let ALWAYS_SPAN = false;           // --always-span: scans go across window boundaries whatever the position says

export function resetSeenBarrier() {
  SEEN_BARRIER = false;
}

export function seenBarrier() {
  return SEEN_BARRIER;
}

export function setAlwaysSpan(flag) {
  ALWAYS_SPAN = Boolean(flag);
}

/** Where a cohort stands among all cohorts: its window, then its place in the window. */
export function orderKey(cohort) {
  const w = cohort.parentWindow;
  return w !== null ? [w.number, w.indexOf(cohort)] : [0, -1];
}

export function byOrder(a, b) {
  const [aw, ai] = orderKey(a);
  const [bw, bi] = orderKey(b);
  return aw - bw || ai - bi;
}

export function setAttach(state) {
  ATTACH = state;
}

// -- set matching (doesSetMatchCohortNormal / Careful) -------------------------------------------
/** doesSetMatchCohort_testLinked */
function testLinked(window, index, ctx) {
  const linked = ctx.test !== null ? ctx.test.linkedTest : null;
  if (linked === null) {
    const att = ATTACH;
    if (att !== null && ctx.test !== null && !ctx.inBarrier) {
      // the end of the chain: the cohort to attach to must be a possible one, or the scan goes on
      const cand = att.marked !== null ? att.marked : window.virtual(index);
      att.matched = true;
      if (!att.valid(cand)) {
        att.rejections++;
        return false;
      }
      att.final = cand;
    }
    return true;
  }
  if (!ctx.didTest) {
    ctx.matchedTests = runContextualTest(window, index, linked);
    ctx.didTest = true;
  }
  return ctx.matchedTests;
}

/** doesSetMatchCohort_helper */
function helper(window, index, reading, target, ctx) {
  let ret = false;
  let anySub = false;
  if (ctx !== null && ctx.test !== null && ctx.test.sub !== null && !ctx.inBarrier) {
    if (ctx.test.sub === '*') anySub = reading !== null;
    else if (reading !== null) reading = reading.subReading(ctx.test.sub);
  }
  let hit;
  if (anySub) hit = target.matchesReading(reading) || reading.subChain().some((r) => target.matchesReading(r));
  else hit = reading !== null && target.matchesReading(reading);
  if (hit) {
    ret = true;
    if (ctx !== null) ctx.matchedTarget = true;
  }
  if (ret && ctx !== null && ctx.not) ret = !ret;
  const att = ATTACH;
  const live = att !== null && ctx !== null && ctx.test !== null && !ctx.inBarrier;
  if (ret && live && ctx.test.attach) att.marked = window.virtual(index);
  if (ret && ctx !== null && !ctx.inBarrier) {
    const before = live ? att.rejections : 0;
    ret = testLinked(window, index, ctx);
    if (!ret && live && (att.rejections !== before || ctx.rejected)) {
      ctx.matchedTarget = false;          // a chain that failed on a cohort that cannot be attached to does not stop a scan
      ctx.rejected = true;                // (the other readings of the cohort reuse the answer of the first one)
    }
  }
  return ret;
}

/** The reading that stands for the cohort itself: its word form and the static tags after it. */
function wread(cohort) {
  if (cohort.wread === null) cohort.wread = new Reading('', [...cohort.untouchableTags], cohort);
  return cohort.wread;
}

function matchNormal(window, index, target, ctx) {
  const cohort = window.virtual(index);
  let ret = false;
  if (cohort.untouchableTags.length && !ctx.inBarrier) {
    ret = helper(window, index, wread(cohort), target, ctx);
    if (ret && ctx.didTest) return ret;
  }
  for (const reading of cohort.readings) {
    if (reading.deleted) continue;
    if (helper(window, index, reading, target, ctx)) ret = true;
    if (ret && (ctx.test === null || ctx.test.linkedTest === null || ctx.didTest)) return ret;
  }
  if (!ctx.matchedTarget && ctx.not) ret = testLinked(window, index, ctx);
  return ret;
}

function matchCareful(window, index, target, ctx) {
  const cohort = window.virtual(index);
  let ret = false;
  for (const reading of cohort.readings) {
    if (reading.deleted) continue;
    ret = helper(window, index, reading, target, ctx);
    if (!ret) break;
  }
  if (!ctx.matchedTarget && ctx.not) ret = testLinked(window, index, ctx);
  return ret;
}

// -- one cohort (runSingleTest) ------------------------------------------------------------------
/** Returns [cohort index or null, retval, rvs]. */
function single(window, index, test, rvs) {
  if (index < 0 || index > window.cohorts.length) return [null, false, rvs | TRV_BREAK];
  const ctx = new Ctx(test, test.not, false, window, index);
  let ret;
  if (test.careful) {
    ret = matchCareful(window, index, test.target, ctx);
    if (!ctx.matchedTarget && test.scanFirst) {
      ctx.didTest = true;
      matchNormal(window, index, test.target, ctx);
    }
  } else {
    ret = matchNormal(window, index, test.target, ctx);
  }

  if (ctx.matchedTarget && test.scanFirst) rvs |= TRV_BREAK;
  else if (!(test.scanAll || test.scanFirst)) rvs |= TRV_BREAK | TRV_BREAK_DEFAULT;
  const broken = Boolean(rvs & TRV_BREAK);

  if (test.barrier !== null) {
    const bctx = new Ctx(null, test.not, true, window, index);
    if (matchNormal(window, index, test.barrier, bctx)) {
      SEEN_BARRIER = true;
      rvs |= TRV_BREAK | TRV_BARRIER;
      rvs &= ~TRV_BREAK_DEFAULT;
    }
  }
  if (test.cbarrier !== null) {
    const bctx = new Ctx(null, test.not, true, window, index);
    if (matchCareful(window, index, test.cbarrier, bctx)) {
      SEEN_BARRIER = true;
      rvs |= TRV_BREAK | TRV_BARRIER;
      rvs &= ~TRV_BREAK_DEFAULT;
    }
  }
  if (ctx.matchedTarget && ret) rvs |= TRV_BREAK;
  if (!broken && (rvs & TRV_BARRIER) && test.self && test.noBarrier) rvs &= ~(TRV_BREAK | TRV_BARRIER);
  return [index, ret, rvs];
}

// -- a whole test (runContextualTest) ---------------------------------------------------------------
/** The cohorts a dependency position leads to: p parent, c children, s siblings, pp ancestors, cc descendants. */
function depCandidates(cohort, kind, test = null, window = null) {
  if (kind === 'r') {
    const ids = [];
    for (const [name, targets] of cohort.relations) {
      if (test.relation === '*' || name === test.relation) for (const t of targets) if (!ids.includes(t)) ids.push(t);
    }
    const byNumber = new Map();
    for (const w of window.chain()) {
      byNumber.set(w.begin.globalNumber, w.begin);
      for (const c of w.cohorts) byNumber.set(c.globalNumber, c);
    }
    return ids.filter((t) => byNumber.has(t)).map((t) => byNumber.get(t));
  }
  if (kind === 'p') return cohort.depParent !== null ? [cohort.depParent] : [];
  if (kind === 'c') return [...cohort.depChildren];
  if (kind === 's') {
    const parent = cohort.depParent;
    return parent !== null ? parent.depChildren.filter((c) => c !== cohort) : [];
  }
  if (kind === 'pp') {
    const out = [];
    let node = cohort.depParent;
    while (node !== null && !out.includes(node)) {
      out.push(node);
      node = node.depParent;
    }
    return out;
  }
  const out = [];                                          // cc: all descendants
  const stack = [...cohort.depChildren].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!out.includes(node)) {
      out.push(node);
      for (const c of [...node.depChildren].reverse()) stack.push(c);
    }
  }
  return out;
}

/**
 * A test whose position is a dependency one: (p ...) (c ...) (s ...) (pp ...) (cc ...). It holds if any of the
 * cohorts it leads to matches; ALL needs every one to, NONE needs that none does (and holds when there are none).
 */
function runDepTest(window, position, test) {
  if (position < 0 || position > window.cohorts.length) return Boolean(test.none) !== Boolean(test.negate);
  const candidates = depCandidates(window.virtual(position), test.dep, test, window);
  let matched = 0;
  let good = 0;
  for (const cand of candidates) {
    const idx = window.indexOf(cand);
    if (idx < 0) continue;
    const ret = single(window, idx, test, 0)[1];
    if (ret) {
      matched++;
      if (!(test.all || test.none)) break;
    } else {
      good = 1;
      if (test.all) break;
    }
  }
  let retval;
  if (test.none) retval = matched === 0;
  else if (test.all) retval = candidates.length > 0 && !good && matched === candidates.length;
  else {
    retval = matched > 0;
    if (!candidates.length && test.not && test.linkedTest === null) retval = true;     // NOT p (*) holds for a cohort that has no parent
  }
  return test.negate ? !retval : retval;
}

/**
 * getCohortInWindow: the window and virtual index the position of the test leads to from `position`. Going past the
 * edge of the window goes on into the neighbour (index 0, its begin cohort, to the right; the last cohort to the left)
 * if the test has W, > or <. The index is null when nothing is there.
 */
function cohortInWindow(window, position, test) {
  let pos = position + test.offset;
  if (test.absolute && (test.spanLeft || test.spanRight)) {
    if (window.previous !== null && test.spanLeft) window = window.previous;
    else if (window.next !== null && test.spanRight) window = window.next;
    else return [window, pos, null];
  }
  if (test.absolute) pos = test.offset < 0 ? window.size + test.offset : test.offset;
  if (pos >= 0) {
    if (pos >= window.size && (test.spanRight || test.spanBoth) && window.next !== null) {
      window = window.next;
      pos = 0;
    }
  } else if ((test.spanLeft || test.spanBoth) && window.previous !== null) {
    window = window.previous;
    pos = window.size - 1;
  }
  return [window, pos, (pos >= 0 && pos < window.size) ? pos : null];
}

function maySpan(test, left) {
  return ALWAYS_SPAN || test.spanBoth || (left ? test.spanLeft : test.spanRight);
}

/**
 * The next cohort to the left (step -1) or right: TopologyLeftIter / TopologyRightIter. null at the end of what the
 * test may look at: a window edge it may not cross, or the end of the windows.
 */
function stepFrom(window, index, step, test) {
  if (step < 0) {
    if (index === 0) {
      if (window.previous === null || !maySpan(test, true)) return null;
      return [window.previous, window.previous.size - 1];
    }
    return [window, index - 1];
  }
  if (index === window.size - 1) {
    if (window.next === null || !maySpan(test, false)) return null;
    return [window.next, 0];
  }
  return [window, index + 1];
}

export function runContextualTest(window, position, test) {
  if (test.ors.length) {
    const found = test.ors.some((alt) => runContextualTest(window, position, alt));
    return test.negate ? !found : found;
  }
  if (test.dep) return runDepTest(window, position, test);
  const orgWindow = window;
  let retval = true;
  let pos;
  let cohort;
  [window, pos, cohort] = cohortInWindow(window, position, test);

  if (cohort === null) {
    retval = false;
  } else if (test.offset === 0 && test.isScan) {             // 0*: both directions, alternating
    let left = window;
    let right = window;
    let lpos = pos;
    let rpos = pos;
    let rvs = 0;
    if (test.self) {
      [cohort, retval, rvs] = single(window, cohort, test, rvs);
      if (!retval && (rvs & TRV_BREAK_DEFAULT)) rvs &= ~(TRV_BREAK | TRV_BREAK_DEFAULT);
    }
    if ((rvs & TRV_BREAK) && retval) {
      // done
    } else {
      let i = 1;
      while (left !== null || right !== null) {
        if (left !== null) {
          rvs = 0;
          [cohort, retval, rvs] = single(left, lpos - i, test, rvs);
          if ((rvs & TRV_BREAK) && retval) break;
          else if (rvs & TRV_BREAK) {
            left = null;
            if (test.not) right = null;
          } else if (lpos - i === 0) {
            if (maySpan(test, true)) {
              left = left.previous;
              if (left !== null) lpos = i + left.size;
            } else left = null;
          }
        }
        if (right !== null) {
          rvs = 0;
          [cohort, retval, rvs] = single(right, rpos + i, test, rvs);
          if ((rvs & TRV_BREAK) && retval) break;
          else if (rvs & TRV_BREAK) {
            right = null;
            if (test.not) left = null;
          } else if (rpos + i === right.size - 1) {
            if (maySpan(test, false)) {
              right = right.next;
              rpos = -i - 1;
            } else right = null;
          }
        }
        i++;
      }
    }
  } else {                                                   // one direction (or just the one cohort)
    const step = test.offset < 0 ? -1 : (test.offset > 0 ? 1 : 0);
    let at = [window, cohort];
    let seen = 0;
    let rvs = 0;
    let nc = cohort;
    if (test.self) {
      seen++;
      [nc, retval, rvs] = single(orgWindow, position, test, rvs);
      if (!retval && (rvs & TRV_BREAK_DEFAULT)) rvs &= ~(TRV_BREAK | TRV_BREAK_DEFAULT);
    }
    if (!(rvs & TRV_BREAK)) {
      while (at !== null) {
        seen++;
        [nc, retval, rvs] = single(at[0], at[1], test, rvs);
        if (test.all && !retval) {
          nc = null;
          break;
        }
        if (test.none && retval) {
          nc = null;
          break;
        }
        if (rvs & TRV_BREAK) break;
        at = step ? stepFrom(at[0], at[1], step, test) : null;
      }
    }
    if (seen === 0) retval = false;
    if (!retval && test.none) {
      retval = true;
      nc = cohort;
    }
    cohort = nc;
  }

  if (cohort === null) retval = false;
  if (cohort === null && test.not && test.linkedTest === null) retval = !retval;
  if (test.negate) retval = !retval;
  return retval;
}
