'use strict';

// vocabulary-definitions.js — the HUMAN DEFINITIONS for every term the vocabulary registry enumerates
// (Wave B self-documentation; PLAN-inGraphSelfDocumentationEnrichment-070126.md §4 readability bar:
// "every SchemaView term — and every self-doc node — carries a human description, not name==value").
//
// This is AUTHORED schema-as-code, a sibling of vocabulary.js (re-exported there as TERM_DEFINITIONS so
// the registry keeps its single import surface). Keyed [kind][value] — the same kind/value pair that
// names each schema-view member node (stableId `schemaView:<kind>:<value>`). The schema-view finisher
// REFUSES to emit a member whose definition is missing or empty (the plan's finisher validator): adding
// a term to the registry REQUIRES adding its definition here, or the next build fails loudly.

const TERM_DEFINITIONS = {
	nodeLabel: {
		ForgedNode:
			'The universal label on every content node the replay engine materializes from a block, plus deterministic finisher output. Marks the content-equality/fingerprint scope.',
		GraphProvenance:
			'The single build passport node per graph: what was built, from which manifest, when, by which engine versions. Non-deterministic (carries builtAt), so it is excluded from content fingerprints.',
		HubDefinition:
			'The per-hub descriptor node (one per hub standard, e.g. CEDS): hub name, version, canonical key scheme, slot profile. The anchor every HubReference belongs to via IN_HUB.',
		HubReference:
			'A canonical hub tuple (property tier: domain·property·range; value tier: + value) that source-standard elements resolve to. Shared-hub resolution is what makes cross-standard equivalence computable.',
		SchemaView:
			'A self-describing schema-catalog node (one root plus one member per registry term) generated each build from the vocabulary registry. Code is truth; this is its queryable in-graph projection.',
		ManifestRecipe:
			'The in-graph copy of the manifest this graph was replayed from: its key, label, note, creation time, and lineage. Lets a bolt-only consumer see the recipe without the forge store.',
		RecipeBlock:
			'One member block of a ManifestRecipe: block type, subject, version, producer, and content-address (blockId). The graph-side view of a content-addressed store block.',
		StandardDefinition:
			'The per-source-standard descriptor derived at finishing time: display name, version and its provenance (versionSource), source format, element counts, and mapping disposition (authored/inferred/island).',
		GraphMeta:
			'The structural marker on every legitimately source-less node (schema view, manifest recipe, standard definitions, the build passport). Purity rule: every node carries an _source XOR :GraphMeta — never both, never neither.',
	},
	edgeType: {
		HAS_CLASS: 'Standard root or container to a class/entity node it declares.',
		HAS_PROPERTY: 'Class (or root) to a property/field it carries.',
		HAS_OPTION_SET: 'Property or root to the enumerated option set constraining its values.',
		HAS_VALUE: 'Option set to one of its enumerated option values.',
		SUBCLASS_OF: 'Class to its parent class (specialization hierarchy within one standard).',
		REFERENCES: 'Generic intra-standard reference between structural nodes.',
		HAS_SUPPORT: 'Node to producer-specific supporting material (documentation fragments, examples).',
		REFERENCES_TYPE: 'Property/field to the named type it references within its own standard.',
		SPECIFIED_MAPPING: 'RETIRED prior-generation bridge edge (authored mapping). Named for history; zero instances in pure-model graphs.',
		IMPLIED_MAPPING: 'RETIRED prior-generation bridge edge (inferred mapping). Named for history; zero instances in pure-model graphs.',
		DERIVED_MAPPING: 'RETIRED prior-generation bridge edge (composed mapping). Named for history; zero instances in pure-model graphs; equivalence is now computed at query time through shared hubs.',
		CLASSIFICATION_CROSSWALK:
			'Cross-taxonomy correspondence row from the published NCES CIP2020↔SOC2018 crosswalk: an instructional program (CIP) prepares for work in an occupation (SOC). Direction CIP→SOC as the NCES table states; many-to-many. Spec-authoritative but NOT equivalence: it never touches a HubReference, never composes with EXACT_MATCH/CLOSE_MATCH hub resolution, and never participates in cross-standard equivalence claims.',
		EXACT_MATCH: 'Source element to HubReference, authored/spec-authoritative resolution (SKOS exactMatch). The only relation that composes to cross-standard equivalence.',
		CLOSE_MATCH: 'Source element to HubReference, inference-derived hypothesis (SKOS closeMatch). Conservative: never composes to equivalence on its own.',
		BROAD_MATCH: 'Source element to a broader HubReference (SKOS broadMatch). Non-composing.',
		NARROW_MATCH: 'Source element to a narrower HubReference (SKOS narrowMatch). Non-composing.',
		RELATED_MATCH: 'Source element to a related HubReference (SKOS relatedMatch). Non-composing.',
		HAS_HUB_DOMAIN: 'Hub-parameterized decomposition: HubReference to its domain (class) slot node.',
		HAS_HUB_PROPERTY: 'Hub-parameterized decomposition: HubReference to its property slot node.',
		HAS_HUB_RANGE: 'Hub-parameterized decomposition: HubReference to its range slot node.',
		HAS_HUB_VALUE: 'Hub-parameterized decomposition: HubReference to its value slot node (value tier only).',
		HAS_HUB_QUALIFIER: 'Hub-parameterized decomposition: HubReference to a qualifier slot node.',
		IN_HUB: 'HubReference to the HubDefinition it belongs to (hub-independent membership edge).',
		HAS_CEDS_DOMAIN: 'CEDS instantiation of the domain decomposition slot: HubReference to the CEDS class it addresses.',
		HAS_CEDS_PROPERTY: 'CEDS instantiation of the property decomposition slot: HubReference to the CEDS property it addresses.',
		HAS_CEDS_RANGE: 'CEDS instantiation of the range decomposition slot: HubReference to the CEDS option set or class forming its range.',
		HAS_CEDS_VALUE: 'CEDS instantiation of the value decomposition slot: HubReference to the CEDS option value it addresses (value tier).',
		HAS_CEDS_QUALIFIER: 'CEDS instantiation of the qualifier decomposition slot.',
		HAS_SCHEMA_TERM: 'SchemaView root to one schema-view member term (the self-describing catalog edge).',
		BUILT_FROM: 'GraphProvenance passport to the ManifestRecipe this graph was replayed from.',
		HAS_BLOCK: 'ManifestRecipe to one RecipeBlock member (the in-graph manifest membership).',
		BASED_ON: 'ManifestRecipe to its parent recipe — the manifest lineage, in-graph.',
	},
	provenanceTier: {
		'spec-authoritative': 'Asserted by the standard’s own specification or an authored crosswalk. The strongest evidence tier.',
		'embedding-inferred': 'Derived by embedding retrieval + LLM rerank, frozen in a decision block. A hypothesis tier, never silently composed.',
		structural: 'Emitted by deterministic structural machinery (hierarchy edges, schema view, self-documentation). True by construction.',
		'user-asserted': 'Asserted by a user/curator at runtime, outside the replayed content.',
	},
	skosPredicate: {
		exactMatch: 'SKOS: the two concepts are interchangeable. The only predicate that composes to cross-standard equivalence.',
		closeMatch: 'SKOS: the concepts are sufficiently similar for some applications. A non-composing hypothesis.',
		broadMatch: 'SKOS: the target concept is broader than the source.',
		narrowMatch: 'SKOS: the target concept is narrower than the source.',
		relatedMatch: 'SKOS: the concepts are associatively related, neither broader nor narrower.',
	},
	sssomJustification: {
		'semapv:ManualMappingCuration': 'SSSOM/SEMAPV: a human curator authored or reviewed the mapping.',
		'semapv:LexicalMatching': 'SSSOM/SEMAPV: the mapping was derived by lexical/string matching.',
		'semapv:SemanticSimilarity': 'SSSOM/SEMAPV: the mapping was derived from semantic similarity (e.g. embedding distance).',
		'semapv:LogicalReasoning': 'SSSOM/SEMAPV: the mapping was derived by logical inference over the source models.',
	},
	dmeRole: {
		DmeStandardRoot: 'The single per-standard root node carrying the standard’s provenance block (name, version, source format/files/url) and its mapping instruction.',
		DmeClass: 'A class/entity/complex-type of a source standard (the domain shape that carries properties).',
		DmeProperty: 'A property/field/element of a source standard — the primary mapping unit at the property tier.',
		DmeOptionSet: 'An enumerated value set (codeset) constraining one or more properties.',
		DmeOptionValue: 'One enumerated value of an option set — the mapping unit at the value tier.',
		DmeSupport: 'Producer-specific supporting material attached to structural nodes (documentation, examples).',
	},
	referenceTier: {
		property: 'A 3-slot hub address (domain · property · range) — the property-tier resolution target.',
		value: 'A 4-slot hub address (domain · property · range · value) — the value/codeset-tier resolution target.',
	},
	requiredPropertySet: {
		NODE: 'Properties every forged content node must carry: _id, _source, name, role, searchText.',
		STANDARD_ROOT: 'Additional properties required on a DmeStandardRoot: the provenance block (standardKey, standardName, version, sourceFormat, sourceFiles, sourceUrl) plus stableUriPropertyName and mappingInstruction.',
		EDGE: 'Properties every edge must carry: provenanceTier.',
		HUB_REFERENCE: 'Properties every HubReference must carry: canonicalKey, hubVersion, referenceTier, addressSignature.',
		HUB_DEFINITION: 'Properties every HubDefinition must carry: hubName, displayName, version, canonicalKeyName, canonicalKeyMinted, slotProfile, sourceProvenance.',
	},
	uniquenessKey: {
		STABLE_ID: 'ForgedNode uniqueness/MERGE key: stableId.',
		HUB_REFERENCE: 'HubReference composite uniqueness: (hubName, addressSignature) — a signature is only unique within its hub.',
		ADDRESS_SIGNATURE: 'The signature half of the HubReference composite key. Not a standalone uniqueness key.',
		HUB_DEFINITION: 'HubDefinition uniqueness: hubName.',
	},
	rangeShape: {
		optionSet: 'The property’s range is an enumerated option set (rangeOptionSetId) — the codeset-matching shape.',
		class: 'The property’s range is another class of the hub (rangeClassId) — an object/association reference.',
		datatype: 'The property’s range is a scalar datatype (rangeDatatype) — neither enumerated nor a class reference.',
	},
	tupleSlot: {
		DOMAIN: 'The class slot of a hub address — which entity the property belongs to.',
		PROPERTY: 'The property slot of a hub address — which attribute is addressed.',
		RANGE: 'The range slot of a hub address — exactly one of option set, class, or datatype.',
		VALUE: 'The value slot of a hub address — the enumerated option value (value tier only).',
		QUALIFIER: 'An optional qualifier slot refining a hub address.',
	},
};

module.exports = { TERM_DEFINITIONS };
