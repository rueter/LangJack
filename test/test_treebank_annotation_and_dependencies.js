/**
 * Test Suite: Universal Dependencies (UD) Manual Treebank Annotation & Visualization
 * Verifies:
 * 1. TreebankService updateTreebank: Modifying and annotating tokens in the accumulative file.
 * 2. CoNLL-U Export with Annotated Dependencies: Generates valid HEAD & DEPREL columns.
 * 3. Language-Specific Custom Relations: Adding, querying, isolating, and removing relations beyond UD standard.
 * 4. Tree Validation & Cycle Detection: Acyclic check, single-root verification, self-loop and range validation.
 * 5. Baseline Dependency Inference: Heuristic suggestion of HEAD and DEPREL from UPOS.
 * 6. Interactive SVG Dependency Visualizer: Generates bezier arcs, ROOT arrows, relation badges, and token cards.
 * 7. End-to-End WorkbenchApp Annotator Controller: Opening annotator, modifying dependencies, adding language relations, and saving back to accumulative file.
 */

import assert from 'node:assert';
import { treebankService } from '../js/services/treebank-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { storageService } from '../js/services/storage-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { dependencyService, UNIVERSAL_UD_RELATIONS, STANDARD_UD_SUBTYPES } from '../js/services/dependency-service.js';
import { DependencyVisualizer, UPOS_COLORS } from '../js/services/dependency-visualizer.js';
import { WorkbenchApp } from '../js/controllers/app.js';

console.log('=== Running Tests for Treebank Dependency Annotation & Visualizer ===\n');

// Clear existing stored treebanks and settings for clean test run
await storageService.clearAccumulatedTreebanks();
await treebankService.init();

// --- 1. Testing Default UD Relations and Standard Subtypes ---
console.log('--- 1. Testing Universal UD Relations and Standard Subtypes ---');
const defaultRels = dependencyService.getDefaultRelations();
assert(defaultRels.length >= 40, `Default relations should have at least 40 relations, got ${defaultRels.length}`);
assert(defaultRels.some(r => r.label === 'nsubj' && r.category === 'core'), 'Should contain "nsubj"');
assert(defaultRels.some(r => r.label === 'obj' && r.category === 'core'), 'Should contain "obj"');
assert(defaultRels.some(r => r.label === 'root' && r.category === 'structural'), 'Should contain "root"');
assert(defaultRels.some(r => r.label === 'compound:svc' && r.category === 'subtype'), 'Should contain standard subtype "compound:svc"');
console.log(`✓ Loaded ${defaultRels.length} default UD relations and subtypes`);

// --- 2. Testing Language-Specific Custom Relations Beyond UD Standard ---
console.log('\n--- 2. Testing Language-Specific Custom Dependency Relations ---');
const apuLang = 'apu';
const smsLang = 'sms';

// Reset to ensure clean state
await dependencyService.resetRelationsForLanguage(apuLang);
await dependencyService.resetRelationsForLanguage(smsLang);

// Apurinã: Add custom serial verb relation
const apuRelsWithCustom = await dependencyService.addCustomRelation(apuLang, 'compound:svc', 'Serial verb construction in Apurinã', 'mwe');
assert(apuRelsWithCustom.some(r => r.label === 'compound:svc' && r.isCustom), 'Apurinã must contain custom compound:svc relation');
console.log('✓ Added custom relation "compound:svc" for Apurinã (apu)');

// Skolt Sámi: Add custom oblique agent relation
const smsRelsWithCustom = await dependencyService.addCustomRelation(smsLang, 'obl:agent', 'Agentive oblique in passive constructions', 'non-core');
assert(smsRelsWithCustom.some(r => r.label === 'obl:agent' && r.isCustom), 'Skolt Sámi must contain custom obl:agent relation');
console.log('✓ Added custom relation "obl:agent" for Skolt Sámi (sms)');

// Verify language isolation (Apurinã custom relations should not pollute Erzya)
const myvRels = await dependencyService.getRelationsForLanguage('myv');
const myvHasApuCustom = myvRels.some(r => r.label === 'compound:svc' && r.isCustom);
assert.strictEqual(myvHasApuCustom, false, 'Erzya (myv) must not inherit Apurinã custom relations');
console.log('✓ Verified strict language isolation: relations can be modified for each language separately');

