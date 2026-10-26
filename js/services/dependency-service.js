/**
 * Dependency Service: Manages Universal Dependencies (UD) relation schemas,
 * language-specific custom dependency extensions beyond the UD standard,
 * tree validation (cycle detection, root verification), and dependency inference.
 */

import { storageService } from './storage-service.js';
import { normalizeLangCode } from './analyzer-service.js';

export const UNIVERSAL_UD_RELATIONS = [
  // Core arguments
  { label: 'nsubj', category: 'core', desc: 'Nominal subject' },
  { label: 'obj', category: 'core', desc: 'Direct object' },
  { label: 'iobj', category: 'core', desc: 'Indirect object' },
  { label: 'csubj', category: 'core', desc: 'Clausal subject' },
  { label: 'ccomp', category: 'core', desc: 'Clausal complement' },
  { label: 'xcomp', category: 'core', desc: 'Open clausal complement' },

  // Non-core dependents
  { label: 'obl', category: 'non-core', desc: 'Oblique nominal argument/adjunct' },
  { label: 'vocative', category: 'non-core', desc: 'Vocative' },
  { label: 'expl', category: 'non-core', desc: 'Expletive' },
  { label: 'dislocated', category: 'non-core', desc: 'Dislocated element' },
  { label: 'advcl', category: 'non-core', desc: 'Adverbial clause modifier' },
  { label: 'advmod', category: 'non-core', desc: 'Adverbial modifier' },
  { label: 'discourse', category: 'non-core', desc: 'Discourse element' },

  // Nominal dependents
  { label: 'nmod', category: 'nominal', desc: 'Nominal modifier' },
  { label: 'appos', category: 'nominal', desc: 'Appositional modifier' },
  { label: 'nummod', category: 'nominal', desc: 'Numeric modifier' },
  { label: 'amod', category: 'nominal', desc: 'Adjectival modifier' },
  { label: 'det', category: 'nominal', desc: 'Determiner' },
  { label: 'clf', category: 'nominal', desc: 'Classifier' },
  { label: 'case', category: 'nominal', desc: 'Case-marking adposition or particle' },

  // Coordination & MWE
  { label: 'conj', category: 'coord', desc: 'Conjunct' },
  { label: 'cc', category: 'coord', desc: 'Coordinating conjunction' },
  { label: 'fixed', category: 'mwe', desc: 'Fixed multiword expression' },
  { label: 'flat', category: 'mwe', desc: 'Flat multiword expression' },
  { label: 'compound', category: 'mwe', desc: 'Compound' },

  // Loose & Structural
  { label: 'list', category: 'loose', desc: 'List element' },
  { label: 'parataxis', category: 'loose', desc: 'Parataxis' },
  { label: 'root', category: 'structural', desc: 'Root of the sentence' },
  { label: 'cop', category: 'structural', desc: 'Copula' },
  { label: 'mark', category: 'structural', desc: 'Marker (subordinating conjunction)' },
  { label: 'aux', category: 'structural', desc: 'Auxiliary verb' },
  { label: 'punct', category: 'structural', desc: 'Punctuation' },

  // Other
  { label: 'dep', category: 'other', desc: 'Unspecified dependency' },
  { label: 'orphan', category: 'other', desc: 'Elliptical orphan' },
  { label: 'goeswith', category: 'other', desc: 'Goes with (split word)' },
  { label: 'reparandum', category: 'other', desc: 'Speech repair' }
];

export const STANDARD_UD_SUBTYPES = [
  { label: 'nsubj:cop', category: 'subtype', desc: 'Nominal subject of copular sentence' },
  { label: 'nsubj:pass', category: 'subtype', desc: 'Passive nominal subject' },
  { label: 'csubj:pass', category: 'subtype', desc: 'Passive clausal subject' },
  { label: 'aux:pass', category: 'subtype', desc: 'Passive auxiliary' },
  { label: 'obl:agent', category: 'subtype', desc: 'Agent in passive construction' },
  { label: 'obl:lmod', category: 'subtype', desc: 'Locative oblique' },
  { label: 'obl:tmod', category: 'subtype', desc: 'Temporal oblique' },
  { label: 'obl:priv', category: 'subtype', desc: 'Privative / abessive oblique' },
  { label: 'advmod:lmod', category: 'subtype', desc: 'Locative adverbial modifier' },
  { label: 'advmod:tmod', category: 'subtype', desc: 'Temporal adverbial modifier' },
  { label: 'advmod:deg', category: 'subtype', desc: 'Degree adverbial modifier' },
  { label: 'acl:relcl', category: 'subtype', desc: 'Relative clause modifier' },
  { label: 'compound:prt', category: 'subtype', desc: 'Phrasal verb particle' },
  { label: 'compound:svc', category: 'subtype', desc: 'Serial verb construction' },
  { label: 'flat:name', category: 'subtype', desc: 'Proper name flat structure' },
  { label: 'flat:foreign', category: 'subtype', desc: 'Foreign expression flat structure' },
  { label: 'nmod:poss', category: 'subtype', desc: 'Possessive nominal modifier' },
  { label: 'nmod:gsubj', category: 'subtype', desc: 'Nominal subject of action noun' },
  { label: 'nmod:gobj', category: 'subtype', desc: 'Nominal object of action noun' }
];

