#!/usr/bin/env node
'use strict';

// test-judgeCacheOnly.js — gate for --judgeCacheOnly (lane REFORGE, forgeClean R3/R4, 2026-10-08; approved by VIOLET_VALLEY):
// a -build that may answer judgments ONLY from the judgment cache. A cache MISS is refused BY NAME instead of being asked of
// the live judge, so a rebuild meant to cost nothing cannot quietly spend. Provider-neutral: the guard wraps whatever judge
// the registry constructed, and judgeComponent asks rerank only on a miss (a hit is served without it).
//
// PROVES:
//   (a) the flag reads like --vectorize: documented default false; 'true' / 'false' only ('yes' refused by name);
//       deps.judgeCacheOnly wins over the command line; a non-boolean deps value is refused
//   (b) --judgeCacheOnly=true with NO active --rebridge scope is refused (nothing would be judged; the guard would idle),
//       and so is --judgeCacheOnly=true with --useDebugJudge (the debug judge never reads the cache)
//   (c) resolveInferenceConfig hands the framework a WRAPPED client: model and decisionAlgorithm unchanged, rerank refuses
//       naming the miss, and the real client's rerank is NEVER called
//   (d) through judgeComponent.judgeOne: a cache HIT is served under the guard; a MISS fails the judgment by name
// RED TWINS (in memory, a build.js double): defaultOn -> (a); idleGuardAdmitted, debugComboAdmitted -> (b);
// missAskedLive -> (c), (d); guardNeverApplied -> (c).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: graphBuilder -build --judgeCacheOnly (a cache miss refuses by name)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const judgeComponentLib = require('../../../lib/bridge-framework/judgeComponent');

const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const buildFor = (mutationList) => (mutationList.length === 0 ? require(BUILD_JS_PATH) : loadBuildJsDouble({ buildJsPath: BUILD_JS_PATH, mutationList }));
const commandLineWith = (valueByName) => ({ values: Object.keys(valueByName).reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: [valueByName[oneName]] }), {}), switches: {} });

// a spy judge: counts every live ask, so "never called" is measured, not assumed
const makeSpyClient = () => {
	const spy = { liveCallCount: 0 };
	spy.client = Object.freeze({ model: 'spy:judge-1', decisionAlgorithm: null, rerank: (rerankRequest, rerankCallback) => { spy.liveCallCount += 1; rerankCallback('', { choice: 'NONE', category: undefined, rationale: 'the spy abstains', attempts: 1, model: 'spy:judge-1' }); } });
	return spy;
};
const QUESTION = Object.freeze({ renderedPoolStableIdList: ['card:A', 'card:B'], choiceEnum: ['1', '2', 'NONE'], promptHash: 'a'.repeat(64), rendererVersion: 'toyRenderer-v1', judgePredicateRule: 'categoryTable-v1', systemPrompt: 'system', userPrompt: 'which card?' });
const cacheWith = (storedJudgment) => ({ getJudgment: (cacheRefId, getCallback) => getCallback('', storedJudgment === null ? null : { judgment: storedJudgment }), putJudgment: (putArgs, putCallback) => putCallback('', { alreadyPresent: false }) });
const FORENSICS = { appendRecord: (recordArgs, appendCallback) => appendCallback('') };
const judgeOneWith = ({ judgeClient, judgmentCache }, callback) =>
	judgeComponentLib.judgeOne({ question: QUESTION, judgeClient, judgmentCache, matchForensics: FORENSICS, budget: { maxJudgmentCount: 10, judgmentCountSoFar: 0 }, pairKey: 'toy::pair', generation: 'g1', debugMark: null, reaskPromptRefusalFor: () => '', judgeConfigCacheDigest: null }, callback);
const wrappedClientFor = (build, spy, callback) => build.resolveInferenceConfig({ inferenceConfig: { llmClient: spy.client }, judgeCacheOnly: true }, 'all', null, (resolveError, inferenceConfig) => callback(resolveError, inferenceConfig && inferenceConfig.llmClient));

