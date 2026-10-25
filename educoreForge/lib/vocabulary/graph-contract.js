'use strict';

// graph-contract.js — the graph contract: the field lists a gold graph's writers and readers must agree on, declared
// ONCE (CONTRACTS-declared-100626 §0-§5; campaign P0, the W-A declarations, 2026-10-06). Pure data, frozen like
// vocabulary.js and re-exported through it, so there is still one import surface.
//
// WHAT P0 DECLARES AND WHAT IT DOES NOT. These are the declarations only. The replay engine does not read §1/§2 yet,
// the passport writer does not write the §3 rows yet, and no reader refuses on the sha yet: P2 wires each of them
// (W-A-1..W-A-5). A declaration nothing reads is a promise, and the P2 gates are what make it a contract.
//
// HOW THE DME READS IT. educore has no require path into this repository (CONTRACTS §0, code fact W-A-3), so the DME
// reads a GENERATED copy, graphContract.json, written by tools/emitGraphContractJson.js as canonicalJsonText() byte
// for byte. graphContractSha256() is the sha256 of those bytes; the passport will carry it (§3) and the DME will
// refuse a graph whose sha is not the one its copy hashes to.
//
// ⟪TRAP⟫ NO TOP-LEVEL REQUIRE OF vocabulary.js. vocabulary.js spreads this module into its own exports, so a top-level
// require here would close a cycle and read vocabulary's exports half-built (an empty object). The one value the JSON
// document needs from vocabulary (the attestation verdict words) is read at CALL time inside graphContractDocument().

const crypto = require('crypto');

const GRAPH_CONTRACT_VERSION = '1';

// §1 LIST_VALUED_PROPERTY_NAME_LIST — property names replay keeps as lists at ANY length (W-A-1, V1-C01). Every other
// one-element PG-JSON array is a wrapped scalar. 'additionalDescriptionList' and 'reachableViaList' are the two
// writer-side renames the census forced (CEDS description, PESC Element reachableVia); their writers move in P3.
const LIST_VALUED_PROPERTY_NAME_LIST = Object.freeze([
	// edges
	'attestationChannelList', 'propertyNameList',
	// attestations (G21: the roundTrip row's omission declaration, one line per standard)
	'explicitOmissionDeclarationList',
	// hub cards
	'qualifierKeys', 'qualifierNames',
	// hub cards, rangeAddressing 'rangeAsMeaning' (ctdlHub P3): a property's ranges are meaning, carried as lists
	'rangeClassIdList', 'rangeClassNameList', 'rangeOptionSetIdList', 'rangeOptionSetNameList', 'rangeDatatypeList',
	// finishers
	'mappingKindList', 'mappingSourceList', 'mappingEdgeTypes', 'properties',
	// roots
	'sourceFiles',
	// CEDS
	'declaredTypes', 'allDomainIds', 'allDomainNames', 'alternative', 'additionalDescriptionList',
	// PESC
	'contextPathSampleList', 'occurrenceSectionList', 'reachableViaList', 'documentationValueList',
	'derivationDocumentationValueList', 'librariesNamed', 'rootChangeLogLineList',
	// PESC, forgeClean lane CLEAN (G20): the comments written immediately before an element; one comment is the common case
	'precedingCommentList',
	// SIF
	'objectNameList', 'objectNameSampleList',
	// store-side, on RecipeBlock (W-C-7)
	'requiresSchemaBlockRefIdList',
	// SchemaView contract members (W-A-6): an attestation field's gates
	'gateList',
]);
// PRODUCER-LOCAL LABEL PATTERNS (§9, W-A-6; ruling G15): labels the schema view deliberately does not catalogue, because a
// producer mints them per standard (Ceds*, Edfi*, Sif260928*, Pesc<Release>*), because they name every node of a base
// block (StandardBase), or because they are bridge scaffold stripped at finish (BridgedRelation_*, kept here for the
// relationship blocks). Every OTHER live label and relationship type must be a SchemaView member; the finish-time
// coverage gate (schema-view-coverage-finisher) proves it. Sources, not RegExps: the contract is JSON.
// Sif is the old SIF forge (forges/sif, rootLabel SifRoot); the gold census held none of its labels, the fleet's embedded
// sifOnly build did (campaign P2). Every forge declaration's rootLabel family must match (test-schemaViewContractProjection e).
// ⟪lane DES, 2026-10-12⟫ '^StandardLayer$' joins '^StandardBase$': it names every node of a layer block.
// ⟪ctdlHub P1⟫ Ctdl, Ctdlasn and Ctdlqdata are the three CTDL-family forges' per-standard label stems (CtdlClass, CtdlasnClass, …).
// ⟪nextStandards-102326 K0⟫ OpenBadges (lane A's forges/openbadges: OpenBadgesSchema, OpenBadgesProperty, …) and Jedx (lane B's forges/jedx).
// ⟪nextStandards-102326 wave 2⟫ Clr, Case, Eduapi and Sedm (lanes D, E, F and G: ClrSchema, CaseProperty, EduapiEnum, …).
// ⟪nextStandards-102326 wave 3⟫ Oneroster and Medbiq (lanes H and I: OnerosterSchema, MedbiqField, …).
const PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST = Object.freeze(['^(Ceds|Edfi|Sif|Sif260928|Pesc[A-Za-z0-9]+|Ctdl|Ctdlasn|Ctdlqdata|OpenBadges|Jedx|Lif|Clr|Case|Eduapi|Sedm|Oneroster|Medbiq)[A-Z]', '^StandardBase$', '^StandardLayer$', '^BridgedRelation_']);
// names that END in List / Keys but are JSON strings or literals by declaration: the name-rule test exempts exactly these
const LIST_NAME_RULE_EXEMPTION_BY_NAME = Object.freeze({
	importList: 'JSON string (pesc-release-forge walk.js)',
	schemaAttributeList: 'JSON string (pesc-release-forge walk.js)',
	fileAnnotationList: 'JSON string (pesc-release-forge walk.js)',
	fileCommentList: 'JSON string (pesc-release-forge walk.js; forgeClean lane CLEAN, G20)',
	standardsIncluded: 'a Cypher literal list on the passport, never through pgToStored',
	// ⟪zeroBacklog lane D, D0-1, 2026-10-22⟫ the CTDL family's three JSON-string lists (P8 contract check read 35/36 for exactly these)
	declaredCorrespondenceList: 'JSON string (ctdl-family-forge jsonLdVocabularyWalk.js; a concept\'s declared skos correspondences)',
	foreignTermEntryList: 'JSON string (ctdl-family-forge jsonLdVocabularyHooks.js; on each CTDL-family root, the terms it imports)',
	nativeDeclarationAnomalyList: 'JSON string (ctdl-family-forge jsonLdVocabularyWalk.js; what a node\'s own declaration says oddly)',
});

