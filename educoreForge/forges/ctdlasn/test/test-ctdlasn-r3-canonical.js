#!/usr/bin/env node
'use strict';

// test-ctdlasn-r3-canonical.js — the R3/R4 + faithfulness gate for the ported CTDL-ASN forge bundle.
//
// PORTED from the incumbent cli/parserLib/forge-ctdlasn/test/test-r3-canonical.js and adapted to the
// recreation's shared harness (testAppStartup + harness), exactly the way test-ctdl-r3-canonical.js
// was adapted from forge-ctdl's incumbent test. The assertions are the incumbent's, PLUS explicit
// FAITHFULNESS locks: the ported bundle must produce the SAME node/edge totals, the SAME per-edge-type
// breakdown and the SAME crossRef stats the incumbent produced over the same source document
// (119 nodes / 280 edges — the golden GOLD_260718's CTDLASN figure). If the port ever drifts from the
// incumbent, one of these bites.
//
// ALL PURE: no Voyage embedding call, no Neo4j, no golden touch — it exercises normalize +
// buildContractGraph (synthetic parse), the parser's honest-empty + filter-and-reference behaviour on
// a synthetic source, AND forge({skipEmbedding:true}) over the REAL CTDL-ASN JSON-LD asset that ships
// in this bundle. The suite stays hermetic (PLAN §3 hard line 2): no docker.
//
// Run: node forges/ctdlasn/test/test-ctdlasn-r3-canonical.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- R3/R4 + faithfulness gate for the ported CTDL-ASN forge bundle

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives normalize, buildContractGraph on a synthetic parse, the parser on a synthetic
     ctdlasn.json (honest-empty + filter-and-reference), and forge({skipEmbedding:true}) over the
     real CTDL-ASN JSON-LD asset. Asserts the universal contract shaping (clean stableIds, non-empty
     searchText, canonical resolved edges, standard-purity, determinism, zero-orphan) and LOCKS the
     ported bundle's real-data node/edge/stat counts to the incumbent's (119 nodes / 280 edges).
     Pure and in-memory beyond the one bundled JSON asset; no docker, no Voyage, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const os = require('os');

const { xLog } = process.global;

const normalize = require('../lib/normalize');
const parseCtdlasn = require('../lib/parser');
const bundle = require('../forgeCtdlasn')({ embedder: null });

// reachableFromRoot — transitive BFS over the emitted edges from the DmeStandardRoot. Returns the set
// of stableIds reachable by following fromRef.id -> toRef.id. The zero-orphan invariant (FADED_FORGE
// ruling 2026-07-15): EVERY forged node must be in this set, so no native node is stranded — proven by
// the test, not merely happening to hold.
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

harness.equal('buildStableId CURIE -> same CURIE', normalize.buildStableId({ id: 'ceasn:competencyText' }).stableId, 'ceasn:competencyText');
harness.equal('buildStableId trims', normalize.buildStableId({ id: '  asn:EducationalFramework  ' }).stableId, 'asn:EducationalFramework');
harness.ok('buildStableId empty -> error', !!normalize.buildStableId({ id: '   ' }).error);
harness.ok('buildStableId null -> error', !!normalize.buildStableId({ id: null }).error);