// Remove custom relation
const apuAfterRemove = await dependencyService.removeCustomRelation(apuLang, 'compound:svc');
assert(!apuAfterRemove.some(r => r.label === 'compound:svc' && r.isCustom), 'compound:svc should be removed from Apurinã custom relations');
console.log('✓ Successfully removed custom relation from language schema');

// Reset language relations
await dependencyService.resetRelationsForLanguage(smsLang);
const smsAfterReset = await dependencyService.getRelationsForLanguage(smsLang);
assert(!smsAfterReset.some(r => r.isCustom), 'Resetting language relations must restore pure UD defaults');
console.log('✓ Reset language relations restored UD defaults cleanly');

// --- 3. Testing Tree Validation & Cycle Detection ---
console.log('\n--- 3. Testing Dependency Tree Validation & Cycle Detection ---');

// 3a. Valid Tree (1 Root, no cycles)
const validTokens = [
  { id: 1, form: 'Kyky', head: 2, deprel: 'nsubj' },
  { id: 2, form: 'atama', head: 0, deprel: 'root' },
  { id: 3, form: 'anãpa', head: 2, deprel: 'obj' }
];
const validCheck = dependencyService.validateDependencies(validTokens);
assert.strictEqual(validCheck.isValid, true, 'Valid tree must pass validation');
assert.strictEqual(validCheck.rootCount, 1, 'Valid tree must have exactly 1 root');
assert.strictEqual(validCheck.errors.length, 0, 'Valid tree must have 0 errors');
console.log('✓ Valid tree passed validation with exactly 1 ROOT');

// 3b. Self-Loop Error (token heads to itself)
const selfLoopTokens = [
  { id: 1, form: 'Kyky', head: 1, deprel: 'nsubj' },
  { id: 2, form: 'atama', head: 0, deprel: 'root' }
];
const loopCheck = dependencyService.validateDependencies(selfLoopTokens);
assert.strictEqual(loopCheck.isValid, false, 'Self-loop must be invalid');
assert(loopCheck.errors.some(e => e.includes('self-loop detected')), 'Must detect self-loop');
console.log('✓ Detected self-loop error');

// 3c. Cycle Error (Token 1 -> Token 2 -> Token 1)
const cycleTokens = [
  { id: 1, form: 'A', head: 2, deprel: 'nmod' },
  { id: 2, form: 'B', head: 1, deprel: 'nmod' }
];
const cycleCheck = dependencyService.validateDependencies(cycleTokens);
assert.strictEqual(cycleCheck.isValid, false, 'Cycle must be invalid');
assert(cycleCheck.errors.some(e => e.includes('Cycle detected')), 'Must detect cycle');
console.log('✓ Detected multi-node cycle error in dependency tree');

// 3d. Out-of-Range Head
const outOfRangeTokens = [
  { id: 1, form: 'A', head: 99, deprel: 'dep' }
];
const rangeCheck = dependencyService.validateDependencies(outOfRangeTokens);
assert.strictEqual(rangeCheck.isValid, false, 'Out-of-range head must be invalid');
assert(rangeCheck.errors.some(e => e.includes('invalid HEAD "99"')), 'Must detect out-of-range HEAD');
console.log('✓ Detected out-of-range HEAD index');

// 3e. Missing Root Warning
const noRootTokens = [
  { id: 1, form: 'A', head: 2, deprel: 'nsubj' },
  { id: 2, form: 'B', head: '_', deprel: '_' }
];
const noRootCheck = dependencyService.validateDependencies(noRootTokens);
assert(noRootCheck.warnings.some(w => w.includes('Sentence has no ROOT token')), 'Must warn if no root token is present');
console.log('✓ Detected missing ROOT warning');

