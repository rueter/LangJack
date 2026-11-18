// Grammar parser for VISL CG-3 (the subset of the syntax that real Giella grammars use).

import { TagPattern } from './tag.js';
import { SetDefinition, CompositeTag, UnifySet } from './set_def.js';
import { ContextualTest } from './context.js';
import { Rule } from './rule.js';

const SECTION_KEYWORDS = new Set([
  'BEFORE-SECTIONS', 'AFTER-SECTIONS', 'NULL-SECTION', 'SECTION', 'CONSTRAINTS', 'MAPPINGS', 'CORRECTIONS',
]);
export const RULE_KEYWORDS = new Set([
  'SELECT', 'REMOVE', 'IFF', 'ADD', 'MAP', 'UNMAP', 'REPLACE', 'SUBSTITUTE', 'APPEND', 'COPY',
  'ADDCOHORT', 'REMCOHORT', 'MOVE', 'SWITCH', 'SETVARIABLE', 'REMVARIABLE', 'EXECUTE', 'JUMP',
  'SETPARENT', 'SETCHILD',
  'ADDRELATION', 'SETRELATION', 'REMRELATION', 'ADDRELATIONS', 'SETRELATIONS', 'REMRELATIONS',
  'REMPARENT', 'SWITCHPARENT',
]);
const DEP_RULES = new Set(['SETPARENT', 'SETCHILD']);      // attach to the cohort the TO tests lead to
const REL_RULES = new Set(['ADDRELATION', 'SETRELATION', 'REMRELATION', 'ADDRELATIONS', 'SETRELATIONS', 'REMRELATIONS']);
const REL_PAIR = new Set(['ADDRELATIONS', 'SETRELATIONS', 'REMRELATIONS']);          // two relation names: target -> found, found -> target
const TO_RULES = new Set([...DEP_RULES, ...REL_RULES]);                              // rules that end in TO / FROM (tests)
// rule types that take their tags before the target set
const ONE_ACTION = new Set(['ADD', 'MAP', 'REPLACE', 'APPEND', 'COPY', 'ADDCOHORT', 'SETVARIABLE', 'REMVARIABLE', ...REL_RULES]);
const RULE_FLAGS = new Set([
  'WITHCHILD', 'NOCHILD', 'ITERATE', 'NOITERATE', 'UNSAFE', 'SAFE', 'REVERSE', 'KEEPORDER', 'VARYORDER',
  'ENCL_INNER', 'ENCL_OUTER', 'ENCL_FINAL', 'ENCL_ANY', 'LOOKDELETED', 'LOOKDELAYED', 'LOOKIGNORED',
  'NEAREST', 'ALLOWLOOP', 'DELAYED', 'IMMEDIATE', 'IGNORED', 'RESETX', 'REMEMBERX', 'ALLOWCROSS',
  'ORDERED', 'BEFORE', 'AFTER',
]);
// + and - (and ^) work on readings (a reading in both / in the first and not the second); \ ∆ ∩ work on the tags of the lists
// '^' is the fail-fast difference: in vislcg3 (1.7) it matches exactly what '-' matches, on lists and on sets alike
const SET_OPS = new Map([['+', 'and'], ['-', 'minus'], ['^', 'minus'], ['\\', 'tdiff'], ['∆', 'tsym'], ['∩', 'tand']]);
// digits are optional: (* X) and (-* X) are both 0*, the scan in both directions
const POSITION_RE = /^([@*\-\dA-Za-z<>]*)(?:\/(-?\d+|\*))?$/;       // vislcg3 takes the characters of a position in any order
const SUB_FLAG_RE = /^SUB:(-?\d+)$/i;

export class GrammarError extends Error {}

const isSpace = (c) => /\s/.test(c);

/**
 * Split grammar text into [token, line] pairs. Parentheses and ';' are tokens of their own; a token
 * that starts with " or / runs to its closing mark (plus any flags such as r or i); '#' at the start of
 * a token begins a comment, and /* ... *\/ is a block comment.
 */
