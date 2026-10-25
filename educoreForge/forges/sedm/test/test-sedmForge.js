#!/usr/bin/env node
'use strict';

// test-sedmForge.js — the SEDM forge bundle (nextStandards-102326 wave 2, lane G), Docker-free: snapshot 01 forged in process, its
// counts and carriage rules, every loader and walk refusal named (each on a perturbed COPY of the snapshot), the round trip over the
// harness's graph double and its twins observed RED, and determinism. Writes only under os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the SEDM forge bundle: counts, carriage, refusals, round trip, determinism (no Docker)

SYNOPSIS
     node forges/sedm/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/sedm/assets/standardSourceData/01 in process (no embedding) and asserts the measured counts (28 entities, 321
     elements, 117 option sets, 1,522 values, 123 support nodes) and the declared rules (membership, duplicate, whitespace, list
     terminator, ETL templates, the restated code list). Forges perturbed copies of the snapshot to observe each refusal by name.
     Runs the bundle's round-trip validator over the harness graph double and observes it RED on perturbations of the graph and of
     the source. Writes only under os.tmpdir().

FILES
     forges/sedm/assets/standardSourceData/01/{SEDM Logical Model and Maps - 6. CEDS Map.csv, sedm-domain-structures.json}   git-ignored;
     see 01/README_PROVENANCE.md to acquire. A tree without them is REFUSED BY NAME in section 1 (the JEDx / CASE form), never a raw ENOENT.

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
const { parseCsvText } = require(path.join(TREE_ROOT, 'forges', 'pescld', 'lib', 'pescldCsvReader'));

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const SNAPSHOT_DIR_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '01');
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgeSedm'))({ embedder: null });
const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
const sourceProfile = require(path.join(BUNDLE_DIR_PATH, 'lib', 'sedmSourceProfile.json'));
const sedmRoundTripPair = require(path.join(BUNDLE_DIR_PATH, 'lib', 'sedmRoundTripPair'))({ ruleModulePath: 'forges/sedm/lib/sedmRoundTripPair.js' });