// §2 INTEGER_VALUED_PROPERTY_NAME_LIST — counts written as Neo4j INTEGER (W-A-2, V1-C04). The facets maxLength / minLength /
// decimalPlaces (and CEDS's minCount / maxCount) joined in campaign P3 (W-C-17) once the CEDS parser typed them (Ed-Fi already carried numbers): ONE type per name.
// ⟪nextStandards-102326 K0⟫ minItems: an OpenAPI array property's minimum count (lib/openapi-forge registry), an integer in the source.
const INTEGER_VALUED_PROPERTY_NAME_LIST = Object.freeze([
	'byteCount', 'classCount', 'closeMappedProperties', 'codeCount', 'codePosition', 'contentEdgeCount', 'contentNodeCount',
	'contextPathCount', 'decimalPlaces', 'depth', 'documentDepth', 'documentPosition', 'embeddingDims', 'emitTimeRowCount', 'exactMappedProperties',
	'exemplarCount', 'explicitlyOmittedTotal', 'fieldCount', 'finishTimeRowCount', 'instanceCount', 'inventedTotal', 'lostTotal',
	'maxCount', 'maxLength', 'meaningBearingEdgeCount', 'minCount', 'minItems', 'minLength', 'missingVectorTotal', 'optionValueCount', 'position', 'propertyCount', 'sequence', 'sequenceOrdinal', 'sequencePosition',
	'siblingCount', 'sourceLineNumber', 'standardCount', 'subdomainPosition', 'totalDigits', 'unkindedMappingEdgeCount',
	'valueCount', 'valueOrdinal', 'verifiedCount', 'xpathDepth',
]);

// §3 PASSPORT_FIELD_LIST — the :GraphProvenance contract (W-A-3). type ∈ string | integer | boolean | stringList | jsonString.
const PASSPORT_FIELD_LIST = Object.freeze([
	{ name: 'passportKey', type: 'string', required: true, writer: 'finish', meaning: 'constant discriminator graphProvenance (ruled -Key exception)' },
	{ name: 'builtAt', type: 'string', required: true, writer: 'finish', meaning: 'ISO-8601 instant finish ran; the verb\'s only clock' },
	{ name: 'manifestRefId', type: 'string', required: true, writer: 'finish', meaning: 'the manifest this graph was replayed from (64 hex)' },
	{ name: 'graphName', type: 'string', required: true, writer: 'finish+stamp', meaning: 'container name; the stamp overwrites with the promoted name' },
	{ name: 'scratchGraphName', type: 'string', required: false, writer: 'stamp', meaning: 'the name finish saw' },
	{ name: 'contentNodeCount', type: 'integer', required: true, writer: 'finish', meaning: 'nodes carrying _source' },
	{ name: 'contentEdgeCount', type: 'integer', required: true, writer: 'finish', meaning: 'edges with no :GraphMeta endpoint' },
	{ name: 'standardCount', type: 'integer', required: true, writer: 'finish', meaning: 'distinct _source values' },
	{ name: 'standardsIncluded', type: 'stringList', required: true, writer: 'finish', meaning: 'sorted distinct _source values' },
	{ name: 'meaningBearingEdgeCount', type: 'integer', required: true, writer: 'finish', meaning: 'mapping edges + non-structural tiered edges' },
	{ name: 'meaningTierBreakdown', type: 'jsonString', required: true, writer: 'finish', parse: 'MEANING_TIER_ROW_FIELD_LIST_BY_SHAPE', meaning: 'array of {edgeType, mappingKind, mappingSource, tierCount} | {edgeType, provenanceTier, tierCount}' },
	{ name: 'trustworthyForMeaning', type: 'boolean', required: true, writer: 'finish', meaning: 'provenance verdict' },
	{ name: 'trustBasis', type: 'string', required: true, writer: 'finish', meaning: 'noMeaningBearingEdges | invalidDebugPresent | allMeaningBearingEdgesCarryAValidTier' },
	{ name: 'trustNote', type: 'string', required: true, writer: 'finish', meaning: 'the verdict in words; provenance, not correctness' },
	{ name: 'previousManifestRefIdBasis', type: 'string', required: true, writer: 'finish', meaning: 'why no previous build is recorded' },
	{ name: 'engineVersions', type: 'jsonString', required: true, writer: 'finish', parse: 'ENGINE_VERSIONS_NAME_LIST', meaning: '{ replayManager, replayEngine, serializer, forgeFramework, bridgeFramework }' },
	{ name: 'embeddingModelVersion', type: 'string', required: true, writer: 'finish', meaning: 'the one distinct embeddingModelVersion over :ForgedNode; refused when ≠ 1' },
	{ name: 'embeddingDims', type: 'integer', required: true, writer: 'finish', meaning: 'the one distinct vector width over embedding and textEmbedding; refused when ≠ 1' },
	{ name: 'embeddingBasis', type: 'string', required: false, writer: 'finish', meaning: 'present ONLY when the graph carries no vector (--vectorize=false): names that fact; then the two fields above are absent by declaration' },
	{ name: 'judgeIdentityList', type: 'stringList', required: true, writer: 'finish', meaning: 'sorted distinct judge identities over mapping edges; [] when none' },
	{ name: 'rendererVersionList', type: 'stringList', required: true, writer: 'finish', meaning: 'sorted distinct renderer versions over mapping edges; [] when none' },
	{ name: 'recipeHash', type: 'string', required: true, writer: 'finish', meaning: 'copied from the ManifestRecipe this graph was BUILT_FROM' },
	{ name: 'recipeName', type: 'string', required: true, writer: 'finish', meaning: 'copied from the same row' },
	{ name: 'vectorIndexNameList', type: 'stringList', required: true, writer: 'finish+stamp', meaning: 'the VECTOR index names as created, rewritten by the stamp after the rename (§10)' },
	{ name: 'graphContractSha256', type: 'string', required: true, writer: 'finish', meaning: 'sha256 of the canonical graphContract.json this build ran with' },
	{ name: 'frameworkFingerprint', type: 'string', required: false, writer: 'finish', meaning: 'the one frameworkFingerprint every bridge run report carried; absent when none or when they disagree' },
	{ name: 'frameworkFingerprintBasis', type: 'string', required: false, writer: 'finish', meaning: 'present iff frameworkFingerprint is absent: why' },
	// ⟪zeroBacklog lane D, D0-2, 2026-10-22; census row 74⟫ a DECLARED input, never a count: graphBuilder.ini [replay-manager]
	// structuralVersion, refused by name when absent; its grammar is STRUCTURAL_VERSION_PATTERN_SOURCE
	{ name: 'structuralVersion', type: 'string', required: true, writer: 'finish', meaning: 'the graph\'s structural version (V.<number>), declared by the operator in graphBuilder.ini [replay-manager]; it moves when the graph\'s STRUCTURE moves (a new tier, a new edge kind), never with content' },
].map((oneRow) => Object.freeze(oneRow)));
// the structural version's grammar (the DME parses it, so the contract declares it; a source, not a RegExp: the contract is JSON)
const STRUCTURAL_VERSION_PATTERN_SOURCE = '^V\\.[0-9]+$';
// the passport names a reader may still ask for, each with what replaced it, so the reader can be refused BY NAME
const PASSPORT_RETIRED_FIELD_NAME_LIST = Object.freeze([
	{ name: 'replayEngineVersion', replacedBy: 'engineVersions.replayEngine' }, { name: 'serializerVersion', replacedBy: 'engineVersions.serializer' },
	{ name: 'nodeCountAtBuild', replacedBy: 'contentNodeCount' }, { name: 'edgeCountAtBuild', replacedBy: 'contentEdgeCount' },
	{ name: 'manifestKey', replacedBy: 'manifestRefId' }, { name: 'standardsBreakdown', replacedBy: 'DESCRIBES -> StandardDefinition' },
	{ name: 'provenanceTierComplete', replacedBy: 'trustworthyForMeaning + trustBasis' },
	{ name: 'status', replacedBy: 'none: retired' }, { name: 'graphType', replacedBy: 'none: the GNC-001 prefix of graphName' }, { name: 'owner', replacedBy: 'none: retired' },
	{ name: 'builtBy', replacedBy: 'none: retired' }, { name: 'description', replacedBy: 'ManifestRecipe.description' },
	{ name: 'classRangeModeled', replacedBy: 'none: retired capability flag' }, { name: 'codesetMatching', replacedBy: 'none: retired capability flag' },
	{ name: 'equivalenceLayer', replacedBy: 'none: retired capability flag' }, { name: 'legacyEdgeCount', replacedBy: 'none: retired capability flag' }, { name: 'legacyEdgesPresent', replacedBy: 'none: retired capability flag' },
].map((oneRow) => Object.freeze(oneRow)));
// the declared parse of the two jsonString passport fields (V1-C23): the engine version names, content fingerprints
// not hand-bumped constants (the pluginVersion lesson), and the two row shapes meaningTierBreakdown carries
const ENGINE_VERSIONS_NAME_LIST = Object.freeze(['replayManager', 'replayEngine', 'serializer', 'forgeFramework', 'bridgeFramework']);
const MEANING_TIER_ROW_FIELD_LIST_BY_SHAPE = Object.freeze({
	mappingEdge: Object.freeze(['edgeType', 'mappingKind', 'mappingSource', 'tierCount']),
	tieredEdge: Object.freeze(['edgeType', 'provenanceTier', 'tierCount']),
});

