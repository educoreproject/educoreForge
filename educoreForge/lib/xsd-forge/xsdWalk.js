'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdWalk.js — the H3 walk of the XSD kit (wave 3 lane I, K3, ruled by BRONZE_CROWN 2026-10-24). PURE: it reads the set loader's payload
// and the bundle's profile, and mints through the framework kit only; a refusal is a thrown named Error under the framework's one adapter.
//
// THE MODEL (identity: xsdIdentity.js; what each construct becomes: xsdConstructRegistry.json mintKind):
//   schemaFile   DmeSupport, one per forged file: root HAS_SUPPORT file
//   class        DmeClass: a named complexType (root HAS_CLASS) or an anonymous one (its declaration REFERENCES_TYPE it)
//   simpleType   DmeOptionSet when its restriction lists enumerations, else DmeSupport: a named one is the file's (HAS_DEFINITION), an
//                anonymous one its declaration's (HAS_OPTION_SET or REFERENCES_TYPE)
//   support      DmeSupport: a global element, group or attributeGroup, the file's (HAS_DEFINITION)
//   property     DmeProperty: a local element or attribute, or an element/attribute ref=, owned (HAS_PROPERTY) by the nearest class or
//                group/attributeGroup
//   optionValue  DmeOptionValue: one enumeration (HAS_VALUE from its option set)
//   structure    NOT a node: compositors, derivations, wrappers, facets, wildcards, imports, annotations, identity constraints and every
//                comment ride, verbatim and in document order, on the nearest minted ancestor's xsdStructureList (JSON text:
//                [{ locator, construct, localTag, attributeList, documentationText? } or a comment { locator, construct 'comment',
//                commentIndex, beforeChildIndex | placement, commentText }]). Identity
//                constraints are carried verbatim, as ruled. So is an enumeration the profile's enumerationRepeatList declares a repeat
//                of an earlier value of its own restriction: one value, one node, and the repeat's statement kept on the option set.
// Every minted node carries xsdConstruct, xsdLocator and schemaFile, its construct's carried attributes under the registry's property
// names, and its description: the text of its OWN annotation's documentation (non-blank texts, joined by a newline). No text is borrowed
// from a type or a reference: a property without documentation has no description.
//
// REFERENCES (registry qnameAttributeRuleList; xsdResolution.js): every QName attribute is resolved through its own file. A corpus target
// gets ONE edge, from the node itself or (for a structure construct) from its owner, of the type the rule names for the target's role,
// carrying referenceConstruct, writtenQName and atLocator (and derivationVariety on a base). A built-in or external target gets no edge:
// the QName is carried as written. A QName that resolves nowhere refuses.
//
// THE FORGE DOES NO BRIDGING (FBB-001): it resolves nothing outside the forged files, and carries a foreign reference as written.

const path = require('path');
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { validateXsdProfile } = require('./xsdProfileContract');
const xsdIdentity = require('./xsdIdentity');
const { buildResolutionTable, resolveWrittenQName } = require('./xsdResolution');
const { prefixOfQualifiedName } = require('./xsdParser');
const constructRegistry = require('./xsdConstructRegistry.json');

const STRUCTURE_LIST_PROPERTY_NAME = 'xsdStructureList';
const CONSTRUCT_PROPERTY_NAME = 'xsdConstruct';
const LOCATOR_PROPERTY_NAME = 'xsdLocator';
const SCHEMA_FILE_PROPERTY_NAME = 'schemaFile';
const SCHEMA_ATTRIBUTE_LIST_PROPERTY_NAME = 'schemaAttributeList';
const SCHEMA_SET_NAME_LIST_PROPERTY_NAME = 'schemaSetNameList';
const TARGET_NAMESPACE_PROPERTY_NAME = 'targetNamespace';
const COMMENT_CONSTRUCT = 'comment';
const DESCRIPTION_SEPARATOR = '\n';
const DECLARATION_CONSTRUCT_LIST = Object.freeze(['globalElement', 'localElement', 'localAttribute']);
const PROPERTY_OWNER_CONSTRUCT_LIST = Object.freeze(['globalComplexType', 'anonymousComplexType', 'globalGroup', 'globalAttributeGroup']);
const ROOT_PLACEMENT = Object.freeze({ PROLOG: 'prolog', EPILOG: 'epilog' });

