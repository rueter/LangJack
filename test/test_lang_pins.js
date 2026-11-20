import assert from 'assert';
import '../js/lib/lang-pins.js';

const P = globalThis.LangPins;

// ISO order, "all" first, "custom" last
let o = P.order(['sms', 'custom', 'eng', 'all', 'myv', 'apu'], []);
assert.deepStrictEqual([...o.first, ...o.pinned, ...o.rest, ...o.last], ['all', 'apu', 'eng', 'myv', 'sms', 'custom']);

// pinned ones are listed first, also alphabetical; the others follow
o = P.order(['sms', 'custom', 'eng', 'all', 'myv', 'apu', 'fin'], ['sms', 'ENG', 'zzz']);
assert.deepStrictEqual(o.pinned, ['eng', 'sms']);
assert.deepStrictEqual(o.rest, ['apu', 'fin', 'myv']);
assert.deepStrictEqual([o.first, o.last], [['all'], ['custom']]);

// pin / unpin (no browser storage in Node: kept in memory), "all" and "custom" cannot be pinned
assert.deepStrictEqual(await P.toggle('src', 'SMS'), ['sms']);
assert.deepStrictEqual(await P.toggle('src', 'myv'), ['sms', 'myv']);
assert.deepStrictEqual(await P.toggle('src', 'sms'), ['myv']);
assert.deepStrictEqual(await P.toggle('src', 'all'), ['myv']);
assert.deepStrictEqual(await P.toggle('src', 'custom'), ['myv']);
assert.deepStrictEqual(P.get('tgt'), []); // the two lists are separate
assert.deepStrictEqual(P.clean([' Fin ', 'fin', '', null, 'all']), ['fin']);
console.log('✓ language pins');
