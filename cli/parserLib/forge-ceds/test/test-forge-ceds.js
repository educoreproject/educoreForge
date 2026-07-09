#!/usr/bin/env node
'use strict';

// test-forge-ceds.js — embedding-free, fast gate for the CEDS forge bundle.
// Asserts: R3 normalization (canonical forms; misses FAIL, never silent), the universal-contract
// shape on every emitted node, canonical ownership edges + provenanceTier='structural', and
// determinism of the PURE parse/build layer (same source -> identical structure, embeddings
// excluded). Run: node test/test-forge-ceds.js

const path = require('path');
const assert = require('assert');

// minimal process.global (the CLI injects this in production; the pure layer reads xLog only)
process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: noop,
	error: (msg) => console.error(`xLog.error: ${msg}`),
	result: noop,
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const { parseCeds } = require('../lib/parser');
const normalize = require('../lib/normalize');

// embedder is unused on the pure path; a stub guards against accidental embedding calls.
const stubEmbedder = {
	embedTexts: () => {
		throw new Error('test: embedder must NOT be called on the pure build layer');
	},
};
const forgeBundle = require('../forgeCeds')({ embedder: stubEmbedder });

const SOURCE = path.join(
	__dirname,
	'..',
	'assets',
	'standardSourceData',
	'01',
	'CEDS-Ontology.rdf',
);

let pass = 0;
let fail = 0;
const failures = [];
const check = (label, condition) => {
	if (condition) {
		pass++;
		console.log(`  PASS  ${label}`);
	} else {
		fail++;
		failures.push(label);
		console.log(`  FAIL  ${label}`);
	}
};

console.log('forge-ceds embedding-free gate:');

// ---------------------------------------------------------------------
// R3 NORMALIZATION unit suite (no source needed; pure)
// ---------------------------------------------------------------------
console.log('\nR3 parser/normalization:');

const r3Cases = [
	{ rawValue: 'https://w3id.org/CEDStandards/terms/000113', kind: 'property', expect: 'P000113' },
	{ rawValue: 'ceds:000113', kind: 'class', expect: 'C000113' },
	{ rawValue: '113', kind: 'property', expect: 'P000113' },
	{ rawValue: 'P000113', kind: 'property', expect: 'P000113' },
	{ rawValue: '12345', kind: 'optionSet', expect: 'OS012345' },
	{ rawValue: '7', kind: 'optionValue', expect: 'OV000007' },
];
r3Cases.forEach((oneCase) => {
	const result = normalize.normalizeCedsId(oneCase);
	check(
		`R3 normalize '${oneCase.rawValue}' (${oneCase.kind}) -> ${oneCase.expect}`,
		!result.error && result.cedsId === oneCase.expect,
	);
	check(
		`R3 result is canonical form (${oneCase.expect})`,
		normalize.isCanonicalCedsId(result.cedsId),
	);
});

// a normalization MISS must FAIL (return error), never silently produce junk (R3)
const missResult = normalize.normalizeCedsId({ rawValue: 'no-digits-here', kind: 'property' });
check('R3 normalization miss surfaces an error (never silent)', !!missResult.error);
const badKind = normalize.normalizeCedsId({ rawValue: '113', kind: 'bogus' });
check('R3 unknown role kind surfaces an error', !!badKind.error);

// ---------------------------------------------------------------------
// Build the contract graph (pure) ONCE, then assert contract + edges.
// ---------------------------------------------------------------------

