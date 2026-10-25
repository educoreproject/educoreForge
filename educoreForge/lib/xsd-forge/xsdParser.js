'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdParser.js — one XSD file's text -> a literal construct model (wave 3 lane I, K3, ruled by BRONZE_CROWN 2026-10-24). PURE and
// synchronous; a refusal is a thrown named Error (the framework's one adapter, or the set loader's callback boundary, hands it on).
//
// WHAT IT DOES. xsdTree.js gives a dumb element tree (tags as written, attributes in order, text, comments). This module:
//   * resolves every tag by its NAMESPACE, through the schema element's xmlns bindings, never by its prefix: MedBiquitous writes 'xsd:',
//     PESC 'xs:', and an unprefixed tag under a default XSD namespace is the same construct;
//   * names each tag's construct from xsdConstructRegistry.json tagRuleList by (local name, position): 'top' is a child of schema,
//     'localWithRef' a non-top element/attribute/group/attributeGroup carrying ref=, 'local' any other;
//   * gives each node its LOCATOR: /schema, then /<local tag>[<1-based index among same-tag siblings>] per level, so a locator names one
//     node of one file whatever its prefix;
//   * checks each attribute against its construct's carriage list (the schema element carries every attribute: its xmlns bindings
//     become prefixBindingByPrefix, the rest are kept as written);
//   * keeps documentation text verbatim and every comment where it stood (the walk places both).
// REFUSED BY NAME, never skipped: a tag outside the XSD namespace, a tag or position the registry does not list, an attribute its
// construct does not carry, an xmlns binding below the schema element, a prefix no binding names, text outside documentation, an
// element inside documentation.
//
// parseXsdFile({ fileText, schemaFileRelativePath }) -> { targetNamespace, prefixBindingByPrefix, schemaAttributeList, rootNode,
//   prologCommentList, epilogCommentList }
// node: { construct, localTag, locator, attributeList: [{ attributeName, attributeValue }], children, documentationText, commentList, line }

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { parseXsdTree } = require('./xsdTree')();
const constructRegistry = require('./xsdConstructRegistry.json');

const XMLNS_ATTRIBUTE_PATTERN = /^xmlns(:(.+))?$/;
const DEFAULT_PREFIX = '';
const POSITION = Object.freeze({ DOCUMENT: 'document', TOP: 'top', LOCAL: 'local', LOCAL_WITH_REF: 'localWithRef' });
// the tags whose non-top form names its target by ref= (and so is a reference, not a declaration)
const REFERENCE_CAPABLE_TAG_LIST = Object.freeze(['element', 'attribute', 'group', 'attributeGroup']);
const REFERENCE_ATTRIBUTE_NAME = 'ref';
const SCHEMA_TAG = 'schema';

const constructByTagAndPosition = constructRegistry.tagRuleList.reduce((byTag, oneRule) => ({ ...byTag, [`${oneRule.tag}|${oneRule.position}`]: oneRule.construct }), {});

const refusal = (what, where) => refuse.byName({ moduleName, what, where });

// prefixOfQualifiedName — 'xsd:element' -> { prefix: 'xsd', localName: 'element' }; 'element' -> { prefix: '', localName: 'element' }
const prefixOfQualifiedName = (qualifiedName) => {
	const colonIndex = qualifiedName.indexOf(':');
	return colonIndex === -1 ? { prefix: DEFAULT_PREFIX, localName: qualifiedName } : { prefix: qualifiedName.slice(0, colonIndex), localName: qualifiedName.slice(colonIndex + 1) };
};

// positionOf — a tree node's position: document (the root), top (a child of schema), localWithRef or local
const positionOf = ({ localTag, parentLocalTag, attributes, isRoot }) => {
	if (isRoot) {
		return POSITION.DOCUMENT;
	}
	if (parentLocalTag === SCHEMA_TAG) {
		return POSITION.TOP;
	}
	return REFERENCE_CAPABLE_TAG_LIST.indexOf(localTag) !== -1 && attributes[REFERENCE_ATTRIBUTE_NAME] !== undefined ? POSITION.LOCAL_WITH_REF : POSITION.LOCAL;
};

