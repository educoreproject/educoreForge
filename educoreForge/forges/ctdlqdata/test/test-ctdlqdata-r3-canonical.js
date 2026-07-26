#!/usr/bin/env node
'use strict';

// test-ctdlqdata-r3-canonical.js — the R3/R4 + faithfulness gate for the ported CTDL-QData forge
// bundle.
//
// PORTED from the incumbent cli/parserLib/forge-ctdlqdata/test/test-r3-canonical.js and adapted to
// the recreation's shared harness (testAppStartup + harness), exactly as forge-ctdl's
// test-ctdl-r3-canonical.js was. The assertions are the incumbent's, PLUS an explicit FAITHFULNESS
// lock to the golden GOLD_260718: CTDL-QData is 215 nodes / 277 edges. If the port ever drifts from
// the incumbent, one of these bites.
//
// ALL PURE: no Voyage embedding call, no Neo4j, no golden touch — it exercises normalize +
// buildContractGraph (synthetic parse), the parser's honest-empty never-fabricate path over a
// synthetic silent source, AND forge({skipEmbedding:true}) over the REAL CTDL-QData JSON-LD asset
// that ships in this bundle. The suite stays hermetic (no docker, no Voyage, no database).
//
// Run: node forges/ctdlqdata/test/test-ctdlqdata-r3-canonical.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- R3/R4 + faithfulness gate for the ported CTDL-QData forge bundle

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives normalize, buildContractGraph on a synthetic parse, the parser's honest-empty guard on a
     tiny synthetic silent qdata.json, and forge({skipEmbedding:true}) over the real CTDL-QData
     JSON-LD asset. Asserts the universal contract shaping (clean stableIds, non-empty searchText,
     canonical resolved edges, standard-purity, determinism), the filter-and-reference crossRef stash
     (ceterms->ctdl, ceasn/asn->ctdlasn), native schema:* emission, the orphan-property root anchor,
     the zero-orphan reachability invariant, and LOCKS the ported bundle's real-data node/edge/stat
     counts to the incumbent's == golden GOLD_260718 (215 nodes / 277 edges). Pure and in-memory
     beyond the one bundled JSON asset; no docker, no Voyage, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const os = require('os');

const normalize = require('../lib/normalize');
const parseCtdlqdata = require('../lib/parser');
const bundle = require('../forgeCtdlqdata')({ embedder: null });

// reachableFromRoot — transitive BFS over the emitted edges from the DmeStandardRoot. Returns the set
// of stableIds reachable by following fromRef.id -> toRef.id. The zero-orphan invariant (FADED_FORGE
// ruling 2026-07-15): EVERY forged node must be in this set, so no native node is stranded — proven
// by the test, not merely happening to hold.
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
harness.section('NORMALIZE — clean CURIE stableId from varied native inputs (R3, data-independent)');
// =====================================================================

harness.equal('buildStableId CURIE -> same CURIE', normalize.buildStableId({ id: 'qdata:Observation' }).stableId, 'qdata:Observation');
harness.equal('buildStableId trims', normalize.buildStableId({ id: '  metricCat:Enrollment  ' }).stableId, 'metricCat:Enrollment');
harness.ok('buildStableId empty -> error', !!normalize.buildStableId({ id: '   ' }).error);
harness.ok('buildStableId null -> error', !!normalize.buildStableId({ id: null }).error);

