'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridgeTwinFactories.js — TEST SUPPORT: the small vocabulary every bridge gate family writes its twins in
// (mirrors lib/forge-framework/test/testSupport/twinFactories.js), so a twin is ONE registry row of DATA plus a
// mutation, never a bespoke harness.
//
//   frameworkMutationTwin  a productionMutation applied to the framework's OWN source (moduleDouble; the find
//                          must match exactly once — validated EAGERLY so a stale find is UNPROVEN, never a fake red)
//   scenarioTwin           any mutation of the scenario (declaration/hooks/spec/graph = inputFault; a fixture hook or
//                          a test double = productionMutation — the caller says which)
//   runConjunct            evaluate = one framework run over the scenario, judged by judge(outcome, scenario)
//   twiceConjunct          evaluate = re-judge then plain materialise on the same stores, judged over both outcomes
//   pureConjunct           evaluate = a synchronous judge over the scenario (static greps, contract checks)
//   nameInRefusal(regex)   the run must be REFUSED and the refusal must match (a refusal for the wrong reason fails)
//   succeeded(check)       the run must succeed and check(runReport, outcome) must pass
//   refusalCase            one row = a refusal conjunct + its twin (default: a productionMutation disabling the check)

const path = require('path');
const scenarioLib = require('./toyBridgeScenario');
const moduleDouble = require(path.join(__dirname, '..', '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const FRAMEWORK_DIR = scenarioLib.FRAMEWORK_DIR;
const frameworkFile = (fileName) => path.join(FRAMEWORK_DIR, fileName);

const frameworkMutationTwin = ({ registry, gateId, conjunctId, twinName, fileName, find, replace, leverKind = 'productionMutation', shippedConfig = true }) =>
	registry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind,
		shippedConfig,
		run: (scenario) => {
			moduleDouble.assertMutationApplies({ modulePath: frameworkFile(fileName), find });
			scenario.frameworkMutationList.push({ modulePath: frameworkFile(fileName), find, replace });
			return scenario;
		},
	});

const scenarioTwin = ({ registry, gateId, conjunctId, twinName, leverKind, shippedConfig = true, mutate }) =>
	registry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind,
		shippedConfig,
		run: (scenario) => {
			mutate(scenario);
			return scenario;
		},
	});

const runConjunct = ({ conjunctId, title, twinNameList, judge, shape }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		if (shape) {
			shape(scenario);
		}
		scenarioLib.runScenario(scenario, (unusedError, outcome) => {
			callback('', judge(outcome, scenario));
		});
	},
});

const twiceConjunct = ({ conjunctId, title, twinNameList, judge, shape }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		if (shape) {
			shape(scenario);
		}
		scenarioLib.runRejudgeThenMaterialise(scenario, (unusedError, outcome) => {
			callback('', judge(outcome, scenario));
		});
	},
});

const pureConjunct = ({ conjunctId, title, twinNameList, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		callback('', judge(scenario));
	},
});

const refusalTextOf = (outcome) => outcome.constructionError || outcome.runError || outcome.thrownFromRun || '';

const nameInRefusal = (regex) => (outcome) => {
	const refusalText = refusalTextOf(outcome);
	if (!refusalText) {
		return { pass: false, detail: 'expected a refusal but the run SUCCEEDED' };
	}
	return regex.test(refusalText) ? { pass: true, detail: refusalText.slice(0, 220) } : { pass: false, detail: `refused for the WRONG reason — no match for ${regex}: ${refusalText.slice(0, 320)}` };
};

const succeeded = (check) => (outcome, scenario) => {
	const refusalText = refusalTextOf(outcome);
	if (refusalText) {
		return { pass: false, detail: `expected success but got: ${refusalText.slice(0, 320)}` };
	}
	return check(outcome.runReport, outcome, scenario);
};

// refusalCase — a refusal conjunct (shape the input → expect a refusal naming the fault) + its twin registered
const refusalCase = ({ registry, gateId, conjunctId, title, shape, regex, twinName, fileName, find, replace, leverKind = 'productionMutation', shippedConfig = true, mutate, mode = 'run' }) => {
	const judge = nameInRefusal(regex);
	const inner = mode === 'twice' ? twiceConjunct({ conjunctId, title, twinNameList: [twinName], judge: (outcome) => judge(outcome.first.runError || outcome.first.constructionError || outcome.first.thrownFromRun ? outcome.first : outcome.second || {}), shape }) : runConjunct({ conjunctId, title, twinNameList: [twinName], judge, shape });
	if (mutate) {
		scenarioTwin({ registry, gateId, conjunctId, twinName, leverKind, shippedConfig, mutate });
	} else {
		frameworkMutationTwin({ registry, gateId, conjunctId, twinName, fileName, find, replace, leverKind, shippedConfig });
	}
	return inner;
};

// helpers over outcomes
const edgesOf = (outcome) => (outcome && outcome.graphDouble ? outcome.graphDouble.state.writtenEdgeList : []);
const forensicsOf = (outcome) => (outcome && outcome.stores ? outcome.stores.matchForensics.recordList : []);
const blockOf = (outcome) => {
	if (!outcome || !outcome.stores || !outcome.runReport || !outcome.runReport.decisionBlock) {
		return null;
	}
	const row = outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash);
	return row === undefined ? null : JSON.parse(row.frozenText);
};

module.exports = { frameworkMutationTwin, scenarioTwin, runConjunct, twiceConjunct, pureConjunct, nameInRefusal, succeeded, refusalCase, refusalTextOf, edgesOf, forensicsOf, blockOf, frameworkFile, FRAMEWORK_DIR, moduleName };

// loadBuildJsDouble — build.js compiled IN MEMORY with named textual mutations (the same idea as moduleDouble, with a
// CONSTRUCTIBLE require: build.js writes `new require('qtools-asynchronous-pipe-plus')()`, which an arrow-function
// require cannot serve). Only build.js itself is mutated; every require it makes loads for real. Used by BG-DEBUG (d)
// to RE-OBSERVE build.js's --useDebugJudge refusals red under a build.js double, without borrowing test-useDebugJudge.
const loadBuildJsDouble = ({ buildJsPath, mutationList }) => {
	const fs = require('fs');
	const Module = require('module');
	const vm = require('vm');
	let sourceText = fs.readFileSync(buildJsPath, 'utf8');
	mutationList.forEach((oneMutation) => {
		const matchCount = sourceText.split(oneMutation.find).length - 1;
		if (matchCount !== 1) {
			throw new Error(`${moduleDouble.MUTATION_REFUSAL_TAG}: build.js mutation find-text matched ${matchCount} times (must match exactly once): ${JSON.stringify(oneMutation.find).slice(0, 120)}`);
		}
		sourceText = sourceText.replace(oneMutation.find, () => oneMutation.replace);
	});
	const doubleModule = new Module(buildJsPath, module);
	doubleModule.filename = buildJsPath;
	doubleModule.paths = Module._nodeModulePaths(path.dirname(buildJsPath));
	// eslint-disable-next-line prefer-arrow-callback
	function doubleRequire(requestPath) {
		return requestPath.startsWith('.') ? require(path.resolve(path.dirname(buildJsPath), requestPath)) : doubleModule.require(requestPath);
	}
	const compiledWrapper = vm.runInThisContext(Module.wrap(sourceText), { filename: buildJsPath });
	compiledWrapper.call(doubleModule.exports, doubleModule.exports, doubleRequire, doubleModule, buildJsPath, path.dirname(buildJsPath));
	return doubleModule.exports;
};

module.exports.loadBuildJsDouble = loadBuildJsDouble;
