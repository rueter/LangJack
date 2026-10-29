import assert from 'node:assert';
import fs from 'node:fs';
import { TagMapper } from '../js/services/tag-mapper.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { InterlinearExporter } from '../js/services/interlinear-exporter.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';
import { HfstInputStream } from '../js/lib/hfst/core.js';

console.log('=== 1. Testing TagMapper ===');
const parsedNoun = TagMapper.parse('вастома+N+Sg+Nom+Def');
assert.strictEqual(parsedNoun.lemma, 'вастома');
assert.strictEqual(parsedNoun.upos, 'NOUN');
assert.strictEqual(parsedNoun.feats, 'Case=Nom|Definite=Def|Number=Sing');
console.log('✓ TagMapper noun parsing passed:', parsedNoun.feats);

const parsedVerb = TagMapper.parse('ульнемс+V+IV+Ind+Prt1+ScSg3');
assert.strictEqual(parsedVerb.lemma, 'ульнемс');
assert.strictEqual(parsedVerb.upos, 'VERB');
assert.strictEqual(parsedVerb.feats, 'Mood=Ind|Number[subj]=Sing|Person[subj]=3|Tense=Past|VerbForm=Fin', 'IV is not mapped to Subcat=Intr');
assert.strictEqual(TagMapper.parse('x+V+TV+Ind').feats, 'Mood=Ind', 'TV is not mapped to Subcat=Tran');
console.log('✓ TagMapper verb parsing passed:', parsedVerb.feats);

console.log('\n=== 2. Testing Bundled Transducers with hfst-js ===');
const anBuf = fs.readFileSync('models/bundled_analyser.hfstol');
const diBuf = fs.readFileSync('models/bundled_dict.hfstol');

const analyser = HfstInputStream.fromBuffer(anBuf).read();
const dict = HfstInputStream.fromBuffer(diBuf).read();

const anResults = analyser.lookup('вастомась');
assert(anResults.length > 0, 'Should find reading for вастомась');
assert.strictEqual(anResults[0][0], 'вастома+N+Sg+Nom+Def');
console.log('✓ Analyser lookup passed for вастомась ->', anResults[0][0]);

const dictResults = dict.lookup('myv_вастома');
assert(dictResults.length > 0, 'Should find gloss for myv_вастома');
console.log('✓ Dictionary lookup passed for myv_вастома ->', dictResults);

console.log('\n=== 3. Testing Complete Interlinear Sentence Pipeline ===');
const sampleSentence = {
  sent_id: 1,
  text: 'Вастомась ульнесь пек вадря.',
  tokens: [
    {
      id: 1,
      form: 'Вастомась',
      selectedReading: TagMapper.parse('вастома+N+Sg+Nom+Def'),
      selectedGloss: { gloss: 'meeting', lang: 'eng' },
      isPunct: false
    },
    {
      id: 2,
      form: 'ульнесь',
      selectedReading: TagMapper.parse('ульнемс+V+IV+Ind+Prt1+ScSg3'),
      selectedGloss: { gloss: 'be', lang: 'eng' },
      isPunct: false
    },
    {
      id: 3,
      form: 'пек',
      selectedReading: TagMapper.parse('пек+Adv'),
      selectedGloss: { gloss: 'very', lang: 'eng' },
      isPunct: false
    },
    {
      id: 4,
      form: 'вадря',
      selectedReading: TagMapper.parse('вадря+A+SP+Nom+Indef'),
      selectedGloss: { gloss: 'good', lang: 'eng' },
      isPunct: false
    },
    {
      id: 5,
      form: '.',
      selectedReading: TagMapper.parse('.+CLB'),
      selectedGloss: { gloss: '.', lang: 'eng' },
      isPunct: true
    }
  ]
};

const sampleTranslations = [
  { id: 1, lang: 'eng', text: 'The meeting was very good.' },
  { id: 2, lang: 'fin', text: 'Tapaaminen oli erittäin hyvä.' }
];

