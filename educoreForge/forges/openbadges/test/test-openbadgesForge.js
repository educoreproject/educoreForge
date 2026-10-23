#!/usr/bin/env node
'use strict';

// test-openbadgesForge.js — the Open Badges 3.0 forge bundle (nextStandards-102326 lane A1), Docker-free: the real snapshot forged in
// process, its measured counts and the carriage of each Open Badges construct, the round trip over the harness's graph double with
// its omission table and twins observed RED, the snapshot's provenance, and determinism. The kit's own constructs and refusals
// are proven in lib/openapi-forge/test/test-openapiForgeKit.js; this suite proves the bundle and its bytes. Writes only under
// os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the Open Badges 3.0 forge bundle: counts, carriage, round trip, provenance, determinism (no Docker)

SYNOPSIS
     node forges/openbadges/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/openbadges/assets/standardSourceData/01 in process (no embedding) and asserts the measured counts (32 schemas,
     201 properties, 9 enums, 115 values, 48 references) and how the Open Badges constructs are carried. Runs the bundle's
     round-trip validator over the harness graph double, clean and on perturbations. Writes only under os.tmpdir().

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
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '01');
const SOURCE_FILE_NAME = 'ob_v3p0_oas.json';
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeOpenbadges'))({ embedder: null });
const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
const forgeDeclaration = require(path.join(BUNDLE_DIR_PATH, 'lib', 'openbadgesForgeDeclaration'));

