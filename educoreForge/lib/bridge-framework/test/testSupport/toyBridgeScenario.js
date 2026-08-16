'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// toyBridgeScenario.js — TEST SUPPORT: the SUBJECT every Bridge Framework unit gate evaluates and every twin
// mutates (mirrors lib/forge-framework/test/testSupport/toyScenario.js). A scenario is DATA describing ONE
// bridgeFramework.run over the toy fixture:
//   frameworkMutationList   textual mutations to framework files (productionMutation twins; moduleDouble)
//   registryMode            'fixture' (both toy plugins from the fixture forges dir) — twins swap plugin files / entries
//   pluginModuleOverrides   { bridgeName: { bridgeDeclaration?, bridgeHooks? } } laid over the fixture plugin (inputFault twins)
//   graph                   { nodeList, edgeList } for graphDouble (twins drop a card, strip an embedding, …)
//   spec                    the run's spec (inGraph, bridge, source, hub, applyLabel, rebridge, config, …)
//   deps                    the framework factory deps beyond reader/writer/registry (xLog, judgeBudgetOverride, …)
//   judgeRule               the debug judge rule ('digest' default; 'abstain' once per suite; a client double)
//   stores                  in-memory doubles for decisionStore / judgmentCache / matchForensics — the same API as
//                           lib/decision-store, lib/judgment-cache, lib/match-forensics; a store persists ACROSS runs
//                           of one scenario (materialise after re-judge) unless reset
// runScenario(scenario, cb) → { runError?, runReport?, graphDouble, stores, framework }  — a refusal is a RESULT

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const moduleDouble = require(path.join(__dirname, '..', '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const FRAMEWORK_DIR = path.resolve(__dirname, '..', '..');
const FRAMEWORK_MODULE_PATH = path.join(FRAMEWORK_DIR, 'bridge-framework.js');
const FIXTURE_DIR = path.join(FRAMEWORK_DIR, 'test', 'fixtures', 'toyBridge');
const FIXTURE_FORGES_DIR = path.join(FIXTURE_DIR, 'forges');
const TOY_BUNDLE_DIR = path.join(FIXTURE_FORGES_DIR, 'toy');
const TOY_SNAPSHOT_DIR = path.join(TOY_BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const BRIDGE_MAKER_LIB_DIR = path.join(FRAMEWORK_DIR, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');
const toyGraphLib = require(path.join(FIXTURE_DIR, 'toyGraph'));
const graphDoubleLib = require(path.join(FRAMEWORK_DIR, 'graphDouble'));
const pluginRegistryLib = require(path.join(FRAMEWORK_DIR, 'pluginRegistry'));
const contentAddress = require(path.join(FRAMEWORK_DIR, '..', 'content-address', 'content-address'))();
const debugJudgeLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'debugJudge'));

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------
// store doubles — the SAME API and the SAME refusals as the tree libs, in memory (scratch to os.tmpdir() where a file is needed)
// ---------------------------------------------------------------------
const makeDecisionStoreDouble = () => {
	const rowList = [];
	return {
		rowList,
		getDecisionBlock: ({ pairKey } = {}, callback) => {
			if (typeof pairKey !== 'string' || pairKey.trim() === '') {
				callback('decisionStore.getDecisionBlock: pairKey is required and must be a non-empty string');
				return;
			}
			const matching = rowList.filter((oneRow) => oneRow.pairKey === pairKey);
			if (!matching.length) {
				callback('', { frozenText: null });
				return;
			}
			const row = matching[matching.length - 1];
			const recomputed = contentAddress.blockIdForText(row.frozenText);
			if (recomputed !== row.decisionBlockHash) {
				callback(`decisionStore.getDecisionBlock: content-address verification FAILED for '${pairKey}'`);
				return;
			}
			callback('', { frozenText: row.frozenText, decisionBlockHash: row.decisionBlockHash, pairKey });
		},
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash } = {}, callback) => {
			if (typeof pairKey !== 'string' || pairKey.trim() === '' || typeof frozenText !== 'string' || frozenText.length === 0) {
				callback('decisionStore.saveDecisionBlock: pairKey and frozenText are required');
				return;
			}
			const refId = contentAddress.blockIdForText(frozenText);
			if (decisionBlockHash != null && `${decisionBlockHash}` !== refId) {
				callback(`decisionStore.saveDecisionBlock: the caller's decisionBlockHash '${decisionBlockHash}' does not match the sha256 of the frozen text (${refId})`);
				return;
			}
			if (rowList.some((oneRow) => oneRow.decisionBlockHash === refId)) {
				callback('', { decisionBlockHash: refId, pairKey, alreadyPresent: true, saved: false });
				return;
			}
			rowList.push({ pairKey, frozenText, decisionBlockHash: refId, seq: rowList.length + 1 });
			callback('', { decisionBlockHash: refId, pairKey, alreadyPresent: false, saved: true });
		},
	};
};

