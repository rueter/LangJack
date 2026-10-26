/**
 * Test Suite: Multi-Sentence Treebank Accumulator & Simultaneous Download
 * Verifies:
 * 1. TreebankService initializes cleanly.
 * 2. Completed sentences can be saved sequentially as treebanks in order (sent_id = 1, 2, 3...).
 * 3. Subsequent sentences can be dealt with and saved as the next treebank in order.
 * 4. Several treebanks can be saved in the same accumulative file for download (.conllu).
 * 5. Generation of individual single-treebank files for simultaneous downloads.
 * 6. Deleting a treebank re-indexes remaining treebanks in sequential order.
 * 7. Manual removal of the accumulative file clears persistent storage and resets state.
 */

import assert from 'node:assert';
import { treebankService } from '../js/services/treebank-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { storageService } from '../js/services/storage-service.js';
import { WorkbenchApp } from '../js/controllers/app.js';

console.log('=== Running Tests for Multi-Treebank Accumulator & Simultaneous Downloads ===\n');

// Clear any existing stored treebanks for clean test run
await storageService.clearAccumulatedTreebanks();
await treebankService.init();
assert.strictEqual(treebankService.getCount(), 0, 'Initial treebank count should be 0');
console.log('✓ Initialized TreebankService with 0 treebanks');

// Initialize analyzers and dictionaries
await analyzerService.init('apu');
await dictionaryService.init();

// --- 1. Deal with First Sentence and Save as Treebank #1 ---
console.log('\n--- 1. Testing First Sentence Completion & Saving as Treebank #1 ---');
const sent1Text = 'Kyky atama anãpa.';
const analyzedSent1 = await analyzerService.analyzeText(sent1Text, 'apu');
const sent1Obj = analyzedSent1[0];

// Annotate tokens
sent1Obj.tokens[0].selectedGloss = { gloss: 'homem', lang: 'por' };
sent1Obj.tokens[1].selectedGloss = { gloss: 'ver', lang: 'por' };
sent1Obj.tokens[2].selectedGloss = { gloss: 'cachorro', lang: 'por' };
const sent1Translations = [
  { id: 1, lang: 'por', text: 'O homem vê o cachorro.' },
  { id: 2, lang: 'eng', text: 'The man sees the dog.' }
];

const tb1 = await treebankService.saveSentence(sent1Obj, sent1Translations, 'apu', 'por');
assert.strictEqual(tb1.sent_id, 1, 'First treebank must have sent_id = 1');
assert.strictEqual(tb1.order, 1, 'First treebank must have order = 1');
assert.strictEqual(tb1.text, sent1Text);
assert.strictEqual(tb1.srcLang, 'apu');
assert.strictEqual(treebankService.getCount(), 1, 'Accumulated count should now be 1');
console.log(`✓ Saved Treebank #1 ("${tb1.text}") in accumulative file`);

// --- 2. Deal with Subsequent Sentence and Save as Next Treebank in Order (#2) ---
console.log('\n--- 2. Testing Subsequent Sentence Completion & Saving as Treebank #2 ---');
const sent2Text = 'Amatsotxi katsupatxi.';
const analyzedSent2 = await analyzerService.analyzeText(sent2Text, 'apu');
const sent2Obj = analyzedSent2[0];

sent2Obj.tokens[0].selectedGloss = { gloss: 'criança', lang: 'por' };
sent2Obj.tokens[1].selectedGloss = { gloss: 'doente', lang: 'por' };
const sent2Translations = [
  { id: 1, lang: 'por', text: 'A criança está doente.' },
  { id: 2, lang: 'eng', text: 'The child is sick.' }
];

const tb2 = await treebankService.saveSentence(sent2Obj, sent2Translations, 'apu', 'por');
assert.strictEqual(tb2.sent_id, 2, 'Second treebank must have sent_id = 2 in order');
assert.strictEqual(tb2.order, 2, 'Second treebank must have order = 2 in order');
assert.strictEqual(tb2.text, sent2Text);
assert.strictEqual(treebankService.getCount(), 2, 'Accumulated count should now be 2');
console.log(`✓ Saved subsequent sentence as Treebank #2 ("${tb2.text}") in order`);

