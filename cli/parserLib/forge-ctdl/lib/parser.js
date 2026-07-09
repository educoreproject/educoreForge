'use strict';

// parser.js — CTDL JSON-LD schema reader (Credential Transparency Description Language).
//
// HARVESTED+ADAPTED from the OLD forge-ctdl/lib/parser.js: the JSON-LD navigation is reused (read
// `@graph`, categorize by `@type`, pull rdfs:label / dct:description / schema:domainIncludes /
// schema:rangeIncludes / rdfs:subClassOf / skos:inScheme). The OLD output contract (private Ctdl*
// nodes with PART_OF/CONSTRAINED_BY/HAS_CONCEPT_SCHEME edges and a hand-rolled searchText) is NOT
// copied — this parser RE-SHAPES output to the SAME native node shape forge-ceds / forge-edfi emit:
//   { id, label, superLabel, properties, edges, _parentEdge? }
// where `label` is the native per-standard label and `edges`/`_parentEdge` carry NATIVE edge types
// that the forge translates to the canonical contract.
//
// Source: ctdl-schema.json (JSON-LD from https://credreg.net/ctdl/schema/encoding/json).
//   @graph entries by @type: rdfs:Class (138), rdf:Property (396), skos:ConceptScheme (34),
//   skos:Concept (445). @ids are CURIEs (e.g. ceterms:AcademicCertificate), globally unique.
//
// CTDL-SPECIFIC navigation facts (verified against the real source, CODE FACT):
//   * concepts carry skos:prefLabel / skos:definition (NOT rdfs:label / rdfs:comment).
//   * a property attaches to its owning class(es) via schema:domainIncludes (382 props).
//   * a property's option-set (concept-scheme) constraint is meta:targetScheme (45 props;
//     schema:rangeIncludes points at concept schemes ZERO times in this source).
//   * a property's class reference(s) are schema:rangeIncludes pointing at a class (213 props).
//   * a concept's owning scheme is skos:inScheme (445/445 resolvable — the reliable membership path;
//     meta:hasConcept on the scheme agrees 445/445 but inScheme is per-concept and authoritative).
//   * a class's parent(s) are rdfs:subClassOf (84 resolvable).
//   * 26 skos:Concepts carry a CEDS anchor in owl:equivalentClass (BRIDGE stash, no edge).
//
// The parser NEVER touches Neo4j or embeddings. Pure read + reshape; errors via callback.

const fs = require('fs');
const path = require('path');

// ============================================================
// language-map + array helpers (harvested from the old parser)
// ============================================================

const pickLang = (value) => {
	if (!value) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'object') {
		return value['en-US'] || value['en'] || Object.values(value)[0] || '';
	}
	return '';
};

const toArray = (value) => {
	if (!value) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
};

// rdfs:Class / rdf:Property / skos:ConceptScheme use rdfs:label; skos:Concept uses skos:prefLabel.
const getLabel = (entry) => pickLang(entry['rdfs:label']) || pickLang(entry['skos:prefLabel']);

// description preference: dct:description, then rdfs:comment, then skos:definition (concepts).
const getDescription = (entry) =>
	pickLang(entry['dct:description']) ||
	pickLang(entry['rdfs:comment']) ||
	pickLang(entry['skos:definition']);

const getStatus = (entry) => {
	const status = entry['vs:term_status'];
	if (typeof status === 'string') {
		return status.replace(/^vs:/, '');
	}
	return 'stable';
};

// localName — the part of a CURIE after the prefix (for fallback display names + paths).
const localName = (curie) => `${curie}`.split(':').pop().split('#').pop();

// ============================================================
// Main parser — graphForge native-node parser contract.
//   callback(err, { nodes, metadata }). nodes[].label is the native CTDL label; the forge maps it.
// ============================================================

