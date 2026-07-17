#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the CTDL-ASN forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL CTDL-ASN JSON-LD asset) and asserts that, whatever the native
// input form, the emitted node's stableId (the native CURIE) conforms to a clean canonical CURIE form
// BEFORE emission, searchText is non-empty, edges are canonical + fully resolved (no danglers), the
// block is standard-pure CTDLASN (_source='CTDLASN', no cross-standard edges), cross-standard terms
// (ceterms + qdata) emit ZERO nodes while native references to them survive as {system,...} crossRefs
// keyed by target standard, and the shaping is deterministic.
//
// Real-data counts (baked from the 2026-07-15 dry run over the plain-encoding ctdlasn.json, after the
// FADED_FORGE ruling to PRESERVE qdata cross-references):
//   119 nodes (1 root, 11 class, 97 property, 2 optionSet, 8 optionValue); 280 edges
//   (HAS_CLASS 11, SUBCLASS_OF 2, HAS_PROPERTY 203, REFERENCES 54, HAS_OPTION_SET 2, HAS_VALUE 8);
//   227 cross-standard crossRefs on 35 nodes = ctdl 216 + qdata 11; 4 ceterms:* terms filtered
//   (not emitted); 0 qdata nodes emitted; 0 danglers.
//
// Run: node cli/parserLib/forge-ctdlasn/test/test-r3-canonical.js

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
const parseCtdlasn = require('../lib/parser');
const bundle = require('../forgeCtdlasn')({ embedder: null });

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
// not merely happening to hold. REUSABLE: this helper + the zero-orphan assertions are part of the shared
// forge-test template so every forge inherits the never-orphan guard. (ASN has 0 orphan properties, so this
// simply confirms the invariant already holds here; forge-ctdlqdata's root-anchored orphans exercise it.)
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

check('buildStableId CURIE -> same CURIE', normalize.buildStableId({ id: 'ceasn:competencyText' }).stableId === 'ceasn:competencyText');
check('buildStableId trims', normalize.buildStableId({ id: '  asn:EducationalFramework  ' }).stableId === 'asn:EducationalFramework');
check('buildStableId empty -> error', !!normalize.buildStableId({ id: '   ' }).error);
check('buildStableId null -> error', !!normalize.buildStableId({ id: null }).error);

