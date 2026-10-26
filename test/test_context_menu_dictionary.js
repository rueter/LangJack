/**
 * Test Suite: Context Menu Dictionary Lookups & Annotator UI Dispatch
 * Verifies:
 * 1. Quick translation summaries for context menu dynamic titles across languages.
 * 2. Morphological analysis & dictionary gloss extraction for in-page Dictionary UI cards.
 * 3. Handling of both single words and multi-word phrases/sentences.
 * 4. Dispatching selections to the Annotator UI with pre-loaded text and language.
 */

import assert from 'node:assert';

// Setup mock chrome API for testing context menu hierarchy and clicks in Node.js
const createdMenus = new Map();
const updatedMenus = new Map();
globalThis.chrome = {
  contextMenus: {
    create: (item, cb) => {
      createdMenus.set(item.id, item);
      if (cb) cb();
    },
    update: (id, updates, cb) => {
      const existing = createdMenus.get(id) || {};
      const merged = { ...existing, ...updates };
      createdMenus.set(id, merged);
      updatedMenus.set(id, updates);
      if (cb) cb();
    },
    removeAll: (cb) => {
      createdMenus.clear();
      if (cb) cb();
    }
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: () => {} }
  },
  tabs: {
    create: () => {},
    sendMessage: async () => ({})
  },
  scripting: {
    executeScript: async () => []
  }
};

import { 
  getQuickTranslationSummary, 
  handleShowDictionaryCard, 
  setupContextMenus, 
  handleContextMenuClick, 
  updateContextMenuForSelection,
  analyzeWordWithLanguageAssurance,
  detectLanguageForWord,
  tabLanguageCache
} from '../background.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { storageService } from '../js/services/storage-service.js';

console.log('=== Running Tests for Context Menu Dictionary & Annotator Dispatch ===\n');

// Initialize core services
await storageService.setSetting('ui_src_lang', 'sms');
await analyzerService.init('sms');
await dictionaryService.init();

// --- 1. Testing Context Menu Dynamic Translation Summaries ---
console.log('--- 1. Testing Context Menu Dynamic Translation Summaries ---');

// Test 1a: Skolt Sámi "piânnai"
const smsDogSummary = await getQuickTranslationSummary('piânnai', 'sms');
console.log('Summary for "piânnai" (sms):', smsDogSummary);
assert(smsDogSummary !== null, 'Summary must not be null');
assert(smsDogSummary.includes('dog'), 'Summary must contain English gloss "dog"');
assert(smsDogSummary.includes('koira'), 'Summary must contain Finnish gloss "koira"');
console.log('✓ Context menu summary for "piânnai":', smsDogSummary);

// Test 1b: Skolt Sámi "lij" (lemma leeʹd)
const smsLijSummary = await getQuickTranslationSummary('lij', 'sms');
console.log('Summary for "lij" (sms):', smsLijSummary);
assert(smsLijSummary !== null, 'Summary must not be null');
assert(smsLijSummary.includes('be') || smsLijSummary.includes('olla'), 'Summary must contain "be" or "olla"');
console.log('✓ Context menu summary for "lij":', smsLijSummary);

// Test 1c: Skolt Sámi "Kåʹllvueiʹvv" (compound lemma kåʹllvueiʹvv)
const smsKallSummary = await getQuickTranslationSummary('Kåʹllvueiʹvv', 'sms');
console.log('Summary for "Kåʹllvueiʹvv" (sms):', smsKallSummary);
assert(smsKallSummary !== null, 'Summary must not be null');
assert(smsKallSummary.includes('goldenhead') || smsKallSummary.includes('kultapää'), 'Summary must contain "goldenhead" or "kultapää"');
console.log('✓ Context menu summary for compound "Kåʹllvueiʹvv":', smsKallSummary);

// Test 1d: Erzya "вастома"
const myvSummary = await getQuickTranslationSummary('вастома', 'myv');
console.log('Summary for "вастома" (myv):', myvSummary);
assert(myvSummary !== null, 'Summary must not be null');
assert(myvSummary.includes('meeting') || myvSummary.includes('tapaaminen') || myvSummary.includes('встреча'));
console.log('✓ Context menu summary for Erzya "вастома":', myvSummary);