// --- 4. Testing Baseline Dependency Suggestion ---
console.log('\n--- 4. Testing Heuristic Baseline Dependency Inference ---');
const rawTokens = [
  { id: 1, form: 'Цёрась', upos: 'NOUN', lemma: 'цёра' },
  { id: 2, form: 'ловны', upos: 'VERB', lemma: 'ловномс' },
  { id: 3, form: 'книганть', upos: 'NOUN', lemma: 'книга' },
  { id: 4, form: '.', upos: 'PUNCT', lemma: '.' }
];
const inferred = dependencyService.inferBaselineDependencies(rawTokens);
assert.strictEqual(inferred[1].head, 0, 'VERB should be inferred as ROOT (head=0)');
assert.strictEqual(inferred[1].deprel, 'root', 'VERB deprel should be "root"');
assert.strictEqual(inferred[0].head, 2, 'Pre-verbal NOUN should head to VERB');
assert.strictEqual(inferred[0].deprel, 'nsubj', 'Pre-verbal NOUN should be inferred as "nsubj"');
assert.strictEqual(inferred[2].head, 2, 'Post-verbal NOUN should head to VERB');
assert.strictEqual(inferred[2].deprel, 'obj', 'Post-verbal NOUN should be inferred as "obj"');
assert.strictEqual(inferred[3].head, 2, 'Punctuation should head to ROOT');
assert.strictEqual(inferred[3].deprel, 'punct', 'Punctuation deprel should be "punct"');
console.log('✓ Baseline dependencies inferred correctly (ROOT=VERB, nsubj=NOUN, obj=NOUN, punct=PUNCT)');

// --- 5. Testing Interactive SVG Dependency Visualizer Markup ---
console.log('\n--- 5. Testing Interactive SVG Dependency Visualizer ---');
const svg = DependencyVisualizer.renderSvg(inferred, { selectedTokenId: 1 });
assert(svg.includes('<svg class="dependency-tree-svg"'), 'Must generate SVG with correct class');
assert(svg.includes('id="dep-arrow"'), 'Must define standard arrowhead marker');
assert(svg.includes('id="dep-arrow-root"'), 'Must define ROOT arrowhead marker');
assert(svg.includes('class="dep-arc dep-arc-root"'), 'Must render ROOT downward arrow');
assert(svg.includes('class="deprel-badge"'), 'Must render DEPREL badges');
assert(svg.includes('data-token-id="1"'), 'Must render token card for Token 1');
assert(svg.includes('Цёрась'), 'Must render token word form');
assert(svg.includes('цёра'), 'Must render token lemma');
assert(svg.includes('NOUN'), 'Must render UPOS badge');
assert(svg.includes('stroke="#0284c7"'), 'Selected token should be styled with highlighted primary color');
console.log('✓ Dependency visualizer generated complete, interactive SVG markup');

// --- 6. Testing Treebank Accumulator updateTreebank & CoNLL-U Output ---
console.log('\n--- 6. Testing treebankService.updateTreebank & CoNLL-U Output ---');
const sentObj = {
  text: 'Kyky atama anãpa.',
  tokens: [
    { id: 1, form: 'Kyky', lemma: 'kyky', upos: 'NOUN', head: '_', deprel: '_' },
    { id: 2, form: 'atama', lemma: 'atama', upos: 'VERB', head: '_', deprel: '_' },
    { id: 3, form: 'anãpa', lemma: 'anãpa', upos: 'NOUN', head: '_', deprel: '_' }
  ]
};

const savedTb = await treebankService.saveSentence(sentObj, [{ lang: 'eng', text: 'The man sees the dog.' }], 'apu', 'eng');
assert.strictEqual(treebankService.getCount(), 1);
assert.strictEqual(savedTb.tokens[0].head, '_');

// Perform manual dependency annotation update on the accumulated treebank
const annotatedTokens = [
  { id: 1, form: 'Kyky', lemma: 'kyky', upos: 'NOUN', feats: 'Gender=Masc|Number=Sing', head: 2, deprel: 'nsubj' },
  { id: 2, form: 'atama', lemma: 'atama', upos: 'VERB', feats: 'Aspect=Perf|VerbForm=Fin', head: 0, deprel: 'root' },
  { id: 3, form: 'anãpa', lemma: 'anãpa', upos: 'NOUN', feats: 'Case=Acc|Number=Sing', head: 2, deprel: 'obj' }
];

