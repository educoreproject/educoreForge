'use strict';

// roundTripCompiler.js — THE COMPILER. Reads a MATERIALIZED CEDS graph and writes RDF/XML back out
// in the CEDS-Ontology.rdf shape, so the emission can be diffed against the source it came from.
//
// WHY IT READS THE GRAPH AND NOT THE FORGE'S OUTPUT. ⟪TQ RULING, 2026-08-02⟫ the acceptance
// criterion is that we "should be able to write a graph that we could extract and compile back into
// the OWL." Compiling from the forge's in-memory result would prove only that the forge remembers
// what it just read. Compiling from the GRAPH proves what the GRAPH ITSELF can support — which is
// the question, and the only one whose answer changes when the hub is enriched.
//
// WHAT IT IS NOT. This module does not fix, enrich, or improve anything. It emits exactly what the
// graph carries and no more. A statement the graph does not hold is NOT invented to flatter the
// diff; it shows up in the report as LOST, which is the deliverable.
//
// WHAT IT READS, AND WHAT IT DELIBERATELY DOES NOT. ⟪LAYER RULING, 2026-08-02⟫ the materialized
// graph carries TWO layers. LAYER 1 is CEDS faithfully represented — roles DmeStandardRoot,
// DmeClass, DmeProperty, DmeOptionSet, DmeOptionValue and the edges SUBCLASS_OF, HAS_OPTION_SET,
// REFERENCES, HAS_VALUE. LAYER 2 is OUR matching index — HubReference / HubDefinition nodes,
// addressSignature, embeddings, and the HAS_CEDS_DOMAIN / HAS_CEDS_PROPERTY / HAS_CEDS_RANGE /
// IN_HUB edges. CEDS contains no such thing; we invented Layer 2 for matching and it is regenerable
// from Layer 1. THIS COMPILER READS LAYER 1 ONLY. Every query names its roles explicitly (see
// edgeQueries below) so the exclusion is a visible decision rather than an accident of which edge
// types happen to exist. Every query is also scoped `_source: 'CEDS'` — the graph this runs against
// holds seventeen other standards.
//
// ---------------------------------------------------------------------------------------------
// THE ENRICHMENT CONTRACT (read this before adding a field to the CEDS forge)
// ---------------------------------------------------------------------------------------------
// The serializer knows the WHOLE CEDS source vocabulary — dc:creator, skos:prefLabel,
// skos:definition, rdfs:comment, owl:deprecated, minInclusive/maxInclusive, minLength, minCount,
// maxCount, decimalPlaces, issueLink and the nested editHistory block — even though the graph
// today carries almost none of them. That is deliberate and load-bearing in two ways:
//
//   1. THE INSTRUMENT MUST BE ABLE TO REPORT SUCCESS. A diff that can never come back clean is not
//      enforcement, it is decoration. The hermetic fixture in test/test-cedsRoundTrip.js exercises
//      the full vocabulary and round-trips at ZERO loss and ZERO invention; that test is the proof
//      that a clean reading is reachable at all.
//   2. IT TELLS THE ENRICHMENT WORK EXACTLY WHERE TO PUT THINGS. Whoever later teaches the CEDS
//      forge to carry dc:creator only has to land it on the node as the property named in
//      GRAPH_PROPERTY_BY_FIELD below, and the round-trip number moves with no change here.
//
// A field absent from a node is simply not emitted. Empty strings and empty arrays count as absent
// (the CEDS forge stamps `notation: ''` for "no notation", and an empty element is not a statement).
//
// ---------------------------------------------------------------------------------------------
// THE TWO SHAPE CONSTANTS THE SERIALIZER SUPPLIES (and why that is not invention)
// ---------------------------------------------------------------------------------------------
// A serializer is allowed to know its own output grammar; it is not allowed to know data.
//   * dc:identifier is written with rdf:datatype="...XMLSchema#token". VERIFIED against the source:
//     all 23,237 dc:identifier literals carry that datatype and no other element in the document
//     carries it. It is a property of the CEDS document's grammar, uniform across every subject.
//   * The XML element that WRAPS each entity (rdfs:Class / rdf:Property / owl:Class /
//     owl:NamedIndividual) is chosen from the node's role. That mapping is the CEDS shape, and the
//     graph's role IS the fact being re-serialized.
// Everything else on the page comes from a node property or an edge.
//
// Async style: qtools taskListPlus/pipeRunner, error-first callbacks (R7), no async/await, no
// try/catch for control flow. camelCase only.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const CEDS_NAMESPACE = 'https://w3id.org/CEDStandards/terms/';
const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema#';
const SKOS_NAMESPACE = 'http://www.w3.org/2004/02/skos/core#';
const XSD_TOKEN = `${XSD_NAMESPACE}token`;
const XSD_BOOLEAN = `${XSD_NAMESPACE}boolean`;
const SKOS_CONCEPT = `${SKOS_NAMESPACE}Concept`;
const SKOS_CONCEPT_SCHEME = `${SKOS_NAMESPACE}ConceptScheme`;

// The namespace block of the emitted document. Byte-for-byte the source's own, so a human can
// diff the two files by eye even though the INSTRUMENT compares statements, not bytes.
const ROOT_NAMESPACE_DECLARATIONS = [
	`xmlns="${CEDS_NAMESPACE}"`,
	'xmlns:dc="http://purl.org/dc/elements/1.1/"',
	'xmlns:owl="http://www.w3.org/2002/07/owl#"',
	'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
	`xmlns:xsd="${XSD_NAMESPACE}"`,
	'xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
	`xmlns:skos="${SKOS_NAMESPACE}"`,
	'xmlns:schema="https://schema.org/"',
].join(' ');

