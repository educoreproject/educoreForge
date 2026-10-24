#!/usr/bin/env node
'use strict';

// test-caseForge.js — the CASE 1.1 forge bundle (nextStandards wave 2 lane E), Docker-free: the real snapshot (the publisher's YAML) forged
// in process, its measured counts and the carriage of each CASE construct (the K2 ones: digit-led vendor words, the two declared list-
// valued vendor extensions, the declared caseVersion member text), the round trip over the harness's graph double with its omission table
// and twins observed RED, the snapshot's provenance, and determinism. The kit's own constructs and refusals are proven in
// lib/openapi-forge/test/test-openapiForgeKit.js; this suite proves the bundle and its bytes. Writes only under os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the CASE 1.1 forge bundle: counts, carriage, round trip, provenance, determinism (no Docker)

SYNOPSIS
     node forges/case/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/case/assets/standardSourceData/01 in process (no embedding) and asserts the measured counts (39 schemas, 201
     properties, 8 enums, 39 values, 58 references) and how the CASE constructs are carried. Runs the bundle's round-trip validator
     over the harness graph double, clean and on perturbations. Writes only under os.tmpdir().

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const roundTripHarness = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const { parseOpenapiSourceFile } = require(path.join(TREE_ROOT, 'lib', 'openapi-forge', 'openapiSourceParser'));

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '01');
const SOURCE_FILE_NAME = 'imscasev1p1_openapi3_v1p0.yaml';
const JSON_SIBLING_FILE_NAME = 'imscasev1p1_openapi3_v1p0.json';
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeCase'))({ embedder: null });
const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
const forgeDeclaration = require(path.join(BUNDLE_DIR_PATH, 'lib', 'caseForgeDeclaration'));

// the measured expectation (snapshot 01, 2026-10-24), as data
const EXPECTED = Object.freeze({
	sourceSha256: '8f50402bf1aa4d065a8a393fc22287b454934315426b28a525ca7d04057dfd61',
	jsonSiblingSha256: '40f183b6ca3ce4979e4908d4414b9d099dd22493bea45694b60e7a72a19a22bf',
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 39, DmeProperty: 201, DmeOptionSet: 8, DmeOptionValue: 39 },
	edgeCountByType: { HAS_CLASS: 39, HAS_PROPERTY: 201, REFERENCES: 58, HAS_OPTION_SET: 8, HAS_VALUE: 39 },
	referenceEdgeCountByConstruct: { $ref: 37, items: 21 },
	describedPropertyCount: 164,
	// openapi, info, servers, tags, paths; the two YAML-typed caseVersion members
	explicitlyOmittedByKind: { outOfScopeByDeclaration: 5, declaredMemberText: 2 },
	rootVersionText: '1.1|1.1|spec', // version, publishedVersion, versionSource: info.version agrees with standardSourceLocation
	extensionSchemaCount: 13,
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const contentCountBy = (itemList, nameOf, roleOrTypeList) => countBy(itemList.filter((oneItem) => roleOrTypeList.indexOf(nameOf(oneItem)) !== -1), nameOf);
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const sha256Of = (fileName) => crypto.createHash('sha256').update(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, fileName))).digest('hex');
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'caseForgeTest-'));
const { parseRefusal, document: sourceDocument } = parseOpenapiSourceFile({ sourceFilePath: path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME), sourceFormat: 'yaml' });
const sourceRequiredCount = parseRefusal !== '' ? -1 : Object.values(sourceDocument.components.schemas).reduce((total, oneSchema) => total + (oneSchema.required || []).length, 0);

const forgeSnapshot = (callback) => bundle.forge({ sourcePath: path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
const validateDouble = ({ forgeResult, caseName }, callback) => {
	const outputPath = path.join(scratchRootPath, `verdict-${caseName}`);
	fs.mkdirSync(outputPath, { recursive: true });
	validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: SNAPSHOT_DIR_PATH, outputPath }, callback);
};

const taskList = new taskListPlus();

