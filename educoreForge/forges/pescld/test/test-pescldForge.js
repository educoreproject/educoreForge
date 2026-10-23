#!/usr/bin/env node
'use strict';

// test-pescldForge.js — the PESC_LD forge bundle (zeroBacklog lane C1), Docker-free: the real snapshot forged in process, its
// counts and carriage rules, every loader and walk refusal named (each on a perturbed COPY of the snapshot), the round trip over
// the harness's graph double and its twins observed RED, the TTL second oracle and its twins observed RED, and determinism.
// Writes only under os.tmpdir().

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the PESC_LD forge bundle: counts, carriage, refusals, round trip, TTL oracle, determinism (no Docker)

SYNOPSIS
     node forges/pescld/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges forges/pescld/assets/standardSourceData/01 in process (no embedding) and asserts the measured counts (39 shapes, 266
     rows, 45 picklists, 482 picklist values) and the declared rules (whitespace, duplicate, conflict, repeat, emptiness). Forges
     perturbed copies of the snapshot to observe each refusal by name. Runs the bundle's round-trip validator over the harness
     graph double and observes it RED on perturbations; diffs the publisher's TTL against the graph with the declared departure
     table and observes that RED too. Writes only under os.tmpdir().

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
const bundle = require(path.join(BUNDLE_DIR_PATH, 'forgePescld'))({ embedder: null });
const validator = require(path.join(BUNDLE_DIR_PATH, 'roundTripValidator'));
const pescldRoundTripPair = require(path.join(BUNDLE_DIR_PATH, 'lib', 'pescldRoundTripPair'))({ ruleModulePath: 'forges/pescld/lib/pescldRoundTripPair.js' });
const pescldTtlOracle = require(path.join(BUNDLE_DIR_PATH, 'lib', 'pescldTtlOracle'));
const departureTable = require(path.join(BUNDLE_DIR_PATH, 'lib', 'pescldTtlDepartureTable.json'));

