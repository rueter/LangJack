import assert from 'node:assert';
import {
  VerddApi, VerddApiError, describeApiError, normalizeBaseUrl, ensureOriginPermission,
  toVerddPos, newRow, draftsFromSentences, validateRow, rowToPairPayload,
  homoState, nextHomoId, checkRow, blockingReasons, sendRows,
  loadVerddConfig, saveVerddConfig, describeCounts, describeMerge,
  isUndetermined, tidyHeadword, mergeVerdict, findTwins, describeById, findEditCollision, describeSplit,
  signInToVerdd, describeAccess
} from '../js/services/verdd-api-service.js';

// A fetch stand-in: routes are matched by "METHOD /path" and may be a value or a function.
function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers, init });
    const handler = routes[`${init.method} ${u.pathname}`];
    if (handler === undefined) return { ok: false, status: 404, text: async () => 'Not Found' };
    const out = typeof handler === 'function' ? handler(calls.at(-1)) : handler;
    const status = out?.status ?? 200;
    return { ok: status < 400, status, text: async () => (out?.body === undefined ? '' : JSON.stringify(out.body)) };
  };
  return { fetchImpl, calls };
}
const apiWith = (routes) => {
  const mock = mockFetch(routes);
  return { api: new VerddApi({ baseUrl: 'verdd.example.org/verdd/', token: ' tok ', fetchImpl: mock.fetchImpl }), calls: mock.calls };
};
const page = (results) => ({ body: { count: results.length, next: null, previous: null, results } });

console.log('=== 1. POS mapping ===');
for (const tag of ['N', 'Prop', 'V', 'Aux', 'A', 'Adv', 'Pron', 'Num', 'Po', 'Pr', 'CC', 'CS', 'Pcle', 'Interj', 'Det']) {
  assert.strictEqual(toVerddPos(tag), tag, `${tag} is kept as its own Ve'rdd POS`);
}
assert.strictEqual(toVerddPos('Sym'), 'UND', 'what cannot be determined is UND');
assert.strictEqual(toVerddPos('CLB'), 'UND');
assert.strictEqual(toVerddPos(''), 'UND');
assert.strictEqual(toVerddPos('constructor'), 'UND');
assert.strictEqual(toVerddPos('X'), 'UND', 'X is reserved in Ve\'rdd for recycled words');
assert.strictEqual(toVerddPos('x', ['X', 'N']), 'UND', 'even when Ve\'rdd already lists X');
assert.strictEqual(toVerddPos('adv', ['Adv', 'N']), 'Adv', 'unmapped tags fall back to a case-insensitive match on Ve\'rdd\'s list');
assert.strictEqual(toVerddPos('Po', ['PO']), 'PO', 'prefers the spelling Ve\'rdd already uses');
assert.strictEqual(toVerddPos('Prop', ['N', 'Prop']), 'Prop');
console.log('✓ POS mapping');

console.log('=== 2. Address handling ===');
assert.strictEqual(normalizeBaseUrl('verdd.example.org/verdd/'), 'https://verdd.example.org/verdd');
assert.strictEqual(normalizeBaseUrl('https://h.org/verdd/api/v1/'), 'https://h.org/verdd');
assert.strictEqual(normalizeBaseUrl('localhost:8000'), 'http://localhost:8000');
assert.strictEqual(normalizeBaseUrl('  '), '');
const asked = [];
const perms = { contains: async () => false, request: async (q) => { asked.push(q); return true; } };
assert.strictEqual(await ensureOriginPermission('https://h.org/verdd', perms), true);
assert.deepStrictEqual(asked, [{ origins: ['https://h.org/*'] }]);
assert.strictEqual(await ensureOriginPermission('https://h.org', null), true, 'no permissions API (PWA) means nothing to ask');
const memory = new Map();
const store = { getSetting: async (k, d) => memory.get(k) ?? d, setSetting: async (k, v) => memory.set(k, v) };
await saveVerddConfig(store, { baseUrl: 'h.org/verdd/', token: ' abc ' });
assert.deepStrictEqual(await loadVerddConfig(store), { baseUrl: 'https://h.org/verdd', token: 'abc' });
console.log('✓ address, permission and settings handling');

