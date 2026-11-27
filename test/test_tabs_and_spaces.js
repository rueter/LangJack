import assert from 'node:assert';
import { tabsAndRuns, tabsToSpaces, oneLine } from '../js/services/text-spaces.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { treebankService } from '../js/services/treebank-service.js';

console.log('--- helpers ---');
assert.strictEqual(tabsToSpaces('a\tb\t\tc'), 'a b  c', 'every tab is a space');
assert.strictEqual(tabsAndRuns('a\tb \t c\t\td'), 'a b c d', 'a tab with its blanks, or any run of blanks, is one space');
assert.strictEqual(tabsAndRuns('a  b     c'), 'a b c');
assert.strictEqual(tabsAndRuns('one\ntwo\t\nthree'), 'one\ntwo \nthree', 'line breaks stay');
assert.strictEqual(oneLine(' a\tb \n c  d \r\n'), 'a b c d');
assert.strictEqual(oneLine(null), '');
console.log('✓ helpers');

console.log('--- sentence text from the tokenizer has no tab and no double space ---');
{
  const sents = analyzerService.tokenize('Mon\tleäm  ååum.\t\tSon  lij\tkuuʹǩǩ.', 'sms');
  assert.strictEqual(sents.length, 2);
  assert.strictEqual(sents[0].text, 'Mon leäm ååum.');
  assert.strictEqual(sents[1].text, 'Son lij kuuʹǩǩ.');
  assert.deepStrictEqual(sents[0].tokens.map(t => t.form), ['Mon', 'leäm', 'ååum', '.']);
}
console.log('✓ tokenize');

console.log('--- CoNLL-U: one space between tokens, whatever the text had ---');
{
  const tok = (id, form) => ({ id, form, lemma: form, upos: 'NOUN', selectedReading: { lemma: form, raw: `${form}+N+Sg+Nom` } });
  const sentence = { sent_id: 1, text: 'kala\t\tuni   ja\nkoira.', tokens: [tok(1, 'kala'), tok(2, 'uni'), tok(3, 'ja'), tok(4, 'koira'), tok(5, '.')] };
  const out = ConlluExporter.export([sentence], [{ lang: 'eng', text: 'fish\tsleeps   and dog' }]);
  const lines = out.split('\n');
  assert.ok(lines.includes('# text = kala uni ja koira.'), out);
  assert.ok(lines.includes('# text_eng = fish sleeps and dog'), out);
  for (const l of lines.filter(l => l.startsWith('#'))) assert.ok(!/\t|  /.test(l), `no tab or double space in: ${l}`);
  // SpaceAfter=No still lands where the text has no blank: «koira» touches «.»
  const row = lines.find(l => /^4\t/.test(l)).split('\t');
  assert.ok(/SpaceAfter=No/.test(row[9]), row.join('|'));
  assert.ok(!/SpaceAfter=No/.test(lines.find(l => /^1\t/.test(l)).split('\t')[9]));
}
console.log('✓ export');

console.log('--- a saved treebank keeps the text with single spaces ---');
{
  const tb = await treebankService.saveSentence({ text: 'kala\tuni  ja', tokens: [{ id: 1, form: 'kala' }, { id: 2, form: 'uni' }, { id: 3, form: 'ja' }] });
  assert.strictEqual(tb.text, 'kala uni ja');
  await treebankService.clearAccumulatedFile();
}
console.log('✓ treebank');
console.log('🎉 TAB AND SPACE TESTS PASSED 🎉');
process.exit(0);
