import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { InterlinearExporter } from '../js/services/interlinear-exporter.js';

async function testArbitraryText() {
  console.log('=== Testing Arbitrary Text Morphological Analysis with analyze_word ===');

  await analyzerService.init('myv');
  await dictionaryService.init();

  // 1. Test analyze_word directly
  console.log('\n--- 1. Testing analyze_word for Erzya ---');
  const readingsMolyams = analyzerService.analyze_word('молян', 'myv');
  assert(readingsMolyams.length > 0, 'Should find readings for молян');
  assert.strictEqual(readingsMolyams[0].lemma, 'молемс', 'Lemma for молян should be молемс');
  assert.strictEqual(readingsMolyams[0].upos, 'VERB', 'UPOS for молян should be VERB');
  console.log('✓ analyze_word("молян", "myv") -> Lemma:', readingsMolyams[0].lemma, '| Reading:', readingsMolyams[0].raw);

  const readingsOshov = analyzerService.analyze_word('ошов', 'myv');
  assert(readingsOshov.length > 0, 'Should find readings for ошов');
  assert.strictEqual(readingsOshov[0].lemma, 'ош', 'Lemma for ошов should be ош');
  assert.strictEqual(readingsOshov[0].upos, 'NOUN', 'UPOS for ошов should be NOUN');
  console.log('✓ analyze_word("ошов", "myv") -> Lemma:', readingsOshov[0].lemma, '| Reading:', readingsOshov[0].raw);

  // 2. Test analyzeText on a full arbitrary sentence
  console.log('\n--- 2. Testing analyzeText on arbitrary sentence ---');
  const arbitrarySentence = 'Течи мон молян ошов ды ловнан книгат.';
  const sentences = await analyzerService.analyzeText(arbitrarySentence, 'myv');

  assert.strictEqual(sentences.length, 1);
  const tokens = sentences[0].tokens;
  assert.strictEqual(tokens.length, 8); // 7 words + 1 punct

  // Check each token has a real lemma
  const expectedLemmas = ['течи', 'мон', 'молемс', 'ош', 'ды', 'ловномс', 'книга', '.'];
  tokens.forEach((t, i) => {
    assert.strictEqual(t.lemma, expectedLemmas[i], `Token ${t.form} expected lemma ${expectedLemmas[i]}, got ${t.lemma}`);
    console.log(`  Word ${t.id}: "${t.form}" => Lemma: "${t.lemma}", UPOS: ${t.selectedReading.upos}, Raw: "${t.selectedReading.raw}"`);
  });

  // 3. Test dictionary lookup for each lemma
  console.log('\n--- 3. Testing dictionary lookup for arbitrary words ---');
  for (const t of tokens) {
    if (!t.isPunct) {
      const glosses = dictionaryService.lookupGlosses(t.lemma, 'myv', 'eng');
      t.selectedGloss = glosses[0] || null;
      console.log(`  Lemma: "${t.lemma}" => Gloss: "${t.selectedGloss ? t.selectedGloss.gloss : '(none)'}"`);
    }
  }

  // 4. Test CoNLL-U and Interlinear exports
  const conllu = ConlluExporter.export(sentences, [{ lang: 'eng', text: 'Today I go to town and read books.' }]);
  assert(conllu.includes('молян\tмолемс\tVERB'));
  assert(conllu.includes('ошов\tош\tNOUN'));
  console.log('\n✓ CoNLL-U output verified with real lemmas:');
  console.log(conllu.split('\n').slice(0, 8).join('\n'));

  console.log('\n🎉 ALL ARBITRARY TEXT TESTS PASSED SUCCESSFULLY! 🎉');
}

testArbitraryText();
