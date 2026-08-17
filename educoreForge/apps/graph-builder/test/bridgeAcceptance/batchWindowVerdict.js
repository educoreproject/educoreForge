'use strict';

// batchWindowVerdict.js — WHICH WINDOW A BATCH DOCUMENT IS ENTITLED TO CLAIM, as a PURE function
// (SABLE_RIVER's STAND-DOWN-B4 disposition (b), 2026-08-17 04:45 CDT, ratified as code 2026-08-17 under B4R-3).
//
// Extracted rather than left inline for the reason BS-13 gave when it extracted recordDisposition.js:
// batchCheckpoint.js is a CLI that RUNS ON REQUIRE, so a suite requiring it would write a document. Here the
// generator and the twins call the SAME function, and a twin going red proves the generator's own behaviour
// instead of a parallel copy of the rule.
//
// ⟪THE DEFECT ITS AUTHOR FOUND IN IT, WHICH IS WHY THIS IS AN AMENDMENT AND NOT A LOOSENING⟫
// TWILIGHT_VALLEY built the three-source window check under BS-12 — block header, runner's per-bridge released
// row, and the caller's --batchSize — and then raised the flaw in its own instrument rather than weakening it:
//
//     "The three-source window check makes every superseded batch document permanently NOT CLEAN, because
//      nothing on disk records which window was released when a block was frozen."
//
// Concretely: batch-0 ran at limit 10 and was clean. BS-9 then released 70. batch-0 became UNCLEAN retroactively
// — not because anything about it changed, but because a number in a file it has no relationship with did. A
// document's cleanliness must not be a function of a value that can move after the document was written.
//
// RULED: "clean" for a superseded document means THE WINDOW IN FORCE WHEN THE BLOCK WAS FROZEN. The BLOCK HEADER
// is the authority for a DOCUMENT. The runner's per-bridge row governs FUTURE LAUNCHES ONLY.
//
// SO THE FALSIFIABLE CLAIM IS: does the CALLER describe the window THIS BLOCK ACTUALLY RAN? That is the case
// worth catching, because it is the one that would let a document assert a window its block never ran. The
// runner's released size is still READ and still REPORTED — as context, named SUPERSEDED when it differs, which
// is a fact about release history rather than a defect. Nothing that used to fail for a real reason now passes:
// caller-disagrees-with-block still fails, and that inequality is where the row always did its work.

const moduleName = 'batchWindowVerdict';

const SUPERSEDED_LABEL = 'SUPERSEDED WINDOW';

// batchWindowVerdictFor — { pass, superseded, detail }.
//   blockWindowLimit    — the limit PARSED from the block header's own sourceWindow (what actually ran)
//   callerWindowLimit   — --batchSize (what the caller believes it is documenting)
//   releasedWindowLimit — the runner's per-bridge row (what the supervisor released, for FUTURE launches)
// All three are passed IN so the rule is pure and a twin can state the world it is testing.
const batchWindowVerdictFor = ({ blockWindowLimit, callerWindowLimit, releasedWindowLimit } = {}) => {
	const notAnInteger = [['blockWindowLimit', blockWindowLimit], ['callerWindowLimit', callerWindowLimit], ['releasedWindowLimit', releasedWindowLimit]].filter(([, oneValue]) => !Number.isInteger(oneValue) || oneValue <= 0);
	if (notAnInteger.length) {
		return { pass: false, superseded: false, detail: `${moduleName} needs a positive integer for ${notAnInteger.map(([oneName]) => oneName).join(', ')} — a window nobody can state is not a window this document may claim` };
	}
	// THE CLAIM: the caller describes the window the block actually ran.
	if (blockWindowLimit !== callerWindowLimit) {
		return { pass: false, superseded: false, detail: `block header ${blockWindowLimit} · --batchSize ${callerWindowLimit} · runner released ${releasedWindowLimit} — CALLER DISAGREES WITH THE BLOCK: --batchSize does not describe the window this block actually ran, so the document would claim a window its block never ran` };
	}
	// CONTEXT: the released window may have moved on. That is history, not a defect.
	if (blockWindowLimit !== releasedWindowLimit) {
		return { pass: true, superseded: true, detail: `block header ${blockWindowLimit} · --batchSize ${callerWindowLimit} · runner released ${releasedWindowLimit} — ${SUPERSEDED_LABEL}, and CLEAN as ruled: this block ran at ${blockWindowLimit}, which was the released window WHEN IT WAS FROZEN; the supervisor has since released ${releasedWindowLimit}, which governs FUTURE launches only (SABLE_RIVER stand-down disposition (b), 2026-08-17). The block header is the authority for a document; a later release cannot make an already-frozen document unclean` };
	}
	return { pass: true, superseded: false, detail: `block header ${blockWindowLimit} · --batchSize ${callerWindowLimit} · runner released ${releasedWindowLimit} — the block ran at the currently-released window` };
};

module.exports = { batchWindowVerdictFor, SUPERSEDED_LABEL, moduleName };
