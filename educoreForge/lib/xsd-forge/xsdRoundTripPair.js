'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdRoundTripPair.js — H4 for every XSD-kit forge bundle (wave 3 lane I, K3, ruled by BRONZE_CROWN 2026-10-24; the K0 form): a
// SOURCE-side canonicalizer and a GRAPH-side emitter held apart on purpose.
//
// THE CANONICALIZER reads the snapshot's bytes through xsdTree.js (the dumb element tree), never through the parser's construct model
// or the walk. The set loader says which files are forged and which are excluded (its accounting refuses an unaccounted file, so the
// file list is not taken on trust). Every forged file becomes LEAF statements, every value part of its KEY so the harness's key-only
// diff is also a value diff; a locator is /schema then /<local tag>[<index among same-tag siblings>], whatever the prefix:
//   file|<file>                                         a forged file (an excluded one: explicitly omitted, excludedSchemaFile)
//   node|<file>|<locator>|<local tag>                   every element of the file
//   attr|<file>|<locator>|<attribute>|<value>           every attribute, as written (xmlns bindings included)
//   text|<file>|<locator>|<JSON text>                   a documentation element's text, verbatim
//   comment|<file>|<locator>|<ordinal>|<at>|<JSON text> every comment: its element, its ordinal there, and the child index it precedes
//                                                       (prolog and epilog comments: locator '/', at 'prolog' or 'epilog')
// THE EMITTER reads only the materialized graph and rebuilds the same statements: a minted node from its xsdConstruct, xsdLocator,
// schemaFile and its construct's carried attributes (xsdConstructRegistry.json read backwards), a structure construct and a comment from
// its owner's xsdStructureList. A node property it has no reading for becomes an `unread|…` statement, which no source states, so an
// invented property counts as invented. DERIVED values are checked, never stated: a node's description (its own annotation's
// documentation texts, non-blank, joined by a newline), a reference's name (the local part of its ref=), the ownership edges (one from
// the node's parentId, whose locator encloses the node's), and the reference edges: the emitter RE-RESOLVES every QName attribute from
// the graph alone (the file's bindings on its schemaFile node, the definitions' namespaces and names) and expects exactly the edges a
// corpus target needs. A fault in any of these is fatal.

const fs = require('fs');
const path = require('path');
const { DME_ROLES, EQUIVALENCE_NODE_LABELS } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { validateXsdProfile } = require('./xsdProfileContract');
const { parseXsdTree } = require('./xsdTree')();
const xsdSetLoaderFactory = require('./xsdSetLoader');
const constructRegistry = require('./xsdConstructRegistry.json');

const ROOT_ROLE = DME_ROLES.STANDARD_ROOT;
const NOT_SOURCE_ROLE_LIST = Object.freeze([DME_ROLES.EMBED_TEXT, EQUIVALENCE_NODE_LABELS.HUB_REFERENCE, EQUIVALENCE_NODE_LABELS.HUB_DEFINITION]);
// the properties the framework derives or stamps on every content node: identity, structure, search; never a source statement
const DERIVED_PROPERTY_NAME_LIST = Object.freeze(['_id', '_source', 'stableId', 'role', 'name', 'searchText', 'parentId', 'path', 'depth', 'crossRefs', 'embedding', 'embeddingModelVersion', 'description']);
const WALK_PROPERTY_NAME = Object.freeze({ CONSTRUCT: 'xsdConstruct', LOCATOR: 'xsdLocator', SCHEMA_FILE: 'schemaFile', STRUCTURE_LIST: 'xsdStructureList', SCHEMA_ATTRIBUTE_LIST: 'schemaAttributeList', SCHEMA_SET_NAME_LIST: 'schemaSetNameList', TARGET_NAMESPACE: 'targetNamespace' });
const COMMENT_CONSTRUCT = 'comment';
const SCHEMA_CONSTRUCT = 'schema';
const SCHEMA_LOCATOR = '/schema';
const ROOT_LOCATOR = '/';
const DESCRIPTION_SEPARATOR = '\n';
const OWNERSHIP_EDGE_TYPE_LIST = Object.freeze(['HAS_SUPPORT', 'HAS_CLASS', 'HAS_DEFINITION', 'HAS_PROPERTY', 'HAS_VALUE', 'REFERENCES_TYPE', 'HAS_OPTION_SET']);
const XMLNS_ATTRIBUTE_PATTERN = /^xmlns(:(.+))?$/;
// the constructs the ROOT owns (xsdWalk.js: a file by HAS_SUPPORT, a named complexType by HAS_CLASS); every other node's owner encloses it
const ROOT_OWNED_CONSTRUCT_LIST = Object.freeze([SCHEMA_CONSTRUCT, 'globalComplexType']);

