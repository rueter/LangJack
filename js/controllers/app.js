/**
 * Main Workbench Controller: Connects UI elements, hfst-js analyzer service,
 * dictionary service, interactive token cards, translations, and multi-format exports.
 */

// Cross-browser WebExtension compatibility alias: maps browser to chrome if needed
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser;
}

import { analyzerService, normalizeLangCode } from '../services/analyzer-service.js';
import { dictionaryService, splitGlossItem } from '../services/dictionary-service.js';
import { treebankService } from '../services/treebank-service.js';
import { ConlluExporter } from '../services/conllu-exporter.js';
import { InterlinearExporter } from '../services/interlinear-exporter.js';
import { VerddExporter } from '../services/verdd-exporter.js';
import { storageService } from '../services/storage-service.js';
import { TagMapper, POS_TO_UPOS, UPOS_TO_POS, stripGuessTags } from '../services/tag-mapper.js';
import { dependencyService } from '../services/dependency-service.js';
import { DependencyVisualizer } from '../services/dependency-visualizer.js';
import { paradigmService } from '../services/paradigm-service.js';
import { VerddPanel } from './verdd-panel.js';
import { ConlluImportPanel } from './conllu-import-panel.js';
import { conlluImportService } from '../services/conllu-import-service.js';

export const LANGUAGE_INFO = {
  vro: { name: 'Võro' },
  myv: { name: 'Erzya' },
  mdf: { name: 'Moksha' },
  fin: { name: 'Finnish' },
  sms: { name: 'Skolt Sami' },
  sme: { name: 'North Sami' },
  smn: { name: 'Inari Sami' },
  sma: { name: 'South Sami' },
  kpv: { name: 'Komi-Zyrian' },
  koi: { name: 'Komi-Permyak' },
  udm: { name: 'Udmurt' },
  mhr: { name: 'Meadow Mari' },
  mrj: { name: 'Hill Mari' },
  olo: { name: 'Livvi-Karelian' },
  fkv: { name: 'Kven' },
  fit: { name: 'Meänkieli' },
  vep: { name: 'Veps' },
  est: { name: 'Estonian' },
  liv: { name: 'Livonian' },
  vot: { name: 'Votic' },
  izt: { name: 'Ingrian' },
  apu: { name: 'Apurinã' },
  bxr: { name: 'Buryat' },
  chp: { name: 'Chipewyan' },
  crk: { name: 'Plains Cree' },
  ciw: { name: 'Chippewa' },
  evn: { name: 'Evenki' },
  eng: { name: 'English' },
  rus: { name: 'Russian' },
  deu: { name: 'German' },
  swe: { name: 'Swedish' },
  fra: { name: 'French' },
  spa: { name: 'Spanish' },
  por: { name: 'Portuguese' }
};

export function getLangDisplayName(code) {
  if (!code) return 'Unknown';
  const clean = normalizeLangCode(code);
  if (clean === 'all') return 'All Languages';
  return LANGUAGE_INFO[clean]?.name || clean.toUpperCase();
}

export const UD_UPOS_TAGS = [
  { tag: 'NOUN', desc: 'Noun' },
  { tag: 'PROPN', desc: 'Proper Noun' },
  { tag: 'VERB', desc: 'Verb' },
  { tag: 'ADJ', desc: 'Adjective' },
  { tag: 'ADV', desc: 'Adverb' },
  { tag: 'PRON', desc: 'Pronoun' },
  { tag: 'NUM', desc: 'Numeral' },
  { tag: 'ADP', desc: 'Adposition' },
  { tag: 'AUX', desc: 'Auxiliary' },
  { tag: 'CCONJ', desc: 'Coord Conjunction' },
  { tag: 'SCONJ', desc: 'Subord Conjunction' },
  { tag: 'DET', desc: 'Determiner' },
  { tag: 'PART', desc: 'Particle' },
  { tag: 'INTJ', desc: 'Interjection' },
  { tag: 'SYM', desc: 'Symbol' },
  { tag: 'PUNCT', desc: 'Punctuation' },
  { tag: 'X', desc: 'Other / Unknown' }
];

export class WorkbenchApp {
  constructor() {
    this.sentences = [];
    this.translations = [{ id: 1, lang: 'eng', text: '' }];
    this.srcLang = 'myv';
    this.targetLang = 'all';
    this.activeExportTab = 'conllu';
    this.exportScope = 'current'; // 'current' or 'accumulated'
    this.confirmHandler = null; // Optional confirmation callback function(message) -> boolean
    this.activeTokenInfo = null; // Currently focused/edited token { sIdx, tIdx } to keep centered

    // Treebank Dependency Annotator state
    this.currentAnnotatingTb = null;
    this.workingAnnotatingTokens = [];
    this.selectedAnnotatingTokenId = null;
    this.annotatorActiveTab = 'visual'; // 'visual', 'table', 'conllu'
    this.annotatorLangRelations = [];
    this.annotatorLangCode = 'myv';
    this.isConnectingHead = false;

    // Paradigm Discoverer state (Koskenniemi twol / LexC / LexD)
    this.currentParadigmAnalysis = null;
    this.currentGrammarView = 'twol'; // 'twol', 'lexc', 'lexd'
    this.customMorphRenames = {};

    this.sampleTexts = {
      myv_meeting: {
        src: 'myv',
        tgt: 'all',
        text: 'Вастомась ульнесь пек вадря.',
        translations: [
          { id: 1, lang: 'eng', text: 'The meeting was very good.' },
          { id: 2, lang: 'fin', text: 'Tapaaminen oli erittäin hyvä.' },
          { id: 3, lang: 'rus', text: 'Встреча была очень хорошей.' }
        ]
      },
      myv_boy: {
        src: 'myv',
        tgt: 'all',
        text: 'Цёрась ловны книганть кудосо.',
        translations: [
          { id: 1, lang: 'eng', text: 'The boy reads the book at home.' },
          { id: 2, lang: 'rus', text: 'Парень читает книгу дома.' }
        ]
      },
      fin_animals: {
        src: 'fin',
        tgt: 'all',
        text: 'Kissa nukkuu talossa ja koira juoksee.',
        translations: [
          { id: 1, lang: 'eng', text: 'The cat sleeps in the house and the dog runs.' },
          { id: 2, lang: 'swe', text: 'Katten sover i huset och hunden springer.' }
        ]
      },
      sms_dog: {
        src: 'sms',
        tgt: 'all',
        text: 'Kåʹllvueiʹvv lij šurr piânnai.',
        translations: [
          { id: 1, lang: 'eng', text: 'Goldenhead is a big dog.' },
          { id: 2, lang: 'fin', text: 'Kultapää on suuri koira.' }
        ]
      },
      apu_kyky: {
        src: 'apu',
        tgt: 'por',
        text: 'Kyky atamary anãpa.',
        translations: [
          { id: 1, lang: 'por', text: 'O homem vê o cachorro.' },
          { id: 2, lang: 'eng', text: 'The man sees the dog.' }
        ]
      },
      vro_tree: {
        src: 'vro',
        tgt: 'all',
        text: 'Kand om korgõ puu all.',
        translations: [
          { id: 1, lang: 'est', text: 'Känd on kõrge puu all.' },
          { id: 2, lang: 'eng', text: 'The stump is under the tall tree.' }
        ]
      }
    };
  }

  initConlluImport() {
    const root = document.getElementById('conlluImportRoot');
    const modal = document.getElementById('conlluImportModal');
    if (!root || !modal) return;
    try {
      this.conlluImportPanel = new ConlluImportPanel({
        root,
        service: conlluImportService,
        getSrcLang: () => this.srcLang,
        showToast: (message, type) => this.showToast(message, type),
        confirmAction: (message) => this.confirmAction(message)
      });
      this.conlluImportPanel.init().catch((err) => console.warn('CoNLL-U import panel failed to start:', err));
      const close = () => modal.classList.remove('open');
      document.getElementById('openConlluImportBtn')?.addEventListener('click', () => {
        this.conlluImportPanel.refreshDefaults();
        modal.classList.add('open');
      });
      document.getElementById('closeConlluImportBtn')?.addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    } catch (err) {
      console.warn('CoNLL-U import panel failed to start:', err);
    }
  }

  initVerddPanel() {
    const root = document.getElementById('verddWorkbench');
    if (!root) return;
    const badge = document.getElementById('verddStatusBadge');
    try {
      this.verddPanel = new VerddPanel({
        root,
        store: storageService,
        getWorkspace: () => ({
          sentences: this.sentences,
          translations: this.translations,
          srcLang: this.srcLang,
          targetLang: this.targetLang
        }),
        showToast: (message, type) => this.showToast(message, type),
        confirmAction: (message) => this.confirmAction(message),
        onStatus: (text, state) => {
          if (!badge) return;
          badge.textContent = text;
          badge.dataset.state = state;
        }
      });
      this.verddPanel.init().catch((err) => console.warn("Ve'rdd panel failed to start:", err));
    } catch (err) {
      console.warn("Ve'rdd panel failed to start:", err);
    }
  }

  async init() {
    this.bindDOM();
    this.bindEvents();
    this.initVerddPanel();
    this.initConlluImport();

    try {
      this.showToast('Initializing HFST engine and dictionaries...', 'info');
      await analyzerService.init();
      await dictionaryService.init();
      this.syncSourceLanguagesFromDictionary();
      await treebankService.init();
      this.updateTreebankUI();

      // Restore saved settings or session
      const savedSrc = await storageService.getSetting('ui_src_lang', 'myv');
      const savedTgt = await storageService.getSetting('ui_tgt_lang', 'all');

      this.srcLang = normalizeLangCode(savedSrc);
      this.targetLang = savedTgt === 'all' ? 'all' : normalizeLangCode(savedTgt);

      // Clean stored settings if they contained extra descriptions like "apu (apurinã)"
      if (savedSrc !== this.srcLang) {
        await storageService.setSetting('ui_src_lang', this.srcLang);
      }
      if (savedTgt !== this.targetLang) {
        await storageService.setSetting('ui_tgt_lang', this.targetLang);
      }

      this.ensureOptionInSelect(this.srcLangSelect, this.srcLang, `${this.srcLang} (${getLangDisplayName(this.srcLang)})`);
      this.ensureOptionInSelect(this.inputTextLangSelect, this.srcLang, `${this.srcLang} (${getLangDisplayName(this.srcLang)})`);

      if (this.srcLangSelect) this.srcLangSelect.value = this.srcLang;
      if (this.inputTextLangSelect) this.inputTextLangSelect.value = this.srcLang;
      if (this.tgtLangSelect) this.tgtLangSelect.value = this.targetLang;
      if (this.workspaceGlossLangSelect) this.workspaceGlossLangSelect.value = this.targetLang;
      if (this.settingsDefaultTgtLang) this.settingsDefaultTgtLang.value = this.targetLang;

      this.updateInputAnalyzerBadge();

      // Update model info labels in modal
      this.updateModelStatusDisplay();

      // Check URL query parameters for pre-loaded text and language (e.g. from context menu or popup)
      const urlParams = new URLSearchParams(window.location.search);
      const queryText = urlParams.get('text');
      const queryLang = urlParams.get('lang');
      const queryTgt = urlParams.get('tgt');

      if (queryLang) {
        this.srcLang = normalizeLangCode(queryLang);
        await storageService.setSetting('ui_src_lang', this.srcLang);
        this.ensureOptionInSelect(this.srcLangSelect, this.srcLang, `${this.srcLang} (${getLangDisplayName(this.srcLang)})`);
        this.ensureOptionInSelect(this.inputTextLangSelect, this.srcLang, `${this.srcLang} (${getLangDisplayName(this.srcLang)})`);
        if (this.srcLangSelect) this.srcLangSelect.value = this.srcLang;
        if (this.inputTextLangSelect) this.inputTextLangSelect.value = this.srcLang;
        this.updateInputAnalyzerBadge();
      }

      if (queryTgt) {
        this.targetLang = normalizeLangCode(queryTgt);
        await storageService.setSetting('ui_tgt_lang', this.targetLang);
        if (this.tgtLangSelect) this.tgtLangSelect.value = this.targetLang;
        if (this.workspaceGlossLangSelect) this.workspaceGlossLangSelect.value = this.targetLang;
        if (this.settingsDefaultTgtLang) this.settingsDefaultTgtLang.value = this.targetLang;
      }

      if (queryText) {
        if (this.inputTextArea) this.inputTextArea.value = decodeURIComponent(queryText);
        await this.handleAnalyze();
      } else {
        // Load default sample if input is empty
        await this.loadSample('myv_meeting');
      }

      // Initialize Two-Level Morphology Paradigm Discoverer (Koskenniemi twol)
      this.initParadigmDiscoverer();

      this.showToast('HFST Morphological Engine & Dictionary Ready!', 'success');
    } catch (err) {
      console.error('App init error:', err);
      this.showToast('Error initializing models: ' + err.message, 'error');
    }
  }

  bindDOM() {
    // Language selectors & indicators
    this.srcLangSelect = document.getElementById('srcLangSelect');
    this.inputTextLangSelect = document.getElementById('inputTextLangSelect');
    this.inputAnalyzerBadge = document.getElementById('inputAnalyzerBadge');
    this.tgtLangSelect = document.getElementById('tgtLangSelect');
    this.workspaceGlossLangSelect = document.getElementById('workspaceGlossLangSelect');
    this.settingsDefaultTgtLang = document.getElementById('settingsDefaultTgtLang');

    this.inputTextArea = document.getElementById('inputTextArea');
    this.analyzeBtn = document.getElementById('analyzeBtn');
    this.samplePicker = document.getElementById('samplePicker');
    this.clearBtn = document.getElementById('clearBtn');
    
    // Progress elements
    this.progressBarFill = document.getElementById('progressBarFill');
    this.statTotalTokens = document.getElementById('statTotalTokens');
    this.statAnnotatedTokens = document.getElementById('statAnnotatedTokens');
    this.statPendingGlosses = document.getElementById('statPendingGlosses');
    this.progressPercent = document.getElementById('progressPercent');
    this.autoSelectBtn = document.getElementById('autoSelectBtn');
    this.nextIncompleteBtn = document.getElementById('nextIncompleteBtn');

    // Interlinear container
    this.tokensContainer = document.getElementById('tokensContainer');

    // Translations container
    this.translationsList = document.getElementById('translationsList');
    this.addTranslationBtn = document.getElementById('addTranslationBtn');

    // Export elements
    this.exportTabs = document.querySelectorAll('.export-tab');
    this.exportPreview = document.getElementById('exportPreview');
    this.renewConlluBtn = document.getElementById('renewConlluBtn');
    this.copyExportBtn = document.getElementById('copyExportBtn');
    this.copyTableBtn = document.getElementById('copyTableBtn');
    this.downloadExportBtn = document.getElementById('downloadExportBtn');

    // Modal elements
    this.settingsModal = document.getElementById('settingsModal');
    this.openSettingsBtn = document.getElementById('openSettingsBtn');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');

    // UralicNLP renewal button in top corner
    this.renewUralicModelsTopBtn = document.getElementById('renewUralicModelsTopBtn');

    // Dictionary manager elements
    this.customEntriesTableBody = document.getElementById('customEntriesTableBody');
    this.addEntryBtn = document.getElementById('addEntryBtn');
    this.importDictBtn = document.getElementById('importDictBtn');
    this.exportDictBtn = document.getElementById('exportDictBtn');

    // Treebank Accumulator Elements
    this.saveTreebankBtn = document.getElementById('saveTreebankBtn');
    this.saveAndNextBtn = document.getElementById('saveAndNextBtn');
    this.accumulativeTreebankBadge = document.getElementById('accumulativeTreebankBadge');
    this.accumulativeBadgeCount = document.getElementById('accumulativeBadgeCount');
    this.accumulativeCountPill = document.getElementById('accumulativeCountPill');
    this.scopeCurrentRadio = document.getElementById('scopeCurrentRadio');
    this.scopeAccumulatedRadio = document.getElementById('scopeAccumulatedRadio');
    this.downloadAccumulativeFileBtn = document.getElementById('downloadAccumulativeFileBtn');
    this.downloadSimultaneousBtn = document.getElementById('downloadSimultaneousBtn');
    this.removeAccumulativeFileBtn = document.getElementById('removeAccumulativeFileBtn');
    this.toggleTreebankListBtn = document.getElementById('toggleTreebankListBtn');
    this.accumulatedTreebanksDrawer = document.getElementById('accumulatedTreebanksDrawer');
    this.accumulatedTreebanksTableBody = document.getElementById('accumulatedTreebanksTableBody');
    this.treebankListCount = document.getElementById('treebankListCount');

    // Treebank Download Modal
    this.treebankDownloadModal = document.getElementById('treebankDownloadModal');
    this.closeDownloadModalBtn = document.getElementById('closeDownloadModalBtn');
    this.modalKeepAccumulativeBtn = document.getElementById('modalKeepAccumulativeBtn');
    this.modalRemoveAccumulativeBtn = document.getElementById('modalRemoveAccumulativeBtn');
    this.downloadModalSummary = document.getElementById('downloadModalSummary');

    // Treebank Dependency Annotator Elements
    this.treebankAnnotateModal = document.getElementById('treebankAnnotateModal');
    this.annotateTbTitle = document.getElementById('annotateTbTitle');
    this.annotateTbLangBadge = document.getElementById('annotateTbLangBadge');
    this.prevTreebankBtn = document.getElementById('prevTreebankBtn');
    this.nextTreebankBtn = document.getElementById('nextTreebankBtn');
    this.closeAnnotateModalBtn = document.getElementById('closeAnnotateModalBtn');
    this.annotateTbSentText = document.getElementById('annotateTbSentText');
    this.annotateTbValidationBadge = document.getElementById('annotateTbValidationBadge');
    this.suggestDependenciesBtn = document.getElementById('suggestDependenciesBtn');
    this.toggleManageRelationsBtn = document.getElementById('toggleManageRelationsBtn');
    this.viewTabVisualBtn = document.getElementById('viewTabVisualBtn');
    this.viewTabTableBtn = document.getElementById('viewTabTableBtn');
    this.viewTabConlluBtn = document.getElementById('viewTabConlluBtn');
    this.languageRelationsDrawer = document.getElementById('languageRelationsDrawer');
    this.relationsDrawerLangCode = document.getElementById('relationsDrawerLangCode');
    this.resetLanguageRelationsBtn = document.getElementById('resetLanguageRelationsBtn');
    this.customRelationsTagsContainer = document.getElementById('customRelationsTagsContainer');
    this.newDeprelInput = document.getElementById('newDeprelInput');
    this.newDeprelDescInput = document.getElementById('newDeprelDescInput');
    this.addNewDeprelBtn = document.getElementById('addNewDeprelBtn');
    this.visualArcViewContainer = document.getElementById('visualArcViewContainer');
    this.dependencyVisualizerCanvas = document.getElementById('dependencyVisualizerCanvas');
    this.activeSelectionHint = document.getElementById('activeSelectionHint');
    this.tokenTableViewContainer = document.getElementById('tokenTableViewContainer');
    this.tokenTableBody = document.getElementById('tokenTableBody');
    this.conlluRawViewContainer = document.getElementById('conlluRawViewContainer');
    this.annotateConlluPreview = document.getElementById('annotateConlluPreview');
    this.selectedTokenQuickControls = document.getElementById('selectedTokenQuickControls');
    this.quickTokName = document.getElementById('quickTokName');
    this.quickFormInput = document.getElementById('quickFormInput');
    this.quickLemmaInput = document.getElementById('quickLemmaInput');
    this.quickHeadSelect = document.getElementById('quickHeadSelect');
    this.quickSetRootBtn = document.getElementById('quickSetRootBtn');
    this.quickConnectHeadBtn = document.getElementById('quickConnectHeadBtn');
    this.quickDeprelSelect = document.getElementById('quickDeprelSelect');
    this.quickUposSelect = document.getElementById('quickUposSelect');
    this.downloadThisAnnotatedConlluBtn = document.getElementById('downloadThisAnnotatedConlluBtn');
    this.cancelAnnotateBtn = document.getElementById('cancelAnnotateBtn');
    this.saveAnnotatedTreebankBtn = document.getElementById('saveAnnotatedTreebankBtn');

    // Toast
    this.toastEl = document.getElementById('toast');
  }

