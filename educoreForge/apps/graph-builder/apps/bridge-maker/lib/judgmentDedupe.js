'use strict';

// judgmentDedupe.js — STRUCTURAL DEDUPE FAN-OUT for the evidence bridges (p9-judgmentPersistence,
// 2026-07-31; ⟪TQ RULING⟫ dedupe is for EVERYONE, not just SIF — this module is the shared seam,
// and a bridge opts in by supplying a judgmentKey hook).
//
// THE IDEA: a bridge may declare an OPTIONAL judgmentKey hook —
//     (sourceElement, callback(errString, keyOrNull))            (R7: callback-shaped)
// — mapping a source element to a structural-identity string, or null (null = judge individually).
// Sources sharing a key are judged ONCE: the FIRST in deterministic source order is the
// REPRESENTATIVE; its verdict fans out to every member. The fanned-out entries are HONEST — each
// non-representative member's frozen-evidence entry carries judgedVia: 'dedupe:<key>' plus the
// representative's sourceStableId, and REFERENCES the representative's evidencePackage rather than
// duplicating it (the representative's own entry, addressable by representativeSourceStableId,
// holds the package).
//
// QUALITY IS UNTOUCHABLE (⟪TQ RULING, 2026-07-31⟫): dedupe never changes WHAT is judged — the
// representative's prompt is the full, untruncated prompt it would have received anyway; members
// receive that judgment only because the bridge's own hook asserted they share the structural
// identity the judgment is about. A hook that cannot assert that returns null and the member is
// judged individually, at full price.
//
// DETERMINISM: representative selection is first-in-source-order; the per-source output array is
// assembled in SOURCE ORDER; the hook runs over sources in ascending index order (boundedRunner at
// concurrency 1 — iterative, stack-safe over 15k+ synchronous hook calls). Identical inputs =>
// byte-identical frozen blocks across reruns.
//
// THE PER-SOURCE RESULT CONTRACT this module fans out (produced by every evidence bridge's oneItem):
//     { decision:    { source: {stableId, role}, abstain, abstainReason, targetKey, chosenStableId,
//                      retrievalRank, cosineScore },
//       frozenEntry: { sourceStableId, evidencePackage, judgment },
//       judgeMeta:   cachedJudgment.js's meta ({ promptHash, judgmentPayload, model, ... }) }
//
// FORENSICS: fanOutJudgedResults also writes one match-forensics record per fanned-out member
// (judgedVia 'dedupe:<key>', representative named, usage null — no spend occurred), LOUD BUT
// NONFATAL exactly as cachedJudgment.js's own records are: the forensic story must be complete per
// source element, but forensics are evidence, not a gate.
//
// House style: callback(errString, result) with '' on success; refuse-by-name (polyArch2 §6); no
// async/await, no try/catch control flow; camelCase.

const boundedRunner = require('./boundedRunner');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF module functions ============================================================

