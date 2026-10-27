/**
 * Test Suite: manual editing, provenance, re-editing and uncertain lemmas in the CoNLL-U enhancement
 * Verifies:
 * 1. Feature=Value pairs can be added, changed and removed by hand: sorted the UD way, layered keys kept,
 *    pairs outside the inventory flagged and only added after confirmation, removing an original pair confirmed.
 * 2. Other cells (LEMMA, UPOS, XPOS, HEAD, DEPREL, DEPS) and MISC keys can be edited; ID and FORM are locked.
 * 3. Manual edits use the same override mechanism: untouched rows and sentences stay byte-identical, edits show
 *    in the diff and revert per cell, per token and per sentence.
 * 4. Every edit keeps its provenance (analyzer reading, gloss, manual) in the working copy; it survives a reload
 *    and an earlier choice can be changed later.
 * 5. A lemma can be marked uncertain/undecided with alternatives; this never changes the exported file unless
 *    the (off by default) MISC option is on; "needs review" lists such tokens.
 */

import assert from 'node:assert';
import { FeatureInventory } from '../js/services/ud-feature-inventory.js';
import { conlluImportService as svc, ManualEditError } from '../js/services/conllu-import-service.js';
import { parseConllu, sentenceRaw } from '../js/services/conllu-parser.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';

console.log('=== Running Tests for Manual Editing, Provenance and Uncertain Lemmas ===\n');

const t = '\t';
const row = (...c) => c.join(t);
const FIXTURE = [
  '# sent_id = M-1', '# text = Amary awinhi.',
  row('1', 'Amary', 'amary', 'NOUN', 'N', 'Case=Nom|Gender=Masc', '2', 'nsubj', '_', 'gloss[pt]=menino|SpaceAfter=No'),
  row('2', 'awinhi', 'awinhi', 'NOUN', 'N', '_', '0', 'root', '_', 'gloss[pt]=comunidade'),
  row('3', '.', '.', 'PUNCT', '_', '_', '2', 'punct', '_', '_'),
  '',
  '# sent_id = M-2', '# text = Akyru.',
  row('1', 'Akyru', 'akyru', 'NOUN', 'N', 'Case=Nom', '0', 'root', '_', '_'),
  '', ''
].join('\n');

const lang = (feats) => ({ treebanks: ['T'], tokens: 10, feats, upos: { NOUN: 5 }, deprel: { nsubj: 3 } });
const inv = new FeatureInventory({
  languages: {
    myv: lang({ Case: { Nom: 5, Ine: 2 }, Gender: { Masc: 4 }, 'Person[psor]': { 1: 2, 3: 4 }, Possessed: { Yes: 2, No: 5 } }),
    mdf: lang({ 'Person[psor]': { 3: 4 }, Possessed: { No: 5 } })
  }
});
const keep = svc.inventory;
svc.inventory = inv;
const O = { srcLang: 'myv', inventoryLang: 'myv' }; // validate against the Erzya layer in this test

await analyzerService.init('apu');
await dictionaryService.init();
const imp = await svc.importText(FIXTURE, 'manual-fixture.conllu');
const id = imp.importId;
const parsed = parseConllu(FIXTURE);
const L = (si, tokenId) => parsed.sentences[si].lines.findIndex((l) => l.cols && l.cols[0] === tokenId && l.kind === 'token');
const amary = L(0, '1');
const awinhi = L(0, '2');
const cell = (si, line, col) => svc.workingCols(id, si, line)[col];
const rejects = async (fn, code) => {
  try { await fn(); } catch (e) { assert(e instanceof ManualEditError, `expected ManualEditError, got ${e && e.message}`); assert.strictEqual(e.code, code, `code ${e.code}: ${e.message}`); return e; }
  assert.fail(`expected ${code}`);
};

// --- 1. FEATS pairs ---------------------------------------------------------------------------
console.log('--- 1. Testing Feature=Value editing ---');
assert.deepStrictEqual(svc.featsPairs(id, 0, amary, O).map((p) => [p.pair, p.inOriginal]), [['Case=Nom', true], ['Gender=Masc', true]]);

