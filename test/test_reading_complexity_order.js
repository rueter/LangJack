import assert from 'node:assert';
import { analyzerService } from '../js/services/analyzer-service.js';
import { readingComplexity } from '../js/services/tag-mapper.js';

console.log('=== Readings are listed simplest first: plain, then +Der, then +Cmp ===\n');

assert.strictEqual(readingComplexity({ raw: 'talo+N+Sg+Nom' }), 0);
assert.strictEqual(readingComplexity({ raw: 'tehdä+V+Der/NomAct+N+Sg+Nom' }), 1);
assert.strictEqual(readingComplexity({ raw: 'talo+N+Cmp#katto+N+Sg+Nom' }), 2);
assert.strictEqual(readingComplexity({ raw: '+Cmp/SplitL#komissio+N+Pl+Nom' }), 2);
assert.strictEqual(readingComplexity({ raw: 'tehdä+V+Der/NomAct+N+Cmp#katto+N+Sg+Nom' }), 3);

// the compound and derived readings have the lowest weights, the plain one the highest
analyzerService.models.set('xxx', {
  lookup: () => [
    ['talo+N+Cmp#katto+N+Sg+Nom', 0.1],
    ['tehdä+V+Der/NomAct+N+Sg+Nom', 0.2],
    ['talo+N+Der/inen+A+Sg+Nom', 0.3],
    ['talo+N+Sg+Nom', 5],
    ['talo+N+Cmp/SgNom+Cmp#katto+N+Sg+Nom', 0.05]
  ]
});
const raws = analyzerService.analyze_word('talokatto', 'xxx').map((r) => r.raw);
assert.deepStrictEqual(raws, [
  'talo+N+Sg+Nom',
  'tehdä+V+Der/NomAct+N+Sg+Nom',
  'talo+N+Der/inen+A+Sg+Nom',
  'talo+N+Cmp/SgNom+Cmp#katto+N+Sg+Nom',
  'talo+N+Cmp#katto+N+Sg+Nom'
]);
console.log('✓ plain, derived, compound; weight decides within each group');