// §4 ATTESTATION_FIELD_LIST — the :BuildAttestation contract (W-A-4; forgeCensus is W-C-21's channel-A gate). The verdict
// words are vocabulary's BUILD_ATTESTATION_VERDICT_LIST, named here (see the TRAP above) and resolved into the JSON.
const ATTESTATION_FIELD_LIST = Object.freeze([
	{ name: 'stableId', type: 'string', channel: 'all', meaning: 'buildAttestation:<gate>: the row\'s address, derived from the gate name alone (no pid, no clock)' },
	{ name: 'gate', type: 'string', channel: 'all', meaning: 'the gate whose verdict this row records; rows MERGE on it' },
	{ name: 'verdict', type: 'string', channel: 'all', valueListName: 'BUILD_ATTESTATION_VERDICT_LIST', meaning: 'what the gate said: pass, fail, notRun or passWithAllowedLoss; notRun never means pass' },
	{ name: 'verdictSupplied', type: 'boolean', channel: 'all', meaning: 'true when a producer supplied the verdict; false when the row is the expected-list default (notRun)' },
	{ name: 'expected', type: 'boolean', channel: 'all', meaning: 'true when the gate is on its channel\'s expected list (ATTESTATION_GATE_LIST_BY_CHANNEL)' },
	{ name: 'detail', type: 'string', channel: 'all', meaning: 'the gate\'s own words for its verdict, with the counts it measured' },
	{ name: 'writtenOnChannel', type: 'string', channel: 'all', valueListName: 'ATTESTATION_CHANNEL_LIST', meaning: 'the token of the channel that wrote the row: channelA, channelB or promotionStamp' },
	{ name: 'writtenOnChannelNote', type: 'string', channel: 'all', meaning: 'the channel\'s prose: why the row is written where it is' },
	{ name: 'inventedTotal', type: 'integer', channel: 'channelA', gateList: ['fidelity', 'roundTrip'], meaning: 'statements the gate found in the graph that its source does not hold' },
	{ name: 'roundTripClean', type: 'boolean', channel: 'channelA', gateList: ['roundTrip'], meaning: 'true when every standard that ran round-tripped clean, losing and inventing nothing' },
	{ name: 'lostTotal', type: 'integer', channel: 'channelA', gateList: ['roundTrip'], meaning: 'source statements the round trip could not find again, summed over the standards that ran' },
	{ name: 'explicitlyOmittedTotal', type: 'integer', channel: 'channelA', gateList: ['roundTrip'], meaning: 'source statements a forge declares it does not carry, summed over the standards that ran' },
	{ name: 'explicitOmissionDeclarationList', type: 'stringList', channel: 'channelA', gateList: ['roundTrip'], meaning: 'one line per standard that ran, and one per standard LAYER that ran (token \'<standard>:<layerKey>\', e.g. \'ceds:guide\'; lane DES): what its round trip omitted by declaration, by kind with counts, the rule (module) that declares it, and the rule\'s caveat — e.g. "pesccollegetranscript1v8v0: whitespace 28,428, comment 907, processingInstruction 4 (rule: lib/pesc-release-forge/roundTripPair.js); comments may carry content (PLAN G20)" (G21)' },
	{ name: 'standardCount', type: 'integer', channel: 'channelA', gateList: ['roundTrip'], meaning: 'how many standards the round trip ran over; a standard\'s layers are not counted (they add lines to explicitOmissionDeclarationList)' },
	{ name: 'exemplarCount', type: 'integer', channel: 'channelB', gateList: ['usagePatternVerification'], meaning: 'usage-pattern exemplars re-executed against the finished graph' },
	{ name: 'verifiedCount', type: 'integer', channel: 'channelB', gateList: ['usagePatternVerification'], meaning: 'exemplars that returned rows against the finished graph' },
	{ name: 'missingVectorTotal', type: 'integer', channel: 'channelA', gateList: ['embeddingCoverage'], meaning: 'nodes, cards and texts lacking the vector their embed input requires, plus vectors with no embed input' },
	{ name: 'evidencePath', type: 'string', channel: 'promotionStamp', meaning: 'the evidence file a promotion-stamp verdict was read from' },
	{ name: 'evidenceSha256', type: 'string', channel: 'promotionStamp', meaning: 'sha256 of that evidence file' },
].map((oneRow) => Object.freeze(oneRow.gateList ? { ...oneRow, gateList: Object.freeze(oneRow.gateList) } : oneRow)));
const ATTESTATION_CHANNEL_LIST = Object.freeze(['channelA', 'channelB', 'promotionStamp']);
const ATTESTATION_LABEL_SET_BY_CHANNEL = Object.freeze({
	channelA: Object.freeze(['ForgedNode', 'BuildAttestation', 'GraphMeta']),
	channelB: Object.freeze(['BuildAttestation', 'GraphMeta']),
	promotionStamp: Object.freeze(['BuildAttestation', 'GraphMeta']),
});
const ATTESTATION_GATE_LIST_BY_CHANNEL = Object.freeze({
	channelA: Object.freeze(['fidelity', 'roundTrip', 'goldEvalCheck', 'embeddingCoverage', 'forgeCensus']),
	channelB: Object.freeze(['usagePatternVerification']),
	// reforgeDeterminism (lane REFORGE, forgeClean R3, 2026-10-08): two from-scratch builds compared by apps/graph-builder/tools/
	// reforgeCompare.js; stamped from its -summarize evidence, which names the run and the code head it ran on
	promotionStamp: Object.freeze(['goldEvalCheck', 'replay', 'reforgeDeterminism']),
});

