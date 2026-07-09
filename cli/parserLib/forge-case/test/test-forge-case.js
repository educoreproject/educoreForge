#!/usr/bin/env node
'use strict';

// test-forge-case.js — embedding-free, fast gate for the CASE forge bundle.
// Asserts: R3 normalization (canonical CEDS cedsId forms + clean casePath stableIds; misses FAIL,
// never silent), the universal-contract shape on every emitted node, canonical ownership edges +
// provenanceTier='structural' + REFERENCES, NO dangling internal edges, exactly one DmeStandardRoot
// carrying stableUriPropertyName='casePath' and a declared mappingInstruction, and determinism of
// the PURE parse/build layer (same source -> identical structure, embeddings excluded).
// Run: node test/test-forge-case.js

const path = require('path');

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

const { parseCase } = require('../lib/parser');
const normalize = require('../lib/normalize');

// embedder is unused on the pure path; a stub guards against accidental embedding calls.
const stubEmbedder = {
	embedTexts: () => {
		throw new Error('test: embedder must NOT be called on the pure build layer');
	},
};
const forgeBundle = require('../forgeCase')({ embedder: stubEmbedder });

const SOURCE = path.join(
	__dirname,
	'..',
	'assets',
	'standardSourceData',
	'01',
	'imscasev1p1_openapi3_v1p0.yaml.txt',
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

console.log('forge-case embedding-free gate:');

// ---------------------------------------------------------------------
// R3 NORMALIZATION + casePath unit suite (no source needed; pure)
// ---------------------------------------------------------------------
console.log('\nR3 parser/normalization:');

const r3Cases = [
	{ rawValue: 'https://ceds.ed.gov/element/000021', expect: 'P000021' },
	{ rawValue: 'ceds.ed.gov/element/988', expect: 'P000988' },
	{ rawValue: '001342', expect: 'P001342' },
	{ rawValue: '731', expect: 'P000731' },
	{ rawValue: 'P000021', expect: 'P000021' },
];
r3Cases.forEach((oneCase) => {
	const result = normalize.normalizeCedsId({ rawValue: oneCase.rawValue, kind: 'element' });
	check(
		`R3 normalize CEDS '${oneCase.rawValue}' -> ${oneCase.expect}`,
		!result.error && result.cedsId === oneCase.expect,
	);
	check(
		`R3 result is canonical CEDS form (${oneCase.expect})`,
		normalize.isCanonicalCedsId(result.cedsId),
	);
});

const missResult = normalize.normalizeCedsId({ rawValue: 'no-digits-here', kind: 'element' });
check('R3 CEDS normalization miss surfaces an error (never silent)', !!missResult.error);

const casePathResult = normalize.buildCasePath(['CFItem', 'fullStatement']);
check(
	"R3 casePath builds a clean dotted form ('case:CFItem.fullStatement')",
	!casePathResult.error && casePathResult.casePath === 'case:CFItem.fullStatement',
);
check('R3 casePath result is a clean stableId', normalize.isCleanStableId(casePathResult.casePath));
check(
	'R3 casePath sanitizes odd characters into a clean token',
	!normalize.buildCasePath(['Weird Name!', 'sub/field']).error &&
		normalize.isCleanStableId(normalize.buildCasePath(['Weird Name!', 'sub/field']).casePath),
);
const emptyPath = normalize.buildCasePath([]);
check('R3 empty casePath surfaces an error (never silent)', !!emptyPath.error);

// ---------------------------------------------------------------------
// Build the contract graph (pure) ONCE, then assert contract + edges.
// ---------------------------------------------------------------------

parseCase({ sourcePath: SOURCE, xLog: process.global.xLog }, (parseErr, parsedA) => {
	if (parseErr) {
		console.error(`PARSE ERROR: ${parseErr}`);
		process.exit(1);
		return;
	}

	const graphA = forgeBundle.buildContractGraph(parsedA);

	console.log(`\nbuilt ${graphA.nodes.length} nodes, ${graphA.edges.length} edges (pure layer)`);

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
	let everyNodeHasForgedLabel = true;
	let everyNodeNonEmptySearchText = true;
	let everyStableIdClean = true;
	let everySourceCase = true;

	graphA.nodes.forEach((oneNode) => {
		const p = oneNode.properties;
		if (
			p._id == null ||
			p._source == null ||
			!p.name ||
			!p.searchText ||
			p.casePath === '' ||
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
		if (!normalize.isCleanStableId(oneNode.stableId)) {
			everyStableIdClean = false;
		}
		if (p._source !== 'CASE') {
			everySourceCase = false;
		}
		if (structuralRoles.indexOf(oneNode.role) !== -1) {
			if (p.parentId == null || p.depth == null || p.path == null) {
				everyStructuralHasStructuralProps = false;
			}
		}
	});

	check('every node carries _id/_source/name/searchText/casePath/role', everyNodeHasContract);
	check('every node has a valid role (one of the six)', everyRoleValid);
	check('every node carries the :ForgedNode super-label', everyNodeHasForgedLabel);
	check('every node has a non-empty searchText', everyNodeNonEmptySearchText);
	check('every node has a clean casePath stableId (R3 structural identity)', everyStableIdClean);
	check("every node's _source is exactly 'CASE'", everySourceCase);
	check('every structural node carries parentId/depth/path', everyStructuralHasStructuralProps);

	const aProperty = graphA.nodes.find((n) => n.role === 'DmeProperty');
	check(
		'a DmeProperty stableId equals its casePath (stableUriPropertyName)',
		aProperty && aProperty.stableId === aProperty.properties.casePath,
	);

	const roots = graphA.nodes.filter((n) => n.role === 'DmeStandardRoot');
	check('exactly one DmeStandardRoot', roots.length === 1);
	check(
		"DmeStandardRoot carries stableUriPropertyName='casePath'",
		roots.length === 1 && roots[0].properties.stableUriPropertyName === 'casePath',
	);
	check(
		'DmeStandardRoot DECLARES mappingInstruction (present, JSON)',
		roots.length === 1 && typeof roots[0].properties.mappingInstruction === 'string',
	);
	check(
		'DmeStandardRoot mappingInstruction names the CEDS anchor field (cedsGlobalIds)',
		roots.length === 1 &&
			JSON.parse(roots[0].properties.mappingInstruction).cedsOriginalAnchorPropertyName.indexOf(
				'cedsGlobalIds',
			) !== -1,
	);

	// ----- CASE-distinctive: extension-point flag survives onto DmeClass nodes -----
	console.log('\nCASE-distinctive shape:');
	const extPoints = graphA.nodes.filter(
		(n) => n.role === 'DmeClass' && n.properties.isExtensionPoint === true,
	);
	check(`a NON-ZERO count of extension-point classes flagged (got ${extPoints.length})`, extPoints.length > 0);
	const classesWithSchemaName = graphA.nodes.filter(
		(n) => n.role === 'DmeClass' && typeof n.properties.schemaName === 'string' && n.properties.schemaName.endsWith('DType'),
	);
	check('DmeClass nodes retain the raw DType schemaName', classesWithSchemaName.length > 0);

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
	check('REFERENCES edges present (cross-class $ref)', edgeTypes.REFERENCES > 0);
	check("every internal edge stamped provenanceTier='structural'", everyEdgeStructural);

	const stableIdSet = new Set(graphA.nodes.map((n) => n.stableId));
	const danglingEdges = graphA.edges.filter(
		(e) => !stableIdSet.has(e.fromRef.id) || !stableIdSet.has(e.toRef.id),
	);
	check(
		`no internal edge dangles (every endpoint resolves to a node; ${danglingEdges.length} dangling)`,
		danglingEdges.length === 0,
	);

	// ----- determinism -----
	console.log('\ndeterminism:');
	parseCase({ sourcePath: SOURCE, xLog: process.global.xLog }, (parseErr2, parsedB) => {
		if (parseErr2) {
			console.error(`PARSE ERROR (2nd): ${parseErr2}`);
			process.exit(1);
			return;
		}
		const graphB = forgeBundle.buildContractGraph(parsedB);

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

		console.log(`\nforge-case gate: ${pass} passed, ${fail} failed`);
		console.log(`  CASE counts: ${graphA.nodes.length} nodes, ${graphA.edges.length} edges`);
		if (fail > 0) {
			console.log(`FAILURES: ${failures.join('; ')}`);
		}
		process.exit(fail === 0 ? 0 : 1);
	});
});
