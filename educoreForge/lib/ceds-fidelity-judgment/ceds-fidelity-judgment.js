'use strict';

// =====================================================================================
// ceds-fidelity-judgment — the DECISION that kills a build, separated from the I/O
// =====================================================================================
//
// ⟪TQ, 2026-08-02⟫ "Are you saying that there is one test that you have not been able to
// negate? How does making it a hermetic unit test work?"
//
// THE SEAM, AND WHY IT EXISTS. The R-1 gate used to do everything in one breath: resolve a
// container, read a graph over bolt, compile 19MB of RDF, diff it, then decide. That made
// the DECISION untestable without building a whole graph -- five minutes per attempt, and
// two attempts at the fault injection were killed by timeouts before finishing. A branch
// that expensive to exercise is a branch that never gets exercised.
//
// But the decision is arithmetic on four numbers. Split it:
//
//     gather  (I/O)   ->  headline { sourceStatements, matched, lost, invented }
//     judge   (pure)  ->  { passed, reason }
//
// Now a test hands `judge` numbers it invented -- 23,251 lost, or 4 invented, or 12 lost
// against an allowance of 11 -- and watches it refuse. Milliseconds, no Docker, and it keeps
// working forever after.
//
// This is the same seam the gate harness uses: JUDGING IS ARITHMETIC AND CAN BE PROVEN;
// MEASURING IS I/O AND CAN ONLY BE EXERCISED.
//
// WHAT THIS MODULE DOES NOT PROVE, said plainly: that the build actually CALLS it and
// actually exits nonzero. That is wiring, and wiring needs one real fault injection observed
// once. A hermetic test of a decision nobody invokes is a very tidy way to prove nothing.

const path = require('path');
const { BUILD_ATTESTATION_VERDICT } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const moduleName = path.basename(__filename).replace(/\.js$/, '');

// the gate name the fidelity BuildAttestation row carries (build-attestation-finisher EXPECTED_GATE_LIST)
const FIDELITY_GATE_NAME = 'fidelity';

