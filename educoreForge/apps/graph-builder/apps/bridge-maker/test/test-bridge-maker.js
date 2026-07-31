#!/usr/bin/env node
'use strict';

// test-bridge-maker.js — the REAL bridgeMaker's contract, ENFORCED. P0 of the bridge, updated for
// the directory search-path resolver (design_bridgeResolution_072526.md §3b/§4).
//
// What this suite proves, WITHOUT Docker/Voyage/a database (§3 hard line 2):
//   1. a bridge NAME resolves through a three-directory SEARCH PATH (standard-local, forges-shared,
//      library). EXACTLY ONE match loads it; MORE THAN ONE THROWS by name (ambiguity fails loudly,
//      no precedence); ZERO is refused BY NAME — no silent default (§6 / polyArch2 §6). Proven with
//      TEMP fixture dirs so no real forge tree is touched. [three-state, observed red first]
//   2. a bridge name naming NO file is REFUSED BY NAME through the real resolver. [failure side]
//   3. a DRIFTED bridge plugin (wrong argument/result shape) is REFUSED BY NAME before it runs —
//      the shape gate bites. [failure side, observed red]
//   4. the WRITE-INTO-GRAPH substrate is real: a resolved plugin composes the injected
//      relationshipWriter, which drives an injected graphWriter — proven with a graphWriter
//      DOUBLE (no container). [success side]
//   5. the DEFAULT generic plugin (now JUST a library file) writes ZERO edges and returns a valid
//      status — the P0 placeholder that nonetheless travels the real resolve+run+return path
//      (never opens a graph connection). [success side]
//   6. argument refusals: a run missing inGraph, bridge or applyLabel is refused, not guessed.
//
// The shape-gate and write-path tests inject a `bridgePluginResolver` DOUBLE so an in-closure fake
// plugin can be resolved without writing a file; the resolution three-state and the not-found
// refusal exercise the REAL directory resolver (temp dirs / the real library dir).
//
// DOCTRINE: a gate never observed failing is not a gate (harness.js). Every refusal below is a
// negative assertion naming the SPECIFIC error it expects, so a rejection for the wrong reason
// fails rather than false-greens.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-bridge-maker.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- enforce the real bridgeMaker contract (directory bridge resolution, drift
     refusal, the write-into-graph substrate under doubles, the zero-edge default plugin)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives the real bridgeMaker with an injected bridge-plugin resolver and an injected
     graphWriter double, so the whole resolve -> compose -> write path runs in-process. Proven
     in the failure direction: an unresolvable name and a drifted plugin are shown refused, and an
     ambiguous name is shown to throw.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const bridgeMakerModule = require('../bridgeMaker');

// =====================================================================
// DOUBLES — no container, no Voyage, no database.
// =====================================================================

// a graphWriter double: the injected write seam. It records every edge write so the test can
// prove the plugin -> relationshipWriter -> graphWriter path reached the substrate.
const graphWriterDouble = () => {
	const writes = [];
	let closed = false;
	return {
		writes,
		wasClosed: () => closed,
		factory: ({ inGraph }) => ({
			writeRelationshipEdge: (spec, callback) => {
				writes.push({ inGraphName: inGraph && inGraph.graphName, ...spec });
				callback('', { edgeWritten: true });
			},
			close: (callback) => {
				closed = true;
				callback('');
			},
		}),
	};
};

