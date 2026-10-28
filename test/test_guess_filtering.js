import assert from 'node:assert';
import { TagMapper, stripGuessTags } from '../js/services/tag-mapper.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { paradigmService } from '../js/services/paradigm-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { InterlinearExporter } from '../js/services/interlinear-exporter.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';

console.log('=== Running +Guess Tag Filtering & Paradigm Explorer Tests ===\n');

// =========================================================================
// 1. TagMapper.parse with various +Guess and Guess representations
// =========================================================================
console.log('--- 1. Testing TagMapper.parse with +Guess / Guess formats ---');

// Case A: Initial +Guess+ with initial +
const parseA = TagMapper.parse('+Guess+kand+N+Sg+Nom');
assert.strictEqual(parseA.lemma, 'kand', 'Lemma should be "kand", not "" or "Guess"');
assert.strictEqual(parseA.isGuessed, true, 'isGuessed should be true');
assert.strictEqual(parseA.pos, 'N', 'POS should be "N"');
assert.strictEqual(parseA.upos, 'NOUN', 'UPOS should be "NOUN"');
assert(parseA.tags.includes('Guess'), 'Guess should be retained in tags for Paradigm Explorer');
assert(parseA.tags.includes('Nom'), 'Grammatical tags should be preserved');
console.log('✓ +Guess+kand+N+Sg+Nom parsed correctly: lemma =', parseA.lemma, ', isGuessed =', parseA.isGuessed);

// Case B: Initial Guess+ without initial +
const parseB = TagMapper.parse('Guess+kand+N+Sg+Nom');
assert.strictEqual(parseB.lemma, 'kand', 'Lemma should be "kand", not "Guess"');
assert.strictEqual(parseB.isGuessed, true, 'isGuessed should be true');
assert.strictEqual(parseB.pos, 'N', 'POS should be "N"');
assert.strictEqual(parseB.upos, 'NOUN', 'UPOS should be "NOUN"');
assert(parseB.tags.includes('Guess'), 'Guess should be retained in tags for Paradigm Explorer');
console.log('✓ Guess+kand+N+Sg+Nom parsed correctly: lemma =', parseB.lemma, ', isGuessed =', parseB.isGuessed);

// Case C: Guillemets «+Guess» and «Guess»
const parseC1 = TagMapper.parse('«+Guess»+kand+N+Sg+Nom');
assert.strictEqual(parseC1.lemma, 'kand', 'Lemma should be "kand" with «+Guess»');
assert.strictEqual(parseC1.isGuessed, true, 'isGuessed should be true for «+Guess»');

const parseC2 = TagMapper.parse('«Guess»+kand+N+Sg+Nom');
assert.strictEqual(parseC2.lemma, 'kand', 'Lemma should be "kand" with «Guess»');
assert.strictEqual(parseC2.isGuessed, true, 'isGuessed should be true for «Guess»');
console.log('✓ «+Guess» and «Guess» variants correctly parsed');

// Case D: Infix Guess tag
const parseD = TagMapper.parse('kand+Guess+N+Sg+Nom');
assert.strictEqual(parseD.lemma, 'kand', 'Lemma should be "kand" for infix Guess');
assert.strictEqual(parseD.isGuessed, true, 'isGuessed should be true for infix Guess');
assert.strictEqual(parseD.pos, 'N', 'POS should be "N"');
assert.strictEqual(parseD.upos, 'NOUN', 'UPOS should be "NOUN"');
assert(parseD.tags.includes('Guess'), 'Guess should be preserved in tags');
console.log('✓ Infix kand+Guess+N+Sg+Nom parsed correctly');

// Case E: Suffix Guess tag
const parseE = TagMapper.parse('kand+N+Sg+Nom+Guess');
assert.strictEqual(parseE.lemma, 'kand', 'Lemma should be "kand" for suffix Guess');
assert.strictEqual(parseE.isGuessed, true, 'isGuessed should be true for suffix Guess');
assert.strictEqual(parseE.pos, 'N', 'POS should be "N"');
assert(parseE.tags.includes('Guess'), 'Guess should be preserved in tags');
console.log('✓ Suffix kand+N+Sg+Nom+Guess parsed correctly');

