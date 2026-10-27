/**
 * Test Suite: Multi-column enhancement of an imported CoNLL-U treebank
 * Verifies:
 * 1. Gloss abbreviations map to FEATS (3SG.M.O -> Person[obj]=3|Number[obj]=Sing|Gender[obj]=Masc, ...)
 *    and FEATS proposals only ever add features.
 * 2. Several columns can be selected at once; the default is MISC only; ID and FORM are locked.
 * 3. Empty cells are filled; a non-empty value is never replaced unless it was explicitly accepted.
 * 4. Rejecting (not applying) a proposal leaves the file byte-identical; stale proposals are skipped.
 * 5. An edit of one column leaves every other column of the row, and every other sentence, verbatim.
 * 6. Real UD_Apurina-UFPA test file (read only, if present): enhancing all columns fills only empty
 *    cells, nothing else changes.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { featsFromGloss, mergeFeats, describeGlossMapping, baselineDependencies } from '../js/services/conllu-enhance.js';
import { parseConllu, sentenceRaw } from '../js/services/conllu-parser.js';
import { conlluImportService as svc } from '../js/services/conllu-import-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';

console.log('=== Running Tests for Multi-Column CoNLL-U Enhancement ===\n');

const asString = (map) => [...map].map(([k, v]) => `${k}=${v}`).sort().join('|');

// --- 1. Gloss -> FEATS mapping ------------------------------------------------------------
console.log('--- 1. Testing gloss to FEATS mapping ---');
let g = featsFromGloss('ver-VBLZ-3SG.M.O', 'VERB');
assert.strictEqual(asString(g.feats), 'Gender[obj]=Masc|Number[obj]=Sing|Person[obj]=3');
assert.deepStrictEqual(g.unmapped, ['VBLZ'], 'Unknown grammatical morphemes are listed, not guessed');
assert.strictEqual(asString(featsFromGloss('3SG.M-osso', 'NOUN').feats), 'Gender[psor]=Masc|Number[psor]=Sing|Person[psor]=3', 'Role-less bundle on a noun is the possessor');
assert.strictEqual(asString(featsFromGloss('3SG.M-ir', 'VERB').feats), 'Gender[subj]=Masc|Number[subj]=Sing|Person[subj]=3', 'Role-less bundle on a verb is the subject');
assert.strictEqual(asString(featsFromGloss('dar-TEMP', 'VERB').feats), 'Case=Tem');
assert.strictEqual(asString(featsFromGloss('casa-ACC.PL', 'NOUN').feats), 'Case=Acc|Number=Plur');
assert.strictEqual(featsFromGloss('sangue.de-casa', 'NOUN').feats.size, 0, 'Lexical morphemes (lowercase) give no features');
assert.strictEqual(featsFromGloss('_', 'NOUN').feats.size, 0);
assert(describeGlossMapping().some((r) => r.abbreviation === 'ACC' && r.features === 'Case=Acc'), 'Mapping table is available for display');
console.log('✓ Leipzig abbreviations map to FEATS with roles; lexical and unknown morphemes are not guessed');

const merged = mergeFeats('Case=Nom|Gender=Masc', new Map([['Case', 'Acc'], ['Number', 'Sing']]));
assert.strictEqual(merged.merged, 'Case=Nom|Gender=Masc|Number=Sing', 'Existing Case=Nom is kept, Number added');
assert.deepStrictEqual(merged.added, ['Number']);
assert.strictEqual(merged.differing[0].key, 'Case');
assert.strictEqual(mergeFeats('Case=Nom', new Map([['Case', 'Nom']])).merged, 'Case=Nom');
assert.strictEqual(mergeFeats('_', new Map([['Number', 'Sing']])).merged, 'Number=Sing');
console.log('✓ FEATS merge adds features and never changes an existing value');

const base = baselineDependencies([
  { id: '1', upos: 'NOUN', head: '_' }, { id: '2', upos: 'VERB', head: '_' }, { id: '3', upos: 'PUNCT', head: '_' }
]);
assert.deepStrictEqual(base.map((b) => [b.head, b.deprel]), [['2', 'nsubj'], ['0', 'root'], ['2', 'punct']]);
assert.deepStrictEqual(baselineDependencies([{ id: '1', upos: 'NOUN', head: '0' }, { id: '2', upos: 'NOUN', head: '_' }]), [], 'No guesses for partial trees');

// --- 2. Fixture ---------------------------------------------------------------------------
const row = (...c) => c.join('\t');
const FIXTURE = [
  '# sent_id = A-1',
  '# text = Amary akyru Aiku.',
  row('1', 'Amary', 'amary', 'NOUN', '_', '_', '_', '_', '_', '_'),
  row('2', 'akyru', 'akyru', 'NOUN', 'N', 'Case=Nom', '_', '_', '_', 'gloss[pt]=avó'),
  row('3', 'Aiku', 'aiku', 'VERB', '_', '_', '_', '_', '_', 'SpaceAfter=No'),
  row('4', '.', '.', 'PUNCT', '_', '_', '_', '_', '_', '_'),
  '',
  '# sent_id = A-2',
  '# text = Amary atary.',
  row('1', 'Amary', 'amary', 'NOUN', 'N', 'Case=Nom|Gender=Masc|Number=Sing|Possessed=No', '2', 'nsubj', '_', 'gloss[pt]=menino'),
  row('2', 'atary', 'atama', 'VERB', 'V', '_', '0', 'root', '_', 'gloss[pt]=ver-VBLZ-3SG.M.O'),
  ''
].join('\n');

await analyzerService.init('apu');
await dictionaryService.init();
const imp = await svc.importText(FIXTURE, 'fixture.conllu');
const id = imp.importId;
const parsed = parseConllu(FIXTURE);
const find = (fields, form, column) => fields.find((f) => f.form === form && f.column === column);
const cell = (sentIdx, tokenId, col) => svc.workingCols(id, sentIdx, parsed.sentences[sentIdx].lines.findIndex((l) => l.cols && l.cols[0] === tokenId && l.kind === 'token'))[col];

// --- 3. Column selection ------------------------------------------------------------------
console.log('\n--- 2. Testing column selection ---');
const dflt = svc.suggestEnhancements(id, null, { srcLang: 'apu' });
assert(dflt.length > 0 && dflt.every((f) => f.column === 'misc'), 'Default is MISC only');
assert.throws(() => svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ['form'] }), /FORM is locked/);
assert.throws(() => svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ['id', 'misc'] }), /ID is locked/);
assert.throws(() => svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ['bogus'] }), /Unknown column/);

const ALL = ['lemma', 'upos', 'xpos', 'feats', 'head', 'deprel', 'deps', 'misc'];
const fields = svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ALL });
assert(new Set(fields.map((f) => f.column)).size >= 6, 'Several columns produce proposals at once');
assert(!fields.some((f) => f.column === 'deps'), 'DEPS has no source and proposes nothing');
assert(!fields.some((f) => f.form === '.' && ['lemma', 'upos', 'xpos', 'feats'].includes(f.column)), 'Punctuation is not analysed');

const amaryXpos = find(fields, 'Amary', 'xpos');
assert.strictEqual(amaryXpos.sentIndex, 0);
assert.deepStrictEqual([amaryXpos.from, amaryXpos.to, amaryXpos.status], ['_', 'N', 'fill'], 'Empty XPOS can be filled');
const amaryFeats = fields.find((f) => f.sentIndex === 0 && f.form === 'Amary' && f.column === 'feats');
assert.strictEqual(amaryFeats.status, 'fill');
assert.strictEqual(amaryFeats.to, 'Case=Nom|Gender=Masc|Number=Sing|Possessed=No');
assert.strictEqual(amaryFeats.source, 'analyzer');
const akyruFeats = find(fields, 'akyru', 'feats');
assert.strictEqual(akyruFeats.status, 'conflict', 'Adding to a non-empty FEATS needs acceptance');
assert(akyruFeats.to.startsWith('Case=Nom|'), 'Existing Case=Nom stays first');
const aikuUpos = find(fields, 'Aiku', 'upos');
assert.deepStrictEqual([aikuUpos.from, aikuUpos.to, aikuUpos.status], ['VERB', 'NOUN', 'conflict']);
const amaryHead = fields.find((f) => f.sentIndex === 0 && f.form === 'Amary' && f.column === 'head');
assert.strictEqual(amaryHead.status, 'fill', 'Sentence without any dependencies gets baseline guesses');
assert(!fields.some((f) => f.sentIndex === 1 && (f.column === 'head' || f.column === 'deprel')), 'Sentence with dependencies gets none');
const atary = fields.find((f) => f.form === 'atary' && f.column === 'feats');
assert.strictEqual(atary.status, 'fill', 'FEATS can come from the gloss morphemes');
assert(atary.source.includes('gloss'));
assert(atary.to.includes('Person[obj]=3') && atary.to.includes('Number[obj]=Sing') && atary.to.includes('Gender[obj]=Masc'));
assert(atary.note.includes('VBLZ'), 'Unmapped morpheme is reported');
console.log('✓ Defaults, locked columns and per-column proposals with sources');

// --- 4. Fill-only apply, no silent overwrite, reject --------------------------------------
console.log('\n--- 3. Testing fill, no-overwrite and reject ---');
assert.strictEqual(svc.exportText(id), FIXTURE, 'Nothing is written by suggesting');

let res = await svc.applyEnhancements(id, []);
assert.strictEqual(res.written + res.replaced, 0);
assert.strictEqual(svc.exportText(id), FIXTURE, 'Rejecting everything (applying nothing) keeps the bytes');

const asAccepted = fields.filter((f) => f.status === 'conflict').map((f) => ({ ...f })); // accepted without overwrite flag
res = await svc.applyEnhancements(id, asAccepted);
assert.strictEqual(res.replaced + res.written, 0, 'A conflict is skipped unless overwrite was set');
assert.strictEqual(res.skipped, asAccepted.length);
assert.strictEqual(svc.exportText(id), FIXTURE, 'No silent overwrite');

const fills = fields.filter((f) => f.status === 'fill');
res = await svc.applyEnhancements(id, fills);
assert.strictEqual(res.replaced, 0);
assert.strictEqual(res.written, fills.length);
assert(res.byColumn.xpos && res.byColumn.feats && res.byColumn.head);
assert.strictEqual(cell(0, '1', 4), 'N');
assert.strictEqual(cell(0, '1', 5), 'Case=Nom|Gender=Masc|Number=Sing|Possessed=No');
assert.strictEqual(cell(0, '2', 5), 'Case=Nom', 'Non-empty FEATS untouched by the fill step');
assert.strictEqual(cell(0, '3', 3), 'VERB', 'Conflicting UPOS untouched');
assert.strictEqual(cell(0, '2', 9), 'gloss[pt]=avó', 'Existing gloss untouched');
console.log('✓ Empty cells filled, conflicts need explicit acceptance, rejected proposals change nothing');

// row of one edited column stays verbatim elsewhere; untouched sentence identical
const out1 = parseConllu(svc.exportText(id));
const s2 = out1.sentences[1];
assert.strictEqual(s2.lines[2].text, parsed.sentences[1].lines[2].text, 'Row 1 of A-2 (nothing empty) is byte-identical');
const o2 = parsed.sentences[1].lines[3].cols;
s2.lines[3].cols.forEach((v, i) => { if (i !== 5) assert.strictEqual(v, o2[i], `A-2 row 2: column ${i + 1} verbatim`); });
assert.strictEqual(s2.lines[3].cols[5], 'Gender[obj]=Masc|Number[obj]=Sing|Person[obj]=3', 'Only the empty FEATS cell of A-2 was filled');
const orig1 = parsed.sentences[0].lines.find((l) => l.cols && l.cols[0] === '1');
const new1 = out1.sentences[0].lines.find((l) => l.cols && l.cols[0] === '1');
[0, 1, 2, 3, 8].forEach((c) => assert.strictEqual(new1.cols[c], orig1.cols[c], `Column ${c + 1} of an enhanced row stays verbatim when it has nothing to fill`));
assert.strictEqual(new1.cols[9], 'gloss[pt]=menino', 'MISC was selected and gets the dictionary gloss');
const punct = out1.sentences[0].lines.find((l) => l.cols && l.cols[0] === '4');
assert.strictEqual(punct.cols[7], 'punct', 'Punctuation row only gets head/deprel guesses');
assert.deepStrictEqual([2, 3, 4, 5, 8, 9].map((c) => punct.cols[c]), ['.', 'PUNCT', '_', '_', '_', '_'], 'Other columns of the punctuation row verbatim');

// accept a conflict explicitly: only that column of that row changes
const accept = { ...find(fields, 'Aiku', 'upos'), overwrite: true };
const before = svc.workingCols(id, 0, accept.lineIdx);
res = await svc.applyEnhancements(id, [accept]);
assert.deepStrictEqual([res.replaced, res.written], [1, 0]);
const after = svc.workingCols(id, 0, accept.lineIdx);
after.forEach((v, i) => { if (i !== 3) assert.strictEqual(v, before[i], `Column ${i + 1} unchanged by a UPOS edit`); });
assert.strictEqual(after[3], 'NOUN');
const d = svc.diff(id, 0);
assert(d.changes.some((c) => c.field === 'upos' && c.from === 'VERB' && c.to === 'NOUN'), 'Diff shows old and new');
assert(d.changes.some((c) => c.field === 'xpos' && c.from === '_' && c.to === 'N'));

// FEATS accepted on a non-empty cell: other columns verbatim, existing values kept
const accFeats = { ...find(fields, 'akyru', 'feats'), overwrite: true };
const beforeF = svc.workingCols(id, 0, accFeats.lineIdx);
await svc.applyEnhancements(id, [accFeats]);
const afterF = svc.workingCols(id, 0, accFeats.lineIdx);
afterF.forEach((v, i) => { if (i !== 5) assert.strictEqual(v, beforeF[i]); });
assert(afterF[5].startsWith('Case=Nom|') && afterF[5].length > beforeF[5].length, 'FEATS edit adds features and keeps Case=Nom');
console.log('✓ An edit of one column keeps all other columns of the row verbatim');

// stale proposal
const staleField = { ...find(fields, 'Aiku', 'upos'), from: 'VERB', overwrite: true };
res = await svc.applyEnhancements(id, [staleField]);
assert.strictEqual(res.stale, 1, 'A proposal made against an older value is skipped');

// revert everything
await svc.revertAll(id);
assert.strictEqual(svc.exportText(id), FIXTURE, 'Revert restores the original bytes');

// gloss column keeps working through the same path
const misc = svc.suggestEnhancements(id, 0, { srcLang: 'apu', columns: ['misc'] });
const miscFill = misc.filter((f) => f.status === 'fill');
assert(miscFill.some((f) => f.form === 'Amary' && f.to === 'menino' && f.key === 'gloss[pt]'));
await svc.applyEnhancements(id, miscFill);
assert.strictEqual(cell(0, '1', 9), 'gloss[pt]=menino');
await svc.revertAll(id);
await svc.removeImport(id);

// prepareLanguage never disturbs the workbench's active analyzer and never falls back to another model
const activeBefore = analyzerService.activeLang;
assert.strictEqual(await svc.prepareLanguage('apu'), true, 'Loaded analyzer is available');
assert.strictEqual(await svc.prepareLanguage('zzz'), false, 'Unknown language: no analyzer, no fallback');
assert.strictEqual(analyzerService.activeLang, activeBefore, 'Active analyzer unchanged');
assert(!analyzerService.hasModelForLanguage('zzz'));

// --- 5. Real file, read only --------------------------------------------------------------
console.log('\n--- 4. Testing the real UD_Apurina-UFPA test file (if present; read only) ---');
const realPath = process.env.CONLLU_TEST_FILE
  || `${process.env.HOME}/Desktop/Github/ud/UD_Apurina-UFPA/not-to-release/apu_ufpa-ud-test.conllu`; // community data: read only, never copied into this repo
if (fs.existsSync(realPath)) {
  const real = fs.readFileSync(realPath, 'utf8');
  const r = await svc.importText(real, 'apu_ufpa-ud-test.conllu');
  const proposals = svc.suggestEnhancements(r.importId, null, { srcLang: 'apu', columns: ALL });
  assert(proposals.some((p) => p.status === 'fill') && proposals.some((p) => p.status === 'conflict'));
  const result = await svc.applyEnhancements(r.importId, proposals); // no overwrite flags anywhere
  assert.strictEqual(result.replaced, 0, 'No non-empty value replaced');
  const origLines = real.split('\n');
  const newLines = svc.exportText(r.importId).split('\n');
  assert.strictEqual(newLines.length, origLines.length);
  let changedRows = 0;
  newLines.forEach((l, i) => {
    if (l === origLines[i]) return;
    changedRows++;
    const a = origLines[i].split('\t');
    const b = l.split('\t');
    assert.strictEqual(b.length, 10);
    b.forEach((v, c) => {
      if (v === a[c]) return;
      if (c === 9) assert(v.startsWith(a[9] === '_' ? 'gloss' : a[9].split('|')[0].split('=')[0]) || v.includes('gloss'), 'MISC only gains a gloss');
      else assert.strictEqual(a[c], '_', `Column ${c + 1} changed although it was not empty (line ${i + 1})`);
    });
    assert([0, 1, 8].every((c) => a[c] === b[c]), 'ID, FORM and DEPS never change');
  });
  assert(changedRows > 0);
  await svc.removeImport(r.importId);
  console.log(`✓ Real file: ${result.written} empty cells filled in ${changedRows} rows; no non-empty value replaced; ID/FORM/DEPS untouched`);
} else {
  console.log('(skipped: Apurinã file not found; set CONLLU_TEST_FILE to run)');
}

console.log('\nAll multi-column enhancement tests passed.');
