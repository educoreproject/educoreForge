'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// subjectJudge.js — ONE subject, ONE pool, rendered and judged exactly as bridge-framework.js STEP 7 does it for a
// graphLabel (derived) subject: no asserting rows, so the merged evidence, labels and notes are empty; no nominate
// or walkEvidence hook (refused by name when a plugin declares one, because this replica does not carry them); the
// declared global guidance; the pool sorted by stableId (classification.sortByStableId) before rendering; the
// prompt identifier scan when declared; then judgeComponent.judgeOne with the run's cache, forensics and identity.
//
// renderSubjectQuestion is pure and is what proves A0 reproduces: its promptHash must equal the gold record's.

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const BRIDGE_LIB = path.join(TREE_ROOT, 'lib', 'bridge-framework');
const evidenceRendererLib = require(path.join(BRIDGE_LIB, 'evidenceRenderer'));
const classificationLib = require(path.join(BRIDGE_LIB, 'classification'));
const judgeComponentLib = require(path.join(BRIDGE_LIB, 'judgeComponent'));
const promptIdentifierScanLib = require(path.join(BRIDGE_LIB, 'promptIdentifierScan'));

// sourceElementFor — the framework's sourceElement for a subject with no asserting rows (judgeOneTask, STEP 7)
const sourceElementFor = ({ runContext, subjectStableId }) => {
	const subjectNode = runContext.subjectNodeByStableId[subjectStableId];
	if (subjectNode === undefined) {
		return { error: `${moduleName}: subject ${subjectStableId} is not a source node in the graph read this run` };
	}
	return {
		sourceElement: {
			name: typeof subjectNode.properties.name === 'string' && subjectNode.properties.name.trim() !== '' ? subjectNode.properties.name : subjectNode.stableId,
			stableId: subjectNode.stableId,
			material: Object.keys(subjectNode.properties)
				.filter((oneName) => runContext.subjectMaterialNameList.indexOf(oneName) !== -1)
				.reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: subjectNode.properties[oneName] }), {}),
			evidence: { subject: {}, assertion: {} },
			sourceLabelByColumn: {},
			sourceNoteByColumn: {},
		},
	};
};

const renderSubjectQuestion = ({ runContext, subjectStableId, poolCardStableIdList }) => {
	const hooksDeclared = runContext.bridgeDeclaration.evidenceHooksDeclared;
	if (hooksDeclared.nominate || hooksDeclared.walkEvidence) {
		return { error: `${moduleName}: plugin ${runContext.bridgeDeclaration.bridgeName} declares nominate or walkEvidence hooks; this replica of STEP 7 does not run them, so its prompts would not be the bridge's` };
	}
	const missingCardStableId = poolCardStableIdList.find((oneStableId) => runContext.cardByStableId[oneStableId] === undefined);
	if (missingCardStableId !== undefined) {
		return { error: `${moduleName}: pool names card ${missingCardStableId}, which is not a property-tier card read this run` };
	}
	const built = sourceElementFor({ runContext, subjectStableId });
	if (built.error) {
		return built;
	}
	const poolCardList = classificationLib.sortByStableId(poolCardStableIdList.map((oneStableId) => runContext.cardByStableId[oneStableId]));
	const candidatePool = poolCardList.map((oneCard) => ({ card: oneCard, seatReason: 'retrieval' }));
	const globalGuidanceList = hooksDeclared.globalGuidance ? runContext.bridgeDeclaration.globalGuidanceList.slice() : [];
	const question = evidenceRendererLib.renderQuestion({ sourceElement: built.sourceElement, candidatePool, globalGuidanceList, perCandidateNoteByStableId: {}, promptSegmentList: [], judgePromptVariant: runContext.judgePromptVariant, renderingAllowList: runContext.bridgeDeclaration.renderingAllowList });
	if (question.error) {
		return { error: `${moduleName}: ${question.error.message}` };
	}
	if (runContext.compiledPromptScan !== null) {
		const { hit } = promptIdentifierScanLib.scanSurfaces({ compiledScan: runContext.compiledPromptScan, surfaceTextByName: promptIdentifierScanLib.questionSurfaceTextByName({ predicateRule: runContext.bridgeDeclaration.predicateSource.predicateRule, question }) });
		if (hit !== null) {
			return { error: `${moduleName}: prompt identifier scan hit for subject ${subjectStableId}: pattern '${hit.patternName}' matched '${hit.matchedText}' in the ${hit.surfaceName}` };
		}
	}
	return { question };
};

// judgeSubject — callback(errString, { judged, question }). judgeComponent decides cache hit or live call.
const judgeSubject = ({ runContext, judgeRunState, subjectStableId, poolCardStableIdList }, callback) => {
	const rendered = renderSubjectQuestion({ runContext, subjectStableId, poolCardStableIdList });
	if (rendered.error) {
		callback(rendered.error);
		return;
	}
	const question = rendered.question;
	const reaskPromptRefusalFor = (reaskUserPrompt) => {
		if (runContext.compiledPromptScan === null) {
			return '';
		}
		const { hit } = promptIdentifierScanLib.scanSurfaces({ compiledScan: runContext.compiledPromptScan, surfaceTextByName: { reaskUserPrompt } });
		return hit === null ? '' : `${moduleName}: prompt identifier scan hit on the re-ask for subject ${subjectStableId}`;
	};
	judgeComponentLib.judgeOne(
		{
			question,
			judgeClient: judgeRunState.judgeClient,
			judgmentCache: judgeRunState.judgmentCache,
			matchForensics: judgeRunState.matchForensics,
			budget: judgeRunState.budget,
			pairKey: runContext.pairKey,
			generation: runContext.generation,
			debugMark: runContext.debugMark,
			reaskPromptRefusalFor,
			judgeConfigCacheDigest: runContext.judgeConfigCacheDigest,
		},
		(judgeError, judged) => {
			if (judgeError) {
				callback(`${moduleName}: subject ${subjectStableId}: ${judgeError}`);
				return;
			}
			callback('', { judged, question });
		},
	);
};

module.exports = { renderSubjectQuestion, judgeSubject, sourceElementFor, moduleName };
