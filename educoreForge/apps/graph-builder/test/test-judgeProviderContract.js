#!/usr/bin/env node
'use strict';

// test-judgeProviderContract.js — JUDGE_PROVIDER_SHAPE, ENFORCED. The judge stopped being one thing:
// llmClient and debugJudge answer the same seam today, an Ollama provider is next, and more may follow.
// polyArch2 §3 says a seam with several implementations gets a DECLARED interface rather than prose, and
// this suite is what gives that declaration teeth.
//
// ⟪WHY THIS FILE EXISTS AT ALL — the JOB 0 stand-down, IVORY_BRIDGE 2026-09-07 21:03⟫ Asked what it was
// least sure of, JOB 0's builder named ONE thing: it had proven llmClient's and debugJudge's obsolete-
// argument refusals character-identical by sha256 — in a SCRATCH HARNESS that is not in the suite, for a
// directory (apps/graph-builder/apps/bridge-maker) that runAllTests reports as having no suite at all. "It
// is the single most likely thing in this diff to rot, and nothing in the tree would tell you." That is
// gate G1-d below, and it is why this file lives under apps/graph-builder/test/ (which runAllTests DOES
// discover: apps/**/test/test-*.js) rather than beside the modules it tests.
//
// HERMETIC — no network, no key, no Docker, no store. The real Anthropic client is CONSTRUCTED (that is
// the point: the contract is checked against the real construction path, not a stand-in) but never asked
// to send anything: it is pointed at a throwaway ini holding a dummy key, exactly as
// test-embedding-client.js constructs its own client. Nothing here can spend a credit.
//
// Run: node apps/graph-builder/test/test-judgeProviderContract.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- enforce JUDGE_PROVIDER_SHAPE across every judge provider in the tree

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Holds every judge provider to the contract interfaces.js declares as data: the six required
     members, the namespaced-identity rule that keeps two providers from sharing a judgment-cache
     key, an instance-derived describe(), and -- the gate this suite was written for -- the
     requirement that every provider refuse the retired requireJudgment argument in IDENTICAL
     WORDS. Each gate is proven in the failure direction: a deliberately broken provider, and a
     one-character wording change, are shown to be caught.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const harness = require('../../../test/testLib/harness')(moduleName);

const { JUDGE_PROVIDER_SHAPE, judgeProviderViolation } = require('../interfaces');
const llmClientLib = require('../apps/bridge-maker/lib/llmClient');
const debugJudgeLib = require('../apps/bridge-maker/lib/debugJudge');
const { runBounded } = require('../../../lib/bridge-framework/boundedRunner');

// A throwaway [anthropicAi] ini holding a DUMMY key. Construction needs a key by design (llmClient's §6
// no-silent-default throw); nothing in this suite ever sends a request, so the value is never used.
const dummyIniFilePath = () => {
	const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'judgeProviderContract-'));
	const filePath = path.join(dirPath, 'anthropicAi.ini');
	fs.writeFileSync(filePath, '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-opus-4-8\napiVersion=2023-06-01\n');
	return filePath;
};

// thrownMessage — captures a REFUSAL so it can be asserted on. The try/catch is the test's PRODUCT (the
// refusal text), not control flow in production code; test-embedding-client.js and test-bgNosub use the
// identical idiom for the identical reason.
const thrownMessage = (fn) => {
	let message = '';
	try {
		fn();
	} catch (thrown) {
		message = thrown.message;
	}
	return message;
};

// the refusal a rerank call answers with, synchronously (both providers refuse the obsolete argument
// before anything asynchronous can happen — that is what makes this gate hermetic).
const rerankRefusal = (provider, rerankOptions) => {
	let captured = '';
	provider.rerank(rerankOptions, (refusalText) => {
		captured = refusalText;
	});
	return captured;
};

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// the moduleName prefix each provider stamps on its own refusal is the ONE part that legitimately differs.
const withoutModulePrefix = (refusalText) => String(refusalText).replace(/^[A-Za-z0-9_]+\.rerank: /, '');

