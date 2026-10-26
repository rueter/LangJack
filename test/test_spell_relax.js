import assert from 'node:assert';
import { SpellRelaxService, SPELL_RELAX_RULES } from '../js/services/spell-relax-service.js';
import { TagMapper } from '../js/services/tag-mapper.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { InterlinearExporter } from '../js/services/interlinear-exporter.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';

console.log('=== Running Spell Relax and +SplRlx Tests ===\n');

// =========================================================================
// 1. Language Rules and toCanonical Normalization
// =========================================================================
console.log('--- 1. Testing SpellRelaxService Language Rules and Normalization ---');

assert(SPELL_RELAX_RULES.vro, 'Võro rules must exist');
assert(SPELL_RELAX_RULES.sme, 'North Saami rules must exist');
assert(SPELL_RELAX_RULES.smn, 'Inari Saami rules must exist');
assert(SPELL_RELAX_RULES.sms, 'Skolt Saami rules must exist');
assert(SPELL_RELAX_RULES.liv, 'Livonian rules must exist');
assert(SPELL_RELAX_RULES.kpv, 'Komi-Zyrian rules must exist');

// Võro tests
assert.strictEqual(SpellRelaxService.toCanonical("kiil'", 'vro'), 'kiiĺ');
assert.strictEqual(SpellRelaxService.toCanonical('kiil’', 'vro'), 'kiiĺ');
assert.strictEqual(SpellRelaxService.toCanonical('kiilʼ', 'vro'), 'kiiĺ');
assert.strictEqual(SpellRelaxService.toCanonical('kiil´', 'vro'), 'kiiĺ');
assert.strictEqual(SpellRelaxService.toCanonical("suur'", 'vro'), 'suuŕ');
assert.strictEqual(SpellRelaxService.toCanonical("kass'", 'vro'), 'kasś');
assert.strictEqual(SpellRelaxService.toCanonical("pall'", 'vro'), 'palĺ');

// Saami & Komi tests
assert.strictEqual(SpellRelaxService.toCanonical("c'albme", 'sme'), 'čalbme');
assert.strictEqual(SpellRelaxService.toCanonical('o"v', 'kpv'), 'ӧv');
console.log('✓ SpellRelaxService rules correctly normalize relaxed inputs to canonical forms');

// =========================================================================
// 2. TagMapper.parse with +SplRlx
// =========================================================================
console.log('\n--- 2. Testing TagMapper.parse with +SplRlx ---');

const parsed = TagMapper.parse('kiiĺ+N+Sg+Nom+SplRlx');
assert.strictEqual(parsed.lemma, 'kiiĺ', 'Lemma must be kiiĺ');
assert.strictEqual(parsed.pos, 'N', 'POS must be N');
assert.strictEqual(parsed.upos, 'NOUN', 'UPOS must be NOUN');
assert.strictEqual(parsed.cleanRaw, 'kiiĺ+N+Sg+Nom+SplRlx', 'cleanRaw must retain +SplRlx');
assert(parsed.tags.includes('SplRlx'), 'tags must contain SplRlx');
assert(parsed.cleanTags.includes('SplRlx'), 'cleanTags must contain SplRlx');
assert.strictEqual(parsed.isSplRlx, true, 'isSplRlx must be true');
assert.strictEqual(parsed.isGuessed, false, 'isGuessed must be false');
assert.strictEqual(parsed.featsMap.Typo, 'Yes', 'Typo feature must be Yes in Universal Dependencies');
assert(parsed.feats.includes('Typo=Yes'), 'feats must contain Typo=Yes');
console.log('✓ kiiĺ+N+Sg+Nom+SplRlx parsed with isSplRlx=true, UPOS=NOUN, Typo=Yes');

// =========================================================================
// 3. Tokenizer Preserving Trailing Apostrophes
// =========================================================================
console.log('\n--- 3. Testing Tokenizer with Trailing Apostrophe ---');

