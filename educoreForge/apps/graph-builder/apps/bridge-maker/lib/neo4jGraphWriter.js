'use strict';

// neo4jGraphWriter — the DEFAULT graphWriter: the real write-into-graph substrate bridgeMaker
// mints per run from the GraphHandle it is handed. It is the production twin of the graphWriter
// DOUBLE the suite injects (test-bridge-maker.js); both satisfy the same tiny contract, which is
// the whole point of making the writer injectable — the suite proves the plugin ->
// relationshipWriter -> graphWriter path with a double, and this module is what stands there in a
// real reforge (§3 hard line 2: the suite never opens a container).
//
//   neo4jGraphWriter({ inGraph }) -> {
//       writeRelationshipEdge({ fromStableId, toStableId, relationshipType, applyLabel,
//                               properties }, callback('', { edgeWritten }))
//       close(callback(''))
//   }
//
// It opens ONE driver+session from the handle's boltUrl+password (the same idiom replayManager
// uses at init/harvest — a handle carries its own credential and nothing else does), lazily on
// the first write, so the DEFAULT generic plugin (which writes zero edges in P0) never opens a
// connection at all. close() is safe to call whether or not a connection was ever opened.
//
// THE EDGE-METADATA SHAPE IS A P0 SEAM. writeRelationshipEdge stamps the applyLabel onto BOTH
// endpoint nodes and MERGEs the typed relationship carrying `properties`, which is exactly what
// replayManager.harvest's label-scoped selection (replay-engine.fetchEdgesWithinLabels: an edge
// whose BOTH endpoints carry the label) reads back out. What bridging metadata `properties`
// actually contains (predicate, confidence, provenanceTier, decisionBlockHash, ...) is authored
// by the producers in P2/P3; this module only needs the fields to WRITE them, and it does.
//
// relationshipType and applyLabel are interpolated (a Cypher relationship type and a label
// position cannot be parameterized), so each is validated as a bare identifier first — the same
// injection guard replay-engine applies to edge types and labels. `properties` and the stableIds
// are parameterized.

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ inGraph } = {}) => {
		let driver = null;
		let session = null;

		const ensureSession = () => {
			if (session) {
				return;
			}
			const neo4j = require('neo4j-driver');
			driver = neo4j.driver(inGraph.boltUrl, neo4j.auth.basic('neo4j', inGraph.password), {
				encrypted: false,
			});
			session = driver.session();
		};

		const writeRelationshipEdge = (
			{ fromStableId, toStableId, relationshipType, applyLabel, properties } = {},
			callback,
		) => {
			// bad interpolation targets are refused BY VALUE before a statement is built — a stray
			// character in a type or label is a fault, never something to sanitize into (polyArch2 §6).
			if (!IDENTIFIER_RE.test(String(relationshipType || ''))) {
				callback(
					`${moduleName}: relationshipType '${relationshipType}' is not a bare identifier ` +
						`(a Cypher relationship type is interpolated, not parameterized, so it must be safe).`,
				);
				return;
			}
			if (!IDENTIFIER_RE.test(String(applyLabel || ''))) {
				callback(
					`${moduleName}: applyLabel '${applyLabel}' is not a bare identifier (a Cypher label ` +
						`position is interpolated, not parameterized, so it must be safe).`,
				);
				return;
			}
			if (!fromStableId || !toStableId) {
				callback(
					`${moduleName}: a relationship edge needs both fromStableId and toStableId; got ` +
						`from='${fromStableId}', to='${toStableId}'.`,
				);
				return;
			}

			ensureSession();

			// stamp the label on both endpoints (so the harvest-by-label selection collects the edge)
			// and MERGE the typed relationship carrying its bridging properties.
			const cypher =
				`MATCH (from:ForgedNode {stableId: $fromStableId})\n` +
				`MATCH (to:ForgedNode {stableId: $toStableId})\n` +
				`MERGE (from)-[rel:\`${relationshipType}\`]->(to)\n` +
				`SET rel += $properties\n` +
				`SET from:\`${applyLabel}\`, to:\`${applyLabel}\``;

			session
				.run(cypher, {
					fromStableId,
					toStableId,
					properties: properties || {},
				})
				.then(() => callback('', { edgeWritten: true }))
				.catch((error) =>
					callback(`${moduleName}: writing ${relationshipType} edge failed: ${error.message}`),
				);
		};

		const close = (callback) => {
			if (!session) {
				callback('');
				return;
			}
			session
				.close()
				.then(() => driver.close())
				.then(() => callback(''))
				.catch((error) => callback(`${moduleName}: closing graph writer failed: ${error.message}`));
		};

		return { writeRelationshipEdge, close };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
