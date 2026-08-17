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
const { ABSTAIN_TOKEN } = require('./evidenceRenderer');
const { confidenceForCategory, ABSTAIN_CATEGORY, PICK_CATEGORY_LIST } = require('./confidenceBandTable');

// ⟪B2 DEFECT #5 found by the FIRST REAL BATCH-2 JUDGMENTS — RULING SABLE_RIVER 2026-08-17 14:10⟫ The pattern
// gains a capturing group for the NUMBER, because the rule is about the CHOICE and the old check was about
// the whole rationale.
//
// BR-067's own sentence is "a rationale names the CHOICE by hub key + name". Batch 2 died on a rationale that
// did exactly that and was refused anyway: pick ordinal 1, and the only ordinal anywhere in the text was
// ELEVEN — a candidate the judge REJECTED and named while explaining why it ruled it out ("Candidate 11 is the
// organization's own email address value rather than the contact person's"). Naming a rejected candidate by
// number to contrast it is lawful and is GOOD rationale; the gate was refusing the judge for showing its work.
//
// Worse, the fault was UNRECOVERABLE: the re-ask instruction is scoped to the CHOSEN candidate ("name the
// chosen candidate by its hub key and name") while the check was scoped to the whole text, so a compliant
// model could not satisfy it by complying. A bounded retry cannot converge when its instruction is narrower
// than the predicate it must satisfy — which is why this killed a run instead of costing one call.
//
// RULED: refuse ONLY when a matched ordinal EQUALS clientReturn.choice. The same batch proved the gate is
// still needed and still bites — PositionTitle named "Candidate 10", which WAS its pick, was refused,
// re-asked once and recovered clean. The gate's real target and its false positive are separated by exactly
// one question: does the named ordinal equal the pick?
const ORDINAL_RATIONALE_RE = /\b(candidate|option|choice)\s+#?(\d+)\b/gi;

// rationaleNamesOwnChoiceByOrdinal — TRUE only when the rationale refers by NUMBER to the very candidate it
// picked. The regex is /g and therefore stateful, so a fresh exec loop runs per call and lastIndex never
// leaks between judgments (a shared /g regex silently skipping every other match is its own classic fault).
const rationaleNamesOwnChoiceByOrdinal = ({ rationale, choice }) => {
	if (typeof rationale !== 'string' || typeof choice !== 'string') {
		return false;
	}
	const pattern = new RegExp(ORDINAL_RATIONALE_RE.source, 'gi');
	let oneMatch = pattern.exec(rationale);
	while (oneMatch !== null) {
		if (oneMatch[2] === choice) {
			return true;
		}
		oneMatch = pattern.exec(rationale);
	}
	return false;
};

