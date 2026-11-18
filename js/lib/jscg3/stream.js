// Stream parsing and serialization for VISL CG-3 format.

import { Cohort, Reading, SingleWindow } from './cohort.js';

// A word form may itself contain '>' or '"' ("<>>", "<">"), and so may a base form (""" for the quote mark):
// the form ends at the first '>"' (resp. the base form at the first '"') that is followed by white space or the end of the line.
const COHORT_RE = /^\s*"<(.+?)>"(?=\s|$)(.*)$/;
const READING_RE = /^(\s+)(;?\s*)"(.*?)"(?=\s|$)(.*)$/;
const DEP_TAG_RE = /^#(\d+)(?:->|\u2192)(\d+)$/;
const REL_TAG_RE = /^(?:ID:(\d+)|R:([^:]+):(\d+))$/;
const STREAM_CMD_RE = /^<STREAMCMD:([A-Z]+)(?::([^>]*))?>$/;

/** Split a string of tags handling quoted tokens and nested composite tags. */
export function splitTags(tagStr) {
  const tags = [];
  let current = [];
  let inQuote = false;
  let quoteChar = '';
  let parenDepth = 0;
  const n = tagStr.length;

  for (let i = 0; i < n; i++) {
    const c = tagStr[i];
    if (inQuote) {
      current.push(c);
      if (c === quoteChar && (i === 0 || tagStr[i - 1] !== '\\')) inQuote = false;
    } else if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
      current.push(c);
    } else if (c === '(') {
      parenDepth++;
      current.push(c);
    } else if (c === ')') {
      if (parenDepth > 0) parenDepth--;
      current.push(c);
    } else if (/\s/.test(c) && parenDepth === 0) {
      if (current.length) {
        tags.push(current.join(''));
        current = [];
      }
    } else {
      current.push(c);
    }
  }
  if (current.length) tags.push(current.join(''));
  return tags;
}

/** Takes the tags that match `pick` off a reading and its sub-readings; pick(tag) returns true to take it. */
function stripTags(reading, pick) {
  const keep = reading.tags.filter((t) => !pick(t));
  if (keep.length !== reading.tags.length) {
    reading.tags = keep;
    reading.tagSet = new Set(keep);
    reading.matchCache = null;
  }
  for (const sub of reading.subReadings) stripTags(sub, pick);
}

/** With relation rules in the grammar, ID:n and R:name:m on a reading are the relations of the cohort, not tags. */
export function extractRelations(cohort) {
  let ident = 0;
  const rels = new Map();
  let found = false;
  const pick = (t) => {
    const m = (t.startsWith('ID:') || t.startsWith('R:')) ? REL_TAG_RE.exec(t) : null;
    if (m && (m[1] === undefined || parseInt(m[1], 10) !== 0)) {
      found = true;
      if (m[1] !== undefined) {
        ident = parseInt(m[1], 10);
      } else {
        if (!rels.has(m[2])) rels.set(m[2], new Set());
        rels.get(m[2]).add(parseInt(m[3], 10));
      }
      return true;
    }
    return false;
  };
  for (const r of [...cohort.readings, ...cohort.deletedReadings]) stripTags(r, pick);
  if (found) cohort.relIn = [ident, rels];
}

/**
 * #n->m on a reading is the dependency of the cohort, not a tag of the reading: vislcg3 keeps it out of the tags
 * and prints it again, in its own numbering, when it writes the cohort.
 */
export function extractDependency(cohort) {
  const pick = (t) => {
    const m = t.startsWith('#') ? DEP_TAG_RE.exec(t) : null;
    if (m && parseInt(m[1], 10) !== 0) {
      cohort.depIn = [parseInt(m[1], 10), parseInt(m[2], 10)];
      return true;
    }
    return false;
  };
  for (const r of [...cohort.readings, ...cohort.deletedReadings]) stripTags(r, pick);
}

/** If a reading has multiple mapping tags (e.g. starting with @), it is split into separate readings, one per mapping tag. */
export function splitAllMappings(cohort, mappingPrefix = '@') {
  const out = [];
  for (const r of cohort.readings) {
    const mappingTags = r.tags.filter((t) => t.startsWith(mappingPrefix));
    if (mappingTags.length > 1) {
      const baseTags = r.tags.filter((t) => !t.startsWith(mappingPrefix));
      for (const mt of mappingTags) {
        const nr = new Reading(r.baseform, [...baseTags, mt], cohort);
        nr.number = r.number;
        nr.deleted = r.deleted;
        nr.changed = r.changed;
        nr.trace = [...r.trace];
        nr.subReadings = r.subReadings.map((s) => s.clone(cohort));
        out.push(nr);
      }
    } else {
      out.push(r);
    }
  }
  for (const r of out) {
    const marks = r.tags.filter((t) => t.startsWith(mappingPrefix));
    if (marks.length) {          // as in vislcg3 a reading that arrives with a mapping tag counts as mapped
      r.mappingTags = new Set(marks);
      r.mapped = true;
    }
  }
  cohort.readings = out;
}

/** The lines of a text, the way a Python file iterates them (split at \n; a last line without \n counts). */
export function* linesOf(text) {
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) {
      if (start < text.length) yield text.slice(start);
      return;
    }
    yield text.slice(start, nl);
    start = nl + 1;
  }
}

