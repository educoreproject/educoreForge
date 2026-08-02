#!/usr/bin/env node
'use strict';

// test-hubTupleClosure.js — THE HUB IS CORRECT WHEN IT HAS ONE CARD PER VALID TUPLE.
//
// ⟪TQ, 2026-08-02⟫ "Why do we have an expected number? Why isn't it, Create Hubs and count them?"
//
// Neither, as it turns out. "Count what you made" asserts nothing -- it compares the code's
// output to the code's output and stays green on the day the minter drops half the corpus. But
// a FROZEN LITERAL (test-hubReferenceCountDerived asserts 29,789) is arbitrary: nobody can tell
// by reading it whether it is right, and every deliberate change costs a re-baselining ceremony
// in which the number quietly becomes "whatever the code did".
//
// THE THIRD OPTION, and the one this file implements: derive the expectation FROM THE SOURCE and
// compare two derivations.
//
//     one property-tier card per declared (domain, property) pair
//     one value-tier card per declared (domain, property, value) triple
//     and nothing else
//
// That is exactly what the round-trip gate does for Layer 1: it never asserts "239,761
// statements", it asserts "every statement the source makes". The number is derived on BOTH
// sides, which is why Layer 1 has needed zero re-baselining while this file's predecessor has
// needed three in one day.
//
// WHAT IT BUYS. CEDS 15.0 will not need a re-baseline. The multi-domain fix will not need one
// either -- the expectation moves correctly by itself, because CEDS declares the domains and the
// rule reads them. And the assertion becomes readable: it says what a correct hub IS, rather
// than what one happened to weigh on 2 August 2026.
//
// EXPECTED TO FAIL ON ARRIVAL. Written BEFORE the minter is fixed, deliberately, so the fix is
// proven by watching this go green rather than by a number predicted and then confirmed. As of
// writing, referenceSubgraph.js reads props.domainId -- ONE domain -- so a property CEDS
// declares against two domains gets one card and the second addressable context does not exist.
//
// Pure and in-memory: parses the local CEDS asset, forges, derives the hub. No Docker, no
// network, no embedding.
//
// Run: node forges/ceds/test/test-hubTupleClosure.js [-verbose]

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the hub is correct when it has one card per valid CEDS tuple

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Derives the set of valid tuples from the forged CEDS base -- every declared
     (domain, property) pair and every (domain, property, value) triple -- and asserts the hub
     carries exactly one HubReference for each, with no extras. Both sides derived; no frozen
     literal. Pure and in-memory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const forgeCeds = require('../forgeCeds')({});
const referenceSubgraph = require('../lib/referenceSubgraph');

const CEDS_SOURCE_PATH = path.join(
	__dirname, '..', 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf',
);

// v1 — the replay engine scalarizes single-element arrays, so a property the forge wrote as
// ['C000123'] reads back as the bare string. Never test Array.isArray(); 2,068 of 2,324 property
// nodes are affected and a naive read silently visits one domain for 89% of the corpus.
const valueListOf = (value) =>
	[]
		.concat(value === undefined || value === null ? [] : value)
		.filter((one) => typeof one === 'string' && one.trim() !== '');

// =====================================================================================
// deriveValidTuples — THE RULE, read out of the forged base rather than remembered.
// =====================================================================================
const deriveValidTuples = ({ nodes, edges }) => {
	const byRole = {};
	nodes.forEach((oneNode) => {
		(byRole[oneNode.role] = byRole[oneNode.role] || []).push(oneNode);
	});

	// property -> its option set, and option set -> its values, from the ownership edges
	const optionSetOfProperty = {};
	const valuesOfOptionSet = {};
	edges.forEach((oneEdge) => {
		if (oneEdge.type === 'HAS_OPTION_SET') {
			optionSetOfProperty[oneEdge.fromRef.id] = oneEdge.toRef.id;
		}
		if (oneEdge.type === 'HAS_VALUE') {
			(valuesOfOptionSet[oneEdge.fromRef.id] = valuesOfOptionSet[oneEdge.fromRef.id] || []).push(
				oneEdge.toRef.id,
			);
		}
	});

	// A value's HubReference is keyed by the value's CANONICAL KEY (OV-form), but the HAS_VALUE
	// edge names its stableId (a URI). Comparing the two directly reports every triple as both
	// missing and extra -- which is what the first run of this file did, and it was my bug, not
	// the minter's. Map one to the other.
	const canonicalKeyByStableId = {};
	(byRole.DmeOptionValue || []).forEach((oneValue) => {
		canonicalKeyByStableId[oneValue.stableId] = (oneValue.properties || {}).canonicalKey;
	});

	const propertyTier = new Set();
	const valueTier = new Set();

	(byRole.DmeProperty || []).forEach((oneProperty) => {
		const props = oneProperty.properties || {};
		// EVERY DECLARED DOMAIN, not just the first. This single line is the whole difference
		// between the rule and what the minter currently does.
		const declaredDomains = valueListOf(props.allDomainIds).length
			? valueListOf(props.allDomainIds)
			: valueListOf(props.domainId);
		const propertyKey = props.canonicalKey;
		if (!propertyKey) {
			return;
		}
		const optionSetId = optionSetOfProperty[oneProperty.stableId];
		const valueIds = optionSetId ? valuesOfOptionSet[optionSetId] || [] : [];

		declaredDomains.forEach((oneDomain) => {
			propertyTier.add(`${oneDomain}|${propertyKey}`);
			valueIds.forEach((oneValueId) => {
				const valueKey = canonicalKeyByStableId[oneValueId];
				if (valueKey) {
					valueTier.add(`${oneDomain}|${propertyKey}|${valueKey}`);
				}
			});
		});
	});

	return { propertyTier, valueTier };
};

