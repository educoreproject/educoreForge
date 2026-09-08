'use strict';

// judgeProviderRegistry.js — WHICH JUDGE, DECIDED BY DATA.
// judgeProviderRegistry JOB 4, 2026-09-07. Supervisor: DAWN_TOWER.
//
// ⟪WHAT THIS IS FOR⟫ The judge stopped being one thing. A local Ollama model does development judging;
// Anthropic is retained as the measurement instrument; further providers may be added. Before this file,
// build.js `require`d two judge factories directly and chose between them with a flag — so adding a third
// provider meant editing the orchestrator, and the orchestrator knew the name of every judge that existed.
// Here, ONE CONFIG KEY selects a provider, adding a provider is A NEW FILE PLUS ONE DATA ROW, and the code
// that walks the rows does not change. There is no switch in this file and there must never be one.
//
// ⟪THE RULE A FIFTH PROVIDER'S AUTHOR NEEDS⟫ THE ROW NAME **IS** THE PROVIDER'S OWN `name`, ALWAYS. The
// registry must never hold a name that disagrees with the provider's, and it refuses at construction if one
// does. This is not tidiness: JUDGE_PROVIDER_SHAPE requires `model` to begin `${name}:`, so if the row name
// and the provider name are the same string, TWO ROWS CAN NEVER MINT ONE IDENTITY. That is what makes the
// cache collision G-F1-b names IMPOSSIBLE TO CONSTRUCT rather than merely unlikely to occur — the judgment
// cache distinguishes two providers handed identical prompts through the same renderer by `model` ALONE.
//
// ⟪ONE CONSTRUCTION PROTOCOL — docket (vi)⟫ Every row constructs through an ERROR-FIRST CALLBACK, so the
// caller writes one code path. The providers themselves are not uniform and are NOT edited to make them so:
// llmClient and debugJudge construct SYNCHRONOUSLY; ollamaJudgeClient is callback-shaped because its
// identity carries a model digest and a digest can only be read over HTTP (DAWN_TOWER's JOB 3 ruling; the
// blocking-probe alternative was proposed and REFUSED). The two synchronous ones are WRAPPED here to call
// back on the next tick — always asynchronously, so a caller can never accidentally depend on one provider
// answering sooner than another.
//
// ⟪ONLY THE SELECTED ROW IS CONSTRUCTED⟫ Load-bearing, not an optimisation. A dead Ollama server must never
// break an Anthropic run, and a missing Anthropic key must never break a debug run. The walk finds the row
// first and constructs exactly it.
//
// ⟪describe() MUST NOT THROW⟫ judgeProviderViolation CALLS describe() — a judge that cannot say what it is
// must never run, and agreement between describe() and the provider's own members is how that is checked
// mechanically. This registry PRE-CHECKS that describe is a function (JUDGE_PROVIDER_SHAPE's member-kind
// check does it before any call is made) but it CANNOT pre-check that calling it is safe. So the contract
// is stated here and is part of the shape a provider satisfies: **describe() must not throw.** A provider
// whose describe() throws is a defective provider; the failure surfaces as the boundary translation below
// naming the provider, which is the most a registry can honestly promise without turning exception handling
// into control flow.
//
// ⟪BOUNDARY TRANSLATION, AND WHY THE catch BELOW IS NOT CONTROL FLOW⟫ JOB 3 ruled the two construction
// fault classes apart: CONFIGURATION faults THROW synchronously, naming the key, before any socket can
// exist; a SERVER PROBE refuses through the callback with no provider object. This registry's protocol is
// the callback, so a synchronous throw has to cross into it somewhere. THIS CODEBASE ALREADY NAMED AND
// RULED ON THAT IDIOM, in build.js's own words, where the same crossing used to happen: "boundary
// translation of a CONSTRUCTION (configuration) fault into the orchestrator's callback channel... Not
// control flow: the throw IS the §6 refusal, caught only to name it through build()'s callback."
// ⟪No line is cited for that sentence ON PURPOSE: JOB 4 MOVED THE CATCH OUT OF build.js AND INTO THIS FILE,
// so the sentence went with the code it described and a citation would have pointed at nothing. It is
// recorded here, at its new home, rather than left as a reference to a place it no longer is.⟫
// Each catch here is that and nothing else: it names the fault through the callback and makes no decision.
// There is no `if` inside one, and the suite asserts that structurally rather than counting them.

const path = require('path');

const moduleName = 'judgeProviderRegistry';

const { judgeProviderViolation } = require(path.join(__dirname, '..', '..', '..', 'interfaces'));

