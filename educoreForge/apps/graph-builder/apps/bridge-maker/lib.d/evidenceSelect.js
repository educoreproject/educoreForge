'use strict';

// evidenceSelect.js — bridge-maker/lib.d NEW (bridgeEvidenceRefactor-spec.md §3, ⟪A3⟫/⟪A4⟫; P3
// deliverable). THE EVIDENCE-BASED select: SIBLING of lib.d/selector.js (the CURRENT Opus abstain-
// first SCALAR-pool selector), NOT a mutation of it — selector.js stays byte-untouched and every
// existing bridge composing it (semanticBridge, genericBridge via bridgeSkeleton's defaultSelectMove)
// keeps working exactly as before (coexistence, spec §7 P2/P3). Where selector.js reranks a bare
// {candidate, cosine} pool with one scalar signal, this module judges a FULL EvidencePackage — every
// consideration (tuple, notes, nomination rationale) the composer gathered — and returns a DISCRETE
// verdict CATEGORY (⟪A4⟫), never a fabricated float.
//
//   evidenceSelect({ renderer }) -> selectCallable
//     (renderedPromptOrPackage, llmClient, callback(err, { abstain, pick, category, rationale }))
//     — exactly SELECT_SHAPE (evidenceContracts.js §5: arity 3, positional, trailing callback). Unlike
//     lib.d/selector.js (which takes llmClient at CONSTRUCTION and throws without one), the SELECT
//     contract puts llmClient in the CALL signature — select is declared PURE ("no graph access, no
//     side effects beyond the injected llmClient call"), so this module takes NO llmClient at
//     construction; only `renderer` (needed to turn an unrendered EvidencePackage into promptText) is
//     a construction-time dependency, and construction throws without one — the same "wiring fault
//     caught at author time" discipline evidenceComposer.js's semanticMatcher guard already uses.
//
//   renderedPromptOrPackage is EITHER:
//     (a) an EvidencePackage — { pool, promptSegments }, no `.promptText` — rendered HERE via the
//         injected renderer, AFTER the ⟪A3⟫ shape gate: a package failing evidencePackageViolation is
//         refused BY NAME before any prompt is built, never reaching the renderer or the LLM.
//     (b) a pre-rendered wrapper — { promptText, pool } — rendering already done upstream (e.g. for
//         caching/logging, or a caller that wants to inspect the exact prompt before judging); this
//         module uses promptText AS-IS and `pool` to map the LLM's ordinal choice back to the
//         candidate it named. `pool` is REQUIRED in this form for the same reason: a `pick` result
//         must name an actual candidate object (selectResultViolation), which is impossible to recover
//         from prompt text alone.
//
// ⟪A8⟫ LLM RESPONSE SHAPE — A RESOLVED CONTRACT AMBIGUITY, FLAGGED FOR THE P3 BOUNDARY REVIEW:
//   lib.d/selector.js's llmClient.rerank returns ONLY `{ choice }` (an ordinal or 'NONE') — sufficient
//   for a scalar pick, but ⟪A4⟫ requires select to emit a DISCRETE CATEGORY that is the LLM's OWN
//   judgment of match strength (strong/moderate/weakButReal/none), not a value this module fabricates
//   from the choice alone. This module therefore calls the SAME llmClient.rerank({systemPrompt,
//   userPrompt, choiceEnum}, callback) primitive but expects a RICHER response:
//   `callback(err, { choice, category, rationale })` — category and rationale alongside choice. A
//   `category` missing or not one of SELECT_CATEGORY_ENUM is refused BY NAME (never defaulted) — this
//   module will not fabricate a category the LLM did not actually assert. WIRING THE REAL
//   lib/llmClient.js (the live Anthropic client) to actually populate `category`/`rationale` in its
//   tool schema is OUT OF P3's hermetic scope (no real LLM call, per this phase's charter) and is
//   named here as the concrete boundary-review item: today only the hermetic test's STUB llmClient
//   supplies the richer shape.
//
// House style: qtools moduleFunction; callback(errString, result) with '' on success; refuse-by-value
// (polyArch2 §6); camelCase, compound names. No async/await, no try/catch for control flow.

