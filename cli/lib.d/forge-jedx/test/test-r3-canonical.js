#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the JEDx forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL CSV assets) and asserts that, whatever the native JEDx input
// form, the emitted node's stableId conforms to a clean canonical form BEFORE emission, searchText is
// non-empty, edges are canonical + fully resolved, the block is standard-pure JEDx (_source='JEDx',
// no cross-standard edges), and the shaping is deterministic.
//
// Run: node cli/lib.d/forge-jedx/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeJedx')({ embedder: null });

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

check('buildStableId root -> jedx:root', normalize.buildStableId({ kind: 'root' }).stableId === 'jedx:root');
check(
	'buildStableId entity -> jedx:entity/<name>',
	normalize.buildStableId({ kind: 'entity', key: 'organization' }).stableId === 'jedx:entity/organization',
);
check(
	'buildStableId field keeps the dotted path key',
	normalize.buildStableId({ kind: 'field', key: 'worker.physicalAddresses[].countryCode' }).stableId ===
		'jedx:field/worker.physicalAddresses[].countryCode',
);
check(
	'buildStableId codeset keeps a URL-bearing raw key',
	normalize.buildStableId({ kind: 'codeset', key: 'https://www.census.gov/naics/?58967?yearbck=2022' }).stableId ===
		'jedx:codeset/https://www.census.gov/naics/?58967?yearbck=2022',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'entity', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts jedx:root', normalize.isCleanStableId('jedx:root'));
check('isCleanStableId accepts jedx:field/<path>', normalize.isCleanStableId('jedx:field/A.B'));
check('isCleanStableId accepts a URL-bearing codeset id', normalize.isCleanStableId('jedx:codeset/https://x.y/z'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-jedx', !normalize.isCleanStableId('edfi:entity/X'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' jedx:root '));

// CEDS cross-ref canonicalization kept for parity (JEDx data carries none, but the contract holds).
check("normalizeCedsCrossRef('369') -> P000369", normalize.normalizeCedsCrossRef({ rawValue: '369' }).cedsId === 'P000369');
check("normalizeCedsCrossRef('000000') -> absent (sentinel)", !!normalize.normalizeCedsCrossRef({ rawValue: '000000' }).absent);
check("normalizeCedsCrossRef('') -> absent", !!normalize.normalizeCedsCrossRef({ rawValue: '' }).absent);
check("normalizeCedsCrossRef('no-digits') -> error", !!normalize.normalizeCedsCrossRef({ rawValue: 'no-digits' }).error);
check('isCanonicalCrossRefCedsId(P000369)', normalize.isCanonicalCrossRefCedsId('P000369'));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: '1.0',
		sourceFormat: 'csv',
		entityCount: 2,
		fieldCount: 3,
		codesetCount: 2,
	},
	nodes: [
		{ id: 'jedx-root', label: 'JedxRoot', properties: { name: 'JEDx' }, edges: [] },
		{
			id: 'jedxentity-organization',
			label: 'JedxEntity',
			properties: { name: 'organization', sourceFile: 'organization-Table 1.csv', fieldCount: 1, fkCount: 0, hasPk: true },
			edges: [],
		},
		{
			id: 'jedxentity-worker',
			label: 'JedxEntity',
			properties: { name: 'worker', sourceFile: 'worker-Table 1.csv', fieldCount: 2, fkCount: 1, hasPk: true },
			// a genuine entity -> entity FK reference (stays REFERENCES).
			edges: [{ type: 'REFERENCES', targetId: 'jedxentity-organization', targetLabel: 'JedxEntity', properties: { via: 'organizationRefId' } }],
		},
		{
			id: 'jedxfield-organization.countryCode',
			label: 'JedxField',
			properties: { name: 'countryCode', entityName: 'organization', elementType: 'string', fieldPath: 'organization.countryCode', codeSet: 'US', isPrimaryKey: false, isForeignKey: false, description: 'two-letter code' },
			// a code-set constraint (field -> codeset) => HAS_OPTION_SET (property owns option set).
			edges: [{ type: 'CONSTRAINED_BY', targetId: 'jedxcodeset-US', targetLabel: 'JedxCodeSet' }],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'jedxentity-organization', fromLabel: 'JedxEntity' },
		},
		{
			id: 'jedxfield-worker.RefId',
			label: 'JedxField',
			properties: { name: 'RefId', entityName: 'worker', elementType: 'string', fieldPath: 'worker.RefId', isPrimaryKey: true, isForeignKey: false, description: 'pk' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'jedxentity-worker', fromLabel: 'JedxEntity' },
		},
		{
			id: 'jedxfield-worker.organizationRefId',
			label: 'JedxField',
			properties: { name: 'organizationRefId', entityName: 'worker', elementType: 'string', fieldPath: 'worker.organizationRefId', isPrimaryKey: false, isForeignKey: true, description: 'fk' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'jedxentity-worker', fromLabel: 'JedxEntity' },
		},
		// the field-owned code set (constrained by organization.countryCode).
		{
			id: 'jedxcodeset-US',
			label: 'JedxCodeSet',
			properties: { name: 'US', value: 'US', usedByFieldCount: 1 },
			edges: [],
		},
		// an ORPHAN code set: no field constrains it -> must get a root->orphan HAS_OPTION_SET anchor.
		{
			id: 'jedxcodeset-OrphanSet',
			label: 'JedxCodeSet',
			properties: { name: 'OrphanSet', value: 'OrphanSet', usedByFieldCount: 0 },
			edges: [],
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('two DmeClass (entities)', byRole('DmeClass').length === 2);
check('three DmeProperty (fields)', byRole('DmeProperty').length === 3);
check('two DmeOptionSet (codesets: one field-owned, one orphan)', byRole('DmeOptionSet').length === 2);
check('zero DmeOptionValue (JEDx code sets have no enumerated values)', byRole('DmeOptionValue').length === 0);
check('zero DmeSupport (JEDx has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === JEDx', g.nodes.every((n) => n.properties._source === 'JEDx'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries jedxStableId === stableId', g.nodes.every((n) => n.properties.jedxStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
check('every structural node crossRefs === [] (JEDx carries no CEDS columns)', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.crossRefs === '[]'));
check('no node carries a cedsId (CEDS-pure)', g.nodes.every((n) => n.properties.cedsId === undefined));
check('DmeProperty searchText carries owning class name', g.nodes.find((n) => n.stableId === 'jedx:field/organization.countryCode').properties.searchText.includes('organization'));

// edges: only canonical/REFERENCES types, all structural, all resolved (no throw means no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'REFERENCES']);
check('only canonical/REFERENCES edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === JEDx (standard-pure, no cross-standard)', g.edges.every((e) => e.fromRef.source === 'JEDx' && e.toRef.source === 'JEDx'));
check('HAS_CLASS root->entity present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'jedx:root' && e.toRef.id === 'jedx:entity/organization'));
check('HAS_PROPERTY entity->field present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'jedx:entity/organization' && e.toRef.id === 'jedx:field/organization.countryCode'));
// canonical: the field (DmeProperty) OWNS its code set (DmeOptionSet) via HAS_OPTION_SET.
check('HAS_OPTION_SET field->codeset present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'jedx:field/organization.countryCode' && e.toRef.id === 'jedx:codeset/US'));
check('NO blanket root->codeset HAS_OPTION_SET for the field-owned set', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'jedx:root' && e.toRef.id === 'jedx:codeset/US'));
check('NO field->codeset REFERENCES (moved to HAS_OPTION_SET)', !g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'jedx:field/organization.countryCode'));
// genuine entity->entity FK stays REFERENCES.
check('REFERENCES entity->entity present (FK kept as REFERENCES)', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'jedx:entity/worker' && e.toRef.id === 'jedx:entity/organization'));

check('stats.fieldOptionSetEdges === 1', g.stats.fieldOptionSetEdges === 1);
check('stats.entityReferences === 1', g.stats.entityReferences === 1);
check('stats.orphanAnchoredCodeSets === 1 (the orphan code set)', g.stats.orphanAnchoredCodeSets === 1);
check('orphan code set anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'jedx:root' && e.toRef.id === 'jedx:codeset/OrphanSet'));
check('field-constrained code set NOT anchored from root', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'jedx:root' && e.toRef.id === 'jedx:codeset/US'));
check('every DmeOptionSet has exactly one incoming HAS_OPTION_SET (owned, no double-ownership)', byRole('DmeOptionSet').every((os) => g.edges.filter((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId).length === 1));
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// an empty natural key (unforgeable stableId) MUST throw (R3 — never silently dropped).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.find((n) => n.id === 'jedxentity-organization').properties.name = '   ';
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('empty entity natural key throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual JEDx CSV assets.
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
	check('real: zero DmeOptionValue (no enumerated values in JEDx source)', (roleCount.DmeOptionValue || 0) === 0);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === JEDx', nodes.every((n) => n.properties._source === 'JEDx'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries jedxStableId', nodes.every((n) => n.properties.jedxStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: only canonical/REFERENCES edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source JEDx)', edges.every((e) => e.fromRef.source === 'JEDx' && e.toRef.source === 'JEDx'));
	check('real: CEDS-pure (no node carries a cedsId)', nodes.every((n) => n.properties.cedsId === undefined));
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));
	check('real: every HAS_OPTION_SET originates from a DmeProperty or the root (orphan)', (() => {
		const byId = {}; nodes.forEach((n) => { byId[n.stableId] = n; });
		return edges.filter((e) => e.type === 'HAS_OPTION_SET').every((e) => {
			const from = byId[e.fromRef.id];
			return from && (from.role === 'DmeProperty' || from.role === 'DmeStandardRoot');
		});
	})());

	console.log('\n=== JEDx REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		fieldOptionSetEdges: result.stats.fieldOptionSetEdges,
		entityReferences: result.stats.entityReferences,
		orphanAnchoredCodeSets: result.stats.orphanAnchoredCodeSets,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
