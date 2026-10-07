#!/usr/bin/env node
'use strict';

// test-graphStructureCheck.js — gate for campaign P4a, PLAN G5 (instance structure, every standard with instances) and G6
// (code lists: ownership, counts per standard, the frozen source census). Pure: the row builders of
// lib/graph-structure-check.js over scripted Cypher rows, and the source-census loader over a scratch forge tree.
//
// PROVES:
//   (a) good instance rows (one declaration, one owner by the declared edge for the label suffix) -> pass
//   (b) instances short of one owner, or of one declaration -> fail naming the standard and the edge
//   (c) a declaration with instances that also carries its own match edge -> fail (its mappings would count twice)
//   (d) an instance label matching no declared suffix -> fail BY NAME (its owner edge is never guessed)
//   (e) an option value without exactly one owning set -> fail naming the standard
//   (f) a standard whose counts differ from its frozen source census -> fail naming the census file
//   (g) a standard with no source census is NAMED as not compared (never passed as compared)
//   (h) rootOwnership is a measurement: unreached nodes are counted by role and never fail
//   (i) the census loader refuses a declared census file that is absent, by name
// RED TWINS (in memory, module double): ownerRuleIgnored -> (b); ownMatchEdgeIgnored -> (c); suffixGuessed -> (d);
// valueOwnershipIgnored -> (e); censusMismatchIgnored -> (f); uncomparedHidden -> (g); absentCensusSkipped -> (i).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the graph-structure checks (instance structure, code lists, root ownership)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const CHECK_PATH = path.join(__dirname, '..', 'lib', 'graph-structure-check.js');
const checkFor = (mutationList) => (mutationList.length === 0 ? require(CHECK_PATH) : loadBuildJsDouble({ buildJsPath: CHECK_PATH, mutationList }));

// INSTANCE_STRUCTURE_CYPHER answers one row per (standard, label set, owner edge type); the declared owner row is judged
const instanceRowsFor = ({ standardName, labelList, judgedOwnerEdgeType, instanceCount, oneDeclarationInstanceCount, oneOwnerInstanceCount }) => ['HAS_FIELD', 'HAS_CHILD'].map((ownerEdgeType) => ({
	standardName, labelList, ownerEdgeType, instanceCount, oneDeclarationInstanceCount,
	oneOwnerInstanceCount: ownerEdgeType === judgedOwnerEdgeType ? oneOwnerInstanceCount : 0,
}));
const GOOD_INSTANCE_ROWS = [
	...instanceRowsFor({ standardName: 'SIFTOY', labelList: ['ForgedNode', 'DmeInstance', 'SifToyField'], judgedOwnerEdgeType: 'HAS_FIELD', instanceCount: 10, oneDeclarationInstanceCount: 10, oneOwnerInstanceCount: 10 }),
	...instanceRowsFor({ standardName: 'PESCTOY', labelList: ['ForgedNode', 'DmeInstance', 'PescToyOccurrence'], judgedOwnerEdgeType: 'HAS_CHILD', instanceCount: 7, oneDeclarationInstanceCount: 7, oneOwnerInstanceCount: 7 }),
];
const GOOD_DECLARATION_ROWS = [
	{ standardName: 'SIFTOY', declarationCount: 4, instanceCountMismatchCount: 0, declarationWithOwnMatchEdgeCount: 0 },
	{ standardName: 'PESCTOY', declarationCount: 3, instanceCountMismatchCount: 0, declarationWithOwnMatchEdgeCount: 0 },
];
const GOOD_OPTION_SET_ROWS = [{ standardName: 'PESCTOY', optionSetCount: 3, emptyOptionSetCount: 0 }, { standardName: 'HUBTOY', optionSetCount: 2, emptyOptionSetCount: 1 }];
const GOOD_OPTION_VALUE_ROWS = [{ standardName: 'PESCTOY', optionValueCount: 30, oneOptionSetValueCount: 30 }, { standardName: 'HUBTOY', optionValueCount: 5, oneOptionSetValueCount: 5 }];
const SOURCE_CENSUS = { PESCTOY: { optionSetCount: 3, optionValueCount: 30, censusFilePath: 'forges/pesctoy/lib/releaseCensus.json' } };

