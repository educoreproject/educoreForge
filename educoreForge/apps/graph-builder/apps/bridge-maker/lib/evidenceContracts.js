'use strict';

// =====================================================================
// evidenceContracts.js — the SIX PUBLIC-PLUGIN CONTRACTS of the Bridge Evidence-Package Refactor
// (bridgeEvidenceRefactor-spec.md §4, P1 deliverable). Interfaces AS DATA + refuse-by-value gate
// FUNCTIONS, exactly the pattern apps/graph-builder/interfaces.js established for
// COMPONENT_SHAPES/BRIDGE_MODULE_SHAPE — arity, argKeys (or `null` for a positional signature) and
// a result declaration, checked by the SAME kind of mechanical checkers (arity via Function.length,
// argKeys via a source-text read-off regex, exactly as test-interfaces.js's own checkers do; small,
// deliberate duplication over coupling this module to that unrelated test file — see the checkers
// section below). Six data contracts and their runtime gates cannot all be arity/argKeys/resultKeys
// shaped, though: some of these seams pass plain VALUES across them (an evidence package, a base
// tuple presentation, a discrete category) rather than exposing a method set. Where a contract is a
// VALUE, not a callable, its gate is a refuse-by-value function over the value itself
// (evidencePackageViolation, hubModulePresentationViolation, selectResultViolation, ...) — the same
// "refuse BY NAME before it contaminates anything downstream" discipline, applied to data instead of
// to a function's shape.
//
// ⟪A8⟫ STATUS MARKER — every one of these six contracts was DRAFT until the P3 boundary review
// (2026-07-29, bridgeEvidenceRefactor-spec.md §7) hardened them public-ready, WITH TWO RIDERS, both now
// resolved/dispositioned in P4:
//   (R-a) evidenceSelect's llmClient response shape ({choice, category, rationale}) was proven only
//     against the hermetic STUB in P3; P4 wired the LIVE lib/llmClient.js (the real Anthropic tool
//     schema) to additionally emit category/rationale — ADDITIVE, lib.d/selector.js's {choice}-only
//     contract unbroken (test-llm-client.js's R-a section, test-selector.js byte-unchanged).
//   (R-b) per-source {category, rationale, normalizedConfidence} ride inside frozenEvidence.judgment
//     (the frozen decision block), NOT promoted to first-class materializer/edge-property fields in
//     P4 — lib/inferredIndex.js (the shared scalar+evidence materializer) is byte-untouched; a
//     category/rationale reader retrieves them by loading the pair's frozen block
//     (kit.decisionStore.getDecisionBlock + kit.evidenceFreezer.parse) and reading
//     frozenEvidence[i].judgment, keyed by source stableId. Promoting them to first-class
//     freezer-schema fields remains a noted FUTURE extension, not P4 scope. See
//     forges/bridges/genericBridge.js's own header for the full P4 disposition.
// CONTRACT_STATUS below is that literal marker; EVIDENCE_CONTRACTS stamps it onto every declared
// contract in one place so a reader (or a test) can confirm every one of them is now public-ready.
//
// R2 — these are third-party PLUGIN contracts: documented as if a stranger, never having seen this
// refactor discussed, will implement one of the six from scratch. Each section below carries the
// exact call shape, the obligations a conforming implementation owes, the refusal conditions its gate
// enforces, and one worked example.
//
// ⟪TQ RULING, 2026-07-29⟫ ALL CONTRACT CALLABLES ARE CALLBACK-SHAPED, WHETHER THEY NEED ONE OR NOT.
// Verbatim rationale: "All interfaces should have a callback whether they need it or not. It's easy
// to use not-needed when the callback is present. Very difficult to change when it's not." This
// GENERALIZES what P1's first draft resolved only for `select` (the one contract that obviously
// touches an injected llmClient) to EVERY one of the six: hubModule, renderer and normalizer are pure
// and synchronous in every implementation foreseeable today, and carry a callback anyway — a
// present-but-trivial callback costs a caller nothing (call it with `(err, result) => {...}` and
// ignore the async question entirely if the implementation resolves it synchronously); a callable
// shipped WITHOUT one and later found to need async I/O (a remote class-name lookup, a cache read)
// cannot be widened without breaking every caller's arity assumption. There is therefore NO contrast
// left in this file between "pure/positional, no callback" and "callback-shaped" contracts — all six
// end in `callback(errString, result)`, uniformly, per the shared house convention below.
//
// House style throughout (P1 CLAUDE.md / programming-skills briefing): qtools style, callback(errString,
// result) with '' on success, UNIFORMLY across all six contracts (the ruling above); no async/await,
// no try/catch for control flow; camelCase, compound names; refuse-by-value (polyArch2 §6) — a
// malformed value is refused BY NAME, never silently coerced or defaulted.
//
// P1 SCOPE (bridgeEvidenceRefactor-spec.md §7): this module is PURELY ADDITIVE — no existing bridge,
// kit module, or component library file is touched. It declares the contracts a real match/compose,
// hub module, renderer, select and normalizer will implement in P2/P3; nothing here calls Docker,
// Neo4j, or an LLM, and nothing here is wired into bridgeMaker's runtime path yet (that wiring is the
// P3 gate). Where an obligation cannot be mechanically checked without a real implementation to run
// (freeze-what-you-gather, the dependency-scoped graph walk), it is declared as DATA/doc now and left
// for the P3 boundary review to make executable — never silently assumed enforced.
// =====================================================================

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// ⟪A8⟫ the literal status every one of the six contracts below carries. HARDENED at the P3 boundary
// review (2026-07-29), riders R-a/R-b recorded above and resolved/dispositioned by P4.
const CONTRACT_STATUS =
	'HARDENED — public-ready as of the P3 boundary review (2026-07-29), riders R-a (llmClient live-wired, P4) ' +
	'and R-b (category/rationale/normalizedConfidence ride in frozenEvidence.judgment, not first-class fields) recorded.';

