#!/usr/bin/env node
'use strict';

// test-reference-index.js — the hermetic unit gate for the ported referenceIndex (P2, the pure
// AUTHORED-CROSSWALK mapping derivation; implementationPlan_bridge_072426 §7). LOCKS the resolution
// the whole authored producer stands on:
//   - PROPERTY-tier: a bare 'P...' targetKey resolves to the unqualified property-tier HubReference.
//   - VALUE-tier: a COMPOSITE '${propertyKey}|${OVtoken}' targetKey resolves to the property-scoped
//     value-tier HubReference — and a BARE OV token does NOT (the composite is required, because CEDS
//     option sets are shared across many properties).
//   - orphan / fromGap: an unresolvable target and an unmaterialized source never become dangling edges.
//   - the emitted edge is stamped SPEC_AUTHORITATIVE / confidence 1.0 / semapv:ManualMappingCuration.
//
// ALL PURE: no Neo4j, no Voyage, no store — synthetic reference/source node sets in memory (PLAN §3
// hard line 2). Faithfulness to the incumbent mappingSubgraph is proven separately at the phase
// boundary; this test locks the recreation component's behavior on its own.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-reference-index.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic resolution gate for the ported referenceIndex (pure mapping derivation)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives referenceIndex.buildMappingSubgraph over synthetic HubReference + source node sets and
     asserts property-tier, composite value-tier, orphan and fromGap resolution plus the authored
     edge stamp. Pure and in-memory; no docker, no Voyage, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const referenceIndexFactory = require('../lib/referenceIndex');