export function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  let line = 1;
  const countNewlines = (from, to) => {
    let k = 0;
    for (let p = from; p < to; p++) if (text.charCodeAt(p) === 10) k++;
    return k;
  };
  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (isSpace(c)) {
      i++;
    } else if (c === '#') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text.startsWith('/*', i)) {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      line += countNewlines(i, j);
      i = j;
    } else if (c === '(' || c === ')' || c === ';') {
      tokens.push([c, line]);
      i++;
    } else {
      let j = i;
      if (c === '"') {
        j++;
        while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
        j++;
      } else if (c === '/') {
        let eol = text.indexOf('\n', i);
        if (eol < 0) eol = n;
        const firstSlash = text.indexOf('/', i + 1);
        if (firstSlash >= 0 && firstSlash < eol) {
          j = firstSlash;
          while (j > 0 && text[j - 1] === '\\') j = text.indexOf('/', j + 1);
          j = j < 0 ? i : j + 1;
        }
      }
      while (j < n && !isSpace(text[j]) && text[j] !== '(' && text[j] !== ')' && text[j] !== ';') {
        j += (text[j] === '\\' && j + 1 < n && '();\\'.includes(text[j + 1])) ? 2 : 1;
      }
      tokens.push([text.slice(i, j), line]);
      i = j;
    }
  }
  return tokens;
}

/** A parsed CG-3 grammar. */
export class Grammar {
  constructor() {
    this.delimiters = null;
    this.softDelimiters = null;
    this.mappingPrefix = '@';
    this.options = new Set();
    this.sets = new Map();
    this.beforeSections = [];
    this.sections = [];
    this.afterSections = [];
    this.nullSection = [];
    this.traceMode = false;
    this.hasRelations = false;
    this.hasDep = false;                // dependency rules or tests: the #n->m of the input are read
    this.depBlockCrossing = false;
    this.depBlockLoops = true;
  }

  getSet(name) {
    return this.sets.get(name) || null;
  }
}

/** Parses the text of a .cg3 grammar into a Grammar. */
export class GrammarParser {
  constructor() {
    this.grammar = new Grammar();
    this.currentSection = 'BEFORE';
    this.activeSectionRules = [];
    this._unifySeen = false;
  }

  // -- driver -----------------------------------------------------------------------------
  parse(text) {
    const toks = tokenize(text);
    let stmt = [];
    for (const tok of toks) {
      if (tok[0] === ';') {
        this._statement(stmt);
        stmt = [];
        continue;
      }
      if (!stmt.length && tok[0].toUpperCase() === 'SETS') continue;      // a heading with no ';' of its own
      if (!stmt.length && SECTION_KEYWORDS.has(tok[0].toUpperCase())) {
        this._section(tok[0].toUpperCase());
        continue;
      }
      stmt.push(tok);
    }
    this._statement(stmt);
    return this.grammar;
  }

  _section(kw) {
    this.currentSection = {
      'BEFORE-SECTIONS': 'BEFORE', MAPPINGS: 'BEFORE', CORRECTIONS: 'BEFORE', SECTION: 'SECTION',
      CONSTRAINTS: 'SECTION', 'AFTER-SECTIONS': 'AFTER', 'NULL-SECTION': 'NULL',
    }[kw];
    if (this.currentSection === 'SECTION') {
      this.activeSectionRules = [];
      this.grammar.sections.push(this.activeSectionRules);
    }
  }

