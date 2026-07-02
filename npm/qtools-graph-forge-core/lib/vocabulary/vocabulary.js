'use strict';

// vocabulary.js — the canonical schema-as-code VOCABULARY REGISTRY (Phase 1; SPEC §2, PLAN Phase 1).
//
// The single declarative source of truth for the roles, node labels, edge types, owner/role tokens,
// provenance tiers, SKOS/SSSOM enums, uniqueness keys, and required-property sets that producers, the
// replay guards, and the search-text builder currently hardcode independently. Every consumer imports
// from HERE instead of redeclaring literals.
//
// PHASE-1 INVARIANT: this extraction MUST NOT change any literal value or serialization order. Every
// value below is copied EXACTLY from the current code (provenance noted per group). The registry is a
// pure data module — no DI, no Neo4j, no async. It is frozen to prevent accidental mutation.
//
// Provenance of values (code fact, read this session):
//   - OWNER_TOKENS / ROLE_TYPES ........ edf-replay/lib/graph-builder.js (typeForRole/ownerForRole)
//   - NODE_LABELS ...................... replay-engine.js / graph-builder.js (:ForgedNode, :GraphProvenance)
//   - DME_ROLES ........................ forge-ceds.js makeNode + search-text/build-search-text.js
//   - EDGE_TYPES ....................... forge-ceds.js addEdge + the other producers (recon)
//   - MAPPING_EDGE_TYPES ............... edf-bridge (SPECIFIED_/IMPLIED_/DERIVED_MAPPING)
//   - PROVENANCE_TIERS / validators .... replay-block.js (the canonical set + isValid*)
//   - SKOS_PREDICATES .................. edf-bridge/lib/implied-pipeline.js + classify-predicate.js
//   - SSSOM_JUSTIFICATIONS ............. NEW (not yet in code) — defined here for the mapping phases
//   - UNIQUENESS_KEYS / REQUIRED_* ..... replay-engine.js (stableId MERGE key) + forge-ceds.js root props
//
// @concept: [[VocabularyRegistry]]
// @concept: [[SchemaAsCode]]

// =====================================================================
// OWNER + ROLE TOKENS (graph-builder.js)
// =====================================================================
// owner LABEL/property token stamped post-replay; ':' prefix is intrinsic (stripped to a bare label
// by graph-builder.ownerLabel). role/type token drives instance type + default owner.
const OWNER_TOKENS = { GOLDEN: ':golden', USER: ':user' };
const ROLE_TYPES = { BRONZE: 'bronze', GOLDEN: 'golden', USER: 'user' };

// =====================================================================
// NODE LABELS — universal structural labels (NOT per-standard labels, which stay producer-local)
// =====================================================================
// FORGED_NODE marks the content-equality scope; GRAPH_PROVENANCE is the excluded passport node.
const NODE_LABELS = { FORGED_NODE: 'ForgedNode', GRAPH_PROVENANCE: 'GraphProvenance' };

// =====================================================================
// DME ROLES — the six canonical universal roles (forge-ceds + build-search-text segmentBuildersByRole)
// =====================================================================
const DME_ROLES = {
	STANDARD_ROOT: 'DmeStandardRoot',
	CLASS: 'DmeClass',
	PROPERTY: 'DmeProperty',
	OPTION_SET: 'DmeOptionSet',
	OPTION_VALUE: 'DmeOptionValue',
	SUPPORT: 'DmeSupport',
};

// =====================================================================
// EDGE TYPES — canonical structural edges (forge-ceds addEdge + producer-specific HAS_SUPPORT/
// REFERENCES_TYPE). Mapping (bridge) edges are a separate group.
// =====================================================================
const EDGE_TYPES = {
	HAS_CLASS: 'HAS_CLASS',
	HAS_PROPERTY: 'HAS_PROPERTY',
	HAS_OPTION_SET: 'HAS_OPTION_SET',
	HAS_VALUE: 'HAS_VALUE',
	SUBCLASS_OF: 'SUBCLASS_OF',
	REFERENCES: 'REFERENCES',
	HAS_SUPPORT: 'HAS_SUPPORT',
	REFERENCES_TYPE: 'REFERENCES_TYPE',
};

