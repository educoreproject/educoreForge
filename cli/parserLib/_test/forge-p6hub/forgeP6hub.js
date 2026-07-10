'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeP6hub.js — SYNTHETIC forge bundle for the Phase-6 forgeManager test gate ONLY.
//
// NOT a real standard. It exists to exercise edf-forge-manager -addStandard end-to-end WITHOUT
// the cost of the full CEDS RDF parse + Voyage embeddings. It emits the SAME forge() contract the
// CLI consumes (forgeCeds.js return shape): { nodes, edges, metadata, embedCallCount, standardKey,
// stableUriPropertyName }.
//
// The HUB role: its nodes are the CEDS-equivalent targets. specified-bridge matches the hub-side
// EXACTLY against the canonical cedsHubStandardName ('CEDS', from the registry) and resolves on the
// `cedsId` property, so this bundle sets every node's _source to the canonical 'CEDS' and stamps a
// canonical `cedsId`. The second synthetic standard (forge-p6second) carries `cedsId` crossRefs that
// resolve against these.
//
// PURE/deterministic for (source). Embeddings are tiny deterministic 1024-dim vectors generated
// here (NO Voyage call) so replay's vector-index phase has a real, cheap dimension to build on and
// the golden ≡ replay round-trip is exercised including the embedding codec. The injected real
// embedder is intentionally ignored — keeping the gate self-contained and key-free.
//
// Async style: leaves resolve at the leaf; no async/await, no try/catch-for-control-flow. camelCase.

const fs = require('fs');
const path = require('path');

// core-lib snapshot-provenance helper (BINDING spec §3.3, Phase A) — resolved relative to this
// bundle (cli/parserLib/_test/<bundle>/ -> code root -> npm/qtools-graph-forge-core/lib).
const { deriveVersionStamp } = require(path.join(
	__dirname, '..', '..', '..', '..',
	'npm', 'qtools-graph-forge-core', 'lib', 'snapshot-provenance', 'snapshot-provenance',
));

const STANDARD_KEY = 'CEDS'; // hub IS the CEDS-equivalent; matches the registry's cedsHubStandardName
const STABLE_URI_PROPERTY_NAME = 'uri';
const EMBEDDING_DIMS = 1024;

// deterministic tiny embedding from a seed string — same string => identical vector (purity).
const deterministicEmbedding = (seed) => {
	const vector = new Array(EMBEDDING_DIMS);
	let hash = 2166136261;
	for (let i = 0; i < `${seed}`.length; i++) {
		hash ^= `${seed}`.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	for (let i = 0; i < EMBEDDING_DIMS; i++) {
		// cheap LCG off the seed hash; bounded to [-1,1], float32-stable.
		hash = (Math.imul(hash, 1103515245) + 12345) & 0x7fffffff;
		vector[i] = (hash / 0x7fffffff) * 2 - 1;
	}
	return vector;
};

// snapshot layout (spec §3.5, Phase A): synthetic bundles conform to the standard
// assets/standardSourceData/<snapshot>/ shape — one validation rule holds everywhere.
const DEFAULT_SOURCE = path.join(__dirname, 'assets', 'standardSourceData', '01', 'source.json');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;

		// mappingInstruction declared on the root (CEDS-style: present-but-unpopulated anchors).
		const mappingInstruction = {
			cedsOriginalAnchorPropertyName: ['dc:identifier'],
			cedsOptionOriginalAnchorPropertyName: [],
			crosswalkPrefix: [],
			crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
			includeInImplied: true,
			impliedTargets: ['CEDS'],
		};

		// buildContractGraph — PURE. parsed source -> { nodes, edges }.
		const buildContractGraph = ({ classes }) => {
			const nodes = [];
			const edges = [];

			const rootUri = 'urn:p6hub:root';
			nodes.push({
				labels: ['ForgedNode', 'P6HubClass', 'DmeStandardRoot'],
				stableId: rootUri,
				role: 'DmeStandardRoot',
				properties: {
					_id: `${STANDARD_KEY}:root`,
					_source: STANDARD_KEY, // 'CEDS' — the canonical hub identity
					name: 'P6 Hub',
					description: 'Synthetic Phase-6 hub standard (test only)',
					role: 'DmeStandardRoot',
					uri: rootUri,
					standardKey: STANDARD_KEY,
					standardName: 'P6 Hub',
					version: '1',
					searchText: 'DmeStandardRoot P6 Hub',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(mappingInstruction),
				},
			});

			classes.forEach((oneClass) => {
				const uri = `urn:p6hub:${oneClass.cedsId}`;
				nodes.push({
					labels: ['ForgedNode', 'P6HubClass', 'DmeClass'],
					stableId: uri,
					role: 'DmeClass',
					properties: {
						_id: `${STANDARD_KEY}:${oneClass.cedsId}`,
						_source: STANDARD_KEY, // 'CEDS'
						name: oneClass.name,
						description: oneClass.description || '',
						role: 'DmeClass',
						uri,
						cedsId: oneClass.cedsId, // the canonical anchor the second std resolves to
						searchText: `DmeClass ${oneClass.name}`,
					},
				});
				// canonical ownership edge (structural tier — required by the engine's provenance gate)
				edges.push({
					type: 'HAS_CLASS',
					fromRef: { source: STANDARD_KEY, id: rootUri },
					toRef: { source: STANDARD_KEY, id: uri },
					properties: { provenanceTier: 'structural' },
				});
			});

			return { nodes, edges };
		};

		// embedNodes — stamp deterministic tiny embeddings (no Voyage call).
		const embedNodes = ({ nodes }) => {
			nodes.forEach((oneNode) => {
				const vector = deterministicEmbedding(oneNode.properties.searchText);
				oneNode.properties.embedding = vector;
				oneNode.embedding = vector;
				oneNode.properties.embeddingModelVersion = 'voyage-4-large';
				oneNode.embeddingModelVersion = 'voyage-4-large';
			});
		};

		// forge — parse -> buildContractGraph -> embed (all synchronous; resolve at the leaf).
		const forge = ({ sourcePath } = {}, callback) => {
			const effectiveSource = sourcePath || DEFAULT_SOURCE;
			fs.readFile(effectiveSource, 'utf8', (readErr, raw) => {
				if (readErr) {
					callback(`forge-p6hub: cannot read source '${effectiveSource}': ${readErr.message}`);
					return;
				}
				let parsed;
				try {
					parsed = JSON.parse(raw);
				} catch (jsonErr) {
					callback(`forge-p6hub: source is not valid JSON: ${jsonErr.message}`);
					return;
				}
				const graph = buildContractGraph(parsed);
				// version-provenance stamp (spec §3.3, Phase A): the synthetic source does not
				// self-describe, so the snapshot's standardSourceLocation supplies publishedVersion
				// ('synthetic-01', versionSource 'provenance-file'). Stamped onto the root + metadata.
				const versionStamp = deriveVersionStamp({
					sourcePath: effectiveSource,
					sourceVersion: null,
					warn: (message) => (xLog && xLog.error ? xLog.error(message) : console.error(message)),
				});
				Object.assign(
					graph.nodes.find((oneNode) => oneNode.role === 'DmeStandardRoot').properties,
					versionStamp,
				);
				embedNodes({ nodes: graph.nodes });
				if (xLog && xLog.status) {
					xLog.status(`[forge-p6hub] forged ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
				}
				callback('', {
					nodes: graph.nodes,
					edges: graph.edges,
					metadata: { version: '1', ...versionStamp },
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
