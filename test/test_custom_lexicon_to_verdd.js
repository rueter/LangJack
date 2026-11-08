/**
 * Test Suite: moving entries of the custom lexicon to Ve'rdd
 * Verifies:
 * 1. An entry becomes a draft row with both parts of speech, the homonym numerals and the example sentence pair,
 *    and the row makes a /pairs payload that carries all of it.
 * 2. The example check: the sentence has to show the headword (or its form in the sentence), the translation the gloss.
 * 3. Homonym numerals and examples can be set on, and cleared from, a stored entry; bad numerals are refused.
 * 4. Recording that an entry reached Ve'rdd keeps the lexeme ids and the homonym numerals used.
 * 5. An entry moved on its own (the 🗂️ next to the trashcan) takes a missing example from the sentence it was glossed in,
 *    in the workspace or the treebank, with that sentence's translation in the gloss language.
 */

import assert from 'node:assert';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { rowFromCustomEntry, withSentenceExample, rowToPairPayload, exampleWarnings, validateRow, blockingReasons } from '../js/services/verdd-api-service.js';

console.log("=== Running Tests for Custom Lexicon -> Ve'rdd ===\n");

// --- 1. Entry -> row -> payload ---
const entry = {
  id: 'e1', src_lang: 'APU', lemma: 'aiku', pos: 'N', tgt_lang: 'POR', gloss: 'casa', tgt_pos: 'N',
  src_homo: 1, tgt_homo: '', ex_src: 'Aiku wa', ex_tgt: 'A casa é minha', ex_form: 'aiku'
};
const row = rowFromCustomEntry(entry);
assert.strictEqual(row.entryId, 'e1');
assert.strictEqual(row.origin, 'custom-lexicon');
assert.deepStrictEqual([row.srcLang, row.lemma, row.pos, row.srcHomoId], ['apu', 'aiku', 'N', 1], 'headword side, language lower-cased');
assert.deepStrictEqual([row.tgtLang, row.translation, row.tgtPos, row.tgtHomoId], ['por', 'casa', 'N', null], 'a blank numeral is "automatic"');
assert.deepStrictEqual([row.exSrc, row.exTgt, row.exForm], ['Aiku wa', 'A casa é minha', 'aiku']);
assert.deepStrictEqual(validateRow(row), [], 'a complete entry is a valid row');
assert.deepStrictEqual(blockingReasons(row), []);
assert.deepStrictEqual(rowToPairPayload(row), {
  source: { lexeme: 'aiku', language: 'apu', pos: 'N', homoId: 1 },
  target: { lexeme: 'casa', language: 'por', pos: 'N' },
  examples: [{ source_text: 'Aiku wa', target_text: 'A casa é minha' }]
});
// no example, no numerals: a plain pair
const plain = rowToPairPayload(rowFromCustomEntry({ id: 'e2', src_lang: 'koi', lemma: 'ме', pos: 'Pron', tgt_lang: 'eng', gloss: 'I', tgt_pos: 'Pron' }));
assert.deepStrictEqual(plain, { source: { lexeme: 'ме', language: 'koi', pos: 'Pron' }, target: { lexeme: 'I', language: 'eng', pos: 'Pron' } });
// an entry without a part of speech cannot be sent
assert(validateRow(rowFromCustomEntry({ id: 'e3', src_lang: 'koi', lemma: 'x', tgt_lang: 'eng', gloss: 'y' })).some((p) => p.field === 'pos'));
console.log('✓ An entry becomes a complete row and pair payload (parts of speech, homonyms, example)');

// --- 2. Example check ---
assert.deepStrictEqual(exampleWarnings(row), [], 'the sentence shows the word, the translation shows the gloss');
assert.deepStrictEqual(exampleWarnings(rowFromCustomEntry({ ...entry, ex_form: '', ex_src: 'Wa nuku', ex_tgt: 'A casa' })).length, 1, 'sentence without the headword');
assert.deepStrictEqual(exampleWarnings(rowFromCustomEntry({ ...entry, ex_form: 'aikuru', ex_src: 'Aikuru wa' })), [], 'the inflected form in the sentence counts');
assert.strictEqual(exampleWarnings(rowFromCustomEntry({ ...entry, ex_tgt: 'Minha moradia' })).length, 1, 'translation without the gloss');
assert.strictEqual(exampleWarnings(rowFromCustomEntry({ ...entry, ex_src: 'AIKU wa', ex_tgt: 'A CASA' })).length, 0, 'case does not matter');
assert.strictEqual(exampleWarnings(rowFromCustomEntry({ ...entry, ex_src: '', ex_tgt: '' })).length, 0, 'no example, nothing to check');
console.log('✓ The example has to show the word and its gloss');

