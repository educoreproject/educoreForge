'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// ollamaJudgeClient.js — the OLLAMA judge provider, satisfying JUDGE_PROVIDER_SHAPE.
// judgeProviderRegistry JOB 3, 2026-09-07.
//
// It answers the SAME seam llmClient answers — rerank({systemPrompt, userPrompt, choiceEnum}, cb) ->
// cb(err, {choice, category, rationale, model, attempts}) — against a LOCAL Ollama server over plain HTTP.
// The judge stopped being one thing: Anthropic is retained as the measurement instrument and this provider
// does development judging, which is free and runs on this machine.
//
// ⟪THE CONSTRAINT IS THE SERVER'S, NOT THE PROMPT'S — AND IT IS THE SAME CONSTRAINT⟫ The incumbent forces
// one select_candidate tool call and reads the structured tool_use block. Ollama has no tool call at all:
// it takes `format: <a JSON schema>` on POST /api/chat and constrains GENERATION to it. Different dialect,
// identical discipline — and the schema is NOT written here. It comes from selectCandidateSchema.js's
// 'ollama' rendering, so ONE derivation from SELECT_CATEGORY_ENUM serves every provider. A schema written
// per provider is the category enum restated per provider, and a drifted enum fails SILENTLY: the model
// simply never emits the missing value and nothing errors.
//
// MEASURED, 2026-09-07, gate G-F3-b (evidence: judgeProviderRegistry-evidence/JOB3-gF3-liveOllamaProbe.txt):
// a prompt DEMANDING an out-of-enum choice and an out-of-enum category got back in-enum values for both,
// with the demanded values pushed into the RATIONALE string. `format` constrains the enum fields;
// disobedience leaks into the one free-text field. That is why the enum fields are trusted only after being
// checked against the enums, and why the rationale is never mined for anything.
//
// ⟪THE RESPONSE IS A JSON STRING, NOT A PARSED BLOCK⟫ message.content is TEXT that happens to contain JSON,
// so reading it needs a parse the incumbent does not. That parse is the ONE try/catch in this file, isolated
// to the parse itself, exactly as llmClient's header sanctions for its own response-body parse. It is not
// control flow: every operational fault travels error-first by callback, and every wiring fault throws.
//
// ⟪NO FREE-TEXT FALLBACK — DELIBERATELY UNLIKE extractChoice⟫ llmClient's extractChoice has alternative
// paths (an embedded "choice" regex, a bare NONE token, the first in-range integer) because a choice
// recovered from prose is still checked against choiceEnum and is either in it or refused. This extractor
// has NONE of them, and the difference is not an oversight. Ollama's whole answer arrives as one free-text
// field; mining prose here would mean mining exactly the field the model pushes its DISOBEDIENCE into, as
// G-F3-b measured. A field this provider did not validly supply comes back `undefined` and is left for the
// retry loop and then for judgeComponent.js to refuse, which is the sole enforcer.
//
// ⟪DO NOT SHELL OUT TO THE `ollama` CLI⟫ (v2 JOB 3, explicit). It returns prose and discards the constraint
// this file exists to carry.
//
// NO CLOCK, NO RANDOMNESS. BG-DET conjunct (a) refuses Date.now, new Date, Math.random, process.hrtime and
// crypto.randomBytes anywhere in bridge-maker/lib, because this directory is content-addressed into a
// decision block (decisionBlock.js:69). The timeout refusal below therefore reports WHICH STATE the request
// died in and not how long it took — the distinction is what an operator needs; the milliseconds were
// decoration. MARBLE_ANCHOR's first cut of the equivalent refusal in llmClient carried them and the gate
// refused it.
//
// SAME-DIRECTORY REQUIRE ONLY, plus node builtins and the config processor. bridge-maker/lib is a
// FINGERPRINTED directory, so a require reaching outside the fingerprint tree would put judgment logic
// where a change to it does not move the fingerprint.
//
// §6 NO SILENT DEFAULT, AND WHERE EACH FAULT CLASS TRAVELS. Ruled by DAWN_TOWER, 2026-09-07, on the
// observation that construction cannot be both synchronous and probe a server: JUDGE_PROVIDER_SHAPE
// requires `model` to be a non-empty string ON THE RETURNED OBJECT, the identity carries a digest, and the
// digest can only come over HTTP. The two fault classes are therefore split by whether they need I/O:
//   CONFIGURATION faults THROW, synchronously, at construction, naming the key and the file. They need no
//     I/O to detect, so nothing is lost by throwing and the fault is caught before a socket can exist —
//     the same discipline as llmClient's throw-when-no-key. There is no `x || default` anywhere in this
//     file; a missing line in the ini is a loud failure, never a quiet change of behaviour.
//   THE SERVER PROBE refuses through the error-first CONSTRUCTION CALLBACK, because reading a digest over
//     HTTP is I/O and pretending otherwise would mean blocking the event loop. A dead server yields a
//     non-empty constructionError and NO provider object, so an incomplete identity can never escape.
//
// @concept: [[OllamaJudgeProvider]]