// §5 SELF_DOC field lists (W-A-5). Types and required flags were read off the live acceptance graph
// GOLD_EVAL_261005_jevAcceptance on 2026-10-06 (read-only census): a field present on every live row is required;
// the rows later phases add (W-C-4, W-C-7, W-C-8, W-C-10, W-A-7) are required: false until they land. Counts the live
// graph holds as FLOAT are declared integer: W-A-2 is what makes the graph agree.
const MANIFEST_RECIPE_FIELD_LIST = Object.freeze([
	{ name: 'manifestRefId', type: 'string', required: true, meaning: 'the content address of the manifest this graph was replayed from (64 hex)' },
	{ name: 'name', type: 'string', required: true, meaning: 'the manifest\'s name in the store' },
	{ name: 'description', type: 'string', required: true, meaning: 'the recipe\'s description, carried to the manifest' },
	{ name: 'recipeName', type: 'string', required: true, meaning: 'the recipe that composed the manifest (its file basename)' },
	{ name: 'recipeHash', type: 'string', required: true, meaning: 'sha256 of the recipe file the build read' },
	{ name: 'recipeFileName', type: 'string', required: true, meaning: 'the recipe file\'s name' },
	{ name: 'basedOnManifestRefId', type: 'string', required: false, meaning: 'the manifest the operator named as this build\'s parent; absent when none was named' },
	{ name: 'basedOnManifestRefIdBasis', type: 'string', required: false, meaning: 'operatorNamed, or none named at build: why basedOnManifestRefId is or is not present' },
	{ name: 'createdAt', type: 'string', required: true, meaning: 'when the manifest was saved to the store' },
	{ name: 'isRootOfThisGraph', type: 'boolean', required: true, meaning: 'true on the recipe this graph was BUILT_FROM; false on an ancestor reached by BASED_ON' },
	{ name: 'previousManifestId', type: 'string', required: false, meaning: 'honestly null: no store records the previous build' },
].map((oneRow) => Object.freeze(oneRow)));
const RECIPE_BLOCK_FIELD_LIST = Object.freeze([
	{ name: 'schemaBlockRefId', type: 'string', required: true, meaning: 'the member block\'s content address (64 hex)' },
	{ name: 'kind', type: 'string', required: true, meaning: 'the block kind: standardBase, relationship or layer (a separately published companion of one standard, lane DES 2026-10-12)' },
	{ name: 'subject', type: 'string', required: true, meaning: 'the block subject: <standardKey>@<version>_base or a relationship pair subject' },
	{ name: 'version', type: 'string', required: false, meaning: 'the block\'s version column' },
	{ name: 'position', type: 'integer', required: true, meaning: 'the member\'s position in the manifest' },
	{ name: 'purpose', type: 'string', required: true, meaning: 'carried text saying why the block is in the recipe; not a warrant' },
	{ name: 'purposeSource', type: 'string', required: true, meaning: 'where the purpose text came from (machine-generated by the builder on this store generation)' },
	{ name: 'purposeTemplateSite', type: 'string', required: true, meaning: 'the template that generated the purpose text' },
	{ name: 'producedByRecipeName', type: 'string', required: false, meaning: 'the recipe whose build added this block to this manifest' },
	{ name: 'requiresSchemaBlockRefIdList', type: 'stringList', required: false, meaning: 'the base blocks a relationship block requires, sorted' },
	{ name: 'pairA', type: 'string', required: false, meaning: 'a relationship block\'s first standard' },
	{ name: 'pairAVersion', type: 'string', required: false, meaning: 'its version' },
	{ name: 'pairB', type: 'string', required: false, meaning: 'a relationship block\'s second standard' },
	{ name: 'pairBVersion', type: 'string', required: false, meaning: 'its version' },
].map((oneRow) => Object.freeze(oneRow)));
const STANDARD_DEFINITION_FIELD_LIST = Object.freeze([
	{ name: 'sourceKey', type: 'string', required: true, meaning: 'the standard\'s _source: THE filter vocabulary every standard filter takes' },
	{ name: 'standardKey', type: 'string', required: true, meaning: 'the forge token, used in block subjects and labels' },
	{ name: 'standardName', type: 'string', required: true, meaning: 'the standard\'s display name' },
	{ name: 'version', type: 'string', required: true, meaning: 'the version the forge stamped, which entered the content address' },
	{ name: 'versionSource', type: 'string', required: true, meaning: 'where the version came from' },
	{ name: 'publishedVersion', type: 'string', required: true, meaning: 'the version the standard publishes' },
	{ name: 'versionDisagreement', type: 'boolean', required: true, meaning: 'true when version and publishedVersion deliberately differ' },
	{ name: 'versionNote', type: 'string', required: false, meaning: 'why they differ, when they do' },
	{ name: 'snapshotKey', type: 'string', required: true, meaning: 'the source snapshot on disk the forge read' },
	{ name: 'sourceFormat', type: 'string', required: true, meaning: 'the source\'s format (RDF, XSD, MetaEd model, …)' },
	{ name: 'sourceUrl', type: 'string', required: false, meaning: 'where the source is published' },
	{ name: 'propertyCount', type: 'integer', required: true, meaning: 'the standard\'s property-role nodes' },
	{ name: 'classCount', type: 'integer', required: true, meaning: 'its class-role nodes' },
	{ name: 'optionValueCount', type: 'integer', required: true, meaning: 'its option-value-role nodes' },
	{ name: 'exactMappedProperties', type: 'integer', required: true, meaning: 'its properties carrying an EXACT_MATCH to the hub' },
	{ name: 'closeMappedProperties', type: 'integer', required: true, meaning: 'its properties carrying a CLOSE_MATCH to the hub' },
	{ name: 'mappedPropertyCountByHub', type: 'string', required: false, meaning: 'present only in a graph holding more than one hub: JSON, per hub name, its exactMappedProperties and closeMappedProperties (every hub listed, zero stated)' },
	{ name: 'mappingKindList', type: 'stringList', required: true, meaning: 'the distinct mappingKind values its match edges carry' },
	{ name: 'mappingSourceList', type: 'stringList', required: true, meaning: 'the distinct mappingSource values its match edges carry' },
	{ name: 'mappingEdgeTypes', type: 'stringList', required: true, meaning: 'the match edge types its edges use' },
	{ name: 'unkindedMappingEdgeCount', type: 'integer', required: false, meaning: 'match edges carrying no mappingKind' },
	{ name: 'standardKind', type: 'string', required: true, meaning: 'what kind of standard it is, as its forge declares' },
	{ name: 'standardUsageTips', type: 'string', required: false, meaning: 'how to read the standard in this graph, as its forge declares; absent when the forge declares null (forgeDeclarationContract allows it: sif, pesc260805)' },
	{ name: 'standardFamily', type: 'string', required: true, meaning: 'the family the standard belongs to (STANDARD_FAMILY: CEDS, EdFi, SIF, PESC, CTDL, CTDLASN, CTDLQData, PESCLD, OpenBadges, JEDx, LIF, CLR, CASE, EduAPI, SEDM, OneRoster, MedBiquitous), declared by its forge; a family name in a DME standard filter expands to these (ruling A5)' },
	{ name: 'releaseLabel', type: 'string', required: true, meaning: 'which member of its family the standard is, version-free (CollegeTranscript, not CollegeTranscript-1.8.0); a one-member family repeats the family name' },
	{ name: 'descriptionSource', type: 'string', required: true, meaning: 'where in the standard\'s SOURCE its description text is read from (PESC xs:documentation, CEDS dc:description, ...), declared by its forge (lane FIX, Fix 3)' },
	// ⟪zeroBacklog lane D, D0-4, 2026-10-22⟫ RESERVED for lane A2 (census row 10), which stamps it on every standard and makes it required
	{ name: 'nativeIdentifierPropertyName', type: 'string', required: false, meaning: 'the property name carrying the standard\'s OWN native identifier on its content nodes, declared by its forge, so a reader never assumes one standard\'s identifier name for every standard' },
].map((oneRow) => Object.freeze(oneRow)));
const USAGE_PATTERN_FIELD_LIST = Object.freeze([
	{ name: 'patternName', type: 'string', required: true, meaning: 'the exemplar\'s name' },
	{ name: 'question', type: 'string', required: true, meaning: 'the question a consumer actually has' },
	{ name: 'cypher', type: 'string', required: true, meaning: 'the Cypher that answers it' },
	{ name: 'caveat', type: 'string', required: true, meaning: 'what the answer must not be taken to mean' },
	{ name: 'entryLabel', type: 'string', required: true, meaning: 'the label the Cypher enters from' },
	{ name: 'emitTimeRowCount', type: 'integer', required: true, meaning: 'rows at emit time: provenance of the query-validity check, not proof' },
	{ name: 'finishTimeRowCount', type: 'integer', required: false, meaning: 'rows against the finished graph: the count that carries weight' },
	{ name: 'zeroRowMeaning', type: 'string', required: true, meaning: 'defect (zero rows fails the build) or finding (zero rows is a true answer)' },
].map((oneRow) => Object.freeze(oneRow)));
// the self-doc names readers may still ask for, by label, each with its replacement (or 'none')
const SELF_DOC_RETIRED_FIELD_NAME_BY_LABEL = Object.freeze({
	ManifestRecipe: Object.freeze({ manifestKey: 'manifestRefId', label: 'name', note: 'description', basedOn: 'basedOnManifestRefId', isBuildManifest: 'isRootOfThisGraph' }),
	RecipeBlock: Object.freeze({ blockId: 'schemaBlockRefId', blockType: 'kind', producedBy: 'none: the manifest recipeName' }),
	StandardDefinition: Object.freeze({ source: 'sourceKey', displayName: 'standardName', mappingDisposition: 'mappingKindList + mappingSourceList', exactEdgeCount: 'exactMappedProperties', closeEdgeCount: 'closeMappedProperties', nodeCount: 'none', optionSetCount: 'none', description: 'none', subjectVersions: 'none', objectVersions: 'none' }),
});

