#!/usr/bin/env node
'use strict';

// test-ollamaJudgeClient.js — THE OLLAMA JUDGE PROVIDER, HELD TO THE CONTRACT.
// judgeProviderRegistry JOB 3, 2026-09-07.
//
// ⟪WHY THIS FILE WAS WRITTEN BEFORE THE MODULE IT TESTS⟫ v2 §GOVERNANCE: "GATE BEFORE EDIT on any seam that
// has no suite... Write the module's contract gate FIRST — assert what it must return, run it red against
// the empty file — then write the module. A gate written after the edit is an audit; a gate written before
// it is a spec." apps/graph-builder/apps/bridge-maker/lib has no suite of its own and the real client
// factory is never constructed under runAllTests, so TWICE in this campaign a GREEN hermetic suite sat over
// a DEAD production path (JOB 0's omitted caller; JOB 1's rerank callback that lost `choice` for forty
// minutes). This file was written in full and observed RED before ollamaJudgeClient.js had a line — and,
// per COBALT_ANCHOR's JOB 2 learning, red TWICE: once against the nonexistent module (which proves only
// that a file is absent) and again against a DELIBERATELY WRONG STUB, which is what makes each individual
// assertion demonstrate that it discriminates.
//
// HERMETIC — no network, no Docker, no store, and NO OLLAMA. Both seams the provider owns are driven
// through componentOverrides: `fetchModelTagList` stands in for GET /api/tags and `postOnce` for
// POST /api/chat, the same componentOverrides idiom llmClient, kitLoader.buildKit and bridgeMaker.run
// already use for their own doubles. The one deliberate exception is the dead-server gate, which points the
// REAL transport at a closed local port — no server is contacted because nothing is listening, and
// ECONNREFUSED is the whole point of the assertion.
//
// Run: node apps/graph-builder/test/test-ollamaJudgeClient.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the Ollama judge provider satisfies JUDGE_PROVIDER_SHAPE and refuses by name

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Holds ollamaJudgeClient.js to the contract interfaces.js declares as data: the six provider
     members, an identity namespaced by provider AND carrying the model digest read from
     /api/tags, an instance-derived describe(), a refusal of the retired requireJudgment argument
     in wording identical to the other two clients, and an extractor that satisfies
     JUDGMENT_EXTRACTOR_SHAPE with no free-text fallback. Gate G-F12-a's three reds -- a body
     missing rationale, a choice outside the enum, a body that is not JSON at all -- are here,
     each observed rather than reasoned about.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const harness = require('../../../test/testLib/harness')(moduleName);

const BRIDGE_MAKER_LIB_DIR_PATH = path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib');

const { JUDGE_PROVIDER_SHAPE, judgeProviderViolation, JUDGMENT_EXTRACTOR_SHAPE } = require('../interfaces');
const ollamaJudgeClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'ollamaJudgeClient'));
const llmClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'llmClient'));
const debugJudgeLib = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'debugJudge'));
const selectCandidateSchemaLib = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'selectCandidateSchema'));
const { SELECT_CATEGORY_ENUM } = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'evidenceContracts'));

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// thrownMessage — captures a REFUSAL so it can be asserted on. The try/catch is this test's PRODUCT (the
// refusal text), never control flow in production code; test-judgeProviderContract.js and
// test-selectCandidateSchema.js use the identical idiom for the identical reason.
const thrownMessage = (fn) => {
	let message = '';
	try {
		fn();
	} catch (thrown) {
		message = thrown.message;
	}
	return message;
};

// THE EXPECTATION, DERIVED — never a literal list, for the reason test-selectCandidateSchema.js states: a
// test that hard-codes the enum drifts exactly as the code it watches does, and goes green through the drift.
const EXPECTED_PICK_CATEGORY_LIST = SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== 'none');

const CHOICE_ENUM_FIXTURE = Object.freeze(['1', '2', '3', 'NONE']);

// The digest fixture. It is the REAL digest of qwen2.5:32b as read from the live server on 2026-09-07, used
// here as canned data so the suite needs no server: the point of the gate is that the provider READS the
// digest rather than carrying a literal, and a canned tag list proves that better than a live one, because
// a WRONG digest in the canned list must change the identity.
const DIGEST_FIXTURE = '9f13ba1299afea09d9a956fc6a85becc99115a6d596fae201a5487a03bdc4368';
const DIGEST_PREFIX_FIXTURE = '9f13ba1299af';

const cannedTagListResponse = (overrides = {}) => ({
	models: [
		Object.assign(
			{
				name: 'qwen2.5:32b',
				model: 'qwen2.5:32b',
				size: 19851349669,
				digest: DIGEST_FIXTURE,
				details: { family: 'qwen2', parameter_size: '32.8B', quantization_level: 'Q4_K_M' },
			},
			overrides,
		),
	],
});

// A complete ini holding exactly the keys DAWN_TOWER ruled. Written to a throwaway directory per
// construction so that a gate which REMOVES a key cannot disturb any other gate.
const OLLAMA_INI_ROW_BY_KEY = {
	endpointHostName: '127.0.0.1',
	endpointPortNumber: '11434',
	wireModel: 'qwen2.5:32b',
	maxConcurrency: '1',
	requestTimeoutMs: '180000',
	numPredict: '400',
};

const iniFilePathWith = (rowByKey) => {
	const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ollamaJudgeClient-'));
	const filePath = path.join(dirPath, 'ollamaJudge.ini');
	const bodyText = Object.keys(rowByKey)
		.map((oneKeyName) => `${oneKeyName}=${rowByKey[oneKeyName]}`)
		.join('\n');
	fs.writeFileSync(filePath, `[ollamaJudge]\n${bodyText}\n`);
	return filePath;
};

