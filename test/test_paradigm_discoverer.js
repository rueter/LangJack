/**
 * Test Suite: Two-Level Morphology Paradigm Discoverer (Koskenniemi twol)
 * 
 * Verifies:
 * 1. Input parsing: tagged lines, un-tagged lines, space-separated, and dot-segmented.
 * 2. Letter-by-letter expansion & zero-filling:
 *    kand+N+Sg+Nom: k a n d 0 #
 *    kand+N+Sg+Gen: k a n n o #
 *    kand+N+Sg+Par: k a n d o #
 *    kand+N+Pl+Gen: k a n d õ #
 *    kand+N+Pl+Ine: k a n n õ > n
 * 3. Derivation of morphophonemes:
 *    Formula: "k, a, n, {d:d, d:n}, {0oõ}"
 * 4. Human-in-the-loop custom adjustments:
 *    - Morphophoneme renaming (e.g. {d:d, d:n} -> D, {0oõ} -> O)
 *    - Manual alignment adjustments
 * 5. Two-Level Rule (TWOL) generation:
 *    - Consonant gradation rule (d:n <=> ...)
 *    - Stem vowel elision rule ({0oõ}:0 <=> _ # ;)
 * 6. LexC and LexD grammar coordination.
 * 7. Stem Regular Expression derivation.
 * 8. New word paradigm identification and full paradigm prediction:
 *    - Without tags: "lind", "rand", "tund"
 *    - With tags: "lind+N+Sg+Nom: lind"
 */

import assert from 'node:assert';
import { paradigmService, ParadigmService } from '../js/services/paradigm-service.js';

console.log('=== Running Tests for Two-Level Paradigm Discoverer (Koskenniemi twol) ===\n');

// --- 1. Testing Input Parsing ---
console.log('--- 1. Testing Input Parsing ---');
const inputTagged = `kand+N+Sg+Nom: kand
kand+N+Sg+Gen: kanno
kand+N+Sg+Par: kando
kand+N+Pl+Gen: kandõ
kand+N+Pl+Ine: kannõn`;

const parsed = paradigmService.parseInputForms(inputTagged);
assert.strictEqual(parsed.length, 5, 'Must parse exactly 5 forms');
assert.strictEqual(parsed[0].tag, 'kand+N+Sg+Nom');
assert.strictEqual(parsed[0].surface, 'kand');
assert.strictEqual(parsed[0].lemma, 'kand');
assert.strictEqual(parsed[4].tag, 'kand+N+Pl+Ine');
assert.strictEqual(parsed[4].surface, 'kannõn');
console.log('✓ Successfully parsed 5 tagged lines');

// Test un-tagged input
const inputUntagged = `kand\nkanno\nkando\nkandõ\nkannõn`;
const parsedUntagged = paradigmService.parseInputForms(inputUntagged);
assert.strictEqual(parsedUntagged.length, 5);
assert.strictEqual(parsedUntagged[0].surface, 'kand');
assert.strictEqual(parsedUntagged[4].surface, 'kannõn');
console.log('✓ Successfully parsed 5 un-tagged word forms');

// --- 2. Testing Letter-by-Letter Expansion & Zero-Filling ---
console.log('\n--- 2. Testing Letter-by-Letter Expansion & Zero-Filling ---');
const analysis = paradigmService.alignParadigm(parsed);
assert.strictEqual(analysis.forms.length, 5);

const expectedExpansions = [
  'kand+N+Sg+Nom: k a n d 0 #',
  'kand+N+Sg+Gen: k a n n o #',
  'kand+N+Sg+Par: k a n d o #',
  'kand+N+Pl+Gen: k a n d õ #',
  'kand+N+Pl+Ine: k a n n õ > n'
];

expectedExpansions.forEach((expected, idx) => {
  assert.strictEqual(analysis.forms[idx].fullLine, expected, `Line ${idx + 1} must match exact expansion: "${expected}"`);
  console.log(`  ✓ Line ${idx + 1}: ${analysis.forms[idx].fullLine}`);
});

// --- 3. Testing Morphophoneme Derivation & Formula ---
console.log('\n--- 3. Testing Morphophoneme Derivation & Formula ---');
assert.strictEqual(analysis.morphophonemes.length, 5, 'Must derive 5 morphophonemic columns');
assert.strictEqual(analysis.morphophonemes[0].symbol, 'k', 'Col 1 must be invariant "k"');
assert.strictEqual(analysis.morphophonemes[1].symbol, 'a', 'Col 2 must be invariant "a"');
assert.strictEqual(analysis.morphophonemes[2].symbol, 'n', 'Col 3 must be invariant "n"');
assert.strictEqual(analysis.morphophonemes[3].symbol, '{d:d, d:n}', 'Col 4 must be alternation "{d:d, d:n}"');
assert.strictEqual(analysis.morphophonemes[4].symbol, '{0oõ}', 'Col 5 must be vowel alternation "{0oõ}"');

const expectedFormula = 'k, a, n, {d:d, d:n}, {0oõ}';
assert.strictEqual(analysis.formula, expectedFormula, `Formula must be "${expectedFormula}", got "${analysis.formula}"`);
console.log(`✓ Derived exact morphophonemic formula: "${analysis.formula}"`);

// --- 4. Testing Human-in-the-Loop Custom Adjustments ---
console.log('\n--- 4. Testing Human-in-the-Loop Adjustments ---');
// Linguist renames {d:d, d:n} to "D" and {0oõ} to "O"
const customAnalysis = paradigmService.alignParadigm(parsed, {
  renamedMorphophonemes: {
    3: 'D',
    4: 'O'
  }
});
assert.strictEqual(customAnalysis.formula, 'k, a, n, D, O', 'Formula must reflect custom named morphophonemes');
console.log(`✓ Human-in-the-loop morphophoneme renaming verified: "${customAnalysis.formula}"`);

// --- 5. Testing Two-Level Rules (TWOL) Generation ---
console.log('\n--- 5. Testing Two-Level Rules (TWOL) Generation ---');
const twolRes = paradigmService.generateTwolRules(analysis);
assert(twolRes.rules.length >= 2, 'Must generate at least 2 two-level rules (gradation and elision)');

const gradationRule = twolRes.rules.find(r => r.targetPair === 'd:n');
assert(gradationRule, 'Must generate consonant gradation rule for d:n');
assert(gradationRule.twolText.includes('d:n <=>'), 'Rule text must use <=> two-level operator');
assert(gradationRule.twolText.includes('n _'), 'Rule must specify left context after "n"');

const elisionRule = twolRes.rules.find(r => r.targetPair.includes(':0'));
assert(elisionRule, 'Must generate stem vowel elision rule for 0');
assert(elisionRule.twolText.includes('_ #'), 'Elision rule must specify word boundary context');

assert(twolRes.twolGrammar.includes('Alphabet'), 'Grammar must include Alphabet section');
assert(twolRes.twolGrammar.includes('Rules'), 'Grammar must include Rules section');
console.log('✓ Successfully generated valid TWOL two-level rules:');
console.log(gradationRule.twolText.trim());
console.log(elisionRule.twolText.trim());

// --- 6. Testing LexC and LexD Coordination ---
console.log('\n--- 6. Testing LexC and LexD Coordination ---');
const lexcOutput = paradigmService.generateLexc(analysis, 'Noun_kand');
assert(lexcOutput.includes('Multichar_Symbols'), 'LexC must declare Multichar_Symbols');
assert(lexcOutput.includes('LEXICON Root'), 'LexC must declare LEXICON Root');
assert(lexcOutput.includes('LEXICON Noun_kand_Stem'), 'LexC must declare Stem lexicon');
assert(lexcOutput.includes('kan{d:d, d:n}{0oõ}'), 'LexC must contain morphophonemic stem entry');
assert(lexcOutput.includes('kand+N+Pl+Ine:>n    # ;'), 'LexC must contain case suffix continuation');
console.log('✓ LexC grammar generation verified');

