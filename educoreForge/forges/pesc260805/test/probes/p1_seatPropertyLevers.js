'use strict';

// p1_seatPropertyLevers.js — LUNAR_PRISM (P1), 2026-08-17.
//
// THE RED LEVERS FOR THE RENDERING SEAT (ruled P1-R8). A gate never OBSERVED failing is unproven, and
// a mutation that does not compile proves nothing. Each lever below drives a REAL refusal or a REAL
// value change through the SHIPPED production module — nothing is stubbed, nothing is re-implemented
// here — and each reports BOTH the outcome AND THE ASSERTION COUNT REACHED beside it.
//
// THE ASSERTION-COUNT RULE, EARNED IN THIS ORDER AND NOT INHERITED AS ADVICE: P0b's lever 1 first
// reported "0 failures" and concluded the lever had not worked. The count was zero because the suite
// ABORTED at its first gate and emitted NO ASSERTIONS AT ALL. "0 failed" meant "nothing ran". So a
// failure count is not a measure of health unless the assertions REACHED is reported with it.
//
// Pure module under test: searchTextComposition.js requires only `path` and the shared composer, so
// this probe creates no container, opens no store and touches no graph.

const path = require('path');

const moduleName = 'p1_seatPropertyLevers';
const compositionLib = require(path.join(__dirname, '..', '..', 'lib', 'searchTextComposition'))();

const { seatPropertiesFor, SEAT_PROPERTY_REGISTRY } = compositionLib;

// ⚠️ A RECORDING refuse, NOT A THROWING ONE — and the difference is a polyArch2 correction I made to
// myself during this phase's self-audit. My first version passed a refuse() that THREW and then
// wrapped every call in try/catch to capture it: four try/catch blocks, used as CONTROL FLOW, in
// CLI-side code where that is a named violation.
//
// It was unnecessary the whole time. `refuse` is an INJECTED CALLBACK — the production module never
// decided how a refusal travels — so a refuse that RECORDS makes the throw disappear rather than
// making it catchable. The seam for explicit control flow was already there; I simply had not used it.
// Every call below now returns normally and the refusal is read out of `refusalLog`.
//
// AND THE LIMIT THAT CHANGE INTRODUCES, STATED RATHER THAN LEFT FOR A REVIEWER. A throwing refuse
// ABORTS the producer at the refusal; a recording one lets it RETURN. So these levers now assert THAT
// A REFUSAL IS RAISED AND WHAT IT SAYS — which is what they are for — and they NO LONGER exercise the
// abort. IN PRODUCTION the injected refuse is the module's own, which THROWS, so the abort is the
// CALLER's behaviour and not a property of seatPropertiesFor at all. That is why the trade is sound
// here and would not be sound if the producer's own correctness depended on stopping: it does not,
// because it computes the bag and then compares key sets, with no side effect in between.
const refusalLog = { message: null };
const recordingRefuse = (message) => {
	refusalLog.message = message;
};
const takeRefusal = () => {
	const taken = refusalLog.message;
	refusalLog.message = null;
	return taken;
};

const resultList = [];
let assertionsReached = 0;
let failedCount = 0;

const assert = ({ leverName, expectation, pass, detail }) => {
	assertionsReached += 1;
	if (!pass) {
		failedCount += 1;
	}
	resultList.push({ leverName, expectation, verdict: pass ? 'PASS' : 'FAIL', detail });
};

// -------------------------------------------------------------------------------------------------
// ACCEPT-CONTROL — the shipped configuration. If this is not green the levers below prove nothing,
// because a refusal that fires on EVERYTHING is not a guard, it is a broken module.
// -------------------------------------------------------------------------------------------------
const acceptControlElement = { name: 'ClassRankDate', owningClassName: 'AcademicSummaryFType', owningName: null };
const acceptControlBag = seatPropertiesFor({
	searchTextElement: acceptControlElement,
	effectiveDescription: 'The date on which class rank was determined.',
	proseSource: 'resolvedType',
	describedBy: 'accept-control',
	refuse: recordingRefuse,
});
const acceptControlError = takeRefusal();

assert({
	leverName: 'ACCEPT-CONTROL',
	expectation: 'the shipped producer returns all three seat properties and does NOT refuse',
	pass: acceptControlError === null && acceptControlBag !== null,
	detail: acceptControlError === null ? JSON.stringify(acceptControlBag) : `REFUSED: ${acceptControlError}`,
});

assert({
	leverName: 'ACCEPT-CONTROL',
	expectation: "owningTypeName is taken from owningClassName — the SAME expression the shared composer's first segment uses",
	pass: acceptControlBag !== null && acceptControlBag.owningTypeName === 'AcademicSummaryFType',
	detail: acceptControlBag === null ? 'no bag' : `owningTypeName='${acceptControlBag.owningTypeName}'`,
});

