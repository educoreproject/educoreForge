#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the EdFi forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL CSV assets) and asserts that, whatever the native EdFi input
// form, the emitted node's stableId + canonical CEDS cross-ref conform to clean canonical forms
// BEFORE emission, searchText is non-empty, edges are canonical + fully resolved, the block is
// standard-pure EdFi (_source='EdFi', no cross-standard edges), and the shaping is deterministic.
//
// Run: node cli/lib.d/forge-edfi/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeEdfi')({ embedder: null });

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

check('buildStableId root -> edfi:root', normalize.buildStableId({ kind: 'root' }).stableId === 'edfi:root');
check(
	'buildStableId entity -> edfi:entity/<name>',
	normalize.buildStableId({ kind: 'entity', key: 'PerformanceLevel' }).stableId === 'edfi:entity/PerformanceLevel',
);
check(
	'buildStableId field keeps entity.element key',
	normalize.buildStableId({ kind: 'field', key: 'PerformanceLevel.AssessmentReportingMethodDescriptor' }).stableId ===
		'edfi:field/PerformanceLevel.AssessmentReportingMethodDescriptor',
);
check(
	'buildStableId descriptorValue keeps descriptor.code key',
	normalize.buildStableId({ kind: 'descriptorValue', key: 'AbsenceEventCategoryDescriptor.Bereavement' }).stableId ===
		'edfi:value/AbsenceEventCategoryDescriptor.Bereavement',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'entity', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts edfi:root', normalize.isCleanStableId('edfi:root'));
check('isCleanStableId accepts edfi:field/<entity.element>', normalize.isCleanStableId('edfi:field/A.B'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-edfi', !normalize.isCleanStableId('ceds:C000113'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' edfi:root '));

// CEDS cross-ref canonicalization: bare number, zero-padded, sentinel, all handled correctly.
check("normalizeCedsCrossRef('369') -> P000369", normalize.normalizeCedsCrossRef({ rawValue: '369' }).cedsId === 'P000369');
check("normalizeCedsCrossRef('000369') -> P000369", normalize.normalizeCedsCrossRef({ rawValue: '000369' }).cedsId === 'P000369');
check("normalizeCedsCrossRef(369 number) -> P000369", normalize.normalizeCedsCrossRef({ rawValue: 369 }).cedsId === 'P000369');
check("normalizeCedsCrossRef('000000') -> absent (sentinel)", !!normalize.normalizeCedsCrossRef({ rawValue: '000000' }).absent);
check("normalizeCedsCrossRef('') -> absent", !!normalize.normalizeCedsCrossRef({ rawValue: '' }).absent);
check("normalizeCedsCrossRef('no-digits') -> error", !!normalize.normalizeCedsCrossRef({ rawValue: 'no-digits' }).error);
check('isCanonicalCrossRefCedsId(P000369)', normalize.isCanonicalCrossRefCedsId('P000369'));
check('isCanonicalCrossRefCedsId rejects 000369', !normalize.isCanonicalCrossRefCedsId('000369'));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: '1.0',
		sourceFormat: 'csv',
		entityCount: 1,
		fieldCount: 2,
		descriptorCount: 1,
		descriptorValueCount: 2,
	},
	nodes: [
		{ id: 'edfi-root', label: 'EdfiRoot', properties: { name: 'EdFi' }, edges: [] },
		{
			id: 'edfientity-PerformanceLevel',
			label: 'EdfiEntity',
			properties: { name: 'PerformanceLevel', tableName: 'PerformanceLevel', description: 'a level' },
			edges: [],
		},
		{
			id: 'edfifield-PerformanceLevel.AssessmentReportingMethodDescriptor',
			label: 'EdfiField',
			properties: {
				name: 'AssessmentReportingMethodDescriptor',
				entityName: 'PerformanceLevel',
				elementType: 'Descriptor',
				required: false,
				cedsGlobalIds: ['000369'],
				description: 'the reporting method',
			},
			edges: [
				{ type: 'CONSTRAINED_BY', targetId: 'edfidescriptor-AssessmentReportingMethodDescriptor', targetLabel: 'EdfiDescriptor' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'edfientity-PerformanceLevel', fromLabel: 'EdfiEntity' },
		},
		{
			id: 'edfifield-PerformanceLevel.PlainField',
			label: 'EdfiField',
			properties: { name: 'PlainField', entityName: 'PerformanceLevel', elementType: 'string', required: false, cedsGlobalIds: [], description: '' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'edfientity-PerformanceLevel', fromLabel: 'EdfiEntity' },
		},
		{
			id: 'edfidescriptor-AssessmentReportingMethodDescriptor',
			label: 'EdfiDescriptor',
			properties: { name: 'AssessmentReportingMethodDescriptor', namespace: 'uri://x', version: 'DS5.2', valueCount: 2, cedsGlobalId: '000369' },
			edges: [],
		},
		{
			id: 'edfidescval-AssessmentReportingMethodDescriptor.Letter',
			label: 'EdfiDescriptorValue',
			properties: { name: 'Letter', descriptorName: 'AssessmentReportingMethodDescriptor', cedsOptionCode: 'LetterGrade', description: 'letter' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'edfidescriptor-AssessmentReportingMethodDescriptor', fromLabel: 'EdfiDescriptor' },
		},
		{
			id: 'edfidescval-AssessmentReportingMethodDescriptor.Numeric',
			label: 'EdfiDescriptorValue',
			properties: { name: 'Numeric', descriptorName: 'AssessmentReportingMethodDescriptor', cedsOptionCode: '', description: 'numeric' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'edfidescriptor-AssessmentReportingMethodDescriptor', fromLabel: 'EdfiDescriptor' },
		},
		// an ORPHAN descriptor: no field constrains to it -> must get a root->orphan HAS_OPTION_SET anchor.
		{
			id: 'edfidescriptor-OrphanDescriptor',
			label: 'EdfiDescriptor',
			properties: { name: 'OrphanDescriptor', namespace: 'uri://y', version: 'DS5.2', valueCount: 1, cedsGlobalId: '' },
			edges: [],
		},
		{
			id: 'edfidescval-OrphanDescriptor.Only',
			label: 'EdfiDescriptorValue',
			properties: { name: 'Only', descriptorName: 'OrphanDescriptor', cedsOptionCode: '', description: 'only' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'edfidescriptor-OrphanDescriptor', fromLabel: 'EdfiDescriptor' },
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('one DmeClass (entity)', byRole('DmeClass').length === 1);
check('two DmeProperty (fields)', byRole('DmeProperty').length === 2);
check('two DmeOptionSet (descriptors: one field-owned, one orphan)', byRole('DmeOptionSet').length === 2);
check('three DmeOptionValue (descriptor values)', byRole('DmeOptionValue').length === 3);
check('zero DmeSupport (EdFi has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === EdFi', g.nodes.every((n) => n.properties._source === 'EdFi'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries edfiStableId === stableId', g.nodes.every((n) => n.properties.edfiStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

// the annotated field carries canonical cedsId + crossRefs (bridge stash); the plain one does not.
const annotated = g.nodes.find((n) => n.stableId === 'edfi:field/PerformanceLevel.AssessmentReportingMethodDescriptor');
const plain = g.nodes.find((n) => n.stableId === 'edfi:field/PerformanceLevel.PlainField');
check('annotated field cedsId === P000369', annotated && annotated.properties.cedsId === 'P000369');
check('annotated field cedsId is canonical', annotated && normalize.isCanonicalCrossRefCedsId(annotated.properties.cedsId));
check('annotated field crossRefs JSON carries the ceds ref', annotated && JSON.parse(annotated.properties.crossRefs)[0].id === 'P000369');
check('annotated field crossRefs retains raw form', annotated && JSON.parse(annotated.properties.crossRefs)[0].raw === '000369');
check('plain field has no cedsId', plain && plain.properties.cedsId === undefined);
check('plain field crossRefs === []', plain && plain.properties.crossRefs === '[]');
check('DmeProperty searchText carries owning class name', annotated && annotated.properties.searchText.includes('PerformanceLevel'));

// descriptor value cross-ref (option code) stashed, raw, no P-form; empty one absent.
const valLetter = g.nodes.find((n) => n.stableId === 'edfi:value/AssessmentReportingMethodDescriptor.Letter');
const valNumeric = g.nodes.find((n) => n.stableId === 'edfi:value/AssessmentReportingMethodDescriptor.Numeric');
check('value cedsOptionCode stashed raw', valLetter && valLetter.properties.cedsOptionCode === 'LetterGrade');
check('empty value cedsOptionCode absent', valNumeric && valNumeric.properties.cedsOptionCode === undefined);

// edges: only canonical/REFERENCES types, all structural, all resolved (no throw means no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'REFERENCES']);
check('only canonical/REFERENCES edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === EdFi (standard-pure, no cross-standard)', g.edges.every((e) => e.fromRef.source === 'EdFi' && e.toRef.source === 'EdFi'));
check('HAS_CLASS root->entity present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'edfi:root' && e.toRef.id === 'edfi:entity/PerformanceLevel'));
check('HAS_PROPERTY entity->field present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'edfi:entity/PerformanceLevel' && e.toRef.id === 'edfi:field/PerformanceLevel.AssessmentReportingMethodDescriptor'));
// SIF-canonical: the field (DmeProperty) OWNS its descriptor (DmeOptionSet) via HAS_OPTION_SET.
check('HAS_OPTION_SET field->descriptor present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'edfi:field/PerformanceLevel.AssessmentReportingMethodDescriptor' && e.toRef.id === 'edfi:descriptor/AssessmentReportingMethodDescriptor'));
check('NO blanket root->descriptor HAS_OPTION_SET (descriptor is field-owned)', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'edfi:root' && e.toRef.id === 'edfi:descriptor/AssessmentReportingMethodDescriptor'));
check('NO field->descriptor REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'edfi:field/PerformanceLevel.AssessmentReportingMethodDescriptor'));
check('HAS_VALUE descriptor->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'edfi:descriptor/AssessmentReportingMethodDescriptor' && e.toRef.id === 'edfi:value/AssessmentReportingMethodDescriptor.Letter'));

check('stats.crossRefsAnnotated === 1', g.stats.crossRefsAnnotated === 1);
check('stats.descriptorCrossRefs === 1', g.stats.descriptorCrossRefs === 1);
check('stats.optionValuesEmitted === 3', g.stats.optionValuesEmitted === 3);
check('stats.fieldOptionSetEdges === 1', g.stats.fieldOptionSetEdges === 1);
check('stats.orphanAnchoredDescriptors === 1 (the orphan descriptor)', g.stats.orphanAnchoredDescriptors === 1);
check('orphan descriptor anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'edfi:root' && e.toRef.id === 'edfi:descriptor/OrphanDescriptor'));
check('field-constrained descriptor NOT anchored from root', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'edfi:root' && e.toRef.id === 'edfi:descriptor/AssessmentReportingMethodDescriptor'));
check('every DmeOptionSet has exactly one incoming HAS_OPTION_SET (owned, no double-ownership)', byRole('DmeOptionSet').every((os) => g.edges.filter((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId).length === 1));
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
badParsed.nodes.find((n) => n.id === 'edfifield-PerformanceLevel.AssessmentReportingMethodDescriptor').properties.cedsGlobalIds = ['not-a-number'];
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unnormalizable cedsGlobalId throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual EdFi CSV assets.
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
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === EdFi', nodes.every((n) => n.properties._source === 'EdFi'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries edfiStableId', nodes.every((n) => n.properties.edfiStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: every annotated field/descriptor cedsId canonical', nodes.filter((n) => n.properties.cedsId).every((n) => normalize.isCanonicalCrossRefCedsId(n.properties.cedsId)));
	check('real: only canonical/REFERENCES edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source EdFi)', edges.every((e) => e.fromRef.source === 'EdFi' && e.toRef.source === 'EdFi'));
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== EdFi REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		crossRefsAnnotated: result.stats.crossRefsAnnotated,
		descriptorCrossRefs: result.stats.descriptorCrossRefs,
		optionValuesEmitted: result.stats.optionValuesEmitted,
		fieldOptionSetEdges: result.stats.fieldOptionSetEdges,
		orphanAnchoredDescriptors: result.stats.orphanAnchoredDescriptors,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