// --- 3. Deal with Third Sentence and Save as Next Treebank in Order (#3) ---
console.log('\n--- 3. Testing Third Sentence Completion & Saving as Treebank #3 ---');
const sent3Text = 'Ãatsupa aiku awapukutxi.';
const analyzedSent3 = await analyzerService.analyzeText(sent3Text, 'apu');
const sent3Obj = analyzedSent3[0];

sent3Obj.tokens[0].selectedGloss = { gloss: 'caderno', lang: 'por' };
sent3Obj.tokens[1].selectedGloss = { gloss: 'casa', lang: 'por' };
sent3Obj.tokens[2].selectedGloss = { gloss: 'aldeia', lang: 'por' };
const sent3Translations = [
  { id: 1, lang: 'por', text: 'O caderno na casa da aldeia.' }
];

const tb3 = await treebankService.saveSentence(sent3Obj, sent3Translations, 'apu', 'por');
assert.strictEqual(tb3.sent_id, 3, 'Third treebank must have sent_id = 3 in order');
assert.strictEqual(tb3.order, 3, 'Third treebank must have order = 3 in order');
assert.strictEqual(treebankService.getCount(), 3, 'Accumulated count should now be 3');
console.log(`✓ Saved third sentence as Treebank #3 ("${tb3.text}") in order`);

// --- 4. Testing Multi-Treebank Combined Accumulative File (.conllu) ---
console.log('\n--- 4. Testing Several Treebanks Saved in the Same File for Download ---');
const combinedConllu = treebankService.generateCombinedConllu();
assert(combinedConllu.includes('# sent_id = 1'), 'Combined file must include sentence 1');
assert(combinedConllu.includes('# text = Kyky atama anãpa.'), 'Combined file must include text of sentence 1');
assert(combinedConllu.includes('# text_por = O homem vê o cachorro.'), 'Combined file must include por translation of sent 1');

assert(combinedConllu.includes('# sent_id = 2'), 'Combined file must include sentence 2 in order');
assert(combinedConllu.includes('# text = Amatsotxi katsupatxi.'), 'Combined file must include text of sentence 2');
assert(combinedConllu.includes('# text_por = A criança está doente.'), 'Combined file must include por translation of sent 2');

assert(combinedConllu.includes('# sent_id = 3'), 'Combined file must include sentence 3 in order');
assert(combinedConllu.includes('# text = Ãatsupa aiku awapukutxi.'), 'Combined file must include text of sentence 3');

// Check sentence separation by blank lines in UD CoNLL-U format
const blocks = combinedConllu.trim().split(/\n\s*\n/);
assert.strictEqual(blocks.length, 3, 'Must contain 3 distinct sentence blocks separated by blank lines');
console.log('✓ Successfully generated single accumulative CoNLL-U file containing 3 treebanks in sequential order');
console.log('Preview of Combined CoNLL-U:\n' + combinedConllu.substring(0, 450) + '\n...\n');

// --- 5. Testing Generation of Simultaneous Download Files ---
console.log('\n--- 5. Testing Simultaneous Download File Generation ---');
const treebanks = treebankService.getTreebanks();
const singleFiles = treebanks.map(tb => ({
  filename: `treebank_sent_${String(tb.sent_id).padStart(2, '0')}_${tb.srcLang}.conllu`,
  content: treebankService.generateSingleConllu(tb)
}));

