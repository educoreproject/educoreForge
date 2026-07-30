#!/usr/bin/env node
'use strict';

// test-kit-loader.js — hermetic gate for lib/kitLoader.js (bridgeKitRefactor_072726 Phase 1, design
// §4.1 — "each a discovered qtools module, instantiated once per run"). Proves DISCOVERY is real,
// not a hand-maintained list dressed up as one:
//   RED  — a lib.d/ fixture directory MISSING a declared kit module is refused BY NAME (naming
//          exactly what is missing); a fixture directory carrying an EXTRA, unrecognized file is
//          refused BY NAME too (naming exactly what is unexpected) — a partial or surprise kit is
//          never silently instantiated.
//   GREEN — building the kit against the REAL lib.d/ directory succeeds and produces every declared
//          member, correctly shaped: the writer/graphReader/sourceWalker/semanticMatcher/
//          decisionFreezer are functions/objects with their expected methods, the
//          materializer travels UNINSTANTIATED (a bare factory), selector is null when no
//          llmClient is injected and present when one is, and the NET seam (componentOverrides.
//          vectorizer) is honoured exactly as componentLibrary's own seam is.
//
// ⟪P5 TEARDOWN, 2026-07-30⟫ — candidateFinder dropped from the kit (lib.d/candidateFinder.js RETIRED;
// see kitLoader.js's own tombstone). It dispatched a recipe's matcher-name token to a matcher
// implementation ONLY for bridgeSkeleton.js's defaultMatchMove, which is retired alongside it; no
// surviving kit consumer ever read kit.candidateFinder.
//
// PURE / hermetic: graphWriter/graphReader/vectorizer DOUBLES only; no Neo4j, no network, no LLM.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-kit-loader.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d kit loader (bridgeMaker.buildKit)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves kit membership discovery/verification against temp fixture lib.d directories (RED: a
     missing or an unrecognized module file is refused by name), and that buildKit(), run against
     the REAL lib.d/, produces every declared member correctly shaped (GREEN).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const kitLoader = require('../lib/kitLoader');
const { deriveEdgePolicy } = require('../lib/componentLibrary');

// ---- temp fixture lib.d directories (created + torn down inline; no dependency on the real kit) ----
const makeTempLibD = (fileNames) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitLoaderFixture-'));
	fileNames.forEach((oneName) => fs.writeFileSync(path.join(dir, `${oneName}.js`), `module.exports = () => ({});\n`));
	return dir;
};
const cleanupTempDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// =====================================================================
harness.section('RED — a lib.d/ fixture MISSING a declared kit module is refused BY NAME');
// =====================================================================
(() => {
	const incompleteModules = kitLoader.EXPECTED_KIT_MODULES.filter((oneName) => oneName !== 'selector');
	const fixtureDir = makeTempLibD(incompleteModules);
	try {
		harness.match(
			'verifyKitMembership names the missing module',
			kitLoader.verifyKitMembership(fixtureDir),
			/missing declared kit module\(s\): selector/,
		);
		harness.match(
			'buildKit() throws the SAME missing-module message',
			(() => {
				try {
					kitLoader.buildKit({
						inGraph: {},
						graphWriter: {},
						edgePolicy: deriveEdgePolicy(),
						libDDir: fixtureDir,
					});
					return '';
				} catch (buildError) {
					return buildError.message;
				}
			})(),
			/missing declared kit module\(s\): selector/,
		);
	} finally {
		cleanupTempDir(fixtureDir);
	}
})();

// =====================================================================
harness.section('RED — a lib.d/ fixture carrying an UNRECOGNIZED file is refused BY NAME');
// =====================================================================
(() => {
	const surplusModules = kitLoader.EXPECTED_KIT_MODULES.concat(['someRandomExtraFile']);
	const fixtureDir = makeTempLibD(surplusModules);
	try {
		harness.match(
			'verifyKitMembership names the unexpected file',
			kitLoader.verifyKitMembership(fixtureDir),
			/carries file\(s\) not in the declared kit: someRandomExtraFile/,
		);
	} finally {
		cleanupTempDir(fixtureDir);
	}
})();

// =====================================================================
harness.section('RED — buildKit() construction-resource guards (graphWriter / edgePolicy / inGraph)');
// =====================================================================
const edgePolicy = deriveEdgePolicy();
harness.match(
	'missing graphWriter throws, naming the reason',
	(() => {
		try {
			kitLoader.buildKit({ inGraph: {}, edgePolicy });
			return '';
		} catch (e) {
			return e.message;
		}
	})(),
	/constructed without a graphWriter/,
);
harness.match(
	'missing edgePolicy throws, naming the reason',
	(() => {
		try {
			kitLoader.buildKit({ inGraph: {}, graphWriter: {} });
			return '';
		} catch (e) {
			return e.message;
		}
	})(),
	/constructed without an edgePolicy/,
);
harness.match(
	'missing inGraph throws, naming the reason',
	(() => {
		try {
			kitLoader.buildKit({ graphWriter: {}, edgePolicy });
			return '';
		} catch (e) {
			return e.message;
		}
	})(),
	/constructed without an inGraph/,
);

