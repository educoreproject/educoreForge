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

const extractBaseProperties = (element) => {
	const uri = getAttr(element, 'rdf:about');
	return {
		cedsId: getText(element, 'dc:identifier'),
		label: getText(element, 'rdfs:label'),
		description: getText(element, 'dc:description'),
		notation: getText(element, 'skos:notation'),
		uri,
	};
};

const extractClass = (element) => {
	const base = extractBaseProperties(element);
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

const extractProperty = (element) => {
	const base = extractBaseProperties(element);
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

const extractOptionValue = (element) => {
	const base = extractBaseProperties(element);
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

		const rawClasses = [];
		const rawOptionSets = [];
		[...rdfsClasses, ...owlClasses].forEach((el) => {
			if (hasConceptSchemeType(el)) {
				rawOptionSets.push(extractClass(el));
			} else {
				rawClasses.push(extractClass(el));
			}
		});

		const rawProperties = rdfProperties.map(extractProperty);
		const rawOptionValues = namedIndividuals.map(extractOptionValue);

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
