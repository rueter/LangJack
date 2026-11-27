import assert from 'node:assert';
import {
  analyzeWordWithLanguageAssurance, handleShowDictionaryCard, hasCyrillic,
  tabLanguageCache, tabLanguageLocked, forgetTabLanguage
} from '../background.js';
import { analyzerService } from '../js/services/analyzer-service.js';

// Which languages' analyzers does a lookup load? (the first thing a guess costs)
const loaded = [];
const realEnsure = analyzerService.ensureModelForLanguage.bind(analyzerService);
analyzerService.ensureModelForLanguage = async (lang, ...rest) => {
  loaded.push(String(lang).toLowerCase());
  return realEnsure(lang, ...rest);
};
const track = async (fn) => {
  loaded.length = 0;
  const res = await fn();
  return { res, langs: [...new Set(loaded)] };
};
const LATIN = ['sms', 'smn', 'sme', 'sma', 'fin', 'vro', 'apu', 'olo', 'est', 'vep'];

console.log('--- hasCyrillic ---');
assert.ok(hasCyrillic('вастома') && hasCyrillic('a б c') && hasCyrillic('ԁӧзьӧр'));
assert.ok(!hasCyrillic('piânnai') && !hasCyrillic('') && !hasCyrillic(null));
console.log('✓ hasCyrillic');

console.log('--- (1) A Cyrillic character leaves only the Cyrillic-script languages to try ---');
{
  const { res, langs } = await track(() => analyzeWordWithLanguageAssurance('вастома', 'sms'));
  assert.strictEqual(res.lang, 'myv');
  assert.ok(!langs.some(l => LATIN.includes(l)), `no Latin-script analyzer is loaded for a Cyrillic word: ${langs}`);
}
{
  // look-alike Latin letters in a Cyrillic word do not bring the Latin-script languages back in
  const { langs } = await track(() => analyzeWordWithLanguageAssurance('вастоmа', 'fin'));
  assert.ok(!langs.some(l => LATIN.includes(l)), `stray Latin letters do not count: ${langs}`);
}
{
  // ... and the other way round nothing is ruled out: the Cyrillic preferred language is still looked at first
  const { langs } = await track(() => analyzeWordWithLanguageAssurance('kawič', 'myv'));
  assert.strictEqual(langs[0], 'myv', `a Latin word with a Cyrillic-script default still tries it first: ${langs}`);
}
console.log('✓ Cyrillic narrows, Latin does not');

console.log('--- (2) A locked page is not guessed any more ---');
{
  // not locked: «piânnai» with an Erzya default is found to be Skolt Sámi
  const free = await analyzeWordWithLanguageAssurance('piânnai', 'myv');
  assert.strictEqual(free.lang, 'sms');
  // locked: the language stays, whatever the word looks like, and no other analyzer is loaded
  const { res, langs } = await track(() => analyzeWordWithLanguageAssurance('piânnai', 'myv', { locked: true }));
  assert.strictEqual(res.lang, 'myv');
  assert.deepStrictEqual(langs, ['myv']);
  const cyr = await track(() => analyzeWordWithLanguageAssurance('вастома', 'sms', { locked: true }));
  assert.strictEqual(cyr.res.lang, 'sms', 'a Cyrillic word on a locked Skolt Sámi page stays sms');
  assert.deepStrictEqual(cyr.langs, ['sms']);
}
console.log('✓ locked lookups use the language as it is');

console.log('--- the first lookup on a page identifies the language, later ones keep it ---');
{
  const tab = { id: 4101 };
  forgetTabLanguage(tab.id);
  assert.ok(!tabLanguageLocked.has(tab.id));
  const first = await handleShowDictionaryCard(tab, 'piânnai', 'myv');           // default myv, the word is Skolt Sámi
  assert.strictEqual(first.srcLang, 'sms');
  assert.ok(tabLanguageLocked.has(tab.id), 'the page has its language now');
  assert.strictEqual(tabLanguageCache.get(tab.id), 'sms');

  // a Cyrillic word on the same page is read as Skolt Sámi: nothing is identified again
  const { res: second, langs } = await track(() => handleShowDictionaryCard(tab, 'вастома', null));
  assert.strictEqual(second.srcLang, 'sms');
  assert.deepStrictEqual(langs, ['sms']);

  // a phrase as well
  const phrase = await handleShowDictionaryCard(tab, 'вастома пыдоʼ', null);
  assert.strictEqual(phrase.srcLang, 'sms');

  // the user changes the language: that one is kept from now on
  tabLanguageCache.set(tab.id, 'myv');
  const third = await handleShowDictionaryCard(tab, 'вастома', null);
  assert.strictEqual(third.srcLang, 'myv');
  const fourth = await handleShowDictionaryCard(tab, 'piânnai', null);
  assert.strictEqual(fourth.srcLang, 'myv', 'a Latin word on a locked Erzya page is not sent to Skolt Sámi');

  // a tab that is forgotten (closed, or at another site) starts again
  forgetTabLanguage(tab.id);
  const again = await handleShowDictionaryCard(tab, 'piânnai', 'myv');
  assert.strictEqual(again.srcLang, 'sms');
}
console.log('✓ page language retained once identified');

console.log('--- a language the content script reports as settled locks the tab at once ---');
{
  const tab = { id: 4102 };
  forgetTabLanguage(tab.id);
  const card = await handleShowDictionaryCard(tab, 'piânnai', 'myv', { langLocked: true });
  assert.strictEqual(card.srcLang, 'myv');
  assert.ok(tabLanguageLocked.has(tab.id));
  forgetTabLanguage(tab.id);
}
console.log('✓ langLocked option');

console.log('--- (1) with no language set for the page, a Cyrillic phrase starts in a Cyrillic language ---');
{
  const tab = { id: 4103 };
  forgetTabLanguage(tab.id);
  const { res, langs } = await track(() => handleShowDictionaryCard(tab, 'вастома тонавтыця', 'sms'));
  assert.ok(['myv', 'mdf', 'kpv', 'koi', 'udm', 'mhr', 'mrj', 'yrk', 'sjd', 'mns'].includes(res.srcLang), `Cyrillic phrase → ${res.srcLang}`);
  assert.ok(!langs.some(l => LATIN.includes(l)), `no Latin-script analyzer for a Cyrillic phrase: ${langs}`);
  forgetTabLanguage(tab.id);
}
console.log('✓ Cyrillic phrase');

console.log('🎉 PAGE LANGUAGE LOCK TESTS PASSED 🎉');
process.exit(0);
