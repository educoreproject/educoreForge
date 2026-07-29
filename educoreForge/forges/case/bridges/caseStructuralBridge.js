'use strict';

// caseStructuralBridge.js — Phase 5 (bridgeKitRefactor_072726 spec §6 Phase 5): a CUSTOM matcher for
// CASE, proving bridgeSkeleton's move-override seam on a real standard. ADDITIVE ONLY: this file
// copies forges/bridges/genericBridge.js's construction call and overrides EXACTLY ONE move —
// `match` — leaving walk/select/freeze/materialize and all of bridgeSkeleton's reusable
// orchestration (kit-member wiring-fault refusals, argument validation, the MATERIALIZE-vs-REBRIDGE
// dispatch, the vectorize step, the freeze/decisionStore round-trip, write-through-the-guarded-writer)
// exactly as genericBridge.js leaves them. No committed file is touched by this bridge's existence —
// bridgeSkeleton.js, genericBridge.js, lib.d/semanticMatcher.js, lib.d/selector.js and
// lib/inferredIndex.js are all read, never edited.
//
// WHY CASE WANTS A CUSTOM MATCHER (grounding facts below are CODE FACT — verified this session by
// reading forges/case/forgeCase.js + forges/case/lib/normalize.js, and by a READ-ONLY cypher query
// against GOLD_260718, never written to):
//
//   - CASE's mappable role is DmeProperty (194 :ForgedNode{_source:'CASE', role:'DmeProperty'} nodes
//     in GOLD_260718 — matches bridgeSkeleton's own defaultRole, no recipe change needed).
//   - CASE's stableId (casePath, forges/case/lib/normalize.js buildCasePath) is a STRUCTURAL locator
//     minted from the OpenAPI schema shape: 'case:<ClassName>.<propertyName>' for a property (e.g.
//     'case:CFAssociation.associationType', 'case:CFAssociationGrouping.description') — CASE has no
//     native per-element URI at all (DESIGN §D case 3, forgeCase.js's own header).
//   - A CASE property's defText (the field the base cosine embeds — sourceWalker.js's
//     flattenNodeRecord: props.defText || props.description || props.searchText || props.name) is
//     frequently THIN or EMPTY: sampled from GOLD_260718, case:CFAssociation.CFAssociationGroupingURI,
//     case:CFAssociation.CFDocumentURI, case:CFAssociation.destinationNodeURI,
//     case:CFAssociation.extensions and case:CFAssociation.originNodeURI ALL forge with
//     description:'' (empty string, forgeCase.js line ~168 `description: description || ''`) — the
//     base cosine for these properties is matching on searchText/name fallback text alone.
//   - The OWNING CLASS name (CFAssociation, CFItem, CFDocument, CFDefinition, ...) is ALWAYS present
//     on every property's casePath and is semantically loaded even when the property's own prose is
//     not — a signal the default matcher (lib.d/semanticMatcher, pure source.vector-vs-candidate.vector
//     cosine) has NO access to at all, because sourceWalker.js's flattened record shape carries no
//     structural-context field a matcher could read off the record directly; the ONLY place the class
//     name survives to the match move is the casePath itself (source.stableId).
//   - CEDS candidate DmeProperty records (the OTHER side of the match) expose, after flattening
//     (sourceWalker.js's flattenCandidateRecord): stableId, name, defText (= description for CEDS —
//     sampled from GOLD_260718, defText is null on every CEDS property, description is populated:
//     e.g. cedsId P000001 name 'Academic Award Date' description 'The year, month and day or year
//     and month on which the academic award was conferred.'), cedsId. CEDS's own domain/hub-class name
//     (e.g. 'Postsecondary Student Academic Award', folded into searchText but NOT flattened onto the
//     record — sourceWalker.js keeps only defText/description, never searchText, as a discrete field)
//     is NOT available on the flattened candidate record either. So the structural affinity below
//     compares CASE's OWN class+property name tokens against CEDS's OWN name+description tokens — a
//     real, deterministic, hermetically-testable text signal, but see the PROVENANCE section below for
//     what does and doesn't reach a materialized edge.
//
// THE BLEND (design authority's frame, spec §6 Phase 5): blendedScore = baseCosine +
// STRUCT_WEIGHT * structuralAffinity(pathTokens, candidateTokens). STRUCT_WEIGHT=0 collapses this
// matcher's ranking EXACTLY onto genericBridge's pure-cosine ranking (test-caseStructuralBridge.js's
// RED case proves this); STRUCT_WEIGHT>0 lets a path-disambiguated fixture pick a DIFFERENT top
// candidate than pure cosine would (the GREEN case). The pool is ranked/sliced by the blend — that is
// what `select()` sees, in order, and what the cosine-floor pre-abstain gates on (pool[0]).
//
// STRUCTURAL AFFINITY — pure, deterministic, no embeddings: tokenize the casePath's className AND
// propertyName segments (camelCase-split, lowercased, stopword/short-token filtered) and the
// candidate's name+defText the SAME way, then score the OVERLAP COEFFICIENT (|intersection| /
// min(|A|,|B|)) — chosen over Jaccard because a 2-4-token path set against a full-sentence
// description would otherwise score near-zero even on a strong containment match (Jaccard divides by
// the UNION, which a short set can never dominate).
//
// PROVENANCE — what IS and ISN'T preserved downstream of this move (read before trusting a
// materialized edge's cosineScore/confidence as "the blend" — it is NOT):
//   - Each pool entry this matcher returns keeps `cosine` as the PURE base cosine (never overwritten
//     with the blend) and ALSO carries `structuralScore` as a separate field — so any consumer reading
//     the raw pool sees both signals distinctly, and RANKING/topK/the floor-gate are genuinely driven
//     by the blend even though the persisted `cosine` field is not.
//   - Downstream of match, this bridge overrides NOTHING else (Phase 5 asks for ONE move override,
//     proving the seam — not a plumbing rewrite of committed code). lib.d/selector.js's
//     selectFromPool builds its poolSummary and its decision's cosineScore/bestCosine by reading ONLY
//     `entry.cosine` and `entry.candidate` off each pool entry (selector.js ~lines 90-94, 139-141) —
//     `structuralScore` is silently dropped there, never reaching the frozen decision.
//   - lib/inferredIndex.js's buildInferredSubgraph (the materialize move) reads a FIXED field set off
//     each decision (confidence/rerankScore/cosineScore/retrievalRank), plus exactly two narrowly-named
//     optional passthroughs (scopeParentPredicate/scopeParentConfidence — a DIFFERENT concept, used by
//     the CTDL family-structure producer) — there is no slot for an arbitrary extra provenance number.
//   NET EFFECT: the structural signal genuinely INFLUENCES which candidates enter the topK pool, their
//   order, and (via pool[0]) the cosine-floor abstain decision — a real, load-bearing effect on WHICH
//   candidate gets picked. But the MATERIALIZED EDGE's cosineScore/confidence is the CHOSEN candidate's
//   PURE base cosine (honest, never the blend), and the structuralScore that helped surface that
//   candidate is NOT separately persisted anywhere past this in-memory retrieve() call. Closing that
//   gap would mean ALSO overriding `select` (to carry structuralScore into the decision object) and
//   widening inferredIndex's field set (a committed-code change) — both out of Phase 5's additive,
//   single-move-override scope. Reported here per design authority's instruction rather than silently
//   collapsed into the blend.
//
// House style: qtools curried moduleFunction pattern for the pure helpers; the match move itself is
// SYNCHRONOUS (matching bridgeSkeleton's own contract: "match... SYNCHRONOUS, may THROW"); no
// async/await, no try/catch for control flow; camelCase, compound names.

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const makeBridgeSkeleton = require(
	path.join(
		__dirname,
		'..',
		'..',
		'..',
		'apps',
		'graph-builder',
		'apps',
		'bridge-maker',
		'lib',
		'bridgeSkeleton',
	),
);

