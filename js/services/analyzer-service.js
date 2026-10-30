/**
 * Analyzer Service: Orchestrates tokenization, language-specific HFST model loading,
 * and morphological analysis using hfst-js.
 */

import { HfstInputStream } from '../lib/hfst/core.js';
import { TagMapper, stripGuessTags, readingComplexity } from './tag-mapper.js';
import { storageService } from './storage-service.js';
import { SpellRelaxService } from './spell-relax-service.js';

export { TagMapper } from './tag-mapper.js';
export { SpellRelaxService } from './spell-relax-service.js';

export const KNOWN_LANGUAGES = {
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
  izt: 'Ingrian',
  apu: 'Apurinã',
  lut: 'Lushootseed',
  slh: 'Southern Lushootseed',
  bxr: 'Buryat',
  chp: 'Chipewyan',
  crk: 'Plains Cree',
  ciw: 'Chippewa',
  evn: 'Evenki',
  eng: 'English',
  rus: 'Russian',
  deu: 'German',
  swe: 'Swedish',
  fra: 'French',
  spa: 'Spanish',
  por: 'Portuguese',
  vro: 'Võro'
};

/**
 * Normalizes any language input (e.g. "apu (apurinã)", "Apurinã (apu)", "apu - Apurinã",
 * "Apurinã", "fin (Finnish)", "myv") into a canonical lowercase ISO language code (e.g. "apu", "fin", "myv").
 */
