#!/usr/bin/env node
'use strict';

// test-sif260928Walk.js — the phase A1c gates for the sif260928 walk: the root, 159 Objects and
// 15,620 Fields (PLAN-sifReplacement-smallPhases-092826.md §3 A1c; SPEC §3.1 as amended by §9,
// including A25). ALL PURE: the whole forge runs in pure mode (skipEmbedding, no Docker, no network).
// Every conjunct is observed RED under its own twin before the family counts as green; the
// framework's gate engine does the sweep (roundTripHarness/gateEvaluator via gateSuiteRunner).
//
//   A1c-COUNTS      (a) Objects = 159 and Fields = 15,620 as minted nodes, and each Object's
//                       fieldCount equals its HAS_FIELD edges (restated in A2, which re-parents
//                       Fields onto Containers)
//   A1c-DESCRIPTION (b) description is absent, never ''; the kit refuses a forced ''
//   A1c-PARENTPATH  (c) parentPath is floored at the object for an attribute on the object element;
//                       without the floor the named row lands above its object and is refused by name
//   A1c-ROLES       (d) every minted node's role equals the ruled table (restated in A4: the
//                       Codeset and CodesetValue rows of A1a's table arrive with the code lists)
//   A1c-PROPERTIES      the brief's Field properties, read against the TSV cells independently:
//                       verbatim cells, empty cells absent (A25), derived facts equal to the SPEC's and C1's
//   A1c-STRUCTURE       questionRefId only on Fields and Questions, and each Object's structural parent
//                       is the root (restated in A2: the edges and the Field parentage now belong to
//                       test-sif260928Tree.js; restated in A3: questionRefId arrives with the Questions,
//                       whose values test-sif260928Questions.js proves)
//
// Mutations are compiled in memory (moduleDouble); nothing in the tree is written.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928Walk.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A1c gates: counts, description, parentPath floor, roles, properties, structure

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const ENTRY_MODULE_PATH = path.join(BUNDLE_DIR, 'forgeSif260928.js');
const WALK_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Walk.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
// C1's independent witness; <codeRoot>/../dataStores resolves in system/code and in a worktree alike
const C1_CENSUS_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'sif260928', 'yardstick', 'CENSUS-636450dd7276.md');

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_FILE_NAME = descriptorValueByName.sourceFile;
const SOURCE_PATH = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot, SOURCE_FILE_NAME);

