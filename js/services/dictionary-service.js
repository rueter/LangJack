/**
 * Dictionary Service: Supplies glosses for words and lemmas using:
 * 1. User custom dictionaries (stored in IndexedDB),
 * 2. HFST dictionary transducers (UralicNLP full generator-norm & analyser .hfstol),
 * 3. Pre-packaged starter dictionaries.
 * Supports filtering by ISO language and adding/importing custom dictionaries.
 */

import { HfstInputStream } from '../lib/hfst/core.js';
import { storageService } from './storage-service.js';
import { normalizeLangCode, KNOWN_LANGUAGES } from './analyzer-service.js';
import { stripGuessTags } from './tag-mapper.js';
import { SpellRelaxService } from './spell-relax-service.js';
import { VERDD_POS_FALLBACK, POS_UNDETERMINED, toVerddPos } from './verdd-api-service.js';

export const FST_DICTIONARY_LANGUAGES = {
  vro: 'Võro',
  myv: 'Erzya',
  mdf: 'Moksha',
  fin: 'Finnish',
  sms: 'Skolt Sami',
  sme: 'North Sami',
  smn: 'Inari Sami',
  sma: 'South Sami',
  kpv: 'Komi-Zyrian',
  koi: 'Komi-Permyak',
  udm: 'Udmurt',
  mhr: 'Meadow Mari',
  mrj: 'Hill Mari',
  olo: 'Livvi-Karelian',
  fkv: 'Kven',
  fit: 'Meänkieli',
  vep: 'Veps',
  est: 'Estonian',
  liv: 'Livonian',
  vot: 'Votic',
  izt: 'Ingrian'
};

async function fetchBinary(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    const url = chrome.runtime.getURL(path);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
    return resp.arrayBuffer();
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(path);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${path}`);
  return resp.arrayBuffer();
}

async function fetchText(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    const url = chrome.runtime.getURL(path);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
    return resp.text();
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs/promises');
    return fs.readFile(path, 'utf8');
  }
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${path}`);
  return resp.text();
}

/**
 * Splits a raw gloss string containing multiple alternatives into individual words or word sets.
 * Splits on delimiters (comma, semicolon, slash, pipe) that occur outside parentheses/brackets,
 * while preserving multi-word phrases (word sets like "folha de papel", "canoa tradicional",
 * "cachorro d'água", "sich rühren", "go to", "sheet of paper").
 * @param {string} rawGloss
 * @returns {string[]}
 */
export function splitGlossItem(rawGloss) {
  if (!rawGloss || typeof rawGloss !== 'string') return [];
  const trimmed = rawGloss.trim();
  if (!trimmed) return [];

  const results = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '(') {
      parenDepth++;
      current += char;
    } else if (char === ')') {
      if (parenDepth > 0) parenDepth--;
      current += char;
    } else if (char === '[') {
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      if (bracketDepth > 0) bracketDepth--;
      current += char;
    } else if ((char === ',' || char === ';' || char === '/' || char === '|') && parenDepth === 0 && bracketDepth === 0) {
      const part = current.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      if (part) results.push(part);
      current = '';
    } else {
      current += char;
    }
  }

  const lastPart = current.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (lastPart) results.push(lastPart);

  return results.filter(Boolean);
}

/**
 * Parts of speech a custom gloss can have: the Ve'rdd set, so an entry can be sent there later. "UND" (undetermined)
 * is not a part of speech, it means "not known yet", so it does not count.
 */
export const CUSTOM_POS_CHOICES = VERDD_POS_FALLBACK.filter((p) => p !== POS_UNDETERMINED);

/** The canonical POS for what a user or an HFST tag gave ("n", "V", "Po"), or '' when it is no usable part of speech. */
export function normalizeCustomPos(pos) {
  const text = String(pos ?? '').trim();
  if (!text) return '';
  const mapped = toVerddPos(text, CUSTOM_POS_CHOICES);
  return CUSTOM_POS_CHOICES.includes(mapped) ? mapped : '';
}

