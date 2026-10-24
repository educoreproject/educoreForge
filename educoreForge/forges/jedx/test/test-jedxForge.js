#!/usr/bin/env node
'use strict';

// test-jedxForge.js — the JEDx forge bundle (nextStandards-102326 lane B1), Docker-free: the real snapshot 02 forged in process, its
// measured counts and the carriage of each JEDx construct, the round trip over the harness's graph double with its omission table and
// twins observed RED, the snapshot's provenance, and determinism. The kit's own constructs and refusals are proven in
// lib/openapi-forge/test/test-openapiDereferencedKit.js; this suite proves the bundle and its bytes. Writes only under os.tmpdir().
//
// The bundle bytes are git-ignored (02/README_PROVENANCE.md has the acquisition recipe). A clone that has not run the recipe fails
// SECTION 1 by name, never silently.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the JEDx forge bundle: counts, carriage, round trip, provenance, determinism (no Docker)

SYNOPSIS
     node forges/jedx/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/jedx/assets/standardSourceData/02 (the four JEDx Open API Specification bundles) in process, no embedding, and
     asserts the measured counts (191 components: 149 classes and 42 code lists; 16 anonymous inline classes; 694 properties; 609
     recovered references) and how the JEDx constructs are carried. Runs the bundle's round-trip validator over the harness graph
     double, clean and on perturbations. Writes only under os.tmpdir().

FILES
     forges/jedx/assets/standardSourceData/02/openApiBundles/   git-ignored; see ../README_PROVENANCE.md to acquire

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

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '02');
const openapiProfile = require(path.join(BUNDLE_DIR_PATH, 'lib', 'jedxOpenapiProfile.json'));
const forgeDeclaration = require(path.join(BUNDLE_DIR_PATH, 'lib', 'jedxForgeDeclaration'));

// the measured expectation (snapshot 02, 2026-10-24; independently reproduced by laneB/scripts/contentRule.py), as data
const EXPECTED = Object.freeze({
	sourceSha256ByFileName: {
		'openApiBundles/organizations-openapi-bundle_v1.json': '93e0662f691a6b809cefb7d4ec68296548ebce899dca088acc7b386fde0d1f58',
		'openApiBundles/workers-openapi-bundle_v1.json': '6e30f08bc01ab042f3fcc6a06d1c74b1836078b6a0cd2006a2aa49d5c60b939b',
		'openApiBundles/worker-compensation-reports-openapi-bundle_v1.json': 'a0293fe14f0cc56f060dccd532602a088ab7f868e8abf49259d6b842c158e587',
		'openApiBundles/worker-paid-hours-reports-openapi-bundle_v1.json': '2bb9e91d36a9b4173dfff8a0f66f2435aef05d763a8598376b4caf5f7e315fe7',
	},
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 165, DmeProperty: 694, DmeOptionSet: 57, DmeOptionValue: 1296 },
	edgeCountByType: { HAS_CLASS: 149, HAS_PROPERTY: 694, REFERENCES: 625, HAS_OPTION_SET: 57, HAS_VALUE: 1296 },
	statsCount: {
		sourceFileCount: 4, componentCount: 191, classComponentCount: 149, codeListCount: 42, codeListValueCount: 1201,
		referenceRecoveredCount: 609, referenceRecoveredByTieCount: 6, inlineClassCount: 16, inlineClassAnonymousCount: 16,
		localEnumCount: 15, localEnumValueCount: 95,
	},
	referenceRecoveredCountByConstruct: { inline: 402, inlineItems: 119, allOf: 51, definitions: 28, anyOf: 9 },
	// per bundle: openapi, info, servers, tags, externalDocs, paths and components.responses/parameters/headers/requestBodies
	explicitlyOmittedByKind: { outOfScopeByDeclaration: 292 },
	rootVersionText: '1.0.0|1.0.0|spec', // version, publishedVersion, versionSource: info.version agrees with standardSourceLocation
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const contentCountBy = (itemList, nameOf, roleOrTypeList) => countBy(itemList.filter((oneItem) => roleOrTypeList.indexOf(nameOf(oneItem)) !== -1), nameOf);
const pickedText = (stats, nameList) => nameList.map((oneName) => `${oneName}=${stats[oneName]}`).join(' ');
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jedxForgeTest-'));

let bundle = null;
let validator = null;
const forgeSnapshot = (callback) => bundle.forge({ sourcePath: SNAPSHOT_DIR_PATH, owner: 'test', skipEmbedding: true }, callback);
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
	harness.section('SECTION 1 — snapshot 02: the bytes, the pin, the declaration');
	const absentFileList = openapiProfile.sourceFileNameList.filter((oneFileName) => !fs.existsSync(path.join(SNAPSHOT_DIR_PATH, oneFileName)));
	harness.accepts('the four git-ignored bundles are present (else run the recipe in 02/README_PROVENANCE.md)', absentFileList.map((oneFileName) => `absent: ${oneFileName}`));
	if (absentFileList.length > 0) {
		next('the JEDx bundle bytes are absent: run the acquisition recipe in forges/jedx/assets/standardSourceData/02/README_PROVENANCE.md', args);
		return;
	}
	harness.equal('the profile reads exactly the four measured files', JSON.stringify(openapiProfile.sourceFileNameList.slice().sort()), JSON.stringify(Object.keys(EXPECTED.sourceSha256ByFileName).sort()));
	openapiProfile.sourceFileNameList.forEach((oneFileName) => harness.equal(`${oneFileName} sha256 is the 2026-10-23 acquisition (707ec7d)`, crypto.createHash('sha256').update(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, oneFileName))).digest('hex'), EXPECTED.sourceSha256ByFileName[oneFileName]));
	harness.equal('declaration names (plan Q-N8)', `${forgeDeclaration.standardKey}|${forgeDeclaration.standardSource}|${forgeDeclaration.standardFamily}|${forgeDeclaration.nativeIdentifierPropertyName}`, 'jedx|JEDx|JEDx|null');
	harness.equal('the pin is 02 (01, the July CSV, is a record only)', /^defaultSnapshot=02$/m.test(fs.readFileSync(path.join(BUNDLE_DIR_PATH, 'parserDescriptor.ini'), 'utf8')), true);
	bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeJedx'))({ embedder: null });
	validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
	next('', args);
});

