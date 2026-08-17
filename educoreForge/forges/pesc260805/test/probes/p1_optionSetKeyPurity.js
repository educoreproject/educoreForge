'use strict';

// p1_optionSetKeyPurity.js — LUNAR_PRISM (P1), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// DISCHARGES THE CONDITION ON RULING P1-R12, which applies the rule that caught the supervisor's own
// worst error of this build: **THE DEDUP KEY MUST EQUAL OR CONTAIN THE RENDERING ALLOW-LIST.**
//
// PLAN §1's original scope of 1,201 was UNSOUND because 715 of those groups were internally DIFFERENT
// in fields the judge would actually be shown; the sound figure was 2,213. The rule exists so nobody
// repeats it, and the supervisor's instruction was exact: **DO NOT ASSUME PURITY BECAUSE THE COUNT IS
// TIDY. MINE WAS TIDY TOO.**
//
// THE SITUATION HERE. The option-set plugin's declared SUBJECT allow-list is
// ['name', 'kind', 'description'] — read from the shipped declaration by this probe rather than
// restated, so the two cannot drift. The measured concept key is (family, kind, name). **IT DOES NOT
// CONTAIN description**, and these nodes carry the RICHEST prose in the standard (non-empty on 346 of
// 452, mean 183 chars). So the key is under suspicion by construction and the question is empirical:
//
//   IS EVERY (family, kind, name) GROUP INTERNALLY IDENTICAL IN EVERY FIELD THE ALLOW-LIST NAMES?
//
// If any group differs in an allow-listed field, the key is UNSOUND at 156 and must be widened — and
// this probe reports the widened figure rather than leaving the supervisor to ask for it.
//
// It REPORTS; it does not decide. The scope file is written only on a ruling.
//
// CONNECTION DETAILS GO STALE — re-resolve with `docker inspect`, or pass P1_BOLT_URL /
// P1_BOLT_PASSWORD in the environment.

const path = require('path');
const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');

const moduleName = 'p1_optionSetKeyPurity';
const BOLT_URL = process.env.P1_BOLT_URL || 'bolt://localhost:7811';
const NEO4J_PASSWORD = process.env.P1_BOLT_PASSWORD || 're5OU3hWKTfXu6zTlYwn1rwt';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const UNIT_SEPARATOR = '\u0001';

// READ FROM THE SHIPPED DECLARATION, never restated — two derivations of one list held against each
// other is exactly the drift this project keeps finding.
const shippedDeclaration = require(path.join(BUNDLE_DIR, 'bridges', 'pescOptionSetCedsDerivedPlugin')).bridgeDeclaration;
const SUBJECT_ALLOW_LIST = shippedDeclaration.renderingAllowList.subject;

const driver = neo4j.driver(BOLT_URL, neo4j.auth.basic('neo4j', NEO4J_PASSWORD), { encrypted: false });

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

const familyFromFilename = (oneName) =>
	String(oneName || '').replace(/\.xsd$/, '').replace(/\.collision-[0-9a-f]+$/, '').replace(/[_-]?v?\d+(\.\d+)*$/, '').replace(/_$/, '');

const CYPHER = [
	'MATCH (n:PescNamedDefinition)',
	"WHERE n.pescTier = 'source' AND n.role = 'DmeOptionSet' AND n.reachableFromLatestRoot = true",
	"RETURN n.stableId AS stableId, n.name AS name, coalesce(n.kind,'') AS kind,",
	"       coalesce(n.declaringFilename,'') AS declaringFilename, coalesce(n.description,'') AS description",
	'ORDER BY n.stableId',
].join('\n');

