#!/usr/bin/env node
'use strict';

// test-useDebugJudge.js — hermetic gate for the --useDebugJudge OPERATOR SWITCH (skipAI,
// PLAN-skipAiDebugJudge-081026 Phase 2). The judge itself is gated by
// apps/bridge-maker/test/test-debugJudge.js; THIS suite gates the WIRING: how the flag is read, how
// it is refused, and how it diverts resolveInferenceConfig's factory seam.
//
// What it proves:
//   1. RESOLUTION — absent means the REAL reranker; bare means the register's DEFAULT_RULE; a named
//      rule resolves CASE-INSENSITIVELY; deps injection outranks the command line.
//   2. REFUSE-BY-NAME — an unregistered rule is refused WITH THE REGISTERED RULES LISTED and is
//      never corrected to a default.
//   3. THE TWO GUARD REFUSALS — --useDebugJudge with no active --rebridge scope (nothing would be
//      judged, so the flag would sit idle while the run LOOKED successful), and --useDebugJudge
//      together with an injected llmClient (two judges named, no precedence rule).
//   4. THE DIVERSION — with a scope active, resolveInferenceConfig hands back the DEBUG judge and
//      NEVER calls the real client factory. This is the headline capability: a real --rebridge runs
//      with no Anthropic key and no spend.
//   5. REGRESSION CONTROL — with no debug rule, behaviour is exactly as before: the real factory is
//      minted on an active scope, nothing is minted on a plain build, and an injected client wins.
//
// PURE / hermetic: no Neo4j, no network, no LLM, no filesystem, AND NO MUTATION OF SHARED PROCESS
// STATE — the simulated command line is HANDED to the resolver, never swapped into process.global.
// The real client factory is replaced by a COUNTING FAKE so "never called" is MEASURED, not assumed.
//
// Run: node apps/graph-builder/test/test-useDebugJudge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the --useDebugJudge operator switch

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves how --useDebugJudge is read, refused, and how it diverts the reranker factory seam so a
     real --rebridge runs with no Anthropic key and no spend.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const buildStatics = require('../lib/build');
const debugJudgeFactory = require('../apps/bridge-maker/lib/debugJudge');

const { resolveDebugJudge, resolveInferenceConfig } = buildStatics;
const { DEFAULT_RULE, REGISTERED_RULE_NAMES, DEBUG_MARK } = debugJudgeFactory;

// commandLine — a simulated command line, HANDED to the resolver as its second argument.
//
// An earlier draft of this suite swapped process.global wholesale to get a different
// commandLineParameters past the sealed (non-writable, non-configurable) property. tqii's condition
// on a test kit is that it must not affect the real process, and the swap only satisfied that
// CONDITIONALLY: it mutated shared state and relied on putting it back, so an assertion throwing
// mid-test would leave the real process.global clobbered for everything after it. Injection
// satisfies the condition BY CONSTRUCTION — nothing shared is touched at any point, production
// passes no second argument and reads exactly what it always read. Same idiom as llmClient's
// componentOverrides.postOnce.
const commandLine = ({ values = {}, switches = {} }) => ({ values, switches });

// countingFactory — stands in for the real Anthropic client factory. Its call count is the evidence
// for "the real client was never constructed"; asserting that from the absence of an error would
// prove nothing.
const makeCountingFactory = () => {
	const state = { calls: 0 };
	const factory = () => {
		state.calls += 1;
		return { rerank: () => {}, model: 'FAKE-REAL-CLIENT', keySource: 'fake' };
	};
	return { factory, state };
};

// =====================================================================
harness.section('RESOLUTION — absent, bare, named, case-insensitive, injected');
// =====================================================================

harness.equal(
	'absent flag resolves to null (the REAL reranker)',
	resolveDebugJudge({}, commandLine({})).value,
	null,
);

harness.equal(
	`bare --useDebugJudge takes the register's default rule ('${DEFAULT_RULE}')`,
	resolveDebugJudge({}, commandLine({ values: { useDebugJudge: [] } })).value,
	DEFAULT_RULE,
);

harness.equal(
	'a bare SWITCH form also takes the default rule',
	resolveDebugJudge({}, commandLine({ switches: { useDebugJudge: true } })).value,
	DEFAULT_RULE,
);

REGISTERED_RULE_NAMES.forEach((oneRule) => {
	harness.equal(
		`--useDebugJudge=${oneRule} resolves`,
		resolveDebugJudge({}, commandLine({ values: { useDebugJudge: [oneRule] } })).value,
		oneRule,
	);
});

harness.equal(
	'rule matching is CASE-INSENSITIVE (ABSTAIN -> abstain)',
	resolveDebugJudge({}, commandLine({ values: { useDebugJudge: ['ABSTAIN'] } })).value,
	'abstain',
);
harness.equal(
	'surrounding whitespace is trimmed',
	resolveDebugJudge({}, commandLine({ values: { useDebugJudge: ['  Digest  '] } })).value,
	'digest',
);

