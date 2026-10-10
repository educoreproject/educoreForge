#!/usr/bin/env node
'use strict';

// test-promotionStamp.js — the promotion stamp (lane P, mappingProvenance 2026-10-04) writes the graph's real name and the
// post-build verdicts, and changes NO content. Pure: a runCypher double answers the stamp's statements and records them.
//   (a) a well-formed stamp succeeds, sets graphName to the promoted name keeping the scratch name, attests both gates,
//       and reports the content census unchanged
//   (b) a content change between the BEFORE and AFTER census is REFUSED by name
//   (c) a verdict without its evidence sha256 is REFUSED by name before anything is written
//   (d) a graph holding TWO passports is REFUSED by name (the singleton guard in the statement)
//   (e) ⟪campaign P2, W-A-9⟫ the two scratch-named VECTOR indexes are dropped and re-created under the promoted name at the
//       dimensions they had, db.awaitIndexes runs, and the passport's vectorIndexNameList is rewritten to the two new names
//   (f) a VECTOR index on an undeclared slot (:UserContent(embedding)) is REFUSED by name, before any index is dropped
//   (g) ⟪W-A-4 / V1-C17⟫ each stamped row MERGEs on (:BuildAttestation {gate}) — never a label-less {stableId} — carries
//       the token writtenOnChannel 'promotionStamp', and REMOVEs :ForgedNode (a post-build fact leaves fingerprint scope)
//   (h) ⟪lane REFORGE, forgeClean R3⟫ the stampable gates are graph-contract §4's promotionStamp list, read from the contract:
//       a reforgeDeterminism verdict is stamped beside goldEvalCheck and replay, and a gate the contract does not name is
//       REFUSED by name before anything is written
//   (i) ⟪lane BM25⟫ the scratch-named FULLTEXT index is dropped and re-created as <promoted>_fulltext with the declared
//       properties and analyzer (graph-contract §10b), and the summary names it
//   (j) a graph with vectors and NO fulltext index is REFUSED by name, before any index is dropped; a graph with no vector
//       index and no fulltext index is stamped (it has no search leg of either kind) and the summary says so
//   (k) a FULLTEXT index that is not the declared one (another property list) is REFUSED by name, before any index is dropped
// RED TWINS, each observed in memory: (a) the scratch name not kept; (b) the census comparison removed; (c) the evidence
// check removed; (d) the passport singleton check removed; (e) the drop+create step never planned; (f) the label check
// removed (the slot then matches by property name alone); (i) the fulltext rename never planned; (j) the one-index count
// check removed; (k) the declared-shape comparison removed.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: the promotion stamp writes name and verdicts, never content
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;

require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../../../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const STAMP_PATH = path.join(__dirname, '..', 'promotion-stamp.js');
const passportWriter = require('../passport-writer')({ vocabulary, debugMappingSource: 'bridge-debug' });
const stampFor = (mutationList) => (mutationList.length === 0 ? require(STAMP_PATH) : loadBuildJsDouble({ buildJsPath: STAMP_PATH, mutationList }))({ vocabulary, passportWriter });

const SHA = 'a'.repeat(64);
const goodVerdictList = () => [
	{ gate: 'goldEvalCheck', verdict: 'pass', detail: 'graphBuilder: [goldEvalCheck] PASS — test', evidencePath: '/tmp/gold.log', evidenceSha256: SHA },
	{ gate: 'replay', verdict: 'pass', detail: 'zero-judge replay composed the manifest', evidencePath: '/tmp/replay.log', evidenceSha256: SHA },
];
const recordOf = (fieldValueByName) => ({ get: (fieldName) => fieldValueByName[fieldName] });

