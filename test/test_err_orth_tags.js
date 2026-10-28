import assert from 'node:assert';
import { TagMapper } from '../js/services/tag-mapper.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { InterlinearExporter } from '../js/services/interlinear-exporter.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';

console.log('=== Running +Err/Orth and +Err/Orth-... Retention Tests ===\n');

// =========================================================================
// 1. TagMapper.parse with +Err/Orth and language-specific orthography tags
// =========================================================================
console.log('--- 1. Testing TagMapper.parse with +Err/Orth and +Err/Orth-no-pal ---');

// Case A: Võro kiiĺ typed without palatalization mark as kiil
const parseA = TagMapper.parse('kiiĺ+N+Err/Orth-no-pal+Sg+Nom');
assert.strictEqual(parseA.lemma, 'kiiĺ', 'Lemma should preserve true palatalized lemma "kiiĺ"');
assert.strictEqual(parseA.pos, 'N', 'POS should be "N"');
assert.strictEqual(parseA.upos, 'NOUN', 'UPOS should be "NOUN" (< +N)');
assert.strictEqual(parseA.raw, 'kiiĺ+N+Err/Orth-no-pal+Sg+Nom');
assert.strictEqual(parseA.cleanRaw, 'kiiĺ+N+Err/Orth-no-pal+Sg+Nom', 'cleanRaw must retain +Err/Orth-no-pal tag');
assert(parseA.cleanTags.includes('Err/Orth-no-pal'), 'cleanTags must retain Err/Orth-no-pal');
assert(parseA.tags.includes('Err/Orth-no-pal'), 'tags must retain Err/Orth-no-pal');
assert.strictEqual(parseA.isGuessed, false, 'Err/Orth is an orthographical variant, NOT a guessed reading');
assert.strictEqual(parseA.isOrthErr, true, 'isOrthErr flag must be true');
assert.strictEqual(parseA.orthErrTag, 'Err/Orth-no-pal', 'orthErrTag must be "Err/Orth-no-pal"');
assert.strictEqual(parseA.featsMap.Typo, 'Yes', 'Typo feature must be set to "Yes" in Universal Dependencies');
assert(parseA.feats.includes('Typo=Yes'), 'feats string must contain Typo=Yes');
assert(parseA.feats.includes('Case=Nom'), 'feats string must contain Case=Nom');
assert(parseA.feats.includes('Number=Sing'), 'feats string must contain Number=Sing');
console.log('✓ kiiĺ+N+Err/Orth-no-pal+Sg+Nom parsed correctly with Typo=Yes and isOrthErr=true');

// Case B: Verb with Err/Orth-no-pal
const parseB = TagMapper.parse('kiilma+V+Err/Orth-no-pal+Act+Ind+Prt+Sg3');
assert.strictEqual(parseB.lemma, 'kiilma');
assert.strictEqual(parseB.pos, 'V');
assert.strictEqual(parseB.upos, 'VERB');
assert.strictEqual(parseB.cleanRaw, 'kiilma+V+Err/Orth-no-pal+Act+Ind+Prt+Sg3');
assert(parseB.cleanTags.includes('Err/Orth-no-pal'));
assert.strictEqual(parseB.isOrthErr, true);
assert.strictEqual(parseB.featsMap.Typo, 'Yes');
console.log('✓ kiilma+V+Err/Orth-no-pal+Act+Ind+Prt+Sg3 parsed correctly with Typo=Yes');

// Case C: Standard Err/Orth tag without subtag
const parseC = TagMapper.parse('talo+N+Err/Orth+Sg+Nom');
assert.strictEqual(parseC.cleanRaw, 'talo+N+Err/Orth+Sg+Nom');
assert(parseC.cleanTags.includes('Err/Orth'));
assert.strictEqual(parseC.isOrthErr, true);
assert.strictEqual(parseC.orthErrTag, 'Err/Orth');
assert.strictEqual(parseC.featsMap.Typo, 'Yes');
console.log('✓ Standard Err/Orth tag retained correctly');

// Case D: Plain reading without Err/Orth
const parseD = TagMapper.parse('kiil+N+Sg+Nom');
assert.strictEqual(parseD.isOrthErr, false);
assert.strictEqual(parseD.orthErrTag, null);
assert.strictEqual(parseD.featsMap.Typo, undefined);
console.log('✓ Normal reading kiil+N+Sg+Nom has isOrthErr=false and no Typo feature');

// =========================================================================
// 2. Analyzer URL Prioritization: Descriptive model (analyser-gt-desc)
// =========================================================================
console.log('\n--- 2. Testing Analyzer Descriptive Model (analyser-gt-desc) Prioritization ---');