assert.strictEqual(singleFiles.length, 3, 'Should generate 3 individual files for simultaneous download');
assert.strictEqual(singleFiles[0].filename, 'treebank_sent_01_apu.conllu');
assert.strictEqual(singleFiles[1].filename, 'treebank_sent_02_apu.conllu');
assert.strictEqual(singleFiles[2].filename, 'treebank_sent_03_apu.conllu');
assert(singleFiles[0].content.includes('# sent_id = 1'));
assert(singleFiles[1].content.includes('# sent_id = 2'));
assert(singleFiles[2].content.includes('# sent_id = 3'));
console.log('✓ Ready for simultaneous download of multiple individual treebank files:');
singleFiles.forEach(f => console.log(`   - ${f.filename} (${f.content.length} bytes)`));

// --- 6. Testing Deletion & Automatic Order Re-indexing ---
console.log('\n--- 6. Testing Deletion of Treebank #2 and Order Re-indexing ---');
await treebankService.deleteTreebank(tb2.id);
assert.strictEqual(treebankService.getCount(), 2, 'Count should decrease to 2');

const updatedTreebanks = treebankService.getTreebanks();
assert.strictEqual(updatedTreebanks[0].sent_id, 1, 'First remains sent_id = 1');
assert.strictEqual(updatedTreebanks[1].sent_id, 2, 'Former #3 is re-indexed to sent_id = 2 in order');
assert.strictEqual(updatedTreebanks[1].text, sent3Text);
console.log('✓ Re-indexed treebanks after deletion:');
updatedTreebanks.forEach(t => console.log(`   Treebank #${t.sent_id}: "${t.text}"`));

// --- 7. Testing Manual Removal of Accumulative File ---
console.log('\n--- 7. Testing Manual Removal of Accumulative File ---');
await treebankService.clearAccumulatedFile();
assert.strictEqual(treebankService.getCount(), 0, 'Count should be 0 after manual removal');

// Verify persistent storage is empty
const storedAfterRemoval = await storageService.getAllAccumulatedTreebanks();
assert.strictEqual(storedAfterRemoval.length, 0, 'Storage must be completely cleared after manual removal');
console.log('✓ Accumulative file was manually removed and persistent storage cleared');

// --- 8. Testing Starting a Subsequent Fresh Batch After Removal ---
console.log('\n--- 8. Testing New Batch Starting as Next Treebank #1 After Removal ---');
const newBatchSent = 'Kyky awapukutxi.';
const analyzedNew = await analyzerService.analyzeText(newBatchSent, 'apu');
const tbNew = await treebankService.saveSentence(analyzedNew[0], [], 'apu', 'por');
assert.strictEqual(tbNew.sent_id, 1, 'New batch must start at sent_id = 1');
assert.strictEqual(treebankService.getCount(), 1, 'Count should be 1');
console.log(`✓ Started fresh batch as Treebank #${tbNew.sent_id}: "${tbNew.text}"`);

// Clean up after test
await treebankService.clearAccumulatedFile();

// --- 9. Testing Duplicate Detection in TreebankService ---
console.log('\n--- 9. Testing Duplicate Treebank Detection in TreebankService ---');
await treebankService.clearAccumulatedFile();

const dupSent1Text = 'Kyky atama anãpa.';
const analyzedDup1 = await analyzerService.analyzeText(dupSent1Text, 'apu');
const tbDup1 = await treebankService.saveSentence(analyzedDup1[0], [], 'apu', 'por');
assert.strictEqual(treebankService.getCount(), 1, 'Should have 1 treebank saved');

// Check exact duplicate detection
const dupMatchExact = treebankService.findDuplicate(analyzedDup1[0], 'apu');
assert(dupMatchExact !== null, 'Exact duplicate sentence should be found');
assert.strictEqual(dupMatchExact.sent_id, tbDup1.sent_id, 'Duplicate should match Treebank #1');
assert.strictEqual(treebankService.isDuplicate(analyzedDup1[0], 'apu'), true);

// Check whitespace/casing normalization in duplicate detection
const dupMatchNormalized = treebankService.findDuplicate('  KYKY   atama   ANÃPA.  ', 'apu');
assert(dupMatchNormalized !== null, 'Normalized duplicate should match despite casing/spacing');
assert.strictEqual(dupMatchNormalized.sent_id, tbDup1.sent_id);

