#!/usr/bin/env node
'use strict';

// test-ctdl-authored-bridge.js — the hermetic gate for the CTDL AUTHORED EXACT_MATCH producer (P2
// beachhead). Proves, WITHOUT docker/Voyage/a database (PLAN §3 hard line 2):
//
//   A. HARVEST over the REAL forged CTDL nodes — the CTDL forge runs in-process (skipEmbedding) and its
//      994 real nodes carry exactly 26 native CEDS anchors. ctdlAnchorHarvest sees all 26: 24 fragment
//      (value-tier) + 2 set-level (property-tier), 0 abstains. This pins the count to the REAL CTDL source.
//   B. RESOLUTION to 26 EXACT_MATCH edges — harvest + the pure referenceIndex over a CEDS fixture that is
//      GOLDEN-GROUNDED (derived from the real CTDL anchors themselves; the notation=fragment join and the
//      unique OS->P owner are both verified against the live golden, code fact 2026-07-24): all 26 resolve,
//      0 orphans, each -> a HubReference, each spec-authoritative / confidence 1.0. The fixture's OV tokens
//      are structurally faithful but synthetic; the AUTHORITATIVE tokens come from the real CEDS reforge the
//      parent runs (this suite never forges the 29,788-node CEDS hub).
//   C. THE PRODUCER END-TO-END through bridgeMaker.run under a graphReader double (serves the fixtures) and
//      a graphWriter double (records writes): the registered 'ctdlIntoCedsAuthored' plugin writes exactly 26
//      labeled EXACT_MATCH edges, each -> a HubReference, each SPEC_AUTHORITATIVE / confidence 1.0 / manual
//      curation. The whole resolve -> read -> harvest -> select -> write path runs in-process.
//   D. L4b ABSTAINS — an ambiguous owning property and an unowned option set abstain with true reasons.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-ctdl-authored-bridge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the CTDL authored EXACT_MATCH producer

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Forges CTDL in-process (skipEmbedding), harvests its 26 native CEDS anchors, resolves them to 26
     EXACT_MATCH edges through the pure referenceIndex over a golden-grounded CEDS fixture, and drives the
     registered plugin end-to-end through bridgeMaker.run under reader+writer doubles. Pure and in-memory
     beyond the bundled CTDL asset; no docker, no Voyage, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const path = require('path');

const ctdlAnchorHarvest = require('../lib/ctdlAnchorHarvest');
const referenceIndexFactory = require('../lib/referenceIndex');
const bridgeMakerModule = require('../bridgeMaker');
const ctdlBundle = require('../../../../../forges/ctdl/forgeCtdl')({ embedder: null });

const CTDL_ASSET_DIR = path.join(__dirname, '..', '..', '..', '..', '..', 'forges', 'ctdl', 'assets', 'standardSourceData', '01');

// buildGoldenGroundedCedsFixture — derive a CEDS reference + standard node set FROM the real CTDL anchors.
// For each anchored option set: one unqualified property-tier HubReference 'P<digits>' (unique owner,
// golden-verified). For each fragment anchor: one CEDS DmeOptionValue (notation=fragment) + its value-tier
// HubReference under that property (the notation=fragment join is golden-verified). SET-LEVEL anchors need
// only the property ref. OV tokens are synthetic-but-consistent; the join structure is the golden's.
const buildGoldenGroundedCedsFixture = (ctdlNodes) => {
	const referenceNodes = [];
	const cedsStandardNodes = [];
	const seenProperty = new Set();
	let ovSequence = 100;
	ctdlNodes.forEach((oneNode) => {
		JSON.parse(oneNode.properties.crossRefs || '[]')
			.filter((oneRef) => oneRef.system === 'ceds')
			.forEach((oneRef) => {
				const osId = `${oneRef.id}`;
				const digits = osId.replace(/^OS/, '');
				const propertyKey = `P${digits}`;
				if (!seenProperty.has(propertyKey)) {
					seenProperty.add(propertyKey);
					referenceNodes.push({
						stableId: `ref/${propertyKey}`,
						properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: propertyKey, propertyKey, rangeOptionSetId: osId, qualifierKeys: [] },
					});
				}
				const raw = `${oneRef.raw}`;
				const hashAt = raw.indexOf('#');
				if (hashAt !== -1 && hashAt !== raw.length - 1) {
					const fragment = raw.slice(hashAt + 1);
					const ovToken = `OV${digits}${ovSequence++}`;
					cedsStandardNodes.push({
						stableId: `ceds/val/${ovToken}`,
						properties: { role: 'DmeOptionValue', _source: 'CEDS', rangeOptionSetId: osId, notation: fragment, name: fragment, canonicalKey: ovToken },
					});
					referenceNodes.push({
						stableId: `ref/${ovToken}`,
						properties: { role: 'HubReference', referenceTier: 'value', canonicalKey: ovToken, propertyKey },
					});
				}
			});
	});
	return { referenceNodes, cedsStandardNodes };
};

