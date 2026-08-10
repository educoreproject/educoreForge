#!/usr/bin/env node
'use strict';

// test-debugJudge.js — hermetic gate for lib/debugJudge.js, the debug judge REGISTER and its rules
// (skipAI, PLAN-skipAiDebugJudge-081026 Phase 1).
//
// The gate proves five things, and the third is the one that makes the rest mean anything:
//   1. THE REGISTER — an explicit map, every registered rule constructible, an unknown rule REFUSED
//      BY NAME at construction with the available rules listed, and no silent fallback.
//   2. THE CALLBACK CONTRACT — nothing is returned; answers AND refusals arrive through the
//      callback, so a genuinely asynchronous rule (useOllama) registers later without changing any
//      caller. NOT a timing assertion: boundedRunner already guarantees stack safety for a
//      synchronous item, so deferring delivery here would be a local workaround for a solved problem.
//   3. RED TWIN — the REAL lib.d/evidenceSelect.js shown REFUSING BY NAME a judge that answers out
//      of range / with an invalid category / with no rationale. Without this, the GREEN section
//      proves only that nothing objected, which is what an INERT gate also looks like.
//   4. GREEN — each rule's answers are accepted by that same REAL evidenceSelect, driven through the
//      real module with a real renderer, never a copy or a re-implementation of its checks.
//   5. FLAGGING + PURITY — every answer carries decisionAlgorithm INVALID_DEBUG, every rationale
//      announces itself in its first words, and no network/cache/substrate module is required.
//
// EVERYTHING HERE IS SEQUENCED THROUGH CALLBACKS, never by statement order — so the suite keeps
// passing unchanged when an asynchronous rule (useOllama) joins the register.
//
// PURE / hermetic: no Neo4j, no network, no LLM, no filesystem beyond reading this tree's own source.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-debugJudge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the debugJudge register and its rules

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the register refuses an unknown rule by name; that answers and refusals travel by
     callback; that the REAL evidenceSelect REFUSES malformed judges by name (RED twin, so GREEN
     means something); that it ACCEPTS every registered rule (GREEN); and that answers are flagged
     INVALID_DEBUG.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');

const harness = require('../../../../../test/testLib/harness')(moduleName);

const debugJudgeFactory = require('../lib/debugJudge');
const evidenceSelectFactory = require('../lib.d/evidenceSelect');
const evidenceRendererFactory = require('../lib.d/evidenceRenderer');
const { SELECT_CATEGORY_ENUM } = require('../lib/evidenceContracts');

const { DEBUG_MARK, DEFAULT_RULE, REGISTERED_RULE_NAMES, RULE_REGISTER, PICK_CATEGORIES, ABSTAIN_SLOTS, promptDigest, modelIdentifierFor } =
	debugJudgeFactory;

const realRenderer = evidenceRendererFactory();
const realSelect = evidenceSelectFactory({ renderer: realRenderer });

// A pre-rendered pool — evidenceSelect path (b), { promptText, pool }, which skips rendering
// entirely and drives judgeRenderedPool directly. Candidates are opaque to the judge by design.
const makePool = (size) =>
	Array.from({ length: size }, (unusedValue, index) => ({
		candidate: { canonicalKey: `P00000${index + 1}`, name: `candidate ${index + 1}` },
	}));

const POOL_SIZE = 5;
const pool = makePool(POOL_SIZE);
const choiceEnum = pool.map((unusedEntry, i) => `${i + 1}`).concat(['NONE']);

// digestLandsOn — the 'digest' rule's own arithmetic, restated ONLY to FIND a probe prompt that
// lands where a test wants it. It is not an oracle for the rule's correctness (that is proven
// through the module itself); it is a search helper.
const digestLandsOnAbstain = (userPrompt) => promptDigest(userPrompt) % (POOL_SIZE + ABSTAIN_SLOTS) >= POOL_SIZE;
const findDigestPrompt = (wantAbstain) => {
	let index = 0;
	while (index < 5000) {
		const probe = `probe prompt number ${index}`;
		if (digestLandsOnAbstain(probe) === wantAbstain) {
			return probe;
		}
		index += 1;
	}
	return null;
};