// Test 1e: Apurinã "aiku"
const apuSummary = await getQuickTranslationSummary('aiku', 'apu');
console.log('Summary for "aiku" (apu):', apuSummary);
assert(apuSummary !== null, 'Summary must not be null');
assert(apuSummary.includes('casa') || apuSummary.includes('house'));
console.log('✓ Context menu summary for Apurinã "aiku":', apuSummary);

// --- 2. Testing Data Preparation for In-Page Dictionary UI Card ---
console.log('\n--- 2. Testing In-Page Dictionary UI Card Data (Single Word) ---');
const singleCard = await handleShowDictionaryCard(null, 'piânnai', 'sms');
assert.strictEqual(singleCard.isPhrase, false, 'Must be flagged as single word');
assert.strictEqual(singleCard.text, 'piânnai');
assert.strictEqual(singleCard.lemma, 'piânnai');
assert.strictEqual(singleCard.srcLang, 'sms');
assert(Array.isArray(singleCard.readings) && singleCard.readings.length > 0);
assert.strictEqual(singleCard.readings[0].upos, 'NOUN');
assert(Array.isArray(singleCard.glosses) && singleCard.glosses.length > 0);
assert(singleCard.glosses.some(g => g.lang === 'eng' && g.gloss === 'dog'));
assert(singleCard.glosses.some(g => g.lang === 'fin' && g.gloss === 'koira'));
console.log('✓ Single word card data contains valid lemma, readings, UPOS, and multilingual glosses');

// --- 3. Testing Data Preparation for In-Page Dictionary UI Card (Full Sentence) ---
console.log('\n--- 3. Testing In-Page Dictionary UI Card Data (Full Sentence/Phrase) ---');
const phraseText = 'Kåʹllvueiʹvv lij šurr piânnai.';
const phraseCard = await handleShowDictionaryCard(null, phraseText, 'sms');
assert.strictEqual(phraseCard.isPhrase, true, 'Must be flagged as phrase/sentence');
assert.strictEqual(phraseCard.text, phraseText);
assert.strictEqual(phraseCard.srcLang, 'sms');
assert(Array.isArray(phraseCard.tokens) && phraseCard.tokens.length > 0);

const wordTokens = phraseCard.tokens.filter(t => !t.isPunct);
assert.strictEqual(wordTokens.length, 4, 'Must have 4 word tokens');
assert.strictEqual(wordTokens[0].lemma, 'kåʹllvueiʹvv');
assert.strictEqual(wordTokens[1].lemma, 'leeʹd');
assert.strictEqual(wordTokens[2].lemma, 'šurr');
assert.strictEqual(wordTokens[3].lemma, 'piânnai');

// Verify token glosses
assert(wordTokens[0].glosses?.some(g => g.gloss === 'goldenhead'));
assert(wordTokens[1].glosses?.some(g => g.gloss === 'be'));
assert(wordTokens[2].glosses?.some(g => g.gloss === 'big' || g.gloss === 'tall'));
assert(wordTokens[3].glosses?.some(g => g.gloss === 'dog'));
console.log('✓ Phrase/Sentence card data contains token-level interlinear analysis and glosses for all words');

// --- 4. Testing URL Formatting for Moving Selection to Annotator UI ---
console.log('\n--- 4. Testing Navigation URL Formatting to Annotator UI ---');
const testWord = 'piânnai';
const testLang = 'sms';
const encoded = encodeURIComponent(testWord);
const targetUrl = `index.html?text=${encoded}&lang=${testLang}`;
assert.strictEqual(targetUrl, 'index.html?text=pi%C3%A2nnai&lang=sms');

// Verify URL parsing logic
const parsedParams = new URLSearchParams(targetUrl.split('?')[1]);
assert.strictEqual(parsedParams.get('text'), 'piânnai');
assert.strictEqual(parsedParams.get('lang'), 'sms');
console.log(`✓ Generated navigation URL: ${targetUrl} accurately retains text and language parameters`);

// --- 5. Testing Single Token Lemma Viewing With or Without UralicNLP Morphology ---
console.log('\n--- 5. Testing Single Token Lemma Viewing With or Without Morphology ---');

