#!/usr/bin/env node
'use strict';

// mp_verifyPhase46aReload.js — GATE 4.6a's required reload (session MYSTIC_PORTAL).
// Re-pulls Gate 4.5's A (conservation by SET), B (fusion) and C (property fidelity) against the
// graph this phase produced, and re-computes the determinism digests so the new graph has pins of
// its own. Gate 4.5's D folded into A at the Phase 4.5 review (it cannot fail independently).
//
// READ-ONLY against the graph. Takes the container's bolt url/user/password on stdin as JSON so no
// credential is written into a file:
//   jq -nc '{boltUrl:"bolt://localhost:PORT",neo4jUser:"neo4j",neo4jPassword:"..."}' | node <this>

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const neo4j = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'neo4j-driver'));
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

// the BEFORE pins, from the 2026-08-06 determinism run against DEV_pesc260805
const BEFORE_PINS = {
	nodeCount: 41850,
	nodeContentDigest: '678332dc2010edd24e3f8f5b44c9cafd',
	edgeCount: 70063,
	edgeContentDigest: '2e027b2e05ffc7e014fb49a7ea69b605',
};

let pass = 0;
let fail = 0;
const check = (label, condition) => {
	if (condition) {
		pass++;
		console.log(`  ok    ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};
const evidence = (line) => console.log(`        ${line}`);

let stdinText = '';
process.stdin.on('data', (oneChunk) => {
	stdinText += oneChunk;
});
process.stdin.on('end', () => {
	if (stdinText.trim() === '') {
		console.error(
			'REFUSES: this probe takes {boltUrl, neo4jUser, neo4jPassword} as JSON on stdin. There is ' +
				'no default — a wrong container silently verified is worse than no verification.',
		);
		process.exit(1);
	}
	const connectionSpec = JSON.parse(stdinText);
	['boltUrl', 'neo4jUser', 'neo4jPassword'].forEach((oneFieldName) => {
		if (!connectionSpec[oneFieldName]) {
			console.error(`REFUSES: stdin JSON has no '${oneFieldName}'.`);
			process.exit(1);
		}
	});
	runVerification(connectionSpec);
});

const runVerification = ({ boltUrl, neo4jUser, neo4jPassword }) => {
	console.log(`GATE 4.6a RELOAD VERIFICATION against ${boltUrl}`);
	bundle.forge(
		{ sourcePath: SNAPSHOT_DIR, owner: 'reloadVerify', skipEmbedding: true },
		(forgeError, forged) => {
			if (forgeError) {
				console.error(`forge failed: ${forgeError}`);
				process.exit(1);
			}
			const driver = neo4j.driver(boltUrl, neo4j.auth.basic(neo4jUser, neo4jPassword));
			const session = driver.session();
			const runQuery = (cypherText) => session.run(cypherText);

			// ---- what the forge EMITTED ------------------------------------------------------
			const emittedStableIds = forged.nodes.map((oneNode) => oneNode.stableId);
			const emittedStableIdSet = new Set(emittedStableIds);
			const emittedEdgeTriples = forged.edges.map(
				(oneEdge) => `${oneEdge.fromRef.id}${oneEdge.type}${oneEdge.toRef.id}`,
			);
			const emittedEdgeTripleSet = new Set(emittedEdgeTriples);

			runQuery('MATCH (n:ForgedNode) RETURN n.stableId AS stableId')
				.then((nodeResult) => {
					const graphStableIds = nodeResult.records.map((oneRecord) => oneRecord.get('stableId'));
					const graphStableIdSet = new Set(graphStableIds);

					// ---- G4.5-A CONSERVATION, BY SET --------------------------------------------
					const emittedNotInGraph = [...emittedStableIdSet].filter(
						(oneStableId) => !graphStableIdSet.has(oneStableId),
					);
					const graphNotEmitted = [...graphStableIdSet].filter(
						(oneStableId) => !emittedStableIdSet.has(oneStableId),
					);
					evidence(`nodes: emitted ${emittedStableIds.length} (${emittedStableIdSet.size} distinct), graph ${graphStableIds.length} (${graphStableIdSet.size} distinct); lost ${emittedNotInGraph.length}, invented ${graphNotEmitted.length}`);
					if (emittedNotInGraph.length > 0) evidence(`  first lost: ${emittedNotInGraph[0]}`);
					if (graphNotEmitted.length > 0) evidence(`  first invented: ${graphNotEmitted[0]}`);
					check('G4.5-A CONSERVATION: the graph node stableId SET equals the emitted set — nothing lost, nothing invented', emittedNotInGraph.length === 0 && graphNotEmitted.length === 0);

					// ---- G4.5-B FUSION ----------------------------------------------------------
					// MERGE (n:ForgedNode {stableId}) is the mechanism that would perform exactly the
					// fusion the identity design exists to prevent. This phase adds 522 nodes whose
					// stableIds are minted from a merged definition plus a renumbered position, so it
					// is a fresh opportunity for a collision.
					const duplicateEmittedStableIds = emittedStableIds.length - emittedStableIdSet.size;
					evidence(`fusion: emitted duplicates ${duplicateEmittedStableIds}; graph nodes ${graphStableIds.length} vs distinct emitted ${emittedStableIdSet.size}`);
					check('G4.5-B FUSION: the emitted stableId set carries NO duplicates and the graph node count equals the distinct emitted count', duplicateEmittedStableIds === 0 && graphStableIds.length === emittedStableIdSet.size);

					return runQuery(
						'MATCH (a)-[r]->(b) RETURN a.stableId AS fromStableId, type(r) AS edgeType, b.stableId AS toStableId',
					);
				})
				.then((edgeResult) => {
					const graphEdgeTriples = edgeResult.records.map(
						(oneRecord) =>
							`${oneRecord.get('fromStableId')}${oneRecord.get('edgeType')}${oneRecord.get('toStableId')}`,
					);
					const graphEdgeTripleSet = new Set(graphEdgeTriples);
					const emittedEdgesNotInGraph = [...emittedEdgeTripleSet].filter(
						(oneTriple) => !graphEdgeTripleSet.has(oneTriple),
					);
					const graphEdgesNotEmitted = [...graphEdgeTripleSet].filter(
						(oneTriple) => !emittedEdgeTripleSet.has(oneTriple),
					);
					evidence(`edges: emitted ${emittedEdgeTriples.length} (${emittedEdgeTripleSet.size} distinct triples), graph ${graphEdgeTriples.length} (${graphEdgeTripleSet.size} distinct); lost ${emittedEdgesNotInGraph.length}, invented ${graphEdgesNotEmitted.length}`);
					if (emittedEdgesNotInGraph.length > 0)
						evidence(`  first lost: ${emittedEdgesNotInGraph[0].replace(//g, ' | ')}`);
					if (graphEdgesNotEmitted.length > 0)
						evidence(`  first invented: ${graphEdgesNotEmitted[0].replace(//g, ' | ')}`);
					check('G4.5-A CONSERVATION: the graph (from,type,to) triple SET equals the emitted set (G4.5-D folds in here)', emittedEdgesNotInGraph.length === 0 && graphEdgesNotEmitted.length === 0);

					// ---- G4.5-C PROPERTY FIDELITY, on the NEW population ------------------------
					// The duplicated children are the nodes this phase introduced, so they are where a
					// bolt-boundary shape change would bite first.
					// DERIVED FROM THE DATA, NOT HAND-LISTED. This first named five properties, and was
					// therefore BLIND to every property the phase added after it was written — 522
					// nodes could have been missing `decidedNonSignaturePropertyNames` and it would
					// have reported perfect fidelity. A fidelity check that enumerates what to compare
					// can only ever verify what its author already thought of. It now returns the whole
					// property map per node and compares against the emitted bag key by key.
					return runQuery(`
						MATCH (n:ForgedNode) WHERE n.syntheticRule = 'S-1c'
						RETURN n.stableId AS stableId, properties(n) AS graphProperties, keys(n) AS propertyNames
						ORDER BY n.stableId`);
				})
				.then((childResult) => {
					const emittedChildByStableId = {};
					forged.nodes
						.filter((oneNode) => oneNode.properties.syntheticRule === 'S-1c')
						.forEach((oneNode) => {
							emittedChildByStableId[oneNode.stableId] = oneNode;
						});
					const readBackCount = childResult.records.length;
					const meaningMismatches = [];
					const nullBecameAbsent = [];
					let longestDocumentationLength = 0;
					let comparedPropertyCount = 0;
					const propertyNamesSeen = new Set();
					childResult.records.forEach((oneRecord) => {
						const stableId = oneRecord.get('stableId');
						const emittedNode = emittedChildByStableId[stableId];
						if (emittedNode === undefined) {
							meaningMismatches.push(`${stableId}: in graph, not emitted`);
							return;
						}
						const graphProperties = oneRecord.get('graphProperties');
						const propertyNames = oneRecord.get('propertyNames');
						// EVERY property, from BOTH directions. A one-directional walk would miss a
						// property the graph carries that the forge never emitted, and vice versa.
						// stableId lives at the NODE's top level in the forge's model and is written into
						// the graph as an ordinary property by the loader. Comparing it against
						// properties.stableId reports 522 phantom mismatches — which is exactly what the
						// hand-listed predecessor avoided by never looking. The derived form found it on
						// its first run, which is the argument for deriving.
						const emittedValueOf = (onePropertyName) =>
							onePropertyName === 'stableId'
								? emittedNode.stableId
								: emittedNode.properties[onePropertyName];
						const allPropertyNames = [
							...new Set([
								...Object.keys(emittedNode.properties),
								...Object.keys(graphProperties),
							]),
						];
						allPropertyNames.forEach((onePropertyName) => {
							propertyNamesSeen.add(onePropertyName);
							comparedPropertyCount++;
							const emittedValue = emittedValueOf(onePropertyName);
							const graphHasIt = Object.prototype.hasOwnProperty.call(
								graphProperties,
								onePropertyName,
							);
							// null-versus-absent (design §8g): Neo4j has no null property, so an emitted
							// null MUST arrive ABSENT. That is correct, not a mismatch.
							if (emittedValue === null) {
								if (graphHasIt) {
									meaningMismatches.push(`${stableId}: emitted null '${onePropertyName}' is PRESENT in the graph`);
								} else {
									nullBecameAbsent.push(`${stableId}.${onePropertyName}`);
								}
								return;
							}
							if (!graphHasIt) {
								meaningMismatches.push(`${stableId}: emitted '${onePropertyName}' is MISSING from the graph`);
								return;
							}
							const graphValue = neo4j.isInt(graphProperties[onePropertyName])
								? graphProperties[onePropertyName].toNumber()
								: graphProperties[onePropertyName];
							if (onePropertyName === 'documentation' && typeof graphValue === 'string') {
								longestDocumentationLength = Math.max(longestDocumentationLength, graphValue.length);
							}
							if (JSON.stringify(graphValue) !== JSON.stringify(emittedValue)) {
								meaningMismatches.push(
									`${stableId}: '${onePropertyName}' differs — emitted ${JSON.stringify(emittedValue)}, graph ${JSON.stringify(graphValue)}`,
								);
							}
						});
						// string-versus-array across the bolt boundary, asserted explicitly because it is
						// the shape change design §8g warns about rather than a value difference
						if (typeof graphProperties.pescTier !== 'string') {
							meaningMismatches.push(`${stableId}: pescTier read back as ${typeof graphProperties.pescTier}`);
						}
						void propertyNames;
					});
					evidence(`property fidelity over the ${readBackCount} duplicated children: ${comparedPropertyCount} property comparisons across ${propertyNamesSeen.size} distinct property names (DERIVED from the data, not hand-listed); mismatches ${meaningMismatches.length}; emitted nulls correctly ABSENT in the graph: ${nullBecameAbsent.length}; longest documentation survived: ${longestDocumentationLength} chars`);
					meaningMismatches.slice(0, 5).forEach((oneMismatch) => evidence(`  ${oneMismatch}`));
					check('G4.5-C PROPERTY FIDELITY: every duplicated child reads back MEANING what was emitted (string-not-array, verbatim documentation, null-as-absent)', meaningMismatches.length === 0 && readBackCount > 0);

					// ---- determinism digests, so the NEW graph has pins of its own ---------------
					return runQuery(`
						MATCH (n:ForgedNode)
						WITH apoc.util.md5([n.stableId] + apoc.coll.sort(labels(n))
						     + apoc.coll.sort([k IN keys(n) | k + '=' + apoc.convert.toJson(n[k])])) AS nodeDigest
						WITH apoc.coll.sort(collect(nodeDigest)) AS d
						RETURN size(d) AS nodeCount, apoc.util.md5(d) AS nodeContentDigest`);
				})
				.then((nodeDigestResult) => {
					const nodeCount = nodeDigestResult.records[0].get('nodeCount').toNumber();
					const nodeContentDigest = nodeDigestResult.records[0].get('nodeContentDigest');
					evidence(`NODE DIGEST: count ${nodeCount} (before ${BEFORE_PINS.nodeCount}, delta ${nodeCount - BEFORE_PINS.nodeCount}), digest ${nodeContentDigest} (before ${BEFORE_PINS.nodeContentDigest})`);
					check('RELOAD: the node count moved by EXACTLY the 522 duplicated children', nodeCount === BEFORE_PINS.nodeCount + 522);
					check('RELOAD: the node content digest CHANGED (a graph carrying new nodes that hashed the same would be an instrument fault)', nodeContentDigest !== BEFORE_PINS.nodeContentDigest);
					return runQuery(`
						MATCH (a)-[r]->(b)
						WITH apoc.util.md5([a.stableId, type(r), b.stableId]
						     + apoc.coll.sort([k IN keys(r) | k + '=' + apoc.convert.toJson(r[k])])) AS edgeDigest
						WITH apoc.coll.sort(collect(edgeDigest)) AS d
						RETURN size(d) AS edgeCount, apoc.util.md5(d) AS edgeContentDigest`);
				})
				.then((edgeDigestResult) => {
					const edgeCount = edgeDigestResult.records[0].get('edgeCount').toNumber();
					const edgeContentDigest = edgeDigestResult.records[0].get('edgeContentDigest');
					evidence(`EDGE DIGEST: count ${edgeCount} (before ${BEFORE_PINS.edgeCount}, delta ${edgeCount - BEFORE_PINS.edgeCount}), digest ${edgeContentDigest} (before ${BEFORE_PINS.edgeContentDigest})`);
					check('RELOAD: the edge count moved by EXACTLY 565 (522 HAS_PROPERTY + 38 HAS_RESTRICTION + 5 HAS_SUPPORT)', edgeCount === BEFORE_PINS.edgeCount + 565);
					check('RELOAD: the edge content digest CHANGED', edgeContentDigest !== BEFORE_PINS.edgeContentDigest);

					// the acceptance exemplar, read from the reloaded graph rather than from memory
					return runQuery(`
						MATCH (m:ForgedNode) WHERE m.pescTier='synthetic' AND m.syntheticRule='S-1' AND m.name='PersonType'
						OPTIONAL MATCH (m)-[r]->()
						RETURN m.stableId AS stableId, type(r) AS edgeType, count(r) AS edgeCount`);
				})
				.then((personTypeResult) => {
					const byType = {};
					personTypeResult.records.forEach((oneRecord) => {
						byType[oneRecord.get('edgeType')] = oneRecord.get('edgeCount').toNumber();
					});
					evidence(`EXEMPLAR from the reloaded graph — merged PersonType out-edges: ${JSON.stringify(byType)} (before Phase 4.6a it was MERGED_FROM 2 and nothing else, and the type rendered EMPTY)`);
					check('RELOAD: the named exemplar renders 18 children in the GRAPH, with MERGED_FROM intact at 2', byType.HAS_PROPERTY === 18 && byType.MERGED_FROM === 2);

					console.log(`\n${pass} passed, ${fail} failed`);
					return session.close().then(() => driver.close());
				})
				.then(() => process.exit(fail === 0 ? 0 : 1))
				.catch((thrownError) => {
					console.error(`VERIFICATION ABORTED: ${thrownError.message}`);
					session.close().then(() => driver.close()).then(() => process.exit(1));
				});
		},
	);
};
