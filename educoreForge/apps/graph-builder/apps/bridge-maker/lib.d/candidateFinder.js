'use strict';

// candidateFinder.js — lib.d NEW (bridgeKitRefactor_072726 design §4.1, open item O3). The dispatch
// that selects a semanticMatcher implementation BY the recipe's matcher-name token. Today exactly
// ONE matcher exists ('semanticDefText' — role-matched top-K by definition-embedding cosine, the
// kit's semanticMatcher.js); this is the registry a future custom matcher (design §6 Phase 5, e.g. a
// structural/XPath matcher for a standard whose signal a generic def-cosine matcher ignores) joins
// by name, not by a switch statement (registry-over-switch, house style).
//
//   candidateFinder({ semanticMatcher }) -> { find(matcherName) -> semanticMatcher-shaped module }
//
// find() is SYNCHRONOUS and THROWS on an unregistered or unnamed matcherName — a pure registry
// lookup with no I/O, exactly like manifestEditor.init()'s synchronous refusals (interfaces.js).
// An unregistered name is a recipe error, named, never a silent fallthrough to the one matcher that
// happens to exist (polyArch2 §6 — the whole point of a NAMED recipe token is that it is checked
// against something, not merely carried).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ semanticMatcher } = {}) => {
		if (!semanticMatcher || typeof semanticMatcher.retrieve !== 'function') {
			throw new Error(
				`${moduleName}: constructed without a semanticMatcher (retrieve). candidateFinder ` +
					`dispatches a recipe's matcher-name token to a matcher implementation; there is no ` +
					`default matcher to dispatch to.`,
			);
		}

		// THE REGISTRY — recipe matcher-name token -> matcher module. 'semanticDefText' is the only
		// entry today (open item O3); a custom matcher (design §6 Phase 5) is added here BY NAME, not
		// by branching on a standard token elsewhere.
		const REGISTRY = { semanticDefText: semanticMatcher };

		const find = (matcherName) => {
			if (typeof matcherName !== 'string' || matcherName.trim() === '') {
				throw new Error(
					`${moduleName}: matcherName is not given — candidateFinder must be told which ` +
						`registered matcher a recipe names; there is no default.`,
				);
			}
			const matcher = REGISTRY[matcherName];
			if (!matcher) {
				throw new Error(
					`${moduleName}: matcherName '${matcherName}' is not a registered matcher. Known: ` +
						`${Object.keys(REGISTRY).sort().join(', ')}.`,
				);
			}
			return matcher;
		};

		return { find };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