// STRUCT_WEIGHT — the ONE tunable knob for how hard the structural signal nudges the blend. cosine
// ranges [-1,1]; structuralAffinity ranges [0,1]; a 0.15 max nudge is enough to reorder close ties
// and rescue a thin-defText property's true class-context match without letting a lexical accident
// override a strong semantic mismatch. Exported so a caller (or a test) can override it explicitly.
const STRUCT_WEIGHT = 0.15;

// RAW_POOL_TOPK — how many candidates the blended ranking keeps, after considering the FULL
// candidatePool (not a pre-sliced-by-cosine-alone pool — the whole point of augmenting the base
// signal is that a candidate ranked outside cosine's own top-K can still surface here on structural
// strength). Matches lib.d/semanticMatcher's own default topK (15) — the SAME pool size
// selector.js's LLM prompt is built over, so this override does not silently change how many
// candidates the reranker considers.
const RAW_POOL_TOPK = 15;

// STOPWORDS — short function/connector words that carry no domain signal; filtered from BOTH sides
// of the structural-affinity comparison so they cannot manufacture a spurious overlap.
const STOPWORDS = new Set([
	'a',
	'an',
	'the',
	'of',
	'for',
	'is',
	'in',
	'on',
	'to',
	'and',
	'or',
	'with',
	'by',
	'this',
]);

