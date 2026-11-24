/**
 * Raw HFST output: every analysis the transducer gave for every token, one token per block, in the
 * hfst-lookup / VISL CG-3 cohort style:
 *
 *   "<gʷədiləxʷ>"
 *   	"gʷədil" V Act ScCon OcSP3 Clt/Now Dial/-NL <W:0.0>
 *   	"gʷədil" V Clt/Now Dial/-NL <W:0.0>
 *
 * Unlike the CoNLL-U and interlinear exports this is not the user's selected reading: it lists all readings
 * (genuine and +Guess ones), in the order the analyzer ranked them, with the transducer weights, and ignores
 * edits made in the token cards.
 */

/** @param {number|undefined} w  transducer weight */
export function formatWeight(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return '0.0';
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/**
 * One reading line, without the leading tab: `"lemma" Tag1 Tag2 <W:0.0>`.
 * The analysis string is split at its first "+" into lemma and tags; later "+" become spaces,
 * "#" compound boundaries stay as they are.
 * @param {{raw?: string, weight?: number}} reading
 */
export function readingLine(reading) {
  const raw = String(reading?.raw ?? '');
  const i = raw.indexOf('+');
  const lemma = i < 0 ? raw : raw.slice(0, i);
  const tags = i < 0 ? '' : raw.slice(i + 1).split('+').filter(Boolean).join(' ');
  return `"${lemma}"${tags ? ' ' + tags : ''} <W:${formatWeight(reading?.weight)}>`;
}

/** All distinct readings of a token: its readings, then the +Guess ones that were filtered out of them. */
export function allReadings(tok) {
  const out = [];
  const seen = new Set();
  for (const r of [...(tok.readings || []), ...(tok.guessedReadings || [])]) {
    if (!r || !r.raw || seen.has(r.raw)) continue;
    seen.add(r.raw);
    out.push(r);
  }
  return out;
}

export class HfstRawExporter {
  /**
   * @param {Array<{tokens: Array<Object>}>} sentences  analyzed sentences (analyzerService.analyzeText output)
   * @param {{forCg?: boolean, readingsFor?: function(Object): (Array<{raw: string, weight?: number}>|null)}} [options]
   *   forCg: the stream is the input of a CG-3 grammar, so punctuation keeps the reading the analyzer gives it
   *   (`"." CLB`), which the grammars' delimiters and rules expect.
   *   readingsFor: gives the readings to list for a token instead of its own (the CG-3 stage reads the
   *   disambiguation analyser's analyses); null or no answer keeps the token's own readings
   * @returns {string} the cohorts, a blank line between sentences; '' when there are no tokens
   */
  static export(sentences, { forCg = false, readingsFor = null } = {}) {
    const blocks = [];
    for (const sent of sentences || []) {
      const lines = [];
      for (const tok of sent.tokens || []) {
        lines.push(`"<${tok.form}>"`);
        const own = allReadings(tok).filter(r => !r.isInferred && (forCg || !r.isPunct));
        const other = readingsFor && !tok.isPunct ? readingsFor(tok) : null;
        const readings = other && other.length ? other : own;
        if (readings.length === 0) {
          lines.push(`\t"${tok.form}" ?`); // the transducer gave no analysis
        } else {
          for (const r of readings) lines.push('\t' + readingLine(r));
        }
      }
      if (lines.length) blocks.push(lines.join('\n'));
    }
    return blocks.join('\n\n');
  }
}
