'use strict';

// test-budget-guard.js — the spend meter + budget guard in cachedJudgment.js (2026-07-31, TQ's
// cost-consciousness ruling). Proves: (1) live-judgment usage accrues real dollars from the API
// envelope at the configured prices; (2) once spend reaches budgetMaxUsd the NEXT live judgment is
// refused BY NAME (stop-and-resume, never degrade); (3) cache hits are NEVER guarded — a maxed
// budget still serves cached judgments (the resume path the refusal message promises); (4) a stub
// with no usage envelope accrues nothing (hermetic suites can never trip the guard).
// Hermetic: no ini dependency (budgetInternalsForTestOnly overrides), no network, no sqlite file —
// an in-memory cache double satisfies the seam's contract.

const path = require('path');
const cachedJudgmentFactory = require(path.join(__dirname, '..', 'lib', 'cachedJudgment'));
const { budgetConfig, spendMeter } = cachedJudgmentFactory.budgetInternalsForTestOnly;

let passCount = 0;
let failCount = 0;
const ok = (label, condition, detail) => {
	if (condition) {
		passCount += 1;
		console.log(`PASS ${label}`);
	} else {
		failCount += 1;
		console.log(`FAIL ${label}${detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
	}
};

process.global = process.global || {};
process.global.xLog = process.global.xLog || { status: () => {}, error: () => {} };

// preserve real config, install test config
const savedConfig = { ...budgetConfig };
const savedMeter = { ...spendMeter };
budgetConfig.disabled = false;
budgetConfig.budgetMaxUsd = 0.001; // one thousandth of a dollar — trips after one real-usage call
budgetConfig.inputUsdPerMTok = 15;
budgetConfig.outputUsdPerMTok = 75;
spendMeter.spentUsd = 0;
spendMeter.liveJudgments = 0;

const pool = [{ candidate: { stableId: 'cand-1' } }];
const stubSelect = (spec, llm, cb) =>
	llm.rerank({}, (e, r) => cb('', { abstain: false, pick: pool[0].candidate, category: 'strong', rationale: 'test' }));

const makeLlm = (usage) => ({
	model: 'test-model',
	rerank: (spec, cb) => cb('', { ranking: [1], usage, stopReason: 'end_turn', attempts: 1, retryReasons: [] }),
});

const cacheRows = {};
const cacheDouble = {
	getJudgment: ({ promptHash, model, rendererVersion }, cb) =>
		cb('', { judgment: cacheRows[`${promptHash}|${model}|${rendererVersion}`] || null }),
	putJudgment: ({ promptHash, model, rendererVersion, judgment }, cb) => {
		cacheRows[`${promptHash}|${model}|${rendererVersion}`] = { ...judgment };
		cb('');
	},
};

const judge = cachedJudgmentFactory({
	judgmentCache: cacheDouble,
	matchForensics: null,
	pairKey: 'CEDS::TEST',
	generation: 'test-v1',
	rendererVersion: 'evidenceRenderer-v2',
	evidenceSelect: stubSelect,
	llmClient: makeLlm({ inputTokens: 30000, outputTokens: 400 }), // ~$0.48 -> exceeds $0.001
});

judge({ promptText: 'prompt-A', pool, sourceStableId: 's1', sourceName: 'one' }, (errOne, one) => {
	ok('first live judgment succeeds under budget', !errOne && one && !one.judgeMeta.servedFromCache, errOne);
	ok('usage accrued real dollars', spendMeter.spentUsd > 0.4 && spendMeter.spentUsd < 0.6, spendMeter.spentUsd);

	judge({ promptText: 'prompt-B', pool, sourceStableId: 's2', sourceName: 'two' }, (errTwo) => {
		ok('RED: next LIVE judgment refused once budget reached', !!errTwo);
		ok('  the refusal names the guard and the free resume', /BUDGET GUARD/.test(`${errTwo}`) && /zero re-spend/.test(`${errTwo}`), errTwo);

		// (3) cache hits are never guarded: prompt-A is now cached; a maxed budget must still serve it.
		judge({ promptText: 'prompt-A', pool, sourceStableId: 's1', sourceName: 'one' }, (errThree, three) => {
			ok('cache hit served even with budget exhausted', !errThree && three && three.judgeMeta.servedFromCache, errThree);

			// (4) a stub with no usage envelope accrues nothing
			const spentBefore = spendMeter.spentUsd;
			budgetConfig.budgetMaxUsd = 1000; // reopen the gate
			const judgeNoUsage = cachedJudgmentFactory({
				judgmentCache: cacheDouble, matchForensics: null, pairKey: 'CEDS::TEST', generation: 'test-v1',
				rendererVersion: 'evidenceRenderer-v2', evidenceSelect: stubSelect, llmClient: makeLlm(undefined),
			});
			judgeNoUsage({ promptText: 'prompt-C', pool, sourceStableId: 's3', sourceName: 'three' }, (errFour) => {
				ok('no-usage stub judgment succeeds', !errFour, errFour);
				ok('  and accrues nothing', spendMeter.spentUsd === spentBefore, spendMeter.spentUsd - spentBefore);

				// restore real config/meter so no other suite inherits test values
				Object.assign(budgetConfig, savedConfig);
				Object.assign(spendMeter, savedMeter);
				console.log(`test-budget-guard: ${passCount}/${passCount + failCount} passed, ${failCount} failed.`);
				process.exit(failCount === 0 ? 0 : 1);
			});
		});
	});
});
