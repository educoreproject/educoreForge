'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// llmClient.js — the REAL Anthropic Messages client for the INFERRED-track RERANKER (P3b). FAITHFUL PORT of
// the incumbent npm/qtools-graph-forge-core/lib/llm-client/llm-client.js into the recreation, repointed at
// this project's [anthropicAi] .ini (env ANTHROPIC_API_KEY remains the alternative key source). It forces a
// single structured tool call so the model emits a constrained `choice` (a candidate index OR 'NONE'),
// exactly the json_schema-choice contract inferencePipeline.js consumes: it calls
//   llmClient.rerank({ systemPrompt, userPrompt, choiceEnum }, cb)  and reads only  cb('', { choice }).
// ⟪JOB 1, 2026-09-07 — THE SENTENCE THAT USED TO STAND HERE WAS WRONG AND IS CORRECTED⟫ It read: "The extra
// returned keys ({ model, attempts }) are harmless surplus the pipeline ignores — the contract is met
// precisely on `choice`." They are CONTRACT MEMBERS. JUDGE_PROVIDER_SHAPE (apps/graph-builder/interfaces.js)
// declares rerank's result as { choice, category, rationale, model, attempts }, and `model` is the
// NAMESPACED IDENTITY the judgment travelled under — the judgment-cache key (judgeComponent.js:242), the
// forensic judgeModel, and the edge's mappingTool. A caller that discarded it would be discarding the only
// record of WHICH judge answered. The API KEY is NEVER logged, echoed, or returned.
//
// NON-determinism note: the rerank is the ONE non-deterministic step of the inferred producer — it runs ONCE
// at --rebridge time and its output is FROZEN into a content-addressed decision block; a plain-build replay
// never calls this client. It is constructed ONLY on a real --rebridge (build.js's eager gate), NEVER by the
// hermetic suite (which injects a deterministic STUB llmClient).
//
// §6 NO-SILENT-DEFAULT (the one intentional deviation from the incumbent, mirroring embedding-client's
// discipline): a CONFIGURATION FAULT THROWS AT CONSTRUCTION. When no key resolves from either the ini or the
// env, the client REFUSES BY NAME the moment it is built — before any socket exists — rather than
// constructing cleanly and no-opping (or erroring only deep inside a rerank callback after credit could have
// been spent). Operational faults (a bad response, a timeout) still travel by callback.
//
// temperature is omitted for claude-opus-4-8 (the API rejects temperature for that model: 400
// invalid_request_error 'temperature is deprecated'); temperature 0 is sent for other models. That test reads
// `wireModel`, NOT `model` — see THE wireModel/model SPLIT below; testing the namespaced identity would match
// nothing and silently start sending temperature to a model that rejects it. Robust answer
// extraction (structured tool input.choice -> embedded "choice" regex -> bare NONE -> first in-range integer)
// mirrors the measured harness so parse failures stay at ~0.
//
// Native https + callbacks (no qtools HTTP-to-Anthropic library exists). No async/await, no try/catch for
// control flow (a JSON.parse guard is the one local exception, isolated to parsing the response body).
// camelCase only.
//
// ⟪REFERENCE REPAIR, DAWN_TOWER 2026-09-07, authorised by tqii ("I don't know what the reference
// problem is but fix it")⟫ THIS FILE'S COMMENTS POINTED AT A DIRECTORY THAT NO LONGER EXISTS. There is
// no `lib.d/` under bridge-maker. Two modules were named in eighteen places and neither is findable:
//   lib.d/evidenceSelect.js  ->  lib/bridge-framework/judgeComponent.js, function judgeOne. It is the
//       sole production caller of rerank (judgeComponent.js:302) and remains THE enforcer of the
//       category/rationale contract, refusing by name rather than fabricating. Pointers updated.
//   lib.d/selector.js        ->  GONE, WITH NO SUCCESSOR. Neither selector.js nor test-selector.js
//       exists anywhere in the tree. Comments below now say "the scalar path" rather than naming a
//       file that cannot be opened.
// CONSEQUENCE, RULED AND NOW DONE: the SCALAR tool-schema variant (requireJudgment falsy) HAD NO
// CALLER. Every rerank call site in production and in test passed requireJudgment: true. The variant,
// its branch, and the claims that stood below about "existing callers" described a consumer that no
// longer exists — AND THE DEAD VARIANT WAS THE DEFAULT, so a caller that merely omitted the option
// silently got a schema requiring neither category nor rationale. tqii ruled on 2026-09-07 that it be
// RETIRED: judgment becomes unconditional and an obsolete `requireJudgment` argument is REFUSED BY
// NAME rather than ignored. That work is JOB 0 of WORKORDER-judgeProviderRegistry-v2-090726.md and IT
// HAS LANDED (2026-09-07, IVORY_BRIDGE): buildTool emits ONE schema and rerank refuses the obsolete
// argument by name. THE BRANCH IS GONE — this note is history, not a description of live code.
//
// ⟪R-a WIRING — bridgeEvidenceRefactor-spec.md §7 P4, the P3 boundary review's named rider⟫. P3's
// lib/bridge-framework/judgeComponent.js proved the {choice, category, rationale} response shape ⟪A4⟫'s discrete
// verdict category requires, but only against a hermetic STUB llmClient — the live client (this file)
// did not yet emit category/rationale. P4 wires it: the `select_candidate` tool's input_schema now ALSO
// declares `category` (CATEGORY_ENUM below — SELECT_CATEGORY_ENUM's three non-abstain values; 'none' is
// never a category a MODEL asserts about its own pick — abstain is expressed via choice='NONE', not a
// category value) and `rationale` (free text), and `rerank`'s callback result carries them alongside
// `choice` when the model's tool call populated them. ADDITIVE, per the rider's own instruction:
//   - `required` stayed `['choice']` AT THE TIME — a model that omitted category/rationale still got a
//     valid tool call. ⟪SUPERSEDED BY JOB 0, 2026-09-07: required is now choice+category+rationale,
//     unconditionally. The additive posture below is history; the schema is no longer permissive.⟫
//   - extractCategoryAndRationale has NO free-text fallback (unlike extractChoice's (b)/(c)/(d) paths):
//     category/rationale are read ONLY from the structured tool_use input; a model that did not report
//     them yields `undefined` for both, never a fabricated value (polyArch2 §6 — refuse/omit, don't guess).
//   - the scalar path destructured ONLY `.choice` off this callback's result and was therefore
//     completely unaffected by these two additional, optional keys — proven at the time in test-selector.js
//     (since removed with its module) and test-llm-client.js's own R-a section. ⟪That path is GONE as of
//     JOB 0; judgeComponent.js is the sole production caller and reads all three.⟫
//
// @concept: [[LlmReranker]]

