'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// jsonLdRoundTripPair.js — H4 for a JSON-LD vocabulary forge (ctdlHub-101926 P1; Profile §8.5): a SOURCE-side
// canonicalizer and a GRAPH-side emitter held apart on purpose. The canonicalizer reads only the snapshot's JSON-LD;
// the emitter reads only the materialized graph. Both produce Map<statementKey, statement> over one vocabulary, and
// every value is part of its KEY, so the harness's key-only diff is also a value diff:
//   term|<id>|@type|<type>                        the entry's type (graph: from the node's role)
//   term|<id>|<labelPredicate>|<text>             rdfs:label / skos:prefLabel (graph: name)
//   term|<id>|description|<text>                  the FIRST of the description predicates in precedence order
//   term|<id>|<descriptionPredicate>|<text>       any later description text that differs from it — omitted
//   term|<id>|<usageNotePredicate>|<text>         vann:usageNote
//   term|<id>|<statusPredicate>|<value>           vs:term_status
//   term|<id>|<predicate>|<target>                every reference: a non-native target (graph: crossRefs or the
//                                                 seam list), a native target (graph: the structural edge)
//   foreign|<iri>|<statements JSON>               a foreign @graph entry, verbatim (graph: the root's foreign list)
//
// What the instrument knows of the graph model is THIS module's own table (STRUCTURAL_READING below): which native
// reference a graph edge expresses. It shares only the native allowlist and the language with the forge's profile.
// The kinds the forge does not carry (ruled 2026-10-20: oracle-faithful now, enrichment in phase P2b) are declared
// explicitlyOmitted, each statement naming its kind; a source reference to a native-prefix term the source never
// defines is kind `undefinedNativeTarget` (a defect in the source, listed by name in the verdict).

const fs = require('fs');
const path = require('path');

const ROLE_BY_TYPE = Object.freeze({ 'rdfs:Class': 'DmeClass', 'rdf:Property': 'DmeProperty', 'skos:ConceptScheme': 'DmeOptionSet', 'skos:Concept': 'DmeOptionValue' });
const TYPE_BY_ROLE = Object.freeze(Object.keys(ROLE_BY_TYPE).reduce((byRole, typeName) => ({ ...byRole, [ROLE_BY_TYPE[typeName]]: typeName }), {}));
const LABEL_PREDICATE_BY_ROLE = Object.freeze({ DmeClass: 'rdfs:label', DmeProperty: 'rdfs:label', DmeOptionSet: 'rdfs:label', DmeOptionValue: 'skos:prefLabel' });
const DESCRIPTION_PRECEDENCE_LIST = Object.freeze(['dct:description', 'rdfs:comment', 'skos:definition']);
const USAGE_NOTE_PREDICATE = 'vann:usageNote';
const STATUS_PREDICATE = 'vs:term_status';
const ROOT_ROLE = 'DmeStandardRoot';

// the graph edges that express a native reference, read in BOTH directions where the source states both
// (meta:domainFor is the inverse of schema:domainIncludes; meta:hasConcept of skos:inScheme)
const STRUCTURAL_READING = Object.freeze([
	Object.freeze({ edgeType: 'SUBCLASS_OF', statementList: Object.freeze([Object.freeze({ subject: 'from', predicateName: 'rdfs:subClassOf', object: 'to' })]) }),
	Object.freeze({ edgeType: 'HAS_PROPERTY', statementList: Object.freeze([
		Object.freeze({ subject: 'to', predicateName: 'schema:domainIncludes', object: 'from' }),
		Object.freeze({ subject: 'from', predicateName: 'meta:domainFor', object: 'to' }),
	]) }),
	Object.freeze({ edgeType: 'HAS_OPTION_SET', statementList: Object.freeze([Object.freeze({ subject: 'from', predicateName: 'meta:targetScheme', object: 'to' })]) }),
	Object.freeze({ edgeType: 'REFERENCES', statementList: Object.freeze([Object.freeze({ subject: 'from', predicateName: 'schema:rangeIncludes', object: 'to' })]) }),
	Object.freeze({ edgeType: 'HAS_VALUE', statementList: Object.freeze([
		Object.freeze({ subject: 'to', predicateName: 'skos:inScheme', object: 'from' }),
		Object.freeze({ subject: 'from', predicateName: 'meta:hasConcept', object: 'to' }),
	]) }),
]);