// planJudgmentGroups — resolve every source's judgmentKey and plan WHO gets judged.
//   ({ sourceNodes, judgmentKeyHook }, callback(err, plan))
//     judgmentKeyHook  null (no dedupe — every source judged individually) or the hook above.
//     plan = {
//       judgeIndexes             source indexes to actually judge, ascending (representatives +
//                                every null-key source);
//       memberPlanBySourceIndex  { <sourceIndex>: { key, representativeIndex } } for every
//                                NON-representative member (fan-out targets only);
//       dedupedCount             how many judgments the plan avoids;
//       sharedGroupCount         how many keys have 2+ members (groups that actually share);
//     }
const planJudgmentGroups = ({ sourceNodes, judgmentKeyHook = null } = {}, callback) => {
	if (!Array.isArray(sourceNodes)) {
		callback(`${moduleName}.planJudgmentGroups: sourceNodes is required and must be an array.`);
		return;
	}
	if (judgmentKeyHook !== null && typeof judgmentKeyHook !== 'function') {
		callback(
			`${moduleName}.planJudgmentGroups: judgmentKeyHook must be a function or null (got ` +
				`${typeof judgmentKeyHook}) — there is no default hook.`,
		);
		return;
	}

	// no hook -> no dedupe: every source is judged individually, plan is the identity.
	if (judgmentKeyHook === null) {
		callback('', {
			judgeIndexes: sourceNodes.map((ignored, oneIndex) => oneIndex),
			memberPlanBySourceIndex: {},
			dedupedCount: 0,
			sharedGroupCount: 0,
		});
		return;
	}

	// resolve every key in ascending source order — concurrency 1 keeps the hook calls strictly
	// ordered AND stack-safe when the hook answers synchronously (boundedRunner's own latch).
	boundedRunner(
		{
			items: sourceNodes,
			concurrencyLimit: 1,
			oneItem: (oneSource, sourceIndex, itemDone) =>
				judgmentKeyHook(oneSource, (hookErr, keyOrNull) => {
					if (hookErr) {
						itemDone(
							`${moduleName}.planJudgmentGroups: judgmentKey hook failed for source index ` +
								`${sourceIndex} (${(oneSource && oneSource.stableId) || 'unnamed'}): ${hookErr}`,
						);
						return;
					}
					if (keyOrNull !== null && (typeof keyOrNull !== 'string' || keyOrNull.trim() === '')) {
						itemDone(
							`${moduleName}.planJudgmentGroups: judgmentKey hook returned ` +
								`${JSON.stringify(keyOrNull)} for source index ${sourceIndex} ` +
								`(${(oneSource && oneSource.stableId) || 'unnamed'}) — a key must be a non-empty ` +
								`string or null (null = judge individually); there is no default.`,
						);
						return;
					}
					itemDone('', keyOrNull);
				}),
		},
		(runErr, out) => {
			if (runErr) {
				callback(runErr);
				return;
			}
			const keys = out.results;
			const representativeIndexByKey = {};
			const memberCountByKey = {};
			const judgeIndexes = [];
			const memberPlanBySourceIndex = {};
			keys.forEach((oneKey, oneIndex) => {
				if (oneKey === null) {
					judgeIndexes.push(oneIndex);
					return;
				}
				if (representativeIndexByKey[oneKey] === undefined) {
					representativeIndexByKey[oneKey] = oneIndex; // FIRST in source order — deterministic
					memberCountByKey[oneKey] = 1;
					judgeIndexes.push(oneIndex);
					return;
				}
				memberCountByKey[oneKey] += 1;
				memberPlanBySourceIndex[oneIndex] = {
					key: oneKey,
					representativeIndex: representativeIndexByKey[oneKey],
				};
			});
			const dedupedCount = Object.keys(memberPlanBySourceIndex).length;
			const sharedGroupCount = Object.keys(memberCountByKey).filter(
				(oneKey) => memberCountByKey[oneKey] > 1,
			).length;
			callback('', { judgeIndexes, memberPlanBySourceIndex, dedupedCount, sharedGroupCount });
		},
	);
};

