#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — Gate-A for the MedBiquitous forge (XSD family). ALL PURE: no Voyage embedding
// call, no Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL .xsd/.wsdl asset) and asserts that, whatever the native input form,
// the emitted node's stableId conforms to a clean canonical form BEFORE emission, searchText is
// non-empty, edges are canonical + fully resolved, and the shaping is deterministic. Mirrors
// forge-pesc/test/test-r3-canonical.js.
//
// Run: node cli/lib.d/forge-medbiquitous/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeMedbiquitous')({ embedder: null });

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
// 1. normalize unit asserts
// =====================================================================

check('buildStableId root -> medbiq:root', normalize.buildStableId({ kind: 'root' }).stableId === 'medbiq:root');
check(
	'buildStableId complexType -> medbiq:class/<source>/<name>',
	normalize.buildStableId({ kind: 'complexType', key: 'shared/common/PersonType' }).stableId ===
		'medbiq:class/shared/common/PersonType',
);
check(
	'buildStableId field keeps owner.kind.name',
	normalize.buildStableId({ kind: 'field', key: 'shared/common/PersonType.element.FirstName' }).stableId ===
		'medbiq:field/shared/common/PersonType.element.FirstName',
);
check(
	'buildStableId optionValue keeps set.value',
	normalize.buildStableId({ kind: 'optionValue', key: 'shared/common/CountryCode.US' }).stableId ===
		'medbiq:optionValue/shared/common/CountryCode.US',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'complexType', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts medbiq:root', normalize.isCleanStableId('medbiq:root'));
check('isCleanStableId accepts medbiq:field/...', normalize.isCleanStableId('medbiq:field/A/B.element.C'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-medbiq', !normalize.isCleanStableId('pesc:class/x'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' medbiq:root '));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — XSD role mapping + edge convention
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: '1.0',
		sourceFormat: 'medbiquitous-xsd-wsdl',
		complexTypeCount: 2,
		simpleTypeCount: 2,
		groupCount: 1,
		xsdFileCount: 1,
		wsdlFileCount: 1,
		sourceFiles: ['shared/common.xsd'],
	},
	nodes: [
		{ id: 'medbiq-root', label: 'MedbiqRoot', properties: { name: 'MedBiquitous' }, edges: [] },

		// base complexType
		{
			id: 'medbiqcomplex-shared/common-BaseType',
			label: 'MedbiqComplexType',
			properties: { name: 'BaseType', sourceFile: 'shared/common', baseType: '', derivation: '' },
			edges: [],
		},
		// derived complexType: EXTENDS BaseType -> SUBCLASS_OF; USES_SUPPORT group -> HAS_SUPPORT
		{
			id: 'medbiqcomplex-shared/common-PersonType',
			label: 'MedbiqComplexType',
			properties: { name: 'PersonType', sourceFile: 'shared/common', baseType: 'mbq:BaseType', derivation: 'extension' },
			edges: [
				{ type: 'EXTENDS', targetId: 'medbiqcomplex-shared/common-BaseType', targetLabel: 'MedbiqComplexType', targetKind: 'complexType' },
				{ type: 'USES_SUPPORT', targetId: 'medbiqsupport-group-shared/common-NameGroup', targetLabel: 'MedbiqSupport', targetKind: 'support' },
			],
		},
		// field typed by an OPTION SET -> HAS_OPTION_SET
		{
			id: 'medbiqfield-shared/common-PersonType-element-Country',
			label: 'MedbiqField',
			properties: { name: 'Country', sourceFile: 'shared/common', owningTypeName: 'PersonType', xsdKind: 'element', typeName: 'mbq:CountryCode', minOccurs: '1', maxOccurs: '1' },
			edges: [
				{ type: 'TYPED_BY', targetId: 'medbiqoptset-shared/common-CountryCode', targetLabel: 'MedbiqOptionSet', targetKind: 'optionSet' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'medbiqcomplex-shared/common-PersonType', fromLabel: 'MedbiqComplexType' },
		},
		// field typed by a complexType -> REFERENCES
		{
			id: 'medbiqfield-shared/common-PersonType-element-Name',
			label: 'MedbiqField',
			properties: { name: 'Name', sourceFile: 'shared/common', owningTypeName: 'PersonType', xsdKind: 'element', typeName: 'mbq:BaseType', minOccurs: '0', maxOccurs: '1' },
			edges: [
				{ type: 'TYPED_BY', targetId: 'medbiqcomplex-shared/common-BaseType', targetLabel: 'MedbiqComplexType', targetKind: 'complexType' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'medbiqcomplex-shared/common-PersonType', fromLabel: 'MedbiqComplexType' },
		},
		// OPTION SET + two values
		{ id: 'medbiqoptset-shared/common-CountryCode', label: 'MedbiqOptionSet', properties: { name: 'CountryCode', sourceFile: 'shared/common', restrictionBase: 'xsd:string' }, edges: [] },
		{ id: 'medbiqoptval-shared/common-CountryCode-US', label: 'MedbiqOptionValue', properties: { name: 'US', sourceFile: 'shared/common', optionSetName: 'CountryCode' }, edges: [], _parentEdge: { type: 'HAS_VALUE', fromId: 'medbiqoptset-shared/common-CountryCode', fromLabel: 'MedbiqOptionSet' } },
		{ id: 'medbiqoptval-shared/common-CountryCode-CA', label: 'MedbiqOptionValue', properties: { name: 'CA', sourceFile: 'shared/common', optionSetName: 'CountryCode' }, edges: [], _parentEdge: { type: 'HAS_VALUE', fromId: 'medbiqoptset-shared/common-CountryCode', fromLabel: 'MedbiqOptionSet' } },
		// support group (DmeSupport)
		{ id: 'medbiqsupport-group-shared/common-NameGroup', label: 'MedbiqSupport', properties: { name: 'NameGroup', sourceFile: 'shared/common', supportKind: 'group' }, edges: [] },
		// non-enum simpleType (DmeSupport)
		{ id: 'medbiqsupport-simple-shared/common-TokenType', label: 'MedbiqSupport', properties: { name: 'TokenType', sourceFile: 'shared/common', supportKind: 'simpleType', restrictionBase: 'xsd:token' }, edges: [] },
		// a WSDL operation modeled as DmeSupport
		{ id: 'medbiqsupport-wsdlOperation-svc-GetMember', label: 'MedbiqSupport', properties: { name: 'GetMember', sourceFile: 'svc', supportKind: 'wsdlOperation' }, edges: [] },
		// ORPHAN option set -> anchored from root
		{ id: 'medbiqoptset-shared/common-OrphanCode', label: 'MedbiqOptionSet', properties: { name: 'OrphanCode', sourceFile: 'shared/common', restrictionBase: 'xsd:string' }, edges: [] },
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
check('three DmeSupport (group + simpleType + wsdlOperation)', byRole('DmeSupport').length === 3);

check('every node clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === MedBiquitous', g.nodes.every((n) => n.properties._source === 'MedBiquitous'));
check('every node non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries medbiquitousStableId === stableId', g.nodes.every((n) => n.properties.medbiquitousStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('HAS_CLASS root->complexType present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'medbiq:root' && e.toRef.id === 'medbiq:class/shared/common/PersonType'));
check('HAS_PROPERTY type->field present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'medbiq:class/shared/common/PersonType'));
check('HAS_OPTION_SET field->optionSet present (from DmeProperty)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id.startsWith('medbiq:field/') && e.toRef.id === 'medbiq:optionSet/shared/common/CountryCode'));
check('HAS_VALUE optionSet->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'medbiq:optionSet/shared/common/CountryCode'));
check('SUBCLASS_OF derived->base present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'medbiq:class/shared/common/PersonType' && e.toRef.id === 'medbiq:class/shared/common/BaseType'));
check('HAS_SUPPORT complexType->group present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'medbiq:class/shared/common/PersonType' && e.toRef.id === 'medbiq:support/shared/common/NameGroup'));
check('HAS_SUPPORT root->simpleType present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'medbiq:root' && e.toRef.id === 'medbiq:support/shared/common/TokenType'));
check('HAS_SUPPORT root->wsdlOperation present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'medbiq:root' && e.toRef.id === 'medbiq:support/svc/GetMember'));
check('REFERENCES field->complexType present', g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'medbiq:class/shared/common/BaseType'));
check('orphan option set anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'medbiq:root' && e.toRef.id === 'medbiq:optionSet/shared/common/OrphanCode'));

const optSetIds = byRole('DmeOptionSet').map((n) => n.stableId);
const hasOptSetTargets = new Set(g.edges.filter((e) => e.type === 'HAS_OPTION_SET').map((e) => e.toRef.id));
check('every DmeOptionSet reachable via HAS_OPTION_SET', optSetIds.every((id) => hasOptSetTargets.has(id)));

check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.subclassEdges === 1', g.stats.subclassEdges === 1);
check('stats.supportUsageEdges === 1', g.stats.supportUsageEdges === 1);
check('stats.referencesEdges === 1', g.stats.referencesEdges === 1);
check('stats.orphanAnchoredOptionSets === 1', g.stats.orphanAnchoredOptionSets === 1);
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph deterministic (modulo ingestedAt)', strip(g) === strip(g2));

const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.push({ id: 'bogus', label: 'MedbiqBogus', properties: { name: 'x', sourceFile: 'shared/common' }, edges: [] });
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unknown native label throws', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true})
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
	check('real: has DmeSupport nodes (incl WSDL)', (roleCount.DmeSupport || 0) > 0);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === MedBiquitous', nodes.every((n) => n.properties._source === 'MedBiquitous'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries medbiquitousStableId', nodes.every((n) => n.properties.medbiquitousStableId === n.stableId));
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

	console.log('\n=== MEDBIQUITOUS REAL-DATA DRY COUNT (no embedding) ===');
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
	console.log('wsdlSupportNodeCount (metadata):', result.metadata.wsdlSupportNodeCount);
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
