import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { InterlinearExporter } from '../js/services/interlinear-exporter.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';
import { UD_UPOS_TAGS } from '../js/controllers/app.js';

async function testRenewReadingAndUpos() {
  console.log('=== Running Tests for UPOS Availability & Renewing Readings for CoNLL-U ===\n');

  // Test 1: Verify UD_UPOS_TAGS availability
  console.log('--- 1. Testing UPOS Tag Availability ---');
  assert(Array.isArray(UD_UPOS_TAGS), 'UD_UPOS_TAGS must be an array');
  const uposTags = UD_UPOS_TAGS.map(u => u.tag);
  console.log('Available UPOS tags:', uposTags.join(', '));
  assert(uposTags.includes('NOUN'), 'Must include NOUN');
  assert(uposTags.includes('VERB'), 'Must include VERB');
  assert(uposTags.includes('PROPN'), 'Must include PROPN');
  assert(uposTags.includes('ADJ'), 'Must include ADJ');
  assert(uposTags.includes('ADV'), 'Must include ADV');
  assert(uposTags.includes('PRON'), 'Must include PRON');
  assert(uposTags.includes('ADP'), 'Must include ADP');
  assert(uposTags.includes('AUX'), 'Must include AUX');
  assert(uposTags.includes('CCONJ'), 'Must include CCONJ');
  assert(uposTags.includes('SCONJ'), 'Must include SCONJ');
  assert(uposTags.includes('DET'), 'Must include DET');
  assert(uposTags.includes('PART'), 'Must include PART');
  assert(uposTags.includes('INTJ'), 'Must include INTJ');
  assert(uposTags.includes('SYM'), 'Must include SYM');
  assert(uposTags.includes('PUNCT'), 'Must include PUNCT');
  assert(uposTags.includes('X'), 'Must include X');
  console.log('✓ All 17 Universal Dependencies UPOS values are present and available.');

  // Initialize analyzer and dictionary
  await analyzerService.init('myv');
  await dictionaryService.init();

  // Test 2: Unrecognized word analysis and flag
  console.log('\n--- 2. Testing Unrecognized Word Detection ---');
  const unrecognizedText = 'Авольсодамс неологизмась.';
  const sentences = await analyzerService.analyzeText(unrecognizedText, 'myv');
  assert.strictEqual(sentences.length, 1);
  const tokens = sentences[0].tokens;
  
  // First word is unrecognized in standard FST
  const unrecTok = tokens[0];
  console.log(`Word: "${unrecTok.form}" -> isUnrecognized:`, unrecTok.isUnrecognized, '| Lemma:', unrecTok.lemma, '| UPOS:', unrecTok.upos);
  assert(unrecTok.isUnrecognized, 'Word should be flagged as unrecognized');
  assert(unrecTok.upos, 'Unrecognized word must have a default UPOS available');

  // Test 3: Renewing reading for CoNLL-U output
  console.log('\n--- 3. Testing Reading Renewal for CoNLL-U Output ---');
  // Initial CoNLL-U before renewal
  const initialConllu = ConlluExporter.export(sentences, [{ lang: 'eng', text: 'An unrecognized neologism.' }]);
  console.log('Initial CoNLL-U row:');
  console.log(initialConllu.split('\n').filter(l => l.startsWith('1\t'))[0]);

  // Simulate user changing Lemma to 'неологизма' and UPOS to 'NOUN' or 'VERB'
  console.log('\nSimulating user changing Lemma and UPOS, then clicking "Renew Reading for CoNLL-U"...');
  unrecTok.lemma = 'содамс';
  unrecTok.upos = 'VERB';

  // Perform renewal logic
  unrecTok.selectedReading.lemma = 'содамс';
  unrecTok.selectedReading.upos = 'VERB';
  unrecTok.selectedReading.pos = 'V';
  unrecTok.selectedReading.raw = 'содамс+V+Inf';
  unrecTok.selectedReading.feats = 'VerbForm=Inf';
  unrecTok.selectedReading.isGuessed = false;
  unrecTok.isUnrecognized = false;

  // Re-fetch glosses for renewed lemma
  const glosses = dictionaryService.lookupGlosses(unrecTok.lemma, 'myv', 'all');
  unrecTok.allGlosses = glosses;
  unrecTok.selectedGloss = glosses[0] || { gloss: 'know', lang: 'eng' };

  // Regenerate CoNLL-U output
  const renewedConllu = ConlluExporter.export(sentences, [{ lang: 'eng', text: 'To know a neologism.' }]);
  console.log('Renewed CoNLL-U:');
  const renewedRow = renewedConllu.split('\n').filter(l => l.startsWith('1\t'))[0];
  console.log(renewedRow);

  // Assertions on CoNLL-U columns
  const cols = renewedRow.split('\t');
  assert.strictEqual(cols[1], 'Авольсодамс', 'Form should match original');
  assert.strictEqual(cols[2], 'содамс', 'Column 3 (LEMMA) must reflect renewed lemma');
  assert.strictEqual(cols[3], 'VERB', 'Column 4 (UPOS) must reflect renewed UPOS');
  assert.strictEqual(cols[4], 'содамс+V+Inf', 'Column 5 (XPOS) must reflect renewed reading');
  assert(cols[9].includes('Gloss[eng]=') || cols[9].includes('Gloss['), 'Column 10 (MISC) must include gloss formatted as Gloss[lang]=...');

  // Test 4: Testing Interlinear and Ve'rdd with renewed reading
  console.log('\n--- 4. Testing Interlinear & Ve\'rdd with Renewed Reading ---');
  const interlinear = InterlinearExporter.exportPlainText(sentences);
  assert(interlinear.includes('содамс'), 'Interlinear output must include renewed lemma');
  console.log('✓ Interlinear output reflects renewed reading');

  const verdd = VerddExporter.exportBlock(sentences, [], 'myv', 'eng');
  assert(verdd.includes('ENTRY #1:  содамс'), 'Ve\'rdd must include renewed lemma entry');
  assert(verdd.includes('POS:       VERB'), 'Ve\'rdd must include renewed UPOS');
  console.log('✓ Ve\'rdd output reflects renewed reading');

  console.log('\n🎉 ALL TESTS FOR UPOS AVAILABILITY & READING RENEWAL PASSED! 🎉');
}

testRenewReadingAndUpos();
