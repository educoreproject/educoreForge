#!/usr/bin/env node
'use strict';

// test-referenceSubgraph.js — a STANDING gate for the ported CEDS hub derivation (forgeHub /
// buildReferenceSubgraph). PLAN Phase 2.
//
// NOTHING HERE TOUCHES THE NETWORK, DOCKER, VOYAGE OR A DATABASE. The derivation is a PURE,
// deterministic function of a deserialized CEDS base block; the fixture is a tiny synthetic block
// built BY HAND in memory (a few DmeClass / DmeProperty / DmeOptionSet / DmeOptionValue nodes with
// HAS_PROPERTY / HAS_OPTION_SET / HAS_VALUE edges, in the single-element PG-JSON array property shape
// replay-block.deserializeBlock returns). The real 23k-node CEDS base block is never opened.
//
// WHAT THIS LOCKS:
//   - property tier : exactly one HubReference per DmeProperty.
//   - value tier    : exactly one HubReference per (enumerated-property, option-value) PAIR.
//   - qualified     : the §4.3 identification pattern — a 'Has <X> Identifier Type' enumerated property
//                     plus its stem-matched '<X> Identifier' token yields one qualified ref per type
//                     value; an ABSENT/ambiguous token is RECORDED and SKIPPED, never fabricated.
//   - stableId      : deterministic 'cedsHubRef:<addressSignature>', the signature re-derivable and stable.
//   - ordering      : byte-stable (nodes sorted by stableId, edges by (type,from,to) tuple).
//   - definition    : exactly one HubDefinition.
//
// Run: node forges/ceds/test/test-referenceSubgraph.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for the ported CEDS hub reference-subgraph derivation

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives forgeHub / buildReferenceSubgraph over a tiny hand-built synthetic CEDS base block and
     proves the tier logic (property / value / qualified), the deterministic cedsHubRef stableId,
     byte-stable ordering, the identification-pattern stem match and its honest skip, and the single
     HubDefinition. Pure and in-memory; no docker, no Voyage, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const referenceSubgraph = require('../lib/referenceSubgraph');
const vocab = require('../../../lib/vocabulary/vocabulary');

// =====================================================================
// FIXTURE — a tiny synthetic CEDS base block in DESERIALIZED shape
// =====================================================================
// A node property is a single-element PG-JSON array (the shape replay-block.deserializeBlock returns);
// the derivation's v1() helper unwraps it. An edge carries {type, fromRef:{id}, toRef:{id}}. The
// DmeOptionSet node carries rangeOptionSetId, which is the property the derivation READS off the
// option-set node (referenceSubgraph.js: `v1(optionSetNode.properties.rangeOptionSetId)`).

const pgNode = (stableId, props) => ({
	stableId,
	properties: Object.keys(props).reduce((soFar, oneKey) => {
		soFar[oneKey] = [props[oneKey]];
		return soFar;
	}, {}),
});
const structuralEdge = (type, fromId, toId) => ({
	type,
	fromRef: { id: fromId },
	toRef: { id: toId },
});

