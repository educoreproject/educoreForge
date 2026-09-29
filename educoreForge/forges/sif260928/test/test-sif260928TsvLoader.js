#!/usr/bin/env node
'use strict';

// test-sif260928TsvLoader.js — the phase A1b gates for the sif260928 TSV loader
// (PLAN-sifReplacement-smallPhases-092826.md §3 A1b; SPEC §9 A3, A4, A21). ALL PURE: no Docker, no
// network. Every conjunct runs on the real bundle and the real snapshot, and every conjunct is
// observed RED under its own twin before the family counts as green. The framework's gate engine
// does the sweep (roundTripHarness/gateEvaluator via testSupport/gateSuiteRunner).
//
//   A1b-CENSUS          (a) the parsed rows reproduce the plan's census table AND C1's independent
//                           census; the layout (CRLF, blank lines, no trailing newline) is accepted;
//                           a snapshot with one row dropped is refused by the forge, by name
//   A1b-QUOTE           (b) the one-pair quote strip is exact on five named rows
//   A1b-CHARACTERISTICS (c) a non-empty Characteristics value outside the table is refused by name;
//                           an empty cell is absent (A4)
//   A1b-MANDATORY           the Mandatory column is carried verbatim and never folded into obligation
//   A1b-CEDSID              the CEDS ID column is carried verbatim and normalised to P + six digits
//   A1b-XPATH           (d) xpath is unique; a duplicated row is refused by name
//
// Twins build SCRATCH snapshots under the OS temp directory and remove them at the end. A scratch
// TSV gets a regenerated SHA256SUMS line, so the fault reaches the loader instead of being stopped
// by the checksum (A1a's gate). Loader mutations are compiled in memory (moduleDouble).
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928TsvLoader.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A1b gates: census, quote strip, Characteristics, Mandatory, CEDS ID, xpath

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
const HOOKS_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Hooks.js');
const LOADER_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928TsvLoader.js');
const CHARACTERISTICS_TABLE_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928CharacteristicsTable.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
// C1's independent witness; <codeRoot>/../dataStores resolves in system/code and in a worktree alike
const C1_CENSUS_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'sif260928', 'yardstick', 'CENSUS-636450dd7276.md');
const CHECKSUM_FILE_NAME = 'SHA256SUMS';

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_FILE_NAME = descriptorValueByName.sourceFile;
const REAL_SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot);