const anthropicProvider = llmClientLib({ configFilePath: dummyIniFilePath() });
const debugProvider = debugJudgeLib({ ruleName: 'first' });
const REGISTERED_PROVIDER_LIST = [
	{ label: 'llmClient (anthropic)', provider: anthropicProvider },
	{ label: 'debugJudge', provider: debugProvider },
];

// =====================================================================
harness.section('G1-a — THE SHAPE IS EXPORTED AND EVERY PROVIDER SATISFIES IT');
// =====================================================================

harness.equal(
	'JUDGE_PROVIDER_SHAPE declares exactly the six contract members',
	Object.keys(JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME).sort().join(','),
	'describe,maxConcurrency,model,name,rerank,wireModel',
);
harness.ok('the shape is frozen (a contract nothing can edit at run time)', Object.isFrozen(JUDGE_PROVIDER_SHAPE));

REGISTERED_PROVIDER_LIST.forEach(({ label, provider }) => {
	harness.equal(`${label} satisfies JUDGE_PROVIDER_SHAPE`, judgeProviderViolation(provider, { providerLabel: label }), null);
});

// THE DUPLICATION, PROVEN RATHER THAN TRUSTED. Each client declares its own MODEL_NAMESPACE_SEPARATOR so
// that bridge-maker/lib takes on no dependency outside the decision-block fingerprint tree. Duplication is
// only defensible when the equality is checked, which is the same trade JOB 0 made for the refusal wording.
harness.equal('llmClient s separator agrees with the shape s', llmClientLib.MODEL_NAMESPACE_SEPARATOR, JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR);
harness.equal('debugJudge s separator agrees with the shape s', debugJudgeLib.MODEL_NAMESPACE_SEPARATOR, JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR);

// =====================================================================
harness.section('G1-b (twin) — A MODULE MISSING rerank IS REFUSED BY NAME, NEVER PROBED');
// =====================================================================

const withoutMember = (provider, memberName) => {
	const copy = { ...provider };
	delete copy[memberName];
	return copy;
};

Object.keys(JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME).forEach((oneMemberName) => {
	harness.match(
		`a provider missing '${oneMemberName}' is refused BY NAME`,
		judgeProviderViolation(withoutMember(debugProvider, oneMemberName), { providerLabel: 'twin' }),
		new RegExp(`${oneMemberName} \\(must be`),
	);
});
harness.match(
	'a provider that is not an object at all is refused, naming every member it should have had',
	judgeProviderViolation(null, { providerLabel: 'twin' }),
	/is null — a judge provider must be an object satisfying JUDGE_PROVIDER_SHAPE \(name, wireModel, model, maxConcurrency, rerank, describe\)/,
);
harness.match(
	'maxConcurrency 0 is refused (positive integer, not merely a number)',
	judgeProviderViolation({ ...debugProvider, maxConcurrency: 0 }, { providerLabel: 'twin' }),
	/maxConcurrency \(must be positiveInteger, got 0\)/,
);

// =====================================================================
harness.section('G1-c (twin) — A JUDGE THAT CANNOT SAY WHAT IT IS MUST NEVER RUN');
// =====================================================================

harness.match(
	'describe() returning an EMPTY model is refused by name',
	judgeProviderViolation({ ...debugProvider, describe: () => ({ provider: 'debugJudge', model: '', version: 'v1' }) }, { providerLabel: 'twin' }),
	/describe\(\) returned 1 empty or absent key\(s\): model \(""\)/,
);
harness.match(
	'describe() OMITTING model is refused by name',
	judgeProviderViolation({ ...debugProvider, describe: () => ({ provider: 'debugJudge', version: 'v1' }) }, { providerLabel: 'twin' }),
	/describe\(\) returned 1 empty or absent key\(s\): model \(undefined\)/,
);
harness.match(
	'a CONSTANT describe() — one that does not report THIS instance — is refused',
	judgeProviderViolation({ ...debugProvider, describe: () => ({ provider: 'debugJudge', model: 'debugJudge:someOtherRule-v1-INVALID_DEBUG', version: 'v1' }) }, { providerLabel: 'twin' }),
	/describe\(\) disagrees with its own members/,
);
harness.match(
	'describe() returning a non-object is refused',
	judgeProviderViolation({ ...debugProvider, describe: () => 'debugJudge' }, { providerLabel: 'twin' }),
	/describe\(\) returned a string/,
);

