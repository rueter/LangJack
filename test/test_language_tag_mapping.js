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
  ['x+N+Ine+Indef', 'NOUN', 'Case=Ine|Definite=Ind'],
  // any pronoun subtype on a PRON or DET is PronType
  ['kuka+Pron+Rel+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Rel'],
  ['kuka+Pron+Interr+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Int'],
  ['tämä+Pron+Dem+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Dem'],
  ['tämä+Det+Dem+Sg+Nom', 'DET', 'Case=Nom|Number=Sing|PronType=Dem'],
  ['minä+Pron+Pers+Sg1+Nom', 'PRON', 'Case=Nom|Number=Sing|Person=1|PronType=Prs'],
  ['kaikki+Det+Tot', 'DET', 'PronType=Tot'],
  ['kukaan+Pron+Neg', 'PRON', 'PronType=Neg'],
  ['некод+Pron+Pron+Neg+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Neg'],
  ['мый+Pron+Nom+Rel', 'PRON', 'Case=Nom|PronType=Rel'],
  ['itse+Pron+Refl+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Prs|Reflex=Yes'],
  ['toinen+Pron+Recip+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Rcp'],
  // Erzya: +Indef / +Def after the case tag is definiteness (analyzer output of the myv model)
  ['кудо+N+Sg+Nom+Indef', 'NOUN', 'Case=Nom|Definite=Ind|Number=Sing'],
  ['кудо+N+Sg+Nom+Def', 'NOUN', 'Case=Nom|Definite=Def|Number=Sing'],
  ['ломань+A+Sg+Nom+Indef', 'ADJ', 'Case=Nom|Definite=Ind|Number=Sing'],
  ['те+Pron+Dem+Sg+Gen+Indef', 'PRON', 'Case=Gen|Definite=Ind|Number=Sing|PronType=Dem'],
  ['мезе+Pron+Rel+Sg+Nom+Indef', 'PRON', 'Case=Nom|Definite=Ind|Number=Sing|PronType=Rel'],
  ['мезе+Pron+Sg+Nom+Indef', 'PRON', 'Case=Nom|Definite=Ind|Number=Sing'],
  // PronType directly after +Pron / +Det; Definite only after a case tag, no feature in any other place
  ['x+Pron+Sg+Indef', 'PRON', 'Number=Sing'],
  ['x+N+Indef', 'NOUN', '_'],
  ['x+N+Def', 'NOUN', '_'],
  ['x+N+Sg+Def+Nom', 'NOUN', 'Case=Nom|Number=Sing'],
  ['x+Pron+Indef', 'PRON', 'PronType=Ind'],
  ['x+Det+Indef+Sg', 'DET', 'Number=Sing|PronType=Ind'],
  ['x+Adv+Rel', 'ADV', '_'],
  ['x+N+Rel', 'NOUN', '_']
]) {
  const r = TagMapper.parse(raw, 0, 'fin');
  assert.strictEqual(r.upos, upos, `${raw}: UPOS`);
  assert.strictEqual(r.feats, expected, `${raw}: FEATS`);
}
assert.deepStrictEqual(featsForTag('Indef', 'fin', 'PRON'), { feature: 'PronType', value: 'Ind' });
assert.deepStrictEqual(featsForTag('Indef', 'fin', 'DET'), { feature: 'PronType', value: 'Ind' });
assert.deepStrictEqual(featsForTag('Indef', 'fin', 'NOUN'), { feature: 'Definite', value: 'Ind' });
assert.deepStrictEqual(featsForTag('Indef', 'myv', 'PRON', { afterCase: true }), { feature: 'Definite', value: 'Ind' }, 'after a case tag: definiteness');
assert.deepStrictEqual(featsForTag('Indef', 'myv', 'DET', { afterCase: false, afterPos: true }), { feature: 'PronType', value: 'Ind' });
assert.deepStrictEqual(featsForTag('Rel', 'myv', 'PRON', { afterCase: true }), { feature: 'PronType', value: 'Rel' }, 'only Indef is position-sensitive');
// Moksha (constructed strings; there is no mdf model in models/) behaves like Erzya
for (const [raw, upos, expected] of [
  ['x+N+Sg+Nom+Def', 'NOUN', 'Case=Nom|Definite=Def|Number=Sing'],
  ['x+Pron+Dem+Sg+Gen+Indef', 'PRON', 'Case=Gen|Definite=Ind|Number=Sing|PronType=Dem'],
  ['x+Pron+Indef+Sg+Nom', 'PRON', 'Case=Nom|Number=Sing|PronType=Ind']
]) {
  const r = TagMapper.parse(raw, 0, 'mdf');
  assert.strictEqual(r.upos, upos);
  assert.strictEqual(r.feats, expected, `mdf ${raw}`);
}
assert.strictEqual([...featsFromGloss('INDEF', 'PRON').feats].join('|'), 'PronType,Ind');
assert.strictEqual([...featsFromGloss('INDEF', 'NOUN').feats].join('|'), 'Definite,Ind');
assert.strictEqual([...featsFromGloss('NOM-INDEF', 'PRON').feats].join('|'), 'Case,Nom|Definite,Ind', 'INDEF after a case morpheme is definiteness');
assert.strictEqual([...featsFromGloss('INDEF-NOM', 'PRON').feats].join('|'), 'PronType,Ind|Case,Nom');

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
