'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// spendLedger.js — the per-build spend ledger and the lifetime ledger (spend ledger lane R1, 2026-10-21).
//
//   spendLedgerFor({ recipeName, buildRunStamp, buildStartedAtIso, storeDirPath, bridgeSpendList, embeddingSpendRecordList, spendPricer })
//       → { spendLedger } | { error }        PURE: assembles what one build spent
//         bridgeSpendList: [{ bridgeName, pairKey, judgeSpend }]   judgeSpend = the bridge run report's counts.judgeSpend
//         embeddingSpendRecordList: embedding-client's records (unpriced; priced here)
//   spendLedgerSummaryLineFor(spendLedger) → the one build-log line
//   writeBuildSpendLedger({ runDirPath, spendLedger }, cb)            → <runDir>/spendLedger.json
//   appendLifetimeSpendLedger({ lifetimeLedgerFilePath, spendLedger }, cb)   one JSONL line per build, append-only
//   querySpendLedger({ lifetimeLedgerFilePath, sinceDayText, recipeName }, cb) → { rowList, byDay, byRecipe, byProviderModel, totals }
//
// MONEY IS STATED, NEVER INFERRED: judge dollars arrive already priced on each bridge's judgeSpend (judgeComponent priced every
// unit as it was asked); embedding dollars are priced here from the same table. A hit whose cache row predates the ledger
// adds nothing to savedUsd and is COUNTED (savedUsdUnknownCount), so a total says what it omits.

const fs = require('fs');
const path = require('path');
const spendRecordLib = require('./spendRecord');

const SPEND_LEDGER_VERSION = 'spendLedger-v1';
const SPEND_LEDGER_FILE_NAME = 'spendLedger.json';
const DAY_TEXT_RE = /^\d{4}-\d{2}-\d{2}$/;

const providerModelNameOf = ({ provider, model }) => `${provider}:${model}`;