// =====================================================================
// SHARED CALLABLE-SHAPE CHECKERS — the same three mechanics interfaces.js's own test suite applies
// to COMPONENT_SHAPES (arity via Function.prototype.length; argKeys via a source-text regex read-off
// that can pass for the wrong reason but never a signature that omits the key entirely). Kept HERE,
// as small named exports, rather than requiring test-interfaces.js's private copy — that file's
// checkers are intentionally local to that one suite, and importing them would couple this contracts
// module (requireable by a future runtime pipeline, not only tests) to an unrelated test file. The
// duplication is the deliberate trade; it is three short functions, not a design.
// =====================================================================

const callableArityViolation = (fn, declaredArity, label) => {
	if (typeof fn !== 'function') {
		return `${label}: not a function (${typeof fn})`;
	}
	return fn.length === declaredArity
		? ''
		: `${label} takes ${fn.length} argument(s); the contract declares ${declaredArity}` +
				` (a positional signature where the contract declares a named-argument object looks exactly like this)`;
};

const readsArgumentKey = (functionSource, oneKey) =>
	new RegExp(`[{,]\\s*${oneKey}\\s*[,:=}]`).test(functionSource) ||
	new RegExp(`\\.${oneKey}\\b`).test(functionSource);

// argKeys === null means the contract's DATA arguments are POSITIONAL (no named-argument object to
// read keys off) — several of these six contracts take positional data arguments by the spec's own
// literal signatures (hubModule(candidate, callback), renderer(evidencePackage, promptSegments,
// config, callback), ...), unlike interfaces.js's component methods, which are uniformly named-object.
// Declaring null rather than [] says exactly that, the same distinction COMPONENT_SHAPES already
// draws for replayManager.delete. This is orthogonal to the callback ruling above: a contract can be
// positional-data-plus-trailing-callback (every one of these six) or named-object-plus-callback
// (MATCH_COMPOSE); either way, the LAST argument is always the callback.
const callableArgumentKeyViolation = (fn, argKeys, label) => {
	if (!argKeys) {
		return '';
	}
	if (typeof fn !== 'function') {
		return `${label}: not a function`;
	}
	const functionSource = fn.toString();
	const unread = argKeys.filter((oneKey) => !readsArgumentKey(functionSource, oneKey));
	return unread.length
		? `${label} never reads declared argument key(s) off its argument object: ${unread.join(', ')}`
		: '';
};

// =====================================================================
// 1. THE EVIDENCE PACKAGE — the value that crosses the match -> select seam (spec §3, ⟪A3⟫).
// =====================================================================
//
// @typedef {Object} CandidateEvidence
// @property {*}      candidate                 the candidate (hub or nominated) this evidence is about
// @property {number} cosine                    the retrieval cosine (finite number; -1 is a legal "no vector")
// @property {Object} considerations
// @property {Object} considerations.tuple      the hub module's baseTupleEvidence (§2 below) for this
//                                               candidate, or a custom match's extension of it
// @property {string[]} considerations.notes    per-CANDIDATE prose notes (rationale, caveats) — this is
//                                               where anything specific to THIS candidate belongs; it
//                                               NEVER rides in the bridge-level promptSegments (⟪A2⟫)
// @property {Object}   [nomination]            OPTIONAL — present when this candidate entered the pool
//                                               via a standard's OWN nomination rather than cosine top-K
//                                               (⟪A1⟫ the union pool). { nominatedBy, rationale }, both
//                                               strings — a nomination with no rationale is a bare score
//                                               with a different name, exactly what ⟪A1⟫ forbids.
//
// @typedef {Object} EvidencePackage           the WHOLE value at the match -> select seam
// @property {CandidateEvidence[]} pool         the union pool (⟪A1⟫): cosine top-K + nominated
// @property {string[]} promptSegments          GLOBAL segments ONLY — deduped, injected once at
//                                               prompt level (⟪A2⟫). Per-candidate material belongs
//                                               in considerations.notes, never here.
//
// WORKED EXAMPLE (a source considers ONE cosine-retrieved candidate plus one nominated candidate):
//   {
//     pool: [
//       { candidate: cedsRef_P600253, cosine: 0.83,
//         considerations: { tuple: hubModule(cedsRef_P600253), notes: [] } },
//       { candidate: cedsRef_P600188, cosine: 0.41,
//         considerations: { tuple: hubModule(cedsRef_P600188),
//                            notes: ['shares this source\'s owning class term'] },
//         nomination: { nominatedBy: 'caseStructuralBridge', rationale: 'owning-class term match' } },
//     ],
//     promptSegments: ['Judge CASE structural matches by owning-class term overlap, not surface wording.'],
//   }
//
// THE GATE: evidencePackageViolation(evidencePackage) -> ''|reason. Refuses BY NAME:
//   - missing/malformed candidate, cosine, considerations.tuple, considerations.notes (per entry)
//   - a malformed `nomination` (present but missing nominatedBy/rationale)
//   - promptSegments not an array of strings
//   - promptSegments NOT deduped (⟪A2⟫)
//   - a per-candidate segment SMUGGLED into promptSegments — detected by scanning promptSegments for
//     any candidate-identifying token (stableId/canonicalKey/cedsId/valueKey/name) drawn from the
//     pool itself; a segment naming a SPECIFIC candidate is per-candidate material by definition,
//     wherever it physically sits.
//
// This is the runtime gate that will sit at the match -> select seam in P3 (spec §3, ⟪A3⟫).

const EVIDENCE_PACKAGE_REQUIRED_KEYS = ['pool', 'promptSegments'];
const CANDIDATE_EVIDENCE_REQUIRED_KEYS = ['candidate', 'cosine', 'considerations'];
const CONSIDERATIONS_REQUIRED_KEYS = ['tuple', 'notes'];

// candidateIdentifyingTokens — the tokens a promptSegments entry must never mention verbatim (the
// smuggling heuristic). Deliberately conservative: only reasonably-specific string identifiers (>= 4
// chars) count, so a short generic word never false-positives the gate.
const candidateIdentifyingTokens = (candidate) => {
	if (!candidate || typeof candidate !== 'object') {
		return [];
	}
	return [candidate.stableId, candidate.canonicalKey, candidate.cedsId, candidate.valueKey, candidate.name].filter(
		(oneToken) => typeof oneToken === 'string' && oneToken.trim().length >= 4,
	);
};

