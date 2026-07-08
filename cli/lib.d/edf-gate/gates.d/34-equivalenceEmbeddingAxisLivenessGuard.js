'use strict';

// Gate (twin / guard): the embedding-axis LIVENESS guard must close the vacuous-GREEN hole. A
// byteIdentical verdict is only trustworthy if the embeddingHash axis is actually populated — two
// manifests with NO embeddingHash on any node would compare byteIdentical via null==null, a false
// GREEN hiding a dead embedding axis (QUIET_ECHO's required D-c addition, the embedding-axis analogue
// of the nonEmpty guard). This gate proves embeddingCoverage() is the guard that catches it:
//   (1) an empty manifest DOES compare byteIdentical (documents the hazard is real),
//   (2) embeddingCoverage on that manifest reports withEmbeddingHash==0 (the guard fires),
//   (3) embeddingCoverage on a populated manifest positively counts its embedding-bearing nodes.
// (1)+(2) => the live path sets valid=false and refuses to read the GREEN; (3) => the guard is not
// vacuously always-zero. In-memory; touches no graph.

module.exports = () => ({
	name: 'equivalence.embeddingAxisLivenessGuard',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const ge = ctx.resources.graphEquivalence;
		const fp = ctx.resources.fingerprinter;
		const { buildTwinManifest } = require('../lib/graph-equivalence/equivalenceTwinFixture');

		const empty = { nodes: [], edges: [] };
		const emptyVerdict = ge.compareEquivalence({ manifestA: empty, manifestB: empty });
		const emptyCoverage = ge.embeddingCoverage(empty);

		const populated = buildTwinManifest(fp);
		const populatedCoverage = ge.embeddingCoverage(populated);

		const hazardIsReal = emptyVerdict.byteIdentical === true; // vacuous GREEN exists...
		const guardFiresOnDeadAxis = emptyCoverage.withEmbeddingHash === 0; // ...and the guard catches it
		const guardCountsRealCoverage = populatedCoverage.withEmbeddingHash === 2; // 2 embedding-bearing fixture nodes

		callback('', {
			passed: hazardIsReal && guardFiresOnDeadAxis && guardCountsRealCoverage,
			detail:
				`vacuousByteIdenticalOnEmpty=${hazardIsReal},emptyCoverage=${emptyCoverage.withEmbeddingHash}/${emptyCoverage.total},` +
				`populatedCoverage=${populatedCoverage.withEmbeddingHash}/${populatedCoverage.total}`,
		});
	},
});