// ---- FROZEN LITERALS. Never edited to match a measurement.
// PLAN §3 A1b (a), the census table
const PLAN_CENSUS = Object.freeze({
	rowCount: 15620,
	metadataRowCount: 8976,
	extendedElementsRowCount: 492,
	cedsAnnotatedRowCount: 2231,
	distinctCedsElementIdCount: 354,
	emptyDescriptionRowCount: 4733,
	attributeRowCount: 3789,
	emptyCharacteristicsRowCount: 162,
	quoteWrappedDescriptionRowCount: 3627,
});
// SPEC §9 A21 and the A1b brief: the layout the loader must accept
const RULED_LAYOUT = Object.freeze({ lineCount: 16101, tableTitleLineCount: 159, columnHeaderLineCount: 159, blankLineCount: 163, crlfCount: 16100, bareLineFeedCount: 0, endsWithLineTerminator: false });
// C1's names for the same facts, as its census table prints them
const C1_FACT_NAME_BY_CENSUS_NAME = Object.freeze({
	rowCount: 'fieldRowCount',
	metadataRowCount: 'metadataRowCount',
	extendedElementsRowCount: 'extendedElementsRowCount',
	cedsAnnotatedRowCount: 'annotatedRowCount',
	distinctCedsElementIdCount: 'distinctCedsElementIdCount',
	emptyDescriptionRowCount: 'emptyDescriptionRowCount',
	attributeRowCount: 'attributeRowCount',
	emptyCharacteristicsRowCount: 'emptyCharacteristicsRowCount',
	quoteWrappedDescriptionRowCount: 'quotedDescriptionRowCount',
});
// SPEC §9 A3: five named rows, their description after ONE enclosing quote pair is stripped and the
// result trimmed, and the flag. Read by hand from the TSV cells.
const QUOTE_STRIP_ROW_LIST = Object.freeze([
	// doubly quoted: the cell ends """ and the inner "" pairs stay
	{ xpath: '/ContentCatalogs/ContentCatalog/Status', description: 'Describes availability status of resource, e.g. ""checked out.""', descriptionQuoted: true },
	// quoted, with padding inside the quotes
	{ xpath: '/StudentAcademicRecords/StudentAcademicRecord/@SIF_RefId', description: 'The GUID of an associated object, either StudentRecordExchange or StudentPersonal.', descriptionQuoted: true },
	// quoted, no padding
	{ xpath: '/StudentProgramAssociations/StudentProgramAssociation/ExitDate', description: 'The last school calendar day of this enrollment. If the student has exited the school or the enrollment has a RecordClosureReason, ExitDate must have a value.', descriptionQuoted: true },
	// not quoted
	{ xpath: '/PersonRoleAssociations/PersonRoleAssociation/ExitDate', description: 'Effective end date of the association.', descriptionQuoted: false },
	// not quoted, padded
	{ xpath: '/AccountingPeriods/AccountingPeriod/SIF_Metadata/TimeElements/TimeElement/Name', description: 'Contains a human-readable description of the value in', descriptionQuoted: false },
]);
// SPEC §3.1: the closed Characteristics table and what each code derives
const RULED_CHARACTERISTICS = Object.freeze({
	M: { obligation: 'mandatory', repeatable: false },
	MR: { obligation: 'mandatory', repeatable: true },
	O: { obligation: 'optional', repeatable: false },
	OR: { obligation: 'optional', repeatable: true },
	C: { obligation: 'conditional', repeatable: false },
});
// measured by A1b and recalled in the brief: rows whose Mandatory cell is '*', by Characteristics cell
const MANDATORY_ASSERTED_ROW_COUNT_BY_CHARACTERISTICS = Object.freeze({ M: 6072, MR: 1194, '': 119, C: 9 });

// the rows the fixtures fault: a mid-table row, so dropping or duplicating it keeps the layout legal
const FAULTED_ROW_XPATH = '/AccountingPeriods/AccountingPeriod/StartDate';

// ---- the TSV read independently of the loader: raw cells by xpath
const readRawCellListByXpath = () => {
	const cellListByXpath = new Map();
	fs.readFileSync(path.join(REAL_SNAPSHOT_DIR, SOURCE_FILE_NAME), 'utf8')
		.split('\r\n')
		.filter((lineText) => !lineText.startsWith('Name\tMandatory\tCharacteristics\t'))
		.map((lineText) => lineText.split('\t'))
		.filter((cellList) => cellList.length === 8)
		.forEach((cellList) => cellListByXpath.set(cellList[5], cellList));
	return cellListByXpath;
};
const RAW_CELL_LIST_BY_XPATH = readRawCellListByXpath();
const RAW_COLUMN_INDEX = Object.freeze({ mandatory: 1, characteristics: 2, description: 4, cedsId: 6 });

// ---- C1's witness, read from its census table: `factName` → measured column
const readC1MeasuredValueByFactName = () => {
	const measuredValueByFactName = {};
	fs.readFileSync(C1_CENSUS_PATH, 'utf8')
		.split('\n')
		.forEach((lineText) => {
			const factMatch = /^\|[^|]*\| `([A-Za-z]+)` \|[^|]*\| ([^|]+) \|/.exec(lineText);
			if (factMatch) {
				measuredValueByFactName[factMatch[1]] = factMatch[2].trim();
			}
			const layoutMatch = /^- lineCount \/ titles \/ headers \/ blank lines \/ data rows: (\d+) \/ (\d+) \/ (\d+) \/ (\d+) \/ (\d+)$/.exec(lineText);
			if (layoutMatch) {
				[measuredValueByFactName.lineCount, measuredValueByFactName.tableTitleLineCount, measuredValueByFactName.columnHeaderLineCount, measuredValueByFactName.blankLineCount] = layoutMatch.slice(1, 5);
			}
		});
	return measuredValueByFactName;
};