// =====================================================================================
forgeCeds.forge({ sourcePath: CEDS_SOURCE_PATH, skipEmbedding: true }, (forgeError, base) => {
	if (forgeError) {
		harness.ok('CEDS forge succeeded (local asset, no embedding)', false, String(forgeError));
		harness.report();
		return;
	}

	const hub = referenceSubgraph({}).forgeHub({ nodes: base.nodes, edges: base.edges });
	const expected = deriveValidTuples(base);

	const hubNodes = (hub.nodes || []).filter((one) => one.role === 'HubReference');
	const actualPropertyTier = new Set();
	const actualValueTier = new Set();
	hubNodes.forEach((oneNode) => {
		const p = oneNode.properties || {};
		const domain = p.domainId;
		const propertyKey = p.propertyKey;
		const value = p.canonicalKey;
		if (!domain || !propertyKey) {
			return;
		}
		if (p.referenceTier === 'value') {
			actualValueTier.add(`${domain}|${propertyKey}|${value}`);
		} else {
			actualPropertyTier.add(`${domain}|${propertyKey}`);
		}
	});

	const missing = (want, have) => Array.from(want).filter((one) => !have.has(one));
	const extra = (want, have) => Array.from(have).filter((one) => !want.has(one));

	// =====================================================================
	harness.section('THE RULE — both sides derived, no frozen literal anywhere');
	harness.note(
		`declared property-tier tuples ${expected.propertyTier.size}, minted ${actualPropertyTier.size}`,
	);
	harness.note(
		`declared value-tier tuples ${expected.valueTier.size}, minted ${actualValueTier.size}`,
	);

	// =====================================================================
	harness.section('PROPERTY TIER — one card per declared (domain, property)');
	const missingProperty = missing(expected.propertyTier, actualPropertyTier);
	harness.equal(
		'every declared (domain, property) pair has a card',
		missingProperty.length,
		0,
	);
	if (missingProperty.length) {
		harness.note(`first 5 unaddressable: ${missingProperty.slice(0, 5).join('  ')}`);
	}
	harness.equal(
		'and no card exists for a pair CEDS does not declare',
		extra(expected.propertyTier, actualPropertyTier).length,
		0,
	);

	// =====================================================================
	harness.section('VALUE TIER — one card per declared (domain, property, value)');
	const missingValue = missing(expected.valueTier, actualValueTier);
	harness.equal('every declared triple has a card', missingValue.length, 0);
	if (missingValue.length) {
		harness.note(`first 3 unaddressable: ${missingValue.slice(0, 3).join('  ')}`);
	}
	harness.equal(
		'and no card exists for a triple CEDS does not declare',
		extra(expected.valueTier, actualValueTier).length,
		0,
	);

	// =====================================================================
	harness.section('THE RULE CAN FAIL — a derived expectation that always matches proves nothing');
	// The twin: pretend a property declares one more domain than it does. The rule must then
	// demand a card that does not exist. Without this the whole file could be a tautology.
	const twinExpected = deriveValidTuples(base);
	twinExpected.propertyTier.add('C999999|P999999');
	harness.ok(
		'an invented declared tuple is reported MISSING',
		missing(twinExpected.propertyTier, actualPropertyTier).length ===
			missingProperty.length + 1,
	);

	harness.note('both sides read CEDS; nothing here needs re-baselining when CEDS changes');
	harness.report();
});
