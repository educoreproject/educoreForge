#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — Gate-A for the PESC forge (XSD family). ALL PURE: no Voyage embedding call,
// no Neo4j, no golden touch — it exercises normalize + buildContractGraph (and forge() with
// skipEmbedding=true over the REAL .xsd asset) and asserts that, whatever the native XSD input form,
// the emitted node's stableId conforms to a clean canonical form BEFORE emission, searchText is
// non-empty, edges are canonical + fully resolved, and the shaping is deterministic. Mirrors
// forge-sif/test/test-r3-canonical.js.
//
// Run: node cli/lib.d/forge-pesc/test/test-r3-canonical.js
//
// Phase 1 (round-trip retrofit, WORKORDER-pescRoundTripForge-080326) added section 4: the
// silent-source audit gates (RT-2 absent-is-absent) and the refusal-by-name gates (RT-3),
// including checksum verification against the snapshot's SHA256SUMS. Every section-4 gate was
// observed RED against the pre-fix parser before the fixes made it green (gate doctrine RT-10).

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgePesc')({ embedder: null });

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
// 1. normalize unit asserts — canonical forms from varied native inputs
// =====================================================================

check('buildStableId root -> pesc:root', normalize.buildStableId({ kind: 'root' }).stableId === 'pesc:root');
check(
	'buildStableId complexType -> pesc:class/<source>/<name>',
	normalize.buildStableId({ kind: 'complexType', key: 'CoreMain/PersonType' }).stableId ===
		'pesc:class/CoreMain/PersonType',
);
check(
	'buildStableId field keeps owner.kind.name',
	normalize.buildStableId({ kind: 'field', key: 'CoreMain/PersonType.element.FirstName' }).stableId ===
		'pesc:field/CoreMain/PersonType.element.FirstName',
);
check(
	'buildStableId optionValue keeps set.value',
	normalize.buildStableId({ kind: 'optionValue', key: 'CoreMain/CountryCode.US' }).stableId ===
		'pesc:optionValue/CoreMain/CountryCode.US',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'complexType', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts pesc:root', normalize.isCleanStableId('pesc:root'));
check('isCleanStableId accepts pesc:field/...', normalize.isCleanStableId('pesc:field/A/B.element.C'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-pesc', !normalize.isCleanStableId('sif:object/x'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' pesc:root '));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the XSD role mapping + edge convention
// =====================================================================

const syntheticParsed = {
	metadata: {
		version: '1.0',
		sourceFormat: 'xsd',
		complexTypeCount: 2,
		simpleTypeCount: 2,
		groupCount: 1,
		sourceFileCount: 1,
		sourceFiles: ['CoreMain_v1.19.1.xsd'],
	},
	nodes: [
		{ id: 'pesc-root', label: 'PescRoot', properties: { name: 'PESC' }, edges: [] },

		// a base complexType
		{
			id: 'pesccomplex-CoreMain-BaseType',
			label: 'PescComplexType',
			properties: { name: 'BaseType', sourceFile: 'CoreMain', fieldCount: 0, baseType: '', derivation: '' },
			edges: [],
		},
		// a derived complexType: EXTENDS BaseType -> SUBCLASS_OF; USES_SUPPORT group -> HAS_SUPPORT
		{
			id: 'pesccomplex-CoreMain-PersonType',
			label: 'PescComplexType',
			properties: { name: 'PersonType', sourceFile: 'CoreMain', fieldCount: 2, baseType: 'core:BaseType', derivation: 'extension' },
			edges: [
				{ type: 'EXTENDS', targetId: 'pesccomplex-CoreMain-BaseType', targetLabel: 'PescComplexType', targetKind: 'complexType' },
				{ type: 'USES_SUPPORT', targetId: 'pescsupport-group-CoreMain-NameGroup', targetLabel: 'PescSupport', targetKind: 'support' },
			],
		},
		// a field typed by an OPTION SET -> HAS_OPTION_SET (property owns its option set)
		{
			id: 'pescfield-CoreMain-PersonType-element-Country',
			label: 'PescField',
			properties: { name: 'Country', sourceFile: 'CoreMain', owningTypeName: 'PersonType', xsdKind: 'element', typeName: 'core:CountryCode', minOccurs: '1', maxOccurs: '1' },
			edges: [
				{ type: 'TYPED_BY', targetId: 'pescoptset-CoreMain-CountryCode', targetLabel: 'PescOptionSet', targetKind: 'optionSet' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'pesccomplex-CoreMain-PersonType', fromLabel: 'PescComplexType' },
		},
		// a field typed by a complexType -> REFERENCES
		{
			id: 'pescfield-CoreMain-PersonType-element-Name',
			label: 'PescField',
			properties: { name: 'Name', sourceFile: 'CoreMain', owningTypeName: 'PersonType', xsdKind: 'element', typeName: 'core:BaseType', minOccurs: '0', maxOccurs: '1' },
			edges: [
				{ type: 'TYPED_BY', targetId: 'pesccomplex-CoreMain-BaseType', targetLabel: 'PescComplexType', targetKind: 'complexType' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'pesccomplex-CoreMain-PersonType', fromLabel: 'PescComplexType' },
		},
		// an OPTION SET + two values
		{
			id: 'pescoptset-CoreMain-CountryCode',
			label: 'PescOptionSet',
			properties: { name: 'CountryCode', sourceFile: 'CoreMain', restrictionBase: 'xs:string', valueCount: 2 },
			edges: [],
		},
		{
			id: 'pescoptval-CoreMain-CountryCode-US',
			label: 'PescOptionValue',
			properties: { name: 'US', sourceFile: 'CoreMain', optionSetName: 'CountryCode' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'pescoptset-CoreMain-CountryCode', fromLabel: 'PescOptionSet' },
		},
		{
			id: 'pescoptval-CoreMain-CountryCode-CA',
			label: 'PescOptionValue',
			properties: { name: 'CA', sourceFile: 'CoreMain', optionSetName: 'CountryCode' },
			edges: [],
			_parentEdge: { type: 'HAS_VALUE', fromId: 'pescoptset-CoreMain-CountryCode', fromLabel: 'PescOptionSet' },
		},
		// a support group (DmeSupport)
		{
			id: 'pescsupport-group-CoreMain-NameGroup',
			label: 'PescSupport',
			properties: { name: 'NameGroup', sourceFile: 'CoreMain', supportKind: 'group', fieldCount: 0 },
			edges: [],
		},
		// a non-enum simpleType (DmeSupport)
		{
			id: 'pescsupport-simple-CoreMain-TokenType',
			label: 'PescSupport',
			properties: { name: 'TokenType', sourceFile: 'CoreMain', supportKind: 'simpleType', restrictionBase: 'xs:token' },
			edges: [],
		},
		// an ORPHAN option set (no field types against it) -> anchored from root
		{
			id: 'pescoptset-CoreMain-OrphanCode',
			label: 'PescOptionSet',
			properties: { name: 'OrphanCode', sourceFile: 'CoreMain', restrictionBase: 'xs:string', valueCount: 0 },
			edges: [],
		},
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
check('two DmeSupport (group + simpleType)', byRole('DmeSupport').length === 2);

check('every node clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === PESC', g.nodes.every((n) => n.properties._source === 'PESC'));
check('every node non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries pescStableId === stableId', g.nodes.every((n) => n.properties.pescStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

// edges
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'SUBCLASS_OF', 'REFERENCES']);
check('only canonical edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('HAS_CLASS root->complexType present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'pesc:root' && e.toRef.id === 'pesc:class/CoreMain/PersonType'));
check('HAS_PROPERTY type->field present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'pesc:class/CoreMain/PersonType'));
check('HAS_OPTION_SET field->optionSet present (from DmeProperty)', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id.startsWith('pesc:field/') && e.toRef.id === 'pesc:optionSet/CoreMain/CountryCode'));
check('HAS_VALUE optionSet->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'pesc:optionSet/CoreMain/CountryCode'));
check('SUBCLASS_OF derived->base present', g.edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === 'pesc:class/CoreMain/PersonType' && e.toRef.id === 'pesc:class/CoreMain/BaseType'));
check('HAS_SUPPORT complexType->group present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'pesc:class/CoreMain/PersonType' && e.toRef.id === 'pesc:support/CoreMain/NameGroup'));
check('HAS_SUPPORT root->simpleType present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.fromRef.id === 'pesc:root' && e.toRef.id === 'pesc:support/CoreMain/TokenType'));
check('REFERENCES field->complexType present', g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'pesc:class/CoreMain/BaseType'));
check('orphan option set anchored from root via HAS_OPTION_SET', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.fromRef.id === 'pesc:root' && e.toRef.id === 'pesc:optionSet/CoreMain/OrphanCode'));

// every DmeOptionSet has >=1 incoming HAS_OPTION_SET (reachable)
const optSetIds = byRole('DmeOptionSet').map((n) => n.stableId);
const hasOptSetTargets = new Set(g.edges.filter((e) => e.type === 'HAS_OPTION_SET').map((e) => e.toRef.id));
check('every DmeOptionSet reachable via HAS_OPTION_SET', optSetIds.every((id) => hasOptSetTargets.has(id)));

check('stats.propertyOptionSetEdges === 1', g.stats.propertyOptionSetEdges === 1);
check('stats.subclassEdges === 1', g.stats.subclassEdges === 1);
check('stats.supportUsageEdges === 1', g.stats.supportUsageEdges === 1);
check('stats.referencesEdges === 1', g.stats.referencesEdges === 1);
check('stats.orphanAnchoredOptionSets === 1', g.stats.orphanAnchoredOptionSets === 1);
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// an unknown native label MUST throw (never silently dropped)
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.push({ id: 'bogus', label: 'PescBogus', properties: { name: 'x', sourceFile: 'CoreMain' }, edges: [] });
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unknown native label throws', threw);

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual PESC XSD asset.
// =====================================================================

const assetDir = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');

// =====================================================================
// 4. PHASE-1 GATES — refusal-by-name (RT-3) + hermetic self-closing-group extraction.
//    Every refusal names what is wrong AND where the acquisition recipe lives
//    (README_PROVENANCE.md beside the source bytes). Each gate here was observed RED
//    against the pre-fix parser (RT-10) — see the Phase 1 DEVLOG entry for the red runs.
// =====================================================================

const parsePesc = require('../lib/parser');

// scratch snapshot builder: writes the given files plus a SHA256SUMS matching the .xsd entries.
const makeScratchSnapshot = (label, fileContentByName) => {
	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), `pescR3-${label}-`));
	const sumLines = [];
	Object.entries(fileContentByName).forEach(([filename, content]) => {
		fs.writeFileSync(path.join(scratchDir, filename), content);
		if (/\.xsd$/i.test(filename)) {
			sumLines.push(
				`${crypto.createHash('sha256').update(content).digest('hex')}  ${filename}`,
			);
		}
	});
	fs.writeFileSync(path.join(scratchDir, 'SHA256SUMS'), sumLines.join('\n') + '\n');
	return scratchDir;
};

// copy the real snapshot's source bytes + SHA256SUMS into a scratch dir for corruption gates.
const copyRealSnapshot = (label) => {
	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), `pescR3-${label}-`));
	fs.readdirSync(assetDir)
		.filter((name) => /\.xsd$/i.test(name) || name === 'SHA256SUMS')
		.forEach((name) => {
			fs.copyFileSync(path.join(assetDir, name), path.join(scratchDir, name));
		});
	return scratchDir;
};

