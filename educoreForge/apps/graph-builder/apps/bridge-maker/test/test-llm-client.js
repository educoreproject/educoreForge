#!/usr/bin/env node
'use strict';

// test-llm-client.js — the HERMETIC gate for the ported REAL Anthropic reranker llmClient (P3b, + P4
// rider R-a). It proves CONSTRUCTION and SHAPE, and the §6 keyless-refusal — WITHOUT EVER calling the
// REAL API (no https.request is ever constructed anywhere in this suite). Sections A-E never invoke
// rerank() at all; section F DOES invoke the real rerank()/retry/backoff logic, but ONLY against an
// INJECTED componentOverrides.postOnce double (the NET seam llmClient.js itself now exposes for exactly
// this) — still zero network, zero real Opus. The one real Opus call belongs to the parent's real
// --rebridge run, not this suite (§3 hard line 2).
//
// Proves:
//   A. CONSTRUCTS with a key present (supplied via env for determinism, NOT the real ini/key) and exposes the
//      rerank({systemPrompt,userPrompt,choiceEnum}, cb) contract inferencePipeline.js calls, plus model +
//      keySource. Never touches the network.
//   B. THROWS BY NAME at construction when NO key resolves (no ini, no env) — the §6 no-silent-default seam
//      the recreation adds over the incumbent. Observed red->green (see the three-state note at the bottom).
//   C. a model OVERRIDE is honoured (so the caller can SEE/steer the model that will be sent).
//   D. ⟪R-a⟫ — bridgeEvidenceRefactor-spec.md §7 P4, the P3 boundary review's named rider: the extraction
//      logic (extractChoice/extractCategoryAndRationale, hoisted to module scope for exactly this) reads
//      {choice, category, rationale} off a MOCKED Anthropic response-body shape — no real API call, per
//      this rider's own instruction ("mock the Anthropic response shape; no real API call"). Proves the
//      additive contract: category/rationale populate when the model's tool call carries them; are
//      `undefined` (never fabricated) when it does not; an invalid category is refused (undefined, not
//      coerced); and lib.d/selector.js's own {choice}-only contract is UNCHANGED — selector.js reads
//      nothing but `.choice`, so these two additional keys are invisible to it.
//   E. ⟪R-a REAL-RUN FIX, 2026-07-30⟫ — a live LIF --rebridge against real Opus omitted the rationale
//      for a pick (evidenceSelect.js's own refusal fired correctly; the API request wasn't insistent
//      enough). buildTool (hoisted to module scope for the SAME hermetic-inspection reason as D) is
//      proven in BOTH variants: requireJudgment falsy -> the SCALAR variant, required:['choice'] ONLY,
//      BYTE-IDENTICAL to pre-fix (lib.d/selector.js never passes requireJudgment); requireJudgment:true
//      -> the EVIDENCE variant, required:['choice','category','rationale']. Also proves requireJudgment
//      is refuse-by-value (a non-boolean is refused, never coerced) and documents/tests the ENFORCEMENT
//      LAYER decision: llmClient.js does NOT itself refuse a response missing category/rationale under
//      the evidence variant — lib.d/evidenceSelect.js's own judgeRenderedPool remains the ONE enforcer
//      (proven directly in test-evidenceSelect.js), so this file only proves the REQUEST is stricter.
//   F. ⟪R-a SECOND REAL-RUN FINDING, 2026-07-30⟫ — a SECOND live run failed identically but on a
//      DIFFERENT source: real Opus omits a schema-required field INTERMITTENTLY, so requireJudgment's
//      schema alone cannot reach 100%. DESIGN RULING: validate-and-retry AT THE CLIENT, refuse AT THE
//      CONSUMER. Drives the REAL rerank()/tryAttempt retry-and-backoff logic against an INJECTED
//      componentOverrides.postOnce double (a scripted response SEQUENCE) — never a real https.request.
//      Proves: (a) evidence variant, first response missing rationale + second complete -> rerank
//      succeeds, attempts reflects the retry; (b) all attempts malformed -> returns successfully with
//      undefined judgment fields (NEVER an error — evidenceSelect's own refusal is what catches this
//      downstream, proven separately in test-evidenceSelect.js); (c) scalar variant -- a missing
//      category/rationale is NEVER retried (attempts stays 1) — omission is legal there, byte-unchanged.
//   G. ⟪R-a THIRD REAL-RUN FINDING, 2026-07-30⟫ — ROOT CAUSE, found by a code read: cfg.maxTokens
//      defaults to 64; tool_choice is FORCED, so the model's {choice,category,rationale} tool_use JSON is
//      TRUNCATED at 64 tokens — rationale (emitted last) is what gets cut, DETERMINISTICALLY per prompt,
//      which is why sections E/F's real fixes could not reach 100% alone. Proves: the evidence variant's
//      outgoing payload carries max_tokens >= JUDGMENT_MAX_TOKENS (400) while the scalar variant's stays
//      at the configured/64 value, UNCHANGED; and a mocked stop_reason='max_tokens' response under
//      requireJudgment is treated as the SAME retryable-malformed condition as a missing field.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-llm-client.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the ported Anthropic reranker llmClient (construction/shape/§6 refusal)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the ported llmClient CONSTRUCTS and exposes the rerank contract inferencePipeline.js calls, and
     that it REFUSES BY NAME at construction when no key resolves. Never makes an https request; rerank is
     never called. No network, no key file read (the success case supplies a throwaway key via env).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const llmClientFactory = require('../lib/llmClient');