const lexdOutput = paradigmService.generateLexd(analysis, 'Noun_kand');
assert(lexdOutput.includes('PATTERNS'), 'LexD must define PATTERNS');
assert(lexdOutput.includes('LEXICON Noun_kandStems'), 'LexD must define stems lexicon');
assert(lexdOutput.includes('LEXICON Noun_kandAffixes'), 'LexD must define affixes lexicon');
assert(lexdOutput.includes('<kand><N><Pl><Ine>:kannõ'), 'LexD must contain tagged stem allomorph');
console.log('✓ LexD grammar generation verified');

// --- 7. Testing Stem Regular Expression Derivation ---
console.log('\n--- 7. Testing Stem Regular Expression Derivation ---');
const regexInfo = paradigmService.deriveStemRegex(analysis);
assert.strictEqual(regexInfo.pattern, '^([a-zõäöüšž]+)nd$', 'Must deduce regex matching -nd stems');
assert.strictEqual(regexInfo.lexcRegex, '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] n [d:"{d:d, d:n}"] 0:"{0oõ}" "+N":0 "+Guess":0 "+N_41_kand":0 > N_41KAND ;', 'Must generate correct morphophonemic guesser rule');
console.log(`✓ Derived stem regex: ${regexInfo.pattern} (${regexInfo.explanation})`);
console.log(`✓ Derived LexC guesser rule: ${regexInfo.lexcRegex}`);

// Test kand with separate singular stem vowel and plural marker columns (kand00, kanno0, kando0, kand0õ, kann0õn)
const kandInputZeros = `kand+N+Sg+Nom: kand00
kand+N+Sg+Gen: kanno0
kand+N+Sg+Par: kando0
kand+N+Pl+Gen: kand0õ
kand+N+Pl+Ine: kann0õn`;
const kandParsedZeros = paradigmService.parseInputForms(kandInputZeros);
const kandAlignedZeros = paradigmService.alignParadigm(kandParsedZeros, { lang: 'vro' });
assert.strictEqual(kandAlignedZeros.formula, 'k, a, n, {d:d, d:n}, {0:0, 0:o}, {0:0, 0:õ}');
const kandRegexZeros = paradigmService.deriveStemRegex(kandAlignedZeros);
assert.strictEqual(kandRegexZeros.lexcRegex, '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|e|i|o|u|õ|ä|ö|ü] n [d:"{d:d, d:n}"] [0:"{0:0, 0:o}"] [0:"{0:0, 0:õ}"] "+N":0 "+Guess":0 "+N_41_kand":0 > N_41KAND ;', 'Must generate correct 6-column guesser rule with separate singular and plural vowel columns');
const kandStemLine = paradigmService.generateLexcStemLine('kand', { paradigmType: '+N_41_kand' });
assert.strictEqual(kandStemLine, 'kand+N:kan{d:d, d:n}{0:0, 0:o}{0:0, 0:õ} N_41KAND ;');
console.log(`✓ Verified 6-column kand with separate singular stem vowel and plural marker columns: ${kandRegexZeros.lexcRegex}`);

// --- 8. Testing New Word Identification & Paradigm Prediction ---
console.log('\n--- 8. Testing New Word Identification & Paradigm Prediction ---');

// Test 8a: Input new word without tags: "lind" (bird)
const classLind = paradigmService.classifyNewWord('lind');
assert.strictEqual(classLind.matched, true, 'New word "lind" must match paradigm');
assert.strictEqual(classLind.root, 'li', 'Extracted root must be "li"');
assert.strictEqual(classLind.predictedForms.length, 5, 'Must predict 5 paradigm forms');

const predMapLind = {};
classLind.predictedForms.forEach(p => { predMapLind[p.tag] = p.predictedSurface; });
assert.strictEqual(predMapLind['kand+N+Sg+Nom'], 'lind', 'Predicted Nom must be "lind"');
assert.strictEqual(predMapLind['kand+N+Sg+Gen'], 'linno', 'Predicted Gen must be "linno"');
assert.strictEqual(predMapLind['kand+N+Sg+Par'], 'lindo', 'Predicted Par must be "lindo"');
assert.strictEqual(predMapLind['kand+N+Pl+Gen'], 'lindõ', 'Predicted Pl Gen must be "lindõ"');
assert.strictEqual(predMapLind['kand+N+Pl+Ine'], 'linnõn', 'Predicted Pl Ine must be "linnõn"');
console.log('✓ Successfully classified "lind" -> predicted [lind, linno, lindo, lindõ, linnõn]');

// Test 8b: Input new word: "rand" (beach/shore)
const classRand = paradigmService.classifyNewWord('rand');
assert.strictEqual(classRand.matched, true);
assert.strictEqual(classRand.root, 'ra');
const predMapRand = {};
classRand.predictedForms.forEach(p => { predMapRand[p.tag] = p.predictedSurface; });
assert.strictEqual(predMapRand['kand+N+Sg+Gen'], 'ranno');
assert.strictEqual(predMapRand['kand+N+Pl+Ine'], 'rannõn');
console.log('✓ Successfully classified "rand" -> predicted [rand, ranno, rando, randõ, rannõn]');

// Test 8c: Input with tags: "tund+N+Sg+Nom: tund"
const classTund = paradigmService.classifyNewWord('tund+N+Sg+Nom: tund');
assert.strictEqual(classTund.matched, true);
assert.strictEqual(classTund.root, 'tu');
const predMapTund = {};
classTund.predictedForms.forEach(p => { predMapTund[p.tag] = p.predictedSurface; });
assert.strictEqual(predMapTund['kand+N+Sg+Nom'], 'tund');
assert.strictEqual(predMapTund['kand+N+Sg+Gen'], 'tunno');
assert.strictEqual(predMapTund['kand+N+Pl+Ine'], 'tunnõn');
console.log('✓ Successfully classified "tund" with tags -> predicted [tund, tunno, tundo, tundõ, tunnõn]');

// --- 9. Testing Language Indication & Custom Paradigm Saving ---
console.log('\n--- 9. Testing Language Indication & Custom Paradigm Saving ---');
const customMyvInput = `тейтерь+N+SP+Nom: тейтерь
тейтерь+N+Sg+Gen: тейтеренть
тейтерь+N+Sg+Ine: тейтерьсэ
тейтерь+N+Pl+Nom: тейтерть`;

const parsedMyv = paradigmService.parseInputForms(customMyvInput);
assert.strictEqual(parsedMyv.length, 4, 'Must parse 4 forms for custom Erzya input');
assert.strictEqual(parsedMyv[0].lemma, 'тейтерь');

// Align with indicated language
const myvAnalysis = paradigmService.alignParadigm(parsedMyv, { lang: 'myv' });
assert.strictEqual(myvAnalysis.lang, 'myv', 'Analysis must retain indicated language "myv"');

// Check TWOL, LexC, and LexD generated with language indication
const myvTwol = paradigmService.generateTwolRules(myvAnalysis, { lang: 'myv' });
assert(myvTwol.twolGrammar.includes('! Language: myv'), 'TWOL header must indicate language');

const myvLexc = paradigmService.generateLexc(myvAnalysis, 'Noun_teyter', { lang: 'myv' });
assert(myvLexc.includes('! Language: myv'), 'LexC header must indicate language');

