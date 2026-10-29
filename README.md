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
     - Add custom gloss with required ISO language code and a required part of speech for both the source word (preselected from the reading) and the target gloss (always chosen by you): N, V, A, Adv, Pron, Po, … the Ve'rdd set. A gloss cannot be saved without both; they may differ.
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
       - **Suggest** (per sentence or for the whole file) proposes values for the columns you tick under **Columns to enhance** (default: MISC only; ID and FORM are locked). Sources: LEMMA, UPOS, XPOS and FEATS from the analyzer reading; FEATS also from the grammatical morphemes of the existing gloss (for example `3SG.M.O` becomes `Person[obj]=3|Number[obj]=Sing|Gender[obj]=Masc`; the mapping table is shown in the panel); MISC from the dictionary, written with the file's own gloss key (`gloss[pt]=` or `gloss_pt=`; the more frequent one wins); HEAD/DEPREL baseline guesses only for sentences without any dependencies. DEPS has no source.
       - Each proposal shows the old and the new value. Empty cells (`_`) are filled when you apply; a cell that already has a value is only changed if you tick it yourself and confirm (per token, per column with "all/none", per sentence, or file-wide). FEATS proposals only add features; existing values are kept. Rejecting a proposal writes nothing.
       - **Reading dropdown (in the XPOS cell)**: when an analyzer-based column (LEMMA, UPOS, XPOS or FEATS) is selected, the XPOS cell of each token offers a dropdown of the analyzer's readings of the *form*, shown by their tag strings exactly as the analyzer emitted them (for example `N+Msc+Sg+PxSg3M+Possd+Nom · awinhitxi · NOUN · Case=Nom|…`). Plain readings (no `Der`, no `Cmp`) come first and are the default; derived and compound readings stay available in a second, labelled group. When several plain readings remain, the default is the features they share and the token is flagged **needs your choice**. Picking a reading makes that one reading supply LEMMA, UPOS, XPOS and FEATS together (not intersected); the pre-selection is only a default and an explicit choice always wins and is kept. **XPOS gets** the short POS tag (`N`, default) or the full analyzer tag string (as emitted); a non-empty XPOS is never replaced without your confirmation, with the original shown. GiellaLT variant tags (`v1` … `v25`) rank readings inside each group (v1 first; a reading without a v-tag counts as v1; the analyzer's order breaks ties) and are shown as `[v2]` in the dropdown, but no variant is ever filtered out, and readings that differ only in the variant do not make a token ambiguous (the v1 one is the default). Optionally (off by default; checkbox "also propose `GTtags=` in MISC" above the columns) the analyzer's tag readout is proposed in MISC as `GTtags=` in the convention of the Apurinã file: the entire readout, every tag after the lemma stem including the POS tag, comma-separated, in the analyzer's order, variant tag included (`GTtags=N,Msc,Sg,PxSg3M,Possd,Nom`, `GTtags=Pron,Pers,Sg3,Msc,Nom`). It is only proposed for a token based on one reading (a chosen one, or a clear default), and an existing different `GTtags` is never replaced without confirmation, with old and new shown; rows you do not apply stay as they are. Derivation and compounding are detected as tags wherever they stand. Tag order carries meaning (for example `Adp` straight after the lemma is the adposition POS tag, but `ywa+Pron+Pers+Adp` is a pronoun with Case=Adp), so analyses that differ in tag order are different readings and are all listed; only exact duplicates merge. The analyzer's name and origin (packaged file or saved model) are shown above the columns. Choices are stored with the working copy, survive reloads, show in the changes list, can be reset, and are dropped when you revert the sentence. Whole-file runs keep the default rule, mark these tokens with **?** in the sentence list, leave them out of the bulk fill, and **Next token needing review ▶** jumps between them.
       - **Editing by hand**: the **✎** button on a token row opens an editor for that token: FEATS as removable chips (existing, proposed and added pairs) with an "add feature" control (pick a Feature from the language's inventory, then one of its known values, or type `Feature=Value`), fields for LEMMA, UPOS (with the inventory's values as suggestions), XPOS, HEAD, DEPREL and DEPS, and MISC as chips with key/value add. ID and FORM stay locked. FEATS are kept sorted the UD way and layered keys like `Person[psor]` are kept. A pair or UPOS/DEPREL value that is in no inventory layer is marked **new** and needs a confirmation, changing an existing feature value or removing something the original file has needs a confirmation too. Hand edits use the same overrides as applied proposals, so they show in the changes list and revert per cell, per token or per sentence; the original and every other row stay byte-identical.
       - **The form is primary, the lemma is a hypothesis**: analyzer readings are looked up by the form. The file's lemma only narrows the *default* proposal (stated in the picker) and never hides a reading: every reading is listed with its lemma, marked "= current lemma" or "≠ current lemma" and "in default" or not. Every applied value and manual edit remembers where it came from (analyzer reading and which one, gloss, dictionary, by hand), shown in the editor and stored with the working copy, so a token can be reopened later in the same or another session to pick another reading, change or remove a pair, or revert that cell or token. A lemma can be marked **uncertain** or **undecided** and alternatives you considered (for example `awinhitxi` next to `awinhi`) can be kept, without changing the LEMMA cell. These notes are not written to the exported file unless you turn on "also record uncertain lemmas in MISC" (`LemmaStatus=…`, `AltLemma=…`; off by default). The sentence list marks tokens needing review with **?** (filter "needing review only"; "Next token needing review ▶" jumps between them).
       - **Feature inventory**: proposed FEATS pairs (and UPOS / DEPREL labels) are checked against the language, in this order: used in the imported file, in the language's own UD treebanks, universal UD features, other Uralic languages, other languages. A pair found in none is marked **new** and is only applied after you confirm it. The language follows the *Language of the text* box and can be changed under **Feature inventory** (or "None: only what this file uses"); a file opened with language `apu` defaults to the Apurinã layer. Non-UD MISC keys of a treebank (`gloss[pt]`, `CGdeprel`, `GTtags`, …) are listed as "seen" but are not part of the UD-valid layer. FEATS are kept sorted the UD way (case-insensitive, `Number` before `NumType`, `Gender` before `Gender[obj]`). You can also load a local `docfeats.json` from the UD tools to add the documented features.
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
     - Interactive entry editor (Lemma, POS, Target Lang ISO, Gloss). Both parts of speech (source word and target gloss) are required for new entries; entries lacking either (for example imported ones) are flagged and can be completed in the POS and Gloss POS columns. TSV export adds a `target_pos` column (7th), which TSV import reads again (JSON uses `tgt_pos`). In the Ve'rdd Send tab the gloss POS becomes the translation POS.
     - Import custom dictionaries from **TSV**, **CSV**, **JSON**, or **Lexc** (`src_lemma:tgt_gloss #;`).
     - Export custom dictionary as TSV.
   - **Hyphens touching a word**: in the Input Text a hyphen touching the end or the start of a word (`tuõttvuõtt- da -komissio`, `Maa- ja metsätalous`) stays part of that wordform, in the tokens and so in the CoNLL-U FORM column. A spaced hyphen, a dash or a minus before digits is still punctuation. An analysis whose first compound member has no stem (`+Cmp/SplitL#komissio+N+Pl+Nom`) gives the lemma `komissio` and keeps `Cmp/SplitL` among the tags.
   - **Finite verbs**: a token with UPOS `VERB` and a subject person/number ending in its tags (`Sg1`, `Pl3`, `Du2`, `ScSg1` ...) gets `VerbForm=Fin`, in the CoNLL-U export and in import/enhance (also from a gloss such as `ver-1SG`). Object (`Oc…`) and possessive (`Px…`) endings do not count, and a VerbForm the analysis already gives (e.g. `Vnoun`) is kept.
   - **Blanks inside a multiword gloss** are kept as plain spaces and written per target: a space for Ve'rdd, a hyphen for CoNLL-U (`Gloss[en]=old-woman`; an imported file that uses dots keeps its dots), and `<b/>` for Apertium (*📤 Export Apertium .dix* exports the custom lexicon as a bilingual dictionary). See `js/services/gloss-format.js`.
   - **Your own private dictionaries**: under **Models & Dictionaries**, *2. Dictionary Transducer* has **📁 Upload .hfstol Dictionary** for a UralicNLP-style dictionary FST (the format of `uralicnlpmodels/nightly`), and *3. Custom User Lexicon* has **📥 Import TSV / CSV / JSON / Lexc** for the TSV format described below. Both stay only in your browser (IndexedDB), are never sent anywhere and are not part of the repository. An uploaded FST is used first in lookups, is loaded again in every later session, is listed under the upload button (uploading the same file name replaces it) and can be removed there; TSV entries appear in the lexicon table, where they can be edited and deleted.
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

