/**
 * Chrome Service Worker (Manifest V3 background script)
 * - Registers context menu items for dictionary translation and moving selections to the Annotator UI.
 * - Dynamically updates context menu with quick dictionary translations when text is selected.
 * - Dispatches full morphological analysis and dictionary lookups to the in-page Dictionary UI.
 * - Handles navigation to the Annotator UI with pre-loaded text and language.
 */

import { analyzerService, normalizeLangCode, KNOWN_LANGUAGES } from './js/services/analyzer-service.js';
import { dictionaryService } from './js/services/dictionary-service.js';
import { storageService } from './js/services/storage-service.js';
import { stripGuessTags } from './js/services/tag-mapper.js';

// Cross-browser WebExtension compatibility alias: maps browser to chrome if needed
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser;
}

let isServicesInitialized = false;

export async function ensureServices(lang = null) {
  try {
    const targetLang = normalizeLangCode(lang || (await storageService.getSetting('ui_src_lang', 'myv')));
    await analyzerService.ensureModelForLanguage(targetLang);
    await dictionaryService.init();
    isServicesInitialized = true;
  } catch (err) {
    console.warn('Background service init warning:', err);
  }
}

// Retains active source language per tab/webpage for instant subsequent lookups
export const tabLanguageCache = new Map();

if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabLanguageCache.delete(tabId);
  });
}

/**
 * Detects language heuristics based on characteristic orthography and alphabet markers.
 * Used as fallback recognition when manually selected/preferred language yields 0 readings.
 */
export function detectLanguageForWord(word, defaultLang = 'myv') {
  if (!word || typeof word !== 'string') return defaultLang;
  const clean = word.trim();

  // 1. Skolt Sámi specific characters (ǥ, ǧ, ǩ, õ, ǯ, ʒ, å, ʹ, ˈ, ẹ)
  if (/[ǩõǧǯʒʼåʹǥˈẹ]/i.test(clean) || /^[kK]åʹll/i.test(clean)) {
    return 'sms';
  }

  // 2. Apurinã specific patterns
  if (/[ãẽĩỹ]/i.test(clean) || /(tx|ts|awapu)/i.test(clean)) {
    return 'apu';
  }

  // 3. Finnish vowel harmony indicator: 'ä' across separate syllables separated by consonants
  if (/[ä].*?[bcdfghjklmnpqrstvwxz]+.*?[ä]/i.test(clean)) {
    return 'fin';
  }

  // 4. North Sámi specific letter ŧ (exclusive to North Sámi; does not exist in sms or smn)
  if (/ŧ/i.test(clean)) {
    return 'sme';
  }

  // 5. General Sámi characters (č, đ, ŋ, š, ž, â)
  if (/[čđŋšžâ]/i.test(clean)) {
    // If the word has 'ä', it cannot be North Sámi (sme uses á and ea, no ä)
    if (/ä/i.test(clean)) {
      return defaultLang === 'smn' ? 'smn' : 'sms';
    }
    // 'á' is used in North Sámi (sme) and Inari Sámi (smn), but not standard Skolt Sámi
    if (/[á]/i.test(clean)) {
      return /[â]/i.test(clean) ? 'smn' : 'sme';
    }
    // 'â' is shared between Skolt Sámi (sms, e.g. piânnai, čâcc, jânnam) and Inari Sámi (smn)
    if (/[â]/i.test(clean)) {
      return defaultLang === 'smn' ? 'smn' : 'sms';
    }
    if (defaultLang && /^(sms|sme|smn|sma)$/.test(defaultLang)) {
      return defaultLang;
    }
    return 'sms';
  }

  // 4. Cyrillic script
  if (/[\u0400-\u04FF]/.test(clean)) {
    if (/[ӧі]/i.test(clean)) return defaultLang === 'koi' ? 'koi' : 'kpv';
    if (/[ӟӝӥӵ]/i.test(clean)) return 'udm';
    return defaultLang && /^(myv|mdf|kpv|koi|udm|sjd)$/.test(defaultLang) ? defaultLang : 'myv';
  }

  return defaultLang || 'myv';
}

/**
 * Ensures the appropriate language analyzer model is loaded and analyzes the word.
 * Priority #1: Immediately checks the manually set / preferred language first for maximum speed.
 * Priority #2: Only if preferred language yields 0 valid readings does language recognition
 *              and candidate language fallback execute.
 */