console.log('=== 3. Draft rows from an analysed workspace ===');
const sentences = [{
  text: 'Muõrr lij nåkam.',
  tokens: [
    { form: 'Muõrr', lemma: 'muõrr', selectedReading: { pos: 'N' }, selectedGloss: { gloss: 'puu', lang: 'fin' } },
    { form: 'lij', lemma: 'leeʹd', selectedReading: { pos: 'V', isGuessed: true }, customGloss: 'olla', customGlossLang: 'fin' },
    { form: 'Helsinki', lemma: 'Helsinki', selectedReading: { pos: 'Prop' }, selectedGloss: { gloss: 'Helsinki', lang: 'fin' } },
    { form: '?', lemma: '?', isPunct: true },
    { form: 'xx', lemma: 'xx', selectedReading: { pos: 'X' } }
  ]
}];
const rows = draftsFromSentences(sentences, [{ lang: 'eng', text: 'The tree is such.' }, { lang: 'fin', text: 'Puu on sellainen.' }], 'SMS', 'eng', ['N', 'V']);
assert.strictEqual(rows.length, 4, 'punctuation skipped');
assert.deepStrictEqual(rows.map(r => r.pos), ['N', 'V', 'Prop', 'UND'], 'Prop is kept; an unanalysed word becomes UND, never X');
assert.strictEqual(validateRow(rows[3], { languages: null }).some(p => p.field === 'pos'), false, 'UND satisfies the POS requirement');
assert.strictEqual(rows[0].srcLang, 'sms');
assert.strictEqual(rows[0].exTgt, 'Puu on sellainen.', 'example translation chosen in the gloss language');
assert.strictEqual(rows[1].guessed, true, 'guessed readings are flagged, not hidden');
assert.strictEqual(rows[3].tgtLang, 'eng', 'falls back to the default target language');
assert.strictEqual(rows[3].exTgt, 'The tree is such.');
assert.strictEqual(draftsFromSentences(sentences, [], 'sms', 'all').at(-1).tgtLang, '', 'target "all" leaves the language to the user');
console.log('✓ drafts');

console.log('=== 4. Validation: POS is required, homoId only when given ===');
const complete = newRow({ srcLang: 'sms', lemma: 'muõrr', pos: 'N', tgtLang: 'fin', translation: 'puu' });
assert.deepStrictEqual(validateRow(complete), []);
assert.deepStrictEqual(validateRow({ ...complete, pos: '  ' }).map(p => p.field), ['pos']);
assert.deepStrictEqual(validateRow({ ...complete, srcHomoId: -1 }).map(p => p.field), ['srcHomoId']);
assert.deepStrictEqual(validateRow({ ...complete, srcHomoId: 1, tgtHomoId: '' }), []);
assert.ok(validateRow({ ...complete, tgtLang: 'sms' }).some(p => p.field === 'tgtLang'));
assert.ok(validateRow({ ...complete, translation: '', exSrc: 'Muõrr.' }).some(p => p.field === 'translation'), 'examples need a relation to hang on');
assert.ok(validateRow({ ...complete, exTgt: 'Puu.' }).some(p => p.field === 'exSrc'));
assert.ok(validateRow({ ...complete, exSrc: 'x'.repeat(251) }).some(p => p.field === 'exSrc'));
assert.ok(validateRow(complete, { languages: ['fin'] }).some(p => p.field === 'srcLang'), 'unknown languages are caught before sending');
const wordOnly = newRow({ srcLang: 'sms', lemma: 'muõrr', pos: 'N' });
assert.deepStrictEqual(validateRow(wordOnly), [], 'a word without a translation is valid');
console.log('✓ validation');

