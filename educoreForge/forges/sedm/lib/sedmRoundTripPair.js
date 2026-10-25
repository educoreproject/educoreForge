'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sedmRoundTripPair.js — H4 for the SEDM forge bundle (nextStandards-102326 wave 2, lane G). A SOURCE-side canonicalizer and a
// GRAPH-side emitter held apart on purpose: the canonicalizer reads only snapshot 01 (the CSV, the structures JSON), the emitter only
// the materialized graph. They share the strict CSV tokenizer and the two profiles' FILE, COLUMN and FIELD NAMES, nothing of the walk.
// Every value is part of its statement KEY, so the harness's key-only diff is also a value diff:
//   entity|<Entity>|declared|true                                  an in-scope Entity (graph: the root's HAS_CLASS edge)
//   element|<Entity>|<Category>|<Name>|declared|true               an in-scope element (graph: its entity's HAS_PROPERTY edge)
//   element|…|<propertyName>|<cellText>                            every non-empty carried cell (text, membership, category,
//                                                                  description, and each distinct text of a textList column)
//   element|…|optionValue|<code>|<name>                            each line of the inline Option Set (graph: HAS_OPTION_SET,
//                                                                  HAS_VALUE, the value's code and name)
//   element|…|etlTemplate|<column>                                 a 'Y' in an ETL template column (graph: REFERENCES etlTemplate)
//   support|<kind>|<identity>[/<sub>]|declared|true                a structures item (graph: the root's HAS_SUPPORT edge)
//   support|…|<name, description, carried property>|<text>         its fields, in the profile's form
//   support|<kind>|<identity>/<sub>|subItemOf|<locator>|<identity> a nested item (graph: REFERENCES sub -> item)
//   support|…|reference|<locator>|<target kind>|<target identity>  a reference field (graph: REFERENCES with that locator)
//   declaredOptionSet|<name>|declared|true, …|value|<value>|<field>|<text>   a code list restating no element
// Explicitly omitted, each statement naming its kind (the omission declaration below; BRONZE_CROWN rulings 1 and 2, 2026-10-24):
// a record outside SEDM; the CEDS-restated metadata columns and the vendor extract block (by their profile carriage); the derived
// "In any ETL template?" column, ONLY where it equals the OR of the 14 ETL columns (where it does not, the statement is not omitted
// and is lost: a red); the 'None' text that means no option set; a list cell's trailing line break; the raw text of a trimmed cell;
// a JSON code list that restates an element's inline set, ONLY where equal; the JSON's proposed milestone elements, ONLY where each
// names an in-scope element; the JSON's extraction metadata and group descriptions.

const fs = require('fs');
const path = require('path');
const { parseCsvText } = require(path.join(__dirname, '..', '..', 'pescld', 'lib', 'pescldCsvReader'));
const sourceProfile = require('./sedmSourceProfile.json');
const structuresProfile = require('./sedmStructuresProfile.json');

const LINE_SEPARATOR = sourceProfile.lineSeparator;
const optionLineRegex = new RegExp(sourceProfile.optionLinePatternSource);
const ROOT_ROLE = 'DmeStandardRoot';
// Layers the source states nothing about, excluded BY ROLE so the exclusion is a stated decision: the framework's embed-text nodes,
// and a hub's cards when this standard sits in a graph beside one. Any OTHER unknown role or edge faults by name.
const NOT_SOURCE_ROLE_LIST = Object.freeze(['DmeEmbedText', 'HubReference', 'HubDefinition']);
const ETL_TEMPLATE_LOCATOR = 'etlTemplate';
const SUPPORT_STABLE_ID_RE = /^sedm:([A-Za-z]+)\/([^/]+)(?:\/([^/]+))?$/;
const DECLARED_OPTION_SET_STABLE_ID_RE = /^sedm:declaredOptionSet\/([^/]+)$/;

