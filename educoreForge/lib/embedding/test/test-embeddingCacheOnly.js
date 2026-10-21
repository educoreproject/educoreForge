#!/usr/bin/env node
'use strict';

// test-embeddingCacheOnly.js — hermetic gate for the embedding CACHE-ONLY mode (hub-neutral bridge lane R3, P-c, SCARLET_ARROW
// ruling 2026-10-21). graphBuilder -build --embeddingCacheOnly=true makes a vector-cache miss a STOP instead of a Voyage call:
// the embedding client refuses BY NAME on the first batch carrying a miss, before any provider call, naming how many distinct
// texts it would have had to embed. Default off: a client that is not asked behaves exactly as before.
//
// PROVES (a recorded-fixture provider standing in for Voyage through componentOverrides.provider; no socket, no spend):
//   a  default (not asked): a miss is embedded and cached, as before
//   b  cache-only, every text cached: served, the provider never called, the spend record says 0 misses
//   c  cache-only, one new text: REFUSED by name with the distinct miss count, the provider NOT called, nothing recorded as spent
//   d  cache-only with caching disabled is refused at construction (everything would be a miss)
//   e  the command-line channel: --embeddingCacheOnly=true reaches a client built with no option; a malformed value THROWS by
//      name (a configuration fault, the client's channel for one); absent means off
//
// Run: node lib/embedding/test/test-embeddingCacheOnly.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the embedding cache-only mode

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const embeddingClientLib = require('../embedding-client');

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfEmbeddingCacheOnly-'));
const iniFilePath = path.join(scratchDir, 'voyageEmbedding.ini');
fs.writeFileSync(iniFilePath, '[voyageEmbedding]\napiKey=NOT-A-REAL-KEY\nmodel=voyage-4-large\nembeddingDims=4\n');
const cacheFilePath = path.join(scratchDir, 'vectorCache.sqlite3');

const fixtureProvider = () => ({
	sentTextCountList: [],
	embed(texts, resolvedConfig, callback) {
		this.sentTextCountList.push(texts.length);
		setImmediate(() => callback('', texts.map(() => new Array(resolvedConfig.dimension).fill(0.25)), { totalTokens: texts.length * 5 }));
	},
});
const thrownMessage = (thrower) => {
	try {
		thrower();
		return '';
	} catch (thrownError) {
		return thrownError.message;
	}
};
const { spawnSync } = require('child_process');
const PROBE_FILE_PATH = path.join(__dirname, 'testSupport', 'cacheOnlyCommandLineProbe.js');
const probeOutcomeFor = (extraArgumentList, text) => {
	const probeRun = spawnSync(process.execPath, [PROBE_FILE_PATH, `--iniFilePath=${iniFilePath}`, `--cacheFilePath=${cacheFilePath}`, `--text=${text}`].concat(extraArgumentList), { encoding: 'utf8' });
	const jsonLine = (probeRun.stdout || '').split('\n').find((oneLine) => /^\{"/.test(oneLine));
	return jsonLine === undefined ? { constructionError: `probe printed no outcome: ${probeRun.stderr}`, embedError: '', providerCallCount: -1 } : JSON.parse(jsonLine);
};

// =====================================================================
harness.section('a — default: a miss is embedded and cached');
// =====================================================================
const warmingProvider = fixtureProvider();
const warmingEmbedder = embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath, componentOverrides: { provider: warmingProvider } });
warmingEmbedder.embedTexts({ texts: ['alpha', 'beta'] }, (warmingError) => {
	harness.accepts('the default client embeds its misses', warmingError ? [warmingError] : []);
	harness.equal('the provider was called once, for two texts', warmingProvider.sentTextCountList.join(','), '2');

	// =====================================================================
	harness.section('b — cache-only, every text cached');
	// =====================================================================
	const servedProvider = fixtureProvider();
	const servedEmbedder = embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath, cacheOnly: true, componentOverrides: { provider: servedProvider } });
	servedEmbedder.embedTexts({ texts: ['beta', 'alpha', 'alpha'] }, (servedError, servedResult) => {
		harness.accepts('a fully cached batch is served', servedError ? [servedError] : []);
		harness.equal('three vectors', servedResult && servedResult.vectors.length, 3);
		harness.equal('the provider was never called', servedProvider.sentTextCountList.length, 0);
		harness.ok('the spend record: 0 distinct misses, 0 tokens', servedEmbedder.spendRecordList().length === 1 && servedEmbedder.spendRecordList()[0].distinctMisses === 0 && servedEmbedder.spendRecordList()[0].tokens === 0, JSON.stringify(servedEmbedder.spendRecordList()));

		// =====================================================================
		harness.section('c — cache-only, a miss is a STOP');
		// =====================================================================
		const stoppedProvider = fixtureProvider();
		const stoppedEmbedder = embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath, cacheOnly: true, componentOverrides: { provider: stoppedProvider } });
		stoppedEmbedder.embedTexts({ texts: ['alpha', 'gamma', 'delta', 'gamma'] }, (stoppedError) => {
			harness.match('the batch is REFUSED by name, naming the distinct miss count', String(stoppedError), /cache-only.*2 distinct text\(s\) are not in the vector cache/);
			harness.equal('the provider was NOT called', stoppedProvider.sentTextCountList.length, 0);
			harness.equal('nothing was recorded as spent', stoppedEmbedder.spendRecordList().length, 0);

			// =====================================================================
			harness.section('d — cache-only with no cache');
			// =====================================================================
			harness.match('cache-only with caching disabled is refused at construction', thrownMessage(() => embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath: false, cacheOnly: true })), /cacheOnly.*caching is disabled/);
			harness.match('a non-boolean cacheOnly is refused at construction', thrownMessage(() => embeddingClientLib({ configFilePath: iniFilePath, cacheFilePath, cacheOnly: 'yes' })), /cacheOnly is "yes"/);

			// =====================================================================
			harness.section('e — the command-line channel');
			// =====================================================================
			const flaggedOutcome = probeOutcomeFor(['--embeddingCacheOnly=true'], 'epsilon');
			harness.match('--embeddingCacheOnly=true reaches a client built with no option: a miss is a STOP', flaggedOutcome.embedError, /cache-only.*1 distinct text\(s\) are not in the vector cache/);
			harness.equal('and the provider was not called', flaggedOutcome.providerCallCount, 0);
			harness.match('--embeddingCacheOnly=maybe THROWS by name at construction', probeOutcomeFor(['--embeddingCacheOnly=maybe'], 'epsilon').constructionError, /--embeddingCacheOnly is "maybe"; it is 'true' or 'false'/);
			const absentOutcome = probeOutcomeFor([], 'zeta');
			harness.ok('absent, the client is off: the miss is embedded (by the fixture provider)', absentOutcome.constructionError === '' && absentOutcome.embedError === '' && absentOutcome.providerCallCount === 1, JSON.stringify(absentOutcome));
			fs.rmSync(scratchDir, { recursive: true, force: true });
			harness.report();
		});
	});
});
