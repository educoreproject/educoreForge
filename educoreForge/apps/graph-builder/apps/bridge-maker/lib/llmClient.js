'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// llmClient.js — the REAL Anthropic Messages client for the INFERRED-track RERANKER (P3b). FAITHFUL PORT of
// the incumbent npm/qtools-graph-forge-core/lib/llm-client/llm-client.js into the recreation, repointed at
// this project's [anthropicAi] .ini (env ANTHROPIC_API_KEY remains the alternative key source). It forces a
// single structured tool call so the model emits a constrained `choice` (a candidate index OR 'NONE'),
// exactly the json_schema-choice contract inferencePipeline.js consumes: it calls
//   llmClient.rerank({ systemPrompt, userPrompt, choiceEnum }, cb)  and reads only  cb('', { choice }).
// The extra returned keys ({ model, attempts }) are harmless surplus the pipeline ignores — the contract is
// met precisely on `choice`. The key is NEVER logged, echoed, or returned.
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
// invalid_request_error 'temperature is deprecated'); temperature 0 is sent for other models. Robust answer
// extraction (structured tool input.choice -> embedded "choice" regex -> bare NONE -> first in-range integer)
// mirrors the measured harness so parse failures stay at ~0.
//
// Native https + callbacks (no qtools HTTP-to-Anthropic library exists). No async/await, no try/catch for
// control flow (a JSON.parse guard is the one local exception, isolated to parsing the response body).
// camelCase only.
//
// ⟪R-a WIRING — bridgeEvidenceRefactor-spec.md §7 P4, the P3 boundary review's named rider⟫. P3's
// lib.d/evidenceSelect.js proved the {choice, category, rationale} response shape ⟪A4⟫'s discrete
// verdict category requires, but only against a hermetic STUB llmClient — the live client (this file)
// did not yet emit category/rationale. P4 wires it: the `select_candidate` tool's input_schema now ALSO
// declares `category` (CATEGORY_ENUM below — SELECT_CATEGORY_ENUM's three non-abstain values; 'none' is
// never a category a MODEL asserts about its own pick — abstain is expressed via choice='NONE', not a
// category value) and `rationale` (free text), and `rerank`'s callback result carries them alongside
// `choice` when the model's tool call populated them. ADDITIVE, per the rider's own instruction:
//   - `required` stays `['choice']` — a model that omits category/rationale (or the scalar path's own
//     SYSTEM_PROMPT, lib.d/selector.js, which never asks for them at all) still gets a valid tool call.
//   - extractCategoryAndRationale has NO free-text fallback (unlike extractChoice's (b)/(c)/(d) paths):
//     category/rationale are read ONLY from the structured tool_use input; a model that did not report
//     them yields `undefined` for both, never a fabricated value (polyArch2 §6 — refuse/omit, don't guess).
//   - lib.d/selector.js destructures ONLY `.choice` off this callback's result and is therefore
//     completely unaffected by these two additional, optional keys — proven in test-selector.js
//     (byte-unchanged) and test-llm-client.js's own R-a section.
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

// ⟪R-a THIRD REAL-RUN FINDING, 2026-07-30⟫ ROOT CAUSE of all three prior live failures, found by a code
// read after two blind fixes: cfg.maxTokens defaults to 64 (config-overridable; the deployed
// [anthropicAi].ini evidently never raises it). tool_choice is FORCED, so the model emits
// {choice, category, rationale} as ONE tool_use block and is TRUNCATED at 64 tokens — choice+category
// (short, early keys) survive; rationale (a full sentence, emitted last) is the one that gets cut. This
// is DETERMINISTIC per prompt (not model sloppiness), which is exactly why requireJudgment's schema
// `required` and the retry-on-malformed-judgment loop (both real, both correct) could not reach 100% on
// their own: retrying a token budget that is structurally too small reproduces the identical truncation.
// JUDGMENT_MAX_TOKENS — sized generously: a one-sentence rationale runs roughly 30-60 tokens, plus the
// tool-call JSON structural overhead (field names, quoting, the enum string) and a safety margin for a
// longer sentence — 400 is comfortable headroom, never approached by the scalar {choice}-only path (64
// was correctly sized for THAT, and can never hold a rationale; this constant does not touch it).
const JUDGMENT_MAX_TOKENS = 400;

