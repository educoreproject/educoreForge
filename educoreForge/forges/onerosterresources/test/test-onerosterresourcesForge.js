#!/usr/bin/env node
'use strict';

// test-onerosterresourcesForge.js — the OneRoster 1.2 Resources forge bundle (nextStandards-102326 wave 3 lane H1), Docker-free: the real snapshot
// forged in process, its measured counts and the carriage of each construct, the round trip over the harness's graph double with its
// omission table and twins observed RED, the snapshot's provenance, and determinism. The kit's own constructs and refusals are proven in
// lib/openapi-forge/test/test-openapiForgeKit.js; this suite proves the bundle and its bytes. Writes only under os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the OneRoster 1.2 Resources forge bundle: counts, carriage, round trip, provenance, determinism (no Docker)

SYNOPSIS
     node forges/onerosterresources/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/onerosterresources/assets/standardSourceData/01 in process (no embedding) and asserts the measured counts (7 schemas,
     19 properties, 6 enums, 30 values, 5 references) and how the constructs are carried. Runs the bundle's
     round-trip validator over the harness graph double, clean and on perturbations. Writes only under os.tmpdir().

EXIT STATUS
     0 every assertion passed;  1 otherwise.

FILES
     forges/onerosterresources/assets/standardSourceData/01/orresources_v1p2_openapi3.json   git-ignored; see 01/README_PROVENANCE.md to acquire
     forges/onerosterresources/assets/standardSourceData/01/orresources-v1p2.zip    git-ignored; the publisher package it is extracted from
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

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '01');
const SOURCE_FILE_NAME = 'orresources_v1p2_openapi3.json';
const PACKAGE_FILE_NAME = 'orresources-v1p2.zip';
const PUBLISHER_FILE_NAME_LIST = Object.freeze([SOURCE_FILE_NAME, PACKAGE_FILE_NAME]);
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeOnerosterResources'))({ embedder: null });
const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
const forgeDeclaration = require(path.join(BUNDLE_DIR_PATH, 'lib', 'onerosterresourcesForgeDeclaration'));

