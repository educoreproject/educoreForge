#!/usr/bin/env node
'use strict';

// test-evidenceComposer.js — hermetic gate for lib/evidenceComposer.js (bridgeEvidenceRefactor-
// spec.md §3/§5, ⟪A1⟫, ⟪A5⟫; P2 deliverable). Proves, against semanticMatcher (the REAL, pure
// module) + graphReader/hubModule/nominate/walk DOUBLES only:
//   RED  — construction guard (no semanticMatcher); call guards (malformed sourceElement,
//          candidateElements, graphReader, hubModule); a failing nominate()/hubModule()/walk() is
//          propagated, named; a malformed nomination (no rationale) and a smuggled per-candidate
//          walk segment are caught by the composer's OWN self-gate (⟪A3⟫) BEFORE it calls back; a
//          walk hook reaching outside the declared `dependencies` is refused BY VALUE (⟪A5⟫).
//   GREEN — a cosine-only pool composes a conforming evidence package (verified against the REAL
//          evidencePackageViolation oracle — the contract gate IS the acceptance oracle, not this
//          suite's own assertions); the union-pool dedupe rule (⟪A1⟫: a nominated candidate already
//          in cosine top-K keeps its cosine AND gains the nomination; a nomination for a candidate
//          NOT in top-K enters fresh); a scoped walk's findings land in per-candidate notes AND
//          global promptSegments; the produced callable itself passes matchComposeCallableViolation.
//
// Hermetic throughout: no Docker, no Neo4j, no LLM, no network.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-evidenceComposer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the P2 graph-capable evidence composer (evidenceComposer.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the composer's construction/call guards (RED), the ⟪A1⟫ union-pool dedupe rule, ⟪A5⟫
     dependency-scoped graph walking, and self-gating against the REAL evidencePackageViolation
     oracle (GREEN then RED, by name).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const evidenceComposerFactory = require('../lib/evidenceComposer');
const semanticMatcher = require('../lib.d/semanticMatcher')({ topK: 15 });
const { evidencePackageViolation, matchComposeCallableViolation } = require('../lib/evidenceContracts');

// =====================================================================
// FIXTURES
// =====================================================================

// vectors — tiny, hand-picked so cosine ranks are unambiguous and reproducible by inspection.
const v = (...nums) => nums;

const sourceElement = { stableId: 'lif:s1', role: 'DmeProperty', name: 'Source One', defText: 'source def', vector: v(1, 0, 0) };

const candidateNear = { stableId: 'ceds:P1', canonicalKey: 'P1', name: 'Near Candidate', vector: v(1, 0, 0) }; // cosine 1.0
const candidateFar = { stableId: 'ceds:P2', canonicalKey: 'P2', name: 'Far Candidate', vector: v(0, 1, 0) }; // cosine 0.0
const candidateNominatedOnly = { stableId: 'ceds:P3', canonicalKey: 'P3', name: 'Nominated-Only Candidate', vector: v(0, 0, 1) }; // cosine 0.0, would tie with candidateFar but distinguishable by key
const candidateNoVector = { stableId: 'ceds:P4', canonicalKey: 'P4', name: 'No-Vector Candidate' }; // no vector at all

const candidateElements = [candidateNear, candidateFar];

const conformingBaseTupleFor = (candidate) => ({
	referenceTier: 'property',
	canonicalKey: candidate.canonicalKey,
	propertyKey: candidate.canonicalKey,
	name: candidate.name,
	domains: [{ domainId: 'C200000', domainName: 'Fixture Domain' }],
	domainsComplete: true,
	range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: null, rangeOptionSetId: null },
	isQualified: false,
	qualifier: null,
	value: null,
});

// conformingHubModule — arity 2 (candidate, callback), R7 callback-shaped, P2 FIXTURE double (the
// real CEDS hub module is P3 scope).
const conformingHubModule = (candidate, callback) => callback('', conformingBaseTupleFor(candidate));