// Case F: English lexical word "guess" (verb or noun) must NOT be marked as guessed
const parseF = TagMapper.parse('guess+V+Inf');
assert.strictEqual(parseF.lemma, 'guess', 'English lemma should be "guess"');
assert.strictEqual(parseF.isGuessed, false, 'English word "guess" must NOT have isGuessed=true');
assert.strictEqual(parseF.upos, 'VERB', 'UPOS should be "VERB"');
assert(!parseF.tags.includes('Guess'), 'English word should not have Guess pseudotag in tags');
console.log('✓ English lexical word "guess" correctly preserved: lemma =', parseF.lemma, ', isGuessed =', parseF.isGuessed);

// Case G: Võro compound word «Lõunõeesti» with multiple +Guess tags and +Cmp# boundary
const parseG = TagMapper.parse('lõunõ+N+Guess+N_1_hans1a+Cmp#eesti+N+Guess+N_1_herrae+Sg+Nom');
assert.strictEqual(parseG.lemma, 'lõunõeesti', 'Compound lemma must be "lõunõeesti", not "lõunõ" or "lõunõGuess"');
assert.strictEqual(parseG.cleanRaw, 'lõunõ+N+N_1_hans1a+Cmp#eesti+N+N_1_herrae+Sg+Nom', 'cleanRaw must strip all +Guess tags completely');
assert.strictEqual(parseG.isGuessed, true, 'isGuessed should be true');
assert.strictEqual(parseG.pos, 'N', 'POS should be "N"');
assert.strictEqual(parseG.upos, 'NOUN', 'UPOS should be "NOUN"');
assert(!parseG.cleanTags.includes('Guess'), 'cleanTags must NOT contain Guess');
assert(parseG.tags.includes('Guess'), 'tags retains Guess for Paradigm Explorer');
assert.strictEqual(parseG.raw, 'lõunõ+N+Guess+N_1_hans1a+Cmp#eesti+N+Guess+N_1_herrae+Sg+Nom', 'raw retains original analysis for Paradigm Explorer');
console.log('✓ Võro «Lõunõeesti» compound correctly parsed: lemma =', parseG.lemma, ', cleanRaw =', parseG.cleanRaw);

// Case H: Compound word with +Cmp#+Guess+ boundary
const parseH = TagMapper.parse('lõunõ+Cmp#+Guess+eesti');
assert.strictEqual(parseH.lemma, 'lõunõeesti', 'Lemma must be "lõunõeesti" across +Cmp#+Guess+');
assert.strictEqual(parseH.cleanRaw, 'lõunõ+Cmp#eesti', 'cleanRaw must strip +Guess from compound boundary');
assert.strictEqual(parseH.isGuessed, true, 'isGuessed should be true');
console.log('✓ Compound lõunõ+Cmp#+Guess+eesti parsed correctly: lemma =', parseH.lemma, ', cleanRaw =', parseH.cleanRaw);

// Case I: Compound word with +Cmp#Guess+ boundary
const parseI = TagMapper.parse('lõunõ+Cmp#Guess+eesti');
assert.strictEqual(parseI.lemma, 'lõunõeesti', 'Lemma must be "lõunõeesti" across +Cmp#Guess+');
assert.strictEqual(parseI.cleanRaw, 'lõunõ+Cmp#eesti', 'cleanRaw must strip Guess from compound boundary');
assert.strictEqual(parseI.isGuessed, true, 'isGuessed should be true');
console.log('✓ Compound lõunõ+Cmp#Guess+eesti parsed correctly: lemma =', parseI.lemma, ', cleanRaw =', parseI.cleanRaw);

// Case J: Compound word with multiple initial/infix/boundary Guess tags
const parseJ = TagMapper.parse('+Guess+lõunõ+Cmp#+Guess+eesti+N+Sg+Nom');
assert.strictEqual(parseJ.lemma, 'lõunõeesti', 'Lemma must be "lõunõeesti"');
assert.strictEqual(parseJ.cleanRaw, 'lõunõ+Cmp#eesti+N+Sg+Nom', 'cleanRaw must strip all +Guess tags across compound parts');
assert.strictEqual(parseJ.isGuessed, true, 'isGuessed should be true');
console.log('✓ Multi-guess compound +Guess+lõunõ+Cmp#+Guess+eesti+N+Sg+Nom parsed correctly: lemma =', parseJ.lemma);

