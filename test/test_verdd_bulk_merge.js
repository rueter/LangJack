import assert from 'node:assert';
import {
  firstLetter, parseInitials, matchesInitials, bulkTarget, bulkPlan, describeInitials, describeCounts, scanCapitalisedByPos, scanCapitalisedNouns, runBulkMerge, runBulkConvert, VerddApiError
} from '../js/services/verdd-api-service.js';

console.log('=== Bulk merge of capitalised nouns into their Prop twins ===\n');

assert.strictEqual(firstLetter('(Алёша)'), 'А');
assert.strictEqual(firstLetter('123'), '');
assert.deepStrictEqual([...parseInitials('А, б  В')], ['а', 'б', 'в']);
assert.strictEqual(parseInitials('').size, 0);
assert.strictEqual(matchesInitials('Алёша', parseInitials('А')), true);
assert.strictEqual(matchesInitials('алёша', parseInitials('А')), true, 'case of the filter does not matter');
assert.strictEqual(matchesInitials('Борис', parseInitials('А')), false);
assert.strictEqual(matchesInitials('Борис', parseInitials('')), true, 'no letters: every headword');
assert.strictEqual(matchesInitials('(Алёша)', parseInitials('А')), true, 'punctuation before the first letter is skipped');

// letters are told apart by Unicode value; U+ code points work too
assert.strictEqual(matchesInitials('Abraam', parseInitials('А')), false, 'Latin A is not Cyrillic А');
assert.strictEqual(matchesInitials('Абраам', parseInitials('A')), false, 'nor the other way round');
assert.deepStrictEqual([...parseInitials('U+0410 б')], ['а', 'б']);
assert.deepStrictEqual([...parseInitials('U+0031')], [], 'a code point that is not a letter counts for nothing');
assert.strictEqual(describeInitials('А б'), 'А = U+0410, Б = U+0411');
assert.strictEqual(describeInitials('A'), 'A = U+0041');
assert.strictEqual(describeCounts(null), '');

const e = (id, lexeme, pos = 'N') => ({ id, lexeme, language: 'myv', pos, homoId: 0, counts: {}, translations: [] });
const group = (entry, ...candidates) => ({ entry, candidates });

// a single same-headword Prop twin is the bulk target
let t = bulkTarget(group(e(1, 'Алёша'), e(2, 'Алёша', 'Prop')), 'Prop');
assert.strictEqual(t.keeper.id, 2);
assert.strictEqual(bulkTarget(group(e(1, 'Алёша'), e(2, 'Алёша', 'prop')), 'Prop').keeper.id, 2, 'POS compared without case');
// a lower-case or other-POS twin, or a twin with another headword, is not a bulk target
assert.match(bulkTarget(group(e(1, 'Алёша'), e(2, 'алёша', 'N')), 'Prop').reason, /no Prop entry with exactly this headword/);
assert.match(bulkTarget(group(e(1, 'Алёша'), e(2, 'алёша', 'Prop')), 'Prop').reason, /no Prop/);
assert.match(bulkTarget(group(e(1, 'Алёша')), 'Prop').reason, /no Prop/);
// two Prop homonyms: the user chooses
assert.match(bulkTarget(group(e(1, 'Алёша'), e(2, 'Алёша', 'Prop'), e(3, 'Алёша', 'Prop')), 'Prop').reason, /2 Prop entries/);
// the target part of speech is the user's choice
assert.strictEqual(bulkTarget(group(e(1, 'Алёша'), e(2, 'Алёша', 'Pron')), 'Pron').keeper.id, 2);

// no Prop entry of the word at all: the noun itself can simply become Prop
assert.deepStrictEqual(bulkPlan(group(e(1, 'Абраам')), 'Prop'), { kind: 'convert' });
assert.deepStrictEqual(bulkPlan(group(e(1, 'Абраам'), e(2, 'абраам', 'N'), e(3, 'Абраам', 'V')), 'Prop'), { kind: 'convert' }, 'other spellings or POS do not stop it');
assert.strictEqual(bulkPlan(group(e(1, 'Абраам'), e(2, 'Абраам', 'Prop')), 'Prop').kind, 'join', 'a twin: join, never convert');
assert.strictEqual(bulkPlan(group(e(1, 'Абраам'), e(2, 'Абраам', 'Prop'), e(3, 'Абраам', 'Prop')), 'Prop').kind, 'none', 'several twins: the user chooses');
assert.strictEqual(bulkPlan(group(e(1, 'Абраам', 'Prop')), 'Prop').kind, 'none', 'already of that part of speech');

