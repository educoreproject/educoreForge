'use strict';

// roundTripXsdCanonical.js — XSD text -> a CANONICAL STATEMENT SET, the common measuring surface
// both halves of the PESC round-trip are reduced to before anything is compared (doctrine §5, §11:
// each bundle owns its diff domain and canonicalization; this file IS that definition for PESC).
//
// WHY A REAL XML PARSE. The forge's parser (lib/parser.js) navigates the XSDs by regex. If this
// instrument shared that code, a navigation bug would cancel out on both sides and the diff would
// bless the loss. This canonicalizer therefore parses with xml2js — the same independent-parse
// stance the CEDS reference takes (roundTripCanonical.js) — and is applied IDENTICALLY to the
// committed snapshot files and to the validator's re-emitted files, so a canonicalization decision
// can never register as a one-sided difference.
//
// THE CRITERION IS SEMANTIC ROUND-TRIP — statement-set equality — not byte equality. Whitespace,
// element order, attribute order and prefix choice are not statements; a missing or extra
// STATEMENT is. The PESC-specific canonicalization rules, each deliberate and each visible here:
//
//   * TYPE REFERENCES ARE COMPARED AT LOCAL-NAME PRECISION. A non-xs: prefix is stripped on BOTH
//     sides ('core:NameType' and 'NameType' assert the same reference). The 'xs:' prefix is KEPT —
//     it names the XML-Schema builtin vocabulary, uniform across the whole source set (verified by
//     the test suite, RT-5). Consequence, load-bearing for R-PW-4 condition 2: the re-emission
//     can never invent an absent import version, because versions live in namespace/import
//     declarations and type-reference statements never carry them. Version drift stays visible
//     through the file-level import statements below, which the graph cannot emit (NOT
//     REPRODUCED, category explicitlyOmitted — deliberate, and excluded from loss by A13).
//   * OCCURRENCE IS NORMALIZED TO XSD-EFFECTIVE VALUES on both sides: an element's absent
//     minOccurs/maxOccurs is '1' (the XSD grammar's own default, the forge parser's reviewed
//     stance); an attribute's use='required' is minOccurs '1', anything else '0', maxOccurs '1'.
//   * THE COMPOSITOR AND MEMBER ORDER ARE NOT MEASURED — AND "COMPOSITOR KIND" UNDERSTATED THIS,
//     which Phase 6 measured and corrected here rather than only in the verdict. xs:sequence /
//     xs:choice / xs:all are walked through transparently and member statements are flattened onto
//     the owning block (mirroring the forge parser's flat field extraction). Because the compositor
//     is not a statement on EITHER side, its total ABSENCE from the emitted document is invisible
//     here and reads as fidelity: measured 2026-08-06, the source corpus carries 3,021 xs:sequence
//     and 211 xs:choice, the emitted corpus carries ZERO, and a conforming XSD processor refuses 63
//     of 64 emitted documents. That is not sequence-versus-choice; it is "the emitted document is
//     not a schema". This is a stated instrument limit —
//     the tradeoff is recorded here rather than discovered later, exactly as the CEDS
//     canonicalizer records its collection-plumbing tradeoff.
//   * ENUMERATION VALUES ARE TRIMMED (leading/trailing whitespace only — the D6 identity ruling:
//     'NoCredit ' and 'NoCredit' are one option). Values that are EMPTY after trimming REMAIN
//     STATEMENTS on the source side — the graph deliberately does not carry them, so they appear
//     individually located in the LOST census (category contentGap) instead of being absorbed.
//   * DOCUMENTATION LITERALS ARE VERBATIM (trimmed only) — CHANGED IN PHASE 5 BY THE O-2 RULING.
//     The incumbent collapsed whitespace runs here, on BOTH sides, which made every whitespace
//     difference invisible by construction. Measured before it was decided: the collapse hid ZERO
//     differences (26,619 of 26,621 literals already matched verbatim), so removal cost nothing
//     and closed a permanently unfalsifiable dimension. Trim survives and is declared — the
//     whitespace immediately inside the tag is the document's indentation, not the author's prose.
//     The collapse is retained as an INSTRUMENT ONLY (collapseWhitespaceRuns), feeding the
//     whitespaceOnlyDifference sentinel the diff publishes, so the dimension stays watched.
//   * WHAT THIS INSTRUMENT DOES NOT MODEL IS COUNTED, NEVER SILENTLY DROPPED. Every xs:* element
//     encountered that the walk has no rule for lands in stats.unmodeledConstructCounts by name.
//     An instrument that quietly ignores input cannot be trusted about what it measured.
//
// SCOPE. This module READS text. It never touches a file, a graph, or a network. Pure and
// callback-shaped (R7): malformed input is refused BY NAME through the callback (xml2js
// delivers parse failures through its own callback, so no try/catch exists here at all).
// House style: no async/await, no try/catch for control flow, camelCase only.

