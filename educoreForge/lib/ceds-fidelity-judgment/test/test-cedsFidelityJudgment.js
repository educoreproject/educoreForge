#!/usr/bin/env node
'use strict';

// test-cedsFidelityJudgment.js — THE TWIN FOR R-1, at last.
//
// R-1 is the gate that kills a build when the CEDS graph stops round-tripping. Its happy path
// was observed on a real build; its FAILURE BRANCH had never executed, because exercising it
// meant forging a whole graph -- five minutes per attempt, and two attempts were killed by
// timeouts before finishing. A gate never observed failing is unproven, and that is our own
// doctrine applied to our own enforcement.
//
// Splitting the decision out of the I/O makes the negation cost milliseconds instead of
// minutes. Every assertion below is a way the build MUST die.
//
// WHAT THIS FILE DOES NOT PROVE: that build.js actually calls the judgment and actually exits
// nonzero. That is WIRING, and wiring needs one real fault injection observed once. A
// hermetic test of a decision nobody invokes is a very tidy way to prove nothing.
//
// Run: node lib/ceds-fidelity-judgment/test/test-cedsFidelityJudgment.js [-verbose]

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the fault-injection twin for the R-1 build fidelity gate

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the decision that kills a build actually bites: loss fails, invention fails even
     under an allowance, an allowance covers exactly what it names and not one statement more,
     and a missing measurement fails rather than passes. Hermetic -- no Docker, no graph, no
     network.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const { judgeFidelity, resolveAllowance } = require('../ceds-fidelity-judgment')();

const clean = { sourceStatements: 239761, matched: 239761, lost: 0, invented: 0 };

// =====================================================================================
harness.section('THE GATE CAN PASS AT ALL — otherwise it is decoration, not enforcement');

const passing = judgeFidelity({ headline: clean, allowedLoss: 0, graphName: 'G' });
harness.ok('a perfect round trip PASSES', passing.passed === true, passing.reason);
harness.match('and says why', passing.reason, /zero lost, zero invented/);

// =====================================================================================
harness.section('LOSS KILLS THE BUILD — the regression R-1 exists to catch');

// The exact fault the two timed-out attempts were trying to inject: dc:creator stops being
// carried and 23,251 statements stop round-tripping.
const lostCreator = judgeFidelity({
	headline: { ...clean, matched: 216510, lost: 23251 },
	allowedLoss: 0,
	graphName: 'DEV_someGraph',
});
harness.ok('23,251 lost statements FAIL the build', lostCreator.passed === false);
harness.match('the count is named', lostCreator.reason, /23251 CEDS statement\(s\) do not round-trip/);
harness.match(
	'and the operator is told how to attribute it',
	lostCreator.reason,
	/-cedsRoundTrip --containerName=DEV_someGraph/,
);
harness.match(
	'and how to accept it deliberately, with the number spelled out',
	lostCreator.reason,
	/--allowFidelityLoss=23251/,
);

harness.ok(
	'even ONE lost statement fails',
	judgeFidelity({ headline: { ...clean, lost: 1 }, allowedLoss: 0 }).passed === false,
);

// =====================================================================================
harness.section('INVENTION KILLS THE BUILD UNCONDITIONALLY — no allowance covers it');

const invented = judgeFidelity({ headline: { ...clean, invented: 4 }, allowedLoss: 0 });
harness.ok('4 invented statements FAIL', invented.passed === false);
harness.match('and are called what they are', invented.reason, /CEDS does NOT make/);

// THE ASSERTION THAT MATTERS MOST IN THIS FILE. An allowance is about LOSS. If it could also
// wave through invention, the flag would become a way to ship a graph that lies about CEDS.
const inventedUnderHugeAllowance = judgeFidelity({
	headline: { ...clean, invented: 1 },
	allowedLoss: 1000000,
});
harness.ok(
	'invention fails EVEN under an allowance of a million',
	inventedUnderHugeAllowance.passed === false,
);
harness.match(
	'and says explicitly that the allowance does not cover it',
	inventedUnderHugeAllowance.reason,
	/--allowFidelityLoss does not cover it/,
);

// =====================================================================================
harness.section('THE ALLOWANCE COVERS EXACTLY WHAT IT NAMES — not one statement more');

harness.ok(
	'12 lost against an allowance of 12 PASSES',
	judgeFidelity({ headline: { ...clean, lost: 12 }, allowedLoss: 12 }).passed === true,
);
harness.ok(
	'13 lost against an allowance of 12 FAILS — it cannot absorb a NEW regression',
	judgeFidelity({ headline: { ...clean, lost: 13 }, allowedLoss: 12 }).passed === false,
);
harness.match(
	'and the failure names the allowance it exceeded',
	judgeFidelity({ headline: { ...clean, lost: 13 }, allowedLoss: 12 }).reason,
	/exceeds the --allowFidelityLoss=12 you named/,
);
harness.ok(
	'a knowingly-incomplete pass SAYS SO rather than reading like a clean one',
	judgeFidelity({ headline: { ...clean, lost: 12 }, allowedLoss: 12 }).knowinglyIncomplete === true,
);

// =====================================================================================
harness.section('A MISSING MEASUREMENT FAILS — it never reads as a pass');

harness.ok('no headline at all FAILS', judgeFidelity({}).passed === false);
harness.ok(
	'a headline missing `invented` FAILS',
	judgeFidelity({ headline: { lost: 0 } }).passed === false,
);
harness.match(
	'and says why that is a failure rather than a skip',
	judgeFidelity({}).reason,
	/unmeasured gate that reads green/,
);

// =====================================================================================
harness.section('THE ALLOWANCE FLAG REFUSES NONSENSE BY NAME');

harness.ok('absent means zero', resolveAllowance({}).allowedLoss === 0);
harness.ok('a plain integer is read', resolveAllowance({ rawValue: '12' }).allowedLoss === 12);
harness.ok(
	'an array value (qtools shape) is read',
	resolveAllowance({ rawValue: ['7'] }).allowedLoss === 7,
);
harness.ok('a blank is REFUSED', !!resolveAllowance({ rawValue: '' }).error);
harness.ok('"true" is REFUSED — it is not an on/off switch', !!resolveAllowance({ rawValue: 'true' }).error);
harness.ok('a negative is REFUSED', !!resolveAllowance({ rawValue: '-1' }).error);
harness.ok('a fraction is REFUSED', !!resolveAllowance({ rawValue: '1.5' }).error);
harness.match(
	'and the refusal explains the reasoning',
	resolveAllowance({ rawValue: 'true' }).error,
	/a gate that can be silently disabled is not a gate/,
);

harness.note('the DECISION is now proven to bite; the WIRING still needs one real fault injection');
harness.report();
