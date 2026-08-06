#!/usr/bin/env node
'use strict';

// mp_probeS1cCensus.js — Phase 4.6a (session MYSTIC_PORTAL). Runs the forge and prints the S-1c
// census plus one worked exemplar, so the phase report cites observed figures rather than intended
// ones. Asserts nothing; the gate suite does that.

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

bundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'probe', skipEmbedding: true }, (err, forged) => {
	if (err) {
		console.error(`FORGE REFUSED: ${err}`);
		process.exit(1);
	}
	const syntheticNodes = forged.nodes.filter((oneNode) => oneNode.properties.pescTier === 'synthetic');
	const syntheticEdges = forged.edges.filter((oneEdge) => oneEdge.properties.pescTier === 'synthetic');

	const countBy = (itemList, keyOf) =>
		itemList.reduce(
			(counts, oneItem) => ({ ...counts, [keyOf(oneItem)]: (counts[keyOf(oneItem)] || 0) + 1 }),
			{},
		);

	console.log('=== whole-graph census ===');
	console.log(
		JSON.stringify({ nodes: forged.nodes.length, edges: forged.edges.length }),
	);
	console.log('\n=== synthetic nodes by syntheticRule ===');
	console.log(JSON.stringify(countBy(syntheticNodes, (oneNode) => oneNode.properties.syntheticRule)));
	console.log('\n=== synthetic edges by type ===');
	console.log(JSON.stringify(countBy(syntheticEdges, (oneEdge) => oneEdge.type)));
	console.log('\n=== synthetic edges by syntheticRule ===');
	console.log(JSON.stringify(countBy(syntheticEdges, (oneEdge) => oneEdge.properties.syntheticRule)));

	const syntheticStats = forged.stats && forged.stats.synthetic ? forged.stats.synthetic : forged.stats;
	console.log('\n=== S-1c figures from stats ===');
	console.log(JSON.stringify(syntheticStats, null, 2).substring(0, 3000));

	console.log('\n=== EXEMPLAR: the merged PersonType, the type that rendered empty ===');
	const personTypeNode = syntheticNodes.find(
		(oneNode) => oneNode.properties.name === 'PersonType' && oneNode.properties.syntheticRule === 'S-1',
	);
	if (personTypeNode === undefined) {
		console.log('(merged PersonType not found)');
		return;
	}
	const personTypeOutEdges = forged.edges.filter(
		(oneEdge) => oneEdge.fromRef.id === personTypeNode.stableId,
	);
	console.log(
		JSON.stringify({
			stableId: personTypeNode.stableId,
			outDegree: personTypeOutEdges.length,
			outEdgesByType: countBy(personTypeOutEdges, (oneEdge) => oneEdge.type),
			childElementCount: personTypeNode.properties.childElementCount,
			collegeContributedChildElementCount: personTypeNode.properties.collegeContributedChildElementCount,
			testScoreContributedChildElementCount:
				personTypeNode.properties.testScoreContributedChildElementCount,
			absentChildElementCount: personTypeNode.properties.absentChildElementCount,
			absentChildElementsZeroedAtPhase: personTypeNode.properties.absentChildElementsZeroedAtPhase,
			reboundChildElementCount: personTypeNode.properties.reboundChildElementCount,
			widenedChildElementCount: personTypeNode.properties.widenedChildElementCount,
			signatureLevelCollegeContributedCount:
				personTypeNode.properties.signatureLevelCollegeContributedCount,
			signatureLevelTestScoreDroppedCount:
				personTypeNode.properties.signatureLevelTestScoreDroppedCount,
		}, null, 2),
	);

	console.log('\n=== EXEMPLAR: the two R-P4-10 losing-branch contributions, as emitted nodes ===');
	syntheticNodes
		.filter(
			(oneNode) =>
				oneNode.properties.childUnionDisposition === 'losingBranchContributed',
		)
		.forEach((oneNode) =>
			console.log(
				JSON.stringify({
					stableId: oneNode.stableId,
					name: oneNode.properties.name,
					typeAsWritten: oneNode.properties.typeAsWritten,
					pescTier: oneNode.properties.pescTier,
					syntheticRule: oneNode.properties.syntheticRule,
					contributedByBranch: oneNode.properties.contributedByBranch,
					copiedFromStableId: oneNode.properties.copiedFromStableId,
					sourceSequencePosition: oneNode.properties.sourceSequencePosition,
					sequencePosition: oneNode.properties.sequencePosition,
				}),
			),
		);

	console.log('\n=== H1 CHECK: did the three documentation-bearing children keep their prose? ===');
	['AgencyAssignedID', 'ParentGuardianName', 'HighSchool'].forEach((oneChildName) => {
		syntheticNodes
			.filter(
				(oneNode) =>
					oneNode.properties.syntheticRule === 'S-1c' && oneNode.properties.name === oneChildName,
			)
			.forEach((oneNode) =>
				console.log(
					JSON.stringify({
						name: oneNode.properties.name,
						contributedByBranch: oneNode.properties.contributedByBranch,
						documentationLength: `${oneNode.properties.documentation}`.length,
						documentationHead: `${oneNode.properties.documentation}`.substring(0, 60),
					}),
				),
			);
	});
});
