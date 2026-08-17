'use strict';

// ⚠️ CONNECTION DETAILS GO STALE: the bolt port and password below belonged to a container that existed on
// 2026-08-17 and may not now. Re-resolve with `docker inspect <containerName>` before re-running. Same
// warning and same reason as p0b_measureCollisionFloor.js — the house pattern for a retained graph probe on
// this forge. This repository is local-only and never pushed (order hard line), which is why a dev-container
// credential sits here rather than in configs; it is a PRECEDENT FOLLOWED, not a decision I made alone.

// p1_optionSetVectorPart.js — LUNAR_PRISM (P1), 2026-08-17. READ-ONLY. THE CORRECTION PROBE.
//
// WHY THIS EXISTS. p1_optionSetInVector.js measured that rangeOptionSetName appears somewhere in embedText on
// 1,177 of 1,207 option-set-bearing cards (97.5%) and I was about to report that as "the option set IS in the
// vector." IT IS PROBABLY A SUBSTRING ARTIFACT. CEDS names these properties `Has <OptionSetName>`, so the
// option-set name is a substring of the PROPERTY NAME by naming convention — the vector would carry it
// incidentally, not as a separate part. That is the same shape as this order's §5.3 defect, where ten
// case-insensitive 'ceds' hits were all the single word "AdvancedStanding".
//
// SO: MEASURE POSITION, NOT EXISTENCE. embedText is four parts joined by ' · ' (P0 §9.1, and the previous
// probe measured 4 parts on all 1,207):
//     [0] domainName   [1] propertyName   [2] propertyDefinition   [3] domainDefinition
// The question that actually matters for the second plugin is: WHEN CEDS DID NOT NAME THE PROPERTY AFTER THE
// OPTION SET, does the vector carry the option set's identity at all?
//
// Decisive split reported here:
//   INCIDENTAL  — rangeOptionSetName is a substring of propertyName (the naming convention carries it)
//   INDEPENDENT — rangeOptionSetName is NOT in propertyName; is it anywhere else in embedText?
// Reads nothing but HubReference nodes. Writes nothing.

const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');

const moduleName = 'p1_optionSetVectorPart';
const BOLT_URL = 'bolt://localhost:7817';
const NEO4J_PASSWORD = 'LPnzVJjt3JkBeIzH4dUeeRrQ';
const PROPERTY_TIER = 'property';
const HUB_SEPARATOR = ' · ';
const PART_NAME_LIST = ['domainName', 'propertyName', 'propertyDefinition', 'domainDefinition'];

const driver = neo4j.driver(BOLT_URL, neo4j.auth.basic('neo4j', NEO4J_PASSWORD), { encrypted: false });

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

runCypher(
	{
		cypher:
			"MATCH (n:HubReference) WHERE n.referenceTier = $referenceTier AND n.rangeOptionSetName IS NOT NULL AND trim(toString(n.rangeOptionSetName)) <> '' " +
			'RETURN n.canonicalKey AS canonicalKey, n.propertyName AS propertyName, n.propertyDefinition AS propertyDefinition, ' +
			'n.rangeOptionSetName AS rangeOptionSetName, n.rangeOptionSetDefinition AS rangeOptionSetDefinition, n.embedText AS embedText ' +
			'ORDER BY n.stableId',
		parameters: { referenceTier: PROPERTY_TIER },
	},
	(readError, records) => {
		if (readError) {
			finish(readError);
			return;
		}
		if (records.length === 0) {
			finish(`${moduleName} REFUSED: zero rows; the prior probe measured 1,207, so empty here is an instrument fault`);
			return;
		}

		let structureDisagreementCount = 0;
		let incidentalCount = 0; // option-set name is a substring of propertyName
		let independentCount = 0; // it is not
		let independentButElsewhereInVectorCount = 0;
		let definitionEqualsPropertyDefinitionCount = 0;
		const independentExampleList = [];

		records.forEach((oneRecord) => {
			const embedText = String(oneRecord.get('embedText') || '');
			const partList = embedText.split(HUB_SEPARATOR);
			const propertyName = String(oneRecord.get('propertyName') || '');
			const propertyDefinition = String(oneRecord.get('propertyDefinition') || '');
			const rangeOptionSetName = String(oneRecord.get('rangeOptionSetName') || '');
			const rangeOptionSetDefinition = String(oneRecord.get('rangeOptionSetDefinition') || '');

			// STRUCTURE CHECK, not assumed: part[1] must BE the propertyName. If it is not, the positional
			// reading below is wrong and the count must not be trusted.
			if (partList.length !== PART_NAME_LIST.length || partList[1] !== propertyName) {
				structureDisagreementCount += 1;
				return;
			}
			if (rangeOptionSetDefinition !== '' && rangeOptionSetDefinition === propertyDefinition) {
				definitionEqualsPropertyDefinitionCount += 1;
			}
			if (propertyName.indexOf(rangeOptionSetName) !== -1) {
				incidentalCount += 1;
				return;
			}
			independentCount += 1;
			if (embedText.indexOf(rangeOptionSetName) !== -1) {
				independentButElsewhereInVectorCount += 1;
			} else if (independentExampleList.length < 5) {
				independentExampleList.push({ canonicalKey: oneRecord.get('canonicalKey'), propertyName, rangeOptionSetName });
			}
		});

		finish('', {
			measuredAgainst: { boltUrl: BOLT_URL, container: 'DEV_edfiDerived_260817', referenceTier: PROPERTY_TIER },
			optionSetBearingCardCount: records.length,
			structureDisagreementCount,
			embedTextPartsAssumed: PART_NAME_LIST,
			optionSetNameIsSubstringOfPropertyName_INCIDENTAL: incidentalCount,
			optionSetNameIsNOTInPropertyName_INDEPENDENT: independentCount,
			ofThoseIndependent_nameAppearsElsewhereInEmbedText: independentButElsewhereInVectorCount,
			ofThoseIndependent_nameAbsentFromVectorEntirely: independentCount - independentButElsewhereInVectorCount,
			rangeOptionSetDefinitionIsByteIdenticalToPropertyDefinition: definitionEqualsPropertyDefinitionCount,
			examplesWhereTheOptionSetIdentityIsAbsentFromTheVector: independentExampleList,
		});
	}
);