/**
 * Parse a CG-3 plaintext input stream lazily into SingleWindow objects.
 * `lines` is any iterable of lines (with or without line ends), e.g. linesOf(text).
 * Yields one SingleWindow at a time, keeping memory minimal.
 */
export function* parseStream(lines, delimitersSet = null, mappingPrefix = '@', hardLimit = 500, hasRelations = false, hasDep = true) {
  if (typeof lines === 'string') lines = linesOf(lines);
  let currentWindow = new SingleWindow();
  let currentCohort = null;
  let readingStack = [];
  let pendingText = [];
  let lineNumber = 0;
  let cohortCounter = 1;               // vislcg3 numbers the begin cohort of every window too: 0, then 1.. for the first window
  currentWindow.begin.globalNumber = 0;

  const finishCohort = (c) => {
    if (!c.readings.length && !c.deletedReadings.length) {      // a cohort without readings gets one: the word form as base form
      c.appendReading(new Reading(`"${c.wordform.slice(2, -2)}"`, [], c));
    }
    if (hasRelations) extractRelations(c);
    if (hasDep) extractDependency(c);
    splitAllMappings(c, mappingPrefix);
  };

  const finishWindow = () => {
    if (currentCohort !== null) {
      finishCohort(currentCohort);
      currentWindow.appendCohort(currentCohort);
      currentCohort = null;
      readingStack = [];
    }
    if (pendingText.length) {
      currentWindow.textAfter.push(...pendingText);
      pendingText = [];
    }
    const win = currentWindow;
    currentWindow = new SingleWindow();
    currentWindow.begin.globalNumber = cohortCounter;
    cohortCounter++;
    return win;
  };

  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.replace(/[\r\n]+$/, '');
    const stripped = line.trim();

    // stream commands
    const cmdMatch = STREAM_CMD_RE.exec(stripped);
    if (cmdMatch) {
      const cmd = cmdMatch[1];
      const arg = cmdMatch[2];
      if (cmd === 'FLUSH') {
        if (currentWindow.cohorts.length || currentCohort) {
          const win = finishWindow();
          win.flushAfter = true;
          yield win;
        } else {
          const win = new SingleWindow();
          win.textAfter.push(line);
          win.flushAfter = true;
          yield win;
        }
        continue;
      } else if (cmd === 'EXIT') {
        if (currentWindow.cohorts.length || currentCohort) yield finishWindow();
        return;
      } else if (cmd === 'SETVAR') {
        if (arg) {
          for (const vpart of arg.split(',')) {
            const eq = vpart.indexOf('=');
            if (eq >= 0) currentWindow.variables.set(vpart.slice(0, eq), vpart.slice(eq + 1));
            else currentWindow.variables.set(vpart, '1');
          }
        }
        pendingText.push(line);
        continue;
      } else if (cmd === 'REMVAR') {
        if (arg) for (const vpart of arg.split(',')) currentWindow.variables.delete(vpart);
        pendingText.push(line);
        continue;
      } else {
        pendingText.push(line);
        continue;
      }
    }

    // cohort line
    const cohortMatch = COHORT_RE.exec(line);
    if (cohortMatch) {
      if (currentCohort !== null) {
        finishCohort(currentCohort);
        currentWindow.appendCohort(currentCohort);
        let isDelim = false;
        if (delimitersSet && delimitersSet.matchesCohortNormal(currentCohort)) isDelim = true;
        currentCohort = null;
        readingStack = [];
        if (isDelim || currentWindow.cohorts.length >= hardLimit) yield finishWindow();
      }

      const word = cohortMatch[1];
      const rest = cohortMatch[2].trim();
      currentCohort = new Cohort({
        wordform: `"<${word}>"`,
        untouchableTags: rest ? splitTags(rest) : [],
        textBefore: pendingText,
        lineNumber,
        globalNumber: cohortCounter,
      });
      cohortCounter++;
      pendingText = [];
      continue;
    }

    // reading line
    if ((line.startsWith(' ') || line.startsWith('\t')) && currentCohort !== null) {
      const rMatch = READING_RE.exec(line);
      if (rMatch) {
        const indentLevel = rMatch[1].replace(/\t/g, '    ').length;
        const delStr = rMatch[2].trim();
        const restTags = rMatch[4].trim();
        const reading = new Reading(`"${rMatch[3]}"`, restTags ? splitTags(restTags) : [], currentCohort);
        if (delStr.startsWith(';')) reading.deleted = true;

        while (readingStack.length && indentLevel <= readingStack[readingStack.length - 1][0]) readingStack.pop();

        if (readingStack.length) {
          readingStack[readingStack.length - 1][1].subReadings.push(reading);
        } else if (reading.deleted) {
          currentCohort.deletedReadings.push(reading);
        } else {
          currentCohort.appendReading(reading);
        }
        readingStack.push([indentLevel, reading]);
        continue;
      }
    }

    pendingText.push(line);
  }

  if (currentCohort !== null) {
    finishCohort(currentCohort);
    currentWindow.appendCohort(currentCohort);
  }
  if (pendingText.length) currentWindow.textAfter.push(...pendingText);
  if (currentWindow.cohorts.length || currentWindow.textAfter.length) yield currentWindow;
}
