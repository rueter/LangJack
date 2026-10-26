/**
 * Test: Apurinã (apu) Morphological Analysis & Portuguese (por) Dictionary Glossing
 * Verifies:
 * 1. Apurinã analyzer loads correctly from models/analyser-apu.hfstol.
 * 2. Morphological readings and UPOS derivations for Apurinã words.
 * 3. Analyzer precedence: Renewed model in IndexedDB takes precedence over packaged/starter.
 * 4. Apurinã to Portuguese (apu -> por) gloss lookups via DictionaryService.
 * 5. End-to-end analyzeText for Apurinã with Portuguese glosses.
 */

import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { storageService } from '../js/services/storage-service.js';
import { TagMapper } from '../js/services/tag-mapper.js';
import { LANGUAGE_INFO, getLangDisplayName } from '../js/controllers/app.js';

console.log('=== Running Tests for Apurinã Analyzer & apu-por Dictionary ===\n');

// --- 1. Language Configuration Verification ---
console.log('--- 1. Testing Language Configuration (apu and por) ---');
assert(LANGUAGE_INFO['apu'], 'Apurinã (apu) must be in LANGUAGE_INFO');
assert.strictEqual(LANGUAGE_INFO['apu'].name, 'Apurinã');
assert.strictEqual(getLangDisplayName('apu'), 'Apurinã');

assert(LANGUAGE_INFO['por'], 'Portuguese (por) must be in LANGUAGE_INFO');
assert.strictEqual(LANGUAGE_INFO['por'].name, 'Portuguese');
assert.strictEqual(getLangDisplayName('por'), 'Portuguese');
console.log('✓ Confirmed: apu (Apurinã) and por (Portuguese) registered in LANGUAGE_INFO');

// --- 2. Initializing Analyzer for Apurinã ---
console.log('\n--- 2. Testing Apurinã Morphological Analyzer ---');
await analyzerService.init('apu');
assert.strictEqual(analyzerService.activeLang, 'apu');
assert(analyzerService.isLoaded, 'Analyzer must be loaded');

const aikuReadings = analyzerService.analyze_word('aiku', 'apu');
console.log('Readings for "aiku":', aikuReadings.map(r => r.raw));
assert(aikuReadings.length > 0, 'Should return readings for "aiku"');
assert(aikuReadings.some(r => r.lemma === 'aiku' && r.upos === 'NOUN'), 'Should have reading with lemma "aiku" and UPOS NOUN');

const treeReadings = analyzerService.analyze_word('ãamyna', 'apu');
console.log('Readings for "ãamyna":', treeReadings.map(r => r.raw));
assert(treeReadings.length > 0, 'Should return readings for "ãamyna"');
assert.strictEqual(treeReadings[0].lemma, 'ãamyna');
assert.strictEqual(treeReadings[0].upos, 'NOUN');

const manReadings = analyzerService.analyze_word('kyky', 'apu');
console.log('Readings for "kyky":', manReadings.map(r => r.raw));
assert(manReadings.length > 0, 'Should return readings for "kyky"');
assert.strictEqual(manReadings[0].lemma, 'kyky');
assert.strictEqual(manReadings[0].upos, 'NOUN');
console.log('✓ Morphological analysis verified on Apurinã tokens: "aiku", "ãamyna", "kyky"');

// --- 3. Testing Analyzer Precedence (IndexedDB renewed model over packaged/starter) ---
console.log('\n--- 3. Testing Analyzer Precedence (Renewed IndexedDB model priority) ---');
// Clear in-memory instance
analyzerService.models.delete('apu');

// Save a real renewed model record in storage to test precedence
const fs = await import('node:fs/promises');
const realBuf = (await fs.readFile('models/analyser-apu.hfstol')).buffer;
const renewedId = 'uralic_apu_analyser';
const renewedName = 'UralicNLP APU Analyser (nightly renewed test)';
await storageService.saveModel(renewedId, renewedName, 'analyser', realBuf, { lang: 'apu' });

// Verify that ensureModelForLanguage checks IndexedDB first and loads the renewed model
await analyzerService.ensureModelForLanguage('apu');
assert.strictEqual(analyzerService.activeModelId, renewedId, 'Renewed model ID must take precedence');
assert.strictEqual(analyzerService.activeModelName, renewedName, 'Renewed model name must be active');
console.log(`✓ Confirmed: Renewed model from IndexedDB took precedence: ${analyzerService.activeModelId} ("${analyzerService.activeModelName}")`);

// --- 4. Testing Dictionary Service for apu -> por ---
console.log('\n--- 4. Testing apu -> por Dictionary Gloss Lookups ---');
await dictionaryService.init();

