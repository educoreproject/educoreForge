'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiDereferencedWalk.js — the H3 walk of the OpenAPI kit for the dereferencedMultiFile layout (nextStandards-102326 K1, ruled by
// BRONZE_CROWN 2026-10-24 with SILVER_SPIRE's amendments). PURE: it reads the loader's documents and the bundle's profile and mints through
// the framework kit only; a refusal is a thrown named Error under the framework's one adapter (the K0 walk's form).
//
// THE SOURCE: one data model spread over one or more OpenAPI files, every reference INLINED as a copy of its target (JEDx's bundles; LIF's
// single file). The walk:
//   1. UNIONS components.schemas over the files by name; a name whose content differs between files is refused. Each component carries
//      bundleMembership (the files that define it).
//   2. RECOVERS REFERENCES BY CONTENT, never by title (titles are shared and borrowed in JEDx, measured): at every SITE (a property's shape,
//      an items shape, a composition branch, a definitions entry) an object whose canonical JSON, with its top-level description removed,
//      equals exactly ONE component's (likewise) is a reference to it. Two equal components are a tie broken ONLY by the component whose
//      name equals the copy's title; anything else is refused by name. A matched copy is not walked further; the site's own description
//      (the property's own text) stays with the site.
//   3. Mints by kind: an enum-only component is a CODE LIST (a DmeOptionSet owned by the root, <prefix>codeList/<Name>); every other
//      component is a DmeClass (objects, compositions and datatypes alike, its dataType carried). A site that matches no component and is
//      an object (properties, a composition, definitions, or type object) is an INLINE CLASS at the site (<owner>/<p>/inline, …/items,
//      …/allOf/<n>, …/definitions/<name>), walked like a component (nested inline objects recurse). An enum at a site that matches nothing
//      is the property's own option set (K0's rule). There is no title-based link of any kind (ruling, 2026-10-24).
// Edges: root HAS_CLASS component class; root HAS_OPTION_SET code list; class HAS_PROPERTY property; property HAS_OPTION_SET its own enum;
// option set HAS_VALUE member; and REFERENCES, from the site's owner (a property, or a class for its items, branches and definitions) to
// the referenced component (class or code list) or to the inline class, carrying referenceConstruct and locator (the JSON pointer of the
// site relative to its owner: '' for a property's own shape).
//
// WHAT IS CARRIED is DATA: openapiDereferencedKeywordRegistry.json. A keyword not in its position's table REFUSES BY NAME.

const path = require('path');
const crypto = require('crypto');
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { validateOpenapiProfile, SOURCE_LAYOUT } = require('./openapiProfileContract');
const openapiIdentity = require('./openapiIdentity');
const keywordRegistry = require('./openapiDereferencedKeywordRegistry.json');

const POSITION = Object.freeze({ CLASS: 'class', CODE_LIST: 'codeList', SITE: 'site', ITEMS: 'items', BRANCH: 'branch' });
const REFERENCE_CONSTRUCT = Object.freeze({ INLINE: 'inline', INLINE_ITEMS: 'inlineItems', INLINE_OBJECT: 'inlineObject', DEFINITIONS: 'definitions', ITEMS: 'items' });
const COMPOSITION_BRANCHES_PROPERTY_NAME = 'compositionBranches';
// the own description of a class-owned site that is a reference (a branch, a definition, the class's items): the copy's body is the
// component's, the site's description is the site's, and a class has no property node to hold it
const MATCHED_SITE_DESCRIPTIONS_PROPERTY_NAME = 'matchedSiteDescriptions';
// required names a class states for properties it does not hold itself but takes from a composition branch (JSON Schema allows it;
// DateTimePeriodType requires 'end' from its allOf): carried on the class, since no property node of its own can hold them
const REQUIRED_FROM_COMPOSITION_PROPERTY_NAME = 'requiredNamesFromComposition';
const ENUM_LOCATOR_PROPERTY_NAME = 'enumLocator';
const ENUM_NAME_PROPERTY_NAME = 'enumName';
const REQUIRED_PROPERTY_NAME = 'isRequired';
const BUNDLE_MEMBERSHIP_PROPERTY_NAME = 'bundleMembership';
const SITE_ROOT_SCHEMA_NAME_PROPERTY_NAME = 'siteRootSchemaName';
const SITE_POINTER_PROPERTY_NAME = 'sitePointer';
const REFERENCED_SCHEMA_NAMES_PROPERTY_NAME = 'referencedSchemaNames';
const REFERENCED_SCHEMA_NAMES_SEPARATOR = ', ';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const VALUE_KIND_CHECK_BY_KIND = Object.freeze({
	string: (candidate) => typeof candidate === 'string',
	boolean: (candidate) => typeof candidate === 'boolean',
	integer: (candidate) => Number.isInteger(candidate),
	number: (candidate) => typeof candidate === 'number' && Number.isFinite(candidate),
	// draft-04 states exclusiveMinimum as a boolean, later drafts as a number: the value is carried as the source types it
	booleanOrNumber: (candidate) => typeof candidate === 'boolean' || (typeof candidate === 'number' && Number.isFinite(candidate)),
});