// the (declaring type, predicate, target type) triples a graph edge expresses; every other native reference is omitted
const STRUCTURAL_TRIPLE_SET = new Set([
	'rdfs:Class|rdfs:subClassOf|rdfs:Class',
	'rdf:Property|schema:domainIncludes|rdfs:Class',
	'rdfs:Class|meta:domainFor|rdf:Property',
	'rdf:Property|meta:targetScheme|skos:ConceptScheme',
	'rdf:Property|schema:rangeIncludes|rdfs:Class',
	'skos:Concept|skos:inScheme|skos:ConceptScheme',
	'skos:ConceptScheme|meta:hasConcept|skos:Concept',
]);

// the omitted kinds, with the property-scoping the July forge applied (the P2b work order retires them one by one)
const OMITTED_KIND = Object.freeze({
	SECONDARY_DESCRIPTION: 'secondaryDescription',
	USAGE_NOTE_OFF_PROPERTY: 'usageNoteOffProperty',
	SCHEME_STATUS: 'schemeStatus',
	CHANGE_HISTORY: 'changeHistory',
	NATIVE_REFERENCE: 'nativeReferenceNotModelled',
	UNDEFINED_NATIVE_TARGET: 'undefinedNativeTarget',
});
const OMITTED_KIND_PROPERTY_NAME = 'omittedKind';
const OMITTED_TEXT_PROPERTY_NAME = 'text';
const CHANGE_HISTORY_PREDICATE = 'meta:changeHistory';

