'use strict';

// ⚠️ CONNECTION DETAILS GO STALE: the bolt port and password below belonged to a container that existed on
// 2026-08-17 and may not now. Re-resolve with `docker inspect <containerName>` before re-running. Same
// warning and same reason as p0b_measureCollisionFloor.js — the house pattern for a retained graph probe on
// this forge. This repository is local-only and never pushed (order hard line), which is why a dev-container
// credential sits here rather than in configs; it is a PRECEDENT FOLLOWED, not a decision I made alone.

// p1_optionSetInVector.js — LUNAR_PRISM (P1), 2026-08-17. READ-ONLY MEASUREMENT.
//
// ⚠️ THIS IS THE ARTIFACT-PRODUCING FIRST ATTEMPT. IT IS RETAINED DELIBERATELY AND ITS ANSWER IS WRONG AS A
// READING, THOUGH ITS COUNT IS REPRODUCIBLE. READ p1_optionSetVectorPart.js BEFORE USING ANYTHING HERE.
//
// WHAT IT REPORTS: rangeOptionSetName appears somewhere in embedText on 1,177 of 1,207 option-set-bearing
// cards (97.5%). WHAT THAT LOOKS LIKE: "the option set is in the vector." WHAT IT ACTUALLY IS: a SUBSTRING
// ARTIFACT. CEDS names these properties `Has <OptionSetName>`, so the option-set name sits inside the
// PROPERTY NAME by naming convention and the vector carries it INCIDENTALLY, not as a part of its own.
// Measuring POSITION instead of EXISTENCE (the successor probe) decomposes the same 1,207 into 1,172
// INCIDENTAL and 31 INDEPENDENT — of which 30 are ABSENT FROM THE VECTOR ENTIRELY. Same number, opposite
// meaning.
//
// It is the same shape as this order's §5.3 defect, where ten case-insensitive 'ceds' hits were all the
// single word "AdvancedStanding", and it is kept for the reason SABLE_RIVER ruled on 2026-08-17:
// **A MEASUREMENT WHOSE WRONG FIRST ANSWER IS DELETED CANNOT BE CHECKED.**
//
// THE SHARPER QUESTION BEHIND CONDITION 1. Knowing that 1,207 of 2,777 property cards carry a non-empty
// rangeOptionSetName is NOT the same as knowing an option-set subject can RETRIEVE them. Retrieval is cosine
// over `embedding`, and P0 §9.1 measured the hub card's embedded string as four parts —
// domainName · propertyName · propertyDefinition · domainDefinition — WITH NO OPTION-SET PART.
//
// If that holds, the rangeOptionSet fields are RENDERABLE (the judge can see them) but NOT RETRIEVABLE (the
// vector never carried them), and the second plugin's option-set subjects would be retrieved against text
// that does not mention an option set at all. That is a limitation the case must carry, not a defeater —
// but it must be MEASURED rather than inferred from a report, because the forge may have changed.
//
// Measured here, over the 1,207 cards that HAVE an option set:
//   1. does embedText CONTAIN the card's own rangeOptionSetName as a substring?
//   2. does embedText CONTAIN the card's own rangeOptionSetDefinition?
//   3. how many parts does embedText actually have, by the ' · ' separator P0 named?
//   4. is embedSourceProperty (the R-P2-2 seam, O-4) populated on any hub card?
// Reads nothing but HubReference nodes. Writes nothing.

const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');

const moduleName = 'p1_optionSetInVector';
const BOLT_URL = 'bolt://localhost:7817';
const NEO4J_PASSWORD = 'LPnzVJjt3JkBeIzH4dUeeRrQ';
const PROPERTY_TIER = 'property';
const HUB_SEPARATOR = ' · '; // ' · ', the separator P0 §9.1 names

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

const readOptionSetCards = (callback) => {
	runCypher(
		{
			cypher:
				"MATCH (n:HubReference) WHERE n.referenceTier = $referenceTier AND n.rangeOptionSetName IS NOT NULL AND trim(toString(n.rangeOptionSetName)) <> '' " +
				'RETURN n.stableId AS stableId, n.canonicalKey AS canonicalKey, n.rangeOptionSetName AS rangeOptionSetName, ' +
				'n.rangeOptionSetDefinition AS rangeOptionSetDefinition, n.embedText AS embedText, n.embedSourceProperty AS embedSourceProperty ' +
				'ORDER BY n.stableId',
			parameters: { referenceTier: PROPERTY_TIER },
		},
		callback
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

readOptionSetCards((readError, records) => {
	if (readError) {
		finish(readError);
		return;
	}
	if (records.length === 0) {
		finish(`${moduleName} REFUSED: zero option-set-bearing cards returned; the previous probe measured 1,207, so an empty result here is an instrument fault, not a finding`);
		return;
	}
	let embedTextAbsentCount = 0;
	let nameInEmbedTextCount = 0;
	let definitionInEmbedTextCount = 0;
	let embedSourcePropertyPopulatedCount = 0;
	const partCountTally = {};
	const missExampleList = [];

	records.forEach((oneRecord) => {
		const embedText = oneRecord.get('embedText');
		const rangeOptionSetName = String(oneRecord.get('rangeOptionSetName') || '');
		const rangeOptionSetDefinition = String(oneRecord.get('rangeOptionSetDefinition') || '');
		const embedSourceProperty = oneRecord.get('embedSourceProperty');
		if (embedSourceProperty !== null && embedSourceProperty !== undefined && String(embedSourceProperty).trim() !== '') {
			embedSourcePropertyPopulatedCount += 1;
		}
		if (typeof embedText !== 'string' || embedText === '') {
			embedTextAbsentCount += 1;
			return;
		}
		const partCount = embedText.split(HUB_SEPARATOR).length;
		partCountTally[partCount] = (partCountTally[partCount] || 0) + 1;
		const nameFound = embedText.indexOf(rangeOptionSetName) !== -1;
		const definitionFound = rangeOptionSetDefinition !== '' && embedText.indexOf(rangeOptionSetDefinition) !== -1;
		if (nameFound) {
			nameInEmbedTextCount += 1;
		}
		if (definitionFound) {
			definitionInEmbedTextCount += 1;
		}
		if (!nameFound && missExampleList.length < 3) {
			missExampleList.push({
				canonicalKey: oneRecord.get('canonicalKey'),
				rangeOptionSetName,
				embedTextHead: embedText.slice(0, 220),
			});
		}
	});

	finish('', {
		measuredAgainst: { boltUrl: BOLT_URL, container: 'DEV_edfiDerived_260817', referenceTier: PROPERTY_TIER },
		optionSetBearingCardCount: records.length,
		embedTextAbsentCount,
		embedTextPartCountTally: partCountTally,
		rangeOptionSetNameAppearsInEmbedText: nameInEmbedTextCount,
		rangeOptionSetDefinitionAppearsInEmbedText: definitionInEmbedTextCount,
		embedSourcePropertyPopulatedCount,
		examplesWhereTheOptionSetNameIsNotInTheVector: missExampleList,
	});
});