const completeIniFilePath = () => iniFilePathWith(OLLAMA_INI_ROW_BY_KEY);

const iniFilePathWithout = (omittedKeyName) => {
	const rowByKey = Object.assign({}, OLLAMA_INI_ROW_BY_KEY);
	delete rowByKey[omittedKeyName];
	return iniFilePathWith(rowByKey);
};

// hermeticOverrides — BOTH seams doubled. fetchModelTagList stands in for GET /api/tags at construction;
// postOnce stands in for POST /api/chat during rerank. A test that doubled only one of them would still
// open a socket, and this suite must never do that.
const hermeticOverrides = (extra = {}) =>
	Object.assign(
		{
			fetchModelTagList: (tagCallback) => tagCallback('', cannedTagListResponse()),
		},
		extra,
	);

// constructSynchronously — the construction callback is driven by doubles that call back SYNCHRONOUSLY, so
// the provider is available on the next line. Stated out loud rather than relied on silently: this is a
// property of the DOUBLE, not of the module, and the real construction is genuinely asynchronous.
const constructSynchronously = (constructionOptions) => {
	let captured = { constructionError: 'THE CONSTRUCTION CALLBACK WAS NEVER CALLED', provider: null };
	ollamaJudgeClientLib(constructionOptions, (constructionError, provider) => {
		captured = { constructionError, provider };
	});
	return captured;
};

const okConstruction = (extraOverrides = {}) =>
	constructSynchronously({
		configFilePath: completeIniFilePath(),
		componentOverrides: hermeticOverrides(extraOverrides),
	});

// the refusal a rerank call answers with, synchronously (every provider refuses the obsolete argument
// before anything asynchronous can happen — that is what makes the wording gate hermetic).
const rerankRefusal = (provider, rerankOptions) => {
	let captured = '';
	provider.rerank(rerankOptions, (refusalText) => {
		captured = refusalText;
	});
	return captured;
};

const withoutModulePrefix = (refusalText) => String(refusalText).replace(/^[A-Za-z0-9_]+\.rerank: /, '');

// An Ollama /api/chat envelope. content is a JSON STRING — there is no tool_use block anywhere — and the
// ragged interior whitespace is REAL: it is what qwen2.5:32b actually emitted through this exact rendered
// schema on 2026-09-07 (evidence file JOB3-gF3-liveOllamaProbe.txt). It is reproduced rather than tidied
// because a fixture prettier than reality is a fixture that proves less than it appears to.
const cannedChatResponse = (contentText, envelopeOverrides = {}) =>
	Object.assign(
		{
			model: 'qwen2.5:32b',
			message: { role: 'assistant', content: contentText },
			done: true,
			done_reason: 'stop',
		},
		envelopeOverrides,
	);

const LIVE_SHAPED_CONTENT =
	'{\n  "choice": "2",\n  "category": "moderate"\n \t\t,"rationale":"The candidate \'Person Birth Date\' directly corresponds to the definition provided by the source element \'birthDate\'."\n}';

// =====================================================================
harness.section('G3-a — THE PROVIDER SATISFIES JUDGE_PROVIDER_SHAPE');
// =====================================================================

const { constructionError: firstConstructionError, provider: ollamaProvider } = okConstruction();

harness.equal('construction with a complete ini and a live tag list succeeds', firstConstructionError, '');
harness.ok('…and yields a provider object', !!ollamaProvider);
harness.equal(
	'the ollama provider satisfies JUDGE_PROVIDER_SHAPE',
	judgeProviderViolation(ollamaProvider, { providerLabel: 'ollamaJudgeClient' }),
	null,
);
JUDGE_PROVIDER_SHAPE && Object.keys(JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME).forEach((oneMemberName) => {
	harness.ok(
		`…and carries the contract member '${oneMemberName}'`,
		ollamaProvider && ollamaProvider[oneMemberName] !== undefined,
	);
});

harness.equal('name is the provider id', ollamaProvider && ollamaProvider.name, 'ollama');
harness.equal('wireModel is the BARE Ollama model name', ollamaProvider && ollamaProvider.wireModel, 'qwen2.5:32b');
harness.equal('maxConcurrency is 1, as the ini says', ollamaProvider && ollamaProvider.maxConcurrency, 1);

// =====================================================================
harness.section('G3-a — THE IDENTITY CARRIES THE DIGEST, AND THE DIGEST IS READ, NEVER TYPED');
// =====================================================================

harness.equal(
	'model is namespaced by provider AND carries the digest read from /api/tags',
	ollamaProvider && ollamaProvider.model,
	`ollama:qwen2.5:32b@${DIGEST_PREFIX_FIXTURE}`,
);
harness.equal(
	'…and it begins with the provider namespace the shape requires',
	ollamaProvider && ollamaProvider.model.indexOf(`ollama${JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR}`),
	0,
);
harness.equal(
	'the separator the module declares agrees with the shape s',
	ollamaJudgeClientLib.MODEL_NAMESPACE_SEPARATOR,
	JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR,
);

// ⟪THE ASSERTION THAT MAKES THE DIGEST A READING RATHER THAN A LITERAL⟫ A different digest in the tag list
// must produce a different identity. Without this, a module that hard-coded '9f13ba1299af' would pass every
// assertion above — which is exactly the failure v2 asks the digest to prevent ("so a re-pulled model is a
// different identity").
const repulledDigest = 'ffffffff1111eeeeeeee2222dddddddd3333cccccccc4444bbbbbbbb5555aaaa';
const { provider: repulledProvider } = constructSynchronously({
	configFilePath: completeIniFilePath(),
	componentOverrides: {
		fetchModelTagList: (tagCallback) => tagCallback('', cannedTagListResponse({ digest: repulledDigest })),
	},
});
harness.equal(
	'a RE-PULLED model (a different digest) is a DIFFERENT identity — the digest is read, not typed',
	repulledProvider && repulledProvider.model,
	`ollama:qwen2.5:32b@${repulledDigest.slice(0, 12)}`,
);
harness.ok(
	'…and the two identities genuinely differ (the assertion above is not comparing a value to itself)',
	repulledProvider && ollamaProvider && repulledProvider.model !== ollamaProvider.model,
	`${ollamaProvider && ollamaProvider.model}  vs  ${repulledProvider && repulledProvider.model}`,
);

