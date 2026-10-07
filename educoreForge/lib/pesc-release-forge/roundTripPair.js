'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripPair.js — the two sides of the PESC release round trip (DESIGN-pescForge.md §5; WORKORDER
// §3 F4). The SOURCE side reads only the snapshot's .xsd bytes; the GRAPH side reads only the graph
// reader, regenerates every .xsd file of the release as text, and reads that text with the SAME
// canonicalizer. Both produce Map<statementKey, statement>; diffStatements compares values.
//
//   makeRoundTripPair({ labelPrefix })
//     → { canonicalizeSource, emitFromGraph, diffStatements, semanticValidationLimit,
//         regenerateFromGraph, lastRegeneration }
//   canonicalStatementsOfXsdText({ fileName, xsdText, includeOmitted }) → { statementList, omittedCountByKind } | { faultText }
//   regenerateXsdTextByFileName({ nodes, edges, labelPrefix }) → { fileTextByName, stats } | { fault }
//
// THE CANONICALIZER IS NOT THE FORGE'S PARSER (WORKORDER F4 rule). It is a second, small sax walk
// written for this proof: it requires neither xsdTree.js, xsdParser.js nor resolutionTable.js, refuses
// nothing, and resolves every QName-valued attribute (type, base, ref, substitutionGroup) through the
// xmlns bindings in scope at that element, by its own reading. So a fault in the forge's reading
// cannot hide behind the same fault in the proof.
//
// STATEMENTS, one per XSD element, keyed '<file>|<path>' where the path's segments are: under
// xs:schema, 'import:<namespace>', '<tag>:<name>' for a named definition, 'annotation'; elsewhere
// 'annotation', 'documentation#<k>', 'enumeration#<k>' (k-th of its kind), 'facet:<tag>' (a facet's
// order does not matter to XSD; a repeat is refused by the forge's parser), and '<ordinal>:<tag>' for
// every other child, the ordinal counted among those children: so the compositor tree, nested
// xs:choice inside xs:sequence included (NOTES-supervisor item 6), is a set of positioned statements.
// A statement's value is { tag, attributeList } (sorted name/value pairs, xmlns declarations left out,
// QNames resolved to '{namespace}local', and a prefixed attribute NAME resolved the same way);
// documentation adds its text, verbatim. One statement
// '<file>|schemaChildOrder' lists xs:schema's children in order.
// Source only, each flagged explicitlyOmitted (the verdict's explicitlyOmittedTotal): every XML
// comment, every whitespace-only text run outside documentation, every processing instruction (the
// XML declaration). Non-whitespace text outside documentation would be a content statement.
//
// THE EMITTER classifies every node by GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE and reads only the SOURCE
// kinds; Root, Release, Occurrence and EmbedText are DERIVED_STRUCTURE and are never read (gate F20).
// A node with no classified label, or two, is an emission FAULT. It writes, per schema file, the
// schema element (schemaAttributeList; a '{namespace}local' attribute under a prefix the emitter binds),
// then imports, definitions and schema-level annotations in document order (an annotation after the
// documentPosition it follows, fileAnnotationList); inside a definition its annotation (every
// documentationValueList entry), its derivation (contentStyle wrapper, base from baseTypeQName, the
// derivation's own annotation, facets, codes in codePosition order),
// its compositor tree from contentModelShape (elements by sequencePosition, group references
// resolved through the owner's REFERENCES edges, wildcards as written), its attributes; inside an
// element, attribute or global element its annotation (every documentationValueList entry, an empty
// and a second one included) and its anonymous type. Prefixes are the emitter's own (xs, ns1, ns2, …): the graph keeps
// resolved names, not the files' xmlns bindings, and the canonicalizer compares resolved names.
// A one-element list read back from a live graph is a scalar (the replay engine's storage); every list
// property is widened.
//
// BORROWED TEXT IS NOT THE RELEASE (phase F-B, DESIGN-pescForge.md §2.7). The exclusion is by name, on
// both sides: the SOURCE side never reads a file in the snapshot's DONOR_FOLDER_NAME folder (the
// later-edition files a release borrows text from are verified like every snapshot byte, but they are
// not the release), and the EMITTER reads none of BORROWED_PROPERTY_NAME_LIST (it writes an element's
// annotation from documentationValueList alone). The name is kept here, not required from
// documentationDonorSet.js, because the canonicalizer requires none of the forge's readers; gate F21
// holds the two names equal.

const fs = require('fs');
const path = require('path');
const sax = require('sax');