// ---- scratch fixtures, all removed at the end
const scratchRootPathList = [];
const sha256Of = (textOrBuffer) => crypto.createHash('sha256').update(textOrBuffer).digest('hex');

// a copy of the real snapshot with its TSV altered and SHA256SUMS rewritten to match
const makeScratchSnapshot = ({ alterSourceText }) => {
	const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sif260928Loader-'));
	scratchRootPathList.push(scratchRootPath);
	const snapshotDirPath = path.join(scratchRootPath, 'standardSourceData', path.basename(REAL_SNAPSHOT_DIR));
	fs.mkdirSync(snapshotDirPath, { recursive: true });
	fs.readdirSync(REAL_SNAPSHOT_DIR).forEach((oneFileName) => fs.copyFileSync(path.join(REAL_SNAPSHOT_DIR, oneFileName), path.join(snapshotDirPath, oneFileName)));
	const sourceFilePath = path.join(snapshotDirPath, SOURCE_FILE_NAME);
	const sourceText = fs.readFileSync(sourceFilePath, 'utf8');
	const alteredText = alterSourceText(sourceText);
	if (alteredText === sourceText) {
		throw new Error(`${moduleName}: fixture fault — the alteration changed nothing`);
	}
	fs.writeFileSync(sourceFilePath, alteredText);
	fs.writeFileSync(path.join(snapshotDirPath, CHECKSUM_FILE_NAME), `${sha256Of(fs.readFileSync(sourceFilePath))}  ${SOURCE_FILE_NAME}\n`);
	return snapshotDirPath;
};

// the one CRLF-terminated line holding the faulted row
const faultedLineText = (sourceText) => {
	const lineText = sourceText.split('\r\n').find((oneLine) => oneLine.split('\t')[5] === FAULTED_ROW_XPATH);
	if (lineText === undefined) {
		throw new Error(`${moduleName}: fixture fault — no row with xpath ${FAULTED_ROW_XPATH}`);
	}
	return lineText;
};
const withFaultedRowDropped = (sourceText) => sourceText.replace(`${faultedLineText(sourceText)}\r\n`, '');
const withFaultedRowDuplicated = (sourceText) => sourceText.replace(`${faultedLineText(sourceText)}\r\n`, `${faultedLineText(sourceText)}\r\n${faultedLineText(sourceText)}\r\n`);
const withFaultedRowCharacteristicsX = (sourceText) => {
	const cellList = faultedLineText(sourceText).split('\t');
	cellList[2] = 'X';
	return sourceText.replace(faultedLineText(sourceText), cellList.join('\t'));
};
const withFirstLineEndingBareLf = (sourceText) => sourceText.replace('\r\n', '\n');

// ---- the subject every conjunct reads and every twin mutates (on a clone)
const makeSubject = () => ({ snapshotDirPath: REAL_SNAPSHOT_DIR, bundleMutationList: [] });
const cloneSubject = (subject) => ({ ...subject, bundleMutationList: subject.bundleMutationList.slice() });

const loadModule = ({ subject, modulePath }) => (subject.bundleMutationList.length ? moduleDouble.loadWithMutations({ modulePath, mutationList: subject.bundleMutationList }) : require(modulePath));

// the bundle's own loader, reached through its hook set exactly as the framework reaches it
const loadSnapshotRows = ({ subject }, callback) => {
	const hookSet = loadModule({ subject, modulePath: HOOKS_MODULE_PATH })();
	hookSet.sourceLoaderList[0].load({ sourcePath: path.join(subject.snapshotDirPath, SOURCE_FILE_NAME) }, callback);
};

