#!/usr/bin/env node
'use strict';

// test-gSweep.js — G-SWEEP (SPEC-forgeFramework-v1.md §10.1; §10.3): the sweep reports DEFECTIVE for a
// conjunct whose registered twin does not turn it red and UNPROVEN for a conjunct with no (counting)
// twin; the registry audit reports missing and orphaned twins; a twin registered expectationLever
// does not count toward observed-red; a shippedConfig:false twin is reported as such; a conjunct whose
// baseline is red is FAILING, not observed. The SUBJECT is a small synthetic gate + registry (data);
// the twins here are productionMutations of the ENGINE (gateEvaluator.js / twinRegistry.js through
// the module double) — the sweep itself has a twin.
//
// Run: node lib/forge-framework/test/test-gSweep.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-SWEEP: the twin sweep and registry audit report DEFECTIVE / UNPROVEN / missing / orphaned honestly

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { scenarioTwin } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const moduleDouble = require('./testSupport/moduleDouble');
const twinRegistryLib = require('../roundTripHarness/twinRegistry');
const gateEvaluatorLib = require('../roundTripHarness/gateEvaluator');

const GATE_ID = 'G-SWEEP';
const outerRegistry = twinRegistryLib.makeTwinRegistry();
const HARNESS_DIR = path.join(toyScenario.FRAMEWORK_DIR, 'roundTripHarness');
const EVALUATOR_PATH = path.join(HARNESS_DIR, 'gateEvaluator.js');
const REGISTRY_PATH = path.join(HARNESS_DIR, 'twinRegistry.js');

// the engine under test — the real one, or a double with the twin's mutations
const engineFor = (scenario) => ({
	evaluator: scenario.engineMutationList && scenario.engineMutationList.length ? moduleDouble.loadWithMutations({ modulePath: EVALUATOR_PATH, mutationList: scenario.engineMutationList }) : gateEvaluatorLib,
	registryLib: scenario.engineMutationList && scenario.engineMutationList.length ? moduleDouble.loadWithMutations({ modulePath: REGISTRY_PATH, mutationList: scenario.engineMutationList }) : twinRegistryLib,
});

// a synthetic gate: subject { value }, conjunct passes when value === 1
const syntheticGateList = () => [{ gateId: 'G-SYN', title: 'synthetic', conjunctList: [{ conjunctId: 'valueIsOne', title: 'value === 1', twinNameList: ['setValueTwo'], evaluate: (subject, callback) => callback('', { pass: subject.value === 1, detail: `value ${subject.value}` }) }] }];
const syntheticSubject = () => ({ value: 1 });
const cloneSynthetic = (subject) => ({ ...subject });

const sweepWith = ({ scenario, registerTwins, subject, gateList }, callback) => {
	const { evaluator, registryLib } = engineFor(scenario);
	const innerRegistry = registryLib.makeTwinRegistry();
	registerTwins(innerRegistry);
	evaluator.sweepTwins({ gateDeclarationList: gateList || syntheticGateList(), twinRegistry: innerRegistry, subject: subject || syntheticSubject(), cloneSubject: cloneSynthetic }, (sweepError, sweep) => callback(sweepError, sweep, innerRegistry));
};

