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
//   - NODE_LABELS ...................... replay-engine.js / graph-builder.js (:ForgedNode, :GraphProvenance)
//   - DME_ROLES ........................ forge-ceds.js makeNode + search-text/build-search-text.js
//   - EDGE_TYPES ....................... forge-ceds.js addEdge + the other producers (recon)
//   - MAPPING_EDGE_TYPES ............... graph-builder.js legacy-0 purity gate + schema-view-finisher.js
//                                        (2026-07-04: emitter edf-bridge RETIRED; names kept to PROVE ABSENCE)
//   - PROVENANCE_TIERS / validators .... replay-block.js (the canonical set + isValid*)
//   - SKOS_PREDICATES .................. schema-validator.js (live predicate validation) + schema-view-finisher.js
//                                        (2026-07-04: original edf-bridge consumers retired; vocabulary is LIVE)
//   - SSSOM_JUSTIFICATIONS ............. the Profile's three terms (SPEC-educoreBridgeProfile-v1.0.md §4.2)
//   - UNIQUENESS_KEYS / REQUIRED_* ..... replay-engine.js (stableId MERGE key) + forge-ceds.js root props
//
// @concept: [[VocabularyRegistry]]
// @concept: [[SchemaAsCode]]

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
	// A CEDS change-history record. ⟪TQ ruling, 2026-08-02⟫ change history becomes NODES,
	// not a JSON blob: a blob round-trips perfectly and answers nothing, and the point of
	// holding this in a graph is to ask "what changed in 14.0.0.0" and "which elements we
	// mapped against have moved since". Carries no embedding, so it never enters the <graphName>_vector index on
	// :ForgedNode(embedding) and stays invisible to the DME's semantic search. (HubReference cards DO carry an
	// embedding and ARE in that index — corrected in campaign P2, W-A-12.)
	EDIT_HISTORY_ENTRY: 'DmeEditHistoryEntry',
	// An owl:Restriction block -- a CLASS's constraint that a named property takes all its
	// values from a named target. 18 in CEDS. Anonymous in the source, so identity is derived
	// from owner + file position, exactly as DmeEditHistoryEntry is. Carries no embedding.
	RESTRICTION: 'DmeRestriction',
	// A term CEDS defines for its OWN vocabulary -- textFormat, changeVersion, editHistory and
	// the rest -- rather than a data element. ⟪TQ ruling, 2026-08-02: "mint the IDs"⟫ these get
	// a synthetic VT<localName> id because CEDS assigns them none. Carries no embedding and no
	// data role, so it is invisible to both the DME's browse (which selects by data role) and
	// its semantic search (which reads only <graphName>_vector, on :ForgedNode(embedding)).
	VOCABULARY_TERM: 'DmeVocabularyTerm',
	// ONE distinct descriptive text of a standard (a name, description, definition and the like,
	// trimmed), minted by the FORGE FRAMEWORK -- never by a walk -- from the text-property include list
	// a forge declares, and linked by EMBEDS_TEXT_OF to every node it describes. ⟪TQ decisions 1, 1b,
	// 2, 2026-09-14; PLAN-forgeEmbedText-091426 §8⟫ Identity is content-addressed over the text alone
	// (<rootStableId>/embedText/<sha256(text)>, R-ET-1), so a text repeated inside a standard is one
	// node. It carries NO name, NO searchText and NO embedding; the framework holds the role
	// non-embeddable itself (R-ET-3). Its vector lives on textEmbedding, with the ORDINARY
	// embeddingModelVersion beside it (R-ET-8), under its own index (EMBED_TEXT_VECTOR below). After
	// P4 a graph therefore carries TWO vector indexes, and the DME's search reads only
	// <graphName>_vector (label ForgedNode, property embedding): a node with no `embedding` property
	// has no entry there, so search never sees a text.
	EMBED_TEXT: 'DmeEmbedText',
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
	HAS_EDIT_HISTORY: 'HAS_EDIT_HISTORY',
	HAS_RESTRICTION: 'HAS_RESTRICTION',
	// (DmeEmbedText)-[:EMBEDS_TEXT_OF]->(described node), provenanceTier 'structural'. ONE edge per
	// distinct (text node, described node) pair, carrying propertyNameList: the SORTED names of the
	// properties on that node whose value the text is. ⟪R-ET-4 as corrected, RADIANT_QUEST, PLAN §8.5⟫
	// WHY ONE PER PAIR, in order: (1) census.collisionCensus counts duplicate (from, type, to) TRIPLES
	// and G-ORDER holds that count at 0, so an edge per property would raise it on every text serving
	// two properties of one node (4,619 such pairs in CEDS, 9,091 in PESC, measured); (2) the pair is
	// the fact a consumer asks about -- which nodes does this text describe -- and per-property rows
	// come from enumerating (edge, propertyName). The shape is CHOSEN, not forced by the loader: since
	// 2026-09-02 replay-engine merges edges on the FULL property map, so per-property edges would have
	// survived as distinct edges. propertyNameList is declared list-valued (graph-contract §1), so the loader
	// keeps it a list at every length (campaign P2, W-A-1). Never REFERENCES: a
	// structural walk must not travel from a standard into its texts.
	EMBEDS_TEXT_OF: 'EMBEDS_TEXT_OF',
	// ⟪SIF replacement, phase V1, 2026-09-28; SPEC-sifStructuralBridge-replacement §3.2⟫ the structural
	// edges of the sif260928 bundle, each its own type. The incumbent SIF forge folded its native kinds
	// onto HAS_PROPERTY / HAS_OPTION_SET / REFERENCES with a nativeEdgeType property, and the fold made
	// the structure unreadable; these rows are for the new bundle to use in place of the fold. Every value
	// lands in every graph's schema view (schema-view-finisher enumerates EDGE_TYPES whole).
	HAS_FIELD: 'HAS_FIELD',
	HAS_CHILD: 'HAS_CHILD',
	HAS_INSTANCE: 'HAS_INSTANCE',
	CONSTRAINED_BY: 'CONSTRAINED_BY',
	// the one NATIVE relation kind ruled for the new SIF snapshot (supervisor ruling, SPEC §9 A24): Field to
	// Object, from a RefId field to the object it names. FROM THE FIELD, not from its object, so two
	// references between the same pair of objects through different fields stay two distinct triples.
	REFERENCES_OBJECT: 'REFERENCES_OBJECT',
};

// EMBED-TEXT VECTOR INDEX DESCRIPTOR ⟪R-ET-24⟫ -- the one home for the second vector index's names: the
// label it covers, the property it indexes, and the suffix appended to the graph name to name the index
// (<graphName>_embedText_vector). P4's index DDL is built from it, so the loader and any reader cannot
// spell the three differently. `label` is READ from DME_ROLES rather than re-typed, so a role rename
// moves the index with it. It has NO TERM_DEFINITIONS entry, deliberately: SCHEMA_VIEW.KINDS has no kind
// for an index descriptor, and adding one would change the schema-view finisher, which this registry
// does not own. The schema view documents the role and the edge it describes instead.

const EMBED_TEXT_VECTOR = Object.freeze({
	label: DME_ROLES.EMBED_TEXT,
	propertyName: 'textEmbedding',
	indexNameSuffix: '_embedText_vector',
});

// EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE — ⟪campaign P2, W-C-3 / V1-C30⟫ the endpoint kinds each structural edge type that
// several forges share may join, as DATA beside the prose (a kind is a producer-local label without its standard prefix:
// Ceds, Edfi, Sif260928, Pesc<Release>). The prose definitions name every kind listed here, and a live-census gate
// (lib/vocabulary/test/test-edgeDefinitionCensus.js) proves every pair the graph holds is declared.
const EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE = Object.freeze({
	HAS_CHILD: Object.freeze(['Container->Container', 'Container->Field', 'Field->Field', 'GlobalElement->Occurrence', 'Object->Container', 'Occurrence->Occurrence']),
	HAS_INSTANCE: Object.freeze(['Element->Occurrence', 'Question->Field']),
	HAS_OPTION_SET: Object.freeze(['Element->CodeList', 'Property->Descriptor', 'Property->Enumeration', 'Property->OptionSet']),
	SUBCLASS_OF: Object.freeze(['AnonymousType->Type', 'AssociationSubclass->Association', 'Class->Class', 'CodeList->CodeList', 'CodeList->DataType', 'DataType->CodeList', 'DataType->DataType', 'DomainEntitySubclass->AbstractEntity', 'OptionSet->Class', 'Type->Type']),
});

// LEGACY mapping/bridge edge types (emitter edf-bridge RETIRED 2026-07-04). Kept deliberately: the
// graph-builder legacy-edge purity gate enumerates these names to prove their ABSENCE (legacy 0),
// and the schema-view finisher describes them. Proving absence requires the names.
const MAPPING_EDGE_TYPES = {
	SPECIFIED_MAPPING: 'SPECIFIED_MAPPING',
	IMPLIED_MAPPING: 'IMPLIED_MAPPING',
	DERIVED_MAPPING: 'DERIVED_MAPPING',
};

