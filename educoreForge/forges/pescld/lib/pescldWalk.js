'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescldWalk.js — the H3 walk for the PESC_LD forge bundle (zeroBacklog lane C1). PURE: it reads the loader's verbatim records
// and the source profile, and mints through the kit only; a refusal is a thrown named Error under the framework's one adapter.
//
// THE MODEL (ruled in WORKORDER-C; identity is PESC-owned, evidence A6). A borrowed IRI is never a stableId:
//   DmeClass        one per shapes.csv record (a SHACL NodeShape)                        pescld:shape/<shapeID>
//   DmeProperty     one per distinct (shapeID, propertyID) TAP pair (a PropertyShape)    pescld:shape/<shapeID>/<propertyID>
//   DmeOptionSet    one per non-empty picklist cell                                      pescld:picklist/<shapeID>/<propertyID>
//   DmeOptionValue  one per distinct value of that picklist                              pescld:picklist/<shapeID>/<propertyID>/<value>
// Edges: root HAS_CLASS shape; shape HAS_PROPERTY property; property HAS_OPTION_SET picklist; picklist HAS_VALUE value;
// property REFERENCES shape for a valueShape (locator 'valueShape'), the one native reference the source makes.
//
// WHAT IS CARRIED, AND HOW (FBB-001: the forge resolves nothing). The term a shape targets and the term a TAP row constrains are
// the source's own words: termCurie exactly as written (after the whitespace rule), termIri expanded from the source's OWN
// namespaces.csv. A valueClass line is carried verbatim in crossRefs as { raw, locator: 'valueClass' } (the CTDL-family shape).
// No other standard is named here; a borrowed CURIE is data like any other.
//
// THE DECLARED RULES, each counted in stats (never silent):
//   whitespace   a cell's surrounding whitespace is trimmed (a line-list cell: each line); the trims are counted and listed;
//   duplicate    a (shape, property) pair stated in more than one TAP file is ONE node; every file it appears in is carried in
//                sourceTabs; a column whose cells disagree across those records is REFUSED unless the profile's
//                conflictResolutionList names it, and then both cell texts are carried in sourceValueConflicts;
//   repeat       a picklist value listed twice in one cell is ONE value node carrying listRepeatCount;
//   emptiness    a constraint type stated with an empty constraint cell is carried as valueConstraintDeclaredEmpty: true (three
//                empty picklists and one empty maxLength in snapshot 01), never dropped and never mistaken for no constraint.

const path = require('path');
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const sourceProfile = require('./pescldSourceProfile.json');

const STABLE_ID_PREFIX = 'pescld:';
const LINE_SEPARATOR = '\n';

// the per-standard label of each role (producer-local label stem PescLd, graph-contract §9)
const PER_STANDARD_LABEL_BY_ROLE = Object.freeze({
	[DME_ROLES.CLASS]: 'PescLdShape',
	[DME_ROLES.PROPERTY]: 'PescLdProperty',
	[DME_ROLES.OPTION_SET]: 'PescLdPicklist',
	[DME_ROLES.OPTION_VALUE]: 'PescLdPicklistValue',
});

const curieRegex = new RegExp(sourceProfile.curiePatternSource);
const tapColumnByName = sourceProfile.tapColumnList.reduce((byName, oneColumn) => ({ ...byName, [oneColumn.columnName]: oneColumn }), {});
const conflictResolutionByPairColumn = sourceProfile.conflictResolutionList.reduce(
	(byPairColumn, oneResolution) => ({ ...byPairColumn, [`${oneResolution.shapeID}|${oneResolution.propertyID}|${oneResolution.columnName}`]: oneResolution }),
	{},
);

const refusal = (what, where) => refuse.byName({ moduleName, what, where });

