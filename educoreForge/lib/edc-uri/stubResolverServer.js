#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// stubResolverServer.js — the HTTP shell of the local edc: stub resolver (mappingLayers ML1, AMENDMENT; R-5). Serves GET
// /EDUcore/<edc path> (the w3id spelling) and /<edc path> on a PRIVATE hostname; it never overrides w3id.org. TQ's hosts line:
//     127.0.0.1 edc.local
// so http://edc.local:7931/EDUcore/layer/jev answers. Every parameter is REQUIRED (no default port, no default store):
//     node lib/edc-uri/stubResolverServer.js --port=7931 --decisionStoreFilePath=<decisions.sqlite3>
//          --layerRegistryFilePath=<recipes/layers.json> --agentRegistryFilePath=<recipes/agents.json>
// The decision store is opened READ-ONLY; this shell is the only place a store is touched (stubResolver.js is pure). A JSON body
// always, with the HTTP status the resolution chose. The request path is passed VERBATIM (never decoded: a segment stays in its
// canonical percent-encoding). -help prints this header.

const http = require('http');
const path = require('path');
const fs = require('fs');

const helpText = () => fs.readFileSync(__filename, 'utf8').split('\n').filter((oneLine) => oneLine.startsWith('//')).map((oneLine) => oneLine.replace(/^\/\/ ?/, '')).join('\n');
const parameterValueFor = (parameterName) => {
	const prefix = `--${parameterName}=`;
	const argument = process.argv.slice(2).find((oneArgument) => oneArgument.indexOf(prefix) === 0);
	return argument === undefined ? undefined : argument.slice(prefix.length);
};
if (process.argv.slice(2).some((oneArgument) => ['-help', '--help', '-h'].indexOf(oneArgument) !== -1)) {
	process.stdout.write(`${helpText()}\n`);
	process.exit(0);
}
const REQUIRED_PARAMETER_NAME_LIST = ['port', 'decisionStoreFilePath', 'layerRegistryFilePath', 'agentRegistryFilePath'];
const missingParameterList = REQUIRED_PARAMETER_NAME_LIST.filter((parameterName) => !parameterValueFor(parameterName));
if (missingParameterList.length) {
	process.stderr.write(`${moduleName}: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default\n`);
	process.exit(1);
}
const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const layerRegistryLib = require(path.join(__dirname, '..', 'layer-registry', 'layerRegistry'));
const { resolveEdcUri } = require(path.join(__dirname, 'stubResolver'));

const loaded = layerRegistryLib.loadRegistry({ layerRegistryFilePath: parameterValueFor('layerRegistryFilePath'), agentRegistryFilePath: parameterValueFor('agentRegistryFilePath') });
if (loaded.error) {
	process.stderr.write(`${moduleName}: ${loaded.error}\n`);
	process.exit(1);
}
const decisionStore = new Database(parameterValueFor('decisionStoreFilePath'), { readonly: true, fileMustExist: true });
const blockTextStatement = decisionStore.prepare('SELECT CAST(frozenText AS TEXT) AS frozenText FROM decisionBlocks WHERE decisionBlockHash = ?');
const blockTextForHash = (decisionBlockHash, done) => {
	const row = blockTextStatement.get(decisionBlockHash);
	done('', row === undefined ? null : row.frozenText);
};

const server = http.createServer((request, response) => {
	if (request.method !== 'GET') {
		response.writeHead(405, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: `${request.method} is not served; the resolver answers GET` }));
		return;
	}
	resolveEdcUri({ uriOrPath: request.url, registry: loaded.registry, blockTextForHash }, (resolveError, resolved) => {
		const httpStatus = resolveError ? 500 : resolved.httpStatus;
		response.writeHead(httpStatus, { 'Content-Type': 'application/json; charset=utf-8' });
		response.end(`${JSON.stringify(resolveError ? { error: resolveError } : resolved.body, null, 2)}\n`);
	});
});
server.listen(Number(parameterValueFor('port')), '127.0.0.1', () => process.stdout.write(`${moduleName}: listening on 127.0.0.1:${parameterValueFor('port')} (serve as http://edc.local:${parameterValueFor('port')}/EDUcore/<edc path>)\n`));