// a tag list that does not contain the configured model is a CONFIGURATION fault, refused by name rather
// than yielding an identity with `undefined` in it.
const { constructionError: missingModelError } = constructSynchronously({
	configFilePath: completeIniFilePath(),
	componentOverrides: {
		fetchModelTagList: (tagCallback) => tagCallback('', { models: [{ name: 'llama3:8b', digest: 'abc123abc123' }] }),
	},
});
harness.match(
	'a server that does not HAVE the configured model refuses by name, listing what it does have',
	missingModelError,
	/qwen2\.5:32b/,
);
harness.match('…and names the models the server actually offers', missingModelError, /llama3:8b/);

// =====================================================================
harness.section('G3-a — describe() REPORTS THIS INSTANCE, NEVER A CONSTANT');
// =====================================================================

harness.equal(
	'describe().provider agrees with name',
	ollamaProvider && ollamaProvider.describe().provider,
	ollamaProvider && ollamaProvider.name,
);
harness.equal(
	'describe().model agrees with model',
	ollamaProvider && ollamaProvider.describe().model,
	ollamaProvider && ollamaProvider.model,
);
harness.ok(
	'describe().version is a non-empty string',
	!!(ollamaProvider && typeof ollamaProvider.describe().version === 'string' && ollamaProvider.describe().version.length),
	ollamaProvider && ollamaProvider.describe().version,
);
harness.ok(
	'describe() is INSTANCE-DERIVED: the re-pulled client describes ITS OWN identity, not the first one s',
	repulledProvider && repulledProvider.describe().model === repulledProvider.model && repulledProvider.describe().model !== (ollamaProvider && ollamaProvider.model),
);

// =====================================================================
harness.section('G-F1-a HERMETIC TWIN — THE BARE MODEL NAME AS IDENTITY IS REFUSED');
// =====================================================================

harness.match(
	'TWIN: model set to the BARE wire name is refused (the cache collision that must be unconstructible)',
	judgeProviderViolation(
		Object.assign({}, ollamaProvider, {
			model: 'qwen2.5:32b',
			describe: () => ({ provider: 'ollama', model: 'qwen2.5:32b', version: 'v' }),
		}),
		{ providerLabel: 'twin' },
	),
	/is not namespaced by its provider name — it must begin 'ollama:'/,
);
// The namespace rule is a PREFIX test, and this provider is the reason it has to be: 'qwen2.5:32b' contains
// the separator ':' inside the wire name itself, so any rule that counted or split on separators would
// mis-read this provider. Asserted here because this is the provider that would break it.
harness.ok(
	'the wire name itself CONTAINS the namespace separator — which is why the rule is a prefix test',
	ollamaProvider && ollamaProvider.wireModel.indexOf(JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR) !== -1,
	ollamaProvider && ollamaProvider.wireModel,
);
harness.match(
	'TWIN: a NAMESPACED value in the ini wireModel slot is refused AT CONSTRUCTION',
	thrownMessage(() =>
		ollamaJudgeClientLib(
			{
				configFilePath: iniFilePathWith(Object.assign({}, OLLAMA_INI_ROW_BY_KEY, { wireModel: 'ollama:qwen2.5:32b' })),
				componentOverrides: hermeticOverrides(),
			},
			() => {},
		),
	),
	/namespace prefix 'ollama:'/,
);

// =====================================================================
harness.section('G3-d — ABSENT OR INVALID CONFIG THROWS AT CONSTRUCTION, NAMING THE KEY');
// =====================================================================
// Every key, enumerated from the ini fixture itself so a key added later is covered without editing the
// gate. A THROW rather than a callback refusal on purpose: a configuration fault needs no I/O to detect, so
// it is caught before a socket can exist, exactly as llmClient's no-key throw is.

Object.keys(OLLAMA_INI_ROW_BY_KEY).forEach((oneKeyName) => {
	harness.match(
		`an ABSENT [ollamaJudge].${oneKeyName} THROWS at construction, naming the key`,
		thrownMessage(() =>
			ollamaJudgeClientLib({ configFilePath: iniFilePathWithout(oneKeyName), componentOverrides: hermeticOverrides() }, () => {}),
		),
		new RegExp(oneKeyName),
	);
});

// A PRESENT BUT INVALID value is the worse case, not the milder one (polyArch2 §6): it must never be
// silently corrected to something workable.
[
	{ keyName: 'endpointPortNumber', badValue: 'eleven-thousand' },
	{ keyName: 'maxConcurrency', badValue: 'four' },
	{ keyName: 'requestTimeoutMs', badValue: 'soon' },
	{ keyName: 'numPredict', badValue: 'plenty' },
].forEach(({ keyName, badValue }) => {
	const refusalText = thrownMessage(() =>
		ollamaJudgeClientLib(
			{
				configFilePath: iniFilePathWith(Object.assign({}, OLLAMA_INI_ROW_BY_KEY, { [keyName]: badValue })),
				componentOverrides: hermeticOverrides(),
			},
			() => {},
		),
	);
	harness.match(`an UNPARSEABLE [ollamaJudge].${keyName} throws, naming the key`, refusalText, new RegExp(keyName));
	harness.match(`…and SHOWS what was actually written, rather than replacing it`, refusalText, new RegExp(badValue));
});

