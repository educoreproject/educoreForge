#!/usr/bin/env node
'use strict';

// test-promotionStamp.js — the promotion stamp (lane P, mappingProvenance 2026-10-04) writes the graph's real name and the
// post-build verdicts, and changes NO content. Pure: a runCypher double answers the stamp's statements and records them.
//   (a) a well-formed stamp succeeds, sets graphName to the promoted name keeping the scratch name, attests both gates,
//       and reports the content census unchanged
//   (b) a content change between the BEFORE and AFTER census is REFUSED by name
//   (c) a verdict without its evidence sha256 is REFUSED by name before anything is written
//   (d) a graph holding TWO passports is REFUSED by name (the singleton guard in the statement)
// RED TWINS, each observed in memory: (a) the scratch name not kept; (b) the census comparison removed; (c) the evidence
// check removed; (d) the passport singleton check removed.

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
const runCypherDouble = ({ censusList, passportCount = 1 }) => {
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
		if (/MERGE \(a \{stableId:/.test(cypher)) {
			callback('', { records: [recordOf({ rowCount: 1 })] });
			return;
		}
		callback(`unexpected statement: ${cypher.slice(0, 80)}`);
	};
	return { runCypher, statementList };
};

const runStamp = ({ mutationList, censusList, passportCount, gateVerdictList }, callback) => {
	const cypherDouble = runCypherDouble({ censusList, passportCount });
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
	d_passportSingletonRequired: (mutationList, done) =>
		runStamp({ mutationList, censusList: [SAME_CENSUS, SAME_CENSUS], passportCount: 2, gateVerdictList: goodVerdictList() }, ({ err }) =>
			done({ pass: /REFUSED: the graph does not hold exactly one GraphProvenance passport/.test(String(err)), detail: String(err || 'stamped a graph holding two passports').slice(0, 160) })),
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_stampWritesNameAndVerdictsOnly', twinName: 'scratchNameNotKept', find: 'SET p.scratchGraphName = coalesce(p.scratchGraphName, p.graphName),', replace: 'SET p.scratchGraphName = null,' },
	{ conjunctRefId: 'b_contentChangeRefused', twinName: 'censusComparisonRemoved', find: '\t\t\t\t\tif (after.contentNodeCount !== args.before.contentNodeCount || after.contentEdgeCount !== args.before.contentEdgeCount) {', replace: '\t\t\t\t\tif (false) {' },
	{ conjunctRefId: 'c_verdictWithoutEvidenceRefused', twinName: 'evidenceCheckRemoved', find: "\t\t\t\t.concat(oneVerdict && /^[0-9a-f]{64}$/.test(String(oneVerdict.evidenceSha256)) ? [] : ['evidenceSha256 is not 64 hex']);", replace: ';' },
	{ conjunctRefId: 'd_passportSingletonRequired', twinName: 'passportSingletonUnguarded', find: '\t\t\t\t\tWHERE size(passportList) = 1', replace: '\t\t\t\t\tWHERE size(passportList) >= 1' },
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
