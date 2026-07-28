#!/usr/bin/env node
'use strict';

// test-graphReader.js — hermetic gate for lib.d/graphReader.js (bridgeKitRefactor_072726 Phase 1).
// Proves identity with the real neo4jGraphReader, then RED-then-GREEN over its ONE real guard: a
// Cypher-unsafe label/property key is refused BEFORE any connection is attempted (hermetic, no
// network); a WELL-FORMED request clears the guard and reaches the driver — proven WITHOUT a real
// Neo4j container by substituting a FAKE 'neo4j-driver' module into require.cache for the duration
// of the assertion (a standard Node test technique: the resolved absolute path is the cache key,
// and neo4jGraphReader.js requires 'neo4j-driver' LAZILY inside ensureSession(), so patching the
// cache before calling readNodes is sufficient — no real TCP, no real DNS lookup, §3 hard line 2).
// The fake is installed and restored around ONE assertion only.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-graphReader.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d graphReader kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves lib.d/graphReader.js IS neo4jGraphReader (identity); RED (bad label refused before any
     connection) then GREEN (a well-formed request reaches a FAKE driver substituted into
     require.cache — no real Neo4j, no network).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const neo4jGraphReaderFactory = require('../lib/neo4jGraphReader');
const kitGraphReaderFactory = require('../lib.d/graphReader');

// =====================================================================
harness.section('IDENTITY — lib.d/graphReader.js IS the real neo4jGraphReader, not a drifted copy');
// =====================================================================
harness.ok('lib.d/graphReader.js delegates to the SAME factory reference', kitGraphReaderFactory === neo4jGraphReaderFactory);

// =====================================================================
harness.section('RED — a Cypher-unsafe label is refused BEFORE any connection is opened (hermetic, no network)');
// =====================================================================
(() => {
	const reader = kitGraphReaderFactory({ inGraph: { boltUrl: 'bolt://nowhere', password: 'x' } });
	let observed = null;
	reader.readNodes({ label: 'Bad`Label', propertyEquals: {} }, (err, out) => {
		observed = { err, out };
	});
	harness.match(
		'a bare-identifier-unsafe label is refused by name, synchronously, no network attempted',
		observed && observed.err,
		/not a bare identifier/,
	);
})();

// =====================================================================
harness.section('GREEN — a well-formed request clears the guard and reaches the driver (FAKE neo4j-driver, no real network)');
// =====================================================================
// session.run() returns a REAL Promise (that is neo4jGraphReader's own contract), so its .then()
// fires as a microtask — the assertions below MUST live inside the readNodes callback, not run
// synchronously right after calling it, or they would inspect `observed` before it is ever set.
(() => {
	const neo4jDriverPath = require.resolve('neo4j-driver');
	const originalCacheEntry = require.cache[neo4jDriverPath];

	let sessionRunCalls = 0;
	const fakeRecords = [
		{ get: (fieldName) => ({ stableId: 'ceds:P1', properties: { role: 'HubReference' } }[fieldName]) },
	];
	const fakeSession = {
		run: (cypher, params) => {
			sessionRunCalls++;
			void cypher;
			void params;
			return Promise.resolve({ records: fakeRecords });
		},
		close: () => Promise.resolve(),
	};
	const fakeDriver = { session: () => fakeSession, close: () => Promise.resolve() };
	const fakeNeo4j = { driver: () => fakeDriver, auth: { basic: () => ({}) } };

	require.cache[neo4jDriverPath] = {
		id: neo4jDriverPath,
		filename: neo4jDriverPath,
		loaded: true,
		exports: fakeNeo4j,
	};

	const restoreCache = () => {
		if (originalCacheEntry) {
			require.cache[neo4jDriverPath] = originalCacheEntry;
		} else {
			delete require.cache[neo4jDriverPath];
		}
	};

	const reader = kitGraphReaderFactory({ inGraph: { boltUrl: 'bolt://fake', password: 'x' } });
	reader.readNodes({ label: 'HubReference', propertyEquals: {} }, (err, out) => {
		// restore the process-wide cache the instant the (fake) driver has been used, whether this
		// callback goes on to pass or fail its assertions.
		restoreCache();

		harness.ok('a well-formed readNodes did not error', !err, err);
		harness.equal('exactly one session.run reached the (fake) driver', sessionRunCalls, 1);
		harness.equal(
			'the fake driver row is returned as { stableId, properties }',
			out && out.nodes && out.nodes[0] && out.nodes[0].stableId,
			'ceds:P1',
		);

		harness.report();
	});
})();