// zero and negative are refused for the same reason a word is: they are not what the key means.
[{ keyName: 'maxConcurrency', badValue: '0' }, { keyName: 'numPredict', badValue: '-1' }].forEach(({ keyName, badValue }) => {
	harness.match(
		`[ollamaJudge].${keyName} = ${badValue} is refused (positive integer, not merely a number)`,
		thrownMessage(() =>
			ollamaJudgeClientLib(
				{
					configFilePath: iniFilePathWith(Object.assign({}, OLLAMA_INI_ROW_BY_KEY, { [keyName]: badValue })),
					componentOverrides: hermeticOverrides(),
				},
				() => {},
			),
		),
		new RegExp(keyName),
	);
});

// an ABSENT FILE, and an absent SECTION in a present file, are both named faults rather than empty configs.
harness.match(
	'an absent config FILE throws, naming the path',
	thrownMessage(() =>
		ollamaJudgeClientLib({ configFilePath: '/nonexistent/ollamaJudge.ini', componentOverrides: hermeticOverrides() }, () => {}),
	),
	/nonexistent/,
);
const wrongSectionIniFilePath = () => {
	const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ollamaJudgeWrongSection-'));
	const filePath = path.join(dirPath, 'ollamaJudge.ini');
	fs.writeFileSync(filePath, '[somethingElse]\nendpointHostName=127.0.0.1\n');
	return filePath;
};
harness.match(
	'a file with no [ollamaJudge] SECTION throws, naming the section',
	thrownMessage(() => ollamaJudgeClientLib({ configFilePath: wrongSectionIniFilePath(), componentOverrides: hermeticOverrides() }, () => {})),
	/ollamaJudge/,
);
// NON-VACUITY: the complete ini must NOT throw. Without this, every assertion above would pass against a
// module that threw unconditionally.
harness.equal(
	'…and the COMPLETE ini throws nothing (the refusals above discriminate)',
	thrownMessage(() => ollamaJudgeClientLib({ configFilePath: completeIniFilePath(), componentOverrides: hermeticOverrides() }, () => {})),
	'',
);

// ⟪THE SPLIT, OBSERVED — DAWN_TOWER's ruling of 2026-09-07⟫ A configuration fault throws SYNCHRONOUSLY and
// the construction callback is NEVER INVOKED. That is the half of the split that preserves llmClient's
// symmetry: a fault needing no I/O is caught before a socket can exist. Asserting the throw alone would not
// prove it — a module could throw AND call back, which would hand a caller two contradictory reports of one
// construction.
let configFaultCallbackWasInvoked = false;
const configFaultThrow = thrownMessage(() =>
	ollamaJudgeClientLib({ configFilePath: iniFilePathWithout('wireModel'), componentOverrides: hermeticOverrides() }, () => {
		configFaultCallbackWasInvoked = true;
	}),
);
harness.match('a config fault THROWS, synchronously', configFaultThrow, /wireModel/);
harness.ok(
	'…and the construction callback is NEVER invoked (one construction reports one way, never two)',
	!configFaultCallbackWasInvoked,
);
// NON-VACUITY: the callback IS invoked on a good construction, so the assertion above is about the fault
// path and not about a callback that never fires at all.
let goodConstructionCallbackWasInvoked = false;
ollamaJudgeClientLib({ configFilePath: completeIniFilePath(), componentOverrides: hermeticOverrides() }, () => {
	goodConstructionCallbackWasInvoked = true;
});
harness.ok('…and a GOOD construction DOES invoke it (the check above discriminates)', goodConstructionCallbackWasInvoked);

// =====================================================================
harness.section('G1-d — THE OBSOLETE requireJudgment IS REFUSED IN WORDING IDENTICAL TO THE OTHER TWO');
// =====================================================================

const anthropicDummyIniFilePath = () => {
	const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ollamaSuiteAnthropic-'));
	const filePath = path.join(dirPath, 'anthropicAi.ini');
	fs.writeFileSync(filePath, '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-opus-4-8\n');
	return filePath;
};

const refusalBodyByLabel = {
	'llmClient (anthropic)': withoutModulePrefix(
		rerankRefusal(llmClientLib({ configFilePath: anthropicDummyIniFilePath() }), {
			systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true,
		}),
	),
	debugJudge: withoutModulePrefix(
		rerankRefusal(debugJudgeLib({ ruleName: 'first' }), {
			systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true,
		}),
	),
	ollamaJudgeClient: withoutModulePrefix(
		rerankRefusal(ollamaProvider, { systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true }),
	),
};
const refusalBodyList = Object.keys(refusalBodyByLabel).map((oneLabel) => refusalBodyByLabel[oneLabel]);
const wordingIsIdentical = (bodyList) => bodyList.every((oneBody) => sha256(oneBody) === sha256(bodyList[0]));

harness.match(
	'the ollama provider refuses requireJudgment BY NAME',
	rerankRefusal(ollamaProvider, { systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true }),
	/requireJudgment is OBSOLETE and was removed/,
);
harness.match(
	'…and stamps its own module name on it',
	rerankRefusal(ollamaProvider, { systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true }),
	/^[A-Za-z0-9_]+\.rerank: /,
);
harness.match(
	'…and refuses requireJudgment: false identically (the fault is MENTIONING the retired option)',
	rerankRefusal(ollamaProvider, { systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: false }),
	/requireJudgment is OBSOLETE and was removed/,
);
harness.ok(
	'THE WORDING IS CHARACTER-IDENTICAL ACROSS ALL THREE PROVIDERS (moduleName prefix stripped)',
	wordingIsIdentical(refusalBodyList),
	`sha256 per provider:\n${Object.keys(refusalBodyByLabel).map((oneLabel) => `  ${oneLabel}: ${sha256(refusalBodyByLabel[oneLabel])}`).join('\n')}`,
);
harness.ok(
	'…and there are genuinely THREE providers compared, not one compared with itself',
	refusalBodyList.length === 3,
	`compared ${refusalBodyList.length} provider(s)`,
);
harness.ok(
	'TWIN: altering ONE character of one provider s wording is CAUGHT',
	!wordingIsIdentical([refusalBodyList[0], `${refusalBodyList[0].slice(0, -1)}X`]),
);
harness.note(`shared refusal-body sha256 across three providers: ${sha256(refusalBodyList[0])}`);

