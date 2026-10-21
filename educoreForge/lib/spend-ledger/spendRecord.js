'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// spendRecord.js — what one judged unit or one embedding batch cost (spend ledger lane R1, 2026-10-21). PURE: no clock, no
// file, no network. The latency it records is a number someone else measured (build.js's metering wrapper for a judge,
// embedding-client for a batch), because BG-DET keeps every clock out of the bridge framework and the judge clients.
//
// THE PER-CALL LIST every judge client returns beside its verdict, one entry per PAID response (a retried response that
// came back 200 is paid; Jev's pick and relation are two; a jevOpus escalation is the Jev leg(s) then the Opus leg):
//   spendCallList: [{ provider, model, inputTokens, outputTokens }]      model = the WIRE model, what the vendor bills
//
// THE JUDGE SPEND RECORD, one per judged unit (forensic record; summed into the bridge's judgeSpend):
//   { provider, model, inputTokens, outputTokens, latencyMs, cacheHit, usd, savedUsd, pricedBy, callList }
//   provider/model   the judge's identity (judgeClient.name / judgeClient.model), not a leg's
//   callList         the legs, each priced: { provider, model, inputTokens, outputTokens, usd }
//   pricedBy         SPEND_PRICED_BY: spendPricingTable | debug | cacheRowPredatesLedger
// No silent zero: a debug unit says so (usd 0, pricedBy debug); a hit costs 0 and says what it SAVED, priced from the call
// that filled its cache row, or savedUsd null with pricedBy cacheRowPredatesLedger when the row predates the ledger.

const SPEND_CALL_FIELD_LIST = Object.freeze(['provider', 'model', 'inputTokens', 'outputTokens']);
const SPEND_PRICED_BY = Object.freeze({ table: 'spendPricingTable', debug: 'debug', cacheRowPredatesLedger: 'cacheRowPredatesLedger' });
const JUDGE_SPEND_RECORD_FIELD_LIST = Object.freeze(['provider', 'model', 'inputTokens', 'outputTokens', 'latencyMs', 'cacheHit', 'usd', 'savedUsd', 'pricedBy', 'callList']);

const isNonNegativeInteger = (candidate) => Number.isInteger(candidate) && candidate >= 0;
const isNonBlankText = (candidate) => typeof candidate === 'string' && candidate.trim() !== '';

// spendCallListViolation — '' when the list is a non-empty list of exactly SPEND_CALL_FIELD_LIST entries, else why not
const spendCallListViolation = (spendCallList) => {
	if (!Array.isArray(spendCallList) || spendCallList.length === 0) {
		return `spendCallList is ${JSON.stringify(spendCallList)}; a fresh answer names every paid call it made ([{ ${SPEND_CALL_FIELD_LIST.join(', ')} }], at least one)`;
	}
	const faultList = spendCallList
		.map((oneCall, callIndex) => {
			const memberNameList = oneCall !== null && typeof oneCall === 'object' && !Array.isArray(oneCall) ? Object.keys(oneCall).sort() : null;
			if (memberNameList === null || JSON.stringify(memberNameList) !== JSON.stringify(SPEND_CALL_FIELD_LIST.slice().sort())) {
				return `[${callIndex}] ${JSON.stringify(oneCall)} is not exactly { ${SPEND_CALL_FIELD_LIST.join(', ')} }`;
			}
			if (!isNonBlankText(oneCall.provider) || !isNonBlankText(oneCall.model) || !isNonNegativeInteger(oneCall.inputTokens) || !isNonNegativeInteger(oneCall.outputTokens)) {
				return `[${callIndex}] ${JSON.stringify(oneCall)} needs a provider, a model and non-negative integer token counts`;
			}
			return '';
		})
		.filter((fault) => fault !== '');
	return faultList.length ? `spendCallList ${faultList.join('; ')}` : '';
};

// pricedCallListFor — each call priced; the first unpriced one refuses the whole list by name
const pricedCallListFor = ({ spendCallList, spendPricer }) => {
	const pricedCallList = [];
	for (let callIndex = 0; callIndex < spendCallList.length; callIndex += 1) {
		const oneCall = spendCallList[callIndex];
		const priced = spendPricer.usdFor(oneCall);
		if (priced.error) {
			return { error: priced.error };
		}
		pricedCallList.push({ provider: oneCall.provider, model: oneCall.model, inputTokens: oneCall.inputTokens, outputTokens: oneCall.outputTokens, usd: priced.usd });
	}
	return { pricedCallList };
};