console.log('=== 5. Pair payload ===');
assert.deepStrictEqual(rowToPairPayload(complete), {
  source: { lexeme: 'muõrr', language: 'sms', pos: 'N' },
  target: { lexeme: 'puu', language: 'fin' }
});
const full = rowToPairPayload({ ...complete, srcHomoId: 1, tgtHomoId: 0, tgtPos: 'N', exSrc: ' Muõrr. ', exTgt: 'Puu.', exSource: 'https://e.org/p' });
assert.deepStrictEqual(full.source, { lexeme: 'muõrr', language: 'sms', pos: 'N', homoId: 1 });
assert.deepStrictEqual(full.target, { lexeme: 'puu', language: 'fin', pos: 'N', homoId: 0 });
assert.deepStrictEqual(full.examples, [{ source_text: 'Muõrr.', target_text: 'Puu.', source: 'https://e.org/p' }]);
assert.strictEqual(rowToPairPayload({ ...complete, exSrc: 'a', exSource: 'h://' + 'x'.repeat(260) }).examples[0].source, undefined);
console.log('✓ payload');

console.log('=== 6. Homonym states ===');
const one = [{ id: 1, homoId: 0 }];
const two = [{ id: 1, homoId: 0 }, { id: 2, homoId: 1 }];
assert.strictEqual(homoState([], null), 'new');
assert.strictEqual(homoState(one, null), 'reuse');
assert.strictEqual(homoState(two, null), 'choose');
assert.strictEqual(homoState(two, 1), 'chosen');
assert.strictEqual(homoState(one, 1), 'newHomonym');
assert.strictEqual(nextHomoId(two), 2);
assert.strictEqual(nextHomoId([]), 0);
console.log('✓ homonym states');

