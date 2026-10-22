'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridgeRunContext.js — everything the bridge reads before it judges a subject, read the way the bridge reads it,
// through the bridge's OWN modules and nothing else (DESIGN-WALK §7: "the requests are byte-for-byte the bridge's").
// It mirrors bridge-framework.js rejudgeMode STEP 1 (reader, cards, subjects) and the graphLabel subject producer
// (the declared retrieval method's prepareRetrieval), and computes the run identity (pairKey, generation, the judge
// configuration digest) with the same library calls. It never constructs a writer: nothing here can change a graph.

const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const BRIDGE_LIB = path.join(TREE_ROOT, 'lib', 'bridge-framework');
const BRIDGE_MAKER_LIB = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');

const pluginRegistryLib = require(path.join(BRIDGE_LIB, 'pluginRegistry'));
const bridgePluginContractLib = require(path.join(BRIDGE_LIB, 'bridgePluginContract'));
const candidateRetrievalMethodRegistryLib = require(path.join(BRIDGE_LIB, 'candidateRetrievalMethodRegistry'));
const evidenceRendererLib = require(path.join(BRIDGE_LIB, 'evidenceRenderer'));
const decisionBlockLib = require(path.join(BRIDGE_LIB, 'decisionBlock'));
const judgeConfigRecordLib = require(path.join(BRIDGE_LIB, 'judgeConfigRecord'));
const promptIdentifierScanLib = require(path.join(BRIDGE_LIB, 'promptIdentifierScan'));
const { graphReaderFactory } = require(path.join(BRIDGE_LIB, 'graphReader'));
const sourceWindowLib = require(path.join(BRIDGE_MAKER_LIB, 'sourceWindow'));
const debugJudgeLib = require(path.join(BRIDGE_MAKER_LIB, 'debugJudge'));
const vocabularyLib = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));

const PROPERTY_TIER = vocabularyLib.REFERENCE_TIER.PROPERTY;
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

// canonicalJson — the SAME function bridge-framework.js binds under this name (bridgePluginContract.canonicalJsonText)
const canonicalJson = bridgePluginContractLib.canonicalJsonText;