const candidateEvidenceViolation = (entry, index) => {
	const label = `pool[${index}]`;
	if (!entry || typeof entry !== 'object') {
		return `${label}: not an object`;
	}
	if (entry.candidate === undefined || entry.candidate === null) {
		return `${label}: missing candidate`;
	}
	if (typeof entry.cosine !== 'number' || Number.isNaN(entry.cosine) || !Number.isFinite(entry.cosine)) {
		return `${label}: cosine is not a finite number (got ${JSON.stringify(entry.cosine)})`;
	}
	const considerations = entry.considerations;
	if (!considerations || typeof considerations !== 'object') {
		return `${label}: considerations is missing or not an object`;
	}
	if (considerations.tuple === undefined || considerations.tuple === null || typeof considerations.tuple !== 'object') {
		return `${label}: considerations.tuple is missing — every candidate must carry the hub module's base tuple evidence`;
	}
	if (!Array.isArray(considerations.notes)) {
		return `${label}: considerations.notes is not an array`;
	}
	const badNote = considerations.notes.find((oneNote) => typeof oneNote !== 'string');
	if (badNote !== undefined) {
		return `${label}: considerations.notes contains a non-string entry (${JSON.stringify(badNote)})`;
	}
	if (entry.nomination !== undefined && entry.nomination !== null) {
		const nomination = entry.nomination;
		if (
			typeof nomination !== 'object' ||
			typeof nomination.nominatedBy !== 'string' ||
			!nomination.nominatedBy.trim() ||
			typeof nomination.rationale !== 'string' ||
			!nomination.rationale.trim()
		) {
			return (
				`${label}: nomination is present but malformed — a nomination must carry ` +
				`{nominatedBy, rationale} strings (⟪A1⟫: every nominated candidate carries the rationale ` +
				`that explains why it was nominated)`
			);
		}
	}
	return '';
};

const evidencePackageViolation = (evidencePackage) => {
	if (!evidencePackage || typeof evidencePackage !== 'object') {
		return 'evidencePackage: not an object';
	}
	if (!Array.isArray(evidencePackage.pool)) {
		return `evidencePackage: pool is not an array (got ${typeof evidencePackage.pool})`;
	}
	for (let i = 0; i < evidencePackage.pool.length; i++) {
		const oneViolation = candidateEvidenceViolation(evidencePackage.pool[i], i);
		if (oneViolation) {
			return oneViolation;
		}
	}
	if (!Array.isArray(evidencePackage.promptSegments)) {
		return `evidencePackage: promptSegments is not an array (got ${typeof evidencePackage.promptSegments})`;
	}
	const nonString = evidencePackage.promptSegments.find((oneSegment) => typeof oneSegment !== 'string');
	if (nonString !== undefined) {
		return `evidencePackage: promptSegments contains a non-string entry (${JSON.stringify(nonString)})`;
	}
	if (new Set(evidencePackage.promptSegments).size !== evidencePackage.promptSegments.length) {
		return (
			'evidencePackage: promptSegments contains duplicate entries — ⟪A2⟫ requires global segments ' +
			'to be deduped before injection'
		);
	}
	for (const oneCandidateEvidence of evidencePackage.pool) {
		const tokens = candidateIdentifyingTokens(oneCandidateEvidence.candidate);
		for (const oneToken of tokens) {
			const leaked = evidencePackage.promptSegments.find((oneSegment) => oneSegment.includes(oneToken));
			if (leaked !== undefined) {
				return (
					`evidencePackage: promptSegments entry ${JSON.stringify(leaked)} references candidate-specific ` +
					`token '${oneToken}' — per-candidate material belongs in considerations.notes, never in the ` +
					`bridge-level promptSegments (⟪A2⟫)`
				);
			}
		}
	}
	return '';
};

// =====================================================================
// 2. THE MATCH/COMPOSE CONTRACT — the evidence composer (spec §3, ⟪A1⟫, ⟪A2⟫, ⟪A5⟫, ⟪A10⟫).
// =====================================================================
//
// CONSTRUCTION (not arity/argKeys-checked here — a factory's own construction shape is the same
// "throws at construction on a wiring fault" discipline every other lib.d/lib factory in this tree
// uses; P1 declares the shape, P2/P3 build and gate a real one):
//
//   matchComposeFactory({ kit, hubModule, config }) -> callable
//     kit          the injected lib.d kit (graphReader, vectorizer, ...) — the SAME kit every bridge
//                  composes; a custom match/compose gets nothing a generic bridge doesn't also get
//     hubModule    the resolved HubModule for this run's hub (R5) — composed per-candidate to obtain
//                  baseTupleEvidence; this is what makes the composer hub-agnostic
//     config       recipe-carried config, INCLUDING `dependencies` (⟪A5⟫ — the walk-scope declaration:
//                  a standard wanting cross-standard graph evidence declares it here, the EXISTING
//                  recipe mechanism; no new machinery, no unbounded reach)
//
// CALL (the shape THIS module declares and gates):
//
// @interface MatchComposeModule
// @property {function({sourceElement: Object, candidateElements: Object[], graphReader: Object,
//            hubModule: function}, function(string, EvidencePackage=): void): void} (the produced callable)
//
//   ({ sourceElement, candidateElements, graphReader, hubModule }, callback(errString, evidencePackage))
//     sourceElement       the FULL source element (unflattened — spec §5 retrieval-enrichment reversal;
//                         P0/P1 do not implement §5, but the CONTRACT is written against its post-state)
//     candidateElements   the FULL hub candidate elements, same reversal, other side
//     graphReader         kit.graphReader, handed again at CALL time (not only construction) so a
//                         custom composer can walk without reaching back into a construction closure
//     hubModule           handed again at call time for the same reason — one fewer implicit closure
//                         capture a plugin author has to get right
//   RESULT is exactly an EvidencePackage (§1) — matchComposeResultViolation IS evidencePackageViolation;
//   the composer's entire job is producing a conforming evidence package, so the same gate that sits
//   at match -> select also proves the composer's own output.
//
//   Already callback-shaped in P1's first draft (a graph-walking composer plainly needs one) — arity
//   2 ending in `callback(errString, evidencePackage)` reads correctly under the ⟪TQ RULING,
//   2026-07-29⟫ above unchanged; no shape or doc contrast to remove here.
//
// WORKED EXAMPLE: a custom CASE composer nominates every hub candidate sharing the source's owning-
// class term, in addition to the cosine top-K, each nomination carrying { nominatedBy: 'caseStructuralBridge',
// rationale: 'owning-class term match' } — see §1's worked example, which IS this composer's output.
//
// OBLIGATIONS — declared as data/doc (⟪A8⟫: not mechanically enforced in P1; there is no real
// composer yet to run the check against without Docker/a graph. P2/P3 make these executable):
const MATCH_COMPOSE_OBLIGATIONS = Object.freeze([
	'freezeWhatYouGather — everything the composer pre-fetched AND graph-walked must be captured ' +
		'verbatim in the returned pool/considerations, so a later replay never re-walks the graph ' +
		'(spec §3: "FREEZES everything gathered ... into the decision block").',
	'graphWalkScopeIsDeclaredDependencyGraph — any graph.walk the composer performs via the injected ' +
		'graphReader must stay within the recipe\'s declared `dependencies` (⟪A5⟫); an unscoped or ' +
		'cross-standard read reaches further than the standard declared it needed.',
]);

