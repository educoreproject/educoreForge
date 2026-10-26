#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// stubResolverServer.js — the HTTP shell of the local edc: stub resolver (mappingLayers ML1, AMENDMENT; R-5). Serves GET
// /EDUcore/<edc path> (the w3id spelling) and /<edc path> on a PRIVATE hostname; it never overrides w3id.org. TQ's hosts line:
//     127.0.0.1 edc.local
// so http://edc.local:7931/EDUcore/layer/jev answers. Every parameter is REQUIRED (no default port, no default store):
//     node lib/edc-uri/stubResolverServer.js --port=7931 --uriContractFilePath=<uriContract.sqlite>
// ⟪ML3.1b⟫ EVERYTHING resolves from uriContract.sqlite ALONE (WORKORDER-ML3.1 section 3: "the stub resolves everything from
// uriContract.sqlite alone"): the registry (layers, versions, status, agents), every decision schema block's frozen text, and the
// uriContractReader (lib/uri-contract) the kind cases read schema blocks, manifests and computed relations through. No support store,
// no decision store, no registry JSON is read. uriContract is opened READ-ONLY; this shell is the only place a store is touched
// (stubResolver.js is pure). A JSON body always, with the HTTP status the resolution chose. The request path is passed VERBATIM
// (never decoded). -help prints this header.

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
const REQUIRED_PARAMETER_NAME_LIST = ['port', 'uriContractFilePath'];
const missingParameterList = REQUIRED_PARAMETER_NAME_LIST.filter((parameterName) => !parameterValueFor(parameterName));
if (missingParameterList.length) {
	process.stderr.write(`${moduleName}: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default\n`);
	process.exit(1);
}
const uriContractLib = require(path.join(__dirname, '..', 'uri-contract', 'uriContract'));
const { resolveEdcUri } = require(path.join(__dirname, 'stubResolver'));

const openedContract = uriContractLib.uriContractReaderFor({ uriContractFilePath: parameterValueFor('uriContractFilePath') });
const loaded = openedContract.error ? openedContract : openedContract.uriContract.loadRegistry();
if (loaded.error) {
	process.stderr.write(`${moduleName}: ${loaded.error}\n`);
	process.exit(1);
}
const { uriContractReader } = openedContract;
// the frozen text of a decision schema block, verified on read, from uriContract (null when no published version holds it)
const blockTextForHash = (decisionBlockHash, done) => {
	const read = openedContract.uriContract.decisionSchemaBlockTextFor(decisionBlockHash);
	done(read.error || '', read.error ? null : read.frozenText);
};

const server = http.createServer((request, response) => {
	if (request.method !== 'GET') {
		response.writeHead(405, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: `${request.method} is not served; the resolver answers GET` }));
		return;
	}
	resolveEdcUri({ uriOrPath: request.url, registry: loaded.registry, blockTextForHash, uriContractReader }, (resolveError, resolved) => {
		const httpStatus = resolveError ? 500 : resolved.httpStatus;
		response.writeHead(httpStatus, { 'Content-Type': 'application/json; charset=utf-8' });
		response.end(`${JSON.stringify(resolveError ? { error: resolveError } : resolved.body, null, 2)}\n`);
	});
});
server.listen(Number(parameterValueFor('port')), '127.0.0.1', () => process.stdout.write(`${moduleName}: listening on 127.0.0.1:${parameterValueFor('port')} (serve as http://edc.local:${parameterValueFor('port')}/EDUcore/<edc path>)\n`));
