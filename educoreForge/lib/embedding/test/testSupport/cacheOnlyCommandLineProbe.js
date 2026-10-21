#!/usr/bin/env node
'use strict';

// cacheOnlyCommandLineProbe.js — test-embeddingCacheOnly (e)'s child: a real qtools app started with the operator's command line,
// so --embeddingCacheOnly reaches embedding-client the way it does in graphBuilder (process.global is frozen; a suite cannot
// set it in-process). Builds a client with NO cacheOnly option over the cache named by --cacheFilePath, embeds the --text, and
// prints one JSON line: { constructionError, embedError, providerCallCount }.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: `${moduleName} -- child probe of test-embeddingCacheOnly` });

const path = require('path');
const embeddingClientLib = require(path.join(__dirname, '..', '..', 'embedding-client'));

const valueOf = (name) => (commandLineParameters.values[name] || [])[0];
const providerCallList = [];
const provider = { embed: (texts, resolvedConfig, callback) => { providerCallList.push(texts.length); setImmediate(() => callback('', texts.map(() => new Array(resolvedConfig.dimension).fill(0.25)), { totalTokens: texts.length })); } };
const report = (outcome) => process.stdout.write(`${JSON.stringify({ ...outcome, providerCallCount: providerCallList.length })}\n`);
let embedder;
try {
	embedder = embeddingClientLib({ configFilePath: valueOf('iniFilePath'), cacheFilePath: valueOf('cacheFilePath'), componentOverrides: { provider } });
} catch (constructionError) {
	report({ constructionError: constructionError.message, embedError: '' });
	return;
}
embedder.embedTexts({ texts: [valueOf('text')] }, (embedError) => report({ constructionError: '', embedError: embedError ? String(embedError) : '' }));