// -----------------------------------------------------------------
// SECTION 2 — the real snapshot forged: counts and carriage
// -----------------------------------------------------------------
taskList.push((args, next) => forgeSnapshot((forgeError, forgeResult) => {
	harness.section('SECTION 2 — snapshot 02 forged in process: the measured counts and the carriage');
	harness.accepts('the real snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	const referenceEdgeOf = (fromStableId) => forgeResult.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === fromStableId);
	harness.equal('content node count by role (165 classes, 694 properties, 57 option sets, 1,296 values)', sortedText(contentCountBy(forgeResult.nodes, (oneNode) => oneNode.role, Object.keys(EXPECTED.nodeCountByRole))), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('content edge count by type', sortedText(contentCountBy(forgeResult.edges, (oneEdge) => oneEdge.type, Object.keys(EXPECTED.edgeCountByType))), sortedText(EXPECTED.edgeCountByType));
	harness.equal('the four bundles united: 191 components, 149 classes, 42 code lists, 609 references recovered by content', pickedText(forgeResult.stats, Object.keys(EXPECTED.statsCount)), pickedText(EXPECTED.statsCount, Object.keys(EXPECTED.statsCount)));
	harness.equal('references recovered by construct', sortedText(forgeResult.stats.referenceRecoveredCountByConstruct), sortedText(EXPECTED.referenceRecoveredCountByConstruct));
	harness.equal('every node is JEDx (_source)', forgeResult.nodes.filter((oneNode) => oneNode.properties._source !== 'JEDx').length, 0);
	const revenueEdge = referenceEdgeOf('jedx:OrganizationType/revenue');
	harness.equal('OrganizationType.revenue: an inline copy of AmountType, recovered by content; the SITE description is the property\'s', `${revenueEdge.properties.referenceConstruct}|${revenueEdge.toRef.id}|${nodeById['jedx:OrganizationType/revenue'].properties.description}`, 'inline|jedx:AmountType|The amount of revenue of the organization, typically from the most recent fiscal year.');
	harness.equal('AmountType keeps its own description beside the site text', nodeById['jedx:AmountType'].properties.description, 'An amount is a number of monetary units specified in a currency.');
	harness.equal('AmountType is one node across the bundles that carry it (bundleMembership)', JSON.parse(nodeById['jedx:AmountType'].properties.bundleMembership).length >= 2, true);
	const competencyCodeList = nodeById['jedx:codeList/CompetencyTypeCodeList'];
	harness.equal('a code list is an option set of the root; CompetencyTypeCodeList keeps the WRONG title it is published with (ERRATA E10)', `${competencyCodeList.role}|${competencyCodeList.properties.parentId}|${competencyCodeList.properties.schemaTitle}`, 'DmeOptionSet|jedx:root|WeekdayCodeList');
	harness.equal('an anonymous inline object is its own class at the site', nodeById['jedx:DataProtectionPolicyInclusion/dataProtectionPolicy/inline'].role, 'DmeClass');
	const rootNode = nodeById['jedx:root'];
	harness.equal('the root: version, publishedVersion, versionSource', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('the root: sourceUrl is the pinned commit; family JEDx', `${rootNode.properties.sourceUrl}|${rootNode.properties.standardFamily}`, 'https://github.com/HROpen/APISpecifications/tree/707ec7d3741df46f6973411e5dd75c756cf3d7d7|JEDx');
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
	harness.equal('explicitly omitted, by declared kind (the API around the data model, per bundle)', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	next('', args);
}));
const ROUND_TRIP_TWIN_LIST = [
	// a dropped recovered reference: the site's body is no longer stated by any component, so the source's $match is lost (or the pair
	// refuses the inconsistency by name)
	{ twinName: 'revenueAmountTypeEdgeDropped', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => !(oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'jedx:OrganizationType/revenue')) }) },
	{ twinName: 'codeListValueDropped', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'jedx:codeList/LegalOrganizationTypeCodeList/FederalGovernmentAgency') }) },
	{ twinName: 'descriptionAltered', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'jedx:AmountType' ? { ...oneNode, properties: { ...oneNode.properties, description: `${oneNode.properties.description} (edited)` } } : oneNode)) }) },
	{ twinName: 'bundleMembershipNarrowed', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'jedx:AmountType' ? { ...oneNode, properties: { ...oneNode.properties, bundleMembership: JSON.stringify(JSON.parse(oneNode.properties.bundleMembership).slice(1)) } } : oneNode)) }) },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(copyOfForgeResult(args.forgeResult)), caseName: oneTwin.twinName }, (validateError, verdict) => {
	if (oneTwin === ROUND_TRIP_TWIN_LIST[0]) {
		harness.section('SECTION 3b — round-trip twins on the real graph, each observed RED');
	}
	// RED is a refusal by name or a verdict that is not clean; a clean verdict on a perturbed graph is a blind instrument
	const isRed = Boolean(validateError) || (verdict && verdict.roundTripClean === false && verdict.lostTotal + verdict.inventedTotal >= 1);
	harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → ${validateError ? `refused: ${String(validateError).slice(0, 160)}` : `lost ${verdict.lostTotal}, invented ${verdict.inventedTotal}`}`, isRed, validateError);
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
