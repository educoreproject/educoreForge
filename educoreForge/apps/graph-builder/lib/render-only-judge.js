'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// render-only-judge.js — P-b of the R0 proof kit (2026-10-21, step 7): re-render a fixed sample of REAL judge questions under the
// code in this tree, with no graph, no judge and no spend, so a later phase can show which judgment-cache keys its change would
// move (and price them) before anything is re-judged.
//
// A judged unit's cache key is (promptHash, model, rendererVersion) (judgment-cache.js), where model is the judge's identity
// joined to judgeConfigCacheDigest for a bridge that records its judge config (judgeComponent cacheModelFor), and the digest is
// sha256 of the judge config header (judgeConfigRecord.judgeConfigHeaderFor) — whose judgeToolSchemaSha256 is the one part of it
// that CODE can move (the tool text); the rest is the provider's configuration. So two things are recomputed here:
//   promptHash   by evidenceRenderer.renderQuestion itself, over inputs rebuilt from the stored base blocks the way the framework
//                builds them for a retrieval-pooled (derived) unit: the subject node as the bolt reader returns it, blinded and
//                allow-listed; the owning construct's definition by owningConstructDefinition.js; the partition label from the
//                frozen record; the pool = the record's filteredPoolStableIdList, cards shaped by graphSeamRules.shapeHubCardList,
//                each seated 'retrieval'; the declaration's global guidance; no hook evidence (the derived plugins declare none)
//   toolSchema   by judgeConfigRecord's own rule over promptIdentifierScan's tool-text renderer
// THE INPUT REBUILD IS THE PART THAT IS NOT THE FRAMEWORK'S OWN CODE (the framework builds them inside one closure). Its proof is
// the gate: on unchanged code every sampled promptHash must equal the one frozen in the decision record. It cannot agree by
// accident; a unit that disagrees is named with the first differing line of the prompt against the forensic record.
//
//   renderSampleFor({ bridgeEntry, frozenBlock, sampleSize, sourceStandardName, hubStandardName, baseNodeIndex }) → { unitList } | { error }
//     baseNodeIndex  { nodeByStableId: Map, sourceRawRecordList, hubCardRawRecordList } — bolt-shaped raw records (see rawRecordFor)
//   rawRecordFor(resolvedNode) → { stableId, labels, properties }   the record the bolt reader returns for a replayed node
//   toolSchemaSha256For({ predicateRule }) → hex
//   cacheModelKeyFor({ judgeModel, frozenHeader, toolSchemaSha256 }) → the judgment cache's model column for the unit

const path = require('path');
const neo4j = require('neo4j-driver');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const graphSeamRulesLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphSeamRules'));
const evidenceRendererLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'evidenceRenderer'));
const bridgePluginContractLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridgePluginContract'));
const owningConstructDefinitionLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'owningConstructDefinition'));
const judgeConfigRecordLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'judgeConfigRecord'));
const promptIdentifierScanLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'promptIdentifierScan'));
const judgeComponentLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'judgeComponent'));
const { sha256Hex } = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'decisionBlock'));
const replayEngineLib = require(path.join(TREE_ROOT, 'lib', 'replay', 'replay-engine'))();

// the framework reads a retrieval pool's cards at the property tier (bridge-framework PROPERTY_TIER, a module constant there)
const RETRIEVAL_CARD_TIER = 'property';
// a retrieval-pooled unit's every seat carries this reason (bridge-framework STEP 6, retrieval leaf tasks)
const RETRIEVAL_SEAT_REASON = 'retrieval';

const asBoltReturns = (oneValue) => (neo4j.isInt(oneValue) ? oneValue.toNumber() : Array.isArray(oneValue) ? oneValue.map(asBoltReturns) : oneValue);
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);

const rawRecordFor = (resolvedNode) => {
	const row = replayEngineLib.buildNodeRow(resolvedNode);
	const properties = Object.keys(row.props).reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: asBoltReturns(row.props[oneName]) }), {});
	return { stableId: properties.stableId, labels: resolvedNode.labels.slice(), properties };
};

