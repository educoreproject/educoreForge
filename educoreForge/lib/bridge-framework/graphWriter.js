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
//         confidence; justification outside the three; provenanceTier outside the 3-tier permitted list (the
//         EQUALITY to the producer-derived value lives in materialiser.provenanceTierFor — the writer never sees
//         producerKind); a missing
//         endpoint; an object that is not a HubReference; a subject whose _source ≠ the pairing's source
//       — stamps the PAIR-SCOPED applyLabel on BOTH endpoints (harvest matches (a:L)-[r]->(b:L)) and MERGEs the
//         edge on (from, type, to); a one-element attestationChannelList is stored as a real list (the writer's own
//         bolt session, not replay-engine's write path)
//     close(cb)
//
// The dispensation (DOCTRINE.md): .then().catch()-to-callback at the LEAF, here only; the driver required LAZILY.

const path = require('path');
const graphSeamRulesLib = require('./graphSeamRules');
// ⟪JOB 5a⟫ THE SAME identity guard the loader's write path uses. THREE WRITE DOORS now exist —
// replay-engine's mergeEdges, this one, and graphDouble's — plus a FOURTH EMULATION that is NOT a
// door: test/testSupport/boltDriverDouble, a fake driver that pattern-matches THIS FILE'S cypher and
// emulates its merge, so a change here reaches it twice — once by text and once by semantics. They
// must not disagree about what counts as the same edge or about what may enter an identity map.
// Sharing the SEMANTICS rather than the function is deliberate: this door batches differently, stamps the pair-scoped label the
// harvest selects on, resolves endpoints differently, and carries a CLOSED §6 refusal set that has
// no business inside the loader.
const replayEngineLib = require(path.join(__dirname, '..', 'replay', 'replay-engine'))();
const { identityHostileValue } = replayEngineLib;

const NEO4J_USER = 'neo4j';

