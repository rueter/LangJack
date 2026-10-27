/**
 * Test Suite: reading selection independent of analyzer tag order, grouped dropdown, XPOS from the chosen reading
 * Verifies:
 * 1. The same word analysed in two tag orders (older bundled analyzer vs newer one) gives the same FEATS, the same
 *    default selection and ONE dropdown entry, shown with its tags as the analyzer emitted them.
 * 2. Derivation (Der, Der/...) and compounding (Cmp, Cmp/..., #) are detected as tags wherever they stand.
 * 3. Plain readings come first and are the default; derived and compound ones stay available in a second group;
 *    an explicit choice (also of a derived reading) always wins and drives LEMMA, UPOS, XPOS and FEATS together.
 * 4. XPOS gets the short POS tag or the full analyzer tag string (as emitted); a non-empty XPOS is never
 *    overwritten silently; readings that disagree propose nothing until the user chooses.
 * 5. Analysis=<reading> is only written to MISC when that option is on and the values come from that reading.
 * 6. Which analyzer build produced the readings can be shown.
 */

import assert from 'node:assert';
import { TagMapper } from '../js/services/tag-mapper.js';
import {
  summarizeReadings, isDerivedReading, isCompoundReading, readingKey, readingTags
} from '../js/services/conllu-enhance.js';
import { parseConllu } from '../js/services/conllu-parser.js';
import { conlluImportService as svc } from '../js/services/conllu-import-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';

console.log('=== Running Tests for Order-Independent Readings and the XPOS Dropdown ===\n');

const R = (raw) => TagMapper.parse(raw);
// the same word `awinhi` in two tag orders: bundled analyzer (old) and the user's newer build (new)
const OLD = {
  derPx: 'awa+v1+V+Der+Der/NomAct+N+Msc+Sg+PxSg3M+Possd+Nom',
  derNo: 'awa+v1+V+Der+Der/NomAct+N+Msc+Sg+NPossd+Nom',
  plainPx: 'awinhitxi+N+Msc+Sg+PxSg3M+Possd+Nom',
  plain: 'awinhitxi+N+Msc+Sg+Possd+Nom'
};
const NEW = {
  derPx: 'awa+v1+V+Der+Der/NomAct+N+Msc+Sg+Nom+Possd+PxSg3M',
  derNo: 'awa+v1+V+Der+Der/NomAct+N+Msc+Sg+Nom+NPossd',
  plainPx: 'awinhitxi+N+Msc+Sg+Nom+Possd+PxSg3M',
  plain: 'awinhitxi+N+Msc+Sg+Nom+Possd'
};
const row = { lemma: 'awinhi', upos: 'NOUN' };

// --- 1. Tag order ----------------------------------------------------------------------------
console.log('--- 1. Testing tag-order independence ---');
for (const k of Object.keys(OLD)) {
  assert.deepStrictEqual(R(OLD[k]).featsMap, R(NEW[k]).featsMap, `${k}: same FEATS for any tag order`);
  assert.strictEqual(R(OLD[k]).upos, R(NEW[k]).upos, `${k}: same UPOS`);
  assert.strictEqual(readingKey(R(OLD[k])), readingKey(R(NEW[k])), `${k}: same lemma and tag SET = same reading`);
  assert.notStrictEqual(R(OLD[k]).raw, R(NEW[k]).raw, 'the emitted strings do differ');
}
const mixed = [R(OLD.derPx), R(NEW.plainPx), R(OLD.plainPx), R(NEW.derPx), R(OLD.plain), R(NEW.derNo)];
const a = summarizeReadings(mixed, row);
assert.strictEqual(a.candidates.length, 4, 'reordered duplicates are listed once: 2 plain + 2 derived');
assert.strictEqual(a.candidates.filter((c) => c.kind === 'plain').length, 2);
const reversed = summarizeReadings([...mixed].reverse(), row);
assert.deepStrictEqual(
  reversed.candidates.map((c) => [c.lemma, c.kind, c.feats]).sort(),
  a.candidates.map((c) => [c.lemma, c.kind, c.feats]).sort(), 'same readings whatever order the analyzer returns them');
