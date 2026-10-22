'use strict';

//START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ xsdElementInventory }) => {
		const { xLog } = process.global;

		// --------------------------------------------------------------------------
		// expandXsdSubtree(): every element and attribute path the XSD declares
		// beneath one root, as the export would have had to name them.
		//
		// RECURSION GUARD: SIF's type graph contains types that reach themselves.
		// A type already open on the CURRENT path is not descended into again, and
		// each such stop is RECORDED rather than silently dropped, so a reader can
		// see exactly where the expansion chose to stop and how much it may
		// therefore undercount. A truncation nobody can see is indistinguishable
		// from a complete traversal, which is the failure this whole audit is about.
		// --------------------------------------------------------------------------
		const expandXsdSubtree = ({
			complexTypesByName,
			rootElementRecord,
			rootPath,
			maximumDepth,
		}) => {
			const elementPathList = [];
			const attributePathList = [];
			const recursionStopList = [];

			const descend = ({ elementRecord, currentPath, openTypeNameList }) => {
				const typeRecord = complexTypesByName.get(elementRecord.typeName);
				if (!typeRecord) {
					return;
				}

				typeRecord.attributeList.forEach((attributeRecord) => {
					if (attributeRecord.attributeName) {
						attributePathList.push({
							elementPath: `${currentPath}/@${attributeRecord.attributeName}`,
							sifChar: attributeRecord.sifChar,
						});
					}
				});

				const childList = xsdElementInventory.effectiveChildElementList({
					complexTypesByName,
					typeName: elementRecord.typeName,
				});

				childList.forEach((childElementRecord) => {
					if (!childElementRecord.elementName) {
						return;
					}
					const childPath = `${currentPath}/${childElementRecord.elementName}`;
					elementPathList.push({
						elementPath: childPath,
						sifChar: childElementRecord.sifChar,
						isRepeatable: childElementRecord.isRepeatable,
						xsdSourceLineNumber: childElementRecord.sourceLineNumber,
					});

					if (currentPath.split('/').length >= maximumDepth) {
						recursionStopList.push({
							elementPath: childPath,
							reason: `maximum depth ${maximumDepth} reached`,
						});
						return;
					}

					if (openTypeNameList.includes(childElementRecord.typeName)) {
						recursionStopList.push({
							elementPath: childPath,
							reason: `type '${childElementRecord.typeName}' is already open on this path`,
						});
						return;
					}

					descend({
						elementRecord: childElementRecord,
						currentPath: childPath,
						openTypeNameList: openTypeNameList.concat([
							childElementRecord.typeName,
						]),
					});
				});

				//attributes declared inside an inherited base type
				let baseTypeName = typeRecord.baseTypeName;
				const visitedBaseNameSet = new Set([elementRecord.typeName]);
				while (baseTypeName && !visitedBaseNameSet.has(baseTypeName)) {
					visitedBaseNameSet.add(baseTypeName);
					const baseTypeRecord = complexTypesByName.get(baseTypeName);
					if (!baseTypeRecord) {
						break;
					}
					baseTypeRecord.attributeList.forEach((attributeRecord) => {
						if (attributeRecord.attributeName) {
							attributePathList.push({
								elementPath: `${currentPath}/@${attributeRecord.attributeName}`,
								sifChar: attributeRecord.sifChar,
							});
						}
					});
					baseTypeName = baseTypeRecord.baseTypeName;
				}
			};

			descend({
				elementRecord: rootElementRecord,
				currentPath: rootPath,
				openTypeNameList: [rootElementRecord.typeName],
			});

			return { elementPathList, attributePathList, recursionStopList };
		};

		// --------------------------------------------------------------------------
		// buildDiff(): the literal systematic comparison, in BOTH directions.
		//
		//   declaredInXsdButNoExportRow - the omission set. Split into containers
		//     (already characterized by the S-1 analysis) and LEAF fields, which
		//     would be a different and worse class.
		//   exportRowWithNoXsdDeclaration - drift. The export naming something the
		//     schema does not declare.
		// --------------------------------------------------------------------------
		const buildDiff = (
			{ xsdInventory, rowList, maximumDepth },
			callback,
		) => {
			if (!maximumDepth || maximumDepth < 3) {
				callback(
					`[${moduleName}] maximumDepth must be supplied and be at least 3; got '${maximumDepth}'. It is not defaulted, because a silently shallow expansion would report missing elements that were merely never visited.`,
				);
				return;
			}

			const { globalElementsByName, complexTypesByName } = xsdInventory;

			const exportRowPathSet = new Set(rowList.map((rowItem) => rowItem.rowXpath));

			//the 159 object roots, taken from the export's own depth-1 segments
			const rootNameSet = new Set(
				rowList.map((rowItem) => rowItem.rowXpath.split('/')[1]),
			);

			const xsdElementPathMap = new Map();
			const xsdAttributePathMap = new Map();
			const allRecursionStopList = [];
			const rootsNotInXsdList = [];

			rootNameSet.forEach((rootName) => {
				const rootElementRecord = globalElementsByName.get(rootName);
				if (!rootElementRecord) {
					rootsNotInXsdList.push(rootName);
					return;
				}
				const expansion = expandXsdSubtree({
					complexTypesByName,
					rootElementRecord,
					rootPath: `/${rootName}`,
					maximumDepth,
				});
				expansion.elementPathList.forEach((item) => {
					if (!xsdElementPathMap.has(item.elementPath)) {
						xsdElementPathMap.set(item.elementPath, item);
					}
				});
				expansion.attributePathList.forEach((item) => {
					if (!xsdAttributePathMap.has(item.elementPath)) {
						xsdAttributePathMap.set(item.elementPath, item);
					}
				});
				expansion.recursionStopList.forEach((item) =>
					allRecursionStopList.push(item),
				);
			});

			//an XSD element path is a CONTAINER when the XSD declares children under it
			const xsdParentPathSet = new Set();
			Array.from(xsdElementPathMap.keys()).forEach((elementPath) => {
				const segmentList = elementPath.split('/');
				segmentList.pop();
				xsdParentPathSet.add(segmentList.join('/'));
			});

			const declaredInXsdButNoExportRow = [];
			xsdElementPathMap.forEach((item, elementPath) => {
				if (!exportRowPathSet.has(elementPath)) {
					declaredInXsdButNoExportRow.push({
						...item,
						isContainerInXsd: xsdParentPathSet.has(elementPath),
					});
				}
			});
			xsdAttributePathMap.forEach((item, elementPath) => {
				if (!exportRowPathSet.has(elementPath)) {
					declaredInXsdButNoExportRow.push({
						...item,
						isContainerInXsd: false,
						isAttribute: true,
					});
				}
			});

			const exportRowWithNoXsdDeclaration = rowList
				.filter(
					(rowItem) =>
						!xsdElementPathMap.has(rowItem.rowXpath) &&
						!xsdAttributePathMap.has(rowItem.rowXpath),
				)
				.map((rowItem) => ({
					rowXpath: rowItem.rowXpath,
					tableName: rowItem.tableName,
					sourceLineNumber: rowItem.sourceLineNumber,
				}));

			const missingLeafList = declaredInXsdButNoExportRow.filter(
				(item) => !item.isContainerInXsd && !item.isAttribute,
			);
			const missingAttributeList = declaredInXsdButNoExportRow.filter(
				(item) => item.isAttribute,
			);
			const missingContainerList = declaredInXsdButNoExportRow.filter(
				(item) => item.isContainerInXsd,
			);

			if (allRecursionStopList.length) {
				xLog.status(
					`[${moduleName}] expansion stopped at ${allRecursionStopList.length} point(s) on recursion or depth; each is listed in the report so the undercount is visible.`,
				);
			}

			callback('', {
				totals: {
					objectRootsInExport: rootNameSet.size,
					objectRootsNotFoundInXsd: rootsNotInXsdList.length,
					xsdElementPathCount: xsdElementPathMap.size,
					xsdAttributePathCount: xsdAttributePathMap.size,
					exportRowCount: rowList.length,
					declaredInXsdButNoExportRow: declaredInXsdButNoExportRow.length,
					ofThose_containers: missingContainerList.length,
					ofThose_leafElements: missingLeafList.length,
					ofThose_attributes: missingAttributeList.length,
					exportRowWithNoXsdDeclaration: exportRowWithNoXsdDeclaration.length,
					expansionStoppedCount: allRecursionStopList.length,
				},
				rootsNotInXsdList,
				missingLeafSample: missingLeafList.slice(0, 40),
				missingAttributeSample: missingAttributeList.slice(0, 40),
				exportRowWithNoXsdDeclarationSample:
					exportRowWithNoXsdDeclaration.slice(0, 40),
				recursionStopSample: allRecursionStopList.slice(0, 25),
			});
		};

		return { buildDiff, expandXsdSubtree };
	};

//END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName: 'bidirectionalInventoryDiff' });
