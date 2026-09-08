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
const judgeProviderRegistryLib = require('../apps/bridge-maker/lib/judgeProviderRegistry');
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

// ⟪JOB 4, 2026-09-07⟫ THE SEAM MOVED FROM A FACTORY TO A ROW, and the count is still the evidence.
// This used to be makeCountingFactory, standing in for deps.llmClientFactory — an override that existed
// only because build.js required the Anthropic factory directly. That override is gone (a per-provider
// factory substitution is a second construction path, which is the thing this job removes), so the double
// is now a registry ROW injected through the registry's own componentOverrides. Its construction count is
// still what proves "the real client was never constructed"; inferring that from the absence of an error
// would prove nothing. The row satisfies JUDGE_PROVIDER_SHAPE because the registry VALIDATES what it is
// handed — a stand-in that could not survive validation would be testing a path the real run never takes.
const makeCountingAnthropicRow = () => {
	const state = { calls: 0 };
	const row = {
		name: 'anthropic',
		enabled: true,
		construct: (rowConstructionOptions, rowCallback) => {
			state.calls += 1;
			rowCallback('', {
				name: 'anthropic',
				wireModel: 'FAKE-REAL-CLIENT',
				model: 'anthropic:FAKE-REAL-CLIENT',
				maxConcurrency: 4,
				rerank: () => {},
				describe: () => ({ provider: 'anthropic', model: 'anthropic:FAKE-REAL-CLIENT', version: 'fake-v1' }),
				keySource: 'fake',
			});
		},
	};
	return { row, state };
};

// depsWithRows — the ONE seam, spelled once. Everything a suite substitutes goes through the registry's
// componentOverrides, exactly as the real run's construction does.
const depsWithRows = (deps, rowList) => ({ ...deps, judgeProviderComponentOverrides: { judgeProviderRowList: rowList } });

// resolveInto — resolveInferenceConfig is ERROR-FIRST since JOB 4 (docket vi: the Ollama row's identity
// needs I/O, so every row constructs through a callback). These assertions were written against the old
// { value } / { error } return; they assert the same subjects through the callback.
const resolveInto = (deps, rebridgeScope, debugJudgeRule, done) =>
	resolveInferenceConfig(deps, rebridgeScope, debugJudgeRule, (inferenceConfigError, inferenceConfig) =>
		done({ error: inferenceConfigError || '', value: inferenceConfig || null }),
	);

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

const injectedStub = { rerank: () => {}, model: 'injected' };
const debugJudgeRowList = judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST;