const myvLexd = paradigmService.generateLexd(myvAnalysis, 'Noun_teyter', { lang: 'myv' });
assert(myvLexd.includes('# Language: myv'), 'LexD header must indicate language');

// Save custom paradigm into service library
const savedModel = paradigmService.saveCustomParadigm({
  id: 'custom_myv_teyter',
  name: 'MYV Custom: тейтерь (girl)',
  lang: 'myv',
  pos: 'N',
  text: customMyvInput,
  description: 'Custom Erzya noun paradigm'
});
assert.strictEqual(savedModel.id, 'custom_myv_teyter');
assert(paradigmService.savedParadigms.some(p => p.id === 'custom_myv_teyter'), 'Must persist custom paradigm');
console.log('✓ Language indication and custom paradigm saving verified');

// --- 10. Testing Finnish mäki with Stem Triggers (F) & Morpheme Boundaries (>) ---
console.log('\n--- 10. Testing Finnish mäki with Stem Triggers (F) & Morpheme Boundaries (>) ---');
const finnMakiInput = `mäki+N+Sg+Nom: mäki0F#
mäki+N+Sg+Gen: mä0e0F>n
mäki+N+Sg+Par: mäke0F>ä
mäki+N+Sg+Ine: mä0e0F>ssä
mäki+N+Pl+Ine: mä00iF>ssä`;

const parsedMaki = paradigmService.parseInputForms(finnMakiInput);
assert.strictEqual(parsedMaki.length, 5);

const makiAnalysis = paradigmService.alignParadigm(parsedMaki, { lang: 'fin' });

const expectedMakiExpansions = [
  'mäki+N+Sg+Nom: m ä k i 0 F #',
  'mäki+N+Sg+Gen: m ä 0 e 0 F > n',
  'mäki+N+Sg+Par: m ä k e 0 F > ä',
  'mäki+N+Sg+Ine: m ä 0 e 0 F > s s ä',
  'mäki+N+Pl+Ine: m ä 0 0 i F > s s ä'
];

expectedMakiExpansions.forEach((expected, idx) => {
  assert.strictEqual(makiAnalysis.forms[idx].fullLine, expected, `Form ${idx + 1} must match: "${expected}"`);
  console.log(`  ✓ Form ${idx + 1}: ${makiAnalysis.forms[idx].fullLine}`);
});

// Verify no extra columns (7 and 8) were inserted before 'n' in Genitive
const genForm = makiAnalysis.forms[1];
assert.strictEqual(genForm.stemChars.length, 6, 'Genitive stem must have exactly 6 characters (m ä 0 e 0 F)');
assert.strictEqual(genForm.boundaryPart, '> n', 'Genitive boundary part must be clean "> n"');
assert(!genForm.fullLine.includes('0 > n'), 'Must NOT insert extra "0 >" before final "n"');

// Verify Partitive does not have '#' appended
const parForm = makiAnalysis.forms[2];
assert.strictEqual(parForm.stemChars.length, 6, 'Partitive stem must have exactly 6 characters (m ä k e 0 F)');
assert.strictEqual(parForm.boundaryPart, '> ä', 'Partitive boundary part must be clean "> ä"');
assert(!parForm.fullLine.endsWith('#'), 'Partitive must NOT end with "#"');

// Verify morphophonemes and trigger F
assert.strictEqual(makiAnalysis.morphophonemes[0].symbol, 'm');
assert.strictEqual(makiAnalysis.morphophonemes[1].symbol, 'ä');
assert.strictEqual(makiAnalysis.morphophonemes[2].symbol, '{k:k, k:0}'); // Consonant gradation
assert.strictEqual(makiAnalysis.morphophonemes[5].symbol, 'F'); // Invariant stem trigger F

// Verify zero padding before stem trigger F when stem is shorter
const shortInput = `mäki+N+Sg+Nom: mäkiF#
mäki+N+Sg+Gen: mä0e0F>n`;
const parsedShort = paradigmService.parseInputForms(shortInput);
const shortAnalysis = paradigmService.alignParadigm(parsedShort);
assert.strictEqual(shortAnalysis.forms[0].fullLine, 'mäki+N+Sg+Nom: m ä k i 0 F #', 'Must insert 0 before stem trigger F');

// Verify TWOL rules contain front-vowel harmony trigger F:0 and agreement
const makiTwol = paradigmService.generateTwolRules(makiAnalysis, { lang: 'fin' });
assert(makiTwol.rules.some(r => r.targetPair === 'F:0'), 'Must generate F:0 trigger elision rule');
assert(makiTwol.twolGrammar.includes('Triggers = F'), 'Sets section must define Triggers = F');
console.log('✓ Finnish mäki stem trigger (F) and morpheme/word boundary alignment verified');

// --- 11. Testing Võro Type 39 (+N_39_vido), LexC Regex Rule & Multi-Form Narrowing ---
console.log('\n--- 11. Testing Võro Type 39 (+N_39_vido), LexC Regex Rule & Multi-Form Narrowing ---');
const vroVidoPreset = paradigmService.defaultPresets.find(p => p.id === 'vro_type_39_vido');
assert(vroVidoPreset, 'vro_type_39_vido preset must exist');
assert.strictEqual(vroVidoPreset.paradigmType, '+N_39_vido');
assert.strictEqual(vroVidoPreset.continuationLexicon, 'N_39VIDO');

const parsedVido = paradigmService.parseInputForms(vroVidoPreset.text);
assert.strictEqual(parsedVido.length, 4);

const vidoAnalysis = paradigmService.alignParadigm(parsedVido, { lang: 'vro' });

// 1. Verify alignment: zero insertion before stem vowel 'o' for consonant alternation vi0d:vi{tØ}{tdØ}o
const expectedVidoExpansions = [
  'vido+N+Sg+Nom: v i 0 d o #',
  'vido+N+Sg+Gen: v i 0 0 o #',
  'vido+N+Sg+Par: v i 0 t o #',
  'vido+N+Sg+Ill: v i t t o #'
];
expectedVidoExpansions.forEach((expected, idx) => {
  assert.strictEqual(vidoAnalysis.forms[idx].fullLine, expected, `Vido form ${idx + 1} must match: "${expected}"`);
  console.log(`  ✓ Form ${idx + 1}: ${vidoAnalysis.forms[idx].fullLine}`);
});

// 2. Verify morphophonemes and formula
const vidoFormula = vidoAnalysis.morphophonemes.map(m => m.symbol).join(', ');
assert.strictEqual(vidoFormula, 'v, i, {tØ}, {tdØ}, o', 'Morphophonemic formula must be v, i, {tØ}, {tdØ}, o');
console.log(`✓ Morphophonemic formula verified: "${vidoFormula}"`);

// 3. Verify LexC regular-expression rule line derivation
const vidoRegexInfo = paradigmService.deriveStemRegex(vidoAnalysis);
const expectedLexcRegex = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "o":0 "+N":0 "+Guess":0 "+N_39_vido":0 > N_39VIDO ;';
assert.strictEqual(vidoRegexInfo.lexcRegex, expectedLexcRegex, 'LexC regex rule line must match exact specification');
assert.strictEqual(vidoRegexInfo.continuationLexicon, 'N_39VIDO');
assert.strictEqual(vidoRegexInfo.paradigmType, '+N_39_vido');
console.log(`✓ LexC regex rule line verified:\n  ${vidoRegexInfo.lexcRegex}`);

// 4. Verify LexC grammar generation includes the regex rule under Root
const vidoLexc = paradigmService.generateLexc(vidoAnalysis, 'N_39VIDO', { lang: 'vro' });
assert(vidoLexc.includes(expectedLexcRegex), 'LexC output must include the one-line regular-expression description');
assert(vidoLexc.includes('LEXICON Root'), 'LexC must contain LEXICON Root');

