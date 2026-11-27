import assert from 'node:assert';
import { ConlluExporter, commentLine } from '../js/services/conllu-exporter.js';
import { treebankService } from '../js/services/treebank-service.js';
import { parseConllu, serializeConllu } from '../js/services/conllu-parser.js';

const tok = (id, form) => ({ id, form, lemma: form, upos: 'NOUN', head: '_', deprel: '_', selectedReading: { lemma: form, raw: `${form}+N+Sg+Nom` } });
const sent = (extra = {}) => ({ sent_id: 1, text: 'kala uni', tokens: [tok(1, 'kala'), tok(2, 'uni')], ...extra });
const tr = [{ lang: 'eng', text: 'fish sleeps' }, { lang: 'fin', text: 'kala nukkuu' }];
const head = (out) => out.split('\n').filter(l => l.startsWith('#') || /^1\t/.test(l));

console.log('--- the comment stands between the translations and the first token ---');
{
  const out = ConlluExporter.export([sent()], tr, null, 'Checked with the speaker.');
  assert.deepStrictEqual(head(out).slice(0, 5), [
    '# sent_id = 1', '# text = kala uni', '# text_eng = fish sleeps', '# text_fin = kala nukkuu', '# comment = Checked with the speaker.'
  ]);
  const lines = out.split('\n');
  assert.ok(/^1\t/.test(lines[lines.indexOf('# comment = Checked with the speaker.') + 1]), 'the first token row follows the comment');
}
console.log('✓ order');

console.log('--- no comment, no line; a comment without translations follows the text ---');
{
  assert.ok(!ConlluExporter.export([sent()], tr, null, '').includes('# comment'));
  assert.ok(!ConlluExporter.export([sent()], tr, null, '   ').includes('# comment'));
  assert.ok(!ConlluExporter.export([sent()], tr).includes('# comment'));
  const lines = ConlluExporter.export([sent()], [], null, 'only a comment').split('\n');
  assert.deepStrictEqual(lines.slice(0, 3), ['# sent_id = 1', '# text = kala uni', '# comment = only a comment']);
}
console.log('✓ optional');

console.log('--- one line only; the sentence\'s own comment wins over the general one ---');
{
  assert.strictEqual(commentLine('a\nb\t c\r\nd'), 'a b c d');
  assert.strictEqual(commentLine(null), '');
  const out = ConlluExporter.export([sent(), sent({ sent_id: 2, comment: 'its own' }), sent({ sent_id: 3, comment: '' })], [], null, 'general');
  const comments = out.split('\n').filter(l => l.startsWith('# comment'));
  assert.deepStrictEqual(comments, ['# comment = general', '# comment = its own'], 'an empty own comment means none, not the general one');
  const multi = ConlluExporter.export([sent()], [], null, 'first line\nsecond line');
  assert.strictEqual(multi.split('\n').filter(l => l.startsWith('# comment')).length, 1);
  assert.ok(multi.includes('# comment = first line second line'));
}
console.log('✓ single line, per-sentence override');

console.log('--- a saved treebank keeps the comment ---');
{
  const tb = await treebankService.saveSentence(sent(), tr, 'myv', 'all', 'from the field notes');
  assert.strictEqual(tb.comment, 'from the field notes');
  const one = treebankService.generateSingleConllu(tb);
  assert.ok(one.includes('# text_fin = kala nukkuu\n# comment = from the field notes\n1\t'), one);
  assert.ok(treebankService.generateCombinedConllu().includes('# comment = from the field notes'));
  const none = await treebankService.saveSentence(sent(), tr, 'myv', 'all');
  assert.strictEqual(none.comment, '');
  assert.ok(!treebankService.generateSingleConllu(none).includes('# comment'));
  await treebankService.clearAccumulatedFile();
}
console.log('✓ treebank');

console.log('--- the exported file reads back with the comment in place ---');
{
  const out = ConlluExporter.export([sent()], tr, null, 'round trip');
  const parsed = parseConllu(out);
  const s0 = parsed.sentences[0];
  const keys = s0.lines.filter(l => l.kind === 'comment').map(l => l.meta && l.meta.key);
  assert.deepStrictEqual(keys, ['sent_id', 'text', 'text_eng', 'text_fin', 'comment']);
  assert.strictEqual(serializeConllu(parsed).replace(/\n+$/, ''), out.replace(/\n+$/, ''));
}
console.log('✓ round trip');

console.log('🎉 CONLLU COMMENT TESTS PASSED 🎉');
process.exit(0);
