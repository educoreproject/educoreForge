'use strict';

// Gate (twin / fault-injection): perturb ONE property on ONE node of a real graph's element manifest
// and assert the diff tool localizes EXACTLY that one change — one changed node, the injected property
// named, and nothing added/removed. This proves the apparatus DETECTS (a gate never seen failing is
// not proven). The perturbation is in-memory over the fingerprint manifest, so it is fast and touches
// no graph. (The heavier "corrupt one block → rebuild → determinism fails" variant is a follow-on.)

module.exports = () => ({
	name: 'diff.detectsInjectedFault',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const differ = ctx.resources.differ;
		fp.fingerprintGraph({ graphName: ctx.targetA }, (err, fingerprint) => {
			if (err) {
				callback('', { passed: false, detail: `fingerprint failed: ${err}` });
				return;
			}
			const original = fingerprint.elementManifest;
			if (!original.nodes.length) {
				callback('', { passed: false, detail: 'no nodes to perturb' });
				return;
			}
			// inject a single property onto the first node line
			const nodes = original.nodes.slice();
			const victim = JSON.parse(nodes[0]);
			const mutated = {
				...victim,
				props: { ...victim.props, __twinInjectedFault: 'PERTURBED' },
			};
			nodes[0] = JSON.stringify(mutated);
			const candidate = { nodes, edges: original.edges };

			const diff = differ.diffManifests({ baseline: original, candidate });
			const change = diff.nodes.changed[0];
			const passed =
				!diff.identical &&
				diff.summary.changedNodes === 1 &&
				diff.summary.addedNodes === 0 &&
				diff.summary.removedNodes === 0 &&
				diff.summary.addedEdges === 0 &&
				diff.summary.removedEdges === 0 &&
				!!change &&
				change.changedProps.indexOf('__twinInjectedFault') !== -1;
			callback('', {
				passed,
				detail: `changedNodes=${diff.summary.changedNodes}, props=${JSON.stringify(change && change.changedProps)}`,
			});
		});
	},
});
