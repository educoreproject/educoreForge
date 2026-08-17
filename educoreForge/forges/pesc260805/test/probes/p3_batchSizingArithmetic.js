#!/usr/bin/env node
'use strict';

// p3_batchSizingArithmetic.js — LUNAR_PRISM (P3), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// **STATE THE ARITHMETIC BEFORE YOU SPEND.** SABLE_RIVER's P3 GO, condition 2: "SIZE IT FROM THE
// MEASURED JUDGED SHARE, not from a guess — the B4 lesson is that --limit counts SOURCE elements.
// State the arithmetic before you run." This file IS that statement, and it is retained so the number
// in the batch report can be re-derived by someone who does not trust it.
//
// ============================ THE CORRECTION THE FLAG'S OWN DOCUMENTATION FORCED ============================
// I was about to divide by the SCOPE SHARE. The property tier declares 2,213 subjects out of 17,491
// nodes carrying `PescElementDecl`, so a --limit counting LABELLED nodes would need ~79 to yield ~10
// judged. **THAT WOULD HAVE OVERSIZED THE BATCH BY ROUGHLY EIGHT TIMES, AND IT WOULD HAVE BEEN A
// CAREFUL-LOOKING ERROR** — a correction applied in the right spirit to the wrong quantity.
//
// [code fact] The flag's own help text (apps/graph-builder/lib/help.js, --limit/--offset): the window is
// over "each bridge's SOURCE SUBJECTS (the plugin's own subject identity)" and is **"APPLIED AFTER any
// standard-specific scope"**, with the worked example that under the SIF bridge's sifObjectScope a
// --limit=10 means "ten of THAT object's fields, not ten of all 15,620."
// SO --limit=N SELECTS N OF THE 2,213 SCOPED SUBJECTS. No share division is required, and applying one
// would have spent roughly eight times the authorised amount.
//
// [code fact] "THE ORDER IS SORTED BY SUBJECT KEY FIRST … Sorting makes a given window reproducible."
// So the window is DETERMINISTIC and can be named in advance — which is what this probe does, listing
// the exact subjects the batch will touch rather than predicting a count and hoping.
//
// [code fact] The resulting decision block is PARTIAL and its generation says so
// (`…-PARTIAL_WINDOW_limit<N>`), so a partial block cannot later masquerade as a complete pairing.
//
// ============================ WHY THE PREDICTION IS CHECKABLE ============================
// The DEBUG census already judged all 2,213 of these subjects with the SAME retrieval, the SAME scope
// and the SAME rendering. So for the exact subjects in the window, the debug block already says which
// would reach a judge and which is an orphan with no pool. The real-judge call count is therefore
// PREDICTED FROM MEASUREMENT, not estimated — and if the live run disagrees, that disagreement is
// itself the finding.
//
// Reads one sqlite store and one JSON scope file READ-ONLY. No graph, no container, no judge, no spend.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const moduleName = 'p3_batchSizingArithmetic';
const SCOPE_PATH = path.join(__dirname, '..', '..', 'bridgeData', 'pescDerivedConceptScope.json');
const DECISION_STORE = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/pescDerived/pescDerived.decisions.sqlite3';
const CENSUS_BLOCK_HASH = '6e5a6aa0539a563101ceb7d408f484851feefc62a71193edce6964dfee5ffabf';
const TARGET_JUDGED_SUBJECT_COUNT = 10;
const PROPOSED_LIMIT = Number(process.env.P3_LIMIT || 10);

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const scopeList = JSON.parse(fs.readFileSync(SCOPE_PATH, 'utf8'));
if (!Array.isArray(scopeList) || scopeList.length === 0) {
	report({ probe: moduleName, verdict: 'REFUSED', reason: 'the scope file is not a non-empty bare array of stableIds.' });
	process.exitCode = 1;
} else {
	const ran = spawnSync('sqlite3', [DECISION_STORE], {
		encoding: 'utf8',
		input: `SELECT frozenText FROM decisionBlocks WHERE decisionBlockHash = '${CENSUS_BLOCK_HASH}';`,
		maxBuffer: 512 * 1024 * 1024,
	});
	if (ran.status !== 0 || ran.error || !String(ran.stdout || '').trim()) {
		report({ probe: moduleName, verdict: 'REFUSED', reason: `could not read the census decision block ${CENSUS_BLOCK_HASH}: exit ${ran.status} ${ran.stderr || ''}` });
		process.exitCode = 1;
	} else {
		const recordList = JSON.parse(ran.stdout).decisionRecordList || [];
		const recordByStableId = {};
		recordList.forEach((oneRecord) => {
			recordByStableId[oneRecord.subjectStableId] = oneRecord;
		});

		// SORTED BY SUBJECT KEY, matching the flag's declared ordering. Default JS sort is lexicographic
		// over strings, which is what "sorted by subject key" means for these urn: identifiers.
		const sortedScopeList = scopeList.slice().sort();
		const windowList = sortedScopeList.slice(0, PROPOSED_LIMIT);

		let predictedJudged = 0;
		let predictedOrphan = 0;
		let absentFromCensus = 0;
		let abstainedInDebug = 0;
		const windowDetailList = windowList.map((oneStableId) => {
			const oneRecord = recordByStableId[oneStableId];
			if (!oneRecord) {
				absentFromCensus += 1;
				return { subjectStableId: oneStableId, inCensusBlock: false, note: 'ABSENT from the debug census block — investigate before running; the window and the census should cover the same scope.' };
			}
			const isOrphan = oneRecord.judgedReason === 'noCandidate' || oneRecord.resolution === 'orphan';
			if (isOrphan) {
				predictedOrphan += 1;
			} else {
				predictedJudged += 1;
				if (oneRecord.abstained === true) {
					abstainedInDebug += 1;
				}
			}
			const seatList = Array.isArray(oneRecord.retrievalSeatList) ? oneRecord.retrievalSeatList : [];
			let topCosine = null;
			seatList.forEach((oneSeat) => {
				if (typeof oneSeat.cosine === 'number' && (topCosine === null || oneSeat.cosine > topCosine)) {
					topCosine = oneSeat.cosine;
				}
			});
			return {
				subjectStableId: oneStableId,
				inCensusBlock: true,
				wouldReachAJudge: !isOrphan,
				renderedPoolSize: Array.isArray(oneRecord.renderedPoolStableIdList) ? oneRecord.renderedPoolStableIdList.length : 0,
				top1CosineInDebugRun: topCosine === null ? null : Number(topCosine.toFixed(4)),
				abstainedInDebugRun: oneRecord.abstained === true,
			};
		});

		const clean = absentFromCensus === 0;

		report({
			probe: moduleName,
			purpose: "P3 batch sizing, stated BEFORE the run and retained so it can be re-derived rather than trusted.",
			THE_ARITHMETIC: {
				step1_whatLimitCounts:
					'[code fact] --limit windows the bridge\'s SOURCE SUBJECTS and is APPLIED AFTER the standard-specific scope (help.js, --limit/--offset, with the SIF sifObjectScope worked example). It does NOT count labelled nodes.',
				step2_theScope: `the plugin declares ${scopeList.length} subjects via scopeStableIdListPath; the label carries 17,491 nodes, and that larger number is NOT the denominator.`,
				step3_theErrorAvoided: `dividing by the scope share (${scopeList.length}/17491 = ${(scopeList.length / 17491).toFixed(4)}) would have given --limit ~= ${Math.round(TARGET_JUDGED_SUBJECT_COUNT / (scopeList.length / 17491))} and OVERSIZED THE BATCH BY ROUGHLY EIGHT TIMES.`,
				step4_theWindow: `--limit=${PROPOSED_LIMIT} selects the first ${PROPOSED_LIMIT} of the ${scopeList.length} scoped subjects, sorted by subject key — deterministic and reproducible, so the exact subjects are named below rather than predicted in aggregate.`,
				step5_prediction: `${predictedJudged} subject(s) reach a judge; ${predictedOrphan} orphan(s) reach none. PREDICTED REAL JUDGE CALLS: ${predictedJudged}, assuming zero real-judge cache hits (the census reported cache 0, and the debug judge's entries are keyed to a different judge so they cannot serve a real run).`,
			},
			targetJudgedSubjectCount: TARGET_JUDGED_SUBJECT_COUNT,
			proposedLimit: PROPOSED_LIMIT,
			PREDICTED_JUDGED_SUBJECTS: predictedJudged,
			PREDICTED_ORPHANS_IN_WINDOW: predictedOrphan,
			predictedAbstentionsIfTheRealJudgeBehavesLikeTheDebugOne: abstainedInDebug,
			subjectsAbsentFromTheCensusBlock: absentFromCensus,
			RECOMMENDED_maxJudgmentCount: predictedJudged,
			whyThatCap:
				'maxJudgmentCount is set EQUAL to the prediction, not above it. It is the HARD lock: --limit sizes the window, but only this cap bounds spend if the window resolves differently than predicted. Any upward deviation REFUSES rather than quietly costing more, which is condition 5 of the GO expressed as data instead of as vigilance.',
			THE_WINDOW: windowDetailList,
			VERDICT: clean
				? `SIZING ESTABLISHED BY MEASUREMENT. --limit=${PROPOSED_LIMIT} with maxJudgmentCount=${predictedJudged} yields a predicted ${predictedJudged} real judge calls over ${predictedJudged} judged subjects.`
				: `REFUSED — ${absentFromCensus} of the ${PROPOSED_LIMIT} windowed subjects are ABSENT from the debug census block. The window and the census must cover the same scope; investigate before spending.`,
			whatThisDoesNotCover:
				'That the REAL judge renders the same prompt as the debug judge. That is checked at run time (GO condition 5: stop if any prompt differs), not here.',
		});
		process.exitCode = clean ? 0 : 1;
	}
}
