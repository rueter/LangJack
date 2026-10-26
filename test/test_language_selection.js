import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { InterlinearExporter } from '../js/services/interlinear-exporter.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';
import { LANGUAGE_INFO, getLangDisplayName, WorkbenchApp } from '../js/controllers/app.js';

async function runLanguageSelectionTests() {
  console.log('=== Running Comprehensive Language Selection & Multi-Lang Glossing Tests ===\n');

  // Test 0: Verify Komi-Permyak (koi) included and Mari (chm) excluded
  console.log('--- 0. Testing Language Configuration (koi included, chm excluded) ---');
  assert.strictEqual(LANGUAGE_INFO['chm'], undefined, 'Mari (chm) should not be included');
  assert(LANGUAGE_INFO['koi'], 'Komi-Permyak (koi) must be included');
  assert.strictEqual(LANGUAGE_INFO['koi'].name, 'Komi-Permyak');
  assert.strictEqual(getLangDisplayName('koi'), 'Komi-Permyak');
  assert(LANGUAGE_INFO['mhr'], 'Meadow Mari (mhr) must be included');
  assert(LANGUAGE_INFO['mrj'], 'Hill Mari (mrj) must be included');
  console.log('✓ Confirmed: chm is excluded, koi (Komi-Permyak) is included, and mhr/mrj literary standards are preserved');

  // C. Komi-Permyak (koi) analysis test
  const koiAnalysis = analyzerService.analyze_word('керкуын', 'koi');
  assert(koiAnalysis.length > 0, 'Should analyze Komi-Permyak word');
  assert.strictEqual(koiAnalysis[0].lemma, 'керку');
  assert.strictEqual(koiAnalysis[0].upos, 'NOUN');
  assert.strictEqual(koiAnalysis[0].feats, 'Case=Ine|Number=Sing');
  console.log(`✓ Komi-Permyak "керкуын" correctly analyzed -> Lemma: "${koiAnalysis[0].lemma}" (Case=Ine)`);

  // Initialize services
  await analyzerService.init('myv');
  await dictionaryService.init();

  // Test 1: Language selection for Input Text (Erzya vs Finnish)
  console.log('\n--- 1. Testing Input Text Analyzer Language Switching ---');
  
  // A. Erzya analysis
  await analyzerService.setLanguage('myv');
  const myvSentence = 'Вастомась ульнесь пек вадря.';
  const myvAnalysis = await analyzerService.analyzeText(myvSentence, 'myv');
  assert.strictEqual(myvAnalysis.length, 1);
  const myvTokens = myvAnalysis[0].tokens;
  assert.strictEqual(myvTokens[0].form, 'Вастомась');
  assert.strictEqual(myvTokens[0].lemma, 'вастома');
  assert(!myvTokens[0].selectedReading.raw.includes('wt:'), 'Reading should not contain weights');
  console.log(`✓ Erzya "Вастомась" correctly analyzed with lemma: "${myvTokens[0].lemma}" (UPOS: ${myvTokens[0].selectedReading.upos})`);

  // B. Finnish analysis
  await analyzerService.setLanguage('fin');
  const finSentence = 'Kissa nukkuu talossa ja koira juoksee.';
  const finAnalysis = await analyzerService.analyzeText(finSentence, 'fin');
  assert.strictEqual(finAnalysis.length, 1);
  const finTokens = finAnalysis[0].tokens;
  assert.strictEqual(finTokens[0].form, 'Kissa');
  assert.strictEqual(finTokens[0].lemma, 'kissa');
  assert.strictEqual(finTokens[2].form, 'talossa');
  assert.strictEqual(finTokens[2].lemma, 'talo');
  assert.strictEqual(finTokens[4].form, 'koira');
  assert.strictEqual(finTokens[4].lemma, 'koira');
  console.log(`✓ Finnish "talossa" correctly analyzed with lemma: "${finTokens[2].lemma}" (UPOS: ${finTokens[2].selectedReading.upos})`);
  console.log(`✓ Finnish "Kissa" correctly analyzed with lemma: "${finTokens[0].lemma}" (UPOS: ${finTokens[0].selectedReading.upos})`);

  // Test 2: Multi-Language Dictionary Gloss Retrieval
  console.log('\n--- 2. Testing Multi-Language Dictionary Gloss Lookup (Offer other languages) ---');

  // A. Erzya "вастома" multi-language lookup
  const myvGlossesAll = dictionaryService.lookupGlosses('вастома', 'myv', 'all');
  assert(myvGlossesAll.length > 0, 'Should find glosses for вастома');
  const myvGlossLangs = [...new Set(myvGlossesAll.map(g => g.lang))];
  console.log('✓ "вастома" translations available in languages:', myvGlossLangs.join(', '));
  assert(myvGlossLangs.includes('eng'), 'Should include English translation for вастома');
  assert(myvGlossLangs.includes('fin'), 'Should include Finnish translation for вастома');
  assert(myvGlossLangs.includes('rus'), 'Should include Russian translation for вастома');

  // B. Finnish "kissa" multi-language lookup
  const finGlossesAll = dictionaryService.lookupGlosses('kissa', 'fin', 'all');
  assert(finGlossesAll.length > 0, 'Should find glosses for kissa');
  const finGlossLangs = [...new Set(finGlossesAll.map(g => g.lang))];
  console.log('✓ "kissa" translations available in languages:', finGlossLangs.join(', '));
  assert(finGlossLangs.includes('eng'), 'Should include English translation for kissa');
  assert(finGlossLangs.includes('est'), 'Should include Estonian translation for kissa');
  assert(finGlossLangs.includes('myv'), 'Should include Erzya translation for kissa');

  // Test 3: Language Filtering for Dictionary Glosses
  console.log('\n--- 3. Testing Target Language Filtering in Dictionary Glosses ---');
  
  // Filter вастома by English
  const myvEngGlosses = dictionaryService.lookupGlosses('вастома', 'myv', 'eng');
  assert(myvEngGlosses.every(g => g.lang === 'eng'), 'Filtered glosses must all be English');
  console.log('✓ English filter for "вастома":', myvEngGlosses.map(g => g.gloss).join(', '));

  // Filter вастома by Finnish
  const myvFinGlosses = dictionaryService.lookupGlosses('вастома', 'myv', 'fin');
  assert(myvFinGlosses.every(g => g.lang === 'fin'), 'Filtered glosses must all be Finnish');
  console.log('✓ Finnish filter for "вастома":', myvFinGlosses.map(g => g.gloss).join(', '));

  // Filter вастома by Russian
  const myvRusGlosses = dictionaryService.lookupGlosses('вастома', 'myv', 'rus');
  assert(myvRusGlosses.every(g => g.lang === 'rus'), 'Filtered glosses must all be Russian');
  console.log('✓ Russian filter for "вастома":', myvRusGlosses.map(g => g.gloss).join(', '));

  // Test 4: Custom Gloss and Auto-Save with ISO Language Code
  console.log('\n--- 4. Testing Custom Gloss with ISO Language Code ---');
  await dictionaryService.addCustomEntry({
    src_lang: 'fin',
    lemma: 'kissa',
    tgt_lang: 'deu',
    gloss: 'Katze',
    notes: 'Test German custom entry'
  });
  const customLookup = dictionaryService.lookupGlosses('kissa', 'fin', 'deu');
  assert(customLookup.some(g => g.gloss === 'Katze' && g.lang === 'deu'), 'Custom entry should be returned');
  console.log('✓ Custom entry added and retrieved successfully:', customLookup);

  // Test 5: Exporting in Multi-Language Context
  console.log('\n--- 5. Testing Multi-Format Exports ---');
  
  // Assign glosses to tokens
  finTokens.forEach(t => {
    if (!t.isPunct) {
      const glosses = dictionaryService.lookupGlosses(t.lemma, 'fin', 'all');
      t.allGlosses = glosses;
      t.selectedGloss = glosses[0] || { gloss: t.lemma, lang: 'eng' };
    }
  });

  const translations = [
    { id: 1, lang: 'eng', text: 'The cat sleeps in the house and the dog runs.' },
    { id: 2, lang: 'deu', text: 'Die Katze schläft im Haus und der Hund rennt.' }
  ];

  const conllu = ConlluExporter.export(finAnalysis, translations);
  assert(conllu.includes('# text_eng = The cat sleeps in the house and the dog runs.'));
  assert(conllu.includes('# text_deu = Die Katze schläft im Haus und der Hund rennt.'));
  assert(conllu.includes('Kissa\tkissa\tNOUN'));
  assert(conllu.includes('talossa\ttalo\tNOUN'));
  console.log('✓ CoNLL-U export generated correctly with multi-translations and lemmas');

  const interlinear = InterlinearExporter.exportPlainText(finAnalysis, translations);
  assert(interlinear.includes('a. Original:'));
  assert(interlinear.includes('b. Word form:'));
  assert(interlinear.includes('c. Morphology:'));
  assert(interlinear.includes('d. Gloss:'));
  assert(interlinear.includes('e. Translation [ENG]:'));
  assert(interlinear.includes('e. Translation [DEU]:'));
  console.log('✓ Interlinear 5-line export generated correctly');

  const verdd = VerddExporter.exportBlock(finAnalysis, translations, 'fin', 'all');
  assert(verdd.includes('[fin]'));
  console.log('✓ Ve\'rdd lexicon export generated correctly');

  // Test 6: Verify WorkbenchApp token count helper and methods
  console.log('\n--- 6. Testing WorkbenchApp Helper Methods ---');
  assert.strictEqual(typeof WorkbenchApp.prototype.getTotalTokenCount, 'function', 'getTotalTokenCount must be a function');
  assert.strictEqual(typeof WorkbenchApp.prototype.renderTokenCards, 'function', 'renderTokenCards must be a function');
  const mockApp = {
    sentences: [
      { tokens: [1, 2, 3] },
      { tokens: [4, 5] }
    ]
  };
  const count = WorkbenchApp.prototype.getTotalTokenCount.call(mockApp);
  assert.strictEqual(count, 5, 'Total token count must correctly sum all tokens');
  console.log('✓ WorkbenchApp.getTotalTokenCount() verified (5 tokens)');

  // Test 7: Verify Komi-Permyak (koi) Analysis & Multi-Language Dictionaries («мунісӧ»)
  console.log('\n--- 7. Testing Komi-Permyak (koi) UralicNLP Analysis & Dictionaries («мунісӧ») ---');
  await analyzerService.setLanguage('koi');
  const koiWordAnalyses = analyzerService.analyze_word('мунісӧ', 'koi');
  assert(koiWordAnalyses.length > 0, 'Komi-Permyak word "мунісӧ" must produce morphological readings');
  const koiFirstReading = koiWordAnalyses[0];
  assert.strictEqual(koiFirstReading.lemma, 'мунны', 'Lemma for "мунісӧ" must be "мунны"');
  assert.strictEqual(koiFirstReading.upos, 'VERB', 'UPOS for "мунісӧ" must be VERB');
  assert(koiFirstReading.feats.includes('Tense=Past'), 'Feats must indicate past tense');
  assert(koiFirstReading.feats.includes('Number=Plur'), 'Feats must indicate plural');
  console.log(`✓ Komi-Permyak "мунісӧ" successfully analyzed -> Lemma: "${koiFirstReading.lemma}" (UPOS: ${koiFirstReading.upos}, FEATS: ${koiFirstReading.feats})`);

  // Analyze sentence in koi
  const koiSentAnalysis = await analyzerService.analyzeText('Мунісӧ.', 'koi');
  assert.strictEqual(koiSentAnalysis.length, 1);
  const koiSentToks = koiSentAnalysis[0].tokens;
  assert.strictEqual(koiSentToks[0].form, 'Мунісӧ');
  assert.strictEqual(koiSentToks[0].lemma, 'мунны');
  assert.strictEqual(koiSentToks[0].upos, 'VERB');
  console.log(`✓ Sentence analysis for "Мунісӧ." correctly extracted token lemma: "${koiSentToks[0].lemma}"`);

  // Multilingual dictionary gloss lookups for koi lemma "мунны"
  const koiGlossesEng = dictionaryService.lookupGlosses('мунны', 'koi', 'eng');
  assert(koiGlossesEng.some(g => g.gloss === 'go' || g.gloss === 'leave'), 'English glosses for "мунны" must include "go" or "leave"');

  const koiGlossesRus = dictionaryService.lookupGlosses('мунны', 'koi', 'rus');
  assert(koiGlossesRus.some(g => g.gloss.includes('идти') || g.gloss.includes('пойти')), 'Russian glosses for "мунны" must include "идти" or "пойти"');

  const koiGlossesFin = dictionaryService.lookupGlosses('мунны', 'koi', 'fin');
  assert(koiGlossesFin.some(g => g.gloss.includes('mennä') || g.gloss.includes('kulkea')), 'Finnish glosses for "мунны" must include "mennä" or "kulkea"');
  console.log(`✓ Multilingual dictionary lookups for koi lemma "мунны" verified: English (go), Russian (идти), Finnish (mennä)`);

  // Packaged koi dictionary lookup
  const koiKorGlosses = dictionaryService.lookupGlosses('кӧр', 'koi', 'all');
  assert(koiKorGlosses.some(g => g.gloss === 'кор' && g.lang === 'kpv'), 'Packaged dict-koi.tsv must provide Komi-Zyrian equivalent "кор" for "кӧр"');
  assert(koiKorGlosses.some(g => g.gloss === 'when' && g.lang === 'eng'), 'Packaged dict bridging must provide English translation "when" for "кӧр"');
  console.log(`✓ Packaged koi dictionary lookup for "кӧр" verified: kpv (кор), eng (when)`);

  console.log('\n🎉 ALL LANGUAGE SELECTION & MULTI-LANG GLOSSING TESTS PASSED! 🎉');
}

runLanguageSelectionTests();
