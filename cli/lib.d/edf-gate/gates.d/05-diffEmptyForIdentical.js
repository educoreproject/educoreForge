'use strict';

// Gate (positive): the diff of a manifest against ITSELF is empty (baseline-vs-baseline = identical).
// The complement of the fault-injection twin — proves the diff reports nothing when there is nothing,
// so a non-empty diff is always real signal.

module.exports = () => ({
	name: 'diff.emptyForIdentical',
	phase: 'Phase0',
	kind: 'positive',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const differ = ctx.resources.differ;
		fp.fingerprintGraph({ graphName: ctx.targetA }, (err, fingerprint) => {
			if (err) {
				callback('', { passed: false, detail: `fingerprint failed: ${err}` });
				return;
			}
			const diff = differ.diffManifests({
				baseline: fingerprint.elementManifest,
				candidate: fingerprint.elementManifest,
			});
			callback('', {
				passed: diff.identical,
				detail: `identical=${diff.identical}, summary=${JSON.stringify(diff.summary)}`,
			});
		});
	},
});
