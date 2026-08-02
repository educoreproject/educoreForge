'use strict';

// parser.js — CEDS RDF/XML Ontology reader.
//
// HARVESTED+ADAPTED from trackA forge-ceds-rdf/lib/parser.js: the RDF/XML element extraction
// (getText/getAttr/getResourceRefs/isCedsUri/hasConceptSchemeType + the class/property/
// optionSet/optionValue extractors) is proven and kept. ADAPTED AWAY: trackA's node-shaping
// (it built private Ceds* nodes with PART_OF edges and a hand-rolled searchText). This parser
// now returns ONLY the raw intermediate entities + the cross-reference maps; shaping into the
// universal property contract (roles, ownership edges, searchText, crossRefs) happens in
// forgeCeds.js. The parser NEVER touches Neo4j, embeddings, or the contract.
//
// Async style: a single callback (err, { entities, maps, metadata }); xml2js is the only async
// boundary and resolves at the leaf. No async/await, no try/catch-for-control-flow except the
// localized JSON/XML parse boundary. camelCase only.

const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const CEDS_URI_PREFIX = 'https://w3id.org/CEDStandards/terms/';
const CONCEPT_SCHEME_URI = 'http://www.w3.org/2004/02/skos/core#ConceptScheme';
const XSD_PREFIX = 'http://www.w3.org/2001/XMLSchema#';

// ============================================================
// RDF/XML element helpers (harvested verbatim-in-substance from trackA)
// ============================================================

const getText = (element, tagName) => {
	const values = element[tagName];
	if (!values || !values.length) {
		return undefined;
	}
	const val = values[0];
	if (typeof val === 'string') {
		return val;
	}
	if (typeof val === 'object' && val['_']) {
		return val['_'];
	}
	return undefined;
};

const getAttr = (element, attrName) => {
	const attrs = element['$'];
	if (!attrs) {
		return undefined;
	}
	return attrs[attrName];
};

const getResourceRefs = (element, tagName) => {
	const values = element[tagName];
	if (!values || !values.length) {
		return [];
	}
	return values
		.map((val) => {
			if (typeof val === 'object' && val['$']) {
				return val['$']['rdf:resource'];
			}
			return undefined;
		})
		.filter(Boolean);
};

const isCedsUri = (uri) => uri && uri.startsWith(CEDS_URI_PREFIX);

const hasConceptSchemeType = (element) => {
	const types = element['rdf:type'];
	if (!types || !types.length) {
		return false;
	}
	return types.some((t) => {
		if (typeof t === 'object' && t['$']) {
			return t['$']['rdf:resource'] === CONCEPT_SCHEME_URI;
		}
		return false;
	});
};

// ============================================================
// Entity extractors
// ============================================================

// ============================================================
// THE OPEN-LIST RULE — carry every predicate we do not interpret
// ============================================================
//
// ⟪TQ, 2026-08-02⟫ "I would have thought that the conversion from OWL to graph is
// essentially an algorithm that is universal without reference to the specific nature of
// the source. Why isn't that true?"
//
// He was right, and this is the answer in code. Almost none of the ontology needs to know
// it is CEDS. Only the ROLE INTERPRETATION does -- deciding that an rdfs:Class is an
// entity, a skos:ConceptScheme is a codeset, a named individual in one is an allowed value.
// Annotations need no interpretation whatsoever: they are literals hanging off an entity.
//
// This extractor used to keep a CLOSED list of four fields and silently drop everything
// else, which is why 57,547 statements were missing -- not because they were hard, but
// because nobody was looking for them. A closed list also loses, forever and without a
// murmur, every predicate a future CEDS release adds.
//
// NAMING ⟪TQ approved, 2026-08-02⟫: a property is named exactly as the SOURCE names the
// predicate -- its local name, which is also what the round-trip compiler's
// GRAPH_PROPERTY_BY_FIELD already expects. No translation table to maintain, and the
// round-trip stays mechanical.
//
// MEASURED BEFORE WRITING (2026-08-02, full ontology census): 27 distinct predicates, and
// ZERO local-name collisions -- no two namespaces contend for one property name. The
// collision refusal below is therefore not defending against anything today. It is there
// because the day a release introduces one, silently overwriting a value would be
// indistinguishable from working correctly.

