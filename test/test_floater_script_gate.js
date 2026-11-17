import assert from 'node:assert';
import {
  wordScript, isCyrillicOrthographyLang, analyzeWordWithLanguageAssurance,
  detectLanguageForWord, LOOKUP_BUDGET_MS
} from '../background.js';

console.log('--- Script gate: letters without a look-alike in the other script ---');
assert.strictEqual(wordScript('ǩiõl'), 'lat');
assert.strictEqual(wordScript('piânnai'), 'lat');
assert.strictEqual(wordScript('dnf'), 'lat', 'd n f have no Cyrillic look-alike');
assert.strictEqual(wordScript('вастома'), null, 'only look-alikes: no commitment');
assert.strictEqual(wordScript('кот'), null);
assert.strictEqual(wordScript('пыдоʼ'), 'cyr', 'п д have no Latin look-alike');
assert.strictEqual(wordScript('мунісӧ'), 'cyr', 'н і с are look-alikes, but ӧ is not');
assert.strictEqual(wordScript('хаãвхэкомʼ'), 'cyr', 'stray Latin letters in a Cyrillic word: the majority decides');
assert.strictEqual(wordScript('kæpa'), 'lat');
assert.ok(isCyrillicOrthographyLang('mrj') && isCyrillicOrthographyLang('myv') && !isCyrillicOrthographyLang('sms'));
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
