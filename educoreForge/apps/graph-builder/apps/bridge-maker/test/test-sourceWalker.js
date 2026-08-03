#!/usr/bin/env node
'use strict';

// test-sourceWalker.js — hermetic gate for lib.d/sourceWalker.js (bridgeKitRefactor_072726 Phase 1,
// the EXTRACT of semanticBridge's inline readForged/flattenNodeRecord/flattenCandidateRecord — the
// "walk" move of the five-move loop, design §4.3). Proves, against a graphReader DOUBLE:
//   RED  — construction without a graphReader is refused BY NAME; a call with no `standard` is
//          refused BY NAME (never a silent empty read).
//   GREEN — a well-formed walk (a) reads by the UPPERCASE-cased `_source` (THE CASE RULE — reading
//          the raw lowercase recipe token was semanticBridge's documented "0 sources extracted"
//          bug), (b) flattens exactly like semanticBridge's own flattenNodeRecord, and (c) an
//          injected `flatten: flattenCandidateRecord` adds the CEDS cedsId the pipeline needs for a
//          candidate-tier read — the SAME optional-flatten shape readForged already offers.
//
// PURE / hermetic: a graphReader DOUBLE only, no Neo4j, no network, no LLM.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-sourceWalker.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d sourceWalker kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves sourceWalker's construction + call guards (RED) and its case-correct, correctly-
     flattened read (GREEN, both the default flatten and the candidate-tier flatten override).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const sourceWalkerFactory = require('../lib.d/sourceWalker');

