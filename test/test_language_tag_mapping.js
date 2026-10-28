import assert from 'node:assert';
import { TagMapper, featsForTag } from '../js/services/tag-mapper.js';
import { featsFromGloss } from '../js/services/conllu-enhance.js';

console.log('=== Language-specific tag mappings ===\n');

const feats = (raw, lang) => TagMapper.parse(raw, 0, lang).feats;

// Permian: +Abe and +Car are both Case=Abe, told apart by Variant
for (const lang of ['kpv', 'koi', 'KPV', 'kpv_lattice', 'Komi-Zyrian (kpv)']) {
  assert.strictEqual(feats('ворсыны+N+Sg+Abe', lang), 'Case=Abe|Number=Sing|Variant=Nomin', `Abe in ${lang}`);
  assert.strictEqual(feats('ворсыны+N+Sg+Car', lang), 'Case=Abe|Number=Sing|Variant=Vclause', `Car in ${lang}`);
  assert.strictEqual(feats('ворсыны+V+Ind+Prt2', lang), 'Evident=Nfh|Mood=Ind|Tense=Past', `Prt2 in ${lang}`);
}

// Erzya and Moksha: second past is habitual
for (const lang of ['myv', 'mdf']) {
  assert.strictEqual(feats('кирдемс+V+Ind+Prt2', lang), 'Aspect=Hab|Mood=Ind|Tense=Past', `Prt2 in ${lang}`);
  assert.strictEqual(feats('кал+N+Sg+Abe', lang), 'Case=Abe|Number=Sing', `Abe in ${lang}`);
}

// everywhere else: the general mapping
for (const lang of ['fin', 'sms', null, undefined, '']) {
  assert.strictEqual(feats('x+N+Sg+Abe', lang), 'Case=Abe|Number=Sing');
  assert.strictEqual(feats('x+N+Sg+Car', lang), 'Case=Car|Number=Sing');
  assert.strictEqual(feats('x+V+Prt2', lang), 'Tense=Past');
}
assert.strictEqual(feats('x+V+Prt1', 'kpv'), 'Tense=Past', 'tags without a language entry are unaffected');
assert.strictEqual(feats('x+V+Prt1', 'myv'), 'Tense=Past');

// the tag lookup itself, and the gloss route
assert.deepStrictEqual(featsForTag('Car', 'koi'), [{ feature: 'Case', value: 'Abe' }, { feature: 'Variant', value: 'Vclause' }]);
assert.deepStrictEqual(featsForTag('Car', 'fin'), { feature: 'Case', value: 'Car' });
assert.strictEqual(featsForTag('NoSuchTag', 'kpv'), undefined);
assert.strictEqual([...featsFromGloss('ABE', 'NOUN', 'kpv').feats].join('|'), 'Case,Abe|Variant,Nomin');
assert.strictEqual([...featsFromGloss('ABE', 'NOUN', 'fin').feats].join('|'), 'Case,Abe');
assert.strictEqual([...featsFromGloss('ABE', 'NOUN').feats].join('|'), 'Case,Abe');

console.log('✓ all passed');