export async function analyzeWordWithLanguageAssurance(word, preferredLang = 'myv') {
  const cleanWord = (word || '').trim();
  const primaryLang = normalizeLangCode(preferredLang || 'myv');
  if (!cleanWord) return { lang: primaryLang, readings: [] };

  // 1. Priority #1 (Fastest): Test the user's manual/preferred language directly first
  await analyzerService.ensureModelForLanguage(primaryLang);
  await dictionaryService.init();

  let readings = analyzerService.analyze_word(cleanWord, primaryLang);

  // If primaryLang produced valid readings with lemma, return immediately (instant 0ms path)
  if (readings.length > 0 && readings[0].lemma && !readings[0].isGuessed) {
    return { lang: primaryLang, readings };
  }

  // If primaryLang has dictionary entries (in FST dictionary or custom TSV dictionary), retain primaryLang
  const directGlosses = dictionaryService.lookupGlosses(cleanWord, primaryLang, 'all');
  if (directGlosses && directGlosses.length > 0) {
    return { lang: primaryLang, readings };
  }

  // 2. Priority #2 (Fallback Recognition): Try language recognition heuristic if different from primaryLang
  const detectedLang = normalizeLangCode(detectLanguageForWord(cleanWord, primaryLang));
  if (detectedLang !== primaryLang) {
    try {
      await analyzerService.ensureModelForLanguage(detectedLang);
      const detectedReadings = analyzerService.analyze_word(cleanWord, detectedLang);
      if (detectedReadings.length > 0 && detectedReadings[0].lemma && !detectedReadings[0].isGuessed) {
        return { lang: detectedLang, readings: detectedReadings };
      }
    } catch (_) {}
  }

  // 3. Priority #3 (Fallback Candidate Search): Test other supported languages
  const candidateLangs = ['sms', 'myv', 'fin', 'kpv', 'koi', 'apu', 'sme', 'smn', 'mdf', 'udm', 'olo']
    .filter(l => l !== primaryLang && l !== detectedLang);

  const isCyr = /[\u0400-\u04FF]/.test(cleanWord);

  for (const cand of candidateLangs) {
    const candIsCyr = ['myv', 'mdf', 'kpv', 'koi', 'udm', 'sjd'].includes(cand);
    if (isCyr !== candIsCyr && !['sms', 'sme', 'smn', 'fin', 'apu', 'olo'].includes(cand)) {
      continue;
    }

    try {
      await analyzerService.ensureModelForLanguage(cand);
      const candReadings = analyzerService.analyze_word(cleanWord, cand);
      if (candReadings.length > 0 && candReadings[0].lemma && !candReadings[0].isGuessed) {
        return { lang: cand, readings: candReadings };
      }
    } catch (_) {}
  }

  // If no language found valid morphological readings, return primaryLang with original readings
  return { lang: primaryLang, readings };
}

// 1. Context Menus Registration
let lastSelectedText = '';
let isSettingUpMenus = false;
let pendingMenuSetup = false;

export async function setupContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;

  if (isSettingUpMenus) {
    pendingMenuSetup = true;
    return;
  }

  isSettingUpMenus = true;
  try {
    const mode = await storageService.getSetting('ui_context_menu_mode', 'dict');
    const allContexts = ['selection', 'page', 'frame', 'link', 'editable'];

    await new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime?.lastError) {
          const _ = chrome.runtime.lastError;
        }

        const itemsToCreate = [];
        if (mode === 'dict' || mode === 'both') {
          // Direct button: «Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]»
          // Opens in-page floating Dictionary UI with single-token lemma viewing,
          // candidate lemma switching, UralicNLP morphology toggle, and translation language picker.
          itemsToCreate.push({
            id: 'hfst_dict_lookup',
            title: '📖 Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]',
            contexts: allContexts
          });
        }

        if (mode === 'annotator' || mode === 'both') {
          // Direct button: «Analyze Gloss with HFST»
          // Moves selection to the full HFST Workbench / Annotator UI.
          itemsToCreate.push({
            id: 'hfst_move_to_annotator',
            title: '📝 Analyze Gloss with HFST',
            contexts: allContexts
          });
        }

        itemsToCreate.forEach(item => {
          chrome.contextMenus.create(item, () => {
            // ALWAYS check chrome.runtime.lastError to prevent "Unchecked runtime.lastError"
            if (chrome.runtime?.lastError) {
              const _ = chrome.runtime.lastError;
            }
          });
        });

        resolve();
      });
    });
  } catch (_) {
  } finally {
    isSettingUpMenus = false;
    if (pendingMenuSetup) {
      pendingMenuSetup = false;
      await setupContextMenus();
    }
  }
}

