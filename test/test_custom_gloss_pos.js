/**
 * Test Suite: custom glosses require a part of speech for the source word AND for the target gloss
 * Verifies:
 * 1. Only real parts of speech count (the Ve'rdd set); "UND" (undetermined), blanks and unknown tags do not.
 * 2. A custom gloss added with { requirePos: true } (what the workbench does) is refused without a usable POS for the
 *    source word or for the target gloss, and stored with the canonical ones otherwise; entries added the old way (imports) are still stored but are
 *    listed as lacking a POS, and a POS can be set afterwards (invalid ones are refused).
 * 3. The POS chosen for a token's custom gloss and for its target gloss is what a Ve'rdd draft uses.
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
const count = (lemma) => dictionaryService.customEntriesCache.filter((e) => e.lemma === lemma).length;
await assert.rejects(() => dictionaryService.addCustomEntry(entry(), { requirePos: true }), /source word/);
await assert.rejects(() => dictionaryService.addCustomEntry(entry({ pos: 'UND', tgt_pos: 'N' }), { requirePos: true }), /source word/);
await assert.rejects(() => dictionaryService.addCustomEntry(entry({ pos: 'whatever', tgt_pos: 'N' }), { requirePos: true }), /source word/);
await assert.rejects(() => dictionaryService.addCustomEntry(entry({ pos: 'N' }), { requirePos: true }), /target gloss/, 'the gloss needs its own POS');
await assert.rejects(() => dictionaryService.addCustomEntry(entry({ pos: 'N', tgt_pos: 'UND' }), { requirePos: true }), /target gloss/);
await assert.rejects(() => dictionaryService.addCustomEntry(entry({ pos: 'N', tgt_pos: 'nonsense' }), { requirePos: true }), /target gloss/);
assert.strictEqual(count('testlemma'), 0, 'nothing was stored by the refused attempts');

await dictionaryService.addCustomEntry(entry({ pos: 'n', tgt_pos: 'v' }), { requirePos: true });
const stored = dictionaryService.customEntriesCache.filter((e) => e.lemma === 'testlemma');
assert.strictEqual(stored.length, 1);
assert.deepStrictEqual([stored[0].pos, stored[0].tgt_pos], ['N', 'V'], 'stored with the canonical POS of the word and of the gloss (they may differ)');
const persisted = (await storageService.getCustomEntries('apu', 'testlemma'))[0];
assert.deepStrictEqual([persisted.pos, persisted.tgt_pos], ['N', 'V'], 'and persisted');

// several glosses in one go keep both parts of speech on each
await dictionaryService.addCustomEntry(entry({ lemma: 'multi', gloss: 'one; two', pos: 'V', tgt_pos: 'N' }), { requirePos: true });
assert.deepStrictEqual(dictionaryService.customEntriesCache.filter((e) => e.lemma === 'multi').map((e) => [e.pos, e.tgt_pos]), [['V', 'N'], ['V', 'N']]);

// an import without POS is still accepted (large dictionaries), but flagged until both are chosen
const before = dictionaryService.entriesMissingPos().length;
await dictionaryService.importCustomDictionary('poeslemma\tohne\tpor\n', 'tsv', 'apu', 'por');
let missing = dictionaryService.entriesMissingPos().filter((e) => e.lemma === 'poeslemma');
assert.strictEqual(missing.length, 1, 'an imported entry with no POS is listed as lacking one');
assert.strictEqual(dictionaryService.entriesMissingPos().length, before + 1);
const id = missing[0].id;
await assert.rejects(() => dictionaryService.updateCustomEntryPos(id, ''), /Choose a part of speech for the source word/);
await assert.rejects(() => dictionaryService.updateCustomEntryTgtPos(id, 'UND'), /Choose a part of speech for the target gloss/);
assert.strictEqual(await dictionaryService.updateCustomEntryPos(id, 'adv'), 'Adv');
assert.strictEqual(dictionaryService.entriesMissingPos().length, before + 1, 'still flagged: the gloss has no POS yet');
assert.strictEqual(await dictionaryService.updateCustomEntryTgtPos(id, 'Adv'), 'Adv');
assert.strictEqual(dictionaryService.entriesMissingPos().length, before, 'completed once both are set');
const done = dictionaryService.customEntriesCache.find((e) => e.lemma === 'poeslemma');
assert.deepStrictEqual([done.pos, done.tgt_pos], ['Adv', 'Adv']);
await assert.rejects(() => dictionaryService.updateCustomEntryPos('no-such-id', 'N'), /Unknown entry/);

// the gloss POS survives export and import (7th column / JSON field)
const tsv = await dictionaryService.exportCustomDictionary('tsv');
assert(tsv.split('\n')[0].endsWith('\ttarget_pos'), 'export has a target_pos column');
assert(tsv.split('\n').some((l) => l.startsWith('testlemma\t') && l.endsWith('\tV')), 'the gloss POS is exported');
await dictionaryService.importCustomDictionary('roundtrip\tgloss\tpor\tV\tapu\tnote\tN\n', 'tsv', 'apu', 'por');
assert.deepStrictEqual(dictionaryService.customEntriesCache.filter((e) => e.lemma === 'roundtrip').map((e) => [e.pos, e.tgt_pos]), [['V', 'N']], 'imported with both parts of speech');
await dictionaryService.importCustomDictionary(JSON.stringify([{ lemma: 'jsonlemma', gloss: 'x', pos: 'N', tgt_pos: 'Adv' }]), 'json', 'apu', 'por');
assert.deepStrictEqual(dictionaryService.customEntriesCache.filter((e) => e.lemma === 'jsonlemma').map((e) => [e.pos, e.tgt_pos]), [['N', 'Adv']]);
console.log('✓ Both parts of speech are required; imported entries are flagged and can be completed; the gloss POS round-trips');

// --- 3. Ve'rdd drafts ---
const sentence = (token) => [{ text: 'Aiku atary.', tokens: [token] }];
const tok = (extra) => ({ form: 'aiku', lemma: 'aiku', selectedReading: { lemma: 'aiku', pos: '' }, ...extra });
const posOf = (token) => draftsFromSentences(sentence(token), [], 'apu', 'por')[0].pos;
assert.strictEqual(posOf(tok({ customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N' })), 'N', 'the POS chosen for the gloss reaches the Ve\'rdd draft');
assert.strictEqual(posOf(tok({ customGloss: 'casa', customGlossLang: 'por' })), POS_UNDETERMINED, 'without one it would be undetermined (and blocked there)');
assert.strictEqual(posOf(tok({ selectedReading: { lemma: 'aiku', pos: 'V' }, customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N' })), 'N', 'the gloss POS wins over the reading\'s');
assert.strictEqual(posOf(tok({ selectedReading: { lemma: 'aiku', pos: 'V' }, customGlossPos: 'N', selectedGloss: { gloss: 'casa', lang: 'por' } })), 'V', 'ignored when the token has no custom gloss');
const tgtOf = (token) => draftsFromSentences(sentence(token), [], 'apu', 'por')[0].tgtPos;
assert.strictEqual(tgtOf(tok({ customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N', customGlossTgtPos: 'V' })), 'V', 'the gloss POS reaches the draft as the translation POS, apart from the word POS');
assert.strictEqual(tgtOf(tok({ customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N', customGlossTgtPos: 'Adv' })), 'Adv', 'other canonical values pass through');
assert.strictEqual(tgtOf(tok({ customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N' })), '', 'without one it stays blank (Ve\'rdd then reads it as the headword\'s)');
assert.strictEqual(tgtOf(tok({ customGloss: 'casa', customGlossLang: 'por', customGlossPos: 'N', customGlossTgtPos: 'UND' })), '', 'undetermined is not sent as a POS');
assert.strictEqual(tgtOf(tok({ customGlossTgtPos: 'V', selectedGloss: { gloss: 'casa', lang: 'por' } })), '', 'ignored when the token has no custom gloss');
console.log('✓ The POS of a custom gloss is what Ve\'rdd drafts use');

// cleanup
for (const e of dictionaryService.customEntriesCache.filter((x) => ['testlemma', 'multi', 'poeslemma', 'roundtrip', 'jsonlemma'].includes(x.lemma))) await dictionaryService.deleteCustomEntry(e.id);
console.log('\nAll custom gloss POS tests passed.');