// the measured expectation (snapshot 01, 2026-10-22), as data
const EXPECTED = Object.freeze({
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 39, DmeProperty: 266, DmeOptionSet: 45, DmeOptionValue: 482, DmeEmbedText: 251 },
	edgeCountByType: { HAS_CLASS: 39, HAS_PROPERTY: 266, REFERENCES: 72, HAS_OPTION_SET: 45, HAS_VALUE: 482, EMBEDS_TEXT_OF: 353 },
	walkStatByName: { whitespaceTrimmedCellCount: 2, duplicateTapRecordCount: 4, conflictResolvedCount: 1, picklistRepeatCollapsedCount: 3, constraintDeclaredEmptyCount: 4, crossRefTotal: 93, shapeReferenceEdgeCount: 72 },
	distinctPicklistValueCount: 334,
	termCurieCountByPrefix: { pesc: 159, ceterms: 18, elm: 11, rdf: 36, skos: 1 },
	explicitlyOmittedByKind: { namespaceTable: 47, packageMetadata: 6, spreadsheetRowNumber: 167, whitespaceTrimmed: 2 },
	rootVersionText: '0.0.2|0.0.2|provenance-file',
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pescldForgeTest-'));

// perturbedSnapshotPath — a COPY of the snapshot with one file's text changed and SHA256SUMS rewritten, so the framework's
// checksum gate passes and the refusal under test is the loader's or the walk's own
const perturbedSnapshotPath = ({ caseName, fileName, perturbText, omitFromChecksumList }) => {
	// inside a standardSourceData/<NN> path, as the version stamp expects of a snapshot
	const copyDirPath = path.join(scratchRootPath, caseName, 'standardSourceData', '01');
	fs.mkdirSync(copyDirPath, { recursive: true });
	fs.readdirSync(SNAPSHOT_DIR_PATH).forEach((oneName) => fs.copyFileSync(path.join(SNAPSHOT_DIR_PATH, oneName), path.join(copyDirPath, oneName)));
	if (fileName !== undefined) {
		const filePath = path.join(copyDirPath, fileName);
		fs.writeFileSync(filePath, perturbText(fs.readFileSync(filePath, 'utf8')));
	}
	const checksumText = fs.readFileSync(path.join(copyDirPath, 'SHA256SUMS'), 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '')
		.map((oneLine) => oneLine.split(/\s+/)[1])
		.filter((oneName) => oneName !== omitFromChecksumList)
		.map((oneName) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(copyDirPath, oneName))).digest('hex')}  ${oneName}`)
		.join('\n');
	fs.writeFileSync(path.join(copyDirPath, 'SHA256SUMS'), `${checksumText}\n`);
	return copyDirPath;
};
const forgeSnapshot = ({ sourcePath }, callback) => bundle.forge({ sourcePath, owner: 'test', skipEmbedding: true }, callback);
const validateDouble = ({ forgeResult, caseName }, callback) => {
	const outputPath = path.join(scratchRootPath, `verdict-${caseName}`);
	fs.mkdirSync(outputPath, { recursive: true });
	validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: SNAPSHOT_DIR_PATH, outputPath }, callback);
};
const oracleDiffOf = ({ forgeResult }, callback) => pescldRoundTripPair.emitFromGraph({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }) }, (emitError, emitted) => {
	if (emitError || emitted.fault) {
		callback(emitError || emitted.fault);
		return;
	}
	pescldTtlOracle.canonicalizeTtl({ ttlFilePath: path.join(SNAPSHOT_DIR_PATH, 'JsonldCollegeTranscriptShacl.ttl') }, (ttlError, ttlCanonical) => {
		if (ttlError) {
			callback(ttlError);
			return;
		}
		callback('', pescldTtlOracle.diffAgainstGraph({ ttlStatements: ttlCanonical.statements, graphStatements: emitted.statements, departureTable }));
	});
});

const taskList = new taskListPlus();

// -----------------------------------------------------------------
// SECTION 1 — the real snapshot: counts and carriage
// -----------------------------------------------------------------
taskList.push((args, next) => forgeSnapshot({ sourcePath: SNAPSHOT_DIR_PATH }, (forgeError, forgeResult) => {
	harness.section('SECTION 1 — snapshot 01 forged in process: the measured counts and the declared rules');
	harness.accepts('the real snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	harness.equal('node count by role (39 shapes, 266 rows, 45 picklists, 482 picklist values)', sortedText(countBy(forgeResult.nodes, (oneNode) => oneNode.role)), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('edge count by type', sortedText(countBy(forgeResult.edges, (oneEdge) => oneEdge.type)), sortedText(EXPECTED.edgeCountByType));
	Object.keys(EXPECTED.walkStatByName).forEach((statName) => harness.equal(`stats.${statName}`, forgeResult.stats[statName], EXPECTED.walkStatByName[statName]));
	const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	const valueNodeList = forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeOptionValue');
	harness.equal('334 distinct picklist values over the 482 value nodes', new Set(valueNodeList.map((oneNode) => oneNode.properties.name)).size, EXPECTED.distinctPicklistValueCount);
	const rootNode = nodeById['pescld:root'];
	harness.equal('root version, publishedVersion, versionSource (standardSourceLocation)', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, EXPECTED.rootVersionText);
	harness.equal('root standardFamily', rootNode.properties.standardFamily, 'PESCLD');
	harness.equal('root sourceUrl is about.csv\'s own url', rootNode.properties.sourceUrl, 'https://docs.google.com/spreadsheets/d/18HzS4phUl7olmUEjh0deA3vgVPdque4_iGzK7_zTWLE/');
	harness.ok('every node is _source PESCLD', forgeResult.nodes.every((oneNode) => oneNode.properties._source === 'PESCLD'));
	// ⟪zeroBacklog lane C, ruling BRONZE_CROWN 2026-10-23⟫ the DME reads description only: a row's usage note is carried there too,
	// verbatim (it is not a definition; the root's descriptionSource says so), and nothing else carries description
	const describedNodeList = forgeResult.nodes.filter((oneNode) => oneNode.properties.description !== undefined);
	harness.equal('description = the usage note, verbatim, on every row that has one (48, measured; 34 of them pesc: rows) and on no other node', `${describedNodeList.length} ${describedNodeList.filter((oneNode) => oneNode.properties.description !== oneNode.properties.usageNote).length} ${forgeResult.nodes.filter((oneNode) => oneNode.properties.usageNote !== undefined && oneNode.properties.description === undefined).length}`, '48 0 0');
	harness.ok('the root\'s descriptionSource names the usage note as the description, and says it is not a definition', /usage note/.test(rootNode.properties.descriptionSource) && /not a definition/.test(rootNode.properties.descriptionSource), rootNode.properties.descriptionSource);
	const termNodeList = forgeResult.nodes.filter((oneNode) => (oneNode.role === 'DmeClass' || oneNode.role === 'DmeProperty') && oneNode.properties.termCurie !== undefined);
	harness.equal('every shape and row carries a termCurie', termNodeList.length, 39 + 266);
	harness.ok('every termCurie has its termIri, expanded from namespaces.csv', termNodeList.every((oneNode) => typeof oneNode.properties.termIri === 'string' && oneNode.properties.termIri.endsWith(oneNode.properties.termCurie.split(':')[1])));
	const nonHubPrefixCount = countBy(termNodeList.filter((oneNode) => ['pesc', 'ceterms', 'elm', 'rdf', 'skos'].indexOf(oneNode.properties.termCurie.split(':')[0]) !== -1), (oneNode) => oneNode.properties.termCurie.split(':')[0]);
	harness.equal('termCurie by prefix (pesc 142 rows + 17 shapes; ceterms 16 rows + 2 shapes; elm 10 + 1; rdf:type 36; skos 1)', sortedText(nonHubPrefixCount), sortedText(EXPECTED.termCurieCountByPrefix));
	harness.equal('the remaining terms are the 62 rows and 18 shapes under the package\'s eighth term prefix', termNodeList.length - Object.values(nonHubPrefixCount).reduce((total, oneCount) => total + oneCount, 0), 62 + 18);
	const summaryRow = nodeById['pescld:shape/PersonShape/pesc:hasSummary'];
	harness.equal('duplicate rule: the hasSummary row carries both TAP files', summaryRow.properties.sourceTabs, JSON.stringify(['person-tap.csv', 'summary-related-tap.csv']));
	harness.equal('conflict rule: mandatory resolves TRUE (the publisher\'s merge)', summaryRow.properties.mandatory, true);
	harness.equal('conflict rule: both source values carried', JSON.parse(summaryRow.properties.sourceValueConflicts)[0].cellTextBySourceFileName['person-tap.csv'], 'FALSE');
	harness.equal('a column one file lacks states nothing: Severity Warning from summary-related-tap.csv alone', summaryRow.properties.severity, 'Warning');
	harness.equal('repeat rule: Undergraduate is one value with listRepeatCount 2, in 3 picklists', valueNodeList.filter((oneNode) => oneNode.properties.listRepeatCount === 2).length, 3);
	const declaredEmptyRowList = forgeResult.nodes.filter((oneNode) => oneNode.properties.valueConstraintDeclaredEmpty === true).map((oneNode) => `${oneNode.properties.path}:${oneNode.properties.valueConstraintType}`).sort();
	harness.equal('emptiness rule: 3 empty picklists and 1 empty maxLength, declared', JSON.stringify(declaredEmptyRowList), JSON.stringify(['CourseShape.ceds:P001298:picklist', 'PersonShape.pesc:birthCountry:picklist', 'PersonShape.pesc:birthStateProvinceCode:picklist', 'PersonShape.pesc:cohortGraduationYear:maxLength'].sort()));
	harness.equal('whitespace rule: the two trimmed cells are listed', JSON.stringify(forgeResult.stats.whitespaceTrimmedCellList.map((oneTrim) => oneTrim.columnName)), JSON.stringify(['propertyLabel', 'valueConstraint']));
	harness.equal('the trimmed label is clean', nodeById['pescld:shape/CourseShape/ceds:P000060'].properties.name, 'Has Course Grade Point Average Applicability');
	harness.ok('the undefined term P001075 is CARRIED, never dropped (with its 4 values)', nodeById['pescld:shape/PersonIdentificationShape/ceds:P001075'] !== undefined && valueNodeList.filter((oneNode) => oneNode.stableId.startsWith('pescld:picklist/PersonIdentificationShape/ceds:P001075/')).length === 4);
	const crossRefEntryList = forgeResult.nodes.reduce((entryList, oneNode) => entryList.concat(JSON.parse(oneNode.properties.crossRefs)), []);
	harness.ok('every crossRef is exactly { raw, locator: valueClass }', crossRefEntryList.length === 93 && crossRefEntryList.every((oneEntry) => JSON.stringify(Object.keys(oneEntry)) === '["raw","locator"]' && oneEntry.locator === 'valueClass'));
	harness.ok('every REFERENCES edge is a valueShape reference between a row and a shape', forgeResult.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES').every((oneEdge) => oneEdge.properties.locator === 'valueShape' && nodeById[oneEdge.fromRef.id].role === 'DmeProperty' && nodeById[oneEdge.toRef.id].role === 'DmeClass'));
	harness.ok('no edge leaves the standard (the forge makes no cross-standard edge)', forgeResult.edges.every((oneEdge) => nodeById[oneEdge.fromRef.id] !== undefined && nodeById[oneEdge.toRef.id] !== undefined));
	next('', { ...args, forgeResult });
}));

// -----------------------------------------------------------------
// SECTION 2 — every loader and walk refusal, by name, on a perturbed copy of the snapshot
// -----------------------------------------------------------------
const REFUSAL_CASE_LIST = [
	{ caseName: 'unlistedFile', omitFromChecksumList: 'about.csv', refusalRegex: /'about\.csv' is named by the source profile but not listed in SHA256SUMS/ },
	{ caseName: 'unknownColumn', fileName: 'tap.csv', perturbText: (text) => text.replace('Rec Usage,note', 'Rec Usage,noteRenamed'), refusalRegex: /'tap\.csv' header: column 'noteRenamed' is not in the source profile/ },
	{ caseName: 'missingColumn', fileName: 'shapes.csv', perturbText: (text) => text.replace('shapeID,label,comment,', 'shapeID,label,remark,'), refusalRegex: /'shapes\.csv' header: column 'remark' is not in the source profile/ },
	{ caseName: 'badBoolean', fileName: 'tap.csv', perturbText: (text) => text.replace('pesc:createdDateTime,Created Date Time,TRUE,FALSE', 'pesc:createdDateTime,Created Date Time,YES,FALSE'), refusalRegex: /column 'mandatory' holds 'YES', not one of TRUE, FALSE/ },
	{ caseName: 'unresolvedConflict', fileName: 'achieve-related-tap.csv', perturbText: (text) => text.replace(/(AcademicHonorsShape,pesc:honorsTitle,)([^,]*)/, '$1Changed Honors Title'), refusalRegex: /\(AcademicHonorsShape, pesc:honorsTitle\) column 'propertyLabel' differs across its records/ },
	{ caseName: 'unknownConstraintType', fileName: 'tap.csv', perturbText: (text) => text.replace('35,maxLength', '35,maxBytes'), refusalRegex: /valueConstraintType 'maxBytes' is not in the source profile/ },
	{ caseName: 'unknownValueShape', fileName: 'tap.csv', perturbText: (text) => text.replace('NoteShape,elm:Note', 'NoNoteShape,elm:Note'), refusalRegex: /valueShape 'NoNoteShape' is not a shapes\.csv shape/ },
	{ caseName: 'undeclaredPrefix', fileName: 'tap.csv', perturbText: (text) => text.replace('pesc:createdDateTime', 'pescx:createdDateTime'), refusalRegex: /prefix 'pescx' of 'pescx:createdDateTime' is not declared in namespaces\.csv/ },
	{ caseName: 'unknownShape', fileName: 'tap.csv', perturbText: (text) => text.replace(',NoteShape,elm:noteLiteral', ',GhostShape,elm:noteLiteral'), refusalRegex: /shapeID 'GhostShape' is not a shapes\.csv shape/ },
	{ caseName: 'repeatedPrefix', fileName: 'namespaces.csv', perturbText: (text) => `${text}\r\nceterms,https://example.org/other/,repeat`, refusalRegex: /declares prefix 'ceterms' twice/ },
	{ caseName: 'malformedCsv', fileName: 'contact-tap.csv', perturbText: (text) => text.replace('ceterms:addressRegion', 'ceterms:"addressRegion'), refusalRegex: /opens a quote inside a cell/ },
];
REFUSAL_CASE_LIST.forEach((oneCase, caseIndex) => taskList.push((args, next) => forgeSnapshot({ sourcePath: perturbedSnapshotPath(oneCase) }, (forgeError) => {
	if (caseIndex === 0) {
		harness.section('SECTION 2 — every refusal named, each on a perturbed copy of the snapshot');
	}
	harness.rejects(`refused: ${oneCase.caseName}`, forgeError ? [forgeError] : [], oneCase.refusalRegex);
	next('', args);
})));