// =====================================================================
harness.section('THE EXTRACTOR SATISFIES JUDGMENT_EXTRACTOR_SHAPE');
// =====================================================================

const extractJudgment = ollamaJudgeClientLib.makeJudgmentExtractor(CHOICE_ENUM_FIXTURE);

// rerankThroughLater — drives the REAL rerank against a canned envelope. Declared here because the
// extractor section needs it; the G3-c section below uses the identical shape for its own subjects.
const rerankThroughLater = (chatResponse) => {
	const { provider } = okConstruction({ postOnce: ({ payload }, postCallback) => postCallback('', chatResponse, 200) });
	let captured = { rerankError: 'THE RERANK CALLBACK WAS NEVER CALLED', clientReturn: null };
	provider.rerank(
		{ systemPrompt: 's', userPrompt: 'u', choiceEnum: CHOICE_ENUM_FIXTURE, maxRetries: 1 },
		(rerankError, clientReturn) => {
			captured = { rerankError, clientReturn };
		},
	);
	return captured;
};

harness.equal(
	'the extractor has the arity JUDGMENT_EXTRACTOR_SHAPE declares',
	extractJudgment.length,
	JUDGMENT_EXTRACTOR_SHAPE.arity,
);
const goodExtraction = extractJudgment(cannedChatResponse(LIVE_SHAPED_CONTENT));
harness.equal(
	'…and returns exactly the three keys the shape declares, in that order',
	Object.keys(goodExtraction).join(','),
	JUDGMENT_EXTRACTOR_SHAPE.resultKeys.join(','),
);
harness.equal('it reads choice out of the JSON STRING in message.content', goodExtraction.choice, '2');
harness.equal('…and category', goodExtraction.category, 'moderate');
harness.match('…and rationale', goodExtraction.rationale, /Person Birth Date/);
harness.ok(
	'it reads a body with RAGGED interior whitespace — the shape the live model actually emitted',
	LIVE_SHAPED_CONTENT.indexOf('\n \t\t,') !== -1,
	'the fixture no longer carries the real whitespace, so it no longer proves the parse handles it',
);
harness.ok(
	'there is NO tool_use block anywhere in the Ollama envelope (the dialect difference JOB 2 declared)',
	JSON.stringify(cannedChatResponse(LIVE_SHAPED_CONTENT)).indexOf('tool_use') === -1,
);

// =====================================================================
harness.section('G-F12-a — THREE REDS: MISSING RATIONALE, OUT-OF-ENUM CHOICE, NON-JSON BODY');
// =====================================================================

// RED 1 — a body missing `rationale`. The field comes back undefined, never fabricated and never
// reconstructed from whatever prose sits nearby. JUDGMENT_EXTRACTOR_SHAPE.freeTextFallbackPermitted is false
// precisely because a rationale nobody asserted would travel onward as though a judge had written it.
const missingRationale = extractJudgment(cannedChatResponse('{"choice":"1","category":"strong"}'));
harness.equal('RED 1: a body missing rationale yields rationale undefined', missingRationale.rationale, undefined);
harness.equal('…and does NOT discard the fields that WERE validly supplied', missingRationale.choice, '1');
harness.equal('…category too', missingRationale.category, 'strong');
harness.equal(
	'…and a BLANK rationale is treated as missing, not as a rationale',
	extractJudgment(cannedChatResponse('{"choice":"1","category":"strong","rationale":"   "}')).rationale,
	undefined,
);

// ⟪A HOLE THE THREE-STATE SWEEP FOUND IN THIS SUITE, AND IT WAS IN THE CENTRAL PROPERTY⟫ Inversion M3 gave
// the extractor a free-text fallback for an ABSENT choice — it substituted the first enum member when the
// model supplied none — and the suite stayed GREEN at 132/132. Every choice assertion above feeds a choice
// that is PRESENT and wrong (out of enum) or a body that is unreadable; NONE fed a perfectly readable body
// with the choice simply MISSING, which is the exact shape a fabricating extractor would exploit. The gate
// that was missing is the gate for the fault most worth having: freeTextFallbackPermitted is false, and an
// invented choice is a verdict nobody asserted travelling onward as though a judge had made it.
const absentChoice = extractJudgment(cannedChatResponse('{"category":"strong","rationale":"a reason"}'));
harness.equal('a readable body with NO choice at all yields choice undefined, never an invented one', absentChoice.choice, undefined);
harness.equal('…and does not disturb the fields that WERE supplied', absentChoice.category, 'strong');
harness.match('…nor the rationale', absentChoice.rationale, /a reason/);
// the same for each of the other two, so no field can be quietly manufactured from its neighbours.
harness.equal(
	'a readable body with NO category yields category undefined',
	extractJudgment(cannedChatResponse('{"choice":"1","rationale":"a reason"}')).category,
	undefined,
);
harness.equal(
	'a readable body with NO rationale yields rationale undefined',
	extractJudgment(cannedChatResponse('{"choice":"1","category":"strong"}')).rationale,
	undefined,
);
harness.equal(
	'an EMPTY judgment object yields all three undefined and invents nothing',
	JSON.stringify(extractJudgment(cannedChatResponse('{}'))),
	JSON.stringify({}),
);
// …and the same fault refused on the REAL rerank path, not merely in the pure function.
const absentChoiceRerank = rerankThroughLater(cannedChatResponse('{"category":"strong","rationale":"a reason"}'));
harness.ok(
	'…and rerank REFUSES a response carrying no choice, rather than manufacturing one',
	!!absentChoiceRerank.rerankError,
	String(absentChoiceRerank.rerankError),
);
harness.match('…naming the enum the model was offered', absentChoiceRerank.rerankError, /NONE/);
harness.ok('…and returning no judgment alongside the refusal', !absentChoiceRerank.clientReturn);