// a deterministic bridge plugin (the smallest thing that proves the write path): it composes the
// injected relationshipWriter to write exactly two authored edges and returns the P0-shaped
// status. This is a TEST fixture standing in for the real producers that land in P2/P3.
const spyBridgePlugin = (injectedTools) => {
	const { relationshipWriter } = injectedTools;
	return ({ inGraph, hub, applyLabel }, callback) => {
		// EXACT_MATCH is a sanctioned mapping predicate (relationshipWriter's vocabulary guard,
		// componentLibrary.deriveEdgePolicy): it requires properties.provenanceTier (every edge) and
		// properties.predicate agreeing with the type ('EXACT_MATCH' <-> 'exactMatch' — the golden-
		// canonical stamp, confirmed against GOLD_260718).
		const authoredMappings = [
			{ fromStableId: 'src:1', toStableId: 'hub:1', relationshipType: 'EXACT_MATCH', properties: { provenanceTier: 'spec-authoritative', predicate: 'exactMatch' } },
			{ fromStableId: 'src:2', toStableId: 'hub:2', relationshipType: 'EXACT_MATCH', properties: { provenanceTier: 'spec-authoritative', predicate: 'exactMatch' } },
		];
		let index = 0;
		let written = 0;
		const writeNext = () => {
			if (index >= authoredMappings.length) {
				callback('', {
					edgesWritten: written,
					decisionBlock: null,
					counts: { authored: written, inferred: 0 },
				});
				return;
			}
			const authoredMapping = authoredMappings[index];
			index += 1;
			relationshipWriter({ authoredMapping, applyLabel }, (err) => {
				if (err) {
					callback(`spyBridge write failed: ${err}`);
					return;
				}
				written += 1;
				writeNext();
			});
		};
		writeNext();
	};
};

// a DRIFTED plugin: its produced callable is POSITIONAL (inGraph, hub, applyLabel) — arity 3
// where the contract declares ONE named-argument object (arity 2). This is exactly the drift the
// shape gate must catch before the plugin is ever run.
const driftedBridgePlugin = () => (inGraph, hub, applyLabel) => {
	// never reached — the gate refuses it first.
};

// a resolver double: hands back a fixed pluginFactory, so a fake in-closure plugin can be resolved
// without planting a file. The production path uses the real directory resolver (exercised below).
const resolverReturning = (pluginFactory) => () => ({ pluginFactory });

// =====================================================================
harness.section('DECLARATION — the resolver and the library default are exported and real');
// =====================================================================

harness.equal(
	'bridgeMaker exports DEFAULT_GENERIC_BRIDGE = genericBridge',
	bridgeMakerModule.DEFAULT_GENERIC_BRIDGE,
	'genericBridge',
);

harness.ok(
	'bridgeMaker exports resolveBridgePlugin as a function (the directory resolver)',
	typeof bridgeMakerModule.resolveBridgePlugin === 'function',
	`got ${typeof bridgeMakerModule.resolveBridgePlugin}`,
);

harness.ok(
	'bridgeMaker exports bridgeSearchPath as a function (the three ordered scopes)',
	typeof bridgeMakerModule.bridgeSearchPath === 'function',
	`got ${typeof bridgeMakerModule.bridgeSearchPath}`,
);

harness.ok(
	'the default generic bridge is JUST a forges-shared file — it resolves through the real search path ' +
		'(bridgeKitRefactor_072726 Phase 2: moved from the library dir to forges/bridges/, the real kit-composing bridge)',
	(() => {
		const resolved = bridgeMakerModule.resolveBridgePlugin({ bridge: 'genericBridge' });
		return !!resolved && typeof resolved.pluginFactory === 'function' && !resolved.error;
	})(),
	'genericBridge did not resolve from forges/bridges/',
);

// =====================================================================
harness.section('DIRECTORY RESOLUTION — a bridge name resolves to exactly one file, or fails loudly');
// =====================================================================
// The three-directory search-path resolver (design §3b/§4), proven with TEMP fixture dirs so no
// real forge tree, Docker, Voyage or LLM is touched (§3 hard line 2). EXACTLY ONE match -> loads;
// MORE THAN ONE -> THROWS by name (no precedence); ZERO -> refused BY NAME (error-object idiom).

