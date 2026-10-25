#!/usr/bin/env node
'use strict';

// test-medbiqForge.js — the MedBiquitous forge bundle (nextStandards wave 3 lane I), Docker-free. It covers:
//   * the real snapshot 02 (the publisher repository's files at their own paths), forged in process;
//   * its measured counts, and the carriage of each MedBiquitous particular: the IEEE LOM binding under its own namespace, the external
//     PESC reference, the one declared enumeration repeat, Entrustment Scale, the fifteen schema sets, no field documentation, contextText;
//   * the round trip over the harness's graph double, with its omission table and a twin observed RED;
//   * the snapshot's provenance (snapshot 01 against 02), and determinism.
// The kit's own constructs and refusals are proven in lib/xsd-forge/test/test-xsdForgeKit.js; this suite proves the bundle and its bytes.
// The publisher's files are git-ignored (02/README_PROVENANCE.md has the acquisition recipe). A tree that has not run the recipe is
// REFUSED BY NAME in section 1 (the ac0f2cdd form), never a raw ENOENT. Writes only under os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the MedBiquitous forge bundle: provenance, counts, carriage, round trip, determinism (no Docker)

SYNOPSIS
     node forges/medbiq/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/medbiq/assets/standardSourceData/02 in process (no embedding) and asserts the measured counts and how the
     MedBiquitous constructs are carried. Runs the bundle's round-trip validator over the harness graph double, clean and perturbed.
     Writes only under os.tmpdir().

FILES
     forges/medbiq/assets/standardSourceData/0{1,2}/**/*.{xsd,wsdl}   git-ignored; see 02/README_PROVENANCE.md to acquire

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
const HELD_SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '01');
const TRACKED_FILE_NAME_LIST = Object.freeze(['SHA256SUMS', 'standardSourceLocation', 'README_PROVENANCE.md', 'manifest.json']);

// the measured expectation (snapshot 02, 2026-10-25), as data
const EXPECTED = Object.freeze({
	snapshotPublisherFileCount: 47,
	heldPublisherFileCount: 33,
	nodeCountByRole: { DmeStandardRoot: 1, DmeSupport: 413, DmeClass: 560, DmeProperty: 1768, DmeOptionSet: 146, DmeOptionValue: 624 },
	edgeCountByType: { HAS_SUPPORT: 37, HAS_DEFINITION: 519, HAS_CLASS: 536, HAS_PROPERTY: 1768, HAS_VALUE: 624, REFERENCES_TYPE: 1206, HAS_OPTION_SET: 129, SUBCLASS_OF: 180, REFERENCES: 504 },
	schemaFileCount: 37,
	schemaSetCount: 15,
	describedNodeCountByRole: { DmeClass: 34, DmeSupport: 1, DmeOptionSet: 1 },
	externalReferenceCountByNamespace: { 'http://www.w3.org/1999/xhtml': 8, 'http://purl.org/dc/terms/': 3, 'http://www.w3.org/2004/08/xop/include': 1, 'http://www.w3.org/XML/1998/namespace': 1, 'urn:org:pesc:sector:AcademicRecord:v1.7.0': 1 },
	explicitlyOmittedByKind: { excludedSchemaFile: 10 },
	repeatedOptionSetStableId: 'medbiq:type/ns.medbiq.org/lom/extend/v1#repurposingContextType',
	repeatedOptionSetValueCount: 8,
	declarationNames: 'medbiq|MedBiquitous|MedBiquitous|null',
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'medbiqForgeTest-'));
const checksumRowListOf = (snapshotDirPath) => fs.readFileSync(path.join(snapshotDirPath, 'SHA256SUMS'), 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '').map((oneLine) => ({ expectedSha256: oneLine.slice(0, 64), relativePath: oneLine.slice(64).trim() }));
const publisherRowListOf = (snapshotDirPath) => checksumRowListOf(snapshotDirPath).filter((oneRow) => TRACKED_FILE_NAME_LIST.indexOf(oneRow.relativePath) === -1);
const sha256Of = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const absentPublisherFileList = publisherRowListOf(SNAPSHOT_DIR_PATH).concat(publisherRowListOf(HELD_SNAPSHOT_DIR_PATH).map((oneRow) => ({ ...oneRow, isHeld: true })))
	.filter((oneRow) => !fs.existsSync(path.join(oneRow.isHeld ? HELD_SNAPSHOT_DIR_PATH : SNAPSHOT_DIR_PATH, oneRow.relativePath)))
	.map((oneRow) => `${oneRow.isHeld ? '01' : '02'}/${oneRow.relativePath}`);

const taskList = new taskListPlus();

