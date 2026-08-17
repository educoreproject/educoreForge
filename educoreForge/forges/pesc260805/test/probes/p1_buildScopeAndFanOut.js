'use strict';
// p1_buildScopeAndFanOut.js — LUNAR_PRISM (P1), 2026-08-17. RETAINED per O-7 (a tool that produces a
// shipped artifact must live in the repo beside it).
//
// PRODUCES, from a LIVE graph built from this phase's own block:
//   bridgeData/pescDerivedConceptScope.json   — the representative stableIds (BARE ARRAY; the
//                                               framework refuses any other shape by name)
//   bridgeData/pescDerivedConceptFanOut.json  — representative -> its group's member stableIds
//   bridgeData/pescOptionSetConceptScope.json — the option-set siblings' representatives
//
// ⚠️ IT COMPUTES effectiveDescription ITSELF OVER ALL RESOLVES_TO EDGES AND DOES NOT READ THE STAMPED
// PROPERTY. Measured on this same graph by p1_conceptGrainSeam.js: all-edges 2,213 (TQ's ruled scope
// a-prime) against stamped/derived-only 2,347 (the forge's composition grain). READING THE STAMPED
// VALUE WOULD HAVE BUILT SILENTLY TO THE WRONG SCOPE. That is RULING P0b-R2's seam arriving as a live
// hazard rather than a paragraph, and it is the reason this tool is more careful than it looks.
//
// REPRESENTATIVE = LOWEST stableId, as ruled. THE CAVEAT TRAVELS WITH THE ARTIFACT: a group can hold
// more than one distinct embedded text, so the representative SILENTLY DECIDES WHICH VECTOR THE WHOLE
// GROUP RETRIEVES ON. Recording the pool with the fan-out makes that AUDITABLE; it does not make it
// CORRECT. THE REPRESENTATIVE'S POOL IS A CHOICE THE DATA MADE FOR US, NOT A PROPERTY OF THE GROUP.
//
// IT REFUSES BY NAME rather than write a scope that disagrees with the ruled figure, and rather than
// write a fan-out that does not cover every declaration exactly once. A scope list is the thing the
// framework checks against the graph; shipping a silently-different population would report some
// other judged set as though it were the ruled one.
//
// CONNECTION DETAILS GO STALE — the port and password below belonged to a scratch container that
// existed on 2026-08-17 and was disposed. Re-resolve with `docker inspect`, or pass P1_BOLT_URL and
// P1_BOLT_PASSWORD in the environment.

const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const moduleName = 'p1_buildScopeAndFanOut';
const BOLT_URL = process.env.P1_BOLT_URL || 'bolt://localhost:7811';
const NEO4J_PASSWORD = process.env.P1_BOLT_PASSWORD || 're5OU3hWKTfXu6zTlYwn1rwt';
const BRIDGE_DATA_DIR = path.join(__dirname, '..', '..', 'bridgeData');

// a byte no XSD name, type token or documentation string can contain, so the three key parts cannot
// be confused with one another by concatenation. Written as an ESCAPE, never as a literal control
// character in the source.
// I first wrote this as a LITERAL control byte, which is exactly what the line above says not to
// do: invisible in a diff, and it is what made an earlier shell invocation of this tool fail
// outright. Same value, written so a reader can see it.
const UNIT_SEPARATOR = '\u0001';

const RULED_CONCEPT_COUNT = 2213;
const RULED_DECLARATION_COUNT = 16969;
// RULING P1-R13: the option-set key is (family, kind, name, description) and the population is 223.
// 156 — the figure in PLAN §1-A, which this tool originally reproduced — was MEASURED, TESTED AND
// SUPERSEDED, not overlooked: 67 of its 156 groups (43%) differed internally in `description`, the
// field the judge is shown, so the key did not contain its own rendering allow-list.
const RULED_OPTION_SET_CONCEPT_COUNT = 223;
const SUPERSEDED_OPTION_SET_COUNT = 156;

