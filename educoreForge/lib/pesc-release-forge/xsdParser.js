'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdParser.js — COPIED from forges/pesc260805/lib/parser.js on 2026-09-30 for the PESC release forge
// (DESIGN-pescForge.md §1.2, loader 1). Two edits only: the require of ./xsdTree (renamed from
// xsd-tree.js) and the refusal prefix, which now names this module. Everything below is the
// original text, including its references to the 64-file corpus: a release folder is a
// directory of .xsd files and is read the same way.
//
// COMMENTS ⟪forgeClean lane CLEAN, PLAN G20, 2026-10-08⟫, a third edit: comments are content now (xsdTree.js keeps
// them). Every comment outside a definition (before xs:schema, among its children, after it) lands on the artifact's
// commentList as { placement, beforeSchemaChildIndex (placement 'schema' only), text }; this is where PESC keeps its
// change logs. A comment INSIDE a definition is taught in exactly one site, the one the corpus uses: in an xs:sequence
// or xs:choice, immediately before an xs:element, whose precedingCommentValues it joins (the AgencyAssignedID
// deprecation note, measured in all seven releases). A comment anywhere else inside a definition is REFUSED BY NAME:
// dropping it would lose content silently, and guessing what it annotates would invent a fact.
//
// parser.js — the PESC260805 corpus directory -> a literal per-file model. SOURCE TIER ONLY.
//
// THE ONE RULE THIS MODULE SERVES (DESIGN-pescGraphModel-080526 §1): the graph's spine is the FILE.
// Everything returned here is what a file literally says — as-written prefixed type strings, verbatim
// documentation (no whitespace collapse, R-VAL-2), document positions, sequence positions, the full
// facet lists the incumbent lost. NO reference is resolved here (resolution is Phase 3, derived
// tier); the prefix table is captured per file so Phase 3 can resolve inside the declaring file
// (spec §3.1: two files can carry the byte-identical string 'core:DocumentIDType' and denote
// different types — resolution outside the declaring file is resolution-by-guess).
//
// REFUSALS (spec standing rules — refuse by name, never substitute):
//   * a file using a prefix its own in-scope prefix table does not bind
//   * an import that violates the layer order codes < core < sector < message (this ASSERTS the
//     acyclicity spec §2.2 observed but PESC never guaranteed; message->message is the named case)
//   * a targetNamespace that is not urn:org:pesc:*
//   * two files with identical bytes (sha256 collision = an acquisition defect, not a graph fact)
//   * any XSD construct this parser has not been taught (xs:union, xs:list, element ref=,
//     xs:attributeGroup, xs:anyAttribute, xs:include, xs:redefine, xs:appinfo, ...) — a construct
//     silently skipped is content silently lost, which is the incumbent's disease
//   * an absent required attribute (a definition without name=, an import without namespace=, an
//     enumeration without value=) — throws, never defaults
//
// Callback-shaped API (house style): parsePescCorpus({ sourcePath }, callback) ->
//   callback('', { artifacts, parseAudit }) — artifacts sorted by filename, fully deterministic.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseXsdTree } = require('./xsdTree')();

// the four layer tokens PESC's own URNs declare (spec §2.1), ranked so an import may only point
// DOWNWARD — rank(imported) < rank(importer) — which makes the import graph acyclic by construction.
const LAYER_RANKS = { codes: 0, core: 1, sector: 2, message: 3 };

const PESC_NAMESPACE_PATTERN = /^urn:org:pesc:(codes|core|sector|message):([^:]+):(v.+)$/;

// single-valued restriction facets this corpus uses (measured 2026-08-05). xs:pattern is legally
// repeatable in XSD; this corpus never repeats it, so a repeat REFUSES rather than inventing an
// array shape nothing reads. enumeration is the ordered-list facet, handled separately.
const SCALAR_FACET_TAGS = [
	'xs:pattern',
	'xs:minLength',
	'xs:maxLength',
	'xs:length',
	'xs:totalDigits',
	'xs:fractionDigits',
	'xs:minInclusive',
	'xs:maxInclusive',
	'xs:minExclusive',
	'xs:maxExclusive',
	'xs:whiteSpace',
];