const { SELECT_CATEGORY_ENUM } = require('../lib/evidenceContracts');

const NONEXISTENT_INI = '/nonexistent/definitely-no-anthropic-config.ini';

// a throwaway key used ONLY to exercise the construction/shape path deterministically; it is never sent
// anywhere because rerank is never called. Save/restore the real env around each case so the suite process
// is left exactly as found.
const savedEnvKey = process.env.ANTHROPIC_API_KEY;

// =====================================================================
harness.section('A — CONSTRUCTS + exposes the rerank contract (key via env; NO network, NO real ini)');
// =====================================================================
process.env.ANTHROPIC_API_KEY = 'sk-test-throwaway-never-sent';
const client = llmClientFactory({ configFilePath: NONEXISTENT_INI });
harness.ok('client constructs when a key resolves', !!client);
harness.ok('exposes rerank as a function (the pipeline calls llmClient.rerank({systemPrompt,userPrompt,choiceEnum}, cb))', typeof client.rerank === 'function');
harness.equal('default model is claude-opus-4-8', client.model, 'claude-opus-4-8');
harness.equal('keySource reports env (the alternative source, resolved without touching the real ini)', client.keySource, 'env');
harness.ok('the key is NEVER exposed on the returned client (no apiKey property)', client.apiKey === undefined && Object.keys(client).indexOf('apiKey') === -1);

// =====================================================================
harness.section('C — a model OVERRIDE is honoured');
// =====================================================================
const overridden = llmClientFactory({ configFilePath: NONEXISTENT_INI, model: 'claude-3-5-sonnet-latest' });
harness.equal('model override flows to client.model', overridden.model, 'claude-3-5-sonnet-latest');

// =====================================================================
harness.section('B — §6 REFUSAL: throws BY NAME at construction when no key resolves (no ini, no env)');
// =====================================================================
delete process.env.ANTHROPIC_API_KEY;
let threw = null;
const attemptKeyless = () => llmClientFactory({ configFilePath: NONEXISTENT_INI });
try {
	attemptKeyless();
} catch (e) {
	threw = e;
}
harness.ok('construction with no key THROWS (never constructs a silently-no-op client)', !!threw);
harness.match('  the throw NAMES the missing key sources ([anthropicAi].apiKey / ANTHROPIC_API_KEY)', threw ? `${threw.message}` : '', /ANTHROPIC_API_KEY[\s\S]*|anthropicAi[\s\S]*apiKey|apiKey[\s\S]*ANTHROPIC_API_KEY/);
harness.match('  and names the module (llmClient) so the fault is locatable', threw ? `${threw.message}` : '', /llmClient/);

// restore the process env exactly as found (the success case set it; the refusal case deleted it).
if (savedEnvKey === undefined) {
	delete process.env.ANTHROPIC_API_KEY;
} else {
	process.env.ANTHROPIC_API_KEY = savedEnvKey;
}

// THREE-STATE (§ method): the §6 refusal (B) was observed RED by commenting out the construction-time
// `if (!cfg.apiKey) throw` in llmClient.js — construction then returned a no-op client and B's 'throws'
// assertion failed; restoring the throw returns green. The factory-selection red (stub vs real) is observed
// in test-build.js's FACTORY SELECTION section against resolveInferenceConfig.

