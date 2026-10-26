import assert from 'node:assert';
import { dictionaryService } from '../js/services/dictionary-service.js';
import { WorkbenchApp } from '../js/controllers/app.js';
import { storageService } from '../js/services/storage-service.js';

// Setup minimal DOM mocks for Node environment
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.id = '';
    this.className = '';
    const el = this;
    this.classList = {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) {
        if (this._classes.has(c)) return true;
        return (el.className || '').split(/\s+/).includes(c);
      }
    };
    this._listeners = {};
    this.value = '';
    this.textContent = '';
    this.title = '';
    this.options = [];
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      this.options.push(child);
    }
    return child;
  }

  replaceChildren(...newChildren) {
    this.children = [...newChildren];
    for (const c of this.children) {
      if (c instanceof MockElement) c.parentElement = this;
    }
  }

  append(...items) {
    for (const item of items) {
      if (item instanceof MockElement) {
        this.appendChild(item);
      } else if (typeof item === 'string') {
        this.textContent += item;
      }
    }
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this._findById(id);
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this._findByClass(cls);
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      this._findAllByClass(cls, results);
    }
    return results;
  }

  addEventListener(type, listener) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  dispatchEvent(event) {
    const list = this._listeners[event.type] || [];
    for (const cb of list) cb(event);
  }

  _findById(id) {
    if (this.id === id) return this;
    for (const c of this.children) {
      if (c instanceof MockElement) {
        const found = c._findById(id);
        if (found) return found;
      }
    }
    return null;
  }

  _findByClass(cls) {
    if (this.className.split(' ').includes(cls)) return this;
    for (const c of this.children) {
      if (c instanceof MockElement) {
        const found = c._findByClass(cls);
        if (found) return found;
      }
    }
    return null;
  }

  _findAllByClass(cls, results) {
    if (this.className.split(' ').includes(cls)) results.push(this);
    for (const c of this.children) {
      if (c instanceof MockElement) {
        c._findAllByClass(cls, results);
      }
    }
  }
}

globalThis.document = {
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    return globalThis.__mockRoot ? globalThis.__mockRoot._findById(id) : null;
  },
  querySelectorAll() {
    return [];
  }
};
globalThis.window = {
  location: { search: '' }
};