// add a known layered pair: sorted, other columns verbatim
let res = await svc.addFeature(id, 0, amary, 'Person[psor]=3', O);
assert.strictEqual(res.changed, true);
assert.strictEqual(cell(0, amary, 5), 'Case=Nom|Gender=Masc|Person[psor]=3', 'layered key kept, UD order');
const after = parseConllu(svc.exportText(id));
const o = parsed.sentences[0].lines[amary].cols;
after.sentences[0].lines[amary].cols.forEach((v, i) => { if (i !== 5) assert.strictEqual(v, o[i], `column ${i + 1} verbatim`); });
assert.strictEqual(sentenceRaw(after.sentences[1]), sentenceRaw(parsed.sentences[1]), 'other sentence byte-identical');
assert.strictEqual(after.sentences[0].lines[awinhi].text, parsed.sentences[0].lines[awinhi].text, 'other row byte-identical');
let prov = svc.provenance(id, 0, amary);
assert.strictEqual(prov['feats:Person[psor]'].source, 'manual');
assert.deepStrictEqual(svc.diff(id, 0).changes.map((c) => [c.tokenId, c.field, c.to]), [['1', 'feats', 'Case=Nom|Gender=Masc|Person[psor]=3']], 'shows in the diff');

// sorting is case-insensitive: Number before NumType, Gender before Gender[psor]
await svc.addFeature(id, 0, amary, 'NumType=Card', { ...O, confirmNew: true });
await svc.addFeature(id, 0, amary, 'Number=Sing', { ...O, confirmNew: true });
await svc.addFeature(id, 0, amary, 'Gender[psor]=Masc', { ...O, confirmNew: true });
assert.strictEqual(cell(0, amary, 5), 'Case=Nom|Gender=Masc|Gender[psor]=Masc|Number=Sing|NumType=Card|Person[psor]=3', 'UD sort order');

// a pair in no layer is flagged new and needs a confirm
const e1 = await rejects(() => svc.addFeature(id, 0, awinhi, 'Evident=Zzz', O), 'NEW_PAIR');
assert.strictEqual(e1.pair, 'Evident=Zzz');
assert.strictEqual(cell(0, awinhi, 5), '_', 'nothing written without confirmation');
await svc.addFeature(id, 0, awinhi, 'Evident=Zzz', { ...O, confirmNew: true });
assert.strictEqual(svc.featsPairs(id, 0, awinhi, O)[0].layer, 'new', 'the chip is marked new');
// known in another language only: no confirm needed, labelled
assert.strictEqual((await svc.addFeature(id, 0, awinhi, 'Possessed=Yes', { ...O, inventoryLang: 'mdf' })).layer, 'uralic', 'Possessed=Yes is only in another Uralic language: not new');

// changing a key that is there needs "replace"
await rejects(() => svc.addFeature(id, 0, amary, 'Case=Ine', O), 'REPLACE');
assert.strictEqual(cell(0, amary, 5).includes('Case=Nom'), true);
await svc.addFeature(id, 0, amary, 'Case=Ine', { ...O, replace: true });
assert(cell(0, amary, 5).startsWith('Case=Ine|'));
await rejects(() => svc.addFeature(id, 0, amary, 'case=ine', O), 'INVALID');
await rejects(() => svc.addFeature(id, 0, amary, 'Case', O), 'INVALID');
assert.deepStrictEqual(await svc.addFeature(id, 0, amary, 'Case=Ine', O), { changed: false }, 'same value: no change');

// removing: a pair added by hand goes without a confirm; one of the original file needs it
await svc.removeFeature(id, 0, amary, 'NumType');
assert(!cell(0, amary, 5).includes('NumType'));
const e2 = await rejects(() => svc.removeFeature(id, 0, amary, 'Gender'), 'REMOVE_ORIGINAL');
assert.strictEqual(e2.value, 'Masc');
assert(cell(0, amary, 5).includes('Gender=Masc'), 'still there without confirmation');
await svc.removeFeature(id, 0, amary, 'Gender', { confirmOriginal: true });
assert(!/Gender=Masc/.test(cell(0, amary, 5)) && cell(0, amary, 5).includes('Gender[psor]=Masc'), 'only the plain Gender key went');
console.log('✓ Add / change / remove pairs: sorted, layered keys, new flagged, originals confirmed');

