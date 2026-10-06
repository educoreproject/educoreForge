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
]);
// names that END in List / Keys but are JSON strings or literals by declaration: the name-rule test exempts exactly these
const LIST_NAME_RULE_EXEMPTION_BY_NAME = Object.freeze({
	importList: 'JSON string (pesc-release-forge walk.js)',
	schemaAttributeList: 'JSON string (pesc-release-forge walk.js)',
	fileAnnotationList: 'JSON string (pesc-release-forge walk.js)',
	standardsIncluded: 'a Cypher literal list on the passport, never through pgToStored',
});

// §2 INTEGER_VALUED_PROPERTY_NAME_LIST — counts written as Neo4j INTEGER (W-A-2, V1-C04). The CEDS STRING facets
// maxLength / minLength / decimalPlaces join only when W-C-17 retypes them at the parser (neo4j.int would throw on "80").
const INTEGER_VALUED_PROPERTY_NAME_LIST = Object.freeze([
	'byteCount', 'classCount', 'closeMappedProperties', 'codeCount', 'codePosition', 'contentEdgeCount', 'contentNodeCount',
	'contextPathCount', 'depth', 'documentDepth', 'documentPosition', 'embeddingDims', 'emitTimeRowCount', 'exactMappedProperties',
	'exemplarCount', 'explicitlyOmittedTotal', 'fieldCount', 'finishTimeRowCount', 'instanceCount', 'inventedTotal', 'lostTotal',
	'meaningBearingEdgeCount', 'optionValueCount', 'position', 'propertyCount', 'sequence', 'sequenceOrdinal', 'sequencePosition',
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
	{ name: 'stableId', type: 'string', channel: 'all' }, { name: 'gate', type: 'string', channel: 'all' },
	{ name: 'verdict', type: 'string', channel: 'all', valueListName: 'BUILD_ATTESTATION_VERDICT_LIST' },
	{ name: 'verdictSupplied', type: 'boolean', channel: 'all' }, { name: 'expected', type: 'boolean', channel: 'all' },
	{ name: 'detail', type: 'string', channel: 'all' },
	{ name: 'writtenOnChannel', type: 'string', channel: 'all', valueListName: 'ATTESTATION_CHANNEL_LIST' },
	{ name: 'writtenOnChannelNote', type: 'string', channel: 'all' },
	{ name: 'inventedTotal', type: 'integer', channel: 'channelA', gateList: ['fidelity', 'roundTrip'] },
	{ name: 'roundTripClean', type: 'boolean', channel: 'channelA', gateList: ['roundTrip'] },
	{ name: 'lostTotal', type: 'integer', channel: 'channelA', gateList: ['roundTrip'] },
	{ name: 'explicitlyOmittedTotal', type: 'integer', channel: 'channelA', gateList: ['roundTrip'] },
	{ name: 'standardCount', type: 'integer', channel: 'channelA', gateList: ['roundTrip'] },
	{ name: 'exemplarCount', type: 'integer', channel: 'channelB', gateList: ['usagePatternVerification'] },
	{ name: 'verifiedCount', type: 'integer', channel: 'channelB', gateList: ['usagePatternVerification'] },
	{ name: 'evidencePath', type: 'string', channel: 'promotionStamp' }, { name: 'evidenceSha256', type: 'string', channel: 'promotionStamp' },
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
	{ name: 'manifestRefId', type: 'string', required: true }, { name: 'name', type: 'string', required: true },
	{ name: 'description', type: 'string', required: true }, { name: 'recipeName', type: 'string', required: true },
	{ name: 'recipeHash', type: 'string', required: true }, { name: 'recipeFileName', type: 'string', required: true },
	{ name: 'basedOnManifestRefId', type: 'string', required: false }, { name: 'basedOnManifestRefIdBasis', type: 'string', required: false },
	{ name: 'createdAt', type: 'string', required: true }, { name: 'isRootOfThisGraph', type: 'boolean', required: true },
	{ name: 'previousManifestId', type: 'string', required: false },
].map((oneRow) => Object.freeze(oneRow)));
const RECIPE_BLOCK_FIELD_LIST = Object.freeze([
	{ name: 'schemaBlockRefId', type: 'string', required: true }, { name: 'kind', type: 'string', required: true },
	{ name: 'subject', type: 'string', required: true }, { name: 'version', type: 'string', required: false },
	{ name: 'position', type: 'integer', required: true }, { name: 'purpose', type: 'string', required: true },
	{ name: 'purposeSource', type: 'string', required: true }, { name: 'purposeTemplateSite', type: 'string', required: true },
	{ name: 'producedByRecipeName', type: 'string', required: false }, { name: 'requiresSchemaBlockRefIdList', type: 'stringList', required: false },
	{ name: 'pairA', type: 'string', required: false }, { name: 'pairAVersion', type: 'string', required: false },
	{ name: 'pairB', type: 'string', required: false }, { name: 'pairBVersion', type: 'string', required: false },
].map((oneRow) => Object.freeze(oneRow)));
const STANDARD_DEFINITION_FIELD_LIST = Object.freeze([
	{ name: 'sourceKey', type: 'string', required: true }, { name: 'standardKey', type: 'string', required: true },
	{ name: 'standardName', type: 'string', required: true }, { name: 'version', type: 'string', required: true },
	{ name: 'versionSource', type: 'string', required: true }, { name: 'publishedVersion', type: 'string', required: true },
	{ name: 'versionDisagreement', type: 'boolean', required: true }, { name: 'versionNote', type: 'string', required: false },
	{ name: 'snapshotKey', type: 'string', required: true }, { name: 'sourceFormat', type: 'string', required: true },
	{ name: 'sourceUrl', type: 'string', required: false }, { name: 'propertyCount', type: 'integer', required: true },
	{ name: 'classCount', type: 'integer', required: true }, { name: 'optionValueCount', type: 'integer', required: true },
	{ name: 'exactMappedProperties', type: 'integer', required: true }, { name: 'closeMappedProperties', type: 'integer', required: true },
	{ name: 'mappingKindList', type: 'stringList', required: true }, { name: 'mappingSourceList', type: 'stringList', required: true },
	{ name: 'mappingEdgeTypes', type: 'stringList', required: true }, { name: 'unkindedMappingEdgeCount', type: 'integer', required: false },
	{ name: 'standardKind', type: 'string', required: true }, { name: 'standardUsageTips', type: 'string', required: true },
	{ name: 'standardFamily', type: 'string', required: false }, { name: 'releaseLabel', type: 'string', required: false },
].map((oneRow) => Object.freeze(oneRow)));
const USAGE_PATTERN_FIELD_LIST = Object.freeze([
	{ name: 'patternName', type: 'string', required: true }, { name: 'question', type: 'string', required: true },
	{ name: 'cypher', type: 'string', required: true }, { name: 'caveat', type: 'string', required: true },
	{ name: 'entryLabel', type: 'string', required: true }, { name: 'emitTimeRowCount', type: 'integer', required: true },
	{ name: 'finishTimeRowCount', type: 'integer', required: false }, { name: 'zeroRowMeaning', type: 'string', required: true },
].map((oneRow) => Object.freeze(oneRow)));
// the self-doc names readers may still ask for, by label, each with its replacement (or 'none')
const SELF_DOC_RETIRED_FIELD_NAME_BY_LABEL = Object.freeze({
	ManifestRecipe: Object.freeze({ manifestKey: 'manifestRefId', label: 'name', note: 'description', basedOn: 'basedOnManifestRefId', isBuildManifest: 'isRootOfThisGraph' }),
	RecipeBlock: Object.freeze({ blockId: 'schemaBlockRefId', blockType: 'kind', producedBy: 'none: the manifest recipeName' }),
	StandardDefinition: Object.freeze({ source: 'sourceKey', displayName: 'standardName', mappingDisposition: 'mappingKindList + mappingSourceList', exactEdgeCount: 'exactMappedProperties', closeEdgeCount: 'closeMappedProperties', nodeCount: 'none', optionSetCount: 'none', description: 'none', subjectVersions: 'none', objectVersions: 'none' }),
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
	graphContractDocument,
	canonicalJsonText,
	graphContractSha256,
});
