/**
 * Test: UralicNLP Analyzer Renewal and UPOS Directly Derived from Morphological Analysis (NOUN < +N)
 */

import { TagMapper, POS_TO_UPOS, UPOS_TO_POS } from '../js/services/tag-mapper.js';
import { analyzerService, normalizeLangCode } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';

console.log('=== Running Tests for UralicNLP Renewal & Morphologically Derived UPOS ===\n');

// --- 1. Testing Direct Derivation of UPOS from Morphological Tags (NOUN < +N) ---
console.log('--- 1. Testing Direct Derivation of UPOS from Morphological Tags ---');

const testCases = [
  { input: 'вастома+N+Sg+Nom+Def', expectedUpos: 'NOUN', expectedPos: 'N', desc: 'NOUN < +N' },
  { input: 'молемс+V+Ind+Prs+ScSg1', expectedUpos: 'VERB', expectedPos: 'V', desc: 'VERB < +V' },
  { input: 'Pekka+N+Prop+Sg+Nom', expectedUpos: 'PROPN', expectedPos: 'Prop', desc: 'PROPN < +Prop' },
  { input: 'ole+V+Aux+Ind+Prs', expectedUpos: 'AUX', expectedPos: 'Aux', desc: 'AUX < +Aux' },
  { input: 'вадря+A+SP+Nom+Indef', expectedUpos: 'ADJ', expectedPos: 'A', desc: 'ADJ < +A' },
  { input: 'пек+Adv', expectedUpos: 'ADV', expectedPos: 'Adv', desc: 'ADV < +Adv' },
  { input: 'мон+Pron+Pers+Sg1+Nom', expectedUpos: 'PRON', expectedPos: 'Pron', desc: 'PRON < +Pron' },
  { input: 'колмо+Num+Sg+Nom', expectedUpos: 'NUM', expectedPos: 'Num', desc: 'NUM < +Num' },
  { input: 'вакссо+Po', expectedUpos: 'ADP', expectedPos: 'Po', desc: 'ADP < +Po' },
  { input: 'ды+CC', expectedUpos: 'CCONJ', expectedPos: 'CC', desc: 'CCONJ < +CC' },
  { input: 'кода+CS', expectedUpos: 'SCONJ', expectedPos: 'CS', desc: 'SCONJ < +CS' },
  { input: 'жо+Pcle', expectedUpos: 'PART', expectedPos: 'Pcle', desc: 'PART < +Pcle' },
  { input: 'вай+Interj', expectedUpos: 'INTJ', expectedPos: 'Interj', desc: 'INTJ < +Interj' },
  { input: '.+CLB', expectedUpos: 'PUNCT', expectedPos: 'CLB', desc: 'PUNCT < +CLB' },
  { input: 'tämä+Det', expectedUpos: 'DET', expectedPos: 'Det', desc: 'DET < +Det' },
  { input: '€+Sym', expectedUpos: 'SYM', expectedPos: 'Sym', desc: 'SYM < +Sym' }
];

testCases.forEach(({ input, expectedUpos, expectedPos, desc }) => {
  const derived = TagMapper.deriveUpos(input);
  if (derived !== expectedUpos) {
    throw new Error(`Derivation failed for "${input}": got ${derived}, expected ${expectedUpos}`);
  }
  const parsed = TagMapper.parse(input);
  if (parsed.upos !== expectedUpos) {
    throw new Error(`TagMapper.parse UPOS failed for "${input}": got ${parsed.upos}, expected ${expectedUpos}`);
  }
  if (parsed.pos !== expectedPos) {
    throw new Error(`TagMapper.parse POS failed for "${input}": got ${parsed.pos}, expected ${expectedPos}`);
  }
  console.log(`✓ ${desc.padEnd(16)}: "${input}" -> UPOS: ${derived}, POS: ${parsed.pos}`);
});

// --- 2. Testing Reciprocal Mapping (UPOS_TO_POS & POS_TO_UPOS) ---
console.log('\n--- 2. Testing Reciprocal Mapping (UPOS_TO_POS) ---');
const uTags = ['NOUN', 'PROPN', 'VERB', 'ADJ', 'ADV', 'PRON', 'NUM', 'ADP', 'AUX', 'CCONJ', 'SCONJ', 'PART', 'INTJ', 'PUNCT', 'SYM', 'DET'];
uTags.forEach(u => {
  const pos = TagMapper.uposToPosTag(u);
  const backUpos = TagMapper.deriveUpos(`word+${pos}`);
  if (backUpos !== u) {
    throw new Error(`Roundtrip derivation failed for ${u} -> +${pos} -> ${backUpos}`);
  }
  console.log(`✓ Roundtrip: ${u.padEnd(6)} -> +${pos.padEnd(6)} -> ${backUpos}`);
});

