'use strict';

// Gate (twin / fault-injection): the DELTA-CLOSURE comparator must bite. The composed manifest's
// closure violations must equal EXACTLY the base's known set — zero NEW violations. Over an in-memory
// fixture (a base carrying two KNOWN legacy closure violations), first confirm composition carrying
// the same known debt forward is clean (GREEN, zero new, zero healed); then INJECT one NEW violation
// absent from the base's known set and assert the comparator flags it (clean=false, exactly one
// newViolation named) (RED). RED-then-GREEN in one gate — a gate never seen failing is not proven.
// In-memory; touches no store/graph/container. The fixture ids are illustrative only; the comparator
// (lib/closure-delta) is standard-agnostic and parameterized by (baseViolations, composedViolations).
//
// @concept: [[DeltaClosure]]
// @concept: [[FaultInjectionTwin]]

module.exports = () => ({
	name: 'closure.catchesNewViolation',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const cd = ctx.resources.closureDelta;

		// fixture: the base carries two KNOWN legacy closure violations (pre-existing debt)
		const baseViolations = [
			{ blockId: 'blk:legacyOne', requiredBlockId: 'blk:missingCarrierA' },
			{ blockId: 'blk:legacyTwo', requiredBlockId: 'blk:missingCarrierB' },
		];

		// GREEN: composition carries the SAME known debt forward, introduces none
		const composedGreen = baseViolations.slice();
		const greenVerdict = cd.assertDeltaClosure({
			baseViolations,
			composedViolations: composedGreen,
		});

		// RED: composition introduces ONE NEW violation absent from the base's known set
		const composedRed = baseViolations.concat([
			{ blockId: 'blk:campaignOne', requiredBlockId: 'blk:missingCarrierC' },
		]);
		const redVerdict = cd.assertDeltaClosure({
			baseViolations,
			composedViolations: composedRed,
		});

		const green =
			greenVerdict.clean &&
			greenVerdict.noNewViolations &&
			greenVerdict.newViolations.length === 0 &&
			greenVerdict.healedViolations.length === 0;
		const red =
			redVerdict.clean === false &&
			redVerdict.newViolations.length === 1 &&
			redVerdict.newViolations[0] === 'blk:campaignOne>blk:missingCarrierC' &&
			redVerdict.healedViolations.length === 0;

		callback('', {
			passed: green && red,
			detail:
				`GREEN(composed==base, ${greenVerdict.baseCount} known)->clean=${greenVerdict.clean}; ` +
				`RED(+1 new violation)->clean=${redVerdict.clean},new=${JSON.stringify(redVerdict.newViolations)}`,
		});
	},
});