console.log('=== 7. Client: auth, errors ===');
{
  const { api, calls } = apiWith({
    'GET /verdd/api/v1/me/': { body: { username: 'jack' } },
    'GET /verdd/api/v1/pos/': { status: 401, body: { detail: 'Invalid token.' } },
    'GET /verdd/api/v1/languages/': { status: 403, body: { detail: 'nope' } },
    'GET /verdd/api/v1/lexemes/7/': { status: 429, body: '<html>429 Too Many Requests</html>' },
    'POST /verdd/api/v1/lexemes/': { status: 400, body: { pos: ['This field is required.'], non_field_errors: ['The fields lexeme, pos must make a unique set.'] } }
  });
  assert.deepStrictEqual(await api.me(), { username: 'jack' });
  assert.strictEqual(calls[0].headers.Authorization, 'Token tok');
  assert.strictEqual(calls[0].init.credentials, 'omit');
  await assert.rejects(api.pos(), (e) => e.status === 401 && /token/i.test(e.message));
  await assert.rejects(api.languages(), (e) => e.status === 403 && /staff/.test(e.message));
  await assert.rejects(api.getLexeme(7), (e) => e.status === 429 && /Wait a few seconds/.test(e.message) && !/html/i.test(e.message));
  await assert.rejects(api.createLexeme({}), (e) => e instanceof VerddApiError && e.message.includes('pos: This field is required.') && e.message.includes('unique set'));
  await assert.rejects(api.getLexeme(1), (e) => e.status === 404 && /root address/.test(e.message));
  const down = new VerddApi({ baseUrl: 'https://h.org', token: 't', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(down.me(), (e) => e.status === 0 && /Cannot reach/.test(e.message));
  await assert.rejects(new VerddApi({ baseUrl: '', token: '' }).me(), /Connection tab/);
}
assert.strictEqual(describeApiError({ source: ['Several homonyms match (ids 1, 2)'], examples: [{ source_text: ['Too long.'] }] }), 'source: Several homonyms match (ids 1, 2); examples.source_text: Too long.');
console.log('✓ client');

console.log('=== 8. Check + send flow ===');
{
  const pairResult = (over = {}) => ({ ok: true, created: true, source: { id: 10, web_url: '/lexeme/10/' }, target: { id: 11 }, relation: { id: 5 }, examples: [], ...over });
  const { api, calls } = apiWith({
    'GET /verdd/api/v1/lexemes/': (call) => {
      const { language, lexeme } = call.query;
      if (lexeme === 'leeʹd') return page([{ id: 1, homoId: 0, checked: true, notes: '' }, { id: 2, homoId: 1, checked: false, notes: '' }]);
      if (lexeme === 'muõrr') return page([{ id: 3, homoId: 0, checked: true, notes: '' }]);
      return page([]);
    },
    'GET /verdd/api/v1/relations/': (call) => page(call.query.lexeme_from === '1' ? [{ lexeme_to_info: { lexeme: 'olla' } }] : []),
    'POST /verdd/api/v1/pairs/bulk/': (call) => ({
      body: { results: call.body.pairs.map(p => (p.source.lexeme === 'bad'
        ? { ok: false, errors: { source: ['Several homonyms match (ids 8, 9); send homoId to choose one.'] } }
        : pairResult({ created: p.source.lexeme !== 'muõrr', examples: p.examples || [] }))) }
    }),
    'POST /verdd/api/v1/lexemes/': () => ({ status: 201, body: { id: 77, web_url: '/lexeme/77/' } })
  });

  const pair = newRow({ srcLang: 'sms', lemma: 'muõrr', pos: 'N', tgtLang: 'fin', translation: 'puu', exSrc: 'Muõrr.', exTgt: 'Puu.' });
  const homonyms = newRow({ srcLang: 'sms', lemma: 'leeʹd', pos: 'V', tgtLang: 'fin', translation: 'olla' });
  const word = newRow({ srcLang: 'sms', lemma: 'kuõʹsk', pos: 'N' });
  const rejected = newRow({ srcLang: 'sms', lemma: 'bad', pos: 'N', tgtLang: 'fin', translation: 'x' });

  for (const row of [pair, homonyms, word]) await checkRow(api, row);
  assert.strictEqual(homoState(pair.srcMatches, pair.srcHomoId), 'reuse');
  assert.strictEqual(homoState(homonyms.srcMatches, homonyms.srcHomoId), 'choose');
  assert.deepStrictEqual(homonyms.srcMatches[0].translations, ['olla'], 'candidates show their translations to tell them apart');
  assert.ok(blockingReasons(homonyms).some(r => /homonyms of the headword/.test(r)));
  assert.deepStrictEqual(blockingReasons(pair), []);
  const lookups = calls.filter(c => c.path.endsWith('/lexemes/') && c.query.lexeme === 'puu');
  assert.strictEqual(lookups[0].query.pos, 'N', 'the translation is looked up under the headword POS unless overridden');

  homonyms.srcHomoId = nextHomoId(homonyms.srcMatches);
  assert.strictEqual(homoState(homonyms.srcMatches, homonyms.srcHomoId), 'newHomonym');
  assert.deepStrictEqual(blockingReasons(homonyms), []);

  const outcome = await sendRows(api, [pair, homonyms, word, rejected]);
  assert.deepStrictEqual(outcome, { sent: 3, failed: 1 });
  assert.strictEqual(pair.status, 'sent');
  assert.match(pair.message, /Already in Ve'rdd \+ 1 example/);
  assert.strictEqual(homonyms.message.startsWith('Stored'), true);
  const bulk = calls.find(c => c.path.endsWith('/pairs/bulk/'));
  assert.strictEqual(bulk.body.pairs[1].source.homoId, 2, 'the chosen new homonym number is sent');
  assert.strictEqual(word.status, 'sent');
  assert.strictEqual(word.sourceId, 77);
  assert.deepStrictEqual(calls.find(c => c.path.endsWith('/lexemes/') && c.method === 'POST').body, { lexeme: 'kuõʹsk', language: 'sms', pos: 'N' });
  assert.strictEqual(rejected.status, 'error');
  assert.match(rejected.message, /Several homonyms match/);

  const existing = newRow({ srcLang: 'sms', lemma: 'muõrr', pos: 'N' });
  await checkRow(api, existing);
  const postsBefore = calls.filter(c => c.method === 'POST' && c.path.endsWith('/lexemes/')).length;
  await sendRows(api, [existing]);
  assert.strictEqual(existing.message, "Already in Ve'rdd");
  assert.strictEqual(calls.filter(c => c.method === 'POST' && c.path.endsWith('/lexemes/')).length, postsBefore, 'an existing word is not created twice');
}
{
  const down = new VerddApi({ baseUrl: 'https://h.org', token: 't', fetchImpl: async () => { throw new TypeError('x'); } });
  const row = newRow({ srcLang: 'sms', lemma: 'a', pos: 'N', tgtLang: 'fin', translation: 'b' });
  assert.deepStrictEqual(await sendRows(down, [row]), { sent: 0, failed: 1 });
  assert.match(row.message, /Cannot reach/);
}
console.log('✓ check and send');

console.log('=== 9. Merging undetermined entries ===');
{
  const { api, calls } = apiWith({
    'GET /verdd/api/v1/lexemes/merge-candidates/': { body: { count: 12, results: [{ undetermined: { id: 7 }, candidates: [{ id: 12 }] }] } },
    'POST /verdd/api/v1/lexemes/7/merge/': (call) => ({ body: { dry_run: call.body.dry_run, moved: { relations: 1 } } }),
    'POST /verdd/api/v1/lexemes/9/merge/': { status: 400, body: { into: ['Only lexemes of the same language can be merged.'] } }
  });
  const page2 = await api.mergeCandidates({ language: 'sms', limit: 10, offset: 10 });
  assert.deepStrictEqual(page2, { total: 12, groups: [{ undetermined: { id: 7 }, candidates: [{ id: 12 }] }] });
  assert.deepStrictEqual(calls[0].query, { language: 'sms', limit: '10', offset: '10' });
  // capitalised nouns of one language: the mode goes to the server, groups are { entry, candidates }
  const caps = apiWith({ 'GET /verdd/api/v1/lexemes/merge-candidates/': { body: { count: 1, results: [{ entry: { id: 3 }, candidates: [{ id: 4 }] }] } } });
  assert.deepStrictEqual(await caps.api.mergeCandidates({ language: 'fin', mode: 'capitalised-noun' }), { total: 1, groups: [{ entry: { id: 3 }, candidates: [{ id: 4 }] }] });
  assert.deepStrictEqual(caps.calls[0].query, { language: 'fin', mode: 'capitalised-noun', limit: '10', offset: '0' });
  assert.strictEqual((await api.mergeLexeme(7, 12, { dryRun: true })).dry_run, true);
  assert.deepStrictEqual(calls[1].body, { into: 12, dry_run: true });
  assert.strictEqual((await api.mergeLexeme(7, 12)).dry_run, false, 'a real merge must not be a dry run by default');
  await assert.rejects(api.mergeLexeme(9, 12), /same language/);
}
assert.strictEqual(describeCounts({ relations_from: 2, relations_to: 1, examples: 1, metadata: 0, stems: 2 }), '3 relations, 1 example, 2 stems');
assert.strictEqual(describeCounts({ relations_from: 0, examples: 0 }), 'empty');
assert.deepStrictEqual(describeMerge({ moved: {}, deduplicated: {}, dropped: {}, fields_copied: [], notes: [], keeper_unapproved: false }),
  ['Nothing to move: the absorbed entry is empty.']);
assert.deepStrictEqual(describeMerge({
  moved: { relations: 2, examples: 1 }, deduplicated: { relations: 1 }, dropped: { relations_between_the_two: 2 },
  fields_copied: ['contlex'], notes: ["notes: kept 'a', the absorbed entry had 'b'."], keeper_unapproved: true
}), [
  'Moves 2 relations to the kept entry.',
  'Moves 1 example to the kept entry.',
  'Folds 1 relation into what the kept entry already has.',
  'Drops 2 relations between the two entries (they would point an entry at itself).',
  "Fills the kept entry's empty contlex.",
  "notes: kept 'a', the absorbed entry had 'b'.",
  'The kept entry becomes unapproved so it is reviewed again.'
]);
assert.deepStrictEqual(describeMerge({
  moved: {}, deduplicated: {}, dropped: {}, fields_copied: [], notes: [], keeper_unapproved: true,
  headword_dropped: '( ) пӧла', pos_set: 'N'
}), [
  'The headword "( ) пӧла" is dropped; the kept entry keeps its own.',
  'The kept entry has no part of speech yet, so it becomes N.',
  'The kept entry becomes unapproved so it is reviewed again.'
]);
assert.deepStrictEqual(describeMerge({
  moved: { relations: 1 }, deduplicated: {}, dropped: {}, fields_copied: ['notes'], notes: [], keeper_unapproved: true,
  pos_dropped: 'N', into: { pos: 'V' }
}), [
  'Moves 1 relation to the kept entry.',
  'The part of speech N of the absorbed entry is dropped; the kept entry stays V.',
  "Fills the kept entry's empty notes.",
  'The kept entry becomes unapproved so it is reviewed again.'
]);
console.log('✓ merge helpers');

console.log('=== 10. Editing, merging and splitting any entry ===');
for (const pos of ['', 'ZERO', 'UND', ' UND ', null, undefined]) assert.ok(isUndetermined(pos), `${JSON.stringify(pos)} is undetermined`);
for (const pos of ['N', 'V', 'X', 'Prop']) assert.ok(!isUndetermined(pos), `${pos} is determined`);

const tidy = {
  '( ) пӧла': 'пӧла', '(пӧла)': 'пӧла', '(…) пӧла': 'пӧла', '(...) пӧла': 'пӧла', '[ ] пӧла': 'пӧла',
  '( - ) пӧла': 'пӧла', '  пӧла  ': 'пӧла', 'пӧла ( )': 'пӧла', 'пӧла': 'пӧла',
  'пӧла (3)': 'пӧла (3)', '(a) (b)': '(a) (b)', 'кӧрт-пӧла': 'кӧрт-пӧла', '- пӧла': '- пӧла', '( )': ''
};
for (const [input, expected] of Object.entries(tidy)) assert.strictEqual(tidyHeadword(input), expected, `tidy ${JSON.stringify(input)}`);
assert.strictEqual(tidyHeadword(null), '');

const entry = (id, lexeme, pos, extra = {}) => ({ id, lexeme, pos, language: 'kpv', homoId: 0, checked: false, ...extra });
assert.deepStrictEqual(mergeVerdict(entry(1, '( ) пӧла', 'UND'), entry(2, 'пӧла', 'N')), { ok: true, differentHeadword: true, differentPos: false, takesPos: false });
assert.deepStrictEqual(mergeVerdict(entry(1, 'пӧла', 'N'), entry(2, 'пӧла', 'N', { homoId: 1 })), { ok: true, differentHeadword: false, differentPos: false, takesPos: false });
assert.deepStrictEqual(mergeVerdict(entry(1, 'пӧла', 'N'), entry(2, 'пӧла', 'ZERO')), { ok: true, differentHeadword: false, differentPos: false, takesPos: true });
assert.match(mergeVerdict(entry(1, 'пӧла', 'N'), entry(2, 'пӧла', 'V')).reason, /different parts of speech \(N and V\)/);
assert.match(mergeVerdict(entry(1, 'пӧла', 'N'), entry(2, 'пӧла', 'V')).reason, /set it to match the other and press Save/);
assert.deepStrictEqual(mergeVerdict(entry(1, 'саевемс', 'N'), entry(2, 'саевемс', 'V'), { allowDifferentPos: true }),
  { ok: true, differentHeadword: false, differentPos: true, takesPos: false }, 'the user chose the other entry\'s POS, so the wrong one may be dropped');
assert.ok(!mergeVerdict(entry(1, 'a', 'N'), entry(2, 'a', 'N', { language: 'fin' }), { allowDifferentPos: true }).ok, 'the option waives only the POS rule');
assert.match(mergeVerdict(entry(1, 'a', 'N'), entry(1, 'a', 'N')).reason, /itself/);
assert.match(mergeVerdict(entry(1, 'a', 'N'), entry(2, 'a', 'N', { language: 'fin' })).reason, /same language/);

{
  const stored = [entry(2105645, '( ) пӧла', 'UND'), entry(704954, 'пӧла', 'N', { checked: true }), entry(9, 'пӧла', 'V', { homoId: 1 }), entry(8, 'пӧла', 'N', { language: 'fin' })];
  const { api, calls } = apiWith({
    'GET /verdd/api/v1/lexemes/': (call) => page(stored.filter(l => l.language === call.query.language && l.lexeme === call.query.lexeme && (!call.query.pos || l.pos === call.query.pos))),
    'GET /verdd/api/v1/relations/': { body: { count: 1, results: [{ lexeme_to_info: { lexeme: 'борт' } }] } },
    'GET /verdd/api/v1/lexemes/704954/': { body: stored[1] }
  });

  const twins = await findTwins(api, stored[0]);
  assert.deepStrictEqual(twins.map(t => t.id), [704954, 9], 'the tidied headword finds the clean entries of the same language');
  assert.deepStrictEqual(twins[0].translations, ['борт']);
  assert.ok(twins.every(t => t.id !== 2105645), 'the entry is not its own twin');
  const clean = await findTwins(api, stored[1]);
  assert.deepStrictEqual(clean.map(t => t.id), [9], 'a clean headword is looked up once');
  assert.strictEqual((await describeById(api, 704954)).lexeme, 'пӧла');

  assert.strictEqual(await findEditCollision(api, stored[0], {}), null, 'no change, no collision');
  assert.strictEqual(await findEditCollision(api, stored[0], { lexeme: 'пӧла', pos: 'UND', homoId: 0 }), null, 'a different POS is a different entry');
  const clash = await findEditCollision(api, stored[0], { lexeme: 'пӧла', pos: 'N', homoId: 0 });
  assert.strictEqual(clash.id, 704954, 'same headword, POS and homonym is the existing entry');
  assert.strictEqual(await findEditCollision(api, stored[0], { lexeme: 'пӧла', pos: 'N', homoId: 3 }), null, 'a free homonym number does not collide');
  assert.strictEqual(await findEditCollision(api, stored[1], { lexeme: 'пӧла', pos: 'N', homoId: 0 }), null, 'an entry does not collide with itself');
  assert.ok(calls.length > 0);
}

{
  const { api, calls } = apiWith({
    'POST /verdd/api/v1/lexemes/5/merge/': (call) => ({ body: { dry_run: call.body.dry_run } }),
    'POST /verdd/api/v1/lexemes/5/split/': (call) => ({ status: call.body.dry_run ? 200 : 201, body: { moved: { relations: 1 }, new: { id: call.body.dry_run ? null : 99 } } }),
    'GET /verdd/api/v1/examples/': { body: { count: 1, results: [{ id: 4, text: 'Пӧла.' }] } }
  });
  await api.mergeLexeme(5, 6, { dryRun: true, allowDifferentHeadword: true, allowDifferentPos: true });
  assert.deepStrictEqual(calls[0].body, { into: 6, dry_run: true, allow_different_headword: true, allow_different_pos: true });
  assert.deepStrictEqual((await api.lexemeExamples(5)).map(e => e.id), [4]);
  assert.deepStrictEqual(calls[1].query, { lexeme: '5', limit: '200' });

  await api.splitLexeme(5, { relations: [1, 2], examples: [4], dryRun: true, lexeme: '', pos: 'V', homoId: 2 });
  assert.deepStrictEqual(calls[2].body, { relations: [1, 2], examples: [4], dry_run: true, pos: 'V', homoId: 2 },
    'blank fields are left out so the server applies its defaults');
  assert.strictEqual((await api.splitLexeme(5, { relations: [1] })).new.id, 99);
  assert.strictEqual(calls[3].body.dry_run, false, 'a real split must not be a dry run by default');
}

assert.deepStrictEqual(describeSplit({ moved: { relations: 2, mirror_relations: 1, examples: 1 }, notes: ['Nothing is left on the original entry.'], source_unapproved: true }), [
  'Moves 2 relations to the new entry.',
  'Moves 1 mirrored relation to the new entry.',
  'Moves 1 example to the new entry.',
  'Forms, stems and metadata stay on the original entry.',
  'Nothing is left on the original entry.',
  'The original entry becomes unapproved so it is reviewed again.',
  'The new entry starts unapproved.'
]);
{
  const copied = describeSplit({ moved: {}, copied: { relations: 2, examples: 1 }, notes: [], source_unapproved: false });
  assert.deepStrictEqual(copied.slice(0, 2), [
    'Copies 2 relations to the new entry; the original entry keeps its own.',
    'Copies 1 example to the new entry; the original entry keeps its own.'
  ]);
  assert.ok(!copied.some(line => /unapproved so/.test(line) && /original/.test(line)), 'copying leaves the original approved');
  const calls = [];
  const copyApi = new VerddApi({ baseUrl: 'verdd.example.org/verdd', token: 't', fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '{}' }; } });
  await copyApi.splitLexeme(5, { relations: [1, 2], lexeme: 'glucken', copy: true, dryRun: true });
  await copyApi.splitLexeme(5, { relations: [1] });
  assert.deepStrictEqual(calls[0], { relations: [1, 2], examples: [], dry_run: true, copy: true, lexeme: 'glucken' });
  assert.strictEqual('copy' in calls[1], false, 'a plain split sends no copy flag');
}
console.log('✓ headword tidy, merge rules, twins, collisions, split');

console.log('=== 11. Signing in with Ve\'rdd credentials ===');
{
  const access = { restricted: true, pairs: [['fin', 'sms']] };
  const { fetchImpl, calls } = mockFetch({
    'POST /verdd/api/v1/auth/login/': (call) => call.body.password === 'good'
      ? { body: { token: 'T0K', username: 'helper', is_staff: true, is_superuser: false, access } }
      : call.body.password === 'slow' ? { status: 429, body: { detail: 'Request was throttled.' } }
      : call.body.username === 'reader' ? { status: 403, body: { detail: 'This account is not a staff account.' } }
      : { status: 400, body: { non_field_errors: ['Wrong username or password.'] } }
  });
  const ok = await signInToVerdd({ baseUrl: 'verdd.example.org/verdd/', username: ' helper ', password: 'good', fetchImpl });
  assert.deepStrictEqual(ok, { token: 'T0K', username: 'helper', is_staff: true, is_superuser: false, access });
  assert.deepStrictEqual(calls[0].body, { username: 'helper', password: 'good' });
  assert.strictEqual(calls[0].init.credentials, 'omit');
  assert.strictEqual(calls[0].headers.Authorization, undefined, 'no token is sent to the sign-in');
  await assert.rejects(signInToVerdd({ baseUrl: 'verdd.example.org/verdd', username: 'helper', password: 'bad', fetchImpl }), /Wrong username or password/);
  await assert.rejects(signInToVerdd({ baseUrl: 'verdd.example.org/verdd', username: 'helper', password: 'slow', fetchImpl }), /Too many sign-in attempts/);
  await assert.rejects(signInToVerdd({ baseUrl: 'verdd.example.org/verdd', username: 'reader', password: 'x', fetchImpl }), /not a staff account/);
  await assert.rejects(signInToVerdd({ baseUrl: '', username: 'a', password: 'b', fetchImpl }), /address/);
  await assert.rejects(signInToVerdd({ baseUrl: 'verdd.example.org/verdd', username: '', password: 'b', fetchImpl }), /username/);
  await assert.rejects(signInToVerdd({ baseUrl: 'verdd.example.org/other', username: 'a', password: 'b', fetchImpl }), /No Ve'rdd sign-in/, 'an old server without the endpoint');
  await assert.rejects(signInToVerdd({ baseUrl: 'verdd.example.org/verdd', username: 'a', password: 'b', fetchImpl: async () => { throw new TypeError('x'); } }), /Cannot reach/);

  assert.strictEqual(describeAccess({ restricted: false, pairs: [] }), 'all languages');
  assert.strictEqual(describeAccess(undefined), 'all languages');
  assert.strictEqual(describeAccess({ restricted: true, pairs: [['fin', 'sms'], ['myv', 'myv']] }), 'fin ↔ sms; myv');

  const refused = apiWith({ 'GET /verdd/api/v1/lexemes/5/': { status: 403, body: { detail: 'You do not have access to language myv.' } } });
  await assert.rejects(refused.api.getLexeme(5), /do not have access to language myv/);
  const plain = apiWith({ 'GET /verdd/api/v1/lexemes/5/': { status: 403, body: { detail: 'You do not have permission to perform this action.' } } });
  await assert.rejects(plain.api.getLexeme(5), /must be staff/);
}
console.log('✓ sign-in, access description, access errors');

console.log('\nAll Ve\'rdd API service tests passed.');
