#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the SEDM forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL CSV+JSON assets) and asserts that, whatever the native SEDM input
// form, the emitted node's stableId + canonical CEDS cross-ref conform to clean canonical forms
// BEFORE emission, searchText is non-empty, edges are canonical + fully resolved, the block is
// standard-pure SEDM (_source='SEDM', no cross-standard edges), and the shaping is deterministic.
//
// Run: node cli/lib.d/forge-sedm/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeSedm')({ embedder: null });

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

check('buildStableId root -> sedm:root', normalize.buildStableId({ kind: 'root' }).stableId === 'sedm:root');
check(
	'buildStableId class -> sedm:class/<key>',
	normalize.buildStableId({ kind: 'class', key: 'Time' }).stableId === 'sedm:class/Time',
);
check(
	'buildStableId element keeps composite key',
	normalize.buildStableId({ kind: 'element', key: '000218.student.disability' }).stableId ===
		'sedm:element/000218.student.disability',
);
check(
	'buildStableId optionValue keeps set.code key',
	normalize.buildStableId({ kind: 'optionValue', key: 'declared.primaryDisabilityType.aut' }).stableId ===
		'sedm:value/declared.primaryDisabilityType.aut',
);
check(
	'buildStableId support -> sedm:support/<key>',
	normalize.buildStableId({ kind: 'support', key: 'indicator.1' }).stableId === 'sedm:support/indicator.1',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'element', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts sedm:root', normalize.isCleanStableId('sedm:root'));
check('isCleanStableId accepts sedm:element/<key>', normalize.isCleanStableId('sedm:element/A.B'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-sedm', !normalize.isCleanStableId('ceds:C000113'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' sedm:root '));

// CEDS cross-ref canonicalization: bare number, zero-padded, sentinels, all handled correctly.
check("normalizeCedsCrossRef('218') -> P000218", normalize.normalizeCedsCrossRef({ rawValue: '218' }).cedsId === 'P000218');
check("normalizeCedsCrossRef('000218') -> P000218", normalize.normalizeCedsCrossRef({ rawValue: '000218' }).cedsId === 'P000218');
check("normalizeCedsCrossRef(218 number) -> P000218", normalize.normalizeCedsCrossRef({ rawValue: 218 }).cedsId === 'P000218');
check("normalizeCedsCrossRef('000000') -> absent (sentinel)", !!normalize.normalizeCedsCrossRef({ rawValue: '000000' }).absent);
check("normalizeCedsCrossRef('Proposed') -> absent (sentinel)", !!normalize.normalizeCedsCrossRef({ rawValue: 'Proposed' }).absent);
check("normalizeCedsCrossRef('') -> absent", !!normalize.normalizeCedsCrossRef({ rawValue: '' }).absent);
check("normalizeCedsCrossRef('no-digits') -> error", !!normalize.normalizeCedsCrossRef({ rawValue: 'no-digits' }).error);
check('isCanonicalCrossRefCedsId(P000218)', normalize.isCanonicalCrossRefCedsId('P000218'));
check('isCanonicalCrossRefCedsId rejects 000218', !normalize.isCanonicalCrossRefCedsId('000218'));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: { version: '1.0', sourceFormat: 'csv+json', totalNodes: 9 },
	nodes: [
		{ id: 'sedm-root', label: 'SedmRoot', properties: { name: 'SEDM' }, edges: [] },
		// a DmeClass (ontology class) + a subtype that REFERENCES it.
		{
			id: 'sedm-ontclass-time',
			label: 'SedmOntologyClass',
			properties: { name: 'Time', naturalKey: 'Time', description: 'time class' },
			edges: [],
		},
		{
			id: 'sedm-ontsubtype-time-datetime',
			label: 'SedmOntologyClass',
			properties: { name: 'DateTime', naturalKey: 'Time.DateTime', description: 'sub', parentClass: 'Time' },
			edges: [],
			_referenceEdges: [{ type: 'REFERENCES', targetId: 'sedm-ontclass-time', targetLabel: 'SedmOntologyClass' }],
		},
		// a DmeClass (compliance category) + a DmeSupport (indicator) that REFERENCES it.
		{
			id: 'sedm-compliance-2',
			label: 'SedmComplianceCategory',
			properties: { name: 'Evaluation', naturalKey: 'compliance.2', number: 2, description: 'cc2' },
			edges: [],
		},
		{
			id: 'sedm-indicator-1',
			label: 'SedmIndicator',
			properties: { name: 'Indicator 1: Graduation', naturalKey: 'indicator.1', number: 1, description: 'grad', complianceCategoryNumber: 2 },
			edges: [],
			_referenceEdges: [{ type: 'REFERENCES', targetId: 'sedm-compliance-2', targetLabel: 'SedmComplianceCategory' }],
		},
		// an ETL template (DmeSupport) referenced by an element.
		{
			id: 'sedm-etl-childcountetl',
			label: 'SedmEtlTemplate',
			properties: { name: 'Child Count ETL', naturalKey: 'etl.childcountetl', csvColumn: 'Child Count ETL', description: 'etl' },
			edges: [],
		},
		// an element (DmeProperty) WITH an inline option set (CONSTRAINED_BY) + a CEDS cross-ref + an ETL ref.
		{
			id: 'sedm-element-000218-student-disability',
			label: 'SedmElement',
			properties: {
				name: 'Primary Disability Type',
				naturalKey: '000218.student.disability',
				description: 'the disability',
				entity: 'Student',
				category: 'Disability',
				cedsGlobalId: '000218',
			},
			edges: [
				{ type: 'CONSTRAINED_BY', targetId: 'sedm-optionset-000218-student-disability', targetLabel: 'SedmOptionSet' },
				{ type: 'REFERENCES', targetId: 'sedm-etl-childcountetl', targetLabel: 'SedmEtlTemplate' },
			],
		},
		// the element's option set (DmeOptionSet) + a value (DmeOptionValue).
		{
			id: 'sedm-optionset-000218-student-disability',
			label: 'SedmOptionSet',
			properties: { name: 'Primary Disability Type option set', naturalKey: '000218.student.disability', description: 'os', owningElementName: 'Primary Disability Type', valueCount: 1 },
			edges: [],
		},
		{
			id: 'sedm-optval-000218-student-disability-aut',
			label: 'SedmOptionValue',
			properties: { name: 'Autism', naturalKey: '000218.student.disability.AUT', code: 'AUT', description: 'Autism', optionSetName: 'Primary Disability Type option set' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'sedm-optionset-000218-student-disability', fromLabel: 'SedmOptionSet' },
		},
		// a DECLARED option set with ZERO referencing elements -> must get a root->orphan HAS_OPTION_SET.
		{
			id: 'sedm-optionset-declared-accommodationcategories',
			label: 'SedmOptionSet',
			properties: { name: 'accommodationCategories', naturalKey: 'declared.accommodationCategories', description: 'declared', valueCount: 1 },
			edges: [],
		},
		{
			id: 'sedm-optval-declared-accommodationcategories-setting',
			label: 'SedmOptionValue',
			properties: { name: 'Setting', naturalKey: 'declared.accommodationCategories.setting', code: '', description: 'Setting', optionSetName: 'accommodationCategories' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'sedm-optionset-declared-accommodationcategories', fromLabel: 'SedmOptionSet' },
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('three DmeClass total (Time, DateTime ontology classes + Evaluation compliance category)', byRole('DmeClass').length === 3);
check('one DmeProperty (element)', byRole('DmeProperty').length === 1);
check('two DmeOptionSet (element-owned + declared orphan)', byRole('DmeOptionSet').length === 2);
check('two DmeOptionValue', byRole('DmeOptionValue').length === 2);
check('two DmeSupport (indicator + etl)', byRole('DmeSupport').length === 2);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === SEDM', g.nodes.every((n) => n.properties._source === 'SEDM'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries sedmStableId === stableId', g.nodes.every((n) => n.properties.sedmStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

// the annotated element carries canonical cedsId + crossRefs (bridge stash).
const annotated = g.nodes.find((n) => n.stableId === 'sedm:element/000218.student.disability');
check('annotated element cedsId === P000218', annotated && annotated.properties.cedsId === 'P000218');
check('annotated element cedsId is canonical', annotated && normalize.isCanonicalCrossRefCedsId(annotated.properties.cedsId));
check('annotated element crossRefs JSON carries the ceds ref', annotated && JSON.parse(annotated.properties.crossRefs)[0].id === 'P000218');
check('annotated element crossRefs retains raw form', annotated && JSON.parse(annotated.properties.crossRefs)[0].raw === '000218');
check('DmeProperty searchText carries element name', annotated && annotated.properties.searchText.includes('Primary Disability Type'));

// edges: only canonical/REFERENCES types, all structural, all resolved (no throw means no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical/REFERENCES edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === SEDM (standard-pure, no cross-standard)', g.edges.every((e) => e.fromRef.source === 'SEDM' && e.toRef.source === 'SEDM'));
check('HAS_CLASS root->ontology class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'sedm:root' && e.toRef.id === 'sedm:class/Time'));
check('HAS_CLASS root->compliance category present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'sedm:root' && e.toRef.id === 'sedm:class/compliance.2'));
check('HAS_SUPPORT root->indicator present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'sedm:root' && e.toRef.id === 'sedm:support/indicator.1'));
check('HAS_SUPPORT root->etl present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'sedm:root' && e.toRef.id === 'sedm:support/etl.childcountetl'));
// element (DmeProperty) OWNS its option set via HAS_OPTION_SET.
check('HAS_OPTION_SET element->optionSet present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'sedm:element/000218.student.disability' && e.toRef.id === 'sedm:optionSet/000218.student.disability'));
check('NO element->optionSet REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'sedm:element/000218.student.disability' && e.toRef.id === 'sedm:optionSet/000218.student.disability'));
check('element->etl REFERENCES present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'sedm:element/000218.student.disability' && e.toRef.id === 'sedm:support/etl.childcountetl'));
check('subtype->parent class REFERENCES present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'sedm:class/Time.DateTime' && e.toRef.id === 'sedm:class/Time'));
check('indicator->compliance REFERENCES present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'sedm:support/indicator.1' && e.toRef.id === 'sedm:class/compliance.2'));
check('HAS_VALUE optionSet->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'sedm:optionSet/000218.student.disability' && e.toRef.id === 'sedm:value/000218.student.disability.AUT'));

check('stats.crossRefsAnnotated === 1', g.stats.crossRefsAnnotated === 1);
check('stats.optionValuesEmitted === 2', g.stats.optionValuesEmitted === 2);
check('stats.elementOptionSetEdges === 1', g.stats.elementOptionSetEdges === 1);
check('stats.orphanAnchoredOptionSets === 1 (the declared set)', g.stats.orphanAnchoredOptionSets === 1);
check('orphan option set anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'sedm:root' && e.toRef.id === 'sedm:optionSet/declared.accommodationCategories'));
check('element-constrained option set NOT anchored from root', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'sedm:root' && e.toRef.id === 'sedm:optionSet/000218.student.disability'));
check('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((os) => g.edges.filter((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId).length >= 1));
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// a present-but-unnormalizable CEDS annotation MUST throw (R3 — never silently dropped).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.find((n) => n.id === 'sedm-element-000218-student-disability').properties.cedsGlobalId = 'not-a-number';
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unnormalizable cedsGlobalId throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual SEDM assets.
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
	check('real: has DmeOptionSet nodes', (roleCount.DmeOptionSet || 0) > 0);
	check('real: has DmeOptionValue nodes', (roleCount.DmeOptionValue || 0) > 0);
	check('real: has DmeSupport nodes', (roleCount.DmeSupport || 0) > 0);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === SEDM', nodes.every((n) => n.properties._source === 'SEDM'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries sedmStableId', nodes.every((n) => n.properties.sedmStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: every annotated element cedsId canonical', nodes.filter((n) => n.properties.cedsId).every((n) => normalize.isCanonicalCrossRefCedsId(n.properties.cedsId)));
	check('real: only canonical/REFERENCES edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source SEDM)', edges.every((e) => e.fromRef.source === 'SEDM' && e.toRef.source === 'SEDM'));
	check('real: every DmeOptionSet has >=1 incoming HAS_OPTION_SET', nodes.filter((n) => n.role === 'DmeOptionSet').every((os) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
	check('real: every HAS_OPTION_SET originates from DmeProperty or root', (() => {
		const byId = {};
		nodes.forEach((n) => { byId[n.stableId] = n.role; });
		return edges.filter((e) => e.type === 'HAS_OPTION_SET').every((e) => byId[e.fromRef.id] === 'DmeProperty' || byId[e.fromRef.id] === 'DmeStandardRoot');
	})());
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== SEDM REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		crossRefsAnnotated: result.stats.crossRefsAnnotated,
		optionValuesEmitted: result.stats.optionValuesEmitted,
		elementOptionSetEdges: result.stats.elementOptionSetEdges,
		orphanAnchoredOptionSets: result.stats.orphanAnchoredOptionSets,
		referenceEdges: result.stats.referenceEdges,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