// runCypherDouble — answers by statement kind; censusList is consumed in order (BEFORE, then AFTER)
const SCRATCH_INDEX_ROW_LIST = [
	{ name: 'DEV_gb_materialize_1_1_embedText_vector', labelsOrTypes: ['DmeEmbedText'], properties: ['textEmbedding'], options: { indexConfig: { 'vector.dimensions': 1024, 'vector.similarity_function': 'COSINE' } } },
	{ name: 'DEV_gb_materialize_1_1_vector', labelsOrTypes: ['ForgedNode'], properties: ['embedding'], options: { indexConfig: { 'vector.dimensions': 1024, 'vector.similarity_function': 'COSINE' } } },
];
const declaredFulltextAnalyzer = vocabulary.fulltextIndexDeclaration().analyzer;
const SCRATCH_FULLTEXT_ROW_LIST = [{ name: 'DEV_gb_materialize_1_1_fulltext', labelsOrTypes: ['ForgedNode'], properties: vocabulary.fulltextIndexDeclaration().propertyNameList.slice(), options: { indexConfig: { 'fulltext.analyzer': declaredFulltextAnalyzer, 'fulltext.eventually_consistent': false } } }];
const runCypherDouble = ({ censusList, passportCount = 1, indexRowList = SCRATCH_INDEX_ROW_LIST, fulltextIndexRowList = SCRATCH_FULLTEXT_ROW_LIST }) => {
	const statementList = [];
	const remainingCensusList = censusList.slice();
	const runCypher = ({ cypher }, callback) => {
		statementList.push(cypher);
		if (/contentNodeCount/.test(cypher)) {
			const census = remainingCensusList.shift();
			callback('', { records: [recordOf(census)] });
			return;
		}
		if (/SET p\.scratchGraphName/.test(cypher)) {
			const promotedGraphName = /p\.graphName = "([^"]+)"/.exec(cypher)[1];
			const keepsScratch = /coalesce\(p\.scratchGraphName, p\.graphName\)/.test(cypher);
			// the statement's own singleton guard decides: with it, any count but 1 yields no row; without it, the double
			// behaves as Neo4j would and stamps the first passport it found
			const singletonGuarded = /WHERE size\(passportList\) = 1/.test(cypher);
			const yieldsRow = passportCount === 1 || (!singletonGuarded && passportCount > 1);
			callback('', { records: yieldsRow ? [recordOf({ graphName: promotedGraphName, scratchGraphName: keepsScratch ? 'DEV_gb_materialize_1_1' : null, manifestRefId: SHA })] : [] });
			return;
		}
		if (/MERGE \(a(:`BuildAttestation`)? \{(stableId|gate):/.test(cypher)) {
			callback('', { records: [recordOf({ rowCount: 1 })] });
			return;
		}
		if (/^SHOW INDEXES.*type = 'VECTOR'/.test(cypher)) {
			callback('', { records: indexRowList.map(recordOf) });
			return;
		}
		if (/^SHOW INDEXES.*type = 'FULLTEXT'/.test(cypher)) {
			callback('', { records: fulltextIndexRowList.map(recordOf) });
			return;
		}
		if (/^(DROP INDEX|CREATE VECTOR INDEX|CREATE FULLTEXT INDEX|CALL db\.awaitIndexes)/.test(cypher)) {
			callback('', { records: [] });
			return;
		}
		if (/SET p\.vectorIndexNameList = /.test(cypher)) {
			callback('', { records: [recordOf({ vectorIndexNameList: JSON.parse(/= (\[[^\]]*\])/.exec(cypher)[1]) })] });
			return;
		}
		callback(`unexpected statement: ${cypher.slice(0, 80)}`);
	};
	return { runCypher, statementList };
};

const runStamp = ({ mutationList, censusList, passportCount, gateVerdictList, indexRowList, fulltextIndexRowList }, callback) => {
	const cypherDouble = runCypherDouble({ censusList, passportCount, indexRowList, fulltextIndexRowList });
	stampFor(mutationList).stampPromotion({ runCypher: cypherDouble.runCypher, promotedGraphName: 'GOLD_EVAL_TEST_promoted', gateVerdictList }, (err, stamped) => callback({ err, stamped, statementList: cypherDouble.statementList }));
};
const SAME_CENSUS = { contentNodeCount: 100, contentEdgeCount: 200 };

