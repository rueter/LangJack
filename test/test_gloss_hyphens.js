import assert from 'node:assert';
import { TagMapper } from '../js/services/tag-mapper.js';
import { ConlluExporter } from '../js/services/conllu-exporter.js';
import { formatGlossValue, detectGlossConvention, parseConllu } from '../js/services/conllu-parser.js';
import { formatGloss, normalizeGloss } from '../js/services/gloss-format.js';
import { draftsFromSentences } from '../js/services/verdd-api-service.js';
import { VerddExporter } from '../js/services/verdd-exporter.js';
import { dictionaryService } from '../js/services/dictionary-service.js';

console.log('=== One gloss, three blanks: Ve\'rdd space, UD hyphen, Apertium <b/> ===\n');

assert.strictEqual(formatGloss('old woman', 'verdd'), 'old woman');
assert.strictEqual(formatGloss('old woman', 'ud'), 'old-woman');
assert.strictEqual(formatGloss('old woman', 'apertium'), 'old<b/>woman');
assert.strictEqual(formatGloss(' to_go  out ', 'ud'), 'to-go-out');
assert.strictEqual(formatGloss('old woman', 'ud', '.'), 'old.woman');
assert.strictEqual(normalizeGloss('old<b/>woman'), 'old woman');
assert.strictEqual(normalizeGloss('to_go_out'), 'to go out');
assert.strictEqual(normalizeGloss('well-known'), 'well-known', 'a real hyphen stays');
assert.throws(() => formatGloss('x', 'nope'));

// UD export
const tok = (form, raw, extra) => ({ form, selectedReading: TagMapper.parse(raw), ...extra });
const sent = { sent_id: 1, text: 'a b', tokens: [
  tok('a', 'a+N+Sg+Nom', { customGloss: 'old  woman', customGlossLang: 'en' }),
  tok('b', 'b+N+Sg+Nom', { selectedGloss: { gloss: 'to_go_out', lang: 'en' } })
] };
const rows = ConlluExporter.export([sent]).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
assert.strictEqual(rows[0][9], 'Gloss[en]=old-woman');
assert.strictEqual(rows[1][9], 'Gloss[en]=to-go-out');
assert.strictEqual(formatGlossValue('old woman'), 'old-woman');
assert.strictEqual(formatGlossValue('old woman', '.'), 'old.woman', 'a file that uses dots keeps them');
const row = (g) => `1\ta\ta\tNOUN\t_\t_\t0\troot\t_\tgloss[pt]=${g}`;
assert.strictEqual(detectGlossConvention(parseConllu(`# text = a\n${row('mulher_velha')}\n`)).spaceChar, '-');
assert.strictEqual(detectGlossConvention(parseConllu(`# text = a\n${row('mulher.velha')}\n`)).spaceChar, '.');
assert.strictEqual(detectGlossConvention(parseConllu(`# text = a\n${row('mulher')}\n`)).spaceChar, '-');

// Ve'rdd keeps blanks (also when the stored gloss came in with underscores)
const drafts = draftsFromSentences([sent], [], 'myv', 'en');
assert.strictEqual(drafts[0].translation, 'old woman');
assert.strictEqual(drafts[1].translation, 'to go out');
assert(VerddExporter.exportTSV([sent], [], 'myv', 'en').includes('\tto go out\t'));

// Apertium
const dix = dictionaryService.apertiumBidix([
  { lemma: 'акша', pos: 'N', gloss: 'old woman', tgt_pos: 'N', tgt_lang: 'en' },
  { lemma: 'a&b', pos: 'V', gloss: 'to_go out', tgt_lang: 'en' }
]);
assert(dix.includes('<e><p><l>акша<s n="n"/></l><r>old<b/>woman<s n="n"/></r></p></e>'), dix);
assert(dix.includes('<l>a&amp;b<s n="vblex"/></l><r>to<b/>go<b/>out<s n="vblex"/></r>'), dix);
console.log('✓ Ve\'rdd blank, UD hyphen, Apertium <b/>');