// --- 2. Other cells and MISC ----------------------------------------------------------------------
console.log('\n--- 2. Testing other cells and MISC ---');
await rejects(() => svc.setCellManual(id, 0, amary, 'form', 'X'), 'LOCKED');
await rejects(() => svc.setCellManual(id, 0, amary, 'id', '9'), 'LOCKED');
await rejects(() => svc.setCellManual(id, 0, amary, 'head', 'two'), 'INVALID');
await rejects(() => svc.setCellManual(id, 0, amary, 'lemma', 'a\tb'), 'INVALID');
await svc.setCellManual(id, 0, awinhi, 'lemma', 'awinhitxi', O);
assert.strictEqual(cell(0, awinhi, 2), 'awinhitxi');
await svc.setCellManual(id, 0, awinhi, 'xpos', 'N+Msc', O);
await svc.setCellManual(id, 0, awinhi, 'deps', '', O);
assert.strictEqual(cell(0, awinhi, 8), '_', 'empty becomes "_"');
await rejects(() => svc.setCellManual(id, 0, awinhi, 'upos', 'WIDGET', O), 'NEW_VALUE');
await svc.setCellManual(id, 0, awinhi, 'upos', 'PROPN', O);
assert.strictEqual(cell(0, awinhi, 3), 'PROPN', 'universal UPOS accepted');
await svc.setCellManual(id, 0, awinhi, 'upos', 'WIDGET', { ...O, confirmNew: true });
await rejects(() => svc.setCellManual(id, 0, awinhi, 'deprel', 'frobnicate', O), 'NEW_VALUE');
await svc.setCellManual(id, 0, awinhi, 'deprel', 'obj', O);
assert.deepStrictEqual(await svc.setCellManual(id, 0, awinhi, 'deprel', 'obj', O), { changed: false });

// MISC chips
assert.deepStrictEqual(svc.miscSegments(id, 0, amary).map((m) => [m.key, m.value, m.inOriginal]), [['gloss[pt]', 'menino', true], ['SpaceAfter', 'No', true]]);
await svc.setMiscManual(id, 0, amary, 'Note', 'check');
assert.strictEqual(cell(0, amary, 9), 'gloss[pt]=menino|Note=check|SpaceAfter=No', 'MISC was alphabetical: the key goes in order; other keys verbatim');
await rejects(() => svc.setMiscManual(id, 0, amary, 'Note', 'again'), 'REPLACE');
await svc.setMiscManual(id, 0, amary, 'Note', 'again', { replace: true });
await rejects(() => svc.setMiscManual(id, 0, amary, 'bad key', 'x'), 'INVALID');
await rejects(() => svc.setMiscManual(id, 0, amary, 'K', 'a|b'), 'INVALID');
await svc.removeMiscManual(id, 0, amary, 'Note');
await rejects(() => svc.removeMiscManual(id, 0, amary, 'SpaceAfter'), 'REMOVE_ORIGINAL');
await svc.removeMiscManual(id, 0, amary, 'SpaceAfter', { confirmOriginal: true });
assert.strictEqual(cell(0, amary, 9), 'gloss[pt]=menino');
console.log('✓ Cells and MISC edited by hand; ID and FORM locked; bad input refused');

// --- 3. Revert per cell, per token -----------------------------------------------------------------
console.log('\n--- 3. Testing revert per cell and token ---');
assert.deepStrictEqual(svc.editedFields(id, 0, awinhi).cells.sort(), ['deprel', 'lemma', 'upos', 'xpos', 'feats'].sort());
await svc.revertCell(id, 0, awinhi, 'lemma');
assert.strictEqual(cell(0, awinhi, 2), 'awinhi', 'one cell back to the original');
assert.strictEqual(cell(0, awinhi, 3), 'WIDGET', 'other cells keep their edits');
assert(!('lemma' in svc.provenance(id, 0, awinhi)), 'provenance of a reverted cell is gone');
await svc.revertMiscKey(id, 0, amary, 'SpaceAfter');
assert(cell(0, amary, 9).includes('SpaceAfter=No'), 'a removed original MISC key is restored');
await svc.setReadingChoice(id, 0, awinhi, 'x+y');
await svc.revertToken(id, 0, awinhi);
assert.strictEqual(svc.workingCols(id, 0, awinhi).join(t), parsed.sentences[0].lines[awinhi].text, 'token back to the original');
assert.strictEqual(svc.readingChoice(id, 0, awinhi), null, 'its reading choice too');
assert.deepStrictEqual(svc.provenance(id, 0, awinhi), {});
assert(svc.editedFields(id, 0, amary).cells.length > 0, 'other tokens keep their edits');
await svc.revertSentence(id, 0);
assert.strictEqual(svc.exportText(id), FIXTURE, 'everything reverted: original bytes');
console.log('✓ Revert a cell, a token or the sentence; nothing else is touched');

