'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// materializer.js — turns a forged contract graph (nodes+edges, embeddings stamped) into a
// materialized single-standard VALIDATION graph (helpSpec OUTPUT, DECISIONS §4/§14).
//
// Steps:
//   1. serialize ONE 'standard' block via replay-block.serializeBlock (header: blockType
//      'standard', standardKey, stableUriPropertyName, resolutionKey, serializerVersion '1',
//      embedding* fields, embeddingDims 1024).
//   2. resolve/create the destination validation graph via the 1B instance-lifecycle (shared lib
//      callable by all CLIs; the forger provisions its OWN ephemeral validation graph through it).
//   3. replay the block into the destination via the Phase-2 engine (boltUri + credential
//      resolved by name from the registry).
//
// NEVER tears down on error (DECISIONS §14): a failed run is left in place.
//
// Async style: qtools taskListPlus/pipeRunner; neo4j/engine resolve at the leaf. No async/await,
// no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const CORE_LIB = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'npm',
	'qtools-graph-forge-core',
	'lib',
);
const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const replayEngine = require(path.join(CORE_LIB, 'replay', 'replay-engine'));

const EMBEDDING_DIMS = 1024;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		const { xLog } = process.global;

		// -----
		// buildStandardBlock — serialize the forged graph into ONE PG-JSONL 'standard' block.
		//   Nodes already carry properties.embedding (number[]); serializeNodeLine expects a
		//   base64 scalar, so we encode here. resolutionKey IS the stableUriPropertyName value
		//   (greenfield, DECISIONS §1/§20).
		const buildStandardBlock = ({ forged }) => {
			const header = {
				blockType: 'standard',
				standardKey: forged.standardKey,
				version: forged.metadata.version,
				stableUriPropertyName: forged.stableUriPropertyName,
				resolutionKey: forged.stableUriPropertyName,
				embeddingModelVersion: 'voyage-4-large',
				embeddingEncoding: 'base64',
				embeddingDtype: 'float32',
				embeddingByteOrder: 'little-endian',
				embeddingDims: EMBEDDING_DIMS,
			};

			const nodes = forged.nodes.map((oneNode) => {
				// PG-JSON multi-valued arrays: every property value an array (embedding excepted).
				const properties = {};
				Object.keys(oneNode.properties).forEach((oneKey) => {
					if (oneKey === 'embedding' || oneKey === 'embeddingModelVersion') {
						return; // embedding is the base64 scalar exception; modelVersion rides the node
					}
					const value = oneNode.properties[oneKey];
					properties[oneKey] = Array.isArray(value) ? value : [value];
				});

				const serialized = {
					ref: { source: 'CEDS', id: oneNode.stableId },
					labels: oneNode.labels,
					stableId: oneNode.stableId,
					properties,
				};
				if (oneNode.properties.embedding) {
					serialized.embedding = replayBlock.encodeEmbedding(
						oneNode.properties.embedding,
					);
					serialized.embeddingModelVersion =
						oneNode.properties.embeddingModelVersion || 'voyage-4-large';
				}
				return serialized;
			});

			const edges = forged.edges.map((oneEdge) => {
				const properties = {};
				Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
					const value = oneEdge.properties[oneKey];
					properties[oneKey] = Array.isArray(value) ? value : [value];
				});
				return {
					type: oneEdge.type,
					fromRef: oneEdge.fromRef,
					toRef: oneEdge.toRef,
					properties,
				};
			});

			const blockText = replayBlock.serializeBlock({ header, nodes, edges });
			return { blockText, nodeCount: nodes.length, edgeCount: edges.length };
		};

		// -----
		// materialize — { forged, destination, type } -> { destination, location, replayResult }.
		//   Provisions the validation graph (or reuses an existing registry row), replays the
		//   standard block into it. type defaults 'ephemeral' (validation graph is ephemeral like
		//   bronze, DECISIONS §4). NEVER destroys on error.
		const materialize = ({ forged, destination, type = 'ephemeral' }, callback) => {
			const taskList = new taskListPlus();

			// serialize the block (pure)
			taskList.push((args, next) => {
				const block = buildStandardBlock({ forged });
				xLog.status(
					`[materializer] serialized standard block: ${block.nodeCount} nodes, ${block.edgeCount} edges`,
				);
				next('', { ...args, block });
			});

			// resolve-or-create the destination validation graph
			taskList.push((args, next) => {
				lifecycle.resolveAccessByName({ graphName: destination }, (err, access) => {
					if (!err && access && access.location) {
						xLog.status(
							`[materializer] destination '${destination}' already provisioned`,
						);
						next('', { ...args, access });
						return;
					}
					// not present -> create it
					xLog.status(
						`[materializer] provisioning validation graph '${destination}' (type=${type})...`,
					);
					lifecycle.createInstanceByName(
						{ graphName: destination, type },
						(createErr) => {
							if (createErr) {
								next(`materializer create '${destination}' failed: ${createErr}`);
								return;
							}
							lifecycle.resolveAccessByName(
								{ graphName: destination },
								(resolveErr, freshAccess) => {
									if (resolveErr) {
										next(resolveErr);
										return;
									}
									next('', { ...args, access: freshAccess });
								},
							);
						},
					);
				});
			});

			// replay the block into the destination via the Phase-2 engine
			taskList.push((args, next) => {
				const { access, block } = args;
				replayEngine.replay(
					{
						manifest: [block.blockText],
						boltUri: access.location,
						password: access.credential.value,
						graphName: destination,
					},
					(err, replayResult) => {
						if (err) {
							next(`materializer replay into '${destination}' failed: ${err}`);
							return;
						}
						next('', { ...args, replayResult });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					// NEVER tear down on error — leave the partial graph in place (DECISIONS §14).
					callback(err);
					return;
				}
				callback('', {
					destination,
					location: args.access.location,
					replayResult: args.replayResult,
					nodeCount: args.block.nodeCount,
					edgeCount: args.block.edgeCount,
				});
			});
		};

		return { materialize, buildStandardBlock };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
