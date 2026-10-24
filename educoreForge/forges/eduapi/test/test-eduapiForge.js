#!/usr/bin/env node
'use strict';

// test-eduapiForge.js — the EduAPI 1.0 forge bundle (nextStandards wave 2 lane F), Docker-free: the real snapshot forged in
// process, its measured counts and the carriage of each EduAPI construct, the round trip over the harness's graph double with
// its omission table and twins observed RED, the snapshot's provenance, and determinism. The kit's own constructs and refusals
// are proven in lib/openapi-forge/test/test-openapiForgeKit.js; this suite proves the bundle and its bytes. Writes only under
// os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the EduAPI 1.0 forge bundle: counts, carriage, round trip, provenance, determinism (no Docker)

SYNOPSIS
     node forges/eduapi/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/eduapi/assets/standardSourceData/02 (the pin) in process (no embedding) and asserts the measured counts (39
     schemas, 341 properties, 62 enums, 319 values, 93 references) and how the EduAPI constructs are carried. Runs the bundle's
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
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '02');
const SOURCE_FILE_NAME = 'eduapi_v1p0_openapi3.json';
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeEduapi'))({ embedder: null });
const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
const forgeDeclaration = require(path.join(BUNDLE_DIR_PATH, 'lib', 'eduapiForgeDeclaration'));

