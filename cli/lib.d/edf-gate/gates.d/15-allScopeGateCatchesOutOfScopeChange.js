'use strict';

// Gate (twin for the all-scope gate; G3): prove the un-scoped (scope:'all') fingerprint CATCHES an
// out-of-old-scope change that the :ForgedNode-scoped fingerprint is structurally BLIND to — the exact
// blind spot the Phase-1 review surfaced. Done purely over the fingerprint machinery (no graph mutation,
// no DETACH DELETE): we model two scope-reads of one graph that contains a non-ForgedNode ("external")
// node, perturb that out-of-scope node, and assert the all-scope fingerprint changes while the
// :ForgedNode-scoped read (which never includes that node) cannot see the change.

module.exports = () => ({
	name: 'allScope.catchesOutOfScopeChange',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter;
		const opts = { ignoreOwnerStamp: false, ignoreEmbedding: false };
		const line = (rec) => fp.buildNodeLine(rec, opts);

		// one ordinary ForgedNode (in BOTH scope-reads) ...
		const forged = { stableId: 'fn1', labels: ['ForgedNode', 'user'], props: { p: '1' }, embeddingHash: null };
		// ... and one OUT-OF-OLD-SCOPE node: NOT :ForgedNode (the kind the scoped fingerprint never reads).
		const externalA = { stableId: 'ext1', labels: ['ExternalNonForgedNode'], props: { p: 'A' }, embeddingHash: null };
		const externalB = { stableId: 'ext1', labels: ['ExternalNonForgedNode'], props: { p: 'CHANGED' }, embeddingHash: null };

		// :ForgedNode-scoped read sees ONLY the forged node — identical regardless of the external node.
		const scopedRead = { nodes: [line(forged)], edges: [] };
		// all-scope read sees the forged node + the external node.
		const allReadA = { nodes: [line(forged), line(externalA)], edges: [] };
		const allReadB = { nodes: [line(forged), line(externalB)], edges: [] };

		const scopedFp = fp.fingerprintFromManifest(scopedRead, { scope: 'forgedNode' });
		const allFpA = fp.fingerprintFromManifest(allReadA, { scope: 'all' });
		const allFpB = fp.fingerprintFromManifest(allReadB, { scope: 'all' });

		// all-scope DETECTS the out-of-scope change; the scoped read is invariant to it (blind);
		// and all-scope content differs from the scoped content (it includes the external node).
		const allScopeDetectsChange = allFpA.fingerprint !== allFpB.fingerprint;
		const allScopeSeesMoreThanScoped = allFpA.fingerprint !== scopedFp.fingerprint;

		callback('', {
			passed: allScopeDetectsChange && allScopeSeesMoreThanScoped,
			detail:
				`allScopeDetectsOutOfScopeChange=${allScopeDetectsChange}, ` +
				`allScope!=scoped=${allScopeSeesMoreThanScoped} ` +
				`(scoped would stay GREEN on this change; all-scope goes RED — blind spot closed)`,
		});
	},
});