const path = require('path');
const fs = require('fs');
const https = require('https');
const configFileProcessor = require('qtools-config-file-processor');
// SELECT_CATEGORY_ENUM — the SINGLE SOURCE OF TRUTH for the discrete verdict category (evidenceContracts.js
// §5, ⟪A4⟫). Same-directory require (lib/evidenceContracts.js) — that module is standalone data + refuse-
// by-value validators, no sqlite-instance pull, no construction-time side effects. Required here so
// CATEGORY_ENUM (below) DERIVES from the contract rather than restating it as a second, driftable literal
// (boundary-review finding, 2026-07-30).
const { SELECT_CATEGORY_ENUM } = require('./evidenceContracts');

// canonical config home for this project (secrets live ONLY here; the SAME [anthropicAi] .ini
// embedding-client's twin discipline names for [voyageEmbedding]). env ANTHROPIC_API_KEY is the alternative
// key source, resolved below and never logged.
const defaultConfigFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/anthropicAi.ini';

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const TOOL_NAME = 'select_candidate';

// ⟪JOB 1, 2026-09-07 — THE wireModel/model SPLIT⟫ Until now ONE property, `cfg.model`, did THREE jobs:
//   (a) the API model name sent on the wire,
//   (b) the input to the /^claude-opus-4/ temperature rule,
//   (c) `client.model` — the judgment-cache key (judgeComponent.js:242), the forensic `judgeModel`
//       (judgeComponent.js:258), and the edge's `mappingTool` (materialiser.js:98).
// (a) and (b) are an ANTHROPIC WIRE DETAIL. (c) is a CROSS-PROVIDER IDENTITY. Conflating them was safe only
// while there was exactly one provider. It stops being safe the moment there are two: the judgment cache
// distinguishes two providers handed identical prompts through the same renderer by `model` ALONE, so two
// providers sharing a wire name would serve each other's verdicts under a real promptHash — silently, and
// durably, since the cache persists. The two are therefore SEPARATE MEMBERS from here on:
//   wireModel  'claude-opus-4-8'            INTERNAL TO THE TRANSPORT. Exactly TWO uses put it anywhere —
//                                           payload.model and the temperature regex, both below and both
//                                           labelled WIRE USE. It is also READ three more times, none of
//                                           them a send: the construction confusion-guard, the derivation
//                                           of `model`, and the returned provider, which exposes it so an
//                                           operator can see what actually went on the wire. It reaches no
//                                           cache key and no edge; only `model` does.
//   model      'anthropic:claude-opus-4-8'  THE IDENTITY. Namespaced by PROVIDER_NAME, DERIVED rather than
//                                           configured, so the namespace cannot be forgotten or misspelt.
// PUTTING THE NAMESPACED FORM ON THE WIRE IS A 400 (gate G-F1-a's twin): the Anthropic API knows nothing of
// our namespace. That is the whole reason the wire value is a separate, internal member.
const PROVIDER_NAME = 'anthropic';
// MODEL_NAMESPACE_SEPARATOR — declared here rather than imported from interfaces.js so that bridge-maker/lib
// (a fingerprinted directory, decisionBlock.js:69) takes on no dependency outside the fingerprint tree. The
// duplication is the SAME deliberate trade JOB 0 made for the refusal wording, and it is PROVEN equal to
// JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR by test-judgeProviderContract.js rather than trusted.
const MODEL_NAMESPACE_SEPARATOR = ':';
const namespacedModelFor = (wireModel) => `${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}${wireModel}`;

// ANTHROPIC_MAX_CONCURRENCY — this provider's OWN ceiling on in-flight judgments. The framework runs the
// judge at min(JUDGE_CONCURRENCY, provider.maxConcurrency) (bridge-framework.js:1449), so a provider that
// cannot take the framework's pace bounds it rather than being drowned by it. 4 matches the framework's own
// JUDGE_CONCURRENCY: the Anthropic API sustains it, and this value has been the effective rate all along —
// it is a DECLARATION of the status quo, not a new limit. An operator may raise or lower it in the ini; an
// ini value that is not a positive integer is REFUSED BY NAME at construction, never quietly corrected.
const ANTHROPIC_MAX_CONCURRENCY = 4;

// CLIENT_VERSION — what describe() reports as its own version. A judge that cannot say what it is must never
// run, and "what it is" includes which build of this client answered.
const CLIENT_VERSION = 'llmClient-anthropic-v2-judgeProviderContract';

