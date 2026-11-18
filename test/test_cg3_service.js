import { cg3Service, splitLangPrefix, grammarRank } from '../js/services/cg3-service.js';
import { TagMapper } from '../js/services/tag-mapper.js';
import assert from 'assert';
import fs from 'fs';

const r = (raw) => TagMapper.parse(raw, 0, 'sms');
const sents = [{ tokens: [
  { form: 'mõõnnem', readings: [r('mõõnnâd+V+Ind+Prs+Sg1'), r('mõõnnâd+V+Ind+Prs+Pl1')], guessedReadings: [] },
  { form: '.', readings: [{ raw: '.+CLB', isPunct: true }] }
] }];

// language prefix in the file name
assert.deepStrictEqual(splitLangPrefix('myv_disambiguator.cg3'), { lang: 'myv', base: 'disambiguator.cg3' });
assert.deepStrictEqual(splitLangPrefix('sms-functions.cg3'), { lang: 'sms', base: 'functions.cg3' });
assert.deepStrictEqual(splitLangPrefix('disambiguator.cg3'), { lang: null, base: 'disambiguator.cg3' });
assert.deepStrictEqual(splitLangPrefix('functions.cg3'), { lang: null, base: 'functions.cg3' });
assert(grammarRank('myv_disambiguator.cg3') < grammarRank('myv_functions.cg3') && grammarRank('myv_functions.cg3') < grammarRank('myv_dependency.cg3'));

// no grammar yet
assert.strictEqual(await cg3Service.hasGrammar('sms'), false);
assert.strictEqual(await cg3Service.disambiguate(sents, 'sms'), null);

// a grammar of your own: select the singular reading
await cg3Service.saveGrammar('xx', 'g.cg3', 'DELIMITERS = "<.>" ;\nLIST Sg1 = Sg1 ;\nSECTION\nSELECT Sg1 ;\n');
const xs = [{ tokens: [{ form: 'a', readings: [r('a+V+Sg1'), r('a+V+Pl1')], guessedReadings: [] }] }];
const out = await cg3Service.disambiguate(xs, 'xx');
assert(out.includes('Sg1') && !out.includes('Pl1'), out);

// trace (-t): the rule that selected the reading is named, as RULE:line
const tr = await cg3Service.disambiguate(xs, 'xx', { trace: true });
assert(/Sg1 <W:0\.0> SELECT:\d+/.test(tr), tr);
assert(!/SELECT:\d+/.test(out));

// -p: the removed reading stays, marked with ";" and the rule that removed it
await cg3Service.saveGrammar('xx', 'g.cg3', 'DELIMITERS = "<.>" ;\nLIST Pl1 = Pl1 ;\nSECTION\nREMOVE Pl1 ;\n');
const dl = await cg3Service.disambiguate(xs, 'xx', { trace: true, showDeleted: true });
assert(/^;\t"a" V Pl1 <W:0\.0> REMOVE:\d+/m.test(dl), dl);
assert(!/Pl1/.test(await cg3Service.disambiguate(xs, 'xx')));
assert(!/^;/m.test(await cg3Service.disambiguate(xs, 'xx', { trace: true })));

// chains: files are put in disambiguator, functions, dependency order whatever the order they come in; upTo shows one stage
await cg3Service.removeGrammar('xx', 'g.cg3');
await cg3Service.saveGrammar('xx', 'dependency.cg3', 'DELIMITERS = "<.>" ;\nLIST V = V ;\nSECTION\nSUBSTITUTE (V) (DEPX) V ;\n');
await cg3Service.saveGrammar('xx', 'functions.cg3', 'DELIMITERS = "<.>" ;\nLIST V = V ;\nSECTION\nADD (@FUNC) V ;\n');
await cg3Service.saveGrammar('xx', 'disambiguator.cg3', 'DELIMITERS = "<.>" ;\nLIST Pl1 = Pl1 ;\nSECTION\nREMOVE Pl1 ;\n');
assert.deepStrictEqual((await cg3Service.getGrammars('xx')).map(g => g.name), ['disambiguator.cg3', 'functions.cg3', 'dependency.cg3']);
const all = await cg3Service.disambiguate(xs, 'xx');
assert(all.includes('@FUNC') && all.includes("DEPX") && !all.includes('Pl1'), all);
const upTo = await cg3Service.disambiguate(xs, 'xx', { upTo: 'functions.cg3' });
assert(upTo.includes('@FUNC') && !upTo.includes("DEPX"), upTo);
const t1 = await cg3Service.disambiguate(xs, 'xx', { upTo: 'disambiguator.cg3', trace: true, showDeleted: true });
assert(/^;.*REMOVE:/m.test(t1) && !t1.includes('@FUNC'), t1);
for (const n of ['disambiguator.cg3', 'functions.cg3', 'dependency.cg3']) await cg3Service.removeGrammar('xx', n);
await cg3Service.saveGrammar('xx', 'g.cg3', 'DELIMITERS = "<.>" ;\nLIST Sg1 = Sg1 ;\nSECTION\nSELECT Sg1 ;\n');

// replacing a grammar of the same name keeps one entry; removing empties
await cg3Service.saveGrammar('xx', 'g.cg3', 'DELIMITERS = "<.>" ;\n');
assert.strictEqual((await cg3Service.getGrammars('xx')).length, 1);
await cg3Service.removeGrammar('xx', 'g.cg3');
assert.strictEqual(await cg3Service.hasGrammar('xx'), false);

// a compiled grammar and an empty file are refused
await assert.rejects(() => cg3Service.saveGrammar('xx', 'd.bin', 'CG3B\x00\x01'), /\.cg3 source/);
await assert.rejects(() => cg3Service.saveGrammar('xx', 'e.cg3', '  \n'), /empty/);

// the real Skolt Sami grammar, when it is on this machine
const p = '/Users/jackrueter/Desktop/Github/giellalt/lang-sms/src/cg3/disambiguator.cg3';
if (fs.existsSync(p)) {
  await cg3Service.saveGrammar('sms', 'disambiguator.cg3', fs.readFileSync(p, 'utf8'));
  const res = await cg3Service.disambiguate(sents, 'sms');
  assert(res.startsWith('"<mõõnnem>"') && res.includes('<sms>'), res);
  console.log(res);
  await cg3Service.removeGrammar('sms', 'disambiguator.cg3');
}
console.log('✓ CG3 service');