parseCeds({ sourcePath: SOURCE, xLog: process.global.xLog }, (parseErr, parsedA) => {
	if (parseErr) {
		console.error(`PARSE ERROR: ${parseErr}`);
		process.exit(1);
		return;
	}

	const graphA = forgeBundle.buildContractGraph(parsedA);

	console.log(
		`\nbuilt ${graphA.nodes.length} nodes, ${graphA.edges.length} edges (pure layer)`,
	);

	// ----- universal-contract assertion -----
	console.log('\nuniversal-contract:');

	const validRoles = [
		'DmeStandardRoot',
		'DmeClass',
		'DmeProperty',
		'DmeOptionSet',
		'DmeOptionValue',
		'DmeSupport',
	];
	const structuralRoles = ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue'];

	let everyNodeHasContract = true;
	let everyRoleValid = true;
	let everyStructuralHasStructuralProps = true;
	let everyNodeHasCanonicalCeds = true;
	let everyNodeHasForgedLabel = true;
	let everyNodeNonEmptySearchText = true;

	graphA.nodes.forEach((oneNode) => {
		const p = oneNode.properties;
		if (
			p._id == null ||
			p._source == null ||
			!p.name ||
			!p.searchText ||
			p.stableId === '' ||
			!oneNode.stableId ||
			!p.role
		) {
			everyNodeHasContract = false;
		}
		if (validRoles.indexOf(oneNode.role) === -1) {
			everyRoleValid = false;
		}
		if (oneNode.labels.indexOf('ForgedNode') === -1) {
			everyNodeHasForgedLabel = false;
		}
		if (`${p.searchText}`.trim() === '') {
			everyNodeNonEmptySearchText = false;
		}
		if (structuralRoles.indexOf(oneNode.role) !== -1) {
			if (p.parentId == null || p.depth == null || p.path == null) {
				everyStructuralHasStructuralProps = false;
			}
			// every mappable structural node carries a canonical cedsId (R3)
			if (!normalize.isCanonicalCedsId(p.cedsId)) {
				everyNodeHasCanonicalCeds = false;
			}
		}
	});

	check('every node carries _id/_source/name/searchText/stableId/role', everyNodeHasContract);
	check('every node has a valid role (one of the six)', everyRoleValid);
	check('every node carries the :ForgedNode super-label', everyNodeHasForgedLabel);
	check('every node has a non-empty searchText', everyNodeNonEmptySearchText);
	check('every structural node carries parentId/depth/path', everyStructuralHasStructuralProps);
	check('every structural node carries a canonical cedsId (R3)', everyNodeHasCanonicalCeds);

	// exactly ONE DmeStandardRoot, carrying stableUriPropertyName + declared mappingInstruction
	const roots = graphA.nodes.filter((n) => n.role === 'DmeStandardRoot');
	check('exactly one DmeStandardRoot', roots.length === 1);
	check(
		"DmeStandardRoot carries stableUriPropertyName='uri'",
		roots.length === 1 && roots[0].properties.stableUriPropertyName === 'uri',
	);
	check(
		'DmeStandardRoot DECLARES mappingInstruction (present, JSON)',
		roots.length === 1 && typeof roots[0].properties.mappingInstruction === 'string',
	);

	// stableId IS the uri (DESIGN §D)
	const aProperty = graphA.nodes.find((n) => n.role === 'DmeProperty');
	check(
		'a DmeProperty stableId equals its uri (stableUriPropertyName)',
		aProperty && aProperty.stableId === aProperty.properties.uri,
	);

	// crossRefs is a JSON property (DECISIONS §9)
	check(
		'crossRefs is stored as a JSON-string property',
		aProperty && typeof aProperty.properties.crossRefs === 'string',
	);

	// ----- ownership-edge assertion -----
	console.log('\nedges:');
	const ownershipTypes = ['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE'];
	const edgeTypes = {};
	let everyEdgeStructural = true;
	graphA.edges.forEach((oneEdge) => {
		edgeTypes[oneEdge.type] = (edgeTypes[oneEdge.type] || 0) + 1;
		if (oneEdge.properties.provenanceTier !== 'structural') {
			everyEdgeStructural = false;
		}
	});
	console.log(`  edge type tally: ${JSON.stringify(edgeTypes)}`);
	check(
		'canonical ownership edge types present (HAS_CLASS/HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE)',
		ownershipTypes.every((t) => edgeTypes[t] > 0),
	);
	check(
		"every internal edge stamped provenanceTier='structural'",
		everyEdgeStructural,
	);
	check(
		'no legacy PART_OF edges remain (hard-cut to canonical names)',
		!edgeTypes.PART_OF,
	);

	// ----- determinism: same (source, module) -> identical structure (embeddings excluded) -----
	console.log('\ndeterminism:');
	parseCeds({ sourcePath: SOURCE, xLog: process.global.xLog }, (parseErr2, parsedB) => {
		if (parseErr2) {
			console.error(`PARSE ERROR (2nd): ${parseErr2}`);
			process.exit(1);
			return;
		}
		const graphB = forgeBundle.buildContractGraph(parsedB);

		// strip the non-deterministic ingestedAt (a timestamp) from BOTH roots before comparing;
		// it is provenance metadata, not structural. Everything else must be byte-identical. No
		// embeddings exist on the pure layer, so they are inherently excluded.
		const canonicalize = (graph) => {
			const clone = JSON.parse(JSON.stringify({ nodes: graph.nodes, edges: graph.edges }));
			clone.nodes.forEach((n) => {
				if (n.properties && n.properties.ingestedAt) {
					n.properties.ingestedAt = '<stripped>';
				}
			});
			return JSON.stringify(clone);
		};

		check(
			'two builds of the same source produce identical node/edge structure (embeddings excluded)',
			canonicalize(graphA) === canonicalize(graphB),
		);
		check('node counts identical across builds', graphA.nodes.length === graphB.nodes.length);
		check('edge counts identical across builds', graphA.edges.length === graphB.edges.length);

		console.log(`\nforge-ceds gate: ${pass} passed, ${fail} failed`);
		if (fail > 0) {
			console.log(`FAILURES: ${failures.join('; ')}`);
		}
		process.exit(fail === 0 ? 0 : 1);
	});
});
