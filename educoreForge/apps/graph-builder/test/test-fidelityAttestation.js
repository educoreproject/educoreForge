#!/usr/bin/env node
'use strict';

// test-fidelityAttestation.js — the 'fidelity' BuildAttestation row says WHICH success the R-1 gate had (lane R, leftovers
// 2026-10-05; FINDING 5-A of 2026-09-01). The runner's callback('') was reachable from three states the call site could not
// tell apart, so no row was supplied and the row read notRun on every build, even when the gate ran. Now the runner reports
// a row and the materialize tail hands it to finish. Hermetic: the judgment module, build.js's runner (skip branch) and
// materialize tail over doubles, and the real attestation finisher.
//   (a) SKIPPED (CEDS not in the build) → the runner reports notRun, naming the skip
//   (b) GENUINE PASS (zero lost) → pass
//   (c) LOSS ALLOWED (lost > 0 within --allowFidelityLoss) → passWithAllowedLoss, naming the lost count
//   (d) an allowance NAMED but not needed (zero lost) → pass, never passWithAllowedLoss
//   (e) the runner's row REACHES the graph: materialize hands it to finish, and the finisher records it as supplied
//   (f) a runner that succeeds WITHOUT a row is REFUSED by name (the row would otherwise be a guess)
//   (g) the finisher REFUSES a verdict outside vocabulary.BUILD_ATTESTATION_VERDICT_LIST by name
// RED TWINS, each observed in memory, by message: (a) the runner's skip calls back with nothing (the pre-lane-R code);
// (b) every pass reported as allowed loss; (c) every pass reported as plain pass (the derived pass FINDING 5-A forbade);
// (d) the allowance rule (allowance > 0) instead of the loss rule; (e) the tail dropping the fidelity row; (f) the
// tail's refusal removed; (g) the finisher's vocabulary check removed.
//
// Run: node apps/graph-builder/test/test-fidelityAttestation.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the fidelity BuildAttestation row is the R-1 runner's own report (notRun | pass | passWithAllowedLoss)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const vocabulary = require('../../../lib/vocabulary/vocabulary');
const moduleDouble = require('../../../lib/forge-framework/test/testSupport/moduleDouble');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const JUDGMENT_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'ceds-fidelity-judgment', 'ceds-fidelity-judgment.js');
const FINISHER_PATH = path.join(__dirname, '..', 'apps', 'replay-manager', 'lib', 'finishing', 'lib', 'build-attestation-finisher.js');
const { BUILD_ATTESTATION_VERDICT } = vocabulary;

const silentXLog = { status: () => {}, result: () => {}, error: () => {}, verbose: () => {} };
const clean = { sourceStatements: 239761, matched: 239761, lost: 0, invented: 0 };

// each judge takes { buildJsMutationList, judgmentMutationList, finisherMutationList } and calls done({ pass, detail })
const buildLibFor = (mutationList) => (mutationList.length === 0 ? require(BUILD_JS_PATH) : loadBuildJsDouble({ buildJsPath: BUILD_JS_PATH, mutationList }));
const judgmentLibFor = (mutationList) => (mutationList.length === 0 ? require(JUDGMENT_PATH) : moduleDouble.loadWithMutations({ modulePath: JUDGMENT_PATH, mutationList }))();
const finisherFor = (mutationList) => (mutationList.length === 0 ? require(FINISHER_PATH) : moduleDouble.loadWithMutations({ modulePath: FINISHER_PATH, mutationList }))({ vocabulary });

// a passing headline judged and turned into the row, through the (possibly mutated) judgment module
const attestationOf = (judgmentLib, { headline, allowedLoss }) => {
	const verdict = judgmentLib.judgeFidelity({ headline, allowedLoss, graphName: 'G' });
	const attestationRead = judgmentLib.attestationFor({ verdict, headline });
	return attestationRead.error ? { verdict: `REFUSED: ${attestationRead.error}` } : attestationRead.attestation;
};