// =====================================================================
harness.section('RED — construction guard (no semanticMatcher, ⟪A1⟫\'s required base signal)');
// =====================================================================
harness.match(
	'constructing without a semanticMatcher throws, naming the reason',
	(() => {
		try {
			evidenceComposerFactory({});
			return '';
		} catch (constructionError) {
			return constructionError.message;
		}
	})(),
	/constructed without a semanticMatcher/,
);

// =====================================================================
harness.section('THE PRODUCED CALLABLE — passes matchComposeCallableViolation (evidenceContracts.js oracle)');
// =====================================================================
const plainComposer = evidenceComposerFactory({ semanticMatcher });
harness.equal(
	'the composer callable passes the REAL matchComposeCallableViolation gate',
	matchComposeCallableViolation(plainComposer, 'evidenceComposer'),
	'',
);

// =====================================================================
harness.section('RED — call guards refuse BY NAME');
// =====================================================================
(() => {
	let observed = null;
	plainComposer({ sourceElement: null, candidateElements: [], graphReader: { readNodes: () => {} }, hubModule: conformingHubModule }, (err) => {
		observed = err;
	});
	harness.match('missing sourceElement is refused, named', observed, /sourceElement is missing or not an object/);
})();
(() => {
	let observed = null;
	plainComposer({ sourceElement, candidateElements: 'nope', graphReader: { readNodes: () => {} }, hubModule: conformingHubModule }, (err) => {
		observed = err;
	});
	harness.match('candidateElements not an array is refused, named', observed, /candidateElements is not an array/);
})();
(() => {
	let observed = null;
	plainComposer({ sourceElement, candidateElements, graphReader: null, hubModule: conformingHubModule }, (err) => {
		observed = err;
	});
	harness.match('missing graphReader is refused, named', observed, /graphReader is missing/);
})();
(() => {
	let observed = null;
	plainComposer({ sourceElement, candidateElements, graphReader: { readNodes: () => {} }, hubModule: null }, (err) => {
		observed = err;
	});
	harness.match('missing hubModule is refused, named', observed, /hubModule is missing/);
})();

// =====================================================================
harness.section('GREEN — cosine-only pool (no nominate, no walk): a conforming evidence package');
// =====================================================================
(() => {
	let observed = null;
	plainComposer(
		{ sourceElement, candidateElements, graphReader: { readNodes: () => {}, close: (cb) => cb('') }, hubModule: conformingHubModule },
		(err, evidencePackage) => {
			observed = { err, evidencePackage };
		},
	);
	harness.equal('composer calls back with no error', observed.err, '');
	harness.equal(
		'the composed package passes the REAL evidencePackageViolation oracle (the contract gate IS the acceptance oracle)',
		evidencePackageViolation(observed.evidencePackage),
		'',
	);
	harness.equal('pool has exactly the 2 cosine candidates (no nominations injected)', observed.evidencePackage.pool.length, 2);
	harness.equal('pool[0] is the NEAR candidate (cosine 1.0, ranked first)', observed.evidencePackage.pool[0].candidate.stableId, 'ceds:P1');
	harness.equal('pool[0].cosine is exactly 1.0', observed.evidencePackage.pool[0].cosine, 1);
	harness.equal('pool[0].considerations.tuple came from hubModule', observed.evidencePackage.pool[0].considerations.tuple.canonicalKey, 'P1');
	harness.ok('pool[0] carries no nomination (cosine-only)', observed.evidencePackage.pool[0].nomination === undefined);
	harness.equal('promptSegments is empty (no walk)', observed.evidencePackage.promptSegments.length, 0);
})();

