'use strict';
// p1_conceptGrainSeam.js — LUNAR_PRISM (P1), 2026-08-17. READ-ONLY, against a LIVE scratch graph.
//
// ⚠️ THE TRAP THIS PROBE EXISTS TO KEEP SOMEONE OUT OF. The scope list groups by
// (name, typeAsWritten, effectiveDescription). effectiveDescription is now a STAMPED PROPERTY, so
// reading it is the obvious move — AND IT IS THE WRONG GRAIN. The stamped value resolves through
// DERIVED-ONLY RESOLVES_TO edges, because that is what the forge's searchText composition does and
// the composition runs BEFORE the synthetic tier. TQ's ruled scope (a-prime, 2,213) resolves through
// ALL RESOLVES_TO edges INCLUDING THE SYNTHETIC TIER'S 407.
//
// That is RULING P0b-R2's seam: "a bridge dedupping over the final graph sees 2,213 groups whose
// members were EMBEDDED at a grain that would have counted 2,347." Neither rule is wrong; they answer
// different questions. THIS PROBE MEASURES BOTH ON THE SAME GRAPH so the difference is a number
// rather than a paragraph, and so the scope tool's rule is CHOSEN rather than inherited.
//
// CONNECTION DETAILS GO STALE: the port and password below belonged to a scratch container that
// existed on 2026-08-17 and is disposed. Re-resolve with `docker inspect` before re-running.

const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');
const moduleName = 'p1_conceptGrainSeam';
const BOLT_URL = process.env.P1_BOLT_URL || 'bolt://localhost:7811';
const NEO4J_PASSWORD = process.env.P1_BOLT_PASSWORD || 're5OU3hWKTfXu6zTlYwn1rwt';

const driver = neo4j.driver(BOLT_URL, neo4j.auth.basic('neo4j', NEO4J_PASSWORD), { encrypted: false });
const runCypher = ({ cypher }, callback) => {
	const session = driver.session();
	session.run(cypher)
		.then((result) => { session.close().then(() => callback('', result.records)).catch((e) => callback(`${moduleName}: ${e.message}`)); })
		.catch((e) => { session.close().then(() => callback(`${moduleName}: ${e.message}`)).catch(() => callback(`${moduleName}: ${e.message}`)); });
};
const finish = (errorText, report) => {
	driver.close().then(() => {
		if (errorText) { process.stdout.write(`${errorText}\n`); process.exitCode = 1; return; }
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	}).catch((e) => { process.stdout.write(`${moduleName}: ${e.message}\n`); process.exitCode = 1; });
};

// ALL-EDGES grain — TQ's ruled rule. The element's own description, else its RESOLVES_TO type's,
// counting EVERY RESOLVES_TO edge (derived tier's 17,299 AND the synthetic tier's 407).
const ALL_EDGES_CYPHER = `
MATCH (n:PescElementDecl) WHERE n.pescTier = 'source'
OPTIONAL MATCH (n)-[:RESOLVES_TO]->(t:PescNamedDefinition)
WITH n, head(collect(CASE WHEN t.description IS NOT NULL AND t.description <> '' THEN t.description END)) AS resolvedProse
WITH n, CASE WHEN n.description IS NOT NULL AND n.description <> '' THEN n.description ELSE coalesce(resolvedProse,'') END AS effDesc
RETURN count(DISTINCT n.name + '\\u0001' + coalesce(n.typeAsWritten,'') + '\\u0001' + effDesc) AS conceptCount, count(n) AS declarationCount`;

// STAMPED grain — what the forge actually composed on (derived-only edges), read straight off the node.
const STAMPED_CYPHER = `
MATCH (n:PescElementDecl) WHERE n.pescTier = 'source'
RETURN count(DISTINCT n.name + '\\u0001' + coalesce(n.typeAsWritten,'') + '\\u0001' + coalesce(n.effectiveDescription,'')) AS conceptCount, count(n) AS declarationCount`;

runCypher({ cypher: ALL_EDGES_CYPHER }, (allError, allRecords) => {
	if (allError) { finish(allError); return; }
	runCypher({ cypher: STAMPED_CYPHER }, (stampedError, stampedRecords) => {
		if (stampedError) { finish(stampedError); return; }
		const num = (v) => (neo4j.isInt(v) ? v.toNumber() : v);
		const allEdges = { concepts: num(allRecords[0].get('conceptCount')), declarations: num(allRecords[0].get('declarationCount')) };
		const stamped = { concepts: num(stampedRecords[0].get('conceptCount')), declarations: num(stampedRecords[0].get('declarationCount')) };
		finish('', {
			measuredAgainst: { boltUrl: BOLT_URL, container: 'DEV_gb_materialize_94765_2', note: 'a LIVE graph built from THIS phase\'s re-forged block c46991d1…, so these are figures about the artifact that will ship — not about the pre-re-embed graph P0 measured' },
			ALL_EDGES_GRAIN_TQ_RULED_SCOPE: allEdges,
			STAMPED_GRAIN_WHAT_THE_FORGE_COMPOSED_ON: stamped,
			difference: stamped.concepts - allEdges.concepts,
			reading:
				allEdges.concepts === stamped.concepts
					? 'THE TWO GRAINS AGREE ON THIS GRAPH — the seam does not materialise here, and that itself must be reported rather than assumed away.'
					: 'THE TWO GRAINS DIFFER, exactly as RULING P0b-R2 measured. THE SCOPE TOOL MUST COMPUTE THE ALL-EDGES DESCRIPTION ITSELF AND MUST NOT READ THE STAMPED PROPERTY — reading the stamped value would silently build to the FORGE\'s grain instead of TQ\'s ruled scope.',
			expectedFromTheRecord: { ruledAllEdges: 2213, forgeDerivedOnly: 2347, source: 'RULING P0b-R2 table, DEVLOG-P §5c — quoted, not re-derived here' },
		});
	});
});
