'use strict';

// roundTripGateTwins.js (forge-sif) — the fault injections that prove each gate BITES (RT-10).
//
// DOCTRINE: a gate never observed failing is unproven. Every gate in
// gates/sifRoundTripGates.jsonc names a twin here; the test records a gate PASS-able only after
// watching its twin turn it RED.
//
// WHAT A TWIN PROVES, STATED HONESTLY (the CEDS reference's own caveat, kept): twins inject at
// the MEASURE BOUNDARY — each receives a deep clone of the measurement bundle, corrupts it in
// the specific way its name describes, and hands it back. A twin proves THE GATE'S COMPARISON
// BITES. It does NOT prove the measure was computed correctly — that second proof belongs to the
// probes in test/test-sifRoundTrip.js, which run the REAL canonicalizer and diff against the
// fixture and (for the cheating detector, the invention alarm, and the ORDER-SWAP) corrupt a
// REAL graph double and watch the REAL diff go RED by name. Saying so here rather than letting
// the suite look stronger than it is.
//
// Every twin mirrors its NAME — a generic set-the-number-wrong breaker would satisfy the harness
// and teach nobody anything.
//
// Pure, synchronous registry. No I/O.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const setIn = (root, dottedPath, value) => {
	const nameList = String(dottedPath).split('.');
	const lastName = nameList.pop();
	const container = nameList.reduce(
		(soFar, oneName) => (soFar && typeof soFar === 'object' ? soFar[oneName] : undefined),
		root,
	);
	if (container && typeof container === 'object') {
		container[lastName] = value;
	}
	return root;
};

