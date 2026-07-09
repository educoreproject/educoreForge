#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the DCTAP forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL DCTAP JSON-LD asset) and asserts that, whatever the native DCTAP
// input form, the emitted node's stableId (the native CURIE) conforms to clean canonical form BEFORE
// emission, searchText is non-empty, edges are canonical + fully resolved (no danglers), the block
// is standard-pure DCTAP (_source='DCTAP', no cross-standard edges, no cedsId), and the shaping is
// deterministic.
//
// Run: node cli/lib.d/forge-dctap/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeDctap')({ embedder: null });

let pass = 0;
let fail = 0;
const check = (label, cond) => {
	if (cond) {
		pass++;
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};

// =====================================================================
// 1. normalize unit asserts — canonical forms from varied native inputs (R3 independent of live data)
// =====================================================================

check('buildStableId CURIE -> same CURIE', normalize.buildStableId({ id: 'dctap:shape' }).stableId === 'dctap:shape');
check('buildStableId underscore-local CURIE', normalize.buildStableId({ id: 'dctap:_booleanValueSet' }).stableId === 'dctap:_booleanValueSet');
check('buildStableId trims', normalize.buildStableId({ id: '  dctap:propertyID  ' }).stableId === 'dctap:propertyID');
check('buildStableId empty -> error', !!normalize.buildStableId({ id: '   ' }).error);
check('buildStableId null -> error', !!normalize.buildStableId({ id: null }).error);

check('isCleanStableId accepts a CURIE', normalize.isCleanStableId('dctap:shape'));
check('isCleanStableId accepts an underscore-local CURIE', normalize.isCleanStableId('dctap:_v_true'));
check('isCleanStableId accepts http URI', normalize.isCleanStableId('https://www.dublincore.org/specifications/dctap/x'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects bare token (no colon)', !normalize.isCleanStableId('shape'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' dctap:shape '));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: 'Draft X',
		sourceFormat: 'json-ld',
		sourceFiles: ['dctap-elements.jsonld'],
		sourceUrl: 'https://www.dublincore.org/specifications/dctap/x',
		componentCount: 1,
		elementCount: 2,
		conceptCount: 2,
		allowedValueSetCount: 2,
		allowedValueCount: 2,
	},
	nodes: [
		{ id: 'dctap:DCTAP', label: 'DctapRoot', superLabel: 'DctapModel', properties: { name: 'DCTAP' }, edges: [] },
		{
			id: 'dctap:statementTemplate',
			label: 'DctapComponent',
			superLabel: 'DctapModel',
			properties: { name: 'statement template', description: 'a statement template', uri: 'dctap:statementTemplate', definition: 'def' },
			edges: [],
		},
		// two concepts: Shape broader Profile -> SUBCLASS_OF (concept -> concept, both DmeClass).
		{
			id: 'dctap:concept_Profile',
			label: 'DctapConcept',
			superLabel: 'DctapModel',
			properties: { name: 'Profile', description: 'a profile', uri: 'dctap:concept_Profile', definition: 'def' },
			edges: [],
		},
		{
			id: 'dctap:concept_Shape',
			label: 'DctapConcept',
			superLabel: 'DctapModel',
			properties: { name: 'Shape', description: 'a shape', uri: 'dctap:concept_Shape', definition: 'def' },
			edges: [{ type: 'SUBCLASS_OF', targetId: 'dctap:concept_Profile', targetLabel: 'DctapConcept' }],
		},
		// a constrained element (HAS_OPTION_SET to the boolean set) + a plain element.
		{
			id: 'dctap:mandatory',
			label: 'DctapElement',
			superLabel: 'DctapModel',
			properties: { name: 'mandatory', description: 'is mandatory', uri: 'dctap:mandatory', cardinality: '0..1' },
			edges: [{ type: 'CONSTRAINED_BY', targetId: 'dctap:_booleanValueSet', targetLabel: 'DctapAllowedValueSet' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'dctap:statementTemplate', fromLabel: 'DctapComponent' },
			_owningClassIds: ['dctap:statementTemplate'],
		},
		{
			id: 'dctap:note',
			label: 'DctapElement',
			superLabel: 'DctapModel',
			properties: { name: 'note', description: 'a note', uri: 'dctap:note', cardinality: '0..1' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'dctap:statementTemplate', fromLabel: 'DctapComponent' },
			_owningClassIds: ['dctap:statementTemplate'],
		},
		{
			id: 'dctap:_booleanValueSet',
			label: 'DctapAllowedValueSet',
			superLabel: 'DctapModel',
			properties: { name: 'DCTAP boolean values', description: 'boolean vals', uri: 'dctap:_booleanValueSet', valueCount: 1 },
			edges: [],
		},
		// an ORPHAN value set: no element constrains to it -> root->orphan HAS_OPTION_SET.
		{
			id: 'dctap:_orphanSet',
			label: 'DctapAllowedValueSet',
			superLabel: 'DctapModel',
			properties: { name: 'Orphan Set', description: 'orphan vals', uri: 'dctap:_orphanSet', valueCount: 1 },
			edges: [],
		},
		{
			id: 'dctap:_v_true',
			label: 'DctapAllowedValue',
			superLabel: 'DctapModel',
			properties: { name: 'true', description: 'boolean true', uri: 'dctap:_v_true' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'dctap:_booleanValueSet', fromLabel: 'DctapAllowedValueSet' },
		},
		{
			id: 'dctap:_v_orphan',
			label: 'DctapAllowedValue',
			superLabel: 'DctapModel',
			properties: { name: 'orphanVal', description: 'a value', uri: 'dctap:_v_orphan' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'dctap:_orphanSet', fromLabel: 'DctapAllowedValueSet' },
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('three DmeClass (1 component + 2 concepts)', byRole('DmeClass').length === 3);
check('two DmeProperty', byRole('DmeProperty').length === 2);
check('two DmeOptionSet (value sets)', byRole('DmeOptionSet').length === 2);
check('two DmeOptionValue (values)', byRole('DmeOptionValue').length === 2);
check('zero DmeSupport (DCTAP has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === DCTAP', g.nodes.every((n) => n.properties._source === 'DCTAP'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id deterministic from stableId', g.nodes.every((n) => n.properties._id === `dctap|${n.stableId}`));
check('every node carries uri === stableId', g.nodes.every((n) => n.properties.uri === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
check('stableIds unique', new Set(g.nodes.map((n) => n.stableId)).size === g.nodes.length);

// STANDARD-PURE: DCTAP carries NO cedsId on any node.
check('no node carries cedsId (standard-pure meta-vocabulary)', g.nodes.every((n) => n.properties.cedsId === undefined));
check('every node crossRefs === []', g.nodes.every((n) => n.properties.crossRefs === '[]'));
check('DmeProperty searchText carries owning component name', g.nodes.find((n) => n.stableId === 'dctap:mandatory').properties.searchText.includes('statement template'));

// edges: only canonical types, all structural, all resolved (no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === DCTAP (standard-pure)', g.edges.every((e) => e.fromRef.source === 'DCTAP' && e.toRef.source === 'DCTAP'));
check('HAS_CLASS root->component present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'dctap:DCTAP' && e.toRef.id === 'dctap:statementTemplate'));
check('HAS_CLASS root->concept present (concept is a class)', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'dctap:DCTAP' && e.toRef.id === 'dctap:concept_Profile'));
check('HAS_PROPERTY component->element present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'dctap:statementTemplate' && e.toRef.id === 'dctap:mandatory'));
// the element OWNS its value set via HAS_OPTION_SET.
check('HAS_OPTION_SET element->set present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'dctap:mandatory' && e.toRef.id === 'dctap:_booleanValueSet'));
check('NO blanket root->set HAS_OPTION_SET for the constrained set', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'dctap:DCTAP' && e.toRef.id === 'dctap:_booleanValueSet'));
check('NO element->set REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'dctap:_booleanValueSet'));
check('SUBCLASS_OF concept->concept present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'dctap:concept_Shape' && e.toRef.id === 'dctap:concept_Profile'));
check('HAS_VALUE set->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'dctap:_booleanValueSet' && e.toRef.id === 'dctap:_v_true'));
check('NO REFERENCES edges in DCTAP', !g.edges.some((e) => e.type === 'REFERENCES'));

check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.referencesEdges === 0', g.stats.referencesEdges === 0);
check('stats.subClassOfEdges === 1', g.stats.subClassOfEdges === 1);
check('stats.orphanAnchoredOptionSets === 1 (the orphan set)', g.stats.orphanAnchoredOptionSets === 1);
check('orphan set anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'dctap:DCTAP' && e.toRef.id === 'dctap:_orphanSet'));
check('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((os) => g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// a blank @id MUST throw (R3 — never silently dropped).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.find((n) => n.id === 'dctap:note').id = '   ';
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('blank @id throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual DCTAP JSON-LD asset.
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
	check('real: 5 DmeClass (2 components + 3 concepts)', roleCount.DmeClass === 5);
	check('real: 12 DmeProperty', roleCount.DmeProperty === 12);
	check('real: 3 DmeOptionSet', roleCount.DmeOptionSet === 3);
	check('real: 15 DmeOptionValue', roleCount.DmeOptionValue === 15);
	check('real: total 36 nodes', nodes.length === 36);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === DCTAP', nodes.every((n) => n.properties._source === 'DCTAP'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries uri === stableId', nodes.every((n) => n.properties.uri === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: standard-pure (no node carries cedsId)', nodes.every((n) => n.properties.cedsId === undefined));
	check('real: only canonical edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source DCTAP)', edges.every((e) => e.fromRef.source === 'DCTAP' && e.toRef.source === 'DCTAP'));
	check('real: every DmeOptionSet reachable via HAS_OPTION_SET', nodes.filter((n) => n.role === 'DmeOptionSet').every((os) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== DCTAP REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		propertyOptionSetEdges: result.stats.propertyOptionSetEdges,
		orphanAnchoredOptionSets: result.stats.orphanAnchoredOptionSets,
		subClassOfEdges: result.stats.subClassOfEdges,
		referencesEdges: result.stats.referencesEdges,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