// the materialize tail over doubles: the replay double records what finish was handed
const runMaterialize = (buildLib, fidelityGateRunner, done) => {
	const finishCallList = [];
	const replayDouble = {
		create: (spec, callback) => callback('', { graphName: 'DEV_fidelityAttestationDouble', boltUrl: 'bolt://double:1' }),
		init: (spec, callback) => callback(''),
		delete: (graphHandle, callback) => callback(''),
		finish: (spec, callback) => {
			finishCallList.push(spec);
			callback('', { passportElementId: 'double:passport', writeCount: 1, xorVerified: true, applied: [] });
		},
	};
	buildLib.materializeSchemaBlocks(
		{
			xLog: silentXLog,
			replay: replayDouble,
			resolvedSchemaBlocks: [],
			manifestId: 'double-manifest',
			memberCount: 0,
			standardTokens: ['ceds'],
			commandLineParameters: { switches: {}, values: {} },
			fidelityGateRunner,
			storeResolver: () => {},
			storeReader: { getManifest: () => {} },
			roundTripStageRunner: (spec, callback) => callback('', { stageRan: false, disposition: 'double: stage not run' }),
			roundTripStageSpec: { mode: 'double' },
			frameworkFingerprintList: [], // campaign P2 (W-A-3): materialize requires the list; no decision block here
		},
		(materializeError) => done({ materializeError, gateResults: finishCallList.length ? finishCallList[0].gateResults : null }),
	);
};
const allowedLossRunner = (runnerArguments, callback) =>
	callback('', { gate: 'fidelity', verdict: BUILD_ATTESTATION_VERDICT.PASS_WITH_ALLOWED_LOSS, detail: 'double: 12 lost under an allowance of 12', inventedTotal: 0 });