harness.ok('isCleanStableId accepts a CURIE', normalize.isCleanStableId('ceasn:competencyText'));
harness.ok('isCleanStableId accepts an evalCat CURIE', normalize.isCleanStableId('evalCat:progression'));
harness.ok('isCleanStableId accepts http URI', normalize.isCleanStableId('https://credreg.net/ctdlasn/terms/x'));
harness.ok('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
harness.ok('isCleanStableId rejects bare token (no colon)', !normalize.isCleanStableId('competencyText'));
harness.ok('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' ceasn:X '));

// =====================================================================
harness.section('CONTRACT — buildContractGraph on a synthetic native parse (filter-and-reference)');
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: 'Release X',
		sourceFormat: 'json-ld',
		sourceFiles: ['ctdlasn.json'],
		sourceUrl: 'https://credreg.net/x',
		classCount: 2,
		propertyCount: 2,
		conceptSchemeCount: 2,
		conceptCount: 2,
	},
	nodes: [
		{ id: 'ctdlasn:root', label: 'CtdlasnRoot', superLabel: 'CtdlasnModel', properties: { name: 'CTDLASN' }, edges: [] },
		{
			id: 'ceasn:Competency',
			label: 'CtdlasnClass',
			superLabel: 'CtdlasnModel',
			properties: { name: 'Competency', description: 'a competency', uri: 'ceasn:Competency', status: 'stable' },
			edges: [],
		},
		{
			// a native class subclassing a native class AND a filtered ceterms class (crossRef -> ctdl).
			id: 'asn:Framework',
			label: 'CtdlasnClass',
			superLabel: 'CtdlasnModel',
			properties: {
				name: 'Framework',
				description: 'a framework',
				uri: 'asn:Framework',
				status: 'unstable',
				_crossRefs: [{ system: 'ctdl', id: 'ceterms:Collection', raw: 'ceterms:Collection', locator: 'rdfs:subClassOf' }],
			},
			edges: [{ type: 'SUBCLASS_OF', targetId: 'ceasn:Competency', targetLabel: 'CtdlasnClass' }],
		},
		{
			// a shared property across two native domains, constrained by a scheme, plus a ceterms domain crossRef.
			id: 'ceasn:statusType',
			label: 'CtdlasnProperty',
			superLabel: 'CtdlasnModel',
			properties: {
				name: 'Status Type',
				description: 'status',
				uri: 'ceasn:statusType',
				status: 'stable',
				usageNote: 'use me',
				domainCount: 2,
				_crossRefs: [{ system: 'ctdl', id: 'ceterms:Credential', raw: 'ceterms:Credential', locator: 'schema:domainIncludes' }],
			},
			edges: [{ type: 'CONSTRAINED_BY', targetId: 'ceasn:StatusScheme', targetLabel: 'CtdlasnConceptScheme' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'asn:Framework', fromLabel: 'CtdlasnClass' },
			_owningClassIds: ['asn:Framework', 'ceasn:Competency'],
		},
		{
			// a property referencing a native class (REFERENCES) plus TWO cross-standard crossRefs:
			// a ceterms range (-> ctdl) and a qdata domain (-> qdata). Both must survive.
			id: 'ceasn:relatedTo',
			label: 'CtdlasnProperty',
			superLabel: 'CtdlasnModel',
			properties: {
				name: 'Related To',
				description: 'a reference',
				uri: 'ceasn:relatedTo',
				status: 'stable',
				domainCount: 1,
				_crossRefs: [
					{ system: 'ctdl', id: 'ceterms:Occupation', raw: 'ceterms:Occupation', locator: 'schema:rangeIncludes' },
					{ system: 'qdata', id: 'qdata:Metric', raw: 'qdata:Metric', locator: 'schema:domainIncludes' },
				],
			},
			edges: [{ type: 'REFERENCES', targetId: 'ceasn:Competency', targetLabel: 'CtdlasnClass' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'asn:Framework', fromLabel: 'CtdlasnClass' },
			_owningClassIds: ['asn:Framework'],
		},
		{
			id: 'ceasn:StatusScheme',
			label: 'CtdlasnConceptScheme',
			superLabel: 'CtdlasnModel',
			properties: { name: 'Status Scheme', description: 'status vocab', uri: 'ceasn:StatusScheme' },
			edges: [],
		},
		// an ORPHAN concept scheme: no property constrains to it -> root->orphan HAS_OPTION_SET.
		{
			id: 'ceasn:OrphanScheme',
			label: 'CtdlasnConceptScheme',
			superLabel: 'CtdlasnModel',
			properties: { name: 'Orphan Scheme', description: 'orphan vocab', uri: 'ceasn:OrphanScheme' },
			edges: [],
		},
		{
			id: 'publicationStatus:Published',
			label: 'CtdlasnConcept',
			superLabel: 'CtdlasnModel',
			properties: { name: 'Published', description: 'published status', uri: 'publicationStatus:Published', status: 'stable' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'ceasn:StatusScheme', fromLabel: 'CtdlasnConceptScheme' },
		},
		{
			// a concept in a native scheme that ALSO carries a ceterms inScheme crossRef.
			id: 'evalCat:progression',
			label: 'CtdlasnConcept',
			superLabel: 'CtdlasnModel',
			properties: {
				name: 'Progression',
				description: 'a progression',
				uri: 'evalCat:progression',
				status: 'unstable',
				_crossRefs: [{ system: 'ctdl', id: 'ceterms:ScopeOfData', raw: 'ceterms:ScopeOfData', locator: 'skos:inScheme' }],
			},
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'ceasn:OrphanScheme', fromLabel: 'CtdlasnConceptScheme' },
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

harness.equal('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length, 1);
harness.equal('two DmeClass', byRole('DmeClass').length, 2);
harness.equal('two DmeProperty', byRole('DmeProperty').length, 2);
harness.equal('two DmeOptionSet (concept schemes)', byRole('DmeOptionSet').length, 2);
harness.equal('two DmeOptionValue (concepts)', byRole('DmeOptionValue').length, 2);
harness.equal('zero DmeSupport (CTDL-ASN has none)', byRole('DmeSupport').length, 0);

harness.ok('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
harness.ok('every node _source === CTDLASN', g.nodes.every((n) => n.properties._source === 'CTDLASN'));
harness.ok('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
harness.ok('every node _id deterministic from stableId', g.nodes.every((n) => n.properties._id === `ctdlasn|${n.stableId}`));
harness.ok('every node carries uri === stableId', g.nodes.every((n) => n.properties.uri === n.stableId));
harness.ok('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
harness.ok('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
harness.ok('stableIds unique', new Set(g.nodes.map((n) => n.stableId)).size === g.nodes.length);

// ZERO cross-standard nodes emitted (filter-and-reference invariant).
harness.ok('NO node has a ceterms:* stableId', !g.nodes.some((n) => /^ceterms:/.test(n.stableId)));
harness.ok('NO node has a qdata:* stableId', !g.nodes.some((n) => /^qdata:/.test(n.stableId)));

// cross-standard references survive as {system,...} crossRefs keyed by target standard.
const framework = g.nodes.find((n) => n.stableId === 'asn:Framework');
const statusType = g.nodes.find((n) => n.stableId === 'ceasn:statusType');
const relatedTo = g.nodes.find((n) => n.stableId === 'ceasn:relatedTo');
const progression = g.nodes.find((n) => n.stableId === 'evalCat:progression');
const plainConcept = g.nodes.find((n) => n.stableId === 'publicationStatus:Published');
const competency = g.nodes.find((n) => n.stableId === 'ceasn:Competency');
const relatedToCR = relatedTo ? JSON.parse(relatedTo.properties.crossRefs) : [];

harness.ok('class subClassOf ceterms -> crossRef {system:ctdl}', framework && JSON.parse(framework.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(framework.properties.crossRefs)[0].id === 'ceterms:Collection');
harness.ok('class crossRef locator === rdfs:subClassOf', framework && JSON.parse(framework.properties.crossRefs)[0].locator === 'rdfs:subClassOf');
harness.ok('property domain ceterms -> crossRef ceterms:Credential (ctdl)', statusType && JSON.parse(statusType.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(statusType.properties.crossRefs)[0].id === 'ceterms:Credential' && JSON.parse(statusType.properties.crossRefs)[0].locator === 'schema:domainIncludes');
harness.ok('property range ceterms -> crossRef ceterms:Occupation (ctdl)', relatedToCR.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Occupation' && c.locator === 'schema:rangeIncludes'));
harness.ok('property domain qdata -> crossRef qdata:Metric (system qdata, PRESERVED not dropped)', relatedToCR.some((c) => c.system === 'qdata' && c.id === 'qdata:Metric' && c.locator === 'schema:domainIncludes'));
harness.ok('a node can carry BOTH ctdl and qdata crossRefs', relatedToCR.length === 2 && relatedToCR.some((c) => c.system === 'ctdl') && relatedToCR.some((c) => c.system === 'qdata'));
harness.ok('concept inScheme ceterms -> crossRef ceterms:ScopeOfData (ctdl)', progression && JSON.parse(progression.properties.crossRefs)[0].id === 'ceterms:ScopeOfData' && JSON.parse(progression.properties.crossRefs)[0].locator === 'skos:inScheme');
harness.ok('crossRef raw retains the ceterms CURIE', statusType && JSON.parse(statusType.properties.crossRefs)[0].raw === 'ceterms:Credential');
harness.ok('a node with no cross-standard ref has crossRefs === []', plainConcept && plainConcept.properties.crossRefs === '[]');
harness.ok('a native-only class has crossRefs === []', competency && competency.properties.crossRefs === '[]');
harness.ok('DmeProperty searchText carries owning class name', statusType.properties.searchText.includes('Framework'));
harness.ok('honest status carried (unstable) on framework', framework && framework.properties.status === 'unstable');

// edges: only canonical types, all structural, all resolved (no danglers), standard-pure.
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
harness.ok('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
harness.ok('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
harness.ok('every edge endpoint _source === CTDLASN (standard-pure)', g.edges.every((e) => e.fromRef.source === 'CTDLASN' && e.toRef.source === 'CTDLASN'));
harness.ok('NO edge points at a ceterms:* or qdata:* endpoint (no cross-standard edge)', !g.edges.some((e) => /^(ceterms|qdata):/.test(e.fromRef.id) || /^(ceterms|qdata):/.test(e.toRef.id)));
harness.ok('HAS_CLASS root->class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdlasn:root' && e.toRef.id === 'asn:Framework'));
harness.ok('HAS_PROPERTY class->property present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'asn:Framework' && e.toRef.id === 'ceasn:statusType'));
harness.ok('SHARED property has 2nd HAS_PROPERTY from extra domain', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ceasn:Competency' && e.toRef.id === 'ceasn:statusType'));
harness.ok('HAS_OPTION_SET property->scheme present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ceasn:statusType' && e.toRef.id === 'ceasn:StatusScheme'));
harness.ok('NO property->scheme REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'ceasn:StatusScheme'));
harness.ok('REFERENCES property->class present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'ceasn:relatedTo' && e.toRef.id === 'ceasn:Competency'));
harness.ok('SUBCLASS_OF class->class present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'asn:Framework' && e.toRef.id === 'ceasn:Competency'));
harness.ok('HAS_VALUE scheme->concept present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'ceasn:StatusScheme' && e.toRef.id === 'publicationStatus:Published'));

harness.equal('stats.crossRefNodes === 4', g.stats.crossRefNodes, 4);
harness.equal('stats.crossRefTotal === 5 (4 ctdl + 1 qdata)', g.stats.crossRefTotal, 5);
harness.ok('stats.crossRefBySystem === {ctdl:4, qdata:1}', g.stats.crossRefBySystem.ctdl === 4 && g.stats.crossRefBySystem.qdata === 1);
harness.equal('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges, 1);
harness.equal('stats.referencesEdges === 1', g.stats.referencesEdges, 1);
harness.equal('stats.subClassOfEdges === 1', g.stats.subClassOfEdges, 1);
harness.equal('stats.orphanAnchoredOptionSets === 1 (the orphan scheme)', g.stats.orphanAnchoredOptionSets, 1);
harness.ok('orphan scheme anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdlasn:root' && e.toRef.id === 'ceasn:OrphanScheme'));
harness.ok('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((osNode) => g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === osNode.stableId)));
// ZERO-ORPHAN INVARIANT (FADED_FORGE ruling): every node transitively reachable from root — no strandeds.
const synthReach = reachableFromRoot(g, 'ctdlasn:root');
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
		{ id: 'ctdlasn:root', label: 'CtdlasnRoot', superLabel: 'CtdlasnModel', properties: { name: 'CTDLASN' }, edges: [] },
		{
			id: 'ceasn:X',
			label: 'CtdlasnClass',
			superLabel: 'CtdlasnModel',
			properties: { name: 'X', description: '', uri: 'ceasn:X', status: 'stable' },
			edges: [{ type: 'SUBCLASS_OF', targetId: 'ceasn:MISSING', targetLabel: 'CtdlasnClass' }],
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
		{ id: 'ctdlasn:root', label: 'CtdlasnRoot', superLabel: 'CtdlasnModel', properties: { name: 'CTDLASN' }, edges: [] },
		{ id: '   ', label: 'CtdlasnClass', superLabel: 'CtdlasnModel', properties: { name: 'blank' }, edges: [] },
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
harness.section('NEVER-FABRICATE GUARD — a silent term yields empty description + NO status (parser + forge)');
// =====================================================================
// A SYNTHETIC SILENT term — no dct:description / rdfs:comment / skos:definition and no vs:term_status —
// MUST yield description === '' and NO status stamped. Real CTDL-ASN data carries a description and a
// status on every term, so the honest-empty path is otherwise UNEXERCISED: without this guard, a
// regression that fabricated a default description or a 'stable' status on every node would leave the
// gate green.

const silentSourcePath = path.join(os.tmpdir(), '__TEST_ctdlasn_silent_source.json');
fs.writeFileSync(
	silentSourcePath,
	JSON.stringify({
		'@graph': [
			// every term carries ONLY a label — no description field, no vs:term_status. Honest-silent.
			{ '@id': 'ceasn:SilentClass', '@type': 'rdfs:Class', 'rdfs:label': 'Silent Class' },
			{ '@id': 'ceasn:silentProp', '@type': 'rdf:Property', 'rdfs:label': 'Silent Prop', 'schema:domainIncludes': 'ceasn:SilentClass' },
			{ '@id': 'ceasn:SilentScheme', '@type': 'skos:ConceptScheme', 'rdfs:label': 'Silent Scheme' },
			{ '@id': 'publicationStatus:SilentConcept', '@type': 'skos:Concept', 'skos:prefLabel': 'Silent Concept', 'skos:inScheme': 'ceasn:SilentScheme' },
		],
	}),
);

const runNeverFabricateGuard = (done) => {
	parseCtdlasn({ sourcePath: silentSourcePath, xLog }, (silentErr, silentParsed) => {
		// clean up the __TEST_ artifact immediately, whatever happens.
		if (fs.existsSync(silentSourcePath)) {
			fs.unlinkSync(silentSourcePath);
		}
		if (silentErr) {
			harness.ok(`never-fabricate guard: parser did not error (${silentErr})`, false, silentErr);
			done();
			return;
		}
		// PARSER honest-empty: a silent term carries description === '' and status === '' (NOT 'stable').
		const pClass = silentParsed.nodes.find((n) => n.id === 'ceasn:SilentClass');
		const pProp = silentParsed.nodes.find((n) => n.id === 'ceasn:silentProp');
		const pConcept = silentParsed.nodes.find((n) => n.id === 'publicationStatus:SilentConcept');
		harness.ok('guard/parser: silent class description === ""', pClass && pClass.properties.description === '');
		harness.ok('guard/parser: silent class status === "" (NO stable default)', pClass && pClass.properties.status === '');
		harness.ok('guard/parser: silent property description === ""', pProp && pProp.properties.description === '');
		harness.ok('guard/parser: silent property status === ""', pProp && pProp.properties.status === '');
		harness.ok('guard/parser: silent concept description === ""', pConcept && pConcept.properties.description === '');
		harness.ok('guard/parser: silent concept status === ""', pConcept && pConcept.properties.status === '');

		// FORGE honest-empty end-to-end: forged node has description === '' and NO status property stamped.
		const silentGraph = bundle.buildContractGraph(silentParsed);
		const fClass = silentGraph.nodes.find((n) => n.stableId === 'ceasn:SilentClass');
		const fProp = silentGraph.nodes.find((n) => n.stableId === 'ceasn:silentProp');
		const fConcept = silentGraph.nodes.find((n) => n.stableId === 'publicationStatus:SilentConcept');
		harness.ok('guard/forge: silent class description === ""', fClass && fClass.properties.description === '');
		harness.ok('guard/forge: silent class has NO status property (not fabricated)', fClass && fClass.properties.status === undefined);
		harness.ok('guard/forge: silent property description === ""', fProp && fProp.properties.description === '');
		harness.ok('guard/forge: silent property has NO status property', fProp && fProp.properties.status === undefined);
		harness.ok('guard/forge: silent concept has NO status property', fConcept && fConcept.properties.status === undefined);
		// CONTROL — proves the guard can DISTINGUISH: a node WITH a real status still carries it (from §CONTRACT).
		harness.ok('guard/control: a node WITH a real status still carries it', statusType && statusType.properties.status === 'stable');
		done();
	});
};

// =====================================================================
// REAL DATA + FAITHFULNESS — forge over the bundled CTDL-ASN asset == incumbent output (119 nodes).
// =====================================================================
// The port is FAITHFUL iff the ported bundle reproduces the incumbent's real-data counts EXACTLY.
// The incumbent (cli/parserLib/forge-ctdlasn, dry run 2026-07-15 over the plain-encoding ctdlasn.json)
// produced:
//   nodes 119  edges 280
//   role  { DmeStandardRoot:1, DmeClass:11, DmeProperty:97, DmeOptionSet:2, DmeOptionValue:8 }
//   edge  { HAS_CLASS:11, SUBCLASS_OF:2, HAS_PROPERTY:203, REFERENCES:54, HAS_OPTION_SET:2, HAS_VALUE:8 }
//   stats { crossRefTotal:227, crossRefNodes:35, crossRefBySystem:{ctdl:216, qdata:11},
//           filteredCetermsCount:4, filteredUnknownCount:0 }
// 119 is the golden GOLD_260718's CTDLASN node figure. These are LOCKED below.

const INCUMBENT = {
	nodes: 119,
	edges: 280,
	role: { DmeStandardRoot: 1, DmeClass: 11, DmeProperty: 97, DmeOptionSet: 2, DmeOptionValue: 8 },
	edge: { HAS_CLASS: 11, SUBCLASS_OF: 2, HAS_PROPERTY: 203, REFERENCES: 54, HAS_OPTION_SET: 2, HAS_VALUE: 8 },
	stats: { crossRefTotal: 227, crossRefNodes: 35, ctdl: 216, qdata: 11, filteredCetermsCount: 4, filteredUnknownCount: 0 },
};

const runRealData = () => {
	harness.section('REAL DATA + FAITHFULNESS — forge over the bundled CTDL-ASN asset (golden: 119 nodes)');
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

		// ---- FAITHFULNESS: totals + per-role + per-edge-type EXACTLY equal to the incumbent ----
		harness.equal('FAITHFUL: total nodes === incumbent 119 (== golden GOLD_260718 CTDLASN)', nodes.length, INCUMBENT.nodes);
		harness.equal('FAITHFUL: total edges === incumbent 280', edges.length, INCUMBENT.edges);
		Object.keys(INCUMBENT.role).forEach((role) => {
			harness.equal(`FAITHFUL: role ${role} === ${INCUMBENT.role[role]}`, roleCount[role], INCUMBENT.role[role]);
		});
		Object.keys(INCUMBENT.edge).forEach((type) => {
			harness.equal(`FAITHFUL: edge ${type} === ${INCUMBENT.edge[type]}`, edgeCount[type], INCUMBENT.edge[type]);
		});
		harness.equal('FAITHFUL: no extra edge types beyond the incumbent set', Object.keys(edgeCount).sort().join(','), Object.keys(INCUMBENT.edge).sort().join(','));

		// ---- FAITHFULNESS: the bridge-stash stats match the incumbent ----
		harness.equal('FAITHFUL: crossRefTotal === 227', result.stats.crossRefTotal, INCUMBENT.stats.crossRefTotal);
		harness.equal('FAITHFUL: crossRefNodes === 35', result.stats.crossRefNodes, INCUMBENT.stats.crossRefNodes);
		harness.equal('FAITHFUL: crossRefBySystem.ctdl === 216', result.stats.crossRefBySystem.ctdl, INCUMBENT.stats.ctdl);
		harness.equal('FAITHFUL: crossRefBySystem.qdata === 11 (PRESERVED not dropped)', result.stats.crossRefBySystem.qdata, INCUMBENT.stats.qdata);
		harness.equal('FAITHFUL: filteredCetermsCount === 4', result.metadata.filteredCetermsCount, INCUMBENT.stats.filteredCetermsCount);
		harness.equal('FAITHFUL: filteredUnknownCount === 0', result.metadata.filteredUnknownCount, INCUMBENT.stats.filteredUnknownCount);

		// ---- CONTRACT INTEGRITY over the real data ----
		harness.ok('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
		harness.ok('real: every node _source === CTDLASN', nodes.every((n) => n.properties._source === 'CTDLASN'));
		harness.ok('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
		harness.ok('real: every node carries uri === stableId', nodes.every((n) => n.properties.uri === n.stableId));
		harness.ok('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
		harness.ok('real: no snake_case property names', nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
		harness.ok('real: ZERO emitted ceterms:* nodes', !nodes.some((n) => /^ceterms:/.test(n.stableId)));
		harness.ok('real: ZERO emitted qdata:* nodes', !nodes.some((n) => /^qdata:/.test(n.stableId)));
		harness.ok('real: only canonical edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
		harness.ok('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
		harness.ok('real: standard-pure (every edge endpoint _source CTDLASN)', edges.every((e) => e.fromRef.source === 'CTDLASN' && e.toRef.source === 'CTDLASN'));
		harness.ok('real: NO edge points at a ceterms:* or qdata:* endpoint', !edges.some((e) => /^(ceterms|qdata):/.test(e.fromRef.id) || /^(ceterms|qdata):/.test(e.toRef.id)));
		harness.ok('real: every DmeOptionSet reachable via HAS_OPTION_SET', nodes.filter((n) => n.role === 'DmeOptionSet').every((osNode) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === osNode.stableId)));

		// ---- FILTER-AND-REFERENCE: foreign structural references survive as crossRefs (bridge material) ----
		const allCrossRefs = nodes.flatMap((n) => JSON.parse(n.properties.crossRefs));
		harness.ok('real: all crossRefs system in {ctdl, qdata}', allCrossRefs.every((c) => c.system === 'ctdl' || c.system === 'qdata'));
		harness.ok('real: every ctdl crossRef id is a ceterms:* CURIE', allCrossRefs.filter((c) => c.system === 'ctdl').every((c) => /^ceterms:/.test(c.id)));
		harness.ok('real: every qdata crossRef id is a qdata:* CURIE', allCrossRefs.filter((c) => c.system === 'qdata').every((c) => /^qdata:/.test(c.id)));
		harness.equal('real: crossRef total matches stats', allCrossRefs.length, result.stats.crossRefTotal);
		harness.equal('real: 11 qdata crossRefs preserved (not dropped)', allCrossRefs.filter((c) => c.system === 'qdata').length, 11);
		harness.ok('real: a known ceterms reference is present', allCrossRefs.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Collection'));
		harness.ok('real: a known qdata reference is present', allCrossRefs.some((c) => c.system === 'qdata' && c.id === 'qdata:Observation'));

		// ZERO-ORPHAN INVARIANT (FADED_FORGE ruling): every one of the 119 nodes transitively reachable from root.
		const realReach = reachableFromRoot(result, 'ctdlasn:root');
		harness.ok('real: ZERO-ORPHAN — all 119 nodes reachable from root by traversal', nodes.every((n) => realReach.has(n.stableId)));
		harness.equal('real: no danglers', result.stats.danglingEdges.length, 0);
		harness.ok('real: version stamp (publishedVersion 20230929, provenance-file)', result.metadata.publishedVersion === '20230929' && result.metadata.versionSource === 'provenance-file');
		harness.ok('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

		harness.report();
	});
};

// sequence: never-fabricate guard first, then the real-data run (both feed the same harness tally).
runNeverFabricateGuard(runRealData);