## Feature inventory data (`data/ud-feature-inventory.json`)

A compact list of which Feature=Value pairs, UPOS tags and DEPREL labels each language uses in a set of [Universal Dependencies](https://universaldependencies.org) treebanks (Uralic languages: Erzya, Moksha, Komi, Skolt Sami, North Sami, Finnish, Estonian, Veps, Nenets, Karelian, Livvi, Old Permic; plus Apurinã, Cebuano, Munduruku, Makurap, Paumari and Tagabawa), with counts. It contains names and counts only (MISC by key name, never value): no sentences, words, lemmas or glosses. It is derived from the UD treebanks; each source treebank keeps its own license (listed in `meta.sources` of the file, together with where the license was read from). The script prefers a treebank's `LICENSE.txt` over its README header when they disagree, and warns about the mismatch. Most sources are CC BY-SA 4.0 (Finnish-FTB is CC BY 4.0). Treebanks with a non-commercial license are not used: the build script skips them by default (`--exclude-licenses` defaults to `-NC-`), so none is part of the inventory (`meta.nonCommercial` is empty). `UD_Estonian-EWT` is CC BY-SA 4.0 according to its `LICENSE.txt`.

Rebuild it from local UD checkouts with:

```bash
node scripts/build-feature-inventory.mjs --root ~/Desktop/Github/ud
```

The script reads only the top-level `.conllu` files of each treebank folder (never `not-to-release` subfolders). If a folder has none in the working tree, it falls back, read-only (`git ls-tree` / `git show`, nothing is checked out), to `origin/dev`, then `origin/master`; this is how Tagabawa (`bgs`, data only on the dev branch) is read. A folder with no data anywhere is skipped with a warning.

Feature checks use layers: the file itself, the language, universal UD, then pairs used by other languages. The "shared (Uralic)" layer applies to Uralic languages only; for any other language (Apurinã, Cebuano, …) pairs used by three or more other languages count as "widespread", and pairs used by one or two as "other". None of these needs confirmation; only a pair found in no layer does.

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
node test/test_conllu_enhance.js
node test/test_feature_inventory.js
node test/test_reading_picker.js
node test/test_manual_editing.js
node test/test_reading_order.js
node test/test_custom_gloss_pos.js
node test/test_private_dictionaries.js
node test/test_gloss_hyphens.js
node test/test_verbform_fin.js
node test/test_hyphen_wordform.js
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
