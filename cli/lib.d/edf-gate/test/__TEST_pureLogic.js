'use strict';

// __TEST_pureLogic.js — unit tests for the PURE layers of the proving apparatus (no Neo4j, no docker):
// graphFingerprint canonicalization/order-independence + graphDiff partitioning. Run: node this file.
// Exits non-zero on any failure. Mirrors the codebase's check()/GREEN-RED test idiom.

const path = require('path');

// the fingerprint factory reads process.global.xLog at construction; provide a quiet stub.
process.global = {
	xLog: {
		status: () => {},
		error: (...a) => console.error(...a),
		result: () => {},
		verbose: () => {},
	},
};

const fingerprinter = require('../lib/graph-fingerprint/graphFingerprint')({
	lifecycle: { runCypher: () => {} },
});
const differ = require('../lib/graph-diff/graphDiff')();

let passed = 0;
let failed = 0;
const check = (label, condition) => {
	if (condition) {
		passed++;
		console.log(`  PASS  ${label}`);
	} else {
		failed++;
		console.log(`  FAIL  ${label}`);
	}
};

// --- normalizeValue: neo4j-integer-like -> decimal string ---
const fakeInt = { low: 42, high: 0, toString: () => '42' };
check('normalizeValue narrows neo4j integer to string', fingerprinter.normalizeValue(fakeInt) === '42');
check('normalizeValue passes through a plain string', fingerprinter.normalizeValue('x') === 'x');
check(
	'normalizeValue recurses + sorts object keys',
	JSON.stringify(fingerprinter.normalizeValue({ b: 1, a: 2 })) === JSON.stringify({ a: 2, b: 1 }),
);

// --- order-independent hash: same lines, different order -> same hash ---
const h1 = fingerprinter.hashLinesOrderIndependent(['c', 'a', 'b']);
const h2 = fingerprinter.hashLinesOrderIndependent(['b', 'c', 'a']);
check('hashLinesOrderIndependent is order-independent', h1.hash === h2.hash);
check('hashLinesOrderIndependent differs on different content', h1.hash !== fingerprinter.hashLinesOrderIndependent(['a', 'b']).hash);

// --- buildNodeLine: sorts labels, drops embedding, keeps embeddingHash, drops ForgedNode label ---
const nodeLine = fingerprinter.buildNodeLine(
	{
		stableId: 'n1',
		labels: ['ForgedNode', 'user', 'Zeta', 'Alpha'],
		props: { embedding: [1, 2, 3], beta: '2', alpha: '1' },
		embeddingHash: 'EMB',
	},
	{ ignoreOwnerStamp: false },
);
const nodeObj = JSON.parse(nodeLine);
check('buildNodeLine drops ForgedNode label', nodeObj.labels.indexOf('ForgedNode') === -1);
check('buildNodeLine sorts labels', JSON.stringify(nodeObj.labels) === JSON.stringify(['Alpha', 'Zeta', 'user']));
check('buildNodeLine drops embedding property', nodeObj.props.embedding === undefined);
check('buildNodeLine sorts property keys', JSON.stringify(Object.keys(nodeObj.props)) === JSON.stringify(['alpha', 'beta']));
check('buildNodeLine keeps embeddingHash', nodeObj.embeddingHash === 'EMB');

// --- buildNodeLine ignoreOwnerStamp strips owner label ---
const nodeLineNoOwner = fingerprinter.buildNodeLine(
	{ stableId: 'n1', labels: ['ForgedNode', 'user', 'Alpha'], props: {}, embeddingHash: null },
	{ ignoreOwnerStamp: true },
);
check('buildNodeLine ignoreOwnerStamp strips owner label', JSON.parse(nodeLineNoOwner).labels.indexOf('user') === -1);