// ENTITY_ELEMENT_NAME — the CEDS shape's node element per entity kind (a shape constant, see header).
const ENTITY_ELEMENT_NAME = {
	ontology: 'owl:Ontology',
	class: 'rdfs:Class',
	property: 'rdf:Property',
	optionSet: 'owl:Class',
	optionValue: 'owl:NamedIndividual',
};

// GRAPH_PROPERTY_BY_FIELD — THE ENRICHMENT CONTRACT, stated as data. Left: the serializer's field
// name (= the source predicate's local name). Right: the node property the reader looks for. A
// field whose graph property is null is not read off a node at all — it is derived from edges or
// from the node's role, and the reader is where that happens.
const GRAPH_PROPERTY_BY_FIELD = {
	creator: 'creator', // dc:creator            — NOT carried today
	identifier: null, // dc:identifier         — from crossRefs[0].raw (the RAW source anchor)
	label: 'name', // rdfs:label            — carried
	comment: 'comment', // rdfs:comment          — NOT carried today
	description: 'description', // dc:description        — carried
	definition: 'definition', // skos:definition       — NOT carried today
	notation: 'notation', // skos:notation         — carried
	prefLabel: 'prefLabel', // skos:prefLabel        — NOT carried today
	deprecated: 'deprecated', // owl:deprecated        — NOT carried today
	textFormat: 'textFormat', // textFormat            — carried
	maxLength: 'maxLength', // maxLength             — carried
	minLength: 'minLength', // minLength             — NOT carried today
	minInclusive: 'minInclusive', // minInclusive          — NOT carried today
	maxInclusive: 'maxInclusive', // maxInclusive          — NOT carried today
	decimalPlaces: 'decimalPlaces', // decimalPlaces         — NOT carried today
	minCount: 'minCount', // minCount              — NOT carried today
	maxCount: 'maxCount', // maxCount              — NOT carried today
	issueLink: 'issueLink', // issueLink             — NOT carried today
	editHistory: 'editHistory', // editHistory (nested)  — NOT carried today
	versionInfo: 'version', // owl:versionInfo       — carried (root only)
	subClassOf: null, // rdfs:subClassOf       — from SUBCLASS_OF edges
	domainIncludes: null, // schema:domainIncludes — from allDomainIds / domainId
	rangeIncludes: null, // schema:rangeIncludes  — from HAS_OPTION_SET / REFERENCES edges + dataType
	inScheme: null, // skos:inScheme         — from HAS_VALUE edges
	typeResources: null, // explicit rdf:type     — from the node's role + its scheme
};

// FIELD_ORDER_BY_KIND — which fields each entity kind may carry, in emission order. Order is a
// readability choice only: the diff is a SET comparison and cannot see it.
const SCALAR_ANNOTATION_FIELDS = [
	'creator',
	'identifier',
	'label',
	'comment',
	'description',
	'definition',
	'notation',
	'prefLabel',
	'deprecated',
];
const FIELD_ORDER_BY_KIND = {
	ontology: ['versionInfo'],
	class: [...SCALAR_ANNOTATION_FIELDS, 'subClassOf', 'editHistory'],
	property: [
		...SCALAR_ANNOTATION_FIELDS,
		'domainIncludes',
		'rangeIncludes',
		'textFormat',
		'maxLength',
		'minLength',
		'minInclusive',
		'maxInclusive',
		'decimalPlaces',
		'minCount',
		'maxCount',
		'issueLink',
		'editHistory',
	],
	optionSet: [...SCALAR_ANNOTATION_FIELDS, 'typeResources', 'subClassOf', 'editHistory'],
	optionValue: [
		...SCALAR_ANNOTATION_FIELDS,
		'typeResources',
		'inScheme',
		'subClassOf',
		'editHistory',
	],
};

// FIELD_EMISSION — how each field becomes XML. `element` is the output qname; `objectKind` says
// whether the value is a literal, a typed literal, or an rdf:resource; `many` says the entity may
// carry a list.
const FIELD_EMISSION = {
	creator: { element: 'dc:creator', objectKind: 'literal' },
	identifier: { element: 'dc:identifier', objectKind: 'literal', datatype: XSD_TOKEN },
	label: { element: 'rdfs:label', objectKind: 'literal' },
	comment: { element: 'rdfs:comment', objectKind: 'literal' },
	description: { element: 'dc:description', objectKind: 'literal' },
	definition: { element: 'skos:definition', objectKind: 'literal' },
	notation: { element: 'skos:notation', objectKind: 'literal' },
	prefLabel: { element: 'skos:prefLabel', objectKind: 'literal' },
	deprecated: { element: 'owl:deprecated', objectKind: 'literal', datatype: XSD_BOOLEAN },
	textFormat: { element: 'textFormat', objectKind: 'literal' },
	maxLength: { element: 'maxLength', objectKind: 'literal' },
	minLength: { element: 'minLength', objectKind: 'literal' },
	minInclusive: { element: 'minInclusive', objectKind: 'literal' },
	maxInclusive: { element: 'maxInclusive', objectKind: 'literal' },
	decimalPlaces: { element: 'decimalPlaces', objectKind: 'literal' },
	minCount: { element: 'minCount', objectKind: 'literal' },
	maxCount: { element: 'maxCount', objectKind: 'literal' },
	issueLink: { element: 'issueLink', objectKind: 'literal', many: true },
	versionInfo: { element: 'owl:versionInfo', objectKind: 'literal' },
	subClassOf: { element: 'rdfs:subClassOf', objectKind: 'resource', many: true },
	domainIncludes: { element: 'schema:domainIncludes', objectKind: 'resource', many: true },
	rangeIncludes: { element: 'schema:rangeIncludes', objectKind: 'resource', many: true },
	inScheme: { element: 'skos:inScheme', objectKind: 'resource' },
	typeResources: { element: 'rdf:type', objectKind: 'resource', many: true },
};

