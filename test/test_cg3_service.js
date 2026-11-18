import { cg3Service } from '../js/services/cg3-service.js';
import { TagMapper } from '../js/services/tag-mapper.js';
import assert from 'assert';
import fs from 'fs';

const r = (raw) => TagMapper.parse(raw, 0, 'sms');
const sents = [{ tokens: [
  { form: 'mõõnnem', readings: [r('mõõnnâd+V+Ind+Prs+Sg1'), r('mõõnnâd+V+Ind+Prs+Pl1')], guessedReadings: [] },
  { form: '.', readings: [{ raw: '.+CLB', isPunct: true }] }
] }];

// no grammar yet
assert.strictEqual(await cg3Service.hasGrammar('sms'), false);
assert.strictEqual(await cg3Service.disambiguate(sents, 'sms'), null);

// a grammar of your own: select the singular reading
await cg3Service.saveGrammar('xx', 'g.cg3', 'DELIMITERS = "<.>" ;\nLIST Sg1 = Sg1 ;\nSECTION\nSELECT Sg1 ;\n');
const xs = [{ tokens: [{ form: 'a', readings: [r('a+V+Sg1'), r('a+V+Pl1')], guessedReadings: [] }] }];
const out = await cg3Service.disambiguate(xs, 'xx');
assert(out.includes('Sg1') && !out.includes('Pl1'), out);

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
