#!/usr/bin/env node
'use strict';

// test-bgForensicRecord.js — BG-FORENSICRECORD (W-B-8, V1-C15 / V1-S83/S88/S89; campaign P3 2026-10-06): the judgment
// component writes forensic records of the ONE declared shape (lib/match-forensics MATCH_FORENSICS_RECORD_SHAPE_BY_KIND)
// and carries the text judge's ideaCoverage instead of dropping it. The store contract itself is test-match-forensics
// SECTION 4; this file proves the WRITER keeps it, through a real framework run over the toy fixture.
//
//   BG-FORENSICRECORD  (a) under a real-client double that reports ideaCoverage, every judgment record carries it
//                      verbatim; (b) under the debug judge every judgment record has exactly the declared key set,
//                      ideaCoverage null and usage null (the toy forensics double applies the same contract, so an
//                      undeclared key would refuse the run).
//
// Run: node lib/bridge-framework/test/test-bgForensicRecord.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-FORENSICRECORD: the judgment component writes the declared forensic record

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, succeeded, frameworkMutationTwin, forensicsOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const matchForensicsLib = require(path.join(__dirname, '..', '..', 'match-forensics', 'match-forensics'));

const twinRegistry = makeTwinRegistry();
const JUDGE_COMPONENT_FILE = 'judgeComponent.js';
const IDEA_COVERAGE = Object.freeze({ coveredIdeaList: ['student', 'birth date'], uncoveredIdeaList: [] });
const IDEA_COVERAGE_RECORD_FIND = '					ideaCoverage: judgment.ideaCoverage === undefined ? null : judgment.ideaCoverage,\n';
const judgmentRecordListOf = (outcome) => forensicsOf(outcome).map((oneEntry) => oneEntry.record).filter((oneRecord) => oneRecord.kind === undefined && oneRecord.refusedAttempt === undefined);

const conjunctList = [
	runConjunct({
		conjunctId: 'a_ideaCoverageCarriedVerbatim',
		title: 'under a real-client double that reports ideaCoverage, every judgment record carries it verbatim',
		twinNameList: ['ideaCoverageDroppedAtDeliver'],
		shape: (scenario) => {
			scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ extraReturnKeys: { ideaCoverage: IDEA_COVERAGE } });
		},
		judge: succeeded((runReport, outcome) => {
			const recordList = judgmentRecordListOf(outcome);
			const carrying = recordList.filter((oneRecord) => JSON.stringify(oneRecord.ideaCoverage) === JSON.stringify(IDEA_COVERAGE)).length;
			return { pass: recordList.length > 0 && carrying === recordList.length, detail: `${recordList.length} judgment record(s), ${carrying} carrying the reported ideaCoverage` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_debugRecordsHaveExactlyTheDeclaredKeys',
		title: 'under the debug judge every judgment record has exactly the declared key set, ideaCoverage null and usage null',
		twinNameList: ['undeclaredKeyWrittenAtDeliver'],
		judge: succeeded((runReport, outcome) => {
			const recordList = judgmentRecordListOf(outcome);
			const faultList = recordList.map((oneRecord) => matchForensicsLib.recordShapeViolation(oneRecord)).filter(Boolean);
			const notNull = recordList.filter((oneRecord) => oneRecord.ideaCoverage !== null || oneRecord.usage !== null).length;
			return { pass: recordList.length > 0 && faultList.length === 0 && notNull === 0, detail: `${recordList.length} record(s); ${faultList.length} shape fault(s)${faultList.length ? `: ${faultList[0]}` : ''}; ${notNull} with a non-null ideaCoverage or usage` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FORENSICRECORD', conjunctId: 'a_ideaCoverageCarriedVerbatim', twinName: 'ideaCoverageDroppedAtDeliver', fileName: JUDGE_COMPONENT_FILE, find: IDEA_COVERAGE_RECORD_FIND, replace: '					ideaCoverage: null,\n' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FORENSICRECORD', conjunctId: 'b_debugRecordsHaveExactlyTheDeclaredKeys', twinName: 'undeclaredKeyWrittenAtDeliver', fileName: JUDGE_COMPONENT_FILE, find: IDEA_COVERAGE_RECORD_FIND, replace: `${IDEA_COVERAGE_RECORD_FIND}					judgedVia: 'live',\n` });

const gateDeclarationList = [{ gateId: 'BG-FORENSICRECORD', title: 'the judgment component writes the declared forensic record and carries ideaCoverage', conjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-FORENSICRECORD', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 2 },
	() => harness.report(),
);