const MATCH_COMPOSE_SHAPE = Object.freeze({
	arity: 2,
	argKeys: ['sourceElement', 'candidateElements', 'graphReader', 'hubModule'],
	resultKeys: EVIDENCE_PACKAGE_REQUIRED_KEYS,
});

const matchComposeCallableViolation = (fn, label = 'matchCompose') => {
	const arityViolation = callableArityViolation(fn, MATCH_COMPOSE_SHAPE.arity, label);
	if (arityViolation) {
		return arityViolation;
	}
	return callableArgumentKeyViolation(fn, MATCH_COMPOSE_SHAPE.argKeys, label);
};

// the composer's declared RESULT shape is exactly the evidence package — one gate serves both seams.
const matchComposeResultViolation = evidencePackageViolation;

// =====================================================================
// 3. THE HUB-MODULE CONTRACT — R5: `(candidate, callback(err, baseTupleEvidence))`, the CEDS tuple
//    presentation (P0-cedsTupleModel.md §2, §3), written precisely enough that a non-CEDS hub could
//    implement against it.
// =====================================================================
//
// @interface HubModule
// @property {function(Object, function(string, BaseTupleEvidence=): void): void} (the callable —
//           POSITIONAL data argument + trailing callback, arity 2, per the ⟪TQ RULING, 2026-07-29⟫
//           above: every real implementation we can foresee renders a presentation from an
//           already-read candidate synchronously — it does not itself read the graph — but the
//           callback rides along regardless. Cheap to ignore now (call back on the same tick with
//           `callback('', presentation)`); painful to retrofit later if a future hub module ever
//           needs an async lookup (e.g. resolving a class name from a remote registry).)
//
// @typedef {Object} BaseTupleEvidence
// @property {string}   referenceTier      'property' | 'value' — no third tier (P0 §2.2: a qualified
//                                         ref is referenceTier='property' with qualifier populated)
// @property {string}   canonicalKey       the P###### (property tier) or OV###### (value tier) token
// @property {string}   propertyKey        the OWNING property's canonicalKey (== canonicalKey at
//                                         property tier; the owning property at value tier)
// @property {string}   name
// @property {Object[]} domains            LIST, always >= 1 entry, each {domainId, domainName}. The
//                                         CONTRACT is list-shaped from day one (P0 §2.4 / spec P4) even
//                                         though today's forge only ever resolves the first —
//                                         forgeCeds.js:306 silently drops every domain association
//                                         after the first resolvable one for 256/2324 (11%) properties.
// @property {boolean}  domainsComplete    P1's resolution of P0's open question #2: false whenever this
//                                         presentation is known to have collapsed a genuinely
//                                         multi-domain property to one entry (i.e. today, ALWAYS false
//                                         for those 256 properties, true otherwise) — so the renderer
//                                         can mark the list "known-incomplete" rather than presenting a
//                                         partial fact as complete, exactly as spec §7 P4 instructs.
// @property {Object}   range
// @property {string}   range.shape        'datatype' | 'class' | 'optionSet' — MUTUALLY EXCLUSIVE
//                                         (P0 §2.1/2.3: every live HubReference has exactly one set)
// @property {?string}  range.rangeDatatype    set iff shape === 'datatype'
// @property {?string}  range.rangeClassId     set iff shape === 'class'
// @property {?string}  range.rangeClassName   optional, resolved class name for 'class' shape
// @property {?string}  range.rangeOptionSetId set iff shape === 'optionSet'
// @property {boolean}  isQualified        whether this property-tier ref carries qualifierKeys
// @property {?Object}  qualifier          REQUIRED non-null when isQualified — {qualifierKey,
//                                         qualifierName} (+ optionally otherVariantCount). P0 §2.2: a
//                                         qualified ref's canonicalKey is IDENTICAL to its unqualified
//                                         base's, so the qualifier context is the ONLY thing that
//                                         disambiguates it; omitting it here recreates exactly the
//                                         ambiguity trap P0 flagged. null when isQualified is false.
// @property {?Object}  value              REQUIRED non-null when referenceTier === 'value' —
//                                         {valueKey, owningPropertyKey, owningOptionSetId}. P0 §2.6: a
//                                         bare option-value token is NOT unique across properties (one
//                                         shared by 13 distinct properties, live); a value-tier
//                                         presentation missing its owning-property/option-set scope is
//                                         actively misleading, not merely incomplete. null at property tier.
//
// WORKED EXAMPLES (P0-cedsTupleModel.md §3, live, PROPOSAL there / CONTRACT here):
//   Shape A (scalar):   { referenceTier: 'property', canonicalKey: 'P000104', propertyKey: 'P000104',
//     name: 'Staff Evaluation Score or Rating', domains: [{domainId:'C200366', domainName:'Staff Evaluation'}],
//     domainsComplete: true, range: {shape:'datatype', rangeDatatype:'string', rangeClassId:null,
//     rangeOptionSetId:null}, isQualified: false, qualifier: null, value: null }
//   Shape D (qualified): { ..., canonicalKey: 'P600502', isQualified: true,
//     qualifier: { qualifierKey: 'OV_federalSchoolCode', qualifierName: 'Federal School Code',
//     otherVariantCount: 3 }, ... }
//   Shape E (value tier): { referenceTier: 'value', canonicalKey: 'OV001637175776', propertyKey: 'P001637',
//     domains: [{domainId:'C200010', domainName:null}], domainsComplete: true,
//     range: {shape:'optionSet', rangeOptionSetId:'OS001637', rangeDatatype:null, rangeClassId:null},
//     isQualified: false, qualifier: null,
//     value: { valueKey:'OV001637175776', owningPropertyKey:'P001637', owningOptionSetId:'OS001637' } }
//
// THE GATE: hubModulePresentationViolation(baseTupleEvidence) -> ''|reason. Refuses BY NAME every
// field above that is missing, wrong-typed, or self-contradictory (domains not a list, an empty
// domains list, a missing domainsComplete flag, more than one range field set, a qualified ref with
// no qualifier context, a value-tier ref with no owning-property/option-set scope).