// the measured expectation (snapshot 02, 2026-10-24), as data
const EXPECTED = Object.freeze({
	sourceSha256: 'cf7f2f32d721df48798a5dfe9d8bf261a53e0edc8464a9de5f916ac508cfb5ed',
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 39, DmeProperty: 341, DmeOptionSet: 62, DmeOptionValue: 319 },
	edgeCountByType: { HAS_CLASS: 39, HAS_PROPERTY: 341, REFERENCES: 93, HAS_OPTION_SET: 62, HAS_VALUE: 319 },
	referenceEdgeCountByConstruct: { $ref: 32, items: 61 },
	enumLocatorCount: { '/enum': 21, '/anyOf/0/enum': 41 },
	describedPropertyCount: 309,
	// openapi, info, servers, tags, paths, and every components section outside schemas (parameters, headers, securitySchemes,
	// links, ...): the API around the data model (plan Q-N3)
	explicitlyOmittedByKind: { outOfScopeByDeclaration: 16 },
	rootVersionText: '1.0|1.0|spec', // version, publishedVersion, versionSource: info.version agrees with standardSourceLocation
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const contentCountBy = (itemList, nameOf, roleOrTypeList) => countBy(itemList.filter((oneItem) => roleOrTypeList.indexOf(nameOf(oneItem)) !== -1), nameOf);
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'eduapiForgeTest-'));
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
	harness.section('SECTION 1 — snapshot 02: the bytes, the pin, the declaration');
	harness.equal('eduapi_v1p0_openapi3.json sha256 is the 2026-10-24 fetch (the Final; snapshot 01 holds the May Candidate Final)', crypto.createHash('sha256').update(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME))).digest('hex'), EXPECTED.sourceSha256);
	harness.equal('the source says openapi 3.0.1, info.version 1.0, x-status Final', `${sourceDocument.openapi}|${sourceDocument.info.version}|${sourceDocument.info['x-status']}`, '3.0.1|1.0|Final');
	harness.equal('declaration names (GATEREPORT-F0, ruled)', `${forgeDeclaration.standardKey}|${forgeDeclaration.standardSource}|${forgeDeclaration.standardFamily}|${forgeDeclaration.nativeIdentifierPropertyName}`, 'eduapi|EduAPI|EduAPI|null');
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
	harness.equal('content node count by role (39 schemas, 341 properties, 62 enums, 319 values)', sortedText(contentCountBy(forgeResult.nodes, (oneNode) => oneNode.role, Object.keys(EXPECTED.nodeCountByRole))), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('content edge count by type', sortedText(contentCountBy(forgeResult.edges, (oneEdge) => oneEdge.type, Object.keys(EXPECTED.edgeCountByType))), sortedText(EXPECTED.edgeCountByType));
	harness.equal('references by construct (32 bare $ref, 61 items)', sortedText(forgeResult.stats.referenceEdgeCountByConstruct), sortedText(EXPECTED.referenceEdgeCountByConstruct));
	harness.equal('enum locations (21 direct, 41 extensible anyOf)', sortedText(countBy(forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeOptionSet'), (oneNode) => oneNode.properties.enumLocator)), sortedText(EXPECTED.enumLocatorCount));
	harness.equal('309 properties carry a description; the 32 bare $refs none', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.description !== undefined).length, EXPECTED.describedPropertyCount);
	harness.equal('every schema carries its description and xClassPid', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeClass' && oneNode.properties.description !== undefined && oneNode.properties.xClassPid !== undefined).length, 39);
	harness.equal('isRequired true on exactly the source required names', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.isRequired === true).length, sourceRequiredCount);
	const enrollmentStatus = nodeById['eduapi:Enrollment/enrollmentStatus'];
	harness.equal('Enrollment.enrollmentStatus: an extensible enum of 17 at /anyOf/0/enum (interruption in lower case, as 02 spells it), its pattern branch carried', `${nodeById['eduapi:Enrollment/enrollmentStatus/enum'].properties.enumLocator}|${forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && oneEdge.fromRef.id === 'eduapi:Enrollment/enrollmentStatus/enum').length}|${nodeById['eduapi:Enrollment/enrollmentStatus/enum/interruption'] !== undefined}|${JSON.parse(enrollmentStatus.properties.compositionBranches)[1].valuePattern}`, '/anyOf/0/enum|17|true|(ext:)[a-zA-Z0-9\\.\\-_]+');
	const geoEdge = forgeResult.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'eduapi:TypedAddress/geo');
	harness.equal('TypedAddress.geo: a bare $ref to GeoCoordinates', `${geoEdge.properties.referenceConstruct}|${geoEdge.properties.locator}|${geoEdge.toRef.id}`, '$ref|/$ref|eduapi:GeoCoordinates');
	const otherCodesEdge = forgeResult.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'eduapi:Organization/otherCodes');
	harness.equal('Organization.otherCodes: items $ref to IdentifierEntry', `${otherCodesEdge.properties.locator}|${otherCodesEdge.toRef.id}`, '/items/$ref|eduapi:IdentifierEntry');
	harness.equal('xSrcpropPid names the value type (Enrollment.enrollmentStatus)', enrollmentStatus.properties.xSrcpropPid, 'org.1edtech.eduapi.v1p0.enrollmentstatusenum.class');
	harness.equal('a bare $ref property names its schema as text (Person.primaryAddress -> OptionallyTypedAddress; the judge sees it)', nodeById['eduapi:Person/primaryAddress'].properties.referencedSchemaNames, 'OptionallyTypedAddress');
	harness.equal('93 properties carry referencedSchemaNames (every property with a REFERENCES edge)', forgeResult.nodes.filter((oneNode) => oneNode.properties.referencedSchemaNames !== undefined).length, new Set(forgeResult.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES').map((oneEdge) => oneEdge.fromRef.id)).size);
	harness.equal('the eight empty <entity>Extensions schemas are forged as classes with no properties', forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeClass' && /Extensions$/.test(oneNode.properties.name) && !forgeResult.edges.some((oneEdge) => oneEdge.type === 'HAS_PROPERTY' && oneEdge.fromRef.id === oneNode.stableId)).length, 8);
	harness.equal('the source enum member CTDL-ASN is carried verbatim (LearningObjectiveSet.source)', nodeById['eduapi:LearningObjectiveSet/source/enum/CTDL-ASN'] !== undefined, true);
	const rootNode = nodeById['eduapi:root'];
	harness.equal('the root: version, publishedVersion, versionSource', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('the root: description from info.description; sourceUrl from standardSourceLocation', `${rootNode.properties.description}|${rootNode.properties.sourceUrl}`, 'Edu-API v1p0 Final Release|https://purl.imsglobal.org/spec/eduapi/v1p0/schema/openapi/eduapi_v1p0_openapi3.json');
	harness.equal('the root: family EduAPI, no native identifier stamped', `${rootNode.properties.standardFamily}|${rootNode.properties.nativeIdentifierPropertyName}`, 'EduAPI|undefined');
	harness.equal('per-standard labels: the Eduapi stem on every role (graph-contract PRODUCER_LOCAL_LABEL_PATTERN)', [...new Set(forgeResult.nodes.flatMap((oneNode) => oneNode.labels).filter((oneLabel) => /^Eduapi/.test(oneLabel)))].sort().join(','), 'EduapiEmbedText,EduapiEnum,EduapiEnumValue,EduapiProperty,EduapiRoot,EduapiSchema');
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
	{ twinName: 'geoCoordinatesEdgeDropped', expectation: 'fault', faultPattern: /TypedAddress\/geo' carries referencedSchemaNames "GeoCoordinates" but its REFERENCES edges reach ""/, perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => !(oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'eduapi:TypedAddress/geo')) }) },
	{ twinName: 'enrollmentStatusValueDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'eduapi:Enrollment/enrollmentStatus/enum/interruption') }) },
	{ twinName: 'descriptionAltered', expectation: 'both', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'eduapi:Person' ? { ...oneNode, properties: { ...oneNode.properties, description: `${oneNode.properties.description} (edited)` } } : oneNode)) }) },
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