const llmClientLib = require(path.join(__dirname, 'llmClient'));
const debugJudgeLib = require(path.join(__dirname, 'debugJudge'));
const ollamaJudgeClientLib = require(path.join(__dirname, 'ollamaJudgeClient'));

// THE CONFIG KEY. Named here so every refusal can quote the thing an operator would actually have to set,
// and so the name has ONE home. [judgeProvider] judgeProviderName in graphBuilder.ini — the file
// startup.js already discovers and already refuses by name when it is absent or ambiguous.
const SELECTION_CONFIG_SECTION_NAME = 'judgeProvider';
const SELECTION_CONFIG_KEY_NAME = 'judgeProviderName';

// constructOnNextTick — the wrapper that makes a SYNCHRONOUS factory speak the one protocol. setImmediate
// rather than an immediate call so that EVERY row is asynchronous: a caller that happened to work because
// the anthropic row answered synchronously would break the day it selected ollama, and that is exactly the
// class of bug one protocol exists to prevent. (setImmediate is not a clock reading; BG-DET (a) refuses
// Date.now, new Date, Math.random, process.hrtime and crypto.randomBytes in this directory, and this file
// contains none of them.)
const constructOnNextTick = (buildProviderSynchronously) => (rowConstructionOptions, rowCallback) => {
	setImmediate(() => {
		let constructedProvider = null;
		try {
			constructedProvider = buildProviderSynchronously(rowConstructionOptions);
		} catch (constructionFault) {
			rowCallback(`${moduleName}: ${constructionFault.message}`);
			return;
		}
		rowCallback('', constructedProvider);
	});
};

// ⟪G4-a ROW LIST — ADD A PROVIDER HERE AND NOWHERE ELSE⟫
// Ordered data. A row is {name, enabled, construct}. `name` MUST equal the provider's own `name` (see the
// header). `construct` is error-first and is handed the row construction options; it is the ONLY place a
// provider's own factory signature is known, which is why the walk below never needs to.
const JUDGE_PROVIDER_ROW_LIST = Object.freeze([
	Object.freeze({
		name: 'anthropic',
		enabled: true,
		construct: constructOnNextTick(({ configFilePath, componentOverrides }) =>
			llmClientLib(Object.assign({}, configFilePath ? { configFilePath } : {}, componentOverrides ? { componentOverrides } : {})),
		),
	}),
	Object.freeze({
		name: 'ollama',
		enabled: true,
		// ALREADY callback-shaped — its identity carries a digest read from /api/tags at construction, so it
		// is the row that decided the protocol for all of them. Passed straight through, unwrapped.
		construct: ({ configFilePath, componentOverrides }, rowCallback) =>
			ollamaJudgeClientLib(
				Object.assign({}, configFilePath ? { configFilePath } : {}, componentOverrides ? { componentOverrides } : {}),
				rowCallback,
			),
	}),
	Object.freeze({
		name: 'debug',
		enabled: true,
		// The debug judge is A ROW, not a second path — that is the whole point of this job. Its RULE is not
		// a second config key: it arrives on the construction options from the --useDebugJudge override, or
		// is the register's own DEFAULT_RULE when none was named. An unregistered rule is refused BY NAME by
		// debugJudge itself, listing the registered rules, and that throw becomes this row's callback error.
		construct: constructOnNextTick(({ debugJudgeRuleName }) =>
			debugJudgeLib(debugJudgeRuleName ? { ruleName: debugJudgeRuleName } : {}),
		),
	}),
]);

// KNOWN_PROVIDER_NAME_LIST — DERIVED, never restated. Every refusal that lists the known providers reads
// this, so adding a row corrects the refusal text without anyone editing a refusal.
const KNOWN_PROVIDER_NAME_LIST = Object.freeze(JUDGE_PROVIDER_ROW_LIST.filter((oneRow) => oneRow.enabled).map((oneRow) => oneRow.name));

// ⟪G4-a FACTORY REGION START⟫
// Everything below this marker is the WALK — the code that selects, constructs and validates. G4-a asserts
// that adding a provider ROW leaves this region byte-identical, proven by sha256 of the region rather than
// by reading it. If a change to this region is ever needed in order to add a provider, the design has
// failed and the gate will say so.

const enabledNameListText = (rowList) =>
	rowList
		.filter((oneRow) => oneRow.enabled)
		.map((oneRow) => oneRow.name)
		.join(', ');