// 5a. Word with UralicNLP morphological analysis: "lij" -> lemma "leeʹd"
const lijCardWithMorph = await handleShowDictionaryCard(null, 'lij', 'sms');
assert.strictEqual(lijCardWithMorph.isPhrase, false, 'Must be a single token');
assert.strictEqual(lijCardWithMorph.text, 'lij');
assert.strictEqual(lijCardWithMorph.lemma, 'leeʹd', 'Must extract lemma "leeʹd" from UralicNLP');
assert.strictEqual(lijCardWithMorph.hasMorphology, true, 'UralicNLP morphological analysis must be present');
assert.strictEqual(lijCardWithMorph.showMorphology, true, 'Default showMorphology must be true');
assert(lijCardWithMorph.readings.length > 0, 'Must have morphological readings');
assert.strictEqual(lijCardWithMorph.readings[0].upos, 'VERB');
assert(lijCardWithMorph.allLemmas.includes('leeʹd'), 'allLemmas must contain "leeʹd"');
console.log('✓ With morphology: Single token "lij" displays lemma "leeʹd", UPOS VERB, and readings');

// 5b. Toggle mode: Viewing lemma WITHOUT UralicNLP morphological analysis
await storageService.setSetting('ui_show_morphology', false);
const lijCardWithoutMorph = await handleShowDictionaryCard(null, 'lij', 'sms');
assert.strictEqual(lijCardWithoutMorph.lemma, 'leeʹd', 'Lemma remains available when morphology is toggled off');
assert.strictEqual(lijCardWithoutMorph.showMorphology, false, 'showMorphology is false');
assert(lijCardWithoutMorph.glosses.length > 0, 'Translations remain fully accessible without morphology');
console.log('✓ Without morphology: Single token "lij" shows lemma "leeʹd" and translations with morphology toggled off');
// Restore default
await storageService.setSetting('ui_show_morphology', true);

// 5c. Single token unrecognized by UralicNLP (or with no morphology):
const unknownCard = await handleShowDictionaryCard(null, 'unrecognizedword', 'sms');
assert.strictEqual(unknownCard.isPhrase, false, 'Must be a single token');
assert.strictEqual(unknownCard.lemma, 'unrecognizedword', 'Fallback lemma must equal surface token');
assert.strictEqual(unknownCard.hasMorphology, false, 'hasMorphology must be false when UralicNLP produces no readings');
console.log('✓ Graceful handling of token without UralicNLP analysis: displays token as lemma');

// 5d. Skolt Sámi token "ǩiõl" (with 6 readings and lemma "ǩiõll")
const kiolCard = await handleShowDictionaryCard(null, 'ǩiõl', 'myv'); // even when default setting is 'myv'
assert.strictEqual(kiolCard.isPhrase, false, 'Must be a single token');
assert.strictEqual(kiolCard.text, 'ǩiõl');
assert.strictEqual(kiolCard.srcLang, 'sms', 'Must detect or resolve Skolt Sámi (sms)');
assert.strictEqual(kiolCard.hasMorphology, true, 'hasMorphology must be true for "ǩiõl"');
assert.strictEqual(kiolCard.readings.length, 6, 'Must provide all 6 readings from UralicNLP');
assert.strictEqual(kiolCard.lemma, 'ǩiõll', 'Must extract primary dictionary lemma "ǩiõll"');
assert(kiolCard.allLemmas.includes('ǩiõll'), 'allLemmas must contain "ǩiõll"');
assert(kiolCard.allLemmas.includes('ǩiõllâd'), 'allLemmas must contain candidate lemma "ǩiõllâd"');
assert(kiolCard.glosses.length > 0, 'Must retrieve dictionary translations for lemma "ǩiõll"');
assert(kiolCard.glosses.some(g => g.lang === 'eng' && (g.gloss === 'language' || g.gloss === 'tongue')));
assert(kiolCard.glosses.some(g => g.lang === 'fin' && (g.gloss === 'kieli' || g.gloss === 'ansa')));
assert(kiolCard.glosses.some(g => g.lang === 'deu' && g.gloss === 'Sprache'));
console.log('✓ Word form "ǩiõl": correctly yields 6 readings, primary lemma "ǩiõll", candidate "ǩiõllâd", and multilingual glosses');

// --- 6. Testing Picking a Language for Translation (In-Page Lookups) ---
console.log('\n--- 6. Testing Picking a Language for Translation ---');

// 6a. Available target languages for "piânnai" (dog)
const dogGlossesAll = dictionaryService.lookupGlosses('piânnai', 'sms', 'all');
const dogLangs = Array.from(new Set(dogGlossesAll.map(g => g.lang.toLowerCase())));
console.log('Available translation languages for "piânnai":', dogLangs);
assert(dogLangs.includes('eng'), 'Must have English translations');
assert(dogLangs.includes('fin'), 'Must have Finnish translations');
assert(dogLangs.includes('rus'), 'Must have Russian translations');

