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
const HANG_GUARD_MS = 4000;

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
	stores: makeStores(), // every clone starts with FRESH stores; runRejudgeThenMaterialise carries them across its two runs explicitly
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
	// the registry is built through the SAME framework double as the run, so a mutation in bridgePluginContract.js
	// (a disabled registration check) reaches registration too
	const registryLib = scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(FRAMEWORK_DIR, 'pluginRegistry.js'), mutationList: scenario.frameworkMutationList }) : pluginRegistryLib;
	return registryLib.buildRegistryFromDirectory({ forgesDirPath, requireModule });
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
		// the graph double is compiled through the SAME framework double when mutations exist, so a mutation in
		// graphSeamRules.js (a disabled write-seam rule) or graphDouble.js reaches the reader/writer double too
		const graphDoubleLibForRun = scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(FRAMEWORK_DIR, 'graphDouble.js'), mutationList: scenario.frameworkMutationList }) : graphDoubleLib;
		graphDouble = graphDoubleLibForRun.graphDoubleFrom(scenario.graph);
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
	// a run that NEVER calls back (an arity-1 hook under a disabled check, a swallowed callback) is an outcome too:
	// the hang guard reports it as { hungForMs } so a gate can go red instead of the whole suite going silent
	const hangGuard = setTimeout(() => {
		if (!calledBack) {
			calledBack = true;
			callback('', { hungForMs: HANG_GUARD_MS, runError: `${moduleName}: the run never called back within ${HANG_GUARD_MS}ms (HUNG)`, graphDouble, stores: scenario.stores, framework, registry });
		}
	}, HANG_GUARD_MS);
	try {
		framework.run(spec, (runError, runReport) => {
			if (calledBack) {
				return;
			}
			calledBack = true;
			clearTimeout(hangGuard);
			callback('', { runError, runReport, graphDouble, stores: scenario.stores, framework, registry });
		});
	} catch (runThrow) {
		if (!calledBack) {
			calledBack = true;
			clearTimeout(hangGuard);
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
		second.stores = scenario.stores; // the SAME stores (the replay protocol's "same store")
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

// makeFakeRealClient — a REAL-client double (NOT the debug judge): answers rerank with a fixed ordinal (or a per-call
// list), a picking category and a rationale that names the choice by hub key + name (parsed from the rendered
// prompt), counting its calls; it PARTICIPATES in the judgment cache like the real client. Options:
//   pickOrdinal   '1' (default) | 'NONE' | a function (question) → choice
//   category      'strong' (default)
//   rationaleMode 'keyAndName' (default) | 'ordinal' (the BR-067 fault) | 'ordinalThenKeyAndName' (ordinal on the FIRST call for a prompt, key+name on the re-ask) | 'blank'
//                 | 'keyAndNameWithRejectedOrdinal' — names the PICK by hub key + name AND refers to a
//                   DIFFERENT candidate by number while ruling it out. Lawful under RULING 14:10 and the
//                   shape that killed D3 batch 2 when BR-067 checked the whole rationale instead of the choice.
//   extraReturnKeys  e.g. { predicate: 'relatedMatch' } (the BG-P6 (b) fault)
//   throwOnCall   the replay spy: a plain build must never call the judge
//   abstainCategory  'none' (default) | a picking category — the REAL client's evidence schema FORCES one on NONE (llmClient.js:88-99)
//   omitCategoryOnAbstain  false (default) | true — return NO category key at all on a NONE
//   abstainRationaleMode   'stated' (default) | 'absent' | 'absentThenStated'
//
// ⟪RULING SABLE_RIVER 2026-08-17 13:15, the LESSON⟫ The last two options exist because llmClient's
// select_candidate tool declares `required: ['choice']` — category and rationale are OPTIONAL BY SCHEMA, and
// ANYTHING A SCHEMA DOES NOT REQUIRE WILL BE OMITTED BY A REAL MODEL ON SOME ANSWER. A double derived from
// what the model USUALLY sends is not a double of the client; it is a double of the lucky case. Batch 1 of the
// Ed-Fi derived order died on exactly this: eight subjects judged, then an honest abstention with no category,
// permitted by the schema, refused by the framework, build dead. These options make the omitted-field returns
// PERMANENTLY exercised, so the seam can never again be proven only against the fields a model happened to fill.
const makeFakeRealClient = ({ pickOrdinal = '1', category = 'strong', abstainCategory = 'none', omitCategoryOnAbstain = false, abstainRationaleMode = 'stated', rationaleMode = 'keyAndName', extraReturnKeys = {}, throwOnCall = false, model = 'fake-anthropic-judge-v1' } = {}) => {
	const client = { callCount: 0, questionList: [], model, keySource: 'test' };
	client.rerank = ({ systemPrompt, userPrompt, choiceEnum, requireJudgment } = {}, callback) => {
		void systemPrompt;
		void requireJudgment;
		client.callCount += 1;
		client.questionList.push({ userPrompt, choiceEnum });
		if (throwOnCall) {
			throw new Error('spy judge client was called on a plain build');
		}
		const choice = typeof pickOrdinal === 'function' ? pickOrdinal({ userPrompt, choiceEnum }) : pickOrdinal;
		let rationale = '';
		if (choice !== 'NONE') {
			const lineMatch = new RegExp(`\\[${choice}\\] (\\S+) — ([^\\n]+)`).exec(userPrompt);
			const keyText = lineMatch ? lineMatch[1] : 'unknownKey';
			const nameText = lineMatch ? lineMatch[2] : 'unknown name';
			const isReask = /RESTATE YOUR RATIONALE/.test(userPrompt);
			const keyAndNameText = `${keyText} (${nameText}) means the same thing as the source element`;
			// ⟪RULING 14:55 (e)⟫ names the pick BY NAME and ALSO by its own ordinal — the symmetric-contrast
			// shape that killed D4 at subject 50, now lawful because the rationale is legible without the pool
			const nameAndOwnOrdinalText = `${keyText} (${nameText}) means the same thing as the source element, making candidate ${choice} the better match`;
			// a number that is deliberately NOT the pick: the contrastive mention a good rationale makes
			const rejectedOrdinal = String(Number(choice) === 1 ? 2 : 1);
			rationale = rationaleMode === 'ordinal' || (rationaleMode === 'ordinalThenKeyAndName' && !isReask) ? `picked candidate ${choice} because it looked right` : rationaleMode === 'blank' ? '' : rationaleMode === 'keyAndNameWithRejectedOrdinal' ? `${keyAndNameText}. Candidate ${rejectedOrdinal} is about something else, so it was ruled out.` : rationaleMode === 'keyAndNameWithOwnOrdinal' ? nameAndOwnOrdinalText : keyAndNameText;
		} else {
			// the re-ask for an absent abstention rationale is recognised by the instruction the component sends
			const isAbstainReask = /STATE YOUR REASON/.test(userPrompt);
			const statedText = 'none of the candidates means the same thing as the source element';
			const abstainRationaleByMode = { stated: statedText, absent: undefined, absentThenStated: isAbstainReask ? statedText : undefined };
			if (!Object.prototype.hasOwnProperty.call(abstainRationaleByMode, abstainRationaleMode)) {
				throw new Error(`makeFakeRealClient REFUSED: abstainRationaleMode '${abstainRationaleMode}' is not one of [${Object.keys(abstainRationaleByMode).join(', ')}] — an unknown mode is refused by name, never treated as the default`);
			}
			rationale = abstainRationaleByMode[abstainRationaleMode];
		}
		const clientReturn = { choice, model, attempts: 1, category: choice === 'NONE' ? abstainCategory : category, rationale, usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn', retryReasons: [], ...extraReturnKeys };
		// a schema-permitted OMISSION is the KEY ABSENT, not the key present holding undefined — the framework
		// reads it with hasOwnProperty-free checks either way, but the double must model the wire shape honestly
		if (choice === 'NONE' && omitCategoryOnAbstain) {
			delete clientReturn.category;
		}
		if (clientReturn.rationale === undefined) {
			delete clientReturn.rationale;
		}
		callback('', clientReturn);
	};
	return client;
};

module.exports.makeFakeRealClient = makeFakeRealClient;