// Predicates the extractors READ THEMSELVES. Anything here is already represented -- as a
// base property, an edge, or a role decision -- and must not be duplicated as a generic
// annotation.
const INTERPRETED_PREDICATES = new Set([
	'dc:identifier', // -> cedsId
	'rdfs:label', // -> label
	'dc:description', // -> description
	'skos:notation', // -> notation
	'rdf:type', // -> the role decision
	'rdfs:subClassOf', // -> SUBCLASS_OF edges
	'schema:domainIncludes', // -> domainRefs
	'schema:rangeIncludes', // -> rangeRefs / dataType
	'skos:inScheme', // -> inSchemeRef
	'textFormat', // -> textFormat (already carried)
	'maxLength', // -> maxLength (already carried)
]);

// Predicates whose value is a NESTED STRUCTURE, not a literal. A nested value flattened
// into a string would round-trip as a lie: the statement would be present and wrong.
// editHistory is ruled to become NODES (spec §5.6), so it is deliberately left alone here
// rather than half-captured.
const NESTED_PREDICATES = new Set(['editHistory']);

const localNameOf = (qualifiedName) =>
	qualifiedName.indexOf(':') >= 0 ? qualifiedName.slice(qualifiedName.indexOf(':') + 1) : qualifiedName;

// oneAnnotationValue — a literal, or the URI of a resource reference. Returns undefined for
// anything else so the caller can decide, rather than coercing an object into "[object
// Object]" and calling it carried.
const oneAnnotationValue = (value) => {
	if (typeof value === 'string') {
		return value;
	}
	if (value && typeof value === 'object') {
		if (value['_'] !== undefined) {
			return value['_'];
		}
		if (value['$'] && value['$']['rdf:resource']) {
			return value['$']['rdf:resource'];
		}
	}
	return undefined;
};

const extractGenericAnnotations = (element, faults) => {
	const carried = {};
	const seenLocalNames = {};

	Object.keys(element).forEach((oneKey) => {
		if (oneKey === '$' || oneKey === '_') {
			return;
		}
		if (INTERPRETED_PREDICATES.has(oneKey) || NESTED_PREDICATES.has(oneKey)) {
			return;
		}
		const rawValues = (element[oneKey] || [])
			.map(oneAnnotationValue)
			.filter((oneValue) => oneValue !== undefined && oneValue !== '');

		// DEDUPLICATE. An RDF document is a SET of statements: the same subject, predicate and
		// object asserted twice is ONE statement, not two values. CEDS really does repeat
		// itself -- P000101 carries <minInclusive>0</minInclusive> twice, verbatim, and there
		// are 5 such duplicates in the ontology (the canonicalizer reports them collapsed).
		// Keeping both turned a single-valued fact into a two-element array, and the round-trip
		// compiler refused the emission by name rather than truncating it silently. That
		// refusal is what found this.
		const values = Array.from(new Set(rawValues));
		if (!values.length) {
			return;
		}
		const localName = localNameOf(oneKey);

		if (seenLocalNames[localName] && seenLocalNames[localName] !== oneKey) {
			// REFUSE rather than overwrite. Two namespaces contending for one property name
			// means one of them wins silently and its statements vanish while every entity
			// still looks perfectly healthy -- the same shape of invisible loss the crossRefs
			// fragility has.
			(faults || []).push(
				`LOCAL NAME COLLISION on '${localName}': both '${seenLocalNames[localName]}' and ` +
					`'${oneKey}' claim it on <${getAttr(element, 'rdf:about')}>. Refusing to guess which ` +
					`one survives; the naming convention needs a disambiguation ruling.`,
			);
			return;
		}
		seenLocalNames[localName] = oneKey;

		// Single values stay scalar, matching the replay engine's own PG-JSON convention of
		// unwrapping singleton arrays. Multi-valued predicates stay arrays.
		carried[localName] = values.length === 1 ? values[0] : values;
	});

	return carried;
};

