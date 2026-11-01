import assert from 'node:assert';
import { TagMapper, featsForTag, NEGATIVE_AUX_LANGS, hasNegativeAux, isNegativeAux } from '../js/services/tag-mapper.js';
import { featsFromGloss, baselineDependencies } from '../js/services/conllu-enhance.js';

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

// +Indef on a pronoun or determiner is PronType=Ind (UPOS PRON / DET); on other words it stays Definite=Ind
for (const [raw, upos, expected] of [
  ['joku+Pron+Indef', 'PRON', 'PronType=Ind'],
  ['joku+Pron+Indef+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Ind'],
  ['jokin+Det+Indef', 'DET', 'PronType=Ind'],
  ['x+N+Ine+Indef', 'NOUN', 'Case=Ine|Definite=Ind']
]) {
  const r = TagMapper.parse(raw, 0, 'fin');
  assert.strictEqual(r.upos, upos, `${raw}: UPOS`);
  assert.strictEqual(r.feats, expected, `${raw}: FEATS`);
}
assert.deepStrictEqual(featsForTag('Indef', 'fin', 'PRON'), { feature: 'PronType', value: 'Ind' });
assert.deepStrictEqual(featsForTag('Indef', 'fin', 'DET'), { feature: 'PronType', value: 'Ind' });
assert.deepStrictEqual(featsForTag('Indef', 'fin', 'NOUN'), { feature: 'Definite', value: 'Ind' });
assert.strictEqual([...featsFromGloss('INDEF', 'PRON').feats].join('|'), 'PronType,Ind');
assert.strictEqual([...featsFromGloss('INDEF', 'NOUN').feats].join('|'), 'Definite,Ind');

// the negation verb, (V+)Aux+Neg: AUX, Polarity=Neg, deprel aux:neg, in the listed languages only
assert.deepStrictEqual(NEGATIVE_AUX_LANGS, [...NEGATIVE_AUX_LANGS].sort(), 'the language list is alphabetical');
assert.deepStrictEqual(NEGATIVE_AUX_LANGS, ['fin', 'koi', 'kpv', 'mdf', 'mhr', 'mrj', 'myv', 'sme', 'sms', 'udm', 'vro']);
for (const lang of NEGATIVE_AUX_LANGS) {
  for (const raw of ['ii+V+Aux+Neg+Ind+Sg3', 'ii+Aux+Neg+Ind+Sg3', 'ii+V+Neg+Ind+Sg3']) {
    const r = TagMapper.parse(raw, 0, lang);
    assert.strictEqual(r.upos, 'AUX', `${raw} in ${lang}: UPOS`);
    assert.strictEqual(r.feats, 'Mood=Ind|Number=Sing|Person=3|Polarity=Neg', `${raw} in ${lang}: FEATS`);
    assert.strictEqual(r.deprel, 'aux:neg', `${raw} in ${lang}: deprel`);
    assert.strictEqual(TagMapper.deriveUpos(raw.split('+').slice(1), lang), 'AUX');
  }
}
assert(hasNegativeAux('kpv_lattice') && hasNegativeAux('Komi-Zyrian (kpv)') && !hasNegativeAux('deu') && !hasNegativeAux(null));
assert(!isNegativeAux(['N', 'Neg'], 'fin'), 'Neg on a noun is not the negation verb');
const other = TagMapper.parse('x+V+Neg+Ind+Sg3', 0, 'deu');
assert.strictEqual(other.upos, 'VERB');
assert.strictEqual(other.deprel, null);
assert(!other.feats.includes('Polarity'));
// the dependency baseline
const deps = baselineDependencies([
  { id: '1', upos: 'PRON', head: '_' }, { id: '2', upos: 'AUX', head: '_', negAux: true }, { id: '3', upos: 'VERB', head: '_' }
]);
assert.strictEqual(deps[1].deprel, 'aux:neg');
assert.strictEqual(baselineDependencies([{ id: '1', upos: 'VERB', head: '_' }, { id: '2', upos: 'AUX', head: '_' }])[1].deprel, 'aux');

console.log('✓ all passed');