// Three classes exercising all three tiers plus BOTH identification-pattern outcomes:
//   Person       — a scalar property (Birth Date) and an enumerated property (Sex, 2 values).
//   Organization — the identification pattern that RESOLVES: 'Has Organization Identifier Type'
//                  (enumerated, 2 type values) + its 'Organization Identifier' token.
//   School       — the identification pattern that is SKIPPED: 'Has Grade Identifier Type' present,
//                  but NO 'Grade Identifier' token property to qualify (recorded, not fabricated).
const buildFixture = () => ({
	nodes: [
		pgNode('cls:Person', { role: 'DmeClass', name: 'Person', domainId: 'C-Person' }),
		pgNode('cls:Org', { role: 'DmeClass', name: 'Organization', domainId: 'C-Org' }),
		pgNode('cls:School', { role: 'DmeClass', name: 'School', domainId: 'C-School' }),

		pgNode('p:BirthDate', {
			role: 'DmeProperty',
			name: 'Birth Date',
			canonicalKey: 'P-BirthDate',
			domainId: 'C-Person',
			rangeDatatype: 'date',
		}),
		pgNode('p:Sex', {
			role: 'DmeProperty',
			name: 'Sex',
			canonicalKey: 'P-Sex',
			domainId: 'C-Person',
		}),
		pgNode('os:Sex', { role: 'DmeOptionSet', name: 'Sex Set', rangeOptionSetId: 'OS-Sex' }),
		pgNode('ov:Male', {
			role: 'DmeOptionValue',
			name: 'Male',
			canonicalKey: 'OV-Male',
			uri: 'u:Male',
		}),
		pgNode('ov:Female', {
			role: 'DmeOptionValue',
			name: 'Female',
			canonicalKey: 'OV-Female',
			uri: 'u:Female',
		}),

		pgNode('p:OrgIdType', {
			role: 'DmeProperty',
			name: 'Has Organization Identifier Type',
			canonicalKey: 'P-OrgIdType',
			domainId: 'C-Org',
		}),
		pgNode('os:OrgIdType', {
			role: 'DmeOptionSet',
			name: 'Org Id Type Set',
			rangeOptionSetId: 'OS-OrgIdType',
		}),
		pgNode('ov:State', {
			role: 'DmeOptionValue',
			name: 'State',
			canonicalKey: 'OV-State',
			uri: 'u:State',
		}),
		pgNode('ov:Federal', {
			role: 'DmeOptionValue',
			name: 'Federal',
			canonicalKey: 'OV-Federal',
			uri: 'u:Federal',
		}),
		pgNode('p:OrgId', {
			role: 'DmeProperty',
			name: 'Organization Identifier',
			canonicalKey: 'P-OrgId',
			domainId: 'C-Org',
			rangeDatatype: 'string',
		}),

		pgNode('p:GradeIdType', {
			role: 'DmeProperty',
			name: 'Has Grade Identifier Type',
			canonicalKey: 'P-GradeIdType',
			domainId: 'C-School',
		}),
		pgNode('os:GradeIdType', {
			role: 'DmeOptionSet',
			name: 'Grade Id Type Set',
			rangeOptionSetId: 'OS-GradeIdType',
		}),
		pgNode('ov:Primary', {
			role: 'DmeOptionValue',
			name: 'Primary',
			canonicalKey: 'OV-Primary',
			uri: 'u:Primary',
		}),
	],
	edges: [
		structuralEdge('HAS_PROPERTY', 'cls:Person', 'p:BirthDate'),
		structuralEdge('HAS_PROPERTY', 'cls:Person', 'p:Sex'),
		structuralEdge('HAS_OPTION_SET', 'p:Sex', 'os:Sex'),
		structuralEdge('HAS_VALUE', 'os:Sex', 'ov:Male'),
		structuralEdge('HAS_VALUE', 'os:Sex', 'ov:Female'),

		structuralEdge('HAS_PROPERTY', 'cls:Org', 'p:OrgIdType'),
		structuralEdge('HAS_OPTION_SET', 'p:OrgIdType', 'os:OrgIdType'),
		structuralEdge('HAS_VALUE', 'os:OrgIdType', 'ov:State'),
		structuralEdge('HAS_VALUE', 'os:OrgIdType', 'ov:Federal'),
		structuralEdge('HAS_PROPERTY', 'cls:Org', 'p:OrgId'),

		structuralEdge('HAS_PROPERTY', 'cls:School', 'p:GradeIdType'),
		structuralEdge('HAS_OPTION_SET', 'p:GradeIdType', 'os:GradeIdType'),
		structuralEdge('HAS_VALUE', 'os:GradeIdType', 'ov:Primary'),
	],
});

// The hub instance under test. hubVersion is supplied (part of the address signature); the rest of the
// hub config takes its documented defaults.
const cedsHub = referenceSubgraph({ hubVersion: '14.0.0.0', hubNamespace: 'ceds' });
const hubSubgraph = cedsHub.forgeHub(buildFixture());

