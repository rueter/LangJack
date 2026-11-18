// jscg3 - A pure JavaScript implementation of VISL CG-3 (Constraint Grammar 3).
// This entry point has no Node-only dependencies and runs in browsers; reading files lives in '@rueter/jscg3/node'.

export const version = '1.0.0';

export { TagPattern, isWordform, isBaseform, extractForm, unescapeTag } from './tag.js';
export { Cohort, Reading, SingleWindow } from './cohort.js';
export { SetDefinition, CompositeTag, UnifySet } from './set_def.js';
export { ContextualTest } from './context.js';
export { Rule } from './rule.js';
export { Grammar, GrammarParser, GrammarError, parseGrammar } from './grammar.js';
export { parseStream, splitTags, linesOf } from './stream.js';
export { Disambiguator } from './engine.js';
export { Cg, CgWord, analysesToCg, analysisToCg } from './pipeline.js';