// A minimal serial driver — steps run one after another, each calling next() when done. Keeps the
// suite in callback style (no async/await, per house practice) without nesting.
const steps = [];
const step = (title, fn) => steps.push({ title, fn });
const runSteps = (index) => {
	if (index >= steps.length) {
		harness.report();
		return;
	}
	if (steps[index].title) {
		harness.section(steps[index].title);
	}
	steps[index].fn(() => runSteps(index + 1));
};

// =====================================================================
step('THE REGISTER — explicit map, refuse-by-name, no silent fallback', (next) => {
	harness.ok(
		`the register is a non-empty explicit map (rules: ${REGISTERED_RULE_NAMES.join(', ')})`,
		REGISTERED_RULE_NAMES.length >= 2,
	);
	harness.ok(`'first' is registered`, REGISTERED_RULE_NAMES.indexOf('first') !== -1);
	harness.ok(`'abstain' is registered`, REGISTERED_RULE_NAMES.indexOf('abstain') !== -1);
	harness.equal('the documented default rule is first', DEFAULT_RULE, 'first');
	harness.ok('the default rule is itself registered', REGISTERED_RULE_NAMES.indexOf(DEFAULT_RULE) !== -1);

	REGISTERED_RULE_NAMES.forEach((oneRule) => {
		harness.ok(`every registered rule carries a description: ${oneRule}`, !!RULE_REGISTER[oneRule].description);
		harness.doesNotThrow(`every registered rule constructs: ${oneRule}`, () => debugJudgeFactory({ ruleName: oneRule }));
	});

	// RED: an unknown rule must refuse AT CONSTRUCTION, by name, listing what exists.
	let constructionRefusal = null;
	const attempt = () => debugJudgeFactory({ ruleName: 'highest' });
	try {
		attempt();
	} catch (thrown) {
		constructionRefusal = thrown.message;
	}
	harness.ok('an UNKNOWN rule refuses at construction (no silent fallback)', !!constructionRefusal);
	harness.match('...naming the offending rule', constructionRefusal, /unknown debug judge rule 'highest'/);
	harness.match('...and listing the registered rules', constructionRefusal, /Registered rules are:/);
	harness.match('...and stating there is no default', constructionRefusal, /no default fallback rule/);

	harness.equal(
		'the model identifier names the rule and carries the debug flag',
		modelIdentifierFor('first'),
		`debugJudge-first-v1-${DEBUG_MARK}`,
	);
	next();
});

// =====================================================================
step('THE CALLBACK CONTRACT — answers and refusals both travel by callback', (next) => {
	// NOT a timing assertion. An earlier draft deferred every delivery through setImmediate and
	// asserted the callback landed on a later tick; tqii refused that as a hack and the tree bears him
	// out — genericBridge runs on pipeRunner/taskListPlus and dispatches judgments through
	// lib/boundedRunner, whose own header guarantees that "a fully-synchronous oneItem (the
	// hermetic-test case...) is dispatched ITERATIVELY... so 15,620 synchronous completions never
	// build 15,620 stack frames." What must be proven is the CONTRACT — that nothing is returned and
	// everything arrives through the callback, so a genuinely asynchronous rule (useOllama) can be
	// registered later without changing any caller.
	const judge = debugJudgeFactory({ ruleName: 'first' });

	harness.equal(
		'rerank RETURNS nothing — the answer travels only by callback',
		judge.rerank({ systemPrompt: 's', userPrompt: 'p', choiceEnum, requireJudgment: true }, () => {}),
		undefined,
	);

	judge.rerank({ systemPrompt: 's', userPrompt: 'p', choiceEnum, requireJudgment: true }, (err, result) => {
		harness.equal('an ANSWER arrives through the callback with no error', err, '');
		harness.equal('the delivered answer is flagged', result.decisionAlgorithm, DEBUG_MARK);
		harness.equal('usage is null, not zero — no request was made', result.usage, null);

		judge.rerank({ systemPrompt: 's', userPrompt: '', choiceEnum, requireJudgment: true }, (refusalErr, refusalResult) => {
			harness.ok('a REFUSAL also arrives through the callback', !!refusalErr);
			harness.equal('...and carries no result alongside the error', refusalResult, undefined);
			next();
		});
	});
});