// ============================================================
// editHistory — the one nested structure, extracted as ORDERED RECORDS
// ============================================================
//
// ⟪TQ ruling, 2026-08-02⟫ change history becomes NODES, not a JSON blob. A blob would
// round-trip perfectly and answer nothing; the whole reason to hold this in a graph is to
// be able to ask "what changed in 14.0.0.0" and "which elements we mapped against have
// moved since".
//
// ORDER IS LOAD-BEARING AND IT IS NOT CHRONOLOGICAL. The source marks editHistory as
// rdf:parseType="Collection" -- an ORDERED list -- and CEDS's own ordering is untidy.
// P000225 "Has Program Type" carries seven entries in file order 10, 11, 12, 3, 4, 7, 8.
// Sorting them by version is the obvious, helpful, WRONG thing: it produces a graph that
// reads better and can no longer regenerate the file it came from. `sequence` below is the
// position in the FILE, never the position in time. The chronological view is a query
// (ORDER BY changeVersion) and costs nothing.
//
// 1,623 entities carry a history; 1,920 entries in total; 210 entities carry more than one
// (155 have two, and a lone property has seven).

const EDIT_HISTORY_ENTRY_FIELDS = [
	'changeDescription',
	'changeVersion',
	'changeNew',
	'changeUpdated',
	'changePropertyAddedToClass',
	'issueLink',
];

const extractEditHistory = (element) => {
	const historyBlocks = element['editHistory'];
	if (!historyBlocks || !historyBlocks.length) {
		return undefined;
	}
	const entries = [];
	historyBlocks.forEach((oneBlock) => {
		if (!oneBlock || typeof oneBlock !== 'object') {
			return;
		}
		(oneBlock['editHistoryEntry'] || []).forEach((oneEntry) => {
			if (!oneEntry || typeof oneEntry !== 'object') {
				return;
			}
			const record = { sequence: entries.length };
			EDIT_HISTORY_ENTRY_FIELDS.forEach((oneField) => {
				const value = getText(oneEntry, oneField);
				if (value !== undefined && value !== '') {
					record[oneField] = value;
				}
			});
			entries.push(record);
		});
	});
	return entries.length ? entries : undefined;
};

// ============================================================
// owl:Restriction — the second nested structure, extracted as ORDERED RECORDS
// ============================================================
//
// 18 blocks in the ontology, every one on a CLASS, each shaped
//   <rdfs:subClassOf><owl:Restriction>
//       <owl:onProperty rdf:resource="..."/><owl:allValuesFrom rdf:resource="..."/>
//   </owl:Restriction></rdfs:subClassOf>
// which is 4 statements apiece (the subClassOf, the rdf:type owl:Restriction, and the two
// resource references) = 72.
//
// SAME TREATMENT AS editHistory, and for the same reasons: the record is ANONYMOUS in the
// source, so identity is DERIVED from the owner plus file position and is reproducible from
// the source alone; and `sequence` is FILE position so a re-emission reproduces the document
// rather than a tidier one. C200402 carries two of these, which is why order is recorded at
// all rather than assumed unique.
//
// Note the interaction with parentRef above: extractClass takes the first subClassOf carrying
// an rdf:resource, and a restriction's subClassOf carries none, so the two readings do not
// contend for the same element.
const extractRestrictions = (element) => {
	const subClassOfBlocks = element['rdfs:subClassOf'];
	if (!subClassOfBlocks || !subClassOfBlocks.length) {
		return undefined;
	}
	const restrictions = [];
	subClassOfBlocks.forEach((oneBlock) => {
		if (!oneBlock || typeof oneBlock !== 'object') {
			return;
		}
		(oneBlock['owl:Restriction'] || []).forEach((oneRestriction) => {
			if (!oneRestriction || typeof oneRestriction !== 'object') {
				return;
			}
			const onProperty = getResourceRefs(oneRestriction, 'owl:onProperty')[0];
			const allValuesFrom = getResourceRefs(oneRestriction, 'owl:allValuesFrom')[0];
			if (!onProperty && !allValuesFrom) {
				return;
			}
			const record = { sequence: restrictions.length };
			if (onProperty) {
				record.onProperty = onProperty;
			}
			if (allValuesFrom) {
				record.allValuesFrom = allValuesFrom;
			}
			restrictions.push(record);
		});
	});
	return restrictions.length ? restrictions : undefined;
};

