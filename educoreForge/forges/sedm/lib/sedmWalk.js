'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sedmWalk.js — the H3 walk for the SEDM forge bundle (nextStandards-102326 wave 2, lane G; DESIGN-G0-sedm-102426.md, BRONZE_CROWN
// rulings 2026-10-24). PURE: it reads the loader's verbatim records and the source profile, and mints through the kit only; a refusal
// is a thrown named Error under the framework's one adapter.
//
// THE MODEL (identity: lib/sedmIdentity.js):
//   DmeSupport      the domain structures (lib/sedmStructuresWalk.js), minted first so the ETL edges below have their targets
//   DmeClass        one per distinct Entity of the in-scope records, in record order                 HAS_CLASS from the root
//   DmeProperty     one per distinct (Entity, Category, Element Name) of the in-scope records         HAS_PROPERTY from its entity
//   DmeOptionSet    the element's inline Option Set, one value per line                               HAS_OPTION_SET, HAS_VALUE
//   REFERENCES      element -> the Generate ETL template a 'Y' in that template's column names (locator 'etlTemplate')
//   DmeOptionSet    the JSON's own code lists that restate no element (lib/sedmStructuresWalk.js)
//
// THE DECLARED RULES, each counted in stats (never silent):
//   membership   a record is SEDM when its membership column (SEDM) is non-empty after trimming (BRONZE_CROWN ruling 1); every other
//                record is out of scope and counted;
//   declared empty  a declaredEmpty column holds nothing in ANY record, in scope or not, or the snapshot is refused;
//   whitespace   a cell's surrounding whitespace is trimmed (a list cell: each line); the trims are counted and listed;
//   list terminator  a list cell's ONE trailing line break ends the list and is counted; an empty line inside a list is refused;
//   duplicate    records sharing (Entity, Category, Element Name) are ONE element; a textList column carries each distinct text in
//                record order; any other carried column whose texts differ across the records is refused;
//   option set   the cell text noOptionSetCellText (and an empty cell) is no set; a line 'CODE - Name' is one value (code, name); a
//                line without the separator is a value whose code is its name; a code stated twice in one set is refused.
// Omitted columns (omittedRestatedMetadata, omittedVendorExtract, derivedAnyEtlTemplate) are not read here: the round trip declares
// them (lib/sedmRoundTripPair.js). The Global ID column is CARRIED, verbatim, as source data (FBB-001); nothing here resolves it.

const path = require('path');
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const sourceProfile = require('./sedmSourceProfile.json');
const sedmIdentity = require('./sedmIdentity');
const sedmStructuresWalk = require('./sedmStructuresWalk');

// the per-standard label of each CSV role (producer-local label stem Sedm, graph-contract PRODUCER_LOCAL_LABEL_PATTERN)
const PER_STANDARD_LABEL_BY_ROLE = Object.freeze({
	[DME_ROLES.CLASS]: 'SedmEntity',
	[DME_ROLES.PROPERTY]: 'SedmElement',
	[DME_ROLES.OPTION_SET]: 'SedmOptionSet',
	[DME_ROLES.OPTION_VALUE]: 'SedmOptionValue',
});
const ETL_TEMPLATE_SUPPORT_KIND = 'etlTemplate';
const ETL_TEMPLATE_LOCATOR = 'etlTemplate';
const PATH_SEPARATOR = ' / ';

