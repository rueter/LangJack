/**
 * Test Suite: dual-number tags in the tag mapper
 * Verifies:
 * 1. Du maps to Number=Dual; Du1-3, ScDu1-3, OcDu1-3, PxDu1-3 map to Person + Number with the
 *    [subj] / [obj] / [psor] layer on both features (and none on the bare Du forms).
 * 2. Every Du tag mirrors its Sg and Pl analogue: same features and person, only the Number value differs.
 * 3. Whole analyses parse into the right sorted FEATS, several layers side by side included.
 * 4. Dual is a Number value the feature inventory knows; nothing leaks into the other numbers.
 */

import assert from 'node:assert';
import { TagMapper, featsForTag, TAG_TO_FEATS } from '../js/services/tag-mapper.js';
import { UNIVERSAL_FEATURES } from '../js/services/ud-feature-inventory.js';

console.log('=== Dual-number tag mappings ===\n');

const LAYERS = { '': '', Sc: '[subj]', Oc: '[obj]', Px: '[psor]' };
const NUMBERS = { Sg: 'Sing', Pl: 'Plur', Du: 'Dual' };

// 1. the table itself, tag by tag
assert.deepStrictEqual(featsForTag('Du'), { feature: 'Number', value: 'Dual' });
for (const [prefix, layer] of Object.entries(LAYERS)) {
  for (const person of ['1', '2', '3']) {
    const tag = `${prefix}Du${person}`;
    assert.deepStrictEqual(
      featsForTag(tag),
      [{ feature: `Person${layer}`, value: person }, { feature: `Number${layer}`, value: 'Dual' }],
      tag
    );
  }
}

// 2. parity with Sg / Pl: the same shape, only the Number value differs
for (const prefix of Object.keys(LAYERS)) {
  for (const person of ['1', '2', '3']) {
    const du = featsForTag(`${prefix}Du${person}`);
    for (const num of ['Sg', 'Pl']) {
      const other = featsForTag(`${prefix}${num}${person}`);
      assert.ok(Array.isArray(other), `${prefix}${num}${person} exists`);
      assert.deepStrictEqual(du.map(f => f.feature), other.map(f => f.feature), `${prefix}Du${person} vs ${num}: same features`);
      assert.strictEqual(du[0].value, other[0].value, `${prefix}Du${person} vs ${num}: same person`);
      assert.strictEqual(other[1].value, NUMBERS[num]);
      assert.notStrictEqual(du[1].value, other[1].value);
    }
  }
}
// all 12 Du tags and no stray ones: every table key containing "Du" is on the list
const duKeys = Object.keys(TAG_TO_FEATS).filter(k => /Du/.test(k)).sort();
const expected = ['Du', ...Object.keys(LAYERS).flatMap(p => ['1', '2', '3'].map(n => `${p}Du${n}`))].sort();
assert.deepStrictEqual(duKeys, expected);

// 3. whole analyses
const feats = (raw, lang) => TagMapper.parse(raw, 0, lang).feats;
assert.strictEqual(feats('x+N+Du+Nom'), 'Case=Nom|Number=Dual');
assert.strictEqual(feats('x+N+PxDu1'), 'Number[psor]=Dual|Person[psor]=1');
assert.strictEqual(feats('x+N+Sg+Nom+PxDu2'), 'Case=Nom|Number=Sing|Number[psor]=Dual|Person[psor]=2');
assert.strictEqual(feats('x+N+Du+Nom+PxDu3'), 'Case=Nom|Number=Dual|Number[psor]=Dual|Person[psor]=3', 'own number and possessor number do not collide');
assert.strictEqual(feats('x+V+Ind+Prs+Du1'), 'Mood=Ind|Number=Dual|Person=1|Tense=Pres|VerbForm=Fin');
assert.strictEqual(feats('x+V+Ind+Prs+ScDu1+OcDu3'),
  'Mood=Ind|Number[obj]=Dual|Number[subj]=Dual|Person[obj]=3|Person[subj]=1|Tense=Pres|VerbForm=Fin');
assert.strictEqual(feats('x+V+Ind+Prs+ScSg1+OcDu2'),
  'Mood=Ind|Number[obj]=Dual|Number[subj]=Sing|Person[obj]=2|Person[subj]=1|Tense=Pres|VerbForm=Fin', 'dual object, singular subject');
// the language argument changes nothing for the dual tags
for (const lang of ['sms', 'sjd', 'fin', 'myv', 'kpv', null]) {
  assert.strictEqual(feats('x+V+Ind+Prs+Du2', lang), 'Mood=Ind|Number=Dual|Person=2|Tense=Pres|VerbForm=Fin', `Du2 in ${lang}`);
}

// 4. the inventory knows the value
assert.ok(UNIVERSAL_FEATURES.Number.includes('Dual'));
assert.strictEqual(featsForTag('NoSuchDu1'), undefined);

console.log('✓ all passed');