// mapping/bridge edge types (edf-bridge). Defined here; bridge wiring lands with the bridge phases.
const MAPPING_EDGE_TYPES = {
	SPECIFIED_MAPPING: 'SPECIFIED_MAPPING',
	IMPLIED_MAPPING: 'IMPLIED_MAPPING',
	DERIVED_MAPPING: 'DERIVED_MAPPING',
};

// =====================================================================
// PROVENANCE TIERS — THE canonical four-value set (replay-block.js). Order is significant and
// preserved exactly; replay-block re-exports PROVENANCE_TIERS/isValidProvenanceTier from here.
// =====================================================================
const PROVENANCE_TIERS = [
	'spec-authoritative',
	'embedding-inferred',
	'structural',
	'user-asserted',
];
const PROVENANCE_TIER = {
	SPEC_AUTHORITATIVE: 'spec-authoritative',
	EMBEDDING_INFERRED: 'embedding-inferred',
	STRUCTURAL: 'structural',
	USER_ASSERTED: 'user-asserted',
};
const isValidProvenanceTier = (oneTier) => PROVENANCE_TIERS.indexOf(oneTier) !== -1;

// =====================================================================
// EDGE TYPE VALIDATION REGEX (replay-block.js) — guards the relationship-type position against
// injection (it cannot be parameterized in Cypher). Re-exported by replay-block unchanged.
// =====================================================================
const EDGE_TYPE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isValidEdgeType = (oneType) =>
	typeof oneType === 'string' && EDGE_TYPE_RE.test(oneType);

// =====================================================================
// SKOS PREDICATES (edf-bridge/lib/implied-pipeline.js PREDICATES + classify-predicate.js). The only
// relation that composes to equivalence is exactMatch (WHITEPAPER §6.3). Order preserved.
// =====================================================================
const SKOS_PREDICATES = [
	'exactMatch',
	'closeMatch',
	'broadMatch',
	'narrowMatch',
	'relatedMatch',
];
const isValidSkosPredicate = (oneP) => SKOS_PREDICATES.indexOf(oneP) !== -1;

// SKOS-relation Neo4j EDGE TYPES — the DEFAULT mapping form (WHITEPAPER §5 table / §6.1: a mapping is a
// typed edge from the source element to its HubReference, the SKOS relation as the edge label). One per
// SKOS predicate; the equivalence gates query (source)-[:EXACT_MATCH]->(HubReference). These are DISTINCT
// from the prior-generation MAPPING_EDGE_TYPES (SPECIFIED_/IMPLIED_/DERIVED_MAPPING — the old live-bridge's
// edges); the equivalence model labels the edge with the SKOS relation itself. Added with the bridge phases.
const SKOS_EDGE_TYPES = {
	exactMatch: 'EXACT_MATCH',
	closeMatch: 'CLOSE_MATCH',
	broadMatch: 'BROAD_MATCH',
	narrowMatch: 'NARROW_MATCH',
	relatedMatch: 'RELATED_MATCH',
};
const skosEdgeType = (onePredicate) => SKOS_EDGE_TYPES[onePredicate];

// =====================================================================
// SSSOM JUSTIFICATIONS — NEW vocabulary (not present in code today). Defined here so the mapping
// phases (4/5) and curation can stamp justifications from one source. No consumer wired yet.
// =====================================================================
// SSSOM mapping_justification values are CURIEs from the SEMAPV vocabulary (RESEARCH-skos-sssom.md §:
// "Value is a CURIE from the SEMAPV vocabulary, e.g. semapv:ManualMappingCuration"). Stored in canonical
// CURIE form so a Phase-4/5 SSSOM exporter emits CONFORMANT values directly (bare names would be
// non-conformant). The 'semapv:' prefix is intrinsic to the value, not applied later.
const SSSOM_JUSTIFICATIONS = [
	'semapv:ManualMappingCuration',
	'semapv:LexicalMatching',
	'semapv:SemanticSimilarity',
	'semapv:LogicalReasoning',
];
const isValidSssomJustification = (oneJ) => SSSOM_JUSTIFICATIONS.indexOf(oneJ) !== -1;

