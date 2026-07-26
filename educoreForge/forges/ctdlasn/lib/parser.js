'use strict';

// parser.js — CTDL-ASN JSON-LD schema reader (Credential Transparency Description Language —
// Achievement Standards Network). Clone-and-adapt of forge-ctdl/lib/parser.js.
//
// The JSON-LD navigation is the forge-ctdl contract: read `@graph`, categorize by `@type`, pull
// rdfs:label / dct:description / schema:domainIncludes / schema:rangeIncludes / rdfs:subClassOf /
// skos:inScheme. Output is the SAME native node shape forge-ceds / forge-edfi / forge-ctdl emit:
//   { id, label, superLabel, properties, edges, _parentEdge? }
// where `label` is the native per-standard label and `edges`/`_parentEdge` carry NATIVE edge types
// that the forge translates to the canonical contract.
//
// Source: ctdlasn.json (JSON-LD, PLAIN encoding from https://credreg.net/ctdlasn/schema/encoding/json).
//   @graph entries by @type: rdfs:Class (11), rdf:Property (101), skos:ConceptScheme (2),
//   skos:Concept (8). @ids are CURIEs (e.g. ceasn:competencyText), globally unique.
//
// TWO DELIBERATE DIVERGENCES FROM forge-ctdl (WORKORDER Phase 1, Decision 1 + never-fabricate):
//
//   1. FILTER-AND-REFERENCE cross-standard terms (Decision 1, generalized per FADED_FORGE ruling
//      2026-07-15). Two registries govern this (not switches): NATIVE_NAMESPACES (emitted as nodes)
//      and CROSS_STANDARD_SYSTEM_BY_PREFIX (referenced, never emitted). A native ASN term that
//      references a cross-standard term stashes a `{system, id, raw, locator}` crossRef on the
//      referencing native node (property `_crossRefs`) instead of dropping the reference — so the
//      additive bridge phase (3.5) can bridge BOTH standards. The system label is keyed by the target
//      standard: `ceterms:*` -> system 'ctdl' (the 4 terms ASN redefines; NOT emitted); `qdata:*` ->
//      system 'qdata' (ASN properties whose domain/range is a QData class). The forge merges those
//      into the node's `crossRefs` JSON — mirroring exactly how forge-ctdl stamps CEDS anchors (a node
//      property, NO cross-standard node, NO cross-standard edge; STANDARD-PURE). Datatype endpoints
//      (xsd:*, schema:*, rdf:langString) are NOT standard references and are dropped; a same-standard
//      reference to an undefined native term is also dropped, exactly as forge-ctdl drops a
//      not-in-graph endpoint today.
//
//   2. NEVER FABRICATE status. forge-ctdl defaulted an absent `vs:term_status` to 'stable'
//      (parser.js:67-73). That default is STRUCK: when the source is silent, status is left honestly
//      empty (the forge does not stamp an empty status). CTDL-ASN in fact supplies vs:term_status on
//      every term, so the honest carry is a real value — but a hypothetical silent term stays empty,
//      never invented. Descriptions / usageNote follow the same honest-empty rule.
//
// The parser NEVER touches Neo4j or embeddings. Pure read + reshape; errors via callback.

const fs = require('fs');
const path = require('path');

// ============================================================
// namespace registries (Decision 1) — NOT switches
// ============================================================

// native ASN namespaces: their terms ARE emitted as nodes.
const NATIVE_NAMESPACES = new Set(['ceasn', 'asn', 'evalCat', 'publicationStatus', 'skos']);

// CROSS-STANDARD reference registry (WORKORDER Decision 1, GENERALIZED per FADED_FORGE ruling
// 2026-07-15). A native ASN term that references a term in one of these namespaces stashes a
// {system, id, raw, locator} crossRef — never dropped (never-silently-lose), never re-emitted as a
// node (standard-pure) — so the additive bridge phase (3.5) has the raw material to bridge BOTH
// standards. Registry, not switch. Maps the endpoint CURIE's prefix to the crossRef `system` label:
//   ceterms -> 'ctdl'  (the 4 ceterms:* terms ASN redefines; bridges to CTDL's own ceterms nodes)
//   qdata   -> 'qdata' (ASN properties whose domain/range is a QData class; bridges to CTDL-QData)
// Datatype endpoints (xsd:*, schema:*, rdf:*) are NOT standard references — they are dropped. A
// same-standard reference to an undefined native term (e.g. an @id the graph does not carry) is also
// dropped, exactly as forge-ctdl drops a not-in-graph endpoint.
const CROSS_STANDARD_SYSTEM_BY_PREFIX = {
	ceterms: 'ctdl',
	qdata: 'qdata',
};