const RANGE_SHAPES = Object.freeze(['datatype', 'class', 'optionSet']);
const RANGE_SHAPE_FIELD = Object.freeze({
	datatype: 'rangeDatatype',
	class: 'rangeClassId',
	optionSet: 'rangeOptionSetId',
});

// arity 2: (candidate, callback) — ⟪TQ RULING, 2026-07-29⟫; see the @interface HubModule doc above.
const HUB_MODULE_SHAPE = Object.freeze({ arity: 2, argKeys: null });

const hubModuleCallableViolation = (fn, label = 'hubModule') => callableArityViolation(fn, HUB_MODULE_SHAPE.arity, label);

const hubModulePresentationViolation = (evidence) => {
	if (!evidence || typeof evidence !== 'object') {
		return 'baseTupleEvidence: not an object';
	}
	if (evidence.referenceTier !== 'property' && evidence.referenceTier !== 'value') {
		return `baseTupleEvidence: referenceTier must be 'property' or 'value' (got ${JSON.stringify(evidence.referenceTier)})`;
	}
	if (typeof evidence.canonicalKey !== 'string' || !evidence.canonicalKey) {
		return 'baseTupleEvidence: canonicalKey is missing';
	}
	if (typeof evidence.propertyKey !== 'string' || !evidence.propertyKey) {
		return 'baseTupleEvidence: propertyKey is missing';
	}
	if (typeof evidence.name !== 'string' || !evidence.name) {
		return 'baseTupleEvidence: name is missing';
	}
	if (!Array.isArray(evidence.domains)) {
		return `baseTupleEvidence: domains must be an array (got ${typeof evidence.domains}) — the contract is list-shaped from day one (P0 §2.4)`;
	}
	if (evidence.domains.length === 0) {
		return 'baseTupleEvidence: domains is empty — every live HubReference has at least one owning class';
	}
	const badDomain = evidence.domains.find(
		(oneDomain) => !oneDomain || typeof oneDomain !== 'object' || typeof oneDomain.domainId !== 'string' || !oneDomain.domainId,
	);
	if (badDomain !== undefined) {
		return `baseTupleEvidence: a domains[] entry is missing domainId (${JSON.stringify(badDomain)})`;
	}
	if (typeof evidence.domainsComplete !== 'boolean') {
		return (
			'baseTupleEvidence: domainsComplete (boolean) is missing — the hub module must state whether ' +
			'this presentation is known to have collapsed a multi-domain property (P0 §2.4), rather than ' +
			'silently presenting a partial fact as complete'
		);
	}
	const range = evidence.range;
	if (!range || typeof range !== 'object') {
		return 'baseTupleEvidence: range is missing';
	}
	if (!RANGE_SHAPES.includes(range.shape)) {
		return `baseTupleEvidence: range.shape must be one of ${RANGE_SHAPES.join(', ')} (got ${JSON.stringify(range.shape)})`;
	}
	const expectedField = RANGE_SHAPE_FIELD[range.shape];
	if (typeof range[expectedField] !== 'string' || !range[expectedField]) {
		return `baseTupleEvidence: range.shape is '${range.shape}' but range.${expectedField} is not set`;
	}
	const leakingField = Object.values(RANGE_SHAPE_FIELD).find(
		(oneField) => oneField !== expectedField && range[oneField] !== null && range[oneField] !== undefined,
	);
	if (leakingField) {
		return (
			`baseTupleEvidence: range.shape is '${range.shape}' but range.${leakingField} is also set — ` +
			`the three range shapes are mutually exclusive (P0 §2.1)`
		);
	}
	if (typeof evidence.isQualified !== 'boolean') {
		return 'baseTupleEvidence: isQualified (boolean) is missing';
	}
	if (evidence.isQualified) {
		const qualifier = evidence.qualifier;
		if (
			!qualifier ||
			typeof qualifier !== 'object' ||
			typeof qualifier.qualifierKey !== 'string' ||
			!qualifier.qualifierKey ||
			typeof qualifier.qualifierName !== 'string' ||
			!qualifier.qualifierName
		) {
			return (
				'baseTupleEvidence: isQualified is true but qualifier context (qualifierKey, qualifierName) is ' +
				'missing — canonicalKey alone is ambiguous once qualified (P0 §2.2); the qualifier context MUST ' +
				'ride in the presentation'
			);
		}
	} else if (evidence.qualifier !== null && evidence.qualifier !== undefined) {
		return 'baseTupleEvidence: isQualified is false but a qualifier object is present — ambiguous self-description';
	}
	if (evidence.referenceTier === 'value') {
		const value = evidence.value;
		if (
			!value ||
			typeof value !== 'object' ||
			typeof value.valueKey !== 'string' ||
			!value.valueKey ||
			typeof value.owningPropertyKey !== 'string' ||
			!value.owningPropertyKey ||
			typeof value.owningOptionSetId !== 'string' ||
			!value.owningOptionSetId
		) {
			return (
				'baseTupleEvidence: referenceTier is value but value context (valueKey, owningPropertyKey, ' +
				'owningOptionSetId) is missing — a bare option-value token is NOT unique across properties (P0 §2.6)'
			);
		}
	} else if (evidence.value !== null && evidence.value !== undefined) {
		return 'baseTupleEvidence: referenceTier is property but a value object is present — value context belongs only to referenceTier=value';
	}
	return '';
};

