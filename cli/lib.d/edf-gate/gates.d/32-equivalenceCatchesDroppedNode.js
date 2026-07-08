'use strict';

// Gate (twin / fault-injection): the STRUCTURAL axis of assertGraphEquivalence must bite. Over a real
// FULL-mode element manifest, first confirm identical manifests are byteIdentical (GREEN), then DROP
// ONE node and assert the comparator reports the graphs NOT structurally equivalent and NOT
// equivalent — regime divergent, with removedNodes==1 localizing the fault. RED-then-GREEN in one
// gate. In-memory; touches no graph. (A dropped node is the structural fault class the embedding axis
// must NOT absorb — this proves a real structural difference is reported as divergent, never as a
// mere embedding drift.)

module.exports = () => ({
	name: 'equivalence.catchesDroppedNode',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const ge = ctx.resources.graphEquivalence;
		const fp = ctx.resources.fingerprinter;
		const { buildTwinManifest } = require('../lib/graph-equivalence/equivalenceTwinFixture');

		const baseline = buildTwinManifest(fp);

		// GREEN: identical manifests
		const greenVerdict = ge.compareEquivalence({
			manifestA: baseline,
			manifestB: buildTwinManifest(fp),
		});

		// RED: drop ONE node line (edges left intact — a real structural loss)
		if (!baseline.nodes.length) {
			callback('', { passed: false, detail: 'empty fixture manifest' });
			return;
		}
		const nodesB = baseline.nodes.slice();
		const dropped = JSON.parse(nodesB[0]);
		nodesB.splice(0, 1);
		const redVerdict = ge.compareEquivalence({
			manifestA: baseline,
			manifestB: { nodes: nodesB, edges: baseline.edges },
		});

		const green = greenVerdict.byteIdentical && greenVerdict.regime === 'transport';
		const red =
			redVerdict.structurallyEquivalent === false &&
			redVerdict.equivalent === false &&
			redVerdict.byteIdentical === false &&
			redVerdict.regime === 'divergent' &&
			redVerdict.counts.removedNodes === 1;

		callback('', {
			passed: green && red,
			detail:
				`GREEN(identical)->byteIdentical=${greenVerdict.byteIdentical}; ` +
				`RED(droppedNode ${dropped.stableId})->regime=${redVerdict.regime},` +
				`structurallyEquivalent=${redVerdict.structurallyEquivalent},removedNodes=${redVerdict.counts.removedNodes}`,
		});
	},
});