(() => {
	const { resolveBridgePlugin } = bridgeMakerModule;

	const makeTempBridgeDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `bridgeResolve-${label}-`));
	const plantBridge = (dir, name) =>
		fs.writeFileSync(path.join(dir, `${name}.js`), 'module.exports = () => (namedArgs, cb) => cb("", {});\n');

	const dirNarrow = makeTempBridgeDir('narrow');
	const dirMiddle = makeTempBridgeDir('middle');
	const dirLibrary = makeTempBridgeDir('library');
	const searchDirs = [dirNarrow, dirMiddle, dirLibrary];

	// EXACTLY ONE — only the library dir carries the file.
	plantBridge(dirLibrary, 'soleBridge');
	const one = resolveBridgePlugin({ bridge: 'soleBridge', searchDirs });
	harness.ok(
		'a name matching exactly ONE file across the path resolves to a pluginFactory',
		!!one && typeof one.pluginFactory === 'function' && !one.error,
		`got ${JSON.stringify(one)}`,
	);

	// MORE THAN ONE — the same name in the narrow AND library dirs must THROW, no precedence.
	plantBridge(dirNarrow, 'ambiguousBridge');
	plantBridge(dirLibrary, 'ambiguousBridge');
	let ambiguityThrown = null;
	try {
		resolveBridgePlugin({ bridge: 'ambiguousBridge', searchDirs });
	} catch (ambiguityError) {
		ambiguityThrown = ambiguityError.message;
	}
	harness.rejects(
		'a name resolving in >1 directory THROWS, naming the count and the paths',
		[ambiguityThrown],
		/ambiguousBridge.*resolves in 2 directories/,
	);

	// ZERO — nowhere on the path. Refused BY NAME (error object, routed through run's callback).
	const none = resolveBridgePlugin({ bridge: 'noSuchBridge', searchDirs });
	harness.rejects(
		'a name resolving to ZERO files is refused BY NAME',
		[none && none.error],
		/noSuchBridge.*resolves to no bridge file/,
	);
})();

// =====================================================================
harness.section('RESOLUTION — an unresolvable bridge name is REFUSED BY NAME (no silent default)');
// =====================================================================

// against the REAL directory resolver (no override) — this is the production refusal. A name that
// exists in none of the three scopes is a recipe error, refused by name, no default fallthrough.
(() => {
	let observed = null;
	bridgeMakerModule().run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'totallyUnresolvable', source: 'lif', applyLabel: 'BridgedRelation' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.rejects(
		'an unresolvable bridge name is refused, naming the bridge and that no file resolves',
		[observed && observed.err],
		/totallyUnresolvable.*resolves to no bridge file/,
	);
	harness.equal(
		'  and nothing is produced on refusal',
		observed && observed.result === undefined ? 'undefined' : 'produced',
		'undefined',
	);
})();

// =====================================================================
harness.section('THE SHAPE GATE BITES — a drifted bridge plugin is refused before it runs');
// =====================================================================

(() => {
	const writer = graphWriterDouble();
	let observed = null;
	bridgeMakerModule({
		bridgePluginResolver: resolverReturning(driftedBridgePlugin),
		graphWriterFactory: writer.factory,
	}).run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'driftedBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.rejects(
		'a positional (arity-3) plugin callable is refused, naming the bridge',
		[observed && observed.err],
		/driftedBridge.*(shape|arity|argument|drift)/i,
	);
	harness.equal(
		'  and the drifted plugin never wrote an edge',
		writer.writes.length,
		0,
	);
})();

// =====================================================================
harness.section('WRITE-INTO-GRAPH — the substrate is real, proven under a graphWriter double');
// =====================================================================

(() => {
	const writer = graphWriterDouble();
	let observed = null;
	bridgeMakerModule({
		bridgePluginResolver: resolverReturning(spyBridgePlugin),
		graphWriterFactory: writer.factory,
	}).run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'spyBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.equal('a resolved plugin runs with no error', observed && observed.err, '');
	harness.equal(
		'the plugin -> relationshipWriter -> graphWriter path wrote both edges',
		writer.writes.length,
		2,
	);
	harness.equal(
		'  and every write carried the applyLabel handed to run',
		writer.writes.every((oneWrite) => oneWrite.applyLabel === 'BridgedRelation')
			? 'all BridgedRelation'
			: 'label drift',
		'all BridgedRelation',
	);
	harness.equal(
		'  and the relationship type reached the writer',
		writer.writes.map((oneWrite) => oneWrite.relationshipType).join(','),
		'EXACT_MATCH,EXACT_MATCH',
	);
	harness.equal(
		'the status report counts the edges written',
		observed && observed.result && observed.result.edgesWritten,
		2,
	);
	harness.ok(
		'the status report carries the declared keys (inGraph, bridge, applyLabel, edgesWritten, note)',
		observed &&
			observed.result &&
			observed.result.inGraph !== undefined &&
			observed.result.bridge === 'spyBridge' &&
			observed.result.applyLabel === 'BridgedRelation' &&
			observed.result.edgesWritten === 2 &&
			observed.result.note !== undefined,
		`result was ${JSON.stringify(observed && observed.result)}`,
	);
	harness.ok(
		'the graphWriter for this run was closed (no leaked connection)',
		writer.wasClosed(),
		'graphWriter.close was never called',
	);
})();

