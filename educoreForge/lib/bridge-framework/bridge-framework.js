'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridge-framework.js — THE Bridge Framework: the factory + the object (SPEC-bridgeFramework-v1.md §3), the
// pipeline run(spec, callback) (§5), and the re-exports the surface names (§3.3).
//
//   const bridgeFramework = require('<lib>/bridge-framework/bridge-framework')({ graphReaderFactory, graphWriterFactory,
//                                                                                pluginRegistry, xLog?, conflictDetector? });
//   bridgeFramework.run(spec, callback)      // EXACTLY as build.js Phase C calls bridgeMaker.run
//
// ONE shared library so each of the Bridge Profile's choices is made once and observed red once. It holds NO
// per-run state: every index, census counter and decision list lives inside one run invocation. deps (§3.2):
// the reader/writer FACTORIES (the seam face passes the two bolt files; a suite passes graphDouble's), the
// discovery-built plugin REGISTRY (a suite passes a fixture registry), xLog (explicit wins, else
// process.global.xLog, else REFUSED — never a do-nothing logger), and the seam face's conflictDetector (the
// store-side sibling lookup, RULING 12:05 #1; a suite passes the same module with a fixture registry).
// judgeBudgetOverride is TEST-ONLY (proves the budget halt red; shippedConfig false — a sibling gate greps it
// absent from the seam face). Any other dep name is refused by name.
//
// The pipeline is orchestration-side end to end: taskListPlus + pipeRunner, callback error-first, every
// refusal a NAMED string; refuse.byName RETURNS an Error and each module stringifies at its callback boundary
// (RULING BF12); no async/await; no try/catch as control flow (the THREE sanctioned throw-to-value adapters:
// decisionBlock.js — canonicalText's throw and JSON.parse; bridgePluginContract.js — TextDecoder's fatal decode).
// A cheap refusal precedes a costly step.

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const sourceVerificationLib = require(path.join(__dirname, '..', 'forge-framework', 'sourceVerification'));
const contentAddress = require(path.join(__dirname, '..', 'content-address', 'content-address'))();
const BRIDGE_MAKER_LIB_DIR = path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');
const sourceWindowLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'sourceWindow'));
const debugJudgeLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'debugJudge'));

const bridgePluginContractLib = require('./bridgePluginContract');
const bridgeAllowanceRegistryLib = require('./bridgeAllowanceRegistry');
const pluginRegistryLib = require('./pluginRegistry');
const transformRegistryLib = require('./transformRegistry');
const predicateSourceLib = require('./predicateSource');
const classificationLib = require('./classification');
const subjectGroupingLib = require('./subjectGrouping');
const censusLib = require('./census');
const judgeComponentLib = require('./judgeComponent');
const evidenceRendererLib = require('./evidenceRenderer');
const representationPolicyLib = require('./representationPolicy');
const confidenceBandTableLib = require('./confidenceBandTable');
const decisionBlockLib = require('./decisionBlock');
const materialiserLib = require('./materialiser');
const sssomExporterLib = require('./sssomExporter');
const boundedRunnerLib = require('./boundedRunner');
const conflictDetectorLib = require('./conflictDetector');
const graphSeamRulesLib = require('./graphSeamRules');

const { RELATIONSHIP_PRODUCER_SUFFIX, SKOS_EDGE_TYPES, MAPPING_PROPERTIES } = vocabularyLib;
const {
	MATCH_BASIS_LIST,
	PRODUCER_KIND_LIST,
	RESOLUTION_LIST,
	PREDICATE_SOURCE_KIND_LIST,
	PREDICATE_ASSERTED_BY_LIST,
	LABEL_DISPOSITION_LIST,
	RUN_CONFIG_KEY_LIST,
	RUN_REPORT_RESULT_KEYS,
	WALK_ASSERTION_KEY_LIST,
	WALK_ASSERTION_FORBIDDEN_KEY_LIST,
	CHANNEL_REPORT_KEY_LIST,
	TUPLE_FIELD_LIST,
} = bridgePluginContractLib;

