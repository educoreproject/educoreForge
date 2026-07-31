#!/usr/bin/env node
'use strict';

// test-sequence-contract.js — hermetic gate for lib/sequence-contract/sequence-contract.js (the
// design-authority upgrade to the SIF sequence-capture work order, 2026-07-30): the canonical,
// standard-agnostic sibling-order stamper. PURE + synchronous; no I/O, no Docker, no LLM.
//
// PROVES:
//   SECTION 1 — the happy path: sequenceOrdinal/siblingCount/orderSemantics stamped correctly for a
//     'normative' group and a 'document' group, on the SAME finalizeSequence run.
//   SECTION 2 — refusals (RED), each named by the exact reason: nodes not an array, orderingByParent
//     not a plain object, a bad orderSemantics value (including the "never guess normative" case), a
//     non-array/empty members list, a duplicate member within one group, an unresolvable member.
//   SECTION 3 — ADDITIVITY: a node untouched by any group keeps its properties byte-unchanged; a node
//     that IS stamped keeps every property it already had, plus exactly the three new ones.
//   SECTION 4 — determinism: the same input run twice produces byte-identical output.
//   SECTION 5 — the vocabulary registration: SEQUENCE_PROPERTIES/SEQUENCE_ORDER_SEMANTICS_VALUES
//     exported by this module are the SAME objects lib/vocabulary/vocabulary.js registers — one
//     source of truth, never a locally re-declared copy that could drift.
//
// Run: node lib/sequence-contract/test/test-sequence-contract.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for lib/sequence-contract/sequence-contract.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the happy path (both orderSemantics values), every refusal BY NAME, additivity
     (untouched nodes byte-unchanged, stamped nodes gain exactly three properties), determinism, and
     that the exported property vocabulary IS the vocabulary.js registration, not a local copy.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const { finalizeSequence, SEQUENCE_PROPERTIES, SEQUENCE_ORDER_SEMANTICS_VALUES } = require('../sequence-contract');
const vocabulary = require('../../vocabulary/vocabulary');

// =====================================================================
harness.section('SECTION 1 — happy path: normative and document groups, one run');
// =====================================================================
(() => {
	const makeNode = (stableId, extra) => ({ stableId, properties: { name: stableId, ...extra } });
	const nodes = [
		makeNode('sif:field/Name/Prefix'),
		makeNode('sif:field/Name/FirstName'),
		makeNode('sif:field/Name/MiddleName'),
		makeNode('sif:field/Name/LastName'),
		makeNode('sif:field/Choice/OptionA'),
		makeNode('sif:field/Choice/OptionB'),
		makeNode('sif:field/Untouched'), // not named in any group
	];

	const orderingByParent = {
		'sif:element/Name': {
			orderSemantics: 'normative',
			members: [
				'sif:field/Name/Prefix',
				'sif:field/Name/FirstName',
				'sif:field/Name/MiddleName',
				'sif:field/Name/LastName',
			],
		},
		'sif:element/Choice': {
			orderSemantics: 'document',
			members: ['sif:field/Choice/OptionA', 'sif:field/Choice/OptionB'],
		},
	};

	let result = null;
	let err = null;
	finalizeSequence({ nodes, orderingByParent }, (e, r) => {
		err = e;
		result = r;
	});

	harness.equal('no error', err, '');
	harness.ok('callback delivers { nodes }', !!result && result.nodes === nodes);

	const byId = (stableId) => nodes.find((n) => n.stableId === stableId);

	harness.equal('Prefix: sequenceOrdinal 0', byId('sif:field/Name/Prefix').properties.sequenceOrdinal, 0);
	harness.equal('FirstName: sequenceOrdinal 1', byId('sif:field/Name/FirstName').properties.sequenceOrdinal, 1);
	harness.equal('MiddleName: sequenceOrdinal 2', byId('sif:field/Name/MiddleName').properties.sequenceOrdinal, 2);
	harness.equal('LastName: sequenceOrdinal 3', byId('sif:field/Name/LastName').properties.sequenceOrdinal, 3);
	harness.equal('every Name sibling: siblingCount 4', byId('sif:field/Name/LastName').properties.siblingCount, 4);
	harness.equal('every Name sibling: orderSemantics normative', byId('sif:field/Name/Prefix').properties.orderSemantics, 'normative');

	harness.equal('OptionA: sequenceOrdinal 0', byId('sif:field/Choice/OptionA').properties.sequenceOrdinal, 0);
	harness.equal('OptionB: sequenceOrdinal 1', byId('sif:field/Choice/OptionB').properties.sequenceOrdinal, 1);
	harness.equal('Choice siblings: siblingCount 2', byId('sif:field/Choice/OptionA').properties.siblingCount, 2);
	harness.equal('Choice siblings: orderSemantics document', byId('sif:field/Choice/OptionA').properties.orderSemantics, 'document');

	harness.equal(
		'property names match the canonical SEQUENCE_PROPERTIES registry',
		JSON.stringify(Object.keys(byId('sif:field/Name/Prefix').properties).filter((k) => k !== 'name').sort()),
		JSON.stringify([SEQUENCE_PROPERTIES.ORDER_SEMANTICS, SEQUENCE_PROPERTIES.SEQUENCE_ORDINAL, SEQUENCE_PROPERTIES.SIBLING_COUNT].sort()),
	);
})();