  _statement(stmt) {
    if (!stmt.length) return;
    const words = stmt.map((t) => t[0]);
    const kw = words[0].toUpperCase();
    const line = stmt[0][1];
    const g = this.grammar;
    const eq = words.indexOf('=');
    if (kw === 'DELIMITERS' && eq >= 0) {
      g.delimiters = this._tagListSet('_S_DELIMITERS_', stmt.slice(eq + 1), line);
      g.sets.set('_S_DELIMITERS_', g.delimiters);
    } else if (kw === 'SOFT-DELIMITERS' && eq >= 0) {
      g.softDelimiters = this._tagListSet('_S_SOFT_DELIMITERS_', stmt.slice(eq + 1), line);
      g.sets.set('_S_SOFT_DELIMITERS_', g.softDelimiters);
    } else if (kw === 'MAPPING-PREFIX' && eq >= 0) {
      const val = eq + 1 < words.length ? words[eq + 1] : '';
      if (val) g.mappingPrefix = Array.from(val)[0];
    } else if (kw === 'OPTIONS') {
      for (const w of words.slice(1)) {
        if (w !== '+=' && w !== '-=' && w !== '=') g.options.add(w.toLowerCase());
      }
    } else if ((kw === 'LIST' || kw === 'OLIST') && words.length >= 3 && words[2] === '=') {
      g.sets.set(words[1], this._tagListSet(words[1], stmt.slice(3), line, kw === 'OLIST'));
    } else if (kw === 'SET' && words.length >= 3 && words[2] === '=') {
      g.sets.set(words[1], this._setExpression(words[1], stmt.slice(3), line));
    } else if (['SETS', 'STATIC-SETS', 'SUBREADINGS', 'PARENTHESES', 'INCLUDE', 'TEMPLATE', 'ANCHOR',
      'CMDLINE', 'DELIMITERS', 'SOFT-DELIMITERS', 'MAPPING-PREFIX', 'LIST-TAGS', 'CMDARGS'].includes(kw)) {
      // not used by the engine
    } else {
      const rule = this._rule(stmt);
      if (rule === null) return;
      if (this.currentSection === 'BEFORE') g.beforeSections.push(rule);
      else if (this.currentSection === 'SECTION') this.activeSectionRules.push(rule);
      else if (this.currentSection === 'AFTER') g.afterSections.push(rule);
      else g.nullSection.push(rule);
    }
  }

  // -- sets ---------------------------------------------------------------------------------
  _newSet(name, line, ordered = false) {
    return new SetDefinition(name, line, ordered, this.grammar.sets);
  }

  /** LIST / DELIMITERS body: tags and (composite tags), all alternatives of one set. */
  _tagListSet(name, toks, line, ordered = false) {
    const s = this._newSet(name, line, ordered);
    let i = 0;
    while (i < toks.length) {
      const t = toks[i][0];
      if (t === '(') {
        let j = i + 1;
        let depth = 1;
        const inner = [];
        while (j < toks.length && depth) {
          if (toks[j][0] === '(') {
            depth++;
          } else if (toks[j][0] === ')') {
            depth--;
            if (!depth) break;
          }
          inner.push(toks[j][0]);
          j++;
        }
        if (inner.length === 1) s.addItem(new TagPattern(inner[0]));
        else if (inner.length) s.addItem(new CompositeTag(inner.map((x) => new TagPattern(x))));
        i = j + 1;
      } else if (t === ')') {
        i++;
      } else {
        s.addItem(new TagPattern(t));
        i++;
      }
    }
    return s;
  }

  _groupToSet(inner, line) {
    const s = this._newSet('', line);
    if (inner.length === 1) s.addItem(new TagPattern(inner[0]));
    else if (inner.length) s.addItem(new CompositeTag(inner.map((x) => new TagPattern(x))));
    return s;
  }

