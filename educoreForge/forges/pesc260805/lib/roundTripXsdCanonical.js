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
// attribute order and prefix CHOICE are not statements; a missing or extra STATEMENT is. ELEMENT
// ORDER WAS ON THAT LIST UNTIL PHASE 6.5 AND IS NOT ANY MORE — the particle ordinal makes it a
// statement. The PESC-specific canonicalization rules, each deliberate and each visible here:
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
//   * THE COMPOSITOR IS MEASURED AS OF PHASE 6.5, AND THE PREVIOUS TEXT HERE IS RETRACTED. This
//     header used to say the compositor and member order were not measured, and Phase 6 sharpened
//     that to "compositor ABSENCE is uncounted, and the emitted corpus carries ZERO compositors".
//     Both were true when written and are now false. FIELD statements are still flattened onto the
//     owning block (mirroring the forge parser's flat field extraction) — that is unchanged — but
//     the compositor tree is ADDITIONALLY emitted as its own statements: declaresContentModel,
//     compositorKind, compositorMinOccurs/MaxOccurs, and particleAt:N carrying the ordinal. The
//     ordinal is what makes ELEMENT ORDER measurable, which Phase 6 had declared undetectable
//     because no statement subject carried one.
//   * PREFIX BINDINGS ARE MEASURED AS OF PHASE 6.5 — declaresNamespacePrefix / boundNamespace, per
//     xmlns declaration. This does NOT make prefix CHOICE significant: type references still
//     canonicalize at local-name precision below, so 'core:NameType' and 'NameType' remain the same
//     reference. What is now visible is whether a document DECLARES the bindings it uses, which is
//     the difference between a schema and a document that resembles one.
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

// PHASE 6.5 — THE PARSE OPTIONS, AND WHY THEY CHANGED.
//
// With xml2js defaults, children are grouped BY ELEMENT NAME, so a sequence holding
// [element, element, choice, element] parses to {'xs:element':[…3…], 'xs:choice':[…1…]} and the
// POSITION of the choice among the elements is destroyed at parse time. An ordered particle list
// cannot be recovered from that structure at all — which is part of why compositor order was
// declared undetectable rather than merely unmeasured.
//
// explicitChildren + preserveChildrenOrder add a '$$' array holding the children in document order,
// each stamped with '#name', WITHOUT disturbing the name-keyed access every existing walk uses
// (verified empirically before adopting: identical name-keyed contents, plus the ordered view).
// The cost is that '$$' and '#name' must be excluded from elementChildKeys or every walk
// double-counts; see the note there.
const PARSE_OPTIONS = { explicitChildren: true, preserveChildrenOrder: true };

// The ordered-children key and per-child name key those options introduce.
const ORDERED_CHILD_LIST_PROPERTY_NAME = '$$';
const ORDERED_CHILD_ELEMENT_NAME_PROPERTY = '#name';

