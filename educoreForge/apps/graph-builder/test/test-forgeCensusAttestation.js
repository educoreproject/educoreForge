#!/usr/bin/env node
'use strict';

// test-forgeCensusAttestation.js — gate for W-C-21 (PLAN G6; campaign P2): the forgeCensus BuildAttestation row compares
// the forge kit's own counts with the materialised graph, per standard, and fails BY NAME when a code list or code value
// the forge minted is missing from the graph. Pure: the row function and the runner's no-graph branches.
//
// PROVES:
//   (a) live counts equal to the forge's -> pass
//   (b) one option value missing (the graph holds 99 of the forged 100 DmeOptionValue) -> fail naming the standard, the
//       role and both numbers; an edge-type shortfall likewise
//   (c) a forge result with no stats -> notRun naming the standard (never pass)
//   (d) a replay (spec null) -> notRun, without touching a graph; an absent spec is refused by name
//   (e) the census Cypher keeps nodes minted outside the kit (hub cards, hub definition, text nodes) out of the count
//   (f) ⟪campaign P4a, G5/G6⟫ a failing structure check (instanceStructure, codeListStructure) fails the row by name, and
//       a passing one is reported in the detail; the row REFUSES to be built without the structure rows (no silent pass)
//   (g) the runner runs exactly the two verdict checks of graph-structure-check.js (rootOwnership is a measurement)
// RED TWINS (in memory, gate double): mismatchIgnored -> (b); statlessReadAsPass -> (c); kitExclusionDropped -> (e);
// structureFailureIgnored -> (f); structureCheckDropped -> (g).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the forgeCensus BuildAttestation row
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const GATE_PATH = path.join(__dirname, '..', 'lib', 'forge-census-gate.js');
const gateFor = (mutationList) => (mutationList.length === 0 ? require(GATE_PATH) : loadBuildJsDouble({ buildJsPath: GATE_PATH, mutationList }));

const EXPECTATION = { standardName: 'TOY', nodeCountByRole: { DmeOptionSet: 3, DmeOptionValue: 100, DmeStandardRoot: 1 }, edgeCountByType: { HAS_OPTION_SET: 3, HAS_VALUE: 100 } };
const LIVE_EQUAL = { TOY: { nodeCountByRole: { DmeOptionSet: 3, DmeOptionValue: 100, DmeStandardRoot: 1, DmeExtraUncounted: 7 }, edgeCountByType: { HAS_OPTION_SET: 3, HAS_VALUE: 100 } } };