// classification-crosswalk edge types (A0.3, workorder inferenceAndSelfDoc-070226): published
// cross-taxonomy correspondence tables (NCES CIP↔SOC) materialized island-to-island. Spec-
// authoritative but NOT equivalence — these edges never touch a HubReference and never compose
// with the EXACT_MATCH/CLOSE_MATCH hub-resolution model (enforced by the A0.3 red test).
const CLASSIFICATION_EDGE_TYPES = {
	CLASSIFICATION_CROSSWALK: 'CLASSIFICATION_CROSSWALK',
};

// =====================================================================
// SCHEMA BLOCK KINDS — the LOCKED block taxonomy (targetArchitectureDesign_072026 §2).
// =====================================================================
// The three kinds a schema block can be, and the ONLY words for them. Homed here rather than in
// standards-database (where the list previously lived) because this is the registry that exists for
// exactly this purpose and because the list has more than one consumer: the store's saveBlock
// taxonomy gate, manifestEditor.add's taxonomy gate, and the header-vs-kind reconciliation. Two
// copies of a locked taxonomy is how a kind comes to be acceptable in one place and refused one
// layer down.
//
// A schema block's HEADER blockType is drawn from this same set — header and stored kind are one
// vocabulary, which is what makes reconciling them meaningful (standardsDatabase.saveBlock).
// 'standardBase' supersedes the incumbent's 'standard' (§2 table, "Incumbent name" column).
//
// The named tokens come first and the list is DERIVED from them, so a producer naming one kind and
// a gate enumerating all three cannot drift apart.
const SCHEMA_BLOCK_KIND = {
	STANDARD_BASE: 'standardBase',
	HUB: 'hub',
	RELATIONSHIP: 'relationship',
};
const SCHEMA_BLOCK_KINDS = [
	SCHEMA_BLOCK_KIND.STANDARD_BASE,
	SCHEMA_BLOCK_KIND.HUB,
	SCHEMA_BLOCK_KIND.RELATIONSHIP,
];

// =====================================================================
// SUBJECT-REF-ID ROLE MARKER ↔ KIND (implementationPlan_hubPort_072326 §1, TQ 2026-07-23).
// =====================================================================
// A schema block's subject carries a role/pair marker so every block is globally unique by its
// name alone and legible at a glance: <standard>@<version>_base | _hub | _rel_<source>@<version>.
// The <standard>@<version> PREFIX is untouched (whatever version token the recipe supplies); the
// marker is ADDED. The marker is human sugar; the `kind` column stays the machine authority; a gate
// (standardsDatabase.saveBlock) requires the two AGREE — one more place a block cannot misdescribe
// itself, extending the header/blockType↔kind gate.
//
// Declared as DATA keyed by kind — one entry per kind, DERIVED from SCHEMA_BLOCK_KIND — so a producer
// composing a name and the gate validating it read ONE table, never a per-kind conditional. `_base`
// and `_hub` are TRAILING markers (the whole role suffix); `_rel_` is an INFIX marker (the
// relationship name continues past it with the source pair, <hub>@<ver>_rel_<source>@<ver>), so its
// agreement test is CONTAINMENT, not endsWith. The match MODE is itself data, resolved through the
// SUFFIX_MATCHERS registry, so the gate stays a table lookup rather than a switch on kind.
// RELATIONSHIP PRODUCER SUFFIX (implementationPlan_bridge_072426 §7, P2). A relationship block is
// per-(pair × producer): the AUTHORED deterministic producer emits '..._exact', the INFERRED frozen
// producer emits '..._close' (settled decision #2). The producer suffix TRAILS the pair infix, so a
// relationship subject is '<hub>@<hubVer>_rel_<source>@<sourceVer>_exact|_close' — pair-scoped,
// version-keyed on BOTH endpoints (the a4a0da2 rule: REAL resolved versions), and self-describing about
// WHICH producer authored it so re-running inference never disturbs the authored block. DATA-keyed by
// producer, one row per producer.
const RELATIONSHIP_PRODUCER_SUFFIX = {
	authored: '_exact',
	inferred: '_close',
	// STRUCTURAL — the deterministic intra-family structure producer (ctdlFamilyStructure): pairwise
	// HAS_PROPERTY / REFERENCES / SUBCLASS_OF / HAS_OPTION_SET edges authored by a same-URI identity join,
	// no vectors and no LLM. A structural pairing is a THIRD producer kind alongside authored/inferred, so
	// its relationship block earns its own self-describing suffix rather than masquerading as _exact (which
	// connotes an EXACT_MATCH mapping this is not). Adding this ONE data row extends BOTH the composer's
	// allowed producers AND the RELATIONSHIP kind gate (RELATIONSHIP_PRODUCER_SUFFIXES is derived from this
	// map) with no per-producer conditional anywhere.
	structural: '_struct',
};
const RELATIONSHIP_PRODUCER_SUFFIXES = Object.keys(RELATIONSHIP_PRODUCER_SUFFIX).map(
	(oneProducer) => RELATIONSHIP_PRODUCER_SUFFIX[oneProducer],
);
const RELATIONSHIP_PAIR_INFIX = '_rel_';

// RELATIONSHIP SUBJECT DISCRIMINATOR — the OPT-IN tail (Phase 7, TQ 2026-08-29, under his constraint
// "purely backward compatible — doesn't affect any other work"). Two bridge plugins can share BOTH a
// standard pair AND a producerKind — PESC's property and option-set derived tiers do — and then compose
// ONE subject, which the manifest editor refuses AFTER the colliding bridge's whole judge run. The
// remedy is a tail a PLUGIN DECLARES, appended AFTER the producer suffix:
//
//     <hub>@<hubVersion>_rel_<source>@<sourceVersion><producerSuffix>[~<discriminator>]
//
// IT IS OPT-IN AND THAT IS THE WHOLE DESIGN. A plugin that declares nothing composes the string it
// composed before, byte for byte, on the code path it used before — so no existing subject moves and no
// existing relationship block re-keys. The universal "bridge name in every subject" form was REJECTED
// for exactly that reason: it re-keys the entire lineage.
//
// '~' was chosen by MEASUREMENT, not taste: re-measured at Phase 7 entry, it appears in NO block subject
// of any store in the tree (37 stores, 76 subjects), in NO standardKey, and in NO version token.
const RELATIONSHIP_DISCRIMINATOR_SEPARATOR = '~';
// THE ONE AUTHORED RULE. Every reader — the composer, both parsers, and the declaration contract's
// kind-checker — validates against THIS constant, so they cannot drift apart. Lower-case initial then
// alphanumerics, 32 characters maximum; it excludes the separator by construction, so no separate clause
// is needed to keep a discriminator from carrying one.
const RELATIONSHIP_DISCRIMINATOR_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;
// DERIVED from the pattern above by stripping its two anchors and re-anchoring after the separator —
// never re-typed. A parser needs the TAIL form ('~optionSet' at the end of a subject) while a validator
// needs the WHOLE-VALUE form, and writing the character class twice is how the two rules silently
// diverge. Deriving it means a change to the authored rule moves both.
const RELATIONSHIP_DISCRIMINATOR_TAIL_PATTERN = new RegExp(
	`${RELATIONSHIP_DISCRIMINATOR_SEPARATOR}${RELATIONSHIP_DISCRIMINATOR_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '')}$`,
);

// subjectWithoutRelationshipDiscriminator — the subject as it would read had no discriminator been
// declared. Returns the string UNCHANGED when no well-formed tail trails, so a malformed tail ('..._close~',
// '..._close~Bad') is NOT stripped: it is left in place to be judged by the producer-suffix test, which
// then fails to recognise it. A reader that stripped anything after the last '~' would silently accept
// a subject the composer could never have produced.
const subjectWithoutRelationshipDiscriminator = (subject) =>
	typeof subject !== 'string' ? subject : subject.replace(RELATIONSHIP_DISCRIMINATOR_TAIL_PATTERN, '');

// suffixForRelationshipProducer — the trailing producer marker a relationship subject must carry.
// Returns undefined for an unknown producer; a caller that REQUIRES it treats undefined as a refusal
// naming the producer (never a silent default).
const suffixForRelationshipProducer = (oneProducer) => RELATIONSHIP_PRODUCER_SUFFIX[oneProducer];