// tokenize — camelCase/PascalCase/snake_case/whitespace-aware word split, lowercased, short-token and
// stopword filtered. Pure, deterministic. Exported for the unit test.
const tokenize = (rawText) => {
	if (rawText == null) {
		return [];
	}
	const spaced = `${rawText}`
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary: fooBar -> foo Bar
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym boundary: CFAssociation -> CF Association
		.replace(/[_\-.]+/g, ' ')
		.replace(/[^A-Za-z0-9 ]+/g, ' ');
	return spaced
		.toLowerCase()
		.split(/\s+/)
		.filter((oneToken) => oneToken.length > 2 && !STOPWORDS.has(oneToken));
};

// CASE_PATH_SEGMENTS_RE — pull the className/propertyName segments off a CASE casePath stableId
// ('case:ClassName.propertyName'). A DmeProperty casePath (forgeCase.js propPath) is always exactly
// this two-segment shape; a stableId that does NOT match (a non-CASE source, or a future CASE tier
// this bridge was never built for) yields NO path tokens rather than a guessed split.
const CASE_PATH_SEGMENTS_RE = /^case:([^.]+)\.(.+)$/;

// pathTokensFromStableId — the structural-affinity signal's SOURCE side: className + propertyName,
// tokenized and unioned into one set. Exported for the unit test.
const pathTokensFromStableId = (stableId) => {
	const match = typeof stableId === 'string' ? stableId.match(CASE_PATH_SEGMENTS_RE) : null;
	if (!match) {
		return new Set();
	}
	const [, className, propertyName] = match;
	return new Set([...tokenize(className), ...tokenize(propertyName)]);
};

// candidateTokens — the structural-affinity signal's CANDIDATE side: name + defText, tokenized and
// unioned. Exported for the unit test.
const candidateTokens = (candidate) => {
	const record = candidate || {};
	return new Set([...tokenize(record.name), ...tokenize(record.defText)]);
};

// overlapCoefficient — |intersection| / min(|A|,|B|), 0 when either set is empty. Chosen over Jaccard
// (|intersection|/|union|) because the SOURCE side here is a short 2-6-token path set compared
// against a CANDIDATE side that can be a full-sentence description; Jaccard's union denominator would
// keep the score near zero even on total containment of the short set, which is exactly the case a
// class-name match (e.g. 'association' contained in a much longer CEDS description) should reward.
const overlapCoefficient = (setA, setB) => {
	if (!setA.size || !setB.size) {
		return 0;
	}
	let matches = 0;
	setA.forEach((oneToken) => {
		if (setB.has(oneToken)) {
			matches += 1;
		}
	});
	return matches / Math.min(setA.size, setB.size);
};