// -----------------------------------------------------------------
// SECTION 1 — provenance: the bytes are present and are the ones SHA256SUMS names; snapshot 01 against 02
// -----------------------------------------------------------------
taskList.push((args, next) => {
	harness.section('SECTION 1 — snapshots 01 and 02: the bytes, the pin, the declaration');
	harness.accepts('the git-ignored publisher files are present (else run the recipe in 02/README_PROVENANCE.md)', absentPublisherFileList.slice(0, 5).map((oneName) => `absent: ${oneName}`).concat(absentPublisherFileList.length > 5 ? [`… and ${absentPublisherFileList.length - 5} more`] : []));
	if (absentPublisherFileList.length !== 0) {
		next('the MedBiquitous publisher bytes are absent: run the acquisition recipe in forges/medbiq/assets/standardSourceData/02/README_PROVENANCE.md', args);
		return;
	}
	const mismatchList = [SNAPSHOT_DIR_PATH, HELD_SNAPSHOT_DIR_PATH].reduce((soFar, snapshotDirPath) => soFar.concat(checksumRowListOf(snapshotDirPath).filter((oneRow) => sha256Of(path.join(snapshotDirPath, oneRow.relativePath)) !== oneRow.expectedSha256).map((oneRow) => `${path.basename(snapshotDirPath)}/${oneRow.relativePath}`)), []);
	harness.accepts('every file of 01 and 02 matches its SHA256SUMS row', mismatchList);
	harness.equal('snapshot 02 holds 47 publisher files', publisherRowListOf(SNAPSHOT_DIR_PATH).length, EXPECTED.snapshotPublisherFileCount);
	// the July manifest maps each held localPath to the repository path: every held file must be byte-identical in 02
	const manifest = JSON.parse(fs.readFileSync(path.join(HELD_SNAPSHOT_DIR_PATH, 'manifest.json'), 'utf8'));
	const sha256ByPathIn02 = checksumRowListOf(SNAPSHOT_DIR_PATH).reduce((byPath, oneRow) => ({ ...byPath, [oneRow.relativePath]: oneRow.expectedSha256 }), {});
	const sha256ByPathIn01 = checksumRowListOf(HELD_SNAPSHOT_DIR_PATH).reduce((byPath, oneRow) => ({ ...byPath, [oneRow.relativePath]: oneRow.expectedSha256 }), {});
	const heldDifferenceList = manifest.artifacts.filter((oneArtifact) => sha256ByPathIn01[oneArtifact.localPath] !== sha256ByPathIn02[oneArtifact.path]).map((oneArtifact) => oneArtifact.path);
	harness.equal('the 33 held files are byte-identical in 02 at the repository paths', `${manifest.artifacts.length}|${heldDifferenceList.join(',')}`, `${EXPECTED.heldPublisherFileCount}|`);
	const forgeDeclaration = require(path.join(BUNDLE_DIR_PATH, 'lib', 'medbiqForgeDeclaration'));
	harness.equal('declaration names (DESIGN-I0 §4)', `${forgeDeclaration.standardKey}|${forgeDeclaration.standardSource}|${forgeDeclaration.standardFamily}|${forgeDeclaration.nativeIdentifierPropertyName}`, EXPECTED.declarationNames);
	harness.match('the root sourceUrl is the publisher repository', fs.readFileSync(path.join(SNAPSHOT_DIR_PATH, 'standardSourceLocation'), 'utf8'), /^upstreamUrl: https:\/\/github\.com\/medbiq\/medbiq$/m);
	next('', args);
});