// a minimal schema whose CompositeGroup members are SELF-CLOSING <xs:group ref=…/> elements —
// the exact form that unbalanced the pre-fix depth counter and silently discarded the block.
const SELF_CLOSING_GROUP_XSD = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:core="urn:org:pesc:core:CoreMain:v1.19.1">',
	'\t<xs:group name="MemberDetailsGroup">',
	'\t\t<xs:sequence>',
	'\t\t\t<xs:element name="MemberName" type="xs:string"/>',
	'\t\t</xs:sequence>',
	'\t</xs:group>',
	'\t<xs:group name="CompositeGroup">',
	'\t\t<xs:sequence>',
	'\t\t\t<xs:group ref="core:MemberDetailsGroup"/>',
	'\t\t</xs:sequence>',
	'\t</xs:group>',
	'\t<xs:complexType name="CarrierType">',
	'\t\t<xs:sequence>',
	'\t\t\t<xs:group ref="core:CompositeGroup"/>',
	'\t\t</xs:sequence>',
	'\t</xs:complexType>',
	'</xs:schema>',
	'',
].join('\n');

// sequential gate runner — each step receives a done() it must call exactly once.
const runGateSteps = (steps, allDone) => {
	let stepIndex = 0;
	const nextStep = () => {
		if (stepIndex >= steps.length) {
			allDone();
			return;
		}
		const oneStep = steps[stepIndex];
		stepIndex++;
		oneStep(nextStep);
	};
	nextStep();
};