const LINE_SEPARATOR = sourceProfile.lineSeparator;
const optionLineRegex = new RegExp(sourceProfile.optionLinePatternSource);
const columnListByCarriage = sourceProfile.columnList.reduce((byCarriage, oneColumn) => ({ ...byCarriage, [oneColumn.carriage]: (byCarriage[oneColumn.carriage] || []).concat([oneColumn]) }), {});
const onlyColumnOf = (carriage) => {
	const columnList = columnListByCarriage[carriage] || [];
	if (columnList.length !== 1) {
		throw refuse.byName({ moduleName, what: `the source profile names ${columnList.length} '${carriage}' columns`, where: 'sedmSourceProfile.json names exactly one column of each identity carriage' });
	}
	return columnList[0];
};
const IDENTITY_COLUMN = Object.freeze({
	entity: onlyColumnOf('identityEntity'),
	category: onlyColumnOf('identityCategory'),
	name: onlyColumnOf('identityName'),
	description: onlyColumnOf('description'),
	optionSet: onlyColumnOf('optionSet'),
	membership: onlyColumnOf('membership'),
});
// the columns whose texts must agree across an element's records: everything carried that is not a textList
const AGREEING_CARRIAGE_LIST = Object.freeze(['identityCategory', 'description', 'optionSet', 'text', 'membership', 'etlTemplate']);
// every column the walk reads from an in-scope record (the identity columns, the agreeing columns, the textList columns)
const READ_CARRIAGE_LIST = Object.freeze(['identityEntity', 'identityName', 'textList'].concat(AGREEING_CARRIAGE_LIST));

const refusal = (what, where) => refuse.byName({ moduleName, what, where });

