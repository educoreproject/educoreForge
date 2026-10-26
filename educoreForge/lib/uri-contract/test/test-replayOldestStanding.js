#!/usr/bin/env node
'use strict';

// test-replayOldestStanding.js — THE STANDING REPLAY-THE-OLDEST TEST (TQ: "a good discipline no matter what"; WORKORDER-ML3.1 section 3).
// It runs graphBuilder -replayOldest against the REAL uriContract ([stores] uriContractFilePath in graphBuilder.ini, no flag): the
// OLDEST published manifest is replayed hermetically through replay()'s own deserialize and guards, and its node and edge counts must
// equal the counts recorded when it was published. A code change that makes replay unable to read a block format it once wrote turns
// this RED, whatever else that change fixes (uriContract README_AI rule 7). It reads only; it writes nothing.
//
// BEFORE THE FIRST PUBLICATION (ML3.1 Part C) the real file does not exist; that is reported as a DECLARED GAP (harness.note), never
// as a pass. The mechanism itself (pass, and the RED twin of a recorded count the replay does not reproduce) is gated hermetically in
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
if (run.status !== 0 && /uriContract .* does not exist/.test(outputText)) {
	harness.note('DECLARED GAP: the configured uriContract does not exist yet (nothing is published before ML3.1 Part C); replay-the-oldest is NOT exercised on real data by this run');
} else if (run.status !== 0 && /no uriContract path resolved/.test(outputText)) {
	harness.note('DECLARED GAP: graphBuilder.ini names no [stores] uriContractFilePath on this instance; replay-the-oldest is NOT exercised by this run');
} else {
	harness.ok('graphBuilder -replayOldest exits 0 on the real uriContract', run.status === 0, outputText.slice(-3000));
	harness.match('…saying the hermetic count equals the recorded count', outputText, /"verdict": "hermetic count equals recorded"/);
}
harness.report();
