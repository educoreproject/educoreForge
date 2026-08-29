'use strict';

// bridgeCollisionRule — THE PURE RULE behind build.js's pre-spend refusal (SPEC-phase7 §3.7, placement
// amended by RULING FJ-P7-1: build.js runs it BEFORE PHASE A, so a colliding recipe costs neither a
// forge nor a judge — which is why the refusal says 'before any forge or judge spend' rather than the
// narrower 'before any judge spend' it carried when the check sat at the head of phase C).
//
// WHY IT IS A MODULE RATHER THAN A CLOSURE INSIDE build.js. The rule needs red twins, and a twin that
// mutates a copy of a rule proves something about the copy. This campaign has extracted rules for
// exactly that reason before — genesisGuard.js, recordDisposition.js, batchWindowVerdict.js — and the
// reason holds here: build.js cannot be required from a suite without dragging a forger, a replay
// manager and a docker-backed graph behind it. The IMPURE half (calling bridgeMaker.describeBridge for
// each recipe entry) stays in build.js; this module receives what those calls returned and decides.
//
// WHAT THE RULE ANSWERS, AND WHAT IT DOES NOT. Two bridges compose ONE relationship subject when they
// agree on hub, source, producerKind AND subjectDiscriminator. It compares that four-term tuple and
// nothing else.
//
// IT DELIBERATELY DOES NOT COMPOSE SUBJECTS, and this is the design point rather than a shortcut. A
// subject carries the RESOLVED version of both endpoints, and versions are not resolved until phase A
// has forged or reused every base — which is precisely the spend this check exists to happen before.
// The tuple is the part knowable at declaration time, and two bridges agreeing on all four terms WILL
// compose one subject whatever the versions turn out to be, because every remaining term is shared.
// So the check is SOUND (it never refuses a recipe that would have composed distinct subjects) without
// being COMPLETE (it cannot see a collision that only a resolved version would create). The manifest
// editor's own duplicate-subject refusal remains the backstop for that, unchanged.
//
// @interface bridgeCollisionRule
//   collisionRefusalFor({ recipeName, describedBridgeList }) -> string
//     describedBridgeList: [{ bridgeName, hub, source, producerKind, subjectDiscriminator }]
//       subjectDiscriminator is JS `undefined` when the plugin declares none — NEVER null. The two are
//       kept distinct all the way to the comparison key below.
//     returns '' when no two entries share the tuple, otherwise a refusal naming EVERY colliding bridge,
//     quoting the shared tuple, and stating the remedy. Never throws; never substitutes.

const moduleName = 'bridgeCollisionRule';

// THE TUPLE AS DATA. A new term is one more entry in this list and nothing else — no comparison branch
// to edit, which is the difference between a registry and a switch (polyArch2 §7).
const COLLISION_TUPLE_TERM_LIST = Object.freeze(['hub', 'source', 'producerKind', 'subjectDiscriminator']);

// `undefined` and `null` must not compare equal here. JSON.stringify DROPS an undefined array member's
// identity by rendering it `null`, which would make "declared nothing" and "declared null" the same key —
// so undefined is mapped to a sentinel that no declared discriminator can equal (the vocabulary pattern
// admits only lower-case-initial alphanumerics, so a value carrying '<' is unreachable).
const ABSENT_TERM_SENTINEL = '<absent>';

const tupleTextFor = (oneDescribed) =>
	JSON.stringify(
		COLLISION_TUPLE_TERM_LIST.map((oneTermName) => (oneDescribed[oneTermName] === undefined ? ABSENT_TERM_SENTINEL : oneDescribed[oneTermName])),
	);

const collisionRefusalFor = ({ recipeName, describedBridgeList } = {}) => {
	if (!Array.isArray(describedBridgeList)) {
		// A caller that cannot supply the list has not run the describes; saying so by name beats returning
		// '' , which would read as "no collision" and let the spend proceed unchecked.
		return `${moduleName}: describedBridgeList is ${describedBridgeList === undefined ? 'absent' : `a ${typeof describedBridgeList}`} — the pre-spend check needs one described entry per MAPPING bridge in the recipe; it is never skipped silently.`;
	}
	const bridgeNameListByTupleText = {};
	describedBridgeList.forEach((oneDescribed) => {
		const tupleText = tupleTextFor(oneDescribed);
		bridgeNameListByTupleText[tupleText] = (bridgeNameListByTupleText[tupleText] || []).concat([oneDescribed.bridgeName]);
	});
	const collidingTupleTextList = Object.keys(bridgeNameListByTupleText).filter((oneTupleText) => bridgeNameListByTupleText[oneTupleText].length > 1);
	if (collidingTupleTextList.length === 0) {
		return '';
	}
	return (
		`recipe '${recipeName}' declares bridges that would compose ONE relationship subject, refused BEFORE ` +
		`any forge or judge spend: ` +
		collidingTupleTextList
			.map((oneTupleText) => `${bridgeNameListByTupleText[oneTupleText].join(' and ')} share (${COLLISION_TUPLE_TERM_LIST.join(', ')}) = ${oneTupleText}`)
			.join('; ') +
		`. Declare a distinct subjectDiscriminator on one of the bridges sharing this pair and producer, or ` +
		`remove one from the recipe. Nothing is substituted and no bridge is silently skipped.`
	);
};

module.exports = { collisionRefusalFor, COLLISION_TUPLE_TERM_LIST, ABSENT_TERM_SENTINEL, moduleName };
