#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — R3/R4 gate for the CIP forge. ALL PURE: no Voyage embedding call, no
// Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL CIP CSV asset) and asserts that, whatever the native CIP input
// form, the emitted node's stableId conforms to a clean canonical form BEFORE emission, searchText is
// non-empty, edges are canonical + fully resolved, the block is standard-pure CIP (_source='CIP', no
// cross-standard edges), the class hierarchy is SUBCLASS_OF child->parent, and shaping is deterministic.
//
// Run: node cli/lib.d/forge-cip/test/test-r3-canonical.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeCip')({ embedder: null });

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

check('buildStableId root -> cip:root', normalize.buildStableId({ kind: 'root' }).stableId === 'cip:root');
check(
	'buildStableId domain -> cip:domain/<code>',
	normalize.buildStableId({ kind: 'domain', key: '01' }).stableId === 'cip:domain/01',
);
check(
	'buildStableId subdomain keeps the 4-digit code',
	normalize.buildStableId({ kind: 'subdomain', key: '01.01' }).stableId === 'cip:subdomain/01.01',
);
check(
	'buildStableId program keeps the 6-digit code',
	normalize.buildStableId({ kind: 'program', key: '01.0101' }).stableId === 'cip:program/01.0101',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'domain', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts cip:root', normalize.isCleanStableId('cip:root'));
check('isCleanStableId accepts cip:program/01.0101', normalize.isCleanStableId('cip:program/01.0101'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-cip', !normalize.isCleanStableId('edfi:entity/X'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' cip:root '));

// classifyCode + parentCodeOf (the harvested taxonomy navigation, asserted directly).
check("classifyCode('01') -> domain", normalize.classifyCode('01') === 'domain');
check("classifyCode('01.01') -> subdomain", normalize.classifyCode('01.01') === 'subdomain');
check("classifyCode('01.0101') -> program", normalize.classifyCode('01.0101') === 'program');
check("parentCodeOf('01.01','subdomain') -> 01", normalize.parentCodeOf('01.01', 'subdomain') === '01');
check("parentCodeOf('01.0101','program') -> 01.01", normalize.parentCodeOf('01.0101', 'program') === '01.01');
check("parentCodeOf domain -> null", normalize.parentCodeOf('01', 'domain') === null);

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: 'CIP 2020',
		sourceFormat: 'csv',
		sourceFiles: ['CIPCode2020.csv'],
		domainCount: 1,
		subdomainCount: 1,
		programCount: 2,
	},
	nodes: [
		{ id: 'cip-root', label: 'CipRoot', superLabel: 'CipModel', properties: { name: 'CIP 2020', domainCount: 1, subdomainCount: 1, programCount: 2 }, edges: [] },
		{
			id: 'cipdomain-01',
			label: 'CipDomain',
			superLabel: 'CipModel',
			properties: { name: 'Agriculture', cipCode: '01', cipFamily: '01', cipLevel: 'domain', description: 'ag domain' },
			edges: [],
		},
		{
			id: 'cipsubdomain-01.01',
			label: 'CipSubdomain',
			superLabel: 'CipModel',
			properties: { name: 'Ag Business', cipCode: '01.01', cipFamily: '01', cipLevel: 'subdomain', description: 'ag business' },
			edges: [],
			_parentEdge: { type: 'HAS_CHILD', fromId: 'cipdomain-01', fromLabel: 'CipDomain' },
		},
		{
			id: 'cipprogram-01.0101',
			label: 'CipProgram',
			superLabel: 'CipModel',
			properties: { name: 'Ag Business General', cipCode: '01.0101', cipFamily: '01', cipLevel: 'program', description: 'general', examples: 'Agroeconomics' },
			// an intra-CIP cross-reference to another existing program code.
			edges: [{ type: 'CROSS_REFERENCES', targetId: 'cipprogram-01.0102', targetLabel: 'CipProgram' }],
			_parentEdge: { type: 'HAS_CHILD', fromId: 'cipsubdomain-01.01', fromLabel: 'CipSubdomain' },
		},
		{
			id: 'cipprogram-01.0102',
			label: 'CipProgram',
			superLabel: 'CipModel',
			properties: { name: 'Agribusiness', cipCode: '01.0102', cipFamily: '01', cipLevel: 'program', description: 'agribusiness' },
			edges: [],
			_parentEdge: { type: 'HAS_CHILD', fromId: 'cipsubdomain-01.01', fromLabel: 'CipSubdomain' },
		},
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('four DmeClass (1 domain + 1 subdomain + 2 programs)', byRole('DmeClass').length === 4);
check('zero DmeProperty (pure taxonomy)', byRole('DmeProperty').length === 0);
check('zero DmeOptionSet (pure taxonomy)', byRole('DmeOptionSet').length === 0);
check('zero DmeOptionValue (pure taxonomy)', byRole('DmeOptionValue').length === 0);
check('zero DmeSupport (CIP has none)', byRole('DmeSupport').length === 0);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === CIP', g.nodes.every((n) => n.properties._source === 'CIP'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries cipStableId === stableId', g.nodes.every((n) => n.properties.cipStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));
check('every node carries cipCode scalar', g.nodes.filter((n) => n.role === 'DmeClass').every((n) => typeof n.properties.cipCode === 'string' && n.properties.cipCode.length > 0));
check('every structural node crossRefs === [] (no cross-standard stash)', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.crossRefs === '[]'));

// the program with examples carries the scalar; depth/path reflect the CIP code.
const prog = g.nodes.find((n) => n.stableId === 'cip:program/01.0101');
check('program path === its CIP code', prog && prog.properties.path === '01.0101');
check('program depth === 3', prog && prog.properties.depth === 3);
check('program examples scalar preserved', prog && prog.properties.examples === 'Agroeconomics');
const domain = g.nodes.find((n) => n.stableId === 'cip:domain/01');
check('domain depth === 1', domain && domain.properties.depth === 1);
check('DmeClass searchText carries owning context', prog && prog.properties.searchText.length > 0 && prog.properties.searchText.includes('CIP'));

// edges: only canonical/REFERENCES types, all structural, all resolved (no throw means no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical/REFERENCES edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('every edge endpoint _source === CIP (standard-pure, no cross-standard)', g.edges.every((e) => e.fromRef.source === 'CIP' && e.toRef.source === 'CIP'));

// root owns ONLY top-level domains via HAS_CLASS.
check('HAS_CLASS root->domain present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'cip:root' && e.toRef.id === 'cip:domain/01'));
check('exactly one HAS_CLASS (only the domain)', g.edges.filter((e) => e.type === 'HAS_CLASS').length === 1);
check('NO HAS_CLASS root->subdomain', !g.edges.some((e) => e.type === 'HAS_CLASS' && e.toRef.id === 'cip:subdomain/01.01'));
check('NO HAS_CLASS root->program', !g.edges.some((e) => e.type === 'HAS_CLASS' && e.toRef.id.startsWith('cip:program/')));

// hierarchy: SUBCLASS_OF FROM the child TO the parent.
check('SUBCLASS_OF subdomain->domain present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'cip:subdomain/01.01' && e.toRef.id === 'cip:domain/01'));
check('SUBCLASS_OF program->subdomain present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'cip:program/01.0101' && e.toRef.id === 'cip:subdomain/01.01'));
check('SUBCLASS_OF count === 3 (1 subdomain + 2 programs)', g.edges.filter((e) => e.type === 'SUBCLASS_OF').length === 3);

// intra-CIP cross-reference -> REFERENCES (same-standard, not cross-standard).
check('REFERENCES program->program present', g.edges.some((e) => e.type === 'REFERENCES' && e.fromRef.id === 'cip:program/01.0101' && e.toRef.id === 'cip:program/01.0102'));
check('REFERENCES count === 1', g.edges.filter((e) => e.type === 'REFERENCES').length === 1);

check('stats.domainsEmitted === 1', g.stats.domainsEmitted === 1);
check('stats.subdomainsEmitted === 1', g.stats.subdomainsEmitted === 1);
check('stats.programsEmitted === 2', g.stats.programsEmitted === 2);
check('stats.subclassEdges === 3', g.stats.subclassEdges === 3);
check('stats.referenceEdges === 1', g.stats.referenceEdges === 1);
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical serialized shape (minus ingestedAt).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// an unknown native label MUST throw (R3 — never a silently mis-roled node).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.push({ id: 'bogus-1', label: 'BogusLabel', properties: { name: 'x', cipCode: '99.9999' }, edges: [] });
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unknown native label throws (R3 surfaced)', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual CIP CSV asset.
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
	check('real: zero DmeProperty', (roleCount.DmeProperty || 0) === 0);
	check('real: zero DmeOptionSet', (roleCount.DmeOptionSet || 0) === 0);
	check('real: zero DmeOptionValue', (roleCount.DmeOptionValue || 0) === 0);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === CIP', nodes.every((n) => n.properties._source === 'CIP'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries cipStableId', nodes.every((n) => n.properties.cipStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: only canonical/REFERENCES edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: standard-pure (every edge endpoint _source CIP)', edges.every((e) => e.fromRef.source === 'CIP' && e.toRef.source === 'CIP'));
	check('real: HAS_CLASS count === domains + root-anchored orphans', (edgeCount.HAS_CLASS || 0) === (result.stats.domainsEmitted + result.stats.rootAnchoredOrphans));
	check('real: SUBCLASS_OF count === subdomains + programs - root-anchored orphans', (edgeCount.SUBCLASS_OF || 0) === (result.stats.subdomainsEmitted + result.stats.programsEmitted - result.stats.rootAnchoredOrphans));
	// reachability: every DmeClass attaches to the hierarchy exactly once — either an INCOMING
	// HAS_CLASS from the root (top-level domains + any root-anchored orphan) OR exactly one OUTGOING
	// SUBCLASS_OF to its parent class (child->parent). No class is both, none is neither.
	check('real: every DmeClass attaches exactly once (root HAS_CLASS xor one outgoing SUBCLASS_OF)', (() => {
		const hasClassInTo = {};
		const subclassOutFrom = {};
		edges.forEach((e) => {
			if (e.type === 'HAS_CLASS') { hasClassInTo[e.toRef.id] = (hasClassInTo[e.toRef.id] || 0) + 1; }
			if (e.type === 'SUBCLASS_OF') { subclassOutFrom[e.fromRef.id] = (subclassOutFrom[e.fromRef.id] || 0) + 1; }
		});
		return nodes.filter((n) => n.role === 'DmeClass').every((n) => {
			const rootOwned = (hasClassInTo[n.stableId] || 0);
			const parented = (subclassOutFrom[n.stableId] || 0);
			return (rootOwned === 1 && parented === 0) || (rootOwned === 0 && parented === 1);
		});
	})());
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	console.log('\n=== CIP REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		domainsEmitted: result.stats.domainsEmitted,
		subdomainsEmitted: result.stats.subdomainsEmitted,
		programsEmitted: result.stats.programsEmitted,
		subclassEdges: result.stats.subclassEdges,
		referenceEdges: result.stats.referenceEdges,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