  /** A set expression: operands joined by OR / + / - / \ / ^ ; '+' and the like bind tighter than OR. */
  _setExpression(name, toks, line) {
    const words = toks.map((t) => t[0]);
    const s = this._newSet(name, line);
    let group = [];
    let op = null;
    let i = 0;
    while (i < words.length) {
      const w = words[i];
      let operand;
      if (w === '(') {
        let depth = 1;
        let j = i + 1;
        const inner = [];
        while (j < words.length && depth) {
          if (words[j] === '(') {
            depth++;
          } else if (words[j] === ')') {
            depth--;
            if (!depth) break;
          }
          inner.push(words[j]);
          j++;
        }
        operand = this._groupToSet(inner, line);
        i = j + 1;
      } else if (w.toUpperCase() === 'OR' || w === '|') {
        if (group.length) s.groups.push(group);
        group = [];
        op = null;
        i++;
        continue;
      } else if (SET_OPS.has(w)) {
        op = SET_OPS.get(w);
        i++;
        continue;
      } else {
        const head = w.slice(0, 2);
        if ((head === '$$' || head === '&&') && this.grammar.sets.has(w.slice(2))) {
          operand = new UnifySet(w.slice(2), head, this.grammar.sets);
          this._unifySeen = true;
        } else {
          // a set name, else a bare tag used as a one-tag set
          operand = this.grammar.sets.has(w) ? w : this._groupToSet([w], line);
        }
        i++;
      }
      group.push([group.length ? op : null, operand]);
      op = null;
    }
    if (group.length) s.groups.push(group);
    s.groups = s.groups.map((g) => this._foldTagOps(g, line));
    if (s.groups.length === 1 && s.groups[0].length === 1 && s.groups[0][0][1] instanceof SetDefinition) {
      const only = s.groups[0][0][1];
      only.name = only.name || name;
      return only;
    }
    return s;
  }

  /** Carry out \ ∆ ^ ∩ on the tags of the lists they join, leaving a chain of + and - for the rest. */
  _foldTagOps(group, line) {
    const listed = (o) => {
      o = typeof o === 'string' ? this.grammar.sets.get(o) : o;
      return o instanceof SetDefinition && !o.groups.length ? o : null;
    };
    const key = (item) => (item instanceof TagPattern ? 'T' + item.raw : 'C' + item.elements.map((e) => e.raw).join('\u0000'));

    const out = [];
    for (const [op, operand] of group) {
      if ((op === 'tdiff' || op === 'tsym' || op === 'tand') && out.length) {
        const a = listed(out[out.length - 1][1]);
        const b = listed(operand);
        if (a === null || b === null) throw new GrammarError(`\\, ∆ and ∩ need plain lists on both sides (line ${line})`);
        const ka = new Set(a.items.map(key));
        const kb = new Set(b.items.map(key));
        let items;
        if (op === 'tdiff') items = a.items.filter((i) => !kb.has(key(i)));
        else if (op === 'tand') items = a.items.filter((i) => kb.has(key(i)));
        else items = [...a.items.filter((i) => !kb.has(key(i))), ...b.items.filter((i) => !ka.has(key(i)))];
        const combined = this._newSet('', line);
        combined.items = items;
        out[out.length - 1] = [out[out.length - 1][0], combined];
      } else {
        out.push([op, operand]);
      }
    }
    return out;
  }