// ---- FROZEN LITERALS. Never edited to match a measurement.
// PLAN §3 A1c (a); SPEC §1. The Containers A2 adds are counted by test-sif260928Tree.js.
const RULED_NODE_COUNT_BY_LABEL = Object.freeze({ Sif260928Root: 1, Sif260928Object: 159, Sif260928Field: 15620 });
// PLAN §3 A1a role table (review #9), plus the framework's root; the Container row arrived with A2,
// the Question row with A3, the Codeset and CodesetValue rows with A4, and with A5 the text nodes, which
// the framework mints under its own role from the bundle's embedTextDeclaration
const RULED_ROLE_BY_LABEL = Object.freeze({
	Sif260928Root: 'DmeStandardRoot',
	Sif260928Object: 'DmeClass',
	Sif260928Field: 'DmeInstance', // ⟪campaign P3, W-B-12 (a); ruling R1⟫ was DmeSupport
	Sif260928Container: 'DmeSupport',
	Sif260928Question: 'DmeProperty',
	Sif260928Codeset: 'DmeOptionSet',
	Sif260928CodesetValue: 'DmeOptionValue',
	Sif260928EmbedText: 'DmeEmbedText',
});
// PLAN §3 A1b (a): empty descriptions
const EMPTY_DESCRIPTION_ROW_COUNT = 4733;
// the named row of gate (c): an attribute directly on the object element
const FLOOR_NAMED_XPATH = '/AccountingPeriods/AccountingPeriod/@RefId';
const FLOOR_NAMED_OBJECT_PATH = '/AccountingPeriods/AccountingPeriod';
// measured on the TSV by A1c: rows that are an attribute directly on the object element
const ATTRIBUTE_ON_OBJECT_ROW_COUNT = 321;
// SPEC §9 A21: the floored parent cohort leaves 706 rows alone (806 unfloored)
const FLOORED_PARENT_COHORT_SINGLETON_ROW_COUNT = 706;
// SPEC §1 and §9 A21: shared blocks, SIF_ExtendedElements counted at any depth
const RULED_ROW_COUNT_BY_SHARED_BLOCK = Object.freeze({ SIF_Metadata: 8976, SIF_ExtendedElements: 492, model: 6152 });
// SPEC §9 A25 (EBONY_DREAM 2026-09-28): a verbatim cell property is ABSENT when its cell is empty.
// Empty cells measured on the TSV by A1c: Mandatory 8,226, Characteristics 162 (plan), Description 4,733
// (plan), CEDS ID 13,389 (15,620 - 2,231, plan), Format 13,875.
const RULED_ABSENT_COUNT_BY_PROPERTY = Object.freeze({ mandatoryCellText: 8226, characteristics: 162, descriptionCellText: 4733, cedsIdCellText: 13389, format: 13875 });
// the brief's Field property list (SPEC §3.1 as amended, A25), plus what the kit and the framework stamp
const RULED_FIELD_PROPERTY_NAME_LIST = Object.freeze(
	[
		// the kit's universal stamps
		'_id', '_source', 'name', 'role', 'sif260928StableId', 'parentId', 'path',
		// the brief's list
		'description', 'descriptionQuoted', 'descriptionCellText', 'xpath', 'relativePath', 'objectName', 'parentPath', 'xpathDepth', 'isAttribute',
		'characteristics', 'obligation', 'repeatable', 'mandatoryCellText', 'sharedBlock', 'cedsElementId', 'cedsIdCellText', 'type', 'format',
		// A3: the id of the Field's Question (SPEC §9 A17)
		'questionRefId',
		// the structural finalizer's stamps
		'depth', 'crossRefs',
		// A6: the TSV line the row sits on (the regeneration proof's row order)
		'sourceLineNumber',
	].sort(),
);
// restated at A6: every Object carries exactly these property names, tableTitleName (the table's title
// less ': Table 1') being A6's addition for the regeneration proof
const RULED_OBJECT_PROPERTY_NAME_LIST = Object.freeze(['_id', '_source', 'name', 'role', 'sif260928StableId', 'searchText', 'parentId', 'path', 'objectName', 'fieldCount', 'depth', 'crossRefs', 'tableTitleName'].sort());
// SPEC §3.1: the closed Characteristics table and what each code derives
const RULED_CHARACTERISTICS = Object.freeze({
	M: { obligation: 'mandatory', repeatable: false },
	MR: { obligation: 'mandatory', repeatable: true },
	O: { obligation: 'optional', repeatable: false },
	OR: { obligation: 'optional', repeatable: true },
	C: { obligation: 'conditional', repeatable: false },
});
// measured by A1b's stand-down: Format cells holding a double quote, carried verbatim
const FORMAT_WITH_QUOTE_ROW_COUNT = 1495;

// ---- the TSV read independently of the loader and the walk: raw cells, in source order
const RAW_COLUMN_INDEX = Object.freeze({ name: 0, mandatory: 1, characteristics: 2, type: 3, description: 4, xpath: 5, cedsId: 6, format: 7 });
const RAW_CELL_LIST_LIST = fs
	.readFileSync(SOURCE_PATH, 'utf8')
	.split('\r\n')
	.filter((lineText) => !lineText.startsWith('Name\tMandatory\tCharacteristics\t'))
	.map((lineText) => lineText.split('\t'))
	.filter((cellList) => cellList.length === 8);
const RAW_CELL_LIST_BY_XPATH = new Map(RAW_CELL_LIST_LIST.map((cellList) => [cellList[RAW_COLUMN_INDEX.xpath], cellList]));

// C1's census line for the floored parent cohort: 'median / rows alone: 2 / 706'
const readC1FlooredSingletonRowCount = () => {
	const censusMatch = /^- parentCohort floored at the object \(SPEC section 3\.1 Field\.parentPath\): median \/ rows alone: \d+ \/ (\d+)$/m.exec(fs.readFileSync(C1_CENSUS_PATH, 'utf8'));
	return censusMatch ? Number(censusMatch[1]) : null;
};

// ---- the subject every conjunct reads and every twin mutates (on a clone)
const makeSubject = () => ({ bundleMutationList: [] });
const cloneSubject = (subject) => ({ ...subject, bundleMutationList: subject.bundleMutationList.slice() });