const conjunctJudgeByRefId = {
	a_stampWritesNameAndVerdictsOnly: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList() }, ({ err, stamped }) => {
			const pass = !err && stamped.graphName === 'GOLD_EVAL_TEST_promoted' && stamped.scratchGraphName === 'DEV_gb_materialize_1_1' && stamped.stampedGateList.join(',') === 'goldEvalCheck,replay' && stamped.after.contentEdgeCount === 200;
			done({ pass, detail: err || stamped.summary });
		}),
	b_contentChangeRefused: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, { contentNodeCount: 100, contentEdgeCount: 201 }], gateVerdictList: goodVerdictList() }, ({ err }) =>
			done({ pass: /REFUSED: the stamp changed CONTENT — nodes 100 → 100, edges 200 → 201/.test(String(err)), detail: String(err || 'stamped despite a content change').slice(0, 160) })),
	c_verdictWithoutEvidenceRefused: (mutationList, done) => {
		const verdictList = goodVerdictList();
		delete verdictList[1].evidenceSha256;
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: verdictList }, ({ err, statementList }) =>
			done({ pass: /REFUSED: gateVerdictList\[1\]: evidenceSha256 is not 64 hex/.test(String(err)) && statementList.length === 0, detail: String(err || 'stamped a verdict without evidence').slice(0, 160) }));
	},
	e_vectorIndexesRenamedToThePromotedName: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList() }, ({ err, stamped, statementList }) => {
			const dropList = statementList.filter((oneStatement) => /^DROP INDEX `[^`]*_vector`$/.test(oneStatement));
			const createList = statementList.filter((oneStatement) => /^CREATE VECTOR INDEX/.test(oneStatement));
			const promotedNameList = ['GOLD_EVAL_TEST_promoted_embedText_vector', 'GOLD_EVAL_TEST_promoted_vector'];
			const pass = !err && dropList.length === 2 && createList.length === 2 &&
				promotedNameList.every((oneName) => createList.some((oneStatement) => oneStatement.indexOf(`\`${oneName}\``) !== -1 && /`vector\.dimensions`: 1024/.test(oneStatement))) &&
				statementList.some((oneStatement) => oneStatement === 'CALL db.awaitIndexes(600)') &&
				JSON.stringify(stamped.vectorIndexNameList) === JSON.stringify(promotedNameList);
			done({ pass, detail: err || `drop ${dropList.length}, create ${createList.length}, list ${JSON.stringify(stamped.vectorIndexNameList)}` });
		}),
	f_undeclaredVectorIndexRefused: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList(), indexRowList: SCRATCH_INDEX_ROW_LIST.concat([{ name: 'userContent_vector', labelsOrTypes: ['UserContent'], properties: ['embedding'], options: { indexConfig: { 'vector.dimensions': 1024, 'vector.similarity_function': 'COSINE' } } }]) }, ({ err, statementList }) =>
			done({ pass: /REFUSED: VECTOR index 'userContent_vector' on :UserContent\(embedding\) is not a declared vector slot/.test(String(err)) && !statementList.some((oneStatement) => /^DROP INDEX/.test(oneStatement)), detail: String(err || 'an undeclared VECTOR index passed the stamp').slice(0, 200) })),
	g_stampRowHasTheDeclaredIdentityAndLabels: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList() }, ({ err, statementList }) => {
			const rowStatementList = statementList.filter((oneStatement) => /writtenOnChannel/.test(oneStatement));
			const pass = !err && rowStatementList.length === 2 && rowStatementList.every((oneStatement) => /MERGE \(a:`BuildAttestation` \{gate: "(goldEvalCheck|replay)"\}\)/.test(oneStatement) && /REMOVE a:`ForgedNode`/.test(oneStatement) && /a\.writtenOnChannel = "promotionStamp"/.test(oneStatement));
			done({ pass, detail: err || `${rowStatementList.length} row statement(s); first: ${(rowStatementList[0] || '').replace(/\s+/g, ' ').slice(0, 220)}` });
		}),
	h_contractNamesTheStampableGates: (mutationList, done) => {
		const reforgeVerdictList = goodVerdictList().concat([{ gate: 'reforgeDeterminism', verdict: 'pass', detail: 'reforgeCompare run toyRun on head 0123456789ab: 4 of 4 comparison report(s) identical', evidencePath: '/tmp/reforgeEvidence.json', evidenceSha256: SHA }]);
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: reforgeVerdictList }, ({ err, stamped, statementList }) =>
			runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList().concat([{ ...reforgeVerdictList[2], gate: 'madeUpGate' }]) }, ({ err: unknownError, statementList: unknownStatementList }) => {
				const pass = !err && stamped.stampedGateList.join(',') === 'goldEvalCheck,replay,reforgeDeterminism' && statementList.some((oneStatement) => /MERGE \(a:`BuildAttestation` \{gate: "reforgeDeterminism"\}\)/.test(oneStatement)) &&
					/gate "madeUpGate" is not one of goldEvalCheck, replay, reforgeDeterminism/.test(String(unknownError)) && unknownStatementList.length === 0;
				done({ pass, detail: `${err || stamped.stampedGateList.join(',')} | unknown gate: ${String(unknownError || 'STAMPED').slice(0, 160)}` });
			}));
	},
	i_fulltextIndexRenamedToThePromotedName: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList() }, ({ err, stamped, statementList }) => {
			const fulltextCreateList = statementList.filter((oneStatement) => /^CREATE FULLTEXT INDEX/.test(oneStatement));
			const pass = !err && statementList.includes('DROP INDEX `DEV_gb_materialize_1_1_fulltext`') && fulltextCreateList.length === 1 &&
				/^CREATE FULLTEXT INDEX `GOLD_EVAL_TEST_promoted_fulltext` IF NOT EXISTS FOR \(n:`ForgedNode`\) ON EACH \[n\.`name`, n\.`description`\] OPTIONS/.test(fulltextCreateList[0]) &&
				fulltextCreateList[0].indexOf(`\`fulltext.analyzer\`: '${declaredFulltextAnalyzer}'`) !== -1 &&
				stamped.fulltextIndexName === 'GOLD_EVAL_TEST_promoted_fulltext' && /fulltext index GOLD_EVAL_TEST_promoted_fulltext \(1 renamed\)/.test(stamped.summary);
			done({ pass, detail: err || `${fulltextCreateList.join(' || ').slice(0, 220)} | ${stamped.summary}` });
		}),
	j_absentFulltextIndexRefused: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList(), fulltextIndexRowList: [] }, ({ err, statementList }) =>
			runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList(), indexRowList: [], fulltextIndexRowList: [] }, ({ err: vectorlessError, stamped: vectorlessStamped }) =>
				done({
					pass: /REFUSED: the graph carries 0 FULLTEXT index\(es\) \[\], not exactly one .* its keyword search leg would be absent/.test(String(err)) && !statementList.some((oneStatement) => /^DROP INDEX/.test(oneStatement))
						&& !vectorlessError && /fulltext index none \(the graph carries no vectors, so no search leg of either kind\)/.test(vectorlessStamped.summary),
					detail: `${String(err || 'a graph without its fulltext index passed the stamp').slice(0, 200)} | vectorless: ${vectorlessError || vectorlessStamped.summary}`,
				}))),
	k_undeclaredFulltextIndexRefused: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], gateVerdictList: goodVerdictList(), fulltextIndexRowList: [{ ...SCRATCH_FULLTEXT_ROW_LIST[0], properties: ['name', 'description', 'searchText'] }] }, ({ err, statementList }) =>
			done({ pass: /REFUSED: FULLTEXT index 'DEV_gb_materialize_1_1_fulltext' is :ForgedNode\(name, description, searchText\) analyzer .*, not the declared :ForgedNode\(name, description\)/.test(String(err)) && !statementList.some((oneStatement) => /^DROP INDEX/.test(oneStatement)), detail: String(err || 'an undeclared FULLTEXT index passed the stamp').slice(0, 220) })),
	d_passportSingletonRequired: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], passportCount: 2, gateVerdictList: goodVerdictList() }, ({ err }) =>
			done({ pass: /REFUSED: the graph does not hold exactly one GraphProvenance passport/.test(String(err)), detail: String(err || 'stamped a graph holding two passports').slice(0, 160) })),
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_stampWritesNameAndVerdictsOnly', twinName: 'scratchNameNotKept', find: 'SET p.scratchGraphName = coalesce(p.scratchGraphName, p.graphName),', replace: 'SET p.scratchGraphName = null,' },
	{ conjunctRefId: 'b_contentChangeRefused', twinName: 'censusComparisonRemoved', find: '\t\t\t\t\tif (after.contentNodeCount !== args.before.contentNodeCount || after.contentEdgeCount !== args.before.contentEdgeCount) {', replace: '\t\t\t\t\tif (false) {' },
	{ conjunctRefId: 'c_verdictWithoutEvidenceRefused', twinName: 'evidenceCheckRemoved', find: "\t\t\t\t.concat(oneVerdict && /^[0-9a-f]{64}$/.test(String(oneVerdict.evidenceSha256)) ? [] : ['evidenceSha256 is not 64 hex']);", replace: ';' },
	{ conjunctRefId: 'd_passportSingletonRequired', twinName: 'passportSingletonUnguarded', find: '\t\t\t\t\tWHERE size(passportList) = 1', replace: '\t\t\t\t\tWHERE size(passportList) >= 1' },
	{ conjunctRefId: 'g_stampRowHasTheDeclaredIdentityAndLabels', twinName: 'labelLessMergeOnStableId', find: '						MERGE (a:\\`${attestationLabel}\\` {gate: ${cypherString(oneVerdict.gate)}})', replace: '						MERGE (a {stableId: ${cypherString(stableId)}})' },
	{ conjunctRefId: 'e_vectorIndexesRenamedToThePromotedName', twinName: 'dropCreateNeverPlanned', find: '\t\t\t\tplan.dropCreateList.push({', replace: '\t\t\t\tvoid ({' },
	{ conjunctRefId: 'h_contractNamesTheStampableGates', twinName: 'gateListRestatedLocally', find: 'const STAMPABLE_GATE_LIST = ATTESTATION_GATE_LIST_BY_CHANNEL[STAMP_CHANNEL_NAME];', replace: "const STAMPABLE_GATE_LIST = Object.freeze(['goldEvalCheck', 'replay']);" },
	{ conjunctRefId: 'i_fulltextIndexRenamedToThePromotedName', twinName: 'fulltextRenameNeverPlanned', find: '\t\t\treturn oneRow.name === declaredName\n', replace: '\t\t\treturn true\n' },
	{ conjunctRefId: 'j_absentFulltextIndexRefused', twinName: 'fulltextCountCheckRemoved', find: '\t\t\tif (indexRowList.length !== 1) {', replace: "\t\t\tif (indexRowList.length === 0) { return { declaredName: fulltextIndexNameFor({ graphName: promotedGraphName }), dropCreateList: [], refusal: '' }; }\n\t\t\tif (indexRowList.length > 1) {" },
	{ conjunctRefId: 'k_undeclaredFulltextIndexRefused', twinName: 'fulltextShapeCheckRemoved', find: '\t\t\tif (rowText !== declaredText) {', replace: '\t\t\tif (false) {' },
	{ conjunctRefId: 'f_undeclaredVectorIndexRefused', twinName: 'labelCheckRemoved', find: "if (!slot || (oneRow.labelsOrTypes || [])[0] !== slot.label) {", replace: 'if (!slot) {' },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};

harness.section('BASELINE — the real stamp passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a stamp double (in memory)');
		harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), refIdList.slice().sort().join(','));
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) =>
				conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }], (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				})),
			() => harness.report(),
		);
	},
);