// -----------------------------------------------------------------
// SECTION 2 — the real snapshot forged: counts and carriage
// -----------------------------------------------------------------
taskList.push((args, next) => {
	const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeMedbiq'))({ embedder: null });
	bundle.forge({ sourcePath: SNAPSHOT_DIR_PATH, owner: 'test', skipEmbedding: true }, (forgeError, forgeResult) => {
		harness.section('SECTION 2 — snapshot 02 forged in process: the measured counts and the carriage');
		harness.accepts('the real snapshot forges', forgeError ? [forgeError] : []);
		if (forgeError) {
			next(forgeError, args);
			return;
		}
		const contentNodeList = forgeResult.nodes.filter((oneNode) => oneNode.role !== 'DmeEmbedText');
		const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
		const propertyNodeList = contentNodeList.filter((oneNode) => oneNode.role === 'DmeProperty');
		const schemaFileNodeList = contentNodeList.filter((oneNode) => oneNode.properties.xsdConstruct === 'schema');
		harness.equal('content node count by role', sortedText(countBy(contentNodeList, (oneNode) => oneNode.role)), sortedText(EXPECTED.nodeCountByRole));
		harness.equal('structural edge count by type', sortedText(countBy(forgeResult.edges.filter((oneEdge) => oneEdge.type !== 'EMBEDS_TEXT_OF'), (oneEdge) => oneEdge.type)), sortedText(EXPECTED.edgeCountByType));
		harness.equal('37 forged files; the 10 excluded mint nothing', schemaFileNodeList.length, EXPECTED.schemaFileCount);
		harness.equal('fifteen schema sets, every file reached by at least one', `${new Set(schemaFileNodeList.reduce((soFar, oneNode) => soFar.concat(JSON.parse(oneNode.properties.schemaSetNameList)), [])).size}|${schemaFileNodeList.filter((oneNode) => JSON.parse(oneNode.properties.schemaSetNameList).length === 0).length}`, `${EXPECTED.schemaSetCount}|0`);
		harness.equal('documentation: 34 types and two simple types, NO field', sortedText(forgeResult.stats.describedNodeCountByRole), sortedText(EXPECTED.describedNodeCountByRole));
		harness.equal('K3c: 113 fields carry their option set\'s value names; 4 their owning type\'s description', `${propertyNodeList.filter((oneNode) => oneNode.properties.optionValueNameList !== undefined).length}|${propertyNodeList.filter((oneNode) => oneNode.properties.owningTypeDescription !== undefined).length}`, '113|4');
		harness.equal('every field carries contextText = its path', propertyNodeList.filter((oneNode) => oneNode.properties.contextText !== oneNode.properties.path || !/\./.test(oneNode.properties.contextText)).length, 0);
		harness.equal('external references (no edge): xhtml, Dublin Core, xop, xml, and PESC AcademicRecord', sortedText(forgeResult.stats.externalReferenceCountByNamespace), sortedText(EXPECTED.externalReferenceCountByNamespace));
		harness.ok('the PESC base is carried as written on Educational Achievement, never resolved (FBB-001)', contentNodeList.some((oneNode) => oneNode.properties.schemaFile === 'educationalachievement/v1/educationalachievement.xsd' && /"attributeValue":"AcRec:EducationTestScoresType"/.test(oneNode.properties.xsdStructureList || '')) && contentNodeList.every((oneNode) => !/pesc/i.test(oneNode.stableId)));
		harness.ok('the IEEE LOM binding is forged under ITS namespace (ids name ltsc.ieee.org/xsd/LOM)', nodeById['medbiq:type/ltsc.ieee.org/xsd/LOM#lom'] !== undefined && contentNodeList.filter((oneNode) => /\/ltsc\.ieee\.org\/xsd\/LOM[#/]/.test(oneNode.stableId)).length > 0);
		harness.equal('the declared repeat: repurposingContextType has 8 values from 9 enumerations', forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && oneEdge.fromRef.id === EXPECTED.repeatedOptionSetStableId).length, EXPECTED.repeatedOptionSetValueCount);
		harness.ok('Entrustment Scale v1 (absent from the held manifest) is forged', schemaFileNodeList.some((oneNode) => oneNode.properties.schemaFile === 'entrustmentscale/v1/entrustmentscale.xsd'));
		harness.ok('the publisher\'s licence notice rides verbatim on a file node', schemaFileNodeList.some((oneNode) => /Users are bound by the terms of the MedBiquitous Consortium XML Public License/.test(oneNode.properties.xsdStructureList || '')));
		harness.ok('no node property names a hub (FBB-001)', contentNodeList.every((oneNode) => Object.keys(oneNode.properties).every((propertyName) => !/ceds|ctdl/i.test(propertyName))));
		args.forgeResult = forgeResult;
		next('', args);
	});
});

// -----------------------------------------------------------------
// SECTION 3 — the round trip over the graph double, and a twin RED
// -----------------------------------------------------------------
const validateDouble = ({ forgeResult, caseName }, callback) => {
	const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
	const outputPath = path.join(scratchRootPath, `verdict-${caseName}`);
	fs.mkdirSync(outputPath, { recursive: true });
	validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: SNAPSHOT_DIR_PATH, outputPath }, callback);
};
taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'clean' }, (validateError, verdict) => {
	harness.section('SECTION 3 — the round trip: clean, the ten exclusions omitted by declaration, RED when perturbed');
	harness.accepts('the round trip runs', validateError ? [validateError] : []);
	if (validateError) {
		next(validateError, args);
		return;
	}
	harness.equal('invented 0, lost 0', `${verdict.inventedTotal}|${verdict.lostTotal}`, '0|0');
	harness.equal('explicitly omitted: the ten excluded files', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	const copy = copyOfForgeResult(args.forgeResult);
	const victim = copy.nodes.find((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.minOccurs !== undefined);
	delete victim.properties.minOccurs;
	validateDouble({ forgeResult: copy, caseName: 'twinDroppedMinOccurs' }, (twinError, twinVerdict) => {
		harness.ok('twin RED: a dropped minOccurs is lost', !twinError && twinVerdict.lostTotal === 1, twinError || `lost ${twinVerdict.lostTotal}`);
		next('', args);
	});
}));

// -----------------------------------------------------------------
// SECTION 4 — determinism
// -----------------------------------------------------------------
taskList.push((args, next) => {
	const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeMedbiq'))({ embedder: null });
	bundle.forge({ sourcePath: SNAPSHOT_DIR_PATH, owner: 'test', skipEmbedding: true }, (forgeError, secondResult) => {
		harness.section('SECTION 4 — determinism');
		harness.ok('a second forge is byte-identical (nodes and edges)', !forgeError && JSON.stringify({ nodes: secondResult.nodes, edges: secondResult.edges }) === JSON.stringify({ nodes: args.forgeResult.nodes, edges: args.forgeResult.edges }), forgeError || 'differs');
		next('', args);
	});
});

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	harness.report();
});