// --- 3. Details on a stored entry ---
await dictionaryService.init();
const saved = await dictionaryService.addCustomEntry({ src_lang: 'apu', lemma: 'testword', pos: 'N', tgt_lang: 'por', gloss: 'palavra', tgt_pos: 'N' }, { requirePos: true });
const id = saved.id;
await dictionaryService.updateCustomEntryDetails(id, { src_homo: '2', tgt_homo: 0, ex_src: ' Testword here ', ex_tgt: 'Uma palavra', ex_form: 'testword' });
let stored = dictionaryService.customEntriesCache.find((e) => e.id === id);
assert.deepStrictEqual([stored.src_homo, stored.tgt_homo, stored.ex_src, stored.ex_tgt, stored.ex_form], [2, 0, 'Testword here', 'Uma palavra', 'testword'], 'numerals are numbers, 0 is allowed, text is trimmed');
await assert.rejects(() => dictionaryService.updateCustomEntryDetails(id, { src_homo: '-1' }), /homonym number/);
await assert.rejects(() => dictionaryService.updateCustomEntryDetails(id, { tgt_homo: '1.5' }), /homonym number/);
await assert.rejects(() => dictionaryService.updateCustomEntryDetails(id, { gloss: 'nope' }), /Not a detail/);
await assert.rejects(() => dictionaryService.updateCustomEntryDetails('missing', { src_homo: 1 }), /Unknown entry/);
await dictionaryService.updateCustomEntryDetails(id, { src_homo: '', ex_src: '' });
stored = dictionaryService.customEntriesCache.find((e) => e.id === id);
assert(!('src_homo' in stored) && !('ex_src' in stored), 'a blank value clears the field');
assert.strictEqual(stored.tgt_homo, 0, 'the others stay');
assert.strictEqual(stored.gloss, 'palavra');
console.log('✓ Homonym numerals and examples are set, validated and cleared');

// --- 3b. Relation type: translation or description ---
assert.strictEqual(rowFromCustomEntry(entry).relType, 0, 'an entry is a plain translation by default');
assert.strictEqual(rowToPairPayload(rowFromCustomEntry(entry)).type, undefined);
const described = rowFromCustomEntry({ ...entry, rel_type: 13 });
assert.strictEqual(described.relType, 13);
assert.strictEqual(rowToPairPayload(described).type, 13, 'a description reaches the pair payload as type 13');
assert.strictEqual(rowFromCustomEntry({ ...entry, rel_type: '13' }).relType, 13, 'the select hands over a string');
assert.strictEqual(rowFromCustomEntry({ ...entry, rel_type: 6 }).relType, 0, 'only the two translation types exist here');
await dictionaryService.updateCustomEntryDetails(id, { rel_type: '13' });
stored = dictionaryService.customEntriesCache.find((e) => e.id === id);
assert.strictEqual(stored.rel_type, 13);
assert.strictEqual(rowFromCustomEntry(stored).relType, 13, 'the stored type travels to the Ve\'rdd row');
assert.strictEqual(stored.tgt_homo, 0, 'the other details stay');
await assert.rejects(() => dictionaryService.updateCustomEntryDetails(id, { rel_type: '6' }), /Translation or Description translation/);
await assert.rejects(() => dictionaryService.updateCustomEntryDetails(id, { rel_type: 'x' }), /Translation or Description translation/);
await dictionaryService.updateCustomEntryDetails(id, { rel_type: '0' });
stored = dictionaryService.customEntriesCache.find((e) => e.id === id);
assert(!('rel_type' in stored), 'a plain translation is the default and is not stored');
console.log('✓ The relation type is stored, validated, and reaches the Ve\'rdd row');

// --- 4. Recording the result ---
await dictionaryService.markEntrySent(id, { sourceId: 41, targetId: 42, srcHomo: 3, tgtHomo: null });
stored = dictionaryService.customEntriesCache.find((e) => e.id === id);
assert(stored.verdd_sent_at > 0);
assert.deepStrictEqual([stored.verdd_source_id, stored.verdd_target_id, stored.src_homo, stored.tgt_homo], [41, 42, 3, 0], 'ids kept, the numeral used is recorded, an unused one is left alone');
assert.strictEqual(await dictionaryService.markEntrySent('missing', {}), null);
await dictionaryService.deleteCustomEntry(id);
console.log("✓ An entry that reached Ve'rdd remembers when, which lexemes, and the homonyms used");

