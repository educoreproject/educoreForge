#!/usr/bin/env node
'use strict';

// emitGraphContractJson.js — write graphContract.json, the generated copy of lib/vocabulary/graph-contract.js the DME
// (a separate repository with no require path into this one) reads, and print its sha256 (CONTRACTS-declared §0;
// campaign P0, 2026-10-06). The file is graph-contract's canonicalJsonText() byte for byte, so the sha the DME computes
// over the file's bytes is the sha the forge computes over the text, and a passport's graphContractSha256 can be
// compared by either side.
//
// Run: node lib/vocabulary/tools/emitGraphContractJson.js --outputFilePath=<educore>/.../data-model-explorer/contract/graphContract.json

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- write the canonical graphContract.json and print its sha256

SYNOPSIS
     ${moduleName} --outputFilePath=<path to graphContract.json>

DESCRIPTION
     Writes lib/vocabulary/graph-contract.js's canonicalJsonText() to --outputFilePath, byte for byte, and prints
     'graphContract.json sha256 <64 hex> -> <path>'. --outputFilePath is REQUIRED (no default: the copy belongs to a
     different repository, and the operator names it). Its directory must already exist; nothing is created but the file.

EXIT
     0 written;  1 refused.
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const graphContract = require('../graph-contract');

const refuseAndExit = (refusalText) => {
	xLog.error(`${moduleName}: REFUSED: ${refusalText}`);
	process.exit(1);
};

const outputFilePathValue = (commandLineParameters.values.outputFilePath || [])[0];
if (typeof outputFilePathValue !== 'string' || outputFilePathValue.trim() === '') {
	refuseAndExit('--outputFilePath is REQUIRED and has no default: the copy lives in the DME repository, and the operator names where');
}
const outputFilePath = path.resolve(outputFilePathValue);
if (!fs.existsSync(path.dirname(outputFilePath))) {
	refuseAndExit(`the directory '${path.dirname(outputFilePath)}' does not exist; prepare it (the DME's contract/ directory) and run again`);
}

fs.writeFileSync(outputFilePath, graphContract.canonicalJsonText(), 'utf8');
xLog.result(`graphContract.json sha256 ${graphContract.graphContractSha256()} -> ${outputFilePath}`);