// §10 VECTOR INDEX NAMING (W-A-9, V1-C25, G12). Each vector slot has one index, named off the graph it serves:
// <graphName><suffix>. The table is read from vocabulary at CALL time (see the TRAP in the header): the ordinary slot is
// :ForgedNode(embedding); the text slot is EMBED_TEXT_VECTOR's label, property and suffix, which keep their one home there.
// There is no default graph name: an index named 'replay_vector' serves no graph anyone can find.
const vectorIndexSlotTable = () => {
	const { EMBED_TEXT_VECTOR, NODE_LABELS } = require('./vocabulary');
	return Object.freeze({
		embedding: Object.freeze({ label: NODE_LABELS.FORGED_NODE, indexNameSuffix: '_vector' }),
		[EMBED_TEXT_VECTOR.propertyName]: Object.freeze({ label: EMBED_TEXT_VECTOR.label, indexNameSuffix: EMBED_TEXT_VECTOR.indexNameSuffix }),
	});
};
// vectorIndexNameRefusal — '' when the pair names a declared slot of a named graph, else why not (callers that must
// not throw — the write path, the promotion stamp — refuse with this text; vectorIndexNameFor throws it)
const vectorIndexNameRefusal = ({ graphName, slotPropertyName } = {}) => {
	if (typeof graphName !== 'string' || !graphName.trim()) {
		return 'vectorIndexNameFor: graphName is REQUIRED — an index is named off the graph it serves';
	}
	const slotTable = vectorIndexSlotTable();
	return slotTable[slotPropertyName] ? '' : `vectorIndexNameFor: '${slotPropertyName}' is not a declared vector slot (${Object.keys(slotTable).join(', ')})`;
};
const vectorIndexNameFor = ({ graphName, slotPropertyName } = {}) => {
	const refusal = vectorIndexNameRefusal({ graphName, slotPropertyName });
	if (refusal) {
		throw new Error(refusal);
	}
	return `${graphName}${vectorIndexSlotTable()[slotPropertyName].indexNameSuffix}`;
};