// EDIT_HISTORY_ENTRY_FIELDS — the nested block's own little vocabulary.
const EDIT_HISTORY_ENTRY_FIELDS = [
	{ field: 'changeDescription', element: 'changeDescription' },
	{ field: 'changeVersion', element: 'changeVersion' },
	{ field: 'changeNew', element: 'changeNew', datatype: XSD_BOOLEAN },
	{ field: 'changeUpdated', element: 'changeUpdated', datatype: XSD_BOOLEAN },
	{
		field: 'changePropertyAddedToClass',
		element: 'changePropertyAddedToClass',
		datatype: XSD_BOOLEAN,
	},
	{ field: 'issueLink', element: 'issueLink' },
];

// The node properties the reader pulls. Named explicitly rather than with `properties(n)` for one
// concrete reason: `properties(n)` drags the 1024-float embedding off every one of ~23,000 nodes,
// which is the single thing that would actually blow memory here.
const READ_PROPERTY_NAMES = [
	'stableId',
	'uri',
	'role',
	'cedsId',
	'crossRefs',
	'name',
	'description',
	'notation',
	'dataType',
	'domainId',
	'allDomainIds',
	'version',
	// the enrichment contract's forward-looking slots (see header) — absent today, read anyway
	'creator',
	'comment',
	'definition',
	'prefLabel',
	'deprecated',
	'textFormat',
	'maxLength',
	'minLength',
	'minInclusive',
	'maxInclusive',
	'decimalPlaces',
	'minCount',
	'maxCount',
	'issueLink',
	'editHistory',
	// DmeEditHistoryEntry's own fields. ⟪TQ ruling, 2026-08-02⟫ change history is NODES, so the
	// reader must project the entry's properties or the serializer receives objects with every
	// field undefined and writes an EMPTY <editHistoryEntry> element -- which is exactly what
	// the first run did: 3,849 statements INVENTED (empty entries whose content hash matches
	// nothing) while the source's 8,562 stayed LOST. A closed projection list is the same
	// disease as the parser's closed field list, one layer down, and it fails the same silent
	// way: the structure is present and says nothing.
	'sequence',
	'changeDescription',
	'changeVersion',
	'changeNew',
	'changeUpdated',
	'changePropertyAddedToClass',
];