// =====================================================================
// 4. THE RENDERER CONTRACT — a NAMED PURE component (spec §3, ⟪A2⟫): evidencePackage -> promptText,
//    callback-shaped per ⟪TQ RULING, 2026-07-29⟫.
// =====================================================================
//
// @interface RendererModule
// @property {function(EvidencePackage, string[], Object, function(string, string=): void): void}
//           render   POSITIONAL data arguments + trailing callback, arity 4:
//           render(evidencePackages, promptSegments, config, callback(err, promptText)). Every
//           foreseeable implementation renders synchronously and calls back on the same tick — PURE
//           in that sense — but the callback rides along regardless (the ruling above): same inputs
//           -> IDENTICAL bytes via the callback, always. This is the feature's keystone unit test
//           (spec §3).
// @property {string} RENDERER_VERSION   stamped into every decision block (⟪A6⟫) — a prompt-render
//           change silently changes picks, and must therefore be legible as a generation change.
//
// DECLARED (⟪A2⟫), not yet mechanically checked against a real renderer's internals in P1 — that
// needs a real renderer to inspect (P3 boundary review):
const RENDERER_COMPOSITION_ORDER = Object.freeze([
	'baseAbstainFirstInstruction',
	'hubSegment',
	'globalSegments', // deduped
	'perCandidateEvidenceBlocks',
]);
//
// WORKED EXAMPLE: render(evidencePackage, ['Judge CASE matches by owning-class term.'], {}, (err,
// promptText) => {...}) always calls back with the identical string for the identical evidencePackage
// — this is exactly what rendererDeterminismViolation below proves, and what a nondeterministic
// double (one that stamps an incrementing counter into its callback output) is caught failing.
//
// THE GATES:
//   rendererModuleViolation(rendererModule, label) -> ''|reason — refuses a missing/mis-arity render
//   function or a missing/empty RENDERER_VERSION.
//   rendererDeterminismViolation(renderFn, evidencePackage, promptSegments, config) -> ''|reason —
//   calls renderFn TWICE with the SAME inputs and refuses if the two calls' callbacks disagree, if
//   either callback reports an error, or if either callback did not deliver a string. Assumes the
//   callable invokes its callback SYNCHRONOUSLY, as every double in this hermetic suite does (the
//   same assumption test-interfaces.js's own result-shape checks make of bridgeMaker.run and the
//   manifestEditor doors); a genuinely async production implementation is proven at the P3 boundary
//   review, not here.

const RENDERER_SHAPE = Object.freeze({ arity: 4, argKeys: null });

const rendererModuleViolation = (rendererModule, label = 'rendererModule') => {
	if (!rendererModule || typeof rendererModule !== 'object') {
		return `${label}: not an object`;
	}
	const arityViolation = callableArityViolation(rendererModule.render, RENDERER_SHAPE.arity, `${label}.render`);
	if (arityViolation) {
		return arityViolation;
	}
	if (typeof rendererModule.RENDERER_VERSION !== 'string' || !rendererModule.RENDERER_VERSION.trim()) {
		return (
			`${label}.RENDERER_VERSION: missing or empty — a prompt-render change silently changes picks ` +
			`and must be legible as a generation change (⟪A2⟫, ⟪A6⟫)`
		);
	}
	return '';
};

// rendererDeterminismViolation — calls the CALLBACK-SHAPED renderer TWICE with identical inputs and
// compares the two callback deliveries. Assumes synchronous callback invocation (documented above).
const rendererDeterminismViolation = (renderFn, evidencePackage, promptSegments, config) => {
	if (typeof renderFn !== 'function') {
		return 'renderer: not a function';
	}
	let firstErr;
	let firstText;
	let firstCalled = false;
	renderFn(evidencePackage, promptSegments, config, (err, text) => {
		firstCalled = true;
		firstErr = err;
		firstText = text;
	});
	let secondErr;
	let secondText;
	let secondCalled = false;
	renderFn(evidencePackage, promptSegments, config, (err, text) => {
		secondCalled = true;
		secondErr = err;
		secondText = text;
	});
	if (!firstCalled || !secondCalled) {
		return 'renderer: did not invoke its callback synchronously (or at all) — this gate cannot observe an async delivery';
	}
	if (firstErr) {
		return `renderer: first call's callback reported an error: ${firstErr}`;
	}
	if (secondErr) {
		return `renderer: second call's callback reported an error: ${secondErr}`;
	}
	if (typeof firstText !== 'string') {
		return `renderer: callback did not deliver a string (got ${typeof firstText})`;
	}
	if (typeof secondText !== 'string') {
		return `renderer: second call's callback did not deliver a string (got ${typeof secondText})`;
	}
	if (firstText !== secondText) {
		return (
			'renderer: two calls with IDENTICAL inputs delivered DIFFERENT output via their callbacks — ' +
			'byte-stability is the renderer\'s keystone invariant (⟪A2⟫); a prompt render must never depend ' +
			'on wall-clock time, randomness, or object key iteration order'
		);
	}
	return '';
};