const driver = neo4j.driver(BOLT_URL, neo4j.auth.basic('neo4j', NEO4J_PASSWORD), { encrypted: false });

const runCypher = ({ cypher }, callback) => {
	const session = driver.session();
	session
		.run(cypher)
		.then((result) => {
			session.close().then(() => callback('', result.records)).catch((closeError) => callback(`${moduleName}: ${closeError.message}`));
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

const writeJson = (fileName, value) => {
	const filePath = path.join(BRIDGE_DATA_DIR, fileName);
	const text = `${JSON.stringify(value, null, '\t')}\n`;
	fs.writeFileSync(filePath, text);
	return { fileName, byteLength: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') };
};

// ALL-EDGES effective description, computed here rather than read off the node — see the header.
const ELEMENT_CYPHER = [
	"MATCH (n:PescElementDecl) WHERE n.pescTier = 'source'",
	'OPTIONAL MATCH (n)-[:RESOLVES_TO]->(t:PescNamedDefinition)',
	"WITH n, head(collect(CASE WHEN t.description IS NOT NULL AND t.description <> '' THEN t.description END)) AS resolvedProse",
	"RETURN n.stableId AS stableId, n.name AS name, coalesce(n.typeAsWritten,'') AS typeAsWritten,",
	"       CASE WHEN n.description IS NOT NULL AND n.description <> '' THEN n.description ELSE coalesce(resolvedProse,'') END AS effectiveDescription",
	'ORDER BY n.stableId',
].join('\n');

const OPTION_SET_CYPHER = [
	'MATCH (n:PescNamedDefinition)',
	"WHERE n.pescTier = 'source' AND n.role = 'DmeOptionSet' AND n.reachableFromLatestRoot = true",
	"RETURN n.stableId AS stableId, n.name AS name, coalesce(n.kind,'') AS kind,",
	"       coalesce(n.declaringFilename,'') AS declaringFilename, coalesce(n.description,'') AS description",
	'ORDER BY n.stableId',
].join('\n');

// the ARTIFACT FAMILY, derived from the declaring filename. `family` is not a node property; two
// independent derivations (this one and splitting `path` at its version token) agree, and the
// supersession below turns on their agreeing to within one concept.
const familyFromFilename = (oneName) =>
	String(oneName || '').replace(/\.xsd$/, '').replace(/\.collision-[0-9a-f]+$/, '').replace(/[_-]?v?\d+(\.\d+)*$/, '').replace(/_$/, '');

runCypher({ cypher: ELEMENT_CYPHER }, (elementError, elementRecords) => {
	if (elementError) {
		finish(elementError);
		return;
	}
	const memberListByConceptKey = {};
	elementRecords.forEach((oneRecord) => {
		const conceptKey = [oneRecord.get('name'), oneRecord.get('typeAsWritten'), oneRecord.get('effectiveDescription')].join(UNIT_SEPARATOR);
		if (memberListByConceptKey[conceptKey] === undefined) {
			memberListByConceptKey[conceptKey] = [];
		}
		memberListByConceptKey[conceptKey].push(oneRecord.get('stableId'));
	});

	const fanOutByRepresentative = {};
	Object.keys(memberListByConceptKey).forEach((oneConceptKey) => {
		const memberList = memberListByConceptKey[oneConceptKey].slice().sort();
		fanOutByRepresentative[memberList[0]] = memberList;
	});
	const representativeList = Object.keys(fanOutByRepresentative).sort();

	runCypher({ cypher: OPTION_SET_CYPHER }, (optionError, optionRecords) => {
		if (optionError) {
			finish(optionError);
			return;
		}
		const optionMemberListByKey = {};
		optionRecords.forEach((oneRecord) => {
			// RULING P1-R13's key, in full: (family, kind, name, description). It CONTAINS the option-set
			// plugin's whole subject rendering allow-list, so the constraint holds BY CONSTRUCTION rather
			// than by luck — which is the entire reason 156 was rejected.
			const oneKey = [familyFromFilename(oneRecord.get('declaringFilename')), oneRecord.get('kind'), oneRecord.get('name'), oneRecord.get('description')].join(UNIT_SEPARATOR);
			if (optionMemberListByKey[oneKey] === undefined) {
				optionMemberListByKey[oneKey] = [];
			}
			optionMemberListByKey[oneKey].push(oneRecord.get('stableId'));
		});
		const optionRepresentativeList = Object.keys(optionMemberListByKey)
			.map((oneKey) => optionMemberListByKey[oneKey].slice().sort()[0])
			.sort();

		if (representativeList.length !== RULED_CONCEPT_COUNT) {
			finish(
				`${moduleName} REFUSED: the all-edges concept grain produced ${representativeList.length} representatives, not TQ's ruled ${RULED_CONCEPT_COUNT}. ` +
					'A scope that disagrees with the ruling is NOT WRITTEN. Re-check the effective-description rule before proceeding — and note that reading the ' +
					'STAMPED effectiveDescription instead of computing it over all RESOLVES_TO edges yields the forge grain (2,347), which is the likeliest cause.',
			);
			return;
		}
		const declarationsCovered = representativeList.reduce((soFar, oneRepresentative) => soFar + fanOutByRepresentative[oneRepresentative].length, 0);
		if (declarationsCovered !== RULED_DECLARATION_COUNT) {
			finish(
				`${moduleName} REFUSED: the fan-out covers ${declarationsCovered} declarations, not ${RULED_DECLARATION_COUNT}. ` +
					'Every source-tier declaration must belong to EXACTLY ONE concept; a partition that does not cover the population is not a fan-out.',
			);
			return;
		}

		if (optionRepresentativeList.length !== RULED_OPTION_SET_CONCEPT_COUNT) {
			finish(
				`${moduleName} REFUSED: the option-set key produced ${optionRepresentativeList.length} representatives, not RULING P1-R13's ${RULED_OPTION_SET_CONCEPT_COUNT}. ` +
					`A scope that disagrees with the ruling is NOT WRITTEN. If the figure is ${SUPERSEDED_OPTION_SET_COUNT}, the key has silently reverted to (family, kind, name) — ` +
					'the SUPERSEDED form, whose groups differ internally in `description`, the field the judge is shown.',
			);
			return;
		}

		const scopeWrite = writeJson('pescDerivedConceptScope.json', representativeList);
		const fanOutWrite = writeJson('pescDerivedConceptFanOut.json', fanOutByRepresentative);
		const optionScopeWrite = writeJson('pescOptionSetConceptScope.json', optionRepresentativeList);

		const groupSizeList = representativeList.map((oneRepresentative) => fanOutByRepresentative[oneRepresentative].length).sort((leftSize, rightSize) => leftSize - rightSize);

		finish('', {
			measuredAgainst: {
				boltUrl: BOLT_URL,
				container: 'DEV_gb_materialize_94765_2',
				pescBaseBlock: 'c46991d127a3f36bd9bed9708c5701a12b0340497a90235372ef962913566d3f',
				note: 'a LIVE graph built from THIS phase\'s re-forged block — figures about the artifact that will ship, not about the pre-re-embed graph P0 measured',
			},
			grainUsed:
				'ALL RESOLVES_TO edges INCLUDING the synthetic tier — TQ ruled scope (a-prime). The STAMPED effectiveDescription was deliberately NOT read: it is the derived-only grain and yields 2,347.',
			elementConceptCount: representativeList.length,
			declarationsCovered,
			singletonConceptCount: groupSizeList.filter((oneSize) => oneSize === 1).length,
			largestGroupSize: groupSizeList[groupSizeList.length - 1],
			optionSetConceptCount: optionRepresentativeList.length,
			optionSetNodeCount: optionRecords.length,
			written: [scopeWrite, fanOutWrite, optionScopeWrite],
		});
	});
});