// fanOutJudgedResults — assemble the FULL per-source result array (source order) from the judged
// representatives + the plan, stamping every fanned-out member honestly, and writing one forensic
// record per member (loud-but-nonfatal).
//   ({ sourceNodes, judgeIndexes, memberPlanBySourceIndex, judgedResults,
//      matchForensics?, pairKey?, generation?, rendererVersion? }, callback(err, { perSourceResults }))
//     judgedResults[j] is the oneItem result for sourceNodes[judgeIndexes[j]] (boundedRunner's
//     by-index contract, unchanged).
const fanOutJudgedResults = (
	{
		sourceNodes,
		judgeIndexes,
		memberPlanBySourceIndex,
		judgedResults,
		matchForensics = null,
		pairKey = null,
		generation = null,
		rendererVersion = null,
	} = {},
	callback,
) => {
	if (!Array.isArray(sourceNodes) || !Array.isArray(judgeIndexes) || !Array.isArray(judgedResults)) {
		callback(`${moduleName}.fanOutJudgedResults: sourceNodes, judgeIndexes and judgedResults must be arrays.`);
		return;
	}
	if (judgedResults.length !== judgeIndexes.length) {
		callback(
			`${moduleName}.fanOutJudgedResults: judgedResults carries ${judgedResults.length} result(s) ` +
				`for ${judgeIndexes.length} planned judgment(s) — the two must correspond 1:1 by index; ` +
				`there is no partial fan-out.`,
		);
		return;
	}

	const resultBySourceIndex = {};
	judgeIndexes.forEach((oneSourceIndex, judgedSlot) => {
		resultBySourceIndex[oneSourceIndex] = judgedResults[judgedSlot];
	});

	const perSourceResults = new Array(sourceNodes.length);
	const memberRecords = []; // forensic records for fanned-out members, written after assembly
	let assemblyFault = '';
	sourceNodes.forEach((oneSource, oneIndex) => {
		if (assemblyFault) {
			return;
		}
		const direct = resultBySourceIndex[oneIndex];
		if (direct) {
			perSourceResults[oneIndex] = direct;
			return;
		}
		const memberPlan = (memberPlanBySourceIndex || {})[oneIndex];
		if (!memberPlan) {
			assemblyFault =
				`${moduleName}.fanOutJudgedResults: source index ${oneIndex} ` +
				`(${(oneSource && oneSource.stableId) || 'unnamed'}) is neither judged nor planned as a ` +
				`member — the plan does not cover every source; there is no default.`;
			return;
		}
		const representativeResult = resultBySourceIndex[memberPlan.representativeIndex];
		const representativeSource = sourceNodes[memberPlan.representativeIndex];
		if (!representativeResult || !representativeResult.decision || !representativeResult.frozenEntry) {
			assemblyFault =
				`${moduleName}.fanOutJudgedResults: member source index ${oneIndex} points at ` +
				`representative index ${memberPlan.representativeIndex}, whose judged result is missing or ` +
				`malformed — a member can only fan out from a complete representative judgment.`;
			return;
		}
		const representativeDecision = representativeResult.decision;
		const representativeJudgment = representativeResult.frozenEntry.judgment;
		const judgedVia = `dedupe:${memberPlan.key}`;
		// the member's decision: the representative's verdict, honestly re-addressed to this source.
		perSourceResults[oneIndex] = {
			decision: {
				source: { stableId: oneSource.stableId, role: oneSource.role },
				abstain: representativeDecision.abstain,
				abstainReason: representativeDecision.abstainReason,
				targetKey: representativeDecision.targetKey,
				chosenStableId: representativeDecision.chosenStableId,
				retrievalRank: representativeDecision.retrievalRank,
				cosineScore: representativeDecision.cosineScore,
			},
			// the member's frozen evidence: NO duplicated evidencePackage — it REFERENCES the
			// representative's entry (by representativeSourceStableId), and says so by name.
			frozenEntry: {
				sourceStableId: oneSource.stableId,
				judgedVia,
				representativeSourceStableId: representativeSource.stableId,
				judgment: { ...representativeJudgment },
			},
		};
		if (matchForensics) {
			const representativeMeta = representativeResult.judgeMeta || {};
			const representativePayload = representativeMeta.judgmentPayload || {};
			memberRecords.push({
				timestamp: new Date().toISOString(),
				sourceStableId: oneSource.stableId || null,
				sourceName: oneSource.name || null,
				promptHash: representativeMeta.promptHash || null, // the REPRESENTATIVE's prompt — no own prompt exists
				promptText: null,
				model: representativeMeta.model || null,
				rendererVersion: rendererVersion || null,
				generation: generation || null,
				judgedVia,
				representativeSourceStableId: representativeSource.stableId || null,
				response: {
					choice: representativePayload.choice !== undefined ? representativePayload.choice : null,
					category: representativeJudgment ? representativeJudgment.category : null,
					rationale: representativeJudgment ? representativeJudgment.rationale : null,
					stopReason: null,
				},
				usage: null, // a fan-out spends nothing — usage null, never a fabricated number
				retries: null,
				latencyMs: 0,
				candidatePool: null,
			});
		}
	});
	if (assemblyFault) {
		callback(assemblyFault);
		return;
	}

	if (!matchForensics || memberRecords.length === 0) {
		callback('', { perSourceResults });
		return;
	}

	// forensic member records — LOUD BUT NONFATAL, appended in member order (concurrency 1 keeps
	// the trail's line order deterministic); a failed append logs and continues, never errors out.
	boundedRunner(
		{
			items: memberRecords,
			concurrencyLimit: 1,
			oneItem: (oneRecord, recordIndex, itemDone) => {
				void recordIndex;
				matchForensics.appendRecord({ pairKey, generation, record: oneRecord }, (appendErr) => {
					if (appendErr) {
						const { xLog } = process.global;
						xLog.error(
							`[${moduleName}] FORENSIC LOG WRITE FAILED for fanned-out member ` +
								`${oneRecord.sourceStableId} (run continues): ${appendErr}`,
						);
					}
					itemDone('', { ok: !appendErr });
				});
			},
		},
		() => callback('', { perSourceResults }),
	);
};

// END OF module functions ============================================================

module.exports = { planJudgmentGroups, fanOutJudgedResults };
