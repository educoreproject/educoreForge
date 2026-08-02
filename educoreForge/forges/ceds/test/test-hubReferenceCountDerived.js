#!/usr/bin/env node
'use strict';

// test-hubReferenceCountDerived.js — the PHASE-4 DERIVED-COUNT ACCEPTANCE GATE for the CEDS hub.
// PLAN §8. Ports incumbent gates cli/lib.d/edf-gate/gates.d/18-hubReferenceCountDerived.js (tier
// counts) and 20-hubReferenceDecomposition.js (every HubReference carries its decomposition edges)
// into the recreation, re-expressed against the PURE forge path instead of a live Neo4j graph.
//
// NOTHING HERE TOUCHES THE NETWORK, DOCKER, VOYAGE OR A DATABASE. Parsing CEDS-Ontology.rdf (a LOCAL
// asset under forges/ceds/assets/standardSourceData/01) plus running forgeHub is PURE, synchronous
// and fast (~1s). forgeCeds.forge is invoked with skipEmbedding:true so the Voyage embedding pass is
// never entered — no embedder, no vectors, no live graph. The suite runs the REAL forge over the
// REAL CEDS ontology and asserts forgeHub's output.
//
// WHAT THIS LOCKS (the DERIVED numbers, re-derived by referenceSubgraph.js — NOT a magic literal in
// production code; the number below is the frozen EXPECTATION a gate compares the derivation against,
// exactly as incumbent gate-18 compares its cypher result to 2324/27437/27/29788/1):
//   - property-tier == 2324   (referenceTier='property' AND size(qualifierKeys)=0)
//   - value-tier    == 27437  (referenceTier='value')
//   - qualified     == 27     (referenceTier='property' AND size(qualifierKeys)>0)
//   - HubReference total == 29788
//   - HubDefinition == 1
//   - FOLD total: base(23238) + hub-nodes(29789) == 53027 — what a hub standard's ONE folded
//     [StandardBase] block carries (PLAN Phase 3: hub folds into the base block).
//   - DECOMPOSITION: every HubReference resolves exactly one HAS_CEDS_DOMAIN, one HAS_CEDS_PROPERTY,
//     one IN_HUB; every value-tier ref additionally one HAS_CEDS_VALUE and one HAS_CEDS_RANGE; every
//     HAS_CEDS_* target resolves onto a real node IN THE FOLDED (base+hub) block, none dangling.
//
// COUNTING DISCIPLINE (code fact, learned June build): HubReference canonicalKey is NON-UNIQUE BY
// DESIGN — value-tier refs SHARE a canonicalKey (an option value under a different property is a
// distinct address but the same canonicalKey); uniqueness is the composite (hubName, addressSignature),
// carried by stableId. This suite therefore counts by referenceTier + qualifierKeys size EXACTLY as
// incumbent gate-18 does, and asserts composite uniqueness via stableId — it NEVER assumes canonicalKey
// uniqueness over HubReferences.
//
// THE DROP-TWIN (PLAN §8 "its twin bites"): a gate never observed failing is unproven. Removing ONE
// DmeProperty that owns an option set from the input drops BOTH the property-tier count (that property's
// base ref) AND the dependent value-tier count (its option values' refs). The twin section asserts the
// perturbed derivation FELL below the frozen expectation — a green negative-control that would itself go
// RED only if the count were a hardcoded constant rather than a live derivation over the input.
//
// Run: node forges/ceds/test/test-hubReferenceCountDerived.js

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- Phase-4 derived-count acceptance gate for the CEDS hub (real CEDS, pure forge)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Parses the LOCAL CEDS-Ontology.rdf asset, forges the CEDS base, derives the hub via forgeHub, and
     asserts the DERIVED tier counts (2324 property / 27437 value / 27 qualified / 29788 total / 1
     definition), the fold total (23238 base + 29789 hub == 53027), and the decomposition invariants.
     A drop-twin removes one DmeProperty and proves the derived count falls. Pure and in-memory; no
     docker, no Voyage, no database, no network.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const forgeCeds = require('../forgeCeds')({});
const referenceSubgraph = require('../lib/referenceSubgraph');
const vocab = require('../../../lib/vocabulary/vocabulary');

const { HUB_REFERENCE_PROPERTIES: HR, REFERENCE_TIER, CEDS_HUB_EDGE_TYPES, IN_HUB_EDGE_TYPE } = vocab;

// the LOCAL CEDS source asset — a directory holding exactly one CEDS-Ontology.rdf (parser resolves it).
const CEDS_SOURCE_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');