// =====================================================================
harness.section('D — ⟪R-a⟫ extractCategoryAndRationale/extractChoice against a MOCKED Anthropic response shape');
// =====================================================================
// mockToolUseResponse — the SHAPE api.anthropic.com/v1/messages returns for a forced tool call
// (content: [{type:'tool_use', name, input}]) — hand-built here, never a real HTTP response.
const mockToolUseResponse = (input) => ({
	content: [{ type: 'tool_use', name: llmClientFactory.TOOL_NAME, input }],
});

harness.equal('TOOL_NAME is the same tool name the payload/extraction both key off', llmClientFactory.TOOL_NAME, 'select_candidate');
harness.equal('CATEGORY_ENUM is the three non-abstain categories only (no "none" — see file header)', llmClientFactory.CATEGORY_ENUM.join(','), 'strong,moderate,weakButReal');

// boundary-review finding (2026-07-30): CATEGORY_ENUM must be a DERIVATION of SELECT_CATEGORY_ENUM (the
// evidenceContracts.js single source of truth), never a second hand-restated literal — this assertion is
// the red future drift cannot pass without: if SELECT_CATEGORY_ENUM ever gains/renames a category and
// llmClient.js's derivation is not updated (or someone re-hardcodes CATEGORY_ENUM as a fresh literal), this
// fails immediately, by name.
harness.equal(
	'CATEGORY_ENUM DERIVES from SELECT_CATEGORY_ENUM (equals the contract enum minus "none"), never a restated literal',
	llmClientFactory.CATEGORY_ENUM.join(','),
	SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== 'none').join(','),
);

// D1 — a full, well-formed tool call: choice + category + rationale all extract.
(() => {
	const mocked = mockToolUseResponse({ choice: '2', category: 'strong', rationale: 'the definitions align exactly' });
	harness.equal('D1: extractChoice reads choice off the mocked tool_use block', llmClientFactory.extractChoice(mocked, ['1', '2', 'NONE']), '2');
	const { category, rationale } = llmClientFactory.extractCategoryAndRationale(mocked);
	harness.equal('D1: extractCategoryAndRationale reads category', category, 'strong');
	harness.equal('D1: extractCategoryAndRationale reads rationale', rationale, 'the definitions align exactly');
})();

// D2 — a NONE choice with no category/rationale (the abstain case — the tool schema does not require
// them; the file header explains why 'none' is never itself a category value).
(() => {
	const mocked = mockToolUseResponse({ choice: 'NONE' });
	harness.equal('D2: extractChoice reads NONE', llmClientFactory.extractChoice(mocked, ['1', '2', 'NONE']), 'NONE');
	const { category, rationale } = llmClientFactory.extractCategoryAndRationale(mocked);
	harness.ok('D2: category is undefined, never fabricated', category === undefined);
	harness.ok('D2: rationale is undefined, never fabricated', rationale === undefined);
})();

// D3 — an INVALID category (not in CATEGORY_ENUM) is refused (undefined), never coerced or passed through.
(() => {
	const mocked = mockToolUseResponse({ choice: '1', category: 'super-duper-sure', rationale: 'x' });
	const { category } = llmClientFactory.extractCategoryAndRationale(mocked);
	harness.ok('D3: an invalid category is refused (undefined), never silently accepted', category === undefined);
})();

// D4 — a response with no tool_use block at all (a model that free-texted instead): choice falls back
// through extractChoice's text paths (unchanged behavior); category/rationale have NO such fallback and
// are honestly undefined (the file header's documented asymmetry).
(() => {
	const noToolResponse = { content: [{ type: 'text', text: 'I choose NONE, nothing matches.' }] };
	harness.equal('D4: extractChoice still recovers NONE via the bare-token fallback', llmClientFactory.extractChoice(noToolResponse, ['1', 'NONE']), 'NONE');
	const { category, rationale } = llmClientFactory.extractCategoryAndRationale(noToolResponse);
	harness.ok('D4: category is undefined with no tool_use block (no free-text fallback for it)', category === undefined);
	harness.ok('D4: rationale is undefined with no tool_use block', rationale === undefined);
})();