const parseCtdl = ({ sourcePath, xLog } = {}, callback) => {
	const log = xLog && xLog.status ? xLog.status : () => {};

	if (!sourcePath || !fs.existsSync(sourcePath)) {
		callback(`forge-ctdl parser: source not found: ${sourcePath}`);
		return;
	}

	// the parser accepts the version DIRECTORY (resolves ctdl-schema.json inside) OR the file itself.
	const stat = fs.statSync(sourcePath);
	const jsonPath = stat.isDirectory()
		? path.join(sourcePath, 'ctdl-schema.json')
		: sourcePath;

	if (!fs.existsSync(jsonPath)) {
		callback(`forge-ctdl parser: CTDL JSON-LD schema not found: ${jsonPath}`);
		return;
	}

	let schema;
	let readError = '';
	try {
		schema = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
	} catch (err) {
		readError = err.message;
	}
	if (readError) {
		callback(`forge-ctdl parser: JSON parse failed (${jsonPath}): ${readError}`);
		return;
	}

	const graph = schema['@graph'] || [];
	log(`[forge-ctdl] @graph entries: ${graph.length}`);

	// ---- categorize by @type (registry, not switch) ----
	const typeBucket = {
		'rdfs:Class': [],
		'rdf:Property': [],
		'skos:ConceptScheme': [],
		'skos:Concept': [],
	};
	graph.forEach((entry) => {
		const type = entry['@type'];
		if (typeBucket[type]) {
			typeBucket[type].push(entry);
		}
	});

	const rawClasses = typeBucket['rdfs:Class'];
	const rawProperties = typeBucket['rdf:Property'];
	const rawSchemes = typeBucket['skos:ConceptScheme'];
	const rawConcepts = typeBucket['skos:Concept'];

	// ---- membership sets so edge endpoints can be resolved before emission ----
	const classIds = new Set(rawClasses.map((e) => e['@id']));
	const schemeIds = new Set(rawSchemes.map((e) => e['@id']));

	const nodes = [];
	let cedsCrossRefCount = 0;
	let danglingTargetSchemeCount = 0;

	// ---- ROOT (native CtdlRoot) ----
	nodes.push({
		id: 'ctdl:root',
		label: 'CtdlRoot',
		superLabel: 'CtdlModel',
		properties: {
			name: 'CTDL',
			description: `Credential Transparency Description Language (Credential Engine) — ${rawClasses.length} classes, ${rawProperties.length} properties, ${rawSchemes.length} concept schemes, ${rawConcepts.length} concepts.`,
			classCount: rawClasses.length,
			propertyCount: rawProperties.length,
			conceptSchemeCount: rawSchemes.length,
			conceptCount: rawConcepts.length,
		},
		edges: [],
	});

	// ---- CtdlClass nodes (rdfs:Class -> DmeClass) ----
	rawClasses.forEach((cls) => {
		const id = cls['@id'];
		const edges = [];
		// SUBCLASS_OF -> parent class(es) that exist in the graph.
		toArray(cls['rdfs:subClassOf']).forEach((parentId) => {
			if (classIds.has(parentId)) {
				edges.push({ type: 'SUBCLASS_OF', targetId: parentId, targetLabel: 'CtdlClass' });
			}
		});
		nodes.push({
			id,
			label: 'CtdlClass',
			superLabel: 'CtdlModel',
			properties: {
				name: getLabel(cls) || localName(id),
				description: getDescription(cls),
				uri: id,
				status: getStatus(cls),
			},
			edges,
		});
	});

	// ---- CtdlProperty nodes (rdf:Property -> DmeProperty) ----
	rawProperties.forEach((prop) => {
		const id = prop['@id'];
		const edges = [];

		// owning class(es): schema:domainIncludes pointing at a class. The FIRST resolvable domain is
		// the structural parent (HAS_PROPERTY); additional domains become extra HAS_PROPERTY edges so a
		// shared property is reachable from every owning class.
		const domainClassIds = toArray(prop['schema:domainIncludes']).filter((d) => classIds.has(d));

		// option-set constraint: meta:targetScheme pointing at a concept scheme -> HAS_OPTION_SET.
		toArray(prop['meta:targetScheme']).forEach((schemeRef) => {
			if (schemeIds.has(schemeRef)) {
				edges.push({
					type: 'CONSTRAINED_BY',
					targetId: schemeRef,
					targetLabel: 'CtdlConceptScheme',
				});
			} else {
				danglingTargetSchemeCount++;
			}
		});

		// class reference(s): schema:rangeIncludes pointing at a class (not a scheme) -> REFERENCES.
		toArray(prop['schema:rangeIncludes']).forEach((rangeRef) => {
			if (classIds.has(rangeRef)) {
				edges.push({ type: 'REFERENCES', targetId: rangeRef, targetLabel: 'CtdlClass' });
			}
		});

		const properties = {
			name: getLabel(prop) || localName(id),
			description: getDescription(prop),
			uri: id,
			status: getStatus(prop),
			usageNote: pickLang(prop['vann:usageNote']),
			domainCount: domainClassIds.length,
		};

		// the structural owning class (first resolvable domain) lets the forge set parentId; the rest
		// are carried so the forge can emit additional HAS_PROPERTY edges.
		const node = {
			id,
			label: 'CtdlProperty',
			superLabel: 'CtdlModel',
			properties,
			edges,
			_owningClassIds: domainClassIds,
		};
		if (domainClassIds.length > 0) {
			node._parentEdge = {
				type: 'HAS_FIELD',
				fromId: domainClassIds[0],
				fromLabel: 'CtdlClass',
			};
		}
		nodes.push(node);
	});

	// ---- CtdlConceptScheme nodes (skos:ConceptScheme -> DmeOptionSet) ----
	rawSchemes.forEach((scheme) => {
		const id = scheme['@id'];
		nodes.push({
			id,
			label: 'CtdlConceptScheme',
			superLabel: 'CtdlModel',
			properties: {
				name: getLabel(scheme) || localName(id),
				description: getDescription(scheme),
				uri: id,
			},
			edges: [],
		});
	});

	// ---- CtdlConcept nodes (skos:Concept -> DmeOptionValue) ----
	rawConcepts.forEach((concept) => {
		const id = concept['@id'];
		const edges = [];

		// owning scheme via skos:inScheme (the authoritative per-concept membership; 445/445).
		const owningSchemeId = toArray(concept['skos:inScheme']).find((s) => schemeIds.has(s));

		const properties = {
			name: getLabel(concept) || localName(id),
			description: getDescription(concept),
			uri: id,
			status: getStatus(concept),
		};

		// CEDS cross-ref (BRIDGE stash, no edge): owl:equivalentClass values mentioning ceds.
		const cedsAnchors = toArray(concept['owl:equivalentClass']).filter(
			(v) => typeof v === 'string' && v.toLowerCase().includes('ceds'),
		);
		if (cedsAnchors.length > 0) {
			properties._cedsAnchors = cedsAnchors;
			cedsCrossRefCount += cedsAnchors.length;
		}

		const node = {
			id,
			label: 'CtdlConcept',
			superLabel: 'CtdlModel',
			properties,
			edges,
		};
		if (owningSchemeId) {
			node._parentEdge = {
				type: 'HAS_VALUE',
				fromId: owningSchemeId,
				fromLabel: 'CtdlConceptScheme',
			};
		}
		nodes.push(node);
	});

	log(
		`[forge-ctdl] parsed: classes ${rawClasses.length}, properties ${rawProperties.length}, ` +
			`concept schemes ${rawSchemes.length}, concepts ${rawConcepts.length}; ` +
			`CEDS cross-refs ${cedsCrossRefCount}; dangling targetScheme refs ${danglingTargetSchemeCount}`,
	);

	callback('', {
		nodes,
		metadata: {
			version: 'Release 20260327',
			sourceFormat: 'json-ld',
			sourceFiles: [path.basename(jsonPath)],
			sourceUrl: 'https://credreg.net/ctdl/schema/encoding/json',
			classCount: rawClasses.length,
			propertyCount: rawProperties.length,
			conceptSchemeCount: rawSchemes.length,
			conceptCount: rawConcepts.length,
			cedsCrossRefCount,
			danglingTargetSchemeCount,
		},
	});
};

module.exports = parseCtdl;
module.exports.parseCtdl = parseCtdl;
