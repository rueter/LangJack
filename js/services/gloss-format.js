/**
 * One gloss, three spellings of the blank between its words.
 * A gloss is kept with plain spaces ("old woman") and only written out per target:
 *   verdd     old woman      (Ve'rdd wants ordinary blanks)
 *   ud        old-woman      (CoNLL-U MISC: Gloss[ISO]=old-woman)
 *   apertium  old<b/>woman   (blank element of Apertium dictionaries)
 */
export const GLOSS_TARGETS = ['verdd', 'ud', 'apertium'];

export const GLOSS_BLANK = {
  verdd: ' ',
  ud: '-',
  apertium: '<b/>'
};

/** Back to plain spaces: underscores and Apertium blanks (<b/>, <b>) are blanks; hyphens stay (they may be real). */
export function normalizeGloss(gloss) {
  return String(gloss ?? '')
    .replace(/<b\s*\/?>/gi, ' ')
    .replace(/[|\t\r\n_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The gloss as written for `target`; `blank` overrides the separator (a CoNLL-U file that uses dots, say). */
export function formatGloss(gloss, target = 'verdd', blank) {
  const sep = blank !== undefined ? blank : GLOSS_BLANK[target];
  if (sep === undefined) throw new Error(`Unknown gloss target: ${target}`);
  return normalizeGloss(gloss).replace(/ /g, sep);
}
