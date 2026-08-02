'use strict';

// =====================================================================================
// roundTripGateTwins — the fault injections that prove each gate BITES
// =====================================================================================
//
// DOCTRINE: a gate never observed failing is unproven. Every gate in
// forges/ceds/gates/cedsFidelityGates.jsonc names a twin here, and the harness records the
// gate as PASS-able only after watching that twin turn it RED.
//
// WHAT A TWIN PROVES, STATED HONESTLY. Twins inject at the MEASURE BOUNDARY: each receives
// a deep clone of the measurement bundle, corrupts it in the specific way its name
// describes, and hands it back. So a twin proves THE GATE'S COMPARISON BITES -- that a
// wrong measurement is caught rather than waved through.
//
// A twin does NOT prove the measure is correctly computed. Nothing at this layer could:
// the harness sees numbers, not graphs. That second proof belongs to the probe tests in
// forges/ceds/test/, which run the real canonicalizer and the real compiler against
// fixtures. Saying so here rather than letting the suite look stronger than it is, because
// the failure this whole project keeps rediscovering is a green thing that was never
// actually checked.
//
// Every twin is written to mirror its NAME. A generic "set the number wrong" breaker would
// technically satisfy the harness and teach nobody anything; when the twin for
// `nullOneCrossRefsRaw` decrements the crossRefs count specifically, the next reader learns
// what the gate is defending.

const path = require('path');

const moduleName = path.basename(__filename).replace(/\.js$/, '');

// setIn — write a dotted path into a cloned bundle, creating nothing that was not there.
// A twin that has to invent structure is corrupting the wrong thing.
const setIn = (root, dottedPath, value) => {
	const parts = String(dottedPath).split('.');
	const lastKey = parts.pop();
	const container = parts.reduce(
		(soFar, oneKey) => (soFar && typeof soFar === 'object' ? soFar[oneKey] : undefined),
		root,
	);
	if (container && typeof container === 'object') {
		container[lastKey] = value;
	}
	return root;
};

const bump = (root, dottedPath, delta) => {
	const parts = String(dottedPath).split('.');
	const lastKey = parts.pop();
	const container = parts.reduce(
		(soFar, oneKey) => (soFar && typeof soFar === 'object' ? soFar[oneKey] : undefined),
		root,
	);
	if (container && typeof container === 'object' && typeof container[lastKey] === 'number') {
		container[lastKey] += delta;
	}
	return root;
};

// A twin whose named fault is "the measure stops being supplied at all". Deleting the
// measure drives the gate to UNMEASURED, which the harness treats as RED -- correctly: a
// gate that passes because nobody measured it is the exact bug this suite exists to catch.
const unsupply = (kind, name) => ({ measurements }) => {
	if (measurements && measurements[kind]) {
		delete measurements[kind][name];
	}
	return measurements;
};

const falsify = (kind, name) => ({ measurements }) => {
	if (measurements && measurements[kind]) {
		measurements[kind][name] = false;
	}
	return measurements;
};

const setCount = (kind, name, value) => ({ measurements }) => {
	if (measurements && measurements[kind]) {
		measurements[kind][name] = value;
	}
	return measurements;
};