// --- 3. Testing AnalyzerService Integration with Derived UPOS ---
console.log('\n--- 3. Testing AnalyzerService Integration with Derived UPOS ---');
await analyzerService.init('myv');
const readings = analyzerService.analyze_word('вастомась', 'myv');
if (!readings || readings.length === 0) {
  throw new Error('Failed to analyze "вастомась"');
}
const firstReading = readings[0];
console.log(`Word: "вастомась" -> Analysis: "${firstReading.raw}" | UPOS: ${firstReading.upos} (< +${firstReading.pos})`);
if (firstReading.upos !== 'NOUN' || firstReading.pos !== 'N') {
  throw new Error(`Expected NOUN < +N, got UPOS=${firstReading.upos}, POS=${firstReading.pos}`);
}

// OOV / Guessed word derivation
const guessed = analyzerService.inferLemmaAndTags('керкуын', 'koi');
console.log(`Guessed Komi-Permyak: "${guessed.raw}" -> UPOS: ${guessed.upos} (< +${guessed.pos})`);
if (guessed.upos !== 'NOUN' || guessed.pos !== 'N') {
  throw new Error(`Expected NOUN < +N for Komi Inessive, got ${guessed.upos}`);
}

// --- 4. Testing CoNLL-U and Ve'rdd Output with Derived UPOS ---
console.log('\n--- 4. Testing CoNLL-U and Ve\'rdd Output with Derived UPOS ---');
const sentence = {
  sent_id: 1,
  text: 'Вастомась ульнесь пек вадря.',
  tokens: [
    {
      form: 'Вастомась',
      lemma: 'вастома',
      upos: 'NOUN',
      selectedReading: { raw: 'вастома+N+Sg+Nom+Def', pos: 'N', upos: 'NOUN', feats: 'Case=Nom|Definite=Def|Number=Sing' },
      selectedGloss: { gloss: 'meeting', lang: 'eng' }
    },
    {
      form: 'ульнесь',
      lemma: 'ульнемс',
      upos: 'VERB',
      selectedReading: { raw: 'ульнемс+V+IV+Ind+Prt1+ScSg3', pos: 'V', upos: 'VERB', feats: 'Mood=Ind|Tense=Past' },
      selectedGloss: { gloss: 'be', lang: 'eng' }
    },
    {
      form: 'пек',
      lemma: 'пек',
      upos: 'ADV',
      selectedReading: { raw: 'пек+Adv', pos: 'Adv', upos: 'ADV', feats: '_' },
      selectedGloss: { gloss: 'very', lang: 'eng' }
    },
    {
      form: 'вадря',
      lemma: 'вадря',
      upos: 'ADJ',
      selectedReading: { raw: 'вадря+A+SP+Nom+Indef', pos: 'A', upos: 'ADJ', feats: 'Case=Nom|Number=SP' },
      selectedGloss: { gloss: 'good', lang: 'eng' }
    },
    {
      form: '.',
      lemma: '.',
      upos: 'PUNCT',
      isPunct: true,
      selectedReading: { raw: '.+CLB', pos: 'CLB', upos: 'PUNCT', feats: '_' }
    }
  ]
};

const conllu = ConlluExporter.export([sentence]);
console.log('Generated CoNLL-U Output:');
console.log(conllu.trim());

// Verify column 4 (UPOS) and column 5 (XPOS with morphological tags)
if (!conllu.includes('1\tВастомась\tвастома\tNOUN\tвастома+N+Sg+Nom+Def')) {
  throw new Error('CoNLL-U row 1 failed derivation check');
}
if (!conllu.includes('2\tульнесь\tульнемс\tVERB\tульнемс+V+IV+Ind+Prt1+ScSg3')) {
  throw new Error('CoNLL-U row 2 failed derivation check');
}
if (!conllu.includes('3\tпек\tпек\tADV\tпек+Adv')) {
  throw new Error('CoNLL-U row 3 failed derivation check');
}
if (!conllu.includes('4\tвадря\tвадря\tADJ\tвадря+A+SP+Nom+Indef')) {
  throw new Error('CoNLL-U row 4 failed derivation check');
}
console.log('✓ CoNLL-U columns 4 (UPOS) and 5 (XPOS) verified with derived tags');