const prefixOf = (curie) => `${curie}`.split(':')[0];
const isNativeId = (id) => NATIVE_NAMESPACES.has(prefixOf(id));
const crossStandardSystemFor = (id) => CROSS_STANDARD_SYSTEM_BY_PREFIX[prefixOf(id)] || null;

// ============================================================
// language-map + array helpers (harvested from forge-ctdl)
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

// description preference: dct:description, then rdfs:comment, then skos:definition (concepts). Honest-
// empty ('') when the source supplies none — NEVER fabricated.
const getDescription = (entry) =>
	pickLang(entry['dct:description']) ||
	pickLang(entry['rdfs:comment']) ||
	pickLang(entry['skos:definition']);

// getStatus — carry the source's vs:term_status (stripped of the vs: prefix). NEVER-FABRICATE: when
// the source is silent, return '' (honest-empty). The forge-ctdl 'stable' default is deliberately
// STRUCK (WORKORDER open item #4, resolved by TQ).
const getStatus = (entry) => {
	const status = entry['vs:term_status'];
	if (typeof status === 'string') {
		return status.replace(/^vs:/, '');
	}
	return '';
};

// localName — the part of a CURIE after the prefix (for fallback display names + paths).
const localName = (curie) => `${curie}`.split(':').pop().split('#').pop();

// stashCrossRef — record a {system, id, raw, locator} reference to a cross-standard term (a filtered
// ceterms term, or a QData class) on the referencing native node's properties (Decision 1). Mirrors
// forge-ctdl's CEDS crossRef shape; NO cross-standard node and NO cross-standard edge is emitted.
const stashCrossRef = (properties, endpointId, locator, system) => {
	properties._crossRefs = properties._crossRefs || [];
	properties._crossRefs.push({
		system,
		id: `${endpointId}`,
		raw: `${endpointId}`,
		locator,
	});
};

// ============================================================
// Main parser — graphForge native-node parser contract.
//   callback(err, { nodes, metadata }). nodes[].label is the native CTDL-ASN label; the forge maps it.
// ============================================================