const fs = require('fs');
const http = require('http');
const configFileProcessor = require('qtools-config-file-processor');
const {
	renderSelectCandidateSchema,
	OFFERED_CATEGORY_ENUM,
} = require('./selectCandidateSchema');

// canonical config home for this project, matching the incumbent's [anthropicAi] twin. No secrets live
// here and none are needed: Ollama is a local service with no API key.
const defaultConfigFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/ollamaJudge.ini';

const CONFIG_SECTION_NAME = 'ollamaJudge';
const CHAT_API_PATH = '/api/chat';
const TAG_LIST_API_PATH = '/api/tags';

// TAG_PROBE_TIMEOUT_MS — the construction probe's own budget, deliberately much smaller than a judgment's.
// A judgment may legitimately take half a minute on a cold model load; asking a running server to list its
// installed models is a local read that either answers at once or is not going to. v2 requires a dead
// server to be refused "in under two seconds", and this is what makes that true even when the host is
// reachable but the service is wedged, rather than merely when the port is closed.
const TAG_PROBE_TIMEOUT_MS = 1500;

// ⟪THE wireModel/model SPLIT — JOB 1's contract, applied to this provider⟫
//   wireModel  'qwen2.5:32b'                        INTERNAL TO THE TRANSPORT. It is SENT in exactly ONE
//                                                   place — the payload's `model`. Every OTHER occurrence is
//                                                   a read and never a send: the construction confusion
//                                                   guard, the /api/tags lookup that finds its digest, the
//                                                   refusal strings that name it back to an operator, the
//                                                   derivation of `model`, and the returned provider, which
//                                                   exposes it so an operator can see what went on the wire.
//                                                   (Roles rather than a COUNT, deliberately: a count here
//                                                   would be one more number to re-measure on every edit,
//                                                   and this file's prose pass has already corrected two.)
//                                                   It reaches no cache key and no edge; only `model` does.
//   model      'ollama:qwen2.5:32b@<12 hex>'        THE IDENTITY: the judgment-cache key
//                                                   (judgeComponent.js:242), the forensic judgeModel, and
//                                                   the edge's mappingTool. DERIVED, never configured.
// THE DIGEST IS PART OF THE IDENTITY ON PURPOSE. A model tag is mutable — re-pulling `qwen2.5:32b` can
// deliver different weights under the same name — and the judgment cache distinguishes providers by `model`
// ALONE. Without the digest, verdicts from two different sets of weights would merge silently under one
// identity, durably, because the cache persists. It is READ from /api/tags at construction rather than
// configured, so a re-pull is a new identity without anyone remembering to edit the ini.
const PROVIDER_NAME = 'ollama';
// MODEL_NAMESPACE_SEPARATOR — declared here rather than imported from interfaces.js so that bridge-maker/lib
// takes on no dependency outside the fingerprint tree, the SAME deliberate trade llmClient and debugJudge
// make. The equality with JUDGE_PROVIDER_SHAPE's is PROVEN by test-ollamaJudgeClient.js, not trusted.
//
// ⟪THIS PROVIDER IS WHY THE NAMESPACE RULE IS A PREFIX TEST⟫ The separator occurs INSIDE this provider's own
// wire name ('qwen2.5:32b'), so any rule that counted separators or split on them would mis-read this
// provider's identity. interfaces.js says so at MODEL_NAMESPACE_SEPARATOR; this is the case it means.
const MODEL_NAMESPACE_SEPARATOR = ':';
// MODEL_DIGEST_SEPARATOR / MODEL_DIGEST_PREFIX_LENGTH — '@' and 12, the form v2 specifies. The full digest
// is 64 hex characters; the 12-character prefix is what git and Docker use for the same job and is what
// reaches the edge, where a 64-character tail would crowd out everything else in a mappingTool value.
const MODEL_DIGEST_SEPARATOR = '@';
const MODEL_DIGEST_PREFIX_LENGTH = 12;

const namespacedModelFor = (wireModel, modelDigest) =>
	`${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}${wireModel}${MODEL_DIGEST_SEPARATOR}${String(modelDigest).slice(0, MODEL_DIGEST_PREFIX_LENGTH)}`;

// CLIENT_VERSION — what describe() reports as its own build. A judge that cannot say what it is must never
// run, and "what it is" includes which build of this client answered.
const CLIENT_VERSION = 'ollamaJudgeClient-ollama-v1-judgeProviderContract';