// relationshipSubject — COMPOSE the pair-scoped, version-keyed relationship name. Both versions are
// REQUIRED (there is no default — a relationship block that cannot name a resolved version on both
// endpoints has no address, polyArch2 §6). Returns { subject } or { error }.
const relationshipSubject = ({ hubStandard, hubVersion, sourceStandard, sourceVersion, producer, discriminator } = {}) => {
	const producerSuffix = suffixForRelationshipProducer(producer);
	const missing = [
		[hubStandard, 'hubStandard'],
		[hubVersion, 'hubVersion'],
		[sourceStandard, 'sourceStandard'],
		[sourceVersion, 'sourceVersion'],
	].filter(([oneValue]) => oneValue === undefined || oneValue === null || `${oneValue}`.trim() === '');
	if (missing.length) {
		return { error: `relationshipSubject: missing ${missing.map(([, name]) => name).join(', ')} — a relationship block is version-keyed on BOTH endpoints; there is no default.` };
	}
	if (!producerSuffix) {
		return { error: `relationshipSubject: producer '${producer}' has no registered suffix — known producers: ${Object.keys(RELATIONSHIP_PRODUCER_SUFFIX).join(', ')}.` };
	}
	const undiscriminatedSubject = `${hubStandard}@${hubVersion}${RELATIONSHIP_PAIR_INFIX}${sourceStandard}@${sourceVersion}${producerSuffix}`;
	// ABSENT IS TODAY'S ANSWER, ON TODAY'S PATH. An undeclared discriminator returns the string composed
	// exactly as it was before this parameter existed — the same template, no separator, no tail. That is
	// what makes the whole change backward compatible, and it is why the check is `=== undefined` rather
	// than a truthiness test: '' and null are NOT "absent", they are malformed values and are refused below.
	if (discriminator === undefined) {
		return { subject: undiscriminatedSubject };
	}
	if (typeof discriminator !== 'string' || !RELATIONSHIP_DISCRIMINATOR_PATTERN.test(discriminator)) {
		return { error: `relationshipSubject: discriminator ${JSON.stringify(discriminator)} does not match ${RELATIONSHIP_DISCRIMINATOR_PATTERN} — a subject discriminator is lower-case-initial alphanumeric, 32 characters maximum, and never carries the '${RELATIONSHIP_DISCRIMINATOR_SEPARATOR}' separator itself.` };
	}
	return { subject: `${undiscriminatedSubject}${RELATIONSHIP_DISCRIMINATOR_SEPARATOR}${discriminator}` };
};

// relationshipProducerFromSubject — which producer's suffix (if any) a relationship subject
// carries. Used to make a gate refusal specific; returns undefined when no known producer suffix trails.
// STRIP A WELL-FORMED DISCRIMINATOR TAIL FIRST, then apply the existing endsWith over the producer
// suffixes unchanged. The producer suffix TRAILS the pair infix and the discriminator trails the producer
// suffix, so a discriminated subject's producer is only visible once the tail is removed. An undiscriminated
// subject is unchanged by the strip and takes exactly the path it took before.
const relationshipProducerFromSubject = (subject) =>
	typeof subject !== 'string'
		? undefined
		: Object.keys(RELATIONSHIP_PRODUCER_SUFFIX).filter(
				(oneProducer) => subjectWithoutRelationshipDiscriminator(subject).endsWith(RELATIONSHIP_PRODUCER_SUFFIX[oneProducer]),
		  )[0];

const SCHEMA_BLOCK_KIND_SUFFIX = {
	[SCHEMA_BLOCK_KIND.STANDARD_BASE]: { marker: '_base', match: 'trailing' },
	[SCHEMA_BLOCK_KIND.HUB]: { marker: '_hub', match: 'trailing' },
	// RELATIONSHIP now requires the pair infix '_rel_' AND a trailing producer suffix ('_exact'|'_close')
	// — a bare '..._rel_...' with no producer suffix is REFUSED (a relationship block that does not say
	// which producer authored it cannot be gated per-producer; §7 / settled decision #2).
	[SCHEMA_BLOCK_KIND.RELATIONSHIP]: { marker: '_rel_', match: 'relationshipPairProducer' },
};

// match-mode registry: mode name -> (subject, marker) predicate. A new match mode is one entry
// here and one `match:` value above — no branch to edit (polyArch2 §7, the Registry Pattern).
const SUFFIX_MATCHERS = {
	trailing: (subject, marker) => subject.endsWith(marker),
	infix: (subject, marker) => subject.indexOf(marker) !== -1,
	// relationshipPairProducer — the pair infix is PRESENT and a KNOWN producer suffix TRAILS, either at the
	// very end or immediately before a well-formed discriminator tail. The two cases are ONE test because the
	// strip is a no-op on an undiscriminated subject; a malformed tail is not stripped, so '..._close~' and
	// '..._close~Bad' are REFUSED here rather than quietly read as relationship subjects.
	relationshipPairProducer: (subject, marker) =>
		subject.indexOf(marker) !== -1 &&
		RELATIONSHIP_PRODUCER_SUFFIXES.some((oneSuffix) => subjectWithoutRelationshipDiscriminator(subject).endsWith(oneSuffix)),
};

// suffixMarkerForKind — DERIVE the role marker a kind's subject must carry (the "expected suffix
// from a kind" helper, §1). Returns undefined for an unknown kind; a caller that REQUIRES a marker
// (the saveBlock gate) treats undefined as a refusal, naming the kind — never a silent default.
const suffixMarkerForKind = (oneKind) => {
	const entry = SCHEMA_BLOCK_KIND_SUFFIX[oneKind];
	return entry ? entry.marker : undefined;
};

// subjectAgreesWithKind — VALIDATE a subject against a kind: does it carry the role marker
// that kind requires? DATA-driven — looks the kind up in SCHEMA_BLOCK_KIND_SUFFIX and applies that
// kind's declared match mode via SUFFIX_MATCHERS. Returns false for an unknown kind or a non-string
// subject (the gate turns a false into a named refusal); it does not substitute or normalize.
const subjectAgreesWithKind = (subject, oneKind) => {
	const entry = SCHEMA_BLOCK_KIND_SUFFIX[oneKind];
	if (!entry || typeof subject !== 'string') {
		return false;
	}
	return SUFFIX_MATCHERS[entry.match](subject, entry.marker);
};

// kindImpliedBySubject — which kind's role marker (if any) a subject actually carries. Used
// ONLY to make a refusal specific ("it carries _hub but is stored under standardBase"), never to
// DECIDE a block's kind (the kind column is the authority, §1). Returns undefined when no declared
// marker matches.
const kindImpliedBySubject = (subject) =>
	typeof subject !== 'string'
		? undefined
		: SCHEMA_BLOCK_KINDS.filter((oneKind) => subjectAgreesWithKind(subject, oneKind))[0];