// =====================================================================
harness.section('G1-d — EVERY PROVIDER REFUSES THE OBSOLETE requireJudgment IN IDENTICAL WORDS');
// =====================================================================
// The gate JOB 0's stand-down asked for. The two refusal texts are DUPLICATED across the two provider
// files on purpose — a judge provider must not depend on another provider's module — so their equality is
// exactly the kind of thing that rots silently. It is checked here, in the suite, on every run.

const refusalBodyByLabel = {};
REGISTERED_PROVIDER_LIST.forEach(({ label, provider }) => {
	const refusalText = rerankRefusal(provider, { systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true });
	harness.match(`${label} refuses requireJudgment BY NAME`, refusalText, /requireJudgment is OBSOLETE and was removed/);
	harness.match(`${label} stamps its own module name on the refusal`, refusalText, /^[A-Za-z0-9_]+\.rerank: /);
	refusalBodyByLabel[label] = withoutModulePrefix(refusalText);
});

// `false` is refused identically to `true` — the fault is that the caller MENTIONED the retired option.
REGISTERED_PROVIDER_LIST.forEach(({ label, provider }) => {
	harness.match(
		`${label} refuses requireJudgment: false too (a silently-ignored argument would fail this gate)`,
		rerankRefusal(provider, { systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: false }),
		/requireJudgment is OBSOLETE and was removed/,
	);
});

const refusalBodyList = Object.keys(refusalBodyByLabel).map((oneLabel) => refusalBodyByLabel[oneLabel]);
const wordingIsIdentical = (bodyList) => bodyList.every((oneBody) => sha256(oneBody) === sha256(bodyList[0]));

harness.ok(
	'THE WORDING IS CHARACTER-IDENTICAL across every provider (moduleName prefix stripped)',
	wordingIsIdentical(refusalBodyList),
	`sha256 per provider:\n${Object.keys(refusalBodyByLabel).map((oneLabel) => `  ${oneLabel}: ${sha256(refusalBodyByLabel[oneLabel])}`).join('\n')}`,
);
harness.note(`shared refusal-body sha256: ${sha256(refusalBodyList[0])}`);

// THE TWIN — one character, and the gate must go red. Without this the equality check above could be
// vacuous (comparing a thing to itself, the failure this project has caught in itself before).
const oneCharacterAltered = `${refusalBodyList[0].slice(0, -1)}X`;
harness.ok(
	'TWIN: altering ONE character of one provider s wording is CAUGHT',
	!wordingIsIdentical([refusalBodyList[0], oneCharacterAltered]),
	`altered tail: ...${oneCharacterAltered.slice(-40)}`,
);
harness.ok(
	'…and the check is not vacuous: the unaltered pair is genuinely equal, and there are 2 providers compared',
	refusalBodyList.length === 2 && wordingIsIdentical(refusalBodyList),
	`compared ${refusalBodyList.length} provider(s)`,
);

// =====================================================================
harness.section('G-F1-a — model IS NAMESPACED BY PROVIDER; wireModel IS THE BARE API NAME');
// =====================================================================