// ⟪RULING 13:15⟫ ABSENT_CATEGORY_MARK — recorded in reportedCategoryOnAbstain when the model omitted the
// category on an abstention. It is a RECORD OF AN ABSENCE, not a category: it never reaches the band table
// (an abstention has confidence null) and it is never a value a model can supply.
const ABSENT_CATEGORY_MARK = 'absent';

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
	const discardedPredicateKeyCount = Object.prototype.hasOwnProperty.call(clientReturn, 'predicate') ? 1 : 0;
	if (mapped.chosenCardStableId === null) {
		// ⟪B2 DEFECT found by the FIRST REAL JUDGMENT — RULING SABLE_RIVER 2026-08-16 (B3, "B2 DEFECT found by the first REAL
		// judgment")⟫ The real client's EVIDENCE tool schema (apps/graph-builder/apps/bridge-maker/lib/llmClient.js:88-99,
		// requireJudgment: true) makes `category` REQUIRED with CATEGORY_ENUM = SELECT_CATEGORY_ENUM minus 'none' — llmClient's
		// own contract reads "a model reports a category only when it IS making a pick — abstain is expressed through
		// choice='NONE', never through a category value". So a real abstention can NEVER arrive as (NONE, none): the schema
		// FORCES a picking category onto it. The judge component takes the client at its stated contract: on NONE the reported
		// category is SCHEMA-FORCED, not a claim — the abstention is recorded as ABSTAIN_CATEGORY and the raw value is
		// PRESERVED (reportedCategoryOnAbstain: on the returned judgment, the frozen record and the forensic record — nothing
		// discarded). A category OUTSIDE the picking set stays refused by name (an unknown token is not schema-forced noise);
		// a PICK carrying ABSTAIN_CATEGORY stays refused below. llmClient.js is byte-untouched (RULING BF1).
		// ⟪B2 DEFECT #4 found by the FIRST REAL BATCH-1 JUDGMENTS — RULING SABLE_RIVER 2026-08-17 13:15⟫ The
		// SAME seam, one step further out. llmClient's select_candidate tool declares `required: ['choice']` —
		// category and rationale are OPTIONAL BY THE SCHEMA'S OWN CONTRACT — and its CATEGORY_ENUM is the
		// picking set with 'none' removed, so the schema offers a model NO WAY to say "none". A model that
		// abstains honestly and omits the category it has nothing to assert therefore arrives here as
		// category: undefined, and the old blanket BR-066 check refused it and killed the build with no
		// re-ask. Batch 0's three abstentions survived only because those returns happened to carry a
		// schema-forced picking category; the omission is permitted on every call, so it fires at random.
		//
		// RULED: on an abstention an ABSENT category is NOT a defect. It normalises to ABSTAIN_CATEGORY and
		// the ABSENCE ITSELF IS THE RECORD — reportedCategoryOnAbstain carries ABSENT_CATEGORY_MARK, never a
		// fabricated category and never a silent null that would be indistinguishable from the model having
		// answered 'none' outright. Three states stay three states.
		//
		// The mark must SURVIVE THE JUDGMENT CACHE. putJudgment stores reportedCategoryOnAbstain in the
		// category slot so a cache hit reconstructs the identical judgment, and a hit re-enters this same
		// function — so ABSENT_CATEGORY_MARK has to be ACCEPTED on the way back in or a cached abstention
		// would be refused by the very code that wrote it, and the frozen block from a cached run would
		// differ from the block from a fresh one. A model can never supply this token itself: llmClient's
		// extractor returns undefined for anything outside CATEGORY_ENUM, so it can only arrive from our own
		// cache.
		const categoryIsAbsent = !isNonBlank(clientReturn.category) || clientReturn.category === ABSENT_CATEGORY_MARK;
		if (!isNonBlank(clientReturn.rationale)) {
			// RULED: an abstention with NO rationale earns the SAME single bounded re-ask as the ordinal case.
			// The flag is what askOnce reads; a second malformed return still refuses by name.
			return { error: refuse.byName({ moduleName, what: `the judge abstained (${ABSTAIN_TOKEN}) with rationale ${clientReturn.rationale === undefined ? 'absent' : 'blank'}`, where: 'an abstention states why nothing matched; it earns ONE bounded re-ask, then is refused (BR-066, RULING 13:15)' }), absentAbstainRationale: true };
		}
		if (!categoryIsAbsent && clientReturn.category !== ABSTAIN_CATEGORY && PICK_CATEGORY_LIST.indexOf(clientReturn.category) === -1) {
			return { error: refuse.byName({ moduleName, what: `the judge abstained (${ABSTAIN_TOKEN}) but reported category '${clientReturn.category}', which is neither '${ABSTAIN_CATEGORY}' nor a picking category (${PICK_CATEGORY_LIST.join(', ')})`, where: `an abstention carries category '${ABSTAIN_CATEGORY}' — or, from the real client's evidence schema, a schema-forced picking category, preserved as reportedCategoryOnAbstain` }) };
		}
		return { chosenCardStableId: null, choice: clientReturn.choice, category: ABSTAIN_CATEGORY, reportedCategoryOnAbstain: categoryIsAbsent ? ABSENT_CATEGORY_MARK : clientReturn.category === ABSTAIN_CATEGORY ? null : clientReturn.category, rationale: clientReturn.rationale, confidence: null, discardedPredicateKeyCount };
	}
	// A PICK is unchanged: it asserts something about a candidate, so it carries both a category and a
	// rationale or it is refused. Only the abstention arm was ever the defect.
	if (!isNonBlank(clientReturn.category) || !isNonBlank(clientReturn.rationale)) {
		return { error: refuse.byName({ moduleName, what: `the judge returned choice '${clientReturn.choice}' with category ${JSON.stringify(clientReturn.category)} / rationale ${clientReturn.rationale === undefined ? 'undefined' : 'blank'}`, where: 'a pick or abstention without category and rationale is refused (BR-066)' }) };
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
	if (!isDebugClient && rationaleNamesOwnChoiceByOrdinal({ rationale: clientReturn.rationale, choice: clientReturn.choice })) {
		return { error: refuse.byName({ moduleName, what: `the judge's rationale names ITS OWN pick by ORDINAL (candidate ${clientReturn.choice}) (${JSON.stringify(clientReturn.rationale.slice(0, 120))})`, where: 'a rationale names the choice by hub key + name; naming a REJECTED candidate by number to contrast it is lawful (BR-067, RULING 14:10)' }), ordinalRationale: true };
	}
	return { chosenCardStableId: mapped.chosenCardStableId, choice: clientReturn.choice, category: clientReturn.category, rationale: clientReturn.rationale, confidence: band.confidence, discardedPredicateKeyCount };
};