// --- 4. Provenance and re-editing ---------------------------------------------------------------------
console.log('\n--- 4. Testing provenance and changing an earlier choice ---');
svc.inventory = keep; // analyzer proposals here use the bundled (or empty) inventory: no new-pair confirmations needed
const opts = { srcLang: 'apu', columns: ['lemma', 'upos', 'xpos', 'feats'] };
let fields = svc.suggestEnhancements(id, 0, opts);
const tf = (form, col) => fields.find((f) => f.sentIndex === 0 && f.form === form && f.column === col);
const cands = tf('awinhi', 'feats').reading.candidates;
const plainPx = cands.find((c) => c.lemma === 'awinhitxi' && c.feats.includes('Person[psor]=3'));
const derNo = cands.find((c) => c.derived && c.feats.includes('Possessed=No'));
await svc.setReadingChoice(id, 0, awinhi, plainPx.raw);
fields = svc.suggestEnhancements(id, 0, opts);
res = await svc.applyEnhancements(id, fields.filter((f) => f.form === 'awinhi' && f.status === 'fill'));
assert(res.written >= 1);
prov = svc.provenance(id, 0, awinhi);
assert.strictEqual(prov.feats.source, 'analyzer');
assert.strictEqual(prov.feats.detail, plainPx.raw, 'provenance names the reading that was chosen');
assert(prov['feats:Person[psor]'] && prov['feats:Person[psor]'].detail === plainPx.raw, 'per pair too');
assert(cell(0, awinhi, 5).includes('Person[psor]=3'));
// a gloss-derived edit
await svc.revertCell(id, 0, awinhi, 'feats');
// survives a reload of the import
await svc.init();
assert.strictEqual(svc.provenance(id, 0, awinhi).feats, undefined, 'reverted: no stale provenance');
await svc.setReadingChoice(id, 0, awinhi, plainPx.raw);
fields = svc.suggestEnhancements(id, 0, opts);
await svc.applyEnhancements(id, fields.filter((f) => f.form === 'awinhi' && f.column === 'feats' && f.status === 'fill'));
await svc.init();
assert.strictEqual(svc.provenance(id, 0, awinhi).feats.detail, plainPx.raw, 'provenance survives a reload');
// change the earlier choice: switch to another reading, accept the replacement (non-empty cell: confirmation needed)
await svc.setReadingChoice(id, 0, awinhi, derNo.raw);
fields = svc.suggestEnhancements(id, 0, opts);
const featsNow = tf('awinhi', 'feats');
assert.strictEqual(featsNow.reading.choice, derNo.raw);
const stays = await svc.applyEnhancements(id, [featsNow]);
assert.strictEqual(stays.replaced + stays.written, 0, 'replacing an earlier value still needs confirmation');
if (featsNow.status === 'conflict') {
  await svc.applyEnhancements(id, [{ ...featsNow, overwrite: true }]);
  assert.strictEqual(svc.provenance(id, 0, awinhi).feats.detail, derNo.raw, 'provenance follows the new reading');
}
// provenance of manual edits and a manual change over an analyzer value
await svc.addFeature(id, 0, awinhi, 'Evident=Zzz', { confirmNew: true, ...O, inventoryLang: 'none' });
assert.strictEqual(svc.provenance(id, 0, awinhi)['feats:Evident'].source, 'manual');
await svc.revertAll(id);
assert.strictEqual(svc.exportText(id), FIXTURE);
console.log('✓ Provenance recorded, persisted, updated when the choice changes; replacements need confirmation');