// RED 2 — a choice outside the per-call enum. It is refused (undefined), never coerced to a neighbour and
// never repaired.
const outOfEnumChoice = extractJudgment(cannedChatResponse('{"choice":"9","category":"strong","rationale":"a reason"}'));
harness.equal('RED 2: a choice OUTSIDE the per-call enum yields choice undefined', outOfEnumChoice.choice, undefined);
harness.equal('…and the other fields are still read (the refusal is per-field, not wholesale)', outOfEnumChoice.category, 'strong');
harness.equal(
	'…and NONE is accepted when it IS in the enum (the check is membership, not a rule about digits)',
	extractJudgment(cannedChatResponse('{"choice":"NONE","category":"strong","rationale":"nothing fits"}')).choice,
	'NONE',
);
// the same discipline on category: a value outside PICK_CATEGORY_ENUM is not a category.
harness.equal(
	'…a category outside the pick-only enum yields category undefined',
	extractJudgment(cannedChatResponse('{"choice":"1","category":"certain","rationale":"a reason"}')).category,
	undefined,
);
harness.equal(
	"…and 'none' is NOT accepted as a category (abstain travels as choice='NONE', never as a category)",
	extractJudgment(cannedChatResponse('{"choice":"1","category":"none","rationale":"a reason"}')).category,
	undefined,
);

// RED 3 — a body that is not JSON at all. This is the one fault the shape says is REFUSED BY NAME rather
// than reported as undefined fields: the extractor could not read the body AS ITS OWN DIALECT, which is a
// different fault from a readable body that is incomplete, and it has a different operator response.
const nonJsonRefusal = ollamaJudgeClientLib.judgmentBodyRefusal(cannedChatResponse('I think candidate 1 is the best match.'));
harness.ok('RED 3: a NON-JSON body is refused by name', !!nonJsonRefusal, JSON.stringify(nonJsonRefusal));
harness.match('…and the refusal names the provider', nonJsonRefusal, /ollama/i);
harness.match('…and says what was wrong with the body, not merely that something was', nonJsonRefusal, /JSON/);
harness.ok(
	'…and it QUOTES what actually came back, so the operator can see it',
	String(nonJsonRefusal).indexOf('I think candidate 1') !== -1,
	String(nonJsonRefusal),
);
harness.equal(
	'…and a WELL-FORMED body is NOT refused (the refusal discriminates)',
	ollamaJudgeClientLib.judgmentBodyRefusal(cannedChatResponse(LIVE_SHAPED_CONTENT)),
	'',
);
harness.ok(
	'…an envelope with NO message.content at all is refused too, not read as an empty judgment',
	!!ollamaJudgeClientLib.judgmentBodyRefusal({ model: 'qwen2.5:32b', done: true }),
);
// NO FREE-TEXT FALLBACK, asserted as behaviour rather than as a flag: prose that CONTAINS a valid-looking
// answer must still yield nothing. This is the assertion that would catch somebody adding llmClient's
// extractChoice-style (b)/(c)/(d) alternative paths to this extractor, which would be correct there and
// wrong here.
const proseWithAnAnswerInIt = extractJudgment(
	cannedChatResponse('After careful thought the "choice": "1" is right, category strong, because the definitions align.'),
);
harness.equal('NO FREE-TEXT FALLBACK: a choice embedded in PROSE is not extracted', proseWithAnAnswerInIt.choice, undefined);
harness.equal('…nor a category', proseWithAnAnswerInIt.category, undefined);
harness.equal('…nor a rationale', proseWithAnAnswerInIt.rationale, undefined);

// =====================================================================
harness.section('G3-c (twin) — A NON-CONFORMING RESPONSE IS REFUSED, NEVER REPAIRED');
// =====================================================================

// Driven through the REAL rerank, via the postOnce double, so this proves the WIRING and not merely the
// pure function. JOB 1's lesson: a rerank callback that lost `choice` stayed invisible for forty minutes
// because every gate tested the extractor rather than the path.
const rerankThrough = (chatResponse, rerankOptions = {}) => {
	const { provider } = okConstruction({
		postOnce: ({ payload }, postCallback) => postCallback('', chatResponse, 200),
	});
	let captured = { rerankError: 'THE RERANK CALLBACK WAS NEVER CALLED', clientReturn: null };
	provider.rerank(
		Object.assign({ systemPrompt: 's', userPrompt: 'u', choiceEnum: CHOICE_ENUM_FIXTURE, maxRetries: 1 }, rerankOptions),
		(rerankError, clientReturn) => {
			captured = { rerankError, clientReturn };
		},
	);
	return captured;
};

