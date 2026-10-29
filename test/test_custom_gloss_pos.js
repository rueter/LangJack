/**
 * Test Suite: custom glosses require a part of speech
 * Verifies:
 * 1. Only real parts of speech count (the Ve'rdd set); "UND" (undetermined), blanks and unknown tags do not.
 * 2. A custom gloss added with { requirePos: true } (what the workbench does) is refused without a usable POS and
 *    stored with the canonical one otherwise; entries added the old way (imports) are still stored but are
 *    listed as lacking a POS, and a POS can be set afterwards (invalid ones are refused).
 * 3. A POS chosen for a token's custom gloss is what a Ve'rdd draft uses, so the entry is not sent as undetermined.
 */

import assert from 'node:assert';
import { dictionaryService, CUSTOM_POS_CHOICES, normalizeCustomPos } from '../js/services/dictionary-service.js';
import { draftsFromSentences, POS_UNDETERMINED } from '../js/services/verdd-api-service.js';
import { storageService } from '../js/services/storage-service.js';

console.log('=== Running Tests for Custom Glosses Requiring a POS ===\n');

// --- 1. Which POS values count ---
assert(CUSTOM_POS_CHOICES.includes('N') && CUSTOM_POS_CHOICES.includes('V') && CUSTOM_POS_CHOICES.includes('Po'));
assert(!CUSTOM_POS_CHOICES.includes('UND'), 'UND is "not known yet", not a part of speech');
assert.strictEqual(normalizeCustomPos('n'), 'N', 'case-insensitive, canonical result');
assert.strictEqual(normalizeCustomPos(' V '), 'V');
assert.strictEqual(normalizeCustomPos('Pron'), 'Pron');
for (const bad of ['', '  ', null, undefined, 'UND', 'und', 'X', 'ZERO', 'nonsense']) {
  assert.strictEqual(normalizeCustomPos(bad), '', `"${bad}" is no usable part of speech`);
}
console.log('✓ Only the known parts of speech count; UND, blank and unknown tags do not');

// --- 2. Adding, completing ---
await dictionaryService.init();
const entry = (extra = {}) => ({ src_lang: 'apu', lemma: 'testlemma', tgt_lang: 'por', gloss: 'teste', ...extra });
await assert.rejects(() => dictionaryService.addCustomEntry(entry(), { requirePos: true }), /part of speech is required/);
await assert.rejects(() => dictionaryService.addCustomEntry(entry({ pos: 'UND' }), { requirePos: true }), /part of speech is required/);
await assert.rejects(() => dictionaryService.addCustomEntry(entry({ pos: 'whatever' }), { requirePos: true }), /part of speech is required/);
assert.strictEqual(dictionaryService.customEntriesCache.filter((e) => e.lemma === 'testlemma').length, 0, 'nothing was stored by the refused attempts');

await dictionaryService.addCustomEntry(entry({ pos: 'n' }), { requirePos: true });
let stored = dictionaryService.customEntriesCache.filter((e) => e.lemma === 'testlemma');
assert.strictEqual(stored.length, 1);
assert.strictEqual(stored[0].pos, 'N', 'stored with the canonical POS');
assert.strictEqual((await storageService.getCustomEntries('apu', 'testlemma'))[0].pos, 'N', 'and persisted');

// several glosses in one go keep the POS on each
await dictionaryService.addCustomEntry(entry({ lemma: 'multi', gloss: 'one; two', pos: 'V' }), { requirePos: true });
assert.deepStrictEqual(dictionaryService.customEntriesCache.filter((e) => e.lemma === 'multi').map((e) => e.pos), ['V', 'V']);

// an import without POS is still accepted (large dictionaries), but flagged until a POS is chosen
const before = dictionaryService.entriesMissingPos().length;
await dictionaryService.importCustomDictionary('poeslemma\tohne\tpor\n', 'tsv', 'apu', 'por');
const missing = dictionaryService.entriesMissingPos().filter((e) => e.lemma === 'poeslemma');
assert.strictEqual(missing.length, 1, 'an imported entry with no POS is listed as lacking one');
assert.strictEqual(dictionaryService.entriesMissingPos().length, before + 1);
await assert.rejects(() => dictionaryService.updateCustomEntryPos(missing[0].id, ''), /Choose a part of speech/);
await assert.rejects(() => dictionaryService.updateCustomEntryPos(missing[0].id, 'UND'), /Choose a part of speech/);
assert.strictEqual(await dictionaryService.updateCustomEntryPos(missing[0].id, 'adv'), 'Adv');
assert.strictEqual(dictionaryService.entriesMissingPos().length, before, 'completed');
assert.strictEqual(dictionaryService.customEntriesCache.find((e) => e.lemma === 'poeslemma').pos, 'Adv');
await assert.rejects(() => dictionaryService.updateCustomEntryPos('no-such-id', 'N'), /Unknown entry/);
console.log('✓ A gloss without a usable POS is refused; imported ones are flagged and can be completed');

// --- 3. Ve'rdd drafts ---
const sentence = (token) => [{ text: 'Aiku atary.', tokens: [token] }];
const tok = (extra) => ({ form: 'aiku', lemma: 'aiku', selectedReading: { lemma: 'aiku', pos: '' }, ...extra });
const posOf = (token) => draftsFromSentences(sentence(token), [], 'apu', 'por')[0].pos;
assert.strictEqual(posOf(tok({ customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N' })), 'N', 'the POS chosen for the gloss reaches the Ve\'rdd draft');
assert.strictEqual(posOf(tok({ customGloss: 'casa', customGlossLang: 'por' })), POS_UNDETERMINED, 'without one it would be undetermined (and blocked there)');
assert.strictEqual(posOf(tok({ selectedReading: { lemma: 'aiku', pos: 'V' }, customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N' })), 'N', 'the gloss POS wins over the reading\'s');
assert.strictEqual(posOf(tok({ selectedReading: { lemma: 'aiku', pos: 'V' }, customGlossPos: 'N', selectedGloss: { gloss: 'casa', lang: 'por' } })), 'V', 'ignored when the token has no custom gloss');
console.log('✓ The POS of a custom gloss is what Ve\'rdd drafts use');

// cleanup
for (const e of dictionaryService.customEntriesCache.filter((x) => ['testlemma', 'multi', 'poeslemma'].includes(x.lemma))) await dictionaryService.deleteCustomEntry(e.id);
console.log('\nAll custom gloss POS tests passed.');
