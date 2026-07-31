'use strict';

// evidenceRenderer.js — bridge-maker/lib.d NEW (bridgeEvidenceRefactor-spec.md §3, ⟪A2⟫; P3
// deliverable). THE RENDERER — a NAMED PURE component: evidencePackage -> promptText, deterministic,
// byte-stable. Implements the RENDERER contract (evidenceContracts.js §4): arity 4, positional,
// `render(evidencePackage, hubSegments, config, callback(err, promptText))`, plus a stamped
// RENDERER_VERSION (⟪A6⟫ — a prompt-render change is a generation change and must be legible as one).
//
// SIGNATURE RESOLUTION (⟪A8⟫ — the contract's doc names its 2nd positional argument `promptSegments`
// generically; this implementation resolves it concretely against RENDERER_COMPOSITION_ORDER
// (evidenceContracts.js: baseAbstainFirstInstruction -> hubSegment -> globalSegments -> perCandidate-
// EvidenceBlocks) — the ONE place the contract names FOUR composition slots but the evidencePackage
// itself only carries ONE segments array (its OWN `promptSegments`, ⟪A2⟫'s "the standard's global
// segments, deduped"). The 2nd positional argument here is therefore read as the HUB-level segment(s)
// — composed BEFORE the standard's own global segments, exactly matching the declared order — so a
// caller (the composer's caller, or a future hub-aware bridge) supplies hub-level framing separately
// from the per-standard segments the composer itself gathered. Flagged for the P3 boundary review as
// the one contract ambiguity this implementation had to resolve rather than merely apply.
//
//   render(evidencePackage, hubSegments, config, callback(err, promptText))
//     evidencePackage   { pool, promptSegments } — the composer's own output (⟪A3⟫-shaped, but this
//                       renderer does NOT re-gate it — that gate already sat at the match->select seam
//                       upstream; a renderer trusts its input the way inferencePipeline's own
//                       renderUserPrompt always has, over an ALREADY-VALIDATED pool)
//     hubSegments       array of strings, the hub-level segment(s) (composition order slot 2); [] is
//                       legal (no hub-level framing for this run)
//     config            { maxCandidates?, maxTotalChars? } — the deterministic evidence budget
//                       (truncation policy, spec §3): both optional; omitting either means unbounded
//                       for that axis. A truncation is always DETERMINISTIC (pool order preserved,
//                       first N kept) and always leaves an explicit marker naming how many were cut —
//                       never a silent drop.
//     callback(err, promptText)
//
// DETERMINISM: a pure function of its three data arguments — no Date.now, no Math.random, no object-
// key iteration order dependency (every object read below is read by NAMED key, never Object.values/
// for-in over an evidencePackage-supplied object). rendererDeterminismViolation (evidenceContracts.js)
// is this file's own keystone proof, run twice over identical inputs.
//
// House style: qtools moduleFunction; callback(errString, result) with '' on success; refuse-by-value
// for the one input this renderer cannot proceed without (a non-array pool); camelCase, compound
// names. No async/await, no try/catch for control flow (none needed — pure synchronous string work).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// RENDERER_VERSION bumped v1 -> v2: BASE_ABSTAIN_FIRST_INSTRUCTION's text changed (the R-a real-run
// fix's belt-and-suspenders addition, below) — a prompt-render change silently changes picks and MUST
// be legible as a generation change (⟪A2⟫/⟪A6⟫; this is exactly what the version field is for).
// v2 -> v3 ⟪SOURCE-PRESENCE HARDENING, 2026-07-31⟫: the rendered prompt now CONTAINS THE SOURCE
// ELEMENT. The bronze quality analysis proved v2 never told the judge what it was matching FROM —
// no source section existed, the judge said "no source element was provided" in 3,137 abstention
// rationales, and fabricated a source in most pick rationales. v3 renders a SOURCE ELEMENT section
// FIRST after the instruction (name, identity/path fields, definition, then every remaining scalar
// in sorted-key order — deterministic), reframes the instruction around matching FROM that source,
// and REFUSES a package whose sourceElement has no name. Every v2 judgment is invalidated by this
// version bump (the judgment cache keys on rendererVersion — that is the bump doing its job).
const RENDERER_VERSION = 'evidenceRenderer-v3';

