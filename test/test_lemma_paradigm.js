import fs from 'fs';
import assert from 'assert';
import { HfstInputStream } from '../js/lib/hfst/core.js';
import { enumerateFromLemma } from '../js/lib/hfst/enumerate.js';
import { buildCells, formatCells, orderForms, compareTags, CLITIC_TAG } from '../js/services/lemma-paradigm.js';

// A toy language (test/fixtures/lemma-paradigm/t.lexc), compiled both ways by the HFST tools:
// gen.hfstol analysis -> form, ana.hfstol form -> analysis.
const load = (f) => {
  const b = fs.readFileSync(new URL(`./fixtures/lemma-paradigm/${f}`, import.meta.url));
  return HfstInputStream.fromBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).read();
};
const gen = load('gen.hfstol');
const ana = load('ana.hfstol');
const opts = { allowDer: true, skipTags: CLITIC_TAG, skipAfterDer: /^\+(?:Clt|Foc|Qst|Px)/ };

const fromGen = enumerateFromLemma(gen, 'kala', { ...opts, side: 'input' });
const fromAna = enumerateFromLemma(ana, 'kala', { ...opts, side: 'output' });
assert(!fromGen.truncated && !fromAna.truncated);

const plain = (res) => formatCells(buildCells(res.paths, 'kala'), 'kala');
const expected = [
  'kala+N+Sg+Nom: kala',
  'kala+N+Sg+Gen: kalan',
  'kala+N+Pl+Nom: kalat',
  // normative first: weight 0, then weight 1, then the form of the +Dial/X analysis; +Err/Orth is left out
  'kala+N+Pl+Gen: [kalatojen, kalatain, kalatiden]'
].join('\n');
assert.strictEqual(plain(fromGen), expected, plain(fromGen));
assert.strictEqual(plain(fromAna), expected, plain(fromAna)); // the same read backwards from the analyser

// with derivation: the derived stem and its own inflection come after, the plain view is unchanged
const withDer = formatCells(buildCells(fromGen.paths, 'kala'), 'kala', { derivation: true });
assert(withDer.startsWith(expected + '\n'), withDer);
assert(withDer.includes('kala+N+Der/lainen+A+Sg+Nom: kalalainen'), withDer);
assert(withDer.includes('kala+N+Der/lainen+A+Pl+Gen: [kalalainentojen, kalalainentain, kalalainentiden]'), withDer);

// derivation off: no derived path at all
const noDer = enumerateFromLemma(gen, 'kala', { side: 'input' });
assert(noDer.paths.every(p => !p.tags.some(t => t.startsWith('+Der'))));

// a lemma that is only the beginning of a word (kalat, kalan) or not in the transducer gives nothing
assert.strictEqual(enumerateFromLemma(gen, 'kal', { side: 'input' }).paths.length, 0);
assert.strictEqual(enumerateFromLemma(gen, 'xyz', { side: 'input' }).paths.length, 0);
assert.strictEqual(enumerateFromLemma(ana, 'qqq', { side: 'output' }).paths.length, 0);

// ordering rules by themselves
const e = (surface, weight = 0, variant = 0) => ({ surface, weight, variant });
assert.deepStrictEqual(orderForms([e('b', 1), e('a', 0), e('c', 0, 1)], 'x'), ['a', 'b', 'c']);
assert.deepStrictEqual(orderForms([e('p'), e('q')], 'x'), ['p', 'q']); // no marking: the transducer's order stays
assert.deepStrictEqual(orderForms([e('Кал'), e('кал')], 'кал'), ['кал']); // the capitalised twin goes
assert.deepStrictEqual(orderForms([e('Кал')], 'кал'), ['Кал']); // but is kept when it is the only form
assert.deepStrictEqual(orderForms([e('mõõnam'), e('mõõnam')], 'mõõnnâd'), ['mõõnam']); // o + combining tilde = õ
assert(compareTags(['+N', '+Sg', '+Nom'], ['+N', '+Pl', '+Nom']) < 0);
assert(compareTags(['+N', '+Sg', '+Gen'], ['+N', '+Sg', '+Nom']) > 0);

// the real Erzya analyser, when it is on this machine: all cells of a noun in a few milliseconds
const myv = new URL('../models/analyser-myv.hfstol', import.meta.url);
if (fs.existsSync(myv)) {
  const b = fs.readFileSync(myv);
  const h = HfstInputStream.fromBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).read();
  const r = enumerateFromLemma(h, 'кал', { ...opts, side: 'output' });
  const out = formatCells(buildCells(r.paths, 'кал'), 'кал');
  assert(!r.truncated);
  assert(out.startsWith('кал+N+Sg+Nom+Indef: кал\nкал+N+Sg+Nom+Def: калось'), out.split('\n').slice(0, 3).join('\n'));
}
// the real Skolt Sami normative generator (giellalt/lang-sms), when it is next to this repository: the lemma is on the input side
const smsGen = new URL('../../../giellalt/lang-sms/src/fst/generator-gt-norm.hfstol', import.meta.url);
if (fs.existsSync(smsGen)) {
  const b = fs.readFileSync(smsGen);
  const h = HfstInputStream.fromBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).read();
  const r = enumerateFromLemma(h, 'mõõnnâd', { ...opts, side: 'input' });
  assert(!r.truncated);
  const out = formatCells(buildCells(r.paths, 'mõõnnâd'), 'mõõnnâd');
  assert(out.startsWith('mõõnnâd+V+Ind+Prs+Sg1: mõõnam\nmõõnnâd+V+Ind+Prs+Sg2: mõõnak'), out.split('\n').slice(0, 2).join('\n'));
  assert(out.includes('mõõnnâd+V+Ind+Prt+Pl1: [mõõniim, mõõnim, mõõnin]'));
}
console.log('✓ lemma paradigm');