const extractBaseProperties = (element, faults) => {
	const uri = getAttr(element, 'rdf:about');
	return {
		cedsId: getText(element, 'dc:identifier'),
		label: getText(element, 'rdfs:label'),
		description: getText(element, 'dc:description'),
		notation: getText(element, 'skos:notation'),
		uri,
		// THE OPEN LIST, under its own key rather than spread into the base.
		// Keeping it named means the forge spreads `rawEntity.annotations` explicitly -- one
		// grep finds both ends of the flow -- instead of the forge having to compute "every
		// field that isn't one of the ones I already know about", which is a subtractive rule
		// that silently changes meaning every time either side gains a field.
		annotations: extractGenericAnnotations(element, faults),

		// The two nested structures, in FILE order. Both become NODES in the forge, never
		// properties -- see extractEditHistory above for why the order must not be tidied.
		editHistory: extractEditHistory(element),
		restrictions: extractRestrictions(element),
	};
};

const extractClass = (element, faults) => {
	const base = extractBaseProperties(element, faults);
	const subClassOf = element['rdfs:subClassOf'];
	let parentRef;
	if (subClassOf && subClassOf.length) {
		for (const sc of subClassOf) {
			if (typeof sc === 'object' && sc['$'] && sc['$']['rdf:resource']) {
				const ref = sc['$']['rdf:resource'];
				if (isCedsUri(ref)) {
					parentRef = ref;
					break;
				}
			}
		}
	}
	return { ...base, parentRef };
};

const extractProperty = (element, faults) => {
	const base = extractBaseProperties(element, faults);
	const allRangeRefs = getResourceRefs(element, 'schema:rangeIncludes');
	const domainRefs = getResourceRefs(element, 'schema:domainIncludes').filter(isCedsUri);
	const rangeRefs = allRangeRefs.filter(isCedsUri);
	const xsdRefs = allRangeRefs.filter((r) => r.startsWith(XSD_PREFIX));
	const dataType = xsdRefs.length > 0 ? xsdRefs[0].replace(XSD_PREFIX, '') : undefined;
	const textFormat = getText(element, 'textFormat');
	const maxLength = getText(element, 'maxLength');
	const result = { ...base, domainRefs, rangeRefs };
	if (dataType) {
		result.dataType = dataType;
	}
	if (textFormat) {
		result.textFormat = textFormat;
	}
	if (maxLength) {
		result.maxLength = maxLength;
	}
	return result;
};

const extractOptionValue = (element, faults) => {
	const base = extractBaseProperties(element, faults);
	const inSchemeRefs = getResourceRefs(element, 'skos:inScheme');
	const inSchemeRef = inSchemeRefs.length > 0 ? inSchemeRefs[0] : undefined;
	return { ...base, inSchemeRef };
};

// ============================================================
// Main reader — callback(err, { entities, maps, metadata })
// ============================================================