const conjunctJudgeByRefId = {
	a_skippedIsNotRun: ({ buildJsMutationList }, done) => {
		buildLibFor(buildJsMutationList).runCedsFidelityGate({ xLog: silentXLog, graphName: 'G', standardTokens: ['edfi', 'sif260928'], commandLineParameters: {} }, (gateError, attestation) => {
			const pass = !gateError && !!attestation && attestation.verdict === BUILD_ATTESTATION_VERDICT.NOT_RUN && /skipped: CEDS is not among this build's standards/.test(attestation.detail);
			done({ pass, detail: gateError || `reported ${JSON.stringify(attestation)}` });
		});
	},
	b_genuinePassIsPass: ({ judgmentMutationList }, done) => {
		const attestation = attestationOf(judgmentLibFor(judgmentMutationList), { headline: clean, allowedLoss: 0 });
		done({ pass: attestation.verdict === BUILD_ATTESTATION_VERDICT.PASS && attestation.inventedTotal === 0, detail: `zero lost → ${attestation.verdict}` });
	},
	c_allowedLossIsPassWithAllowedLoss: ({ judgmentMutationList }, done) => {
		const attestation = attestationOf(judgmentLibFor(judgmentMutationList), { headline: { ...clean, matched: 239749, lost: 12 }, allowedLoss: 12 });
		const pass = attestation.verdict === BUILD_ATTESTATION_VERDICT.PASS_WITH_ALLOWED_LOSS && /lost 12/.test(attestation.detail || '') && /knowingly incomplete/.test(attestation.detail || '');
		done({ pass, detail: `12 lost under an allowance of 12 → ${attestation.verdict}: ${attestation.detail}` });
	},
	d_allowanceNotNeededIsPass: ({ judgmentMutationList }, done) => {
		const attestation = attestationOf(judgmentLibFor(judgmentMutationList), { headline: clean, allowedLoss: 5 });
		const pass = attestation.verdict === BUILD_ATTESTATION_VERDICT.PASS && /was not needed/.test(attestation.detail || '');
		done({ pass, detail: `zero lost under an allowance of 5 → ${attestation.verdict}: ${attestation.detail}` });
	},
	e_runnerRowReachesTheGraph: ({ buildJsMutationList, finisherMutationList }, done) => {
		runMaterialize(buildLibFor(buildJsMutationList), allowedLossRunner, ({ materializeError, gateResults }) => {
			if (materializeError || !gateResults) {
				done({ pass: false, detail: materializeError || 'finish was never called' });
				return;
			}
			finisherFor(finisherMutationList).emit({ gateResults }, (emitError, emitted) => {
				const fidelityNode = emitError ? null : emitted.nodes.find((oneNode) => oneNode.properties.gate === 'fidelity');
				const pass = !!fidelityNode && fidelityNode.properties.verdict === BUILD_ATTESTATION_VERDICT.PASS_WITH_ALLOWED_LOSS && fidelityNode.properties.verdictSupplied === true;
				done({ pass, detail: emitError || `fidelity row ${fidelityNode ? `${fidelityNode.properties.verdict} supplied=${fidelityNode.properties.verdictSupplied}` : 'absent'}; gateResults gates ${gateResults.map((oneEntry) => oneEntry.gate).join(',')}` });
			});
		});
	},
	f_silentRunnerRefused: ({ buildJsMutationList }, done) => {
		runMaterialize(buildLibFor(buildJsMutationList), (runnerArguments, callback) => callback(''), ({ materializeError, gateResults }) => {
			const pass = /materialize failed: the fidelity gate runner succeeded without reporting which success/.test(String(materializeError));
			done({ pass, detail: materializeError || `materialized; finish handed ${JSON.stringify(gateResults)}` });
		});
	},
	g_unknownVerdictRefusedByFinisher: ({ finisherMutationList }, done) => {
		finisherFor(finisherMutationList).emit({ gateResults: [{ gate: 'fidelity', verdict: 'passish', detail: 'a typo' }] }, (emitError) => {
			const pass = /build-attestation-finisher REFUSED: gate 'fidelity' verdict "passish" is not one of pass, fail, notRun, passWithAllowedLoss/.test(String(emitError));
			done({ pass, detail: emitError || 'recorded a verdict outside the vocabulary' });
		});
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_skippedIsNotRun', twinName: 'skipCallsBackWithNothing', target: 'buildJs', find: "callback('', judgmentLib.skippedAttestation({ standardTokens }));", replace: "callback('');" },
	{ conjunctRefId: 'b_genuinePassIsPass', twinName: 'everyPassAllowedLoss', target: 'judgment', find: 'const lossWasAllowed = headline.lost > 0;', replace: 'const lossWasAllowed = true;' },
	{ conjunctRefId: 'c_allowedLossIsPassWithAllowedLoss', twinName: 'derivedPlainPass', target: 'judgment', find: 'const lossWasAllowed = headline.lost > 0;', replace: 'const lossWasAllowed = false;' },
	{ conjunctRefId: 'd_allowanceNotNeededIsPass', twinName: 'allowanceRuleNotLossRule', target: 'judgment', find: 'const lossWasAllowed = headline.lost > 0;', replace: 'const lossWasAllowed = allowance > 0;' },
	{ conjunctRefId: 'e_runnerRowReachesTheGraph', twinName: 'tailDropsFidelityRow', target: 'buildJs', find: 'gateResults: [fidelityAttestation, roundTripRow],', replace: 'gateResults: [roundTripRow],' },
	{ conjunctRefId: 'f_silentRunnerRefused', twinName: 'tailRefusalRemoved', target: 'buildJs', find: '\t\t\t\t\tif (fidelityAttestationFault) {', replace: '\t\t\t\t\tif (false) {' },
	{ conjunctRefId: 'g_unknownVerdictRefusedByFinisher', twinName: 'finisherVocabularyCheckRemoved', target: 'finisher', find: '\t\t\tif (unknownVerdictList.length) {', replace: '\t\t\tif (false) {' },
];
const TARGET_PATH_BY_NAME = { buildJs: BUILD_JS_PATH, judgment: JUDGMENT_PATH, finisher: FINISHER_PATH };
const mutationListsFor = (oneTwin) => {
	const mutation = oneTwin ? [{ modulePath: TARGET_PATH_BY_NAME[oneTwin.target], find: oneTwin.find, replace: oneTwin.replace }] : [];
	return {
		buildJsMutationList: oneTwin && oneTwin.target === 'buildJs' ? mutation : [],
		judgmentMutationList: oneTwin && oneTwin.target === 'judgment' ? mutation : [],
		finisherMutationList: oneTwin && oneTwin.target === 'finisher' ? mutation : [],
	};
};

const refIdList = Object.keys(conjunctJudgeByRefId);
harness.section('BASELINE — the real runner, judgment, tail and finisher pass every conjunct');
let baselineIndex = 0;
const nextBaseline = () => {
	if (baselineIndex >= refIdList.length) {
		runTwins();
		return;
	}
	const refId = refIdList[baselineIndex];
	baselineIndex += 1;
	conjunctJudgeByRefId[refId](mutationListsFor(null), (verdict) => {
		harness.ok(`${refId} PASS`, verdict.pass, verdict.detail);
		nextBaseline();
	});
};
const runTwins = () => {
	harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a module double (in memory)');
	harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), refIdList.slice().sort().join(','));
	let twinIndex = 0;
	const nextTwin = () => {
		if (twinIndex >= TWIN_LIST.length) {
			harness.report();
			return;
		}
		const oneTwin = TWIN_LIST[twinIndex];
		twinIndex += 1;
		moduleDouble.assertMutationApplies({ modulePath: TARGET_PATH_BY_NAME[oneTwin.target], find: oneTwin.find });
		conjunctJudgeByRefId[oneTwin.conjunctRefId](mutationListsFor(oneTwin), (verdict) => {
			harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
			harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
			nextTwin();
		});
	};
	nextTwin();
};
nextBaseline();