const sents = analyzerService.tokenize("võro kiil' om illos");
assert.strictEqual(sents.length, 1);
const tokens = sents[0].tokens;
assert.strictEqual(tokens.length, 4);
assert.strictEqual(tokens[0].form, 'võro');
assert.strictEqual(tokens[1].form, "kiil'");
assert.strictEqual(tokens[2].form, 'om');
assert.strictEqual(tokens[3].form, 'illos');
console.log('✓ Tokenizer keeps "kiil\'" intact as a single token');

// =========================================================================
// 4. Live Transducer Analysis of Võro «kiil'»
// =========================================================================
console.log('\n--- 4. Testing Live Transducer Analysis of Võro «kiil\'» ---');

analyzerService.models.delete('vro');
const descUrl = 'https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/vro/analyser-gt-desc.hfstol';
await analyzerService.downloadAndLoadModel('vro', descUrl);

// Case 1: kiil' with standard ASCII apostrophe
const readingsApos = analyzerService.analyze_word("kiil'", 'vro');
console.log(`Analyzed «kiil'» -> found ${readingsApos.length} readings:`);
readingsApos.forEach(r => console.log('  •', r.cleanRaw, `(lemma="${r.lemma}", isSplRlx=${r.isSplRlx})`));

const splRlxReading = readingsApos.find(r => r.lemma === 'kiiĺ' && r.isSplRlx);
assert(splRlxReading, 'Must return kiiĺ with +SplRlx for "kiil\'"');
assert.strictEqual(splRlxReading.cleanRaw, 'kiiĺ+N+Sg+Nom+SplRlx');
assert.strictEqual(readingsApos[0].cleanRaw, 'kiiĺ+N+Sg+Nom+SplRlx', 'kiiĺ+N+Sg+Nom+SplRlx must be the prioritized primary reading');

// Case 2: kiil’ with typographic right single quote
const readingsTypo = analyzerService.analyze_word('kiil’', 'vro');
assert(readingsTypo.some(r => r.cleanRaw === 'kiiĺ+N+Sg+Nom+SplRlx'), 'Must return kiiĺ+N+Sg+Nom+SplRlx for "kiil’"');

// Case 3: kiiĺ with canonical precomposed letter
const readingsCanon = analyzerService.analyze_word('kiiĺ', 'vro');
assert(readingsCanon.some(r => r.cleanRaw === 'kiiĺ+N+Sg+Nom' && !r.isSplRlx), 'Canonical "kiiĺ" must NOT have +SplRlx');

// Case 4: kiil without palatalization mark
const readingsPlain = analyzerService.analyze_word('kiil', 'vro');
assert(readingsPlain.some(r => r.cleanRaw === 'kiil+N+Sg+Nom'), 'Must return plain "kiil+N+Sg+Nom"');
assert(readingsPlain.some(r => r.cleanRaw === 'kiiĺ+N+Err/Orth-no-pal+Sg+Nom'), 'Must return keyboard accommodation "kiiĺ+N+Err/Orth-no-pal+Sg+Nom"');

// Case 5: oll' with spell relax
const readingsOll = analyzerService.analyze_word("oll'", 'vro');
console.log(`Analyzed «oll'» -> found ${readingsOll.length} readings:`);
readingsOll.forEach(r => console.log('  •', r.cleanRaw, `(lemma="${r.lemma}", isSplRlx=${r.isSplRlx})`));
const splRlxOll = readingsOll.find(r => r.lemma === 'olõma' && r.isSplRlx);
assert(splRlxOll, 'Must return olõma with +SplRlx for "oll\'"');
assert.strictEqual(splRlxOll.cleanRaw, 'olõma+V+Act+Ind+Prt+Sg3+SplRlx', 'Must return olõma+V+Act+Ind+Prt+Sg3+SplRlx for "oll\'"');
assert.strictEqual(splRlxOll.featsMap.Typo, 'Yes');