// the measured expectation (snapshot 01, 2026-10-23), as data
const EXPECTED = Object.freeze({
	sourceSha256: '816f431e9e8ad7f20f80551f9e3ba3143b059318a46c6edb0d357538fd063ba9',
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 32, DmeProperty: 201, DmeOptionSet: 9, DmeOptionValue: 115 },
	edgeCountByType: { HAS_CLASS: 32, HAS_PROPERTY: 201, REFERENCES: 48, HAS_OPTION_SET: 9, HAS_VALUE: 115 },
	referenceEdgeCountByConstruct: { $ref: 22, items: 24, oneOf: 2 },
	enumLocatorCount: { '/enum': 4, '/anyOf/0/enum': 5 },
	describedPropertyCount: 179,
	// openapi, info, servers, tags, paths; components.headers (1), .securitySchemes (1), .links (4)
	explicitlyOmittedByKind: { outOfScopeByDeclaration: 11 },
	rootVersionText: '3.0|3.0|spec', // version, publishedVersion, versionSource: info.version agrees with standardSourceLocation
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const contentCountBy = (itemList, nameOf, roleOrTypeList) => countBy(itemList.filter((oneItem) => roleOrTypeList.indexOf(nameOf(oneItem)) !== -1), nameOf);
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openbadgesForgeTest-'));
const sourceDocument = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME), 'utf8'));
const sourceRequiredCount = Object.values(sourceDocument.components.schemas).reduce((total, oneSchema) => total + (oneSchema.required || []).length, 0);

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
	harness.equal('ob_v3p0_oas.json sha256 is the 2026-05-28 held copy and the 2026-10-23 fetch', crypto.createHash('sha256').update(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME))).digest('hex'), EXPECTED.sourceSha256);
	harness.equal('the source says openapi 3.0.1, info.version 3.0, x-status Final', `${sourceDocument.openapi}|${sourceDocument.info.version}|${sourceDocument.info['x-status']}`, '3.0.1|3.0|Final');
	harness.equal('declaration names (plan Q-N8)', `${forgeDeclaration.standardKey}|${forgeDeclaration.standardSource}|${forgeDeclaration.standardFamily}|${forgeDeclaration.nativeIdentifierPropertyName}`, 'openbadges|OpenBadges|OpenBadges|null');
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
	harness.equal('content node count by role (32 schemas, 201 properties, 9 enums, 115 values)', sortedText(contentCountBy(forgeResult.nodes, (oneNode) => oneNode.role, Object.keys(EXPECTED.nodeCountByRole))), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('content edge count by type', sortedText(contentCountBy(forgeResult.edges, (oneEdge) => oneEdge.type, Object.keys(EXPECTED.edgeCountByType))), sortedText(EXPECTED.edgeCountByType));
	harness.equal('references by construct (22 bare $ref, 24 items, 2 issuer oneOf)', sortedText(forgeResult.stats.referenceEdgeCountByConstruct), sortedText(EXPECTED.referenceEdgeCountByConstruct));
	harness.equal('enum locations (4 direct, 5 extensible anyOf)', sortedText(countBy(forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeOptionSet'), (oneNode) => oneNode.properties.enumLocator)), sortedText(EXPECTED.enumLocatorCount));
	harness.equal('179 properties carry a description; the 22 bare $refs none', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.description !== undefined).length, EXPECTED.describedPropertyCount);
	harness.equal('every schema carries its description and xClassPid', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeClass' && oneNode.properties.description !== undefined && oneNode.properties.xClassPid !== undefined).length, 32);
	harness.equal('isRequired true on exactly the source required names', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.isRequired === true).length, sourceRequiredCount);
	const achievementType = nodeById['openbadges:Achievement/achievementType'];
	harness.equal('Achievement.achievementType: an extensible enum of 31 at /anyOf/0/enum, its pattern branch carried', `${nodeById['openbadges:Achievement/achievementType/enum'].properties.enumLocator}|${forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && oneEdge.fromRef.id === 'openbadges:Achievement/achievementType/enum').length}|${JSON.parse(achievementType.properties.compositionBranches)[1].valuePattern}`, '/anyOf/0/enum|31|(ext:)[a-zA-Z0-9\\.\\-_]+');
	const issuerEdge = forgeResult.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'openbadges:AchievementCredential/issuer');
	harness.equal('AchievementCredential.issuer: oneOf branch 1 references Profile', `${issuerEdge.properties.referenceConstruct}|${issuerEdge.properties.locator}|${issuerEdge.toRef.id}`, 'oneOf|/oneOf/1/$ref|openbadges:Profile');
	harness.equal('Achievement.alignment: items $ref to Alignment; xSrcpropPid names the value type', `${forgeResult.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'openbadges:Achievement/alignment').properties.locator}|${nodeById['openbadges:Achievement/alignment'].properties.xSrcpropPid}`, '/items/$ref|org.1edtech.ob.v3p0.alignment.class');
	harness.equal('@context: its items oneOf branches carried (two string branches, no $ref)', JSON.parse(nodeById['openbadges:AchievementCredential/@context'].properties.compositionBranches).map((oneBranch) => oneBranch.locator).join(','), '/items/oneOf/0,/items/oneOf/1');
	const rootNode = nodeById['openbadges:root'];
	harness.equal('the root: version, publishedVersion, versionSource', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('the root: description from info.description; sourceUrl from standardSourceLocation', `${rootNode.properties.description}|${rootNode.properties.sourceUrl}`, 'Open Badges Data Model 3.0|https://purl.imsglobal.org/spec/ob/v3p0/schema/openapi/ob_v3p0_oas.json');
	harness.equal('the root: family OpenBadges, no native identifier stamped', `${rootNode.properties.standardFamily}|${rootNode.properties.nativeIdentifierPropertyName}`, 'OpenBadges|undefined');
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
	{ twinName: 'issuerProfileEdgeDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => !(oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'openbadges:AchievementCredential/issuer')) }) },
	{ twinName: 'achievementTypeValueDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'openbadges:Achievement/achievementType/enum/Badge') }) },
	{ twinName: 'descriptionAltered', expectation: 'both', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'openbadges:Profile' ? { ...oneNode, properties: { ...oneNode.properties, description: `${oneNode.properties.description} (edited)` } } : oneNode)) }) },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(copyOfForgeResult(args.forgeResult)), caseName: oneTwin.twinName }, (validateError, verdict) => {
	if (oneTwin === ROUND_TRIP_TWIN_LIST[0]) {
		harness.section('SECTION 3b — round-trip twins on the real graph, each observed RED');
	}
	const isRed = !validateError && verdict.roundTripClean === false
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
