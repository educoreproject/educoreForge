#!/usr/bin/env node
'use strict';

// test-decisionFreezer.js — hermetic gate for lib.d/decisionFreezer.js (bridgeKitRefactor_072726
// Phase 1). Proves identity with the real decisionFreezer, then RED-then-GREEN over parse(): a
// corrupt/wrong-shaped frozen block is refused BY NAME (never silently materialized); a
// well-formed frozen block round-trips through the lib.d entry point exactly as freeze() produced
// it. PURE / hermetic: no Neo4j, no network, no LLM.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-decisionFreezer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d decisionFreezer kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves lib.d/decisionFreezer.js IS the real decisionFreezer (identity); RED (parse() refuses a
     malformed / wrong-recordType block by name) then GREEN (freeze -> parse round-trips exactly,
     and perturbing a decision changes the hash).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const decisionFreezerFactory = require('../lib/decisionFreezer');
const kitDecisionFreezerFactory = require('../lib.d/decisionFreezer');

// =====================================================================
harness.section('IDENTITY — lib.d/decisionFreezer.js IS the real decisionFreezer, not a drifted copy');
// =====================================================================
harness.ok(
	'lib.d/decisionFreezer.js delegates to the SAME factory reference',
	kitDecisionFreezerFactory === decisionFreezerFactory,
);

const freezer = kitDecisionFreezerFactory();

// =====================================================================
harness.section('RED — parse() refuses a malformed / wrong-recordType frozen block BY NAME');
// =====================================================================
harness.match(
	'parse() on invalid JSON is refused, naming the reason',
	freezer.parse('{not valid json').error,
	/is not valid JSON/,
);
harness.match(
	'parse() on the wrong recordType is refused, naming the reason',
	freezer.parse(JSON.stringify({ recordType: 'somethingElse' })).error,
	/is not an inferredDecisionRecord/,
);

// =====================================================================
harness.section('GREEN — freeze() -> parse() round-trips exactly through the lib.d entry point; perturbation changes the hash');
// =====================================================================
const pairStamp = { subjectSource: 'LIF', subjectVersion: 'v1', objectSource: 'CEDS', objectVersion: 'v14' };
const decisions = [
	{ source: { stableId: 's1', role: 'DmeProperty' }, abstain: false, targetKey: 'P1', cosineScore: 0.9, retrievalRank: 1, pool: [] },
	{ source: { stableId: 's2', role: 'DmeProperty' }, abstain: true, abstainReason: 'cosineFloor', targetKey: null, pool: [] },
];
const frozen = freezer.freeze({ pairStamp, decisions });
harness.equal('freeze() extracts the ONE non-abstain pick', frozen.inferredDecisions.length, 1);
harness.equal('freeze() non-abstain row carries the targetKey', frozen.inferredDecisions[0].targetKey, 'P1');

const parsed = freezer.parse(frozen.frozenText);
harness.ok('parse() reports no error on a well-formed block', !parsed.error, parsed.error);
harness.equal('parse() round-trips the pairStamp', parsed.pairStamp.subjectSource, 'LIF');
harness.equal(
	'parse() round-trips the SAME inferredDecisions freeze() produced',
	JSON.stringify(parsed.inferredDecisions),
	JSON.stringify(frozen.inferredDecisions),
);

const perturbed = decisions.map((d) => (d.source.stableId === 's1' ? { ...d, targetKey: 'P9' } : d));
const frozenPerturbed = freezer.freeze({ pairStamp, decisions: perturbed });
harness.ok(
	'perturbing a decision changes the decisionBlockHash (the pin bites)',
	frozenPerturbed.decisionBlockHash !== frozen.decisionBlockHash,
);

harness.report();