const urls = analyzerService.getModelDownloadUrls('vro');
assert(urls[0].includes('analyser-gt-desc.hfstol'), 'Primary model URL must be analyser-gt-desc.hfstol for descriptive orthography coverage');
console.log('✓ Primary URL for vro prioritizes analyser-gt-desc:', urls[0]);

// =========================================================================
// 3. Live Transducer Analysis of Võro «kiil»
// =========================================================================
console.log('\n--- 3. Testing Live Analysis of Võro «kiil» with Descriptive Transducer ---');

// Initialize analyzer with desc model for vro
analyzerService.models.delete('vro');
const descUrl = 'https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/vro/analyser-gt-desc.hfstol';
await analyzerService.downloadAndLoadModel('vro', descUrl);

const readings = analyzerService.analyze_word('kiil', 'vro');
console.log(`Analyzed «kiil» in vro -> found ${readings.length} readings:`);
readings.forEach(r => console.log('  •', r.cleanRaw, `(lemma="${r.lemma}", UPOS=${r.upos})`));

// Verify that both standard kiil and palatalized kiiĺ with +Err/Orth-no-pal are present
const hasPlainKiil = readings.some(r => r.lemma === 'kiil' && r.raw.includes('kiil+N+Sg+Nom'));
const hasPalatalizedKiil = readings.some(r => r.lemma === 'kiiĺ' && r.raw.includes('Err/Orth-no-pal'));

assert(hasPlainKiil, 'Analyzer must return standard reading "kiil+N+Sg+Nom"');
assert(hasPalatalizedKiil, 'Analyzer must return keyboard accommodation reading "kiiĺ+N+Err/Orth-no-pal+Sg+Nom"');

const palReading = readings.find(r => r.lemma === 'kiiĺ' && r.raw.includes('Err/Orth-no-pal'));
assert.strictEqual(palReading.cleanRaw, 'kiiĺ+N+Err/Orth-no-pal+Sg+Nom', 'cleanRaw must retain +Err/Orth-no-pal');
assert.strictEqual(palReading.isGuessed, false, 'Reading must NOT be marked isGuessed');
assert.strictEqual(palReading.isOrthErr, true, 'Reading must have isOrthErr=true');
console.log('✓ Both "kiil+N+Sg+Nom" and "kiiĺ+N+Err/Orth-no-pal+Sg+Nom" successfully returned and distinguished');

// =========================================================================
// 4. Exporters Output with +Err/Orth-no-pal
// =========================================================================
console.log('\n--- 4. Testing CoNLL-U, Interlinear, and Ve\'rdd Exporters with Err/Orth Tags ---');

const sentence = {
  sent_id: 1,
  text: 'võro kiil',
  tokens: [
    {
      id: 1,
      form: 'võro',
      lemma: 'võro',
      upos: 'ADJ',
      selectedReading: TagMapper.parse('võro+A+Sg+Nom'),
      selectedGloss: { gloss: 'Võro', lang: 'eng' }
    },
    {
      id: 2,
      form: 'kiil',
      lemma: 'kiiĺ',
      upos: 'NOUN',
      selectedReading: palReading,
      selectedGloss: { gloss: 'language', lang: 'eng' }
    }
  ]
};

// 4.1 CoNLL-U export
const conllu = ConlluExporter.export([sentence]);
assert(conllu.includes('2\tkiil\tkiiĺ\tNOUN\tN+Err/Orth-no-pal+Sg+Nom\tCase=Nom|Number=Sing|Typo=Yes'), 'CoNLL-U must output clean morphology with +Err/Orth-no-pal in XPOS and Typo=Yes in FEATS');
console.log('✓ CoNLL-U export contains:');
console.log(conllu.trim().split('\n').filter(l => !l.startsWith('#')).join('\n'));

// 4.2 Interlinear export
const interlinear = InterlinearExporter.exportPlainText([sentence]);
assert(interlinear.includes('kiiĺ+N+Err/Orth-no-pal+Sg+Nom'), 'Interlinear plain text must retain +Err/Orth-no-pal in Morphology row');
console.log('✓ Interlinear text export retains +Err/Orth-no-pal in Morphology line');

// 4.3 Ve'rdd export
const verdd = VerddExporter.exportBlock([sentence], [], 'vro', 'eng');
assert(verdd.includes('kiiĺ+N+Err/Orth-no-pal+Sg+Nom'), 'Ve\'rdd block must retain +Err/Orth-no-pal in MORPH field');
console.log('✓ Ve\'rdd export retains +Err/Orth-no-pal in MORPH field');

console.log('\n🎉 ALL +Err/Orth AND +Err/Orth-... TAG RETENTION TESTS PASSED! 🎉');
