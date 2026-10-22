#!/usr/bin/env node
'use strict';

// pureProxyFingerprintProbe.js — TEST SUPPORT for test-sifVocabularyInvariance.js (SIF replacement phase
// V1, gate (e); PLAN-sifReplacement-smallPhases §1.6 ii-a). Forges each named standard in PURE mode
// (embedder null, skipEmbedding true: no Docker, no network) the way the forger resolves it, and writes
// lib/forge-framework/fingerprint.pureLayerFingerprint over each result to --outputFilePath as JSON.
// Every value is a PROXY by the fingerprint's own header.
//
// It runs as a CHILD PROCESS so its module cache is its own. With --edgeTypeTwin it first compiles a
// vocabulary double in memory (moduleDouble: EDGE_TYPES.HAS_PROPERTY's value changed) and installs it in
// require.cache under the real vocabulary path, so every framework and forge module that requires the
// vocabulary afterwards receives the double. That is the gate's twin: a changed vocabulary value must move
// a proxy, or the proxy could not have seen a vocabulary change at all.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = `
NAME
     ${moduleName} -- PROXY pureLayerFingerprint of each named standard's pure forge output

SYNOPSIS
     ${moduleName} --standardList=ceds,edfi,sif,pesc260805 --outputFilePath=<abs .json> [-edgeTypeTwin]

EXIT
     0 every standard forged and fingerprinted;  1 refused (missing flag, forge refusal).
`;

const codeRootPath = path.join(__dirname, '..', '..', '..', '..');
require(path.join(codeRootPath, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;

const VOCABULARY_PATH = path.join(codeRootPath, 'lib', 'vocabulary', 'vocabulary.js');
const EDGE_TYPE_TWIN_MUTATION = Object.freeze({
	modulePath: VOCABULARY_PATH,
	find: "\tHAS_PROPERTY: 'HAS_PROPERTY',\n",
	replace: "\tHAS_PROPERTY: 'HAS_PROPERTY_V1TWIN',\n",
});

const firstValue = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const standardListValue = commandLineParameters.values.standardList;
const standardListText = Array.isArray(standardListValue) ? standardListValue.join(',') : standardListValue;
const outputFilePath = firstValue('outputFilePath');
if (typeof standardListText !== 'string' || standardListText.trim() === '') {
	xLog.error(`${moduleName}: --standardList is required (comma-separated forge tokens)`);
	process.exit(1);
}
if (typeof outputFilePath !== 'string' || !path.isAbsolute(outputFilePath)) {
	xLog.error(`${moduleName}: --outputFilePath is required and must be absolute`);
	process.exit(1);
}
const edgeTypeTwinIsActive = commandLineParameters.switches.edgeTypeTwin === true;

// the twin installs its double BEFORE anything below requires the vocabulary
if (edgeTypeTwinIsActive) {
	const moduleDouble = require(path.join(codeRootPath, 'lib', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
	const doubledVocabulary = moduleDouble.loadWithMutations({ modulePath: VOCABULARY_PATH, mutationList: [EDGE_TYPE_TWIN_MUTATION] });
	const doubleModule = new Module(VOCABULARY_PATH, module);
	doubleModule.filename = VOCABULARY_PATH;
	doubleModule.loaded = true;
	doubleModule.exports = doubledVocabulary;
	require.cache[VOCABULARY_PATH] = doubleModule;
}

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const forger = require(path.join(codeRootPath, 'apps', 'graph-builder', 'apps', 'forger', 'forger'));
const { pureLayerFingerprint, PROXY_LABEL } = require(path.join(codeRootPath, 'lib', 'forge-framework', 'fingerprint'));
const vocabularyInUse = require(VOCABULARY_PATH);

const taskList = new taskListPlus();
standardListText.split(',').map((oneToken) => oneToken.trim()).forEach((standardToken) => {
	taskList.push((args, next) => {
		const resolvedBundle = forger.resolveBundle({ standard: standardToken });
		if (resolvedBundle.error) {
			next(`${standardToken}: resolveBundle refused: ${resolvedBundle.error}`);
			return;
		}
		const bundle = require(resolvedBundle.entryPath)({ embedder: null });
		bundle.forge({ sourcePath: resolvedBundle.defaultSource, owner: 'test', skipEmbedding: true }, (forgeError, forgeResult) => {
			if (forgeError) {
				next(`${standardToken}: forge refused: ${forgeError}`);
				return;
			}
			const proxyFingerprint = pureLayerFingerprint({ nodes: forgeResult.nodes, edges: forgeResult.edges });
			xLog.status(`${PROXY_LABEL} ${standardToken} ${proxyFingerprint} nodes=${forgeResult.nodes.length} edges=${forgeResult.edges.length}`);
			next('', { ...args, fingerprintByStandard: { ...args.fingerprintByStandard, [standardToken]: proxyFingerprint } });
		});
	});
});

pipeRunner(taskList.getList(), { fingerprintByStandard: {} }, (pipelineError, args) => {
	if (pipelineError) {
		xLog.error(`${moduleName}: REFUSED: ${pipelineError}`);
		process.exit(1);
	}
	const probeReport = {
		label: PROXY_LABEL,
		edgeTypeTwinIsActive,
		hasPropertyValueInUse: vocabularyInUse.EDGE_TYPES.HAS_PROPERTY,
		fingerprintByStandard: args.fingerprintByStandard,
	};
	fs.writeFileSync(outputFilePath, JSON.stringify(probeReport, null, '\t') + '\n');
});