const { evidencePackageViolation, selectResultViolation, SELECT_CATEGORY_ENUM } = require('../lib/evidenceContracts');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const EVIDENCE_SELECT_SYSTEM_PROMPT =
	'You judge whether a source data element matches one of a set of candidate CEDS elements, by ' +
	'weighing ALL of the evidence given for each candidate (its authoritative tuple, any analyst notes, ' +
	'any nomination rationale) — never surface wording alone. Report your choice as the candidate ' +
	'number, or NONE if no candidate is genuinely supported by the evidence. Also report a discrete ' +
	'confidence CATEGORY for your choice — strong, moderate, or weakButReal — reflecting how strongly ' +
	'the evidence supports it (never a numeric probability), and a short rationale. Prefer NONE over a ' +
	'weak or merely-related match.';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ renderer } = {}) => {
		if (!renderer || typeof renderer.render !== 'function') {
			throw new Error(
				`${moduleName}: constructed without a renderer (render) — evidenceSelect renders an ` +
					`unrendered EvidencePackage into prompt text before judging it; there is no default renderer.`,
			);
		}

		// judgeRenderedPool — shared tail once (promptText, pool) are in hand, either supplied
		// pre-rendered or produced by this module's own render() call below.
		const judgeRenderedPool = (promptText, pool, llmClient, callback) => {
			if (!Array.isArray(pool) || pool.length === 0) {
				callback('', { abstain: true, pick: null, category: 'none', rationale: 'no candidates in the evidence pool to judge' });
				return;
			}
			const choiceEnum = pool.map((oneEntry, idx) => `${idx + 1}`).concat(['NONE']);
			llmClient.rerank({ systemPrompt: EVIDENCE_SELECT_SYSTEM_PROMPT, userPrompt: promptText, choiceEnum }, (err, result) => {
				if (err) {
					callback(`${moduleName}: llmClient.rerank failed: ${err}`);
					return;
				}
				if (!result || result.choice === 'NONE') {
					const rationale = (result && typeof result.rationale === 'string' && result.rationale.trim()) || 'no candidate is supported by the evidence';
					callback('', { abstain: true, pick: null, category: 'none', rationale });
					return;
				}
				const ordinal = parseInt(result.choice, 10);
				const chosenEntry = pool[ordinal - 1];
				if (!chosenEntry) {
					callback(`${moduleName}: llmClient returned an out-of-range choice '${result.choice}' for a pool of ${pool.length}`);
					return;
				}
				if (!SELECT_CATEGORY_ENUM.includes(result.category)) {
					callback(
						`${moduleName}: llmClient did not supply a valid category (got ${JSON.stringify(result.category)}; ` +
							`must be one of ${SELECT_CATEGORY_ENUM.join(', ')}) — refusing rather than fabricating one (⟪A4⟫)`,
					);
					return;
				}
				if (typeof result.rationale !== 'string' || !result.rationale.trim()) {
					callback(`${moduleName}: llmClient did not supply a rationale for its pick — refusing rather than fabricating one`);
					return;
				}
				const selectResult = { abstain: false, pick: chosenEntry.candidate, category: result.category, rationale: result.rationale };
				const violation = selectResultViolation(selectResult);
				if (violation) {
					callback(`${moduleName}: composed a select result that fails its own gate: ${violation}`);
					return;
				}
				callback('', selectResult);
			});
		};

		// select — the produced SelectModule.select callable (evidenceContracts.js SELECT_SHAPE: arity
		// 3, positional: renderedPromptOrPackage, llmClient, callback).
		const select = (renderedPromptOrPackage, llmClient, callback) => {
			if (!llmClient || typeof llmClient.rerank !== 'function') {
				callback(`${moduleName}: llmClient is missing (rerank) — evidenceSelect judges by weighing evidence through an LLM; there is no default.`);
				return;
			}
			if (!renderedPromptOrPackage || typeof renderedPromptOrPackage !== 'object') {
				callback(`${moduleName}: renderedPromptOrPackage is missing or not an object — there is no default.`);
				return;
			}

			// (b) pre-rendered wrapper — { promptText, pool }, skip rendering entirely.
			if (typeof renderedPromptOrPackage.promptText === 'string' && Array.isArray(renderedPromptOrPackage.pool)) {
				judgeRenderedPool(renderedPromptOrPackage.promptText, renderedPromptOrPackage.pool, llmClient, callback);
				return;
			}

			// (a) an EvidencePackage — ⟪A3⟫ THE GATE: refused BY NAME before any prompt is built.
			const packageViolation = evidencePackageViolation(renderedPromptOrPackage);
			if (packageViolation) {
				callback(`${moduleName}: evidence package refused at the select seam (⟪A3⟫): ${packageViolation}`);
				return;
			}
			renderer.render(renderedPromptOrPackage, [], {}, (renderErr, promptText) => {
				if (renderErr) {
					callback(`${moduleName}: rendering the evidence package failed: ${renderErr}`);
					return;
				}
				judgeRenderedPool(promptText, renderedPromptOrPackage.pool, llmClient, callback);
			});
		};

		return select;
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.EVIDENCE_SELECT_SYSTEM_PROMPT = EVIDENCE_SELECT_SYSTEM_PROMPT;