const updatedTb = await treebankService.updateTreebank(savedTb.id, {
  tokens: annotatedTokens
});

assert.strictEqual(updatedTb.tokens[0].head, 2, 'Token 1 HEAD must be updated to 2');
assert.strictEqual(updatedTb.tokens[0].deprel, 'nsubj', 'Token 1 DEPREL must be updated to nsubj');
assert.strictEqual(updatedTb.tokens[1].head, 0, 'Token 2 HEAD must be updated to 0');
assert.strictEqual(updatedTb.tokens[1].deprel, 'root', 'Token 2 DEPREL must be updated to root');
assert.strictEqual(updatedTb.tokens[2].head, 2, 'Token 3 HEAD must be updated to 2');
assert.strictEqual(updatedTb.tokens[2].deprel, 'obj', 'Token 3 DEPREL must be updated to obj');

// Verify retrieval from treebankService
const retrievedTb = treebankService.getTreebank(savedTb.id);
assert.strictEqual(retrievedTb.tokens[0].head, 2);
assert.strictEqual(retrievedTb.tokens[1].head, 0);

// Verify CoNLL-U format with annotated dependencies
const conllu = ConlluExporter.export([retrievedTb]);
console.log('Exported Annotated CoNLL-U:\n' + conllu);

assert(conllu.includes('# sent_id = 1'), 'Must include sent_id comment');
assert(conllu.includes('# text = Kyky atama anãpa.'), 'Must include text comment');
assert(conllu.includes('# text_eng = The man sees the dog.'), 'Must include translation comment');

// Verify tab-separated columns: ID FORM LEMMA UPOS XPOS FEATS HEAD DEPREL DEPS MISC
const conlluLines = conllu.split('\n').filter(l => l && !l.startsWith('#'));
assert.strictEqual(conlluLines.length, 3, 'Must have 3 token lines in CoNLL-U');

const col1 = conlluLines[0].split('\t');
assert.strictEqual(col1[0], '1', 'ID must be 1');
assert.strictEqual(col1[1], 'Kyky', 'FORM must be Kyky');
assert.strictEqual(col1[6], '2', 'HEAD must be 2');
assert.strictEqual(col1[7], 'nsubj', 'DEPREL must be nsubj');

const col2 = conlluLines[1].split('\t');
assert.strictEqual(col2[0], '2', 'ID must be 2');
assert.strictEqual(col2[1], 'atama', 'FORM must be atama');
assert.strictEqual(col2[6], '0', 'HEAD must be 0 for root');
assert.strictEqual(col2[7], 'root', 'DEPREL must be root');

const col3 = conlluLines[2].split('\t');
assert.strictEqual(col3[0], '3', 'ID must be 3');
assert.strictEqual(col3[1], 'anãpa', 'FORM must be anãpa');
assert.strictEqual(col3[6], '2', 'HEAD must be 2');
assert.strictEqual(col3[7], 'obj', 'DEPREL must be obj');

console.log('✓ Successfully verified CoNLL-U presentation with annotated HEAD and DEPREL');

// --- 7. Testing End-to-End WorkbenchApp Annotator Controller ---
console.log('\n--- 7. Testing WorkbenchApp Treebank Annotator Controller ---');
const app = new WorkbenchApp();
app.srcLang = 'apu';

// 7a. Open Annotator for treebank
const openedTb = await app.openTreebankAnnotator(savedTb.id);
assert.strictEqual(openedTb.id, savedTb.id, 'App must open the target treebank');
assert.strictEqual(app.workingAnnotatingTokens.length, 3, 'Working copy must contain all 3 tokens');
console.log('✓ WorkbenchApp opened Treebank Annotator for Treebank #1');

// 7b. Perform quick annotation modifications
app.selectedAnnotatingTokenId = 1;
app.handleQuickHeadChange(2);
app.handleQuickDeprelChange('nsubj');

app.selectedAnnotatingTokenId = 2;
app.handleQuickSetRoot();

app.selectedAnnotatingTokenId = 3;
app.handleQuickHeadChange(2);
app.handleQuickDeprelChange('obj');

