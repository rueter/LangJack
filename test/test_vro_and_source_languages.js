import assert from 'node:assert';
import { analyzerService, KNOWN_LANGUAGES } from '../js/services/analyzer-service.js';
import { dictionaryService, FST_DICTIONARY_LANGUAGES } from '../js/services/dictionary-service.js';
import { WorkbenchApp, LANGUAGE_INFO, getLangDisplayName } from '../js/controllers/app.js';
import { storageService } from '../js/services/storage-service.js';
import { handleShowDictionaryCard, analyzeWordWithLanguageAssurance } from '../background.js';

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

  insertBefore(newChild, refChild) {
    const idx = this.children.indexOf(refChild);
    if (idx >= 0) {
      this.children.splice(idx, 0, newChild);
    } else {
      this.children.push(newChild);
    }
    newChild.parentElement = this;
    if (this.tagName === 'SELECT' && newChild.tagName === 'OPTION') {
      const optIdx = this.options.indexOf(refChild);
      if (optIdx >= 0) this.options.splice(optIdx, 0, newChild);
      else this.options.push(newChild);
    }
    return newChild;
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
    if (selector.includes('option[value=')) {
      const match = selector.match(/value=["']?([^"']+)["']?/);
      if (match) {
        const val = match[1];
        return this.options.find(o => o.value === val) || null;
      }
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
  console.log('=== Running vro (Võro) & Dynamic Dictionary Source Language Tests ===\n');

  // Initialize dictionary service
  await dictionaryService.init();

  // Test 1: Verify vro presence in language metadata & configuration
  console.log('--- 1. Testing vro in Language Configurations ---');
  assert.strictEqual(KNOWN_LANGUAGES['vro'], 'Võro', 'vro must be present in KNOWN_LANGUAGES');
  assert.strictEqual(FST_DICTIONARY_LANGUAGES['vro'], 'Võro', 'vro must be in FST_DICTIONARY_LANGUAGES');
  assert.strictEqual(LANGUAGE_INFO['vro']?.name, 'Võro', 'vro must be in LANGUAGE_INFO');
  assert.strictEqual(getLangDisplayName('vro'), 'Võro', 'getLangDisplayName(vro) must return Võro');
  console.log('✓ vro (Võro) is properly registered in all language configurations');

  // Test 2: Verify FST Dictionary Lookups for vro
  console.log('\n--- 2. Testing FST Dictionary Lookups for vro (Võro) ---');
  const kandGlosses = dictionaryService.lookupGlosses('kand', 'vro', 'all');
  console.log('Lookup results for vro "kand":', kandGlosses);
  assert(kandGlosses.length > 0, 'vro lemma "kand" must return dictionary entries from FST dictionary');
  assert(kandGlosses.some(g => g.gloss.includes('känd') && g.lang === 'est'), 'vro "kand" must translate to Estonian "känd"');
  console.log('✓ vro "kand" successfully returns translation: känd (est)');

  const puuGlosses = dictionaryService.lookupGlosses('puu', 'vro', 'all');
  console.log('Lookup results for vro "puu":', puuGlosses);
  assert(puuGlosses.length > 0, 'vro lemma "puu" must return dictionary entries from FST dictionary');
  assert(puuGlosses.some(g => g.gloss === 'puu'), 'vro "puu" must translate to "puu"');
  console.log('✓ vro "puu" successfully returns translation: puu (est)');

  // Test 3: getSourceLanguages() includes FST languages, bundled TSV languages, and vro
  console.log('\n--- 3. Testing dictionaryService.getSourceLanguages() ---');
  const sourceLangs = dictionaryService.getSourceLanguages();
  console.log('Available source languages count:', Object.keys(sourceLangs).length);
  assert('vro' in sourceLangs, 'vro must be in getSourceLanguages()');
  assert.strictEqual(sourceLangs['vro'], 'Võro');
  assert('myv' in sourceLangs, 'myv must be in getSourceLanguages()');
  assert('fin' in sourceLangs, 'fin must be in getSourceLanguages()');
  assert('sms' in sourceLangs, 'sms must be in getSourceLanguages()');
  assert('apu' in sourceLangs, 'apu (bundled TSV) must be in getSourceLanguages()');
  assert('koi' in sourceLangs, 'koi (bundled TSV) must be in getSourceLanguages()');
  assert(dictionaryService.hasSourceLanguage('vro'), 'hasSourceLanguage(vro) must be true');
  console.log('✓ getSourceLanguages() includes vro, all FST languages, and bundled TSV languages');

  // Test 4: Custom TSV Dictionary adds new source language dynamically
  console.log('\n--- 4. Testing Custom TSV Dictionary Source Language Dynamic Registration ---');
  // Suppose user imports a custom TSV dictionary for a new language (e.g., krl - Karelian)
  const customTsv = [
    '# Custom Karelian Dictionary',
    'kodi\thome, house\teng\tN\tkrl',
    'vene\tboat\teng\tN\tkrl',
    'kala\tfish\tfin\tN\tkrl'
  ].join('\n');

  await dictionaryService.importCustomDictionary(customTsv, 'tsv', 'krl', 'eng');
  const updatedSourceLangs = dictionaryService.getSourceLanguages();
  assert('krl' in updatedSourceLangs, 'Imported language krl must now appear in getSourceLanguages()');
  assert(dictionaryService.hasSourceLanguage('krl'), 'hasSourceLanguage(krl) must now be true');
  console.log('✓ Custom TSV source language "krl" dynamically registered in getSourceLanguages():', updatedSourceLangs['krl']);

  const krlGlosses = dictionaryService.lookupGlosses('kodi', 'krl', 'all');
  assert(krlGlosses.length > 0, 'Must retrieve glosses for custom language krl');
  assert(krlGlosses.some(g => g.gloss === 'home' || g.gloss === 'house'));
  console.log('✓ Custom TSV lookups for krl succeed:', krlGlosses.map(g => `${g.gloss} (${g.lang})`));

  // Test 5: In-Page Dictionary UI & Background Script Resolution for vro
  console.log('\n--- 5. Testing In-Page Dictionary & Background Resolution for vro ---');
  const cardData = await handleShowDictionaryCard(null, 'kand', 'vro');
  assert.strictEqual(cardData.srcLang, 'vro', 'Resolved language must remain vro when user chooses vro');
  assert(cardData.glosses.length > 0, 'Must have glosses for vro "kand"');
  assert('vro' in cardData.availableLangs, 'cardData.availableLangs must contain vro');
  assert('krl' in cardData.availableLangs, 'cardData.availableLangs must contain custom TSV language krl');
  console.log('✓ In-page dictionary cardData correctly retains vro and provides full availableLangs list');

  // Test 6: analyzeWordWithLanguageAssurance preserves user-chosen language when word in dictionary
  console.log('\n--- 6. Testing analyzeWordWithLanguageAssurance Retention ---');
  const { lang: assuredLang } = await analyzeWordWithLanguageAssurance('kand', 'vro');
  assert.strictEqual(assuredLang, 'vro', 'Must retain vro because "kand" exists in vro dictionary');
  console.log('✓ analyzeWordWithLanguageAssurance retains vro without overriding to other languages');

  // Test 7: WorkbenchApp Scrolldown Synchronization
  console.log('\n--- 7. Testing WorkbenchApp Scrolldown Synchronization ---');
  const root = new MockElement('div');
  globalThis.__mockRoot = root;

  const srcSelect = new MockElement('select'); srcSelect.id = 'srcLangSelect'; root.appendChild(srcSelect);
  const inputTextLangSelect = new MockElement('select'); inputTextLangSelect.id = 'inputTextLangSelect'; root.appendChild(inputTextLangSelect);
  const tgtSelect = new MockElement('select'); tgtSelect.id = 'tgtLangSelect'; root.appendChild(tgtSelect);
  const wsGlossSelect = new MockElement('select'); wsGlossSelect.id = 'workspaceGlossLangSelect'; root.appendChild(wsGlossSelect);
  const settingsDefaultTgtLang = new MockElement('select'); settingsDefaultTgtLang.id = 'settingsDefaultTgtLang'; root.appendChild(settingsDefaultTgtLang);
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
  app.syncSourceLanguagesFromDictionary();

  // Verify that vro and krl are now in srcLangSelect options
  const srcOptions = srcSelect.options.map(o => o.value);
  console.log('srcSelect options include vro?', srcOptions.includes('vro'));
  console.log('srcSelect options include krl (custom TSV)?', srcOptions.includes('krl'));
  assert(srcOptions.includes('vro'), 'vro must be present in srcSelect options');
  assert(srcOptions.includes('krl'), 'custom TSV language krl must be present in srcSelect options');

  // Verify inputTextLangSelect
  const inputOptions = inputTextLangSelect.options.map(o => o.value);
  assert(inputOptions.includes('vro'), 'vro must be present in inputTextLangSelect options');
  assert(inputOptions.includes('krl'), 'custom TSV language krl must be present in inputTextLangSelect options');
  console.log('✓ Workbench source language scrolldowns dynamically synchronized with FST & TSV languages');

  // Test 8: Loading vro sample on workbench
  console.log('\n--- 8. Testing WorkbenchApp vro Sample Loading ---');
  assert(app.sampleTexts['vro_tree'], 'vro_tree sample must exist');
  assert.strictEqual(app.sampleTexts['vro_tree'].src, 'vro');
  console.log('✓ Võro sample configured:', app.sampleTexts['vro_tree'].text);

  console.log('\n🎉 ALL VRO & DYNAMIC SOURCE LANGUAGE TESTS PASSED! 🎉');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
