import assert from 'node:assert';
import {
  wordScript, isCyrillicOrthographyLang, analyzeWordWithLanguageAssurance,
  detectLanguageForWord, LOOKUP_BUDGET_MS
} from '../background.js';

console.log('--- Script gate: any Cyrillic character rules out the Latin-script languages, and not the other way round ---');
assert.strictEqual(wordScript('пыдоʼ'), 'cyr');
assert.strictEqual(wordScript('мунісӧ'), 'cyr');
assert.strictEqual(wordScript('вастома'), 'cyr', 'only look-alikes of Latin letters, but Cyrillic characters all the same');
assert.strictEqual(wordScript('кот'), 'cyr');
assert.strictEqual(wordScript('хаãвхэкомʼ'), 'cyr', 'stray Latin letters in a Cyrillic word do not matter');
assert.strictEqual(wordScript('piаnnai'), 'cyr', 'one Cyrillic «а» among Latin letters is enough');
assert.strictEqual(wordScript('ԁӧзьӧр'), 'cyr', 'Cyrillic Supplement («ԁ» of the Komi alphabet) counts');
assert.strictEqual(wordScript('ǩiõl'), null, 'Latin letters never rule anything out');
assert.strictEqual(wordScript('piânnai'), null);
assert.strictEqual(wordScript('dnf'), null, 'not even letters with no Cyrillic look-alike');
assert.strictEqual(wordScript('kæpa'), null);
assert.strictEqual(wordScript(''), null);
assert.ok(isCyrillicOrthographyLang('mrj') && isCyrillicOrthographyLang('myv') && !isCyrillicOrthographyLang('sms'));
assert.ok(isCyrillicOrthographyLang('bxr') && isCyrillicOrthographyLang('evn') && !isCyrillicOrthographyLang('fin'));
console.log('✓ wordScript');

console.log('--- lut/slh and mhr/mrj are not guessed ---');
assert.strictEqual(detectLanguageForWord('lək̓ʷšid'), 'lut');
assert.strictEqual(detectLanguageForWord('lək̓ʷšid', 'slh'), 'slh');
assert.strictEqual(detectLanguageForWord('тӱҥалыныт'), 'mrj');
assert.strictEqual(detectLanguageForWord('тӱҥалыныт', 'mhr'), 'mhr');
console.log('✓ tie-breaks');

console.log('--- A preferred language of the wrong script is not loaded; Skolt letters go straight to sms; 4 s cap ---');
for (const pref of ['myv', 'mrj', 'kpv']) {
  const t = Date.now();
  const res = await analyzeWordWithLanguageAssurance('ǩiõl', pref);
  assert.strictEqual(res.lang, 'sms', `«ǩiõl» with preferred ${pref} is sms`);
  assert.ok(Date.now() - t < LOOKUP_BUDGET_MS + 500, 'within the budget');
}
for (const pref of ['sms', 'fin', 'pad']) {
  const t = Date.now();
  const res = await analyzeWordWithLanguageAssurance('пыдоʼ', pref);
  assert.strictEqual(res.lang, 'yrk', `«пыдоʼ» with preferred ${pref} is yrk`);
  assert.ok(Date.now() - t < LOOKUP_BUDGET_MS + 500, 'within the budget');
}
{
  const t = Date.now();
  await analyzeWordWithLanguageAssurance('kawič', 'pad');
  assert.ok(Date.now() - t < LOOKUP_BUDGET_MS + 500, 'an unpackaged language never hangs past the budget');
}
console.log('✓ script gate and time budget');
console.log('🎉 FLOATER SCRIPT GATE TESTS PASSED 🎉');
process.exit(0);