export class DependencyService {
  constructor() {
    this.memoryCache = new Map();
  }

  /**
   * Returns default combined UD relations + standard subtypes.
   * @returns {Array<Object>}
   */
  getDefaultRelations() {
    return [
      ...UNIVERSAL_UD_RELATIONS,
      ...STANDARD_UD_SUBTYPES
    ];
  }

  /**
   * Retrieves all available dependency relations for a specific language.
   * Includes standard UD relations and any language-specific custom relations saved by the user.
   * @param {string} lang
   * @returns {Promise<Array<{ label: string, category: string, desc: string, isCustom?: boolean }>>}
   */
  async getRelationsForLanguage(lang = 'myv') {
    const cleanLang = normalizeLangCode(lang || 'myv');
    const storageKey = `deprels_${cleanLang}`;

    if (this.memoryCache.has(cleanLang)) {
      return this.memoryCache.get(cleanLang);
    }

    let customList = [];
    try {
      customList = await storageService.getSetting(storageKey, null);
    } catch (_) {}

    let relations = [];
    if (Array.isArray(customList) && customList.length > 0) {
      relations = customList;
    } else {
      relations = this.getDefaultRelations();
    }

    this.memoryCache.set(cleanLang, relations);
    return relations;
  }

  /**
   * Adds or updates a custom dependency relation for a specific language.
   * Modifies relations beyond the UD standard as requested.
   * @param {string} lang
   * @param {string} relationLabel
   * @param {string} description
   * @param {string} category
   * @returns {Promise<Array<Object>>}
   */
  async addCustomRelation(lang, relationLabel, description = '', category = 'language-specific') {
    const cleanLang = normalizeLangCode(lang || 'myv');
    const cleanLabel = (relationLabel || '').trim().toLowerCase();
    if (!cleanLabel) throw new Error('Relation label cannot be empty.');
    if (!/^[a-z]+(:[a-z0-9_-]+)*$/i.test(cleanLabel)) {
      throw new Error(`Invalid dependency relation label "${cleanLabel}". Must be lowercase alphanumeric (e.g. "compound:svc" or "obl:agent").`);
    }

    const currentRelations = await this.getRelationsForLanguage(cleanLang);
    const existingIdx = currentRelations.findIndex(r => r.label === cleanLabel);

    const newRelationObj = {
      label: cleanLabel,
      category: category || 'language-specific',
      desc: description || `Custom ${cleanLang.toUpperCase()} relation`,
      isCustom: true
    };

    let updatedList = [];
    if (existingIdx !== -1) {
      updatedList = [...currentRelations];
      updatedList[existingIdx] = newRelationObj;
    } else {
      updatedList = [...currentRelations, newRelationObj];
    }

    const storageKey = `deprels_${cleanLang}`;
    await storageService.setSetting(storageKey, updatedList);
    this.memoryCache.set(cleanLang, updatedList);
    return updatedList;
  }

  /**
   * Removes a custom relation from a language's schema.
   * @param {string} lang
   * @param {string} relationLabel
   * @returns {Promise<Array<Object>>}
   */
  async removeCustomRelation(lang, relationLabel) {
    const cleanLang = normalizeLangCode(lang || 'myv');
    const cleanLabel = (relationLabel || '').trim().toLowerCase();
    const currentRelations = await this.getRelationsForLanguage(cleanLang);

    const filtered = currentRelations.filter(r => r.label !== cleanLabel);
    const storageKey = `deprels_${cleanLang}`;
    await storageService.setSetting(storageKey, filtered);
    this.memoryCache.set(cleanLang, filtered);
    return filtered;
  }

  /**
   * Resets relations for a language back to standard UD defaults.
   * @param {string} lang
   * @returns {Promise<Array<Object>>}
   */
  async resetRelationsForLanguage(lang) {
    const cleanLang = normalizeLangCode(lang || 'myv');
    const storageKey = `deprels_${cleanLang}`;
    await storageService.setSetting(storageKey, null);
    const defaults = this.getDefaultRelations();
    this.memoryCache.set(cleanLang, defaults);
    return defaults;
  }

  /**
   * Validates dependency structure for a sentence's tokens.
   * Detects cycles, invalid heads, missing or multiple roots.
   * @param {Array<Object>} tokens
   * @returns {{ isValid: boolean, rootCount: number, errors: Array<string>, warnings: Array<string> }}
   */
  validateDependencies(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return { isValid: true, rootCount: 0, errors: [], warnings: [] };
    }

    const errors = [];
    const warnings = [];
    const n = tokens.length;
    let rootCount = 0;

    const tokenMap = new Map();
    tokens.forEach((t, idx) => {
      const id = t.id || (idx + 1);
      tokenMap.set(id, t);
    });