const refusal = (what, where) => refuse.byName({ moduleName, what, where });
const attributeValueOf = (node, attributeName) => (node.attributeList.find((oneAttribute) => oneAttribute.attributeName === attributeName) || {}).attributeValue;
const qnameRuleListFor = (construct) => constructRegistry.qnameAttributeRuleList.filter((oneRule) => oneRule.construct === construct);

// hasEnumerationOf — a simpleType whose restriction lists enumerations is an option set
const hasEnumerationOf = (simpleTypeNode) => simpleTypeNode.children.some((oneChild) => oneChild.localTag === 'restriction' && oneChild.children.some((grandChild) => grandChild.construct === 'enumeration'));

// descriptionOf — the non-blank documentation texts of a node's OWN annotations, verbatim, joined; undefined when there is none
const descriptionOf = (node) => {
	const textList = node.children
		.filter((oneChild) => oneChild.construct === 'annotation')
		.reduce((soFar, annotationNode) => soFar.concat(annotationNode.children.filter((oneChild) => oneChild.construct === 'documentation').map((documentationNode) => documentationNode.documentationText)), [])
		.filter((oneText) => oneText.trim() !== '');
	return textList.length === 0 ? undefined : textList.join(DESCRIPTION_SEPARATOR);
};

// structureEntryOf — one non-minted construct (or a comment) as its xsdStructureList entry
const structureEntryOf = (node) => ({
	locator: node.locator,
	construct: node.construct,
	localTag: node.localTag,
	attributeList: node.attributeList,
	...(node.documentationText === undefined ? {} : { documentationText: node.documentationText }),
});
// commentEntryListOf — a node's comments, each with its ordinal among that node's comments (two may stand at one child index)
const commentEntryListOf = (node) => node.commentList.map((oneComment, commentIndex) => ({ locator: node.locator, construct: COMMENT_CONSTRUCT, commentIndex, beforeChildIndex: oneComment.beforeChildIndex, commentText: oneComment.text }));

