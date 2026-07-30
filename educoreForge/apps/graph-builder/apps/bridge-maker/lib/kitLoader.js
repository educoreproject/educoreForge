'use strict';

// kitLoader.js — discovers and instantiates the lib.d KIT (bridgeKitRefactor_072726 design §4.1).
// ADDITIVE: bridgeMaker gains buildKit() alongside its existing componentLibrary.buildComponentLibrary,
// which stays byte-untouched so the three existing bridges keep composing the old flat bag unchanged
// (design P2 — coexist, then tear out; nothing here is called by ctdlAuthoredBridge, semanticBridge,
// or ctdlFamilyStructure).
//
// DISCOVERY IS REAL, not a hand-maintained list dressed up as one: fs.readdirSync over lib.d/ (or an
// injected libDDir, so the suite can point at a temp fixture directory and prove the fault twin
// without touching the real kit). EXPECTED_KIT_MODULES (design §4.1's table) is the ONE place the
// kit's membership is declared; a directory MISSING a declared module, or carrying a file that is
// NOT one of the nine, is refused BY NAME before a single module is required — a partial or
// surprise kit is never silently instantiated (polyArch2 §6). This is what makes deleting or
// renaming a kit module file LOUD: the loader's own construction throws, naming exactly what
// drifted, rather than the kit quietly missing a member three call-sites downstream.
//
//   buildKit({ inGraph, graphWriter, edgePolicy, config, decisionStore, rebridge, inferenceConfig,
//              componentOverrides, libDDir? }) -> kit
//
//     kit.graphReader     — lib.d/graphReader({ inGraph })                      (or componentOverrides.graphReader)
//     kit.writer           — lib.d/writer({ graphWriter, edgePolicy })
//     kit.vectorizer        — lib.d/vectorizer(config.vectorizerConfig)          (or componentOverrides.vectorizer —
//                             the NET seam double the suite injects, mirroring componentLibrary's own seam)
//     kit.decisionFreezer   — lib.d/decisionFreezer()
//     kit.sourceWalker      — lib.d/sourceWalker({ graphReader: kit.graphReader })
//     kit.semanticMatcher   — lib.d/semanticMatcher({ topK: inferenceConfig.topK })
//     kit.candidateFinder   — lib.d/candidateFinder({ semanticMatcher: kit.semanticMatcher })
//     kit.selector          — lib.d/selector({ llmClient, cosineFloor })         built ONLY when
//                             inferenceConfig.llmClient is injected (a materialize-only kit build has
//                             no reranker to build one with — the same "no llmClient, no reranker"
//                             line semanticBridge.js's own --rebridge guard already draws); else null.
//     kit.materializer      — lib.d/materializer, the inferredIndex FACTORY, UNINSTANTIATED — a
//                             producer composes it with its OWN mapping options per run, exactly as
//                             componentLibrary hands producers `library.inferredIndex` today.
//     kit.decisionStore / kit.rebridge / kit.config — the per-run inferred inputs, passed straight through.
//
// ⟪P3 ADDITIONS⟫ bridgeEvidenceRefactor-spec.md §7 P3 kit wiring — the evidence path's six new members,
// unconditionally built (none of them needs an llmClient AT CONSTRUCTION — see evidenceSelect's own
// header for why that differs from kit.selector):
//     kit.cedsHubModule     — lib.d/cedsHubModule({}), the REAL CEDS hub module (R5): (candidate,
//                             callback(err, baseTupleEvidence)).
//     kit.evidenceRenderer  — lib.d/evidenceRenderer(), the named pure renderer: { render, RENDERER_VERSION }.
//     kit.evidenceSelect    — lib.d/evidenceSelect({ renderer: kit.evidenceRenderer }), the evidence-
//                             based judge (SIBLING of kit.selector, not built from it). llmClient rides
//                             the CALL signature (⟪TQ RULING⟫/SELECT_SHAPE), not construction, so this
//                             is built on EVERY kit regardless of inferenceConfig.llmClient.
//     kit.confidenceNormalizer — lib.d/confidenceNormalizer(), the deterministic f(category, cosine, context).
//     kit.evidenceComposer  — lib.d/evidenceComposer (THIN WRAPPER over lib/evidenceComposer.js),
//                             UNINSTANTIATED — a bare factory, exactly like kit.materializer: a
//                             producer composes it with its OWN per-run { semanticMatcher, nominate,
//                             walk, dependencies } (recipe/standard-specific, never generic across a
//                             whole kit build).
//     kit.evidenceFreezer   — lib.d/evidenceFreezer (THIN WRAPPER over lib/evidenceFreezer.js), a
//                             no-arg FACTORY invoked here exactly like kit.decisionFreezer.
//
// Construction is SYNCHRONOUS; a wiring fault THROWS (matching componentLibrary's own construction-
// time invariants: relationshipWriterFactory/decisionFreezerFactory etc. all throw at construction,
// never three steps into a run) rather than surfacing as a mid-run crash.

