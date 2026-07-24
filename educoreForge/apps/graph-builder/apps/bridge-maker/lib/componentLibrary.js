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
// The NET components (vectorizer, and the selector's llm mode) run only in a real reforge, never
// the suite (§3 hard line 2). config/xLog travel with the library so a plugin reads them from its
// injected tools rather than reaching for process.global mid-compose.

const path = require('path');

const relationshipWriterFactory = require(path.join(__dirname, 'relationshipWriter'));
// referenceIndex — the ported pure mappingSubgraph (P2). A pure module needing no run resources, so it
// is injected as its FACTORY: a producer composes it with its OWN mapping options (subjectSource,
// versions, mappingTool — the producer's operational data, parameter-ownership §4) and calls
// buildMappingSubgraph. No graphWriter, no graphReader, no network.
const referenceIndexFactory = require(path.join(__dirname, 'referenceIndex'));

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

// The generic, hub-agnostic library (design §3, items 1-9) — skeletons except relationshipWriter.
const SKELETON_FACTORIES = {
	vectorizer: skeletonComponent(
		'vectorizer',
		'a real reforge (NET)',
		'vectorizer({provider}) ({texts}, cb) -> cb("", {vectors, embeddingModelVersion})',
	),
	semanticMatcher: skeletonComponent(
		'semanticMatcher',
		'P3 (PURE)',
		'semanticMatcher({vectorizer}) ({hub, hubVectorProperty, queryVector, candidatePool, topK}) -> candidates[]',
	),
	evidenceGatherer: skeletonComponent(
		'evidenceGatherer',
		'P3 (PURE)',
		'evidenceGatherer() ({sourceElement, candidate}) -> evidenceBundle',
	),
	selector: skeletonComponent(
		'selector',
		'P2 (threshold, PURE) / P3 (llm, NET)',
		'selector({mode}) ({candidates, evidence}, cb) -> cb("", {chosen|none, confidence, rationale})',
	),
	decisionFreezer: skeletonComponent(
		'decisionFreezer',
		'P3 (PURE)',
		'decisionFreezer() ({decisions}) -> frozenDecisionBlock (content-addressed)',
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

// START OF moduleFunction() ============================================================

const buildComponentLibrary = ({ graphWriter, graphReader, config = {}, xLog } = {}) => {
	const library = { config, xLog: xLog || (process.global && process.global.xLog) };

	Object.keys(SKELETON_FACTORIES).forEach((oneComponentName) => {
		library[oneComponentName] = SKELETON_FACTORIES[oneComponentName]();
	});

	// the ONE real WRITE seam — constructed over the run's graphWriter.
	library.relationshipWriter = relationshipWriterFactory({ graphWriter });

	// referenceIndex — real body (P2): the ported pure mappingSubgraph FACTORY, injected as-is (§3.7).
	// A producer instantiates it with its own mapping options; it needs no run resources.
	library.referenceIndex = referenceIndexFactory;

	// graphReader — the READ seam (P2), the twin of relationshipWriter's write seam. Injected as the
	// FACTORY bridgeMaker minted from the run's GraphHandle (default neo4jGraphReader; a double in the
	// suite). An authored producer mints+closes its own reader to WALK the dependency graph. It is a
	// required run resource: a library built without it hands a producer nothing to read, so absence is a
	// wiring fault the producer names, never a silent empty read (polyArch2 §6).
	library.graphReader = graphReader;

	return library;
};

// END OF moduleFunction() ============================================================

module.exports = { buildComponentLibrary, SKELETON_FACTORIES };