// --- 5. The example from the sentence the entry was glossed in ---
const glossedToken = { form: 'Aikuru', lemma: 'aiku', customGloss: 'casa', customGlossLang: 'por', selectedGloss: { gloss: 'casa', lang: 'por', source: 'custom_user' } };
const workspace = [
  { text: 'Nuku wa', tokens: [{ form: 'Nuku', lemma: 'nuku', selectedGloss: { gloss: 'casa', lang: 'por' } }], translations: [{ lang: 'por', text: 'Nada' }], srcLang: 'apu' },
  { text: 'Aikuru wa.', tokens: [glossedToken, { form: '.', isPunct: true }], translations: [{ lang: 'eng', text: 'My house.' }, { lang: 'por', text: 'A minha casa.' }], srcLang: 'apu' }
];
const bare = { id: 'e5', src_lang: 'apu', lemma: 'aiku', pos: 'N', tgt_lang: 'por', gloss: 'casa', tgt_pos: 'N' };
const completed = withSentenceExample(bare, workspace);
assert.deepStrictEqual([completed.ex_src, completed.ex_form, completed.ex_tgt], ['Aikuru wa.', 'Aikuru', 'A minha casa.'], 'the sentence, the word as it stands there, the translation in the gloss language');
assert(!('ex_src' in bare), 'the stored entry is not changed');
const moved = rowFromCustomEntry(completed);
assert.deepStrictEqual([moved.lemma, moved.translation, moved.tgtLang, moved.exSrc, moved.exTgt], ['aiku', 'casa', 'por', 'Aikuru wa.', 'A minha casa.']);
assert.deepStrictEqual(validateRow(moved), [], 'the moved row passes the Send tab checks');
assert.deepStrictEqual(blockingReasons(moved), []);
assert.deepStrictEqual(exampleWarnings(moved), [], 'the sentence shows the word, its translation the gloss');
assert.deepStrictEqual(rowToPairPayload(moved).examples, [{ source_text: 'Aikuru wa.', target_text: 'A minha casa.' }]);
// a sentence with a translation wins over an earlier one without
const untranslated = { ...workspace[1], text: 'Aiku!', translations: [] };
assert.strictEqual(withSentenceExample(bare, [untranslated, workspace[1]]).ex_src, 'Aikuru wa.');
assert.deepStrictEqual([withSentenceExample(bare, [untranslated]).ex_src, withSentenceExample(bare, [untranslated]).ex_tgt], ['Aiku!', undefined], 'without a translation, the sentence alone');
// a treebank record (text, tokens, translations) serves the same way; a gloss kept in allGlosses counts too
const treebankRecord = { text: 'Aiku apa', srcLang: 'apu', tokens: [{ form: 'Aiku', selectedReading: { lemma: 'aiku' }, allGlosses: [{ gloss: 'lar', lang: 'por', source: 'custom_user' }] }], translations: [{ lang: 'por', text: 'Meu lar' }] };
assert.strictEqual(withSentenceExample({ ...bare, gloss: 'lar' }, [treebankRecord]).ex_tgt, 'Meu lar');
// nothing fits: another gloss, another gloss language, another source language, no sources
assert(!('ex_src' in withSentenceExample({ ...bare, gloss: 'teto' }, workspace)), 'a word glossed otherwise is not an example');
assert(!('ex_src' in withSentenceExample({ ...bare, tgt_lang: 'spa' }, workspace)), 'the gloss has to be in the entry language');
assert(!('ex_src' in withSentenceExample({ ...bare, src_lang: 'koi' }, workspace)), 'a sentence in another language is not an example');
assert.strictEqual(withSentenceExample(bare), bare);
// an entry with its own example keeps it; only a missing translation of that same sentence is filled in
assert.strictEqual(withSentenceExample(entry, workspace), entry, 'a complete example is left alone');
const noTranslation = withSentenceExample({ ...bare, ex_src: ' Aikuru wa. ', ex_form: 'Aikuru' }, workspace);
assert.deepStrictEqual([noTranslation.ex_src, noTranslation.ex_tgt], [' Aikuru wa. ', 'A minha casa.']);
assert(!('ex_tgt' in withSentenceExample({ ...bare, ex_src: 'Aiku apa' }, workspace)), 'no translation of another sentence');
console.log('✓ An entry moved on its own takes its example and translation from the workspace or the treebank');

console.log("\nAll custom lexicon -> Ve'rdd tests passed.");
