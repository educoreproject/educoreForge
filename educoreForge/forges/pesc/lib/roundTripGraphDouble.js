'use strict';

// roundTripGraphDouble.js (forge-pesc) — build a READER DOUBLE from a forge output block, satisfying
// the same { readAll, close } contract the bolt reader satisfies, so the hermetic fixture (RT-7) and
// the fault-injection twins (RT-10) can drive the WHOLE instrument with no container and no spend.
//
// WHAT THIS IS, HONESTLY STATED: the double replays the forge's { nodes, edges } as if they had been
// materialized. It proves the instrument (serializer + canonicalizer + diff) and the forge shape; it
// does NOT audit the loader — that proof belongs to the real-container run the validator makes.
// Saying so here rather than letting the fixture look stronger than it is.
//
// The double applies the SAME Layer-1 selection the bolt reader's queries apply — edge routing by
// (type, endpoint roles), root ownership anchors excluded, redundant carriers excluded — expressed
// as one registry so a divergence between double and reader is a registry diff, not a code hunt.
//
// Pure, callback-shaped (R7), no I/O. No async/await, no try/catch.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const STANDARD_SOURCE = 'PESC';
const CONTENT_ROLES = ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue', 'DmeSupport'];

// (edgeType, fromRole, toRole) -> the reader's edge-pair bucket. The SAME routing the bolt reader's
// EDGE_QUERIES express in cypher. Unrouted combinations are deliberately dropped: DmeStandardRoot
// ownership anchors, property-level REFERENCES / HAS_OPTION_SET (redundant carriers — the typeName
// scalar is the carrier of record), SUBCLASS_OF (baseType/derivation scalars are the carrier).
const EDGE_BUCKET_BY_SIGNATURE = {
	'HAS_PROPERTY|DmeClass|DmeProperty': 'classHasProperty',
	'HAS_PROPERTY|DmeSupport|DmeProperty': 'supportHasProperty',
	'HAS_VALUE|DmeOptionSet|DmeOptionValue': 'optionSetHasValue',
	'REFERENCES|DmeClass|DmeClass': 'classReferencesClass',
	'REFERENCES|DmeClass|DmeSupport': 'classReferencesSupport',
	'HAS_OPTION_SET|DmeClass|DmeOptionSet': 'classHasOptionSet',
	'HAS_SUPPORT|DmeClass|DmeSupport': 'classHasSupport',
	'HAS_SUPPORT|DmeSupport|DmeSupport': 'supportHasSupport',
};

const EDGE_BUCKET_NAMES = [
	'classHasProperty',
	'supportHasProperty',
	'optionSetHasValue',
	'classReferencesClass',
	'classReferencesSupport',
	'classHasOptionSet',
	'classHasSupport',
	'supportHasSupport',
];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// buildPescGraphFromForgeOutput — { nodes, edges } (forge block shape) -> pescGraph
		// (the reader contract's payload). Synchronous and pure; exposed directly so a twin can
		// corrupt the pescGraph before wrapping it in a reader.
		const buildPescGraphFromForgeOutput = ({ nodes, edges } = {}) => {
			if (!Array.isArray(nodes) || !Array.isArray(edges)) {
				throw new Error(
					`${moduleName}.buildPescGraphFromForgeOutput: nodes and edges arrays are REQUIRED ` +
						`and have no defaults.`,
				);
			}

			const nodesByRole = {};
			CONTENT_ROLES.forEach((oneRole) => {
				nodesByRole[oneRole] = [];
			});
			const roleByStableId = {};
			let rootProperties = null;

			nodes.forEach((oneNode) => {
				roleByStableId[oneNode.stableId] = oneNode.role;
				if (oneNode.role === 'DmeStandardRoot') {
					rootProperties = {
						rootId: oneNode.properties._id,
						snapshotKey: oneNode.properties.snapshotKey,
						version: oneNode.properties.version,
						publishedVersion: oneNode.properties.publishedVersion,
						versionSource: oneNode.properties.versionSource,
						standardName: oneNode.properties.standardName,
					};
					return;
				}
				if (nodesByRole[oneNode.role]) {
					nodesByRole[oneNode.role].push({ ...oneNode.properties });
				}
			});

			const edgePairsByName = {};
			EDGE_BUCKET_NAMES.forEach((oneBucketName) => {
				edgePairsByName[oneBucketName] = [];
			});

			edges.forEach((oneEdge) => {
				const fromId = oneEdge.fromRef && oneEdge.fromRef.id;
				const toId = oneEdge.toRef && oneEdge.toRef.id;
				const signature = `${oneEdge.type}|${roleByStableId[fromId]}|${roleByStableId[toId]}`;
				const bucketName = EDGE_BUCKET_BY_SIGNATURE[signature];
				if (bucketName) {
					edgePairsByName[bucketName].push({ ownerId: fromId, memberId: toId });
				}
			});

			return { nodesByRole, edgePairsByName, rootProperties };
		};

		// makeGraphDoubleReader — wrap a pescGraph (optionally corrupted by a twin) in the reader
		// contract. adjustPescGraph, when given, receives the graph and returns the graph to serve —
		// this is the fault-injection seam the cheating-detector twin uses.
		const makeGraphDoubleReader = ({ pescGraph, adjustPescGraph } = {}) => {
			if (!pescGraph) {
				throw new Error(
					`${moduleName}.makeGraphDoubleReader: pescGraph is REQUIRED and has no default.`,
				);
			}
			const readAll = (callback) => {
				const served = adjustPescGraph ? adjustPescGraph(clonePescGraph(pescGraph)) : pescGraph;
				callback('', { pescGraph: served });
			};
			const close = (callback) => callback('');
			return { readAll, close };
		};

		// clonePescGraph — deep clone so a twin's corruption can never leak into the pristine graph.
		const clonePescGraph = (pescGraph) => JSON.parse(JSON.stringify(pescGraph));

		return {
			buildPescGraphFromForgeOutput,
			makeGraphDoubleReader,
			clonePescGraph,
			EDGE_BUCKET_BY_SIGNATURE,
			EDGE_BUCKET_NAMES,
			CONTENT_ROLES,
			STANDARD_SOURCE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
