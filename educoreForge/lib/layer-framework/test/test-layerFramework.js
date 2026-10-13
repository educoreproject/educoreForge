#!/usr/bin/env node
'use strict';

// test-layerFramework.js — the LAYER framework (lane DES, campaign cedsRichness-101226, 2026-10-12): a toy kit's layer forged
// end to end over a toy base, every descriptor refusal, and every integrity refusal OBSERVED firing on the fault it names.
// The integrity rules are where layer bytes enter a build, so each one is driven by a produced graph that breaks exactly it.
//
// Run: node lib/layer-framework/test/test-layerFramework.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the layer framework: resolution, production, and the integrity refusals
SYNOPSIS
     ${moduleName} [-verbose] [-help]
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../vocabulary/vocabulary');
const layerFramework = require('../layer-framework')();

const TOY_KIT_DIR_PATH = path.join(__dirname, 'fixtures', 'toyKit');
const LAYER_NAMESPACE = 'https://example.invalid/toyKit/layer/';
// a toy base in ENGINE shape (PG-JSON array properties), the shape the forger hands a layer
const toyBaseNodeEdges = {
	nodes: [
		{ ref: { source: 'TOY', id: 'https://example.invalid/toyKit/' }, labels: ['ToyRoot'], stableId: 'https://example.invalid/toyKit/', properties: { role: ['DmeStandardRoot'], name: ['Toy'], cedsId: ['ROOT'] } },
		{ ref: { source: 'TOY', id: 'https://example.invalid/toyKit/P1' }, labels: ['ToyProperty'], stableId: 'https://example.invalid/toyKit/P1', properties: { role: ['DmeProperty'], name: ['Prop one'], cedsId: ['P1'] } },
		{ ref: { source: 'TOY', id: 'https://example.invalid/toyKit/P2' }, labels: ['ToyProperty'], stableId: 'https://example.invalid/toyKit/P2', properties: { role: ['DmeProperty'], name: ['Prop two'], cedsId: ['P2'] } },
	],
	edges: [{ type: 'HAS_PROPERTY', fromRef: { source: 'TOY', id: 'https://example.invalid/toyKit/' }, toRef: { source: 'TOY', id: 'https://example.invalid/toyKit/P1' }, properties: { provenanceTier: ['structural'] } }],
};

const runForgeSection = (done) => {
	harness.section('a toy layer, forged end to end');
	harness.equal('the toy kit declares exactly one layer', layerFramework.declaredLayerKeyList({ bundleDir: TOY_KIT_DIR_PATH }).join(','), 'toy');
	const resolvedLayer = layerFramework.resolveLayer({ bundleDir: TOY_KIT_DIR_PATH, layerKey: 'toy' });
	harness.equal('the toy layer resolves', resolvedLayer.error, undefined);
	layerFramework.forgeLayer({ resolvedLayer, baseNodeEdges: toyBaseNodeEdges, standardName: 'TOY', layerNamespace: LAYER_NAMESPACE }, (forgeError, forged) => {
		harness.equal('the toy layer forges', forgeError, '');
		const nodeList = forged.stampedGraph.nodes;
		const rootNode = nodeList.find((oneNode) => oneNode.properties.role === vocabulary.DME_ROLES.LAYER_ROOT);
		harness.equal('the framework minted the layer root at the namespace + key + version', rootNode && rootNode.stableId, `${LAYER_NAMESPACE}toy/1/`);
		harness.equal('the root carries the producer\'s counts', rootNode && rootNode.properties.repairCount, 2);
		harness.equal('the root carries the snapshot\'s verified checksum', rootNode && JSON.parse(rootNode.properties.sourceFileChecksumText)['toyRepairList.txt'].length, 64);
		harness.ok('every layer node carries _source, layerKey, layerVersion, uri and the ForgedNode + layer labels', nodeList.every((oneNode) => oneNode.properties._source === 'TOY' && oneNode.properties.layerKey === 'toy' && oneNode.properties.layerVersion === '1' && oneNode.properties.uri === oneNode.stableId && oneNode.labels.indexOf('ForgedNode') !== -1 && oneNode.labels.indexOf('ToyLayer') !== -1));
		harness.ok('HAS_LAYER runs from the standard root to the layer root', forged.stampedGraph.edges.some((oneEdge) => oneEdge.type === 'HAS_LAYER' && oneEdge.fromRef.id === 'https://example.invalid/toyKit/' && oneEdge.toRef.id === rootNode.stableId));
		harness.equal('the harvest edge types are HAS_LAYER plus the declared types', forged.harvestEdgeTypeList.join(','), 'HAS_LAYER,DECLARES_REPAIR,REPAIRS_TEXT_OF');
		harness.equal('layer stats count roles', JSON.stringify(forged.layerStats.nodeCountByRole), JSON.stringify({ DmeLayerRoot: 1, DmeTextRepair: 2 }));
		done();
	});
};

