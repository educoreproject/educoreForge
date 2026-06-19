'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeP6second.js — SYNTHETIC second forge bundle for the Phase-6 forgeManager test gate ONLY.
//
// NOT a real standard. Emits the forge() contract (forgeCeds.js return shape). Its _source is its
// OWN standardName ('synthstd') — distinct from the hub's 'CEDS' — which is exactly what the now-
// FIXED materializer preserves (ref.source = oneNode.properties._source). Each node carries a
// `cedsId` crossRef pointing at a forge-p6hub node's cedsId, so edf-bridge -specified --scope=synthstd
// resolves real SPECIFIED_MAPPING edges (src._source='synthstd' with cedsId -> hub _source='CEDS').
//
// PURE/deterministic; tiny deterministic 1024-dim embeddings (no Voyage). Injected embedder ignored.
//
// Async style: leaves resolve at the leaf; no async/await, no try/catch-for-control-flow. camelCase.

const fs = require('fs');
const path = require('path');

const STANDARD_KEY = 'synthstd'; // its own _source — distinct from the hub's 'CEDS'
const STABLE_URI_PROPERTY_NAME = 'uri';
const EMBEDDING_DIMS = 1024;

const deterministicEmbedding = (seed) => {
	const vector = new Array(EMBEDDING_DIMS);
	let hash = 2166136261;
	for (let i = 0; i < `${seed}`.length; i++) {
		hash ^= `${seed}`.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	for (let i = 0; i < EMBEDDING_DIMS; i++) {
		hash = (Math.imul(hash, 1103515245) + 12345) & 0x7fffffff;
		vector[i] = (hash / 0x7fffffff) * 2 - 1;
	}
	return vector;
};

const DEFAULT_SOURCE = path.join(__dirname, 'assets', 'source.json');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;

		const mappingInstruction = {
			cedsOriginalAnchorPropertyName: ['synth:cedsRef'],
			cedsOptionOriginalAnchorPropertyName: [],
			crosswalkPrefix: [],
			crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
			includeInImplied: true,
			impliedTargets: ['CEDS'],
		};

		// buildContractGraph — PURE. parsed -> { nodes, edges }. Each element carries cedsId
		// (the anchor that resolves to the hub) — the raw material for -specified.
		const buildContractGraph = ({ elements }) => {
			const nodes = [];
			const edges = [];

			const rootUri = 'urn:p6second:root';
			nodes.push({
				labels: ['ForgedNode', 'P6SecondClass', 'DmeStandardRoot'],
				stableId: rootUri,
				role: 'DmeStandardRoot',
				properties: {
					_id: `${STANDARD_KEY}:root`,
					_source: STANDARD_KEY, // 'synthstd'
					name: 'P6 Second',
					description: 'Synthetic Phase-6 second standard (test only)',
					role: 'DmeStandardRoot',
					uri: rootUri,
					standardKey: STANDARD_KEY,
					standardName: 'P6 Second',
					version: '1',
					searchText: 'DmeStandardRoot P6 Second',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(mappingInstruction),
				},
			});

			elements.forEach((oneElement) => {
				const uri = `urn:p6second:${oneElement.localId}`;
				nodes.push({
					labels: ['ForgedNode', 'P6SecondClass', 'DmeClass'],
					stableId: uri,
					role: 'DmeClass',
					properties: {
						_id: `${STANDARD_KEY}:${oneElement.localId}`,
						_source: STANDARD_KEY, // 'synthstd'
						name: oneElement.name,
						description: oneElement.description || '',
						role: 'DmeClass',
						uri,
						// canonical CEDS anchor (the forge normalized the native synth:cedsRef into cedsId);
						// specified-bridge resolves on THIS against the hub's cedsId.
						cedsId: oneElement.cedsRef,
						searchText: `DmeClass ${oneElement.name}`,
					},
				});
				edges.push({
					type: 'HAS_CLASS',
					fromRef: { source: STANDARD_KEY, id: rootUri },
					toRef: { source: STANDARD_KEY, id: uri },
					properties: { provenanceTier: 'structural' },
				});
			});

			return { nodes, edges };
		};

		const embedNodes = ({ nodes }) => {
			nodes.forEach((oneNode) => {
				const vector = deterministicEmbedding(oneNode.properties.searchText);
				oneNode.properties.embedding = vector;
				oneNode.embedding = vector;
				oneNode.properties.embeddingModelVersion = 'voyage-4-large';
				oneNode.embeddingModelVersion = 'voyage-4-large';
			});
		};

		const forge = ({ sourcePath } = {}, callback) => {
			const effectiveSource = sourcePath || DEFAULT_SOURCE;
			fs.readFile(effectiveSource, 'utf8', (readErr, raw) => {
				if (readErr) {
					callback(`forge-p6second: cannot read source '${effectiveSource}': ${readErr.message}`);
					return;
				}
				let parsed;
				try {
					parsed = JSON.parse(raw);
				} catch (jsonErr) {
					callback(`forge-p6second: source is not valid JSON: ${jsonErr.message}`);
					return;
				}
				const graph = buildContractGraph(parsed);
				embedNodes({ nodes: graph.nodes });
				if (xLog && xLog.status) {
					xLog.status(`[forge-p6second] forged ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
				}
				callback('', {
					nodes: graph.nodes,
					edges: graph.edges,
					metadata: { version: '1' },
					embedCallCount: 0,
					standardKey: STANDARD_KEY,
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
				});
			});
		};

		return { forge, buildContractGraph, STANDARD_KEY, STABLE_URI_PROPERTY_NAME };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
