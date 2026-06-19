'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// schema-extractor.js — the -extractSchema engine of replayManager (helpSpec, DECISIONS §14).
//
// Serializes EXACTLY ONE PG-JSONL schemaBlock out of a live graph (graph -> block), via the
// Phase-2 engine's extractBlock. Three selectors (helpSpec OPTIONS):
//   standard      = one standard's nodes + internal edges (use --subject). extractBlock selector
//                   {source: subject}; header blockType 'standard'.
//   relationships = cross-standard bridge EDGES ONLY (NOT standard nodes — those are already
//                   captured as standard blocks; this keeps the consolidated relationships block
//                   from duplicating standard content). The block has 0 nodes. We discover the
//                   distinct _source values in the graph: with exactly two we drive the engine's
//                   bridge path (selector {pairA,pairB}); with more we gather ALL cross-source
//                   edges and serialize them as one bridge block.
//   overlay       = a tenant's delta. For the first app, modeled as a single-source extraction
//                   over --subject (the overlay owner); header blockType 'overlay'. The richer
//                   inherited-node-edit delta is downstream of the forger (helpSpec NOTES).
//
// The CLI passes boltUri + credential resolved BY NAME from the registry (1B) — never on the
// command line; this module holds NO SQL of its own for the standard/2-source paths (the engine
// owns it) and uses lifecycle.runCypher only for source-discovery + the N-source cross-edge gather.
//
// Async style: qtools taskListPlus/pipeRunner; engine/neo4j resolve at the leaf. No async/await,
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
const replayEngine = require(path.join(CORE_LIB, 'replay', 'replay-engine'));
const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));

const EMBEDDING_DIMS = 1024;