// =====================================================================
// PROVENANCE TIERS — THE canonical four-value set (replay-block.js). Order is significant and
// preserved exactly; replay-block re-exports PROVENANCE_TIERS/isValidProvenanceTier from here.
// =====================================================================
const PROVENANCE_TIERS = [
	'spec-authoritative',
	'embedding-inferred',
	'structural',
	'user-asserted',
	// ⟪skipAI, 2026-08-10⟫ INVALID_DEBUG — the tier an edge carries when a DEBUG JUDGE produced it
	// (--useDebugJudge). It exists because the alternative was a LIE: a debug edge used to be stamped
	// 'embedding-inferred', which asserts that an embedding informed the choice. Nothing did — rule
	// 'first' takes candidate 1 unconditionally. provenanceTier is the field a consumer is most
	// likely to TRUST, so it was the worst possible place for a false claim, and a graph consumer
	// reading it would have been told the edge was inferred when it was arithmetic.
	// tqii, 2026-08-10, on seeing askMilo describe fake mappings as calibrated-confidence equivalents.
	'invalid-debug',
];
const PROVENANCE_TIER = {
	SPEC_AUTHORITATIVE: 'spec-authoritative',
	EMBEDDING_INFERRED: 'embedding-inferred',
	STRUCTURAL: 'structural',
	USER_ASSERTED: 'user-asserted',
	INVALID_DEBUG: 'invalid-debug',
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
// SKOS PREDICATES (LIVE vocabulary: schema-validator.js validates every mapping edge's predicate
// against this list; schema-view-finisher describes them. Original edf-bridge consumers retired
// 2026-07-04 — the list is NOT legacy). The only
// relation that composes to equivalence is exactMatch (WHITEPAPER §6.3). Order preserved.
// =====================================================================
const SKOS_PREDICATES = [
	'exactMatch',
	'closeMatch',
	'broadMatch',
	'narrowMatch',
	'relatedMatch',
];

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

// =====================================================================
// SSSOM JUSTIFICATIONS — the closed mapping_justification enum. AUTHORITY: the EDUcore Bridge Profile,
// SPEC-educoreBridgeProfile-v1.0.md §4.2 (system/management/zNotesPlansDocs/forgeDefinitionV2/). The
// Profile binds mapping_justification to the SEMAPV vocabulary and names THREE terms in active use;
// this registry carries exactly those three and nothing else. Adopting a reserved term (LexicalMatching,
// LogicalReasoning, …) is a Profile change (§4.2), not an edit here.
// =====================================================================
// Values are CURIEs from the SEMAPV vocabulary, stored in canonical CURIE form so an SSSOM exporter emits
// CONFORMANT values directly (bare names would be non-conformant). The 'semapv:' prefix is intrinsic.
// HISTORY (root-and-branch Phase 4, 2026-08-15): the pre-reset list carried a fourth "semantic similarity"
// term that is NOT an SSSOM/SEMAPV term at all — and the validator blessed it for weeks because it sat in
// the project's own allowlist (HARVEST-bridgeKnowledge.md §1.13). Under the Profile the inferred-path
// justification is semapv:CompositeMatching. The test beside this file holds the removed literal so the
// gate can be watched going red if it is ever re-added.
const SSSOM_JUSTIFICATIONS = [
	'semapv:ManualMappingCuration', // resolution: specified — a person named it and it resolves to one card
	'semapv:CompositeMatching', // resolution: judged — an algorithm chose, at any matchBasis
	'semapv:MappingReview', // a human reviewed and confirmed a previously judged mapping
	// ADOPTED 2026-08-17 by RULING §11.7 (b). Profile §4.2 carried this term as "Reserved and currently
	// unused" and stated that adopting one is "a SPECIFICATION CHANGE, not an implementation choice" — so it
	// is recorded here as a change, with its authority, rather than quietly appended. It is the justification
	// for a mapping whose candidates were proposed by SEMANTIC SIMILARITY above a declared threshold, which
	// is precisely what a derived producer does and what none of the three above describes.
	'semapv:SemanticSimilarityThresholdMatching',
];
// BANNED BY NAME (Profile §4.2): 'semapv:UnspecifiedMatching' means "the reason was not recorded" and a
// forge MUST NOT emit it. It is listed here, separately, so the ban is VISIBLE in the refusal a caller
// receives — not implicit in an omission from the allowlist that a later editor could "fix".
const SSSOM_JUSTIFICATIONS_BANNED = ['semapv:UnspecifiedMatching'];

// sssomJustificationRefusal — '' when the term is one of the three; otherwise the REASON, by name. Two
// distinct refusals: a BANNED term names the ban and the Profile section; anything else names the
// allowlist. There is NO boolean form (BR-145): a caller that wants a yes/no compares the refusal to ''.
const sssomJustificationRefusal = (oneJustification) => {
	if (SSSOM_JUSTIFICATIONS_BANNED.indexOf(oneJustification) !== -1) {
		return (
			`mapping_justification '${oneJustification}' is BANNED by the EDUcore Bridge Profile §4.2: it ` +
			`means the reason was not recorded, and a forge MUST NOT emit it. Nothing is substituted for it.`
		);
	}
	if (SSSOM_JUSTIFICATIONS.indexOf(oneJustification) === -1) {
		return (
			`mapping_justification ${JSON.stringify(oneJustification)} is not in the SSSOM_JUSTIFICATIONS ` +
			`allowlist (${SSSOM_JUSTIFICATIONS.join(', ')}); Profile §4.2 as amended names those and no other.`
		);
	}
	return '';
};
// isValidSssomJustification — REMOVED (BR-145 RULED, B2 vocabulary commit 2026-08-16): a boolean invited a
// caller to discard the ban's NAME. Every caller receives the reason through sssomJustificationRefusal.

// SSSOM metadata property NAMES carried on a mapping edge (and on a reified MappingAssertion). camelCase
// per the project's property-naming convention; a future SSSOM exporter maps these to the SSSOM canonical
// snake_case field names (mapping_justification, subject_source, …). The mappingMethod VALUE is a semapv CURIE
// (SSSOM_JUSTIFICATIONS; SSSOM slot mapping_justification). NOTE: there is deliberately NO mappingDate — a runtime timestamp
// would break deterministic replay; a fixed provenance date, if ever required, is supplied as data, never
// minted at produce time. Added with the bridge phases (Phase 4 authored track is the first consumer).
//
// ⟪BRIDGE FRAMEWORK, B2 vocabulary commit — 2026-08-16 (SPEC-bridgeFramework-v1.md §5.7, §14.4 step 1;
// RULINGS A7/R7/BF12; BR-143; C6)⟫ This registry is the CLOSED SET of property names a mapping edge may
// carry: `lib/bridge-framework/graphWriter.js` refuses by name any edge property outside it (the closed-set
// check is NEW there — before B2 this registry had zero consumers and nothing enforced it). Rows added
// here for the Bridge Profile's edge shape: matchBasis, resolution, mappingProvider, mappingToolVersion,
// subjectMatchField, objectMatchField, sourceLabel, predicateAssertedBy, attestationChannelList,
// decisionBlockHash. Two rows are ANNOTATED rather than added:
//   MATCH_ID        — INTERNAL (C6): a forensic key, never exported by the SSSOM exporter.
//   PROVENANCE_TIER — an ENGINE-LEVEL value on every mapping edge, DERIVED FROM producerKind (RULING
//                     SABLE_RIVER 2026-08-16 12:20, SPEC v1.1.2 / Profile v1.0.6, on the finding that
//                     lib/replay/replay-engine.js GUARD 3 refuses any edge without a valid tier):
//                     authored → 'spec-authoritative'; inferred (not in v1) → 'embedding-inferred'; a
//                     DEBUG-JUDGE block's edges → 'invalid-debug' (Profile §4.6 carve-out, RULING BF16/R5).
//                     It carries NO mapping semantics — those are matchBasis × resolution × predicate (C6)
//                     — and is NEVER exported to SSSOM. ⟪RETIRED from mapping edges by lane P, 2026-10-04: the
//                     history above is kept; see the row.⟫
// ⟪campaign P3, 2026-10-06: W-B-1 / W-B-2 / W-B-3 / W-B-4 (TQ A3, G7, V1-C06)⟫ three rows RENAMED so each name says what
// its value IS (mappingJustification → mappingMethod: a SEMAPV method, not a reason; mappingTool → judgeIdentity;
// mappingToolVersion → rendererVersion), the duplicate `confidence` RETIRED (it equalled mappingConfidence on 12,681 of
// 12,681 edges), and four judged-only rows ADDED: the judge's own numbers (judgePickConfidence, judgeTopProbability,
// judgeRunnerUpMargin — present together iff the frozen record carries a judgeSummary) and mappingRationale (present iff
// the frozen record carries the judge's text). The retired names are MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME below.
const MAPPING_PROPERTIES = {
	PREDICATE: 'predicate',
	MAPPING_METHOD: 'mappingMethod', // the SEMAPV method CURIE by which the candidate was proposed and chosen; SSSOM column mapping_justification
	SUBJECT_SOURCE: 'subjectSource',
	SUBJECT_VERSION: 'subjectVersion',
	OBJECT_SOURCE: 'objectSource',
	OBJECT_VERSION: 'objectVersion',
	JUDGE_IDENTITY: 'judgeIdentity', // the judge's model identity (JUDGE_IDENTITY_PATTERN); SSSOM column mapping_tool
	MATCH_ID: 'matchId', // INTERNAL — never exported (C6)
	// PROVENANCE_TIER — RETIRED FROM MAPPING EDGES ENTIRELY (lane P, 2026-10-04; TQ, relayed by VIOLET_VALLEY, reversing
	// ruling A1): "TQ's three fields ARE the provenance; a separate tier would say the same thing twice in other words."
	// mappingKind carries the kind; the debug marker is mappingSource 'bridge-debug' with mappingConfidence 0. With the
	// row gone the write seam refuses provenanceTier on a mapping edge by name. Structural and every other NON-mapping edge keeps
	// provenanceTier exactly as before (REQUIRED_PROPERTIES.EDGE; replay-engine GUARD 3).
	// --- B2 additions (Bridge Profile edge shape) ---
	MATCH_BASIS: 'matchBasis',
	RESOLUTION: 'resolution',
	MAPPING_PROVIDER: 'mappingProvider',
	RENDERER_VERSION: 'rendererVersion', // the evidence renderer that wrote the prompt; SSSOM column mapping_tool_version
	SUBJECT_MATCH_FIELD: 'subjectMatchField',
	OBJECT_MATCH_FIELD: 'objectMatchField',
	SOURCE_LABEL: 'sourceLabel',
	PREDICATE_ASSERTED_BY: 'predicateAssertedBy',
	ATTESTATION_CHANNEL_LIST: 'attestationChannelList',
	DECISION_BLOCK_HASH: 'decisionBlockHash',
	// ⟪SIF replacement V1, 2026-09-28; SPEC §9 A10⟫ under fan-out one judgement about a QUESTION is written as
	// one edge per instance Field, so the edge's subject is the Field and this names the question that was
	// judged. Nothing writes it yet: plan phase B4b makes the materialiser write it under fan-out only.
	JUDGED_SUBJECT_STABLE_ID: 'judgedSubjectStableId',
	// ⟪lane P, mappingProvenance 2026-10-04; TQ's design⟫ the three fields a reader can trust to say WHAT KIND of claim an
	// edge is, WHO made it and HOW SURE they were. TQ found the DME telling users an EXACT_MATCH was an "authored crosswalk
	// ... trust as fact" when every edge in the graph was a Jev judgment; these exist so no reader has to infer that from
	// matchBasis × resolution × provenanceTier. Values: MAPPING_KIND / MAPPING_SOURCE_* below.
	MAPPING_CONFIDENCE: 'mappingConfidence', // judged edges only: the judge's confidence (today the band value)
	MAPPING_KIND: 'mappingKind', // every edge: MAPPING_KIND_LIST
	MAPPING_SOURCE: 'mappingSource', // every edge: '<family>-<name>', MAPPING_SOURCE_FAMILY_LIST
	// ⟪W-B-3 / G7⟫ the judge's OWN numbers, copied from the frozen record's judge.judgeSummary (judged edges only, all three
	// or none: a provider that reports no number — anthropic, ollama, debug — gives none)
	JUDGE_PICK_CONFIDENCE: 'judgePickConfidence',
	JUDGE_TOP_PROBABILITY: 'judgeTopProbability',
	JUDGE_RUNNER_UP_MARGIN: 'judgeRunnerUpMargin',
	// ⟪W-B-4 / V1-C06⟫ the judge's recorded text for this pick, verbatim from the frozen record (judged edges only, present iff
	// the plugin opted in with blockRecordsJudgeConfig). Jev's is a sentence its client composed from the numbers and says so.
	MAPPING_RATIONALE: 'mappingRationale',
};
// RETIRED edge property names → the name that replaced each. graphSeamRules refuses a retired name BY ITS REPLACEMENT, and
// the DME contract gate (graphContract.json retiredMatchEdgePropertyNameList) refuses a Cypher read of one.
const MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME = Object.freeze({
	mappingJustification: MAPPING_PROPERTIES.MAPPING_METHOD,
	mappingTool: MAPPING_PROPERTIES.JUDGE_IDENTITY,
	mappingToolVersion: MAPPING_PROPERTIES.RENDERER_VERSION,
	confidence: MAPPING_PROPERTIES.MAPPING_CONFIDENCE,
});
// JUDGE_IDENTITY_PATTERN — '<providerName>:<providerTail>'. providerName is a judgeProviderRegistry row (its
// providerNameForJudgeModel is the resolver: a prefix test, never a split, because a wire model may itself contain ':').
// Tails today: jev '<wireModel>:<requestForm>:cfg-<12hex>'; anthropic and ollama '<wireModel>'; debug '<rule>'.
const JUDGE_IDENTITY_PATTERN = /^[a-z][A-Za-z0-9]*:[^\s]+$/;
// JUDGE_SUMMARY_FIELD_LIST — the judge's OWN numbers when its provider reports any, carried VERBATIM: the provider's
// return → the judgment → the cache row → the forensic record → the frozen record's judge.judgeSummary. Never derived,
// never banded (the band is mappingConfidence). null for a provider that reports none. A partial probability map is refused.
const JUDGE_SUMMARY_FIELD_LIST = Object.freeze([
	'judgePickConfidence', // number [0,1]: the provider's confidence in its pick (Jev: answer.confidence)
	'judgeTopProbability', // number [0,1]: the probability of the option chosen (Jev: probabilities[choice]; NONE included)
	'judgeRunnerUpMargin', // number [-1,1]: judgeTopProbability minus the largest probability over the OTHER options
	'judgeProbabilityByChoice', // object: every offered option ('1'..'N', 'NONE') → probability
	'judgeRelationConfidence', // number | null: the relation question's confidence (a pick under judgeSlot-v1 only)
	'judgeRelationProbabilityByPredicate', // object | null: exactMatch / closeMatch / broadMatch / narrowMatch → probability
]);
// judgeSummaryRefusal(candidate) → '' | the reason, by name. null is lawful (a provider that reports no number). An object
// must carry EXACTLY JUDGE_SUMMARY_FIELD_LIST, each number finite and in its range, each map non-empty with finite
// probabilities, and the two relation members null together or present together. Whether the probability map covers the
// options actually OFFERED is the judgment component's check (only it holds the question). One function, read by the
// judgment component, the judgment cache and the gates, so the three cannot disagree about what a summary is.
const isUnitNumber = (candidate) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 1;
const isProbabilityMap = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) && Object.keys(candidate).length > 0 && Object.keys(candidate).every((oneName) => isUnitNumber(candidate[oneName]));
const judgeSummaryRefusal = (candidate) => {
	if (candidate === null) {
		return '';
	}
	if (candidate === undefined || typeof candidate !== 'object' || Array.isArray(candidate)) {
		return `judgeSummary ${JSON.stringify(candidate)} is neither null nor an object`;
	}
	const keyList = Object.keys(candidate).sort();
	if (JSON.stringify(keyList) !== JSON.stringify(JUDGE_SUMMARY_FIELD_LIST.slice().sort())) {
		return `judgeSummary carries [${keyList.join(', ')}], not exactly JUDGE_SUMMARY_FIELD_LIST [${JUDGE_SUMMARY_FIELD_LIST.join(', ')}]`;
	}
	if (!isUnitNumber(candidate.judgePickConfidence) || !isUnitNumber(candidate.judgeTopProbability)) {
		return `judgeSummary judgePickConfidence ${JSON.stringify(candidate.judgePickConfidence)} / judgeTopProbability ${JSON.stringify(candidate.judgeTopProbability)} must be numbers in [0, 1]`;
	}
	if (typeof candidate.judgeRunnerUpMargin !== 'number' || !Number.isFinite(candidate.judgeRunnerUpMargin) || candidate.judgeRunnerUpMargin < -1 || candidate.judgeRunnerUpMargin > 1) {
		return `judgeSummary judgeRunnerUpMargin ${JSON.stringify(candidate.judgeRunnerUpMargin)} must be a number in [-1, 1]`;
	}
	if (!isProbabilityMap(candidate.judgeProbabilityByChoice)) {
		return `judgeSummary judgeProbabilityByChoice ${JSON.stringify(candidate.judgeProbabilityByChoice)} must be a non-empty map of probabilities in [0, 1]`;
	}
	const relationMemberNullCount = [candidate.judgeRelationConfidence, candidate.judgeRelationProbabilityByPredicate].filter((oneValue) => oneValue === null).length;
	if (relationMemberNullCount === 1) {
		return 'judgeSummary judgeRelationConfidence and judgeRelationProbabilityByPredicate are null together or present together';
	}
	if (relationMemberNullCount === 0 && (!isUnitNumber(candidate.judgeRelationConfidence) || !isProbabilityMap(candidate.judgeRelationProbabilityByPredicate))) {
		return `judgeSummary relation members ${JSON.stringify(candidate.judgeRelationConfidence)} / ${JSON.stringify(candidate.judgeRelationProbabilityByPredicate)} must be a number in [0, 1] and a non-empty probability map`;
	}
	return '';
};
// the summary members an edge carries (G7: "carry Jev's confidence and probabilities"), each under its own edge name
const JUDGE_SUMMARY_EDGE_PROPERTY_LIST = Object.freeze([MAPPING_PROPERTIES.JUDGE_PICK_CONFIDENCE, MAPPING_PROPERTIES.JUDGE_TOP_PROBABILITY, MAPPING_PROPERTIES.JUDGE_RUNNER_UP_MARGIN]);
// SSSOM_COLUMN_BY_EDGE_PROPERTY — the SSSOM standard (and declared extension) column each edge property is exported as.
// The exporter reads FROZEN RECORDS, never edges; this records the correspondence once, and sssomExporter asserts every
// column named here is one it writes.
const SSSOM_COLUMN_BY_EDGE_PROPERTY = Object.freeze({
	[MAPPING_PROPERTIES.MAPPING_METHOD]: 'mapping_justification',
	[MAPPING_PROPERTIES.JUDGE_IDENTITY]: 'mapping_tool',
	[MAPPING_PROPERTIES.RENDERER_VERSION]: 'mapping_tool_version',
	[MAPPING_PROPERTIES.MAPPING_CONFIDENCE]: 'confidence',
	[MAPPING_PROPERTIES.PREDICATE_ASSERTED_BY]: 'predicate_asserted_by',
	[MAPPING_PROPERTIES.SOURCE_LABEL]: 'source_label',
	[MAPPING_PROPERTIES.SUBJECT_MATCH_FIELD]: 'subject_match_field',
	[MAPPING_PROPERTIES.OBJECT_MATCH_FIELD]: 'object_match_field',
	[MAPPING_PROPERTIES.JUDGE_TOP_PROBABILITY]: 'judge_top_probability',
	[MAPPING_PROPERTIES.JUDGE_RUNNER_UP_MARGIN]: 'judge_runner_up_margin',
	[MAPPING_PROPERTIES.JUDGE_PICK_CONFIDENCE]: 'judge_pick_confidence',
	[MAPPING_PROPERTIES.MAPPING_RATIONALE]: 'mapping_rationale',
});
// CONFIDENCE_BAND_TABLE — the judge's discrete CATEGORY → the discrete mappingConfidence a judged edge carries (moved here
// from lib/bridge-framework/confidenceBandTable.js, which re-exports it, W-B-3). A BAND of the judge's category, never the
// judge's number; projected into the SchemaView as kind confidenceBand. Which confidence floors derived a category is
// stated per block (header judgeCategoryFloorByCategory), not here.
const CONFIDENCE_BAND_TABLE = Object.freeze({ strong: 0.9, moderate: 0.7, weakButReal: 0.5 });
// MAPPING_KIND — what kind of claim a mapping edge is, keyed by the record's RESOLUTION (DATA, no branch). A JUDGED edge
// is inferred: an algorithm chose the card, whoever proposed the candidates. A SPECIFIED edge is authored: a document named
// the card. 'authored' is in the vocabulary although the live graph has none, because the framework still writes authored
// edges (crosswalk and standard-declared producers) and its toy suites exercise them.
// A DEBUG-judge edge is 'inferred' like any judged edge (TQ, 2026-10-04: there is no debug kind). What marks it is WHO
// made it: mappingSource 'bridge-debug', with mappingConfidence 0 (judgeProviderRegistry.FIXED_MAPPING_CONFIDENCE_BY_PROVIDER_NAME).
const MAPPING_KIND = Object.freeze({ INFERRED: 'inferred', AUTHORED: 'authored' });
const MAPPING_KIND_LIST = Object.freeze([MAPPING_KIND.INFERRED, MAPPING_KIND.AUTHORED]);
const MAPPING_KIND_BY_RESOLUTION = Object.freeze({ judged: MAPPING_KIND.INFERRED, specified: MAPPING_KIND.AUTHORED });
// MAPPING_SOURCE — '<family><separator><name>'. A judged edge's family is 'bridge' and its name is the judge provider's
// registered name (judgeProviderRegistry.providerNameForJudgeModel, never a literal): 'bridge-jev'. A specified edge's
// family is the document kind its matchBasis names and its name is the bridge plugin's: 'crosswalk-<bridgeName>'. Each
// family belongs to exactly one kind, so the writer can hold the two fields to each other. The NAME is the ACTUAL
// judge's, read from its identity (TQ, 2026-10-04): 'bridge-jev', 'bridge-jevOpus', 'bridge-debug'.
const MAPPING_SOURCE_SEPARATOR = '-';
const MAPPING_SOURCE_FAMILY = Object.freeze({ BRIDGE: 'bridge', CROSSWALK: 'crosswalk', STANDARD: 'standard' });
const MAPPING_KIND_BY_MAPPING_SOURCE_FAMILY = Object.freeze({
	[MAPPING_SOURCE_FAMILY.BRIDGE]: MAPPING_KIND.INFERRED,
	[MAPPING_SOURCE_FAMILY.CROSSWALK]: MAPPING_KIND.AUTHORED,
	[MAPPING_SOURCE_FAMILY.STANDARD]: MAPPING_KIND.AUTHORED,
});
const MAPPING_SOURCE_FAMILY_LIST = Object.freeze(Object.keys(MAPPING_KIND_BY_MAPPING_SOURCE_FAMILY));
// the authored family a SPECIFIED record's matchBasis names; 'derived' has none, so a specified record in a derived block
// is refused by name rather than given a family it does not have
const MAPPING_SOURCE_FAMILY_BY_AUTHORED_MATCH_BASIS = Object.freeze({ crosswalk: MAPPING_SOURCE_FAMILY.CROSSWALK, standard: MAPPING_SOURCE_FAMILY.STANDARD });
// the NAME half: a provider or plugin name as the registries spell them (lower-case initial, then alphanumerics). It
// excludes the separator, so '<family>-<name>' parses one way only.
const MAPPING_SOURCE_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;
// mappingSourceRefusal(mappingSource) → '' | the reason, by name; on '' the family is MAPPING_SOURCE_FAMILY_LIST's
const mappingSourceRefusal = (mappingSource) => {
	if (typeof mappingSource !== 'string') {
		return `mappingSource ${JSON.stringify(mappingSource)} is not a string`;
	}
	const separatorIndex = mappingSource.indexOf(MAPPING_SOURCE_SEPARATOR);
	const family = separatorIndex === -1 ? mappingSource : mappingSource.slice(0, separatorIndex);
	if (MAPPING_SOURCE_FAMILY_LIST.indexOf(family) === -1) {
		return `mappingSource '${mappingSource}' does not begin with a family (${MAPPING_SOURCE_FAMILY_LIST.map((oneFamily) => oneFamily + MAPPING_SOURCE_SEPARATOR).join(', ')})`;
	}
	if (!MAPPING_SOURCE_NAME_PATTERN.test(mappingSource.slice(separatorIndex + 1))) {
		return `mappingSource '${mappingSource}' names no source after '${family}${MAPPING_SOURCE_SEPARATOR}' matching ${MAPPING_SOURCE_NAME_PATTERN}`;
	}
	return '';
};
const mappingSourceFamilyOf = (mappingSource) => mappingSource.slice(0, mappingSource.indexOf(MAPPING_SOURCE_SEPARATOR));
const composeMappingSource = ({ family, sourceName }) => `${family}${MAPPING_SOURCE_SEPARATOR}${sourceName}`;
// the property NAMES a mapping edge may carry — derived from the registry above; the writer's closed set
const MAPPING_PROPERTY_NAME_LIST = Object.freeze(Object.keys(MAPPING_PROPERTIES).map((oneMember) => MAPPING_PROPERTIES[oneMember]));
// MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND and MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST are RETIRED with
// provenanceTier's place on mapping edges (lane P, 2026-10-04). The producer kinds a mapping block may have, which
// conflictDetector read off the first table's keys, are declared here in their own right.
const MAPPING_PRODUCER_KIND_LIST = Object.freeze(['authored', 'inferred']);
// STANDARD_KIND — what kind of standard a StandardDefinition card describes (lane P, 2026-10-04; TQ via VIOLET_VALLEY): a data
// standard (elements that map to the hub) or a classification taxonomy (codes that classify, CIP / SOC). Every current
// standard is a dataStandard. ⟪lane R, 2026-10-05; TQ⟫ DECLARED by each standard's forge declaration (standardKind, beside its
// standardUsageTips), stamped on the standard's root by the framework, and read from the root by the StandardDefinition
// finisher. The configs/dmeStandardUsageTips.json stopgap is retired.
const STANDARD_KIND = Object.freeze({ DATA_STANDARD: 'dataStandard', CLASSIFICATION_TAXONOMY: 'classificationTaxonomy' });
const STANDARD_KIND_LIST = Object.freeze([STANDARD_KIND.DATA_STANDARD, STANDARD_KIND.CLASSIFICATION_TAXONOMY]);
// STANDARD_FAMILY — the family a standard belongs to (campaign P3, W-C-4; CONTRACTS §7; ruling A5: a family name in a DME
// standard filter expands to its releases). A CLOSED word list, so a family is DECLARED by each forge (forge declaration
// standardFamily, stamped on the root, read by the StandardDefinition finisher) and never inferred from a _source prefix.
// Toy is the forge framework's own fixture standard: it is in no recipe that builds a gold, and declares itself honestly.
const STANDARD_FAMILY = Object.freeze({ CEDS: 'CEDS', EDFI: 'EdFi', SIF: 'SIF', PESC: 'PESC', TOY: 'Toy' });
const STANDARD_FAMILY_LIST = Object.freeze(Object.keys(STANDARD_FAMILY).map((oneMember) => STANDARD_FAMILY[oneMember]));
// BUILD_ATTESTATION_VERDICT — the words a :BuildAttestation row's verdict may be (lane R, 2026-10-05; FINDING 5-A of 2026-09-01).
//   pass                 the gate ran and found nothing wrong
//   fail                 the gate ran and refused (the promotion stamp records one; a failed build gate stops the build)
//   notRun               the gate did not run (skipped, or not applicable to this build); never read as pass
//   passWithAllowedLoss  the gate ran and passed ONLY because the operator named the loss it found (--allowFidelityLoss):
//                        the build is knowingly incomplete, and the row must not say plain pass
const BUILD_ATTESTATION_VERDICT = Object.freeze({ PASS: 'pass', FAIL: 'fail', NOT_RUN: 'notRun', PASS_WITH_ALLOWED_LOSS: 'passWithAllowedLoss' });
const BUILD_ATTESTATION_VERDICT_LIST = Object.freeze(Object.keys(BUILD_ATTESTATION_VERDICT).map((oneMember) => BUILD_ATTESTATION_VERDICT[oneMember]));

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
	// while the live graph carries _id/_source as properties.
	// ⟪campaign P2, W-A-10 / V1-C26⟫ RESTATED PER ROLE CLASS. The single NODE list claimed name and searchText on every
	// content node; measured on the acceptance gold, searchText is absent on 197,969 content nodes (every hub card and
	// every text node, by design) and name on 37,467. The class decides the set: a node of a role its forge declares
	// non-embeddable carries no searchText (and no vector); a DmeEmbedText carries its text and vector declaration; a hub
	// card carries embedText; a hub definition carries the HUB_DEFINITION set. name is RECOMMENDED, not required.
	// Enforced at forge time (forge-framework integrity pass: embeddable / nonEmbeddable) and at finish time
	// (required-property-finisher: every class, over the finished graph).
	NODE_BY_ROLE_CLASS: Object.freeze({
		embeddable: Object.freeze(['_id', '_source', 'role', 'searchText']),
		nonEmbeddable: Object.freeze(['_id', '_source', 'role']),
		embedText: Object.freeze(['_id', '_source', 'role', 'text', 'vectorPropertyName', 'embedSourceProperty']),
		hubReference: Object.freeze(['_id', '_source', 'role', 'embedText', 'embedSourceProperty']),
		hubDefinition: Object.freeze(['_id', '_source', 'role']),
	}),
	NODE_RECOMMENDED: Object.freeze(['name']),
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
		// ⟪campaign P3, W-C-4⟫ the family and which member of it (forge-declared; CONTRACTS §7)
		'standardFamily',
		'releaseLabel',
	],
	// every NON-mapping edge carries a provenance tier (replay-engine GUARD 3); a mapping edge (a SKOS_EDGE_TYPES type)
	// carries mappingKind instead and must NOT carry provenanceTier (lane P, 2026-10-04)
	EDGE: ['provenanceTier'],
	MAPPING_EDGE: ['mappingKind'],
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
	// ⟪campaign P2, W-A-12⟫ LABEL removed: 'label' is absent on all 94,602 live cards and nothing wrote it
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
// CEDS_HUB_EDGE_TYPES WAS HERE AND IS DELETED (Phase 2c, RULING FJ-P2-3; SPEC §4.8(2)).
// It was the concrete CEDS instantiation of the five slots, and it equalled
// HUB_DECOMPOSITION_SLOTS.map(slot => hubEdgeType('CEDS', slot)) on every slot — verified by CALLING
// both, twice, once by COPPER_HORIZON (STANDDOWN-P1 A.1) and again in Phase 2c rather than cited.
// The generator above now serves every reader, so a per-hub constant here was a second home for a
// value the generator already produces, and R7 puts standard-specific material in the forges.
//
// ITS DELETION IS BYTE-NEUTRAL and the CEDS re-forge is what proves it: the five edge-type strings
// HAS_CEDS_DOMAIN / _PROPERTY / _RANGE / _VALUE / _QUALIFIER are unchanged and still stamped on
// ~94,602 edges each — the NAMES did not go away, only this constant did. That distinction is also
// why RULING FJ-P2-1 KEPT their definitions in vocabulary-definitions.js and WITHDREW SPEC §4.8(3):
// a definition describing a live thing is documentation, not dead weight.

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
// SEQUENCE PROPERTY NAMES (design-authority upgrade to the SIF sequence-capture work order,
// 2026-07-30) — registered here for the SAME reason STRUCTURAL_PROPERTIES is: one canonical name per
// property, read by lib/sequence-contract/sequence-contract.js (the finalizer that stamps them) and
// any future consumer, never a per-standard literal. sequenceOrdinal/siblingCount are ADDITIVE
// extraProps a forge gains only if it calls finalizeSequence; orderSemantics states HONESTLY whether
// the caller's parser verified a schema-ordered group ('normative') or only knows document/source
// order ('document') — never a guess. See lib/sequence-contract/sequence-contract.js for the full
// contract.
// =====================================================================
const SEQUENCE_PROPERTIES = {
	SEQUENCE_ORDINAL: 'sequenceOrdinal',
	SIBLING_COUNT: 'siblingCount',
	ORDER_SEMANTICS: 'orderSemantics',
};
const SEQUENCE_ORDER_SEMANTICS_VALUES = ['normative', 'document'];
const isValidSequenceOrderSemantics = (oneValue) => SEQUENCE_ORDER_SEMANTICS_VALUES.indexOf(oneValue) !== -1;

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
	// ⟪N7, adversarial review 2026-08-31⟫ the MEMBER stableId prefix — the one metadata id scheme that was
	// described only in a comment while its five SELF_DOC siblings were declared constants. Member ids are
	// `schemaView:<kind>:<value>`. Registered here rather than in SELF_DOC, next to ROOT_STABLE_ID, because
	// that is where this family's OTHER id already lives; splitting the root id from the member prefix
	// across two blocks would be the same schema-as-code violation one level down. An id scheme stated only
	// in prose is a literal waiting to be retyped differently by the next reader.
	MEMBER_STABLE_ID_PREFIX: 'schemaView:', // + `<kind>:<value>`
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
		// Wave B (self-documentation): the range shapes a property-tier hub address can carry, and the
		// slots of the hub tuple model — enumerated so the view documents the addressing model itself.
		RANGE_SHAPE: 'rangeShape',
		TUPLE_SLOT: 'tupleSlot',
		// ⟪campaign P2, W-A-6 / V1-C20⟫ the graph contract projected into the graph: one member per declared field, each
		// carrying the contract row's own meaning (graph-contract §3, §4, §5) and per declared list/integer name (§1, §2).
		// matchEdgeProperty and confidenceBand (CONTRACTS §9) are the last two kinds (campaign P3).
		PASSPORT_FIELD: 'passportField',
		ATTESTATION_FIELD: 'attestationField',
		SELF_DOC_FIELD: 'selfDocField',
		LIST_VALUED_PROPERTY: 'listValuedProperty',
		INTEGER_VALUED_PROPERTY: 'integerValuedProperty',
		// ⟪campaign P3, W-B-1..4⟫ the mapping-edge property set and the confidence bands, with their definitions
		MATCH_EDGE_PROPERTY: 'matchEdgeProperty',
		CONFIDENCE_BAND: 'confidenceBand',
	},
};