const conjunctList = [
	{
		conjunctId: 'noOpTwinReportsDefective',
		title: 'a registered NO-OP twin (the gate stays green under it) → the sweep reports that conjunct DEFECTIVE (count EQUALS 1, observedRed 0)',
		twinNameList: ['countGreenAsRed'],
		evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => registry.register({ gateId: 'G-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => subject }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.defectiveCount === 1 && sweep.observedRedCount === 0 && sweep.conjunctReportList[0].status === 'DEFECTIVE', detail: sweepError || `defective ${sweep.defectiveCount}, observedRed ${sweep.observedRedCount}, status ${sweep.conjunctReportList[0].status}` })),
	},
	{
		conjunctId: 'realTwinObservedRed',
		title: 'a REAL twin (value → 2) → observedRed (count EQUALS 1, everyConjunctObservedRed true)',
		twinNameList: ['countRedAsGreen'],
		evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => registry.register({ gateId: 'G-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => ({ ...subject, value: 2 }) }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.observedRedCount === 1 && sweep.everyConjunctObservedRed === true, detail: sweepError || `observedRed ${sweep.observedRedCount}, everyConjunctObservedRed ${sweep.everyConjunctObservedRed}` })),
	},
	{
		conjunctId: 'noTwinReportsUnproven',
		title: 'a conjunct with NO twin → UNPROVEN (count EQUALS 1)',
		twinNameList: ['countUnprovenAsRed'],
		evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: () => {} }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.unprovenCount === 1 && sweep.conjunctReportList[0].status === 'UNPROVEN', detail: sweepError || `unproven ${sweep.unprovenCount}, status ${sweep.conjunctReportList[0].status}` })),
	},
	{
		conjunctId: 'expectationLeverOnlyIsUnproven',
		title: 'an expectationLever twin as the ONLY twin → UNPROVEN and listed under expectationLeverList (recorded, not counted)',
		twinNameList: ['countExpectationLever'],
		evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => registry.register({ gateId: 'G-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'expectationLever', shippedConfig: true, run: (subject) => ({ ...subject, value: 2 }) }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.unprovenCount === 1 && sweep.expectationLeverList.length === 1 && sweep.observedRedCount === 0, detail: sweepError || `unproven ${sweep.unprovenCount}, expectationLever ${sweep.expectationLeverList.length}, observedRed ${sweep.observedRedCount}` })),
	},
	{
		conjunctId: 'shippedConfigFalseReported',
		title: 'a shippedConfig:false twin is reported in shippedConfigFalseList (count EQUALS 1)',
		twinNameList: ['hideShippedConfigFalse'],
		evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => registry.register({ gateId: 'G-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'inputFault', shippedConfig: false, run: (subject) => ({ ...subject, value: 2 }) }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.shippedConfigFalseList.length === 1, detail: sweepError || `shippedConfigFalseList ${JSON.stringify(sweep.shippedConfigFalseList)}` })),
	},
	{
		conjunctId: 'redBaselineIsFailing',
		title: 'a conjunct whose BASELINE is red is FAILING (not observed red, even with a twin)',
		twinNameList: ['countFailingAsRed'],
		evaluate: (scenario, callback) => sweepWith({ scenario, subject: { value: 5 }, registerTwins: (registry) => registry.register({ gateId: 'G-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => ({ ...subject, value: 2 }) }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.failingCount === 1 && sweep.observedRedCount === 0, detail: sweepError || `failing ${sweep.failingCount}, observedRed ${sweep.observedRedCount}` })),
	},
	{
		conjunctId: 'auditReportsMissingAndOrphaned',
		title: 'the registry audit reports a declared-but-unregistered twin as MISSING and an implementation no gate declares as ORPHANED (counts EQUAL 1 and 1)',
		twinNameList: ['auditNeverReports'],
		evaluate: (scenario, callback) => {
			const { registryLib } = engineFor(scenario);
			const innerRegistry = registryLib.makeTwinRegistry();
			innerRegistry.register({ gateId: 'G-GHOST', conjunctId: 'nobodyDeclaresThis', twinName: 'orphan', leverKind: 'inputFault', shippedConfig: true, run: (subject) => subject });
			const audit = innerRegistry.auditRegistryAgainst({ gateDeclarationList: syntheticGateList() });
			callback('', { pass: audit.missingList.length === 1 && audit.orphanList.length === 1 && /setValueTwo/.test(audit.missingList[0]) && /orphan/.test(audit.orphanList[0]), detail: JSON.stringify(audit) });
		},
	},
	{
		conjunctId: 'staleFindReportsUnproven',
		title: 'FA1: a twin whose framework mutation cannot be applied (a STALE find — the run throws MODULE_DOUBLE_MUTATION_REFUSED) proves NOTHING → the conjunct is UNPROVEN, never observedRed',
		twinNameList: ['countUnappliedTwinAsRan'],
		evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => registry.register({ gateId: 'G-SYN', conjunctId: 'valueIsOne', twinName: 'staleFind', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => { moduleDouble.assertMutationApplies({ modulePath: EVALUATOR_PATH, find: 'this text is not in gateEvaluator.js at all' }); return { ...subject, value: 2 }; } }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.unprovenCount === 1 && sweep.observedRedCount === 0 && /could not be applied and proved nothing/.test(sweep.conjunctReportList[0].note), detail: sweepError || `unproven ${sweep.unprovenCount}, observedRed ${sweep.observedRedCount}, note ${sweep.conjunctReportList[0].note.slice(0, 120)}` })),
	},
	{
		conjunctId: 'unmeasuredUnderTwinIsNotRed',
		title: 'a twin that makes the conjunct UNMEASURED (evaluate throws) is NOT counted as red — the conjunct is DEFECTIVE',
		twinNameList: ['countUnmeasuredAsRed'],
		evaluate: (scenario, callback) => {
			const gateList = [{ gateId: 'G-SYN', title: 'synthetic', conjunctList: [{ conjunctId: 'valueIsOne', title: 'value === 1', evaluate: (subject, cb) => { if (subject.explode) { throw new Error('boom'); } cb('', { pass: subject.value === 1 }); } }] }];
			sweepWith({ scenario, gateList, registerTwins: (registry) => registry.register({ gateId: 'G-SYN', conjunctId: 'valueIsOne', twinName: 'explode', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => ({ ...subject, explode: true }) }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.defectiveCount === 1 && sweep.conjunctReportList[0].twinReportList[0].statusUnderTwin === 'UNMEASURED', detail: sweepError || `defective ${sweep.defectiveCount}, statusUnderTwin ${sweep.conjunctReportList[0].twinReportList[0].statusUnderTwin}` }));
		},
	},
];

const engineTwin = ({ conjunctId, twinName, modulePath, find, replace }) => scenarioTwin({ registry: outerRegistry, gateId: GATE_ID, conjunctId, twinName, leverKind: 'productionMutation', mutate: (scenario) => { scenario.engineMutationList = (scenario.engineMutationList || []).concat([{ modulePath, find, replace }]); } });
engineTwin({ conjunctId: 'noOpTwinReportsDefective', twinName: 'countGreenAsRed', modulePath: EVALUATOR_PATH, find: '\t\t\t\t\tconst gateWentRed = twinResult.status === CONJUNCT_STATUS.FAIL;', replace: '\t\t\t\t\tconst gateWentRed = true;' });
engineTwin({ conjunctId: 'realTwinObservedRed', twinName: 'countRedAsGreen', modulePath: EVALUATOR_PATH, find: '\t\t\t\t\tconst gateWentRed = twinResult.status === CONJUNCT_STATUS.FAIL;', replace: '\t\t\t\t\tconst gateWentRed = false;' });
engineTwin({ conjunctId: 'noTwinReportsUnproven', twinName: 'countUnprovenAsRed', modulePath: EVALUATOR_PATH, find: '\t\t\t\t\t\tcountingReports.length === 0\n\t\t\t\t\t\t\t? SWEEP_STATUS.UNPROVEN', replace: '\t\t\t\t\t\tcountingReports.length === 0\n\t\t\t\t\t\t\t? SWEEP_STATUS.OBSERVED_RED' });
engineTwin({ conjunctId: 'expectationLeverOnlyIsUnproven', twinName: 'countExpectationLever', modulePath: REGISTRY_PATH, find: "const COUNTING_LEVER_KIND_LIST = Object.freeze(['productionMutation', 'inputFault']);", replace: "const COUNTING_LEVER_KIND_LIST = Object.freeze(['productionMutation', 'inputFault', 'expectationLever']);" });
engineTwin({ conjunctId: 'shippedConfigFalseReported', twinName: 'hideShippedConfigFalse', modulePath: EVALUATOR_PATH, find: '\t\t\t\t\t.filter((oneTwinReport) => oneTwinReport.shippedConfig === false)', replace: '\t\t\t\t\t.filter((oneTwinReport) => oneTwinReport.shippedConfig === null)' });
engineTwin({ conjunctId: 'redBaselineIsFailing', twinName: 'countFailingAsRed', modulePath: EVALUATOR_PATH, find: '\t\t\tif (baselineResult.status !== CONJUNCT_STATUS.PASS) {', replace: '\t\t\tif (false && baselineResult.status !== CONJUNCT_STATUS.PASS) {' });
engineTwin({ conjunctId: 'auditReportsMissingAndOrphaned', twinName: 'auditNeverReports', modulePath: REGISTRY_PATH, find: '\t\treturn { missingList, orphanList };', replace: '\t\treturn { missingList: [], orphanList: [] };' });
engineTwin({ conjunctId: 'staleFindReportsUnproven', twinName: 'countUnappliedTwinAsRan', modulePath: EVALUATOR_PATH, find: '\t\t\t\t\ttwinReportList.push({ gateId: gate.gateId, conjunctId: conjunct.conjunctId, twinName: oneTwin.twinName, leverKind: oneTwin.leverKind, shippedConfig: oneTwin.shippedConfig, ran: false, gateWentRed: false, detail: `twin run THREW: ${runError}` });', replace: '\t\t\t\t\ttwinReportList.push({ gateId: gate.gateId, conjunctId: conjunct.conjunctId, twinName: oneTwin.twinName, leverKind: oneTwin.leverKind, shippedConfig: oneTwin.shippedConfig, ran: true, gateWentRed: true, detail: `twin run THREW: ${runError}` });' });
engineTwin({ conjunctId: 'unmeasuredUnderTwinIsNotRed', twinName: 'countUnmeasuredAsRed', modulePath: EVALUATOR_PATH, find: '\t\t\t\t\tconst gateWentRed = twinResult.status === CONJUNCT_STATUS.FAIL;', replace: '\t\t\t\t\tconst gateWentRed = twinResult.status !== CONJUNCT_STATUS.PASS;' });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the sweep itself', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry: outerRegistry, makeSubject: () => ({ engineMutationList: [] }), cloneSubject: (scenario) => ({ engineMutationList: (scenario.engineMutationList || []).slice() }), expectedConjunctCount: 9, expectedTwinCount: 9 }, () => harness.report());
