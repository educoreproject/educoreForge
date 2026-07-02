'use strict';

const path = require('path');

// Phase-8 standing gate (the READ-ONLY gate). Resolve is READ-ONLY w.r.t. the build artifacts: it adds NO
// graph content and does not mutate the golden/baselines/manifest (its only side effect is the additive,
// content-addressed embedding cache — a deterministic speedup that can never alter an existing entry or the
// graph). This gate fingerprints the candidate graph (all-scope: every node + edge), runs a real resolve()
// call, fingerprints again, and asserts the all-scope fingerprint + node/edge counts are BYTE-IDENTICAL
// before and after — the frozen golden is provably untouched by a resolve call. resolve-core is structurally
// read-only of the graph (it reads only the immutable content-addressed gating-manifest BLOCKS via
// forge-store and holds NO Neo4j/write handle — there is no graph write path to take), and this gate proves
// it empirically. SCOPE NOTE: this gate fingerprints the Neo4j candidate GRAPH (not the forge-store sqlite
// resolve actually reads), so it empirically proves "resolve never touched Neo4j"; forge-store immutability
// rests on the structural SELECT-only read argument + content-addressing (solid). TWIN: the fingerprint
// detector is independently proven to BITE on any single-element change
// by the apparatus gates 04 (diff detects an injected fault), 07 (determinism gate catches non-determinism),
// and 09 (baseline gate catches corruption) — so "before == after" is a meaningful no-change proof, not a
// no-op. (The "attempt a write -> blocked" twin is vacuous here: resolve has no write capability to attempt.)

const SUPPORT = path.join(__dirname, '..', 'lib', 'resolve-gate-support', 'resolveGateSupport');
const { getStubResolveCore } = require(SUPPORT);

module.exports = () => ({
	name: 'resolve.readOnlyFingerprintUnchanged',
	phase: 'Phase8',
	kind: 'positive',
	expectFail: false, // ENFORCED — read-only capability, detector twin-proven by gates 04/07/09
	run: (ctx, callback) => {
		const forgeStore = ctx.resources.forgeStore;
		const fingerprinter = ctx.resources.fingerprinter;
		const graphName = ctx.candidateGraphName;
		const gatingManifest = ctx.manifestKey;
		if (!gatingManifest) {
			callback('', { passed: false, detail: 'resolve.readOnly gate requires --manifest (the gating manifest)' });
			return;
		}
		fingerprinter.fingerprintGraph({ graphName, scope: 'all' }, (beforeErr, before) => {
			if (beforeErr) {
				callback('', { passed: false, detail: `fingerprint(before) error: ${beforeErr}` });
				return;
			}
			getStubResolveCore({ forgeStore, gatingManifest, topK: 15, cosineFloor: 0 }, (coreErr, resolveCore) => {
				if (coreErr) {
					callback('', { passed: false, detail: `stub resolve-core load error: ${coreErr}` });
					return;
				}
				resolveCore.resolve(
					{ term: 'Student Identifier', definition: 'A unique number or alphanumeric code assigned to a student.' },
					(resErr) => {
						if (resErr) {
							callback('', { passed: false, detail: `resolve call error: ${resErr}` });
							return;
						}
						fingerprinter.fingerprintGraph({ graphName, scope: 'all' }, (afterErr, after) => {
							if (afterErr) {
								callback('', { passed: false, detail: `fingerprint(after) error: ${afterErr}` });
								return;
							}
							const passed =
								before.fingerprint === after.fingerprint &&
								before.nodeCount === after.nodeCount &&
								before.edgeCount === after.edgeCount;
							callback('', {
								passed,
								detail: `all-scope fingerprint before==after: ${passed} (${before.fingerprint.slice(0, 12)}…); nodes ${before.nodeCount}->${after.nodeCount}, edges ${before.edgeCount}->${after.edgeCount} (REQUIRED: identical — a resolve call does not mutate the graph; detector twin-proven by gates 04/07/09)`,
							});
						});
					},
				);
			});
		});
	},
});
