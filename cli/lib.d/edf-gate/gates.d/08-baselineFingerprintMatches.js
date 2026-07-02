'use strict';

// Gate (positive): a live build's FINGERPRINT equals the frozen baseline.fingerprint — not merely its
// counts. gate 03 compares A vs B (and counts vs baseline), but an identical, count-preserving
// corruption applied to BOTH builds would have equal fingerprints AND matching counts, riding through
// GREEN. THIS gate closes that hole: it pins the candidate to the immutable baseline.fingerprint. It is
// the exact gate Phase 1 ('rebuild fingerprint-identical to baseline') leans on.
//
// Mode: the candidate is fingerprinted in the SAME mode the baseline was frozen in (baseline.meta
// .ignoreEmbedding), so the comparison is apples-to-apples regardless of the suite's run mode. Replay
// gates freeze + compare a FULL baseline; producer phases freeze + compare an EMBEDDING-EXCLUDED
// baseline (freeze with `-freezeBaseline -ignoreEmbedding`). The gate follows whatever the baseline is.

module.exports = () => ({
	name: 'baseline.fingerprintMatches',
	phase: 'Phase0',
	kind: 'positive',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const baselineStore = ctx.resources.baselineStore;
		const label = ctx.baselineLabel || 'golden';

		baselineStore.readBaseline({ label }, (err, baseline) => {
			if (err || !baseline || !baseline.meta || !baseline.meta.fingerprint) {
				callback('', {
					passed: false,
					detail: `no usable baseline '${label}': ${err || 'missing fingerprint'} (freeze one with -freezeBaseline)`,
				});
				return;
			}
			const baselineMode = !!baseline.meta.ignoreEmbedding;
			fp.fingerprintGraph(
				{ graphName: ctx.candidateGraphName, ignoreEmbedding: baselineMode },
				(fErr, live) => {
					if (fErr) {
						callback('', { passed: false, detail: `candidate fingerprint failed: ${fErr}` });
						return;
					}
					const matches = live.fingerprint === baseline.meta.fingerprint;
					const nonEmpty = live.nodeCount > 0;
					callback('', {
						passed: matches && nonEmpty,
						detail:
							`live=${live.fingerprint.slice(0, 12)}… baseline=${baseline.meta.fingerprint.slice(0, 12)}… ` +
							`match=${matches}, nonEmpty=${nonEmpty} (${live.nodeCount}n/${live.edgeCount}e), ` +
							`mode=${baselineMode ? 'embedding-excluded' : 'full'}`,
					});
				},
			);
		});
	},
});
