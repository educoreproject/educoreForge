'use strict';

// parser.js — CTDL JSON-LD schema reader (Credential Transparency Description Language).
//
// MODERNIZED to the filter-and-reference contract (ctdlModernization_071626, Phase 1). This is the
// SAME native node shape forge-ctdlasn / forge-ctdlqdata / forge-ceds / forge-edfi emit:
//   { id, label, superLabel, properties, edges, _parentEdge? }
// where `label` is the native per-standard label and `edges`/`_parentEdge` carry NATIVE edge types
// that the forge translates to the canonical contract. The JSON-LD navigation is unchanged from the
// original forge-ctdl (read `@graph`, categorize by `@type`, pull rdfs:label / dct:description /
// schema:domainIncludes / schema:rangeIncludes / rdfs:subClassOf / meta:targetScheme / skos:inScheme).
//
// Source: ctdl-schema.json (JSON-LD from https://credreg.net/ctdl/schema/encoding/json), CTDL
//   Release 20260327 (retrieved 2026-06-23). @graph entries by @type: rdfs:Class (138),
//   rdf:Property (396), skos:ConceptScheme (34), skos:Concept (445). @ids are CURIEs
//   (e.g. ceterms:AcademicCertificate), globally unique.
//
// THREE DELIBERATE DIVERGENCES FROM THE ORIGINAL forge-ctdl (WORKORDER Phase 1):
//
//   1. FILTER-AND-REFERENCE cross-standard terms (Decision 1, generalized per FADED_FORGE ruling
//      2026-07-15; mirrors forge-ctdlasn/forge-ctdlqdata). Two registries govern this (not switches):
//      NATIVE_NAMESPACES (emitted as nodes) and CROSS_STANDARD_SYSTEM_BY_PREFIX (referenced, never
//      emitted). A native CTDL term that references a cross-standard term stashes a
//      `{system, id, raw, locator}` crossRef on the referencing native node (property `_crossRefs`)
//      instead of drawing an edge to a foreign node — so the additive bridge phase can bridge BOTH
//      standards. Datatype / annotation / upper-ontology endpoints (xsd:*, rdf:*, rdfs:*, dct:*, the
//      generic skos:Concept meta-class, schema.org upper classes like schema:CreativeWork) are NOT
//      standard references and are dropped, exactly as the original forge-ctdl dropped a not-in-graph
//      endpoint. This ends the original's leak of ~20 foreign nodes (2 schema classes + 7 ceasn,
//      4 qdata, 6 schema, 1 owl:sameAs properties) into the graph.
//
//   2. NEVER FABRICATE status. The original forge-ctdl defaulted an absent `vs:term_status` to
//      'stable'. That default is STRUCK: when the source is silent, status is left honestly empty
//      (the forge does not stamp an empty status). CTDL supplies vs:term_status on every term today,
//      so the honest carry is a real value — but a hypothetical silent term stays empty, never
//      invented. Descriptions / usageNote follow the same honest-empty rule.
//
//   3. CEDS anchors preserved. CTDL carries a CEDS optionSet anchor on some skos:Concepts
//      (owl:equivalentClass values like `ceds:000113#Assistantships`). These stay stashed on the
//      referencing concept's `_cedsAnchors` (the forge promotes them to the cedsId + crossRefs node
//      properties, NO cross-standard edge; STANDARD-PURE) — behavior identical to the original.
//
// The parser NEVER touches Neo4j or embeddings. Pure read + reshape; errors via callback.

const fs = require('fs');
const path = require('path');

// ============================================================
// namespace registries (Decision 1) — NOT switches
// ============================================================
//
// LOCKED native core (FORK #1-A, FADED_FORGE ruling 2026-07-16): CTDL-native = `ceterms` (all
// classes, properties, and concept schemes) + the 34 controlled-vocabulary concept prefixes (every
// skos:Concept lives under one of these). This list is the auditable allowlist; anything filtered
// that is NOT a known cross-standard reference is LOGGED (never silently lost), so a future release
// adding a 35th vocab prefix surfaces loudly for review rather than vanishing.
const NATIVE_CORE_PREFIXES = [
	'ceterms',
	// the 34 controlled-vocab concept prefixes (skos:Concept), alphabetical:
	'accommodation',
	'actionStat',
	'agentSector',
	'agreementCat',
	'alignment',
	'array',
	'assessMethod',
	'assessUse',
	'audLevel',
	'audience',
	'claimType',
	'collectionCategory',
	'compare',
	'costType',
	'credentialStat',
	'creditUnit',
	'deliveryType',
	'financialAid',
	'inputType',
	'learnMethod',
	'lifeCycle',
	'logic',
	'lrEvidence',
	'lrMethod',
	'lrOutcome',
	'lrSource',
	'orgType',
	'residency',
	'scheduleFrequency',
	'scheduleTiming',
	'score',
	'serviceType',
	'statementCat',
	'support',
];