// =====================================================================
// 5. THE SELECT CONTRACT — generic, PURE judge (spec §3, ⟪A4⟫).
// =====================================================================
//
// @interface SelectModule
// @property {function(*, Object, function(string, SelectResult=): void): void} select   POSITIONAL
//           data arguments + trailing callback, arity 3: (renderedPromptOrPackage, llmClient,
//           callback). No graph access, no side effects beyond the injected llmClient call — this
//           purity is what keeps freeze/replay honest. select was P1's FIRST draft's own resolution
//           of the spec prose's bare-return signature ("(package) -> {pick|abstain, category,
//           rationale}" / "(renderedPrompt|package, llmClient) -> {...}"), on the grounds that house
//           style (bridgeSkeleton.js, selector.js) is categorical that anything touching an injected
//           llmClient is callback-shaped. TQ's standing ruling (2026-07-29, see the file header) has
//           since GENERALIZED that resolution to every one of the six contracts, callback-touching-an-
//           LLM or not — select's shape is therefore unchanged, but is no longer a special case among
//           the six; it is simply the first one that happened to need no argument for the change.
//
// @typedef {Object} SelectResult
// @property {boolean} abstain      true = no pick (mutually exclusive with `pick`)
// @property {?Object} pick         the chosen candidate; null iff abstain
// @property {string}  category     ONE of SELECT_CATEGORY_ENUM — a DISCRETE verdict, NEVER a
//                                  fabricated float (⟪A4⟫)
// @property {string}  rationale    non-empty prose explaining the verdict
//
// WORKED EXAMPLE: select(renderedPrompt, llmClient, (err, result) => {...}) calls back
//   { abstain: false, pick: {stableId:'...'}, category: 'strong', rationale: 'definitions align exactly' }
// or, when nothing fits: { abstain: true, pick: null, category: 'none', rationale: 'no candidate matches the definition' }
//
// THE GATES: selectShapeViolation(fn, label) -> ''|reason (arity); selectResultViolation(result) ->
// ''|reason — refuses a non-enum category BY NAME, a missing/empty rationale, and an
// abstain/pick inconsistency (abstain=true with a pick set, or abstain=false with no pick).

const SELECT_CATEGORY_ENUM = Object.freeze(['strong', 'moderate', 'weakButReal', 'none']);

const SELECT_SHAPE = Object.freeze({ arity: 3, argKeys: null });

const selectShapeViolation = (fn, label = 'select') => callableArityViolation(fn, SELECT_SHAPE.arity, label);

const selectResultViolation = (result) => {
	if (!result || typeof result !== 'object') {
		return 'select result: not an object';
	}
	if (typeof result.abstain !== 'boolean') {
		return 'select result: abstain (boolean) is missing';
	}
	if (!SELECT_CATEGORY_ENUM.includes(result.category)) {
		return (
			`select result: category must be one of ${SELECT_CATEGORY_ENUM.join(', ')} ` +
			`(got ${JSON.stringify(result.category)}) — never a fabricated float (⟪A4⟫)`
		);
	}
	if (typeof result.rationale !== 'string' || !result.rationale.trim()) {
		return 'select result: rationale (non-empty string) is missing';
	}
	if (result.abstain) {
		if (result.pick !== null && result.pick !== undefined) {
			return 'select result: abstain is true but pick is set — abstain and pick are mutually exclusive';
		}
	} else if (!result.pick || typeof result.pick !== 'object') {
		return 'select result: abstain is false but pick is missing — a non-abstaining verdict must name what it picked';
	}
	return '';
};

// =====================================================================
// 6. THE NORMALIZER CONTRACT — generic, deterministic (spec §3, ⟪A4⟫), callback-shaped per
//    ⟪TQ RULING, 2026-07-29⟫.
// =====================================================================
//
// @interface NormalizerModule
// @property {function(string, number, Object, function(string, number=): void): void} normalize
//           POSITIONAL data arguments + trailing callback, arity 4:
//           normalize(category, retrievalCosine, context, callback(err, confidence)). Deterministic:
//           SAME inputs -> SAME number via the callback, always. `category` is drawn from the SAME
//           SELECT_CATEGORY_ENUM select emits — the two contracts deliberately share one enum,
//           declared once above, so they cannot drift. The mapping ITSELF (what number a 'moderate'
//           pick with cosine 0.6 becomes) is P3's to design; this contract pins only determinism and
//           the input/output shape, not the formula — nor whether a real implementation ever needs
//           the callback's async freedom (the ruling's whole point: it costs nothing to carry it
//           whether or not this particular mapping ever needs it).
//
// WORKED EXAMPLE: normalize('strong', 0.91, {}, (err, confidence) => {...}) always calls back with the
// same number, e.g. 0.91 (an identity mapping is one legal P3 choice among many; this contract does
// not prescribe the formula).
//
// THE GATES: normalizerShapeViolation(fn, label) -> ''|reason (arity); normalizerDeterminismViolation
// (normalizerFn, category, retrievalCosine, context) -> ''|reason — calls the function TWICE with
// IDENTICAL arguments and refuses if the two calls' callbacks disagree, if either reports an error, or
// if either did not deliver a finite number. Assumes synchronous callback invocation (as does the
// renderer's twin gate above).

const NORMALIZER_SHAPE = Object.freeze({ arity: 4, argKeys: null });

const normalizerShapeViolation = (fn, label = 'normalizer') => callableArityViolation(fn, NORMALIZER_SHAPE.arity, label);

// normalizerDeterminismViolation — calls the CALLBACK-SHAPED normalizer TWICE with identical inputs
// and compares the two callback deliveries. Assumes synchronous callback invocation (documented above).
const normalizerDeterminismViolation = (normalizerFn, category, retrievalCosine, context) => {
	if (typeof normalizerFn !== 'function') {
		return 'normalizer: not a function';
	}
	let firstErr;
	let firstConfidence;
	let firstCalled = false;
	normalizerFn(category, retrievalCosine, context, (err, confidence) => {
		firstCalled = true;
		firstErr = err;
		firstConfidence = confidence;
	});
	let secondErr;
	let secondConfidence;
	let secondCalled = false;
	normalizerFn(category, retrievalCosine, context, (err, confidence) => {
		secondCalled = true;
		secondErr = err;
		secondConfidence = confidence;
	});
	if (!firstCalled || !secondCalled) {
		return 'normalizer: did not invoke its callback synchronously (or at all) — this gate cannot observe an async delivery';
	}
	if (firstErr) {
		return `normalizer: first call's callback reported an error: ${firstErr}`;
	}
	if (secondErr) {
		return `normalizer: second call's callback reported an error: ${secondErr}`;
	}
	if (typeof firstConfidence !== 'number' || Number.isNaN(firstConfidence) || !Number.isFinite(firstConfidence)) {
		return `normalizer: callback did not deliver a finite number (got ${JSON.stringify(firstConfidence)})`;
	}
	if (typeof secondConfidence !== 'number' || Number.isNaN(secondConfidence) || !Number.isFinite(secondConfidence)) {
		return `normalizer: second call's callback did not deliver a finite number (got ${JSON.stringify(secondConfidence)})`;
	}
	if (firstConfidence !== secondConfidence) {
		return (
			'normalizer: two calls with IDENTICAL inputs delivered DIFFERENT confidence via their callbacks ' +
			'— determinism is the whole of this contract (⟪A4⟫)'
		);
	}
	return '';
};

