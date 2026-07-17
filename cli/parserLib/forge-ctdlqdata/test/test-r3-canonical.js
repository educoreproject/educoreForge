#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the CTDL-QData forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL CTDL-QData JSON-LD asset) and asserts that, whatever the native
// input form, the emitted node's stableId (the native CURIE) conforms to a clean canonical CURIE form
// BEFORE emission, searchText is non-empty, edges are canonical + fully resolved (no danglers), the
// block is standard-pure CTDLQData (_source='CTDLQData', no cross-standard edges), cross-standard terms
// (ceterms + ceasn/asn) emit ZERO nodes while native references to them survive as {system,...} crossRefs
// keyed by target standard, schema:* IS emitted as a native node (the crucial QData difference from
// forge-ctdlasn), and the shaping is deterministic.
//
// Real-data counts (baked from the 2026-07-15 dry run over the includemetaproperties=false qdata.json,
// with the orphan-property-anchor pass that gives a native property with no native owning class a
// HAS_PROPERTY edge from root — parallel to the orphan-option-set pass, for graph reachability):
//   215 nodes (1 root, 11 class, 82 property, 8 optionSet, 113 optionValue); 277 edges
//   (HAS_CLASS 11, HAS_PROPERTY 108, REFERENCES 37, HAS_OPTION_SET 8, HAS_VALUE 113; SUBCLASS_OF 0);
//   145 cross-standard crossRefs on 15 nodes = ctdl 139 + ctdlasn 6; 31 ceterms:* terms filtered
//   (not emitted); 0 ceterms/ceasn/asn nodes emitted; 10 schema:* native nodes; 0 danglers.
//
// Run: node cli/parserLib/forge-ctdlqdata/test/test-r3-canonical.js

const path = require('path');
const fs = require('fs');
const os = require('os');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const parseCtdlqdata = require('../lib/parser');
const bundle = require('../forgeCtdlqdata')({ embedder: null });

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

// reachableFromRoot — transitive BFS over the emitted edges from the DmeStandardRoot. Returns the set of
// stableIds reachable by following fromRef.id -> toRef.id. The zero-orphan invariant (FADED_FORGE ruling
// 2026-07-15): EVERY forged node must be in this set, so no native node is stranded — proven by the test,
// not merely happening to hold. REUSABLE: clone this helper + the zero-orphan assertions into sibling forge
// tests so every forge inherits the never-orphan guard.
const reachableFromRoot = (graph, rootStableId) => {
	const adjacency = {};
	graph.edges.forEach((e) => {
		(adjacency[e.fromRef.id] = adjacency[e.fromRef.id] || []).push(e.toRef.id);
	});
	const seen = new Set([rootStableId]);
	const queue = [rootStableId];
	while (queue.length) {
		const current = queue.shift();
		(adjacency[current] || []).forEach((next) => {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		});
	}
	return seen;
};

// =====================================================================
// 1. normalize unit asserts — clean CURIE stableId from varied native inputs (R3, data-independent)
// =====================================================================

check('buildStableId CURIE -> same CURIE', normalize.buildStableId({ id: 'qdata:Observation' }).stableId === 'qdata:Observation');
check('buildStableId trims', normalize.buildStableId({ id: '  metricCat:Enrollment  ' }).stableId === 'metricCat:Enrollment');
check('buildStableId empty -> error', !!normalize.buildStableId({ id: '   ' }).error);
check('buildStableId null -> error', !!normalize.buildStableId({ id: null }).error);