  // -- rules ------------------------------------------------------------------------------------
  _rule(stmt) {
    const words = stmt.map((t) => t[0]);
    const head = words[0];
    this._unifySeen = false;
    let rtype = null;
    let name = '';
    const colon = head.indexOf(':');
    if (colon >= 0 && RULE_KEYWORDS.has(head.slice(0, colon).toUpperCase())) {
      rtype = head.slice(0, colon).toUpperCase();
      name = head.slice(colon + 1);
    } else if (RULE_KEYWORDS.has(head.toUpperCase())) {
      rtype = head.toUpperCase();
    } else {
      return null;
    }
    const line = stmt[0][1];
    let i = 1;
    const flags = new Set();
    let sub = null;
    let childset = null;
    /** The tags of the parenthesised group starting at words[at] and the index after it. */
    const groupAt = (at) => {
      let depth = 1;
      let j = at + 1;
      const inner = [];
      while (j < words.length && depth) {
        if (words[j] === '(') {
          depth++;
        } else if (words[j] === ')') {
          depth--;
          if (!depth) break;
        }
        inner.push(words[j]);
        j++;
      }
      return [inner, j + 1];
    };

    /** The index after the set expression that starts at words[j]: operands joined by OR / + / - ... */
    const scanSet = (start) => {
      let j = start;
      for (;;) {
        if (j < words.length && words[j] === '(') j = groupAt(j)[1];
        else if (j < words.length && !['IF', 'EXCEPT', 'TO', 'FROM', 'TARGET'].includes(words[j].toUpperCase())) j++;
        else break;
        if (j < words.length && (words[j].toUpperCase() === 'OR' || words[j] === '|' || SET_OPS.has(words[j]))) {
          j++;
          continue;
        }
        break;
      }
      return j;
    };

    while (i < words.length && (RULE_FLAGS.has(words[i].toUpperCase()) || SUB_FLAG_RE.test(words[i]))) {
      const sm = SUB_FLAG_RE.exec(words[i]);
      if (sm) {
        sub = parseInt(sm[1], 10);      // SUB:n - the rule looks at the n-th sub-reading of each reading
      } else if (words[i].toUpperCase() === 'WITHCHILD') {       // WITHCHILD set: the cohort and the subtree of it that the set matches
        flags.add('WITHCHILD');
        const end = scanSet(i + 1);
        childset = this._setExpression('', stmt.slice(i + 1, end), line);
        this.grammar.hasDep = true;
        i = end;
        continue;
      } else {
        flags.add(words[i].toUpperCase());
      }
      i++;
    }

    let actionTags = [];
    let relSub = [];
    let substOld = null;
    if (rtype === 'SUBSTITUTE') {
      if (i < words.length && words[i] === '(') {
        let inner;
        [inner, i] = groupAt(i);
        substOld = this._tagListSet('', inner.map((w) => [w, line]), line);
      } else if (i < words.length) {
        substOld = this._setExpression('', [[words[i], line]], line);
        i++;
      }
      if (i < words.length && words[i] === '(') [actionTags, i] = groupAt(i);
    } else if (ONE_ACTION.has(rtype)) {
      if (i < words.length && words[i] === '(') {
        [actionTags, i] = groupAt(i);
      } else if (i < words.length) {
        actionTags = [words[i]];
        i++;
      }
      if (REL_PAIR.has(rtype) && i < words.length && words[i] === '(') [relSub, i] = groupAt(i);
    }
    let direction = 'AFTER';
    if ((rtype === 'ADDCOHORT' || rtype === 'MOVE') && i < words.length && ['BEFORE', 'AFTER'].includes(words[i].toUpperCase())) {
      direction = words[i].toUpperCase();
      i++;
    }

    let copyExcept = null;
    if (rtype === 'COPY' && i < words.length && words[i].toUpperCase() === 'EXCEPT') {
      let j = i + 1;
      while (j < words.length && !['TARGET', 'IF'].includes(words[j].toUpperCase())) {
        j = words[j] === '(' ? groupAt(j)[1] : j + 1;
      }
      copyExcept = this._setExpression('', stmt.slice(i + 1, j), line);
      i = j;
    }
    if (i < words.length && words[i].toUpperCase() === 'TARGET') i++;
    // the target is one set expression: operands joined by OR / + / - ...; what follows is IF and the
    // contexts, or (CG-2 style) the contexts straight away
    let j = i;
    const stops = TO_RULES.has(rtype) ? ['IF', 'EXCEPT', 'TO', 'FROM'] : ['IF', 'EXCEPT'];
    for (;;) {
      if (j < words.length && words[j] === '(') j = groupAt(j)[1];
      else if (j < words.length && !stops.includes(words[j].toUpperCase())) j++;
      else break;
      if (j < words.length && (words[j].toUpperCase() === 'OR' || words[j] === '|' || SET_OPS.has(words[j]))) {
        j++;
        continue;
      }
      break;
    }
    const target = j > i ? this._setExpression('', stmt.slice(i, j), line) : this._groupToSet(['*'], line);
    const tests = [];
    const depTests = [];        // SETPARENT / SETCHILD ... TO (tests): where to attach
    let k = (j < words.length && words[j].toUpperCase() === 'IF') ? j + 1 : j;
    let into = tests;
    while (k < words.length) {
      if (words[k] === '(') {
        let inner;
        [inner, k] = groupAt(k);
        into.push(this._contextTest(inner, line));
      } else {
        if (TO_RULES.has(rtype) && ['TO', 'FROM'].includes(words[k].toUpperCase())) {
          into = depTests;
          if (words[k].toUpperCase() === 'FROM') flags.add('REVERSE');      // FROM: the cohort found is the child (SETPARENT) / the one that is related to
        }
        k++;
      }
    }
    const rule = new Rule(rtype, target, { name, lineNumber: line, contextTests: tests, actionTags, substOld });
    rule.depTests = depTests;
    rule.direction = direction;
    rule.flags = flags;
    rule.sub = sub;
    rule.copyExcept = copyExcept;
    if (DEP_RULES.has(rtype)) this.grammar.hasDep = true;
    rule.childset = childset;
    if (REL_RULES.has(rtype)) {
      rule.relSub = relSub;
      this.grammar.hasRelations = true;
      // vislcg3 -t writes the relation names after the rule type: ADDRELATION(name):line, ADDRELATIONS(a,b):line
      const names = [...actionTags.slice(0, 1), ...(REL_PAIR.has(rtype) ? relSub.slice(0, 1) : [])];
      rule.label = `${rtype}(${names.join(',')}):${line}${name ? ':' + name : ''}`;
    }
    rule.usesUnify = this._unifySeen;
    this._unifySeen = false;
    return rule;
  }