// =====================================================================
harness.section('⟪A1⟫ UNION POOL — dedupe rule proven both directions');
// =====================================================================
(() => {
	// nominate() re-nominates the ALREADY-present near candidate (dedupe: keep cosine, gain
	// nomination) AND nominates a candidate that is NOT in cosine top-K at all (enters fresh).
	const nominate = (spec, callback) => {
		void spec;
		callback('', [
			{ candidate: candidateNear, nominatedBy: 'caseStructuralBridge', rationale: 'owning-class term match (already retrieved)' },
			{ candidate: candidateNominatedOnly, nominatedBy: 'caseStructuralBridge', rationale: 'owning-class term match (retrieval missed it)' },
		]);
	};
	const composerWithNominate = evidenceComposerFactory({ semanticMatcher, nominate });
	let observed = null;
	composerWithNominate(
		{ sourceElement, candidateElements, graphReader: { readNodes: () => {}, close: (cb) => cb('') }, hubModule: conformingHubModule },
		(err, evidencePackage) => {
			observed = { err, evidencePackage };
		},
	);
	harness.equal('composer calls back with no error', observed.err, '');
	harness.equal(
		'the composed package (union pool) passes evidencePackageViolation',
		evidencePackageViolation(observed.evidencePackage),
		'',
	);
	harness.equal('pool now has 3 entries: 2 cosine + 1 nominated-only', observed.evidencePackage.pool.length, 3);

	const nearEntry = observed.evidencePackage.pool.find((oneEntry) => oneEntry.candidate.stableId === 'ceds:P1');
	harness.equal('DEDUPE: the already-retrieved candidate KEEPS its original cosine', nearEntry.cosine, 1);
	harness.equal('DEDUPE: the already-retrieved candidate GAINS the nomination', nearEntry.nomination.nominatedBy, 'caseStructuralBridge');
	harness.equal(
		'DEDUPE: the nomination rationale rides through unchanged',
		nearEntry.nomination.rationale,
		'owning-class term match (already retrieved)',
	);

	const freshEntry = observed.evidencePackage.pool.find((oneEntry) => oneEntry.candidate.stableId === 'ceds:P3');
	harness.ok('FRESH: the nominated-only candidate entered the pool', !!freshEntry);
	harness.equal('FRESH: its cosine is computed fresh (orthogonal vector -> 0)', freshEntry.cosine, 0);
	harness.equal('FRESH: it carries the nomination', freshEntry.nomination.rationale, 'owning-class term match (retrieval missed it)');
	harness.ok('FRESH: it still carries hub base evidence (tuple) like every other pool member', !!freshEntry.considerations.tuple);
})();

// =====================================================================
harness.section('GREEN twin — a nominated candidate with NO vector on either side gets the legal -1 cosine');
// =====================================================================
(() => {
	const nominate = (spec, callback) => {
		void spec;
		callback('', [{ candidate: candidateNoVector, nominatedBy: 'someBridge', rationale: 'structural signal, no embedding available' }]);
	};
	const composerWithNominate = evidenceComposerFactory({ semanticMatcher, nominate });
	let observed = null;
	composerWithNominate(
		{ sourceElement, candidateElements: [], graphReader: { readNodes: () => {}, close: (cb) => cb('') }, hubModule: conformingHubModule },
		(err, evidencePackage) => {
			observed = { err, evidencePackage };
		},
	);
	harness.equal('composer calls back with no error', observed.err, '');
	harness.equal('the no-vector nominee gets cosine -1 (the documented degenerate case, never a thrown error)', observed.evidencePackage.pool[0].cosine, -1);
	harness.equal('still passes evidencePackageViolation (-1 is a legal finite number)', evidencePackageViolation(observed.evidencePackage), '');
})();

// =====================================================================
harness.section('RED — nominate() failure is propagated, named');
// =====================================================================
(() => {
	const composerWithFailingNominate = evidenceComposerFactory({
		semanticMatcher,
		nominate: (spec, callback) => {
			void spec;
			callback('nomination source unavailable');
		},
	});
	let observed = null;
	composerWithFailingNominate(
		{ sourceElement, candidateElements, graphReader: { readNodes: () => {}, close: (cb) => cb('') }, hubModule: conformingHubModule },
		(err) => {
			observed = err;
		},
	);
	harness.match('nominate() error is refused, naming it', observed, /nominate\(\) failed: nomination source unavailable/);
})();