const hubReferenceNodes = hubSubgraph.nodes.filter(
	(oneNode) => oneNode.role === 'HubReference',
);
const hubDefinitionNodes = hubSubgraph.nodes.filter(
	(oneNode) => oneNode.role === 'HubDefinition',
);
const tierOf = (oneNode) =>
	oneNode.properties[vocab.HUB_REFERENCE_PROPERTIES.REFERENCE_TIER];
const propertyTierNodes = hubReferenceNodes.filter(
	(oneNode) =>
		tierOf(oneNode) === vocab.REFERENCE_TIER.PROPERTY &&
		(oneNode.properties[vocab.HUB_REFERENCE_PROPERTIES.QUALIFIER_KEYS] || []).length === 0,
);
const qualifiedNodes = hubReferenceNodes.filter(
	(oneNode) =>
		(oneNode.properties[vocab.HUB_REFERENCE_PROPERTIES.QUALIFIER_KEYS] || []).length > 0,
);
const valueTierNodes = hubReferenceNodes.filter(
	(oneNode) => tierOf(oneNode) === vocab.REFERENCE_TIER.VALUE,
);

// =====================================================================
harness.section('TIERS — one reference per canonical address');
// =====================================================================
// Five DmeProperties in the fixture -> five property-tier base references (qualifierKeys empty).
harness.equal(
	'one property-tier HubReference per DmeProperty (5 properties -> 5 base refs)',
	hubSubgraph.counts.propertyTier,
	5,
);
harness.equal(
	'  and the emitted node set agrees with the reported count',
	propertyTierNodes.length,
	5,
);
// Two enumerated properties (Sex: 2 values, Has-Org-Id-Type: 2 values, Has-Grade-Id-Type: 1 value)
// -> 5 value-tier references, one per (property, option-value) pair.
harness.equal(
	'one value-tier HubReference per (enumerated-property, option-value) pair (5)',
	hubSubgraph.counts.valueTier,
	5,
);
harness.equal(
	'  and the emitted value-tier node set agrees',
	valueTierNodes.length,
	5,
);

// =====================================================================
harness.section('QUALIFIED — the §4.3 identification pattern, stem-matched and honest');
// =====================================================================
// Organization resolves: 'Has Organization Identifier Type' (2 type values) qualifies its
// 'Organization Identifier' token -> one qualified ref per type value = 2.
harness.equal(
	'a resolved identification pattern yields one qualified ref per type value (2)',
	hubSubgraph.counts.qualified,
	2,
);
harness.equal('  and the emitted qualified node set agrees', qualifiedNodes.length, 2);
harness.equal(
	'  each qualified ref carries exactly one qualifierKey',
	qualifiedNodes.every(
		(oneNode) =>
			oneNode.properties[vocab.HUB_REFERENCE_PROPERTIES.QUALIFIER_KEYS].length === 1,
	),
	true,
);

const orgPattern = hubSubgraph.identificationPatterns.find(
	(onePattern) => onePattern.className === 'Organization',
);
harness.ok(
	'the Organization pattern is recorded as resolved against its token property',
	orgPattern &&
		orgPattern.skipped === false &&
		orgPattern.tokenProperty === 'Organization Identifier' &&
		orgPattern.qualifierValueCount === 2,
	JSON.stringify(orgPattern),
);

// School is SKIPPED: the type property is present but there is no 'Grade Identifier' token to qualify.
// The pattern is RECORDED (skipped:true, tokenMatchCount:0), never fabricated into a qualifier pairing.
const schoolPattern = hubSubgraph.identificationPatterns.find(
	(onePattern) => onePattern.className === 'School',
);
harness.ok(
	'an absent token is RECORDED and SKIPPED, not fabricated',
	schoolPattern && schoolPattern.skipped === true && schoolPattern.tokenMatchCount === 0,
	JSON.stringify(schoolPattern),
);
harness.equal(
	'  and the skipped pattern contributes NO qualified reference (no Grade qualifier leaked in)',
	qualifiedNodes.some((oneNode) =>
		String(oneNode.properties.name).indexOf('Grade') !== -1,
	),
	false,
);

