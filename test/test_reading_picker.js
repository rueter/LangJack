/**
 * Test Suite: per-token reading picker for the CoNLL-U enhancement
 * Verifies:
 * 1. summarizeReadings lists candidates and set-aside readings, defaults to the shared features, and a
 *    chosen reading supplies LEMMA, UPOS, XPOS and FEATS together (also a reading the filters set aside).
 * 2. The bulk run keeps the default rule and flags ambiguous tokens (needsChoice); single-reading tokens are not flagged.
 * 3. A choice is stored per token, survives a reload from storage, shows in the diff, can be reset,
 *    and is dropped by reverting the sentence.
 * 4. Applying a chosen reading still follows the no-overwrite rules.
 */

import assert from 'node:assert';
import { summarizeReadings } from '../js/services/conllu-enhance.js';
import { parseConllu } from '../js/services/conllu-parser.js';
import { conlluImportService as svc } from '../js/services/conllu-import-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';

console.log('=== Running Tests for the Reading Picker ===\n');

// --- 1. summarizeReadings -------------------------------------------------------------------
console.log('--- 1. Testing reading candidates and choice ---');
const reading = (raw, lemma, featsMap, upos = 'NOUN', pos = 'N') => ({ raw, lemma, upos, pos, featsMap });
const base = { Gender: 'Masc', Number: 'Sing', Case: 'Nom' };
const R = {
  plainPx: reading('awinhitxi+N+Msc+Sg+PxSg3M+Possd+Nom', 'awinhitxi', { ...base, 'Person[psor]': '3', Possessed: 'Yes' }),
  plain: reading('awinhitxi+N+Msc+Sg+Possd+Nom', 'awinhitxi', { ...base, Possessed: 'Yes' }),
  derPx: reading('awa+v1+V+Der+Der/NomAct+N+Msc+Sg+PxSg3M+Possd+Nom', 'awa', { ...base, 'Person[psor]': '3', Possessed: 'Yes' }),
  derNo: reading('awa+v1+V+Der+Der/NomAct+N+Msc+Sg+NPossd+Nom', 'awa', { ...base, Possessed: 'No' }, 'NOUN', 'N')
};
const all = [R.derPx, R.plainPx, R.derNo, R.plain];
const row = { lemma: 'awinhi', upos: 'NOUN' };

const dflt = summarizeReadings(all, row);
assert.strictEqual(dflt.ambiguous, true, 'two plain readings remain: ambiguous');
assert.strictEqual(dflt.choice, null);
assert.strictEqual(dflt.candidates.length, 4, 'Every reading is a candidate: the file\'s lemma never hides one');
assert.deepStrictEqual(dflt.candidates.filter((c) => c.inDefault).map((c) => c.raw).sort(), [R.plainPx.raw, R.plain.raw].sort(), 'only the plain readings are in the default pool');
assert(dflt.candidates.filter((c) => !c.inDefault).every((c) => c.derived), 'derived readings stay pickable, marked as outside the default');
assert(dflt.candidates.every((c) => c.matchesFileLemma === false), 'none matches the file\'s lemma awinhi');
assert(dflt.defaultReason.includes('plain readings'), 'the tie-breaker is stated');
assert.strictEqual(dflt.feats.get('Possessed'), 'Yes');
assert(!dflt.feats.has('Person[psor]'), 'default = features shared by the candidates');
assert.strictEqual(dflt.shared.size, dflt.feats.size);
assert.strictEqual(dflt.candidates.find((c) => c.raw === R.plainPx.raw).feats, 'Case=Nom|Gender=Masc|Number=Sing|Person[psor]=3|Possessed=Yes', 'candidate shows the FEATS it would give');

const picked = summarizeReadings(all, row, R.plainPx.raw);
assert.strictEqual(picked.choice, R.plainPx.raw);
assert.deepStrictEqual([picked.lemma, picked.upos, picked.xpos], ['awinhitxi', 'NOUN', 'N'], 'LEMMA, UPOS, XPOS come from the chosen reading');
assert.strictEqual(picked.feats.get('Person[psor]'), '3', 'FEATS too: the possessor features are back');
assert.strictEqual(picked.readings, 1);
assert.strictEqual(picked.ambiguous, true, 'still listed as ambiguous so the picker stays visible');

