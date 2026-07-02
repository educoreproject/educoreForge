'use strict';

// Gate: the production guard REFUSES a golden build target and ALLOWS an isolated scratch target.
// This is both a health check of deliverable 1 and the production-guard fault-injection twin — a
// deliberate attempt to build into the production golden MUST be refused (N1).

module.exports = () => ({
	name: 'productionGuard.refusesGolden',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const guard = ctx.resources.productionGuard;
		guard.assertSafeBuildTarget({ graphName: 'golden' }, (errGolden) => {
			const refusedGolden = !!errGolden && /REFUSED/i.test(`${errGolden}`);
			guard.assertSafeBuildTarget({ graphName: ctx.targetA }, (errScratch) => {
				const allowedScratch = !errScratch;
				callback('', {
					passed: refusedGolden && allowedScratch,
					detail: `golden refused=${refusedGolden}, '${ctx.targetA}' allowed=${allowedScratch}`,
				});
			});
		});
	},
});