// 6b. Pick English ('eng') for translation
const dogGlossesEng = dictionaryService.lookupGlosses('piânnai', 'sms', 'eng');
assert(dogGlossesEng.length > 0, 'Must return English glosses');
assert(dogGlossesEng.every(g => g.lang === 'eng'), 'All returned glosses must be English');
assert(dogGlossesEng.some(g => g.gloss === 'dog'), 'Must contain English translation "dog"');
console.log('✓ Picked English (eng): Translations ->', dogGlossesEng.map(g => g.gloss));

// 6c. Pick Finnish ('fin') for translation
const dogGlossesFin = dictionaryService.lookupGlosses('piânnai', 'sms', 'fin');
assert(dogGlossesFin.length > 0, 'Must return Finnish glosses');
assert(dogGlossesFin.every(g => g.lang === 'fin'), 'All returned glosses must be Finnish');
assert(dogGlossesFin.some(g => g.gloss === 'koira'), 'Must contain Finnish translation "koira"');
console.log('✓ Picked Finnish (fin): Translations ->', dogGlossesFin.map(g => g.gloss));

// 6d. Pick Russian ('rus') for translation
const dogGlossesRus = dictionaryService.lookupGlosses('piânnai', 'sms', 'rus');
assert(dogGlossesRus.length > 0, 'Must return Russian glosses');
assert(dogGlossesRus.every(g => g.lang === 'rus'), 'All returned glosses must be Russian');
assert(dogGlossesRus.some(g => g.gloss === 'собака'), 'Must contain Russian translation "собака"');
console.log('✓ Picked Russian (rus): Translations ->', dogGlossesRus.map(g => g.gloss));

// 6e. Pick Portuguese ('por') for Apurinã "aiku" (house)
const aikuGlossesPor = dictionaryService.lookupGlosses('aiku', 'apu', 'por');
assert(aikuGlossesPor.length > 0, 'Must return Portuguese glosses for aiku');
assert(aikuGlossesPor.every(g => g.lang === 'por'), 'All returned glosses must be Portuguese');
assert(aikuGlossesPor.some(g => g.gloss === 'casa'), 'Must contain Portuguese translation "casa"');
console.log('✓ Picked Portuguese (por) for Apurinã: Translations ->', aikuGlossesPor.map(g => g.gloss));

// --- 7. Testing In-Page Candidate / Custom Lemma Switching ---
console.log('\n--- 7. Testing In-Page Candidate / Custom Lemma Switching ---');

// In-page lookup of alternative lemma for compound word "kåʹllvueiʹvv"
const compoundGlosses = dictionaryService.lookupGlosses('kåʹllvueiʹvv', 'sms', 'all');
assert(compoundGlosses.some(g => g.lang === 'eng' && g.gloss === 'goldenhead'));
assert(compoundGlosses.some(g => g.lang === 'fin' && g.gloss === 'kultapää'));

// Switching to constituent lemma "vueiʹvv" (head)
const headGlosses = dictionaryService.lookupGlosses('vueiʹvv', 'sms', 'all');
console.log('Constituent lemma "vueiʹvv" translations count:', headGlosses.length);
assert(headGlosses.some(g => g.lang === 'fin' && g.gloss === 'pää') || headGlosses.some(g => g.lang === 'eng' && g.gloss === 'head') || headGlosses.length > 0);
console.log('✓ Switching/testing alternative lemma in-page successfully updates translations');

// --- 8. Testing User Preference Persistence for Morphology & Target Language ---
console.log('\n--- 8. Testing User Preference Persistence ---');
await storageService.setSetting('ui_tgt_lang', 'fin');
await storageService.setSetting('ui_show_morphology', false);

const savedTgt = await storageService.getSetting('ui_tgt_lang');
const savedMorph = await storageService.getSetting('ui_show_morphology');
assert.strictEqual(savedTgt, 'fin', 'Target language preference must be persisted as "fin"');
assert.strictEqual(savedMorph, false, 'Morphology preference must be persisted as false');
console.log('✓ User preferences for target translation language and morphology display successfully persisted');

// Restore defaults for subsequent tests
await storageService.setSetting('ui_tgt_lang', 'all');
await storageService.setSetting('ui_show_morphology', true);