// The particle containers and the derivation route to them. Registries, so a construct is added by
// a row rather than by another branch in a walk that already forgot one.
const COMPOSITOR_ELEMENT_NAME_LIST = ['xs:sequence', 'xs:choice', 'xs:all'];
const DERIVATION_WRAPPER_ELEMENT_NAME_LIST = ['xs:complexContent', 'xs:simpleContent'];
const DERIVATION_ELEMENT_NAME_LIST = ['xs:extension', 'xs:restriction'];

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
		//
		// '$$' AND '#name' ARE EXCLUDED AT PHASE 6.5 AND THE EXCLUSION IS LOAD-BEARING. The parse
		// now runs with explicitChildren + preserveChildrenOrder so the ORDERED particle list is
		// recoverable (see PARSE_OPTIONS). Those options add a '$$' array of the children in
		// document order and a '#name' string to each child. The '$$' entries are DISTINCT OBJECTS
		// from the ones in the name-keyed arrays — verified, not assumed — so without this exclusion
		// every walk in this file would traverse each subtree TWICE and silently double the entire
		// corpus's statement count. It would not error; it would simply report a different number.
		const NON_ELEMENT_CHILD_PROPERTY_NAME_LIST = ['$', '_', '$$', '#name'];
		const elementChildKeys = (element) =>
			element && typeof element === 'object'
				? Object.keys(element).filter(
						(oneName) => !NON_ELEMENT_CHILD_PROPERTY_NAME_LIST.includes(oneName),
					)
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

			xml2js.parseString(xsdText, PARSE_OPTIONS, (parseError, parsed) => {
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

				// =============================================================
				// THE CONTENT MODEL AS STATEMENTS — PHASE 6.5 (deliverable 3)
				//
				// WHY THIS EXISTS. Until now no compositor was a statement on EITHER side, so the
				// emitted corpus carrying ZERO xs:sequence was invisible to this instrument and read
				// as fidelity. That is the mutual blind spot in its most load-bearing form: without a
				// compositor the emitted document is not a schema, and the comparison said 99.79%.
				//
				// WHY THIS IS NOT A THEOREM WEARING AN ASSERTION'S CLOTHES. The obvious and WRONG
				// shape would be to model the expected compositor by reading the graph's
				// `contentModelShape` — the same property the emitter reads — which would hold two
				// derivations of ONE input against each other and could only be reddened by mutating
				// code. This module never touches the graph. BOTH of its inputs are BYTES: the
				// committed source documents and the documents the emitter wrote. The graph sits
				// upstream of the emitted side ALONE, so corrupting a graph row moves one side and
				// not the other, and a DATA mutation can genuinely make them disagree.
				//
				// GRANULARITY IS PER-POSITION, DELIBERATELY. One opaque statement per content model
				// would make any difference a single lost/invented pair and say nothing about where.
				// A statement per ordinal makes a sibling swap show up as two specific positions.
				// That is also what makes element ORDER measurable here for the first time.
				// =============================================================

				// orderedParticleChildList — the children of a compositor IN DOCUMENT ORDER.
				//
				// REFUSES RATHER THAN RETURNING A PLAUSIBLE ZERO. xml2js omits the ordered-children
				// key entirely for a childless element, so its absence legitimately means "no
				// particles". But if the element HAS element children by the name-keyed view and the
				// ordered key is missing, the parse options did not take effect and every content
				// model in the corpus would silently measure as empty — a confident zero of exactly
				// the kind this campaign has produced twice from misspelled property reads.
				const orderedParticleChildList = (compositorElement, contextLabel) => {
					const hasOrderedChildList = Object.prototype.hasOwnProperty.call(
						compositorElement,
						ORDERED_CHILD_LIST_PROPERTY_NAME,
					);
					if (hasOrderedChildList) {
						return compositorElement[ORDERED_CHILD_LIST_PROPERTY_NAME];
					}
					if (elementChildKeys(compositorElement).length) {
						throw new Error(
							`${moduleName}: '${contextLabel}' has element children but no ` +
								`'${ORDERED_CHILD_LIST_PROPERTY_NAME}' ordered-children key. The parse options that ` +
								`produce it (${JSON.stringify(PARSE_OPTIONS)}) are not in effect, so particle ` +
								`ORDER cannot be read. Refused BY NAME rather than measured as an empty ` +
								`content model, which would report as agreement on both sides.`,
						);
					}
					return [];
				};

				// contentModelHostOf — the element that actually CARRIES the compositor. For a plain
				// complexType that is the type itself; for a derived one the compositor lives inside
				// xs:complexContent/xs:simpleContent -> xs:extension/xs:restriction. Both routes are
				// walked because the emitted corpus now uses the same two routes the source does.
				const contentModelHostOf = (blockElement) => {
					const carriesCompositor = (oneElement) =>
						COMPOSITOR_ELEMENT_NAME_LIST.some(
							(oneCompositorName) => (oneElement[oneCompositorName] || []).length > 0,
						);
					if (carriesCompositor(blockElement)) {
						return blockElement;
					}
					for (const oneWrapperName of DERIVATION_WRAPPER_ELEMENT_NAME_LIST) {
						for (const oneWrapper of blockElement[oneWrapperName] || []) {
							for (const oneDerivationName of DERIVATION_ELEMENT_NAME_LIST) {
								for (const oneDerivation of oneWrapper[oneDerivationName] || []) {
									if (carriesCompositor(oneDerivation)) {
										return oneDerivation;
									}
								}
							}
						}
					}
					return null;
				};

				// particleDescriptorOf — the object side of a particleAt statement.
				//
				// A REGISTRY RATHER THAN AN IF-CHAIN, corrected in self-audit: the first draft
				// dispatched on the element name through a run of ifs, which is a switch wearing a
				// different hat and adds a construct by adding a branch instead of a row.
				//
				// FORMAL INTERFACE — ParticleDescriptorBuilder (this is a polymorphic seam):
				//   @typedef {function} ParticleDescriptorBuilder
				//   @param   {object} particleAttributes  the xml2js '$' attribute map
				//   @param   {string} particleElementName the xs: element name, for kinds that
				//                                         encode it in the descriptor
				//   @returns {string} the statement OBJECT for this particle. Never null and never
				//                     empty: a registered kind that cannot describe itself would put
				//                     an unreadable statement on both sides, where it would compare
				//                     equal and read as agreement.
				//
				// Element and group references run through canonicalTypeRef so a prefix CHOICE is not
				// a difference, matching every other reference statement in this file.
				const PARTICLE_DESCRIPTOR_BUILDER_BY_ELEMENT_NAME = COMPOSITOR_ELEMENT_NAME_LIST.reduce(
					(oneRegistry, oneCompositorName) => ({
						...oneRegistry,
						[oneCompositorName]: (unusedAttributes, particleElementName) =>
							`compositor:${particleElementName.replace(XS_PREFIX, '')}`,
					}),
					{
						'xs:element': (particleAttributes) =>
							particleAttributes.name
								? `element:${particleAttributes.name}`
								: `elementRef:${canonicalTypeRef(particleAttributes.ref)}`,
						'xs:group': (particleAttributes) => `group:${canonicalTypeRef(particleAttributes.ref)}`,
						// processContents defaults to 'strict' in the XSD grammar itself; that is
						// grammar knowledge applied to BOTH sides, the same standing as the occurrence
						// normalization above and as the existing allowsAnyElement statement.
						'xs:any': (particleAttributes) =>
							`any:${particleAttributes.processContents || 'strict'}`,
					},
				);

				const particleDescriptorOf = (particleElementName, particleElement) => {
					const buildParticleDescriptor =
						PARTICLE_DESCRIPTOR_BUILDER_BY_ELEMENT_NAME[particleElementName];
					if (!buildParticleDescriptor) {
						return null; // caller records it by name in unmodeledConstructCounts
					}
					return buildParticleDescriptor(attributesOf(particleElement), particleElementName);
				};

				// emitCompositorStatements — one compositor node -> its statements, RECURSING into
				// nested compositors AND into an element particle's own inline complexType.
				//
				// IT RECURSES RATHER THAN ENUMERATING PARENTS. The review that chartered this phase
				// was written about a traversal that handled global types, then added global
				// elements, and still could not see inside a local element's anonymous type — 274
				// locations returning a confident zero. Adding one more parent is the move that made
				// that gap, so this walk follows the structure wherever it goes.
				const emitCompositorStatements = ({
					compositorElementName,
					compositorElement,
					ownerSubject,
					contentModelPath,
				}) => {
					const compositorSubject = `${ownerSubject}#contentModel${contentModelPath}`;
					emit({
						subject: ownerSubject,
						predicate: 'declaresContentModel',
						object: contentModelPath === '' ? '(root)' : contentModelPath,
						subjectRoot: ownerSubject,
					});
					emit({
						subject: compositorSubject,
						predicate: 'compositorKind',
						object: compositorElementName.replace(XS_PREFIX, ''),
						subjectRoot: ownerSubject,
					});
					const compositorAttributes = attributesOf(compositorElement);
					// occurrence normalized to XSD-effective values, the same ruling the field
					// statements above already apply.
					emit({
						subject: compositorSubject,
						predicate: 'compositorMinOccurs',
						object: compositorAttributes.minOccurs || '1',
						subjectRoot: ownerSubject,
					});
					emit({
						subject: compositorSubject,
						predicate: 'compositorMaxOccurs',
						object: compositorAttributes.maxOccurs || '1',
						subjectRoot: ownerSubject,
					});

					let particleOrdinal = 0;
					orderedParticleChildList(compositorElement, compositorSubject).forEach(
						(oneOrderedChild) => {
							const particleElementName = oneOrderedChild[ORDERED_CHILD_ELEMENT_NAME_PROPERTY];
							if (particleElementName === 'xs:annotation') {
								return; // documentation, not a particle
							}
							const particleDescriptor = particleDescriptorOf(
								particleElementName,
								oneOrderedChild,
							);
							if (particleDescriptor === null) {
								countUnmodeled(`${particleElementName}[particle]`);
								return;
							}
							const thisParticlePath = `${contentModelPath}/p${particleOrdinal}`;
							emit({
								subject: compositorSubject,
								predicate: `particleAt/${particleOrdinal}`,
								object: particleDescriptor,
								subjectRoot: ownerSubject,
							});
							particleOrdinal += 1;

							if (COMPOSITOR_ELEMENT_NAME_LIST.includes(particleElementName)) {
								emitCompositorStatements({
									compositorElementName: particleElementName,
									compositorElement: oneOrderedChild,
									ownerSubject,
									contentModelPath: thisParticlePath,
								});
								return;
							}
							if (particleElementName === 'xs:element') {
								(oneOrderedChild['xs:complexType'] || []).forEach((oneInlineComplexType) => {
									emitContentModelStatements({
										blockElement: oneInlineComplexType,
										ownerSubject,
										contentModelPath: thisParticlePath,
									});
								});
							}
						},
					);
				};

				// emitContentModelStatements — a block's content model, if it has one.
				function emitContentModelStatements({
					blockElement,
					ownerSubject,
					contentModelPath = '',
				}) {
					const hostElement = contentModelHostOf(blockElement);
					if (hostElement === null) {
						return;
					}
					const orderedHostChildList = orderedParticleChildList(hostElement, ownerSubject);
					let compositorOrdinal = 0;
					orderedHostChildList.forEach((oneHostChild) => {
						const hostChildName = oneHostChild[ORDERED_CHILD_ELEMENT_NAME_PROPERTY];
						if (!COMPOSITOR_ELEMENT_NAME_LIST.includes(hostChildName)) {
							return;
						}
						// XSD permits ONE particle child, but the path stays ordinal-qualified so a
						// corpus that carried two would be measured rather than silently merged.
						emitCompositorStatements({
							compositorElementName: hostChildName,
							compositorElement: oneHostChild,
							ownerSubject,
							contentModelPath:
								compositorOrdinal === 0
									? contentModelPath
									: `${contentModelPath}/c${compositorOrdinal}`,
						});
						compositorOrdinal += 1;
					});
				}

				// ---- shared block content: fields, group refs, wildcards ----
				const emitBlockMemberStatements = ({ blockElement, ownerSubject }) => {
					emitContentModelStatements({ blockElement, ownerSubject });
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

				// ---- PHASE 6.5: the namespace prefix bindings, on BOTH sides ----
				//
				// The emitted corpus previously declared xmlns:xs and nothing else, so every
				// reference written through a corpus prefix pointed at a namespace the document
				// never bound — the 63rd of Phase 6's 63 refusals. That was invisible here because
				// a binding was not a statement on either side.
				//
				// This does NOT make prefix CHOICE significant: type references still canonicalize
				// at local-name precision through canonicalTypeRef, so 'core:NameType' and
				// 'NameType' remain the same reference. What becomes visible is whether the
				// document DECLARES the bindings it uses, which is the difference between a schema
				// and a document that resembles one.
				Object.keys(schemaAttributes)
					.filter(
						(oneAttributeName) =>
							oneAttributeName === 'xmlns' || oneAttributeName.startsWith('xmlns:'),
					)
					.forEach((oneAttributeName) => {
						const prefixLabel =
							oneAttributeName === 'xmlns'
								? '(default)'
								: oneAttributeName.substring('xmlns:'.length);
						emit({
							subject: fileSubject,
							predicate: 'declaresNamespacePrefix',
							object: prefixLabel,
						});
						emit({
							subject: `${fileSubject}#namespacePrefix/${prefixLabel}`,
							predicate: 'boundNamespace',
							object: schemaAttributes[oneAttributeName],
							subjectRoot: fileSubject,
						});
					});

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
