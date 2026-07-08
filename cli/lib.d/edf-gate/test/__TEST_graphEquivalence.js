#!/usr/bin/env node
'use strict';

// __TEST_graphEquivalence.js — unit tests for the PURE equivalence comparator (compareEquivalence)
// and embeddingCoverage. No graph, no docker, no lifecycle: instantiates the fingerprinter only for
// its line builders, the differ, and graphEquivalence over them. Run: node __TEST_graphEquivalence.js
// Exit 0 = all pass, 1 = a failure.

const path = require('path');

// minimal process.global (graphEquivalence reads xLog at instantiation; fingerprint reads it lazily)
process.global = {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
};

const GATE_LIB = path.join(__dirname, '..', 'lib');
const fingerprinter = require(path.join(GATE_LIB, 'graph-fingerprint', 'graphFingerprint'))({});
const differ = require(path.join(GATE_LIB, 'graph-diff', 'graphDiff'))();
const graphEquivalence = require(path.join(GATE_LIB, 'graph-equivalence', 'graphEquivalence'))({
	fingerprinter,
	differ,
});
const { buildTwinManifest } = require(path.join(
	GATE_LIB,
	'graph-equivalence',
	'equivalenceTwinFixture',
));

let failures = 0;
const check = (label, condition) => {
	const ok = !!condition;
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
	if (!ok) failures += 1;
};

const cloneManifest = (m) => ({ nodes: m.nodes.slice(), edges: m.edges.slice() });

// ---- identical => transport / byteIdentical ----
console.log('identical manifests:');
{
	const v = graphEquivalence.compareEquivalence({
		manifestA: buildTwinManifest(fingerprinter),
		manifestB: buildTwinManifest(fingerprinter),
	});
	check('byteIdentical true', v.byteIdentical === true);
	check('equivalent true', v.equivalent === true);
	check('structurallyEquivalent true', v.structurallyEquivalent === true);
	check("regime 'transport'", v.regime === 'transport');
	check('embeddingDivergentCount 0', v.embeddingDivergentCount === 0);
}

// ---- vector mutation => rebuild-equivalent (structure intact, embedding drifted) ----
console.log('vector mutation (one embeddingHash changed):');
{
	const baseline = buildTwinManifest(fingerprinter);
	const nodesB = baseline.nodes.slice();
	const idx = nodesB.findIndex((line) => !!JSON.parse(line).embeddingHash);
	const victim = JSON.parse(nodesB[idx]);
	nodesB[idx] = JSON.stringify({ ...victim, embeddingHash: `${victim.embeddingHash}-X` });
	const v = graphEquivalence.compareEquivalence({
		manifestA: baseline,
		manifestB: { nodes: nodesB, edges: baseline.edges },
	});
	check('structurallyEquivalent true', v.structurallyEquivalent === true);
	check('equivalent true (up to embedding values)', v.equivalent === true);
	check('byteIdentical false', v.byteIdentical === false);
	check("regime 'rebuild-equivalent'", v.regime === 'rebuild-equivalent');
	check('embeddingDivergentCount 1', v.embeddingDivergentCount === 1);
	check('divergence localized to victim', v.embeddingDivergence[0] === victim.stableId);
}

// ---- dropped node => divergent ----
console.log('dropped node:');
{
	const baseline = buildTwinManifest(fingerprinter);
	const nodesB = baseline.nodes.slice();
	nodesB.splice(0, 1);
	const v = graphEquivalence.compareEquivalence({
		manifestA: baseline,
		manifestB: { nodes: nodesB, edges: baseline.edges },
	});
	check('structurallyEquivalent false', v.structurallyEquivalent === false);
	check('equivalent false', v.equivalent === false);
	check("regime 'divergent'", v.regime === 'divergent');
	check('removedNodes 1', v.counts.removedNodes === 1);
}

// ---- added node => divergent ----
console.log('added node:');
{
	const baseline = buildTwinManifest(fingerprinter);
	const extra = fingerprinter.buildNodeLine(
		{ stableId: 'ceds:twinDelta', labels: ['ForgedNode', 'CedsProperty'], props: { name: 'Delta' }, embeddingHash: 'dddd' },
		{ ignoreOwnerStamp: false, ignoreEmbedding: false },
	);
	const nodesB = baseline.nodes.concat([extra]);
	const v = graphEquivalence.compareEquivalence({
		manifestA: baseline,
		manifestB: { nodes: nodesB, edges: baseline.edges },
	});
	check("regime 'divergent'", v.regime === 'divergent');
	check('addedNodes 1', v.counts.addedNodes === 1);
}

// ---- structural property change => divergent (NOT absorbed by embedding axis) ----
console.log('structural property change:');
{
	const baseline = buildTwinManifest(fingerprinter);
	const nodesB = baseline.nodes.slice();
	const victim = JSON.parse(nodesB[0]);
	nodesB[0] = JSON.stringify({ ...victim, props: { ...victim.props, name: 'AlphaRenamed' } });
	const v = graphEquivalence.compareEquivalence({
		manifestA: baseline,
		manifestB: { nodes: nodesB, edges: baseline.edges },
	});
	check('structurallyEquivalent false', v.structurallyEquivalent === false);
	check("regime 'divergent'", v.regime === 'divergent');
	check('structuralChangedNodes 1', v.counts.structuralChangedNodes === 1);
}

// ---- dropped edge => divergent ----
console.log('dropped edge:');
{
	const baseline = buildTwinManifest(fingerprinter);
	const edgesB = baseline.edges.slice(0, baseline.edges.length - 1);
	const v = graphEquivalence.compareEquivalence({
		manifestA: baseline,
		manifestB: { nodes: baseline.nodes, edges: edgesB },
	});
	check("regime 'divergent'", v.regime === 'divergent');
	check('removedEdges 1', v.counts.removedEdges === 1);
}

// ---- embeddingCoverage ----
console.log('embeddingCoverage:');
{
	const populated = buildTwinManifest(fingerprinter);
	const covPop = graphEquivalence.embeddingCoverage(populated);
	check('populated total 3', covPop.total === 3);
	check('populated withEmbeddingHash 2', covPop.withEmbeddingHash === 2);
	check('populated withoutEmbeddingHash 1', covPop.withoutEmbeddingHash === 1);
	const covEmpty = graphEquivalence.embeddingCoverage({ nodes: [], edges: [] });
	check('empty withEmbeddingHash 0', covEmpty.withEmbeddingHash === 0);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