const sumOf = (itemList, memberName) => itemList.reduce((runningTotal, oneItem) => runningTotal + oneItem[memberName], 0);

// judgeSpendRecordFor — one judged unit → { spendRecord } | { error }. The three arms are the three kinds of unit, by name.
const judgeSpendRecordFor = ({ judgeName, judgeModel, spendCallList, latencyMs, cacheHit, fillingSpendCallList, isDebugClient, spendPricer }) => {
	if (!isNonBlankText(judgeName) || !isNonBlankText(judgeModel)) {
		return { error: `${moduleName}: the judge names provider ${JSON.stringify(judgeName)} / model ${JSON.stringify(judgeModel)}; a spend record is filed under the judge's name and identity (JUDGE_PROVIDER_SHAPE name, model)` };
	}
	const identity = { provider: judgeName, model: judgeModel };
	if (isDebugClient) {
		return { spendRecord: { ...identity, inputTokens: 0, outputTokens: 0, latencyMs: isNonNegativeInteger(latencyMs) ? latencyMs : null, cacheHit: false, usd: 0, savedUsd: null, pricedBy: SPEND_PRICED_BY.debug, callList: [] } };
	}
	if (!spendPricer || typeof spendPricer.usdFor !== 'function') {
		return { error: `${moduleName}: no spendPricer for judge ${judgeModel}; every real judgment is priced (build.js hands the pricer loaded from [spendLedger].spendPricingFilePath)` };
	}
	if (cacheHit) {
		// a hit made no call: nothing was spent and no latency was incurred, so latencyMs is null, not a measurement of zero
		if (fillingSpendCallList === null || fillingSpendCallList === undefined) {
			return { spendRecord: { ...identity, inputTokens: 0, outputTokens: 0, latencyMs: null, cacheHit: true, usd: 0, savedUsd: null, pricedBy: SPEND_PRICED_BY.cacheRowPredatesLedger, callList: [] } };
		}
		const fillingViolation = spendCallListViolation(fillingSpendCallList);
		if (fillingViolation) {
			return { error: `${moduleName}: the cache row's filling ${fillingViolation}` };
		}
		const pricedFilling = pricedCallListFor({ spendCallList: fillingSpendCallList, spendPricer });
		if (pricedFilling.error) {
			return { error: pricedFilling.error };
		}
		return { spendRecord: { ...identity, inputTokens: 0, outputTokens: 0, latencyMs: null, cacheHit: true, usd: 0, savedUsd: sumOf(pricedFilling.pricedCallList, 'usd'), pricedBy: SPEND_PRICED_BY.table, callList: [] } };
	}
	const callViolation = spendCallListViolation(spendCallList);
	if (callViolation) {
		return { error: `${moduleName}: judge ${judgeModel} answered without its spend: ${callViolation}` };
	}
	if (!isNonNegativeInteger(latencyMs)) {
		return { error: `${moduleName}: judge ${judgeModel} answered with latencyMs ${JSON.stringify(latencyMs)}; a live answer carries the milliseconds build.js's metering wrapper measured (latencyMeteredJudgeClientFor)` };
	}
	const pricedLive = pricedCallListFor({ spendCallList, spendPricer });
	if (pricedLive.error) {
		return { error: pricedLive.error };
	}
	return { spendRecord: { ...identity, inputTokens: sumOf(pricedLive.pricedCallList, 'inputTokens'), outputTokens: sumOf(pricedLive.pricedCallList, 'outputTokens'), latencyMs, cacheHit: false, usd: sumOf(pricedLive.pricedCallList, 'usd'), savedUsd: null, pricedBy: SPEND_PRICED_BY.table, callList: pricedLive.pricedCallList } };
};

// judgeSpendRecordViolation — '' when a record is exactly JUDGE_SPEND_RECORD_FIELD_LIST (the forensic trail's check)
const judgeSpendRecordViolation = (spendRecord) => {
	const memberNameList = spendRecord !== null && typeof spendRecord === 'object' && !Array.isArray(spendRecord) ? Object.keys(spendRecord).sort() : null;
	if (memberNameList === null || JSON.stringify(memberNameList) !== JSON.stringify(JUDGE_SPEND_RECORD_FIELD_LIST.slice().sort())) {
		return `spendRecord ${JSON.stringify(spendRecord)} is not exactly { ${JUDGE_SPEND_RECORD_FIELD_LIST.join(', ')} }`;
	}
	if (Object.values(SPEND_PRICED_BY).indexOf(spendRecord.pricedBy) === -1) {
		return `spendRecord.pricedBy ${JSON.stringify(spendRecord.pricedBy)} is not one of ${Object.values(SPEND_PRICED_BY).join(', ')}`;
	}
	if (typeof spendRecord.usd !== 'number' || !Number.isFinite(spendRecord.usd) || spendRecord.usd < 0) {
		return `spendRecord.usd ${JSON.stringify(spendRecord.usd)} is not a non-negative number`;
	}
	return '';
};