const OMITTED_KIND = Object.freeze({
	OUT_OF_SCOPE_RECORD: 'outOfScopeRecord',
	RESTATED_METADATA_COLUMN: 'restatedMetadataColumn',
	VENDOR_EXTRACT_COLUMN: 'vendorExtractColumn',
	DERIVED_COLUMN: 'derivedColumn',
	NO_OPTION_SET_TEXT: 'noOptionSetText',
	LIST_TERMINATOR: 'listTerminator',
	WHITESPACE_TRIMMED: 'whitespaceTrimmed',
	RESTATED_OPTION_SET: 'restatedOptionSet',
	RESTATED_CSV_ELEMENT: 'restatedCsvElement',
	EXTRACTION_METADATA: 'extractionMetadata',
	GROUP_DESCRIPTION: 'groupDescription',
});
const OMITTED_KIND_BY_CARRIAGE = Object.freeze({ omittedRestatedMetadata: OMITTED_KIND.RESTATED_METADATA_COLUMN, omittedVendorExtract: OMITTED_KIND.VENDOR_EXTRACT_COLUMN });
const OMITTED_KIND_PROPERTY_NAME = 'omittedKind';
const OMITTED_TEXT_PROPERTY_NAME = 'text';
const omitted = (kind, extra) => ({ explicitlyOmitted: true, [OMITTED_KIND_PROPERTY_NAME]: kind, ...(extra || {}) });

// the graph form of a JSON field value, in the profile's declared form (the walk's carriage, restated by this instrument)
const STATEMENT_TEXT_BY_FORM = Object.freeze({
	text: (fieldValue) => `${fieldValue}`,
	number: (fieldValue) => `${fieldValue}`,
	boolean: (fieldValue) => `${fieldValue}`,
	jsonList: (fieldValue) => JSON.stringify(fieldValue),
	jsonObject: (fieldValue) => JSON.stringify(fieldValue),
});
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const valueAtPath = ({ structures, pathList }) => pathList.reduce((soFar, memberName) => (isPlainObject(soFar) ? soFar[memberName] : undefined), structures);
const elementPrefixOf = ({ entityName, categoryName, elementName }) => `element|${entityName}|${categoryName}|${elementName}`;
// the profile row of a support kind, and of its sub-items
const sectionBySupportKind = structuresProfile.sectionList.reduce((byKind, oneSection) => ({ ...byKind, [oneSection.supportKind]: oneSection }), {});
const fieldStatementListOf = (itemRow) => [{ fieldName: itemRow.nameFieldName, propertyName: 'name', form: 'text' }, { fieldName: itemRow.descriptionFieldName, propertyName: 'description', form: 'text' }]
	.filter((oneField) => oneField.fieldName !== null && oneField.fieldName !== undefined)
	.concat(itemRow.carriedFieldList);