const buildBridgeRunContext = ({ inGraph, bridgeRun, judgeClient }, callback) => {
	const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: path.join(TREE_ROOT, 'forges') });
	const looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: bridgeRun.bridgeName, standardKey: bridgeRun.sourceToken });
	if (looked.error) {
		callback(`${moduleName}: ${looked.error.message}`);
		return;
	}
	const pluginEntry = looked.entry;
	const bridgeDeclaration = pluginEntry.bridgeDeclaration;
	const methodLookup = candidateRetrievalMethodRegistryLib.methodRowFor(bridgeDeclaration.candidateRetrieval);
	if (methodLookup.error) {
		callback(`${moduleName}: ${methodLookup.error.message}`);
		return;
	}
	const retrievalMethodRow = methodLookup.methodRow;
	const judgePromptVariant = bridgePluginContractLib.judgePromptVariantFor({ bridgeDeclaration }).judgePromptVariant;
	const variantRow = evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[judgePromptVariant];
	const subjectMaterialNameList = variantRow.subjectMaterialNameListFor({ bridgeDeclaration });
	const declarationDigest = sha256Hex(pluginEntry.declarationCanonicalText);
	const pairKey = `${bridgeRun.hubToken}@${bridgeRun.hubVersion}::${bridgeRun.sourceToken}@${bridgeRun.sourceVersion}::${bridgeDeclaration.bridgeName}::${bridgeDeclaration.producerKind}`;
	const baseGeneration = decisionBlockLib.generationFor({ bridgeName: bridgeDeclaration.bridgeName, pluginVersion: bridgeDeclaration.pluginVersion, declarationDigest, rendererVersion: variantRow.rendererVersion });
	// no window and no named set: the gold's block was judged over the whole population, so its generation carries no mark
	const debugMark = debugJudgeLib.debugMarkFromLlmClient({ inferenceConfig: { llmClient: judgeClient } });
	const generation = debugJudgeLib.generationWithDebugMark(sourceWindowLib.generationWithWindowMark(baseGeneration, null), debugMark);
	const runJudgeConfigHeader = bridgeDeclaration.blockRecordsJudgeConfig === true ? judgeConfigRecordLib.judgeConfigHeaderFor({ judgeClient, predicateRule: bridgeDeclaration.predicateSource.predicateRule }) : null;
	const judgeConfigCacheDigest = runJudgeConfigHeader === null ? null : sha256Hex(canonicalJson(runJudgeConfigHeader));
	const compiledPromptScan = bridgeDeclaration.promptIdentifierScan === undefined
		? null
		: promptIdentifierScanLib.compileScan({
			scanDeclaration: bridgeDeclaration.promptIdentifierScan,
			identifierList: bridgeDeclaration.promptIdentifierScan.identifierListPath === null ? null : promptIdentifierScanLib.readIdentifierList({ filePath: promptIdentifierScanLib.identifierListFilePathFor({ identifierListPath: bridgeDeclaration.promptIdentifierScan.identifierListPath, forgesDirPath: registry.forgesDirPath, standardKey: bridgeDeclaration.standardKey }) }),
		}).compiledScan;

	const readerArgs = { inGraph, dependencyStandardNameList: [bridgeRun.sourceStandardName, bridgeRun.hubToken], sourceStandardName: bridgeRun.sourceStandardName, blindingDeclaration: bridgeDeclaration.blindingDeclaration };
	const reader = graphReaderFactory(readerArgs);

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		reader.readHubCards({ referenceTier: PROPERTY_TIER }, (cardError, cardList) => {
			if (cardError) {
				next(`${moduleName}: readHubCards: ${cardError}`);
				return;
			}
			const hubNameSet = new Set(cardList.map((oneCard) => oneCard.hubName));
			if (cardList.length === 0 || hubNameSet.size !== 1) {
				next(`${moduleName}: readHubCards returned ${cardList.length} card(s) naming ${hubNameSet.size} hub(s); the bridge refuses both`);
				return;
			}
			const cardByStableId = cardList.reduce((soFar, oneCard) => Object.assign(soFar, { [oneCard.stableId]: oneCard }), {});
			next('', { ...args, cardList, cardByStableId, hubName: cardList[0].hubName });
		});
	});
	taskList.push((args, next) => {
		reader.readSubjectNodes((subjectError, subjectNodeList) => {
			if (subjectError) {
				next(`${moduleName}: readSubjectNodes: ${subjectError}`);
				return;
			}
			const subjectNodeByStableId = subjectNodeList.reduce((soFar, oneNode) => Object.assign(soFar, { [oneNode.stableId]: oneNode }), {});
			next('', { ...args, subjectNodeList, subjectNodeByStableId });
		});
	});
	// the declared retrieval method, prepared ONCE over the whole labelled population, exactly as the graphLabel producer does
	taskList.push((args, next) => {
		const subjectLabel = bridgeDeclaration.subjectSource.label;
		const windowedNodeList = args.subjectNodeList.filter((oneNode) => oneNode.labels.indexOf(subjectLabel) !== -1).sort((leftNode, rightNode) => (leftNode.stableId < rightNode.stableId ? -1 : leftNode.stableId > rightNode.stableId ? 1 : 0));
		const retrievalContext = { retrievalView: reader.forRetrieval(), evidenceView: reader.forEvidence(), retrievalDeclaration: bridgeDeclaration.candidateRetrieval, hubName: args.hubName, sourceStandardName: bridgeRun.sourceStandardName, subjectLabel, subjectNodeList: args.subjectNodeList, windowedNodeList };
		retrievalMethodRow.prepareRetrieval(retrievalContext, (prepareError, retrievalState) => {
			if (prepareError) {
				next(`${moduleName}: prepareRetrieval: ${prepareError}`);
				return;
			}
			next('', { ...args, retrievalState, labelledSubjectStableIdSet: new Set(windowedNodeList.map((oneNode) => oneNode.stableId)) });
		});
	});
	pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
		if (pipelineError) {
			reader.close(() => callback(pipelineError));
			return;
		}
		callback('', {
			reader,
			bridgeRun,
			pluginEntry,
			bridgeDeclaration,
			retrievalMethodRow,
			retrievalState: args.retrievalState,
			judgePromptVariant,
			variantRow,
			subjectMaterialNameList,
			pairKey,
			generation,
			debugMark,
			judgeConfigCacheDigest,
			compiledPromptScan,
			cardList: args.cardList,
			cardByStableId: args.cardByStableId,
			hubName: args.hubName,
			subjectNodeByStableId: args.subjectNodeByStableId,
			labelledSubjectStableIdSet: args.labelledSubjectStableIdSet,
		});
	});
};

module.exports = { buildBridgeRunContext, moduleName };