const moduleFunction =
	({ moduleName } = {}) =>
	({ xsdProfile }) => {
		validateXsdProfile(xsdProfile);
		const { stableIdPrefix, perStandardLabelByNodeKind, foreignNamespaceList, enumerationRepeatList } = xsdProfile;
		const foreignNamespaceUriList = foreignNamespaceList.map((oneRow) => oneRow.namespace);
		const repeatSiteTextOf = ({ schemaFileRelativePath, locator }) => `${schemaFileRelativePath} ${locator}`;
		const declaredRepeatSiteTextList = enumerationRepeatList.map((oneRow) => repeatSiteTextOf({ schemaFileRelativePath: oneRow.schemaFile, locator: oneRow.enumerationLocator }));

		// -----------------------------------------------------------------
		// emitContractGraph — { loaded: the set loader's payload, kit } → { nodes, edges, stats }
		// -----------------------------------------------------------------
		const emitContractGraph = ({ loaded, kit }) => {
			const resolutionTable = buildResolutionTable({ schemaFileList: loaded.schemaFileList, stableIdPrefix });
			const walkStats = {
				schemaFileCount: 0,
				mintedCountByConstruct: {},
				structureEntryCountByConstruct: {},
				referenceEdgeCountByConstruct: {},
				builtinReferenceCount: 0,
				externalReferenceCountByNamespace: {},
				describedNodeCountByRole: {},
				declaredRepeatCount: 0,
			};
			const usedRepeatSiteTextList = [];
			const countInto = (counts, countName) => {
				counts[countName] = (counts[countName] || 0) + 1;
			};

			// -----------------------------------------------------------------
			// 1. PLAN — every node of every file is either a mint record or a structure entry of the nearest mint record
			// -----------------------------------------------------------------
			const mintRecordList = [];
			const pendingReferenceList = [];

			// planReferences — the QName attributes of one construct, queued for the edge pass (resolution needs every node first)
			const planReferences = ({ node, schemaFile, edgeSourceRecord }) => {
				qnameRuleListFor(node.construct).forEach((qnameRule) => {
					const writtenText = attributeValueOf(node, qnameRule.attributeName);
					if (writtenText === undefined) {
						return;
					}
					const writtenQNameList = qnameRule.isList ? writtenText.split(/\s+/).filter((oneName) => oneName !== '') : [writtenText];
					writtenQNameList.forEach((writtenQName) => pendingReferenceList.push({ node, schemaFile, edgeSourceRecord, qnameRule, writtenQName }));
				});
			};

			// planNode — one construct model node under its nearest mint record (and the declaration whose anonymous type it may be)
			const planNode = ({ node, schemaFile, parentRecord, declarationRecord }) => {
				const constructRule = constructRegistry.constructByName[node.construct];
				const siteText = `'${schemaFile.schemaFileRelativePath}' ${node.locator}`;
				if (constructRule.mintKind === 'optionValue' && isRepeatedValue({ node, parentRecord, schemaFile, siteText })) {
					parentRecord.structureList.push(structureEntryOf(node));
					parentRecord.structureList.push(...commentEntryListOf(node));
					node.children.forEach((childNode) => planNode({ node: childNode, schemaFile, parentRecord, declarationRecord }));
					return;
				}
				if (constructRule.mintKind === 'structure') {
					parentRecord.structureList.push(structureEntryOf(node));
					parentRecord.structureList.push(...commentEntryListOf(node));
					countInto(walkStats.structureEntryCountByConstruct, node.construct);
					planReferences({ node, schemaFile, edgeSourceRecord: parentRecord });
					node.children.forEach((childNode) => planNode({ node: childNode, schemaFile, parentRecord, declarationRecord }));
					return;
				}
				const record = MINT_PLANNER_BY_KIND[constructRule.mintKind]({ node, constructRule, schemaFile, parentRecord, declarationRecord, siteText });
				record.structureList.push(...commentEntryListOf(node));
				mintRecordList.push(record);
				countInto(walkStats.mintedCountByConstruct, node.construct);
				planReferences({ node, schemaFile, edgeSourceRecord: record });
				const childDeclarationRecord = DECLARATION_CONSTRUCT_LIST.indexOf(node.construct) !== -1 ? record : declarationRecord;
				node.children.forEach((childNode) => planNode({ node: childNode, schemaFile, parentRecord: record, declarationRecord: childDeclarationRecord }));
			};

			// isRepeatedValue — true for an enumeration DECLARED a repeat of an earlier value of its option set; an undeclared repeat refuses,
			// and a declared site that repeats nothing refuses (the declaration names a repeat, never a value it would drop)
			const isRepeatedValue = ({ node, parentRecord, schemaFile, siteText }) => {
				const valueText = attributeValueOf(node, 'value');
				const isRepeat = parentRecord.mintedValueTextList !== undefined && parentRecord.mintedValueTextList.indexOf(valueText) !== -1;
				const siteKeyText = repeatSiteTextOf({ schemaFileRelativePath: schemaFile.schemaFileRelativePath, locator: node.locator });
				const isDeclared = declaredRepeatSiteTextList.indexOf(siteKeyText) !== -1;
				if (isRepeat && !isDeclared) {
					throw refusal(`${siteText}: enumeration value ${JSON.stringify(valueText)} repeats an earlier value of its restriction`, 'declare the repeat in the profile\'s enumerationRepeatList (schemaFile, enumerationLocator, reason); a repeat is never merged in silence');
				}
				if (isDeclared && !isRepeat) {
					throw refusal(`${siteText}: enumerationRepeatList declares this enumeration a repeat, but ${JSON.stringify(valueText)} is its first occurrence`, 'a stale or misplaced declaration is refused; name the SECOND occurrence');
				}
				if (isRepeat) {
					usedRepeatSiteTextList.push(siteKeyText);
					walkStats.declaredRepeatCount += 1;
				} else if (parentRecord.mintedValueTextList !== undefined) {
					parentRecord.mintedValueTextList.push(valueText);
				}
				return isRepeat;
			};

			// recordOf — a mint record: what makeNode needs, and the structure list the walk fills before minting
			const recordOf = ({ node, schemaFile, role, nodeKind, stableId, name, nodePath, parentStableId, parentEdgeType, owningName }) => ({
				node,
				schemaFile,
				role,
				nodeKind,
				stableId,
				name,
				nodePath,
				parentStableId,
				parentEdgeType,
				owningName,
				structureList: [],
				...(role === DME_ROLES.OPTION_SET ? { mintedValueTextList: [] } : {}),
			});

			// anonymousPlacementOf — an anonymous type's declaration, or a named refusal when it has none
			const anonymousPlacementOf = ({ declarationRecord, parentRecord, siteText, node }) => {
				if (declarationRecord === undefined || parentRecord !== declarationRecord) {
					throw refusal(`${siteText}: an anonymous ${node.localTag} that is not the type of an element or attribute declaration`, 'an anonymous type is placed by its declaration; another site is untaught');
				}
				return declarationRecord;
			};

			const MINT_PLANNER_BY_KIND = {
				class: ({ node, constructRule, schemaFile, parentRecord, declarationRecord, siteText }) => {
					if (node.construct === 'globalComplexType') {
						const name = attributeValueOf(node, 'name');
						return recordOf({ node, schemaFile, role: DME_ROLES.CLASS, nodeKind: 'class', stableId: xsdIdentity.topLevelStableIdOf({ stableIdPrefix, stableIdSegment: constructRule.stableIdSegment, namespaceUri: schemaFile.parsedFile.targetNamespace, localName: name }), name, nodePath: name, parentStableId: kit.rootStableId, parentEdgeType: EDGE_TYPES.HAS_CLASS, owningName: undefined });
					}
					const declaration = anonymousPlacementOf({ declarationRecord, parentRecord, siteText, node });
					return recordOf({ node, schemaFile, role: DME_ROLES.CLASS, nodeKind: 'class', stableId: xsdIdentity.anonymousStableIdOf({ declarationStableId: declaration.stableId }), name: declaration.name, nodePath: declaration.nodePath, parentStableId: declaration.stableId, parentEdgeType: EDGE_TYPES.REFERENCES_TYPE, owningName: declaration.name });
				},
				simpleType: ({ node, constructRule, schemaFile, parentRecord, declarationRecord, siteText }) => {
					const isOptionSet = hasEnumerationOf(node);
					const role = isOptionSet ? DME_ROLES.OPTION_SET : DME_ROLES.SUPPORT;
					const nodeKind = isOptionSet ? 'optionSet' : 'support';
					if (node.construct === 'globalSimpleType') {
						const name = attributeValueOf(node, 'name');
						return recordOf({ node, schemaFile, role, nodeKind, stableId: xsdIdentity.topLevelStableIdOf({ stableIdPrefix, stableIdSegment: constructRule.stableIdSegment, namespaceUri: schemaFile.parsedFile.targetNamespace, localName: name }), name, nodePath: name, parentStableId: parentRecord.stableId, parentEdgeType: EDGE_TYPES.HAS_DEFINITION, owningName: undefined });
					}
					const declaration = anonymousPlacementOf({ declarationRecord, parentRecord, siteText, node });
					return recordOf({ node, schemaFile, role, nodeKind, stableId: xsdIdentity.anonymousStableIdOf({ declarationStableId: declaration.stableId }), name: declaration.name, nodePath: declaration.nodePath, parentStableId: declaration.stableId, parentEdgeType: isOptionSet ? EDGE_TYPES.HAS_OPTION_SET : EDGE_TYPES.REFERENCES_TYPE, owningName: declaration.name });
				},
				support: ({ node, constructRule, schemaFile, parentRecord }) => {
					const name = attributeValueOf(node, 'name');
					return recordOf({ node, schemaFile, role: DME_ROLES.SUPPORT, nodeKind: 'support', stableId: xsdIdentity.topLevelStableIdOf({ stableIdPrefix, stableIdSegment: constructRule.stableIdSegment, namespaceUri: schemaFile.parsedFile.targetNamespace, localName: name }), name, nodePath: name, parentStableId: parentRecord.stableId, parentEdgeType: EDGE_TYPES.HAS_DEFINITION, owningName: undefined });
				},
				property: ({ node, constructRule, schemaFile, parentRecord, siteText }) => {
					if (PROPERTY_OWNER_CONSTRUCT_LIST.indexOf(parentRecord.node.construct) === -1) {
						throw refusal(`${siteText}: a ${node.construct} whose nearest minted ancestor is a ${parentRecord.node.construct}`, `a property is owned by one of ${PROPERTY_OWNER_CONSTRUCT_LIST.join(', ')}`);
					}
					const name = constructRule.nameFromQNameAttribute === undefined ? attributeValueOf(node, 'name') : prefixOfQualifiedName(attributeValueOf(node, constructRule.nameFromQNameAttribute)).localName;
					return recordOf({ node, schemaFile, role: DME_ROLES.PROPERTY, nodeKind: 'property', stableId: xsdIdentity.nestedStableIdOf({ ownerStableId: parentRecord.stableId, stableIdSegment: constructRule.stableIdSegment, localName: name }), name, nodePath: `${parentRecord.nodePath}.${name}`, parentStableId: parentRecord.stableId, parentEdgeType: EDGE_TYPES.HAS_PROPERTY, owningName: parentRecord.name });
				},
				optionValue: ({ node, schemaFile, parentRecord, siteText }) => {
					if (parentRecord.role !== DME_ROLES.OPTION_SET) {
						throw refusal(`${siteText}: an enumeration whose nearest minted ancestor is a ${parentRecord.node.construct} (${parentRecord.role})`, 'an enumeration is a value of a simpleType option set; one inside a complexType restriction is untaught');
					}
					const name = attributeValueOf(node, 'value');
					return recordOf({ node, schemaFile, role: DME_ROLES.OPTION_VALUE, nodeKind: 'optionValue', stableId: xsdIdentity.valueStableIdOf({ optionSetStableId: parentRecord.stableId, valueText: name }), name, nodePath: `${parentRecord.nodePath}.${name}`, parentStableId: parentRecord.stableId, parentEdgeType: EDGE_TYPES.HAS_VALUE, owningName: parentRecord.name });
				},
			};

			loaded.schemaFileList.forEach((schemaFile) => {
				const { parsedFile, schemaFileRelativePath } = schemaFile;
				const fileRecord = recordOf({
					node: parsedFile.rootNode,
					schemaFile,
					role: DME_ROLES.SUPPORT,
					nodeKind: 'schemaFile',
					stableId: xsdIdentity.schemaFileStableIdOf({ stableIdPrefix, schemaFileRelativePath }),
					name: schemaFileRelativePath,
					nodePath: schemaFileRelativePath,
					parentStableId: kit.rootStableId,
					parentEdgeType: EDGE_TYPES.HAS_SUPPORT,
					owningName: undefined,
				});
				parsedFile.prologCommentList.forEach((oneComment, commentIndex) => fileRecord.structureList.push({ locator: '/', construct: COMMENT_CONSTRUCT, placement: ROOT_PLACEMENT.PROLOG, commentIndex, commentText: oneComment.text }));
				fileRecord.structureList.push(...commentEntryListOf(parsedFile.rootNode));
				mintRecordList.push(fileRecord);
				walkStats.schemaFileCount += 1;
				parsedFile.rootNode.children.forEach((topNode) => planNode({ node: topNode, schemaFile, parentRecord: fileRecord, declarationRecord: undefined }));
				parsedFile.epilogCommentList.forEach((oneComment, commentIndex) => fileRecord.structureList.push({ locator: '/', construct: COMMENT_CONSTRUCT, placement: ROOT_PLACEMENT.EPILOG, commentIndex, commentText: oneComment.text }));
			});

			const staleRepeatSiteText = declaredRepeatSiteTextList.find((oneSiteText) => usedRepeatSiteTextList.indexOf(oneSiteText) === -1);
			if (staleRepeatSiteText !== undefined) {
				throw refusal(`enumerationRepeatList names '${staleRepeatSiteText}', which is no enumeration of a forged file`, 'a stale declaration is refused; remove it');
			}

			// -----------------------------------------------------------------
			// 2. MINT — every record, in plan order (a parent always before its children)
			// -----------------------------------------------------------------
			const roleByStableId = {};
			mintRecordList.forEach((record) => {
				const { node, schemaFile, role, nodeKind, stableId, name, nodePath, parentStableId, parentEdgeType, owningName, structureList } = record;
				const constructRule = constructRegistry.constructByName[node.construct];
				const carriedProperties = {
					[CONSTRUCT_PROPERTY_NAME]: node.construct,
					[LOCATOR_PROPERTY_NAME]: node.locator,
					[SCHEMA_FILE_PROPERTY_NAME]: schemaFile.schemaFileRelativePath,
				};
				if (nodeKind === 'schemaFile') {
					carriedProperties[TARGET_NAMESPACE_PROPERTY_NAME] = schemaFile.parsedFile.targetNamespace;
					carriedProperties[SCHEMA_ATTRIBUTE_LIST_PROPERTY_NAME] = JSON.stringify(schemaFile.parsedFile.schemaAttributeList);
					carriedProperties[SCHEMA_SET_NAME_LIST_PROPERTY_NAME] = JSON.stringify(schemaFile.schemaSetNameList);
				} else {
					constructRule.attributeCarriageList.filter((oneCarriage) => oneCarriage.propertyName !== 'name').forEach((oneCarriage) => {
						const attributeValue = attributeValueOf(node, oneCarriage.attributeName);
						if (attributeValue !== undefined) {
							carriedProperties[oneCarriage.propertyName] = attributeValue;
						}
					});
				}
				if (structureList.length !== 0) {
					// a JSON string, not a list: a one-entry list would be read back as a scalar (graph-contract §1)
					carriedProperties[STRUCTURE_LIST_PROPERTY_NAME] = JSON.stringify(structureList);
				}
				const description = nodeKind === 'schemaFile' ? undefined : descriptionOf(node);
				if (description !== undefined) {
					countInto(walkStats.describedNodeCountByRole, role);
				}
				const origin = `'${schemaFile.schemaFileRelativePath}' ${node.locator}`;
				if (role === DME_ROLES.OPTION_VALUE) {
					kit.emitOptionValue({ optionSetStableId: parentStableId, optionValueStableId: stableId, perStandardLabel: perStandardLabelByNodeKind[nodeKind], name, description, path: nodePath, owningName, carriedProperties, origin });
				} else {
					kit.makeNode({ role, perStandardLabel: perStandardLabelByNodeKind[nodeKind], stableId, name, description, structural: { parentId: parentStableId, path: nodePath, ...(owningName === undefined ? {} : { owningName }) }, carriedProperties, origin });
					kit.addEdge({ edgeType: parentEdgeType, fromStableId: parentStableId, toStableId: stableId, edgeContext: `${parentEdgeType}:${origin}` });
				}
				roleByStableId[stableId] = role;
			});

			// -----------------------------------------------------------------
			// 3. REFERENCES — every QName resolved through its own file; a corpus target gets its edge
			// -----------------------------------------------------------------
			pendingReferenceList.forEach(({ node, schemaFile, edgeSourceRecord, qnameRule, writtenQName }) => {
				const siteText = `'${schemaFile.schemaFileRelativePath}' ${node.locator} @${qnameRule.attributeName}`;
				const resolved = resolveWrittenQName({ resolutionTable, schemaFile, writtenQName, symbolSpace: qnameRule.symbolSpace, foreignNamespaceUriList, siteText });
				if (resolved.resolutionKind === 'builtin') {
					walkStats.builtinReferenceCount += 1;
					return;
				}
				if (resolved.resolutionKind === 'external') {
					countInto(walkStats.externalReferenceCountByNamespace, resolved.namespaceUri);
					return;
				}
				const targetRole = roleByStableId[resolved.targetStableId];
				const edgeType = qnameRule.edgeTypeByTargetRole[targetRole];
				if (edgeType === undefined) {
					throw refusal(`${siteText}: '${writtenQName}' reaches a ${targetRole} ('${resolved.targetStableId}'), and rule ${qnameRule.construct}/@${qnameRule.attributeName} names no edge for that role`, 'xsdConstructRegistry.json qnameAttributeRuleList edgeTypeByTargetRole');
				}
				kit.addEdge({
					edgeType: EDGE_TYPES[edgeType],
					fromStableId: edgeSourceRecord.stableId,
					toStableId: resolved.targetStableId,
					edgeContext: `${qnameRule.referenceConstruct}:${siteText}`,
					edgeProperties: {
						referenceConstruct: qnameRule.referenceConstruct,
						writtenQName,
						atLocator: node.locator,
						...(qnameRule.referenceConstruct === 'base' ? { derivationVariety: node.localTag } : {}),
					},
				});
				countInto(walkStats.referenceEdgeCountByConstruct, qnameRule.referenceConstruct);
			});

			Object.keys(walkStats).forEach((statName) => {
				kit.stats[statName] = walkStats[statName];
			});
			return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
		};

		return { emitContractGraph };
	};

module.exports = moduleFunction({ moduleName });