check('isCleanStableId accepts a CURIE', normalize.isCleanStableId('ceasn:competencyText'));
check('isCleanStableId accepts an evalCat CURIE', normalize.isCleanStableId('evalCat:progression'));
check('isCleanStableId accepts http URI', normalize.isCleanStableId('https://credreg.net/ctdlasn/terms/x'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects bare token (no colon)', !normalize.isCleanStableId('competencyText'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' ceasn:X '));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping, the
//    cross-standard filter-and-reference crossRef stash (ceterms->ctdl, qdata->qdata), and determinism.
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

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('two DmeClass', byRole('DmeClass').length === 2);
check('two DmeProperty', byRole('DmeProperty').length === 2);
check('two DmeOptionSet (concept schemes)', byRole('DmeOptionSet').length === 2);
check('two DmeOptionValue (concepts)', byRole('DmeOptionValue').length === 2);
check('zero DmeSupport (CTDL-ASN has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === CTDLASN', g.nodes.every((n) => n.properties._source === 'CTDLASN'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id deterministic from stableId', g.nodes.every((n) => n.properties._id === `ctdlasn|${n.stableId}`));
check('every node carries uri === stableId', g.nodes.every((n) => n.properties.uri === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
check('stableIds unique', new Set(g.nodes.map((n) => n.stableId)).size === g.nodes.length);

// ZERO cross-standard nodes emitted (filter-and-reference invariant).
check('NO node has a ceterms:* stableId', !g.nodes.some((n) => /^ceterms:/.test(n.stableId)));
check('NO node has a qdata:* stableId', !g.nodes.some((n) => /^qdata:/.test(n.stableId)));

// cross-standard references survive as {system,...} crossRefs keyed by target standard.
const framework = g.nodes.find((n) => n.stableId === 'asn:Framework');
const statusType = g.nodes.find((n) => n.stableId === 'ceasn:statusType');
const relatedTo = g.nodes.find((n) => n.stableId === 'ceasn:relatedTo');
const progression = g.nodes.find((n) => n.stableId === 'evalCat:progression');
const plainConcept = g.nodes.find((n) => n.stableId === 'publicationStatus:Published');
const competency = g.nodes.find((n) => n.stableId === 'ceasn:Competency');
const relatedToCR = relatedTo ? JSON.parse(relatedTo.properties.crossRefs) : [];

check('class subClassOf ceterms -> crossRef {system:ctdl}', framework && JSON.parse(framework.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(framework.properties.crossRefs)[0].id === 'ceterms:Collection');
check('class crossRef locator === rdfs:subClassOf', framework && JSON.parse(framework.properties.crossRefs)[0].locator === 'rdfs:subClassOf');
check('property domain ceterms -> crossRef ceterms:Credential (ctdl)', statusType && JSON.parse(statusType.properties.crossRefs)[0].system === 'ctdl' && JSON.parse(statusType.properties.crossRefs)[0].id === 'ceterms:Credential' && JSON.parse(statusType.properties.crossRefs)[0].locator === 'schema:domainIncludes');
check('property range ceterms -> crossRef ceterms:Occupation (ctdl)', relatedToCR.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Occupation' && c.locator === 'schema:rangeIncludes'));
check('property domain qdata -> crossRef qdata:Metric (system qdata, PRESERVED not dropped)', relatedToCR.some((c) => c.system === 'qdata' && c.id === 'qdata:Metric' && c.locator === 'schema:domainIncludes'));
check('a node can carry BOTH ctdl and qdata crossRefs', relatedToCR.length === 2 && relatedToCR.some((c) => c.system === 'ctdl') && relatedToCR.some((c) => c.system === 'qdata'));
check('concept inScheme ceterms -> crossRef ceterms:ScopeOfData (ctdl)', progression && JSON.parse(progression.properties.crossRefs)[0].id === 'ceterms:ScopeOfData' && JSON.parse(progression.properties.crossRefs)[0].locator === 'skos:inScheme');
check('crossRef raw retains the ceterms CURIE', statusType && JSON.parse(statusType.properties.crossRefs)[0].raw === 'ceterms:Credential');
check('a node with no cross-standard ref has crossRefs === []', plainConcept && plainConcept.properties.crossRefs === '[]');
check('a native-only class has crossRefs === []', competency && competency.properties.crossRefs === '[]');
check('DmeProperty searchText carries owning class name', statusType.properties.searchText.includes('Framework'));
check('honest status carried (unstable) on framework', framework && framework.properties.status === 'unstable');

// edges: only canonical types, all structural, all resolved (no danglers), standard-pure.
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === CTDLASN (standard-pure)', g.edges.every((e) => e.fromRef.source === 'CTDLASN' && e.toRef.source === 'CTDLASN'));
check('NO edge points at a ceterms:* or qdata:* endpoint (no cross-standard edge)', !g.edges.some((e) => /^(ceterms|qdata):/.test(e.fromRef.id) || /^(ceterms|qdata):/.test(e.toRef.id)));
check('HAS_CLASS root->class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdlasn:root' && e.toRef.id === 'asn:Framework'));
check('HAS_PROPERTY class->property present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'asn:Framework' && e.toRef.id === 'ceasn:statusType'));
check('SHARED property has 2nd HAS_PROPERTY from extra domain', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ceasn:Competency' && e.toRef.id === 'ceasn:statusType'));
check('HAS_OPTION_SET property->scheme present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ceasn:statusType' && e.toRef.id === 'ceasn:StatusScheme'));
check('NO property->scheme REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'ceasn:StatusScheme'));
check('REFERENCES property->class present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'ceasn:relatedTo' && e.toRef.id === 'ceasn:Competency'));
check('SUBCLASS_OF class->class present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'asn:Framework' && e.toRef.id === 'ceasn:Competency'));
check('HAS_VALUE scheme->concept present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'ceasn:StatusScheme' && e.toRef.id === 'publicationStatus:Published'));

check('stats.crossRefNodes === 4', g.stats.crossRefNodes === 4);
check('stats.crossRefTotal === 5 (4 ctdl + 1 qdata)', g.stats.crossRefTotal === 5);
check('stats.crossRefBySystem === {ctdl:4, qdata:1}', g.stats.crossRefBySystem.ctdl === 4 && g.stats.crossRefBySystem.qdata === 1);
check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.referencesEdges === 1', g.stats.referencesEdges === 1);
check('stats.subClassOfEdges === 1', g.stats.subClassOfEdges === 1);
check('stats.orphanAnchoredOptionSets === 1 (the orphan scheme)', g.stats.orphanAnchoredOptionSets === 1);
check('orphan scheme anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdlasn:root' && e.toRef.id === 'ceasn:OrphanScheme'));
check('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((os) => g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
// ZERO-ORPHAN INVARIANT (FADED_FORGE ruling): every node transitively reachable from root — no strandeds.
const synthReach = reachableFromRoot(g, 'ctdlasn:root');
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
check('present-but-unresolvable reference throws (R3 surfaced)', dangThrew);

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
check('blank @id throws (R3 surfaced)', blankThrew);

// =====================================================================
// 2.5 NEVER-FABRICATE GUARD (TQ-approved regression guard; REUSABLE TEMPLATE for the QData forge test).
// A SYNTHETIC SILENT term — no dct:description / rdfs:comment / skos:definition and no vs:term_status —
// MUST yield description === '' and NO status stamped. Real CTDL-ASN data carries a description and a
// status on every term, so the honest-empty path is otherwise UNEXERCISED: without this guard, a
// regression that fabricated a default description or a 'stable' status on every node would leave the
// gate green. This exercises the PARSER (honest-empty getDescription/getStatus) end-to-end through
// buildContractGraph (makeNode's `description || ''`; status stamped only when truthy).
//
// QDATA-REUSE: clone this block for forge-ctdlqdata's test — point parseCtdlasn at forge-ctdlqdata's
// parser, swap the native CURIE prefixes (qdata:/metricCat:/etc.), and keep the assertions verbatim.
// =====================================================================

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
	parseCtdlasn({ sourcePath: silentSourcePath, xLog: process.global.xLog }, (silentErr, silentParsed) => {
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
		const pClass = silentParsed.nodes.find((n) => n.id === 'ceasn:SilentClass');
		const pProp = silentParsed.nodes.find((n) => n.id === 'ceasn:silentProp');
		const pConcept = silentParsed.nodes.find((n) => n.id === 'publicationStatus:SilentConcept');
		check('guard/parser: silent class description === ""', pClass && pClass.properties.description === '');
		check('guard/parser: silent class status === "" (NO stable default)', pClass && pClass.properties.status === '');
		check('guard/parser: silent property description === ""', pProp && pProp.properties.description === '');
		check('guard/parser: silent property status === ""', pProp && pProp.properties.status === '');
		check('guard/parser: silent concept description === ""', pConcept && pConcept.properties.description === '');
		check('guard/parser: silent concept status === ""', pConcept && pConcept.properties.status === '');

		// FORGE honest-empty end-to-end: forged node has description === '' and NO status property stamped.
		const silentGraph = bundle.buildContractGraph(silentParsed);
		const fClass = silentGraph.nodes.find((n) => n.stableId === 'ceasn:SilentClass');
		const fProp = silentGraph.nodes.find((n) => n.stableId === 'ceasn:silentProp');
		const fConcept = silentGraph.nodes.find((n) => n.stableId === 'publicationStatus:SilentConcept');
		check('guard/forge: silent class description === ""', fClass && fClass.properties.description === '');
		check('guard/forge: silent class has NO status property (not fabricated)', fClass && fClass.properties.status === undefined);
		check('guard/forge: silent property description === ""', fProp && fProp.properties.description === '');
		check('guard/forge: silent property has NO status property', fProp && fProp.properties.status === undefined);
		check('guard/forge: silent concept has NO status property', fConcept && fConcept.properties.status === undefined);
		// CONTROL — proves the guard can DISTINGUISH: a node WITH a real status still carries it (from §2).
		check('guard/control: a node WITH a real status still carries it', statusType && statusType.properties.status === 'stable');
		done();
	});
};

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual CTDL-ASN JSON-LD asset.
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
	check('real: 11 DmeClass', roleCount.DmeClass === 11);
	check('real: 97 DmeProperty (4 ceterms filtered)', roleCount.DmeProperty === 97);
	check('real: 2 DmeOptionSet', roleCount.DmeOptionSet === 2);
	check('real: 8 DmeOptionValue', roleCount.DmeOptionValue === 8);
	check('real: total 119 nodes', nodes.length === 119);
	check('real: total 280 edges', edges.length === 280);
	check('real: HAS_CLASS 11', edgeCount.HAS_CLASS === 11);
	check('real: SUBCLASS_OF 2', edgeCount.SUBCLASS_OF === 2);
	check('real: HAS_PROPERTY 203', edgeCount.HAS_PROPERTY === 203);
	check('real: REFERENCES 54', edgeCount.REFERENCES === 54);
	check('real: HAS_OPTION_SET 2', edgeCount.HAS_OPTION_SET === 2);
	check('real: HAS_VALUE 8', edgeCount.HAS_VALUE === 8);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === CTDLASN', nodes.every((n) => n.properties._source === 'CTDLASN'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries uri === stableId', nodes.every((n) => n.properties.uri === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: no snake_case property names', nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
	check('real: ZERO emitted ceterms:* nodes', !nodes.some((n) => /^ceterms:/.test(n.stableId)));
	check('real: ZERO emitted qdata:* nodes', !nodes.some((n) => /^qdata:/.test(n.stableId)));
	check('real: filteredCetermsCount === 4', result.metadata.filteredCetermsCount === 4);
	check('real: filteredUnknownCount === 0', result.metadata.filteredUnknownCount === 0);
	check('real: 227 cross-standard crossRefs on 35 nodes', result.stats.crossRefTotal === 227 && result.stats.crossRefNodes === 35);
	check('real: crossRefBySystem === {ctdl:216, qdata:11}', result.stats.crossRefBySystem.ctdl === 216 && result.stats.crossRefBySystem.qdata === 11);
	// every crossRef is a {system} pointing at a CURIE of its target standard.
	const allCrossRefs = nodes.flatMap((n) => JSON.parse(n.properties.crossRefs));
	check('real: all crossRefs system in {ctdl, qdata}', allCrossRefs.every((c) => c.system === 'ctdl' || c.system === 'qdata'));
	check('real: every ctdl crossRef id is a ceterms:* CURIE', allCrossRefs.filter((c) => c.system === 'ctdl').every((c) => /^ceterms:/.test(c.id)));
	check('real: every qdata crossRef id is a qdata:* CURIE', allCrossRefs.filter((c) => c.system === 'qdata').every((c) => /^qdata:/.test(c.id)));
	check('real: crossRef total matches stats', allCrossRefs.length === result.stats.crossRefTotal);
	check('real: 11 qdata crossRefs preserved (not dropped)', allCrossRefs.filter((c) => c.system === 'qdata').length === 11);
	check('real: a known ceterms reference is present', allCrossRefs.some((c) => c.system === 'ctdl' && c.id === 'ceterms:Collection'));
	check('real: a known qdata reference is present', allCrossRefs.some((c) => c.system === 'qdata' && c.id === 'qdata:Observation'));
	check('real: only canonical edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source CTDLASN)', edges.every((e) => e.fromRef.source === 'CTDLASN' && e.toRef.source === 'CTDLASN'));
	check('real: NO edge points at a ceterms:* or qdata:* endpoint', !edges.some((e) => /^(ceterms|qdata):/.test(e.fromRef.id) || /^(ceterms|qdata):/.test(e.toRef.id)));
	check('real: every DmeOptionSet reachable via HAS_OPTION_SET', nodes.filter((n) => n.role === 'DmeOptionSet').every((os) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
	// ZERO-ORPHAN INVARIANT (FADED_FORGE ruling): every one of the 119 nodes transitively reachable from root.
	const realReach = reachableFromRoot(result, 'ctdlasn:root');
	check('real: ZERO-ORPHAN — all 119 nodes reachable from root by traversal', nodes.every((n) => realReach.has(n.stableId)));
	check('real: no danglers', result.stats.danglingEdges.length === 0);
	check('real: version stamp (publishedVersion 20230929, provenance-file)', result.metadata.publishedVersion === '20230929' && result.metadata.versionSource === 'provenance-file');
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== CTDL-ASN REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		crossRefNodes: result.stats.crossRefNodes,
		crossRefTotal: result.stats.crossRefTotal,
		crossRefBySystem: result.stats.crossRefBySystem,
		propertyOptionSetEdges: result.stats.propertyOptionSetEdges,
		orphanAnchoredOptionSets: result.stats.orphanAnchoredOptionSets,
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
