/**
 * Test: Adposition Feature Mapping in TagMapper and CoNLL-U Exporter (Po -> AdpType=Post, Pr -> AdpType=Prep)
 */

import { TagMapper, TAG_TO_FEATS, POS_TO_UPOS } from '../js/services/tag-mapper.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';

console.log('=== Running Adposition (Po / Pr / Adp) Feature Tests ===\n');

// --- 1. Testing TAG_TO_FEATS Mappings ---
console.log('--- 1. Testing TAG_TO_FEATS mappings for Po, Pr, Post, Prep ---');
if (!TAG_TO_FEATS['Po'] || TAG_TO_FEATS['Po'].feature !== 'AdpType' || TAG_TO_FEATS['Po'].value !== 'Post') {
  throw new Error('TAG_TO_FEATS["Po"] must map to { feature: "AdpType", value: "Post" }');
}
if (!TAG_TO_FEATS['Pr'] || TAG_TO_FEATS['Pr'].feature !== 'AdpType' || TAG_TO_FEATS['Pr'].value !== 'Prep') {
  throw new Error('TAG_TO_FEATS["Pr"] must map to { feature: "AdpType", value: "Prep" }');
}
if (!TAG_TO_FEATS['Post'] || TAG_TO_FEATS['Post'].feature !== 'AdpType' || TAG_TO_FEATS['Post'].value !== 'Post') {
  throw new Error('TAG_TO_FEATS["Post"] must map to { feature: "AdpType", value: "Post" }');
}
if (!TAG_TO_FEATS['Prep'] || TAG_TO_FEATS['Prep'].feature !== 'AdpType' || TAG_TO_FEATS['Prep'].value !== 'Prep') {
  throw new Error('TAG_TO_FEATS["Prep"] must map to { feature: "AdpType", value: "Prep" }');
}
console.log('✓ TAG_TO_FEATS correctly defines Po -> AdpType=Post and Pr -> AdpType=Prep');

// --- 2. Testing TagMapper.parse for Postposition (Po) ---
console.log('\n--- 2. Testing TagMapper.parse for Postpositions (Po) ---');
const parsedPo = TagMapper.parse('all+Po');
console.log('Parsed "all+Po":', parsedPo);
if (parsedPo.upos !== 'ADP') {
  throw new Error(`Expected UPOS "ADP", got "${parsedPo.upos}"`);
}
if (parsedPo.pos !== 'Po') {
  throw new Error(`Expected pos "Po", got "${parsedPo.pos}"`);
}
if (parsedPo.feats !== 'AdpType=Post') {
  throw new Error(`Expected feats "AdpType=Post", got "${parsedPo.feats}"`);
}
if (parsedPo.featsMap.AdpType !== 'Post') {
  throw new Error(`Expected featsMap.AdpType="Post", got "${parsedPo.featsMap.AdpType}"`);
}
console.log('✓ "all+Po" parsed correctly: UPOS=ADP, pos=Po, feats=AdpType=Post');

// --- 3. Testing TagMapper.parse for Preposition (Pr) ---
console.log('\n--- 3. Testing TagMapper.parse for Prepositions (Pr) ---');
const parsedPr = TagMapper.parse('läbi+Pr');
console.log('Parsed "läbi+Pr":', parsedPr);
if (parsedPr.upos !== 'ADP') {
  throw new Error(`Expected UPOS "ADP", got "${parsedPr.upos}"`);
}
if (parsedPr.pos !== 'Pr') {
  throw new Error(`Expected pos "Pr", got "${parsedPr.pos}"`);
}
if (parsedPr.feats !== 'AdpType=Prep') {
  throw new Error(`Expected feats "AdpType=Prep", got "${parsedPr.feats}"`);
}
if (parsedPr.featsMap.AdpType !== 'Prep') {
  throw new Error(`Expected featsMap.AdpType="Prep", got "${parsedPr.featsMap.AdpType}"`);
}
console.log('✓ "läbi+Pr" parsed correctly: UPOS=ADP, pos=Pr, feats=AdpType=Prep');

// --- 4. Testing Multi-Feature Postposition & Preposition (Alphabetical Sorting) ---
console.log('\n--- 4. Testing Multi-Feature Combinations & Sorting ---');
const parsedPoInflected = TagMapper.parse('all+Po+Ade');
console.log('Parsed "all+Po+Ade":', parsedPoInflected.feats);
if (parsedPoInflected.feats !== 'AdpType=Post|Case=Ade') {
  throw new Error(`Expected "AdpType=Post|Case=Ade", got "${parsedPoInflected.feats}"`);
}

const parsedPrInflected = TagMapper.parse('enne+Pr+Gen');
console.log('Parsed "enne+Pr+Gen":', parsedPrInflected.feats);
if (parsedPrInflected.feats !== 'AdpType=Prep|Case=Gen') {
  throw new Error(`Expected "AdpType=Prep|Case=Gen", got "${parsedPrInflected.feats}"`);
}

