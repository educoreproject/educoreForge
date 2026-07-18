#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfResolve.js — the `edf-resolve` CLI: PHASE-8 RESOLVE VERB (surface 1 of 3). A READ-ONLY query verb that
// wraps the shared resolve-core (the ONE logic) and prints ranked HubReference addresses + confidence +
// suggested predicate + ABSTAIN flag for a term/description. Adds NO graph content; never connects to Neo4j;
// never touches the frozen golden/baselines. Makes an LLM rerank call at query time (interactive, not part
// of the deterministic build/replay).
//
//   edfResolve  -resolve --term="Student Identifier" [--definition="..."] [--datatype=string]
//               [--context="..."] [--targetHub=CEDS] [--topK=15] [--cosineFloor=0]
//               [--gatingManifest=K] [--model=claude-opus-4-8]
//
// Action flags single-hyphen; parameters double-hyphen (the project's edf-* CLI convention). No async/await,
// no try/catch for control flow. camelCase only. Mirrors bridgeMaker's bootstrap (ex edf-implied).

const path = require('path');
const fs = require('fs');
const os = require('os');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();
const configFileProcessor = require('qtools-config-file-processor');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CONFIGS_DIR = path.join(projectRoot, 'configs');

const buildResolveResources = require(path.join(__dirname, 'lib', 'build-resolve-resources'));
const { resolveViaCli } = require(path.join(__dirname, 'lib', 'surfaces', 'cliResolveSurface'));

const strParam = (name, fallback) => (commandLineParameters.values[name] || [])[0] || fallback;
const intParam = (name, fallback) => {
	const v = (commandLineParameters.values[name] || [])[0];
	return v === undefined ? fallback : parseInt(v, 10);
};
const floatParam = (name, fallback) => {
	const v = (commandLineParameters.values[name] || [])[0];
	return v === undefined ? fallback : parseFloat(v);
};

// =====================================================================
const bootstrapGlobal = () => {
	const verbose = !!commandLineParameters.switches.verbose;
	const xLog = {
		status: (...a) => console.error(...a),
		error: (...a) => console.error(...a),
		result: (...a) => console.log(...a),
		verbose: verbose ? (...a) => console.error(...a) : () => {},
	};
	let wholeConfig = {};
	const hostConfigName =
		os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local' ? 'instanceSpecific/qbook' : '';
	const systemIni = path.join(CONFIGS_DIR, hostConfigName, 'systemParameters.ini');
	if (fs.existsSync(systemIni)) {
		wholeConfig = configFileProcessor.getConfig(systemIni) || {};
	}
	process.global = {
		xLog,
		getConfig: (name) => (name === 'allConfigs' ? wholeConfig : wholeConfig[name] || {}),
		commandLineParameters,
		rawConfig: wholeConfig,
	};
};

// =====================================================================
const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;

	if (!commandLineParameters.switches.resolve) {
		xLog.error(
			'edf-resolve: unknown action. Action: -resolve. Params: --term= [--definition=] [--datatype=] ' +
				'[--context=] [--targetHub=CEDS] [--topK=15] [--cosineFloor=0] [--gatingManifest=K] [--model=]',
		);
		process.exit(2);
	}

	const term = strParam('term', undefined);
	const definition = strParam('definition', undefined);
	if (!term && !definition) {
		xLog.error('edf-resolve -resolve: requires --term="..." (and/or --definition="...")');
		process.exit(2);
	}

	// L10 — numeric parameters must actually be numeric: a NaN topK/cosineFloor previously
	// flowed silently into retrieval (parseInt/parseFloat never rejected). Reject loudly.
	const rawTopK = (commandLineParameters.values.topK || [])[0];
	if (rawTopK !== undefined && (!Number.isInteger(Number(rawTopK)) || Number(rawTopK) < 1)) {
		xLog.error(`edf-resolve -resolve: --topK must be a positive integer (got "${rawTopK}")`);
		process.exit(2);
	}
	const rawCosineFloor = (commandLineParameters.values.cosineFloor || [])[0];
	if (rawCosineFloor !== undefined && !Number.isFinite(Number(rawCosineFloor))) {
		xLog.error(`edf-resolve -resolve: --cosineFloor must be a number (got "${rawCosineFloor}")`);
		process.exit(2);
	}

	buildResolveResources(
		{
			gatingManifest: strParam('gatingManifest', undefined),
			model: strParam('model', undefined),
			topK: intParam('topK', 15),
			cosineFloor: floatParam('cosineFloor', 0),
		},
		(buildErr, resources) => {
			if (buildErr) {
				xLog.error(`edf-resolve: ${buildErr}`);
				process.exit(1);
			}
			resolveViaCli(
				{
					resolveCore: resources.resolveCore,
					input: {
						term,
						definition,
						datatype: strParam('datatype', undefined),
						context: strParam('context', undefined),
						targetHub: strParam('targetHub', 'CEDS'),
						topK: intParam('topK', 15),
						cosineFloor: floatParam('cosineFloor', 0),
					},
				},
				(resolveErr, envelope) => {
					if (resolveErr) {
						xLog.error(`edf-resolve: ${resolveErr}`);
						process.exit(1);
					}
					xLog.result(JSON.stringify(envelope, null, 2));
					process.exit(0);
				},
			);
		},
	);
};

main();
