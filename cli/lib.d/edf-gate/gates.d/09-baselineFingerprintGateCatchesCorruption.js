'use strict';

// Gate (twin for baseline.fingerprintMatches; G3): the baseline-fingerprint gate MUST be observed
// going RED on a COUNT-PRESERVING corruption — the exact class of fault gate 03's count check cannot
// see. We read the frozen baseline's element manifest, mutate ONE node's property in place (no node or
// edge added/removed, so counts are unchanged), recompute the fingerprint, and assert:
//   1. recompute of the UNPERTURBED manifest reproduces baseline.fingerprint (the comparison is valid),
//   2. the perturbation is genuinely count-preserving (node/edge counts unchanged),
//   3. the recomputed fingerprint of the perturbed manifest DIFFERS from baseline.fingerprint.
// All three => the baseline-fingerprint gate catches what the count check misses. In-memory; no graph.

module.exports = () => ({
	name: 'baseline.fingerprintGateCatchesCountPreservingCorruption',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const baselineStore = ctx.resources.baselineStore;
		const label = ctx.baselineLabel || 'golden';

		baselineStore.readBaseline({ label }, (err, baseline) => {
			if (
				err ||
				!baseline ||
				!baseline.snapshot ||
				!baseline.snapshot.elementManifest ||
				!baseline.meta
			) {
				callback('', { passed: false, detail: `no usable baseline snapshot '${label}': ${err || 'missing'}` });
				return;
			}
			const mode = !!baseline.meta.ignoreEmbedding;
			const manifest = baseline.snapshot.elementManifest;
			if (!manifest.nodes.length) {
				callback('', { passed: false, detail: 'empty baseline manifest' });
				return;
			}

			// recompute the unperturbed baseline fingerprint — must reproduce baseline.meta.fingerprint
			const recomputed = fp.fingerprintFromManifest(manifest, { ignoreEmbedding: mode });
			const recomputeMatches = recomputed.fingerprint === baseline.meta.fingerprint;

			// count-preserving perturbation: change ONE node's property in place (no add/remove)
			const nodes = manifest.nodes.slice();
			const victim = JSON.parse(nodes[0]);
			nodes[0] = JSON.stringify({
				...victim,
				props: { ...victim.props, __countPreservingCorruption: 'X' },
			});
			const perturbedManifest = { nodes, edges: manifest.edges };
			const perturbed = fp.fingerprintFromManifest(perturbedManifest, { ignoreEmbedding: mode });

			const countPreserved =
				perturbed.nodeCount === recomputed.nodeCount &&
				perturbed.edgeCount === recomputed.edgeCount;
			const fingerprintDetects = perturbed.fingerprint !== baseline.meta.fingerprint;

			callback('', {
				passed: recomputeMatches && countPreserved && fingerprintDetects,
				detail:
					`recomputeMatchesBaseline=${recomputeMatches}, countPreserved=${countPreserved} ` +
					`(${perturbed.nodeCount}n/${perturbed.edgeCount}e), fingerprintDetectsCorruption=${fingerprintDetects}`,
			});
		});
	},
});