// BASE_ABSTAIN_FIRST_INSTRUCTION — composition order slot 1 (RENDERER_COMPOSITION_ORDER[0]), a fixed
// constant, the SAME abstain-first discipline lib.d/selector.js's SYSTEM_PROMPT states for the scalar
// path, restated for a judge that weighs MULTIPLE evidence blocks per candidate rather than one line.
// ⟪R-a REAL-RUN FIX, 2026-07-30⟫ BELT + SUSPENDERS: a live LIF --rebridge against real Opus omitted the
// tool call's rationale for a pick (llmClient.js's request now REQUIRES it — see that file's own header
// for the primary fix); this second sentence presses the SAME requirement at the prompt-text level too,
// so the instruction and the tool schema agree rather than relying on the schema alone.
const BASE_ABSTAIN_FIRST_INSTRUCTION =
	'You are judging which ONE candidate below is the correct match FOR THE SOURCE ELEMENT stated ' +
	'next. Weigh ALL of the evidence — the source element itself, each candidate\'s tuple facts, any ' +
	'notes, and any nomination rationale — not surface wording. Choose the single candidate the ' +
	'evidence, taken together, supports as equivalent to the source element. If no candidate is ' +
	'genuinely supported, abstain (choose NONE). Prefer NONE over a weak or merely-related match. ' +
	'When you choose a candidate, you MUST ALSO report a discrete confidence category (strong, ' +
	'moderate, or weakButReal) and a one-sentence rationale for that specific choice — never omit ' +
	'them for a pick. When you abstain (NONE), give a short rationale for why nothing is genuinely ' +
	'supported.';

// SOURCE_SCALAR_VALUE_MAX_CHARS — a single source scalar's rendered value cap (deterministic; an
// over-long value is cut with an explicit marker, never silently).
const SOURCE_SCALAR_VALUE_MAX_CHARS = 400;

// SOURCE_IDENTITY_KEYS — rendered first, in THIS order, when present: the fields a judge needs to
// know WHAT it is matching before anything else. Everything else renders after, in sorted-key order.
const SOURCE_IDENTITY_KEYS = ['name', 'xpath', 'path', 'casePath', 'defText', 'description'];

// SOURCE_SKIP_KEYS — never rendered: vectors and internal plumbing carry no judge-legible meaning.
const SOURCE_SKIP_KEYS = new Set(['vector', 'embedding', 'searchText', 'stableId', '_id']);

