#!/usr/bin/env node
'use strict';

// test-sif260928Codesets.js — the phase A4 gates for the sif260928 code lists and object references
// (PLAN-sifReplacement-smallPhases-092826.md §3 A4; SPEC §9 A24 and A28). ALL PURE: the whole forge runs
// in pure mode (skipEmbedding, no Docker, no network). Every conjunct is observed RED under its own twin
// before the family counts as green (gateSuiteRunner).
//
//   A4-CODESETS   (a) Codesets 131, CodesetValues 4,055, HAS_VALUE 4,055, Field HAS_OPTION_SET 1,495 (CONSTRAINED_BY until
//                     campaign P3 W-C-2), equal to
//                     the separate count; every list-carrying Field is constrained by a Codeset holding
//                     its cell's values in source order; a padded list value is refused by name
//   A4-KINDS      (b) the edge types stay distinct: the exact per-type count set, each type between its
//                     own endpoint labels
//   A4-REFERENCES (c) REFERENCES_OBJECT 607, the resolved (Field, Object) list equal to the separate
//                     count's, 200 through the map; the 14 unresolved RefId Fields named; a map target
//                     naming no table, and one RefId mapped to two tables, are refused by name
//   A4-UNCHANGED  (d) the earlier node and edge counts, and the Question list, are unchanged
//
// THE SEPARATE COUNT is evidence/A4/countCodesetsAndReferences.py (in the sifStructuralBridge-091826
// planning folder): Python over the raw bytes, sharing no code with the forge. Its output is recorded in
// DEVLOG-A4.md and frozen below. Neither side is ever edited to match the other.
//
// Twins mutate the bundle in memory (moduleDouble) or build SCRATCH snapshots under the OS temp directory,
// whose SHA256SUMS is regenerated so a fault reaches the gate's own check rather than the checksum. The
// scratch snapshots are removed at the end; nothing in the tree is written.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928Codesets.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A4 gates: the code lists, distinct edge kinds, the object references, earlier counts unchanged

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const ENTRY_MODULE_PATH = path.join(BUNDLE_DIR, 'forgeSif260928.js');
const LOADER_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928TsvLoader.js');
const MAP_LOADER_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928RefIdMapLoader.js');
const CODESETS_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Codesets.js');
const REFERENCES_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928References.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const REF_ID_MAP_FILE_NAME = 'refIdResolutionMap.tsv';

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_FILE_NAME = descriptorValueByName.sourceFile;
const REAL_SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot);

// ---- FROZEN LITERALS: evidence/A4/countCodesetsAndReferences.py's output (DEVLOG-A4.md). Never edited
// to match a measurement.
const RULED_CODESET_COUNT = 131;
const RULED_CODESET_VALUE_COUNT = 4055;
// ⟪campaign P3, W-C-2 / S3⟫ the Field -> Codeset edge is HAS_OPTION_SET (it was CONSTRAINED_BY); the count is the same
const RULED_FIELD_OPTION_SET_COUNT = 1495;
const RULED_REFERENCES_OBJECT_COUNT = 607;
const RULED_REFERENCES_OBJECT_VIA_MAP_COUNT = 200;
// A5's text edges, rebuilt from C1's question map and segment table alone (DEVLOG-A5.md): not A4's
// separate count, but part of the exact edge set A4-KINDS asserts
const RULED_EMBEDS_TEXT_OF_COUNT = 14539;
// sorted '<xpath>\t<value>\t<value>...' lines, one per list-carrying Field, each text ending in a newline
const RULED_CONSTRAINED_LIST_SHA256 = 'a9f70c75823afec317c86a0f849fb8a01d562b642f5acc40038b5aea59f2f6d1';
// sorted '<xpath>\t<target object path>' lines, one per resolved RefId Field
const RULED_REFERENCE_LIST_SHA256 = '4d77221f5a4d8cc8e8fa0d955e48f91801d6624d0ceaa10ad914b54f60f40e4e';
// the RefId Fields that resolve neither way (SIF's polymorphic reference), by name and row count
const RULED_UNRESOLVED_ROW_COUNT_BY_NAME = Object.freeze({ '@SIF_RefId': 10, SIF_RefId: 4 });
// ---- the earlier counts (A1c, A2, A3), which A4 must leave unchanged
const RULED_EARLIER_NODE_COUNT_BY_LABEL = Object.freeze({ Sif260928Root: 1, Sif260928Object: 159, Sif260928Container: 6586, Sif260928Field: 15620, Sif260928Question: 5018 });
const RULED_EARLIER_EDGE_COUNT_BY_TYPE = Object.freeze({ HAS_FIELD: 15620, HAS_CHILD: 21017, HAS_INSTANCE: 15620 });
// A3's sorted questionRefId list (C1's yardstick file name and sha): the walk order is stable
const RULED_QUESTION_REF_ID_LIST_SHA256 = '7f4ed86ec57a07b1759c4c87e5b54ad1aac424da081ecd103d737df44f64032e';
// each edge type and the per-standard labels it joins
const RULED_EDGE_ENDPOINT_LABELS_BY_TYPE = Object.freeze({
	HAS_VALUE: 'Sif260928Codeset>Sif260928CodesetValue',
	HAS_OPTION_SET: 'Sif260928Field>Sif260928Codeset',
	REFERENCES_OBJECT: 'Sif260928Field>Sif260928Object',
});