// THE ATTRIBUTE CENSUS (phase F4, QUIET_ORBIT ruling 2026-10-01). The parser refuses untaught
// CONSTRUCTS by name but read only the attributes it knew, so an untaught ATTRIBUTE was silently
// dropped (the round trip found xs:element form="unqualified"). Now every attribute on every XSD
// element is either CARRIED (read into the model) or on its construct's declared IGNORE list with a
// reason, and anything else is refused by name before the walk starts. Measured across the 7 selected
// release folders (2026-10-01): no attribute outside these rows. The construct of an element depends on
// its parent: a top-level xs:element / xs:complexType / xs:simpleType / xs:group differs from a local
// one. xs:schema carries every attribute: xmlns declarations into prefixBindings, the rest verbatim
// into schemaAttributes.
const SCHEMA_CARRIES_EVERY_ATTRIBUTE = 'everyAttribute';
const ATTRIBUTE_RULE_BY_CONSTRUCT = Object.freeze({
	schema: Object.freeze({ carriedAttributeNameList: SCHEMA_CARRIES_EVERY_ATTRIBUTE, ignoredReasonByAttributeName: Object.freeze({}) }),
	import: Object.freeze({ carriedAttributeNameList: Object.freeze(['namespace', 'schemaLocation']), ignoredReasonByAttributeName: Object.freeze({}) }),
	topLevelElement: Object.freeze({ carriedAttributeNameList: Object.freeze(['name', 'type', 'substitutionGroup', 'abstract', 'nillable']), ignoredReasonByAttributeName: Object.freeze({}) }),
	localElement: Object.freeze({ carriedAttributeNameList: Object.freeze(['name', 'type', 'minOccurs', 'maxOccurs', 'nillable', 'fixed', 'default', 'form']), ignoredReasonByAttributeName: Object.freeze({}) }),
	topLevelComplexType: Object.freeze({ carriedAttributeNameList: Object.freeze(['name', 'abstract']), ignoredReasonByAttributeName: Object.freeze({}) }),
	topLevelSimpleType: Object.freeze({ carriedAttributeNameList: Object.freeze(['name']), ignoredReasonByAttributeName: Object.freeze({}) }),
	topLevelGroup: Object.freeze({ carriedAttributeNameList: Object.freeze(['name']), ignoredReasonByAttributeName: Object.freeze({}) }),
	anonymousType: Object.freeze({ carriedAttributeNameList: Object.freeze([]), ignoredReasonByAttributeName: Object.freeze({}) }),
	compositor: Object.freeze({ carriedAttributeNameList: Object.freeze(['minOccurs', 'maxOccurs']), ignoredReasonByAttributeName: Object.freeze({}) }),
	groupReference: Object.freeze({ carriedAttributeNameList: Object.freeze(['ref', 'minOccurs', 'maxOccurs']), ignoredReasonByAttributeName: Object.freeze({}) }),
	wildcard: Object.freeze({ carriedAttributeNameList: Object.freeze(['namespace', 'processContents', 'minOccurs', 'maxOccurs']), ignoredReasonByAttributeName: Object.freeze({}) }),
	attribute: Object.freeze({ carriedAttributeNameList: Object.freeze(['name', 'type', 'use']), ignoredReasonByAttributeName: Object.freeze({}) }),
	derivation: Object.freeze({ carriedAttributeNameList: Object.freeze(['base']), ignoredReasonByAttributeName: Object.freeze({}) }),
	contentWrapper: Object.freeze({ carriedAttributeNameList: Object.freeze([]), ignoredReasonByAttributeName: Object.freeze({}) }),
	facet: Object.freeze({ carriedAttributeNameList: Object.freeze(['value']), ignoredReasonByAttributeName: Object.freeze({}) }),
	annotation: Object.freeze({ carriedAttributeNameList: Object.freeze([]), ignoredReasonByAttributeName: Object.freeze({}) }),
});
// a tag's construct, by whether its parent is xs:schema (a tag not listed is the walk's to refuse)
const CONSTRUCT_BY_TAG = Object.freeze({
	'xs:schema': () => 'schema',
	'xs:import': () => 'import',
	'xs:element': ({ parentTag }) => (parentTag === 'xs:schema' ? 'topLevelElement' : 'localElement'),
	'xs:complexType': ({ parentTag }) => (parentTag === 'xs:schema' ? 'topLevelComplexType' : 'anonymousType'),
	'xs:simpleType': ({ parentTag }) => (parentTag === 'xs:schema' ? 'topLevelSimpleType' : 'anonymousType'),
	'xs:group': ({ parentTag }) => (parentTag === 'xs:schema' ? 'topLevelGroup' : 'groupReference'),
	'xs:sequence': () => 'compositor',
	'xs:choice': () => 'compositor',
	'xs:any': () => 'wildcard',
	'xs:attribute': () => 'attribute',
	'xs:restriction': () => 'derivation',
	'xs:extension': () => 'derivation',
	'xs:complexContent': () => 'contentWrapper',
	'xs:simpleContent': () => 'contentWrapper',
	'xs:enumeration': () => 'facet',
	'xs:annotation': () => 'annotation',
	'xs:documentation': () => 'annotation',
	...SCALAR_FACET_TAGS.reduce((soFar, oneFacetTag) => ({ ...soFar, [oneFacetTag]: () => 'facet' }), {}),
});