if (typeof chrome !== 'undefined') {
  // Execute immediately on script load so context menu buttons are ready on extension reload/startup
  setupContextMenus();
  ensureServices();

  chrome.runtime?.onInstalled?.addListener(() => {
    setupContextMenus();
    ensureServices();
  });

  chrome.runtime?.onStartup?.addListener(() => {
    setupContextMenus();
    ensureServices();
  });
}

// 2. Context Menu Click Handler
export async function handleContextMenuClick(info, tab) {
  let selection = (info.selectionText || '').trim();
  let tabRetainedLang = null;

  // If tab exists, query it for target word and any page-retained language
  if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'get_target_word' });
      if (resp?.text && !selection) {
        selection = resp.text.trim();
      }
      if (resp?.srcLang) {
        tabRetainedLang = resp.srcLang;
      }
    } catch (_) {}
  }

  // Also check in-memory tab language cache if content script response didn't specify
  if (!tabRetainedLang && tab?.id && tabLanguageCache.has(tab.id)) {
    tabRetainedLang = tabLanguageCache.get(tab.id);
  }

  if (!selection && lastSelectedText) {
    selection = lastSelectedText.trim();
  }

  if (!selection) {
    selection = 'piânnai';
  }

  await ensureServices();
  const storedLang = await storageService.getSetting('ui_src_lang', 'myv');
  const srcLang = normalizeLangCode(tabRetainedLang || storedLang);
  const currentTgt = await storageService.getSetting('ui_tgt_lang', 'all');

  // 1. Glosser item (Move selection to Annotator/Glosser Workbench)
  if (info.menuItemId === 'hfst_move_to_annotator') {
    const encodedText = encodeURIComponent(selection);
    const url = `index.html?text=${encodedText}&lang=${srcLang}&tgt=${currentTgt || 'all'}`;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    }
    return { action: 'glosser', url, text: selection, srcLang, tgtLang: currentTgt };
  }

  // 2. Morphology Toggle items from context menu
  if (info.menuItemId === 'hfst_dict_morph_with') {
    await storageService.setSetting('ui_show_morphology', true);
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang, { showMorphology: true });
    return { action: 'morphology_toggle', showMorphology: true, cardData };
  }

  if (info.menuItemId === 'hfst_dict_morph_without') {
    await storageService.setSetting('ui_show_morphology', false);
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang, { showMorphology: false });
    return { action: 'morphology_toggle', showMorphology: false, cardData };
  }

  // 3. Translation Language Picker items from context menu
  if (info.menuItemId && info.menuItemId.startsWith('hfst_tgt_')) {
    const pickedLang = info.menuItemId.replace('hfst_tgt_', '');
    await storageService.setSetting('ui_tgt_lang', pickedLang);
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang, { tgtLang: pickedLang });
    return { action: 'pick_translation_language', tgtLang: pickedLang, cardData };
  }

  // 4. Single-token Lemma Viewing / Dictionary default item
  if (info.menuItemId === 'hfst_dict_menu' || info.menuItemId === 'hfst_dict_view_lemma' || info.menuItemId === 'hfst_dict_lookup') {
    const cardData = await handleShowDictionaryCard(tab, selection, srcLang);
    return { action: 'view_lemma_dictionary', cardData };
  }

  return null;
}

if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
}

/**
 * Prepares morphological analysis & dictionary glosses, then instructs
 * the tab content script to display the floating Dictionary UI card.
 */