// the whole forge in pure mode, as the forger runs it, with the subject's mutations (plus any extra)
const forgeWith = ({ mutationList }, callback) => {
	const forgeBundle = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: ENTRY_MODULE_PATH, mutationList }) : require(ENTRY_MODULE_PATH);
	forgeBundle({ embedder: null }).forge({ sourcePath: SOURCE_PATH, owner: 'test', skipEmbedding: true }, callback);
};

// a conjunct over the forged nodes and edges: a forge refusal is a FAIL, with the refusal as the detail
const overForged = (judgeForged) => (subject, callback) => {
	forgeWith({ mutationList: subject.bundleMutationList }, (forgeError, forged) => {
		if (forgeError) {
			callback('', { pass: false, detail: `forge refused: ${String(forgeError).slice(0, 300)}` });
			return;
		}
		callback('', judgeForged(forged));
	});
};

const nodeListByLabel = (forged, perStandardLabel) => forged.nodes.filter((oneNode) => oneNode.labels[1] === perStandardLabel);
const countBy = (itemList, countedValueOf) =>
	itemList.reduce((countByValue, oneItem) => {
		const countedValue = countedValueOf(oneItem);
		countByValue[countedValue] = (countByValue[countedValue] || 0) + 1;
		return countByValue;
	}, {});

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
const walkMutation = ({ find, replace }) => ({ modulePath: WALK_MODULE_PATH, find, replace });

const COUNTS_GATE_ID = 'A1c-COUNTS';
const DESCRIPTION_GATE_ID = 'A1c-DESCRIPTION';
const PARENT_PATH_GATE_ID = 'A1c-PARENTPATH';
const ROLES_GATE_ID = 'A1c-ROLES';
const PROPERTIES_GATE_ID = 'A1c-PROPERTIES';
const STRUCTURE_GATE_ID = 'A1c-STRUCTURE';

// the floor removed: an attribute on the object element folds to the collection
const FLOOR_REMOVED_MUTATION = walkMutation({
	find: 'return foldedSegmentList.length < OBJECT_SEGMENT_COUNT ? segmentList.slice(0, OBJECT_SEGMENT_COUNT) : foldedSegmentList;',
	replace: 'return foldedSegmentList;',
});

// =====================================================================
// (a) A1c-COUNTS
// =====================================================================
const countsConjunctList = [
	{
		conjunctId: 'objectAndFieldCountsAsMintedNodes',
		title: "the minted nodes are exactly 1 root, 159 Objects and 15,620 Fields (beside A2's Containers), and each Object's fieldCount equals its HAS_FIELD edges",
		twinNameList: ['oneRowNotMinted', 'oneObjectDroppedWithItsSubtree'],
		evaluate: overForged((forged) => {
			const countByLabel = countBy(forged.nodes.filter((oneNode) => RULED_NODE_COUNT_BY_LABEL[oneNode.labels[1]] !== undefined), (oneNode) => oneNode.labels[1]);
			const hasFieldCountByObjectStableId = countBy(forged.edges.filter((oneEdge) => oneEdge.type === 'HAS_FIELD'), (oneEdge) => oneEdge.fromRef.id);
			const fieldCountWrongList = nodeListByLabel(forged, 'Sif260928Object').filter((oneNode) => oneNode.properties.fieldCount !== hasFieldCountByObjectStableId[oneNode.stableId]);
			const countsAgree = JSON.stringify(Object.entries(countByLabel).sort()) === JSON.stringify(Object.entries(RULED_NODE_COUNT_BY_LABEL).sort());
			return {
				pass: countsAgree && fieldCountWrongList.length === 0,
				detail: `minted ${JSON.stringify(countByLabel)}; Objects whose fieldCount disagrees ${fieldCountWrongList.length}${fieldCountWrongList.length ? ` (first ${fieldCountWrongList[0].stableId})` : ''}`,
			};
		}),
	},
];
registerMutationTwin({ gateId: COUNTS_GATE_ID, conjunctId: 'objectAndFieldCountsAsMintedNodes', twinName: 'oneRowNotMinted', mutation: walkMutation({ find: 'const fieldFactsList = rowList.map(fieldFactsOf);', replace: 'const fieldFactsList = rowList.slice(1).map(fieldFactsOf);' }) });
// one Object dropped together with its whole subtree: the tree stays whole and the counts move (A2 back-gate)
registerMutationTwin({ gateId: COUNTS_GATE_ID, conjunctId: 'objectAndFieldCountsAsMintedNodes', twinName: 'oneObjectDroppedWithItsSubtree', mutation: walkMutation({ find: 'const fieldFactsList = rowList.map(fieldFactsOf);', replace: "const fieldFactsList = rowList.filter((row) => !row.xpath.startsWith('/AccountingPeriods/AccountingPeriod/')).map(fieldFactsOf);" }) });

