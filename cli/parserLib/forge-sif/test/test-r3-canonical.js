#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — Phase-III R3 gate for the SIF forge (DECISIONS §23-R3/R4). ALL PURE: no
// Voyage embedding call, no Neo4j, no golden touch — it exercises normalize + buildContractGraph
// (and forge() with skipEmbedding=true over the REAL asset) and asserts that, whatever the native
// SIF input form, the emitted node's stableId + canonical CEDS cross-ref conform to clean canonical
// forms BEFORE emission, searchText is non-empty, edges are canonical + fully resolved, and the
// shaping is deterministic. A normalization miss surfaces as a FAILURE, never a silent missed mapping.
//
// Run: node cli/lib.d/forge-sif/test/test-r3-canonical.js

const path = require('path');

// minimal process.global for the bundle factory (xLog only; no embedder needed for the pure layer).
process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeSif')({ embedder: null });

let pass = 0;
let fail = 0;
const check = (label, cond) => {
	if (cond) {
		pass++;
		// console.log(`  ok  ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};

// =====================================================================
// 1. normalize unit asserts — canonical forms from varied native inputs (R3 independent of live data)
// =====================================================================

check('buildStableId root -> sif:root', normalize.buildStableId({ kind: 'root' }).stableId === 'sif:root');
check(
	'buildStableId object -> sif:object/<tableName>',
	normalize.buildStableId({ kind: 'object', key: 'StudentPersonals' }).stableId === 'sif:object/StudentPersonals',
);
check(
	'buildStableId field keeps xpath slashes',
	normalize.buildStableId({ kind: 'field', key: 'StudentPersonal/Name/FirstName' }).stableId ===
		'sif:field/StudentPersonal/Name/FirstName',
);
check(
	'buildStableId optionValue keeps fingerprint/value',
	normalize.buildStableId({ kind: 'optionValue', key: 'A|B|C/United States' }).stableId ===
		'sif:optionValue/A|B|C/United States',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'object', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts sif:root', normalize.isCleanStableId('sif:root'));
check('isCleanStableId accepts sif:field/<xpath>', normalize.isCleanStableId('sif:field/A/B/C'));
check('isCleanStableId accepts value with spaces', normalize.isCleanStableId('sif:optionValue/fp/United States'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-sif', !normalize.isCleanStableId('ceds:C000113'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' sif:root '));

// CEDS cross-ref canonicalization: bare number, zero-padded number, all -> P######
check("normalizeCedsCrossRef('534') -> P000534", normalize.normalizeCedsCrossRef({ rawValue: '534' }).cedsId === 'P000534');
check("normalizeCedsCrossRef('000534') -> P000534", normalize.normalizeCedsCrossRef({ rawValue: '000534' }).cedsId === 'P000534');
check("normalizeCedsCrossRef(534 number) -> P000534", normalize.normalizeCedsCrossRef({ rawValue: 534 }).cedsId === 'P000534');
check("normalizeCedsCrossRef('CEDS ID') -> error (no digits)", !!normalize.normalizeCedsCrossRef({ rawValue: 'CEDS ID' }).error);
check("normalizeCedsCrossRef('') -> error", !!normalize.normalizeCedsCrossRef({ rawValue: '' }).error);
check('isCanonicalCrossRefCedsId(P000534)', normalize.isCanonicalCrossRefCedsId('P000534'));
check('isCanonicalCrossRefCedsId rejects 000534', !normalize.isCanonicalCrossRefCedsId('000534'));
check('isCanonicalCrossRefCedsId rejects C000534', !normalize.isCanonicalCrossRefCedsId('C000534'));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: { version: '1.0', sourceFormat: 'tsv', objectCount: 1, fieldCount: 2 },
	nodes: [
		{ id: 'sif-root', label: 'SifRoot', properties: { name: 'SIF' }, edges: [] },
		{
			id: 'sifobject-StudentPersonals',
			label: 'SifObject',
			properties: { name: 'StudentPersonal', tableName: 'StudentPersonals', fieldCount: 2 },
			edges: [{ type: 'USES_COMPLEX_TYPE', targetId: 'complextype-Name', targetLabel: 'SifComplexType' }],
		},
		{ id: 'complextype-Name', label: 'SifComplexType', properties: { name: 'Name', fieldCount: 1 }, edges: [] },
		{ id: 'complextype-Empty', label: 'SifComplexType', properties: { name: 'EmptyScaffold', fieldCount: 0 }, edges: [] },
		{
			id: 'siffield-StudentPersonal/Name/FirstName',
			label: 'SifField',
			properties: {
				name: 'FirstName',
				xpath: 'StudentPersonal/Name/FirstName',
				cedsId: '000534',
				mandatory: true,
				description: 'the first name',
			},
			edges: [
				{ type: 'CONSTRAINED_BY', targetId: 'codeset-fp1', targetLabel: 'SifCodeset' },
				{ type: 'MEMBER_OF', targetId: 'complextype-Name', targetLabel: 'SifComplexType' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		{
			id: 'siffield-StudentPersonal/LastName',
			label: 'SifField',
			properties: { name: 'LastName', xpath: 'StudentPersonal/LastName', mandatory: false, description: '' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		{
			id: 'codeset-fp1',
			label: 'SifCodeset',
			properties: { name: 'A, B, C', fingerprint: 'A|B|C', valueCount: 3, values: ['A', 'B', 'C'] },
			edges: [],
		},
		{ id: 'simpletype-xsd:string', label: 'SifSimpleType', properties: { name: 'xsd:string', category: 'simple' }, edges: [] },
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('two DmeClass (object + 2 complexTypes = 3)', byRole('DmeClass').length === 3);
check('two DmeProperty (fields)', byRole('DmeProperty').length === 2);
check('one DmeOptionSet (codeset)', byRole('DmeOptionSet').length === 1);
check('three DmeOptionValue (expanded A/B/C)', byRole('DmeOptionValue').length === 3);
check('one DmeSupport (simpleType)', byRole('DmeSupport').length === 1);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === SIF', g.nodes.every((n) => n.properties._source === 'SIF'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries sifStableId === stableId', g.nodes.every((n) => n.properties.sifStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

// the annotated field carries canonical cedsId + crossRefs; the un-annotated one does not.
const annotated = g.nodes.find((n) => n.stableId === 'sif:field/StudentPersonal/Name/FirstName');
const unAnnotated = g.nodes.find((n) => n.stableId === 'sif:field/StudentPersonal/LastName');
check('annotated field cedsId === P000534', annotated && annotated.properties.cedsId === 'P000534');
check('annotated field cedsId is canonical', annotated && normalize.isCanonicalCrossRefCedsId(annotated.properties.cedsId));
check('annotated field crossRefs JSON carries the ceds ref', annotated && JSON.parse(annotated.properties.crossRefs)[0].id === 'P000534');
check('annotated field crossRefs retains raw form', annotated && JSON.parse(annotated.properties.crossRefs)[0].raw === '000534');
check('un-annotated field has no cedsId', unAnnotated && unAnnotated.properties.cedsId === undefined);
check('un-annotated field crossRefs === []', unAnnotated && unAnnotated.properties.crossRefs === '[]');
check('DmeProperty searchText carries owning class name', annotated && annotated.properties.searchText.includes('StudentPersonal'));

// edges: only canonical/REFERENCES types, all structural, all resolved (no throw means no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'REFERENCES']);
check('only canonical/REFERENCES edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('HAS_CLASS root->object present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'sif:root' && e.toRef.id === 'sif:object/StudentPersonals'));
check('HAS_PROPERTY object->field present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'sif:object/StudentPersonals' && e.toRef.id === 'sif:field/StudentPersonal/Name/FirstName'));
check('HAS_OPTION_SET field->codeset present', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === 'sif:codeset/A|B|C'));
check('HAS_VALUE codeset->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'sif:codeset/A|B|C'));
check('HAS_SUPPORT root->simpleType present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.toRef.id === 'sif:simpleType/xsd:string'));
check('USES_COMPLEX_TYPE translated to REFERENCES', g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'sif:complexType/Name'));

check('stats.fieldlessComplexTypes === 1', g.stats.fieldlessComplexTypes === 1);
check('stats.crossRefsAnnotated === 1', g.stats.crossRefsAnnotated === 1);
check('stats.optionValuesExpanded === 3', g.stats.optionValuesExpanded === 3);
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical node/edge counts + identical serialized shape (minus embedding).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// a present-but-unnormalizable CEDS annotation MUST throw (R3 — never silently dropped).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.find((n) => n.id === 'siffield-StudentPersonal/Name/FirstName').properties.cedsId = 'not-a-number';
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unnormalizable cedsId throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual SIF asset.
//    No Voyage, no Neo4j (skipEmbedding). Doubles as the no-cost dry-count for the Gate-A report.
// =====================================================================

const assetDir = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
bundle.forge({ sourcePath: assetDir, skipEmbedding: true }, (err, result) => {
	if (err) {
		console.error(`  FAIL  real-data forge errored: ${err}`);
		fail++;
		finish();
		return;
	}
	const nodes = result.nodes;
	const edges = result.edges;
	const roleCount = {};
	nodes.forEach((n) => { roleCount[n.role] = (roleCount[n.role] || 0) + 1; });
	const edgeCount = {};
	edges.forEach((e) => { edgeCount[e.type] = (edgeCount[e.type] || 0) + 1; });

	check('real: exactly one DmeStandardRoot', roleCount.DmeStandardRoot === 1);
	check('real: has DmeClass nodes', (roleCount.DmeClass || 0) > 0);
	check('real: has DmeProperty nodes', (roleCount.DmeProperty || 0) > 0);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === SIF', nodes.every((n) => n.properties._source === 'SIF'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries sifStableId', nodes.every((n) => n.properties.sifStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: every annotated field cedsId canonical', nodes.filter((n) => n.properties.cedsId).every((n) => normalize.isCanonicalCrossRefCedsId(n.properties.cedsId)));
	check('real: only canonical/REFERENCES edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== SIF REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		crossRefsAnnotated: result.stats.crossRefsAnnotated,
		fieldlessComplexTypes: result.stats.fieldlessComplexTypes,
		optionValuesExpanded: result.stats.optionValuesExpanded,
		codesetUnique: result.stats.codesetUnique,
		codesetAssignments: result.stats.codesetAssignments,
		codesetMerged: result.stats.codesetAssignments - result.stats.codesetUnique,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