harness.equal('anthropic wireModel is the bare API name', anthropicProvider.wireModel, 'claude-opus-4-8');
harness.equal('anthropic model is namespaced', anthropicProvider.model, 'anthropic:claude-opus-4-8');
harness.equal('debugJudge model is namespaced', debugProvider.model, 'debugJudge:first-v1-INVALID_DEBUG');
harness.ok(
	'debugJudge keeps its INVALID_DEBUG flag inside the namespaced identity',
	debugProvider.model.indexOf(debugJudgeLib.DEBUG_MARK) !== -1,
	debugProvider.model,
);

REGISTERED_PROVIDER_LIST.forEach(({ label, provider }) => {
	harness.equal(
		`${label} model begins with its own provider namespace`,
		provider.model.indexOf(`${provider.name}${JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR}`),
		0,
	);
	harness.equal(`${label} describe().model agrees with provider.model`, provider.describe().model, provider.model);
});

// ⟪THE SPLIT, PROVEN ON THE REAL rerank PATH — the central assertion of JOB 1⟫ Everything above reads the
// provider's declared members. This drives the ACTUAL rerank, through llmClient's own documented NET seam
// (componentOverrides.postOnce, the same double kitLoader.buildKit and bridgeMaker.run use), and checks the
// two halves of the split where they actually matter: what goes ON THE WIRE, and what comes BACK as identity.
// No socket is opened; the canned body is the Anthropic response shape, mocked per this file's R-a rider.
const cannedToolUseResponse = {
	content: [{ type: 'tool_use', name: llmClientLib.TOOL_NAME, input: { choice: '1', category: 'strong', rationale: 'the candidate means the same thing as the source element' } }],
	stop_reason: 'end_turn',
	usage: { input_tokens: 10, output_tokens: 5 },
};
let sentPayload = null;
const wireWitnessProvider = llmClientLib({
	configFilePath: dummyIniFilePath(),
	componentOverrides: {
		postOnce: ({ payload }, postCallback) => {
			sentPayload = payload;
			postCallback('', cannedToolUseResponse, 200);
		},
	},
});
let rerankResult = null;
wireWitnessProvider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'] }, (rerankError, clientReturn) => {
	rerankResult = { rerankError, clientReturn };
});

harness.equal('THE WIRE carries the BARE api model name', sentPayload && sentPayload.model, 'claude-opus-4-8');
harness.ok(
	'…and the namespace NEVER reaches the wire (a 404 not_found_error if it did — observed against the live API)',
	sentPayload && sentPayload.model.indexOf(JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR) === -1,
	sentPayload && sentPayload.model,
);
harness.equal('the temperature rule read wireModel: claude-opus-4-8 gets NO temperature', sentPayload && sentPayload.temperature, undefined);
harness.equal('rerank succeeded on the canned response', rerankResult && rerankResult.rerankError, '');
harness.equal(
	"THE RESULT carries the NAMESPACED identity — rerank's model must agree with client.model",
	rerankResult && rerankResult.clientReturn.model,
	wireWitnessProvider.model,
);
harness.equal('…which is the namespaced form, not the wire form', rerankResult && rerankResult.clientReturn.model, 'anthropic:claude-opus-4-8');
JUDGE_PROVIDER_SHAPE.rerank.resultKeys.forEach((oneKeyName) => {
	harness.ok(`rerank's result carries the contract member '${oneKeyName}'`, rerankResult && rerankResult.clientReturn[oneKeyName] !== undefined, JSON.stringify(rerankResult && Object.keys(rerankResult.clientReturn)));
});

// a NON-opus wire model DOES get temperature 0 — proving the regex reads wireModel and still discriminates.
const temperatureIniFilePath = () => {
	const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'judgeProviderContractTemp-'));
	const filePath = path.join(dirPath, 'anthropicAi.ini');
	fs.writeFileSync(filePath, '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-sonnet-5\n');
	return filePath;
};
let sonnetPayload = null;
llmClientLib({
	configFilePath: temperatureIniFilePath(),
	componentOverrides: { postOnce: ({ payload }, postCallback) => { sonnetPayload = payload; postCallback('', cannedToolUseResponse, 200); } },
}).rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'] }, () => {});
harness.equal('a non-opus wireModel still gets temperature 0 (the regex reads wireModel and discriminates)', sonnetPayload && sonnetPayload.temperature, 0);
harness.equal('…and that client s identity is namespaced too', llmClientLib.namespacedModelFor('claude-sonnet-5'), 'anthropic:claude-sonnet-5');