// ⟪R-a THIRD REAL-RUN FINDING, 2026-07-30⟫ ROOT CAUSE of all three prior live failures, found by a code
// read after two blind fixes: cfg.maxTokens defaults to 64 (config-overridable; the deployed
// [anthropicAi].ini evidently never raises it). tool_choice is FORCED, so the model emits
// {choice, category, rationale} as ONE tool_use block and is TRUNCATED at 64 tokens — choice+category
// (short, early keys) survive; rationale (a full sentence, emitted last) is the one that gets cut. This
// is DETERMINISTIC per prompt (not model sloppiness), which is exactly why the schema's `required` list
// and the retry-on-malformed-judgment loop (both real, both correct) could not reach 100% on their own:
// retrying a token budget that is structurally too small reproduces the identical truncation.
// JUDGMENT_MAX_TOKENS — sized generously: a one-sentence rationale runs roughly 30-60 tokens, plus the
// tool-call JSON structural overhead (field names, quoting, the enum string) and a safety margin for a
// longer sentence — 400 is comfortable headroom. ⟪JOB 0, 2026-09-07: this floor now applies to EVERY
// judgment. The 64-token ini default, which was correctly sized for the retired {choice}-only variant
// and can never hold a rationale, can no longer reach the wire by a caller omitting an option.⟫
const JUDGMENT_MAX_TOKENS = 400;

// ⟪R-a⟫ CATEGORY_ENUM — DERIVED from SELECT_CATEGORY_ENUM (evidenceContracts.js §5, the single source of
// truth), never a hand-restated literal (boundary-review finding, 2026-07-30: a second, near-identical
// literal here was exactly the "third source of truth at the boundary we just declared single-source" the
// review flagged). The SEMANTIC split is legitimate and stays: SELECT_CATEGORY_ENUM is the full contract
// enum, including 'none' (the abstain verdict judgeComponent.js itself synthesizes when the LLM's choice is
// 'NONE' — see judgeOne's `category: 'none'` literal there); CATEGORY_ENUM here is the narrower
// PICK-ONLY set this tool schema OFFERS THE MODEL, because a model reports a category only when it IS
// making a pick — abstain is expressed through `choice='NONE'`, never through a category value asserted
// about a pick that does not exist. Filtering 'none' out at the derivation site (rather than restating the
// three remaining values by hand) means SELECT_CATEGORY_ENUM gaining or renaming a category can never
// silently drift out of sync with what this tool schema offers.
const CATEGORY_ENUM = SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== 'none');

// ⟪JOB 0, 2026-09-07⟫ JUDGMENT_REQUIRED_FIELD_LIST — the `required` list of the ONE select_candidate
// schema this client now emits. Named and frozen rather than written inline at the single use site so
// that "what a judgment must contain" is one greppable thing: the retired scalar variant's whole defect
// was that a SECOND, weaker required-list existed and was the DEFAULT.
const JUDGMENT_REQUIRED_FIELD_LIST = Object.freeze(['choice', 'category', 'rationale']);

// ⟪JOB 0, 2026-09-07⟫ OBSOLETE_JUDGMENT_FLAG_NAME / obsoleteJudgmentFlagRefusalText — the retired
// option's name held as DATA in exactly one place per file, so that `rerank` can REFUSE IT BY NAME.
// A silently-ignored argument is precisely how the dead scalar default would creep back in, so the
// name must survive the deletion of the parameter: this constant, and the refusal it builds, are the
// ONLY code occurrences of the identifier left in this file.
// TWIN: debugJudge.js carries a character-identical copy of this refusal text (it answers the same
// `rerank` contract and must refuse the same argument in the same words). The two are duplicated
// rather than shared because a judge provider may not depend on another provider's module; the
// equality is proven by gate G0-d, not by trust.
const OBSOLETE_JUDGMENT_FLAG_NAME = 'requireJudgment';
// ⟪JOB 1, 2026-09-07⟫ OBSOLETE_MODEL_OPTION_NAME — the CONSTRUCTION option `model` is retired for exactly the
// reason this job exists: after the split the bare word names two different things, and a caller writing
// `model:` cannot be assumed to mean the wire name rather than the identity. It had ZERO callers when it was
// retired — build.js:993, the only construction site in the tree, passes configFilePath alone — so this is a
// rename with no migration, not a removal of live behaviour. The replacement option is `wireModel`. As with
// requireJudgment, the retired name is REFUSED BY NAME rather than ignored: an option that silently does
// nothing is how the ambiguity would return.
const OBSOLETE_MODEL_OPTION_NAME = 'model';
const obsoleteModelOptionRefusalText = (receivedValue) =>
	`${OBSOLETE_MODEL_OPTION_NAME} is no longer a construction option (JOB 1, 2026-09-07): it was ambiguous ` +
	`once model split into wireModel (the API name sent on the wire) and model (the namespaced identity ` +
	`'${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}<wireModel>' that keys the judgment cache and reaches the ` +
	`edge). Pass wireModel instead; the identity is DERIVED and cannot be set. Refused by name, never ` +
	`ignored, so the ambiguity cannot creep back. (received ${JSON.stringify(receivedValue)})`;
const obsoleteJudgmentFlagRefusalText = (receivedValue) =>
	`${OBSOLETE_JUDGMENT_FLAG_NAME} is OBSOLETE and was removed (JOB 0, 2026-09-07): judgment is now ` +
	`UNCONDITIONAL — the select_candidate schema always requires choice, category and rationale. ` +
	`Remove the argument from the call site; it is refused by name, never ignored, so the retired ` +
	`scalar default cannot creep back. (received ${JSON.stringify(receivedValue)})`;