// every attribute of the tree carried or declared ignored; the first other one, named, or null
const untaughtAttributeOf = ({ treeNode, parentTag }) => {
	const constructOf = CONSTRUCT_BY_TAG[treeNode.tag];
	if (constructOf !== undefined) {
		const constructName = constructOf({ parentTag });
		const attributeRule = ATTRIBUTE_RULE_BY_CONSTRUCT[constructName];
		if (attributeRule.carriedAttributeNameList !== SCHEMA_CARRIES_EVERY_ATTRIBUTE) {
			const untaughtName = treeNode.attributeOrder.find((oneName) => attributeRule.carriedAttributeNameList.indexOf(oneName) === -1 && attributeRule.ignoredReasonByAttributeName[oneName] === undefined);
			if (untaughtName !== undefined) {
				return { untaughtName, constructName, treeNode };
			}
		}
	}
	for (let childIndex = 0; childIndex < treeNode.children.length; childIndex++) {
		const found = untaughtAttributeOf({ treeNode: treeNode.children[childIndex], parentTag: treeNode.tag });
		if (found !== null) {
			return found;
		}
	}
	return null;
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// ---- refusal helper — every refusal is a THROW carrying the offender's name; the corpus
		// walk converts it to the callback error channel at the single boundary in parsePescCorpus.
		// where a comment outside every definition stands; roundTripPair.js holds the same three words (it may require no
		// reader of the forge) and refuses a placement it does not know
		const COMMENT_PLACEMENT = Object.freeze({ PROLOG: 'prolog', SCHEMA: 'schema', EPILOG: 'epilog' });
		const COMMENT_HOLDING_TAG_LIST = Object.freeze(['xs:sequence', 'xs:choice']);

		const refuse = (message) => {
			throw new Error(`pesc-release-forge xsdParser REFUSES: ${message}`);
		};

		// requiredAttribute — an absent required attribute throws, never defaults (standing rule).
		const requiredAttribute = (treeNode, attributeName, context) => {
			const value = treeNode.attributes[attributeName];
			if (value === undefined || `${value}` === '') {
				refuse(`${context}: required attribute '${attributeName}' is absent or empty (line ${treeNode.line})`);
			}
			return value;
		};

		const optionalAttribute = (treeNode, attributeName) => {
			const value = treeNode.attributes[attributeName];
			return value === undefined ? null : value;
		};

		// ---- per-file walk state factory. One instance per artifact; carries the file's identity
		// for refusal messages, its in-scope prefix bindings, and the parse audit counters.
		const makeFileWalker = ({ filename, prefixBindings, parseAudit }) => {
			// validateWrittenQName — the unbound-prefix refusal. Applied to EVERY as-written
			// reference (type=, base=, ref=, substitutionGroup=). An unprefixed QName resolves via
			// the default namespace (or none) — nothing to validate here; Phase 3 owns resolution.
			const validateWrittenQName = (writtenQName, context) => {
				if (writtenQName === null || writtenQName.indexOf(':') === -1) {
					return writtenQName;
				}
				const prefix = writtenQName.split(':')[0];
				if (prefixBindings[prefix] === undefined) {
					refuse(
						`file '${filename}' uses prefix '${prefix}' (in '${writtenQName}', ${context}) ` +
							`but its own prefix table binds no such prefix. The reference is unresolvable ` +
							`inside the declaring file, and resolving it anywhere else is resolution-by-guess.`,
					);
				}
				return writtenQName;
			};

			// readAnnotation — an xs:annotation node -> { documentation, documentationValues }.
			// VERBATIM: the text between the documentation tags, entity-decoded, never trimmed or
			// collapsed (R-VAL-2 — the incumbent's `.replace(/\s+/g,' ')` here is its known blind
			// spot). One file (AcademicRecord_v1.14.0) carries annotations with TWO documentation
			// children: the first is `documentation`, the full ordered list rides in
			// documentationValues, and the occurrence is counted — carried, not collapsed.
			const readAnnotation = (annotationNode) => {
				const documentationValues = [];
				annotationNode.children.forEach((oneChild) => {
					if (oneChild.tag === 'xs:documentation') {
						documentationValues.push(oneChild.text);
						return;
					}
					// xs:appinfo is ruled verbatim-opaque (design D-3) but occurs ZERO times in this
					// corpus, so the carry path would be untestable code. A future snapshot that adds
					// one fails loudly here instead of losing it silently; extend deliberately then.
					refuse(
						`file '${filename}': xs:annotation carries '${oneChild.tag}' (line ${oneChild.line}), ` +
							`which this parser does not yet carry. Losing it silently is not an option.`,
					);
				});
				if (documentationValues.length > 1) {
					parseAudit.multiDocumentationAnnotations++;
				}
				return {
					documentation: documentationValues.length ? documentationValues[0] : '',
					documentationValues,
				};
			};

			// leadingAnnotation — pull the annotation child (if any) off a construct node.
			const leadingAnnotation = (constructNode) => {
				const annotationNode = constructNode.children.find((oneChild) => oneChild.tag === 'xs:annotation');
				return annotationNode
					? readAnnotation(annotationNode)
					: { documentation: '', documentationValues: [] };
			};

			// refuseSecondAnnotation — XSD allows one xs:annotation per element, attribute or derivation;
			// a second would overwrite the first silently, so it is refused by name (phase F6). An
			// annotation with no documentation child reads as an empty list, so alreadyRead is the
			// caller's own flag of having read one.
			const refuseSecondAnnotation = ({ ownerText, alreadyRead, annotationNode }) => {
				if (alreadyRead) {
					refuse(`file '${filename}': ${ownerText} carries a second xs:annotation (line ${annotationNode.line}); one is read, the next would overwrite it.`);
				}
			};

			// ---- walkRestrictionOrExtension — ONE derivation carrier for both xs:restriction and
			// xs:extension (design §3.1 catalogs the restriction/facet carrier; extension — 700+ in
			// this corpus, uncataloged — is carried on the same node kind with derivationVariety
			// distinguishing them rather than dropped; flagged PROVISIONAL in the Phase 2 report).
			// Facets are FIRST-CLASS (the incumbent's single largest loss). Child elements and
			// attributes declared inside the derivation are collected into the CONTAINER's own
			// lists so containment edges stay uniform; contentStyle tells the emitter what wrapper
			// to reconstruct.
			const walkRestrictionOrExtension = ({ derivationNode, contentStyle, container }) => {
				const variety = derivationNode.tag === 'xs:restriction' ? 'restriction' : 'extension';
				const baseAsWritten = validateWrittenQName(
					requiredAttribute(derivationNode, 'base', `file '${filename}' ${contentStyle} ${variety}`),
					`${contentStyle} ${variety} base`,
				);
				const derivation = {
					variety,
					contentStyle,
					baseAsWritten,
					documentation: '',
					// every documentation string of the derivation's own annotation, as written (phase F6:
					// ePortfolio's CoreMain 1.16.0 annotates a restriction; the first-value reading lost it)
					documentationValues: [],
					facets: {},
					enumerationValues: [],
				};

				let derivationAnnotationRead = false;
				derivationNode.children.forEach((oneChild) => {
					if (oneChild.tag === 'xs:annotation') {
						refuseSecondAnnotation({ ownerText: `${contentStyle} ${variety} of base '${baseAsWritten}'`, alreadyRead: derivationAnnotationRead, annotationNode: oneChild });
						derivationAnnotationRead = true;
						const derivationAnnotation = readAnnotation(oneChild);
						derivation.documentation = derivationAnnotation.documentation;
						derivation.documentationValues = derivationAnnotation.documentationValues;
						return;
					}
					if (oneChild.tag === 'xs:enumeration') {
						const enumerationValue = oneChild.attributes.value;
						if (enumerationValue === undefined) {
							refuse(
								`file '${filename}': xs:enumeration without value= (line ${oneChild.line})`,
							);
						}
						const enumerationAnnotation = leadingAnnotation(oneChild);
						derivation.enumerationValues.push({
							value: enumerationValue,
							documentation: enumerationAnnotation.documentation,
							// every documentation string as written, an empty one included (phase F4: the round trip
							// found two empty <xs:documentation/> on codes that the first-value reading lost)
							documentationValues: enumerationAnnotation.documentationValues,
						});
						parseAudit.enumerationValues++;
						return;
					}
					if (SCALAR_FACET_TAGS.indexOf(oneChild.tag) !== -1) {
						const facetName = oneChild.tag.replace(/^xs:/, '');
						const facetValue = requiredAttribute(
							oneChild,
							'value',
							`file '${filename}' facet ${oneChild.tag}`,
						);
						if (derivation.facets[facetName] !== undefined) {
							refuse(
								`file '${filename}': facet '${facetName}' appears twice in one ${variety} ` +
									`(line ${oneChild.line}). This corpus never repeats a facet; a repeat is ` +
									`new information demanding a deliberate model change, not a silent overwrite.`,
							);
						}
						derivation.facets[facetName] = facetValue;
						parseAudit.facetsCaptured++;
						return;
					}
					if (oneChild.tag === 'xs:sequence' || oneChild.tag === 'xs:choice') {
						container.contentModelShape = walkCompositor(oneChild, container);
						return;
					}
					if (oneChild.tag === 'xs:attribute') {
						walkAttributeDecl(oneChild, container);
						return;
					}
					refuse(
						`file '${filename}': untaught construct '${oneChild.tag}' inside ${variety} ` +
							`(line ${oneChild.line}). Skipping it silently would lose content.`,
					);
				});

				container.derivations.push(derivation);
			};

			// ---- walkCompositor — xs:sequence / xs:choice -> the nesting-faithful shape record.
			// DESIGN GAP, decided here (PROVISIONAL): §3.1/§6 speak of reconstructing nesting from
			// sequence positions alone, but the corpus carries 422 xs:choice groups, nested
			// compositors, 283 group refs and 25 xs:any wildcards — flat positions cannot encode
			// which compositor a child sits in. The container therefore ALSO carries
			// contentModelShape: the literal compositor tree, with element leaves pointing at their
			// sequencePosition. Elements stay flat (nodes + HAS_PROPERTY per the design); the shape
			// is a source-tier property the Phase 5 emitter reads to rebuild wrappers.
			const walkCompositor = (compositorNode, container) => {
				const shape = {
					compositor: compositorNode.tag.replace(/^xs:/, ''),
					minOccursAsWritten: optionalAttribute(compositorNode, 'minOccurs'),
					maxOccursAsWritten: optionalAttribute(compositorNode, 'maxOccurs'),
					particles: [],
				};
				compositorNode.children.forEach((oneChild, childIndex) => {
					if (oneChild.tag === 'xs:annotation') {
						// compositor-level annotation: none in this corpus; carrying it would be
						// untestable. Refuse so a future one arrives loudly.
						refuse(
							`file '${filename}': annotation on a compositor (line ${oneChild.line}) — untaught.`,
						);
					}
					if (oneChild.tag === 'xs:element') {
						const elementDecl = walkElementDecl(oneChild, container);
						elementDecl.precedingCommentValues = compositorNode.commentList.filter((oneComment) => oneComment.beforeChildIndex === childIndex).map((oneComment) => oneComment.text);
						shape.particles.push({ element: elementDecl.sequencePosition });
						return;
					}
					if (oneChild.tag === 'xs:sequence' || oneChild.tag === 'xs:choice') {
						shape.particles.push(walkCompositor(oneChild, container));
						return;
					}
					if (oneChild.tag === 'xs:group') {
						const refAsWritten = validateWrittenQName(
							requiredAttribute(oneChild, 'ref', `file '${filename}' group reference`),
							'group ref',
						);
						shape.particles.push({
							groupRef: refAsWritten,
							minOccursAsWritten: optionalAttribute(oneChild, 'minOccurs'),
							maxOccursAsWritten: optionalAttribute(oneChild, 'maxOccurs'),
						});
						parseAudit.groupRefs++;
						return;
					}
					if (oneChild.tag === 'xs:any') {
						shape.particles.push({
							any: {
								namespaceAsWritten: optionalAttribute(oneChild, 'namespace'),
								processContents: optionalAttribute(oneChild, 'processContents'),
								minOccursAsWritten: optionalAttribute(oneChild, 'minOccurs'),
								maxOccursAsWritten: optionalAttribute(oneChild, 'maxOccurs'),
							},
						});
						parseAudit.anyWildcards++;
						return;
					}
					refuse(
						`file '${filename}': untaught particle '${oneChild.tag}' in ${compositorNode.tag} ` +
							`(line ${oneChild.line}).`,
					);
				});
				return shape;
			};

			// ---- walkElementDecl — one LOCAL xs:element inside a container. sequencePosition is
			// 1-based document order among the container's element declarations, flattened across
			// compositors (names repeat massively — NoteMessage x1,454 — so position participates
			// in identity, R-ID-2). typeAsWritten is the literal prefixed string, untouched.
			const walkElementDecl = (elementNode, container) => {
				if (elementNode.attributes.ref !== undefined) {
					refuse(
						`file '${filename}': <xs:element ref=...> (line ${elementNode.line}) — zero in this ` +
							`corpus, untaught. Teach it deliberately before accepting a snapshot that uses it.`,
					);
				}
				const elementName = requiredAttribute(elementNode, 'name', `file '${filename}' local element`);
				const typeAsWritten = validateWrittenQName(
					optionalAttribute(elementNode, 'type'),
					`element '${elementName}' type`,
				);
				const elementDecl = {
					name: elementName,
					typeAsWritten,
					minOccursAsWritten: optionalAttribute(elementNode, 'minOccurs'),
					maxOccursAsWritten: optionalAttribute(elementNode, 'maxOccurs'),
					nillableAsWritten: optionalAttribute(elementNode, 'nillable'),
					formAsWritten: optionalAttribute(elementNode, 'form'),
					fixedAsWritten: optionalAttribute(elementNode, 'fixed'),
					defaultAsWritten: optionalAttribute(elementNode, 'default'),
					documentation: '',
					// every documentation string as written, an empty one and a second one included (phase F6:
					// the round trip found both on elements, which the first-value reading lost)
					documentationValues: [],
					sequencePosition: container.elements.length + 1,
					anonymousType: null,
					// the comments written immediately before this element in its compositor (set by walkCompositor)
					precedingCommentValues: [],
				};
				let elementAnnotationRead = false;
				elementNode.children.forEach((oneChild) => {
					if (oneChild.tag === 'xs:annotation') {
						refuseSecondAnnotation({ ownerText: `element '${elementName}'`, alreadyRead: elementAnnotationRead, annotationNode: oneChild });
						elementAnnotationRead = true;
						const elementAnnotation = readAnnotation(oneChild);
						elementDecl.documentation = elementAnnotation.documentation;
						elementDecl.documentationValues = elementAnnotation.documentationValues;
						return;
					}
					if (oneChild.tag === 'xs:complexType' || oneChild.tag === 'xs:simpleType') {
						if (typeAsWritten !== null) {
							refuse(
								`file '${filename}': element '${elementName}' carries BOTH type= and an inline ` +
									`type (line ${oneChild.line}) — illegal XSD; the source is corrupt, say so.`,
							);
						}
						if (elementDecl.anonymousType !== null) {
							refuse(
								`file '${filename}': element '${elementName}' carries two inline types (line ${oneChild.line}).`,
							);
						}
						elementDecl.anonymousType = walkAnonymousType(oneChild);
						return;
					}
					refuse(
						`file '${filename}': untaught construct '${oneChild.tag}' inside element ` +
							`'${elementName}' (line ${oneChild.line}).`,
					);
				});
				container.elements.push(elementDecl);
				parseAudit.elementDecls++;
				return elementDecl;
			};

			// ---- walkAttributeDecl — xs:attribute inside a container/derivation.
			const walkAttributeDecl = (attributeNode, container) => {
				const attributeName = requiredAttribute(attributeNode, 'name', `file '${filename}' attribute`);
				const attributeDecl = {
					name: attributeName,
					typeAsWritten: validateWrittenQName(
						optionalAttribute(attributeNode, 'type'),
						`attribute '${attributeName}' type`,
					),
					useAsWritten: optionalAttribute(attributeNode, 'use'),
					documentation: '',
					documentationValues: [],
					attributePosition: container.attributes.length + 1,
					anonymousType: null,
				};
				let attributeAnnotationRead = false;
				attributeNode.children.forEach((oneChild) => {
					if (oneChild.tag === 'xs:annotation') {
						refuseSecondAnnotation({ ownerText: `attribute '${attributeName}'`, alreadyRead: attributeAnnotationRead, annotationNode: oneChild });
						attributeAnnotationRead = true;
						const attributeAnnotation = readAnnotation(oneChild);
						attributeDecl.documentation = attributeAnnotation.documentation;
						attributeDecl.documentationValues = attributeAnnotation.documentationValues;
						return;
					}
					if (oneChild.tag === 'xs:simpleType') {
						attributeDecl.anonymousType = walkAnonymousType(oneChild);
						return;
					}
					refuse(
						`file '${filename}': untaught construct '${oneChild.tag}' inside attribute ` +
							`'${attributeName}' (line ${oneChild.line}).`,
					);
				});
				container.attributes.push(attributeDecl);
				parseAudit.attributeDecls++;
				return attributeDecl;
			};

			// ---- makeContainerContent / walkComplexTypeBody / walkSimpleTypeBody / walkGroupBody
			// A "container" is anything that owns elements/attributes/derivations: a named
			// complexType/simpleType/group, or an anonymous inline type.
			const makeContainerContent = () => ({
				documentation: '',
				documentationValues: [],
				derivations: [],
				elements: [],
				attributes: [],
				contentModelShape: null,
			});

			const walkComplexTypeBody = (complexTypeNode) => {
				const container = makeContainerContent();
				complexTypeNode.children.forEach((oneChild) => {
					if (oneChild.tag === 'xs:annotation') {
						const annotation = readAnnotation(oneChild);
						container.documentation = annotation.documentation;
						container.documentationValues = annotation.documentationValues;
						return;
					}
					if (oneChild.tag === 'xs:sequence' || oneChild.tag === 'xs:choice') {
						container.contentModelShape = walkCompositor(oneChild, container);
						return;
					}
					if (oneChild.tag === 'xs:simpleContent' || oneChild.tag === 'xs:complexContent') {
						const contentStyle = oneChild.tag.replace(/^xs:/, '');
						oneChild.children.forEach((oneInner) => {
							if (oneInner.tag === 'xs:restriction' || oneInner.tag === 'xs:extension') {
								walkRestrictionOrExtension({
									derivationNode: oneInner,
									contentStyle,
									container,
								});
								return;
							}
							if (oneInner.tag === 'xs:annotation') {
								refuse(
									`file '${filename}': annotation on ${oneChild.tag} (line ${oneInner.line}) — untaught.`,
								);
							}
							refuse(
								`file '${filename}': untaught construct '${oneInner.tag}' inside ` +
									`${oneChild.tag} (line ${oneInner.line}).`,
							);
						});
						return;
					}
					if (oneChild.tag === 'xs:attribute') {
						walkAttributeDecl(oneChild, container);
						return;
					}
					refuse(
						`file '${filename}': untaught construct '${oneChild.tag}' inside complexType ` +
							`(line ${oneChild.line}).`,
					);
				});
				return container;
			};

			const walkSimpleTypeBody = (simpleTypeNode) => {
				const container = makeContainerContent();
				simpleTypeNode.children.forEach((oneChild) => {
					if (oneChild.tag === 'xs:annotation') {
						const annotation = readAnnotation(oneChild);
						container.documentation = annotation.documentation;
						container.documentationValues = annotation.documentationValues;
						return;
					}
					if (oneChild.tag === 'xs:restriction') {
						walkRestrictionOrExtension({
							derivationNode: oneChild,
							contentStyle: 'simpleType',
							container,
						});
						return;
					}
					// xs:union and xs:list occur ZERO times in this corpus; teaching them blind
					// would be untestable code, skipping them would lose content. Refuse by name.
					refuse(
						`file '${filename}': untaught construct '${oneChild.tag}' inside simpleType ` +
							`(line ${oneChild.line}).`,
					);
				});
				return container;
			};

			const walkGroupBody = (groupNode) => {
				const container = makeContainerContent();
				groupNode.children.forEach((oneChild) => {
					if (oneChild.tag === 'xs:annotation') {
						const annotation = readAnnotation(oneChild);
						container.documentation = annotation.documentation;
						container.documentationValues = annotation.documentationValues;
						return;
					}
					if (oneChild.tag === 'xs:sequence' || oneChild.tag === 'xs:choice') {
						container.contentModelShape = walkCompositor(oneChild, container);
						return;
					}
					refuse(
						`file '${filename}': untaught construct '${oneChild.tag}' inside group ` +
							`(line ${oneChild.line}).`,
					);
				});
				return container;
			};

			const walkAnonymousType = (typeNode) => {
				parseAudit.anonymousTypes++;
				const typeVariety = typeNode.tag === 'xs:complexType' ? 'complexType' : 'simpleType';
				return {
					typeVariety,
					body:
						typeVariety === 'complexType'
							? walkComplexTypeBody(typeNode)
							: walkSimpleTypeBody(typeNode),
				};
			};

			return {
				validateWrittenQName,
				leadingAnnotation,
				readAnnotation,
				refuseSecondAnnotation,
				walkComplexTypeBody,
				walkSimpleTypeBody,
				walkGroupBody,
				walkAnonymousType,
			};
		};

		// =====================================================================
		// parseOneArtifact — one .xsd file -> the artifact model.
		// =====================================================================
		const parseOneArtifact = ({ filePath, filename, parseAudit }) => {
			const fileBytes = fs.readFileSync(filePath);
			const xmlText = fileBytes.toString('utf8');
			const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');

			const treeResult = parseXsdTree({ xmlText, filename });
			if (treeResult.error) {
				refuse(treeResult.error);
			}
			const schemaNode = treeResult.root;
			if (schemaNode.tag !== 'xs:schema') {
				refuse(`file '${filename}': root element is '${schemaNode.tag}', not xs:schema`);
			}
			// a comment inside a definition stands only in a compositor, before an element (the one taught site)
			const refuseUntaughtCommentSite = (treeNode) => {
				treeNode.commentList.forEach((oneComment) => {
					const followingChild = treeNode.children[oneComment.beforeChildIndex];
					if (COMMENT_HOLDING_TAG_LIST.indexOf(treeNode.tag) === -1 || followingChild === undefined || followingChild.tag !== 'xs:element') {
						refuse(
							`file '${filename}': comment '${oneComment.text}' inside ${treeNode.tag} (line ${treeNode.line}) stands ` +
								`${followingChild === undefined ? 'last in its parent' : `before ${followingChild.tag} (line ${followingChild.line})`}. ` +
								`The one taught site is an xs:sequence or xs:choice, immediately before an xs:element; teach this one deliberately.`,
						);
					}
				});
				treeNode.children.forEach(refuseUntaughtCommentSite);
			};
			schemaNode.children.forEach(refuseUntaughtCommentSite);
			const commentList = [
				...treeResult.prologCommentList.map((oneComment) => ({ placement: COMMENT_PLACEMENT.PROLOG, text: oneComment.text })),
				...schemaNode.commentList.map((oneComment) => ({ placement: COMMENT_PLACEMENT.SCHEMA, beforeSchemaChildIndex: oneComment.beforeChildIndex, text: oneComment.text })),
				...treeResult.epilogCommentList.map((oneComment) => ({ placement: COMMENT_PLACEMENT.EPILOG, text: oneComment.text })),
			];
			const untaughtAttribute = untaughtAttributeOf({ treeNode: schemaNode, parentTag: null });
			if (untaughtAttribute !== null) {
				refuse(
					`file '${filename}': attribute '${untaughtAttribute.untaughtName}' on ${untaughtAttribute.treeNode.tag} ` +
						`(a ${untaughtAttribute.constructName}, line ${untaughtAttribute.treeNode.line}) is neither carried nor on ` +
						`the construct's declared ignore list. Reading past it would drop it silently; teach it or declare it ignored, with the reason.`,
				);
			}

			// prefix table — every xmlns declaration on the schema element. The corpus declares
			// namespaces ONLY on the root (measured 2026-08-05: zero nested xmlns), so the root
			// table IS the file's whole prefix scope; a nested declaration would surface as an
			// unbound-prefix refusal, which is the honest failure for an unmeasured shape.
			const prefixBindings = {};
			const schemaAttributes = {};
			schemaNode.attributeOrder.forEach((oneAttributeName) => {
				const attributeValue = schemaNode.attributes[oneAttributeName];
				if (oneAttributeName === 'xmlns') {
					prefixBindings[''] = attributeValue; // the DEFAULT namespace (5 files carry one)
					return;
				}
				if (oneAttributeName.indexOf('xmlns:') === 0) {
					prefixBindings[oneAttributeName.substring(6)] = attributeValue;
					return;
				}
				schemaAttributes[oneAttributeName] = attributeValue;
			});

			const targetNamespace = requiredAttribute(schemaNode, 'targetNamespace', `file '${filename}'`);
			const namespaceMatch = targetNamespace.match(PESC_NAMESPACE_PATTERN);
			if (!namespaceMatch) {
				refuse(
					`file '${filename}': targetNamespace '${targetNamespace}' is not urn:org:pesc:* ` +
						`(layer:name:version). This corpus is PESC; anything else does not belong here.`,
				);
			}
			const layer = namespaceMatch[1];
			const standardToken = namespaceMatch[2];
			const versionToken = namespaceMatch[3];

			const walker = makeFileWalker({ filename, prefixBindings, parseAudit });

			const artifact = {
				filename,
				sha256,
				byteCount: fileBytes.length,
				targetNamespace,
				layer,
				standardToken,
				versionToken,
				prefixBindings,
				schemaAttributes,
				documentation: '',
				// every schema-level annotation, where it stands: after the import or definition whose
				// documentPosition is afterDocumentPosition (0: before the first). Phase F6: Document Request's
				// and Document Response's annotations follow their imports, which a leading-only reading moved
				annotationList: [],
				// every comment outside a definition, in document order (G20): { placement, beforeSchemaChildIndex, text }
				commentList,
				imports: [],
				definitions: [],
			};

			// walk the schema's top-level children in DOCUMENT ORDER. documentPosition is one
			// shared 1-based counter across imports and definitions, so the emitter's "emit in
			// documentPosition order" (design §6) is a total order with no tie to break.
			let documentPosition = 0;
			schemaNode.children.forEach((oneChild) => {
				if (oneChild.tag === 'xs:annotation') {
					const fileAnnotation = walker.readAnnotation(oneChild);
					if (artifact.annotationList.length === 0) {
						artifact.documentation = fileAnnotation.documentation;
					}
					artifact.annotationList.push({ afterDocumentPosition: documentPosition, documentationValues: fileAnnotation.documentationValues });
					return;
				}
				if (oneChild.tag === 'xs:import') {
					documentPosition++;
					const namespaceAsWritten = requiredAttribute(
						oneChild,
						'namespace',
						`file '${filename}' xs:import`,
					);
					// THE ACYCLICITY ASSERTION (spec §2.2: observed, not guaranteed — assert it).
					// An import may only point at a STRICTLY LOWER layer. message->message (the
					// spec's named hazard) and every other same-or-upward import refuses by name.
					const importedMatch = namespaceAsWritten.match(PESC_NAMESPACE_PATTERN);
					if (!importedMatch) {
						refuse(
							`file '${filename}': imports non-PESC namespace '${namespaceAsWritten}' ` +
								`(line ${oneChild.line}).`,
						);
					}
					if (LAYER_RANKS[importedMatch[1]] >= LAYER_RANKS[layer]) {
						refuse(
							`file '${filename}' (layer '${layer}', namespace '${targetNamespace}') imports ` +
								`'${namespaceAsWritten}' (layer '${importedMatch[1]}') — the layer order ` +
								`codes < core < sector < message is violated. The import graph's acyclicity ` +
								`is observed in this corpus, never guaranteed by PESC; this file breaks it.`,
						);
					}
					artifact.imports.push({
						namespaceAsWritten,
						schemaLocationAsWritten: optionalAttribute(oneChild, 'schemaLocation'),
						documentPosition,
					});
					parseAudit.imports++;
					return;
				}

				const definitionKindByTag = {
					'xs:complexType': 'complexType',
					'xs:simpleType': 'simpleType',
					'xs:element': 'element',
					'xs:group': 'group',
					'xs:attributeGroup': 'attributeGroup',
				};
				const kind = definitionKindByTag[oneChild.tag];
				if (kind === undefined) {
					refuse(
						`file '${filename}': untaught top-level construct '${oneChild.tag}' ` +
							`(line ${oneChild.line}).`,
					);
				}
				if (kind === 'attributeGroup') {
					refuse(
						`file '${filename}': xs:attributeGroup (line ${oneChild.line}) — zero in this ` +
							`corpus, untaught. Teach it deliberately before accepting it.`,
					);
				}
				documentPosition++;
				const definitionName = requiredAttribute(
					oneChild,
					'name',
					`file '${filename}' top-level ${oneChild.tag}`,
				);

				const definition = {
					kind,
					name: definitionName,
					documentPosition,
					documentation: '',
					// every documentation string as written: set for a top-level element (phase F6, as local elements); a type or group carries its own on content
					documentationValues: [],
					// top-level ELEMENT declarations carry reference-ish attributes of their own
					typeAsWritten: null,
					substitutionGroupAsWritten: null,
					abstractAsWritten: optionalAttribute(oneChild, 'abstract'),
					nillableAsWritten: optionalAttribute(oneChild, 'nillable'),
					content: null,
					anonymousType: null,
				};

				if (kind === 'element') {
					definition.typeAsWritten = walker.validateWrittenQName(
						optionalAttribute(oneChild, 'type'),
						`top-level element '${definitionName}' type`,
					);
					definition.substitutionGroupAsWritten = walker.validateWrittenQName(
						optionalAttribute(oneChild, 'substitutionGroup'),
						`top-level element '${definitionName}' substitutionGroup`,
					);
					let globalAnnotationRead = false;
					oneChild.children.forEach((oneInner) => {
						if (oneInner.tag === 'xs:annotation') {
							walker.refuseSecondAnnotation({ ownerText: `top-level element '${definitionName}'`, alreadyRead: globalAnnotationRead, annotationNode: oneInner });
							globalAnnotationRead = true;
							const globalAnnotation = walker.readAnnotation(oneInner);
							definition.documentation = globalAnnotation.documentation;
							definition.documentationValues = globalAnnotation.documentationValues;
							return;
						}
						if (oneInner.tag === 'xs:complexType' || oneInner.tag === 'xs:simpleType') {
							if (definition.typeAsWritten !== null) {
								refuse(
									`file '${filename}': top-level element '${definitionName}' carries BOTH ` +
										`type= and an inline type (line ${oneInner.line}) — illegal XSD.`,
								);
							}
							if (definition.anonymousType !== null) {
								refuse(
									`file '${filename}': top-level element '${definitionName}' carries two ` +
										`inline types (line ${oneInner.line}).`,
								);
							}
							definition.anonymousType = walker.walkAnonymousType(oneInner);
							return;
						}
						refuse(
							`file '${filename}': untaught construct '${oneInner.tag}' inside top-level ` +
								`element '${definitionName}' (line ${oneInner.line}).`,
						);
					});
				} else if (kind === 'complexType') {
					definition.content = walker.walkComplexTypeBody(oneChild);
					definition.documentation = definition.content.documentation;
				} else if (kind === 'simpleType') {
					definition.content = walker.walkSimpleTypeBody(oneChild);
					definition.documentation = definition.content.documentation;
				} else if (kind === 'group') {
					definition.content = walker.walkGroupBody(oneChild);
					definition.documentation = definition.content.documentation;
				}

				artifact.definitions.push(definition);
				parseAudit.namedDefinitions++;
			});

			parseAudit.artifacts++;
			return artifact;
		};

		// =====================================================================
		// parsePescCorpus — the public entry. ({ sourcePath }, callback).
		// =====================================================================
		const parsePescCorpus = ({ sourcePath }, callback) => {
			const parseAudit = {
				artifacts: 0,
				imports: 0,
				namedDefinitions: 0,
				elementDecls: 0,
				anonymousTypes: 0,
				attributeDecls: 0,
				enumerationValues: 0,
				facetsCaptured: 0,
				groupRefs: 0,
				anyWildcards: 0,
				multiDocumentationAnnotations: 0,
			};

			let artifacts;
			let walkError = '';
			try {
				if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
					refuse(`sourcePath '${sourcePath}' is not a directory`);
				}
				const xsdFilenames = fs
					.readdirSync(sourcePath)
					.filter((oneName) => /\.xsd$/i.test(oneName))
					.sort(); // deterministic corpus order — identity never depends on it, order of emission does
				if (xsdFilenames.length === 0) {
					refuse(`sourcePath '${sourcePath}' contains no .xsd files`);
				}
				artifacts = xsdFilenames.map((oneFilename) =>
					parseOneArtifact({
						filePath: path.join(sourcePath, oneFilename),
						filename: oneFilename,
						parseAudit,
					}),
				);

				// duplicate-bytes refusal: two artifacts with one sha256 would fuse into one
				// content-addressed node — an acquisition defect wearing a graph disguise.
				const filenamesBySha = {};
				artifacts.forEach((oneArtifact) => {
					(filenamesBySha[oneArtifact.sha256] = filenamesBySha[oneArtifact.sha256] || []).push(
						oneArtifact.filename,
					);
				});
				Object.keys(filenamesBySha).forEach((oneSha) => {
					if (filenamesBySha[oneSha].length > 1) {
						refuse(
							`byte-identical artifacts (${filenamesBySha[oneSha].join(', ')}) share sha256 ` +
								`${oneSha}. Two names for one byte stream is an acquisition defect; the ` +
								`corpus, not the graph, must say which one exists.`,
						);
					}
				});
			} catch (thrownError) {
				walkError = thrownError.message;
			}
			if (walkError) {
				callback(walkError);
				return;
			}
			callback('', { artifacts, parseAudit });
		};

		return { parsePescCorpus };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