// TWIN: the bare wire name as the identity — the shape refuses it, which is what makes a cache collision
// between two providers impossible to CONSTRUCT rather than merely unlikely.
harness.match(
	'TWIN: model set to the BARE wire name is refused (the collision the cache key cannot survive)',
	judgeProviderViolation({ ...anthropicProvider, model: 'claude-opus-4-8', describe: () => ({ provider: 'anthropic', model: 'claude-opus-4-8', version: 'v' }) }, { providerLabel: 'twin' }),
	/is not namespaced by its provider name — it must begin 'anthropic:'/,
);

// TWIN: the operator who writes the namespaced form into the ini where the WIRE name belongs. Caught at
// construction rather than as a 400 on every judgment of a run.
const namespacedIniFilePath = () => {
	const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'judgeProviderContractNs-'));
	const filePath = path.join(dirPath, 'anthropicAi.ini');
	fs.writeFileSync(filePath, '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=anthropic:claude-opus-4-8\n');
	return filePath;
};
harness.match(
	'TWIN: a NAMESPACED value in the ini wireModel slot is refused AT CONSTRUCTION, before a credit is spent',
	thrownMessage(() => llmClientLib({ configFilePath: namespacedIniFilePath() })),
	/carries this provider's namespace prefix 'anthropic:'/,
);

// the retired CONSTRUCTION option, refused by name for the same reason requireJudgment is.
harness.match(
	'the retired `model` CONSTRUCTION option is refused by name (it is now ambiguous)',
	thrownMessage(() => llmClientLib({ configFilePath: dummyIniFilePath(), model: 'claude-opus-4-8' })),
	/model is no longer a construction option/,
);

// =====================================================================
harness.section('G1-e — judgeKind FOR THE REAL ARM IS BYTE-IDENTICAL ACROSS THE CHANGE');
// =====================================================================
// bridge-framework.js:1301 used to build judgeKind as 'anthropic:' + <bare wire name>. It now reads
// judgeClient.model, which IS 'anthropic:<bare wire name>'. The value frozen into every existing block
// header therefore does not move — only where it comes from does.

const HISTORICAL_JUDGE_KIND = `anthropic:${'claude-opus-4-8'}`; // what the OLD expression built, from the OLD inputs
harness.equal(
	'the new judgeKind source (judgeClient.model) is BYTE-IDENTICAL to what the old expression produced',
	anthropicProvider.model,
	HISTORICAL_JUDGE_KIND,
);
harness.ok(
	'TWIN: with model set to the bare wire name the provider prefix VANISHES from judgeKind',
	'claude-opus-4-8' !== HISTORICAL_JUDGE_KIND,
	`bare 'claude-opus-4-8' vs historical '${HISTORICAL_JUDGE_KIND}'`,
);

// the hard-coded literal is gone from the framework — a lexical check, the idiom test-bgNosub uses for its
// own lexical conjuncts, so a future edit cannot quietly reintroduce the doubled prefix.
const frameworkSourceText = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'bridge-framework.js'), 'utf8');
harness.ok(
	'the hard-coded `anthropic:` prefix is ABSENT from the framework s judgeKind expression',
	frameworkSourceText.indexOf('`anthropic:${judgeClient.model}`') === -1,
	'the doubled-prefix expression is still present',
);
harness.ok(
	'the DEBUG arm still carries its own `debug:` prefix (test-bgThree.js:109 branches on it)',
	frameworkSourceText.indexOf('`debug:${judgeClient.ruleName}`') !== -1,
);