// -----------------------------------------------------------------
// SECTION 1 — provenance: the bytes are the ones the README names
// -----------------------------------------------------------------
taskList.push((args, next) => {
	harness.section('SECTION 1 — snapshot 01: the bytes, the pin, the declaration');
	harness.equal('the YAML sha256 is the 2026-06-23 held copy and the 2026-10-24 fetch', sha256Of(SOURCE_FILE_NAME), EXPECTED.sourceSha256);
	harness.equal('the JSON sibling (stored, never read) is the 2026-10-24 fetch', sha256Of(JSON_SIBLING_FILE_NAME), EXPECTED.jsonSiblingSha256);
	harness.accepts('the YAML parses', parseRefusal === '' ? [] : [parseRefusal]);
	harness.equal('the source says openapi 3.0.0, info.version 1.1', parseRefusal === '' ? `${sourceDocument.openapi}|${sourceDocument.info.version}` : parseRefusal, '3.0.0|1.1');
	harness.equal('declaration names (DESIGN-E0 §4)', `${forgeDeclaration.standardKey}|${forgeDeclaration.standardSource}|${forgeDeclaration.standardFamily}|${forgeDeclaration.nativeIdentifierPropertyName}`, 'case|CASE|CASE|null');
	next('', args);
});

// -----------------------------------------------------------------
// SECTION 2 — the real snapshot forged: counts and carriage
// -----------------------------------------------------------------
taskList.push((args, next) => forgeSnapshot((forgeError, forgeResult) => {
	harness.section('SECTION 2 — snapshot 01 forged in process: the measured counts and the carriage');
	harness.accepts('the real snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	const classNodeList = forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeClass');
	harness.equal('content node count by role (39 schemas, 201 properties, 8 enums, 39 values)', sortedText(contentCountBy(forgeResult.nodes, (oneNode) => oneNode.role, Object.keys(EXPECTED.nodeCountByRole))), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('content edge count by type', sortedText(contentCountBy(forgeResult.edges, (oneEdge) => oneEdge.type, Object.keys(EXPECTED.edgeCountByType))), sortedText(EXPECTED.edgeCountByType));
	harness.equal('references by construct (37 bare $ref, 21 items)', sortedText(forgeResult.stats.referenceEdgeCountByConstruct), sortedText(EXPECTED.referenceEdgeCountByConstruct));
	harness.equal('164 properties carry a description; the 37 bare $refs none', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.description !== undefined).length, EXPECTED.describedPropertyCount);
	harness.equal('every schema carries its description (block scalar, final newline kept) and x_1edtechConfidentiality', classNodeList.filter((oneNode) => /\n$/.test(oneNode.properties.description) && oneNode.properties.x_1edtechConfidentiality === 'unrestricted').length, 39);
	harness.equal('the 13 *ExtensionDType schemas carry both declared list-valued annotations as JSON text', classNodeList.filter((oneNode) => oneNode.properties.x_1edtechPrivacy === '["extensions"]' && oneNode.properties.x_1edtechConfidentialityNormal === '["extensions"]').map((oneNode) => oneNode.properties.name).filter((schemaName) => /ExtensionDType$/.test(schemaName)).length, EXPECTED.extensionSchemaCount);
	harness.equal('isRequired true on exactly the source required names', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.isRequired === true).length, sourceRequiredCount);
	harness.equal('caseVersion: the YAML number 1.1 carried as the declared text, in both document schemas', ['CFDocumentDType', 'CFPckgDocumentDType'].map((schemaName) => (nodeById[`case:${schemaName}/caseVersion/enum/1.1`] || { properties: {} }).properties.name).join('|'), '1.1|1.1');
	harness.equal('stats: declared list-valued vendor extensions 26, declared member texts 2, vendor extensions 65', `${forgeResult.stats.declaredListVendorExtensionCount}|${forgeResult.stats.declaredMemberTextCount}|${forgeResult.stats.vendorExtensionCount}`, '26|2|65');
	const associationType = nodeById['case:CFAssociationDType/associationType'];
	harness.equal('CFAssociationDType.associationType: an extensible enum of 10 in an anyOf branch, its pattern branch carried', `${/^\/anyOf\/[0-9]+\/enum$/.test(nodeById['case:CFAssociationDType/associationType/enum'].properties.enumLocator)}|${forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && oneEdge.fromRef.id === 'case:CFAssociationDType/associationType/enum').length}|${JSON.parse(associationType.properties.compositionBranches).some((oneBranch) => oneBranch.valuePattern !== undefined)}`, 'true|10|true');
	const originEdge = forgeResult.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'case:CFAssociationDType/originNodeURI');
	harness.equal('CFAssociationDType.originNodeURI: a bare $ref to LinkGenURIDType, named as text for the judge', `${originEdge && originEdge.properties.referenceConstruct}|${originEdge && originEdge.toRef.id}|${nodeById['case:CFAssociationDType/originNodeURI'].properties.referencedSchemaNames}`, '$ref|case:LinkGenURIDType|LinkGenURIDType');
	const rootNode = nodeById['case:root'];
	harness.equal('the root: version, publishedVersion, versionSource', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('the root: sourceFormat openapi-yaml; sourceUrl from standardSourceLocation', `${rootNode.properties.sourceFormat}|${rootNode.properties.sourceUrl}`, 'openapi-yaml|https://purl.imsglobal.org/spec/case/v1p1/schema/openapi/imscasev1p1_openapi3_v1p0.yaml');
	harness.equal('the root: family CASE, description from info.description', `${rootNode.properties.standardFamily}|${/^The Competencies and Academic Standards Exchange \(CASE\) Service enables/.test(rootNode.properties.description)}`, 'CASE|true');
	next('', { ...args, forgeResult });
}));