const conjunctJudgeByRefId = {
	a_equalCountsPass: (mutationList, done) => {
		const row = gateFor(mutationList).forgeCensusRowFor({ expectationList: [EXPECTATION], liveByStandardName: LIVE_EQUAL, structureCheckRowList: [] });
		done({ pass: row.verdict === 'pass' && row.gate === 'forgeCensus', detail: `${row.verdict}: ${row.detail}` });
	},
	b_missingValueFailsByName: (mutationList, done) => {
		const gate = gateFor(mutationList);
		const nodeRow = gate.forgeCensusRowFor({ structureCheckRowList: [], expectationList: [EXPECTATION], liveByStandardName: { TOY: { ...LIVE_EQUAL.TOY, nodeCountByRole: { ...LIVE_EQUAL.TOY.nodeCountByRole, DmeOptionValue: 99 } } } });
		const edgeRow = gate.forgeCensusRowFor({ structureCheckRowList: [], expectationList: [EXPECTATION], liveByStandardName: { TOY: { ...LIVE_EQUAL.TOY, edgeCountByType: { HAS_OPTION_SET: 3 } } } });
		done({ pass: nodeRow.verdict === 'fail' && /TOY: role DmeOptionValue: forged 100, graph 99/.test(nodeRow.detail) && edgeRow.verdict === 'fail' && /edge HAS_VALUE: forged 100, graph 0/.test(edgeRow.detail), detail: `${nodeRow.detail} | ${edgeRow.detail}` });
	},
	c_statlessIsNotRun: (mutationList, done) => {
		const row = gateFor(mutationList).forgeCensusRowFor({ expectationList: [{ standardName: 'TOY' }], liveByStandardName: {}, structureCheckRowList: [] });
		done({ pass: row.verdict === 'notRun' && /no kit stats for TOY/.test(row.detail), detail: `${row.verdict}: ${row.detail}` });
	},
	d_replayNotRunAbsentRefused: (mutationList, done) => {
		const gate = gateFor(mutationList);
		gate.runForgeCensusGate({ containerHandle: null, forgeCensusSpec: null }, (replayError, replayRow) =>
			gate.runForgeCensusGate({ containerHandle: null }, (absentError) =>
				done({ pass: !replayError && replayRow.verdict === 'notRun' && /replay: no forge ran/.test(replayRow.detail) && /forgeCensusSpec is REQUIRED/.test(absentError), detail: `replay: ${replayError || replayRow.verdict} | absent: ${absentError || 'accepted'}` })));
	},
	e_kitOutsidersExcluded: (mutationList, done) => {
		const gate = gateFor(mutationList);
		// ⟪campaign P3, R2 finding⟫ hub cards and the hub definition are outside the kit; DmeEmbedText is INSIDE it (the derivation
		// mints through kit.makeNode, and the kit counts it), so excluding it made every standard read 'forged N, graph 0'
		const missingList = ['HubReference', 'HubDefinition'].filter((oneLabel) => gate.NODE_CENSUS_CYPHER.indexOf(`NOT n:\`${oneLabel}\``) === -1);
		const wronglyExcluded = gate.NODE_CENSUS_CYPHER.indexOf('NOT n:`DmeEmbedText`') !== -1;
		done({ pass: missingList.length === 0 && !wronglyExcluded, detail: `${missingList.length ? `not excluded: ${missingList.join(', ')}` : 'hub cards and hub definition excluded'}; DmeEmbedText ${wronglyExcluded ? 'WRONGLY excluded' : 'counted (kit-minted)'}` });
	},
	f_structureFailureFailsRow: (mutationList, done) => {
		const gate = gateFor(mutationList);
		const failingRow = gate.forgeCensusRowFor({ expectationList: [EXPECTATION], liveByStandardName: LIVE_EQUAL, structureCheckRowList: [{ checkName: 'instanceStructure', verdict: 'pass', detail: 'ok' }, { checkName: 'codeListStructure', verdict: 'fail', detail: 'FAILED — TOY: 1 of 100 option value(s) lack exactly one owning option set' }] });
		const passingRow = gate.forgeCensusRowFor({ expectationList: [EXPECTATION], liveByStandardName: LIVE_EQUAL, structureCheckRowList: [{ checkName: 'instanceStructure', verdict: 'pass', detail: 'every instance has one declaration and one owner' }] });
		let refusalText = '';
		try { gate.forgeCensusRowFor({ expectationList: [EXPECTATION], liveByStandardName: LIVE_EQUAL }); } catch (rowError) { refusalText = rowError.message; }
		done({ pass: failingRow.verdict === 'fail' && /codeListStructure fail: FAILED — TOY: 1 of 100 option value/.test(failingRow.detail) && passingRow.verdict === 'pass' && /instanceStructure pass: every instance/.test(passingRow.detail) && /structureCheckRowList is REQUIRED/.test(refusalText), detail: `${failingRow.verdict}: ${failingRow.detail} | ${passingRow.verdict} | refusal: ${refusalText || 'none'}` });
	},
	g_runnerRunsBothVerdictChecks: (mutationList, done) => {
		const gate = gateFor(mutationList);
		done({ pass: JSON.stringify(gate.STRUCTURE_CHECK_NAME_LIST) === JSON.stringify(['instanceStructure', 'codeListStructure']), detail: JSON.stringify(gate.STRUCTURE_CHECK_NAME_LIST) });
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'b_missingValueFailsByName', twinName: 'mismatchIgnored', find: "		return mismatchList.length ? soFar.concat(", replace: "		return false ? soFar.concat(" },
	{ conjunctRefId: 'c_statlessIsNotRun', twinName: 'statlessReadAsPass', find: '	if (statlessList.length) {\n		return { gate: GATE_NAME, verdict: vocabulary.BUILD_ATTESTATION_VERDICT.NOT_RUN,', replace: '	if (statlessList.length) {\n		return { gate: GATE_NAME, verdict: vocabulary.BUILD_ATTESTATION_VERDICT.PASS,' },
	{ conjunctRefId: 'e_kitOutsidersExcluded', twinName: 'kitExclusionDropped', find: "const OUTSIDE_THE_KIT_LABEL_LIST = Object.freeze(['HubReference', 'HubDefinition']);", replace: "const OUTSIDE_THE_KIT_LABEL_LIST = Object.freeze(['HubDefinition']);" },
	// the P2 list: text nodes excluded although the kit counts them
	{ conjunctRefId: 'e_kitOutsidersExcluded', twinName: 'textNodesExcludedAgain', find: "const OUTSIDE_THE_KIT_LABEL_LIST = Object.freeze(['HubReference', 'HubDefinition']);", replace: "const OUTSIDE_THE_KIT_LABEL_LIST = Object.freeze(['HubReference', 'HubDefinition', vocabulary.EMBED_TEXT_VECTOR.label]);" },
	{ conjunctRefId: 'f_structureFailureFailsRow', twinName: 'structureFailureIgnored', find: "	const failedStructureRowList = structureCheckRowList.filter((oneRow) => oneRow.verdict !== vocabulary.BUILD_ATTESTATION_VERDICT.PASS);", replace: '	const failedStructureRowList = [];' },
	{ conjunctRefId: 'g_runnerRunsBothVerdictChecks', twinName: 'structureCheckDropped', find: "const STRUCTURE_CHECK_NAME_LIST = Object.freeze(['instanceStructure', 'codeListStructure']);", replace: "const STRUCTURE_CHECK_NAME_LIST = Object.freeze(['instanceStructure']);" },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real gate passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a gate double (in memory)');
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