// ⟪JOB 0, 2026-09-07⟫ OBSOLETE_JUDGMENT_FLAG_NAME / obsoleteJudgmentFlagRefusalText — the retired option's
// name held as DATA so rerank can REFUSE IT BY NAME. A silently-ignored argument is precisely how the dead
// scalar default would creep back, and every new provider is a fresh chance to accept one.
// TWIN: llmClient.js and debugJudge.js carry CHARACTER-IDENTICAL copies of this text. The three are
// duplicated rather than shared because a judge provider may not depend on another provider's module; the
// equality is PROVEN by gate G1-d across all three providers, not trusted. If this wording is edited, the
// other two must be edited in the same commit or the gate goes red — which is the point of the gate.
const OBSOLETE_JUDGMENT_FLAG_NAME = 'requireJudgment';
const obsoleteJudgmentFlagRefusalText = (receivedValue) =>
	`${OBSOLETE_JUDGMENT_FLAG_NAME} is OBSOLETE and was removed (JOB 0, 2026-09-07): judgment is now ` +
	`UNCONDITIONAL — the select_candidate schema always requires choice, category and rationale. ` +
	`Remove the argument from the call site; it is refused by name, never ignored, so the retired ` +
	`scalar default cannot creep back. (received ${JSON.stringify(receivedValue)})`;

// ⟪G-F10-b⟫ requestTimeoutRefusalText — a timeout refusal must say WHETHER THE REQUEST WAS EVER SENT.
// "no response within 180000ms" is the same sentence for two opposite faults with opposite remedies: a
// request that reached the server and got no answer, and a request that never left this process because it
// sat waiting for a socket. [code fact] Node's `timeout` option on http.request is a SOCKET timeout — it
// starts when a socket is ASSIGNED, not when the request is created — so a request that times out with no
// socket has sent NOTHING, and the 'socket' event is what distinguishes the two states.
// MODULE-SCOPE and pure, so both arms are provable without a socket or a server.
const requestTimeoutRefusalText = ({ timeoutMs, socketAssigned }) =>
	socketAssigned
		? `no response within ${timeoutMs}ms — the request was IN FLIGHT: a socket was assigned and the ` +
			`request reached the transport, but no answer came back. A cold model load is slow the FIRST ` +
			`time; retry, or raise [${CONFIG_SECTION_NAME}].requestTimeoutMs.`
		: `no response within ${timeoutMs}ms — the request was still QUEUED: no socket was ever assigned, so ` +
			`NOTHING WAS SENT and the whole interval was spent waiting for a free connection. Lower the ` +
			`judge's maxConcurrency rather than raising requestTimeoutMs; the wire was never the bottleneck.`;

const deadServerRefusalText = ({ endpointHostName, endpointPortNumber, underlyingFault }) =>
	`${moduleName}: no Ollama server answered ${TAG_LIST_API_PATH} at ${endpointHostName}:${endpointPortNumber} ` +
	`(${underlyingFault}). The judge refuses to construct rather than failing on every judgment of a run. ` +
	`Start it with 'brew services start ollama', or correct [${CONFIG_SECTION_NAME}].endpointHostName and ` +
	`.endpointPortNumber. Refused by name at construction, before any judgment is attempted.`;

// ===== CONFIGURATION — EVERY KEY REQUIRED, EVERY FAULT NAMED, NOTHING DEFAULTED =====

const nonEmptyStringOrThrow = (rawValue, configKeyName, configFilePath) => {
	if (typeof rawValue !== 'string' || !rawValue.trim()) {
		throw new Error(
			`${moduleName}: [${CONFIG_SECTION_NAME}].${configKeyName} is ${JSON.stringify(rawValue)} in ${configFilePath} ` +
				`— it must be a non-empty string. There is no default; the value is required and is refused by ` +
				`name rather than substituted.`,
		);
	}
	return rawValue.trim();
};

const positiveIntegerOrThrow = (rawValue, configKeyName, configFilePath) => {
	const numberValue = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
	if (!Number.isInteger(numberValue) || numberValue < 1) {
		throw new Error(
			`${moduleName}: [${CONFIG_SECTION_NAME}].${configKeyName} is '${rawValue}' in ${configFilePath} — it must ` +
				`be a positive integer. A malformed value is refused BY NAME showing what was written, never ` +
				`quietly replaced by a working one: an operator who wrote it meant to change something.`,
		);
	}
	return numberValue;
};

const requiredValueOrThrow = (sectionConfig, configKeyName, configFilePath) => {
	if (sectionConfig[configKeyName] === undefined || sectionConfig[configKeyName] === null || sectionConfig[configKeyName] === '') {
		throw new Error(
			`${moduleName}: [${CONFIG_SECTION_NAME}].${configKeyName} is not configured in ${configFilePath}. Every key ` +
				`in this section is REQUIRED and there is no default for any of them — a missing line is a loud ` +
				`failure rather than a silent change of behaviour.`,
		);
	}
	return sectionConfig[configKeyName];
};