const xml2js = require('xml2js');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const XS_PREFIX = 'xs:';
const SUBJECT_SCHEME = 'pesc://';

// The predicates whose LOST entries are DECLARED CONTEXT rather than content gaps: file-level
// declarations the graph deliberately does not carry (supervisor refinement, 2026-08-03). The
// diff consults this registry to tag each LOST row; anything NOT named here defaults to
// contentGap — explicitlyOmitted must be claimed, never assumed. (Category renamed from
// declaredContext by doctrine amendment A13, 2026-08-04: the old name did not say WE CHOSE
// THIS, so its count was summed into LOST and overstated the real gap.)
const EXPLICITLY_OMITTED_PREDICATES = [
	'targetNamespace',
	'schemaVersionAttribute',
	'elementFormDefault',
	'attributeFormDefault',
	'importsSchemaLocation',
	'importsNamespace',
];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// decodeXmlCharacterReferences — XML 1.0 character/entity references decoded to their
		// characters. xml2js decodes them on a normal parse; this exists for text that reaches a
		// literal in ALREADY-ESCAPED spelling (the forge's regex parser preserves '&#xC9;' as six
		// characters, so the graph carries the escaped spelling of the SAME datum). Decoding is
		// grammar knowledge (XML 1.0 §4.1), not data knowledge, and it is applied to BOTH sides.
		// Order is load-bearing: numeric and named forms first, bare '&amp;' LAST, so a literal
		// ampersand cannot cascade into a second decode.
		const decodeXmlCharacterReferences = (text) =>
			String(text)
				.replace(/&#x([0-9a-fA-F]+);/g, (unused, hexCode) =>
					String.fromCodePoint(parseInt(hexCode, 16)),
				)
				.replace(/&#(\d+);/g, (unused, decimalCode) =>
					String.fromCodePoint(parseInt(decimalCode, 10)),
				)
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&quot;/g, '"')
				.replace(/&apos;/g, "'")
				.replace(/&amp;/g, '&');

		// -----
		// normalizeDocumentation — THE O-2 RULING, MEASURED BEFORE IT WAS DECIDED (Phase 5,
		// session CRYSTAL_STREAM). Decode character references, trim. THE WHITESPACE COLLAPSE THE
		// INCUMBENT APPLIED IS GONE.
		//
		// The incumbent ran `.replace(/\s+/g,' ')` here, on BOTH sides of the comparison. A
		// normalization applied to both sides makes every difference it erases invisible BY
		// CONSTRUCTION — the comparison then agrees with itself on that dimension whether or not
		// any difference exists. R-VAL-2 says whitespace inside xs:documentation is significant to
		// a reader and must not be collapsed by default.
		//
		// WHAT THE MEASUREMENT FOUND, so this is a decision on evidence rather than on principle
		// (test/probes/p5_measureDocumentationWhitespaceCollapse.js, artifact
		// test/test-artifacts/p5DocumentationWhitespaceMeasurement.json): the collapse hid
		// **ZERO** differences. 26,619 of 26,621 source documentation literals match the graph
		// IDENTICALLY under trim-only normalization. Removal therefore costs nothing today, and
		// the shipped instrument proved it can report otherwise — one space changed to three
		// inside one documentation string in a COPY of CoreMain_v1.4.0.xsd moved the count 0 -> 1
		// while the collapse path stayed blind.
		//
		// TRIM SURVIVES, AND IS DECLARED. The whitespace immediately inside an xs:documentation
		// tag is the enclosing document's indentation, not the author's prose. That is the one
		// normalization remaining on this predicate and it is named here rather than assumed.
		//
		// THE DIMENSION IS NOT MERELY UN-NORMALIZED, IT IS WATCHED. `collapseWhitespaceRuns`
		// below feeds a parallel key set so the diff can report, as its own number, how many
		// statements a collapse WOULD have absorbed. That number is 0 today and becomes non-zero
		// the moment whitespace fidelity regresses — which is the difference between removing a
		// blind spot and merely looking away from it.
		const normalizeDocumentation = (text) =>
			decodeXmlCharacterReferences(String(text == null ? '' : text)).trim();

		// -----
		// collapseWhitespaceRuns — the normalization that NO LONGER governs the comparison, kept
		// as an instrument so its effect stays measurable. Used ONLY to build the parallel
		// collapsed key set; never to decide whether two statements are equal.
		const collapseWhitespaceRuns = (text) => String(text).replace(/\s+/g, ' ').trim();

		// -----
		// canonicalTypeRef — the local-name precision ruling. 'xs:' is kept (builtin vocabulary,
		// uniform across the source set); any other prefix is stripped.
		const canonicalTypeRef = (rawRef) => {
			const trimmedRef = String(rawRef == null ? '' : rawRef).trim();
			if (trimmedRef === '' || trimmedRef.startsWith(XS_PREFIX)) {
				return trimmedRef;
			}
			const colonAt = trimmedRef.indexOf(':');
			return colonAt === -1 ? trimmedRef : trimmedRef.slice(colonAt + 1);
		};

		// -----
		// statementKey — the identity of a statement. NUL-joined so no field can bleed into the
		// next; every field that can change meaning is in the key.
		const statementKey = (statement) =>
			[statement.subject, statement.predicate, statement.object].join('\u0000');

		// -----
		// elementChildKeys — the child-element names of an xml2js node ('$' = attributes,
		// '_' = text; everything else is a child element name).
		const elementChildKeys = (element) =>
			element && typeof element === 'object'
				? Object.keys(element).filter((oneName) => oneName !== '$' && oneName !== '_')
				: [];

		const attributesOf = (element) => (element && element['$']) || {};

		// -----
		// firstDocumentationOf — the element's own xs:annotation/xs:documentation text, or ''.
		// Direct child only: a component's documentation is the annotation it carries itself.
		const firstDocumentationOf = (element) => {
			const annotationList = (element && element['xs:annotation']) || [];
			for (const oneAnnotation of annotationList) {
				const documentationList = (oneAnnotation && oneAnnotation['xs:documentation']) || [];
				for (const oneDocumentation of documentationList) {
					const text =
						typeof oneDocumentation === 'string'
							? oneDocumentation
							: (oneDocumentation && oneDocumentation['_']) || '';
					const normalized = normalizeDocumentation(text);
					if (normalized !== '') {
						return normalized;
					}
				}
			}
			return '';
		};

		// firstDescendantDocumentationOf — first non-empty xs:documentation anywhere beneath the
		// element (deterministic walk: annotation first, then children in declaration order).
		// Mirrors the forge parser's field rule (first documentation in the field's inner text) —
		// the parser-mirroring rule stated in the header.
		const firstDescendantDocumentationOf = (element) => {
			const ownDocumentation = firstDocumentationOf(element);
			if (ownDocumentation !== '') {
				return ownDocumentation;
			}
			for (const oneChildName of elementChildKeys(element)) {
				if (oneChildName === 'xs:annotation') {
					continue; // already consulted
				}
				for (const oneChild of element[oneChildName] || []) {
					if (typeof oneChild !== 'object' || oneChild === null) {
						continue;
					}
					const found = firstDescendantDocumentationOf(oneChild);
					if (found !== '') {
						return found;
					}
				}
			}
			return '';
		};

		// -----
		// collectDescendants — every descendant element of the given xs:* names, flattened
		// (the compositor-transparency ruling). Returns them in deterministic walk order.
		// descendIntoMatches: when true, a matched element's OWN subtree is also searched — the
		// FULL-FLATTEN rule used for field collection, because the graph's field model is flat
		// (a member element nested inside another member's inline complexType is still a field of
		// the named owner; verified against FFELDisbursementResponseType, whose Response member
		// nests seven further elements the graph attributes to the type).
		const collectDescendants = (element, wantedNameList, options = {}, resultList = []) => {
			elementChildKeys(element).forEach((oneChildName) => {
				(element[oneChildName] || []).forEach((oneChild) => {
					if (typeof oneChild !== 'object' || oneChild === null) {
						return;
					}
					if (wantedNameList.includes(oneChildName)) {
						resultList.push({ elementName: oneChildName, element: oneChild });
						if (!options.descendIntoMatches) {
							return;
						}
					}
					collectDescendants(oneChild, wantedNameList, options, resultList);
				});
			});
			return resultList;
		};

		// The facet elements measured as statements when they carry a value.
		const FACET_ELEMENT_NAMES = [
			'xs:pattern',
			'xs:length',
			'xs:minLength',
			'xs:maxLength',
			'xs:minInclusive',
			'xs:maxInclusive',
			'xs:minExclusive',
			'xs:maxExclusive',
			'xs:totalDigits',
			'xs:fractionDigits',
			'xs:whiteSpace',
		];

		// =====================================================================
		// canonicalizeXsdText — ONE file's text -> statements. callback('', { statements, stats })
		// =====================================================================

		const canonicalizeXsdText = ({ xsdText, fileLabel } = {}, callback) => {
			if (typeof xsdText !== 'string' || xsdText.trim() === '') {
				callback(
					`${moduleName}.canonicalizeXsdText: xsdText is REQUIRED and has no default — a ` +
						`canonicalization of nothing is not an empty document, it is a missing input.`,
				);
				return;
			}
			if (typeof fileLabel !== 'string' || fileLabel.trim() === '') {
				callback(
					`${moduleName}.canonicalizeXsdText: fileLabel is REQUIRED and has no default — every ` +
						`statement subject is scoped to the file it came from.`,
				);
				return;
			}

			xml2js.parseString(xsdText, (parseError, parsed) => {
				if (parseError) {
					callback(
						`${moduleName}.canonicalizeXsdText: XML parse of '${fileLabel}' failed: ` +
							`${parseError.message}`,
					);
					return;
				}

				const schemaElement = parsed && parsed['xs:schema'];
				if (!schemaElement) {
					callback(
						`${moduleName}.canonicalizeXsdText: '${fileLabel}' has no xs:schema root element — ` +
							`it is not the XSD document this instrument measures (a non-'xs' schema prefix ` +
							`would also land here; the PESC source set uniformly uses 'xs:').`,
					);
					return;
				}

				const statements = new Map();
				const collapsedStatementKeys = new Set();
				let rawStatementCount = 0;
				const subjects = new Set();
				const unmodeledConstructCounts = {};

				const fileSubject = `${SUBJECT_SCHEME}${fileLabel}`;

				const emit = ({ subject, predicate, object, subjectRoot }) => {
					rawStatementCount += 1;
					subjects.add(subject);
					const statement = {
						subject,
						predicate,
						object: String(object),
						subjectRoot: subjectRoot || subject,
						fileLabel,
					};
					const identity = statementKey(statement);
					if (!statements.has(identity)) {
						statements.set(identity, statement);
					}
					// THE WHITESPACE SENTINEL. Same subject and predicate, object with runs
					// collapsed. This set decides NOTHING about equality — the diff consults it
					// only to report how many statements a collapse WOULD have absorbed, so the
					// dimension the collapse used to hide stays a published number instead of
					// becoming invisible in the other direction.
					collapsedStatementKeys.add(
						JSON.stringify([subject, predicate, collapseWhitespaceRuns(String(object))]),
					);
				};

				const countUnmodeled = (elementName) => {
					unmodeledConstructCounts[elementName] =
						(unmodeledConstructCounts[elementName] || 0) + 1;
				};

				// ---- field statements (an xs:element or xs:attribute under an owning block) ----
				const emitFieldStatements = ({ fieldElementName, fieldElement, ownerSubject }) => {
					const fieldAttributes = attributesOf(fieldElement);
					const fieldName = fieldAttributes.name;
					if (!fieldName) {
						// a ref-only member (<xs:element ref="…"/>) declares no field of its own;
						// measured as a reference statement on the owner.
						if (fieldAttributes.ref) {
							emit({
								subject: ownerSubject,
								predicate:
									fieldElementName === 'xs:attribute'
										? 'referencesAttribute'
										: 'referencesElement',
								object: canonicalTypeRef(fieldAttributes.ref),
								subjectRoot: ownerSubject,
							});
						} else {
							countUnmodeled(`${fieldElementName}[nameless]`);
						}
						return;
					}

					const xsdKind = fieldElementName === 'xs:attribute' ? 'attribute' : 'element';
					const fieldSubject = `${ownerSubject}/${xsdKind}/${fieldName}`;
					const fieldEmit = (predicate, object) =>
						emit({ subject: fieldSubject, predicate, object, subjectRoot: ownerSubject });

					// occurrence — the XSD-effective-value ruling.
					if (xsdKind === 'element') {
						fieldEmit('minOccurs', fieldAttributes.minOccurs || '1');
						fieldEmit('maxOccurs', fieldAttributes.maxOccurs || '1');
					} else {
						fieldEmit('minOccurs', fieldAttributes.use === 'required' ? '1' : '0');
						fieldEmit('maxOccurs', '1');
					}

					// the field's type: @type, else the base of a DIRECT inline xs:simpleType's
					// restriction, else the base of a DIRECT inline xs:complexType's xs:simpleContent
					// derivation — the two inline spellings by which the source states a content type.
					// Direct-child scoping throughout, so a NESTED member's restriction can never
					// masquerade as this field's type.
					let effectiveTypeRef = fieldAttributes.type || '';
					if (!effectiveTypeRef) {
						const directInlineSimpleTypeList = fieldElement['xs:simpleType'] || [];
						for (const oneInlineSimpleType of directInlineSimpleTypeList) {
							const directRestrictionList = oneInlineSimpleType['xs:restriction'] || [];
							if (directRestrictionList.length) {
								effectiveTypeRef = attributesOf(directRestrictionList[0]).base || '';
								break;
							}
						}
					}
					if (!effectiveTypeRef) {
						const directInlineComplexTypeList = fieldElement['xs:complexType'] || [];
						for (const oneInlineComplexType of directInlineComplexTypeList) {
							const simpleContentList = oneInlineComplexType['xs:simpleContent'] || [];
							for (const oneSimpleContent of simpleContentList) {
								const derivationList = []
									.concat(oneSimpleContent['xs:restriction'] || [])
									.concat(oneSimpleContent['xs:extension'] || []);
								if (derivationList.length) {
									effectiveTypeRef = attributesOf(derivationList[0]).base || '';
									break;
								}
							}
							if (effectiveTypeRef) {
								break;
							}
						}
					}
					if (effectiveTypeRef) {
						fieldEmit('fieldType', canonicalTypeRef(effectiveTypeRef));
					}

					const fieldDocumentation = firstDescendantDocumentationOf(fieldElement);
					if (fieldDocumentation !== '') {
						fieldEmit('documentation', fieldDocumentation);
					}

					// scalar declaration facts the source may state (absent is absent).
					if (fieldAttributes.default !== undefined) {
						fieldEmit(xsdKind === 'attribute' ? 'attributeDefault' : 'elementDefault', fieldAttributes.default);
					}
					if (fieldAttributes.fixed !== undefined) {
						fieldEmit(xsdKind === 'attribute' ? 'attributeFixed' : 'elementFixed', fieldAttributes.fixed);
					}
					if (fieldAttributes.nillable !== undefined) {
						fieldEmit('nillable', fieldAttributes.nillable);
					}

					// inline anonymous simpleType content: enumerations and facets land on the FIELD
					// subject — this is where the CoreMain whitespace-only enumeration value lives.
					collectDescendants(fieldElement, ['xs:enumeration']).forEach((oneFound) => {
						const rawInlineValue = attributesOf(oneFound.element).value;
						fieldEmit(
							'inlineEnumerationValue',
							decodeXmlCharacterReferences(String(rawInlineValue == null ? '' : rawInlineValue)).trim(),
						);
					});
					collectDescendants(fieldElement, FACET_ELEMENT_NAMES).forEach((oneFound) => {
						const facetValue = attributesOf(oneFound.element).value;
						if (facetValue !== undefined) {
							fieldEmit(`facet:${oneFound.elementName.slice(XS_PREFIX.length)}`, facetValue);
						}
					});
					collectDescendants(fieldElement, ['xs:union']).forEach((oneFound) => {
						const memberTypes = attributesOf(oneFound.element).memberTypes;
						if (memberTypes !== undefined) {
							fieldEmit(
								'unionMemberTypes',
								String(memberTypes).trim().split(/\s+/).map(canonicalTypeRef).join(' '),
							);
						}
					});
				};

				// ---- shared block content: fields, group refs, wildcards ----
				const emitBlockMemberStatements = ({ blockElement, ownerSubject }) => {
					collectDescendants(
						blockElement,
						['xs:element', 'xs:attribute'],
						{ descendIntoMatches: true }, // the FULL-FLATTEN rule — see collectDescendants
					).forEach(
						(oneFound) =>
							emitFieldStatements({
								fieldElementName: oneFound.elementName,
								fieldElement: oneFound.element,
								ownerSubject,
							}),
					);
					collectDescendants(blockElement, ['xs:group']).forEach((oneFound) => {
						const groupRef = attributesOf(oneFound.element).ref;
						if (groupRef) {
							emit({
								subject: ownerSubject,
								predicate: 'usesGroup',
								object: canonicalTypeRef(groupRef),
								subjectRoot: ownerSubject,
							});
						}
					});
					collectDescendants(blockElement, ['xs:attributeGroup']).forEach((oneFound) => {
						const attributeGroupRef = attributesOf(oneFound.element).ref;
						if (attributeGroupRef) {
							emit({
								subject: ownerSubject,
								predicate: 'usesAttributeGroup',
								object: canonicalTypeRef(attributeGroupRef),
								subjectRoot: ownerSubject,
							});
						}
					});
					collectDescendants(blockElement, ['xs:any']).forEach((oneFound) => {
						emit({
							subject: ownerSubject,
							predicate: 'allowsAnyElement',
							object: attributesOf(oneFound.element).processContents || 'strict',
							subjectRoot: ownerSubject,
						});
					});
					collectDescendants(blockElement, ['xs:anyAttribute']).forEach((oneFound) => {
						emit({
							subject: ownerSubject,
							predicate: 'allowsAnyAttribute',
							object: attributesOf(oneFound.element).processContents || 'strict',
							subjectRoot: ownerSubject,
						});
					});
				};

				// ---- named simpleType ----
				const emitSimpleTypeStatements = ({ simpleTypeElement }) => {
					const simpleTypeName = attributesOf(simpleTypeElement).name;
					const typeSubject = `${SUBJECT_SCHEME}${fileLabel}#simpleType/${simpleTypeName}`;
					emit({ subject: fileSubject, predicate: 'declaresSimpleType', object: simpleTypeName });

					const typeDocumentation = firstDocumentationOf(simpleTypeElement);
					if (typeDocumentation !== '') {
						emit({ subject: typeSubject, predicate: 'documentation', object: typeDocumentation });
					}

					const restrictionList = collectDescendants(simpleTypeElement, ['xs:restriction']);
					if (restrictionList.length) {
						const restrictionBase = attributesOf(restrictionList[0].element).base;
						if (restrictionBase) {
							emit({
								subject: typeSubject,
								predicate: 'restrictionBase',
								object: canonicalTypeRef(restrictionBase),
							});
						}
					}

					collectDescendants(simpleTypeElement, ['xs:enumeration']).forEach((oneFound) => {
						const rawValue = attributesOf(oneFound.element).value;
						const trimmedValue = decodeXmlCharacterReferences(
							String(rawValue == null ? '' : rawValue),
						).trim();
						// EMPTY-after-trim values are deliberately kept as statements (header ruling).
						emit({
							subject: typeSubject,
							predicate: 'enumerationValue',
							object: trimmedValue,
						});
						const valueDocumentation = firstDocumentationOf(oneFound.element);
						if (valueDocumentation !== '') {
							emit({
								subject: `${typeSubject}/value/${trimmedValue}`,
								predicate: 'documentation',
								object: valueDocumentation,
								subjectRoot: typeSubject,
							});
						}
					});

					collectDescendants(simpleTypeElement, FACET_ELEMENT_NAMES).forEach((oneFound) => {
						const facetValue = attributesOf(oneFound.element).value;
						if (facetValue !== undefined) {
							emit({
								subject: typeSubject,
								predicate: `facet:${oneFound.elementName.slice(XS_PREFIX.length)}`,
								object: facetValue,
							});
						}
					});
					collectDescendants(simpleTypeElement, ['xs:union']).forEach((oneFound) => {
						const memberTypes = attributesOf(oneFound.element).memberTypes;
						if (memberTypes !== undefined) {
							emit({
								subject: typeSubject,
								predicate: 'unionMemberTypes',
								object: String(memberTypes).trim().split(/\s+/).map(canonicalTypeRef).join(' '),
							});
						}
					});
					collectDescendants(simpleTypeElement, ['xs:list']).forEach((oneFound) => {
						const itemType = attributesOf(oneFound.element).itemType;
						if (itemType !== undefined) {
							emit({
								subject: typeSubject,
								predicate: 'listItemType',
								object: canonicalTypeRef(itemType),
							});
						}
					});
				};

				// ---- named complexType ----
				const emitComplexTypeStatements = ({ complexTypeElement }) => {
					const complexTypeName = attributesOf(complexTypeElement).name;
					const typeSubject = `${SUBJECT_SCHEME}${fileLabel}#complexType/${complexTypeName}`;
					emit({ subject: fileSubject, predicate: 'declaresComplexType', object: complexTypeName });

					const typeDocumentation = firstDocumentationOf(complexTypeElement);
					if (typeDocumentation !== '') {
						emit({ subject: typeSubject, predicate: 'documentation', object: typeDocumentation });
					}

					// derivation: the first extension/restriction under complexContent/simpleContent.
					['xs:complexContent', 'xs:simpleContent'].forEach((oneContentName) => {
						(complexTypeElement[oneContentName] || []).forEach((oneContent) => {
							['xs:extension', 'xs:restriction'].forEach((oneDerivationName) => {
								(oneContent[oneDerivationName] || []).forEach((oneDerivation) => {
									const derivationBase = attributesOf(oneDerivation).base;
									if (derivationBase) {
										emit({
											subject: typeSubject,
											predicate: 'derivesFrom',
											object: canonicalTypeRef(derivationBase),
										});
										emit({
											subject: typeSubject,
											predicate: 'derivationMethod',
											object: oneDerivationName.slice(XS_PREFIX.length),
										});
									}
								});
							});
						});
					});

					emitBlockMemberStatements({ blockElement: complexTypeElement, ownerSubject: typeSubject });
				};

				// ---- named group / attributeGroup ----
				const emitGroupStatements = ({ groupElement, groupKindLabel }) => {
					const groupName = attributesOf(groupElement).name;
					const groupSubject = `${SUBJECT_SCHEME}${fileLabel}#${groupKindLabel}/${groupName}`;
					emit({
						subject: fileSubject,
						predicate: groupKindLabel === 'group' ? 'declaresGroup' : 'declaresAttributeGroup',
						object: groupName,
					});
					const groupDocumentation = firstDocumentationOf(groupElement);
					if (groupDocumentation !== '') {
						emit({ subject: groupSubject, predicate: 'documentation', object: groupDocumentation });
					}
					emitBlockMemberStatements({ blockElement: groupElement, ownerSubject: groupSubject });
				};

				// ---- top-level (root/message) element ----
				const emitRootElementStatements = ({ rootElement }) => {
					const rootElementName = attributesOf(rootElement).name;
					if (!rootElementName) {
						countUnmodeled('xs:element[top-level,nameless]');
						return;
					}
					const rootSubject = `${SUBJECT_SCHEME}${fileLabel}#rootElement/${rootElementName}`;
					emit({ subject: fileSubject, predicate: 'declaresRootElement', object: rootElementName });

					const rootDocumentation = firstDocumentationOf(rootElement);
					if (rootDocumentation !== '') {
						emit({ subject: rootSubject, predicate: 'documentation', object: rootDocumentation });
					}

					const rootTypeRef = attributesOf(rootElement).type;
					if (rootTypeRef) {
						emit({
							subject: rootSubject,
							predicate: 'contentTypeRef',
							object: canonicalTypeRef(rootTypeRef),
						});
					}

					// inline complexType content: members land flat on the root element subject
					// (the compositor-transparency ruling; mirrors the forge parser's inlineElements).
					(rootElement['xs:complexType'] || []).forEach((oneInlineComplexType) => {
						emitBlockMemberStatements({
							blockElement: oneInlineComplexType,
							ownerSubject: rootSubject,
						});
					});
				};

				// ---- the schema-level walk ----
				const schemaAttributes = attributesOf(schemaElement);
				if (schemaAttributes.targetNamespace !== undefined) {
					emit({ subject: fileSubject, predicate: 'targetNamespace', object: schemaAttributes.targetNamespace });
				}
				if (schemaAttributes.version !== undefined) {
					emit({ subject: fileSubject, predicate: 'schemaVersionAttribute', object: schemaAttributes.version });
				}
				if (schemaAttributes.elementFormDefault !== undefined) {
					emit({ subject: fileSubject, predicate: 'elementFormDefault', object: schemaAttributes.elementFormDefault });
				}
				if (schemaAttributes.attributeFormDefault !== undefined) {
					emit({ subject: fileSubject, predicate: 'attributeFormDefault', object: schemaAttributes.attributeFormDefault });
				}

				const schemaLevelDocumentation = firstDocumentationOf(schemaElement);
				if (schemaLevelDocumentation !== '') {
					emit({ subject: fileSubject, predicate: 'documentation', object: schemaLevelDocumentation });
				}

				elementChildKeys(schemaElement).forEach((oneChildName) => {
					(schemaElement[oneChildName] || []).forEach((oneChild) => {
						const childElement = typeof oneChild === 'object' && oneChild !== null ? oneChild : {};
						if (oneChildName === 'xs:annotation') {
							return; // consumed above as file-level documentation
						}
						if (oneChildName === 'xs:import' || oneChildName === 'xs:include') {
							const importAttributes = attributesOf(childElement);
							if (importAttributes.schemaLocation !== undefined) {
								emit({
									subject: fileSubject,
									predicate: 'importsSchemaLocation',
									object: importAttributes.schemaLocation,
								});
							}
							if (importAttributes.namespace !== undefined) {
								emit({
									subject: fileSubject,
									predicate: 'importsNamespace',
									object: importAttributes.namespace,
								});
							}
							return;
						}
						if (oneChildName === 'xs:complexType' && attributesOf(childElement).name) {
							emitComplexTypeStatements({ complexTypeElement: childElement });
							return;
						}
						if (oneChildName === 'xs:simpleType' && attributesOf(childElement).name) {
							emitSimpleTypeStatements({ simpleTypeElement: childElement });
							return;
						}
						if (oneChildName === 'xs:group' && attributesOf(childElement).name) {
							emitGroupStatements({ groupElement: childElement, groupKindLabel: 'group' });
							return;
						}
						if (oneChildName === 'xs:attributeGroup' && attributesOf(childElement).name) {
							emitGroupStatements({ groupElement: childElement, groupKindLabel: 'attributeGroup' });
							return;
						}
						if (oneChildName === 'xs:element') {
							emitRootElementStatements({ rootElement: childElement });
							return;
						}
						countUnmodeled(oneChildName);
					});
				});

				callback('', {
					statements,
					collapsedStatementKeys,
					stats: {
						fileLabel,
						statementCount: statements.size,
						rawStatementCount,
						duplicateCount: rawStatementCount - statements.size,
						subjectCount: subjects.size,
						unmodeledConstructCounts,
						faults: [],
					},
				});
			});
		};

		// =====================================================================
		// canonicalizeXsdFileSet — [{ xsdText, fileLabel }] -> ONE merged statement Map.
		// File-scoped subjects make cross-file collisions impossible; the merge is a union.
		// =====================================================================

		const canonicalizeXsdFileSet = ({ fileList } = {}, callback) => {
			if (!Array.isArray(fileList) || fileList.length === 0) {
				callback(
					`${moduleName}.canonicalizeXsdFileSet: fileList is REQUIRED and must name at least ` +
						`one { xsdText, fileLabel } — an empty file set is a missing input, not an empty result.`,
				);
				return;
			}

			const mergedStatements = new Map();
			const mergedCollapsedStatementKeys = new Set();
			const mergedStats = {
				statementCount: 0,
				rawStatementCount: 0,
				duplicateCount: 0,
				subjectCount: 0,
				fileCount: fileList.length,
				perFile: [],
				unmodeledConstructCounts: {},
				faults: [],
			};

			let fileIndex = 0;
			const nextFile = () => {
				if (fileIndex >= fileList.length) {
					mergedStats.statementCount = mergedStatements.size;
					callback('', {
						statements: mergedStatements,
						collapsedStatementKeys: mergedCollapsedStatementKeys,
						stats: mergedStats,
					});
					return;
				}
				const oneFile = fileList[fileIndex];
				fileIndex += 1;
				canonicalizeXsdText(oneFile, (canonError, result) => {
					if (canonError) {
						callback(canonError);
						return;
					}
					result.statements.forEach((oneStatement, oneIdentity) => {
						if (!mergedStatements.has(oneIdentity)) {
							mergedStatements.set(oneIdentity, oneStatement);
						}
					});
					if (!(result.collapsedStatementKeys instanceof Set)) {
						callback(
							`${moduleName}.canonicalizeXsdFileSet: '${oneFile.fileLabel}' returned no ` +
								`collapsedStatementKeys Set. The whitespace sentinel is REQUIRED on every ` +
								`file — an absent key set would silently report zero whitespace-only ` +
								`differences, which is exactly the blind spot O-2 removed.`,
						);
						return;
					}
					result.collapsedStatementKeys.forEach((oneCollapsedKey) =>
						mergedCollapsedStatementKeys.add(oneCollapsedKey),
					);
					mergedStats.rawStatementCount += result.stats.rawStatementCount;
					mergedStats.duplicateCount += result.stats.duplicateCount;
					mergedStats.subjectCount += result.stats.subjectCount;
					mergedStats.perFile.push(result.stats);
					Object.keys(result.stats.unmodeledConstructCounts).forEach((oneName) => {
						mergedStats.unmodeledConstructCounts[oneName] =
							(mergedStats.unmodeledConstructCounts[oneName] || 0) +
							result.stats.unmodeledConstructCounts[oneName];
					});
					nextFile();
				});
			};
			nextFile();
		};

		// sourceLabelFor — the version-stripped file label, the SAME derivation the forge parser
		// uses (its sourceFile property is this label), so subjects agree across the two sides.
		const sourceLabelFor = (filename) =>
			String(filename).replace(/_v[\d.]+\.xsd$/, '').replace(/\.xsd$/, '');

		return {
			collapseWhitespaceRuns,
			canonicalizeXsdText,
			canonicalizeXsdFileSet,
			canonicalTypeRef,
			normalizeDocumentation,
			statementKey,
			sourceLabelFor,
			EXPLICITLY_OMITTED_PREDICATES,
			SUBJECT_SCHEME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