assert({
	leverName: 'ACCEPT-CONTROL',
	expectation: 'proseSource travels through verbatim so the census can report coverage BY SOURCE',
	pass: acceptControlBag !== null && acceptControlBag.proseSource === 'resolvedType',
	detail: acceptControlBag === null ? 'no bag' : `proseSource='${acceptControlBag.proseSource}'`,
});

// -------------------------------------------------------------------------------------------------
// LEVER 1 — REGISTRY/PRODUCER DRIFT. Add a name to the registry that the producer does not stamp.
// This is the drift that turns declared data back into undocumented code: a registry documenting a
// property nobody stamps. It must REFUSE BY NAME rather than return a short bag.
// -------------------------------------------------------------------------------------------------
SEAT_PROPERTY_REGISTRY.aPropertyNobodyStamps = { judgeVisible: false, valueSource: 'LEVER 1 — not produced anywhere', absentIs: 'n/a', why: 'planted by p1_seatPropertyLevers' };

seatPropertiesFor({
	searchTextElement: acceptControlElement,
	effectiveDescription: 'anything',
	proseSource: 'own',
	describedBy: 'lever 1',
	refuse: recordingRefuse,
});
const lever1Error = takeRefusal();

assert({
	leverName: 'LEVER 1 (registry names a property the producer does not stamp)',
	expectation: 'REFUSES BY NAME, naming both key sets so the drift is legible rather than merely reported',
	pass:
		lever1Error !== null &&
		lever1Error.indexOf('aPropertyNobodyStamps') !== -1 &&
		lever1Error.indexOf('SEAT_PROPERTY_REGISTRY') !== -1,
	detail: lever1Error === null ? 'DID NOT REFUSE — the guard is not reachable' : lever1Error,
});

delete SEAT_PROPERTY_REGISTRY.aPropertyNobodyStamps;

// RESTORE PROVEN, NOT ASSUMED. P0b verified its production restore by sha256 at three points; this
// probe mutates only an in-memory object, so the equivalent proof is that the accept-control passes
// AGAIN after the mutation is undone.
seatPropertiesFor({
	searchTextElement: acceptControlElement,
	effectiveDescription: 'The date on which class rank was determined.',
	proseSource: 'resolvedType',
	describedBy: 'restore-control',
	refuse: recordingRefuse,
});
const restoreError = takeRefusal();

assert({
	leverName: 'RESTORE-CONTROL',
	expectation: 'with the planted registry entry removed the producer is green again — the lever was the cause, not a coincidence',
	pass: restoreError === null,
	detail: restoreError === null ? 'green after restore' : `STILL REFUSING: ${restoreError}`,
});

// -------------------------------------------------------------------------------------------------
// LEVER 2 — ABSENT OWNING CONTEXT. A top-level declaration has neither owningClassName nor owningName.
// The seat must yield '' so the renderer OMITS the line, never the string 'undefined' or 'null'.
// "Absent is absent, never ''-rendered" is the Profile convention this order inherited; the failure
// it prevents is a judge reading the word "undefined" as though PESC had written it.
// -------------------------------------------------------------------------------------------------
const lever2Bag = seatPropertiesFor({
	searchTextElement: { name: 'TopLevelThing', owningClassName: null, owningName: null },
	effectiveDescription: '',
	proseSource: 'none',
	describedBy: 'lever 2',
	refuse: recordingRefuse,
});
const lever2Error = takeRefusal();

assert({
	leverName: 'LEVER 2 (no owning context, no prose)',
	expectation: "both judge-visible seats are EXACTLY '' — never the literal 'undefined' or 'null' reaching a prompt",
	pass:
		lever2Error === null &&
		lever2Bag !== null &&
		lever2Bag.owningTypeName === '' &&
		lever2Bag.effectiveDescription === '',
	detail: lever2Error !== null ? `REFUSED: ${lever2Error}` : JSON.stringify(lever2Bag),
});

// -------------------------------------------------------------------------------------------------
// REPORT — failure count AND assertions reached, together, always.
// -------------------------------------------------------------------------------------------------
process.stdout.write(
	`${JSON.stringify(
		{
			probe: moduleName,
			assertionsReached,
			failedCount,
			verdict: assertionsReached === 0 ? 'VACUOUS — NOTHING RAN' : failedCount === 0 ? 'ALL GREEN' : 'RED',
			note: 'A failure count without the assertion count reached cannot distinguish a clean pass from a suite that aborted before asserting anything.',
			resultList,
		},
		null,
		2,
	)}\n`,
);
process.exitCode = failedCount === 0 && assertionsReached > 0 ? 0 : 1;