const runDescriptorRefusalSection = (done) => {
	harness.section('descriptor refusals, by name');
	const scratchKitDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'layerFrameworkKit-'));
	const copyToyKit = () => fs.cpSync(TOY_KIT_DIR_PATH, scratchKitDirPath, { recursive: true });
	const descriptorPath = path.join(scratchKitDirPath, 'layers', 'toy', 'layerDescriptor.ini');
	const locationPath = path.join(scratchKitDirPath, 'layers', 'toy', 'assets', 'layerSourceData', '01', 'layerSourceLocation');
	const refusalWith = (editFile) => {
		fs.rmSync(scratchKitDirPath, { recursive: true, force: true });
		copyToyKit();
		editFile();
		return layerFramework.resolveLayer({ bundleDir: scratchKitDirPath, layerKey: 'toy' }).error || '';
	};
	harness.match('an undeclared layer is refused, naming those declared', layerFramework.resolveLayer({ bundleDir: TOY_KIT_DIR_PATH, layerKey: 'absent' }).error, /no layer 'absent'.*declares: toy/s);
	harness.match('a sectionless descriptor is refused', refusalWith(() => fs.writeFileSync(descriptorPath, fs.readFileSync(descriptorPath, 'utf8').replace('[layerDescriptor]', ''))), /no \[layerDescriptor\] section/);
	harness.match('a missing field is refused by name', refusalWith(() => fs.writeFileSync(descriptorPath, fs.readFileSync(descriptorPath, 'utf8').replace('layerLabel=ToyLayer\n', ''))), /declares no layerLabel/);
	harness.match('a layerKey that is not its directory is refused', refusalWith(() => fs.writeFileSync(descriptorPath, fs.readFileSync(descriptorPath, 'utf8').replace('layerKey=toy', 'layerKey=other'))), /sits in directory 'toy'/);
	harness.match('a defaultSnapshot naming no directory is refused', refusalWith(() => fs.writeFileSync(descriptorPath, fs.readFileSync(descriptorPath, 'utf8').replace('defaultSnapshot=01', 'defaultSnapshot=02'))), /matches 0 snapshot directories/);
	harness.match('a snapshot with no provenance record is refused (RT-12)', refusalWith(() => fs.unlinkSync(locationPath)), /carries no layerSourceLocation/);
	harness.match('a provenance record with no licence is refused', refusalWith(() => fs.writeFileSync(locationPath, fs.readFileSync(locationPath, 'utf8').replace(/licence:.*\n/, ''))), /records no licence/);
	harness.match('a version the record contradicts is refused', refusalWith(() => fs.writeFileSync(locationPath, fs.readFileSync(locationPath, 'utf8').replace('publishedVersion: 1', 'publishedVersion: 2'))), /declares layerVersion '1' but its snapshot records publishedVersion '2'/);
	fs.rmSync(scratchKitDirPath, { recursive: true, force: true });
	done();
};