// synthetic CEDS HubReference nodes (the materialized reference block, scalar props as the live graph carries)
const referenceNodes = [
	{ stableId: 'ref/P000113', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P000113', propertyKey: 'P000113', rangeOptionSetId: 'OS000113', qualifierKeys: [] } },
	{ stableId: 'ref/P001610', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P001610', propertyKey: 'P001610', rangeOptionSetId: 'OS001610', qualifierKeys: [] } },
	{ stableId: 'ref/OV000113115284', properties: { role: 'HubReference', referenceTier: 'value', canonicalKey: 'OV000113115284', propertyKey: 'P000113' } },
	{ stableId: 'ref/OV001610115588', properties: { role: 'HubReference', referenceTier: 'value', canonicalKey: 'OV001610115588', propertyKey: 'P001610' } },
	// a value ref with a SHARED OV token under a DIFFERENT property — proves property-scoping (the composite,
	// not a bare token, is what resolves). Same canonicalKey OV000113115284, different propertyKey.
	{ stableId: 'ref/OTHER-OV000113115284', properties: { role: 'HubReference', referenceTier: 'value', canonicalKey: 'OV000113115284', propertyKey: 'P999999' } },
];

const sourceNodes = [
	{ stableId: 'ctdl:General' },
	{ stableId: 'ctdl:AcademicAssistantship' },
	{ stableId: 'ctdl:DoDTuitionAssistance' },
	{ stableId: 'ctdl:UnresolvableTarget' },
];

const builder = referenceIndexFactory({
	predicate: 'exactMatch',
	subjectSource: 'CTDL',
	subjectVersion: 'ctdlV',
	objectSource: 'CEDS',
	objectVersion: 'cedsV',
	mappingTool: 'ctdlAuthoredBridge',
});

// =====================================================================
harness.section('RESOLUTION — property-tier, composite value-tier, orphan, fromGap');
// =====================================================================

const authoredMappings = [
	{ fromStableId: 'ctdl:General', targetKey: 'P000113' },                            // property-tier (set-level)
	{ fromStableId: 'ctdl:AcademicAssistantship', targetKey: 'P000113|OV000113115284' }, // composite value-tier
	{ fromStableId: 'ctdl:DoDTuitionAssistance', targetKey: 'P001610|OV001610115588' },  // composite value-tier
	{ fromStableId: 'ctdl:UnresolvableTarget', targetKey: 'P000113|OV000000000000' },    // orphan (no such value)
	{ fromStableId: 'ctdl:GhostSource', targetKey: 'P000113' },                          // fromGap (source absent)
];

const subgraph = builder.buildMappingSubgraph({ authoredMappings, sourceNodes, referenceNodes });
const edgeFrom = (fromId) => subgraph.edges.find((e) => e.fromRef.id === fromId);

harness.equal('exactly 3 edges resolve (2 value + 1 property)', subgraph.edges.length, 3);
harness.equal('property-tier set-level General -> P000113 property ref', edgeFrom('ctdl:General') && edgeFrom('ctdl:General').toRef.id, 'ref/P000113');
harness.equal('property-tier resolution mode is direct', edgeFrom('ctdl:General') && edgeFrom('ctdl:General').properties.resolution, 'direct');
harness.equal('composite value-tier Assistantship -> the P000113-scoped value ref', edgeFrom('ctdl:AcademicAssistantship') && edgeFrom('ctdl:AcademicAssistantship').toRef.id, 'ref/OV000113115284');
harness.equal('value-tier resolution mode is directValue', edgeFrom('ctdl:AcademicAssistantship') && edgeFrom('ctdl:AcademicAssistantship').properties.resolution, 'directValue');
harness.equal('composite value-tier DoD -> the P001610-scoped value ref', edgeFrom('ctdl:DoDTuitionAssistance') && edgeFrom('ctdl:DoDTuitionAssistance').toRef.id, 'ref/OV001610115588');

harness.equal('the unresolvable target is an orphan, not an edge', subgraph.counts.orphans, 1);
harness.ok('orphan carries the true reason', subgraph.orphans[0] && /no property-tier or value-tier HubReference/.test(subgraph.orphans[0].reason));
harness.equal('the absent source is a fromGap, not a dangling edge', subgraph.counts.fromGaps, 1);
harness.equal('counts: 1 property-direct', subgraph.counts.direct, 1);
harness.equal('counts: 2 value-direct', subgraph.counts.directValue, 2);

// =====================================================================
harness.section('PROPERTY-SCOPING — a BARE OV token does not resolve (composite required)');
// =====================================================================
// The bare OV token is shared across P000113 and P999999 in referenceNodes; only the composite is
// unambiguous. A bare-token authored mapping MUST orphan, never pick an arbitrary property's value.
const bareTokenSubgraph = builder.buildMappingSubgraph({
	authoredMappings: [{ fromStableId: 'ctdl:AcademicAssistantship', targetKey: 'OV000113115284' }],
	sourceNodes,
	referenceNodes,
});
harness.equal('a bare OV token resolves to NO edge', bareTokenSubgraph.edges.length, 0);
harness.equal('a bare OV token is an orphan', bareTokenSubgraph.counts.orphans, 1);

// =====================================================================
harness.section('AUTHORED STAMP — every edge is spec-authoritative, confidence 1.0, manual curation');
// =====================================================================
harness.ok('every edge type EXACT_MATCH', subgraph.edges.every((e) => e.type === 'EXACT_MATCH'));
harness.ok('every edge confidence === 1.0', subgraph.edges.every((e) => e.properties.confidence === 1.0));
harness.ok('every edge provenanceTier spec-authoritative', subgraph.edges.every((e) => e.properties.provenanceTier === 'spec-authoritative'));
harness.ok('every edge mappingJustification semapv:ManualMappingCuration', subgraph.edges.every((e) => e.properties.mappingJustification === 'semapv:ManualMappingCuration'));
harness.ok('every edge carries its cedsAnchorKey (the authored targetKey)', subgraph.edges.every((e) => typeof e.properties.cedsAnchorKey === 'string' && e.properties.cedsAnchorKey.length > 0));

// determinism: same inputs -> byte-identical edge order.
const again = builder.buildMappingSubgraph({ authoredMappings, sourceNodes, referenceNodes });
harness.ok('buildMappingSubgraph is deterministic', JSON.stringify(again.edges) === JSON.stringify(subgraph.edges));

harness.report();