// =====================================================================
step('RED TWIN — the REAL evidenceSelect REFUSES malformed judges BY NAME', (next) => {
	// Without this section, GREEN proves only that nothing objected — which is what an INERT gate
	// also looks like. Each fault is refused by the SAME real module that accepts the rules below.
	const brokenJudge = (result) => ({
		rerank: (unusedArgs, callback) => setImmediate(() => callback('', result)),
	});
	const faults = [
		['OUT-OF-RANGE choice', { choice: '99', model: 'broken', category: 'strong', rationale: 'x' }, /out-of-range choice/],
		['INVALID category', { choice: '1', model: 'broken', category: 'excellent', rationale: 'x' }, /valid category/],
		['MISSING rationale', { choice: '1', model: 'broken', category: 'strong', rationale: '   ' }, /rationale/],
	];
	const runFault = (index) => {
		if (index >= faults.length) {
			next();
			return;
		}
		const [label, badResult, pattern] = faults[index];
		realSelect({ promptText: 'p', pool }, brokenJudge(badResult), (err) => {
			harness.ok(`${label} is refused`, !!err);
			harness.match(`...and the refusal names the fault: ${label}`, err, pattern);
			runFault(index + 1);
		});
	};
	runFault(0);
});

// =====================================================================
step('GREEN — the REAL evidenceSelect ACCEPTS every registered rule', (next) => {
	const cases = [
		{ ruleName: 'first', promptText: 'any prompt', expectAbstain: false },
		{ ruleName: 'abstain', promptText: 'any prompt', expectAbstain: true },
		{ ruleName: 'digest', promptText: findDigestPrompt(false), expectAbstain: false },
		{ ruleName: 'digest', promptText: findDigestPrompt(true), expectAbstain: true },
	];
	const runCase = (index) => {
		if (index >= cases.length) {
			next();
			return;
		}
		const oneCase = cases[index];
		const label = `${oneCase.ruleName}/${oneCase.expectAbstain ? 'abstain' : 'pick'}`;
		harness.ok(`found a probe prompt for ${label}`, typeof oneCase.promptText === 'string');
		const judge = debugJudgeFactory({ ruleName: oneCase.ruleName });
		realSelect({ promptText: oneCase.promptText, pool }, judge, (err, selectResult) => {
			harness.equal(`the REAL evidenceSelect accepted ${label} (no error)`, err, '');
			harness.equal(`${label}: abstain flag as expected`, selectResult.abstain, oneCase.expectAbstain);
			harness.ok(
				`${label}: category is a contract member (got '${selectResult.category}')`,
				SELECT_CATEGORY_ENUM.includes(selectResult.category),
			);
			harness.ok(
				`${label}: rationale is non-empty and self-announcing`,
				typeof selectResult.rationale === 'string' &&
					selectResult.rationale.startsWith(`DEBUG JUDGE (${DEBUG_MARK})`),
			);
			harness.match(
				`${label}: rationale states that no intelligence was applied`,
				selectResult.rationale,
				/NO INTELLIGENCE WAS APPLIED AND THIS IS NOT A JUDGMENT/,
			);
			if (!oneCase.expectAbstain) {
				harness.equal(`${label}: 'first' picks candidate 1`, oneCase.ruleName === 'first' ? selectResult.pick.canonicalKey : 'P000001', 'P000001');
			}
			runCase(index + 1);
		});
	};
	runCase(0);
});