harness.ok('isCleanStableId accepts a qdata CURIE', normalize.isCleanStableId('qdata:Observation'));
harness.ok('isCleanStableId accepts a metricCat CURIE', normalize.isCleanStableId('metricCat:Enrollment'));
harness.ok('isCleanStableId accepts a schema CURIE (schema is native for QData)', normalize.isCleanStableId('schema:MonetaryAmount'));
harness.ok('isCleanStableId accepts http URI', normalize.isCleanStableId('https://credreg.com/qdata/terms/x'));
harness.ok('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
harness.ok('isCleanStableId rejects bare token (no colon)', !normalize.isCleanStableId('Observation'));
harness.ok('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' qdata:X '));

// =====================================================================
harness.section('CONTRACT — buildContractGraph on a synthetic native parse (filter-and-reference + schema:* native + orphan property)');
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

harness.equal('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length, 1);
harness.equal('three DmeClass (incl. native schema:MonetaryAmount)', byRole('DmeClass').length, 3);
harness.equal('three DmeProperty', byRole('DmeProperty').length, 3);
harness.equal('two DmeOptionSet (concept schemes)', byRole('DmeOptionSet').length, 2);
harness.equal('two DmeOptionValue (concepts)', byRole('DmeOptionValue').length, 2);
harness.equal('zero DmeSupport (CTDL-QData has none)', byRole('DmeSupport').length, 0);

harness.ok('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
harness.ok('every node _source === CTDLQData', g.nodes.every((n) => n.properties._source === 'CTDLQData'));
harness.ok('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
harness.ok('every node _id deterministic from stableId', g.nodes.every((n) => n.properties._id === `ctdlqdata|${n.stableId}`));
harness.ok('every node carries uri === stableId', g.nodes.every((n) => n.properties.uri === n.stableId));
harness.ok('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
harness.ok('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
harness.ok('stableIds unique', new Set(g.nodes.map((n) => n.stableId)).size === g.nodes.length);

// schema:* IS emitted as a native node (the crucial QData difference from forge-ctdlasn).
harness.ok('schema:MonetaryAmount IS emitted as a native DmeClass node', g.nodes.some((n) => n.stableId === 'schema:MonetaryAmount' && n.role === 'DmeClass'));

// ZERO cross-standard nodes emitted (filter-and-reference invariant).
harness.ok('NO node has a ceterms:* stableId', !g.nodes.some((n) => /^ceterms:/.test(n.stableId)));
harness.ok('NO node has a ceasn:* stableId', !g.nodes.some((n) => /^ceasn:/.test(n.stableId)));
harness.ok('NO node has an asn:* stableId', !g.nodes.some((n) => /^asn:/.test(n.stableId)));

// cross-standard references survive as {system,...} crossRefs keyed by target standard.
const aggregate = g.nodes.find((n) => n.stableId === 'qdata:AggregateDataProfile');
const metricType = g.nodes.find((n) => n.stableId === 'qdata:metricType');
const relatedTo = g.nodes.find((n) => n.stableId === 'qdata:relatedTo');
const orphanProp = g.nodes.find((n) => n.stableId === 'qdata:dataCollectionMethodType');
const gender = g.nodes.find((n) => n.stableId === 'demoCat:Gender');
const plainConcept = g.nodes.find((n) => n.stableId === 'metricCat:Enrollment');
const dataProfile = g.nodes.find((n) => n.stableId === 'qdata:DataProfile');
const relatedToCR = relatedTo ? JSON.parse(relatedTo.properties.crossRefs) : [];

harness.ok('class subClassOf ceterms -> crossRef {system:ctdl}', aggregate && JSON.parse(aggregate.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(aggregate.properties.crossRefs)[0].id === 'ceterms:Collection');
harness.ok('class crossRef locator === rdfs:subClassOf', aggregate && JSON.parse(aggregate.properties.crossRefs)[0].locator === 'rdfs:subClassOf');
harness.ok('property domain ceterms -> crossRef ceterms:Credential (ctdl)', metricType && JSON.parse(metricType.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(metricType.properties.crossRefs)[0].id === 'ceterms:Credential' && JSON.parse(metricType.properties.crossRefs)[0].locator === 'schema:domainIncludes');
harness.ok('property range ceterms -> crossRef ceterms:Occupation (ctdl)', relatedToCR.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Occupation' && c.locator === 'schema:rangeIncludes'));
harness.ok('property domain ceasn -> crossRef ceasn:CriterionLevel (system ctdlasn, PRESERVED not dropped)', relatedToCR.some((c) => c.system === 'ctdlasn' && c.id === 'ceasn:CriterionLevel' && c.locator === 'schema:domainIncludes'));
harness.ok('a node can carry BOTH ctdl and ctdlasn crossRefs', relatedToCR.length === 2 && relatedToCR.some((c) => c.system === 'ctdl') && relatedToCR.some((c) => c.system === 'ctdlasn'));
harness.ok('concept inScheme ceterms -> crossRef ceterms:ScopeOfData (ctdl)', gender && JSON.parse(gender.properties.crossRefs)[0].id === 'ceterms:ScopeOfData' && JSON.parse(gender.properties.crossRefs)[0].locator === 'skos:inScheme');
harness.ok('crossRef raw retains the ceterms CURIE', metricType && JSON.parse(metricType.properties.crossRefs)[0].raw === 'ceterms:Credential');
harness.ok('a node with no cross-standard ref has crossRefs === []', plainConcept && plainConcept.properties.crossRefs === '[]');
harness.ok('a native-only class has crossRefs === []', dataProfile && dataProfile.properties.crossRefs === '[]');
harness.ok('DmeProperty searchText carries owning class name', metricType.properties.searchText.includes('Aggregate Data Profile'));
harness.ok('honest status carried (unstable) on aggregate', aggregate && aggregate.properties.status === 'unstable');

// edges: only canonical types, all structural, all resolved (no danglers), standard-pure.
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
harness.ok('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
harness.ok('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
harness.ok('every edge endpoint _source === CTDLQData (standard-pure)', g.edges.every((e) => e.fromRef.source === 'CTDLQData' && e.toRef.source === 'CTDLQData'));
harness.ok('NO edge points at a ceterms:*/ceasn:*/asn:* endpoint (no cross-standard edge)', !g.edges.some((e) => /^(ceterms|ceasn|asn):/.test(e.fromRef.id) || /^(ceterms|ceasn|asn):/.test(e.toRef.id)));
harness.ok('HAS_CLASS root->class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'qdata:AggregateDataProfile'));
harness.ok('HAS_CLASS root->schema:* native class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'schema:MonetaryAmount'));
harness.ok('HAS_PROPERTY class->property present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'qdata:AggregateDataProfile' && e.toRef.id === 'qdata:metricType'));
harness.ok('SHARED property has 2nd HAS_PROPERTY from extra domain', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'qdata:DataProfile' && e.toRef.id === 'qdata:metricType'));
harness.ok('ORPHAN property (no native domain) anchored from root via HAS_PROPERTY', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'qdata:dataCollectionMethodType'));
harness.ok('orphan property retains its ceterms domain crossRef (never silently lost)', orphanProp && JSON.parse(orphanProp.properties.crossRefs).some((c) => c.system === 'ctdl' && c.id === 'ceterms:ProcessProfile'));
harness.ok('HAS_OPTION_SET property->scheme present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'qdata:metricType' && e.toRef.id === 'metricCat:MetricScheme'));
harness.ok('NO property->scheme REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'metricCat:MetricScheme'));
harness.ok('REFERENCES property->schema:* native class present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'qdata:relatedTo' && e.toRef.id === 'schema:MonetaryAmount'));
harness.ok('SUBCLASS_OF class->class present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'qdata:AggregateDataProfile' && e.toRef.id === 'qdata:DataProfile'));
harness.ok('HAS_VALUE scheme->concept present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'metricCat:MetricScheme' && e.toRef.id === 'metricCat:Enrollment'));

harness.equal('stats.crossRefNodes === 5', g.stats.crossRefNodes, 5);
harness.equal('stats.crossRefTotal === 6 (5 ctdl + 1 ctdlasn)', g.stats.crossRefTotal, 6);
harness.ok('stats.crossRefBySystem === {ctdl:5, ctdlasn:1}', g.stats.crossRefBySystem.ctdl === 5 && g.stats.crossRefBySystem.ctdlasn === 1);
harness.equal('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges, 1);
harness.equal('stats.referencesEdges === 1', g.stats.referencesEdges, 1);
harness.equal('stats.subClassOfEdges === 1', g.stats.subClassOfEdges, 1);
harness.equal('stats.orphanAnchoredOptionSets === 1 (the orphan scheme)', g.stats.orphanAnchoredOptionSets, 1);
harness.equal('stats.orphanAnchoredProperties === 1 (the orphan property)', g.stats.orphanAnchoredProperties, 1);
harness.ok('orphan scheme anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdlqdata:root' && e.toRef.id === 'demoCat:OrphanScheme'));
harness.ok('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((osNode) => g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === osNode.stableId)));
harness.ok('every DmeProperty has >=1 incoming HAS_PROPERTY (none unreachable)', byRole('DmeProperty').every((p) => g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.toRef.id === p.stableId)));
// ZERO-ORPHAN INVARIANT: every node transitively reachable from root — no strandeds.
const synthReach = reachableFromRoot(g, 'ctdlqdata:root');
harness.ok('ZERO-ORPHAN: every node reachable from root by traversal', g.nodes.every((n) => synthReach.has(n.stableId)));
harness.equal('stats.danglingEdges empty', g.stats.danglingEdges.length, 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
harness.ok('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

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
harness.ok('present-but-unresolvable reference throws (R3 surfaced)', dangThrew);

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
harness.ok('blank @id throws (R3 surfaced)', blankThrew);

// =====================================================================
harness.section('NEVER-FABRICATE — a silent source term yields description === "" and NO status stamped');
// =====================================================================
// A SYNTHETIC SILENT term — no dct:description / rdfs:comment / skos:definition and no vs:term_status —
// MUST yield description === '' and NO status stamped. Real CTDL-QData carries a description + status on
// every term, so the honest-empty path is otherwise UNEXERCISED: without this guard, a regression that
// fabricated a default description or a 'stable' status on every node would leave the gate green. Written
// to the OS temp dir (never the project).

const silentSourcePath = path.join(os.tmpdir(), '__TEST_ctdlqdata_silent_source.json');
fs.writeFileSync(
	silentSourcePath,
	JSON.stringify({
		'@graph': [
			{ '@id': 'qdata:SilentClass', '@type': 'rdfs:Class', 'rdfs:label': 'Silent Class' },
			{ '@id': 'qdata:silentProp', '@type': 'rdf:Property', 'rdfs:label': 'Silent Prop', 'schema:domainIncludes': 'qdata:SilentClass' },
			{ '@id': 'metricCat:SilentScheme', '@type': 'skos:ConceptScheme', 'rdfs:label': 'Silent Scheme' },
			{ '@id': 'metricCat:SilentConcept', '@type': 'skos:Concept', 'skos:prefLabel': 'Silent Concept', 'skos:inScheme': 'metricCat:SilentScheme' },
		],
	}),
);

const runNeverFabricateGuard = (done) => {
	parseCtdlqdata({ sourcePath: silentSourcePath, xLog: process.global.xLog }, (silentErr, silentParsed) => {
		if (fs.existsSync(silentSourcePath)) {
			fs.unlinkSync(silentSourcePath);
		}
		harness.ok('never-fabricate guard: parser did not error', !silentErr, silentErr);
		if (silentErr) {
			done();
			return;
		}
		// PARSER honest-empty: a silent term carries description === '' and status === '' (NOT 'stable').
		const pClass = silentParsed.nodes.find((n) => n.id === 'qdata:SilentClass');
		const pProp = silentParsed.nodes.find((n) => n.id === 'qdata:silentProp');
		const pConcept = silentParsed.nodes.find((n) => n.id === 'metricCat:SilentConcept');
		harness.ok('guard/parser: silent class description === ""', pClass && pClass.properties.description === '');
		harness.ok('guard/parser: silent class status === "" (NO stable default)', pClass && pClass.properties.status === '');
		harness.ok('guard/parser: silent property description === ""', pProp && pProp.properties.description === '');
		harness.ok('guard/parser: silent property status === ""', pProp && pProp.properties.status === '');
		harness.ok('guard/parser: silent concept description === ""', pConcept && pConcept.properties.description === '');
		harness.ok('guard/parser: silent concept status === ""', pConcept && pConcept.properties.status === '');

		// FORGE honest-empty end-to-end: forged node has description === '' and NO status property stamped.
		const silentGraph = bundle.buildContractGraph(silentParsed);
		const fClass = silentGraph.nodes.find((n) => n.stableId === 'qdata:SilentClass');
		const fProp = silentGraph.nodes.find((n) => n.stableId === 'qdata:silentProp');
		const fConcept = silentGraph.nodes.find((n) => n.stableId === 'metricCat:SilentConcept');
		harness.ok('guard/forge: silent class description === ""', fClass && fClass.properties.description === '');
		harness.ok('guard/forge: silent class has NO status property (not fabricated)', fClass && fClass.properties.status === undefined);
		harness.ok('guard/forge: silent property description === ""', fProp && fProp.properties.description === '');
		harness.ok('guard/forge: silent property has NO status property', fProp && fProp.properties.status === undefined);
		harness.ok('guard/forge: silent concept has NO status property', fConcept && fConcept.properties.status === undefined);
		// CONTROL — proves the guard can DISTINGUISH: a node WITH a real status still carries it (from §2).
		harness.ok('guard/control: a node WITH a real status still carries it', metricType && metricType.properties.status === 'stable');
		done();
	});
};

// =====================================================================
// REAL DATA + FAITHFULNESS — forge over the bundled CTDL-QData asset == incumbent == golden GOLD_260718.
// =====================================================================
// The port is FAITHFUL iff the ported bundle reproduces the incumbent's real-data counts EXACTLY. The
// incumbent (cli/parserLib/forge-ctdlqdata, baked from the 2026-07-15 dry run) produced, and the golden
// GOLD_260718 carries, 215 nodes:
//   215 nodes (1 root, 11 class, 82 property, 8 optionSet, 113 optionValue); 277 edges
//   (HAS_CLASS 11, HAS_PROPERTY 108, REFERENCES 37, HAS_OPTION_SET 8, HAS_VALUE 113; SUBCLASS_OF 0);
//   145 cross-standard crossRefs on 15 nodes = ctdl 139 + ctdlasn 6; 31 ceterms:* filtered; 10 schema:*
//   native nodes; 5 orphan-anchored properties; 8 orphan-anchored option sets; 0 danglers.
// These are LOCKED below.

const INCUMBENT = {
	nodes: 215,
	edges: 277,
	role: { DmeStandardRoot: 1, DmeClass: 11, DmeProperty: 82, DmeOptionSet: 8, DmeOptionValue: 113 },
	edge: { HAS_CLASS: 11, HAS_PROPERTY: 108, REFERENCES: 37, HAS_OPTION_SET: 8, HAS_VALUE: 113 },
	stats: { crossRefTotal: 145, crossRefNodes: 15, ctdl: 139, ctdlasn: 6, orphanAnchoredProperties: 5, orphanAnchoredOptionSets: 8 },
};

const runRealData = () => {
	const assetDir = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
	bundle.forge({ sourcePath: assetDir, skipEmbedding: true }, (err, result) => {
		if (err) {
			harness.ok(`real-data forge did not error (${err})`, false, err);
			harness.report();
			return;
		}
		const nodes = result.nodes;
		const edges = result.edges;
		const roleCount = {};
		nodes.forEach((n) => { roleCount[n.role] = (roleCount[n.role] || 0) + 1; });
		const edgeCount = {};
		edges.forEach((e) => { edgeCount[e.type] = (edgeCount[e.type] || 0) + 1; });

		harness.section('REAL DATA + FAITHFULNESS — forge over the bundled CTDL-QData asset == golden GOLD_260718');

		// ---- FAITHFULNESS: the acceptance anchor — 215 nodes (golden GOLD_260718) ----
		harness.equal('FAITHFUL: total nodes === 215 (== golden GOLD_260718 CTDLQData)', nodes.length, INCUMBENT.nodes);
		harness.equal('FAITHFUL: total edges === incumbent 277', edges.length, INCUMBENT.edges);
		Object.keys(INCUMBENT.role).forEach((role) => {
			harness.equal(`FAITHFUL: role ${role} === ${INCUMBENT.role[role]}`, roleCount[role], INCUMBENT.role[role]);
		});
		Object.keys(INCUMBENT.edge).forEach((type) => {
			harness.equal(`FAITHFUL: edge ${type} === ${INCUMBENT.edge[type]}`, edgeCount[type], INCUMBENT.edge[type]);
		});
		harness.equal('FAITHFUL: SUBCLASS_OF 0 (QData classes do not subclass native classes)', (edgeCount.SUBCLASS_OF || 0), 0);
		harness.equal('FAITHFUL: no extra edge types beyond the incumbent set', Object.keys(edgeCount).sort().join(','), Object.keys(INCUMBENT.edge).sort().join(','));

		// ---- FAITHFULNESS: the bridge-stash + orphan stats match the incumbent ----
		harness.equal('FAITHFUL: crossRefTotal === 145', result.stats.crossRefTotal, INCUMBENT.stats.crossRefTotal);
		harness.equal('FAITHFUL: crossRefNodes === 15', result.stats.crossRefNodes, INCUMBENT.stats.crossRefNodes);
		harness.equal('FAITHFUL: crossRefBySystem.ctdl === 139', result.stats.crossRefBySystem.ctdl, INCUMBENT.stats.ctdl);
		harness.equal('FAITHFUL: crossRefBySystem.ctdlasn === 6', result.stats.crossRefBySystem.ctdlasn, INCUMBENT.stats.ctdlasn);
		harness.equal('FAITHFUL: orphanAnchoredProperties === 5', result.stats.orphanAnchoredProperties, INCUMBENT.stats.orphanAnchoredProperties);
		harness.equal('FAITHFUL: orphanAnchoredOptionSets === 8', result.stats.orphanAnchoredOptionSets, INCUMBENT.stats.orphanAnchoredOptionSets);
		harness.equal('FAITHFUL: filteredCetermsCount === 31', result.metadata.filteredCetermsCount, 31);
		harness.equal('FAITHFUL: filteredUnknownCount === 0', result.metadata.filteredUnknownCount, 0);

		// ---- CONTRACT INTEGRITY over the real data ----
		harness.ok('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
		harness.ok('real: every node _source === CTDLQData', nodes.every((n) => n.properties._source === 'CTDLQData'));
		harness.ok('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
		harness.ok('real: every node carries uri === stableId', nodes.every((n) => n.properties.uri === n.stableId));
		harness.ok('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
		harness.ok('real: no snake_case property names', nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
		harness.ok('real: only canonical edge types', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
		harness.ok('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
		harness.ok('real: standard-pure (every edge endpoint _source CTDLQData)', edges.every((e) => e.fromRef.source === 'CTDLQData' && e.toRef.source === 'CTDLQData'));
		harness.ok('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

		// ---- FILTER-AND-REFERENCE: zero cross-standard nodes/edges; schema:* native; refs survive ----
		harness.ok('real: ZERO emitted ceterms:* nodes', !nodes.some((n) => /^ceterms:/.test(n.stableId)));
		harness.ok('real: ZERO emitted ceasn:* nodes', !nodes.some((n) => /^ceasn:/.test(n.stableId)));
		harness.ok('real: ZERO emitted asn:* nodes', !nodes.some((n) => /^asn:/.test(n.stableId)));
		harness.equal('real: schema:* IS emitted as native nodes (10)', nodes.filter((n) => /^schema:/.test(n.stableId)).length, 10);
		harness.ok('real: NO edge points at a ceterms:*/ceasn:*/asn:* endpoint', !edges.some((e) => /^(ceterms|ceasn|asn):/.test(e.fromRef.id) || /^(ceterms|ceasn|asn):/.test(e.toRef.id)));
		const allCrossRefs = nodes.flatMap((n) => JSON.parse(n.properties.crossRefs));
		harness.ok('real: all crossRefs system in {ctdl, ctdlasn}', allCrossRefs.every((c) => c.system === 'ctdl' || c.system === 'ctdlasn'));
		harness.ok('real: every ctdl crossRef id is a ceterms:* CURIE', allCrossRefs.filter((c) => c.system === 'ctdl').every((c) => /^ceterms:/.test(c.id)));
		harness.ok('real: every ctdlasn crossRef id is a ceasn:*/asn:* CURIE', allCrossRefs.filter((c) => c.system === 'ctdlasn').every((c) => /^(ceasn|asn):/.test(c.id)));
		harness.equal('real: crossRef total matches stats', allCrossRefs.length, result.stats.crossRefTotal);
		harness.ok('real: a known ceterms reference is present (ceterms:Credential)', allCrossRefs.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Credential'));
		harness.ok('real: a known ctdlasn reference is present (ceasn:CriterionLevel)', allCrossRefs.some((c) => c.system === 'ctdlasn' && c.id === 'ceasn:CriterionLevel'));
		harness.ok('real: raw CURIE retained on every crossRef (Phase 3.5 exact-URI join)', allCrossRefs.every((c) => typeof c.raw === 'string' && c.raw === c.id));

		// ---- REACHABILITY: every option set / option value / property reachable; zero-orphan invariant ----
		harness.ok('real: every DmeOptionSet reachable via HAS_OPTION_SET (8/8)', nodes.filter((n) => n.role === 'DmeOptionSet').every((osNode) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === osNode.stableId)));
		harness.ok('real: every DmeOptionValue placed via HAS_VALUE (113/113)', nodes.filter((n) => n.role === 'DmeOptionValue').every((ov) => edges.some((e) => e.type === 'HAS_VALUE' && e.toRef.id === ov.stableId)));
		harness.ok('real: every DmeProperty reachable via HAS_PROPERTY (82/82, incl. root-anchored orphans)', nodes.filter((n) => n.role === 'DmeProperty').every((p) => edges.some((e) => e.type === 'HAS_PROPERTY' && e.toRef.id === p.stableId)));
		const realReach = reachableFromRoot(result, 'ctdlqdata:root');
		harness.ok('real: ZERO-ORPHAN — all 215 nodes reachable from root by traversal', nodes.every((n) => realReach.has(n.stableId)));
		harness.equal('real: no danglers', result.stats.danglingEdges.length, 0);
		harness.ok('real: version stamp (publishedVersion 20260130, provenance-file)', result.metadata.publishedVersion === '20260130' && result.metadata.versionSource === 'provenance-file');

		harness.note(`REAL-DATA DRY COUNT: ${nodes.length} nodes, ${edges.length} edges; by role ${JSON.stringify(roleCount)}; by edge ${JSON.stringify(edgeCount)}`);
		harness.report();
	});
};

// sequence: never-fabricate guard first (async parser), then the real-data run, then report.
runNeverFabricateGuard(runRealData);