const derived = summarizeReadings(all, row, R.derNo.raw);
assert.deepStrictEqual([derived.lemma, derived.feats.get('Possessed')], ['awa', 'No'], 'A reading set aside by the filters can be chosen');
const stale = summarizeReadings(all, row, 'no+such+reading');
assert.strictEqual(stale.choiceStale, true, 'A choice that no longer exists is ignored');
assert.strictEqual(stale.lemma, 'awinhitxi');
assert.strictEqual(summarizeReadings([R.plain], row).ambiguous, false, 'One reading: nothing to choose');
// form first: the file's lemma narrows the default only within the plain readings; every reading stays visible and pickable
const byFile = summarizeReadings(all, { lemma: 'awa', upos: 'NOUN' });
assert.strictEqual(byFile.candidates.length, 4, 'a file lemma never hides a reading');
assert.deepStrictEqual(byFile.candidates.filter((c) => c.inDefault).map((c) => c.lemma), ['awinhitxi', 'awinhitxi'], 'plain readings stay the default: the derived awa reading is not preferred');
assert.deepStrictEqual(byFile.candidates.filter((c) => c.matchesFileLemma).map((c) => c.lemma), ['awa', 'awa'], 'but the readings matching the file are labelled');
assert(byFile.candidates.filter((c) => c.matchesFileLemma).every((c) => !c.inDefault && c.group === 'other'));
const other = summarizeReadings(all, { lemma: 'awa', upos: 'NOUN' }, R.plain.raw);
assert.strictEqual(other.lemma, 'awinhitxi', 'the user can pick a lemma that differs from the file\'s');
const derPick = summarizeReadings(all, { lemma: 'awinhi', upos: 'NOUN' }, R.derNo.raw);
assert.strictEqual(derPick.lemma, 'awa', 'an explicit choice of a derived reading always wins');
console.log('✓ Candidates, default, and a chosen reading supplying all four columns');

// --- 2. Service ---------------------------------------------------------------------------------
console.log('\n--- 2. Testing bulk flags, persistence, diff, reset ---');
const t = '\t';
const FIXTURE = [
  '# sent_id = P-1', '# text = Amary akyru.',
  ['1', 'Amary', 'amary', 'NOUN', '_', '_', '_', '_', '_', '_'].join(t),
  ['2', 'akyru', 'akyru', 'NOUN', '_', '_', '_', '_', '_', '_'].join(t),
  '',
  '# sent_id = P-2', '# text = Awinhi.',
  ['1', 'awinhi', 'awinhi', 'NOUN', 'N', 'Case=Nom', '_', '_', '_', '_'].join(t),
  '', ''
].join('\n');
await analyzerService.init('apu');
await dictionaryService.init();
const imp = await svc.importText(FIXTURE, 'picker-fixture.conllu');
const id = imp.importId;
const parsed = parseConllu(FIXTURE);
const lineOf = (si, tokenId) => parsed.sentences[si].lines.findIndex((l) => l.cols && l.cols[0] === tokenId);
const COLS = ['lemma', 'upos', 'xpos', 'feats'];
const opts = { srcLang: 'apu', columns: COLS };
const tokenFields = (fields, si, form) => fields.filter((f) => f.sentIndex === si && f.form === form);

// bulk run: default rule, ambiguous tokens flagged
let fields = svc.suggestEnhancements(id, null, opts);
const flagged = new Set(fields.filter((f) => f.needsChoice).map((f) => `${f.sentIndex}:${f.form}`));
assert(flagged.has('0:akyru') && flagged.has('1:awinhi'), 'Tokens with several readings are flagged "needs your choice"');
assert(!flagged.has('0:Amary'), 'A single-reading token is not flagged');
assert(tokenFields(fields, 1, 'awinhi').every((f) => f.reading.ambiguous && f.reading.candidates.length === 5 && f.reading.candidates.filter((c) => c.inDefault).length === 2), 'Every column of the token carries the picker data: all five readings, two in the default');
const defFeats = tokenFields(fields, 0, 'akyru').find((f) => f.column === 'feats').to;
assert(!defFeats.includes('Person[psor]'), 'Default proposal keeps only the shared features');
assert(tokenFields(fields, 0, 'akyru')[0].note.includes('needs your choice'));