const graphNodes = [
	{ stableId: 's1', properties: { _source: 'LIF', role: 'DmeProperty', name: 'src one', defText: 'src one def' } },
];
const candidateNodes = [
	{ stableId: 'c1', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds one', defText: 'ceds P1 def', cedsId: 'P1' } },
];
const hubReferenceNodes = [
	{
		stableId: 'ceds:P600253',
		properties: {
			_source: 'CEDS',
			role: 'HubReference',
			name: 'Has LEA Title I Support Service',
			defText: 'has-lea-def',
			cedsId: 'P600253',
			canonicalKey: 'P600253',
			hubName: 'CEDS',
			hubVersion: '14.0.0.0',
			referenceTier: 'property',
			qualifierKeys: [],
			domainId: 'C200188',
			rangeClassId: 'C200196',
			anchorUri: 'https://ceds.ed.gov/element/000253',
		},
	},
];

const graphReaderDouble = () => {
	const readCalls = [];
	return {
		readCalls,
		readNodes: ({ label, propertyEquals }, callback) => {
			readCalls.push({ label, propertyEquals });
			if (label !== 'ForgedNode') {
				callback('', { nodes: [] });
				return;
			}
			if (propertyEquals._source === 'LIF' && propertyEquals.role === 'DmeProperty') {
				callback('', { nodes: graphNodes });
				return;
			}
			if (propertyEquals._source === 'CEDS' && propertyEquals.role === 'DmeProperty') {
				callback('', { nodes: candidateNodes });
				return;
			}
			if (propertyEquals._source === 'CEDS' && propertyEquals.role === 'HubReference') {
				callback('', { nodes: hubReferenceNodes });
				return;
			}
			callback('', { nodes: [] });
		},
	};
};

// =====================================================================
harness.section('RED — construction and call guards refuse BY NAME');
// =====================================================================
harness.match(
	'constructing without a graphReader throws, naming the reason',
	(() => {
		try {
			sourceWalkerFactory({});
			return '';
		} catch (constructionError) {
			return constructionError.message;
		}
	})(),
	/constructed without a graphReader/,
);

(() => {
	const walker = sourceWalkerFactory({ graphReader: graphReaderDouble() });
	let observed = null;
	walker.walk({}, (err, out) => {
		observed = { err, out };
	});
	harness.match('walk() with no standard is refused BY NAME', observed && observed.err, /standard is not given/);
})();

// =====================================================================
harness.section('GREEN — THE CASE RULE + default flatten (subject-standard read)');
// =====================================================================
(() => {
	const reader = graphReaderDouble();
	const walker = sourceWalkerFactory({ graphReader: reader });
	let observed = null;
	// THE EXACT-NAME RULE (2026-07-31): the caller passes the DECLARED standardName VERBATIM ('LIF').
	walker.walk({ standard: 'LIF' }, (err, out) => {
		observed = { err, out };
	});
	harness.ok('walk() did not error', observed && !observed.err, observed && observed.err);
	harness.equal('read by the EXACT declared _source (the exact-name rule)', reader.readCalls[0].propertyEquals._source, 'LIF');
	harness.equal('default role is DmeProperty', reader.readCalls[0].propertyEquals.role, 'DmeProperty');
	harness.equal('exactly 1 flattened source node', observed.out.sourceNodes.length, 1);
	harness.equal('stableId carried through', observed.out.sourceNodes[0].stableId, 's1');
	harness.equal('defText flattened correctly', observed.out.sourceNodes[0].defText, 'src one def');
	harness.ok('default flatten does NOT carry cedsId', observed.out.sourceNodes[0].cedsId === undefined);
})();

// =====================================================================
harness.section('GREEN — candidate-tier read via the injected flattenCandidateRecord override');
// =====================================================================
(() => {
	const reader = graphReaderDouble();
	const walker = sourceWalkerFactory({ graphReader: reader });
	let observed = null;
	walker.walk({ standard: 'CEDS', flatten: sourceWalkerFactory.flattenCandidateRecord }, (err, out) => {
		observed = { err, out };
	});
	harness.ok('walk() did not error', observed && !observed.err, observed && observed.err);
	harness.equal('candidate flatten carries cedsId', observed.out.sourceNodes[0].cedsId, 'P1');
	harness.equal('candidate flatten still carries the base fields', observed.out.sourceNodes[0].defText, 'ceds P1 def');
})();

// =====================================================================
harness.section('GREEN — flattenFullRecord (spec §5 retrieval-enrichment reversal): the FULL element');
// =====================================================================
(() => {
	const reader = graphReaderDouble();
	const walker = sourceWalkerFactory({ graphReader: reader });
	let observed = null;
	walker.walk({ standard: 'CEDS', role: 'HubReference', flatten: sourceWalkerFactory.flattenFullRecord }, (err, out) => {
		observed = { err, out };
	});
	harness.ok('walk() did not error', observed && !observed.err, observed && observed.err);
	const full = observed.out.sourceNodes[0];
	harness.equal('full flatten still carries the flat convenience fields (stableId)', full.stableId, 'ceds:P600253');
	harness.equal('full flatten still carries the defText fallback-computed field', full.defText, 'has-lea-def');
	harness.equal('full flatten still carries cedsId (flattenCandidateRecord layer)', full.cedsId, 'P600253');
	harness.equal(
		'full flatten ALSO carries raw properties the flat shapes never surfaced (hubName)',
		full.hubName,
		'CEDS',
	);
	harness.equal('full flatten carries hubVersion (raw, not in the flat shape)', full.hubVersion, '14.0.0.0');
	harness.equal('full flatten carries referenceTier (raw, not in the flat shape)', full.referenceTier, 'property');
	harness.equal('full flatten carries anchorUri (raw, not in the flat shape)', full.anchorUri, 'https://ceds.ed.gov/element/000253');
	harness.equal(
		'full flatten carries rangeClassId (raw; the flat shape only ever surfaced rangeDatatype/rangeOptionSetId)',
		full.rangeClassId,
		'C200196',
	);
})();

// =====================================================================
harness.section('COEXISTENCE — flattenFullRecord is opt-in ONLY: the default walk (no flatten override) is byte-identical to before');
// =====================================================================
(() => {
	const reader = graphReaderDouble();
	const walker = sourceWalkerFactory({ graphReader: reader });
	let observed = null;
	// same call as the very first GREEN section above (default flatten, no override) — proves adding
	// flattenFullRecord to this module did not perturb the existing default path in any way.
	walker.walk({ standard: 'LIF' }, (err, out) => {
		observed = { err, out };
	});
	harness.ok('walk() did not error', observed && !observed.err, observed && observed.err);
	harness.equal(
		'default-flatten shape is UNCHANGED: exactly the 9 documented keys, nothing more',
		Object.keys(observed.out.sourceNodes[0]).sort().join(','),
		['stableId', 'role', 'name', 'defText', 'domainId', 'rangeDatatype', 'parentId', 'notation', 'canonicalKey', 'rangeOptionSetId']
			.sort()
			.join(','),
	);
})();

// =====================================================================
// ⟪hubReimplementation P3, ruling 2026-08-03⟫ GREEN — flattenFullRecord LIST-VALUED PASSTHROUGH:
// the declared list-valued properties (embedding, qualifierKeys, qualifierNames) ride through
// VERBATIM — the v1() collapse that serves PG-collapsed scalars must never truncate a genuine list
// to its first element (a live card's 1024-dim embedding collapsed to ONE FLOAT is how this was
// found). Scalar collapse for every OTHER property is asserted PRESERVED byte-identically.
// Three-state proof of record: this section was written FIRST and OBSERVED RED against the
// pre-ruling flattenFullRecord (embedding read back as 0.25, qualifierKeys as 'OV1'), then the
// registry fix landed and it went green — the gate bit before it passed.
// =====================================================================
harness.section('GREEN — flattenFullRecord list-valued passthrough (P3 ruling): lists stay lists, scalars still collapse');
(() => {
	const flattened = sourceWalkerFactory.flattenFullRecord({
		stableId: 'ceds:listShapeProbe',
		properties: {
			role: 'HubReference',
			name: 'List Shape Probe',
			canonicalKey: 'P900001',
			embedding: [0.25, 0.5, 0.75],
			qualifierKeys: ['OV1', 'OV2'],
			qualifierNames: ['First Qualifier', 'Second Qualifier'],
			rangeDatatype: ['string'], // a PG-collapsible single-element list — MUST still collapse
		},
	});
	harness.ok('embedding rides through as an ARRAY', Array.isArray(flattened.embedding));
	harness.equal('embedding keeps EVERY element (no first-float truncation)', (flattened.embedding || []).length, 3);
	harness.equal('embedding values intact', JSON.stringify(flattened.embedding), JSON.stringify([0.25, 0.5, 0.75]));
	harness.ok('qualifierKeys rides through as an ARRAY', Array.isArray(flattened.qualifierKeys));
	harness.equal('qualifierKeys keeps BOTH entries', (flattened.qualifierKeys || []).length, 2);
	harness.ok('qualifierNames rides through as an ARRAY', Array.isArray(flattened.qualifierNames));
	harness.equal('qualifierNames keeps BOTH entries', (flattened.qualifierNames || []).length, 2);
	harness.equal('a NON-registry single-element list still collapses via v1 (existing behavior preserved)', flattened.rangeDatatype, 'string');
	// a PG-collapsed registry property (stored as a bare scalar) is passed through UNTOUCHED — the
	// asList consumers (cedsHubModule, referenceIndex) normalize it exactly as they always have.
	const collapsedShape = sourceWalkerFactory.flattenFullRecord({
		stableId: 'ceds:collapsedProbe',
		properties: { role: 'HubReference', name: 'Collapsed Probe', qualifierKeys: 'OV_solo' },
	});
	harness.equal('a PG-collapsed registry property stays the scalar it arrived as', collapsedShape.qualifierKeys, 'OV_solo');
})();

harness.report();