// -----------------------------------------------------------------
// SECTION 3 — round trip over the graph double, and its twins observed RED
// -----------------------------------------------------------------
taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'real' }, (validateError, verdict) => {
	harness.section('SECTION 3 — the round trip (CSV snapshot as the source) over the graph double');
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
// each perturbation returns false when the snapshot no longer holds its target: the twin then FAILS by name, it never passes
// vacuously and never crashes the suite
const dropEdgeOfType = (edgeType) => (perturbed) => {
	const edgeIndex = perturbed.edges.findIndex((oneEdge) => oneEdge.type === edgeType);
	return edgeIndex !== -1 && perturbed.edges.splice(edgeIndex, 1).length === 1;
};
const changeNode = (isTarget, change) => (perturbed) => {
	const target = perturbed.nodes.find(isTarget);
	return target !== undefined && change(target) !== false;
};
const ROUND_TRIP_TWIN_LIST = [
	{ twinName: 'a valueShape REFERENCES edge dropped', perturb: dropEdgeOfType('REFERENCES'), expectation: 'lost' },
	{ twinName: 'a HAS_VALUE edge dropped', perturb: dropEdgeOfType('HAS_VALUE'), expectation: 'lost' },
	{ twinName: 'one valueClass crossRef dropped', perturb: changeNode((oneNode) => JSON.parse(oneNode.properties.crossRefs).length > 1, (target) => { target.properties.crossRefs = JSON.stringify(JSON.parse(target.properties.crossRefs).slice(1)); }), expectation: 'lost' },
	{ twinName: 'a mandatory flag flipped', perturb: changeNode((oneNode) => oneNode.stableId === 'pescld:shape/CollegeTranscriptShape/pesc:documentID', (target) => { target.properties.mandatory = !target.properties.mandatory; }), expectation: 'both' },
	{ twinName: 'a sourceTab dropped from the duplicated row', perturb: changeNode((oneNode) => oneNode.stableId === 'pescld:shape/PersonShape/pesc:hasSummary', (target) => { target.properties.sourceTabs = JSON.stringify(['person-tap.csv']); }), expectation: 'lost' },
	{ twinName: 'the conflict record removed', perturb: changeNode((oneNode) => oneNode.properties.sourceValueConflicts !== undefined, (target) => { delete target.properties.sourceValueConflicts; }), expectation: 'lost' },
	{ twinName: 'a listRepeatCount removed', perturb: changeNode((oneNode) => oneNode.properties.listRepeatCount !== undefined, (target) => { delete target.properties.listRepeatCount; }), expectation: 'lost' },
	{ twinName: 'a termIri changed', perturb: changeNode((oneNode) => oneNode.role === 'DmeClass', (target) => { target.properties.termIri = `${target.properties.termIri}X`; }), expectation: 'both' },
	{ twinName: 'a usage note invented on a row that has none', perturb: changeNode((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.usageNote === undefined, (target) => { target.properties.usageNote = 'invented'; }), expectation: 'invented' },
	{ twinName: 'a description invented on a row with no usage note', perturb: changeNode((oneNode) => oneNode.role === 'DmeProperty' && oneNode.properties.usageNote === undefined, (target) => { target.properties.description = 'invented'; }), expectation: 'invented' },
	{ twinName: 'a description changed', perturb: changeNode((oneNode) => oneNode.properties.description !== undefined, (target) => { target.properties.description = `${target.properties.description} (changed)`; }), expectation: 'both' },
	{ twinName: 'a description dropped', perturb: changeNode((oneNode) => oneNode.properties.description !== undefined, (target) => { delete target.properties.description; }), expectation: 'lost' },
	{ twinName: 'a declared emptiness removed', perturb: changeNode((oneNode) => oneNode.properties.valueConstraintDeclaredEmpty === true, (target) => { delete target.properties.valueConstraintDeclaredEmpty; }), expectation: 'lost' },
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
		const isRed = !validateError && verdict.roundTripClean === false
			&& (oneTwin.expectation === 'invented' ? verdict.inventedTotal >= 1 : true)
			&& (oneTwin.expectation === 'lost' ? verdict.lostTotal >= 1 : true)
			&& (oneTwin.expectation === 'both' ? verdict.lostTotal >= 1 && verdict.inventedTotal >= 1 : true);
		harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → lost ${verdict && verdict.lostTotal}, invented ${verdict && verdict.inventedTotal}`, isRed, validateError);
		next('', args);
	});
}));

// -----------------------------------------------------------------
// SECTION 5 — the TTL second oracle (ruling Q-Z8), and its twins observed RED
// -----------------------------------------------------------------
taskList.push((args, next) => oracleDiffOf({ forgeResult: args.forgeResult }, (oracleError, oracleDiff) => {
	harness.section('SECTION 5 — the publisher\'s TTL as a second oracle: departures equal the declared table and nothing else');
	harness.accepts('the TTL translates and diffs', oracleError ? [oracleError] : []);
	if (oracleError) {
		next(oracleError, args);
		return;
	}
	harness.equal('no unexplained departure', JSON.stringify(oracleDiff.unexplainedList.slice(0, 5)), '[]');
	harness.equal('no departure claimed by two rows', oracleDiff.ambiguousList.length, 0);
	harness.equal('every row at its expected count', JSON.stringify(oracleDiff.countMismatchList), '[]');
	harness.ok('the oracle is clean', oracleDiff.isOracleClean);
	next('', args);
}));
const ORACLE_TWIN_LIST = [
	{ twinName: 'a row label changed in the graph (an unexplained departure on both sides)', perturb: changeNode((oneNode) => oneNode.stableId === 'pescld:shape/CollegeTranscriptShape/pesc:documentID', (target) => { target.properties.name = 'Document Identifier'; }), redRegex: /unexplained/ },
	{ twinName: 'one Rec Usage removed (a departure row off its count)', perturb: changeNode((oneNode) => oneNode.properties.recUsage !== undefined, (target) => { delete target.properties.recUsage; }), redRegex: /countMismatch/ },
];
ORACLE_TWIN_LIST.forEach((oneTwin, twinIndex) => taskList.push((args, next) => {
	if (twinIndex === 0) {
		harness.section('SECTION 6 — the TTL oracle observed RED');
	}
	const perturbed = copyOfForgeResult(args.forgeResult);
	if (!oneTwin.perturb(perturbed)) {
		harness.ok(`RED-OBSERVED: ${oneTwin.twinName}`, false, 'the graph holds no target for this perturbation, so the twin cannot be observed');
		next('', args);
		return;
	}
	oracleDiffOf({ forgeResult: perturbed }, (oracleError, oracleDiff) => {
		const redText = oracleError ? '' : `${oracleDiff.unexplainedList.length ? 'unexplained' : ''} ${oracleDiff.countMismatchList.length ? 'countMismatch' : ''}`;
		harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → ${redText}`, !oracleError && oracleDiff.isOracleClean === false && oneTwin.redRegex.test(redText), oracleError);
		next('', args);
	});
}));

// -----------------------------------------------------------------
// SECTION 7 — determinism: the same snapshot forges to the same bytes; the pure modules read no clock
// -----------------------------------------------------------------
taskList.push((args, next) => forgeSnapshot({ sourcePath: SNAPSHOT_DIR_PATH }, (forgeError, secondResult) => {
	harness.section('SECTION 7 — determinism');
	const bytesOf = (forgeResult) => JSON.stringify({ nodes: forgeResult.nodes, edges: forgeResult.edges });
	harness.ok('two forges of one snapshot are byte-identical', !forgeError && bytesOf(secondResult) === bytesOf(args.forgeResult));
	const pureModuleList = ['pescldWalk.js', 'pescldCsvReader.js', 'pescldSourceLoader.js', 'pescldHooks.js', 'pescldForgeDeclaration.js'];
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
