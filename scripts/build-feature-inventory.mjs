#!/usr/bin/env node
/**
 * Builds data/ud-feature-inventory.json: which Feature=Value pairs, UPOS tags and DEPREL labels each
 * language uses in the given Universal Dependencies treebanks, with counts.
 *
 *   node scripts/build-feature-inventory.mjs [--root ~/Desktop/Github/ud] [--out data/ud-feature-inventory.json]
 *        [--treebanks UD_Erzya-JR,UD_Moksha-JR,...] [--exclude-licenses "-NC-"|none]
 *
 * Treebanks with a non-commercial license (CC BY-NC...) are skipped by default, so a rebuild cannot bring them back
 * by accident; pass --exclude-licenses none to turn that off for a private build.
 *
 * Only the top-level *.conllu files of each treebank folder are read (never subfolders such as
 * not-to-release). The output holds names and counts only: no sentence, word, lemma or gloss is copied.
 * MISC is recorded by key name only (never the value), so non-standard keys such as CGdeprel can be flagged.
 * The inventory is derived from UD treebanks; each treebank keeps its own license (listed in the output).
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const DEFAULT_TREEBANKS = [
  'UD_Erzya-JR', 'UD_Moksha-JR', 'UD_Komi_Permyak-UH', 'UD_Komi_Zyrian-IKDP', 'UD_Komi_Zyrian-Lattice',
  'UD_Skolt_Sami-Giellagas', 'UD_Finnish-FTB', 'UD_Finnish-OOD', 'UD_Finnish-PUD', 'UD_Finnish-TDT',
  'UD_North_Sami-Giella', 'UD_Veps-VWT', 'UD_Nenets-Tundra',
  'UD_Estonian-EWT', 'UD_Karelian-KKPP', 'UD_Livvi-KKPP', 'UD_Komi-OldPermic', 'UD_Apurina-UFPA',
  'UD_Cebuano-GJA', 'UD_Munduruku-TuDeT', 'UD_Makurap-TuDeT', 'UD_Paumari-TueCL', 'UD_Tagabawa-GJA'
];

// A treebank folder without a .conllu file in the working tree (e.g. the data only lives on the dev branch) is read from
// the first of these remote-tracking branches that has one. Read-only: git ls-tree / git show, nothing is checked out.
const FALLBACK_REFS = ['origin/dev', 'origin/master'];

// UD file-name prefix -> the ISO 639-3 code the workbench uses
const PREFIX_TO_CODE = { fi: 'fin', et: 'est' };

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const root = (args.root || path.join(os.homedir(), 'Desktop/Github/ud')).replace(/^~/, os.homedir());
const out = args.out || 'data/ud-feature-inventory.json';
const treebanks = args.treebanks ? args.treebanks.split(',') : DEFAULT_TREEBANKS;
const excludeArg = args['exclude-licenses'] || '-NC-'; // default: skip non-commercial licenses
const excludeLicense = excludeArg === 'none' ? null : new RegExp(excludeArg, 'i');

const bump = (obj, key, by = 1) => { obj[key] = (obj[key] || 0) + by; };
const sortedObject = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const normalizeLicense = (l) => (l || '').toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').trim();

/** Text of a top-level file of a treebank: from the working tree, or from a git ref (read-only) when `ref` is given. */
function readTop(dir, file, ref) {
  if (ref) {
    try {
      return execFileSync('git', ['-C', dir, 'show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
    } catch (e) { return null; }
  }
  const f = path.join(dir, file);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

/** "CC BY-SA 4.0" from the README header line ("License: ..."). */
function licenseFromReadme(dir, ref) {
  for (const name of ['README.md', 'README.txt']) {
    const text = readTop(dir, name, ref);
    const m = text && text.match(/^License:\s*(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

/** The license a treebank's LICENSE.txt states: a creativecommons.org/licenses/<kind>/<version> URL, or "Creative Commons BY-NC-SA 3.0". */
function licenseFromLicenseFile(dir, ref) {
  const text = readTop(dir, 'LICENSE.txt', ref);
  if (!text) return null;
  const url = text.match(/creativecommons\.org\/licenses\/([a-z-]+)\/(\d\.\d)/i);
  if (url) return `CC ${url[1].toUpperCase()} ${url[2]}`;
  const named = text.match(/Creative Commons\s+(BY(?:-[A-Z]+)*)\s+(\d\.\d)/i);
  return named ? `CC ${named[1].toUpperCase()} ${named[2]}` : null;
}

/**
 * The license to record. LICENSE.txt wins over the README header when they disagree (the README is often stale);
 * a mismatch is reported.
 * @returns {{ license: string|null, source: string|null }}
 */
function readLicense(dir, name, ref = null) {
  const fromFile = licenseFromLicenseFile(dir, ref);
  const fromReadme = licenseFromReadme(dir, ref);
  if (fromFile && fromReadme && normalizeLicense(fromFile) !== normalizeLicense(fromReadme)) {
    console.warn(`WARNING ${name}: README says "${fromReadme}" but LICENSE.txt says "${fromFile}"; using LICENSE.txt`);
  }
  if (fromFile) return { license: fromFile, source: 'LICENSE.txt' };
  return { license: fromReadme, source: fromReadme ? 'README' : null };
}

async function scanFile(file, lang, ref = null, dir = null) {
  const lines = ref
    ? execFileSync('git', ['-C', dir, 'show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 29 }).split('\n')
    : readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || line[0] === '#') continue;
    const cols = line.split('\t');
    if (cols.length !== 10 || !/^\d+$/.test(cols[0])) continue; // words only: no ranges, empty nodes or junk
    lang.tokens++;
    if (cols[3] !== '_') bump(lang.upos, cols[3]);
    if (cols[7] !== '_') bump(lang.deprel, cols[7]);
    if (cols[9] !== '_') for (const seg of cols[9].split('|')) if (seg) bump(lang.misc, seg.split('=')[0]);
    if (cols[5] === '_') continue;
    for (const pair of cols[5].split('|')) {
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const key = pair.slice(0, eq);
      lang.feats[key] = lang.feats[key] || {};
      for (const value of pair.slice(eq + 1).split(',')) if (value) bump(lang.feats[key], value);
    }
  }
}

const languages = {};
const sources = [];
/** Top-level .conllu files of a treebank: from the working tree, else from the first fallback branch that has any. */
function findFiles(dir) {
  const local = fs.readdirSync(dir).filter((f) => f.endsWith('.conllu')).sort();
  if (local.length) return { files: local, ref: null };
  for (const ref of FALLBACK_REFS) {
    try {
      execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', `refs/remotes/${ref}`], { stdio: 'ignore' });
      const names = execFileSync('git', ['-C', dir, 'ls-tree', '--name-only', ref], { encoding: 'utf8' }).split('\n'); // top level only
      const files = names.filter((f) => f.endsWith('.conllu')).sort();
      if (files.length) return { files, ref };
    } catch (e) { /* no such branch */ }
  }
  return { files: [], ref: null };
}

for (const name of treebanks) {
  const dir = path.join(root, name);
  if (!fs.existsSync(dir)) { console.warn(`WARNING skipped ${name}: folder not found`); continue; }
  const { files, ref } = findFiles(dir);
  if (!files.length) { console.warn(`WARNING skipped ${name}: no .conllu file in the working tree or on ${FALLBACK_REFS.join(' / ')}`); continue; }
  const { license, source: licenseSource } = readLicense(dir, name, ref);
  if (excludeLicense && license && excludeLicense.test(license)) { console.warn(`skipped ${name}: license ${license}`); continue; }
  const prefix = files[0].split('_')[0];
  const code = PREFIX_TO_CODE[prefix] || prefix;
  const lang = languages[code] || (languages[code] = { treebanks: [], tokens: 0, feats: {}, upos: {}, deprel: {}, misc: {} });
  for (const f of files) await scanFile(ref ? f : path.join(dir, f), lang, ref, dir);
  lang.treebanks.push(name);
  const entry = { treebank: name, language: code, files: files.length, license, licenseSource };
  if (ref) entry.readFromBranch = ref;
  sources.push(entry);
  console.log(`${name} (${code}): ${files.length} file(s)${ref ? ` read from ${ref} (not in the working tree)` : ''}`);
}

const result = {
  meta: {
    description: 'Feature=Value pairs, UPOS and DEPREL labels and MISC key names used per language in the listed UD treebanks, with token counts. Names and counts only; no text.',
    generated: new Date().toISOString().slice(0, 10),
    derivedFrom: 'Universal Dependencies treebanks (https://universaldependencies.org); see each source for its license',
    nonCommercial: sources.filter((x) => /-NC-/i.test(x.license || '')).map((x) => x.treebank),
    sources
  },
  languages: Object.fromEntries(Object.entries(languages).sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, l]) => [code, {
    treebanks: l.treebanks,
    tokens: l.tokens,
    feats: Object.fromEntries(Object.entries(sortedObject(l.feats)).map(([k, v]) => [k, sortedObject(v)])),
    upos: sortedObject(l.upos),
    deprel: sortedObject(l.deprel),
    misc: sortedObject(l.misc)
  }]))
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(result)}\n`);
console.log(`wrote ${out} (${fs.statSync(out).size} bytes, ${Object.keys(result.languages).length} languages)`);