export class DictionaryService {
  constructor() {
    this.dictGenerators = []; // Array of Hfst instances (generator-norm, analyser)
    this.activeDictId = 'uralic_full_dictionary';
    this.activeDictName = 'Uralic Multi-Language Dictionary Transducers';
    this.isLoaded = false;
    this.customEntriesCache = [];
    this.bundledEntries = []; // Packaged TSV dictionary entries (e.g. apu-por)

    // Pre-packaged dictionary model paths
    this.packagedDictPaths = [
      'models/dictionary-generator.hfstol',
      'models/dictionary-analyser.hfstol',
      'models/bundled_dict.hfstol'
    ];
  }

  async init() {
    try {
      await this.loadAvailableDictionaries();
      await this.refreshCustomEntries();
    } catch (e) {
      console.warn('Could not initialize full dictionary, falling back to starter:', e);
      await this.loadBundledDictionary();
    }
  }

  /**
   * Loads all available packaged or cached dictionary transducers.
   */
  async loadAvailableDictionaries() {
    this.dictGenerators = [];

    // Check IndexedDB first for a downloaded full dictionary model
    try {
      const saved = await storageService.getModel('uralic_full_dictionary');
      if (saved && saved.buffer) {
        const hfst = HfstInputStream.fromBuffer(saved.buffer).read();
        this.dictGenerators.push(hfst);
        this.activeDictId = saved.id;
        this.activeDictName = saved.name || 'Full UralicNLP Dictionary Transducer (nightly)';
        this.isLoaded = true;
      }
    } catch (e) {
      // Safe to ignore if IndexedDB is empty
    }

    for (const path of this.packagedDictPaths) {
      try {
        const buffer = await fetchBinary(path);
        const hfst = HfstInputStream.fromBuffer(buffer).read();
        this.dictGenerators.push(hfst);
        this.isLoaded = true;
      } catch (err) {
        // Safe to ignore if individual file is optional
      }
    }

    if (this.dictGenerators.length > 0) {
      this.activeDictName = this.activeDictName || `Uralic Dictionaries (${this.dictGenerators.length} transducers loaded)`;
    } else {
      await this.loadBundledDictionary();
    }

    // Load bundled packaged TSV dictionaries (e.g. models/dict-apu-por.tsv, models/dict-koi.tsv)
    try {
      const apuTsv = await fetchText('models/dict-apu-por.tsv');
      if (apuTsv) {
        this.loadPackagedTsvDictionary(apuTsv, 'apu', 'por');
      }
    } catch (e) {
      // Safe to ignore if optional
    }

    try {
      const koiTsv = await fetchText('models/dict-koi.tsv');
      if (koiTsv) {
        this.loadPackagedTsvDictionary(koiTsv, 'koi', 'kpv');
      }
    } catch (e) {
      // Safe to ignore if optional
    }
  }

