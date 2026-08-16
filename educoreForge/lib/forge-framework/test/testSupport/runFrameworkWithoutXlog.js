#!/usr/bin/env node
'use strict';

// runFrameworkWithoutXlog.js — TEST SUPPORT child-process runner for G-NOSUB's behavioural conjunct:
// in a process with NO process.global and NO xLog dep, constructing the framework MUST be refused
// naming xLog (no do-nothing logger is manufactured). Prints REFUSED <message> or CONSTRUCTED.
// `--mutationsJson=<json>` applies framework mutations through moduleDouble (the twin: a framework
// that manufactures `|| { status(){}, error(){} }` when xLog is absent).

const path = require('path');
const moduleDouble = require('./moduleDouble');
const frameworkPath = path.resolve(__dirname, '..', '..', 'forge-framework.js');
const mutationsArg = process.argv.find((oneArg) => oneArg.startsWith('--mutationsJson='));
const mutationList = mutationsArg ? JSON.parse(mutationsArg.slice('--mutationsJson='.length)) : [];
const factory = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: frameworkPath, mutationList }) : require(frameworkPath);
let outcome;
try {
	factory({ embedder: null });
	outcome = 'CONSTRUCTED';
} catch (constructError) {
	outcome = `REFUSED ${constructError.message}`;
}
process.stdout.write(`${outcome}\n`);