// §10b FULLTEXT INDEX (lane BM25, 2026-10-10; TQ: "No BM25/fulltext is a bug"). The search's keyword (BM25) leg reads ONE
// FULLTEXT index, <graphName><indexNameSuffix>, built by replay beside the vector indexes. It was in the reimplementation
// spec's union contract (indices <graphname>_{fulltext,vector}, SPECIFICATION-educoreForge-real-061726) and in the incumbent
// generation (graphEmbedder), and the greenfield replay engine (63f6a143) built only the vector index. Read from vocabulary
// at CALL time (the TRAP in the header). MEASURED on a true replay of GOLD_EVAL_261009_ct17text's manifest (DEVLOG-BM25,
// evidence/BM25/benchmark-*), 55 questions, RRF over an AND keyword leg:
//   propertyNameList — name and description, the element's OWN text. Adding searchText (the incumbent's third field)
//       made every child of a class match the class's name: 'LEAInfo' fell from rank 1 to 2 behind a child, exact-term
//       hit@1 33 -> 31 of 35, overall MRR 0.808 -> 0.790. The cost of leaving it out is NAMED, not hidden: of the 141,838
//       nodes the ordinary vector index searches, 101 carry neither name nor description (PESC anonymous types, DmeClass;
//       their only text is searchText = '<release> | <owning element name>', and the owning element is keyword-searchable
//       itself). graph-structure-check fulltextIndex reports that gap per standard and role.
//   analyzer — 'standard' (English stop words removed), declared, never left to Neo4j's default (standard-no-stop-words):
//       the DME's AND query needs a stop word's clause dropped ('date of birth' = date AND birth), and english /
//       standard-no-stop-words measured no better in any fusion.
//   searchedVectorSlotPropertyName — the vector slot whose population the keyword leg is measured against: the DME holds
//       its keyword leg to those nodes, so the two legs rank one population.
const fulltextIndexDeclaration = () => {
	const { NODE_LABELS } = require('./vocabulary');
	return Object.freeze({
		label: NODE_LABELS.FORGED_NODE,
		propertyNameList: Object.freeze(['name', 'description']),
		analyzer: 'standard',
		indexNameSuffix: '_fulltext',
		searchedVectorSlotPropertyName: 'embedding',
	});
};
// fulltextIndexNameRefusal — '' for a named graph, else why not (the write path and the stamp refuse with it)
const fulltextIndexNameRefusal = ({ graphName } = {}) =>
	typeof graphName !== 'string' || !graphName.trim() ? 'fulltextIndexNameFor: graphName is REQUIRED — an index is named off the graph it serves' : '';
