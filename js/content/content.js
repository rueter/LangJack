/**
 * Content Script: Listens for text selections on web pages, communicates
 * with the background service worker, and displays an in-page floating
 * Dictionary UI card inside an isolated Shadow DOM.
 */

(function () {
  'use strict';

  // Cross-browser WebExtension compatibility alias: maps browser to chrome if needed
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
  }

  // Prevent multiple injections
  if (window.__hfstContentScriptLoaded) return;
  window.__hfstContentScriptLoaded = true;

  let currentHost = null;
  let currentCard = null;
  let currentTriggerHost = null;
  let triggerBubbleEl = null;
  let triggerLoading = false; // the bubble was pressed and the card is being prepared (models can take several seconds)
  let triggerLoadingTimer = null;
  let lastSelectionRect = null;
  let lastClickedWord = '';
  let selectionDebounceTimer = null;

  // Webpage-level language retention: keeps manually set or resolved language for this webpage
  let pageRetainedSrcLang = null;
  try {
    pageRetainedSrcLang = sessionStorage.getItem('hfst_retained_src_lang');
  } catch (_) {}

  if (!pageRetainedSrcLang && typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(['ui_src_lang', 'ui_last_active_lang'], (res) => {
      if (!pageRetainedSrcLang && res) {
        pageRetainedSrcLang = res.ui_src_lang || res.ui_last_active_lang || null;
      }
    });
  }

  // Track user selections to inform context menu in advance
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(notifySelectionChanged, 200);
  });

  document.addEventListener('mouseup', () => {
    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(notifySelectionChanged, 100);
  });

  // Track touch selections on mobile devices (Android / Kiwi / mobile browsers)
  document.addEventListener('touchend', () => {
    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(notifySelectionChanged, 150);
  });

  document.addEventListener('mousedown', (e) => {
    if (currentTriggerHost && e.composedPath && !e.composedPath().includes(currentTriggerHost)) {
      hideTriggerBubble();
    }
  });

  document.addEventListener('touchstart', (e) => {
    if (currentTriggerHost && e.composedPath && !e.composedPath().includes(currentTriggerHost)) {
      hideTriggerBubble();
    }
  }, { passive: true });

  // When user right-clicks on a word anywhere on any webpage
  document.addEventListener('contextmenu', (e) => {
    let text = '';
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      text = sel.toString().trim();
      if (sel.rangeCount > 0) {
        lastSelectionRect = sel.getRangeAt(0).getBoundingClientRect();
      }
    }

    // If text was not highlighted, extract the word right under the mouse cursor!
    if (!text) {
      const wordRange = getWordRangeAtPoint(e.clientX, e.clientY);
      if (wordRange) {
        text = wordRange.toString().trim();
        lastSelectionRect = wordRange.getBoundingClientRect();
      }
    }

    if (text) {
      lastClickedWord = text;
      try {
        chrome.runtime?.sendMessage?.({
          action: 'selection_changed',
          text,
          srcLang: pageRetainedSrcLang
        });
      } catch (_) {}
    }
  });

  function notifySelectionChanged() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hideTriggerBubble();
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length > 80) {
      hideTriggerBubble();
      return;
    }

    try {
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        lastSelectionRect = range.getBoundingClientRect();
      }
      lastClickedWord = text;
      chrome.runtime?.sendMessage?.({
        action: 'selection_changed',
        text,
        srcLang: pageRetainedSrcLang
      });

      // Show floating trigger bubble near selection if dictionary card is not open
      if (!currentCard && lastSelectionRect) {
        showTriggerBubble(lastSelectionRect, text);
      }
    } catch (_) {
      // Extension context might be invalid
    }
  }

  // Listen for messages from background script
  chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ status: 'ok' });
      return true;
    }

    if (message.action === 'get_target_word') {
      const sel = window.getSelection();
      let text = (sel && !sel.isCollapsed) ? sel.toString().trim() : '';
      if (!text && lastClickedWord) {
        text = lastClickedWord;
      }
      sendResponse({ text, srcLang: pageRetainedSrcLang });
      return true;
    }

    if (message.action === 'show_dict_card') {
      showDictionaryCard(message.data);
      sendResponse({ ok: true });
      return true;
    }
  });

  /**
   * Displays the floating trigger bubble near user selection.
   */
  function showTriggerBubble(rect, text) {
    if (triggerLoading) return; // the pressed bubble is still waiting for its card
    hideTriggerBubble();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    currentTriggerHost = document.createElement('div');
    currentTriggerHost.id = 'hfst-trigger-host';
    currentTriggerHost.style.all = 'initial';
    currentTriggerHost.style.position = 'absolute';
    currentTriggerHost.style.top = '0';
    currentTriggerHost.style.left = '0';
    currentTriggerHost.style.width = '100%';
    currentTriggerHost.style.height = '0';
    currentTriggerHost.style.zIndex = '2147483646';

    const shadow = currentTriggerHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .hfst-bubble {
        position: absolute;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #0284c7;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 700;
        padding: 5px 11px;
        border-radius: 20px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.25);
        cursor: pointer;
        user-select: none;
        animation: hfst-pop 0.15s cubic-bezier(0.16, 1, 0.3, 1);
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        white-space: nowrap;
      }
      .hfst-bubble:hover, .hfst-bubble:active {
        background: #0369a1;
        box-shadow: 0 6px 18px rgba(2, 132, 199, 0.45);
        transform: translateY(-1px);
      }
      .hfst-bubble-icon {
        font-size: 13px;
        line-height: 1;
      }
      .hfst-bubble.is-loading {
        cursor: progress;
        background: #0369a1;
        transform: none;
      }
      .hfst-bubble.is-loading .hfst-bubble-icon {
        display: inline-block;
        animation: hfst-spin 0.9s linear infinite;
      }
      .hfst-bubble.is-failed { background: #b45309; }
      @keyframes hfst-spin {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .hfst-bubble.is-loading .hfst-bubble-icon { animation: hfst-pulse 1.2s ease-in-out infinite; }
      }
      @keyframes hfst-pulse {
        50% { opacity: 0.35; }
      }
      @keyframes hfst-pop {
        from { opacity: 0; transform: scale(0.85); }
        to { opacity: 1; transform: scale(1); }
      }
    `;
    shadow.appendChild(style);

    triggerBubbleEl = document.createElement('div');
    triggerBubbleEl.className = 'hfst-bubble';
    triggerBubbleEl.setAttribute('role', 'button');
    triggerBubbleEl.setAttribute('aria-label', 'Look up in LangJack');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'hfst-bubble-icon';
    iconSpan.textContent = '📖';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'LangJack';

    triggerBubbleEl.append(iconSpan, labelSpan);

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    // Below the selection: on Android the browser's own bar (Google Translate and the like) and its
    // copy/search menu sit above it and cover anything placed there. The selection handles hang a
    // little under the text, so a touch screen gets a bigger gap. Above is only the fallback, for a
    // selection at the very bottom of the screen.
    const touchScreen = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const gap = touchScreen ? 34 : 8;
    const bubbleHeight = 30;
    let top = rect.bottom + scrollY + gap;
    if (rect.bottom + gap + bubbleHeight > window.innerHeight && rect.top - 36 >= 10) {
      top = rect.top + scrollY - 36;
    }
    let left = rect.left + scrollX + (rect.width / 2) - 45;
    const maxLeft = (window.innerWidth + scrollX) - 105;
    left = Math.max(scrollX + 8, Math.min(left, maxLeft));

    triggerBubbleEl.style.top = `${Math.round(top)}px`;
    triggerBubbleEl.style.left = `${Math.round(left)}px`;

    const handleTrigger = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (triggerLoading) return; // click and touchend both arrive; a second press must not start a second lookup
      // Stay on screen and show that something is going on: the first lookup can load a model, which takes seconds.
      triggerLoading = true;
      triggerBubbleEl.classList.remove('is-failed');
      triggerBubbleEl.classList.add('is-loading');
      triggerBubbleEl.setAttribute('aria-busy', 'true');
      labelSpan.textContent = 'Looking up…';
      clearTimeout(triggerLoadingTimer);
      triggerLoadingTimer = setTimeout(() => hideTriggerBubble(true), 60000);
      const bubble = triggerBubbleEl;
      const failed = () => {
        if (triggerBubbleEl !== bubble) return; // already replaced by the card
        triggerLoading = false;
        clearTimeout(triggerLoadingTimer);
        bubble.classList.remove('is-loading');
        bubble.classList.add('is-failed');
        bubble.removeAttribute('aria-busy');
        labelSpan.textContent = 'Try again';
      };
      try {
        const sent = chrome.runtime?.sendMessage?.({
          action: 'request_dict_card',
          text: text,
          srcLang: pageRetainedSrcLang
        }, (response) => {
          void chrome.runtime?.lastError;
          if (triggerBubbleEl !== bubble) return;
          // the card is shown before the answer arrives, so a bubble still here means it did not come
          if (!response || response.error) failed();
          else hideTriggerBubble(true);
        });
        if (sent && typeof sent.catch === 'function') sent.catch(() => {});
      } catch (_) {
        failed();
      }
    };

    triggerBubbleEl.addEventListener('click', handleTrigger);
    triggerBubbleEl.addEventListener('touchend', handleTrigger);

    shadow.appendChild(triggerBubbleEl);
    document.body.appendChild(currentTriggerHost);
  }

  function hideTriggerBubble(force = false) {
    if (triggerLoading && !force) return; // a lookup is under way: only its result or failure takes the bubble away
    triggerLoading = false;
    clearTimeout(triggerLoadingTimer);
    if (currentTriggerHost && currentTriggerHost.parentNode) {
      currentTriggerHost.parentNode.removeChild(currentTriggerHost);
    }
    currentTriggerHost = null;
    triggerBubbleEl = null;
  }

  /**
   * Displays the in-page Dictionary UI inside a Shadow DOM container.
   */
  function showDictionaryCard(data) {
    if (!data) return;

    // Dismiss any trigger bubble
    hideTriggerBubble(true);

    // Retain language after first use on webpage
    if (data.srcLang) {
      pageRetainedSrcLang = data.srcLang;
      try {
        sessionStorage.setItem('hfst_retained_src_lang', data.srcLang);
      } catch (_) {}
    }

    // Remove any existing card
    closeDictionaryCard();

    // Create container and Shadow Root for complete CSS isolation
    currentHost = document.createElement('div');
    currentHost.id = 'hfst-dict-overlay-host';
    currentHost.style.all = 'initial';
    currentHost.style.position = 'absolute';
    currentHost.style.top = '0';
    currentHost.style.left = '0';
    currentHost.style.width = '100%';
    currentHost.style.height = '0';
    currentHost.style.zIndex = '2147483647'; // Maximum z-index

    const shadow = currentHost.attachShadow({ mode: 'open' });

    // Inject scoped styles
    const styleEl = document.createElement('style');
    styleEl.textContent = getCardStyles();
    shadow.appendChild(styleEl);

    // Build Card Element
    currentCard = document.createElement('div');
    currentCard.className = 'hfst-card';

    // Position Card near user selection
    const pos = calculateCardPosition();
    currentCard.style.top = `${pos.top}px`;
    currentCard.style.left = `${pos.left}px`;

    renderCardContent(currentCard, data, shadow);
    shadow.appendChild(currentCard);
    document.body.appendChild(currentHost);

    // Make Card Draggable
    makeDraggable(currentCard, currentCard.querySelector('.hfst-header'));

    // Global dismiss listeners
    setTimeout(() => {
      document.addEventListener('keydown', handleGlobalKeydown);
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick, { passive: true });
    }, 50);
  }

  const TARGET_LANG_NAMES = {
    all: 'All Languages',
    eng: 'English',
    fin: 'Finnish',
    rus: 'Russian',
    por: 'Portuguese',
    deu: 'German',
    nob: 'Norwegian',
    swe: 'Swedish',
    sme: 'North Sámi',
    smn: 'Inari Sámi',
    sms: 'Skolt Sámi',
    sjd: 'Kildin Sámi',
    sju: 'Ume Sámi',
    est: 'Estonian',
    myv: 'Erzya',
    mdf: 'Moksha',
    kpv: 'Komi',
    koi: 'Komi-Permyak',
    udm: 'Udmurt',
    fra: 'French',
    spa: 'Spanish'
  };

  function renderCardContent(cardEl, data, shadow) {
    const isPhrase = !!data.isPhrase;
    const word = data.text || '';
    const srcLang = data.srcLang || 'myv';
    const langs = data.availableLangs || {
      sms: 'Skolt Sami',
      myv: 'Erzya',
      vro: 'Võro',
      fin: 'Finnish',
      kpv: 'Komi-Zyrian',
      koi: 'Komi-Permyak',
      apu: 'Apurinã',
      mdf: 'Moksha',
      sme: 'North Sami',
      smn: 'Inari Sami',
      sma: 'South Sami',
      olo: 'Livvi-Karelian',
      udm: 'Udmurt',
      mhr: 'Meadow Mari',
      mrj: 'Hill Mari',
      vep: 'Veps',
      est: 'Estonian',
      liv: 'Livonian',
      vot: 'Votic',
      izt: 'Ingrian'
    };

    // Lang selector options
    const langOptions = Object.entries(langs).map(([code, name]) => {
      const selected = code.toLowerCase() === srcLang.toLowerCase() ? 'selected' : '';
      return `<option value="${code}" ${selected}>${code} (${name})</option>`;
    }).join('');

    let bodyHtml = '';

    if (!isPhrase) {
      // Single Word Layout
      const readings = data.readings || [];
      const activeReadingIndex = data.activeReadingIndex || 0;
      const primary = readings[activeReadingIndex] || readings[0] || {};
      const activeLemma = data.lemma || primary.lemma || word;
      const extractedLemmas = readings.map(r => r.lemma).filter(Boolean);
      const allLemmas = Array.from(new Set([
        activeLemma,
        ...(data.allLemmas || []),
        ...extractedLemmas,
        ...(extractedLemmas.length === 0 ? [word] : [])
      ])).filter(Boolean);
      const upos = primary.upos || 'NOUN';
      const feats = primary.feats && primary.feats !== '_' ? primary.feats.replace(/\|/g, ' • ') : '';
      const glosses = data.glosses || [];
      const hasMorphology = data.hasMorphology !== undefined
        ? data.hasMorphology
        : (readings.length > 0 && !!readings[0].lemma && !readings[0].isGuessed);
      const showMorphology = data.showMorphology !== false;
      const tgtLang = (data.tgtLang || 'all').toLowerCase();

      // Group glosses by target language
      const glossesByLang = {};
      for (const g of glosses) {
        const langKey = (g.lang || 'all').toLowerCase();
        if (!glossesByLang[langKey]) glossesByLang[langKey] = [];
        if (!glossesByLang[langKey].includes(g.gloss)) {
          glossesByLang[langKey].push(g.gloss);
        }
      }
      const detectedTgtLangs = Object.keys(glossesByLang);

      // Target translation languages dropdown options
      const standardTgtCodes = ['all', 'eng', 'fin', 'por', 'rus', 'deu', 'nob', 'sme', 'sjd', 'sju', 'est'];
      const orderedTgtCodes = Array.from(new Set(['all', ...detectedTgtLangs, ...standardTgtCodes]));
      const tgtLangOptions = orderedTgtCodes.map(code => {
        const count = code === 'all' ? glosses.length : (glossesByLang[code]?.length || 0);
        const isSelected = code === tgtLang ? 'selected' : '';
        const name = TARGET_LANG_NAMES[code] || code.toUpperCase();
        const countLabel = code === 'all' ? `(${count})` : (count > 0 ? `[${count}]` : '');
        return `<option value="${code}" ${isSelected}>${code === 'all' ? '🌐 ' : '🏳️ '}${name} (${code}) ${countLabel}</option>`;
      }).join('');

      // Toolbar with Translation Language Picker and Morphology Toggle
      const toolbarHtml = `
        <div class="hfst-control-toolbar">
          <div class="hfst-toolbar-item">
            <label class="hfst-toolbar-label" for="hfst-tgt-lang-select">Translate to:</label>
            <select id="hfst-tgt-lang-select" class="hfst-tgt-lang-select" title="Pick language for translation">
              ${tgtLangOptions}
            </select>
          </div>
          <div class="hfst-toolbar-item">
            <button type="button" class="hfst-morph-toggle-btn ${showMorphology ? 'hfst-morph-active' : ''}" title="${showMorphology ? 'Hide UralicNLP morphological analysis' : 'Show UralicNLP morphological analysis'}">
              <span class="hfst-morph-icon">${showMorphology ? '🔬' : '📖'}</span>
              <span>Morphology: <strong>${showMorphology ? 'ON' : 'OFF'}</strong></span>
            </button>
          </div>
        </div>
      `;

      // Candidate lemmas pill row
      let altLemmasHtml = '';
      if (allLemmas.length > 1) {
        const altButtons = allLemmas.map(l => {
          const isCurrent = l.toLowerCase() === activeLemma.toLowerCase();
          return `<button type="button" class="hfst-alt-lemma-btn ${isCurrent ? 'selected' : ''}" data-lemma="${escapeHtml(l)}" title="View translations for lemma '${escapeHtml(l)}'">${escapeHtml(l)}</button>`;
        }).join(' ');
        altLemmasHtml = `
          <div class="hfst-alt-lemmas-row">
            <span class="hfst-alt-label">Candidate lemmas:</span>
            ${altButtons}
          </div>
        `;
      }

      // UralicNLP Morphological Analysis Block
      let morphologyHtml = '';
      if (showMorphology) {
        if (hasMorphology) {
          let otherReadingsHtml = '';
          if (readings.length > 1) {
            const otherItems = readings.map((r, idx) => {
              const isSelected = idx === activeReadingIndex;
              const rFeats = r.feats && r.feats !== '_' ? r.feats.replace(/\|/g, ' • ') : '';
              return `
                <div class="hfst-alt-reading-item ${isSelected ? 'selected' : ''}">
                  <div class="hfst-alt-reading-info">
                    <strong>${escapeHtml(r.lemma)}</strong> <span class="hfst-upos-badge hfst-upos-${escapeHtml((r.upos || 'NOUN').toLowerCase())}">${escapeHtml(r.upos || 'NOUN')}</span>
                    ${r.cleanRaw ? `<span style="font-size:11px; color:#475569; margin-left:4px;">${escapeHtml(r.cleanRaw)}</span>` : ''}
                    ${rFeats ? `<span class="hfst-alt-reading-feats">${escapeHtml(rFeats)}</span>` : ''}
                  </div>
                  ${!isSelected ? `<button type="button" class="hfst-btn-select-reading" data-reading-index="${idx}">Select</button>` : '<span class="hfst-badge-active-reading">Active</span>'}
                </div>
              `;
            }).join('');

            otherReadingsHtml = `
              <details class="hfst-alt-readings-details">
                <summary class="hfst-alt-readings-summary">Alternative UralicNLP readings (${readings.length - 1})</summary>
                <div class="hfst-alt-readings-list">${otherItems}</div>
              </details>
            `;
          }

          morphologyHtml = `
            <div class="hfst-morphology-block">
              <div class="hfst-morph-meta-row">
                <span class="hfst-upos-badge hfst-upos-${escapeHtml(upos.toLowerCase())}">${escapeHtml(upos)}</span>
                ${feats ? `<span class="hfst-feats" title="${escapeHtml(feats)}">${escapeHtml(feats)}</span>` : ''}
              </div>
              ${primary.raw ? `<div class="hfst-raw-reading" title="Raw UralicNLP analysis string">${escapeHtml(primary.cleanRaw || stripGuessTags(primary.raw))}</div>` : ''}
              ${otherReadingsHtml}
            </div>
          `;
        } else {
          morphologyHtml = `
            <div class="hfst-no-morph">
              ℹ️ No morphological analysis available from UralicNLP for this token. (Showing direct dictionary lookup)
            </div>
          `;
        }
      } else {
        morphologyHtml = `
          <div class="hfst-clean-view-note">
            ✨ Simple dictionary view (morphological analysis hidden)
          </div>
        `;
      }

      // Word and Lemma Container
      const wordSectionHtml = `
        <div class="hfst-word-section">
          <div class="hfst-form-row">
            <span class="hfst-word-form">${escapeHtml(word)}</span>
            <span class="hfst-single-badge">Single token</span>
          </div>
          <div class="hfst-lemma-box">
            <div class="hfst-lemma-row">
              <span class="hfst-lemma-label">Lemma:</span>
              <strong class="hfst-lemma-val">${escapeHtml(activeLemma)}</strong>
              <button type="button" class="hfst-btn-edit-lemma" title="Edit or test another lemma">✏️</button>
            </div>
            <div class="hfst-lemma-edit-form" style="display: none;">
              <input type="text" class="hfst-lemma-input" value="${escapeHtml(activeLemma)}" placeholder="Type lemma...">
              <button type="button" class="hfst-btn-apply-lemma">Apply</button>
              <button type="button" class="hfst-btn-cancel-lemma">✕</button>
            </div>
            ${altLemmasHtml}
          </div>
          ${morphologyHtml}
        </div>
      `;

      // Dictionary Translations View (supports target language selection)
      let translationsHtml = '';
      if (tgtLang !== 'all') {
        const targetGlosses = glossesByLang[tgtLang] || [];
        const langName = TARGET_LANG_NAMES[tgtLang] || tgtLang.toUpperCase();
        const otherLangs = detectedTgtLangs.filter(code => code.toLowerCase() !== tgtLang.toLowerCase());

        let targetCardHtml = '';
        if (targetGlosses.length > 0) {
          const pills = targetGlosses.map(gl => `<span class="hfst-gloss-pill hfst-gloss-pill-highlight" title="Click to copy">${escapeHtml(gl)}</span>`).join(' ');
          targetCardHtml = `
            <div class="hfst-focused-translation-card">
              <div class="hfst-focused-lang-header">
                <span class="hfst-lang-flag">🏳️</span>
                <strong>${escapeHtml(langName)} Translation${targetGlosses.length > 1 ? 's' : ''}</strong>
                <span class="hfst-count-pill">${targetGlosses.length}</span>
              </div>
              <div class="hfst-gloss-list">${pills}</div>
            </div>
          `;
        } else {
          targetCardHtml = `
            <div class="hfst-no-gloss">
              No <strong>${escapeHtml(langName)}</strong> translation found for lemma <em>${escapeHtml(activeLemma)}</em>.
            </div>
          `;
        }

        // Show other available languages directly underneath so they remain fully accessible!
        let otherLangsHtml = '';
        if (otherLangs.length > 0) {
          const rows = otherLangs.map(code => {
            const lName = TARGET_LANG_NAMES[code] || code.toUpperCase();
            const items = (glossesByLang[code] || []).map(gl => `<span class="hfst-gloss-pill" title="Click to copy">${escapeHtml(gl)}</span>`).join(' ');
            return `
              <div class="hfst-gloss-row" style="margin-top: 6px;">
                <button type="button" class="hfst-quick-lang-btn" data-lang="${code}" title="Set ${escapeHtml(lName)} as primary translation language">${escapeHtml(code.toUpperCase())}</button>
                <div class="hfst-gloss-list">${items}</div>
              </div>
            `;
          }).join('');

          otherLangsHtml = `
            <div class="hfst-other-langs-group" style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
              <div class="hfst-alt-label" style="margin-bottom: 6px; font-weight: 600; color: #64748b;">Other offered translations:</div>
              ${rows}
            </div>
          `;
        }

        translationsHtml = targetCardHtml + otherLangsHtml;
      } else {
        // All languages grouped
        if (detectedTgtLangs.length === 0) {
          translationsHtml = `
            <div class="hfst-no-gloss">
              No dictionary gloss found for lemma <em>${escapeHtml(activeLemma)}</em>.<br>
              Click <strong>Analyze Gloss with HFST</strong> to customize glosses or analyze in workbench.
            </div>
          `;
        } else {
          translationsHtml = detectedTgtLangs.map(langKey => {
            const langName = TARGET_LANG_NAMES[langKey] || langKey.toUpperCase();
            const items = glossesByLang[langKey].map(gl => `<span class="hfst-gloss-pill" title="Click to copy">${escapeHtml(gl)}</span>`).join(' ');
            return `
              <div class="hfst-gloss-row">
                <span class="hfst-lang-tag" title="${escapeHtml(langName)}">${escapeHtml(langKey.toUpperCase())}</span>
                <div class="hfst-gloss-list">${items}</div>
              </div>
            `;
          }).join('');
        }
      }

      bodyHtml = `
        ${toolbarHtml}
        ${wordSectionHtml}
        <div class="hfst-dict-section">
          <div class="hfst-section-title">📖 Dictionary Translation${tgtLang !== 'all' ? ` (${TARGET_LANG_NAMES[tgtLang] || tgtLang.toUpperCase()})` : 's'}:</div>
          ${translationsHtml}
        </div>
      `;
    } else {
      // Sentence / Phrase Mini-Interlinear Layout
      const tokens = data.tokens || [];
      const tokenCards = tokens.map(tok => {
        if (tok.isPunct) {
          return `<div class="hfst-tok-mini hfst-tok-punct">${escapeHtml(tok.form)}</div>`;
        }
        const topGloss = tok.glosses?.[0]?.gloss || '';
        return `
          <div class="hfst-tok-mini">
            <div class="hfst-tok-form">${escapeHtml(tok.form)}</div>
            <div class="hfst-tok-lemma">${escapeHtml(tok.lemma || tok.form)}</div>
            <div class="hfst-tok-upos">${escapeHtml(tok.upos || 'X')}</div>
            <div class="hfst-tok-gloss">${escapeHtml(topGloss || '—')}</div>
          </div>
        `;
      }).join('');

      bodyHtml = `
        <div class="hfst-phrase-original">${escapeHtml(word)}</div>
        <div class="hfst-tokens-track">${tokenCards}</div>
      `;
    }

    setSafeHTML(cardEl, `
      <div class="hfst-header">
        <div class="hfst-header-title">
          <span>📖 HFST Dictionary</span>
          <select class="hfst-lang-select" title="Switch Source Language">
            ${langOptions}
          </select>
        </div>
        <button class="hfst-btn-close" title="Close (Esc)">&times;</button>
      </div>

      <div class="hfst-body">
        ${bodyHtml}
      </div>

      <div class="hfst-footer">
        <button class="hfst-btn hfst-btn-primary hfst-btn-annotator" title="Open full HFST analysis and glossing workbench">
          📝 Analyze Gloss with HFST
        </button>
        <button class="hfst-btn hfst-btn-secondary hfst-btn-copy" title="Copy top translation to clipboard">
          📋 Copy Gloss
        </button>
      </div>
    `);

    // Event Listeners
    cardEl.querySelector('.hfst-btn-close')?.addEventListener('click', closeDictionaryCard);

    // Annotator Workbench button
    cardEl.querySelector('.hfst-btn-annotator')?.addEventListener('click', () => {
      const activeLang = cardEl.querySelector('.hfst-lang-select')?.value || pageRetainedSrcLang || srcLang;
      chrome.runtime?.sendMessage?.({
        action: 'open_annotator',
        text: word,
        lang: activeLang,
        tgt: data.tgtLang || 'all'
      });
      closeDictionaryCard();
    });

    // Copy top translation to clipboard
    cardEl.querySelector('.hfst-btn-copy')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      let textToCopy = '';
      const firstPill = cardEl.querySelector('.hfst-gloss-pill-highlight') || cardEl.querySelector('.hfst-gloss-pill');
      if (firstPill) {
        textToCopy = firstPill.textContent.trim();
      } else {
        const lemma = cardEl.querySelector('.hfst-lemma-val')?.textContent || word;
        textToCopy = lemma.trim();
      }

      if (textToCopy) {
        navigator.clipboard?.writeText?.(textToCopy).then(() => {
          const oldText = btn.textContent;
          btn.textContent = '✓ Copied!';
          setTimeout(() => { btn.textContent = oldText; }, 1500);
        });
      }
    });

    // Clicking individual gloss pill copies it
    cardEl.querySelectorAll('.hfst-gloss-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const text = pill.textContent.trim();
        navigator.clipboard?.writeText?.(text).then(() => {
          const oldBg = pill.style.backgroundColor;
          pill.style.backgroundColor = '#86efac';
          setTimeout(() => { pill.style.backgroundColor = oldBg; }, 600);
        });
      });
    });

    // Morphology Toggle Button (ON / OFF)
    cardEl.querySelector('.hfst-morph-toggle-btn')?.addEventListener('click', () => {
      data.showMorphology = !data.showMorphology;
      chrome.runtime?.sendMessage?.({
        action: 'save_setting',
        key: 'ui_show_morphology',
        value: data.showMorphology
      });
      renderCardContent(cardEl, data, shadow);
    });

    // Translation Target Language Selector
    cardEl.querySelector('.hfst-tgt-lang-select')?.addEventListener('change', (e) => {
      data.tgtLang = e.target.value;
      chrome.runtime?.sendMessage?.({
        action: 'save_setting',
        key: 'ui_tgt_lang',
        value: data.tgtLang
      });
      renderCardContent(cardEl, data, shadow);
    });

    // Quick Language Switch Buttons
    cardEl.querySelectorAll('.hfst-quick-lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        data.tgtLang = btn.getAttribute('data-lang') || 'all';
        chrome.runtime?.sendMessage?.({
          action: 'save_setting',
          key: 'ui_tgt_lang',
          value: data.tgtLang
        });
        renderCardContent(cardEl, data, shadow);
      });
    });

    // Inline Lemma Editor Toggle
    const editBtn = cardEl.querySelector('.hfst-btn-edit-lemma');
    const editForm = cardEl.querySelector('.hfst-lemma-edit-form');
    const lemmaInput = cardEl.querySelector('.hfst-lemma-input');
    const cancelBtn = cardEl.querySelector('.hfst-btn-cancel-lemma');
    const applyBtn = cardEl.querySelector('.hfst-btn-apply-lemma');

    editBtn?.addEventListener('click', () => {
      if (editForm) {
        const isHidden = editForm.style.display === 'none';
        editForm.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && lemmaInput) {
          lemmaInput.focus();
          lemmaInput.select();
        }
      }
    });

    cancelBtn?.addEventListener('click', () => {
      if (editForm) editForm.style.display = 'none';
    });

    const handleApplyLemma = () => {
      const newLemma = (lemmaInput?.value || '').trim();
      if (!newLemma) return;
      chrome.runtime?.sendMessage?.({
        action: 'lookup_word',
        text: word,
        srcLang: cardEl.querySelector('.hfst-lang-select')?.value || srcLang,
        tgtLang: data.tgtLang,
        lemma: newLemma,
        showMorphology: data.showMorphology
      }, (response) => {
        if (response?.data) {
          renderCardContent(cardEl, response.data, shadow);
        }
      });
    };

    applyBtn?.addEventListener('click', handleApplyLemma);
    lemmaInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApplyLemma();
      } else if (e.key === 'Escape') {
        if (editForm) editForm.style.display = 'none';
      }
    });

    // Alternative Candidate Lemma Buttons
    cardEl.querySelectorAll('.hfst-alt-lemma-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const altLemma = btn.getAttribute('data-lemma');
        if (!altLemma) return;
        chrome.runtime?.sendMessage?.({
          action: 'lookup_word',
          text: word,
          srcLang: cardEl.querySelector('.hfst-lang-select')?.value || srcLang,
          tgtLang: data.tgtLang,
          lemma: altLemma,
          showMorphology: data.showMorphology
        }, (response) => {
          if (response?.data) {
            renderCardContent(cardEl, response.data, shadow);
          }
        });
      });
    });

    // Alternative UralicNLP Reading Selection
    cardEl.querySelectorAll('.hfst-btn-select-reading').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-reading-index') || '0', 10);
        data.activeReadingIndex = idx;
        const selectedReading = data.readings?.[idx];
        const selectedLemma = selectedReading?.lemma || data.lemma;
        chrome.runtime?.sendMessage?.({
          action: 'lookup_word',
          text: word,
          srcLang: cardEl.querySelector('.hfst-lang-select')?.value || srcLang,
          tgtLang: data.tgtLang,
          lemma: selectedLemma,
          showMorphology: data.showMorphology
        }, (response) => {
          if (response?.data) {
            response.data.activeReadingIndex = idx;
            renderCardContent(cardEl, response.data, shadow);
          }
        });
      });
    });

    // Source Language Switcher
    cardEl.querySelector('.hfst-lang-select')?.addEventListener('change', async (e) => {
      const newLang = e.target.value;
      pageRetainedSrcLang = newLang;
      try {
        sessionStorage.setItem('hfst_retained_src_lang', newLang);
      } catch (_) {}

      // Retain setting globally and for this tab
      chrome.runtime?.sendMessage?.({
        action: 'save_setting',
        key: 'ui_src_lang',
        value: newLang
      });
      chrome.runtime?.sendMessage?.({
        action: 'set_page_language',
        lang: newLang
      });

      try {
        const bodyEl = cardEl.querySelector('.hfst-body');
        if (bodyEl) {
          const loadingDiv = document.createElement('div');
          loadingDiv.style.padding = '24px';
          loadingDiv.style.textAlign = 'center';
          loadingDiv.style.color = '#64748b';
          loadingDiv.textContent = 'Re-analyzing with new language...';
          bodyEl.replaceChildren(loadingDiv);
        }

        chrome.runtime?.sendMessage?.({
          action: 'lookup_word',
          text: word,
          srcLang: newLang,
          tgtLang: data.tgtLang,
          showMorphology: data.showMorphology
        }, (response) => {
          if (response?.data) {
            renderCardContent(cardEl, response.data, shadow);
          }
        });
      } catch (err) {
        console.warn('Language switch lookup failed:', err);
      }
    });
  }

  function calculateCardPosition() {
    let top = 100;
    let left = 100;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 380;
    const cardWidth = Math.min(380, Math.max(280, viewportWidth - 24));
    const cardHeight = 320;

    const sel = window.getSelection();
    let rect = lastSelectionRect;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    }

    if (rect && (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0)) {
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;

      // Position below selection by default
      top = rect.bottom + scrollY + 10;
      left = rect.left + scrollX;

      // If card overflows bottom of viewport, place above selection
      if (rect.bottom + cardHeight > window.innerHeight && rect.top > cardHeight + 20) {
        top = rect.top + scrollY - cardHeight - 10;
      }

      // Keep within horizontal bounds on mobile and desktop
      const maxLeft = (viewportWidth + scrollX) - cardWidth - 12;
      left = Math.max(scrollX + 12, Math.min(left, maxLeft));
    } else {
      // Centered fallback
      const scrollX = window.scrollX || 0;
      const scrollY = window.scrollY || 0;
      top = scrollY + Math.max(20, (window.innerHeight - cardHeight) / 3);
      left = scrollX + Math.max(12, (viewportWidth - cardWidth) / 2);
    }

    return { top: Math.round(top), left: Math.round(left) };
  }

  /**
   * Extracts text Range for a word directly under a viewport coordinate point (e.g. right-click).
   */
  function getWordRangeAtPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    const textNode = range.startContainer;
    const fullText = textNode.textContent || '';
    const offset = range.startOffset;

    // Word boundary characters regex
    const isBoundary = (ch) => /\s|[.,!?;:()\[\]{}"'«»–—/\\<>]/.test(ch);

    let start = offset;
    while (start > 0 && !isBoundary(fullText[start - 1])) {
      start--;
    }

    let end = offset;
    while (end < fullText.length && !isBoundary(fullText[end])) {
      end++;
    }

    const word = fullText.substring(start, end).trim();
    if (word.length > 0 && word.length <= 60) {
      try {
        const wordRange = document.createRange();
        wordRange.setStart(textNode, start);
        wordRange.setEnd(textNode, end);
        return wordRange;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function makeDraggable(element, handle) {
    if (!handle) return;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = element.offsetLeft;
      initialY = element.offsetTop;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      element.style.left = `${initialX + dx}px`;
      element.style.top = `${initialY + dy}px`;
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  }

  function handleGlobalKeydown(e) {
    if (e.key === 'Escape') {
      closeDictionaryCard();
    }
  }

  function handleOutsideClick(e) {
    if (currentTriggerHost && e.composedPath && !e.composedPath().includes(currentTriggerHost)) {
      hideTriggerBubble();
    }
    if (!currentHost) return;
    // Check if click target is outside the host
    if (e.composedPath && !e.composedPath().includes(currentHost)) {
      closeDictionaryCard();
    }
  }

  function closeDictionaryCard() {
    hideTriggerBubble(true);
    document.removeEventListener('keydown', handleGlobalKeydown);
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('touchstart', handleOutsideClick);

    if (currentHost && currentHost.parentNode) {
      currentHost.parentNode.removeChild(currentHost);
    }
    currentHost = null;
    currentCard = null;
  }

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function stripGuessTags(str) {
    if (!str || typeof str !== 'string') return '';
    let s = str.trim();
    if (/^(?:\+guess|«\+?guess»)$/i.test(s)) return '';
    s = s.replace(/«\+?guess»/gi, '');
    s = s.replace(/\+guess(?=\+|$|#)/gi, '');
    s = s.replace(/#\+?guess(?=\+|$|#)/gi, '#');
    s = s.replace(/(?:\+|#)guess$/i, '');
    s = s.replace(/\+{2,}/g, '+');
    s = s.replace(/^#?\+/, '').replace(/\+#/g, '#').replace(/#\+/g, '#');
    s = s.replace(/\+$/, '');
    if (/^(?:\+guess|«\+?guess»)$/i.test(s.trim())) return '';
    return s.trim();
  }

  function setSafeHTML(container, html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    container.replaceChildren(...doc.body.childNodes);
  }

  function getCardStyles() {
    return `
      :host {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        color: #0f172a;
      }

      * {
        box-sizing: border-box;
      }

      .hfst-card {
        position: absolute;
        width: 380px;
        max-width: calc(100vw - 24px);
        background: #ffffff;
        border-radius: 10px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08);
        overflow: hidden;
        animation: hfst-fade-in 0.18s ease-out;
        z-index: 2147483647;
      }

      @keyframes hfst-fade-in {
        from { opacity: 0; transform: translateY(-4px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .hfst-header {
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
      }

      .hfst-header-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 13px;
        color: #0284c7;
      }

      .hfst-lang-select {
        font-size: 11px;
        padding: 4px 6px;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        background: #ffffff;
        color: #334155;
        cursor: pointer;
        outline: none;
      }

      .hfst-btn-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 18px;
        font-weight: 700;
        cursor: pointer;
        line-height: 1;
        padding: 4px 8px;
        min-width: 28px;
        min-height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        touch-action: manipulation;
      }

      .hfst-btn-close:hover,
      .hfst-btn-close:active {
        color: #ef4444;
        background: #fee2e2;
      }

      .hfst-control-toolbar {
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        padding: 8px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }

      .hfst-toolbar-item {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .hfst-toolbar-label {
        font-size: 11px;
        font-weight: 600;
        color: #64748b;
      }

      .hfst-tgt-lang-select {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 6px;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        background: #ffffff;
        color: #0f172a;
        cursor: pointer;
        outline: none;
      }

      .hfst-morph-toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        background: #ffffff;
        color: #475569;
        cursor: pointer;
        transition: all 0.15s;
      }

      .hfst-morph-toggle-btn:hover {
        background: #f1f5f9;
        border-color: #94a3b8;
      }

      .hfst-morph-toggle-btn.hfst-morph-active {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }

      .hfst-body {
        padding: 14px;
        max-height: 400px;
        overflow-y: auto;
      }

      .hfst-word-section {
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 12px;
        margin-bottom: 12px;
      }

      .hfst-form-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }

      .hfst-word-form {
        font-size: 18px;
        font-weight: 800;
        color: #0f172a;
        word-break: break-word;
      }

      .hfst-single-badge {
        font-size: 10px;
        font-weight: 600;
        background: #f1f5f9;
        color: #64748b;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }

      .hfst-lemma-box {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 8px 10px;
        margin-bottom: 8px;
      }

      .hfst-lemma-row {
        font-size: 12px;
        color: #64748b;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .hfst-lemma-label {
        font-weight: 600;
        color: #64748b;
      }

      .hfst-lemma-val {
        color: #0284c7;
        font-size: 15px;
        font-weight: 700;
      }

      .hfst-btn-edit-lemma {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 12px;
        padding: 1px 4px;
        border-radius: 4px;
        opacity: 0.7;
        transition: opacity 0.15s;
      }

      .hfst-btn-edit-lemma:hover {
        opacity: 1;
        background: #e2e8f0;
      }

      .hfst-lemma-edit-form {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
      }

      .hfst-lemma-input {
        flex: 1;
        font-size: 12px;
        padding: 3px 8px;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        outline: none;
      }

      .hfst-lemma-input:focus {
        border-color: #0284c7;
      }

      .hfst-btn-apply-lemma {
        background: #0284c7;
        color: #ffffff;
        border: none;
        border-radius: 4px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }

      .hfst-btn-apply-lemma:hover {
        background: #0369a1;
      }

      .hfst-btn-cancel-lemma {
        background: #e2e8f0;
        color: #475569;
        border: none;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        cursor: pointer;
      }

      .hfst-alt-lemmas-row {
        margin-top: 6px;
        font-size: 11px;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
      }

      .hfst-alt-label {
        color: #94a3b8;
        font-weight: 600;
        margin-right: 2px;
      }

      .hfst-alt-lemma-btn {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #334155;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .hfst-alt-lemma-btn:hover {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }

      .hfst-alt-lemma-btn.selected {
        background: #0284c7;
        color: #ffffff;
        border-color: #0284c7;
        font-weight: 600;
      }

      .hfst-morphology-block {
        margin-top: 6px;
      }

      .hfst-morph-meta-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 4px;
      }

      .hfst-raw-reading {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        color: #64748b;
        background: #f8fafc;
        border: 1px dashed #cbd5e1;
        border-radius: 4px;
        padding: 2px 6px;
        word-break: break-all;
        margin-top: 4px;
      }

      .hfst-alt-readings-details {
        margin-top: 6px;
        font-size: 11px;
      }

      .hfst-alt-readings-summary {
        color: #0284c7;
        cursor: pointer;
        font-weight: 600;
        user-select: none;
      }

      .hfst-alt-readings-list {
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .hfst-alt-reading-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 3px 6px;
        gap: 6px;
      }

      .hfst-alt-reading-item.selected {
        background: #f0fdf4;
        border-color: #86efac;
      }

      .hfst-alt-reading-info {
        font-size: 11px;
        color: #334155;
      }

      .hfst-alt-reading-feats {
        color: #94a3b8;
        font-size: 10px;
        margin-left: 4px;
      }

      .hfst-btn-select-reading {
        font-size: 10px;
        padding: 1px 6px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 3px;
        cursor: pointer;
        color: #0284c7;
        font-weight: 600;
      }

      .hfst-btn-select-reading:hover {
        background: #e0f2fe;
        border-color: #38bdf8;
      }

      .hfst-badge-active-reading {
        font-size: 10px;
        color: #16a34a;
        font-weight: 700;
      }

      .hfst-clean-view-note {
        font-size: 11px;
        color: #059669;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        border-radius: 4px;
        padding: 4px 8px;
        margin-top: 6px;
      }

      .hfst-no-morph {
        font-size: 11px;
        color: #64748b;
        background: #f8fafc;
        border: 1px dashed #cbd5e1;
        border-radius: 4px;
        padding: 4px 8px;
        margin-top: 6px;
      }

      .hfst-focused-translation-card {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 8px;
        padding: 10px 12px;
      }

      .hfst-focused-lang-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #166534;
        margin-bottom: 6px;
      }

      .hfst-count-pill {
        font-size: 10px;
        font-weight: 700;
        background: #dcfce7;
        color: #15803d;
        padding: 1px 6px;
        border-radius: 10px;
      }

      .hfst-gloss-pill-highlight {
        font-size: 13px;
        font-weight: 700;
        background: #ffffff;
        border: 1px solid #86efac;
        color: #14532d;
        padding: 3px 10px;
      }

      .hfst-other-langs-hint {
        margin-top: 6px;
        font-size: 11px;
        color: #475569;
      }

      .hfst-quick-lang-btn {
        background: #e0f2fe;
        color: #0369a1;
        border: 1px solid #7dd3fc;
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        margin: 2px 2px 0 2px;
        transition: all 0.15s;
      }

      .hfst-quick-lang-btn:hover {
        background: #0284c7;
        color: #ffffff;
      }

      .hfst-upos-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: #e0f2fe;
        color: #0369a1;
      }

      .hfst-upos-verb { background: #dcfce7; color: #15803d; }
      .hfst-upos-noun { background: #e0f2fe; color: #0369a1; }
      .hfst-upos-adj { background: #fef3c7; color: #b45309; }
      .hfst-upos-propn { background: #f3e8ff; color: #7e22ce; }

      .hfst-feats {
        font-size: 11px;
        color: #475569;
        background: #f8fafc;
        padding: 1px 6px;
        border-radius: 4px;
        border: 1px solid #e2e8f0;
      }

      .hfst-dict-section {
        margin-top: 8px;
      }

      .hfst-section-title {
        font-size: 12px;
        font-weight: 700;
        color: #475569;
        margin-bottom: 8px;
      }

      .hfst-gloss-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-bottom: 8px;
      }

      .hfst-lang-tag {
        font-size: 10px;
        font-weight: 800;
        background: #e2e8f0;
        color: #475569;
        padding: 2px 6px;
        border-radius: 4px;
        min-width: 38px;
        text-align: center;
        flex-shrink: 0;
        margin-top: 2px;
      }

      .hfst-gloss-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .hfst-gloss-pill {
        display: inline-block;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #1e293b;
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .hfst-gloss-pill:hover {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
        transform: translateY(-1px);
      }

      .hfst-no-gloss {
        font-size: 12px;
        color: #64748b;
        background: #f8fafc;
        border: 1px dashed #cbd5e1;
        padding: 10px 12px;
        border-radius: 6px;
      }

      .hfst-phrase-original {
        font-size: 15px;
        font-weight: 700;
        color: #0f172a;
        margin-bottom: 10px;
        border-left: 3px solid #0284c7;
        padding-left: 8px;
      }

      .hfst-tokens-track {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 8px;
      }

      .hfst-tok-mini {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 6px 8px;
        min-width: 75px;
        text-align: center;
        flex-shrink: 0;
      }

      .hfst-tok-punct {
        min-width: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: #94a3b8;
      }

      .hfst-tok-form {
        font-weight: 700;
        font-size: 12px;
        color: #0f172a;
      }

      .hfst-tok-lemma {
        font-size: 11px;
        color: #0284c7;
      }

      .hfst-tok-upos {
        font-size: 9px;
        color: #64748b;
        text-transform: uppercase;
      }

      .hfst-tok-gloss {
        font-size: 11px;
        color: #16a34a;
        font-style: italic;
        margin-top: 2px;
        border-top: 1px dashed #cbd5e1;
        padding-top: 2px;
      }

      .hfst-footer {
        background: #f8fafc;
        border-top: 1px solid #e2e8f0;
        padding: 10px 14px;
        display: flex;
        gap: 8px;
        justify-content: space-between;
      }

      .hfst-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s;
        text-decoration: none;
      }

      .hfst-btn-primary {
        background: #0284c7;
        color: #ffffff;
        flex-grow: 1;
      }

      .hfst-btn-primary:hover {
        background: #0369a1;
      }

      .hfst-btn-secondary {
        background: #ffffff;
        border-color: #cbd5e1;
        color: #334155;
      }

      .hfst-btn-secondary:hover {
        background: #f1f5f9;
        color: #0f172a;
      }
    `;
  }
})();