export async function handleShowDictionaryCard(tab, text, srcLang = null, options = {}) {
  const cleanText = (text || '').trim();
  const isPhrase = /\s+/.test(cleanText);
  let cardData = null;

  const tabRetained = (tab?.id && tabLanguageCache.has(tab.id)) ? tabLanguageCache.get(tab.id) : null;
  const storedLang = await storageService.getSetting('ui_src_lang', 'myv');
  const preferredLang = normalizeLangCode(srcLang || tabRetained || storedLang);

  if (!isPhrase) {
    // Single Word: Detailed morphological parsing with automatic language assurance & candidate glosses
    const { lang: resolvedLang, readings } = await analyzeWordWithLanguageAssurance(cleanText, preferredLang);

    // Retain this language for this tab for subsequent lookups on this webpage
    if (tab?.id && resolvedLang) {
      tabLanguageCache.set(tab.id, resolvedLang);
    }

    // Filter out and prioritize non-guessed readings for dictionary lookup
    const nonGuessedReadings = readings.filter(r => !r.isGuessed);
    const candidateReadings = nonGuessedReadings.length > 0 ? nonGuessedReadings : readings;

    // Prefer exact lemma match (e.g. 'aiku' over derivational 'awa')
    const exactMatch = candidateReadings.find(r => r.lemma && r.lemma.toLowerCase() === cleanText.toLowerCase());
    const primaryReading = exactMatch || candidateReadings[0] || {};
    let primaryLemma = options.lemma || primaryReading.lemma || cleanText;
    primaryLemma = stripGuessTags(primaryLemma || '') || cleanText;
    const allLemmas = Array.from(new Set([
      primaryLemma,
      ...candidateReadings.map(r => stripGuessTags(r.lemma || '')).filter(Boolean),
      cleanText
    ])).filter(l => !/^(?:\+guess|«\+?guess»)$/i.test(l) && !(/^guess$/i.test(l) && resolvedLang !== 'eng'));

    await dictionaryService.init();
    let glosses = dictionaryService.lookupGlosses(primaryLemma, resolvedLang, 'all');
    if ((!glosses || glosses.length === 0) && cleanText.toLowerCase() !== primaryLemma.toLowerCase()) {
      const fallbackGlosses = dictionaryService.lookupGlosses(cleanText, resolvedLang, 'all');
      if (fallbackGlosses && fallbackGlosses.length > 0) {
        glosses = fallbackGlosses;
      }
    }

    const availableTgtLangs = Array.from(new Set(
      glosses.map(g => (g.lang || '').toLowerCase()).filter(Boolean)
    ));
    const tgtLang = options.tgtLang || (await storageService.getSetting('ui_tgt_lang', 'all'));
    const storedMorph = await storageService.getSetting('ui_show_morphology', true);
    const showMorphology = options.showMorphology !== undefined ? options.showMorphology : (storedMorph !== false);

    cardData = {
      isPhrase: false,
      text: cleanText,
      lemma: primaryLemma,
      allLemmas,
      readings,
      hasMorphology: readings.length > 0 && readings[0].lemma !== undefined && !readings[0].isGuessed,
      showMorphology: showMorphology !== false,
      glosses,
      availableTgtLangs,
      srcLang: resolvedLang,
      tgtLang: tgtLang || 'all',
      availableLangs: dictionaryService.getSourceLanguages()
    };
  } else {
    // Phrase / Sentence: Tokenize and analyze each word
    await analyzerService.ensureModelForLanguage(preferredLang);
    await dictionaryService.init();
    const sentences = await analyzerService.analyzeText(cleanText, preferredLang);
    const tokens = sentences[0]?.tokens || [];

    for (const tok of tokens) {
      if (!tok.isPunct) {
        const nonGuessed = (tok.readings || []).find(r => !r.isGuessed);
        const bestReading = nonGuessed || tok.selectedReading;
        let lem = tok.lemma || (bestReading ? bestReading.lemma : tok.form);
        lem = stripGuessTags(lem || '') || tok.form;
        tok.glosses = dictionaryService.lookupGlosses(lem, preferredLang, 'all');
      }
    }

    if (tab?.id && preferredLang) {
      tabLanguageCache.set(tab.id, preferredLang);
    }

    const tgtLang = options.tgtLang || (await storageService.getSetting('ui_tgt_lang', 'all'));
    cardData = {
      isPhrase: true,
      text: cleanText,
      tokens,
      srcLang: preferredLang,
      tgtLang: tgtLang || 'all',
      availableLangs: dictionaryService.getSourceLanguages()
    };
  }

  // Ensure content script is injected in target tab
  if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch (_) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['js/content/content.js']
        });
      } catch (injErr) {
        console.warn('Could not inject content script:', injErr);
      }
    }

    // Send payload to tab to display the card
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'show_dict_card',
        data: cardData
      });
    } catch (msgErr) {
      console.warn('Failed to send show_dict_card message:', msgErr);
    }
  }

  return cardData;
}

/**
 * Look up quick translation summary for context menu dynamic display.
 */