const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';
const XSD_PREFIX = 'xs';
const XSD_FILE_NAME_RE = /\.xsd$/i;
const STATEMENT_SEPARATOR = '|';
const PATH_SEPARATOR = '/';
const QNAME_ATTRIBUTE_NAME_LIST = Object.freeze(['type', 'base', 'ref', 'substitutionGroup']);
// the one prefix bound without a declaration (Namespaces in XML 1.0)
const XML_PREFIX_BINDING = Object.freeze({ xml: 'http://www.w3.org/XML/1998/namespace' });
// a namespaced attribute name in a statement and in the graph: '{namespace}local'
const NAMESPACED_ATTRIBUTE_NAME_RE = /^\{([^}]+)\}(.+)$/;
const FACET_TAG_LIST = Object.freeze(['length', 'minLength', 'maxLength', 'pattern', 'whiteSpace', 'maxInclusive', 'maxExclusive', 'minInclusive', 'minExclusive', 'totalDigits', 'fractionDigits']);
// annotations after one position are placed at position + k / divisor, before the next whole position
const FILE_ANNOTATION_POSITION_DIVISOR = 1000;
const OMITTED_KIND = Object.freeze({ COMMENT: 'comment', WHITESPACE: 'whitespace', PROCESSING_INSTRUCTION: 'processingInstruction' });
const LOST_REASON = Object.freeze({ ABSENT_FROM_GRAPH: 'absentFromGraph', VALUE_DIFFERS: 'valueDiffers' });
// ⟪G21⟫ the declaration the verdict carries: THIS module is the rule, the three OMITTED_KIND words are the only kinds it
// may omit, and the caveat says what the one kind with prose in it can hold. Comments are mostly rulers and banners, but
// some carry content the graph does not (change-log lines, a deprecation notice on AgencyAssignedID): PLAN G20.
const OMISSION_DECLARATION = Object.freeze({
	rule: 'lib/pesc-release-forge/roundTripPair.js',
	kindPropertyName: 'omittedKind',
	kindList: Object.freeze(Object.values(OMITTED_KIND)),
	// ⟪G21b⟫ a comment entry carries its text (the auditable part: change logs, the AgencyAssignedID deprecation notice, G20);
	// whitespace runs and the XML declaration carry none
	textBearingKindList: Object.freeze([OMITTED_KIND.COMMENT]),
	textPropertyName: 'omittedText',
	caveatText: 'comments may carry content (PLAN G20)',
});
const DONOR_FOLDER_NAME = 'donorLibraries';
const DONOR_RELATIVE_PATH_RE = new RegExp(`^${DONOR_FOLDER_NAME}[\\\\/]`);
const BORROWED_PROPERTY_NAME_LIST = Object.freeze(['borrowedDocumentation', 'borrowedFrom']);

const NODE_DISPOSITION = Object.freeze({ SOURCE: 'source', DERIVED_STRUCTURE: 'derivedStructure' });
// what the proof does with each node kind, by label suffix (the bundle's labelPrefix + suffix)
const GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE = Object.freeze({
	SchemaFile: NODE_DISPOSITION.SOURCE,
	Type: NODE_DISPOSITION.SOURCE,
	AnonymousType: NODE_DISPOSITION.SOURCE,
	Element: NODE_DISPOSITION.SOURCE,
	Attribute: NODE_DISPOSITION.SOURCE,
	GlobalElement: NODE_DISPOSITION.SOURCE,
	CodeList: NODE_DISPOSITION.SOURCE,
	Code: NODE_DISPOSITION.SOURCE,
	DataType: NODE_DISPOSITION.SOURCE,
	Group: NODE_DISPOSITION.SOURCE,
	Root: NODE_DISPOSITION.DERIVED_STRUCTURE,
	Release: NODE_DISPOSITION.DERIVED_STRUCTURE,
	Occurrence: NODE_DISPOSITION.DERIVED_STRUCTURE,
	EmbedText: NODE_DISPOSITION.DERIVED_STRUCTURE,
});

const SEMANTIC_VALIDATION_LIMIT =
	'CONTENT-LEVEL regeneration of every .xsd file of the release from the graph alone, compared with the snapshot ' +
	'by an independent sax reading (not the forge parser): every top-level definition and import in document order; ' +
	'every local element, attribute, group reference and wildcard in its compositor position, nested compositors ' +
	'included, with every attribute as written; every derivation with its base, facets and enumeration values in ' +
	'order; every documentation string, verbatim; the schema element\'s attributes. QName-valued attributes (type, base, ' +
	'ref, substitutionGroup) are compared RESOLVED to {namespace}local, so a prefix is not content. NOT modelled, listed ' +
	'from the source as explicitlyOmitted: XML comments (PESC\'s change logs; the release record carries the root\'s), ' +
	'whitespace runs between elements, and processing instructions (the XML declaration). Not modelled and not listed: ' +
	'the xmlns prefix declarations (the regenerated files bind their own prefixes) and the order of facets inside one ' +
	'restriction (not significant to XSD). Occurrences, HAS_INSTANCE, HAS_CHILD, the release record, text nodes and the ' +
	'stamped ordinals are derived structure, proved by the reachability, identity and sequence gates, not here.';

