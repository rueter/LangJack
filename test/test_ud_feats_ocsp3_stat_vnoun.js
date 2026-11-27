import assert from 'node:assert';
import { TagMapper } from '../js/services/tag-mapper.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';

const feats = (raw, lang = 'lut') => TagMapper.parse(raw, 0, lang).feats;

console.log('--- +OcSP3, +Asp/Stat and +Vnoun in column 6 ---');
assert.strictEqual(feats('x+V+OcSP3'), 'Number[obj]=Plur,Sing|Person[obj]=3', '+OcSP3: third-person object, number open');
assert.strictEqual(feats('x+V+Asp/Stat'), 'Aspect=Stat');
assert.strictEqual(feats('x+V+Vnoun'), 'VerbForm=Vnoun');
assert.strictEqual(feats('x+V+Asp/Stat+OcSP3+Ind+Prs+ScSg3'),
  'Aspect=Stat|Mood=Ind|Number[obj]=Plur,Sing|Number[subj]=Sing|Person[obj]=3|Person[subj]=3|Tense=Pres|VerbForm=Fin');
assert.strictEqual(feats('x+V+Vnoun+N+Sg+Nom', 'myv'), 'Case=Nom|Number=Sing|VerbForm=Vnoun');
// the existing object-agreement tags are as they were
assert.strictEqual(feats('x+V+OcSg3'), 'Number[obj]=Sing|Person[obj]=3');
assert.strictEqual(feats('x+V+OcPl3'), 'Number[obj]=Plur|Person[obj]=3');
console.log('✓ mappings');

console.log('--- they reach the CoNLL-U FEATS column ---');
{
  const raw = 'kwedad+V+Asp/Stat+OcSP3';
  const tok = { id: 1, form: 'kwedad', lemma: 'kwedad', upos: 'VERB', selectedReading: { lemma: 'kwedad', raw } };
  const row = ConlluExporter.export([{ sent_id: 1, text: 'kwedad', tokens: [tok] }], [], 'lut').split('\n').find(l => /^1\t/.test(l)).split('\t');
  assert.strictEqual(row[5], 'Aspect=Stat|Number[obj]=Plur,Sing|Person[obj]=3');
}
console.log('✓ export');
console.log('🎉 UD FEATS TESTS PASSED 🎉');
process.exit(0);
