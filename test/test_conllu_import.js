/**
 * Test Suite: CoNLL-U import, careful editing and lossless re-export
 * Verifies:
 * 1. The parser keeps every line verbatim (CRLF, missing final newline, BOM, multiword ranges,
 *    empty nodes, odd comments) and reports malformed rows instead of dropping them.
 * 2. Untouched files and sentences round-trip byte-identically.
 * 3. Edits are stored as minimal overrides; only the edited columns / MISC keys / comments change
 *    on export, and reverting restores the original bytes.
 * 4. The file's own gloss convention (gloss[pt]= vs gloss_pt=) is detected and followed; dictionary
 *    glosses are suggested for new tokens and never overwrite an existing gloss without confirmation.
 * 5. Import stores an immutable original; re-import, clearing accumulated treebanks and the exported
 *    file name never touch it.
 * 6. If the Apurinã UD test file is available locally, it round-trips byte-identically too.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import {
  parseConllu, serializeConllu, sentenceRaw, editCell, editMiscKey, editComment, detectGlossConvention,
  describeChanges, applyMiscEdits, glossKeyFor
} from '../js/services/conllu-parser.js';
import { conlluImportService, defaultExportFileName } from '../js/services/conllu-import-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { storageService } from '../js/services/storage-service.js';

console.log('=== Running Tests for CoNLL-U Import & Lossless Export ===\n');

const T = '\t';
const row = (...c) => c.join(T);

// A small treebank in the style of UD_Apurina-UFPA: string sent_ids, text_orig / gloss_pt comments,
// gloss[pt]= (dominant) next to one gloss_pt=, GTtags, SpaceAfter, a multiword range.
const SAMPLE = [
  '# -*- coding : UTF-8 -*-',
  '# sent_id = Text-1-1',
  '# text_orig = Aiku ata-ry',
  '# text = Aiku atary.',
  '# gloss_pt = casa ver-3SG.M.O',
  '# text_pt = A casa foi vista.',
  row('1', 'Aiku', 'aiku', 'NOUN', 'N', 'Case=Nom', '2', 'nsubj', '_', 'GTtags=Msc,Sg|gloss[pt]=casa'),
  row('2', 'atary', 'atama', 'VERB', '_', 'Mood=Ind', '0', 'root', '_', 'gloss[pt]=ver-3SG.M.O|SpaceAfter=No'),
  row('3', '.', '.', 'PUNCT', '_', '_', '2', 'punct', '_', '_'),
  '',
  '# sent_id = Text-1-2',
  '# text = Amary akyru.',
  row('1', 'Amary', 'amary', 'NOUN', 'N', '_', '0', 'root', '_', 'CGdeprel=@SUBJ'),
  row('2', 'akyru', 'akyru', 'NOUN', 'N', '_', '1', 'nmod', '_', '_'),
  row('3', '.', '.', 'PUNCT', '_', '_', '1', 'punct', '_', '_'),
  '',
  '# sent_id = Text-1-3',
  '# text = Ykynykaapuku amaru.',
  row('1-2', 'Ykynykaapuku', '_', '_', '_', '_', '_', '_', '_', 'SpaceAfter=No'),
  row('1', 'Ykyny', 'ykyny', 'NOUN', 'N', '_', '0', 'root', '_', 'gloss_pt=mãe'),
  row('2', 'kaapuku', 'kaapuku', 'ADP', 'Po', '_', '1', 'case', '_', '_'),
  row('3', 'amaru', 'amaru', 'NOUN', 'N', '_', '1', 'nmod', '_', 'gloss[pt]=menina'),
  '',
  ''
].join('\n');

const sentences = (parsed) => parsed.sentences.map((s) => s.sentId);

// --- 1. Parser: verbatim lines, odd inputs -----------------------------------------------
console.log('--- 1. Testing parser robustness ---');
const parsed = parseConllu(SAMPLE);
assert.deepStrictEqual(sentences(parsed), ['Text-1-1', 'Text-1-2', 'Text-1-3'], 'String sent_ids must be kept');
assert.strictEqual(parsed.sentences[0].text, 'Aiku atary.');
assert.strictEqual(parsed.sentences[0].lines[0].text, '# -*- coding : UTF-8 -*-', 'Leading non-key comment stays in sentence 1');
assert.strictEqual(parsed.sentences[2].lines.find((l) => l.kind === 'mwt').cols[1], 'Ykynykaapuku');
assert.strictEqual(parsed.issues.length, 0, 'Clean sample has no issues');
assert.strictEqual(serializeConllu(parsed), SAMPLE, 'Sample must round-trip byte-identically');
console.log('✓ Sample parses (string sent_ids, comments, mwt range) and round-trips identically');

const variants = {
  'CRLF': SAMPLE.replace(/\n/g, '\r\n'),
  'no final newline': SAMPLE.replace(/\n+$/, ''),
  'BOM': `﻿${SAMPLE}`,
  'mixed line endings': SAMPLE.replace('Text-1-2\n', 'Text-1-2\r\n'),
  'leading blank lines': `\n\n${SAMPLE}`,
  'extra blank lines between sentences': SAMPLE.replace('\n\n# sent_id = Text-1-2', '\n\n\n\n# sent_id = Text-1-2'),
  'only comments, no rows': '# just a comment\n',
  'empty node and trailing spaces': SAMPLE.replace(row('3', '.', '.', 'PUNCT', '_', '_', '2', 'punct', '_', '_'),
    `${row('2.1', 'x', 'x', 'X', '_', '_', '_', '_', '_', '_')}\n${row('3', '.', '.', 'PUNCT', '_', '_', '2', 'punct', '_', '_')}  `)
};
for (const [name, text] of Object.entries(variants)) {
  assert.strictEqual(serializeConllu(parseConllu(text)), text, `Round trip must be byte-identical: ${name}`);
}
assert.strictEqual(parseConllu(variants.CRLF).eol, '\r\n');
assert.strictEqual(parseConllu(variants.CRLF).sentences.length, 3);
assert.strictEqual(parseConllu(variants['no final newline']).sentences[2].lines.at(-1).eol, '');
assert(parseConllu(variants['empty node and trailing spaces']).sentences[0].lines.some((l) => l.kind === 'empty'), 'Empty node 2.1 recognised');
assert.strictEqual(parseConllu('').sentences.length, 0);
console.log(`✓ ${Object.keys(variants).length} format variants round-trip byte-identically`);

const bad = [
  '# sent_id = bad-1', '# text = x y',
  row('1', 'x', 'x', 'X', '_', '_', '0', 'root', '_', '_'),
  '2 y y X _ _ 1 dep _ _',
  row('two', 'z', 'z', 'X', '_', '_', '1', 'dep', '_', '_'),
  row('3', '', 'z', 'X', '_', '_', '1', 'dep', '_', '_'),
  '', '# sent_id = bad-1', '# text = dup', row('1', 'a', 'a', 'X', '_', '_', '0', 'root', '_', '_'), ''
].join('\n');
const badParsed = parseConllu(bad);
const errors = badParsed.issues.filter((i) => i.severity === 'error');
assert.strictEqual(errors.length, 3, 'Space-separated row, bad ID and empty cell are reported');
assert(errors[0].message.includes('space-separated'), 'Space-separated hint');
assert.strictEqual(errors[0].line, 4, 'Issue carries the 1-based file line');
assert(badParsed.issues.some((i) => /duplicate sent_id/.test(i.message)), 'Duplicate sent_id warned');
assert.strictEqual(badParsed.sentences[0].lines.filter((l) => l.kind === 'malformed').length, 3, 'Malformed rows are kept, not dropped');
assert.strictEqual(serializeConllu(badParsed), bad, 'File with malformed rows still round-trips');
console.log('✓ Malformed rows are reported (with line numbers) and kept verbatim');

// --- 2. Overrides: change only what was edited -------------------------------------------
console.log('\n--- 2. Testing minimal overrides ---');
const overrides = {};
const s2 = parsed.sentences[1];
const lineOf = (sent, id) => sent.lines.findIndex((l) => l.cols && l.cols[0] === id && l.kind === 'token');

editMiscKey(overrides, s2, lineOf(s2, '2'), 'gloss[pt]', 'avó');
editCell(overrides, s2, lineOf(s2, '1'), 'upos', 'PROPN');
editComment(overrides, s2, 'gloss_pt', 'menino avó');
assert.deepStrictEqual(Object.keys(overrides), ['1'], 'Only the edited sentence has overrides');
const edited = serializeConllu(parsed, overrides);
const editedBlocks = parseConllu(edited);
assert.strictEqual(sentenceRaw(editedBlocks.sentences[0]), sentenceRaw(parsed.sentences[0]), 'Sentence 1 untouched');
assert.strictEqual(sentenceRaw(editedBlocks.sentences[2]), sentenceRaw(parsed.sentences[2]), 'Sentence 3 untouched');
const e2 = editedBlocks.sentences[1];
assert.strictEqual(e2.lines.find((l) => l.cols && l.cols[0] === '1').cols[3], 'PROPN');
assert.strictEqual(e2.lines.find((l) => l.cols && l.cols[0] === '1').cols[9], 'CGdeprel=@SUBJ', 'Other MISC key kept');
assert.strictEqual(e2.lines.find((l) => l.cols && l.cols[0] === '2').cols[9], 'gloss[pt]=avó');
assert(e2.lines.some((l) => l.text === '# gloss_pt = menino avó'), 'New comment inserted');
assert.strictEqual(e2.lines.findIndex((l) => l.text.startsWith('# gloss_pt')), 2, 'New comment goes after the last comment');
const changes = describeChanges(s2, overrides[1]);
assert.strictEqual(changes.length, 3);
assert(changes.some((c) => c.field === 'upos' && c.from === 'NOUN' && c.to === 'PROPN'));
console.log('✓ Edits change only the edited cells, keys and comments');

editCell(overrides, s2, lineOf(s2, '1'), 'upos', 'NOUN');
assert(!overrides[1].cells[lineOf(s2, '1')], 'Setting a value back to the original drops the override');
editMiscKey(overrides, s2, lineOf(s2, '2'), 'gloss[pt]', null);
editComment(overrides, s2, 'gloss_pt', null);
assert.deepStrictEqual(overrides, {}, 'Removing keys that were never in the original leaves no override');
assert.strictEqual(serializeConllu(parsed, overrides), SAMPLE, 'Reverting restores the original bytes');
const s1 = parsed.sentences[0];
const ovRemove = {};
editMiscKey(ovRemove, s1, lineOf(s1, '2'), 'gloss[pt]', null);
editMiscKey(ovRemove, s1, lineOf(s1, '2'), 'SpaceAfter', null);
assert.strictEqual(parseConllu(serializeConllu(parsed, ovRemove)).sentences[0].lines.find((l) => l.cols && l.cols[0] === '2').cols[9], '_', 'Removing the last MISC keys leaves "_"');
console.log('✓ No-op edits are pruned and revert restores the original bytes');

assert.strictEqual(applyMiscEdits('SpaceAfter=No', { 'gloss[pt]': 'x' }), 'gloss[pt]=x|SpaceAfter=No', 'New key keeps alphabetical order when MISC is sorted');
assert.strictEqual(applyMiscEdits('SpaceAfter=No|CGdeprel=@X', { 'gloss[pt]': 'x' }), 'CGdeprel=@X|gloss[pt]=x|SpaceAfter=No', 'An edited MISC cell always comes out alphabetical, even when it was not');
assert.strictEqual(applyMiscEdits('SpaceAfter=No|CGdeprel=@X', {}), 'SpaceAfter=No|CGdeprel=@X', 'A cell without edits is never reordered');
assert.strictEqual(applyMiscEdits('Gloss[en]=a|GTtags=N|Gloss=b', { SpaceAfter: 'No' }), 'Gloss=b|Gloss[en]=a|GTtags=N|SpaceAfter=No', 'Case-insensitive code-point order');
assert.throws(() => editMiscKey({}, s2, lineOf(s2, '1'), 'gloss[pt]', 'a|b'), /Invalid MISC value/);
assert.throws(() => editCell({}, s2, lineOf(s2, '1'), 'upos', 'A\tB'), /Invalid value/);
assert.throws(() => editCell({}, s2, 0, 'upos', 'X'), /not an editable/);

// Editing the last line of a file without final newline must not glue lines together
const noNl = parseConllu(SAMPLE.replace(/\n+$/, ''));
const ovNoNl = {};
const lastSent = noNl.sentences[2];
editMiscKey(ovNoNl, lastSent, lineOf(lastSent, '3'), 'gloss[pt]', 'menina2');
editComment(ovNoNl, lastSent, 'gloss_pt', 'nova');
const noNlOut = serializeConllu(noNl, ovNoNl);
assert(noNlOut.endsWith('menina2'), 'Last line keeps having no final newline');
assert.strictEqual(parseConllu(noNlOut).sentences.length, 3);
console.log('✓ Editing at an unterminated end of file keeps lines apart');

// --- 3. Gloss convention -----------------------------------------------------------------
console.log('\n--- 3. Testing gloss convention detection ---');
const conv = detectGlossConvention(parsed);
assert.strictEqual(conv.key, 'gloss[pt]', 'Dominant key is gloss[pt]');
assert.strictEqual(conv.counts['gloss_pt'], 1, 'Minority gloss_pt= counted');
assert.strictEqual(conv.mixed, true);
assert.strictEqual(glossKeyFor(conv, 'pt'), 'gloss[pt]');
assert.strictEqual(glossKeyFor(conv, 'por'), 'gloss[pt]', 'por is the same language as pt');
assert.strictEqual(glossKeyFor(conv, 'en'), 'gloss[en]', 'Other language follows the dominant style');
const underscoreFile = parseConllu(SAMPLE.replace(/gloss\[pt\]/g, 'gloss_pt'));
assert.strictEqual(detectGlossConvention(underscoreFile).key, 'gloss_pt');
assert.strictEqual(glossKeyFor(detectGlossConvention(underscoreFile), 'en'), 'gloss_en');
assert.strictEqual(detectGlossConvention(parseConllu('# text = a\n' + row('1', 'a', 'a', 'X', '_', '_', '0', 'root', '_', '_') + '\n')).key, null);
console.log('✓ Dominant key detected, minority style tolerated, new languages follow the file style');

// --- 4. Service: import, suggest, apply, export ------------------------------------------
console.log('\n--- 4. Testing import service ---');
await storageService.clearAccumulatedTreebanks();
await analyzerService.init('apu');
await dictionaryService.init();

const imp = await conlluImportService.importText(SAMPLE, 'sample-ud-test.conllu');
assert.strictEqual(imp.duplicate, false);
assert.strictEqual(imp.summary.sentenceCount, 3);
assert.strictEqual(imp.summary.editedCount, 0);
assert(imp.summary.hash.length >= 8, 'Hash recorded');
assert.strictEqual(conlluImportService.exportText(imp.importId), SAMPLE, 'Fresh import exports byte-identically');
assert.notStrictEqual(imp.summary.exportName, 'sample-ud-test.conllu', 'Default export name differs from the original');
assert.strictEqual(imp.summary.exportName, 'sample-ud-test.enhanced.conllu');
assert.strictEqual(defaultExportFileName('x'), 'x.enhanced.conllu');
assert.strictEqual(conlluImportService.safeExportName(imp.importId, 'sample-ud-test.conllu'), 'sample-ud-test.enhanced.conllu', 'Original name is never offered');
console.log('✓ Import stores original, export equals import, export name differs');

const again = await conlluImportService.importText(SAMPLE, 'renamed.conllu');
assert.strictEqual(again.duplicate, true, 'Same content is recognised');
assert.strictEqual(conlluImportService.list().length, 1, 'No second copy');
console.log('✓ Re-importing the same content does not create or replace anything');

const sug = conlluImportService.suggestGlosses(imp.importId, null, { srcLang: 'apu' });
const byForm = (f, si) => sug.find((s) => s.form === f && (si === undefined || s.sentIndex === si));
assert(!sug.some((s) => s.form === '.'), 'Punctuation gets no suggestion');
assert.strictEqual(byForm('Amary').status, 'new', 'amary has no gloss in the file and one in the dictionary');
assert.strictEqual(byForm('Amary').gloss, 'menino');
assert.strictEqual(byForm('Amary').key, 'gloss[pt]', 'Written with the file\'s dominant key');
assert.strictEqual(byForm('akyru').gloss, 'avó');
assert.strictEqual(byForm('Aiku').status, 'same', 'Existing identical gloss is reported as same');
assert.strictEqual(byForm('atary').status, 'consistent', 'ver-3SG.M.O already contains the dictionary gloss "ver" for atama');
assert.strictEqual(byForm('Ykyny').status, 'none');
const conflict = conlluImportService.suggestGlosses(imp.importId, 2, { srcLang: 'apu' }).find((s) => s.form === 'amaru');
assert.strictEqual(conflict.existing, 'menina');
assert.strictEqual(conflict.status, 'same');
console.log('✓ Suggestions follow the file convention and classify new / same / consistent / none');

// A conflicting dictionary entry: replace the existing gloss text through an edit, then ask again
await conlluImportService.setMisc(imp.importId, 2, lineOf(parsed.sentences[2], '3'), 'gloss[pt]', 'garota');
const conflict2 = conlluImportService.suggestGlosses(imp.importId, 2, { srcLang: 'apu' }).find((s) => s.form === 'amaru');
assert.strictEqual(conflict2.status, 'conflict');
assert.strictEqual(conflict2.existing, 'garota');
const noOverwrite = await conlluImportService.applyGlossSuggestions(imp.importId, [conflict2]);
assert.deepStrictEqual(noOverwrite, { written: 0, replaced: 0, skipped: 1 }, 'Existing gloss is never overwritten without confirmation');
assert(conlluImportService.exportText(imp.importId).includes('gloss[pt]=garota'), 'Existing gloss preserved');
await conlluImportService.revertSentence(imp.importId, 2);

const applyRes = await conlluImportService.applyGlossSuggestions(imp.importId, sug.filter((s) => s.status === 'new'));
assert.strictEqual(applyRes.written, 2, 'Amary and akyru got glosses');
const out = conlluImportService.exportText(imp.importId);
const outParsed = parseConllu(out);
assert.strictEqual(outParsed.sentences[1].lines.find((l) => l.cols && l.cols[0] === '1').cols[9], 'CGdeprel=@SUBJ|gloss[pt]=menino', 'Existing MISC key kept, gloss appended');
assert.strictEqual(sentenceRaw(outParsed.sentences[0]), sentenceRaw(parsed.sentences[0]), 'Untouched sentence 1 identical');
assert.strictEqual(sentenceRaw(outParsed.sentences[2]), sentenceRaw(parsed.sentences[2]), 'Untouched sentence 3 identical');
assert.strictEqual(conlluImportService.summary(imp.importId).editedCount, 1);
assert(conlluImportService.isEdited(imp.importId, 1));
const diff = conlluImportService.diff(imp.importId, 1);
assert.strictEqual(diff.changes.length, 2);
assert.strictEqual(diff.lines.filter((l) => l.type === 'added').length, 2, 'Two changed rows show as added');
assert.strictEqual(diff.lines.filter((l) => l.type === 'removed').length, 2, 'and their originals as removed');
console.log('✓ Applied glosses change only the edited sentence; diff lists them');

// Overwrite only with explicit confirmation
const overwrite = { ...conflict2, overwrite: true };
assert.deepStrictEqual(await conlluImportService.applyGlossSuggestions(imp.importId, [overwrite]), { written: 0, replaced: 1, skipped: 0 });
assert(conlluImportService.exportText(imp.importId).includes('gloss[pt]=menina'), 'Confirmed overwrite writes the dictionary gloss');
await conlluImportService.revertAll(imp.importId);
assert.strictEqual(conlluImportService.exportText(imp.importId), SAMPLE, 'Revert all restores original bytes');
console.log('✓ Overwrite needs explicit confirmation; revert restores the original');

// --- 5. Storage: immutable original, working copy survives reload -------------------------
console.log('\n--- 5. Testing storage guarantees ---');
await conlluImportService.applyGlossSuggestions(imp.importId, sug.filter((s) => s.status === 'new'));
await conlluImportService.setExportName(imp.importId, 'my-glossed.conllu');

const tampered = await storageService.addConlluOriginal({
  importId: imp.importId, fileName: 'evil.conllu', importedAt: 1, hash: 'x', size: 0, text: 'tampered'
});
assert.strictEqual(tampered.existed, true, 'An original cannot be re-added');
assert.strictEqual(tampered.record.text, SAMPLE, 'Stored original is unchanged');

await storageService.clearAccumulatedTreebanks();
assert((await storageService.getConlluRecord(`orig:${imp.importId}`)), 'Clearing accumulated treebanks leaves imports alone');

await conlluImportService.init(); // simulate reload from storage
assert.strictEqual(conlluImportService.list().length, 1);
assert.strictEqual(conlluImportService.exportFileName(imp.importId), 'my-glossed.conllu');
assert.strictEqual(conlluImportService.originalText(imp.importId), SAMPLE, 'Original text still byte-identical after reload');
assert.strictEqual(conlluImportService.summary(imp.importId).editedCount, 1, 'Working copy survived the reload');
assert(conlluImportService.exportText(imp.importId).includes('gloss[pt]=menino'));
console.log('✓ Original immutable; working copy and export name persist');

await conlluImportService.removeImport(imp.importId);
assert.strictEqual(conlluImportService.list().length, 0);
assert.strictEqual(await storageService.getConlluRecord(`orig:${imp.importId}`), null);

// --- 6. Optional: the real Apurinã UD test file -----------------------------------------
console.log('\n--- 6. Testing the real UD_Apurina-UFPA test file (if present) ---');
const realPath = process.env.CONLLU_TEST_FILE
  || `${process.env.HOME}/Desktop/Github/ud/UD_Apurina-UFPA/not-to-release/apu_ufpa-ud-test.conllu`; // community data: read only, never copied into this repo
if (fs.existsSync(realPath)) {
  const real = fs.readFileSync(realPath, 'utf8');
  const realImp = await conlluImportService.importText(real, 'apu_ufpa-ud-test.conllu');
  assert.strictEqual(conlluImportService.exportText(realImp.importId), real, 'Apurinã file: import then export must be byte-identical');
  const rc = conlluImportService.glossConvention(realImp.importId);
  assert.strictEqual(rc.key, 'gloss[pt]');
  assert.strictEqual(rc.mixed, true);
  const rs = conlluImportService.suggestGlosses(realImp.importId, null, { srcLang: 'apu' });
  assert(rs.length > 0);
  assert(rs.every((s) => s.status !== 'new' || s.existing === null), 'New suggestions only where no gloss exists');
  await conlluImportService.applyGlossSuggestions(realImp.importId, rs); // no overwrite flags
  const afterApply = conlluImportService.exportText(realImp.importId);
  const origLines = real.split('\n');
  const newLines = afterApply.split('\n');
  assert.strictEqual(newLines.length, origLines.length, 'No lines added or lost');
  newLines.forEach((l, i) => {
    if (l !== origLines[i]) assert(l.startsWith(origLines[i].replace(/\t[^\t]*$/, '')), `Only the MISC column may change (line ${i + 1})`);
  });
  await conlluImportService.removeImport(realImp.importId);
  console.log(`✓ Apurinã file (${parseConllu(real).sentences.length} sentences) round-trips byte-identically; glossing changes MISC only`);
} else {
  console.log('(skipped: Apurinã file not found; set CONLLU_TEST_FILE to run)');
}

console.log('\nAll CoNLL-U import tests passed.');