const makeJudgmentCacheDouble = () => {
	const rowByRefId = {};
	const refIdFor = ({ promptHash, model, rendererVersion }) => `${promptHash}|${model}|${rendererVersion}`;
	const cache = {
		rowByRefId,
		getCallCount: 0,
		putCallCount: 0,
		rowCount: () => Object.keys(rowByRefId).length,
		getJudgment: ({ promptHash, model, rendererVersion } = {}, callback) => {
			cache.getCallCount += 1;
			if (typeof promptHash !== 'string' || typeof model !== 'string' || typeof rendererVersion !== 'string') {
				callback('judgmentCache.getJudgment: promptHash, model, rendererVersion are required strings');
				return;
			}
			const row = rowByRefId[refIdFor({ promptHash, model, rendererVersion })];
			callback('', row === undefined ? { judgment: null } : { judgment: cloneJson(row.judgment), generation: row.generation, createdAt: null });
		},
		putJudgment: ({ promptHash, model, rendererVersion, generation, judgment } = {}, callback) => {
			cache.putCallCount += 1;
			if (typeof promptHash !== 'string' || typeof model !== 'string' || typeof rendererVersion !== 'string') {
				callback('judgmentCache.putJudgment: promptHash, model, rendererVersion are required strings');
				return;
			}
			if (!judgment || typeof judgment !== 'object' || typeof judgment.choice !== 'string' || judgment.choice.trim() === '' || typeof judgment.category !== 'string' || judgment.category.trim() === '' || typeof judgment.rationale !== 'string' || judgment.rationale.trim() === '' || judgment.chosenStableId === undefined) {
				callback('judgmentCache.putJudgment: judgment needs choice, category, rationale (non-empty strings) and chosenStableId (null allowed)');
				return;
			}
			const refId = refIdFor({ promptHash, model, rendererVersion });
			if (rowByRefId[refId] === undefined) {
				rowByRefId[refId] = { promptHash, model, rendererVersion, generation: generation == null ? null : generation, judgment: cloneJson(judgment) };
			}
			callback('', { stored: true });
		},
	};
	return cache;
};

const makeMatchForensicsDouble = ({ baseDirPath }) => {
	const recordList = [];
	return {
		baseDirPath,
		recordList,
		appendRecord: ({ pairKey, generation, record } = {}, callback) => {
			if (typeof pairKey !== 'string' || pairKey.trim() === '' || typeof generation !== 'string' || generation.trim() === '' || !record || typeof record !== 'object' || Array.isArray(record)) {
				callback('matchForensics.appendRecord: pairKey, generation and a record object are required');
				return;
			}
			recordList.push({ pairKey, generation, record: cloneJson(record) });
			callback('', { filePath: path.join(baseDirPath, pairKey, `${generation}.jsonl`) });
		},
	};
};

const makeStores = () => ({
	decisionStore: makeDecisionStoreDouble(),
	judgmentCache: makeJudgmentCacheDouble(),
	matchForensics: makeMatchForensicsDouble({ baseDirPath: fs.mkdtempSync(path.join(os.tmpdir(), 'toyBridgeForensics-')) }),
});

