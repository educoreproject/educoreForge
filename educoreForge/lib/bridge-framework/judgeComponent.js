'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// judgeComponent.js — judgeOne: frame → cache → ask → verify → record (SPEC-bridgeFramework-v1.md §5.6;
// RULINGS BF1, R5; BR-065..069, BR-120, BR-122). FRAMEWORK-OWNED; a plugin cannot reach it.
//
//   judgeOne({ question, judgeClient, judgmentCache, matchForensics, budget, pairKey, generation, debugMark }, cb)
//     question = renderQuestion's result ({ systemPrompt, userPrompt, promptHash, renderedPoolStableIdList,
//                choiceEnum }) — the pool ALREADY sorted by stableId by the caller
//     → { chosenCardStableId | null, choice, category, rationale, confidence | null, promptHash, cacheHit,
//         judgeModel, discardedPredicateKeyCount, attempts, usage }
//
// The judge's REAL return is llmClient/debugJudge's { choice, model, attempts, category, rationale, usage, … }
// where `choice` is an ORDINAL string from choiceEnum ('1'..'N' | 'NONE'); there is NO predicate slot and
// none is added (RULING BF1). This component maps the ordinal through renderedPoolStableIdList — the ONE
// authority — to chosenCardStableId; 'NONE' is an abstention (null). A choice outside choiceEnum, or a
// category / rationale absent or blank, is REFUSED by name, never defaulted; a stray `predicate` key on the
// return is DISCARDED and COUNTED (BG-P6 b). confidence is DERIVED from category by CONFIDENCE_BAND_TABLE.
//
// Cache (BR-069, BR-120): key (promptHash, model, rendererVersion); a hit is RE-VERIFIED (its chosenStableId
// present in the CURRENT rendered list) else refused and re-asked; putJudgment BEFORE delivery with exactly
// { choice, category, rationale, chosenStableId } (what judgment-cache.js putJudgment REQUIRES); a put
// failure is FATAL. A DEBUG client (debugMark set) reads NO cache and writes NO row (the hazard debugJudge.js
// names: "no debug values in the cache"). Forensics: matchForensics.appendRecord with the prompt inline,
// renderedPoolStableIdList beside the ordinal, usage, latency-free (no clock in the framework — BG-DET).
// Budget: a DECLARED per-run maxJudgmentCount HALTS by name; the counter lives in the caller's run scope.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { RENDERER_VERSION, ABSTAIN_TOKEN } = require('./evidenceRenderer');
const { confidenceForCategory, ABSTAIN_CATEGORY } = require('./confidenceBandTable');

const ORDINAL_RATIONALE_RE = /\b(candidate|option|choice)\s+#?\d+\b/i;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonBlank = (value) => typeof value === 'string' && value.trim() !== '';

// mapChoiceToStableId — the ordinal → the rendered list; refuses anything outside choiceEnum
const mapChoiceToStableId = ({ choice, choiceEnum, renderedPoolStableIdList }) => {
	if (typeof choice !== 'string' || choiceEnum.indexOf(choice) === -1) {
		return { error: refuse.byName({ moduleName, what: `the judge returned choice ${JSON.stringify(choice)}, which is not in choiceEnum [${choiceEnum.join(', ')}]`, where: 'an ordinal outside the rendered pool (or a non-ordinal) is refused, never clamped (BR-066)' }) };
	}
	if (choice === ABSTAIN_TOKEN) {
		return { chosenCardStableId: null };
	}
	const ordinal = Number(choice);
	const chosenCardStableId = renderedPoolStableIdList[ordinal - 1];
	if (typeof chosenCardStableId !== 'string') {
		return { error: refuse.byName({ moduleName, what: `ordinal ${choice} names no rendered candidate (${renderedPoolStableIdList.length} rendered)`, where: 'renderedPoolStableIdList is the one authority for the pick' }) };
	}
	return { chosenCardStableId };
};