// =====================================================================
harness.section('SECTION 2 — refusals (RED), each named by the exact reason');
// =====================================================================

const runFinalize = (spec) => {
	let observed = null;
	finalizeSequence(spec, (err) => {
		observed = err;
	});
	return observed;
};

harness.rejects('RED: nodes not an array', [runFinalize({ nodes: 'nope', orderingByParent: {} })], /nodes is not an array/);
harness.rejects(
	'RED: orderingByParent not a plain object (array)',
	[runFinalize({ nodes: [], orderingByParent: [] })],
	/orderingByParent is not a plain object/,
);
harness.rejects(
	'RED: orderingByParent not a plain object (string)',
	[runFinalize({ nodes: [], orderingByParent: 'nope' })],
	/orderingByParent is not a plain object/,
);
harness.rejects(
	'RED: a bad orderSemantics value is refused, not guessed',
	[
		runFinalize({
			nodes: [{ stableId: 'a', properties: {} }],
			orderingByParent: { g1: { orderSemantics: 'schemaVerifiedProbably', members: ['a'] } },
		}),
	],
	/orderSemantics must be one of normative, document.*never guess 'normative'/s,
);
harness.rejects(
	'RED: members not an array',
	[
		runFinalize({
			nodes: [{ stableId: 'a', properties: {} }],
			orderingByParent: { g1: { orderSemantics: 'document', members: 'a' } },
		}),
	],
	/members must be a non-empty array/,
);
harness.rejects(
	'RED: members empty array',
	[
		runFinalize({
			nodes: [{ stableId: 'a', properties: {} }],
			orderingByParent: { g1: { orderSemantics: 'document', members: [] } },
		}),
	],
	/members must be a non-empty array/,
);
harness.rejects(
	'RED: duplicate member within one group',
	[
		runFinalize({
			nodes: [
				{ stableId: 'a', properties: {} },
				{ stableId: 'b', properties: {} },
			],
			orderingByParent: { g1: { orderSemantics: 'document', members: ['a', 'b', 'a'] } },
		}),
	],
	/lists 'a' more than once/,
);
harness.rejects(
	'RED: unresolvable member (no such node)',
	[
		runFinalize({
			nodes: [{ stableId: 'a', properties: {} }],
			orderingByParent: { g1: { orderSemantics: 'document', members: ['a', 'ghost'] } },
		}),
	],
	/'ghost'.* does not resolve to any node/s,
);