const fs = require('fs');
const path = require('path');

const LIB_D_DIR = path.join(__dirname, '..', 'lib.d');

// EXPECTED_KIT_MODULES — design §4.1's table, as DATA. The ONE declaration of the kit's membership;
// discovery below checks the directory AGAINST this list rather than trusting whatever is present.
const EXPECTED_KIT_MODULES = [
	'writer',
	'graphReader',
	'vectorizer',
	'sourceWalker',
	'semanticMatcher',
	'selector',
	'decisionFreezer',
	'materializer',
	'candidateFinder',
	// ⟪P3 ADDITIONS⟫ bridgeEvidenceRefactor-spec.md §7 — the evidence path's six new kit members.
	'cedsHubModule',
	'evidenceRenderer',
	'evidenceSelect',
	'confidenceNormalizer',
	'evidenceComposer',
	'evidenceFreezer',
];

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// discoverKitModuleNames — the *.js basenames (minus extension) sitting in libDDir, sorted. A
// non-existent directory discovers nothing (an empty scope, not a thrown surprise here — the
// membership check below is what turns "nothing discovered" into a named refusal).
const discoverKitModuleNames = (libDDir) => {
	if (!fs.existsSync(libDDir)) {
		return [];
	}
	return fs
		.readdirSync(libDDir)
		.filter((oneName) => /\.js$/.test(oneName))
		.map((oneName) => oneName.replace(/\.js$/, ''))
		.sort();
};

// verifyKitMembership — refuse BY NAME on ANY drift between the directory and EXPECTED_KIT_MODULES.
// Returns '' when the directory's membership matches exactly; an error string otherwise (never
// throws itself — buildKit decides whether a violation is fatal, and the suite can inspect the
// string directly without constructing a whole kit just to provoke the throw).
const verifyKitMembership = (libDDir) => {
	const discovered = discoverKitModuleNames(libDDir);
	const missing = EXPECTED_KIT_MODULES.filter((oneName) => !discovered.includes(oneName));
	const unexpected = discovered.filter((oneName) => !EXPECTED_KIT_MODULES.includes(oneName));
	if (missing.length) {
		return (
			`${moduleName}: lib.d/ ('${libDDir}') is missing declared kit module(s): ${missing.join(', ')}. ` +
			`Discovery found only: ${discovered.join(', ') || '(none)'}.`
		);
	}
	if (unexpected.length) {
		return (
			`${moduleName}: lib.d/ ('${libDDir}') carries file(s) not in the declared kit: ${unexpected.join(', ')}. ` +
			`Known kit modules: ${EXPECTED_KIT_MODULES.join(', ')}.`
		);
	}
	return '';
};

const requireKitModule = (libDDir, oneName) => require(path.join(libDDir, `${oneName}.js`));

// START OF moduleFunction() ============================================================

