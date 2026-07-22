#!/usr/bin/env node
'use strict';

// test-replay-manager.js — FAST gates for replayManager: the GNC-001 name guard proven to
// REFUSE in every direction, and the honest not-implemented refusal on extract. NOTHING here
// runs docker; real provision/destroy is proven by the deliberate integration script
// (the forger's integration-forge-lif.js exercises create -> forge -> gates -> delete).
//
// Run: node apps/graph-builder/apps/replay-manager/test/test-replay-manager.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- fast gates for replayManager (name guard, honest extract refusal)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the GNC-001 name guard refuses GOLD_*, gf_* and non-DEV names for BOTH create and
     delete before any docker command could run, admits DEV_* names (positive control), and
     that extract fails honestly rather than minting a fake block ref. No docker, no Neo4j.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const replayManagerModule = require('../replayManager');
const { nameRefusal } = replayManagerModule;
const manager = replayManagerModule();

// =====================================================================
harness.section('THE NAME GUARD — refuses production/live tiers by name (failure side FIRST)');
// =====================================================================

harness.match('GOLD_* refused', nameRefusal('GOLD_260718', 'create'), /REFUSED.*production\/live/);
harness.match('gf_* refused', nameRefusal('gf_devGolden', 'create'), /REFUSED/);
harness.match('case variants refused (Gf_, gold_)', nameRefusal('Gf_sneaky', 'create'), /REFUSED/);
harness.match('a non-DEV name is refused', nameRefusal('scratch1', 'create'), /not a DEV_\* scratch graph/);
harness.match('an empty name is refused', nameRefusal('', 'create'), /no graphName/);
harness.equal('a DEV_* name is ADMITTED (positive control)', nameRefusal('DEV_gb_forge_1', 'create'), '');
harness.match(
	'the refusal message names the verb that was refused',
	nameRefusal('GOLD_x', 'delete'),
	/replayManager\.delete/,
);

// the guard fires INSIDE create/delete before any docker command
manager.create({ graphName: 'GOLD_260718' }, (err) => {
	harness.match('create() itself refuses a GOLD_* graphName', err, /REFUSED/);
});
manager.create({ graphName: 'notDevNamed' }, (err) => {
	harness.match('create() itself refuses a non-DEV graphName', err, /not a DEV_\*/);
});
manager.delete({ graphName: 'gf_devGolden' }, (err) => {
	harness.match('delete() itself refuses a gf_* graphName', err, /REFUSED/);
});
manager.delete({}, (err) => {
	harness.match('delete() with no name is refused', err, /no graphName/);
});

// =====================================================================
harness.section('EXTRACT — fails honestly until the replayManager milestone lands');
// =====================================================================

manager.extract({ graphName: 'DEV_x' }, 'standardBase', (err, result) => {
	harness.match('extract refuses with a reason', err, /not implemented yet/);
	harness.match('  naming the milestone that owns it', err, /replayManager milestone/);
	harness.ok('  and returns NO fake block ref', result === undefined);
});

harness.report();
