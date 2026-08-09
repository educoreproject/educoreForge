'use strict';

//START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ xsdFilePath }) => {
		const fs = require('fs');
		const sax = require('sax');
		const { xLog } = process.global;

		const anonymousTypeNamePrefix = 'anonymousComplexType#';

		// --------------------------------------------------------------------------
		// readElementInventory(): builds the XSD type graph.
		//
		//   globalElementsByName : elementName -> elementRecord
		//   complexTypesByName   : typeName    -> { childElementList, attributeList,
		//                                           baseTypeName, sifChar }
		//   elementRecord        : { elementName, typeName, minOccurs, maxOccurs,
		//                            sifChar, sourceLineNumber, isRepeatable }
		//
		// The parse is deliberately structural, not semantic: it records what the
		// schema says and resolves nothing. Resolution happens in
		// resolveContainerWitnessList, where an unresolvable path REFUSES BY NAME
		// instead of being reported as "no characteristic found" -- those two are
		// different facts and collapsing them would silently understate the finding.
		// --------------------------------------------------------------------------
		const readElementInventory = (callback) => {
			if (!fs.existsSync(xsdFilePath)) {
				callback(
					`[${moduleName}] the annotated XSD was not found at '${xsdFilePath}'. There is no alternative location and no default; supply the correct path.`,
				);
				return;
			}

			const globalElementsByName = new Map();
			const complexTypesByName = new Map();

			//openTagStack entries: { tagName, ownerRecord, ownerKind }
			const openTagStack = [];
			let anonymousTypeCounter = 0;
			let pendingTextTarget = '';
			let pendingText = '';
			let parseErrorString = '';

			const saxParser = sax.parser(true, { trim: true, position: true });

			const nearestOwner = (ownerKindList) => {
				for (
					let stackIndex = openTagStack.length - 1;
					stackIndex >= 0;
					stackIndex = stackIndex - 1
				) {
					if (ownerKindList.includes(openTagStack[stackIndex].ownerKind)) {
						return openTagStack[stackIndex];
					}
				}
				return null;
			};

			const enclosingComplexType = () => {
				const frame = nearestOwner(['complexType']);
				return frame ? frame.ownerRecord : null;
			};

			saxParser.onerror = (errorObject) => {
				parseErrorString = `[${moduleName}] the XSD at '${xsdFilePath}' is not well-formed XML: ${errorObject.message}. The audit refuses rather than reporting a partial inventory, because a partial inventory understates omissions and looks identical to a complete one.`;
				saxParser.resume();
			};

			saxParser.ontext = (textValue) => {
				if (pendingTextTarget) {
					pendingText = pendingText + textValue;
				}
			};

			saxParser.onopentag = (tagNode) => {
				const tagName = tagNode.name;
				const attributes = tagNode.attributes;
				const sourceLineNumber = saxParser.line + 1;

				let ownerKind = 'other';
				let ownerRecord = null;

				if (tagName === 'xs:complexType') {
					const declaredTypeName = attributes.name;
					const typeName = declaredTypeName
						? declaredTypeName
						: `${anonymousTypeNamePrefix}${(anonymousTypeCounter =
								anonymousTypeCounter + 1)}`;

					ownerRecord = {
						typeName,
						isAnonymous: !declaredTypeName,
						baseTypeName: '',
						childElementList: [],
						attributeList: [],
						sourceLineNumber,
					};
					complexTypesByName.set(typeName, ownerRecord);
					ownerKind = 'complexType';

					//an anonymous type belongs to the element that encloses it
					if (!declaredTypeName) {
						const ownerElementFrame = nearestOwner(['element']);
						if (ownerElementFrame) {
							ownerElementFrame.ownerRecord.typeName = typeName;
						}
					}
				} else if (tagName === 'xs:element') {
					//minOccurs and maxOccurs default to 1 BY THE XML SCHEMA SPECIFICATION.
					//These are the schema language's own declared defaults for an absent
					//attribute, not a substitution chosen here for missing input: an
					//element written without maxOccurs IS singular, and reading it as
					//singular is reading it correctly. Same for use="optional" on
					//xs:attribute below. Any other absent input in this module refuses.
					const maxOccursValue =
						attributes.maxOccurs === undefined ? '1' : attributes.maxOccurs;
					ownerRecord = {
						elementName: attributes.name || '',
						elementRef: attributes.ref || '',
						typeName: attributes.type || '',
						minOccurs:
							attributes.minOccurs === undefined ? '1' : attributes.minOccurs,
						maxOccurs: maxOccursValue,
						isRepeatable:
							maxOccursValue === 'unbounded' || Number(maxOccursValue) > 1,
						sifChar: '',
						sourceLineNumber,
					};
					ownerKind = 'element';

					const containingType = enclosingComplexType();
					if (containingType) {
						containingType.childElementList.push(ownerRecord);
					} else if (ownerRecord.elementName) {
						globalElementsByName.set(ownerRecord.elementName, ownerRecord);
					}
				} else if (tagName === 'xs:attribute') {
					ownerRecord = {
						attributeName: attributes.name || '',
						typeName: attributes.type || '',
						useFlag: attributes.use || 'optional',
						sifChar: '',
						sourceLineNumber,
					};
					ownerKind = 'attribute';
					const containingType = enclosingComplexType();
					if (containingType) {
						containingType.attributeList.push(ownerRecord);
					}
				} else if (tagName === 'xs:extension' || tagName === 'xs:restriction') {
					//A base= is only this complexType's base when the extension or
					//restriction sits DIRECTLY inside xs:complexContent/xs:simpleContent.
					//SIF nests an attribute's inline xs:simpleType several levels deep
					//inside an extension, and that inner <xs:restriction base="xs:token">
					//would otherwise overwrite the outer base and silently strip the type
					//of every inherited child.
					const parentFrame = openTagStack[openTagStack.length - 1];
					const parentTagName = parentFrame ? parentFrame.tagName : '';
					const isContentModelBase =
						parentTagName === 'xs:complexContent' ||
						parentTagName === 'xs:simpleContent';

					if (isContentModelBase) {
						const containingType = enclosingComplexType();
						if (containingType && attributes.base) {
							containingType.baseTypeName = attributes.base;
						}
					}
				} else if (tagName === 'sifChar') {
					pendingTextTarget = 'sifChar';
					pendingText = '';
				}

				openTagStack.push({ tagName, ownerRecord, ownerKind });
			};

			saxParser.onclosetag = () => {
				const closedFrame = openTagStack.pop();

				if (closedFrame && closedFrame.tagName === 'sifChar') {
					const annotatedFrame = nearestOwner([
						'element',
						'attribute',
						'complexType',
					]);
					if (annotatedFrame && annotatedFrame.ownerRecord) {
						annotatedFrame.ownerRecord.sifChar = pendingText.trim();
					}
					pendingTextTarget = '';
					pendingText = '';
				}
			};

			saxParser.onend = () => {
				if (parseErrorString) {
					callback(parseErrorString);
					return;
				}

				//Where an element declares an INLINE complexType, SIF places <sifChar>
				//inside that type's annotation rather than the element's, so the
				//characteristic lands on the type. It describes the element. Carry it
				//across, and only where the element states nothing itself, so an
				//explicit element-level value always wins.
				let sifCharCarriedFromInlineTypeCount = 0;
				const carryInlineTypeSifChar = (elementRecord) => {
					if (elementRecord.sifChar !== '' || !elementRecord.typeName) {
						return;
					}
					const typeRecord = complexTypesByName.get(elementRecord.typeName);
					if (typeRecord && typeRecord.isAnonymous && typeRecord.sifChar) {
						elementRecord.sifChar = typeRecord.sifChar;
						sifCharCarriedFromInlineTypeCount =
							sifCharCarriedFromInlineTypeCount + 1;
					}
				};
				globalElementsByName.forEach(carryInlineTypeSifChar);
				complexTypesByName.forEach((typeRecord) =>
					typeRecord.childElementList.forEach(carryInlineTypeSifChar),
				);
				xLog.verbose(
					`[${moduleName}] carried sifChar from an inline complexType onto its element in ${sifCharCarriedFromInlineTypeCount} case(s)`,
				);

				const namedComplexTypeCount = Array.from(
					complexTypesByName.values(),
				).filter((typeRecord) => !typeRecord.isAnonymous).length;

				let annotatedElementCount = 0;
				let repeatableElementCount = 0;
				complexTypesByName.forEach((typeRecord) => {
					typeRecord.childElementList.forEach((elementRecord) => {
						if (elementRecord.sifChar) {
							annotatedElementCount = annotatedElementCount + 1;
						}
						if (elementRecord.isRepeatable) {
							repeatableElementCount = repeatableElementCount + 1;
						}
					});
				});

				const sifCharDistribution = {};
				complexTypesByName.forEach((typeRecord) => {
					typeRecord.childElementList
						.concat(typeRecord.attributeList)
						.forEach((memberRecord) => {
							if (memberRecord.sifChar) {
								sifCharDistribution[memberRecord.sifChar] =
									(sifCharDistribution[memberRecord.sifChar] || 0) + 1;
							}
						});
				});

				callback('', {
					globalElementsByName,
					complexTypesByName,
					summary: {
						xsdFilePath,
						globalElementCount: globalElementsByName.size,
						namedComplexTypeCount,
						anonymousComplexTypeCount:
							complexTypesByName.size - namedComplexTypeCount,
						childElementDeclarationCount: Array.from(
							complexTypesByName.values(),
						).reduce(
							(runningTotal, typeRecord) =>
								runningTotal + typeRecord.childElementList.length,
							0,
						),
						annotatedElementCount,
						repeatableElementCount,
						sifCharDistribution,
					},
				});
			};

			const xsdText = fs.readFileSync(xsdFilePath, 'utf8');
			saxParser.write(xsdText).close();
		};

		// --------------------------------------------------------------------------
		// effectiveChildElementList(): a type's own children plus any inherited
		// through xs:complexContent/xs:extension. Guarded against a base-type cycle.
		// --------------------------------------------------------------------------
		const effectiveChildElementList = ({ complexTypesByName, typeName }) => {
			const visitedTypeNameSet = new Set();
			const collectedList = [];

			let currentTypeName = typeName;
			while (currentTypeName && !visitedTypeNameSet.has(currentTypeName)) {
				visitedTypeNameSet.add(currentTypeName);
				const typeRecord = complexTypesByName.get(currentTypeName);
				if (!typeRecord) {
					break;
				}
				typeRecord.childElementList.forEach((elementRecord) =>
					collectedList.push(elementRecord),
				);
				currentTypeName = typeRecord.baseTypeName;
			}
			return collectedList;
		};

		// --------------------------------------------------------------------------
		// resolveContainerWitnessList(): walks each omitted container path down the
		// type graph and reports what the XSD says about it.
		//
		// Three outcomes, kept strictly apart:
		//   resolved        - found in the XSD; its sifChar and maxOccurs are reported
		//   unresolved      - the path could not be walked; reported WITH the segment
		//                     that failed, never silently dropped
		// An unresolved path is not evidence of anything and is excluded from the
		// counts rather than being counted as "carries nothing".
		// --------------------------------------------------------------------------
		const resolveContainerWitnessList = (
			{ xsdInventory, containerList },
			callback,
		) => {
			const { globalElementsByName, complexTypesByName } = xsdInventory;

			if (!containerList) {
				callback(
					`[${moduleName}] resolveContainerWitnessList requires a containerList. It was not supplied and is not defaulted to empty, because an empty list and a missing list report identically downstream.`,
				);
				return;
			}

			const resolvedList = [];
			const unresolvedList = [];

			containerList.forEach((containerRecord) => {
				const segmentList = containerRecord.containerPath.slice(1).split('/');

				const rootElementRecord = globalElementsByName.get(segmentList[0]);
				if (!rootElementRecord) {
					unresolvedList.push({
						containerPath: containerRecord.containerPath,
						failedAtSegment: segmentList[0],
						reason: 'no global element of that name in the XSD',
					});
					return;
				}

				let currentElementRecord = rootElementRecord;
				let walkFailed = false;

				for (
					let segmentIndex = 1;
					segmentIndex < segmentList.length;
					segmentIndex = segmentIndex + 1
				) {
					const wantedElementName = segmentList[segmentIndex];
					const candidateList = effectiveChildElementList({
						complexTypesByName,
						typeName: currentElementRecord.typeName,
					});
					const matchedElementRecord = candidateList.find(
						(elementRecord) => elementRecord.elementName === wantedElementName,
					);

					if (!matchedElementRecord) {
						unresolvedList.push({
							containerPath: containerRecord.containerPath,
							failedAtSegment: wantedElementName,
							reason: `type '${currentElementRecord.typeName}' declares no child element of that name`,
						});
						walkFailed = true;
						break;
					}
					currentElementRecord = matchedElementRecord;
				}

				if (walkFailed) {
					return;
				}

				resolvedList.push({
					containerPath: containerRecord.containerPath,
					depth: containerRecord.depth,
					directChildRowCount: containerRecord.directChildRowCount,
					tableNameList: containerRecord.tableNameList,
					xsdTypeName: currentElementRecord.typeName,
					xsdSifChar: currentElementRecord.sifChar,
					xsdMinOccurs: currentElementRecord.minOccurs,
					xsdMaxOccurs: currentElementRecord.maxOccurs,
					isRepeatable: currentElementRecord.isRepeatable,
					xsdSourceLineNumber: currentElementRecord.sourceLineNumber,
				});
			});

			const carriesSifChar = resolvedList.filter(
				(witnessRecord) => witnessRecord.xsdSifChar !== '',
			);
			const isRepeatableList = resolvedList.filter(
				(witnessRecord) => witnessRecord.isRepeatable,
			);
			const repeatableSifCharDistribution = {};
			carriesSifChar.forEach((witnessRecord) => {
				repeatableSifCharDistribution[witnessRecord.xsdSifChar] =
					(repeatableSifCharDistribution[witnessRecord.xsdSifChar] || 0) + 1;
			});

			if (unresolvedList.length) {
				xLog.status(
					`[${moduleName}] ${unresolvedList.length} container path(s) could not be walked in the XSD; they are excluded from the counts and listed in the report, not treated as carrying nothing.`,
				);
			}

			callback('', {
				totals: {
					containersOffered: containerList.length,
					resolvedInXsd: resolvedList.length,
					unresolvedInXsd: unresolvedList.length,
					carryingASifCharValueLostToTheExport: carriesSifChar.length,
					repeatableAndInvisibleToTheExport: isRepeatableList.length,
					sifCharDistributionAmongOmitted: repeatableSifCharDistribution,
				},
				resolvedList,
				unresolvedList,
			});
		};

		return {
			readElementInventory,
			resolveContainerWitnessList,
			effectiveChildElementList,
		};
	};

//END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName: 'xsdElementInventory' });