// ---- named rows the fixtures and twins use
// the map row a twin deletes: its 7 Fields (SchoolAttendedRefId x3, @SchoolAttendedRefId x4) then match
// no object name
const NAMED_DELETED_MAP_REF_ID_NAME = 'SchoolAttendedRefId';
// the map row the refusal fixture points at a table the TSV lacks
const NAMED_BAD_TARGET_REF_ID_NAME = 'ManagingSchoolRefId';
const NAMED_MISSING_TABLE_TITLE = 'NoSuchTableTitle';
// the one row the map repeats; the conflict fixture changes its second copy's table
const NAMED_REPEATED_REF_ID_NAME = 'ContactForRequestsRefId';
const NAMED_CONFLICTING_TABLE_TITLE = 'StudentPersonals';
// the list cell the padded-value fixture pads (on every row carrying it)
const NAMED_PADDED_CODE_LIST_CELL = '"Yes, No"';

// ---- scratch fixtures, all removed at the end
const scratchRootPathList = [];
const sha256Of = (textOrBuffer) => crypto.createHash('sha256').update(textOrBuffer).digest('hex');

// a copy of the real snapshot inside a standardSourceData/ container (the version stamp finds its
// provenance file there), with alterTextByFileName applied and SHA256SUMS regenerated for every file
// the real one lists
const makeScratchSnapshot = ({ alterTextByFileName }) => {
	const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sif260928Codesets-'));
	scratchRootPathList.push(scratchRootPath);
	const snapshotDirPath = path.join(scratchRootPath, 'standardSourceData', path.basename(REAL_SNAPSHOT_DIR));
	fs.mkdirSync(snapshotDirPath, { recursive: true });
	fs.readdirSync(REAL_SNAPSHOT_DIR).forEach((oneFileName) => fs.copyFileSync(path.join(REAL_SNAPSHOT_DIR, oneFileName), path.join(snapshotDirPath, oneFileName)));
	Object.keys(alterTextByFileName).forEach((oneFileName) => {
		const filePath = path.join(snapshotDirPath, oneFileName);
		const fileText = fs.readFileSync(filePath, 'utf8');
		const alteredText = alterTextByFileName[oneFileName](fileText);
		if (alteredText === fileText) {
			throw new Error(`${moduleName}: fixture fault — the alteration of ${oneFileName} changed nothing`);
		}
		fs.writeFileSync(filePath, alteredText);
	});
	const listedFileNameList = fs
		.readFileSync(path.join(REAL_SNAPSHOT_DIR, CHECKSUM_FILE_NAME), 'utf8')
		.split('\n')
		.filter((checksumLine) => checksumLine !== '')
		.map((checksumLine) => checksumLine.split('  ')[1]);
	fs.writeFileSync(path.join(snapshotDirPath, CHECKSUM_FILE_NAME), listedFileNameList.map((listedFileName) => `${sha256Of(fs.readFileSync(path.join(snapshotDirPath, listedFileName)))}  ${listedFileName}\n`).join(''));
	return snapshotDirPath;
};

