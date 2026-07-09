#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — Gate-A for the PESC forge (XSD family). ALL PURE: no Voyage embedding call,
// no Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL .xsd asset) and asserts that, whatever the native XSD input form,
// the emitted node's stableId conforms to a clean canonical form BEFORE emission, searchText is
// non-empty, edges are canonical + fully resolved, and the shaping is deterministic. Mirrors
// forge-sif/test/test-r3-canonical.js.
//
// Run: node cli/lib.d/forge-pesc/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgePesc')({ embedder: null });

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
// 1. normalize unit asserts — canonical forms from varied native inputs
// =====================================================================

check('buildStableId root -> pesc:root', normalize.buildStableId({ kind: 'root' }).stableId === 'pesc:root');
check(
	'buildStableId complexType -> pesc:class/<source>/<name>',
	normalize.buildStableId({ kind: 'complexType', key: 'CoreMain/PersonType' }).stableId ===
		'pesc:class/CoreMain/PersonType',
);
check(
	'buildStableId field keeps owner.kind.name',
	normalize.buildStableId({ kind: 'field', key: 'CoreMain/PersonType.element.FirstName' }).stableId ===
		'pesc:field/CoreMain/PersonType.element.FirstName',
);
check(
	'buildStableId optionValue keeps set.value',
	normalize.buildStableId({ kind: 'optionValue', key: 'CoreMain/CountryCode.US' }).stableId ===
		'pesc:optionValue/CoreMain/CountryCode.US',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'complexType', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts pesc:root', normalize.isCleanStableId('pesc:root'));
check('isCleanStableId accepts pesc:field/...', normalize.isCleanStableId('pesc:field/A/B.element.C'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-pesc', !normalize.isCleanStableId('sif:object/x'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' pesc:root '));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the XSD role mapping + edge convention
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: '1.0',
		sourceFormat: 'xsd',
		complexTypeCount: 2,
		simpleTypeCount: 2,
		groupCount: 1,
		sourceFileCount: 1,
		sourceFiles: ['CoreMain_v1.19.1.xsd'],
	},
	nodes: [
		{ id: 'pesc-root', label: 'PescRoot', properties: { name: 'PESC' }, edges: [] },

		// a base complexType
		{
			id: 'pesccomplex-CoreMain-BaseType',
			label: 'PescComplexType',
			properties: { name: 'BaseType', sourceFile: 'CoreMain', fieldCount: 0, baseType: '', derivation: '' },
			edges: [],
		},
		// a derived complexType: EXTENDS BaseType -> SUBCLASS_OF; USES_SUPPORT group -> HAS_SUPPORT
		{
			id: 'pesccomplex-CoreMain-PersonType',
			label: 'PescComplexType',
			properties: { name: 'PersonType', sourceFile: 'CoreMain', fieldCount: 2, baseType: 'core:BaseType', derivation: 'extension' },
			edges: [
				{ type: 'EXTENDS', targetId: 'pesccomplex-CoreMain-BaseType', targetLabel: 'PescComplexType', targetKind: 'complexType' },
				{ type: 'USES_SUPPORT', targetId: 'pescsupport-group-CoreMain-NameGroup', targetLabel: 'PescSupport', targetKind: 'support' },
			],
		},
		// a field typed by an OPTION SET -> HAS_OPTION_SET (property owns its option set)
		{
			id: 'pescfield-CoreMain-PersonType-element-Country',
			label: 'PescField',
			properties: { name: 'Country', sourceFile: 'CoreMain', owningTypeName: 'PersonType', xsdKind: 'element', typeName: 'core:CountryCode', minOccurs: '1', maxOccurs: '1' },
			edges: [
				{ type: 'TYPED_BY', targetId: 'pescoptset-CoreMain-CountryCode', targetLabel: 'PescOptionSet', targetKind: 'optionSet' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'pesccomplex-CoreMain-PersonType', fromLabel: 'PescComplexType' },
		},
		// a field typed by a complexType -> REFERENCES
		{
			id: 'pescfield-CoreMain-PersonType-element-Name',
			label: 'PescField',
			properties: { name: 'Name', sourceFile: 'CoreMain', owningTypeName: 'PersonType', xsdKind: 'element', typeName: 'core:BaseType', minOccurs: '0', maxOccurs: '1' },
			edges: [
				{ type: 'TYPED_BY', targetId: 'pesccomplex-CoreMain-BaseType', targetLabel: 'PescComplexType', targetKind: 'complexType' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'pesccomplex-CoreMain-PersonType', fromLabel: 'PescComplexType' },
		},
		// an OPTION SET + two values
		{
			id: 'pescoptset-CoreMain-CountryCode',
			label: 'PescOptionSet',
			properties: { name: 'CountryCode', sourceFile: 'CoreMain', restrictionBase: 'xs:string', valueCount: 2 },
			edges: [],
		},
		{
			id: 'pescoptval-CoreMain-CountryCode-US',
			label: 'PescOptionValue',
			properties: { name: 'US', sourceFile: 'CoreMain', optionSetName: 'CountryCode' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'pescoptset-CoreMain-CountryCode', fromLabel: 'PescOptionSet' },
		},
		{
			id: 'pescoptval-CoreMain-CountryCode-CA',
			label: 'PescOptionValue',
			properties: { name: 'CA', sourceFile: 'CoreMain', optionSetName: 'CountryCode' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'pescoptset-CoreMain-CountryCode', fromLabel: 'PescOptionSet' },
		},
		// a support group (DmeSupport)
		{
			id: 'pescsupport-group-CoreMain-NameGroup',
			label: 'PescSupport',
			properties: { name: 'NameGroup', sourceFile: 'CoreMain', supportKind: 'group', fieldCount: 0 },
			edges: [],
		},
		// a non-enum simpleType (DmeSupport)
		{
			id: 'pescsupport-simple-CoreMain-TokenType',
			label: 'PescSupport',
			properties: { name: 'TokenType', sourceFile: 'CoreMain', supportKind: 'simpleType', restrictionBase: 'xs:token' },
			edges: [],
		},
		// an ORPHAN option set (no field types against it) -> anchored from root
		{
			id: 'pescoptset-CoreMain-OrphanCode',
			label: 'PescOptionSet',
			properties: { name: 'OrphanCode', sourceFile: 'CoreMain', restrictionBase: 'xs:string', valueCount: 0 },
			edges: [],
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('two DmeClass (complexTypes)', byRole('DmeClass').length === 2);
check('two DmeProperty (fields)', byRole('DmeProperty').length === 2);
check('two DmeOptionSet (CountryCode + Orphan)', byRole('DmeOptionSet').length === 2);
check('two DmeOptionValue (US/CA)', byRole('DmeOptionValue').length === 2);
check('two DmeSupport (group + simpleType)', byRole('DmeSupport').length === 2);

check('every node clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === PESC', g.nodes.every((n) => n.properties._source === 'PESC'));
check('every node non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries pescStableId === stableId', g.nodes.every((n) => n.properties.pescStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

// edges
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('HAS_CLASS root->complexType present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'pesc:root' && e.toRef.id === 'pesc:class/CoreMain/PersonType'));
check('HAS_PROPERTY type->field present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'pesc:class/CoreMain/PersonType'));
check('HAS_OPTION_SET field->optionSet present (from DmeProperty)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id.startsWith('pesc:field/') && e.toRef.id === 'pesc:optionSet/CoreMain/CountryCode'));
check('HAS_VALUE optionSet->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'pesc:optionSet/CoreMain/CountryCode'));
check('SUBCLASS_OF derived->base present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'pesc:class/CoreMain/PersonType' && e.toRef.id === 'pesc:class/CoreMain/BaseType'));
check('HAS_SUPPORT complexType->group present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'pesc:class/CoreMain/PersonType' && e.toRef.id === 'pesc:support/CoreMain/NameGroup'));
check('HAS_SUPPORT root->simpleType present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'pesc:root' && e.toRef.id === 'pesc:support/CoreMain/TokenType'));
check('REFERENCES field->complexType present', g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'pesc:class/CoreMain/BaseType'));
check('orphan option set anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'pesc:root' && e.toRef.id === 'pesc:optionSet/CoreMain/OrphanCode'));

// every DmeOptionSet has >=1 incoming HAS_OPTION_SET (reachable)
const optSetIds = byRole('DmeOptionSet').map((n) => n.stableId);
const hasOptSetTargets = new Set(g.edges.filter((e) => e.type === 'HAS_OPTION_SET').map((e) => e.toRef.id));
check('every DmeOptionSet reachable via HAS_OPTION_SET', optSetIds.every((id) => hasOptSetTargets.has(id)));

check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.subclassEdges === 1', g.stats.subclassEdges === 1);
check('stats.supportUsageEdges === 1', g.stats.supportUsageEdges === 1);
check('stats.referencesEdges === 1', g.stats.referencesEdges === 1);
check('stats.orphanAnchoredOptionSets === 1', g.stats.orphanAnchoredOptionSets === 1);
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// an unknown native label MUST throw (never silently dropped)
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.push({ id: 'bogus', label: 'PescBogus', properties: { name: 'x', sourceFile: 'CoreMain' }, edges: [] });
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unknown native label throws', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual PESC XSD asset.
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
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === PESC', nodes.every((n) => n.properties._source === 'PESC'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries pescStableId', nodes.every((n) => n.properties.pescStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: only canonical edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: every HAS_OPTION_SET originates from DmeProperty or DmeStandardRoot (orphan)', (() => {
		const roleByStableId = {};
		nodes.forEach((n) => { roleByStableId[n.stableId] = n.role; });
		return edges.filter((e) => e.type === 'HAS_OPTION_SET').every((e) => {
			const r = roleByStableId[e.fromRef.id];
			return r === 'DmeProperty' || r === 'DmeStandardRoot';
		});
	})());
	check('real: every DmeOptionSet reachable via HAS_OPTION_SET', (() => {
		const targets = new Set(edges.filter((e) => e.type === 'HAS_OPTION_SET').map((e) => e.toRef.id));
		return nodes.filter((n) => n.role === 'DmeOptionSet').every((n) => targets.has(n.stableId));
	})());
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== PESC REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		fieldCount: result.stats.fieldCount,
		optionValuesEmitted: result.stats.optionValuesEmitted,
		propertyOptionSetEdges: result.stats.propertyOptionSetEdges,
		subclassEdges: result.stats.subclassEdges,
		supportUsageEdges: result.stats.supportUsageEdges,
		referencesEdges: result.stats.referencesEdges,
		orphanAnchoredOptionSets: result.stats.orphanAnchoredOptionSets,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