// renderSourceBlock ⟪SOURCE-PRESENCE HARDENING, 2026-07-31⟫ — composition slot 2: the source element
// the judge matches FROM. Deterministic: identity keys in fixed order, then remaining scalar keys
// SORTED; arrays of scalars joined; objects skipped (the flattened record is scalar by contract).
const renderSourceBlock = (sourceElement) => {
	const lines = ['SOURCE ELEMENT (you are matching FROM this):'];
	const rendered = new Set();
	const renderOne = (key, value) => {
		if (value === undefined || value === null || value === '') {
			return;
		}
		let text;
		if (Array.isArray(value)) {
			text = value.filter((v) => typeof v !== 'object').join(', ');
			if (text === '') {
				return;
			}
		} else if (typeof value === 'object') {
			return;
		} else {
			text = `${value}`;
		}
		if (text.length > SOURCE_SCALAR_VALUE_MAX_CHARS) {
			text = `${text.slice(0, SOURCE_SCALAR_VALUE_MAX_CHARS)} [...value truncated]`;
		}
		lines.push(`  ${key}: ${text}`);
		rendered.add(key);
	};
	SOURCE_IDENTITY_KEYS.forEach((oneKey) => renderOne(oneKey, sourceElement[oneKey]));
	Object.keys(sourceElement)
		.filter((oneKey) => !rendered.has(oneKey) && !SOURCE_SKIP_KEYS.has(oneKey))
		.sort()
		.forEach((oneKey) => renderOne(oneKey, sourceElement[oneKey]));
	return lines.join('\n');
};

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// renderRangeText — one line per BaseTupleEvidence.range shape (P0-cedsTupleModel.md §3 worked
// examples), mutually exclusive by construction (hubModulePresentationViolation already proved it).
const renderRangeText = (range) => {
	if (!range) {
		return '(unspecified)';
	}
	if (range.shape === 'datatype') {
		return `scalar — ${range.rangeDatatype}`;
	}
	if (range.shape === 'class') {
		return `reference → CEDS class ${range.rangeClassId}${range.rangeClassName ? ` (${range.rangeClassName})` : ''}`;
	}
	if (range.shape === 'optionSet') {
		return `enumerated — option set ${range.rangeOptionSetId}`;
	}
	return `(unrecognized range shape '${range.shape}')`;
};

// renderTupleBlock — one BaseTupleEvidence (R5's presentation, evidenceContracts.js §3) rendered per
// the P0-cedsTupleModel.md §3 PROPOSAL shapes, now the CONTRACT's own worked examples.
const renderTupleBlock = (tuple) => {
	if (!tuple || typeof tuple !== 'object') {
		return '  (no tuple evidence)';
	}
	const lines = [];
	const isValueTier = tuple.referenceTier === 'value';
	lines.push(`  CEDS ${isValueTier ? 'Value ' : ''}Reference: ${tuple.canonicalKey} — "${tuple.name}"`);
	const domainsText = (tuple.domains || [])
		.map((oneDomain) => (oneDomain.domainName ? `${oneDomain.domainId} (${oneDomain.domainName})` : oneDomain.domainId))
		.join(', ');
	lines.push(
		`  Domain(s): ${domainsText || '(none)'}` +
			(tuple.domainsComplete ? '' : ' [domain list may be incomplete — known CEDS forge limitation, P0 §2.4]'),
	);
	if (tuple.isQualified && tuple.qualifier) {
		lines.push(
			`  Qualifier: ${tuple.propertyKey} [${tuple.qualifier.qualifierName}] — this canonicalKey also has ` +
				`an unqualified base and/or other qualified variants; match against THIS specific qualifier ` +
				`context, never the bare property (P0 §2.2)`,
		);
	}
	lines.push(`  Range: ${renderRangeText(tuple.range)}`);
	if (isValueTier && tuple.value) {
		lines.push(
			`  Scope: this value is a candidate ONLY within option set ${tuple.value.owningOptionSetId} of ` +
				`property ${tuple.value.owningPropertyKey} — the same value token can recur under a DIFFERENT ` +
				`owning property with a DIFFERENT meaning; never offered as a bare, unscoped candidate (P0 §2.6)`,
		);
	}
	return lines.join('\n');
};

// renderCandidateBlock — composition order slot 4, one entry. Nomination line (if present) rides
// right under the header, exactly where a reader needs to see WHY a non-top-cosine candidate is here.
const renderCandidateBlock = (poolEntry, ordinal) => {
	const candidate = poolEntry.candidate || {};
	const label = candidate.name || candidate.canonicalKey || candidate.stableId || '(unnamed candidate)';
	const lines = [`${ordinal}) ${label} — retrieval cosine ${round6(poolEntry.cosine)}`];
	if (poolEntry.nomination) {
		lines.push(`   Nominated by ${poolEntry.nomination.nominatedBy}: ${poolEntry.nomination.rationale}`);
	}
	lines.push(renderTupleBlock((poolEntry.considerations || {}).tuple));
	const notes = (poolEntry.considerations || {}).notes || [];
	if (notes.length) {
		lines.push(`  Notes: ${notes.join('; ')}`);
	}
	return lines.join('\n');
};