// The frozen EXPECTATION. This is the acceptance TARGET the derivation is asserted against — the same
// role 2324/27437/27/29788/1 plays in incumbent gate-18. It is NOT a value production code reads; the
// counts are re-derived every run by referenceSubgraph.js from the real CEDS parse.
const EXPECTATION = Object.freeze({
	propertyTier: 2324,
	valueTier: 27437,
	qualified: 27,
	hubReferenceTotal: 29788,
	hubDefinition: 1,
	// BASELINE MOVED 2026-08-02, and the delta is PROVEN rather than accepted: 23238 -> 25151
	// is exactly +1913, the DmeEditHistoryEntry nodes minted when change history became NODES
	// (⟪TQ ruling⟫, commit "CEDS change history as NODES"). The hub is UNCHANGED at 29789, which
	// is the point of checking both: had the enrichment disturbed the derived hub, this number
	// would have moved too and the fold total alone would not have said which side shifted.
	baseNodeTotal: 25151, // was 23238 + 1913 change-history entries
	hubNodeTotal: 29789, // 29788 HubReferences + 1 HubDefinition — UNCHANGED by the enrichment
	foldTotal: 54940, // base + hub-nodes — the folded [StandardBase] block of a hub standard
});

// single-element PG-JSON array -> scalar (forgeCeds emits scalars; forgeHub's v1 also accepts scalars —
// this helper mirrors that so the suite reads a property value the same way the derivation does).
const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// tier/qualifier readers — the gate-18 predicates, expressed over a forged node instead of cypher.
const tierOf = (oneNode) => v1(oneNode.properties[HR.REFERENCE_TIER]);
const qualifierCount = (oneNode) =>
	(oneNode.properties[HR.QUALIFIER_KEYS] || []).length;

// build a fresh CEDS hub forge (documented defaults + the source's owl:versionInfo version).
const makeCedsHub = () => referenceSubgraph({ hubVersion: '14.0.0.0', hubNamespace: 'ceds' });

// count HubReferences by (referenceTier, qualifierKeys size) — EXACTLY the incumbent gate-18 buckets.
// Never keyed on canonicalKey (which is intentionally non-unique among value-tier refs).
const bucketWalk = (hubNodes) => {
	const references = hubNodes.filter((oneNode) => oneNode.role === 'HubReference');
	return {
		propertyTier: references.filter(
			(oneNode) => tierOf(oneNode) === REFERENCE_TIER.PROPERTY && qualifierCount(oneNode) === 0,
		).length,
		valueTier: references.filter((oneNode) => tierOf(oneNode) === REFERENCE_TIER.VALUE).length,
		qualified: references.filter(
			(oneNode) => tierOf(oneNode) === REFERENCE_TIER.PROPERTY && qualifierCount(oneNode) > 0,
		).length,
		total: references.length,
		distinctStableIds: new Set(references.map((oneNode) => oneNode.stableId)).size,
		distinctValueCanonicalKeys: new Set(
			references
				.filter((oneNode) => tierOf(oneNode) === REFERENCE_TIER.VALUE)
				.map((oneNode) => v1(oneNode.properties[HR.CANONICAL_KEY])),
		).size,
		definitions: hubNodes.filter((oneNode) => oneNode.role === 'HubDefinition').length,
	};
};

// the DmeProperty the drop-twin removes: the fromRef of the first HAS_OPTION_SET edge (sorted for
// determinism). Removing an option-set-owning property drops BOTH tiers (its base ref + its values).
const pickDroppableProperty = (baseEdges) => {
	const owners = baseEdges
		.filter((oneEdge) => oneEdge.type === 'HAS_OPTION_SET')
		.map((oneEdge) => oneEdge.fromRef.id)
		.sort();
	return owners[0];
};

// =====================================================================
// The whole gate runs inside the forge callback (parse is the one async boundary).
// =====================================================================