// the three mutually-exclusive range shapes of a property-tier hub address (CANONICAL_ADDRESS_PROPERTIES:
// rangeOptionSetId | rangeClassId | rangeDatatype — INVESTIGATION-rangelessHubs-070126.md). Enumerated for
// the schema view's rangeShape kind (Wave B).
const RANGE_SHAPES = ['optionSet', 'class', 'datatype'];

// =====================================================================
// SELF-DOCUMENTATION VOCABULARY (Wave B — PLAN-inGraphSelfDocumentationEnrichment-070126.md; WORKORDER-
// inferenceAndSelfDoc-070226.md WAVE B). The manifest recipe + per-standard definitions materialized IN-GRAPH
// at finishing time so a bolt-only consumer can read what the graph is and how it was built. All nodes are
// deterministic functions of the manifest/store rows the replay already reads plus the built graph itself.
// =====================================================================
const SELF_DOC = {
	NODE_LABELS: {
		MANIFEST_RECIPE: 'ManifestRecipe',
		RECIPE_BLOCK: 'RecipeBlock',
		STANDARD_DEFINITION: 'StandardDefinition',
		// ⟪graphSelfDoc, 2026-08-31⟫ the two node types the `finish` verb adds (ARCH-replayManager-083126
		// §8 registry members 5 and 6). BuildAttestation is the only genuinely NEW type in the design —
		// gate verdicts previously lived only in log files and a work-order docket, which is why "a gate
		// that never ran" was unrepresentable in the graph and therefore uncheckable from a bolt session.
		USAGE_PATTERN: 'UsagePattern',
		BUILD_ATTESTATION: 'BuildAttestation',
	},
	EDGE_TYPES: {
		BUILT_FROM: 'BUILT_FROM', // GraphProvenance passport -> ManifestRecipe (created by passport-writer.write)
		HAS_BLOCK: 'HAS_BLOCK', // ManifestRecipe -> RecipeBlock member
		BASED_ON: 'BASED_ON', // ManifestRecipe -> parent ManifestRecipe (the lineage)
		// ⟪graphSelfDoc, 2026-08-31⟫ the remaining PASSPORT-ROOTED edges. Every edge that roots the
		// metadata tree hangs off GraphProvenance, which is deliberately NOT :ForgedNode (it carries
		// builtAt, a clock). So these four — like BUILT_FROM above — are created by the Channel-B passport
		// writer with MATCH on the far endpoint, NEVER MERGE-create: a disabled finisher leaves its target
		// absent, the MATCH yields zero rows, and no edge appears. Honest degradation over an invented link.
		DESCRIBES: 'DESCRIBES', // GraphProvenance -> StandardDefinition (one per standard)
		HAS_VIEW: 'HAS_VIEW', // GraphProvenance -> SchemaView root
		ATTESTS: 'ATTESTS', // GraphProvenance -> BuildAttestation (one per gate)
		ADVISES: 'ADVISES', // GraphProvenance -> UsagePattern (one per named question)
		// ⟪graphSelfDoc, 2026-08-31⟫ the one metadata->CONTENT edge, and the only new edge that is NOT
		// passport-rooted: both endpoints are :ForgedNode, so it is written on Channel A through
		// writeShapedGraph like any other content edge (ARCH §7). It is the hop that lets a consumer get
		// from the build's view of a standard to the parsed standard itself.
		DEFINES: 'DEFINES', // StandardDefinition -> DmeStandardRoot
	},
	PROVENANCE_TIER: PROVENANCE_TIER.STRUCTURAL, // self-doc edges carry the structural tier
	MANIFEST_RECIPE_STABLE_ID_PREFIX: 'manifestRecipe:', // + manifestRefId
	RECIPE_BLOCK_STABLE_ID_PREFIX: 'recipeBlock:', // + schemaBlockRefId
	STANDARD_DEFINITION_STABLE_ID_PREFIX: 'standardDefinition:', // + _source
	USAGE_PATTERN_STABLE_ID_PREFIX: 'usagePattern:', // + patternName
	BUILD_ATTESTATION_STABLE_ID_PREFIX: 'buildAttestation:', // + gate name
};