// ============================================================
// CROSS-STANDARD reference registries (FORK #1-C — FINAL, TQ ruled THREE standards 2026-07-16)
// ============================================================
//
// TQ ruled CTDL / CTDL-ASN / CTDL-QData are THREE distinct standards. The family boundary prefixes are
// therefore CROSS-STANDARD: filtered (never emitted as CTDL nodes), and every reference from a native
// CTDL term to one of them is stashed as a `{system, id, raw, locator}` crossRef keyed to the target
// standard — so the (held) structure-maker can later re-materialize CTDL's cross-standard structural
// edges with correct provenance. NATIVE_NAMESPACES stays the locked core (ceterms + 34 vocab); these
// prefixes are NOT added to it.
//
// Whole-namespace mappings (every term under the prefix bridges to one target standard):
//   ceasn / asn -> 'ctdlasn'  (CTDL-ASN terms CTDL references or restubs)
//   qdata       -> 'qdata'    (CTDL-QData terms CTDL references or restubs)
const CROSS_STANDARD_SYSTEM_BY_PREFIX = {
	ceasn: 'ctdlasn',
	asn: 'ctdlasn',
	qdata: 'qdata',
};

// PER-TERM cross-standard references (FORK #1-C — FINAL): `schema:` is NOT uniform. Only the two shared
// structural classes that CTDL-QData owns bridge to 'qdata'. Everything else under schema: has NO family
// owner and DROPS: schema:subjectOf (CTDL-declared but not in QData's native set — the "orphan") and the
// schema.org upper-ontology classes (schema:CreativeWork, schema:Person, schema:AlignmentObject,
// schema:StructuredValue, schema:EducationalOccupationalProgram, schema:Intangible). Per-term overrides
// take precedence over the prefix map; a schema: term absent here falls through to a drop.
const CROSS_STANDARD_SYSTEM_BY_TERM = {
	'schema:MonetaryAmount': 'qdata',
	'schema:QuantitativeValue': 'qdata',
};

const NATIVE_NAMESPACES = new Set(NATIVE_CORE_PREFIXES);

const prefixOf = (curie) => `${curie}`.split(':')[0];
const isNativeId = (id) => NATIVE_NAMESPACES.has(prefixOf(id));
// per-term override first (the schema: split), then whole-namespace prefix, then null (drop).
const crossStandardSystemFor = (id) =>
	CROSS_STANDARD_SYSTEM_BY_TERM[id] || CROSS_STANDARD_SYSTEM_BY_PREFIX[prefixOf(id)] || null;

// ============================================================
// language-map + array helpers (harvested from the original forge-ctdl)
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
// empty ('') when the source supplies none — NEVER fabricated. CTDL supplies a definition on every
// native term today, so this is a faithful carry, but a silent term stays empty.
const getDescription = (entry) =>
	pickLang(entry['dct:description']) ||
	pickLang(entry['rdfs:comment']) ||
	pickLang(entry['skos:definition']);

// getStatus — carry the source's vs:term_status (stripped of the vs: prefix). NEVER-FABRICATE: when
// the source is silent, return '' (honest-empty). The original forge-ctdl 'stable' default is
// deliberately STRUCK (WORKORDER Phase 1 divergence #2).
const getStatus = (entry) => {
	const status = entry['vs:term_status'];
	if (typeof status === 'string') {
		return status.replace(/^vs:/, '');
	}
	return '';
};

// localName — the part of a CURIE after the prefix (for fallback display names + paths).
const localName = (curie) => `${curie}`.split(':').pop().split('#').pop();