// =====================================================================
harness.section('GREEN — buildKit() against the REAL lib.d/ produces every declared member, correctly shaped');
// =====================================================================
(() => {
	const graphWriterDouble = { writeRelationshipEdge: (spec, cb) => cb('', { edgeWritten: true }) };
	const graphReaderDouble = () => ({ readNodes: (spec, cb) => cb('', { nodes: [] }), close: (cb) => cb('') });
	const fakeVectorizerFactory = () => ({ batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map(() => null) }) });

	// A — materialize-only build (no llmClient): selector must be null (no reranker to build one with).
	const materializeKit = kitLoader.buildKit({
		inGraph: { graphName: 'DEV_probe', boltUrl: 'bolt://x', password: 'x' },
		graphWriter: graphWriterDouble,
		edgePolicy,
		componentOverrides: { graphReader: graphReaderDouble, vectorizer: fakeVectorizerFactory },
	});
	harness.equal('kit.writer is a function (the write seam)', typeof materializeKit.writer, 'function');
	harness.equal('kit.graphReader.readNodes is a function', typeof materializeKit.graphReader.readNodes, 'function');
	harness.equal('kit.vectorizer.batchEmbed is a function', typeof materializeKit.vectorizer.batchEmbed, 'function');
	harness.equal('kit.decisionFreezer.freeze is a function', typeof materializeKit.decisionFreezer.freeze, 'function');
	harness.equal('kit.sourceWalker.walk is a function', typeof materializeKit.sourceWalker.walk, 'function');
	harness.equal('kit.semanticMatcher.retrieve is a function', typeof materializeKit.semanticMatcher.retrieve, 'function');
	harness.equal('kit.candidateFinder is gone (retired P5 — no surviving consumer)', materializeKit.candidateFinder, undefined);
	harness.equal('kit.materializer travels UNINSTANTIATED (a bare factory)', typeof materializeKit.materializer, 'function');
	harness.equal('kit.materializer IS the real inferredIndex factory', materializeKit.materializer, require('../lib/inferredIndex'));
	harness.equal('no llmClient injected -> kit.selector is null', materializeKit.selector, null);

	// B — a --rebridge build WITH an llmClient: selector must be built.
	const stubLlm = { rerank: (a, cb) => cb('', { choice: '1' }) };
	const rebridgeKit = kitLoader.buildKit({
		inGraph: { graphName: 'DEV_probe', boltUrl: 'bolt://x', password: 'x' },
		graphWriter: graphWriterDouble,
		edgePolicy,
		componentOverrides: { graphReader: graphReaderDouble, vectorizer: fakeVectorizerFactory },
		inferenceConfig: { llmClient: stubLlm, topK: 10, cosineFloor: 0.5 },
	});
	harness.equal('llmClient injected -> kit.selector.selectFromPool is a function', typeof rebridgeKit.selector.selectFromPool, 'function');
})();

// =====================================================================
harness.section('⟪P3⟫ GREEN — the evidence path\'s six new kit members, correctly shaped');
// =====================================================================
(() => {
	const graphWriterDouble = { writeRelationshipEdge: (spec, cb) => cb('', { edgeWritten: true }) };
	const graphReaderDouble = () => ({ readNodes: (spec, cb) => cb('', { nodes: [] }), close: (cb) => cb('') });
	const fakeVectorizerFactory = () => ({ batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map(() => null) }) });

	const kit = kitLoader.buildKit({
		inGraph: { graphName: 'DEV_probe', boltUrl: 'bolt://x', password: 'x' },
		graphWriter: graphWriterDouble,
		edgePolicy,
		componentOverrides: { graphReader: graphReaderDouble, vectorizer: fakeVectorizerFactory },
	});

	harness.equal('kit.cedsHubModule is a function (candidate, callback), arity 2', kit.cedsHubModule.length, 2);
	harness.equal('kit.evidenceRenderer.render is a function', typeof kit.evidenceRenderer.render, 'function');
	harness.equal(
		'kit.evidenceRenderer.RENDERER_VERSION is a non-empty string',
		typeof kit.evidenceRenderer.RENDERER_VERSION === 'string' && !!kit.evidenceRenderer.RENDERER_VERSION.trim(),
		true,
	);
	harness.equal('kit.evidenceSelect is a function (renderedPromptOrPackage, llmClient, callback), arity 3', kit.evidenceSelect.length, 3);
	harness.equal('kit.confidenceNormalizer is a function (category, cosine, context, callback), arity 4', kit.confidenceNormalizer.length, 4);
	harness.equal(
		'kit.evidenceComposer travels UNINSTANTIATED (a bare factory, like kit.materializer)',
		typeof kit.evidenceComposer,
		'function',
	);
	harness.equal('kit.evidenceComposer IS the real lib/evidenceComposer.js factory', kit.evidenceComposer, require('../lib/evidenceComposer'));
	harness.equal('kit.evidenceFreezer.freeze is a function (invoked factory, like kit.decisionFreezer)', typeof kit.evidenceFreezer.freeze, 'function');
	harness.equal('kit.evidenceFreezer.parse is a function', typeof kit.evidenceFreezer.parse, 'function');

	// a composed candidate -> a conforming BaseTupleEvidence, verified against the REAL contract oracle.
	const { hubModulePresentationViolation } = require('../lib/evidenceContracts');
	let hubObserved = null;
	kit.cedsHubModule(
		{
			referenceTier: 'property',
			canonicalKey: 'P000104',
			propertyKey: 'P000104',
			name: 'Staff Evaluation Score or Rating',
			domainId: 'C200366',
			rangeDatatype: 'string',
		},
		(err, presentation) => {
			hubObserved = { err, presentation };
		},
	);
	harness.equal('kit.cedsHubModule calls back with no error for a conforming candidate', hubObserved.err, '');
	harness.equal(
		'kit.cedsHubModule\'s presentation passes the REAL hubModulePresentationViolation oracle',
		hubModulePresentationViolation(hubObserved.presentation),
		'',
	);

	harness.report();
})();
