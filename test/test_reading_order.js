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
 * 5. GiellaLT variant tags (v1..v25) rank readings without filtering them or making the default ambiguous.
 * 6. GTtags=<tags> (the analyzer's tag readout, comma-separated) is only proposed when the option is on, for a single
 *    reading, and an existing different GTtags is never replaced without confirmation; the old option name still works.
 * 7. Which analyzer build produced the readings can be shown.
 */

import assert from 'node:assert';
import { TagMapper } from '../js/services/tag-mapper.js';
import {
  summarizeReadings, isDerivedReading, isCompoundReading, readingKey, readingTags, gtTagsOf, readingVariant
} from '../js/services/conllu-enhance.js';
import { storageService } from '../js/services/storage-service.js';
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

// --- 3b. Variants ------------------------------------------------------------------------------------
console.log('\n--- 3b. Testing GiellaLT variant tags ---');
const v = (n, rest = 'N+Msc+Sg+Nom', lemma = 'awinhitxi') => R(`${lemma}${n ? `+v${n}` : ''}+${rest}`);
assert.strictEqual(readingVariant(v(2)), 2);
assert.strictEqual(readingVariant(v(null)), null);
// v1 before v2, a reading without a v-tag counts as v1, whatever the input order
const v1v2 = summarizeReadings([v(2), v(1)], row);
assert.deepStrictEqual(v1v2.candidates.map((c) => c.variant), [1, 2], 'v1 before v2');
assert.deepStrictEqual(summarizeReadings([v(1), v(2)], row).candidates.map((c) => c.variant), [1, 2]);
assert.deepStrictEqual(summarizeReadings([v(2), v(null)], row).candidates.map((c) => c.variant), [null, 2], 'no v-tag counts as v1: before v2');
assert.deepStrictEqual(summarizeReadings([v(null), v(2)], row).candidates.map((c) => c.variant), [null, 2]);
assert.deepStrictEqual(summarizeReadings([v(1), v(null)], row).candidates.map((c) => c.variant), [1, null], 'tie: the analyzer\'s order');
assert.deepStrictEqual(summarizeReadings([v(10), v(2)], row).candidates.map((c) => c.variant), [2, 10], 'numeric, not alphabetical');
// all variants stay selectable and in the default pool; they do not make the token ambiguous
assert.strictEqual(v1v2.candidates.length, 2, 'variants are not filtered out');
assert.strictEqual(v1v2.ambiguous, false, 'readings that differ only in the variant: no "needs your choice"');
assert.strictEqual(v1v2.readings, 1);
assert.strictEqual(v1v2.candidates[0].tagString.startsWith('v1+'), true);
assert.strictEqual(summarizeReadings([v(2), v(1)], row).tagString, 'v1+N+Msc+Sg+Nom', 'the default is the v1 reading');
assert.strictEqual(summarizeReadings([v(3), v(2), v(null)], row).tagString, 'N+Msc+Sg+Nom', 'a reading with no v-tag is the default over v2 and v3');
assert(v1v2.candidates.every((c) => c.inDefault));
assert.strictEqual(summarizeReadings([v(2), v(1)], row, v(2).raw).tagString, 'v2+N+Msc+Sg+Nom', 'a variant can be chosen explicitly');
// but a real difference besides the variant is ambiguous
const px = v(1, 'N+Msc+Sg+PxSg3M+Nom');
assert.strictEqual(summarizeReadings([v(1), px, v(2)], row).ambiguous, true);
// variants of one plain reading plus different derived ones: still unambiguous, derived stay below
const mixedV = summarizeReadings([R(OLD.derPx), v(2), v(1)], row);
assert.deepStrictEqual(mixedV.candidates.map((c) => c.kind), ['plain', 'plain', 'derived']);
assert.strictEqual(mixedV.ambiguous, false);
// variant ordering inside the derived group, and as the default when only derived readings exist
const d2 = R('awa+v2+V+Der+Der/NomAct+N+Msc+Sg+Nom');
const d1 = R('awa+v1+V+Der+Der/NomAct+N+Msc+Sg+Nom');
assert.deepStrictEqual(summarizeReadings([d2, d1], row).candidates.map((c) => c.variant), [1, 2]);
assert.strictEqual(summarizeReadings([d2, d1], row).ambiguous, false);
// FEATS: v-tags add none, so variants give identical features
assert.deepStrictEqual(v(1).featsMap, v(null).featsMap);
// full-tag XPOS agreement ignores the variant
assert.strictEqual(v1v2.agree.tagString, true);
console.log('✓ v1 first, no v-tag = v1, all variants selectable, variants alone are no ambiguity');

// --- 4/5. Service: XPOS style, no silent overwrite, GTtags -----------------------------------------------------
console.log('\n--- 4. Testing XPOS from the reading ---');
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

await svc.revertAll(id);
assert.strictEqual(svc.exportText(id), FIXTURE);
await assert.rejects(() => svc.setExportOption(id, 'nope', true), /Unknown export option/);
await svc.removeImport(id);
console.log('✓ XPOS short / full from the reading; no silent overwrite');

// --- 5b. GTtags ---------------------------------------------------------------------------------------------
console.log('\n--- 5. Testing GTtags (the analyzer\'s tag readout) in MISC ---');
// the convention of the Apurinã file: tags after the lemma except the POS tag, comma-separated, analyzer order
assert.strictEqual(gtTagsOf(R('ywa+Pron+Pers+Sg3+Msc+Nom')), 'Pers,Sg3,Msc,Nom');
assert.strictEqual(gtTagsOf(R('iãkyny+N+Msc+Sg+PxSg3M+Com')), 'Msc,Sg,PxSg3M,Com');
assert.strictEqual(gtTagsOf(R('apuka+V+Pred+ScSg3M+Oc3M')), 'Pred,ScSg3M,Oc3M');
assert.strictEqual(gtTagsOf(R(OLD.derPx)), 'v1,V,Der,Der/NomAct,Msc,Sg,PxSg3M,Possd,Nom', 'variant first, derivation history kept, the final POS tag N left out');
assert.strictEqual(gtTagsOf(R(NEW.derPx)), 'v1,V,Der,Der/NomAct,Msc,Sg,Nom,Possd,PxSg3M', 'exactly the analyzer\'s order, not sorted');
assert.strictEqual(gtTagsOf(R(NEW.plainPx)), 'Msc,Sg,Nom,Possd,PxSg3M');
assert.strictEqual(summarizeReadings([R(OLD.plain)], row).gtTags, 'Msc,Sg,Possd,Nom');
assert.strictEqual(summarizeReadings([v(2), v(1)], row).gtTags, 'v1,Msc,Sg,Nom', 'default reading: the variant tag is included');

const GT = [
  '# sent_id = G-1', '# text = Awinhi Amary akyru.',
  ['1', 'awinhi', 'awinhi', 'NOUN', '_', '_', '_', '_', '_', '_'].join(t),
  ['2', 'Amary', 'amary', 'NOUN', '_', '_', '_', '_', '_', 'GTtags=Msc,Sg,Nom'].join(t),
  ['3', 'akyru', 'akyru', 'NOUN', '_', '_', '_', '_', '_', 'GTtags=Old,Readout|SpaceAfter=No'].join(t),
  ['4', 'Aiku', 'aiku', 'NOUN', '_', '_', '_', '_', '_', 'GTtags=Fem,Sg,PxSg3M,Nom'].join(t),
  '', ''
].join('\n');
const impG = await svc.importText(GT, 'gt-fixture.conllu');
const gid = impG.importId;
const gparsed = parseConllu(GT);
const GL = (n) => gparsed.sentences[0].lines.findIndex((l) => l.cols && l.cols[0] === String(n));
const gopts = { srcLang: 'apu', columns: ['misc'] };
const gt = (fields, form) => fields.find((f) => f.form === form && f.column === 'misc' && f.key === 'GTtags');

// off by default: no GTtags proposals at all, and the existing ones are left alone
let gf = svc.suggestEnhancements(gid, 0, gopts);
assert.strictEqual(svc.exportOptions(gid).recordTags, false, 'off by default');
assert.strictEqual(gf.filter((f) => f.key === 'GTtags').length, 0);
assert.strictEqual(svc.exportText(gid), GT);

await svc.setExportOption(gid, 'recordTags', true);
gf = svc.suggestEnhancements(gid, 0, gopts);
assert.strictEqual(gt(gf, 'awinhi'), undefined, 'awinhi has two plain readings and none is chosen: no GTtags guessed');
// choose a reading: GTtags of exactly that reading
const awCands = svc.suggestEnhancements(gid, 0, { srcLang: 'apu', columns: ['feats'] }).find((f) => f.form === 'awinhi').reading.candidates;
const pick = awCands.find((c) => c.group === 'plain' && c.feats.includes('Person[psor]=3'));
await svc.setReadingChoice(gid, 0, GL(1), pick.raw);
gf = svc.suggestEnhancements(gid, 0, gopts);
assert.strictEqual(gt(gf, 'akyru'), undefined, 'akyru is ambiguous too: no GTtags until a reading is chosen');
const akCands = svc.suggestEnhancements(gid, 0, { srcLang: 'apu', columns: ['feats'] }).find((f) => f.form === 'akyru').reading.candidates;
await svc.setReadingChoice(gid, 0, GL(3), akCands[0].raw);
gf = svc.suggestEnhancements(gid, 0, gopts);
const g1 = gt(gf, 'awinhi');
assert.deepStrictEqual([g1.from, g1.to, g1.status], [null, pick.gtTags, 'fill'], 'empty: can be filled');
assert.strictEqual(pick.gtTags, 'Msc,Sg,PxSg3M,Possd,Nom');
// no silent overwrite of an existing different GTtags; equal is "same"; untouched rows stay as they are
const g3 = gt(gf, 'akyru');
assert.strictEqual(g3.status, 'conflict');
assert.strictEqual(g3.from, 'Old,Readout', 'the original value is shown');
assert(g3.to.length > 0 && g3.to !== g3.from);
assert.strictEqual(gt(gf, 'Amary').status, 'conflict', 'Amary\'s single reading differs from the stored GTtags: shown, not applied');
assert.strictEqual(gt(gf, 'Amary').from, 'Msc,Sg,Nom');
let r = await svc.applyEnhancements(gid, gf.filter((f) => f.key === 'GTtags'));
assert.strictEqual(r.replaced, 0, 'nothing non-empty was replaced');
assert.strictEqual(svc.workingCols(gid, 0, GL(3))[9], 'GTtags=Old,Readout|SpaceAfter=No', 'existing GTtags of akyru untouched');
assert.strictEqual(svc.workingCols(gid, 0, GL(4))[9], 'GTtags=Fem,Sg,PxSg3M,Nom', 'rows never touched stay as they are');
assert.strictEqual(svc.workingCols(gid, 0, GL(1))[9], `GTtags=${pick.gtTags}`, 'the empty one was filled');
assert.strictEqual(svc.provenance(gid, 0, GL(1))['misc:GTtags'].source, 'analyzer');
assert.strictEqual(svc.provenance(gid, 0, GL(1))['misc:GTtags'].detail, pick.raw, 'provenance names the reading');
// with confirmation the old value is replaced, keeping the other MISC keys
r = await svc.applyEnhancements(gid, [{ ...g3, overwrite: true }]);
assert.strictEqual(r.replaced, 1);
assert(svc.workingCols(gid, 0, GL(3))[9].endsWith('|SpaceAfter=No') && svc.workingCols(gid, 0, GL(3))[9].startsWith('GTtags='));
await svc.revertAll(gid);
assert.strictEqual(svc.exportText(gid), GT);
await svc.setExportOption(gid, 'recordTags', false);
await svc.removeImport(gid);

// the old option name keeps working: a saved working copy with recordAnalysis reads as recordTags
const impL = await svc.importText(GT.replace('G-1', 'G-legacy'), 'legacy.conllu');
await storageService.saveConlluWorking({ importId: impL.importId, overrides: {}, exportName: 'x.conllu', exportOptions: { recordAnalysis: true } });
await svc.init();
assert.strictEqual(svc.exportOptions(impL.importId).recordTags, true, 'old saved recordAnalysis value is read as recordTags');
assert.strictEqual('recordAnalysis' in svc.exportOptions(impL.importId), false);
await svc.setExportOption(impL.importId, 'recordAnalysis', false);
assert.strictEqual(svc.exportOptions(impL.importId).recordTags, false, 'the old name still sets the option');
await svc.removeImport(impL.importId);
console.log('✓ GTtags format; filled when empty; never overwrites a different value without confirmation; old option name read');

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