const conjunctJudgeByRefId = {
	a_goodInstancesPass: (mutationList, done) => {
		const row = checkFor(mutationList).instanceStructureRowFor({ instanceRowList: GOOD_INSTANCE_ROWS, declarationRowList: GOOD_DECLARATION_ROWS });
		done({ pass: row.verdict === 'pass' && row.checkName === 'instanceStructure' && Object.keys(row.measuredByStandard).length === 2, detail: `${row.verdict}: ${row.detail}` });
	},
	b_ownerOrDeclarationShortFails: (mutationList, done) => {
		const check = checkFor(mutationList);
		const ownerRow = check.instanceStructureRowFor({ instanceRowList: instanceRowsFor({ standardName: 'SIFTOY', labelList: ['DmeInstance', 'SifToyField'], judgedOwnerEdgeType: 'HAS_FIELD', instanceCount: 10, oneDeclarationInstanceCount: 10, oneOwnerInstanceCount: 9 }), declarationRowList: [] });
		const declarationRow = check.instanceStructureRowFor({ instanceRowList: instanceRowsFor({ standardName: 'PESCTOY', labelList: ['DmeInstance', 'PescToyOccurrence'], judgedOwnerEdgeType: 'HAS_CHILD', instanceCount: 7, oneDeclarationInstanceCount: 6, oneOwnerInstanceCount: 7 }), declarationRowList: [] });
		done({ pass: ownerRow.verdict === 'fail' && /SIFTOY: 1 of 10 instance\(s\) lack exactly one incoming HAS_FIELD/.test(ownerRow.detail) && declarationRow.verdict === 'fail' && /PESCTOY: 1 of 7 instance\(s\) lack exactly one HAS_INSTANCE/.test(declarationRow.detail), detail: `${ownerRow.detail} | ${declarationRow.detail}` });
	},
	c_declarationOwnMatchEdgeFails: (mutationList, done) => {
		const row = checkFor(mutationList).instanceStructureRowFor({ instanceRowList: GOOD_INSTANCE_ROWS, declarationRowList: [{ ...GOOD_DECLARATION_ROWS[0], declarationWithOwnMatchEdgeCount: 2 }] });
		done({ pass: row.verdict === 'fail' && /SIFTOY: 2 declaration\(s\) with instances also carry a match edge/.test(row.detail), detail: row.detail });
	},
	d_unknownLabelSuffixFailsByName: (mutationList, done) => {
		const row = checkFor(mutationList).instanceStructureRowFor({ instanceRowList: instanceRowsFor({ standardName: 'NEWTOY', labelList: ['DmeInstance', 'NewToyMention'], judgedOwnerEdgeType: 'HAS_FIELD', instanceCount: 4, oneDeclarationInstanceCount: 4, oneOwnerInstanceCount: 4 }), declarationRowList: [] });
		done({ pass: row.verdict === 'fail' && /NEWTOY: 4 instance\(s\) labelled DmeInstance:NewToyMention match 0 declared label suffixes/.test(row.detail), detail: row.detail });
	},
	e_valueWithoutOneSetFails: (mutationList, done) => {
		const row = checkFor(mutationList).codeListStructureRowFor({ optionSetRowList: GOOD_OPTION_SET_ROWS, optionValueRowList: [GOOD_OPTION_VALUE_ROWS[0], { ...GOOD_OPTION_VALUE_ROWS[1], oneOptionSetValueCount: 4 }], sourceCodeListCensusByStandard: SOURCE_CENSUS });
		done({ pass: row.verdict === 'fail' && /HUBTOY: 1 of 5 option value\(s\) lack exactly one owning option set/.test(row.detail), detail: row.detail });
	},
	f_sourceCensusMismatchFails: (mutationList, done) => {
		const check = checkFor(mutationList);
		const goodRow = check.codeListStructureRowFor({ optionSetRowList: GOOD_OPTION_SET_ROWS, optionValueRowList: GOOD_OPTION_VALUE_ROWS, sourceCodeListCensusByStandard: SOURCE_CENSUS });
		const badRow = check.codeListStructureRowFor({ optionSetRowList: GOOD_OPTION_SET_ROWS, optionValueRowList: GOOD_OPTION_VALUE_ROWS, sourceCodeListCensusByStandard: { PESCTOY: { ...SOURCE_CENSUS.PESCTOY, optionValueCount: 31 } } });
		done({ pass: goodRow.verdict === 'pass' && /1 standard\(s\) equal their frozen source census/.test(goodRow.detail) && badRow.verdict === 'fail' && /PESCTOY: option sets 3 \/ values 30 in the graph, 3 \/ 31 in the source census \(forges\/pesctoy\/lib\/releaseCensus.json\)/.test(badRow.detail), detail: `${goodRow.detail} | ${badRow.detail}` });
	},
	g_uncomparedStandardNamed: (mutationList, done) => {
		const row = checkFor(mutationList).codeListStructureRowFor({ optionSetRowList: GOOD_OPTION_SET_ROWS, optionValueRowList: GOOD_OPTION_VALUE_ROWS, sourceCodeListCensusByStandard: SOURCE_CENSUS });
		done({ pass: /not compared to a source census: HUBTOY/.test(row.detail) && row.measuredByStandard.HUBTOY.emptyOptionSetCount === 1, detail: row.detail });
	},
	h_rootOwnershipIsMeasured: (mutationList, done) => {
		const row = checkFor(mutationList).rootOwnershipRowFor({ rootRoleRowList: [{ standardName: 'PESCTOY', role: 'DmeOptionSet', contentNodeCount: 10, reachedNodeCount: 4 }, { standardName: 'PESCTOY', role: 'DmeProperty', contentNodeCount: 5, reachedNodeCount: 5 }] });
		done({ pass: row.verdict === 'measured' && row.measuredByStandard.PESCTOY.unreachedNodeCount === 6 && /PESCTOY 6 of 15 unreached \(DmeOptionSet 6\)/.test(row.detail), detail: `${row.verdict}: ${row.detail}` });
	},
	i_absentCensusRefusedByName: (mutationList, done) => {
		const scratchTreeRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'graphStructureCheck-'));
		fs.mkdirSync(path.join(scratchTreeRootPath, 'forges', 'pesctoy', 'lib'), { recursive: true });
		fs.writeFileSync(path.join(scratchTreeRootPath, 'forges', 'pesctoy', 'lib', 'releaseCensus.json'), JSON.stringify({ census: { namedCodeListCount: 2, anonymousCodeListCount: 1, codeCount: 30 } }));
		const check = checkFor(mutationList);
		const presentRead = check.sourceCodeListCensusFor({ treeRootPath: scratchTreeRootPath, standardDefinitionRowList: [{ sourceKey: 'PESCTOY', standardKey: 'pesctoy', standardFamily: 'PESC' }, { sourceKey: 'HUBTOY', standardKey: 'hubtoy', standardFamily: 'HUBTOY' }] });
		const absentRead = check.sourceCodeListCensusFor({ treeRootPath: scratchTreeRootPath, standardDefinitionRowList: [{ sourceKey: 'PESCGONE', standardKey: 'pescgone', standardFamily: 'PESC' }] });
		fs.rmSync(scratchTreeRootPath, { recursive: true, force: true });
		done({ pass: presentRead.refusal === '' && presentRead.sourceCodeListCensusByStandard.PESCTOY.optionSetCount === 3 && presentRead.sourceCodeListCensusByStandard.PESCTOY.optionValueCount === 30 && !presentRead.sourceCodeListCensusByStandard.HUBTOY && /PESCGONE: family PESC declares a source census at .*pescgone.*, which is absent/.test(absentRead.refusal), detail: `${JSON.stringify(presentRead.sourceCodeListCensusByStandard)} | ${absentRead.refusal || 'not refused'}` });
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'b_ownerOrDeclarationShortFails', twinName: 'ownerRuleIgnored', find: '		if (oneRow.oneOwnerInstanceCount !== oneRow.instanceCount) {', replace: '		if (false) {' },
	{ conjunctRefId: 'c_declarationOwnMatchEdgeFails', twinName: 'ownMatchEdgeIgnored', find: '		if (oneRow.declarationWithOwnMatchEdgeCount > 0) {', replace: '		if (false) {' },
	{ conjunctRefId: 'd_unknownLabelSuffixFailsByName', twinName: 'suffixGuessed', find: '		if (suffixList.length !== 1) {', replace: '		if (false) {' },
	{ conjunctRefId: 'e_valueWithoutOneSetFails', twinName: 'valueOwnershipIgnored', find: '		if (oneRow.oneOptionSetValueCount !== oneRow.optionValueCount) {', replace: '		if (false) {' },
	{ conjunctRefId: 'f_sourceCensusMismatchFails', twinName: 'censusMismatchIgnored', find: '		if (measured.optionSetCount !== sourceCensus.optionSetCount || measured.optionValueCount !== sourceCensus.optionValueCount) {', replace: '		if (false) {' },
	{ conjunctRefId: 'g_uncomparedStandardNamed', twinName: 'uncomparedHidden', find: "${uncomparedList.length ? `; not compared to a source census: ${uncomparedList.join(', ')}` : ''}", replace: '' },
	{ conjunctRefId: 'i_absentCensusRefusedByName', twinName: 'absentCensusSkipped', find: "			refusalList.push(`${sourceKey}: family ${standardFamily} declares a source census at ${censusFilePath}, which is absent`);", replace: '' },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real check passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a module double (in memory)');
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
