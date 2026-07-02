'use strict';

const fs = require('fs');

// Gate (health): an immutable baseline exists (N2) — its metadata + snapshot are present, carry a
// fingerprint, and are read-only on disk (no write bits). Health check of deliverable 5.

module.exports = () => ({
	name: 'baseline.frozenImmutable',
	phase: 'Phase0',
	kind: 'health',
	expectFail: false,
	run: (ctx, callback) => {
		const baselineStore = ctx.resources.baselineStore;
		const label = ctx.baselineLabel || 'golden';
		baselineStore.readBaseline({ label }, (err, baseline) => {
			if (err) {
				callback('', { passed: false, detail: `no baseline '${label}': ${err}` });
				return;
			}
			const metaFile = baselineStore.metaPathFor(label);
			const mode = fs.statSync(metaFile).mode & 0o777;
			const immutable = (mode & 0o222) === 0;
			const hasFingerprint = !!(baseline.meta && baseline.meta.fingerprint);
			callback('', {
				passed: hasFingerprint && immutable,
				detail: `fingerprint=${hasFingerprint ? baseline.meta.fingerprint.slice(0, 16) + '…' : 'MISSING'}, mode=0${mode.toString(8)}, immutable=${immutable}`,
			});
		});
	},
});
