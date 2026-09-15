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
			'The single build passport node per graph: what was built, from which manifest, when, by which engine versions. Non-deterministic (carries builtAt), so it is excluded from content fingerprints. It is a SINGLETON, found by MERGE on the property `passportKey`, whose value is the constant \'graphProvenance\' rather than the graph name — so GNC-001 promotion-by-rename cannot orphan it. THE -Key SUFFIX IS A DELIBERATE, DOCUMENTED EXCEPTION to this codebase\'s refId idiom (ruled 2026-08-31, GRANITE_ECHO): `passportKey` identifies nothing among alternatives — it is a constant discriminator whose entire job is to make MERGE find the one passport. `passportRefId` would assert an identity it does not have, and `passportName` would misdescribe it just as surely, since \'graphProvenance\' is not the passport\'s name. A rename that satisfies the lexicon by making the word LESS accurate is the wrong trade. If you are grepping for -Key violations, stop here: this one is ruled, not overlooked.',
		HubDefinition:
			'The per-hub descriptor node (one per hub standard, e.g. CEDS): hub name, version, canonical key scheme, slot profile. The anchor every HubReference belongs to via IN_HUB.',
		DmeEditHistoryEntry:
			'One record of a CEDS element\'s own change history: what changed, in which version, and the GitHub issue that drove it. Anonymous in the source, so its identity is DERIVED as <ownerUri>#editHistory/<sequence>, and `sequence` is position in the SOURCE FILE rather than in time -- CEDS\'s own ordering is untidy and tidying it would break round-trip fidelity. Carries no embedding, so it never enters semantic search.',
		DmeRestriction:
			'An owl:Restriction block: a class\'s constraint that a named property takes all its values from a named target. Its two references are PROPERTIES, not edges -- a restriction constrains a property, it does not contain one, and an edge would assert a traversal CEDS never makes. Anonymous in the source; identity derived like DmeEditHistoryEntry. Carries no embedding.',
		DmeVocabularyTerm:
			'A term CEDS defines for its OWN vocabulary -- textFormat, changeVersion, editHistory, issueLink -- rather than a data element. CEDS assigns these no dc:identifier because they are grammar, so the forge MINTS one (VT<localName>) and flags it cedsIdIsMinted so a minted id is never mistaken for one the standard assigned. Carries no embedding and no data role, so it is invisible to both the explorer\'s browse and its search.',
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
		UsagePattern:
			'One named question a consumer can ask this graph, carried as an EXECUTABLE exemplar: the question in words, the cypher that answers it, the label to enter from, and a caveat naming what the answer must not be taken to mean. The finisher RUNS each exemplar and refuses to write one that returns no rows, so a pattern that has rotted fails the build rather than teaching a stale traversal to whatever reads it next.',
		BuildAttestation:
			'One gate\'s verdict on this build: which gate, what it said, the supporting detail, and the invention total where the gate produces one. `notRun` is a FIRST-CLASS verdict and is deliberately distinguishable from `pass` — a gate that did not run must never read as a gate that succeeded, which is the entire content of the goldEvalCheck promotion gate and was unrepresentable in the graph before this node type existed. MIXED POPULATION — READ THIS BEFORE COMPARING BUILDS (ruled 2026-09-01, GRANITE_ECHO): the rows carrying this label DO NOT ALL SHARE A SCOPE. Most are written on Channel A through the shared write path and carry :ForgedNode, so they sit inside the determinism fingerprint. The `usagePatternVerification` row does NOT carry :ForgedNode: it is written on Channel B by the passport writer and carries :GraphMeta instead. WHY: its verdict is the finish-time exemplar check, which cannot be computed until the passport exists, and the passport is excluded from fingerprints by construction because it carries a clock. :ForgedNode is a SCOPE MARKER meaning \'this node participates in the determinism fingerprint\', not a family badge — so a node whose value derives from a fingerprint-EXCLUDED node cannot coherently sit inside fingerprint scope. Twin builds could legitimately differ in it for reasons the fingerprint is designed not to see, and the determinism gate would then go red on healthy builds. CONSUMER WARNING, in plain words: A DIFF SCOPED TO :ForgedNode DELIBERATELY OMITS THIS ROW. To compare attestation populations across builds, query (:BuildAttestation) — NOT (:ForgedNode:BuildAttestation), which will silently drop the one row that says whether the graph\'s usage manual was verified. If you have just found this asymmetry: it is RULED, not overlooked.',
	},
	edgeType: {
		HAS_CLASS: 'Standard root or container to a class/entity node it declares.',
		HAS_PROPERTY: 'Class (or root) to a property/field it carries.',
		HAS_OPTION_SET: 'Property or root to the enumerated option set constraining its values.',
		HAS_VALUE: 'Option set to one of its enumerated option values.',
		SUBCLASS_OF: 'Class to its parent class (specialization hierarchy within one standard).',
		HAS_RESTRICTION:
			'Class to one of its owl:Restriction blocks. Ordered by the block\'s `sequence`, which is its position in the SOURCE FILE: a class may carry more than one (C200402 carries two) and a re-emission must reproduce the document rather than a tidier arrangement of it.',
		HAS_EDIT_HISTORY:
			'Element to one record of its own change history. Ordered by the entry\'s `sequence`, which is its position in the SOURCE FILE and deliberately not its position in time -- CEDS\'s own ordering is untidy (P000225 runs 10, 11, 12, 3, 4, 7, 8) and tidying it would break round-trip fidelity.',
		EMBEDS_TEXT_OF:
			'Text node to a node it describes: (DmeEmbedText)-[:EMBEDS_TEXT_OF]->(described node), provenanceTier \'structural\'. ONE edge per distinct (text node, described node) pair, carrying propertyNameList — the SORTED list of the property names on that node whose value this text is, so a text that is both the name and the description of one node is one edge naming both. The pair is the unit because it is the fact a consumer asks about (which nodes does this text describe); a consumer that needs one row per property enumerates (edge, propertyName). The graph loader stores a one-element list as a SCALAR (a multi-element list stays a list; blocks are unaffected), so every graph reader re-widens a scalar propertyNameList to a one-element list at its read boundary. Never REFERENCES: a structural walk must not travel from a standard into its texts.',
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
		DESCRIBES:
			'GraphProvenance passport to one StandardDefinition — the build\'s own account of one standard it includes. Passport-rooted, therefore created with MATCH and never MERGE: when the standardDefinition finisher is disabled the match yields no rows and no edge appears, which is an honest silence rather than an invented link.',
		HAS_VIEW:
			'GraphProvenance passport to the SchemaView root — the entry point to this graph\'s in-graph vocabulary catalog, so a consumer with nothing but a bolt connection can learn the label and edge names before using them. Passport-rooted and MATCH-created.',
		ATTESTS:
			'GraphProvenance passport to one BuildAttestation — the graph\'s own account of which gates ran over it and what they found. Passport-rooted and MATCH-created.',
		ADVISES:
			'GraphProvenance passport to one UsagePattern — the graph\'s advice on how it is meant to be used, as distinct from what it structurally guarantees. Passport-rooted and MATCH-created.',
		DEFINES:
			'StandardDefinition to the DmeStandardRoot it describes: the single hop from the build\'s view of a standard to the parsed standard itself. Both endpoints carry :ForgedNode, so unlike the passport-rooted edges this one is written through the shared content write path. The two nodes stay SEPARATE deliberately — the definition\'s counts depend on the mappings, so folding them onto the content root would let a re-bridge alter a content node and the standard\'s block would stop reproducing byte-for-byte.',
	},
	provenanceTier: {
		'spec-authoritative': 'Asserted by the standard’s own specification or an authored crosswalk. The strongest evidence tier.',
		'embedding-inferred': 'Derived by embedding retrieval + LLM rerank, frozen in a decision block. A hypothesis tier, never silently composed.',
		structural: 'Emitted by deterministic structural machinery (hierarchy edges, schema view, self-documentation). True by construction.',
		'user-asserted': 'Asserted by a user/curator at runtime, outside the replayed content.',
		// ⟪graphSelfDoc, 2026-08-31⟫ PRE-EXISTING DEBT CLOSED. invalid-debug entered PROVENANCE_TIERS on
		// 2026-08-10 and never received a definition, because the finisher that refuses an undefined term
		// was never ported. Text set VERBATIM by GRANITE_ECHO as design authority, drafted from tqii's own
		// recorded rationale in vocabulary.js; the parenthetical attribution stays.
		'invalid-debug':
			'The tier carried by an edge the DEBUG judge produced (--useDebugJudge, rule \'first\': candidate 1 taken unconditionally). It exists because the alternative was a lie — such edges were once stamped embedding-inferred, asserting that an inference informed a choice nothing informed, in the one field a consumer most trusts. An edge carrying this tier is pipeline-valid and semantically unwarranted: it proves the plumbing and must never be read as a judgement about meaning. (tqii ruling, 2026-08-10.)',
	},
	skosPredicate: {
		exactMatch: 'SKOS: the two concepts are interchangeable. The only predicate that composes to cross-standard equivalence.',
		closeMatch: 'SKOS: the concepts are sufficiently similar for some applications. A non-composing hypothesis.',
		broadMatch: 'SKOS: the target concept is broader than the source.',
		narrowMatch: 'SKOS: the target concept is narrower than the source.',
		relatedMatch: 'SKOS: the concepts are associatively related, neither broader nor narrower.',
	},
	sssomJustification: {
		// the EDUcore Bridge Profile's three active terms (SPEC-educoreBridgeProfile-v1.0.md §4.2); the
		// registry (vocabulary.js SSSOM_JUSTIFICATIONS) carries exactly these. semapv:UnspecifiedMatching is
		// BANNED there by name and so has no definition here — it must never become a schema-view member.
		'semapv:ManualMappingCuration':
			'SSSOM/SEMAPV: resolution SPECIFIED — a person named the mapping (a standard\'s own anchor or an authored crosswalk) and it resolves to exactly one target.',
		'semapv:CompositeMatching':
			'SSSOM/SEMAPV: resolution JUDGED — an algorithm chose among candidates, at any matchBasis (standard, crosswalk, or derived); the judge is named in mapping_tool.',
		'semapv:MappingReview':
			'SSSOM/SEMAPV: a human reviewed and confirmed a previously judged mapping (including a human-resolved CONFLICT survivor).',
		'semapv:SemanticSimilarityThresholdMatching':
			'SSSOM/SEMAPV: resolution JUDGED on a DERIVED basis — the candidates were proposed by semantic similarity (cosine over stored embeddings) above a declared threshold, with no shared key and no authoring document, and a judge then chose one or abstained. Adopted 2026-08-17 by RULING §11.7 (b); the retrieval parameters (K, floor, embedding model) are declared data and travel in the decision block header.',
	},
	dmeRole: {
		DmeStandardRoot: 'The single per-standard root node carrying the standard’s provenance block (name, version, source format/files/url) and its mapping instruction.',
		DmeClass: 'A class/entity/complex-type of a source standard (the domain shape that carries properties).',
		DmeProperty: 'A property/field/element of a source standard — the primary mapping unit at the property tier.',
		DmeOptionSet: 'An enumerated value set (codeset) constraining one or more properties.',
		DmeOptionValue: 'One enumerated value of an option set — the mapping unit at the value tier.',
		DmeSupport: 'Producer-specific supporting material attached to structural nodes (documentation, examples).',
		// ⟪graphSelfDoc, 2026-08-31⟫ PRE-EXISTING DEBT CLOSED. These three roles were added to DME_ROLES
		// after this bucket was authored; their text was written under `nodeLabel` instead, so the finisher
		// — which reads Object.values(DME_ROLES) into the `dmeRole` bucket — found nothing. Per GRANITE_ECHO's
		// ruling these are NOT copies of the nodeLabel text: a ROLE and a LABEL are different assertions
		// about the same word. The role sense says what kind of thing a node in this role IS within the
		// six-role model; the label sense (identity derivation, source ordering, minted ids) stays under
		// `nodeLabel`, and each entry names where its sibling lives.
		DmeEditHistoryEntry:
			'An annotation role: a node in this role records one step of a source element\'s own documented change history rather than any part of the modelled data. It is never a mapping unit at any tier and carries no embedding, so it takes part in neither cross-standard equivalence nor semantic search. (Role sense; the label sense — derived identity and source-file ordering — is under nodeLabel.)',
		DmeRestriction:
			'A constraint role: a node in this role expresses a limit a class places on one of its properties, holding both the constrained property and its target as PROPERTIES rather than as edges. It describes a shape the standard permits, not an element the standard defines, so it is never a mapping unit and carries no embedding. (Role sense; the label sense — owl:Restriction mechanics and derived identity — is under nodeLabel.)',
		DmeVocabularyTerm:
			'A grammar role: a node in this role is a term the standard defines for its OWN descriptive vocabulary rather than a data element of the domain it models. It carries no data role and no embedding, so it is invisible to both browse and search, and it is never a mapping unit. (Role sense; the label sense — minted identifiers and the cedsIdIsMinted flag — is under nodeLabel.)',
		DmeEmbedText:
			'A derived-text role: a node in this role is ONE distinct descriptive text of a standard (a name, description, definition or the like, trimmed), minted by the forge framework rather than by a walk, from the text-property include list the forge declares, and linked by EMBEDS_TEXT_OF to every node whose declared property carries that text. Its identity is content-addressed over the text alone (the standard\'s root id joined to embedText/<sha256(text)>), so a text repeated within a standard is one node. It is never a data element and never a mapping unit: it carries NO name, NO searchText and NO embedding property. Its vector lives on textEmbedding, with the ordinary embeddingModelVersion beside it, under its own index <graphName>_embedText_vector (EMBED_TEXT_VECTOR); the DME\'s semantic search reads only <graphName>_vector over :ForgedNode(embedding), so it never sees these nodes. (Role sense; the per-standard label, e.g. EdfiEmbedText, is declared by each forge.)',
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