// SSSOM metadata property NAMES carried on a mapping edge (and on a reified MappingAssertion). camelCase
// per the project's property-naming convention; a future SSSOM exporter maps these to the SSSOM canonical
// snake_case field names (mapping_justification, subject_source, …). The mappingJustification VALUE is a
// semapv CURIE (SSSOM_JUSTIFICATIONS). NOTE: there is deliberately NO mappingDate — a runtime timestamp
// would break deterministic replay; a fixed provenance date, if ever required, is supplied as data, never
// minted at produce time. Added with the bridge phases (Phase 4 authored track is the first consumer).
const MAPPING_PROPERTIES = {
	PREDICATE: 'predicate',
	CONFIDENCE: 'confidence',
	MAPPING_JUSTIFICATION: 'mappingJustification',
	SUBJECT_SOURCE: 'subjectSource',
	SUBJECT_VERSION: 'subjectVersion',
	OBJECT_SOURCE: 'objectSource',
	OBJECT_VERSION: 'objectVersion',
	MAPPING_TOOL: 'mappingTool',
	MATCH_ID: 'matchId',
	PROVENANCE_TIER: 'provenanceTier',
};

// =====================================================================
// UNIQUENESS KEYS (replay-engine.js MERGE key; addressSignature reserved for the HubReference phases)
// =====================================================================
const UNIQUENESS_KEYS = {
	// forged-node MERGE/uniqueness key (replay-engine.js).
	STABLE_ID: 'stableId',
	// HubReference uniqueness is the COMPOSITE (hubName, addressSignature) — addressSignature is only
	// "unique within a hub" (WHITEPAPER §8: "Constraint: unique (hubName, addressSignature)";
	// SPEC-schemaEnforcementTenancy §2). Both halves are represented so the Phase-3/7 constraint builder
	// uses the composite, not addressSignature alone.
	HUB_REFERENCE: ['hubName', 'addressSignature'],
	// the signature half, retained for reference (NOT a standalone uniqueness key).
	ADDRESS_SIGNATURE: 'addressSignature',
	// HubDefinition is unique on hubName (§8: "hubName … Unique.").
	HUB_DEFINITION: ['hubName'],
};

// =====================================================================
// REQUIRED-PROPERTY SETS — the contract's required properties (forge-ceds.js). DECLARED here for the
// finishing-phase validator (Phase 7); NOT yet enforced by a shared check, so defining them changes no
// behavior. Names copied exactly from the current node construction.
// =====================================================================
const REQUIRED_PROPERTIES = {
	// every forged node carries these. CORRECTED in Phase 7 (GOLDEN_BEACON 2026-06-30, ratified WILD_FALCON)
	// after an empirical spec-vs-data finding over the gating golden's 75,685 base content nodes: `uri` was
	// DROPPED from REQUIRED (genuinely NON-uniform — absent on 51,397/75,685 base nodes; it is recommended/
	// optional, not required). NOTE on _id/_source: at the BLOCK layer these are carried in the node's
	// ref{source,id}; the replay engine MATERIALIZES them as graph properties (_id from ref.id/stableId,
	// _source from ref.source). So block-level validation checks ref.source/ref.id presence (the provenance),
	// while the live graph carries _id/_source as properties. name/role/searchText are universal block props.
	NODE: ['_id', '_source', 'name', 'role', 'searchText'],
	// the per-standard root additionally carries the provenance block + mapping contract
	STANDARD_ROOT: [
		'standardKey',
		'standardName',
		'version',
		'sourceFormat',
		'sourceFiles',
		'sourceUrl',
		'stableUriPropertyName',
		'mappingInstruction',
	],
	// every edge carries a provenance tier (replay-engine enforces this today)
	EDGE: ['provenanceTier'],
	// HubReference required props (§8 HubReference schema — the ✓ columns). qualifierKeys/rangeDatatype/
	// label/anchorUri/embedding are optional. canonicalKey is intentionally NON-unique among value-tier
	// refs (the same option-value under different properties is a distinct address) — uniqueness is the
	// composite (hubName, addressSignature), NOT canonicalKey (WHITEPAPER §8; confirmed WILD_FALCON).
	HUB_REFERENCE: ['canonicalKey', 'hubVersion', 'referenceTier', 'addressSignature'],
	// HubDefinition required props (§8 HubDefinition schema — the ✓ columns; namespace optional).
	HUB_DEFINITION: [
		'hubName',
		'displayName',
		'version',
		'canonicalKeyName',
		'canonicalKeyMinted',
		'slotProfile',
		'sourceProvenance',
	],
};