// -----------------------------------------------------------------
// SECTION 3 — the round trip over the graph double, and its twins RED
// -----------------------------------------------------------------
taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'clean' }, (validateError, verdict) => {
	harness.section('SECTION 3 — the round trip: clean, every omission declared');
	harness.accepts('the validator runs', validateError ? [validateError] : []);
	if (validateError) {
		next(validateError, args);
		return;
	}
	harness.equal('inventedTotal 0, lostTotal 0, roundTripClean', `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
	harness.equal('explicitly omitted, by declared kind (the API around the data model; the two caseVersion retypings)', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	next('', args);
}));
const withNode = (stableId, changeProperties) => (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === stableId ? { ...oneNode, properties: changeProperties({ ...oneNode.properties }) } : oneNode)) });
const ROUND_TRIP_TWIN_LIST = [
	// a dropped REFERENCES edge disagrees with the property's derived referencedSchemaNames: the emitter refuses it by name
	{ twinName: 'originNodeReferenceDropped', expectation: 'fault', faultPattern: /CFAssociationDType\/originNodeURI' carries referencedSchemaNames "LinkGenURIDType" but its REFERENCES edges reach ""/, perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => !(oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'case:CFAssociationDType/originNodeURI')) }) },
	{ twinName: 'associationTypeValueDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'case:CFAssociationDType/associationType/enum/isChildOf') }) },
	{ twinName: 'caseVersionDeclaredValueDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'case:CFDocumentDType/caseVersion/enum/1.1') }) },
	// the K0 spelling of the digit-led vendor word: what the K1 kit forged, and what its pair could not read back
	{ twinName: 'confidentialityK0Spelling', expectation: 'both', perturb: withNode('case:CFItemDType', (properties) => { const { x_1edtechConfidentiality, ...otherProperties } = properties; return { ...otherProperties, x1edtechConfidentiality: x_1edtechConfidentiality }; }) },
	{ twinName: 'privacyListMemberAdded', expectation: 'invented', perturb: withNode('case:CFItemExtensionDType', (properties) => ({ ...properties, x_1edtechPrivacy: '["extensions","other"]' })) },
	{ twinName: 'blockScalarNewlineStripped', expectation: 'both', perturb: withNode('case:CFDocumentDType', (properties) => ({ ...properties, description: properties.description.replace(/\n$/, '') })) },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(copyOfForgeResult(args.forgeResult)), caseName: oneTwin.twinName }, (validateError, verdict) => {
	if (oneTwin === ROUND_TRIP_TWIN_LIST[0]) {
		harness.section('SECTION 3b — round-trip twins on the real graph, each observed RED');
	}
	const isRed = oneTwin.expectation === 'fault' ? oneTwin.faultPattern.test(`${validateError}`) : !validateError && verdict.roundTripClean === false
		&& (oneTwin.expectation === 'invented' ? verdict.inventedTotal >= 1 : true)
		&& (oneTwin.expectation === 'lost' ? verdict.lostTotal >= 1 : true)
		&& (oneTwin.expectation === 'both' ? verdict.lostTotal >= 1 && verdict.inventedTotal >= 1 : true);
	harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → lost ${verdict && verdict.lostTotal}, invented ${verdict && verdict.inventedTotal}`, isRed, validateError);
	next('', args);
})));

// -----------------------------------------------------------------
// SECTION 4 — determinism
// -----------------------------------------------------------------
taskList.push((args, next) => forgeSnapshot((forgeError, forgeResult) => {
	harness.section('SECTION 4 — determinism');
	const textOf = (result) => JSON.stringify({ nodes: result.nodes.map((oneNode) => [oneNode.stableId, oneNode.labels, oneNode.properties]), edges: result.edges });
	harness.ok('a second forge is identical', !forgeError && textOf(forgeResult) === textOf(args.forgeResult), forgeError);
	next('', args);
}));

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(scratchRootPath, { recursive: true, force: true });
	harness.report();
});
