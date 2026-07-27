'use strict';

// componentLibrary — the injectable "API" a bridge.js plugin composes (design §3). bridgeMaker
// builds it once per run and injects the whole object into the resolved plugin. forge.js and
// bridge.js are twin plugin slots over THIS one library (design §5); a component (the vectorizer)
// serves both sides, and nothing here knows a hub's name that was not handed to it.
//
// P0 STATE OF EACH COMPONENT. Only relationshipWriter (the WRITE seam) gets a real body in P0,
// because the write-into-graph substrate is what this phase lays and proves. The rest are
// CONTRACT SKELETONS: their signatures and roles are declared here so a producer can compose
// them, but their bodies land in P2 (authored EXACT_MATCH) and P3 (inferred CLOSE_MATCH + the
// frozen pre-pass). A skeleton THROWS if actually called — it must never silently no-op, because
// a no-op that returns an empty result is a false green (polyArch2 §6). The default generic
// plugin (genericBridge) composes the library but calls none of the skeletons: it writes zero
// edges in P0 and so exercises only the real resolve+run+return path.
//
//   buildComponentLibrary({ graphWriter, graphReader, config, xLog }) -> {
//       vectorizer, semanticMatcher, evidenceGatherer, selector, decisionFreezer,
//       relationshipWriter, graphReader, referenceIndex, sourceWalker, authoredCrosswalkLoader,
//       hubCandidateModule, config, xLog
//   }
//
// P2 UPDATE: relationshipWriter (WRITE seam), graphReader (READ seam) and referenceIndex (the ported pure
// mappingSubgraph) now have real bodies; the rest remain P0 skeletons filled by P3.
//
// P3a UPDATE: the inferred machinery lands — vectorizer (the ported def-embedder, NET), inferencePipeline
// (the ported retrieve/floor/rerank; takes the injected llmClient), inferredIndex (the ported pure
// inferredSubgraph materializer) and decisionFreezer (the content-addressed freeze) now have real bodies.
// The semantic producer (semanticBridge) composes them. Still-skeleton: semanticMatcher, evidenceGatherer,
// selector, sourceWalker, authoredCrosswalkLoader, hubCandidateModule — the incumbent FUSES retrieve+select
// inside inferencePipeline (which semanticBridge composes), so these decomposed slots are not called on the
// ported path; they remain loud skeletons rather than false-green no-ops (polyArch2 §6).
//
// The NET components (vectorizer, and the pipeline's llm rerank) run only in a real --rebridge, never the
// suite (§3 hard line 2). config/xLog travel with the library so a plugin reads them from its injected tools
// rather than reaching for process.global mid-compose. decisionStore/rebridge/inferenceConfig are the
// per-run inferred inputs, passed straight through from bridgeMaker.run.

const path = require('path');