// ⟪JOB 1, 2026-09-07 — gate G-F10-b⟫ requestTimeoutRefusalText — a timeout refusal must say WHETHER THE
// REQUEST WAS EVER SENT. "no response within 120000ms" is the same sentence for two opposite faults: a
// request that reached Anthropic and got no answer (a slow or wedged model), and a request that never left
// this process because it sat waiting for a socket (too much concurrency for the agent's pool). The operator
// response differs completely — wait or retry in the first case, lower maxConcurrency in the second — so the
// refusal names which happened, and how long was spent in each state.
//
// [code fact] Node's `timeout` option on https.request is a SOCKET timeout: it starts when a socket is
// ASSIGNED, not when the request is created. A request still waiting for a free socket has therefore sent
// NOTHING, and the 'socket' event is what distinguishes the two states.
//
// ⟪NO MILLISECOND DURATIONS HERE, AND THE REASON IS A GATE⟫ The first version of this reported how long was
// spent queued and in flight, using Date.now(). BG-DET conjunct (a) in lib/bridge-framework/test/
// test-bgReplay.js refuses `Date.now | new Date | Math.random | process.hrtime | crypto.randomBytes` in
// lib/bridge-framework/**, bridgeMaker.js AND bridge-maker/lib/*.js — this file — and caught it. The gate is
// right and the durations were mine to give up: this directory feeds a CONTENT-ADDRESSED decision block, and
// a clock in it is a determinism hazard whether or not today's use happens to be confined to an error
// string. The queued-vs-in-flight DISTINCTION is what the operator needs; the milliseconds were decoration.
// MODULE-SCOPE and pure, so the wording of both arms is provable without a socket, a key or a network.
const requestTimeoutRefusalText = ({ timeoutMs, socketAssigned }) =>
	socketAssigned
		? `no response within ${timeoutMs}ms — the request was IN FLIGHT: a socket was assigned and the ` +
			`request reached the transport, but no response came back. Retry, or raise ` +
			`[anthropicAi].requestTimeoutMs.`
		: `no response within ${timeoutMs}ms — the request was still QUEUED: no socket was ever assigned, so ` +
			`NOTHING WAS SENT and the whole interval was spent waiting for a free connection. Lower the ` +
			`judge's maxConcurrency rather than raising requestTimeoutMs; the wire was never the bottleneck.`;

// extractChoice / extractCategoryAndRationale — MODULE-SCOPE (not per-instance closure): both are pure
// functions of a response body + module-level constants (TOOL_NAME, CATEGORY_ENUM), needing no
// resolved config/API key. Hoisting them out of the per-instance factory below means a hermetic test
// can exercise the REAL extraction logic against a MOCKED Anthropic response-body shape directly —
// no construction, no key, no network — exactly what test-llm-client.js's R-a section does (mocking
// the response shape per this rider's own instruction, never a real API call).

// extractChoice — robust, mirrors the measured harness order.
const extractChoice = (responseBody, choiceEnum) => {
	const inEnum = (value) => choiceEnum.indexOf(`${value}`) !== -1;
	// (a) structured tool input.choice
	const blocks = (responseBody && responseBody.content) || [];
	const toolBlock = blocks.find((b) => b && b.type === 'tool_use' && b.name === TOOL_NAME);
	if (toolBlock && toolBlock.input && inEnum(toolBlock.input.choice)) {
		return `${toolBlock.input.choice}`;
	}
	// gather any text the model emitted (for the alternative extraction paths)
	const text = blocks
		.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
		.map((b) => b.text)
		.join(' ');
	// (b) embedded "choice": "X"
	const m = text.match(/"choice"\s*:\s*"?([A-Za-z0-9_]+)"?/);
	if (m && inEnum(m[1])) {
		return m[1];
	}
	// (c) a bare NONE token
	if (/\bNONE\b/.test(text) && inEnum('NONE')) {
		return 'NONE';
	}
	// (d) the first in-range integer mentioned
	const ints = text.match(/\d+/g) || [];
	const firstInRange = ints.find((n) => inEnum(n));
	return firstInRange || null;
};

// ⟪R-a⟫ extractCategoryAndRationale — reads {category, rationale} ONLY from the structured tool_use
// block's input (no free-text fallback, unlike extractChoice's (b)/(c)/(d) paths: a model that did not
// populate these tool-call fields simply did not report them). Returns `undefined` for either when
// absent or invalid — NEVER a fabricated default (polyArch2 §6).
const extractCategoryAndRationale = (responseBody) => {
	const blocks = (responseBody && responseBody.content) || [];
	const toolBlock = blocks.find((b) => b && b.type === 'tool_use' && b.name === TOOL_NAME);
	const input = (toolBlock && toolBlock.input) || {};
	const category = CATEGORY_ENUM.indexOf(input.category) !== -1 ? input.category : undefined;
	const rationale =
		typeof input.rationale === 'string' && input.rationale.trim() ? input.rationale : undefined;
	return { category, rationale };
};