// JUDGE_SPEND_TOTAL_SEED — the money members a bridge's report.judgeSpend gains beside its counts
const JUDGE_SPEND_TOTAL_SEED = Object.freeze({ inputTokens: 0, outputTokens: 0, usd: 0, savedUsd: 0, savedUsdUnknownCount: 0, debugUnitCount: 0, usdByProviderModel: Object.freeze({}) });

// judgeSpendTotalsWith — the bridge's running totals plus one unit (a NEW object; the caller assigns it). A hit whose row
// predates the ledger adds nothing to savedUsd and is COUNTED in savedUsdUnknownCount, so the total says what it omits.
const judgeSpendTotalsWith = ({ judgeSpend, spendRecord }) => {
	const usdByProviderModel = { ...judgeSpend.usdByProviderModel };
	spendRecord.callList.forEach((oneCall) => {
		const providerModelName = `${oneCall.provider}:${oneCall.model}`;
		const previous = usdByProviderModel[providerModelName] || { callCount: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
		usdByProviderModel[providerModelName] = { callCount: previous.callCount + 1, inputTokens: previous.inputTokens + oneCall.inputTokens, outputTokens: previous.outputTokens + oneCall.outputTokens, usd: previous.usd + oneCall.usd };
	});
	return {
		...judgeSpend,
		inputTokens: judgeSpend.inputTokens + spendRecord.inputTokens,
		outputTokens: judgeSpend.outputTokens + spendRecord.outputTokens,
		usd: judgeSpend.usd + spendRecord.usd,
		savedUsd: judgeSpend.savedUsd + (spendRecord.savedUsd === null ? 0 : spendRecord.savedUsd),
		savedUsdUnknownCount: judgeSpend.savedUsdUnknownCount + (spendRecord.cacheHit && spendRecord.savedUsd === null ? 1 : 0),
		debugUnitCount: judgeSpend.debugUnitCount + (spendRecord.pricedBy === SPEND_PRICED_BY.debug ? 1 : 0),
		usdByProviderModel,
	};
};

// EMBEDDING_SPEND_RECORD_FIELD_LIST — what embedding-client records per embedTexts batch (unpriced; the ledger prices it)
const EMBEDDING_SPEND_RECORD_FIELD_LIST = Object.freeze(['provider', 'model', 'texts', 'distinctMisses', 'servedFromCache', 'tokens', 'latencyMs']);

// pricedEmbeddingSpendRecordFor — one batch → { pricedEmbeddingSpendRecord } (the record plus usd) | { error }
const pricedEmbeddingSpendRecordFor = ({ embeddingSpendRecord, spendPricer }) => {
	const memberNameList = embeddingSpendRecord !== null && typeof embeddingSpendRecord === 'object' ? Object.keys(embeddingSpendRecord).sort() : null;
	if (memberNameList === null || JSON.stringify(memberNameList) !== JSON.stringify(EMBEDDING_SPEND_RECORD_FIELD_LIST.slice().sort())) {
		return { error: `${moduleName}: embedding spend record ${JSON.stringify(embeddingSpendRecord)} is not exactly { ${EMBEDDING_SPEND_RECORD_FIELD_LIST.join(', ')} }` };
	}
	const priced = spendPricer.usdFor({ provider: embeddingSpendRecord.provider, model: embeddingSpendRecord.model, inputTokens: embeddingSpendRecord.tokens, outputTokens: 0 });
	if (priced.error) {
		return { error: priced.error };
	}
	return { pricedEmbeddingSpendRecord: { ...embeddingSpendRecord, usd: priced.usd } };
};

module.exports = {
	spendCallListViolation,
	judgeSpendRecordFor,
	judgeSpendRecordViolation,
	judgeSpendTotalsWith,
	pricedEmbeddingSpendRecordFor,
	SPEND_CALL_FIELD_LIST,
	SPEND_PRICED_BY,
	JUDGE_SPEND_RECORD_FIELD_LIST,
	JUDGE_SPEND_TOTAL_SEED,
	EMBEDDING_SPEND_RECORD_FIELD_LIST,
	moduleName,
};
