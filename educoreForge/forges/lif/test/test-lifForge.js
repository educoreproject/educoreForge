#!/usr/bin/env node
'use strict';

// test-lifForge.js — the LIF forge bundle (nextStandards-102326 lane C1), Docker-free: the real snapshot 02 forged in process, its
// measured counts and the carriage of each LIF construct, the profile's statementOmissionDeclaration shown to be exactly what the bytes
// need, the round trip over the harness's graph double with its omission table and twins observed RED, the snapshot's provenance, and
// determinism. The kit's constructs and refusals are proven in lib/openapi-forge/test/test-openapiDereferencedKit.js; this suite proves
// the bundle and its bytes. Writes only under os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the LIF forge bundle: counts, carriage, declared omissions, round trip, provenance, determinism (no Docker)

SYNOPSIS
     node forges/lif/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/lif/assets/standardSourceData/02 in process (no embedding) and asserts the measured counts (140 classes, 1,393
     properties, 23 enums, 1,873 values, 132 inline-object references) and how the LIF constructs are carried. Proves the profile's
     statementOmissionDeclaration is neither short nor stale. Runs the bundle's round-trip validator over the harness graph double,
     clean and on perturbations. Writes only under os.tmpdir().

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
const forgeFramework = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'forge-framework'));
const openapiHooksFactory = require(path.join(TREE_ROOT, 'lib', 'openapi-forge', 'openapiHooks'));

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '02');
const SOURCE_FILE_NAME = 'lif-schema.json';
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeLif'))({ embedder: null });
const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
const forgeDeclaration = require(path.join(BUNDLE_DIR_PATH, 'lib', 'lifForgeDeclaration'));
const openapiProfile = require(path.join(BUNDLE_DIR_PATH, 'lib', 'lifOpenapiProfile.json'));

// the measured expectation (snapshot 02, lif-core 290987a0, measured 2026-10-24), as data
const EXPECTED = Object.freeze({
	sourceSha256: 'b79598bbd3619d8d503828969f749e26238a1557e5fd66fba5baa2f07e36c3bc',
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 140, DmeProperty: 1393, DmeOptionSet: 23, DmeOptionValue: 1873 },
	edgeCountByType: { HAS_CLASS: 8, HAS_PROPERTY: 1393, REFERENCES: 132, HAS_OPTION_SET: 23, HAS_VALUE: 1873 },
	classCountByDataType: { array: 62, object: 78 },
	describedPropertyCount: 1082,
	useRecommendationsCountByRole: { DmeClass: 5, DmeProperty: 549 },
	requiredPropertyCount: 526,
	refNamedPropertyCount: 77,
	emptyValueOmittedCountByKeyword: { description: 179, format: 1126, use_recommendations: 847, example: 1261, required: 6 },
	// openapi, info, paths (out of scope); the empties above; the one Image repeat
	explicitlyOmittedByKind: { outOfScopeByDeclaration: 3, emptyValueStatement: 3419, repeatedEnumMember: 1 },
	rootVersionText: '2.0|2.0|spec', // version, publishedVersion, versionSource: info.version agrees with standardSourceLocation
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const contentCountBy = (itemList, nameOf, roleOrTypeList) => countBy(itemList.filter((oneItem) => roleOrTypeList.indexOf(nameOf(oneItem)) !== -1), nameOf);
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lifForgeTest-'));
const sourceDocument = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME), 'utf8'));

