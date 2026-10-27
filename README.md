# LangJack - Morphological Analyzer & Interlinear Glosser (Chrome Web Extension)

**LangJack** is a Chrome Web Extension (Manifest V3) for linguistic morphological analysis and interlinear glossing using [**hfst-js**](https://www.npmjs.com/package/hfst-js) and Uralic dictionaries ([**uralicNLP dictionary-fst**](https://github.com/mikahama/uralicNLP/tree/master/dictionary-fst)).

---

## Try it online

LangJack also runs in any modern browser, with nothing to install: **<https://multilingualfacilitation.com/LangJack/>**

The large morphological models are not stored in this repository. On first use LangJack downloads the model for the selected language from [UralicNLP](https://github.com/Rootroo-ltd/uralicnlpmodels) and keeps it in your browser (IndexedDB), so later visits, including offline ones, start from the saved copy. Two small starter models in `models/` serve as a fallback.

---

## Features

1. **Text Input & Tokenization**
   - Type or paste arbitrary text into the input field or grab selected text directly from any web page using the context menu or popup.
   - Built-in sample sentences for quick testing in Erzya (`myv`), Finnish (`fin`), and Skolt Sami (`sms`).

2. **Morphological Analysis via `hfst-js`**
   - Pure JavaScript / WebAssembly-free HFST optimized-lookup transducer engine running locally in the browser.
   - For each word/token, provides all candidate morphological analyses in parallel (clean display, weights removed).
   - Dynamic language selection (`myv`, `fin`, `sms`, `kpv`, `koi`, `mdf`, `mhr`, `mrj`, `olo`, `fkv`, `sme`, `smn`, `udm`).
   - Supports Komi-Permyak (`koi`) and distinguishes between Meadow Mari (`mhr`) and Hill Mari (`mrj`) literary standards (umbrella code `chm` excluded).
   - **Select Desired Reading or Add Own**:
     - Choose from candidate readings in a dropdown.
     - Add/edit custom readings, lemmas, and tags.
     - Automatic decomposition into Lemma, Part of Speech, Universal Dependencies UPOS, and UD FEATS.
     - **Direct Morphologically Derived UPOS (`NOUN < +N`)**: Universal Dependencies UPOS is directly derived from the morphological analysis output (`NOUN < +N`, `VERB < +V`, `PROPN < +Prop`, `ADJ < +A`, `ADV < +Adv`, `AUX < +Aux`, `ADP < +Po/+Pr`, etc.) with reciprocal tag synchronization.
     - **Interactive UPOS Dropdown**: Choose from all 17 Universal Dependencies UPOS tags (`NOUN`, `PROPN`, `VERB`, `ADJ`, `ADV`, `PRON`, `NUM`, `ADP`, `AUX`, `CCONJ`, `SCONJ`, `DET`, `PART`, `INTJ`, `SYM`, `PUNCT`, `X`), automatically re-deriving morphological tags.
     - **Renew Reading for CoNLL-U**: When editing an unrecognized or OOV word, click **🔄 Renew Reading for CoNLL-U** on the token card (or **Renew CoNLL-U Readings** in export actions) to immediately update CoNLL-U column 3 (LEMMA) and column 4 (UPOS) and query dictionary glosses.
     - **Renew UralicNLP Analyzers Button**: A discreet button in the top corner (`🔄 Renew UralicNLP`) connects directly to UralicNLP nightly models (via resilient multi-mirror HTTPS endpoints: GitHub raw repository, jsDelivr CDN, and `models.uralicnlp.com`) to fetch and activate the latest nightly morphological analyzer for the selected language.

3. **Dictionary & Glossing (UralicNLP `dictionary-fst`)**
   - Integrated with the UralicNLP dictionary transducer schema (`<src_lang>_<lemma>` → `<tgt_lang>_<gloss>`).
   - Supplies glosses across multiple languages with target language filtering (`all`, `eng`, `fin`, `rus`, `deu`, `swe`, `est`, `fra`, `spa`, etc.).
   - Multi-language gloss pills display which translations are available across different target languages.
   - **Select Gloss or Add Own**:
     - Click candidate gloss chips or select from dropdown.
     - Add custom gloss with required ISO language code.
     - Option to auto-save custom glosses to your persistent custom dictionary.

4. **Multiple Sentence Translations (ISO language tagged)**
   - Enter one or more full sentence/text translations with specific ISO language codes.

5. **Screen Presentation & Annotation Dashboard**
   - Real-time progress bar: total tokens, fully annotated tokens, pending glosses, completion percentage.
   - Unrecognized word highlights and badges.
   - Quick actions: "Auto-select Best", "Jump to Next Incomplete".
   - Token cards with color-coded status badges (Complete, Pending, Unrecognized, Punctuation).

6. **Multiple Export Formats**:
   - **Universal Dependencies (CoNLL-U)**:
     - 10-column tab-separated UD format (`ID`, `FORM`, `LEMMA`, `UPOS`, `XPOS`, `FEATS`, `HEAD`, `DEPREL`, `DEPS`, `MISC`).
     - Includes `# sent_id`, `# text`, and translations (`# text_eng = ...`, `# text_fin = ...`).
     - **Import / Enhance CoNLL-U…**: load an existing treebank (for example a UD `.conllu` file), add glosses from the dictionary, and export it again without losing anything.
       - The file is stored in your browser as an unchanged original (file name, import time, SHA-256); your edits are kept separately as small per-sentence changes. Sentences you did not edit are exported byte-for-byte as they were, including comments, string `sent_id`s, multiword ranges and every MISC key.
       - **Suggest glosses** (per sentence or for the whole file) looks up each lemma in the dictionary and writes into MISC using the file's own convention (`gloss[pt]=` or `gloss_pt=`; the more frequent one wins). Existing glosses are never overwritten without confirmation; morpheme-segmented glosses such as `ver-3SG.M.O` that already contain the dictionary gloss are left alone.
       - Review the changes against the original per sentence, revert a sentence or everything, and **Download working copy** under a new default name (`<name>.enhanced.conllu`). Malformed rows are reported with their line numbers and kept as they are.
   - **Linguistic Interlinear Format (MS Word / LibreOffice)**:
     - Separate lines:
       - **a.** Original text
       - **b.** Individual word forms
       - **c.** Selected morphology
       - **d.** Selected gloss
       - **e.** Selected translation(s)
     - **Copy Plain Text** (tab-aligned).
     - **Copy Formatted Word/LibreOffice Table**: Copies HTML table to clipboard that pastes directly into MS Word and LibreOffice Writer without column misalignment!
   - **Ve'rdd Development Output**:
     - Designed for Ve'rdd dictionary development:
       - Each selected word/lemma and its gloss accompanied by example sentences, with language ISO codes and parts of speech.
       - Formats: Lexicographical Block, Ve'rdd XML (`<verdd:lexicon>`), and Tabular TSV.

7. **Custom Dictionaries & Transducer Management**:
   - **Add Own Dictionaries**:
     - Interactive entry editor (Lemma, POS, Target Lang ISO, Gloss).
     - Import custom dictionaries from **TSV**, **CSV**, **JSON**, or **Lexc** (`src_lemma:tgt_gloss #;`).
     - Export custom dictionary as TSV.
   - **Transducer Models**:
     - Comes bundled with starter transducers (`bundled_analyser.hfstol` and `bundled_dict.hfstol`).
     - One-click download with automatic multi-mirror failover (`raw.githubusercontent.com`, jsDelivr CDN, and `models.uralicnlp.com`) for full nightly models (`myv`, `fin`, `sms`, `kpv`, `koi`, `mdf`, `mhr`, `mrj`, `fkv`, `olo`, etc.) and the full multi-language dictionary transducer.
     - Drag-and-drop / upload any custom `.hfstol` file.
     - All downloaded models and user lexicons are persisted in browser **IndexedDB**.

---

## Supported Platforms & Browsers

LangJack is built from a single unified codebase supporting three distribution targets:

1. **Google Chrome (Desktop)**
   - Manifest V3 WebExtension with background service worker, activeTab scripting, floating dictionary cards on any web page, and full workbench.
   - Installable via Chrome Web Store or Developer Mode.

2. **Mozilla Firefox (Desktop & Firefox for Android)**
   - WebExtension Manifest V3 fully compliant with Mozilla AMO standards (0 errors, 0 warnings).
   - Supports Firefox for Android (Fenix) via `browser_specific_settings.gecko_android`.

3. **Google Chrome on Android (Progressive Web App & Standalone Mobile)**
   - Standard Google Chrome for Android does not support desktop Web Store extension downloads. Instead, LangJack runs as a full **Progressive Web App (PWA)** on Chrome for Android!
   - **Offline Capability**: Uses service worker caching (`sw.js`) and IndexedDB for 100% offline operation anywhere in the field.
   - **Install to Android Home Screen**: Open LangJack in Chrome on Android, tap the three-dot menu `⋮`, and select **"Install app"** or **"Add to Home screen"**. It installs as a standalone, full-screen native Android app with custom high-res icons (`icon192.png`, `icon512.png`).
   - **Touch & Mobile Optimized**: Responsive mobile layouts, swipeable token cards, touch-friendly tap targets, and touch selection handling.

4. **Chromium on Android (Kiwi Browser, Lemur Browser, Yandex Browser)**
   - Android Chromium browsers that support extensions can install `dist/langjack-v1.0.0-chrome.zip` directly to enable in-page touch text selection and dictionary lookup across all web pages.

---

## Building Production Packages

To build production-ready packages for all targets from the unified codebase:

```bash
# Build all targets (Chrome Web Store, Firefox Add-on, and Android PWA)
./package_extension.sh --all

# Or build a specific target:
./package_extension.sh --chrome     # Google Chrome Web Store (.zip)
./package_extension.sh --firefox    # Mozilla Firefox Add-on (.xpi & .zip)
./package_extension.sh --android    # Chrome on Android PWA (.zip)
```

Generated packages will be in the `dist/` directory:
- `dist/langjack-v1.0.0-chrome.zip` (Chrome Desktop & Chromium Android)
- `dist/langjack-v1.0.0-firefox.xpi` (Firefox Desktop & Firefox for Android)
- `dist/langjack-v1.0.0-android-pwa.zip` (Chrome on Android PWA)

---

## Installation in Google Chrome (Desktop)

1. Open Google Chrome.
2. In the address bar, navigate to:
   ```
   chrome://extensions/
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the folder of this project (your clone of this repository):
   ```bash
   git clone https://github.com/rueter/LangJack.git
   ```
6. The extension **LangJack** is now installed!
   - Click the extension icon in Chrome's toolbar to open the popup.
   - Click **🚀 Open Full Workbench** (or open `index.html` from the project folder in Chrome) to start annotating and glossing!

---

## Dictionaries in TSV format

Besides the UralicNLP dictionary transducers, LangJack reads plain tab-separated dictionaries. `models/dict-apu-por.tsv` is a **small sample** (Apurinã with Portuguese and English glosses) that shows the format; it is not a full lexicon. `models/dict-koi.tsv` is derived from UralicNLP / Giellatekno data.

```
lemma	gloss	target_lang	pos	source_lang	notes
aiku	casa	por	N	apu	Apurinã noun
aiku	house	eng	N	apu	Apurinã noun
```

Lines starting with `#` are comments. Your own TSV, CSV, JSON or Lexc dictionaries can be imported under **Models & Dictionaries**, and are kept in your browser.

---

## Testing

Run all automated test suites via Node.js:

```bash
node test/test_pipeline.js
node test/test_arbitrary_text.js
node test/test_language_selection.js
node test/test_renew_reading_upos.js
node test/test_uralicnlp_renew_and_derived_upos.js
node test/test_verdd_api_service.js
node test/test_conllu_import.js
```

Some suites load analyzers from `models/`. Those files are not in the repository (see *Try it online*): download them first through the app, or copy them into `models/`.

Verifies:
- Tag mapping from HFST to Universal Dependencies (`UPOS` and `FEATS`).
- Direct derivation of UPOS from morphological analysis output (`NOUN < +N`, `VERB < +V`, `PROPN < +Prop`, etc.).
- `hfst-js` binary lookups on `.hfstol` transducers.
- Real-time analysis of arbitrary typed text with `analyze_word`.
- UPOS tag availability (all 17 Universal Dependencies tags) and reading renewal for CoNLL-U.
- UralicNLP nightly model renewal endpoint URLs and transducer updates.
- Language configuration: exclusion of `chm`, inclusion of Komi-Permyak (`koi`), Meadow Mari (`mhr`), and Hill Mari (`mrj`).
- Multi-language dictionary glossing and ISO language code filtering.
- CoNLL-U, 5-line Linguistic Leipzig, and Ve'rdd multi-format exports.

---

## License

Apache License 2.0, see [LICENSE](LICENSE). Models and dictionaries downloaded from UralicNLP / Giellatekno keep their own licenses.

---

## CITE

Jack Rueter & Olga Erina, LangJack