const prefixOf = (iriText) => `${iriText}`.split(':')[0];
const omitted = (kind, extra) => ({ explicitlyOmitted: true, [OMITTED_KIND_PROPERTY_NAME]: kind, ...(extra || {}) });

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabularyProfile, ruleModulePath }) => {
		const { nativePrefixList, languageTag, sourceFileName } = vocabularyProfile;
		const isNativeIri = (iriText) => nativePrefixList.indexOf(prefixOf(iriText)) !== -1;

		// -----------------------------------------------------------------
		// canonicalizeSource — the snapshot's JSON-LD → statements (never the graph)
		// -----------------------------------------------------------------
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const sourceFilePath = fs.statSync(snapshotPath).isDirectory() ? path.join(snapshotPath, sourceFileName) : snapshotPath;
			let graphEntryList;
			try {
				graphEntryList = JSON.parse(fs.readFileSync(sourceFilePath, 'utf8'))['@graph'];
			} catch (parseError) {
				// localized parse boundary (house-sanctioned): the refusal, not the throw, is the flow
				callback(`${moduleName} REFUSED: '${sourceFilePath}' is not parseable JSON (${parseError.message})`);
				return;
			}
			const typeById = graphEntryList.reduce((byId, oneEntry) => ({ ...byId, [oneEntry['@id']]: oneEntry['@type'] }), {});
			const statements = new Map();
			const undefinedNativeTargetList = [];
			graphEntryList.forEach((oneEntry) => {
				const entryId = oneEntry['@id'];
				const entryType = oneEntry['@type'];
				if (!isNativeIri(entryId)) {
					const { '@id': iri, ...entryStatements } = oneEntry;
					statements.set(`foreign|${iri}|${JSON.stringify(entryStatements)}`, {});
					return;
				}
				const isProperty = entryType === 'rdf:Property';
				statements.set(`term|${entryId}|@type|${entryType}`, {});
				Object.keys(oneEntry).forEach((predicateName) => {
					const predicateValue = oneEntry[predicateName];
					if (predicateName === '@id' || predicateName === '@type' || DESCRIPTION_PRECEDENCE_LIST.indexOf(predicateName) !== -1) {
						return;
					}
					if (predicateName === CHANGE_HISTORY_PREDICATE) {
						statements.set(`term|${entryId}|${predicateName}|${predicateValue}`, omitted(OMITTED_KIND.CHANGE_HISTORY));
						return;
					}
					if (predicateName === STATUS_PREDICATE) {
						statements.set(`term|${entryId}|${predicateName}|${predicateValue}`, entryType === 'skos:ConceptScheme' ? omitted(OMITTED_KIND.SCHEME_STATUS) : {});
						return;
					}
					if (predicateName === USAGE_NOTE_PREDICATE) {
						const noteText = predicateValue[languageTag];
						statements.set(`term|${entryId}|${predicateName}|${noteText}`, isProperty ? {} : omitted(OMITTED_KIND.USAGE_NOTE_OFF_PROPERTY, { [OMITTED_TEXT_PROPERTY_NAME]: noteText }));
						return;
					}
					if (!Array.isArray(predicateValue)) {
						statements.set(`term|${entryId}|${predicateName}|${predicateValue[languageTag]}`, {});
						return;
					}
					predicateValue.forEach((targetIri) => {
						const statementKey = `term|${entryId}|${predicateName}|${targetIri}`;
						if (!isNativeIri(targetIri)) {
							statements.set(statementKey, {});
						} else if (typeById[targetIri] === undefined) {
							undefinedNativeTargetList.push(statementKey);
							statements.set(statementKey, omitted(OMITTED_KIND.UNDEFINED_NATIVE_TARGET));
						} else if (STRUCTURAL_TRIPLE_SET.has(`${entryType}|${predicateName}|${typeById[targetIri]}`)) {
							statements.set(statementKey, {});
						} else {
							statements.set(statementKey, omitted(OMITTED_KIND.NATIVE_REFERENCE));
						}
					});
				});
				// descriptions: the first in precedence is the node's description; a later one that differs is omitted
				const descriptionTextList = DESCRIPTION_PRECEDENCE_LIST.filter((predicateName) => oneEntry[predicateName] !== undefined)
					.map((predicateName) => ({ predicateName, descriptionText: oneEntry[predicateName][languageTag] }));
				descriptionTextList.forEach(({ predicateName, descriptionText }, descriptionIndex) => {
					if (descriptionIndex === 0) {
						statements.set(`term|${entryId}|description|${descriptionText}`, {});
					} else if (descriptionText !== descriptionTextList[0].descriptionText) {
						statements.set(`term|${entryId}|${predicateName}|${descriptionText}`, omitted(OMITTED_KIND.SECONDARY_DESCRIPTION, { [OMITTED_TEXT_PROPERTY_NAME]: descriptionText }));
					}
				});
			});
			callback('', { statements, stats: { graphEntryCount: graphEntryList.length, statementCount: statements.size, undefinedNativeTargetList } });
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
				const roleById = graph.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode.role }), {});
				let fault;
				graph.nodes.forEach((oneNode) => {
					const { stableId, role, properties } = oneNode;
					if (role === ROOT_ROLE && properties.foreignTermEntryList === undefined) {
						fault = `the root '${stableId}' carries no foreignTermEntryList (the forge always writes it, '[]' when the source has no foreign entry)`;
						return;
					}
					if (properties.crossRefs === undefined) {
						fault = `node '${stableId}' carries no crossRefs (the structural finalizer stamps it on every node)`;
						return;
					}
					if (role === ROOT_ROLE) {
						JSON.parse(properties.foreignTermEntryList).forEach((oneEntry) => statements.set(`foreign|${oneEntry.iri}|${JSON.stringify(oneEntry.statements)}`, {}));
						return;
					}
					if (TYPE_BY_ROLE[role] === undefined) {
						fault = `node '${stableId}' has role ${role}, which no JSON-LD type maps to`;
						return;
					}
					statements.set(`term|${stableId}|@type|${TYPE_BY_ROLE[role]}`, {});
					if (properties.name !== undefined) {
						statements.set(`term|${stableId}|${LABEL_PREDICATE_BY_ROLE[role]}|${properties.name}`, {});
					}
					if (properties.description !== undefined) {
						statements.set(`term|${stableId}|description|${properties.description}`, {});
					}
					if (properties.usageNote !== undefined) {
						statements.set(`term|${stableId}|${USAGE_NOTE_PREDICATE}|${properties.usageNote}`, {});
					}
					if (properties.status !== undefined) {
						statements.set(`term|${stableId}|${STATUS_PREDICATE}|vs:${properties.status}`, {});
					}
					JSON.parse(properties.crossRefs).forEach((oneCrossRef) => statements.set(`term|${stableId}|${oneCrossRef.locator}|${oneCrossRef.raw}`, {}));
					JSON.parse(properties.declaredCorrespondenceList || '[]').forEach((oneEntry) => statements.set(`term|${stableId}|${oneEntry.predicate}|${oneEntry.target}`, {}));
				});
				graph.edges.forEach((oneEdge) => {
					const reading = STRUCTURAL_READING.find((oneReading) => oneReading.edgeType === oneEdge.type);
					const touchesRoot = roleById[oneEdge.fromStableId] === ROOT_ROLE || roleById[oneEdge.toStableId] === ROOT_ROLE;
					if (touchesRoot) {
						return; // root scaffolding (HAS_CLASS, an orphan's HAS_OPTION_SET, a domainless property's HAS_PROPERTY) states nothing
					}
					if (reading === undefined) {
						fault = `edge ${oneEdge.type} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has no reading`;
						return;
					}
					const endpointByName = { from: oneEdge.fromStableId, to: oneEdge.toStableId };
					reading.statementList.forEach((oneStatement) => statements.set(`term|${endpointByName[oneStatement.subject]}|${oneStatement.predicateName}|${endpointByName[oneStatement.object]}`, {}));
				});
				if (fault !== undefined) {
					callback('', { fault });
					return;
				}
				callback('', { statements, stats: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, statementCount: statements.size } });
			});
		};

		const omissionDeclaration = Object.freeze({
			rule: ruleModulePath,
			kindPropertyName: OMITTED_KIND_PROPERTY_NAME,
			kindList: Object.freeze(Object.values(OMITTED_KIND)),
			textBearingKindList: Object.freeze([OMITTED_KIND.SECONDARY_DESCRIPTION, OMITTED_KIND.USAGE_NOTE_OFF_PROPERTY]),
			textPropertyName: OMITTED_TEXT_PROPERTY_NAME,
			caveatText:
				'Oracle-faithful port (ruling 2026-10-20): these kinds were never carried by the July forge and are retired one per commit in phase P2b. ' +
				'undefinedNativeTarget items are references to native-prefix terms the SOURCE never defines — a source defect, not a forge loss.',
		});

		const semanticValidationLimit =
			`SEMANTIC round trip of ${sourceFileName} over the statement domain THIS INSTRUMENT MODELS: every @graph entry's type, label, ` +
			'primary description (the first of dct:description, rdfs:comment, skos:definition), usage note, term status and every IRI it references; ' +
			'foreign entries (outside the native allowlist) verbatim as whole entries. Native references are read back from the graph edges that ' +
			'express them (subClassOf, domainIncludes and its inverse domainFor, targetScheme, rangeIncludes, inScheme and its inverse hasConcept); ' +
			'non-native references from crossRefs and the declared-correspondence list, by predicate. EXPLICITLY OMITTED and listed: secondary ' +
			'description texts, usage notes off properties, concept-scheme status, meta:changeHistory, native references no edge expresses (concept ' +
			'broader/narrower, topConcept links, native subPropertyOf, inverseOf, and the few typed outside the structural triples), and references ' +
			'to native terms the source never defines. NOT modelled: the @context, language tags other than ' + `${languageTag}` + ', ordering, ' +
			'derived values (path, depth, searchText, domainCount), and the root\'s provenance fields (checked by the framework).';

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration };
	};

module.exports = moduleFunction({ moduleName });