const sorted = (m) => [...m].map(([k, v]) => `${k}=${v}`).sort();
assert.deepStrictEqual(sorted(reversed.feats), sorted(a.feats), 'same default FEATS');
assert.deepStrictEqual(reversed.candidates.filter((c) => c.inDefault).map((c) => c.lemma), a.candidates.filter((c) => c.inDefault).map((c) => c.lemma), 'same default selection');
assert.strictEqual(a.ambiguous && reversed.ambiguous, true, 'two plain readings: needs your choice, in either order');
// tags are shown exactly as the analyzer emitted them (the first emitted wins as the display)
const plainPxEntry = a.candidates.find((c) => c.kind === 'plain' && c.feats.includes('Person[psor]=3'));
assert.strictEqual(plainPxEntry.raw, NEW.plainPx, 'first emitted form is shown');
assert.strictEqual(plainPxEntry.tagString, 'N+Msc+Sg+Nom+Possd+PxSg3M', 'tags in the analyzer\'s own order, not sorted');
assert.strictEqual(reversed.candidates.find((c) => c.kind === 'plain' && c.feats.includes('Person[psor]=3')).tagString, 'N+Msc+Sg+PxSg3M+Possd+Nom');
// only the old order: the same
const onlyOld = summarizeReadings(Object.values(OLD).map(R), row);
const onlyNew = summarizeReadings(Object.values(NEW).map(R), row);
assert.deepStrictEqual(sorted(onlyOld.feats), sorted(onlyNew.feats));
assert.strictEqual(onlyOld.candidates.length, onlyNew.candidates.length);
console.log('✓ Same FEATS, same default, one dropdown entry per reading, tags shown as emitted');

// --- 2. Der / Cmp anywhere ---------------------------------------------------------------------
console.log('\n--- 2. Testing derivation and compound detection ---');
const stub = (tags, raw = `x+${tags.join('+')}`) => ({ raw, lemma: 'x', cleanTags: tags, upos: 'NOUN', pos: 'N', featsMap: {} });
assert.strictEqual(isDerivedReading(stub(['N', 'Der', 'Sg'])), true);
assert.strictEqual(isDerivedReading(stub(['Der/NomAct', 'N', 'Sg', 'Nom'])), true, 'Der first');
assert.strictEqual(isDerivedReading(stub(['N', 'Sg', 'Nom', 'Der/NIku'])), true, 'Der last');
assert.strictEqual(isDerivedReading(stub(['N', 'Sg', 'Derx'])), false, 'only Der or Der/...');
assert.strictEqual(isDerivedReading(stub(['N', 'Sg', 'Nom'])), false);
assert.strictEqual(isCompoundReading(stub(['Cmp', 'N'])), true);
assert.strictEqual(isCompoundReading(stub(['N', 'Sg', 'Cmp/SplitR'])), true, 'Cmp/... anywhere');
assert.strictEqual(isCompoundReading({ raw: 'ab#cd+N+Sg', lemma: 'abcd', upos: 'NOUN', featsMap: {} }), true, '# boundary');
assert.strictEqual(isCompoundReading(stub(['N', 'Sg'])), false);
assert.deepStrictEqual(readingTags({ raw: 'ab#cd+N+Sg', lemma: 'abcd' }), ['N', 'Sg'], 'tags from the raw string when no tag list is given');
console.log('✓ Der / Der/... and Cmp / Cmp/... found by tag, not by position');