// 5. Test unknown single word form "kitto" reverse classification to kido+N+Sg+Ill
const singleMatch = paradigmService.classifyNewWord('kitto');
assert.strictEqual(singleMatch.matched, true);
assert.strictEqual(singleMatch.reconstructedLemma, 'kido');
assert.strictEqual(singleMatch.matchedSlot, 'Sg+Ill');
assert.strictEqual(singleMatch.predictedTag, 'kido+N+Sg+Ill');
assert.strictEqual(singleMatch.paradigmId, 'vro_type_39_vido');
assert.strictEqual(singleMatch.predictedForms.length, 4);
assert.strictEqual(singleMatch.predictedForms[0].predictedSurface, 'kido');
assert.strictEqual(singleMatch.predictedForms[1].predictedSurface, 'kio');
assert.strictEqual(singleMatch.predictedForms[2].predictedSurface, 'kito');
assert.strictEqual(singleMatch.predictedForms[3].predictedSurface, 'kitto');
console.log(`✓ Single unknown form "kitto" correctly classified as ${singleMatch.predictedTag} -> [${singleMatch.predictedForms.map(f => f.predictedSurface).join(', ')}]`);

// 6. Test other forms: "kito" (Sg+Par) and "kio" (Sg+Gen)
const parMatch = paradigmService.classifyNewWord('kito');
assert.strictEqual(parMatch.reconstructedLemma, 'kido');
assert.strictEqual(parMatch.matchedSlot, 'Sg+Par');

const genMatch = paradigmService.classifyNewWord('kio');
assert.strictEqual(genMatch.reconstructedLemma, 'kido');
assert.strictEqual(genMatch.matchedSlot, 'Sg+Gen');

// 7. Test multi-form candidate narrowing (kitto, kito)
const multiMatch = paradigmService.classifyNewWord('kitto, kito');
assert.strictEqual(multiMatch.matched, true);
assert.strictEqual(multiMatch.matchedCount, 2);
assert.strictEqual(multiMatch.totalInputCount, 2);
assert.strictEqual(multiMatch.reconstructedLemma, 'kido');
assert(multiMatch.narrowingMessage.includes('2/2 supplied forms'), 'Narrowing message must state 2/2 forms matched');
console.log(`✓ Multi-form input "kitto, kito" narrowed down: ${multiMatch.narrowingMessage}`);

// --- 12. Testing Võro Type 41 (tükk / VES 37), Consonant Degemination & Variant Brackets ---
console.log('\n--- 12. Testing Võro Type 41 (tükk / VES 37), Consonant Degemination & Variant Brackets ---');
const tukkInput = `tükk+N+Sg+Nom: tükk
tükk+N+Sg+Gen: tükü
tükk+N+Sg+Par: tükkü
tükk+N+Sg+Ill: tükkü
tükk+N+Pl+Gen: [tükke, tükkä]
tükk+N+Pl+Ine: [tüken, tükän]`;

const parsedTukk = paradigmService.parseInputForms(tukkInput);
assert.strictEqual(parsedTukk.length, 6, 'Must parse exactly 6 forms for tükk');

const tukkAnalysis = paradigmService.alignParadigm(parsedTukk, { lang: 'vro' });

const expectedTukkExpansions = [
  'tükk+N+Sg+Nom: t ü k k 0 #',
  'tükk+N+Sg+Gen: t ü k 0 ü #',
  'tükk+N+Sg+Par: t ü k k ü #',
  'tükk+N+Sg+Ill: t ü k k ü #',
  'tükk+N+Pl+Gen: t ü k k 0 > e',
  'tükk+N+Pl+Ine: t ü k 0 0 > e n'
];

expectedTukkExpansions.forEach((expected, idx) => {
  assert.strictEqual(tukkAnalysis.forms[idx].fullLine, expected, `Tükk line ${idx + 1} must match: "${expected}"`);
  console.log(`  ✓ Line ${idx + 1}: ${tukkAnalysis.forms[idx].fullLine}`);
});

// Verify morphExpansion for Pl+Gen: {t:t}, {ü:ü}, {k:k}, {k:k, k:0}, {0:0, 0:ü} > e
assert.strictEqual(
  tukkAnalysis.forms[4].morphExpansion,
  '{t:t}, {ü:ü}, {k:k}, {k:k, k:0}, {0:0, 0:ü} > e',
  'Pl+Gen morphExpansion must match {t:t}, {ü:ü}, {k:k}, {k:k, k:0}, {0:0, 0:ü} > e'
);
console.log(`✓ Pl+Gen morph expansion verified: "${tukkAnalysis.forms[4].morphExpansion}"`);

// Verify morphophonemes and formula
const tukkFormula = tukkAnalysis.morphophonemes.map(m => m.symbol).join(', ');
assert.strictEqual(tukkFormula, 't, ü, k, {k:k, k:0}, {0:0, 0:ü}', 'Morphophonemic formula must be "t, ü, k, {k:k, k:0}, {0:0, 0:ü}"');
console.log(`✓ Morphophonemic formula verified: "${tukkFormula}"`);

// Also verify with canonical single forms (tükke, tüken)
const tukkSingleInput = `tükk+N+Sg+Nom: tükk
tükk+N+Sg+Gen: tükü
tükk+N+Sg+Par: tükkü
tükk+N+Sg+Ill: tükkü
tükk+N+Pl+Gen: tükke
tükk+N+Pl+Ine: tüken`;

const parsedSingleTukk = paradigmService.parseInputForms(tukkSingleInput);
const singleAnalysis = paradigmService.alignParadigm(parsedSingleTukk, { lang: 'vro' });
expectedTukkExpansions.forEach((expected, idx) => {
  assert.strictEqual(singleAnalysis.forms[idx].fullLine, expected, `Single input line ${idx + 1} must match: "${expected}"`);
});
assert.strictEqual(singleAnalysis.formula, 't, ü, k, {k:k, k:0}, {0:0, 0:ü}');
console.log('✓ Canonical input (tükke, tüken) produces identical expansions and formula');

// Verify preset registration
const tukkPreset = paradigmService.defaultPresets.find(p => p.id === 'vro_type_41_tuekk');
assert(tukkPreset, 'vro_type_41_tuekk preset must be registered');
assert.strictEqual(tukkPreset.paradigmType, '+N_41_tuekk');
assert.strictEqual(tukkPreset.continuationLexicon, 'N_41TUEKK');
console.log('✓ Võro Type 41 tükk preset verified');

// --- 13. Testing LexC Pattern Evaluation & Extension (+N_39_vido) ---
console.log('\n--- 13. Testing LexC Pattern Evaluation & Extension (+N_39_vido) ---');
const patternVido = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] o "+N":0 "+Guess":0 "+N_39_vido":0 > N_39VIDO ;';

// 1. lado: fits pattern directly
const checkLado = paradigmService.checkAndExtendStemPattern('lado', patternVido);
assert.strictEqual(checkLado.fits, true, 'lado must fit the pattern');
assert.strictEqual(checkLado.extends, false, 'lado does not extend the pattern');
console.log(`✓ lado: ${checkLado.explanation}`);

// 2. mago: fits pattern directly
const checkMago = paradigmService.checkAndExtendStemPattern('mago', patternVido);
assert.strictEqual(checkMago.fits, true, 'mago must fit the pattern');
assert.strictEqual(checkMago.extends, false, 'mago does not extend the pattern');
console.log(`✓ mago: ${checkMago.explanation}`);