// =====================================================================
harness.section('RED — a malformed nomination (no rationale) is caught by the composer\'s OWN self-gate (⟪A3⟫)');
// =====================================================================
(() => {
	const composerWithBadNominate = evidenceComposerFactory({
		semanticMatcher,
		nominate: (spec, callback) => {
			void spec;
			callback('', [{ candidate: candidateNominatedOnly, nominatedBy: 'someBridge' /* no rationale */ }]);
		},
	});
	let observed = null;
	composerWithBadNominate(
		{ sourceElement, candidateElements, graphReader: { readNodes: () => {}, close: (cb) => cb('') }, hubModule: conformingHubModule },
		(err) => {
			observed = err;
		},
	);
	harness.match(
		'refused before calling back with a package, naming the evidencePackageViolation reason',
		observed,
		/composed evidence package failed its own shape gate.*nomination is present but malformed/,
	);
})();

// =====================================================================
harness.section('RED — hubModule() failure for one candidate is propagated, naming the candidate');
// =====================================================================
(() => {
	const failingHubModule = (candidate, callback) => {
		if (candidate.stableId === 'ceds:P2') {
			callback('hub lookup timed out');
			return;
		}
		callback('', conformingBaseTupleFor(candidate));
	};
	let observed = null;
	plainComposer(
		{ sourceElement, candidateElements, graphReader: { readNodes: () => {}, close: (cb) => cb('') }, hubModule: failingHubModule },
		(err) => {
			observed = err;
		},
	);
	harness.match('named with the failing candidate\'s key', observed, /hubModule failed for candidate 'ceds:P2': hub lookup timed out/);
})();

// =====================================================================
harness.section('⟪A5⟫ GRAPH WALKING — scoped: a declared-dependency read succeeds and lands in notes/segments');
// =====================================================================
(() => {
	const graphReaderDouble = {
		readNodes: ({ label, propertyEquals }, callback) => {
			if (label === 'ForgedNode' && propertyEquals._source === 'LIF') {
				callback('', { nodes: [{ stableId: 'lif:related1', properties: { name: 'a related LIF element' } }] });
				return;
			}
			callback('', { nodes: [] });
		},
		close: (callback) => callback(''),
	};
	const walk = ({ sourceElement: se, pool, graphReader, dependencies }, callback) => {
		void se;
		harness.equal('walk() receives the declared dependencies', dependencies.join(','), 'lif');
		graphReader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: 'LIF' } }, (err, out) => {
			if (err) {
				callback(err);
				return;
			}
			const perCandidateNotes = {};
			perCandidateNotes[pool[0].stableId] = [`walked: found ${out.nodes.length} related LIF element(s)`];
			callback('', { perCandidateNotes, promptSegments: ['Judge this pair using the walked LIF context.'] });
		});
	};
	const composerWithWalk = evidenceComposerFactory({ semanticMatcher, walk, dependencies: ['lif'] });
	let observed = null;
	composerWithWalk({ sourceElement, candidateElements, graphReader: graphReaderDouble, hubModule: conformingHubModule }, (err, evidencePackage) => {
		observed = { err, evidencePackage };
	});
	harness.equal('composer calls back with no error', observed.err, '');
	harness.equal('the composed package (with walked notes) passes evidencePackageViolation', evidencePackageViolation(observed.evidencePackage), '');
	const nearEntry = observed.evidencePackage.pool.find((oneEntry) => oneEntry.candidate.stableId === 'ceds:P1');
	harness.equal(
		'the walked note landed in THAT candidate\'s considerations.notes',
		nearEntry.considerations.notes[0],
		'walked: found 1 related LIF element(s)',
	);
	harness.equal(
		'the walked global segment landed in promptSegments',
		observed.evidencePackage.promptSegments[0],
		'Judge this pair using the walked LIF context.',
	);
	const farEntry = observed.evidencePackage.pool.find((oneEntry) => oneEntry.candidate.stableId === 'ceds:P2');
	harness.equal('a candidate the walk did not mention gets NO extra notes', farEntry.considerations.notes.length, 0);
})();