const mapLineOf = (mapText, refIdName) => {
	const mapLineText = mapText.split('\n').find((oneLine) => oneLine.split('\t')[0] === refIdName);
	if (mapLineText === undefined) {
		throw new Error(`${moduleName}: fixture fault — no map row for ${refIdName}`);
	}
	return mapLineText;
};
const withMapRowDeleted = (mapText) => mapText.replace(`${mapLineOf(mapText, NAMED_DELETED_MAP_REF_ID_NAME)}\n`, '');
const withMapTargetMissing = (mapText) => {
	const cellList = mapLineOf(mapText, NAMED_BAD_TARGET_REF_ID_NAME).split('\t');
	return mapText.replace(cellList.join('\t'), [cellList[0], cellList[1], NAMED_MISSING_TABLE_TITLE, cellList[3], cellList[4]].join('\t'));
};
// the repeated row's SECOND copy names another table
const withRepeatedRowConflicting = (mapText) => {
	const mapLineText = mapLineOf(mapText, NAMED_REPEATED_REF_ID_NAME);
	const cellList = mapLineText.split('\t');
	const conflictingLineText = [cellList[0], cellList[1], NAMED_CONFLICTING_TABLE_TITLE, cellList[3], cellList[4]].join('\t');
	const firstLineEnd = mapText.indexOf(`${mapLineText}\n`) + mapLineText.length + 1;
	if (mapText.indexOf(`${mapLineText}\n`, firstLineEnd) !== firstLineEnd) {
		throw new Error(`${moduleName}: fixture fault — ${NAMED_REPEATED_REF_ID_NAME} is no longer repeated on the next line`);
	}
	return `${mapText.slice(0, firstLineEnd)}${conflictingLineText}\n${mapText.slice(firstLineEnd + mapLineText.length + 1)}`;
};
const withCodeListValuePadded = (sourceText) => sourceText.split(`\t${NAMED_PADDED_CODE_LIST_CELL}`).join('\t"Yes,  No"');

// ---- the subject every conjunct reads and every twin mutates (on a clone)
const makeSubject = () => ({ snapshotDirPath: REAL_SNAPSHOT_DIR, bundleMutationList: [] });
const cloneSubject = (subject) => ({ ...subject, bundleMutationList: subject.bundleMutationList.slice() });

const forgeWith = ({ mutationList, snapshotDirPath }, callback) => {
	const forgeBundle = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: ENTRY_MODULE_PATH, mutationList }) : require(ENTRY_MODULE_PATH);
	forgeBundle({ embedder: null }).forge({ sourcePath: path.join(snapshotDirPath, SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
};

// a conjunct over the forged nodes and edges: a forge refusal is a FAIL, with the refusal as the detail
const overForged = (judgeForged) => (subject, callback) => {
	forgeWith({ mutationList: subject.bundleMutationList, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
		if (forgeError) {
			callback('', { pass: false, detail: `forge refused: ${String(forgeError).slice(0, 300)}` });
			return;
		}
		callback('', judgeForged(forged));
	});
};
// a conjunct that the forge REFUSES a faulted fixture by name: a forge that builds is a FAIL
const refusedOnFixture = ({ alterTextByFileName, refusalRe }) => (subject, callback) => {
	forgeWith({ mutationList: subject.bundleMutationList, snapshotDirPath: makeScratchSnapshot({ alterTextByFileName }) }, (forgeError, forged) => {
		const pass = typeof forgeError === 'string' && refusalRe.test(forgeError);
		callback('', { pass, detail: forgeError ? String(forgeError).slice(0, 300) : `NOT refused: forged ${forged.nodes.length} nodes` });
	});
};

const nodeListByLabel = (forged, perStandardLabel) => forged.nodes.filter((oneNode) => oneNode.labels[1] === perStandardLabel);
const edgeListByType = (forged, edgeType) => forged.edges.filter((oneEdge) => oneEdge.type === edgeType);
// the Field -> Codeset option-set edges (W-C-1 adds root -> Codeset edges of the same type, which this count excludes)
const fieldOptionSetEdgeListOf = (forged) => edgeListByType(forged, 'HAS_OPTION_SET').filter((oneEdge) => oneEdge.fromRef.id.indexOf('sif260928:field/') === 0);
// ⟪campaign P3, G18⟫ THE NAMING RULE, restated here independently of the bundle: the distinct <parent>/<field> element
// names of the Fields carrying the cell, in first-appearance order, the first three then 'and N more'
const expectedCodesetNameOf = (fieldXpathList) => {
	const elementNameList = [];
	fieldXpathList.forEach((oneXpath) => {
		const segmentList = oneXpath.split('/').filter((oneSegment) => oneSegment.length > 0);
		const elementName = `${segmentList[segmentList.length - 2]}/${segmentList[segmentList.length - 1]}`;
		if (elementNameList.indexOf(elementName) === -1) elementNameList.push(elementName);
	});
	return elementNameList.length > 3 ? `${elementNameList.slice(0, 3).join(', ')} and ${elementNameList.length - 3} more` : elementNameList.join(', ');
};
const countBy = (itemList, groupNameOf) => itemList.reduce((soFar, oneItem) => ({ ...soFar, [groupNameOf(oneItem)]: (soFar[groupNameOf(oneItem)] || 0) + 1 }), {});
const sortedEntriesText = (countByName) => JSON.stringify(Object.keys(countByName).sort().map((oneName) => [oneName, countByName[oneName]]));
const firstOf = (itemList) => (itemList.length ? ` (first ${JSON.stringify(itemList[0])})` : '');
const sortedLinesSha256 = (lineList) => sha256Of(`${lineList.slice().sort().join('\n')}\n`);

const twinRegistry = makeTwinRegistry();
const registerMutationTwin = ({ gateId, conjunctId, twinName, mutation }) => {
	twinRegistry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind: 'productionMutation',
		shippedConfig: true,
		run: (subject) => {
			moduleDouble.assertMutationApplies(mutation);
			subject.bundleMutationList.push(mutation);
			return subject;
		},
	});
};
const registerFixtureTwin = ({ gateId, conjunctId, twinName, alterTextByFileName }) => {
	twinRegistry.register({ gateId, conjunctId, twinName, leverKind: 'inputFault', shippedConfig: true, run: (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ alterTextByFileName }) }) });
};
const loaderMutation = ({ find, replace }) => ({ modulePath: LOADER_MODULE_PATH, find, replace });
const mapLoaderMutation = ({ find, replace }) => ({ modulePath: MAP_LOADER_MODULE_PATH, find, replace });
const codesetsMutation = ({ find, replace }) => ({ modulePath: CODESETS_MODULE_PATH, find, replace });
const referencesMutation = ({ find, replace }) => ({ modulePath: REFERENCES_MODULE_PATH, find, replace });