// A consistent embedding-header so extracted blocks deserialize round-trip (deserializeBlock
// requires a positive embeddingDims even for an edges-only block).
const embeddingHeaderFields = () => ({
	embeddingModelVersion: 'voyage-4-large',
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: EMBEDDING_DIMS,
});

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		const { xLog } = process.global;

		// -----
		// discoverSources — distinct _source values present in the graph (for the relationships
		//   selector, which is graph-wide rather than pair-named on the command line).
		const discoverSources = ({ from }, callback) => {
			lifecycle.runCypher(
				{
					graphName: from,
					cypher:
						'MATCH (n:ForgedNode) WHERE n._source IS NOT NULL RETURN DISTINCT n._source AS s ORDER BY s',
				},
				(err, result) => {
					if (err) {
						callback(err);
						return;
					}
					callback(
						'',
						result.records.map((oneRecord) => oneRecord.s),
					);
				},
			);
		};

		// -----
		// gatherAllCrossSourceEdges — every edge whose endpoints differ in _source (the N-source
		//   relationships path). Externalizes endpoints on stableId, ordered for byte-stability.
		//   Returns shaped edge objects ready for serializeBlock (0 nodes).
		const gatherAllCrossSourceEdges = ({ from }, callback) => {
			lifecycle.runCypher(
				{
					graphName: from,
					cypher: `MATCH (a:ForgedNode)-[r]->(b:ForgedNode)
						WHERE a._source <> b._source
						RETURN a._source AS fromSrc, a.stableId AS fromStableId, type(r) AS type,
						       b._source AS toSrc, b.stableId AS toStableId, properties(r) AS props
						ORDER BY fromSrc, fromStableId, type, toSrc, toStableId`,
				},
				(err, result) => {
					if (err) {
						callback(err);
						return;
					}
					const edges = result.records.map((oneRecord) => {
						const props = oneRecord.props || {};
						const properties = {};
						Object.keys(props).forEach((oneKey) => {
							const value = props[oneKey];
							properties[oneKey] = Array.isArray(value) ? value : [value];
						});
						return {
							type: oneRecord.type,
							fromRef: {
								source: oneRecord.fromSrc,
								id: oneRecord.fromStableId,
							},
							toRef: { source: oneRecord.toSrc, id: oneRecord.toStableId },
							properties,
						};
					});
					callback('', edges);
				},
			);
		};

		// -----
		// extractStandard — one standard's nodes + internal edges via the engine.
		const extractStandard = ({ access, subject }, callback) => {
			if (!subject) {
				callback('extractSchema --selector=standard requires --subject=<standardKey>');
				return;
			}
			const header = {
				blockType: 'standard',
				standardKey: subject,
				version: null,
				stableUriPropertyName: 'uri',
				resolutionKey: 'uri',
				goldenVersionAuthoredAgainst: null,
				...embeddingHeaderFields(),
			};
			replayEngine.extractBlock(
				{
					boltUri: access.location,
					password: access.credential.value,
					selector: { source: subject },
					header,
				},
				callback,
			);
		};

		// -----
		// extractOverlay — a tenant delta. First-app form: single-source extraction over the
		//   overlay owner (--subject); header blockType 'overlay'.
		const extractOverlay = ({ access, subject }, callback) => {
			if (!subject) {
				callback('extractSchema --selector=overlay requires --subject=<overlayOwner>');
				return;
			}
			const header = {
				blockType: 'overlay',
				standardKey: subject,
				version: null,
				stableUriPropertyName: 'uri',
				resolutionKey: 'uri',
				goldenVersionAuthoredAgainst: null,
				...embeddingHeaderFields(),
			};
			replayEngine.extractBlock(
				{
					boltUri: access.location,
					password: access.credential.value,
					selector: { source: subject },
					header,
				},
				(err, result) => {
					if (err) {
						callback(err);
						return;
					}
					// stamp the block header's blockType to 'overlay' is already in `header`, but
					// extractBlock serializes with the header we passed, so result.blockText carries it.
					callback('', result);
				},
			);
		};

		// -----
		// extractRelationships — cross-standard bridge edges ONLY (0 nodes). With exactly two
		//   sources, drive the engine's bridge path; with more, gather all cross-source edges.
		const extractRelationships = ({ access, from }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				discoverSources({ from }, (err, sources) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, sources });
				});
			});

			taskList.push((args, next) => {
				const { sources } = args;

				if (sources.length === 2) {
					// engine bridge path: header blockType 'bridge', selector {pairA,pairB}.
					const header = {
						blockType: 'bridge',
						pairA: sources[0],
						pairB: sources[1],
						stableUriPropertyName: 'uri',
						resolutionKey: 'uri',
						goldenVersionAuthoredAgainst: null,
						...embeddingHeaderFields(),
					};
					replayEngine.extractBlock(
						{
							boltUri: access.location,
							password: access.credential.value,
							selector: { pairA: sources[0], pairB: sources[1] },
							header,
						},
						(err, result) => {
							if (err) {
								next(err);
								return;
							}
							next('', { ...args, result });
						},
					);
					return;
				}

				// 0/1 sources => no cross-standard edges possible; >2 => gather all cross-source.
				gatherAllCrossSourceEdges({ from }, (err, edges) => {
					if (err) {
						next(err);
						return;
					}
					const header = {
						blockType: 'bridge',
						pairA: sources[0] || null,
						pairB: sources[sources.length - 1] || null,
						stableUriPropertyName: 'uri',
						resolutionKey: 'uri',
						goldenVersionAuthoredAgainst: null,
						...embeddingHeaderFields(),
					};
					const blockText = replayBlock.serializeBlock({
						header,
						nodes: [],
						edges,
					});
					next('', {
						...args,
						result: {
							blockText,
							nodeCount: 0,
							edgeCount: edges.length,
							stableIdCoverage: null,
						},
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', args.result);
			});
		};

		// -----
		// extractSchema — { from, selector, subject? } resolves access BY NAME, serializes exactly
		//   ONE block (selector-dispatched, registry-not-switch). Returns the engine extract result
		//   { blockText, nodeCount, edgeCount, stableIdCoverage }. Resolving access is the CLI's
		//   job upstream; we accept the already-resolved `access`.
		const selectorRegistry = {
			standard: extractStandard,
			relationships: (deps, callback) => extractRelationships(deps, callback),
			overlay: extractOverlay,
		};

		const extractSchema = ({ access, from, selector, subject }, callback) => {
			const handler = selectorRegistry[selector];
			if (!handler) {
				callback(
					`extractSchema: unknown --selector '${selector}' (standard|relationships|overlay)`,
				);
				return;
			}
			xLog.status(
				`[schema-extractor] extracting selector='${selector}'${subject ? ` subject='${subject}'` : ''} from '${from}'`,
			);
			handler({ access, from, subject }, (err, result) => {
				if (err) {
					callback(err);
					return;
				}
				xLog.status(
					`[schema-extractor] extracted block: ${result.nodeCount} node(s), ${result.edgeCount} edge(s)`,
				);
				callback('', result);
			});
		};

		return {
			extractSchema,
			discoverSources,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
