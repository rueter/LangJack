import { HfstRawExporter, readingLine, formatWeight } from '../js/services/hfst-raw-exporter.js';
import { TagMapper } from '../js/services/tag-mapper.js';
import assert from 'assert';

const r = (raw, w = 0) => TagMapper.parse(raw, w, 'lut');

assert.strictEqual(formatWeight(0), '0.0');
assert.strictEqual(formatWeight(12.5), '12.5');
assert.strictEqual(formatWeight(undefined), '0.0');
assert.strictEqual(readingLine(r('gʷədil+V+Act+ScCon+OcSP3+Clt/Now+Dial/-NL')), '"gʷədil" V Act ScCon OcSP3 Clt/Now Dial/-NL <W:0.0>');

const tok = {
  form: 'gʷədiləxʷ',
  readings: [r('gʷədil+V+Act+ScCon+OcSP3+Clt/Now+Dial/-NL'), r('gʷədil+V+Clt/Now+Dial/-NL')],
  guessedReadings: [],
  selectedReadingIndex: 1 // a user choice must not change the raw output
};
const expected = '"<gʷədiləxʷ>"\n\t"gʷədil" V Act ScCon OcSP3 Clt/Now Dial/-NL <W:0.0>\n\t"gʷədil" V Clt/Now Dial/-NL <W:0.0>';
assert.strictEqual(HfstRawExporter.export([{ tokens: [tok] }]), expected);

// guessed readings that were filtered out of readings are still listed, once
const g = r('foo+N+Guess', 3.5);
const t2 = { form: 'foo', readings: [r('foo+N+Sg')], guessedReadings: [g, g] };
const out2 = HfstRawExporter.export([{ tokens: [t2] }]).split('\n');
assert.strictEqual(out2.length, 3);
assert(out2[2].endsWith('<W:3.5>'));

// not analyzed by the transducer: inferred and punctuation readings are not shown as hfst output
const t3 = { form: 'zzz', readings: [{ raw: 'zzz+N+Sg+Nom', isInferred: true }] };
const t4 = { form: '.', readings: [{ raw: '.+CLB', isPunct: true }] };
assert.strictEqual(HfstRawExporter.export([{ tokens: [t3, t4] }]), '"<zzz>"\n\t"zzz" ?\n"<.>"\n\t"." ?');

// sentences are separated by a blank line; nothing in, nothing out
assert.strictEqual(HfstRawExporter.export([{ tokens: [t3] }, { tokens: [t3] }]).split('\n\n').length, 2);
assert.strictEqual(HfstRawExporter.export([]), '');
console.log('✓ raw HFST export');