// =====================================================================
// EQUIVALENCE VOCABULARY (Phase 3 — HubReference reference subgraph; WHITEPAPER §4.3/§4.6/§8,
// SPEC-schemaEnforcementTenancy §2). One source of truth for the reference-subgraph producer, the
// gates, and the later mapping/equivalence phases. Names taken LITERALLY from the spec.
// =====================================================================

// NODE LABELS for the materialized reference subgraph (§8 schemas). Universal (hub-independent).
const EQUIVALENCE_NODE_LABELS = {
	HUB_DEFINITION: 'HubDefinition',
	HUB_REFERENCE: 'HubReference',
};

// referenceTier enum (§8: 3-slot 'property' | 4-slot 'value').
const REFERENCE_TIERS = ['property', 'value'];
const REFERENCE_TIER = { PROPERTY: 'property', VALUE: 'value' };
const isValidReferenceTier = (oneTier) => REFERENCE_TIERS.indexOf(oneTier) !== -1;

// CANONICAL-ADDRESS component property NAMES — PROMOTED from forge-ceds local literals (HANDOFF (d)).
// Phase 2 stamps these on the CEDS hub structural nodes; Phase 3 reads + extends them. These are the
// generic property KEYS; the hub-instance VALUES ('CEDS' / '14.0.0.0') stay producer-local.
const CANONICAL_ADDRESS_PROPERTIES = {
	HUB_NAME: 'hubName',
	HUB_VERSION: 'hubVersion',
	CANONICAL_KEY: 'canonicalKey', // durable join key (property P-form / value OV-form)
	DOMAIN_ID: 'domainId', // version-scoped class id (NEVER a durable key)
	RANGE_OPTION_SET_ID: 'rangeOptionSetId', // version-scoped option-set id (range slot, enumerated)
	// version-scoped CEDS class id (range slot, object/association property — the range IS another CEDS
	// class, e.g. 'Has Assessment' -> Assessment). A THIRD first-class range shape, parallel to
	// RANGE_OPTION_SET_ID; mutually exclusive with it and with a scalar RANGE_DATATYPE (a reference carries
	// exactly one of {optionSet, class, datatype} — investigation INVESTIGATION-rangelessHubs-070126.md).
	RANGE_CLASS_ID: 'rangeClassId',
	RANGE_DATATYPE: 'rangeDatatype', // datatype when the range is neither an option set nor a class
};

// HubReference property NAMES (§8 HubReference schema).
const HUB_REFERENCE_PROPERTIES = {
	CANONICAL_KEY: 'canonicalKey',
	HUB_VERSION: 'hubVersion',
	REFERENCE_TIER: 'referenceTier',
	RANGE_DATATYPE: 'rangeDatatype',
	QUALIFIER_KEYS: 'qualifierKeys',
	ADDRESS_SIGNATURE: 'addressSignature',
	LABEL: 'label',
	ANCHOR_URI: 'anchorUri',
	EMBEDDING: 'embedding',
};

