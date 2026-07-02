'use strict';

// Gate (positive, integration — closes the :ForgedNode-scope blind spot): a live build's UN-SCOPED
// whole-graph fingerprint (ALL nodes + ALL edges, excluding only the non-deterministic :GraphProvenance
// passport, embeddings INCLUDED) equals the frozen goldenAll all-scope baseline. The default suite gates
// (03/08) are :ForgedNode-scoped and cannot see a non-ForgedNode node or an edge to a non-ForgedNode
// endpoint; THIS gate sees everything, so a change to out-of-old-scope content turns it RED. (Voyage is
// byte-deterministic, so embeddings-included all-scope is a trustworthy gate.)

module.exports = () => ({
	name: 'baseline.allScopeFingerprintMatches',
	phase: 'Phase0',
	kind: 'positive',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const baselineStore = ctx.resources.baselineStore;
		const label = ctx.allScopeBaselineLabel || 'goldenAll';

		baselineStore.readBaseline({ label }, (err, baseline) => {
			if (err || !baseline || !baseline.meta || !baseline.meta.fingerprint) {
				callback('', {
					passed: false,
					detail: `no usable all-scope baseline '${label}': ${err || 'missing'} (freeze with -freezeBaseline -allScope)`,
				});
				return;
			}
			const scope = baseline.meta.scope || 'all';
			const ignoreEmbedding = !!baseline.meta.ignoreEmbedding;
			fp.fingerprintGraph(
				{ graphName: ctx.candidateGraphName, scope, ignoreEmbedding },
				(fErr, live) => {
					if (fErr) {
						callback('', { passed: false, detail: `candidate all-scope fingerprint failed: ${fErr}` });
						return;
					}
					const matches = live.fingerprint === baseline.meta.fingerprint;
					callback('', {
						passed: matches && live.nodeCount > 0,
						detail:
							`live=${live.fingerprint.slice(0, 12)}… baseline=${baseline.meta.fingerprint.slice(0, 12)}… ` +
							`match=${matches} (${live.nodeCount}n/${live.edgeCount}e), scope=${scope}`,
					});
				},
			);
		});
	},
});
