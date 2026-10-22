'use strict';

//START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		const { xLog } = process.global;

		const attributeSegmentPrefix = '@';

		// --------------------------------------------------------------------------
		// splitElementPath(): '/A/B/@C' -> ['A','B','@C']. A leading slash is required;
		// anything else refuses by name rather than being coerced into a shape.
		// --------------------------------------------------------------------------
		// UNREACHABLE BY CONSTRUCTION: tsvRowInventory refuses a non-absolute XPath at
		// read time and reports it by line number, so no such path reaches here. The
		// guard remains as a hard stop rather than a recovery, because a mis-rooted
		// path would corrupt every ancestor derivation downstream in a way that looks
		// like data. It throws rather than calling back because a caller that has
		// reached this point has already violated the module's stated precondition.
		const splitElementPath = (elementPath) => {
			if (elementPath.charAt(0) !== '/') {
				throw new Error(
					`[${moduleName}] xpath '${elementPath}' does not begin with '/'. The export's XPath column is absolute; a relative path is not interpretable and is not defaulted. This should have been refused by tsvRowInventory.`,
				);
			}
			return elementPath.slice(1).split('/');
		};

		// --------------------------------------------------------------------------
		// ancestorPathList(): every proper ancestor of a row's xpath, shallowest first.
		// An attribute segment can never be an ancestor, so it is simply the last
		// segment and contributes nothing of its own.
		// --------------------------------------------------------------------------
		const ancestorPathList = (elementPath) => {
			const segmentList = splitElementPath(elementPath);
			const resultList = [];
			for (
				let segmentCount = 1;
				segmentCount < segmentList.length;
				segmentCount = segmentCount + 1
			) {
				resultList.push('/' + segmentList.slice(0, segmentCount).join('/'));
			}
			return resultList;
		};

		const pathDepth = (elementPath) => splitElementPath(elementPath).length;

		const isAttributePath = (elementPath) => {
			const segmentList = splitElementPath(elementPath);
			return (
				segmentList[segmentList.length - 1].charAt(0) === attributeSegmentPrefix
			);
		};

		// --------------------------------------------------------------------------
		// buildReport(): the whole TSV-internal finding.
		//
		// A container is any element path that at least one row names as an ancestor.
		// It is OMITTED when no row of its own exists. The report deliberately splits
		// depth 1 and 2 (collection root and object item — structurally never given
		// rows by this export format) from depth 3 and deeper, which is the class
		// errata S-1 is about. Merging them would inflate the headline number with a
		// property of the format rather than a loss.
		// --------------------------------------------------------------------------
		const buildReport = ({ rowList }, callback) => {
			if (!rowList || !rowList.length) {
				callback(
					`[${moduleName}] the row inventory is empty. An empty inventory is refused rather than reported as 'no omissions found', because the two are indistinguishable downstream.`,
				);
				return;
			}

			const declaredRowPathSet = new Set();
			const rowByPath = new Map();
			rowList.forEach((rowItem) => {
				declaredRowPathSet.add(rowItem.rowXpath);
				if (!rowByPath.has(rowItem.rowXpath)) {
					rowByPath.set(rowItem.rowXpath, rowItem);
				}
			});

			//impliedContainer -> { directChildRowCount, tableNameSet, exampleChildPath }
			const impliedContainerMap = new Map();

			rowList.forEach((rowItem) => {
				const ancestorList = ancestorPathList(rowItem.rowXpath);
				ancestorList.forEach((ancestorPath) => {
					if (!impliedContainerMap.has(ancestorPath)) {
						impliedContainerMap.set(ancestorPath, {
							containerPath: ancestorPath,
							depth: pathDepth(ancestorPath),
							directChildRowCount: 0,
							directChildElementRowCount: 0,
							directChildAttributeRowCount: 0,
							descendantRowCount: 0,
							tableNameSet: new Set(),
							exampleChildPath: '',
						});
					}
					const containerRecord = impliedContainerMap.get(ancestorPath);
					containerRecord.descendantRowCount =
						containerRecord.descendantRowCount + 1;
					containerRecord.tableNameSet.add(rowItem.tableName);
					if (
						pathDepth(rowItem.rowXpath) ===
						pathDepth(ancestorPath) + 1
					) {
						containerRecord.directChildRowCount =
							containerRecord.directChildRowCount + 1;

						//An element child and an attribute child mean different things.
						//An element whose only children are attributes is a VALUE-BEARING
						//field that happens to be attributed; an element with element
						//children is a genuine structural container. Conflating the two
						//is what would turn a format limitation into a false defect claim.
						if (isAttributePath(rowItem.rowXpath)) {
							containerRecord.directChildAttributeRowCount =
								containerRecord.directChildAttributeRowCount + 1;
						} else {
							containerRecord.directChildElementRowCount =
								containerRecord.directChildElementRowCount + 1;
						}

						if (containerRecord.exampleChildPath === '') {
							containerRecord.exampleChildPath = rowItem.rowXpath;
						}
					}
				});
			});

			// ----------------------------------------------------------------------
			// Classify each container over ALL element paths, not merely over paths
			// that happen to carry a row.
			//
			// The earlier form counted direct child ROWS. That silently misclassified
			// a pure container whose own children are also pure containers: having no
			// child rows at all, it scored zero element children and was filed as
			// value-bearing. The universe must therefore be every element path known
			// to exist -- rows plus implied containers -- so that a container is
			// recognized by what the source SAYS is under it, not by which of those
			// things the export chose to give a row.
			// ----------------------------------------------------------------------
			const allElementPathSet = new Set();
			rowList.forEach((rowItem) => {
				if (!isAttributePath(rowItem.rowXpath)) {
					allElementPathSet.add(rowItem.rowXpath);
				}
			});
			impliedContainerMap.forEach((containerRecord) =>
				allElementPathSet.add(containerRecord.containerPath),
			);

			const parentPathOf = (elementPath) => {
				const segmentList = splitElementPath(elementPath);
				return segmentList.length <= 1
					? ''
					: '/' + segmentList.slice(0, segmentList.length - 1).join('/');
			};

			const directElementChildCountByParent = new Map();
			allElementPathSet.forEach((elementPath) => {
				const parentPath = parentPathOf(elementPath);
				if (parentPath) {
					directElementChildCountByParent.set(
						parentPath,
						(directElementChildCountByParent.get(parentPath) || 0) + 1,
					);
				}
			});

			impliedContainerMap.forEach((containerRecord) => {
				containerRecord.directChildElementPathCount =
					directElementChildCountByParent.get(containerRecord.containerPath) || 0;
			});

			const impliedContainerList = Array.from(impliedContainerMap.values()).map(
				(containerRecord) => ({
					containerPath: containerRecord.containerPath,
					depth: containerRecord.depth,
					directChildRowCount: containerRecord.directChildRowCount,
					directChildElementRowCount: containerRecord.directChildElementRowCount,
					directChildAttributeRowCount:
						containerRecord.directChildAttributeRowCount,
					directChildElementPathCount:
						containerRecord.directChildElementPathCount,
					//A structural container has at least one ELEMENT child, whether or
					//not that child was itself given a row. An element whose only
					//children are attributes is a value-bearing field that happens to
					//be attributed.
					isStructuralContainer:
						containerRecord.directChildElementPathCount > 0,
					descendantRowCount: containerRecord.descendantRowCount,
					tableNameList: Array.from(containerRecord.tableNameSet).sort(),
					exampleChildPath: containerRecord.exampleChildPath,
					hasOwnRow: declaredRowPathSet.has(containerRecord.containerPath),
				}),
			);

			const omittedContainerList = impliedContainerList
				.filter((containerRecord) => !containerRecord.hasOwnRow)
				.sort((left, right) =>
					left.containerPath.localeCompare(right.containerPath),
				);

			//The counterexample set. If NO container anywhere carries its own row, the
			//omission is a uniform format property. If some do and some do not, the
			//pattern is selective and that is a different finding entirely.
			const representedContainerList = impliedContainerList
				.filter((containerRecord) => containerRecord.hasOwnRow)
				.map((containerRecord) => ({
					...containerRecord,
					characteristics: (rowByPath.get(containerRecord.containerPath) || {})
						.characteristics,
				}))
				.sort((left, right) =>
					left.containerPath.localeCompare(right.containerPath),
				);

			const byDepth = (recordList) => {
				const depthMap = new Map();
				recordList.forEach((containerRecord) => {
					const depthLabel =
						containerRecord.depth >= 3 ? 'intermediate' : `depth${containerRecord.depth}`;
					depthMap.set(depthLabel, (depthMap.get(depthLabel) || 0) + 1);
				});
				return Object.fromEntries(Array.from(depthMap.entries()).sort());
			};

			const intermediateOmittedList = omittedContainerList.filter(
				(containerRecord) => containerRecord.depth >= 3,
			);
			const intermediateRepresentedList = representedContainerList.filter(
				(containerRecord) => containerRecord.depth >= 3,
			);

			const attributeRowCount = rowList.filter((rowItem) =>
				isAttributePath(rowItem.rowXpath),
			).length;

			//THE DECIDING CROSS-TAB. Restricted to intermediate depth, it asks whether
			//"has its own row" is predicted by "is a structural container". If every
			//structural container lacks a row and every value-bearing element has one,
			//the omission is a uniform property of the export FORMAT. If the cells are
			//mixed, the export is inconsistent with itself and that is a different and
			//much stronger claim. The two must never be reported as the same finding.
			const intermediateList = impliedContainerList.filter(
				(containerRecord) => containerRecord.depth >= 3,
			);
			const structureVersusRowCrossTab = {
				structuralContainer_withOwnRow: intermediateList.filter(
					(record) => record.isStructuralContainer && record.hasOwnRow,
				).length,
				structuralContainer_noOwnRow: intermediateList.filter(
					(record) => record.isStructuralContainer && !record.hasOwnRow,
				).length,
				valueBearingElement_withOwnRow: intermediateList.filter(
					(record) => !record.isStructuralContainer && record.hasOwnRow,
				).length,
				valueBearingElement_noOwnRow: intermediateList.filter(
					(record) => !record.isStructuralContainer && !record.hasOwnRow,
				).length,
			};

			callback('', {
				structureVersusRowCrossTab,
				totals: {
					rowCount: rowList.length,
					attributeRowCount,
					elementRowCount: rowList.length - attributeRowCount,
					distinctRowPathCount: declaredRowPathSet.size,
					impliedContainerCount: impliedContainerList.length,
					omittedContainerCount: omittedContainerList.length,
					representedContainerCount: representedContainerList.length,
				},
				omittedByDepth: byDepth(omittedContainerList),
				representedByDepth: byDepth(representedContainerList),
				intermediateOmittedList,
				intermediateRepresentedList,
				omittedContainerList,
				representedContainerList,
			});
		};

		return { buildReport, ancestorPathList, pathDepth, splitElementPath };
	};

//END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName: 'containerOmissionReport' });