const runIntegritySection = (done) => {
	harness.section('integrity refusals — each driven by a produced graph that breaks exactly it');
	const baseIndex = layerFramework.buildBaseIndex({ baseNodeEdges: toyBaseNodeEdges });
	const layerIdentity = layerFramework.layerIdentityFor({ resolvedLayer: { layerKey: 'toy', layerVersion: '1', layerLabel: 'ToyLayer' }, standardName: 'TOY', layerNamespace: LAYER_NAMESPACE });
	const layerDeclaration = { roleList: [vocabulary.DME_ROLES.TEXT_REPAIR], edgeTypeList: [vocabulary.EDGE_TYPES.DECLARES_REPAIR, vocabulary.EDGE_TYPES.REPAIRS_TEXT_OF] };
	const goodNode = { stableId: layerIdentity.stableIdFor('repair', 'Alpha'), role: vocabulary.DME_ROLES.TEXT_REPAIR, properties: { name: 'Alpha' } };
	const goodEdge = { type: 'REPAIRS_TEXT_OF', fromStableId: goodNode.stableId, toStableId: 'https://example.invalid/toyKit/P1', properties: { provenanceTier: 'spec-authoritative' } };
	const refusalOf = ({ nodes, edges }) => layerFramework.integrityRefusal({ produced: { nodes, edges }, layerDeclaration, layerIdentity, baseIndex });
	harness.equal('a well-formed graph passes', refusalOf({ nodes: [goodNode], edges: [goodEdge] }), '');
	const caseList = [
		['a node outside the id root', { nodes: [{ ...goodNode, stableId: 'https://elsewhere.invalid/x' }], edges: [] }, /outside the layer's id root/],
		['a node minted twice', { nodes: [goodNode, goodNode], edges: [] }, /minted twice/],
		['a data role (DmeProperty)', { nodes: [{ ...goodNode, role: 'DmeProperty' }], edges: [] }, /not a layer role/],
		['a layer role the layer does not declare', { nodes: [{ ...goodNode, role: vocabulary.DME_ROLES.CONCEPT }], edges: [] }, /not a layer role this layer declares/],
		['a node stamping a framework-owned property', { nodes: [{ ...goodNode, properties: { ...goodNode.properties, _source: 'X' } }], edges: [] }, /stamps '_source'/],
		['a node with no name', { nodes: [{ ...goodNode, properties: {} }], edges: [] }, /carries no name/],
		['a node with a null value', { nodes: [{ ...goodNode, properties: { name: 'A', definition: null } }], edges: [] }, /carries 'definition' with no value/],
		['an undeclared edge type', { nodes: [goodNode], edges: [{ ...goodEdge, type: 'EXACT_MATCH' }] }, /edge type "EXACT_MATCH" is not one this layer declares/],
		['an edge with no provenanceTier', { nodes: [goodNode], edges: [{ ...goodEdge, properties: {} }] }, /no valid provenanceTier/],
		['an edge to a node that exists nowhere', { nodes: [goodNode], edges: [{ ...goodEdge, toStableId: 'https://example.invalid/toyKit/P9' }] }, /neither a layer node nor a base node/],
		['an edge between two base nodes', { nodes: [goodNode], edges: [{ ...goodEdge, fromStableId: 'https://example.invalid/toyKit/P2' }] }, /joins two base nodes/],
	];
	caseList.forEach(([caseLabel, produced, refusalPattern]) => harness.match(`refused: ${caseLabel}`, refusalOf(produced), refusalPattern));
	done();
};

// the -goldEvalCheck certificate names, per round-trip token, the block it certified: a LAYER token its layer block
// (RED FIRST on the real gold: evidence/DES/desCt17Layers-goldEvalCheck.log refused a layer token with NO standardBase member)
const runCertificateSection = (done) => {
	harness.section('certificate: a layer token names its LAYER block, read off the manifest member');
	const { readBaseBlockIdByToken } = require('../../../apps/graph-builder/lib/certificate-enrichment');
	const manifest = { refId: 'm1', members: [
		{ kind: 'standardBase', subject: 'ceds@14_0_0_0_base', schemaBlockRefId: 'baseRefId' },
		{ kind: 'layer', subject: 'ceds@14_0_0_0_layer_guide@14', schemaBlockRefId: 'guideLayerRefId' },
		{ kind: 'layer', subject: 'ceds@14_0_0_0_layer_textRepair@14_0_0_0', schemaBlockRefId: 'textRepairLayerRefId' },
	] };
	const verdict = readBaseBlockIdByToken({ manifest, declaredTokenList: ['ceds', 'ceds:guide', 'ceds:textRepair'] });
	harness.equal('ceds -> its base; ceds:guide and ceds:textRepair -> their layer blocks', JSON.stringify(verdict.value), JSON.stringify({ ceds: 'baseRefId', 'ceds:guide': 'guideLayerRefId', 'ceds:textRepair': 'textRepairLayerRefId' }));
	const missing = readBaseBlockIdByToken({ manifest, declaredTokenList: ['ceds:ids'] });
	harness.match('a layer token with no layer member is refused by name', missing.refusalMessage || '', /'ceds:ids' has NO layer member/);
	done();
};

runForgeSection(() => runDescriptorRefusalSection(() => runIntegritySection(() => runCertificateSection(() => harness.report()))));
