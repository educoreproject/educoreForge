'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// twinFactories.js — TEST SUPPORT: the small vocabulary every gate family writes its twins in, so a
// twin is ONE registry row of DATA plus a mutation, never a bespoke harness.
//
//   frameworkMutationTwin  a productionMutation applied to the framework's own source (moduleDouble)
//   scenarioTwin           any mutation of the scenario (declaration/hooks/args = inputFault; a fixture
//                          hook or a test double = productionMutation — the caller says which)
//   forgeConjunct          a conjunct whose evaluate runs the scenario and judges the outcome
//   injectConjunct         a conjunct whose evaluate injects only and judges the outcome
//   nameInRefusal          the standard "name in refusal text" judge for a refusal conjunct

const path = require('path');
const toyScenario = require('./toyScenario');

const FRAMEWORK_DIR = toyScenario.FRAMEWORK_DIR;
const frameworkFile = (fileName) => path.join(FRAMEWORK_DIR, fileName);

const frameworkMutationTwin = ({ registry, gateId, conjunctId, twinName, fileName, find, replace, leverKind = 'productionMutation', shippedConfig = true }) =>
	registry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind,
		shippedConfig,
		run: (scenario) => {
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

const forgeConjunct = ({ conjunctId, title, twinNameList, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		toyScenario.runScenario(scenario, (runError, outcome) => {
			callback('', judge(outcome, scenario));
		});
	},
});

const injectConjunct = ({ conjunctId, title, twinNameList, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		callback('', judge(toyScenario.injectOnly(scenario), scenario));
	},
});

// nameInRefusal — the outcome must be a REFUSAL whose text matches the regex (a rejection for the
// wrong reason is a misleading gate — reported as failure)
const nameInRefusal = (regex) => (outcome) => {
	const refusalText = outcome.injectionError || outcome.forgeError || outcome.thrownFromForge || '';
	if (!refusalText) {
		return { pass: false, detail: 'expected a refusal but the run SUCCEEDED' };
	}
	return regex.test(refusalText)
		? { pass: true, detail: refusalText.slice(0, 200) }
		: { pass: false, detail: `refused for the WRONG reason — no match for ${regex}: ${refusalText.slice(0, 300)}` };
};

// succeeded — the outcome must be a clean forge result satisfying `check(result)`
const succeeded = (check) => (outcome) => {
	if (outcome.injectionError || outcome.forgeError || outcome.thrownFromForge) {
		return { pass: false, detail: `expected success but got: ${outcome.injectionError || outcome.forgeError || outcome.thrownFromForge}` };
	}
	return check(outcome.result, outcome);
};

module.exports = { frameworkMutationTwin, scenarioTwin, forgeConjunct, injectConjunct, nameInRefusal, succeeded, frameworkFile, moduleName };

// refusalCase — ONE row that declares a refusal conjunct (shape the input → expect a refusal naming
// the fault) AND registers its twin (by default a productionMutation that disables the check in the
// framework, so the faulted input passes and the gate goes red — the three-state method: before-passes,
// invert-and-watch-red, fix-to-green). Returns the conjunct declaration.
//   mode 'inject' | 'forge' — where the refusal is observed
const refusalCase = ({ registry, gateId, conjunctId, title, mode = 'forge', shape, regex, twinName, fileName, find, replace, leverKind = 'productionMutation', shippedConfig = true, mutate }) => {
	const judge = nameInRefusal(regex);
	const inner = mode === 'inject' ? injectConjunct({ conjunctId, title, twinNameList: [twinName], judge }) : forgeConjunct({ conjunctId, title, twinNameList: [twinName], judge });
	const innerEvaluate = inner.evaluate;
	inner.evaluate = (scenario, callback) => {
		if (shape) {
			shape(scenario);
		}
		innerEvaluate(scenario, callback);
	};
	if (mutate) {
		scenarioTwin({ registry, gateId, conjunctId, twinName, leverKind, shippedConfig, mutate });
	} else {
		frameworkMutationTwin({ registry, gateId, conjunctId, twinName, fileName, find, replace, leverKind, shippedConfig });
	}
	return inner;
};

// shapedConjunct — a success-judged conjunct with per-conjunct input shaping applied on baseline AND twin runs
const shapedConjunct = ({ conjunctId, title, twinNameList, shape, judge, mode = 'forge' }) => {
	const inner = mode === 'inject' ? injectConjunct({ conjunctId, title, twinNameList, judge }) : forgeConjunct({ conjunctId, title, twinNameList, judge });
	const innerEvaluate = inner.evaluate;
	inner.evaluate = (scenario, callback) => {
		if (shape) {
			shape(scenario);
		}
		innerEvaluate(scenario, callback);
	};
	return inner;
};

module.exports.refusalCase = refusalCase;
module.exports.shapedConjunct = shapedConjunct;