// buildKit — discover + verify + instantiate. THROWS on any construction-time wiring fault (missing
// kit module, missing run resource) — matching every other construction-time invariant in this tree.
const buildKit = (
	{
		inGraph,
		graphWriter,
		edgePolicy,
		config = {},
		decisionStore = null,
		rebridge = null,
		inferenceConfig = {},
		componentOverrides = {},
		libDDir = LIB_D_DIR,
	} = {},
) => {
	const membershipViolation = verifyKitMembership(libDDir);
	if (membershipViolation) {
		throw new Error(membershipViolation);
	}
	if (!graphWriter) {
		throw new Error(
			`${moduleName}: constructed without a graphWriter — the kit's writer has nowhere to write.`,
		);
	}
	if (!edgePolicy) {
		throw new Error(
			`${moduleName}: constructed without an edgePolicy — the kit's writer has no contract to enforce.`,
		);
	}
	if (!inGraph) {
		throw new Error(
			`${moduleName}: constructed without an inGraph — the kit's graphReader has no graph to read.`,
		);
	}

	const kit = { config, decisionStore, rebridge };

	kit.graphReader = componentOverrides.graphReader
		? componentOverrides.graphReader({ inGraph })
		: requireKitModule(libDDir, 'graphReader')({ inGraph });

	kit.writer = requireKitModule(libDDir, 'writer')({ graphWriter, edgePolicy });

	// the NET seam (§3 hard line 2): componentOverrides.vectorizer is the suite's fixture-vector
	// double, mirroring componentLibrary.buildComponentLibrary's own componentOverrides seam exactly.
	kit.vectorizer = componentOverrides.vectorizer
		? componentOverrides.vectorizer(config.vectorizerConfig || {})
		: requireKitModule(libDDir, 'vectorizer')(config.vectorizerConfig || {});

	kit.decisionFreezer = requireKitModule(libDDir, 'decisionFreezer')();

	kit.sourceWalker = requireKitModule(libDDir, 'sourceWalker')({ graphReader: kit.graphReader });

	kit.semanticMatcher = requireKitModule(libDDir, 'semanticMatcher')({ topK: inferenceConfig.topK || 15 });

	kit.candidateFinder = requireKitModule(libDDir, 'candidateFinder')({ semanticMatcher: kit.semanticMatcher });

	// a materialize-only kit build (plain -build, no --rebridge) legitimately has no llmClient to
	// rerank with; selector is built ONLY when one is injected, exactly the same "no llmClient, no
	// reranker" line semanticBridge.js's own --rebridge guard already draws.
	kit.selector = inferenceConfig.llmClient
		? requireKitModule(libDDir, 'selector')({
				llmClient: inferenceConfig.llmClient,
				cosineFloor: inferenceConfig.cosineFloor || 0,
			})
		: null;

	// UNINSTANTIATED — a producer composes inferredIndex with its own mapping options per run,
	// exactly as componentLibrary hands producers `library.inferredIndex` as a bare factory today.
	kit.materializer = requireKitModule(libDDir, 'materializer');

	// ⟪P3 ADDITIONS⟫ bridgeEvidenceRefactor-spec.md §7 — the evidence path, unconditionally built
	// (see the file header's ⟪P3 ADDITIONS⟫ note for why none of these needs inferenceConfig.llmClient
	// at construction the way kit.selector does).
	kit.cedsHubModule = requireKitModule(libDDir, 'cedsHubModule')();
	kit.evidenceRenderer = requireKitModule(libDDir, 'evidenceRenderer')();
	kit.evidenceSelect = requireKitModule(libDDir, 'evidenceSelect')({ renderer: kit.evidenceRenderer });
	kit.confidenceNormalizer = requireKitModule(libDDir, 'confidenceNormalizer')();
	// bare, UNINSTANTIATED — a producer composes it with its own per-run spec (mirrors kit.materializer).
	kit.evidenceComposer = requireKitModule(libDDir, 'evidenceComposer');
	// invoked — a no-arg factory, exactly like kit.decisionFreezer (see lib.d/evidenceFreezer.js's wrapper header).
	kit.evidenceFreezer = requireKitModule(libDDir, 'evidenceFreezer')();

	return kit;
};

// END OF moduleFunction() ============================================================

module.exports = {
	buildKit,
	discoverKitModuleNames,
	verifyKitMembership,
	EXPECTED_KIT_MODULES,
	LIB_D_DIR,
};
