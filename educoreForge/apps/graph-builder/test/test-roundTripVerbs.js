#!/usr/bin/env node
'use strict';

// test-roundTripVerbs.js — ⟪R5 S9, 2026-10-21⟫ graphBuilder's round-trip verbs name no standard. -roundTripCompile and
// -roundTripGates take --standard=<token> and run the verbs that standard's bundle declares (parserDescriptor.ini
// roundTripVerbModule=); the CEDS-named switches they replaced are gone. Hermetic: every case is refused or answered before
// any graph is reached (no Docker, no container, no spend). The live equivalence (old switch vs new, same bytes on the DEV
// gold) is evidence/R5/roundTripVerbs/ in the lane folder.
//   (a) --standard absent is REFUSED by name (no default standard)
//   (b) a standard whose bundle declares no verbs is REFUSED by name, naming its descriptor
//   (c) a standard with no bundle is REFUSED by the forger's own resolution message
//   (d) the CEDS bundle declares the verbs and the module exports both functions the table names
//   (e) --standard=ceds reaches the CEDS verb itself: its own --containerName refusal, under the new name
//   (f) the old switches -cedsRoundTrip and -cedsGates are no longer actions (graphBuilder answers with help, exit 0)
//
// Run: node apps/graph-builder/test/test-roundTripVerbs.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: -roundTripCompile / -roundTripGates --standard=<token> run the verbs a standard's bundle declares
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions pass;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { spawnSync } = require('child_process');

const GRAPH_BUILDER_PATH = path.join(__dirname, '..', 'graphBuilder.js');
const runGraphBuilder = (argumentList) => spawnSync(process.execPath, [GRAPH_BUILDER_PATH].concat(argumentList), { encoding: 'utf8' });
const outputOf = (run) => `${run.stdout || ''}${run.stderr || ''}`;

['roundTripCompile', 'roundTripGates'].forEach((actionName) => {
	harness.section(`-${actionName}`);
	const noStandardRun = runGraphBuilder([`-${actionName}`, '--containerName=DEV_never']);
	harness.match(`(a) -${actionName} with no --standard is REFUSED by name`, outputOf(noStandardRun), new RegExp(`graphBuilder -${actionName}: --standard=<token> is REQUIRED and has no default`));
	harness.ok(`(a) and exits non-zero`, noStandardRun.status !== 0, `exit ${noStandardRun.status}`);
	const undeclaredRun = runGraphBuilder([`-${actionName}`, '--standard=edfi', '--containerName=DEV_never']);
	harness.match(`(b) --standard=edfi (declares no verbs) is REFUSED, naming its descriptor`, outputOf(undeclaredRun), new RegExp(`graphBuilder -${actionName} --standard=edfi: this standard's bundle declares no roundTripVerbModule= in .*forges/edfi/parserDescriptor\\.ini`));
	const unknownRun = runGraphBuilder([`-${actionName}`, '--standard=noSuchStandard', '--containerName=DEV_never']);
	harness.match(`(c) --standard=noSuchStandard is REFUSED by the forger's resolution`, outputOf(unknownRun), new RegExp(`graphBuilder -${actionName} --standard=noSuchStandard: forger: no forge bundle for standard 'noSuchStandard'`));
	const cedsRun = runGraphBuilder([`-${actionName}`, '--standard=ceds']);
	harness.match(`(e) --standard=ceds reaches the CEDS verb (its own --containerName refusal, under the new name)`, outputOf(cedsRun), new RegExp(`graphBuilder -${actionName} --standard=ceds: --containerName=<name> is REQUIRED and has no default`));
});

harness.section('(d) the CEDS bundle declares the verbs');
const { resolveBundle } = require(path.join(__dirname, '..', 'apps', 'forger', 'forger'));
const cedsBundle = resolveBundle({ standard: 'ceds' });
harness.match('(d) forges/ceds declares roundTripVerbModule', `${cedsBundle.roundTripVerbModulePath}`, /forges\/ceds\/lib\/cedsRoundTripVerbs\.js$/);
const cedsVerbModule = require(cedsBundle.roundTripVerbModulePath);
harness.ok('(d) and it exports runRoundTripCompile and runRoundTripGates', typeof cedsVerbModule.runRoundTripCompile === 'function' && typeof cedsVerbModule.runRoundTripGates === 'function');

harness.section('(f) the CEDS-named switches are gone');
['-cedsRoundTrip', '-cedsGates'].forEach((oldSwitch) => {
	const oldRun = runGraphBuilder([oldSwitch, '--containerName=DEV_never']);
	harness.ok(`(f) ${oldSwitch} is no longer an action (help, exit 0, nothing measured)`, oldRun.status === 0 && /SYNOPSIS/.test(outputOf(oldRun)) && !/(measuring|reading) 'DEV_never'/.test(outputOf(oldRun)), `exit ${oldRun.status}`);
});

harness.report();