// ⟪R-a⟫ CATEGORY_ENUM — DERIVED from SELECT_CATEGORY_ENUM (evidenceContracts.js §5, the single source of
// truth), never a hand-restated literal (boundary-review finding, 2026-07-30: a second, near-identical
// literal here was exactly the "third source of truth at the boundary we just declared single-source" the
// review flagged). The SEMANTIC split is legitimate and stays: SELECT_CATEGORY_ENUM is the full contract
// enum, including 'none' (the abstain verdict evidenceSelect.js itself synthesizes when the LLM's choice is
// 'NONE' — see judgeRenderedPool's `category: 'none'` literal there); CATEGORY_ENUM here is the narrower
// PICK-ONLY set this tool schema OFFERS THE MODEL, because a model reports a category only when it IS
// making a pick — abstain is expressed through `choice='NONE'`, never through a category value asserted
// about a pick that does not exist. Filtering 'none' out at the derivation site (rather than restating the
// three remaining values by hand) means SELECT_CATEGORY_ENUM gaining or renaming a category can never
// silently drift out of sync with what this tool schema offers.
const CATEGORY_ENUM = SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== 'none');

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

// ⟪R-a REAL-RUN FIX⟫ buildTool — MODULE-SCOPE, pure (no cfg/key/network): builds the `select_candidate`
// tool definition (name/description/input_schema) for EITHER variant. Hoisted out of `rerank` for the
// SAME reason extractChoice/extractCategoryAndRationale were: a hermetic test inspects the CONSTRUCTED
// schema directly — no construction, no key, no network, no https.request ever attempted — proving the
// scalar variant's `required` list is unchanged and the evidence variant's `required` list carries
// category+rationale, without needing to intercept or mock the transport layer at all.
//   requireJudgment falsy -> the SCALAR variant: required: ['choice'] only (byte-identical to pre-fix).
//   requireJudgment: true -> the EVIDENCE variant: required: ['choice', 'category', 'rationale'].
// Assumes requireJudgment has ALREADY been refuse-by-value-checked (rerank's own guard, above it in the
// file) — this function itself does not re-validate, matching extractChoice/extractCategoryAndRationale's
// own "trust the caller already gated" posture for a pure, internal builder.
const buildTool = ({ choiceEnum, requireJudgment } = {}) => {
	const requiredFields = requireJudgment ? ['choice', 'category', 'rationale'] : ['choice'];
	return {
		name: TOOL_NAME,
		description: requireJudgment
			? 'Record the single best matching CEDS candidate by its number, or NONE if no candidate is a ' +
				'correct match. You MUST ALSO record a discrete confidence CATEGORY for the choice (never a ' +
				'numeric probability) and a short RATIONALE for the choice — both are REQUIRED whenever ' +
				'choice is a candidate number.'
			: 'Record the single best matching CEDS candidate by its number, or NONE if no candidate is a correct match. ' +
				'Also record a discrete confidence CATEGORY for the choice (never a numeric probability) and a short ' +
				'RATIONALE, whenever the choice is a candidate number (omit category/rationale when choice is NONE).',
		input_schema: {
			type: 'object',
			properties: {
				choice: {
					type: 'string',
					enum: choiceEnum,
					description: 'The chosen candidate number, or the string NONE.',
				},
				// ⟪R-a⟫ under the SCALAR variant (requireJudgment falsy) these two are NOT in `required`
				// below — lib.d/selector.js's own SYSTEM_PROMPT never asks for them, so it still gets a
				// valid tool call with only `choice` populated. Under the EVIDENCE variant
				// (requireJudgment: true) both are REQUIRED — see requiredFields above.
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
			required: requiredFields,
			additionalProperties: false,
		},
	};
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ configFilePath = defaultConfigFilePath, model: modelOverride, componentOverrides = {} } = {}) => {
		const { xLog } = process.global;

		// resolve key/model/version from ini, with env as the alternative key source (never logged).
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
				model: modelOverride || iniConfig.model || 'claude-opus-4-8',
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

		// one POST attempt -> callback(err, parsedBody, statusCode). realPostOnce is the ONLY thing in this
		// file that touches the network; componentOverrides.postOnce (the NET seam, the SAME
		// componentOverrides idiom kitLoader.buildKit/bridgeMaker.run use for their own doubles) lets a
		// hermetic test drive the REAL retry/backoff loop below — including the NEW malformed-judgment
		// retry — against a scripted SEQUENCE of canned responses, without ever constructing a real
		// https.request. Production callers never pass this; it defaults to the real transport.
		const realPostOnce = ({ payload }, callback) => {
			const body = JSON.stringify(payload);
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
			req.on('timeout', () => {
				// destroy() fires the 'error' handler below with this message -> status 0 (retriable).
				req.destroy(new Error(`no response within ${cfg.requestTimeoutMs}ms (request timeout)`));
			});
			req.on('error', (err) => callback(`request error: ${err.message}`, null, 0));
			req.write(body);
			req.end();
		};
		const postOnce = componentOverrides.postOnce || realPostOnce;

		// ⟪R-a REAL-RUN FINDING, 2026-07-30⟫ a live LIF --rebridge against real Opus failed in Phase C:
		// "evidenceSelect: llmClient did not supply a rationale for its pick — refusing rather than
		// fabricating one." Root cause: category/rationale were OPTIONAL in the ONE shared tool schema
		// (correctly additive for the scalar path, whose SYSTEM_PROMPT never asks for them at all) — but
		// real Opus, unlike the hermetic stub, omits optional fields it is not textually pressed to supply.
		// evidenceSelect.js's refusal fired EXACTLY as designed (⟪A4⟫ — never fabricate a missing
		// category/rationale); the fix is a stricter REQUEST, not a laxer downstream check.
		//
		// requireJudgment (rerank's new, explicit, call-time option) selects between TWO tool-schema
		// variants — NEVER inferred by sniffing the prompt (the ruling's own instruction: an explicit
		// option is legible at the call site; prompt-sniffing is exactly the kind of implicit coupling
		// this tree's refuse-by-value discipline exists to avoid):
		//   requireJudgment falsy (default)  — the SCALAR variant, BYTE-IDENTICAL to before this fix:
		//     required: ['choice'] only. lib.d/selector.js never passes requireJudgment, so its own
		//     request/response shape is completely unchanged (proven in test-selector.js, byte-unchanged).
		//   requireJudgment: true            — the EVIDENCE variant: required: ['choice','category',
		//     'rationale']. lib.d/evidenceSelect.js requests this on EVERY call (see its own header).
		// Refuse-by-value: requireJudgment must be boolean when given, or omitted — there is no default
		// coercion of a truthy-but-not-boolean value.
		//
		// ENFORCEMENT LAYER, decided here so there is exactly ONE, never an ambiguous double-refusal:
		// this file does NOT itself refuse a response that omits category/rationale under the evidence
		// variant — it builds the stricter REQUEST and passes through whatever the model actually
		// returned (still `undefined` when omitted, never fabricated, exactly as extractCategoryAndRationale
		// already documented). lib.d/evidenceSelect.js's own judgeRenderedPool is THE enforcer: it already
		// refuses BY NAME ("did not supply a rationale for its pick") when a pick lacks one, and that
		// refusal fired CORRECTLY in the live run above — the bug was never in evidenceSelect's judgment,
		// only in how forcefully the API request asked the model to comply. Making llmClient.js ALSO
		// refuse on the same condition would be a second, differently-worded error for the identical
		// fault, exactly the ambiguity the ruling asked to avoid.
		//
		// rerank — { systemPrompt, userPrompt, choiceEnum, requireJudgment } -> callback(err, { choice,
		//   model, attempts, category, rationale }). choiceEnum: e.g. ['1','2',...,'15','NONE']. Retries
		//   (6) with backoff on 429/5xx/network. lib.d/selector.js (the scalar path) reads ONLY
		//   result.choice; model/attempts/category/rationale are surplus it ignores.
		const rerank = ({ systemPrompt, userPrompt, choiceEnum, maxRetries = 6, requireJudgment } = {}, callback) => {
			if (!cfg.apiKey) {
				// unreachable in normal use (construction already threw), kept as defense-in-depth.
				callback(`${moduleName}: no Anthropic API key ([anthropicAi].apiKey or ANTHROPIC_API_KEY)`);
				return;
			}
			if (requireJudgment !== undefined && typeof requireJudgment !== 'boolean') {
				callback(
					`${moduleName}.rerank: requireJudgment must be a boolean when given (got ` +
						`${JSON.stringify(requireJudgment)}) — there is no default coercion.`,
				);
				return;
			}
			const tool = buildTool({ choiceEnum, requireJudgment });
			// ⟪R-a THIRD REAL-RUN FIX⟫ under requireJudgment, raise the budget to the max of the
			// configured value and JUDGMENT_MAX_TOKENS — never LOWER cfg.maxTokens if an operator already
			// configured something bigger than 400, only ever raise a too-small default. The scalar variant
			// is BYTE-UNCHANGED: max_tokens stays exactly cfg.maxTokens, precisely as before this fix.
			const maxTokens = requireJudgment ? Math.max(cfg.maxTokens, JUDGMENT_MAX_TOKENS) : cfg.maxTokens;
			const payload = {
				model: cfg.model,
				max_tokens: maxTokens,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				tools: [tool],
				tool_choice: { type: 'tool', name: TOOL_NAME },
			};
			// claude-opus-4-8 rejects temperature; send 0 for everything else (the measured fix).
			if (!/^claude-opus-4/.test(cfg.model)) {
				payload.temperature = 0;
			}

			const backoffMs = [0, 500, 1200, 2500, 5000, 9000];
			// ⟪R-a SECOND REAL-RUN FINDING, 2026-07-30⟫ requireJudgment alone (schema `required`) did not
			// reach 100%: a live run failed on a DIFFERENT source than the first finding, with the
			// identical refusal — real Opus INTERMITTENTLY omits a schema-required field (roughly 1 call in
			// several dozen, not a hard, every-time violation). DESIGN RULING: validate-and-retry AT THE
			// CLIENT, refuse AT THE CONSUMER. Under requireJudgment, a response whose category is missing/
			// invalid-enum OR whose rationale is missing/blank joins the SAME retry loop the network-status
			// conditions already drive above (same backoff table, same maxRetries cap — no second budget).
			// On EXHAUSTION, this returns whatever came back (category/rationale possibly still undefined)
			// via the NORMAL success callback — it does NOT fabricate and does NOT itself refuse; that is
			// STILL lib.d/evidenceSelect.js's job alone (see this file's own R-a header, unchanged: exactly
			// ONE enforcer). The scalar variant (requireJudgment falsy) never evaluates this condition —
			// byte-unchanged behavior, omission is legal there.
			const tryAttempt = (attemptIndex) => {
				postOnce({ payload }, (err, parsed, status) => {
					const retriableTransport = status === 429 || (status >= 500 && status <= 599) || status === 0;
					if ((err || retriableTransport) && attemptIndex + 1 < maxRetries) {
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
					// ⟪R-a THIRD REAL-RUN FIX⟫ BELT: parsed.stop_reason === 'max_tokens' under requireJudgment
					// means the model's tool_use JSON was cut off mid-emission — the SAME structural fault
					// judgmentIncomplete already catches (rationale, emitted last, is what gets truncated),
					// folded into the identical condition so it is counted the SAME way, not mistaken for
					// ordinary model sloppiness. With JUDGMENT_MAX_TOKENS's headroom this should never fire;
					// if it ever does, it stays VISIBLE in `attempts` rather than silently masquerading as a
					// missing-field omission.
					const truncated = !!requireJudgment && parsed && parsed.stop_reason === 'max_tokens';
					const judgmentIncomplete = !!requireJudgment && (category === undefined || rationale === undefined || truncated);
					if (judgmentIncomplete && attemptIndex + 1 < maxRetries) {
						const waitMs = backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)];
						setTimeout(() => tryAttempt(attemptIndex + 1), waitMs);
						return;
					}
					callback('', { choice, model: cfg.model, attempts: attemptIndex + 1, category, rationale });
				});
			};
			tryAttempt(0);
		};

		return { rerank, model: cfg.model, keySource: cfg.keySource };
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