// =====================================================================
// PLUS — THE FREEZE ADDITIONS ⟪A6⟫: the decision-block self-description fields. NOT a new freeze
// contract (lib/decisionFreezer.js is untouched, P1 additive discipline) — the additional field SET
// a P3 freeze implementation must stamp alongside whatever decisionFreezer already produces, so a
// decision block can describe its own generation and renderer version rather than requiring a reader
// to infer them.
// =====================================================================
//
// @typedef {Object} FreezeAdditions
// @property {string} generation       a generation identifier/format tag (R4: new evidence + prompt
//                                     => new picks by design => the inferred edges are a NEW generation)
// @property {string} rendererVersion  the RENDERER_VERSION the prompt was rendered with (⟪A2⟫, ⟪A6⟫)
// @property {*}      frozenEvidence   the frozen evidence packages themselves (⟪A6⟫: "Blocks
//                                     self-describe" — generation/format field + renderer version +
//                                     the frozen evidence, all three, together)
//
// THE GATE: freezeAdditionsViolation(decisionBlock) -> ''|reason — refuses a decision block missing
// any of the three fields, BY NAME.

const DECISION_BLOCK_FREEZE_ADDITIONS = Object.freeze(['generation', 'rendererVersion', 'frozenEvidence']);

const freezeAdditionsViolation = (decisionBlock) => {
	if (!decisionBlock || typeof decisionBlock !== 'object') {
		return 'decisionBlock: not an object';
	}
	const missing = DECISION_BLOCK_FREEZE_ADDITIONS.filter(
		(oneKey) => decisionBlock[oneKey] === undefined || decisionBlock[oneKey] === null,
	);
	if (missing.length) {
		return (
			`decisionBlock: missing self-describing field(s): ${missing.join(', ')} — ⟪A6⟫ requires a ` +
			`decision block to self-describe its generation and renderer version alongside the frozen evidence`
		);
	}
	if (typeof decisionBlock.generation !== 'string' || !decisionBlock.generation.trim()) {
		return 'decisionBlock.generation must be a non-empty string';
	}
	if (typeof decisionBlock.rendererVersion !== 'string' || !decisionBlock.rendererVersion.trim()) {
		return 'decisionBlock.rendererVersion must be a non-empty string';
	}
	return '';
};

// =====================================================================
// EVIDENCE_CONTRACTS — the same contract as data, in ONE registry (mirrors interfaces.js's
// COMPONENT_SHAPES aggregation), so "does every contract carry the DRAFT status marker" and "what
// does contract X declare" are both single lookups rather than six scattered reads.
// =====================================================================

const EVIDENCE_CONTRACTS = Object.freeze({
	evidencePackage: Object.freeze({ status: CONTRACT_STATUS, requiredKeys: EVIDENCE_PACKAGE_REQUIRED_KEYS }),
	matchCompose: Object.freeze({
		status: CONTRACT_STATUS,
		shape: MATCH_COMPOSE_SHAPE,
		obligations: MATCH_COMPOSE_OBLIGATIONS,
	}),
	hubModule: Object.freeze({ status: CONTRACT_STATUS, shape: HUB_MODULE_SHAPE }),
	renderer: Object.freeze({
		status: CONTRACT_STATUS,
		shape: RENDERER_SHAPE,
		compositionOrder: RENDERER_COMPOSITION_ORDER,
	}),
	select: Object.freeze({ status: CONTRACT_STATUS, shape: SELECT_SHAPE, categoryEnum: SELECT_CATEGORY_ENUM }),
	normalizer: Object.freeze({ status: CONTRACT_STATUS, shape: NORMALIZER_SHAPE }),
});

void moduleName; // self-identification kept for error strings' provenance only; no construction guard —
// every export here is a pure function or frozen data literal, exactly like interfaces.js itself.

module.exports = {
	CONTRACT_STATUS,
	EVIDENCE_CONTRACTS,

	// 1. evidence package
	EVIDENCE_PACKAGE_REQUIRED_KEYS,
	CANDIDATE_EVIDENCE_REQUIRED_KEYS,
	CONSIDERATIONS_REQUIRED_KEYS,
	evidencePackageViolation,
	candidateEvidenceViolation,

	// 2. match/compose
	MATCH_COMPOSE_SHAPE,
	MATCH_COMPOSE_OBLIGATIONS,
	matchComposeCallableViolation,
	matchComposeResultViolation,

	// 3. hub module
	HUB_MODULE_SHAPE,
	RANGE_SHAPES,
	hubModuleCallableViolation,
	hubModulePresentationViolation,

	// 4. renderer
	RENDERER_SHAPE,
	RENDERER_COMPOSITION_ORDER,
	rendererModuleViolation,
	rendererDeterminismViolation,

	// 5. select
	SELECT_SHAPE,
	SELECT_CATEGORY_ENUM,
	selectShapeViolation,
	selectResultViolation,

	// 6. normalizer
	NORMALIZER_SHAPE,
	normalizerShapeViolation,
	normalizerDeterminismViolation,

	// freeze additions ⟪A6⟫
	DECISION_BLOCK_FREEZE_ADDITIONS,
	freezeAdditionsViolation,

	// shared callable-shape checkers (exported for reuse by the test suite and any future contract)
	callableArityViolation,
	callableArgumentKeyViolation,
};