  /**
   * Loads entries from a packaged TSV dictionary into the in-memory bundled lexicon.
   * Keeps each gloss separate as individual words or word sets.
   */
  loadPackagedTsvDictionary(tsvContent, defaultSrc = 'apu', defaultTgt = 'por') {
    if (!tsvContent || typeof tsvContent !== 'string') return;
    const lines = tsvContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('lemma\t')) continue;
      const cols = trimmed.split('\t').map(c => c.trim().replace(/^["']|["']$/g, ''));
      if (cols.length >= 2) {
        const lemma = cols[0];
        const rawGloss = cols[1];
        const tgt_lang = normalizeLangCode(cols[2] || defaultTgt);
        const pos = cols[3] || '';
        const src_lang = normalizeLangCode(cols[4] || defaultSrc);
        if (lemma && rawGloss) {
          const glossParts = splitGlossItem(rawGloss);
          for (const gloss of glossParts) {
            this.bundledEntries.push({
              src_lang,
              lemma,
              pos,
              tgt_lang,
              gloss,
              source: 'packaged_dictionary'
            });
          }
        }
      }
    }
  }

  /**
   * Refreshes custom user entries from IndexedDB.
   */
  async refreshCustomEntries() {
    try {
      this.customEntriesCache = await storageService.getCustomEntries();
    } catch (e) {
      console.warn('Failed to load custom entries:', e);
      this.customEntriesCache = [];
    }
  }

  /**
   * Loads the bundled starter dictionary as fallback.
   */
  async loadBundledDictionary() {
    const starterPath = 'models/bundled_dict.hfstol';
    const buffer = await fetchBinary(starterPath);
    const hfst = HfstInputStream.fromBuffer(buffer).read();
    this.dictGenerators = [hfst];
    this.activeDictId = 'bundled_dict';
    this.activeDictName = 'Bundled Starter Dictionary';
    this.isLoaded = true;
    return true;
  }

  /**
   * Loads a dictionary transducer directly from an ArrayBuffer and saves it.
   */
  async loadFromBuffer(buffer, id, name, saveToDb = true) {
    const hfst = HfstInputStream.fromBuffer(buffer).read();
    this.dictGenerators.unshift(hfst);
    this.activeDictId = id;
    this.activeDictName = name;
    this.isLoaded = true;

    if (saveToDb) {
      await storageService.saveModel(id, name, 'dictionary', buffer);
    }
    return true;
  }

  /**
   * Prioritized candidate URLs for UralicNLP dictionary downloads.
   * If a language code is provided, returns language-specific dictionary URLs first,
   * followed by the full multi-language transducer URLs.
   */
  getDictionaryDownloadUrls(langCode = null) {
    const urls = [];
    if (langCode && langCode !== 'all') {
      const cleanLang = normalizeLangCode(langCode);
      urls.push(
        `https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/${cleanLang}/dictionary.json`,
        `https://cdn.jsdelivr.net/gh/Rootroo-ltd/uralicnlpmodels@main/nightly/${cleanLang}/dictionary.json`,
        `http://models.uralicnlp.com/nightly/${cleanLang}/dictionary.json`,
        `https://models.uralicnlp.com/nightly/${cleanLang}/dictionary.json`
      );
    }
    urls.push(
      'https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/dictionary/generator-gt-norm.hfstol',
      'https://cdn.jsdelivr.net/gh/Rootroo-ltd/uralicnlpmodels@main/nightly/dictionary/generator-gt-norm.hfstol',
      'http://models.uralicnlp.com/nightly/dictionary/generator-gt-norm.hfstol',
      'https://models.uralicnlp.com/nightly/dictionary/generator-gt-norm.hfstol'
    );
    return urls;
  }

  /**
   * Downloads UralicNLP dictionary transducer or language-specific dictionary.
   */
  async downloadAndLoadDictionary(url = null, onProgress = null, langCode = null) {
    const candidateUrls = url
      ? [url, ...this.getDictionaryDownloadUrls(langCode).filter(u => u !== url)]
      : this.getDictionaryDownloadUrls(langCode);

    let lastError = null;
    let resp = null;
    let successfulUrl = null;

    for (const downloadUrl of candidateUrls) {
      try {
        const bustUrl = downloadUrl.includes('?')
          ? `${downloadUrl}&_t=${Date.now()}`
          : `${downloadUrl}?_t=${Date.now()}`;
        const r = await fetch(bustUrl, { cache: 'reload' });
        if (r.ok) {
          resp = r;
          successfulUrl = downloadUrl;
          break;
        } else {
          lastError = new Error(`HTTP ${r.status} ${r.statusText} from ${downloadUrl}`);
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!resp) {
      throw new Error(`Failed to download UralicNLP dictionary: ${lastError ? lastError.message : 'All mirrors unreachable'}`);
    }

    const contentType = resp.headers.get('Content-Type') || '';
    if (successfulUrl.endsWith('.json') || contentType.includes('json')) {
      const text = await resp.text();
      const count = await this.importUralicJsonDictionary(text, langCode || 'myv');
      return { id: `uralic_${langCode || 'custom'}_dict`, name: `UralicNLP ${langCode || ''} Dictionary (${count} entries)`, size: text.length, sourceUrl: successfulUrl };
    }

    let buffer;
    if (resp.body && typeof resp.body.getReader === 'function') {
      const contentLength = +(resp.headers.get('Content-Length') || 0);
      const reader = resp.body.getReader();
      let receivedLength = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (onProgress) {
          const pct = contentLength > 0 ? Math.round((receivedLength / contentLength) * 100) : 0;
          onProgress(receivedLength, contentLength, pct);
        }
      }

      const allChunks = new Uint8Array(receivedLength);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }
      buffer = allChunks.buffer;
    } else {
      buffer = await resp.arrayBuffer();
      if (onProgress) {
        onProgress(buffer.byteLength, buffer.byteLength, 100);
      }
    }

    const id = 'uralic_full_dictionary';
    const name = 'Full UralicNLP Dictionary Transducer (nightly)';
    await this.loadFromBuffer(buffer, id, name, true);
    return { id, name, size: buffer.byteLength, sourceUrl: successfulUrl };
  }

  /**
   * Looks up candidate glosses for a given lemma.
   * Checks custom user entries first, then HFST dictionary transducers.
   * @param {string} lemma - The base word / lemma (e.g. 'вастома', 'kissa')
   * @param {string} srcLang - ISO 639-3 source language code (e.g. 'myv', 'fin', 'sms')
   * @param {string|null} targetLang - Desired ISO 639-3 target gloss language (e.g. 'eng', 'fin', 'rus') or null for all
   * @returns {Array<{ gloss: string, lang: string, pos?: string, source: string }>}
   */
  lookupGlosses(lemma, srcLang = 'myv', targetLang = 'eng', preferredTgtLang = null) {
    if (!lemma || typeof lemma !== 'string') return [];

    let cleanLemma = stripGuessTags(lemma);
    if (!cleanLemma || /^(?:\+guess|«\+?guess»)$/i.test(cleanLemma)) {
      return [];
    }
    if (/^guess$/i.test(cleanLemma) && (srcLang || '').toLowerCase() !== 'eng') {
      return [];
    }

    // If a compound string with # or analysis string with + was passed, extract base lemma
    if (cleanLemma.includes('#')) {
      const sections = cleanLemma.split('#').filter(Boolean);
      let comp = '';
      for (const sec of sections) {
        const parts = sec.split('+').filter(Boolean);
        if (parts.length > 0) comp += parts[0];
      }
      cleanLemma = comp;
    } else if (cleanLemma.includes('+')) {
      const parts = cleanLemma.split('+').filter(Boolean);
      cleanLemma = parts[0] || '';
    }
    cleanLemma = cleanLemma.replace(/#/g, '').trim();

    if (!cleanLemma || /^(?:\+guess|«\+?guess»)$/i.test(cleanLemma)) {
      return [];
    }
    if (/^guess$/i.test(cleanLemma) && (srcLang || '').toLowerCase() !== 'eng') {
      return [];
    }

    const cleanSrcLang = normalizeLangCode(srcLang || 'myv');
    const cleanTgtLang = targetLang && targetLang !== 'all' ? normalizeLangCode(targetLang) : null;

    const rawGlossList = [];
    const seenGlosses = new Set();

    const addGloss = (gloss, lang, pos, source) => {
      if (!gloss) return;
      const normalizedLang = (lang || 'eng').toLowerCase();
      const parts = splitGlossItem(gloss);
      for (const part of parts) {
        const cleanGloss = part.replace(/^[#_]+|[#_]+$/g, '').replace(/_/g, ' ').trim();
        if (!cleanGloss) continue;

        const key = `${normalizedLang}:${cleanGloss.toLowerCase()}`;
        if (!seenGlosses.has(key)) {
          seenGlosses.add(key);
          rawGlossList.push({
            gloss: cleanGloss,
            lang: normalizedLang,
            pos: pos || '',
            source
          });
        }
      }
    };

    // Check if lemma was typed with keyboard spell relax (e.g. kiil' -> kiiĺ)
    const canonLemma = SpellRelaxService.hasRelaxPattern(cleanLemma, cleanSrcLang)
      ? SpellRelaxService.toCanonical(cleanLemma, cleanSrcLang)
      : null;

    // 1. Check user custom dictionary entries (highest priority)
    for (const entry of this.customEntriesCache) {
      const matchSrc = !entry.src_lang || entry.src_lang.toLowerCase() === cleanSrcLang;
      const matchLemma = entry.lemma.toLowerCase() === cleanLemma.toLowerCase() ||
                         (canonLemma && entry.lemma.toLowerCase() === canonLemma.toLowerCase());
      const matchTgt = !cleanTgtLang || entry.tgt_lang.toLowerCase() === cleanTgtLang;

      if (matchSrc && matchLemma && matchTgt) {
        addGloss(entry.gloss, entry.tgt_lang, entry.pos, 'custom_user');
      }
    }

    // 2. Check bundled packaged dictionary entries (e.g. models/dict-apu-por.tsv)
    for (const entry of this.bundledEntries) {
      const matchSrc = !entry.src_lang || entry.src_lang.toLowerCase() === cleanSrcLang;
      const matchLemma = entry.lemma.toLowerCase() === cleanLemma.toLowerCase() ||
                         (canonLemma && entry.lemma.toLowerCase() === canonLemma.toLowerCase());
      const matchTgt = !cleanTgtLang || entry.tgt_lang.toLowerCase() === cleanTgtLang;

      if (matchSrc && matchLemma && matchTgt) {
        addGloss(entry.gloss, entry.tgt_lang, entry.pos, 'packaged_dictionary');
      }
    }

    // 3. Check loaded HFST dictionary transducers
    if (this.dictGenerators.length > 0) {
      const queries = [`${cleanSrcLang}_${cleanLemma}`];
      if (cleanLemma !== cleanLemma.toLowerCase()) {
        queries.push(`${cleanSrcLang}_${cleanLemma.toLowerCase()}`);
      }
      if (canonLemma && canonLemma !== cleanLemma) {
        queries.push(`${cleanSrcLang}_${canonLemma}`);
        if (canonLemma !== canonLemma.toLowerCase()) {
          queries.push(`${cleanSrcLang}_${canonLemma.toLowerCase()}`);
        }
      }

      // Komi-Permyak (koi) and Komi-Zyrian (kpv) are sister Komi varieties that share vocabulary.
      // UralicNLP multi-dictionary transducer indexes Komi under 'kpv', so query kpv as well.
      if (cleanSrcLang === 'koi') {
        queries.push(`kpv_${cleanLemma}`);
        if (cleanLemma !== cleanLemma.toLowerCase()) {
          queries.push(`kpv_${cleanLemma.toLowerCase()}`);
        }
        if (canonLemma && canonLemma !== cleanLemma) {
          queries.push(`kpv_${canonLemma}`);
        }
      }

      for (const dictHfst of this.dictGenerators) {
        for (const query of queries) {
          try {
            const rawResults = dictHfst.lookup(query);
            if (rawResults && rawResults.length > 0) {
              for (const [resStr] of rawResults) {
                const underscoreIdx = resStr.indexOf('_');
                if (underscoreIdx > 0) {
                  const resLang = resStr.substring(0, underscoreIdx).toLowerCase();
                  const resGloss = resStr.substring(underscoreIdx + 1);

                  if (!cleanTgtLang || resLang === cleanTgtLang) {
                    addGloss(resGloss, resLang, '', 'dictionary_fst');
                  }
                } else {
                  if (!cleanTgtLang || cleanTgtLang === 'eng') {
                    addGloss(resStr, cleanTgtLang || 'eng', '', 'dictionary_fst');
                  }
                }
              }
            }
          } catch (err) {
            // Ignore lookup errors
          }
        }
      }

      // If koi lemma has kpv translation equivalents from the packaged lexicon (e.g. кӧр -> кор),
      // bridge through kpv to dictionary FST for multilingual glosses (eng, rus, fin, etc.)
      if (cleanSrcLang === 'koi' && (!cleanTgtLang || cleanTgtLang !== 'kpv')) {
        const kpvEquivalents = rawGlossList.filter(g => g.lang === 'kpv').map(g => g.gloss);
        for (const kpvLemma of kpvEquivalents) {
          if (!kpvLemma || kpvLemma.toLowerCase() === cleanLemma.toLowerCase()) continue;
          for (const dictHfst of this.dictGenerators) {
            try {
              const kpvResults = dictHfst.lookup(`kpv_${kpvLemma}`) || [];
              for (const [resStr] of kpvResults) {
                const uIdx = resStr.indexOf('_');
                if (uIdx > 0) {
                  const rLang = resStr.substring(0, uIdx).toLowerCase();
                  const rGloss = resStr.substring(uIdx + 1);
                  if (!cleanTgtLang || rLang === cleanTgtLang) {
                    addGloss(rGloss, rLang, '', 'dictionary_fst');
                  }
                }
              }
            } catch (_) {}
          }
        }
      }
    }

    // Post-filter: Remove redundant composite concatenations from dictionary transducers
    // (e.g. "tapaaminen kohtaaminen" where both "tapaaminen" and "kohtaaminen" are separate individual words,
    // or "встреча приём" where both "встреча" and "приём" are separate individual words).
    // Genuine word sets (e.g. "folha de papel", "canoa tradicional", "sich rühren", "go to") are preserved
    // because not all of their constituent words exist independently as single-word glosses for that language.
    const singleWordGlossesByLang = new Map();
    for (const item of rawGlossList) {
      const words = item.gloss.split(/\s+/).filter(Boolean);
      if (words.length === 1) {
        let set = singleWordGlossesByLang.get(item.lang);
        if (!set) {
          set = new Set();
          singleWordGlossesByLang.set(item.lang, set);
        }
        set.add(item.gloss.toLowerCase());
      }
    }

    const filteredList = rawGlossList.filter(item => {
      const words = item.gloss.split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        const singleWords = singleWordGlossesByLang.get(item.lang);
        if (singleWords) {
          const allPartsExistAsSingleWords = words.every(w => singleWords.has(w.toLowerCase()));
          if (allPartsExistAsSingleWords) {
            return false;
          }
        }
      }
      return true;
    });

    if (preferredTgtLang && preferredTgtLang !== 'all') {
      const cleanPref = normalizeLangCode(preferredTgtLang);
      filteredList.sort((a, b) => {
        const aMatch = (a.lang || '').toLowerCase() === cleanPref ? 1 : 0;
        const bMatch = (b.lang || '').toLowerCase() === cleanPref ? 1 : 0;
        return bMatch - aMatch;
      });
    }

    return filteredList;
  }

  /**
   * Adds custom dictionary entries and persists them.
   * Splits multi-gloss input into individual words or word sets.
   */
  async addCustomEntry(entry, { requirePos = false } = {}) {
    if (!entry) return null;
    if (requirePos) {
      const pos = normalizeCustomPos(entry.pos);
      if (!pos) throw new Error('A part of speech is required for a gloss (one of: ' + CUSTOM_POS_CHOICES.join(', ') + ').');
      entry = { ...entry, pos };
    }
    const glossParts = splitGlossItem(entry.gloss || '');
    if (glossParts.length > 1) {
      const items = glossParts.map(gp => ({ ...entry, gloss: gp }));
      await storageService.addDictionaryEntries(items);
      await this.refreshCustomEntries();
      return items[0];
    } else {
      const cleanEntry = { ...entry, gloss: (glossParts[0] || entry.gloss || '').trim() };
      const saved = await storageService.addDictionaryEntry(cleanEntry);
      await this.refreshCustomEntries();
      return saved;
    }
  }

  /** Custom entries that still lack a usable part of speech (typically imported ones). */
  entriesMissingPos() {
    return this.customEntriesCache.filter((e) => !normalizeCustomPos(e.pos));
  }

  /** Sets the part of speech of an existing custom entry (this is how entries without one are completed). */
  async updateCustomEntryPos(id, pos) {
    const clean = normalizeCustomPos(pos);
    if (!clean) throw new Error('Choose a part of speech: ' + CUSTOM_POS_CHOICES.join(', '));
    const entry = this.customEntriesCache.find((e) => e.id === id);
    if (!entry) throw new Error('Unknown entry');
    await storageService.addDictionaryEntry({ ...entry, pos: clean });
    await this.refreshCustomEntries();
    return clean;
  }

  /**
   * Deletes a custom dictionary entry by ID.
   */
  async deleteCustomEntry(id) {
    await storageService.deleteDictionaryEntry(id);
    await this.refreshCustomEntries();
  }

  /**
   * Imports multiple entries from TSV, CSV, JSON, or Lexc text.
   * Keeps each gloss separate as individual words or word sets.
   */
  async importCustomDictionary(content, format = 'tsv', defaultSrcLang = 'myv', defaultTgtLang = 'eng') {
    const entries = [];
    const cleanContent = content.trim();

    if (format === 'json') {
      const parsed = JSON.parse(cleanContent);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.lemma && item.gloss) {
            const parts = splitGlossItem(item.gloss);
            for (const p of parts) {
              entries.push({
                src_lang: (item.src_lang || defaultSrcLang).toLowerCase(),
                lemma: item.lemma.trim(),
                pos: (item.pos || '').trim(),
                tgt_lang: (item.tgt_lang || defaultTgtLang).toLowerCase(),
                gloss: p,
                notes: item.notes || ''
              });
            }
          }
        }
      }
    } else if (format === 'lexc') {
      const lines = cleanContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('LEXICON') || trimmed.startsWith('!') || trimmed.startsWith('#')) continue;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          let left = trimmed.substring(0, colonIdx).trim();
          let right = trimmed.substring(colonIdx + 1).replace(/#;?/, '').trim();

          let src_lang = defaultSrcLang;
          let lemma = left;
          let tgt_lang = defaultTgtLang;
          let rawGloss = right;

          if (left.includes('_')) {
            const parts = left.split('_');
            src_lang = parts[0];
            lemma = parts.slice(1).join('_');
          }
          if (right.includes('_')) {
            const parts = right.split('_');
            tgt_lang = parts[0];
            rawGloss = parts.slice(1).join('_').replace(/_/g, ' ');
          }

          const parts = splitGlossItem(rawGloss);
          for (const p of parts) {
            entries.push({
              src_lang: src_lang.toLowerCase(),
              lemma,
              pos: '',
              tgt_lang: tgt_lang.toLowerCase(),
              gloss: p,
              notes: 'Imported from lexc'
            });
          }
        }
      }
    } else {
      const delimiter = format === 'csv' ? ',' : '\t';
      const lines = cleanContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const cols = trimmed.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length >= 2) {
          const lemma = cols[0];
          const rawGloss = cols[1];
          const tgt_lang = cols[2] || defaultTgtLang;
          const pos = cols[3] || '';
          const src_lang = cols[4] || defaultSrcLang;

          if (lemma && rawGloss) {
            const parts = splitGlossItem(rawGloss);
            for (const p of parts) {
              entries.push({
                src_lang: src_lang.toLowerCase(),
                lemma,
                pos,
                tgt_lang: tgt_lang.toLowerCase(),
                gloss: p,
                notes: 'Imported from spreadsheet'
              });
            }
          }
        }
      }
    }

    if (entries.length > 0) {
      await storageService.addDictionaryEntries(entries);
      await this.refreshCustomEntries();
    }

    return entries.length;
  }

  /**
   * Imports UralicNLP TinyDB/JSON dictionary formats into custom entries.
   * Keeps each gloss separate as individual words or word sets.
   */
  async importUralicJsonDictionary(jsonContent, defaultSrcLang = 'myv') {
    const cleanLang = normalizeLangCode(defaultSrcLang);
    let parsed;
    try {
      parsed = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
    } catch (e) {
      return 0;
    }

    const entries = [];
    const dataObj = parsed._default || parsed;
    const items = Array.isArray(dataObj) ? dataObj : Object.values(dataObj);

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const lObj = item.lg?.l;
      const lemma = (typeof lObj === 'string' ? lObj : lObj?.['#text']) || item.lemma || '';
      const pos = lObj?.['@pos'] || item.pos || '';

      if (!lemma) continue;

      const trList = [];
      const mgList = Array.isArray(item.mg) ? item.mg : (item.mg ? [item.mg] : []);
      for (const m of mgList) {
        if (!m) continue;
        const tgData = m.tg || m.tr;
        if (Array.isArray(tgData)) {
          trList.push(...tgData);
        } else if (tgData) {
          trList.push(tgData);
        }
      }
      const directTr = item.tr || item.translations;
      if (Array.isArray(directTr)) trList.push(...directTr);
      else if (directTr) trList.push(directTr);

      for (const tr of trList) {
        const tgtLang = normalizeLangCode(tr?.['@xml:lang'] || tr?.xml_lang || tr?.lang || 'por');
        const tVal = tr?.t || tr?.gloss || tr?.text;
        const glosses = [];
        if (Array.isArray(tVal)) {
          for (const g of tVal) {
            if (typeof g === 'string') glosses.push(g);
            else if (g && typeof g === 'object') glosses.push(g['#text'] || '');
          }
        } else if (typeof tVal === 'string') {
          glosses.push(tVal);
        } else if (tVal && typeof tVal === 'object') {
          glosses.push(tVal['#text'] || '');
        }

        for (const gloss of glosses) {
          const cleanGloss = (gloss || '').trim();
          if (cleanGloss) {
            const parts = splitGlossItem(cleanGloss);
            for (const p of parts) {
              entries.push({
                src_lang: cleanLang,
                lemma: lemma.trim(),
                pos: (pos || '').trim(),
                tgt_lang: tgtLang,
                gloss: p,
                notes: 'Imported from UralicNLP dictionary'
              });
            }
          }
        }
      }
    }

    if (entries.length > 0) {
      await storageService.addDictionaryEntries(entries);
      await this.refreshCustomEntries();
    }
    return entries.length;
  }

  /**
   * Exports all custom entries as TSV or JSON.
   */
  async exportCustomDictionary(format = 'tsv') {
    const entries = await storageService.getCustomEntries();
    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }
    const header = ['lemma', 'gloss', 'target_lang', 'pos', 'source_lang', 'notes'].join('\t');
    const rows = entries.map(e => [
      e.lemma,
      e.gloss,
      e.tgt_lang,
      e.pos || '',
      e.src_lang,
      e.notes || ''
    ].join('\t'));
    return [header, ...rows].join('\n');
  }

  /**
   * Returns all available source languages present in the FST dictionary transducers,
   * packaged bundled TSV dictionaries, and user custom TSV dictionaries.
   * @returns {Record<string, string>} Mapping of language code -> language display name
   */
  getSourceLanguages() {
    const langs = new Map();

    // 1. Languages present in the FST dictionary transducers
    for (const [code, name] of Object.entries(FST_DICTIONARY_LANGUAGES)) {
      langs.set(code.toLowerCase(), name);
    }

    // 2. Languages present in bundled packaged dictionaries (e.g. apu, koi)
    for (const entry of this.bundledEntries) {
      if (entry.src_lang) {
        const c = entry.src_lang.toLowerCase();
        if (!langs.has(c)) {
          langs.set(c, KNOWN_LANGUAGES[c] || c.toUpperCase());
        }
      }
    }

    // 3. Languages present in custom user TSV dictionaries / custom entries
    for (const entry of this.customEntriesCache) {
      if (entry.src_lang) {
        const c = entry.src_lang.toLowerCase();
        if (!langs.has(c)) {
          langs.set(c, KNOWN_LANGUAGES[c] || c.toUpperCase());
        }
      }
    }

    return Object.fromEntries(langs);
  }

  /**
   * Checks if a language is present as a source language in the FST dictionary
   * or in a custom/bundled TSV dictionary.
   * @param {string} langCode
   * @returns {boolean}
   */
  hasSourceLanguage(langCode) {
    if (!langCode) return false;
    const clean = normalizeLangCode(langCode);
    const available = this.getSourceLanguages();
    return clean in available;
  }
}

export const dictionaryService = new DictionaryService();