const session = driver.session();
session
	.run(CYPHER)
	.then((result) => {
		const rowList = result.records.map((oneRecord) => ({
			stableId: oneRecord.get('stableId'),
			name: oneRecord.get('name'),
			kind: oneRecord.get('kind'),
			family: familyFromFilename(oneRecord.get('declaringFilename')),
			description: oneRecord.get('description'),
		}));

		// EVERY allow-listed name must be a field this probe actually read, or the purity check is
		// silently narrower than the allow-list it claims to cover — which is the same shape of empty
		// measurement as a gate that never fires. REFUSE rather than check a subset.
		const readableNameList = ['name', 'kind', 'description'];
		const uncheckable = SUBJECT_ALLOW_LIST.filter((oneName) => readableNameList.indexOf(oneName) === -1);
		if (uncheckable.length > 0) {
			session.close().then(() =>
				finish(
					`${moduleName} REFUSED: the declaration's subject allow-list names [${uncheckable.join(', ')}], which this probe does not read. ` +
						'A purity check over a SUBSET of the allow-list would report purity it did not measure. Widen the query or narrow the allow-list.',
				),
			);
			return null;
		}

		const memberListByConceptKey = {};
		rowList.forEach((oneRow) => {
			const conceptKey = [oneRow.family, oneRow.kind, oneRow.name].join(UNIT_SEPARATOR);
			if (memberListByConceptKey[conceptKey] === undefined) {
				memberListByConceptKey[conceptKey] = [];
			}
			memberListByConceptKey[conceptKey].push(oneRow);
		});
		const conceptKeyList = Object.keys(memberListByConceptKey);

		// THE TEST: within each (family, kind, name) group, does any ALLOW-LISTED field differ?
		const impurityByFieldName = {};
		SUBJECT_ALLOW_LIST.forEach((oneName) => {
			impurityByFieldName[oneName] = 0;
		});
		const exampleList = [];
		conceptKeyList.forEach((oneConceptKey) => {
			const memberList = memberListByConceptKey[oneConceptKey];
			SUBJECT_ALLOW_LIST.forEach((oneFieldName) => {
				const distinctValueCount = new Set(memberList.map((oneMember) => oneMember[oneFieldName])).size;
				if (distinctValueCount > 1) {
					impurityByFieldName[oneFieldName] += 1;
					if (exampleList.length < 4 && oneFieldName === 'description') {
						const sortedMemberList = memberList.slice().sort((left, right) => (left.stableId < right.stableId ? -1 : 1));
						exampleList.push({
							name: sortedMemberList[0].name,
							family: sortedMemberList[0].family,
							memberCount: memberList.length,
							distinctDescriptionCount: distinctValueCount,
							descriptionHeadList: [...new Set(memberList.map((oneMember) => oneMember.description))].slice(0, 2).map((oneText) => `${String(oneText).slice(0, 90)}…`),
						});
					}
				}
			});
		});
		const impureGroupTotal = conceptKeyList.filter((oneConceptKey) => {
			const memberList = memberListByConceptKey[oneConceptKey];
			return SUBJECT_ALLOW_LIST.some((oneFieldName) => new Set(memberList.map((oneMember) => oneMember[oneFieldName])).size > 1);
		}).length;

		// THE WIDENED KEY, reported whether or not it is needed, so the supervisor rules on a number
		// rather than asking for one.
		const widenedKeyCount = new Set(
			rowList.map((oneRow) => [oneRow.family, oneRow.kind, oneRow.name].concat(SUBJECT_ALLOW_LIST.map((oneName) => oneRow[oneName])).join(UNIT_SEPARATOR)),
		).size;

		session.close().then(() =>
			finish('', {
				// ADDITIVE LABEL (RULING P2-R8), 2026-08-17 — the original line below is UNCHANGED because its
				// figures are correct. The block it names is a VECTORLESS artifact (--vectorize=false); the
				// shipped lineage is vectorized, id f139654a98cd0ef238759e6dc2bda2e532f13d5a7db00bfea94d89c3317b149d.
				// KEY-PURITY FIGURES ARE UNAFFECTED: the two blocks differ in exactly three embedding-related
				// keys across all 42,372 matched rows, and purity is measured over name/kind/description —
				// none of them embedding-related. Labelled, not corrected, because what it says is TRUE and
				// merely incomplete. Full account: bridgeData/buildModeIdentityRecord.json
				measuredAgainstBuildMode: 'vectorize=false — see the label above; NOT the shipped vectorized lineage',
				measuredAgainst: { boltUrl: BOLT_URL, container: 'DEV_gb_materialize_94765_2', pescBaseBlock: 'c46991d127a3f36bd9bed9708c5701a12b0340497a90235372ef962913566d3f' },
				subjectAllowListReadFromTheShippedDeclaration: SUBJECT_ALLOW_LIST,
				nodeCount: rowList.length,
				conceptCountUnderProposedKey: conceptKeyList.length,
				IMPURE_GROUPS_TOTAL: impureGroupTotal,
				impureGroupCountByAllowListedField: impurityByFieldName,
				conceptCountIfKeyWidenedToContainTheWholeAllowList: widenedKeyCount,
				VERDICT:
					impureGroupTotal === 0
						? 'PURE — every (family, kind, name) group is internally identical in EVERY field the allow-list names. The key EQUALS-OR-CONTAINS the rendering allow-list in effect, and the count STANDS.'
						: 'UNSOUND AT THIS COUNT — groups differ internally in a field the judge would be SHOWN. The key must be widened; the widened figure is reported above for the supervisor to re-rule on.',
				exampleImpureGroupList: exampleList,
			}),
		);
		return null;
	})
	.catch((runError) => {
		session.close().then(() => finish(`${moduleName}: ${runError.message}`)).catch(() => finish(`${moduleName}: ${runError.message}`));
	});