// D5 — PROOF selector.js's {choice}-only contract is unbroken: a rerank-shaped result carrying the two
// additional keys, read the way selector.js itself reads it (destructuring ONLY .choice), is unaffected.
(() => {
	const rerankResultShape = { choice: '1', model: 'claude-opus-4-8', attempts: 1, category: 'strong', rationale: 'x' };
	const { choice } = rerankResultShape;
	harness.equal("D5: selector.js's own destructure (choice only) still works with the additive keys present", choice, '1');
})();

// =====================================================================
harness.section('E — ⟪R-a REAL-RUN FIX⟫ buildTool: the SCALAR vs EVIDENCE tool-schema variants (requireJudgment)');
// =====================================================================
const CHOICE_ENUM_FIXTURE = ['1', '2', 'NONE'];

// E1 — the SCALAR variant (requireJudgment omitted/falsy) is BYTE-IDENTICAL to pre-fix: required:['choice'] only.
(() => {
	const scalarTool = llmClientFactory.buildTool({ choiceEnum: CHOICE_ENUM_FIXTURE });
	harness.equal('E1: scalar variant (requireJudgment omitted) required is EXACTLY ["choice"]', scalarTool.input_schema.required.join(','), 'choice');
	const scalarToolFalse = llmClientFactory.buildTool({ choiceEnum: CHOICE_ENUM_FIXTURE, requireJudgment: false });
	harness.equal('  scalar variant (requireJudgment:false) is the SAME', scalarToolFalse.input_schema.required.join(','), 'choice');
	harness.equal('  choice enum passed through unchanged', scalarTool.input_schema.properties.choice.enum.join(','), CHOICE_ENUM_FIXTURE.join(','));
	harness.equal('  category/rationale properties still DECLARED (a caller may still supply them) but NOT required', scalarTool.input_schema.properties.category.type, 'string');
})();

// E2 — the EVIDENCE variant (requireJudgment:true) requires category AND rationale alongside choice.
(() => {
	const evidenceTool = llmClientFactory.buildTool({ choiceEnum: CHOICE_ENUM_FIXTURE, requireJudgment: true });
	harness.equal(
		'E2: evidence variant (requireJudgment:true) required is EXACTLY ["choice","category","rationale"]',
		evidenceTool.input_schema.required.join(','),
		'choice,category,rationale',
	);
	harness.ok('  the evidence variant\'s description explicitly states category/rationale are REQUIRED', evidenceTool.description.includes('REQUIRED'));
	harness.equal('  the tool NAME is the same across both variants (one tool, two request strictness levels)', evidenceTool.name, llmClientFactory.TOOL_NAME);
})();

// E3 — requireJudgment is refuse-by-value: a non-boolean is refused at rerank's own call-time guard,
// never silently coerced. Proven WITHOUT calling rerank() (which would attempt a real https.request) by
// re-deriving the identical guard condition rerank's own source states (documented, not duplicated logic
// — the guard itself is one line, read directly off the shipped function's source to prove it exists).
(() => {
	const clientSourceHasGuard = /requireJudgment !== undefined && typeof requireJudgment !== 'boolean'/.test(
		require('fs').readFileSync(require.resolve('../lib/llmClient'), 'utf8'),
	);
	harness.ok('E3: rerank\'s source carries the refuse-by-value guard for a non-boolean requireJudgment', clientSourceHasGuard);
})();

// =====================================================================
harness.section('E (cont.) — ENFORCEMENT LAYER: llmClient.js does NOT itself refuse missing category/rationale');
// =====================================================================
// documented, tested DIRECTLY: extractCategoryAndRationale (the ONLY place llmClient.js reads
// category/rationale out of a response) returns undefined on absence/invalidity REGARDLESS of which
// tool-schema variant produced the response — it never raises an error itself. The refusal for "a pick
// with no rationale" belongs ENTIRELY to lib.d/evidenceSelect.js's judgeRenderedPool (proven directly in
// test-evidenceSelect.js's own RED section) — exactly ONE enforcer, never a second here.
(() => {
	const evidenceVariantResponseMissingRationale = mockToolUseResponse({ choice: '1', category: 'strong' });
	const { category, rationale } = llmClientFactory.extractCategoryAndRationale(evidenceVariantResponseMissingRationale);
	harness.equal('category still extracts', category, 'strong');
	harness.ok('rationale is undefined — llmClient.js reports the omission honestly, it does NOT refuse/throw here', rationale === undefined);
})();

