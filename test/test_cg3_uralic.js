import assert from 'assert';
import fs from 'fs';
import { cg3Service } from '../js/services/cg3-service.js';
import { analyzerService } from '../js/services/analyzer-service.js';
import { TagMapper } from '../js/services/tag-mapper.js';

// UralicNLP's nightly models hold GiellaLT's disambiguator.cg3 per language (and, where they exist, functions.cg3 and
// dependency.cg3). fetchFromUralic keeps them in this browser; a file the user uploaded under the same name wins.
const realFetch = globalThis.fetch;
let served = 'DELIMITERS = "<.>" ;\nLIST Gen = Gen ;\nSECTION\nSELECT Gen ;\n';
const calls = [];
globalThis.fetch = async (url) => {
  const u = String(url).replace(/[?&]_t=\d+$/, '');
  calls.push(u);
  if (/\/nightly\/xx\/disambiguator\.cg3$/.test(u) && u.includes('raw.githubusercontent.com')) return new Response(served, { status: 200 });
  return new Response('Not Found', { status: 404 });
};
try {
  let r = await cg3Service.fetchFromUralic('xx');
  assert.deepStrictEqual(r.added, ['disambiguator.cg3']);
  assert.deepStrictEqual(r.missing, ['functions.cg3', 'dependency.cg3']);
  assert.deepStrictEqual(r.errors, []);
  let g = await cg3Service.getGrammars('xx');
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].source, 'uralic');
  // a missing file is not looked for on every mirror: the repository itself says it is not there
  assert.strictEqual(calls.filter(c => /functions\.cg3$/.test(c)).length, 1, calls.join('\n'));

  // a renewal replaces the UralicNLP copy
  served = 'DELIMITERS = "<.>" ;\nLIST Nom = Nom ;\nSECTION\nSELECT Nom ;\n';
  r = await cg3Service.fetchFromUralic('xx');
  g = await cg3Service.getGrammars('xx');
  assert(g[0].text.includes('SELECT Nom'), g[0].text);

  // the user's own file of the same name is kept
  await cg3Service.saveGrammar('xx', 'disambiguator.cg3', 'DELIMITERS = "<.>" ;\nLIST Pl = Pl ;\nSECTION\nSELECT Pl ;\n');
  r = await cg3Service.fetchFromUralic('xx');
  assert.deepStrictEqual(r.skipped, ['disambiguator.cg3']);
  g = await cg3Service.getGrammars('xx');
  assert(g[0].source === 'upload' && g[0].text.includes('SELECT Pl'));

  // a language UralicNLP has no grammar for
  r = await cg3Service.fetchFromUralic('qq');
  assert.deepStrictEqual(r.added, []);
  assert.strictEqual(r.missing[0], 'disambiguator.cg3');

  // a Git LFS pointer is not a grammar
  globalThis.fetch = async () => new Response('version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 1\n', { status: 200 });
  r = await cg3Service.fetchFromUralic('zz');
  assert.deepStrictEqual(r.added, []);
  assert(r.errors.length > 0);
} finally {
  globalThis.fetch = realFetch;
}

// The cohorts are made from the disambiguation analyser's analyses when the language has one
await cg3Service.saveGrammar('xx', 'disambiguator.cg3', 'DELIMITERS = "<.>" ;\nLIST Gen = Gen ;\nSECTION\nSELECT Gen ;\n');
const own = TagMapper.parse('zzz+N+Sg+Nom', 0, 'xx');
const sents = [{ tokens: [{ form: 'kalan', readings: [own], guessedReadings: [] }] }];
globalThis.fetch = async () => new Response('Not Found', { status: 404 });
try {
  let out = await cg3Service.disambiguate(sents, 'xx');
  assert(out.includes('"zzz"'), out); // no disambiguation analyser: the token's own readings
  assert.strictEqual(cg3Service.lastRun.analyser, 'main');

  const b = fs.readFileSync(new URL('./fixtures/lemma-paradigm/ana.hfstol', import.meta.url));
  await analyzerService.loadDisambFromBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'xx', 'toy disamb', false);
  out = await cg3Service.disambiguate(sents, 'xx');
  assert(out.includes('"kala" N Sg Gen'), out); // the analyser's reading, chosen by the grammar
  assert(!out.includes('"zzz"'), out);
  assert.strictEqual(cg3Service.lastRun.analyser, 'disamb');
} finally {
  globalThis.fetch = realFetch;
}
console.log('✓ UralicNLP CG-3 grammars');