const cliSaysFirst = commandLine({ values: { useDebugJudge: ['first'] } });
harness.equal(
	'deps injection OUTRANKS the command line',
	resolveDebugJudge({ useDebugJudge: 'abstain' }, cliSaysFirst).value,
	'abstain',
);
harness.equal(
	'deps.useDebugJudge=null explicitly means the REAL reranker',
	resolveDebugJudge({ useDebugJudge: null }, cliSaysFirst).value,
	null,
);

// =====================================================================
harness.section('REFUSE-BY-NAME — an unregistered rule never becomes another rule');
// =====================================================================

const refusal = resolveDebugJudge({}, commandLine({ values: { useDebugJudge: ['highest'] } }));
harness.ok('an unregistered rule is refused', !!refusal.error);
harness.equal('...and no value is produced', refusal.value, undefined);
harness.match('...the refusal names the offending value', refusal.error, /--useDebugJudge='highest'/);
harness.match('...and lists the registered rules', refusal.error, /Registered rules are:/);
harness.match('...and states it was not corrected', refusal.error, /NOT corrected to a default/);

harness.ok(
	'a non-string deps.useDebugJudge is refused by name',
	/must be a rule-name string/.test(resolveDebugJudge({ useDebugJudge: 7 }).error || ''),
);

// =====================================================================
harness.section('GUARD REFUSALS — the two ways the flag would otherwise mislead');
// =====================================================================

const idleRefusal = resolveInferenceConfig({}, [], 'first');
harness.ok('--useDebugJudge with an EMPTY rebridge scope is refused', !!idleRefusal.error);
harness.match('...naming the reason nothing would be judged', idleRefusal.error, /NOTHING WOULD BE JUDGED/);
harness.match('...and stating it does not imply --rebridge', idleRefusal.error, /does not imply it/);

const injectedStub = { rerank: () => {}, model: 'injected' };
const bothRefusal = resolveInferenceConfig({ inferenceConfig: { llmClient: injectedStub } }, 'all', 'first');
harness.ok('--useDebugJudge PLUS an injected llmClient is refused', !!bothRefusal.error);
harness.match('...naming the ambiguity', bothRefusal.error, /Two judges are named for one run/);

// =====================================================================
harness.section('THE DIVERSION — the real client factory is NEVER constructed');
// =====================================================================

const diverted = makeCountingFactory();
const divertedResult = resolveInferenceConfig(
	{ llmClientFactory: diverted.factory, inferenceConfig: { topK: 15 } },
	'all',
	'first',
);
harness.equal('a scoped rebridge with a debug rule resolves cleanly', divertedResult.error, undefined);
harness.equal(
	'THE REAL CLIENT FACTORY WAS NEVER CALLED (measured, not assumed)',
	diverted.state.calls,
	0,
);
harness.ok('the resolved client answers rerank', typeof divertedResult.value.llmClient.rerank === 'function');
harness.equal(
	'the resolved client is the DEBUG judge, flagged',
	divertedResult.value.llmClient.decisionAlgorithm,
	DEBUG_MARK,
);
harness.equal('...carrying the requested rule', divertedResult.value.llmClient.ruleName, 'first');
harness.match(
	'...and a model identifier that could never collide with a real one',
	divertedResult.value.llmClient.model,
	new RegExp(DEBUG_MARK),
);
harness.equal('operator inferenceConfig fields survive alongside it (topK)', divertedResult.value.topK, 15);
harness.equal('the debug judge reports no key source', divertedResult.value.llmClient.keySource, 'none');

// each registered rule can be reached through the switch, not merely 'first'
REGISTERED_RULE_NAMES.forEach((oneRule) => {
	const perRule = makeCountingFactory();
	const resolved = resolveInferenceConfig({ llmClientFactory: perRule.factory }, 'all', oneRule);
	harness.equal(`rule '${oneRule}' is reachable through the seam`, resolved.value.llmClient.ruleName, oneRule);
	harness.equal(`rule '${oneRule}' mints no real client`, perRule.state.calls, 0);
});

// =====================================================================
harness.section('REGRESSION CONTROL — without the flag, nothing changed');
// =====================================================================

const control = makeCountingFactory();
const realMint = resolveInferenceConfig({ llmClientFactory: control.factory, inferenceConfig: { topK: 15 } }, 'all');
harness.equal('no debug rule + active scope: the REAL factory IS called', control.state.calls, 1);
harness.equal('...and its client is threaded', realMint.value.llmClient.model, 'FAKE-REAL-CLIENT');
harness.equal('...with operator fields preserved', realMint.value.topK, 15);

const plain = makeCountingFactory();
const plainResult = resolveInferenceConfig({ llmClientFactory: plain.factory }, []);
harness.equal('no debug rule + INACTIVE scope: nothing is minted', plain.state.calls, 0);
harness.equal('...and no llmClient is carried', plainResult.value.llmClient, undefined);

const injectedOnly = makeCountingFactory();
const injectedResult = resolveInferenceConfig(
	{ llmClientFactory: injectedOnly.factory, inferenceConfig: { llmClient: injectedStub } },
	'all',
);
harness.equal('an injected client still wins and mints nothing', injectedOnly.state.calls, 0);
harness.ok('...and is threaded unchanged', injectedResult.value.llmClient === injectedStub);

harness.report();
