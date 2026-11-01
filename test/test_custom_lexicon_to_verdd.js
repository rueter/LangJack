/**
 * Test Suite: moving entries of the custom lexicon to Ve'rdd
 * Verifies:
 * 1. An entry becomes a draft row with both parts of speech, the homonym numerals and the example sentence pair,
 *    and the row makes a /pairs payload that carries all of it.
 * 2. The example check: the sentence has to show the headword (or its form in the sentence), the translation the gloss.
 * 3. Homonym numerals and examples can be set on, and cleared from, a stored entry; bad numerals are refused.
 * 4. Recording that an entry reached Ve'rdd keeps the lexeme ids and the homonym numerals used.
 */

import assert from 'node:assert';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { rowFromCustomEntry, rowToPairPayload, exampleWarnings, validateRow, blockingReasons } from '../js/services/verdd-api-service.js';

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

// --- 4. Recording the result ---
await dictionaryService.markEntrySent(id, { sourceId: 41, targetId: 42, srcHomo: 3, tgtHomo: null });
stored = dictionaryService.customEntriesCache.find((e) => e.id === id);
assert(stored.verdd_sent_at > 0);
assert.deepStrictEqual([stored.verdd_source_id, stored.verdd_target_id, stored.src_homo, stored.tgt_homo], [41, 42, 3, 0], 'ids kept, the numeral used is recorded, an unused one is left alone');
assert.strictEqual(await dictionaryService.markEntrySent('missing', {}), null);
await dictionaryService.deleteCustomEntry(id);
console.log("✓ An entry that reached Ve'rdd remembers when, which lexemes, and the homonyms used");

console.log("\nAll custom lexicon -> Ve'rdd tests passed.");