// rowListViolation — the row list's own contract, checked before anything is constructed. Duplicate names
// are refused here because two rows sharing a name would mint one identity for two providers, and the
// judgment cache keys on identity alone.
const rowListViolation = (rowList) => {
	if (!Array.isArray(rowList) || !rowList.length) {
		return `the judge provider row list is empty or not an array — there is nothing to select from`;
	}
	const malformedRowList = rowList.filter(
		(oneRow) => !oneRow || typeof oneRow.name !== 'string' || !oneRow.name.length || typeof oneRow.enabled !== 'boolean' || typeof oneRow.construct !== 'function',
	);
	if (malformedRowList.length) {
		return `${malformedRowList.length} judge provider row(s) are malformed — every row declares {name, enabled, construct}`;
	}
	const nameSeenCount = rowList.reduce((soFar, oneRow) => Object.assign({}, soFar, { [oneRow.name]: (soFar[oneRow.name] || 0) + 1 }), {});
	const duplicatedNameList = Object.keys(nameSeenCount).filter((oneName) => nameSeenCount[oneName] > 1);
	if (duplicatedNameList.length) {
		return (
			`the judge provider row list names '${duplicatedNameList.join("', '")}' more than once. Two rows sharing a name ` +
			`would mint ONE identity for two providers, and the judgment cache distinguishes providers by identity alone — ` +
			`so they would serve each other's verdicts. Row names are unique and each IS its provider's own name.`
		);
	}
	return null;
};

const constructJudgeProvider = (constructionOptions, constructionCallback) => {
	const { providerName, debugJudgeRuleName, configFilePathByProviderName = {}, componentOverrides = {} } = constructionOptions || {};
	const rowList = componentOverrides.judgeProviderRowList || JUDGE_PROVIDER_ROW_LIST;

	const listViolation = rowListViolation(rowList);
	if (listViolation) {
		constructionCallback(`${moduleName}: ${listViolation}`);
		return;
	}

	// NO SILENT DEFAULT FOR AN ABSENT SELECTION. An operator who deletes the key, or a caller that forgets
	// to pass one, is refused by the NAME OF THE KEY they would have to set. Absence is not a weaker form of
	// a wrong value; it is the form that reads as "nothing to see here".
	if (typeof providerName !== 'string' || !providerName.trim()) {
		constructionCallback(
			`${moduleName}: no judge provider was named. Set [${SELECTION_CONFIG_SECTION_NAME}].${SELECTION_CONFIG_KEY_NAME} ` +
				`in graphBuilder.ini to one of: ${enabledNameListText(rowList)}. There is no default — a run whose judge ` +
				`nobody named would write an unattributable identity onto every edge it judged.`,
		);
		return;
	}

	const selectedRow = rowList.find((oneRow) => oneRow.name === providerName);
	if (!selectedRow) {
		constructionCallback(
			`${moduleName}: [${SELECTION_CONFIG_SECTION_NAME}].${SELECTION_CONFIG_KEY_NAME} names '${providerName}', which is not a ` +
				`registered judge provider. The registered providers are: ${enabledNameListText(rowList)}. Refused by name rather ` +
				`than falling through to one of them.`,
		);
		return;
	}
	if (!selectedRow.enabled) {
		constructionCallback(
			`${moduleName}: judge provider '${providerName}' is registered but DISABLED. It is named here rather than reported as ` +
				`unknown, because those are different facts and an operator needs to know which one they are looking at. The ` +
				`selectable providers are: ${enabledNameListText(rowList)}.`,
		);
		return;
	}

	// ONLY THE SELECTED ROW IS CONSTRUCTED. Nothing above touched any other row's construct.
	const rowConstructionOptions = {
		configFilePath: configFilePathByProviderName[selectedRow.name],
		componentOverrides: componentOverrides[selectedRow.name],
		debugJudgeRuleName,
	};

	// Boundary translation: a row whose construct throws SYNCHRONOUSLY (the ollama row can, for a config
	// fault, before it ever reaches its own callback) is named through this callback rather than escaping.
	try {
		selectedRow.construct(rowConstructionOptions, (rowConstructionError, constructedProvider) => {
			if (rowConstructionError) {
				constructionCallback(rowConstructionError);
				return;
			}
			// VALIDATION RUNS HERE — INSIDE THE CONSTRUCTION CALLBACK (docket ii). bridge-framework's
			// maxConcurrency guard remains as the safety net; it is not the gate, and it must never be the
			// first thing that meets an invalid client.
			if (!constructedProvider) {
				constructionCallback(
					`${moduleName}: judge provider '${selectedRow.name}' reported successful construction but yielded NO provider ` +
						`object. An identity that never existed must never reach the framework.`,
				);
				return;
			}
			const contractViolation = judgeProviderViolation(constructedProvider, { providerLabel: `judge provider '${selectedRow.name}'` });
			if (contractViolation) {
				constructionCallback(`${moduleName}: ${contractViolation}`);
				return;
			}
			// THE ROW NAME IS THE PROVIDER'S OWN NAME. See the header: this is the check that makes a model
			// collision unconstructable, because the shape already forces model to begin `${name}:`.
			if (constructedProvider.name !== selectedRow.name) {
				constructionCallback(
					`${moduleName}: registry row '${selectedRow.name}' constructed a provider that calls itself ` +
						`'${constructedProvider.name}'. A row name must BE its provider's own name — otherwise two rows could ` +
						`mint one identity and the judgment cache would serve one provider's verdicts for another's.`,
				);
				return;
			}
			// ⟪docket (vii)⟫ FREEZE WHAT IS HANDED OUT. The registry validates ONCE; nothing re-checks
			// afterwards. Without this, a caller could reassign `model` between construction and use and put
			// one identity in the judgment cache key and a different one on the edge. The freeze is SHALLOW
			// and that is enough BY INSPECTION OF THE CONTRACT, not by luck: every member JUDGE_PROVIDER_SHAPE
			// declares is a string, a positive integer or a function, so there is no nested object for a
			// caller to reach through. A provider that added a mutable object member would need this
			// revisited, and the suite asserts the members really are only those kinds.
			constructionCallback('', Object.freeze(constructedProvider));
		});
	} catch (rowConstructionFault) {
		constructionCallback(`${moduleName}: judge provider '${selectedRow.name}' could not be constructed: ${rowConstructionFault.message}`);
	}
};
// ⟪G4-a FACTORY REGION END⟫