// =====================================================================
harness.section('⟪A5⟫ GRAPH WALKING — RED: a walk reaching OUTSIDE the declared dependency graph is refused');
// =====================================================================
(() => {
	const graphReaderDouble = {
		readNodes: (spec, callback) => callback('', { nodes: [] }),
		close: (callback) => callback(''),
	};
	const walk = ({ graphReader }, callback) => {
		// this recipe only declared `dependencies: ['lif']` — reaching for 'sif' is out of scope.
		graphReader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: 'sif' } }, (err, out) => {
			callback(err, out);
		});
	};
	const composerWithWalk = evidenceComposerFactory({ semanticMatcher, walk, dependencies: ['lif'] });
	let observed = null;
	composerWithWalk({ sourceElement, candidateElements, graphReader: graphReaderDouble, hubModule: conformingHubModule }, (err) => {
		observed = err;
	});
	harness.match(
		'refused BY VALUE, naming the out-of-scope standard and the declared scope',
		observed,
		/walk\(\) failed:.*walk scope violation.*'SIF' is not in the declared dependency graph \(LIF\)/,
	);
})();

// =====================================================================
harness.section('⟪A5⟫ GRAPH WALKING — RED: a composer with NO declared dependencies refuses every scoped read');
// =====================================================================
(() => {
	const graphReaderDouble = { readNodes: (spec, callback) => callback('', { nodes: [] }), close: (callback) => callback('') };
	const walk = ({ graphReader }, callback) => {
		graphReader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: 'lif' } }, callback);
	};
	const composerNoDeps = evidenceComposerFactory({ semanticMatcher, walk }); // dependencies defaults to []
	let observed = null;
	composerNoDeps({ sourceElement, candidateElements, graphReader: graphReaderDouble, hubModule: conformingHubModule }, (err) => {
		observed = err;
	});
	harness.match('refused, naming "(none declared)"', observed, /\(none declared\)/);
})();

// =====================================================================
harness.section('⟪A2⟫/⟪A3⟫ RED — a walk hook that SMUGGLES a per-candidate segment into promptSegments is refused');
// =====================================================================
(() => {
	const graphReaderDouble = { readNodes: (spec, callback) => callback('', { nodes: [] }), close: (callback) => callback('') };
	const smugglingWalk = (spec, callback) => {
		void spec;
		callback('', { perCandidateNotes: {}, promptSegments: ['This global note is really about ceds:P1 specifically.'] });
	};
	const composerWithSmugglingWalk = evidenceComposerFactory({ semanticMatcher, walk: smugglingWalk, dependencies: [] });
	let observed = null;
	composerWithSmugglingWalk({ sourceElement, candidateElements, graphReader: graphReaderDouble, hubModule: conformingHubModule }, (err) => {
		observed = err;
	});
	harness.match(
		'refused before calling back with a package, naming the leaked candidate token',
		observed,
		/composed evidence package failed its own shape gate.*references candidate-specific token 'ceds:P1'/,
	);
})();

// =====================================================================
harness.section('RED — a failing walk() itself is propagated, named');
// =====================================================================
(() => {
	const graphReaderDouble = { readNodes: (spec, callback) => callback('', { nodes: [] }), close: (callback) => callback('') };
	const composerWithFailingWalk = evidenceComposerFactory({
		semanticMatcher,
		walk: (spec, callback) => {
			void spec;
			callback('graph unreachable');
		},
		dependencies: ['lif'],
	});
	let observed = null;
	composerWithFailingWalk({ sourceElement, candidateElements, graphReader: graphReaderDouble, hubModule: conformingHubModule }, (err) => {
		observed = err;
	});
	harness.match('named', observed, /walk\(\) failed: graph unreachable/);
})();

harness.report();
