'use strict';

// ⚠️ CONNECTION DETAILS GO STALE: the bolt port and password below belonged to a container that existed on
// 2026-08-17 and may not now. Re-resolve with `docker inspect <containerName>` before re-running. Same
// warning and same reason as p0b_measureCollisionFloor.js — the house pattern for a retained graph probe on
// this forge. This repository is local-only and never pushed (order hard line), which is why a dev-container
// credential sits here rather than in configs; it is a PRECEDENT FOLLOWED, not a decision I made alone.
// p1_pescOptionSetSubjects.js — LUNAR_PRISM (P1). READ-ONLY.
// What do the 156 option-set SUBJECTS actually look like on the retrieval side?
// KEYS DUMPED FIRST. And note the graph read here PREDATES P0b's re-embed, which is stated in the output
// rather than left for a reader to discover: P0b recomposed PROPERTY-ROLE declarations only.
const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');
const moduleName = 'p1_pescOptionSetSubjects';
const driver = neo4j.driver('bolt://localhost:7817', neo4j.auth.basic('neo4j', 'LPnzVJjt3JkBeIzH4dUeeRrQ'), { encrypted: false });
const runCypher = ({ cypher, parameters }, callback) => {
	const session = driver.session();
	session.run(cypher, parameters || {})
		.then((result) => { session.close().then(() => callback('', result.records)).catch((e) => callback(`${moduleName}: ${e.message}`)); })
		.catch((e) => { session.close().then(() => callback(`${moduleName}: ${e.message}`)).catch(() => callback(`${moduleName}: ${e.message}`)); });
};
const finish = (errorText, report) => {
	driver.close().then(() => {
		if (errorText) { process.stdout.write(`${errorText}\n`); process.exitCode = 1; return; }
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	}).catch((e) => { process.stdout.write(`${moduleName}: ${e.message}\n`); process.exitCode = 1; });
};
runCypher({ cypher: 'MATCH (n:PescNamedDefinition) UNWIND keys(n) AS oneKey RETURN DISTINCT oneKey ORDER BY oneKey' }, (keyError, keyRecords) => {
	if (keyError) { finish(keyError); return; }
	const observedKeySet = keyRecords.map((r) => r.get('oneKey'));
	['role', 'pescTier', 'searchText', 'description', 'reachableFromLatestRoot', 'sameDefinitionClusterId', 'name'].forEach(() => {});
	const missing = ['role', 'pescTier', 'searchText', 'description', 'reachableFromLatestRoot', 'name'].filter((n) => observedKeySet.indexOf(n) === -1);
	if (missing.length) { finish(`${moduleName} REFUSED: names absent from keys(n): ${missing.join(', ')}. Observed: ${observedKeySet.join(', ')}`); return; }
	runCypher({
		cypher: "MATCH (n:PescNamedDefinition) WHERE n.pescTier = 'source' AND n.role = 'DmeOptionSet' AND n.reachableFromLatestRoot = true " +
			"RETURN count(n) AS nodeCount, count(CASE WHEN n.description IS NOT NULL AND trim(n.description) <> '' THEN 1 END) AS withProse, " +
			'avg(size(n.searchText)) AS meanSearchTextChars, max(size(n.searchText)) AS maxSearchTextChars, avg(size(coalesce(n.description,""))) AS meanDescriptionChars'
	}, (aggError, aggRecords) => {
		if (aggError) { finish(aggError); return; }
		const a = aggRecords[0];
		const num = (v) => (neo4j.isInt(v) ? v.toNumber() : v);
		runCypher({
			cypher: "MATCH (n:PescNamedDefinition) WHERE n.pescTier = 'source' AND n.role = 'DmeOptionSet' AND n.reachableFromLatestRoot = true " +
				'RETURN n.name AS name, n.searchText AS searchText, substring(coalesce(n.description,""),0,120) AS descriptionHead ORDER BY n.stableId LIMIT 6'
		}, (sampleError, sampleRecords) => {
			if (sampleError) { finish(sampleError); return; }
			finish('', {
				CAVEAT: 'This graph PREDATES P0b\'s re-embed. P0b recomposed PROPERTY-ROLE declarations only, so DmeOptionSet named definitions were NOT recomposed and this IS their shipped shape — but the figure is read from the PRE-re-embed graph and is labelled as such rather than asserted of the current block.',
				observedKeyCount: observedKeySet.length,
				latestReachableSourceOptionSetNodeCount: num(a.get('nodeCount')),
				withNonEmptyDescription: num(a.get('withProse')),
				meanSearchTextChars: num(a.get('meanSearchTextChars')),
				maxSearchTextChars: num(a.get('maxSearchTextChars')),
				meanDescriptionChars: num(a.get('meanDescriptionChars')),
				sample: sampleRecords.map((r) => ({ name: r.get('name'), searchText: r.get('searchText'), descriptionHead: r.get('descriptionHead') })),
			});
		});
	});
});