const widenedList = (listOrScalar) => (listOrScalar === undefined || listOrScalar === null ? [] : Array.isArray(listOrScalar) ? listOrScalar : [listOrScalar]);
const localNameOf = (tagName) => (tagName.indexOf(':') === -1 ? tagName : tagName.slice(tagName.indexOf(':') + 1));
const compareStrings = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);

// =====================================================================
// THE CANONICALIZER (both sides)
// =====================================================================

const canonicalStatementsOfXsdText = ({ fileName, xsdText, includeOmitted }) => {
	const statementList = [];
	const omittedCountByKind = { [OMITTED_KIND.COMMENT]: 0, [OMITTED_KIND.WHITESPACE]: 0, [OMITTED_KIND.PROCESSING_INSTRUCTION]: 0 };
	const statementKeyOf = (pathText) => `${fileName}${STATEMENT_SEPARATOR}${pathText}`;
	const addOmitted = (omittedKind, omittedText) => {
		omittedCountByKind[omittedKind]++;
		if (includeOmitted) {
			statementList.push([statementKeyOf(`${omittedKind}#${omittedCountByKind[omittedKind]}`), { omittedKind, omittedText, explicitlyOmitted: true }]);
		}
	};
	const frameStack = [];
	const schemaChildSegmentList = [];
	let contentTextCount = 0;
	let faultText = null;

	const resolvedQNameOf = (writtenValue, bindingByPrefix) => {
		const colonIndex = writtenValue.indexOf(':');
		const prefix = colonIndex === -1 ? '' : writtenValue.slice(0, colonIndex);
		const namespace = bindingByPrefix[prefix];
		return `{${namespace === undefined ? `UNBOUND:${prefix}` : namespace}}${writtenValue.slice(colonIndex + 1)}`;
	};

	const parser = sax.parser(true, { trim: false, normalize: false, xmlns: false, position: true });
	parser.onerror = (parseError) => {
		faultText = faultText || `${fileName}: ${parseError.message.split('\n')[0]}`;
		parser.resume();
	};
	parser.onprocessinginstruction = (instruction) => addOmitted(OMITTED_KIND.PROCESSING_INSTRUCTION, `${instruction.name} ${instruction.body}`);
	parser.oncomment = (commentText) => addOmitted(OMITTED_KIND.COMMENT, commentText);
	const onText = (textValue) => {
		const frame = frameStack[frameStack.length - 1];
		if (frame !== undefined && frame.tag === 'documentation') {
			frame.textPartList.push(textValue);
			return;
		}
		if (textValue.trim() === '') {
			addOmitted(OMITTED_KIND.WHITESPACE, textValue);
			return;
		}
		contentTextCount++;
		statementList.push([statementKeyOf(`${frame === undefined ? '' : frame.pathText}/text#${contentTextCount}`), { tag: '#text', text: textValue }]);
	};
	parser.ontext = onText;
	parser.oncdata = onText;

	parser.onopentag = (saxNode) => {
		const parentFrame = frameStack[frameStack.length - 1];
		const bindingByPrefix = { ...(parentFrame === undefined ? {} : parentFrame.bindingByPrefix) };
		Object.keys(saxNode.attributes).forEach((attributeName) => {
			if (attributeName === 'xmlns') {
				bindingByPrefix[''] = saxNode.attributes[attributeName];
			} else if (attributeName.startsWith('xmlns:')) {
				bindingByPrefix[attributeName.slice('xmlns:'.length)] = saxNode.attributes[attributeName];
			}
		});
		const tag = localNameOf(saxNode.name);
		// a prefixed attribute NAME is resolved like a QName value ('{namespace}local'), so a prefix is not
		// content here either; an unprefixed name is in no namespace (phase F6: ePortfolio's vc:minVersion)
		const resolvedAttributeNameOf = (attributeName) => (attributeName.indexOf(':') === -1 ? attributeName : resolvedQNameOf(attributeName, { ...XML_PREFIX_BINDING, ...bindingByPrefix }));
		const attributeList = Object.keys(saxNode.attributes)
			.filter((attributeName) => attributeName !== 'xmlns' && !attributeName.startsWith('xmlns:'))
			.map((attributeName) => [resolvedAttributeNameOf(attributeName), QNAME_ATTRIBUTE_NAME_LIST.indexOf(attributeName) !== -1 ? resolvedQNameOf(saxNode.attributes[attributeName], bindingByPrefix) : saxNode.attributes[attributeName]])
			.sort((left, right) => compareStrings(left[0], right[0]));

		let segment;
		if (parentFrame === undefined) {
			segment = tag;
		} else if (parentFrame.tag === 'schema' && parentFrame.depthFromRoot === 0) {
			segment = tag === 'import' ? `import:${saxNode.attributes.namespace}` : saxNode.attributes.name !== undefined ? `${tag}:${saxNode.attributes.name}` : tag === 'annotation' ? 'annotation' : `${tag}#${++parentFrame.ordinalCount}`;
			schemaChildSegmentList.push(segment);
		} else if (tag === 'annotation') {
			segment = 'annotation';
		} else if (tag === 'documentation') {
			segment = `documentation#${++parentFrame.documentationCount}`;
		} else if (tag === 'enumeration') {
			segment = `enumeration#${++parentFrame.enumerationCount}`;
		} else if (FACET_TAG_LIST.indexOf(tag) !== -1) {
			segment = `facet:${tag}`;
		} else {
			segment = `${++parentFrame.ordinalCount}:${tag}`;
		}
		const pathText = parentFrame === undefined ? segment : `${parentFrame.pathText}${PATH_SEPARATOR}${segment}`;
		frameStack.push({ tag, pathText, attributeList, bindingByPrefix, ordinalCount: 0, documentationCount: 0, enumerationCount: 0, textPartList: [], depthFromRoot: frameStack.length });
	};
	parser.onclosetag = () => {
		const frame = frameStack.pop();
		statementList.push([statementKeyOf(frame.pathText), frame.tag === 'documentation' ? { tag: frame.tag, attributeList: frame.attributeList, text: frame.textPartList.join('') } : { tag: frame.tag, attributeList: frame.attributeList }]);
	};

	parser.write(xsdText).close();
	if (faultText !== null) {
		return { faultText };
	}
	statementList.push([statementKeyOf('schemaChildOrder'), { schemaChildSegmentList }]);
	return { statementList, omittedCountByKind };
};