export async function getQuickTranslationSummary(word, srcLang = 'myv') {
  const cleanWord = (word || '').trim();
  if (!cleanWord) return null;

  const { lang: resolvedLang, readings } = await analyzeWordWithLanguageAssurance(cleanWord, srcLang);
  const nonGuessed = readings.filter(r => !r.isGuessed);
  const candidateReadings = nonGuessed.length > 0 ? nonGuessed : readings;
  const exactMatch = candidateReadings.find(r => r.lemma && r.lemma.toLowerCase() === cleanWord.toLowerCase());
  const primaryReading = exactMatch || candidateReadings[0] || {};
  let primaryLemma = primaryReading.lemma || cleanWord;
  primaryLemma = stripGuessTags(primaryLemma || '') || cleanWord;

  let glosses = dictionaryService.lookupGlosses(primaryLemma, resolvedLang, 'all');
  if ((!glosses || glosses.length === 0) && cleanWord.toLowerCase() !== primaryLemma.toLowerCase()) {
    const fallbackGlosses = dictionaryService.lookupGlosses(cleanWord, resolvedLang, 'all');
    if (fallbackGlosses && fallbackGlosses.length > 0) {
      glosses = fallbackGlosses;
    }
  }

  if (!glosses || glosses.length === 0) return null;

  // Pick top 2-3 glosses, prioritizing user target language setting or common lingua francas (eng, fin, rus, por)
  const prefTarget = (await storageService.getSetting('ui_tgt_lang', 'all') || 'all').toLowerCase();
  const langPriority = [prefTarget, 'eng', 'fin', 'por', 'rus', 'deu', 'swe', 'est'].filter(l => l && l !== 'all');

  const prioritized = [...glosses].sort((a, b) => {
    const aIdx = langPriority.indexOf((a.lang || '').toLowerCase());
    const bIdx = langPriority.indexOf((b.lang || '').toLowerCase());
    const aRank = aIdx === -1 ? 999 : aIdx;
    const bRank = bIdx === -1 ? 999 : bIdx;
    return aRank - bRank;
  });

  const seenLangs = new Set();
  const summaryParts = [];

  for (const g of prioritized) {
    if (!seenLangs.has(g.lang) && summaryParts.length < 3) {
      seenLangs.add(g.lang);
      summaryParts.push(`${g.gloss} (${g.lang})`);
    }
  }

  return summaryParts.length > 0 ? summaryParts.join(', ') : null;
}

/**
 * Dynamically updates dictionary context menu items when user selects text.
 */
export async function updateContextMenuForSelection(text, srcLang = 'myv') {
  if (typeof chrome === 'undefined' || !chrome.contextMenus?.update) return;

  const cleanText = (text || '').trim();
  const baseTitle = '📖 Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup]';

  if (!cleanText || cleanText.length > 50) {
    chrome.contextMenus.update('hfst_dict_lookup', {
      title: baseTitle
    }, () => chrome.runtime?.lastError);
    chrome.contextMenus.update('hfst_dict_menu', {
      title: baseTitle
    }, () => chrome.runtime?.lastError);
    chrome.contextMenus.update('hfst_move_to_annotator', {
      title: '📝 Analyze Gloss with HFST'
    }, () => chrome.runtime?.lastError);
    return;
  }

  const snippet = cleanText.length > 25 ? cleanText.substring(0, 22) + '...' : cleanText;
  const updatedTitle = `📖 Lemma Viewing, Morphology Toggle, and Language Picker [hfst_dict_lookup] ("${snippet}")`;

  chrome.contextMenus.update('hfst_dict_lookup', {
    title: updatedTitle
  }, () => chrome.runtime?.lastError);
  chrome.contextMenus.update('hfst_dict_menu', {
    title: updatedTitle
  }, () => chrome.runtime?.lastError);
  chrome.contextMenus.update('hfst_dict_view_lemma', {
    title: updatedTitle
  }, () => chrome.runtime?.lastError);
  chrome.contextMenus.update('hfst_move_to_annotator', {
    title: '📝 Analyze Gloss with HFST'
  }, () => chrome.runtime?.lastError);
}

