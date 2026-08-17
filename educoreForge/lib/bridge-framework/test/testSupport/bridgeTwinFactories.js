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

// deliverVerdict — the ONE place a judge's verdict reaches the evaluator. A verdict flagged offTarget is
// delivered as an evaluate ERROR, which gateEvaluator turns into UNMEASURED rather than FAIL. Consequences,
// both intended: at BASELINE an off-target conjunct is UNMEASURED, which the suite already treats as a
// failure ("a conjunct that cannot be evaluated is UNMEASURED, a failure, never a skip"); UNDER A TWIN it
// stops counting as an observation, so the conjunct lands in the UNPROVEN set and the family goes red
// instead of printing a note nobody acts on. gateEvaluator.js is in lib/forge-framework/, whose diff is
// pinned to exactly one test file by BG-SEAM-UNTOUCHED (iii), so this is done entirely from the bridge side.
const deliverVerdict = (callback, verdict) => {
	// ⟪HELD, PENDING A RULING — GRANITE_VALLEY 2026-08-17⟫ This deliverer was written to convert an offTarget
	// verdict into an evaluate ERROR (hence UNMEASURED, hence "not observed red"), which is what RULING item 3
	// asks for. MEASURED CONSEQUENCE: 13 of BG-DECL's 38 conjuncts have twins that go red by CRASHING rather
	// than by any gate firing, and the conversion turns every one of them into a DEFECTIVE conjunct.
	// DEFECTIVE has NO named-exception list (gateSuiteRunner asserts defectiveCount === 0 outright), unlike
	// UNPROVEN which does; and moving them from DEFECTIVE to UNPROVEN means editing gateEvaluator.js in
	// lib/forge-framework/, whose diff BG-SEAM-UNTOUCHED (iii) pins to exactly one test file.
	// So the conversion is HELD and the verdict is delivered normally. The offTarget flag is still computed and
	// still names itself in the detail line, so the 13 are legible in the output today. See the DEVLOG.
	callback('', verdict);
};

const runConjunct = ({ conjunctId, title, twinNameList, judge, shape }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		if (shape) {
			shape(scenario);
		}
		scenarioLib.runScenario(scenario, (unusedError, outcome) => {
			deliverVerdict(callback, judge(outcome, scenario));
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
			deliverVerdict(callback, judge(outcome, scenario));
		});
	},
});

const pureConjunct = ({ conjunctId, title, twinNameList, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		deliverVerdict(callback, judge(scenario));
	},
});

const refusalTextOf = (outcome) => outcome.constructionError || outcome.runError || outcome.thrownFromRun || '';

const nameInRefusal = (regex) => (outcome) => {
	const refusalText = refusalTextOf(outcome);
	if (!refusalText) {
		return { pass: false, detail: 'expected a refusal but the run SUCCEEDED' };
	}
	if (regex.test(refusalText)) {
		return { pass: true, detail: refusalText.slice(0, 220) };
	}
	// The conjunct's own message did not appear. Two very different things wear that face, and only one of
	// them is a defect (RULING SABLE_RIVER 2026-08-17 item 3):
	//
	//   ANOTHER REFUSAL BY NAME fired instead. Legitimate red. The twin removed this conjunct's refusal and
	//   the system still refused, by name, somewhere else — the assertion "this message appears" is genuinely
	//   violated and the observation is real. These stay FAIL.
	//
	//   THE MUTATED CODE CRASHED — a TypeError, not a refusal ("Cannot read properties of undefined ..."). The
	//   gate was never reached at all, so nothing about it was observed; calling that "observed red" is a gate
	//   proven by an accident. These become OFF TARGET, which deliverVerdict turns into UNMEASURED.
	//
	// The discriminator is refuse.byName's own signature, ' REFUSED:', which every by-name refusal in this
	// codebase carries and no thrown TypeError does.
	const isRefusalByName = refusalText.indexOf(' REFUSED:') !== -1;
	return isRefusalByName
		? { pass: false, detail: `refused for the WRONG reason — no match for ${regex}: ${refusalText.slice(0, 320)}` }
		: { pass: false, offTarget: true, detail: `NOT A REFUSAL — the mutated code threw before any gate was reached, so nothing was observed: ${refusalText.slice(0, 320)}` };
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
