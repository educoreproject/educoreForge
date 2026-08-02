'use strict';

// roundTripCanonical.js — RDF/XML -> a CANONICAL STATEMENT SET, the common measuring surface both
// halves of the CEDS round-trip are reduced to before anything is compared.
//
// WHY IT EXISTS. ⟪TQ RULING, 2026-08-02⟫ "the CEDS OWL source describes a graph. We want to
// represent it as a graph. We should be able to write a graph that we could extract and compile
// back into the OWL." Round-trip fidelity is the acceptance criterion for hub completeness, and a
// criterion nobody can measure is a wish. This module is the half of the instrument that decides
// WHAT COUNTS AS THE SAME STATEMENT.
//
// ⟪DESIGN RULING (design authority, 2026-08-02)⟫ THE CRITERION IS SEMANTIC ROUND-TRIP — triple-set
// equality — NOT byte-identical serialization. Whitespace, attribute order, element order and
// prefix choice MUST NOT count as differences; a missing or extra STATEMENT MUST. Everything in
// this module follows from that one sentence:
//
//   * PREFIXES ARE EXPANDED. Every element name is resolved through the document's own xmlns
//     declarations, so `dc:identifier` and `<x:identifier xmlns:x="http://purl.org/dc/elements/1.1/">`
//     are the same predicate and an unprefixed `<textFormat>` resolves through the DEFAULT xmlns.
//   * LITERAL WHITESPACE IS NORMALIZED (trim + internal runs collapsed to one space). Indentation
//     inside a description is a serializer's business, not a statement's.
//   * ORDER IS DISCARDED. The result is a SET keyed by (subject, predicate, objectKind, object,
//     datatype, lang). Duplicate statements collapse, and the collapse is COUNTED and REPORTED
//     rather than hidden — a set that silently ate 400 repeats would be lying by omission.
//   * THE ELEMENT NAME OF A NODE ELEMENT IS ITSELF A STATEMENT. `<rdfs:Class rdf:about="X">`
//     asserts (X, rdf:type, rdfs:Class); RDF/XML striping says so and the count would be wrong
//     without it. `rdf:Description` asserts nothing and is the one exception.
//
// NESTED STRUCTURE (the `editHistory rdf:parseType="Collection"` shape) is canonicalized by
// CONTENT, not by position: a nested element with no rdf:about of its own is given the structural
// subject `<parentSubject>#/rtStruct/<sha1 of its own canonical content>`. Two consequences, both
// deliberate: reordering two editHistoryEntry blocks is NOT a difference (order is not a
// statement), and two byte-identical entries under one parent collapse to one (they assert the
// same thing twice). This is NOT full RDF blank-node semantics — a Collection is not expanded into
// rdf:first/rdf:rest — because the instrument's job is to count LOST FACTS, and rdf:first/rdf:rest
// scaffolding would bury 1,920 real edit-history facts under 6,000 statements of list plumbing.
// The tradeoff is stated here rather than discovered later.
//
// SCOPE. This module READS. It never writes a file, never touches a graph, never calls a network.
// Pure and callback-shaped (R7): a malformed input is refused BY NAME through the callback.

const fs = require('fs');
const crypto = require('crypto');
const xml2js = require('xml2js');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// The one separator that mints a structural subject. Chosen so it cannot collide with a real CEDS
// URI (which carries no '#') and so a structural subject can always be traced back to the node
// element it hangs from — the report groups losses by ROOT subject, not by fragment.
const STRUCTURAL_SUBJECT_SEPARATOR = '#/rtStruct/';