// 3. tego: extends vowel set by adding 'e' -> [a|e|o|u|õ]
const checkTego = paradigmService.checkAndExtendStemPattern('tego', patternVido);
assert.strictEqual(checkTego.fits, false, 'tego has vowel "e", so it extends the pattern');
assert.strictEqual(checkTego.extends, true);
assert.deepStrictEqual(checkTego.extensions.newVowels, ['e']);
assert(checkTego.enlargedPattern.includes('[a|e|o|u|õ]'), 'Pattern must enlarge vowel set to [a|e|o|u|õ]');
console.log(`✓ tego: ${checkTego.explanation}`);

// 4. vido: extends vowel set by adding 'i' -> [a|i|o|u|õ]
const checkVido = paradigmService.checkAndExtendStemPattern('vido', patternVido);
assert.strictEqual(checkVido.fits, false, 'vido has vowel "i", so it extends the pattern');
assert.strictEqual(checkVido.extends, true);
assert.deepStrictEqual(checkVido.extensions.newVowels, ['i']);
assert(checkVido.enlargedPattern.includes('[a|i|o|u|õ]'), 'Pattern must enlarge vowel set to [a|i|o|u|õ]');
console.log(`✓ vido: ${checkVido.explanation}`);
console.log(`  Enlarged pattern for vido:\n  ${checkVido.enlargedPattern}`);

// 5. Successive expansion (tego + vido -> [a|e|i|o|u|õ])
const checkBoth = paradigmService.checkAndExtendStemPattern('vido', checkTego.enlargedPattern);
assert(checkBoth.enlargedPattern.includes('[a|e|i|o|u|õ]'), 'Successive addition must yield [a|e|i|o|u|õ]');
console.log(`✓ Successive enlargement with tego & vido: ${checkBoth.enlargedPattern}`);

// 6. nägo: extends vowel set by adding 'ä' -> [a|e|i|o|u|õ|ä]
const checkNago = paradigmService.checkAndExtendStemPattern('nägo', checkBoth.enlargedPattern);
assert.strictEqual(checkNago.fits, false, 'nägo has vowel "ä", so it extends the pattern');
assert.strictEqual(checkNago.extends, true);
assert.deepStrictEqual(checkNago.extensions.newVowels, ['ä']);
assert(checkNago.enlargedPattern.includes('[a|e|i|o|u|õ|ä]'), 'Pattern must enlarge vowel set to [a|e|i|o|u|õ|ä]');
console.log(`✓ nägo: ${checkNago.explanation}`);

// 7. ḱago: extends initial consonants by adding palatalized 'ḱ' -> [b|d|f|g|h|j|k|ḱ|l|m|n|p|r|s|t|v]*
const checkKago = paradigmService.checkAndExtendStemPattern('ḱago', checkNago.enlargedPattern);
assert.strictEqual(checkKago.fits, false, 'ḱago has palatalized "ḱ", so it extends initial consonants');
assert.strictEqual(checkKago.extends, true);
assert.deepStrictEqual(checkKago.extensions.newConsonants, ['ḱ']);
assert(checkKago.enlargedPattern.includes('[b|d|f|g|h|j|k|ḱ|l|m|n|p|r|s|t|v]*'), 'Pattern must include palatalized "ḱ" after "k"');
console.log(`✓ ḱago: ${checkKago.explanation}`);

// 8. kŕabo: onset cluster kŕ (adds palatalized 'ŕ'), stop 'b'
const checkKrabo = paradigmService.checkAndExtendStemPattern('kŕabo', checkKago.enlargedPattern);
assert.strictEqual(checkKrabo.fits, false, 'kŕabo adds palatalized "ŕ" to consonant cluster onset');
assert.strictEqual(checkKrabo.extends, true);
assert.deepStrictEqual(checkKrabo.extensions.newConsonants, ['ŕ']);
assert(checkKrabo.enlargedPattern.includes('[b|d|f|g|h|j|k|ḱ|l|m|n|p|r|ŕ|s|t|v]*'), 'Pattern must include palatalized "ŕ" after "r"');
assert.strictEqual(checkKrabo.analysis.stop, 'b', 'Stop must be "b" (activating 0:"{pØ}" b:"{pbv}")');
console.log(`✓ kŕabo: ${checkKrabo.explanation}`);
console.log(`  Enlarged pattern after nägo, ḱago, kŕabo:\n  ${checkKrabo.enlargedPattern}`);

// 10. Distinguishing attested vs. unconfirmed/projected letters with ago, hago, jago, ńago, pago
const confirmedWordsList = [
  'lado', 'mago', 'tego', 'vido', 'nägo', 'ḱago', 'kŕabo',
  'ago', 'hago', 'jago', 'ńago', 'pago'
];

// Check ńago adds palatalized 'ń' to the projected pattern
const checkNago2 = paradigmService.checkAndExtendStemPattern('ńago', checkKrabo.enlargedPattern);
assert(checkNago2.enlargedPattern.includes('[b|d|f|g|h|j|k|ḱ|l|m|n|ń|p|r|ŕ|s|t|v]*'), 'Pattern must include palatalized "ń"');
console.log(`✓ ńago: ${checkNago2.explanation}`);

const attestationInfo = paradigmService.trackPatternAttestations(confirmedWordsList, checkNago2.enlargedPattern);

assert.deepStrictEqual(
  attestationInfo.attestedLists.consonants,
  ['h', 'j', 'k', 'ḱ', 'l', 'm', 'n', 'ń', 'p', 'ŕ', 't', 'v'],
  'Attested consonants must include all 12 confirmed onsets'
);
assert.deepStrictEqual(
  attestationInfo.unconfirmedLists.consonants,
  ['b', 'd', 'f', 'g', 'r', 's'],
  'Unconfirmed consonants reduced to [b, d, f, g, r, s]'
);
assert.deepStrictEqual(
  attestationInfo.attestedLists.vowels,
  ['a', 'e', 'i', 'ä'],
  'Attested vowels must be [a, e, i, ä]'
);
assert.deepStrictEqual(
  attestationInfo.unconfirmedLists.vowels,
  ['o', 'u', 'õ'],
  'Unconfirmed vowels must be [o, u, õ]'
);
assert.deepStrictEqual(
  attestationInfo.attestedLists.stops,
  ['b', 'd', 'g'],
  'All 3 stops (b, d, g) are confirmed'
);
assert.deepStrictEqual(
  attestationInfo.unconfirmedLists.stops,
  [],
  'No unconfirmed stops'
);
assert(attestationInfo.attestedPattern.includes('[h|j|k|ḱ|l|m|n|ń|p|ŕ|t|v]* [a|e|i|ä]'), 'Attested pattern must contain only confirmed letters');
console.log(`✓ Attested pattern (confirmed letters only):\n  ${attestationInfo.attestedPattern}`);
console.log(`✓ Projected pattern (full phonotactic inventory):\n  ${attestationInfo.projectedPattern}`);

// --- 14. Testing Accumulative LexC Stem Entries (+N_39_vido) ---
console.log('\n--- 14. Testing Accumulative LexC Stem Entries (+N_39_vido) ---');

// 1. Exact specification check: vido+N:vi{tØ}{tdØ}o N_39VIDO ;
const vidoLine = paradigmService.generateLexcStemLine('vido');
assert.strictEqual(vidoLine, 'vido+N:vi{tØ}{tdØ}o N_39VIDO ;', 'vido line must match exact specification');
console.log(`✓ LexC stem line for vido: "${vidoLine}"`);

// 2. Unknown POS check: vido+POS:vi{tØ}{tdØ}o N_39VIDO ;
const vidoPosLine = paradigmService.generateLexcStemLine('vido', { posUnknown: true });
assert.strictEqual(vidoPosLine, 'vido+POS:vi{tØ}{tdØ}o N_39VIDO ;', 'Unknown POS must produce +POS');
console.log(`✓ LexC stem line with unknown POS: "${vidoPosLine}"`);