// Check that a novel sentence is NOT detected as duplicate
const novelSentText = 'Ãamyna awapukutxi.';
const analyzedNovel = await analyzerService.analyzeText(novelSentText, 'apu');
assert.strictEqual(treebankService.findDuplicate(analyzedNovel[0], 'apu'), null);
assert.strictEqual(treebankService.isDuplicate(analyzedNovel[0], 'apu'), false);

// Check findDuplicates on an array of sentences (one duplicate, one new)
const batchDuplicates = treebankService.findDuplicates([analyzedDup1[0], analyzedNovel[0]], 'apu');
assert.strictEqual(batchDuplicates.length, 1, 'Should detect exactly 1 duplicate in batch');
assert.strictEqual(batchDuplicates[0].existing.sent_id, tbDup1.sent_id);
console.log('✓ Successfully verified duplicate detection (exact, normalized, novel, and batch)');

// --- 10. Testing Confirmation Requirement for Repeated Treebank Save Commands ---
console.log('\n--- 10. Testing Confirmation Requirement on Repeating Treebank Save Commands ---');
const app = new WorkbenchApp();
app.srcLang = 'apu';
app.targetLang = 'por';
app.sentences = [analyzedDup1[0]]; // Sentence already saved as Treebank #1

// 10a. User cancels confirmation (repeating save should NOT add duplicate)
let confirmPromptText = '';
app.confirmHandler = (msg) => {
  confirmPromptText = msg;
  return false; // User cancels confirmation
};

const countBeforeCancelled = treebankService.getCount();
await app.handleSaveCompletedTreebank(false);
const countAfterCancelled = treebankService.getCount();
assert.strictEqual(countAfterCancelled, countBeforeCancelled, 'Treebank count must NOT increase when duplicate confirmation is cancelled');
assert(confirmPromptText.includes('has already been saved as Treebank #1'), 'Confirmation prompt must clearly identify existing treebank');
console.log('✓ When user cancels confirmation, repeated save command does NOT add duplicate treebank');

// 10b. User accepts confirmation (repeating save DOES add duplicate when confirmed)
let confirmAccepted = false;
app.confirmHandler = (msg) => {
  confirmAccepted = true;
  return true; // User accepts confirmation
};

await app.handleSaveCompletedTreebank(false);
const countAfterConfirmed = treebankService.getCount();
assert.strictEqual(countAfterConfirmed, countBeforeCancelled + 1, 'Treebank count MUST increase when duplicate is explicitly confirmed');
assert(confirmAccepted, 'Confirmation handler should have been invoked');
console.log('✓ When user confirms duplicate save, treebank is added as confirmed');

// 10c. Save & Next Sentence button: User cancels duplicate, but opts to clear workspace for next sentence
const appNext = new WorkbenchApp();
appNext.srcLang = 'apu';
appNext.sentences = [analyzedDup1[0]];
let clearPromptSeen = false;
appNext.confirmHandler = (msg) => {
  if (msg.includes('already been saved')) {
    return false; // Cancel adding duplicate
  }
  if (msg.includes('clear the workspace')) {
    clearPromptSeen = true;
    return true; // Proceed with clearing workspace for subsequent sentence
  }
  return false;
};

const countBeforeNext = treebankService.getCount();
await appNext.handleSaveCompletedTreebank(true);
assert.strictEqual(treebankService.getCount(), countBeforeNext, 'No duplicate added');
assert.strictEqual(clearPromptSeen, true, 'User was asked if they want to clear workspace');
assert.strictEqual(appNext.sentences.length, 0, 'Workspace cleared for subsequent sentence');
console.log('✓ "Save & Next Sentence" handles duplicate cancellation gracefully and clears workspace if confirmed');

// Clean up after test
await treebankService.clearAccumulatedFile();

console.log('\n🎉 ALL MULTI-TREEBANK ACCUMULATOR & SIMULTANEOUS DOWNLOAD TESTS PASSED! 🎉');
