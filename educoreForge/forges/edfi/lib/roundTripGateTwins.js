'use strict';

// roundTripGateTwins.js (forge-edfi) — the fault injections that prove each gate BITES (RT-10).
//
// DOCTRINE: a gate never observed failing is unproven. Every gate in
// gates/edfiRoundTripGates.jsonc names a twin here; the suite records a gate PASS-able only
// after watching its twin turn it RED.
//
// WHAT A TWIN PROVES, STATED HONESTLY (the CEDS caveat, kept): twins inject at the MEASURE
// BOUNDARY — each receives a deep clone of the measurement bundle, corrupts it in the specific
// way its name describes, and hands it back. A twin proves THE GATE'S COMPARISON BITES. It does
// NOT prove the measure was computed correctly — that second proof belongs to the DATA-LEVEL
// probes in test/test-edfiRoundTrip.js, which run the REAL reducer, emitter, and diff and (for
// the cheating detector) delete a REAL graph fact through the double's adjustGraphRows seam and
// watch the REAL diff name it LOST. Saying so here rather than letting the suite look stronger
// than it is.
//
// Every twin mirrors its NAME — a generic set-the-number-wrong breaker would satisfy the
// harness and teach nobody anything.
//
// Pure, synchronous registry. No I/O.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const setDottedValue = (rootObject, dottedPath, newValue) => {
	const nameList = String(dottedPath).split('.');
	const lastName = nameList.pop();
	const containerObject = nameList.reduce(
		(resolvedSoFar, oneName) =>
			resolvedSoFar && typeof resolvedSoFar === 'object' ? resolvedSoFar[oneName] : undefined,
		rootObject,
	);
	if (containerObject && typeof containerObject === 'object') {
		containerObject[lastName] = newValue;
	}
	return rootObject;
};

const bumpDottedValue = (rootObject, dottedPath, delta) => {
	const nameList = String(dottedPath).split('.');
	const lastName = nameList.pop();
	const containerObject = nameList.reduce(
		(resolvedSoFar, oneName) =>
			resolvedSoFar && typeof resolvedSoFar === 'object' ? resolvedSoFar[oneName] : undefined,
		rootObject,
	);
	if (
		containerObject &&
		typeof containerObject === 'object' &&
		typeof containerObject[lastName] === 'number'
	) {
		containerObject[lastName] += delta;
	}
	return rootObject;
};

const moduleFunction = () => {
	const twinRegistry = {
		// G-1: the smallest fabrication there is — one statement Ed-Fi never made.
		injectOneInventedStatement: (measurements) =>
			bumpDottedValue(measurements, 'report.headline.invented', 1),

		// G-2: the combined invention meter (diff + crosswalk guard) must bite too.
		bumpInventedTotal: (measurements) => bumpDottedValue(measurements, 'verdict.inventedTotal', 1),

		// G-3: one stashed CEDS raw value the CSVs never contained.
		doctorOneStashRawValue: (measurements) =>
			bumpDottedValue(measurements, 'verdict.crosswalkGuard.violationCount', 1),

		// G-4: one carriable-fixture statement stops round-tripping; clean must fall with it.
		dropOneSourceStatement: (measurements) =>
			setDottedValue(measurements, 'verdict.roundTripClean', false),

		// G-5: the full-vocabulary fixture stops round-tripping clean — a carried class falls back
		// out of the graph, or the carriage domain itself goes missing.
		falsifyFullVocabularyCleanProbe: (measurements) =>
			setDottedValue(measurements, 'probe.fullVocabularyClean', false),

		// G-6: a lost record loses its located detail.
		stripOneLostLocation: (measurements) =>
			setDottedValue(measurements, 'probe.lostAllLocatedAndBucketed', false),

		// G-7: a contentGap loss appears with no backlog label — anonymous loss.
		stripOneBacklogLabel: (measurements) =>
			bumpDottedValue(measurements, 'probe.fullVocabularyUnlabeledContentGapCount', 1),

		// G-8: the two independent readers stop agreeing and nobody says so.
		falsifyCensusProbe: (measurements) =>
			setDottedValue(measurements, 'probe.censusCrossCheckAgreed', false),

		// G-9: the cheating detector itself is falsified.
		falsifyCheatingDetectorProbe: (measurements) =>
			setDottedValue(measurements, 'probe.deletedFactShowsLost', false),

		// G-10: the invention alarm is falsified.
		falsifyInventionProbe: (measurements) =>
			setDottedValue(measurements, 'probe.injectedFactShowsInvented', false),

		// G-11: a refusal stops being named.
		falsifyRefusalProbe: (measurements) =>
			setDottedValue(measurements, 'probe.refusalsAllNamed', false),

		// G-12: two semantically DIFFERENT documents collapse to the same statement set — the
		// over-forgiving instrument.
		collapseAdversarialPair: (measurements) =>
			setDottedValue(measurements, 'probe.adversarialPairsAllDistinct', false),

		// G-13: two cosmetically different but semantically identical documents stop collapsing —
		// the over-strict instrument.
		splitCosmeticPair: (measurements) =>
			setDottedValue(measurements, 'probe.cosmeticVariantsCollapse', false),

		// G-14: the verdict loses a required RT-6 field.
		dropVerdictField: (measurements) =>
			setDottedValue(measurements, 'probe.verdictShapeComplete', false),

		// G-15: two empty statement sets are identical, and identical is not success.
		emptyBothSides: (measurements) =>
			setDottedValue(measurements, 'report.headline.sourceStatements', 0),

		// G-16: a percentage sneaks into acceptance.
		declarePercentGate: (measurements) =>
			bumpDottedValue(measurements, 'suite.gatesUsingPercentInAcceptance', 1),

		// G-17: only one componentKind value survives — the common kind carried, the rare one
		// dropped, which is the shape a partial carriage actually takes.
		falsifyComponentKindCarriageProbe: (measurements) =>
			setDottedValue(measurements, 'probe.componentKindBothKindsCarried', false),

		// G-18: an item that declared no metaEdId acquires one anyway — content manufactured by
		// the act of carrying more content.
		falsifyNonEmissionProbe: (measurements) =>
			setDottedValue(measurements, 'probe.idlessItemsEmitNothing', false),

		// G-19: two forge edges share a (from, type, to) triple and would collapse under MERGE.
		falsifyEdgeUniquenessProbe: (measurements) =>
			setDottedValue(measurements, 'probe.forgeEdgeTriplesDistinct', false),
	};

	// auditRegistryAgainst — every declared twin must exist here; every twin here must be
	// declared by some gate (an orphan twin is dead proof-code).
	const auditRegistryAgainst = ({ declarations }) => {
		const declaredTwinList = declarations.gates.map((oneGate) => oneGate.twin);
		const missingList = declaredTwinList.filter((oneTwinName) => !twinRegistry[oneTwinName]);
		const orphanList = Object.keys(twinRegistry).filter(
			(oneTwinName) => !declaredTwinList.includes(oneTwinName),
		);
		return { missingList, orphanList };
	};

	return { twinRegistry, auditRegistryAgainst };
};

module.exports = moduleFunction;