check('isCleanStableId accepts a qdata CURIE', normalize.isCleanStableId('qdata:Observation'));
check('isCleanStableId accepts a metricCat CURIE', normalize.isCleanStableId('metricCat:Enrollment'));
check('isCleanStableId accepts a schema CURIE (schema is native for QData)', normalize.isCleanStableId('schema:MonetaryAmount'));
check('isCleanStableId accepts http URI', normalize.isCleanStableId('https://credreg.com/qdata/terms/x'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects bare token (no colon)', !normalize.isCleanStableId('Observation'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' qdata:X '));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping, the
//    cross-standard filter-and-reference crossRef stash (ceterms->ctdl, ceasn/asn->ctdlasn), schema:*
//    native emission, the orphan-property root anchor, and determinism.
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: 'Release X',
		sourceFormat: 'json-ld',
		sourceFiles: ['qdata.json'],
		sourceUrl: 'https://credreg.com/x',
		classCount: 3,
		propertyCount: 3,
		conceptSchemeCount: 2,
		conceptCount: 2,
	},
	nodes: [
		{ id: 'ctdlqdata:root', label: 'CtdlqdataRoot', superLabel: 'CtdlqdataModel', properties: { name: 'CTDLQData' }, edges: [] },
		{
			id: 'qdata:DataProfile',
			label: 'CtdlqdataClass',
			superLabel: 'CtdlqdataModel',
			properties: { name: 'Data Profile', description: 'a data profile', uri: 'qdata:DataProfile', status: 'stable' },
			edges: [],
		},
		{
			// schema:* is NATIVE for QData — this class MUST be emitted as a native node (NOT filtered).
			id: 'schema:MonetaryAmount',
			label: 'CtdlqdataClass',
			superLabel: 'CtdlqdataModel',
			properties: { name: 'Monetary Amount', description: 'a monetary amount', uri: 'schema:MonetaryAmount', status: 'stable' },
			edges: [],
		},
		{
			// a native class subclassing a native class AND a filtered ceterms class (crossRef -> ctdl).
			id: 'qdata:AggregateDataProfile',
			label: 'CtdlqdataClass',
			superLabel: 'CtdlqdataModel',
			properties: {
				name: 'Aggregate Data Profile',
				description: 'an aggregate data profile',
				uri: 'qdata:AggregateDataProfile',
				status: 'unstable',
				_crossRefs: [{ system: 'ctdl', id: 'ceterms:Collection', raw: 'ceterms:Collection', locator: 'rdfs:subClassOf' }],
			},
			edges: [{ type: 'SUBCLASS_OF', targetId: 'qdata:DataProfile', targetLabel: 'CtdlqdataClass' }],
		},
		{
			// a shared property across two native domains, constrained by a scheme, plus a ceterms domain crossRef.
			id: 'qdata:metricType',
			label: 'CtdlqdataProperty',
			superLabel: 'CtdlqdataModel',
			properties: {
				name: 'Metric Type',
				description: 'metric type',
				uri: 'qdata:metricType',
				status: 'stable',
				usageNote: 'use me',
				domainCount: 2,
				_crossRefs: [{ system: 'ctdl', id: 'ceterms:Credential', raw: 'ceterms:Credential', locator: 'schema:domainIncludes' }],
			},
			edges: [{ type: 'CONSTRAINED_BY', targetId: 'metricCat:MetricScheme', targetLabel: 'CtdlqdataConceptScheme' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'qdata:AggregateDataProfile', fromLabel: 'CtdlqdataClass' },
			_owningClassIds: ['qdata:AggregateDataProfile', 'qdata:DataProfile'],
		},
		{
			// a property referencing a native schema:* class (REFERENCES) plus TWO cross-standard crossRefs:
			// a ceterms range (-> ctdl) and a ceasn domain (-> ctdlasn). Both must survive.
			id: 'qdata:relatedTo',
			label: 'CtdlqdataProperty',
			superLabel: 'CtdlqdataModel',
			properties: {
				name: 'Related To',
				description: 'a reference',
				uri: 'qdata:relatedTo',
				status: 'stable',
				domainCount: 1,
				_crossRefs: [
					{ system: 'ctdl', id: 'ceterms:Occupation', raw: 'ceterms:Occupation', locator: 'schema:rangeIncludes' },
					{ system: 'ctdlasn', id: 'ceasn:CriterionLevel', raw: 'ceasn:CriterionLevel', locator: 'schema:domainIncludes' },
				],
			},
			edges: [{ type: 'REFERENCES', targetId: 'schema:MonetaryAmount', targetLabel: 'CtdlqdataClass' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'qdata:AggregateDataProfile', fromLabel: 'CtdlqdataClass' },
			_owningClassIds: ['qdata:AggregateDataProfile'],
		},
		{
			// an ORPHAN native property: NO native owning class (no _parentEdge), only a ceterms domain crossRef.
			// It MUST be root-anchored with a HAS_PROPERTY edge from root (parallel to the orphan option set),
			// so it is reachable via graph traversal and its cross-standard domain is never silently lost.
			id: 'qdata:dataCollectionMethodType',
			label: 'CtdlqdataProperty',
			superLabel: 'CtdlqdataModel',
			properties: {
				name: 'Data Collection Method Type',
				description: 'collection method',
				uri: 'qdata:dataCollectionMethodType',
				status: 'stable',
				domainCount: 0,
				_crossRefs: [{ system: 'ctdl', id: 'ceterms:ProcessProfile', raw: 'ceterms:ProcessProfile', locator: 'schema:domainIncludes' }],
			},
			edges: [],
		},
		{
			id: 'metricCat:MetricScheme',
			label: 'CtdlqdataConceptScheme',
			superLabel: 'CtdlqdataModel',
			properties: { name: 'Metric Scheme', description: 'metric vocab', uri: 'metricCat:MetricScheme' },
			edges: [],
		},
		// an ORPHAN concept scheme: no property constrains to it -> root->orphan HAS_OPTION_SET.
		{
			id: 'demoCat:OrphanScheme',
			label: 'CtdlqdataConceptScheme',
			superLabel: 'CtdlqdataModel',
			properties: { name: 'Orphan Scheme', description: 'orphan vocab', uri: 'demoCat:OrphanScheme' },
			edges: [],
		},
		{
			id: 'metricCat:Enrollment',
			label: 'CtdlqdataConcept',
			superLabel: 'CtdlqdataModel',
			properties: { name: 'Enrollment', description: 'enrollment metric', uri: 'metricCat:Enrollment', status: 'stable' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'metricCat:MetricScheme', fromLabel: 'CtdlqdataConceptScheme' },
		},
		{
			// a concept in a native scheme that ALSO carries a ceterms inScheme crossRef.
			id: 'demoCat:Gender',
			label: 'CtdlqdataConcept',
			superLabel: 'CtdlqdataModel',
			properties: {
				name: 'Gender',
				description: 'a demographic category',
				uri: 'demoCat:Gender',
				status: 'unstable',
				_crossRefs: [{ system: 'ctdl', id: 'ceterms:ScopeOfData', raw: 'ceterms:ScopeOfData', locator: 'skos:inScheme' }],
			},
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'demoCat:OrphanScheme', fromLabel: 'CtdlqdataConceptScheme' },
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('three DmeClass (incl. native schema:MonetaryAmount)', byRole('DmeClass').length === 3);
check('three DmeProperty', byRole('DmeProperty').length === 3);
check('two DmeOptionSet (concept schemes)', byRole('DmeOptionSet').length === 2);
check('two DmeOptionValue (concepts)', byRole('DmeOptionValue').length === 2);
check('zero DmeSupport (CTDL-QData has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === CTDLQData', g.nodes.every((n) => n.properties._source === 'CTDLQData'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id deterministic from stableId', g.nodes.every((n) => n.properties._id === `ctdlqdata|${n.stableId}`));
check('every node carries uri === stableId', g.nodes.every((n) => n.properties.uri === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
check('stableIds unique', new Set(g.nodes.map((n) => n.stableId)).size === g.nodes.length);

// schema:* IS emitted as a native node (the crucial QData difference from forge-ctdlasn).
check('schema:MonetaryAmount IS emitted as a native DmeClass node', g.nodes.some((n) => n.stableId === 'schema:MonetaryAmount' && n.role === 'DmeClass'));

// ZERO cross-standard nodes emitted (filter-and-reference invariant).
check('NO node has a ceterms:* stableId', !g.nodes.some((n) => /^ceterms:/.test(n.stableId)));
check('NO node has a ceasn:* stableId', !g.nodes.some((n) => /^ceasn:/.test(n.stableId)));
check('NO node has an asn:* stableId', !g.nodes.some((n) => /^asn:/.test(n.stableId)));

// cross-standard references survive as {system,...} crossRefs keyed by target standard.
const aggregate = g.nodes.find((n) => n.stableId === 'qdata:AggregateDataProfile');
const metricType = g.nodes.find((n) => n.stableId === 'qdata:metricType');
const relatedTo = g.nodes.find((n) => n.stableId === 'qdata:relatedTo');
const orphanProp = g.nodes.find((n) => n.stableId === 'qdata:dataCollectionMethodType');
const gender = g.nodes.find((n) => n.stableId === 'demoCat:Gender');
const plainConcept = g.nodes.find((n) => n.stableId === 'metricCat:Enrollment');
const dataProfile = g.nodes.find((n) => n.stableId === 'qdata:DataProfile');
const relatedToCR = relatedTo ? JSON.parse(relatedTo.properties.crossRefs) : [];

check('class subClassOf ceterms -> crossRef {system:ctdl}', aggregate && JSON.parse(aggregate.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(aggregate.properties.crossRefs)[0].id === 'ceterms:Collection');
check('class crossRef locator === rdfs:subClassOf', aggregate && JSON.parse(aggregate.properties.crossRefs)[0].locator === 'rdfs:subClassOf');
check('property domain ceterms -> crossRef ceterms:Credential (ctdl)', metricType && JSON.parse(metricType.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(metricType.properties.crossRefs)[0].id === 'ceterms:Credential' && JSON.parse(metricType.properties.crossRefs)[0].locator === 'schema:domainIncludes');
check('property range ceterms -> crossRef ceterms:Occupation (ctdl)', relatedToCR.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Occupation' && c.locator === 'schema:rangeIncludes'));
check('property domain ceasn -> crossRef ceasn:CriterionLevel (system ctdlasn, PRESERVED not dropped)', relatedToCR.some((c) => c.system === 'ctdlasn' && c.id === 'ceasn:CriterionLevel' && c.locator === 'schema:domainIncludes'));
check('a node can carry BOTH ctdl and ctdlasn crossRefs', relatedToCR.length === 2 && relatedToCR.some((c) => c.system === 'ctdl') && relatedToCR.some((c) => c.system === 'ctdlasn'));
check('concept inScheme ceterms -> crossRef ceterms:ScopeOfData (ctdl)', gender && JSON.parse(gender.properties.crossRefs)[0].id === 'ceterms:ScopeOfData' && JSON.parse(gender.properties.crossRefs)[0].locator === 'skos:inScheme');
check('crossRef raw retains the ceterms CURIE', metricType && JSON.parse(metricType.properties.crossRefs)[0].raw === 'ceterms:Credential');
check('a node with no cross-standard ref has crossRefs === []', plainConcept && plainConcept.properties.crossRefs === '[]');
check('a native-only class has crossRefs === []', dataProfile && dataProfile.properties.crossRefs === '[]');
check('DmeProperty searchText carries owning class name', metricType.properties.searchText.includes('Aggregate Data Profile'));
check('honest status carried (unstable) on aggregate', aggregate && aggregate.properties.status === 'unstable');

// edges: only canonical types, all structural, all resolved (no danglers), standard-pure.
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === CTDLQData (standard-pure)', g.edges.every((e) => e.fromRef.source === 'CTDLQData' && e.toRef.source === 'CTDLQData'));
check('NO edge points at a ceterms:*/ceasn:*/asn:* endpoint (no cross-standard edge)', !g.edges.some((e) => /^(ceterms|ceasn|asn):/.test(e.fromRef.id) || /^(ceterms|ceasn|asn):/.test(e.toRef.id)));
check('HAS_CLASS root->class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'qdata:AggregateDataProfile'));
check('HAS_CLASS root->schema:* native class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'schema:MonetaryAmount'));
check('HAS_PROPERTY class->property present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'qdata:AggregateDataProfile' && e.toRef.id === 'qdata:metricType'));
check('SHARED property has 2nd HAS_PROPERTY from extra domain', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'qdata:DataProfile' && e.toRef.id === 'qdata:metricType'));
check('ORPHAN property (no native domain) anchored from root via HAS_PROPERTY', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'qdata:dataCollectionMethodType'));
check('orphan property retains its ceterms domain crossRef (never silently lost)', orphanProp && JSON.parse(orphanProp.properties.crossRefs).some((c) => c.system === 'ctdl' && c.id === 'ceterms:ProcessProfile'));
check('HAS_OPTION_SET property->scheme present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'qdata:metricType' && e.toRef.id === 'metricCat:MetricScheme'));
check('NO property->scheme REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'metricCat:MetricScheme'));
check('REFERENCES property->schema:* native class present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'qdata:relatedTo' && e.toRef.id === 'schema:MonetaryAmount'));
check('SUBCLASS_OF class->class present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'qdata:AggregateDataProfile' && e.toRef.id === 'qdata:DataProfile'));
check('HAS_VALUE scheme->concept present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'metricCat:MetricScheme' && e.toRef.id === 'metricCat:Enrollment'));

check('stats.crossRefNodes === 5', g.stats.crossRefNodes === 5);
check('stats.crossRefTotal === 6 (5 ctdl + 1 ctdlasn)', g.stats.crossRefTotal === 6);
check('stats.crossRefBySystem === {ctdl:5, ctdlasn:1}', g.stats.crossRefBySystem.ctdl === 5 && g.stats.crossRefBySystem.ctdlasn === 1);
check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.referencesEdges === 1', g.stats.referencesEdges === 1);
check('stats.subClassOfEdges === 1', g.stats.subClassOfEdges === 1);
check('stats.orphanAnchoredOptionSets === 1 (the orphan scheme)', g.stats.orphanAnchoredOptionSets === 1);
check('stats.orphanAnchoredProperties === 1 (the orphan property)', g.stats.orphanAnchoredProperties === 1);
check('orphan scheme anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'demoCat:OrphanScheme'));
check('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((os) => g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
check('every DmeProperty has >=1 incoming HAS_PROPERTY (none unreachable)', byRole('DmeProperty').every((p) => g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.toRef.id === p.stableId)));
// ZERO-ORPHAN INVARIANT (FADED_FORGE ruling): every node transitively reachable from root — no strandeds.
const synthReach = reachableFromRoot(g, 'ctdlqdata:root');
check('ZERO-ORPHAN: every node reachable from root by traversal', g.nodes.every((n) => synthReach.has(n.stableId)));
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// a present-but-unresolvable structural reference MUST throw (R3 — never a partial/dangling edge).
const danglingParsed = {
	metadata: syntheticParsed.metadata,
	nodes: [
		{ id: 'ctdlqdata:root', label: 'CtdlqdataRoot', superLabel: 'CtdlqdataModel', properties: { name: 'CTDLQData' }, edges: [] },
		{
			id: 'qdata:X',
			label: 'CtdlqdataClass',
			superLabel: 'CtdlqdataModel',
			properties: { name: 'X', description: '', uri: 'qdata:X', status: 'stable' },
			edges: [{ type: 'SUBCLASS_OF', targetId: 'qdata:MISSING', targetLabel: 'CtdlqdataClass' }],
		},
	],
};
let dangThrew = false;
try {
	bundle.buildContractGraph(danglingParsed);
} catch (e) {
	dangThrew = true;
}
check('present-but-unresolvable reference throws (R3 surfaced)', dangThrew);

// a blank native @id MUST throw (R3 — never silently minted).
const blankParsed = {
	metadata: syntheticParsed.metadata,
	nodes: [
		{ id: 'ctdlqdata:root', label: 'CtdlqdataRoot', superLabel: 'CtdlqdataModel', properties: { name: 'CTDLQData' }, edges: [] },
		{ id: '   ', label: 'CtdlqdataClass', superLabel: 'CtdlqdataModel', properties: { name: 'blank' }, edges: [] },
	],
};
let blankThrew = false;
try {
	bundle.buildContractGraph(blankParsed);
} catch (e) {
	blankThrew = true;
}
check('blank @id throws (R3 surfaced)', blankThrew);

// =====================================================================
// 2.5 NEVER-FABRICATE GUARD (TQ-approved regression guard; cloned verbatim from forge-ctdlasn §2.5 with
// the native CURIE prefixes swapped to QData's). A SYNTHETIC SILENT term — no dct:description /
// rdfs:comment / skos:definition and no vs:term_status — MUST yield description === '' and NO status
// stamped. Real CTDL-QData data carries a description and a status on every term (0/245 silent), so the
// honest-empty path is otherwise UNEXERCISED: without this guard, a regression that fabricated a default
// description or a 'stable' status on every node would leave the gate green. This exercises the PARSER
// (honest-empty getDescription/getStatus) end-to-end through buildContractGraph (makeNode's
// `description || ''`; status stamped only when truthy).
// =====================================================================

const silentSourcePath = path.join(os.tmpdir(), '__TEST_ctdlqdata_silent_source.json');
fs.writeFileSync(
	silentSourcePath,
	JSON.stringify({
		'@graph': [
			// every term carries ONLY a label — no description field, no vs:term_status. Honest-silent.
			{ '@id': 'qdata:SilentClass', '@type': 'rdfs:Class', 'rdfs:label': 'Silent Class' },
			{ '@id': 'qdata:silentProp', '@type': 'rdf:Property', 'rdfs:label': 'Silent Prop', 'schema:domainIncludes': 'qdata:SilentClass' },
			{ '@id': 'metricCat:SilentScheme', '@type': 'skos:ConceptScheme', 'rdfs:label': 'Silent Scheme' },
			{ '@id': 'metricCat:SilentConcept', '@type': 'skos:Concept', 'skos:prefLabel': 'Silent Concept', 'skos:inScheme': 'metricCat:SilentScheme' },
		],
	}),
);

const runNeverFabricateGuard = (done) => {
	parseCtdlqdata({ sourcePath: silentSourcePath, xLog: process.global.xLog }, (silentErr, silentParsed) => {
		// clean up the __TEST_ artifact immediately, whatever happens.
		if (fs.existsSync(silentSourcePath)) {
			fs.unlinkSync(silentSourcePath);
		}
		if (silentErr) {
			console.error(`  FAIL  never-fabricate guard: parser errored: ${silentErr}`);
			fail++;
			done();
			return;
		}
		// PARSER honest-empty: a silent term carries description === '' and status === '' (NOT 'stable').
		const pClass = silentParsed.nodes.find((n) => n.id === 'qdata:SilentClass');
		const pProp = silentParsed.nodes.find((n) => n.id === 'qdata:silentProp');
		const pConcept = silentParsed.nodes.find((n) => n.id === 'metricCat:SilentConcept');
		check('guard/parser: silent class description === ""', pClass && pClass.properties.description === '');
		check('guard/parser: silent class status === "" (NO stable default)', pClass && pClass.properties.status === '');
		check('guard/parser: silent property description === ""', pProp && pProp.properties.description === '');
		check('guard/parser: silent property status === ""', pProp && pProp.properties.status === '');
		check('guard/parser: silent concept description === ""', pConcept && pConcept.properties.description === '');
		check('guard/parser: silent concept status === ""', pConcept && pConcept.properties.status === '');

		// FORGE honest-empty end-to-end: forged node has description === '' and NO status property stamped.
		const silentGraph = bundle.buildContractGraph(silentParsed);
		const fClass = silentGraph.nodes.find((n) => n.stableId === 'qdata:SilentClass');
		const fProp = silentGraph.nodes.find((n) => n.stableId === 'qdata:silentProp');
		const fConcept = silentGraph.nodes.find((n) => n.stableId === 'metricCat:SilentConcept');
		check('guard/forge: silent class description === ""', fClass && fClass.properties.description === '');
		check('guard/forge: silent class has NO status property (not fabricated)', fClass && fClass.properties.status === undefined);
		check('guard/forge: silent property description === ""', fProp && fProp.properties.description === '');
		check('guard/forge: silent property has NO status property', fProp && fProp.properties.status === undefined);
		check('guard/forge: silent concept has NO status property', fConcept && fConcept.properties.status === undefined);
		// CONTROL — proves the guard can DISTINGUISH: a node WITH a real status still carries it (from §2).
		check('guard/control: a node WITH a real status still carries it', metricType && metricType.properties.status === 'stable');
		done();
	});
};

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual CTDL-QData JSON-LD asset.
// =====================================================================

const runRealData = () => {
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
		check('real: 11 DmeClass (7 ceterms classes filtered)', roleCount.DmeClass === 11);
		check('real: 82 DmeProperty (24 ceterms properties filtered)', roleCount.DmeProperty === 82);
		check('real: 8 DmeOptionSet', roleCount.DmeOptionSet === 8);
		check('real: 113 DmeOptionValue', roleCount.DmeOptionValue === 113);
		check('real: total 215 nodes', nodes.length === 215);
		check('real: total 277 edges', edges.length === 277);
		check('real: HAS_CLASS 11', edgeCount.HAS_CLASS === 11);
		check('real: HAS_PROPERTY 108', edgeCount.HAS_PROPERTY === 108);
		check('real: REFERENCES 37', edgeCount.REFERENCES === 37);
		check('real: HAS_OPTION_SET 8', edgeCount.HAS_OPTION_SET === 8);
		check('real: HAS_VALUE 113', edgeCount.HAS_VALUE === 113);
		check('real: SUBCLASS_OF 0 (QData classes do not subclass native classes)', (edgeCount.SUBCLASS_OF || 0) === 0);
		check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
		check('real: every node _source === CTDLQData', nodes.every((n) => n.properties._source === 'CTDLQData'));
		check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
		check('real: every node carries uri === stableId', nodes.every((n) => n.properties.uri === n.stableId));
		check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
		check('real: no snake_case property names', nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
		check('real: ZERO emitted ceterms:* nodes', !nodes.some((n) => /^ceterms:/.test(n.stableId)));
		check('real: ZERO emitted ceasn:* nodes', !nodes.some((n) => /^ceasn:/.test(n.stableId)));
		check('real: ZERO emitted asn:* nodes', !nodes.some((n) => /^asn:/.test(n.stableId)));
		check('real: schema:* IS emitted as native nodes (10)', nodes.filter((n) => /^schema:/.test(n.stableId)).length === 10);
		check('real: filteredCetermsCount === 31', result.metadata.filteredCetermsCount === 31);
		check('real: filteredUnknownCount === 0', result.metadata.filteredUnknownCount === 0);
		check('real: 145 cross-standard crossRefs on 15 nodes', result.stats.crossRefTotal === 145 && result.stats.crossRefNodes === 15);
		check('real: crossRefBySystem === {ctdl:139, ctdlasn:6}', result.stats.crossRefBySystem.ctdl === 139 && result.stats.crossRefBySystem.ctdlasn === 6);
		// every crossRef is a {system} pointing at a CURIE of its target standard.
		const allCrossRefs = nodes.flatMap((n) => JSON.parse(n.properties.crossRefs));
		check('real: all crossRefs system in {ctdl, ctdlasn}', allCrossRefs.every((c) => c.system === 'ctdl' || c.system === 'ctdlasn'));
		check('real: every ctdl crossRef id is a ceterms:* CURIE', allCrossRefs.filter((c) => c.system === 'ctdl').every((c) => /^ceterms:/.test(c.id)));
		check('real: every ctdlasn crossRef id is a ceasn:*/asn:* CURIE', allCrossRefs.filter((c) => c.system === 'ctdlasn').every((c) => /^(ceasn|asn):/.test(c.id)));
		check('real: crossRef total matches stats', allCrossRefs.length === result.stats.crossRefTotal);
		check('real: 6 ctdlasn crossRefs preserved (not dropped)', allCrossRefs.filter((c) => c.system === 'ctdlasn').length === 6);
		check('real: a known ceterms reference is present (ceterms:Credential)', allCrossRefs.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Credential'));
		check('real: a known ctdlasn reference is present (ceasn:CriterionLevel)', allCrossRefs.some((c) => c.system === 'ctdlasn' && c.id === 'ceasn:CriterionLevel'));
		check('real: raw CURIE retained on every crossRef (Phase 3.5 exact-URI join)', allCrossRefs.every((c) => typeof c.raw === 'string' && c.raw === c.id));
		check('real: only canonical edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
		check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
		check('real: standard-pure (every edge endpoint _source CTDLQData)', edges.every((e) => e.fromRef.source === 'CTDLQData' && e.toRef.source === 'CTDLQData'));
		check('real: NO edge points at a ceterms:*/ceasn:*/asn:* endpoint', !edges.some((e) => /^(ceterms|ceasn|asn):/.test(e.fromRef.id) || /^(ceterms|ceasn|asn):/.test(e.toRef.id)));
		check('real: every DmeOptionSet reachable via HAS_OPTION_SET (8/8)', nodes.filter((n) => n.role === 'DmeOptionSet').every((os) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
		check('real: every DmeOptionValue placed via HAS_VALUE (113/113)', nodes.filter((n) => n.role === 'DmeOptionValue').every((ov) => edges.some((e) => e.type === 'HAS_VALUE' && e.toRef.id === ov.stableId)));
		check('real: every DmeProperty reachable via HAS_PROPERTY (82/82, incl. root-anchored orphans)', nodes.filter((n) => n.role === 'DmeProperty').every((p) => edges.some((e) => e.type === 'HAS_PROPERTY' && e.toRef.id === p.stableId)));
		// ZERO-ORPHAN INVARIANT (FADED_FORGE ruling): every one of the 215 nodes transitively reachable from root.
		const realReach = reachableFromRoot(result, 'ctdlqdata:root');
		check('real: ZERO-ORPHAN — all 215 nodes reachable from root by traversal', nodes.every((n) => realReach.has(n.stableId)));
		check('real: orphanAnchoredProperties === 5 (the 5 domain-less native properties)', result.stats.orphanAnchoredProperties === 5);
		check('real: orphanAnchoredOptionSets === 8 (all schemes anchored from root)', result.stats.orphanAnchoredOptionSets === 8);
		check('real: no danglers', result.stats.danglingEdges.length === 0);
		check('real: version stamp (publishedVersion 20260130, provenance-file)', result.metadata.publishedVersion === '20260130' && result.metadata.versionSource === 'provenance-file');
		check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

		console.log('\n=== CTDL-QData REAL-DATA DRY COUNT (no embedding) ===');
		console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
		console.log('by role:', JSON.stringify(roleCount));
		console.log('by edge type:', JSON.stringify(edgeCount));
		console.log('stats:', JSON.stringify({
			crossRefNodes: result.stats.crossRefNodes,
			crossRefTotal: result.stats.crossRefTotal,
			crossRefBySystem: result.stats.crossRefBySystem,
			propertyOptionSetEdges: result.stats.propertyOptionSetEdges,
			orphanAnchoredOptionSets: result.stats.orphanAnchoredOptionSets,
			orphanAnchoredProperties: result.stats.orphanAnchoredProperties,
			subClassOfEdges: result.stats.subClassOfEdges,
			referencesEdges: result.stats.referencesEdges,
			filteredCetermsCount: result.metadata.filteredCetermsCount,
			danglingEdges: result.stats.danglingEdges.length,
		}));
		finish();
	});
};

// sequence: never-fabricate guard first, then the real-data run (both feed the same pass/fail tally).
runNeverFabricateGuard(runRealData);

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