// ⟪RULING 13:15⟫ REASK_INSTRUCTION_BY_FAULT — the bounded re-ask is now TWO faults, so the instruction is a
// registry keyed by fault name rather than a branch. Each builds the whole re-ask prompt from the ORIGINAL
// userPrompt, never from the re-asked one, so a second re-ask could not compound instructions even if the
// budget allowed it (it does not). The absent-rationale text must not touch clientReturn.rationale — it is
// undefined in exactly that case, and the ordinal text's .slice would throw.
const REASK_INSTRUCTION_BY_FAULT = Object.freeze({
	// the instruction now matches the predicate EXACTLY — it names the pick's own ordinal and says plainly that
	// referring to OTHER candidates by number is fine. An instruction narrower than its check cannot converge.
	ordinalRationale: ({ question, clientReturn }) => `${question.userPrompt}\n\nRESTATE YOUR RATIONALE: your previous rationale (${JSON.stringify(clientReturn.rationale.slice(0, 200))}) referred to YOUR OWN CHOICE, candidate ${clientReturn.choice}, by NUMBER. Restate the rationale naming the candidate you chose by its hub key and name, never by its number. You may still refer to OTHER candidates by number when explaining why you ruled them out. Keep the same choice unless you have a reason to change it.`,
	absentAbstainRationale: ({ question }) => `${question.userPrompt}\n\nSTATE YOUR REASON: you answered ${ABSTAIN_TOKEN} — none of the candidates — but gave no rationale. State briefly why none of the candidates means the same thing as the source element. Keep the same answer unless you have a reason to change it.`,
});
const REASKABLE_FAULT_NAME_LIST = Object.freeze(Object.keys(REASK_INSTRUCTION_BY_FAULT));
const reaskableFaultNameOf = (judged) => REASKABLE_FAULT_NAME_LIST.find((oneFaultName) => judged[oneFaultName] === true);