  // -- contextual tests -----------------------------------------------------------------------------
  /** (test) OR (test) ..., or one bare test that takes all the words (with its own LINKs). */
  _contextList(words, line) {
    const alts = [];
    let i = 0;
    for (;;) {
      if (i < words.length && words[i] === '(') {
        let depth = 1;
        let j = i + 1;
        const inner = [];
        while (j < words.length && depth) {
          if (words[j] === '(') {
            depth++;
          } else if (words[j] === ')') {
            depth--;
            if (!depth) break;
          }
          inner.push(words[j]);
          j++;
        }
        alts.push(this._contextTest(inner, line));
        i = j + 1;
        if (i < words.length && words[i].toUpperCase() === 'LINK') {      // (test) LINK test: carry on from where it matched
          let tail = alts[alts.length - 1];
          while (tail.linkedTest !== null && !tail.ors.length) tail = tail.linkedTest;
          const nxt = this._contextList(words.slice(i + 1), line);
          if (tail.ors.length) {
            for (const alt of tail.ors) {
              let end = alt;
              while (end.linkedTest !== null) end = end.linkedTest;
              end.linkedTest = nxt;
            }
          } else {
            tail.linkedTest = nxt;
          }
          i = words.length;
        }
      } else {
        alts.push(this._contextTest(words.slice(i), line));
        i = words.length;
      }
      if (i < words.length && words[i].toUpperCase() === 'OR') {
        i++;
        continue;
      }
      break;
    }
    if (alts.length === 1) return alts[0];
    const test = new ContextualTest({ target: this._groupToSet(['*'], line) });
    test.ors = alts;
    return test;
  }