// =====================================================================
harness.section('STABLE ID — deterministic cedsHubRef:<addressSignature>');
// =====================================================================
harness.equal(
	'every HubReference stableId is cedsHubRef:<its own addressSignature>',
	hubReferenceNodes.every(
		(oneNode) =>
			oneNode.stableId ===
			`cedsHubRef:${oneNode.properties[vocab.HUB_REFERENCE_PROPERTIES.ADDRESS_SIGNATURE]}`,
	),
	true,
);

// the signature is re-derivable from the address fields alone (one source of truth, the registry order).
const sexOptionRef = valueTierNodes.find(
	(oneNode) => oneNode.properties.name === 'Male',
);
const reDerivedSexMaleSig = cedsHub.addressSignatureFor({
	canonicalKey: 'OV-Male',
	domainId: 'C-Person',
	propertyKey: 'P-Sex',
	rangeOptionSetId: 'OS-Sex',
	valueKey: 'OV-Male',
	qualifierKeys: [],
});
harness.equal(
	'the Male value-tier signature is re-derivable from its address fields',
	sexOptionRef && sexOptionRef.stableId,
	`cedsHubRef:${reDerivedSexMaleSig}`,
);

// the whole derivation is deterministic: a second independent run is byte-identical.
const secondRun = referenceSubgraph({ hubVersion: '14.0.0.0', hubNamespace: 'ceds' }).forgeHub(
	buildFixture(),
);
harness.equal(
	'the derivation is deterministic — a second run is byte-identical',
	JSON.stringify(secondRun.nodes) === JSON.stringify(hubSubgraph.nodes) &&
		JSON.stringify(secondRun.edges) === JSON.stringify(hubSubgraph.edges),
	true,
);

// =====================================================================
harness.section('ORDERING — a byte-stable block');
// =====================================================================
const sortedByStableId = [...hubSubgraph.nodes]
	.map((oneNode) => oneNode.stableId)
	.every((oneStableId, index, all) => index === 0 || all[index - 1] <= oneStableId);
harness.equal('nodes are sorted by stableId', sortedByStableId, true);

const edgeTuple = (oneEdge) => `${oneEdge.type}|${oneEdge.fromRef.id}|${oneEdge.toRef.id}`;
const sortedByTuple = hubSubgraph.edges
	.map(edgeTuple)
	.every((oneTuple, index, all) => index === 0 || all[index - 1] <= oneTuple);
harness.equal('edges are sorted by (type, from, to) tuple', sortedByTuple, true);

// =====================================================================
harness.section('DEFINITION — exactly one HubDefinition');
// =====================================================================
harness.equal('exactly one HubDefinition node is emitted', hubDefinitionNodes.length, 1);
harness.equal('  and the reported count agrees', hubSubgraph.counts.hubDefinition, 1);
harness.equal(
	'  the total node set is the 12 references plus the 1 definition',
	hubSubgraph.nodes.length,
	13,
);

// =====================================================================
harness.section('SEAM — forgeHub refuses a malformed block by name');
// =====================================================================
// The forgeHub seam is the one place this port adds behavior over the incumbent derivation: a caller
// that hands it something that is not a deserialized block is REFUSED loudly, never treated as a
// zero-reference hub (polyArch2 §: no silent default for absent/invalid input).
const refuses = (badInput) => {
	const errors = [];
	try {
		cedsHub.forgeHub(badInput);
	} catch (thrown) {
		errors.push(thrown.message);
	}
	return errors;
};
harness.rejects(
	'a missing block is refused by name',
	refuses(undefined),
	/forgeHub: requires a deserialized block/,
);
harness.rejects(
	'a block whose nodes/edges are not arrays is refused by name',
	refuses({ nodes: 'nope', edges: 'nope' }),
	/forgeHub: requires a deserialized block/,
);

harness.report();