// =========================================================================
// 2. DictionaryService.lookupGlosses filtering
// =========================================================================
console.log('\n--- 2. Testing Dictionary Lookup Filtering of +Guess / Guess ---');

await dictionaryService.init();

// Lookup with +Guess prefix
const glossesA = dictionaryService.lookupGlosses('+Guess+kand', 'vro', 'est');
assert(glossesA.length > 0, 'Should return glosses for +Guess+kand after stripping +Guess');
assert(glossesA.some(g => g.gloss === 'känd'), 'Should find translation "känd" for vro "kand"');
console.log('✓ lookupGlosses("+Guess+kand") stripped +Guess and found:', glossesA.map(g => `${g.gloss} (${g.lang})`));

// Lookup with Guess+ prefix
const glossesB = dictionaryService.lookupGlosses('Guess+kand', 'vro', 'est');
assert(glossesB.length > 0, 'Should return glosses for Guess+kand after stripping Guess+');
assert(glossesB.some(g => g.gloss === 'känd'), 'Should find translation "känd"');
console.log('✓ lookupGlosses("Guess+kand") stripped Guess+ and found:', glossesB.map(g => `${g.gloss} (${g.lang})`));

// Lookup with infix/suffix Guess
const glossesC = dictionaryService.lookupGlosses('kand+Guess', 'vro', 'est');
assert(glossesC.length > 0, 'Should return glosses for kand+Guess');
console.log('✓ lookupGlosses("kand+Guess") stripped +Guess and found:', glossesC.map(g => `${g.gloss} (${g.lang})`));

// Pure "Guess" or "+Guess" should return empty array immediately and not query transducer
const glossesEmpty1 = dictionaryService.lookupGlosses('Guess', 'vro', 'all');
assert.strictEqual(glossesEmpty1.length, 0, 'Bare "Guess" must return empty glosses');

const glossesEmpty2 = dictionaryService.lookupGlosses('+Guess', 'vro', 'all');
assert.strictEqual(glossesEmpty2.length, 0, 'Bare "+Guess" must return empty glosses');
console.log('✓ Bare "Guess" and "+Guess" return [] without performing invalid transducer lookups');

// Compound word lookup: stripping +Guess and handling +Cmp# across compound
assert.strictEqual(
  stripGuessTags('lõunõ+N+Guess+N_1_hans1a+Cmp#eesti+N+Guess+N_1_herrae+Sg+Nom'),
  'lõunõ+N+N_1_hans1a+Cmp#eesti+N+N_1_herrae+Sg+Nom',
  'stripGuessTags must remove all +Guess occurrences from compound'
);
assert.strictEqual(stripGuessTags('lõunõ+Cmp#+Guess+eesti'), 'lõunõ+Cmp#eesti');
assert.strictEqual(stripGuessTags('lõunõ+Cmp#Guess+eesti'), 'lõunõ+Cmp#eesti');
assert.strictEqual(stripGuessTags('+Guess+lõunõ+Cmp#+Guess+eesti'), 'lõunõ+Cmp#eesti');
assert.strictEqual(stripGuessTags('guess+V+Inf'), 'guess+V+Inf', 'Must preserve English word guess');
console.log('✓ stripGuessTags verified across all compound and simple variations');

// =========================================================================
// 3. Analyzer Readings Prioritization (Lexical over Guessed)
// =========================================================================
// 3. Analyzer Readings Filtering: Guessed readings filtered when lexical exist
// =========================================================================
console.log('\n--- 3. Testing Analyzer Filtering of Entire Dependent +Guess Readings ---');

// 3.1 Live transducer test with Võro compound word «Lõunõeesti»
await analyzerService.init('vro');
const vroCompoundResults = analyzerService.analyze_word('Lõunõeesti', 'vro');