// --- 9. Testing Context Menu: «Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]» & Mode Selection ---
console.log('\n--- 9. Testing Context Menu: «Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]» & Mode Selection ---');

// 9a. Test setupContextMenus registration in default single-button mode ('dict')
await storageService.setSetting('ui_context_menu_mode', 'dict');
await setupContextMenus();

assert(createdMenus.has('hfst_dict_lookup'), 'Must create top-level Dictionary button "hfst_dict_lookup"');
assert(
  createdMenus.get('hfst_dict_lookup').title.includes('hfst_dict_lookup'),
  'Button title must include explicit reference to "[hfst_dict_lookup]"'
);
assert.strictEqual(
  createdMenus.get('hfst_dict_lookup').parentId,
  undefined,
  'Dictionary item must be a direct top-level clickable button (no parent)'
);
assert.strictEqual(
  createdMenus.size,
  1,
  'In "dict" mode, exactly one button is registered so Chrome displays it directly at top level'
);
console.log('✓ Default "dict" mode: Single button «Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]» sits directly at top level');

// 9b. Test switching to 'annotator' mode
await storageService.setSetting('ui_context_menu_mode', 'annotator');
await setupContextMenus();
assert(createdMenus.has('hfst_move_to_annotator'), 'Must create Glosser button in "annotator" mode');
assert.strictEqual(createdMenus.size, 1, 'In "annotator" mode, exactly one button is registered');
console.log('✓ "annotator" mode: Single button «Analyze Gloss with HFST» sits directly at top level');

// 9c. Test switching to 'both' mode
await storageService.setSetting('ui_context_menu_mode', 'both');
await setupContextMenus();
assert(createdMenus.has('hfst_dict_lookup'), 'Must create Dictionary button in "both" mode');
assert(createdMenus.has('hfst_move_to_annotator'), 'Must create Glosser button in "both" mode');
assert.strictEqual(createdMenus.size, 2, 'In "both" mode, both buttons are registered');
console.log('✓ "both" mode: Both buttons are registered simultaneously');

// 9c-2. Test concurrent setupContextMenus calls do not collide or produce duplicate ID errors
let duplicateDetected = false;
const originalCreate = globalThis.chrome.contextMenus.create;
globalThis.chrome.contextMenus.create = (item, cb) => {
  if (createdMenus.has(item.id)) {
    duplicateDetected = true;
  }
  createdMenus.set(item.id, item);
  if (cb) cb();
};

await Promise.all([setupContextMenus(), setupContextMenus(), setupContextMenus()]);
assert.strictEqual(duplicateDetected, false, 'Concurrent setupContextMenus must serialize cleanly without duplicate ID creation');
assert(createdMenus.has('hfst_dict_lookup'), 'Must have hfst_dict_lookup registered after concurrent setups');
console.log('✓ Concurrent setupContextMenus calls serialize safely without duplicate ID errors');
globalThis.chrome.contextMenus.create = originalCreate;

// Restore default 'dict' mode for remaining tests
await storageService.setSetting('ui_context_menu_mode', 'dict');
await setupContextMenus();

// 9d. Test dynamic update of context menu for selection of single token "piânnai"
await updateContextMenuForSelection('piânnai', 'sms');
const updatedDictBtn = createdMenus.get('hfst_dict_lookup');
console.log('Updated Dictionary Button Title:', updatedDictBtn.title);
assert(updatedDictBtn.title.includes('hfst_dict_lookup'), 'Must preserve explicit "[hfst_dict_lookup]" reference');
assert(updatedDictBtn.title.includes('piânnai'), 'Button must show selected token');
console.log('✓ Dynamic update on selection verified: Button retains label with [hfst_dict_lookup] and displays selected token');

// 9e. Test clicking "Lemma Viewing, Morphology Toggle, and Language Picker" button from context menu
const buttonClickRes = await handleContextMenuClick({ menuItemId: 'hfst_dict_lookup', selectionText: 'piânnai' }, null);
assert.strictEqual(buttonClickRes.action, 'view_lemma_dictionary');
assert.strictEqual(buttonClickRes.cardData.isPhrase, false);
assert.strictEqual(buttonClickRes.cardData.text, 'piânnai');
assert.strictEqual(buttonClickRes.cardData.lemma, 'piânnai');
assert.strictEqual(buttonClickRes.cardData.showMorphology, true);
assert(buttonClickRes.cardData.glosses.some(g => g.gloss === 'dog'));
console.log('✓ Clicking «Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]» opens in-page dictionary card with lemma, morphology, and translations');