// =====================================================================
harness.section('F — ⟪R-a SECOND REAL-RUN FINDING⟫ retry-on-malformed-judgment, via an INJECTED postOnce double (real retry/backoff logic, ZERO network)');
// =====================================================================
// componentOverrides.postOnce is the NET seam llmClient.js now exposes (mirrors kitLoader.buildKit's own
// componentOverrides idiom) — these three cases drive the REAL rerank()/tryAttempt retry loop, including
// the REAL setTimeout backoff between attempts, against a SCRIPTED response sequence. Never a real
// https.request. A throwaway key is supplied via env for construction, exactly as sections A/C do.
process.env.ANTHROPIC_API_KEY = 'sk-test-throwaway-never-sent';

// F1 — evidence variant: first response missing rationale (category present, choice present) -> RETRY;
// second response complete -> rerank succeeds, attempts reflects the retry.
(() => {
	let calls = 0;
	const postOnce = (spec, callback) => {
		calls += 1;
		if (calls === 1) {
			callback('', mockToolUseResponse({ choice: '1', category: 'strong' }), 200); // missing rationale
			return;
		}
		callback('', mockToolUseResponse({ choice: '1', category: 'strong', rationale: 'good match' }), 200);
	};
	const client = llmClientFactory({ configFilePath: NONEXISTENT_INI, componentOverrides: { postOnce } });
	client.rerank(
		{ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true, maxRetries: 3 },
		(err, result) => {
			harness.equal('F1: rerank succeeds after the retry (no error)', err, '');
			harness.equal('F1: category present after retry', result && result.category, 'strong');
			harness.equal('F1: rationale present after retry', result && result.rationale, 'good match');
			harness.equal('F1: attempts reflects the retry (2 attempts)', result && result.attempts, 2);
			harness.equal('F1: postOnce was actually called twice', calls, 2);

			// =====================================================================
			// F2 — all attempts malformed (rationale ALWAYS missing) -> EXHAUSTION returns SUCCESSFULLY
			// (never an error), with undefined judgment fields — never fabricated, never a second refusal.
			// =====================================================================
			let calls2 = 0;
			const postOnce2 = (spec2, callback2) => {
				calls2 += 1;
				callback2('', mockToolUseResponse({ choice: '1', category: 'strong' }), 200); // ALWAYS missing rationale
			};
			const client2 = llmClientFactory({ configFilePath: NONEXISTENT_INI, componentOverrides: { postOnce: postOnce2 } });
			client2.rerank(
				{ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true, maxRetries: 2 },
				(err2, result2) => {
					harness.equal('F2: exhaustion does NOT error — llmClient never fabricates and never refuses itself', err2, '');
					harness.equal('F2: choice still present', result2 && result2.choice, '1');
					harness.equal('F2: category present (it WAS actually supplied every attempt)', result2 && result2.category, 'strong');
					harness.ok('F2: rationale is undefined after exhaustion (never fabricated)', result2 && result2.rationale === undefined);
					harness.equal('F2: attempts reached the cap (2)', result2 && result2.attempts, 2);
					harness.equal('F2: postOnce was called exactly maxRetries times (2)', calls2, 2);

					// =====================================================================
					// F3 — SCALAR variant (requireJudgment omitted): a missing category/rationale is NEVER
					// retried — omission is legal there; attempts stays 1, byte-unchanged behavior.
					// =====================================================================
					let calls3 = 0;
					const postOnce3 = (spec3, callback3) => {
						calls3 += 1;
						callback3('', mockToolUseResponse({ choice: '1' }), 200); // no category, no rationale -- LEGAL under scalar
					};
					const client3 = llmClientFactory({ configFilePath: NONEXISTENT_INI, componentOverrides: { postOnce: postOnce3 } });
					client3.rerank(
						{ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], maxRetries: 5 },
						(err3, result3) => {
							harness.equal('F3: scalar variant succeeds immediately, no error', err3, '');
							harness.equal('F3: choice present', result3 && result3.choice, '1');
							harness.ok(
								'F3: category/rationale are undefined (never asked for, never retried on)',
								result3 && result3.category === undefined && result3.rationale === undefined,
							);
							harness.equal('F3: attempts is EXACTLY 1 — omission under the scalar variant is legal, never retried', result3 && result3.attempts, 1);
							harness.equal('F3: postOnce called exactly ONCE (no retry attempted)', calls3, 1);

							// =====================================================================
							harness.section('G — ⟪R-a THIRD REAL-RUN FIX⟫ max_tokens: evidence variant raised, scalar variant unchanged; stop_reason=\'max_tokens\' retries');
							// =====================================================================
							harness.equal('JUDGMENT_MAX_TOKENS is the documented 400', llmClientFactory.JUDGMENT_MAX_TOKENS, 400);

							// G1 — the EVIDENCE variant's outgoing request body carries max_tokens >= JUDGMENT_MAX_TOKENS.
							let observedPayloadEvidence = null;
							const postOnceG1 = (spec, callback) => {
								observedPayloadEvidence = spec.payload;
								callback('', mockToolUseResponse({ choice: '1', category: 'strong', rationale: 'x' }), 200);
							};
							const clientG1 = llmClientFactory({ configFilePath: NONEXISTENT_INI, componentOverrides: { postOnce: postOnceG1 } });
							clientG1.rerank(
								{ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true },
								(errG1) => {
									harness.equal('G1: rerank succeeds', errG1, '');
									harness.ok(
										'G1: the evidence variant\'s outgoing max_tokens is >= JUDGMENT_MAX_TOKENS (400)',
										observedPayloadEvidence && observedPayloadEvidence.max_tokens >= 400,
										`got ${observedPayloadEvidence && observedPayloadEvidence.max_tokens}`,
									);
									harness.equal(
										'  and is EXACTLY 400 here (cfg.maxTokens defaults to 64, so Math.max(64,400)=400)',
										observedPayloadEvidence && observedPayloadEvidence.max_tokens,
										400,
									);

									// G2 — the SCALAR variant's outgoing request body is UNCHANGED: max_tokens stays at
									// the configured/64 value, never raised.
									let observedPayloadScalar = null;
									const postOnceG2 = (spec2, callback2) => {
										observedPayloadScalar = spec2.payload;
										callback2('', mockToolUseResponse({ choice: '1' }), 200);
									};
									const clientG2 = llmClientFactory({ configFilePath: NONEXISTENT_INI, componentOverrides: { postOnce: postOnceG2 } });
									clientG2.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'] }, (errG2) => {
										harness.equal('G2: rerank succeeds', errG2, '');
										harness.equal(
											'G2: the scalar variant\'s outgoing max_tokens is UNCHANGED (the configured/64 value)',
											observedPayloadScalar && observedPayloadScalar.max_tokens,
											64,
										);

										// G3 — a mocked stop_reason='max_tokens' response under requireJudgment is treated
										// as the SAME retryable-malformed condition: RETRIES, then succeeds once a
										// complete response arrives.
										let callsG3 = 0;
										const postOnceG3 = (spec3, callback3) => {
											callsG3 += 1;
											if (callsG3 === 1) {
												const truncatedResponse = mockToolUseResponse({ choice: '1', category: 'strong' });
												truncatedResponse.stop_reason = 'max_tokens'; // the belt condition -- no rationale AND truncated
												callback3('', truncatedResponse, 200);
												return;
											}
											callback3('', mockToolUseResponse({ choice: '1', category: 'strong', rationale: 'complete now' }), 200);
										};
										const clientG3 = llmClientFactory({ configFilePath: NONEXISTENT_INI, componentOverrides: { postOnce: postOnceG3 } });
										clientG3.rerank(
											{ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', 'NONE'], requireJudgment: true, maxRetries: 3 },
											(errG3, resultG3) => {
												harness.equal('G3: rerank succeeds after the stop_reason=\'max_tokens\' retry (no error)', errG3, '');
												harness.equal('G3: rationale present after the retry', resultG3 && resultG3.rationale, 'complete now');
												harness.equal('G3: attempts reflects the retry (2 attempts)', resultG3 && resultG3.attempts, 2);
												harness.equal('G3: postOnce was actually called twice', callsG3, 2);

												// restore the process env exactly as found (mirrors section B's own restore discipline).
												if (savedEnvKey === undefined) {
													delete process.env.ANTHROPIC_API_KEY;
												} else {
													process.env.ANTHROPIC_API_KEY = savedEnvKey;
												}

												harness.report();
											},
										);
									});
								},
							);
						},
					);
				},
			);
		},
	);
})();
