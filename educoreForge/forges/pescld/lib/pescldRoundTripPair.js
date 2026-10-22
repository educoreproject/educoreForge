'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescldRoundTripPair.js — H4 for the PESC_LD forge bundle (zeroBacklog lane C1; Profile §8.5; ruling Q-Z8: the CSV snapshot is
// the source, canonicalised here; the publisher's TTL is a SECOND oracle, diffed by lib/pescldTtlOracle.js). A SOURCE-side
// canonicalizer and a GRAPH-side emitter held apart on purpose: the canonicalizer reads only the snapshot's CSVs, the emitter only
// the materialized graph. They share the strict CSV tokenizer and the source profile's FILE and COLUMN NAMES, nothing of the walk.
// Every value is part of its statement KEY, so the harness's key-only diff is also a value diff:
//   shape|<shapeID>|declared|true                       a shapes.csv record (graph: the root's HAS_CLASS edge)
//   shape|<shapeID>|<column>|<cellText>                 every non-empty shapes.csv cell (graph: the shape node's properties)
//   shape|<shapeID>|termIri|<iri>                       target expanded by namespaces.csv (an independent expansion here)
//   row|<shapeID>|<propertyID>|shapeID|<shapeID>        a TAP record's shape (graph: the HAS_PROPERTY edge)
//   row|<shapeID>|<propertyID>|<column>|<cellText>      every non-empty single-value TAP cell (graph: the row node)
//   row|<shapeID>|<propertyID>|valueClass|<line>        each valueClass line (graph: crossRefs, locator valueClass)
//   row|<shapeID>|<propertyID>|valueShape|<shapeID>     (graph: the REFERENCES edge, locator valueShape)
//   row|<shapeID>|<propertyID>|valueConstraint|<declared empty>   a constraint type with an empty constraint cell
//   row|<shapeID>|<propertyID>|sourceTab|<file>         each TAP file the record appears in (graph: sourceTabs)
//   row|<shapeID>|<propertyID>|termIri|<iri>            propertyID expanded by namespaces.csv
//   resolved|<shapeID>|<propertyID>|<column>|<text>     a column whose records disagree, resolved by the profile's rule
//   picklistValue|<shapeID>|<propertyID>|<value>        each distinct picklist value (graph: HAS_OPTION_SET then HAS_VALUE)
//   picklistRepeat|<shapeID>|<propertyID>|<value>|<n>   a value listed n > 1 times in its cell (graph: listRepeatCount)
//   picklistValueIri|<shapeID>|<propertyID>|<value>|<iri>   a CURIE value expanded by namespaces.csv
// Explicitly omitted, each statement naming its kind (the omission declaration below): the spreadsheet row number column '0'; the
// raw text of a whitespace-trimmed cell; the namespaces.csv table itself (applied as every termIri, not carried as a table); the
// about.csv package metadata (its url is the root's sourceUrl, a provenance field the framework checks).

const fs = require('fs');
const path = require('path');
const { parseCsvText } = require('./pescldCsvReader');
const sourceProfile = require('./pescldSourceProfile.json');

const LINE_SEPARATOR = '\n';
const DECLARED_EMPTY_TEXT = '<declared empty>';
const CURIE_RE = /^([A-Za-z][A-Za-z0-9]*):(.+)$/;
const SHAPE_STABLE_ID_RE = /^pescld:shape\/([^/]+)$/;
const ROW_STABLE_ID_RE = /^pescld:shape\/([^/]+)\/([^/]+)$/;
const PICKLIST_STABLE_ID_RE = /^pescld:picklist\/([^/]+)\/([^/]+)$/;
const PICKLIST_VALUE_STABLE_ID_RE = /^pescld:picklist\/([^/]+)\/([^/]+)\/([^/]+)$/;
const ROOT_ROLE = 'DmeStandardRoot';
// Layers the source states nothing about, excluded BY ROLE so the exclusion is a stated decision: the framework's embed-text
// nodes, and a hub's cards when this standard ever sits in a graph beside one. Any OTHER unknown role or edge faults by name.
const NOT_SOURCE_ROLE_LIST = Object.freeze(['DmeEmbedText', 'HubReference', 'HubDefinition']);