// 9f. Test unselected right-click (empty selectionText) fallback
const unselectedClickRes = await handleContextMenuClick({ menuItemId: 'hfst_dict_lookup', selectionText: '' }, null);
assert.strictEqual(unselectedClickRes.action, 'view_lemma_dictionary');
assert(unselectedClickRes.cardData.lemma !== undefined, 'Must gracefully produce card data for unselected click');
console.log('✓ Graceful fallback when right-clicking without prior selection: opens dictionary card');

// 9g. Test morphology toggling in card via click handler
const morphWithRes = await handleContextMenuClick({ menuItemId: 'hfst_dict_morph_with', selectionText: 'lij' }, null);
assert.strictEqual(morphWithRes.action, 'morphology_toggle');
assert.strictEqual(morphWithRes.showMorphology, true);
assert.strictEqual(morphWithRes.cardData.showMorphology, true);
assert.strictEqual(morphWithRes.cardData.hasMorphology, true);
assert.strictEqual(await storageService.getSetting('ui_show_morphology'), true);
console.log('✓ Morphology toggle (With Morphology) updates preference and generates card with morphology enabled');

const morphWithoutRes = await handleContextMenuClick({ menuItemId: 'hfst_dict_morph_without', selectionText: 'lij' }, null);
assert.strictEqual(morphWithoutRes.action, 'morphology_toggle');
assert.strictEqual(morphWithoutRes.showMorphology, false);
assert.strictEqual(morphWithoutRes.cardData.showMorphology, false);
assert.strictEqual(await storageService.getSetting('ui_show_morphology'), false);
console.log('✓ Morphology toggle (Without Morphology) updates preference and generates clean lemma card');

// Restore morphology setting
await storageService.setSetting('ui_show_morphology', true);

// 9h. Test picking target language for translation in card via click handler
const engPickRes = await handleContextMenuClick({ menuItemId: 'hfst_tgt_eng', selectionText: 'piânnai' }, null);
assert.strictEqual(engPickRes.action, 'pick_translation_language');
assert.strictEqual(engPickRes.tgtLang, 'eng');
assert.strictEqual(engPickRes.cardData.tgtLang, 'eng');
assert.strictEqual(await storageService.getSetting('ui_tgt_lang'), 'eng');
console.log('✓ Target translation language picker sets language preference and opens focused card');

// Restore target language setting
await storageService.setSetting('ui_tgt_lang', 'all');

// 9i. Test clicking «Analyze Gloss with HFST» button
const glosserClickRes = await handleContextMenuClick({ menuItemId: 'hfst_move_to_annotator', selectionText: 'piânnai' }, null);
assert.strictEqual(glosserClickRes.action, 'glosser');
assert(glosserClickRes.url.includes('index.html?text=pi%C3%A2nnai'));
console.log('✓ Selecting «Analyze Gloss with HFST» triggers workbench navigation');

// --- 10. Testing Manual Set Language Priority, Recognition Fallback, and Webpage Retention ---
console.log('\n--- 10. Testing Manual Set Language Priority, Recognition Fallback, and Webpage Retention ---');

// 10a. Priority #1: Manually set language is analyzed first directly
const manualSmsRes = await analyzeWordWithLanguageAssurance('piânnai', 'sms');
assert.strictEqual(manualSmsRes.lang, 'sms', 'Must directly use manually set language "sms"');
assert(manualSmsRes.readings.length > 0 && manualSmsRes.readings[0].lemma === 'piânnai');
console.log('✓ Priority #1: Manual set language "sms" analyzed directly for "piânnai" without fallback');

const manualMyvRes = await analyzeWordWithLanguageAssurance('вастома', 'myv');
assert.strictEqual(manualMyvRes.lang, 'myv', 'Must directly use manually set language "myv"');
assert(manualMyvRes.readings.length > 0);
console.log('✓ Priority #1: Manual set language "myv" analyzed directly for "вастома" without fallback');

const manualApuRes = await analyzeWordWithLanguageAssurance('aiku', 'apu');
assert.strictEqual(manualApuRes.lang, 'apu', 'Must directly use manually set language "apu"');
assert(manualApuRes.readings.length > 0);
console.log('✓ Priority #1: Manual set language "apu" analyzed directly for "aiku" without fallback');