// 3. Velar stop check: mago+N:ma{kØ}{kgØ}o N_39VIDO ;
const magoLine = paradigmService.generateLexcStemLine('mago');
assert.strictEqual(magoLine, 'mago+N:ma{kØ}{kgØ}o N_39VIDO ;', 'mago line must map g -> {kØ}{kgØ}');
console.log(`✓ LexC stem line for mago: "${magoLine}"`);

// 4. Labial stop check: kŕabo+N:kŕa{pØ}{pbv}o N_39VIDO ;
const kraboLine = paradigmService.generateLexcStemLine('kŕabo');
assert.strictEqual(kraboLine, 'kŕabo+N:kŕa{pØ}{pbv}o N_39VIDO ;', 'kŕabo line must map b -> {pØ}{pbv}');
console.log(`✓ LexC stem line for kŕabo: "${kraboLine}"`);

// 5. Check checkAndExtendStemPattern includes lexcStemLine
const checkVidoResult = paradigmService.checkAndExtendStemPattern('vido');
assert.strictEqual(checkVidoResult.lexcStemLine, 'vido+N:vi{tØ}{tdØ}o N_39VIDO ;');
console.log(`✓ checkAndExtendStemPattern includes lexcStemLine: "${checkVidoResult.lexcStemLine}"`);

// 6. Accumulative file generation for all 12 confirmed lemmas
const accumLexc = paradigmService.generateAccumulativeLexcFile(confirmedWordsList, { lang: 'vro' });
assert(accumLexc.includes('LEXICON Root'), 'Accumulative LexC must contain LEXICON Root');
assert(accumLexc.includes('vido+N:vi{tØ}{tdØ}o N_39VIDO ;'), 'Must contain vido entry');
assert(accumLexc.includes('mago+N:ma{kØ}{kgØ}o N_39VIDO ;'), 'Must contain mago entry');
assert(accumLexc.includes('kŕabo+N:kŕa{pØ}{pbv}o N_39VIDO ;'), 'Must contain kŕabo entry');
assert(accumLexc.includes('ńago+N:ńa{kØ}{kgØ}o N_39VIDO ;'), 'Must contain ńago entry');
console.log('✓ Accumulative LexC file generated successfully with all 12 lemma entries');

// 7. Verification of new words: kräbo, sado, ido
const kraboRes = paradigmService.checkAndExtendStemPattern('kräbo', checkNago2.enlargedPattern);
assert.strictEqual(kraboRes.fits, true, 'kräbo fits projected pattern directly');
assert.strictEqual(kraboRes.lexcStemLine, 'kräbo+N:krä{pØ}{pbv}o N_39VIDO ;');
console.log(`✓ kräbo LexC stem line: "${kraboRes.lexcStemLine}"`);

const sadoRes = paradigmService.checkAndExtendStemPattern('sado', checkNago2.enlargedPattern);
assert.strictEqual(sadoRes.fits, true, 'sado fits projected pattern directly');
assert.strictEqual(sadoRes.lexcStemLine, 'sado+N:sa{tØ}{tdØ}o N_39VIDO ;');
console.log(`✓ sado LexC stem line: "${sadoRes.lexcStemLine}"`);

const idoRes = paradigmService.checkAndExtendStemPattern('ido', checkNago2.enlargedPattern);
assert.strictEqual(idoRes.fits, true, 'ido fits projected pattern directly');
assert.strictEqual(idoRes.lexcStemLine, 'ido+N:i{tØ}{tdØ}o N_39VIDO ;');
console.log(`✓ ido LexC stem line: "${idoRes.lexcStemLine}"`);

// 8. Expanded 15-word attestation tracking (confirming r and s)
const all15Words = [...confirmedWordsList, 'kräbo', 'sado', 'ido'];
const attestation15 = paradigmService.trackPatternAttestations(all15Words, checkNago2.enlargedPattern);
assert(attestation15.attestedLists.consonants.includes('r'), 'Plain r is now confirmed by kräbo');
assert(attestation15.attestedLists.consonants.includes('s'), 's is now confirmed by sado');
assert.deepStrictEqual(
  attestation15.unconfirmedLists.consonants,
  ['b', 'd', 'f', 'g'],
  'Unconfirmed consonants reduced to [b, d, f, g]'
);
console.log(`✓ Confirmed consonants expanded to (14): ${attestation15.attestedLists.consonants.join(', ')}`);
console.log(`✓ Remaining unconfirmed consonants (4): ${attestation15.unconfirmedLists.consonants.join(', ')}`);

const accumLexc15 = paradigmService.generateAccumulativeLexcFile(all15Words, { lang: 'vro' });
assert(accumLexc15.includes('kräbo+N:krä{pØ}{pbv}o N_39VIDO ;'));
assert(accumLexc15.includes('sado+N:sa{tØ}{tdØ}o N_39VIDO ;'));
assert(accumLexc15.includes('ido+N:i{tØ}{tdØ}o N_39VIDO ;'));
console.log('✓ Accumulative LexC file generated successfully with all 15 lemma entries');

// --- 15. Testing Võro Type 44 (tsiga / VES 29), Stop Gradation & Singular -a / Plural -o ---
console.log('\n--- 15. Testing Võro Type 44 (tsiga / VES 29) ---');
const tsigaInput = `tsiga+N+Sg+Nom: tsiga
tsiga+N+Sg+Gen: tsia
tsiga+N+Sg+Par: tsika
tsiga+N+Sg+Ill: tsikka
tsiga+N+Pl+Gen: tsiko
tsiga+N+Pl+Ill: tsikkohe
tsiga+N+Pl+Ine: tsikon`;

const tsigaParsed = paradigmService.parseInputForms(tsigaInput);
const tsigaAligned = paradigmService.alignParadigm(tsigaParsed, { lang: 'vro' });

const expectedTsigaExpansions = [
  'tsiga+N+Sg+Nom: t s i 0 g a 0 #',
  'tsiga+N+Sg+Gen: t s i 0 0 a 0 #',
  'tsiga+N+Sg+Par: t s i 0 k a 0 #',
  'tsiga+N+Sg+Ill: t s i k k a 0 #',
  'tsiga+N+Pl+Gen: t s i 0 k 0 o #',
  'tsiga+N+Pl+Ill: t s i k k 0 o > h e',
  'tsiga+N+Pl+Ine: t s i 0 k 0 o > n'
];

tsigaAligned.forms.forEach((f, idx) => {
  assert.strictEqual(f.fullLine, expectedTsigaExpansions[idx], `Line ${idx+1} must match: ${expectedTsigaExpansions[idx]}`);
  console.log(`  ✓ Line ${idx+1}: ${f.fullLine}`);
});

assert.strictEqual(tsigaAligned.formula, 't, s, i, {kØ}, {kgØ}, {a:a, a:0}, {0:0, 0:o}');
console.log(`✓ Morphophonemic formula verified: "${tsigaAligned.formula}"`);

const tsigaRegexInfo = paradigmService.deriveStemRegex(tsigaAligned);
assert.strictEqual(tsigaRegexInfo.paradigmType, '+N_44_tsiga');
assert.strictEqual(tsigaRegexInfo.continuationLexicon, 'N_44TSIGA');
console.log(`✓ Paradigm type and continuation verified: ${tsigaRegexInfo.paradigmType} -> ${tsigaRegexInfo.continuationLexicon}`);

