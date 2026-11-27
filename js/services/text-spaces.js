/**
 * Spacing of the text LangJack works on. A tab (U+0009) is never kept: it becomes a single space, and two or more
 * spaces in a row become one. Line breaks are left alone by tabsAndRuns (the text is split into sentences at them);
 * oneLine also turns them into spaces, for the single `# text = ...` line of a CoNLL-U sentence.
 */

// whitespace other than line breaks
const H = '[^\\S\\r\\n]';
const TABS_AND_RUNS = new RegExp(`${H}*\\t${H}*|${H}{2,}`, 'g');

/** Every tab (with the blanks around it) becomes one space, and so does any other run of two or more blanks. */
export function tabsAndRuns(text) {
  return String(text == null ? '' : text).replace(TABS_AND_RUNS, ' ');
}

/** Only the tabs: for text being typed or pasted, where a double space is the user's own business. */
export function tabsToSpaces(text) {
  return String(text == null ? '' : text).replace(/\t/g, ' ');
}

/** One line with single spaces between the words, trimmed. */
export function oneLine(text) {
  return tabsAndRuns(String(text == null ? '' : text).replace(/[\r\n]+/g, ' ')).trim();
}
