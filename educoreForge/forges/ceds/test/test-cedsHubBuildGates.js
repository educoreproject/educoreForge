#!/usr/bin/env node
'use strict';

// test-cedsHubBuildGates.js — the Phase-2 BUILD-SCOPED gate runner for the HubReference
// reimplementation (SPEC-hubReimplementation-080326.md §7 gates G-7 and G-13; WORKORDER
// Phase 2 item 4).
//
// Where the Phase-1 suite (test-cedsHubForge.js) proves the CARD hermetically — no network,
// no embedding — this runner proves the two things that only exist once the REAL forger seam
// runs with the spend knob ON:
//
//   G-7  vectorPresent  — every HubReference card in a vectorized forge carries an embedding
//                         of exactly the declared width plus its embeddingModelVersion.
//   G-13 determinism    — two forges of the same base produce byte-identical folded
//                         nodes/edges (canonical sha256 over the full node/edge stream,
//                         vectors included). The second run is served from the shared
//                         content-addressed vector cache; its zero-distinct-miss evidence is
//                         the embedding-client's own cache lines in this run's log, scoped by
//                         the FORGE RUN markers printed below.
//
// It therefore runs forger.forge({ standard:'ceds', vectorize:true, deriveHub:true }) TWICE
// through the registry seam — cedsHubForge -> embed pass -> shapeForgedGraph -> fold — with
// the SHARED vector cache in force. The FIRST-EVER run pays the one-time embedding spend for
// the ~94,602 card embedTexts (announced in the output); every later run, and the full recipe
// build after it, is cache-served.
//
// THE TWIN DISCIPLINE IS UNCHANGED (roundTripGates harness): each gate's named fault is
// injected into a corrupted copy of the measured artifacts, the SAME measure computer re-runs
// over the corruption, and the gate is OBSERVED RED before its green counts. The declarations
// live in hubGates.jsonc beside the card-local gates; THIS runner judges the build:-measured
// declarations only, exactly as the Phase-1 suite judges only the hub:-measured ones — the
// harness reports a judged-but-unsupplied measure as UNMEASURED (a failure), so neither suite
// can silently pass the other's gates.
//
// Run: node forges/ceds/test/test-cedsHubBuildGates.js [-verbose]
//      SPENDS Voyage credit on the first-ever run (cache-served afterward). Long: two full
//      CEDS forges with embedding (detach it; see WORKORDER Phase 2).

const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- build-scoped gate runner for the cedsHubForge card (G-7, G-13)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Forges CEDS through the REAL forger seam twice with vectorize ON and the shared vector
     cache in force. Evaluates gates G-7 (vectorPresent) and G-13 (determinism) from
     hubGates.jsonc with the twin discipline: each gate observed RED under its own injected
     fault before its green counts. The first-ever run spends real Voyage credit embedding
     the ~94,602 card embedTexts; later runs are cache-served (the embedding-client's cache
     lines in this run's output are the evidence, scoped by the FORGE RUN markers).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const xLog = process.global.xLog;

const gatesLib = require('../lib/roundTripGates')();
const forgerModule = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'forger', 'forger'),
);
const { EQUIVALENCE_NODE_LABELS } = require(
	path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'),
);

const DECLARATIONS_PATH = path.join(__dirname, '..', 'gates', 'hubGates.jsonc');
const HUB_REFERENCE_LABEL = EQUIVALENCE_NODE_LABELS.HUB_REFERENCE;

// =====================================================================================
// measure computers — each takes the compact facts it judges, so the twin registry can
// corrupt a cloned copy and RE-RUN the same computer over it (the Phase-1 pattern)
// =====================================================================================

// canonical stream hash — sha256 updated per node/edge in array order. The arrays are
// deterministically ordered by construction (the forge sorts hub nodes/edges; the base order
// is fixed by the parse), and both runs execute the same construction code, so identical
// content yields an identical stream. Incremental update because the whole nodeEdges
// serialized at once would exceed the V8 string ceiling with 94,602 vectors aboard.
const canonicalNodeEdgesHash = (nodeEdges) => {
	const streamHash = crypto.createHash('sha256');
	nodeEdges.nodes.forEach((oneNode) => streamHash.update(JSON.stringify(oneNode)));
	streamHash.update('|edges|');
	nodeEdges.edges.forEach((oneEdge) => streamHash.update(JSON.stringify(oneEdge)));
	return streamHash.digest('hex');
};

// compact per-card vector facts — the artifact G-7 judges and its twin corrupts. Kept small
// (stableId + length + model presence) because the twin harness deep-clones the whole
// measurement bundle per twin; the full nodeEdges (≈1GB with vectors) must never ride it.
const collectCardVectorFacts = (nodeEdges) =>
	nodeEdges.nodes
		.filter((oneNode) => (oneNode.labels || []).indexOf(HUB_REFERENCE_LABEL) !== -1)
		.map((oneNode) => ({
			stableId: oneNode.stableId,
			embeddingLength: Array.isArray(oneNode.embedding) ? oneNode.embedding.length : 0,
			hasModelVersion:
				typeof oneNode.embeddingModelVersion === 'string' &&
				oneNode.embeddingModelVersion.trim() !== '',
		}));