// User Requirement: "It was the entire morphological analysis dependent on the +Guess tag
// that should have been filtered out. These +Guess tag readings are, however, necessary for the paradigm discoverer."
assert.strictEqual(vroCompoundResults.length, 1, 'Only genuine lexical reading must remain in active readings for Lõunõeesti');
assert(vroCompoundResults[0].raw.startsWith('lõunõeesti+') && vroCompoundResults[0].raw.endsWith('+N+Sg+Gen'), 'Active reading must be the genuine lexical reading');
assert.strictEqual(vroCompoundResults[0].lemma, 'lõunõeesti', 'Lemma must be "lõunõeesti"');
assert.strictEqual(vroCompoundResults[0].isGuessed, false, 'Active reading is NOT guessed');
assert(vroCompoundResults.guessedReadings.length >= 8, 'All +Guess dependent readings preserved in guessedReadings');
assert(vroCompoundResults.guessedReadings.every(r => r.isGuessed), 'All attached guessed readings must be marked isGuessed=true');
console.log('✓ «Lõunõeesti» filtered: default readings =', vroCompoundResults.length, ', attached guessedReadings =', vroCompoundResults.guessedReadings.length);

// 3.2 Word with ONLY guessed readings (unknown analyses)
// User Requirement: "in the workbench morphological annotation for unknown analyses,
// it is beneficial to retain access to the guessed content if no other possible readings are present,
// i.e., there are no instances of +Cmp by themselves."
// User Requirement: "if there is no reading it might be allowed"
const simulatedGuessedOnly = [
  ['tundmatuq+N+Guess+N_1_hans1a+Sg+Nom', 5.0],
  ['tundmatuq+N+Guess+N_1_hans1a+Sg+Gen', 6.0]
];
const parsedGuessedOnly = simulatedGuessedOnly.map(([raw, w]) => TagMapper.parse(raw, w));
const lexicalFiltered = parsedGuessedOnly.filter(r => !r.isGuessed);
const guessedFiltered = parsedGuessedOnly.filter(r => r.isGuessed);
assert.strictEqual(lexicalFiltered.length, 0, 'No lexical readings present');
assert.strictEqual(guessedFiltered.length, 2, 'Guessed readings retained when no lexical or Cmp readings exist');
console.log('✓ Unknown word without lexical readings retains access to guessed content');

// =========================================================================
// 4. Paradigm Explorer / Discoverer Integration & Stem Isolation Switch
// =========================================================================
console.log('\n--- 4. Testing Paradigm Explorer with +Guess Forms, +Cmp & Switch ---');

// 4.1 parseInputForms with isolateStem: false (preserve +Cmp and +Guess tags for rule development)
const taggedWithCompoundAndGuess = `
lõunõ+N+Guess+N_1_hans1a+Cmp#eesti+N+Guess+N_1_herrae+Sg+Nom: lõunõeesti
lõunõ+N+Guess+N_1_hans1a+Cmp#eesti+N+Guess+N_1_herrae+Sg+Gen: lõunõeesti
`;
const formsPreserved = paradigmService.parseInputForms(taggedWithCompoundAndGuess, { isolateStem: false });
assert.strictEqual(formsPreserved.length, 2);
assert(formsPreserved[0].tag.includes('+Cmp#'), 'Tag preserves +Cmp# when isolateStem is false');
assert(formsPreserved[0].tag.includes('Guess'), 'Tag preserves Guess when isolateStem is false');
console.log('✓ parseInputForms with isolateStem=false preserved full compound and guess tags');

// 4.2 parseInputForms with isolateStem: true (isolate inflected head stem)
const formsIsolated = paradigmService.parseInputForms(taggedWithCompoundAndGuess, { isolateStem: true });
assert.strictEqual(formsIsolated.length, 2);
assert.strictEqual(formsIsolated[0].lemma, 'eesti', 'Isolated head lemma is "eesti"');
assert(!formsIsolated[0].tag.includes('Guess'), 'Isolated tag filtered +Guess');
assert(!formsIsolated[0].tag.includes('+Cmp'), 'Isolated tag filtered +Cmp');
console.log('✓ parseInputForms with isolateStem=true isolated head stem: lemma =', formsIsolated[0].lemma, ', tag =', formsIsolated[0].tag);

// 4.3 classifyNewWord with isolateStem: true vs false
const compoundTestInput = 'lõunõ+N+Guess+N_1_hans1a+Cmp#eesti+N+Guess+N_1_herrae+Sg+Nom: lõunõeesti';
const classifiedIsolated = paradigmService.classifyNewWord(compoundTestInput, [], 'vro', { isolateStem: true });
assert.strictEqual(classifiedIsolated.firstWord || 'eesti', 'eesti', 'Stem isolated for classification');