// --- diff: identical manifests ---
const manifestA = {
	nodes: [
		fingerprinter.buildNodeLine({ stableId: 'n1', labels: ['A'], props: { p: '1' }, embeddingHash: null }, { ignoreOwnerStamp: false }),
		fingerprinter.buildNodeLine({ stableId: 'n2', labels: ['B'], props: { p: '2' }, embeddingHash: null }, { ignoreOwnerStamp: false }),
	].sort(),
	edges: [
		fingerprinter.buildEdgeLine({ fromId: 'n1', toId: 'n2', type: 'REL', props: {} }, { ignoreOwnerStamp: false }),
	].sort(),
};
const diffSame = differ.diffManifests({ baseline: manifestA, candidate: manifestA });
check('diff of identical manifests is identical', diffSame.identical === true);

// --- diff: one changed property ---
const manifestB = {
	nodes: [
		fingerprinter.buildNodeLine({ stableId: 'n1', labels: ['A'], props: { p: 'CHANGED' }, embeddingHash: null }, { ignoreOwnerStamp: false }),
		fingerprinter.buildNodeLine({ stableId: 'n2', labels: ['B'], props: { p: '2' }, embeddingHash: null }, { ignoreOwnerStamp: false }),
	].sort(),
	edges: manifestA.edges,
};
const diffChanged = differ.diffManifests({ baseline: manifestA, candidate: manifestB });
check('diff detects exactly one changed node', diffChanged.summary.changedNodes === 1 && diffChanged.summary.addedNodes === 0 && diffChanged.summary.removedNodes === 0);
check('diff names the changed property', diffChanged.nodes.changed[0] && diffChanged.nodes.changed[0].changedProps.indexOf('p') !== -1);

// --- diff: added + removed node ---
const manifestC = {
	nodes: [
		fingerprinter.buildNodeLine({ stableId: 'n1', labels: ['A'], props: { p: '1' }, embeddingHash: null }, { ignoreOwnerStamp: false }),
		fingerprinter.buildNodeLine({ stableId: 'n3', labels: ['C'], props: {}, embeddingHash: null }, { ignoreOwnerStamp: false }),
	].sort(),
	edges: [],
};
const diffAddRemove = differ.diffManifests({ baseline: manifestA, candidate: manifestC });
check('diff detects removed node (n2)', diffAddRemove.nodes.removed.indexOf('n2') !== -1);
check('diff detects added node (n3)', diffAddRemove.nodes.added.indexOf('n3') !== -1);
check('diff detects removed edge', diffAddRemove.summary.removedEdges === 1);

// --- ignoreEmbedding mode: embeddingHash dropped from the node line ---
const nodeFull = fingerprinter.buildNodeLine(
	{ stableId: 'n1', labels: ['A'], props: {}, embeddingHash: 'EMB' },
	{ ignoreOwnerStamp: false, ignoreEmbedding: false },
);
const nodeNoEmb = fingerprinter.buildNodeLine(
	{ stableId: 'n1', labels: ['A'], props: {}, embeddingHash: 'EMB' },
	{ ignoreOwnerStamp: false, ignoreEmbedding: true },
);
check('ignoreEmbedding drops embeddingHash from the node line', JSON.parse(nodeNoEmb).embeddingHash === null);
check('full mode keeps embeddingHash', JSON.parse(nodeFull).embeddingHash === 'EMB');

// --- combineFingerprint: default (full) salt is byte-stable; ignoreEmbedding=true differs ---
const lines = { nodeLines: [nodeFull], edgeLines: [] };
const fpFull = fingerprinter.combineFingerprint({ ...lines, ignoreOwnerStamp: false, ignoreEmbedding: false });
const fpFull2 = fingerprinter.combineFingerprint({ ...lines, ignoreOwnerStamp: false, ignoreEmbedding: false });
const fpExcl = fingerprinter.combineFingerprint({ nodeLines: [nodeNoEmb], edgeLines: [], ignoreOwnerStamp: false, ignoreEmbedding: true });
check('combineFingerprint is stable for identical input', fpFull.fingerprint === fpFull2.fingerprint);
check('ignoreEmbedding mode yields a different fingerprint than full', fpFull.fingerprint !== fpExcl.fingerprint);