const parseCeds = ({ sourcePath, xLog }, callback) => {
	const log = (xLog && xLog.status) || (() => {});

	if (!fs.existsSync(sourcePath)) {
		callback(`CEDS RDF source not found: ${sourcePath}`);
		return;
	}

	let filePath = sourcePath;
	if (fs.statSync(sourcePath).isDirectory()) {
		// L15: sorted for cross-machine determinism; EXACTLY ONE candidate required — a stray
		// second source file would silently forge a different standard on another machine.
		const candidates = fs.readdirSync(sourcePath).filter((n) => n.endsWith('.rdf')).sort();
		if (!candidates.length) {
			callback(`No .rdf source file in ${sourcePath}`);
			return;
		}
		if (candidates.length > 1) {
			callback(
				`${candidates.length} candidate .rdf source files in ${sourcePath} (${candidates.join(', ')}) — expected exactly one; remove the extras.`,
			);
			return;
		}
		filePath = path.join(sourcePath, candidates[0]);
	}

	let xml;
	let readError = '';
	try {
		xml = fs.readFileSync(filePath, 'utf8');
	} catch (err) {
		readError = err.message;
	}
	if (readError) {
		callback(`Failed to read RDF file: ${readError}`);
		return;
	}

	log(`[forge-ceds/parser] parsing XML (${(xml.length / 1024 / 1024).toFixed(1)} MB)...`);

	xml2js.parseString(xml, (xmlErr, parsed) => {
		if (xmlErr) {
			callback(`XML parse failed: ${xmlErr.message}`);
			return;
		}

		const root = parsed['rdf:RDF'];
		if (!root) {
			callback('CEDS RDF: missing rdf:RDF root element');
			return;
		}

		const ontologyElements = root['owl:Ontology'] || [];
		const version =
			ontologyElements.length > 0
				? getText(ontologyElements[0], 'owl:versionInfo') || 'unknown'
				: 'unknown';

		log(`[forge-ceds/parser] ontology version: ${version}`);

		const rdfsClasses = (root['rdfs:Class'] || []).filter((el) =>
			isCedsUri(getAttr(el, 'rdf:about')),
		);
		const owlClasses = (root['owl:Class'] || []).filter((el) =>
			isCedsUri(getAttr(el, 'rdf:about')),
		);
		const rdfProperties = (root['rdf:Property'] || []).filter((el) =>
			isCedsUri(getAttr(el, 'rdf:about')),
		);
		const namedIndividuals = (root['owl:NamedIndividual'] || []).filter((el) =>
			isCedsUri(getAttr(el, 'rdf:about')),
		);

		// Collected across every entity, then REFUSED on rather than logged past. A local-name
		// collision means one predicate's statements vanish while the entity still looks
		// perfectly healthy, which is the hardest class of loss to notice later.
		const annotationFaults = [];

		const rawClasses = [];
		const rawOptionSets = [];
		[...rdfsClasses, ...owlClasses].forEach((el) => {
			if (hasConceptSchemeType(el)) {
				rawOptionSets.push(extractClass(el, annotationFaults));
			} else {
				rawClasses.push(extractClass(el, annotationFaults));
			}
		});

		const rawProperties = rdfProperties.map((el) => extractProperty(el, annotationFaults));
		const rawOptionValues = namedIndividuals.map((el) => extractOptionValue(el, annotationFaults));

		if (annotationFaults.length) {
			callback(
				`CEDS parser REFUSED: ${annotationFaults.length} annotation naming fault(s). ` +
					`Forging past these would silently drop statements. ` +
					annotationFaults.slice(0, 5).join(' | '),
			);
			return;
		}

		// keep only entities with a native dc:identifier anchor (trackA discipline)
		const classes = rawClasses.filter((c) => c.cedsId);
		const properties = rawProperties.filter((p) => p.cedsId);
		const optionSets = rawOptionSets.filter((os) => os.cedsId);
		const optionValues = rawOptionValues.filter((ov) => ov.cedsId);

		const skipped =
			rawClasses.length -
			classes.length +
			(rawProperties.length - properties.length) +
			(rawOptionSets.length - optionSets.length) +
			(rawOptionValues.length - optionValues.length);

		log(
			`[forge-ceds/parser] entities — classes=${classes.length}, properties=${properties.length}, optionSets=${optionSets.length}, optionValues=${optionValues.length}, skipped(no dc:identifier)=${skipped}`,
		);

		// URI -> entity lookups (used by forgeCeds.js to resolve ownership edges by stableId/uri)
		const classByUri = {};
		classes.forEach((c) => {
			if (c.uri) {
				classByUri[c.uri] = c;
			}
		});
		const optionSetByUri = {};
		optionSets.forEach((os) => {
			if (os.uri) {
				optionSetByUri[os.uri] = os;
			}
		});

		callback('', {
			entities: { classes, properties, optionSets, optionValues },
			maps: { classByUri, optionSetByUri },
			metadata: {
				version,
				// versionSource (2026-07-04, going-forward): 'spec' ONLY when owl:versionInfo was read
				// from the ontology; the 'unknown' path stamps nothing.
				...(version !== 'unknown' ? { versionSource: 'spec' } : {}),
				sourceFormat: 'rdf-xml',
				sourceFiles: [path.basename(filePath)],
				sourceUrl: CEDS_URI_PREFIX,
				classCount: classes.length,
				propertyCount: properties.length,
				optionSetCount: optionSets.length,
				optionValueCount: optionValues.length,
				skipped,
			},
		});
	});
};

module.exports = {
	parseCeds,
	CEDS_URI_PREFIX,
	// exported for the forge module's reuse
	isCedsUri,
};