// mergedUsdByProviderModel — two { 'provider:model': { callCount, inputTokens, outputTokens, usd } } maps, summed
const mergedUsdByProviderModel = (leftMap, rightMap) =>
	Object.keys(rightMap).reduce((soFar, providerModelName) => {
		const previous = soFar[providerModelName] || { callCount: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
		const added = rightMap[providerModelName];
		return { ...soFar, [providerModelName]: { callCount: previous.callCount + added.callCount, inputTokens: previous.inputTokens + added.inputTokens, outputTokens: previous.outputTokens + added.outputTokens, usd: previous.usd + added.usd } };
	}, { ...leftMap });

// JUDGE_SPEND_LEDGER_FIELD_LIST — what a bridge's judgeSpend must carry to enter a ledger (the counts plus the money)
const JUDGE_SPEND_LEDGER_FIELD_LIST = Object.freeze(['asked', 'servedFromCache', 'abstained', 'inputTokens', 'outputTokens', 'usd', 'savedUsd', 'savedUsdUnknownCount', 'debugUnitCount', 'usdByProviderModel']);

const spendLedgerFor = ({ recipeName, buildRunStamp, buildStartedAtIso, storeDirPath, bridgeSpendList, embeddingSpendRecordList, spendPricer }) => {
	if (!Array.isArray(bridgeSpendList) || !Array.isArray(embeddingSpendRecordList)) {
		return { error: `${moduleName}: bridgeSpendList and embeddingSpendRecordList are lists (empty when the build judged or embedded nothing)` };
	}
	const unledgerableBridge = bridgeSpendList.find((oneBridge) => !oneBridge.judgeSpend || JUDGE_SPEND_LEDGER_FIELD_LIST.some((fieldName) => oneBridge.judgeSpend[fieldName] === undefined));
	if (unledgerableBridge !== undefined) {
		return { error: `${moduleName}: bridge ${unledgerableBridge.bridgeName} reported judgeSpend ${JSON.stringify(unledgerableBridge.judgeSpend)}, which lacks the ledger's members (${JUDGE_SPEND_LEDGER_FIELD_LIST.join(', ')})` };
	}
	const pricedEmbeddingList = [];
	for (let recordIndex = 0; recordIndex < embeddingSpendRecordList.length; recordIndex += 1) {
		const priced = spendRecordLib.pricedEmbeddingSpendRecordFor({ embeddingSpendRecord: embeddingSpendRecordList[recordIndex], spendPricer });
		if (priced.error) {
			return { error: priced.error };
		}
		pricedEmbeddingList.push(priced.pricedEmbeddingSpendRecord);
	}
	const bridgeList = bridgeSpendList.map((oneBridge) => ({ bridgeName: oneBridge.bridgeName, pairKey: oneBridge.pairKey, ...JUDGE_SPEND_LEDGER_FIELD_LIST.reduce((soFar, fieldName) => ({ ...soFar, [fieldName]: oneBridge.judgeSpend[fieldName] }), {}) }));
	const embeddingByProviderModel = pricedEmbeddingList.reduce((soFar, oneRecord) => {
		const providerModelName = providerModelNameOf(oneRecord);
		const previous = soFar[providerModelName] || { provider: oneRecord.provider, model: oneRecord.model, batchCount: 0, texts: 0, distinctMisses: 0, servedFromCache: 0, tokens: 0, latencyMs: 0, usd: 0 };
		return { ...soFar, [providerModelName]: { ...previous, batchCount: previous.batchCount + 1, texts: previous.texts + oneRecord.texts, distinctMisses: previous.distinctMisses + oneRecord.distinctMisses, servedFromCache: previous.servedFromCache + oneRecord.servedFromCache, tokens: previous.tokens + oneRecord.tokens, latencyMs: previous.latencyMs + (oneRecord.latencyMs === null ? 0 : oneRecord.latencyMs), usd: previous.usd + oneRecord.usd } };
	}, {});
	const embeddingList = Object.keys(embeddingByProviderModel).sort().map((providerModelName) => embeddingByProviderModel[providerModelName]);
	const judgeUsd = bridgeList.reduce((runningTotal, oneBridge) => runningTotal + oneBridge.usd, 0);
	const embeddingUsd = embeddingList.reduce((runningTotal, oneEmbedding) => runningTotal + oneEmbedding.usd, 0);
	const judgeUsdByProviderModel = bridgeList.reduce((soFar, oneBridge) => mergedUsdByProviderModel(soFar, oneBridge.usdByProviderModel), {});
	const embeddingUsdByProviderModel = embeddingList.reduce((soFar, oneEmbedding) => ({ ...soFar, [providerModelNameOf(oneEmbedding)]: { callCount: oneEmbedding.batchCount, inputTokens: oneEmbedding.tokens, outputTokens: 0, usd: oneEmbedding.usd } }), {});
	const spendLedger = {
		spendLedgerVersion: SPEND_LEDGER_VERSION,
		recipeName,
		buildRunStamp,
		buildStartedAtIso,
		storeDirPath,
		pricingFilePath: spendPricer.pricingFilePath,
		// the prices this ledger was computed at, with their sources, so a ledger read a year from now says what it assumed
		priceRowList: spendPricer.priceRowList.map((onePriceRow) => ({ provider: onePriceRow.provider, model: onePriceRow.model, inputUsdPerMillionTokens: onePriceRow.inputUsdPerMillionTokens, outputUsdPerMillionTokens: onePriceRow.outputUsdPerMillionTokens, priceSource: onePriceRow.priceSource, priceAsOf: onePriceRow.priceAsOf })),
		bridgeList,
		embeddingList,
		totals: {
			judgeUsd,
			embeddingUsd,
			usd: judgeUsd + embeddingUsd,
			savedUsd: bridgeList.reduce((runningTotal, oneBridge) => runningTotal + oneBridge.savedUsd, 0),
			savedUsdUnknownCount: bridgeList.reduce((runningTotal, oneBridge) => runningTotal + oneBridge.savedUsdUnknownCount, 0),
			asked: bridgeList.reduce((runningTotal, oneBridge) => runningTotal + oneBridge.asked, 0),
			servedFromCache: bridgeList.reduce((runningTotal, oneBridge) => runningTotal + oneBridge.servedFromCache, 0),
			debugUnitCount: bridgeList.reduce((runningTotal, oneBridge) => runningTotal + oneBridge.debugUnitCount, 0),
			usdByProviderModel: mergedUsdByProviderModel(judgeUsdByProviderModel, embeddingUsdByProviderModel),
		},
	};
	return { spendLedger };
};

const usdText = (usd) => `$${usd.toFixed(4)}`;

const spendLedgerSummaryLineFor = (spendLedger) => {
	const totals = spendLedger.totals;
	const unknownText = totals.savedUsdUnknownCount > 0 ? ` (+${totals.savedUsdUnknownCount} hit(s) on rows predating the ledger, saving unknown)` : '';
	const debugText = totals.debugUnitCount > 0 ? `; ${totals.debugUnitCount} debug unit(s) at $0` : '';
	return `[spendLedger] spent ${usdText(totals.usd)} (judge ${usdText(totals.judgeUsd)} over ${totals.asked} asked; embedding ${usdText(totals.embeddingUsd)}); ${totals.servedFromCache} judgment(s) from cache saved ${usdText(totals.savedUsd)}${unknownText}${debugText}`;
};

const writeBuildSpendLedger = ({ runDirPath, spendLedger }, callback) => {
	if (typeof runDirPath !== 'string' || runDirPath === '') {
		callback(`${moduleName}: runDirPath is ${JSON.stringify(runDirPath)}; the ledger is written into the build's own run directory`);
		return;
	}
	fs.mkdir(runDirPath, { recursive: true }, (mkdirError) => {
		if (mkdirError) {
			callback(`${moduleName}: preparing ${runDirPath}: ${mkdirError.message}`);
			return;
		}
		const ledgerFilePath = path.join(runDirPath, SPEND_LEDGER_FILE_NAME);
		fs.writeFile(ledgerFilePath, `${JSON.stringify(spendLedger, null, '\t')}\n`, (writeError) => {
			if (writeError) {
				callback(`${moduleName}: writing ${ledgerFilePath}: ${writeError.message}`);
				return;
			}
			callback('', { ledgerFilePath });
		});
	});
};

// lifetimeLineFor — the one JSONL line a build appends: who, when, where, and its totals by provider:model
const lifetimeLineFor = (spendLedger) => ({
	spendLedgerVersion: spendLedger.spendLedgerVersion,
	recipeName: spendLedger.recipeName,
	buildRunStamp: spendLedger.buildRunStamp,
	buildStartedAtIso: spendLedger.buildStartedAtIso,
	storeDirPath: spendLedger.storeDirPath,
	usd: spendLedger.totals.usd,
	judgeUsd: spendLedger.totals.judgeUsd,
	embeddingUsd: spendLedger.totals.embeddingUsd,
	savedUsd: spendLedger.totals.savedUsd,
	savedUsdUnknownCount: spendLedger.totals.savedUsdUnknownCount,
	usdByProviderModel: spendLedger.totals.usdByProviderModel,
});

const appendLifetimeSpendLedger = ({ lifetimeLedgerFilePath, spendLedger }, callback) => {
	if (typeof lifetimeLedgerFilePath !== 'string' || lifetimeLedgerFilePath === '') {
		callback(`${moduleName}: lifetimeLedgerFilePath is ${JSON.stringify(lifetimeLedgerFilePath)}; it is [spendLedger].lifetimeLedgerFilePath in graphBuilder.ini, and there is no default`);
		return;
	}
	if (!fs.existsSync(path.dirname(lifetimeLedgerFilePath))) {
		callback(`${moduleName}: the directory of ${lifetimeLedgerFilePath} does not exist; the lifetime ledger is never created somewhere nobody prepared`);
		return;
	}
	// 'a' — append-only: a build adds its line and never rewrites another build's
	fs.appendFile(lifetimeLedgerFilePath, `${JSON.stringify(lifetimeLineFor(spendLedger))}\n`, { flag: 'a' }, (appendError) => {
		if (appendError) {
			callback(`${moduleName}: appending to ${lifetimeLedgerFilePath}: ${appendError.message}`);
			return;
		}
		callback('', { lifetimeLedgerFilePath });
	});
};

// parsedJsonOf — a non-throwing JSON parse, the boundary kept local (voyage.js qtParseJson's idiom): { parsedValue } | { parseFault }
const parsedJsonOf = (jsonText) => {
	let parsedValue;
	let parseFault;
	try {
		parsedValue = JSON.parse(jsonText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	return parseFault === undefined ? { parsedValue } : { parseFault };
};

// dayTextOf — the build's day, from its start time (YYYY-MM-DD)
const dayTextOf = (lifetimeLine) => String(lifetimeLine.buildStartedAtIso).slice(0, 10);

const totalsInto = (soFar, groupName, lifetimeLine) => {
	const previous = soFar[groupName] || { buildCount: 0, usd: 0, judgeUsd: 0, embeddingUsd: 0, savedUsd: 0, savedUsdUnknownCount: 0 };
	return { ...soFar, [groupName]: { buildCount: previous.buildCount + 1, usd: previous.usd + lifetimeLine.usd, judgeUsd: previous.judgeUsd + lifetimeLine.judgeUsd, embeddingUsd: previous.embeddingUsd + lifetimeLine.embeddingUsd, savedUsd: previous.savedUsd + lifetimeLine.savedUsd, savedUsdUnknownCount: previous.savedUsdUnknownCount + lifetimeLine.savedUsdUnknownCount } };
};

const querySpendLedger = ({ lifetimeLedgerFilePath, sinceDayText, recipeName }, callback) => {
	if (sinceDayText !== undefined && !DAY_TEXT_RE.test(String(sinceDayText))) {
		callback(`${moduleName}: --since is ${JSON.stringify(sinceDayText)}; it is a day, YYYY-MM-DD`);
		return;
	}
	if (!fs.existsSync(lifetimeLedgerFilePath)) {
		callback(`${moduleName}: no lifetime ledger at ${lifetimeLedgerFilePath}; no build has recorded its spend there yet`);
		return;
	}
	fs.readFile(lifetimeLedgerFilePath, 'utf8', (readError, ledgerText) => {
		if (readError) {
			callback(`${moduleName}: reading ${lifetimeLedgerFilePath}: ${readError.message}`);
			return;
		}
		const lineTextList = ledgerText.split('\n').filter((lineText) => lineText.trim() !== '');
		const parsedList = lineTextList.map((lineText, lineIndex) => ({ lineNumber: lineIndex + 1, ...parsedJsonOf(lineText) }));
		const badLine = parsedList.find((oneParsed) => oneParsed.parseFault !== undefined);
		if (badLine !== undefined) {
			callback(`${moduleName}: ${lifetimeLedgerFilePath} line ${badLine.lineNumber} is not JSON (${badLine.parseFault}); the ledger is refused rather than summed around a hole`);
			return;
		}
		const rowList = parsedList
			.map((oneParsed) => oneParsed.parsedValue)
			.filter((lifetimeLine) => (sinceDayText === undefined || dayTextOf(lifetimeLine) >= sinceDayText) && (recipeName === undefined || lifetimeLine.recipeName === recipeName));
		const byDay = rowList.reduce((soFar, lifetimeLine) => totalsInto(soFar, dayTextOf(lifetimeLine), lifetimeLine), {});
		const byRecipe = rowList.reduce((soFar, lifetimeLine) => totalsInto(soFar, lifetimeLine.recipeName, lifetimeLine), {});
		const byProviderModel = rowList.reduce((soFar, lifetimeLine) => mergedUsdByProviderModel(soFar, lifetimeLine.usdByProviderModel), {});
		const totals = rowList.reduce((soFar, lifetimeLine) => totalsInto(soFar, 'all', lifetimeLine), {}).all || { buildCount: 0, usd: 0, judgeUsd: 0, embeddingUsd: 0, savedUsd: 0, savedUsdUnknownCount: 0 };
		callback('', { rowList, byDay, byRecipe, byProviderModel, totals });
	});
};

module.exports = {
	spendLedgerFor,
	spendLedgerSummaryLineFor,
	writeBuildSpendLedger,
	appendLifetimeSpendLedger,
	querySpendLedger,
	SPEND_LEDGER_VERSION,
	SPEND_LEDGER_FILE_NAME,
	JUDGE_SPEND_LEDGER_FIELD_LIST,
	moduleName,
};