function runPhase1Gates() {
	const gateSteps = [];

	// -- RT-3: missing source path refuses, naming the path and the acquisition recipe --
	gateSteps.push((done) => {
		parsePesc('/nonexistent/pescSourcePath', {}, (err) => {
			check('rt3: missing source path refuses by name', !!err && `${err}`.indexOf('source not found') !== -1);
			check('rt3: missing-path refusal names the acquisition recipe', !!err && `${err}`.indexOf('README_PROVENANCE.md') !== -1);
			done();
		});
	});

	// -- RT-3: a non-directory source path refuses, naming the recipe --
	gateSteps.push((done) => {
		parsePesc(path.join(assetDir, 'SHA256SUMS'), {}, (err) => {
			check('rt3: non-directory source refuses by name', !!err && `${err}`.indexOf('version directory') !== -1);
			check('rt3: non-directory refusal names the acquisition recipe', !!err && `${err}`.indexOf('README_PROVENANCE.md') !== -1);
			done();
		});
	});

	// -- RT-3: a directory with no .xsd files refuses, naming the recipe --
	gateSteps.push((done) => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pescR3-empty-'));
		parsePesc(emptyDir, {}, (err) => {
			check('rt3: empty source directory refuses by name', !!err && `${err}`.indexOf('no .xsd files') !== -1);
			check('rt3: empty-directory refusal names the acquisition recipe', !!err && `${err}`.indexOf('README_PROVENANCE.md') !== -1);
			done();
		});
	});

	// -- RT-3: missing SHA256SUMS refuses (provenance checksums are required) --
	gateSteps.push((done) => {
		const scratchDir = makeScratchSnapshot('noSums', { 'Minimal_v1.0.0.xsd': SELF_CLOSING_GROUP_XSD });
		fs.unlinkSync(path.join(scratchDir, 'SHA256SUMS'));
		parsePesc(scratchDir, {}, (err) => {
			check('rt3: missing SHA256SUMS refuses by name', !!err && `${err}`.indexOf('SHA256SUMS') !== -1);
			done();
		});
	});

	// -- RT-3: a checksum-failing source file refuses, naming the file --
	gateSteps.push((done) => {
		const scratchDir = copyRealSnapshot('corrupt');
		fs.appendFileSync(path.join(scratchDir, 'CoreMain_v1.19.1.xsd'), '<!-- corrupted -->\n');
		parsePesc(scratchDir, {}, (err) => {
			check(
				'rt3: checksum-failing source refuses, naming the file',
				!!err && `${err}`.indexOf('CoreMain_v1.19.1.xsd') !== -1 && `${err}`.indexOf('checksum') !== -1,
			);
			done();
		});
	});

	// -- RT-3: an .xsd present but unlisted in SHA256SUMS refuses (unchecksummed source) --
	gateSteps.push((done) => {
		const scratchDir = copyRealSnapshot('unlisted');
		fs.writeFileSync(path.join(scratchDir, 'Extra_v1.0.0.xsd'), SELF_CLOSING_GROUP_XSD);
		parsePesc(scratchDir, {}, (err) => {
			check('rt3: unchecksummed .xsd refuses, naming the file', !!err && `${err}`.indexOf('Extra_v1.0.0.xsd') !== -1);
			done();
		});
	});

	// -- RT-3: a SHA256SUMS-listed file missing from the directory refuses, naming it --
	gateSteps.push((done) => {
		const scratchDir = copyRealSnapshot('missingListed');
		fs.unlinkSync(path.join(scratchDir, 'iso_3166-1_v1.0.0.xsd'));
		parsePesc(scratchDir, {}, (err) => {
			check('rt3: SHA256SUMS-listed file missing refuses, naming the file', !!err && `${err}`.indexOf('iso_3166-1_v1.0.0.xsd') !== -1);
			done();
		});
	});

	// -- RT-2/RT-3: a source file without a _v<version> filename suffix refuses (was a silent
	//    version:'unknown' default). Fires never on snapshot 01 — the gate proves the refusal path.
	gateSteps.push((done) => {
		const scratchDir = makeScratchSnapshot('noVersion', { 'NoVersion.xsd': SELF_CLOSING_GROUP_XSD });
		parsePesc(scratchDir, {}, (err) => {
			check('rt3: versionless .xsd filename refuses by name', !!err && `${err}`.indexOf('NoVersion.xsd') !== -1);
			done();
		});
	});

	// -- CONTROL (not a gate): an intact copy of the snapshot parses cleanly — the refusals
	//    above must come from the injected faults, not from over-refusal of good source.
	gateSteps.push((done) => {
		const scratchDir = copyRealSnapshot('control');
		parsePesc(scratchDir, {}, (err, parsed) => {
			check('control: intact snapshot copy parses cleanly', !err && parsed && parsed.nodes.length > 0);
			done();
		});
	});

	// -- HERMETIC: self-closing-member group extraction (the D1 mechanism, isolated) --
	gateSteps.push((done) => {
		const scratchDir = makeScratchSnapshot('selfClose', { 'CoreMain_v1.19.1.xsd': SELF_CLOSING_GROUP_XSD });
		parsePesc(scratchDir, {}, (err, parsed) => {
			if (err) {
				check(`hermetic: self-closing fixture parses (got: ${err})`, false);
				done();
				return;
			}
			const groupNodes = parsed.nodes.filter(
				(n) => n.label === 'PescSupport' && n.properties.supportKind === 'group',
			);
			const compositeGroup = groupNodes.find((n) => n.properties.name === 'CompositeGroup');
			check('hermetic: self-closing-member group captured', !!compositeGroup);
			check(
				'hermetic: group-to-group ref emits USES_SUPPORT',
				!!compositeGroup &&
					(compositeGroup.edges || []).some(
						(e) => e.type === 'USES_SUPPORT' && e.targetId === 'pescsupport-group-CoreMain-MemberDetailsGroup',
					),
			);
			const carrierType = parsed.nodes.find(
				(n) => n.label === 'PescComplexType' && n.properties.name === 'CarrierType',
			);
			check(
				'hermetic: complexType ref to self-closing-member group resolves',
				!!carrierType &&
					(carrierType.edges || []).some(
						(e) => e.type === 'USES_SUPPORT' && e.targetId === 'pescsupport-group-CoreMain-CompositeGroup',
					),
			);
			done();
		});
	});

	runGateSteps(gateSteps, finish);
}

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
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === PESC', nodes.every((n) => n.properties._source === 'PESC'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries pescStableId', nodes.every((n) => n.properties.pescStableId === n.stableId));
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

	// ---- Phase 1 gates: the 3-group silent drop (DEVLOG Finding 3) ----
	// CoreMain_v1.19.1.xsd defines 9 xs:group blocks; the pre-fix parser emitted 6, silently
	// dropping the three address groups whose members are SELF-CLOSING <xs:group ref=…/> elements.
	check('real: all 9 source xs:group definitions emitted', result.metadata.groupCount === 9);
	const supportStableIds = new Set(
		nodes.filter((n) => n.role === 'DmeSupport').map((n) => n.stableId),
	);
	check('real: DomesticAddressGroup present', supportStableIds.has('pesc:support/CoreMain/DomesticAddressGroup'));
	check('real: InternationalAddressGroup present', supportStableIds.has('pesc:support/CoreMain/InternationalAddressGroup'));
	check('real: GeneralAddressGroup present', supportStableIds.has('pesc:support/CoreMain/GeneralAddressGroup'));
	check(
		'real: AddressType uses GeneralAddressGroup (HAS_SUPPORT)',
		edges.some(
			(e) =>
				e.type === 'HAS_SUPPORT' &&
				e.fromRef.id === 'pesc:class/CoreMain/AddressType' &&
				e.toRef.id === 'pesc:support/CoreMain/GeneralAddressGroup',
		),
	);
	// present-is-present: the address groups' entire content is group-refs; they must carry
	// their scaffolding edges, not land as empty husks.
	check(
		'real: group-to-group scaffolding captured (GeneralAddressGroup -> CommonAddressDetailsGroup)',
		edges.some(
			(e) =>
				e.type === 'HAS_SUPPORT' &&
				e.fromRef.id === 'pesc:support/CoreMain/GeneralAddressGroup' &&
				e.toRef.id === 'pesc:support/CoreMain/CommonAddressDetailsGroup',
		),
	);

	// ---- Phase 1 gate: no fabricated placeholder descriptions (RT-2) ----
	// The pre-fix parser synthesized descriptions ('PESC element X within Y', …) at 7 sites;
	// 606 baseline nodes carried one. Absent source documentation is the contract-uniform ''.
	const placeholderDescriptionRe =
		/^(PESC (element|attribute|complex type|simple type|group \(scaffolding\)|enumerated type|root \(message\) element) |Enumeration value ")/;
	check(
		'real: no fabricated placeholder descriptions (RT-2 absent-is-absent)',
		nodes.every((n) => !placeholderDescriptionRe.test(n.properties.description)),
	);

	// ---- R-PW-5 gates (Phase 2 round-trip catch, supervisor-authorized fixes) ----
	// Defect A — extractComplexBase matched /<xs:complexContent>[\s\S]*?<xs:extension/ over the
	// WHOLE block body, so a type with NO derivation of its own that contains a NESTED INLINE
	// complexType with complexContent inherited the nested base as its own. Verified against
	// CoreMain_v1.19.1.xsd source bytes: these three types open with a plain xs:sequence.
	const nodeByStableId = {};
	nodes.forEach((n) => { nodeByStableId[n.stableId] = n; });
	['AcademicCompetitivenessGrantType', 'NationalSMARTGrantType', 'ReportingSchoolResponseType'].forEach(
		(oneUnderivedTypeName) => {
			const typeStableId = `pesc:class/CoreMain/${oneUnderivedTypeName}`;
			const typeNode = nodeByStableId[typeStableId];
			check(
				`rpw5-A: ${oneUnderivedTypeName} carries NO derivation (nested inline complexContent is not its own)`,
				!!typeNode &&
					!typeNode.properties.baseType &&
					!typeNode.properties.derivation &&
					!edges.some((e) => e.type === 'SUBCLASS_OF' && e.fromRef.id === typeStableId),
			);
		},
	);
	// Defect B — the parser read COMMENTED-OUT XSD as live: AdmissionsRecord_v1.4.0.xsd carries a
	// SponsorType definition inside an XML comment (JAF 2011/06/03) BEFORE the live definition;
	// first-wins dedup kept the commented-out one and discarded the real one. The live definition
	// types SponsorOrganization as AdmRec:ApplicationOrganizationType.
	const sponsorOrganizationField =
		nodeByStableId['pesc:field/AdmissionsRecord/SponsorType.element.SponsorOrganization'];
	check(
		'rpw5-B: SponsorType.SponsorOrganization typed from the LIVE definition, not the commented-out one',
		!!sponsorOrganizationField &&
			sponsorOrganizationField.properties.typeName === 'AdmRec:ApplicationOrganizationType',
	);
	check(
		'rpw5-B: no duplicate definitions once comments are stripped (the XML source has ONE live SponsorType)',
		!!result.stats.parseAudit && result.stats.parseAudit.dedupedNodeDefinitions === 0,
	);

	console.log('\n=== PESC REAL-DATA DRY COUNT (no embedding) ===');
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
	if (result.stats.parseAudit) {
		console.log('parseAudit:', JSON.stringify({
			unresolvedTypeRefs: result.stats.parseAudit.unresolvedTypeRefs.length,
			importDeclarationDrift: result.stats.parseAudit.importDeclarationDrift.length,
			trimmedEnumValues: result.stats.parseAudit.trimmedEnumValues,
			emptyEnumValuesSkipped: result.stats.parseAudit.emptyEnumValuesSkipped,
			dedupedEnumValues: result.stats.parseAudit.dedupedEnumValues,
		}));
	}
	runPhase1Gates();
});


function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