const tsigaStemLine = paradigmService.generateLexcStemLine('tsiga', { paradigmType: '+N_44_tsiga' });
assert.strictEqual(tsigaStemLine, 'tsiga+N:tsi{kØ}{kgØ}{ao} N_44TSIGA ;');
console.log(`✓ LexC stem line verified: "${tsigaStemLine}"`);

const tsigaClassify = paradigmService.classifyNewWord('tsikka', [], 'vro');
assert.strictEqual(tsigaClassify.matched, true);
assert.strictEqual(tsigaClassify.reconstructedLemma, 'tsiga');
assert.strictEqual(tsigaClassify.matchedSlot, 'Sg+Ill');
console.log(`✓ Single unknown form "tsikka" correctly classified as tsiga+N+Sg+Ill`);

console.log('\n--- 16. Testing Võro Type 39 (+N_39_luba) & Guesser Line Export ---');
const lubaInput = `luba+N+Sg+Nom: luba
luba+N+Sg+Gen: lua
luba+N+Sg+Par: lupa
luba+N+Sg+Ill: luppa
luba+N+Pl+Gen: lupõ
luba+N+Pl+Ill: luppõhe`;

const lubaParsed = paradigmService.parseInputForms(lubaInput);
const lubaAligned = paradigmService.alignParadigm(lubaParsed, { lang: 'vro' });

const expectedLubaExpansions = [
  'luba+N+Sg+Nom: l u 0 b a 0 #',
  'luba+N+Sg+Gen: l u 0 0 a 0 #',
  'luba+N+Sg+Par: l u 0 p a 0 #',
  'luba+N+Sg+Ill: l u p p a 0 #',
  'luba+N+Pl+Gen: l u 0 p 0 õ #',
  'luba+N+Pl+Ill: l u p p 0 õ > h e'
];

lubaAligned.forms.forEach((f, idx) => {
  assert.strictEqual(f.fullLine, expectedLubaExpansions[idx], `Line ${idx+1} must match: ${expectedLubaExpansions[idx]}`);
  console.log(`  ✓ Line ${idx+1}: ${f.fullLine}`);
});

assert.strictEqual(lubaAligned.formula, 'l, u, {pØ}, {pbv}, {a:a, a:0}, {0:0, 0:õ}');
console.log(`✓ Morphophonemic formula verified: "${lubaAligned.formula}"`);

const lubaRegexInfo = paradigmService.deriveStemRegex(lubaAligned);
assert.strictEqual(lubaRegexInfo.paradigmType, '+N_39_luba');
assert.strictEqual(lubaRegexInfo.continuationLexicon, 'N_39LUBA');
const expectedLubaGuesser = '< [b|d|f|g|h|j|k|l|m|n|p|r|s|t|v]* [a|o|u|õ] [0:"{kØ}" g:"{kgØ}"|0:"{tØ}" d:"{tdØ}"|0:"{pØ}" b:"{pbv}"] "a":0 "+N":0 "+Guess":0 "+N_39_luba":0 > N_39LUBA ;';
assert.strictEqual(lubaRegexInfo.lexcRegex, expectedLubaGuesser);
console.log(`✓ Guesser rule verified: "${lubaRegexInfo.lexcRegex}"`);

const lubaLexc = paradigmService.generateLexc(lubaAligned, 'luba', { lang: 'vro' });
assert.ok(lubaLexc.includes(expectedLubaGuesser), 'LexC grammar must contain guesser rule in LEXICON Root');
console.log('✓ LexC grammar Root includes guesser line');

const lubaStemLine = paradigmService.generateLexcStemLine('luba', { paradigmType: '+N_39_luba' });
assert.strictEqual(lubaStemLine, 'luba+N:lu{pØ}{pbv}a N_39LUBA ;');
console.log(`✓ LexC stem line verified: "${lubaStemLine}"`);

console.log('\n--- 17. Testing Võro Type 40 (talo) Consonant Lengthening ---');
const taloInput = `talo+N+Sg+Nom: talo
talo+N+Sg+Gen: talo
talo+N+Sg+Par: tallo
talo+N+Pl+Gen: tallõ
talo+N+Pl+Ill: tallõhe
talo+N+Pl+Ine: talõn`;

const taloParsed = paradigmService.parseInputForms(taloInput);
const taloAligned = paradigmService.alignParadigm(taloParsed, { lang: 'vro' });

const expectedTaloExpansions = [
  'talo+N+Sg+Nom: t a 0 l o 0 #',
  'talo+N+Sg+Gen: t a 0 l o 0 #',
  'talo+N+Sg+Par: t a l l o 0 #',
  'talo+N+Pl+Gen: t a l l 0 õ #',
  'talo+N+Pl+Ill: t a l l 0 õ > h e',
  'talo+N+Pl+Ine: t a 0 l 0 õ > n'
];

taloAligned.forms.forEach((f, idx) => {
  assert.strictEqual(f.fullLine, expectedTaloExpansions[idx], `Line ${idx+1} must match: ${expectedTaloExpansions[idx]}`);
  console.log(`  ✓ Line ${idx+1}: ${f.fullLine}`);
});

assert.strictEqual(taloAligned.formula, 't, a, {0:0, 0:l}, l, {o:o, o:0}, {0:0, 0:õ}');
console.log(`✓ Morphophonemic formula verified (Column 3 is {0:0, 0:l}): "${taloAligned.formula}"`);

const taloRegexInfo = paradigmService.deriveStemRegex(taloAligned);
assert.strictEqual(taloRegexInfo.paradigmType, '+N_40_talo');
assert.strictEqual(taloRegexInfo.continuationLexicon, 'N_40TALO');
console.log(`✓ Paradigm type and continuation verified: ${taloRegexInfo.paradigmType} -> ${taloRegexInfo.continuationLexicon}`);
console.log(`✓ Guesser rule: "${taloRegexInfo.lexcRegex}"`);

const taloStemLine = paradigmService.generateLexcStemLine('talo', { paradigmType: '+N_40_talo' });
assert.strictEqual(taloStemLine, 'talo+N:ta{0:0, 0:l}lo N_40TALO ;');
console.log(`✓ LexC stem line verified: "${taloStemLine}"`);

const taloClassify = paradigmService.classifyNewWord('tallo', [], 'vro');
assert.strictEqual(taloClassify.matched, true);
assert.strictEqual(taloClassify.reconstructedLemma, 'talo');
assert.strictEqual(taloClassify.matchedSlot, 'Sg+Par');
console.log(`✓ Single unknown form "tallo" correctly classified as talo+N+Sg+Par`);

// --- 18. Testing Multi-Form Input, Gradation Elimination & Systematic Narrowing ---
console.log('\n--- 18. Testing Multi-Form Input, Gradation Elimination & Systematic Narrowing ---');

// 18a. Single form "tsiga" ends in a vowel: matches Type 1 (kala) as top guess, but Type 44 is also in guesses
const match1 = paradigmService.classifyNewWord('tsiga', [], 'vro');
assert.strictEqual(match1.matched, true);
assert.strictEqual(match1.paradigmId, 'vro_type_1_kala', 'Single form tsiga ending in -a matches Type 1 ungradated as initial hypothesis');
const hasType44Candidate = match1.guesses.some(g => g.paradigmId === 'vro_type_44_tsiga' && !g.eliminated);
assert.strictEqual(hasType44Candidate, true, 'Type 44 must be an active candidate guess');
console.log('✓ Form 1 "tsiga" matches Type 1 (+N_1_kala) initially with Type 44 present among guesses');