  /**
   * words are the tokens inside one ( ... ): [NOT|NEGATE] position set [BARRIER set] [CBARRIER set] [LINK test].
   * A group that begins with ( holds alternatives: (test) OR (test).
   */
  _contextTest(words, line) {
    if (words.length && words[0] === '(') return this._contextList(words, line);
    let i = 0;
    let isNot = false;
    let isNegate = false;
    let all = false;
    let none = false;
    while (i < words.length && ['NOT', 'NEGATE', 'ALL', 'NONE'].includes(words[i].toUpperCase())) {
      const kw = words[i].toUpperCase();
      isNot = isNot || kw === 'NOT';
      isNegate = isNegate || kw === 'NEGATE';
      all = all || kw === 'ALL';
      none = none || kw === 'NONE';
      i++;
    }
    const pos = i < words.length ? words[i] : '0';
    i++;
    let offset = 0;
    let scanFirst = false;
    let scanAll = false;
    let careful = false;
    let absolute = false;
    let self = false;
    let noBarrier = false;
    let sub = null;                    // (0/1 ...): look at sub-reading 1 of each reading of the cohort
    let dep = null;
    let attach = false;                // (p ...) (c ...) (s ...): dependency positions; A: attach here
    let relation = null;
    let spanLeft = false;              // < > W: the test may go into the previous / next / both neighbour windows
    let spanRight = false;
    let spanBoth = false;
    if (pos.startsWith('r:') && pos.length > 2) {           // r:name - follow the relation `name`
      dep = 'r';
      relation = pos.slice(2);
    }
    const m = POSITION_RE.exec(pos);
    if (m) {
      const body = m[1];
      absolute = body.includes('@');
      const digits = body.match(/\d+/);
      offset = (body.includes('-') ? -1 : 1) * parseInt(digits ? digits[0] : '0', 10) + 0;
      const stars = (body.match(/\*/g) || []).length;
      scanAll = stars >= 2;
      scanFirst = stars === 1;
      const pflags = body.replace(/[@*\-\d]/g, '');
      spanLeft = pflags.includes('<');
      spanRight = pflags.includes('>');
      spanBoth = pflags.includes('W');
      careful = pflags.includes('C');
      self = pflags.includes('S');
      noBarrier = pflags.includes('N');
      attach = pflags.includes('A');
      for (const letters of ['pp', 'cc', 'p', 'c', 's']) {          // p parent, c child, s sibling, pp ancestors, cc descendants
        if (pflags.includes(letters)) {
          dep = letters;
          this.grammar.hasDep = true;
          break;
        }
      }
      if (m[2] !== undefined) sub = m[2] === '*' ? '*' : parseInt(m[2], 10);     // /* : the reading or any of its sub-readings
      if (this.grammar.options.has('self-no-barrier') && self) noBarrier = !noBarrier;
    }

    /** Tokens (with parentheses kept whole) up to a stop keyword at depth 0. */
    const collect = (at, stop) => {
      let depth = 0;
      const out = [];
      while (at < words.length) {
        const w = words[at];
        if (depth === 0 && stop.has(w.toUpperCase())) break;
        if (w === '(') depth++;
        else if (w === ')') depth--;
        out.push([w, line]);
        at++;
      }
      return [out, at];
    };

    const stop = new Set(['BARRIER', 'CBARRIER', 'LINK']);
    let targetToks;
    [targetToks, i] = collect(i, stop);
    const target = targetToks.length ? this._setExpression('', targetToks, line) : this._groupToSet(['*'], line);
    let barrier = null;
    let cbarrier = null;
    let linked = null;
    while (i < words.length) {
      const kw = words[i].toUpperCase();
      if (kw === 'BARRIER') {
        let toks;
        [toks, i] = collect(i + 1, stop);
        barrier = this._setExpression('', toks, line);
      } else if (kw === 'CBARRIER') {
        let toks;
        [toks, i] = collect(i + 1, stop);
        cbarrier = this._setExpression('', toks, line);
      } else if (kw === 'LINK') {
        linked = this._contextList(words.slice(i + 1), line);
        break;
      } else {
        i++;
      }
    }
    return new ContextualTest({
      target, offset, scanFirst, scanAll, careful, not: isNot, negate: isNegate, absolute, self, noBarrier,
      all, none, barrier, cbarrier, linkedTest: linked, rawPos: pos, sub, dep, attach, relation, spanLeft, spanRight, spanBoth,
    });
  }
}

/** Parse grammar text into a Grammar. */
export function parseGrammar(text) {
  return new GrammarParser().parse(text);
}