// stashCrossRef — record a {system, id, raw, locator} reference to a cross-standard term on the
// referencing native node's properties (Decision 1). Mirrors the CEDS crossRef shape; NO
// cross-standard node and NO cross-standard edge is emitted.
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
	const jsonPath = stat.isDirectory() ? path.join(sourcePath, 'ctdl-schema.json') : sourcePath;

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

	// ---- FILTER emission to native namespaces; account for every filtered term (Decision 1) ----
	// A filtered term is EITHER a known cross-standard term (counted by target system) OR an unknown
	// non-native term (LOGGED loudly so nothing is silently lost — this is how a future release's new
	// prefix surfaces for review).
	const isEmittable = (entry) => isNativeId(entry['@id']);
	let filteredCrossStandardCount = 0;
	let filteredUnknownCount = 0;
	const filteredCrossStandardBySystem = {};
	const countFiltered = (entry) => {
		const system = crossStandardSystemFor(entry['@id']);
		if (system) {
			filteredCrossStandardCount++;
			filteredCrossStandardBySystem[system] = (filteredCrossStandardBySystem[system] || 0) + 1;
		} else {
			filteredUnknownCount++;
			log(`[forge-ctdl] filtered non-native @graph term (no crossRef system): ${entry['@id']}`);
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
	let cedsCrossRefCount = 0; // CEDS anchors harvested (bridge stash on concepts)
	let crossRefCount = 0; // cross-standard crossRefs stashed (contested family; 0 until the ruling)
	let danglingTargetSchemeCount = 0; // meta:targetScheme refs resolving to neither native nor cross-standard

	// ---- ROOT (native CtdlRoot) ----
	nodes.push({
		id: 'ctdl:root',
		label: 'CtdlRoot',
		superLabel: 'CtdlModel',
		properties: {
			name: 'CTDL',
			description: `Credential Transparency Description Language (Credential Engine) — ${nativeClasses.length} classes, ${nativeProperties.length} properties, ${nativeSchemes.length} concept schemes, ${nativeConcepts.length} concepts.`,
			classCount: nativeClasses.length,
			propertyCount: nativeProperties.length,
			conceptSchemeCount: nativeSchemes.length,
			conceptCount: nativeConcepts.length,
		},
		edges: [],
	});

	// ---- CtdlClass nodes (rdfs:Class -> DmeClass) ----
	nativeClasses.forEach((cls) => {
		const id = cls['@id'];
		const edges = [];
		const properties = {
			name: getLabel(cls) || localName(id),
			description: getDescription(cls),
			uri: id,
			status: getStatus(cls),
		};
		// SUBCLASS_OF -> a native parent class in the graph; a cross-standard parent -> crossRef; else drop
		// (schema.org upper-ontology like schema:CreativeWork, dct:*, etc. have no crossRef system).
		toArray(cls['rdfs:subClassOf']).forEach((parentId) => {
			if (classIds.has(parentId)) {
				edges.push({ type: 'SUBCLASS_OF', targetId: parentId, targetLabel: 'CtdlClass' });
			} else {
				const system = crossStandardSystemFor(parentId);
				if (system) {
					stashCrossRef(properties, parentId, 'rdfs:subClassOf', system);
					crossRefCount++;
				}
			}
		});
		nodes.push({ id, label: 'CtdlClass', superLabel: 'CtdlModel', properties, edges });
	});

	// ---- CtdlProperty nodes (rdf:Property -> DmeProperty) ----
	nativeProperties.forEach((prop) => {
		const id = prop['@id'];
		const edges = [];

		// owning class(es): schema:domainIncludes pointing at a NATIVE class. FIRST resolvable = the
		// structural parent (HAS_FIELD); additional native domains become extra HAS_FIELD edges.
		const domainClassIds = toArray(prop['schema:domainIncludes']).filter((d) => classIds.has(d));

		const properties = {
			name: getLabel(prop) || localName(id),
			description: getDescription(prop),
			uri: id,
			status: getStatus(prop),
			usageNote: pickLang(prop['vann:usageNote']),
			domainCount: domainClassIds.length,
		};

		// a cross-standard domain (contested family) -> crossRef (a native property whose ONLY domain is
		// cross-standard stays root-anchored: no _parentEdge is set below, so the forge parents it to
		// the root and the cross-standard domain survives as a crossRef).
		toArray(prop['schema:domainIncludes']).forEach((d) => {
			if (classIds.has(d)) {
				return;
			}
			const system = crossStandardSystemFor(d);
			if (system) {
				stashCrossRef(properties, d, 'schema:domainIncludes', system);
				crossRefCount++;
			}
		});

		// option-set constraint: meta:targetScheme -> a native concept scheme -> CONSTRAINED_BY; a
		// cross-standard scheme -> crossRef; anything else unresolvable -> counted (never silently lost).
		toArray(prop['meta:targetScheme']).forEach((schemeRef) => {
			if (schemeIds.has(schemeRef)) {
				edges.push({
					type: 'CONSTRAINED_BY',
					targetId: schemeRef,
					targetLabel: 'CtdlConceptScheme',
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
		// class -> crossRef; datatypes/annotation (xsd:*, rdf:langString, generic skos:Concept,
		// schema.org upper classes) -> drop.
		toArray(prop['schema:rangeIncludes']).forEach((rangeRef) => {
			if (classIds.has(rangeRef)) {
				edges.push({ type: 'REFERENCES', targetId: rangeRef, targetLabel: 'CtdlClass' });
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
	nativeSchemes.forEach((scheme) => {
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
	nativeConcepts.forEach((concept) => {
		const id = concept['@id'];
		const edges = [];
		const properties = {
			name: getLabel(concept) || localName(id),
			description: getDescription(concept),
			uri: id,
			status: getStatus(concept),
		};

		// owning scheme via skos:inScheme (the authoritative per-concept membership; 445/445 native). A
		// cross-standard scheme -> crossRef; a native scheme -> HAS_VALUE parent.
		const owningSchemeId = toArray(concept['skos:inScheme']).find((s) => schemeIds.has(s));
		toArray(concept['skos:inScheme']).forEach((s) => {
			if (schemeIds.has(s)) {
				return;
			}
			const system = crossStandardSystemFor(s);
			if (system) {
				stashCrossRef(properties, s, 'skos:inScheme', system);
				crossRefCount++;
			}
		});

		// CEDS cross-ref (BRIDGE stash, no edge): owl:equivalentClass values mentioning ceds. Preserved
		// verbatim from the original forge-ctdl; the forge promotes these to cedsId + crossRefs.
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

	// per-system crossRef tally (contested family) — keyed by target standard for the bridge phase.
	const crossRefNodeCount = nodes.filter(
		(n) => Array.isArray(n.properties._crossRefs) && n.properties._crossRefs.length,
	).length;
	const crossRefBySystem = {};
	nodes.forEach((n) => {
		(n.properties._crossRefs || []).forEach((cr) => {
			crossRefBySystem[cr.system] = (crossRefBySystem[cr.system] || 0) + 1;
		});
	});

	log(
		`[forge-ctdl] parsed: classes ${nativeClasses.length}, properties ${nativeProperties.length}, ` +
			`concept schemes ${nativeSchemes.length}, concepts ${nativeConcepts.length}; ` +
			`CEDS anchors ${cedsCrossRefCount}; ` +
			`cross-standard crossRefs ${crossRefCount} on ${crossRefNodeCount} nodes ` +
			`(${JSON.stringify(crossRefBySystem)}); ` +
			`filtered cross-standard @graph terms ${filteredCrossStandardCount} ` +
			`(${JSON.stringify(filteredCrossStandardBySystem)}); ` +
			`filtered unknown @graph terms ${filteredUnknownCount}; ` +
			`dangling targetScheme refs ${danglingTargetSchemeCount}`,
	);

	callback('', {
		nodes,
		metadata: {
			version: 'Release 20260327',
			sourceFormat: 'json-ld',
			sourceFiles: [path.basename(jsonPath)],
			sourceUrl: 'https://credreg.net/ctdl/schema/encoding/json',
			classCount: nativeClasses.length,
			propertyCount: nativeProperties.length,
			conceptSchemeCount: nativeSchemes.length,
			conceptCount: nativeConcepts.length,
			cedsCrossRefCount,
			crossRefCount,
			crossRefNodeCount,
			crossRefBySystem,
			filteredCrossStandardCount,
			filteredCrossStandardBySystem,
			filteredUnknownCount,
			danglingTargetSchemeCount,
		},
	});
};

module.exports = parseCtdl;
module.exports.parseCtdl = parseCtdl;
