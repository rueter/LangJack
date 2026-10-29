import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';

console.log('=== Nordic ordinals: "23." stays one token when the transducer has the +Ord reading ===\n');

// a stand-in transducer: digits + full stop are ordinals (as in fin / sms), plain digits are cardinals
const fake = {
  lookup(w) {
    if (/^\d+\.$/.test(w)) return [[`${w.slice(0, -1)}+A+Arab+Ord+Attr`, 0]];
    if (/^\d+$/.test(w)) return [[`${w}+Num+Arab+Sg+Nom`, 0]];
    return [];
  }
};
analyzerService.models.set('fin', fake);
analyzerService.models.set('sms', fake);
analyzerService.models.set('xxx', { lookup: () => [] });

const toks = (text, lang) => analyzerService.tokenize(text, lang).map((s) => s.tokens.map((t) => t.form));

assert.deepStrictEqual(toks('Kokous on 23. kesäkuuta.', 'fin'), [['Kokous', 'on', '23.', 'kesäkuuta', '.']]);
assert.deepStrictEqual(toks('Kokous on 23. kesäkuuta.', 'sms'), [['Kokous', 'on', '23.', 'kesäkuuta', '.']]);
assert.deepStrictEqual(toks('Kokous on 23. kesäkuuta.', null), [['Kokous', 'on', '23', '.', 'kesäkuuta', '.']], 'no language: as before');
assert.deepStrictEqual(toks('Kokous on 23. kesäkuuta.', 'xxx'), [['Kokous', 'on', '23', '.', 'kesäkuuta', '.']], 'no +Ord reading: split');
assert.deepStrictEqual(toks('Kokous on 23. kesäkuuta.', 'eng'), [['Kokous', 'on', '23', '.', 'kesäkuuta', '.']], 'no transducer: split');

// a sentence-final full stop is the sentence's own
assert.deepStrictEqual(toks('Vuonna 1990.', 'fin'), [['Vuonna', '1990', '.']]);
// decimals and a full stop touching more text
assert.deepStrictEqual(toks('Se on 2.5 metriä.', 'fin'), [['Se', 'on', '2', '.', '5', 'metriä', '.']]);
// dates are one sentence
assert.deepStrictEqual(toks('Tänään on 23. 5. 2020 ja sataa.', 'fin'), [['Tänään', 'on', '23.', '5.', '2020', 'ja', 'sataa', '.']]);
assert.strictEqual(analyzerService.tokenize('Tänään on 23. 5. 2020 ja sataa.', 'fin').length, 1);
// two real sentences are still two
assert.strictEqual(analyzerService.tokenize('Hän tuli. Sitten hän meni.', 'fin').length, 2);
assert.strictEqual(analyzerService.tokenize('Hän tuli vuonna 1990. Sitten hän meni.', 'fin').length, 2);
// not touched: a number with a hyphen word, a word with a full stop
assert.deepStrictEqual(toks('Kello 10-luvulla. Hei', 'fin')[0].slice(0, 3), ['Kello', '10-luvulla', '.']);

// analysis end to end
const sents = await analyzerService.analyzeText('Kokous on 23. kesäkuuta.', 'fin');
const ord = sents[0].tokens[2];
assert.strictEqual(ord.form, '23.');
assert.strictEqual(ord.lemma, '23');
assert.strictEqual(ord.upos, 'ADJ');
assert.strictEqual(ord.selectedReading.raw, '23+A+Arab+Ord+Attr');
assert.strictEqual(ord.isPunct, false);
console.log('✓ ordinal numerals keep their full stop');