    // 1. Check HEAD ranges and self-references
    tokens.forEach((t, idx) => {
      const id = t.id || (idx + 1);
      const head = t.head;

      if (head === undefined || head === null || head === '' || head === '_') {
        warnings.push(`Token #${id} ("${t.form}") has no HEAD specified.`);
        return;
      }

      const numHead = Number(head);
      if (Number.isNaN(numHead) || numHead < 0 || numHead > n) {
        errors.push(`Token #${id} ("${t.form}") has invalid HEAD "${head}" (must be 0 to ${n}).`);
        return;
      }

      if (numHead === 0) {
        rootCount++;
        if (t.deprel && t.deprel !== 'root') {
          warnings.push(`Token #${id} ("${t.form}") is marked as ROOT (HEAD=0) but DEPREL is "${t.deprel}" instead of "root".`);
        }
      } else {
        if (numHead === id) {
          errors.push(`Token #${id} ("${t.form}") cannot have itself as HEAD (self-loop detected).`);
        }
      }
    });

    if (rootCount === 0) {
      warnings.push('Sentence has no ROOT token (HEAD=0). Exactly one root is expected in UD.');
    } else if (rootCount > 1) {
      warnings.push(`Sentence has ${rootCount} ROOT tokens. In standard UD, a sentence should have exactly 1 root.`);
    }

    // 2. Cycle detection via path traversal / graph DFS
    const visited = new Set();
    for (const [id, tok] of tokenMap.entries()) {
      if (tok.head === 0 || !tok.head || tok.head === '_') continue;

      const path = [];
      let currId = id;
      const seenInPath = new Set();

      while (currId && currId !== 0 && currId !== '_') {
        if (seenInPath.has(currId)) {
          // Cycle found!
          const cycleStr = [...path, currId].join(' → ');
          errors.push(`Cycle detected in dependency tree: ${cycleStr}`);
          break;
        }

        seenInPath.add(currId);
        path.push(currId);

        const parentTok = tokenMap.get(Number(currId));
        if (!parentTok || parentTok.head === undefined || parentTok.head === null || parentTok.head === '_') {
          break;
        }
        currId = Number(parentTok.head);
      }
    }

    return {
      isValid: errors.length === 0,
      rootCount,
      errors: Array.from(new Set(errors)),
      warnings: Array.from(new Set(warnings))
    };
  }

  /**
   * Heuristically infers baseline dependency relations for unannotated tokens.
   * Provides a solid starting point so annotators don't start from an empty sheet.
   * @param {Array<Object>} tokens
   * @returns {Array<Object>} tokens with inferred head and deprel
   */
  inferBaselineDependencies(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return tokens;
    const cloned = JSON.parse(JSON.stringify(tokens));

    // Find main verb / root candidate
    let rootIdx = -1;
    for (let i = 0; i < cloned.length; i++) {
      const upos = (cloned[i].upos || '').toUpperCase();
      if (upos === 'VERB') {
        rootIdx = i;
        break;
      }
    }

    // Fallback root to last content word or first word
    if (rootIdx === -1) {
      for (let i = cloned.length - 1; i >= 0; i--) {
        const upos = (cloned[i].upos || '').toUpperCase();
        if (upos !== 'PUNCT' && !cloned[i].isPunct) {
          rootIdx = i;
          break;
        }
      }
    }
    if (rootIdx === -1) rootIdx = 0;

    const rootId = rootIdx + 1;

    cloned.forEach((tok, idx) => {
      const id = idx + 1;
      tok.id = id;
      const upos = (tok.upos || '').toUpperCase();

      if (id === rootId) {
        tok.head = 0;
        tok.deprel = 'root';
        return;
      }

      if (tok.isPunct || upos === 'PUNCT') {
        tok.head = rootId;
        tok.deprel = 'punct';
        return;
      }

      if (upos === 'AUX') {
        tok.head = rootId;
        tok.deprel = 'aux';
        return;
      }

      if (upos === 'CCONJ') {
        tok.head = rootId;
        tok.deprel = 'cc';
        return;
      }

      // Adjective / Determiner modifying adjacent noun
      if (upos === 'ADJ' || upos === 'DET') {
        const nextTok = cloned[idx + 1];
        const nextUpos = (nextTok?.upos || '').toUpperCase();
        if (nextTok && (nextUpos === 'NOUN' || nextUpos === 'PROPN')) {
          tok.head = idx + 2;
          tok.deprel = upos === 'DET' ? 'det' : 'amod';
          return;
        }
      }

      // Adverb modifying root
      if (upos === 'ADV') {
        tok.head = rootId;
        tok.deprel = 'advmod';
        return;
      }

      // Noun / Pronoun positions relative to verb
      if (upos === 'NOUN' || upos === 'PROPN' || upos === 'PRON') {
        tok.head = rootId;
        if (id < rootId) {
          tok.deprel = 'nsubj';
        } else {
          tok.deprel = 'obj';
        }
        return;
      }

      // Default fallback
      tok.head = rootId;
      tok.deprel = 'dep';
    });

    return cloned;
  }
}

export const dependencyService = new DependencyService();
