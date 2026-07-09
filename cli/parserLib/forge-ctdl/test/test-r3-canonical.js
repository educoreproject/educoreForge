#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the CTDL forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL CTDL JSON-LD asset) and asserts that, whatever the native CTDL
// input form, the emitted node's stableId (the native CURIE) + canonical CEDS cross-ref conform to
// clean canonical forms BEFORE emission, searchText is non-empty, edges are canonical + fully
// resolved (no danglers), the block is standard-pure CTDL (_source='CTDL', no cross-standard edges),
// and the shaping is deterministic.
//
// Run: node cli/lib.d/forge-ctdl/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeCtdl')({ embedder: null });

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

check('buildStableId CURIE -> same CURIE', normalize.buildStableId({ id: 'ceterms:AcademicCertificate' }).stableId === 'ceterms:AcademicCertificate');
check('buildStableId trims', normalize.buildStableId({ id: '  ceasn:abilityEmbodied  ' }).stableId === 'ceasn:abilityEmbodied');
check('buildStableId empty -> error', !!normalize.buildStableId({ id: '   ' }).error);
check('buildStableId null -> error', !!normalize.buildStableId({ id: null }).error);

check('isCleanStableId accepts a CURIE', normalize.isCleanStableId('ceterms:AcademicCertificate'));
check('isCleanStableId accepts a fragment CURIE', normalize.isCleanStableId('accommodation:AccessibleHousing'));
check('isCleanStableId accepts http URI', normalize.isCleanStableId('https://credreg.net/ctdl/terms/x'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects bare token (no colon)', !normalize.isCleanStableId('AcademicCertificate'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' ceterms:X '));

// CEDS cross-ref canonicalization: the CTDL form `ceds:000113#fragment` -> canonical OS000113.
check("normalizeCedsCrossRef('ceds:000113#Assistantships') -> OS000113", normalize.normalizeCedsCrossRef({ rawValue: 'ceds:000113#Assistantships' }).cedsId === 'OS000113');
check("normalizeCedsCrossRef carries fragment", normalize.normalizeCedsCrossRef({ rawValue: 'ceds:000113#Assistantships' }).fragment === 'Assistantships');
check("normalizeCedsCrossRef('ceds:001610#DODTuitionAssistance') -> OS001610", normalize.normalizeCedsCrossRef({ rawValue: 'ceds:001610#DODTuitionAssistance' }).cedsId === 'OS001610');
check("normalizeCedsCrossRef('ceds:000113') no fragment -> OS000113", normalize.normalizeCedsCrossRef({ rawValue: 'ceds:000113' }).cedsId === 'OS000113');
check("normalizeCedsCrossRef('') -> absent", !!normalize.normalizeCedsCrossRef({ rawValue: '' }).absent);
check("normalizeCedsCrossRef('no-digits') -> error", !!normalize.normalizeCedsCrossRef({ rawValue: 'ceds:nodigits' }).error);
check('isCanonicalCrossRefCedsId(OS000113)', normalize.isCanonicalCrossRefCedsId('OS000113'));
check('isCanonicalCrossRefCedsId rejects 000113', !normalize.isCanonicalCrossRefCedsId('000113'));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
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

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('two DmeClass', byRole('DmeClass').length === 2);
check('two DmeProperty', byRole('DmeProperty').length === 2);
check('two DmeOptionSet (concept schemes)', byRole('DmeOptionSet').length === 2);
check('two DmeOptionValue (concepts)', byRole('DmeOptionValue').length === 2);
check('zero DmeSupport (CTDL has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === CTDL', g.nodes.every((n) => n.properties._source === 'CTDL'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id deterministic from stableId', g.nodes.every((n) => n.properties._id === `ctdl|${n.stableId}`));
check('every node carries uri === stableId', g.nodes.every((n) => n.properties.uri === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
check('stableIds unique', new Set(g.nodes.map((n) => n.stableId)).size === g.nodes.length);

// the annotated concept carries canonical cedsId + crossRefs (bridge stash); the plain one does not.
const annotated = g.nodes.find((n) => n.stableId === 'financialAid:FederalGrant');
const plain = g.nodes.find((n) => n.stableId === 'credentialStat:Active');
check('annotated concept cedsId === OS000113', annotated && annotated.properties.cedsId === 'OS000113');
check('annotated concept cedsId is canonical', annotated && normalize.isCanonicalCrossRefCedsId(annotated.properties.cedsId));
check('annotated concept crossRefs JSON carries the ceds ref', annotated && JSON.parse(annotated.properties.crossRefs)[0].id === 'OS000113');
check('annotated concept crossRefs retains raw form', annotated && JSON.parse(annotated.properties.crossRefs)[0].raw === 'ceds:000113#OtherFederalGrants');
check('plain concept has no cedsId', plain && plain.properties.cedsId === undefined);
check('plain concept crossRefs === []', plain && plain.properties.crossRefs === '[]');
check('DmeProperty searchText carries owning class name', g.nodes.find((n) => n.stableId === 'ceterms:credentialStatusType').properties.searchText.includes('Academic Certificate'));

// edges: only canonical/REFERENCES/SUBCLASS_OF types, all structural, all resolved (no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === CTDL (standard-pure)', g.edges.every((e) => e.fromRef.source === 'CTDL' && e.toRef.source === 'CTDL'));
check('HAS_CLASS root->class present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'ctdl:root' && e.toRef.id === 'ceterms:AcademicCertificate'));
check('HAS_PROPERTY class->property present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ceterms:AcademicCertificate' && e.toRef.id === 'ceterms:credentialStatusType'));
check('SHARED property has 2nd HAS_PROPERTY from extra domain', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'ceterms:Certificate' && e.toRef.id === 'ceterms:credentialStatusType'));
// SIF-canonical: the property OWNS its concept scheme via HAS_OPTION_SET.
check('HAS_OPTION_SET property->scheme present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ceterms:credentialStatusType' && e.toRef.id === 'ceterms:CredentialStatus'));
check('NO blanket root->scheme HAS_OPTION_SET for the constrained scheme', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdl:root' && e.toRef.id === 'ceterms:CredentialStatus'));
check('NO property->scheme REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'ceterms:CredentialStatus'));
check('REFERENCES property->class present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'ceterms:offeredBy' && e.toRef.id === 'ceterms:Certificate'));
check('SUBCLASS_OF class->class present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'ceterms:AcademicCertificate' && e.toRef.id === 'ceterms:Certificate'));
check('HAS_VALUE scheme->concept present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'ceterms:CredentialStatus' && e.toRef.id === 'credentialStat:Active'));

check('stats.cedsAnnotatedConcepts === 1', g.stats.cedsAnnotatedConcepts === 1);
check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.referencesEdges === 1', g.stats.referencesEdges === 1);
check('stats.subClassOfEdges === 1', g.stats.subClassOfEdges === 1);
check('stats.orphanAnchoredOptionSets === 1 (the orphan scheme)', g.stats.orphanAnchoredOptionSets === 1);
check('orphan scheme anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'ctdl:root' && e.toRef.id === 'ceterms:Accommodation'));
check('every DmeOptionSet has >=1 incoming HAS_OPTION_SET (none unreachable)', byRole('DmeOptionSet').every((os) => g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
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
badParsed.nodes.find((n) => n.id === 'financialAid:FederalGrant').properties._cedsAnchors = ['ceds:no-digits-here'];
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unnormalizable CEDS anchor throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual CTDL JSON-LD asset.
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
	check('real: 138 DmeClass', roleCount.DmeClass === 138);
	check('real: 396 DmeProperty', roleCount.DmeProperty === 396);
	check('real: 34 DmeOptionSet', roleCount.DmeOptionSet === 34);
	check('real: 445 DmeOptionValue', roleCount.DmeOptionValue === 445);
	check('real: total 1014 nodes', nodes.length === 1014);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === CTDL', nodes.every((n) => n.properties._source === 'CTDL'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries uri === stableId', nodes.every((n) => n.properties.uri === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: every annotated concept cedsId canonical', nodes.filter((n) => n.properties.cedsId).every((n) => normalize.isCanonicalCrossRefCedsId(n.properties.cedsId)));
	check('real: only canonical/REFERENCES/SUBCLASS_OF edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source CTDL)', edges.every((e) => e.fromRef.source === 'CTDL' && e.toRef.source === 'CTDL'));
	check('real: every DmeOptionSet reachable via HAS_OPTION_SET', nodes.filter((n) => n.role === 'DmeOptionSet').every((os) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== CTDL REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		cedsAnnotatedConcepts: result.stats.cedsAnnotatedConcepts,
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