// choose
const akyruLine = lineOf(0, '2');
const pxRaw = tokenFields(fields, 0, 'akyru')[0].reading.candidates.find((c) => c.feats.includes('Person[psor]=3')).raw;
await svc.setReadingChoice(id, 0, akyruLine, pxRaw);
assert.strictEqual(svc.readingChoice(id, 0, akyruLine), pxRaw);
fields = svc.suggestEnhancements(id, null, opts);
const chosen = tokenFields(fields, 0, 'akyru');
assert(chosen.every((f) => !f.needsChoice && f.reading.choice === pxRaw), 'No longer needs a choice');
assert(chosen.find((f) => f.column === 'feats').to.includes('Person[psor]=3'), 'The chosen reading brings Person[psor] back');
assert(chosen.find((f) => f.column === 'feats').note.includes('chosen by you'));
assert.strictEqual(svc.summary(id).choiceCount, 1);
assert.strictEqual(svc.summary(id).editedCount, 0, 'A choice is not an edit: the file is unchanged');
assert.strictEqual(svc.exportText(id), FIXTURE, 'Export is still byte-identical');
assert(!fields.filter((f) => f.needsChoice).some((f) => f.form === 'akyru'));
assert(fields.filter((f) => f.needsChoice).some((f) => f.form === 'awinhi'), 'Other tokens still need a choice');

// diff
const d = svc.diff(id, 0);
assert.deepStrictEqual(d.choices.map((c) => [c.tokenId, c.form, c.raw]), [['2', 'akyru', pxRaw]], 'Choice shows in the diff');
assert.strictEqual(svc.diff(id, 1).choices.length, 0);

// persistence across a reload from storage
await svc.init();
assert.strictEqual(svc.readingChoice(id, 0, akyruLine), pxRaw, 'Choice survives a reload');
assert.strictEqual(svc.summary(id).choiceCount, 1);

// choose a reading the filters set aside, then reset
const awLine = lineOf(1, '1');
const derRaw = tokenFields(fields, 1, 'awinhi')[0].reading.candidates.find((c) => !c.inDefault && c.feats.includes('Possessed=No')).raw;
await svc.setReadingChoice(id, 1, awLine, derRaw);
fields = svc.suggestEnhancements(id, 1, opts);
const aw = tokenFields(fields, 1, 'awinhi');
assert.strictEqual(aw.find((f) => f.column === 'lemma').to, 'awa', 'A derived reading supplies the lemma too');
assert.strictEqual(aw.find((f) => f.column === 'xpos').to, 'N');

// no-overwrite rules still hold: the cell Case=Nom and lemma awinhi are non-empty
const lemmaField = aw.find((f) => f.column === 'lemma');
assert.strictEqual(lemmaField.status, 'conflict');
let res = await svc.applyEnhancements(id, [lemmaField]);
assert.strictEqual(res.replaced + res.written, 0, 'A chosen reading does not overwrite silently');
assert.strictEqual(svc.exportText(id), FIXTURE);
res = await svc.applyEnhancements(id, [{ ...lemmaField, overwrite: true }]);
assert.strictEqual(res.replaced, 1);
assert(svc.exportText(id).includes(['1', 'awinhi', 'awa', 'NOUN', 'N'].join(t)), 'The accepted lemma is in the export');
assert.strictEqual(svc.workingCols(id, 1, awLine)[2], 'awa');
await svc.revertSentence(id, 1);
assert.strictEqual(svc.readingChoice(id, 1, awLine), null, 'Reverting the sentence also drops the choice');
assert.strictEqual(svc.readingChoice(id, 0, akyruLine), pxRaw, 'Other sentences keep theirs');

// reset
await svc.setReadingChoice(id, 0, akyruLine, null);
assert.strictEqual(svc.readingChoice(id, 0, akyruLine), null, 'Reset removes the choice');
assert.strictEqual(svc.summary(id).choiceCount, 0);
fields = svc.suggestEnhancements(id, 0, opts);
assert(tokenFields(fields, 0, 'akyru').every((f) => f.needsChoice), 'Back to the default rule, needs a choice again');
await assert.rejects(() => svc.setReadingChoice(id, 0, 0, 'x'), /Not a token row/);

// revert all clears everything
await svc.setReadingChoice(id, 0, akyruLine, pxRaw);
await svc.revertAll(id);
assert.strictEqual(svc.summary(id).choiceCount, 0);
assert.strictEqual(svc.exportText(id), FIXTURE);
await svc.removeImport(id);
console.log('✓ Flags in bulk runs; choice persists, shows in the diff, resets, respects no-overwrite');

console.log('\nAll reading picker tests passed.');