const DEP_NAME_LIST = Object.freeze(['graphReaderFactory', 'graphWriterFactory', 'pluginRegistry', 'xLog', 'conflictDetector', 'judgeBudgetOverride']);
const SEAM_SPEC_KEY_LIST = Object.freeze(['inGraph', 'bridge', 'source', 'hub', 'applyLabel', 'rebridge', 'decisionStore', 'judgmentCache', 'matchForensics', 'inferenceConfig', 'config']);
const PROPERTY_TIER = 'property';
const JUDGE_CONCURRENCY = 4; // bounded, index-collecting (BR-072)
const MAX_JUDGMENT_COUNT_PER_RUN = 20000; // the DECLARED per-run ceiling (BR-069, BR-120); the budget guard halts by name
const MODE_MATERIALISE = 'materialise';
const MODE_REJUDGE = 'rejudge';
const RUN_KIND_NONE = 'none';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonBlank = (value) => typeof value === 'string' && value.trim() !== '';
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const canonicalJson = bridgePluginContractLib.canonicalJsonText;
const locatorTextFor = (oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? String(oneAssertion.sourceLocator.rowNumber).padStart(9, '0') : oneAssertion.sourceLocator.stableId}`;

// producer suffix sanity (BG-PRODUCER d): every PRODUCER_KIND_LIST entry has a NON-EMPTY suffix — asserted at
// framework construction, because build.js guards on the suffix's TRUTHINESS
const producerSuffixRefusal = () => {
	const bad = PRODUCER_KIND_LIST.find((oneKind) => typeof RELATIONSHIP_PRODUCER_SUFFIX[oneKind] !== 'string' || RELATIONSHIP_PRODUCER_SUFFIX[oneKind].length === 0);
	return bad === undefined ? null : refuse.byName({ moduleName, what: `PRODUCER_KIND '${bad}' has no NON-EMPTY suffix in vocabulary.RELATIONSHIP_PRODUCER_SUFFIX (got ${JSON.stringify(RELATIONSHIP_PRODUCER_SUFFIX[bad])})`, where: 'build.js guards on the suffix\'s truthiness; an empty suffix would silently fall through to the decisionBlock-inference branch (RULING BF18, REVIEW A1)' });
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(deps = {}) => {
		if (!isPlainObject(deps)) {
			throw refuse.byName({ moduleName, what: `deps is ${deps === null ? 'null' : `a ${typeof deps}`}`, where: 'call the factory with { graphReaderFactory, graphWriterFactory, pluginRegistry, xLog?, conflictDetector? }' });
		}
		const unknownDepName = Object.keys(deps).find((oneName) => DEP_NAME_LIST.indexOf(oneName) === -1);
		if (unknownDepName !== undefined) {
			throw refuse.byName({ moduleName, what: `unknown dep '${unknownDepName}'`, where: `the factory accepts ${DEP_NAME_LIST.join(', ')}; a driver, a config, a store or a bolt URL is never a framework dep (SPEC §3.2)` });
		}
		if (typeof deps.graphReaderFactory !== 'function') {
			throw refuse.byName({ moduleName, what: 'graphReaderFactory is absent', where: 'the ONLY way any framework module reads the dependency graph (SPEC §3.2)' });
		}
		if (typeof deps.graphWriterFactory !== 'function') {
			throw refuse.byName({ moduleName, what: 'graphWriterFactory is absent', where: 'the ONLY door an edge goes through (SPEC §6)' });
		}
		if (!isPlainObject(deps.pluginRegistry) || !isPlainObject(deps.pluginRegistry.entryByBridgeName)) {
			throw refuse.byName({ moduleName, what: 'pluginRegistry is absent or not { entryByBridgeName }', where: 'the seam face builds it by discovery (pluginRegistry.buildRegistryFromDirectory); a suite passes a fixture registry' });
		}
		const xLog = deps.xLog !== undefined ? deps.xLog : process.global && process.global.xLog;
		if (!xLog || typeof xLog.status !== 'function' || typeof xLog.error !== 'function') {
			throw refuse.byName({ moduleName, what: 'xLog is available neither as a dep nor as process.global.xLog', where: 'pass { xLog } or bootstrap process.global; no do-nothing logger is manufactured' });
		}
		const conflictDetector = deps.conflictDetector === undefined ? conflictDetectorLib.detectSiblingConflicts : deps.conflictDetector;
		if (typeof conflictDetector !== 'function') {
			throw refuse.byName({ moduleName, what: 'conflictDetector is not a function', where: 'the seam face hosts the store-side sibling lookup (conflictDetector.detectSiblingConflicts)' });
		}
		let maxJudgmentCount = MAX_JUDGMENT_COUNT_PER_RUN;
		if (deps.judgeBudgetOverride !== undefined) {
			if (!Number.isInteger(deps.judgeBudgetOverride) || deps.judgeBudgetOverride < 1) {
				throw refuse.byName({ moduleName, what: 'judgeBudgetOverride must be a positive integer', where: 'TEST-ONLY dep; a suite lowers the ceiling to observe the budget halt red' });
			}
			maxJudgmentCount = deps.judgeBudgetOverride;
		}
		const suffixRefusal = producerSuffixRefusal();
		if (suffixRefusal) {
			throw suffixRefusal;
		}
		const registry = deps.pluginRegistry;
		const { graphReaderFactory, graphWriterFactory } = deps;

		// -----------------------------------------------------------------
		// helpers over the declaration (pure)
		// -----------------------------------------------------------------
		const labelTableOf = (bridgeDeclaration) => predicateSourceLib.PREDICATE_SOURCE_KIND_REGISTRY[bridgeDeclaration.predicateSource.kind].provenanceOf(bridgeDeclaration.predicateSource);
		const walkChannelPropertyList = (bridgeDeclaration) => Array.from(new Set(bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.sourceKind === 'forgedGraph').reduce((soFar, oneChannel) => soFar.concat(oneChannel.channelPropertyList), []))).sort();
		const subjectMatchFieldFor = (bridgeDeclaration) => {
			const prefix = bridgeDeclaration.sourceCuriePrefix.prefix;
			return TUPLE_FIELD_LIST.filter((oneField) => bridgeDeclaration.tupleFieldColumnMap[oneField] !== undefined)
				.map((oneField) => `${prefix}:${bridgeDeclaration.tupleFieldColumnMap[oneField].column}`)
				.join('|');
		};
		const OBJECT_MATCH_FIELD_HUB_PREFIX = 'EDUcoreHub'; // the hub's CURIE prefix for object_match_field (Profile §4.5); the hub NAME rides in object_source
		const objectMatchFieldFor = (bridgeDeclaration) => TUPLE_FIELD_LIST.filter((oneField) => bridgeDeclaration.tupleFieldColumnMap[oneField] !== undefined).map((oneField) => `${OBJECT_MATCH_FIELD_HUB_PREFIX}:${oneField}`).join('|');
		const isSentinelRawValue = ({ channel, rawValue }) => channel.absentTargetSentinelList.indexOf(rawValue === undefined || rawValue === null ? '' : String(rawValue)) !== -1;

		// -----------------------------------------------------------------
		// run — the seam (§5): ONE taskListPlus, ONE pipeRunner, callback error-first
		// -----------------------------------------------------------------
		const run = (spec, callback) => {
			if (typeof callback !== 'function') {
				throw refuse.byName({ moduleName, what: 'run: callback is not a function', where: 'run(spec, callback) is arity 2' });
			}
			const refuseRun = (what, where) => callback(refuse.byName({ moduleName, what, where }).message);
			if (!isPlainObject(spec)) {
				refuseRun(`run: spec is ${spec === null ? 'null' : `a ${typeof spec}`}`, 'run({ inGraph, bridge, source, hub, applyLabel, rebridge, decisionStore, judgmentCache, matchForensics, inferenceConfig, config }, callback)');
				return;
			}
			const { inGraph, bridge, applyLabel } = spec;
			// the stub's own three, kept verbatim (SPEC §5.0)
			if (!inGraph) {
				callback(`${moduleName}: inGraph is not given. It is the materialized dependency GraphHandle the bridge writes into; there is no default.`);
				return;
			}
			if (typeof bridge !== 'string' || bridge.trim() === '') {
				callback(`${moduleName}: bridge is ${bridge === undefined ? 'not named' : JSON.stringify(bridge)}. It is the name that resolves the bridge implementation; there is no default.`);
				return;
			}
			if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
				callback(`${moduleName}: applyLabel is ${applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)}. It is the label harvest selects the written edges by; there is no default.`);
				return;
			}
			const unknownSpecKey = Object.keys(spec).find((oneName) => SEAM_SPEC_KEY_LIST.indexOf(oneName) === -1);
			if (unknownSpecKey !== undefined) {
				refuseRun(`run: spec carries unknown key '${unknownSpecKey}'`, `build.js Phase C passes exactly ${SEAM_SPEC_KEY_LIST.join(', ')}`);
				return;
			}
			// an unregistered bridge is refused FIRST, listing the registered names (SPEC §5.0, BG-REG b)
			if (registry.entryByBridgeName[bridge] === undefined) {
				const looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: bridge, standardKey: spec.source });
				callback(`${moduleName}: ${looked.error.message}`);
				return;
			}
			if (!isNonBlank(spec.source)) {
				refuseRun('run: spec.source is absent', 'the recipe pairing\'s source token selects the plugin standardKey');
				return;
			}
			const looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: bridge, standardKey: spec.source });
			if (looked.error) {
				callback(`${moduleName}: ${looked.error.message}`);
				return;
			}
			const pluginEntry = looked.entry;
			const bridgeDeclaration = pluginEntry.bridgeDeclaration;
			const bridgeHooks = pluginEntry.bridgeHooks;
			if (!isNonBlank(spec.hub)) {
				refuseRun('run: spec.hub is absent', 'a mapping plugin without a hub is a category error (BR-017 mirror); the recipe pairing names its hub');
				return;
			}
			if (!isPlainObject(spec.config)) {
				refuseRun('run: spec.config is absent', 'build.js composes config { limit, offset, sourceStandard, sourceStandardName, sourceVersion, hubVersion, pairWith, pairWithVersion, familyStandards }');
				return;
			}
			const unknownConfigKey = Object.keys(spec.config).find((oneName) => RUN_CONFIG_KEY_LIST.indexOf(oneName) === -1);
			if (unknownConfigKey !== undefined) {
				refuseRun(`run: spec.config carries key '${unknownConfigKey}', outside RUN_CONFIG_KEY_LIST (${RUN_CONFIG_KEY_LIST.join(', ')})`, 'the recipe\'s bridges[].params channel is CLOSED — nothing a recipe param says reaches the framework (RULING BF11, A6)');
				return;
			}
			const { sourceStandardName, sourceVersion, hubVersion } = spec.config;
			const missingVersion = [
				['sourceStandardName', sourceStandardName],
				['sourceVersion', sourceVersion],
				['hubVersion', hubVersion],
			].find(([, oneValue]) => !isNonBlank(oneValue === undefined || oneValue === null ? '' : String(oneValue)));
			if (missingVersion !== undefined) {
				refuseRun(`run: config.${missingVersion[0]} is absent or blank`, 'a block that cannot name both versions has no address (BR-056, Profile §4.7) — refused here, before the spend');
				return;
			}
			if (typeof spec.rebridge !== 'boolean') {
				refuseRun(`run: rebridge is ${JSON.stringify(spec.rebridge)}, not a boolean`, 'build.js passes rebridge true iff the pair is in the --rebridge scope; "I did not say" is not a mode');
				return;
			}
			if (!spec.decisionStore || typeof spec.decisionStore.getDecisionBlock !== 'function' || typeof spec.decisionStore.saveDecisionBlock !== 'function') {
				refuseRun('run: decisionStore is absent', 'the framework opens NO store of its own; build.js hands the decision store in (BR-021 converse)');
				return;
			}
			if (spec.rebridge && (!spec.judgmentCache || typeof spec.judgmentCache.getJudgment !== 'function')) {
				refuseRun('run: judgmentCache is absent on a re-judge', 'rebridge: true needs decisionStore, judgmentCache and matchForensics (SPEC §3.2)');
				return;
			}
			if (spec.rebridge && (!spec.matchForensics || typeof spec.matchForensics.appendRecord !== 'function')) {
				refuseRun('run: matchForensics is absent on a re-judge', 'rebridge: true needs decisionStore, judgmentCache and matchForensics (SPEC §3.2)');
				return;
			}
			if (spec.rebridge && !isPlainObject(spec.inferenceConfig)) {
				refuseRun('run: inferenceConfig is absent on a re-judge', 'build.js resolveInferenceConfig hands { llmClient } (the real client or the debug judge)');
				return;
			}
			const limitResolution = sourceWindowLib.parsePositiveInteger({ value: spec.config.limit, name: 'limit', minimum: 1 });
			if (limitResolution.error) {
				callback(`${moduleName}: ${limitResolution.error}`);
				return;
			}
			const offsetResolution = sourceWindowLib.parsePositiveInteger({ value: spec.config.offset, name: 'offset', minimum: 0 });
			if (offsetResolution.error) {
				callback(`${moduleName}: ${offsetResolution.error}`);
				return;
			}
			if (bridgeDeclaration.standardKey !== spec.source) {
				refuseRun(`run: plugin '${bridge}' declares standardKey '${bridgeDeclaration.standardKey}' but spec.source is '${spec.source}'`, 'BR-009');
				return;
			}

			// identity of this run
			const sourceToken = spec.source;
			const hubToken = spec.hub;
			const pairScopedLabel = `${applyLabel}_${sourceToken.toUpperCase()}_${hubToken.toUpperCase()}`;
			const pairKeyPrefix = `${hubToken}@${hubVersion}::${sourceToken}@${sourceVersion}`;
			const pairKey = `${pairKeyPrefix}::${bridgeDeclaration.bridgeName}::${bridgeDeclaration.producerKind}`;
			const mode = spec.rebridge ? MODE_REJUDGE : MODE_MATERIALISE;
			const judgeClient = spec.rebridge && spec.inferenceConfig && spec.inferenceConfig.llmClient ? spec.inferenceConfig.llmClient : null;
			const debugMark = spec.rebridge ? debugJudgeLib.debugMarkFromLlmClient({ inferenceConfig: spec.inferenceConfig }) : undefined;
			const windowMark = sourceWindowLib.windowMarkFor({ limit: spec.config.limit, offset: spec.config.offset });
			const declarationDigest = sha256Hex(pluginEntry.declarationCanonicalText);
			const labelTableDigest = sha256Hex(canonicalJson(labelTableOf(bridgeDeclaration)));
			const subjectMatchField = subjectMatchFieldFor(bridgeDeclaration);
			const objectMatchField = objectMatchFieldFor(bridgeDeclaration);
			const baseGeneration = `${decisionBlockLib.FRAMEWORK_GENERATION}:${bridgeDeclaration.bridgeName}@${bridgeDeclaration.pluginVersion}:${evidenceRendererLib.RENDERER_VERSION}`;
			const generation = debugJudgeLib.generationWithDebugMark(sourceWindowLib.generationWithWindowMark(baseGeneration, windowMark), debugMark);
			const runPrefix = `[bridge ${bridgeDeclaration.bridgeName} ${sourceToken}→${hubToken}]`;
			const report = { refusalList: [], conflictCount: 0, conflictList: [], judgeSpend: { asked: 0, servedFromCache: 0, abstained: 0, usd: null }, blindingDeclarationEcho: bridgeDeclaration.blindingDeclaration.slice(), consistencyReport: [], subjectNodeReport: null, labelTableDigest, discardedPredicateKeyCount: 0, note: '' };
			const say = (text) => xLog.status(`${runPrefix} ${text}`);
			say(`mode ${mode}; pairKey ${pairKey}; pair-scoped label ${pairScopedLabel}; blindingDeclaration [${bridgeDeclaration.blindingDeclaration.join(', ')}]`);

			const runReportFor = ({ decisionBlockHash, blocksDecisionBlock, edgesWritten, counts, sssomExportPath, note }) => ({
				inGraph,
				bridge,
				applyLabel,
				producer: bridgeDeclaration.producerKind, // ALWAYS explicit (RULING A1)
				decisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },
				blocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: bridgeDeclaration.producerKind, decisionBlock: blocksDecisionBlock }],
				edgesWritten,
				counts,
				generation,
				rendererVersion: evidenceRendererLib.RENDERER_VERSION,
				mode,
				sssomExportPath,
				note,
			});

			// -----------------------------------------------------------------
			// channel digests + verification (shared by both modes): every document channel verified against
			// SHA256SUMS before a byte is read; digest = sha256 of the verified bytes; a forgedGraph channel is
			// digested later from the subject nodes' channel properties
			// -----------------------------------------------------------------
			const verifyDocumentChannels = (verifyCallback) => {
				const channelList = bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.sourceKind === 'document');
				const sourceChannelDigestByKey = {};
				const sourceChannelPathByKey = {};
				let channelIndex = 0;
				const nextChannel = () => {
					if (channelIndex >= channelList.length) {
						verifyCallback('', { sourceChannelDigestByKey, sourceChannelPathByKey });
						return;
					}
					const oneChannel = channelList[channelIndex];
					channelIndex += 1;
					const resolution = pluginEntry.channelResolutionByKey[oneChannel.channelKey];
					sourceVerificationLib.verifySnapshotChecksums({ snapshotDirPath: resolution.snapshotDirPath, relativePathList: [resolution.relativePathFromSnapshotDir] }, (verifyError) => {
						if (verifyError) {
							verifyCallback(`${moduleName}: channel '${oneChannel.channelKey}': ${verifyError}`);
							return;
						}
						const bytes = fs.readFileSync(resolution.filePath);
						const decoded = bridgePluginContractLib.decodeBytes({ bytes, encoding: oneChannel.encoding, channelKey: oneChannel.channelKey });
						if (decoded.error) {
							verifyCallback(refuse.byName({ moduleName, what: decoded.error, where: 'a declared encoding the bytes fail to decode is refused (BG-INPUT f)' }).message);
							return;
						}
						sourceChannelDigestByKey[oneChannel.channelKey] = crypto.createHash('sha256').update(bytes).digest('hex');
						sourceChannelPathByKey[oneChannel.channelKey] = resolution.filePath;
						nextChannel();
					});
				};
				nextChannel();
			};

			// =================================================================
			// MATERIALISE (rebridge: false)
			// =================================================================
			const materialiseMode = () => {
				spec.decisionStore.getDecisionBlock({ pairKey }, (getError, stored) => {
					if (getError) {
						callback(`${moduleName}: decisionStore.getDecisionBlock: ${getError}`);
						return;
					}
					if (!stored || stored.frozenText === null || stored.frozenText === undefined) {
						const note = `no frozen decision block for ${pairKey}; zero edges; nothing judged`;
						say(note);
						callback('', runReportFor({ decisionBlockHash: null, blocksDecisionBlock: null, edgesWritten: 0, counts: null, sssomExportPath: null, note }));
						return;
					}
					const parsed = decisionBlockLib.parseFrozenText(stored.frozenText);
					if (parsed.error) {
						callback(`${moduleName}: ${parsed.error.message}`);
						return;
					}
					const block = parsed.block;
					const recomputedId = decisionBlockLib.blockIdFor({ frozenText: stored.frozenText });
					if (recomputedId !== stored.decisionBlockHash) {
						refuseRun(`the stored block for ${pairKey} hashes to ${recomputedId}, not its address ${stored.decisionBlockHash}`, 'content-address verification on read');
						return;
					}
					const taskList = new taskListPlus();
					taskList.push((args, next) => {
						verifyDocumentChannels((verifyError, verified) => (verifyError ? next(verifyError) : next('', { ...args, ...verified })));
					});
					taskList.push((args, next) => {
						// RE-VERIFY the block against the run: a drifted document, a re-versioned endpoint or a changed
						// declaration is refused by name ("re-judge required"), never replayed onto the wrong graph
						const driftList = [];
						Object.keys(args.sourceChannelDigestByKey).forEach((oneKey) => {
							if (block.header.sourceChannelDigestByKey[oneKey] !== args.sourceChannelDigestByKey[oneKey]) {
								driftList.push(`sourceChannelDigestByKey.${oneKey}`);
							}
						});
						if (block.header.hubVersion !== String(hubVersion)) {
							driftList.push(`hubVersion (block ${block.header.hubVersion}, run ${hubVersion})`);
						}
						if (block.header.sourceVersion !== String(sourceVersion)) {
							driftList.push(`sourceVersion (block ${block.header.sourceVersion}, run ${sourceVersion})`);
						}
						if (block.header.declarationDigest !== declarationDigest) {
							driftList.push('declarationDigest');
						}
						if (driftList.length) {
							next(refuse.byName({ moduleName, what: `the frozen block for ${pairKey} does not match this run: ${driftList.join('; ')}`, where: 're-judge required (--rebridge); a block is never replayed onto a drifted source, endpoint or declaration (BG-REPLAY f)' }).message);
							return;
						}
						next('', args);
					});
					taskList.push((args, next) => materialiseAndReport({ block, decisionBlockHash: stored.decisionBlockHash, exportSssom: false }, next));
					pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
						if (pipelineError) {
							callback(pipelineError);
							return;
						}
						callback('', args.runReport);
					});
				});
			};

			// -----------------------------------------------------------------
			// materialiseAndReport — shared tail: conflict lookup → writer → export? → runReport
			// -----------------------------------------------------------------
			const materialiseAndReport = ({ block, decisionBlockHash, exportSssom, cardByStableId }, tailCallback) => {
				const blockDebugMark = debugJudgeLib.debugMarkFromGeneration(block.header.generation);
				const siblingPairKeyList = conflictDetectorLib.siblingPairKeyListFor({ registry, thisBridgeName: bridgeDeclaration.bridgeName, standardKey: bridgeDeclaration.standardKey, pairKeyPrefix, producerKind: bridgeDeclaration.producerKind });
				conflictDetector({ decisionStore: spec.decisionStore, siblingPairKeyList, thisBlock: block }, (conflictError, conflicts) => {
					if (conflictError) {
						tailCallback(conflictError);
						return;
					}
					const conflictedSubjectSet = new Set(conflicts.conflictList.map((oneConflict) => oneConflict.subjectStableId));
					report.conflictCount = conflicts.conflictList.length;
					report.conflictList = conflicts.conflictList;
					// BR7: the sibling list spans every (bridge × producerKind) key on the pairing, so it is never empty; "one plugin
					// on this pairing" means no OTHER registered bridgeName — the same bridge under another producerKind is still looked up
					const otherBridgeNameList = Array.from(new Set(siblingPairKeyList.map((oneSibling) => oneSibling.siblingBridgeName).filter((oneName) => oneName !== bridgeDeclaration.bridgeName))).sort();
					if (otherBridgeNameList.length === 0) {
						say(`0 conflicts (one plugin on this pairing — detector exercised by fixture only; ${siblingPairKeyList.length} sibling key(s) looked up under other producerKinds, ${conflicts.siblingBlockCount} found)`);
					} else {
						say(`${conflicts.conflictList.length} conflict(s) against ${conflicts.siblingBlockCount} sibling block(s) (${siblingPairKeyList.map((oneSibling) => `${oneSibling.siblingBridgeName}::${oneSibling.siblingProducerKind}`).join(', ')})`);
					}
					const materialisableBlock = { ...block, decisionRecordList: block.decisionRecordList.filter((oneRecord) => !conflictedSubjectSet.has(oneRecord.subjectStableId)) };
					const writerArgs = { inGraph, applyLabel: pairScopedLabel, sourceStandardName };
					const writerRefusal = graphSeamRulesLib.writerConstructionRefusal(writerArgs);
					if (writerRefusal) {
						tailCallback(writerRefusal.message);
						return;
					}
					const writer = graphWriterFactory(writerArgs);
					materialiserLib.materialiseBlock(
						{ block: materialisableBlock, decisionBlockHash, writer, sourceStandardName, sourceVersion: String(sourceVersion), hubName: block.header.hubName, hubVersion: String(hubVersion), mappingProviderUrl: bridgeDeclaration.mappingProvider.url, subjectMatchField, objectMatchField, debugMark: blockDebugMark },
						(materialiseError, materialised) => {
							writer.close((closeError) => {
								if (materialiseError) {
									tailCallback(materialiseError);
									return;
								}
								if (closeError) {
									tailCallback(closeError);
									return;
								}
								const conflictRecordWrite = (afterConflicts) => {
									if (!conflicts.conflictList.length || !spec.matchForensics || typeof spec.matchForensics.appendRecord !== 'function') {
										afterConflicts('');
										return;
									}
									spec.matchForensics.appendRecord({ pairKey, generation: block.header.generation, record: { kind: 'MappingReview', conflictList: conflicts.conflictList } }, afterConflicts);
								};
								conflictRecordWrite((reviewError) => {
									if (reviewError) {
										tailCallback(`${moduleName}: MappingReview trail: ${reviewError}`);
										return;
									}
									const finish = (sssomExportPath) => {
										const counts = { cardinalityCensus: block.header.cardinalityCensus, contentionCensus: block.header.contentionCensus, edgesWritten: materialised.edgesWritten, conflictCount: report.conflictCount, judgeSpend: report.judgeSpend, refusalCount: report.refusalList.length, discardedPredicateKeyCount: report.discardedPredicateKeyCount };
										say(`materialised ${materialised.edgesWritten} edge(s) under ${pairScopedLabel} from block ${decisionBlockHash.slice(0, 12)}… (${mode})`);
										const note = mode === MODE_MATERIALISE ? `replayed frozen block ${decisionBlockHash} for ${pairKey}` : `re-judged and froze block ${decisionBlockHash} for ${pairKey}`;
										tailCallback('', { runReport: runReportFor({ decisionBlockHash, blocksDecisionBlock: { decisionBlockHash, pairKey, generation: block.header.generation }, edgesWritten: materialised.edgesWritten, counts, sssomExportPath, note }), writtenEdgeList: materialised.writtenEdgeList, report });
									};
									if (!exportSssom) {
										finish(null);
										return;
									}
									const outputPath = path.join(spec.matchForensics.baseDirPath, pairKey, `${decisionBlockHash}.sssom.tsv`);
									const setLevelSlots = {
										mappingProvider: bridgeDeclaration.mappingProvider,
										subjectSource: sourceStandardName,
										subjectSourceVersion: String(sourceVersion),
										objectSource: block.header.hubName,
										objectSourceVersion: String(hubVersion),
										subjectMatchField,
										objectMatchField,
										subjectCuriePrefix: bridgeDeclaration.subjectCuriePrefix,
										[predicateSourceLib.PREDICATE_SOURCE_KIND_REGISTRY[bridgeDeclaration.predicateSource.kind].provenanceSlotName]: labelTableOf(bridgeDeclaration),
									};
									const curieMap = { [bridgeDeclaration.subjectCuriePrefix]: `urn:educore:${bridgeDeclaration.standardKey}:`, [bridgeDeclaration.sourceCuriePrefix.prefix]: bridgeDeclaration.sourceCuriePrefix.iri, [OBJECT_MATCH_FIELD_HUB_PREFIX]: `urn:educore:hub:${block.header.hubName}:` };
									sssomExporterLib.toSssomTsv({ decisionBlock: block, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath }, (exportError, exported) => {
										if (exportError) {
											tailCallback(exportError);
											return;
										}
										say(`SSSOM/TSV ${exported.rowCount} row(s) over ${exported.subjectCount} subject(s) → ${exported.outputPath}`);
										finish(exported.outputPath);
									});
								});
							});
						},
					);
				});
			};

			// =================================================================
			// RE-JUDGE (rebridge: true): §5.2–§5.6 → freeze → save → materialise → export → report
			// =================================================================
			const rejudgeMode = () => {
				const taskList = new taskListPlus();

				// STEP 1 — the reader (ONE flatten, two views); cards; subjects
				taskList.push((args, next) => {
					const readerArgs = { inGraph, dependencyStandardNameList: [sourceStandardName, hubToken], sourceStandardName, blindingDeclaration: bridgeDeclaration.blindingDeclaration };
					const readerRefusal = graphSeamRulesLib.readerConstructionRefusal(readerArgs);
					if (readerRefusal) {
						next(readerRefusal.message);
						return;
					}
					const reader = graphReaderFactory(readerArgs);
					say(`blinding declaration echoed by name before the first read: [${bridgeDeclaration.blindingDeclaration.join(', ')}]`);
					reader.readHubCards({ referenceTier: PROPERTY_TIER }, (cardError, cardList) => {
						if (cardError) {
							next(`${moduleName}: readHubCards: ${cardError}`);
							return;
						}
						if (cardList.length === 0) {
							next(refuse.byName({ moduleName, what: 'the hub double / graph carries ZERO property-tier cards', where: 'an empty pool is never a mapping run (BG-EMPTY)' }).message);
							return;
						}
						const hubNameSet = new Set(cardList.map((oneCard) => oneCard.hubName));
						if (hubNameSet.size !== 1) {
							next(refuse.byName({ moduleName, what: `the cards name ${hubNameSet.size} hubs (${Array.from(hubNameSet).join(', ')})`, where: 'a pairing has ONE hub' }).message);
							return;
						}
						const hubName = cardList[0].hubName;
						const hubVersionOnCards = new Set(cardList.map((oneCard) => String(oneCard.hubVersion)));
						if (hubVersionOnCards.size !== 1 || !hubVersionOnCards.has(String(hubVersion))) {
							next(refuse.byName({ moduleName, what: `the cards carry hubVersion ${Array.from(hubVersionOnCards).join(', ')} but config.hubVersion is ${hubVersion}`, where: 'a re-versioned endpoint is refused, never guessed' }).message);
							return;
						}
						const cardListByCanonicalKey = classificationLib.makeCardListByCanonicalKey({ cardList });
						const contention = censusLib.contentionCensus({ cardListByCanonicalKey, tier: PROPERTY_TIER });
						const cardByStableId = cardList.reduce((soFar, oneCard) => ({ ...soFar, [oneCard.stableId]: oneCard }), {});
						say(`cards: ${contention.cardCount} / distinct keys ${contention.distinctKeyCount} / contended ${contention.contendedKeyCount} / worst ${contention.worstContention} (measured this run)`);
						reader.readSubjectNodes((subjectError, subjectNodeList) => {
							if (subjectError) {
								next(`${moduleName}: readSubjectNodes: ${subjectError}`);
								return;
							}
							if (subjectNodeList.length === 0) {
								next(refuse.byName({ moduleName, what: `the source standard '${sourceStandardName}' has ZERO forged nodes in the dependency graph`, where: 'the source scope is EXACT (BR-023); nothing to map' }).message);
								return;
							}
							const subjectNodeByStableId = subjectNodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});
							next('', { ...args, reader, cardList, cardListByCanonicalKey, contention, cardByStableId, hubName, subjectNodeList, subjectNodeByStableId });
						});
					});
				});

				// STEP 2 — verify document channels; digest forgedGraph channels from the subject nodes
				taskList.push((args, next) => {
					verifyDocumentChannels((verifyError, verified) => {
						if (verifyError) {
							next(verifyError);
							return;
						}
						next('', { ...args, sourceChannelDigestByKey: { ...verified.sourceChannelDigestByKey }, sourceChannelPathByKey: verified.sourceChannelPathByKey });
					});
				});

				// STEP 2b — a forgedGraph channel is digested from its UNBLINDED channel values, read through forWalk
				// (the blinded readSubjectNodes view lacks them by design): channelKey + sha256 over the sorted rows
				taskList.push((args, next) => {
					const forgedChannelList = bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.sourceKind === 'forgedGraph');
					if (forgedChannelList.length === 0) {
						next('', args);
						return;
					}
					const walkView = args.reader.forWalk({ channelPropertyList: walkChannelPropertyList(bridgeDeclaration) });
					walkView.readSourceNodes({}, (readError, walkRecordList) => {
						if (readError) {
							next(`${moduleName}: forgedGraph digest read: ${readError}`);
							return;
						}
						const sourceChannelDigestByKey = { ...args.sourceChannelDigestByKey };
						forgedChannelList.forEach((oneChannel) => {
							const rowText = walkRecordList
								.slice()
								.sort((leftNode, rightNode) => compareStrings(leftNode.stableId, rightNode.stableId))
								.map((oneNode) => canonicalJson([oneNode.stableId].concat(oneChannel.channelPropertyList.map((oneName) => (oneNode.properties[oneName] === undefined ? null : oneNode.properties[oneName])))))
								.join('\n');
							sourceChannelDigestByKey[oneChannel.channelKey] = `forgedGraph:${sha256Hex(rowText)}`;
						});
						next('', { ...args, sourceChannelDigestByKey });
					});
				});

				// STEP 3 — the WALK (once per run) + assertion validation + channelReport reconciliation
				taskList.push((args, next) => {
					const walkView = args.reader.forWalk({ channelPropertyList: walkChannelPropertyList(bridgeDeclaration) });
					// the argument object handed to a hook is a CLOSED shape: a Proxy throws by name on any other read (BG-CONTAIN)
					const hookArgs = graphSeamRulesLib.closedHookArgs({ sourceChannelPathByKey: { ...args.sourceChannelPathByKey }, sourceReader: walkView, xLog });
					bridgeHooks.walkSourceAssertions(hookArgs, (walkError, walked) => {
						if (walkError) {
							next(`${moduleName}: walkSourceAssertions: ${walkError}`);
							return;
						}
						if (!isPlainObject(walked) || !Array.isArray(walked.assertionList) || !isPlainObject(walked.channelReport)) {
							next(refuse.byName({ moduleName, what: 'walkSourceAssertions returned no { assertionList, channelReport }', where: 'the walk contract (SPEC §4.2)' }).message);
							return;
						}
						if (walked.assertionList.length === 0) {
							next(refuse.byName({ moduleName, what: 'the walk yielded an EMPTY assertion set', where: 'an empty source is refused by name, never frozen green (BR-094, BG-EMPTY)' }).message);
							return;
						}
						const channelKeyList = bridgeDeclaration.sourceChannelList.map((oneChannel) => oneChannel.channelKey);
						// channelReport per declared channel, every term present, reconciliation at zero
						for (let channelIndex = 0; channelIndex < channelKeyList.length; channelIndex++) {
							const oneKey = channelKeyList[channelIndex];
							const oneReport = walked.channelReport[oneKey];
							if (!isPlainObject(oneReport)) {
								next(refuse.byName({ moduleName, what: `channelReport lacks channel '${oneKey}'`, where: 'every declared channel reports rowsRead, assertionsYielded, sentinelDropped, malformedRows, valueTierRows' }).message);
								return;
							}
							const missingTerm = CHANNEL_REPORT_KEY_LIST.find((oneTerm) => !Number.isInteger(oneReport[oneTerm]));
							if (missingTerm !== undefined) {
								next(refuse.byName({ moduleName, what: `channelReport['${oneKey}'].${missingTerm} is not an integer`, where: 'reconciliation needs every term' }).message);
								return;
							}
							if (oneReport.rowsRead !== oneReport.assertionsYielded + oneReport.sentinelDropped + oneReport.malformedRows + oneReport.valueTierRows) {
								next(refuse.byName({ moduleName, what: `channel '${oneKey}' does not reconcile: rowsRead ${oneReport.rowsRead} ≠ assertionsYielded ${oneReport.assertionsYielded} + sentinelDropped ${oneReport.sentinelDropped} + malformedRows ${oneReport.malformedRows} + valueTierRows ${oneReport.valueTierRows}`, where: 'reconciliation at zero per channel (BG-INPUT e)' }).message);
								return;
							}
						}
						const yieldedByChannel = {};
						for (let assertionIndex = 0; assertionIndex < walked.assertionList.length; assertionIndex++) {
							const oneAssertion = walked.assertionList[assertionIndex];
							if (!isPlainObject(oneAssertion)) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} is not an object`, where: 'the walk yields assertion objects' }).message);
								return;
							}
							const forbidden = WALK_ASSERTION_FORBIDDEN_KEY_LIST.find((oneName) => Object.prototype.hasOwnProperty.call(oneAssertion, oneName));
							if (forbidden !== undefined) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} (${JSON.stringify(oneAssertion.sourceLocator)}) carries '${forbidden}'`, where: 'a plugin never sets resolution / confidence / matchBasis / mappingJustification / objectStableId / a card stableId (BR-022)' }).message);
								return;
							}
							const unknownKey = Object.keys(oneAssertion).find((oneName) => WALK_ASSERTION_KEY_LIST.indexOf(oneName) === -1 && oneName !== 'consistencyCheckValueByColumn');
							if (unknownKey !== undefined) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} carries unknown key '${unknownKey}'`, where: `the assertion shape is ${WALK_ASSERTION_KEY_LIST.join(', ')} (+ consistencyCheckValueByColumn)` }).message);
								return;
							}
							if (channelKeyList.indexOf(oneAssertion.channelKey) === -1) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} names channel '${oneAssertion.channelKey}', which is not declared`, where: 'sourceChannelList' }).message);
								return;
							}
							if (!Array.isArray(oneAssertion.rawTargetList) || oneAssertion.rawTargetList.length === 0 || oneAssertion.rawTargetList.some((oneTarget) => !isPlainObject(oneTarget) || typeof oneTarget.sourceColumnName !== 'string' || oneTarget.rawValue === undefined)) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} rawTargetList is not a non-empty list of { sourceColumnName, rawValue }`, where: 'EVERY id the row names, in row order (BR-133)' }).message);
								return;
							}
							if (!isPlainObject(oneAssertion.tupleFieldValues) || !isPlainObject(oneAssertion.subjectIdentity) || !isPlainObject(oneAssertion.sourceLocator)) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} lacks tupleFieldValues / subjectIdentity / sourceLocator objects`, where: 'the assertion shape (SPEC §4.2)' }).message);
								return;
							}
							yieldedByChannel[oneAssertion.channelKey] = (yieldedByChannel[oneAssertion.channelKey] || 0) + 1;
						}
						channelKeyList.forEach((oneKey) => {
							if ((yieldedByChannel[oneKey] || 0) !== walked.channelReport[oneKey].assertionsYielded) {
								report.refusalList.push({ kind: 'channelReportDrift', channelKey: oneKey, detail: `assertionsYielded ${walked.channelReport[oneKey].assertionsYielded} but ${yieldedByChannel[oneKey] || 0} assertions carry this channelKey` });
							}
						});
						const drift = report.refusalList.find((oneRefusal) => oneRefusal.kind === 'channelReportDrift');
						if (drift) {
							next(refuse.byName({ moduleName, what: `channel '${drift.channelKey}': ${drift.detail}`, where: 'assertionsYielded EQUALS the assertions carrying that channelKey' }).message);
							return;
						}
						const refusedValueTierAssertionCount = bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.tier === 'value').reduce((soFar, oneChannel) => soFar + walked.channelReport[oneChannel.channelKey].valueTierRows, 0);
						say(`walk: ${walked.assertionList.length} assertion(s) over ${channelKeyList.length} channel(s); value-tier rows refused and counted: ${refusedValueTierAssertionCount}`);
						next('', { ...args, assertionList: walked.assertionList, channelReport: walked.channelReport, refusedValueTierAssertionCount });
					});
				});

				// STEP 4 — targets: sentinel drop, transforms (empty cell = ABSENT), consistency checks, label census, refused rows
				taskList.push((args, next) => {
					const channelByKey = bridgeDeclaration.sourceChannelList.reduce((soFar, oneChannel) => ({ ...soFar, [oneChannel.channelKey]: oneChannel }), {});
					const preparedList = [];
					let sentinelDroppedCount = 0;
					const consistencyReport = [];
					const consistencyRefusalList = [];
					const isSentinelAssertion = (oneAssertion) => oneAssertion.rawTargetList.every((oneTarget) => isSentinelRawValue({ channel: channelByKey[oneAssertion.channelKey], rawValue: oneTarget.rawValue }));
					const census = predicateSourceLib.labelCensus({ predicateSource: bridgeDeclaration.predicateSource, assertionList: args.assertionList, isSentinelAssertion, subjectKeyFor: (oneAssertion) => subjectGroupingLib.subjectKeyFor({ subjectIdentity: bridgeDeclaration.subjectIdentity, assertion: oneAssertion }) });
					if (census.error) {
						next(census.error.message);
						return;
					}
					for (let assertionIndex = 0; assertionIndex < args.assertionList.length; assertionIndex++) {
						const oneAssertion = args.assertionList[assertionIndex];
						const channel = channelByKey[oneAssertion.channelKey];
						if (isSentinelAssertion(oneAssertion)) {
							sentinelDroppedCount += 1;
							continue;
						}
						if (census.refusedRowIndexSet.has(assertionIndex)) {
							const labelRow = predicateSourceLib.labelRowFor({ predicateSource: bridgeDeclaration.predicateSource, assertion: oneAssertion });
							report.refusalList.push({ kind: 'labelRefused', sourceLocator: oneAssertion.sourceLocator, sourceLabel: labelRow.sourceLabel, reason: labelRow.reason });
							continue;
						}
						// tuple fields other than canonicalKey: an empty cell is ABSENT; '' is refused by name
						const suppliedTupleFields = {};
						let fieldFault = null;
						Object.keys(bridgeDeclaration.tupleFieldColumnMap)
							.filter((oneField) => oneField !== 'canonicalKey')
							.forEach((oneField) => {
								const rawValue = oneAssertion.tupleFieldValues[oneField];
								if (rawValue === undefined || rawValue === null) {
									return;
								}
								if (rawValue === '') {
									fieldFault = refuse.byName({ moduleName, what: `assertion ${JSON.stringify(oneAssertion.sourceLocator)} carries tuple field '${oneField}' as '' (empty string)`, where: 'an empty cell is ABSENT (omit the key), never \'\' and never defaulted (BG-INPUT c)' });
									return;
								}
								const transformed = transformRegistryLib.applyTransform({ transformName: bridgeDeclaration.tupleFieldColumnMap[oneField].transform, rawValue: String(rawValue) });
								if (transformed.error) {
									fieldFault = refuse.byName({ moduleName, what: `assertion ${JSON.stringify(oneAssertion.sourceLocator)} tuple field '${oneField}': ${transformed.error}`, where: 'TRANSFORM_REGISTRY' });
									return;
								}
								suppliedTupleFields[oneField] = transformed.value;
							});
						if (fieldFault) {
							next(fieldFault.message);
							return;
						}
						// every raw target → canonicalKey through the declared transform; sentinel targets dropped
						const targetKeyList = [];
						let targetFault = null;
						oneAssertion.rawTargetList.forEach((oneTarget) => {
							if (isSentinelRawValue({ channel, rawValue: oneTarget.rawValue })) {
								return;
							}
							const transformed = transformRegistryLib.applyTransform({ transformName: bridgeDeclaration.tupleFieldColumnMap.canonicalKey.transform, rawValue: String(oneTarget.rawValue) });
							if (transformed.error) {
								targetFault = refuse.byName({ moduleName, what: `assertion ${JSON.stringify(oneAssertion.sourceLocator)} target ${JSON.stringify(oneTarget.rawValue)}: ${transformed.error}`, where: 'the canonicalKey transform' });
								return;
							}
							targetKeyList.push(transformed.value);
						});
						if (targetFault) {
							next(targetFault.message);
							return;
						}
						// consistency checks against canonicalKey (refuse | report); card.<property> checks are settled after resolution
						let rowRefused = false;
						bridgeDeclaration.consistencyCheckColumnList.forEach((oneCheck) => {
							const rawValue = oneAssertion.consistencyCheckValueByColumn === undefined ? undefined : oneAssertion.consistencyCheckValueByColumn[oneCheck.column];
							if (rawValue === undefined || rawValue === null || rawValue === '') {
								return;
							}
							const transformed = transformRegistryLib.applyTransform({ transformName: oneCheck.transform, rawValue: String(rawValue) });
							if (oneCheck.against === 'canonicalKey') {
								const agrees = !transformed.error && targetKeyList.indexOf(transformed.value) !== -1;
								if (!agrees) {
									if (oneCheck.disposition === 'refuse') {
										rowRefused = true;
										consistencyRefusalList.push({ kind: 'consistencyRefused', sourceLocator: oneAssertion.sourceLocator, column: oneCheck.column, rawValue: String(rawValue), against: 'canonicalKey', targetKeyList: targetKeyList.slice() });
									} else {
										consistencyReport.push({ sourceLocator: oneAssertion.sourceLocator, column: oneCheck.column, rawValue: String(rawValue), against: 'canonicalKey', disagrees: true });
									}
								}
							}
						});
						if (rowRefused) {
							continue;
						}
						const labelRow = predicateSourceLib.labelRowFor({ predicateSource: bridgeDeclaration.predicateSource, assertion: oneAssertion });
						preparedList.push({ ...oneAssertion, suppliedTupleFields, targetKeyList, labelRow, valueTier: channel.tier === 'value' || oneAssertion.tupleFieldValues.valueKey !== undefined, lossyEcho: targetKeyList.length > 1 });
					}
					report.refusalList.push(...consistencyRefusalList);
					report.consistencyReport = consistencyReport;
					if (preparedList.length === 0) {
						next(refuse.byName({ moduleName, what: 'after sentinel drop and row refusals, NO assertion remains', where: 'never an empty block frozen green (BG-EMPTY)' }).message);
						return;
					}
					next('', { ...args, preparedList, sentinelDroppedCount, sentinelLabelledRowCount: census.sentinelLabelledRowCount, labelRefusedCount: census.labelRefusedCount });
				});

				// STEP 5 — group by subject; window; subjectStableIdFor ONCE; verify + merge; collisions
				taskList.push((args, next) => {
					const grouped = subjectGroupingLib.groupBySubject({ assertionList: args.preparedList, subjectIdentity: bridgeDeclaration.subjectIdentity });
					if (grouped.error) {
						next(grouped.error.message);
						return;
					}
					const sortedGroupList = grouped.subjectGroupList.slice().sort((leftGroup, rightGroup) => compareStrings(leftGroup.subjectKey, rightGroup.subjectKey));
					const windowed = sourceWindowLib.applySourceWindow(sortedGroupList.map((oneGroup) => ({ stableId: oneGroup.subjectKey, group: oneGroup })), { limit: spec.config.limit, offset: spec.config.offset });
					if (windowed.error) {
						next(`${moduleName}: ${windowed.error}`);
						return;
					}
					const subjectGroupList = windowed.sourceNodes.map((oneEntry) => oneEntry.group);
					if (windowed.window) {
						say(sourceWindowLib.describeWindow(windowed.window));
					}
					const walkView = args.reader.forWalk({ channelPropertyList: walkChannelPropertyList(bridgeDeclaration) });
					let hookCallCount = 0;
					const subjectIdentityList = subjectGroupList.map((oneGroup) => ({ subjectKey: oneGroup.subjectKey, subjectIdentity: { ...oneGroup.subjectIdentity } }));
					hookCallCount += 1;
					bridgeHooks.subjectStableIdFor(graphSeamRulesLib.closedHookArgs({ subjectIdentityList, sourceReader: walkView, xLog }), (resolveError, resolved) => {
						if (resolveError) {
							next(`${moduleName}: subjectStableIdFor: ${resolveError}`);
							return;
						}
						if (!isPlainObject(resolved) || !isPlainObject(resolved.resolutionBySubjectKey)) {
							next(refuse.byName({ moduleName, what: 'subjectStableIdFor returned no { resolutionBySubjectKey }', where: 'the hook contract (SPEC §4.2)' }).message);
							return;
						}
						const merged = subjectGroupingLib.verifyResolutionAndMerge({ subjectGroupList, resolutionBySubjectKey: resolved.resolutionBySubjectKey, subjectNodeStableIdSet: new Set(Object.keys(args.subjectNodeByStableId)) });
						merged.sourceGapList.forEach((oneGap) => report.refusalList.push({ kind: 'sourceGap', subjectKey: oneGap.subjectKey, reason: oneGap.reason, detail: oneGap.detail }));
						merged.subjectCollisionList.forEach((oneCollision) => report.refusalList.push({ kind: 'subjectCollision', subjectStableId: oneCollision.subjectStableId, assertingSubjectList: oneCollision.assertingSubjectList, targetSetBySubjectKey: oneCollision.targetSetBySubjectKey }));
						report.subjectNodeReport = { subjectCount: subjectGroupList.length, resolved: merged.leafList.length + merged.subjectCollisionList.length, refused: merged.sourceGapList.length, leaves: merged.leafList.length, manyToOneSubjectCount: merged.manyToOneSubjectCount, collisions: merged.subjectCollisionList.length, hookCallCount };
						say(`subjects: ${subjectGroupList.length} distinct; leaves ${merged.leafList.length}; sourceGap ${merged.sourceGapList.length}; subjectCollision ${merged.subjectCollisionList.length} (subjectStableIdFor called ${hookCallCount}×)`);
						next('', { ...args, subjectGroupList, leafList: merged.leafList, sourceGapList: merged.sourceGapList, subjectCollisionList: merged.subjectCollisionList, manyToOneSubjectCount: merged.manyToOneSubjectCount, windowMark });
					});
				});

				// STEP 5b — the HUB-owned remodel table, by REFERENCE (RULING P11, D-S5): forges/<hubToken>/bridgeData/
				// <remodelTableRef>.json keyed hubName@hubVersion, read as data (never required as code), digested into
				// the header; a declared ref with no table, or a table without this hub@version, is refused by name
				taskList.push((args, next) => {
					if (bridgeDeclaration.remodelTableRef === null) {
						next('', { ...args, remodelTable: null, remodelTableDigest: null });
						return;
					}
					if (typeof registry.forgesDirPath !== 'string') {
						next(refuse.byName({ moduleName, what: `plugin declares remodelTableRef '${bridgeDeclaration.remodelTableRef}' but the registry names no forgesDirPath`, where: 'the hub bundle is resolved under the registry\'s forges directory' }).message);
						return;
					}
					const tablePath = path.join(registry.forgesDirPath, hubToken, 'bridgeData', `${bridgeDeclaration.remodelTableRef}.json`);
					if (!fs.existsSync(tablePath)) {
						next(refuse.byName({ moduleName, what: `remodelTableRef '${bridgeDeclaration.remodelTableRef}' names no table at ${tablePath}`, where: 'the property-side remodel table is HUB-OWNED data under forges/<hub>/bridgeData/ (RULING P11)' }).message);
						return;
					}
					const tableBytes = fs.readFileSync(tablePath);
					const parsedTable = decisionBlockLib.parseJsonText(tableBytes.toString('utf8'));
					if (parsedTable.error || !isPlainObject(parsedTable.value)) {
						next(refuse.byName({ moduleName, what: `remodel table ${tablePath} is not a JSON object (${parsedTable.error || 'not an object'})`, where: 'keyed hubName@hubVersion → rawCanonicalKey → tuple' }).message);
						return;
					}
					const remodelTable = parsedTable.value;
					const tableKey = `${args.hubName}@${hubVersion}`;
					if (!isPlainObject(remodelTable[tableKey])) {
						next(refuse.byName({ moduleName, what: `remodel table ${tablePath} carries no entry for ${tableKey} (keys: ${Object.keys(remodelTable).join(', ')})`, where: 'the table is keyed hubName@hubVersion' }).message);
						return;
					}
					next('', { ...args, remodelTable, remodelTableDigest: crypto.createHash('sha256').update(tableBytes).digest('hex') });
				});

				// STEP 6 — remodel + filter + classify per (leaf, target group) → decision records (pure)
				taskList.push((args, next) => {
					const remodelTable = args.remodelTable;
					const decisionRecordList = [];
					const judgedTaskList = [];
					let buildFault = null;
					args.leafList.forEach((oneLeaf) => {
						if (buildFault) {
							return;
						}
						// distinct targets of the leaf, each with its remodel + supplied tuple, and the rows naming it
						const targetByKey = {};
						const targetOrder = [];
						oneLeaf.assertionList.forEach((oneAssertion) => {
							oneAssertion.targetKeyList.forEach((oneCanonicalKey) => {
								const remodelled = subjectGroupingLib.applyRemodel({ target: { canonicalKey: oneCanonicalKey, ...oneAssertion.suppliedTupleFields }, remodelTable, hubName: args.hubName, hubVersion: String(hubVersion), classSideRemodelTable: bridgeDeclaration.classSideRemodelTable });
								const targetKey = canonicalJson(remodelled.target);
								if (targetByKey[targetKey] === undefined) {
									targetByKey[targetKey] = { targetKey, target: remodelled.target, rawCanonicalKey: oneCanonicalKey, remodelApplied: remodelled.remodelApplied, sourceDomainSuperseded: remodelled.sourceDomainSuperseded, assertionList: [], valueTier: false, lossyEcho: false };
									targetOrder.push(targetKey);
								}
								targetByKey[targetKey].assertionList.push(oneAssertion);
								targetByKey[targetKey].valueTier = targetByKey[targetKey].valueTier || oneAssertion.valueTier;
								targetByKey[targetKey].lossyEcho = targetByKey[targetKey].lossyEcho || oneAssertion.lossyEcho;
							});
						});
						const dispositionList = oneLeaf.assertionList.map((oneAssertion) => oneAssertion.labelRow.disposition);
						const allPredicate = dispositionList.every((oneDisposition) => oneDisposition === 'predicate');
						const anyLossyEcho = oneLeaf.assertionList.some((oneAssertion) => oneAssertion.lossyEcho);
						// union grouping: a lossy echo (one row, several ids) or MIXED / all-tentative labels over several
						// targets → ONE (subject, union-target) record; all-predicate rows → N per-target records
						const nonValueTargetKeyList = targetOrder.filter((oneKey) => !targetByKey[oneKey].valueTier);
						const unionAll = nonValueTargetKeyList.length > 1 && (!allPredicate || anyLossyEcho);
						const groupList = unionAll ? [nonValueTargetKeyList] : nonValueTargetKeyList.map((oneKey) => [oneKey]);
						// value-tier targets: refused and counted, never grouped
						targetOrder
							.filter((oneKey) => targetByKey[oneKey].valueTier)
							.forEach((oneKey) => {
								const oneTarget = targetByKey[oneKey];
								decisionRecordList.push({ subjectStableId: oneLeaf.subjectStableId, assertingSubjectList: oneLeaf.assertingSubjectList, targetKey: oneKey, targetCanonicalKeyList: [oneTarget.target.canonicalKey], classification: 'valueTierRefused', resolution: null, objectStableId: null, predicate: null, rawForm: oneTarget.assertionList.map((oneAssertion) => oneAssertion.rawTargetList.map((oneRaw) => String(oneRaw.rawValue))), attestationChannelList: oneTarget.assertionList.map((oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? oneAssertion.sourceLocator.rowNumber : oneAssertion.sourceLocator.stableId}`).sort() });
							});
						groupList.forEach((oneGroupKeyList) => {
							if (buildFault) {
								return;
							}
							const groupTargetList = oneGroupKeyList.map((oneKey) => targetByKey[oneKey]);
							const groupAssertionList = Array.from(new Set(groupTargetList.reduce((soFar, oneTarget) => soFar.concat(oneTarget.assertionList), [])));
							const groupDispositionList = groupAssertionList.map((oneAssertion) => oneAssertion.labelRow.disposition);
							const allLabelsTentative = groupDispositionList.every((oneDisposition) => oneDisposition === 'tentative');
							const allLabelsPredicate = groupDispositionList.every((oneDisposition) => oneDisposition === 'predicate');
							const labelsMixed = !allLabelsTentative && !allLabelsPredicate;
							// key pools and filtered pools, per target then unioned; seat reasons per card
							let keyPoolCardList = [];
							let filteredCardList = [];
							const seatReasonByStableId = {};
							const mismatchByField = {};
							groupTargetList.forEach((oneTarget) => {
								const keyPool = args.cardListByCanonicalKey.get(oneTarget.target.canonicalKey);
								const suppliedTupleFields = { ...oneTarget.target };
								const filtered = classificationLib.filterPoolByTuple({ keyPool, suppliedTupleFields });
								keyPool.forEach((oneCard) => {
									if (!keyPoolCardList.some((soFarCard) => soFarCard.stableId === oneCard.stableId)) {
										keyPoolCardList.push(oneCard);
									}
								});
								filtered.filteredPool.forEach((oneCard) => {
									if (!filteredCardList.some((soFarCard) => soFarCard.stableId === oneCard.stableId)) {
										filteredCardList.push(oneCard);
									}
									seatReasonByStableId[oneCard.stableId] = filtered.filterFieldList.length ? 'filteredOnKeyAndTuple' : 'filteredOnKey';
								});
								Object.keys(filtered.mismatchByField).forEach((oneField) => {
									mismatchByField[oneField] = { suppliedValue: suppliedTupleFields[oneField], eliminated: filtered.mismatchByField[oneField] };
								});
							});
							keyPoolCardList = classificationLib.sortByStableId(keyPoolCardList);
							filteredCardList = classificationLib.sortByStableId(filteredCardList);
							const context = { subjectUnresolvable: false, subjectCollision: false, valueTier: false, allLabelsTentative, allLabelsPredicate, labelsMixed, keyPoolSize: keyPoolCardList.length, filteredPoolSize: filteredCardList.length };
							const classified = classificationLib.classifyTarget(context);
							if (classified.error) {
								buildFault = classified.error;
								return;
							}
							const attestationChannelList = groupAssertionList.map((oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? oneAssertion.sourceLocator.rowNumber : oneAssertion.sourceLocator.stableId}`).sort();
							const targetKey = oneGroupKeyList.length === 1 ? oneGroupKeyList[0] : `union:${oneGroupKeyList.slice().sort().join('|')}`;
							const baseRecord = {
								subjectStableId: oneLeaf.subjectStableId,
								assertingSubjectList: oneLeaf.assertingSubjectList,
								targetKey,
								targetCanonicalKeyList: groupTargetList.map((oneTarget) => oneTarget.target.canonicalKey).sort(),
								suppliedTupleByTarget: groupTargetList.reduce((soFar, oneTarget) => ({ ...soFar, [oneTarget.target.canonicalKey]: oneTarget.target }), {}),
								remodelApplied: groupTargetList.map((oneTarget) => oneTarget.remodelApplied).find((oneRemodel) => oneRemodel !== null) || null,
								sourceDomainSuperseded: groupTargetList.map((oneTarget) => oneTarget.sourceDomainSuperseded).find((oneSuperseded) => oneSuperseded !== null) || null,
								sourceLabelList: Array.from(new Set(groupAssertionList.map((oneAssertion) => oneAssertion.labelRow.sourceLabel === null ? '(channelAssertion)' : oneAssertion.labelRow.sourceLabel))).sort(),
								attestationChannelList,
								keyPoolStableIdList: keyPoolCardList.map((oneCard) => oneCard.stableId),
								filteredPoolStableIdList: filteredCardList.map((oneCard) => oneCard.stableId),
								classification: classified.classification,
								judgedReason: classified.reason,
								lossyEcho: groupTargetList.some((oneTarget) => oneTarget.lossyEcho),
							};
							if (classified.classification === 'orphan') {
								decisionRecordList.push({ ...baseRecord, resolution: null, objectStableId: null, predicate: null, reason: baseRecord.remodelApplied ? 'remodelTargetAbsent' : 'noCardUnderKey' });
								return;
							}
							if (classified.classification === 'specified') {
								const predicateSet = new Set(groupAssertionList.map((oneAssertion) => oneAssertion.labelRow.predicate));
								if (predicateSet.size > 1) {
									buildFault = refuse.byName({ moduleName, what: `subject ${oneLeaf.subjectStableId} → ${filteredCardList[0].stableId} is asserted with TWO predicates (${Array.from(predicateSet).sort().join(', ')}) by rows ${attestationChannelList.join(', ')}`, where: 'ONE edge per (subject, predicate, object); a pair with two predicates is refused at freeze (BG-EDGE-UNIQUE b)' });
									return;
								}
								const oneRow = groupAssertionList.slice().sort((leftAssertion, rightAssertion) => compareStrings(locatorTextFor(leftAssertion), locatorTextFor(rightAssertion)))[0].labelRow;
								decisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].stableId, predicate: oneRow.predicate, predicateAssertedBy: oneRow.predicateAssertedBy, sourceLabel: oneRow.sourceLabel, mappingJustification: 'semapv:ManualMappingCuration' });
								return;
							}
							// judged: the pool is the filtered pool, or the KEY pool on a source-side mismatch (BR-062)
							const pool = classified.reason === 'sourceSideMismatch' ? keyPoolCardList : filteredCardList;
							const seatReason = classified.reason === 'sourceSideMismatch' ? 'keyPoolOnSourceSideMismatch' : null;
							judgedTaskList.push({
								baseRecord: {
									...baseRecord,
									resolution: 'judged',
									mappingJustification: 'semapv:CompositeMatching',
									sourceSideMismatch: classified.reason === 'sourceSideMismatch' ? { mismatchByField, survivingCandidateCount: keyPoolCardList.length } : null,
								},
								pool,
								seatReason,
								seatReasonByStableId,
								groupAssertionList,
							});
						});
					});
					if (buildFault) {
						next(buildFault.message);
						return;
					}
					say(`classified: ${decisionRecordList.length} settled record(s) (specified/orphan/valueTier), ${judgedTaskList.length} to judge`);
					next('', { ...args, decisionRecordList, judgedTaskList });
				});

				// STEP 7 — the JUDGE (bounded runner, index-collecting); the debug double is the only judge in B2
				taskList.push((args, next) => {
					if (args.judgedTaskList.length === 0) {
						next('', { ...args, judgedRecordList: [], judgeKind: RUN_KIND_NONE });
						return;
					}
					if (!judgeClient || typeof judgeClient.rerank !== 'function') {
						const firstJudged = args.judgedTaskList[0];
						next(refuse.byName({ moduleName, what: `a judged decision is needed for subject ${firstJudged.baseRecord.subjectStableId} (${firstJudged.baseRecord.targetKey}) and inferenceConfig.llmClient is absent`, where: 'a re-judge with judged subjects needs the real client or the debug judge (build.js resolveInferenceConfig); a specified-only run needs no judge' }).message);
						return;
					}
					const judgeKind = debugMark ? `debug:${judgeClient.ruleName}` : `anthropic:${judgeClient.model}`;
					const budget = { maxJudgmentCount, judgmentCountSoFar: 0 };
					const evidenceView = args.reader.forEvidence();
					// the key is PRESENT iff the hook is declared (contract, RULING BR4); with the hook off there is no guidance to render
					const globalGuidanceList = bridgeDeclaration.evidenceHooksDeclared.globalGuidance ? bridgeDeclaration.globalGuidanceList.slice() : [];
					const judgeOneTask = (oneTask, taskIndex, taskDone) => {
						const subjectNode = args.subjectNodeByStableId[oneTask.baseRecord.subjectStableId];
						// the source's own material is MERGED over every row of the group in LOCATOR order (never walk order —
						// BG-DET c): per column, the distinct values sorted and joined, so the rendered question is order-free
						const orderedAssertionList = oneTask.groupAssertionList.slice().sort((leftAssertion, rightAssertion) => compareStrings(locatorTextFor(leftAssertion), locatorTextFor(rightAssertion)));
						const mergedByColumn = (pick) => {
							const valueListByColumn = {};
							orderedAssertionList.forEach((oneAssertion) => {
								const valueByColumn = pick(oneAssertion);
								Object.keys(valueByColumn === undefined || valueByColumn === null ? {} : valueByColumn).forEach((oneColumn) => {
									const oneValue = valueByColumn[oneColumn];
									if (oneValue === undefined || oneValue === null || String(oneValue) === '') {
										return;
									}
									(valueListByColumn[oneColumn] = valueListByColumn[oneColumn] || []).push(String(oneValue));
								});
							});
							return Object.keys(valueListByColumn).reduce((soFar, oneColumn) => ({ ...soFar, [oneColumn]: Array.from(new Set(valueListByColumn[oneColumn])).sort().join(' | ') }), {});
						};
						const sourceElement = {
							name: typeof subjectNode.properties.name === 'string' && subjectNode.properties.name.trim() !== '' ? subjectNode.properties.name : subjectNode.stableId,
							stableId: subjectNode.stableId,
							material: Object.keys(subjectNode.properties)
								.filter((oneName) => ['description', 'definition', 'path', 'xpath', 'characteristics', 'role', 'perStandardLabel'].indexOf(oneName) !== -1)
								.reduce((soFar, oneName) => ({ ...soFar, [oneName]: subjectNode.properties[oneName] }), {}),
							evidence: { subject: mergedByColumn((oneAssertion) => (oneAssertion.evidence ? oneAssertion.evidence.subject : {})), assertion: mergedByColumn((oneAssertion) => (oneAssertion.evidence ? oneAssertion.evidence.assertion : {})) },
							sourceLabelByColumn: mergedByColumn((oneAssertion) => oneAssertion.sourceLabelByColumn),
							sourceNoteByColumn: mergedByColumn((oneAssertion) => oneAssertion.sourceNoteByColumn),
						};
						const candidatePool = oneTask.pool.map((oneCard) => ({ card: oneCard, seatReason: oneTask.seatReason === null ? oneTask.seatReasonByStableId[oneCard.stableId] : oneTask.seatReason }));
						const withEvidenceHooks = (hooksDone) => {
							const hookState = { perCandidateNoteByStableId: {}, promptSegmentList: [], nominatedByStableId: {} };
							const afterNominate = () => {
								if (!bridgeDeclaration.evidenceHooksDeclared.walkEvidence) {
									hooksDone('', hookState);
									return;
								}
								bridgeHooks.walkEvidence({ sourceElement: { ...sourceElement }, candidatePool: candidatePool.map((oneSeat) => ({ ...oneSeat.card })), sourceReader: evidenceView }, (walkError, walkedEvidence) => {
									if (walkError) {
										hooksDone(`walkEvidence: ${walkError}`);
										return;
									}
									if (!isPlainObject(walkedEvidence) || !isPlainObject(walkedEvidence.perCandidateNoteByStableId) || !Array.isArray(walkedEvidence.promptSegmentList)) {
										hooksDone(refuse.byName({ moduleName, what: 'walkEvidence returned no { perCandidateNoteByStableId, promptSegmentList }', where: 'the hook contract' }).message);
										return;
									}
									hookState.perCandidateNoteByStableId = walkedEvidence.perCandidateNoteByStableId;
									hookState.promptSegmentList = walkedEvidence.promptSegmentList;
									hooksDone('', hookState);
								});
							};
							if (!bridgeDeclaration.evidenceHooksDeclared.nominate) {
								afterNominate();
								return;
							}
							bridgeHooks.nominateCandidates({ sourceElement: { ...sourceElement }, candidatePool: candidatePool.map((oneSeat) => ({ ...oneSeat.card })) }, (nominateError, nominationList) => {
								if (nominateError) {
									hooksDone(`nominateCandidates: ${nominateError}`);
									return;
								}
								if (!Array.isArray(nominationList)) {
									hooksDone(refuse.byName({ moduleName, what: 'nominateCandidates returned no list', where: '[{ candidateStableId, rationale }]' }).message);
									return;
								}
								for (let nominationIndex = 0; nominationIndex < nominationList.length; nominationIndex++) {
									const oneNomination = nominationList[nominationIndex];
									if (!isPlainObject(oneNomination) || typeof oneNomination.rationale !== 'string' || oneNomination.rationale.trim() === '') {
										hooksDone(refuse.byName({ moduleName, what: `nomination ${nominationIndex} carries no rationale`, where: 'a nomination without rationale is refused (BR-016)' }).message);
										return;
									}
									if (!candidatePool.some((oneSeat) => oneSeat.card.stableId === oneNomination.candidateStableId)) {
										hooksDone(refuse.byName({ moduleName, what: `nomination ${nominationIndex} names stableId ${JSON.stringify(oneNomination.candidateStableId)}, which is not in the filtered pool`, where: 'the hook adds EVIDENCE, never a candidate' }).message);
										return;
									}
									hookState.nominatedByStableId[oneNomination.candidateStableId] = oneNomination.rationale;
								}
								afterNominate();
							});
						};
						withEvidenceHooks((hookError, hookState) => {
							if (hookError) {
								taskDone(`${moduleName}: ${hookError}`);
								return;
							}
							const decoratedPool = candidatePool.map((oneSeat) => (hookState.nominatedByStableId[oneSeat.card.stableId] !== undefined ? { ...oneSeat, nominatedBy: bridgeDeclaration.bridgeName, nominationRationale: hookState.nominatedByStableId[oneSeat.card.stableId] } : oneSeat));
							const question = evidenceRendererLib.renderQuestion({ sourceElement, candidatePool: decoratedPool, globalGuidanceList, perCandidateNoteByStableId: hookState.perCandidateNoteByStableId, promptSegmentList: hookState.promptSegmentList });
							if (question.error) {
								taskDone(question.error.message);
								return;
							}
							judgeComponentLib.judgeOne({ question, judgeClient, judgmentCache: spec.judgmentCache, matchForensics: spec.matchForensics, budget, pairKey, generation, debugMark }, (judgeError, judged) => {
								if (judgeError) {
									taskDone(judgeError);
									return;
								}
								report.discardedPredicateKeyCount += judged.discardedPredicateKeyCount;
								if (judged.cacheHit) {
									report.judgeSpend.servedFromCache += 1;
								} else {
									report.judgeSpend.asked += 1;
								}
								// the FROZEN judge record: evidence BY REFERENCE (promptHash, rendererVersion, judgeModel) + the ordinal and
								// category — never cacheHit / usage / attempts (run-variable; they live in the report and forensics)
								const judgeRecord = { promptHash: judged.promptHash, rendererVersion: evidenceRendererLib.RENDERER_VERSION, judgeModel: judged.judgeModel, choice: judged.choice, category: judged.category };
								// a real abstention's SCHEMA-FORCED category rides in the frozen record only when present (RULING 2026-08-16, judgeComponent)
								if (judged.reportedCategoryOnAbstain !== undefined && judged.reportedCategoryOnAbstain !== null) {
									judgeRecord.reportedCategoryOnAbstain = judged.reportedCategoryOnAbstain;
								}
								if (judged.chosenCardStableId === null) {
									report.judgeSpend.abstained += 1;
									taskDone('', { ...oneTask.baseRecord, objectStableId: null, predicate: null, predicateAssertedBy: null, sourceLabel: null, confidence: null, abstained: true, judge: judgeRecord, renderedPoolStableIdList: question.renderedPoolStableIdList });
									return;
								}
								// the predicate of a judged pick: from the SOURCE row that named the picked card — a tentative
								// row's predicateIfPicked, a predicate row's predicate; never the judge
								const pickedCard = oneTask.pool.find((oneCard) => oneCard.stableId === judged.chosenCardStableId);
								const namingAssertion = orderedAssertionList.find((oneAssertion) => oneAssertion.targetKeyList.indexOf(pickedCard.canonicalKey) !== -1 || Object.keys(oneTask.baseRecord.suppliedTupleByTarget).some((oneRawKey) => oneTask.baseRecord.suppliedTupleByTarget[oneRawKey].canonicalKey === pickedCard.canonicalKey && oneAssertion.targetKeyList.indexOf(oneRawKey) !== -1)) || oneTask.groupAssertionList[0];
								const labelRow = namingAssertion.labelRow;
								const predicate = labelRow.disposition === 'tentative' ? labelRow.predicateIfPicked : labelRow.predicate;
								taskDone('', { ...oneTask.baseRecord, objectStableId: judged.chosenCardStableId, predicate, predicateAssertedBy: labelRow.predicateAssertedBy, sourceLabel: labelRow.sourceLabel, confidence: judged.confidence, abstained: false, judge: judgeRecord, renderedPoolStableIdList: question.renderedPoolStableIdList });
							});
						});
					};
					boundedRunnerLib.runBounded({ itemList: args.judgedTaskList, concurrency: JUDGE_CONCURRENCY, oneItem: judgeOneTask }, (runnerError, judgedRecordList) => {
						if (runnerError) {
							next(runnerError);
							return;
						}
						say(`judged: ${judgedRecordList.length} (asked ${report.judgeSpend.asked}, cache ${report.judgeSpend.servedFromCache}, abstained ${report.judgeSpend.abstained}; judge ${judgeKind})`);
						next('', { ...args, judgedRecordList, judgeKind });
					});
				});

				// STEP 8 — FREEZE: header + census; save; then materialise from the block JUST FROZEN; export
				taskList.push((args, next) => {
					const decisionRecordList = args.decisionRecordList.concat(args.judgedRecordList);
					const uniquenessRefusal = materialiserLib.edgeUniquenessRefusal(decisionRecordList);
					if (uniquenessRefusal) {
						next(uniquenessRefusal.message);
						return;
					}
					const provisionalCensus = censusLib.cardinalityCensus({
						decisionRecordList,
						subjectCollisionList: args.subjectCollisionList,
						sourceGapList: args.sourceGapList,
						sentinelDroppedCount: args.sentinelDroppedCount,
						sentinelLabelledRowCount: args.sentinelLabelledRowCount,
						labelRefusedCount: args.labelRefusedCount,
						manyToOneSubjectCount: args.manyToOneSubjectCount,
						refusedValueTierAssertionCount: args.refusedValueTierAssertionCount,
						edgeCount: materialiserLib.pickedRecordList(decisionRecordList).length,
						contentionCensus: args.contention,
						indexCollisionCount: args.contention.contendedKeyCount,
					});
					const header = {
						frameworkGeneration: decisionBlockLib.FRAMEWORK_GENERATION,
						frameworkFingerprint: decisionBlockLib.frameworkFingerprint(),
						rendererVersion: evidenceRendererLib.RENDERER_VERSION,
						bridgeName: bridgeDeclaration.bridgeName,
						pluginVersion: bridgeDeclaration.pluginVersion,
						declarationDigest,
						labelTableDigest,
						remodelTableDigest: args.remodelTableDigest,
						matchBasis: bridgeDeclaration.matchBasis,
						producerKind: bridgeDeclaration.producerKind,
						judgeKind: args.judgeKind,
						sourceWindow: args.windowMark === undefined ? null : args.windowMark,
						blindingDeclaration: bridgeDeclaration.blindingDeclaration.slice(),
						sourceStandardName,
						sourceVersion: String(sourceVersion),
						hubName: args.hubName,
						hubVersion: String(hubVersion),
						sourceChannelDigestByKey: args.sourceChannelDigestByKey,
						contentionCensus: args.contention,
						cardinalityCensus: provisionalCensus,
						generation,
					};
					const refusalList = report.refusalList.map((oneRefusal) => ({ ...oneRefusal }));
					const frozen = decisionBlockLib.frozenTextFor({ header, decisionRecordList, refusalList });
					if (frozen.error) {
						next(frozen.error.message);
						return;
					}
					const decisionBlockHash = decisionBlockLib.blockIdFor({ frozenText: frozen.frozenText });
					spec.decisionStore.saveDecisionBlock({ pairKey, frozenText: frozen.frozenText, decisionBlockHash }, (saveError, saved) => {
						if (saveError) {
							next(`${moduleName}: saveDecisionBlock FAILED (FATAL, never a warning — BR-069): ${saveError}`);
							return;
						}
						say(`froze decision block ${decisionBlockHash} (${saved.alreadyPresent ? 'already present — idempotent' : 'saved'}); census per subject ${JSON.stringify(provisionalCensus.perSubject)}`);
						const parsed = decisionBlockLib.parseFrozenText(frozen.frozenText);
						if (parsed.error) {
							next(parsed.error.message);
							return;
						}
						next('', { ...args, frozenBlock: parsed.block, decisionBlockHash });
					});
				});
				taskList.push((args, next) => {
					args.reader.close((closeError) => {
						if (closeError) {
							next(closeError);
							return;
						}
						materialiseAndReport({ block: args.frozenBlock, decisionBlockHash: args.decisionBlockHash, exportSssom: true, cardByStableId: args.cardByStableId }, (tailError, tail) => (tailError ? next(tailError) : next('', { ...args, ...tail })));
					});
				});
				pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
					if (pipelineError) {
						callback(pipelineError);
						return;
					}
					callback('', args.runReport);
				});
			};

			if (mode === MODE_MATERIALISE) {
				materialiseMode();
			} else {
				rejudgeMode();
			}
		};

		// -----------------------------------------------------------------
		// the public surface (§3.3)
		// -----------------------------------------------------------------
		return {
			run,
			registerPlugin: pluginRegistryLib.registerPlugin,
			contracts: Object.freeze({
				BRIDGE_DECLARATION_CONTRACT: bridgePluginContractLib.BRIDGE_DECLARATION_CONTRACT,
				BRIDGE_HOOK_CONTRACT: bridgePluginContractLib.BRIDGE_HOOK_CONTRACT,
				MATCH_BASIS_LIST,
				PRODUCER_KIND_LIST,
				RESOLUTION_LIST,
				CLASSIFICATION_REGISTRY: classificationLib.CLASSIFICATION_REGISTRY,
				CLASSIFICATION_LIST: classificationLib.CLASSIFICATION_LIST,
				PREDICATE_SOURCE_KIND_LIST,
				PREDICATE_ASSERTED_BY_LIST,
				LABEL_DISPOSITION_LIST,
				TRANSFORM_REGISTRY: transformRegistryLib.TRANSFORM_REGISTRY,
				RUN_CONFIG_KEY_LIST,
				RUN_REPORT_RESULT_KEYS,
				CONFIDENCE_BAND_TABLE: confidenceBandTableLib.CONFIDENCE_BAND_TABLE,
				BRIDGE_ALLOWANCE_REGISTRY: bridgeAllowanceRegistryLib.BRIDGE_ALLOWANCE_REGISTRY,
				SEAT_REASON_LIST: representationPolicyLib.SEAT_REASON_LIST,
				SEAM_SPEC_KEY_LIST,
				DEP_NAME_LIST,
			}),
			constants: Object.freeze({
				FRAMEWORK_GENERATION: decisionBlockLib.FRAMEWORK_GENERATION,
				RENDERER_VERSION: evidenceRendererLib.RENDERER_VERSION,
				JUDGE_CONCURRENCY,
				MAX_JUDGMENT_COUNT_PER_RUN,
				PROPERTY_TIER,
			}),
			census: Object.freeze({ cardinalityCensus: censusLib.cardinalityCensus, contentionCensus: censusLib.contentionCensus }),
			decisionBlock: Object.freeze({ frozenTextFor: decisionBlockLib.frozenTextFor, blockIdFor: decisionBlockLib.blockIdFor, parseFrozenText: decisionBlockLib.parseFrozenText, canonicalText: decisionBlockLib.canonicalText, HEADER_KEY_ORDER: decisionBlockLib.HEADER_KEY_ORDER }),
			frameworkFingerprint: decisionBlockLib.frameworkFingerprint,
			refuse: Object.freeze({ byName: refuse.byName }),
			judge: Object.freeze({ judgeOne: judgeComponentLib.judgeOne }),
			exporter: Object.freeze({ toSssomTsv: sssomExporterLib.toSssomTsv, parseSssomTsv: sssomExporterLib.parseSssomTsv }),
			renderer: Object.freeze({ renderQuestion: evidenceRendererLib.renderQuestion }),
			vocabulary: Object.freeze({ SKOS_EDGE_TYPES, MAPPING_PROPERTIES }),
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