console.log('✓ All 5 orthographical variations correctly distinguished:');
console.log('   1. kiil\' -> kiiĺ+N+Sg+Nom+SplRlx');
console.log('   2. kiil’ -> kiiĺ+N+Sg+Nom+SplRlx');
console.log('   3. kiiĺ  -> kiiĺ+N+Sg+Nom');
console.log('   4. kiil  -> kiil+N+Sg+Nom & kiiĺ+N+Err/Orth-no-pal+Sg+Nom');
console.log('   5. oll\'  -> olõma+V+Act+Ind+Prt+Sg3+SplRlx');

// =========================================================================
// 5. Exporters Output with +SplRlx and CorrectForm=X
// =========================================================================
console.log('\n--- 5. Testing CoNLL-U, Interlinear, and Ve\'rdd Exporters with +SplRlx and CorrectForm=X ---');

const testSentence = {
  sent_id: 1,
  text: "tä oll' võro kiil'",
  lang: 'vro',
  tokens: [
    {
      id: 1,
      form: 'tä',
      lemma: 'tä',
      upos: 'PRON',
      selectedReading: TagMapper.parse('tä+Pron+Pers+Sg3+Nom'),
      selectedGloss: { gloss: 's/he', lang: 'eng' }
    },
    {
      id: 2,
      form: "oll'",
      lemma: 'olõma',
      upos: 'VERB',
      selectedReading: splRlxOll,
      selectedGloss: { gloss: 'be', lang: 'eng' }
    },
    {
      id: 3,
      form: 'võro',
      lemma: 'võro',
      upos: 'ADJ',
      selectedReading: TagMapper.parse('võro+A+Sg+Nom'),
      selectedGloss: { gloss: 'Võro', lang: 'eng' }
    },
    {
      id: 4,
      form: "kiil'",
      lemma: 'kiiĺ',
      upos: 'NOUN',
      selectedReading: splRlxReading,
      selectedGloss: { gloss: 'language', lang: 'eng' }
    }
  ]
};

const conllu = ConlluExporter.export([testSentence]);
console.log('✓ CoNLL-U export contains:\n' + conllu.trim());

// Verify oll' row in CoNLL-U
const ollRow = conllu.split('\n').find(l => l.startsWith("2\toll'"));
assert(ollRow, 'CoNLL-U must contain row for oll\'');
assert(ollRow.includes('olõma+V+Act+Ind+Prt+Sg3+SplRlx'), 'XPOS must be olõma+V+Act+Ind+Prt+Sg3+SplRlx');
assert(ollRow.includes('Typo=Yes'), 'FEATS (Column 6) must contain Typo=Yes');
assert(ollRow.includes('CorrectForm=olĺ'), 'MISC (Column 10) must contain CorrectForm=olĺ');

// Verify kiil' row in CoNLL-U
const kiilRow = conllu.split('\n').find(l => l.startsWith("4\tkiil'"));
assert(kiilRow, 'CoNLL-U must contain row for kiil\'');
assert(kiilRow.includes('kiiĺ+N+Sg+Nom+SplRlx'), 'XPOS must be kiiĺ+N+Sg+Nom+SplRlx');
assert(kiilRow.includes('Typo=Yes'), 'FEATS (Column 6) must contain Typo=Yes');
assert(kiilRow.includes('CorrectForm=kiiĺ'), 'MISC (Column 10) must contain CorrectForm=kiiĺ');

const interlinear = InterlinearExporter.exportPlainText([testSentence]);
assert(interlinear.includes('+SplRlx'), 'Interlinear must retain +SplRlx');
console.log('✓ Interlinear text export retains +SplRlx in Morphology line');

const verdd = VerddExporter.exportBlock([testSentence], [], 'vro', 'eng');
assert(verdd.includes('+SplRlx'), 'Ve\'rdd export must retain +SplRlx');
console.log('✓ Ve\'rdd export retains +SplRlx in MORPH field');

console.log('\n🎉 ALL SPELL RELAX, +SplRlx, AND CorrectForm=X TESTS PASSED! 🎉\n');
