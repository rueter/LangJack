import assert from 'node:assert';
import { TagMapper, isFiniteTag } from '../js/services/tag-mapper.js';
import { featsFromGloss } from '../js/services/conllu-enhance.js';

console.log('=== VerbForm=Fin for finite verbs ===\n');
for (const t of ['Sg1', 'Sg2', 'Sg3', 'Pl1', 'Pl3', 'Du2', 'ScSg1', 'ScPl3', 'ScSg3F', 'ScPl3M']) assert(isFiniteTag(t), t);
for (const t of ['OcSg1', 'PxSg1', 'Sg', 'Pl', 'Ind', 'Nom', 'V', 'Sg3X']) assert(!isFiniteTag(t), t);

const feats = (raw, lang) => TagMapper.parse(raw, 0, lang).featsMap;
assert.strictEqual(feats('сай+V+Ind+Prs+Sg1').VerbForm, 'Fin');
assert.strictEqual(feats('сай+V+Ind+Prs+Pl3').VerbForm, 'Fin');
assert.strictEqual(feats('kuma+V+Ind+Prt+ScSg1').VerbForm, 'Fin');
assert.strictEqual(feats('kuma+V+Imprt+Sg2').VerbForm, 'Fin');
assert.strictEqual(TagMapper.parse('сай+V+Ind+Prs+Sg1').feats, 'Mood=Ind|Number=Sing|Person=1|Tense=Pres|VerbForm=Fin');
assert.strictEqual(feats('кал+N+Sg+Nom').VerbForm, undefined, 'not a verb');
assert.strictEqual(feats('сай+V+Inf').VerbForm, undefined, 'no finite ending');
assert.strictEqual(feats('сай+N+Sg3').VerbForm, undefined, 'a noun, not a VERB');
assert.strictEqual(feats('сай+V+Der/NomAct+Sg3').VerbForm, 'Vnoun', 'an existing VerbForm is kept');
assert.strictEqual(feats('сай+V+OcSg1').VerbForm, undefined, 'an object ending alone is not finite');

assert.strictEqual(featsFromGloss('ver-VBLZ-3SG.M.S', 'VERB').feats.get('VerbForm'), 'Fin');
assert.strictEqual(featsFromGloss('ver-1SG', 'VERB').feats.get('VerbForm'), 'Fin');
assert.strictEqual(featsFromGloss('ver-3SG.M.O', 'VERB').feats.get('VerbForm'), undefined, 'object only');
assert.strictEqual(featsFromGloss('ver-1SG', 'NOUN').feats.get('VerbForm'), undefined);
console.log('✓ VerbForm=Fin');