// --- 5. Uncertain lemmas ---------------------------------------------------------------------------------
console.log('\n--- 5. Testing uncertain lemmas ---');
await svc.setLemmaStatus(id, 0, awinhi, 'uncertain');
await svc.addLemmaAlternative(id, 0, awinhi, 'awinhitxi');
await svc.addLemmaAlternative(id, 0, awinhi, 'awinhitxi');
await svc.addLemmaAlternative(id, 0, awinhi, 'awa');
assert.deepStrictEqual(svc.tokenNote(id, 0, awinhi), { lemmaStatus: 'uncertain', alternatives: ['awinhitxi', 'awa'] }, 'alternatives de-duplicated');
await rejects(() => svc.addLemmaAlternative(id, 0, awinhi, 'two words'), 'INVALID');
await rejects(() => svc.setLemmaStatus(id, 0, awinhi, 'maybe'), 'INVALID');
assert.strictEqual(cell(0, awinhi, 2), 'awinhi', 'the lemma itself is untouched');
assert.strictEqual(svc.exportText(id), FIXTURE, 'uncertainty is not in the exported file by default');
assert.strictEqual(svc.summary(id).editedCount, 0, 'a note is not an edit');
assert.deepStrictEqual(svc.reviewTokens(id).map((r) => [r.sentIndex, r.form, r.reason]), [[0, 'awinhi', 'uncertain']], 'needs review');
assert.strictEqual(svc.summary(id).reviewCount, 1);
assert.strictEqual(svc.diff(id, 0).notes.length, 1, 'shown in the diff view as a note');
await svc.init();
assert.deepStrictEqual(svc.tokenNote(id, 0, awinhi).alternatives, ['awinhitxi', 'awa'], 'notes survive a reload');

// the option is off by default; on: stable MISC keys; the LEMMA cell never changes
assert.strictEqual(svc.exportOptions(id).recordUncertainty, false);
await svc.setExportOption(id, 'recordUncertainty', true);
const withNotes = parseConllu(svc.exportText(id));
const mrow = withNotes.sentences[0].lines[awinhi].cols;
assert.strictEqual(mrow[9], 'AltLemma=awinhitxi,awa|gloss[pt]=comunidade|LemmaStatus=uncertain', 'optional MISC record (alphabetical like the rest), existing keys verbatim');
assert.strictEqual(mrow[2], 'awinhi', 'LEMMA unchanged');
mrow.forEach((v, i) => { if (i !== 9) assert.strictEqual(v, parsed.sentences[0].lines[awinhi].cols[i]); });
assert.strictEqual(sentenceRaw(withNotes.sentences[1]), sentenceRaw(parsed.sentences[1]), 'other sentences untouched');
await svc.init();
assert.strictEqual(svc.exportOptions(id).recordUncertainty, true, 'the option is stored with the working copy');
await svc.setExportOption(id, 'recordUncertainty', false);
assert.strictEqual(svc.exportText(id), FIXTURE, 'off again: original bytes');
await rejects(() => svc.setExportOption(id, 'bogus', true), 'INVALID');

// undecided, clearing, and revert keep notes
await svc.setLemmaStatus(id, 0, awinhi, 'undecided');
assert.strictEqual(svc.reviewTokens(id)[0].reason, 'undecided');
await svc.revertToken(id, 0, awinhi);
assert.strictEqual(svc.tokenNote(id, 0, awinhi).lemmaStatus, 'undecided', 'reverting edits keeps the user\'s notes');
await svc.removeLemmaAlternative(id, 0, awinhi, 'awa');
await svc.removeLemmaAlternative(id, 0, awinhi, 'awinhitxi');
await svc.setLemmaStatus(id, 0, awinhi, null);
assert.deepStrictEqual(svc.tokenNote(id, 0, awinhi), { lemmaStatus: null, alternatives: [] });
assert.strictEqual(svc.reviewTokens(id).length, 0);
await rejects(() => svc.setLemmaStatus(id, 0, 0, 'uncertain'), 'INVALID');
console.log('✓ Uncertain lemmas: kept out of the export unless the option is on; listed for review; persisted');

await svc.removeImport(id);
svc.inventory = keep;
console.log('\nAll manual editing tests passed.');