// --- fingerprintFromManifest reproduces a fingerprint from an element manifest ---
const rebuilt = fingerprinter.fingerprintFromManifest(fpFull.elementManifest, { ignoreOwnerStamp: false, ignoreEmbedding: false });
check('fingerprintFromManifest reproduces the fingerprint', rebuilt.fingerprint === fpFull.fingerprint);

// --- determinism twin logic: perturbing a manifest changes the fingerprint ---
const perturbedNodes = fpFull.elementManifest.nodes.slice();
const v = JSON.parse(perturbedNodes[0]);
perturbedNodes[0] = JSON.stringify({ ...v, props: { ...v.props, __x: 'PERTURBED' } });
const perturbedFp = fingerprinter.fingerprintFromManifest({ nodes: perturbedNodes, edges: fpFull.elementManifest.edges }, { ignoreOwnerStamp: false, ignoreEmbedding: false });
check('perturbing the manifest changes the fingerprint (determinism gate would catch it)', perturbedFp.fingerprint !== fpFull.fingerprint);

// --- embedding-excluded mode TIGHTNESS: ignores an embedding-only delta, still catches structural ---
// two nodes identical except embeddingHash -> in EXCLUDED mode they produce identical lines (ignored)
const recA = { stableId: 'n9', labels: ['A'], props: { p: '1' }, embeddingHash: 'HASH_A' };
const recB = { stableId: 'n9', labels: ['A'], props: { p: '1' }, embeddingHash: 'HASH_B' };
const exclA = fingerprinter.buildNodeLine(recA, { ignoreOwnerStamp: false, ignoreEmbedding: true });
const exclB = fingerprinter.buildNodeLine(recB, { ignoreOwnerStamp: false, ignoreEmbedding: true });
check('excluded mode: embedding-only difference is IGNORED (identical lines)', exclA === exclB);
const fullA = fingerprinter.buildNodeLine(recA, { ignoreOwnerStamp: false, ignoreEmbedding: false });
const fullB = fingerprinter.buildNodeLine(recB, { ignoreOwnerStamp: false, ignoreEmbedding: false });
check('full mode: the SAME embedding-only difference IS visible (different lines)', fullA !== fullB);

// two nodes differing in a STRUCTURAL property -> flagged EVEN in excluded mode
const recStructA = { stableId: 'n9', labels: ['A'], props: { p: '1' }, embeddingHash: 'HASH_A' };
const recStructB = { stableId: 'n9', labels: ['A'], props: { p: 'CHANGED' }, embeddingHash: 'HASH_A' };
const exclStructA = fingerprinter.buildNodeLine(recStructA, { ignoreOwnerStamp: false, ignoreEmbedding: true });
const exclStructB = fingerprinter.buildNodeLine(recStructB, { ignoreOwnerStamp: false, ignoreEmbedding: true });
check('excluded mode: a STRUCTURAL property difference is STILL caught', exclStructA !== exclStructB);
const exclDiff = differ.diffManifests({ baseline: { nodes: [exclStructA], edges: [] }, candidate: { nodes: [exclStructB], edges: [] } });
check('excluded mode: structural diff localizes the changed property', exclDiff.summary.changedNodes === 1 && exclDiff.nodes.changed[0].changedProps.indexOf('p') !== -1);
// a label difference is structural and must be caught in excluded mode too
const exclLabel = fingerprinter.buildNodeLine({ stableId: 'n9', labels: ['A', 'B'], props: { p: '1' }, embeddingHash: 'HASH_A' }, { ignoreOwnerStamp: false, ignoreEmbedding: true });
check('excluded mode: a label difference is STILL caught', exclStructA !== exclLabel);

console.log(`\nRESULT: ${failed === 0 ? 'GREEN' : 'RED'}  (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
