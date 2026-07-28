#!/usr/bin/env node
'use strict';

// test-materializer.js — hermetic gate for lib.d/materializer.js (bridgeKitRefactor_072726 Phase 1).
// Proves identity with the real inferredIndex, then RED-then-GREEN over the SAME fixed-decision
// fixture test-semantic-bridge.js Section A proves against the old componentLibrary path: an
// unresolvable targetKey is an ORPHAN (no edge — RED, made visible rather than silently dropped);
// a resolvable targetKey materializes a byte-identical, correctly-stamped CLOSE_MATCH edge (GREEN).
// PURE / hermetic: no Neo4j, no network, no LLM.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-materializer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d materializer kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves lib.d/materializer.js IS the real inferredIndex (identity); RED (an unresolvable
     targetKey materializes as an ORPHAN, no edge) then GREEN (a resolvable targetKey materializes a
     correctly-stamped CLOSE_MATCH edge, byte-identical across two independent runs).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const inferredIndexFactory = require('../lib/inferredIndex');
const kitMaterializerFactory = require('../lib.d/materializer');

// =====================================================================
harness.section('IDENTITY — lib.d/materializer.js IS the real inferredIndex, not a drifted copy');
// =====================================================================
harness.ok(
	'lib.d/materializer.js delegates to the SAME factory reference',
	kitMaterializerFactory === inferredIndexFactory,
);

const referenceNodes = [
	{ stableId: 'ref/P1', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', qualifierKeys: [] } },
];
const sourceNodes = [{ stableId: 's1' }];
const DECISION_HASH = 'kitmaterializerhash';

const buildViaKit = (decisions) =>
	kitMaterializerFactory({
		subjectSource: 'LIF',
		subjectVersion: 'v1',
		objectVersion: 'v14',
		mappingTool: 'semanticBridge',
		decisionBlockHash: DECISION_HASH,
	}).buildInferredSubgraph({ inferredDecisions: decisions, sourceNodes, referenceNodes });

// =====================================================================
harness.section('RED — an unresolvable targetKey materializes as an ORPHAN through the lib.d entry point (no edge)');
// =====================================================================
(() => {
	const subgraph = buildViaKit([
		{ fromStableId: 's1', targetKey: 'PZZZ-UNRESOLVABLE', confidence: 0.5, rerankScore: 0.5, cosineScore: 0.5, retrievalRank: 1 },
	]);
	harness.equal('0 edges materialized', subgraph.counts.edgesTotal, 0);
	harness.equal('1 orphan recorded', subgraph.counts.orphans, 1);
	harness.equal('the orphan names the unresolvable targetKey', subgraph.orphans[0].targetKey, 'PZZZ-UNRESOLVABLE');
})();

// =====================================================================
harness.section('GREEN — a resolvable targetKey materializes a correctly-stamped, byte-identical CLOSE_MATCH edge');
// =====================================================================
(() => {
	const decisions = [
		{ fromStableId: 's1', targetKey: 'P1', confidence: 0.87, rerankScore: 0.87, cosineScore: 0.87, retrievalRank: 1 },
	];
	const subgraph1 = buildViaKit(decisions);
	const subgraph2 = buildViaKit(decisions);
	harness.equal('exactly 1 CLOSE_MATCH edge materialized', subgraph1.counts.edgesTotal, 1);
	harness.equal('edge type is CLOSE_MATCH', subgraph1.edges[0].type, 'CLOSE_MATCH');
	harness.equal('edge predicate is closeMatch', subgraph1.edges[0].properties.predicate, 'closeMatch');
	harness.equal('edge carries the decisionBlockHash pin', subgraph1.edges[0].properties.decisionBlockHash, DECISION_HASH);
	harness.equal(
		'BYTE-IDENTICAL edges across two independent materializations via the lib.d entry point',
		JSON.stringify(subgraph1.edges),
		JSON.stringify(subgraph2.edges),
	);
})();

harness.report();