console.log('\n=== 4. Testing CoNLL-U Exporter ===');
const conllu = ConlluExporter.export([sampleSentence], sampleTranslations);
assert(conllu.includes('# sent_id = 1'), 'CoNLL-U should include sent_id');
assert(conllu.includes('# text = Вастомась ульнесь пек вадря.'), 'CoNLL-U should include text');
assert(conllu.includes('# text_eng = The meeting was very good.'), 'CoNLL-U should include text_eng');
assert(conllu.includes('1\tВастомась\tвастома\tNOUN'), 'CoNLL-U row 1 should match');
console.log('✓ CoNLL-U Exporter passed:\n' + conllu);

console.log('\n=== 5. Testing Interlinear Exporter (MS Word / LibreOffice) ===');
const plainInterlinear = InterlinearExporter.exportPlainText([sampleSentence], sampleTranslations);
assert(plainInterlinear.includes('a. Original:'), 'Should have line a');
assert(plainInterlinear.includes('b. Word form:'), 'Should have line b');
assert(plainInterlinear.includes('c. Morphology:'), 'Should have line c');
assert(plainInterlinear.includes('d. Gloss:'), 'Should have line d');
assert(plainInterlinear.includes('e. Translation [ENG]:'), 'Should have line e');
console.log('✓ Plain Text Interlinear Exporter passed:\n' + plainInterlinear);

const htmlTable = InterlinearExporter.exportHTML([sampleSentence], sampleTranslations);
assert(htmlTable.includes('<table'), 'Should contain table tag for Word/LibreOffice');
assert(htmlTable.includes('meeting'), 'Should contain gloss text');
console.log('✓ HTML Table Exporter passed (length: ' + htmlTable.length + ' chars)');

console.log('\n=== 6. Testing Ve\'rdd Exporter ===');
const verddBlock = VerddExporter.exportBlock([sampleSentence], sampleTranslations, 'myv', 'eng');
assert(verddBlock.includes('ENTRY #1:  вастома'), 'Should contain entry header');
assert(verddBlock.includes('POS:       NOUN (N)'), 'Should contain POS');
assert(verddBlock.includes('LANG:      MYV → ENG'), 'Should contain language ISOs');
assert(verddBlock.includes('EXAMPLE [myv]:      Вастомась ульнесь пек вадря.'), 'Should contain example sentence');
assert(verddBlock.includes('TRANSLATION [eng]:  The meeting was very good.'), 'Should contain example translation');
console.log('✓ Ve\'rdd Block Exporter passed:\n' + verddBlock.split('\n').slice(0, 15).join('\n') + '\n...');

const verddXML = VerddExporter.exportXML([sampleSentence], sampleTranslations, 'myv', 'eng');
assert(verddXML.includes('<verdd:lexicon'), 'Should contain verdd:lexicon tag');
assert(verddXML.includes('<lemma xml:lang="myv">вастома</lemma>'), 'Should contain lemma XML tag');
assert(verddXML.includes('<tr xml:lang="eng">meeting</tr>'), 'Should contain translation tag');
assert(verddXML.includes('<quote xml:lang="myv">Вастомась ульнесь пек вадря.</quote>'), 'Should contain example quote');
console.log('✓ Ve\'rdd XML Exporter passed (length: ' + verddXML.length + ' chars)');

const verddTSV = VerddExporter.exportTSV([sampleSentence], sampleTranslations, 'myv', 'eng');
assert(verddTSV.startsWith('LEMMA\tPOS\tUPOS\tSRC_LANG\tGLOSS\tTGT_LANG\tWORD_FORM\tMORPH_TAG\tEXAMPLE_SENTENCE\tEXAMPLE_TRANSLATIONS'), 'Should contain TSV header');
assert(verddTSV.includes('вастома\tN\tNOUN\tmyv\tmeeting\teng'), 'Should contain row data');
console.log('✓ Ve\'rdd TSV Exporter passed');

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
