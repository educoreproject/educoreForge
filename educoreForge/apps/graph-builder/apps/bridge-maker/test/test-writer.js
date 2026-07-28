#!/usr/bin/env node
'use strict';

// test-writer.js — hermetic gate for lib.d/writer.js (bridgeKitRefactor_072726 Phase 1). Proves the
// kit module is the SAME relationshipWriter the old flat bag composes (identity, not a drifted
// re-implementation), then re-runs ONE construction guard and ONE write-path check THROUGH the
// lib.d entry point specifically — RED (refused) then GREEN (corrected, writes) — so the wrap itself
// is proven, not just the module it delegates to (which test-relationshipWriter.js already covers
// exhaustively).
//
// PURE / hermetic: a graphWriter DOUBLE only, no Neo4j, no container, no network.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-writer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d writer kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves lib.d/writer.js IS relationshipWriter (identity), and RED-then-GREEN proves its
     construction guard and its write path through the lib.d entry point.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const relationshipWriterFactory = require('../lib/relationshipWriter');
const kitWriterFactory = require('../lib.d/writer');
const { deriveEdgePolicy } = require('../lib/componentLibrary');

const APPLY_LABEL = 'BridgedRelation';
const edgePolicy = deriveEdgePolicy();

const graphWriterDouble = () => {
	const writes = [];
	return {
		writes,
		writeRelationshipEdge: (spec, callback) => {
			writes.push(spec);
			callback('', { edgeWritten: true });
		},
		close: (callback) => callback(''),
	};
};

// =====================================================================
harness.section('IDENTITY — lib.d/writer.js IS the real relationshipWriter, not a drifted copy');
// =====================================================================
harness.ok('lib.d/writer.js delegates to the SAME factory reference', kitWriterFactory === relationshipWriterFactory);

// =====================================================================
harness.section('RED — constructing the kit writer without an edgePolicy is refused BY NAME');
// =====================================================================
harness.match(
	'missing edgePolicy throws through the lib.d entry point, naming the reason',
	(() => {
		try {
			kitWriterFactory({ graphWriter: graphWriterDouble() });
			return '';
		} catch (constructionError) {
			return constructionError.message;
		}
	})(),
	/constructed without an edgePolicy/,
);

// =====================================================================
harness.section('GREEN — a correctly constructed + correctly stamped edge writes through the lib.d entry point');
// =====================================================================
(() => {
	const graphWriter = graphWriterDouble();
	const writer = kitWriterFactory({ graphWriter, edgePolicy });
	let observed = null;
	writer(
		{
			authoredMapping: {
				fromStableId: 's:1',
				toStableId: 's:2',
				relationshipType: 'HAS_PROPERTY',
				properties: { provenanceTier: 'structural' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.ok('write did not error', observed && !observed.err, observed && observed.err);
	harness.ok('edgeWritten true', observed && observed.result && observed.result.edgeWritten === true);
	harness.equal('exactly one write reached the graphWriter double', graphWriter.writes.length, 1);
	harness.equal('the write carries the relationshipType unchanged', graphWriter.writes[0].relationshipType, 'HAS_PROPERTY');
})();

harness.report();