const OMITTED_KIND = Object.freeze({ EXCLUDED_SCHEMA_FILE: 'excludedSchemaFile' });
const OMITTED_KIND_PROPERTY_NAME = 'omittedKind';
const omitted = (kind) => ({ explicitlyOmitted: true, [OMITTED_KIND_PROPERTY_NAME]: kind });

const localNameOf = (qualifiedName) => qualifiedName.slice(qualifiedName.indexOf(':') + 1);
const prefixOf = (qualifiedName) => (qualifiedName.indexOf(':') === -1 ? '' : qualifiedName.slice(0, qualifiedName.indexOf(':')));
const localTagOfLocator = (locator) => locator.split('/').pop().replace(/\[[0-9]+\]$/, '');
const parentLocatorOf = (locator) => locator.slice(0, locator.lastIndexOf('/'));

// the statement keys, one builder each, shared by both sides so a spelling cannot differ between them
const STATEMENT_KEY = Object.freeze({
	file: ({ schemaFile }) => `file|${schemaFile}`,
	node: ({ schemaFile, locator, localTag }) => `node|${schemaFile}|${locator}|${localTag}`,
	attr: ({ schemaFile, locator, attributeName, attributeValue }) => `attr|${schemaFile}|${locator}|${attributeName}|${attributeValue}`,
	text: ({ schemaFile, locator, documentationText }) => `text|${schemaFile}|${locator}|${JSON.stringify(documentationText)}`,
	comment: ({ schemaFile, locator, commentIndex, commentAt, commentText }) => `comment|${schemaFile}|${locator}|${commentIndex}|${commentAt}|${JSON.stringify(commentText)}`,
	unread: ({ stableId, propertyName, propertyValue }) => `unread|${stableId}|${propertyName}|${JSON.stringify(propertyValue)}`,
});

const silentLog = Object.freeze({ status: () => undefined });