const roundTripGateTwins = () => {
	const twinRegistry = {
		// ---------------------------------------------------------------- FAMILY F
		// One source statement stops round-tripping. The smallest real regression there is.
		// NOTE ON SHAPE: derived measures (`report:name`) live as top-level keys on the SAME
		// object the raw report occupies, so `report.headline.lost` and
		// `report:matchedEqualsSource` both read out of measurements.report. A twin that moves
		// the headline must move the derived value with it, or it proves only that one of the
		// two is checked.
		dropOneSourceStatement: ({ measurements }) => {
			bump(measurements, 'report.headline.lost', 1);
			bump(measurements, 'report.headline.matched', -1);
			if (measurements.report) {
				measurements.report.matchedEqualsSource = false;
			}
			return measurements;
		},

		// F-3's twin is the Phase-0 lesson made executable: run the whole thing against an
		// empty graph. Two empty things are identical, and a naive comparison calls identical
		// success. The floors must refuse it.
		emptyGraphReport: ({ measurements }) => {
			setIn(measurements, 'report.headline.sourceStatements', 0);
			setIn(measurements, 'report.headline.emittedStatements', 0);
			setIn(measurements, 'report.headline.matched', 0);
			setIn(measurements, 'report.headline.lost', 0);
			setIn(measurements, 'report.headline.emittedSubjects', 0);
			if (measurements.report) {
				measurements.report.sizeFloors = false;
			}
			return measurements;
		},

		gateDeclaredOnPercent: setCount('suite', 'gatesUsingPercentInAcceptance', 1),
		structuralFidelityAbsent: falsify('report', 'structuralFidelityPresent'),
		doubleCountedPredicateRow: falsify('report', 'predicateRowsSumToLost'),
		nonEmptyExclusionManifest: setCount('suite', 'exclusionManifestLength', 1),

		// ---------------------------------------------------------------- FAMILY N
		// The audit proved this family load-bearing: a tampered emission carrying four
		// fabricated statements still reported 71.936%, because the percentage is
		// matched/source and cannot see invention at all.
		injectOneInventedStatement: ({ measurements }) => {
			bump(measurements, 'report.headline.invented', 1);
			return measurements;
		},
		inventionsCountedButNotNamed: falsify('probe', 'inventionsIndividuallyNamed'),
		cleanFidelityIgnoresInvention: falsify('probe', 'cleanFidelityFallsOnInvention'),

		// ---------------------------------------------------------------- FAMILY C
		// The deepest way the number could flatter us: the same module canonicalizes both
		// sides, so anything it discards it discards symmetrically.
		collidingAdversarialPair: falsify('probe', 'adversarialPairsAllDistinct'),
		realDifferenceHiddenInCosmeticRewrite: falsify('probe', 'spellingInvariance'),
		constructHiddenFromCanonicalizer: falsify('probe', 'independentSourceCountAgrees'),
		topLevelWithoutSubjectDropped: unsupply('report', 'topLevelWithoutSubjectSurfaced'),
		forceOneCanonicalizationFault: ({ measurements }) => {
			setIn(measurements, 'report.canonicalizationFaults', [
				'source: forced fault (twin) — a fault is fatal, never advisory',
			]);
			return measurements;
		},
		nestedNamespaceSilentlyHonoured: falsify('probe', 'nestedNamespaceRefused'),

		// ---------------------------------------------------------------- FAMILY L
		// If the compiler reads the source while emitting, the diff measures the source
		// against itself and every number in the report is worthless.
		compilerConsultsSource: falsify('probe', 'compilesWithSourceAbsent'),
		statementSourcedFromHubProperty: falsify('probe', 'emissionUnchangedWithHubStripped'),
		emitOneHubReference: setCount('graph', 'hubStatementsInEmission', 1),
		unscopedQueryEndpoint: falsify('probe', 'allQueriesRoleScoped'),

		// ---------------------------------------------------------------- FAMILY P
		// A good total hides a bad predicate. Each of these breaks exactly ONE.
		regressOnePredicate: ({ measurements }) => {
			const map = (measurements.report || {}).matchedByPredicate;
			if (map) {
				map['http://purl.org/dc/elements/1.1/identifier'] = 23236;
			}
			return measurements;
		},
		deliverPredicateAtNinetyNinePercent: ({ measurements }) => {
			const map = (measurements.report || {}).matchedByPredicate;
			if (map) {
				// 99% delivered is the seductive case: it looks like progress and is failure.
				map['http://purl.org/dc/elements/1.1/creator'] = 23019;
			}
			return measurements;
		},
		oneStatementLostInOnePredicate: setCount('report', 'maxLostAcrossPredicates', 1),
		implementWithoutFinding: falsify('suite', 'skosDefinitionFindingRecorded'),

		// ---------------------------------------------------------------- FAMILY S
		dropOneOptionSetParent: setCount('graph', 'optionSetSubClassOfCount', 964),
		pointSubClassOfAtMissingId: setCount('graph', 'danglingSubClassOfCount', 1),
		changeClassSubClassOfCount: setCount('graph', 'classSubClassOfCount', 397),
		dropRestrictionInnerStatement: setCount('graph', 'wellFormedRestrictionCount', 17),
		orphanOneEditHistoryEntry: falsify('graph', 'editHistoryIntegrity'),
		divergeOneDomainEdge: setCount('graph', 'domainEdgeScalarMismatchCount', 1),
		// The specific regression this guards: restoring an Array.isArray() test would once
		// again ignore the 2,068 property nodes whose allDomainIds is a scalarized string.
		arrayIsArrayBranchRestored: falsify('probe', 'allDomainIdsShapeAgnostic'),

		// ---------------------------------------------------------------- FAMILY A
		// crossRefs[0].raw is the SOLE carrier of the source dc:identifier for 20,511
		// entities. Nulling one is how the whole class of loss begins -- invisibly.
		nullOneCrossRefsRaw: setCount('graph', 'crossRefsRawPresentCount', 20510),
		changeOneIdentifierDatatype: falsify('probe', 'identifierDatatypeExclusive'),

		// ---------------------------------------------------------------- FAMILY D
		embedOneMetaVocabularyNode: setCount('graph', 'metaVocabularyEmbeddedCount', 1),
		retagMetaVocabularyAsDmeClass: setCount('graph', 'metaVocabularyReachableByBrowseCount', 1),
		// The lapse this converts into enforcement: the docs claimed six roles while the
		// graph carried eight, for weeks, and nothing noticed.
		addUndocumentedRole: ({ measurements }) => {
			if (measurements.graph) {
				measurements.graph.rolesPresentVersusDocumented = {
					equal: false,
					onlyInLeft: ['DmeVocabularyTerm'],
					onlyInRight: [],
				};
			}
			return measurements;
		},
		changeOnePreExistingRoleCount: ({ measurements }) => {
			const map = (measurements.graph || {}).preExistingRoleCounts;
			if (map) {
				map.DmeClass = 7392;
			}
			return measurements;
		},

		// ---------------------------------------------------------------- FAMILY M
		// M-1 is self-evident: it MEASURES unobserved twins, so any unobserved twin already
		// turns it red. Its twin sets that count nonzero, which is the same statement said
		// twice -- recorded plainly rather than dressed up as an independent proof.
		selfEvident: setCount('suite', 'gatesWithUnobservedTwin', 1),
		markOneGateExpectFail: setCount('suite', 'maskedGateCount', 1),
		mintNodeWithoutSuperLabel: setCount('graph', 'mintedNodesMissingForgedNodeLabel', 1),
		gateWithoutComparator: setCount('suite', 'gatesWithoutComparator', 1),
		aggregateAttribution: setCount('suite', 'aggregateFailureAttributionCount', 1),

		// ---------------------------------------------------------------- FAMILY R
		unwireFromGateOfRecord: falsify('suite', 'wiredIntoGateOfRecord'),
		nondeterministicForge: falsify('probe', 'forgeDeterminism'),
		expectationWithoutProvenance: setCount('suite', 'expectationsWithoutBaselineProvenance', 1),
		attemptGraphWrite: setCount('suite', 'graphWriteAttemptCount', 1),
	};

	// twinNamesDeclaredButNotImplemented — so a gate can never quietly go twin-less.
	const auditRegistryAgainst = ({ declarations } = {}, callback) => {
		if (!declarations || !Array.isArray(declarations.gates)) {
			callback(`${moduleName}.auditRegistryAgainst: declarations are REQUIRED.`);
			return;
		}
		const missing = declarations.gates
			.filter((oneGate) => typeof twinRegistry[oneGate.twin] !== 'function')
			.map((oneGate) => `${oneGate.id} -> '${oneGate.twin}'`);
		const declaredTwins = {};
		declarations.gates.forEach((oneGate) => {
			declaredTwins[oneGate.twin] = true;
		});
		const orphaned = Object.keys(twinRegistry).filter((oneName) => !declaredTwins[oneName]);
		callback('', { missing, orphaned });
	};

	return { twinRegistry, auditRegistryAgainst };
};

module.exports = roundTripGateTwins;