// canonicalJsonOf — JSON with object members in sorted order at every depth, arrays in order (the content-equality form)
const canonicalJsonOf = (jsonValue) => {
	if (Array.isArray(jsonValue)) {
		return `[${jsonValue.map(canonicalJsonOf).join(',')}]`;
	}
	if (isPlainObject(jsonValue)) {
		return `{${Object.keys(jsonValue).sort().map((memberName) => `${JSON.stringify(memberName)}:${canonicalJsonOf(jsonValue[memberName])}`).join(',')}}`;
	}
	return JSON.stringify(jsonValue);
};
// contentDigestOf — the digest of an object's content with its TOP-LEVEL description removed (the reference rule's key)
const contentDigestOf = (shapeObject) => crypto.createHash('sha256').update(canonicalJsonOf(Object.keys(shapeObject).filter((memberName) => memberName !== 'description').reduce((withoutDescription, memberName) => ({ ...withoutDescription, [memberName]: shapeObject[memberName] }), {}))).digest('hex');
const escapedPointerSegment = (segmentText) => `${segmentText}`.replace(/~/g, '~0').replace(/\//g, '~1');

const refusal = (what, where) => refuse.byName({ moduleName, what, where });

const moduleFunction =
	({ moduleName } = {}) =>
	({ openapiProfile }) => {
		validateOpenapiProfile(openapiProfile);
		if (openapiProfile.sourceLayout !== SOURCE_LAYOUT.DEREFERENCED_MULTI_FILE) {
			throw refusal(`the profile's sourceLayout is '${openapiProfile.sourceLayout}'`, `this walk reads '${SOURCE_LAYOUT.DEREFERENCED_MULTI_FILE}' only; openapiLayout.js chooses the walk by layout`);
		}
		const { stableIdPrefix, perStandardLabelByRole, schemaExclusionList } = openapiProfile;

		// -----------------------------------------------------------------
		// emitContractGraph — { loaded: the loader's payload, kit } → { nodes, edges, stats }
		// -----------------------------------------------------------------
		const emitContractGraph = ({ loaded, kit }) => {
			const { sourceFileNameList, documentByFileName } = loaded;
			const walkStats = {
				sourceFileCount: sourceFileNameList.length,
				componentCount: 0,
				excludedComponentCount: 0,
				classComponentCount: 0,
				codeListCount: 0,
				codeListValueCount: 0,
				siteCount: 0,
				referenceRecoveredCount: 0,
				referenceRecoveredByTieCount: 0,
				referenceRecoveredCountByConstruct: {},
				inlineClassCount: 0,
				inlineClassTitledCount: 0,
				inlineClassAnonymousCount: 0,
				propertyCount: 0,
				localEnumCount: 0,
				localEnumValueCount: 0,
				compositionBranchCount: 0,
			};

			// -----------------------------------------------------------------
			// 1. the union of components.schemas over the files
			// -----------------------------------------------------------------
			const componentByName = {};
			const membershipByName = {};
			sourceFileNameList.forEach((sourceFileName) => {
				const schemaByName = documentByFileName[sourceFileName].components.schemas;
				Object.keys(schemaByName).forEach((schemaName) => {
					if (componentByName[schemaName] !== undefined && canonicalJsonOf(componentByName[schemaName]) !== canonicalJsonOf(schemaByName[schemaName])) {
						throw refusal(`component '${schemaName}' differs between '${membershipByName[schemaName][0]}' and '${sourceFileName}'`, 'one data model: a name shared by two files must be one schema (canonical JSON equal)');
					}
					componentByName[schemaName] = schemaByName[schemaName];
					membershipByName[schemaName] = (membershipByName[schemaName] || []).concat([sourceFileName]);
				});
			});
			const unknownExclusion = schemaExclusionList.find((schemaName) => componentByName[schemaName] === undefined);
			if (unknownExclusion !== undefined) {
				throw refusal(`schemaExclusionList names '${unknownExclusion}', which no file's components.schemas holds`, 'an exclusion names a schema the source states');
			}
			const forgedComponentNameList = Object.keys(componentByName).filter((schemaName) => schemaExclusionList.indexOf(schemaName) === -1);
			walkStats.componentCount = forgedComponentNameList.length;
			walkStats.excludedComponentCount = schemaExclusionList.length;
			const reservedName = forgedComponentNameList.find((schemaName) => openapiIdentity.RESERVED_SEGMENT_LIST.indexOf(schemaName) !== -1);
			if (reservedName !== undefined) {
				throw refusal(`component '${reservedName}' is named after a reserved id segment (${openapiIdentity.RESERVED_SEGMENT_LIST.join(', ')})`, 'the code-list and inline-class ids would collide with a component id; rename upstream or exclude it');
			}
			const malformedName = forgedComponentNameList.find((schemaName) => !isPlainObject(componentByName[schemaName]));
			if (malformedName !== undefined) {
				throw refusal(`component '${malformedName}' is not a schema object`, 'a component is a schema object');
			}

			// -----------------------------------------------------------------
			// 2. the content index, and the reference rule
			// -----------------------------------------------------------------
			const componentNameListByDigest = forgedComponentNameList.reduce((byDigest, schemaName) => {
				const digest = contentDigestOf(componentByName[schemaName]);
				return { ...byDigest, [digest]: (byDigest[digest] || []).concat([schemaName]) };
			}, {});
			const isCodeListShape = (shapeObject) => Array.isArray(shapeObject.enum) && shapeObject.properties === undefined;
			const isComplexShape = (shapeObject) => keywordRegistry.complexKeywordList.some((keywordName) => shapeObject[keywordName] !== undefined) || keywordRegistry.complexTypeValueList.indexOf(shapeObject.type) !== -1;
			const kindByName = forgedComponentNameList.reduce((byName, schemaName) => ({ ...byName, [schemaName]: isCodeListShape(componentByName[schemaName]) ? POSITION.CODE_LIST : POSITION.CLASS }), {});
			const componentStableIdOf = (schemaName) => (kindByName[schemaName] === POSITION.CODE_LIST
				? openapiIdentity.codeListStableIdOf({ stableIdPrefix, schemaName })
				: openapiIdentity.schemaStableIdOf({ stableIdPrefix, schemaName }));

			// matchedComponentNameOf — the ONE component a site's content equals, or undefined; a tie is broken only by name = title
			const matchedComponentNameOf = ({ shapeObject, origin }) => {
				const candidateNameList = componentNameListByDigest[contentDigestOf(shapeObject)] || [];
				if (candidateNameList.length <= 1) {
					return candidateNameList[0];
				}
				const titledNameList = candidateNameList.filter((schemaName) => schemaName === shapeObject.title);
				if (titledNameList.length !== 1) {
					throw refusal(`${origin}: the inline copy equals ${candidateNameList.length} components (${candidateNameList.join(', ')}) and its title ${JSON.stringify(shapeObject.title)} names none of them`, 'a content tie is broken only by the component whose name is the copy\'s title; nothing is guessed');
				}
				walkStats.referenceRecoveredByTieCount += 1;
				return titledNameList[0];
			};

			// referenceTo — one REFERENCES edge from an owner to a component, counted
			const referenceTo = ({ fromStableId, targetSchemaName, referenceConstruct, locator, edgeContext, referencedNameList }) => {
				kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId, toStableId: componentStableIdOf(targetSchemaName), edgeContext, edgeProperties: { referenceConstruct, locator } });
				walkStats.referenceRecoveredCount += 1;
				walkStats.referenceRecoveredCountByConstruct[referenceConstruct] = (walkStats.referenceRecoveredCountByConstruct[referenceConstruct] || 0) + 1;
				referencedNameList.push(targetSchemaName);
			};

			// carryScalar — one nodeProperty / jsonText keyword into a sink, by its registry row
			const carryScalar = ({ keywordName, keywordValue, carriageRow, sink, origin, locator }) => {
				if (carriageRow.carriage === 'jsonText') {
					sink[carriageRow.propertyName] = JSON.stringify(keywordValue);
					return;
				}
				if (!VALUE_KIND_CHECK_BY_KIND[carriageRow.valueKind](keywordValue)) {
					throw refusal(`${origin}: '${locator}/${keywordName}' holds ${JSON.stringify(keywordValue)}, not a ${carriageRow.valueKind}`, `the registry carries '${keywordName}' here as a ${carriageRow.valueKind}`);
				}
				if (carriageRow.allowedValueList !== undefined && carriageRow.allowedValueList.indexOf(keywordValue) === -1) {
					throw refusal(`${origin}: '${locator}/${keywordName}' is ${JSON.stringify(keywordValue)}, not one of ${carriageRow.allowedValueList.join(', ')}`, 'the registry names the values this position carries');
				}
				if (keywordValue === '') {
					throw refusal(`${origin}: '${locator}/${keywordName}' is the empty string`, 'an empty text is never carried as if it were one');
				}
				sink[carriageRow.propertyName] = keywordValue;
			};

			// carriageRowOf — a keyword's registry row at a position, or a refusal by name
			const carriageRowOf = ({ position, keywordName, origin, locator }) => {
				const carriageRow = keywordRegistry.carriageByPosition[position][keywordName];
				if (carriageRow === undefined) {
					throw refusal(
						`${origin}: keyword '${keywordName}' at ${locator === '' ? 'the top' : `'${locator}'`} (position '${position}') is not carried`,
						`openapiDereferencedKeywordRegistry.json carriageByPosition.${position} names ${Object.keys(keywordRegistry.carriageByPosition[position]).join(', ')}; a new keyword is a registry row with its twin`,
					);
				}
				return carriageRow;
			};

			// enumOf — a checked enum (and its aligned enumNames), or a refusal
			const enumOf = ({ shapeObject, origin, locator }) => {
				const memberList = shapeObject.enum;
				if (!Array.isArray(memberList) || memberList.length === 0 || !memberList.every((oneMember) => typeof oneMember === 'string' && oneMember !== '')) {
					throw refusal(`${origin}: '${locator}/enum' is not a non-empty list of non-empty strings`, 'an enum member becomes an option value named by its text');
				}
				const repeatedMember = memberList.find((oneMember, memberIndex) => memberList.indexOf(oneMember) !== memberIndex);
				if (repeatedMember !== undefined) {
					throw refusal(`${origin}: '${locator}/enum' lists '${repeatedMember}' twice`, 'no repeat rule is declared for enum members');
				}
				const enumNameList = shapeObject.enumNames;
				if (enumNameList !== undefined && (!Array.isArray(enumNameList) || enumNameList.length !== memberList.length || !enumNameList.every((oneName) => typeof oneName === 'string' && oneName !== ''))) {
					throw refusal(`${origin}: '${locator}/enumNames' is not a list of ${memberList.length} non-empty strings aligned with its enum`, 'enumNames[i] names enum[i]; a misaligned list cannot be carried member by member');
				}
				return { memberList, enumNameList };
			};

			// emitOptionValues — the members of an option set, each with its enumName when stated
			const emitOptionValues = ({ optionSetStableId, memberList, enumNameList, valueStableIdOf, pathPrefix, owningName, origin }) => {
				memberList.forEach((memberText, memberIndex) => {
					kit.emitOptionValue({
						optionSetStableId,
						optionValueStableId: valueStableIdOf(memberText),
						perStandardLabel: perStandardLabelByRole[DME_ROLES.OPTION_VALUE],
						name: memberText,
						path: `${pathPrefix}.${memberText}`,
						owningName,
						...(enumNameList === undefined ? {} : { carriedProperties: { [ENUM_NAME_PROPERTY_NAME]: enumNameList[memberIndex] } }),
						origin,
					});
				});
			};

			// -----------------------------------------------------------------
			// walkClassShape — a class's content (a component, or an inline object at a site): scalars, properties, items, branches,
			// definitions. Returns the class's carried properties; mints its properties and sub-classes as it goes.
			// -----------------------------------------------------------------
			const walkClassShape = ({ shapeObject, classStableId, className, rootSchemaName, sitePointer, descriptionOwnedBySite, origin }) => {
				const classSink = {};
				const branchRecordList = [];
				const matchedSiteDescriptionList = [];
				const referencedNameList = [];
				// keepMatchedSiteDescription — a referenced class-owned site's own description, kept with its locator
				const keepMatchedSiteDescription = ({ siteShape, locator }) => {
					if (siteShape.description !== undefined) {
						matchedSiteDescriptionList.push({ locator, description: siteShape.description });
					}
				};
				const subClassWorkList = [];
				Object.keys(shapeObject).forEach((keywordName) => {
					const locator = sitePointer;
					if (keywordName === 'description' && descriptionOwnedBySite) {
						return; // the site's description is its property's own text
					}
					const carriageRow = carriageRowOf({ position: POSITION.CLASS, keywordName, origin, locator });
					if (carriageRow.carriage === 'nodeProperty' || carriageRow.carriage === 'jsonText') {
						carryScalar({ keywordName, keywordValue: shapeObject[keywordName], carriageRow, sink: classSink, origin, locator });
					}
				});

				// composition branches: a reference, an inline class, or scalars carried in compositionBranches
				keywordRegistry.compositionConstructList.filter((constructName) => shapeObject[constructName] !== undefined).forEach((constructName) => {
					const branchList = shapeObject[constructName];
					if (!Array.isArray(branchList) || branchList.length === 0 || !branchList.every(isPlainObject)) {
						throw refusal(`${origin}: '${sitePointer}/${constructName}' is not a non-empty list of schema objects`, 'a composition is a list of branch schemas');
					}
					branchList.forEach((oneBranch, branchIndex) => {
						const branchLocator = `/${constructName}/${branchIndex}`;
						walkStats.compositionBranchCount += 1;
						walkStats.siteCount += 1;
						const matchedName = matchedComponentNameOf({ shapeObject: oneBranch, origin: `${origin} ${branchLocator}` });
						if (matchedName !== undefined) {
							referenceTo({ fromStableId: classStableId, targetSchemaName: matchedName, referenceConstruct: constructName, locator: branchLocator, edgeContext: `${className}${branchLocator}->${matchedName}`, referencedNameList });
							keepMatchedSiteDescription({ siteShape: oneBranch, locator: branchLocator });
							return;
						}
						if (isComplexShape(oneBranch)) {
							subClassWorkList.push({ shapeObject: oneBranch, segmentList: [constructName, `${branchIndex}`], referenceConstruct: constructName, locator: branchLocator, descriptionOwnedBySite: false });
							return;
						}
						const branchSink = {};
						Object.keys(oneBranch).forEach((keywordName) => {
							carryScalar({ keywordName, keywordValue: oneBranch[keywordName], carriageRow: carriageRowOf({ position: POSITION.BRANCH, keywordName, origin, locator: `${sitePointer}${branchLocator}` }), sink: branchSink, origin, locator: `${sitePointer}${branchLocator}` });
						});
						branchRecordList.push({ locator: branchLocator, construct: constructName, ...branchSink });
					});
				});

				// definitions: each named sub-schema is a reference or its own class
				if (shapeObject.definitions !== undefined) {
					if (!isPlainObject(shapeObject.definitions)) {
						throw refusal(`${origin}: '${sitePointer}/definitions' is not an object`, 'definitions is a map of named schemas');
					}
					Object.keys(shapeObject.definitions).forEach((definitionName) => {
						const definitionShape = shapeObject.definitions[definitionName];
						const definitionLocator = `/definitions/${escapedPointerSegment(definitionName)}`;
						walkStats.siteCount += 1;
						if (!isPlainObject(definitionShape)) {
							throw refusal(`${origin}: '${sitePointer}${definitionLocator}' is not a schema object`, 'a definition is a schema object');
						}
						const matchedName = matchedComponentNameOf({ shapeObject: definitionShape, origin: `${origin} ${definitionLocator}` });
						if (matchedName !== undefined) {
							referenceTo({ fromStableId: classStableId, targetSchemaName: matchedName, referenceConstruct: REFERENCE_CONSTRUCT.DEFINITIONS, locator: definitionLocator, edgeContext: `${className}${definitionLocator}->${matchedName}`, referencedNameList });
							keepMatchedSiteDescription({ siteShape: definitionShape, locator: definitionLocator });
							return;
						}
						subClassWorkList.push({ shapeObject: definitionShape, segmentList: [openapiIdentity.SITE_SEGMENT.DEFINITIONS, definitionName], referenceConstruct: REFERENCE_CONSTRUCT.DEFINITIONS, locator: definitionLocator, descriptionOwnedBySite: false });
					});
				}

				// items of an array class (a datatype component such as an array type): a reference, an inline class, or scalars
				if (shapeObject.items !== undefined) {
					const itemsShape = shapeObject.items;
					walkStats.siteCount += 1;
					if (!isPlainObject(itemsShape)) {
						throw refusal(`${origin}: '${sitePointer}/items' is not an object`, 'items is one schema object');
					}
					const matchedName = matchedComponentNameOf({ shapeObject: itemsShape, origin: `${origin} /items` });
					if (matchedName !== undefined) {
						referenceTo({ fromStableId: classStableId, targetSchemaName: matchedName, referenceConstruct: REFERENCE_CONSTRUCT.ITEMS, locator: '/items', edgeContext: `${className}/items->${matchedName}`, referencedNameList });
						keepMatchedSiteDescription({ siteShape: itemsShape, locator: '/items' });
					} else if (isComplexShape(itemsShape)) {
						subClassWorkList.push({ shapeObject: itemsShape, segmentList: [openapiIdentity.SITE_SEGMENT.ITEMS], referenceConstruct: REFERENCE_CONSTRUCT.ITEMS, locator: '/items', descriptionOwnedBySite: false });
					} else {
						Object.keys(itemsShape).forEach((keywordName) => {
							const carriageRow = carriageRowOf({ position: POSITION.ITEMS, keywordName, origin, locator: `${sitePointer}/items` });
							if (carriageRow.carriage !== 'nodeProperty') {
								throw refusal(`${origin}: '${sitePointer}/items/${keywordName}' on a class's items is not carried`, 'a class carries scalars of its items only; an enum there needs its own owner');
							}
							carryScalar({ keywordName, keywordValue: itemsShape[keywordName], carriageRow, sink: classSink, origin, locator: `${sitePointer}/items` });
						});
					}
				}
				if (branchRecordList.length !== 0) {
					classSink[COMPOSITION_BRANCHES_PROPERTY_NAME] = JSON.stringify(branchRecordList);
				}
				if (shapeObject.required !== undefined) {
					const requiredNameList = shapeObject.required;
					if (!Array.isArray(requiredNameList) || requiredNameList.length === 0 || !requiredNameList.every((oneName) => typeof oneName === 'string') || new Set(requiredNameList).size !== requiredNameList.length) {
						throw refusal(`${origin}: '${sitePointer}/required' is not a non-empty list of distinct names`, 'required is a non-empty string list (an empty one would be lost: absent and [] read back alike)');
					}
					const ownPropertyNameList = isPlainObject(shapeObject.properties) ? Object.keys(shapeObject.properties) : [];
					const strayNameList = requiredNameList.filter((oneName) => ownPropertyNameList.indexOf(oneName) === -1);
					const hasComposition = keywordRegistry.compositionConstructList.some((constructName) => shapeObject[constructName] !== undefined);
					if (strayNameList.length !== 0 && !hasComposition) {
						throw refusal(`${origin}: '${sitePointer}/required' names '${strayNameList[0]}', which neither its properties nor a composition can supply`, 'isRequired is carried on the property node, so a required name needs its property');
					}
					if (strayNameList.length !== 0) {
						classSink[REQUIRED_FROM_COMPOSITION_PROPERTY_NAME] = JSON.stringify(strayNameList);
					}
				}
				if (matchedSiteDescriptionList.length !== 0) {
					classSink[MATCHED_SITE_DESCRIPTIONS_PROPERTY_NAME] = JSON.stringify(matchedSiteDescriptionList);
				}
				return { classSink, subClassWorkList, referencedNameList };
			};

			// mintClass — a class node (component or inline), then its sub-classes, then its properties
			const mintClass = ({ shapeObject, classStableId, className, parentStableId, structuralPath, rootSchemaName, sitePointer, descriptionOwnedBySite, isInline, origin }) => {
				const { classSink, subClassWorkList, referencedNameList } = walkClassShape({ shapeObject, classStableId, className, rootSchemaName, sitePointer, descriptionOwnedBySite, origin });
				const { description, ...classCarried } = classSink;
				kit.makeNode({
					role: DME_ROLES.CLASS,
					perStandardLabel: perStandardLabelByRole[DME_ROLES.CLASS],
					stableId: classStableId,
					name: className,
					description,
					structural: { parentId: parentStableId, path: structuralPath },
					carriedProperties: {
						...classCarried,
						...(isInline
							? { [SITE_ROOT_SCHEMA_NAME_PROPERTY_NAME]: rootSchemaName, [SITE_POINTER_PROPERTY_NAME]: sitePointer }
							: { [BUNDLE_MEMBERSHIP_PROPERTY_NAME]: JSON.stringify(membershipByName[rootSchemaName].slice().sort()) }),
						...(referencedNameList.length === 0 ? {} : { [REFERENCED_SCHEMA_NAMES_PROPERTY_NAME]: referencedNameList.filter((schemaName, nameIndex) => referencedNameList.indexOf(schemaName) === nameIndex).join(REFERENCED_SCHEMA_NAMES_SEPARATOR) }),
					},
					origin,
				});
				subClassWorkList.forEach((oneWork) => {
					const subClassStableId = openapiIdentity.subStableIdOf({ ownerStableId: classStableId, segmentList: oneWork.segmentList });
					mintInlineClass({ shapeObject: oneWork.shapeObject, inlineStableId: subClassStableId, ownerStableId: classStableId, ownerName: className, siteLabel: oneWork.segmentList.join('.'), rootSchemaName, sitePointer: `${sitePointer}${oneWork.locator}`, descriptionOwnedBySite: oneWork.descriptionOwnedBySite, referenceConstruct: oneWork.referenceConstruct, locator: oneWork.locator, origin: `${origin} ${oneWork.locator}` });
				});
				if (shapeObject.properties !== undefined) {
					walkProperties({ shapeObject, classStableId, className, rootSchemaName, sitePointer, origin });
				}
			};

			// mintInlineClass — an inline object matching no component: a class at the site, and the owner's REFERENCES edge to it
			const mintInlineClass = ({ shapeObject, inlineStableId, ownerStableId, ownerName, siteLabel, rootSchemaName, sitePointer, descriptionOwnedBySite, referenceConstruct, locator, origin }) => {
				const isTitled = typeof shapeObject.title === 'string' && shapeObject.title !== '';
				walkStats.inlineClassCount += 1;
				walkStats[isTitled ? 'inlineClassTitledCount' : 'inlineClassAnonymousCount'] += 1;
				mintClass({
					shapeObject,
					classStableId: inlineStableId,
					// a title is the source's name for the object; an untitled one is named for where it sits
					className: isTitled ? shapeObject.title : `${ownerName}.${siteLabel}`,
					parentStableId: ownerStableId,
					structuralPath: `${rootSchemaName}${sitePointer}`,
					rootSchemaName,
					sitePointer,
					descriptionOwnedBySite,
					isInline: true,
					origin,
				});
				kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: ownerStableId, toStableId: inlineStableId, edgeContext: `${ownerName}${locator}->inline`, edgeProperties: { referenceConstruct, locator } });
			};

			// walkProperties — one DmeProperty per member of a class's properties, each a SITE
			const walkProperties = ({ shapeObject, classStableId, className, rootSchemaName, sitePointer, origin }) => {
				if (!isPlainObject(shapeObject.properties)) {
					throw refusal(`${origin}: '${sitePointer}/properties' is not an object`, 'properties is a map of schemas');
				}
				const propertyNameList = Object.keys(shapeObject.properties);
				// required was checked by walkClassShape; a name a composition supplies is carried on the class
				const requiredNameList = shapeObject.required === undefined ? [] : shapeObject.required;
				propertyNameList.forEach((propertyName) => {
					const siteShape = shapeObject.properties[propertyName];
					const propertyPointer = `${sitePointer}/properties/${escapedPointerSegment(propertyName)}`;
					const propertyOrigin = `${rootSchemaName}${propertyPointer}`;
					if (!isPlainObject(siteShape)) {
						throw refusal(`${propertyOrigin} is not a schema object`, 'a property is a schema object');
					}
					const propertyStableId = openapiIdentity.subStableIdOf({ ownerStableId: classStableId, segmentList: [propertyName] });
					walkStats.siteCount += 1;
					const referencedNameList = [];
					const propertySink = {};
					const enumWorkList = [];
					let inlineWork;
					const matchedName = matchedComponentNameOf({ shapeObject: siteShape, origin: propertyOrigin });
					if (matchedName !== undefined) {
						if (siteShape.description !== undefined) {
							carryScalar({ keywordName: 'description', keywordValue: siteShape.description, carriageRow: carriageRowOf({ position: POSITION.SITE, keywordName: 'description', origin: propertyOrigin, locator: '' }), sink: propertySink, origin: propertyOrigin, locator: '' });
						}
					} else if (isComplexShape(siteShape)) {
						if (siteShape.description !== undefined) {
							carryScalar({ keywordName: 'description', keywordValue: siteShape.description, carriageRow: carriageRowOf({ position: POSITION.SITE, keywordName: 'description', origin: propertyOrigin, locator: '' }), sink: propertySink, origin: propertyOrigin, locator: '' });
						}
						inlineWork = { shapeObject: siteShape, segmentList: [openapiIdentity.SITE_SEGMENT.INLINE], locator: '', descriptionOwnedBySite: true };
					} else {
						Object.keys(siteShape).forEach((keywordName) => {
							const carriageRow = carriageRowOf({ position: POSITION.SITE, keywordName, origin: propertyOrigin, locator: '' });
							if (carriageRow.carriage === 'nodeProperty' || carriageRow.carriage === 'jsonText') {
								carryScalar({ keywordName, keywordValue: siteShape[keywordName], carriageRow, sink: propertySink, origin: propertyOrigin, locator: '' });
							}
						});
						if (siteShape.enum !== undefined) {
							enumWorkList.push({ ...enumOf({ shapeObject: siteShape, origin: propertyOrigin, locator: '' }), enumLocator: '/enum' });
						} else if (siteShape.enumNames !== undefined) {
							throw refusal(`${propertyOrigin}: enumNames without an enum`, 'enumNames names the members of an enum beside it');
						}
						if (siteShape.items !== undefined) {
							const itemsShape = siteShape.items;
							walkStats.siteCount += 1;
							if (!isPlainObject(itemsShape)) {
								throw refusal(`${propertyOrigin}: '/items' is not an object`, 'items is one schema object');
							}
							const itemsMatchedName = matchedComponentNameOf({ shapeObject: itemsShape, origin: `${propertyOrigin}/items` });
							if (itemsMatchedName !== undefined) {
								referenceTo({ fromStableId: propertyStableId, targetSchemaName: itemsMatchedName, referenceConstruct: REFERENCE_CONSTRUCT.INLINE_ITEMS, locator: '/items', edgeContext: `${className}.${propertyName}/items->${itemsMatchedName}`, referencedNameList });
								if (itemsShape.description !== undefined) {
									// the items copy's own description is the site's (itemsDescription); its body is the component's
									carryScalar({ keywordName: 'description', keywordValue: itemsShape.description, carriageRow: carriageRowOf({ position: POSITION.ITEMS, keywordName: 'description', origin: propertyOrigin, locator: '/items' }), sink: propertySink, origin: propertyOrigin, locator: '/items' });
								}
							} else if (isComplexShape(itemsShape)) {
								inlineWork = { shapeObject: itemsShape, segmentList: [openapiIdentity.SITE_SEGMENT.ITEMS], locator: '/items', descriptionOwnedBySite: false };
							} else {
								Object.keys(itemsShape).forEach((keywordName) => {
									const carriageRow = carriageRowOf({ position: POSITION.ITEMS, keywordName, origin: propertyOrigin, locator: '/items' });
									if (carriageRow.carriage === 'nodeProperty') {
										carryScalar({ keywordName, keywordValue: itemsShape[keywordName], carriageRow, sink: propertySink, origin: propertyOrigin, locator: '/items' });
									}
								});
								if (itemsShape.enum !== undefined) {
									enumWorkList.push({ ...enumOf({ shapeObject: itemsShape, origin: propertyOrigin, locator: '/items' }), enumLocator: '/items/enum' });
								}
							}
						}
					}
					if (enumWorkList.length > 1) {
						throw refusal(`${propertyOrigin} states ${enumWorkList.length} enums`, 'a property owns ONE option set');
					}
					const isRequired = requiredNameList.indexOf(propertyName) !== -1;
					const { description, ...propertyCarried } = propertySink;
					// the names of the components this property references, as text, for a reader and the judge (the K0 rule)
					const referencedSchemaNameList = referencedNameList.concat(matchedName === undefined ? [] : [matchedName]).filter((schemaName, nameIndex, nameList) => nameList.indexOf(schemaName) === nameIndex);
					kit.makeNode({
						role: DME_ROLES.PROPERTY,
						perStandardLabel: perStandardLabelByRole[DME_ROLES.PROPERTY],
						stableId: propertyStableId,
						name: propertyName,
						description,
						structural: { parentId: classStableId, path: `${rootSchemaName}${propertyPointer}`, owningName: className },
						carriedProperties: {
							...propertyCarried,
							[REQUIRED_PROPERTY_NAME]: isRequired,
							...(referencedSchemaNameList.length === 0 ? {} : { [REFERENCED_SCHEMA_NAMES_PROPERTY_NAME]: referencedSchemaNameList.join(REFERENCED_SCHEMA_NAMES_SEPARATOR) }),
						},
						origin: propertyOrigin,
					});
					kit.addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: classStableId, toStableId: propertyStableId, edgeContext: `${className}->${propertyName}` });
					walkStats.propertyCount += 1;
					if (matchedName !== undefined) {
						referenceTo({ fromStableId: propertyStableId, targetSchemaName: matchedName, referenceConstruct: REFERENCE_CONSTRUCT.INLINE, locator: '', edgeContext: `${className}.${propertyName}->${matchedName}`, referencedNameList });
					}
					enumWorkList.forEach((oneEnum) => {
						const optionSetStableId = openapiIdentity.subStableIdOf({ ownerStableId: propertyStableId, segmentList: [openapiIdentity.ENUM_SEGMENT] });
						kit.makeNode({
							role: DME_ROLES.OPTION_SET,
							perStandardLabel: perStandardLabelByRole[DME_ROLES.OPTION_SET],
							stableId: optionSetStableId,
							name: propertyName,
							structural: { parentId: propertyStableId, path: `${rootSchemaName}${propertyPointer}${oneEnum.enumLocator}`, owningName: className },
							carriedProperties: { [ENUM_LOCATOR_PROPERTY_NAME]: oneEnum.enumLocator },
							origin: propertyOrigin,
						});
						kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: propertyStableId, toStableId: optionSetStableId, edgeContext: `${className}.${propertyName}->enum` });
						emitOptionValues({ optionSetStableId, memberList: oneEnum.memberList, enumNameList: oneEnum.enumNameList, valueStableIdOf: (memberText) => openapiIdentity.subStableIdOf({ ownerStableId: optionSetStableId, segmentList: [openapiIdentity.memberSegmentOf(memberText)] }), pathPrefix: `${rootSchemaName}${propertyPointer}${oneEnum.enumLocator}`, owningName: propertyName, origin: propertyOrigin });
						walkStats.localEnumCount += 1;
						walkStats.localEnumValueCount += oneEnum.memberList.length;
					});
					if (inlineWork !== undefined) {
						mintInlineClass({ shapeObject: inlineWork.shapeObject, inlineStableId: openapiIdentity.subStableIdOf({ ownerStableId: propertyStableId, segmentList: inlineWork.segmentList }), ownerStableId: propertyStableId, ownerName: `${className}.${propertyName}`, siteLabel: inlineWork.segmentList.join('.'), rootSchemaName, sitePointer: `${propertyPointer}${inlineWork.locator}`, descriptionOwnedBySite: inlineWork.descriptionOwnedBySite, referenceConstruct: inlineWork.locator === '' ? REFERENCE_CONSTRUCT.INLINE_OBJECT : REFERENCE_CONSTRUCT.INLINE_ITEMS, locator: inlineWork.locator, origin: `${propertyOrigin}${inlineWork.locator}` });
					}
				});
			};

			// -----------------------------------------------------------------
			// 3. mint: code lists first (sites point at them), then every class component
			// -----------------------------------------------------------------
			forgedComponentNameList.filter((schemaName) => kindByName[schemaName] === POSITION.CODE_LIST).forEach((schemaName) => {
				const componentShape = componentByName[schemaName];
				const origin = `components.schemas.${schemaName}`;
				const codeListSink = {};
				Object.keys(componentShape).forEach((keywordName) => {
					const carriageRow = carriageRowOf({ position: POSITION.CODE_LIST, keywordName, origin, locator: '' });
					if (carriageRow.carriage === 'nodeProperty' || carriageRow.carriage === 'jsonText') {
						carryScalar({ keywordName, keywordValue: componentShape[keywordName], carriageRow, sink: codeListSink, origin, locator: '' });
					}
				});
				const { memberList, enumNameList } = enumOf({ shapeObject: componentShape, origin, locator: '' });
				const optionSetStableId = componentStableIdOf(schemaName);
				const { description, ...codeListCarried } = codeListSink;
				kit.makeNode({
					role: DME_ROLES.OPTION_SET,
					perStandardLabel: perStandardLabelByRole[DME_ROLES.OPTION_SET],
					stableId: optionSetStableId,
					name: schemaName,
					description,
					structural: { parentId: kit.rootStableId, path: schemaName },
					carriedProperties: { ...codeListCarried, [ENUM_LOCATOR_PROPERTY_NAME]: '/enum', [BUNDLE_MEMBERSHIP_PROPERTY_NAME]: JSON.stringify(membershipByName[schemaName].slice().sort()) },
					origin,
				});
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: kit.rootStableId, toStableId: optionSetStableId, edgeContext: `root->codeList ${schemaName}` });
				emitOptionValues({ optionSetStableId, memberList, enumNameList, valueStableIdOf: (memberText) => openapiIdentity.codeListValueStableIdOf({ stableIdPrefix, schemaName, memberText }), pathPrefix: schemaName, owningName: schemaName, origin });
				walkStats.codeListCount += 1;
				walkStats.codeListValueCount += memberList.length;
			});
			forgedComponentNameList.filter((schemaName) => kindByName[schemaName] === POSITION.CLASS).forEach((schemaName) => {
				const classStableId = componentStableIdOf(schemaName);
				mintClass({ shapeObject: componentByName[schemaName], classStableId, className: schemaName, parentStableId: kit.rootStableId, structuralPath: schemaName, rootSchemaName: schemaName, sitePointer: '', descriptionOwnedBySite: false, isInline: false, origin: `components.schemas.${schemaName}` });
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_CLASS, fromStableId: kit.rootStableId, toStableId: classStableId, edgeContext: `root->${schemaName}` });
				walkStats.classComponentCount += 1;
			});

			Object.keys(walkStats).forEach((statName) => {
				kit.stats[statName] = walkStats[statName];
			});
			return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
		};

		return { emitContractGraph };
	};

module.exports = moduleFunction({ moduleName });
