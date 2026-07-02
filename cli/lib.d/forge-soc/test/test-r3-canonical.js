#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the SOC forge. ALL PURE: no Voyage embedding call, no Neo4j,
// no golden touch — it exercises normalize + buildContractGraph (and forge() with skipEmbedding=true
// over the REAL SOC assets) and asserts that, whatever the native SOC input form, the emitted node's
// stableId conforms to a clean canonical form BEFORE emission, searchText is non-empty, edges are
// canonical (incl. SUBCLASS_OF) + fully resolved, the block is standard-pure SOC (_source='SOC', no
// cross-standard edges; the CIP crosswalk is a stashed property, not an edge), and shaping is
// deterministic.
//
// Run: node cli/lib.d/forge-soc/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeSoc')({ embedder: null });

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

check('buildStableId root -> soc:root', normalize.buildStableId({ kind: 'root' }).stableId === 'soc:root');
check(
	'buildStableId group -> soc:group/<code>',
	normalize.buildStableId({ kind: 'group', key: '11-0000' }).stableId === 'soc:group/11-0000',
);
check(
	'buildStableId occupation keeps onet-soc code',
	normalize.buildStableId({ kind: 'occupation', key: '11-1011.00' }).stableId === 'soc:occupation/11-1011.00',
);
check(
	'buildStableId optionValue keeps jobZone.<n> key',
	normalize.buildStableId({ kind: 'optionValue', key: 'jobZone.5' }).stableId === 'soc:value/jobZone.5',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'group', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts soc:root', normalize.isCleanStableId('soc:root'));
check('isCleanStableId accepts soc:occupation/11-1011.00', normalize.isCleanStableId('soc:occupation/11-1011.00'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-soc', !normalize.isCleanStableId('ceds:C000113'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' soc:root '));

// SOC base-code derivation + group ancestry.
check("toSocBaseCode('11-1011.00') -> 11-1011", normalize.toSocBaseCode('11-1011.00') === '11-1011');
check("toSocBaseCode('11-1011') -> 11-1011", normalize.toSocBaseCode('11-1011') === '11-1011');
const chain = normalize.socGroupCodesForBaseCode('11-1011');
check('socGroupCodesForBaseCode 11-1011 -> [11-0000, 11-1000, 11-1011]', JSON.stringify(chain) === JSON.stringify(['11-0000', '11-1000', '11-1011']));
check('socGroupCodesForBaseCode malformed -> []', normalize.socGroupCodesForBaseCode('bogus').length === 0);

// CIP normalization (cross-standard stash, never a SOC resolver).
check("normalizeCipCode('01.0000') -> 01.0000", normalize.normalizeCipCode({ rawValue: '01.0000' }).cipCode === '01.0000');
check("normalizeCipCode('') -> absent", !!normalize.normalizeCipCode({ rawValue: '' }).absent);

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: 'O*NET-SOC 2019',
		sourceFormat: 'csv',
		occupationCount: 1,
		groupCount: 3,
		jobZoneCount: 2,
	},
	nodes: [
		{ id: 'soc-root', label: 'SocRoot', properties: { name: 'SOC', description: 'SOC root' }, edges: [] },
		// taxonomy: major <- minor <- broad
		{ id: 'soc-group-11-0000', label: 'SocGroup', properties: { name: '11-0000', socCode: '11-0000', socLevel: 'majorGroup', description: 'major' }, edges: [] },
		{ id: 'soc-group-11-1000', label: 'SocGroup', properties: { name: '11-1000', socCode: '11-1000', socLevel: 'minorGroup', description: 'minor' }, edges: [{ type: 'SUBCLASS_OF', targetId: 'soc-group-11-0000', targetLabel: 'SocGroup' }] },
		{ id: 'soc-group-11-1011', label: 'SocGroup', properties: { name: '11-1011', socCode: '11-1011', socLevel: 'broadOccupation', description: 'broad' }, edges: [{ type: 'SUBCLASS_OF', targetId: 'soc-group-11-1000', targetLabel: 'SocGroup' }] },
		// the Job Zone option set + 2 values
		{ id: 'soc-jobzoneset', label: 'SocJobZoneSet', properties: { name: 'Job Zone', valueCount: 2, description: 'job zone set' }, edges: [] },
		{ id: 'soc-jobzone-4', label: 'SocJobZone', properties: { name: '4', zoneNumber: 4, zoneName: 'Job Zone 4', education: "bachelor's", description: 'zone 4' }, edges: [], _parentEdge: { type: 'HAS_VALUE', fromId: 'soc-jobzoneset', fromLabel: 'SocJobZoneSet' } },
		{ id: 'soc-jobzone-5', label: 'SocJobZone', properties: { name: '5', zoneNumber: 5, zoneName: 'Job Zone 5', education: 'graduate', description: 'zone 5' }, edges: [], _parentEdge: { type: 'HAS_VALUE', fromId: 'soc-jobzoneset', fromLabel: 'SocJobZoneSet' } },
		// the synthetic jobZone property, owns the option set
		{ id: 'soc-property-jobZone', label: 'SocJobZoneProperty', properties: { name: 'jobZone', description: 'job zone property' }, edges: [{ type: 'CONSTRAINED_BY', targetId: 'soc-jobzoneset', targetLabel: 'SocJobZoneSet' }] },
		// a detailed occupation, SUBCLASS_OF the broad group, with CIP bridge stash + alt titles + zone
		{
			id: 'soc-occupation-11-1011.00',
			label: 'SocOccupation',
			properties: {
				name: 'Chief Executives',
				socCode: '11-1011.00',
				socBaseCode: '11-1011',
				jobZone: 5,
				alternateTitles: ['CEO', 'President'],
				cipMappings: ['52.0201', '44.0401'],
				description: 'top execs',
			},
			edges: [{ type: 'SUBCLASS_OF', targetId: 'soc-group-11-1011', targetLabel: 'SocGroup' }],
			_parentEdge: { type: 'HAS_OCCUPATION', fromId: 'soc-root', fromLabel: 'SocRoot' },
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('three DmeClass (1 occupation + 2... actually 3 groups + 1 occupation = 4)', byRole('DmeClass').length === 4);
check('one DmeProperty (jobZone)', byRole('DmeProperty').length === 1);
check('one DmeOptionSet (Job Zone)', byRole('DmeOptionSet').length === 1);
check('two DmeOptionValue (job zones)', byRole('DmeOptionValue').length === 2);
check('zero DmeSupport (SOC has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === SOC', g.nodes.every((n) => n.properties._source === 'SOC'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries socStableId === stableId', g.nodes.every((n) => n.properties.socStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

// the occupation carries CIP bridge stash (cipMappings + crossRefs); NO cross-standard edge.
const occ = g.nodes.find((n) => n.stableId === 'soc:occupation/11-1011.00');
check('occupation cipMappings stashed', occ && Array.isArray(occ.properties.cipMappings) && occ.properties.cipMappings.length === 2);
check('occupation crossRefs JSON carries the cip refs', occ && JSON.parse(occ.properties.crossRefs).length === 2);
check('occupation crossRefs system === cip', occ && JSON.parse(occ.properties.crossRefs)[0].system === 'cip');
check('occupation alternateTitles stashed', occ && Array.isArray(occ.properties.alternateTitles) && occ.properties.alternateTitles.length === 2);
check('occupation jobZone scalar stashed', occ && occ.properties.jobZone === 5);
check('occupation parentId === broad group (taxonomy parent)', occ && occ.properties.parentId === 'soc:group/11-1011');

// edges: only canonical/REFERENCES + SUBCLASS_OF types, all structural, all resolved (no throw = no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical/SUBCLASS_OF/REFERENCES edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === SOC (standard-pure, no cross-standard)', g.edges.every((e) => e.fromRef.source === 'SOC' && e.toRef.source === 'SOC'));
check('NO cip cross-standard edge', !g.edges.some((e) => e.toRef.id && `${e.toRef.id}`.startsWith('cip:')));
check('HAS_CLASS root->occupation present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'soc:root' && e.toRef.id === 'soc:occupation/11-1011.00'));
check('HAS_CLASS root->group present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'soc:root' && e.toRef.id === 'soc:group/11-0000'));
check('HAS_PROPERTY root->jobZone property present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'soc:root' && e.toRef.id === 'soc:property/jobZone'));
// SIF-canonical: the jobZone property (DmeProperty) OWNS the Job Zone option set via HAS_OPTION_SET.
check('HAS_OPTION_SET property->optionSet present (property owns option set)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'soc:property/jobZone' && e.toRef.id === 'soc:optionset/Job Zone'));
check('NO blanket root->optionSet HAS_OPTION_SET (option set is property-owned)', !g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'soc:root'));
check('HAS_VALUE optionSet->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'soc:optionset/Job Zone' && e.toRef.id === 'soc:value/jobZone.5'));
check('SUBCLASS_OF occupation->broad group present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'soc:occupation/11-1011.00' && e.toRef.id === 'soc:group/11-1011'));
check('SUBCLASS_OF minor->major group present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'soc:group/11-1000' && e.toRef.id === 'soc:group/11-0000'));
check('major group has NO SUBCLASS_OF (top of taxonomy)', !g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'soc:group/11-0000'));

check('stats.subclassEdges === 3 (2 group + 1 occupation)', g.stats.subclassEdges === 3);
check('stats.optionValuesEmitted === 2', g.stats.optionValuesEmitted === 2);
check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.occupationsAnnotatedWithCip === 1', g.stats.occupationsAnnotatedWithCip === 1);
check('stats.orphanAnchoredOptionSets === 0 (Job Zone set is property-constrained)', g.stats.orphanAnchoredOptionSets === 0);
check('every DmeOptionSet has exactly one incoming HAS_OPTION_SET', byRole('DmeOptionSet').every((os) => g.edges.filter((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId).length === 1));
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// an unknown native label MUST throw (R3 — never silently dropped).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.push({ id: 'bogus', label: 'SocBogus', properties: { name: 'x' }, edges: [] });
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unknown native SOC label throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual SOC assets.
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
	check('real: every node _source === SOC', nodes.every((n) => n.properties._source === 'SOC'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries socStableId', nodes.every((n) => n.properties.socStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: only canonical/SUBCLASS_OF/REFERENCES edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source SOC)', edges.every((e) => e.fromRef.source === 'SOC' && e.toRef.source === 'SOC'));
	check('real: every DmeOptionSet reachable (1+ incoming HAS_OPTION_SET)', nodes.filter((n) => n.role === 'DmeOptionSet').every((os) => edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === os.stableId)));
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== SOC REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		subclassEdges: result.stats.subclassEdges,
		propertyOptionSetEdges: result.stats.propertyOptionSetEdges,
		optionValuesEmitted: result.stats.optionValuesEmitted,
		occupationsAnnotatedWithCip: result.stats.occupationsAnnotatedWithCip,
		totalCipCrossRefs: result.stats.totalCipCrossRefs,
		orphanAnchoredOptionSets: result.stats.orphanAnchoredOptionSets,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