const judgeOne = ({ question, judgeClient, judgmentCache, matchForensics, budget, pairKey, generation, debugMark } = {}, callback) => {
	if (!isPlainObject(question) || !Array.isArray(question.renderedPoolStableIdList) || !Array.isArray(question.choiceEnum) || typeof question.promptHash !== 'string') {
		callback(refuse.byName({ moduleName, what: 'question is not a renderQuestion result', where: 'judgeOne takes { question, judgeClient, judgmentCache, matchForensics, budget, pairKey, generation, debugMark }' }).message);
		return;
	}
	// The renderer version comes FROM THE QUESTION, not from a module constant (RULING §11.1: each rendering
	// variant carries its own version). It is half of the judgment-cache key and it is stamped on every
	// forensic record, so a run whose question could not name its renderer would silently file its judgments
	// under another variant's version. NAMED DEVIATION from PLAN §0's "judgeComponent.js is UNCHANGED": no
	// judging behaviour moves — not the ordinal mapping, not ORDINAL_RATIONALE_RE, not the one re-ask, not the
	// abstention normalisation, not the band table. Only the provenance stamp stops being a constant.
	if (typeof question.rendererVersion !== 'string' || question.rendererVersion === '') {
		callback(refuse.byName({ moduleName, what: 'the question carries no rendererVersion', where: 'renderQuestion returns the version of the variant that rendered it; it is the cache key half and the forensic stamp — there is no default' }).message);
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
	const cacheKey = { promptHash: question.promptHash, model: judgeClient.model, rendererVersion: question.rendererVersion };

	// ⟪RULING 14:10, from my own forensic-fidelity note⟫ reaskUserPrompt — the ACCEPTED record logged
	// question.userPrompt, the ORIGINAL, even when the answer it carries was given to the RE-ASK prompt. The
	// trail therefore showed a rationale beside text the judge never saw, and the second attempt's actual
	// question was recoverable from nowhere. The original STAYS in userPrompt (it is the promptHash's preimage
	// and the cache key's basis); the re-ask text rides beside it, null when there was no re-ask, so a reader
	// can always see the text that was actually answered.
	const deliver = ({ judgment, cacheHit, attempts, usage, reaskUserPrompt }) => {
		matchForensics.appendRecord(
			{
				pairKey,
				generation,
				record: {
					promptHash: question.promptHash,
					rendererVersion: question.rendererVersion,
					judgeModel: judgeClient.model,
					decisionAlgorithm: judgeClient.decisionAlgorithm === undefined ? null : judgeClient.decisionAlgorithm,
					systemPrompt: question.systemPrompt,
					userPrompt: question.userPrompt,
					reaskUserPrompt: reaskUserPrompt === undefined ? null : reaskUserPrompt,
					renderedPoolStableIdList: question.renderedPoolStableIdList,
					choice: judgment.choice,
					chosenCardStableId: judgment.chosenCardStableId,
					category: judgment.category,
					reportedCategoryOnAbstain: judgment.reportedCategoryOnAbstain === undefined ? null : judgment.reportedCategoryOnAbstain,
					rationale: judgment.rationale,
					confidence: judgment.confidence,
					cacheHit,
					attempts,
					usage: usage === undefined ? null : usage,
					discardedPredicateKeyCount: judgment.discardedPredicateKeyCount,
					reaskCount: judgment.reaskCount === undefined ? 0 : judgment.reaskCount,
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
		// ⟪B2 DEFECT #2 found by the FIRST REAL JUDGMENTS — RULING SABLE_RIVER 2026-08-16 (B3, "bounded rationale re-ask")⟫ a real
		// model, despite the system prompt, sometimes names its pick by ORDINAL in the rationale (BR-067 refuses that — the
		// rationale must name the hub key + name so it survives any re-rendering). Refusing the whole RUN for prose was
		// disproportionate: the PICK is authoritative through renderedPoolStableIdList + choice. So: on an ordinal-rationale answer
		// the component (1) writes the REFUSED attempt to forensics FIRST (a refusal we cannot read is not evidence — before this
		// ruling the text was lost), (2) RE-ASKS ONCE with the refusal appended to the user prompt, (3) accepts the restated answer
		// (attempts 2 — the ACCEPTED answer is what the cache stores under the ORIGINAL promptHash, so replay stays deterministic),
		// (4) refuses BY NAME a second violation. BR-067 stands; the re-ask is counted (rationaleReaskCount) in the run report.
		const askOnce = ({ userPrompt, reaskCount }, askCallback) => {
			judgeClient.rerank({ systemPrompt: question.systemPrompt, userPrompt, choiceEnum: question.choiceEnum, requireJudgment: true }, (rerankError, clientReturn) => {
				if (rerankError) {
					askCallback(`${moduleName}: the judge refused promptHash ${question.promptHash}: ${rerankError}`);
					return;
				}
				const judged = judgmentFromReturn({ clientReturn, question, isDebugClient });
				const reaskableFaultName = judged.error ? reaskableFaultNameOf(judged) : undefined;
				if (judged.error && reaskableFaultName !== undefined && reaskCount === 0) {
					// the refused first attempt lands in forensics BEFORE the re-ask, marked as such
					matchForensics.appendRecord(
						{
							pairKey,
							generation,
							record: { promptHash: question.promptHash, rendererVersion: question.rendererVersion, judgeModel: judgeClient.model, decisionAlgorithm: judgeClient.decisionAlgorithm === undefined ? null : judgeClient.decisionAlgorithm, systemPrompt: question.systemPrompt, userPrompt, renderedPoolStableIdList: question.renderedPoolStableIdList, choice: clientReturn.choice, chosenCardStableId: null, category: clientReturn.category, rationale: clientReturn.rationale, confidence: null, cacheHit: false, attempts: clientReturn.attempts, usage: clientReturn.usage === undefined ? null : clientReturn.usage, refusedAttempt: judged.error.message, reaskFollows: true },
						},
						(forensicsError) => {
							if (forensicsError) {
								askCallback(`${moduleName}: forensic record of the refused attempt failed for promptHash ${question.promptHash}: ${forensicsError}`);
								return;
							}
							budget.judgmentCountSoFar += 1;
							askOnce({ userPrompt: REASK_INSTRUCTION_BY_FAULT[reaskableFaultName]({ question, clientReturn }), reaskCount: 1 }, askCallback);
						},
					);
					return;
				}
				if (judged.error) {
					askCallback(reaskCount === 0 ? judged.error.message : `${judged.error.message} — after ONE re-ask (BR-067; the first attempt is in forensics)`);
					return;
				}
				askCallback('', { judged, clientReturn, reaskCount, answeredUserPrompt: userPrompt });
			});
		};
		askOnce({ userPrompt: question.userPrompt, reaskCount: 0 }, (askError, asked) => {
			if (askError) {
				callback(askError);
				return;
			}
			const { clientReturn, reaskCount } = asked;
			const judged = { ...asked.judged, reaskCount };
			// null when no re-ask happened: the answered prompt IS question.userPrompt and repeating it would
			// double the record's bulk to say nothing
			const reaskUserPrompt = asked.answeredUserPrompt === question.userPrompt ? null : asked.answeredUserPrompt;
			if (isDebugClient) {
				deliver({ judgment: judged, cacheHit: false, attempts: clientReturn.attempts, usage: clientReturn.usage, reaskUserPrompt });
				return;
			}
			// decided = persisted: putJudgment BEFORE delivery, exactly the payload the cache requires
			judgmentCache.putJudgment(
				{ ...cacheKey, generation, judgment: { choice: judged.choice, category: judged.reportedCategoryOnAbstain === undefined || judged.reportedCategoryOnAbstain === null ? judged.category : judged.reportedCategoryOnAbstain, rationale: judged.rationale, chosenStableId: judged.chosenCardStableId } },
				(putError) => {
					if (putError) {
						callback(`${moduleName}: putJudgment FAILED for promptHash ${question.promptHash} (FATAL, never a warning): ${putError}`);
						return;
					}
					deliver({ judgment: judged, cacheHit: false, attempts: clientReturn.attempts, usage: clientReturn.usage, reaskUserPrompt });
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

module.exports = { judgeOne, mapChoiceToStableId, judgmentFromReturn, ORDINAL_RATIONALE_RE, rationaleNamesOwnChoiceByOrdinal, ABSENT_CATEGORY_MARK, REASK_INSTRUCTION_BY_FAULT, moduleName };