// Lookup "aiku" -> casa
const aikuGlossesPor = dictionaryService.lookupGlosses('aiku', 'apu', 'por');
console.log('Gloss for "aiku" (por):', aikuGlossesPor);
assert(aikuGlossesPor.length > 0, 'Should find gloss for "aiku" in Portuguese');
assert(aikuGlossesPor.some(g => g.gloss === 'casa' && g.lang === 'por'), 'Expected "casa" for "aiku"');

// Lookup "ãamyna" -> árvore
const treeGlossesPor = dictionaryService.lookupGlosses('ãamyna', 'apu', 'por');
console.log('Gloss for "ãamyna" (por):', treeGlossesPor);
assert(treeGlossesPor.length > 0, 'Should find gloss for "ãamyna" in Portuguese');
assert(treeGlossesPor.some(g => g.gloss === 'árvore' && g.lang === 'por'), 'Expected "árvore" for "ãamyna"');

// Lookup "kyky" -> homem
const kykyGlossesPor = dictionaryService.lookupGlosses('kyky', 'apu', 'por');
console.log('Gloss for "kyky" (por):', kykyGlossesPor);
assert(kykyGlossesPor.length > 0, 'Should find gloss for "kyky" in Portuguese');
assert(kykyGlossesPor.some(g => g.gloss === 'homem' && g.lang === 'por'), 'Expected "homem" for "kyky"');

// Lookup "ãata" -> canoa tradicional, canoa
const aataGlossesPor = dictionaryService.lookupGlosses('ãata', 'apu', 'por');
console.log('Gloss for "ãata" (por):', aataGlossesPor.map(g => g.gloss));
assert(aataGlossesPor.length > 0, 'Should find gloss for "ãata" in Portuguese');
assert(aataGlossesPor.some(g => g.gloss === 'canoa tradicional'), 'Expected word set "canoa tradicional"');
assert(aataGlossesPor.some(g => g.gloss === 'canoa'), 'Expected individual word "canoa"');

// Lookup "ãapytsa" -> cipó, corda (separate individual words)
const aapytsaGlosses = dictionaryService.lookupGlosses('ãapytsa', 'apu', 'por');
console.log('Gloss for "ãapytsa" (por):', aapytsaGlosses.map(g => g.gloss));
assert(aapytsaGlosses.some(g => g.gloss === 'cipó'), 'Expected separate individual word "cipó"');
assert(aapytsaGlosses.some(g => g.gloss === 'corda'), 'Expected separate individual word "corda"');

// Lookup "ãatsupa" -> caderno, folha de papel, folha de planta (separate word and word sets)
const aatsupaGlosses = dictionaryService.lookupGlosses('ãatsupa', 'apu', 'por');
console.log('Gloss for "ãatsupa" (por):', aatsupaGlosses.map(g => g.gloss));
assert(aatsupaGlosses.some(g => g.gloss === 'caderno'), 'Expected individual word "caderno"');
assert(aatsupaGlosses.some(g => g.gloss === 'folha de papel'), 'Expected word set "folha de papel"');
assert(aatsupaGlosses.some(g => g.gloss === 'folha de planta'), 'Expected word set "folha de planta"');

// Test splitGlossItem utility directly
import { splitGlossItem } from '../js/services/dictionary-service.js';
assert.deepStrictEqual(splitGlossItem('cipó, corda'), ['cipó', 'corda']);
assert.deepStrictEqual(splitGlossItem('caderno, folha de papel'), ['caderno', 'folha de papel']);
assert.deepStrictEqual(splitGlossItem('ver / olhar'), ['ver', 'olhar']);
assert.deepStrictEqual(splitGlossItem('caxiri (bebida fermentada)'), ['caxiri (bebida fermentada)']);
console.log('✓ splitGlossItem correctly separated individual words and preserved word sets');

// Test duplicate concatenated composite filtering (вастома -> tapaaminen & kohtaaminen separate, not joined)
const vastomaFin = dictionaryService.lookupGlosses('вастома', 'myv', 'fin');
console.log('Finnish glosses for "вастома":', vastomaFin.map(g => g.gloss));
assert(vastomaFin.some(g => g.gloss === 'tapaaminen'), 'Expected separate word "tapaaminen"');
assert(vastomaFin.some(g => g.gloss === 'kohtaaminen'), 'Expected separate word "kohtaaminen"');
assert(!vastomaFin.some(g => g.gloss === 'tapaaminen kohtaaminen'), 'Redundant composite "tapaaminen kohtaaminen" should be filtered out');
assert(!vastomaFin.some(g => g.gloss === 'tapaaminen, kohtaaminen'), 'Unsplit comma item should be split into individual words');