const goodRerank = rerankThrough(cannedChatResponse(LIVE_SHAPED_CONTENT));
harness.equal('a conforming response reranks successfully', goodRerank.rerankError, '');
harness.equal('…returning the choice', goodRerank.clientReturn && goodRerank.clientReturn.choice, '2');
harness.equal('…the category', goodRerank.clientReturn && goodRerank.clientReturn.category, 'moderate');
harness.match('…and the rationale', goodRerank.clientReturn && goodRerank.clientReturn.rationale, /Person Birth Date/);
JUDGE_PROVIDER_SHAPE.rerank.resultKeys.forEach((oneKeyName) => {
	harness.ok(
		`rerank's result carries the contract member '${oneKeyName}'`,
		goodRerank.clientReturn && goodRerank.clientReturn[oneKeyName] !== undefined,
		JSON.stringify(goodRerank.clientReturn && Object.keys(goodRerank.clientReturn)),
	);
});
harness.equal(
	"THE RESULT carries the NAMESPACED identity — rerank's model must agree with client.model",
	goodRerank.clientReturn && goodRerank.clientReturn.model,
	`ollama:qwen2.5:32b@${DIGEST_PREFIX_FIXTURE}`,
);

const nonJsonRerank = rerankThrough(cannedChatResponse('I think candidate 1 is the best match.'));
harness.match('a NON-JSON response body is REFUSED by rerank, by name', nonJsonRerank.rerankError, /ollama/i);
harness.ok('…and no judgment is returned alongside the refusal', !nonJsonRerank.clientReturn);

const outOfEnumRerank = rerankThrough(cannedChatResponse('{"choice":"9","category":"strong","rationale":"a reason"}'));
harness.ok('a response whose choice is OUT OF ENUM is refused, never repaired', !!outOfEnumRerank.rerankError, String(outOfEnumRerank.rerankError));
harness.ok('…and no judgment is returned', !outOfEnumRerank.clientReturn);

const nonOkStatusRerank = (() => {
	const { provider } = okConstruction({ postOnce: ({ payload }, postCallback) => postCallback('', { error: 'model not found' }, 404) });
	let captured = { rerankError: '', clientReturn: null };
	provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: CHOICE_ENUM_FIXTURE, maxRetries: 1 }, (rerankError, clientReturn) => {
		captured = { rerankError, clientReturn };
	});
	return captured;
})();
harness.match('a non-200 status is refused, quoting the status', nonOkStatusRerank.rerankError, /404/);

// =====================================================================
harness.section('THE REQUEST — THE JOB 2 RENDERING GOES ON THE WIRE, NOT A SCHEMA OF THIS MODULE S');
// =====================================================================

let capturedPayload = null;
(() => {
	const { provider } = okConstruction({
		postOnce: ({ payload }, postCallback) => {
			capturedPayload = payload;
			postCallback('', cannedChatResponse(LIVE_SHAPED_CONTENT), 200);
		},
	});
	provider.rerank({ systemPrompt: 'SYS', userPrompt: 'USR', choiceEnum: CHOICE_ENUM_FIXTURE }, () => {});
})();

harness.equal('the wire carries the BARE Ollama model name', capturedPayload && capturedPayload.model, 'qwen2.5:32b');
harness.ok(
	'…and the identity NEVER reaches the wire (the digest and namespace are ours, not the server s)',
	capturedPayload && capturedPayload.model.indexOf('@') === -1 && capturedPayload.model.indexOf('ollama:') === -1,
	capturedPayload && capturedPayload.model,
);
harness.equal('stream is false — one response, not a token stream', capturedPayload && capturedPayload.stream, false);
harness.equal('temperature 0', capturedPayload && capturedPayload.options && capturedPayload.options.temperature, 0);
harness.equal(
	'num_predict comes from CONFIG, not from a shared constant',
	capturedPayload && capturedPayload.options && capturedPayload.options.num_predict,
	400,
);
// THE CENTRAL ASSERTION OF JOB 2, PROVEN ON JOB 3'S WIRE: `format` is byte-identical to the canonical
// module's ollama rendering. A provider that built its own schema would be the drift JOB 2 exists to prevent.
harness.equal(
	'`format` is BYTE-IDENTICAL to renderSelectCandidateSchema("ollama"), never a schema this module wrote',
	JSON.stringify(capturedPayload && capturedPayload.format),
	JSON.stringify(selectCandidateSchemaLib.renderSelectCandidateSchema('ollama', { choiceEnum: CHOICE_ENUM_FIXTURE })),
);
harness.equal(
	'…and the category enum on the wire equals the pick-only categories, DERIVED in this assertion',
	capturedPayload && capturedPayload.format.properties.category.enum.join(','),
	EXPECTED_PICK_CATEGORY_LIST.join(','),
);
harness.ok(
	'…and there is no tool wrapper: the ollama dialect has no tool call to name',
	capturedPayload && capturedPayload.format.input_schema === undefined && capturedPayload.format.name === undefined,
);
harness.equal('the system prompt travels as a system message', capturedPayload && capturedPayload.messages[0].role, 'system');
harness.equal('…carrying what the caller passed', capturedPayload && capturedPayload.messages[0].content, 'SYS');
harness.equal('the user prompt travels as a user message', capturedPayload && capturedPayload.messages[1].role, 'user');
harness.equal('…carrying what the caller passed', capturedPayload && capturedPayload.messages[1].content, 'USR');

