'use strict';

// Gate (twin / fault-injection): the PRESERVATION comparator must bite. A named/expected set of
// members present in a BASE must still be present after COMPOSITION. Over an in-memory fixture (a
// base of four blocks; composition adds two campaign blocks), first confirm EVERY base member
// survives composition (GREEN, expected defaults to the whole base); then DROP one base member from
// the composed set and assert the comparator reports preserved=false naming EXACTLY that missing
// member (RED). RED-then-GREEN in one gate — a gate never seen failing is not proven. In-memory;
// touches no store/graph/container. The fixture ids are illustrative only; the comparator
// (lib/manifest-preservation) is standard-agnostic and parameterized by (base, expected, composed).
//
// @concept: [[ManifestPreservation]]
// @concept: [[FaultInjectionTwin]]

module.exports = () => ({
	name: 'preservation.catchesDroppedMember',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const mp = ctx.resources.manifestPreservation;

		// fixture: a base manifest of four members; composition adds two campaign blocks
		const base = ['blk:alpha', 'blk:beta', 'blk:gamma', 'blk:delta'];
		const campaignAdditions = ['blk:campaignOne', 'blk:campaignTwo'];
		const composedGreen = base.concat(campaignAdditions);

		// GREEN: every base member (expected defaults to the whole base) present after composition
		const greenVerdict = mp.assertPreservation({ base, composed: composedGreen });

		// RED: drop ONE base member ('blk:gamma') from the composed set — a real preservation loss
		const composedRed = composedGreen.filter((oneId) => oneId !== 'blk:gamma');
		const redVerdict = mp.assertPreservation({ base, composed: composedRed });

		const green =
			greenVerdict.wellFormed &&
			greenVerdict.preserved &&
			greenVerdict.missing.length === 0;
		const red =
			redVerdict.preserved === false &&
			redVerdict.missing.length === 1 &&
			redVerdict.missing[0] === 'blk:gamma';

		callback('', {
			passed: green && red,
			detail:
				`GREEN(all ${base.length} base members survive)->preserved=${greenVerdict.preserved}; ` +
				`RED(drop blk:gamma)->preserved=${redVerdict.preserved},missing=${JSON.stringify(redVerdict.missing)}`,
		});
	},
});