// =====================================================================
// THE EMITTER (graph side)
// =====================================================================

const xmlEscapedText = (rawText) => String(rawText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlEscapedAttributeValue = (rawText) => xmlEscapedText(rawText).replace(/"/g, '&quot;');
const parsedJsonOrNull = (jsonText) => (jsonText === undefined || jsonText === null ? null : JSON.parse(jsonText));

const regenerateXsdTextByFileName = ({ nodes, edges, labelPrefix }) => {
	// ---- classify every node; read only the source kinds
	const kindByStableId = {};
	const sourceNodeList = [];
	const nodeCountByDisposition = { [NODE_DISPOSITION.SOURCE]: 0, [NODE_DISPOSITION.DERIVED_STRUCTURE]: 0 };
	for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
		const oneNode = nodes[nodeIndex];
		const classifiedSuffixList = oneNode.labels.filter((oneLabel) => oneLabel.startsWith(labelPrefix) && GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE[oneLabel.slice(labelPrefix.length)] !== undefined).map((oneLabel) => oneLabel.slice(labelPrefix.length));
		if (classifiedSuffixList.length !== 1) {
			return { fault: `node '${oneNode.stableId}' carries ${classifiedSuffixList.length} classified labels (${oneNode.labels.join(', ')}); every node carries exactly one of ${labelPrefix}{${Object.keys(GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE).join(', ')}}` };
		}
		const disposition = GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE[classifiedSuffixList[0]];
		nodeCountByDisposition[disposition]++;
		if (disposition === NODE_DISPOSITION.SOURCE) {
			kindByStableId[oneNode.stableId] = classifiedSuffixList[0];
			sourceNodeList.push(oneNode);
		}
	}

	const nodeByStableId = {};
	const childListByParent = {};
	sourceNodeList.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
		(childListByParent[oneNode.properties.parentId] = childListByParent[oneNode.properties.parentId] || []).push(oneNode);
	});
	const referencedGroupListByOwner = {};
	edges.forEach((oneEdge) => {
		if (oneEdge.type === 'REFERENCES' && kindByStableId[oneEdge.toStableId] === 'Group') {
			(referencedGroupListByOwner[oneEdge.fromStableId] = referencedGroupListByOwner[oneEdge.fromStableId] || []).push(nodeByStableId[oneEdge.toStableId]);
		}
	});
	const childrenOfKind = (ownerStableId, kindName) => (childListByParent[ownerStableId] || []).filter((oneNode) => kindByStableId[oneNode.stableId] === kindName);

	let faultText = null;
	const fault = (text) => {
		faultText = faultText || text;
		return '';
	};

	const schemaFileNodeList = sourceNodeList.filter((oneNode) => kindByStableId[oneNode.stableId] === 'SchemaFile');
	const fileTextByName = {};
	schemaFileNodeList.forEach((schemaFileNode) => {
		const fileName = schemaFileNode.properties.sourceFileName;
		const schemaAttributeByName = parsedJsonOrNull(schemaFileNode.properties.schemaAttributeList) || {};
		const importList = parsedJsonOrNull(schemaFileNode.properties.importList) || [];
		const prefixByNamespace = { [XSD_NAMESPACE]: XSD_PREFIX };
		// a namespaced schema attribute's namespace is bound too (the graph names it '{namespace}local')
		const schemaAttributeNamespaceList = Object.keys(schemaAttributeByName).filter((oneName) => NAMESPACED_ATTRIBUTE_NAME_RE.test(oneName)).map((oneName) => NAMESPACED_ATTRIBUTE_NAME_RE.exec(oneName)[1]);
		[schemaFileNode.properties.targetNamespace].concat(importList.map((oneImport) => oneImport.namespace), schemaAttributeNamespaceList).forEach((oneNamespace) => {
			if (prefixByNamespace[oneNamespace] === undefined) {
				prefixByNamespace[oneNamespace] = `ns${Object.keys(prefixByNamespace).length}`;
			}
		});
		const writtenQNameOf = (resolvedQName, siteText) => {
			const hashIndex = resolvedQName.lastIndexOf('#');
			const prefix = prefixByNamespace[resolvedQName.slice(0, hashIndex)];
			return prefix === undefined ? fault(`${siteText}: namespace of '${resolvedQName}' is neither ${fileName}'s own nor imported`) : `${prefix}:${resolvedQName.slice(hashIndex + 1)}`;
		};
		const attributeText = (attributePairList) => attributePairList.filter((onePair) => onePair[1] !== undefined && onePair[1] !== null).map((onePair) => ` ${onePair[0]}="${xmlEscapedAttributeValue(onePair[1])}"`).join('');
		const annotationText = (documentationList) => (documentationList.length === 0 ? '' : `<xs:annotation>${documentationList.map((oneText) => `<xs:documentation>${xmlEscapedText(oneText)}</xs:documentation>`).join('')}</xs:annotation>`);

		const compositorText = ({ shape, ownerStableId }) => {
			const particleText = shape.particles
				.map((oneParticle) => {
					if (oneParticle.element !== undefined) {
						const elementNode = childrenOfKind(ownerStableId, 'Element').find((oneNode) => oneNode.properties.sequencePosition === oneParticle.element);
						return elementNode === undefined ? fault(`${ownerStableId}: no element at sequencePosition ${oneParticle.element}`) : declarationText({ declarationNode: elementNode, tag: 'element' });
					}
					if (oneParticle.groupRef !== undefined) {
						const localName = localNameOf(oneParticle.groupRef);
						const groupNodeList = (referencedGroupListByOwner[ownerStableId] || []).filter((oneNode) => oneNode.properties.name === localName);
						const distinctNamespaceList = [...new Set(groupNodeList.map((oneNode) => oneNode.properties.targetNamespace))];
						if (distinctNamespaceList.length !== 1) {
							return fault(`${ownerStableId}: group reference '${oneParticle.groupRef}' matches ${distinctNamespaceList.length} referenced groups by name`);
						}
						return `<xs:group${attributeText([['ref', writtenQNameOf(`${distinctNamespaceList[0]}#${localName}`, ownerStableId)], ['minOccurs', oneParticle.minOccursAsWritten], ['maxOccurs', oneParticle.maxOccursAsWritten]])}/>`;
					}
					if (oneParticle.compositor !== undefined) {
						return compositorText({ shape: oneParticle, ownerStableId });
					}
					const wildcard = oneParticle.any;
					return `<xs:any${attributeText([['namespace', wildcard.namespaceAsWritten], ['processContents', wildcard.processContents], ['minOccurs', wildcard.minOccursAsWritten], ['maxOccurs', wildcard.maxOccursAsWritten]])}/>`;
				})
				.join('');
			return `<xs:${shape.compositor}${attributeText([['minOccurs', shape.minOccursAsWritten], ['maxOccurs', shape.maxOccursAsWritten]])}>${particleText}</xs:${shape.compositor}>`;
		};

		// a code's value: as carried, or the empty string when the walk says so (valueIsEmptyString);
		// neither is a fault, never a guess
		const codeValueOf = (codeNode) => {
			if (codeNode.properties.value !== undefined) {
				return codeNode.properties.value;
			}
			return codeNode.properties.valueIsEmptyString === true ? '' : fault(`${codeNode.stableId}: a code with no value and no valueIsEmptyString`);
		};

		// a type body: derivation (with its wrapper), compositor, attributes, codes
		const typeBodyText = ({ typeNode, isSimple }) => {
			const props = typeNode.properties;
			const shape = parsedJsonOrNull(props.contentModelShape);
			const facetByName = parsedJsonOrNull(props.facets) || {};
			const facetText = Object.keys(facetByName).map((oneFacetName) => `<xs:${oneFacetName} value="${xmlEscapedAttributeValue(facetByName[oneFacetName])}"/>`).join('');
			const codeText = childrenOfKind(typeNode.stableId, 'Code')
				.sort((left, right) => left.properties.codePosition - right.properties.codePosition)
				.map((oneCode) => `<xs:enumeration value="${xmlEscapedAttributeValue(codeValueOf(oneCode))}">${annotationText(widenedList(oneCode.properties.documentationValueList))}</xs:enumeration>`)
				.join('');
			const attributeDeclarationText = childrenOfKind(typeNode.stableId, 'Attribute')
				.sort((left, right) => left.properties.sequencePosition - right.properties.sequencePosition)
				.map((oneAttribute) => declarationText({ declarationNode: oneAttribute, tag: 'attribute' }))
				.join('');
			const innerText = `${shape === null ? '' : compositorText({ shape, ownerStableId: typeNode.stableId })}${attributeDeclarationText}`;
			if (props.derivationVariety === undefined) {
				return isSimple ? fault(`${typeNode.stableId}: a simple type with no derivation`) : innerText;
			}
			const baseText = writtenQNameOf(props.baseTypeQName, typeNode.stableId);
			const derivationText = `<xs:${props.derivationVariety} base="${xmlEscapedAttributeValue(baseText)}">${annotationText(widenedList(props.derivationDocumentationValueList))}${facetText}${codeText}${innerText}</xs:${props.derivationVariety}>`;
			return isSimple ? derivationText : `<xs:${props.contentStyle}>${derivationText}</xs:${props.contentStyle}>`;
		};

		const anonymousTypeText = (declarationStableId) => {
			const anonymousNode = nodeByStableId[`${declarationStableId}/anon`];
			if (anonymousNode === undefined) {
				return '';
			}
			const isSimple = kindByStableId[anonymousNode.stableId] !== 'AnonymousType';
			const tag = isSimple ? 'simpleType' : 'complexType';
			return `<xs:${tag}>${annotationText(widenedList(anonymousNode.properties.documentationValueList))}${typeBodyText({ typeNode: anonymousNode, isSimple })}</xs:${tag}>`;
		};

		// a local element, an attribute or a global element, as written
		const declarationText = ({ declarationNode, tag }) => {
			const props = declarationNode.properties;
			const attributePairList = [
				['name', props.name],
				['type', props.typeQName === undefined ? undefined : writtenQNameOf(props.typeQName, declarationNode.stableId)],
				['substitutionGroup', props.substitutionGroupQName === undefined ? undefined : writtenQNameOf(props.substitutionGroupQName, declarationNode.stableId)],
				['minOccurs', props.minOccursAsWritten],
				['maxOccurs', props.maxOccursAsWritten],
				['nillable', props.nillableAsWritten],
				['form', props.formAsWritten],
				['default', props.defaultAsWritten],
				['fixed', props.fixedAsWritten],
				['use', props.useAsWritten],
				['abstract', props.abstractAsWritten],
			];
			// every documentation string as written (phase F6: an empty one and a second one included)
			const innerText = `${annotationText(widenedList(props.documentationValueList))}${anonymousTypeText(declarationNode.stableId)}`;
			return innerText === '' ? `<xs:${tag}${attributeText(attributePairList)}/>` : `<xs:${tag}${attributeText(attributePairList)}>${innerText}</xs:${tag}>`;
		};

		const DEFINITION_TEXT_BY_KIND = {
			Type: (oneNode) => `<xs:complexType${attributeText([['name', oneNode.properties.name], ['abstract', oneNode.properties.abstractAsWritten]])}>${annotationText(widenedList(oneNode.properties.documentationValueList))}${typeBodyText({ typeNode: oneNode, isSimple: false })}</xs:complexType>`,
			CodeList: (oneNode) => `<xs:simpleType name="${xmlEscapedAttributeValue(oneNode.properties.name)}">${annotationText(widenedList(oneNode.properties.documentationValueList))}${typeBodyText({ typeNode: oneNode, isSimple: true })}</xs:simpleType>`,
			DataType: (oneNode) => `<xs:simpleType name="${xmlEscapedAttributeValue(oneNode.properties.name)}">${annotationText(widenedList(oneNode.properties.documentationValueList))}${typeBodyText({ typeNode: oneNode, isSimple: true })}</xs:simpleType>`,
			Group: (oneNode) => {
				const shape = parsedJsonOrNull(oneNode.properties.contentModelShape);
				return `<xs:group name="${xmlEscapedAttributeValue(oneNode.properties.name)}">${annotationText(widenedList(oneNode.properties.documentationValueList))}${shape === null ? '' : compositorText({ shape, ownerStableId: oneNode.stableId })}</xs:group>`;
			},
			GlobalElement: (oneNode) => declarationText({ declarationNode: oneNode, tag: 'element' }),
		};

		const placedList = importList.map((oneImport) => ({ documentPosition: oneImport.documentPosition, placedText: `<xs:import${attributeText([['namespace', oneImport.namespace], ['schemaLocation', oneImport.schemaLocation]])}/>` }));
		sourceNodeList
			.filter((oneNode) => oneNode.properties.sourceFileName === fileName && oneNode.properties.documentPosition !== undefined && DEFINITION_TEXT_BY_KIND[kindByStableId[oneNode.stableId]] !== undefined)
			.forEach((oneNode) => placedList.push({ documentPosition: oneNode.properties.documentPosition, placedText: DEFINITION_TEXT_BY_KIND[kindByStableId[oneNode.stableId]](oneNode) }));
		// each schema-level annotation where it stood: after the import or definition it follows (phase F6)
		(parsedJsonOrNull(schemaFileNode.properties.fileAnnotationList) || []).forEach((oneAnnotation, annotationIndex) => {
			placedList.push({ documentPosition: oneAnnotation.afterDocumentPosition + (annotationIndex + 1) / FILE_ANNOTATION_POSITION_DIVISOR, placedText: annotationText(widenedList(oneAnnotation.documentationValueList)) });
		});
		placedList.sort((left, right) => left.documentPosition - right.documentPosition);

		const namespaceDeclarationText = Object.keys(prefixByNamespace).map((oneNamespace) => ` xmlns:${prefixByNamespace[oneNamespace]}="${xmlEscapedAttributeValue(oneNamespace)}"`).join('');
		const writtenSchemaAttributeNameOf = (oneName) => (NAMESPACED_ATTRIBUTE_NAME_RE.test(oneName) ? `${prefixByNamespace[NAMESPACED_ATTRIBUTE_NAME_RE.exec(oneName)[1]]}:${NAMESPACED_ATTRIBUTE_NAME_RE.exec(oneName)[2]}` : oneName);
		const schemaAttributeText = attributeText(Object.keys(schemaAttributeByName).map((oneName) => [writtenSchemaAttributeNameOf(oneName), schemaAttributeByName[oneName]]));
		fileTextByName[fileName] = `<?xml version="1.0" encoding="UTF-8"?>\n<xs:schema${namespaceDeclarationText}${schemaAttributeText}>\n${placedList.map((onePlaced) => `${onePlaced.placedText}\n`).join('')}</xs:schema>\n`;
	});

	if (faultText !== null) {
		return { fault: faultText };
	}
	return { fileTextByName, stats: { nodeCountByDisposition, schemaFileCount: schemaFileNodeList.length } };
};

