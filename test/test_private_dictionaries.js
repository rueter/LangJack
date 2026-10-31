/**
 * Test Suite: private dictionaries (uploaded FST transducers and TSV files)
 * Verifies:
 * 1. An uploaded .hfstol dictionary is kept in the browser store and is loaded again on the next start
 *    (it used to be saved but never read back), newest first; the same file name replaces the earlier upload.
 * 2. Uploaded dictionaries can be listed and removed; nothing else can be removed this way.
 * 3. A TSV in LangJack's own format (the packaged models/dict-apu-por.tsv, or an export) imports without turning
 *    its header row into an entry, and reads the POS columns.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { dictionaryService, UPLOADED_DICT_PREFIX, CUSTOM_POS_CHOICES } from '../js/services/dictionary-service.js';
import { storageService } from '../js/services/storage-service.js';

console.log('=== Running Tests for Private Dictionaries ===\n');

const bytes = fs.readFileSync('models/bundled_dict.hfstol');
const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// --- 1. Upload, reload, replace ---
await dictionaryService.init();
const baseline = dictionaryService.dictGenerators.length;
assert.strictEqual(dictionaryService.uploadedDictId('My Private.hfstol'), `${UPLOADED_DICT_PREFIX}my_private.hfstol`, 'id from the file name');

const idA = dictionaryService.uploadedDictId('private-a.hfstol');
await dictionaryService.loadFromBuffer(buffer(), idA, 'private-a.hfstol', true);
assert.strictEqual(dictionaryService.dictGenerators.length, baseline + 1, 'used at once');
assert.strictEqual(dictionaryService.activeDictName, 'private-a.hfstol');
assert.deepStrictEqual((await dictionaryService.listUploadedDictionaries()).map((d) => d.name), ['private-a.hfstol']);
assert((await dictionaryService.listUploadedDictionaries())[0].size > 1000, 'size is listed');

// the same file name again: replaced, not stacked
await dictionaryService.loadFromBuffer(buffer(), idA, 'private-a.hfstol', true);
assert.strictEqual(dictionaryService.dictGenerators.length, baseline + 1, 'a re-upload replaces the earlier copy');
assert.strictEqual((await dictionaryService.listUploadedDictionaries()).length, 1);

// a second file; then "close the browser": a fresh start reads both back
await new Promise((r) => setTimeout(r, 5)); // distinct timestamps
const idB = dictionaryService.uploadedDictId('private-b.hfstol');
await dictionaryService.loadFromBuffer(buffer(), idB, 'private-b.hfstol', true);
assert.deepStrictEqual((await dictionaryService.listUploadedDictionaries()).map((d) => d.name), ['private-b.hfstol', 'private-a.hfstol'], 'newest first');
await dictionaryService.init();
assert.strictEqual(dictionaryService.uploadedDicts.size, 2, 'both uploads are loaded again after a restart');
assert.strictEqual(dictionaryService.dictGenerators.length, baseline + 2);
assert.strictEqual(dictionaryService.activeDictName, 'private-b.hfstol', 'the newest is the active one');
console.log('✓ An uploaded dictionary survives a restart; the same name replaces it; newest first');

// --- 2. Remove ---
await assert.rejects(() => dictionaryService.removeUploadedDictionary('uralic_full_dictionary'), /Not an uploaded dictionary/);
await dictionaryService.removeUploadedDictionary(idB);
assert.deepStrictEqual((await dictionaryService.listUploadedDictionaries()).map((d) => d.name), ['private-a.hfstol']);
assert.strictEqual(dictionaryService.dictGenerators.length, baseline + 1);
assert.strictEqual(dictionaryService.activeDictName, 'private-a.hfstol', 'the previous upload is active again');
assert.strictEqual(await storageService.getModel(idB), null, 'gone from the browser store');
await dictionaryService.removeUploadedDictionary(idA);
await dictionaryService.init();
assert.strictEqual(dictionaryService.uploadedDicts.size, 0, 'nothing comes back after removal');
assert.strictEqual(dictionaryService.dictGenerators.length, baseline);
console.log('✓ Uploaded dictionaries can be listed and removed');

// --- 3. TSV in LangJack's own format ---
const packaged = fs.readFileSync('models/dict-apu-por.tsv', 'utf8');
assert(/^lemma\tgloss\ttarget_lang/m.test(packaged), 'the packaged file has a header row');
await dictionaryService.importCustomDictionary(packaged, 'tsv', 'apu', 'por');
const mine = dictionaryService.customEntriesCache;
assert(!mine.some((e) => e.lemma === 'lemma' && e.gloss === 'gloss'), 'the header row is not an entry');
const aiku = mine.filter((e) => e.lemma === 'aiku' && e.tgt_lang === 'por');
assert(aiku.length >= 1 && aiku[0].gloss === 'casa' && aiku[0].pos === 'N', 'rows are read with their POS');
assert.strictEqual(aiku[0].tgt_pos, 'N', 'the target POS is read too');
const imported = mine.filter((e) => e.notes === 'Imported from spreadsheet');
for (const e of imported) await dictionaryService.deleteCustomEntry(e.id);

// both packaged dictionaries use the download format, with the simple POS tags on both sides
for (const file of ['models/dict-apu-por.tsv', 'models/dict-koi.tsv']) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.strictEqual(lines[0], 'lemma\tgloss\ttarget_lang\tpos\tsource_lang\tnotes\ttarget_pos', `${file}: header`);
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    assert.strictEqual(cols.length, 7, `${file}: seven columns in "${line}"`);
    assert(CUSTOM_POS_CHOICES.includes(cols[3]), `${file}: pos ${cols[3]} is a simple POS`);
    assert(CUSTOM_POS_CHOICES.includes(cols[6]), `${file}: target_pos ${cols[6]} is a simple POS`);
  }
}
console.log('✓ Packaged dictionaries are in the download format');

// an export (with the new target_pos column) imports again without a bogus header entry
await dictionaryService.addCustomEntry({ src_lang: 'apu', lemma: 'exportme', pos: 'V', tgt_pos: 'N', tgt_lang: 'por', gloss: 'exportado' }, { requirePos: true });
const exported = await dictionaryService.exportCustomDictionary('tsv');
for (const e of dictionaryService.customEntriesCache.filter((x) => x.lemma === 'exportme')) await dictionaryService.deleteCustomEntry(e.id);
await dictionaryService.importCustomDictionary(exported, 'tsv', 'apu', 'por');
const back = dictionaryService.customEntriesCache.filter((e) => e.lemma === 'exportme');
assert.deepStrictEqual(back.map((e) => [e.pos, e.tgt_pos, e.gloss]), [['V', 'N', 'exportado']], 'both parts of speech come back');
assert(!dictionaryService.customEntriesCache.some((e) => e.lemma === 'lemma'), 'still no header entry');
for (const e of dictionaryService.customEntriesCache) await dictionaryService.deleteCustomEntry(e.id);
console.log('✓ LangJack-format TSV imports cleanly (header skipped, POS columns read, export round-trips)');

console.log('\nAll private dictionary tests passed.');