// judgmentFromReturn — validate the client's return and derive the record fields
const judgmentFromReturn = ({ clientReturn, question, isDebugClient }) => {
	if (!isPlainObject(clientReturn)) {
		return { error: refuse.byName({ moduleName, what: `the judge client returned ${JSON.stringify(clientReturn)}`, where: 'rerank calls back { choice, model, attempts, category, rationale, usage, … }' }) };
	}
	const mapped = mapChoiceToStableId({ choice: clientReturn.choice, choiceEnum: question.choiceEnum, renderedPoolStableIdList: question.renderedPoolStableIdList });
	if (mapped.error) {
		return { error: mapped.error };
	}
	if (!isNonBlank(clientReturn.category) || !isNonBlank(clientReturn.rationale)) {
		return { error: refuse.byName({ moduleName, what: `the judge returned choice '${clientReturn.choice}' with category ${JSON.stringify(clientReturn.category)} / rationale ${clientReturn.rationale === undefined ? 'undefined' : 'blank'}`, where: 'a pick or abstention without category and rationale is refused (BR-066)' }) };
	}
	const discardedPredicateKeyCount = Object.prototype.hasOwnProperty.call(clientReturn, 'predicate') ? 1 : 0;
	if (mapped.chosenCardStableId === null) {
		if (clientReturn.category !== ABSTAIN_CATEGORY) {
			return { error: refuse.byName({ moduleName, what: `the judge abstained (${ABSTAIN_TOKEN}) but reported category '${clientReturn.category}'`, where: `an abstention carries category '${ABSTAIN_CATEGORY}'` }) };
		}
		return { chosenCardStableId: null, choice: clientReturn.choice, category: clientReturn.category, rationale: clientReturn.rationale, confidence: null, discardedPredicateKeyCount };
	}
	if (clientReturn.category === ABSTAIN_CATEGORY) {
		return { error: refuse.byName({ moduleName, what: `the judge picked ordinal ${clientReturn.choice} but reported category '${ABSTAIN_CATEGORY}'`, where: 'a pick carries a picking category' }) };
	}
	const band = confidenceForCategory(clientReturn.category);
	if (band.error) {
		return { error: refuse.byName({ moduleName, what: band.error, where: 'CONFIDENCE_BAND_TABLE is the closed set of categories' }) };
	}
	// the rationale must name the choice by hub key + name, never by ordinal — checked lexically for a REAL
	// judge; the DEBUG double's rationale self-announces INVALID_DEBUG and names ordinals BY DESIGN
	// (debugJudge.js is UNCHANGED, RULING BF1) — exempt, and every debug edge is flagged anyway
	if (!isDebugClient && ORDINAL_RATIONALE_RE.test(clientReturn.rationale)) {
		return { error: refuse.byName({ moduleName, what: `the judge's rationale names the pick by ORDINAL (${JSON.stringify(clientReturn.rationale.slice(0, 120))})`, where: 'a rationale names the choice by hub key + name (BR-067)' }) };
	}
	return { chosenCardStableId: mapped.chosenCardStableId, choice: clientReturn.choice, category: clientReturn.category, rationale: clientReturn.rationale, confidence: band.confidence, discardedPredicateKeyCount };
};