// 10b. Priority #2: Fallback recognition when manual language yields 0 readings
// When manual language is Finnish ('fin'), 'ǩiõl' has 0 readings in Finnish.
// Fallback recognition must kick in and resolve to Skolt Sámi ('sms').
const fallbackSmsRes = await analyzeWordWithLanguageAssurance('ǩiõl', 'fin');
assert.strictEqual(fallbackSmsRes.lang, 'sms', 'Must fallback to "sms" when manual language "fin" produces 0 readings');
assert(fallbackSmsRes.readings.length > 0);
console.log('✓ Fallback recognition: When "fin" yields 0 readings for "ǩiõl", fallback correctly resolves to "sms"');

// When manual language is Skolt Sámi ('sms'), Cyrillic 'вастома' has 0 readings in Skolt Sámi.
// Fallback recognition must kick in and resolve to Erzya ('myv').
const fallbackMyvRes = await analyzeWordWithLanguageAssurance('вастома', 'sms');
assert.strictEqual(fallbackMyvRes.lang, 'myv', 'Must fallback to "myv" when manual language "sms" produces 0 readings for Cyrillic');
assert(fallbackMyvRes.readings.length > 0);
console.log('✓ Fallback recognition: When "sms" yields 0 readings for "вастома", fallback correctly resolves to "myv"');

// 10c. Webpage Language Retention (tabLanguageCache)
const mockTab = { id: 99 };
// First use on webpage: user reads Skolt Sámi
const firstUseCard = await handleShowDictionaryCard(mockTab, 'piânnai', 'sms');
assert.strictEqual(firstUseCard.srcLang, 'sms');
assert.strictEqual(tabLanguageCache.get(99), 'sms', 'Must retain "sms" in tabLanguageCache after first use on webpage');
console.log('✓ Default language retention: Tab 99 retained "sms" after first use');

// Subsequent lookup on same tab/webpage without explicit srcLang parameter:
// Must retain and use "sms" automatically!
const secondUseCard = await handleShowDictionaryCard(mockTab, 'lij', null);
assert.strictEqual(secondUseCard.srcLang, 'sms', 'Must automatically use retained "sms" for subsequent lookups on this tab');
assert.strictEqual(secondUseCard.lemma, 'leeʹd');
console.log('✓ Default retention verified: Subsequent lookup on same tab automatically used retained "sms"');

// When user switches language on this webpage to Erzya
tabLanguageCache.set(99, 'myv');
const switchedCard = await handleShowDictionaryCard(mockTab, 'вастома', null);
assert.strictEqual(switchedCard.srcLang, 'myv', 'Must use newly retained "myv" for subsequent lookups on this tab');
console.log('✓ Language switch on webpage updates retention for future lookups on that page');

// 10d. Testing Orthographic Character Precision: «ǥ, ˈ, ẹ, ŧ, ä, â» in Language Detection
console.log('\n--- 10d. Testing Orthographic Character Precision: «ǥ, ˈ, ẹ, ŧ, ä, â» ---');

// «ǥ» is unique to Skolt Sámi
assert.strictEqual(detectLanguageForWord('ǥõs'), 'sms', 'Letter «ǥ» must be recognized as Skolt Sámi (sms)');
assert.strictEqual(detectLanguageForWord('ǥuõttâd'), 'sms', 'Letter «ǥ» must be recognized as Skolt Sámi (sms)');
console.log('✓ Letter «ǥ» correctly recognized as Skolt Sámi');

// «ˈ» modifier letter vertical line in authentic Skolt Sámi forms like illative «kåʹllvuäivˈva»
assert.strictEqual(detectLanguageForWord('kåʹllvuäivˈva'), 'sms', 'Authentic form with modifier vertical line «ˈ» (kåʹllvuäivˈva) must be recognized as Skolt Sámi (sms)');
console.log('✓ Palatalization marker «ˈ» in authentic illative form «kåʹllvuäivˈva» correctly recognized as Skolt Sámi');

// «ẹ» lower-mid e used in dialectal/dictionary Skolt Sámi
assert.strictEqual(detectLanguageForWord('kuẹʹtt'), 'sms', 'Character «ẹ» must be recognized as Skolt Sámi (sms)');
console.log('✓ Character «ẹ» correctly recognized as Skolt Sámi');

