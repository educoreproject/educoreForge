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
// wrote its summary, notRun with the runner's disposition when it did not. Since lane R (2026-10-05) it
// also supplies the FIDELITY row, which is the fidelity runner's own report: notRun when the gate was
// skipped (CEDS not in the graph), pass on a genuine pass, passWithAllowedLoss when the loss it found was
// allowed under --allowFidelityLoss. (From 2026-09-01 until then, FINDING 5-A: the runner could not say
// which, so no row was supplied and the fidelity row read notRun / verdictSupplied false on every build,
// even when the gate ran. A graph finished before lane R still reads that way: "not attested", never
// "did not run".) goldEvalCheck is unsupplied at materialize (a separate, later verb) and reads notRun
// until -stampPromotion records it. Every SUPPLIED verdict must be a word of
// vocabulary.BUILD_ATTESTATION_VERDICT_LIST; any other is refused by name, never recorded as given.
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
// ============================================================================================
// THE ROW SHAPE IS DECLARED (campaign P2, W-A-4; graph-contract §4 ATTESTATION_FIELD_LIST)
// ============================================================================================
// The expected gates are ATTESTATION_GATE_LIST_BY_CHANNEL.channelA, and a row's properties are the registry's: every
// row carries the 'all' fields; a channel-A field is copied from the supplied entry only for the gates its gateList names
// (the roundTrip totals, fidelity's inventedTotal, embeddingCoverage's missingVectorTotal), never invented for others.
// writtenOnChannel is the TOKEN 'channelA' (one of ATTESTATION_CHANNEL_LIST); the prose lives in writtenOnChannelNote.
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { SELF_DOC, ATTESTATION_FIELD_LIST, ATTESTATION_GATE_LIST_BY_CHANNEL, ATTESTATION_LABEL_SET_BY_CHANNEL } = vocabulary;
		const attestationPrefix = SELF_DOC.BUILD_ATTESTATION_STABLE_ID_PREFIX;

		const metadataRef = (oneStableId) => ({ source: null, id: oneStableId });

		// The gates this design EXPECTS to hear about. An expected gate with no supplied entry gets an
		// explicit notRun row — that is what makes an absence legible rather than silent. Declared as DATA in
		// graph-contract §4: adding a gate is a row there, not a change to any logic below.
		const CHANNEL_NAME = 'channelA';
		const EXPECTED_GATE_LIST = ATTESTATION_GATE_LIST_BY_CHANNEL[CHANNEL_NAME];
		const CHANNEL_LABEL_LIST = ATTESTATION_LABEL_SET_BY_CHANNEL[CHANNEL_NAME];
		const CHANNEL_NOTE = 'A — written by the build-attestation finisher at finish, from the verdicts the build handed it; a gate it expected and was not handed reads notRun with verdictSupplied false';
		// §4 declares detail on every row: an expected gate nobody supplied says so in words, never a null (R1, campaign P2)
		const UNSUPPLIED_DETAIL = 'no producer supplied a verdict for this gate in this materialize: this row is the expected-list default (notRun), not a measurement';
		// the channel-A detail fields (inventedTotal, the roundTrip totals, …), each copied only for the gates it names
		const CHANNEL_A_DETAIL_FIELD_LIST = ATTESTATION_FIELD_LIST.filter((oneRow) => oneRow.channel === CHANNEL_NAME);

		const VERDICT_NOT_RUN = vocabulary.BUILD_ATTESTATION_VERDICT.NOT_RUN;
		const VERDICT_LIST = vocabulary.BUILD_ATTESTATION_VERDICT_LIST;

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

			// a verdict outside the vocabulary cannot be read by any consumer; recording it as given would pass a typo
			// (or a retired word) into the graph as a verdict
			const unknownVerdictList = suppliedList.filter((oneEntry) => VERDICT_LIST.indexOf(oneEntry.verdict) === -1);
			if (unknownVerdictList.length) {
				callback(
					`build-attestation-finisher REFUSED: ${unknownVerdictList.map((oneEntry) => `gate '${oneEntry.gate}' verdict ${JSON.stringify(oneEntry.verdict)}`).join(', ')} ` +
						`is not one of ${VERDICT_LIST.join(', ')} (vocabulary.BUILD_ATTESTATION_VERDICT_LIST)`,
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
				// the declared detail fields this gate carries, copied as supplied (absent stays absent: SET += removes a null)
				const detailFieldByName = CHANNEL_A_DETAIL_FIELD_LIST.filter((oneRow) => oneRow.gateList.indexOf(oneGateName) !== -1).reduce(
					(soFar, oneRow) => (supplied && supplied[oneRow.name] !== undefined ? { ...soFar, [oneRow.name]: supplied[oneRow.name] } : soFar),
					{},
				);
				return {
					stableId,
					ref: metadataRef(stableId),
					labels: CHANNEL_LABEL_LIST.slice(),
					properties: {
						stableId,
						gate: oneGateName,
						// A MISSING ENTRY READS AS notRun, NEVER AS PASS.
						verdict: supplied ? supplied.verdict : VERDICT_NOT_RUN,
						detail: supplied && supplied.detail !== undefined ? supplied.detail : UNSUPPLIED_DETAIL,
						...detailFieldByName,
						// Whether this row came from a supplied verdict or from the expected-list default.
						// A consumer can then tell "the producer said notRun" from "the producer said nothing".
						verdictSupplied: !!supplied,
						expected: EXPECTED_GATE_LIST.indexOf(oneGateName) !== -1,
						writtenOnChannel: CHANNEL_NAME,
						writtenOnChannelNote: CHANNEL_NOTE,
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

		return { emit, EXPECTED_GATE_LIST, VERDICT_NOT_RUN, VERDICT_LIST, CHANNEL_A_DETAIL_FIELD_LIST };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
