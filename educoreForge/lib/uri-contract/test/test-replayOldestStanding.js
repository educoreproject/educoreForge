#!/usr/bin/env node
'use strict';

// test-replayOldestStanding.js — THE STANDING REPLAY-THE-OLDEST TEST (TQ: "a good discipline no matter what"; WORKORDER-ML3.1 section 3).
// It runs graphBuilder -replayOldest against the REAL uriContract ([stores] uriContractFilePath in graphBuilder.ini, no flag): the
// OLDEST published manifest is replayed hermetically through replay()'s own deserialize and guards, and its node and edge counts must
// equal the counts recorded when it was published. A code change that makes replay unable to read a block format it once wrote turns
// this RED, whatever else that change fixes (uriContract README_AI rule 7). It reads only; it writes nothing.
//
// Since the FIRST publication (ML3.1 Part C, 2026-10-26) the configured file must exist: its absence FAILS (it was a declared gap
// before). An instance that configures no uriContract path is still a declared gap (harness.note), never a pass. The mechanism itself (pass, and the RED twin of a recorded count the replay does not reproduce) is gated hermetically in
// test-uriContractActions on a stated world.
//
// Run: node lib/uri-contract/test/test-replayOldestStanding.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the standing replay-the-oldest test against the real uriContract

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Spawns graphBuilder -replayOldest with no path flag, so the configured uriContract is read. The oldest published manifest's
     hermetic replay must equal its recorded counts. Before the first publication the file is absent: a declared gap, not a pass.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const { spawnSync } = require('child_process');
const harness = require('../../../test/testLib/harness')(moduleName);

const GRAPH_BUILDER = path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'graphBuilder.js');
const run = spawnSync('node', ['--max-old-space-size=12000', GRAPH_BUILDER, '-replayOldest'], { input: '', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const outputText = `${run.stdout}\n${run.stderr}`;

harness.section('the oldest published manifest replays to the counts recorded at its publication');
// ⟪ML3.1c⟫ the FIRST publication happened on 2026-10-26 (educore-2026-10-26, manifest 3a5e87cb), so a configured file that does not exist
// is no longer a gap but a FAILURE: the forever store is missing
if (run.status !== 0 && /no uriContract path resolved/.test(outputText)) {
	harness.note('DECLARED GAP: graphBuilder.ini names no [stores] uriContractFilePath on this instance; replay-the-oldest is NOT exercised by this run');
} else {
	harness.ok('graphBuilder -replayOldest exits 0 on the real uriContract', run.status === 0, outputText.slice(-3000));
	harness.match('…saying the hermetic count equals the recorded count', outputText, /"verdict": "hermetic count equals recorded"/);
	harness.match('…over a NON-EMPTY manifest (the first publication, ML3.1 Part C)', outputText, /"nodeCount": [1-9][0-9]*/);
}
harness.report();