const toolSchemaSha256For = ({ predicateRule }) => sha256Hex(promptIdentifierScanLib.TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule]({ choiceEnum: judgeConfigRecordLib.TOOL_SCHEMA_CHOICE_ENUM_PLACEHOLDER.slice() }));

const cacheModelKeyFor = ({ judgeModel, frozenHeader, toolSchemaSha256 }) => {
	const judgeConfigHeader = {
		judgeTemperaturePolicy: frozenHeader.judgeTemperaturePolicy,
		judgeMaxTokens: frozenHeader.judgeMaxTokens,
		judgeToolSchemaSha256: toolSchemaSha256,
		...(frozenHeader.judgeCategoryFloorByCategory === undefined ? {} : { judgeCategoryFloorByCategory: frozenHeader.judgeCategoryFloorByCategory }),
	};
	return judgeComponentLib.cacheModelFor({ model: judgeModel, judgeConfigCacheDigest: sha256Hex(bridgePluginContractLib.canonicalJsonText(judgeConfigHeader)) });
};

const renderSampleFor = ({ bridgeEntry, frozenBlock, sampleSize, sourceStandardName, hubStandardName, baseNodeIndex }) => {
	const bridgeDeclaration = bridgeEntry.bridgeDeclaration;
	const judgePromptVariant = bridgePluginContractLib.judgePromptVariantFor({ bridgeDeclaration }).judgePromptVariant;
	const variantRow = evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[judgePromptVariant];
	const subjectMaterialNameList = variantRow.subjectMaterialNameListFor({ bridgeDeclaration });
	const globalGuidanceList = bridgeDeclaration.evidenceHooksDeclared.globalGuidance ? bridgeDeclaration.globalGuidanceList.slice() : [];
	if (bridgeDeclaration.evidenceHooksDeclared.nominate || bridgeDeclaration.evidenceHooksDeclared.walkEvidence) {
		return { error: `${moduleName}: ${bridgeDeclaration.bridgeName} declares evidence hooks, whose output is not rebuilt here; extend the rebuild before sampling it` };
	}
	const textSearchVocabulary = graphSeamRulesLib.textSearchVocabularyFor();
	// readSubjectNodes, as the bolt reader answers it: the source standard's records, text nodes and the hub layer excluded, blinded
	const isHubLayerRecord = (oneRecord) => graphSeamRulesLib.HUB_LAYER_LABEL_LIST.some((oneLabel) => oneRecord.labels.indexOf(oneLabel) !== -1);
	const subjectNodeList = baseNodeIndex.sourceRawRecordList
		.filter((oneRecord) => oneRecord.properties._source === sourceStandardName && oneRecord.properties.role !== textSearchVocabulary.embedTextRole && !isHubLayerRecord(oneRecord))
		.map((oneRecord) => graphSeamRulesLib.blindedRecordFor({ record: graphSeamRulesLib.withoutEmbedding(oneRecord), blindingDeclaration: bridgeDeclaration.blindingDeclaration }));
	const subjectNodeByStableId = subjectNodeList.reduce((soFar, oneNode) => Object.assign(soFar, { [oneNode.stableId]: oneNode }), {});
	// readHubCards at the retrieval tier, of the ONE hub
	const shaped = graphSeamRulesLib.shapeHubCardList({ rawRecordList: baseNodeIndex.hubCardRawRecordList.filter((oneRecord) => oneRecord.properties.referenceTier === RETRIEVAL_CARD_TIER && oneRecord.properties.hubName === hubStandardName), referenceTier: RETRIEVAL_CARD_TIER });
	if (shaped.error) {
		return { error: `${moduleName}: shapeHubCardList: ${shaped.error.message}` };
	}
	const cardByStableId = shaped.cardList.reduce((soFar, oneCard) => Object.assign(soFar, { [oneCard.stableId]: oneCard }), {});
	const sampledRecordList = frozenBlock.decisionRecordList
		.filter((oneRecord) => oneRecord.judge !== undefined && oneRecord.judge !== null && Array.isArray(oneRecord.filteredPoolStableIdList))
		.slice()
		.sort((leftRecord, rightRecord) => compareStrings(leftRecord.subjectStableId, rightRecord.subjectStableId) || compareStrings(String(leftRecord.targetKey), String(rightRecord.targetKey)))
		.slice(0, sampleSize);
	const toolSchemaSha256 = toolSchemaSha256For({ predicateRule: bridgeDeclaration.predicateSource.predicateRule });
	const unitList = sampledRecordList.map((oneRecord) => {
		const subjectNode = subjectNodeByStableId[oneRecord.subjectStableId];
		const unitIdentity = { subjectStableId: oneRecord.subjectStableId, targetKey: oneRecord.targetKey, frozenPromptHash: oneRecord.judge.promptHash, judgeModel: oneRecord.judge.judgeModel, rendererVersion: oneRecord.judge.rendererVersion };
		if (subjectNode === undefined) {
			return { ...unitIdentity, error: 'the subject is not among the source records of the stored base block' };
		}
		const sourceElement = {
			name: typeof subjectNode.properties.name === 'string' && subjectNode.properties.name.trim() !== '' ? subjectNode.properties.name : subjectNode.stableId,
			stableId: subjectNode.stableId,
			material: Object.keys(subjectNode.properties)
				.filter((oneName) => subjectMaterialNameList.indexOf(oneName) !== -1)
				.reduce((soFar, oneName) => ({ ...soFar, [oneName]: subjectNode.properties[oneName] }), typeof oneRecord.judgmentPartitionLabel === 'string' ? { [bridgeDeclaration.judgmentPartition.renderedPropertyName]: oneRecord.judgmentPartitionLabel } : {}),
			evidence: { subject: {}, assertion: {} },
			sourceLabelByColumn: {},
			sourceNoteByColumn: {},
		};
		if (variantRow.requiresOwningConstructDefinitionSource) {
			const owningDefinition = owningConstructDefinitionLib.owningConstructDefinitionFor({ subjectNode, subjectNodeByStableId, owningConstructDefinitionSource: bridgeDeclaration.owningConstructDefinitionSource });
			if (owningDefinition.error) {
				return { ...unitIdentity, error: owningDefinition.error.message };
			}
			sourceElement.owningConstructDefinition = owningDefinition.owningConstructDefinition;
			sourceElement.owningConstructDefinitionAbsentReason = owningDefinition.absentReason;
		}
		const missingCardStableId = oneRecord.filteredPoolStableIdList.find((oneStableId) => cardByStableId[oneStableId] === undefined);
		if (missingCardStableId !== undefined) {
			return { ...unitIdentity, error: `pool card ${missingCardStableId} is not among the hub's ${RETRIEVAL_CARD_TIER}-tier cards` };
		}
		const question = evidenceRendererLib.renderQuestion({
			sourceElement,
			candidatePool: oneRecord.filteredPoolStableIdList.map((oneStableId) => ({ card: cardByStableId[oneStableId], seatReason: RETRIEVAL_SEAT_REASON })),
			globalGuidanceList,
			perCandidateNoteByStableId: {},
			promptSegmentList: [],
			judgePromptVariant,
			renderingAllowList: bridgeDeclaration.renderingAllowList,
		});
		if (question.error) {
			return { ...unitIdentity, error: question.error.message };
		}
		return {
			...unitIdentity,
			promptHash: question.promptHash,
			promptHashReproduced: question.promptHash === oneRecord.judge.promptHash,
			renderedRendererVersion: question.rendererVersion,
			toolSchemaSha256,
			cacheModelKey: bridgeDeclaration.blockRecordsJudgeConfig === true ? cacheModelKeyFor({ judgeModel: oneRecord.judge.judgeModel, frozenHeader: frozenBlock.header, toolSchemaSha256 }) : oneRecord.judge.judgeModel,
			systemPrompt: question.systemPrompt,
			userPrompt: question.userPrompt,
			choiceQuestion: question.choiceQuestion === undefined ? null : question.choiceQuestion,
		};
	});
	return { unitList, judgePromptVariant, toolSchemaSha256, frozenToolSchemaSha256: frozenBlock.header.judgeToolSchemaSha256 === undefined ? null : frozenBlock.header.judgeToolSchemaSha256 };
};

module.exports = { renderSampleFor, rawRecordFor, toolSchemaSha256For, cacheModelKeyFor, RETRIEVAL_CARD_TIER, moduleName };
