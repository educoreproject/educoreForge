'use strict';

// Gate (twin / fault-injection): the embedding AXIS of assertGraphEquivalence must bite. Over a real
// FULL-mode element manifest (built by the actual fingerprinter line builders), first confirm two
// identical manifests compare byteIdentical/transport (GREEN), then perturb ONE embedding-bearing
// node's embeddingHash and assert the comparator reports the graphs STILL structurally equivalent
// ("identical up to embedding-vector values") but NO LONGER byteIdentical — regime rebuild-equivalent,
// with the divergence localized to exactly that one stableId. RED-then-GREEN in one gate. In-memory;
// touches no graph. (Proves BOTH that the embedding axis detects AND that a vector drift does not
// masquerade as a structural fault.)

module.exports = () => ({
	name: 'equivalence.catchesVectorMutation',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const ge = ctx.resources.graphEquivalence;
		const fp = ctx.resources.fingerprinter;
		const { buildTwinManifest } = require('../lib/graph-equivalence/equivalenceTwinFixture');

		const baseline = buildTwinManifest(fp);

		// GREEN: identical manifests => transport / byteIdentical
		const greenVerdict = ge.compareEquivalence({
			manifestA: baseline,
			manifestB: buildTwinManifest(fp),
		});

		// RED: perturb ONE embedding-bearing node's embeddingHash (count-preserving, structure intact)
		const nodesB = baseline.nodes.slice();
		const victimIndex = nodesB.findIndex((line) => !!JSON.parse(line).embeddingHash);
		if (victimIndex === -1) {
			callback('', { passed: false, detail: 'fixture has no embedding-bearing node to perturb' });
			return;
		}
		const victim = JSON.parse(nodesB[victimIndex]);
		nodesB[victimIndex] = JSON.stringify({
			...victim,
			embeddingHash: `${victim.embeddingHash}-MUTATED`,
		});
		const redVerdict = ge.compareEquivalence({
			manifestA: baseline,
			manifestB: { nodes: nodesB, edges: baseline.edges },
		});

		const green = greenVerdict.byteIdentical && greenVerdict.regime === 'transport';
		const red =
			redVerdict.structurallyEquivalent === true &&
			redVerdict.equivalent === true &&
			redVerdict.byteIdentical === false &&
			redVerdict.regime === 'rebuild-equivalent' &&
			redVerdict.embeddingDivergentCount === 1 &&
			redVerdict.embeddingDivergence[0] === victim.stableId;

		callback('', {
			passed: green && red,
			detail:
				`GREEN(identical)->regime=${greenVerdict.regime},byteIdentical=${greenVerdict.byteIdentical}; ` +
				`RED(vectorMutation)->regime=${redVerdict.regime},structurallyEquivalent=${redVerdict.structurallyEquivalent},` +
				`byteIdentical=${redVerdict.byteIdentical},embeddingDivergence=${JSON.stringify(redVerdict.embeddingDivergence)}`,
		});
	},
});
