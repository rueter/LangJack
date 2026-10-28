import assert from 'node:assert';
import { TagMapper } from '../js/services/tag-mapper.js';
import { ConlluExporter, xposFromAnalysis, noSpaceAfter } from '../js/services/conllu-exporter.js';

console.log('=== CoNLL-U export: XPOS without lemma, punctuation unglossed, SpaceAfter=No ===\n');

assert.strictEqual(xposFromAnalysis('пек+Adv+Deg'), 'Adv+Deg');
assert.strictEqual(xposFromAnalysis('пек+Adv+Deg+Guess'), 'Adv+Deg');
assert.strictEqual(xposFromAnalysis('кал#пря+N+Sg+Nom'), 'N+Sg+Nom');
assert.strictEqual(xposFromAnalysis(',+CLB'), 'CLB');
assert.strictEqual(xposFromAnalysis(''), '');

assert.deepStrictEqual(noSpaceAfter('Пек сайть, ды вастома.', [{ form: 'Пек' }, { form: 'сайть' }, { form: ',' }, { form: 'ды' }, { form: 'вастома' }, { form: '.' }]),
  [false, true, false, false, true, false]);
assert.deepStrictEqual(noSpaceAfter('«Пек» сайть', [{ form: '«' }, { form: 'Пек' }, { form: '»' }, { form: 'сайть' }]), [true, true, false, false]);
assert.deepStrictEqual(noSpaceAfter('ab c', [{ form: 'zzz' }, { form: 'c' }]), [false, false], 'an unfindable form gives no flag');

const tok = (form, raw, extra = {}) => ({ form, selectedReading: raw ? TagMapper.parse(raw) : undefined, ...extra });
const sent = {
  sent_id: 1,
  text: 'Пек сайть, «ды».',
  tokens: [
    tok('Пек', 'пек+Adv+Deg', { selectedGloss: { gloss: 'very', lang: 'en' } }),
    tok('сайть', 'сай+V+Ind+Prs+Sg3'),
    tok(',', ',+CLB', { isPunct: true, customGloss: 'comma', customGlossLang: 'en' }),
    tok('«', null),
    tok('ды', 'ды+CC'),
    tok('»', null, { selectedGloss: { gloss: 'quote', lang: 'en' } }),
    tok('.', '.+CLB', { isPunct: true })
  ]
};
const rows = ConlluExporter.export([sent]).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));

assert.strictEqual(rows[0][4], 'Adv+Deg', 'XPOS has no lemma stem');
assert.strictEqual(rows[0][2], 'пек', 'the lemma stays in column 3');
assert.strictEqual(rows[0][9], 'Gloss[en]=very');
assert.strictEqual(rows[1][4], 'V+Ind+Prs+Sg3');
assert.strictEqual(rows[1][9], 'SpaceAfter=No', 'the comma touches the word before it');
assert.strictEqual(rows[2][3], 'PUNCT');
assert.strictEqual(rows[2][2], ',');
assert.strictEqual(rows[2][4], 'CLB');
assert.strictEqual(rows[2][9], '_', 'punctuation has no gloss and no spacing flag (a space follows)');
assert.strictEqual(rows[3][3], 'PUNCT', 'a symbol the analyzer does not flag is still punctuation');
assert.strictEqual(rows[3][9], 'SpaceAfter=No', 'an opening quote touches the next word');
assert.strictEqual(rows[4][9], 'SpaceAfter=No');
assert.strictEqual(rows[5][9], 'SpaceAfter=No', 'a closing quote is not glossed but touches the full stop');
assert.strictEqual(rows[5][7], 'punct');
assert.strictEqual(rows[6][9], '_', 'the last token gets no flag');
for (const r of rows) assert.strictEqual(r.length, 10);

// alphabetical order in FEATS and MISC
const mixed = ConlluExporter.export([{
  sent_id: 2, text: 'Пек,',
  tokens: [{
    form: 'Пек', lemma: 'пек', upos: 'ADV', selectedReading: { raw: 'пек+Adv', pos: 'Adv', upos: 'ADV', feats: 'Number=Sing|Case=Nom|Degree=Pos' },
    customGloss: 'very', customGlossLang: 'en', readings: [{}, {}]
  }, { form: ',', isPunct: true }]
}]).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
assert.strictEqual(mixed[0][5], 'Case=Nom|Degree=Pos|Number=Sing', 'FEATS sorted alphabetically');
assert.strictEqual(mixed[0][9], 'AltReadings=2|Gloss[en]=very|SpaceAfter=No', 'MISC sorted alphabetically');

console.log('✓ all passed');