// --- 5. Testing Dynamic Reading Modification & Re-derivation ---
console.log('\n--- 5. Testing Dynamic Reading Modification & Re-derivation ---');
// Suppose user switches token 4 from ADJ to VERB
const tok4 = sentence.tokens[3];
const targetUpos = 'VERB';
const targetPos = TagMapper.uposToPosTag(targetUpos); // 'V'
tok4.selectedReading.raw = `${tok4.lemma}+${targetPos}+Ind+Prs`;
tok4.upos = TagMapper.deriveUpos(tok4.selectedReading.raw);
tok4.selectedReading.upos = tok4.upos;
tok4.selectedReading.pos = targetPos;

const renewedConllu = ConlluExporter.export([sentence]);
if (!renewedConllu.includes('4\tвадря\tвадря\tVERB\tвадря+V+Ind+Prs')) {
  throw new Error('Renewed CoNLL-U failed to reflect re-derived UPOS');
}
console.log(`✓ Token 4 updated: "${tok4.selectedReading.raw}" -> UPOS: ${tok4.upos} (< +${targetPos})`);

// --- 6. Testing UralicNLP Nightly Model Downloader URL Specification & Multi-Mirror Resilience ---
console.log('\n--- 6. Testing UralicNLP Nightly Model URL Specification & Multi-Mirror Resilience ---');
const supportedLangs = ['myv', 'fin', 'sms', 'kpv', 'koi', 'mdf', 'mhr', 'mrj', 'olo', 'fkv', 'sme', 'smn', 'udm', 'apu'];
supportedLangs.forEach(lang => {
  const urls = analyzerService.getModelDownloadUrls(lang);
  if (!urls || urls.length === 0) {
    throw new Error(`No candidate download URLs returned for ${lang}`);
  }
  if (!urls[0].includes('raw.githubusercontent.com')) {
    throw new Error(`Primary URL for ${lang} must be raw.githubusercontent.com for SSL and CORS compatibility, got: ${urls[0]}`);
  }
  console.log(`✓ UralicNLP nightly targets for ${lang.padEnd(4)}: [${urls.length} mirrors] Primary -> ${urls[0]}`);
});

const dictUrls = dictionaryService.getDictionaryDownloadUrls();
if (!dictUrls || !dictUrls[0].includes('raw.githubusercontent.com')) {
  throw new Error(`Primary dictionary URL must be raw.githubusercontent.com, got: ${dictUrls[0]}`);
}
console.log(`✓ UralicNLP dictionary targets: [${dictUrls.length} mirrors] Primary -> ${dictUrls[0]}`);

// --- 7. Testing Language Code Normalization for Compound Strings (e.g. "apu (apurinã)") ---
console.log('\n--- 7. Testing Language Code Normalization for Compound Strings ---');
const normTestCases = [
  { input: 'apu (apurinã)', expected: 'apu' },
  { input: 'apu (Apurinã)', expected: 'apu' },
  { input: 'Apurinã (apu)', expected: 'apu' },
  { input: 'Apurinã', expected: 'apu' },
  { input: 'apurinã', expected: 'apu' },
  { input: 'apu - Apurinã', expected: 'apu' },
  { input: 'fin (Finnish)', expected: 'fin' },
  { input: 'myv (Erzya)', expected: 'myv' },
  { input: 'kpv (Komi-Zyrian)', expected: 'kpv' },
  { input: 'sms', expected: 'sms' },
  { input: 'fin_hist', expected: 'fin_hist' }
];

normTestCases.forEach(({ input, expected }) => {
  const normalized = normalizeLangCode(input);
  if (normalized !== expected) {
    throw new Error(`normalizeLangCode("${input}") failed: expected "${expected}", got "${normalized}"`);
  }
  const urls = analyzerService.getModelDownloadUrls(input);
  if (!urls[0].includes(`/nightly/${expected}/`)) {
    throw new Error(`getModelDownloadUrls("${input}") produced invalid URL: ${urls[0]}`);
  }
  console.log(`✓ Normalization passed: "${input}" -> ISO code: "${normalized}" -> ${urls[0]}`);
});

console.log('\n🎉 ALL TESTS FOR URALICNLP RENEWAL & DERIVED UPOS PASSED SUCCESSFULLY! 🎉');