// =====================================================================
// GRAPH-META MARKER (Wave B — CRIMSON gate 6). The STRUCTURAL purity exemption: every legitimately
// source-less node carries :GraphMeta, stamped by the graph-meta finisher (the GraphProvenance passport,
// minted after finishing, stamps itself in passport-writer.write). The G2 purity gate becomes:
// for EVERY node, (_source IS NOT NULL) XOR (:GraphMeta) — a new meta node type is ONE entry in
// META_NODE_LABELS; the gate needs zero edits.
// =====================================================================
const GRAPH_META = {
	LABEL: 'GraphMeta',
	// NOTE (Wave B correction to the workorder's gate-6 enumeration, reported to SCARLET_PEAK):
	// HubDefinition is NOT here — it is BLOCK CONTENT carrying an honest `_source: hubName`
	// (reference-subgraph/referenceSubgraph.js:422), so the XOR invariant already covers it on the
	// _source side; stamping it :GraphMeta would make it a both-sides violation.
	META_NODE_LABELS: [
		SCHEMA_VIEW.LABEL,
		SELF_DOC.NODE_LABELS.MANIFEST_RECIPE,
		SELF_DOC.NODE_LABELS.RECIPE_BLOCK,
		SELF_DOC.NODE_LABELS.STANDARD_DEFINITION,
		// ⟪graphSelfDoc, 2026-08-31⟫ the two new meta types. This list is the WHOLE cost of adding a
		// metadata node type: the XOR gate query is never edited, which is the entire reason the rule is
		// expressed as (_source IS NOT NULL) XOR (:GraphMeta) rather than as an allow-list of labels
		// maintained by whoever remembers the allow-list exists.
		SELF_DOC.NODE_LABELS.USAGE_PATTERN,
		SELF_DOC.NODE_LABELS.BUILD_ATTESTATION,
		NODE_LABELS.GRAPH_PROVENANCE,
	],
};