const forgeSnapshot = (callback) => bundle.forge({ sourcePath: path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
// forgeWithDeclaration — the real bytes through the kit under ANOTHER statementOmissionDeclaration (the bundle's declaration otherwise)
const forgeWithDeclaration = (statementOmissionDeclaration, callback) => {
	const changedProfile = { ...openapiProfile, statementOmissionDeclaration };
	forgeFramework({ embedder: null }).injectStandardHooks({ forgeDeclaration, hooks: openapiHooksFactory({ openapiProfile: changedProfile }) })
		.forge({ sourcePath: path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
};
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
	harness.equal('lif-schema.json sha256 is lif-core 290987a0 (= the 2026-10-23 head)', crypto.createHash('sha256').update(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, SOURCE_FILE_NAME))).digest('hex'), EXPECTED.sourceSha256);
	harness.equal('the source says openapi 3.0.0, info.version 2.0, eight entities', `${sourceDocument.openapi}|${sourceDocument.info.version}|${Object.keys(sourceDocument.components.schemas).length}`, '3.0.0|2.0|8');
	harness.equal('declaration names', `${forgeDeclaration.standardKey}|${forgeDeclaration.standardSource}|${forgeDeclaration.standardFamily}|${forgeDeclaration.nativeIdentifierPropertyName}`, 'lif|LIF|LIF|null');
	harness.ok('the Apache-2.0 LICENSE travels with the snapshot', /Apache License\s+Version 2\.0/.test(fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, 'LICENSE'), 'utf8')));
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
	const nodeListOf = (role) => forgeResult.nodes.filter((oneNode) => oneNode.role === role);
	harness.equal('content node count by role (140 classes, 1,393 properties, 23 enums, 1,873 values)', sortedText(contentCountBy(forgeResult.nodes, (oneNode) => oneNode.role, Object.keys(EXPECTED.nodeCountByRole))), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('content edge count by type', sortedText(contentCountBy(forgeResult.edges, (oneEdge) => oneEdge.type, Object.keys(EXPECTED.edgeCountByType))), sortedText(EXPECTED.edgeCountByType));
	harness.equal('classes by dataType (LIF types its entities and 54 nested objects array)', sortedText(countBy(nodeListOf('DmeClass'), (oneNode) => oneNode.properties.dataType)), sortedText(EXPECTED.classCountByDataType));
	harness.equal('no reference recovered: every REFERENCES edge is an inline object to its own /inline class', forgeResult.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES' && !(oneEdge.properties.referenceConstruct === 'inlineObject' && oneEdge.toRef.id === `${oneEdge.fromRef.id}/inline`)).length, 0);
	harness.equal('1,082 properties carry a description (179 stated empty, 132 object-valued state none); no class carries one', `${nodeListOf('DmeProperty').filter((oneNode) => oneNode.properties.description !== undefined).length}|${nodeListOf('DmeClass').filter((oneNode) => oneNode.properties.description !== undefined).length}`, `${EXPECTED.describedPropertyCount}|0`);
	harness.equal('useRecommendations carried where LIF states it non-empty', sortedText(countBy(forgeResult.nodes.filter((oneNode) => oneNode.properties.useRecommendations !== undefined), (oneNode) => oneNode.role)), sortedText(EXPECTED.useRecommendationsCountByRole));
	harness.equal('no node carries an empty string, and no exampleValue (every LIF example is \'\')', `${forgeResult.nodes.filter((oneNode) => Object.values(oneNode.properties).some((propertyValue) => propertyValue === '')).length}|${forgeResult.nodes.filter((oneNode) => oneNode.properties.exampleValue !== undefined).length}`, '0|0');
	harness.equal('the declared empties, counted per keyword', sortedText(forgeResult.stats.emptyValueOmittedCountByKeyword), sortedText(EXPECTED.emptyValueOmittedCountByKeyword));
	harness.equal('isRequired true on 526 properties', nodeListOf('DmeProperty').filter((oneNode) => oneNode.properties.isRequired === true).length, EXPECTED.requiredPropertyCount);
	harness.equal('Person.Consent.lifEntities: 56 stated, Image carried once (55 values), the repeat counted', `${forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && oneEdge.fromRef.id === 'lif:Person/Consent/inline/lifEntities/enum').length}|${forgeResult.stats.enumMemberRepeatOmittedCount}`, '55|1');
	harness.equal('a member with spaces is percent-encoded in its id, verbatim in its name', nodeById['lif:Person/Demographics/inline/tribalNationName/enum/Arctic%20Village'] && nodeById['lif:Person/Demographics/inline/tribalNationName/enum/Arctic%20Village'].properties.name, 'Arctic Village');
	harness.equal('identifier (a string) and Identifier (an object) are two properties of Organization', `${nodeById['lif:Organization/identifier'].properties.dataType}|${Boolean(nodeById['lif:Organization/Identifier/inline'])}`, 'string|true');
	const refNamedList = nodeListOf('DmeProperty').filter((oneNode) => /Ref[A-Z]\w*$/.test(oneNode.properties.name));
	harness.equal('77 ...Ref<Entity> properties, none linked to the entity it names (ruled: no name inference)', `${refNamedList.length}|${refNamedList.filter((oneNode) => forgeResult.edges.some((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === oneNode.stableId && oneEdge.toRef.id !== `${oneNode.stableId}/inline`)).length}`, `${EXPECTED.refNamedPropertyCount}|0`);
	const rootNode = nodeById['lif:root'];
	harness.equal('the root: version, publishedVersion, versionSource', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('the root: description from info.description; sourceUrl from standardSourceLocation', `${rootNode.properties.description}|${rootNode.properties.sourceUrl}`, 'OpenAPI Spec|https://github.com/LIF-Initiative/lif-core/blob/290987a08dd08c3a5a01a8833b9a768e3ded69e4/reference_data/schemas/lif-schema.json');
	harness.equal('the root: family LIF', rootNode.properties.standardFamily, 'LIF');
	next('', { ...args, forgeResult });
}));

