'use strict';

// ⚠️ CONNECTION DETAILS GO STALE: the bolt port and password below belonged to a container that existed on
// 2026-08-17 and may not now. Re-resolve with `docker inspect <containerName>` before re-running. Same
// warning and same reason as p0b_measureCollisionFloor.js — the house pattern for a retained graph probe on
// this forge. This repository is local-only and never pushed (order hard line), which is why a dev-container
// credential sits here rather than in configs; it is a PRECEDENT FOLLOWED, not a decision I made alone.

// p1_rangeOptionSetFillRate.js — LUNAR_PRISM (P1), 2026-08-17. READ-ONLY MEASUREMENT.
//
// CONDITION 1 of RULING P1-R2 (SABLE_RIVER): the second plugin's semantic case rests on the CEDS property
// card carrying rangeOptionSetName / rangeOptionSetDefinition. Measure the fill rate over the 2,777
// property-tier HubReference cards. COUNT NON-EMPTY VALUES, NEVER KEY PRESENCE — this order has been bitten
// twice by presence-versus-population.
//
// THE TRAP THIS SCRIPT IS BUILT AROUND: a wrong property name returns NULL on every node rather than
// erroring, so a typo and a genuine absence are INDISTINGUISHABLE from the result. It has already bitten
// pescTier-not-tier and referenceTier-not-tier in this one order. So STEP 1 DUMPS keys(n) AND EVERY NAME
// COUNTED IN STEP 2 IS CHECKED AGAINST THAT OBSERVED KEY SET FIRST. A name absent from the observed keys is
// REFUSED BY NAME rather than counted as zero.
//
// Reads nothing but HubReference nodes. Writes nothing. Creates no session it does not close.

const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');

const moduleName = 'p1_rangeOptionSetFillRate';
const BOLT_URL = 'bolt://localhost:7817';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'LPnzVJjt3JkBeIzH4dUeeRrQ';
const PROPERTY_TIER = 'property';

// the two names the semantic case depends on, plus two controls whose fill rate is already on the record
// (P0 §7.3: propertyDefinition absent on exactly 3 of 2,777). A control that reproduces a known figure is
// what tells us the counter itself works.
const MEASURED_NAME_LIST = ['rangeOptionSetName', 'rangeOptionSetDefinition', 'propertyDefinition', 'name'];

const driver = neo4j.driver(BOLT_URL, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD), { encrypted: false });

const runCypher = ({ cypher, parameters }, callback) => {
	const session = driver.session();
	session
		.run(cypher, parameters || {})
		.then((result) => {
			session
				.close()
				.then(() => callback('', result.records))
				.catch((closeError) => callback(`${moduleName}: session close: ${closeError.message}`));
		})
		.catch((runError) => {
			session.close().then(() => callback(`${moduleName}: ${runError.message}`)).catch(() => callback(`${moduleName}: ${runError.message}`));
		});
};

// STEP 1 — the observed key set. Union of keys(n) over every property-tier card, so a name that exists on
// only some cards is still seen.
const readObservedKeySet = (callback) => {
	runCypher(
		{
			cypher: 'MATCH (n:HubReference) WHERE n.referenceTier = $referenceTier UNWIND keys(n) AS oneKey RETURN DISTINCT oneKey ORDER BY oneKey',
			parameters: { referenceTier: PROPERTY_TIER },
		},
		(readError, records) => {
			if (readError) {
				callback(readError);
				return;
			}
			callback('', records.map((oneRecord) => oneRecord.get('oneKey')));
		}
	);
};

// STEP 2 — the counts, only for names PROVEN to exist in the observed key set.
const readFillRates = ({ observedKeySet }, callback) => {
	const unknownName = MEASURED_NAME_LIST.find((oneName) => observedKeySet.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		callback(
			`${moduleName} REFUSED: '${unknownName}' does not appear in keys(n) on ANY property-tier HubReference card. ` +
				`Counting it would report 0 and be indistinguishable from a typo. Observed keys: ${observedKeySet.join(', ')}`
		);
		return;
	}
	const countClauseList = MEASURED_NAME_LIST.map(
		(oneName) => `count(CASE WHEN n.\`${oneName}\` IS NOT NULL AND trim(toString(n.\`${oneName}\`)) <> '' THEN 1 END) AS \`${oneName}\``
	);
	runCypher(
		{
			cypher: `MATCH (n:HubReference) WHERE n.referenceTier = $referenceTier RETURN count(n) AS cardCount, ${countClauseList.join(', ')}`,
			parameters: { referenceTier: PROPERTY_TIER },
		},
		(readError, records) => {
			if (readError) {
				callback(readError);
				return;
			}
			if (records.length !== 1) {
				callback(`${moduleName} REFUSED: the aggregate returned ${records.length} rows, not 1`);
				return;
			}
			const oneRecord = records[0];
			const asNumber = (oneValue) => (neo4j.isInt(oneValue) ? oneValue.toNumber() : oneValue);
			const nonEmptyByName = MEASURED_NAME_LIST.reduce((soFar, oneName) => ({ ...soFar, [oneName]: asNumber(oneRecord.get(oneName)) }), {});
			callback('', { cardCount: asNumber(oneRecord.get('cardCount')), nonEmptyByName });
		}
	);
};

// STEP 3 — a sample of real values, because a count without a specimen is a number nobody can sanity-check.
const readSample = (callback) => {
	runCypher(
		{
			cypher:
				"MATCH (n:HubReference) WHERE n.referenceTier = $referenceTier AND n.rangeOptionSetName IS NOT NULL AND trim(toString(n.rangeOptionSetName)) <> '' " +
				'RETURN n.canonicalKey AS canonicalKey, n.name AS name, n.rangeOptionSetName AS rangeOptionSetName, ' +
				'substring(coalesce(toString(n.rangeOptionSetDefinition), ""), 0, 160) AS rangeOptionSetDefinitionHead ' +
				'ORDER BY n.stableId LIMIT 8',
			parameters: { referenceTier: PROPERTY_TIER },
		},
		(readError, records) => {
			if (readError) {
				callback(readError);
				return;
			}
			callback(
				'',
				records.map((oneRecord) => ({
					canonicalKey: oneRecord.get('canonicalKey'),
					name: oneRecord.get('name'),
					rangeOptionSetName: oneRecord.get('rangeOptionSetName'),
					rangeOptionSetDefinitionHead: oneRecord.get('rangeOptionSetDefinitionHead'),
				}))
			);
		}
	);
};

const finish = (errorText, report) => {
	driver
		.close()
		.then(() => {
			if (errorText) {
				process.stdout.write(`${errorText}\n`);
				process.exitCode = 1;
				return;
			}
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		})
		.catch((closeError) => {
			process.stdout.write(`${moduleName}: driver close: ${closeError.message}\n`);
			process.exitCode = 1;
		});
};

readObservedKeySet((keyError, observedKeySet) => {
	if (keyError) {
		finish(keyError);
		return;
	}
	readFillRates({ observedKeySet }, (fillError, fillReport) => {
		if (fillError) {
			finish(fillError);
			return;
		}
		readSample((sampleError, sampleList) => {
			if (sampleError) {
				finish(sampleError);
				return;
			}
			finish('', {
				measuredAgainst: { boltUrl: BOLT_URL, container: 'DEV_edfiDerived_260817', referenceTier: PROPERTY_TIER },
				observedKeyCount: observedKeySet.length,
				observedKeySet,
				cardCount: fillReport.cardCount,
				nonEmptyValueCountByName: fillReport.nonEmptyByName,
				sample: sampleList,
			});
		});
	});
});
