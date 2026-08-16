'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphWriter.js — the ONE bolt-facing WRITE file of the Bridge Framework (SPEC-bridgeFramework-v1.md §5.7,
// §6, §14.1; RULINGS BF2, BF3, BF12, 12:20; named in apps/graph-builder/DOCTRINE.md). The ONLY door an edge
// goes through. The same contract as graphDouble.js's writer (the rules live in graphSeamRules.js):
//
//   graphWriterFactory({ inGraph, applyLabel, sourceStandardName }) → writer
//     writeMappingEdge({ subjectStableId, objectStableId, edgeType, edgeProperties }, cb(err, { edgeWritten: true }))
//       — the §6 refusals (mappingEdgeRefusal): edgeType ∉ SKOS_EDGE_TYPES; predicate ≠ type; a property outside
//         the CLOSED MAPPING_PROPERTIES set (NEW enforcement); judged without confidence / hash; specified with
//         confidence; justification outside the three; provenanceTier ≠ the producer-derived value; a missing
//         endpoint; an object that is not a HubReference; a subject whose _source ≠ the pairing's source
//       — stamps the PAIR-SCOPED applyLabel on BOTH endpoints (harvest matches (a:L)-[r]->(b:L)) and MERGEs the
//         edge on (from, type, to); a one-element attestationChannelList is stored as a real list (the writer's own
//         bolt session, not replay-engine's write path)
//     close(cb)
//
// The dispensation (DOCTRINE.md): .then().catch()-to-callback at the LEAF, here only; the driver required LAZILY.

const graphSeamRulesLib = require('./graphSeamRules');

const NEO4J_USER = 'neo4j';

const graphWriterFactory = ({ inGraph, applyLabel, sourceStandardName } = {}) => {
	const constructionError = graphSeamRulesLib.writerConstructionRefusal({ inGraph, applyLabel, sourceStandardName });
	if (constructionError) {
		throw constructionError;
	}
	if (typeof inGraph.boltUrl !== 'string' || typeof inGraph.password !== 'string') {
		throw new Error(`${moduleName} REFUSED: inGraph lacks boltUrl / password — the GraphHandle replayManager.create returns carries both`);
	}
	const neo4j = require('neo4j-driver'); // the ONE sanctioned require of the driver in the framework's write path
	const driver = neo4j.driver(inGraph.boltUrl, neo4j.auth.basic(typeof inGraph.user === 'string' ? inGraph.user : NEO4J_USER, inGraph.password), { encrypted: false });

	const writeMappingEdge = ({ subjectStableId, objectStableId, edgeType, edgeProperties } = {}, callback) => {
		// the cheap, endpoint-free refusals first (no session opened for a malformed edge)
		const shapeRefusal = graphSeamRulesLib.mappingEdgeRefusal({ subjectStableId, objectStableId, edgeType, edgeProperties, sourceStandardName, subjectEndpoint: { labels: [], sourceStandardName }, objectEndpoint: { labels: [graphSeamRulesLib.HUB_REFERENCE_LABEL] } });
		if (shapeRefusal) {
			callback(shapeRefusal.message);
			return;
		}
		const session = driver.session();
		session
			.run('OPTIONAL MATCH (s {stableId: $subjectStableId}) WITH s OPTIONAL MATCH (o {stableId: $objectStableId}) RETURN s._source AS subjectSource, labels(s) AS subjectLabels, s IS NOT NULL AS subjectPresent, labels(o) AS objectLabels, o.referenceTier AS objectReferenceTier, o IS NOT NULL AS objectPresent', { subjectStableId, objectStableId })
			.then((lookup) => {
				const row = lookup.records[0];
				const subjectEndpoint = row && row.get('subjectPresent') ? { labels: row.get('subjectLabels'), sourceStandardName: row.get('subjectSource') } : null;
				const objectEndpoint = row && row.get('objectPresent') ? { labels: row.get('objectLabels'), referenceTier: row.get('objectReferenceTier') } : null;
				const endpointRefusal = graphSeamRulesLib.mappingEdgeRefusal({ subjectStableId, objectStableId, edgeType, edgeProperties, sourceStandardName, subjectEndpoint, objectEndpoint });
				if (endpointRefusal) {
					return session.close().then(() => callback(endpointRefusal.message));
				}
				// the label and the edge type cannot be parameterised in Cypher — both were validated as identifiers above
				return session
					.run(`MATCH (s {stableId: $subjectStableId}) MATCH (o:${graphSeamRulesLib.HUB_REFERENCE_LABEL} {stableId: $objectStableId}) SET s:\`${applyLabel}\`, o:\`${applyLabel}\` MERGE (s)-[r:\`${edgeType}\`]->(o) SET r = $edgeProperties RETURN count(r) AS edgeCount`, { subjectStableId, objectStableId, edgeProperties })
					.then((written) => {
						const edgeCount = written.records[0] ? written.records[0].get('edgeCount') : 0;
						const wroteOne = neo4j.isInt(edgeCount) ? edgeCount.toNumber() === 1 : edgeCount === 1;
						return session.close().then(() => (wroteOne ? callback('', { edgeWritten: true }) : callback(`${moduleName}: MERGE ${subjectStableId} -[${edgeType}]-> ${objectStableId} reported ${String(edgeCount)} edges, not 1 — an un-counted write cannot be gated`)));
					});
			})
			.catch((runError) => {
				session.close().then(() => callback(`${moduleName}: ${runError.message}`)).catch(() => callback(`${moduleName}: ${runError.message}`));
			});
	};
	const close = (callback) => {
		driver.close().then(() => callback('')).catch((closeError) => callback(`${moduleName}: driver close: ${closeError.message}`));
	};
	return graphSeamRulesLib.closedWriter({ writeMappingEdge, close });
};

module.exports = { graphWriterFactory, moduleName };
