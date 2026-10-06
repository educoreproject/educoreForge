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
	// hub cards
	'qualifierKeys', 'qualifierNames',
	// finishers
	'mappingKindList', 'mappingSourceList', 'mappingEdgeTypes', 'properties',
	// roots
	'sourceFiles',
	// CEDS
	'declaredTypes', 'allDomainIds', 'allDomainNames', 'alternative', 'additionalDescriptionList',
	// PESC
	'contextPathSampleList', 'occurrenceSectionList', 'reachableViaList', 'documentationValueList',
	'derivationDocumentationValueList', 'librariesNamed', 'rootChangeLogLineList',
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
const PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST = Object.freeze(['^(Ceds|Edfi|Sif|Sif260928|Pesc[A-Za-z0-9]+)[A-Z]', '^StandardBase$', '^BridgedRelation_']);
// names that END in List / Keys but are JSON strings or literals by declaration: the name-rule test exempts exactly these
const LIST_NAME_RULE_EXEMPTION_BY_NAME = Object.freeze({
	importList: 'JSON string (pesc-release-forge walk.js)',
	schemaAttributeList: 'JSON string (pesc-release-forge walk.js)',
	fileAnnotationList: 'JSON string (pesc-release-forge walk.js)',
	standardsIncluded: 'a Cypher literal list on the passport, never through pgToStored',
});

// §2 INTEGER_VALUED_PROPERTY_NAME_LIST — counts written as Neo4j INTEGER (W-A-2, V1-C04). The facets maxLength / minLength /
// decimalPlaces (and CEDS's minCount / maxCount) joined in campaign P3 (W-C-17) once the CEDS parser typed them (Ed-Fi already carried numbers): ONE type per name.
const INTEGER_VALUED_PROPERTY_NAME_LIST = Object.freeze([
	'byteCount', 'classCount', 'closeMappedProperties', 'codeCount', 'codePosition', 'contentEdgeCount', 'contentNodeCount',
	'contextPathCount', 'decimalPlaces', 'depth', 'documentDepth', 'documentPosition', 'embeddingDims', 'emitTimeRowCount', 'exactMappedProperties',
	'exemplarCount', 'explicitlyOmittedTotal', 'fieldCount', 'finishTimeRowCount', 'instanceCount', 'inventedTotal', 'lostTotal',
	'maxCount', 'maxLength', 'meaningBearingEdgeCount', 'minCount', 'minLength', 'missingVectorTotal', 'optionValueCount', 'position', 'propertyCount', 'sequence', 'sequenceOrdinal', 'sequencePosition',
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
].map((oneRow) => Object.freeze(oneRow)));
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
	{ name: 'standardCount', type: 'integer', channel: 'channelA', gateList: ['roundTrip'], meaning: 'how many standards the round trip ran over' },
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
	promotionStamp: Object.freeze(['goldEvalCheck', 'replay']),
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
	{ name: 'kind', type: 'string', required: true, meaning: 'the block kind: standardBase or relationship' },
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
	{ name: 'mappingKindList', type: 'stringList', required: true, meaning: 'the distinct mappingKind values its match edges carry' },
	{ name: 'mappingSourceList', type: 'stringList', required: true, meaning: 'the distinct mappingSource values its match edges carry' },
	{ name: 'mappingEdgeTypes', type: 'stringList', required: true, meaning: 'the match edge types its edges use' },
	{ name: 'unkindedMappingEdgeCount', type: 'integer', required: false, meaning: 'match edges carrying no mappingKind' },
	{ name: 'standardKind', type: 'string', required: true, meaning: 'what kind of standard it is, as its forge declares' },
	{ name: 'standardUsageTips', type: 'string', required: false, meaning: 'how to read the standard in this graph, as its forge declares; absent when the forge declares null (forgeDeclarationContract allows it: sif, pesc260805)' },
	{ name: 'standardFamily', type: 'string', required: true, meaning: 'the family the standard belongs to (STANDARD_FAMILY: CEDS, EdFi, SIF, PESC), declared by its forge; a family name in a DME standard filter expands to these (ruling A5)' },
	{ name: 'releaseLabel', type: 'string', required: true, meaning: 'which member of its family the standard is, version-free (CollegeTranscript, not CollegeTranscript-1.8.0); a one-member family repeats the family name' },
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
		bridgePairLabelPrefix: BRIDGE_PAIR_LABEL_PREFIX,
		bridgePairLabelPatternSource: BRIDGE_PAIR_LABEL_PATTERN_SOURCE,
		producerLocalLabelPatternSourceList: PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST,
		// W-D-5 (P1 asked): the hub slot list both incoming arms of findMappings walk
		hubSlotList: require('./vocabulary').HUB_DECOMPOSITION_SLOTS,
		userLinkTargetRule: USER_LINK_TARGET_RULE,
		userEdgeStampFieldList: USER_EDGE_STAMP_FIELD_LIST,
		userEdgeRule: USER_EDGE_RULE,
		userEmbeddingRule: USER_EMBEDDING_RULE,
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
	BRIDGE_PAIR_LABEL_PREFIX,
	BRIDGE_PAIR_LABEL_PATTERN_SOURCE,
	pairScopedLabelFor,
	PRODUCER_LOCAL_LABEL_PATTERN_SOURCE_LIST,
	USER_LINK_TARGET_RULE,
	USER_EDGE_STAMP_FIELD_LIST,
	USER_EDGE_RULE,
	USER_EMBEDDING_RULE,
	graphContractDocument,
	canonicalJsonText,
	graphContractSha256,
});
