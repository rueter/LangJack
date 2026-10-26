/**
 * Test Suite: Skolt Sámi Analyzer and UralicNLP Renewal
 * Verifies:
 * 1. Skolt Sámi (sms) transducer is pre-packaged and loads correctly from models/analyser-sms.hfstol.
 * 2. Words in corrected example sentence «Kåʹllvueiʹvv lij šurr piânnai.» are fully analyzed.
 * 3. Specific verification that «lij» (lemma leeʹd, UPOS VERB) and «piânnai» (lemma piânnai, UPOS NOUN)
 *    are recognized and NOT marked as unrecognized / guessed.
 * 4. Dictionary lookups for Skolt Sámi lemmas produce authentic multilingual glosses (eng, fin, etc.).
 * 5. Compound noun «Kåʹllvueiʹvv» correctly yields compound lemma «kåʹllvueiʹvv» and dictionary glosses.
 * 6. UralicNLP renewal for sms successfully downloads or activates the nightly analyzer.
 */

import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { TagMapper } from '../js/services/tag-mapper.js';
import { storageService } from '../js/services/storage-service.js';

console.log('=== Running Tests for Skolt Sámi Analyzer & UralicNLP Renewal ===\n');

// 1. Initialize analyzer with Skolt Sámi (sms)
console.log('--- 1. Testing Pre-Packaged Skolt Sámi (sms) Analyzer Loading ---');
await analyzerService.init('sms');
assert.strictEqual(analyzerService.activeLang, 'sms', 'Active language must be sms');
assert(analyzerService.isLoaded, 'Analyzer must be loaded');
console.log(`✓ Successfully loaded analyzer for sms: "${analyzerService.activeModelName}" (id: ${analyzerService.activeModelId})`);

// 2. Initialize dictionary service
await dictionaryService.init();
console.log('✓ Initialized dictionary service');

// 3. Test individual word analysis for «lij» and «piânnai»
console.log('\n--- 2. Testing Direct Analysis of «lij» and «piânnai» ---');
const lijReadings = analyzerService.analyze_word('lij', 'sms');
console.log('Readings for "lij":', lijReadings);
assert(lijReadings.length > 0, '"lij" must have at least one reading');
assert(!lijReadings[0].isGuessed, '"lij" must NOT be a guessed/unrecognized reading');
assert.strictEqual(lijReadings[0].lemma, 'leeʹd', '"lij" must resolve to base lemma "leeʹd"');
assert.strictEqual(lijReadings[0].upos, 'VERB', '"lij" must have UPOS VERB');
console.log('✓ Confirmed: "lij" is recognized -> lemma: "leeʹd", UPOS: VERB');

const piannaiReadings = analyzerService.analyze_word('piânnai', 'sms');
console.log('Readings for "piânnai":', piannaiReadings);
assert(piannaiReadings.length > 0, '"piânnai" must have at least one reading');
assert(!piannaiReadings[0].isGuessed, '"piânnai" must NOT be a guessed/unrecognized reading');
assert.strictEqual(piannaiReadings[0].lemma, 'piânnai', '"piânnai" must resolve to lemma "piânnai"');
assert.strictEqual(piannaiReadings[0].upos, 'NOUN', '"piânnai" must have UPOS NOUN');
console.log('✓ Confirmed: "piânnai" is recognized -> lemma: "piânnai", UPOS: NOUN');

// 4. Test compound word «Kåʹllvueiʹvv»
console.log('\n--- 3. Testing Analysis of Compound Word «Kåʹllvueiʹvv» ---');
const kallReadings = analyzerService.analyze_word('Kåʹllvueiʹvv', 'sms');
console.log('Readings for "Kåʹllvueiʹvv":', kallReadings);
assert(kallReadings.length > 0, '"Kåʹllvueiʹvv" must be recognized');
assert(!kallReadings[0].isGuessed, '"Kåʹllvueiʹvv" must NOT be guessed');
assert.strictEqual(kallReadings[0].lemma, 'kåʹllvueiʹvv', 'Compound lemma must be reconstructed as "kåʹllvueiʹvv"');
assert.strictEqual(kallReadings[0].upos, 'NOUN', '"Kåʹllvueiʹvv" must have UPOS NOUN');
console.log('✓ Confirmed: "Kåʹllvueiʹvv" compound lemma correctly extracted as "kåʹllvueiʹvv"');

// 5. Test full sentence analysis
console.log('\n--- 4. Testing End-to-End Analysis of Sentence «Kåʹllvueiʹvv lij šurr piânnai.» ---');
const sentenceText = '«Kåʹllvueiʹvv lij šurr piânnai.»';
const sentences = await analyzerService.analyzeText(sentenceText, 'sms');
assert.strictEqual(sentences.length, 1);
const tokens = sentences[0].tokens;

const wordTokens = tokens.filter(t => !t.isPunct);
assert.strictEqual(wordTokens.length, 4, 'Must have 4 word tokens');

const [tKall, tLij, tSurr, tPiannai] = wordTokens;

console.log(`Token 1: "${tKall.form}" -> Lemma: "${tKall.lemma}", UPOS: ${tKall.upos}, Unrecognized: ${tKall.isUnrecognized}`);
assert.strictEqual(tKall.isUnrecognized, false, '"Kåʹllvueiʹvv" must NOT be unrecognized');
assert.strictEqual(tKall.lemma, 'kåʹllvueiʹvv');