// =====================================================================
harness.section('D — L4b ABSTAINS (pure, synthetic; ambiguous owner and unowned set)');
// =====================================================================
// an option set ranged by TWO properties -> the anchor's owning property is ambiguous -> abstain.
const ambiguousRefNodes = [
	{ stableId: 'ref/P1', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', rangeOptionSetId: 'OS000999', qualifierKeys: [] } },
	{ stableId: 'ref/P2', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P2', propertyKey: 'P2', rangeOptionSetId: 'OS000999', qualifierKeys: [] } },
];
const ambiguousSource = [{ stableId: 'ctdl:x', properties: { crossRefs: JSON.stringify([{ system: 'ceds', id: 'OS000999', raw: 'ceds:000999#Frag' }]) } }];
const ambiguousCtx = ctdlAnchorHarvest.buildResolutionContext({ referenceNodes: ambiguousRefNodes, cedsStandardNodes: [] });
const ambiguousHarvest = ctdlAnchorHarvest.harvestAuthoredMappings({ sourceNodes: ambiguousSource, resolutionContext: ambiguousCtx });
harness.equal('ambiguous owning property -> 0 authored mappings', ambiguousHarvest.authoredMappings.length, 0);
harness.ok('ambiguous owner abstain carries the true reason', /AMBIGUOUS owning property/.test((ambiguousHarvest.unresolvedRows[0] || {}).reason || ''));

const unownedSource = [{ stableId: 'ctdl:y', properties: { crossRefs: JSON.stringify([{ system: 'ceds', id: 'OS777777', raw: 'ceds:777777#Frag' }]) } }];
const unownedHarvest = ctdlAnchorHarvest.harvestAuthoredMappings({ sourceNodes: unownedSource, resolutionContext: ctdlAnchorHarvest.buildResolutionContext({ referenceNodes: [], cedsStandardNodes: [] }) });
harness.equal('unowned option set -> 0 authored mappings', unownedHarvest.authoredMappings.length, 0);
harness.ok('unowned set abstain carries the true reason', /no unqualified property-tier hub ranges this option set/.test((unownedHarvest.unresolvedRows[0] || {}).reason || ''));

// =====================================================================
// The forge is async; A/B/C run inside its callback, then harness.report().
// =====================================================================
ctdlBundle.forge({ sourcePath: CTDL_ASSET_DIR, skipEmbedding: true }, (forgeErr, forgeResult) => {
	if (forgeErr) {
		harness.ok(`real CTDL forge did not error (${forgeErr})`, false, forgeErr);
		harness.report();
		return;
	}
	const ctdlNodes = forgeResult.nodes;
	const { referenceNodes, cedsStandardNodes } = buildGoldenGroundedCedsFixture(ctdlNodes);

	// -----------------------------------------------------------------
	harness.section('A — HARVEST over the REAL forged CTDL nodes: 26 anchors (24 value + 2 set-level)');
	// -----------------------------------------------------------------
	const resolutionContext = ctdlAnchorHarvest.buildResolutionContext({ referenceNodes, cedsStandardNodes });
	const harvest = ctdlAnchorHarvest.harvestAuthoredMappings({ sourceNodes: ctdlNodes, resolutionContext });
	harness.equal('forge produced the golden CTDL node total (994)', ctdlNodes.length, 994);
	harness.equal('26 native CEDS anchors seen', harvest.counts.anchorsSeen, 26);
	harness.equal('24 resolve value-tier (fragment anchors)', harvest.counts.valueTier, 24);
	harness.equal('2 resolve property-tier (set-level anchors)', harvest.counts.propertyTier, 2);
	harness.equal('0 abstains over the real CTDL + golden-grounded fixture', harvest.counts.abstains, 0);
	harness.equal('26 authored mappings total', harvest.authoredMappings.length, 26);
	harness.ok('every value-tier targetKey is a composite propertyKey|OVtoken', harvest.authoredMappings.filter((m) => m.targetKey.indexOf('|') !== -1).length === 24);
	harness.ok('every set-level targetKey is a bare P-token', harvest.authoredMappings.filter((m) => /^P\d+$/.test(m.targetKey)).length === 2);

	// -----------------------------------------------------------------
	harness.section('B — RESOLUTION: 26 EXACT_MATCH edges, each -> a HubReference, spec-authoritative');
	// -----------------------------------------------------------------
	const builder = referenceIndexFactory({ predicate: 'exactMatch', subjectSource: 'CTDL', objectSource: 'CEDS', mappingTool: 'ctdlAuthoredBridge' });
	const subgraph = builder.buildMappingSubgraph({ authoredMappings: harvest.authoredMappings, sourceNodes: ctdlNodes, referenceNodes });
	harness.equal('exactly 26 EXACT_MATCH edges resolve', subgraph.counts.edgesTotal, 26);
	harness.equal('  24 value-direct', subgraph.counts.directValue, 24);
	harness.equal('  2 property-direct', subgraph.counts.direct, 2);
	harness.equal('  0 orphans', subgraph.counts.orphans, 0);
	harness.equal('  0 fromGaps', subgraph.counts.fromGaps, 0);
	harness.ok('every edge type EXACT_MATCH', subgraph.edges.every((e) => e.type === 'EXACT_MATCH'));
	harness.ok('every edge -> a HubReference (ref/*)', subgraph.edges.every((e) => e.toRef.id.indexOf('ref/') === 0));
	harness.ok('every edge confidence 1.0', subgraph.edges.every((e) => e.properties.confidence === 1.0));
	harness.ok('every edge provenanceTier spec-authoritative', subgraph.edges.every((e) => e.properties.provenanceTier === 'spec-authoritative'));
	harness.ok('every edge mappingJustification semapv:ManualMappingCuration', subgraph.edges.every((e) => e.properties.mappingJustification === 'semapv:ManualMappingCuration'));

	// -----------------------------------------------------------------
	harness.section('C — THE PRODUCER end-to-end through bridgeMaker.run (reader + writer doubles)');
	// -----------------------------------------------------------------
	// a graphReader DOUBLE: serves the three node sets by the same filters the producer requests.
	const graphReaderDouble = ({ inGraph }) => ({
		readNodes: ({ label, propertyEquals }, callback) => {
			void inGraph;
			const eq = propertyEquals || {};
			if (label === 'HubReference') {
				callback('', { nodes: referenceNodes });
				return;
			}
			if (eq._source === 'CTDL') {
				callback('', { nodes: ctdlNodes });
				return;
			}
			if (eq._source === 'CEDS' && eq.role === 'DmeOptionValue') {
				callback('', { nodes: cedsStandardNodes });
				return;
			}
			callback('', { nodes: [] });
		},
		close: (callback) => callback(''),
	});
	// a graphWriter DOUBLE: records every edge write so the write path can be asserted.
	const writes = [];
	const graphWriterDouble = ({ inGraph }) => ({
		writeRelationshipEdge: (spec, callback) => {
			writes.push({ inGraphName: inGraph && inGraph.graphName, ...spec });
			callback('', { edgeWritten: true });
		},
		close: (callback) => callback(''),
	});

	bridgeMakerModule({ graphWriterFactory: graphWriterDouble, graphReaderFactory: graphReaderDouble }).run(
		{ inGraph: { graphName: 'DEV_probe', boltUrl: 'bolt://x', password: 'x' }, bridge: 'ctdlAuthoredBridge', source: 'ctdl', hub: 'ceds', applyLabel: 'BridgedRelation' },
		(runErr, report) => {
			harness.ok(`producer run did not error (${runErr || 'ok'})`, !runErr, runErr);
			harness.equal('the producer wrote exactly 26 EXACT_MATCH edges', report && report.edgesWritten, 26);
			harness.equal('counts.authored === 26', report && report.counts && report.counts.authored, 26);
			harness.equal('deterministic authored track: decisionBlock is null', report && report.decisionBlock, null);
			harness.equal('26 writes reached the graphWriter', writes.length, 26);
			harness.ok('every write carried the applyLabel', writes.every((w) => w.applyLabel === 'BridgedRelation'));
			harness.ok('every write is an EXACT_MATCH relationship', writes.every((w) => w.relationshipType === 'EXACT_MATCH'));
			harness.ok('every write targets a HubReference (ref/*)', writes.every((w) => `${w.toStableId}`.indexOf('ref/') === 0));
			harness.ok('every write is spec-authoritative / confidence 1.0 / manual curation', writes.every((w) => w.properties && w.properties.provenanceTier === 'spec-authoritative' && w.properties.confidence === 1.0 && w.properties.mappingJustification === 'semapv:ManualMappingCuration'));

			harness.report();
		},
	);
});