const conjunctJudgeByRefId = {
	a_flagReadsLikeVectorize: (mutationList, done) => {
		const build = buildFor(mutationList);
		const absent = build.resolveJudgeCacheOnly({}, commandLineWith({}));
		const given = build.resolveJudgeCacheOnly({}, commandLineWith({ judgeCacheOnly: 'true' }));
		const misspelt = build.resolveJudgeCacheOnly({}, commandLineWith({ judgeCacheOnly: 'yes' }));
		const injected = build.resolveJudgeCacheOnly({ judgeCacheOnly: false }, commandLineWith({ judgeCacheOnly: 'true' }));
		const badInjection = build.resolveJudgeCacheOnly({ judgeCacheOnly: 'true' }, commandLineWith({}));
		done({ pass: absent.value === false && given.value === true && /--judgeCacheOnly='yes' is not a recognized value/.test(misspelt.error) && injected.value === false && /deps\.judgeCacheOnly must be a boolean/.test(badInjection.error), detail: JSON.stringify({ absent, given, misspelt: misspelt.error, injected, badInjection: badInjection.error }).slice(0, 400) });
	},
	b_idleAndDebugCombinationsRefused: (mutationList, done) => {
		const build = buildFor(mutationList);
		const spy = makeSpyClient();
		build.resolveInferenceConfig({ inferenceConfig: { llmClient: spy.client }, judgeCacheOnly: true }, [], null, (idleError) =>
			build.resolveInferenceConfig({ judgeCacheOnly: true }, 'all', 'digest', (debugError) =>
				build.resolveInferenceConfig({ inferenceConfig: { llmClient: spy.client }, judgeCacheOnly: false }, [], null, (offError) =>
					done({ pass: /--judgeCacheOnly=true was given but no --rebridge scope is active/.test(idleError) && /--judgeCacheOnly=true was given with --useDebugJudge='digest'/.test(debugError) && !offError, detail: `idle: ${idleError || 'ACCEPTED'} | debug: ${debugError || 'ACCEPTED'} | off: ${offError || 'accepted'}` }))));
	},
	c_frameworkGetsTheWrappedClient: (mutationList, done) => {
		const spy = makeSpyClient();
		wrappedClientFor(buildFor(mutationList), spy, (resolveError, wrappedClient) => {
			if (resolveError || !wrappedClient) {
				done({ pass: false, detail: `resolve: ${resolveError}` });
				return;
			}
			wrappedClient.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'] }, (rerankError) =>
				done({ pass: /JUDGE CACHE MISS under --judgeCacheOnly=true/.test(rerankError) && /spy:judge-1 would have been asked live/.test(rerankError) && spy.liveCallCount === 0 && wrappedClient.model === 'spy:judge-1' && wrappedClient.decisionAlgorithm === null, detail: `rerank: ${rerankError || 'ANSWERED'}; live calls ${spy.liveCallCount}; model ${wrappedClient.model}` }));
		});
	},
	d_hitServedMissRefusedThroughJudgeOne: (mutationList, done) => {
		const spy = makeSpyClient();
		wrappedClientFor(buildFor(mutationList), spy, (resolveError, wrappedClient) => {
			if (resolveError || !wrappedClient) {
				done({ pass: false, detail: `resolve: ${resolveError}` });
				return;
			}
			judgeOneWith({ judgeClient: wrappedClient, judgmentCache: cacheWith({ choice: 'NONE', chosenStableId: null, category: null, rationale: 'none of the cards means the same thing' }) }, (hitError, hitJudgment) =>
				judgeOneWith({ judgeClient: wrappedClient, judgmentCache: cacheWith(null) }, (missError) =>
					done({ pass: !hitError && hitJudgment.cacheHit === true && /JUDGE CACHE MISS under --judgeCacheOnly=true/.test(missError) && spy.liveCallCount === 0, detail: `hit: ${hitError || `served (cacheHit ${hitJudgment.cacheHit})`} | miss: ${missError || 'ANSWERED'} | live calls ${spy.liveCallCount}` })));
		});
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_flagReadsLikeVectorize', twinName: 'defaultOn', find: "whatItControls: 'whether a judgment-cache MISS is refused by name instead of asked of the live judge (a zero-spend rebridge)',\n\t\tdefaultValue: false,", replace: "whatItControls: 'whether a judgment-cache MISS is refused by name instead of asked of the live judge (a zero-spend rebridge)',\n\t\tdefaultValue: true," },
	{ conjunctRefId: 'b_idleAndDebugCombinationsRefused', twinName: 'idleGuardAdmitted', find: '	if (!rebridgeScopeIsActive(rebridgeScope)) {\n		return `graphBuilder build: --judgeCacheOnly=true', replace: '	if (false) {\n		return `graphBuilder build: --judgeCacheOnly=true' },
	{ conjunctRefId: 'b_idleAndDebugCombinationsRefused', twinName: 'debugComboAdmitted', find: '	if (debugJudgeRule) {\n		return `graphBuilder build: --judgeCacheOnly=true', replace: '	if (false) {\n		return `graphBuilder build: --judgeCacheOnly=true' },
	{ conjunctRefId: 'c_frameworkGetsTheWrappedClient', twinName: 'missAskedLive', find: '		rerank: (rerankRequest, rerankCallback) =>\n			rerankCallback(', replace: '		rerank: (rerankRequest, rerankCallback) => judgeClient.rerank(rerankRequest, rerankCallback) || (() => rerankCallback)(' },
	{ conjunctRefId: 'd_hitServedMissRefusedThroughJudgeOne', twinName: 'missAskedLive', find: '		rerank: (rerankRequest, rerankCallback) =>\n			rerankCallback(', replace: '		rerank: (rerankRequest, rerankCallback) => judgeClient.rerank(rerankRequest, rerankCallback) || (() => rerankCallback)(' },
	{ conjunctRefId: 'c_frameworkGetsTheWrappedClient', twinName: 'guardNeverApplied', find: '	const guarded = (inferenceConfig) => (judgeCacheOnlyResolution.value ? { ...inferenceConfig, llmClient: cacheOnlyJudgeClientFor(inferenceConfig.llmClient) } : inferenceConfig);', replace: '	const guarded = (inferenceConfig) => inferenceConfig;' },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real build.js passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a build.js double (in memory)');
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
