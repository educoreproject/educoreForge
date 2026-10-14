'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// spendLedger.js — Jev calls and tokens for one run, by kind (judge, concept, class, desDomain, desEntity), with
// cache hits counted apart: a hit costs nothing and is reported as served, never as asked.

const makeSpendLedger = ({ usdPerMillionInputTokens, usdPerMillionOutputTokens }) => {
	if (!Number.isFinite(usdPerMillionInputTokens) || !Number.isFinite(usdPerMillionOutputTokens)) {
		throw new Error(`${moduleName}: jevUsdPerMillionInputTokens and jevUsdPerMillionOutputTokens are required numbers in walkExperiment.json`);
	}
	const tallyByKind = {};
	const emptyTally = () => ({ askedCount: 0, servedFromCacheCount: 0, inputTokens: 0, outputTokens: 0 });
	const record = ({ ledgerKind, cacheHit, usage }) => {
		const tally = (tallyByKind[ledgerKind] = tallyByKind[ledgerKind] || emptyTally());
		if (cacheHit) {
			tally.servedFromCacheCount += 1;
			return;
		}
		if (!usage || !Number.isInteger(usage.inputTokens) || !Number.isInteger(usage.outputTokens)) {
			throw new Error(`${moduleName}: a live ${ledgerKind} call reported no usage ${JSON.stringify(usage)}; spend cannot be counted`);
		}
		tally.askedCount += 1;
		tally.inputTokens += usage.inputTokens;
		tally.outputTokens += usage.outputTokens;
	};
	const totalOf = (tallyList) => {
		const total = tallyList.reduce((soFar, oneTally) => ({ askedCount: soFar.askedCount + oneTally.askedCount, servedFromCacheCount: soFar.servedFromCacheCount + oneTally.servedFromCacheCount, inputTokens: soFar.inputTokens + oneTally.inputTokens, outputTokens: soFar.outputTokens + oneTally.outputTokens }), emptyTally());
		return { ...total, usd: (total.inputTokens * usdPerMillionInputTokens + total.outputTokens * usdPerMillionOutputTokens) / 1e6 };
	};
	const snapshot = () => totalOf(Object.keys(tallyByKind).map((oneKind) => tallyByKind[oneKind]));
	const byKind = () => Object.keys(tallyByKind).reduce((soFar, oneKind) => Object.assign(soFar, { [oneKind]: totalOf([tallyByKind[oneKind]]) }), {});
	const differenceSince = (earlier) => {
		const now = snapshot();
		return Object.keys(now).reduce((soFar, oneField) => Object.assign(soFar, { [oneField]: now[oneField] - earlier[oneField] }), {});
	};
	return { record, snapshot, byKind, differenceSince };
};

module.exports = { makeSpendLedger, moduleName };