// =====================================================================
// THE DIFF — values, not only keys (a changed attribute keeps its statementKey)
// =====================================================================

const diffStatementsOf = ({ sourceStatements, graphStatements }) => {
	const inventedList = [];
	const lostList = [];
	graphStatements.forEach((graphStatement, statementKey) => {
		if (!sourceStatements.has(statementKey)) {
			inventedList.push({ statementKey, statement: graphStatement });
		}
	});
	sourceStatements.forEach((sourceStatement, statementKey) => {
		if (!graphStatements.has(statementKey)) {
			lostList.push({ statementKey, statement: sourceStatement, lostReason: LOST_REASON.ABSENT_FROM_GRAPH, lostCategory: sourceStatement.explicitlyOmitted === true ? 'explicitlyOmitted' : 'contentGap' });
			return;
		}
		if (JSON.stringify(sourceStatement) !== JSON.stringify(graphStatements.get(statementKey))) {
			lostList.push({ statementKey, statement: sourceStatement, graphStatement: graphStatements.get(statementKey), lostReason: LOST_REASON.VALUE_DIFFERS, lostCategory: 'contentGap' });
		}
	});
	return { inventedList, lostList, matchedCount: sourceStatements.size - lostList.length };
};

// =====================================================================
// THE PAIR
// =====================================================================