// the measured expectation (snapshot 01, 2026-10-24; DESIGN-G0-sedm-102426.md), as data
const EXPECTED = Object.freeze({
	nodeCountByRole: { DmeStandardRoot: 1, DmeSupport: 123, DmeClass: 28, DmeProperty: 321, DmeOptionSet: 117, DmeOptionValue: 1522, DmeEmbedText: 707 },
	edgeCountByType: { HAS_SUPPORT: 123, REFERENCES: 405, HAS_CLASS: 28, HAS_PROPERTY: 321, HAS_OPTION_SET: 117, HAS_VALUE: 1522, EMBEDS_TEXT_OF: 962 },
	walkStatByName: { recordCount: 4465, inScopeRecordCount: 326, outOfScopeRecordCount: 4139, duplicateRecordCount: 5, whitespaceTrimmedCellCount: 7, listTerminatorCount: 113, etlReferenceEdgeCount: 341, supportReferenceEdgeCount: 64, omittedStructuresPathCount: 4, restatedDeclaredOptionSetCount: 1, declaredOptionSetCount: 1, declaredOptionValueCount: 4 },
	supportNodeCountByKind: { ontologyClass: 24, complianceCategory: 16, ideaIndicator: 18, eventMilestone: 23, iepComponent: 15, entityHierarchy: 12, useCase: 1, etlTemplate: 14 },
	sedmFlagCount: { y: 226, SC: 88, '?': 6, D: 1 },
	globalIdTextForm: { sixDigit: 230, Proposed: 3, absent: 88 },
	explicitlyOmittedByKind: { outOfScopeRecord: 4139, derivedColumn: 178, restatedMetadataColumn: 1374, listTerminator: 113, noOptionSetText: 115, whitespaceTrimmed: 7, vendorExtractColumn: 60, restatedOptionSet: 1, extractionMetadata: 1, groupDescription: 2, restatedCsvElement: 3 },
	rootVersionText: 'unknown|unknown|unknown',
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sedmForgeTest-'));
const columnPositionOf = (columnName) => sourceProfile.columnList.find((oneColumn) => oneColumn.columnName === columnName).position;
const POSITION = Object.freeze({
	entity: columnPositionOf('Entity'),
	name: columnPositionOf('Element Name'),
	definition: columnPositionOf('Definition'),
	optionSet: columnPositionOf('Option Set'),
	sedm: columnPositionOf('SEDM'),
	iepModel: columnPositionOf("TQ's IEP Model"),
	anyEtl: columnPositionOf('In any ETL template?'),
	directoryEtl: columnPositionOf('Directory ETL'),
});

// csvTextOf — records back to CSV text: every cell quoted, CRLF records, no final terminator (the snapshot's own form)
const csvTextOf = ({ headerList, recordList }) => [headerList].concat(recordList.map((oneRecord) => oneRecord.cellList))
	.map((cellList) => cellList.map((cellText) => `"${cellText.replace(/"/g, '""')}"`).join(','))
	.join('\r\n');
// editedCsvText — the snapshot CSV with editRecordList applied to its parsed records (a cell-level perturbation)
const editedCsvText = (editRecordList) => (csvText) => {
	const parsed = parseCsvText({ csvText, sourceFileName: sourceProfile.csvFileName });
	const editedRecordList = parsed.recordList.map((oneRecord) => ({ ...oneRecord, cellList: oneRecord.cellList.slice() }));
	const editedHeaderList = parsed.headerList.slice();
	editRecordList({ headerList: editedHeaderList, recordList: editedRecordList });
	return csvTextOf({ headerList: editedHeaderList, recordList: editedRecordList });
};
const editedStructuresText = (editStructures) => (structuresText) => {
	const structures = JSON.parse(structuresText);
	editStructures(structures);
	return JSON.stringify(structures, null, 2);
};
const firstInScope = (recordList, isTarget) => recordList.find((oneRecord) => oneRecord.cellList[POSITION.sedm].trim() !== '' && isTarget(oneRecord));

// perturbedSnapshotPath — a COPY of the snapshot with one file's text changed and SHA256SUMS rewritten, so the framework's
// checksum gate passes and the refusal under test is the loader's or the walk's own
const perturbedSnapshotPath = ({ caseName, fileName, perturbText, omitFromChecksumList }) => {
	const copyDirPath = path.join(scratchRootPath, caseName, 'standardSourceData', '01');
	fs.mkdirSync(copyDirPath, { recursive: true });
	fs.readdirSync(SNAPSHOT_DIR_PATH).forEach((oneName) => fs.copyFileSync(path.join(SNAPSHOT_DIR_PATH, oneName), path.join(copyDirPath, oneName)));
	if (fileName !== undefined) {
		const filePath = path.join(copyDirPath, fileName);
		fs.writeFileSync(filePath, perturbText(fs.readFileSync(filePath, 'utf8')));
	}
	const checksumText = fs.readFileSync(path.join(copyDirPath, 'SHA256SUMS'), 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '')
		.map((oneLine) => oneLine.replace(/^[0-9a-f]{64}\s+/, ''))
		.filter((oneName) => oneName !== omitFromChecksumList)
		.map((oneName) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(copyDirPath, oneName))).digest('hex')}  ${oneName}`)
		.join('\n');
	fs.writeFileSync(path.join(copyDirPath, 'SHA256SUMS'), `${checksumText}\n`);
	return copyDirPath;
};
const forgeSnapshot = ({ sourcePath }, callback) => bundle.forge({ sourcePath, owner: 'test', skipEmbedding: true }, callback);
const validateDouble = ({ forgeResult, caseName, snapshotPath }, callback) => {
	const outputPath = path.join(scratchRootPath, `verdict-${caseName}`);
	fs.mkdirSync(outputPath, { recursive: true });
	validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: snapshotPath === undefined ? SNAPSHOT_DIR_PATH : snapshotPath, outputPath }, callback);
};

// the two git-ignored working documents (01/README_PROVENANCE.md has the acquisition recipe)
const SOURCE_FILE_NAME_LIST = Object.freeze([sourceProfile.csvFileName, sourceProfile.structuresFileName]);
const absentSourceFileList = SOURCE_FILE_NAME_LIST.filter((oneFileName) => !fs.existsSync(path.join(SNAPSHOT_DIR_PATH, oneFileName)));

const taskList = new taskListPlus();

// -----------------------------------------------------------------
// SECTION 1 — the real snapshot: counts and carriage
// -----------------------------------------------------------------
taskList.push((args, next) => {
	harness.section('SECTION 1 — snapshot 01 forged in process: the measured counts and the declared rules');
	harness.accepts('the two git-ignored source files are present (else run the recipe in 01/README_PROVENANCE.md)', absentSourceFileList.map((oneFileName) => `absent: ${oneFileName}`));
	if (absentSourceFileList.length !== 0) {
		next('the SEDM working documents are absent: run the acquisition recipe in forges/sedm/assets/standardSourceData/01/README_PROVENANCE.md', args);
		return;
	}
	next('', args);
});
taskList.push((args, next) => forgeSnapshot({ sourcePath: SNAPSHOT_DIR_PATH }, (forgeError, forgeResult) => {
	harness.accepts('the real snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	harness.equal('node count by role (28 entities, 321 elements, 117 option sets, 1,522 values, 123 support nodes)', sortedText(countBy(forgeResult.nodes, (oneNode) => oneNode.role)), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('edge count by type', sortedText(countBy(forgeResult.edges, (oneEdge) => oneEdge.type)), sortedText(EXPECTED.edgeCountByType));
	Object.keys(EXPECTED.walkStatByName).forEach((statName) => harness.equal(`stats.${statName}`, forgeResult.stats[statName], EXPECTED.walkStatByName[statName]));
	harness.equal('support nodes by kind', sortedText(forgeResult.stats.supportNodeCountByKind), sortedText(EXPECTED.supportNodeCountByKind));
	const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	const rootNode = nodeById['sedm:root'];
	harness.equal('root version, publishedVersion, versionSource (working documents: no published version)', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('root standardFamily', rootNode.properties.standardFamily, 'SEDM');
	harness.ok('every node is _source SEDM', forgeResult.nodes.every((oneNode) => oneNode.properties._source === 'SEDM'));
	const elementNodeList = forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeProperty');
	harness.equal('the SEDM flag by value over the 321 elements', sortedText(countBy(elementNodeList, (oneNode) => oneNode.properties.sedmFlag)), sortedText(EXPECTED.sedmFlagCount));
	harness.equal('the Global ID cell, carried verbatim: six digits, Proposed, absent', sortedText(countBy(elementNodeList, (oneNode) => (oneNode.properties.globalIdText === undefined ? 'absent' : (/^\d{6}$/.test(oneNode.properties.globalIdText) ? 'sixDigit' : oneNode.properties.globalIdText)))), sortedText(EXPECTED.globalIdTextForm));
	harness.equal('320 of 321 elements carry a description', elementNodeList.filter((oneNode) => oneNode.properties.description !== undefined).length, 320);
	const twoDomainList = elementNodeList.filter((oneNode) => JSON.parse(oneNode.properties.domainList).length === 2);
	harness.equal('duplicate rule: the five two-record elements carry both domains, in record order', twoDomainList.map((oneNode) => JSON.parse(oneNode.properties.domainList)).filter((domainList) => domainList.join('|') === 'Early Learning|K12').length, 5);
	harness.ok('identity: the category is in the id (K12 Student holds four Program Participation Start Date elements)', elementNodeList.filter((oneNode) => oneNode.properties.name === 'Program Participation Start Date' && oneNode.stableId.startsWith('sedm:entity/K12%20Student/')).length === 4);
	const restatedSetElement = elementNodeList.find((oneNode) => oneNode.properties.name === 'Primary Disability Type');
	harness.ok('the JSON primaryDisabilityType list is NOT minted: the element owns it (13 values)', nodeById['sedm:declaredOptionSet/primaryDisabilityType'] === undefined && forgeResult.nodes.filter((oneNode) => oneNode.stableId.startsWith(`${restatedSetElement.stableId}/optionSet/`)).length === 13);
	harness.equal('the JSON accommodationCategories list is minted under the root with its 4 described values', forgeResult.nodes.filter((oneNode) => oneNode.stableId.startsWith('sedm:declaredOptionSet/accommodationCategories/') && oneNode.properties.description !== undefined).length, 4);
	const etlEdgeList = forgeResult.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.properties.locator === 'etlTemplate');
	harness.ok('every etlTemplate edge runs element -> SedmEtlTemplate', etlEdgeList.length === 341 && etlEdgeList.every((oneEdge) => nodeById[oneEdge.fromRef.id].role === 'DmeProperty' && nodeById[oneEdge.toRef.id].labels.indexOf('SedmEtlTemplate') !== -1));
	harness.equal('whitespace rule: the seven trimmed cells, by column', sortedText(countBy(forgeResult.stats.whitespaceTrimmedCellList, (oneTrim) => oneTrim.columnName)), sortedText({ Definition: 4, 'Option Set': 3 }));
	harness.ok('no edge leaves the standard (the forge makes no cross-standard edge)', forgeResult.edges.every((oneEdge) => nodeById[oneEdge.fromRef.id] !== undefined && nodeById[oneEdge.toRef.id] !== undefined));
	harness.ok('the Global ID is carried and resolved nowhere: no node property but globalIdText holds it', elementNodeList.filter((oneNode) => oneNode.properties.globalIdText !== undefined).every((oneNode) => Object.keys(oneNode.properties).filter((propertyName) => oneNode.properties[propertyName] === oneNode.properties.globalIdText).join() === 'globalIdText'));
	next('', { ...args, forgeResult });
}));

// -----------------------------------------------------------------
// SECTION 2 — every refusal named, each on a perturbed copy of the snapshot
// -----------------------------------------------------------------
const REFUSAL_CASE_LIST = [
	{ caseName: 'unlistedFile', omitFromChecksumList: sourceProfile.structuresFileName, refusalRegex: /'sedm-domain-structures\.json' is named by the source profile but not listed in SHA256SUMS/ },
	{ caseName: 'headerRenamed', fileName: sourceProfile.csvFileName, perturbText: editedCsvText(({ headerList }) => { headerList[POSITION.iepModel] = 'IEP Model'; }), refusalRegex: /position 21 is headed "IEP Model", not the profile's "TQ's IEP Model"/ },
	{ caseName: 'declaredEmptyFilled', fileName: sourceProfile.csvFileName, perturbText: editedCsvText(({ recordList }) => { recordList[7].cellList[POSITION.iepModel] = 'x'; }), refusalRegex: /column 'TQ's IEP Model' \(position 21\) holds "x"/ },
	{ caseName: 'duplicateDisagrees', fileName: sourceProfile.csvFileName, perturbText: editedCsvText(({ recordList }) => { recordList.filter((oneRecord) => oneRecord.cellList[POSITION.sedm].trim() !== '' && oneRecord.cellList[POSITION.entity] === 'Parent/Guardian' && oneRecord.cellList[POSITION.name] === 'Address City')[1].cellList[POSITION.definition] = 'changed'; }), refusalRegex: /\(Parent\/Guardian, Contact->Address, Address City\) column 'Definition' differs across its records/ },
	{ caseName: 'badEtlFlag', fileName: sourceProfile.csvFileName, perturbText: editedCsvText(({ recordList }) => { firstInScope(recordList, (oneRecord) => oneRecord.cellList[POSITION.directoryEtl] === 'Y').cellList[POSITION.directoryEtl] = 'X'; }), refusalRegex: /ETL column 'Directory ETL' holds 'X'/ },
	{ caseName: 'repeatedOptionCode', fileName: sourceProfile.csvFileName, perturbText: editedCsvText(({ recordList }) => { const target = firstInScope(recordList, (oneRecord) => oneRecord.cellList[POSITION.optionSet].includes(' - ')); target.cellList[POSITION.optionSet] = `${target.cellList[POSITION.optionSet].split('\n')[0]}\n${target.cellList[POSITION.optionSet]}`; }), refusalRegex: /option code '.*' is stated twice in one set/ },
	{ caseName: 'emptyListLine', fileName: sourceProfile.csvFileName, perturbText: editedCsvText(({ recordList }) => { const target = firstInScope(recordList, (oneRecord) => oneRecord.cellList[POSITION.optionSet].includes(' - ')); target.cellList[POSITION.optionSet] = target.cellList[POSITION.optionSet].replace('\n', '\n\n'); }), refusalRegex: /holds an empty line inside a list cell/ },
	{ caseName: 'unknownSection', fileName: sourceProfile.structuresFileName, perturbText: editedStructuresText((structures) => { structures.extraSection = []; }), refusalRegex: /structures section 'extraSection' is neither read nor omitted/ },
	{ caseName: 'unknownField', fileName: sourceProfile.structuresFileName, perturbText: editedStructuresText((structures) => { structures.complianceCategories[0].extraField = 'x'; }), refusalRegex: /field 'extraField' is not in this section's profile row/ },
	{ caseName: 'unknownContainerMember', fileName: sourceProfile.structuresFileName, perturbText: editedStructuresText((structures) => { structures.standardEventMilestones.extraMember = []; }), refusalRegex: /structures member 'standardEventMilestones\.extraMember' is neither read nor omitted/ },
	{ caseName: 'restatedListDiffers', fileName: sourceProfile.structuresFileName, perturbText: editedStructuresText((structures) => { structures.optionSets.primaryDisabilityType.values[0].name = 'Autism (changed)'; }), refusalRegex: /restates element 'Primary Disability Type', whose inline option set differs/ },
	{ caseName: 'danglingReference', fileName: sourceProfile.structuresFileName, perturbText: editedStructuresText((structures) => { structures.ideaIndicators[0].complianceCategory = 99; }), refusalRegex: /'complianceCategory' names complianceCategory '99', which the structures do not declare/ },
	{ caseName: 'wrongForm', fileName: sourceProfile.structuresFileName, perturbText: editedStructuresText((structures) => { structures.standardEventMilestones.milestoneTypes[0].ideaRequired = 'yes'; }), refusalRegex: /field 'ideaRequired' is not a boolean/ },
	{ caseName: 'malformedJson', fileName: sourceProfile.structuresFileName, perturbText: (structuresText) => structuresText.replace('{', '{,'), refusalRegex: /'sedm-domain-structures\.json' is not JSON/ },
];
REFUSAL_CASE_LIST.forEach((oneCase, caseIndex) => taskList.push((args, next) => forgeSnapshot({ sourcePath: perturbedSnapshotPath(oneCase) }, (forgeError) => {
	if (caseIndex === 0) {
		harness.section('SECTION 2 — every refusal named, each on a perturbed copy of the snapshot');
	}
	harness.rejects(`refused: ${oneCase.caseName}`, forgeError ? [forgeError] : [], oneCase.refusalRegex);
	next('', args);
})));

// -----------------------------------------------------------------
// SECTION 3 — the round trip over the graph double
// -----------------------------------------------------------------
taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'real' }, (validateError, verdict) => {
	harness.section('SECTION 3 — the round trip (snapshot 01 as the source) over the graph double');
	harness.accepts('the validator runs', validateError ? [validateError] : []);
	if (validateError) {
		next(validateError, args);
		return;
	}
	harness.equal('inventedTotal 0, lostTotal 0, roundTripClean', `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
	harness.equal('explicitly omitted, by declared kind', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	harness.ok('every whitespace omission carries its raw text', verdict.explicitlyOmittedList.filter((oneItem) => oneItem.kind === 'whitespaceTrimmed').every((oneItem) => typeof oneItem.text === 'string' && oneItem.text !== oneItem.text.trim()));
	next('', args);
}));