const moduleFunction =
	({ moduleName } = {}) =>
	({ xsdProfile, stableUriPropertyName, ruleModulePath }) => {
		validateXsdProfile(xsdProfile);
		const xsdSetLoader = xsdSetLoaderFactory({ xsdProfile });
		const foreignNamespaceUriList = xsdProfile.foreignNamespaceList.map((oneRow) => oneRow.namespace);
		const ignoredPropertyNameList = DERIVED_PROPERTY_NAME_LIST.concat([stableUriPropertyName], Object.values(WALK_PROPERTY_NAME));

		// -----------------------------------------------------------------
		// canonicalizeSource — the snapshot's XSD bytes → statements (never the graph, never the walk)
		// -----------------------------------------------------------------
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			xsdSetLoader.loadSchemaSets({ sourcePath: snapshotPath, additionalSourceInputPathByName: {}, xLog: silentLog }, (loadError, loaded) => {
				if (loadError) {
					callback(loadError);
					return;
				}
				const statements = new Map();
				loaded.excludedFileList.forEach((schemaFile) => statements.set(STATEMENT_KEY.file({ schemaFile }), omitted(OMITTED_KIND.EXCLUDED_SCHEMA_FILE)));
				const treeRefusalList = [];
				loaded.schemaFileList.forEach(({ schemaFileRelativePath: schemaFile }) => {
					const treeResult = parseXsdTree({ xmlText: fs.readFileSync(path.join(snapshotPath, schemaFile), 'utf8'), filename: schemaFile });
					if (treeResult.error !== undefined) {
						treeRefusalList.push(treeResult.error);
						return;
					}
					statements.set(STATEMENT_KEY.file({ schemaFile }), {});
					treeResult.prologCommentList.forEach((oneComment, commentIndex) => statements.set(STATEMENT_KEY.comment({ schemaFile, locator: ROOT_LOCATOR, commentIndex, commentAt: 'prolog', commentText: oneComment.text }), {}));
					treeResult.epilogCommentList.forEach((oneComment, commentIndex) => statements.set(STATEMENT_KEY.comment({ schemaFile, locator: ROOT_LOCATOR, commentIndex, commentAt: 'epilog', commentText: oneComment.text }), {}));
					const visitTree = ({ treeNode, locator }) => {
						statements.set(STATEMENT_KEY.node({ schemaFile, locator, localTag: localNameOf(treeNode.tag) }), {});
						treeNode.attributeOrder.forEach((attributeName) => statements.set(STATEMENT_KEY.attr({ schemaFile, locator, attributeName, attributeValue: treeNode.attributes[attributeName] }), {}));
						if (localNameOf(treeNode.tag) === 'documentation') {
							statements.set(STATEMENT_KEY.text({ schemaFile, locator, documentationText: treeNode.text }), {});
						}
						treeNode.commentList.forEach((oneComment, commentIndex) => statements.set(STATEMENT_KEY.comment({ schemaFile, locator, commentIndex, commentAt: oneComment.beforeChildIndex, commentText: oneComment.text }), {}));
						const indexByTag = {};
						treeNode.children.forEach((childTree) => {
							const childTag = localNameOf(childTree.tag);
							indexByTag[childTag] = (indexByTag[childTag] || 0) + 1;
							visitTree({ treeNode: childTree, locator: `${locator}/${childTag}[${indexByTag[childTag]}]` });
						});
					};
					visitTree({ treeNode: treeResult.root, locator: SCHEMA_LOCATOR });
				});
				if (treeRefusalList.length !== 0) {
					callback(`${moduleName} REFUSED: ${treeRefusalList[0]}`);
					return;
				}
				callback('', { statements, stats: { statementCount: statements.size } });
			});
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
				const faultList = [];
				const sourceNodeList = graph.nodes.filter((oneNode) => oneNode.role !== ROOT_ROLE && NOT_SOURCE_ROLE_LIST.indexOf(oneNode.role) === -1);
				const nodeById = graph.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
				const rootNode = graph.nodes.find((oneNode) => oneNode.role === ROOT_ROLE);
				const schemaFileNodeByPath = sourceNodeList.filter((oneNode) => oneNode.properties[WALK_PROPERTY_NAME.CONSTRUCT] === SCHEMA_CONSTRUCT).reduce((byPath, oneNode) => ({ ...byPath, [oneNode.properties[WALK_PROPERTY_NAME.SCHEMA_FILE]]: oneNode }), {});
				const set = (statementKey) => statements.set(statementKey, {});
				const jsonOf = (oneNode, propertyName) => (oneNode.properties[propertyName] === undefined ? [] : JSON.parse(oneNode.properties[propertyName]));

				// structureStatements — one xsdStructureList entry back to its statements
				const structureStatements = ({ schemaFile, entry }) => {
					if (entry.construct === COMMENT_CONSTRUCT) {
						set(STATEMENT_KEY.comment({ schemaFile, locator: entry.locator, commentIndex: entry.commentIndex, commentAt: entry.placement === undefined ? entry.beforeChildIndex : entry.placement, commentText: entry.commentText }));
						return;
					}
					set(STATEMENT_KEY.node({ schemaFile, locator: entry.locator, localTag: entry.localTag }));
					entry.attributeList.forEach(({ attributeName, attributeValue }) => set(STATEMENT_KEY.attr({ schemaFile, locator: entry.locator, attributeName, attributeValue })));
					if (entry.documentationText !== undefined) {
						set(STATEMENT_KEY.text({ schemaFile, locator: entry.locator, documentationText: entry.documentationText }));
					}
				};

				// the QName attributes the graph states, gathered for the re-resolution below: { sourceStableId, construct, attributeName, writtenText, atLocator, schemaFile }
				const statedQNameList = [];

				sourceNodeList.forEach((oneNode) => {
					const { stableId, properties } = oneNode;
					const construct = properties[WALK_PROPERTY_NAME.CONSTRUCT];
					const locator = properties[WALK_PROPERTY_NAME.LOCATOR];
					const schemaFile = properties[WALK_PROPERTY_NAME.SCHEMA_FILE];
					const constructRule = constructRegistry.constructByName[construct];
					if (constructRule === undefined || typeof locator !== 'string' || typeof schemaFile !== 'string') {
						faultList.push(`node '${stableId}' carries no readable xsdConstruct / xsdLocator / schemaFile`);
						return;
					}
					set(STATEMENT_KEY.node({ schemaFile, locator, localTag: localTagOfLocator(locator) }));
					if (construct === SCHEMA_CONSTRUCT) {
						set(STATEMENT_KEY.file({ schemaFile }));
						jsonOf(oneNode, WALK_PROPERTY_NAME.SCHEMA_ATTRIBUTE_LIST).forEach(({ attributeName, attributeValue }) => set(STATEMENT_KEY.attr({ schemaFile, locator, attributeName, attributeValue })));
					} else {
						constructRule.attributeCarriageList.forEach(({ attributeName, propertyName }) => {
							const attributeValue = propertyName === 'name' ? properties.name : properties[propertyName];
							if (attributeValue !== undefined) {
								set(STATEMENT_KEY.attr({ schemaFile, locator, attributeName, attributeValue }));
								statedQNameList.push({ sourceStableId: stableId, construct, attributeName, writtenText: attributeValue, atLocator: locator, schemaFile });
							}
						});
						if (constructRule.nameFromQNameAttribute !== undefined) {
							const writtenReference = properties[constructRule.attributeCarriageList.find((oneCarriage) => oneCarriage.attributeName === constructRule.nameFromQNameAttribute).propertyName];
							if (writtenReference === undefined || properties.name !== localNameOf(writtenReference)) {
								faultList.push(`node '${stableId}' is named ${JSON.stringify(properties.name)}, not the local part of its ${constructRule.nameFromQNameAttribute}= ${JSON.stringify(writtenReference)}`);
							}
						}
					}
					const carriedPropertyNameList = constructRule.carriesEveryAttribute === true ? [] : constructRule.attributeCarriageList.map((oneCarriage) => oneCarriage.propertyName);
					Object.keys(properties).filter((propertyName) => ignoredPropertyNameList.indexOf(propertyName) === -1 && carriedPropertyNameList.indexOf(propertyName) === -1).forEach((propertyName) => {
						set(STATEMENT_KEY.unread({ stableId, propertyName, propertyValue: properties[propertyName] }));
					});
					const structureList = jsonOf(oneNode, WALK_PROPERTY_NAME.STRUCTURE_LIST);
					structureList.forEach((entry) => {
						structureStatements({ schemaFile, entry });
						if (entry.construct !== COMMENT_CONSTRUCT) {
							entry.attributeList.forEach(({ attributeName, attributeValue }) => statedQNameList.push({ sourceStableId: stableId, construct: entry.construct, attributeName, writtenText: attributeValue, atLocator: entry.locator, schemaFile }));
						}
					});
					// derived: the description is the node's own annotation documentation (non-blank, verbatim, joined)
					const ownDocumentationPattern = new RegExp(`^${locator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/annotation\\[[0-9]+\\]/documentation\\[[0-9]+\\]$`);
					const expectedTextList = structureList.filter((entry) => entry.construct === 'documentation' && ownDocumentationPattern.test(entry.locator) && entry.documentationText.trim() !== '').map((entry) => entry.documentationText);
					const expectedDescription = construct === SCHEMA_CONSTRUCT || expectedTextList.length === 0 ? undefined : expectedTextList.join(DESCRIPTION_SEPARATOR);
					if (properties.description !== expectedDescription) {
						faultList.push(`node '${stableId}' description ${JSON.stringify(properties.description)} is not its own annotation's documentation ${JSON.stringify(expectedDescription)}`);
					}
					// derived: one ownership edge from the parentId, whose locator encloses this one (the root owns the files and the named complexTypes)
					const parentNode = nodeById[properties.parentId];
					const ownershipEdgeList = graph.edges.filter((oneEdge) => oneEdge.toStableId === stableId && OWNERSHIP_EDGE_TYPE_LIST.indexOf(oneEdge.type) !== -1 && oneEdge.properties.referenceConstruct === undefined);
					const enclosesNode = parentNode !== undefined && (parentNode === rootNode
						? ROOT_OWNED_CONSTRUCT_LIST.indexOf(construct) !== -1
						: parentNode.properties[WALK_PROPERTY_NAME.SCHEMA_FILE] === schemaFile && locator.startsWith(`${parentNode.properties[WALK_PROPERTY_NAME.LOCATOR]}/`));
					if (!enclosesNode || ownershipEdgeList.length !== 1 || ownershipEdgeList[0].fromStableId !== properties.parentId) {
						faultList.push(`node '${stableId}' is not owned by exactly one edge from an enclosing parent (parentId ${properties.parentId}, ${ownershipEdgeList.length} ownership edges)`);
					}
				});

				// RE-RESOLUTION: every stated QName, from the graph alone, against the definitions the graph holds
				const definitionStableIdByResolutionName = {};
				sourceNodeList.forEach((oneNode) => {
					const constructRule = constructRegistry.constructByName[oneNode.properties[WALK_PROPERTY_NAME.CONSTRUCT]];
					const fileNode = schemaFileNodeByPath[oneNode.properties[WALK_PROPERTY_NAME.SCHEMA_FILE]];
					if (constructRule !== undefined && constructRule.symbolSpace !== undefined && fileNode !== undefined) {
						definitionStableIdByResolutionName[`${fileNode.properties[WALK_PROPERTY_NAME.TARGET_NAMESPACE]}#${constructRule.symbolSpace}/${oneNode.properties.name}`] = oneNode.stableId;
					}
				});
				const bindingByFile = {};
				Object.keys(schemaFileNodeByPath).forEach((schemaFile) => {
					bindingByFile[schemaFile] = jsonOf(schemaFileNodeByPath[schemaFile], WALK_PROPERTY_NAME.SCHEMA_ATTRIBUTE_LIST).reduce((byPrefix, { attributeName, attributeValue }) => {
						const xmlnsMatch = attributeName.match(XMLNS_ATTRIBUTE_PATTERN);
						return xmlnsMatch === null ? byPrefix : { ...byPrefix, [xmlnsMatch[2] === undefined ? '' : xmlnsMatch[2]]: attributeValue };
					}, { ...constructRegistry.implicitPrefixBindingByPrefix });
				});
				const expectedEdgeTextList = [];
				statedQNameList.forEach(({ sourceStableId, construct, attributeName, writtenText, atLocator, schemaFile }) => {
					const qnameRule = constructRegistry.qnameAttributeRuleList.find((oneRule) => oneRule.construct === construct && oneRule.attributeName === attributeName);
					if (qnameRule === undefined) {
						return;
					}
					(qnameRule.isList ? writtenText.split(/\s+/).filter((oneName) => oneName !== '') : [writtenText]).forEach((writtenQName) => {
						const namespaceUri = (bindingByFile[schemaFile] || {})[prefixOf(writtenQName)];
						if (namespaceUri === constructRegistry.xsdNamespace || foreignNamespaceUriList.indexOf(namespaceUri) !== -1) {
							return; // built-in or external: no edge
						}
						const targetStableId = definitionStableIdByResolutionName[`${namespaceUri}#${qnameRule.symbolSpace}/${localNameOf(writtenQName)}`];
						if (targetStableId === undefined) {
							faultList.push(`'${schemaFile}' ${atLocator} @${attributeName} '${writtenQName}' resolves to no definition the graph holds`);
							return;
						}
						expectedEdgeTextList.push(`${sourceStableId}|${qnameRule.edgeTypeByTargetRole[nodeById[targetStableId].role]}|${targetStableId}|${qnameRule.referenceConstruct}|${writtenQName}|${atLocator}`);
					});
				});
				const actualEdgeTextList = graph.edges
					.filter((oneEdge) => oneEdge.properties.referenceConstruct !== undefined)
					.map((oneEdge) => `${oneEdge.fromStableId}|${oneEdge.type}|${oneEdge.toStableId}|${oneEdge.properties.referenceConstruct}|${oneEdge.properties.writtenQName}|${oneEdge.properties.atLocator}`);
				const missingEdgeText = expectedEdgeTextList.find((oneText) => actualEdgeTextList.indexOf(oneText) === -1);
				const inventedEdgeText = actualEdgeTextList.find((oneText) => expectedEdgeTextList.indexOf(oneText) === -1);
				if (missingEdgeText !== undefined || inventedEdgeText !== undefined || expectedEdgeTextList.length !== actualEdgeTextList.length) {
					faultList.push(`reference edges disagree with the stated QNames (expected ${expectedEdgeTextList.length}, found ${actualEdgeTextList.length}; first missing ${JSON.stringify(missingEdgeText)}; first invented ${JSON.stringify(inventedEdgeText)})`);
				}
				if (faultList.length !== 0) {
					callback('', { fault: `${faultList.length} fault(s); first: ${faultList[0]}` });
					return;
				}
				callback('', { statements, stats: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, statementCount: statements.size } });
			});
		};

		const omissionDeclaration = Object.freeze({
			rule: ruleModulePath,
			kindPropertyName: OMITTED_KIND_PROPERTY_NAME,
			kindList: Object.freeze(Object.values(OMITTED_KIND)),
			textBearingKindList: Object.freeze([]),
			textPropertyName: '',
			caveatText: "excludedSchemaFile is each .xsd or .wsdl of the snapshot the bundle's profile names in schemaFileExclusionList, with its reason: one statement per file; nothing inside an excluded file is read.",
		});

		const semanticValidationLimit =
			'SEMANTIC round trip of the forged XSD files over the statement domain THIS INSTRUMENT MODELS: every element of every forged file at its locator ' +
			'(local tag and same-tag sibling index, so the prefix is not a statement but the xmlns bindings are), every attribute as written, every ' +
			'documentation text verbatim, every comment with its element, ordinal and following child index, and every forged file. Read back from the ' +
			'minted nodes (construct, locator, file, the registry\'s carried attributes) and their xsdStructureList; a node property with no reading is an ' +
			'invented statement. CHECKED, not stated: descriptions, reference names, ownership edges, and every reference edge, re-resolved from the graph ' +
			'alone. EXPLICITLY OMITTED and listed: the excluded files. NOT modelled: attribute ORDER and whitespace between elements (no meaning in XML ' +
			'Schema), derived values (path, searchText, embed texts) and the root\'s provenance fields (checked by the framework).';

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration };
	};

module.exports = moduleFunction({ moduleName });