// --- 3. Groups, default, explicit choice ----------------------------------------------------------
console.log('\n--- 3. Testing groups, default and an explicit choice ---');
const derOnly = summarizeReadings([R(OLD.derPx), R(NEW.derNo)], row);
assert.deepStrictEqual(derOnly.candidates.map((c) => c.group), ['other', 'other']);
assert(derOnly.candidates.every((c) => c.inDefault), 'with only derived readings they are the default');
const cmp = { raw: 'awa#tuka+N+Sg+Nom', lemma: 'awatuka', upos: 'NOUN', pos: 'N', featsMap: { Number: 'Sing' } };
const grouped = summarizeReadings([R(OLD.derPx), cmp, R(OLD.plain)], row);
assert.deepStrictEqual(grouped.candidates.map((c) => c.kind), ['plain', 'derived', 'compound'], 'plain first, then derived and compound');
assert.deepStrictEqual(grouped.candidates.filter((c) => c.inDefault).map((c) => c.kind), ['plain']);
assert.strictEqual(grouped.ambiguous, false, 'one plain reading: the default is clear');
assert(grouped.defaultReason.includes('plain readings'));
// explicit choice of a derived reading: everything from that one reading, not intersected
const chosen = summarizeReadings(mixed, row, R(NEW.derNo).raw);
assert.deepStrictEqual([chosen.lemma, chosen.upos, chosen.xpos], ['awa', 'NOUN', 'N']);
assert.strictEqual(chosen.feats.get('Possessed'), 'No', 'FEATS follow the chosen reading, not the shared ones');
assert.strictEqual(chosen.tagString, 'v1+V+Der+Der/NomAct+N+Msc+Sg+Nom+NPossd', 'full tag string, as emitted');
assert.strictEqual(chosen.choice, R(NEW.derNo).raw);
console.log('✓ Plain first and default; derived/compound below; explicit choice wins');

// --- 4/5. Service: XPOS style, no silent overwrite, Analysis= ---------------------------------------------
console.log('\n--- 4. Testing XPOS from the reading and the Analysis= option ---');
const t = '\t';
const FIXTURE = [
  '# sent_id = O-1', '# text = Awinhi.',
  ['1', 'awinhi', 'awinhi', 'NOUN', 'XPOS=comunidade.de', 'Case=Nom', '_', '_', '_', '_'].join(t),
  ['2', 'Amary', 'amary', 'NOUN', '_', '_', '_', '_', '_', '_'].join(t),
  '', ''
].join('\n');
await analyzerService.init('apu');
await dictionaryService.init();
const imp = await svc.importText(FIXTURE, 'order-fixture.conllu');
const id = imp.importId;
const parsed = parseConllu(FIXTURE);
const L = (n) => parsed.sentences[0].lines.findIndex((l) => l.cols && l.cols[0] === String(n));
const base = { srcLang: 'apu', columns: ['lemma', 'upos', 'xpos', 'feats'] };
const tf = (fields, form, col) => fields.find((f) => f.form === form && f.column === col);

// the real analyzer: ambiguous token, readings differ in lemma only for derived ones; plain pool agrees
let fields = svc.suggestEnhancements(id, 0, base);
const feats0 = tf(fields, 'awinhi', 'feats');
const cands = feats0.reading.candidates;
assert.strictEqual(cands.filter((c) => c.group === 'plain').length, 2, 'two plain readings of awinhi');
assert.deepStrictEqual(cands.map((c) => c.group), ['plain', 'plain', 'other', 'other', 'other'], 'plain group first');
assert(feats0.needsChoice, 'several plain readings: needs your choice');
assert.strictEqual(tf(fields, 'awinhi', 'xpos').to, 'N', 'default XPOS: short POS tag (both plain readings agree)');
// XPOS is not overwritten silently: the original has XPOS=comunidade.de
assert.strictEqual(tf(fields, 'awinhi', 'xpos').status, 'conflict');
let res = await svc.applyEnhancements(id, [tf(fields, 'awinhi', 'xpos')]);
assert.strictEqual(res.replaced + res.written, 0, 'no silent XPOS overwrite');
assert.strictEqual(svc.workingCols(id, 0, L(1))[4], 'XPOS=comunidade.de', 'original value still there');
assert.strictEqual(svc.diff(id, 0).changes.length, 0);