// the graph reading: which node property states which source column (this instrument's own table, not the walk's)
const SHAPE_PROPERTY_READING_LIST = Object.freeze([
	{ propertyName: 'name', columnName: 'label', valueKind: 'text' },
	{ propertyName: 'termCurie', columnName: 'target', valueKind: 'text' },
	{ propertyName: 'targetType', columnName: 'targetType', valueKind: 'text' },
	{ propertyName: 'shapeComment', columnName: 'comment', valueKind: 'text' },
	{ propertyName: 'shapeClosed', columnName: 'Closed', valueKind: 'boolean' },
	{ propertyName: 'shapeMandatory', columnName: 'mandatory', valueKind: 'boolean' },
	{ propertyName: 'shapeSeverity', columnName: 'severity', valueKind: 'text' },
	{ propertyName: 'shapeNote', columnName: 'Note', valueKind: 'text' },
	{ propertyName: 'termIri', columnName: 'termIri', valueKind: 'text' },
]);
const ROW_PROPERTY_READING_LIST = Object.freeze([
	{ propertyName: 'name', columnName: 'propertyLabel', valueKind: 'text' },
	{ propertyName: 'termCurie', columnName: 'propertyID', valueKind: 'text' },
	{ propertyName: 'termIri', columnName: 'termIri', valueKind: 'text' },
	{ propertyName: 'mandatory', columnName: 'mandatory', valueKind: 'boolean' },
	{ propertyName: 'repeatable', columnName: 'repeatable', valueKind: 'boolean' },
	{ propertyName: 'valueNodeType', columnName: 'valueNodeType', valueKind: 'text' },
	{ propertyName: 'valueDataType', columnName: 'valueDataType', valueKind: 'text' },
	{ propertyName: 'valueConstraintType', columnName: 'valueConstraintType', valueKind: 'text' },
	{ propertyName: 'valueConstraint', columnName: 'valueConstraint', valueKind: 'text' },
	{ propertyName: 'severity', columnName: 'Severity', valueKind: 'text' },
	{ propertyName: 'recUsage', columnName: 'Rec Usage', valueKind: 'text' },
	{ propertyName: 'usageNote', columnName: 'note', valueKind: 'text' },
]);
const BOOLEAN_TEXT_BY_VALUE = Object.freeze({ true: 'TRUE', false: 'FALSE' });

// the source columns a TAP statement is NOT made from directly (their statements have their own forms above)
const TAP_COLUMN_WITH_OWN_FORM_LIST = Object.freeze(['0', 'shapeID', 'propertyID', 'valueClass', 'valueShape', 'valueConstraint']);

const OMITTED_KIND = Object.freeze({
	SPREADSHEET_ROW_NUMBER: 'spreadsheetRowNumber',
	WHITESPACE_TRIMMED: 'whitespaceTrimmed',
	NAMESPACE_TABLE: 'namespaceTable',
	PACKAGE_METADATA: 'packageMetadata',
});
const OMITTED_KIND_PROPERTY_NAME = 'omittedKind';
const OMITTED_TEXT_PROPERTY_NAME = 'text';
const omitted = (kind, extra) => ({ explicitlyOmitted: true, [OMITTED_KIND_PROPERTY_NAME]: kind, ...(extra || {}) });