// HubDefinition property NAMES (§8 HubDefinition schema).
const HUB_DEFINITION_PROPERTIES = {
	HUB_NAME: 'hubName',
	DISPLAY_NAME: 'displayName',
	VERSION: 'version',
	NAMESPACE: 'namespace',
	CANONICAL_KEY_NAME: 'canonicalKeyName',
	CANONICAL_KEY_MINTED: 'canonicalKeyMinted',
	SLOT_PROFILE: 'slotProfile',
	SOURCE_PROVENANCE: 'sourceProvenance',
};

// DECOMPOSITION EDGE TYPES — HubReference -> hub-slot edges (§4.6). The generic HAS_HUB_* FAMILY is
// parameterized per hub; the concrete CEDS instantiation substitutes the hub name (so multi-hub
// reuses the family later). IN_HUB (HubReference -> HubDefinition) is hub-independent.
const HUB_DECOMPOSITION_SLOTS = ['DOMAIN', 'PROPERTY', 'RANGE', 'VALUE', 'QUALIFIER'];
const HUB_DECOMPOSITION_EDGE_TYPES = {
	DOMAIN: 'HAS_HUB_DOMAIN',
	PROPERTY: 'HAS_HUB_PROPERTY',
	RANGE: 'HAS_HUB_RANGE',
	VALUE: 'HAS_HUB_VALUE',
	QUALIFIER: 'HAS_HUB_QUALIFIER',
};
const IN_HUB_EDGE_TYPE = 'IN_HUB';
// hubEdgeType(hubName, slot) -> 'HAS_<HUBNAME>_<SLOT>' (the spec's hub-parameterized concrete name).
const hubEdgeType = (hubName, slot) => `HAS_${String(hubName).toUpperCase()}_${slot}`;
// the concrete CEDS instantiation (hubName 'CEDS'); equals HUB_DECOMPOSITION_SLOTS.map(hubEdgeType('CEDS',...)).
const CEDS_HUB_EDGE_TYPES = {
	DOMAIN: 'HAS_CEDS_DOMAIN',
	PROPERTY: 'HAS_CEDS_PROPERTY',
	RANGE: 'HAS_CEDS_RANGE',
	VALUE: 'HAS_CEDS_VALUE',
	QUALIFIER: 'HAS_CEDS_QUALIFIER',
};

// addressSignature CANONICAL FIELD ORDER (§8 formula). The deterministic stable hash is computed over
// EXACTLY these fields in THIS order; 'range' = rangeOptionSetId (enumerated) ELSE rangeClassId (object/
// association reference to a CEDS class) ELSE rangeDatatype (scalar); the three are mutually exclusive
// (a reference carries exactly one range shape), so folding all three into the single 'range' signature
// slot preserves determinism + uniqueness (Gate 19) exactly as the two-shape form did.
// qualifierKeys are SORTED before hashing; an empty slot encodes as the empty string. One source of
// truth so the producer and any validator compute an identical signature.
const ADDRESS_SIGNATURE_FIELD_ORDER = [
	'hubName',
	'canonicalKey',
	'domainId',
	'propertyKey',
	'range', // rangeOptionSetId || rangeDatatype
	'valueKey',
	'qualifierKeys', // sort()ed
	'hubVersion',
];

// =====================================================================
// STRUCTURAL PROPERTY NAMES (Wave-2 items 5/6; M7/M8) — the per-node structural properties the
// structural-contract module defines/derives centrally and every walker (value-scope, neighborhood
// loaders) reads. Registered here so producers, the contract finalizer, and future validators name
// them from ONE source. parentId's referent is a MEMBER stableId (the one referent, enforced by
// structural-contract.finalizeStructuralContract); depth = parentId-chain length; crossRefs is
// universally present (JSON string, '[]' when unharvested); path stays producer-local flavor.
// =====================================================================
const STRUCTURAL_PROPERTIES = {
	PARENT_ID: 'parentId',
	DEPTH: 'depth',
	CROSS_REFS: 'crossRefs',
	PATH: 'path',
};

