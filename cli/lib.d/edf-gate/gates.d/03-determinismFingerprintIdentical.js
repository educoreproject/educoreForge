'use strict';

// Gate (positive, keystone): two independently-built isolated graphs of the same manifest have
// IDENTICAL fingerprints, are NON-EMPTY, and match the frozen baseline's node/edge counts. The
// non-empty + baseline-count checks close the "two empty (or two identically-wrong) graphs falsely
// report GREEN" hole. Honors ctx.ignoreEmbedding (producer-phase gates compare embedding-excluded;
// counts are mode-independent, so the baseline-count check holds in either mode).

module.exports = () => ({
	name: 'determinism.fingerprintIdentical',
	phase: 'Phase0',
	kind: 'positive',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const baselineStore = ctx.resources.baselineStore;
		const ignoreEmbedding = !!ctx.ignoreEmbedding;
		const baselineLabel = ctx.baselineLabel || 'golden';

		fp.fingerprintGraph({ graphName: ctx.targetA, ignoreEmbedding }, (errA, fpA) => {
			if (errA) {
				callback('', { passed: false, detail: `A '${ctx.targetA}' fingerprint failed: ${errA}` });
				return;
			}
			fp.fingerprintGraph({ graphName: ctx.targetB, ignoreEmbedding }, (errB, fpB) => {
				if (errB) {
					callback('', { passed: false, detail: `B '${ctx.targetB}' fingerprint failed: ${errB}` });
					return;
				}
				const identical = fpA.fingerprint === fpB.fingerprint;
				const nonEmpty = fpA.nodeCount > 0 && fpB.nodeCount > 0;

				// baseline-count check (mode-independent). If no baseline is frozen yet, skip with a note
				// rather than fail — the baseline.frozenImmutable gate owns baseline presence.
				baselineStore.readBaseline({ label: baselineLabel }, (baseErr, baseline) => {
					const haveBaseline = !baseErr && baseline && baseline.meta;
					const countMatchesBaseline = haveBaseline
						? fpA.nodeCount === baseline.meta.nodeCount &&
							fpA.edgeCount === baseline.meta.edgeCount
						: null;
					const passed =
						identical &&
						nonEmpty &&
						(countMatchesBaseline === null ? true : countMatchesBaseline);
					callback('', {
						passed,
						detail:
							`identical=${identical}, nonEmpty=${nonEmpty} (${fpA.nodeCount}n/${fpA.edgeCount}e), ` +
							`baselineCountMatch=${countMatchesBaseline === null ? 'no-baseline' : countMatchesBaseline}` +
							`${ignoreEmbedding ? ' [embedding-excluded]' : ''}`,
					});
				});
			});
		});
	},
});