// 7c. Update tree validation
const valResult = app.updateAnnotatorValidation();
assert.strictEqual(valResult.isValid, true, 'Validation must report valid UD tree');
assert.strictEqual(valResult.rootCount, 1, 'Validation must confirm single root');
console.log('✓ Dependency modification and validation successful in controller');

// 7d. Add a custom relation through app controller
app.newDeprelInput = { value: 'compound:svc' };
app.newDeprelDescInput = { value: 'Serial verb modifier' };
await app.handleAddCustomRelation();
assert(app.annotatorLangRelations.some(r => r.label === 'compound:svc'), 'App relations must include new custom relation');
console.log('✓ Successfully added custom relation through WorkbenchApp controller');

// 7e. Save annotated changes back to accumulative file
const savedResult = await app.saveAnnotatedTreebank();
assert.strictEqual(savedResult.tokens[0].head, 2);
assert.strictEqual(savedResult.tokens[1].head, 0);
assert.strictEqual(savedResult.tokens[1].deprel, 'root');
console.log('✓ Successfully saved annotated changes back to the accumulative file');

// --- 8. Testing Automatic Assignment of Dependency Relation «punct» to UPOS PUNCT by Default ---
console.log('\n--- 8. Testing Automatic Assignment of Dependency Relation «punct» by Default ---');

// 8a. Morphological analysis automatically assigns punct to punctuation token
const punctSent = await analyzerService.analyzeText('Kissa nukkuu talossa.', 'fin');
const punctTok = punctSent[0].tokens.find(t => t.form === '.');
assert(punctTok !== undefined, 'Period token must exist in analyzed sentence');
assert.strictEqual(punctTok.upos, 'PUNCT', 'Period must have UPOS PUNCT');
assert.strictEqual(punctTok.deprel, 'punct', 'Period with UPOS PUNCT must be automatically assigned relation "punct" by default');
console.log('✓ analyzerService automatically assigns deprel "punct" to token with UPOS PUNCT');

// 8b. Saving sentence to treebank preserves default punct relation for UPOS PUNCT
const punctTb = await treebankService.saveSentence(punctSent[0], [], 'fin');
const tbPunctTok = punctTb.tokens.find(t => t.form === '.');
assert.strictEqual(tbPunctTok.upos, 'PUNCT');
assert.strictEqual(tbPunctTok.deprel, 'punct', 'Saved treebank token with UPOS PUNCT must have deprel "punct"');
console.log('✓ treebankService.saveSentence preserves deprel "punct" for UPOS PUNCT tokens');

// 8c. Opening annotator ensures UPOS PUNCT tokens default to "punct" even if unannotated
const unannotatedPunctTb = await treebankService.saveSentence({
  text: 'Test sentence.',
  tokens: [
    { id: 1, form: 'Test', upos: 'NOUN', head: '_', deprel: '_' },
    { id: 2, form: 'sentence', upos: 'NOUN', head: '_', deprel: '_' },
    { id: 3, form: '.', isPunct: true, upos: 'PUNCT', head: '_', deprel: '_' }
  ]
}, [], 'eng');

const testApp = new WorkbenchApp();
await testApp.openTreebankAnnotator(unannotatedPunctTb.id);
const openedPunctTok = testApp.workingAnnotatingTokens.find(t => t.id === 3);
assert.strictEqual(openedPunctTok.upos, 'PUNCT');
assert.strictEqual(openedPunctTok.deprel, 'punct', 'Annotator must normalize UPOS PUNCT token deprel to "punct" by default');
console.log('✓ openTreebankAnnotator automatically assigns deprel "punct" to UPOS PUNCT token');

// 8d. Changing UPOS to PUNCT in quick controls automatically assigns relation "punct"
testApp.selectedAnnotatingTokenId = 2; // Token 2: 'sentence'
testApp.handleQuickUposChange('PUNCT');
const updatedTok2 = testApp.workingAnnotatingTokens.find(t => t.id === 2);
assert.strictEqual(updatedTok2.upos, 'PUNCT');
assert.strictEqual(updatedTok2.deprel, 'punct', 'Switching UPOS to PUNCT must automatically set deprel to "punct"');
console.log('✓ Changing UPOS to PUNCT in quick controls automatically updates relation to "punct"');