const CODESETS_GATE_ID = 'A4-CODESETS';
const KINDS_GATE_ID = 'A4-KINDS';
const REFERENCES_GATE_ID = 'A4-REFERENCES';
const UNCHANGED_GATE_ID = 'A4-UNCHANGED';

// =====================================================================
// (a) A4-CODESETS
// =====================================================================
const codesetsConjunctList = [
	{
		conjunctId: 'codesetCountsEqualSeparateCount',
		title: 'Codesets 131 (⟪P3, G18⟫ every one NAMED), CodesetValues 4,055, HAS_VALUE 4,055 and Field HAS_OPTION_SET 1,495 (⟪P3, W-C-2⟫ no CONSTRAINED_BY), as the separate count found',
		twinNameList: ['codesetLookupKeyedByXpath', 'unquotedFormatTakenAsList'],
		evaluate: overForged((forged) => {
			const codesetNodeList = nodeListByLabel(forged, 'Sif260928Codeset');
			const namedCodesetCount = codesetNodeList.filter((oneNode) => oneNode.properties.name !== undefined).length;
			const measured = {
				codeset: codesetNodeList.length,
				codesetValue: nodeListByLabel(forged, 'Sif260928CodesetValue').length,
				hasValue: edgeListByType(forged, 'HAS_VALUE').length,
				fieldOptionSet: fieldOptionSetEdgeListOf(forged).length,
				constrainedBy: edgeListByType(forged, 'CONSTRAINED_BY').length,
			};
			return {
				pass:
					measured.codeset === RULED_CODESET_COUNT &&
					measured.codesetValue === RULED_CODESET_VALUE_COUNT &&
					measured.hasValue === RULED_CODESET_VALUE_COUNT &&
					measured.fieldOptionSet === RULED_FIELD_OPTION_SET_COUNT &&
					measured.constrainedBy === 0 &&
					namedCodesetCount === RULED_CODESET_COUNT,
				detail: `${JSON.stringify(measured)}; Codesets with a name ${namedCodesetCount}`,
			};
		}),
	},
	{
		conjunctId: 'everyListFieldConstrainedByItsOwnValues',
		title: "the sorted (Field xpath, its Codeset's values in valueOrdinal order) lines hash to the separate count's; each Codeset's formatCellText is its values re-joined in one quote pair, its valueCount its HAS_VALUE edges, and each value's parent its Codeset",
		twinNameList: ['valuesSorted', 'oneFieldConstrainedByTheWrongCodeset'],
		evaluate: overForged((forged) => {
			const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
			const valueNodeListByCodesetStableId = edgeListByType(forged, 'HAS_VALUE').reduce((soFar, oneEdge) => soFar.set(oneEdge.fromRef.id, (soFar.get(oneEdge.fromRef.id) || []).concat([nodeByStableId.get(oneEdge.toRef.id)])), new Map());
			const valueTextListOf = (codesetStableId) =>
				(valueNodeListByCodesetStableId.get(codesetStableId) || [])
					.slice()
					.sort((leftNode, rightNode) => leftNode.properties.valueOrdinal - rightNode.properties.valueOrdinal)
					.map((valueNode) => valueNode.properties.name);
			const constrainedLineList = fieldOptionSetEdgeListOf(forged).map((oneEdge) => [nodeByStableId.get(oneEdge.fromRef.id).properties.xpath].concat(valueTextListOf(oneEdge.toRef.id)).join('\t'));
			const codesetWrongList = nodeListByLabel(forged, 'Sif260928Codeset')
				.filter((codesetNode) => {
					const valueNodeList = valueNodeListByCodesetStableId.get(codesetNode.stableId) || [];
					return (
						codesetNode.properties.formatCellText !== `"${valueTextListOf(codesetNode.stableId).join(', ')}"` ||
						codesetNode.properties.valueCount !== valueNodeList.length ||
						valueNodeList.some((valueNode) => valueNode.properties.parentId !== codesetNode.stableId)
					);
				})
				.map((codesetNode) => codesetNode.stableId);
			const constrainedListSha256 = sortedLinesSha256(constrainedLineList);
			return {
				pass: constrainedListSha256 === RULED_CONSTRAINED_LIST_SHA256 && codesetWrongList.length === 0,
				detail: `constrained list sha ${constrainedListSha256.slice(0, 12)} (ruled ${RULED_CONSTRAINED_LIST_SHA256.slice(0, 12)}) over ${constrainedLineList.length} lines; Codesets wrong ${codesetWrongList.length}${firstOf(codesetWrongList)}`,
			};
		}),
	},
	{
		conjunctId: 'codesetNamedFromItsFields',
		title: "⟪campaign P3, G18⟫ every Codeset's name is the distinct <parent>/<field> names of the Fields that carry it, in Field order, the first three then 'and N more' — recomputed here from the HAS_OPTION_SET edges",
		twinNameList: ['codesetNameDropped', 'codesetNameFromLeafOnly'],
		evaluate: overForged((forged) => {
			const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
			const fieldXpathListByCodesetStableId = fieldOptionSetEdgeListOf(forged).reduce((soFar, oneEdge) => soFar.set(oneEdge.toRef.id, (soFar.get(oneEdge.toRef.id) || []).concat([nodeByStableId.get(oneEdge.fromRef.id).properties.xpath])), new Map());
			const wrongList = nodeListByLabel(forged, 'Sif260928Codeset')
				.filter((codesetNode) => codesetNode.properties.name !== expectedCodesetNameOf(fieldXpathListByCodesetStableId.get(codesetNode.stableId) || []))
				.map((codesetNode) => `${codesetNode.stableId}: ${JSON.stringify(codesetNode.properties.name)} vs ${JSON.stringify(expectedCodesetNameOf(fieldXpathListByCodesetStableId.get(codesetNode.stableId) || []))}`);
			return { pass: wrongList.length === 0 && fieldXpathListByCodesetStableId.size === RULED_CODESET_COUNT, detail: `${wrongList.length} misnamed${firstOf(wrongList)}` };
		}),
	},
	{
		conjunctId: 'paddedCodeListValueRefusedByName',
		title: `a scratch snapshot whose ${NAMED_PADDED_CODE_LIST_CELL} cells read "Yes,  No" is REFUSED BY NAME by the loader, naming the row and the padded value`,
		twinNameList: ['codeListGuardDisabled'],
		evaluate: refusedOnFixture({ alterTextByFileName: { [SOURCE_FILE_NAME]: withCodeListValuePadded }, refusalRe: /sif260928TsvLoader REFUSED: line \d+ \(\/[^)]+\) has a code list with an empty, padded or repeated value: " No"/ }),
	},
];
registerMutationTwin({
	gateId: CODESETS_GATE_ID,
	conjunctId: 'codesetNamedFromItsFields',
	twinName: 'codesetNameDropped',
	mutation: codesetsMutation({ find: '			name: codesetNameOf(codesetFacts.fieldXpathList),\n', replace: '' }),
});
registerMutationTwin({
	gateId: CODESETS_GATE_ID,
	conjunctId: 'codesetNamedFromItsFields',
	twinName: 'codesetNameFromLeafOnly',
	mutation: codesetsMutation({ find: ".slice(-2).join('/');", replace: ".slice(-1).join('/');" }),
});
// the Codeset looked up by the Field's xpath instead of its cell: every lookup misses, each Field
// re-mints its cell's entry, and only the last Field of each cell keeps its HAS_OPTION_SET
registerMutationTwin({
	gateId: CODESETS_GATE_ID,
	conjunctId: 'codesetCountsEqualSeparateCount',
	twinName: 'codesetLookupKeyedByXpath',
	mutation: codesetsMutation({ find: '			const codesetFacts = soFar.get(fieldFacts.format);', replace: '			const codesetFacts = soFar.get(fieldFacts.xpath);' }),
});
// the rejected reading of A28: any non-empty Format cell is a list
registerMutationTwin({
	gateId: CODESETS_GATE_ID,
	conjunctId: 'codesetCountsEqualSeparateCount',
	twinName: 'unquotedFormatTakenAsList',
	mutation: loaderMutation({ find: '	if (!isQuoteWrapped) {\n		return { codeListValueList: null };', replace: "	if (formatCellText === '') {\n		return { codeListValueList: null };" }),
});
registerMutationTwin({
	gateId: CODESETS_GATE_ID,
	conjunctId: 'everyListFieldConstrainedByItsOwnValues',
	twinName: 'valuesSorted',
	mutation: codesetsMutation({ find: '		codesetFacts.valueTextList.forEach((valueText, valueIndex) => {', replace: '		codesetFacts.valueTextList.slice().sort().forEach((valueText, valueIndex) => {' }),
});
// the first Field of the second Codeset constrained by the first: the counts hold, its values do not
registerMutationTwin({
	gateId: CODESETS_GATE_ID,
	conjunctId: 'everyListFieldConstrainedByItsOwnValues',
	twinName: 'oneFieldConstrainedByTheWrongCodeset',
	mutation: codesetsMutation({
		find: '			kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: fieldStableIdOfXpath(fieldXpath), toStableId: codesetStableId,',
		replace: "			kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: fieldStableIdOfXpath(fieldXpath), toStableId: fieldXpath === codesetFacts.fieldXpathList[0] && codesetFacts === codesetFactsList[1] ? `${STANDARD_STABLE_ID_PREFIX}${codesetFactsList[0].codesetPath}` : codesetStableId,",
	}),
});
registerMutationTwin({
	gateId: CODESETS_GATE_ID,
	conjunctId: 'paddedCodeListValueRefusedByName',
	twinName: 'codeListGuardDisabled',
	mutation: loaderMutation({ find: '	if (faultyValueList.length) {', replace: '	if (faultyValueList.length && false) {' }),
});