// the human definitions for every term the registry enumerates (authored schema-as-code, sibling file).
// The schema-view finisher REFUSES a member with no definition — new registry terms REQUIRE a definition.
const { TERM_DEFINITIONS } = require('./vocabulary-definitions');

const vocabulary = {
	NODE_LABELS,
	DME_ROLES,
	EDGE_TYPES,
	EMBED_TEXT_VECTOR,
	EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE,
	MAPPING_EDGE_TYPES,
	CLASSIFICATION_EDGE_TYPES,
	// schema block taxonomy (targetArchitectureDesign §2 — LOCKED)
	SCHEMA_BLOCK_KIND,
	SCHEMA_BLOCK_KINDS,
	// subject role marker ↔ kind (implementationPlan_hubPort_072326 §1)
	SCHEMA_BLOCK_KIND_SUFFIX,
	suffixMarkerForKind,
	subjectAgreesWithKind,
	kindImpliedBySubject,
	// relationship producer suffix ↔ (pair × producer) block name (implementationPlan_bridge_072426 §7)
	RELATIONSHIP_PRODUCER_SUFFIX,
	suffixForRelationshipProducer,
	// the OPT-IN subject discriminator (Phase 7) — ONE authored pattern, shared by the composer, both
	// parsers here and the bridge declaration contract's kind-checker, so every reader agrees by construction
	RELATIONSHIP_DISCRIMINATOR_SEPARATOR,
	RELATIONSHIP_DISCRIMINATOR_PATTERN,
	RELATIONSHIP_DISCRIMINATOR_TAIL_PATTERN,
	subjectWithoutRelationshipDiscriminator,
	relationshipSubject,
	relationshipProducerFromSubject,
	// pair / version-key vocabulary (Phase C)
	// structural-bridge vocabulary (forgeArchitectureRefactor S1)
	PROVENANCE_TIERS,
	PROVENANCE_TIER,
	isValidProvenanceTier,
	EDGE_TYPE_RE,
	isValidEdgeType,
	SKOS_PREDICATES,
	SKOS_EDGE_TYPES,
	SSSOM_JUSTIFICATIONS,
	SSSOM_JUSTIFICATIONS_BANNED,
	sssomJustificationRefusal,
	MAPPING_PROPERTIES,
	MAPPING_PROPERTY_NAME_LIST,
	MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME,
	JUDGE_IDENTITY_PATTERN,
	JUDGE_SUMMARY_FIELD_LIST,
	judgeSummaryRefusal,
	JUDGE_SUMMARY_EDGE_PROPERTY_LIST,
	SSSOM_COLUMN_BY_EDGE_PROPERTY,
	CONFIDENCE_BAND_TABLE,
	MAPPING_PRODUCER_KIND_LIST,
	STANDARD_KIND,
	STANDARD_KIND_LIST,
	STANDARD_FAMILY,
	STANDARD_FAMILY_LIST,
	BUILD_ATTESTATION_VERDICT,
	BUILD_ATTESTATION_VERDICT_LIST,
	MAPPING_KIND,
	MAPPING_KIND_LIST,
	MAPPING_KIND_BY_RESOLUTION,
	MAPPING_SOURCE_SEPARATOR,
	MAPPING_SOURCE_FAMILY,
	MAPPING_KIND_BY_MAPPING_SOURCE_FAMILY,
	MAPPING_SOURCE_FAMILY_BY_AUTHORED_MATCH_BASIS,
	mappingSourceRefusal,
	mappingSourceFamilyOf,
	composeMappingSource,
	UNIQUENESS_KEYS,
	REQUIRED_PROPERTIES,
	// equivalence vocabulary (Phase 3)
	EQUIVALENCE_NODE_LABELS,
	REFERENCE_TIERS,
	REFERENCE_TIER,
	CANONICAL_ADDRESS_PROPERTIES,
	HUB_REFERENCE_PROPERTIES,
	HUB_DEFINITION_PROPERTIES,
	HUB_DECOMPOSITION_SLOTS,
	HUB_DECOMPOSITION_EDGE_TYPES,
	IN_HUB_EDGE_TYPE,
	hubEdgeType,
	ADDRESS_SIGNATURE_FIELD_ORDER,
	// structural property names (Wave-2 items 5/6)
	STRUCTURAL_PROPERTIES,
	// sequence property names (design-authority upgrade, 2026-07-30 — lib/sequence-contract)
	SEQUENCE_PROPERTIES,
	SEQUENCE_ORDER_SEMANTICS_VALUES,
	isValidSequenceOrderSemantics,
	// schema-view vocabulary (Phase 7)
	SCHEMA_VIEW,
	// self-documentation vocabulary (Wave B)
	RANGE_SHAPES,
	SELF_DOC,
	GRAPH_META,
	TERM_DEFINITIONS,
	// the graph contract (CONTRACTS-declared-100626 §0-§5; campaign P0, 2026-10-06): declared in its own pure-data file,
	// re-exported here so there is still one import surface. graph-contract.js must never require this file at its top.
	...require('./graph-contract'),
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