const judgeOne = ({ question, judgeClient, judgmentCache, matchForensics, budget, pairKey, generation, debugMark } = {}, callback) => {
	if (!isPlainObject(question) || !Array.isArray(question.renderedPoolStableIdList) || !Array.isArray(question.choiceEnum) || typeof question.promptHash !== 'string') {
		callback(refuse.byName({ moduleName, what: 'question is not a renderQuestion result', where: 'judgeOne takes { question, judgeClient, judgmentCache, matchForensics, budget, pairKey, generation, debugMark }' }).message);
		return;
	}
	if (!judgeClient || typeof judgeClient.rerank !== 'function' || typeof judgeClient.model !== 'string') {
		callback(refuse.byName({ moduleName, what: 'judgeClient is absent or does not answer rerank / carry model', where: 'spec.inferenceConfig.llmClient — the real Anthropic client or the debug judge (build.js resolveInferenceConfig)' }).message);
		return;
	}
	if (!isPlainObject(budget) || !Number.isInteger(budget.maxJudgmentCount) || budget.maxJudgmentCount < 1 || typeof budget.judgmentCountSoFar !== 'number') {
		callback(refuse.byName({ moduleName, what: `budget is ${JSON.stringify(budget)}`, where: 'budget = { maxJudgmentCount (declared, ≥1), judgmentCountSoFar } — a run declares its ceiling; there is no default' }).message);
		return;
	}
	const isDebugClient = debugMark !== undefined && debugMark !== null;
	if (!isDebugClient && (!judgmentCache || typeof judgmentCache.getJudgment !== 'function' || typeof judgmentCache.putJudgment !== 'function')) {
		callback(refuse.byName({ moduleName, what: 'judgmentCache is absent or lacks getJudgment/putJudgment', where: 'a real-judge run needs the judgment cache (BR-069)' }).message);
		return;
	}
	if (!matchForensics || typeof matchForensics.appendRecord !== 'function') {
		callback(refuse.byName({ moduleName, what: 'matchForensics is absent or lacks appendRecord', where: 'every judgment lands in the forensic trail (BR-122)' }).message);
		return;
	}
	const cacheKey = { promptHash: question.promptHash, model: judgeClient.model, rendererVersion: RENDERER_VERSION };

	const deliver = ({ judgment, cacheHit, attempts, usage }) => {
		matchForensics.appendRecord(
			{
				pairKey,
				generation,
				record: {
					promptHash: question.promptHash,
					rendererVersion: RENDERER_VERSION,
					judgeModel: judgeClient.model,
					decisionAlgorithm: judgeClient.decisionAlgorithm === undefined ? null : judgeClient.decisionAlgorithm,
					systemPrompt: question.systemPrompt,
					userPrompt: question.userPrompt,
					renderedPoolStableIdList: question.renderedPoolStableIdList,
					choice: judgment.choice,
					chosenCardStableId: judgment.chosenCardStableId,
					category: judgment.category,
					rationale: judgment.rationale,
					confidence: judgment.confidence,
					cacheHit,
					attempts,
					usage: usage === undefined ? null : usage,
					discardedPredicateKeyCount: judgment.discardedPredicateKeyCount,
				},
			},
			(forensicsError) => {
				if (forensicsError) {
					callback(`${moduleName}: forensic record failed for promptHash ${question.promptHash}: ${forensicsError}`);
					return;
				}
				callback('', { ...judgment, promptHash: question.promptHash, cacheHit, judgeModel: judgeClient.model, attempts, usage: usage === undefined ? null : usage });
			},
		);
	};

	const askLive = () => {
		if (budget.judgmentCountSoFar >= budget.maxJudgmentCount) {
			callback(refuse.byName({ moduleName, what: `the run's declared maxJudgmentCount (${budget.maxJudgmentCount}) is reached before promptHash ${question.promptHash}`, where: 'the budget guard HALTS the run by name; it never trims the pool or the subject list (BR-069, BR-120)' }).message);
			return;
		}
		budget.judgmentCountSoFar += 1;
		judgeClient.rerank({ systemPrompt: question.systemPrompt, userPrompt: question.userPrompt, choiceEnum: question.choiceEnum, requireJudgment: true }, (rerankError, clientReturn) => {
			if (rerankError) {
				callback(`${moduleName}: the judge refused promptHash ${question.promptHash}: ${rerankError}`);
				return;
			}
			const judged = judgmentFromReturn({ clientReturn, question, isDebugClient });
			if (judged.error) {
				callback(judged.error.message);
				return;
			}
			if (isDebugClient) {
				deliver({ judgment: judged, cacheHit: false, attempts: clientReturn.attempts, usage: clientReturn.usage });
				return;
			}
			// decided = persisted: putJudgment BEFORE delivery, exactly the payload the cache requires
			judgmentCache.putJudgment(
				{ ...cacheKey, generation, judgment: { choice: judged.choice, category: judged.category, rationale: judged.rationale, chosenStableId: judged.chosenCardStableId } },
				(putError) => {
					if (putError) {
						callback(`${moduleName}: putJudgment FAILED for promptHash ${question.promptHash} (FATAL, never a warning): ${putError}`);
						return;
					}
					deliver({ judgment: judged, cacheHit: false, attempts: clientReturn.attempts, usage: clientReturn.usage });
				},
			);
		});
	};

	if (isDebugClient) {
		askLive();
		return;
	}
	judgmentCache.getJudgment(cacheKey, (getError, cached) => {
		if (getError) {
			callback(`${moduleName}: getJudgment failed for promptHash ${question.promptHash}: ${getError}`);
			return;
		}
		if (!cached || cached.judgment === null || cached.judgment === undefined) {
			askLive();
			return;
		}
		const remembered = cached.judgment;
		// a hit is RE-VERIFIED: the remembered chosenStableId must be in the CURRENT rendered list (or null with NONE)
		const stillValid =
			(remembered.chosenStableId === null && remembered.choice === ABSTAIN_TOKEN) ||
			(typeof remembered.chosenStableId === 'string' && question.renderedPoolStableIdList[Number(remembered.choice) - 1] === remembered.chosenStableId);
		if (!stillValid) {
			callback(refuse.byName({ moduleName, what: `cache hit for promptHash ${question.promptHash} remembers chosenStableId ${JSON.stringify(remembered.chosenStableId)} at ordinal ${remembered.choice}, which is not the CURRENT rendered candidate`, where: 'a stale hit is refused, never served (SPEC §5.6 step 2)' }).message);
			return;
		}
		const judged = judgmentFromReturn({ clientReturn: { choice: remembered.choice, category: remembered.category, rationale: remembered.rationale, model: judgeClient.model, attempts: 0 }, question, isDebugClient: false });
		if (judged.error) {
			callback(judged.error.message);
			return;
		}
		deliver({ judgment: judged, cacheHit: true, attempts: 0, usage: null });
	});
};

module.exports = { judgeOne, mapChoiceToStableId, judgmentFromReturn, ORDINAL_RATIONALE_RE, moduleName };