// ---------------------------------------------------------------------
// the scenario
// ---------------------------------------------------------------------
const makeSpec = ({ bridge, rebridge } = {}) => ({
	inGraph: { graphName: 'DEV_toyBridgeDouble' },
	bridge: bridge === undefined ? 'toyCrosswalkPlugin' : bridge,
	source: 'toy',
	hub: 'toyhub',
	applyLabel: 'BridgedRelation',
	rebridge: rebridge === undefined ? true : rebridge,
	config: {
		limit: undefined,
		offset: undefined,
		sourceStandard: 'toy',
		sourceStandardName: toyGraphLib.SOURCE_STANDARD_NAME,
		sourceVersion: toyGraphLib.SOURCE_VERSION,
		hubVersion: toyGraphLib.HUB_VERSION,
		pairWith: undefined,
		pairWithVersion: undefined,
		familyStandards: ['toy'],
	},
});

const makeScenario = () => ({
	frameworkMutationList: [],
	registryMode: 'fixture',
	registryPluginFileOverrideList: [],
	pluginModuleOverrides: {},
	graph: toyGraphLib.toyGraph(),
	spec: makeSpec(),
	deps: {},
	judgeRule: 'digest',
	judgeClientOverride: null,
	stores: makeStores(),
	conflictDetectorOverride: null,
});

const cloneScenario = (scenario) => ({
	frameworkMutationList: scenario.frameworkMutationList.slice(),
	registryMode: scenario.registryMode,
	registryPluginFileOverrideList: scenario.registryPluginFileOverrideList.slice(),
	pluginModuleOverrides: Object.keys(scenario.pluginModuleOverrides).reduce((soFar, oneName) => ({ ...soFar, [oneName]: { ...scenario.pluginModuleOverrides[oneName] } }), {}),
	graph: cloneJson(scenario.graph),
	spec: cloneJson(scenario.spec),
	deps: { ...scenario.deps },
	judgeRule: scenario.judgeRule,
	judgeClientOverride: scenario.judgeClientOverride,
	stores: scenario.stores, // stores are SHARED across the clones of one scenario on purpose (materialise after re-judge)
	conflictDetectorOverride: scenario.conflictDetectorOverride,
});

// makeScratchBundleCopy — a scratch copy of the toy bundle in a temp dir (never inside the tree) → its path
const makeScratchForgesCopy = () => {
	const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toyBridgeScratch-'));
	const copyDir = (fromDir, toDir) => {
		fs.mkdirSync(toDir, { recursive: true });
		fs.readdirSync(fromDir, { withFileTypes: true }).forEach((oneEntry) => {
			const fromPath = path.join(fromDir, oneEntry.name);
			const toPath = path.join(toDir, oneEntry.name);
			if (oneEntry.isDirectory()) {
				copyDir(fromPath, toPath);
			} else {
				fs.copyFileSync(fromPath, toPath);
			}
		});
	};
	copyDir(FIXTURE_FORGES_DIR, path.join(scratchRoot, 'forges'));
	return path.join(scratchRoot, 'forges');
};

const loadFrameworkFactory = (scenario) =>
	scenario.frameworkMutationList.length
		? moduleDouble.loadWithMutations({ modulePath: FRAMEWORK_MODULE_PATH, mutationList: scenario.frameworkMutationList })
		: require(FRAMEWORK_MODULE_PATH);

// buildRegistry — the fixture registry: discovery over the (possibly scratch-copied) fixture forges dir, with
// plugin module overrides laid over the loaded module BEFORE registration (inputFault twins edit a declaration)
const buildRegistry = (scenario) => {
	const forgesDirPath = scenario.forgesDirOverride === undefined || scenario.forgesDirOverride === null ? FIXTURE_FORGES_DIR : scenario.forgesDirOverride;
	const requireModule = (oneFilePath) => {
		const loaded = require(oneFilePath);
		const overrideByName = scenario.pluginModuleOverrides;
		const bridgeName = loaded && loaded.bridgeDeclaration ? loaded.bridgeDeclaration.bridgeName : undefined;
		if (bridgeName !== undefined && overrideByName[bridgeName] !== undefined) {
			const override = overrideByName[bridgeName];
			return {
				bridgeDeclaration: override.bridgeDeclaration === undefined ? loaded.bridgeDeclaration : override.bridgeDeclaration,
				bridgeHooks: override.bridgeHooks === undefined ? loaded.bridgeHooks : override.bridgeHooks,
			};
		}
		return loaded;
	};
	return pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath, requireModule });
};