// -----------------------------------------------------------------
// SECTION 2b — the declaration is exactly what the bytes need: each entry removed refuses, a stale one refuses
// -----------------------------------------------------------------
const { emptyValueKeywordList, enumMemberRepeatList } = openapiProfile.statementOmissionDeclaration;
const DECLARATION_TWIN_LIST = emptyValueKeywordList.map((keywordName) => ({
	twinName: `without '${keywordName}'`,
	statementOmissionDeclaration: { emptyValueKeywordList: emptyValueKeywordList.filter((oneName) => oneName !== keywordName), enumMemberRepeatList },
	refusalPattern: keywordName === 'required' ? /'\/required' is not a non-empty list of distinct names/ : new RegExp(`'/${keywordName}' is the empty string`),
})).concat([
	{ twinName: 'without the Image repeat', statementOmissionDeclaration: { emptyValueKeywordList, enumMemberRepeatList: [] }, refusalPattern: /lifEntities: '\/enum' lists 'Image' twice/ },
	{ twinName: 'with a stale keyword', statementOmissionDeclaration: { emptyValueKeywordList: emptyValueKeywordList.concat(['pattern']), enumMemberRepeatList }, refusalPattern: /names 'pattern', which the source never states empty/ },
]);
DECLARATION_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => forgeWithDeclaration(oneTwin.statementOmissionDeclaration, (forgeError) => {
	if (oneTwin === DECLARATION_TWIN_LIST[0]) {
		harness.section('SECTION 2b — the statementOmissionDeclaration is neither short nor stale (each twin observed RED)');
	}
	harness.rejects(`REFUSED: declaration ${oneTwin.twinName}`, forgeError ? [forgeError] : [], oneTwin.refusalPattern);
	next('', args);
})));

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
	harness.equal('explicitly omitted, by declared kind', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	next('', args);
}));
const ROUND_TRIP_TWIN_LIST = [
	{ twinName: 'tribalNationValueDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'lif:Person/Demographics/inline/tribalNationName/enum/Arctic%20Village') }) },
	{ twinName: 'useRecommendationsDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'lif:Assessment/identifier' ? { ...oneNode, properties: Object.fromEntries(Object.entries(oneNode.properties).filter(([propertyName]) => propertyName !== 'useRecommendations')) } : oneNode)) }) },
	{ twinName: 'descriptionAltered', expectation: 'both', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'lif:Person/Contact/inline/Address/inline/addressState' ? { ...oneNode, properties: { ...oneNode.properties, description: `${oneNode.properties.description} (edited)` } } : oneNode)) }) },
	{ twinName: 'inventedProperty', expectation: 'invented', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'lif:Course' ? { ...oneNode, properties: { ...oneNode.properties, inventedNote: 'not in the source' } } : oneNode)) }) },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(copyOfForgeResult(args.forgeResult)), caseName: oneTwin.twinName }, (validateError, verdict) => {
	if (oneTwin === ROUND_TRIP_TWIN_LIST[0]) {
		harness.section('SECTION 3b — round-trip twins on the real graph, each observed RED');
	}
	const isRed = !validateError && verdict.roundTripClean === false
		&& (oneTwin.expectation === 'lost' ? verdict.lostTotal >= 1 : true)
		&& (oneTwin.expectation === 'invented' ? verdict.inventedTotal >= 1 : true)
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