export function normalizeLangCode(str) {
  if (!str || typeof str !== 'string') return 'myv';
  const trimmed = str.trim();
  if (!trimmed) return 'myv';
  const lower = trimmed.toLowerCase();
  if (lower === 'all') return 'all';

  // 1. "code (Name)" or "code - Name" or "code: Name", e.g. "apu (apurinã)", "fin (Finnish)"
  const codeInFront = lower.match(/^([a-z]{2,3}(?:[-_][a-z0-9]+)?)\s*[\(\[\:\-]/i);
  if (codeInFront) {
    return codeInFront[1].toLowerCase();
  }

  // 2. "Name (code)", e.g. "Apurinã (apu)" or "Finnish (fin)"
  const codeInParens = lower.match(/[\(\[]\s*([a-z]{2,3}(?:[-_][a-z0-9]+)?)\s*[\)\]]/i);
  if (codeInParens) {
    return codeInParens[1].toLowerCase();
  }

  // 3. Exact 2-3 letter code or variant like fin_hist, pt-BR
  if (/^[a-z]{2,3}(?:[-_][a-z0-9]+)?$/i.test(lower)) {
    return lower;
  }

  // 4. Reverse lookup by known language name (with and without diacritics)
  const stripDiacritics = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const lowerStripped = stripDiacritics(lower);
  for (const [code, name] of Object.entries(KNOWN_LANGUAGES)) {
    if (name.toLowerCase() === lower || stripDiacritics(name) === lowerStripped) {
      return code;
    }
  }

  // 5. Look for any standalone 2-3 letter ISO token
  const tokenMatch = lower.match(/\b([a-z]{2,3})\b/);
  if (tokenMatch) {
    return tokenMatch[1].toLowerCase();
  }

  // 6. Clean any non-alphanumeric characters
  const sanitized = lower.replace(/[^a-z0-9_-]/g, '');
  return sanitized || 'myv';
}

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

export class AnalyzerService {
  constructor() {
    this.models = new Map(); // langCode -> Hfst instance
    this.activeLang = 'myv';
    this.activeModelId = 'analyser-myv';
    this.activeModelName = 'Erzya Morphological Analyser (myv)';
    this.isLoaded = false;

    // Available pre-packaged models
    this.packagedModelPaths = {
      'myv': 'models/analyser-myv.hfstol',
      'fin': 'models/analyser-fin.hfstol',
      'kpv': 'models/analyser-kpv.hfstol',
      'koi': 'models/analyser-koi.hfstol',
      'apu': 'models/analyser-apu.hfstol',
      'sms': 'models/analyser-sms.hfstol',
      'starter': 'models/bundled_analyser.hfstol'
    };

    this.modelIds = new Map();
    this.modelNames = new Map();
    this.generators = new Map();
    this.generatorIds = new Map();
    this.generatorNames = new Map();
    this.TagMapper = TagMapper;
  }

  /**
   * Initializes analyzer for the current active language.
   */
  async init(lang = 'myv') {
    this.activeLang = normalizeLangCode(lang || 'myv');
    await this.ensureModelForLanguage(this.activeLang);
  }

  /**
   * Sets the active language and ensures its transducer is loaded.
   */
  async setLanguage(lang) {
    this.activeLang = normalizeLangCode(lang || 'myv');
    return this.ensureModelForLanguage(this.activeLang);
  }

  /**
   * Checks whether the morphological transducer for a language is currently loaded in memory.
   */
  hasModelForLanguage(lang) {
    const cleanLang = normalizeLangCode(lang || 'myv');
    return this.models.has(cleanLang);
  }

  /**
   * Ensures the morphological analyzer transducer for a language is loaded and ready.
   * Priority order:
   * 1. In-memory cached model
   * 2. Downloaded/renewed UralicNLP model or custom uploaded model from IndexedDB (highest authority)
   * 3. Pre-packaged model for that language in models/ directory (if exists)
   * 4. Bundled starter fallback (only if no model exists for language)
   */
  async ensureModelForLanguage(lang) {
    const cleanLang = normalizeLangCode(lang || 'myv');

    // 1. Check in-memory cache
    if (this.models.has(cleanLang)) {
      this.activeLang = cleanLang;
      this.activeModelId = this.modelIds.get(cleanLang) || `analyser-${cleanLang}`;
      this.activeModelName = this.modelNames.get(cleanLang) || `${cleanLang.toUpperCase()} Morphological Analyser`;
      this.isLoaded = true;
      return this.models.get(cleanLang);
    }

    // 2. Check IndexedDB FIRST for downloaded/renewed UralicNLP model or custom uploaded model
    // Any model in IndexedDB takes precedence over packaged files because it was renewed or uploaded by user.
    try {
      const activeSettingId = await storageService.getSetting('active_analyser_id', null);
      let savedRecord = null;
      if (activeSettingId) {
        const candidate = await storageService.getModel(activeSettingId);
        if (candidate && candidate.buffer && normalizeLangCode(candidate.metadata?.lang || '') === cleanLang) {
          savedRecord = candidate;
        }
      }
      if (!savedRecord) {
        savedRecord = await storageService.getModel(`uralic_${cleanLang}_analyser`);
      }
      if (savedRecord && savedRecord.buffer) {
        const isOldNorm = savedRecord.metadata?.sourceUrl?.includes('analyser-gt-norm') ||
                          (savedRecord.sourceUrl && savedRecord.sourceUrl.includes('analyser-gt-norm'));
        if (!isOldNorm) {
          const hfst = HfstInputStream.fromBuffer(savedRecord.buffer).read();
          this.models.set(cleanLang, hfst);
          this.modelIds.set(cleanLang, savedRecord.id);
          this.modelNames.set(cleanLang, savedRecord.name);
          this.activeLang = cleanLang;
          this.activeModelId = savedRecord.id;
          this.activeModelName = savedRecord.name;
          this.isLoaded = true;
          await storageService.setSetting('active_analyser_id', this.activeModelId);
          return hfst;
        }
      }
    } catch (e) {
      console.warn(`Error loading model from IndexedDB for ${cleanLang}:`, e.message);
    }

    // 3. Try pre-packaged model in extension (only if specifically packaged for this language)
    const packagedPath = this.packagedModelPaths[cleanLang];
    if (packagedPath) {
      try {
        const buffer = await fetchBinary(packagedPath);
        const hfst = HfstInputStream.fromBuffer(buffer).read();
        const modelId = `analyser-${cleanLang}`;
        const modelName = `${cleanLang.toUpperCase()} Analyser (${packagedPath.split('/').pop()})`;
        this.models.set(cleanLang, hfst);
        this.modelIds.set(cleanLang, modelId);
        this.modelNames.set(cleanLang, modelName);
        this.activeLang = cleanLang;
        this.activeModelId = modelId;
        this.activeModelName = modelName;
        this.isLoaded = true;
        await storageService.setSetting('active_analyser_id', this.activeModelId);
        return hfst;
      } catch (e) {
        console.warn(`Could not load packaged model for ${cleanLang} from ${packagedPath}:`, e.message);
      }
    }

    // 4. If not pre-packaged, try auto-downloading UralicNLP nightly model
    try {
      await this.downloadAndLoadModel(cleanLang);
      if (this.models.has(cleanLang)) {
        return this.models.get(cleanLang);
      }
    } catch (e) {
      console.warn(`Could not auto-download UralicNLP model for ${cleanLang}:`, e.message);
    }

    // 5. Fallback to bundled starter analyzer ONLY if network and all else failed
    try {
      const starterPath = this.packagedModelPaths['starter'];
      const buffer = await fetchBinary(starterPath);
      const hfst = HfstInputStream.fromBuffer(buffer).read();
      const modelId = 'bundled_analyser';
      const modelName = `Bundled Starter Analyser (fallback for ${cleanLang.toUpperCase()})`;
      this.models.set(cleanLang, hfst);
      this.modelIds.set(cleanLang, modelId);
      this.modelNames.set(cleanLang, modelName);
      this.activeLang = cleanLang;
      this.activeModelId = modelId;
      this.activeModelName = modelName;
      this.isLoaded = true;
      return hfst;
    } catch (e) {
      console.warn('Could not load starter analyzer fallback:', e.message);
    }

    this.isLoaded = false;
    return null;
  }

  /**
   * Loads a model directly from buffer and associates it with a language.
   */
  async loadFromBuffer(buffer, id, name, lang = null, saveToDb = true) {
    const hfst = HfstInputStream.fromBuffer(buffer).read();
    const cleanLang = normalizeLangCode(lang || this.activeLang || 'myv');

    this.models.set(cleanLang, hfst);
    this.modelIds.set(cleanLang, id);
    this.modelNames.set(cleanLang, name);
    this.activeLang = cleanLang;
    this.activeModelId = id;
    this.activeModelName = name;
    this.isLoaded = true;

    if (saveToDb) {
      await storageService.saveModel(id, name, 'analyser', buffer, { lang: cleanLang });
      await storageService.setSetting('active_analyser_id', id);
    }
    return true;
  }

  /**
   * Returns prioritized candidate download URLs for the UralicNLP nightly analyzer.
   * Direct GitHub raw HTTPS is prioritized for TLS certificate validity and CORS support,
   * followed by jsDelivr CDN and HTTP/HTTPS mirrors.
   */
  getModelDownloadUrls(langCode) {
    const cleanLang = normalizeLangCode(langCode || 'myv');
    return [
      `https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/${cleanLang}/analyser-gt-desc.hfstol`,
      `https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/${cleanLang}/analyser-gt-norm.hfstol`,
      `https://cdn.jsdelivr.net/gh/Rootroo-ltd/uralicnlpmodels@main/nightly/${cleanLang}/analyser-gt-desc.hfstol`,
      `https://cdn.jsdelivr.net/gh/Rootroo-ltd/uralicnlpmodels@main/nightly/${cleanLang}/analyser-gt-norm.hfstol`,
      `http://models.uralicnlp.com/nightly/${cleanLang}/analyser-gt-desc.hfstol`,
      `http://models.uralicnlp.com/nightly/${cleanLang}/analyser-gt-norm.hfstol`,
      `https://models.uralicnlp.com/nightly/${cleanLang}/analyser-gt-desc.hfstol`,
      `https://models.uralicnlp.com/nightly/${cleanLang}/analyser-gt-norm.hfstol`
    ];
  }

  /**
   * Downloads a model from UralicNLP nightly models server or fallback mirrors.
   */
  async downloadAndLoadModel(langCode, url = null, onProgress = null) {
    const cleanLang = normalizeLangCode(langCode || 'myv');
    const candidateUrls = url
      ? [url, ...this.getModelDownloadUrls(cleanLang).filter(u => u !== url)]
      : this.getModelDownloadUrls(cleanLang);

    let lastError = null;
    let resp = null;
    let successfulUrl = null;

    for (const downloadUrl of candidateUrls) {
      try {
        const bustUrl = downloadUrl.includes('?')
          ? `${downloadUrl}&_t=${Date.now()}`
          : `${downloadUrl}?_t=${Date.now()}`;
        const r = await fetch(bustUrl);
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

    const modelId = `uralic_${cleanLang}_analyser`;
    const modelName = `UralicNLP ${cleanLang.toUpperCase()} Descriptive Analyser (nightly)`;

    if (!resp) {
      // If network download failed, check if a pre-packaged model exists for this language
      const packagedPath = this.packagedModelPaths[cleanLang];
      if (packagedPath) {
        try {
          const buffer = await fetchBinary(packagedPath);
          this.models.delete(cleanLang);
          await this.loadFromBuffer(buffer, modelId, modelName, cleanLang, true);
          return { id: modelId, name: modelName, size: buffer.byteLength, sourceUrl: packagedPath };
        } catch (packErr) {
          console.warn('Packaged model fallback also failed:', packErr);
        }
      }
      throw new Error(`Failed to download UralicNLP model for "${cleanLang}": ${lastError ? lastError.message : 'All mirrors unreachable'}`);
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

    // Invalidate in-memory cached instance so the newly downloaded nightly model is immediately active
    this.models.delete(cleanLang);
    await this.loadFromBuffer(buffer, modelId, modelName, cleanLang, true);
    return { id: modelId, name: modelName, size: buffer.byteLength, sourceUrl: successfulUrl };
  }

  /**
   * Returns candidate download URLs for the UralicNLP generator transducer.
   */
  getGeneratorDownloadUrls(langCode) {
    const cleanLang = normalizeLangCode(langCode || 'myv');
    return [
      `https://raw.githubusercontent.com/Rootroo-ltd/uralicnlpmodels/main/nightly/${cleanLang}/generator-gt-norm.hfstol`,
      `https://cdn.jsdelivr.net/gh/Rootroo-ltd/uralicnlpmodels@main/nightly/${cleanLang}/generator-gt-norm.hfstol`,
      `http://models.uralicnlp.com/nightly/${cleanLang}/generator-gt-norm.hfstol`,
      `https://models.uralicnlp.com/nightly/${cleanLang}/generator-gt-norm.hfstol`
    ];
  }

  /**
   * Downloads and loads a generator transducer for the specified language.
   */
  async downloadAndLoadGenerator(langCode, url = null) {
    const cleanLang = normalizeLangCode(langCode || 'myv');
    const candidateUrls = url
      ? [url, ...this.getGeneratorDownloadUrls(cleanLang).filter(u => u !== url)]
      : this.getGeneratorDownloadUrls(cleanLang);

    let lastError = null;
    let resp = null;
    let successfulUrl = null;

    for (const downloadUrl of candidateUrls) {
      try {
        const bustUrl = downloadUrl.includes('?')
          ? `${downloadUrl}&_t=${Date.now()}`
          : `${downloadUrl}?_t=${Date.now()}`;
        const r = await fetch(bustUrl);
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
      throw new Error(`Failed to download generator for "${cleanLang}": ${lastError ? lastError.message : 'All mirrors unreachable'}`);
    }

    const buffer = await resp.arrayBuffer();
    const hfst = HfstInputStream.fromBuffer(buffer).read();
    const genId = `uralic_${cleanLang}_generator`;
    const genName = `UralicNLP ${cleanLang.toUpperCase()} Generator (nightly)`;
    this.generators.set(cleanLang, hfst);
    this.generatorIds.set(cleanLang, genId);
    this.generatorNames.set(cleanLang, genName);
    try {
      await storageService.saveModel(genId, genName, 'generator', buffer, { lang: cleanLang });
    } catch (_) {}
    return { id: genId, name: genName, size: buffer.byteLength, sourceUrl: successfulUrl };
  }

  /**
   * Ensures the generator transducer for a language is loaded.
   */
  async ensureGeneratorForLanguage(lang) {
    const cleanLang = normalizeLangCode(lang || this.activeLang || 'myv');
    if (this.generators.has(cleanLang)) {
      return this.generators.get(cleanLang);
    }

    // 1. Check IndexedDB
    try {
      const savedRecord = await storageService.getModel(`uralic_${cleanLang}_generator`);
      if (savedRecord && savedRecord.buffer) {
        const hfst = HfstInputStream.fromBuffer(savedRecord.buffer).read();
        this.generators.set(cleanLang, hfst);
        this.generatorIds.set(cleanLang, savedRecord.id);
        this.generatorNames.set(cleanLang, savedRecord.name);
        return hfst;
      }
    } catch (e) {
      console.warn(`Error loading generator from IndexedDB for ${cleanLang}:`, e.message);
    }

    // 2. Auto-download from UralicNLP nightly
    try {
      await this.downloadAndLoadGenerator(cleanLang);
      if (this.generators.has(cleanLang)) {
        return this.generators.get(cleanLang);
      }
    } catch (e) {
      console.warn(`Could not auto-download generator for ${cleanLang}:`, e.message);
    }

    return null;
  }

  /**
   * True when the language's analyzer reads `word` (digits and a full stop, "23.") as an ordinal numeral (+Ord),
   * as the Nordic transducers do. False without a loaded transducer or without such a reading.
   */
  isOrdinalNumeral(word, language = null) {
    if (!/^\d+\.$/.test(word || '')) return false;
    const lang = normalizeLangCode(language || this.activeLang || '');
    const hfst = this.models.get(lang);
    if (!hfst) return false;
    this._ordinalCache = this._ordinalCache || new Map();
    const key = `${lang}\u0000${word}`;
    if (!this._ordinalCache.has(key)) {
      let found = false;
      try {
        for (const [analysis] of hfst.lookup(word) || []) {
          const tags = stripGuessTags(String(analysis).replace(/@[^@]*@/g, '')).split('+').slice(1);
          if (tags.includes('Ord') && !tags.includes('Guess')) { found = true; break; }
        }
      } catch (err) {
        found = false;
      }
      this._ordinalCache.set(key, found);
    }
    return this._ordinalCache.get(key);
  }

  /**
   * Splits input text into sentences and tokens.
   * With `language`, a numeral the transducer reads as an ordinal ("23.", Nordic style) keeps its full stop
   * inside a sentence: neither the token nor the sentence is cut there. A full stop that ends the sentence stays punctuation.
   */
  tokenize(text, language = null) {
    if (!text || typeof text !== 'string') return [];

    const rawSentences = [];
    for (const line of text.split(/\n+/)) {
      const pieces = line.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁÄÖÜŠŽ\d«"'])/);
      const merged = [];
      for (const piece of pieces) {
        const prev = merged[merged.length - 1];
        const ordinal = prev && /^[\d]/.test(piece) && prev.match(/(?:^|\s)(\d+\.)$/);
        // "23. 5. 2020": a date, not two sentences
        if (ordinal && this.isOrdinalNumeral(ordinal[1], language)) merged[merged.length - 1] = `${prev} ${piece}`;
        else merged.push(piece);
      }
      rawSentences.push(...merged);
    }
    const sentenceStrings = rawSentences.map(s => s.trim()).filter(s => s.length > 0);

    const sentences = [];

    sentenceStrings.forEach((sentStr, sentIdx) => {
      // a hyphen touching the end or the start of a word ("tuõttvuõtt- da suåvâdvuõttkomissio", "-komissio") stays part of the wordform
      const tokenRegex = /(?:(?<![\p{L}\p{M}\d])[\-‐](?=[\p{L}\p{M}]))?[\p{L}\p{M}\d]+(?:['’ʼ´`\-][\p{L}\p{M}\d]+)*(?:['’ʼ´`]|[\-‐](?![\p{L}\p{M}\d]))?|[.,!?;:\-–—«»"()\[\]{}]|[^\s\p{L}\p{M}\d]/gu;
      const rawTokens = [];
      const found = [...sentStr.matchAll(tokenRegex)];
      for (let i = 0; i < found.length; i++) {
        const m = found[i];
        const next = found[i + 1];
        // "23." as one token when the transducer has the ordinal reading, and more text follows in the sentence
        if (/^\d+$/.test(m[0]) && next && next[0] === '.' && next.index === m.index + m[0].length
            && /\s/.test(sentStr[next.index + 1] || '') && found[i + 2]
            && this.isOrdinalNumeral(`${m[0]}.`, language)) {
          rawTokens.push(`${m[0]}.`);
          i++;
        } else {
          rawTokens.push(m[0]);
        }
      }

      const tokens = rawTokens.map((tok, tokIdx) => {
        const isPunct = /^[.,!?;:\-–—«»"()\[\]{}]+$/.test(tok);
        return {
          id: tokIdx + 1,
          form: tok,
          isPunct
        };
      });

      if (tokens.length > 0) {
        sentences.push({
          sent_id: sentIdx + 1,
          text: sentStr,
          tokens
        });
      }
    });

    return sentences;
  }

  /**
   * analyze_word: Analyzes a single word token for the specified language.
   * Returns an array of parsed reading objects with base lemma and grammatical tags.
   * Weight displays are stripped.
   * @param {string} word - Surface word token
   * @param {string} [language] - ISO 639-3 code (e.g. 'myv', 'fin', 'kpv')
   * @returns {Array<Object>} candidate readings with lemma, pos, upos, feats, raw
   */
  analyze_word(word, language = null) {
    if (!word || word.trim() === '') return [];

    const cleanWord = word.trim();
    const lang = normalizeLangCode(language || this.activeLang || 'myv');
    const hfst = this.models.get(lang) || this.models.get(this.activeLang);

    const isPunct = /^[.,!?;:\-–—«»"']$/.test(cleanWord);
    if (isPunct) {
      return [
        {
          raw: `${cleanWord}+CLB`,
          lemma: cleanWord,
          pos: 'CLB',
          upos: 'PUNCT',
          tags: ['CLB'],
          feats: '_',
          featsMap: {},
          isPunct: true
        }
      ];
    }

    let rawResults = [];

    if (hfst) {
      try {
        // 1. Try exact word
        rawResults = hfst.lookup(cleanWord);

        // 2. Try lowercased word if original has uppercase
        if ((!rawResults || rawResults.length === 0) && cleanWord !== cleanWord.toLowerCase()) {
          const lowerRes = hfst.lookup(cleanWord.toLowerCase());
          if (lowerRes && lowerRes.length > 0) {
            rawResults = lowerRes;
          }
        }

        // 3. Try capitalized word (proper nouns)
        if ((!rawResults || rawResults.length === 0)) {
          const capWord = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1);
          if (capWord !== cleanWord) {
            const capRes = hfst.lookup(capWord);
            if (capRes && capRes.length > 0) {
              rawResults = capRes;
            }
          }
        }

        // 4. Try spell-relax canonical representation (e.g. keyboard workaround "l'" -> "ĺ")
        if (SpellRelaxService.hasRelaxPattern(cleanWord, lang)) {
          const canonical = SpellRelaxService.toCanonical(cleanWord, lang);
          if (canonical && canonical !== cleanWord) {
            const canonRes = hfst.lookup(canonical);
              rawResults = [...(rawResults || []), ...canonRes];
          }
        }
      } catch (err) {
        console.warn(`HFST lookup error for "${cleanWord}":`, err);
      }
    }

    // Tag any results in rawResults derived from spell relax
    if (rawResults && rawResults.length > 0) {
      rawResults = SpellRelaxService.tagRawResults(cleanWord, rawResults, lang);
    }

    // If HFST returned results, parse them
    if (rawResults && rawResults.length > 0) {
      const seen = new Set();
      const readings = [];

      for (const [analysisStr, weight] of rawResults) {
        const cleanAnalysis = analysisStr.replace(/@[^@]*@/g, '');
        if (!seen.has(cleanAnalysis)) {
          seen.add(cleanAnalysis);
          readings.push(TagMapper.parse(cleanAnalysis, weight, lang));
        }
      }

      if (readings.length > 0) {
        const lexicalReadings = readings.filter(r => !r.isGuessed);
        const guessedReadings = readings.filter(r => r.isGuessed);

        if (lexicalReadings.length > 0) {
          // Genuine lexical or compound (+Cmp by itself) readings exist.
          // Filter out the entire morphological analysis dependent on +Guess.
          lexicalReadings.sort((a, b) => {
            // Simplest readings first: plain, then derived (+Der/...), then compounds (+Cmp, #)
            const diffComplexity = readingComplexity(a) - readingComplexity(b);
            if (diffComplexity !== 0) return diffComplexity;

            const diffWeight = (a.weight || 0) - (b.weight || 0);
            if (diffWeight !== 0) return diffWeight;

            // When user typed with spell-relax, prioritize matching spell-relax readings
            if (SpellRelaxService.hasRelaxPattern(cleanWord, lang)) {
              if (a.isSplRlx && !b.isSplRlx) return -1;
              if (!a.isSplRlx && b.isSplRlx) return 1;
            }

            // Prioritize nominal root readings (N) before inflected verbal readings (V) when weights are equal
            if (a.pos === 'N' && b.pos !== 'N') return -1;
            if (a.pos !== 'N' && b.pos === 'N') return 1;

            return 0;
          });
          // Retain access to the guessed content for Paradigm Discoverer and optional workbench inspection
          lexicalReadings.guessedReadings = guessedReadings;
          return lexicalReadings;
        } else {
          // Unknown analyses: no genuine lexical readings and no +Cmp by themselves exist.
          // In the workbench morphological annotation for unknown analyses, retain access to guessed content.
          guessedReadings.sort((a, b) => readingComplexity(a) - readingComplexity(b) || (a.weight || 0) - (b.weight || 0));
          guessedReadings.guessedReadings = guessedReadings;
          guessedReadings.isUnknownGuessed = true;
          return guessedReadings;
        }
      }
    }

    // Fallback: Word not found in transducer.
    // Intelligently infer stem and lemma instead of leaving a broken reading
    const inferred = this.inferLemmaAndTags(cleanWord, lang);
    return [inferred];
  }

  // Alias
  analyzeWord(word, language = null) {
    return this.analyze_word(word, language);
  }

  /**
   * Generates a surface word form from an analysis tag string.
   * Strips +SplRlx and +Err/Orth* tags to produce the standard normative form (X for CorrectForm=X).
   * @param {string} analysisStr
   * @param {string} [language]
   * @param {string} [surfaceWord='']
   * @returns {string}
   */
  generate(analysisStr, language = null, surfaceWord = '') {
    if (!analysisStr || typeof analysisStr !== 'string') return surfaceWord || '';
    const lang = normalizeLangCode(language || this.activeLang || 'myv');
    const cleanAnalysis = SpellRelaxService.stripSplRlxAndOrthTags(analysisStr);

    const genHfst = this.generators.get(lang);
    if (genHfst) {
      try {
        const rawResults = genHfst.lookup(cleanAnalysis);
        if (rawResults && rawResults.length > 0) {
          const generated = rawResults[0][0].replace(/@[^@]*@/g, '');
          if (generated) return generated;
        }
      } catch (err) {
        console.warn(`Generator lookup error for "${cleanAnalysis}":`, err);
      }
    }

    // Fallback: Reconstruct canonical standard form using SpellRelaxService
    return SpellRelaxService.getCorrectForm(surfaceWord, analysisStr, lang);
  }

  inferLemmaAndTags(word, language = null) {
    const lang = normalizeLangCode(language || this.activeLang || 'myv');
    const lower = word.toLowerCase();
    let lemma = lower;
    let pos = 'N';
    let upos = 'NOUN';
    let tags = ['N', 'Sg', 'Nom'];
    let feats = 'Case=Nom|Number=Sing';

    if (lang === 'myv' || lang === 'mdf') {
      if (lower.endsWith('тне') && lower.length > 4) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Pl', 'Nom', 'Def'];
        feats = 'Case=Nom|Definite=Def|Number=Plur';
      } else if (lower.endsWith('тнень') && lower.length > 5) {
        lemma = lower.slice(0, -4);
        tags = ['N', 'Pl', 'Gen', 'Def'];
        feats = 'Case=Gen|Definite=Def|Number=Plur';
      } else if (lower.endsWith('сонть') && lower.length > 6) {
        lemma = lower.slice(0, -5);
        tags = ['N', 'Sg', 'Ine', 'Def'];
        feats = 'Case=Ine|Definite=Def|Number=Sing';
      } else if (lower.endsWith('стонть') && lower.length > 7) {
        lemma = lower.slice(0, -6);
        tags = ['N', 'Sg', 'Ela', 'Def'];
        feats = 'Case=Ela|Definite=Def|Number=Sing';
      } else if (lower.endsWith('нтень') && lower.length > 6) {
        lemma = lower.slice(0, -5);
        tags = ['N', 'Sg', 'Dat', 'Def'];
        feats = 'Case=Dat|Definite=Def|Number=Sing';
      } else if (lower.endsWith('сь') && lower.length > 3) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'Sg', 'Nom', 'Def'];
        feats = 'Case=Nom|Definite=Def|Number=Sing';
      } else if (lower.endsWith('со') && lower.length > 3) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'SP', 'Ine', 'Indef'];
        feats = 'Case=Ine|Definite=Ind|Number=SP';
      } else if (lower.endsWith('сто') && lower.length > 4) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'SP', 'Ela', 'Indef'];
        feats = 'Case=Ela|Definite=Ind|Number=SP';
      } else if (lower.endsWith('нь') && lower.length > 3) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'SP', 'Gen', 'Indef'];
        feats = 'Case=Gen|Definite=Ind|Number=SP';
      } else if (lower.endsWith('мс') && lower.length > 3) {
        lemma = lower;
        pos = 'V';
        upos = 'VERB';
        tags = ['V', 'Inf'];
        feats = 'VerbForm=Inf';
      }
    } else if (lang === 'fin') {
      if (lower.endsWith('ssa') || lower.endsWith('ssä')) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Sg', 'Ine'];
        feats = 'Case=Ine|Number=Sing';
      } else if (lower.endsWith('sta') || lower.endsWith('stä')) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Sg', 'Ela'];
        feats = 'Case=Ela|Number=Sing';
      } else if (lower.endsWith('lla') || lower.endsWith('llä')) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Sg', 'Ade'];
        feats = 'Case=Ade|Number=Sing';
      } else if (lower.endsWith('lle')) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Sg', 'All'];
        feats = 'Case=All|Number=Sing';
      } else if (lower.endsWith('ksi')) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Sg', 'Tra'];
        feats = 'Case=Tra|Number=Sing';
      } else if (lower.endsWith('na') || lower.endsWith('nä')) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'Sg', 'Ess'];
        feats = 'Case=Ess|Number=Sing';
      } else if (lower.endsWith('n') && lower.length > 3) {
        lemma = lower.slice(0, -1);
        tags = ['N', 'Sg', 'Gen'];
        feats = 'Case=Gen|Number=Sing';
      } else if (lower.endsWith('t') && lower.length > 3) {
        lemma = lower.slice(0, -1);
        tags = ['N', 'Pl', 'Nom'];
        feats = 'Case=Nom|Number=Plur';
      }
    } else if (lang === 'kpv' || lang === 'koi') {
      if (lower.endsWith('ын') && lower.length > 3) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'Sg', 'Ine'];
        feats = 'Case=Ine|Number=Sing';
      } else if (lower.endsWith('ысь') && lower.length > 4) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Sg', 'Ela'];
        feats = 'Case=Ela|Number=Sing';
      } else if (lower.endsWith('тӧг') || lower.endsWith('тэг')) {
        lemma = lower.slice(0, -3);
        tags = ['N', 'Sg', 'Car'];
        feats = 'Case=Abe|Number=Sing';
      } else if (lower.endsWith('ӧн') || lower.endsWith('эн')) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'Sg', 'Ins'];
        feats = 'Case=Ins|Number=Sing';
      } else if (lower.endsWith('яс') && lower.length > 3) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'Pl', 'Nom'];
        feats = 'Case=Nom|Number=Plur';
      } else if (lower.endsWith('эз') || lower.endsWith('ез')) {
        lemma = lower.slice(0, -2);
        tags = ['N', 'Pl', 'Nom'];
        feats = 'Case=Nom|Number=Plur';
      } else if (lower.endsWith('ны') && lower.length > 3) {
        lemma = lower;
        pos = 'V';
        upos = 'VERB';
        tags = ['V', 'Inf'];
        feats = 'VerbForm=Inf';
      }
    }

    const raw = `${lemma}+${tags.join('+')}`;
    const derivedUpos = TagMapper.deriveUpos(tags);
    return {
      raw,
      lemma,
      pos: TagMapper.uposToPosTag(derivedUpos),
      upos: derivedUpos,
      tags,
      feats,
      featsMap: {},
      isGuessed: true
    };
  }

  /**
   * Analyzes an entire tokenized text structure for a language.
   * Calls analyze_word for each token.
   */
  async analyzeText(text, language = null) {
    const lang = (language || this.activeLang || 'myv').toLowerCase();
    await this.ensureModelForLanguage(lang);

    const sentences = this.tokenize(text, lang);

    for (const sent of sentences) {
      for (const tok of sent.tokens) {
        const readings = this.analyze_word(tok.form, lang);
        tok.readings = readings;
        tok.guessedReadings = readings.guessedReadings || [];
        tok.selectedReadingIndex = 0;
        tok.selectedReading = readings[0] || null;
        tok.isUnrecognized = !!tok.selectedReading?.isGuessed;
        tok.lemma = tok.selectedReading ? tok.selectedReading.lemma : tok.form;
        tok.upos = tok.selectedReading ? tok.selectedReading.upos : (tok.isPunct ? 'PUNCT' : TagMapper.deriveUpos(tok.form));
        if (tok.isPunct || tok.upos === 'PUNCT') {
          tok.deprel = 'punct';
        }
        tok.customReading = null;
        tok.glosses = [];
        tok.selectedGloss = null;
        tok.customGloss = '';
        tok.customGlossLang = 'eng';
      }
    }

    return sentences;
  }
}

export const analyzerService = new AnalyzerService();