// =====================================================================
harness.section('SECTION 3 — additivity: untouched nodes byte-unchanged; stamped nodes gain exactly three keys');
// =====================================================================
(() => {
	const untouched = { stableId: 'sif:untouched', properties: { name: 'x', xpath: 'A/B/C', mandatory: true } };
	const untouchedBefore = JSON.stringify(untouched);
	const stamped = { stableId: 'sif:stamped', properties: { name: 'y', xpath: 'A/B/D' } };
	const stampedKeysBefore = Object.keys(stamped.properties).sort();

	finalizeSequence(
		{
			nodes: [untouched, stamped],
			orderingByParent: { g1: { orderSemantics: 'document', members: ['sif:stamped'] } },
		},
		() => {},
	);

	harness.equal('untouched node is byte-unchanged', JSON.stringify(untouched), untouchedBefore);
	harness.equal(
		'stamped node keeps every prior property PLUS exactly the three sequence properties',
		JSON.stringify(Object.keys(stamped.properties).sort()),
		JSON.stringify([...stampedKeysBefore, 'orderSemantics', 'sequenceOrdinal', 'siblingCount'].sort()),
	);
	harness.equal('stamped node keeps its prior xpath value', stamped.properties.xpath, 'A/B/D');
})();

// =====================================================================
harness.section('SECTION 4 — determinism: identical input run twice yields byte-identical output');
// =====================================================================
(() => {
	const buildNodes = () => [
		{ stableId: 'a', properties: { name: 'a' } },
		{ stableId: 'b', properties: { name: 'b' } },
	];
	const orderingByParent = { g1: { orderSemantics: 'normative', members: ['a', 'b'] } };

	const run1 = buildNodes();
	const run2 = buildNodes();
	finalizeSequence({ nodes: run1, orderingByParent }, () => {});
	finalizeSequence({ nodes: run2, orderingByParent }, () => {});

	harness.equal('two independent runs over equivalent input produce byte-identical output', JSON.stringify(run1), JSON.stringify(run2));
})();

// =====================================================================
harness.section('SECTION 5 — the exported vocabulary IS the vocabulary.js registration, not a local copy');
// =====================================================================
(() => {
	harness.equal(
		'SEQUENCE_PROPERTIES === vocabulary.SEQUENCE_PROPERTIES (same object identity)',
		SEQUENCE_PROPERTIES,
		vocabulary.SEQUENCE_PROPERTIES,
	);
	harness.equal(
		'SEQUENCE_ORDER_SEMANTICS_VALUES === vocabulary.SEQUENCE_ORDER_SEMANTICS_VALUES (same object identity)',
		SEQUENCE_ORDER_SEMANTICS_VALUES,
		vocabulary.SEQUENCE_ORDER_SEMANTICS_VALUES,
	);
	harness.equal('SEQUENCE_PROPERTIES.SEQUENCE_ORDINAL === "sequenceOrdinal"', SEQUENCE_PROPERTIES.SEQUENCE_ORDINAL, 'sequenceOrdinal');
	harness.equal('SEQUENCE_PROPERTIES.SIBLING_COUNT === "siblingCount"', SEQUENCE_PROPERTIES.SIBLING_COUNT, 'siblingCount');
	harness.equal('SEQUENCE_PROPERTIES.ORDER_SEMANTICS === "orderSemantics"', SEQUENCE_PROPERTIES.ORDER_SEMANTICS, 'orderSemantics');
	harness.ok(
		'vocabulary.isValidSequenceOrderSemantics accepts both real values',
		vocabulary.isValidSequenceOrderSemantics('normative') && vocabulary.isValidSequenceOrderSemantics('document'),
	);
	harness.ok(
		'vocabulary.isValidSequenceOrderSemantics rejects a bogus value',
		!vocabulary.isValidSequenceOrderSemantics('bogus'),
	);
})();

harness.report();