// =====================================================================
harness.section('MULTI-BLOCK PASS-THROUGH — a coordinating producer emits SEVERAL pair-scoped blocks');
// =====================================================================
// The contract change (2026-07-26): a bridge invocation may emit MORE THAN ONE pair-scoped block. bridgeMaker
// forwards the producer's blocks[] UNCHANGED; a single-block bridge returns NO blocks[] (the degenerate case
// build.js synthesizes downstream). Both are proven here under the real componentLibrary + a graphWriter double.

// a multi-block plugin: writes one edge under EACH of two distinct pair labels and returns blocks[].
const multiBlockBridgePlugin = (injectedTools) => {
	const { relationshipWriter } = injectedTools;
	return ({ inGraph, hub, applyLabel }, callback) => {
		void inGraph;
		void hub;
		// REFERENCES / SUBCLASS_OF are structural EDGE_TYPES (relationshipWriter's vocabulary guard,
		// componentLibrary.deriveEdgePolicy): every structural edge requires properties.provenanceTier
		// === 'structural' exactly.
		relationshipWriter(
			{ authoredMapping: { fromStableId: 'a:1', toStableId: 'b:1', relationshipType: 'REFERENCES', properties: { provenanceTier: 'structural' } }, applyLabel: `${applyLabel}_A_B` },
			(firstErr) => {
				if (firstErr) {
					callback(firstErr);
					return;
				}
				relationshipWriter(
					{ authoredMapping: { fromStableId: 'c:1', toStableId: 'd:1', relationshipType: 'SUBCLASS_OF', properties: { provenanceTier: 'structural' } }, applyLabel: `${applyLabel}_C_D` },
					(secondErr) => {
						if (secondErr) {
							callback(secondErr);
							return;
						}
						callback('', {
							edgesWritten: 2,
							decisionBlock: null,
							producer: 'structural',
							counts: { structural: 2 },
							blocks: [
								{ applyLabel: `${applyLabel}_A_B`, firstStandard: 'a', secondStandard: 'b', producer: 'structural', decisionBlock: null, emptyPairing: false, edgesWritten: 1, counts: {} },
								{ applyLabel: `${applyLabel}_C_D`, firstStandard: 'c', secondStandard: 'd', producer: 'structural', decisionBlock: null, emptyPairing: false, edgesWritten: 1, counts: {} },
							],
						});
					},
				);
			},
		);
	};
};