const computeVectorPresentViolations = ({ cardVectorFacts, declaredDims }) =>
	cardVectorFacts
		.filter(
			(oneFact) =>
				oneFact.embeddingLength !== declaredDims || !oneFact.hasModelVersion,
		)
		.slice(0, 25)
		.map(
			(oneFact) =>
				`${oneFact.stableId}: embedding ${oneFact.embeddingLength} dims ` +
				`(declared ${declaredDims}), embeddingModelVersion ` +
				`${oneFact.hasModelVersion ? 'present' : 'ABSENT'}`,
		);

const computeDeterminismViolations = ({ runOneHash, runTwoHash }) =>
	runOneHash === runTwoHash
		? []
		: [`forge run 1 stream hash ${runOneHash} != forge run 2 stream hash ${runTwoHash}`];

// =====================================================================================
// the two forge runs, serial — run 1 measured in full; run 2 hashed only, so the two full
// vectored nodeEdges never coexist in memory
// =====================================================================================

const forger = forgerModule();

const forgeOnce = (runLabel, callback) => {
	xLog.status(`==== FORGE RUN ${runLabel} BEGINS (ceds, vectorize ON, deriveHub) ====`);
	forger.forge(
		{ standard: 'ceds', version: 'current', vectorize: true, deriveHub: true },
		(forgeError, forgeReport) => {
			if (forgeError) {
				callback(`forge run ${runLabel}: ${forgeError}`);
				return;
			}
			xLog.status(`==== FORGE RUN ${runLabel} COMPLETE ====`);
			callback('', forgeReport);
		},
	);
};