// ⟪R-a REAL-RUN FIX; JOB 0 2026-09-07⟫ buildTool — MODULE-SCOPE, pure (no cfg/key/network): builds THE
// `select_candidate` tool definition (name/description/input_schema). There is exactly ONE schema, and
// its `required` list is JUDGMENT_REQUIRED_FIELD_LIST — choice, category and rationale, always. Hoisted
// out of `rerank` for the SAME reason extractChoice/extractCategoryAndRationale were: a hermetic test
// inspects the CONSTRUCTED schema directly — no construction, no key, no network, no https.request ever
// attempted — proving the emitted `required` list carries category+rationale, without needing to
// intercept or mock the transport layer at all.
// JOB 0 retired the second, weaker variant this function used to select between. The object emitted
// here is byte-identical to what the surviving (evidence) variant produced, description included —
// proven against a pre-edit capture, gate G0-b.
const buildTool = ({ choiceEnum } = {}) => {
	return {
		name: TOOL_NAME,
		description:
			'Record the single best matching CEDS candidate by its number, or NONE if no candidate is a ' +
			'correct match. You MUST ALSO record a discrete confidence CATEGORY for the choice (never a ' +
			'numeric probability) and a short RATIONALE for the choice — both are REQUIRED whenever ' +
			'choice is a candidate number.',
		input_schema: {
			type: 'object',
			properties: {
				choice: {
					type: 'string',
					enum: choiceEnum,
					description: 'The chosen candidate number, or the string NONE.',
				},
				// ⟪JOB 0⟫ both are REQUIRED, unconditionally — see JUDGMENT_REQUIRED_FIELD_LIST below.
				// A model that omits either is caught by the judgmentIncomplete retry in `rerank` and,
				// on exhaustion, refused by judgeComponent.js — never fabricated here.
				category: {
					type: 'string',
					enum: CATEGORY_ENUM,
					description:
						'A discrete confidence category for the choice — strong, moderate, or weakButReal — ' +
						'reflecting how strongly the evidence supports it, never a numeric probability. ' +
						'Required when choice is a candidate number; omit when choice is NONE.',
				},
				rationale: {
					type: 'string',
					description: 'A short rationale (one or two sentences) explaining the choice.',
				},
			},
			required: JUDGMENT_REQUIRED_FIELD_LIST,
			additionalProperties: false,
		},
	};
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(constructionOptions = {}) => {
		const { configFilePath = defaultConfigFilePath, wireModel: wireModelOverride, componentOverrides = {} } = constructionOptions;
		const { xLog } = process.global;

		// ⟪JOB 1⟫ hasOwnProperty, not `!== undefined` — the same reasoning JOB 0 recorded for requireJudgment:
		// the fault is that the caller MENTIONED the retired option, and every value of it is now ambiguous.
		if (Object.prototype.hasOwnProperty.call(constructionOptions, OBSOLETE_MODEL_OPTION_NAME)) {
			throw new Error(`${moduleName}: ${obsoleteModelOptionRefusalText(constructionOptions[OBSOLETE_MODEL_OPTION_NAME])}`);
		}

		// resolve key/wireModel/version from ini, with env as the alternative key source (never logged).
		// ⟪JOB 1⟫ the ini key is still spelled `model` because the DEPLOYED [anthropicAi].ini spells it that
		// way and that file lives in a different repository, outside this lane. What it has ALWAYS held is the
		// wire name, so it is read into `wireModel` and the ambiguity ends at this boundary rather than
		// travelling. An ini value that has been namespaced by hand is refused at construction below.
		const resolveConfig = () => {
			let iniConfig = {};
			if (fs.existsSync(configFilePath)) {
				const whole = configFileProcessor.getConfig(configFilePath) || {};
				iniConfig = whole.anthropicAi || {};
			}
			const apiKey = iniConfig.apiKey || process.env.ANTHROPIC_API_KEY || '';
			return {
				apiKey,
				keySource: iniConfig.apiKey ? 'ini' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none',
				wireModel: wireModelOverride || iniConfig.model || 'claude-opus-4-8',
				// maxConcurrency is DECLARED by this provider (ANTHROPIC_MAX_CONCURRENCY) and may be overridden
				// in the ini. The raw ini text is carried through UNPARSED so the construction guard below can
				// refuse a malformed value BY NAME showing what was written; parseInt(...) || DEFAULT would turn
				// 'four' into the default silently, which is precisely the shape §6 forbids.
				maxConcurrencyIniText: iniConfig.maxConcurrency,
				apiVersion: iniConfig.apiVersion || '2023-06-01',
				maxTokens: parseInt(iniConfig.maxTokens, 10) || 64,
				// L12: response timeout — a hung connection must never stall the pipeline forever (the
				// concurrency slot was never freed). Timeout destroys the request, which routes error-first
				// through the existing 'error' handler and the normal retry/backoff path.
				requestTimeoutMs: parseInt(iniConfig.requestTimeoutMs, 10) || 120000,
			};
		};

		const cfg = resolveConfig();

		// §6 CONFIGURATION FAULT — THROW AT CONSTRUCTION, BY NAME, when no key resolved. This is the seam the
		// recreation adds over the incumbent: build.js constructs this client ONLY for a real --rebridge, and a
		// real --rebridge with no Anthropic key must fail LOUDLY here (before a single Voyage or Opus credit is
		// spent), never construct a silently-no-op client. The message names the two places a key can live; it
		// NEVER echoes any key value.
		if (!cfg.apiKey) {
			throw new Error(
				`${moduleName}: no Anthropic API key resolved — set [anthropicAi].apiKey in the config ` +
					`(${configFilePath}) or the ANTHROPIC_API_KEY environment variable. There is no default; the ` +
					`reranker refuses to construct without a key rather than no-op later.`,
			);
		}

		// ⟪JOB 1⟫ THE CONFUSION GUARD. The ini key is spelled `model` and now means the WIRE name, so the one
		// mistake an operator can make is writing the namespaced identity there. Left unguarded that is a 400
		// from Anthropic on every judgment of a run — gate G-F1-a's twin, observed deliberately, and a
		// miserable thing to diagnose from a rebridge log. Caught here, at construction, before a credit is
		// spent, naming both halves of the split.
		if (cfg.wireModel.indexOf(`${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}`) === 0) {
			throw new Error(
				`${moduleName}: the configured wire model '${cfg.wireModel}' carries this provider's namespace ` +
					`prefix '${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}'. wireModel is the BARE API model name ` +
					`the Anthropic API accepts (e.g. 'claude-opus-4-8'); the namespaced form is the client's ` +
					`IDENTITY and is DERIVED from it. Sending the namespaced form on the wire is a 400. Set ` +
					`[anthropicAi].model in ${configFilePath} to the bare name.`,
			);
		}

		// maxConcurrency — the provider DECLARES one (ANTHROPIC_MAX_CONCURRENCY); the ini may override it. An
		// ini value present but not a positive integer is refused BY NAME rather than quietly becoming the
		// declared value, because an operator who wrote it meant to change something.
		const maxConcurrency =
			cfg.maxConcurrencyIniText === undefined ? ANTHROPIC_MAX_CONCURRENCY : Number(cfg.maxConcurrencyIniText);
		if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
			throw new Error(
				`${moduleName}: [anthropicAi].maxConcurrency is '${cfg.maxConcurrencyIniText}' in ${configFilePath} ` +
					`— it must be a positive integer (the provider's own ceiling on in-flight judgments; this ` +
					`client declares ${ANTHROPIC_MAX_CONCURRENCY} when the key is absent). A malformed value is ` +
					`refused by name, never silently replaced by the declared one.`,
			);
		}

		// THE NAMESPACED IDENTITY — derived, never configured. This is what judgeComponent keys the judgment
		// cache on, what lands in the forensic trail as judgeModel, and what the materialiser writes onto every
		// judged edge as mappingTool.
		const namespacedModel = namespacedModelFor(cfg.wireModel);

		// one POST attempt -> callback(err, parsedBody, statusCode). realPostOnce is the ONLY thing in this
		// file that touches the network; componentOverrides.postOnce (the NET seam, the SAME
		// componentOverrides idiom kitLoader.buildKit/bridgeMaker.run use for their own doubles) lets a
		// hermetic test drive the REAL retry/backoff loop below — including the NEW malformed-judgment
		// retry — against a scripted SEQUENCE of canned responses, without ever constructing a real
		// https.request. Production callers never pass this; it defaults to the real transport.
		const realPostOnce = ({ payload }, callback) => {
			const body = JSON.stringify(payload);
			// ⟪JOB 1, G-F10-b⟫ the one bit the timeout refusal reports: was a socket ever granted? The 'socket'
			// event fires when one is assigned, so a request that times out with this still false SENT NOTHING.
			// A boolean rather than a timestamp — see requestTimeoutRefusalText's note on BG-DET.
			let socketAssigned = false;
			const req = https.request(
				{
					host: API_HOST,
					path: API_PATH,
					method: 'POST',
					timeout: cfg.requestTimeoutMs,
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(body),
						'x-api-key': cfg.apiKey,
						'anthropic-version': cfg.apiVersion,
					},
				},
				(res) => {
					let raw = '';
					res.on('data', (chunk) => {
						raw += chunk;
					});
					res.on('end', () => {
						let parsed = null;
						let parseErr = null;
						const attempt = () => {
							parsed = JSON.parse(raw);
						};
						try {
							attempt();
						} catch (e) {
							parseErr = e;
						}
						if (parseErr) {
							callback(`response not JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`, null, res.statusCode);
							return;
						}
						callback('', parsed, res.statusCode);
					});
				},
			);
			req.on('socket', () => {
				socketAssigned = true;
			});
			req.on('timeout', () => {
				// destroy() fires the 'error' handler below with this message -> status 0 (retriable).
				req.destroy(new Error(requestTimeoutRefusalText({ timeoutMs: cfg.requestTimeoutMs, socketAssigned })));
			});
			req.on('error', (err) => callback(`request error: ${err.message}`, null, 0));
			req.write(body);
			req.end();
		};
		const postOnce = componentOverrides.postOnce || realPostOnce;

		// ⟪R-a REAL-RUN FINDING, 2026-07-30⟫ a live LIF --rebridge against real Opus failed in Phase C:
		// "evidenceSelect: llmClient did not supply a rationale for its pick — refusing rather than
		// fabricating one." ⟪Quoted VERBATIM, old name and all. `evidenceSelect` was the CONSUMER module
		// that raised this refusal; that module is today lib/bridge-framework/judgeComponent.js and the
		// function is judgeOne. The obsolete name is preserved here because this is a quotation of what
		// actually fired on 2026-07-30, not a pointer to where the code lives.⟫
		// Root cause: category/rationale were OPTIONAL in the ONE shared tool schema
		// (correctly additive for the scalar path, whose SYSTEM_PROMPT never asks for them at all) — but
		// real Opus, unlike the hermetic stub, omits optional fields it is not textually pressed to supply.
		// judgeComponent.js's refusal fired EXACTLY as designed (⟪A4⟫ — never fabricate a missing
		// category/rationale); the fix is a stricter REQUEST, not a laxer downstream check.
		//
		// ⟪JOB 0, 2026-09-07⟫ There is no longer a call-time option selecting between tool-schema
		// variants. EVERY judgment uses the ONE schema (required: choice, category, rationale), so the
		// stricter request the 2026-07-30 finding above called for is now structural rather than
		// opt-in — which is the whole point: the weaker variant was the DEFAULT, so the fix was one
		// forgotten argument away from being silently undone on every new caller.
		// The retired option is not merely ignored: rerank REFUSES IT BY NAME (see
		// OBSOLETE_JUDGMENT_FLAG_NAME at module scope). An argument that silently does nothing is
		// exactly how the dead default would return.
		//
		// ENFORCEMENT LAYER, decided here so there is exactly ONE, never an ambiguous double-refusal:
		// this file does NOT itself refuse a response that omits category/rationale under the evidence
		// variant — it builds the stricter REQUEST and passes through whatever the model actually
		// returned (still `undefined` when omitted, never fabricated, exactly as extractCategoryAndRationale
		// already documented). lib/bridge-framework/judgeComponent.js's own judgeOne is THE enforcer: it already
		// refuses BY NAME ("did not supply a rationale for its pick") when a pick lacks one, and that
		// refusal fired CORRECTLY in the live run above — the bug was never in judgeComponent's judgment,
		// only in how forcefully the API request asked the model to comply. Making llmClient.js ALSO
		// refuse on the same condition would be a second, differently-worded error for the identical
		// fault, exactly the ambiguity the ruling asked to avoid.
		//
		// rerank — { systemPrompt, userPrompt, choiceEnum, maxRetries } -> callback(err, { choice,
		//   model, attempts, category, rationale, usage, stopReason, retryReasons }). choiceEnum: e.g.
		//   ['1','2',...,'15','NONE']. Retries (6) with backoff on 429/5xx/network AND on an incomplete
		//   judgment. lib/bridge-framework/judgeComponent.js is the sole production caller and reads
		//   choice, category and rationale.
		const rerank = (rerankOptions = {}, callback) => {
			const { systemPrompt, userPrompt, choiceEnum, maxRetries = 6 } = rerankOptions;
			if (!cfg.apiKey) {
				// unreachable in normal use (construction already threw), kept as defense-in-depth.
				callback(`${moduleName}: no Anthropic API key ([anthropicAi].apiKey or ANTHROPIC_API_KEY)`);
				return;
			}
			// ⟪JOB 0⟫ hasOwnProperty, not `!== undefined`: the point is that the CALLER MENTIONED the
			// retired option at all. `true` and `false` are refused identically — there is no longer a
			// value of it that means anything, so accepting either would be accepting a lie.
			if (Object.prototype.hasOwnProperty.call(rerankOptions, OBSOLETE_JUDGMENT_FLAG_NAME)) {
				callback(
					`${moduleName}.rerank: ${obsoleteJudgmentFlagRefusalText(rerankOptions[OBSOLETE_JUDGMENT_FLAG_NAME])}`,
				);
				return;
			}
			const tool = buildTool({ choiceEnum });
			// ⟪R-a THIRD REAL-RUN FIX; UNCONDITIONAL since JOB 0⟫ raise the budget to the max of the
			// configured value and JUDGMENT_MAX_TOKENS — never LOWER cfg.maxTokens if an operator already
			// configured something bigger than 400, only ever raise a too-small default. This is now the
			// budget for EVERY judgment: there is no call shape that can put the truncating 64 on the wire.
			const maxTokens = Math.max(cfg.maxTokens, JUDGMENT_MAX_TOKENS);
			const payload = {
				// ⟪JOB 1⟫ WIRE USE (a) of two. The BARE API name goes on the wire; the namespaced identity
				// would be rejected by Anthropic with a 400 (gate G-F1-a's twin, observed).
				model: cfg.wireModel,
				max_tokens: maxTokens,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				tools: [tool],
				tool_choice: { type: 'tool', name: TOOL_NAME },
			};
			// claude-opus-4-8 rejects temperature; send 0 for everything else (the measured fix).
			// ⟪JOB 1⟫ WIRE USE (b) of two. This anchored regex tests wireModel, NOT the namespaced model:
			// 'anthropic:claude-opus-4-8' does not match /^claude-opus-4/, so testing the identity would send
			// temperature to the one model that rejects it — a 400 on every judgment, caused by a rename.
			if (!/^claude-opus-4/.test(cfg.wireModel)) {
				payload.temperature = 0;
			}

			const backoffMs = [0, 500, 1200, 2500, 5000, 9000];
			// ⟪FORENSICS, p9-judgmentPersistence 2026-07-31⟫ retryReasons — one entry per retried
			// attempt, threaded into the success payload so the forensic match log can explain WHY a
			// judgment took N attempts (⟪TQ RULING⟫ "support forensic examination to improve quality
			// later"). Additive surplus: every existing caller destructures only the keys it reads.
			const retryReasons = [];
			// ⟪R-a SECOND REAL-RUN FINDING, 2026-07-30⟫ a strict schema `required` alone did not reach
			// 100%: a live run failed on a DIFFERENT source than the first finding, with the
			// identical refusal — real Opus INTERMITTENTLY omits a schema-required field (roughly 1 call in
			// several dozen, not a hard, every-time violation). DESIGN RULING: validate-and-retry AT THE
			// CLIENT, refuse AT THE CONSUMER. A response whose category is missing/invalid-enum OR whose
			// rationale is missing/blank joins the SAME retry loop the network-status conditions already
			// drive above (same backoff table, same maxRetries cap — no second budget).
			// On EXHAUSTION, this returns whatever came back (category/rationale possibly still undefined)
			// via the NORMAL success callback — it does NOT fabricate and does NOT itself refuse; that is
			// STILL lib/bridge-framework/judgeComponent.js's job alone (see this file's own R-a header, unchanged: exactly
			// ONE enforcer). ⟪JOB 0, 2026-09-07: this condition is now evaluated on EVERY judgment. It was
			// previously skipped whenever the retired option was falsy — which was the DEFAULT.⟫
			const tryAttempt = (attemptIndex) => {
				postOnce({ payload }, (err, parsed, status) => {
					const retriableTransport = status === 429 || (status >= 500 && status <= 599) || status === 0;
					if ((err || retriableTransport) && attemptIndex + 1 < maxRetries) {
						retryReasons.push(`transport (attempt ${attemptIndex + 1}): ${err || `status ${status}`}`);
						const waitMs = backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)];
						setTimeout(() => tryAttempt(attemptIndex + 1), waitMs);
						return;
					}
					if (err) {
						callback(`${moduleName}.rerank failed after ${attemptIndex + 1} attempts: ${err}`);
						return;
					}
					if (status !== 200) {
						const apiMsg = parsed && parsed.error ? parsed.error.message : `status ${status}`;
						callback(`${moduleName}.rerank API error (${status}): ${apiMsg}`);
						return;
					}
					const choice = extractChoice(parsed, choiceEnum);
					if (choice === null) {
						callback(`${moduleName}.rerank: could not extract a choice from the response`);
						return;
					}
					const { category, rationale } = extractCategoryAndRationale(parsed);
					// ⟪R-a THIRD REAL-RUN FIX⟫ BELT: parsed.stop_reason === 'max_tokens'
					// means the model's tool_use JSON was cut off mid-emission — the SAME structural fault
					// judgmentIncomplete already catches (rationale, emitted last, is what gets truncated),
					// folded into the identical condition so it is counted the SAME way, not mistaken for
					// ordinary model sloppiness. With JUDGMENT_MAX_TOKENS's headroom this should never fire;
					// if it ever does, it stays VISIBLE in `attempts` rather than silently masquerading as a
					// missing-field omission.
					const truncated = !!(parsed && parsed.stop_reason === 'max_tokens');
					const judgmentIncomplete = category === undefined || rationale === undefined || truncated;
					if (judgmentIncomplete && attemptIndex + 1 < maxRetries) {
						retryReasons.push(
							`judgmentIncomplete (attempt ${attemptIndex + 1}): ` +
								`${truncated ? 'stop_reason max_tokens (tool JSON truncated)' : `category ${category === undefined ? 'missing' : 'ok'}, rationale ${rationale === undefined ? 'missing' : 'ok'}`}`,
						);
						const waitMs = backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)];
						setTimeout(() => tryAttempt(attemptIndex + 1), waitMs);
						return;
					}
					// ⟪FORENSICS, p9-judgmentPersistence 2026-07-31⟫ usage/stopReason — the Anthropic
					// response envelope's own accounting (usage.input_tokens/output_tokens are present in
					// every Messages response; ⟪TQ⟫ "you get the costs in the return"), threaded up ADDITIVELY
					// so the forensic match log can carry real per-judgment cost. Never fabricated: an
					// envelope without usage yields null. Existing callers (the scalar path read only
					// .choice; lib/bridge-framework/judgeComponent.js reads choice/category/rationale) are unaffected —
					// proven in test-llm-client.js's forensics section.
					const usage =
						parsed && parsed.usage
							? { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens }
							: null;
					callback('', {
						choice,
						// ⟪JOB 1⟫ the IDENTITY, not the wire name. This is a CONTRACT MEMBER of rerank's result
						// (JUDGE_PROVIDER_SHAPE.rerank.resultKeys) and must agree with client.model, or the same
						// client would report two identities for one judgment.
						model: namespacedModel,
						attempts: attemptIndex + 1,
						category,
						rationale,
						usage,
						stopReason: parsed && parsed.stop_reason !== undefined ? parsed.stop_reason : null,
						retryReasons,
					});
				});
			};
			tryAttempt(0);
		};

		// ⟪JOB 1⟫ describe() — required by JUDGE_PROVIDER_SHAPE and INSTANCE-DERIVED, never a constant: it
		// reports the wireModel THIS client resolved and the identity derived from it, so a judge that cannot
		// say what it is cannot construct. `version` is the client build, not the API version — the API version
		// is a wire detail and is already reported through keySource's sibling config.
		const describe = () => ({ provider: PROVIDER_NAME, model: namespacedModel, version: CLIENT_VERSION });

		// The JUDGE PROVIDER, satisfying JUDGE_PROVIDER_SHAPE (apps/graph-builder/interfaces.js). `keySource`
		// is this client's own extra and is not part of the contract; test-build.js and test-useDebugJudge read
		// it. wireModel is exposed rather than hidden so an operator can SEE what went on the wire — it is
		// internal to the transport, not a secret.
		return { name: PROVIDER_NAME, wireModel: cfg.wireModel, model: namespacedModel, maxConcurrency, rerank, describe, keySource: cfg.keySource };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
