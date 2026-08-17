'use strict';

// ⚠️ CONNECTION DETAILS GO STALE: the bolt port and password below belonged to a container that existed on
// 2026-08-17 and may not now. Re-resolve with `docker inspect <containerName>` before re-running. Same
// warning and same reason as p0b_measureCollisionFloor.js — the house pattern for a retained graph probe on
// this forge. This repository is local-only and never pushed (order hard line), which is why a dev-container
// credential sits here rather than in configs; it is a PRECEDENT FOLLOWED, not a decision I made alone.
// p1_pescElementDeclKeys.js — LUNAR_PRISM (P1). READ-ONLY.
// THE ALLOW-LIST CANNOT BE WRITTEN FROM A REPORT'S RECOMMENDATION. P0 §5.4 recommends rendering
// 'owningTypeName' and a NEW SEAT 'typeDocumentation' — but a renderingAllowList names NODE PROPERTIES, and a
// name that is not a property renders nothing while looking declared. Dump keys(n) and check every proposed
// name against the observed set BEFORE writing the declaration.
const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');
const moduleName = 'p1_pescElementDeclKeys';
const PROPOSED_SUBJECT_NAME_LIST = ['name', 'owningTypeName', 'typeAsWritten', 'description', 'typeDocumentation', 'documentation', 'searchText', 'path', 'pescTier'];
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
runCypher({ cypher: 'MATCH (n:PescElementDecl) UNWIND keys(n) AS oneKey RETURN DISTINCT oneKey ORDER BY oneKey' }, (keyError, keyRecords) => {
	if (keyError) { finish(keyError); return; }
	const observedKeySet = keyRecords.map((r) => r.get('oneKey'));
	runCypher({ cypher: 'MATCH ()-[r]->() RETURN DISTINCT type(r) AS relType ORDER BY relType' }, (relError, relRecords) => {
		if (relError) { finish(relError); return; }
		finish('', {
			CAVEAT: 'Read from DEV_edfiDerived_260817, which PREDATES P0b re-embed. Property NAMES are structural and the re-embed changed only searchText VALUES on property-role declarations, so the key set is expected stable — but it is labelled as a pre-re-embed read and will be re-verified against the new block in P2.',
			pescElementDeclObservedKeyCount: observedKeySet.length,
			pescElementDeclObservedKeySet: observedKeySet,
			proposedSubjectNamesPRESENT: PROPOSED_SUBJECT_NAME_LIST.filter((n) => observedKeySet.indexOf(n) !== -1),
			proposedSubjectNamesABSENT_CANNOT_BE_RENDERED: PROPOSED_SUBJECT_NAME_LIST.filter((n) => observedKeySet.indexOf(n) === -1),
			graphRelationshipTypeList: relRecords.map((r) => r.get('relType')),
		});
	});
});
