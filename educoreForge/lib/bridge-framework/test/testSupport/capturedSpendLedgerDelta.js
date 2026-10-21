'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// capturedSpendLedgerDelta.js — the spend ledger R1 delta (2026-10-21) for a run report's counts CAPTURED before the spend
// ledger existed. That phase's judgeSpend was { asked, servedFromCache, abstained, rationaleReaskCount, usd: null }; the
// ledger adds the money members (spendRecord.js JUDGE_SPEND_TOTAL_SEED) and fills them from each judged unit's spend
// record. A captured oracle of a run that asked N units of one known per-unit spend therefore becomes, exactly, the
// counts with those N records folded in — through the SAME totals function the framework uses, so the float sums match.
// Refused for a capture this delta cannot reconstruct: a cache hit or a re-ask would need records the capture never kept.

const path = require('path');
const spendRecordLib = require(path.join(__dirname, '..', '..', '..', 'spend-ledger', 'spendRecord'));

const capturedCountsWithSpendLedgerDelta = ({ capturedCounts, perUnitSpendRecord }) => {
	const capturedSpend = capturedCounts.judgeSpend;
	if (capturedSpend.servedFromCache !== 0 || capturedSpend.rationaleReaskCount !== 0 || capturedSpend.usd !== null) {
		throw new Error(`${moduleName} REFUSED: the captured judgeSpend ${JSON.stringify(capturedSpend)} is not a pre-ledger all-fresh, no-re-ask capture; its spend cannot be reconstructed from one per-unit record`);
	}
	const seededSpend = { asked: capturedSpend.asked, servedFromCache: capturedSpend.servedFromCache, abstained: capturedSpend.abstained, rationaleReaskCount: capturedSpend.rationaleReaskCount, ...spendRecordLib.JUDGE_SPEND_TOTAL_SEED };
	const judgeSpend = Array.from({ length: capturedSpend.asked }).reduce((soFar) => spendRecordLib.judgeSpendTotalsWith({ judgeSpend: soFar, spendRecord: perUnitSpendRecord }), seededSpend);
	return { ...capturedCounts, judgeSpend };
};

module.exports = { capturedCountsWithSpendLedgerDelta, moduleName };