const resolveConfigOrThrow = (configFilePath) => {
	if (!fs.existsSync(configFilePath)) {
		throw new Error(
			`${moduleName}: no config file at ${configFilePath}. This provider is configured by a [${CONFIG_SECTION_NAME}] ` +
				`section holding endpointHostName, endpointPortNumber, wireModel, maxConcurrency, requestTimeoutMs ` +
				`and numPredict. No key has a default; the client refuses to construct rather than guessing.`,
		);
	}
	const wholeConfig = configFileProcessor.getConfig(configFilePath) || {};
	const sectionConfig = wholeConfig[CONFIG_SECTION_NAME];
	if (!sectionConfig || typeof sectionConfig !== 'object') {
		throw new Error(
			`${moduleName}: ${configFilePath} has no [${CONFIG_SECTION_NAME}] section. The section name is what ` +
				`selects this provider's configuration; without it there is nothing to read and nothing is assumed.`,
		);
	}
	const endpointHostName = nonEmptyStringOrThrow(
		requiredValueOrThrow(sectionConfig, 'endpointHostName', configFilePath), 'endpointHostName', configFilePath);
	const endpointPortNumber = positiveIntegerOrThrow(
		requiredValueOrThrow(sectionConfig, 'endpointPortNumber', configFilePath), 'endpointPortNumber', configFilePath);
	const wireModel = nonEmptyStringOrThrow(
		requiredValueOrThrow(sectionConfig, 'wireModel', configFilePath), 'wireModel', configFilePath);
	const maxConcurrency = positiveIntegerOrThrow(
		requiredValueOrThrow(sectionConfig, 'maxConcurrency', configFilePath), 'maxConcurrency', configFilePath);
	const requestTimeoutMs = positiveIntegerOrThrow(
		requiredValueOrThrow(sectionConfig, 'requestTimeoutMs', configFilePath), 'requestTimeoutMs', configFilePath);
	const numPredict = positiveIntegerOrThrow(
		requiredValueOrThrow(sectionConfig, 'numPredict', configFilePath), 'numPredict', configFilePath);

	// THE CONFUSION GUARD, llmClient's own, for this provider's namespace. The ini key holds the BARE model
	// name; the one mistake available to an operator is writing the namespaced identity there. Caught at
	// construction rather than as a server-side "model not found" on every judgment of a run.
	if (wireModel.indexOf(`${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}`) === 0) {
		throw new Error(
			`${moduleName}: the configured wire model '${wireModel}' carries this provider's namespace prefix ` +
				`'${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}'. wireModel is the BARE Ollama model name as ` +
				`'ollama list' reports it; the namespaced form is this client's IDENTITY and is DERIVED from it, ` +
				`with the model digest appended. Set [${CONFIG_SECTION_NAME}].wireModel in ${configFilePath} to the ` +
				`bare name.`,
		);
	}
	return { endpointHostName, endpointPortNumber, wireModel, maxConcurrency, requestTimeoutMs, numPredict };
};

// ===== THE RESPONSE SIDE — MODULE-SCOPE AND PURE =====

// readJudgmentBody — the ONE place message.content is turned into an object. It reports two DIFFERENT kinds
// of fault through two different channels, because they are different
// faults with different operator responses (JUDGMENT_EXTRACTOR_SHAPE says so in as many words):
//   a body this provider CANNOT READ AS ITS OWN DIALECT -> a refusal STRING, naming the provider and what
//     was wrong, quoting what actually came back. Never repaired, never partially salvaged.
//   a body it CAN read but which lacks or violates a field -> an object, and the extractor reports that
//     field as `undefined` for the retry loop and then judgeComponent to deal with.
//
// ⟪WHY THIS IS A PARSE AND NOT A TEXTUAL READ, WITH EVIDENCE⟫ The JSON the model emits is well-formed but
// its INTERIOR FORMATTING IS RAGGED. Measured 2026-09-07 through this exact rendered schema (evidence file
// JOB3-gF3-liveOllamaProbe.txt): qwen2.5:32b separated two members with a newline, a space and two tabs
// BEFORE the comma, and put the third member on that same line, immediately after it. On the SECOND call it
// laid the identical three fields out differently again — the comma alone on the ragged line, the member on
// the next — and appended a blank line and three tabs AFTER the closing brace. JSON.parse does not care; any regex or line-oriented reading of that body would be
// tuned to one run's whitespace and would fail silently on the next. Parse, then validate against the
// contract. Never read the text.
const readJudgmentBody = (rawProviderResponse) => {
	const contentText =
		rawProviderResponse && rawProviderResponse.message ? rawProviderResponse.message.content : undefined;
	if (typeof contentText !== 'string' || !contentText.trim()) {
		return {
			refusal:
				`${moduleName}: the response envelope carried no message.content to read. This provider's whole ` +
				`answer arrives as a JSON string in that field; an envelope without one is not a judgment this ` +
				`client can read, and it is refused rather than treated as an empty verdict. ` +
				`(received ${JSON.stringify(rawProviderResponse)})`,
			judgmentObject: null,
		};
	}
	let judgmentObject = null;
	let parseFault = null;
	const attemptParse = () => {
		judgmentObject = JSON.parse(contentText);
	};
	try {
		attemptParse();
	} catch (thrown) {
		parseFault = thrown;
	}
	if (parseFault) {
		return {
			refusal:
				`${moduleName}: message.content is not JSON and cannot be read as a judgment (${parseFault.message}). ` +
				`The request constrained generation with a JSON schema, so a body that does not parse means the ` +
				`constraint did not hold — it is refused by name, never mined for an answer, because a judgment ` +
				`recovered from prose is a verdict nobody asserted. ` +
				`(received ${JSON.stringify(contentText.slice(0, 200))})`,
			judgmentObject: null,
		};
	}
	if (judgmentObject === null || typeof judgmentObject !== 'object' || Array.isArray(judgmentObject)) {
		return {
			refusal:
				`${moduleName}: message.content parsed as JSON but is not an object (got ` +
				`${JSON.stringify(judgmentObject)}). The schema declares an object with three named properties; ` +
				`anything else is refused rather than coerced.`,
			judgmentObject: null,
		};
	}
	return { refusal: '', judgmentObject };
};