const parseXsdFile = ({ fileText, schemaFileRelativePath }) => {
	const origin = `schema file '${schemaFileRelativePath}'`;
	let treeResult;
	try {
		treeResult = parseXsdTree({ xmlText: fileText, filename: schemaFileRelativePath });
	} catch (saxError) {
		// localized parse boundary (the openapiSourceParser.js form): sax THROWS on some malformations (an unmatched closing tag) instead of
		// reporting them through xsdTree.js's onerror, and xsdTree.js is a byte copy, so the throw is named here, with its file
		treeResult = { error: saxError.message.split('\n')[0] };
	}
	if (treeResult.error !== undefined) {
		throw refusal(`${origin}: ${treeResult.error}`, 'the snapshot holds well-formed XML; reacquire per README_PROVENANCE.md');
	}
	const rootTree = treeResult.root;

	// the schema element's bindings: the only place a prefix may be bound
	const prefixBindingByPrefix = { ...constructRegistry.implicitPrefixBindingByPrefix };
	const schemaAttributeList = rootTree.attributeOrder.map((attributeName) => ({ attributeName, attributeValue: rootTree.attributes[attributeName] }));
	schemaAttributeList.forEach(({ attributeName, attributeValue }) => {
		const xmlnsMatch = attributeName.match(XMLNS_ATTRIBUTE_PATTERN);
		if (xmlnsMatch !== null) {
			prefixBindingByPrefix[xmlnsMatch[2] === undefined ? DEFAULT_PREFIX : xmlnsMatch[2]] = attributeValue;
		}
	});
	const rootTagParts = prefixOfQualifiedName(rootTree.tag);
	if (prefixBindingByPrefix[rootTagParts.prefix] !== constructRegistry.xsdNamespace || rootTagParts.localName !== SCHEMA_TAG) {
		throw refusal(`${origin}: the root element is '${rootTree.tag}' (namespace ${JSON.stringify(prefixBindingByPrefix[rootTagParts.prefix])})`, `an XSD file's root is schema in ${constructRegistry.xsdNamespace}`);
	}

	// convertNode — one tree node and its subtree into the construct model
	const convertNode = ({ treeNode, parentLocalTag, locator, isRoot }) => {
		const tagParts = prefixOfQualifiedName(treeNode.tag);
		const siteText = `${origin} line ${treeNode.line} (<${treeNode.tag}> at ${locator})`;
		if (prefixBindingByPrefix[tagParts.prefix] === undefined) {
			throw refusal(`${siteText}: prefix '${tagParts.prefix}' is bound by no xmlns on the schema element`, 'every tag prefix is bound on the schema element');
		}
		if (prefixBindingByPrefix[tagParts.prefix] !== constructRegistry.xsdNamespace) {
			throw refusal(`${siteText}: the tag is in namespace '${prefixBindingByPrefix[tagParts.prefix]}', not XML Schema`, 'no foreign element (appinfo content, documentation markup) has been taught; teach it by a registry row with its twin');
		}
		if (!isRoot) {
			const lateBinding = treeNode.attributeOrder.find((attributeName) => XMLNS_ATTRIBUTE_PATTERN.test(attributeName));
			if (lateBinding !== undefined) {
				throw refusal(`${siteText}: '${lateBinding}' binds a prefix below the schema element`, 'the kit resolves every prefix through the schema element alone; a nested binding is untaught');
			}
		}
		const position = positionOf({ localTag: tagParts.localName, parentLocalTag, attributes: treeNode.attributes, isRoot });
		const construct = constructByTagAndPosition[`${tagParts.localName}|${position}`];
		if (construct === undefined) {
			throw refusal(`${siteText}: '${tagParts.localName}' at position '${position}' is not a taught construct`, 'xsdConstructRegistry.json tagRuleList lists every (tag, position) the kit reads; a construct silently skipped is content silently lost');
		}
		const constructRule = constructRegistry.constructByName[construct];
		const attributeList = treeNode.attributeOrder.map((attributeName) => ({ attributeName, attributeValue: treeNode.attributes[attributeName] }));
		if (constructRule.carriesEveryAttribute !== true) {
			const carriedNameList = constructRule.attributeCarriageList.map((oneCarriage) => oneCarriage.attributeName);
			const untaughtAttribute = attributeList.find((oneAttribute) => carriedNameList.indexOf(oneAttribute.attributeName) === -1);
			if (untaughtAttribute !== undefined) {
				throw refusal(`${siteText}: attribute '${untaughtAttribute.attributeName}' is not carried by construct '${construct}'`, `xsdConstructRegistry.json constructByName.${construct} carries ${carriedNameList.length === 0 ? 'no attribute' : carriedNameList.join(', ')}; an attribute silently dropped is content silently lost`);
			}
		}
		const isTextBearing = constructRule.carriesText === true;
		if (isTextBearing && treeNode.children.length !== 0) {
			throw refusal(`${siteText}: documentation holds the element <${treeNode.children[0].tag}>`, 'documentation is carried as text; markup inside it is untaught');
		}
		if (!isTextBearing && treeNode.text.trim() !== '') {
			throw refusal(`${siteText}: the element holds text ${JSON.stringify(treeNode.text.trim().slice(0, 60))}`, 'only documentation carries text');
		}
		const indexByTag = {};
		const children = treeNode.children.map((childTree) => {
			const childLocalTag = prefixOfQualifiedName(childTree.tag).localName;
			indexByTag[childLocalTag] = (indexByTag[childLocalTag] || 0) + 1;
			return convertNode({ treeNode: childTree, parentLocalTag: tagParts.localName, locator: `${locator}/${childLocalTag}[${indexByTag[childLocalTag]}]`, isRoot: false });
		});
		return {
			construct,
			localTag: tagParts.localName,
			locator,
			attributeList,
			children,
			...(isTextBearing ? { documentationText: treeNode.text } : {}),
			commentList: treeNode.commentList.map((oneComment) => ({ text: oneComment.text, beforeChildIndex: oneComment.beforeChildIndex })),
			line: treeNode.line,
		};
	};

	const rootNode = convertNode({ treeNode: rootTree, parentLocalTag: undefined, locator: `/${SCHEMA_TAG}`, isRoot: true });
	const targetNamespaceAttribute = schemaAttributeList.find((oneAttribute) => oneAttribute.attributeName === 'targetNamespace');
	if (targetNamespaceAttribute === undefined || targetNamespaceAttribute.attributeValue === '') {
		throw refusal(`${origin} declares no targetNamespace`, 'a no-namespace (chameleon) schema is untaught: identity is keyed on the namespace');
	}
	return {
		targetNamespace: targetNamespaceAttribute.attributeValue,
		prefixBindingByPrefix,
		schemaAttributeList,
		rootNode,
		prologCommentList: treeResult.prologCommentList.map((oneComment) => ({ text: oneComment.text })),
		epilogCommentList: treeResult.epilogCommentList.map((oneComment) => ({ text: oneComment.text })),
	};
};

module.exports = { parseXsdFile, prefixOfQualifiedName, moduleName };
