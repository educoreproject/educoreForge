#!/usr/bin/env node
'use strict';

// test-embeddingSpend.js — hermetic gate for the embedding half of the spend ledger (spend ledger lane R1).
//
// PROVES (a recorded-fixture provider standing in for Voyage through embedding-client's componentOverrides.provider):
//   a  an uncached batch records { provider, model, texts, distinctMisses, servedFromCache, tokens, latencyMs }, with the
//      provider's billed tokens and a measured latency, and the record prices from the fixture table
//   b  a cached run records a partial batch (distinct misses only sent) and a wholly cache-served batch (tokens 0,
//      latencyMs null: no call, nothing claimed)
//   c  a provider answer without its billed token count is REFUSED by name
//   d  spendRecordList() hands back a copy: editing it does not edit the embedder's ledger
//
// Run: node lib/spend-ledger/test/test-embeddingSpend.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for embedding spend records

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives embedding-client with a fixture provider (no socket, no Voyage) and checks the spend record of every batch.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const embeddingClientLib = require('../../embedding/embedding-client');
const spendPricingLib = require('../spendPricing');
const spendRecordLib = require('../spendRecord');

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfEmbeddingSpendGate-'));
const iniFilePath = path.join(scratchDir, 'voyageEmbedding.ini');
fs.writeFileSync(iniFilePath, '[voyageEmbedding]\napiKey=NOT-A-REAL-KEY\nmodel=voyage-4-large\nembeddingDims=4\n');
const spendPricer = spendPricingLib.loadSpendPricing({ pricingFilePath: path.join(__dirname, 'fixtures', 'spendPricing-fixture.ini') }).spendPricer;

// the recorded-fixture provider: a Voyage response body's shape reduced to what embed hands back — vectors of the
// configured width and Voyage's usage.total_tokens (here: 5 tokens per text, so the count is checkable by hand)
const fixtureProvider = ({ omitUsage = false } = {}) => ({
	sentTextCountList: [],
	embed(texts, resolvedConfig, callback) {
		this.sentTextCountList.push(texts.length);
		setImmediate(() => callback('', texts.map(() => new Array(resolvedConfig.dimension).fill(0.25)), omitUsage ? undefined : { totalTokens: texts.length * 5 }));
	},
});

const fieldListOf = (record) => Object.keys(record).sort().join(',');
const EXPECTED_FIELD_LIST_TEXT = spendRecordLib.EMBEDDING_SPEND_RECORD_FIELD_LIST.slice().sort().join(',');

// =====================================================================
harness.section('a — an uncached batch');
// =====================================================================
const uncachedProvider = fixtureProvider();
const uncachedEmbedder = embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath: false, componentOverrides: { provider: uncachedProvider } });
uncachedEmbedder.embedTexts({ texts: ['alpha', 'beta', 'gamma'] }, (uncachedError) => {
	harness.accepts('the uncached batch embeds', uncachedError ? [uncachedError] : []);
	const [uncachedRecord] = uncachedEmbedder.spendRecordList();
	harness.equal('one record, of exactly the declared fields', uncachedRecord && fieldListOf(uncachedRecord), EXPECTED_FIELD_LIST_TEXT);
	harness.ok('three texts, three misses sent, none from cache, 15 billed tokens, a measured latency', uncachedRecord.texts === 3 && uncachedRecord.distinctMisses === 3 && uncachedRecord.servedFromCache === 0 && uncachedRecord.tokens === 15 && Number.isInteger(uncachedRecord.latencyMs) && uncachedRecord.latencyMs >= 0, JSON.stringify(uncachedRecord));
	harness.ok('it names the provider and the model the vectors were made at', uncachedRecord.provider === 'voyage' && uncachedRecord.model === 'voyage-4-large', JSON.stringify(uncachedRecord));
	const priced = spendRecordLib.pricedEmbeddingSpendRecordFor({ embeddingSpendRecord: uncachedRecord, spendPricer });
	harness.ok('it prices from the table: 15 tokens × $0.1 per million', priced.error === undefined && Math.abs(priced.pricedEmbeddingSpendRecord.usd - 0.0000015) < 1e-15, JSON.stringify(priced));

	// =====================================================================
	harness.section('b — a cached run: partial, then wholly cache-served');
	// =====================================================================
	const cachedProvider = fixtureProvider();
	const cachedEmbedder = embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath: path.join(scratchDir, 'vectorCache.sqlite3'), componentOverrides: { provider: cachedProvider } });
	cachedEmbedder.embedTexts({ texts: ['alpha', 'beta'] }, (firstError) => {
		harness.accepts('the first cached batch embeds', firstError ? [firstError] : []);
		cachedEmbedder.embedTexts({ texts: ['alpha', 'beta', 'delta', 'delta'] }, (secondError) => {
			harness.accepts('the partial batch embeds', secondError ? [secondError] : []);
			cachedEmbedder.embedTexts({ texts: ['alpha', 'delta'] }, (thirdError) => {
				harness.accepts('the wholly cached batch embeds', thirdError ? [thirdError] : []);
				const [, partialRecord, hitRecord] = cachedEmbedder.spendRecordList();
				harness.ok('the partial batch: 4 texts, 1 distinct miss sent (delta, twice asked), 3 from cache, 5 billed tokens', partialRecord.texts === 4 && partialRecord.distinctMisses === 1 && partialRecord.servedFromCache === 3 && partialRecord.tokens === 5, JSON.stringify(partialRecord));
				harness.ok('the provider was sent exactly the one distinct miss', cachedProvider.sentTextCountList.join(',') === '2,1', cachedProvider.sentTextCountList.join(','));
				harness.ok('the wholly cached batch: no call, tokens 0 and latencyMs null (nothing measured, nothing claimed)', hitRecord.distinctMisses === 0 && hitRecord.servedFromCache === 2 && hitRecord.tokens === 0 && hitRecord.latencyMs === null, JSON.stringify(hitRecord));

				// =====================================================================
				harness.section('c — the provider answer without billed tokens');
				// =====================================================================
				const silentEmbedder = embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath: false, componentOverrides: { provider: fixtureProvider({ omitUsage: true }) } });
				silentEmbedder.embedTexts({ texts: ['alpha'] }, (silentError) => {
					harness.match('a provider answer with no billed token count is REFUSED by name', silentError, /returned no billed token count .*every embedding call is priced/);
					harness.equal('and nothing was recorded for it', silentEmbedder.spendRecordList().length, 0);

					// =====================================================================
					harness.section('d — the ledger is read, never edited');
					// =====================================================================
					const copiedList = uncachedEmbedder.spendRecordList();
					copiedList[0].tokens = 999;
					copiedList.push({});
					harness.ok('editing the returned list leaves the embedder\'s own ledger untouched', uncachedEmbedder.spendRecordList().length === 1 && uncachedEmbedder.spendRecordList()[0].tokens === 15);
					harness.report();
				});
			});
		});
	});
});