const parseCtdlasn = ({ sourcePath, xLog } = {}, callback) => {
	const log = xLog && xLog.status ? xLog.status : () => {};

	if (!sourcePath || !fs.existsSync(sourcePath)) {
		callback(`forge-ctdlasn parser: source not found: ${sourcePath}`);
		return;
	}

	// the parser accepts the version DIRECTORY (resolves ctdlasn.json inside) OR the file itself.
	const stat = fs.statSync(sourcePath);
	const jsonPath = stat.isDirectory() ? path.join(sourcePath, 'ctdlasn.json') : sourcePath;

	if (!fs.existsSync(jsonPath)) {
		callback(`forge-ctdlasn parser: CTDL-ASN JSON-LD schema not found: ${jsonPath}`);
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
		callback(`forge-ctdlasn parser: JSON parse failed (${jsonPath}): ${readError}`);
		return;
	}

	const graph = schema['@graph'] || [];
	log(`[forge-ctdlasn] @graph entries: ${graph.length}`);

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

	// ---- FILTER emission to native namespaces; count the filtered CTDL-overlap terms (Decision 1) ----
	const isEmittable = (entry) => isNativeId(entry['@id']);
	let filteredCetermsCount = 0;
	let filteredUnknownCount = 0;
	const countFiltered = (entry) => {
		if (crossStandardSystemFor(entry['@id']) === 'ctdl') {
			// a ceterms:* @graph entry (the CTDL overlap terms ASN redefines) — filtered, not emitted.
			filteredCetermsCount++;
		} else {
			// an @type-matched term whose prefix is not native and not a filtered ceterms term: out of
			// scope for emission (ASN's @graph carries none of these, so this stays 0).
			filteredUnknownCount++;
			log(`[forge-ctdlasn] filtered non-native, non-ceterms @graph term: ${entry['@id']}`);
		}
	};
	const partitionEmit = (entries) => {
		const emit = [];
		entries.forEach((entry) => {
			if (isEmittable(entry)) {
				emit.push(entry);
			} else {
				countFiltered(entry);
			}
		});
		return emit;
	};

	const nativeClasses = partitionEmit(typeBucket['rdfs:Class']);
	const nativeProperties = partitionEmit(typeBucket['rdf:Property']);
	const nativeSchemes = partitionEmit(typeBucket['skos:ConceptScheme']);
	const nativeConcepts = partitionEmit(typeBucket['skos:Concept']);

	// ---- membership sets: EMITTED native ids only, so an edge endpoint resolves to a node that exists.
	const classIds = new Set(nativeClasses.map((e) => e['@id']));
	const schemeIds = new Set(nativeSchemes.map((e) => e['@id']));

	const nodes = [];
	let crossRefCount = 0; // total cross-standard crossRefs stashed (ceterms + qdata, all locators)
	let danglingTargetSchemeCount = 0; // meta:targetScheme refs that resolve to neither a native scheme nor a cross-standard term

	// ---- ROOT (native CtdlasnRoot) ----
	nodes.push({
		id: 'ctdlasn:root',
		label: 'CtdlasnRoot',
		superLabel: 'CtdlasnModel',
		properties: {
			name: 'CTDLASN',
			description: `Credential Transparency Description Language — Achievement Standards Network (Credential Engine) — ${nativeClasses.length} classes, ${nativeProperties.length} properties, ${nativeSchemes.length} concept schemes, ${nativeConcepts.length} concepts.`,
			classCount: nativeClasses.length,
			propertyCount: nativeProperties.length,
			conceptSchemeCount: nativeSchemes.length,
			conceptCount: nativeConcepts.length,
		},
		edges: [],
	});

	// ---- CtdlasnClass nodes (rdfs:Class -> DmeClass) ----
	nativeClasses.forEach((cls) => {
		const id = cls['@id'];
		const edges = [];
		const properties = {
			name: getLabel(cls) || localName(id),
			description: getDescription(cls),
			uri: id,
			status: getStatus(cls),
		};
		// SUBCLASS_OF -> a native parent class in the graph; a cross-standard parent -> crossRef; else drop.
		toArray(cls['rdfs:subClassOf']).forEach((parentId) => {
			if (classIds.has(parentId)) {
				edges.push({ type: 'SUBCLASS_OF', targetId: parentId, targetLabel: 'CtdlasnClass' });
			} else {
				const system = crossStandardSystemFor(parentId);
				if (system) {
					stashCrossRef(properties, parentId, 'rdfs:subClassOf', system);
					crossRefCount++;
				}
			}
		});
		nodes.push({ id, label: 'CtdlasnClass', superLabel: 'CtdlasnModel', properties, edges });
	});

	// ---- CtdlasnProperty nodes (rdf:Property -> DmeProperty) ----
	nativeProperties.forEach((prop) => {
		const id = prop['@id'];
		const edges = [];

		// owning class(es): schema:domainIncludes pointing at a NATIVE class. FIRST resolvable = the
		// structural parent (HAS_PROPERTY); additional native domains become extra HAS_PROPERTY edges.
		const domainClassIds = toArray(prop['schema:domainIncludes']).filter((d) => classIds.has(d));

		const properties = {
			name: getLabel(prop) || localName(id),
			description: getDescription(prop),
			uri: id,
			status: getStatus(prop),
			usageNote: pickLang(prop['vann:usageNote']),
			domainCount: domainClassIds.length,
		};

		// a cross-standard domain (ceterms or qdata) -> crossRef (a native property whose ONLY domain is
		// cross-standard stays root-anchored: no _parentEdge is set below, so the forge parents it to
		// the root and the cross-standard domain survives as a crossRef).
		toArray(prop['schema:domainIncludes']).forEach((d) => {
			const system = crossStandardSystemFor(d);
			if (system) {
				stashCrossRef(properties, d, 'schema:domainIncludes', system);
				crossRefCount++;
			}
		});

		// option-set constraint: meta:targetScheme -> a native concept scheme -> HAS_OPTION_SET; a
		// cross-standard scheme -> crossRef; anything else unresolvable -> counted (never silently lost).
		toArray(prop['meta:targetScheme']).forEach((schemeRef) => {
			if (schemeIds.has(schemeRef)) {
				edges.push({
					type: 'CONSTRAINED_BY',
					targetId: schemeRef,
					targetLabel: 'CtdlasnConceptScheme',
				});
			} else {
				const system = crossStandardSystemFor(schemeRef);
				if (system) {
					stashCrossRef(properties, schemeRef, 'meta:targetScheme', system);
					crossRefCount++;
				} else {
					danglingTargetSchemeCount++;
				}
			}
		});

		// class reference(s): schema:rangeIncludes -> a native class -> REFERENCES; a cross-standard
		// class (ceterms or qdata) -> crossRef; datatypes (xsd:*, schema:*, rdf:langString) -> drop.
		toArray(prop['schema:rangeIncludes']).forEach((rangeRef) => {
			if (classIds.has(rangeRef)) {
				edges.push({ type: 'REFERENCES', targetId: rangeRef, targetLabel: 'CtdlasnClass' });
			} else {
				const system = crossStandardSystemFor(rangeRef);
				if (system) {
					stashCrossRef(properties, rangeRef, 'schema:rangeIncludes', system);
					crossRefCount++;
				}
			}
		});

		const node = {
			id,
			label: 'CtdlasnProperty',
			superLabel: 'CtdlasnModel',
			properties,
			edges,
			_owningClassIds: domainClassIds,
		};
		if (domainClassIds.length > 0) {
			node._parentEdge = {
				type: 'HAS_FIELD',
				fromId: domainClassIds[0],
				fromLabel: 'CtdlasnClass',
			};
		}
		nodes.push(node);
	});

	// ---- CtdlasnConceptScheme nodes (skos:ConceptScheme -> DmeOptionSet) ----
	nativeSchemes.forEach((scheme) => {
		const id = scheme['@id'];
		nodes.push({
			id,
			label: 'CtdlasnConceptScheme',
			superLabel: 'CtdlasnModel',
			properties: {
				name: getLabel(scheme) || localName(id),
				description: getDescription(scheme),
				uri: id,
			},
			edges: [],
		});
	});

	// ---- CtdlasnConcept nodes (skos:Concept -> DmeOptionValue) ----
	nativeConcepts.forEach((concept) => {
		const id = concept['@id'];
		const edges = [];
		const properties = {
			name: getLabel(concept) || localName(id),
			description: getDescription(concept),
			uri: id,
			status: getStatus(concept),
		};

		// owning scheme via skos:inScheme (the authoritative per-concept membership); a cross-standard
		// scheme -> crossRef; a native scheme -> HAS_VALUE parent.
		const owningSchemeId = toArray(concept['skos:inScheme']).find((s) => schemeIds.has(s));
		toArray(concept['skos:inScheme']).forEach((s) => {
			const system = crossStandardSystemFor(s);
			if (system) {
				stashCrossRef(properties, s, 'skos:inScheme', system);
				crossRefCount++;
			}
		});

		const node = {
			id,
			label: 'CtdlasnConcept',
			superLabel: 'CtdlasnModel',
			properties,
			edges,
		};
		if (owningSchemeId) {
			node._parentEdge = {
				type: 'HAS_VALUE',
				fromId: owningSchemeId,
				fromLabel: 'CtdlasnConceptScheme',
			};
		}
		nodes.push(node);
	});

	const crossRefNodeCount = nodes.filter(
		(n) => Array.isArray(n.properties._crossRefs) && n.properties._crossRefs.length,
	).length;
	// per-system crossRef tally (ctdl + qdata) — keyed by target standard for the bridge phase.
	const crossRefBySystem = {};
	nodes.forEach((n) => {
		(n.properties._crossRefs || []).forEach((cr) => {
			crossRefBySystem[cr.system] = (crossRefBySystem[cr.system] || 0) + 1;
		});
	});

	log(
		`[forge-ctdlasn] parsed: classes ${nativeClasses.length}, properties ${nativeProperties.length}, ` +
			`concept schemes ${nativeSchemes.length}, concepts ${nativeConcepts.length}; ` +
			`ceterms filtered (not emitted) ${filteredCetermsCount}; other filtered ${filteredUnknownCount}; ` +
			`cross-standard crossRefs ${crossRefCount} on ${crossRefNodeCount} nodes ` +
			`(${JSON.stringify(crossRefBySystem)}); ` +
			`dangling targetScheme refs ${danglingTargetSchemeCount}`,
	);

	callback('', {
		nodes,
		metadata: {
			version: 'Release 20230929',
			sourceFormat: 'json-ld',
			sourceFiles: [path.basename(jsonPath)],
			sourceUrl: 'https://credreg.net/ctdlasn/schema/encoding/json',
			classCount: nativeClasses.length,
			propertyCount: nativeProperties.length,
			conceptSchemeCount: nativeSchemes.length,
			conceptCount: nativeConcepts.length,
			crossRefCount,
			crossRefNodeCount,
			crossRefBySystem,
			filteredCetermsCount,
			filteredUnknownCount,
			danglingTargetSchemeCount,
		},
	});
};

module.exports = parseCtdlasn;
module.exports.parseCtdlasn = parseCtdlasn;