// 18b. Two forms "tsiga, tsia": stop weakening g -> Ø is detected, which strictly ELIMINATES Type 1
const match2 = paradigmService.classifyNewWord('tsiga, tsia', [], 'vro');
assert.strictEqual(match2.matched, true);
assert.strictEqual(match2.gradationDetected, true, 'Consonant gradation (g -> Ø) must be detected');
const type1Candidate = match2.guesses.find(g => g.paradigmId === 'vro_type_1_kala');
assert(type1Candidate, 'Type 1 must be present in guesses');
assert.strictEqual(type1Candidate.eliminated, true, 'Type 1 must be strictly eliminated when gradation is detected');
assert.strictEqual(match2.paradigmId, 'vro_type_44_tsiga', 'Candidate space narrowed to Type 44');
assert.strictEqual(match2.matchedCount, 2, 'Must match 2 forms (Nom, Gen)');
console.log('✓ Form 2 "tsia" exhibits gradation (g -> Ø), strictly eliminating ungradated Type 1 (kala)');

// 18c. Three forms "tsiga, tsia, tsika": Partitive in -ka further confirms velar stop gradation
const match3 = paradigmService.classifyNewWord('tsiga, tsia, tsika', [], 'vro');
assert.strictEqual(match3.matched, true);
assert.strictEqual(match3.paradigmId, 'vro_type_44_tsiga');
assert.strictEqual(match3.matchedCount, 3, 'Must match 3 forms (Nom, Gen, Par)');
assert(match3.disambiguationSteps.length >= 3, 'Must provide step-by-step disambiguation walkthrough');
console.log('✓ Form 3 "tsika" uniquely isolates Type 44 (+N_44_tsiga)');

// 18d. CSV / TSV / newline input formats
const matchCsv = paradigmService.classifyNewWord('tsiga\ntsia\ntsika\ntsikka', [], 'vro');
assert.strictEqual(matchCsv.matchedCount, 4);
const matchTsv = paradigmService.classifyNewWord('tsiga\ttsia\ttsika', [], 'vro');
assert.strictEqual(matchTsv.matchedCount, 3);
console.log('✓ Multiline newline and tab-separated input successfully classified');

// 18e. Livonian ungradated vs gradating noun
const livUngrad = paradigmService.classifyNewWord('kõzon', [], 'liv');
assert.strictEqual(livUngrad.matched, true);
assert.strictEqual(livUngrad.paradigmId, 'liv_type_1_kozon');

const livGrad = paradigmService.classifyNewWord("le’ḑ, leḑ, ledda", [], 'liv');
assert.strictEqual(livGrad.matched, true);
assert.strictEqual(livGrad.paradigmId, 'liv_type_2_led');
console.log('✓ Livonian Type 1 ungradated (kõzon) and Type 2 gradating (le’ḑ) verified');

// --- 19. Testing UralicNLP vs LangJack Distinction & Classifier Engine Switch (mindõ) ---
console.log('\n--- 19. Testing UralicNLP vs LangJack Engine Switch (mindõ) ---');

// 19a. Tag parser for UralicNLP guesser outputs: mind+N+Guess+N_41_haik+Pl+Gen and mind+N+Guess+N_41_ask+Pl+Gen
const parsedHaik = paradigmService.parseUralicNlpGuesserTag('mind+N+Guess+N_41_haik+Pl+Gen');
assert(parsedHaik, 'parseUralicNlpGuesserTag must return non-null object');
assert.strictEqual(parsedHaik.lemma, 'mind');
assert.strictEqual(parsedHaik.typeNumber, 41);
assert.strictEqual(parsedHaik.modelLemma, 'haik');
assert.strictEqual(parsedHaik.slot, 'Pl+Gen');
assert.strictEqual(parsedHaik.fullGuessTag, '+N_41_haik');
assert.strictEqual(parsedHaik.langJackEquivalent, '+N_41_kand (VES Type 41)');
assert(parsedHaik.distinctionNote.includes('NO "+N_41_kand" in the UralicNLP analyzer'));
console.log('✓ parseUralicNlpGuesserTag for haik parsed and mapped to LangJack Type 41 kand');

const parsedAsk = paradigmService.parseUralicNlpGuesserTag('mind+N+Guess+N_41_ask+Pl+Gen');
assert.strictEqual(parsedAsk.modelLemma, 'ask');
assert.strictEqual(parsedAsk.typeNumber, 41);
assert.strictEqual(parsedAsk.slot, 'Pl+Gen');
console.log('✓ parseUralicNlpGuesserTag for ask parsed');

// 19b. Mock UralicNLP analyzer data for mindõ
const mockMindoAnalyzerData = {
  'mindõ': [
    { raw: 'mind+N+Guess+N_41_haik+Pl+Gen', isGuessed: true },
    { raw: 'mind+N+Guess+N_41_ask+Pl+Gen', isGuessed: true }
  ]
};

// 19c. Classifier Engine: UralicNLP Transducer Mode
const mindoUralic = paradigmService.classifyNewWord('mindõ', mockMindoAnalyzerData, 'vro', {
  classifierEngine: 'uralicnlp'
});
assert.strictEqual(mindoUralic.matched, true);
assert.strictEqual(mindoUralic.engine, 'uralicnlp');
assert(mindoUralic.engineDisplayName.includes('UralicNLP Transducer'));
assert.strictEqual(mindoUralic.reconstructedLemma, 'mind');
assert.strictEqual(mindoUralic.matchedSlot, 'Pl+Gen');
assert(mindoUralic.paradigmName.includes('haik') || mindoUralic.paradigmName.includes('ask'));
assert(mindoUralic.distinctionNote.includes('NO "+N_41_kand" in the UralicNLP analyzer'), 'UralicNLP mode must explicitly state there is NO +N_41_kand in UralicNLP');
console.log('✓ Classifier UralicNLP mode for mindõ correctly identifies Type 41 haik/ask and distinguishes it from LangJack kand');

// 19d. Classifier Engine: LangJack Two-Level Mode
const mindoLangJack = paradigmService.classifyNewWord('mindõ', mockMindoAnalyzerData, 'vro', {
  classifierEngine: 'langjack'
});
assert.strictEqual(mindoLangJack.matched, true);
assert.strictEqual(mindoLangJack.engine, 'langjack');
assert(mindoLangJack.engineDisplayName.includes('LangJack Two-Level'));
assert.strictEqual(mindoLangJack.paradigmType, '+N_41_kand');
assert.strictEqual(mindoLangJack.reconstructedLemma, 'mind');
assert.strictEqual(mindoLangJack.matchedSlot, 'Pl+Gen');
assert(mindoLangJack.distinctionNote.includes('LangJack\'s internal Two-Level rules'));
assert(mindoLangJack.distinctionNote.includes('+N_41_haik') || mindoLangJack.distinctionNote.includes('+N_41_ask'));
console.log('✓ Classifier LangJack mode for mindõ correctly identifies +N_41_kand and references UralicNLP equivalents');

// 19e. Classifier Engine: Combined Mode (UralicNLP + LangJack)
const mindoCombined = paradigmService.classifyNewWord('mindõ', mockMindoAnalyzerData, 'vro', {
  classifierEngine: 'combined'
});
assert.strictEqual(mindoCombined.matched, true);
assert.strictEqual(mindoCombined.engine, 'combined');
assert(mindoCombined.engineDisplayName.includes('Combined Mode'));
assert.strictEqual(mindoCombined.paradigmType, '+N_41_kand');
assert(mindoCombined.distinctionNote.includes('Cross-verified'));
assert(mindoCombined.distinctionNote.includes('NO "+N_41_kand" in the UralicNLP analyzer'));
console.log('✓ Classifier Combined mode for mindõ cross-verifies Type 41 across UralicNLP and LangJack');

console.log('\n🎉 ALL TWO-LEVEL PARADIGM DISCOVERER TESTS PASSED! 🎉');