// THE DEBUG ROW'S OWN VOCABULARY, RE-EXPORTED — DERIVED FROM debugJudge, NEVER RESTATED.
// build.js needs three of these to parse and report the --useDebugJudge override: the registered rule
// names (to refuse an unregistered one BY NAME, listing them), the register's DEFAULT_RULE (for a bare
// flag), and DEBUG_MARK (for the loud status line saying no Opus credit will be spent). Before JOB 4 it
// read them off a direct `require` of debugJudge — which is exactly the require G4-a now forbids, because
// an orchestrator that requires a judge factory is an orchestrator that knows the name of every judge that
// exists. They are re-exported HERE, from the module that already owns provider selection, so build.js
// reaches one seam instead of two. They are READ from debugJudge rather than retyped: a rule added to its
// register appears here with no edit, which is the same discipline KNOWN_PROVIDER_NAME_LIST follows.
// ⟪JOB 6, 2026-09-08⟫ THIS LINE WAS THE LITERAL 'debug' while its three neighbours derived, and the
// paragraph above already claimed all of them were read rather than retyped — the comment was false about
// its own first line. RUBY_ANCHOR raised it at the JOB 4 stand-down and declined to edit a committed tree.
// It is derived now for the reason RUBY_ANCHOR gave: the row-name agreement check that would have caught a
// drifted literal fires at RUN time on a real build, so it refuses THE RUN rather than the mistake, and a
// mirror that happens to agree is the one row a fifth provider's author would copy. Pinned by G6-h in
// test-judgeProviderRegistry.js BEHAVIOURALLY — debugJudge's export is moved and this constant must follow —
// because 'debug' === debugJudgeLib.PROVIDER_NAME is true today and equality can prove only agreement.
const DEBUG_JUDGE_PROVIDER_NAME = debugJudgeLib.PROVIDER_NAME;
const DEBUG_JUDGE_RULE_NAME_LIST = debugJudgeLib.REGISTERED_RULE_NAMES;
const DEBUG_JUDGE_DEFAULT_RULE_NAME = debugJudgeLib.DEFAULT_RULE;
const DEBUG_JUDGE_MARK = debugJudgeLib.DEBUG_MARK;

module.exports = Object.freeze({
	JUDGE_PROVIDER_ROW_LIST,
	KNOWN_PROVIDER_NAME_LIST,
	SELECTION_CONFIG_SECTION_NAME,
	SELECTION_CONFIG_KEY_NAME,
	DEBUG_JUDGE_PROVIDER_NAME,
	DEBUG_JUDGE_RULE_NAME_LIST,
	DEBUG_JUDGE_DEFAULT_RULE_NAME,
	DEBUG_JUDGE_MARK,
	constructJudgeProvider,
});