const DEFAULT_PAGE_SIZE = 2000;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// =====================================================================
		// XML WRITING
		// =====================================================================

		const escapeText = (value) =>
			String(value)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');

		const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;');

		// present — the "absent" ruling in one place: undefined, null, '' and [] are all ABSENT.
		// The CEDS forge stamps `notation: ''` to mean "there is no notation", and an empty element
		// would be a statement the source never made.
		const present = (value) => {
			if (value === undefined || value === null) {
				return false;
			}
			if (Array.isArray(value)) {
				return value.length > 0;
			}
			return String(value).trim() !== '';
		};

		const literalElementText = ({ element, value, datatype, indent }) =>
			`${indent}<${element}${datatype ? ` rdf:datatype="${escapeAttribute(datatype)}"` : ''}>` +
			`${escapeText(value)}</${element}>\n`;

		const resourceElementText = ({ element, value, indent }) =>
			`${indent}<${element} rdf:resource="${escapeAttribute(value)}" />\n`;

		const editHistoryText = ({ entries, indent }) => {
			const parts = [`${indent}<editHistory rdf:parseType="Collection">\n`];
			(entries || []).forEach((oneEntry) => {
				parts.push(`${indent}\t<editHistoryEntry>\n`);
				EDIT_HISTORY_ENTRY_FIELDS.forEach((oneField) => {
					if (!present(oneEntry[oneField.field])) {
						return;
					}
					parts.push(
						literalElementText({
							element: oneField.element,
							value: oneEntry[oneField.field],
							datatype: oneField.datatype,
							indent: `${indent}\t\t`,
						}),
					);
				});
				parts.push(`${indent}\t</editHistoryEntry>\n`);
			});
			parts.push(`${indent}</editHistory>\n`);
			return parts.join('');
		};

		// entityText — ONE entity's XML. Pure and synchronous: given an entity it returns text, and
		// it is the caller that decides where the text goes (a stream, a string, a test assertion).
		const entityText = ({ kind, entity }) => {
			const elementName = ENTITY_ELEMENT_NAME[kind];
			if (!elementName) {
				return { error: `${moduleName}: no CEDS element shape for entity kind '${kind}'.` };
			}
			if (!present(entity && entity.uri)) {
				return {
					error:
						`${moduleName}: a ${kind} entity carries no uri. The uri IS the subject of every ` +
						`statement about it; an entity without one cannot be serialized and is refused ` +
						`rather than written as an anonymous element.`,
				};
			}
			const parts = [`\t<${elementName} rdf:about="${escapeAttribute(entity.uri)}">\n`];
			let refusal = '';
			(FIELD_ORDER_BY_KIND[kind] || []).forEach((oneField) => {
				if (refusal) {
					return;
				}
				const value = entity[oneField];
				if (!present(value)) {
					return;
				}
				if (oneField === 'editHistory') {
					parts.push(editHistoryText({ entries: value, indent: '\t\t' }));
					return;
				}
				const emission = FIELD_EMISSION[oneField];
				if (!emission) {
					refusal = `${moduleName}: field '${oneField}' on a ${kind} has no emission rule.`;
					return;
				}
				const valueList = Array.isArray(value) ? value : [value];
				if (!emission.many && valueList.length > 1) {
					refusal =
						`${moduleName}: field '${oneField}' on ${entity.uri} carries ${valueList.length} ` +
						`values but the CEDS shape declares it single-valued. A silent truncation here ` +
						`would be an invisible loss, so it is refused by name.`;
					return;
				}
				valueList.forEach((oneValue) => {
					if (!present(oneValue)) {
						return;
					}
					parts.push(
						emission.objectKind === 'resource'
							? resourceElementText({ element: emission.element, value: oneValue, indent: '\t\t' })
							: literalElementText({
									element: emission.element,
									value: oneValue,
									datatype: emission.datatype,
									indent: '\t\t',
								}),
					);
				});
			});
			if (refusal) {
				return { error: refusal };
			}
			parts.push(`\t</${elementName}>\n`);
			return { text: parts.join('') };
		};

		// =====================================================================
		// serializeCedsRdf — cedsGraph -> RDF/XML, written through writeChunk
		// =====================================================================
		// CHUNKED BY ENTITY on purpose. The emitted document for the real hub is ~19MB across ~23,000
		// entities; assembling it as one string before writing would hold the whole thing twice.
		// writeChunk is a plain synchronous sink (a stream write, a test accumulator) so this stays a
		// pure shaping function with the I/O decision at the caller.

		const serializeCedsRdf = ({ cedsGraph, writeChunk } = {}, callback) => {
			if (!cedsGraph || typeof cedsGraph !== 'object') {
				callback(
					`${moduleName}.serializeCedsRdf: cedsGraph is REQUIRED and has no default.`,
				);
				return;
			}
			if (typeof writeChunk !== 'function') {
				callback(
					`${moduleName}.serializeCedsRdf: writeChunk is REQUIRED and has no default — the ` +
						`serializer never chooses where its output goes.`,
				);
				return;
			}

			const counts = { ontology: 0, class: 0, property: 0, optionSet: 0, optionValue: 0 };
			let refusal = '';

			writeChunk(`<?xml version='1.0' encoding='UTF-8'?>\n`);
			writeChunk(`<rdf:RDF ${ROOT_NAMESPACE_DECLARATIONS}>\n`);

			const writeKind = (kind, entityList) => {
				(entityList || []).forEach((oneEntity) => {
					if (refusal) {
						return;
					}
					const built = entityText({ kind, entity: oneEntity });
					if (built.error) {
						refusal = built.error;
						return;
					}
					counts[kind] += 1;
					writeChunk(built.text);
				});
			};

			writeKind('ontology', cedsGraph.ontology ? [cedsGraph.ontology] : []);
			writeKind('class', cedsGraph.classes);
			writeKind('property', cedsGraph.properties);
			writeKind('optionSet', cedsGraph.optionSets);
			writeKind('optionValue', cedsGraph.optionValues);

			if (refusal) {
				callback(refusal);
				return;
			}
			writeChunk('</rdf:RDF>\n');
			callback('', { counts });
		};

		// =====================================================================
		// resolveContainerBolt — containerName -> { boltUrl, user, password }
		// =====================================================================
		// The bolt port and the credential are FACTS ABOUT THE RUNNING CONTAINER, so they are read
		// from the container (`docker inspect`) rather than restated on the command line where they
		// could drift. runDockerCommand is injectable so a test can prove the parsing without Docker.

		const defaultRunDockerCommand = (dockerArgs, callback) =>
			execFile('docker', dockerArgs, { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }, callback);

		const resolveContainerBolt = (
			{ containerName, runDockerCommand = defaultRunDockerCommand } = {},
			callback,
		) => {
			if (typeof containerName !== 'string' || containerName.trim() === '') {
				callback(
					`${moduleName}.resolveContainerBolt: containerName is REQUIRED and has no default.`,
				);
				return;
			}
			runDockerCommand(['inspect', containerName], (inspectError, stdout, stderr) => {
				if (inspectError) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' failed: ` +
							`${inspectError.message}${stderr ? `\n${stderr}` : ''}`,
					);
					return;
				}
				let inspected;
				try {
					inspected = JSON.parse(stdout);
				} catch (parseError) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned ` +
							`unparseable JSON: ${parseError.message}`,
					);
					return;
				}
				const record = Array.isArray(inspected) ? inspected[0] : inspected;
				if (!record) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned no ` +
							`record. The container does not exist under that name.`,
					);
					return;
				}
				const portBindings =
					(record.NetworkSettings && record.NetworkSettings.Ports && record.NetworkSettings.Ports['7687/tcp']) ||
					[];
				const boltPort = (portBindings.find((oneBinding) => oneBinding && oneBinding.HostPort) || {})
					.HostPort;
				if (!boltPort) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' publishes no host ` +
							`port for 7687/tcp. There is no bolt endpoint to read and one is not guessed at.`,
					);
					return;
				}
				const authEntry = ((record.Config && record.Config.Env) || []).find((oneEntry) =>
					String(oneEntry).startsWith('NEO4J_AUTH='),
				);
				if (!authEntry) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' declares no ` +
							`NEO4J_AUTH in its environment. The credential is read from the container, never ` +
							`assumed.`,
					);
					return;
				}
				const authValue = authEntry.slice('NEO4J_AUTH='.length);
				const slashAt = authValue.indexOf('/');
				if (slashAt === -1) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' has NEO4J_AUTH ` +
							`'${authValue}', which is not the '<user>/<password>' shape.`,
					);
					return;
				}
				callback('', {
					containerName,
					boltUrl: `bolt://localhost:${boltPort}`,
					user: authValue.slice(0, slashAt),
					password: authValue.slice(slashAt + 1),
				});
			});
		};

		// =====================================================================
		// THE READER — a materialized graph -> cedsGraph
		// =====================================================================
		// The reader is where "what the graph can support" is decided: it resolves ownership edges to
		// URIs, recovers the RAW dc:identifier anchor out of the crossRefs JSON, and derives the
		// explicit rdf:type resources from a node's role. The serializer downstream does no lookups
		// at all, which is what lets a test drive it with a hand-built double.
		//
		// makeNeo4jCedsReader({ boltUrl, user, password, pageSize }) -> { readAll(cb), close(cb) }
		// A TEST DOUBLE satisfies the same one-method contract; compileToFile cannot tell them apart.

		// rawAnchorFrom — the ORIGINAL dc:identifier text. The CEDS forge normalizes cedsId into a
		// kind-prefixed canonical form (an option set's source anchor 'C000002' becomes 'OS000002';
		// an option value's 'NI000002113286' becomes 'OV000002113286'), so the canonical id is NOT
		// what the source said. The source's own text survives in exactly one place — crossRefs[0].raw
		// — and that is what a faithful re-serialization must write.
		const rawAnchorFrom = (properties) => {
			if (!properties) {
				return undefined;
			}
			const rawCrossRefs = properties.crossRefs;
			if (typeof rawCrossRefs === 'string' && rawCrossRefs.trim() !== '') {
				let parsed;
				try {
					parsed = JSON.parse(rawCrossRefs);
				} catch (parseError) {
					parsed = null;
				}
				const first = Array.isArray(parsed) ? parsed[0] : null;
				if (first && typeof first.raw === 'string' && first.raw.trim() !== '') {
					return first.raw;
				}
			}
			return undefined;
		};

		// entityFromNode — the node properties every kind shares, mapped through the enrichment
		// contract. Kind-specific fields are added by the caller.
		const entityFromNode = (properties) => {
			const entity = { uri: properties.uri || properties.stableId };
			Object.keys(GRAPH_PROPERTY_BY_FIELD).forEach((oneField) => {
				const graphProperty = GRAPH_PROPERTY_BY_FIELD[oneField];
				if (!graphProperty) {
					return;
				}
				const value = properties[graphProperty];
				if (value === undefined || value === null) {
					return;
				}
				entity[oneField] = value;
			});
			const rawAnchor = rawAnchorFrom(properties);
			if (rawAnchor) {
				entity.identifier = rawAnchor;
			}
			// editHistory arrives as a JSON string when a future forge stamps it as a node property
			// (Neo4j holds no nested structures); an array is accepted as-is so an in-memory double
			// need not stringify.
			if (typeof entity.editHistory === 'string') {
				let parsedHistory;
				try {
					parsedHistory = JSON.parse(entity.editHistory);
				} catch (parseError) {
					parsedHistory = null;
				}
				entity.editHistory = Array.isArray(parsedHistory) ? parsedHistory : undefined;
			}
			// versionInfo belongs to the ontology element alone; a class carrying `version` must not
			// grow an owl:versionInfo statement out of nowhere.
			delete entity.versionInfo;
			return entity;
		};

		const makeNeo4jCedsReader = ({ boltUrl, user, password, pageSize } = {}) => {
			let driver = null;
			let neo4jModule = null;
			const readPageSize = pageSize || DEFAULT_PAGE_SIZE;

			const ensureDriver = () => {
				if (driver) {
					return;
				}
				neo4jModule = require('neo4j-driver');
				driver = neo4jModule.driver(boltUrl, neo4jModule.auth.basic(user, password), {
					encrypted: false,
				});
			};

			// SKIP/LIMIT REFUSE A JAVASCRIPT NUMBER. A plain 2000 arrives at the server as the FLOAT
			// 2000.0 and Cypher rejects it by name ("'2000.0' is not a valid value. Must be a
			// non-negative integer"). neo4j.int() is the driver's own 64-bit integer carrier and is
			// the only correct way to parameterize a paging bound.
			const asCypherInteger = (value) => neo4jModule.int(value);

			const runRead = (cypher, parameters, callback) => {
				ensureDriver();
				const readSession = driver.session({ defaultAccessMode: 'READ' });
				const finish = (errString, payload) => {
					readSession.close().then(
						() => callback(errString, payload),
						(closeError) =>
							callback(
								errString || `${moduleName}: closing read session failed: ${closeError.message}`,
								payload,
							),
					);
				};
				readSession
					.run(cypher, parameters)
					.then((queryResult) => finish('', { records: queryResult.records }))
					.catch((queryError) =>
						finish(`${moduleName}: graph read failed: ${queryError.message}\n${cypher}`),
					);
			};

			// readRolePaged — every node of one role, in stableId order, a page at a time. The
			// property list is explicit (see READ_PROPERTY_NAMES) so no embedding is ever fetched.
			const readRolePaged = ({ role }, callback) => {
				const projection = READ_PROPERTY_NAMES.map((oneName) => `${oneName}: n.\`${oneName}\``).join(
					', ',
				);
				const cypher =
					`MATCH (n:ForgedNode {_source: 'CEDS', role: $role})\n` +
					`RETURN { ${projection} } AS properties\n` +
					`ORDER BY properties.stableId\n` +
					`SKIP $skip LIMIT $limit`;
				const collected = [];
				const readNextPage = (skip) => {
					ensureDriver();
					const pagingParameters = {
						role,
						skip: asCypherInteger(skip),
						limit: asCypherInteger(readPageSize),
					};
					runRead(cypher, pagingParameters, (readError, result) => {
						if (readError) {
							callback(readError);
							return;
						}
						result.records.forEach((oneRecord) => collected.push(oneRecord.get('properties')));
						if (result.records.length < readPageSize) {
							callback('', { nodes: collected });
							return;
						}
						readNextPage(skip + readPageSize);
					});
				};
				readNextPage(0);
			};

			const readEdgePairs = ({ cypher }, callback) => {
				runRead(cypher, {}, (readError, result) => {
					if (readError) {
						callback(readError);
						return;
					}
					callback('', {
						pairs: result.records.map((oneRecord) => ({
							from: oneRecord.get('fromUri'),
							to: oneRecord.get('toUri'),
						})),
					});
				});
			};

			const readAll = (callback) => {
				const taskList = new taskListPlus();

				// DmeEditHistoryEntry joins Layer 1 as of 2026-08-02. ⟪TQ ruling⟫ change history is
				// NODES, not a blob, so the compiler must reassemble each element's history from
				// its entry nodes rather than parse a JSON property. Owner and order are both
				// recoverable from the entry alone: its uri is `<ownerUri>#editHistory/<sequence>`,
				// derived precisely so this reassembly needs no extra query and no extra property.
				[
					'DmeStandardRoot',
					'DmeClass',
					'DmeProperty',
					'DmeOptionSet',
					'DmeOptionValue',
					'DmeEditHistoryEntry',
				].forEach(
					(oneRole) => {
						taskList.push((args, next) => {
							readRolePaged({ role: oneRole }, (readError, result) => {
								if (readError) {
									next(readError);
									return;
								}
								next('', { ...args, [oneRole]: result.nodes });
							});
						});
					},
				);

				// ⟪LAYER RULING (design authority, 2026-08-02)⟫ THE GRAPH HOLDS TWO LAYERS AND ONLY ONE
				// OF THEM ROUND-TRIPS.
				//   LAYER 1 — CEDS, faithfully represented: DmeClass, DmeProperty, DmeOptionSet,
				//     DmeOptionValue, plus DmeStandardRoot for the ontology's version, and the
				//     statements relating them (SUBCLASS_OF, the domain slots, HAS_OPTION_SET /
				//     REFERENCES for ranges, HAS_VALUE for scheme membership). This is Layer 1 and it
				//     is ALL this compiler reads.
				//   LAYER 2 — OUR matching index: HubReference and HubDefinition nodes,
				//     addressSignature, embeddings, and the HAS_CEDS_DOMAIN / HAS_CEDS_PROPERTY /
				//     HAS_CEDS_RANGE / IN_HUB edges hanging off them. CEDS CONTAINS NO SUCH THING —
				//     it is ours, derived from Layer 1 and regenerable from it. Emitting any of it
				//     into RDF would INVENT statements CEDS never made, which this instrument's own
				//     diff would (correctly) report as invention: the worst category.
				// Every role is therefore named EXPLICITLY on both ends of every edge query below. A
				// bare `(:ForgedNode {_source:'CEDS'})` endpoint would exclude Layer 2 only by luck of
				// which edge types happen to exist today; naming the roles makes the exclusion a
				// stated decision that a reviewer can see and a future edge type cannot quietly break.
				const LAYER_ONE_CLASSLIKE_ROLES = `['DmeClass', 'DmeOptionSet']`;
				const edgeQueries = {
					subClassOf:
						`MATCH (a:ForgedNode {_source: 'CEDS'})-[:SUBCLASS_OF]->(b:ForgedNode {_source: 'CEDS'})\n` +
						`WHERE a.role IN ${LAYER_ONE_CLASSLIKE_ROLES} AND b.role IN ${LAYER_ONE_CLASSLIKE_ROLES}\n` +
						`RETURN a.uri AS fromUri, b.uri AS toUri`,
					range:
						`MATCH (p:ForgedNode {_source: 'CEDS', role: 'DmeProperty'})-[:HAS_OPTION_SET|REFERENCES]->` +
						`(t:ForgedNode {_source: 'CEDS'})\n` +
						`WHERE t.role IN ${LAYER_ONE_CLASSLIKE_ROLES}\n` +
						`RETURN p.uri AS fromUri, t.uri AS toUri`,
					inScheme:
						`MATCH (s:ForgedNode {_source: 'CEDS', role: 'DmeOptionSet'})-[:HAS_VALUE]->` +
						`(v:ForgedNode {_source: 'CEDS', role: 'DmeOptionValue'})\n` +
						`RETURN v.uri AS fromUri, s.uri AS toUri`,
				};
				Object.keys(edgeQueries).forEach((oneEdgeName) => {
					taskList.push((args, next) => {
						readEdgePairs({ cypher: edgeQueries[oneEdgeName] }, (readError, result) => {
							if (readError) {
								next(readError);
								return;
							}
							next('', { ...args, [oneEdgeName]: result.pairs });
						});
					});
				});

				pipeRunner(taskList.getList(), {}, (pipeError, args) => {
					if (pipeError) {
						callback(pipeError);
						return;
					}
					assembleCedsGraph(
						{
							rootNodes: args.DmeStandardRoot,
							classNodes: args.DmeClass,
							propertyNodes: args.DmeProperty,
							optionSetNodes: args.DmeOptionSet,
							optionValueNodes: args.DmeOptionValue,
						editHistoryEntryNodes: args.DmeEditHistoryEntry,
							subClassOfPairs: args.subClassOf,
							rangePairs: args.range,
							inSchemePairs: args.inScheme,
						},
						callback,
					);
				});
			};

			const close = (callback) => {
				if (!driver) {
					callback('');
					return;
				}
				driver
					.close()
					.then(() => callback(''))
					.catch((closeError) =>
						callback(`${moduleName}: closing the graph reader failed: ${closeError.message}`),
					);
			};

			return { readAll, close };
		};

		// =====================================================================
		// assembleCedsGraph — raw node rows + edge pairs -> the cedsGraph the serializer eats.
		// PURE and callback-shaped, so the hermetic suite can drive it with hand-built rows.
		// =====================================================================

		const assembleCedsGraph = (
			{
				rootNodes,
				classNodes,
				propertyNodes,
				optionSetNodes,
				optionValueNodes,
				editHistoryEntryNodes,
				subClassOfPairs,
				rangePairs,
				inSchemePairs,
			} = {},
			callback,
		) => {
			const listOf = (value) => (Array.isArray(value) ? value : []);

			// ---------------------------------------------------------------------------
			// editHistoryByOwnerUri — reassemble each element's change history IN FILE ORDER
			// ---------------------------------------------------------------------------
			// ⟪TQ ruling, 2026-08-02⟫ change history lives as NODES. Each entry's uri is
			// `<ownerUri>#editHistory/<sequence>`, minted that way precisely so both the owner
			// and the position are recoverable from the entry alone -- no join, no extra query.
			//
			// SORTED BY `sequence`, WHICH IS FILE POSITION AND NOT CHRONOLOGY. Neo4j returns
			// rows in no guaranteed order, so the sort is mandatory rather than cosmetic. And it
			// must sort on sequence: CEDS's own ordering is untidy (P000225 runs 10, 11, 12, 3,
			// 4, 7, 8) and sorting by changeVersion would emit a tidier document that no longer
			// matches the source -- loss and invention in the same move.
			const editHistoryByOwnerUri = (entryNodes) => {
				const byOwner = {};
				listOf(entryNodes).forEach((oneNode) => {
					const uri = oneNode && oneNode.uri;
					const separatorAt = typeof uri === 'string' ? uri.indexOf('#editHistory/') : -1;
					if (separatorAt < 1) {
						return;
					}
					const ownerUri = uri.slice(0, separatorAt);
					byOwner[ownerUri] = byOwner[ownerUri] || [];
					byOwner[ownerUri].push(oneNode);
				});
				Object.keys(byOwner).forEach((oneOwnerUri) => {
					byOwner[oneOwnerUri].sort(
						(left, right) => Number(left.sequence || 0) - Number(right.sequence || 0),
					);
				});
				return byOwner;
			};

			// valueListOf — read a graph property that MAY have been scalarized. The replay engine
			// unwraps single-element arrays at MERGE (its deliberate PG-JSON convention), so a
			// property the forge wrote as ['C000123'] is READ BACK as the bare string 'C000123'.
			// Any consumer that tests Array.isArray() silently sees nothing for the majority case.
			// Empty strings and nulls are dropped so a blank slot never becomes a phantom member.
			const valueListOf = (value) =>
				[]
					.concat(value === undefined || value === null ? [] : value)
					.filter((oneValue) => typeof oneValue === 'string' && oneValue.trim() !== '');
			const groupByFrom = (pairs) =>
				listOf(pairs).reduce((soFar, onePair) => {
					if (!onePair || !onePair.from || !onePair.to) {
						return soFar;
					}
					(soFar[onePair.from] = soFar[onePair.from] || []).push(onePair.to);
					return soFar;
				}, {});

			const subClassOfByUri = groupByFrom(subClassOfPairs);
			const rangeByUri = groupByFrom(rangePairs);
			const inSchemeByUri = groupByFrom(inSchemePairs);

			// cedsId -> uri, built from the CLASS nodes only. schema:domainIncludes always points at a
			// class, and the CEDS forge records the full resolvable domain list as canonical class ids
			// (allDomainIds) rather than as URIs, so this map is what turns them back into subjects.
			// One pass over the entry nodes; every entity below then looks up its own history.
			const historyByOwnerUri = editHistoryByOwnerUri(editHistoryEntryNodes);
			const attachEditHistory = (entity) => {
				const entries = historyByOwnerUri[entity.uri];
				if (entries && entries.length) {
					entity.editHistory = entries;
				}
				return entity;
			};

			const classUriByCedsId = {};
			listOf(classNodes).forEach((oneNode) => {
				if (oneNode && oneNode.cedsId && oneNode.uri) {
					classUriByCedsId[oneNode.cedsId] = oneNode.uri;
				}
			});

			const unresolvedDomainIds = [];

			const classes = listOf(classNodes).map((oneNode) => {
				const entity = attachEditHistory(entityFromNode(oneNode));
				const parents = subClassOfByUri[entity.uri];
				if (parents && parents.length) {
					entity.subClassOf = parents;
				}
				return entity;
			});

			const properties = listOf(propertyNodes).map((oneNode) => {
				const entity = attachEditHistory(entityFromNode(oneNode));
				// domainIncludes: the FULL resolvable list when the forge stamped one (allDomainIds),
				// otherwise the single address slot. Both are canonical class ids, mapped back to URIs.
				//
				// AUDIT A4 / GATE S-7 — READ THE VALUE SHAPE-AGNOSTICALLY. The replay engine
				// scalarizes single-element arrays at MERGE, so 2,068 of 2,324 DmeProperty nodes
				// store allDomainIds as a bare STRING. The former `Array.isArray()` test silently
				// ignored every one of those and fell straight through to `domainId`. That was
				// lossless ONLY because allDomainIds[0] === domainId by construction — an invariant
				// this module had no business depending on, and one a genuine second domain breaks.
				// valueListOf() performs the same unwrap every other consumer performs.
				//
				// Do NOT "fix" the storage: the singleton unwrap is the replay engine's deliberate
				// PG-JSON convention, not a defect.
				const declaredDomainIds = valueListOf(oneNode.allDomainIds);
				const domainIds = declaredDomainIds.length
					? declaredDomainIds
					: valueListOf(oneNode.domainId);
				const domainUris = [];
				domainIds.forEach((oneDomainId) => {
					const resolved = classUriByCedsId[oneDomainId];
					if (!resolved) {
						unresolvedDomainIds.push(`${entity.uri} -> ${oneDomainId}`);
						return;
					}
					domainUris.push(resolved);
				});
				if (domainUris.length) {
					entity.domainIncludes = domainUris;
				}
				// rangeIncludes: the edge targets (an option set or a referenced class) when there are
				// any, otherwise the scalar XSD datatype the forge kept.
				const rangeUris = (rangeByUri[entity.uri] || []).slice();
				if (!rangeUris.length && oneNode.dataType) {
					rangeUris.push(`${XSD_NAMESPACE}${oneNode.dataType}`);
				}
				if (rangeUris.length) {
					entity.rangeIncludes = rangeUris;
				}
				return entity;
			});

			const optionSets = listOf(optionSetNodes).map((oneNode) => {
				const entity = attachEditHistory(entityFromNode(oneNode));
				// The explicit skos:ConceptScheme type IS what makes this node an option set in the
				// source, and the node's role is the graph's record of that same fact.
				entity.typeResources = [SKOS_CONCEPT_SCHEME];
				const parents = subClassOfByUri[entity.uri];
				if (parents && parents.length) {
					entity.subClassOf = parents;
				}
				return entity;
			});

			const optionValues = listOf(optionValueNodes).map((oneNode) => {
				const entity = attachEditHistory(entityFromNode(oneNode));
				const schemes = inSchemeByUri[entity.uri] || [];
				if (schemes.length > 1) {
					// One value in two schemes is not a shape this serializer can write honestly
					// (skos:inScheme is single-valued here), so it is named rather than truncated.
					unresolvedDomainIds.push(`${entity.uri} is in ${schemes.length} schemes`);
				}
				if (schemes.length) {
					entity.inScheme = schemes[0];
					entity.typeResources = [schemes[0], SKOS_CONCEPT];
				} else {
					entity.typeResources = [SKOS_CONCEPT];
				}
				return entity;
			});

			const rootNode = listOf(rootNodes)[0];
			const ontology = rootNode
				? {
						uri: rootNode.uri || rootNode.stableId,
						versionInfo: rootNode.version,
					}
				: undefined;

			callback('', {
				cedsGraph: { ontology, classes, properties, optionSets, optionValues },
				readerNotes: { unresolvedDomainIds },
			});
		};

		// =====================================================================
		// compileToFile — reader -> RDF/XML on disk. callback('', { outPath, counts, readerNotes })
		// =====================================================================

		const compileToFile = ({ reader, outPath } = {}, callback) => {
			if (!reader || typeof reader.readAll !== 'function') {
				callback(
					`${moduleName}.compileToFile: reader is REQUIRED and must expose readAll(callback). ` +
						`The compiler never decides for itself which graph it reads.`,
				);
				return;
			}
			if (typeof outPath !== 'string' || outPath.trim() === '') {
				callback(
					`${moduleName}.compileToFile: outPath is REQUIRED and has no default — a compile that ` +
						`does not say where it writes is one edit away from writing somewhere it should not.`,
				);
				return;
			}

			reader.readAll((readError, read) => {
				if (readError) {
					callback(readError);
					return;
				}
				let writeStream;
				let openFault = '';
				try {
					fs.mkdirSync(path.dirname(outPath), { recursive: true });
					writeStream = fs.createWriteStream(outPath, { encoding: 'utf8' });
				} catch (openError) {
					openFault = openError.message;
				}
				if (openFault) {
					callback(`${moduleName}.compileToFile: opening '${outPath}' failed: ${openFault}`);
					return;
				}

				let streamFault = '';
				writeStream.on('error', (streamError) => {
					streamFault = streamError.message;
				});

				serializeCedsRdf(
					{ cedsGraph: read.cedsGraph, writeChunk: (text) => writeStream.write(text) },
					(serializeError, serialized) => {
						if (serializeError) {
							writeStream.end();
							callback(serializeError);
							return;
						}
						writeStream.end(() => {
							if (streamFault) {
								callback(`${moduleName}.compileToFile: writing '${outPath}' failed: ${streamFault}`);
								return;
							}
							callback('', {
								outPath,
								counts: serialized.counts,
								readerNotes: read.readerNotes || {},
							});
						});
					},
				);
			});
		};

		return {
			serializeCedsRdf,
			entityText,
			assembleCedsGraph,
			makeNeo4jCedsReader,
			resolveContainerBolt,
			compileToFile,
			rawAnchorFrom,
			GRAPH_PROPERTY_BY_FIELD,
			FIELD_ORDER_BY_KIND,
			ENTITY_ELEMENT_NAME,
			CEDS_NAMESPACE,
			XSD_NAMESPACE,
			DEFAULT_PAGE_SIZE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