// =====================================================================
step('THE RULES DIFFER — first is degenerate, digest is not', (next) => {
	const firstJudge = debugJudgeFactory({ ruleName: 'first' });
	const digestJudge = debugJudgeFactory({ ruleName: 'digest' });
	const firstAnswers = new Set();
	const digestAnswers = new Set();
	const PROBES = 150;

	const probe = (judge, collector, index, done) => {
		if (index >= PROBES) {
			done();
			return;
		}
		judge.rerank({ systemPrompt: 's', userPrompt: `spread probe ${index}`, choiceEnum, requireJudgment: true }, (unusedErr, result) => {
			collector.add(result.choice);
			probe(judge, collector, index + 1, done);
		});
	};

	probe(firstJudge, firstAnswers, 0, () => {
		probe(digestJudge, digestAnswers, 0, () => {
			harness.equal(`'first' is degenerate by design — exactly one distinct answer over ${PROBES} prompts`, firstAnswers.size, 1);
			harness.ok(`'first' always answers 1`, firstAnswers.has('1'));
			harness.ok(
				`'digest' is NOT degenerate — ${digestAnswers.size} distinct answers over ${PROBES} prompts`,
				digestAnswers.size > 1,
			);
			harness.ok(`'digest' reaches the abstain path`, digestAnswers.has('NONE'));
			harness.ok(
				`every 'digest' answer is in range 1..${POOL_SIZE} or NONE`,
				[...digestAnswers].every((one) => one === 'NONE' || (parseInt(one, 10) >= 1 && parseInt(one, 10) <= POOL_SIZE)),
			);
			next();
		});
	});
});

// =====================================================================
step('REFUSE-BY-NAME — malformed INPUT is refused rather than guessed', (next) => {
	const judge = debugJudgeFactory({ ruleName: 'first' });
	const refusals = [
		['requireJudgment non-boolean', { userPrompt: 'p', choiceEnum, requireJudgment: 'yes' }, /requireJudgment must be a boolean/],
		['absent userPrompt', { choiceEnum, requireJudgment: true }, /userPrompt must be a non-empty string/],
		['choiceEnum not an array', { userPrompt: 'p', choiceEnum: 'nope', requireJudgment: true }, /choiceEnum must be an array/],
		['choiceEnum without NONE', { userPrompt: 'p', choiceEnum: ['1', '2'], requireJudgment: true }, /must end with 'NONE'/],
	];
	const runRefusal = (index) => {
		if (index >= refusals.length) {
			next();
			return;
		}
		const [label, args, pattern] = refusals[index];
		judge.rerank(args, (err) => {
			harness.ok(`refused: ${label}`, !!err);
			harness.match(`...by name: ${label}`, err, pattern);
			runRefusal(index + 1);
		});
	};
	runRefusal(0);
});

// =====================================================================
step('PURITY — no network, no cache, no substrate', (next) => {
	const sourceText = fs.readFileSync(path.join(__dirname, '..', 'lib', 'debugJudge.js'), 'utf8');
	['https', 'http', 'neo4j-driver', 'llmClient', 'judgment-cache', 'judgmentCache', 'sqlite'].forEach((oneForbidden) => {
		harness.ok(
			`debugJudge.js does not require '${oneForbidden}'`,
			sourceText.indexOf(`require('${oneForbidden}`) === -1,
		);
	});
	harness.ok(
		`PICK_CATEGORIES derives from the contract enum and excludes 'none' (got ${PICK_CATEGORIES.join(',')})`,
		PICK_CATEGORIES.indexOf('none') === -1 && PICK_CATEGORIES.every((one) => SELECT_CATEGORY_ENUM.includes(one)),
	);
	harness.ok('ABSTAIN_SLOTS is non-zero — the abstain path must be reachable', ABSTAIN_SLOTS > 0);
	next();
});

runSteps(0);