console.log(`Token 2: "${tLij.form}" -> Lemma: "${tLij.lemma}", UPOS: ${tLij.upos}, Unrecognized: ${tLij.isUnrecognized}`);
assert.strictEqual(tLij.isUnrecognized, false, '"lij" must NOT be unrecognized');
assert.strictEqual(tLij.lemma, 'leeʹd');
assert.strictEqual(tLij.upos, 'VERB');

console.log(`Token 3: "${tSurr.form}" -> Lemma: "${tSurr.lemma}", UPOS: ${tSurr.upos}, Unrecognized: ${tSurr.isUnrecognized}`);
assert.strictEqual(tSurr.isUnrecognized, false, '"šurr" must NOT be unrecognized');
assert.strictEqual(tSurr.lemma, 'šurr');

console.log(`Token 4: "${tPiannai.form}" -> Lemma: "${tPiannai.lemma}", UPOS: ${tPiannai.upos}, Unrecognized: ${tPiannai.isUnrecognized}`);
assert.strictEqual(tPiannai.isUnrecognized, false, '"piânnai" must NOT be unrecognized');
assert.strictEqual(tPiannai.lemma, 'piânnai');
assert.strictEqual(tPiannai.upos, 'NOUN');
console.log('✓ All 4 words in the sentence analyzed successfully without any unrecognized flags!');

// 6. Test Dictionary Gloss Lookups for all lemmas
console.log('\n--- 5. Testing Dictionary Gloss Lookups for Skolt Sámi Lemmas ---');
const glossesLeeD = dictionaryService.lookupGlosses('leeʹd', 'sms', 'all');
console.log('Glosses for "leeʹd":', glossesLeeD.map(g => `${g.lang}:${g.gloss}`));
assert(glossesLeeD.some(g => g.lang === 'eng' && g.gloss === 'be'), 'leeʹd must have English gloss "be"');
assert(glossesLeeD.some(g => g.lang === 'fin' && g.gloss === 'olla'), 'leeʹd must have Finnish gloss "olla"');

const glossesPiannai = dictionaryService.lookupGlosses('piânnai', 'sms', 'all');
console.log('Glosses for "piânnai":', glossesPiannai.map(g => `${g.lang}:${g.gloss}`));
assert(glossesPiannai.some(g => g.lang === 'eng' && g.gloss === 'dog'), 'piânnai must have English gloss "dog"');
assert(glossesPiannai.some(g => g.lang === 'fin' && g.gloss === 'koira'), 'piânnai must have Finnish gloss "koira"');

const glossesKall = dictionaryService.lookupGlosses('kåʹllvueiʹvv', 'sms', 'all');
console.log('Glosses for "kåʹllvueiʹvv":', glossesKall.map(g => `${g.lang}:${g.gloss}`));
assert(glossesKall.some(g => g.lang === 'eng' && g.gloss === 'goldenhead'), 'kåʹllvueiʹvv must have English gloss "goldenhead"');
assert(glossesKall.some(g => g.lang === 'fin' && g.gloss === 'kultapää'), 'kåʹllvueiʹvv must have Finnish gloss "kultapää"');

const glossesSurr = dictionaryService.lookupGlosses('šurr', 'sms', 'all');
console.log('Glosses for "šurr":', glossesSurr.map(g => `${g.lang}:${g.gloss}`));
assert(glossesSurr.some(g => g.lang === 'eng' && (g.gloss === 'big' || g.gloss === 'tall')), 'šurr must have English gloss');
assert(glossesSurr.some(g => g.lang === 'fin' && (g.gloss === 'suuri' || g.gloss === 'iso')), 'šurr must have Finnish gloss');
console.log('✓ All Skolt Sámi lemmas successfully retrieved expected multilingual glosses');

// 7. Test UralicNLP Nightly Renewal
console.log('\n--- 6. Testing UralicNLP Renewal for Skolt Sámi ---');
const renewResult = await analyzerService.downloadAndLoadModel('sms');
console.log('Renewal result:', renewResult);
assert.strictEqual(renewResult.id, 'uralic_sms_analyser');
assert(renewResult.size > 0, 'Downloaded model must have positive size');

// Verify that renewed model in IndexedDB analyzes the words
const renewedSentences = await analyzerService.analyzeText(sentenceText, 'sms');
const renewedWords = renewedSentences[0].tokens.filter(t => !t.isPunct);
assert.strictEqual(renewedWords[1].lemma, 'leeʹd', 'Renewed model must analyze "lij" to "leeʹd"');
assert.strictEqual(renewedWords[1].isUnrecognized, false);
assert.strictEqual(renewedWords[3].lemma, 'piânnai', 'Renewed model must analyze "piânnai"');
assert.strictEqual(renewedWords[3].isUnrecognized, false);
console.log('✓ Confirmed: After UralicNLP renewal, «lij» and «piânnai» are analyzed cleanly!');

console.log('\n🎉 ALL SKOLT SÁMI ANALYZER & URALICNLP RENEWAL TESTS PASSED! 🎉');