const bump = (root, dottedPath, delta) => {
	const nameList = String(dottedPath).split('.');
	const lastName = nameList.pop();
	const container = nameList.reduce(
		(soFar, oneName) => (soFar && typeof soFar === 'object' ? soFar[oneName] : undefined),
		root,
	);
	if (container && typeof container === 'object' && typeof container[lastName] === 'number') {
		container[lastName] += delta;
	}
	return root;
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const twinRegistry = {
			// G-1: the smallest fabrication there is — one statement SIF never made.
			injectOneInventedStatement: (measurements) =>
				bump(measurements, 'report.headline.invented', 1),

			// G-2: one source statement stops round-tripping; clean must fall with it.
			dropOneSourceStatement: (measurements) => {
				bump(measurements, 'report.headline.lost', 1);
				bump(measurements, 'report.headline.matched', -1);
				return setIn(measurements, 'verdict.roundTripClean', false);
			},

			// G-3: a loss total with no locations is a number nobody can act on.
			stripOneLostSampleList: (measurements) =>
				setIn(measurements, 'probe.lostRowsWithoutSamples', 1),

			// G-4: a lost statement escaping both categories is uncategorized loss.
			misSumLostCategories: (measurements) =>
				setIn(measurements, 'probe.lostCategorySumMatches', false),

			// G-5: a verdict that cannot name the bytes it judged is not evidence.
			blankSnapshotDigest: (measurements) =>
				setIn(measurements, 'probe.snapshotIdentityWellFormed', false),

			// G-6: same for the graph side.
			dropGraphIdentity: (measurements) =>
				setIn(measurements, 'probe.graphIdentityPresent', false),

			// G-7: two empty statement sets are identical, and a naive comparison calls identical
			// success. The floor must refuse it.
			emptyBothSides: (measurements) => {
				setIn(measurements, 'report.headline.sourceStatements', 0);
				setIn(measurements, 'report.headline.emittedStatements', 0);
				setIn(measurements, 'report.headline.matched', 0);
				return setIn(measurements, 'report.headline.lost', 0);
			},

			// G-8: a percentage sneaking into acceptance — the tampered-emission lesson.
			declarePercentGate: (measurements) =>
				setIn(measurements, 'suite.gatesUsingPercentInAcceptance', 1),

			// G-9: the cheating detector's own leash — if the probe fact can be falsified without
			// the gate noticing, the detector was decoration.
			falsifyCheatingDetectorProbe: (measurements) =>
				setIn(measurements, 'probe.deletedFactShowsLost', false),

			// G-10: same leash on the invention probe.
			falsifyInventionProbe: (measurements) =>
				setIn(measurements, 'probe.injectedFactShowsInvented', false),

			// G-11: a refusal that stops naming what is missing has become a silent skip.
			falsifyRefusalProbe: (measurements) =>
				setIn(measurements, 'probe.refusalsAllNamed', false),

			// G-12: source content the instrument did not model, smuggled past the census.
			smuggleUnmodeledConstruct: (measurements) =>
				setIn(measurements, 'probe.unmodeledConstructTotal', 1),

			// G-13: the ORDER-SWAP leash (R-SF-1/R-SF-7) — if the swap probe's fact can be
			// falsified without the gate noticing, order sensitivity was decoration.
			falsifyOrderSwapProbe: (measurements) =>
				setIn(measurements, 'probe.orderSwapShowsPairedRedNamingMembers', false),

			// G-14: the SCALE report leash — a phase whose research finding is performance must not
			// pass with the numbers missing (largest group's n and pair count included, per the
			// supervisor's R-SF-7 addition).
			blankScaleReport: (measurements) =>
				setIn(measurements, 'probe.scaleReportWellFormed', false),

			// ---- PHASE 4 (the CHARACTERISTICS enrichment).

			// G-15: the refusal leash. If this fact can be falsified without the gate biting, then
			// "an unlisted value is refused by name" was a claim in a comment rather than a behavior.
			falsifyCharacteristicsRefusalProbe: (measurements) =>
				setIn(measurements, 'probe.characteristicsRefusalNamed', false),

			// G-16: the derivation leash. The probe compares every forged field against a table
			// re-stated independently in the test; falsifying the fact must turn the gate red or the
			// derivation is being graded by the code that performed it.
			falsifyCharacteristicsDerivationProbe: (measurements) =>
				setIn(measurements, 'probe.characteristicsDerivationExact', false),

			// G-17: the anti-invention leash, and the one that matters most. If the derived pair could
			// drift into the compiler's read projection unnoticed, the enrichment would start minting
			// graph statements the source never made — curing LOST by manufacturing INVENTED, which
			// the doctrine names as strictly worse than the loss it would have cured.
			falsifyDerivedPropertyIsolationProbe: (measurements) =>
				setIn(measurements, 'probe.derivedPropertiesOutsideStatementDomain', false),

			// ---- PHASE P5 (embedText-091426).

			// G-18: the label selection admits the text node as a field, and the with/without runs stop
			// agreeing. The DATA-LEVEL version of this admission is observed RED in
			// test/test-sifRoundTrip.js SECTION 6c, where the validator refuses the emission by name.
			admitEmbedTextLabel: (measurements) =>
				setIn(measurements, 'probe.embedTextExcludedFromEmission', false),
		};

		// auditRegistryAgainst — a gate can never quietly go twin-less, and a twin can never
		// outlive its gate.
		const auditRegistryAgainst = ({ declarations } = {}, callback) => {
			if (!declarations || !Array.isArray(declarations.gates)) {
				callback(`${moduleName}.auditRegistryAgainst: declarations are REQUIRED.`);
				return;
			}
			const missing = declarations.gates
				.filter((oneGate) => typeof twinRegistry[oneGate.twin] !== 'function')
				.map((oneGate) => `${oneGate.id} -> '${oneGate.twin}'`);
			const declaredTwinNames = {};
			declarations.gates.forEach((oneGate) => {
				declaredTwinNames[oneGate.twin] = true;
			});
			const orphaned = Object.keys(twinRegistry).filter(
				(oneName) => !declaredTwinNames[oneName],
			);
			callback('', { missing, orphaned });
		};

		const cloneMeasurements = (measurements) => JSON.parse(JSON.stringify(measurements));

		return { twinRegistry, auditRegistryAgainst, cloneMeasurements };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