  bindEvents() {
    // 1. Text Language Selection (Header & Section 1)
    this.srcLangSelect?.addEventListener('change', (e) => this.handleSrcLangChange(e.target.value));
    this.inputTextLangSelect?.addEventListener('change', (e) => this.handleSrcLangChange(e.target.value));

    // UralicNLP Top Corner Renewal Button (Requirement 1)
    this.renewUralicModelsTopBtn?.addEventListener('click', () => this.handleRenewUralicAnalyzers());

    // 2. Dictionary Gloss Language Selection (Header, Section 2 & Settings)
    this.tgtLangSelect?.addEventListener('change', (e) => this.handleGlossLangChange(e.target.value));
    this.workspaceGlossLangSelect?.addEventListener('change', (e) => this.handleGlossLangChange(e.target.value));
    this.settingsDefaultTgtLang?.addEventListener('change', (e) => this.handleGlossLangChange(e.target.value));

    this.analyzeBtn.addEventListener('click', () => this.handleAnalyze());

    this.clearBtn.addEventListener('click', () => {
      this.inputTextArea.value = '';
      this.sentences = [];
      this.activeTokenInfo = null;
      this.renderInterlinear();
      this.updateDashboard();
      this.updateExports();
    });

    this.samplePicker.addEventListener('change', (e) => {
      if (e.target.value) {
        this.loadSample(e.target.value);
      }
    });

    this.autoSelectBtn.addEventListener('click', () => {
      this.autoSelectFirstOption();
    });

    this.nextIncompleteBtn.addEventListener('click', () => {
      this.jumpToNextIncomplete();
    });

    this.addTranslationBtn.addEventListener('click', () => {
      this.addTranslationRow();
    });

    // Export tabs
    this.exportTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.exportTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeExportTab = tab.dataset.format;
        this.updateExports();
      });
    });

    this.renewConlluBtn?.addEventListener('click', () => this.renewAllConlluReadings());
    this.copyExportBtn.addEventListener('click', () => this.handleCopyExport());
    this.copyTableBtn.addEventListener('click', () => this.handleCopyHtmlTable());
    this.downloadExportBtn.addEventListener('click', () => this.handleDownloadExport());

    // Settings Modal
    this.openSettingsBtn.addEventListener('click', () => this.openModal());
    this.closeSettingsBtn.addEventListener('click', () => this.closeModal());
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.closeModal();
    });

    // Model management in modal
    const nightlyModelLang = document.getElementById('nightlyModelLang');
    const nightlyModelCustomInput = document.getElementById('nightlyModelLangCustomInput');
    if (nightlyModelLang) {
      nightlyModelLang.addEventListener('change', () => {
        if (nightlyModelLang.value === 'custom') {
          if (nightlyModelCustomInput) {
            nightlyModelCustomInput.style.display = 'inline-block';
            nightlyModelCustomInput.focus();
          } else {
            const code = prompt('Enter 3-letter ISO language code for UralicNLP nightly model (e.g. vro, liv, fit, vep, mhr):', this.srcLang || 'vro');
            if (code && code.trim()) {
              const clean = normalizeLangCode(code);
              this.ensureOptionInSelect(nightlyModelLang, clean, `${clean} (${getLangDisplayName(clean)})`);
              nightlyModelLang.value = clean;
            } else {
              nightlyModelLang.value = this.srcLang || 'myv';
            }
          }
        } else {
          if (nightlyModelCustomInput) {
            nightlyModelCustomInput.style.display = 'none';
          }
        }
      });
    }
    document.getElementById('downloadModelBtn')?.addEventListener('click', () => this.handleDownloadModel());
    document.getElementById('uploadModelInput')?.addEventListener('change', (e) => this.handleUploadModel(e));
    document.getElementById('downloadDictBtn')?.addEventListener('click', () => this.handleDownloadDict());
    document.getElementById('uploadDictInput')?.addEventListener('change', (e) => this.handleUploadDict(e));

    // Custom Dictionary manager events
    this.addEntryBtn.addEventListener('click', () => this.handleAddCustomEntry());
    this.importDictBtn.addEventListener('click', () => this.handleImportDictionary());
    this.exportDictBtn.addEventListener('click', () => this.handleExportDictionary());

    // Treebank Accumulator Events
    this.saveTreebankBtn?.addEventListener('click', () => this.handleSaveCompletedTreebank(false));
    this.saveAndNextBtn?.addEventListener('click', () => this.handleSaveCompletedTreebank(true));
    this.accumulativeTreebankBadge?.addEventListener('click', () => this.toggleTreebankList());
    this.scopeCurrentRadio?.addEventListener('change', () => this.setExportScope('current'));
    this.scopeAccumulatedRadio?.addEventListener('change', () => this.setExportScope('accumulated'));
    this.downloadAccumulativeFileBtn?.addEventListener('click', () => this.handleDownloadAccumulativeFile());
    this.downloadSimultaneousBtn?.addEventListener('click', () => this.handleDownloadSimultaneous());
    this.removeAccumulativeFileBtn?.addEventListener('click', () => this.handleRemoveAccumulativeFile());
    this.toggleTreebankListBtn?.addEventListener('click', () => this.toggleTreebankList());

    this.closeDownloadModalBtn?.addEventListener('click', () => this.closeDownloadModal());
    this.modalKeepAccumulativeBtn?.addEventListener('click', () => this.closeDownloadModal());
    this.modalRemoveAccumulativeBtn?.addEventListener('click', () => {
      this.closeDownloadModal();
      this.handleRemoveAccumulativeFile();
    });
    this.treebankDownloadModal?.addEventListener('click', (e) => {
      if (e.target === this.treebankDownloadModal) this.closeDownloadModal();
    });

    // Treebank Dependency Annotator Events
    this.closeAnnotateModalBtn?.addEventListener('click', () => this.closeTreebankAnnotator());
    this.cancelAnnotateBtn?.addEventListener('click', () => this.closeTreebankAnnotator());
    this.treebankAnnotateModal?.addEventListener('click', (e) => {
      if (e.target === this.treebankAnnotateModal) this.closeTreebankAnnotator();
    });
    this.prevTreebankBtn?.addEventListener('click', () => this.navigateTreebankAnnotator(-1));
    this.nextTreebankBtn?.addEventListener('click', () => this.navigateTreebankAnnotator(1));
    this.suggestDependenciesBtn?.addEventListener('click', () => this.suggestAnnotatorDependencies());
    this.toggleManageRelationsBtn?.addEventListener('click', () => this.toggleLanguageRelationsDrawer());
    this.resetLanguageRelationsBtn?.addEventListener('click', () => this.handleResetLanguageRelations());
    this.addNewDeprelBtn?.addEventListener('click', () => this.handleAddCustomRelation());

    this.viewTabVisualBtn?.addEventListener('click', () => this.setAnnotatorViewTab('visual'));
    this.viewTabTableBtn?.addEventListener('click', () => this.setAnnotatorViewTab('table'));
    this.viewTabConlluBtn?.addEventListener('click', () => this.setAnnotatorViewTab('conllu'));

    this.quickFormInput?.addEventListener('input', (e) => this.handleQuickFormChange(e.target.value));
    this.quickLemmaInput?.addEventListener('input', (e) => this.handleQuickLemmaChange(e.target.value));
    this.quickHeadSelect?.addEventListener('change', (e) => this.handleQuickHeadChange(e.target.value));
    this.quickSetRootBtn?.addEventListener('click', () => this.handleQuickSetRoot());
    this.quickConnectHeadBtn?.addEventListener('click', () => this.toggleConnectHeadMode());
    this.quickDeprelSelect?.addEventListener('change', (e) => this.handleQuickDeprelChange(e.target.value));
    this.quickUposSelect?.addEventListener('change', (e) => this.handleQuickUposChange(e.target.value));

    this.saveAnnotatedTreebankBtn?.addEventListener('click', () => this.saveAnnotatedTreebank());
    this.downloadThisAnnotatedConlluBtn?.addEventListener('click', () => this.downloadCurrentAnnotatedSentence());
  }

  async handleSrcLangChange(newLang) {
    if (newLang === 'custom') {
      const code = prompt('Enter 3-letter ISO language code for input text (e.g. olo, sme, kpv, mhr, apu):', this.srcLang);
      if (!code || !code.trim()) {
        if (this.srcLangSelect) this.srcLangSelect.value = this.srcLang;
        if (this.inputTextLangSelect) this.inputTextLangSelect.value = this.srcLang;
        return;
      }
      newLang = normalizeLangCode(code);
      this.ensureOptionInSelect(this.srcLangSelect, newLang, `${newLang} (${getLangDisplayName(newLang)})`);
      this.ensureOptionInSelect(this.inputTextLangSelect, newLang, `${newLang} (${getLangDisplayName(newLang)})`);
    } else {
      newLang = normalizeLangCode(newLang);
    }

    this.srcLang = newLang;
    if (this.srcLangSelect) this.srcLangSelect.value = newLang;
    if (this.inputTextLangSelect) this.inputTextLangSelect.value = newLang;
    this.updateInputAnalyzerBadge();

    await storageService.setSetting('ui_src_lang', this.srcLang);
    this.showToast(`Switched input text language to ${getLangDisplayName(newLang)} (${newLang.toUpperCase()}). Loading analyzer...`, 'info');

    try {
      await analyzerService.setLanguage(this.srcLang);
      this.updateModelStatusDisplay();
      if (this.inputTextArea.value.trim()) {
        await this.handleAnalyze();
      }
    } catch (err) {
      console.error('Failed to switch language analyzer:', err);
      this.showToast('Could not load analyzer for ' + newLang + ': ' + err.message, 'error');
    }
  }

  ensureOptionInSelect(selectEl, value, label) {
    if (!selectEl) return;
    const cleanValue = normalizeLangCode(value);
    const exists = Array.from(selectEl.options).some(opt => normalizeLangCode(opt.value) === cleanValue);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = cleanValue;
      opt.textContent = label;
      const customOpt = selectEl.querySelector('option[value="custom"]');
      if (customOpt) {
        selectEl.insertBefore(opt, customOpt);
      } else {
        selectEl.appendChild(opt);
      }
    }
  }

  syncSourceLanguagesFromDictionary() {
    try {
      const sourceLangs = dictionaryService.getSourceLanguages();
      for (const [code, name] of Object.entries(sourceLangs)) {
        this.ensureOptionInSelect(this.srcLangSelect, code, `${code} (${name})`);
        this.ensureOptionInSelect(this.inputTextLangSelect, code, `${code} (${name})`);
      }
    } catch (err) {
      console.warn('Could not sync source languages from dictionary:', err);
    }
  }

  updateInputAnalyzerBadge() {
    if (!this.inputAnalyzerBadge) return;
    const name = getLangDisplayName(this.srcLang);
    this.inputAnalyzerBadge.textContent = `Analyzer: ${name} (${this.srcLang})`;
  }

  async handleGlossLangChange(newLang) {
    if (newLang === 'custom') {
      const code = prompt('Enter 3-letter ISO language code for dictionary glosses (e.g. fin, rus, deu, eng):', this.targetLang === 'all' ? 'eng' : this.targetLang);
      if (!code || !code.trim()) {
        if (this.tgtLangSelect) this.tgtLangSelect.value = this.targetLang;
        if (this.workspaceGlossLangSelect) this.workspaceGlossLangSelect.value = this.targetLang;
        if (this.settingsDefaultTgtLang) this.settingsDefaultTgtLang.value = this.targetLang;
        return;
      }
      newLang = normalizeLangCode(code);
      this.ensureOptionInSelect(this.tgtLangSelect, newLang, `${newLang} (${getLangDisplayName(newLang)})`);
      this.ensureOptionInSelect(this.workspaceGlossLangSelect, newLang, `${getLangDisplayName(newLang)} (${newLang})`);
      this.ensureOptionInSelect(this.settingsDefaultTgtLang, newLang, `${getLangDisplayName(newLang)} (${newLang})`);
    } else if (newLang !== 'all') {
      newLang = normalizeLangCode(newLang);
    }

    this.targetLang = newLang;
    if (this.tgtLangSelect) this.tgtLangSelect.value = newLang;
    if (this.workspaceGlossLangSelect) this.workspaceGlossLangSelect.value = newLang;
    if (this.settingsDefaultTgtLang) this.settingsDefaultTgtLang.value = newLang;

    await storageService.setSetting('ui_tgt_lang', this.targetLang);

    const defaultTgt = this.targetLang !== 'all' ? this.targetLang.toLowerCase() : null;

    // Apply gloss language filter and default target prioritization to all tokens
    for (const sent of this.sentences) {
      for (const tok of sent.tokens) {
        if (tok.isPunct) continue;

        const lemma = tok.lemma || (tok.selectedReading ? tok.selectedReading.lemma : tok.form);
        tok.allGlosses = dictionaryService.lookupGlosses(lemma, this.srcLang, 'all', defaultTgt);

        tok.activeGlossLangFilter = this.targetLang;
        if (this.targetLang === 'all') {
          tok.glosses = tok.allGlosses || [];
        } else {
          tok.glosses = (tok.allGlosses || []).filter(g => g.lang.toLowerCase() === defaultTgt);
        }

        // Auto-select gloss if user hasn't set custom
        if (!tok.customGloss) {
          if (tok.glosses.length > 0) {
            tok.selectedGloss = tok.glosses[0];
            tok.customGlossLang = tok.selectedGloss.lang;
          } else if ((tok.allGlosses || []).length > 0) {
            tok.selectedGloss = tok.allGlosses[0];
            tok.customGlossLang = tok.selectedGloss.lang;
          }
        }
      }
    }

    this.renderInterlinear();
    this.updateDashboard();
    this.updateExports();

    const label = newLang === 'all' ? 'All Languages' : `${getLangDisplayName(newLang)} (${newLang})`;
    this.showToast(`Default target language: ${label}`, 'info');
  }

  async loadSample(sampleKey) {
    const sample = this.sampleTexts[sampleKey];
    if (!sample) return;

    this.srcLang = sample.src;
    this.targetLang = sample.tgt || 'all';

    if (this.srcLangSelect) this.srcLangSelect.value = this.srcLang;
    if (this.inputTextLangSelect) this.inputTextLangSelect.value = this.srcLang;
    if (this.tgtLangSelect) this.tgtLangSelect.value = this.targetLang;
    if (this.workspaceGlossLangSelect) this.workspaceGlossLangSelect.value = this.targetLang;
    if (this.settingsDefaultTgtLang) this.settingsDefaultTgtLang.value = this.targetLang;

    this.updateInputAnalyzerBadge();
    if (this.inputTextArea) this.inputTextArea.value = sample.text;

    this.translations = JSON.parse(JSON.stringify(sample.translations));
    this.renderTranslations();

    await storageService.setSetting('ui_src_lang', this.srcLang);
    await storageService.setSetting('ui_tgt_lang', this.targetLang);
    this.updateModelStatusDisplay();

    await this.handleAnalyze();
  }

  async handleAnalyze() {
    const text = this.inputTextArea.value.trim();
    if (!text) {
      this.showToast('Please type or paste text to analyze.', 'error');
      return;
    }

    try {
      this.analyzeBtn.disabled = true;
      this.analyzeBtn.textContent = 'Analyzing with HFST...';
      this.activeTokenInfo = null;

      // 1. Morphological Analysis via hfst-js and language-specific transducer
      this.sentences = await analyzerService.analyzeText(text, this.srcLang);

      // 2. Dictionary Gloss Lookup for all tokens
      for (const sent of this.sentences) {
        for (const tok of sent.tokens) {
          this.fetchGlossesForToken(tok);
        }
      }

      // 3. Render UI
      this.renderInterlinear();
      this.renderTranslations();
      this.updateDashboard();
      this.updateExports();

      this.showToast(`Analysis complete! Analyzed ${this.getTotalTokenCount()} tokens.`, 'success');
    } catch (err) {
      console.error('Analysis failed:', err);
      this.showToast('Analysis error: ' + err.message, 'error');
    } finally {
      this.analyzeBtn.disabled = false;
      this.analyzeBtn.textContent = 'Analyze Morphologically (hfst-js)';
    }
  }

  fetchGlossesForToken(tok) {
    if (tok.isPunct) {
      tok.glosses = [];
      tok.allGlosses = [];
      tok.selectedGloss = { gloss: tok.form, lang: this.targetLang !== 'all' ? this.targetLang : 'eng' };
      return;
    }

    // Determine candidate reading for dictionary lookup:
    // Explicit customReading has top priority; otherwise prefer non-guessed readings over guessed readings.
    let reading = tok.customReading;
    if (!reading) {
      if (tok.selectedReading && !tok.selectedReading.isGuessed) {
        reading = tok.selectedReading;
      } else {
        const nonGuessed = (tok.readings || []).find(r => !r.isGuessed);
        reading = nonGuessed || tok.selectedReading;
      }
    }

    let lemma = tok.lemma || (reading ? (reading.lemma || tok.form) : tok.form);
    lemma = stripGuessTags(lemma);
    if (!lemma || (/^guess$/i.test(lemma) && (this.srcLang || '').toLowerCase() !== 'eng')) {
      lemma = tok.form || '';
    }

    const defaultTgt = this.targetLang !== 'all' ? this.targetLang.toLowerCase() : null;

    // Retrieve candidate glosses across all languages with default target prioritized first
    const allGlosses = dictionaryService.lookupGlosses(lemma, this.srcLang, 'all', defaultTgt);
    tok.allGlosses = allGlosses;

    const activeFilter = tok.activeGlossLangFilter || this.targetLang || 'all';
    tok.activeGlossLangFilter = activeFilter;

    if (!activeFilter || activeFilter === 'all') {
      tok.glosses = allGlosses;
    } else {
      tok.glosses = allGlosses.filter(g => g.lang.toLowerCase() === activeFilter.toLowerCase());
    }

    // Auto-select candidate if none chosen yet or if selection is invalid
    if (!tok.customGloss) {
      if (tok.glosses.length > 0) {
        if (!tok.selectedGloss || (activeFilter !== 'all' && tok.selectedGloss.lang.toLowerCase() !== activeFilter.toLowerCase())) {
          tok.selectedGloss = tok.glosses[0];
          tok.customGlossLang = tok.selectedGloss.lang;
        }
      } else if (allGlosses.length > 0) {
        if (!tok.selectedGloss) {
          tok.selectedGloss = allGlosses[0];
          tok.customGlossLang = tok.selectedGloss.lang;
        }
      } else {
        tok.selectedGloss = null;
      }
    }
  }

  relookupAllGlosses() {
    for (const sent of this.sentences) {
      for (const tok of sent.tokens) {
        this.fetchGlossesForToken(tok);
      }
    }
    this.renderInterlinear();
    this.updateDashboard();
    this.updateExports();
  }

  centerTokenCard(sIdx, tIdx, smooth = false) {
    if (!this.tokensContainer) return;
    const card = document.getElementById(`token-card-${sIdx}-${tIdx}`);
    if (!card) return;
    const track = card.closest('.tokens-track');
    if (!track) return;

    let targetScroll;
    if (card.offsetParent === track) {
      targetScroll = card.offsetLeft - (track.clientWidth / 2) + (card.offsetWidth / 2);
    } else {
      const cardRect = card.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      targetScroll = track.scrollLeft + (cardRect.left - trackRect.left) - (trackRect.clientWidth / 2) + (cardRect.width / 2);
    }
    targetScroll = Math.max(0, targetScroll);

    const prevBehavior = track.style.scrollBehavior;
    track.style.scrollBehavior = smooth ? 'smooth' : 'auto';
    track.scrollLeft = targetScroll;
    if (!smooth) {
      track.style.scrollBehavior = prevBehavior;
    }
  }

  renderInterlinear(focusedToken = null) {
    if (!this.tokensContainer) return;

    // Capture previous scrollLeft for each sentence's tokens-track
    const trackScrolls = new Map();
    const existingTracks = this.tokensContainer.querySelectorAll('.tokens-track');
    existingTracks.forEach((tr) => {
      const sIdxAttr = tr.dataset.sidx;
      if (sIdxAttr !== undefined) {
        trackScrolls.set(parseInt(sIdxAttr, 10), tr.scrollLeft);
      }
    });

    this.tokensContainer.replaceChildren();

    if (this.sentences.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.color = 'var(--text-muted)';
      emptyDiv.style.padding = '40px';
      const strong = document.createElement('strong');
      strong.textContent = 'Analyze Morphologically (hfst-js)';
      emptyDiv.append('Type or paste text above and click ', strong, ' to begin interlinear glossing.');
      this.tokensContainer.replaceChildren(emptyDiv);
      return;
    }

    this.sentences.forEach((sent, sIdx) => {
      const sentBlock = document.createElement('div');
      sentBlock.className = 'sentence-block';

      // Header
      const existing = treebankService.findDuplicate(sent, this.srcLang);
      const isSaved = existing !== null;
      const btnClass = isSaved ? 'btn btn-success btn-sm btn-save-sent-tb' : 'btn btn-secondary btn-sm btn-save-sent-tb';
      const btnText = isSaved ? `✓ Saved (#${existing.sent_id})` : `💾 Save Treebank`;
      const btnTitle = isSaved
        ? `Already saved as Treebank #${existing.sent_id} in accumulative file. Repeating this command will ask for confirmation before saving a duplicate.`
        : `Save this completed sentence as the next treebank in order in the accumulative file`;

      const header = document.createElement('div');
      header.className = 'sentence-header';

      const sentOrig = document.createElement('div');
      sentOrig.className = 'sentence-original';
      const sentNum = document.createElement('span');
      sentNum.style.color = 'var(--primary)';
      sentNum.style.fontWeight = '800';
      sentNum.style.marginRight = '8px';
      sentNum.textContent = `Sentence ${sent.sent_id}`;
      sentOrig.append(sentNum, sent.text);

      const metaDiv = document.createElement('div');
      metaDiv.style.fontSize = '12px';
      metaDiv.style.color = 'var(--text-muted)';
      metaDiv.style.display = 'flex';
      metaDiv.style.alignItems = 'center';
      metaDiv.style.gap = '8px';

      const wordCount = document.createElement('span');
      wordCount.textContent = `${sent.tokens.length} words`;

      const annotBtn = document.createElement('button');
      annotBtn.className = 'btn btn-secondary btn-sm btn-annot-sent-tb';
      annotBtn.title = 'Annotate dependency relations (HEAD & DEPREL) for this sentence';
      annotBtn.textContent = '🌲 Annotate';

      const saveBtn = document.createElement('button');
      saveBtn.className = btnClass;
      saveBtn.title = btnTitle;
      saveBtn.textContent = btnText;

      metaDiv.append(wordCount, annotBtn, saveBtn);
      header.append(sentOrig, metaDiv);

      header.querySelector('.btn-annot-sent-tb')?.addEventListener('click', async () => {
        try {
          let tb = treebankService.findDuplicate(sent, this.srcLang);
          if (!tb) {
            tb = await treebankService.saveSentence(sent, this.translations, this.srcLang, this.targetLang);
            this.updateTreebankUI();
            this.updateExports();
            this.showToast(`Saved sentence as Treebank #${tb.sent_id} and opened Dependency Annotator!`, 'success');
          }
          await this.openTreebankAnnotator(tb.id);
        } catch (e) {
          this.showToast('Error opening dependency annotator: ' + e.message, 'error');
        }
      });

      header.querySelector('.btn-save-sent-tb')?.addEventListener('click', async () => {
        try {
          const dup = treebankService.findDuplicate(sent, this.srcLang);
          if (dup) {
            const confirmed = this.confirmAction(
              `Sentence "${sent.text}" has already been saved as Treebank #${dup.sent_id}.\n\nAre you sure you want to save another copy of this treebank to the accumulative file?`
            );
            if (!confirmed) {
              this.showToast(`Save cancelled: duplicate of Treebank #${dup.sent_id} was not added.`, 'info');
              return;
            }
          }

          const tb = await treebankService.saveSentence(sent, this.translations, this.srcLang, this.targetLang);
          this.updateTreebankUI();
          this.updateExports();
          this.showToast(`Saved sentence as Treebank #${tb.sent_id} in accumulative file!`, 'success');
        } catch (e) {
          this.showToast('Error saving treebank: ' + e.message, 'error');
        }
      });

      sentBlock.appendChild(header);

      // Tokens Track
      const track = document.createElement('div');
      track.className = 'tokens-track';
      track.dataset.sidx = sIdx;

      sent.tokens.forEach((tok, tIdx) => {
        const card = this.createTokenCard(tok, sIdx, tIdx);
        track.appendChild(card);
      });

      sentBlock.appendChild(track);
      this.tokensContainer.appendChild(sentBlock);
    });

    // Handle scroll retention and centered token
    const tokenToCenter = focusedToken || this.activeTokenInfo || null;

    const newTracks = this.tokensContainer.querySelectorAll('.tokens-track');
    newTracks.forEach((tr) => {
      const sIdx = parseInt(tr.dataset.sidx, 10);
      if (tokenToCenter && tokenToCenter.sIdx === sIdx) {
        // Handled below by centerTokenCard
      } else if (trackScrolls.has(sIdx)) {
        tr.style.scrollBehavior = 'auto';
        tr.scrollLeft = trackScrolls.get(sIdx);
      }
    });

    if (tokenToCenter && tokenToCenter.sIdx != null && tokenToCenter.tIdx != null) {
      this.centerTokenCard(tokenToCenter.sIdx, tokenToCenter.tIdx, false);
      requestAnimationFrame(() => {
        this.centerTokenCard(tokenToCenter.sIdx, tokenToCenter.tIdx, false);
      });
    }
  }

  renderTokenCards(focusedToken = null) {
    this.renderInterlinear(focusedToken);
  }

  getTotalTokenCount() {
    let count = 0;
    if (this.sentences && Array.isArray(this.sentences)) {
      for (const sent of this.sentences) {
        if (sent && sent.tokens) {
          count += sent.tokens.length;
        }
      }
    }
    return count;
  }

  createTokenCard(tok, sIdx, tIdx) {
    const card = document.createElement('div');
    card.className = 'token-card';
    card.id = `token-card-${sIdx}-${tIdx}`;

    // Track active token when user clicks or focuses any element inside this card
    card.addEventListener('click', () => {
      this.activeTokenInfo = { sIdx, tIdx };
    });
    card.addEventListener('focusin', () => {
      this.activeTokenInfo = { sIdx, tIdx };
    });

    const isUnrec = tok.isUnrecognized || tok.selectedReading?.isGuessed;
    const isComplete = tok.isPunct || (tok.selectedReading && (tok.selectedGloss || tok.customGloss) && !isUnrec);
    if (tok.isPunct) {
      card.classList.add('status-punct');
    } else if (isUnrec) {
      card.classList.add('status-unrecognized');
    } else if (isComplete) {
      card.classList.add('status-complete');
    } else {
      card.classList.add('status-pending');
    }

    // Card Header
    const cardHeader = document.createElement('div');
    cardHeader.className = 'token-card-header';
    const statusText = tok.isPunct ? 'PUNCT' : isUnrec ? '⚠️ UNRECOGNIZED' : isComplete ? '✓ COMPLETE' : 'GLOSS PENDING';
    const statusClass = tok.isPunct ? 'punct' : isUnrec ? 'unrecognized' : isComplete ? 'complete' : 'pending';
    const tokIndexSpan = document.createElement('span');
    tokIndexSpan.className = 'token-index';
    tokIndexSpan.textContent = `Word ${tok.id}`;
    const tokStatusPill = document.createElement('span');
    tokStatusPill.className = `token-status-pill ${statusClass}`;
    tokStatusPill.textContent = statusText;
    cardHeader.append(tokIndexSpan, tokStatusPill);
    card.appendChild(cardHeader);

    // Surface Token Form
    const formRow = document.createElement('div');
    formRow.className = 'token-form-row';
    const formLabel = document.createElement('div');
    formLabel.className = 'token-form-label';
    formLabel.textContent = 'Word Form';
    const formValue = document.createElement('div');
    formValue.className = 'token-form';
    formValue.textContent = tok.form;
    formRow.append(formLabel, formValue);
    card.appendChild(formRow);

    // If punctuation, keep minimal
    if (tok.isPunct) {
      const punctLabel = document.createElement('div');
      punctLabel.style.fontSize = '11px';
      punctLabel.style.color = 'var(--text-muted)';
      punctLabel.textContent = 'Punctuation mark';
      card.appendChild(punctLabel);
      return card;
    }

    // Active reading
    const activeReading = tok.customReading || tok.selectedReading;
    const currentLemma = tok.lemma || (activeReading ? activeReading.lemma : tok.form);
    const currentUpos = tok.upos || (activeReading ? activeReading.upos : (tok.isPunct ? 'PUNCT' : 'NOUN'));

    // Unrecognized word banner
    if (tok.isUnrecognized || activeReading?.isGuessed) {
      const unrecBadge = document.createElement('div');
      unrecBadge.className = 'token-unrecognized-badge';
      unrecBadge.textContent = '⚠️ Unrecognized Word (Estimated Analysis)';
      unrecBadge.title = 'This word was not found in the HFST analyzer transducer. Check Lemma & UPOS below, then click Renew Reading for CoNLL-U.';
      card.appendChild(unrecBadge);
    }

    // Base Lemma & UPOS Grid (Requirement: "The UPOS value for part of speech must be made available")
    const lemmaPosGrid = document.createElement('div');
    lemmaPosGrid.className = 'token-lemma-pos-grid';

    // 1. Base Lemma Box
    const lemmaBox = document.createElement('div');
    lemmaBox.className = 'token-field-box lemma-box';
    const lemmaLabel = document.createElement('div');
    lemmaLabel.className = 'token-field-label';
    lemmaLabel.textContent = 'Base Lemma';
    const lemmaInput = document.createElement('input');
    lemmaInput.type = 'text';
    lemmaInput.className = 'token-lemma-input';
    lemmaInput.value = currentLemma;
    lemmaInput.title = 'Click to edit base lemma';
    lemmaBox.append(lemmaLabel, lemmaInput);

    // 2. UPOS Box (Universal Dependencies Part of Speech)
    const uposBox = document.createElement('div');
    uposBox.className = 'token-field-box upos-box';
    const uposLabel = document.createElement('div');
    uposLabel.className = 'token-field-label';
    uposLabel.textContent = 'Part of Speech (UPOS)';
    uposBox.appendChild(uposLabel);

    const uposSelect = document.createElement('select');
    uposSelect.className = 'token-upos-select';
    uposSelect.title = 'Select Universal Dependencies UPOS tag';

    UD_UPOS_TAGS.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.tag;
      opt.textContent = `${u.tag} (${u.desc})`;
      if (u.tag === currentUpos) opt.selected = true;
      uposSelect.appendChild(opt);
    });

    uposBox.appendChild(uposSelect);
    lemmaPosGrid.appendChild(lemmaBox);
    lemmaPosGrid.appendChild(uposBox);
    card.appendChild(lemmaPosGrid);

    // Sync lemma and upos changes
    lemmaInput.addEventListener('change', (e) => {
      const newLemma = e.target.value.trim();
      if (newLemma) {
        this.activeTokenInfo = { sIdx, tIdx };
        tok.lemma = newLemma;
        const targetReading = tok.customReading || tok.selectedReading;
        if (targetReading) {
          targetReading.lemma = newLemma;
          const tags = Array.isArray(targetReading.tags) && targetReading.tags.length > 0
            ? targetReading.tags
            : [TagMapper.uposToPosTag(tok.upos || 'NOUN')];
          targetReading.raw = `${newLemma}+${tags.join('+')}`;
          tok.upos = TagMapper.deriveUpos(targetReading.raw);
          uposSelect.value = tok.upos;
        }
        this.fetchGlossesForToken(tok);
        this.renderInterlinear({ sIdx, tIdx });
        this.updateExports();
      }
    });

    uposSelect.addEventListener('change', (e) => {
      this.activeTokenInfo = { sIdx, tIdx };
      const newUpos = e.target.value;
      tok.upos = newUpos;
      const posTag = TagMapper.uposToPosTag(newUpos); // e.g. NOUN -> N, VERB -> V

      const targetReading = tok.customReading || tok.selectedReading;
      if (targetReading) {
        targetReading.upos = newUpos;
        targetReading.pos = posTag;
        let tags = Array.isArray(targetReading.tags) ? [...targetReading.tags] : [];
        const pIdx = tags.findIndex(t => POS_TO_UPOS[t]);
        if (pIdx >= 0) {
          tags[pIdx] = posTag;
        } else {
          tags.unshift(posTag);
        }
        targetReading.tags = tags;
        targetReading.raw = `${targetReading.lemma || tok.lemma || tok.form}+${tags.join('+')}`;
        const parsed = TagMapper.parse(targetReading.raw, 0, tok.lang || this.srcLang);
        targetReading.feats = parsed.feats;
        targetReading.featsMap = parsed.featsMap;
        // Re-derive UPOS to ensure direct derivation from morphological analysis output (NOUN < +N)
        tok.upos = TagMapper.deriveUpos(targetReading.raw);
      }
      this.renderInterlinear({ sIdx, tIdx });
      this.updateExports();
    });

    // Morphological Reading Selector
    const morphSection = document.createElement('div');
    const morphLabel = document.createElement('div');
    morphLabel.className = 'section-label';
    morphLabel.textContent = 'Morphological Analysis';
    morphSection.appendChild(morphLabel);

    const readingSelect = document.createElement('select');
    readingSelect.className = 'reading-select';

    (tok.readings || []).forEach((r, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = r.cleanRaw || stripGuessTags(r.raw) || `${r.lemma}+${r.pos}`;
      if (idx === tok.selectedReadingIndex && !tok.customReading && tok.selectedGuessedIndex == null) {
        opt.selected = true;
      }
      readingSelect.appendChild(opt);
    });

    // If guessed readings were filtered out because genuine readings exist, retain access via optgroup
    const hasFilteredGuessed = tok.guessedReadings && tok.guessedReadings.length > 0 &&
      (!tok.readings || !tok.readings.some(r => r.isGuessed));

    if (hasFilteredGuessed) {
      const guessGroup = document.createElement('optgroup');
      guessGroup.label = '── Guessed Analyses (Filtered) ──';
      tok.guessedReadings.forEach((gr, gIdx) => {
        const opt = document.createElement('option');
        opt.value = `guessed_${gIdx}`;
        opt.textContent = gr.raw || gr.cleanRaw || `${gr.lemma}+${gr.pos}`;
        if (tok.selectedGuessedIndex === gIdx && !tok.customReading) {
          opt.selected = true;
        }
        guessGroup.appendChild(opt);
      });
      readingSelect.appendChild(guessGroup);
    }

    // Custom Reading Option
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = tok.customReading ? `Custom: ${tok.customReading.raw}` : '✏️ + Add / Edit Custom Reading...';
    if (tok.customReading) customOpt.selected = true;
    readingSelect.appendChild(customOpt);

    readingSelect.addEventListener('change', (e) => {
      this.activeTokenInfo = { sIdx, tIdx };
      if (e.target.value === 'custom') {
        const current = tok.customReading ? tok.customReading.raw : (tok.selectedReading ? tok.selectedReading.raw : tok.form);
        const input = prompt(`Enter custom morphological analysis for "${tok.form}" (e.g. ${tok.form}+N+Sg+Nom):`, current);
        if (input && input.trim()) {
          const parsed = TagMapper.parse(input.trim(), 0, tok.lang || this.srcLang);
          tok.customReading = parsed;
          tok.lemma = parsed.lemma;
          // Directly derive UPOS from morphological analysis output (NOUN < +N):
          tok.upos = parsed.upos;
          lemmaInput.value = tok.lemma;
          uposSelect.value = tok.upos;
          this.fetchGlossesForToken(tok);
          this.renderInterlinear({ sIdx, tIdx });
          this.updateDashboard();
          this.updateExports();
        } else {
          readingSelect.value = tok.selectedGuessedIndex != null ? `guessed_${tok.selectedGuessedIndex}` : tok.selectedReadingIndex;
        }
      } else if (e.target.value.startsWith('guessed_')) {
        const gIdx = parseInt(e.target.value.replace('guessed_', ''), 10);
        const gr = tok.guessedReadings ? tok.guessedReadings[gIdx] : null;
        if (gr) {
          tok.selectedReading = gr;
          tok.selectedReadingIndex = -1;
          tok.selectedGuessedIndex = gIdx;
          tok.customReading = null;
          tok.lemma = gr.lemma || tok.form;
          tok.upos = TagMapper.deriveUpos(gr.raw);
          lemmaInput.value = tok.lemma;
          uposSelect.value = tok.upos;
          this.fetchGlossesForToken(tok);
          this.renderInterlinear({ sIdx, tIdx });
          this.updateDashboard();
          this.updateExports();
        }
      } else {
        tok.selectedReadingIndex = parseInt(e.target.value, 10);
        tok.selectedGuessedIndex = null;
        tok.selectedReading = tok.readings[tok.selectedReadingIndex];
        tok.customReading = null;
        tok.lemma = tok.selectedReading ? tok.selectedReading.lemma : tok.form;
        // Directly derive UPOS from selected reading's morphological analysis output (NOUN < +N):
        tok.upos = tok.selectedReading ? TagMapper.deriveUpos(tok.selectedReading.raw) : 'NOUN';
        lemmaInput.value = tok.lemma;
        uposSelect.value = tok.upos;
        this.fetchGlossesForToken(tok);
        this.renderInterlinear({ sIdx, tIdx });
        this.updateDashboard();
        this.updateExports();
      }
    });

    morphSection.appendChild(readingSelect);

    // Tags Breakdown Pills with derived UPOS source tag (< +N, < +V, etc.)
    if (activeReading) {
      const tagsBox = document.createElement('div');
      tagsBox.className = 'tags-summary';
      const posTag = activeReading.pos || TagMapper.uposToPosTag(tok.upos);

      const uposSpan = document.createElement('span');
      uposSpan.className = 'tag-badge upos';
      uposSpan.title = `UPOS directly derived from morphological analysis (+${posTag})`;
      uposSpan.textContent = tok.upos || activeReading.upos || 'X';

      const posSourceSpan = document.createElement('span');
      posSourceSpan.className = 'tag-badge-pos-source';
      posSourceSpan.textContent = `< +${posTag}`;

      tagsBox.append(uposSpan, posSourceSpan);

      const displayTags = (activeReading.cleanTags && activeReading.cleanTags.length > 0)
        ? activeReading.cleanTags
        : (activeReading.tags || []).filter(t => !/^«?\+?guess»?$/i.test(t));

      displayTags.filter(t => t !== '?' && t !== posTag).slice(0, 6).forEach(t => {
        const tSpan = document.createElement('span');
        const isOrth = /^Err\/Orth/i.test(t) || /^Err\//i.test(t);
        const isSplRlx = /^SplRlx/i.test(t) || t === 'SplRlx';
        if (isOrth) {
          tSpan.className = 'tag-badge tag-badge-orth';
          tSpan.title = `Orthographical variant / keyboard accommodation tag (+${t})`;
        } else if (isSplRlx) {
          tSpan.className = 'tag-badge tag-badge-splrlx';
          tSpan.title = `Spell relax keyboard accommodation tag (+${t})`;
        } else {
          tSpan.className = 'tag-badge';
        }
        tSpan.textContent = t;
        tagsBox.appendChild(tSpan);
      });
      morphSection.appendChild(tagsBox);
    }

    // Button to renew the reading for CoNLL-U output (Requirement: "there has to be a button to renew the reading for the Conllu output")
    const renewBtn = document.createElement('button');
    renewBtn.className = `btn-renew-reading ${tok.isUnrecognized || activeReading?.isGuessed ? 'highlight-unrecognized' : ''}`;
    renewBtn.textContent = `🔄 Renew Reading for CoNLL-U`;
    renewBtn.title = 'Renew this reading with current Lemma and UPOS and update CoNLL-U output';

    renewBtn.addEventListener('click', () => {
      const newLemma = lemmaInput.value.trim() || tok.form;
      const newUpos = uposSelect.value || 'NOUN';
      const posTag = TagMapper.uposToPosTag(newUpos); // e.g., 'NOUN' -> 'N', 'VERB' -> 'V'

      tok.lemma = newLemma;

      if (tok.customReading) {
        tok.customReading.lemma = newLemma;
        let tags = Array.isArray(tok.customReading.tags) ? [...tok.customReading.tags] : [];
        const pIdx = tags.findIndex(t => POS_TO_UPOS[t]);
        if (pIdx >= 0) {
          if (POS_TO_UPOS[tags[pIdx]] !== newUpos) {
            tags[pIdx] = posTag;
          }
        } else {
          tags.unshift(posTag);
        }
        tok.customReading.tags = tags;
        tok.customReading.raw = `${newLemma}+${tags.join('+')}`;
        const parsed = TagMapper.parse(tok.customReading.raw, 0, tok.lang || this.srcLang);
        tok.customReading = parsed;
        // Directly derived UPOS: NOUN < +N
        tok.upos = parsed.upos;
      } else if (tok.selectedReading) {
        tok.selectedReading.lemma = newLemma;
        let tags = Array.isArray(tok.selectedReading.tags) ? [...tok.selectedReading.tags] : [];
        const pIdx = tags.findIndex(t => POS_TO_UPOS[t]);
        if (pIdx >= 0) {
          if (POS_TO_UPOS[tags[pIdx]] !== newUpos) {
            tags[pIdx] = posTag;
          }
        } else {
          tags.unshift(posTag);
        }
        tok.selectedReading.tags = tags;
        tok.selectedReading.raw = `${newLemma}+${tags.join('+')}`;
        const parsed = TagMapper.parse(tok.selectedReading.raw, 0, tok.lang || this.srcLang);
        tok.selectedReading = parsed;
        tok.selectedReading.isGuessed = false;
        tok.isUnrecognized = false;
        // Directly derived UPOS: NOUN < +N
        tok.upos = parsed.upos;
      } else {
        const raw = `${newLemma}+${posTag}`;
        const parsed = TagMapper.parse(raw, 0, tok.lang || this.srcLang);
        tok.selectedReading = parsed;
        tok.selectedReading.isGuessed = false;
        tok.isUnrecognized = false;
        tok.upos = parsed.upos;
      }

      this.fetchGlossesForToken(tok);
      this.renderInterlinear({ sIdx, tIdx });
      this.updateDashboard();
      this.updateExports();

      this.showToast(`Renewed CoNLL-U reading for "${tok.form}": Lemma="${tok.lemma}", UPOS=${tok.upos} (< +${posTag})`, 'success');
    });

    morphSection.appendChild(renewBtn);

    // Button to explore this token's paradigm in Paradigm Discoverer
    const paradigmBtn = document.createElement('button');
    paradigmBtn.className = 'btn-explore-paradigm';
    paradigmBtn.textContent = '🧩 Paradigm Explorer';
    paradigmBtn.title = 'Open Paradigm Discoverer for this word and explore its paradigm';
    paradigmBtn.style.cssText = 'margin-top: 6px; width: 100%; font-size: 11.5px; padding: 4px 8px; border-radius: 4px; border: 1px solid #c7d2fe; background: #eef2ff; color: #4338ca; cursor: pointer; font-weight: 600; text-align: center;';
    paradigmBtn.addEventListener('click', () => {
      this.openParadigmForWord(tok.lemma || tok.form, this.srcLang, activeReading?.raw, tok.guessedReadings);
    });
    morphSection.appendChild(paradigmBtn);

    card.appendChild(morphSection);

    // Gloss Selection Section (Requirement 3 & 3.1)
    const glossSection = document.createElement('div');
    glossSection.className = 'gloss-select-container';

    const glossHeader = document.createElement('div');
    glossHeader.className = 'section-label';
    glossHeader.textContent = 'Dictionary Gloss';
    glossSection.appendChild(glossHeader);

    const allGlosses = tok.allGlosses || [];
    const activeFilter = tok.activeGlossLangFilter || this.targetLang || 'all';

    // Multi-Language Filter Tabs (Requirement 3: "read what translations are offered for other languages, too")
    let glossLangs = [...new Set(allGlosses.map(g => g.lang.toLowerCase()))];
    const defaultTgt = this.targetLang !== 'all' ? this.targetLang.toLowerCase() : null;
    if (defaultTgt && glossLangs.includes(defaultTgt)) {
      glossLangs = [defaultTgt, ...glossLangs.filter(l => l !== defaultTgt)];
    }

    const langCounts = {};
    allGlosses.forEach(g => {
      const l = g.lang.toLowerCase();
      langCounts[l] = (langCounts[l] || 0) + 1;
    });

    if (glossLangs.length > 1) {
      const langTabs = document.createElement('div');
      langTabs.className = 'token-gloss-lang-tabs';

      // 'All' tab
      const allTab = document.createElement('span');
      allTab.className = `token-gloss-lang-tab ${activeFilter === 'all' ? 'active' : ''}`;
      allTab.textContent = `All (${allGlosses.length})`;
      allTab.title = 'View candidate translations from all offered languages';
      allTab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeTokenInfo = { sIdx, tIdx };
        tok.activeGlossLangFilter = 'all';
        this.renderInterlinear({ sIdx, tIdx });
      });
      langTabs.appendChild(allTab);

      // Per-language tabs
      glossLangs.forEach(langCode => {
        const tab = document.createElement('span');
        const isDefault = defaultTgt && langCode === defaultTgt;
        tab.className = `token-gloss-lang-tab ${activeFilter === langCode ? 'active' : ''} ${isDefault ? 'default-tgt-tab' : ''}`;
        tab.textContent = isDefault ? `★ ${langCode} (${langCounts[langCode]})` : `${langCode} (${langCounts[langCode]})`;
        tab.title = isDefault
          ? `Default target language: ${getLangDisplayName(langCode)} (${langCode})`
          : `Filter candidate glosses to ${getLangDisplayName(langCode)} (${langCode})`;
        tab.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activeTokenInfo = { sIdx, tIdx };
          tok.activeGlossLangFilter = langCode;
          this.renderInterlinear({ sIdx, tIdx });
        });
        langTabs.appendChild(tab);
      });

      glossSection.appendChild(langTabs);
    }

    // Candidate Gloss Chips
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'gloss-chips';

    let visibleGlosses = [];
    if (!activeFilter || activeFilter === 'all') {
      visibleGlosses = allGlosses;
    } else {
      visibleGlosses = allGlosses.filter(g => g.lang.toLowerCase() === activeFilter.toLowerCase());
    }

    if (visibleGlosses.length > 0) {
      visibleGlosses.forEach(g => {
        const chip = document.createElement('span');
        chip.className = `gloss-chip chip-lang-${g.lang}`;
        const isSelected = !tok.customGloss && tok.selectedGloss && tok.selectedGloss.gloss === g.gloss && tok.selectedGloss.lang === g.lang;
        if (isSelected) chip.classList.add('selected');

        chip.title = `${getLangDisplayName(g.lang)} (${g.lang}): ${g.gloss} (Source: ${g.source || 'dictionary'})`;

        const glossSpan = document.createElement('span');
        glossSpan.textContent = g.gloss;
        const langBadge = document.createElement('span');
        langBadge.className = `gloss-lang-badge badge-lang-${g.lang}`;
        langBadge.textContent = g.lang;
        chip.append(glossSpan, langBadge);

        chip.addEventListener('click', () => {
          this.activeTokenInfo = { sIdx, tIdx };
          tok.selectedGloss = g;
          tok.customGloss = '';
          tok.customGlossLang = g.lang;
          this.renderInterlinear({ sIdx, tIdx });
          this.updateDashboard();
          this.updateExports();
        });

        chipsContainer.appendChild(chip);
      });
    } else if (allGlosses.length > 0) {
      // Current language filter has no entries, but others do! Let user know and display other languages
      const notice = document.createElement('div');
      notice.className = 'gloss-lang-notice';
      const strongNotice = document.createElement('strong');
      strongNotice.textContent = `${getLangDisplayName(activeFilter)} (${activeFilter})`;
      notice.append('No ', strongNotice, ' gloss. Offered translations:');
      glossSection.appendChild(notice);

      allGlosses.forEach(g => {
        const chip = document.createElement('span');
        chip.className = `gloss-chip chip-lang-${g.lang}`;
        const isSelected = !tok.customGloss && tok.selectedGloss && tok.selectedGloss.gloss === g.gloss && tok.selectedGloss.lang === g.lang;
        if (isSelected) chip.classList.add('selected');

        chip.title = `${getLangDisplayName(g.lang)} (${g.lang}): ${g.gloss} (Source: ${g.source || 'dictionary'})`;

        const glossSpan = document.createElement('span');
        glossSpan.textContent = g.gloss;
        const langBadge = document.createElement('span');
        langBadge.className = `gloss-lang-badge badge-lang-${g.lang}`;
        langBadge.textContent = g.lang;
        chip.append(glossSpan, langBadge);

        chip.addEventListener('click', () => {
          this.activeTokenInfo = { sIdx, tIdx };
          tok.selectedGloss = g;
          tok.customGloss = '';
          tok.customGlossLang = g.lang;
          this.renderInterlinear({ sIdx, tIdx });
          this.updateDashboard();
          this.updateExports();
        });

        chipsContainer.appendChild(chip);
      });
    } else {
      const noGlossSpan = document.createElement('span');
      noGlossSpan.style.fontSize = '11px';
      noGlossSpan.style.color = 'var(--text-muted)';
      noGlossSpan.style.fontStyle = 'italic';
      noGlossSpan.textContent = 'No dictionary gloss found';
      chipsContainer.replaceChildren(noGlossSpan);
    }

    glossSection.appendChild(chipsContainer);

    // Custom Gloss Input (Requirement 3.1: "select desired gloss or add own (ISO lang required)")
    const customRow = document.createElement('div');
    customRow.className = 'custom-input-row';

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'custom-gloss-input';
    customInput.placeholder = 'Add custom gloss...';
    customInput.value = tok.customGloss || (tok.selectedGloss ? tok.selectedGloss.gloss : '');

    const langInput = document.createElement('input');
    langInput.type = 'text';
    langInput.className = 'custom-lang-input';
    langInput.maxLength = 3;
    langInput.placeholder = 'ISO';
    langInput.title = 'Target ISO 639 language code (e.g. eng, fin, rus)';
    langInput.value = tok.customGlossLang || (tok.selectedGloss ? tok.selectedGloss.lang : (this.targetLang !== 'all' ? this.targetLang : 'eng'));

    const saveGlossBtn = document.createElement('button');
    saveGlossBtn.className = 'btn btn-secondary btn-sm';
    saveGlossBtn.textContent = '✓';
    saveGlossBtn.title = 'Save custom gloss with ISO language';

    const commitCustomGloss = () => {
      const val = customInput.value.trim();
      const langVal = (langInput.value.trim() || tok.customGlossLang || (this.targetLang !== 'all' ? this.targetLang : 'eng')).toLowerCase();
      if (val) {
        this.activeTokenInfo = { sIdx, tIdx };
        const parts = splitGlossItem(val);
        const primaryGloss = parts[0] || val;
        tok.customGloss = primaryGloss;
        tok.customGlossLang = langVal;
        tok.selectedGloss = { gloss: primaryGloss, lang: langVal, source: 'custom_user' };
        
        // Auto-save to custom dictionary in IndexedDB (splits multiple glosses if comma/semicolon delimited)
        const lemma = activeReading ? activeReading.lemma : tok.form;
        dictionaryService.addCustomEntry({
          src_lang: this.srcLang,
          lemma,
          pos: activeReading ? activeReading.pos : '',
          tgt_lang: langVal,
          gloss: val,
          notes: 'Added from workbench'
        });

        for (const p of parts) {
          if (!tok.allGlosses.some(g => g.gloss.toLowerCase() === p.toLowerCase() && g.lang.toLowerCase() === langVal)) {
            tok.allGlosses.unshift({ gloss: p, lang: langVal, source: 'custom_user' });
          }
        }

        this.renderInterlinear({ sIdx, tIdx });
        this.updateDashboard();
        this.updateExports();
        this.showToast(`Saved gloss "${primaryGloss}" [${langVal}] for "${lemma}"`, 'success');
      }
    };

    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commitCustomGloss();
    });
    saveGlossBtn.addEventListener('click', commitCustomGloss);

    customRow.appendChild(customInput);
    customRow.appendChild(langInput);
    customRow.appendChild(saveGlossBtn);
    glossSection.appendChild(customRow);

    card.appendChild(glossSection);
    return card;
  }

  // Translation rows management (Requirement 4)
  renderTranslations() {
    if (!this.translationsList) return;
    this.translationsList.replaceChildren();

    const standardLangs = [
      { code: 'eng', name: 'English (eng)' },
      { code: 'fin', name: 'Finnish (fin)' },
      { code: 'rus', name: 'Russian (rus)' },
      { code: 'deu', name: 'German (deu)' },
      { code: 'swe', name: 'Swedish (swe)' },
      { code: 'est', name: 'Estonian (est)' },
      { code: 'fra', name: 'French (fra)' },
      { code: 'spa', name: 'Spanish (spa)' }
    ];

    this.translations.forEach((tr, idx) => {
      const row = document.createElement('div');
      row.className = 'translation-row';

      const select = document.createElement('select');
      select.className = 'translation-lang-select';

      const isKnown = standardLangs.some(o => o.code === tr.lang);
      standardLangs.forEach(optData => {
        const opt = document.createElement('option');
        opt.value = optData.code;
        opt.textContent = optData.name;
        if (optData.code === tr.lang) opt.selected = true;
        select.appendChild(opt);
      });
      const customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.textContent = 'Custom ISO...';
      if (!isKnown) customOpt.selected = true;
      select.appendChild(customOpt);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'translation-text-input';
      input.placeholder = `Enter translation in ${(tr.lang || '').toUpperCase()}...`;
      input.value = tr.text || '';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.title = 'Remove translation';
      removeBtn.textContent = '×';

      row.append(select, input, removeBtn);

      select.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
          const customCode = prompt('Enter 3-letter ISO language code (e.g. olo, sme, kpv):', tr.lang);
          if (customCode && customCode.trim()) {
            tr.lang = customCode.trim().toLowerCase();
          }
        } else {
          tr.lang = e.target.value;
        }
        this.renderTranslations();
        this.updateExports();
      });

      input.addEventListener('input', (e) => {
        tr.text = e.target.value;
        this.updateExports();
      });

      removeBtn.addEventListener('click', () => {
        if (this.translations.length > 1) {
          this.translations.splice(idx, 1);
          this.renderTranslations();
          this.updateExports();
        } else {
          tr.text = '';
          input.value = '';
          this.updateExports();
        }
      });

      this.translationsList.appendChild(row);
    });
  }

  addTranslationRow() {
    const nextId = this.translations.length + 1;
    // Pick an unused common language if possible
    const existing = this.translations.map(t => t.lang);
    const candidates = ['eng', 'fin', 'rus', 'deu', 'swe', 'est'];
    const chosen = candidates.find(c => !existing.includes(c)) || 'eng';

    this.translations.push({ id: nextId, lang: chosen, text: '' });
    this.renderTranslations();
  }

  updateDashboard() {
    let total = 0;
    let complete = 0;
    let pendingGlosses = 0;

    for (const sent of this.sentences) {
      for (const tok of sent.tokens) {
        if (tok.isPunct) continue;
        total++;
        const hasReading = !!(tok.customReading || tok.selectedReading);
        const hasGloss = !!(tok.customGloss || tok.selectedGloss);

        if (hasReading && hasGloss) {
          complete++;
        } else if (!hasGloss) {
          pendingGlosses++;
        }
      }
    }

    const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
    if (this.statTotalTokens) this.statTotalTokens.textContent = total;
    if (this.statAnnotatedTokens) this.statAnnotatedTokens.textContent = complete;
    if (this.statPendingGlosses) this.statPendingGlosses.textContent = pendingGlosses;
    if (this.progressPercent) this.progressPercent.textContent = `${pct}%`;
    if (this.progressBarFill) this.progressBarFill.style.width = `${pct}%`;
  }

  autoSelectFirstOption() {
    for (const sent of this.sentences) {
      for (const tok of sent.tokens) {
        if (tok.isPunct) continue;
        if (!tok.customReading && tok.readings && tok.readings.length > 0) {
          tok.selectedReadingIndex = 0;
          tok.selectedReading = tok.readings[0];
          tok.lemma = tok.selectedReading.lemma || tok.form;
          this.fetchGlossesForToken(tok);
        }
        if (!tok.customGloss) {
          if (tok.glosses && tok.glosses.length > 0) {
            tok.selectedGloss = tok.glosses[0];
            tok.customGlossLang = tok.selectedGloss.lang;
          } else if (tok.allGlosses && tok.allGlosses.length > 0) {
            tok.selectedGloss = tok.allGlosses[0];
            tok.customGlossLang = tok.selectedGloss.lang;
          }
        }
      }
    }
    this.renderInterlinear();
    this.updateDashboard();
    this.updateExports();
    this.showToast('Auto-selected best readings and glosses.', 'success');
  }

  jumpToNextIncomplete() {
    for (let sIdx = 0; sIdx < this.sentences.length; sIdx++) {
      const sent = this.sentences[sIdx];
      for (let tIdx = 0; tIdx < sent.tokens.length; tIdx++) {
        const tok = sent.tokens[tIdx];
        if (tok.isPunct) continue;
        const hasGloss = !!(tok.customGloss || tok.selectedGloss);
        if (!hasGloss) {
          this.activeTokenInfo = { sIdx, tIdx };
          this.centerTokenCard(sIdx, tIdx, true);
          const el = document.getElementById(`token-card-${sIdx}-${tIdx}`);
          if (el) {
            el.style.boxShadow = '0 0 0 3px #f59e0b';
            setTimeout(() => { el.style.boxShadow = ''; }, 1500);
            return;
          }
        }
      }
    }
    this.showToast('All tokens are fully glossed!', 'success');
  }

  // Renew all readings with current Lemma and UPOS for CoNLL-U output
  renewAllConlluReadings() {
    let renewedCount = 0;
    for (const sent of this.sentences) {
      for (const tok of sent.tokens) {
        if (tok.isPunct) continue;
        const reading = tok.customReading || tok.selectedReading;
        if (reading) {
          if (tok.lemma) reading.lemma = tok.lemma;
          if (reading.raw) {
            tok.upos = TagMapper.deriveUpos(reading.raw);
            reading.upos = tok.upos;
          } else if (tok.upos) {
            reading.upos = tok.upos;
          }
          if (tok.isUnrecognized || reading.isGuessed) {
            reading.isGuessed = false;
            tok.isUnrecognized = false;
          }
        }
        this.fetchGlossesForToken(tok);
        renewedCount++;
      }
    }
    this.renderInterlinear();
    this.updateDashboard();
    this.updateExports();
    this.showToast(`Renewed CoNLL-U readings for all ${renewedCount} words (UPOS derived)!`, 'success');
  }

  // Multi-format export updates (Requirement 5)
  updateExports() {
    let output = '';

    if (this.activeExportTab === 'conllu') {
      if (this.exportScope === 'accumulated' && treebankService.getCount() > 0) {
        output = treebankService.generateCombinedConllu();
      } else {
        output = ConlluExporter.export(this.sentences, this.translations);
      }
    } else if (this.activeExportTab === 'interlinear') {
      output = InterlinearExporter.exportPlainText(this.sentences, this.translations);
    } else if (this.activeExportTab === 'verdd') {
      output = VerddExporter.exportBlock(this.sentences, this.translations, this.srcLang, this.targetLang);
    }

    if (this.exportPreview) {
      this.exportPreview.textContent = output || '(No analysis output yet. Click Analyze above.)';
    }
  }

  handleCopyExport() {
    const text = this.exportPreview.textContent;
    if (!text || text.startsWith('(No analysis')) return;

    navigator.clipboard.writeText(text).then(() => {
      this.showToast(`Copied ${this.activeExportTab.toUpperCase()} to clipboard!`, 'success');
    }).catch(err => {
      this.showToast('Copy failed: ' + err.message, 'error');
    });
  }

  handleCopyHtmlTable() {
    // Specifically for MS Word & LibreOffice Writer: copies formatted HTML table
    const html = InterlinearExporter.exportHTML(this.sentences, this.translations);
    const plain = InterlinearExporter.exportPlainText(this.sentences, this.translations);

    try {
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobPlain = new Blob([plain], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobPlain
      });

      navigator.clipboard.write([item]).then(() => {
        this.showToast('Copied HTML Table! Paste directly into MS Word or LibreOffice Writer.', 'success');
      });
    } catch (e) {
      // Fallback
      navigator.clipboard.writeText(plain).then(() => {
        this.showToast('Copied interlinear text to clipboard.', 'success');
      });
    }
  }

  handleDownloadExport() {
    if (this.activeExportTab === 'conllu' && this.exportScope === 'accumulated') {
      this.handleDownloadAccumulativeFile();
      return;
    }

    let content = '';
    let filename = '';
    let mime = 'text/plain';

    if (this.activeExportTab === 'conllu') {
      content = ConlluExporter.export(this.sentences, this.translations);
      filename = `annotated_${this.srcLang}.conllu`;
    } else if (this.activeExportTab === 'interlinear') {
      content = InterlinearExporter.exportPlainText(this.sentences, this.translations);
      filename = `interlinear_${this.srcLang}.txt`;
    } else if (this.activeExportTab === 'verdd') {
      content = VerddExporter.exportXML(this.sentences, this.translations, this.srcLang, this.targetLang);
      filename = `verdd_lexicon_${this.srcLang}.xml`;
      mime = 'application/xml';
    }

    if (!content) return;

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`Downloaded ${filename}!`, 'success');
  }

  // --- Treebank Accumulator Methods ---

  /**
   * Confirmation helper: delegates to this.confirmHandler if provided (for testing),
   * or falls back to window.confirm / confirm.
   * @param {string} message
   * @returns {boolean}
   */
  confirmAction(message) {
    if (typeof this.confirmHandler === 'function') {
      return this.confirmHandler(message);
    }
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
    if (typeof confirm === 'function') {
      return confirm(message);
    }
    return true;
  }

  /**
   * Updates state, styling, and text of the per-sentence "Save Treebank" buttons in the interlinear view.
   */
  updateSentenceSaveButtons() {
    if (!this.tokensContainer) return;
    const sentBlocks = this.tokensContainer.querySelectorAll('.sentence-block');
    sentBlocks.forEach((block, idx) => {
      const sent = this.sentences[idx];
      if (!sent) return;
      const btn = block.querySelector('.btn-save-sent-tb');
      if (!btn) return;

      const existing = treebankService.findDuplicate(sent, this.srcLang);
      if (existing) {
        btn.textContent = `✓ Saved (#${existing.sent_id})`;
        btn.className = 'btn btn-success btn-sm btn-save-sent-tb';
        btn.title = `Already saved as Treebank #${existing.sent_id} in accumulative file. Repeating this command will ask for confirmation before saving a duplicate.`;
      } else {
        btn.textContent = `💾 Save Treebank`;
        btn.className = 'btn btn-secondary btn-sm btn-save-sent-tb';
        btn.title = `Save this completed sentence as the next treebank in order in the accumulative file`;
      }
    });
  }

  async handleSaveCompletedTreebank(clearForNext = false) {
    if (!this.sentences || this.sentences.length === 0) {
      this.showToast('No sentence in workspace to save. Please analyze text first.', 'error');
      return;
    }

    // Duplicate detection and confirmation
    const duplicates = treebankService.findDuplicates(this.sentences, this.srcLang);
    if (duplicates.length > 0) {
      let confirmMsg = '';
      if (duplicates.length === 1 && this.sentences.length === 1) {
        const dup = duplicates[0];
        confirmMsg = `Sentence "${dup.sentence.text}" has already been saved as Treebank #${dup.existing.sent_id}.\n\nAre you sure you want to save another copy of this treebank to the accumulative file?`;
      } else if (duplicates.length === this.sentences.length) {
        const dupIds = duplicates.map(d => `#${d.existing.sent_id}`).join(', ');
        confirmMsg = `All ${this.sentences.length} sentences in the workspace have already been saved to the accumulative file (Treebank ${dupIds}).\n\nAre you sure you want to save duplicate copies?`;
      } else {
        const dupIds = duplicates.map(d => `#${d.existing.sent_id}`).join(', ');
        confirmMsg = `${duplicates.length} of ${this.sentences.length} sentences have already been saved to the accumulative file (Treebank ${dupIds}).\n\nAre you sure you want to save duplicate copies as well?`;
      }

      const confirmed = this.confirmAction(confirmMsg);
      if (!confirmed) {
        if (clearForNext) {
          const proceedClear = this.confirmAction('Duplicate was not saved. Do you still want to clear the workspace for the subsequent sentence?');
          if (proceedClear) {
            if (this.inputTextArea) this.inputTextArea.value = '';
            this.sentences = [];
            this.translations = [{ id: 1, lang: 'eng', text: '' }];
            this.renderInterlinear();
            this.renderTranslations();
            this.updateDashboard();
            this.updateExports();
            this.updateTreebankUI();
            if (this.inputTextArea) this.inputTextArea.focus();
            this.showToast('Workspace cleared for subsequent sentence without saving duplicate.', 'info');
          }
        } else {
          this.showToast('Save cancelled: duplicate treebank was not added.', 'info');
        }
        return;
      }
    }

    try {
      const savedList = await treebankService.saveAllSentences(
        this.sentences,
        this.translations,
        this.srcLang,
        this.targetLang
      );

      this.updateTreebankUI();
      this.updateExports();

      const count = treebankService.getCount();
      const sentIds = savedList.map(s => `#${s.sent_id}`).join(', ');

      if (clearForNext) {
        // Clear workspace so a subsequent sentence can be dealt with and saved as the next treebank in order
        if (this.inputTextArea) this.inputTextArea.value = '';
        this.sentences = [];
        this.translations = [{ id: 1, lang: 'eng', text: '' }];
        this.renderInterlinear();
        this.renderTranslations();
        this.updateDashboard();
        this.updateExports();
        this.updateTreebankUI();
        if (this.inputTextArea) this.inputTextArea.focus();
        this.showToast(`Saved treebank ${sentIds} (Total: ${count}). Workspace cleared for subsequent sentence!`, 'success');
      } else {
        this.showToast(`Saved treebank ${sentIds} in accumulative file (Total: ${count} sentences)!`, 'success');
      }
    } catch (err) {
      console.error('Error saving treebank:', err);
      this.showToast('Could not save treebank: ' + err.message, 'error');
    }
  }

  handleDownloadAccumulativeFile() {
    if (treebankService.getCount() === 0) {
      this.showToast('No treebanks accumulated yet. Click "Save Completed Treebank" first.', 'error');
      return;
    }

    try {
      const res = treebankService.downloadCombinedFile();
      this.showToast(`Downloaded accumulative treebank file: ${res.filename} (${res.count} sentences)!`, 'success');
      this.openDownloadModal(
        `Downloaded file "${res.filename}" containing ${res.count} treebank sentence${res.count > 1 ? 's' : ''} in the same file.`
      );
    } catch (err) {
      console.error('Download error:', err);
      this.showToast('Download error: ' + err.message, 'error');
    }
  }

  async handleDownloadSimultaneous() {
    if (treebankService.getCount() === 0) {
      this.showToast('No treebanks accumulated yet. Click "Save Completed Treebank" first.', 'error');
      return;
    }

    try {
      const files = await treebankService.downloadAllSimultaneously(150);
      this.showToast(`Simultaneously downloaded ${files.length} treebank files!`, 'success');
      this.openDownloadModal(
        `Simultaneously downloaded ${files.length} individual treebank files.`
      );
    } catch (err) {
      console.error('Simultaneous download error:', err);
      this.showToast('Download error: ' + err.message, 'error');
    }
  }

  async handleRemoveAccumulativeFile() {
    const count = treebankService.getCount();
    if (count === 0) {
      this.showToast('Accumulative file is already empty.', 'info');
      return;
    }

    const confirmed = this.confirmAction(`Are you sure you want to manually remove the accumulative file (${count} sentences saved)? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      await treebankService.clearAccumulatedFile();
      this.setExportScope('current');
      this.updateTreebankUI();
      this.updateExports();
      this.showToast(`Manually removed accumulative file (${count} sentences cleared). Ready for new treebanks!`, 'success');
    } catch (err) {
      console.error('Failed to clear accumulative file:', err);
      this.showToast('Failed to clear accumulative file: ' + err.message, 'error');
    }
  }

  toggleTreebankList() {
    if (!this.accumulatedTreebanksDrawer) return;
    const isHidden = this.accumulatedTreebanksDrawer.style.display === 'none';
    this.accumulatedTreebanksDrawer.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      this.renderAccumulatedTreebanksTable();
    }
  }

  openDownloadModal(summary) {
    if (!this.treebankDownloadModal) return;
    if (this.downloadModalSummary) {
      this.downloadModalSummary.textContent = summary;
    }
    this.treebankDownloadModal.classList.add('open');
  }

  closeDownloadModal() {
    this.treebankDownloadModal?.classList.remove('open');
  }

  setExportScope(scope) {
    this.exportScope = scope;
    if (this.scopeCurrentRadio) this.scopeCurrentRadio.checked = (scope === 'current');
    if (this.scopeAccumulatedRadio) this.scopeAccumulatedRadio.checked = (scope === 'accumulated');
    this.updateExports();
  }

  updateTreebankUI() {
    const count = treebankService.getCount();
    const countText = `${count} sentence${count !== 1 ? 's' : ''}`;

    if (this.accumulativeBadgeCount) this.accumulativeBadgeCount.textContent = count;
    if (this.accumulativeCountPill) this.accumulativeCountPill.textContent = `${countText} saved`;
    if (this.treebankListCount) this.treebankListCount.textContent = count;

    // Update Save Completed Treebank button visual status
    if (this.saveTreebankBtn) {
      const duplicates = this.sentences && this.sentences.length > 0
        ? treebankService.findDuplicates(this.sentences, this.srcLang)
        : [];
      if (duplicates.length > 0 && duplicates.length === this.sentences.length) {
        this.saveTreebankBtn.textContent = `✓ Saved Completed Treebank`;
        this.saveTreebankBtn.className = 'btn btn-outline-success';
        this.saveTreebankBtn.title = 'Current workspace sentence(s) already saved in accumulative file. Repeating this command requires confirmation.';
      } else {
        this.saveTreebankBtn.textContent = `💾 Save Completed Treebank`;
        this.saveTreebankBtn.className = 'btn btn-success';
        this.saveTreebankBtn.title = 'Save completed sentence annotation as the next treebank in order in the accumulative file';
      }
    }

    this.updateSentenceSaveButtons();
    this.renderAccumulatedTreebanksTable();
  }

  renderAccumulatedTreebanksTable() {
    if (!this.accumulatedTreebanksTableBody) return;
    const treebanks = treebankService.getTreebanks();

    if (treebanks.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.style.textAlign = 'center';
      td.style.color = 'var(--text-muted)';
      td.style.padding = '12px';
      td.textContent = 'No treebanks saved yet. Annotate a sentence and click "Save Completed Treebank".';
      tr.appendChild(td);
      this.accumulatedTreebanksTableBody.replaceChildren(tr);
      return;
    }

    this.accumulatedTreebanksTableBody.replaceChildren();
    treebanks.forEach(tb => {
      const tr = document.createElement('tr');
      const trCount = (tb.translations || []).filter(t => t.text).length;

      const tdId = document.createElement('td');
      const badgeOrder = document.createElement('span');
      badgeOrder.className = 'treebank-order-badge';
      badgeOrder.textContent = `#${tb.sent_id}`;
      tdId.appendChild(badgeOrder);

      const tdLang = document.createElement('td');
      const badgeLang = document.createElement('span');
      badgeLang.className = 'gloss-lang-badge';
      badgeLang.textContent = tb.srcLang;
      tdLang.appendChild(badgeLang);

      const tdText = document.createElement('td');
      tdText.style.maxWidth = '250px';
      tdText.style.overflow = 'hidden';
      tdText.style.textOverflow = 'ellipsis';
      tdText.style.whiteSpace = 'nowrap';
      tdText.title = tb.text || '';
      tdText.textContent = tb.text || '';

      const tdToks = document.createElement('td');
      tdToks.textContent = String(tb.tokens?.length || 0);

      const tdLangs = document.createElement('td');
      tdLangs.textContent = `${trCount} lang${trCount !== 1 ? 's' : ''}`;

      const tdActions = document.createElement('td');
      tdActions.style.textAlign = 'right';
      tdActions.style.whiteSpace = 'nowrap';

      const btnAnnotate = document.createElement('button');
      btnAnnotate.className = 'btn btn-secondary btn-sm btn-tb-annotate';
      btnAnnotate.title = 'Annotate dependency relations (HEAD & DEPREL) and draw tree';
      btnAnnotate.textContent = '🌲 Annotate';
      btnAnnotate.addEventListener('click', () => this.openTreebankAnnotator(tb.id));

      const btnLoad = document.createElement('button');
      btnLoad.className = 'btn btn-secondary btn-sm btn-tb-load';
      btnLoad.title = 'Load this treebank back into workbench to view or edit';
      btnLoad.textContent = '👁️ Load';
      btnLoad.addEventListener('click', () => this.loadTreebankToWorkbench(tb));

      const btnDown = document.createElement('button');
      btnDown.className = 'btn btn-secondary btn-sm btn-tb-down';
      btnDown.title = 'Download this single treebank as .conllu';
      btnDown.textContent = '⬇️';
      btnDown.addEventListener('click', () => {
        const fname = treebankService.downloadSingleTreebank(tb.id);
        this.showToast(`Downloaded single treebank: ${fname}`, 'success');
      });

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-secondary btn-sm btn-tb-del';
      btnDel.style.color = '#b91c1c';
      btnDel.title = 'Delete this treebank from accumulative file';
      btnDel.textContent = '🗑️';
      btnDel.addEventListener('click', async () => {
        await treebankService.deleteTreebank(tb.id);
        this.updateTreebankUI();
        this.updateExports();
        this.showToast(`Deleted treebank #${tb.sent_id}. Remaining treebanks re-indexed in order.`, 'info');
      });

      tdActions.append(btnAnnotate, ' ', btnLoad, ' ', btnDown, ' ', btnDel);
      tr.append(tdId, tdLang, tdText, tdToks, tdLangs, tdActions);
      this.accumulatedTreebanksTableBody.appendChild(tr);
    });
  }

  loadTreebankToWorkbench(tb) {
    if (!tb) return;
    this.srcLang = tb.srcLang || this.srcLang;
    if (this.srcLangSelect) this.srcLangSelect.value = this.srcLang;
    if (this.inputTextLangSelect) this.inputTextLangSelect.value = this.srcLang;
    this.updateInputAnalyzerBadge();

    this.inputTextArea.value = tb.text || '';
    this.sentences = [{
      sent_id: tb.sent_id,
      text: tb.text,
      tokens: JSON.parse(JSON.stringify(tb.tokens || []))
    }];

    this.translations = JSON.parse(JSON.stringify(tb.translations || [{ id: 1, lang: 'eng', text: '' }]));

    this.renderInterlinear();
    this.renderTranslations();
    this.updateDashboard();
    this.setExportScope('current');
    this.showToast(`Loaded Treebank #${tb.sent_id} into workbench!`, 'success');
  }

  // --- Universal Dependencies (UD) & Dependency Tree Annotator ---

  async openTreebankAnnotator(tbOrId) {
    let tb = null;
    if (typeof tbOrId === 'string') {
      tb = treebankService.getTreebank(tbOrId);
    } else {
      tb = tbOrId;
    }

    if (!tb) {
      this.showToast('Treebank not found.', 'error');
      return null;
    }

    this.currentAnnotatingTb = tb;
    this.workingAnnotatingTokens = JSON.parse(JSON.stringify(tb.tokens || []));

    // Ensure token normalization
    this.workingAnnotatingTokens.forEach((tok, idx) => {
      tok.id = tok.id || (idx + 1);
      if (!tok.form) tok.form = '';
      if (!tok.lemma) {
        tok.lemma = tok.customReading?.lemma || tok.selectedReading?.lemma || tok.form;
      }
      if (!tok.upos) {
        tok.upos = tok.customReading?.upos || tok.selectedReading?.upos || (tok.isPunct ? 'PUNCT' : TagMapper.deriveUpos(tok.customReading?.raw || tok.form));
      }
      if (tok.head === undefined || tok.head === null || tok.head === '') {
        tok.head = '_';
      }
      if (tok.upos === 'PUNCT' || tok.isPunct) {
        if (!tok.deprel || tok.deprel === '_') {
          tok.deprel = 'punct';
        }
      } else {
        if (!tok.deprel) {
          tok.deprel = tok.head === 0 ? 'root' : '_';
        }
      }
    });

    this.annotatorLangCode = tb.srcLang || this.srcLang || 'myv';
    this.annotatorLangRelations = await dependencyService.getRelationsForLanguage(this.annotatorLangCode);

    // Update Header labels
    if (this.annotateTbTitle) {
      this.annotateTbTitle.textContent = `Treebank #${tb.sent_id} Dependency Annotation`;
    }
    if (this.annotateTbLangBadge) {
      this.annotateTbLangBadge.textContent = this.annotatorLangCode;
    }
    if (this.annotateTbSentText) {
      this.annotateTbSentText.textContent = tb.text || this.workingAnnotatingTokens.map(t => t.form).join(' ');
    }
    if (this.relationsDrawerLangCode) {
      this.relationsDrawerLangCode.textContent = `${this.annotatorLangCode} (${getLangDisplayName(this.annotatorLangCode)})`;
    }

    this.selectedAnnotatingTokenId = null;
    this.isConnectingHead = false;
    this.setAnnotatorViewTab('visual');
    this.updateAnnotatorNavButtons();
    this.renderLanguageRelationsList();

    if (this.treebankAnnotateModal) {
      this.treebankAnnotateModal.classList.add('open');
    }

    return tb;
  }

  closeTreebankAnnotator() {
    if (this.treebankAnnotateModal) {
      this.treebankAnnotateModal.classList.remove('open');
    }
    if (this.languageRelationsDrawer) {
      this.languageRelationsDrawer.style.display = 'none';
    }
    this.currentAnnotatingTb = null;
    this.workingAnnotatingTokens = [];
    this.selectedAnnotatingTokenId = null;
    this.isConnectingHead = false;
  }

  updateAnnotatorNavButtons() {
    if (!this.currentAnnotatingTb) return;
    const treebanks = treebankService.getTreebanks();
    const currIdx = treebanks.findIndex(t => t.id === this.currentAnnotatingTb.id);
    if (this.prevTreebankBtn) {
      this.prevTreebankBtn.disabled = (currIdx <= 0);
    }
    if (this.nextTreebankBtn) {
      this.nextTreebankBtn.disabled = (currIdx === -1 || currIdx >= treebanks.length - 1);
    }
  }

  navigateTreebankAnnotator(delta) {
    if (!this.currentAnnotatingTb) return;
    const treebanks = treebankService.getTreebanks();
    const currIdx = treebanks.findIndex(t => t.id === this.currentAnnotatingTb.id);
    if (currIdx === -1) return;
    const nextIdx = currIdx + delta;
    if (nextIdx >= 0 && nextIdx < treebanks.length) {
      this.openTreebankAnnotator(treebanks[nextIdx].id);
    }
  }

  setAnnotatorViewTab(tab) {
    this.annotatorActiveTab = tab;
    if (this.viewTabVisualBtn) this.viewTabVisualBtn.classList.toggle('active', tab === 'visual');
    if (this.viewTabTableBtn) this.viewTabTableBtn.classList.toggle('active', tab === 'table');
    if (this.viewTabConlluBtn) this.viewTabConlluBtn.classList.toggle('active', tab === 'conllu');

    if (this.visualArcViewContainer) this.visualArcViewContainer.style.display = (tab === 'visual') ? 'block' : 'none';
    if (this.tokenTableViewContainer) this.tokenTableViewContainer.style.display = (tab === 'table') ? 'block' : 'none';
    if (this.conlluRawViewContainer) this.conlluRawViewContainer.style.display = (tab === 'conllu') ? 'block' : 'none';

    this.renderAnnotatorView();
  }

  renderAnnotatorView() {
    if (!this.currentAnnotatingTb) return;
    this.updateAnnotatorValidation();

    if (this.annotatorActiveTab === 'visual') {
      this.renderDependencyGraph();
    } else if (this.annotatorActiveTab === 'table') {
      this.renderAnnotatorTable();
    } else if (this.annotatorActiveTab === 'conllu') {
      this.renderAnnotatorConlluPreview();
    }

    this.renderQuickAnnotationControls();
  }

  updateAnnotatorValidation() {
    const validation = dependencyService.validateDependencies(this.workingAnnotatingTokens);

    if (this.annotateTbValidationBadge) {
      if (validation.isValid && validation.rootCount === 1) {
        this.annotateTbValidationBadge.className = 'dep-validation-pill valid';
        this.annotateTbValidationBadge.textContent = '✓ Valid UD Tree';
        this.annotateTbValidationBadge.title = 'Strict Universal Dependencies format: exactly 1 root and acyclic tree.';
      } else if (!validation.isValid) {
        this.annotateTbValidationBadge.className = 'dep-validation-pill error';
        this.annotateTbValidationBadge.textContent = `❌ ${validation.errors[0] || 'Invalid Dependency Tree'}`;
        this.annotateTbValidationBadge.title = validation.errors.join('\n');
      } else {
        this.annotateTbValidationBadge.className = 'dep-validation-pill warning';
        this.annotateTbValidationBadge.textContent = `⚠️ ${validation.warnings[0] || 'Unconnected or Missing Root'}`;
        this.annotateTbValidationBadge.title = validation.warnings.join('\n');
      }
    }

    return validation;
  }

  renderDependencyGraph() {
    if (!this.dependencyVisualizerCanvas) return;
    const svgHtml = DependencyVisualizer.renderSvg(this.workingAnnotatingTokens, {
      selectedTokenId: this.selectedAnnotatingTokenId
    });
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgHtml, 'image/svg+xml');
      if (doc.documentElement && this.dependencyVisualizerCanvas.replaceChildren) {
        this.dependencyVisualizerCanvas.replaceChildren(doc.documentElement);
      }
    }

    // Attach click events on token cards
    const tokenCards = this.dependencyVisualizerCanvas.querySelectorAll('.dep-token-card');
    tokenCards.forEach(card => {
      const tokId = Number(card.getAttribute('data-token-id'));
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleVisualTokenClick(tokId);
      });
      card.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.selectedAnnotatingTokenId = tokId;
        this.renderAnnotatorView();
        if (this.quickFormInput) {
          this.quickFormInput.focus();
          this.quickFormInput.select();
        }
      });
    });

    // Attach click events on deprel badges to quick select
    const badges = this.dependencyVisualizerCanvas.querySelectorAll('.deprel-badge');
    badges.forEach(badge => {
      const depId = Number(badge.getAttribute('data-dep-id'));
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedAnnotatingTokenId = depId;
        this.renderAnnotatorView();
        if (this.quickDeprelSelect) this.quickDeprelSelect.focus();
      });
    });

    // Update active selection tip
    if (this.activeSelectionHint) {
      const selTok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
      if (selTok) {
        this.activeSelectionHint.textContent = `Selected #${selTok.id} "${selTok.form}" (HEAD: ${selTok.head}, DEPREL: ${selTok.deprel})`;
      } else {
        this.activeSelectionHint.textContent = 'Click any token card to select it. Double-click to edit text.';
      }
    }
  }

  handleVisualTokenClick(clickedId) {
    // If in "Connect Head" mode, the clicked token becomes the HEAD for the currently selected token
    if (this.isConnectingHead && this.selectedAnnotatingTokenId !== null) {
      if (clickedId === this.selectedAnnotatingTokenId) {
        this.showToast('A token cannot be its own HEAD (self-loop).', 'warning');
      } else {
        const selTok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
        if (selTok) {
          selTok.head = clickedId;
          if (!selTok.deprel || selTok.deprel === '_' || selTok.deprel === 'root') {
            selTok.deprel = 'dep';
          }
          this.showToast(`Connected Token #${clickedId} as HEAD for Token #${selTok.id} ("${selTok.form}")`, 'success');
        }
      }
      this.isConnectingHead = false;
      this.updateConnectHeadBtnUI();
      this.renderAnnotatorView();
      return;
    }

    // Default mode: Clicking ANY token card in the graph simply SELECTS that token!
    this.selectedAnnotatingTokenId = clickedId;
    this.renderAnnotatorView();

    // Auto-focus quickFormInput for editing token text if user desires
    if (this.quickFormInput && (typeof document === 'undefined' || document.activeElement !== this.quickFormInput)) {
      this.quickFormInput.focus?.();
      this.quickFormInput.select?.();
    }
  }

  toggleConnectHeadMode() {
    if (!this.selectedAnnotatingTokenId) {
      this.showToast('Please select a token first, then click "Connect Head".', 'info');
      return;
    }
    this.isConnectingHead = !this.isConnectingHead;
    this.updateConnectHeadBtnUI();
  }

  updateConnectHeadBtnUI() {
    if (!this.quickConnectHeadBtn) return;
    const selTok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (this.isConnectingHead && selTok) {
      this.quickConnectHeadBtn.className = 'btn btn-primary btn-sm';
      this.quickConnectHeadBtn.textContent = '❌ Cancel Linking';
      if (this.activeSelectionHint) {
        this.activeSelectionHint.textContent = `🔗 Click the target HEAD token in the graph for #${selTok.id} ("${selTok.form}")...`;
      }
    } else {
      this.quickConnectHeadBtn.className = 'btn btn-secondary btn-sm';
      this.quickConnectHeadBtn.textContent = '🔗 Connect Head';
      if (this.activeSelectionHint) {
        if (selTok) {
          this.activeSelectionHint.textContent = `Selected #${selTok.id} "${selTok.form}" (HEAD: ${selTok.head}, DEPREL: ${selTok.deprel})`;
        } else {
          this.activeSelectionHint.textContent = 'Click any token card to select it. Double-click to edit text.';
        }
      }
    }
  }

  handleQuickFormChange(newForm) {
    const tok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (!tok) return;
    tok.form = newForm;

    // Update sentence text display and treebank text
    if (this.currentAnnotatingTb) {
      this.currentAnnotatingTb.text = this.workingAnnotatingTokens.map(t => t.form).join(' ');
      if (this.annotateTbSentText) {
        this.annotateTbSentText.textContent = this.currentAnnotatingTb.text;
      }
    }

    if (this.quickTokName) {
      this.quickTokName.textContent = `#${tok.id} "${tok.form}"`;
    }

    if (this.activeSelectionHint) {
      this.activeSelectionHint.textContent = `Selected #${tok.id} "${tok.form}" (HEAD: ${tok.head}, DEPREL: ${tok.deprel})`;
    }

    if (this.annotatorActiveTab === 'visual') {
      this.renderDependencyGraph();
    } else if (this.annotatorActiveTab === 'table') {
      this.renderAnnotatorTable();
    } else if (this.annotatorActiveTab === 'conllu') {
      this.renderAnnotatorConlluPreview();
    }
  }

  handleQuickLemmaChange(newLemma) {
    const tok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (!tok) return;
    tok.lemma = newLemma;
    this.updateAnnotatorValidation();

    if (this.annotatorActiveTab === 'visual') {
      this.renderDependencyGraph();
    } else if (this.annotatorActiveTab === 'table') {
      this.renderAnnotatorTable();
    } else if (this.annotatorActiveTab === 'conllu') {
      this.renderAnnotatorConlluPreview();
    }
  }

  renderAnnotatorTable() {
    if (!this.tokenTableBody || typeof document === 'undefined') return;
    if (this.tokenTableBody.replaceChildren) {
      this.tokenTableBody.replaceChildren();
    }

    const n = this.workingAnnotatingTokens.length;
    const relOptions = this.annotatorLangRelations.map(r => ({ label: r.label, desc: r.desc }));

    this.workingAnnotatingTokens.forEach((tok) => {
      const tr = document.createElement('tr');
      if (tok.id === this.selectedAnnotatingTokenId) {
        tr.style.backgroundColor = '#f0f9ff';
      }

      // ID column
      const tdId = document.createElement('td');
      tdId.style.fontWeight = '700';
      tdId.style.color = 'var(--text-muted)';
      tdId.textContent = String(tok.id);

      // Form column
      const tdForm = document.createElement('td');
      const formInput = document.createElement('input');
      formInput.type = 'text';
      formInput.className = 'tb-input-sm tok-tbl-form';
      formInput.value = tok.form || '';
      formInput.title = 'Edit word text';
      tdForm.appendChild(formInput);

      // Lemma column
      const tdLemma = document.createElement('td');
      const lemmaInput = document.createElement('input');
      lemmaInput.type = 'text';
      lemmaInput.className = 'tb-input-sm tok-tbl-lemma';
      lemmaInput.value = tok.lemma || tok.form || '';
      lemmaInput.title = 'Edit lemma';
      tdLemma.appendChild(lemmaInput);

      // UPOS column
      const tdUpos = document.createElement('td');
      const uposSelect = document.createElement('select');
      uposSelect.className = 'tb-input-sm tok-tbl-upos';
      UD_UPOS_TAGS.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.tag;
        opt.textContent = u.tag;
        if (tok.upos === u.tag) opt.selected = true;
        uposSelect.appendChild(opt);
      });
      tdUpos.appendChild(uposSelect);

      // HEAD column
      const tdHead = document.createElement('td');
      const headSelect = document.createElement('select');
      headSelect.className = 'tb-input-sm tok-tbl-head';

      const optHeadNone = document.createElement('option');
      optHeadNone.value = '_';
      optHeadNone.textContent = '_ (none)';
      if (tok.head === '_') optHeadNone.selected = true;
      headSelect.appendChild(optHeadNone);

      const optHeadRoot = document.createElement('option');
      optHeadRoot.value = '0';
      optHeadRoot.textContent = '0 (ROOT)';
      if (Number(tok.head) === 0) optHeadRoot.selected = true;
      headSelect.appendChild(optHeadRoot);

      for (let i = 1; i <= n; i++) {
        if (i === tok.id) continue;
        const otherTok = this.workingAnnotatingTokens[i - 1];
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `${i}: ${otherTok?.form || ''}`;
        if (Number(tok.head) === i) opt.selected = true;
        headSelect.appendChild(opt);
      }
      tdHead.appendChild(headSelect);

      // DEPREL column
      const tdDeprel = document.createElement('td');
      const deprelSelect = document.createElement('select');
      deprelSelect.className = 'tb-input-sm tok-tbl-deprel';

      const optDepNone = document.createElement('option');
      optDepNone.value = '_';
      optDepNone.textContent = '_ (none)';
      if (tok.deprel === '_') optDepNone.selected = true;
      deprelSelect.appendChild(optDepNone);

      relOptions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.label;
        opt.textContent = `${r.label} - ${r.desc || ''}`;
        if (tok.deprel === r.label) opt.selected = true;
        deprelSelect.appendChild(opt);
      });
      tdDeprel.appendChild(deprelSelect);

      // Feats column
      const tdFeats = document.createElement('td');
      const featsInput = document.createElement('input');
      featsInput.type = 'text';
      featsInput.className = 'tb-input-sm tok-tbl-feats';
      featsInput.value = tok.feats || tok.selectedReading?.feats || '_';
      tdFeats.appendChild(featsInput);

      tr.append(tdId, tdForm, tdLemma, tdUpos, tdHead, tdDeprel, tdFeats);

      formInput?.addEventListener('input', (e) => {
        tok.form = e.target.value;
        if (this.currentAnnotatingTb) {
          this.currentAnnotatingTb.text = this.workingAnnotatingTokens.map(t => t.form).join(' ');
          if (this.annotateTbSentText) {
            this.annotateTbSentText.textContent = this.currentAnnotatingTb.text;
          }
        }
        if (this.selectedAnnotatingTokenId === tok.id) {
          if (this.quickTokName) this.quickTokName.textContent = `#${tok.id} "${tok.form}"`;
          if (this.quickFormInput && (typeof document === 'undefined' || document.activeElement !== this.quickFormInput)) {
            this.quickFormInput.value = tok.form;
          }
          if (this.activeSelectionHint) {
            this.activeSelectionHint.textContent = `Selected #${tok.id} "${tok.form}" (HEAD: ${tok.head}, DEPREL: ${tok.deprel})`;
          }
        }
      });

      if (tok.deprel && tok.deprel !== '_') {
        if (![...deprelSelect.options].some(o => o.value === tok.deprel)) {
          const opt = document.createElement('option');
          opt.value = tok.deprel;
          opt.textContent = `${tok.deprel} (custom)`;
          deprelSelect.appendChild(opt);
        }
        deprelSelect.value = tok.deprel;
      }

      lemmaInput?.addEventListener('change', (e) => {
        tok.lemma = e.target.value.trim();
        if (this.selectedAnnotatingTokenId === tok.id) {
          if (this.quickLemmaInput && (typeof document === 'undefined' || document.activeElement !== this.quickLemmaInput)) {
            this.quickLemmaInput.value = tok.lemma;
          }
        }
        this.updateAnnotatorValidation();
      });

      uposSelect?.addEventListener('change', (e) => {
        tok.upos = e.target.value;
        if (tok.upos === 'PUNCT') {
          tok.deprel = 'punct';
          deprelSelect.value = 'punct';
        }
        this.updateAnnotatorValidation();
      });

      headSelect?.addEventListener('change', (e) => {
        const val = e.target.value === '_' ? '_' : Number(e.target.value);
        tok.head = val;
        if (val === 0) {
          tok.deprel = 'root';
          deprelSelect.value = 'root';
        } else if (tok.deprel === 'root') {
          tok.deprel = 'dep';
          deprelSelect.value = 'dep';
        }
        this.updateAnnotatorValidation();
      });

      deprelSelect?.addEventListener('change', (e) => {
        tok.deprel = e.target.value;
        if (tok.deprel === 'root' && tok.head !== 0) {
          tok.head = 0;
          headSelect.value = '0';
        }
        this.updateAnnotatorValidation();
      });

      featsInput?.addEventListener('change', (e) => {
        tok.feats = e.target.value.trim() || '_';
      });

      tr.addEventListener('click', (e) => {
        if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
          this.selectedAnnotatingTokenId = tok.id;
          this.renderQuickAnnotationControls();
          tr.parentElement?.querySelectorAll('tr').forEach(r => r.style.backgroundColor = '');
          tr.style.backgroundColor = '#f0f9ff';
          if (this.activeSelectionHint) {
            this.activeSelectionHint.textContent = `Selected #${tok.id} "${tok.form}" (HEAD: ${tok.head}, DEPREL: ${tok.deprel})`;
          }
        }
      });

      this.tokenTableBody.appendChild(tr);
    });
  }

  renderAnnotatorConlluPreview() {
    if (!this.annotateConlluPreview || !this.currentAnnotatingTb) return;
    const conllu = ConlluExporter.export([{
      sent_id: this.currentAnnotatingTb.sent_id,
      text: this.currentAnnotatingTb.text,
      tokens: this.workingAnnotatingTokens,
      translations: this.currentAnnotatingTb.translations
    }]);
    this.annotateConlluPreview.textContent = conllu;
  }

  renderQuickAnnotationControls() {
    if (!this.selectedTokenQuickControls) return;
    if (!this.workingAnnotatingTokens || this.workingAnnotatingTokens.length === 0) {
      this.selectedTokenQuickControls.style.display = 'none';
      return;
    }
    this.selectedTokenQuickControls.style.display = 'flex';

    const tok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (!tok) {
      if (this.quickTokName) {
        this.quickTokName.textContent = '(Click any token card above to select it)';
      }
      if (this.quickFormInput) {
        this.quickFormInput.value = '';
        this.quickFormInput.disabled = true;
      }
      if (this.quickLemmaInput) {
        this.quickLemmaInput.value = '';
        this.quickLemmaInput.disabled = true;
      }
      if (this.quickHeadSelect) {
        if (typeof document !== 'undefined') {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'Select a token...';
          if (this.quickHeadSelect.replaceChildren) {
            this.quickHeadSelect.replaceChildren(opt);
          }
        }
        this.quickHeadSelect.disabled = true;
      }
      if (this.quickSetRootBtn) {
        this.quickSetRootBtn.disabled = true;
      }
      if (this.quickConnectHeadBtn) {
        this.quickConnectHeadBtn.disabled = true;
      }
      if (this.quickDeprelSelect) {
        if (typeof document !== 'undefined') {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'Select a token...';
          if (this.quickDeprelSelect.replaceChildren) {
            this.quickDeprelSelect.replaceChildren(opt);
          }
        }
        this.quickDeprelSelect.disabled = true;
      }
      if (this.quickUposSelect) {
        this.quickUposSelect.disabled = true;
      }
      this.updateConnectHeadBtnUI();
      return;
    }

    // Token is selected: enable all controls
    if (this.quickFormInput) {
      this.quickFormInput.disabled = false;
      if (typeof document === 'undefined' || document.activeElement !== this.quickFormInput) {
        this.quickFormInput.value = tok.form || '';
      }
    }
    if (this.quickLemmaInput) {
      this.quickLemmaInput.disabled = false;
      if (typeof document === 'undefined' || document.activeElement !== this.quickLemmaInput) {
        this.quickLemmaInput.value = tok.lemma || (tok.selectedReading ? tok.selectedReading.lemma : tok.form) || '';
      }
    }
    if (this.quickHeadSelect) this.quickHeadSelect.disabled = false;
    if (this.quickSetRootBtn) this.quickSetRootBtn.disabled = false;
    if (this.quickConnectHeadBtn) this.quickConnectHeadBtn.disabled = false;
    if (this.quickDeprelSelect) this.quickDeprelSelect.disabled = false;
    if (this.quickUposSelect) this.quickUposSelect.disabled = false;

    if (this.quickTokName) {
      this.quickTokName.textContent = `#${tok.id} "${tok.form}"`;
    }

    const n = this.workingAnnotatingTokens.length;

    // HEAD select options
    if (this.quickHeadSelect) {
      if (typeof document !== 'undefined') {
        const options = [];
        const optNone = document.createElement('option');
        optNone.value = '_';
        optNone.textContent = '_ (none)';
        const optRoot = document.createElement('option');
        optRoot.value = '0';
        optRoot.textContent = '0 (ROOT)';
        options.push(optNone, optRoot);

        for (let i = 1; i <= n; i++) {
          if (i === tok.id) continue; // cannot have self as head
          const other = this.workingAnnotatingTokens[i - 1];
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = `${i}: ${other?.form || ''}`;
          options.push(opt);
        }
        if (this.quickHeadSelect.replaceChildren) {
          this.quickHeadSelect.replaceChildren(...options);
        }
      }
      this.quickHeadSelect.value = (tok.head !== undefined && tok.head !== null && tok.head !== '') ? String(tok.head) : '_';
    }

    // DEPREL select options
    if (this.quickDeprelSelect) {
      if (typeof document !== 'undefined') {
        const options = [];
        const optNone = document.createElement('option');
        optNone.value = '_';
        optNone.textContent = '_ (none)';
        options.push(optNone);

        const categories = ['structural', 'core', 'non-core', 'nominal', 'coord', 'mwe', 'subtype', 'language-specific', 'other'];
        categories.forEach(cat => {
          const inCat = this.annotatorLangRelations.filter(r => (r.category || 'other') === cat);
          if (inCat.length > 0) {
            const group = document.createElement('optgroup');
            group.label = cat.toUpperCase();
            inCat.forEach(r => {
              const opt = document.createElement('option');
              opt.value = r.label;
              opt.textContent = `${r.label} (${r.desc || ''})`;
              group.appendChild(opt);
            });
            options.push(group);
          }
        });

        if (tok.deprel && tok.deprel !== '_') {
          const hasOpt = this.annotatorLangRelations.some(r => r.label === tok.deprel);
          if (!hasOpt) {
            const optCustom = document.createElement('option');
            optCustom.value = tok.deprel;
            optCustom.textContent = `${tok.deprel} (custom)`;
            options.push(optCustom);
          }
        }
        if (this.quickDeprelSelect.replaceChildren) {
          this.quickDeprelSelect.replaceChildren(...options);
        }
      }
      this.quickDeprelSelect.value = tok.deprel || '_';
    }

    // UPOS select
    if (this.quickUposSelect) {
      if (typeof document !== 'undefined') {
        const options = UD_UPOS_TAGS.map(u => {
          const opt = document.createElement('option');
          opt.value = u.tag;
          opt.textContent = u.tag;
          if (tok.upos === u.tag) opt.selected = true;
          return opt;
        });
        if (this.quickUposSelect.replaceChildren) {
          this.quickUposSelect.replaceChildren(...options);
        }
      }
      this.quickUposSelect.value = tok.upos || 'NOUN';
    }

    this.updateConnectHeadBtnUI();
  }

  handleQuickHeadChange(newHead) {
    const tok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (!tok) return;
    tok.head = newHead === '_' ? '_' : Number(newHead);
    if (tok.head === 0) {
      tok.deprel = 'root';
    } else if (tok.deprel === 'root') {
      tok.deprel = 'dep';
    }
    this.renderAnnotatorView();
  }

  handleQuickSetRoot() {
    const tok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (!tok) return;
    tok.head = 0;
    tok.deprel = 'root';
    this.showToast(`Set Token #${tok.id} "${tok.form}" as sentence ROOT`, 'info');
    this.renderAnnotatorView();
  }

  handleQuickDeprelChange(newDeprel) {
    const tok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (!tok) return;
    tok.deprel = newDeprel;
    if (newDeprel === 'root' && tok.head !== 0) {
      tok.head = 0;
    }
    this.renderAnnotatorView();
  }

  handleQuickUposChange(newUpos) {
    const tok = this.workingAnnotatingTokens.find(t => t.id === this.selectedAnnotatingTokenId);
    if (!tok) return;
    tok.upos = newUpos;
    if (newUpos === 'PUNCT') {
      tok.deprel = 'punct';
    }
    this.renderAnnotatorView();
  }

  suggestAnnotatorDependencies() {
    if (!this.workingAnnotatingTokens || this.workingAnnotatingTokens.length === 0) return;
    this.workingAnnotatingTokens = dependencyService.inferBaselineDependencies(this.workingAnnotatingTokens);
    this.showToast('Inferred baseline dependency relations (HEAD & DEPREL) from POS tags!', 'success');
    this.renderAnnotatorView();
  }

  toggleLanguageRelationsDrawer() {
    if (!this.languageRelationsDrawer) return;
    const isHidden = this.languageRelationsDrawer.style.display === 'none';
    this.languageRelationsDrawer.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      this.renderLanguageRelationsList();
    }
  }

  renderLanguageRelationsList() {
    if (!this.customRelationsTagsContainer) return;
    this.customRelationsTagsContainer.replaceChildren();

    const lang = this.annotatorLangCode || 'myv';
    const customOnly = this.annotatorLangRelations.filter(r => r.isCustom);

    if (customOnly.length === 0) {
      const span = document.createElement('span');
      span.style.fontSize = '11.5px';
      span.style.color = 'var(--text-muted)';
      span.style.fontStyle = 'italic';
      span.textContent = `No custom relations added yet for ${lang}. All standard UD relations and subtypes are active.`;
      this.customRelationsTagsContainer.replaceChildren(span);
      return;
    }

    customOnly.forEach(rel => {
      const chip = document.createElement('span');
      chip.className = 'custom-rel-tag';
      chip.title = rel.desc || '';

      const span = document.createElement('span');
      span.textContent = rel.label;

      const delBtn = document.createElement('button');
      delBtn.className = 'custom-rel-del-btn';
      delBtn.title = 'Remove relation';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleRemoveCustomRelation(rel.label);
      });

      chip.append(span, delBtn);
      this.customRelationsTagsContainer.appendChild(chip);
    });
  }

  async handleAddCustomRelation() {
    if (!this.newDeprelInput) return;
    const label = this.newDeprelInput.value.trim().toLowerCase();
    const desc = this.newDeprelDescInput ? this.newDeprelDescInput.value.trim() : '';

    if (!label) {
      this.showToast('Please enter a relation label (e.g. compound:svc or nsubj:cop).', 'error');
      return;
    }

    try {
      const lang = this.annotatorLangCode || 'myv';
      this.annotatorLangRelations = await dependencyService.addCustomRelation(lang, label, desc);
      this.newDeprelInput.value = '';
      if (this.newDeprelDescInput) this.newDeprelDescInput.value = '';
      this.renderLanguageRelationsList();
      this.renderQuickAnnotationControls();
      this.showToast(`Added custom relation "${label}" for ${lang}!`, 'success');
    } catch (err) {
      this.showToast('Error adding custom relation: ' + err.message, 'error');
    }
  }

  async handleRemoveCustomRelation(label) {
    try {
      const lang = this.annotatorLangCode || 'myv';
      this.annotatorLangRelations = await dependencyService.removeCustomRelation(lang, label);
      this.renderLanguageRelationsList();
      this.renderQuickAnnotationControls();
      this.showToast(`Removed custom relation "${label}".`, 'info');
    } catch (err) {
      this.showToast('Error removing relation: ' + err.message, 'error');
    }
  }

  async handleResetLanguageRelations() {
    const lang = this.annotatorLangCode || 'myv';
    const confirmed = this.confirmAction(`Reset all dependency relations for ${lang} to standard UD defaults?`);
    if (!confirmed) return;

    try {
      this.annotatorLangRelations = await dependencyService.resetRelationsForLanguage(lang);
      this.renderLanguageRelationsList();
      this.renderQuickAnnotationControls();
      this.showToast(`Reset ${lang} dependency relations to UD defaults.`, 'info');
    } catch (err) {
      this.showToast('Error resetting relations: ' + err.message, 'error');
    }
  }

  async saveAnnotatedTreebank() {
    if (!this.currentAnnotatingTb) return;

    try {
      const updated = await treebankService.updateTreebank(this.currentAnnotatingTb.id, {
        tokens: this.workingAnnotatingTokens
      });

      // If workbench currently has this sentence loaded, update workbench sentence tokens too
      if (this.sentences && this.sentences.length > 0) {
        const matchingSent = this.sentences.find(s => s.sent_id === updated.sent_id || treebankService.normalizeText(s.text) === treebankService.normalizeText(updated.text));
        if (matchingSent) {
          matchingSent.tokens = JSON.parse(JSON.stringify(updated.tokens));
          this.renderInterlinear();
        }
      }

      this.updateTreebankUI();
      this.updateExports();
      this.showToast(`Saved dependency annotations for Treebank #${updated.sent_id}!`, 'success');
      this.closeTreebankAnnotator();
      return updated;
    } catch (err) {
      this.showToast('Error saving treebank: ' + err.message, 'error');
      throw err;
    }
  }

  downloadCurrentAnnotatedSentence() {
    if (!this.currentAnnotatingTb) return;
    const conllu = ConlluExporter.export([{
      sent_id: this.currentAnnotatingTb.sent_id,
      text: this.currentAnnotatingTb.text,
      tokens: this.workingAnnotatingTokens,
      translations: this.currentAnnotatingTb.translations
    }]);

    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([conllu], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `treebank_${this.currentAnnotatingTb.sent_id}_${this.annotatorLangCode || 'annotated'}.conllu`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    this.showToast(`Downloaded treebank_${this.currentAnnotatingTb.sent_id}.conllu`, 'success');
    return conllu;
  }

  // Modal & Dictionary Management (Requirement: "Make it possible to add own dictionaries")
  async openModal() {
    this.settingsModal.classList.add('open');
    this.updateModelStatusDisplay();
    const nightlySelect = document.getElementById('nightlyModelLang');
    const customInput = document.getElementById('nightlyModelLangCustomInput');
    if (nightlySelect && this.srcLang) {
      this.ensureOptionInSelect(nightlySelect, this.srcLang, `${this.srcLang} (${getLangDisplayName(this.srcLang)})`);
      nightlySelect.value = this.srcLang;
      if (customInput) customInput.style.display = 'none';
    }
    await this.renderCustomEntriesTable();
  }

  closeModal() {
    this.settingsModal.classList.remove('open');
  }

  updateModelStatusDisplay() {
    const anEl = document.getElementById('activeAnalyserName');
    const diEl = document.getElementById('activeDictName');
    if (anEl) anEl.textContent = analyzerService.activeModelName;
    if (diEl) diEl.textContent = dictionaryService.activeDictName;
  }

  async renderCustomEntriesTable() {
    const entries = await storageService.getCustomEntries();
    this.customEntriesTableBody.replaceChildren();

    if (entries.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.textAlign = 'center';
      td.style.color = 'var(--text-muted)';
      td.style.padding = '12px';
      td.textContent = 'No custom dictionary entries yet.';
      tr.appendChild(td);
      this.customEntriesTableBody.replaceChildren(tr);
      return;
    }

    entries.forEach(e => {
      const tr = document.createElement('tr');

      const tdLemma = document.createElement('td');
      const strongLemma = document.createElement('strong');
      strongLemma.textContent = e.lemma;
      tdLemma.appendChild(strongLemma);

      const tdPos = document.createElement('td');
      const posBadge = document.createElement('span');
      posBadge.className = 'tag-badge upos';
      posBadge.textContent = e.pos || '—';
      tdPos.appendChild(posBadge);

      const tdGloss = document.createElement('td');
      tdGloss.textContent = e.gloss;

      const tdLang = document.createElement('td');
      const langBadge = document.createElement('span');
      langBadge.className = 'gloss-lang-badge';
      langBadge.textContent = (e.tgt_lang || '').toUpperCase();
      tdLang.appendChild(langBadge);

      const tdDel = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-remove btn-sm';
      delBtn.title = 'Delete entry';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', async () => {
        await dictionaryService.deleteCustomEntry(e.id);
        await this.renderCustomEntriesTable();
        this.relookupAllGlosses();
      });
      tdDel.appendChild(delBtn);

      tr.append(tdLemma, tdPos, tdGloss, tdLang, tdDel);
      this.customEntriesTableBody.appendChild(tr);
    });
  }

  async handleAddCustomEntry() {
    const lemma = prompt('Enter lemma / headword (e.g. вастома):');
    if (!lemma || !lemma.trim()) return;

    const gloss = prompt(`Enter gloss for "${lemma}" (e.g. meeting):`);
    if (!gloss || !gloss.trim()) return;

    const tgtLang = prompt('Enter 3-letter target ISO language code (e.g. eng, fin, rus):', this.targetLang || 'eng');
    const pos = prompt('Enter Part of Speech (e.g. N, V, A, Adv):', 'N');

    await dictionaryService.addCustomEntry({
      src_lang: this.srcLang,
      lemma: lemma.trim(),
      pos: (pos || '').trim(),
      tgt_lang: (tgtLang || 'eng').trim().toLowerCase(),
      gloss: gloss.trim(),
      notes: 'Manual entry'
    });

    await this.renderCustomEntriesTable();
    this.syncSourceLanguagesFromDictionary();
    this.relookupAllGlosses();
    this.showToast(`Added custom entry for "${lemma}"!`, 'success');
  }

  async handleImportDictionary() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tsv,.csv,.txt,.json,.lexc';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const ext = file.name.split('.').pop().toLowerCase();
      const format = ext === 'json' ? 'json' : ext === 'lexc' ? 'lexc' : ext === 'csv' ? 'csv' : 'tsv';
      const text = await file.text();

      try {
        const count = await dictionaryService.importCustomDictionary(text, format, this.srcLang, this.targetLang);
        await this.renderCustomEntriesTable();
        this.syncSourceLanguagesFromDictionary();
        this.relookupAllGlosses();
        this.showToast(`Imported ${count} entries from ${file.name}!`, 'success');
      } catch (err) {
        this.showToast('Import error: ' + err.message, 'error');
      }
    };

    input.click();
  }

  async handleExportDictionary() {
    const tsv = await dictionaryService.exportCustomDictionary('tsv');
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom_dictionary_${this.srcLang}.tsv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('Exported custom dictionary!', 'success');
  }

  async handleRenewUralicAnalyzers() {
    const rawLang = this.srcLang || document.getElementById('inputTextLangSelect')?.value || 'myv';
    const lang = normalizeLangCode(rawLang);
    const langName = getLangDisplayName(lang);
    const btn = this.renewUralicModelsTopBtn || document.getElementById('renewUralicModelsTopBtn');
    const label = document.getElementById('renewUralicBtnLabel');

    if (btn) {
      btn.disabled = true;
      btn.classList.add('renewing');
    }
    if (label) label.textContent = 'Renewing...';

    this.showToast(`Connecting to UralicNLP nightly server for ${langName} (${lang})...`, 'info');

    try {
      const res = await analyzerService.downloadAndLoadModel(lang, null, (received, total, pct) => {
        if (label) {
          label.textContent = total > 0 ? `${pct}%` : `${(received / 1024 / 1024).toFixed(1)}MB`;
        }
      });

      this.updateModelStatusDisplay();
      if (this.inputAnalyzerBadge) {
        this.inputAnalyzerBadge.textContent = `Analyzer: ${langName} (${lang}) [UralicNLP Renewed]`;
      }
      const sizeMb = res?.size ? ` (${(res.size / 1024 / 1024).toFixed(1)} MB)` : '';
      this.showToast(`✓ Successfully renewed UralicNLP analyzer for ${langName} (${lang})${sizeMb}!`, 'success');

      // Re-analyze workspace text if present so all tokens get refreshed readings
      if (this.sentences.length > 0 || (this.inputTextArea && this.inputTextArea.value.trim())) {
        await this.handleAnalyze();
      }
    } catch (err) {
      console.warn('Error renewing UralicNLP model:', err);
      this.showToast(`Could not renew from UralicNLP: ${err.message}. Retained current analyzer.`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('renewing');
      }
      if (label) label.textContent = 'Renew UralicNLP';
    }
  }

  async handleDownloadModel() {
    const nightlySelect = document.getElementById('nightlyModelLang');
    const customInput = document.getElementById('nightlyModelLangCustomInput');
    let rawLang = nightlySelect?.value || 'myv';

    if (rawLang === 'custom') {
      let customVal = customInput?.value?.trim();
      if (!customVal) {
        const code = prompt('Enter 3-letter ISO language code for UralicNLP nightly model (e.g. vro, liv, fit, vep, mhr):', this.srcLang || 'vro');
        if (!code || !code.trim()) return;
        customVal = code.trim();
        if (customInput) customInput.value = customVal;
      }
      rawLang = customVal;
    }

    const lang = normalizeLangCode(rawLang);
    const progressEl = document.getElementById('modelDownloadProgress');
    const progressText = document.getElementById('modelDownloadText');
    const progressBar = document.getElementById('modelProgressBar');

    if (progressEl) progressEl.style.display = 'block';

    try {
      this.showToast(`Downloading UralicNLP ${lang.toUpperCase()} model...`, 'info');
      await analyzerService.downloadAndLoadModel(lang, null, (received, total, pct) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`;
      });

      if (nightlySelect) {
        this.ensureOptionInSelect(nightlySelect, lang, `${lang} (${getLangDisplayName(lang)})`);
        nightlySelect.value = lang;
        if (customInput) customInput.style.display = 'none';
      }
      this.ensureOptionInSelect(this.srcLangSelect, lang, `${lang} (${getLangDisplayName(lang)})`);
      this.ensureOptionInSelect(this.inputTextLangSelect, lang, `${lang} (${getLangDisplayName(lang)})`);

      this.srcLang = lang;
      if (this.srcLangSelect) this.srcLangSelect.value = lang;
      if (this.inputTextLangSelect) this.inputTextLangSelect.value = lang;
      this.updateInputAnalyzerBadge();
      await storageService.setSetting('ui_src_lang', this.srcLang);

      this.updateModelStatusDisplay();
      this.showToast(`Downloaded & activated ${lang.toUpperCase()} analyzer!`, 'success');
      if (this.sentences.length > 0) this.handleAnalyze();
    } catch (err) {
      this.showToast('Download error: ' + err.message, 'error');
    } finally {
      if (progressEl) progressEl.style.display = 'none';
    }
  }

  async handleUploadModel(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const id = `custom_analyser_${Date.now()}`;
      await analyzerService.loadFromBuffer(buffer, id, file.name, true);
      this.updateModelStatusDisplay();
      this.showToast(`Loaded custom analyzer "${file.name}"!`, 'success');
      if (this.sentences.length > 0) this.handleAnalyze();
    } catch (err) {
      this.showToast('Error loading analyzer: ' + err.message, 'error');
    }
  }

  async handleDownloadDict() {
    const progressEl = document.getElementById('dictDownloadProgress');
    const progressText = document.getElementById('dictDownloadText');
    const progressBar = document.getElementById('dictProgressBar');

    if (progressEl) progressEl.style.display = 'block';

    try {
      this.showToast('Downloading UralicNLP multi-language dictionary transducer...', 'info');
      await dictionaryService.downloadAndLoadDictionary(null, (received, total, pct) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`;
      });
      this.updateModelStatusDisplay();
      this.showToast('Full UralicNLP dictionary loaded & activated!', 'success');
      if (this.sentences.length > 0) this.relookupAllGlosses();
    } catch (err) {
      this.showToast('Dictionary download error: ' + err.message, 'error');
    } finally {
      if (progressEl) progressEl.style.display = 'none';
    }
  }

  async handleUploadDict(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const id = `custom_dict_${Date.now()}`;
      await dictionaryService.loadFromBuffer(buffer, id, file.name, true);
      this.updateModelStatusDisplay();
      this.showToast(`Loaded custom dictionary "${file.name}"!`, 'success');
      if (this.sentences.length > 0) this.relookupAllGlosses();
    } catch (err) {
      this.showToast('Error loading dictionary: ' + err.message, 'error');
    }
  }

  showToast(message, type = 'info') {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.className = `toast show ${type}`;
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      this.toastEl.className = 'toast';
    }, 3500);
  }

  // ==========================================================================
  // Paradigm Discoverer Controller (Koskenniemi twol / LexC / LexD)
  // ==========================================================================

  initParadigmDiscoverer() {
    this.openParadigmDiscovererBtn = document.getElementById('openParadigmDiscovererBtn');
    this.paradigmModal = document.getElementById('paradigmModal');
    this.closeParadigmBtn = document.getElementById('closeParadigmBtn');
    this.closeParadigmFooterBtn = document.getElementById('closeParadigmFooterBtn');
    this.paradigmLangSelect = document.getElementById('paradigmLangSelect');
    this.paradigmLangCustomInput = document.getElementById('paradigmLangCustomInput');
    this.paradigmPresetSelect = document.getElementById('paradigmPresetSelect');
    this.newParadigmBtn = document.getElementById('newParadigmBtn');
    this.saveParadigmModelBtn = document.getElementById('saveParadigmModelBtn');
    this.paradigmInputText = document.getElementById('paradigmInputText');
    this.discoverParadigmBtn = document.getElementById('discoverParadigmBtn');
    this.clearParadigmInputBtn = document.getElementById('clearParadigmInputBtn');
    this.paradigmFormulaBadge = document.getElementById('paradigmFormulaBadge');
    this.paradigmAlignedOutput = document.getElementById('paradigmAlignedOutput');
    this.rederiveParadigmBtn = document.getElementById('rederiveParadigmBtn');
    this.morphRenamingBar = document.getElementById('morphRenamingBar');
    this.paradigmMatrixContainer = document.getElementById('paradigmMatrixContainer');
    this.grammarCodeDisplay = document.getElementById('grammarCodeDisplay');
    this.showTwolCodeBtn = document.getElementById('showTwolCodeBtn');
    this.showLexcCodeBtn = document.getElementById('showLexcCodeBtn');
    this.showLexdCodeBtn = document.getElementById('showLexdCodeBtn');
    this.copyGrammarCodeBtn = document.getElementById('copyGrammarCodeBtn');
    this.downloadAllGrammarBtn = document.getElementById('downloadAllGrammarBtn');
    this.classifierModelLangBadge = document.getElementById('classifierModelLangBadge');
    this.classifierTestLangBadge = document.getElementById('classifierTestLangBadge');
    this.stemRegexPatternDisplay = document.getElementById('stemRegexPatternDisplay');
    this.stemRegexExplanationDisplay = document.getElementById('stemRegexExplanationDisplay');
    this.lexcRegexRuleDisplay = document.getElementById('lexcRegexRuleDisplay');
    this.lexcRegexExplanationDisplay = document.getElementById('lexcRegexExplanationDisplay');
    this.copyLexcRegexRuleBtn = document.getElementById('copyLexcRegexRuleBtn');
    this.candidateGuessesContainer = document.getElementById('candidateGuessesContainer');
    this.candidateGuessesList = document.getElementById('candidateGuessesList');
    this.newWordTestInput = document.getElementById('newWordTestInput');
    this.classifyNewWordBtn = document.getElementById('classifyNewWordBtn');
    this.classifyUploadFileInput = document.getElementById('classifyUploadFileInput');
    this.classifyUploadFileBtn = document.getElementById('classifyUploadFileBtn');
    this.clearClassifierInputBtn = document.getElementById('clearClassifierInputBtn');
    this.disambiguationWalkthroughContainer = document.getElementById('disambiguationWalkthroughContainer');
    this.disambiguationStepsList = document.getElementById('disambiguationStepsList');
    this.gradationBadge = document.getElementById('gradationBadge');
    this.analyzerGuesserMatchesContainer = document.getElementById('analyzerGuesserMatchesContainer');
    this.analyzerGuesserMatchesList = document.getElementById('analyzerGuesserMatchesList');
    this.newWordPredictionContainer = document.getElementById('newWordPredictionContainer');
    this.predictionBanner = document.getElementById('predictionBanner');
    this.predictedFormsTableBody = document.getElementById('predictedFormsTableBody');
    this.paradigmIsolateStemToggle = document.getElementById('paradigmIsolateStemToggle');
    this.classifierActiveEngineBadge = document.getElementById('classifierActiveEngineBadge');
    this.classifierEngineChoices = document.querySelectorAll('input[name="classifierEngineChoice"]');
    this.classifierUralicNlpStatusContainer = document.getElementById('classifierUralicNlpStatusContainer');
    this.classifierUralicNlpStatusDot = document.getElementById('classifierUralicNlpStatusDot');
    this.classifierUralicNlpStatusText = document.getElementById('classifierUralicNlpStatusText');
    this.classifierLoadUralicNlpBtn = document.getElementById('classifierLoadUralicNlpBtn');
    this.distinctionNoteContainer = document.getElementById('distinctionNoteContainer');
    this.distinctionNoteText = document.getElementById('distinctionNoteText');

    if (this.paradigmIsolateStemToggle) {
      this.paradigmIsolateStemToggle.addEventListener('change', () => {
        const isIsolated = this.paradigmIsolateStemToggle.checked;
        this.showToast(isIsolated ? 'Paradigm Explorer: Isolating inflected head stem' : 'Paradigm Explorer: Preserving full compound & guess tags', 'info');
        if (this.activeParadigmWordData) {
          this.applyParadigmWordData(this.activeParadigmWordData, isIsolated);
        } else {
          const activeTab = document.querySelector('.paradigm-tab.active')?.getAttribute('data-tab');
          if (activeTab === 'classifier') {
            this.handleClassifyNewWord();
          } else if (activeTab === 'input') {
            this.handleDiscoverParadigm();
          }
        }
      });
    }

    // Populate Presets & sync initial language
    this.populateParadigmPresets('vro_type_41_kand');
    this.updateParadigmLangUI('vro');

    if (this.paradigmPresetSelect) {
      this.paradigmPresetSelect.addEventListener('change', () => {
        const selVal = this.paradigmPresetSelect.value;
        if (selVal === 'custom') {
          return;
        }
        const allPresets = [...paradigmService.defaultPresets, ...paradigmService.savedParadigms];
        const found = allPresets.find(p => p.id === selVal);
        if (found && this.paradigmInputText) {
          this.paradigmInputText.value = found.text;
          this.customMorphRenames = {};
          if (found.lang) {
            this.updateParadigmLangUI(found.lang);
          }
          this.handleDiscoverParadigm();
        }
      });
    }

    // Language selector change
    if (this.paradigmLangSelect) {
      this.paradigmLangSelect.addEventListener('change', () => {
        if (this.paradigmLangSelect.value === 'custom') {
          if (this.paradigmLangCustomInput) {
            this.paradigmLangCustomInput.style.display = 'inline-block';
            this.paradigmLangCustomInput.focus();
          }
        } else {
          if (this.paradigmLangCustomInput) {
            this.paradigmLangCustomInput.style.display = 'none';
          }
        }
        const lang = this.getSelectedParadigmLang();
        this.updateParadigmLangUI(lang);
      });
    }

    if (this.paradigmLangCustomInput) {
      this.paradigmLangCustomInput.addEventListener('input', () => {
        const lang = this.getSelectedParadigmLang();
        this.updateParadigmLangUI(lang);
      });
    }

    // New Input button (clears textarea and prepares for user forms)
    if (this.newParadigmBtn) {
      this.newParadigmBtn.addEventListener('click', () => {
        if (this.paradigmPresetSelect) this.paradigmPresetSelect.value = 'custom';
        if (this.paradigmInputText) {
          this.paradigmInputText.value = '';
          this.paradigmInputText.focus();
        }
        if (this.paradigmAlignedOutput) {
          this.paradigmAlignedOutput.textContent = '(Enter new word forms with tags and click "⚡ Discover & Align")';
        }
        if (this.paradigmFormulaBadge) {
          this.paradigmFormulaBadge.textContent = 'Formula: -';
        }
        const lang = this.getSelectedParadigmLang();
        this.showToast(`Ready for new word forms. Language indicated: ${lang}. Enter forms with tags (one per line).`, 'info');
      });
    }

    // Save Paradigm Model button
    if (this.saveParadigmModelBtn) {
      this.saveParadigmModelBtn.addEventListener('click', () => {
        const rawText = this.paradigmInputText ? this.paradigmInputText.value.trim() : '';
        if (!rawText) {
          this.showToast('Please enter paradigm forms before saving', 'warning');
          return;
        }
        const parsedForms = paradigmService.parseInputForms(rawText);
        const lemma = parsedForms[0]?.lemma || 'custom';
        const lang = this.getSelectedParadigmLang();
        const modelId = `custom_${lang}_${lemma}_${Date.now()}`;
        const modelName = `${lang.toUpperCase()} Model: ${lemma} (${parsedForms.length} forms)`;

        paradigmService.saveCustomParadigm({
          id: modelId,
          name: modelName,
          lang: lang,
          pos: 'N',
          text: rawText,
          description: `Custom ${lang} paradigm for ${lemma}`
        });

        this.populateParadigmPresets(modelId);
        this.showToast(`Saved paradigm model "${modelName}" for language "${lang}"!`, 'success');
      });
    }

    // Default text in textarea
    if (this.paradigmInputText && !this.paradigmInputText.value) {
      const defPreset = paradigmService.defaultPresets.find(p => p.id === 'vro_type_41_kand');
      if (defPreset) this.paradigmInputText.value = defPreset.text;
    }

    // Modal open / close
    if (this.openParadigmDiscovererBtn && this.paradigmModal) {
      this.openParadigmDiscovererBtn.addEventListener('click', () => {
        this.paradigmModal.classList.add('open');
        this.paradigmModal.classList.add('show');
        if (!this.currentParadigmAnalysis) {
          this.handleDiscoverParadigm();
        }
      });
    }

    const closeModal = () => {
      if (this.paradigmModal) {
        this.paradigmModal.classList.remove('open');
        this.paradigmModal.classList.remove('show');
      }
    };
    if (this.closeParadigmBtn) this.closeParadigmBtn.addEventListener('click', closeModal);
    if (this.closeParadigmFooterBtn) this.closeParadigmFooterBtn.addEventListener('click', closeModal);
    if (this.paradigmModal) {
      this.paradigmModal.addEventListener('click', (e) => {
        if (e.target === this.paradigmModal) closeModal();
      });
    }

    // Modal navigation tabs
    const tabBtns = document.querySelectorAll('.paradigm-tab');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.paradigm-pane').forEach(pane => {
          pane.classList.toggle('active', pane.id === `paneParadigm${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`);
        });
        if (targetTab === 'classifier') {
          this.updateUralicNlpStatusUI();
        }
      });
    });

    // Discover & Align button
    if (this.discoverParadigmBtn) {
      this.discoverParadigmBtn.addEventListener('click', () => {
        this.customMorphRenames = {};
        this.handleDiscoverParadigm();
      });
    }

    // Clear button
    if (this.clearParadigmInputBtn) {
      this.clearParadigmInputBtn.addEventListener('click', () => {
        if (this.paradigmInputText) this.paradigmInputText.value = '';
        if (this.paradigmAlignedOutput) this.paradigmAlignedOutput.textContent = '(Enter paradigm forms and click Discover)';
        if (this.paradigmFormulaBadge) this.paradigmFormulaBadge.textContent = 'Formula: -';
      });
    }

    // Human-in-the-loop Re-derive button
    if (this.rederiveParadigmBtn) {
      this.rederiveParadigmBtn.addEventListener('click', () => {
        this.handleRederiveParadigm();
      });
    }

    // Grammar sub-tabs
    if (this.showTwolCodeBtn) {
      this.showTwolCodeBtn.addEventListener('click', () => {
        this.currentGrammarView = 'twol';
        this.updateGrammarDisplay();
      });
    }
    if (this.showLexcCodeBtn) {
      this.showLexcCodeBtn.addEventListener('click', () => {
        this.currentGrammarView = 'lexc';
        this.updateGrammarDisplay();
      });
    }
    if (this.showLexdCodeBtn) {
      this.showLexdCodeBtn.addEventListener('click', () => {
        this.currentGrammarView = 'lexd';
        this.updateGrammarDisplay();
      });
    }

    // Copy grammar code button
    if (this.copyGrammarCodeBtn) {
      this.copyGrammarCodeBtn.addEventListener('click', () => {
        if (this.grammarCodeDisplay) {
          navigator.clipboard?.writeText(this.grammarCodeDisplay.textContent);
          this.showToast(`Copied ${this.currentGrammarView.toUpperCase()} code to clipboard!`, 'success');
        }
      });
    }

    // Download grammar button
    if (this.downloadAllGrammarBtn) {
      this.downloadAllGrammarBtn.addEventListener('click', () => {
        this.handleDownloadGrammar();
      });
    }

    // Copy LexC regex rule button
    if (this.copyLexcRegexRuleBtn) {
      this.copyLexcRegexRuleBtn.addEventListener('click', async () => {
        const text = this.lexcRegexRuleDisplay ? this.lexcRegexRuleDisplay.textContent.trim() : '';
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          this.showToast('Copied LexC regex rule to clipboard!', 'success');
        } catch {
          this.showToast('Failed to copy to clipboard', 'error');
        }
      });
    }

    // New word classifier button
    if (this.classifyNewWordBtn) {
      this.classifyNewWordBtn.addEventListener('click', () => {
        this.handleClassifyNewWord();
      });
    }

    if (this.classifyUploadFileBtn && this.classifyUploadFileInput) {
      this.classifyUploadFileBtn.addEventListener('click', () => {
        this.classifyUploadFileInput.click();
      });

      this.classifyUploadFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
          const content = loadEvent.target.result;
          if (typeof content === 'string') {
            // Normalize CSV / TSV / newline records into clean forms
            const lines = content.split(/[\r\n]+/)
              .map(l => l.trim())
              .filter(l => l && !l.startsWith('#'));
            const extractedForms = [];
            for (const line of lines) {
              const cells = line.split(/[,\t]+/).map(c => c.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
              for (const c of cells) {
                const tok = c.includes(':') ? c.split(':')[1].trim() : (c.includes('+') ? c.split('+')[0].trim() : c);
                if (tok) extractedForms.push(tok);
              }
            }
            if (extractedForms.length > 0 && this.newWordTestInput) {
              this.newWordTestInput.value = extractedForms.join(', ');
              this.showToast(`Loaded ${extractedForms.length} forms from ${file.name}`, 'info');
              this.handleClassifyNewWord();
            } else {
              this.showToast(`No forms parsed from ${file.name}`, 'warning');
            }
          }
        };
        reader.readAsText(file, 'utf-8');
        // Reset file input so re-uploading the same file fires change event
        e.target.value = '';
      });
    }

    if (this.clearClassifierInputBtn) {
      this.clearClassifierInputBtn.addEventListener('click', () => {
        if (this.newWordTestInput) this.newWordTestInput.value = '';
        if (this.newWordPredictionContainer) this.newWordPredictionContainer.style.display = 'none';
      });
    }

    // Attach sample chip handlers
    const sampleChips = document.querySelectorAll('.classifier-sample-chip');
    sampleChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const sampleForms = chip.getAttribute('data-forms') || chip.textContent.trim();
        if (this.newWordTestInput) {
          this.newWordTestInput.value = sampleForms;
          this.handleClassifyNewWord();
        }
      });
    });

    if (this.newWordTestInput) {
      this.newWordTestInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
          e.preventDefault();
          this.handleClassifyNewWord();
        }
      });
    }

    // Engine Choice Radio listeners
    if (this.classifierEngineChoices) {
      this.classifierEngineChoices.forEach(radio => {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            this.handleClassifierEngineChange(radio.value);
          }
        });
      });
    }

    // UralicNLP FST Load/Download button listener
    if (this.classifierLoadUralicNlpBtn) {
      this.classifierLoadUralicNlpBtn.addEventListener('click', async () => {
        const lang = this.getSelectedParadigmLang();
        this.classifierLoadUralicNlpBtn.disabled = true;
        this.classifierLoadUralicNlpBtn.textContent = `⏳ Loading UralicNLP ${lang}...`;
        try {
          await analyzerService.ensureModelForLanguage(lang);
          this.showToast(`UralicNLP transducer for ${lang} loaded into memory!`, 'success');
          this.updateUralicNlpStatusUI(lang);
          if (this.newWordTestInput && this.newWordTestInput.value.trim()) {
            this.handleClassifyNewWord();
          }
        } catch (err) {
          this.showToast(`Could not load UralicNLP for ${lang}: ${err.message}`, 'error');
        } finally {
          this.classifierLoadUralicNlpBtn.disabled = false;
        }
      });
    }
  }

  getSelectedClassifierEngine() {
    const selected = document.querySelector('input[name="classifierEngineChoice"]:checked');
    return selected ? selected.value : 'combined';
  }

  handleClassifierEngineChange(engine) {
    this.updateClassifierEngineBadge(engine);
    if (this.newWordTestInput && this.newWordTestInput.value.trim()) {
      this.handleClassifyNewWord();
    }
  }

  updateClassifierEngineBadge(engine) {
    if (!this.classifierActiveEngineBadge) return;
    if (engine === 'uralicnlp') {
      this.classifierActiveEngineBadge.textContent = 'Engine: 🌐 UralicNLP Transducer (+Guess FST)';
      this.classifierActiveEngineBadge.style.background = '#fff7ed';
      this.classifierActiveEngineBadge.style.color = '#c2410c';
      this.classifierActiveEngineBadge.style.border = '1px solid #fed7aa';
    } else if (engine === 'langjack') {
      this.classifierActiveEngineBadge.textContent = 'Engine: ⚡ LangJack Two-Level (twol)';
      this.classifierActiveEngineBadge.style.background = '#f0fdf4';
      this.classifierActiveEngineBadge.style.color = '#15803d';
      this.classifierActiveEngineBadge.style.border = '1px solid #bbf7d0';
    } else {
      this.classifierActiveEngineBadge.textContent = 'Engine: 🔀 Combined Mode';
      this.classifierActiveEngineBadge.style.background = '#eff6ff';
      this.classifierActiveEngineBadge.style.color = '#1d4ed8';
      this.classifierActiveEngineBadge.style.border = '1px solid #bfdbfe';
    }
  }

  updateUralicNlpStatusUI(lang) {
    const targetLang = lang || this.getSelectedParadigmLang() || 'vro';
    if (!this.classifierUralicNlpStatusContainer) return;
    const isLoaded = analyzerService && typeof analyzerService.hasModelForLanguage === 'function' && analyzerService.hasModelForLanguage(targetLang);

    if (isLoaded) {
      if (this.classifierUralicNlpStatusDot) this.classifierUralicNlpStatusDot.style.background = '#22c55e';
      if (this.classifierUralicNlpStatusText) {
        this.classifierUralicNlpStatusText.textContent = `✓ UralicNLP ${targetLang.toUpperCase()} transducer is loaded in memory and ready.`;
        this.classifierUralicNlpStatusText.style.color = '#15803d';
      }
      if (this.classifierLoadUralicNlpBtn) {
        this.classifierLoadUralicNlpBtn.textContent = '✓ Transducer Ready';
        this.classifierLoadUralicNlpBtn.disabled = true;
        this.classifierLoadUralicNlpBtn.style.opacity = '0.6';
      }
    } else {
      if (this.classifierUralicNlpStatusDot) this.classifierUralicNlpStatusDot.style.background = '#f59e0b';
      if (this.classifierUralicNlpStatusText) {
        this.classifierUralicNlpStatusText.textContent = `UralicNLP ${targetLang.toUpperCase()} transducer not currently in memory.`;
        this.classifierUralicNlpStatusText.style.color = '#92400e';
      }
      if (this.classifierLoadUralicNlpBtn) {
        this.classifierLoadUralicNlpBtn.textContent = `⬇️ Load / Download UralicNLP ${targetLang.toUpperCase()} FST`;
        this.classifierLoadUralicNlpBtn.disabled = false;
        this.classifierLoadUralicNlpBtn.style.opacity = '1';
        this.classifierLoadUralicNlpBtn.style.display = 'inline-block';
      }
    }
  }

  getSelectedParadigmLang() {
    if (this.paradigmLangSelect) {
      if (this.paradigmLangSelect.value === 'custom') {
        return this.paradigmLangCustomInput?.value.trim().toLowerCase() || 'custom';
      }
      return this.paradigmLangSelect.value;
    }
    return 'vro';
  }

  setParadigmLanguage(lang) {
    this.updateParadigmLangUI(lang);
  }

  updateParadigmLangUI(lang) {
    if (!lang) return;
    if (this.paradigmLangSelect) {
      const hasOpt = Array.from(this.paradigmLangSelect.options).some(o => o.value === lang);
      if (hasOpt) {
        this.paradigmLangSelect.value = lang;
        if (this.paradigmLangCustomInput) this.paradigmLangCustomInput.style.display = 'none';
      } else {
        this.paradigmLangSelect.value = 'custom';
        if (this.paradigmLangCustomInput) {
          this.paradigmLangCustomInput.style.display = 'inline-block';
          this.paradigmLangCustomInput.value = lang;
        }
      }
    }
    if (this.classifierModelLangBadge) {
      this.classifierModelLangBadge.textContent = `Language: ${lang}`;
    }
    if (this.classifierTestLangBadge) {
      this.classifierTestLangBadge.textContent = `Target Language: ${lang}`;
    }
    this.updateUralicNlpStatusUI(lang);
  }

  /**
   * Opens the Paradigm Discoverer pre-populated with a specific word / lemma and language.
   * Enables seamless inspection of guessed or unrecognized word forms in the Paradigm Explorer.
   */
  openParadigmForWord(word, lang = null, rawAnalysis = null, guessedReadings = []) {
    if (!this.paradigmModal) return;
    this.paradigmModal.classList.add('open');
    this.paradigmModal.classList.add('show');

    const targetLang = lang || this.srcLang || 'myv';
    this.setParadigmLanguage(targetLang);

    this.activeParadigmWordData = { word, lang: targetLang, rawAnalysis, guessedReadings };
    const isIsolated = this.paradigmIsolateStemToggle ? this.paradigmIsolateStemToggle.checked : true;
    this.applyParadigmWordData(this.activeParadigmWordData, isIsolated);

    // Switch to classifier pane
    const classifierTab = document.querySelector('.paradigm-tab[data-tab="classifier"]');
    if (classifierTab) {
      classifierTab.click();
    }
  }

  applyParadigmWordData(data, isIsolated) {
    if (!data) return;
    const { word, rawAnalysis, guessedReadings } = data;
    let targetWord = word;

    if (isIsolated) {
      // Isolate head stem from compound (# or +Cmp) and strip +Guess
      const candidateRaw = (guessedReadings && guessedReadings[0]?.raw) || rawAnalysis || word;
      if (candidateRaw && candidateRaw.includes('#')) {
        const parts = candidateRaw.split('#');
        const headPart = parts[parts.length - 1];
        const headSubParts = headPart.split('+').filter(Boolean);
        const nonGuess = headSubParts.filter(p => !/^«?\+?guess»?$/i.test(p) && !POS_TO_UPOS[p] && !/^[A-Z]_\d+/.test(p));
        targetWord = nonGuess[0] || headSubParts[0] || word;
      } else if (candidateRaw && candidateRaw.includes('+Cmp')) {
        const parts = candidateRaw.split('+Cmp');
        const headPart = parts[parts.length - 1].replace(/^[+#]/, '');
        const headSubParts = headPart.split('+').filter(Boolean);
        const nonGuess = headSubParts.filter(p => !/^«?\+?guess»?$/i.test(p) && !POS_TO_UPOS[p] && !/^[A-Z]_\d+/.test(p));
        targetWord = nonGuess[0] || headSubParts[0] || word;
      }
      targetWord = stripGuessTags(targetWord) || targetWord;
    } else {
      // Preserve full compound & guess tags
      targetWord = (guessedReadings && guessedReadings[0]?.raw) || rawAnalysis || word;
    }

    if (this.newWordTestInput) {
      this.newWordTestInput.value = targetWord;
    }

    if (this.classifyNewWordBtn && targetWord) {
      setTimeout(() => this.handleClassifyNewWord(), 50);
    }
  }

  populateParadigmPresets(selectedId = null) {
    if (!this.paradigmPresetSelect) return;
    const currentVal = selectedId || this.paradigmPresetSelect.value || 'vro_type_41_kand';
    this.paradigmPresetSelect.replaceChildren();

    const allPresets = [...paradigmService.defaultPresets, ...paradigmService.savedParadigms];
    allPresets.forEach(preset => {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = `${preset.id.startsWith('custom_') ? '💾 ' : ''}${preset.name}`;
      this.paradigmPresetSelect.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = '✍️ Custom Input (New Word Paradigm)';
    this.paradigmPresetSelect.appendChild(customOpt);

    if (Array.from(this.paradigmPresetSelect.options).some(o => o.value === currentVal)) {
      this.paradigmPresetSelect.value = currentVal;
    } else {
      this.paradigmPresetSelect.value = 'vro_type_41_kand';
    }
  }

  handleDiscoverParadigm() {
    const rawText = this.paradigmInputText ? this.paradigmInputText.value : '';
    if (!rawText.trim()) {
      this.showToast('Please enter paradigm forms to discover', 'warning');
      return;
    }

    const lang = this.getSelectedParadigmLang();
    const isolateStem = this.paradigmIsolateStemToggle ? this.paradigmIsolateStemToggle.checked : true;
    const parsedForms = paradigmService.parseInputForms(rawText, { isolateStem });
    const analysis = paradigmService.alignParadigm(parsedForms, {
      renamedMorphophonemes: this.customMorphRenames,
      lang: lang
    });

    this.currentParadigmAnalysis = analysis;
    this.updateParadigmLangUI(lang);
    this.renderParadigmAnalysis(analysis);
    this.showToast(`Paradigm discovered & aligned for ${lang}!`, 'success');
  }

  handleRederiveParadigm() {
    if (!this.currentParadigmAnalysis) return;

    // Collect renames from input fields in morphRenamingBar
    const renameInputs = this.morphRenamingBar?.querySelectorAll('.morph-rename-input') || [];
    const renames = {};
    renameInputs.forEach(inp => {
      const colIdx = parseInt(inp.getAttribute('data-col'), 10);
      const val = inp.value.trim();
      if (val) {
        renames[colIdx] = val;
      }
    });

    this.customMorphRenames = renames;
    const rawText = this.paradigmInputText ? this.paradigmInputText.value : '';
    const lang = this.getSelectedParadigmLang();
    const isolateStem = this.paradigmIsolateStemToggle ? this.paradigmIsolateStemToggle.checked : true;
    const parsedForms = paradigmService.parseInputForms(rawText, { isolateStem });
    const analysis = paradigmService.alignParadigm(parsedForms, {
      renamedMorphophonemes: renames,
      lang: lang
    });

    this.currentParadigmAnalysis = analysis;
    this.updateParadigmLangUI(lang);
    this.renderParadigmAnalysis(analysis);
    this.showToast('Re-derived morphophonemes with custom names!', 'success');
  }

  renderParadigmAnalysis(analysis) {
    if (!analysis) return;

    // 1. Tab 1 outputs
    if (this.paradigmFormulaBadge) {
      this.paradigmFormulaBadge.textContent = `Formula: ${analysis.formula}`;
    }
    if (this.paradigmAlignedOutput) {
      this.paradigmAlignedOutput.textContent = analysis.rawExpansions.join('\n');
    }

    // 2. Tab 2: Morph renaming inputs & Matrix
    if (this.morphRenamingBar) {
      this.morphRenamingBar.replaceChildren();
      const alternatingCols = analysis.morphophonemes.filter(m => !m.isInvariant);

      if (alternatingCols.length === 0) {
        const noAltSpan = document.createElement('span');
        noAltSpan.style.fontSize = '12px';
        noAltSpan.style.color = 'var(--text-muted)';
        noAltSpan.textContent = 'All stem columns are invariant (no alternations).';
        this.morphRenamingBar.replaceChildren(noAltSpan);
      } else {
        alternatingCols.forEach(m => {
          const wrapper = document.createElement('div');
          wrapper.style.display = 'flex';
          wrapper.style.alignItems = 'center';
          wrapper.style.gap = '6px';

          const chip = document.createElement('span');
          chip.className = `morph-chip ${m.type === 'vowel_alternation' ? 'vowel' : 'gradation'}`;
          chip.textContent = `Col ${m.colIndex + 1}: ${m.symbol}`;

          const renameLabel = document.createElement('span');
          renameLabel.style.fontSize = '11px';
          renameLabel.style.color = 'var(--text-muted)';
          renameLabel.textContent = 'Rename to:';

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'morph-rename-input';
          input.setAttribute('data-col', String(m.colIndex));
          input.value = this.customMorphRenames[m.colIndex] || '';
          input.placeholder = 'e.g. D or O';
          input.style.width = '80px';
          input.style.padding = '4px 6px';
          input.style.fontSize = '12px';
          input.style.border = '1px solid var(--border)';
          input.style.borderRadius = '4px';

          wrapper.append(chip, renameLabel, input);
          this.morphRenamingBar.appendChild(wrapper);
        });
      }
    }

    if (this.paradigmMatrixContainer) {
      const table = document.createElement('table');
      table.className = 'paradigm-matrix-table';
      const thead = document.createElement('thead');
      const trHead = document.createElement('tr');

      const thGram = document.createElement('th');
      thGram.textContent = 'Grammatical Form';
      trHead.appendChild(thGram);

      analysis.morphophonemes.forEach((m, idx) => {
        const thCol = document.createElement('th');
        thCol.append(`Col ${idx + 1}`);
        thCol.appendChild(document.createElement('br'));
        const chip = document.createElement('span');
        chip.className = `morph-chip ${m.isInvariant ? 'invariant' : (m.type === 'vowel_alternation' ? 'vowel' : 'gradation')}`;
        chip.textContent = m.symbol;
        thCol.appendChild(chip);
        trHead.appendChild(thCol);
      });

      const thSuffix = document.createElement('th');
      thSuffix.textContent = 'Boundary / Suffix';
      trHead.appendChild(thSuffix);
      thead.appendChild(trHead);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      analysis.forms.forEach(f => {
        const tr = document.createElement('tr');
        const tdTag = document.createElement('td');
        tdTag.className = 'tag-cell';
        tdTag.textContent = f.tag || f.surface;
        tr.appendChild(tdTag);

        f.stemChars.forEach(ch => {
          const tdChar = document.createElement('td');
          tdChar.className = 'char-cell';
          tdChar.textContent = ch;
          tr.appendChild(tdChar);
        });

        const tdBound = document.createElement('td');
        tdBound.className = 'boundary-cell';
        tdBound.textContent = f.boundaryPart;
        tr.appendChild(tdBound);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      this.paradigmMatrixContainer.replaceChildren(table);
    }

    // 3. Tab 3: TWOL Rules, LexC, and LexD
    this.updateGrammarDisplay();

    // 4. Tab 4: Stem Regex & LexC Rule
    const regexInfo = paradigmService.deriveStemRegex(analysis);
    if (this.stemRegexPatternDisplay) {
      this.stemRegexPatternDisplay.textContent = regexInfo.pattern || '(none)';
    }
    if (this.stemRegexExplanationDisplay) {
      this.stemRegexExplanationDisplay.textContent = regexInfo.explanation || 'Matches stem types matching this paradigm.';
    }
    if (this.lexcRegexRuleDisplay) {
      this.lexcRegexRuleDisplay.textContent = regexInfo.lexcRegex || '(none)';
    }
    if (this.lexcRegexExplanationDisplay) {
      this.lexcRegexExplanationDisplay.textContent = regexInfo.lexcExplanation || 'Regular-expression description of the lemma and stem.';
    }
  }

  updateGrammarDisplay() {
    if (!this.currentParadigmAnalysis || !this.grammarCodeDisplay) return;

    const analysis = this.currentParadigmAnalysis;
    const lemma = analysis.forms[0]?.lemma || 'Stem';
    const lang = this.getSelectedParadigmLang();

    // Update active button states
    if (this.showTwolCodeBtn) this.showTwolCodeBtn.className = `btn btn-sm ${this.currentGrammarView === 'twol' ? 'btn-primary' : 'btn-secondary'}`;
    if (this.showLexcCodeBtn) this.showLexcCodeBtn.className = `btn btn-sm ${this.currentGrammarView === 'lexc' ? 'btn-primary' : 'btn-secondary'}`;
    if (this.showLexdCodeBtn) this.showLexdCodeBtn.className = `btn btn-sm ${this.currentGrammarView === 'lexd' ? 'btn-primary' : 'btn-secondary'}`;

    if (this.currentGrammarView === 'twol') {
      const twolRes = paradigmService.generateTwolRules(analysis, { lang });
      this.grammarCodeDisplay.textContent = twolRes.twolGrammar;
    } else if (this.currentGrammarView === 'lexc') {
      const lexc = paradigmService.generateLexc(analysis, `Noun_${lemma}`, { lang });
      this.grammarCodeDisplay.textContent = lexc;
    } else if (this.currentGrammarView === 'lexd') {
      const lexd = paradigmService.generateLexd(analysis, `Noun_${lemma}`, { lang });
      this.grammarCodeDisplay.textContent = lexd;
    }
  }

  handleDownloadGrammar() {
    if (!this.currentParadigmAnalysis) return;
    const analysis = this.currentParadigmAnalysis;
    const lemma = analysis.forms[0]?.lemma || 'paradigm';
    const lang = this.getSelectedParadigmLang();

    const content = this.grammarCodeDisplay ? this.grammarCodeDisplay.textContent : '';
    const ext = this.currentGrammarView === 'twol' ? 'twol' : (this.currentGrammarView === 'lexc' ? 'lexc' : 'lexd');
    const filename = `${lemma}_${lang}_${this.currentGrammarView}.${ext}`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`Downloaded ${filename}!`, 'success');
  }

  async handleClassifyNewWord() {
    const input = this.newWordTestInput ? this.newWordTestInput.value : '';
    if (!input.trim()) {
      this.showToast('Please enter a word to test', 'warning');
      return;
    }

    const lang = this.getSelectedParadigmLang();
    const isolateStem = this.paradigmIsolateStemToggle ? this.paradigmIsolateStemToggle.checked : true;

    // 1. Gather tokens for live morphological analyzer & guesser readings
    const rawTokens = input.split(/[\n\r,\t]+/).map(s => s.trim()).filter(Boolean);
    const analyzerData = {};
    if (analyzerService && typeof analyzerService.analyze_word === 'function') {
      try {
        await analyzerService.ensureModelForLanguage(lang);
      } catch (e) {
        // Model might not be loaded yet, analyze_word handles fallback gracefully
      }
      for (const tok of rawTokens) {
        const cleanWord = tok.includes(':') ? tok.split(':')[1].trim() : (tok.includes('+') ? tok.split('+')[0].trim() : tok.trim());
        if (cleanWord) {
          try {
            const readings = analyzerService.analyze_word(cleanWord, lang) || [];
            analyzerData[cleanWord] = readings;
            analyzerData[cleanWord.toLowerCase()] = readings;
          } catch (e) {
            console.warn('[handleClassifyNewWord] Analyzer error for', cleanWord, e);
          }
        }
      }
    }

    const classifierEngine = this.getSelectedClassifierEngine();
    this.updateClassifierEngineBadge(classifierEngine);

    const res = paradigmService.classifyNewWord(input, [], lang, { isolateStem, analyzerData, classifierEngine });
    if (!this.newWordPredictionContainer) return;

    this.newWordPredictionContainer.style.display = 'block';

    // Render Distinction Note Callout (Analyzer vs LangJack Models)
    if (this.distinctionNoteContainer && this.distinctionNoteText) {
      if (res.distinctionNote) {
        this.distinctionNoteContainer.style.display = 'block';
        this.distinctionNoteText.textContent = res.distinctionNote;
      } else {
        this.distinctionNoteContainer.style.display = 'none';
      }
    }

    if (res.matched) {
      if (this.predictionBanner) {
        this.predictionBanner.style.background = '#dcfce7';
        this.predictionBanner.style.color = '#15803d';
        this.predictionBanner.style.border = '1px solid #bbf7d0';

        const strongMatch = document.createElement('strong');
        strongMatch.textContent = 'Matched Paradigm:';
        const strongLemma = document.createElement('strong');
        strongLemma.textContent = 'Predicted Lemma:';
        const strongSlot = document.createElement('strong');
        strongSlot.textContent = 'Slot:';

        const bannerParts = [
          '✓ ', strongMatch, ` ${res.paradigmName} (${res.lang || lang}) • `,
          strongLemma, ` "${res.reconstructedLemma}" • `,
          strongSlot, ` ${res.matchedSlot}`
        ];

        if (res.narrowingMessage) {
          const divMsg = document.createElement('div');
          divMsg.style.marginTop = '6px';
          divMsg.style.fontSize = '12px';
          divMsg.style.fontWeight = '500';
          divMsg.style.color = '#166534';
          divMsg.textContent = res.narrowingMessage;
          bannerParts.push(divMsg);
        }

        this.predictionBanner.replaceChildren(...bannerParts);
      }

      // Render Step-by-Step Disambiguation Walkthrough
      if (this.disambiguationWalkthroughContainer && this.disambiguationStepsList) {
        if (res.disambiguationSteps && res.disambiguationSteps.length > 0) {
          this.disambiguationWalkthroughContainer.style.display = 'block';
          this.disambiguationStepsList.replaceChildren();

          if (this.gradationBadge) {
            this.gradationBadge.style.display = res.gradationDetected ? 'inline-block' : 'none';
            if (res.gradationDetected && res.gradationTraits && res.gradationTraits.length > 0) {
              this.gradationBadge.title = res.gradationTraits.join('; ');
            }
          }

          res.disambiguationSteps.forEach(stepText => {
            const stepDiv = document.createElement('div');
            stepDiv.textContent = stepText;
            this.disambiguationStepsList.appendChild(stepDiv);
          });
        } else {
          this.disambiguationWalkthroughContainer.style.display = 'none';
        }
      }

      // Render Transducer +Guess & Morphological Readings
      if (this.analyzerGuesserMatchesContainer && this.analyzerGuesserMatchesList) {
        const matchesWithInfo = (res.analyzerMatches || []).filter(m => m.totalReadings > 0);
        if (matchesWithInfo.length > 0) {
          this.analyzerGuesserMatchesContainer.style.display = 'block';
          this.analyzerGuesserMatchesList.replaceChildren();

          matchesWithInfo.forEach(m => {
            const itemDiv = document.createElement('div');
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'baseline';
            itemDiv.style.gap = '8px';
            itemDiv.style.flexWrap = 'wrap';

            const strongWord = document.createElement('strong');
            strongWord.textContent = m.form;
            itemDiv.appendChild(strongWord);

            if (m.hasGuess) {
              const guessBadge = document.createElement('span');
              guessBadge.style.background = '#ffedd5';
              guessBadge.style.color = '#c2410c';
              guessBadge.style.padding = '1px 6px';
              guessBadge.style.borderRadius = '3px';
              guessBadge.style.fontSize = '11px';
              guessBadge.style.fontFamily = 'var(--font-mono)';
              guessBadge.textContent = `+Guess: ${m.guessTags.join(', ')}`;
              itemDiv.appendChild(guessBadge);
            }

            if (m.lexicalTags && m.lexicalTags.length > 0) {
              const lexSpan = document.createElement('span');
              lexSpan.style.color = '#475569';
              lexSpan.style.fontSize = '11.5px';
              lexSpan.style.fontFamily = 'var(--font-mono)';
              lexSpan.textContent = `Lexical: ${m.lexicalTags.join(', ')}`;
              itemDiv.appendChild(lexSpan);
            }

            this.analyzerGuesserMatchesList.appendChild(itemDiv);
          });
        } else {
          this.analyzerGuesserMatchesContainer.style.display = 'none';
        }
      }

      const renderFormsTable = (forms) => {
        if (!this.predictedFormsTableBody) return;
        this.predictedFormsTableBody.replaceChildren();
        forms.forEach(item => {
          const tr = document.createElement('tr');

          const tdTag = document.createElement('td');
          tdTag.style.fontFamily = 'var(--font-mono)';
          tdTag.style.fontSize = '12px';
          tdTag.style.color = 'var(--text-muted)';
          tdTag.textContent = item.reconstructedTag || item.tag || '-';

          const tdSurface = document.createElement('td');
          tdSurface.className = 'pred-surface';
          tdSurface.textContent = item.predictedSurface;

          const tdAnalogy = document.createElement('td');
          tdAnalogy.style.color = 'var(--text-muted)';
          tdAnalogy.style.fontSize = '12px';
          tdAnalogy.textContent = `Analogy: ${item.originalModelSurface}`;

          tr.append(tdTag, tdSurface, tdAnalogy);
          this.predictedFormsTableBody.appendChild(tr);
        });
      };

      renderFormsTable(res.predictedForms);

      // Render Candidate Guesses if multiple guesses exist
      if (this.candidateGuessesContainer && this.candidateGuessesList) {
        if (res.guesses && res.guesses.length > 1) {
          this.candidateGuessesContainer.style.display = 'block';
          this.candidateGuessesList.replaceChildren();

          res.guesses.forEach((g, gIdx) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '6px 10px';
            row.style.borderRadius = '4px';
            row.style.fontSize = '12px';

            if (g.eliminated) {
              row.style.background = '#fef2f2';
              row.style.border = '1px solid #fecaca';
              row.style.opacity = '0.75';
            } else if (gIdx === 0) {
              row.style.background = '#eff6ff';
              row.style.border = '1px solid #bfdbfe';
            } else {
              row.style.background = '#ffffff';
              row.style.border = '1px solid var(--border)';
            }

            const left = document.createElement('div');
            const strongTitle = document.createElement('strong');
            strongTitle.textContent = `${g.paradigmName} (${g.paradigmType || g.continuationLexicon || 'Type'})`;

            const infoSpan = document.createElement('span');
            infoSpan.style.color = g.eliminated ? '#b91c1c' : 'var(--text-muted)';
            infoSpan.style.marginLeft = '6px';
            if (g.eliminated) {
              infoSpan.textContent = `[ELIMINATED] ${g.eliminationReason || 'Incompatible gradation or stem properties'}`;
            } else {
              infoSpan.textContent = `Lemma: "${g.reconstructedLemma}" (${g.matchedSlot || 'Match'}) • ${g.matchedCount}/${g.totalInputCount} forms matched`;
            }
            left.append(strongTitle, infoSpan);

            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary btn-sm';
            btn.style.fontSize = '11px';
            btn.style.padding = '2px 8px';
            if (g.eliminated) {
              btn.textContent = 'Eliminated';
              btn.disabled = true;
            } else {
              btn.textContent = gIdx === 0 ? 'Active' : 'Select';
              btn.disabled = gIdx === 0;
              btn.addEventListener('click', () => {
                renderFormsTable(g.predictedForms);
                Array.from(this.candidateGuessesList.children).forEach((c, idx) => {
                  if (res.guesses[idx]?.eliminated) return;
                  c.style.background = idx === gIdx ? '#eff6ff' : '#ffffff';
                  c.style.border = idx === gIdx ? '1px solid #bfdbfe' : '1px solid var(--border)';
                  const b = c.querySelector('button');
                  if (b) {
                    b.textContent = idx === gIdx ? 'Active' : 'Select';
                    b.disabled = idx === gIdx;
                  }
                });
              });
            }

            row.append(left, btn);
            this.candidateGuessesList.appendChild(row);
          });
        } else {
          this.candidateGuessesContainer.style.display = 'none';
        }
      }
    } else {
      if (this.predictionBanner) {
        this.predictionBanner.style.background = '#fee2e2';
        this.predictionBanner.style.color = '#991b1b';
        this.predictionBanner.style.border = '1px solid #fca5a5';

        const strongNoMatch = document.createElement('strong');
        strongNoMatch.textContent = 'No Paradigm Match:';
        this.predictionBanner.replaceChildren('❌ ', strongNoMatch, ` ${res.reason}`);
      }
      if (this.disambiguationWalkthroughContainer) {
        this.disambiguationWalkthroughContainer.style.display = 'none';
      }
      if (this.analyzerGuesserMatchesContainer) {
        this.analyzerGuesserMatchesContainer.style.display = 'none';
      }
      if (this.candidateGuessesContainer) {
        this.candidateGuessesContainer.style.display = 'none';
      }
      if (this.predictedFormsTableBody) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.style.textAlign = 'center';
        td.style.color = 'var(--text-muted)';
        td.style.padding = '12px';
        td.textContent = 'Could not predict inflections. Try entering more forms or select another model.';
        tr.appendChild(td);
        this.predictedFormsTableBody.replaceChildren(tr);
      }
    }
  }
}

// Initialize on DOMContentLoaded in browser environment
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new WorkbenchApp();
    app.init();
    if (typeof window !== 'undefined') {
      window.workbenchApp = app;
    }
  });

  // Register PWA Service Worker when running as a web app (Chrome on Android / PWA)
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof location !== 'undefined') {
    if (!location.protocol.startsWith('chrome-extension') && !location.protocol.startsWith('moz-extension')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
          console.warn('LangJack PWA Service Worker note:', err);
        });
      });
    }
  }
}
