'use strict';

// roundTripGraphDouble.js (forge-sif) — build a READER DOUBLE from a forge output block,
// satisfying the same { readAll, close } contract the bolt reader satisfies, so the hermetic
// fixture (RT-7) and the fault-injection twins (RT-10) can drive the WHOLE instrument with no
// container and no spend.
//
// WHAT THIS IS, HONESTLY STATED: the double replays the forge's { nodes, edges } as if they had
// been materialized. It proves the instrument (reader payload + canonicalizer + diff) and the
// forge shape; it does NOT audit the loader — that proof belongs to the real-container run the
// validator makes (runSifRoundTripRealGraph.js against DEV_sifRoundTrip_080326). Saying so here
// rather than letting the fixture look stronger than it is.
//
// The double applies the SAME Layer-1 selection the bolt reader's queries apply — SifObject and
// SifField nodes by per-standard label, HAS_PROPERTY pairs between them, the root's provenance
// identity — expressed against the same property manifest, so a divergence between double and
// reader is a manifest diff, not a code hunt.
//
// Pure, callback-shaped where contracts demand (R7), no I/O. No async/await, no try/catch.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const compilerLib = require('./roundTripSifCompiler')();

const STANDARD_SOURCE = 'SIF';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// buildSifGraphFromForgeOutput — { nodes, edges } (forge block shape) -> sifGraph (the
		// reader contract's payload). Synchronous and pure; exposed directly so a twin can corrupt
		// the sifGraph before wrapping it in a reader.
		const buildSifGraphFromForgeOutput = ({ nodes, edges } = {}) => {
			if (!Array.isArray(nodes) || !Array.isArray(edges)) {
				throw new Error(
					`${moduleName}.buildSifGraphFromForgeOutput: nodes and edges arrays are REQUIRED ` +
						`and have no defaults.`,
				);
			}

			const projectProperties = (sourceProperties, propertyNameList) => {
				const projected = {};
				propertyNameList.forEach((onePropertyName) => {
					const value = sourceProperties[onePropertyName];
					if (value !== null && value !== undefined) {
						projected[onePropertyName] = value;
					}
				});
				return projected;
			};

			const objectNodeList = [];
			const fieldNodeList = [];
			const objectIdSet = {};
			const fieldIdSet = {};
			let rootProperties = null;

			nodes.forEach((oneNode) => {
				const labels = oneNode.labels || [];
				if (labels.includes('SifRoot')) {
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
				if (labels.includes('SifObject')) {
					objectNodeList.push(
						projectProperties(oneNode.properties, compilerLib.OBJECT_PROPERTY_NAMES),
					);
					objectIdSet[oneNode.properties._id] = true;
					return;
				}
				if (labels.includes('SifField')) {
					fieldNodeList.push(
						projectProperties(oneNode.properties, compilerLib.FIELD_PROPERTY_NAMES),
					);
					fieldIdSet[oneNode.properties._id] = true;
				}
			});

			const hasPropertyPairList = [];
			edges.forEach((oneEdge) => {
				if (oneEdge.type !== 'HAS_PROPERTY') {
					return;
				}
				const fromId = oneEdge.fromRef && oneEdge.fromRef.id;
				const toId = oneEdge.toRef && oneEdge.toRef.id;
				if (objectIdSet[fromId] && fieldIdSet[toId]) {
					hasPropertyPairList.push({ ownerId: fromId, memberId: toId });
				}
			});

			return { objectNodeList, fieldNodeList, hasPropertyPairList, rootProperties };
		};

		// cloneSifGraph — deep clone so a twin's corruption can never leak into the pristine graph.
		const cloneSifGraph = (sifGraph) => JSON.parse(JSON.stringify(sifGraph));

		// makeGraphDoubleReader — wrap a sifGraph (optionally corrupted by a twin) in the reader
		// contract. adjustSifGraph, when given, receives a CLONE and returns the graph to serve —
		// this is the fault-injection seam the cheating-detector and order-swap twins use.
		const makeGraphDoubleReader = ({ sifGraph, adjustSifGraph } = {}) => {
			if (!sifGraph) {
				throw new Error(
					`${moduleName}.makeGraphDoubleReader: sifGraph is REQUIRED and has no default.`,
				);
			}
			const readAll = (callback) => {
				const served = adjustSifGraph ? adjustSifGraph(cloneSifGraph(sifGraph)) : sifGraph;
				callback('', { sifGraph: served });
			};
			const close = (callback) => callback('');
			return { readAll, close };
		};

		return {
			buildSifGraphFromForgeOutput,
			makeGraphDoubleReader,
			cloneSifGraph,
			STANDARD_SOURCE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
