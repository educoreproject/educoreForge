#!/usr/bin/env node
'use strict';

// test-forge-lif.js — embedding-free, fast gate for the LIF forge bundle.
// Asserts: R3 normalization (canonical CEDS cedsId forms + clean lifPath stableIds; misses FAIL,
// never silent), the universal-contract shape on every emitted node, canonical ownership edges +
// provenanceTier='structural', a NON-ZERO count of nodes carrying a canonical cedsId (the LIF→CEDS
// crossRef capture — critical for Phase-7 specified bridging), and determinism of the PURE
// parse/build layer (same source -> identical structure, embeddings excluded).
// Run: node test/test-forge-lif.js

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

const { parseLif } = require('../lib/parser');
const normalize = require('../lib/normalize');

// embedder is unused on the pure path; a stub guards against accidental embedding calls.
const stubEmbedder = {
	embedTexts: () => {
		throw new Error('test: embedder must NOT be called on the pure build layer');
	},
};
const forgeBundle = require('../forgeLif')({ embedder: stubEmbedder });

const SOURCE = path.join(
	__dirname,
	'..',
	'assets',
	'standardSourceData',
	'01',
	'data_model_1_bare_openapi_schema.1.json',
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

console.log('forge-lif embedding-free gate:');

// ---------------------------------------------------------------------
// R3 NORMALIZATION + lifPath unit suite (no source needed; pure)
// ---------------------------------------------------------------------
console.log('\nR3 parser/normalization:');

// CEDS element id normalization — whatever the native input form -> canonical P<6-digit>.
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

// a normalization MISS must FAIL (return error), never silently produce junk (R3)
const missResult = normalize.normalizeCedsId({ rawValue: 'no-digits-here', kind: 'element' });
check('R3 CEDS normalization miss surfaces an error (never silent)', !!missResult.error);
const badKind = normalize.normalizeCedsId({ rawValue: '21', kind: 'bogus' });
check('R3 unknown CEDS kind surfaces an error', !!badKind.error);

// lifPath: clean dotted structural stableId; a clean form is recognized, junk is rejected.
const lifPathResult = normalize.buildLifPath(['Person', 'name', 'given']);
check(
	"R3 lifPath builds a clean dotted form ('lif:Person.name.given')",
	!lifPathResult.error && lifPathResult.lifPath === 'lif:Person.name.given',
);
check('R3 lifPath result is a clean stableId', normalize.isCleanStableId(lifPathResult.lifPath));
check(
	'R3 lifPath sanitizes odd characters into a clean token',
	!normalize.buildLifPath(['Weird Name!', 'sub/field']).error &&
		normalize.isCleanStableId(normalize.buildLifPath(['Weird Name!', 'sub/field']).lifPath),
);
const emptyPath = normalize.buildLifPath([]);
check('R3 empty lifPath surfaces an error (never silent)', !!emptyPath.error);

// ---------------------------------------------------------------------
// Build the contract graph (pure) ONCE, then assert contract + edges + cedsId coverage.
// ---------------------------------------------------------------------

parseLif({ sourcePath: SOURCE, xLog: process.global.xLog }, (parseErr, parsedA) => {
	if (parseErr) {
		console.error(`PARSE ERROR: ${parseErr}`);
		process.exit(1);
		return;
	}

	const graphA = forgeBundle.buildContractGraph(parsedA);

	console.log(`\nbuilt ${graphA.nodes.length} nodes, ${graphA.edges.length} edges (pure layer)`);

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
	let everyNodeHasForgedLabel = true;
	let everyNodeNonEmptySearchText = true;
	let everyStableIdClean = true;

	graphA.nodes.forEach((oneNode) => {
		const p = oneNode.properties;
		if (
			p._id == null ||
			p._source == null ||
			!p.name ||
			!p.searchText ||
			p.lifPath === '' ||
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
		if (structuralRoles.indexOf(oneNode.role) !== -1) {
			if (p.parentId == null || p.depth == null || p.path == null) {
				everyStructuralHasStructuralProps = false;
			}
		}
	});

	check('every node carries _id/_source/name/searchText/lifPath/role', everyNodeHasContract);
	check('every node has a valid role (one of the six)', everyRoleValid);
	check('every node carries the :ForgedNode super-label', everyNodeHasForgedLabel);
	check('every node has a non-empty searchText', everyNodeNonEmptySearchText);
	check('every node has a clean lifPath stableId (R3 structural identity)', everyStableIdClean);
	check('every structural node carries parentId/depth/path', everyStructuralHasStructuralProps);

	// stableId IS the lifPath (DESIGN §D)
	const aProperty = graphA.nodes.find((n) => n.role === 'DmeProperty');
	check(
		'a DmeProperty stableId equals its lifPath (stableUriPropertyName)',
		aProperty && aProperty.stableId === aProperty.properties.lifPath,
	);

	// exactly ONE DmeStandardRoot, carrying stableUriPropertyName + declared mappingInstruction
	const roots = graphA.nodes.filter((n) => n.role === 'DmeStandardRoot');
	check('exactly one DmeStandardRoot', roots.length === 1);
	check(
		"DmeStandardRoot carries stableUriPropertyName='lifPath'",
		roots.length === 1 && roots[0].properties.stableUriPropertyName === 'lifPath',
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

	// ----- the CRITICAL LIF→CEDS crossRef capture (Phase-7 specified bridge fuel) -----
	console.log('\ncrossRefs / cedsId capture:');
	const nodesWithCedsId = graphA.nodes.filter((n) =>
		normalize.isCanonicalCedsId(n.properties.cedsId),
	);
	check(
		`a NON-ZERO count of nodes carry a canonical cedsId (got ${nodesWithCedsId.length})`,
		nodesWithCedsId.length > 0,
	);
	check(
		'every cedsId-bearing node also carries crossRefs as a JSON-string property',
		nodesWithCedsId.every((n) => typeof n.properties.crossRefs === 'string'),
	);
	check(
		"every cedsId-bearing node records cedsOriginalAnchorPropertyName=['cedsGlobalIds']",
		nodesWithCedsId.every(
			(n) =>
				Array.isArray(n.properties.cedsOriginalAnchorPropertyName) &&
				n.properties.cedsOriginalAnchorPropertyName.indexOf('cedsGlobalIds') !== -1,
		),
	);
	// the crossRef id must equal the canonical cedsId (normalized, not the raw native form)
	check(
		'crossRef.id is the canonical cedsId (R3 normalized, not the raw native form)',
		nodesWithCedsId.every((n) => {
			const refs = JSON.parse(n.properties.crossRefs);
			return refs.length > 0 && refs[0].id === n.properties.cedsId && refs[0].raw != null;
		}),
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
	check("every internal edge stamped provenanceTier='structural'", everyEdgeStructural);
	check(
		'no legacy HAS_ENTITY/HAS_COMPOSITE edges remain (hard-cut to canonical names)',
		!edgeTypes.HAS_ENTITY && !edgeTypes.HAS_COMPOSITE,
	);

	// every edge endpoint must reference a real node stableId (no dangling internal edges)
	const stableIdSet = new Set(graphA.nodes.map((n) => n.stableId));
	const danglingEdges = graphA.edges.filter(
		(e) => !stableIdSet.has(e.fromRef.id) || !stableIdSet.has(e.toRef.id),
	);
	check(
		`no internal edge dangles (every endpoint resolves to a node; ${danglingEdges.length} dangling)`,
		danglingEdges.length === 0,
	);

	// ----- determinism: same (source, module) -> identical structure (embeddings excluded) -----
	console.log('\ndeterminism:');
	parseLif({ sourcePath: SOURCE, xLog: process.global.xLog }, (parseErr2, parsedB) => {
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

		console.log(`\nforge-lif gate: ${pass} passed, ${fail} failed`);
		console.log(
			`  LIF counts: ${graphA.nodes.length} nodes, ${graphA.edges.length} edges, ${nodesWithCedsId.length} nodes with canonical cedsId`,
		);
		if (fail > 0) {
			console.log(`FAILURES: ${failures.join('; ')}`);
		}
		process.exit(fail === 0 ? 0 : 1);
	});
});