const cedsFidelityJudgment = () => {
	// -----------------------------------------------------------------
	// resolveAllowance — read --allowFidelityLoss, or refuse it BY NAME
	// -----------------------------------------------------------------
	// THE ESCAPE HATCH MAKES YOU NAME THE NUMBER. It accepts up to n lost statements and
	// nothing else: any loss above n still fails. So it cannot be left switched on to absorb
	// a FUTURE regression -- it is a statement about one known gap, not a mute button. A plain
	// on/off skip is exactly the expectFail masking gate M-2 forbids and is not offered.
	const resolveAllowance = ({ rawValue } = {}) => {
		if (rawValue === undefined || rawValue === null) {
			return { allowedLoss: 0 };
		}
		const text = Array.isArray(rawValue) ? rawValue[0] : rawValue;
		if (text === undefined || text === null || String(text).trim() === '') {
			return {
				error:
					`${moduleName}: --allowFidelityLoss was given but blank. It must name the exact ` +
					`number of lost statements you are accepting. A blank is refused rather than read ` +
					`as zero or as "off".`,
			};
		}
		const allowedLoss = Number(text);
		if (!Number.isInteger(allowedLoss) || allowedLoss < 0) {
			return {
				error:
					`${moduleName}: --allowFidelityLoss must be a non-negative INTEGER naming the exact ` +
					`number of lost statements you are accepting, got '${text}'. It is not an on/off ` +
					`switch: a gate that can be silently disabled is not a gate.`,
			};
		}
		return { allowedLoss };
	};

	// -----------------------------------------------------------------
	// judgeFidelity — PURE. headline + allowance -> pass or a named refusal.
	// -----------------------------------------------------------------
	const judgeFidelity = ({ headline, allowedLoss, graphName } = {}) => {
		if (!headline || typeof headline.lost !== 'number' || typeof headline.invented !== 'number') {
			// A MISSING MEASUREMENT IS A FAILURE, never a pass. The whole apparatus exists to stop
			// a green reading that nobody actually took.
			return {
				passed: false,
				reason:
					`${moduleName}: no usable fidelity headline was supplied (lost/invented must both ` +
					`be numbers). REFUSED rather than passed: an unmeasured gate that reads green is ` +
					`the exact bug this gate exists to prevent.`,
			};
		}
		const allowance = typeof allowedLoss === 'number' ? allowedLoss : 0;

		// INVENTION IS NEVER ALLOWED, and no allowance covers it. A gap is a gap; a fabrication
		// is an assertion about CEDS that CEDS never made.
		if (headline.invented > 0) {
			return {
				passed: false,
				reason:
					`FIDELITY GATE FAILED -- the graph would assert ${headline.invented} statement(s) ` +
					`CEDS does NOT make. Invention is never permitted and --allowFidelityLoss does not ` +
					`cover it.`,
			};
		}
		if (headline.lost > allowance) {
			return {
				passed: false,
				reason:
					`FIDELITY GATE FAILED -- ${headline.lost} CEDS statement(s) do not round-trip` +
					(allowance
						? `, which exceeds the --allowFidelityLoss=${allowance} you named.`
						: `. Run 'graphBuilder -cedsRoundTrip${graphName ? ` --containerName=${graphName}` : ''}' ` +
							`for the per-predicate attribution, or name the gap you are accepting with ` +
							`--allowFidelityLoss=${headline.lost}.`),
			};
		}
		// ⟪lane R, 2026-10-05; FINDING 5-A⟫ WHICH pass this is, as an attestation verdict: a pass that USED the allowance
		// (lost > 0, within it) is passWithAllowedLoss and never plain pass; an allowance named but not needed is a plain
		// pass and says so. knowinglyIncomplete follows the same fact (it read allowance > 0 until 2026-10-05, which called
		// a zero-loss build incomplete).
		const lossWasAllowed = headline.lost > 0;
		return {
			passed: true,
			reason: lossWasAllowed
				? `PASSED under an EXPLICIT allowance of ${allowance} lost statement(s), ${headline.lost} lost -- this build ` +
					`is knowingly incomplete`
				: `PASSED -- zero lost, zero invented` + (allowance ? ` (the --allowFidelityLoss=${allowance} named was not needed)` : ''),
			knowinglyIncomplete: lossWasAllowed,
			attestationVerdict: lossWasAllowed ? BUILD_ATTESTATION_VERDICT.PASS_WITH_ALLOWED_LOSS : BUILD_ATTESTATION_VERDICT.PASS,
		};
	};

	// -----------------------------------------------------------------
	// THE FIDELITY ATTESTATION ROW — what the gate REPORTS, so the BuildAttestation row says which of its three success
	// states happened (lane R, 2026-10-05; FINDING 5-A of 2026-09-01: the runner's callback('') could not tell them apart,
	// and the row read notRun on every build, even when the gate ran).
	//   skippedAttestation  CEDS is not in this graph: the gate did not run           → notRun
	//   attestationFor      the gate ran and passed (judgeFidelity's verdict)          → pass | passWithAllowedLoss
	// A failing gate reports nothing: it fails the build. Pure.
	// -----------------------------------------------------------------
	const skippedAttestation = ({ standardTokens } = {}) => ({
		gate: FIDELITY_GATE_NAME,
		verdict: BUILD_ATTESTATION_VERDICT.NOT_RUN,
		detail:
			`skipped: CEDS is not among this build's standards (${JSON.stringify(standardTokens || [])}), so R-1 has nothing ` +
			`to round-trip`,
		inventedTotal: null,
	});
	const attestationFor = ({ verdict, headline } = {}) => {
		if (!verdict || verdict.passed !== true || !verdict.attestationVerdict || !headline) {
			return {
				error:
					`${moduleName}: attestationFor needs a PASSING judgeFidelity verdict and its headline (got ` +
					`${JSON.stringify({ passed: verdict && verdict.passed, attestationVerdict: verdict && verdict.attestationVerdict, headline: !!headline })}); ` +
					`a failed gate fails the build and attests nothing`,
			};
		}
		return {
			attestation: {
				gate: FIDELITY_GATE_NAME,
				verdict: verdict.attestationVerdict,
				detail:
					`${verdict.reason}; source ${headline.sourceStatements}, matched ${headline.matched}, ` +
					`lost ${headline.lost}, invented ${headline.invented}`,
				inventedTotal: headline.invented,
			},
		};
	};

	return { judgeFidelity, resolveAllowance, skippedAttestation, attestationFor, FIDELITY_GATE_NAME };
};

module.exports = cedsFidelityJudgment;
