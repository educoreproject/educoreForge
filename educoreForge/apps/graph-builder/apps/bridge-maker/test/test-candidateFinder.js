#!/usr/bin/env node
'use strict';

// test-candidateFinder.js — hermetic gate for lib.d/candidateFinder.js (bridgeKitRefactor_072726
// Phase 1, open item O3 — the matcher-name dispatch). Proves:
//   RED  — construction without a semanticMatcher is refused BY NAME; find() with no name, or an
//          UNREGISTERED name, is refused BY NAME (never a silent fallthrough to the one matcher
//          that happens to exist).
//   GREEN — find('semanticDefText') returns the SAME injected semanticMatcher instance (identity —
//          the registry does not wrap or clone it), and that returned matcher's retrieve() works.
//
// PURE + synchronous: no Neo4j, no network, no LLM.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-candidateFinder.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d candidateFinder kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves candidateFinder's construction guard and find()'s refusal of an unnamed/unregistered
     matcher name (RED), and that 'semanticDefText' resolves to the injected matcher by identity
     (GREEN).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const candidateFinderFactory = require('../lib.d/candidateFinder');
const semanticMatcherFactory = require('../lib.d/semanticMatcher');

// =====================================================================
harness.section('RED — construction guard + find() refusals');
// =====================================================================
harness.match(
	'constructing without a semanticMatcher throws, naming the reason',
	(() => {
		try {
			candidateFinderFactory({});
			return '';
		} catch (constructionError) {
			return constructionError.message;
		}
	})(),
	/constructed without a semanticMatcher/,
);

const semanticMatcher = semanticMatcherFactory({ topK: 5 });
const finder = candidateFinderFactory({ semanticMatcher });

harness.match(
	'find() with no matcherName throws, naming the reason',
	(() => {
		try {
			finder.find();
			return '';
		} catch (findError) {
			return findError.message;
		}
	})(),
	/matcherName is not given/,
);

harness.match(
	"find('bogus') — an unregistered matcher name — throws, naming what IS registered",
	(() => {
		try {
			finder.find('bogus');
			return '';
		} catch (findError) {
			return findError.message;
		}
	})(),
	/is not a registered matcher.*semanticDefText/,
);

// =====================================================================
harness.section("GREEN — find('semanticDefText') resolves to the injected matcher BY IDENTITY, and it works");
// =====================================================================
const found = finder.find('semanticDefText');
harness.ok('find() returns the SAME injected semanticMatcher instance (no wrap, no clone)', found === semanticMatcher);
const pool = found.retrieve({ vector: [1, 0] }, [{ stableId: 'c1', vector: [1, 0] }, { stableId: 'c2', vector: [0, 1] }]);
harness.equal('the resolved matcher retrieves correctly (rank-1 is the exact match)', pool[0].candidate.stableId, 'c1');

harness.report();