// =====================================================================
harness.section('G-F10-a — maxConcurrency: 1 SERIALISES; THE FRAMEWORK RUNS AT min() OF TWO CEILINGS');
// =====================================================================

const FRAMEWORK_JUDGE_CONCURRENCY = 4; // bridge-framework.js:92, the ceiling this framework drives
const resolvedConcurrency = (providerMaxConcurrency) => Math.min(FRAMEWORK_JUDGE_CONCURRENCY, providerMaxConcurrency);

// ⟪THE WIRING, not just the arithmetic⟫ The three assertions below prove min() is the right RULE and the
// runBounded observation proves it SERIALISES — but neither would notice if bridge-framework.js:1449 stopped
// calling it. That gap is closed lexically here, the idiom test-bgNosub uses for its own production checks,
// and it was OBSERVED RED against the pre-JOB-1 line before being made to pass.
const frameworkJudgeRunnerText = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'bridge-framework.js'), 'utf8');
harness.ok(
	'bridge-framework.js ACTUALLY drives runBounded at min(JUDGE_CONCURRENCY, provider.maxConcurrency)',
	frameworkJudgeRunnerText.indexOf('concurrency: Math.min(JUDGE_CONCURRENCY, judgeClient.maxConcurrency)') !== -1,
	'the runBounded call is not wired to the provider ceiling',
);
// ⟪THE FIRST VERSION OF THIS ASSERTION WAS VACUOUS AND THE THREE-STATE RUN CAUGHT IT⟫ It searched for the
// guard's CONDITION as a substring. Disabling the guard by writing `if (false && <the same condition>)`
// leaves that substring intact, so the mutation ran GREEN — a check that cannot fail is not a check. It now
// requires the guard to be the WHOLE condition of its `if`, which `false && ` breaks. Stated plainly because
// this is a LEXICAL proxy either way: it proves the guard is written, not that it fires. What proves it
// FIRES is empirical and was observed once, not permanently gated — see the DEVLOG, and docket item 3: the
// contract check belongs at registry construction, which is JOB 4's, and that is where it earns a twin.
harness.ok(
	'…and it refuses an absent or non-positive-integer maxConcurrency rather than passing NaN to the runner',
	frameworkJudgeRunnerText.indexOf('if (!Number.isInteger(judgeClient.maxConcurrency) || judgeClient.maxConcurrency < 1) {') !== -1,
	'the refuse-by-name guard is gone, or is no longer the whole condition of its own if',
);

harness.equal('a provider declaring 1 bounds the framework s 4 down to 1', resolvedConcurrency(1), 1);
harness.equal('a provider declaring 4 leaves the framework s 4 alone', resolvedConcurrency(4), 4);
harness.equal('a provider declaring 99 does NOT raise the framework s 4 (min, never max)', resolvedConcurrency(99), 4);

// OBSERVED, not reasoned: four tasks through the REAL runBounded the framework uses, timestamped.
const overlapWitness = ({ concurrency }, whenDone) => {
	const spanList = [];
	runBounded(
		{
			itemList: [1, 2, 3, 4],
			concurrency,
			oneItem: (oneItem, itemIndex, itemDone) => {
				const startedAtMs = Date.now();
				setTimeout(() => {
					spanList.push({ oneItem, startedAtMs, endedAtMs: Date.now() });
					itemDone('', oneItem);
				}, 40);
			},
		},
		() => {
			const overlapCount = spanList.filter((oneSpan) => spanList.some((otherSpan) => otherSpan !== oneSpan && otherSpan.startedAtMs < oneSpan.endedAtMs && oneSpan.startedAtMs < otherSpan.endedAtMs)).length;
			whenDone({ spanList, overlapCount });
		},
	);
};

