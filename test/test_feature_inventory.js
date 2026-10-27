/**
 * Test Suite: language-aware Feature=Value inventory for CoNLL-U enhancement
 * Verifies:
 * 1. Layers: used-in-file, language, universal, shared (Uralic), other languages, new.
 * 2. A shared pair is accepted for the languages that have it and recognised (not flagged new) for others;
 *    a language-specific pair belongs to its language only; an unknown pair is flagged new.
 * 3. The enhancement marks proposals with new pairs, skips them unless confirmed, and applies them when confirmed.
 * 4. FEATS stay sorted the UD way (case-insensitive; Number before NumType, Gender before Gender[obj]).
 * 5. docfeats.json can be merged in; language codes resolve (fi -> fin); the bundled inventory has the expected shape.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { FeatureInventory, UNIVERSAL_FEATURES, usageOfFile } from '../js/services/ud-feature-inventory.js';
import { mergeFeats, parseFeats, featsToString } from '../js/services/conllu-enhance.js';
import { parseConllu } from '../js/services/conllu-parser.js';
import { conlluImportService as svc } from '../js/services/conllu-import-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';

console.log('=== Running Tests for the Language-Aware Feature Inventory ===\n');

// Small synthetic inventory (same shape as data/ud-feature-inventory.json)
const lang = (feats, extra = {}) => ({ treebanks: ['T'], tokens: 100, feats, upos: { NOUN: 5, VERB: 3 }, deprel: { nsubj: 4, 'obl:tmod': 1 }, ...extra });
const SYNTH = {
  meta: { sources: [] },
  languages: {
    myv: lang({ Case: { Nom: 9, Ine: 3 }, 'Person[psor]': { 1: 2, 3: 4 }, Possessed: { Yes: 2, No: 5 } }),
    mdf: lang({ Case: { Nom: 9 }, 'Person[psor]': { 3: 4 }, Possessed: { No: 5 } }),
    sms: lang({ Case: { Nom: 1 }, 'Number[psor]': { Sing: 2 }, Foo: { Bar: 1 } }),
    deu: lang({ Gender: { Masc: 2 }, Aux: { Mod: 1 } }) // not Uralic
  }
};
const inv = new FeatureInventory(SYNTH);

// --- 1. Layers -----------------------------------------------------------------------------
console.log('--- 1. Testing layers ---');
const layer = (pair, opts) => inv.classify('feats', pair, opts).layer;
assert.strictEqual(layer('Case=Nom', { lang: 'myv' }), 'language', 'In the language\'s own inventory');
assert.strictEqual(layer('Case=Acc', { lang: 'myv' }), 'universal', 'Universal pair accepted although the language has not used it yet');
assert.strictEqual(layer('Case=Acc', { lang: 'zzz' }), 'universal', 'Universal for any language, even one without data');
assert.strictEqual(layer('Person[psor]=3', { lang: 'myv' }), 'language');
assert.strictEqual(layer('Person[psor]=3', { lang: 'mdf' }), 'language');
assert.strictEqual(layer('Person[psor]=3', { lang: 'sms' }), 'uralic', 'Shared with other Uralic languages');
assert.deepStrictEqual(inv.classify('feats', 'Person[psor]=3', { lang: 'sms' }).languages, ['mdf', 'myv']);
assert.strictEqual(layer('Person[psor]=3', { lang: null }), 'other', 'No language: other languages\' usage still counts (two languages: not yet widespread)');
assert.strictEqual(layer('Aux=Mod', { lang: 'myv' }), 'other', 'Only a non-Uralic language has it');
assert.strictEqual(layer('Person[psor]=3', { lang: 'deu' }), 'other', 'A non-Uralic language never gets the Uralic layer');
assert.strictEqual(layer('Person[psor]=3', { lang: 'xxx', file: new Set(['Person[psor]=3']) }), 'file', 'Used in the imported file itself');
console.log('✓ file / language / universal / uralic / other layers');

// --- 2. Shared, language-specific, unknown ---------------------------------------------------
console.log('\n--- 2. Testing shared, language-specific and unknown pairs ---');
for (const code of ['myv', 'mdf']) assert.strictEqual(layer('Possessed=No', { lang: code }), 'language', `Shared pair accepted for ${code}`);
assert.strictEqual(layer('Foo=Bar', { lang: 'sms' }), 'language', 'Language-specific pair accepted for its language');
assert.strictEqual(layer('Foo=Bar', { lang: 'myv' }), 'uralic', 'but for another language it is only known elsewhere, not its own');
assert.notStrictEqual(layer('Foo=Bar', { lang: 'myv' }), 'language');
assert.strictEqual(layer('Evidentiality=Zzz', { lang: 'myv' }), 'new', 'Unknown pair is flagged new');
assert.strictEqual(layer('Person[psor]=9', { lang: 'myv' }), 'new', 'Known key with an unknown value is new');
assert.strictEqual(layer('Gender[obj]=Masc', { lang: 'myv' }), 'new', 'Layered keys are never universal');
assert(inv.sharedPairs(2).includes('Person[psor]=3') && !inv.sharedPairs(2).includes('Foo=Bar'), 'Shared set = used by two or more languages');
assert.strictEqual(inv.classify('upos', 'NOUN', { lang: 'myv' }).layer, 'language');
assert.strictEqual(inv.classify('upos', 'PROPN', { lang: 'myv' }).layer, 'universal');
assert.strictEqual(inv.classify('upos', 'FOO', { lang: 'myv' }).layer, 'new');
assert.strictEqual(inv.classify('deprel', 'obl:tmod', { lang: 'myv' }).layer, 'language');
assert.strictEqual(inv.classify('deprel', 'nmod', { lang: 'myv' }).layer, 'universal');
assert.strictEqual(inv.classify('deprel', 'obl:zzz', { lang: 'myv' }).layer, 'new');
const multi = inv.classifyFeats('Case=Nom|Number[psor]=Sing,Plur|Foo=Zzz', { lang: 'myv' });
assert.deepStrictEqual(multi.map((m) => [m.item, m.layer]), [['Case=Nom', 'language'], ['Number[psor]=Sing,Plur', 'new'], ['Foo=Zzz', 'new']], 'Multi-values are checked one by one; weakest layer wins');
assert.strictEqual(new FeatureInventory().classify('feats', 'Possessed=No', { lang: 'myv' }).layer, 'unchecked', 'Without an inventory nothing is flagged');
console.log('✓ Shared pair for two languages, language-specific pair for its language only, unknown pair is new');

// non-Uralic languages: the shared layer is the all-languages one, the Uralic layer stays Uralic only
const wide = new FeatureInventory({
  languages: {
    myv: lang({ 'Person[psor]': { 3: 1 }, Foo: { Bar: 1 } }), sms: lang({ 'Person[psor]': { 3: 1 } }), fin: lang({ 'Person[psor]': { 3: 1 } }),
    ceb: lang({ Case: { Nom: 1 }, 'Person[psor]': { 3: 1 }, Clitic: { Na: 1 } }), myu: lang({ Evident: { Zzz: 1 } })
  }
});
const wl = (pair, l) => wide.classify('feats', pair, { lang: l }).layer;
assert.strictEqual(wl('Person[psor]=3', 'mdf'), 'uralic', 'Uralic language: shared with other Uralic languages');
assert.strictEqual(wl('Person[psor]=3', 'myu'), 'widespread', 'Non-Uralic language: found in 4 other languages = widespread, not "Uralic"');
assert.strictEqual(wl('Foo=Bar', 'myu'), 'other', 'Found in one language only: other');
assert.strictEqual(wl('Clitic=Na', 'ceb'), 'language', 'Own layer of a non-Uralic language');
assert.strictEqual(wl('Clitic=Na', 'myv'), 'other', 'and only "other" for a Uralic language');
assert.strictEqual(wl('Person[psor]=3', 'xyz'), 'widespread', 'Unknown language code uses the all-languages layer');
assert.strictEqual(wl('Zzz=Yyy', 'ceb'), 'new');
assert.strictEqual(wide.languageName('xyz'), 'xyz', 'Names fall back to the code');
assert(new FeatureInventory().languageName('ceb') === 'Cebuano' && new FeatureInventory().languageName('bgs') === 'Tagabawa');
console.log('✓ Non-Uralic languages use the all-languages layer; the Uralic layer stays Uralic only');

// language codes, docfeats
assert.strictEqual(inv.resolveLanguage('myv'), 'myv');
assert.strictEqual(new FeatureInventory({ languages: { fin: lang({}) } }).resolveLanguage('fi'), 'fin', '2-letter code resolves');
assert.strictEqual(inv.resolveLanguage('apu'), null, 'No treebank for Apurinã');
const added = inv.addDocfeats({ lists: { apu: ['Gender[obj]=Masc', 'Possessed=Yes'], fi: ['Case=Ela'] } });
assert.deepStrictEqual(added, { languages: 2, pairs: 3 });
assert.strictEqual(layer('Gender[obj]=Masc', { lang: 'apu' }), 'language', 'A loaded docfeats.json becomes that language\'s layer');
assert.strictEqual(inv.resolveLanguage('apu'), 'apu');
assert.throws(() => inv.addDocfeats({ nope: 1 }), /docfeats/);
assert.throws(() => new FeatureInventory().setData({}), /inventory/);
console.log('✓ docfeats.json merges; codes resolve');

// --- 3. Sorting -------------------------------------------------------------------------------
console.log('\n--- 3. Testing UD sort order ---');
assert.strictEqual(mergeFeats('Case=Nom', parseFeats('NumType=Card|Number=Sing')).merged, 'Case=Nom|Number=Sing|NumType=Card', 'Number before NumType');
assert.strictEqual(featsToString(parseFeats('Person[obj]=3|Gender[psor]=Masc|Gender=Fem|Gender[obj]=Masc|Mood=Ind')),
  'Gender=Fem|Gender[obj]=Masc|Gender[psor]=Masc|Mood=Ind|Person[obj]=3', 'Layered keys follow their base key, case-insensitively');
console.log('✓ FEATS sorted case-insensitively with layered keys');

// --- 4. Enhancement flags and confirms new pairs --------------------------------------------------
console.log('\n--- 4. Testing new-pair confirmation in the enhancement ---');
const row = (...c) => c.join('\t');
const FIXTURE = [
  '# sent_id = N-1', '# text = Amary akyru.',
  row('1', 'Amary', 'amary', 'NOUN', 'N', '_', '_', '_', '_', '_'),
  row('2', 'akyru', 'akyru', 'NOUN', 'N', 'Possessed=Yes', '_', '_', '_', '_'),
  '', ''
].join('\n');
await analyzerService.init('apu');
await dictionaryService.init();
const keep = svc.inventory;
const withInv = new FeatureInventory(SYNTH);
svc.inventory = withInv;
const imp = await svc.importText(FIXTURE, 'inventory-fixture.conllu');
const id = imp.importId;
const featsField = (fields, form) => fields.find((f) => f.form === form && f.column === 'feats');

let fields = svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ['feats'], inventoryLang: 'myv' });
let amary = featsField(fields, 'Amary');
assert.strictEqual(amary.to, 'Case=Nom|Gender=Masc|Number=Sing|Possessed=No');
assert.strictEqual(amary.needsConfirm, false, 'For Erzya every proposed pair is known (universal or in the inventory)');
assert.deepStrictEqual(amary.pairs.map((p) => p.layer).sort(), ['language', 'language', 'universal', 'universal']);

fields = svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ['feats'], inventoryLang: 'sms' });
amary = featsField(fields, 'Amary');
assert.strictEqual(amary.needsConfirm, false);
assert.strictEqual(amary.pairs.find((p) => p.item === 'Possessed=No').layer, 'uralic', 'For Skolt Sami Possessed is only known from other Uralic languages');

fields = svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ['feats'] }); // Apurinã: no inventory data, file uses Possessed=Yes only
assert.strictEqual(svc.inventoryLanguage('apu', 'auto'), null);
amary = featsField(fields, 'Amary');
assert.strictEqual(amary.pairs.find((p) => p.item === 'Possessed=No').layer, 'other', 'Without a layer of its own a non-Uralic language sees pairs of other languages as "other", never as "Uralic"');
assert.strictEqual(amary.needsConfirm, false);

// a pair unknown everywhere
const strict = new FeatureInventory({ languages: { myv: lang({ Case: { Nom: 1 } }) } });
svc.inventory = strict;
fields = svc.suggestEnhancements(id, null, { srcLang: 'apu', columns: ['feats'], inventoryLang: 'myv' });
amary = featsField(fields, 'Amary');
assert.strictEqual(amary.needsConfirm, true, 'Possessed=No is in no layer');
assert.deepStrictEqual(amary.newPairs, ['Possessed=No']);
assert.strictEqual(amary.status, 'fill', 'Still a fill of an empty cell, but flagged');
const akyru = featsField(fields, 'akyru'); // already has Possessed=Yes in this file: that pair is the file's own
assert(akyru.pairs.every((p) => p.item !== 'Possessed=Yes'), 'Only added pairs are validated');

let res = await svc.applyEnhancements(id, [amary]);
assert.strictEqual(res.unconfirmed, 1, 'Unconfirmed new pair is not applied');
assert.strictEqual(res.written, 0);
assert.strictEqual(svc.exportText(id), FIXTURE, 'Nothing written without confirmation');
res = await svc.applyEnhancements(id, [{ ...amary, confirmNew: true }]);
assert.strictEqual(res.written, 1, 'Applied once the user confirmed');
assert(svc.exportText(id).includes('\tCase=Nom|Gender=Masc|Number=Sing|Possessed=No\t'));
await svc.revertAll(id);

// usage of the file itself becomes its own layer
const usage = usageOfFile(parseConllu(FIXTURE));
assert(usage.feats.has('Possessed=Yes') && usage.upos.has('NOUN'));
svc.inventory = withInv;
assert.strictEqual(svc.inventoryLanguage('apu', 'none'), null, '"none" = only the file\'s own layer');
await svc.removeImport(id);
svc.inventory = keep;
console.log('✓ New pairs are flagged, skipped until confirmed, then applied; added pairs only are validated');

// --- 5. Bundled inventory (generated by scripts/build-feature-inventory.mjs) ---------------------------
console.log('\n--- 5. Testing the bundled inventory file (if present) ---');
const file = new URL('../data/ud-feature-inventory.json', import.meta.url);
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8');
  const bundled = new FeatureInventory(raw);
  assert(bundled.languageCodes().length >= 10, 'Several languages');
  assert(!/sent_id|# text/.test(raw), 'Names and counts only: no sentence markup');
  assert.strictEqual(bundled.classify('feats', 'Person[psor]=3', { lang: 'sms' }).layer, 'language');
  assert.strictEqual(bundled.classify('feats', 'Person[psor]=3', { lang: 'zzz' }).layer, 'widespread', 'Person[psor] is used by many languages');
  assert.strictEqual(bundled.classify('feats', 'Number[subj]=Plur', { lang: 'zzz' }).layer === 'other' || bundled.classify('feats', 'Number[subj]=Plur', { lang: 'zzz' }).layer === 'widespread', true);
  assert(bundled.sharedPairs(2).includes('Person[psor]=3'));
  // Apurinã has its own layer, on top of the shared Uralic one
  assert.strictEqual(bundled.resolveLanguage('apu'), 'apu');
  assert.strictEqual(bundled.classify('feats', 'Gender[obj]=Masc', { lang: 'apu' }).layer, 'language', 'Apurinã layered pair accepted for Apurinã');
  assert.strictEqual(bundled.classify('feats', 'Gender[obj]=Masc', { lang: 'myv' }).layer, 'other', 'but not part of Erzya\'s own layer');
  // the five non-Uralic treebanks added later
  for (const [code, tb] of [['ceb', 'UD_Cebuano-GJA'], ['myu', 'UD_Munduruku-TuDeT'], ['mpu', 'UD_Makurap-TuDeT'], ['pad', 'UD_Paumari-TueCL'], ['bgs', 'UD_Tagabawa-GJA']]) {
    assert.strictEqual(bundled.resolveLanguage(code), code, `${code} layer present`);
    assert.deepStrictEqual(bundled.languages[code].treebanks, [tb]);
    assert(bundled.languages[code].upos.size > 5 && bundled.languages[code].deprel.size > 5);
    assert.notStrictEqual(bundled.classify('feats', 'Person[psor]=3', { lang: code }).layer, 'uralic', `${code} never gets the Uralic layer`);
  }
  assert.strictEqual(bundled.classify('feats', 'Person[psor]=3', { lang: 'apu' }).layer, 'language');
  assert.strictEqual(bundled.classify('deprel', 'obj:agent', { lang: 'apu' }).layer, 'language');
  assert.strictEqual(bundled.classify('feats', 'Evident=Zzz', { lang: 'apu' }).layer, 'new');
  assert.strictEqual(svc.inventoryLanguage('apu', 'auto') === null || bundled.resolveLanguage('apu') === 'apu', true);
  assert.strictEqual(bundled.classifyMiscKey('SpaceAfter', 'apu'), 'ud');
  for (const key of ['CGdeprel', 'CGdephead', 'GTtags', 'gloss[pt]', 'gloss_pt']) assert.strictEqual(bundled.classifyMiscKey(key, 'apu'), 'seen', `${key} is seen in the Apurinã file, not UD-valid`);
  assert.strictEqual(bundled.classifyMiscKey('Foo', 'apu'), 'unknown');
  assert(!bundled.nonStandardMiscKeys('apu').includes('SpaceAfter'));
  assert.strictEqual(bundled.classify('feats', 'Zzz=Qqq', { lang: 'myv' }).layer, 'new');
  assert(Object.keys(UNIVERSAL_FEATURES).includes('Number'));
  // licenses: no non-commercial treebank is bundled; EWT is CC BY-SA 4.0 per its LICENSE.txt
  const meta = JSON.parse(raw).meta;
  assert(!meta.sources.some((x) => /^UD_(Estonian-EDT|Hungarian)/.test(x.treebank)), 'Non-commercial treebanks are left out');
  assert(!/UD_Estonian-EDT|UD_Hungarian/.test(raw), 'No trace of them in the inventory');
  assert(!/not-to-release/.test(raw), 'Nothing from not-to-release folders');
  const tagabawa = meta.sources.find((x) => x.treebank === 'UD_Tagabawa-GJA');
  assert.strictEqual(tagabawa.readFromBranch, 'origin/dev', 'Tagabawa data comes from the dev branch (read-only)');
  assert.strictEqual(tagabawa.license, 'CC BY-SA 4.0');
  assert.strictEqual(bundled.resolveLanguage('hun'), null, 'No Hungarian layer is bundled');
  const ewt = meta.sources.find((x) => x.treebank === 'UD_Estonian-EWT');
  assert.strictEqual(ewt.license, 'CC BY-SA 4.0', 'EWT license comes from LICENSE.txt, not the stale README header');
  assert.strictEqual(ewt.licenseSource, 'LICENSE.txt');
  assert(meta.sources.every((x) => x.license), 'Every source has a recorded license');
  const nc = meta.sources.filter((x) => /-NC-/i.test(x.license)).map((x) => x.treebank);
  assert.deepStrictEqual(nc, [], 'No source carries a non-commercial license');
  assert.deepStrictEqual(meta.nonCommercial, [], 'meta.nonCommercial is empty');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert(!/Hungarian|Szeged|Estonian-EDT/.test(readme.slice(readme.indexOf('## Feature inventory data'), readme.indexOf('## Testing'))), 'README does not list excluded treebanks as part of the inventory');
  const script = fs.readFileSync(new URL('../scripts/build-feature-inventory.mjs', import.meta.url), 'utf8');
  assert(/excludeArg = args\['exclude-licenses'\] \|\| '-NC-'/.test(script), 'Build script skips non-commercial licenses by default');
  assert(!/Hungarian-Szeged|Estonian-EDT/.test(script), 'Build script does not list excluded treebanks');
  // no community language data: no word form of the Apurinã file may appear in the inventory
  const apu = `${process.env.HOME}/Desktop/Github/ud/UD_Apurina-UFPA/apu_ufpa-ud-test.conllu`;
  if (fs.existsSync(apu)) {
    const forms = new Set();
    for (const line of fs.readFileSync(apu, 'utf8').split('\n')) {
      const c = line.split('\t');
      if (c.length === 10 && /^\d+$/.test(c[0])) { forms.add(c[1]); forms.add(c[2]); for (const g of c[9].split('|')) if (g.startsWith('gloss')) forms.add(g.split('=')[1]); }
    }
    const leaked = [...forms].filter((f) => f && f.length >= 3 && raw.includes(`"${f}"`));
    assert.deepStrictEqual(leaked, [], 'No word form, lemma or gloss of the Apurinã file in the inventory');
  }
  console.log(`✓ Bundled inventory: ${bundled.languageCodes().length} languages, ${bundled.sharedPairs(2).length} pairs shared by two or more`);
} else {
  console.log('(skipped: data/ud-feature-inventory.json not present; run scripts/build-feature-inventory.mjs)');
}

console.log('\nAll feature inventory tests passed.');