// G2-c, applied to THIS provider file: no hard-coded category string anywhere in it.
const ollamaSourceText = fs.readFileSync(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'ollamaJudgeClient.js'), 'utf8');
const commentStripped = ollamaSourceText
	.split('\n')
	.filter((oneLine) => oneLine.trim().indexOf('//') !== 0)
	.join('\n')
	.replace(/\/\*[\s\S]*?\*\//g, '');
EXPECTED_PICK_CATEGORY_LIST.forEach((oneCategoryName) => {
	harness.ok(
		`G2-c: the provider file contains NO hard-coded category string '${oneCategoryName}'`,
		commentStripped.indexOf(oneCategoryName) === -1,
		`'${oneCategoryName}' appears in comment-stripped source`,
	);
});
// BG-DET (a), applied to this file before the seam gate has to catch it: no clock, no randomness, because
// bridge-maker/lib feeds a CONTENT-ADDRESSED decision block.
['Date.now', 'new Date', 'Math.random', 'process.hrtime', 'crypto.randomBytes'].forEach((oneToken) => {
	harness.ok(
		`BG-DET: the provider file contains no '${oneToken}' (this directory feeds a content-addressed block)`,
		commentStripped.indexOf(oneToken) === -1,
		`'${oneToken}' appears in comment-stripped source`,
	);
});
// and no async/await or try/catch beyond the ONE sanctioned JSON.parse guard.
harness.ok('the provider file uses no async/await', !/\basync\b|\bawait\b/.test(commentStripped));

// ⟪THIS ASSERTION WAS WRONG WHEN IT WAS FIRST WRITTEN, AND ITS OWN RED IS WHY IT IS NOW STRUCTURAL⟫
// Written before the module existed, it demanded EXACTLY ONE try/catch — a number typed from memory of
// llmClient, which parses one body. This module parses THREE: the tag list at construction, the /api/chat
// envelope, and message.content inside it. The count was the mistake; the module was right, and saying so
// is only honest because each of the three was then checked to be the sanctioned idiom rather than assumed.
// So the gate no longer counts. It requires EVERY `try` in the file to BE the sanctioned parse guard —
// try { attemptParse(); } catch (thrown) { <fault> = thrown; } — which is a strictly stronger property than
// any number: a fourth guard around a legitimate parse passes without the gate being edited, while ONE try
// used as control flow reddens it however few there are. That is the difference between a gate that
// counts and a gate that checks.
const tryCount = (commentStripped.match(/\btry\s*\{/g) || []).length;
const sanctionedParseGuardCount = (
	commentStripped.match(/try\s*\{\s*attemptParse\(\);\s*\}\s*catch\s*\(thrown\)\s*\{\s*\w*[Ff]ault = thrown;\s*\}/g) || []
).length;
harness.equal(
	'EVERY try/catch in the provider file is the sanctioned JSON.parse guard, and none is control flow',
	sanctionedParseGuardCount,
	tryCount,
);
harness.equal(
	'…and there is exactly one guard per JSON.parse — no parse is left unguarded and no guard is spare',
	tryCount,
	(commentStripped.match(/JSON\.parse\(/g) || []).length,
);
harness.ok(
	'…and the file genuinely HAS try/catch guards (the equality above is not two zeros)',
	tryCount > 0,
	`${tryCount} guard(s)`,
);

// =====================================================================
harness.section('G-F10-b — A TIMEOUT REFUSAL SAYS QUEUED OR IN FLIGHT, AND CARRIES NO CLOCK READING');
// =====================================================================

const inFlightRefusal = ollamaJudgeClientLib.requestTimeoutRefusalText({ timeoutMs: 180000, socketAssigned: true });
const queuedRefusal = ollamaJudgeClientLib.requestTimeoutRefusalText({ timeoutMs: 180000, socketAssigned: false });
harness.match('a socket-assigned timeout says IN FLIGHT', inFlightRefusal, /IN FLIGHT/);
harness.match('a socket-less timeout says QUEUED', queuedRefusal, /QUEUED/);
harness.match('…and says NOTHING WAS SENT, which is the operator-relevant half', queuedRefusal, /NOTHING WAS SENT/);
harness.ok('the two arms genuinely differ', inFlightRefusal !== queuedRefusal);
harness.match('…and the queued arm points at maxConcurrency, not at the timeout', queuedRefusal, /maxConcurrency/);
harness.match('…while the in-flight arm points at requestTimeoutMs', inFlightRefusal, /requestTimeoutMs/);
// ⟪BG-DET⟫ MARBLE_ANCHOR's first cut of the equivalent refusal in llmClient carried millisecond durations
// from Date.now() and the seam gate refused it. The DISTINCTION is what the operator needs; the durations
// were decoration. The configured timeout is a config value, not a clock reading, and may appear.
harness.ok(
	'neither arm reads a clock (BG-DET refuses Date.now in this directory)',
	commentStripped.indexOf('Date.now') === -1,
);

// =====================================================================
harness.section('G3-b (twin) — A DEAD SERVER IS REFUSED BY NAME AT CONSTRUCTION, IN UNDER TWO SECONDS');
// =====================================================================
// The ONE gate that uses the real transport, deliberately: it points at a CLOSED local port, so no server is
// contacted and ECONNREFUSED is the observation. Everything else in this suite is doubled.

const CLOSED_PORT_NUMBER = 11533; // nothing listens here; the real ollama is on 11434 and is not touched
const deadServerStartedAtMs = Date.now();
ollamaJudgeClientLib(
	{ configFilePath: iniFilePathWith(Object.assign({}, OLLAMA_INI_ROW_BY_KEY, { endpointPortNumber: String(CLOSED_PORT_NUMBER) })) },
	(deadServerError, deadServerProvider) => {
		const elapsedMs = Date.now() - deadServerStartedAtMs;
		harness.ok('a DEAD server is refused at construction', !!deadServerError, String(deadServerError));
		harness.ok('…and NO provider object is produced (an incomplete identity must never escape)', !deadServerProvider);
		harness.match('…the refusal names the endpoint', deadServerError, new RegExp(String(CLOSED_PORT_NUMBER)));
		harness.match('…and the host', deadServerError, /127\.0\.0\.1/);
		harness.match('…and tells the operator how to fix it', deadServerError, /brew services start ollama/);
		harness.ok(`…in under two seconds (took ${elapsedMs} ms)`, elapsedMs < 2000, `${elapsedMs} ms`);
		harness.ok(
			'…and it did NOT reach the real Ollama port (the gate proves a refusal, not a live call)',
			String(deadServerError).indexOf('11434') === -1,
			String(deadServerError),
		);

		harness.report();
	},
);