// scanning reads page after page and keeps only the chosen initials
const all = [e(1, 'Алёша'), e(2, 'Анна'), e(3, 'Борис'), e(4, 'Василий'), e(5, 'Алексей')].map(x => group(x, e(x.id + 100, x.lexeme, 'Prop')));
const asked = [];
const api = {
  async mergeCandidates({ language, mode, limit, offset }) {
    asked.push({ language, mode, limit, offset });
    return { total: all.length, groups: all.slice(offset, offset + limit) };
  }
};
const progress = [];
let scan = await scanCapitalisedNouns(api, { language: 'myv', initials: parseInitials('А'), pageSize: 2, onProgress: p => progress.push(p) });
assert.deepStrictEqual(scan.groups.map(g => g.entry.lexeme), ['Алёша', 'Анна', 'Алексей']);
assert.deepStrictEqual(asked.map(a => a.offset), [0, 2, 4], 'all pages are read');
assert.ok(asked.every(a => a.mode === 'capitalised-noun' && a.language === 'myv' && a.limit === 2));
assert.deepStrictEqual(progress.at(-1), { scanned: 5, total: 5, found: 3 });
assert.strictEqual(scan.complete, true);
scan = await scanCapitalisedNouns(api, { language: 'myv', initials: parseInitials('А'), pageSize: 2, shouldStop: (() => { let n = 0; return () => n++ >= 1; })() });
assert.strictEqual(scan.complete, false, 'stopped early');
assert.deepStrictEqual(scan.groups.map(g => g.entry.lexeme), ['Алёша', 'Анна']);
scan = await scanCapitalisedNouns(api, { language: 'myv', pageSize: 100 });
assert.strictEqual(scan.groups.length, 5, 'no letters: everything');

// a source POS other than N: list that POS and find the twins of each capitalised entry
const lex = (id, lexeme, pos) => ({ id, lexeme, language: 'myv', pos, homoId: 0, checked: false });
const store = [lex(1, 'Абраам', 'A'), lex(2, 'Борис', 'A'), lex(3, 'сухо', 'A'), lex(4, 'Алёша', 'A'), lex(5, 'Абраам', 'Prop'), lex(6, 'алёша', 'A')];
const calls2 = [];
const posApi = {
  async searchLexemes({ language, pos, limit, offset }) {
    calls2.push(['search', language, pos, limit, offset]);
    const rows = store.filter(l => l.pos === pos);
    return { total: rows.length, results: rows.slice(offset, offset + limit) };
  },
  async findLexemes({ language, lexeme }) { calls2.push(['find', lexeme]); return store.filter(l => l.lexeme === lexeme); }
};
const byPos = await scanCapitalisedByPos(posApi, { language: 'myv', pos: 'A', initials: parseInitials('А'), pageSize: 2 });
assert.deepStrictEqual(byPos.groups.map(g => g.entry.lexeme), ['Абраам', 'Алёша']);
assert.deepStrictEqual(byPos.groups[0].candidates.map(c => c.id), [5], 'the Prop twin of Абраам');
assert.deepStrictEqual(byPos.groups[1].candidates.map(c => c.id), [6], 'the lower-case twin of Алёша');
assert.strictEqual(byPos.groups[0].entry.counts, null, 'counts are not known on this path');
assert.strictEqual(bulkPlan(byPos.groups[0], 'Prop').kind, 'join');
assert.strictEqual(bulkPlan(byPos.groups[1], 'Prop').kind, 'convert');
assert.deepStrictEqual(calls2.filter(c => c[0] === 'search').map(c => c[4]), [0, 2, 4], 'pages of the chosen POS only (five A entries)');

// bulk run: previews and merges one by one; a refusal does not stop the others
const calls = [];
const mergeApi = {
  async mergeLexeme(absorbed, keeper, options) {
    calls.push({ absorbed, keeper, ...options });
    if (absorbed === 2) throw new VerddApiError('refused', 400, { into: ['The kept entry would become N homonym 0, which entry #9 already is.'] });
    return { moved: { relations: 2 } };
  }
};
const items = [1, 2, 3].map(id => ({ absorbedId: id, keeperId: id + 100, options: { allowDifferentPos: true } }));
const prog = [];
let res = await runBulkMerge(mergeApi, items, { dryRun: true, onProgress: p => prog.push(p.done) });
assert.deepStrictEqual(res.map(r => r.ok), [true, false, true]);
assert.match(res[1].error, /entry #9 already is/);
assert.ok(calls.every(c => c.dryRun === true && c.allowDifferentPos === true), 'previews are dry runs with the options');
assert.deepStrictEqual(prog, [1, 2, 3]);
calls.length = 0;
res = await runBulkMerge(mergeApi, items.filter(i => i.absorbedId !== 2));
assert.ok(calls.every(c => c.dryRun === false));
assert.deepStrictEqual(calls.map(c => c.absorbed), [1, 3]);
res = await runBulkMerge(mergeApi, items, { shouldStop: () => true });
assert.strictEqual(res.length, 0, 'can be stopped');

// bulk convert: one PATCH each, a refusal does not stop the rest
const patched = [];
const convApi = { async updateLexeme(id, fields) { patched.push([id, fields]); if (id === 2) throw new VerddApiError('no', 400, { pos: ['Not a valid POS.'] }); return {}; } };
const conv = await runBulkConvert(convApi, [{ id: 1 }, { id: 2 }, { id: 3 }], { pos: 'Prop' });
assert.deepStrictEqual(patched, [[1, { pos: 'Prop' }], [2, { pos: 'Prop' }], [3, { pos: 'Prop' }]]);
assert.deepStrictEqual(conv.map(r => r.ok), [true, false, true]);
assert.match(conv[1].error, /Not a valid POS/);

console.log('✓ initials, Prop twin choice, paged scan, dry run then merge, refusals do not stop the rest');