// the whole forge in pure mode, as the forger runs it
const forgeSnapshot = ({ subject, snapshotDirPath }, callback) => {
	loadModule({ subject, modulePath: ENTRY_MODULE_PATH })({ embedder: null }).forge({ sourcePath: path.join(snapshotDirPath, SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
};

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
const registerSnapshotTwin = ({ gateId, conjunctId, twinName, alterSourceText }) => {
	twinRegistry.register({ gateId, conjunctId, twinName, leverKind: 'inputFault', shippedConfig: true, run: (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ alterSourceText }) }) });
};

const twinRegistry = makeTwinRegistry();
const CENSUS_GATE_ID = 'A1b-CENSUS';
const QUOTE_GATE_ID = 'A1b-QUOTE';
const CHARACTERISTICS_GATE_ID = 'A1b-CHARACTERISTICS';
const MANDATORY_GATE_ID = 'A1b-MANDATORY';
const CEDS_ID_GATE_ID = 'A1b-CEDSID';
const XPATH_GATE_ID = 'A1b-XPATH';

// a conjunct over the loaded rows: a loader refusal is a FAIL, with the refusal as the detail
const overLoadedRows = (judgeLoaded) => (subject, callback) => {
	loadSnapshotRows({ subject }, (loadError, loaded) => {
		if (loadError) {
			callback('', { pass: false, detail: `loader refused: ${String(loadError).slice(0, 300)}` });
			return;
		}
		callback('', judgeLoaded(loaded, subject));
	});
};

// a conjunct that a faulted scratch snapshot is refused by the whole forge, naming the fault
const refusedByForge = ({ alterSourceText, refusalRe }) => (subject, callback) => {
	forgeSnapshot({ subject, snapshotDirPath: makeScratchSnapshot({ alterSourceText }) }, (forgeError, forged) => {
		const pass = typeof forgeError === 'string' && refusalRe.test(forgeError);
		callback('', { pass, detail: forgeError ? forgeError.slice(0, 300) : `NOT refused: forged ${forged.nodes.length} nodes` });
	});
};