forgeOnce(1, (runOneError, runOneReport) => {
	harness.section('FORGE RUN 1 — the real seam, spend knob ON, shared cache in force');
	harness.ok('forge run 1 completes', !runOneError, runOneError);
	if (runOneError) {
		harness.report();
		return;
	}

	const declaredDims = runOneReport.nodeEdges.embeddingDims;
	const cardVectorFacts = collectCardVectorFacts(runOneReport.nodeEdges);
	const runOneHash = canonicalNodeEdgesHash(runOneReport.nodeEdges);
	const runOneCardCount = cardVectorFacts.length;
	const hubCounts = runOneReport.hubCounts;
	const hubEmbeddedCardCount = runOneReport.hubEmbeddedCardCount;

	harness.equal(
		'the fold reported embedding exactly the HubReference card population',
		hubEmbeddedCardCount,
		runOneCardCount,
	);
	harness.ok(
		`the block declares a positive embedding width (declared ${declaredDims})`,
		Number.isInteger(declaredDims) && declaredDims > 0,
		JSON.stringify(declaredDims),
	);
	harness.note(
		`census: ${runOneCardCount} HubReference cards (module counts: ` +
			`${JSON.stringify(hubCounts)}); ONE-TIME EMBEDDING SPEND on the first-ever ` +
			`vectorized run: ${runOneCardCount} card embedTexts (cache-served on every ` +
			`later run — see the embedding-client cache lines between the RUN 1 markers).`,
	);

	// release run 1's nodeEdges before run 2 forges — two vectored nodeEdges at once is the
	// memory hazard, and everything G-7/G-13 need from run 1 is now in compact facts
	runOneReport = null;

	forgeOnce(2, (runTwoError, runTwoReport) => {
		harness.section('FORGE RUN 2 — same inputs, cache-served');
		harness.ok('forge run 2 completes', !runTwoError, runTwoError);
		if (runTwoError) {
			harness.report();
			return;
		}
		const runTwoHash = canonicalNodeEdgesHash(runTwoReport.nodeEdges);
		const runTwoCardCount = collectCardVectorFacts(runTwoReport.nodeEdges).length;
		// ⟪P2-review S-3⟫ the twin's corrupted hash comes from the ACTUAL stream, not from
		// re-hashing the hash: inject a run-varying property into a REAL node of run 2's
		// nodeEdges and re-hash the same stream the gate measures. Computed HERE, before the
		// nodeEdges are released (holding them through the twin sweep would keep ~1GB alive).
		runTwoReport.nodeEdges.nodes[0].properties.__injectedRunVaryingValue = ['injected'];
		const perturbedRunTwoHash = canonicalNodeEdgesHash(runTwoReport.nodeEdges);
		delete runTwoReport.nodeEdges.nodes[0].properties.__injectedRunVaryingValue;
		runTwoReport = null;
		harness.ok(
			'S-3 twin material: a run-varying value in the REAL stream changes its canonical hash',
			perturbedRunTwoHash !== runTwoHash,
			'perturbed hash equals pristine hash',
		);

		harness.equal(
			'run 2 forged the same card population',
			runTwoCardCount,
			runOneCardCount,
		);

		// =============================================================================
		// the measurement bundle + twin registry (the Phase-1 pattern: corrupt a cloned
		// artifact, RE-RUN the same measure computer, watch the gate go red)
		// =============================================================================
		const measurements = {
			build: {
				declaredDims,
				cardVectorFacts,
				runOneHash,
				runTwoHash,
				perturbedRunTwoHash,
				vectorPresentViolations: computeVectorPresentViolations({
					cardVectorFacts,
					declaredDims,
				}),
				forgeDeterminismViolations: computeDeterminismViolations({
					runOneHash,
					runTwoHash,
				}),
			},
		};

		const twinRegistry = {
			dropOneVector: ({ measurements: pristine }) => {
				const corruptedFacts = pristine.build.cardVectorFacts;
				corruptedFacts[0].embeddingLength = 0;
				return {
					...pristine,
					build: {
						...pristine.build,
						vectorPresentViolations: computeVectorPresentViolations({
							cardVectorFacts: corruptedFacts,
							declaredDims: pristine.build.declaredDims,
						}),
					},
				};
			},
			injectRunVaryingValue: ({ measurements: pristine }) => {
				// ⟪P2-review S-3⟫ the corrupted hash is the one computed from the ACTUAL run-2
				// nodeEdges with a run-varying property injected into a real node (computed
				// above, before the stream was released) — the twin exercises the gate's real
				// measure end to end, not a re-hash of the hash.
				return {
					...pristine,
					build: {
						...pristine.build,
						forgeDeterminismViolations: computeDeterminismViolations({
							runOneHash: pristine.build.runOneHash,
							runTwoHash: pristine.build.perturbedRunTwoHash,
						}),
					},
				};
			},
		};

		// =============================================================================
		gatesLib.loadGateDeclarations({ filePath: DECLARATIONS_PATH }, (loadError, loadResult) => {
			harness.section('GATE DECLARATIONS — the build:-measured family-B gates');
			harness.ok('hubGates.jsonc loads', !loadError, loadError);
			if (loadError) {
				harness.report();
				return;
			}
			// THIS RUNNER JUDGES THE build:-MEASURED DECLARATIONS ONLY; the hub:-measured
			// card-local gates belong to test-cedsHubForge.js (see the note in hubGates.jsonc)
			const declarations = {
				...loadResult.declarations,
				gates: loadResult.declarations.gates.filter(
					(oneGate) => oneGate.measure.indexOf('build:') === 0,
				),
			};
			harness.equal(
				'two build-scoped gates declared (G-7 vectorPresent, G-13 determinism)',
				declarations.gates.length,
				2,
			);

			gatesLib.runTwins({ declarations, measurements, twinRegistry }, (twinError, twinResult) => {
				harness.section('THE TWIN SWEEP — each gate OBSERVED going RED under its own fault');
				harness.ok('the twin sweep runs', !twinError, twinError);
				if (twinError) {
					harness.report();
					return;
				}
				twinResult.twinReports.forEach((oneReport) => {
					harness.note(
						`${oneReport.gateId}: twin '${oneReport.twin}' injected -> ${oneReport.note}`,
					);
					harness.ok(
						`${oneReport.gateId}: twin '${oneReport.twin}' turned its gate RED`,
						oneReport.ran && oneReport.gateWentRed,
						oneReport.note,
					);
				});

				gatesLib.evaluateSuite(
					{ declarations, measurements, observedTwins: twinResult.observedTwins },
					(evaluateError, evaluateResult) => {
						harness.section('THE VERDICT — pristine measurements, twins observed');
						harness.ok('the suite evaluates', !evaluateError, evaluateError);
						if (evaluateError) {
							harness.report();
							return;
						}
						const suiteResult = evaluateResult.suiteResult;
						gatesLib.renderSuiteText(
							{ suiteResult, twinReports: twinResult.twinReports },
							(renderError, renderResult) => {
								if (!renderError) {
									xLog.result(renderResult.text);
								}
								harness.equal('zero FAIL', suiteResult.failed, 0);
								harness.equal('zero UNMEASURED', suiteResult.unmeasured, 0);
								harness.equal('zero UNPROVEN', suiteResult.unproven, 0);
								harness.ok(
									'VERDICT: ACCEPTED',
									suiteResult.accepted,
									JSON.stringify(suiteResult, null, 2).slice(0, 2000),
								);
								harness.note(
									`G-13 stream hashes: run 1 ${runOneHash} == run 2 ${runTwoHash}`,
								);
								harness.report();
							},
						);
					},
				);
			});
		});
	});
});