// =====================================================================
// (b) A4-KINDS
// =====================================================================
const kindsConjunctList = [
	{
		conjunctId: 'edgeTypesDistinctBetweenTheirOwnLabels',
		title: 'the edges are exactly HAS_FIELD 15,620, HAS_CHILD 21,017, HAS_INSTANCE 15,620, HAS_VALUE 4,055, HAS_OPTION_SET 1,495 (⟪P3, W-C-2⟫ was CONSTRAINED_BY), REFERENCES_OBJECT 607 and (A5) EMBEDS_TEXT_OF 14,539, and every HAS_VALUE, HAS_OPTION_SET and REFERENCES_OBJECT edge joins its own two labels',
		twinNameList: ['referencesFoldedIntoOptionSet'],
		evaluate: overForged((forged) => {
			const labelByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode.labels[1]]));
			const edgeCountByType = countBy(forged.edges, (oneEdge) => oneEdge.type);
			const ruledEdgeCountByType = { ...RULED_EARLIER_EDGE_COUNT_BY_TYPE, HAS_VALUE: RULED_CODESET_VALUE_COUNT, HAS_OPTION_SET: RULED_FIELD_OPTION_SET_COUNT, REFERENCES_OBJECT: RULED_REFERENCES_OBJECT_COUNT, EMBEDS_TEXT_OF: RULED_EMBEDS_TEXT_OF_COUNT };
			const endpointWrongList = forged.edges
				.filter((oneEdge) => RULED_EDGE_ENDPOINT_LABELS_BY_TYPE[oneEdge.type] !== undefined && `${labelByStableId.get(oneEdge.fromRef.id)}>${labelByStableId.get(oneEdge.toRef.id)}` !== RULED_EDGE_ENDPOINT_LABELS_BY_TYPE[oneEdge.type])
				.map((oneEdge) => `${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}`);
			return {
				pass: sortedEntriesText(edgeCountByType) === sortedEntriesText(ruledEdgeCountByType) && endpointWrongList.length === 0,
				detail: `edges ${JSON.stringify(edgeCountByType)}; between the wrong labels ${endpointWrongList.length}${firstOf(endpointWrongList)}`,
			};
		}),
	},
];
// the plan's twin: fold one kind into another
registerMutationTwin({
	gateId: KINDS_GATE_ID,
	conjunctId: 'edgeTypesDistinctBetweenTheirOwnLabels',
	twinName: 'referencesFoldedIntoOptionSet',
	mutation: referencesMutation({ find: '			edgeType: EDGE_TYPES.REFERENCES_OBJECT,', replace: '			edgeType: EDGE_TYPES.HAS_OPTION_SET,' }),
});