// =====================================================================
// (a) A1b-CENSUS
// =====================================================================
const censusConjunctList = [
	{
		conjunctId: 'censusEqualsPlanAndC1',
		title: "the loaded rows' census equals the plan's nine literals AND C1's independently measured values",
		twinNameList: ['oneRowDropped'],
		evaluate: overLoadedRows((loaded) => {
			const c1MeasuredValueByFactName = readC1MeasuredValueByFactName();
			const disagreementList = Object.keys(PLAN_CENSUS)
				.filter((censusName) => loaded.sourceCensus[censusName] !== PLAN_CENSUS[censusName] || c1MeasuredValueByFactName[C1_FACT_NAME_BY_CENSUS_NAME[censusName]] !== String(loaded.sourceCensus[censusName]))
				.map((censusName) => `${censusName} loaded ${loaded.sourceCensus[censusName]}, plan ${PLAN_CENSUS[censusName]}, C1 ${c1MeasuredValueByFactName[C1_FACT_NAME_BY_CENSUS_NAME[censusName]]}`);
			return { pass: disagreementList.length === 0, detail: disagreementList.length ? disagreementList.join('; ') : JSON.stringify(loaded.sourceCensus) };
		}),
	},
	{
		conjunctId: 'layoutAccepted',
		title: 'the TSV is CRLF with 163 blank lines and no trailing newline (16,101 lines, 159 titles, 159 headers), the loader accepts it, and C1 measured the same layout',
		twinNameList: ['oneLineEndingMadeBareLf'],
		evaluate: overLoadedRows((loaded, subject) => {
			const sourceText = fs.readFileSync(path.join(subject.snapshotDirPath, SOURCE_FILE_NAME), 'utf8');
			const c1MeasuredValueByFactName = readC1MeasuredValueByFactName();
			const measuredLayout = {
				lineCount: loaded.sourceCensus.lineCount,
				tableTitleLineCount: loaded.sourceCensus.tableTitleLineCount,
				columnHeaderLineCount: loaded.sourceCensus.columnHeaderLineCount,
				blankLineCount: loaded.sourceCensus.blankLineCount,
				crlfCount: sourceText.split('\r\n').length - 1,
				bareLineFeedCount: sourceText.replace(/\r\n/g, '').split('\n').length - 1,
				endsWithLineTerminator: /[\r\n]$/.test(sourceText),
			};
			const disagreementList = Object.keys(RULED_LAYOUT).filter((layoutName) => measuredLayout[layoutName] !== RULED_LAYOUT[layoutName]);
			const c1DisagreementList = ['lineCount', 'tableTitleLineCount', 'columnHeaderLineCount', 'blankLineCount'].filter((layoutName) => c1MeasuredValueByFactName[layoutName] !== String(measuredLayout[layoutName]));
			return { pass: disagreementList.length === 0 && c1DisagreementList.length === 0, detail: `layout ${JSON.stringify(measuredLayout)}; differs from ruled: [${disagreementList}]; from C1: [${c1DisagreementList}]` };
		}),
	},
	{
		conjunctId: 'droppedRowRefusedByForge',
		title: 'a scratch snapshot with one row dropped (checksum regenerated) is REFUSED BY NAME by the forge: sourceCensus rowCount measured 15619, declared 15620',
		twinNameList: ['censusCheckDisabled'],
		evaluate: refusedByForge({ alterSourceText: withFaultedRowDropped, refusalRe: /sif260928TsvLoader REFUSED: sourceCensus of snapshot '01' disagrees: .*rowCount measured 15619, declared 15620/ }),
	},
];
registerSnapshotTwin({ gateId: CENSUS_GATE_ID, conjunctId: 'censusEqualsPlanAndC1', twinName: 'oneRowDropped', alterSourceText: withFaultedRowDropped });
registerSnapshotTwin({ gateId: CENSUS_GATE_ID, conjunctId: 'layoutAccepted', twinName: 'oneLineEndingMadeBareLf', alterSourceText: withFirstLineEndingBareLf });
registerMutationTwin({
	gateId: CENSUS_GATE_ID,
	conjunctId: 'droppedRowRefusedByForge',
	twinName: 'censusCheckDisabled',
	mutation: { modulePath: LOADER_MODULE_PATH, find: 'const censusCheck = compareCensus({ measuredCensus: sourceCensus, snapshotName });', replace: 'const censusCheck = {};' },
});

// =====================================================================
// (b) A1b-QUOTE
// =====================================================================
const quoteConjunctList = [
	{
		conjunctId: 'fiveNamedRowsStripExactly',
		title: 'on five named rows the description is the cell with ONE enclosing quote pair stripped and then trimmed, descriptionQuoted says whether a pair was stripped, and descriptionCellText is the cell verbatim',
		twinNameList: ['bothQuotePairsStripped'],
		evaluate: overLoadedRows((loaded) => {
			const rowByXpath = new Map(loaded.rowList.map((oneRow) => [oneRow.xpath, oneRow]));
			const disagreementList = QUOTE_STRIP_ROW_LIST.filter((expectedRow) => {
				const loadedRow = rowByXpath.get(expectedRow.xpath);
				return (
					loadedRow === undefined ||
					loadedRow.description !== expectedRow.description ||
					loadedRow.descriptionQuoted !== expectedRow.descriptionQuoted ||
					loadedRow.descriptionCellText !== RAW_CELL_LIST_BY_XPATH.get(expectedRow.xpath)[RAW_COLUMN_INDEX.description]
				);
			}).map((expectedRow) => {
				const loadedRow = rowByXpath.get(expectedRow.xpath);
				return `${expectedRow.xpath}: ${loadedRow ? `${JSON.stringify(loadedRow.description)} quoted ${loadedRow.descriptionQuoted}` : 'absent'}`;
			});
			return { pass: disagreementList.length === 0, detail: disagreementList.length ? disagreementList.join('; ') : `${QUOTE_STRIP_ROW_LIST.length} rows exact` };
		}),
	},
];
registerMutationTwin({
	gateId: QUOTE_GATE_ID,
	conjunctId: 'fiveNamedRowsStripExactly',
	twinName: 'bothQuotePairsStripped',
	mutation: { modulePath: LOADER_MODULE_PATH, find: 'unwrappedText: isQuoteWrapped ? cellText.slice(1, -1) : cellText', replace: 'unwrappedText: isQuoteWrapped ? cellText.replace(/^"+|"+$/g, \'\') : cellText' },
});