const makeJudgeClient = (scenario) => {
	if (scenario.judgeClientOverride !== null && scenario.judgeClientOverride !== undefined) {
		return scenario.judgeClientOverride;
	}
	return debugJudgeLib({ ruleName: scenario.judgeRule });
};

// runScenario — build registry + double + framework; run; every outcome is a value
const runScenario = (scenario, callback) => {
	let registry;
	let framework;
	let graphDouble;
	const buildEverything = () => {
		registry = buildRegistry(scenario);
		graphDouble = graphDoubleLib.graphDoubleFrom(scenario.graph);
		const factoryDeps = {
			graphReaderFactory: scenario.graphReaderFactoryOverride === undefined ? graphDouble.graphReaderFactory : scenario.graphReaderFactoryOverride(graphDouble),
			graphWriterFactory: scenario.graphWriterFactoryOverride === undefined ? graphDouble.graphWriterFactory : scenario.graphWriterFactoryOverride(graphDouble),
			pluginRegistry: registry,
			...scenario.deps,
		};
		if (scenario.conflictDetectorOverride !== null && scenario.conflictDetectorOverride !== undefined) {
			factoryDeps.conflictDetector = scenario.conflictDetectorOverride;
		}
		framework = loadFrameworkFactory(scenario)(factoryDeps);
	};
	// the test's OBSERVATION instrument (tests are outside the DOCTRINE's non-test rule): a construction refusal is a RESULT
	try {
		buildEverything();
	} catch (constructionThrow) {
		if (String(constructionThrow.message).startsWith(moduleDouble.MUTATION_REFUSAL_TAG)) {
			throw constructionThrow; // FA1: a fault that could not be applied is NOT a framework refusal
		}
		callback('', { constructionError: constructionThrow.message });
		return;
	}
	const spec = { ...scenario.spec, decisionStore: scenario.stores.decisionStore, judgmentCache: scenario.stores.judgmentCache, matchForensics: scenario.stores.matchForensics };
	if (scenario.spec.rebridge) {
		spec.inferenceConfig = { llmClient: makeJudgeClient(scenario) };
	}
	if (scenario.specInferenceConfigOverride !== undefined) {
		spec.inferenceConfig = scenario.specInferenceConfigOverride;
	}
	let calledBack = false;
	try {
		framework.run(spec, (runError, runReport) => {
			calledBack = true;
			callback('', { runError, runReport, graphDouble, stores: scenario.stores, framework, registry });
		});
	} catch (runThrow) {
		if (!calledBack) {
			callback('', { thrownFromRun: runThrow.message, graphDouble, stores: scenario.stores, framework, registry });
		}
	}
};

// runTwice — a re-judge followed by a plain materialise on the SAME stores (the replay protocol's steps 1+2)
const runRejudgeThenMaterialise = (scenario, callback) => {
	runScenario(scenario, (unusedError, first) => {
		if (first.runError || first.constructionError || first.thrownFromRun) {
			callback('', { first });
			return;
		}
		const second = cloneScenario(scenario);
		second.spec.rebridge = false;
		second.graph = cloneJson(scenario.graph); // a FRESH dependency graph, as build.js gives every pairing
		runScenario(second, (unusedSecondError, secondOutcome) => callback('', { first, second: secondOutcome }));
	});
};

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

module.exports = {
	FRAMEWORK_DIR,
	FRAMEWORK_MODULE_PATH,
	FIXTURE_DIR,
	FIXTURE_FORGES_DIR,
	TOY_BUNDLE_DIR,
	TOY_SNAPSHOT_DIR,
	toyGraphLib,
	makeSpec,
	makeScenario,
	cloneScenario,
	makeStores,
	makeDecisionStoreDouble,
	makeJudgmentCacheDouble,
	makeMatchForensicsDouble,
	makeScratchForgesCopy,
	buildRegistry,
	makeJudgeClient,
	loadFrameworkFactory,
	runScenario,
	runRejudgeThenMaterialise,
	cloneJson,
	sha256Hex,
	moduleName,
};
