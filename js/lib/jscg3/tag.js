// Tag representation and matching for VISL CG-3.

const WEIGHT_RE = /^<W:(-?[0-9]+(?:\.[0-9]+)?)>$/;
const ESCAPED_RE = /\\([\s\S])/g;
const ESCAPED_NOT_QUOTE_RE = /\\([^"\\])/g;
const PROP_RE = /\\{1,2}([pP])\{(\^?)([A-Za-z_]+)\}/g;
const SYNTAX_CHARS = '^$\\.*+?()[]{}|/';

/**
 * vislcg3 reads a backslash in a plain tag as 'the next character, as it is': \? is the tag ?, \# is #, \; is ;.
 * Regexes (/../, r"..", "..."r) keep their backslashes for the regex engine; in a quoted tag \" and \\ stay.
 */
export function unescapeTag(raw) {
  if (!raw.includes('\\')) return raw;
  if (raw.startsWith('/') || raw.startsWith('~/') || raw.startsWith('r"') || raw.startsWith("r'")) return raw;
  const bare = raw.startsWith('!') ? raw.slice(1) : raw;
  if (bare.startsWith('"')) {
    const last = bare.lastIndexOf('"');
    if (last > 0 && bare.slice(last + 1).toLowerCase().includes('r')) return raw;
    return raw.replace(ESCAPED_NOT_QUOTE_RE, '$1');
  }
  return raw.replace(ESCAPED_RE, '$1');
}

/** Python-style regex source to something JavaScript's RegExp (u flag) takes. */
function translatePattern(pattern) {
  // ICU regexes (what vislcg3 uses) have \p{Lu}; a grammar file writes them with a doubled backslash, which vislcg3 reads as one.
  let p = pattern.replace(PROP_RE, (_m, kind, neg, name) => '\\' + (((kind === 'P') !== (neg === '^')) ? 'P' : 'p') + '{' + name + '}');
  p = p.replace(/\(\?P</g, '(?<').replace(/\(\?P=(\w+)\)/g, '\\k<$1>').replace(/\\Z/g, '$').replace(/\\A/g, '^');
  return p;
}

/** In unicode mode JavaScript rejects escapes such as \- (outside a class), \_ , \# , \  that other engines take as the character. */
function sanitizeEscapes(p) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) {
      const d = p[i + 1];
      i++;
      if (/[A-Za-z0-9]/.test(d) || SYNTAX_CHARS.includes(d) || (d === '-' && inClass)) out += '\\' + d;
      else out += d;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    out += c;
  }
  return out;
}

const regexCache = new Map();

/** Returns {search, full} (full is anchored at both ends) or null if the pattern is not a valid regex. */
export function getCompiledRegex(pattern, ignoreCase = false) {
  const key = (ignoreCase ? 'i' : '-') + pattern;
  if (regexCache.has(key)) return regexCache.get(key);
  let src = translatePattern(pattern);
  let ic = ignoreCase;
  if (src.startsWith('(?i)')) {
    src = src.slice(4);
    ic = true;
  }
  const attempts = [[src, 'u'], [sanitizeEscapes(src), 'u'], [src, '']];
  let result = null;
  for (const [source, flags] of attempts) {
    try {
      const f = flags + (ic ? 'i' : '');
      const search = new RegExp(source, f);
      const full = new RegExp('^(?:' + source + ')$', f);
      result = { search, full };
      break;
    } catch (e) {
      // try the next form
    }
  }
  if (regexCache.size > 4096) regexCache.clear();
  regexCache.set(key, result);
  return result;
}

const CG3_HASH_SEED = 705577479;

/**
 * vislcg3's hash of a tag (Paul Hsieh's SuperFastHash over the UTF-16 units, seeded). It decides the order in which
 * vislcg3 prints the relations of a cohort, which are kept sorted by the hash of their name.
 */
export function cg3Hash(text) {
  const n = text.length;
  if (n === 0) return 0;
  let h = CG3_HASH_SEED;
  let i = 0;
  for (let k = n >> 1; k > 0; k--) {
    h = (h + text.charCodeAt(i)) >>> 0;
    const tmp = ((text.charCodeAt(i + 1) << 11) ^ h) >>> 0;
    h = ((h << 16) ^ tmp) >>> 0;
    i += 2;
    h = (h + (h >>> 11)) >>> 0;
  }
  if (n & 1) {
    h = (h + text.charCodeAt(i)) >>> 0;
    h = (h ^ (h << 11)) >>> 0;
    h = (h + (h >>> 17)) >>> 0;
  }
  h = (h ^ (h << 3)) >>> 0;
  h = (h + (h >>> 5)) >>> 0;
  h = (h ^ (h << 4)) >>> 0;
  h = (h + (h >>> 17)) >>> 0;
  h = (h ^ (h << 25)) >>> 0;
  h = (h + (h >>> 6)) >>> 0;
  if (h === 0 || h === 0xFFFFFFFF || h === 0xFFFFFFFE) h = CG3_HASH_SEED;
  return h;
}

/** Returns true if the tag is a wordform like "<word>". */
export function isWordform(tag) {
  return tag.startsWith('"<') && tag.endsWith('>"');
}

/** Returns true if the tag is a baseform like "word" (quoted, not bracketed). */
export function isBaseform(tag) {
  return tag.startsWith('"') && tag.endsWith('"') && !(tag.startsWith('"<') && tag.endsWith('>"'));
}

/** Extract inner content from quoted wordform "<word>" -> word, or baseform "word" -> word. */
export function extractForm(tag) {
  if (isWordform(tag)) return tag.slice(2, -2);
  if (tag.startsWith('"') && tag.endsWith('"') && tag.length >= 2) return tag.slice(1, -1);
  return tag;
}

function toNumber(text) {
  if (text.trim() === '') return NaN;
  return Number(text);
}

/** A tag pattern (literal, regex, wildcard, or special tag) used in sets and rules. */
export class TagPattern {
  constructor(raw) {
    raw = unescapeTag(raw);
    this.raw = raw;
    this.isAny = raw === '*' || raw === '(*)';
    this.isFailfast = raw.startsWith('!') && raw.length > 1;

    const patternStr = this.isFailfast ? raw.slice(1) : raw;
    this.isWordform = isWordform(patternStr);
    this.isBaseform = isBaseform(patternStr);
    this.isRegex = false;
    this.isCaseInsensitive = false;
    this.literal = patternStr;
    this._regex = null;
    this._full = null;
    this.lastMatch = null;
    // <W:0> and <W:0.0> are the same tag to vislcg3: a weight tag in a set is compared by its number
    this.numValue = null;
    const wm = WEIGHT_RE.exec(patternStr);
    if (wm) this.numValue = Number(wm[1]);
    // "<...>"r is a word form regex, "..."r a base form regex: each is only tried on its own kind of tag
    this.regexKind = null;

    if (patternStr.startsWith('"') && patternStr.indexOf('"', 1) >= 0) {
      const lastQuote = patternStr.lastIndexOf('"');
      const flags = patternStr.slice(lastQuote + 1).toLowerCase();
      const inner = patternStr.slice(1, lastQuote);
      if (flags.includes('r')) {
        this.isRegex = true;
        if (flags.includes('i')) this.isCaseInsensitive = true;
        this.regexKind = (inner.startsWith('<') && inner.endsWith('>') && inner.length > 1) ? 'wordform' : 'baseform';
        this._initRegex(inner, flags);
      } else if (flags.includes('i')) {
        this.isCaseInsensitive = true;
        this.literal = inner;
      } else {
        this.literal = patternStr;
      }
    } else if ((patternStr.startsWith('/') || patternStr.startsWith('~/')) && patternStr.indexOf('/', 2) >= 0) {
      const start = patternStr.startsWith('~/') ? 2 : 1;
      const lastSlash = patternStr.lastIndexOf('/');
      const flags = patternStr.slice(lastSlash + 1).toLowerCase();
      const inner = patternStr.slice(start, lastSlash);
      this.isRegex = true;
      if (flags.includes('i')) this.isCaseInsensitive = true;
      this._initRegex(inner, flags);
    } else if ((patternStr.startsWith('r"') || patternStr.startsWith("r'")) && (patternStr.endsWith('"') || patternStr.endsWith("'"))) {
      this.isRegex = true;
      this._initRegex(patternStr.slice(2, -1), '');
    }
  }

  _initRegex(inner, flagsStr) {
    const compiled = getCompiledRegex(inner, this.isCaseInsensitive || flagsStr.includes('i'));
    if (compiled === null) {
      this.isRegex = false;
      this._regex = null;
      this._full = null;
    } else {
      this._regex = compiled.search;
      this._full = compiled.full;
    }
  }

  /** Check if this pattern matches an individual tag string. */
  matchesTag(tag) {
    if (this.isAny) return true;

    if (this.numValue !== null && tag.startsWith('<W:') && tag.endsWith('>')) {
      if (toNumber(tag.slice(3, -1)) === this.numValue) return true;
    }

    if (this.isRegex && this._regex !== null) {
      if (this.regexKind === 'wordform' && !isWordform(tag)) return false;
      if (this.regexKind === 'baseform' && !isBaseform(tag)) return false;
      if (this.regexKind !== null) {
        // vislcg3 matches "..."r / "<...>"r against the whole of the base form / word form (quotes left off):
        // "a"r does not match "banana", "b.*"r does. /.../r matches anywhere in the tag.
        const m = this._full.exec(tag.slice(1, -1));
        if (m) {
          this.lastMatch = m;
          return true;
        }
        return false;
      }
      let m = this._regex.exec(tag);
      if (!m && tag.startsWith('"') && tag.endsWith('"')) m = this._regex.exec(tag.slice(1, -1));
      if (m) {
        this.lastMatch = m;
        return true;
      }
      return false;
    }

    if (this.isCaseInsensitive) {
      const target = (tag.startsWith('"') && tag.endsWith('"')) ? tag.slice(1, -1) : tag;
      return target.toLowerCase() === this.literal.toLowerCase() || tag.toLowerCase() === this.raw.toLowerCase();
    }

    return this.raw === tag;
  }

  equals(other) {
    if (other instanceof TagPattern) return this.raw === other.raw;
    if (typeof other === 'string') return this.raw === other;
    return false;
  }

  toString() {
    return `TagPattern(${this.raw})`;
  }
}