// 8e. CoNLL-U Exporter outputs "punct" for UPOS PUNCT tokens by default
const exportedConllu = ConlluExporter.export([unannotatedPunctTb]);
const conlluPunctLine = exportedConllu.split('\n').find(l => l.startsWith('3\t.'));
assert(conlluPunctLine !== undefined, 'Line 3 for punctuation must exist');
const conlluPunctCols = conlluPunctLine.split('\t');
assert.strictEqual(conlluPunctCols[3], 'PUNCT', 'CoNLL-U UPOS must be PUNCT');
assert.strictEqual(conlluPunctCols[7], 'punct', 'CoNLL-U DEPREL must be punct by default');
console.log('✓ ConlluExporter outputs DEPREL "punct" for UPOS PUNCT tokens by default');

// --- 9. Testing Graph Selection, Form/Lemma Editing, and Explicit Root/Head Connection ---
console.log('\n--- 9. Testing Graph Selection, Form/Lemma Editing, and Explicit Root/Head Connection ---');

const testSentence9 = {
  text: 'Mun māna skuvlii',
  tokens: [
    { id: 1, form: 'Mun', lemma: 'mun', upos: 'PRON', head: '_', deprel: '_' },
    { id: 2, form: 'māna', lemma: 'mānnat', upos: 'VERB', head: '_', deprel: '_' },
    { id: 3, form: 'skuvlii', lemma: 'skuvla', upos: 'NOUN', head: '_', deprel: '_' }
  ]
};

const tb9 = await treebankService.saveSentence(testSentence9, [], 'sme');
const app9 = new WorkbenchApp();

// Create mock DOM elements required for app9 controls
app9.annotateTbSentText = { textContent: '' };
app9.quickTokName = { textContent: '' };
app9.quickFormInput = { value: '', disabled: false, focus: () => {}, select: () => {} };
app9.quickLemmaInput = { value: '', disabled: false };
app9.quickHeadSelect = { value: '', innerHTML: '', disabled: false, appendChild: () => {} };
app9.quickDeprelSelect = { value: '', innerHTML: '', disabled: false, appendChild: () => {}, options: [] };
app9.quickUposSelect = { value: '', innerHTML: '', disabled: false };
app9.quickSetRootBtn = { disabled: false };
app9.quickConnectHeadBtn = { disabled: false, className: '', textContent: '' };
app9.activeSelectionHint = { textContent: '' };
app9.selectedTokenQuickControls = { style: { display: '' } };

// 9a. Verify opening treebank starts with NO pre-selected token and DOES NOT make token 1 root
await app9.openTreebankAnnotator(tb9.id);
assert.strictEqual(app9.selectedAnnotatingTokenId, null, 'Modal must open with selectedAnnotatingTokenId = null');
assert.strictEqual(app9.workingAnnotatingTokens[0].head, '_', 'Token 1 must NOT automatically become ROOT or predict itself to be root on open');
assert.strictEqual(app9.workingAnnotatingTokens[0].deprel, '_', 'Token 1 deprel must remain unassigned on open');
assert.strictEqual(app9.quickFormInput.disabled, true, 'Quick inputs must be disabled when no token is selected');
assert(app9.quickTokName.textContent.includes('Click any token card'), 'Header hint must instruct user to select a token');
console.log('✓ Modal opens cleanly without token 1 pre-activation or automatic root prediction');

// 9b. Clicking Token 2 selects Token 2 cleanly without changing head or making it root
app9.handleVisualTokenClick(2);
assert.strictEqual(app9.selectedAnnotatingTokenId, 2, 'Clicking token 2 must select token 2');
assert.strictEqual(app9.workingAnnotatingTokens[1].head, '_', 'Clicking token 2 must NOT modify its HEAD');
assert.strictEqual(app9.workingAnnotatingTokens[1].deprel, '_', 'Clicking token 2 must NOT modify its DEPREL');
assert.strictEqual(app9.quickFormInput.disabled, false, 'Quick form input must be enabled once token 2 is selected');
assert.strictEqual(app9.quickFormInput.value, 'māna', 'Quick form input must reflect token 2 form');
console.log('✓ Clicking Token 2 selects it cleanly without accidental reparenting or root toggling');