const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDF_TYPE = `${RDF_NAMESPACE}type`;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// normalizeLiteral — the whitespace ruling, in one place. Trim, then collapse every
		// internal whitespace run to a single space. Applied identically to both sides, so an
		// indentation difference can never register as a lost statement.
		const normalizeLiteral = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();

		// -----
		// namespaceMapFrom — build prefix -> namespace URI from a root element's attributes.
		// The default namespace lands under the '' key. Only the ROOT's declarations are read:
		// this document declares everything there, and a nested redeclaration would be a silent
		// change of meaning, so it is REFUSED — see pushNestedNamespaceFaults above, which walks
		// every non-root element and raises a named fault rather than half-honouring the change.
		const namespaceMapFrom = (rootAttributes) => {
			const namespaceMap = {};
			Object.keys(rootAttributes || {}).forEach((oneAttribute) => {
				if (oneAttribute === 'xmlns') {
					namespaceMap[''] = rootAttributes[oneAttribute];
					return;
				}
				if (oneAttribute.startsWith('xmlns:')) {
					namespaceMap[oneAttribute.slice('xmlns:'.length)] = rootAttributes[oneAttribute];
				}
			});
			return namespaceMap;
		};

		// expandName — 'dc:identifier' -> 'http://purl.org/dc/elements/1.1/identifier'. An
		// UNDECLARED prefix is not guessed at: it is recorded as a fault and the raw name is used,
		// so a namespace problem shows up as a named fault instead of as thousands of phantom
		// losses.
		const makeNameExpander = ({ namespaceMap, faults }) => (elementName) => {
			const colonAt = elementName.indexOf(':');
			const prefix = colonAt === -1 ? '' : elementName.slice(0, colonAt);
			const localName = colonAt === -1 ? elementName : elementName.slice(colonAt + 1);
			const namespaceUri = namespaceMap[prefix];
			if (namespaceUri === undefined) {
				faults.push(
					`${moduleName}: element name '${elementName}' uses namespace prefix ` +
						`'${prefix}', which the document never declares. The raw name is used as the ` +
						`predicate rather than guessed at.`,
				);
				return elementName;
			}
			return `${namespaceUri}${localName}`;
		};

		// -----
		// childElementKeys — the property-element names of a parsed element. xml2js parks
		// attributes under '$' and text under '_'; everything else is a child element name.
		const childElementKeys = (element) =>
			Object.keys(element).filter((oneKey) => oneKey !== '$' && oneKey !== '_');

		// -----
		// pushNestedNamespaceFaults — the refusal the header promises, ACTUALLY PERFORMED.
		//
		// AUDIT A3 / GATE C-6. namespaceMapFrom reads the ROOT element's declarations only, and the
		// header above says a nested redeclaration "is REFUSED below rather than half-honoured." It
		// was not. Nothing looked, so a nested `xmlns:ceds="...somethingElse"` would have resolved
		// silently through the root map and every affected statement would have been keyed under the
		// WRONG predicate URI — a change of meaning that reads as a clean match. Zero occurrences in
		// today's source; this exists so the comment stops being a lie the next reader believes.
		//
		// A fault is fatal (the diff refuses to report while faults exist), which is the correct
		// severity: half-honouring a namespace is worse than not parsing at all.
		const pushNestedNamespaceFaults = ({ element, faults, elementPath }) => {
			if (!element || typeof element === 'string') {
				return;
			}
			const attributes = element['$'] || {};
			Object.keys(attributes).forEach((oneAttribute) => {
				if (oneAttribute === 'xmlns' || oneAttribute.indexOf('xmlns:') === 0) {
					faults.push(
						`REFUSED: nested namespace redeclaration '${oneAttribute}="${attributes[oneAttribute]}"' ` +
							`at ${elementPath}. Only the root element's declarations are read, so honouring ` +
							`this would silently key statements under the wrong predicate URI.`,
					);
				}
			});
			childElementKeys(element).forEach((oneKey) => {
				(element[oneKey] || []).forEach((oneValue) => {
					pushNestedNamespaceFaults({
						element: oneValue,
						faults,
						elementPath: `${elementPath}/${oneKey}`,
					});
				});
			});
		};

		// -----
		// canonicalContentOf — the CONTENT identity of a nested element, order-insensitive and
		// whitespace-normalized. Recursive: a nested element's own nested children fold in the same
		// way. This is what a structural subject is hashed from.
		const canonicalContentOf = ({ element, expandName }) => {
			if (typeof element === 'string') {
				return `L${normalizeLiteral(element)}`;
			}
			const attributes = element['$'] || {};
			const parts = [];
			childElementKeys(element).forEach((oneKey) => {
				const predicate = expandName(oneKey);
				(element[oneKey] || []).forEach((oneValue) => {
					parts.push(`${predicate}${canonicalContentOf({ element: oneValue, expandName })}`);
				});
			});
			if (attributes['rdf:resource']) {
				parts.push(`resource${attributes['rdf:resource']}`);
			}
			if (element['_'] !== undefined) {
				parts.push(`text${normalizeLiteral(element['_'])}`);
			}
			if (attributes['rdf:datatype']) {
				parts.push(`datatype${attributes['rdf:datatype']}`);
			}
			if (attributes['xml:lang']) {
				parts.push(`lang${attributes['xml:lang']}`);
			}
			return parts.sort().join('');
		};

		const structuralSubjectFor = ({ parentSubject, element, expandName }) =>
			`${parentSubject}${STRUCTURAL_SUBJECT_SEPARATOR}${crypto
				.createHash('sha1')
				.update(canonicalContentOf({ element, expandName }))
				.digest('hex')
				.slice(0, 16)}`;

		// -----
		// rootSubjectOf — a structural subject reports its losses under the node element it hangs
		// from. Without this, 1,920 changeDescription losses would be attributed to 1,920 subjects
		// nobody can look up in the source.
		const rootSubjectOf = (subject) => String(subject).split(STRUCTURAL_SUBJECT_SEPARATOR)[0];

		// -----
		// statementKey — the identity of a statement. Every field that can change meaning is in the
		// key; nothing that cannot is.
		const statementKey = (statement) =>
			[
				statement.subject,
				statement.predicate,
				statement.objectKind,
				statement.object,
				statement.datatype || '',
				statement.lang || '',
			].join('');

		// =====================================================================
		// THE WALK — parsed RDF/XML -> statements
		// =====================================================================

		const walkPropertyElements = ({ subject, element, expandName, emit }) => {
			childElementKeys(element).forEach((oneKey) => {
				const predicate = expandName(oneKey);
				(element[oneKey] || []).forEach((oneValue) => {
					// `<a>text</a>` with no attributes parses as a bare string.
					if (typeof oneValue === 'string') {
						emit({ subject, predicate, objectKind: 'literal', object: normalizeLiteral(oneValue) });
						return;
					}
					const attributes = oneValue['$'] || {};
					if (attributes['rdf:resource']) {
						emit({
							subject,
							predicate,
							objectKind: 'resource',
							object: attributes['rdf:resource'],
						});
						return;
					}
					const nestedKeys = childElementKeys(oneValue);
					if (nestedKeys.length) {
						// A nested node: its own rdf:about when it names itself, otherwise a
						// content-derived structural subject (see the header).
						const nestedSubject =
							attributes['rdf:about'] ||
							structuralSubjectFor({ parentSubject: subject, element: oneValue, expandName });
						emit({ subject, predicate, objectKind: 'resource', object: nestedSubject });
						walkPropertyElements({ subject: nestedSubject, element: oneValue, expandName, emit });
						return;
					}
					emit({
						subject,
						predicate,
						objectKind: 'literal',
						object: normalizeLiteral(oneValue['_']),
						datatype: attributes['rdf:datatype'],
						lang: attributes['xml:lang'],
					});
				});
			});
		};

		// =====================================================================
		// canonicalizeRdfText — the public entry. callback('', { statements, stats })
		//   statements   Map of statementKey -> statement (the SET)
		//   stats        { statementCount, duplicateCount, subjectCount, nodeElementCount,
		//                  topLevelWithoutSubject, faults }
		// =====================================================================

		const canonicalizeRdfText = ({ rdfText, sourceLabel } = {}, callback) => {
			if (typeof rdfText !== 'string' || rdfText.trim() === '') {
				callback(
					`${moduleName}.canonicalizeRdfText: rdfText is REQUIRED and has no default — a ` +
						`canonicalization of nothing is not an empty document, it is a missing input.`,
				);
				return;
			}

			xml2js.parseString(rdfText, (parseError, parsed) => {
				if (parseError) {
					callback(
						`${moduleName}.canonicalizeRdfText: XML parse of '${sourceLabel || 'rdfText'}' ` +
							`failed: ${parseError.message}`,
					);
					return;
				}
				const root = parsed && parsed['rdf:RDF'];
				if (!root) {
					callback(
						`${moduleName}.canonicalizeRdfText: '${sourceLabel || 'rdfText'}' has no rdf:RDF ` +
							`root element — it is not the RDF/XML document this instrument measures.`,
					);
					return;
				}

				const faults = [];
				const namespaceMap = namespaceMapFrom(root['$']);
				if (namespaceMap[''] === undefined && namespaceMap.rdf === undefined) {
					callback(
						`${moduleName}.canonicalizeRdfText: '${sourceLabel || 'rdfText'}' declares neither a ` +
							`default namespace nor an 'rdf' prefix on its rdf:RDF element. Every predicate in ` +
							`the document would be unresolvable; that is refused rather than measured.`,
					);
					return;
				}
				const expandName = makeNameExpander({ namespaceMap, faults });

				const statements = new Map();
				let rawStatementCount = 0;
				const subjects = new Set();
				const emit = (statement) => {
					rawStatementCount += 1;
					subjects.add(statement.subject);
					const key = statementKey(statement);
					if (!statements.has(key)) {
						statements.set(key, {
							...statement,
							datatype: statement.datatype || '',
							lang: statement.lang || '',
							subjectRoot: rootSubjectOf(statement.subject),
						});
					}
				};

				let nodeElementCount = 0;
				let topLevelWithoutSubject = 0;

				childElementKeys(root).forEach((oneElementName) => {
					const typeUri = expandName(oneElementName);
					(root[oneElementName] || []).forEach((oneElement) => {
						const element = typeof oneElement === 'string' ? {} : oneElement;
						const attributes = element['$'] || {};
						const subject = attributes['rdf:about'];
						if (!subject) {
							// A top-level element with no rdf:about names no subject. It is COUNTED and
							// reported rather than silently skipped: an instrument that quietly drops
							// input cannot be trusted about what it says it measured.
							topLevelWithoutSubject += 1;
							return;
						}
						nodeElementCount += 1;
						// AUDIT A3 / GATE C-6 — perform the refusal the header promises.
						pushNestedNamespaceFaults({
							element,
							faults,
							elementPath: `${oneElementName}[${subject}]`,
						});
						if (typeUri !== `${RDF_NAMESPACE}Description`) {
							emit({ subject, predicate: RDF_TYPE, objectKind: 'resource', object: typeUri });
						}
						walkPropertyElements({ subject, element, expandName, emit });
					});
				});

				callback('', {
					statements,
					stats: {
						sourceLabel: sourceLabel || '',
						statementCount: statements.size,
						rawStatementCount,
						duplicateCount: rawStatementCount - statements.size,
						subjectCount: subjects.size,
						nodeElementCount,
						topLevelWithoutSubject,
						faults,
					},
				});
			});
		};

		const canonicalizeRdfFile = ({ filePath } = {}, callback) => {
			if (typeof filePath !== 'string' || filePath.trim() === '') {
				callback(
					`${moduleName}.canonicalizeRdfFile: filePath is REQUIRED and has no default.`,
				);
				return;
			}
			if (!fs.existsSync(filePath)) {
				callback(`${moduleName}.canonicalizeRdfFile: '${filePath}' does not exist.`);
				return;
			}
			fs.readFile(filePath, 'utf8', (readError, rdfText) => {
				if (readError) {
					callback(
						`${moduleName}.canonicalizeRdfFile: reading '${filePath}' failed: ${readError.message}`,
					);
					return;
				}
				canonicalizeRdfText({ rdfText, sourceLabel: filePath }, callback);
			});
		};

		return {
			canonicalizeRdfText,
			canonicalizeRdfFile,
			statementKey,
			normalizeLiteral,
			rootSubjectOf,
			STRUCTURAL_SUBJECT_SEPARATOR,
			RDF_NAMESPACE,
			RDF_TYPE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