const makeRoundTripPair = ({ labelPrefix }) => {
	if (typeof labelPrefix !== 'string' || labelPrefix.length === 0) {
		throw new Error(`${moduleName} REFUSED: makeRoundTripPair was given labelPrefix ${JSON.stringify(labelPrefix)} — the bundle's declared label prefix, never a guess`);
	}
	// the last regeneration, kept so the validator can write the regenerated files beside its verdict
	const lastRegeneration = { fileTextByName: null };

	const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
		const snapshotDirPath = fs.existsSync(snapshotPath) && fs.statSync(snapshotPath).isDirectory() ? snapshotPath : path.dirname(snapshotPath);
		const xsdRelativePathList = verifiedFileList.filter((oneRelativePath) => XSD_FILE_NAME_RE.test(oneRelativePath) && !DONOR_RELATIVE_PATH_RE.test(oneRelativePath)).sort(compareStrings);
		if (xsdRelativePathList.length === 0) {
			callback(`${moduleName} REFUSED: the verified snapshot ${snapshotDirPath} lists no .xsd file`);
			return;
		}
		const statements = new Map();
		const omittedCountByKind = {};
		const readNext = (fileIndex) => {
			if (fileIndex >= xsdRelativePathList.length) {
				callback('', { statements, stats: { xsdFileCount: xsdRelativePathList.length, omittedCountByKind, statementCount: statements.size } });
				return;
			}
			const relativePath = xsdRelativePathList[fileIndex];
			fs.readFile(path.join(snapshotDirPath, relativePath), 'utf8', (readError, xsdText) => {
				if (readError) {
					callback(`${moduleName}: reading ${relativePath} failed: ${readError.message}`);
					return;
				}
				const canonical = canonicalStatementsOfXsdText({ fileName: path.basename(relativePath), xsdText, includeOmitted: true });
				if (canonical.faultText !== undefined) {
					callback(`${moduleName}: the source ${relativePath} is not well-formed XML: ${canonical.faultText}`);
					return;
				}
				canonical.statementList.forEach((onePair) => statements.set(onePair[0], onePair[1]));
				Object.keys(canonical.omittedCountByKind).forEach((omittedKind) => {
					omittedCountByKind[omittedKind] = (omittedCountByKind[omittedKind] || 0) + canonical.omittedCountByKind[omittedKind];
				});
				readNext(fileIndex + 1);
			});
		};
		readNext(0);
	};

	const regenerateFromGraph = ({ reader }, callback) => {
		reader.readAll((readError, graph) => {
			if (readError) {
				callback(`${moduleName}: reading the graph failed: ${readError}`);
				return;
			}
			callback('', regenerateXsdTextByFileName({ nodes: graph.nodes, edges: graph.edges, labelPrefix }));
		});
	};

	const emitFromGraph = ({ reader }, callback) => {
		regenerateFromGraph({ reader }, (regenerateError, regenerated) => {
			if (regenerateError) {
				callback(regenerateError);
				return;
			}
			if (regenerated.fault !== undefined) {
				callback('', { fault: regenerated.fault });
				return;
			}
			const statements = new Map();
			const fileNameList = Object.keys(regenerated.fileTextByName).sort(compareStrings);
			for (let fileIndex = 0; fileIndex < fileNameList.length; fileIndex++) {
				const canonical = canonicalStatementsOfXsdText({ fileName: fileNameList[fileIndex], xsdText: regenerated.fileTextByName[fileNameList[fileIndex]], includeOmitted: false });
				if (canonical.faultText !== undefined) {
					callback('', { fault: `the regenerated ${fileNameList[fileIndex]} is not well-formed XML: ${canonical.faultText}` });
					return;
				}
				canonical.statementList.forEach((onePair) => statements.set(onePair[0], onePair[1]));
			}
			lastRegeneration.fileTextByName = regenerated.fileTextByName;
			callback('', { statements, stats: { ...regenerated.stats, regeneratedFileCount: fileNameList.length, statementCount: statements.size } });
		});
	};

	const diffStatements = ({ sourceStatements, graphStatements }, callback) => callback('', diffStatementsOf({ sourceStatements, graphStatements }));

	return { canonicalizeSource, emitFromGraph, diffStatements, semanticValidationLimit: SEMANTIC_VALIDATION_LIMIT, omissionDeclaration: OMISSION_DECLARATION, regenerateFromGraph, lastRegeneration };
};

module.exports = {
	makeRoundTripPair,
	canonicalStatementsOfXsdText,
	regenerateXsdTextByFileName,
	diffStatementsOf,
	GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE,
	NODE_DISPOSITION,
	OMITTED_KIND,
	OMISSION_DECLARATION,
	LOST_REASON,
	SEMANTIC_VALIDATION_LIMIT,
	DONOR_FOLDER_NAME,
	BORROWED_PROPERTY_NAME_LIST,
	moduleName,
};