// choose a reading: everything from it; full XPOS style = tag string as emitted
const plainPx = cands.find((c) => c.group === 'plain' && c.feats.includes('Person[psor]=3'));
await svc.setReadingChoice(id, 0, L(1), plainPx.raw);
fields = svc.suggestEnhancements(id, 0, { ...base, xposStyle: 'full' });
assert.strictEqual(tf(fields, 'awinhi', 'xpos').to, plainPx.tagString, 'full XPOS = analyzer tag string, unchanged order');
assert(plainPx.raw.endsWith(plainPx.tagString), 'which is the raw analysis minus the lemma');
assert.strictEqual(tf(fields, 'awinhi', 'feats').to.includes('Person[psor]=3'), true);
fields = svc.suggestEnhancements(id, 0, { ...base, xposStyle: 'short' });
assert.strictEqual(tf(fields, 'awinhi', 'xpos').to, 'N');
// confirm per token with the original shown: from is the original value
assert.strictEqual(tf(fields, 'awinhi', 'xpos').from, 'XPOS=comunidade.de');
res = await svc.applyEnhancements(id, fields.filter((f) => f.form === 'awinhi').map((f) => ({ ...f, overwrite: true })));
assert(res.replaced >= 1);
assert.strictEqual(svc.workingCols(id, 0, L(1))[4], 'N');
assert(svc.workingCols(id, 0, L(1))[5].includes('Person[psor]=3'));
// explicit choice of a derived reading drives all four columns
const derNo = cands.find((c) => c.group === 'other' && c.feats.includes('Possessed=No'));
await svc.setReadingChoice(id, 0, L(1), derNo.raw);
fields = svc.suggestEnhancements(id, 0, base);
assert.strictEqual(tf(fields, 'awinhi', 'lemma').to, 'awa');
assert.strictEqual(tf(fields, 'awinhi', 'feats').reading.choice, derNo.raw);
assert(!tf(fields, 'awinhi', 'feats').needsChoice);

// Analysis=: off by default, on: only where the values come from the chosen reading
await svc.setReadingChoice(id, 0, L(1), plainPx.raw);
fields = svc.suggestEnhancements(id, 0, base);
await svc.applyEnhancements(id, fields.filter((f) => f.form === 'awinhi').map((f) => ({ ...f, overwrite: true })));
const noOpt = svc.exportText(id);
assert(!noOpt.includes('Analysis='), 'off by default');
assert.strictEqual(svc.exportOptions(id).recordAnalysis, false);
await svc.setExportOption(id, 'recordAnalysis', true);
const withOpt = parseConllu(svc.exportText(id));
assert.strictEqual(withOpt.sentences[0].lines[L(1)].cols[9], `Analysis=${plainPx.raw}`, 'the chosen analysis string, as emitted');
assert.strictEqual(withOpt.sentences[0].lines[L(2)].cols[9], '_', 'other tokens untouched');
await svc.setReadingChoice(id, 0, L(1), derNo.raw); // choice changed, values not yet re-applied from it
assert(!svc.exportText(id).includes('Analysis='), 'no claim about a reading the values do not come from');
await svc.setExportOption(id, 'recordAnalysis', false);
await svc.revertAll(id);
assert.strictEqual(svc.exportText(id), FIXTURE);
await rejectsOption();
async function rejectsOption() { await assert.rejects(() => svc.setExportOption(id, 'nope', true), /Unknown export option/); }
await svc.removeImport(id);
console.log('✓ XPOS short / full from the reading; no silent overwrite; Analysis= only on request');

// --- 6. Analyzer info ------------------------------------------------------------------------------------
console.log('\n--- 5. Testing which analyzer build is shown ---');
const info = await svc.analyzerInfo('apu');
assert.strictEqual(info.id, 'analyser-apu');
assert(info.name.includes('analyser-apu.hfstol'), `name shows the model file: ${info.name}`);
assert(info.origin.includes('packaged file'), 'origin says it is the packaged file');
assert.strictEqual(await svc.analyzerInfo('zzz'), null);
assert.strictEqual(await svc.prepareLanguage('zzz'), false);
console.log('✓ The analyzer behind the readings is named');

console.log('\nAll reading order tests passed.');