const moduleFunction =
	({ moduleName } = {}) =>
	({ ruleModulePath }) => {
		// -----------------------------------------------------------------
		// canonicalizeSource — snapshot 01 → statements (never the graph)
		// -----------------------------------------------------------------
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const csvRead = parseCsvText({ csvText: fs.readFileSync(path.join(snapshotPath, sourceProfile.csvFileName), 'utf8'), sourceFileName: sourceProfile.csvFileName });
			if (csvRead.refusalText !== undefined) {
				callback(csvRead.refusalText);
				return;
			}
			const structuresText = fs.readFileSync(path.join(snapshotPath, sourceProfile.structuresFileName), 'utf8');
			let structures;
			let parseFault = '';
			// the single-site boundary dispensation for JSON.parse: translated into a refusal by name, never control flow
			try {
				structures = JSON.parse(structuresText);
			} catch (parseError) {
				parseFault = parseError.message;
			}
			if (parseFault !== '') {
				callback(`${moduleName} REFUSED: '${sourceProfile.structuresFileName}' is not JSON (${parseFault})`);
				return;
			}
			const statements = new Map();
			const columnListByCarriage = sourceProfile.columnList.reduce((byCarriage, oneColumn) => ({ ...byCarriage, [oneColumn.carriage]: (byCarriage[oneColumn.carriage] || []).concat([oneColumn]) }), {});
			const onlyColumn = (carriage) => columnListByCarriage[carriage][0];
			// trimmed — a cell's text with surrounding whitespace removed; the raw text is an omitted statement of its own
			const trimmed = ({ rawText, lineNumber, columnName }) => {
				const trimmedText = rawText.trim();
				if (trimmedText !== rawText) {
					statements.set(`whitespace|${lineNumber}|${columnName}|${rawText}`, omitted(OMITTED_KIND.WHITESPACE_TRIMMED, { [OMITTED_TEXT_PROPERTY_NAME]: rawText }));
				}
				return trimmedText;
			};

			const optionValueListByElementName = {};
			const inScopeElementNameSet = new Set();
			csvRead.recordList.forEach((oneRecord) => {
				const { cellList, lineNumber } = oneRecord;
				const membershipColumn = onlyColumn('membership');
				if (cellList[membershipColumn.position].trim() === '') {
					statements.set(`record|${lineNumber}`, omitted(OMITTED_KIND.OUT_OF_SCOPE_RECORD));
					return;
				}
				const cellOf = (oneColumn) => trimmed({ rawText: cellList[oneColumn.position], lineNumber, columnName: oneColumn.columnName });
				const entityName = cellOf(onlyColumn('identityEntity'));
				const categoryName = cellOf(onlyColumn('identityCategory'));
				const elementName = cellOf(onlyColumn('identityName'));
				inScopeElementNameSet.add(elementName);
				const prefix = elementPrefixOf({ entityName, categoryName, elementName });
				statements.set(`entity|${entityName}|declared|true`, {});
				statements.set(`${prefix}|declared|true`, {});
				if (categoryName !== '') {
					statements.set(`${prefix}|${onlyColumn('identityCategory').propertyName}|${categoryName}`, {});
				}
				const descriptionText = cellOf(onlyColumn('description'));
				if (descriptionText !== '') {
					statements.set(`${prefix}|description|${descriptionText}`, {});
				}
				(columnListByCarriage.text || []).concat(columnListByCarriage.membership).concat(columnListByCarriage.textList || []).forEach((oneColumn) => {
					const cellText = cellOf(oneColumn);
					if (cellText !== '') {
						statements.set(`${prefix}|${oneColumn.propertyName}|${cellText}`, {});
					}
				});
				// ETL templates, and the derived column checked against their OR
				const etlColumnNameList = (columnListByCarriage.etlTemplate || []).filter((oneColumn) => cellOf(oneColumn) !== '').map((oneColumn) => {
					statements.set(`${prefix}|etlTemplate|${oneColumn.columnName}|${cellOf(oneColumn)}`, {});
					return oneColumn.columnName;
				});
				(columnListByCarriage.derivedAnyEtlTemplate || []).forEach((oneColumn) => {
					const cellText = cellOf(oneColumn);
					const isConsistent = (cellText !== '') === (etlColumnNameList.length > 0);
					if (cellText === '' && isConsistent) {
						return;
					}
					statements.set(`${prefix}|${isConsistent ? oneColumn.columnName : 'derivedColumnDisagrees'}|${cellText}`, isConsistent ? omitted(OMITTED_KIND.DERIVED_COLUMN) : {});
				});
				// omitted columns, by carriage
				Object.keys(OMITTED_KIND_BY_CARRIAGE).forEach((carriage) => (columnListByCarriage[carriage] || []).forEach((oneColumn) => {
					const cellText = cellList[oneColumn.position];
					if (cellText.trim() !== '') {
						statements.set(`omittedColumn|${lineNumber}|${oneColumn.position}|${cellText}`, omitted(OMITTED_KIND_BY_CARRIAGE[carriage], { [OMITTED_TEXT_PROPERTY_NAME]: cellText }));
					}
				}));
				// a declared-empty column that holds anything is a statement nothing carries: lost, a red
				(columnListByCarriage.declaredEmpty || []).forEach((oneColumn) => {
					if (cellList[oneColumn.position].trim() !== '') {
						statements.set(`${prefix}|declaredEmptyColumnHolds|${oneColumn.position}|${cellList[oneColumn.position]}`, {});
					}
				});
				// the inline option set: its lines (each trimmed), the trailing line break, the 'no set' text
				const optionColumn = onlyColumn('optionSet');
				const rawOptionText = cellList[optionColumn.position];
				if (rawOptionText.trim() === '') {
					trimmed({ rawText: rawOptionText, lineNumber, columnName: optionColumn.columnName });
					return;
				}
				const rawLineList = rawOptionText.split(LINE_SEPARATOR);
				if (rawLineList.length > 1 && rawLineList[rawLineList.length - 1].trim() === '') {
					statements.set(`listTerminator|${lineNumber}|${optionColumn.columnName}`, omitted(OMITTED_KIND.LIST_TERMINATOR));
					rawLineList.pop();
				}
				const lineList = rawLineList.map((rawLine) => trimmed({ rawText: rawLine, lineNumber, columnName: optionColumn.columnName }));
				if (lineList.length === 1 && lineList[0] === sourceProfile.noOptionSetCellText) {
					statements.set(`${prefix}|optionSet|${lineList[0]}`, omitted(OMITTED_KIND.NO_OPTION_SET_TEXT));
					return;
				}
				const valueList = lineList.map((oneLine) => {
					const lineMatch = oneLine.match(optionLineRegex);
					return lineMatch === null ? { codeText: oneLine, valueName: oneLine } : { codeText: lineMatch[1].trim(), valueName: lineMatch[2].trim() };
				});
				valueList.forEach(({ codeText, valueName }) => statements.set(`${prefix}|optionValue|${codeText}|${valueName}`, {}));
				optionValueListByElementName[elementName] = (optionValueListByElementName[elementName] || []).concat([JSON.stringify(valueList.map((oneValue) => [oneValue.codeText, oneValue.valueName]))]);
			});

			// the structures: every profile section, its sub-items, its references. A section the profile reads and the file lacks is
			// refused here, never read as empty (the instrument's own check, not the walk's)
			const absentSection = structuresProfile.sectionList.find((oneSection) => !Array.isArray(valueAtPath({ structures, pathList: oneSection.itemListPathList })));
			const declaredSetByName = structures[structuresProfile.declaredOptionSetSection.sectionName];
			if (absentSection !== undefined || !isPlainObject(declaredSetByName)) {
				callback(`${moduleName} REFUSED: '${sourceProfile.structuresFileName}' has no ${absentSection !== undefined ? `list at ${absentSection.itemListPathList.join('.')}` : `object at ${structuresProfile.declaredOptionSetSection.sectionName}`}`);
				return;
			}
			structuresProfile.sectionList.forEach((oneSection) => {
				const itemList = valueAtPath({ structures, pathList: oneSection.itemListPathList });
				itemList.forEach((item) => {
					const identityText = `${item[oneSection.identityFieldName]}`;
					const itemPrefix = `support|${oneSection.supportKind}|${identityText}`;
					statements.set(`${itemPrefix}|declared|true`, {});
					fieldStatementListOf(oneSection).filter((oneField) => item[oneField.fieldName] !== undefined)
						.forEach((oneField) => statements.set(`${itemPrefix}|${oneField.propertyName}|${STATEMENT_TEXT_BY_FORM[oneField.form](item[oneField.fieldName])}`, {}));
					oneSection.referenceFieldList.filter((oneReference) => item[oneReference.fieldName] !== undefined)
						.forEach((oneReference) => statements.set(`${itemPrefix}|reference|${oneReference.locator}|${oneReference.targetSupportKind}|${item[oneReference.fieldName]}`, {}));
					const subItem = oneSection.subItem;
					if (subItem === null || item[subItem.fieldName] === undefined) {
						return;
					}
					item[subItem.fieldName].forEach((subItemValue) => {
						const isTextForm = subItem.itemForm === 'text';
						const subIdentityText = isTextForm ? subItemValue : `${subItemValue[subItem.identityFieldName]}`;
						const subPrefix = `support|${oneSection.supportKind}|${identityText}/${subIdentityText}`;
						statements.set(`${subPrefix}|declared|true`, {});
						statements.set(`${subPrefix}|subItemOf|${subItem.locator}|${identityText}`, {});
						if (isTextForm) {
							statements.set(`${subPrefix}|name|${subItemValue}`, {});
							return;
						}
						fieldStatementListOf(subItem).filter((oneField) => subItemValue[oneField.fieldName] !== undefined)
							.forEach((oneField) => statements.set(`${subPrefix}|${oneField.propertyName}|${STATEMENT_TEXT_BY_FORM[oneField.form](subItemValue[oneField.fieldName])}`, {}));
					});
				});
			});
			// the code lists: one restating an element is omitted ONLY where it equals that element's set (a single distinct set)
			const sectionRow = structuresProfile.declaredOptionSetSection;
			Object.keys(declaredSetByName).forEach((optionSetName) => {
				const declaredSet = structures[sectionRow.sectionName][optionSetName];
				const restatedElementName = declaredSet[sectionRow.restatedElementNameFieldName];
				if (restatedElementName !== undefined) {
					const declaredPairText = JSON.stringify(declaredSet[sectionRow.valueListFieldName].map((oneValue) => [oneValue[sectionRow.valueCodeFieldName], oneValue[sectionRow.valueNameFieldName]]));
					const inlinePairTextList = Array.from(new Set(optionValueListByElementName[restatedElementName] || []));
					const isRestated = inlinePairTextList.length === 1 && inlinePairTextList[0] === declaredPairText;
					statements.set(`declaredOptionSet|${optionSetName}|restates|${restatedElementName}|${declaredPairText}`, isRestated ? omitted(OMITTED_KIND.RESTATED_OPTION_SET) : {});
					return;
				}
				statements.set(`declaredOptionSet|${optionSetName}|declared|true`, {});
				declaredSet[sectionRow.valueListFieldName].forEach((oneValue) => {
					const valuePrefix = `declaredOptionSet|${optionSetName}|value|${oneValue[sectionRow.valueNameFieldName]}`;
					statements.set(`${valuePrefix}|declared|true`, {});
					[sectionRow.valueCodeFieldName, sectionRow.valueDescriptionFieldName].filter((fieldName) => oneValue[fieldName] !== undefined)
						.forEach((fieldName) => statements.set(`${valuePrefix}|${fieldName}|${oneValue[fieldName]}`, {}));
				});
			});
			// the omitted parts of the structures file
			structuresProfile.omittedPathList.forEach((oneOmission) => {
				const omittedValue = valueAtPath({ structures, pathList: oneOmission.pathList });
				if (omittedValue === undefined) {
					return;
				}
				if (oneOmission.omittedKind !== OMITTED_KIND.RESTATED_CSV_ELEMENT) {
					statements.set(`structuresPath|${oneOmission.pathList.join('.')}|${JSON.stringify(omittedValue)}`, omitted(oneOmission.omittedKind, { [OMITTED_TEXT_PROPERTY_NAME]: JSON.stringify(omittedValue) }));
					return;
				}
				// a restated element is omitted ONLY where it names an in-scope CSV element
				omittedValue.forEach((oneElement) => statements.set(
					`structuresPath|${oneOmission.pathList.join('.')}|${JSON.stringify(oneElement)}`,
					inScopeElementNameSet.has(oneElement.name) ? omitted(oneOmission.omittedKind, { [OMITTED_TEXT_PROPERTY_NAME]: JSON.stringify(oneElement) }) : {},
				));
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
				const edgeListByTypeAndTo = graph.edges.reduce((byTypeAndTo, oneEdge) => ({ ...byTypeAndTo, [`${oneEdge.type}|${oneEdge.toStableId}`]: (byTypeAndTo[`${oneEdge.type}|${oneEdge.toStableId}`] || []).concat([oneEdge]) }), {});
				let fault;
				const ownerOf = ({ edgeType, toStableId }) => {
					const owningEdgeList = edgeListByTypeAndTo[`${edgeType}|${toStableId}`] || [];
					if (owningEdgeList.length !== 1) {
						fault = `node '${toStableId}' has ${owningEdgeList.length} ${edgeType} owner(s), where it must have one`;
						return undefined;
					}
					return nodeById[owningEdgeList[0].fromStableId];
				};
				const elementPrefixOfNode = (elementNode) => {
					const entityNode = ownerOf({ edgeType: 'HAS_PROPERTY', toStableId: elementNode.stableId });
					return entityNode === undefined ? undefined : elementPrefixOf({ entityName: entityNode.properties.name, categoryName: elementNode.properties.category === undefined ? '' : elementNode.properties.category, elementName: elementNode.properties.name });
				};
				const supportIdentityOf = (supportNode) => {
					const idMatch = supportNode.stableId.match(SUPPORT_STABLE_ID_RE);
					if (idMatch === null || sectionBySupportKind[idMatch[1]] === undefined) {
						fault = `support node '${supportNode.stableId}' does not read as sedm:<support kind>/<identity>[/<sub>]`;
						return undefined;
					}
					return { supportKind: idMatch[1], identityText: decodeURIComponent(idMatch[2]), subIdentityText: idMatch[3] === undefined ? undefined : decodeURIComponent(idMatch[3]) };
				};
				const supportPrefixOf = (supportIdentity) => `support|${supportIdentity.supportKind}|${supportIdentity.identityText}${supportIdentity.subIdentityText === undefined ? '' : `/${supportIdentity.subIdentityText}`}`;
				const elementReadingList = sourceProfile.columnList.filter((oneColumn) => ['text', 'membership', 'identityCategory'].indexOf(oneColumn.carriage) !== -1);
				const elementListReadingList = sourceProfile.columnList.filter((oneColumn) => oneColumn.carriage === 'textList');

				graph.nodes.forEach((oneNode) => {
					const { stableId, role, properties } = oneNode;
					if (role === ROOT_ROLE || NOT_SOURCE_ROLE_LIST.indexOf(role) !== -1 || role === 'DmeOptionSet') {
						return; // a set is read from its HAS_OPTION_SET edge and its values
					}
					if (role === 'DmeClass') {
						// an entity is read from its HAS_CLASS edge; the source states nothing else of it, so any description is invented
						if (properties.description !== undefined) {
							statements.set(`entity|${properties.name}|description|${properties.description}`, {});
						}
						return;
					}
					if (role === 'DmeProperty') {
						const prefix = elementPrefixOfNode(oneNode);
						if (prefix === undefined) {
							return;
						}
						elementReadingList.filter((oneColumn) => properties[oneColumn.propertyName] !== undefined).forEach((oneColumn) => statements.set(`${prefix}|${oneColumn.propertyName}|${properties[oneColumn.propertyName]}`, {}));
						elementListReadingList.filter((oneColumn) => properties[oneColumn.propertyName] !== undefined)
							.forEach((oneColumn) => JSON.parse(properties[oneColumn.propertyName]).forEach((oneText) => statements.set(`${prefix}|${oneColumn.propertyName}|${oneText}`, {})));
						if (properties.description !== undefined) {
							statements.set(`${prefix}|description|${properties.description}`, {});
						}
						return;
					}
					if (role === 'DmeSupport') {
						const supportIdentity = supportIdentityOf(oneNode);
						if (supportIdentity === undefined) {
							return;
						}
						const oneSection = sectionBySupportKind[supportIdentity.supportKind];
						const itemRow = supportIdentity.subIdentityText === undefined ? oneSection : (oneSection.subItem.itemForm === 'text' ? { nameFieldName: 'name', descriptionFieldName: null, carriedFieldList: [] } : oneSection.subItem);
						fieldStatementListOf(itemRow).filter((oneField) => properties[oneField.propertyName] !== undefined)
							.forEach((oneField) => statements.set(`${supportPrefixOf(supportIdentity)}|${oneField.propertyName}|${properties[oneField.propertyName]}`, {}));
						return;
					}
					if (role === 'DmeOptionValue') {
						const optionSetNode = ownerOf({ edgeType: 'HAS_VALUE', toStableId: stableId });
						if (optionSetNode === undefined) {
							return;
						}
						const setOwnerNode = ownerOf({ edgeType: 'HAS_OPTION_SET', toStableId: optionSetNode.stableId });
						if (setOwnerNode === undefined) {
							return;
						}
						if (setOwnerNode.role === 'DmeProperty') {
							const prefix = elementPrefixOfNode(setOwnerNode);
							if (prefix !== undefined) {
								statements.set(`${prefix}|optionValue|${properties.code}|${properties.name}`, {});
							}
							return;
						}
						const declaredMatch = optionSetNode.stableId.match(DECLARED_OPTION_SET_STABLE_ID_RE);
						if (setOwnerNode.role !== ROOT_ROLE || declaredMatch === null) {
							fault = `option value '${stableId}' sits in set '${optionSetNode.stableId}', owned by neither an element nor (as a declared list) the root`;
							return;
						}
						const valuePrefix = `declaredOptionSet|${optionSetNode.properties.name}|value|${properties.name}`;
						statements.set(`${valuePrefix}|declared|true`, {});
						['code', 'description'].filter((propertyName) => properties[propertyName] !== undefined).forEach((propertyName) => statements.set(`${valuePrefix}|${propertyName}|${properties[propertyName]}`, {}));
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
					const locator = oneEdge.properties === undefined ? undefined : oneEdge.properties.locator;
					if (edgeReadingKey === `HAS_CLASS|${ROOT_ROLE}|DmeClass`) {
						statements.set(`entity|${toNode.properties.name}|declared|true`, {});
						return;
					}
					if (edgeReadingKey === 'HAS_PROPERTY|DmeClass|DmeProperty') {
						statements.set(`${elementPrefixOf({ entityName: fromNode.properties.name, categoryName: toNode.properties.category === undefined ? '' : toNode.properties.category, elementName: toNode.properties.name })}|declared|true`, {});
						return;
					}
					if (edgeReadingKey === 'HAS_OPTION_SET|DmeProperty|DmeOptionSet' || edgeReadingKey === 'HAS_VALUE|DmeOptionSet|DmeOptionValue') {
						return; // read with the value nodes above, which join through them
					}
					if (edgeReadingKey === `HAS_OPTION_SET|${ROOT_ROLE}|DmeOptionSet`) {
						statements.set(`declaredOptionSet|${toNode.properties.name}|declared|true`, {});
						return;
					}
					if (edgeReadingKey === `HAS_SUPPORT|${ROOT_ROLE}|DmeSupport`) {
						const supportIdentity = supportIdentityOf(toNode);
						if (supportIdentity !== undefined) {
							statements.set(`${supportPrefixOf(supportIdentity)}|declared|true`, {});
						}
						return;
					}
					if (edgeReadingKey === 'REFERENCES|DmeProperty|DmeSupport' && locator === ETL_TEMPLATE_LOCATOR) {
						const prefix = elementPrefixOfNode(fromNode);
						if (prefix !== undefined) {
							statements.set(`${prefix}|etlTemplate|${toNode.properties.csvColumnName}|${sourceProfile.etlTemplateCellTextList[0]}`, {});
						}
						return;
					}
					if (edgeReadingKey === 'REFERENCES|DmeSupport|DmeSupport') {
						const fromIdentity = supportIdentityOf(fromNode);
						const toIdentity = supportIdentityOf(toNode);
						if (fromIdentity === undefined || toIdentity === undefined) {
							return;
						}
						const oneSection = sectionBySupportKind[fromIdentity.supportKind];
						if (oneSection.subItem !== null && locator === oneSection.subItem.locator && fromIdentity.subIdentityText !== undefined) {
							statements.set(`${supportPrefixOf(fromIdentity)}|subItemOf|${locator}|${toIdentity.identityText}`, {});
							return;
						}
						if (oneSection.referenceFieldList.some((oneReference) => oneReference.locator === locator && oneReference.targetSupportKind === toIdentity.supportKind)) {
							statements.set(`${supportPrefixOf(fromIdentity)}|reference|${locator}|${toIdentity.supportKind}|${toIdentity.identityText}`, {});
							return;
						}
					}
					fault = `edge ${oneEdge.type} (${fromNode.role} -> ${toNode.role}, locator ${locator}) ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has no reading`;
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
			textBearingKindList: Object.freeze([OMITTED_KIND.WHITESPACE_TRIMMED, OMITTED_KIND.RESTATED_METADATA_COLUMN, OMITTED_KIND.VENDOR_EXTRACT_COLUMN, OMITTED_KIND.RESTATED_CSV_ELEMENT, OMITTED_KIND.EXTRACTION_METADATA, OMITTED_KIND.GROUP_DESCRIPTION]),
			textPropertyName: OMITTED_TEXT_PROPERTY_NAME,
			caveatText:
				'outOfScopeRecord is a CSV record whose SEDM column is empty (the sheet is an annotated export of a whole element list; BRONZE_CROWN ruling 1); ' +
				'restatedMetadataColumn is a cell of a column that restates the annotated standard\'s own element metadata (Use Case / Connection, change status ' +
				'and notes, usage notes, alternate name, data model id, new association, URL, technical name); vendorExtractColumn is the four-record ' +
				'PowerSchool / ECATS student-extract block; derivedColumn is "In any ETL template?", omitted only where it equals the OR of the 14 ETL columns; ' +
				'noOptionSetText is the cell text None; listTerminator is a list cell\'s trailing line break; whitespaceTrimmed is the raw text of a trimmed ' +
				'cell; restatedOptionSet is a JSON code list equal to an element\'s inline set; restatedCsvElement is a JSON proposed milestone element that ' +
				'names an in-scope CSV element (the CSV record is the element); extractionMetadata and groupDescription are the JSON\'s _meta and its two ' +
				'section headers.',
		});

		const semanticValidationLimit =
			'SEMANTIC round trip of SEDM snapshot 01 (the element map CSV and the domain structures JSON) over the statement domain THIS INSTRUMENT ' +
			'MODELS: every in-scope record\'s entity and element identity (Entity, Category, Element Name), every non-empty carried cell, each line ' +
			'of its inline option set as (code, name), each ETL template flag; every item, sub-item, carried field and reference of every structures ' +
			'section the profile reads, and the JSON code lists. Structure is read back from the edges (HAS_CLASS, HAS_PROPERTY, HAS_OPTION_SET with ' +
			'HAS_VALUE, HAS_SUPPORT, REFERENCES etlTemplate / subtypeOf / subcomponentOf / complianceCategory). EXPLICITLY OMITTED and listed: see ' +
			'the omission caveat. NOT modelled: record and line ORDER, which records were merged as one element (the merge is the identity rule; a ' +
			'textList column carries each record\'s text), an option set\'s or value\'s derived name and path, derived values (path, depth, searchText, ' +
			'embed texts) and the root\'s provenance fields (checked by the framework).';

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration };
	};

module.exports = moduleFunction({ moduleName });