(() => {
	// single-block bridge: NO blocks[] in the run report.
	const singleWriter = graphWriterDouble();
	let single = null;
	bridgeMakerModule({ bridgePluginResolver: resolverReturning(spyBridgePlugin), graphWriterFactory: singleWriter.factory }).run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'spyBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			single = { err, result };
		},
	);
	harness.ok(
		'a single-block bridge returns NO blocks[] (the degenerate list-of-one is synthesized in build.js)',
		single && single.result && single.result.blocks === undefined,
		`blocks was ${JSON.stringify(single && single.result && single.result.blocks)}`,
	);

	// multi-block bridge: blocks[] forwarded unchanged, each pairing written under its OWN label.
	const multiWriter = graphWriterDouble();
	let multi = null;
	bridgeMakerModule({ bridgePluginResolver: resolverReturning(multiBlockBridgePlugin), graphWriterFactory: multiWriter.factory }).run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'multiBlockBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			multi = { err, result };
		},
	);
	harness.equal('a multi-block run completes without error', multi && multi.err, '');
	harness.ok(
		'bridgeMaker forwards blocks[] unchanged (two pair-scoped entries)',
		multi && multi.result && Array.isArray(multi.result.blocks) && multi.result.blocks.length === 2,
		`blocks was ${JSON.stringify(multi && multi.result && multi.result.blocks)}`,
	);
	harness.equal('  block[0] applyLabel preserved', multi.result.blocks[0].applyLabel, 'BridgedRelation_A_B');
	harness.equal('  block[1] applyLabel preserved', multi.result.blocks[1].applyLabel, 'BridgedRelation_C_D');
	harness.equal('  each pairing wrote under its OWN distinct label', multiWriter.writes.map((oneWrite) => oneWrite.applyLabel).join(','), 'BridgedRelation_A_B,BridgedRelation_C_D');
	harness.equal('  the producer kind is forwarded', multi.result.producer, 'structural');
	harness.ok('  the multi-block run closed its graphWriter', multiWriter.wasClosed(), 'graphWriter.close was never called');
})();

// =====================================================================
harness.section('THE DEFAULT GENERIC PLUGIN — genericBridge (Phase 2, forges/bridges/): zero edges on a ' +
	'no-decision-block MATERIALIZE, valid status, no graph connection opened');
// =====================================================================
// bridgeKitRefactor_072726 Phase 2 replaced the P0 placeholder (which wrote zero edges unconditionally
// and never even looked at its arguments) with the REAL generic inferred bridge composing the kit
// (forges/bridges/genericBridge.js). Its P0-EQUIVALENT honest-zero-edges case is now the MATERIALIZE
// path with NO frozen decision block for the pair (design §5.5: never a silent spend) — proven here
// with a decisionStore fixture holding no block, exactly the shape test-semantic-bridge.js proves for
// semanticBridge's own no-block case. graphWriterFactory is injected only to prove kit.writer is never
// reached (no block -> no materialize -> no write, and MATERIALIZE-no-block returns before even
// opening the graph reader — see genericBridge.js runMaterialize).

(() => {
	const writer = graphWriterDouble();
	const emptyDecisionStore = {
		getDecisionBlock: ({ pairKey }, cb) => { void pairKey; cb('', { frozenText: null }); },
		saveDecisionBlock: (a, cb) => cb(''),
	};
	let observed = null;
	// the REAL resolver (no override), the default bridge name. It resolves genericBridge from
	// forges/bridges/ (the forges-shared scope). graphWriterFactory injected only to PROVE it is
	// never used — the no-block MATERIALIZE path writes nothing and opens nothing.
	bridgeMakerModule({ graphWriterFactory: writer.factory }).run(
		{
			inGraph: { graphName: 'DEV_probe' },
			bridge: 'genericBridge',
			hub: 'ceds',
			applyLabel: 'BridgedRelation',
			decisionStore: emptyDecisionStore,
			config: { sourceStandard: 'lif', sourceStandardName: 'LIF' },
		},
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.equal('the default generic plugin runs with no error', observed && observed.err, '');
	harness.equal(
		'  and writes ZERO edges (no frozen decision block for this pair — never a silent spend)',
		observed && observed.result && observed.result.edgesWritten,
		0,
	);
	harness.equal(
		'  and never opened a graph connection',
		writer.writes.length,
		0,
	);
	harness.ok(
		'  and still returns a valid status carrying every declared key',
		observed &&
			observed.result &&
			observed.result.inGraph !== undefined &&
			observed.result.bridge === 'genericBridge' &&
			observed.result.applyLabel === 'BridgedRelation' &&
			observed.result.edgesWritten === 0 &&
			observed.result.note !== undefined,
		`result was ${JSON.stringify(observed && observed.result)}`,
	);
})();

// =====================================================================
harness.section('ARGUMENT REFUSALS — a missing required argument is refused, not guessed');
// =====================================================================

(() => {
	let missingGraph = null;
	bridgeMakerModule().run(
		{ bridge: 'genericBridge', applyLabel: 'BridgedRelation' },
		(err) => {
			missingGraph = err;
		},
	);
	harness.rejects('run without inGraph is refused', [missingGraph], /inGraph/);

	let missingBridge = null;
	bridgeMakerModule().run(
		{ inGraph: { graphName: 'DEV_probe' }, applyLabel: 'BridgedRelation' },
		(err) => {
			missingBridge = err;
		},
	);
	harness.rejects('run without bridge is refused', [missingBridge], /bridge/);

	let missingLabel = null;
	bridgeMakerModule().run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'genericBridge' },
		(err) => {
			missingLabel = err;
		},
	);
	harness.rejects('run without applyLabel is refused', [missingLabel], /applyLabel/);
})();