// 3. Runtime Message Listener
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'selection_changed') {
      if (sender?.tab?.id && message.srcLang) {
        tabLanguageCache.set(sender.tab.id, message.srcLang);
      }
      if (message.text) {
        lastSelectedText = (message.text || '').trim();
        try {
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ last_selected_text: lastSelectedText });
          }
        } catch (_) {}
      }
      (async () => {
        try {
          const tabLang = sender?.tab?.id ? tabLanguageCache.get(sender.tab.id) : null;
          const stored = await storageService.getSetting('ui_src_lang', 'myv');
          const srcLang = normalizeLangCode(message.srcLang || tabLang || stored);
          await updateContextMenuForSelection(message.text, srcLang);
        } catch (_) {
          // Ignore transient errors
        }
      })();
      return true;
    }

    if (message.action === 'get_last_selection') {
      sendResponse({
        text: lastSelectedText,
        srcLang: (sender?.tab?.id && tabLanguageCache.has(sender.tab.id)) ? tabLanguageCache.get(sender.tab.id) : null
      });
      return true;
    }

    if (message.action === 'request_dict_card') {
      (async () => {
        try {
          const text = (message.text || lastSelectedText || '').trim();
          const targetTab = sender?.tab;
          const tabLang = targetTab?.id ? tabLanguageCache.get(targetTab.id) : null;
          const stored = await storageService.getSetting('ui_src_lang', 'myv');
          const srcLang = normalizeLangCode(message.srcLang || tabLang || stored);
          const cardData = await handleShowDictionaryCard(targetTab, text, srcLang, message.options || {});
          sendResponse({ ok: true, data: cardData });
        } catch (err) {
          console.warn('request_dict_card failed:', err);
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    if (message.action === 'set_page_language') {
      if (sender?.tab?.id && message.lang) {
        tabLanguageCache.set(sender.tab.id, message.lang);
      }
      (async () => {
        try {
          if (message.lang) {
            await storageService.setSetting('ui_src_lang', message.lang);
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    if (message.action === 'set_context_menu_mode') {
      (async () => {
        try {
          await storageService.setSetting('ui_context_menu_mode', message.mode);
          await setupContextMenus();
          sendResponse({ ok: true, mode: message.mode });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    if (message.action === 'open_annotator') {
      const text = encodeURIComponent((message.text || '').trim());
      const lang = normalizeLangCode(message.lang || 'myv');
      chrome.tabs?.create?.({ url: `index.html?text=${text}&lang=${lang}` });
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'lookup_word') {
      // Used by language switcher and in-page lookup inside the floating Dictionary UI
      (async () => {
        try {
          const text = (message.text || '').trim();
          const srcLang = normalizeLangCode(message.srcLang || 'myv');
          if (sender?.tab?.id) {
            tabLanguageCache.set(sender.tab.id, srcLang);
          }
          await storageService.setSetting('ui_src_lang', srcLang);
          await analyzerService.ensureModelForLanguage(srcLang);
          await dictionaryService.init();

          const readings = analyzerService.analyze_word(text, srcLang);
          let activeLemma = (message.lemma || '').trim() || readings[0]?.lemma || text;
          activeLemma = stripGuessTags(activeLemma || '') || text;
          const allLemmas = Array.from(new Set([
            activeLemma,
            ...readings.map(r => stripGuessTags(r.lemma || '')).filter(Boolean),
            text
          ])).filter(l => !/^(?:\+guess|«\+?guess»)$/i.test(l) && !(/^guess$/i.test(l) && srcLang !== 'eng'));
          const glosses = dictionaryService.lookupGlosses(activeLemma, srcLang, 'all');
          const availableTgtLangs = Array.from(new Set(
            glosses.map(g => (g.lang || '').toLowerCase()).filter(Boolean)
          ));
          const tgtLang = message.tgtLang || (await storageService.getSetting('ui_tgt_lang', 'all'));
          const showMorphology = message.showMorphology !== undefined
            ? !!message.showMorphology
            : (await storageService.getSetting('ui_show_morphology', true)) !== false;

          sendResponse({
            data: {
              isPhrase: false,
              text,
              lemma: activeLemma,
              allLemmas,
              readings,
              hasMorphology: readings.length > 0 && readings[0].lemma !== undefined && !readings[0].isGuessed,
              showMorphology,
              glosses,
              availableTgtLangs,
              srcLang,
              tgtLang: tgtLang || 'all',
              availableLangs: dictionaryService.getSourceLanguages()
            }
          });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true; // Keep channel open for async response
    }

    if (message.action === 'get_source_languages') {
      (async () => {
        try {
          await dictionaryService.init();
          sendResponse({ langs: dictionaryService.getSourceLanguages() });
        } catch (err) {
          sendResponse({ langs: KNOWN_LANGUAGES });
        }
      })();
      return true;
    }

    if (message.action === 'save_setting') {
      (async () => {
        try {
          if (message.key) {
            await storageService.setSetting(message.key, message.value);
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }
  });
}