// =====================================================================
// (c) A1b-CHARACTERISTICS
// =====================================================================
const characteristicsConjunctList = [
	{
		conjunctId: 'valueOutsideTableRefusedByName',
		title: "a scratch snapshot whose row has Characteristics 'X' is REFUSED BY NAME by the forge, naming the value, the row and the closed table",
		twinNameList: ['closedTableAcceptsX'],
		evaluate: refusedByForge({ alterSourceText: withFaultedRowCharacteristicsX, refusalRe: new RegExp(`sif260928TsvLoader REFUSED: line \\d+ \\(${FAULTED_ROW_XPATH}\\) has Characteristics 'X', which is not in the closed table`) }),
	},
	{
		conjunctId: 'emptyMeansAbsent',
		title: 'the 162 empty Characteristics cells derive nothing (characteristics, obligation, repeatable, obligationSourceColumnName all null), and every other row derives exactly the ruled table from the Characteristics column',
		twinNameList: ['emptyGivenAnObligation'],
		evaluate: overLoadedRows((loaded) => {
			const emptyRowList = loaded.rowList.filter((oneRow) => oneRow.characteristicsCellText === '');
			const emptyWrongList = emptyRowList.filter((oneRow) => oneRow.characteristics !== null || oneRow.obligation !== null || oneRow.repeatable !== null || oneRow.obligationSourceColumnName !== null);
			const derivedWrongList = loaded.rowList
				.filter((oneRow) => oneRow.characteristicsCellText !== '')
				.filter((oneRow) => {
					const ruled = RULED_CHARACTERISTICS[oneRow.characteristicsCellText];
					return ruled === undefined || oneRow.characteristics !== oneRow.characteristicsCellText || oneRow.obligation !== ruled.obligation || oneRow.repeatable !== ruled.repeatable || oneRow.obligationSourceColumnName !== 'Characteristics';
				});
			return {
				pass: emptyRowList.length === 162 && emptyWrongList.length === 0 && derivedWrongList.length === 0,
				detail: `empty cells ${emptyRowList.length}, of which deriving something ${emptyWrongList.length}; non-empty rows off the ruled table ${derivedWrongList.length}${derivedWrongList.length ? ` (first ${derivedWrongList[0].xpath})` : ''}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: CHARACTERISTICS_GATE_ID,
	conjunctId: 'valueOutsideTableRefusedByName',
	twinName: 'closedTableAcceptsX',
	mutation: { modulePath: CHARACTERISTICS_TABLE_MODULE_PATH, find: '	C: Object.freeze({ obligation: OBLIGATION.CONDITIONAL, repeatable: false }),\n', replace: '	C: Object.freeze({ obligation: OBLIGATION.CONDITIONAL, repeatable: false }),\n	X: Object.freeze({ obligation: OBLIGATION.OPTIONAL, repeatable: false }),\n' },
});
registerMutationTwin({
	gateId: CHARACTERISTICS_GATE_ID,
	conjunctId: 'emptyMeansAbsent',
	twinName: 'emptyGivenAnObligation',
	// the census still passes under this twin (characteristics stays null), so only this conjunct sees it
	mutation: { modulePath: LOADER_MODULE_PATH, find: 'obligation: characteristicsEntry === null ? null : characteristicsEntry.obligation,', replace: "obligation: characteristicsEntry === null ? 'optional' : characteristicsEntry.obligation," },
});

// =====================================================================
// A1b-MANDATORY
// =====================================================================
const mandatoryConjunctList = [
	{
		conjunctId: 'mandatoryCarriedIndependently',
		title: "every row's mandatoryCellText is its Mandatory cell verbatim; the '*' rows split by Characteristics as frozen (119 with an empty cell, 9 with C); and no '*' row with an empty Characteristics cell has an obligation",
		twinNameList: ['mandatoryFoldedIntoObligation'],
		evaluate: overLoadedRows((loaded) => {
			const verbatimWrongList = loaded.rowList.filter((oneRow) => oneRow.mandatoryCellText !== RAW_CELL_LIST_BY_XPATH.get(oneRow.xpath)[RAW_COLUMN_INDEX.mandatory]);
			const assertedRowCountByCharacteristics = {};
			loaded.rowList
				.filter((oneRow) => oneRow.mandatoryCellText === '*')
				.forEach((oneRow) => {
					assertedRowCountByCharacteristics[oneRow.characteristicsCellText] = (assertedRowCountByCharacteristics[oneRow.characteristicsCellText] || 0) + 1;
				});
			const assertedWithoutCharacteristicsGivenObligationList = loaded.rowList.filter((oneRow) => oneRow.mandatoryCellText === '*' && oneRow.characteristicsCellText === '' && oneRow.obligation !== null);
			const crossTabAgrees = JSON.stringify(Object.entries(assertedRowCountByCharacteristics).sort()) === JSON.stringify(Object.entries(MANDATORY_ASSERTED_ROW_COUNT_BY_CHARACTERISTICS).sort());
			return {
				pass: verbatimWrongList.length === 0 && crossTabAgrees && assertedWithoutCharacteristicsGivenObligationList.length === 0,
				detail: `not verbatim ${verbatimWrongList.length}; '*' rows by Characteristics ${JSON.stringify(assertedRowCountByCharacteristics)}; '*' + empty Characteristics given an obligation ${assertedWithoutCharacteristicsGivenObligationList.length}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: MANDATORY_GATE_ID,
	conjunctId: 'mandatoryCarriedIndependently',
	twinName: 'mandatoryFoldedIntoObligation',
	mutation: { modulePath: LOADER_MODULE_PATH, find: 'obligation: characteristicsEntry === null ? null : characteristicsEntry.obligation,', replace: "obligation: mandatoryCellText === '*' ? 'mandatory' : characteristicsEntry === null ? null : characteristicsEntry.obligation," },
});

// =====================================================================
// A1b-CEDSID
// =====================================================================
const cedsIdConjunctList = [
	{
		conjunctId: 'cedsIdCarriedVerbatimAndNormalised',
		title: "every row's cedsIdCellText is its CEDS ID cell verbatim, cedsElementId is 'P' plus those six digits on the 2,231 annotated rows, and null on every other row",
		twinNameList: ['prefixDropped'],
		evaluate: overLoadedRows((loaded) => {
			const wrongList = loaded.rowList.filter((oneRow) => {
				const rawCellText = RAW_CELL_LIST_BY_XPATH.get(oneRow.xpath)[RAW_COLUMN_INDEX.cedsId];
				return oneRow.cedsIdCellText !== rawCellText || oneRow.cedsElementId !== (rawCellText === '' ? null : `P${rawCellText}`);
			});
			const annotatedRowCount = loaded.rowList.filter((oneRow) => /^P\d{6}$/.test(oneRow.cedsElementId)).length;
			return { pass: wrongList.length === 0 && annotatedRowCount === 2231, detail: `rows wrong ${wrongList.length}${wrongList.length ? ` (first ${wrongList[0].xpath}: ${wrongList[0].cedsElementId})` : ''}; P-prefixed rows ${annotatedRowCount}` };
		}),
	},
];
registerMutationTwin({
	gateId: CEDS_ID_GATE_ID,
	conjunctId: 'cedsIdCarriedVerbatimAndNormalised',
	twinName: 'prefixDropped',
	mutation: { modulePath: LOADER_MODULE_PATH, find: "const CEDS_ELEMENT_ID_PREFIX = 'P';", replace: "const CEDS_ELEMENT_ID_PREFIX = '';" },
});

// =====================================================================
// (d) A1b-XPATH
// =====================================================================
const xpathConjunctList = [
	{
		conjunctId: 'xpathUniqueOverRealRows',
		title: 'the loaded rows carry 15,620 distinct xpaths over 15,620 rows (C1: distinctXpathCount 15620)',
		twinNameList: ['oneRowDuplicated'],
		evaluate: overLoadedRows((loaded) => {
			const distinctXpathCount = new Set(loaded.rowList.map((oneRow) => oneRow.xpath)).size;
			const c1DistinctXpathCount = readC1MeasuredValueByFactName().distinctXpathCount;
			return { pass: distinctXpathCount === 15620 && loaded.rowList.length === 15620 && c1DistinctXpathCount === '15620', detail: `distinct ${distinctXpathCount} of ${loaded.rowList.length}; C1 ${c1DistinctXpathCount}` };
		}),
	},
	{
		conjunctId: 'duplicateRowRefusedByName',
		title: 'a scratch snapshot with one row duplicated is REFUSED BY NAME by the forge, naming the xpath and both lines',
		twinNameList: ['xpathCheckDisabled'],
		evaluate: refusedByForge({ alterSourceText: withFaultedRowDuplicated, refusalRe: new RegExp(`sif260928TsvLoader REFUSED: xpath '${FAULTED_ROW_XPATH}' appears on line (\\d+) and again on line \\d+`) }),
	},
];
registerSnapshotTwin({ gateId: XPATH_GATE_ID, conjunctId: 'xpathUniqueOverRealRows', twinName: 'oneRowDuplicated', alterSourceText: withFaultedRowDuplicated });
registerMutationTwin({
	gateId: XPATH_GATE_ID,
	conjunctId: 'duplicateRowRefusedByName',
	twinName: 'xpathCheckDisabled',
	mutation: { modulePath: LOADER_MODULE_PATH, find: 'const duplicateCheck = findDuplicateXpath({ rowList });', replace: 'const duplicateCheck = {};' },
});

const gateDeclarationList = [
	{ gateId: CENSUS_GATE_ID, title: "(a) the census equals the plan's table and C1's; the layout is accepted; a dropped row is refused", conjunctList: censusConjunctList },
	{ gateId: QUOTE_GATE_ID, title: '(b) the one-pair quote strip is exact on five named rows', conjunctList: quoteConjunctList },
	{ gateId: CHARACTERISTICS_GATE_ID, title: '(c) Characteristics: outside the table is refused; empty is absent', conjunctList: characteristicsConjunctList },
	{ gateId: MANDATORY_GATE_ID, title: 'the Mandatory column is carried on its own', conjunctList: mandatoryConjunctList },
	{ gateId: CEDS_ID_GATE_ID, title: 'the CEDS ID column is carried verbatim and normalised', conjunctList: cedsIdConjunctList },
	{ gateId: XPATH_GATE_ID, title: '(d) xpath is unique; a duplicate is refused', conjunctList: xpathConjunctList },
];

runGateFamily(
	{ harness, familyName: 'sif260928 A1b TSV loader', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 10, expectedTwinCount: 10 },
	() => {
		scratchRootPathList.forEach((oneScratchRootPath) => fs.rmSync(oneScratchRootPath, { recursive: true, force: true }));
		harness.report();
	},
);