// =====================================================================
harness.section('THE NEGATIVE SUBSTRATE SCAN — a plugin file reaching for the raw write substrate is refused BY NAME');
// =====================================================================
// The single remaining bypass door (design): a plugin that opens its OWN neo4j connection using
// the credentials on `inGraph` (require('neo4j-driver') / require(neo4jGraphWriter) / inGraph.boltUrl
// / inGraph.password) instead of writing through the injected relationshipWriter. bridgeMaker now
// reads the plugin's MODULE FILE (not just pluginCallable.toString(), which only sees the inner
// callable) and refuses it BY NAME before it ever runs. Proven with TEMP fixture files (no forge
// tree, no container) — RED for each forbidden shape, GREEN for a clean fixture, and GREEN (no
// false positive) for the three REAL bridge files that ship today.

(() => {
	const { resolveBridgePlugin, bridgeModuleShapeViolation } = bridgeMakerModule;

	const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeSubstrateScan-'));
	const plantFixture = (name, source) => fs.writeFileSync(path.join(fixtureDir, `${name}.js`), source);

	// RED #1 — a plugin whose module file directly requires('neo4j-driver'). Correctly shaped
	// otherwise (arity 2, reads inGraph/hub/applyLabel) so the ONLY thing that can refuse it is the
	// substrate scan, not an unrelated shape drift.
	plantFixture(
		'driverRequiringBridge',
		`'use strict';\n` +
			`module.exports = () => ({ inGraph, hub, applyLabel }, callback) => {\n` +
			`\t// FIXTURE — deliberately opens its own neo4j-driver connection; must be refused before it runs.\n` +
			`\tconst neo4jDriver = require('neo4j-driver');\n` +
			`\tvoid neo4jDriver; void inGraph; void hub; void applyLabel;\n` +
			`\tcallback('', { edgesWritten: 0, counts: {} });\n` +
			`};\n`,
	);

	// RED #2 — a plugin whose module file reaches for inGraph's raw credential fields directly
	// (boltUrl + password) rather than the injected relationshipWriter.
	plantFixture(
		'credentialReadingBridge',
		`'use strict';\n` +
			`module.exports = () => ({ inGraph, hub, applyLabel }, callback) => {\n` +
			`\t// FIXTURE — deliberately reaches for inGraph's raw credential fields; must be refused.\n` +
			`\tconst rawBoltUrl = inGraph.boltUrl;\n` +
			`\tconst rawPassword = inGraph.password;\n` +
			`\tvoid rawBoltUrl; void rawPassword; void hub; void applyLabel;\n` +
			`\tcallback('', { edgesWritten: 0, counts: {} });\n` +
			`};\n`,
	);

	// GREEN — a clean fixture: same shape, no forbidden reference anywhere in the file.
	plantFixture(
		'cleanBridge',
		`'use strict';\n` +
			`module.exports = () => ({ inGraph, hub, applyLabel }, callback) => {\n` +
			`\tvoid inGraph; void hub; void applyLabel;\n` +
			`\tcallback('', { edgesWritten: 0, counts: {} });\n` +
			`};\n`,
	);

	// ---- unit-level: bridgeModuleShapeViolation directly, against each fixture's REAL resolved path ----
	const loadCallable = (resolvedBridge) => {
		const resolved = resolveBridgePlugin({ bridge: resolvedBridge, searchDirs: [fixtureDir] });
		return { callable: resolved.pluginFactory({}), resolvedPath: resolved.resolvedPath };
	};

	const driverFixture = loadCallable('driverRequiringBridge');
	harness.rejects(
		'RED: a fixture requiring neo4j-driver is refused BY NAME, naming the bridge and the substrate',
		[bridgeModuleShapeViolation(driverFixture.callable, 'driverRequiringBridge', driverFixture.resolvedPath)],
		/driverRequiringBridge.*REFUSED.*neo4j-driver/s,
	);

	const credentialFixture = loadCallable('credentialReadingBridge');
	harness.rejects(
		'RED: a fixture reading inGraph.boltUrl/.password is refused BY NAME, naming the bridge and the substrate',
		[bridgeModuleShapeViolation(credentialFixture.callable, 'credentialReadingBridge', credentialFixture.resolvedPath)],
		/credentialReadingBridge.*REFUSED.*(boltUrl|password)/s,
	);

	const cleanFixture = loadCallable('cleanBridge');
	harness.equal(
		'GREEN: a clean fixture of the same shape passes the gate (no violation)',
		bridgeModuleShapeViolation(cleanFixture.callable, 'cleanBridge', cleanFixture.resolvedPath),
		'',
	);

	// ---- end-to-end: run() through the REAL resolver, so resolvedPath reaches the gate the same way
	// production does, and the refused plugin is proven to have NEVER run (zero writes). ----
	const realResolverOverFixtureDir = ({ bridge }) => resolveBridgePlugin({ bridge, searchDirs: [fixtureDir] });

	const driverWriter = graphWriterDouble();
	let driverRunObserved = null;
	bridgeMakerModule({
		bridgePluginResolver: realResolverOverFixtureDir,
		graphWriterFactory: driverWriter.factory,
	}).run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'driverRequiringBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			driverRunObserved = { err, result };
		},
	);
	harness.rejects(
		'RED end-to-end: run() refuses the neo4j-driver fixture by name before it ever executes',
		[driverRunObserved && driverRunObserved.err],
		/driverRequiringBridge.*REFUSED.*neo4j-driver/s,
	);
	harness.equal(
		'  and the refused plugin never reached the graphWriter (zero writes)',
		driverWriter.writes.length,
		0,
	);

	const cleanWriter = graphWriterDouble();
	let cleanRunObserved = null;
	bridgeMakerModule({
		bridgePluginResolver: realResolverOverFixtureDir,
		graphWriterFactory: cleanWriter.factory,
	}).run(
		{ inGraph: { graphName: 'DEV_probe' }, bridge: 'cleanBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			cleanRunObserved = { err, result };
		},
	);
	harness.equal(
		'GREEN end-to-end: run() allows the clean fixture through with no error',
		cleanRunObserved && cleanRunObserved.err,
		'',
	);

	// ---- NO FALSE POSITIVES — the 4 REAL bridges shipped today must pass the scan unchanged. ----
	const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
	const REAL_BRIDGES = [
		{ name: 'ctdlAuthoredBridge', filePath: path.join(TREE_ROOT, 'forges', 'ctdl', 'bridges', 'ctdlAuthoredBridge.js') },
		{ name: 'ctdlFamilyStructure', filePath: path.join(TREE_ROOT, 'forges', 'ctdl', 'bridges', 'ctdlFamilyStructure.js') },
		{ name: 'semanticBridge', filePath: path.join(__dirname, '..', 'bridges', 'semanticBridge.js') },
		// genericBridge (bridgeKitRefactor_072726 Phase 2): now the REAL kit-composing bridge, moved
		// from the library scope to forges/bridges/ (forges-shared).
		{ name: 'genericBridge', filePath: path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge.js') },
	];
	REAL_BRIDGES.forEach((oneRealBridge) => {
		const realCallable = require(oneRealBridge.filePath)({});
		harness.equal(
			`GREEN (no false positive): the real ${oneRealBridge.name} passes the substrate scan unchanged`,
			bridgeModuleShapeViolation(realCallable, oneRealBridge.name, oneRealBridge.filePath),
			'',
		);
	});
})();

// =====================================================================

harness.report();
