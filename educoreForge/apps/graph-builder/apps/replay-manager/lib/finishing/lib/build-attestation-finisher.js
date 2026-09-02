'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// build-attestation-finisher.js — registry member 5, mode 'emit' (graphSelfDoc Phase 3, 2026-08-31).
//
// One :BuildAttestation per gate: gate · verdict · detail · inventedTotal. The only genuinely NEW node type
// in the design. Gate verdicts previously lived only in log files and a work-order docket, which is why
// "the certifier enrichment was never run on an accepting manifest" was an open item NOBODY COULD CHECK
// FROM THE GRAPH.
//
// ============================================================================================
// IT IS A PURE CONSUMER. THAT IS A RULING, AND IT IS THE POINT.
// ============================================================================================
// RULING (GRANITE_ECHO 2026-08-31, disposition S1):
//   "The truth about what ran lives at the CALL SITE, not in the finisher — your finisher should not know
//    or care which generation it serves."
// This finisher RECORDS FAITHFULLY WHAT IT IS HANDED. It does not inspect the build, does not infer whether
// a gate ran, and does not reach for evidence outside its argument. The honesty burden belongs to the
// PRODUCER of gateResults, where the knowledge actually is — assembled in build.js under Phase 5 gate (f).
// A finisher that tried to work out for itself what had run would be guessing from a lane that cannot see.
//
// ============================================================================================
// notRun IS A FIRST-CLASS VERDICT, AND A MISSING ENTRY MUST NEVER READ AS PASS
// ============================================================================================
// A gate that did not run must be DISTINGUISHABLE from one that passed — that distinction is the entire
// content of the goldEvalCheck promotion gate, and it was unrepresentable in the graph before this node
// type existed. So an EXPECTED gate with no supplied entry gets an explicit `notRun` ROW: silence about a
// gate is indistinguishable from a gate that was never expected, and only a written row makes the absence
// legible. The alternative — emitting nothing — would let a consumer read "no attestation" as "nothing to
// report", which is the failure this node exists to prevent.
//
// MEASURED CAVEAT (S1, 2026-08-31), SINCE PARTLY REPAIRED. When this file was written nothing produced
// gateResults at all. The PRODUCER now exists (build.js materialize tail, "gateResults is ASSEMBLED
// HERE"): it supplies ONE row, roundTrip, read from the stage runner's own report — pass when the stage
// wrote its summary, notRun with the runner's disposition when it did not. It supplies NO fidelity row BY
// RULING (2026-09-01, FINDING 5-A): fidelityGateRunner's success callback is reachable from three states
// the call site cannot tell apart (skipped, genuine pass, loss allowed under --allowFidelityLoss), so a
// derived pass would be a guess. CONSEQUENCE A CONSUMER MUST KNOW: on every build the fidelity row reads
// verdict notRun / verdictSupplied false / expected true EVEN WHEN THE FIDELITY GATE RAN. Read it as
// "not attested", never as "did not run". goldEvalCheck is likewise unsupplied at materialize (a separate,
// later verb) and reads the same way. The gate below is still exactly right for a gate that genuinely
// did not run; the fidelity gap is the producer's, carried as FINDING 5-A for a separate order.
//
// ============================================================================================
// S2 — DETERMINISM. NO PIDs. NO TIMESTAMPS AS IDENTITY.
// ============================================================================================
// :BuildAttestation carries :ForgedNode and is therefore IN FINGERPRINT SCOPE: twin builds must produce
// identical bytes. So the stableId is derived from THE GATE NAME ALONE — never a pid, never a clock, never
// a run id. Nothing here reads Date.now() or process.pid, and the emitted order is sorted by gate name so
// two runs of the same verdicts emit in the same sequence. A timestamp belongs on the PASSPORT, which is
// excluded from fingerprints by construction; putting one here would silently make every build differ.
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { NODE_LABELS, SELF_DOC } = vocabulary;
		const forgedLabel = NODE_LABELS.FORGED_NODE;
		const attestationLabel = SELF_DOC.NODE_LABELS.BUILD_ATTESTATION;
		const attestationPrefix = SELF_DOC.BUILD_ATTESTATION_STABLE_ID_PREFIX;

		const metadataRef = (oneStableId) => ({ source: null, id: oneStableId });

		// The gates this design EXPECTS to hear about. An expected gate with no supplied entry gets an
		// explicit notRun row — that is what makes an absence legible rather than silent. Declared as DATA:
		// adding a gate is a row here, not a change to any logic below.
		const EXPECTED_GATE_LIST = ['fidelity', 'roundTrip', 'goldEvalCheck'];

		const VERDICT_NOT_RUN = 'notRun';

		// ----- emit — mode 'emit'. PURE CONSUMER: reads `gateResults` and nothing else.
		const emit = ({ gateResults } = {}, callback) => {
			// An ABSENT gateResults and an EMPTY one are the same input to this finisher, deliberately: both
			// mean "no verdicts were supplied", and both produce a full set of notRun rows. What they must
			// NEVER produce is silence, because silence reads as "nothing to report".
			const suppliedList = Array.isArray(gateResults) ? gateResults : [];

			const malformed = suppliedList.filter(
				(oneEntry) => !oneEntry || typeof oneEntry.gate !== 'string' || oneEntry.gate.trim() === '',
			);
			if (malformed.length) {
				callback(
					`build-attestation-finisher: ${malformed.length} supplied gateResults entr(ies) carry no ` +
						`'gate' name. An attestation whose subject cannot be named records nothing a consumer can ` +
						`act on, and guessing a name would attribute a verdict to a gate that did not give it.`,
				);
				return;
			}

			const suppliedByGate = suppliedList.reduce(
				(byGate, oneEntry) => ({ ...byGate, [oneEntry.gate]: oneEntry }),
				{},
			);

			// Every EXPECTED gate, plus any gate supplied that we did not expect — an unexpected verdict is
			// still a verdict and dropping it would be the same silence this node exists to abolish.
			const allGateNames = EXPECTED_GATE_LIST.concat(
				Object.keys(suppliedByGate).filter(
					(oneName) => EXPECTED_GATE_LIST.indexOf(oneName) === -1,
				),
			).sort(); // SORTED — S2 determinism: same verdicts emit in the same order every run.

			const nodes = allGateNames.map((oneGateName) => {
				const supplied = suppliedByGate[oneGateName];
				const stableId = `${attestationPrefix}${oneGateName}`; // gate name ALONE. No pid, no clock.
				return {
					stableId,
					ref: metadataRef(stableId),
					labels: [forgedLabel, attestationLabel],
					properties: {
						stableId,
						gate: oneGateName,
						// A MISSING ENTRY READS AS notRun, NEVER AS PASS.
						verdict: supplied ? supplied.verdict : VERDICT_NOT_RUN,
						detail: supplied && supplied.detail !== undefined ? supplied.detail : null,
						inventedTotal:
							supplied && supplied.inventedTotal !== undefined
								? Number(supplied.inventedTotal)
								: null,
						// Whether this row came from a supplied verdict or from the expected-list default.
						// A consumer can then tell "the producer said notRun" from "the producer said nothing".
						verdictSupplied: !!supplied,
						expected: EXPECTED_GATE_LIST.indexOf(oneGateName) !== -1,
					},
				};
			});

			const notRunCount = nodes.filter(
				(oneNode) => oneNode.properties.verdict === VERDICT_NOT_RUN,
			).length;
			const unsuppliedCount = nodes.filter((oneNode) => !oneNode.properties.verdictSupplied).length;

			callback('', {
				nodes,
				edges: [],
				summary:
					`build attestations: ${nodes.length} gate(s), ${notRunCount} notRun, ` +
					`${unsuppliedCount} with NO verdict supplied by the producer`,
				gateCount: nodes.length,
				notRunCount,
				unsuppliedCount,
			});
		};

		return { emit, EXPECTED_GATE_LIST, VERDICT_NOT_RUN };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