// -----------------------------------------------------------------
// SECTION 4 — the round-trip instrument observed RED (the graph perturbed, then the source)
// -----------------------------------------------------------------
const dropEdge = (isTarget) => (perturbed) => {
	const edgeIndex = perturbed.edges.findIndex(isTarget);
	return edgeIndex !== -1 && perturbed.edges.splice(edgeIndex, 1).length === 1;
};
const changeNode = (isTarget, change) => (perturbed) => {
	const target = perturbed.nodes.find(isTarget);
	return target !== undefined && change(target) !== false;
};
const ROUND_TRIP_TWIN_LIST = [
	{ twinName: 'an etlTemplate REFERENCES edge dropped', perturb: dropEdge((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.properties.locator === 'etlTemplate'), expectation: 'lost' },
	{ twinName: 'a complianceCategory REFERENCES edge dropped', perturb: dropEdge((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.properties.locator === 'complianceCategory'), expectation: 'lost' },
	{ twinName: 'a HAS_SUPPORT edge dropped', perturb: dropEdge((oneEdge) => oneEdge.type === 'HAS_SUPPORT'), expectation: 'lost' },
	{ twinName: 'a HAS_VALUE edge dropped (the value has no owner)', perturb: dropEdge((oneEdge) => oneEdge.type === 'HAS_VALUE'), expectation: 'fault' },
	{ twinName: 'a Global ID changed', perturb: changeNode((oneNode) => oneNode.properties.globalIdText === '000218', (target) => { target.properties.globalIdText = '000219'; }), expectation: 'both' },
	{ twinName: 'a description dropped', perturb: changeNode((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.description !== undefined, (target) => { delete target.properties.description; }), expectation: 'lost' },
	{ twinName: 'a description invented on an entity', perturb: changeNode((oneNode) => oneNode.role === 'DmeClass', (target) => { target.properties.description = 'invented'; }), expectation: 'invented' },
	{ twinName: 'one of two domains dropped', perturb: changeNode((oneNode) => oneNode.properties.domainList === JSON.stringify(['Early Learning', 'K12']), (target) => { target.properties.domainList = JSON.stringify(['K12']); }), expectation: 'lost' },
	{ twinName: 'an option value code changed', perturb: changeNode((oneNode) => oneNode.role === 'DmeOptionValue' && oneNode.properties.code === 'AUT', (target) => { target.properties.code = 'AUTX'; }), expectation: 'both' },
	{ twinName: 'a milestone ideaRequired flipped', perturb: changeNode((oneNode) => oneNode.stableId === 'sedm:eventMilestone/1', (target) => { target.properties.ideaRequired = !target.properties.ideaRequired; }), expectation: 'both' },
	{ twinName: 'a category changed', perturb: changeNode((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.category !== undefined, (target) => { target.properties.category = `${target.properties.category}X`; }), expectation: 'both' },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin, twinIndex) => taskList.push((args, next) => {
	if (twinIndex === 0) {
		harness.section('SECTION 4 — the round-trip instrument observed RED');
	}
	const perturbed = copyOfForgeResult(args.forgeResult);
	if (!oneTwin.perturb(perturbed)) {
		harness.ok(`RED-OBSERVED: ${oneTwin.twinName}`, false, 'the graph holds no target for this perturbation, so the twin cannot be observed');
		next('', args);
		return;
	}
	validateDouble({ forgeResult: perturbed, caseName: `twin${twinIndex}` }, (validateError, verdict) => {
		const isRed = oneTwin.expectation === 'fault'
			? Boolean(validateError)
			: !validateError && verdict.roundTripClean === false
				&& (oneTwin.expectation === 'invented' ? verdict.inventedTotal >= 1 : true)
				&& (oneTwin.expectation === 'lost' ? verdict.lostTotal >= 1 : true)
				&& (oneTwin.expectation === 'both' ? verdict.lostTotal >= 1 && verdict.inventedTotal >= 1 : true);
		harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → ${validateError ? `fault: ${String(validateError).slice(0, 120)}` : `lost ${verdict.lostTotal}, invented ${verdict.inventedTotal}`}`, isRed, validateError);
		next('', args);
	});
}));
// the instrument's own refusal: a structures section the profile reads and the file lacks is refused by the pair, never read as empty
taskList.push((args, next) => {
	const snapshotPath = perturbedSnapshotPath({ caseName: 'pairSectionAbsent', fileName: sourceProfile.structuresFileName, perturbText: editedStructuresText((structures) => { delete structures.useCases; }) });
	sedmRoundTripPair.canonicalizeSource({ snapshotPath, verifiedFileList: [] }, (canonicalizeError) => {
		harness.match('RED-OBSERVED: the pair refuses a structures file lacking a section it reads', String(canonicalizeError), /has no list at useCases/);
		next('', args);
	});
});
// the SOURCE perturbed: the derived column made to disagree with the 14 it summarises. The walk does not read it; the round trip must.
taskList.push((args, next) => {
	const snapshotPath = perturbedSnapshotPath({ caseName: 'derivedDisagrees', fileName: sourceProfile.csvFileName, perturbText: editedCsvText(({ recordList }) => { firstInScope(recordList, (oneRecord) => oneRecord.cellList[POSITION.anyEtl] === '').cellList[POSITION.anyEtl] = 'Y'; }) });
	forgeSnapshot({ sourcePath: snapshotPath }, (forgeError, forgeResult) => {
		if (forgeError) {
			harness.ok('RED-OBSERVED: the derived ETL column disagrees with its 14 columns', false, forgeError);
			next('', args);
			return;
		}
		validateDouble({ forgeResult, caseName: 'derivedDisagrees', snapshotPath }, (validateError, verdict) => {
			harness.ok(`RED-OBSERVED: the derived ETL column disagrees with its 14 columns → lost ${verdict && verdict.lostTotal}`, !validateError && verdict.lostTotal === 1 && verdict.roundTripClean === false, validateError);
			next('', args);
		});
	});
});

// -----------------------------------------------------------------
// SECTION 5 — determinism
// -----------------------------------------------------------------
taskList.push((args, next) => forgeSnapshot({ sourcePath: SNAPSHOT_DIR_PATH }, (forgeError, secondResult) => {
	harness.section('SECTION 5 — determinism');
	const bytesOf = (forgeResult) => JSON.stringify({ nodes: forgeResult.nodes, edges: forgeResult.edges });
	harness.ok('two forges of one snapshot are byte-identical', !forgeError && bytesOf(secondResult) === bytesOf(args.forgeResult));
	const pureModuleList = ['sedmWalk.js', 'sedmStructuresWalk.js', 'sedmIdentity.js', 'sedmSourceLoader.js', 'sedmHooks.js', 'sedmForgeDeclaration.js'];
	const clockReaderList = pureModuleList.filter((fileName) => /Date\.now|new Date|Math\.random|process\.hrtime/.test(fs.readFileSync(path.join(BUNDLE_DIR_PATH, 'lib', fileName), 'utf8')));
	harness.equal('no clock or randomness in the forge modules', JSON.stringify(clockReaderList), '[]');
	next('', args);
}));

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(scratchRootPath, { recursive: true, force: true });
	harness.report();
});