// -----------------------------------------------------------------
// emitContractGraph — { loaded: the loader's payload, kit } → { nodes, edges, stats }
// -----------------------------------------------------------------
const emitContractGraph = ({ loaded, kit }) => {
	const { shapeRecordList, tapRecordList, namespaceIriByPrefix } = loaded;
	const walkStats = {
		whitespaceTrimmedCellCount: 0,
		whitespaceTrimmedCellList: [],
		duplicateTapRecordCount: 0,
		conflictResolvedCount: 0,
		picklistRepeatCollapsedCount: 0,
		constraintDeclaredEmptyCount: 0,
		crossRefTotal: 0,
		shapeReferenceEdgeCount: 0,
	};

	// trimmedCellText — the whitespace rule for one single-value cell (absent column → '')
	const trimmedCellText = ({ oneRecord, columnName }) => {
		const rawText = oneRecord.cellByColumnName[columnName] === undefined ? '' : oneRecord.cellByColumnName[columnName];
		const trimmedText = rawText.trim();
		if (trimmedText !== rawText) {
			walkStats.whitespaceTrimmedCellCount += 1;
			walkStats.whitespaceTrimmedCellList.push({ sourceFileName: oneRecord.sourceFileName, lineNumber: oneRecord.lineNumber, columnName, rawText });
		}
		return trimmedText;
	};
	// trimmedLineList — the whitespace rule for a line-list cell: each line trimmed; an empty line inside a cell is refused
	const trimmedLineList = ({ oneRecord, columnName }) => {
		const rawText = oneRecord.cellByColumnName[columnName];
		if (rawText === '') {
			return [];
		}
		return rawText.split(LINE_SEPARATOR).map((rawLine) => {
			const trimmedLine = rawLine.trim();
			if (trimmedLine === '') {
				throw refusal(`'${oneRecord.sourceFileName}' line ${oneRecord.lineNumber} column '${columnName}' holds an empty line inside a list cell`, 'a list cell holds one entry per line; an empty entry is no entry and is never guessed at');
			}
			if (trimmedLine !== rawLine) {
				walkStats.whitespaceTrimmedCellCount += 1;
				walkStats.whitespaceTrimmedCellList.push({ sourceFileName: oneRecord.sourceFileName, lineNumber: oneRecord.lineNumber, columnName, rawText: rawLine });
			}
			return trimmedLine;
		});
	};
	// termPropertiesOf — { termCurie, termIri } for a CURIE the source writes; the prefix must be the source's own
	const termPropertiesOf = ({ curieText, origin }) => {
		const curieMatch = curieText.match(curieRegex);
		if (curieMatch === null) {
			throw refusal(`${origin}: '${curieText}' is not a CURIE (${sourceProfile.curiePatternSource})`, 'a term the source names is a CURIE under one of its namespaces.csv prefixes');
		}
		const namespaceIri = namespaceIriByPrefix[curieMatch[1]];
		if (namespaceIri === undefined) {
			throw refusal(`${origin}: prefix '${curieMatch[1]}' of '${curieText}' is not declared in ${sourceProfile.namespaceFileName}`, 'termIri is expanded from the source\'s own prefix table and never assumed');
		}
		return { termCurie: curieText, termIri: `${namespaceIri}${curieMatch[2]}` };
	};
	// columnCarriedProperties — the 'text' and 'boolean' columns of one record (or one merged cell map), absent when empty
	const columnCarriedProperties = ({ columnList, cellTextByColumnName, origin }) => columnList
		.filter((oneColumn) => (oneColumn.carriage === 'text' || oneColumn.carriage === 'boolean') && cellTextByColumnName[oneColumn.columnName] !== '')
		.reduce((carried, oneColumn) => {
			const cellText = cellTextByColumnName[oneColumn.columnName];
			if (oneColumn.carriage === 'text') {
				return { ...carried, [oneColumn.propertyName]: cellText };
			}
			if (sourceProfile.booleanByCellText[cellText] === undefined) {
				throw refusal(`${origin}: column '${oneColumn.columnName}' holds '${cellText}', not one of ${Object.keys(sourceProfile.booleanByCellText).join(', ')}`, 'a boolean column states TRUE or FALSE, or is empty (absent)');
			}
			return { ...carried, [oneColumn.propertyName]: sourceProfile.booleanByCellText[cellText] };
		}, {});

	// -----------------------------------------------------------------
	// 1. shapes — DmeClass, in shapes.csv order
	// -----------------------------------------------------------------
	const shapeById = {};
	shapeRecordList.forEach((oneRecord) => {
		const origin = `${oneRecord.sourceFileName} line ${oneRecord.lineNumber}`;
		const shapeID = oneRecord.cellByColumnName.shapeID;
		if (shapeID === '' || shapeID !== shapeID.trim()) {
			throw refusal(`${origin}: shapeID ${JSON.stringify(shapeID)} is empty or carries whitespace`, 'a shapeID is an identity and is never repaired');
		}
		if (shapeById[shapeID] !== undefined) {
			throw refusal(`${origin}: shapeID '${shapeID}' is stated twice (first at line ${shapeById[shapeID].lineNumber})`, 'one record per shape');
		}
		const cellTextByColumnName = sourceProfile.shapeColumnList.reduce((byName, oneColumn) => ({ ...byName, [oneColumn.columnName]: trimmedCellText({ oneRecord, columnName: oneColumn.columnName }) }), {});
		const stableId = `${STABLE_ID_PREFIX}shape/${shapeID}`;
		const name = cellTextByColumnName.label;
		kit.makeNode({
			role: DME_ROLES.CLASS,
			perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.CLASS],
			stableId,
			name: name === '' ? undefined : name,
			structural: { parentId: kit.rootStableId, path: shapeID },
			carriedProperties: {
				...(cellTextByColumnName.target === '' ? {} : termPropertiesOf({ curieText: cellTextByColumnName.target, origin })),
				...columnCarriedProperties({ columnList: sourceProfile.shapeColumnList, cellTextByColumnName, origin }),
			},
			origin,
		});
		kit.addEdge({ edgeType: EDGE_TYPES.HAS_CLASS, fromStableId: kit.rootStableId, toStableId: stableId, edgeContext: `root->${shapeID}` });
		shapeById[shapeID] = { stableId, name, lineNumber: oneRecord.lineNumber };
	});

	// -----------------------------------------------------------------
	// 2. TAP records grouped by (shapeID, propertyID), in profile file order then record order
	// -----------------------------------------------------------------
	const pairGroupList = [];
	const pairGroupByPairId = {};
	tapRecordList.forEach((oneRecord) => {
		const origin = `${oneRecord.sourceFileName} line ${oneRecord.lineNumber}`;
		const shapeID = oneRecord.cellByColumnName.shapeID;
		if (shapeById[shapeID] === undefined) {
			throw refusal(`${origin}: shapeID '${shapeID}' is not a ${sourceProfile.shapeFileName} shape`, 'every TAP record constrains a declared shape');
		}
		const propertyID = trimmedCellText({ oneRecord, columnName: 'propertyID' });
		const pairId = `${shapeID}|${propertyID}`;
		if (pairGroupByPairId[pairId] === undefined) {
			pairGroupByPairId[pairId] = { shapeID, propertyID, recordList: [] };
			pairGroupList.push(pairGroupByPairId[pairId]);
		} else {
			walkStats.duplicateTapRecordCount += 1;
		}
		pairGroupByPairId[pairId].recordList.push(oneRecord);
	});

	// mergedCellTextOf — one column's cell text over a pair's records: equal texts merge; differing texts are a conflict,
	// refused unless the profile resolves it. Returns { cellText, conflict? }
	const mergedCellTextOf = ({ pairGroup, columnName, cellTextList }) => {
		const distinctTextList = cellTextList.filter((oneText, textIndex) => cellTextList.indexOf(oneText) === textIndex);
		if (distinctTextList.length === 1) {
			return { cellText: distinctTextList[0] };
		}
		const resolution = conflictResolutionByPairColumn[`${pairGroup.shapeID}|${pairGroup.propertyID}|${columnName}`];
		if (resolution === undefined) {
			throw refusal(
				`(${pairGroup.shapeID}, ${pairGroup.propertyID}) column '${columnName}' differs across its records (${pairGroup.recordList.map((oneRecord, recordIndex) => `${oneRecord.sourceFileName}: ${JSON.stringify(cellTextList[recordIndex])}`).join('; ')})`,
				`a conflict is carried only under a ${'conflictResolutionList'} row in pescldSourceProfile.json naming its resolution`,
			);
		}
		walkStats.conflictResolvedCount += 1;
		return {
			cellText: resolution.resolvedCellText,
			conflict: { columnName, cellTextBySourceFileName: pairGroup.recordList.reduce((byFile, oneRecord, recordIndex) => ({ ...byFile, [oneRecord.sourceFileName]: cellTextList[recordIndex] }), {}), resolvedCellText: resolution.resolvedCellText },
		};
	};

	pairGroupList.forEach((pairGroup) => {
		const { shapeID, propertyID } = pairGroup;
		const origin = `(${shapeID}, ${propertyID}) from ${pairGroup.recordList.map((oneRecord) => `${oneRecord.sourceFileName} line ${oneRecord.lineNumber}`).join(', ')}`;
		const shape = shapeById[shapeID];
		const stableId = `${STABLE_ID_PREFIX}shape/${shapeID}/${propertyID}`;

		// single-value columns merged across the pair's records; list cells merged as their joined trimmed lines
		const conflictList = [];
		const cellTextByColumnName = sourceProfile.tapColumnList
			.filter((oneColumn) => oneColumn.carriage !== 'notCarried' && oneColumn.carriage !== 'ownerIdentity' && oneColumn.carriage !== 'identityAndTermCurie')
			.reduce((byName, oneColumn) => {
				const isListColumn = oneColumn.carriage === 'crossRefLines' || (oneColumn.carriage === 'byConstraintType' && pairGroup.recordList.some((oneRecord) => oneRecord.cellByColumnName.valueConstraintType === 'picklist'));
				// a record from a file WITHOUT the column (Severity exists in summary-related-tap.csv alone) states nothing in it
				const statingRecordList = pairGroup.recordList.filter((oneRecord) => oneRecord.cellByColumnName[oneColumn.columnName] !== undefined);
				if (statingRecordList.length === 0) {
					return { ...byName, [oneColumn.columnName]: '' };
				}
				const cellTextList = statingRecordList.map((oneRecord) => (isListColumn ? trimmedLineList({ oneRecord, columnName: oneColumn.columnName }).join(LINE_SEPARATOR) : trimmedCellText({ oneRecord, columnName: oneColumn.columnName })));
				const merged = mergedCellTextOf({ pairGroup: { ...pairGroup, recordList: statingRecordList }, columnName: oneColumn.columnName, cellTextList });
				if (merged.conflict !== undefined) {
					conflictList.push(merged.conflict);
				}
				return { ...byName, [oneColumn.columnName]: merged.cellText };
			}, {});
		const name = cellTextByColumnName.propertyLabel;

		// the constraint, by its declared type
		const constraintType = cellTextByColumnName.valueConstraintType;
		const constraintCarriage = sourceProfile.constraintCarriageByType[constraintType];
		if (constraintCarriage === undefined) {
			throw refusal(`${origin}: valueConstraintType '${constraintType}' is not in the source profile (known: ${Object.keys(sourceProfile.constraintCarriageByType).map((oneType) => JSON.stringify(oneType)).join(', ')})`, 'add the type to constraintCarriageByType with its carriage');
		}
		const constraintText = cellTextByColumnName.valueConstraint;
		const isConstraintDeclaredEmpty = constraintType !== '' && constraintText === '';
		if (isConstraintDeclaredEmpty) {
			walkStats.constraintDeclaredEmptyCount += 1;
		}

		// valueClass lines: crossRefs, verbatim, each once
		const valueClassLineList = cellTextByColumnName.valueClass === '' ? [] : cellTextByColumnName.valueClass.split(LINE_SEPARATOR);
		const repeatedValueClass = valueClassLineList.find((oneLine, lineIndex) => valueClassLineList.indexOf(oneLine) !== lineIndex);
		if (repeatedValueClass !== undefined) {
			throw refusal(`${origin}: valueClass lists '${repeatedValueClass}' twice`, 'no repeat rule is declared for valueClass; the picklist repeat rule does not extend to it');
		}
		const crossRefList = valueClassLineList.map((oneLine) => ({ raw: oneLine, locator: 'valueClass' }));
		walkStats.crossRefTotal += crossRefList.length;

		kit.makeNode({
			role: DME_ROLES.PROPERTY,
			perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.PROPERTY],
			stableId,
			name: name === '' ? undefined : name,
			structural: { parentId: shape.stableId, path: `${shapeID}.${propertyID}`, owningName: shape.name },
			carriedProperties: {
				...termPropertiesOf({ curieText: propertyID, origin }),
				...columnCarriedProperties({ columnList: sourceProfile.tapColumnList, cellTextByColumnName, origin }),
				...(constraintCarriage === 'scalar' && constraintText !== '' ? { [sourceProfile.constraintScalarPropertyName]: constraintText } : {}),
				...(isConstraintDeclaredEmpty ? { valueConstraintDeclaredEmpty: true } : {}),
				// JSON strings, not lists: a one-entry list would be read back as a scalar (graph-contract §1)
				sourceTabs: JSON.stringify(pairGroup.recordList.map((oneRecord) => oneRecord.sourceFileName)),
				...(conflictList.length !== 0 ? { sourceValueConflicts: JSON.stringify(conflictList) } : {}),
				...(crossRefList.length !== 0 ? { crossRefs: JSON.stringify(crossRefList) } : {}),
			},
			origin,
		});
		kit.addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: shape.stableId, toStableId: stableId, edgeContext: `${shapeID}->${propertyID}` });

		// valueShape: the one native reference, an edge to the shape it names
		const valueShapeID = cellTextByColumnName.valueShape;
		if (valueShapeID !== '') {
			if (shapeById[valueShapeID] === undefined) {
				throw refusal(`${origin}: valueShape '${valueShapeID}' is not a ${sourceProfile.shapeFileName} shape`, 'a valueShape names a declared shape');
			}
			kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: stableId, toStableId: shapeById[valueShapeID].stableId, edgeContext: `valueShape:${shapeID}.${propertyID}->${valueShapeID}`, edgeProperties: { locator: 'valueShape' } });
			walkStats.shapeReferenceEdgeCount += 1;
		}

		// a non-empty picklist: one option set, one value node per distinct value (the repeat rule)
		if (constraintCarriage === 'picklist' && constraintText !== '') {
			const picklistStableId = `${STABLE_ID_PREFIX}picklist/${shapeID}/${propertyID}`;
			kit.makeNode({
				role: DME_ROLES.OPTION_SET,
				perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.OPTION_SET],
				stableId: picklistStableId,
				// a picklist has no name of its own in the source; it is the picklist OF this row, so it takes the row's label
				name: name === '' ? undefined : name,
				structural: { parentId: stableId, path: `${shapeID}.${propertyID}.picklist`, owningName: shape.name },
				origin,
			});
			kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: stableId, toStableId: picklistStableId, edgeContext: `${shapeID}.${propertyID}->picklist` });
			// the merged cell is the FIRST record's lines when the records agree (mergedCellTextOf), so repeats are counted there
			const valueLineList = constraintText.split(LINE_SEPARATOR);
			const distinctValueList = valueLineList.filter((oneLine, lineIndex) => valueLineList.indexOf(oneLine) === lineIndex);
			distinctValueList.forEach((valueText) => {
				const listRepeatCount = valueLineList.filter((oneLine) => oneLine === valueText).length;
				if (listRepeatCount > 1) {
					walkStats.picklistRepeatCollapsedCount += listRepeatCount - 1;
				}
				kit.emitOptionValue({
					optionSetStableId: picklistStableId,
					optionValueStableId: `${picklistStableId}/${valueText}`,
					perStandardLabel: PER_STANDARD_LABEL_BY_ROLE[DME_ROLES.OPTION_VALUE],
					name: valueText,
					path: `${shapeID}.${propertyID}.picklist.${valueText}`,
					owningName: name,
					carriedProperties: {
						// a bare literal (the Name Suffix values JR, SR, …) is no CURIE and carries no term
						...(curieRegex.test(valueText) ? termPropertiesOf({ curieText: valueText, origin }) : {}),
						...(listRepeatCount > 1 ? { listRepeatCount } : {}),
					},
					origin,
				});
			});
		}
	});

	Object.keys(walkStats).forEach((statName) => {
		kit.stats[statName] = walkStats[statName];
	});
	return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
};

module.exports = { emitContractGraph, PER_STANDARD_LABEL_BY_ROLE, moduleName };
