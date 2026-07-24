#!/usr/bin/env node
'use strict';

// test-ctdl-r3-canonical.js — the R3/R4 gate for the ported CTDL forge bundle (PLAN P1).
//
// PORTED from the incumbent cli/parserLib/forge-ctdl/test/test-r3-canonical.js and adapted to the
// recreation's shared harness (testAppStartup + harness), the way test-lif-parser.js was. The
// assertions are the incumbent's, PLUS explicit FAITHFULNESS locks: the ported bundle must produce
// the SAME node/edge totals, the SAME per-edge-type breakdown and the SAME crossRef stats the
// incumbent produced over the same source document (994 nodes / 10128 edges — the golden's CTDL
// figure). If the port ever drifts from the incumbent, one of these bites.
//
// ALL PURE: no Voyage embedding call, no Neo4j, no golden touch — it exercises normalize +
// buildContractGraph (synthetic parse) AND forge({skipEmbedding:true}) over the REAL CTDL JSON-LD
// asset that ships in this bundle. The suite stays hermetic (PLAN §3 hard line 2).
//
// Run: node forges/ctdl/test/test-ctdl-r3-canonical.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- R3/R4 + faithfulness gate for the ported CTDL forge bundle

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives normalize, buildContractGraph on a synthetic parse, the parser on a tiny synthetic
     ctdl-schema.json, and forge({skipEmbedding:true}) over the real CTDL JSON-LD asset. Asserts
     the universal contract shaping (clean stableIds, non-empty searchText, canonical resolved
     edges, standard-purity, determinism) and LOCKS the ported bundle's real-data node/edge/stat
     counts to the incumbent's (994 nodes / 10128 edges). Pure and in-memory beyond the one bundled
     JSON asset; no docker, no Voyage, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const os = require('os');

const normalize = require('../lib/normalize');
const parseCtdl = require('../lib/parser');
const bundle = require('../forgeCtdl')({ embedder: null });

// =====================================================================
harness.section('NORMALIZE — canonical forms from varied native inputs (R3, data-independent)');
// =====================================================================

harness.equal('buildStableId CURIE -> same CURIE', normalize.buildStableId({ id: 'ceterms:AcademicCertificate' }).stableId, 'ceterms:AcademicCertificate');
harness.equal('buildStableId trims', normalize.buildStableId({ id: '  ceasn:abilityEmbodied  ' }).stableId, 'ceasn:abilityEmbodied');
harness.ok('buildStableId empty -> error', !!normalize.buildStableId({ id: '   ' }).error);
harness.ok('buildStableId null -> error', !!normalize.buildStableId({ id: null }).error);