// 9c. Selecting Token 3 and Token 1 cleanly
app9.handleVisualTokenClick(3);
assert.strictEqual(app9.selectedAnnotatingTokenId, 3, 'Clicking token 3 must select token 3');
assert.strictEqual(app9.quickFormInput.value, 'skuvlii');
assert.strictEqual(app9.workingAnnotatingTokens[2].head, '_');

app9.handleVisualTokenClick(1);
assert.strictEqual(app9.selectedAnnotatingTokenId, 1, 'Clicking token 1 must select token 1');
assert.strictEqual(app9.quickFormInput.value, 'Mun');
assert.strictEqual(app9.workingAnnotatingTokens[0].head, '_');
console.log('✓ Can freely select any other token in the sentence without side effects');

// 9d. Editing token text (FORM and LEMMA) updates sentence text in real time
app9.handleVisualTokenClick(2);
app9.handleQuickFormChange('manan');
assert.strictEqual(app9.workingAnnotatingTokens[1].form, 'manan', 'Token 2 form must be updated to "manan"');
assert.strictEqual(app9.currentAnnotatingTb.text, 'Mun manan skuvlii', 'Treebank sentence text must sync with updated token forms');
assert.strictEqual(app9.annotateTbSentText.textContent, 'Mun manan skuvlii', 'Header sentence text element must update');

app9.handleQuickLemmaChange('mannat');
assert.strictEqual(app9.workingAnnotatingTokens[1].lemma, 'mannat', 'Token 2 lemma must be updated to "mannat"');
console.log('✓ Form and lemma editing update token text and sentence string in real time');

// 9e. Explicitly setting Root
app9.handleQuickSetRoot();
assert.strictEqual(app9.workingAnnotatingTokens[1].head, 0, 'handleQuickSetRoot must set HEAD to 0');
assert.strictEqual(app9.workingAnnotatingTokens[1].deprel, 'root', 'handleQuickSetRoot must set DEPREL to "root"');
console.log('✓ Explicit "⭐ Set Root" button sets token 2 as sentence ROOT');

// 9f. Using "🔗 Connect Head" mode to connect Token 1 -> Token 2
app9.handleVisualTokenClick(1);
app9.toggleConnectHeadMode();
assert.strictEqual(app9.isConnectingHead, true, 'Connect Head mode should be active');
assert.strictEqual(app9.quickConnectHeadBtn.textContent, '❌ Cancel Linking');

// Clicking Token 2 while in Connect Head mode connects Token 2 as HEAD of Token 1
app9.handleVisualTokenClick(2);
assert.strictEqual(app9.isConnectingHead, false, 'Connect Head mode should deactivate after connection');
assert.strictEqual(app9.workingAnnotatingTokens[0].head, 2, 'Token 1 head must now be Token 2');
assert.strictEqual(app9.workingAnnotatingTokens[0].deprel, 'dep', 'Token 1 deprel should default to "dep"');
console.log('✓ "🔗 Connect Head" mode cleanly connects head without interfering with normal token selection');

// 9g. Saving back to treebank preserves edited text and dependencies
const savedTb9 = await app9.saveAnnotatedTreebank();
assert.strictEqual(savedTb9.text, 'Mun manan skuvlii', 'Saved treebank text must contain edited form');
assert.strictEqual(savedTb9.tokens[1].form, 'manan');
assert.strictEqual(savedTb9.tokens[1].lemma, 'mannat');
assert.strictEqual(savedTb9.tokens[1].head, 0);
assert.strictEqual(savedTb9.tokens[1].deprel, 'root');
assert.strictEqual(savedTb9.tokens[0].head, 2);
console.log('✓ Saved annotated treebank contains edited text and clean dependency relations');

// Clean up
await treebankService.clearAccumulatedFile();
await dependencyService.resetRelationsForLanguage('apu');
await dependencyService.resetRelationsForLanguage('sms');

console.log('\n🎉 ALL TREEBANK ANNOTATION & DEPENDENCY VISUALIZER TESTS PASSED! 🎉');