// With Typo / Spell Relax
const parsedPoTypo = TagMapper.parse('all\'+Po+SplRlx');
console.log('Parsed "all\'+Po+SplRlx":', parsedPoTypo.feats);
if (parsedPoTypo.feats !== 'AdpType=Post|Typo=Yes') {
  throw new Error(`Expected "AdpType=Post|Typo=Yes", got "${parsedPoTypo.feats}"`);
}
console.log('✓ Multi-feature combinations sort alphabetically per UD standard');

// --- 5. Testing Generic Adposition (Adp) ---
console.log('\n--- 5. Testing Generic Adposition (Adp) ---');
const parsedAdp = TagMapper.parse('vahel+Adp');
if (parsedAdp.upos !== 'ADP') {
  throw new Error(`Expected UPOS "ADP", got "${parsedAdp.upos}"`);
}
if (parsedAdp.feats !== '_') {
  throw new Error(`Expected feats "_", got "${parsedAdp.feats}"`);
}
console.log('✓ "vahel+Adp" parsed correctly: UPOS=ADP, pos=Adp, feats=_');

// --- 6. Testing CoNLL-U Column 6 Export with Võro Sample ---
console.log('\n--- 6. Testing CoNLL-U Column 6 Export with Võro Sample ---');
const sentVro = {
  sent_id: 1,
  text: 'Kand om korgõ puu all.',
  tokens: [
    { form: 'Kand', lemma: 'kand', upos: 'NOUN', selectedReading: TagMapper.parse('kand+N+Sg+Nom') },
    { form: 'om', lemma: 'olõma', upos: 'AUX', selectedReading: TagMapper.parse('olõma+V+Act+Ind+Prs+Sg3') },
    { form: 'korgõ', lemma: 'korgõ', upos: 'ADJ', selectedReading: TagMapper.parse('korgõ+A+Sg+Nom') },
    { form: 'puu', lemma: 'puu', upos: 'NOUN', selectedReading: TagMapper.parse('puu+N+Sg+Gen') },
    { form: 'all', lemma: 'all', upos: 'ADP', selectedReading: TagMapper.parse('all+Po') },
    { form: '.', lemma: '.', upos: 'PUNCT', isPunct: true, selectedReading: TagMapper.parse('.+CLB') }
  ]
};

const conlluVro = ConlluExporter.export([sentVro]);
console.log('Generated CoNLL-U for Võro:');
console.log(conlluVro);

const lines = conlluVro.trim().split('\n');
const rowAll = lines.find(l => l.startsWith('5\tall\t'));
if (!rowAll) {
  throw new Error('Token 5 (all) missing from CoNLL-U output');
}

const cols = rowAll.split('\t');
console.log('Columns for "all":', {
  id: cols[0],
  form: cols[1],
  lemma: cols[2],
  upos: cols[3],
  xpos: cols[4],
  feats: cols[5]
});

if (cols[3] !== 'ADP') {
  throw new Error(`Expected UPOS "ADP" in column 4, got "${cols[3]}"`);
}
if (cols[4] !== 'Po') {
  throw new Error(`Expected XPOS "Po" in column 5, got "${cols[4]}"`);
}
if (cols[5] !== 'AdpType=Post') {
  throw new Error(`Expected FEATS "AdpType=Post" in column 6, got "${cols[5]}"`);
}
console.log('✓ CoNLL-U Column 6 contains "AdpType=Post" for postposition "all"');

// Preposition in CoNLL-U
const sentPrep = {
  sent_id: 2,
  text: 'Läbi metsa.',
  tokens: [
    { form: 'Läbi', lemma: 'läbi', upos: 'ADP', selectedReading: TagMapper.parse('läbi+Pr') },
    { form: 'metsa', lemma: 'mets', upos: 'NOUN', selectedReading: TagMapper.parse('mets+N+Sg+Gen') },
    { form: '.', lemma: '.', upos: 'PUNCT', isPunct: true, selectedReading: TagMapper.parse('.+CLB') }
  ]
};

const conlluPrep = ConlluExporter.export([sentPrep]);
console.log('Generated CoNLL-U for Preposition:');
console.log(conlluPrep);

const rowLabi = conlluPrep.trim().split('\n').find(l => l.startsWith('1\tLäbi\t'));
const labiCols = rowLabi.split('\t');
if (labiCols[3] !== 'ADP') {
  throw new Error(`Expected UPOS "ADP" in column 4, got "${labiCols[3]}"`);
}
if (labiCols[5] !== 'AdpType=Prep') {
  throw new Error(`Expected FEATS "AdpType=Prep" in column 6, got "${labiCols[5]}"`);
}
console.log('✓ CoNLL-U Column 6 contains "AdpType=Prep" for preposition "Läbi"');

console.log('\n🎉 ALL ADPOSITION FEATURE TESTS PASSED SUCCESSFULLY! 🎉');