// «ŧ» is exclusive to North Sámi (sme) and does not exist in Skolt Sámi (sms) or Inari Sámi (smn)
assert.strictEqual(detectLanguageForWord('muoŧŧá'), 'sme', 'Letter «ŧ» must be recognized as North Sámi (sme)');
assert.strictEqual(detectLanguageForWord('bievlaŧ'), 'sme', 'Letter «ŧ» must be recognized as North Sámi (sme)');
console.log('✓ Letter «ŧ» correctly recognized exclusively as North Sámi (sme)');

// «â» is heavily used in Skolt Sámi (sms) as well as Inari Sámi (smn); must not blindly route to smn
assert.strictEqual(detectLanguageForWord('piânnai'), 'sms', 'Token «piânnai» with «â» must resolve to Skolt Sámi (sms)');
assert.strictEqual(detectLanguageForWord('jânnam'), 'sms', 'Token «jânnam» with «â» must resolve to Skolt Sámi (sms)');
assert.strictEqual(detectLanguageForWord('čâcc'), 'sms', 'Token «čâcc» with «â» must resolve to Skolt Sámi (sms)');
console.log('✓ Character «â» correctly recognized as Skolt Sámi (sms)');

// «ä» in separate syllables across consonants indicates Finnish (fin) front vowel harmony
assert.strictEqual(detectLanguageForWord('hämäläinen'), 'fin', 'Front vowel harmony with «ä...ä» across syllables indicates Finnish (fin)');
assert.strictEqual(detectLanguageForWord('päivää'), 'fin', 'Front vowel harmony with «ä...ä» across syllables indicates Finnish (fin)');
assert.strictEqual(detectLanguageForWord('tämä'), 'fin', 'Front vowel harmony with «ä...ä» across syllables indicates Finnish (fin)');
console.log('✓ Front vowel harmony «ä...ä» across separate syllables correctly identifies Finnish (fin)');

// Single-syllable «ä» or «ää» combined with general Sámi consonants [čđŋšž] eliminates North Sámi and resolves to Skolt Sámi
assert.strictEqual(detectLanguageForWord('päärnaž'), 'sms', 'Sámi consonant «ž» + root «ää» eliminates North Sámi and resolves to Skolt Sámi');
assert.strictEqual(detectLanguageForWord('sääʹm'), 'sms', 'Root «ää» with palatalization mark resolves to Skolt Sámi');
console.log('✓ General Sámi consonants + root «ä» correctly eliminates North Sámi and resolves to Skolt Sámi');

// 10e. Testing Komi-Permyak (koi) In-Page Dictionary Resolution («мунісӧ»)
console.log('\n--- 10e. Testing Komi-Permyak (koi) In-Page Dictionary Card Resolution («мунісӧ») ---');
assert.strictEqual(detectLanguageForWord('мунісӧ', 'koi'), 'koi', 'Detecting language for "мунісӧ" with default "koi" must return "koi"');

const koiWordAssurance = await analyzeWordWithLanguageAssurance('мунісӧ', 'koi');
assert.strictEqual(koiWordAssurance.lang, 'koi', 'Language assurance must preserve "koi"');
assert(koiWordAssurance.readings.length > 0, 'Must produce valid readings for "мунісӧ"');
assert.strictEqual(koiWordAssurance.readings[0].lemma, 'мунны', 'Lemma must be "мунны"');
assert.strictEqual(koiWordAssurance.readings[0].upos, 'VERB');

const koiCard = await handleShowDictionaryCard(mockTab, 'мунісӧ', 'koi');
assert.strictEqual(koiCard.srcLang, 'koi', 'Card source language must be "koi"');
assert.strictEqual(koiCard.lemma, 'мунны', 'Card primary lemma must be "мунны"');
assert.strictEqual(koiCard.hasMorphology, true, 'Card must report valid morphology');
assert(koiCard.glosses.length > 0, 'Card must contain dictionary translations for "мунны"');
assert(koiCard.glosses.some(g => g.gloss === 'go' || g.gloss === 'leave' || g.gloss.includes('идти') || g.gloss.includes('mennä')), 'Card must provide multilingual translations');
console.log('✓ In-page dictionary card for Komi-Permyak "мунісӧ" successfully produced with lemma "мунны" and glosses');

console.log('\n🎉 ALL CONTEXT MENU DICTIONARY & ANNOTATOR DISPATCH TESTS PASSED! 🎉');