const moduleFunction =
	({ moduleName } = {}) =>
	({ ruleModulePath }) => {
		// -----------------------------------------------------------------
		// canonicalizeSource — the snapshot's CSVs → statements (never the graph)
		// -----------------------------------------------------------------
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const readFile = (sourceFileName) => parseCsvText({ csvText: fs.readFileSync(path.join(snapshotPath, sourceFileName), 'utf8'), sourceFileName });
			const fileNameList = [sourceProfile.shapeFileName, sourceProfile.namespaceFileName, sourceProfile.packageMetadataFileName].concat(sourceProfile.tapFileNameList);
			const readByFileName = fileNameList.reduce((byName, fileName) => ({ ...byName, [fileName]: readFile(fileName) }), {});
			const refusedFileName = fileNameList.find((fileName) => readByFileName[fileName].refusalText !== undefined);
			if (refusedFileName !== undefined) {
				callback(readByFileName[refusedFileName].refusalText);
				return;
			}
			const statements = new Map();
			const recordObjectListOf = (fileName) => readByFileName[fileName].recordList.map((oneRecord) => ({
				cellByColumnName: readByFileName[fileName].headerList.reduce((byName, columnName, columnIndex) => ({ ...byName, [columnName]: oneRecord.cellList[columnIndex] }), {}),
				fileName,
				lineNumber: oneRecord.lineNumber,
			}));
			// trimmed — a cell's text with surrounding whitespace removed; the raw text is an omitted statement of its own
			const trimmed = ({ rawText, fileName, lineNumber, columnName }) => {
				const trimmedText = rawText.trim();
				if (trimmedText !== rawText) {
					statements.set(`whitespace|${fileName}|${lineNumber}|${columnName}|${rawText}`, omitted(OMITTED_KIND.WHITESPACE_TRIMMED, { [OMITTED_TEXT_PROPERTY_NAME]: rawText }));
				}
				return trimmedText;
			};

			// namespaces.csv: applied below, its rows omitted as a table
			const namespaceIriByPrefix = {};
			readByFileName[sourceProfile.namespaceFileName].recordList.forEach((oneRecord) => {
				namespaceIriByPrefix[oneRecord.cellList[0]] = oneRecord.cellList[1];
				statements.set(`namespace|${oneRecord.cellList.join('|')}`, omitted(OMITTED_KIND.NAMESPACE_TABLE));
			});
			const iriOf = (curieText) => {
				const curieMatch = curieText.match(CURIE_RE);
				return curieMatch === null || namespaceIriByPrefix[curieMatch[1]] === undefined ? undefined : `${namespaceIriByPrefix[curieMatch[1]]}${curieMatch[2]}`;
			};
			// about.csv: no header line, every record is metadata
			const metadataRead = readByFileName[sourceProfile.packageMetadataFileName];
			[metadataRead.headerList].concat(metadataRead.recordList.map((oneRecord) => oneRecord.cellList))
				.forEach((cellList) => statements.set(`package|${cellList.join('|')}`, omitted(OMITTED_KIND.PACKAGE_METADATA)));

			// shapes.csv
			recordObjectListOf(sourceProfile.shapeFileName).forEach(({ cellByColumnName, fileName, lineNumber }) => {
				const shapeID = cellByColumnName.shapeID;
				statements.set(`shape|${shapeID}|declared|true`, {});
				Object.keys(cellByColumnName).filter((columnName) => columnName !== 'shapeID').forEach((columnName) => {
					const cellText = trimmed({ rawText: cellByColumnName[columnName], fileName, lineNumber, columnName });
					if (cellText !== '') {
						statements.set(`shape|${shapeID}|${columnName}|${cellText}`, {});
					}
					if (columnName === 'target' && cellText !== '' && iriOf(cellText) !== undefined) {
						statements.set(`shape|${shapeID}|termIri|${iriOf(cellText)}`, {});
					}
				});
			});

			// the TAP files: statements per record; a pair's records that disagree in a column are resolved by the profile's rule
			const cellTextListByPairColumn = {};
			sourceProfile.tapFileNameList.forEach((tapFileName) => recordObjectListOf(tapFileName).forEach(({ cellByColumnName, fileName, lineNumber }) => {
				const shapeID = cellByColumnName.shapeID;
				const propertyID = trimmed({ rawText: cellByColumnName.propertyID, fileName, lineNumber, columnName: 'propertyID' });
				const rowPrefix = `row|${shapeID}|${propertyID}`;
				statements.set(`${rowPrefix}|shapeID|${shapeID}`, {});
				statements.set(`${rowPrefix}|sourceTab|${fileName}`, {});
				statements.set(`${rowPrefix}|propertyID|${propertyID}`, {});
				if (iriOf(propertyID) !== undefined) {
					statements.set(`${rowPrefix}|termIri|${iriOf(propertyID)}`, {});
				}
				if (cellByColumnName['0'] !== '') {
					statements.set(`rowNumber|${fileName}|${lineNumber}|${cellByColumnName['0']}`, omitted(OMITTED_KIND.SPREADSHEET_ROW_NUMBER));
				}
				Object.keys(cellByColumnName).filter((columnName) => TAP_COLUMN_WITH_OWN_FORM_LIST.indexOf(columnName) === -1).forEach((columnName) => {
					const cellText = trimmed({ rawText: cellByColumnName[columnName], fileName, lineNumber, columnName });
					const pairColumnId = `${shapeID}|${propertyID}|${columnName}`;
					cellTextListByPairColumn[pairColumnId] = (cellTextListByPairColumn[pairColumnId] || []).concat([cellText]);
					if (cellText !== '') {
						statements.set(`${rowPrefix}|${columnName}|${cellText}`, {});
					}
				});
				const valueShapeText = trimmed({ rawText: cellByColumnName.valueShape, fileName, lineNumber, columnName: 'valueShape' });
				if (valueShapeText !== '') {
					statements.set(`${rowPrefix}|valueShape|${valueShapeText}`, {});
				}
				const lineListOf = (columnName) => (cellByColumnName[columnName] === '' ? [] : cellByColumnName[columnName].split(LINE_SEPARATOR).map((rawLine) => trimmed({ rawText: rawLine, fileName, lineNumber, columnName })));
				lineListOf('valueClass').forEach((oneLine) => statements.set(`${rowPrefix}|valueClass|${oneLine}`, {}));
				const constraintType = cellByColumnName.valueConstraintType.trim();
				if (constraintType !== '' && cellByColumnName.valueConstraint === '') {
					statements.set(`${rowPrefix}|valueConstraint|${DECLARED_EMPTY_TEXT}`, {});
				} else if (constraintType === 'picklist') {
					const valueLineList = lineListOf('valueConstraint');
					valueLineList.forEach((valueText) => {
						statements.set(`picklistValue|${shapeID}|${propertyID}|${valueText}`, {});
						const repeatCount = valueLineList.filter((oneLine) => oneLine === valueText).length;
						if (repeatCount > 1) {
							statements.set(`picklistRepeat|${shapeID}|${propertyID}|${valueText}|${repeatCount}`, {});
						}
						if (iriOf(valueText) !== undefined) {
							statements.set(`picklistValueIri|${shapeID}|${propertyID}|${valueText}|${iriOf(valueText)}`, {});
						}
					});
				} else if (cellByColumnName.valueConstraint !== '') {
					statements.set(`${rowPrefix}|valueConstraint|${trimmed({ rawText: cellByColumnName.valueConstraint, fileName, lineNumber, columnName: 'valueConstraint' })}`, {});
				}
			}));
			// a disagreement among a pair's stating records: both texts are statements above; the profile's resolution is one more
			sourceProfile.conflictResolutionList.forEach((oneResolution) => {
				const cellTextList = cellTextListByPairColumn[`${oneResolution.shapeID}|${oneResolution.propertyID}|${oneResolution.columnName}`] || [];
				if (cellTextList.filter((oneText, textIndex) => cellTextList.indexOf(oneText) === textIndex).length > 1) {
					statements.set(`resolved|${oneResolution.shapeID}|${oneResolution.propertyID}|${oneResolution.columnName}|${oneResolution.resolvedCellText}`, {});
				}
			});
			callback('', { statements, stats: { statementCount: statements.size } });
		};

		// -----------------------------------------------------------------
		// emitFromGraph — the materialized graph → statements (never a source file)
		// -----------------------------------------------------------------
		const emitFromGraph = ({ reader }, callback) => {
			reader.readAll((readError, graph) => {
				if (readError) {
					callback(readError);
					return;
				}
				const statements = new Map();
				const nodeById = graph.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
				let fault;
				const readingStatement = ({ prefixText, reading, properties }) => {
					const propertyValue = properties[reading.propertyName];
					if (propertyValue === undefined) {
						return;
					}
					const cellText = reading.valueKind === 'boolean' ? BOOLEAN_TEXT_BY_VALUE[propertyValue] : `${propertyValue}`;
					statements.set(`${prefixText}|${reading.columnName}|${cellText}`, {});
				};
				graph.nodes.forEach((oneNode) => {
					const { stableId, role, properties } = oneNode;
					if (role === ROOT_ROLE || NOT_SOURCE_ROLE_LIST.indexOf(role) !== -1) {
						return;
					}
					if (role === 'DmeClass') {
						const shapeMatch = stableId.match(SHAPE_STABLE_ID_RE);
						if (shapeMatch === null) {
							fault = `shape node '${stableId}' does not read as pescld:shape/<shapeID>`;
							return;
						}
						SHAPE_PROPERTY_READING_LIST.forEach((reading) => readingStatement({ prefixText: `shape|${shapeMatch[1]}`, reading, properties }));
						return;
					}
					if (role === 'DmeProperty') {
						const rowMatch = stableId.match(ROW_STABLE_ID_RE);
						if (rowMatch === null) {
							fault = `row node '${stableId}' does not read as pescld:shape/<shapeID>/<propertyID>`;
							return;
						}
						const rowPrefix = `row|${rowMatch[1]}|${rowMatch[2]}`;
						ROW_PROPERTY_READING_LIST.forEach((reading) => readingStatement({ prefixText: rowPrefix, reading, properties }));
						if (properties.valueConstraintDeclaredEmpty === true) {
							statements.set(`${rowPrefix}|valueConstraint|${DECLARED_EMPTY_TEXT}`, {});
						}
						JSON.parse(properties.sourceTabs || '[]').forEach((tabFileName) => statements.set(`${rowPrefix}|sourceTab|${tabFileName}`, {}));
						JSON.parse(properties.sourceValueConflicts || '[]').forEach((oneConflict) => {
							Object.keys(oneConflict.cellTextBySourceFileName).forEach((tabFileName) => statements.set(`${rowPrefix}|${oneConflict.columnName}|${oneConflict.cellTextBySourceFileName[tabFileName]}`, {}));
							statements.set(`resolved|${rowMatch[1]}|${rowMatch[2]}|${oneConflict.columnName}|${oneConflict.resolvedCellText}`, {});
						});
						JSON.parse(properties.crossRefs || '[]').forEach((oneCrossRef) => statements.set(`${rowPrefix}|${oneCrossRef.locator}|${oneCrossRef.raw}`, {}));
						return;
					}
					if (role === 'DmeOptionSet') {
						if (PICKLIST_STABLE_ID_RE.test(stableId) === false) {
							fault = `picklist node '${stableId}' does not read as pescld:picklist/<shapeID>/<propertyID>`;
						}
						return; // its values are read off its HAS_VALUE edges; its name is the row's label (derived)
					}
					if (role === 'DmeOptionValue') {
						const valueMatch = stableId.match(PICKLIST_VALUE_STABLE_ID_RE);
						if (valueMatch === null) {
							fault = `picklist value node '${stableId}' does not read as pescld:picklist/<shapeID>/<propertyID>/<value>`;
							return;
						}
						if (properties.listRepeatCount !== undefined) {
							statements.set(`picklistRepeat|${valueMatch[1]}|${valueMatch[2]}|${properties.name}|${properties.listRepeatCount}`, {});
						}
						if (properties.termIri !== undefined) {
							statements.set(`picklistValueIri|${valueMatch[1]}|${valueMatch[2]}|${properties.name}|${properties.termIri}`, {});
						}
						return;
					}
					fault = `node '${stableId}' has role ${role}, which no source record maps to`;
				});
				graph.edges.forEach((oneEdge) => {
					const fromNode = nodeById[oneEdge.fromStableId];
					const toNode = nodeById[oneEdge.toStableId];
					if (fromNode === undefined || toNode === undefined) {
						fault = `edge ${oneEdge.type} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has an endpoint the read did not return`;
						return;
					}
					if (NOT_SOURCE_ROLE_LIST.indexOf(fromNode.role) !== -1 || NOT_SOURCE_ROLE_LIST.indexOf(toNode.role) !== -1) {
						return;
					}
					const edgeReadingKey = `${oneEdge.type}|${fromNode.role}|${toNode.role}`;
					if (edgeReadingKey === `HAS_CLASS|${ROOT_ROLE}|DmeClass`) {
						statements.set(`shape|${toNode.stableId.match(SHAPE_STABLE_ID_RE)[1]}|declared|true`, {});
						return;
					}
					if (edgeReadingKey === 'HAS_PROPERTY|DmeClass|DmeProperty') {
						const rowMatch = toNode.stableId.match(ROW_STABLE_ID_RE);
						statements.set(`row|${rowMatch[1]}|${rowMatch[2]}|shapeID|${fromNode.stableId.match(SHAPE_STABLE_ID_RE)[1]}`, {});
						return;
					}
					if (edgeReadingKey === 'REFERENCES|DmeProperty|DmeClass' && oneEdge.properties.locator === 'valueShape') {
						const rowMatch = fromNode.stableId.match(ROW_STABLE_ID_RE);
						statements.set(`row|${rowMatch[1]}|${rowMatch[2]}|valueShape|${toNode.stableId.match(SHAPE_STABLE_ID_RE)[1]}`, {});
						return;
					}
					if (edgeReadingKey === 'HAS_OPTION_SET|DmeProperty|DmeOptionSet') {
						return; // read with HAS_VALUE below, which joins through it
					}
					if (edgeReadingKey === 'HAS_VALUE|DmeOptionSet|DmeOptionValue') {
						const owningRowEdge = graph.edges.find((candidateEdge) => candidateEdge.type === 'HAS_OPTION_SET' && candidateEdge.toStableId === fromNode.stableId);
						if (owningRowEdge === undefined) {
							fault = `picklist '${fromNode.stableId}' has no owning row (no HAS_OPTION_SET edge reaches it)`;
							return;
						}
						const rowMatch = owningRowEdge.fromStableId.match(ROW_STABLE_ID_RE);
						statements.set(`picklistValue|${rowMatch[1]}|${rowMatch[2]}|${toNode.properties.name}`, {});
						return;
					}
					fault = `edge ${oneEdge.type} (${fromNode.role} -> ${toNode.role}) ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has no reading`;
				});
				if (fault !== undefined) {
					callback('', { fault });
					return;
				}
				callback('', { statements, stats: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, statementCount: statements.size } });
			});
		};

		const omissionDeclaration = Object.freeze({
			rule: ruleModulePath,
			kindPropertyName: OMITTED_KIND_PROPERTY_NAME,
			kindList: Object.freeze(Object.values(OMITTED_KIND)),
			textBearingKindList: Object.freeze([OMITTED_KIND.WHITESPACE_TRIMMED]),
			textPropertyName: OMITTED_TEXT_PROPERTY_NAME,
			caveatText:
				'spreadsheetRowNumber is the TAP column 0 (a spreadsheet row number filled on 167 of 270 records, not an identity); whitespaceTrimmed is the raw ' +
				'text of a trimmed cell (2 in snapshot 01: a leading space on one label, a trailing space on one picklist value); namespaceTable is namespaces.csv, ' +
				'applied as every termIri rather than carried as a table; packageMetadata is about.csv (its url is the root sourceUrl).',
		});

		const semanticValidationLimit =
			'SEMANTIC round trip of the PESC_LD v0.0.2 TAP CSV snapshot (shapes.csv and the seven TAP files) over the statement domain THIS INSTRUMENT MODELS: ' +
			'every non-empty cell of every shape record and every TAP record, keyed by (shapeID, propertyID), with the TAP file each record appears in; each ' +
			'valueClass line and each picklist value separately, a repeated picklist value with its count, a constraint type stated with an empty constraint; ' +
			'the expansion of every CURIE term by the package\'s own namespaces.csv; a column whose duplicate records disagree, with both texts and the declared ' +
			'resolution. Structure is read back from the edges (HAS_CLASS, HAS_PROPERTY, REFERENCES valueShape, HAS_OPTION_SET with HAS_VALUE). EXPLICITLY OMITTED ' +
			'and listed: the spreadsheet row-number column, the raw text of whitespace-trimmed cells, the namespaces.csv table, the about.csv package metadata. ' +
			'NOT modelled: record and line ORDER (spreadsheet order, not a statement), a picklist\'s name (it is its row\'s label), derived values (path, depth, ' +
			'searchText, embed texts) and the root\'s provenance fields (checked by the framework). The publisher\'s SHACL TTL is NOT read here: it is the second ' +
			'oracle (lib/pescldTtlOracle.js), diffed against the same graph with a declared departure table.';

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration };
	};

module.exports = moduleFunction({ moduleName });