harness.ok('isCleanStableId accepts a CURIE', normalize.isCleanStableId('ceterms:AcademicCertificate'));
harness.ok('isCleanStableId accepts a fragment CURIE', normalize.isCleanStableId('accommodation:AccessibleHousing'));
harness.ok('isCleanStableId accepts http URI', normalize.isCleanStableId('https://credreg.net/ctdl/terms/x'));
harness.ok('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
harness.ok('isCleanStableId rejects bare token (no colon)', !normalize.isCleanStableId('AcademicCertificate'));
harness.ok('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' ceterms:X '));

harness.equal("normalizeCedsCrossRef('ceds:000113#Assistantships') -> OS000113", normalize.normalizeCedsCrossRef({ rawValue: 'ceds:000113#Assistantships' }).cedsId, 'OS000113');
harness.equal('normalizeCedsCrossRef carries fragment', normalize.normalizeCedsCrossRef({ rawValue: 'ceds:000113#Assistantships' }).fragment, 'Assistantships');
harness.equal("normalizeCedsCrossRef('ceds:001610#DODTuitionAssistance') -> OS001610", normalize.normalizeCedsCrossRef({ rawValue: 'ceds:001610#DODTuitionAssistance' }).cedsId, 'OS001610');
harness.equal("normalizeCedsCrossRef('ceds:000113') no fragment -> OS000113", normalize.normalizeCedsCrossRef({ rawValue: 'ceds:000113' }).cedsId, 'OS000113');
harness.ok("normalizeCedsCrossRef('') -> absent", !!normalize.normalizeCedsCrossRef({ rawValue: '' }).absent);
harness.ok("normalizeCedsCrossRef('ceds:nodigits') -> error", !!normalize.normalizeCedsCrossRef({ rawValue: 'ceds:nodigits' }).error);
harness.ok('isCanonicalCrossRefCedsId(OS000113)', normalize.isCanonicalCrossRefCedsId('OS000113'));
harness.ok('isCanonicalCrossRefCedsId rejects 000113', !normalize.isCanonicalCrossRefCedsId('000113'));

// =====================================================================
harness.section('CONTRACT — buildContractGraph on a synthetic native parse');
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: 'Release X',
		sourceFormat: 'json-ld',
		sourceFiles: ['ctdl-schema.json'],
		sourceUrl: 'https://credreg.net/x',
		classCount: 2,
		propertyCount: 2,
		conceptSchemeCount: 2,
		conceptCount: 2,
	},
	nodes: [
		{ id: 'ctdl:root', label: 'CtdlRoot', superLabel: 'CtdlModel', properties: { name: 'CTDL' }, edges: [] },
		{
			id: 'ceterms:Certificate',
			label: 'CtdlClass',
			superLabel: 'CtdlModel',
			properties: { name: 'Certificate', description: 'a cert', uri: 'ceterms:Certificate', status: 'stable' },
			edges: [],
		},
		{
			id: 'ceterms:AcademicCertificate',
			label: 'CtdlClass',
			superLabel: 'CtdlModel',
			properties: { name: 'Academic Certificate', description: 'an academic cert', uri: 'ceterms:AcademicCertificate', status: 'unstable' },
			edges: [{ type: 'SUBCLASS_OF', targetId: 'ceterms:Certificate', targetLabel: 'CtdlClass' }],
		},
		{
			id: 'ceterms:credentialStatusType',
			label: 'CtdlProperty',
			superLabel: 'CtdlModel',
			properties: { name: 'Credential Status Type', description: 'status', uri: 'ceterms:credentialStatusType', status: 'stable', usageNote: 'use me', domainCount: 1 },
			edges: [{ type: 'CONSTRAINED_BY', targetId: 'ceterms:CredentialStatus', targetLabel: 'CtdlConceptScheme' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'ceterms:AcademicCertificate', fromLabel: 'CtdlClass' },
			_owningClassIds: ['ceterms:AcademicCertificate', 'ceterms:Certificate'],
		},
		{
			id: 'ceterms:offeredBy',
			label: 'CtdlProperty',
			superLabel: 'CtdlModel',
			properties: { name: 'Offered By', description: 'offered by an org', uri: 'ceterms:offeredBy', status: 'stable', domainCount: 1 },
			edges: [{ type: 'REFERENCES', targetId: 'ceterms:Certificate', targetLabel: 'CtdlClass' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'ceterms:AcademicCertificate', fromLabel: 'CtdlClass' },
			_owningClassIds: ['ceterms:AcademicCertificate'],
		},
		{
			id: 'ceterms:CredentialStatus',
			label: 'CtdlConceptScheme',
			superLabel: 'CtdlModel',
			properties: { name: 'Credential Status', description: 'status vocab', uri: 'ceterms:CredentialStatus' },
			edges: [],
		},
		// an ORPHAN concept scheme: no property constrains to it -> root->orphan HAS_OPTION_SET.
		{
			id: 'ceterms:Accommodation',
			label: 'CtdlConceptScheme',
			superLabel: 'CtdlModel',
			properties: { name: 'Accommodation', description: 'accommodation vocab', uri: 'ceterms:Accommodation' },
			edges: [],
		},
		{
			id: 'credentialStat:Active',
			label: 'CtdlConcept',
			superLabel: 'CtdlModel',
			properties: { name: 'Active', description: 'active status', uri: 'credentialStat:Active', status: 'stable' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'ceterms:CredentialStatus', fromLabel: 'CtdlConceptScheme' },
		},
		{
			id: 'financialAid:FederalGrant',
			label: 'CtdlConcept',
			superLabel: 'CtdlModel',
			properties: { name: 'Federal Grant', description: 'a federal grant', uri: 'financialAid:FederalGrant', status: 'unstable', _cedsAnchors: ['ceds:000113#OtherFederalGrants'] },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'ceterms:Accommodation', fromLabel: 'CtdlConceptScheme' },
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
harness.equal('zero DmeSupport (CTDL has none)', byRole('DmeSupport').length, 0);

harness.ok('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
harness.ok('every node _source === CTDL', g.nodes.every((n) => n.properties._source === 'CTDL'));
harness.ok('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
harness.ok('every node _id deterministic from stableId', g.nodes.every((n) => n.properties._id === `ctdl|${n.stableId}`));
harness.ok('every node carries uri === stableId', g.nodes.every((n) => n.properties.uri === n.stableId));
harness.ok('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
harness.ok('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
harness.ok('stableIds unique', new Set(g.nodes.map((n) => n.stableId)).size === g.nodes.length);

const annotated = g.nodes.find((n) => n.stableId === 'financialAid:FederalGrant');
const plain = g.nodes.find((n) => n.stableId === 'credentialStat:Active');
harness.ok('annotated concept cedsId === OS000113', annotated && annotated.properties.cedsId === 'OS000113');
harness.ok('annotated concept cedsId is canonical', annotated && normalize.isCanonicalCrossRefCedsId(annotated.properties.cedsId));
harness.ok('annotated concept crossRefs JSON carries the ceds ref', annotated && JSON.parse(annotated.properties.crossRefs)[0].id === 'OS000113');
harness.ok('annotated concept crossRefs retains raw form', annotated && JSON.parse(annotated.properties.crossRefs)[0].raw === 'ceds:000113#OtherFederalGrants');
harness.ok('plain concept has no cedsId', plain && plain.properties.cedsId === undefined);
harness.ok('plain concept crossRefs === []', plain && plain.properties.crossRefs === '[]');
harness.ok('DmeProperty searchText carries owning class name', g.nodes.find((n) => n.stableId === 'ceterms:credentialStatusType').properties.searchText.includes('Academic Certificate'));

const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
harness.ok('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
harness.ok('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
harness.ok('every edge endpoint _source === CTDL (standard-pure)', g.edges.every((e) => e.fromRef.source === 'CTDL' && e.toRef.source === 'CTDL'));
harness.ok('HAS_CLASS root->class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdl:root' && e.toRef.id === 'ceterms:AcademicCertificate'));
harness.ok('HAS_PROPERTY class->property present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ceterms:AcademicCertificate' && e.toRef.id === 'ceterms:credentialStatusType'));
harness.ok('SHARED property has 2nd HAS_PROPERTY from extra domain', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ceterms:Certificate' && e.toRef.id === 'ceterms:credentialStatusType'));
harness.ok('HAS_OPTION_SET property->scheme present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ceterms:credentialStatusType' && e.toRef.id === 'ceterms:CredentialStatus'));
harness.ok('NO blanket root->scheme HAS_OPTION_SET for the constrained scheme', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdl:root' && e.toRef.id === 'ceterms:CredentialStatus'));
harness.ok('NO property->scheme REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'ceterms:CredentialStatus'));
harness.ok('REFERENCES property->class present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'ceterms:offeredBy' && e.toRef.id === 'ceterms:Certificate'));
harness.ok('SUBCLASS_OF class->class present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'ceterms:AcademicCertificate' && e.toRef.id === 'ceterms:Certificate'));
harness.ok('HAS_VALUE scheme->concept present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'ceterms:CredentialStatus' && e.toRef.id === 'credentialStat:Active'));

harness.equal('stats.cedsAnnotatedConcepts === 1', g.stats.cedsAnnotatedConcepts, 1);
harness.equal('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges, 1);
harness.equal('stats.referencesEdges === 1', g.stats.referencesEdges, 1);
harness.equal('stats.subClassOfEdges === 1', g.stats.subClassOfEdges, 1);
harness.equal('stats.orphanAnchoredOptionSets === 1 (the orphan scheme)', g.stats.orphanAnchoredOptionSets, 1);
harness.ok('orphan scheme anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdl:root' && e.toRef.id === 'ceterms:Accommodation'));
harness.ok('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((osNode) => g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === osNode.stableId)));
harness.equal('stats.danglingEdges empty', g.stats.danglingEdges.length, 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
harness.ok('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// a present-but-unnormalizable CEDS annotation MUST throw (R3 — never silently dropped).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.find((n) => n.id === 'financialAid:FederalGrant').properties._cedsAnchors = ['ceds:no-digits-here'];
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
harness.ok('unnormalizable CEDS anchor throws (R3 surfaced)', threw);

// =====================================================================
harness.section('PARSER — honest-empty status + filter-and-reference partition (synthetic source)');
// =====================================================================
// A tiny SYNTHETIC ctdl-schema.json in the OS temp dir (never the project). Proves the
// never-fabricate status fix and the standard-pure filtering directly at the parser boundary.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-ctdlParser-'));
const syntheticSource = {
	'@graph': [
		{ '@id': 'ceterms:WithStatus', '@type': 'rdfs:Class', 'rdfs:label': { 'en-US': 'With Status' }, 'dct:description': { 'en-US': 'has a status' }, 'vs:term_status': 'vs:stable' },
		{ '@id': 'ceterms:NoStatus', '@type': 'rdfs:Class', 'rdfs:label': { 'en-US': 'No Status' }, 'dct:description': { 'en-US': 'no status field' } },
		{ '@id': 'ceterms:ValueThing', '@type': 'rdfs:Class', 'rdfs:label': { 'en-US': 'Value Thing' }, 'rdfs:subClassOf': ['schema:QuantitativeValue', 'schema:CreativeWork'] },
		{ '@id': 'schema:QuantitativeValue', '@type': 'rdfs:Class', 'rdfs:label': { 'en-US': 'Quantitative Value' } },
		{ '@id': 'ceterms:pointsToAsn', '@type': 'rdf:Property', 'rdfs:label': { 'en-US': 'Points To Asn' }, 'schema:domainIncludes': ['ceterms:WithStatus'], 'schema:rangeIncludes': ['ceasn:Competency', 'xsd:string'] },
		{ '@id': 'ceasn:hasChild', '@type': 'rdf:Property', 'rdfs:label': { 'en-US': 'Has Child' } },
	],
};
fs.writeFileSync(path.join(tmpDir, 'ctdl-schema.json'), JSON.stringify(syntheticSource));

// parseCtdl invokes its callback synchronously, so these accumulate before the async real-data run.
parseCtdl({ sourcePath: tmpDir }, (perr, parsed) => {
	harness.ok('parser: no error on synthetic source', !perr);
	const pnodes = (parsed && parsed.nodes) || [];
	const byId = {};
	pnodes.forEach((n) => { byId[n.id] = n; });
	harness.equal('parser: WithStatus carries real status "stable"', byId['ceterms:WithStatus'] && byId['ceterms:WithStatus'].properties.status, 'stable');
	harness.equal('parser: NoStatus status is honest-empty "" (NOT fabricated "stable")', byId['ceterms:NoStatus'] && byId['ceterms:NoStatus'].properties.status, '');
	harness.ok('parser: foreign schema:QuantitativeValue NOT emitted', !byId['schema:QuantitativeValue']);
	harness.ok('parser: foreign ceasn:hasChild NOT emitted', !byId['ceasn:hasChild']);
	const vtRefs = (byId['ceterms:ValueThing'] && byId['ceterms:ValueThing'].properties._crossRefs) || [];
	harness.ok('parser: subClassOf schema:QuantitativeValue -> qdata crossRef', vtRefs.some((cr) => cr.system === 'qdata' && cr.id === 'schema:QuantitativeValue'));
	harness.ok('parser: subClassOf schema:CreativeWork (upper-ontology) -> dropped (no crossRef)', !vtRefs.some((cr) => cr.id === 'schema:CreativeWork'));
	const paRefs = (byId['ceterms:pointsToAsn'] && byId['ceterms:pointsToAsn'].properties._crossRefs) || [];
	harness.ok('parser: rangeIncludes ceasn:Competency -> ctdlasn crossRef', paRefs.some((cr) => cr.system === 'ctdlasn' && cr.id === 'ceasn:Competency'));
	harness.ok('parser: rangeIncludes xsd:string (datatype) -> dropped (no crossRef)', !paRefs.some((cr) => cr.id === 'xsd:string'));
	harness.equal('parser: 3 native classes emitted (foreign schema class filtered)', parsed.metadata.classCount, 3);
	harness.equal('parser: 1 native property emitted (foreign ceasn prop filtered)', parsed.metadata.propertyCount, 1);
	harness.ok('parser: filteredCrossStandardCount === 2, filteredUnknownCount === 0', parsed.metadata.filteredCrossStandardCount === 2 && parsed.metadata.filteredUnknownCount === 0);
});

try {
	fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (cleanupErr) {
	harness.note(`temp cleanup skipped: ${cleanupErr.message}`);
}

// =====================================================================
harness.section('REAL DATA + FAITHFULNESS — forge over the bundled CTDL asset == incumbent output');
// =====================================================================
// The port is FAITHFUL iff the ported bundle reproduces the incumbent's real-data counts EXACTLY.
// The incumbent (cli/parserLib/forge-ctdl, code fact captured 2026-07-24) produced:
//   nodes 994  edges 10128
//   role  { DmeStandardRoot:1, DmeClass:136, DmeProperty:378, DmeOptionSet:34, DmeOptionValue:445 }
//   edge  { HAS_CLASS:136, SUBCLASS_OF:82, HAS_PROPERTY:7085, HAS_OPTION_SET:41, REFERENCES:2339, HAS_VALUE:445 }
//   stats { cedsAnnotatedConcepts:26, crossRefTotal:135, crossRefBySystem:{qdata:39, ctdlasn:96},
//           propertyOptionSetEdges:41, orphanAnchoredOptionSets:0, subClassOfEdges:82, referencesEdges:2339 }
// 994 is the golden's CTDL node figure. These are LOCKED below.

const INCUMBENT = {
	nodes: 994,
	edges: 10128,
	role: { DmeStandardRoot: 1, DmeClass: 136, DmeProperty: 378, DmeOptionSet: 34, DmeOptionValue: 445 },
	edge: { HAS_CLASS: 136, SUBCLASS_OF: 82, HAS_PROPERTY: 7085, HAS_OPTION_SET: 41, REFERENCES: 2339, HAS_VALUE: 445 },
	stats: { cedsAnnotatedConcepts: 26, crossRefTotal: 135, qdata: 39, ctdlasn: 96, propertyOptionSetEdges: 41, orphanAnchoredOptionSets: 0, subClassOfEdges: 82, referencesEdges: 2339 },
};

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
	harness.equal('FAITHFUL: total nodes === incumbent 994 (== golden CTDL)', nodes.length, INCUMBENT.nodes);
	harness.equal('FAITHFUL: total edges === incumbent 10128', edges.length, INCUMBENT.edges);
	Object.keys(INCUMBENT.role).forEach((role) => {
		harness.equal(`FAITHFUL: role ${role} === ${INCUMBENT.role[role]}`, roleCount[role], INCUMBENT.role[role]);
	});
	Object.keys(INCUMBENT.edge).forEach((type) => {
		harness.equal(`FAITHFUL: edge ${type} === ${INCUMBENT.edge[type]}`, edgeCount[type], INCUMBENT.edge[type]);
	});
	harness.equal('FAITHFUL: no extra edge types beyond the incumbent set', Object.keys(edgeCount).sort().join(','), Object.keys(INCUMBENT.edge).sort().join(','));

	// ---- FAITHFULNESS: the bridge-stash stats match the incumbent ----
	harness.equal('FAITHFUL: cedsAnnotatedConcepts === 26', result.stats.cedsAnnotatedConcepts, INCUMBENT.stats.cedsAnnotatedConcepts);
	harness.equal('FAITHFUL: crossRefTotal === 135', result.stats.crossRefTotal, INCUMBENT.stats.crossRefTotal);
	harness.equal('FAITHFUL: crossRefBySystem.qdata === 39', result.stats.crossRefBySystem.qdata, INCUMBENT.stats.qdata);
	harness.equal('FAITHFUL: crossRefBySystem.ctdlasn === 96', result.stats.crossRefBySystem.ctdlasn, INCUMBENT.stats.ctdlasn);
	harness.equal('FAITHFUL: propertyOptionSetEdges === 41', result.stats.propertyOptionSetEdges, INCUMBENT.stats.propertyOptionSetEdges);
	harness.equal('FAITHFUL: orphanAnchoredOptionSets === 0', result.stats.orphanAnchoredOptionSets, INCUMBENT.stats.orphanAnchoredOptionSets);
	harness.equal('FAITHFUL: subClassOfEdges === 82', result.stats.subClassOfEdges, INCUMBENT.stats.subClassOfEdges);
	harness.equal('FAITHFUL: referencesEdges === 2339', result.stats.referencesEdges, INCUMBENT.stats.referencesEdges);

	// ---- CONTRACT INTEGRITY over the real data ----
	harness.ok('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	harness.ok('real: every node _source === CTDL', nodes.every((n) => n.properties._source === 'CTDL'));
	harness.ok('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	harness.ok('real: every node carries uri === stableId', nodes.every((n) => n.properties.uri === n.stableId));
	harness.ok('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	harness.ok('real: every annotated concept cedsId canonical', nodes.filter((n) => n.properties.cedsId).every((n) => normalize.isCanonicalCrossRefCedsId(n.properties.cedsId)));
	harness.ok('real: only canonical/REFERENCES/SUBCLASS_OF edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	harness.ok('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	harness.ok('real: standard-pure (every edge endpoint _source CTDL)', edges.every((e) => e.fromRef.source === 'CTDL' && e.toRef.source === 'CTDL'));
	harness.ok('real: every DmeOptionSet reachable via HAS_OPTION_SET', nodes.filter((n) => n.role === 'DmeOptionSet').every((osNode) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === osNode.stableId)));
	harness.ok('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	// ---- STANDARD-PURITY: zero foreign nodes; the closed 20-node leak stays closed ----
	const NATIVE_CORE = new Set(['ceterms', 'accommodation', 'actionStat', 'agentSector', 'agreementCat', 'alignment', 'array', 'assessMethod', 'assessUse', 'audLevel', 'audience', 'claimType', 'collectionCategory', 'compare', 'costType', 'credentialStat', 'creditUnit', 'deliveryType', 'financialAid', 'inputType', 'learnMethod', 'lifeCycle', 'logic', 'lrEvidence', 'lrMethod', 'lrOutcome', 'lrSource', 'orgType', 'residency', 'scheduleFrequency', 'scheduleTiming', 'score', 'serviceType', 'statementCat', 'support']);
	const prefixOf = (id) => `${id}`.split(':')[0];
	const nonRootNodes = nodes.filter((n) => n.stableId !== 'ctdl:root');
	harness.ok('real: STANDARD-PURE — every emitted node prefix is native core (0 foreign nodes)', nonRootNodes.every((n) => NATIVE_CORE.has(prefixOf(n.stableId))));
	const idSet = new Set(nodes.map((n) => n.stableId));
	const LEAK_URIS = ['schema:MonetaryAmount', 'schema:QuantitativeValue', 'schema:description', 'schema:maxValue', 'schema:minValue', 'schema:subjectOf', 'schema:unitText', 'schema:value', 'ceasn:abilityEmbodied', 'ceasn:hasChild', 'ceasn:isChildOf', 'qdata:dataProvider', 'qdata:percentage', 'qdata:relevantDataSet', 'owl:sameAs'];
	harness.ok('real: leak closed — no foreign schema/ceasn/qdata/owl @graph node emitted', LEAK_URIS.every((u) => !idSet.has(u)));

	// ---- FILTER-AND-REFERENCE: foreign structural references survive as crossRefs (bridge material) ----
	const crossRefSystems = {};
	let crossRefTotal = 0;
	nodes.forEach((n) => {
		JSON.parse(n.properties.crossRefs || '[]').forEach((cr) => {
			crossRefSystems[cr.system] = (crossRefSystems[cr.system] || 0) + 1;
			crossRefTotal++;
		});
	});
	harness.ok('real: crossRefs carry ctdlasn refs (ceasn/asn -> ctdlasn)', crossRefSystems.ctdlasn > 0);
	harness.ok('real: crossRefs carry qdata refs (qdata + shared schema: classes -> qdata)', crossRefSystems.qdata > 0);
	harness.ok('real: every crossRef system is ceds|ctdlasn|qdata (no other/foreign)', Object.keys(crossRefSystems).every((s) => ['ceds', 'ctdlasn', 'qdata'].includes(s)));
	harness.equal('real: crossRefBySystem stat matches counted crossRefs', result.stats.crossRefTotal, crossRefTotal - (crossRefSystems.ceds || 0));

	harness.report();
});