forgeCeds.forge({ sourcePath: CEDS_SOURCE_PATH, skipEmbedding: true }, (forgeError, base) => {
	if (forgeError) {
		harness.ok(`CEDS forge succeeded (LOCAL asset, no embedding)`, false, String(forgeError));
		harness.report();
		return;
	}

	const baseNodeTotal = base.nodes.length;
	const cedsHub = makeCedsHub();
	const hub = cedsHub.forgeHub({ nodes: base.nodes, edges: base.edges });
	const walk = bucketWalk(hub.nodes);

	// =====================================================================
	harness.section('SOURCE — the real CEDS base, forged from a local asset');
	// =====================================================================
	harness.equal(
		'the CEDS base forges 25151 nodes from CEDS-Ontology.rdf (no embedding, no network)',
		baseNodeTotal,
		EXPECTATION.baseNodeTotal,
	);

	// =====================================================================
	harness.section("TIER COUNTS — DERIVED, matching gate-18's expectation");
	// =====================================================================
	// The module's OWN derivation (referenceSubgraph.js counts) — the authority.
	harness.equal(
		'property-tier == 2324 (referenceTier=property, no qualifiers) [module-derived]',
		hub.counts.propertyTier,
		EXPECTATION.propertyTier,
	);
	harness.equal(
		'value-tier == 27437 (referenceTier=value) [module-derived]',
		hub.counts.valueTier,
		EXPECTATION.valueTier,
	);
	harness.equal(
		'qualified == 27 (referenceTier=property, with qualifiers) [module-derived]',
		hub.counts.qualified,
		EXPECTATION.qualified,
	);
	harness.equal(
		'HubReference total == 29788 [module-derived]',
		hub.counts.hubReferenceTotal,
		EXPECTATION.hubReferenceTotal,
	);
	harness.equal(
		'HubDefinition == 1 [module-derived]',
		hub.counts.hubDefinition,
		EXPECTATION.hubDefinition,
	);

	// The emitted NODE SET, re-bucketed by (referenceTier, qualifierKeys size) exactly as gate-18's
	// cypher does — proving the reported counts agree with the actual nodes, without touching canonicalKey.
	harness.equal('  emitted property-tier node set agrees', walk.propertyTier, EXPECTATION.propertyTier);
	harness.equal('  emitted value-tier node set agrees', walk.valueTier, EXPECTATION.valueTier);
	harness.equal('  emitted qualified node set agrees', walk.qualified, EXPECTATION.qualified);
	harness.equal('  emitted HubReference total agrees', walk.total, EXPECTATION.hubReferenceTotal);
	harness.equal('  emitted HubDefinition count agrees', walk.definitions, EXPECTATION.hubDefinition);

	// =====================================================================
	harness.section('UNIQUENESS — composite (hubName, addressSignature), NOT canonicalKey');
	// =====================================================================
	// Every HubReference is unique by its composite address (carried in stableId): 29788 distinct
	// stableIds for 29788 references. canonicalKey is deliberately NON-unique among value-tier refs,
	// so the distinct-canonicalKey count is STRICTLY LESS than the value-tier count — the very reason
	// this gate must never count by canonicalKey. Asserting BOTH here documents the invariant.
	harness.equal(
		'HubReferences are unique by composite address (29788 distinct stableIds)',
		walk.distinctStableIds,
		EXPECTATION.hubReferenceTotal,
	);
	harness.ok(
		'value-tier canonicalKey is non-unique (distinct canonicalKeys < value-tier count) — proof we do NOT count by it',
		walk.distinctValueCanonicalKeys < walk.valueTier,
		`distinct value canonicalKeys=${walk.distinctValueCanonicalKeys}, value-tier=${walk.valueTier}`,
	);

	// =====================================================================
	harness.section('FOLD — base + hub in ONE [StandardBase] block (25151 + 29789 == 54940)');
	// =====================================================================
	harness.equal('hub contributes 29789 nodes (29788 refs + 1 definition)', hub.counts.nodeTotal, EXPECTATION.hubNodeTotal);
	harness.equal(
		'folded block total: base(25151) + hub(29789) == 54940',
		baseNodeTotal + hub.counts.nodeTotal,
		EXPECTATION.foldTotal,
	);

	// =====================================================================
	harness.section('DECOMPOSITION — every HubReference carries its HAS_CEDS_* / IN_HUB edges (gate-20)');
	// =====================================================================
	// Resolve decomposition targets against the FOLDED node set (base + hub): the hub's HAS_CEDS_* edges
	// point at BASE structural nodes, and both endpoints are present in the one folded block (PLAN Phase 3).
	const foldedNodeByStableId = {};
	base.nodes.concat(hub.nodes).forEach((oneNode) => {
		foldedNodeByStableId[oneNode.stableId] = oneNode;
	});

	const decompTypes = [
		CEDS_HUB_EDGE_TYPES.DOMAIN,
		CEDS_HUB_EDGE_TYPES.PROPERTY,
		CEDS_HUB_EDGE_TYPES.RANGE,
		CEDS_HUB_EDGE_TYPES.VALUE,
		CEDS_HUB_EDGE_TYPES.QUALIFIER,
	];

	// per-HubReference edge-type tallies
	const referenceNodeByStableId = {};
	hub.nodes
		.filter((oneNode) => oneNode.role === 'HubReference')
		.forEach((oneNode) => {
			referenceNodeByStableId[oneNode.stableId] = oneNode;
		});
	const edgeTypeCountsByRef = {};
	let decompEdgeCount = 0;
	let danglingCount = 0;
	hub.edges.forEach((oneEdge) => {
		const fromNode = referenceNodeByStableId[oneEdge.fromRef.id];
		if (fromNode) {
			const perRef = (edgeTypeCountsByRef[oneEdge.fromRef.id] =
				edgeTypeCountsByRef[oneEdge.fromRef.id] || {});
			perRef[oneEdge.type] = (perRef[oneEdge.type] || 0) + 1;
		}
		if (decompTypes.indexOf(oneEdge.type) !== -1) {
			decompEdgeCount += 1;
			// gate-20's dangling predicate: a target is dangling if it is ABSENT, is not a :ForgedNode,
			// or carries no _source. Resolved against the folded (base+hub) block.
			const target = foldedNodeByStableId[oneEdge.toRef.id];
			const targetIsForged =
				target && (target.labels || []).indexOf(vocab.NODE_LABELS.FORGED_NODE) !== -1;
			const targetHasSource = target && v1(target.properties._source) != null;
			if (!targetIsForged || !targetHasSource) {
				danglingCount += 1;
			}
		}
	});

	let missingDomain = 0;
	let missingProperty = 0;
	let missingInHub = 0;
	let valueMissingValue = 0;
	let valueMissingRange = 0;
	Object.keys(referenceNodeByStableId).forEach((oneStableId) => {
		const perRef = edgeTypeCountsByRef[oneStableId] || {};
		const has = (edgeType) => perRef[edgeType] || 0;
		if (has(CEDS_HUB_EDGE_TYPES.DOMAIN) !== 1) missingDomain += 1;
		if (has(CEDS_HUB_EDGE_TYPES.PROPERTY) !== 1) missingProperty += 1;
		if (has(IN_HUB_EDGE_TYPE) !== 1) missingInHub += 1;
		if (tierOf(referenceNodeByStableId[oneStableId]) === REFERENCE_TIER.VALUE) {
			if (has(CEDS_HUB_EDGE_TYPES.VALUE) !== 1) valueMissingValue += 1;
			if (has(CEDS_HUB_EDGE_TYPES.RANGE) !== 1) valueMissingRange += 1;
		}
	});

	harness.equal('every HubReference resolves exactly one HAS_CEDS_DOMAIN', missingDomain, 0);
	harness.equal('every HubReference resolves exactly one HAS_CEDS_PROPERTY', missingProperty, 0);
	harness.equal('every HubReference resolves exactly one IN_HUB (HubDefinition)', missingInHub, 0);
	harness.equal('every value-tier HubReference resolves exactly one HAS_CEDS_VALUE', valueMissingValue, 0);
	harness.equal('every value-tier HubReference resolves exactly one HAS_CEDS_RANGE', valueMissingRange, 0);
	harness.ok('the decomposition is non-empty (edges > 0)', decompEdgeCount > 0, `edges=${decompEdgeCount}`);
	harness.equal(
		'no HAS_CEDS_* edge dangles — every target resolves in the folded (base+hub) block',
		danglingCount,
		0,
	);

	// =====================================================================
	harness.section('DROP-TWIN — perturbing the input makes the derived count FALL (the gate bites)');
	// =====================================================================
	// Remove ONE DmeProperty that owns an option set; the derived counts MUST fall. If the count were a
	// hardcoded 2324/27437 rather than a live derivation, this negative control would go RED.
	const droppedPropertyStableId = pickDroppableProperty(base.edges);
	const droppedPropertyNode = base.nodes.find(
		(oneNode) => oneNode.stableId === droppedPropertyStableId,
	);
	const perturbedNodes = base.nodes.filter(
		(oneNode) => oneNode.stableId !== droppedPropertyStableId,
	);
	const twin = makeCedsHub().forgeHub({ nodes: perturbedNodes, edges: base.edges });

	harness.note(
		`drop-twin removed DmeProperty ${droppedPropertyStableId} (${v1(
			droppedPropertyNode.properties.name,
		)}): property-tier ${hub.counts.propertyTier} -> ${twin.counts.propertyTier}, ` +
			`value-tier ${hub.counts.valueTier} -> ${twin.counts.valueTier}, ` +
			`total ${hub.counts.hubReferenceTotal} -> ${twin.counts.hubReferenceTotal}`,
	);
	harness.ok(
		'property-tier FELL when a DmeProperty was removed',
		twin.counts.propertyTier < hub.counts.propertyTier,
		`full=${hub.counts.propertyTier}, twin=${twin.counts.propertyTier}`,
	);
	harness.ok(
		'value-tier FELL when that property owned an option set',
		twin.counts.valueTier < hub.counts.valueTier,
		`full=${hub.counts.valueTier}, twin=${twin.counts.valueTier}`,
	);
	harness.ok(
		'the perturbed derivation NO LONGER meets the frozen expectation (the count is not a constant)',
		twin.counts.propertyTier !== EXPECTATION.propertyTier &&
			twin.counts.valueTier !== EXPECTATION.valueTier,
		`twin property-tier=${twin.counts.propertyTier}, value-tier=${twin.counts.valueTier}`,
	);

	harness.report();
});
