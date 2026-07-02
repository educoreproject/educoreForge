'use strict';

// Gate (twin for the determinism gate; G3): the determinism check MUST be observed going RED on
// injected non-determinism — a gate never seen failing is not proven. We fingerprint a real built
// graph, then INJECT a single non-deterministic perturbation into a copy of its element manifest and
// recompute the fingerprint purely (fingerprintFromManifest). The determinism comparison (fingerprint
// equality, the exact check gate 03 uses) MUST report the two as DIFFERENT, and the diff MUST be
// non-empty. Passing this twin = "if a second build had differed, gate 03 would catch it."
//
// This is the determinism-gate analogue of diff.detectsInjectedFault: it exercises the RED path of the
// equality assertion itself, in-memory, touching no graph.

module.exports = () => ({
	name: 'determinism.gateCatchesNonDeterminism',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const differ = ctx.resources.differ;
		const ignoreEmbedding = !!ctx.ignoreEmbedding;

		fp.fingerprintGraph({ graphName: ctx.targetA, ignoreEmbedding }, (err, fingerprint) => {
			if (err) {
				callback('', { passed: false, detail: `fingerprint failed: ${err}` });
				return;
			}
			if (!fingerprint.elementManifest.nodes.length) {
				callback('', { passed: false, detail: 'no nodes to perturb' });
				return;
			}

			// inject one non-deterministic perturbation: mutate a property on the first node line
			const nodes = fingerprint.elementManifest.nodes.slice();
			const victim = JSON.parse(nodes[0]);
			const mutated = {
				...victim,
				props: { ...victim.props, __injectedNonDeterminism: 'PERTURBED' },
			};
			nodes[0] = JSON.stringify(mutated);
			const perturbedManifest = { nodes, edges: fingerprint.elementManifest.edges };

			// recompute the fingerprint over the perturbed manifest using the SAME flags, so the only
			// difference is the injected perturbation.
			const perturbed = fp.fingerprintFromManifest(perturbedManifest, { ignoreEmbedding });

			// the determinism comparison gate 03 uses is fingerprint equality. It MUST detect the diff.
			const equalityWouldDetect = perturbed.fingerprint !== fingerprint.fingerprint;
			const diff = differ.diffManifests({
				baseline: fingerprint.elementManifest,
				candidate: perturbedManifest,
			});
			const diffSeesIt = !diff.identical && diff.summary.changedNodes === 1;

			callback('', {
				passed: equalityWouldDetect && diffSeesIt,
				detail: `fingerprintEqualityDetectsDelta=${equalityWouldDetect}, diffChangedNodes=${diff.summary.changedNodes} (original ${fingerprint.fingerprint.slice(0, 12)}… vs perturbed ${perturbed.fingerprint.slice(0, 12)}…)`,
			});
		});
	},
});