const graphWriterFactory = ({ inGraph, applyLabel, sourceStandardName } = {}) => {
	const constructionError = graphSeamRulesLib.writerConstructionRefusal({ inGraph, applyLabel, sourceStandardName });
	if (constructionError) {
		throw constructionError;
	}
	// ⟪JOB 5b⟫ THE LOADED SIDE OF THE CONSERVATION GATE, FOR THE BRIDGE DOOR. Accumulated as the
	// writes happen and read at close, for the same reason replayManager.init captures its own at load
	// time: the depGraph is destroyed after harvest, so a set re-derived later would measure the graph
	// twice and the written set never. Held as the loader's own shapes (a stableId per stamped node, an
	// identity per written edge) and turned into a summary by the SHARED conservationSummaryFor, so this
	// door and the loader door cannot drift apart in how they say what they wrote.
	const loadedNodeStableIdSet = new Set();
	const loadedEdgeList = [];
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
		// ⟪JOB 5a⟫ the edge properties ARE the merge identity now, so a null / undefined / [null] among
		// them decides which relationship this edge merges onto. Refuse by name before a session opens.
		//
		// WHAT THIS GUARD IS PROVEN AGAINST **ON THIS DOOR**, stated exactly (RULING TWILIGHT_ARROW
		// 2026-09-02): ONE shape — an ARRAY HOLDING NULL. It is NOT proven here for a bare null or a
		// bare undefined, because those never reach it: §6's required-property check reads an absent
		// value as ABSENT and refuses first, with a more specific message naming the missing property.
		// That ordering is deliberate and the guard STAYS BEHIND §6 — a caller is better served by
		// "property X is absent" than by "identity-hostile". All THREE shapes are proven on the LOADER
		// door, where no required-property check precedes them. Do not upgrade this comment to "three"
		// without observing the other two red HERE first; they will not go red, and that is correct.
		const hostileNameList = Object.keys(edgeProperties || {}).filter((oneName) => identityHostileValue(edgeProperties[oneName]));
		if (hostileNameList.length > 0) {
			callback(`${moduleName} REFUSED: edge ${edgeType} ${subjectStableId} -> ${objectStableId} carries identity-hostile propert(ies) — null, undefined, or an array holding null: ${hostileNameList.join(', ')}. Edge properties are the relationship's merge identity; a null there decides which relationship the edge merges onto and is never defaulted. Nothing written.`);
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
				// the LABEL cannot be parameterised in Cypher and is interpolated after being validated as an
				// identifier above. THE EDGE TYPE NO LONGER IS: as of the JOB 5a change below it travels as a
				// PARAMETER to apoc.merge.relationship, which takes the type as a string — so one of the two
				// interpolation surfaces this line used to describe is closed.
				// ⟪JOB 5a⟫ THE MERGE KEYS ON THE FULL PROPERTY MAP. The previous form was
				//   MERGE (s)-[r:`TYPE`]->(o) SET r = $edgeProperties
				// which matched ANY relationship of that type between the pair and then REPLACED its
				// properties wholesale, so two mapping claims differing only in a property VALUE collapsed
				// into one carrying the last writer's. apoc.merge.relationship matches on the identity map
				// it is handed and stores no synthetic key, so distinct claims survive and identical ones
				// still merge. Same form, same identity definition, as replay-engine's mergeEdges.
				// THE `SET r =` IS GONE AND ITS ABSENCE IS THE POINT: once identity IS the property map, a
				// matched relationship ALREADY carries exactly these properties, so the assignment could
				// only ever write what was already there. A dead SET invites a reader to believe property
				// updates happen here. MEASURED 2026-09-02: no rebridge path writes onto prior bridge
				// output — the depGraph is created and destroyed inside bridgeOnePairing, no handle escapes,
				// the label is pair-scoped, and --rebridge governs the inference pre-pass and not the graph
				// lifecycle — so there is no in-place update to preserve.
				// $edgeType is a PARAMETER now rather than a backtick-templated identifier; apoc takes the
				// type as a string, which also closes the interpolation surface the template form opened.
				return session
					.run(`MATCH (s {stableId: $subjectStableId}) MATCH (o:${graphSeamRulesLib.HUB_REFERENCE_LABEL} {stableId: $objectStableId}) SET s:\`${applyLabel}\`, o:\`${applyLabel}\` WITH s, o CALL apoc.merge.relationship(s, $edgeType, $edgeProperties, {}, o) YIELD rel RETURN count(rel) AS edgeCount`, { subjectStableId, objectStableId, edgeType, edgeProperties })
					.then((written) => {
						const edgeCount = written.records[0] ? written.records[0].get('edgeCount') : 0;
						const wroteOne = neo4j.isInt(edgeCount) ? edgeCount.toNumber() === 1 : edgeCount === 1;
						// ⟪JOB 5b⟫ record ONLY on a confirmed single-relationship merge. A write that reported
						// anything but 1 refuses below and must not enter the loaded set — a gate fed by writes
						// that may not have landed certifies nothing.
						if (wroteOne) {
							loadedNodeStableIdSet.add(subjectStableId);
							loadedNodeStableIdSet.add(objectStableId);
							loadedEdgeList.push({ type: edgeType, fromRef: { id: subjectStableId }, toRef: { id: objectStableId }, properties: { ...edgeProperties } });
						}
						return session.close().then(() => (wroteOne ? callback('', { edgeWritten: true }) : callback(`${moduleName}: MERGE ${subjectStableId} -[${edgeType}]-> ${objectStableId} reported ${String(edgeCount)} edges, not 1 — an un-counted write cannot be gated`)));
					});
			})
			.catch((runError) => {
				session.close().then(() => callback(`${moduleName}: ${runError.message}`)).catch(() => callback(`${moduleName}: ${runError.message}`));
			});
	};
	// ⟪JOB 5b⟫ close RETURNS the loaded summary as its second callback argument rather than exposing a
	// third member: the writer's member set is CLOSED to writeMappingEdge and close (BR-018), and a
	// conservation summary is not a new capability of the seam — it is what the seam DID, reported as it
	// shuts. closedShape gates member ACCESS, not callback arity, so this needs no vocabulary change.
	// ⟪JOB 5b⟫ PG-JSON SHAPE, APPLIED HERE FOR THE SAME REASON THE FORGER APPLIES IT THERE.
	// edgeConservationIdentityFor is SHAPE-SENSITIVE: provenanceTier="x" and provenanceTier=["x"] are
	// different identities. The harvested side is ALWAYS array-shaped — replay-engine's shapeEdgeProps
	// runs pgArray over every value at the GRAPH READ (fetchEdgesWithinLabels), before any block text
	// exists. The loader door's loaded side matches it because the forger's shape-forged-graph wraps
	// every edge property value on the way to init. NOTHING does that for the bridge door: MEASURED
	// 2026-09-02, the materialiser hands the writer 15 scalar values out of 16 (only
	// attestationChannelList is natively an array). A summary built from those raw values would
	// mismatch the harvest on EVERY edge. So the shape is applied to the SUMMARY, where it belongs —
	// not to what is written (the stored form is apoc's business and conjunct (f) defends it), and not
	// inside the identity function, which four emulations share and whose meaning of "the same edge"
	// must not move.
	const pgShaped = (properties) => {
		const out = {};
		Object.keys(properties || {}).forEach((oneName) => {
			const oneValue = properties[oneName];
			out[oneName] = Array.isArray(oneValue) ? oneValue : [oneValue];
		});
		return out;
	};
	const loadedConservationSummaryNow = () => replayEngineLib.conservationSummaryFor({
		nodes: Array.from(loadedNodeStableIdSet).sort().map((oneStableId) => ({ stableId: oneStableId })),
		edges: loadedEdgeList.map((oneEdge) => ({ ...oneEdge, properties: pgShaped(oneEdge.properties) })),
	});
	const close = (callback) => {
		driver.close().then(() => callback('', { loadedConservationSummary: loadedConservationSummaryNow() })).catch((closeError) => callback(`${moduleName}: driver close: ${closeError.message}`));
	};
	return graphSeamRulesLib.closedWriter({ writeMappingEdge, close });
};

module.exports = { graphWriterFactory, moduleName };