// judgmentBodyRefusal — '' when the body is readable in this dialect, otherwise the refusal naming what was
// wrong. Exported so a hermetic test can exercise it with no construction, no config and no server.
const judgmentBodyRefusal = (rawProviderResponse) => readJudgmentBody(rawProviderResponse).refusal;

// makeJudgmentExtractor — a FACTORY, and the reason is the contract. JUDGMENT_EXTRACTOR_SHAPE declares
// arity 1 with argKeys ['rawProviderResponse'], but `choice` can only be judged against the PER-CALL
// choiceEnum. Closing over the enum keeps per-subject data out of a signature the contract fixes, instead
// of widening the signature and quietly breaking the declared shape.
//
// Every field is validated against the contract and NOTHING is reconstructed. An out-of-enum value is not
// nudged to a neighbour, a blank rationale is not a rationale, and prose containing something that looks
// like an answer yields nothing at all.
// ⟪JOB 4 / G4-f, 2026-09-07⟫ THE ENUM IS COPIED AND FROZEN AT FACTORY TIME, and both halves of that are
// load-bearing. selectCandidateSchema.js already sends a frozen COPY on the wire; this extractor used to
// close over the CALLER'S LIVE ARRAY and read it at answer time, so a caller that kept its reference could
// move the check without moving the constraint — the enum SENT and the enum CHECKED could disagree. The
// `.slice()` severs that reference; the `Object.freeze` protects the copy. Freezing without slicing would
// be a worse defect than the one repaired: it would reach back and freeze an array this module does not own.
// A non-array argument is passed through UNCHANGED so the Array.isArray guard below still answers it with
// `choice: undefined` rather than this factory throwing — the tolerance was there before and is preserved.
const makeJudgmentExtractor = (choiceEnum) => {
	const frozenChoiceEnum = Array.isArray(choiceEnum) ? Object.freeze(choiceEnum.slice()) : choiceEnum;
	return (rawProviderResponse) => {
		const { refusal, judgmentObject } = readJudgmentBody(rawProviderResponse);
		if (refusal) {
			return { choice: undefined, category: undefined, rationale: undefined };
		}
		const offeredChoice = `${judgmentObject.choice}`;
		const choice =
			Array.isArray(frozenChoiceEnum) && frozenChoiceEnum.indexOf(offeredChoice) !== -1
				? offeredChoice
				: undefined;
		// ⟪2026-09-10, OCEAN_SUMMIT⟫ membership in what the schema OFFERS, abstain category included; a pick
		// carrying 'none' is refused one level up by judgeComponent, not silently dropped here.
		const category =
			OFFERED_CATEGORY_ENUM.indexOf(judgmentObject.category) !== -1 ? judgmentObject.category : undefined;
		const rationale =
			typeof judgmentObject.rationale === 'string' && judgmentObject.rationale.trim()
				? judgmentObject.rationale
				: undefined;
		// ⟪v3⟫ the judge's own ranking, read back as strings, never repaired.
			// ⟪v5⟫ the ideas the judge found in the source element, read back verbatim, never repaired.
		const sourceElementIdeaList = Array.isArray(judgmentObject.sourceElementIdeaList)
			? judgmentObject.sourceElementIdeaList.map((oneEntry) => `${oneEntry}`)
			: undefined;
	// ⟪v7⟫ the judge's decomposition of every CANDIDATE, read back verbatim, never repaired.
	const candidateIdeaList = Array.isArray(judgmentObject.candidateIdeaList) ? judgmentObject.candidateIdeaList : undefined;
	// ⟪v8⟫ the coverage the judge computed for its own pick, read back verbatim, never repaired.
	const ideaCoverage = judgmentObject.ideaCoverage !== null && typeof judgmentObject.ideaCoverage === 'object' ? judgmentObject.ideaCoverage : undefined;
	const sortedCandidateList = Array.isArray(judgmentObject.sortedCandidateList)
			? judgmentObject.sortedCandidateList.map((oneEntry) => `${oneEntry}`)
			: undefined;
		return { choice, category, rationale, sourceElementIdeaList, candidateIdeaList, sortedCandidateList, ideaCoverage };
	};
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(constructionOptions = {}, constructionCallback) => {
		const { configFilePath = defaultConfigFilePath, componentOverrides = {} } = constructionOptions;

		// CONFIGURATION FAULTS THROW, here, synchronously, before any socket can exist. See the header.
		const cfg = resolveConfigOrThrow(configFilePath);

		// realFetchModelTagList — GET /api/tags. The ONLY network this file does outside a judgment, and the
		// componentOverrides seam (the same idiom llmClient's postOnce uses) lets a hermetic test construct a
		// real provider against a canned tag list with no server running.
		const realFetchModelTagList = (tagCallback) => {
			const req = http.request(
				{
					host: cfg.endpointHostName,
					port: cfg.endpointPortNumber,
					path: TAG_LIST_API_PATH,
					method: 'GET',
					timeout: TAG_PROBE_TIMEOUT_MS,
				},
				(res) => {
					let raw = '';
					res.on('data', (chunk) => {
						raw += chunk;
					});
					res.on('end', () => {
						let parsedTagList = null;
						let parseFault = null;
						const attemptParse = () => {
							parsedTagList = JSON.parse(raw);
						};
						try {
							attemptParse();
						} catch (thrown) {
							parseFault = thrown;
						}
						if (parseFault) {
							tagCallback(
								deadServerRefusalText({
									endpointHostName: cfg.endpointHostName,
									endpointPortNumber: cfg.endpointPortNumber,
									underlyingFault: `answered status ${res.statusCode} with a body that is not JSON`,
								}),
								null,
							);
							return;
						}
						tagCallback('', parsedTagList);
					});
				},
			);
			req.on('timeout', () => {
				req.destroy(new Error(`no answer within ${TAG_PROBE_TIMEOUT_MS}ms`));
			});
			req.on('error', (err) =>
				tagCallback(
					deadServerRefusalText({
						endpointHostName: cfg.endpointHostName,
						endpointPortNumber: cfg.endpointPortNumber,
						underlyingFault: err.message,
					}),
					null,
				),
			);
			req.end();
		};
		const fetchModelTagList = componentOverrides.fetchModelTagList || realFetchModelTagList;

		fetchModelTagList((tagListError, tagListBody) => {
			if (tagListError) {
				constructionCallback(tagListError, null);
				return;
			}
			const installedModelList = (tagListBody && tagListBody.models) || [];
			const installedModelRow = installedModelList.find((oneModel) => oneModel && oneModel.name === cfg.wireModel);
			if (!installedModelRow) {
				constructionCallback(
					`${moduleName}: the Ollama server at ${cfg.endpointHostName}:${cfg.endpointPortNumber} has no model ` +
						`named '${cfg.wireModel}'. It offers: ${installedModelList.map((oneModel) => oneModel && oneModel.name).join(', ') || '(none)'}. ` +
						`Pull it with 'ollama pull ${cfg.wireModel}', or correct [${CONFIG_SECTION_NAME}].wireModel. Refused by ` +
						`name rather than constructing an identity with nothing behind it.`,
					null,
				);
				return;
			}
			if (typeof installedModelRow.digest !== 'string' || installedModelRow.digest.length < MODEL_DIGEST_PREFIX_LENGTH) {
				constructionCallback(
					`${moduleName}: the tag-list entry for '${cfg.wireModel}' carries no usable digest ` +
						`(${JSON.stringify(installedModelRow.digest)}). The digest is part of this provider's IDENTITY — it ` +
						`is what makes a re-pulled model a different judge instead of the same one — so it is required ` +
						`rather than omitted.`,
					null,
				);
				return;
			}

			// THE NAMESPACED IDENTITY — derived, never configured. The judgment-cache key, the forensic
			// judgeModel, and the edge's mappingTool.
			const namespacedModel = namespacedModelFor(cfg.wireModel, installedModelRow.digest);

			// realPostOnce — one POST attempt -> callback(err, parsedBody, statusCode). The ONLY thing here that
			// touches the network during a judgment; componentOverrides.postOnce is the NET seam that lets a
			// hermetic test drive the REAL retry loop against a scripted sequence of canned responses.
			const realPostOnce = ({ payload }, postCallback) => {
				const body = JSON.stringify(payload);
				// the one bit the timeout refusal reports: was a socket ever granted? A boolean rather than a
				// timestamp, because this directory may hold no clock reading at all.
				let socketAssigned = false;
				const req = http.request(
					{
						host: cfg.endpointHostName,
						port: cfg.endpointPortNumber,
						path: CHAT_API_PATH,
						method: 'POST',
						timeout: cfg.requestTimeoutMs,
						headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
					},
					(res) => {
						let raw = '';
						res.on('data', (chunk) => {
							raw += chunk;
						});
						res.on('end', () => {
							let parsedEnvelope = null;
							let parseFault = null;
							const attemptParse = () => {
								parsedEnvelope = JSON.parse(raw);
							};
							try {
								attemptParse();
							} catch (thrown) {
								parseFault = thrown;
							}
							if (parseFault) {
								postCallback(`envelope not JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`, null, res.statusCode);
								return;
							}
							postCallback('', parsedEnvelope, res.statusCode);
						});
					},
				);
				req.on('socket', () => {
					socketAssigned = true;
				});
				req.on('timeout', () => {
					req.destroy(new Error(requestTimeoutRefusalText({ timeoutMs: cfg.requestTimeoutMs, socketAssigned })));
				});
				req.on('error', (err) => postCallback(`request error: ${err.message}`, null, 0));
				req.write(body);
				req.end();
			};
			const postOnce = componentOverrides.postOnce || realPostOnce;

			// rerank — { systemPrompt, userPrompt, choiceEnum, maxRetries } -> callback(err, { choice, category,
			// rationale, model, attempts, doneReason, retryReasons }). judgeComponent.js is the sole production
			// caller and reads choice, category and rationale.
			const rerank = (rerankOptions = {}, callback) => {
				const { systemPrompt, userPrompt, choiceEnum, maxRetries = 6 } = rerankOptions;
				// hasOwnProperty, not `!== undefined`: the fault is that the caller MENTIONED the retired option
				// at all. `true` and `false` are refused identically — there is no longer a value of it that
				// means anything, so accepting either would be accepting a lie.
				if (Object.prototype.hasOwnProperty.call(rerankOptions, OBSOLETE_JUDGMENT_FLAG_NAME)) {
					callback(`${moduleName}.rerank: ${obsoleteJudgmentFlagRefusalText(rerankOptions[OBSOLETE_JUDGMENT_FLAG_NAME])}`);
					return;
				}
				// THE SCHEMA IS NOT WRITTEN HERE. This is the ollama RENDERING of the one canonical schema, and
				// it goes straight into `format` — no tool wrapper, because this dialect has no tool call to name.
				const renderedSchema = renderSelectCandidateSchema(PROVIDER_NAME, { choiceEnum });
				const extractJudgment = makeJudgmentExtractor(choiceEnum);
				const payload = {
					model: cfg.wireModel,
					stream: false,
					format: renderedSchema,
					options: { temperature: 0, num_predict: cfg.numPredict },
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt },
					],
				};

				const backoffMs = [0, 500, 1200, 2500, 5000, 9000];
				const retryReasons = [];

				const tryAttempt = (attemptIndex) => {
					postOnce({ payload }, (err, parsedEnvelope, status) => {
						const retriableTransport = status === 429 || (status >= 500 && status <= 599) || status === 0;
						if ((err || retriableTransport) && attemptIndex + 1 < maxRetries) {
							retryReasons.push(`transport (attempt ${attemptIndex + 1}): ${err || `status ${status}`}`);
							setTimeout(() => tryAttempt(attemptIndex + 1), backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)]);
							return;
						}
						if (err) {
							callback(`${moduleName}.rerank failed after ${attemptIndex + 1} attempts: ${err}`);
							return;
						}
						if (status !== 200) {
							const serverMessage = parsedEnvelope && parsedEnvelope.error ? parsedEnvelope.error : `status ${status}`;
							callback(`${moduleName}.rerank API error (${status}): ${serverMessage}`);
							return;
						}
						// A body this provider cannot read AS ITS OWN DIALECT is refused by name, never mined.
						const bodyRefusal = judgmentBodyRefusal(parsedEnvelope);
						if (bodyRefusal && attemptIndex + 1 < maxRetries) {
							retryReasons.push(`unreadableBody (attempt ${attemptIndex + 1}): ${bodyRefusal}`);
							setTimeout(() => tryAttempt(attemptIndex + 1), backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)]);
							return;
						}
						if (bodyRefusal) {
							callback(`${moduleName}.rerank: ${bodyRefusal}`);
							return;
						}
						const { choice, category, rationale, sourceElementIdeaList, candidateIdeaList, sortedCandidateList, ideaCoverage } = extractJudgment(parsedEnvelope);
						// A choice that is absent or outside the per-call enum is REFUSED, never repaired. This
						// mirrors llmClient's own "could not extract a choice" arm: without a choice there is no
						// judgment at all, so there is nothing to pass on for judgeComponent to enforce against.
						if (choice === undefined && attemptIndex + 1 < maxRetries) {
							retryReasons.push(`choiceNotInEnum (attempt ${attemptIndex + 1})`);
							setTimeout(() => tryAttempt(attemptIndex + 1), backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)]);
							return;
						}
						if (choice === undefined) {
							callback(
								`${moduleName}.rerank: the response carried no choice inside the offered enum ` +
									`(${(choiceEnum || []).join(', ')}) after ${attemptIndex + 1} attempt(s). Refused rather than ` +
									`repaired: a choice the model did not make is not a judgment.`,
							);
							return;
						}
						// category/rationale incomplete -> RETRY, then pass through. This client does NOT itself
						// refuse on a missing rationale, deliberately and for the reason llmClient records: there is
						// exactly ONE enforcer of that contract, judgeComponent.js's judgeOne, and a second
						// differently-worded refusal for the identical fault is the ambiguity the ruling avoids.
						const judgmentIncomplete = category === undefined || rationale === undefined;
						if (judgmentIncomplete && attemptIndex + 1 < maxRetries) {
							retryReasons.push(
								`judgmentIncomplete (attempt ${attemptIndex + 1}): ` +
									`category ${category === undefined ? 'missing' : 'ok'}, rationale ${rationale === undefined ? 'missing' : 'ok'}`,
							);
							setTimeout(() => tryAttempt(attemptIndex + 1), backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)]);
							return;
						}
						callback('', {
							choice,
							// the IDENTITY, not the wire name — a CONTRACT MEMBER of rerank's result, which must
							// agree with client.model or one client would report two identities for one judgment.
							model: namespacedModel,
							attempts: attemptIndex + 1,
							category,
							rationale,
							// ⟪v3/v5, 2026-09-11⟫ the judge's own working, threaded up beside the verdict.
							sourceElementIdeaList,
							candidateIdeaList,
							sortedCandidateList,
							ideaCoverage,
							// the server's own accounting, threaded up ADDITIVELY for the forensic match log. Never
							// fabricated: an envelope without it yields null.
							doneReason: parsedEnvelope && parsedEnvelope.done_reason !== undefined ? parsedEnvelope.done_reason : null,
							evalCount: parsedEnvelope && parsedEnvelope.eval_count !== undefined ? parsedEnvelope.eval_count : null,
							retryReasons,
						});
					});
				};
				tryAttempt(0);
			};

			// describe() — INSTANCE-DERIVED, never a constant: it reports the wireModel THIS client resolved and
			// the identity derived from it, digest and all.
			const describe = () => ({ provider: PROVIDER_NAME, model: namespacedModel, version: CLIENT_VERSION });

			// THE JUDGE PROVIDER, satisfying JUDGE_PROVIDER_SHAPE. `endpoint` is this client's own extra and is
			// not part of the contract; wireModel is exposed rather than hidden so an operator can SEE what went
			// on the wire.
			constructionCallback('', {
				name: PROVIDER_NAME,
				wireModel: cfg.wireModel,
				model: namespacedModel,
				maxConcurrency: cfg.maxConcurrency,
				rerank,
				describe,
				endpoint: `${cfg.endpointHostName}:${cfg.endpointPortNumber}`,
			});
		});
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
// static, config-independent exports (module-scope, not per-instance) — a hermetic test exercises the REAL
// extraction and refusal logic against a mocked Ollama envelope without constructing a client.
module.exports.makeJudgmentExtractor = makeJudgmentExtractor;
module.exports.judgmentBodyRefusal = judgmentBodyRefusal;
module.exports.PROVIDER_NAME = PROVIDER_NAME;
module.exports.MODEL_NAMESPACE_SEPARATOR = MODEL_NAMESPACE_SEPARATOR;
module.exports.MODEL_DIGEST_SEPARATOR = MODEL_DIGEST_SEPARATOR;
module.exports.MODEL_DIGEST_PREFIX_LENGTH = MODEL_DIGEST_PREFIX_LENGTH;
module.exports.namespacedModelFor = namespacedModelFor;
module.exports.CLIENT_VERSION = CLIENT_VERSION;
module.exports.requestTimeoutRefusalText = requestTimeoutRefusalText;
module.exports.OBSOLETE_JUDGMENT_FLAG_NAME = OBSOLETE_JUDGMENT_FLAG_NAME;
module.exports.CONFIG_SECTION_NAME = CONFIG_SECTION_NAME;