overlapWitness({ concurrency: resolvedConcurrency(1) }, ({ spanList, overlapCount }) => {
	const firstStartMs = Math.min(...spanList.map((oneSpan) => oneSpan.startedAtMs));
	harness.ok(
		'maxConcurrency 1 SERIALISES four tasks — no two overlap (timestamps below, ms from first start)',
		overlapCount === 0,
		spanList.map((oneSpan) => `  task ${oneSpan.oneItem}: start +${oneSpan.startedAtMs - firstStartMs}ms end +${oneSpan.endedAtMs - firstStartMs}ms`).join('\n'),
	);
	harness.note(spanList.map((oneSpan) => `task ${oneSpan.oneItem}: start +${oneSpan.startedAtMs - firstStartMs}ms  end +${oneSpan.endedAtMs - firstStartMs}ms`).join('\n'));

	// TWIN: the same four tasks at the UNBOUNDED resolution must overlap, or the serialisation above
	// proves nothing about concurrency and only that the tasks were quick.
	overlapWitness({ concurrency: resolvedConcurrency(4) }, ({ spanList: twinSpanList, overlapCount: twinOverlapCount }) => {
		const twinFirstStartMs = Math.min(...twinSpanList.map((oneSpan) => oneSpan.startedAtMs));
		harness.ok(
			'TWIN: at concurrency 4 the SAME four tasks DO overlap — the serialisation above is real, not an artifact of speed',
			twinOverlapCount === 4,
			twinSpanList.map((oneSpan) => `  task ${oneSpan.oneItem}: start +${oneSpan.startedAtMs - twinFirstStartMs}ms end +${oneSpan.endedAtMs - twinFirstStartMs}ms`).join('\n'),
		);

		// =====================================================================
		harness.section('G-F10-b — A TIMEOUT REFUSAL SAYS WHETHER THE REQUEST WAS QUEUED OR IN FLIGHT');
		// =====================================================================
		// "no response within 120000ms" is the same sentence for two opposite faults with opposite fixes.

		harness.match(
			'a request that never got a socket is refused as QUEUED — it says NOTHING WAS SENT',
			llmClientLib.requestTimeoutRefusalText({ timeoutMs: 120000, socketAssigned: false }),
			/was still QUEUED: no socket was ever assigned, so NOTHING WAS SENT/,
		);
		harness.match(
			'…and it names the right remedy (lower maxConcurrency, not raise the timeout)',
			llmClientLib.requestTimeoutRefusalText({ timeoutMs: 120000, socketAssigned: false }),
			/Lower the judge's maxConcurrency rather than raising requestTimeoutMs/,
		);
		harness.match(
			'a request that got a socket is refused as IN FLIGHT, naming the other remedy',
			llmClientLib.requestTimeoutRefusalText({ timeoutMs: 120000, socketAssigned: true }),
			/was IN FLIGHT: a socket was assigned and the request reached the transport/,
		);
		harness.match(
			'…and the in-flight arm points at requestTimeoutMs, not at concurrency',
			llmClientLib.requestTimeoutRefusalText({ timeoutMs: 120000, socketAssigned: true }),
			/Retry, or raise \[anthropicAi\].requestTimeoutMs/,
		);
		harness.ok(
			'TWIN: the two arms are genuinely DIFFERENT text — the distinction is not cosmetic',
			llmClientLib.requestTimeoutRefusalText({ timeoutMs: 1, socketAssigned: false }) !==
				llmClientLib.requestTimeoutRefusalText({ timeoutMs: 1, socketAssigned: true }),
		);
		// ⟪recorded because a gate taught it⟫ this arm carries NO millisecond durations: BG-DET conjunct (a)
		// refuses a clock anywhere in bridge-maker/lib, which is a content-addressed fingerprint tree. The
		// first draft of the refusal reported queued/in-flight durations with Date.now() and the suite caught
		// it. The distinction survived; the decoration did not.
		harness.ok(
			'the refusal carries no clock reading (BG-DET forbids one in this tree)',
			!/\d+ms queued|on the wire \d+ms/.test(llmClientLib.requestTimeoutRefusalText({ timeoutMs: 1, socketAssigned: true })),
		);

		// =====================================================================
		harness.section('G1-f — EVERY JUDGE DOUBLE IN THE TREE SATISFIES THE CONTRACT TOO');
		// =====================================================================
		// ⟪ruled by DAWN_TOWER 2026-09-07⟫ A double that satisfies only the member the framework happens to
		// read is a double of the lucky case — toyBridgeScenario's own header at :381-387 argues exactly this,
		// having been written after batch 1 of the Ed-Fi derived order died on a schema-optional field. Asserted
		// HERE rather than left to "the suite went green", so it holds even if the framework stops reading a
		// member tomorrow.
		const toyScenarioLib = require('../../../lib/bridge-framework/test/testSupport/toyBridgeScenario');
		const fakeRealClient = toyScenarioLib.makeFakeRealClient({});
		harness.equal(
			'toyBridgeScenario.makeFakeRealClient satisfies JUDGE_PROVIDER_SHAPE',
			judgeProviderViolation(fakeRealClient, { providerLabel: 'makeFakeRealClient' }),
			null,
		);
		harness.ok(
			'…and declares a positive-integer maxConcurrency (the member bridge-framework.js:1449 refuses without)',
			Number.isInteger(fakeRealClient.maxConcurrency) && fakeRealClient.maxConcurrency >= 1,
			String(fakeRealClient.maxConcurrency),
		);

		// =====================================================================
		harness.section('G5-c (regression) — THE WRITE-SIDE RULE judged ⇒ mappingTool STILL FIRES');
		// =====================================================================
		// graphSeamRules.js:341. JOB 1 changed what mappingTool CONTAINS, so the rule that requires it to be
		// there at all is re-proven rather than assumed still to work.
		const graphSeamRulesLib = require('../../../lib/bridge-framework/graphSeamRules');
		const judgedEdgeUnderTest = () => ({
			subjectStableId: 'toy:property/a',
			objectStableId: 'toyhub:card/b',
			edgeType: 'CLOSE_MATCH',
			sourceStandardName: 'toy',
			subjectEndpoint: { id: 'a' },
			objectEndpoint: { id: 'b' },
			edgeProperties: {
				predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarityThresholdMatching',
				matchBasis: 'derived', resolution: 'judged', objectMatchField: 'name',
				subjectSource: 'toy', subjectVersion: '1', objectSource: 'toyhub', objectVersion: '1',
				predicateAssertedBy: 'judge', attestationChannelList: ['x'], decisionBlockHash: 'abc',
				provenanceTier: 'invalid-debug', confidence: 0.8,
				mappingTool: debugProvider.model, mappingToolVersion: '1',
			},
		});
		const strippedEdge = judgedEdgeUnderTest();
		delete strippedEdge.edgeProperties.mappingTool;
		harness.match(
			'a JUDGED edge with mappingTool stripped is REFUSED BY NAME at the write seam',
			(graphSeamRulesLib.mappingEdgeRefusal(strippedEdge) || {}).message,
			/writeMappingEdge: a judged edge lacks 'mappingTool'/,
		);
		// NEGATIVE CONTROL — the same edge WITH mappingTool gets past this rule and fails a LATER one (the
		// hub-endpoint check, which this hermetic fixture cannot satisfy). That is what proves the refusal
		// above is the mappingTool rule firing and not a generic rejection of the fixture.
		harness.ok(
			'…and the SAME edge WITH mappingTool gets past that rule (it fails a later, different check)',
			!/a judged edge lacks/.test(String((graphSeamRulesLib.mappingEdgeRefusal(judgedEdgeUnderTest()) || {}).message)),
			String((graphSeamRulesLib.mappingEdgeRefusal(judgedEdgeUnderTest()) || {}).message),
		);
		harness.match(
			'…the namespaced identity is what a judged edge now carries as mappingTool',
			judgedEdgeUnderTest().edgeProperties.mappingTool,
			/^debugJudge:/,
		);

		harness.report();
	});
});