// vocabulary — the single source of truth for the edge contract relationshipWriter enforces
// (sanctioned types, required stamps, mapping-predicate agreement). deriveEdgePolicy (below) is the
// ONLY place that reads it into the shape relationshipWriter consumes; nothing hand-copies these
// literals elsewhere (polyArch2 §6 — a duplicated list is how a guard and its source drift apart).
const vocabulary = require(path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const relationshipWriterFactory = require(path.join(__dirname, 'relationshipWriter'));
// referenceIndex — the ported pure mappingSubgraph (P2). A pure module needing no run resources, so it
// is injected as its FACTORY: a producer composes it with its OWN mapping options (subjectSource,
// versions, mappingTool — the producer's operational data, parameter-ownership §4) and calls
// buildMappingSubgraph. No graphWriter, no graphReader, no network.
const referenceIndexFactory = require(path.join(__dirname, 'referenceIndex'));
// P3a inferred components — ported faithfully from the incumbent (repointed requires). Pure factories
// (inferredIndex, decisionFreezer) and NET/injected ones (vectorizer, inferencePipeline) all injected AS
// FACTORIES; a producer composes each with its own options.
const inferredIndexFactory = require(path.join(__dirname, 'inferredIndex'));
const decisionFreezerFactory = require(path.join(__dirname, 'decisionFreezer'));
const vectorizerFactory = require(path.join(__dirname, 'vectorizer'));
const inferencePipelineFactory = require(path.join(__dirname, 'inferencePipeline'));

// -----
// skeletonComponent — a P0 contract stub. It is a curried moduleFunction like every real
// component, but its call method THROWS, naming the component and the phase its body lands in, so
// a premature call is a loud failure and never a silent empty result.
const skeletonComponent = (componentName, landsInPhase, contractLine) =>
	(constructionDeps = {}) =>
	(...callArgs) => {
		throw new Error(
			`bridge component '${componentName}' is a P0 skeleton (body lands in ${landsInPhase}). ` +
				`Contract: ${contractLine}. It was called before its body existed — the default generic ` +
				`plugin does not call it, so a real producer reached it too early.`,
		);
	};

// The generic, hub-agnostic library (design §3, items 1-9) — skeletons except the real bodies wired below.
const SKELETON_FACTORIES = {
	semanticMatcher: skeletonComponent(
		'semanticMatcher',
		'a later decomposition (the incumbent fuses retrieve+select in inferencePipeline)',
		'semanticMatcher({vectorizer}) ({hub, hubVectorProperty, queryVector, candidatePool, topK}) -> candidates[]',
	),
	evidenceGatherer: skeletonComponent(
		'evidenceGatherer',
		'a later decomposition (P3b prompt-tuning demotes evidenceBundle to prompt material, design §5.5)',
		'evidenceGatherer() ({sourceElement, candidate}) -> evidenceBundle',
	),
	selector: skeletonComponent(
		'selector',
		'a later decomposition (the incumbent fuses the cosineFloor+llm rerank in inferencePipeline)',
		'selector({mode}) ({candidates, evidence}, cb) -> cb("", {chosen|none, confidence, rationale})',
	),
	sourceWalker: skeletonComponent(
		'sourceWalker',
		'P2 (PURE)',
		'sourceWalker({extractor}) ({inGraph, sourceStandard}) -> sourceElements[]',
	),
	authoredCrosswalkLoader: skeletonComponent(
		'authoredCrosswalkLoader',
		'P2',
		'authoredCrosswalkLoader() ({crosswalkSource}) -> authoredMappings[]',
	),
	// hub-provided slot (design §3 item 10) — the hub's forge contributes the real one; P0 ships a
	// skeleton so the injected-tools shape is complete and a plugin can name it.
	hubCandidateModule: skeletonComponent(
		'hubCandidateModule',
		'a hub forge (P2/P3)',
		'hubCandidateModule({semanticMatcher}) ({sourceEvidence, mode}) -> candidates[] | bestOne',
	),
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// -----
// deriveEdgePolicy — the ONE DERIVATION of relationshipWriter's edgePolicy from vocabulary.js. A pure
// function of the vocabulary module (no run resources), exported so every construction site (this
// factory, and any test that needs a REAL policy rather than a hand-copied fixture) composes the
// SAME derivation. Never hand-copy these sets elsewhere — that is exactly how a guard and its source
// of truth drift apart (polyArch2 §6).
//
//   sanctionedTypes          — structural EDGE_TYPES ∪ SKOS mapping predicates ∪ CLASSIFICATION_EDGE_TYPES
//   structuralTypes          — EDGE_TYPES values (HAS_PROPERTY, HAS_OPTION_SET, SUBCLASS_OF, REFERENCES,
//                               REFERENCES_TYPE, HAS_SUPPORT, HAS_CLASS, HAS_VALUE)
//   mappingTypeToPredicate   — SKOS_EDGE_TYPES INVERTED: relationshipType -> predicate string
//                               ('EXACT_MATCH' -> 'exactMatch', 'CLOSE_MATCH' -> 'closeMatch', ...)
//   crosswalkTypes           — CLASSIFICATION_EDGE_TYPES values (CLASSIFICATION_CROSSWALK) — sanctioned,
//                               but deliberately NOT a mapping predicate (vocabulary.js: never a hub match)
//   requiredEdgeProperties   — REQUIRED_PROPERTIES.EDGE (['provenanceTier'])
//   structuralProvenanceTier — PROVENANCE_TIER.STRUCTURAL ('structural')
//   closeMatchType           — SKOS_EDGE_TYPES.closeMatch ('CLOSE_MATCH') — the one mapping type that
//                               additionally requires decisionBlockHash + confidence
const deriveEdgePolicy = (vocab = vocabulary) => {
	const structuralTypes = new Set(Object.values(vocab.EDGE_TYPES));
	const mappingTypeToPredicate = {};
	Object.keys(vocab.SKOS_EDGE_TYPES).forEach((onePredicate) => {
		mappingTypeToPredicate[vocab.SKOS_EDGE_TYPES[onePredicate]] = onePredicate;
	});
	const crosswalkTypes = new Set(Object.values(vocab.CLASSIFICATION_EDGE_TYPES));
	const sanctionedTypes = new Set([
		...structuralTypes,
		...Object.keys(mappingTypeToPredicate),
		...crosswalkTypes,
	]);
	return {
		sanctionedTypes,
		structuralTypes,
		mappingTypeToPredicate,
		crosswalkTypes,
		requiredEdgeProperties: vocab.REQUIRED_PROPERTIES.EDGE,
		structuralProvenanceTier: vocab.PROVENANCE_TIER.STRUCTURAL,
		closeMatchType: vocab.SKOS_EDGE_TYPES.closeMatch,
	};
};

// START OF moduleFunction() ============================================================

const buildComponentLibrary = ({
	graphWriter,
	graphReader,
	decisionStore = null,
	rebridge = null,
	inferenceConfig = {},
	config = {},
	// componentOverrides — the NET seam (§3 hard line 2). The vectorizer reaches Voyage, so the SUITE
	// replaces it with a fake that returns fixture vectors; a production build passes nothing and gets the
	// real ported def-embedder. Any named entry here REPLACES the wired component AFTER the real bodies are
	// installed, so a test proves the whole compose/run path with a double and no network. Mirrors build.js's
	// deps.components seam.
	componentOverrides = {},
	xLog,
} = {}) => {
	const library = { config, xLog: xLog || (process.global && process.global.xLog) };

	Object.keys(SKELETON_FACTORIES).forEach((oneComponentName) => {
		library[oneComponentName] = SKELETON_FACTORIES[oneComponentName]();
	});

	// the ONE real WRITE seam — constructed over the run's graphWriter PLUS the edgePolicy DERIVED from
	// the vocabulary (deriveEdgePolicy above). Every producer's edges pass through this ONE guarded
	// instance; there is no path to graphWriter that skips it (see the invariant assertion below).
	library.relationshipWriter = relationshipWriterFactory({ graphWriter, edgePolicy: deriveEdgePolicy() });

	// P3a inferred components — injected as FACTORIES (a producer composes each with its own options).
	// inferredIndex + decisionFreezer are PURE; vectorizer + inferencePipeline are NET/llm-bound and run
	// only in a real --rebridge, never the suite. inferenceConfig ({ llmClient, topK, cosineFloor,
	// concurrency }) travels for the producer to hand inferencePipeline; decisionStore and rebridge are the
	// per-run inferred inputs (a plain build reads a frozen block from the store; --rebridge writes one).
	library.inferredIndex = inferredIndexFactory;
	library.decisionFreezer = decisionFreezerFactory;
	library.vectorizer = vectorizerFactory;
	library.inferencePipeline = inferencePipelineFactory;
	library.inferenceConfig = inferenceConfig;
	library.decisionStore = decisionStore;
	library.rebridge = rebridge;

	// componentOverrides — the LAST word (the NET seam). A named override replaces the wired component so a
	// test can drive the whole path with a fake vectorizer and no Voyage call.
	Object.keys(componentOverrides || {}).forEach((oneName) => {
		library[oneName] = componentOverrides[oneName];
	});

	// referenceIndex — real body (P2): the ported pure mappingSubgraph FACTORY, injected as-is (§3.7).
	// A producer instantiates it with its own mapping options; it needs no run resources.
	library.referenceIndex = referenceIndexFactory;

	// graphReader — the READ seam (P2), the twin of relationshipWriter's write seam. Injected as the
	// FACTORY bridgeMaker minted from the run's GraphHandle (default neo4jGraphReader; a double in the
	// suite). An authored producer mints+closes its own reader to WALK the dependency graph. It is a
	// required run resource: a library built without it hands a producer nothing to read, so absence is a
	// wiring fault the producer names, never a silent empty read (polyArch2 §6).
	library.graphReader = graphReader;

	// INVARIANT — the raw graphWriter is NEVER placed on the returned library object. It is used ONLY
	// to construct the guarded relationshipWriter above; a plugin composing this library can reach the
	// graph ONLY through that guarded seam, never around it. If some future edit ever assigns
	// `library.graphWriter = ...`, this throws immediately rather than silently reopening the
	// unguarded path (polyArch2 §6 — the invariant is asserted, not merely commented).
	if (library.graphWriter !== undefined) {
		throw new Error(
			`${moduleName}: invariant violated — the raw graphWriter must never be placed on the ` +
				`returned component library (plugins receive only the guarded relationshipWriter). ` +
				`library.graphWriter was set.`,
		);
	}

	return library;
};

// END OF moduleFunction() ============================================================

module.exports = { buildComponentLibrary, SKELETON_FACTORIES, deriveEdgePolicy };