// =====================================================================
// (c) A4-REFERENCES
// =====================================================================
const REF_ID_NAME_RE = /^@?(.+RefId)$/;
const referencesConjunctList = [
	{
		conjunctId: 'referencesEqualSeparateCount',
		title: "REFERENCES_OBJECT = 607, 200 of them through the map; the sorted (Field xpath, Object path) lines hash to the separate count's; the RefId Fields with no edge are exactly @SIF_RefId x10 and SIF_RefId x4",
		twinNameList: ['oneMapRowDeleted', 'attributeMarkerKept'],
		evaluate: overForged((forged) => {
			const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
			const referenceEdgeList = edgeListByType(forged, 'REFERENCES_OBJECT');
			const referenceLineList = referenceEdgeList.map((oneEdge) => `${nodeByStableId.get(oneEdge.fromRef.id).properties.xpath}\t${nodeByStableId.get(oneEdge.toRef.id).properties.path}`);
			const viaMapCount = referenceEdgeList.filter((oneEdge) => oneEdge.properties.resolvedThrough === 'refIdResolutionMap').length;
			const referencingFieldStableIdSet = new Set(referenceEdgeList.map((oneEdge) => oneEdge.fromRef.id));
			// read from the Field names, not from the forge's rule: a RefId name (one '@' allowed) other than RefId itself
			const unresolvedRowCountByName = countBy(
				nodeListByLabel(forged, 'Sif260928Field').filter((fieldNode) => REF_ID_NAME_RE.test(fieldNode.properties.name) && fieldNode.properties.name.replace(/^@/, '') !== 'RefId' && !referencingFieldStableIdSet.has(fieldNode.stableId)),
				(fieldNode) => fieldNode.properties.name,
			);
			const referenceListSha256 = sortedLinesSha256(referenceLineList);
			return {
				pass:
					referenceEdgeList.length === RULED_REFERENCES_OBJECT_COUNT &&
					viaMapCount === RULED_REFERENCES_OBJECT_VIA_MAP_COUNT &&
					referenceListSha256 === RULED_REFERENCE_LIST_SHA256 &&
					sortedEntriesText(unresolvedRowCountByName) === sortedEntriesText(RULED_UNRESOLVED_ROW_COUNT_BY_NAME),
				detail: `REFERENCES_OBJECT ${referenceEdgeList.length}, through the map ${viaMapCount}; list sha ${referenceListSha256.slice(0, 12)} (ruled ${RULED_REFERENCE_LIST_SHA256.slice(0, 12)}); unresolved ${JSON.stringify(unresolvedRowCountByName)}`,
			};
		}),
	},
	{
		conjunctId: 'mapTargetNamingNoTableRefusedByName',
		title: `a scratch map resolving ${NAMED_BAD_TARGET_REF_ID_NAME} to '${NAMED_MISSING_TABLE_TITLE}' is REFUSED BY NAME, naming the RefId and the table`,
		twinNameList: ['mapTargetRefusalDisabled'],
		evaluate: refusedOnFixture({
			alterTextByFileName: { [REF_ID_MAP_FILE_NAME]: withMapTargetMissing },
			refusalRe: new RegExp(`sif260928References REFUSED: refIdResolutionMap\\.tsv resolves '${NAMED_BAD_TARGET_REF_ID_NAME}' to table '${NAMED_MISSING_TABLE_TITLE}', which is no table title of the TSV`),
		}),
	},
	{
		conjunctId: 'refIdMappedToTwoTablesRefusedByName',
		title: `a scratch map whose second ${NAMED_REPEATED_REF_ID_NAME} row names '${NAMED_CONFLICTING_TABLE_TITLE}' is REFUSED BY NAME, naming both tables`,
		twinNameList: ['conflictingMapRowRefusalDisabled'],
		evaluate: refusedOnFixture({
			alterTextByFileName: { [REF_ID_MAP_FILE_NAME]: withRepeatedRowConflicting },
			refusalRe: new RegExp(`sif260928RefIdMapLoader REFUSED: refIdResolutionMap\\.tsv maps '${NAMED_REPEATED_REF_ID_NAME}' to 'StudentContactPersonals' and, on line \\d+, to '${NAMED_CONFLICTING_TABLE_TITLE}'`),
		}),
	},
];
// the plan's twin: one map row deleted in a scratch snapshot (SHA256SUMS regenerated), so its Fields
// fall to the exact-name rule, match no object, and the count moves
registerFixtureTwin({ gateId: REFERENCES_GATE_ID, conjunctId: 'referencesEqualSeparateCount', twinName: 'oneMapRowDeleted', alterTextByFileName: { [REF_ID_MAP_FILE_NAME]: withMapRowDeleted } });
// the rejected reading of A28: the attribute marker stays part of the name
registerMutationTwin({
	gateId: REFERENCES_GATE_ID,
	conjunctId: 'referencesEqualSeparateCount',
	twinName: 'attributeMarkerKept',
	mutation: referencesMutation({ find: 'const bareNameOf = (fieldName) => (fieldName.startsWith(ATTRIBUTE_NAME_PREFIX) ? fieldName.slice(ATTRIBUTE_NAME_PREFIX.length) : fieldName);', replace: 'const bareNameOf = (fieldName) => fieldName;' }),
});
registerMutationTwin({
	gateId: REFERENCES_GATE_ID,
	conjunctId: 'mapTargetNamingNoTableRefusedByName',
	twinName: 'mapTargetRefusalDisabled',
	mutation: referencesMutation({ find: '	if (targetObjectPath === undefined) {\n		throw', replace: '	if (targetObjectPath === undefined) {\n		return null;\n		throw' }),
});
registerMutationTwin({
	gateId: REFERENCES_GATE_ID,
	conjunctId: 'refIdMappedToTwoTablesRefusedByName',
	twinName: 'conflictingMapRowRefusalDisabled',
	mutation: mapLoaderMutation({ find: '		if (earlierTableTitle !== undefined && earlierTableTitle !== resolvedTableTitle) {', replace: '		if (earlierTableTitle !== undefined && earlierTableTitle !== resolvedTableTitle && false) {' }),
});