// ⟪R-a⟫ static, key-independent exports (module-scope, not per-instance) — a hermetic test exercises the
// REAL extraction logic against a mocked Anthropic response-body shape without constructing a client.
module.exports.extractChoice = extractChoice;
module.exports.extractCategoryAndRationale = extractCategoryAndRationale;
module.exports.buildTool = buildTool;
module.exports.CATEGORY_ENUM = CATEGORY_ENUM;
module.exports.TOOL_NAME = TOOL_NAME;
module.exports.JUDGMENT_MAX_TOKENS = JUDGMENT_MAX_TOKENS;
// ⟪JOB 1⟫ the split's own constants and the two pure functions the contract gates exercise — readable
// without a key, a socket or a construction, the same discipline buildTool/extractChoice are exported under.
module.exports.PROVIDER_NAME = PROVIDER_NAME;
module.exports.MODEL_NAMESPACE_SEPARATOR = MODEL_NAMESPACE_SEPARATOR;
module.exports.namespacedModelFor = namespacedModelFor;
module.exports.ANTHROPIC_MAX_CONCURRENCY = ANTHROPIC_MAX_CONCURRENCY;
module.exports.CLIENT_VERSION = CLIENT_VERSION;
module.exports.requestTimeoutRefusalText = requestTimeoutRefusalText;
module.exports.OBSOLETE_MODEL_OPTION_NAME = OBSOLETE_MODEL_OPTION_NAME;