async function runTests() {
  console.log('=== Running Default Translation Target Language Tests ===\n');

  // Initialize dictionary service
  await dictionaryService.init();

  // Test 1: Dictionary Service lookupGlosses with preferred target language
  console.log('--- 1. Testing dictionaryService.lookupGlosses ordering ---');
  
  // "вастома" (Erzya) has glosses in eng, fin, rus
  const allGlossesNoPref = dictionaryService.lookupGlosses('вастома', 'myv', 'all');
  assert(allGlossesNoPref.length >= 3, 'Should have multiple translations for вастома');
  const langsNoPref = allGlossesNoPref.map(g => g.lang);
  console.log('Glosses without preference:', langsNoPref);

  // Preferred = fin
  const finGlosses = dictionaryService.lookupGlosses('вастома', 'myv', 'all', 'fin');
  assert.strictEqual(finGlosses[0].lang, 'fin', 'First gloss should be Finnish when preferred is fin');
  assert(finGlosses.some(g => g.lang === 'eng'), 'Other languages like eng must still be present');
  assert(finGlosses.some(g => g.lang === 'rus'), 'Other languages like rus must still be present');
  console.log('✓ Preferred "fin": first gloss is', finGlosses[0].gloss, `(${finGlosses[0].lang}), other languages retained`);

  // Preferred = rus
  const rusGlosses = dictionaryService.lookupGlosses('вастома', 'myv', 'all', 'rus');
  assert.strictEqual(rusGlosses[0].lang, 'rus', 'First gloss should be Russian when preferred is rus');
  assert(rusGlosses.some(g => g.lang === 'fin'), 'Other languages like fin must still be present');
  console.log('✓ Preferred "rus": first gloss is', rusGlosses[0].gloss, `(${rusGlosses[0].lang}), other languages retained`);

  // Preferred = por (Portuguese - might have no entry for Erzya 'вастома')
  const porGlosses = dictionaryService.lookupGlosses('вастома', 'myv', 'all', 'por');
  assert(porGlosses.length > 0, 'Should fall back gracefully and return available glosses when preferred has no entry');
  console.log('✓ Graceful fallback when preferred has no entries for token:', porGlosses.map(g => g.lang));

  // Test 2: WorkbenchApp Default Target Language State & Dropdown Sync
  console.log('\n--- 2. Testing WorkbenchApp Default Target Language Sync ---');
  const root = new MockElement('div');
  globalThis.__mockRoot = root;

  // Setup DOM elements expected by WorkbenchApp
  const tgtSelect = new MockElement('select'); tgtSelect.id = 'tgtLangSelect'; root.appendChild(tgtSelect);
  const wsGlossSelect = new MockElement('select'); wsGlossSelect.id = 'workspaceGlossLangSelect'; root.appendChild(wsGlossSelect);
  const settingsDefaultTgtLang = new MockElement('select'); settingsDefaultTgtLang.id = 'settingsDefaultTgtLang'; root.appendChild(settingsDefaultTgtLang);
  const srcSelect = new MockElement('select'); srcSelect.id = 'srcLangSelect'; root.appendChild(srcSelect);
  const inputTextLangSelect = new MockElement('select'); inputTextLangSelect.id = 'inputTextLangSelect'; root.appendChild(inputTextLangSelect);
  const inputTextArea = new MockElement('textarea'); inputTextArea.id = 'inputTextArea'; root.appendChild(inputTextArea);
  const analyzeBtn = new MockElement('button'); analyzeBtn.id = 'analyzeBtn'; root.appendChild(analyzeBtn);
  const samplePicker = new MockElement('select'); samplePicker.id = 'samplePicker'; root.appendChild(samplePicker);
  const clearBtn = new MockElement('button'); clearBtn.id = 'clearBtn'; root.appendChild(clearBtn);
  const autoSelectBtn = new MockElement('button'); autoSelectBtn.id = 'autoSelectBtn'; root.appendChild(autoSelectBtn);
  const nextIncompleteBtn = new MockElement('button'); nextIncompleteBtn.id = 'nextIncompleteBtn'; root.appendChild(nextIncompleteBtn);
  const tokensContainer = new MockElement('div'); tokensContainer.id = 'tokensContainer'; root.appendChild(tokensContainer);
  const translationsList = new MockElement('div'); translationsList.id = 'translationsList'; root.appendChild(translationsList);
  const addTranslationBtn = new MockElement('button'); addTranslationBtn.id = 'addTranslationBtn'; root.appendChild(addTranslationBtn);
  const copyExportBtn = new MockElement('button'); copyExportBtn.id = 'copyExportBtn'; root.appendChild(copyExportBtn);
  const copyTableBtn = new MockElement('button'); copyTableBtn.id = 'copyTableBtn'; root.appendChild(copyTableBtn);
  const downloadExportBtn = new MockElement('button'); downloadExportBtn.id = 'downloadExportBtn'; root.appendChild(downloadExportBtn);
  const settingsModal = new MockElement('div'); settingsModal.id = 'settingsModal'; root.appendChild(settingsModal);
  const openSettingsBtn = new MockElement('button'); openSettingsBtn.id = 'openSettingsBtn'; root.appendChild(openSettingsBtn);
  const closeSettingsBtn = new MockElement('button'); closeSettingsBtn.id = 'closeSettingsBtn'; root.appendChild(closeSettingsBtn);
  const addEntryBtn = new MockElement('button'); addEntryBtn.id = 'addEntryBtn'; root.appendChild(addEntryBtn);
  const importDictBtn = new MockElement('button'); importDictBtn.id = 'importDictBtn'; root.appendChild(importDictBtn);
  const exportDictBtn = new MockElement('button'); exportDictBtn.id = 'exportDictBtn'; root.appendChild(exportDictBtn);

  const app = new WorkbenchApp();
  app.bindDOM();
  assert.strictEqual(app.tgtLangSelect, tgtSelect);
  assert.strictEqual(app.workspaceGlossLangSelect, wsGlossSelect);
  assert.strictEqual(app.settingsDefaultTgtLang, settingsDefaultTgtLang);
  console.log('✓ DOM binding: settingsDefaultTgtLang bound successfully');

  // Change default target language to 'fin'
  await app.handleGlossLangChange('fin');
  assert.strictEqual(app.targetLang, 'fin', 'targetLang should be fin');
  assert.strictEqual(tgtSelect.value, 'fin', 'tgtLangSelect value should sync to fin');
  assert.strictEqual(wsGlossSelect.value, 'fin', 'workspaceGlossLangSelect value should sync to fin');
  assert.strictEqual(settingsDefaultTgtLang.value, 'fin', 'settingsDefaultTgtLang value should sync to fin');
  console.log('✓ Selectors synchronized across header, section 2, and settings modal');

  // Test 3: Token Card Gloss Tab and Candidate Ordering with Default Target
  console.log('\n--- 3. Testing Token Card Tabs & Gloss Prioritization ---');
  const token = {
    id: 1,
    form: 'Вастомась',
    lemma: 'вастома',
    upos: 'NOUN',
    isPunct: false,
    selectedReading: { lemma: 'вастома', upos: 'NOUN', tags: ['N', 'Sg', 'Nom', 'Def'] }
  };
  app.sentences = [{ id: 1, tokens: [token] }];

  app.fetchGlossesForToken(token);
  assert(token.allGlosses.length > 0, 'allGlosses should be populated');
  assert.strictEqual(token.allGlosses[0].lang, 'fin', 'allGlosses[0] must be Finnish because default target is fin');
  assert.strictEqual(token.selectedGloss.lang, 'fin', 'Selected gloss should automatically be Finnish');
  console.log('✓ Token allGlosses prioritized fin first:', token.selectedGloss.gloss, `(${token.selectedGloss.lang})`);

  // Build card
  const card = app.createTokenCard(token, 0, 0);
  const langTabs = card.querySelectorAll('.token-gloss-lang-tab');
  assert(langTabs.length > 1, 'Should have multiple language tabs');
  
  // Tab 0 is 'All'
  assert(langTabs[0].textContent.startsWith('All'), 'First tab should be All');
  // Tab 1 should be the default target language 'fin' marked with star and class default-tgt-tab
  assert(langTabs[1].textContent.startsWith('★ fin'), `Second tab should be default target ★ fin, got: ${langTabs[1].textContent}`);
  assert(langTabs[1].classList.contains('default-tgt-tab'), 'Second tab should have default-tgt-tab CSS class');
  console.log('✓ Multi-language tabs put default target first right after All:', langTabs.map(t => t.textContent));

  // Switch default target language to Russian
  await app.handleGlossLangChange('rus');
  assert.strictEqual(app.targetLang, 'rus');
  app.fetchGlossesForToken(token);
  assert.strictEqual(token.allGlosses[0].lang, 'rus', 'allGlosses[0] must now be Russian');
  assert.strictEqual(token.selectedGloss.lang, 'rus', 'Selected gloss should automatically switch to Russian');

  const cardRus = app.createTokenCard(token, 0, 0);
  const langTabsRus = cardRus.querySelectorAll('.token-gloss-lang-tab');
  assert(langTabsRus[1].textContent.startsWith('★ rus'), 'Default target tab is now ★ rus');
  console.log('✓ Switched default target to rus: tabs updated with ★ rus first:', langTabsRus.map(t => t.textContent));

  // Test 4: Fallback behavior when token has no entry in default target language
  console.log('\n--- 4. Testing Fallback When Lemma Missing in Default Target ---');
  // Apurinã word 'anãpa' has Portuguese and English, but no Finnish
  app.targetLang = 'fin';
  const apuToken = {
    id: 2,
    form: 'anãpa',
    lemma: 'anãpa',
    upos: 'NOUN',
    isPunct: false,
    selectedReading: { lemma: 'anãpa', upos: 'NOUN', tags: ['N'] }
  };
  app.srcLang = 'apu';
  app.fetchGlossesForToken(apuToken);
  assert(apuToken.allGlosses.length > 0, 'Apurinã word should have glosses in por/eng');
  assert(apuToken.selectedGloss, 'Should fall back to an available gloss when fin is missing');
  console.log('✓ Graceful fallback selection for Apurinã token:', apuToken.selectedGloss.gloss, `(${apuToken.selectedGloss.lang})`);

  // Test 5: Storage persistence of ui_tgt_lang
  console.log('\n--- 5. Testing ui_tgt_lang Storage Persistence ---');
  await storageService.setSetting('ui_tgt_lang', 'fin');
  let savedTgt = await storageService.getSetting('ui_tgt_lang');
  assert.strictEqual(savedTgt, 'fin', 'ui_tgt_lang should persist to fin');

  await storageService.setSetting('ui_tgt_lang', 'all');
  savedTgt = await storageService.getSetting('ui_tgt_lang');
  assert.strictEqual(savedTgt, 'all', 'ui_tgt_lang should persist to all');
  console.log('✓ ui_tgt_lang successfully persists and retrieves from storageService');

  console.log('\n🎉 ALL DEFAULT TRANSLATION TARGET LANGUAGE TESTS PASSED! 🎉');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