// =====================================================================
// (d) A4-UNCHANGED
// =====================================================================
const unchangedConjunctList = [
	{
		conjunctId: 'earlierCountsAndQuestionListUnchanged',
		title: "the earlier nodes are still 1 root, 159 Objects, 6,586 Containers, 15,620 Fields and 5,018 Questions; HAS_FIELD, HAS_CHILD and HAS_INSTANCE are still 15,620, 21,017 and 15,620; the sorted questionRefId list still hashes to C1's",
		twinNameList: ['optionSetWrittenAsHasField'],
		evaluate: overForged((forged) => {
			const earlierCountByLabel = countBy(forged.nodes.filter((oneNode) => RULED_EARLIER_NODE_COUNT_BY_LABEL[oneNode.labels[1]] !== undefined), (oneNode) => oneNode.labels[1]);
			const earlierCountByType = countBy(forged.edges.filter((oneEdge) => RULED_EARLIER_EDGE_COUNT_BY_TYPE[oneEdge.type] !== undefined), (oneEdge) => oneEdge.type);
			const questionRefIdListSha256 = sortedLinesSha256(nodeListByLabel(forged, 'Sif260928Question').map((oneNode) => oneNode.properties.questionRefId));
			return {
				pass:
					sortedEntriesText(earlierCountByLabel) === sortedEntriesText(RULED_EARLIER_NODE_COUNT_BY_LABEL) &&
					sortedEntriesText(earlierCountByType) === sortedEntriesText(RULED_EARLIER_EDGE_COUNT_BY_TYPE) &&
					questionRefIdListSha256 === RULED_QUESTION_REF_ID_LIST_SHA256,
				detail: `nodes ${JSON.stringify(earlierCountByLabel)}; edges ${JSON.stringify(earlierCountByType)}; question list sha ${questionRefIdListSha256.slice(0, 12)}`,
			};
		}),
	},
];
// a new edge written under an earlier type
registerMutationTwin({
	gateId: UNCHANGED_GATE_ID,
	conjunctId: 'earlierCountsAndQuestionListUnchanged',
	twinName: 'optionSetWrittenAsHasField',
	mutation: codesetsMutation({ find: '			kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET,', replace: '			kit.addEdge({ edgeType: EDGE_TYPES.HAS_FIELD,' }),
});

const gateDeclarationList = [
	{ gateId: CODESETS_GATE_ID, title: '(a) the code lists equal the separate count', conjunctList: codesetsConjunctList },
	{ gateId: KINDS_GATE_ID, title: '(b) the edge kinds stay distinct', conjunctList: kindsConjunctList },
	{ gateId: REFERENCES_GATE_ID, title: '(c) REFERENCES_OBJECT equals the separate count', conjunctList: referencesConjunctList },
	{ gateId: UNCHANGED_GATE_ID, title: '(d) the earlier counts are unchanged', conjunctList: unchangedConjunctList },
];

runGateFamily({ harness, familyName: 'sif260928 A4 codesets and references', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 9, expectedTwinCount: 13 }, () => {
	scratchRootPathList.forEach((oneScratchRootPath) => fs.rmSync(oneScratchRootPath, { recursive: true, force: true }));
	harness.report();
});