const vastomaRus = dictionaryService.lookupGlosses('вастома', 'myv', 'rus');
console.log('Russian glosses for "вастома":', vastomaRus.map(g => g.gloss));
assert(vastomaRus.some(g => g.gloss === 'встреча'), 'Expected separate word "встреча"');
assert(vastomaRus.some(g => g.gloss === 'приём'), 'Expected separate word "приём"');
assert(!vastomaRus.some(g => g.gloss === 'встреча приём'), 'Redundant composite "встреча приём" should be filtered out');

// Test adding a custom entry with comma-separated glosses
await dictionaryService.addCustomEntry({
  src_lang: 'apu',
  lemma: 'atuku',
  pos: 'N',
  tgt_lang: 'por',
  gloss: 'avô, velho'
});
const atukuGlosses = dictionaryService.lookupGlosses('atuku', 'apu', 'por');
console.log('Custom entry glosses for "atuku":', atukuGlosses.map(g => g.gloss));
assert(atukuGlosses.some(g => g.gloss === 'avô'), 'Expected separate word "avô"');
assert(atukuGlosses.some(g => g.gloss === 'velho'), 'Expected separate word "velho"');
console.log('✓ Custom entry addition correctly split comma-separated glosses into individual entries');

// All languages lookup
const aikuAll = dictionaryService.lookupGlosses('aiku', 'apu', 'all');
console.log('All glosses for "aiku":', aikuAll.map(g => `${g.lang}:${g.gloss}`));
assert(aikuAll.some(g => g.lang === 'por'), 'Should contain por translation');
assert(aikuAll.some(g => g.lang === 'eng'), 'Should contain eng translation');
console.log('✓ Multi-language glossing for Apurinã confirmed with both "por" and "eng"');

// --- 5. End-to-End Apurinã Text Analysis ---
console.log('\n--- 5. Testing End-to-End Apurinã Text Analysis ---');
const sampleSentence = 'Kyky atama anãpa.';
const analyzedSentences = await analyzerService.analyzeText(sampleSentence, 'apu');
assert.strictEqual(analyzedSentences.length, 1);
const tokens = analyzedSentences[0].tokens;
assert.strictEqual(tokens.length, 4); // "Kyky", "atama", "anãpa", "."

// Token 1: Kyky (man / homem)
assert.strictEqual(tokens[0].lemma, 'kyky');
assert.strictEqual(tokens[0].upos, 'NOUN');
const tok1Glosses = dictionaryService.lookupGlosses(tokens[0].lemma, 'apu', 'por');
assert(tok1Glosses.some(g => g.gloss === 'homem'), 'Token 1 should gloss as "homem"');
console.log(`✓ Token 1 "${tokens[0].form}" -> Lemma: "${tokens[0].lemma}" (UPOS: ${tokens[0].upos}) | Gloss: "${tok1Glosses[0].gloss}" (${tok1Glosses[0].lang})`);

// Token 2: atama (see / ver)
assert.strictEqual(tokens[1].lemma, 'atama');
assert.strictEqual(tokens[1].upos, 'VERB');
const tok2Glosses = dictionaryService.lookupGlosses(tokens[1].lemma, 'apu', 'por');
assert(tok2Glosses.some(g => g.gloss.includes('ver')), 'Token 2 should gloss as "ver"');
console.log(`✓ Token 2 "${tokens[1].form}" -> Lemma: "${tokens[1].lemma}" (UPOS: ${tokens[1].upos}) | Gloss: "${tok2Glosses[0].gloss}" (${tok2Glosses[0].lang})`);

// Token 3: anãpa (dog / cachorro)
assert.strictEqual(tokens[2].lemma, 'anãpa');
assert.strictEqual(tokens[2].upos, 'NOUN');
const tok3Glosses = dictionaryService.lookupGlosses(tokens[2].lemma, 'apu', 'por');
assert(tok3Glosses.some(g => g.gloss === 'cachorro'), 'Token 3 should gloss as "cachorro"');
console.log(`✓ Token 3 "${tokens[2].form}" -> Lemma: "${tokens[2].lemma}" (UPOS: ${tokens[2].upos}) | Gloss: "${tok3Glosses[0].gloss}" (${tok3Glosses[0].lang})`);

console.log('\n🎉 ALL APURINÃ ANALYZER & APU-POR DICTIONARY TESTS PASSED SUCCESSFULLY! 🎉');