// -----------------------------------------------------------------
// emitContractGraph — { loaded: the loader's payload, kit } → { nodes, edges, stats }
// -----------------------------------------------------------------
const emitContractGraph = ({ loaded, kit }) => {
	const { recordList, structures } = loaded;
	const walkStats = {
		recordCount: recordList.length,
		inScopeRecordCount: 0,
		outOfScopeRecordCount: 0,
		duplicateRecordCount: 0,
		whitespaceTrimmedCellCount: 0,
		whitespaceTrimmedCellList: [],
		listTerminatorCount: 0,
		etlReferenceEdgeCount: 0,
		supportNodeCountByKind: {},
		supportReferenceEdgeCount: 0,
		omittedStructuresPathCount: 0,
		restatedDeclaredOptionSetCount: 0,
		declaredOptionSetCount: 0,
		declaredOptionValueCount: 0,
	};
	const originOf = (oneRecord) => `${oneRecord.sourceFileName} line ${oneRecord.lineNumber}`;

	// trimmedCellText — the whitespace rule for one single-value cell
	const trimmedCellText = ({ oneRecord, oneColumn }) => {
		const rawText = oneRecord.cellList[oneColumn.position];
		const trimmedText = rawText.trim();
		if (trimmedText !== rawText) {
			walkStats.whitespaceTrimmedCellCount += 1;
			walkStats.whitespaceTrimmedCellList.push({ lineNumber: oneRecord.lineNumber, columnName: oneColumn.columnName, rawText });
		}
		return trimmedText;
	};
	// trimmedLineList — the whitespace and list-terminator rules for a list cell
	const trimmedLineList = ({ oneRecord, oneColumn }) => {
		const rawCellText = oneRecord.cellList[oneColumn.position];
		if (rawCellText.trim() === '') {
			if (rawCellText !== '') {
				walkStats.whitespaceTrimmedCellCount += 1;
				walkStats.whitespaceTrimmedCellList.push({ lineNumber: oneRecord.lineNumber, columnName: oneColumn.columnName, rawText: rawCellText });
			}
			return [];
		}
		const rawLineList = rawCellText.split(LINE_SEPARATOR);
		if (rawLineList.length > 1 && rawLineList[rawLineList.length - 1].trim() === '') {
			walkStats.listTerminatorCount += 1;
			rawLineList.pop();
		}
		return rawLineList.map((rawLine) => {
			const trimmedLine = rawLine.trim();
			if (trimmedLine === '') {
				throw refusal(`${originOf(oneRecord)} column '${oneColumn.columnName}' holds an empty line inside a list cell`, 'a list cell holds one entry per line; an empty entry is no entry and is never guessed at');
			}
			if (trimmedLine !== rawLine) {
				walkStats.whitespaceTrimmedCellCount += 1;
				walkStats.whitespaceTrimmedCellList.push({ lineNumber: oneRecord.lineNumber, columnName: oneColumn.columnName, rawText: rawLine });
			}
			return trimmedLine;
		});
	};

	// 0. declared-empty columns: empty in EVERY record
	(columnListByCarriage.declaredEmpty || []).forEach((oneColumn) => {
		const statingRecord = recordList.find((oneRecord) => oneRecord.cellList[oneColumn.position].trim() !== '');
		if (statingRecord !== undefined) {
			throw refusal(`${originOf(statingRecord)}: column '${oneColumn.columnName}' (position ${oneColumn.position}) holds ${JSON.stringify(statingRecord.cellList[oneColumn.position])}`, 'the profile declares this column empty in every record; a column that gains content needs a carriage ruling');
		}
	});

	// 1. the domain structures, so the ETL templates exist before any element names one
	const { supportStableIdByKindAndIdentity } = sedmStructuresWalk.emitSupportNodes({ structures, kit, walkStats });
	const etlTemplateStableIdByColumnName = (columnListByCarriage.etlTemplate || []).reduce((byColumnName, oneColumn) => {
		const templateStableId = supportStableIdByKindAndIdentity[`${ETL_TEMPLATE_SUPPORT_KIND}|${oneColumn.columnName}`];
		if (templateStableId === undefined) {
			throw refusal(`ETL column '${oneColumn.columnName}' (position ${oneColumn.position}) names no Generate ETL template of the structures file`, 'every etlTemplate column is one of the structures\' generateEtlTemplates, by name');
		}
		return { ...byColumnName, [oneColumn.columnName]: templateStableId };
	}, {});

	// 2. the in-scope records, each read ONCE (so every trim is counted once), grouped by element identity in record order. An
	// out-of-scope record is not read beyond its membership cell.
	const READ_COLUMN_LIST = sourceProfile.columnList.filter((oneColumn) => READ_CARRIAGE_LIST.indexOf(oneColumn.carriage) !== -1);
	const elementGroupList = [];
	const elementGroupByIdentity = {};
	recordList.forEach((oneRecord) => {
		if (oneRecord.cellList[IDENTITY_COLUMN.membership.position].trim() === '') {
			walkStats.outOfScopeRecordCount += 1;
			return;
		}
		walkStats.inScopeRecordCount += 1;
		const cellTextByPosition = READ_COLUMN_LIST.reduce((byPosition, oneColumn) => ({
			...byPosition,
			[oneColumn.position]: oneColumn.carriage === 'optionSet' ? trimmedLineList({ oneRecord, oneColumn }).join(LINE_SEPARATOR) : trimmedCellText({ oneRecord, oneColumn }),
		}), {});
		const entityName = cellTextByPosition[IDENTITY_COLUMN.entity.position];
		const categoryName = cellTextByPosition[IDENTITY_COLUMN.category.position];
		const elementName = cellTextByPosition[IDENTITY_COLUMN.name.position];
		if (entityName === '' || elementName === '') {
			throw refusal(`${originOf(oneRecord)}: an in-scope record with Entity ${JSON.stringify(entityName)} and Element Name ${JSON.stringify(elementName)}`, 'an element is named and belongs to an entity; neither is ever invented');
		}
		const identityText = JSON.stringify([entityName, categoryName, elementName]);
		if (elementGroupByIdentity[identityText] === undefined) {
			elementGroupByIdentity[identityText] = { entityName, categoryName, elementName, readRecordList: [] };
			elementGroupList.push(elementGroupByIdentity[identityText]);
		} else {
			walkStats.duplicateRecordCount += 1;
		}
		elementGroupByIdentity[identityText].readRecordList.push({ lineNumber: oneRecord.lineNumber, cellTextByPosition });
	});

	// agreedCellText — one agreeing column's text over an element's records (the duplicate rule)
	const agreedCellText = ({ elementGroup, oneColumn }) => {
		const cellTextList = elementGroup.readRecordList.map((oneRead) => oneRead.cellTextByPosition[oneColumn.position]);
		const distinctTextList = cellTextList.filter((oneText, textIndex) => cellTextList.indexOf(oneText) === textIndex);
		if (distinctTextList.length > 1) {
			throw refusal(
				`element (${elementGroup.entityName}, ${elementGroup.categoryName}, ${elementGroup.elementName}) column '${oneColumn.columnName}' differs across its records (${elementGroup.readRecordList.map((oneRead, recordIndex) => `line ${oneRead.lineNumber}: ${JSON.stringify(cellTextList[recordIndex])}`).join('; ')})`,
				'only a textList column may differ across an element\'s records; another column that differs needs its own ruling',
			);
		}
		return distinctTextList[0];
	};

	// 3. entities, elements, inline option sets, ETL edges
	const entityStableIdByName = {};
	const inlineValueListListByElementName = {};
	elementGroupList.forEach((elementGroup) => {
		const { entityName, categoryName, elementName } = elementGroup;
		const origin = `element (${entityName}, ${categoryName}, ${elementName}) from ${sourceProfile.csvFileName} line ${elementGroup.readRecordList.map((oneRead) => oneRead.lineNumber).join(', ')}`;
		if (entityStableIdByName[entityName] === undefined) {
			const entityStableId = sedmIdentity.entityStableIdOf({ entityName });
			kit.makeNode({
				role: DME_ROLES.CLASS,
				perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.CLASS],
				stableId: entityStableId,
				name: entityName,
				structural: { parentId: kit.rootStableId, path: entityName },
				origin,
			});
			kit.addEdge({ edgeType: EDGE_TYPES.HAS_CLASS, fromStableId: kit.rootStableId, toStableId: entityStableId, edgeContext: `root->${entityName}` });
			entityStableIdByName[entityName] = entityStableId;
		}
		const entityStableId = entityStableIdByName[entityName];
		const elementStableId = sedmIdentity.elementStableIdOf({ entityName, categoryName, elementName });

		// every agreeing column checked; text and membership columns carried under their property names
		AGREEING_CARRIAGE_LIST.forEach((carriage) => (columnListByCarriage[carriage] || []).forEach((oneColumn) => agreedCellText({ elementGroup, oneColumn })));
		const textCarriedProperties = (columnListByCarriage.text || []).concat(columnListByCarriage.membership || []).concat([IDENTITY_COLUMN.category])
			.reduce((carried, oneColumn) => {
				const cellText = agreedCellText({ elementGroup, oneColumn });
				return cellText === '' ? carried : { ...carried, [oneColumn.propertyName]: cellText };
			}, {});
		const listCarriedProperties = (columnListByCarriage.textList || []).reduce((carried, oneColumn) => {
			const cellTextList = elementGroup.readRecordList.map((oneRead) => oneRead.cellTextByPosition[oneColumn.position]).filter((cellText) => cellText !== '');
			const distinctTextList = cellTextList.filter((oneText, textIndex) => cellTextList.indexOf(oneText) === textIndex);
			// JSON strings, not lists: a one-entry list would be read back as a scalar (graph-contract §1)
			return distinctTextList.length === 0 ? carried : { ...carried, [oneColumn.propertyName]: JSON.stringify(distinctTextList) };
		}, {});
		const descriptionText = agreedCellText({ elementGroup, oneColumn: IDENTITY_COLUMN.description });
		kit.makeNode({
			role: DME_ROLES.PROPERTY,
			perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.PROPERTY],
			stableId: elementStableId,
			name: elementName,
			description: descriptionText === '' ? undefined : descriptionText,
			structural: { parentId: entityStableId, path: [entityName, categoryName, elementName].filter((oneText) => oneText !== '').join(PATH_SEPARATOR), owningName: entityName },
			carriedProperties: { ...textCarriedProperties, ...listCarriedProperties },
			origin,
		});
		kit.addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: entityStableId, toStableId: elementStableId, edgeContext: `${entityName}->${elementStableId}` });

		// the ETL template flags
		(columnListByCarriage.etlTemplate || []).forEach((oneColumn) => {
			const cellText = agreedCellText({ elementGroup, oneColumn });
			if (cellText === '') {
				return;
			}
			if (sourceProfile.etlTemplateCellTextList.indexOf(cellText) === -1) {
				throw refusal(`${origin}: ETL column '${oneColumn.columnName}' holds '${cellText}'`, `an ETL template flag is one of ${JSON.stringify(sourceProfile.etlTemplateCellTextList)} or empty`);
			}
			kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: elementStableId, toStableId: etlTemplateStableIdByColumnName[oneColumn.columnName], edgeContext: `${ETL_TEMPLATE_LOCATOR}:${elementStableId}->${oneColumn.columnName}`, edgeProperties: { locator: ETL_TEMPLATE_LOCATOR } });
			walkStats.etlReferenceEdgeCount += 1;
		});

		// the inline option set
		const optionSetText = agreedCellText({ elementGroup, oneColumn: IDENTITY_COLUMN.optionSet });
		if (optionSetText === '' || optionSetText === sourceProfile.noOptionSetCellText) {
			return;
		}
		const valueList = optionSetText.split(LINE_SEPARATOR).map((oneLine) => {
			const lineMatch = oneLine.match(optionLineRegex);
			return lineMatch === null ? { codeText: oneLine, valueName: oneLine } : { codeText: lineMatch[1].trim(), valueName: lineMatch[2].trim() };
		});
		const repeatedValue = valueList.find((oneValue, valueIndex) => valueList.findIndex((candidateValue) => candidateValue.codeText === oneValue.codeText) !== valueIndex);
		if (repeatedValue !== undefined) {
			throw refusal(`${origin}: option code '${repeatedValue.codeText}' is stated twice in one set`, 'no repeat rule is declared for SEDM option sets');
		}
		const optionSetStableId = sedmIdentity.elementOptionSetStableIdOf({ elementStableId });
		kit.makeNode({
			role: DME_ROLES.OPTION_SET,
			perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.OPTION_SET],
			stableId: optionSetStableId,
			// a set has no name of its own in the source; it is the set OF this element, so it takes the element's name
			name: elementName,
			structural: { parentId: elementStableId, path: `${[entityName, categoryName, elementName].filter((oneText) => oneText !== '').join(PATH_SEPARATOR)}${PATH_SEPARATOR}optionSet`, owningName: entityName },
			origin,
		});
		kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: elementStableId, toStableId: optionSetStableId, edgeContext: `${elementStableId}->optionSet` });
		valueList.forEach(({ codeText, valueName }) => {
			kit.emitOptionValue({
				optionSetStableId,
				optionValueStableId: sedmIdentity.elementOptionValueStableIdOf({ elementStableId, codeText }),
				perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.OPTION_VALUE],
				name: valueName,
				path: `${elementName}${PATH_SEPARATOR}${codeText}`,
				owningName: elementName,
				carriedProperties: { code: codeText },
				origin,
			});
		});
		inlineValueListListByElementName[elementName] = (inlineValueListListByElementName[elementName] || []).concat([valueList]);
	});
	// the restated-list check reads an element NAME: a name whose elements carry different sets restates nothing, so it is left out
	const inlineValueListByElementName = Object.keys(inlineValueListListByElementName)
		.filter((elementName) => new Set(inlineValueListListByElementName[elementName].map((oneValueList) => JSON.stringify(oneValueList))).size === 1)
		.reduce((byName, elementName) => ({ ...byName, [elementName]: inlineValueListListByElementName[elementName][0] }), {});

	// 4. the JSON's own code lists
	sedmStructuresWalk.emitDeclaredOptionSets({ structures, kit, walkStats, inlineValueListByElementName });

	Object.keys(walkStats).forEach((statName) => {
		kit.stats[statName] = walkStats[statName];
	});
	return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
};

module.exports = { emitContractGraph, PER_STANDARD_LABEL_BY_ROLE, moduleName };
