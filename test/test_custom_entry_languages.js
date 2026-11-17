import assert from 'node:assert';
import { WorkbenchApp } from '../js/controllers/app.js';
import { dictionaryService } from '../js/services/dictionary-service.js';

// "+ Add Single Entry" asks for the language of the lemma and the language of the gloss, each by name
const asked = [];
const answers = ['sms', 'piânnai', 'eng', 'dog', 'N', 'N'];
globalThis.prompt = (msg) => { asked.push(msg); return answers.shift(); };

const saved = [];
dictionaryService.addCustomEntry = async (e) => { saved.push(e); };
const fake = {
  srcLang: 'myv', targetLang: 'fin',
  renderCustomEntriesTable: async () => {}, syncSourceLanguagesFromDictionary() {}, relookupAllGlosses() {},
  toasts: [], showToast(m) { this.toasts.push(m); }
};
await WorkbenchApp.prototype.handleAddCustomEntry.call(fake);

assert.strictEqual(saved.length, 1);
assert.strictEqual(saved[0].src_lang, 'sms', 'lemma language is the one typed, not the workbench source language');
assert.strictEqual(saved[0].tgt_lang, 'eng');
assert.match(asked[0], /LEMMA LANGUAGE/);
assert.match(asked[1], /Skolt/i, 'the lemma prompt names its language');
assert.match(asked[2], /GLOSS LANGUAGE/);
assert.match(asked[3], /Skolt.*piânnai.*English|English/s);
assert.match(fake.toasts[0], /sms.*piânnai.*eng.*dog/s);

// a wrong code is asked again, cancel saves nothing
asked.length = 0; saved.length = 0;
answers.push('q', null);
await WorkbenchApp.prototype.handleAddCustomEntry.call(fake);
assert.strictEqual(saved.length, 0);
assert.match(asked[1], /not a 3-letter ISO 639-3 code/);
console.log('✓ custom entry asks for the lemma language and the gloss language');
process.exit(0);