// dedupeInOrder — first-occurrence-order dedupe (⟪A2⟫'s discipline, applied here to the COMBINED
// hubSegments + evidencePackage.promptSegments stream, in case the same segment text rides both).
const dedupeInOrder = (items) => {
	const seen = new Set();
	const out = [];
	items.forEach((oneItem) => {
		if (!seen.has(oneItem)) {
			seen.add(oneItem);
			out.push(oneItem);
		}
	});
	return out;
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// render — the produced RendererModule.render callable (evidenceContracts.js RENDERER_SHAPE:
		// arity 4, positional). Synchronous; calls back on the same tick — the whole point of the
		// byte-stability proof (rendererDeterminismViolation calls it twice, assuming exactly this).
		const render = (evidencePackage, hubSegments, config, callback) => {
			const pool = evidencePackage && Array.isArray(evidencePackage.pool) ? evidencePackage.pool : null;
			if (!pool) {
				callback(
					`${moduleName}: evidencePackage.pool is missing or not an array — the renderer needs the ` +
						`composed pool to render candidate evidence blocks; there is no default.`,
				);
				return;
			}
			// ⟪SOURCE-PRESENCE HARDENING, 2026-07-31⟫ a source without a name cannot be judged against —
			// refuse-by-name, never render a subjectless prompt (the bronze proved what happens: the
			// judge abstains saying "no source element was provided", or worse, invents one).
			const sourceElement = evidencePackage.sourceElement;
			if (!sourceElement || typeof sourceElement !== 'object' || typeof sourceElement.name !== 'string' || sourceElement.name.trim() === '') {
				callback(
					`${moduleName}: evidencePackage.sourceElement is missing or carries no name — a prompt ` +
						`without its source is a question without a subject; there is no default.`,
				);
				return;
			}

			const budget = config || {};
			const maxCandidates = typeof budget.maxCandidates === 'number' ? budget.maxCandidates : Infinity;
			const renderedPool = pool.length > maxCandidates ? pool.slice(0, maxCandidates) : pool;
			const omittedCount = pool.length - renderedPool.length;

			const globalSegments = Array.isArray(evidencePackage.promptSegments) ? evidencePackage.promptSegments : [];
			const combinedSegments = dedupeInOrder([...(Array.isArray(hubSegments) ? hubSegments : []), ...globalSegments]);

			const candidateBlocks = renderedPool.map((oneEntry, idx) => renderCandidateBlock(oneEntry, idx + 1));
			if (omittedCount > 0) {
				candidateBlocks.push(
					`[truncated: ${omittedCount} more candidate(s) omitted by the evidence budget ` +
						`(config.maxCandidates=${maxCandidates})]`,
				);
			}

			const sections = [BASE_ABSTAIN_FIRST_INSTRUCTION, renderSourceBlock(sourceElement)];
			if (combinedSegments.length) {
				sections.push(combinedSegments.join('\n'));
			}
			sections.push(
				`EVIDENCE\n${candidateBlocks.join('\n\n')}\n\nReply with the number of the single best-` +
					`supported candidate, or NONE if the evidence does not support any of them.`,
			);

			let promptText = sections.join('\n\n');
			const maxTotalChars = typeof budget.maxTotalChars === 'number' ? budget.maxTotalChars : Infinity;
			if (promptText.length > maxTotalChars) {
				promptText = `${promptText.slice(0, maxTotalChars)}\n[...evidence truncated by config.maxTotalChars]`;
			}

			callback('', promptText);
		};

		return { render, RENDERER_VERSION };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.RENDERER_VERSION = RENDERER_VERSION;
module.exports.renderTupleBlock = renderTupleBlock;
module.exports.renderCandidateBlock = renderCandidateBlock;
module.exports.renderSourceBlock = renderSourceBlock;
