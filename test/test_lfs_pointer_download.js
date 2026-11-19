import assert from 'assert';
import { analyzerService } from '../js/services/analyzer-service.js';

// raw.githubusercontent.com and jsDelivr answer 200 with a ~130-byte Git LFS pointer for the UralicNLP models;
// reading that as a transducer fails with "offset is outside the bounds of the DataView". The downloader must
// skip such an answer and take the next mirror.
const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:' + '0'.repeat(64) + '\nsize 50320486\n';
const real = new Uint8Array(await (await import('fs')).promises.readFile(new URL('./fixtures/lemma-paradigm/gen.hfstol', import.meta.url)));

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  calls.push(String(url).replace(/[?&]_t=\d+$/, ''));
  const media = String(url).includes('media.githubusercontent.com');
  const body = media ? real : new TextEncoder().encode(pointer);
  return new Response(body, { status: 200, headers: { 'Content-Length': String(body.length) } });
};
try {
  const g = await analyzerService.downloadAndLoadGenerator('xxx');
  assert(g.sourceUrl.includes('media.githubusercontent.com'), g.sourceUrl);
  assert(calls[0].includes('raw.githubusercontent.com') && calls[1].includes('media.githubusercontent.com'), calls.join('\n'));
  assert(analyzerService.generators.has('xxx'));

  // every mirror sends a pointer: a clear error, not a DataView error
  globalThis.fetch = async () => new Response(pointer, { status: 200, headers: { 'Content-Length': String(pointer.length) } });
  await assert.rejects(() => analyzerService.downloadAndLoadModel('yyy'), /Git LFS pointer/);
} finally {
  globalThis.fetch = realFetch;
}
console.log('✓ LFS pointer answers are skipped');