// structuralAffinity — the exported pure scoring function: (pathTokenSet, candidateRecord) -> [0,1].
const structuralAffinity = (pathTokenSet, candidate) => overlapCoefficient(pathTokenSet, candidateTokens(candidate));

// caseStructuralMatchMove — the ONE overridden move. Signature matches bridgeSkeleton's documented
// match-move contract EXACTLY: ({ kit, matcherName }) -> { retrieve(source, candidatePool) -> pool },
// SYNCHRONOUS, may throw. Reuses kit.semanticMatcher.cosine (the SAME base cosine function
// lib.d/semanticMatcher.js exports, already instantiated by kitLoader.buildKit regardless of this
// override — "overriding match drops the REQUIREMENT, not the kit member's presence") rather than
// re-implementing or re-requiring a second copy of cosine — the base signal this bridge augments is
// literally the same function genericBridge's default matcher uses, never a reimplementation that
// could silently drift from it.
const caseStructuralMatchMove = ({ kit, matcherName } = {}) => {
	void matcherName; // this override does not dispatch through candidateFinder at all — see file header.
	if (!kit || !kit.semanticMatcher || typeof kit.semanticMatcher.cosine !== 'function') {
		throw new Error(
			`${moduleName}: kit.semanticMatcher.cosine is not available — this override augments the ` +
				`SAME base cosine lib.d/semanticMatcher.js exports (kitLoader.buildKit always instantiates ` +
				`kit.semanticMatcher whether or not a bridge overrides match); there is no fallback base ` +
				`cosine implementation here by design (never a silent second copy).`,
		);
	}
	const { cosine } = kit.semanticMatcher;

	const retrieve = (source, candidatePool) => {
		const pathTokenSet = pathTokensFromStableId(source && source.stableId);
		const scored = (candidatePool || []).map((oneCandidate) => {
			const baseCosine = cosine(source && source.vector, oneCandidate.vector);
			const structuralScore = structuralAffinity(pathTokenSet, oneCandidate);
			return {
				candidate: oneCandidate,
				cosine: baseCosine, // PURE base cosine — never overwritten with the blend (see PROVENANCE above).
				structuralScore, // carried for observability; dropped by selector.js's poolSummary downstream.
				blended: baseCosine + STRUCT_WEIGHT * structuralScore,
			};
		});
		scored.sort((a, b) => b.blended - a.blended);
		return scored.slice(0, RAW_POOL_TOPK).map(({ candidate, cosine: entryCosine, structuralScore }) => ({
			candidate,
			cosine: entryCosine,
			structuralScore,
		}));
	};

	return { retrieve, cosine, structuralAffinity };
};

module.exports = makeBridgeSkeleton({
	mappingTool: 'caseStructuralBridge',
	hubStandard: 'CEDS',
	defaultRole: 'DmeProperty',
	// no defaultMatcherName — moves.match is supplied below, so bridgeSkeleton's own construction-time
	// guard does not require one (see bridgeSkeleton.js's makeBridgeSkeleton: "Supply moves.match
	// instead if this bridge does not use candidateFinder dispatch at all.").
	materializerConfig: {
		predicate: 'closeMatch',
		mappingJustification: 'semapv:SemanticSimilarity',
	},
	moves: {
		match: caseStructuralMatchMove,
	},
});

// Exported for the unit test ONLY (test-caseStructuralBridge.js) — the bridge module itself is
// consumed through bridgeMaker's resolver, never through these named exports; qtools convention
// (sourceWalker.js's own flattenNodeRecord/flattenCandidateRecord exports) for making a bridge's pure
// internals directly, hermetically testable without standing up a full skeleton run.
module.exports.tokenize = tokenize;
module.exports.pathTokensFromStableId = pathTokensFromStableId;
module.exports.candidateTokens = candidateTokens;
module.exports.overlapCoefficient = overlapCoefficient;
module.exports.structuralAffinity = structuralAffinity;
module.exports.caseStructuralMatchMove = caseStructuralMatchMove;
module.exports.STRUCT_WEIGHT = STRUCT_WEIGHT;
module.exports.RAW_POOL_TOPK = RAW_POOL_TOPK;
