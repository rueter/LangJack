import assert from 'node:assert';
import {
  firstLetter, parseInitials, matchesInitials, bulkTarget, scanCapitalisedNouns, runBulkMerge, VerddApiError
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

console.log('✓ initials, Prop twin choice, paged scan, dry run then merge, refusals do not stop the rest');