// =====================================================================
// SCHEMA-VIEW VOCABULARY (Phase 7 — the self-describing in-graph schema view; SPEC §3.3). The view is a
// READ-ONLY generated projection of THIS registry, emitted by the replayManager schema-view FINISHER (NOT a
// producer block; the manifest carries nothing schema-related). Its OWN label + edge type are registered
// HERE so the emitted view describes itself (self-consistency, per WILD_FALCON). View nodes carry :ForgedNode
// (deterministic generated content -> included in fingerprint scope) PLUS the :SchemaView label; the
// root->member edges carry provenanceTier 'structural'. ADDITIVE — no existing value changes.
// =====================================================================
const SCHEMA_VIEW = {
	LABEL: 'SchemaView', // the dual label on every schema-view node (alongside :ForgedNode)
	EDGE_TYPE: 'HAS_SCHEMA_TERM', // root -> member edge type
	ROOT_STABLE_ID: 'schemaView:root', // the single root node's stableId
	PROVENANCE_TIER: PROVENANCE_TIER.STRUCTURAL, // schema-view edges carry the structural tier
	// the KINDS of registry term the view enumerates (one member node per value within each kind). The kind
	// string is the member node's `kind` property; member stableId = `schemaView:<kind>:<value>`.
	KINDS: {
		NODE_LABEL: 'nodeLabel',
		EDGE_TYPE: 'edgeType',
		PROVENANCE_TIER: 'provenanceTier',
		SKOS_PREDICATE: 'skosPredicate',
		SSSOM_JUSTIFICATION: 'sssomJustification',
		DME_ROLE: 'dmeRole',
		REFERENCE_TIER: 'referenceTier',
		REQUIRED_PROPERTY_SET: 'requiredPropertySet',
		UNIQUENESS_KEY: 'uniquenessKey',
	},
};

const vocabulary = {
	OWNER_TOKENS,
	ROLE_TYPES,
	NODE_LABELS,
	DME_ROLES,
	EDGE_TYPES,
	MAPPING_EDGE_TYPES,
	PROVENANCE_TIERS,
	PROVENANCE_TIER,
	isValidProvenanceTier,
	EDGE_TYPE_RE,
	isValidEdgeType,
	SKOS_PREDICATES,
	isValidSkosPredicate,
	SKOS_EDGE_TYPES,
	skosEdgeType,
	SSSOM_JUSTIFICATIONS,
	isValidSssomJustification,
	MAPPING_PROPERTIES,
	UNIQUENESS_KEYS,
	REQUIRED_PROPERTIES,
	// equivalence vocabulary (Phase 3)
	EQUIVALENCE_NODE_LABELS,
	REFERENCE_TIERS,
	REFERENCE_TIER,
	isValidReferenceTier,
	CANONICAL_ADDRESS_PROPERTIES,
	HUB_REFERENCE_PROPERTIES,
	HUB_DEFINITION_PROPERTIES,
	HUB_DECOMPOSITION_SLOTS,
	HUB_DECOMPOSITION_EDGE_TYPES,
	IN_HUB_EDGE_TYPE,
	hubEdgeType,
	CEDS_HUB_EDGE_TYPES,
	ADDRESS_SIGNATURE_FIELD_ORDER,
	// structural property names (Wave-2 items 5/6)
	STRUCTURAL_PROPERTIES,
	// schema-view vocabulary (Phase 7)
	SCHEMA_VIEW,
};

// freeze deeply-enough to prevent accidental mutation of the single source of truth.
Object.keys(vocabulary).forEach((oneKey) => {
	const value = vocabulary[oneKey];
	if (value && typeof value === 'object') {
		Object.freeze(value);
	}
});
Object.freeze(vocabulary);

module.exports = vocabulary;