resolveInto({}, [], 'first', (idleRefusal) => {
	harness.ok('--useDebugJudge with an EMPTY rebridge scope is refused', !!idleRefusal.error);
	harness.match('...naming the reason nothing would be judged', idleRefusal.error, /NOTHING WOULD BE JUDGED/);
	harness.match('...and stating it does not imply --rebridge', idleRefusal.error, /does not imply it/);

	resolveInto({ inferenceConfig: { llmClient: injectedStub } }, 'all', 'first', (bothRefusal) => {
		harness.ok('--useDebugJudge PLUS an injected llmClient is refused', !!bothRefusal.error);
		harness.match('...naming the ambiguity', bothRefusal.error, /Two judges are named for one run/);

		// ⟪JOB 4⟫ THE COMPANION CASE, AND IT MUST NOT REFUSE. An injected client alongside an ORDINARY
		// config key is the normal hermetic-suite situation — the injection wins silently. Only the EXPLICIT
		// --useDebugJudge override conflicts with an injection. Ruled by DAWN_TOWER, and asserted here
		// because "the refusal fires" and "the refusal fires ONLY when it should" are different claims.
		resolveInto({ inferenceConfig: { llmClient: injectedStub, topK: 15 } }, 'all', null, (injectedNoFlag) => {
			harness.equal('an injected llmClient with NO --useDebugJudge is NOT refused', injectedNoFlag.error, '');
			harness.ok('...and wins over the config key silently', injectedNoFlag.value.llmClient === injectedStub);
			harness.equal('...with operator fields preserved', injectedNoFlag.value.topK, 15);

			// =====================================================================
			harness.section('THE DIVERSION — the real provider row is NEVER constructed');
			// =====================================================================

			const diverted = makeCountingAnthropicRow();
			resolveInto(
				depsWithRows({ inferenceConfig: { topK: 15 } }, [diverted.row, ...debugJudgeRowList.filter((oneRow) => oneRow.name !== 'anthropic')]),
				'all',
				'first',
				(divertedResult) => {
					harness.equal('a scoped rebridge with a debug rule resolves cleanly', divertedResult.error, '');
					harness.equal('THE REAL PROVIDER ROW WAS NEVER CONSTRUCTED (measured, not assumed)', diverted.state.calls, 0);
					harness.ok('the resolved client answers rerank', typeof divertedResult.value.llmClient.rerank === 'function');
					harness.equal('the resolved client is the DEBUG judge, flagged', divertedResult.value.llmClient.decisionAlgorithm, DEBUG_MARK);
					harness.equal('...carrying the requested rule', divertedResult.value.llmClient.ruleName, 'first');

					// ⟪JOB 4 MOVES THIS ASSERTION, and says why rather than quietly relaxing it.⟫ It used to
					// match the model against DEBUG_MARK, because the identity was
					// 'debugJudge:first-v1-INVALID_DEBUG'. Docket (i) shortened it to exactly 'debug:<rule>' so
					// that bridge-framework's judgeKind could stop being a ternary that branches on which
					// provider it holds. The old assertion's INTENT — that this identity could never be
					// mistaken for a real model — is now carried by the namespace, which JUDGE_PROVIDER_SHAPE
					// enforces for every provider. And the flag every mechanical reader ACTUALLY consults was
					// never this string: it is decisionAlgorithm, asserted immediately above, which is what
					// materialiser turns into provenanceTier 'invalid-debug'.
					harness.equal('...and a model identifier namespaced so it could never collide with a real one', divertedResult.value.llmClient.model, 'debug:first');
					harness.ok('...which is exactly what judgeKind now reads, with no ternary', divertedResult.value.llmClient.model.indexOf('debug:') === 0);
					harness.equal('operator inferenceConfig fields survive alongside it (topK)', divertedResult.value.topK, 15);
					harness.equal('the debug judge reports no key source', divertedResult.value.llmClient.keySource, 'none');

					// each registered rule can be reached through the SEAM — and the seam is a row walk, not a switch
					const perRuleQueue = REGISTERED_RULE_NAMES.slice();
					const nextRule = (afterRules) => {
						if (!perRuleQueue.length) {
							afterRules();
							return;
						}
						const oneRule = perRuleQueue.shift();
						const perRule = makeCountingAnthropicRow();
						resolveInto(
							depsWithRows({}, [perRule.row, ...debugJudgeRowList.filter((oneRow) => oneRow.name !== 'anthropic')]),
							'all',
							oneRule,
							(resolved) => {
								harness.equal(`rule '${oneRule}' is reachable through the seam`, resolved.value.llmClient.ruleName, oneRule);
								harness.equal(`rule '${oneRule}' constructs no real provider`, perRule.state.calls, 0);
								nextRule(afterRules);
							},
						);
					};

					nextRule(() => {
						// =====================================================================
						harness.section('REGRESSION CONTROL — without the flag, nothing changed');
						// =====================================================================

						// ⟪JOB 4⟫ the config key now names the provider where --useDebugJudge does not. These
						// cases drive the ANTHROPIC row, so they inject a counting row AND name it through the
						// key, which is the path a real run takes.
						const control = makeCountingAnthropicRow();
						resolveInto(
							depsWithRows({ inferenceConfig: { topK: 15 }, judgeProviderName: 'anthropic' }, [control.row]),
							'all',
							null,
							(realMint) => {
								harness.equal('no debug rule + active scope: the REAL row IS constructed', control.state.calls, 1);
								harness.equal('...and its client is threaded', realMint.value.llmClient.model, 'anthropic:FAKE-REAL-CLIENT');
								harness.equal('...with operator fields preserved', realMint.value.topK, 15);
								harness.ok('...and what is threaded is FROZEN by the registry', Object.isFrozen(realMint.value.llmClient));

								const plain = makeCountingAnthropicRow();
								resolveInto(depsWithRows({}, [plain.row]), [], null, (plainResult) => {
									harness.equal('no debug rule + INACTIVE scope: nothing is constructed', plain.state.calls, 0);
									harness.equal('...and no llmClient is carried', plainResult.value.llmClient, undefined);

									const injectedOnly = makeCountingAnthropicRow();
									resolveInto(
										depsWithRows({ inferenceConfig: { llmClient: injectedStub } }, [injectedOnly.row]),
										'all',
										null,
										(injectedResult) => {
											harness.equal('an injected client still wins and constructs nothing', injectedOnly.state.calls, 0);
											harness.ok('...and is threaded unchanged', injectedResult.value.llmClient === injectedStub);
											harness.report();
										},
									);
								});
							},
						);
					});
				},
			);
		});
	});
});