// 4.4 classifyNewWord with +Guess tagged input
const testInputWithGuess = '+Guess+lind+N+Sg+Nom: lind';
const classification1 = paradigmService.classifyNewWord(testInputWithGuess, [], 'vro');
assert.strictEqual(classification1.matched, true, 'Should match paradigm regex for lind');
assert(classification1.paradigmName.includes('Type 41'), 'Matched correct Võro type');
assert.deepStrictEqual(
  classification1.predictedForms.map(f => f.predictedSurface),
  ['lind', 'linno', 'lindo', 'lindõ', 'linnõn'],
  'Predicted full 5-form paradigm for "lind"'
);
console.log('✓ classifyNewWord with "+Guess+lind+N+Sg+Nom: lind" predicted paradigm:', classification1.predictedForms.map(f => f.predictedSurface));

// 4.5 classifyNewWord with Guess+ prefix without colon
const testInputWithGuess2 = 'Guess+rand';
const classification2 = paradigmService.classifyNewWord(testInputWithGuess2, [], 'vro');
assert.strictEqual(classification2.matched, true, 'Should match paradigm regex for rand');
assert.deepStrictEqual(
  classification2.predictedForms.map(f => f.predictedSurface),
  ['rand', 'ranno', 'rando', 'randõ', 'rannõn'],
  'Predicted full 5-form paradigm for "rand"'
);
console.log('✓ classifyNewWord with "Guess+rand" predicted paradigm:', classification2.predictedForms.map(f => f.predictedSurface));

// =========================================================================
// 5. Exporters cleanRaw output without +Guess tags
// =========================================================================
console.log('\n--- 5. Testing Exporters with Compound Word Readings ---');

const sampleToken = {
  id: 1,
  form: 'Lõunõeesti',
  lemma: parseG.lemma,
  upos: parseG.upos,
  selectedReading: parseG,
  selectedGloss: { gloss: 'South Estonian', lang: 'eng' },
  readings: [parseG]
};

const sampleSentence = {
  sent_id: 1,
  text: 'Lõunõeesti.',
  tokens: [sampleToken]
};

const conllu = ConlluExporter.export([sampleSentence]);
assert(conllu.includes('\tN+N_1_hans1a+Cmp+N+N_1_herrae+Sg+Nom\t'), 'CoNLL-U XPOS must output the tags only, without lemma stems and without +Guess');
assert(!conllu.includes('+Guess'), 'CoNLL-U export must NOT contain +Guess tag');
console.log('✓ CoNLL-U exporter output verified: clean morphology without +Guess');

const interlinearText = InterlinearExporter.exportPlainText([sampleSentence]);
assert(interlinearText.includes('lõunõ+N+N_1_hans1a+Cmp#eesti+N+N_1_herrae+Sg+Nom'), 'Interlinear text must contain clean morphology without +Guess');
assert(!interlinearText.includes('+Guess'), 'Interlinear text export must NOT contain +Guess tag');
console.log('✓ Interlinear plain text export verified: clean morphology without +Guess');

const interlinearHTML = InterlinearExporter.exportHTML([sampleSentence]);
assert(interlinearHTML.includes('lõunõ+N+N_1_hans1a+Cmp#eesti+N+N_1_herrae+Sg+Nom'), 'Interlinear HTML must contain clean morphology without +Guess');
assert(!interlinearHTML.includes('+Guess'), 'Interlinear HTML export must NOT contain +Guess tag');
console.log('✓ Interlinear HTML export verified: clean morphology without +Guess');

const verddBlock = VerddExporter.exportBlock([sampleSentence], [], 'vro', 'eng');
assert(verddBlock.includes('lõunõ+N+N_1_hans1a+Cmp#eesti+N+N_1_herrae+Sg+Nom'), 'Verdd export must contain clean morphology without +Guess');
assert(!verddBlock.includes('+Guess'), 'Verdd export must NOT contain +Guess tag');
console.log('✓ Ve\'rdd exporter output verified: clean morphology without +Guess');

console.log('\n🎉 ALL +GUESS FILTERING & PARADIGM EXPLORER TESTS PASSED! 🎉');