const fulltextIndexNameFor = ({ graphName } = {}) => {
	const refusal = fulltextIndexNameRefusal({ graphName });
	if (refusal) {
		throw new Error(refusal);
	}
	return `${graphName}${fulltextIndexDeclaration().indexNameSuffix}`;
};
// fulltextIndexCreateCypherFor — the one CREATE statement, used by replay and by the promotion stamp's rename
const fulltextIndexCreateCypherFor = ({ indexName }) => {
	const declaration = fulltextIndexDeclaration();
	return `CREATE FULLTEXT INDEX \`${indexName}\` IF NOT EXISTS FOR (n:\`${declaration.label}\`) ON EACH [${declaration.propertyNameList.map((propertyName) => `n.\`${propertyName}\``).join(', ')}] OPTIONS {indexConfig: {\`fulltext.analyzer\`: '${declaration.analyzer}'}}`;
};

// BRIDGE PAIR LABELS (W-B-13, V1-C29). A bridge run stamps both endpoints of every edge it writes with a pair-scoped label
// <prefix>_<SOURCE>_<HUB> so the harvest can select the pair's nodes; it is BUILD SCAFFOLD, re-applied by replay from the
// relationship blocks, and the finish strips it (bridge-label-finisher) because a hub's label set would otherwise vary by
// recipe. The grammar is declared here and gated; the pattern travels as its source text (a RegExp is not JSON).
const BRIDGE_PAIR_LABEL_PREFIX = 'BridgedRelation';
const BRIDGE_PAIR_LABEL_PATTERN_SOURCE = '^BridgedRelation_[A-Z0-9]+_[A-Z0-9]+$';
const pairScopedLabelFor = ({ sourceToken, hubToken } = {}) => {
	const pairScopedLabel = `${BRIDGE_PAIR_LABEL_PREFIX}_${`${sourceToken}`.toUpperCase()}_${`${hubToken}`.toUpperCase()}`;
	if (!new RegExp(BRIDGE_PAIR_LABEL_PATTERN_SOURCE).test(pairScopedLabel)) {
		throw new Error(`pairScopedLabelFor: '${pairScopedLabel}' does not match the declared grammar ${BRIDGE_PAIR_LABEL_PATTERN_SOURCE} (source and hub tokens must be [A-Za-z0-9]+)`);
	}
	return pairScopedLabel;
};

// §14 GRAPH-SIDE RULES THE DME'S USER LAYER READS (W-E-5 / W-E-6 / W-E-7; rulings A12, 2026-10-06: W's recommendations —
// user links by stableId to declaration roles, the user layer TEXT-ONLY, the four match relation types REFUSED to users).
// USER_LINK_TARGET_RULE — what a user link names its standard target by: stableId on :ForgedNode (uri exists on CEDS alone,
// measured), only to a DECLARATION role (an instance, a support node, a hub card or a text node is not a link target), and
// 'uri' accepted only on READ of a script saved before P2. The roles were read off the gold (2026-10-06, read-only).
const USER_LINK_TARGET_RULE = Object.freeze({
	standardKeyName: 'stableId',
	targetLabel: 'ForgedNode',
	linkableRoleList: Object.freeze(['DmeClass', 'DmeOptionSet', 'DmeOptionValue', 'DmeProperty']),
	retiredStandardKeyNameList: Object.freeze(['uri']),
});
// USER_EDGE_STAMP_FIELD_LIST — every user-made edge carries these, so re-emit captures user edges BY STAMP
const USER_EDGE_STAMP_FIELD_LIST = Object.freeze(['userAuthored', 'userRefId', 'userEdgeRefId', 'authoredAt']);
// USER_EDGE_RULE — the judge's relation types are the judge's: a user edge of one of them is refused by name (A12 REFUSE)
const USER_EDGE_RULE = Object.freeze({
	matchRelationTypeList: Object.freeze(['EXACT_MATCH', 'CLOSE_MATCH', 'BROAD_MATCH', 'NARROW_MATCH']),
	matchRelationPolicy: 'refuse',
});
// USER_EMBEDDING_RULE — A12-embeddings: nothing reads a user vector (no index, no search arm), so the user layer is TEXT-ONLY;
// a user write produces no vector and the write path holds no embedding model
const USER_EMBEDDING_RULE = Object.freeze({ userVectorPolicy: 'textOnly' });

// §15 DME_TEXT_FIELD_RULE (lane FIX, Fix 3, 2026-10-09; TQ report). The DME reads ONE text field for a content node,
// description (dataModelExplorerSearch.js), and every standard writes it there: CEDS, Ed-Fi, SIF and, since Fix 3, PESC.
// MEASURED on GOLD_EVAL_261009_ct17 before the fix: PESC's DmeProperty and DmeClass carried 0 descriptions and 10,472
// documentation texts, so askMilo told TQ PESC had no text. The rule, checked on every build (graph-structure-check
// dmeTextField, inside the forgeCensus attestation): (1) every standard with DmeProperty or DmeClass nodes carries
// description on at least one of them; (2) no content node carries a text in sourceTextPropertyNameList without also
// carrying description (a standard's raw text field may stay, as PESC's documentation does, but never as the only one).
const DME_TEXT_FIELD_RULE = Object.freeze({
	textPropertyName: 'description',
	declarationRoleList: Object.freeze(['DmeClass', 'DmeProperty']),
	sourceTextPropertyNameList: Object.freeze(['documentation']),
});

// ---------------------------------------------------------------------
// THE JSON DOCUMENT, ITS CANONICAL TEXT AND ITS SHA
// ---------------------------------------------------------------------
// graphContractDocument — every declaration above, under camelCase document names, plus the one vocabulary list the
// attestation rows name. This is what graphContract.json holds; nothing outside the declarations above goes in.
const graphContractDocument = () => {
	const { BUILD_ATTESTATION_VERDICT_LIST } = require('./vocabulary'); // call time: see the TRAP in the header
	return {
		graphContractVersion: GRAPH_CONTRACT_VERSION,
		listValuedPropertyNameList: LIST_VALUED_PROPERTY_NAME_LIST,
		listNameRuleExemptionByName: LIST_NAME_RULE_EXEMPTION_BY_NAME,
		integerValuedPropertyNameList: INTEGER_VALUED_PROPERTY_NAME_LIST,
		passportFieldList: PASSPORT_FIELD_LIST,
		passportRetiredFieldNameList: PASSPORT_RETIRED_FIELD_NAME_LIST,
		structuralVersionPatternSource: STRUCTURAL_VERSION_PATTERN_SOURCE,
		engineVersionsNameList: ENGINE_VERSIONS_NAME_LIST,
		meaningTierRowFieldListByShape: MEANING_TIER_ROW_FIELD_LIST_BY_SHAPE,
		attestationFieldList: ATTESTATION_FIELD_LIST,
		attestationChannelList: ATTESTATION_CHANNEL_LIST,
		attestationLabelSetByChannel: ATTESTATION_LABEL_SET_BY_CHANNEL,
		attestationGateListByChannel: ATTESTATION_GATE_LIST_BY_CHANNEL,
		buildAttestationVerdictList: BUILD_ATTESTATION_VERDICT_LIST,
		manifestRecipeFieldList: MANIFEST_RECIPE_FIELD_LIST,
		recipeBlockFieldList: RECIPE_BLOCK_FIELD_LIST,
		standardDefinitionFieldList: STANDARD_DEFINITION_FIELD_LIST,
		usagePatternFieldList: USAGE_PATTERN_FIELD_LIST,
		selfDocRetiredFieldNameByLabel: SELF_DOC_RETIRED_FIELD_NAME_BY_LABEL,
		vectorIndexSlotTable: vectorIndexSlotTable(),
		fulltextIndexDeclaration: fulltextIndexDeclaration(),
		bridgePairLabelPrefix: BRIDGE_PAIR_LABEL_PREFIX,
		bridgePairLabelPatternSource: BRIDGE_PAIR_LABEL_PATTERN_SOURCE,
		producerLocalLabelPatternSourceList: PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST,
		// W-D-5 (P1 asked): the hub slot list both incoming arms of findMappings walk
		hubSlotList: require('./vocabulary').HUB_DECOMPOSITION_SLOTS,
		// ⟪ctdlHub P6, for P7⟫ the term slot (HAS_<HUB>_TERM), kept OUT of hubSlotList as vocabulary keeps it out of
		// HUB_DECOMPOSITION_SLOTS, so the DME finds term edges from the contract without findMappings' arms changing
		hubTermSlotList: require('./vocabulary').HUB_TERM_DECOMPOSITION_SLOTS,
		userLinkTargetRule: USER_LINK_TARGET_RULE,
		userEdgeStampFieldList: USER_EDGE_STAMP_FIELD_LIST,
		userEdgeRule: USER_EDGE_RULE,
		userEmbeddingRule: USER_EMBEDDING_RULE,
		dmeTextFieldRule: DME_TEXT_FIELD_RULE,
		// ⟪lane DES, cedsRichness-101226, 2026-10-12; COPPER_RIVER amendment B⟫ how a reader tells a LAYER node from its standard's
		// own: a layer node carries the standard's _source AND the label StandardLayer, in one of the layer roles. A reader that
		// counts or selects a standard's content excludes StandardLayer unless it says why it includes it.
		layerScopeRule: layerScopeRule(),
	};
};

// layerScopeRule — read at CALL time (the cycle TRAP in the header): the layer label, the layer roles, the block kinds
const layerScopeRule = () => {
	const { STANDARD_LAYER_LABEL, LAYER_ROLE_LIST, SCHEMA_BLOCK_KINDS } = require('./vocabulary');
	return {
		layerLabel: STANDARD_LAYER_LABEL,
		layerRoleList: LAYER_ROLE_LIST.slice(),
		schemaBlockKindList: SCHEMA_BLOCK_KINDS.slice(),
		rule: 'a node labelled StandardLayer belongs to a LAYER of its standard (a separately published companion such as the CEDS Ontology Guide V14 Appendix A), not to the standard itself: exclude it from a standard\'s counts, searches and name lookups, and reach it through the layer edges (HAS_LAYER, HAS_PRIMARY_CONCEPT, HAS_SECONDARY_CONCEPT, HAS_EVENT_DATE_CONCEPT, REPAIRS_TEXT_OF)',
	};
};

// sortedMembersDeep — the same structure with object members in sorted order at every depth; arrays keep their order
// (an array's order is part of its meaning, an object's member order never is)
const sortedMembersDeep = (candidate) => {
	if (Array.isArray(candidate)) {
		return candidate.map(sortedMembersDeep);
	}
	if (candidate !== null && typeof candidate === 'object') {
		return Object.keys(candidate).sort().reduce((sortedObject, memberName) => ({ ...sortedObject, [memberName]: sortedMembersDeep(candidate[memberName]) }), {});
	}
	return candidate;
};

// canonicalJsonText — byte-stable: sorted members, tab indentation, one trailing newline. The emitter writes exactly this.
const canonicalJsonText = () => `${JSON.stringify(sortedMembersDeep(graphContractDocument()), null, '\t')}\n`;

// graphContractSha256 — sha256 of canonicalJsonText()'s utf-8 bytes; the value the passport will carry (§3)
const graphContractSha256 = () => crypto.createHash('sha256').update(canonicalJsonText(), 'utf8').digest('hex');

module.exports = Object.freeze({
	GRAPH_CONTRACT_VERSION,
	LIST_VALUED_PROPERTY_NAME_LIST,
	LIST_NAME_RULE_EXEMPTION_BY_NAME,
	INTEGER_VALUED_PROPERTY_NAME_LIST,
	PASSPORT_FIELD_LIST,
	PASSPORT_RETIRED_FIELD_NAME_LIST,
	STRUCTURAL_VERSION_PATTERN_SOURCE,
	ENGINE_VERSIONS_NAME_LIST,
	MEANING_TIER_ROW_FIELD_LIST_BY_SHAPE,
	ATTESTATION_FIELD_LIST,
	ATTESTATION_CHANNEL_LIST,
	ATTESTATION_LABEL_SET_BY_CHANNEL,
	ATTESTATION_GATE_LIST_BY_CHANNEL,
	MANIFEST_RECIPE_FIELD_LIST,
	RECIPE_BLOCK_FIELD_LIST,
	STANDARD_DEFINITION_FIELD_LIST,
	USAGE_PATTERN_FIELD_LIST,
	SELF_DOC_RETIRED_FIELD_NAME_BY_LABEL,
	vectorIndexSlotTable,
	vectorIndexNameRefusal,
	vectorIndexNameFor,
	fulltextIndexDeclaration,
	fulltextIndexNameRefusal,
	fulltextIndexNameFor,
	fulltextIndexCreateCypherFor,
	BRIDGE_PAIR_LABEL_PREFIX,
	BRIDGE_PAIR_LABEL_PATTERN_SOURCE,
	pairScopedLabelFor,
	PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST,
	USER_LINK_TARGET_RULE,
	USER_EDGE_STAMP_FIELD_LIST,
	USER_EDGE_RULE,
	USER_EMBEDDING_RULE,
	DME_TEXT_FIELD_RULE,
	graphContractDocument,
	canonicalJsonText,
	graphContractSha256,
});
