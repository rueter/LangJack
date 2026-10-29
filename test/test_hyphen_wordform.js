import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';
import { TagMapper } from '../js/services/tag-mapper.js';
import { xposFromAnalysis } from '../js/services/conllu-exporter.js';

console.log('=== A word-final touching hyphen stays in the wordform ===\n');
const forms = (text) => analyzerService.tokenize(text)[0].tokens.map((t) => t.form);
const punct = (text) => analyzerService.tokenize(text)[0].tokens.map((t) => t.isPunct);

assert.deepStrictEqual(forms('tuõttvuõtt- da suåvâdvuõttkomissio'), ['tuõttvuõtt-', 'da', 'suåvâdvuõttkomissio']);
assert.deepStrictEqual(punct('tuõttvuõtt- da suåvâdvuõttkomissio'), [false, false, false], 'not punctuation');
assert.deepStrictEqual(forms('Maa- ja metsätalous.'), ['Maa-', 'ja', 'metsätalous', '.']);
assert.deepStrictEqual(forms('Maa-, meri- ja ilma'), ['Maa-', ',', 'meri-', 'ja', 'ilma']);
assert.deepStrictEqual(forms('kuuluu maa-'), ['kuuluu', 'maa-'], 'at the end of the text');
assert.deepStrictEqual(forms('maa-ja metsä'), ['maa-ja', 'metsä'], 'an inner hyphen is unchanged');
assert.deepStrictEqual(forms('maa - ja'), ['maa', '-', 'ja'], 'a spaced hyphen is still punctuation');
assert.deepStrictEqual(forms('a – b'), ['a', '–', 'b'], 'dashes are untouched');
assert.deepStrictEqual(forms("võro kiil' om"), ['võro', "kiil'", 'om'], 'apostrophes as before');

// a hyphen at the start of a word
assert.deepStrictEqual(forms('tuõttvuõtt- da -komissio'), ['tuõttvuõtt-', 'da', '-komissio']);
assert.deepStrictEqual(punct('tuõttvuõtt- da -komissio'), [false, false, false]);
assert.deepStrictEqual(forms('(-komissio) ja -kin.'), ['(', '-komissio', ')', 'ja', '-kin', '.']);
assert.deepStrictEqual(forms('-ja- sana'), ['-ja-', 'sana']);
assert.deepStrictEqual(forms('a-b c'), ['a-b', 'c']);
assert.deepStrictEqual(forms('10 -20 ja x -5'), ['10', '-', '20', 'ja', 'x', '-', '5'], 'a minus before digits stays punctuation');
assert.deepStrictEqual(forms('- Hei, sanoi hän'), ['-', 'Hei', ',', 'sanoi', 'hän'], 'a spaced dialogue dash is punctuation');

// the analyses the sms/fin transducers give for them
const kept = TagMapper.parse('tuõttvuõtt+N+Cmp/SgNom+Cmp/SplitR', 0, 'sms');
assert.strictEqual(kept.lemma, 'tuõttvuõtt');
assert.deepStrictEqual(kept.cleanTags, ['N', 'Cmp/SgNom', 'Cmp/SplitR']);
const left = TagMapper.parse('+Cmp/SplitL#komissio+N+Pl+Nom', 0, 'sms');
assert.strictEqual(left.lemma, 'komissio', 'the stemless first section adds nothing to the lemma');
assert.deepStrictEqual(left.cleanTags, ['Cmp/SplitL', 'N', 'Pl', 'Nom']);
assert.strictEqual(left.upos, 'NOUN');
assert.strictEqual(left.pos, 'N');
assert.strictEqual(left.feats, 'Case=Nom|Number=Plur');
assert.strictEqual(xposFromAnalysis('+Cmp/SplitL#komissio+N+Pl+Nom'), 'Cmp/SplitL+N+Pl+Nom');
assert.strictEqual(TagMapper.parse('кал#пря+N+Sg+Nom').lemma, 'калпря', 'ordinary compounds are unchanged');
assert.deepStrictEqual(TagMapper.parse('кал#пря+N+Sg+Nom').cleanTags, ['N', 'Sg', 'Nom']);
console.log('✓ hyphen wordforms');