// =====================================================================
// (b) A1c-DESCRIPTION
// =====================================================================
const descriptionConjunctList = [
	{
		conjunctId: 'descriptionAbsentNeverEmpty',
		title: "no node carries description ''; exactly the 4,733 Fields with an empty description carry none; every other Field carries its cell with one quote pair stripped, then trimmed",
		twinNameList: ['emptyDescriptionForcedToEmptyString'],
		evaluate: overForged((forged) => {
			const emptyStringNodeList = forged.nodes.filter((oneNode) => oneNode.properties.description === '');
			const fieldNodeList = nodeListByLabel(forged, 'Sif260928Field');
			const absentCount = fieldNodeList.filter((oneNode) => !Object.prototype.hasOwnProperty.call(oneNode.properties, 'description')).length;
			const wrongList = fieldNodeList.filter((oneNode) => {
				const cellText = RAW_CELL_LIST_BY_XPATH.get(oneNode.properties.xpath)[RAW_COLUMN_INDEX.description];
				const unwrappedText = cellText.length >= 2 && cellText.startsWith('"') && cellText.endsWith('"') ? cellText.slice(1, -1) : cellText;
				const expectedDescription = unwrappedText.trim() === '' ? undefined : unwrappedText.trim();
				return oneNode.properties.description !== expectedDescription;
			});
			return {
				pass: emptyStringNodeList.length === 0 && absentCount === EMPTY_DESCRIPTION_ROW_COUNT && wrongList.length === 0,
				detail: `description '' on ${emptyStringNodeList.length} nodes; absent on ${absentCount} Fields; wrong on ${wrongList.length}${wrongList.length ? ` (first ${wrongList[0].stableId})` : ''}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: DESCRIPTION_GATE_ID,
	conjunctId: 'descriptionAbsentNeverEmpty',
	twinName: 'emptyDescriptionForcedToEmptyString',
	mutation: walkMutation({ find: '...(fieldFacts.description === null ? {} : { description: fieldFacts.description }),', replace: "description: fieldFacts.description === null ? '' : fieldFacts.description," }),
});

// =====================================================================
// (c) A1c-PARENTPATH
// =====================================================================
const parentPathConjunctList = [
	{
		conjunctId: 'attributeOnObjectFlooredAtObject',
		title: `the named row ${FLOOR_NAMED_XPATH} has parentPath ${FLOOR_NAMED_OBJECT_PATH}; all 321 attributes on an object element have their object's path; the floored cohort leaves 706 rows alone (SPEC A21 and C1)`,
		twinNameList: ['floorRemoved'],
		evaluate: overForged((forged) => {
			const fieldNodeList = nodeListByLabel(forged, 'Sif260928Field');
			const namedNode = fieldNodeList.find((oneNode) => oneNode.properties.xpath === FLOOR_NAMED_XPATH);
			const attributeOnObjectNodeList = fieldNodeList.filter((oneNode) => oneNode.properties.xpath.split('/').length === 4 && oneNode.properties.isAttribute === true);
			const notFlooredList = attributeOnObjectNodeList.filter((oneNode) => oneNode.properties.parentPath !== oneNode.properties.xpath.split('/').slice(0, 3).join('/'));
			const singletonRowCount = Object.values(countBy(fieldNodeList, (oneNode) => oneNode.properties.parentPath)).filter((cohortSize) => cohortSize === 1).length;
			const c1SingletonRowCount = readC1FlooredSingletonRowCount();
			return {
				pass:
					namedNode !== undefined &&
					namedNode.properties.parentPath === FLOOR_NAMED_OBJECT_PATH &&
					attributeOnObjectNodeList.length === ATTRIBUTE_ON_OBJECT_ROW_COUNT &&
					notFlooredList.length === 0 &&
					singletonRowCount === FLOORED_PARENT_COHORT_SINGLETON_ROW_COUNT &&
					c1SingletonRowCount === FLOORED_PARENT_COHORT_SINGLETON_ROW_COUNT,
				detail: `named row parentPath ${namedNode ? namedNode.properties.parentPath : 'absent'}; attributes on an object ${attributeOnObjectNodeList.length}, not floored ${notFlooredList.length}; rows alone ${singletonRowCount}, C1 ${c1SingletonRowCount}`,
			};
		}),
	},
	{
		conjunctId: 'parentPathAboveObjectRefusedByName',
		title: `with the floor removed, the forge is REFUSED BY NAME: ${FLOOR_NAMED_XPATH} has parentPath '/AccountingPeriods', above its object`,
		twinNameList: ['aboveObjectRefusalDisabled'],
		evaluate: (subject, callback) => {
			forgeWith({ mutationList: subject.bundleMutationList.concat([FLOOR_REMOVED_MUTATION]) }, (forgeError, forged) => {
				const refusalRe = new RegExp(`sif260928Walk REFUSED: line \\d+ \\(${FLOOR_NAMED_XPATH}\\) has parentPath '/AccountingPeriods', above its object '${FLOOR_NAMED_OBJECT_PATH}'`);
				const pass = typeof forgeError === 'string' && refusalRe.test(forgeError);
				callback('', { pass, detail: forgeError ? forgeError.slice(0, 300) : `NOT refused: forged ${forged.nodes.length} nodes` });
			});
		},
	},
];
registerMutationTwin({ gateId: PARENT_PATH_GATE_ID, conjunctId: 'attributeOnObjectFlooredAtObject', twinName: 'floorRemoved', mutation: FLOOR_REMOVED_MUTATION });
registerMutationTwin({
	gateId: PARENT_PATH_GATE_ID,
	conjunctId: 'parentPathAboveObjectRefusedByName',
	twinName: 'aboveObjectRefusalDisabled',
	mutation: walkMutation({ find: '		assertParentPathWithinObject({ fieldFacts });\n', replace: '' }),
});

// =====================================================================
// (d) A1c-ROLES
// =====================================================================
const rolesConjunctList = [
	{
		conjunctId: 'everyNodeRoleEqualsRuledTable',
		title: "every minted node's role (its role property and its role label) equals the ruled table for its per-standard label: Object DmeClass, Field DmeInstance (P3, R1), Container DmeSupport, Question DmeProperty, Codeset DmeOptionSet, CodesetValue DmeOptionValue",
		twinNameList: ['oneFieldMintedAsDmeProperty'],
		evaluate: overForged((forged) => {
			const wrongList = forged.nodes.filter((oneNode) => {
				const ruledRole = RULED_ROLE_BY_LABEL[oneNode.labels[1]];
				return ruledRole === undefined || oneNode.role !== ruledRole || oneNode.properties.role !== ruledRole || oneNode.labels[2] !== ruledRole;
			});
			return { pass: wrongList.length === 0, detail: wrongList.length ? `${wrongList.length} wrong, first ${wrongList[0].stableId} ${wrongList[0].labels.join(':')}` : `${forged.nodes.length} nodes, roles ${JSON.stringify(countBy(forged.nodes, (oneNode) => oneNode.role))}` };
		}),
	},
];
registerMutationTwin({
	gateId: ROLES_GATE_ID,
	conjunctId: 'everyNodeRoleEqualsRuledTable',
	twinName: 'oneFieldMintedAsDmeProperty',
	mutation: walkMutation({ find: '			role: fieldKind.role,', replace: "			role: fieldFacts.xpath === '/AccountingPeriods/AccountingPeriod/EndDate' ? 'DmeProperty' : fieldKind.role," }),
});

// =====================================================================
// A1c-PROPERTIES
// =====================================================================
const cellOrAbsent = (cellText) => (cellText === '' ? undefined : cellText);
const propertiesConjunctList = [
	{
		conjunctId: 'fieldCellsCarriedVerbatim',
		title: "every Field's name, type, format, mandatoryCellText, characteristics, descriptionCellText, cedsIdCellText and xpath equal its TSV cells verbatim (absent when empty); cedsElementId is P + the cell; obligation and repeatable follow the closed table; descriptionQuoted says whether one pair was stripped; the 1,495 quoted Format cells keep their quotes",
		twinNameList: ['formatQuotesStripped'],
		evaluate: overForged((forged) => {
			const fieldNodeList = nodeListByLabel(forged, 'Sif260928Field');
			const wrongList = fieldNodeList.filter((oneNode) => {
				const properties = oneNode.properties;
				const cellList = RAW_CELL_LIST_BY_XPATH.get(properties.xpath);
				const descriptionCellText = cellList[RAW_COLUMN_INDEX.description];
				const ruledCharacteristics = RULED_CHARACTERISTICS[cellList[RAW_COLUMN_INDEX.characteristics]];
				return (
					properties.name !== cellList[RAW_COLUMN_INDEX.name] ||
					properties.type !== cellList[RAW_COLUMN_INDEX.type] ||
					properties.format !== cellOrAbsent(cellList[RAW_COLUMN_INDEX.format]) ||
					properties.mandatoryCellText !== cellOrAbsent(cellList[RAW_COLUMN_INDEX.mandatory]) ||
					properties.characteristics !== cellOrAbsent(cellList[RAW_COLUMN_INDEX.characteristics]) ||
					properties.descriptionCellText !== cellOrAbsent(descriptionCellText) ||
					properties.cedsIdCellText !== cellOrAbsent(cellList[RAW_COLUMN_INDEX.cedsId]) ||
					properties.cedsElementId !== (cellList[RAW_COLUMN_INDEX.cedsId] === '' ? undefined : `P${cellList[RAW_COLUMN_INDEX.cedsId]}`) ||
					properties.obligation !== (ruledCharacteristics === undefined ? undefined : ruledCharacteristics.obligation) ||
					properties.repeatable !== (ruledCharacteristics === undefined ? undefined : ruledCharacteristics.repeatable) ||
					properties.descriptionQuoted !== (descriptionCellText.length >= 2 && descriptionCellText.startsWith('"') && descriptionCellText.endsWith('"')) ||
					properties.path !== properties.xpath ||
					oneNode.stableId !== `sif260928:field${cellList[RAW_COLUMN_INDEX.xpath]}`
				);
			});
			const quotedFormatCount = fieldNodeList.filter((oneNode) => oneNode.properties.format !== undefined && oneNode.properties.format.includes('"')).length;
			return {
				pass: fieldNodeList.length === RAW_CELL_LIST_LIST.length && wrongList.length === 0 && quotedFormatCount === FORMAT_WITH_QUOTE_ROW_COUNT,
				detail: `Fields ${fieldNodeList.length}, TSV rows ${RAW_CELL_LIST_LIST.length}; wrong ${wrongList.length}${wrongList.length ? ` (first ${wrongList[0].stableId})` : ''}; Format with a quote ${quotedFormatCount}`,
			};
		}),
	},
	{
		conjunctId: 'emptyCellsAbsentNeverEmptyString',
		title: "no property of any node is '' (SPEC A25), each verbatim cell property is absent exactly as often as its cell is empty, every Field carries only the brief's property names, and every Object exactly the ruled ones (restated at A6: +sourceLineNumber, +tableTitleName)",
		twinNameList: ['emptyCellsStampedAsEmptyString', 'objectTableTitleNotCarried'],
		evaluate: overForged((forged) => {
			const emptyStringList = forged.nodes.reduce((soFar, oneNode) => soFar.concat(Object.keys(oneNode.properties).filter((propertyName) => oneNode.properties[propertyName] === '').map((propertyName) => `${oneNode.stableId}.${propertyName}`)), []);
			const fieldNodeList = nodeListByLabel(forged, 'Sif260928Field');
			const absentCountByProperty = Object.keys(RULED_ABSENT_COUNT_BY_PROPERTY).reduce((soFar, propertyName) => ({ ...soFar, [propertyName]: fieldNodeList.filter((oneNode) => oneNode.properties[propertyName] === undefined).length }), {});
			const unruledNameList = [...new Set(fieldNodeList.reduce((soFar, oneNode) => soFar.concat(Object.keys(oneNode.properties)), []))].filter((propertyName) => RULED_FIELD_PROPERTY_NAME_LIST.indexOf(propertyName) === -1);
			const objectPropertyWrongList = nodeListByLabel(forged, 'Sif260928Object')
				.filter((oneNode) => JSON.stringify(Object.keys(oneNode.properties).sort()) !== JSON.stringify(RULED_OBJECT_PROPERTY_NAME_LIST))
				.map((oneNode) => `${oneNode.stableId} [${Object.keys(oneNode.properties).sort()}]`);
			return {
				pass: emptyStringList.length === 0 && JSON.stringify(absentCountByProperty) === JSON.stringify(RULED_ABSENT_COUNT_BY_PROPERTY) && unruledNameList.length === 0 && objectPropertyWrongList.length === 0,
				detail: `'' on ${emptyStringList.length}${emptyStringList.length ? ` (first ${emptyStringList[0]})` : ''}; absent ${JSON.stringify(absentCountByProperty)}; unruled names [${unruledNameList}]; Objects not carrying exactly the ruled names ${objectPropertyWrongList.length}${objectPropertyWrongList.length ? ` (first ${objectPropertyWrongList[0]})` : ''}`,
			};
		}),
	},
	{
		conjunctId: 'derivedFactsEqualSpec',
		title: "each Field's objectName, relativePath, isAttribute and xpathDepth follow from its xpath; sharedBlock counts equal SPEC §1 (8,976 / 492 at any depth / 6,152); 159 distinct objectNames; each Object carries its name and path",
		twinNameList: ['sharedBlockTopLevelOnly'],
		evaluate: overForged((forged) => {
			const fieldNodeList = nodeListByLabel(forged, 'Sif260928Field');
			const wrongList = fieldNodeList.filter((oneNode) => {
				const properties = oneNode.properties;
				const segmentList = properties.xpath.split('/').slice(1);
				return (
					properties.objectName !== segmentList[1] ||
					properties.relativePath !== segmentList.slice(2).join('/') ||
					properties.isAttribute !== segmentList[segmentList.length - 1].startsWith('@') ||
					properties.xpathDepth !== segmentList.length
				);
			});
			const rowCountBySharedBlock = countBy(fieldNodeList, (oneNode) => oneNode.properties.sharedBlock);
			const objectNodeList = nodeListByLabel(forged, 'Sif260928Object');
			const objectWrongList = objectNodeList.filter((oneNode) => oneNode.properties.name !== oneNode.properties.objectName || oneNode.stableId !== `sif260928:object${oneNode.properties.path}` || oneNode.properties.path.split('/')[2] !== oneNode.properties.objectName);
			const distinctObjectNameCount = new Set(fieldNodeList.map((oneNode) => oneNode.properties.objectName)).size;
			return {
				pass: wrongList.length === 0 && JSON.stringify(Object.entries(rowCountBySharedBlock).sort()) === JSON.stringify(Object.entries(RULED_ROW_COUNT_BY_SHARED_BLOCK).sort()) && distinctObjectNameCount === 159 && objectWrongList.length === 0,
				detail: `Fields wrong ${wrongList.length}; sharedBlock ${JSON.stringify(rowCountBySharedBlock)}; distinct objectNames ${distinctObjectNameCount}; Objects wrong ${objectWrongList.length}`,
			};
		}),
	},
];
registerMutationTwin({ gateId: PROPERTIES_GATE_ID, conjunctId: 'fieldCellsCarriedVerbatim', twinName: 'formatQuotesStripped', mutation: walkMutation({ find: '		...row,\n', replace: "		...row,\n		format: row.format.replace(/\"/g, ''),\n" }) });
registerMutationTwin({ gateId: PROPERTIES_GATE_ID, conjunctId: 'emptyCellsAbsentNeverEmptyString', twinName: 'emptyCellsStampedAsEmptyString', mutation: walkMutation({ find: "facts[factName] === null || facts[factName] === ''", replace: 'facts[factName] === null' }) });
// A6: the Object property pin, restated with tableTitleName
registerMutationTwin({ gateId: PROPERTIES_GATE_ID, conjunctId: 'emptyCellsAbsentNeverEmptyString', twinName: 'objectTableTitleNotCarried', mutation: walkMutation({ find: "['objectName', 'fieldCount', 'tableTitleName']", replace: "['objectName', 'fieldCount']" }) });
registerMutationTwin({ gateId: PROPERTIES_GATE_ID, conjunctId: 'derivedFactsEqualSpec', twinName: 'sharedBlockTopLevelOnly', mutation: walkMutation({ find: 'relativeSegmentList.includes(blockName)', replace: 'relativeSegmentList[0] === blockName' }) });

// =====================================================================
// A1c-STRUCTURE
// =====================================================================
const structureConjunctList = [
	{
		conjunctId: 'questionRefIdOnFieldsAndQuestionsAndObjectParentIsRoot',
		title: "questionRefId is carried by every Field and every Question and by no other node (restated in A3, which mints the Questions), and every Object's structural parent is the root, so the finalizer's depth is 1",
		twinNameList: ['questionRefIdStamped', 'fieldQuestionRefIdDropped', 'objectParentedOnAnotherObject'],
		evaluate: overForged((forged) => {
			// the carriers are exactly the Fields and the Questions: nothing else has it, and none of them lacks it
			const QUESTION_REF_ID_CARRIER_LABEL_LIST = ['Sif260928Field', 'Sif260928Question'];
			const questionRefIdNodeList = forged.nodes.filter((oneNode) => (oneNode.properties.questionRefId !== undefined) !== QUESTION_REF_ID_CARRIER_LABEL_LIST.includes(oneNode.labels[1]));
			const objectWrongList = nodeListByLabel(forged, 'Sif260928Object').filter((oneNode) => oneNode.properties.parentId !== 'sif260928:root' || oneNode.properties.depth !== 1);
			return {
				pass: questionRefIdNodeList.length === 0 && objectWrongList.length === 0,
				detail: `questionRefId misplaced or missing on ${questionRefIdNodeList.length}${questionRefIdNodeList.length ? ` (first ${questionRefIdNodeList[0].stableId})` : ''}; Objects wrong ${objectWrongList.length}${objectWrongList.length ? ` (first ${objectWrongList[0].stableId} parent ${objectWrongList[0].properties.parentId} depth ${objectWrongList[0].properties.depth})` : ''}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: STRUCTURE_GATE_ID,
	conjunctId: 'questionRefIdOnFieldsAndQuestionsAndObjectParentIsRoot',
	twinName: 'questionRefIdStamped',
	mutation: walkMutation({ find: 'carriedProperties: kit.carriedProperties({ parsedObject: { objectName, fieldCount }, carryList: OBJECT_CARRY_LIST }),', replace: "carriedProperties: { ...kit.carriedProperties({ parsedObject: { objectName, fieldCount }, carryList: OBJECT_CARRY_LIST }), questionRefId: 'twin' }," }),
});
// the other half of the A3 restatement: a Field that lost its questionRefId
registerMutationTwin({
	gateId: STRUCTURE_GATE_ID,
	conjunctId: 'questionRefIdOnFieldsAndQuestionsAndObjectParentIsRoot',
	twinName: 'fieldQuestionRefIdDropped',
	mutation: walkMutation({ find: 'questionRefId: questionRefIdByXpath.get(fieldFacts.xpath) }', replace: "questionRefId: fieldFacts.xpath === '/AccountingPeriods/AccountingPeriod/EndDate' ? undefined : questionRefIdByXpath.get(fieldFacts.xpath) }" }),
});
registerMutationTwin({
	gateId: STRUCTURE_GATE_ID,
	conjunctId: 'questionRefIdOnFieldsAndQuestionsAndObjectParentIsRoot',
	twinName: 'objectParentedOnAnotherObject',
	mutation: walkMutation({ find: 'structural: { parentId: kit.rootStableId, path: objectPath },', replace: "structural: { parentId: objectPath === '/AccountingPeriods/AccountingPeriod' ? kit.rootStableId : 'sif260928:object/AccountingPeriods/AccountingPeriod', path: objectPath }," }),
});

const gateDeclarationList = [
	{ gateId: COUNTS_GATE_ID, title: '(a) Objects = 159 and Fields = 15,620 as minted nodes', conjunctList: countsConjunctList },
	{ gateId: DESCRIPTION_GATE_ID, title: "(b) description is absent, never ''", conjunctList: descriptionConjunctList },
	{ gateId: PARENT_PATH_GATE_ID, title: '(c) parentPath is floored at the object; above the object is refused', conjunctList: parentPathConjunctList },
	{ gateId: ROLES_GATE_ID, title: "(d) every node's role equals the A1a table", conjunctList: rolesConjunctList },
	{ gateId: PROPERTIES_GATE_ID, title: "the Field properties: verbatim cells, empty cells absent, derived facts", conjunctList: propertiesConjunctList },
	{ gateId: STRUCTURE_GATE_ID, title: 'questionRefId on Fields and Questions only, Object parented on the root', conjunctList: structureConjunctList },
];

runGateFamily({ harness, familyName: 'sif260928 A1c walk', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 9, expectedTwinCount: 13 }, () => {
	harness.report();
});