// the measured expectation (snapshot 01, 2026-10-24), as data
const EXPECTED = Object.freeze({
	sha256ByFileName: { [SOURCE_FILE_NAME]: '9057a9e349996eba698220bfaf61ee9e0c656652cbf9336d432177d11f51a228', [PACKAGE_FILE_NAME]: 'ac6edbf51318f5660ab8b6a91a49a783583357dc12e5eb57b2ff58ec95bee170' },
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 7, DmeProperty: 19, DmeOptionSet: 6, DmeOptionValue: 30 },
	edgeCountByType: { HAS_CLASS: 7, HAS_PROPERTY: 19, REFERENCES: 5, HAS_OPTION_SET: 6, HAS_VALUE: 30 },
	referenceEdgeCountByConstruct: {"$ref": 3, "items": 2},
	enumLocatorCount: {"/enum": 5, "/anyOf/0/enum": 1},
	describedPropertyCount: 16,
	// openapi, info, servers, tags, paths; components.parameters and components.securitySchemes, member by member
	explicitlyOmittedByKind: { outOfScopeByDeclaration: 12 },
	rootVersionText: '1.2|1.2|spec', // version, publishedVersion, versionSource: info.version agrees with standardSourceLocation
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const contentCountBy = (itemList, nameOf, roleOrTypeList) => countBy(itemList.filter((oneItem) => roleOrTypeList.indexOf(nameOf(oneItem)) !== -1), nameOf);
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'onerosterresourcesForgeTest-'));
// The publisher's bytes are git-ignored (01/README_PROVENANCE.md has the acquisition recipe): a tree that has not run the recipe is REFUSED
// BY NAME in section 1, the JEDx, CASE and CLR form, never a raw ENOENT.
const absentFileNameList = PUBLISHER_FILE_NAME_LIST.filter((oneName) => !fs.existsSync(path.join(SNAPSHOT_DIR_PATH, oneName)));
const sourceDocument = absentFileNameList.length === 0 ? JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME), 'utf8')) : undefined;
const sourceRequiredCount = sourceDocument === undefined ? undefined : Object.values(sourceDocument.components.schemas).reduce((total, oneSchema) => total + (oneSchema.required || []).length, 0);

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
	harness.accepts('the git-ignored publisher files are present (else run the recipe in 01/README_PROVENANCE.md)', absentFileNameList.map((oneName) => `absent: ${oneName}`));
	if (absentFileNameList.length !== 0) {
		next('the OneRoster Resources publisher bytes are absent: run the acquisition recipe in forges/onerosterresources/assets/standardSourceData/01/README_PROVENANCE.md', args);
		return;
	}
	PUBLISHER_FILE_NAME_LIST.forEach((oneName) => harness.equal(`${oneName} sha256 is the 2026-10-24 fetch`, crypto.createHash('sha256').update(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, oneName))).digest('hex'), EXPECTED.sha256ByFileName[oneName]));
	harness.equal('the source says openapi 3.0.1, info.version 1.2, x-status Final', `${sourceDocument.openapi}|${sourceDocument.info.version}|${sourceDocument.info['x-status']}`, '3.0.1|1.2|Final');
	harness.equal('declaration names (BRONZE_CROWN ruling R2: three standards in family OneRoster)', `${forgeDeclaration.standardKey}|${forgeDeclaration.standardSource}|${forgeDeclaration.standardFamily}|${forgeDeclaration.releaseLabel}|${forgeDeclaration.nativeIdentifierPropertyName}`, 'onerosterresources|OneRoster-Resources-1.2|OneRoster|Resources|null');
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
	// the ids below are read by name: a forge whose ids left the onerosterresources: prefix stops here, named, rather than failing on an absent node
	harness.ok('the root sits at onerosterresources:root (the profile prefix is this service\'s own)', nodeById['onerosterresources:root'] !== undefined, forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeStandardRoot').map((oneNode) => oneNode.stableId).join(','));
	if (nodeById['onerosterresources:root'] === undefined) {
		next('the forged ids are not under onerosterresources:', args);
		return;
	}
	harness.equal('content node count by role (7 schemas, 19 properties, 6 enums, 30 values)', sortedText(contentCountBy(forgeResult.nodes, (oneNode) => oneNode.role, Object.keys(EXPECTED.nodeCountByRole))), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('content edge count by type', sortedText(contentCountBy(forgeResult.edges, (oneEdge) => oneEdge.type, Object.keys(EXPECTED.edgeCountByType))), sortedText(EXPECTED.edgeCountByType));
	harness.equal('references by construct', sortedText(forgeResult.stats.referenceEdgeCountByConstruct), sortedText(EXPECTED.referenceEdgeCountByConstruct));
	harness.equal('enum locations (direct, extensible anyOf)', sortedText(countBy(forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeOptionSet'), (oneNode) => oneNode.properties.enumLocator)), sortedText(EXPECTED.enumLocatorCount));
	harness.equal('16 properties carry a description; the 3 bare $refs none', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.description !== undefined).length, EXPECTED.describedPropertyCount);
	harness.equal('every schema carries its description and xClassPid', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeClass' && oneNode.properties.description !== undefined && oneNode.properties.xClassPid !== undefined).length, 7);
	harness.equal('isRequired true on exactly the source required names', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.isRequired === true).length, sourceRequiredCount);
	const extensibleProperty = nodeById['onerosterresources:Resource/roles'];
	harness.equal('Resource.roles: an extensible enum of 8 at /anyOf/0/enum, its pattern branch carried', `${nodeById['onerosterresources:Resource/roles/enum'].properties.enumLocator}|${forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && oneEdge.fromRef.id === 'onerosterresources:Resource/roles/enum').length}|${JSON.parse(extensibleProperty.properties.compositionBranches)[1].valuePattern}`, '/anyOf/0/enum|8|(ext:)[a-zA-Z0-9\\.\\-_]+');
	const referenceEdge = forgeResult.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'onerosterresources:SingleResource/resource');
	harness.equal('SingleResource.resource: a bare $ref to Resource, named as text for the judge', `${referenceEdge.properties.referenceConstruct}|${referenceEdge.properties.locator}|${referenceEdge.toRef.id}|${nodeById['onerosterresources:SingleResource/resource'].properties.referencedSchemaNames}`, '$ref|/$ref|onerosterresources:Resource|Resource');
	harness.equal('every property with a REFERENCES edge carries referencedSchemaNames', forgeResult.nodes.filter((oneNode) => oneNode.properties.referencedSchemaNames !== undefined).length, new Set(forgeResult.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES').map((oneEdge) => oneEdge.fromRef.id)).size);
	// a class whose name also occurs in another OneRoster service is THIS service's copy (DESIGN-H0 §2): every node and edge end is under
	// onerosterresources:, and the persistent ids are in this service's namespace. The twin moves Metadata into onerostergradebook: and the check must see it.
	const foreignIdListOf = (result) => result.nodes.map((oneNode) => oneNode.stableId).concat(result.edges.map((oneEdge) => oneEdge.toRef.id), result.edges.map((oneEdge) => oneEdge.fromRef.id)).filter((oneId) => oneId.indexOf('onerosterresources:') !== 0);
	harness.equal('every node and edge end is a onerosterresources: id (no edge leaves the service)', foreignIdListOf(forgeResult).join(','), '');
	const twinResult = copyOfForgeResult(forgeResult);
	twinResult.nodes = twinResult.nodes.map((oneNode) => (oneNode.stableId === 'onerosterresources:Metadata' ? { ...oneNode, stableId: 'onerostergradebook:Metadata' } : oneNode));
	harness.ok('RED-OBSERVED: MetadataMovedToAnotherService → the onerosterresources: check names it', foreignIdListOf(twinResult).join(',') === 'onerostergradebook:Metadata', foreignIdListOf(twinResult).join(','));
	harness.equal('every xClassPid is in the org.1edtech.orresources.v1p2 namespace', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeClass' && oneNode.properties.xClassPid.indexOf('org.1edtech.orresources.v1p2.') !== 0).map((oneNode) => oneNode.stableId).join(','), '');
	const rootNode = nodeById['onerosterresources:root'];
	harness.equal('the root: version, publishedVersion, versionSource', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('the root: description from info.description; sourceUrl from standardSourceLocation (the package purl)', `${rootNode.properties.description}|${rootNode.properties.sourceUrl}`, `${sourceDocument.info.description}|https://purl.imsglobal.org/spec/orresources/v1p2/skill/orresources-v1p2.zip`);
	harness.equal('the root: family OneRoster, no native identifier stamped', `${rootNode.properties.standardFamily}|${rootNode.properties.nativeIdentifierPropertyName}`, 'OneRoster|undefined');
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
	harness.equal('explicitly omitted, by declared kind (the API around the data model)', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	next('', args);
}));
const ROUND_TRIP_TWIN_LIST = [
	// a dropped REFERENCES edge disagrees with the property's derived referencedSchemaNames: the emitter refuses it by name
	{ twinName: 'SingleResourceResourceEdgeDropped', expectation: 'fault', faultPattern: /SingleResource\/resource' carries referencedSchemaNames "Resource" but its REFERENCES edges reach ""/, perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => !(oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'onerosterresources:SingleResource/resource')) }) },
	{ twinName: 'optionValueDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'onerosterresources:Resource/roles/enum/student') }) },
	{ twinName: 'descriptionAltered', expectation: 'both', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'onerosterresources:Resource' ? { ...oneNode, properties: { ...oneNode.properties, description: `${oneNode.properties.description} (edited)` } } : oneNode)) }) },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(copyOfForgeResult(args.forgeResult)), caseName: oneTwin.twinName }, (validateError, verdict) => {
	if (oneTwin === ROUND_TRIP_TWIN_LIST[0]) {
		harness.section('SECTION 3b — round-trip twins on the real graph, each observed RED');
	}
	const isRed = oneTwin.expectation === 'fault' ? oneTwin.faultPattern.test(`${validateError}`) : !validateError && verdict.roundTripClean === false
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
