'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridgePluginContract.js — BRIDGE_DECLARATION_CONTRACT + BRIDGE_HOOK_CONTRACT + their table-walk
// validators + the forbidden-substrate scan (SPEC-bridgeFramework-v1.md §4; RULINGS A3, BF6, BF7, BF10,
// BF13, BF14, BF18). The RETIRED interfaces.js BRIDGE_MODULE_SHAPE's successor (RULING P10).
//
// A plugin is DATA (bridgeDeclaration) + exactly the hooks named here (bridgeHooks). Validation is a
// TABLE WALK over the contract — the forgeDeclarationContract.js IDIOM, MIRRORED (the lift into a shared
// module is STRUCK, RULING BF12): every property has a `kind` checked by ONE registry of kind-checkers;
// closed values are enumerated as data; every refusal names the property and what to fix. PURE where it
// can be: the only I/O is the registration-time read of a document channel's HEADER ROW (RULING BF6 —
// coverage is checked at load) and the existence checks of the declared files (FF §5.4 "declared-but-
// broken refuses every build").
//
// Refused by name (SPEC §4.3): missing required key; UNKNOWN key; wrong kind; a closed value outside its
// list; producerKind disagreeing with matchBasis; predicateSource.kind outside the three; a table present
// without a column/labelTable kind or absent with one; a table predicate not SKOS; tupleFieldColumnMap
// lacking canonicalKey / naming a field outside the tuple / a transform outside the registry; a document
// channel whose file or checksum list is absent; a value channel not refuseByNameAndCount; a header
// column unclassified / a classified column absent / a duplicated header name unresolved by
// headerOverrideByIndex / a top-level reference naming a column no walk channel classified; a forgedGraph
// channel without channelPropertyList; a hook missing / unknown / wrong arity; a hook declared false but
// present; a forbidden require or function name; a non-empty compatibilityDeclarationList; a
// mappingProvider.url that is not a URL; a non-empty globalGuidanceList with globalGuidance undeclared.

const fs = require('fs');
const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const transformRegistryLib = require('./transformRegistry');
const bridgeAllowanceRegistryLib = require('./bridgeAllowanceRegistry');

const { SKOS_PREDICATES } = vocabularyLib;

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

// ---------------------------------------------------------------------
// THE CLOSED VOCABULARIES (SPEC §3.3 contracts.*) — data the record carries
// ---------------------------------------------------------------------
const MATCH_BASIS_LIST = Object.freeze(['standard', 'crosswalk']);
const PRODUCER_KIND_LIST = Object.freeze(['authored']);
// producerKind is DECLARED and CHECKED against matchBasis (RULING A1): both v1 bases are authored
const PRODUCER_KIND_BY_MATCH_BASIS = Object.freeze({ standard: 'authored', crosswalk: 'authored' });
// the walk-channel kind a matchBasis needs at least one of (crosswalk: the document; standard: the forged graph) — DATA
const WALK_CHANNEL_SOURCE_KIND_BY_MATCH_BASIS = Object.freeze({ crosswalk: 'document', standard: 'forgedGraph' });
const RESOLUTION_LIST = Object.freeze(['specified', 'judged']);
const PREDICATE_SOURCE_KIND_LIST = Object.freeze(['column', 'labelTable', 'channelAssertion']);
const PREDICATE_ASSERTED_BY_LIST = Object.freeze(['source', 'labelTable', 'channelAssertion']);
const PREDICATE_ASSERTED_BY_BY_SOURCE_KIND = Object.freeze({ column: 'source', labelTable: 'labelTable', channelAssertion: 'channelAssertion' });
const LABEL_DISPOSITION_LIST = Object.freeze(['predicate', 'tentative', 'refused', 'sentinelOnly']);
const TUPLE_FIELD_LIST = Object.freeze(['canonicalKey', 'domainId', 'propertyKey', 'range', 'valueKey', 'qualifierKeys']);
const TUPLE_LIST_FIELD_LIST = Object.freeze(['qualifierKeys']); // compared as sorted lists; re-widened at the read boundary
const SOURCE_KIND_LIST = Object.freeze(['document', 'forgedGraph']);
const CHANNEL_TIER_LIST = Object.freeze(['property', 'value']);
const CHANNEL_DISPOSITION_LIST = Object.freeze(['walk', 'refuseByNameAndCount']);
const COLUMN_CLASSIFICATION_LIST_NAME_LIST = Object.freeze([
	'subjectIdentityColumnList',
	'tupleFieldColumnList',
	'sourceLabelColumnList',
	'carriedRecordColumnList',
	'evidenceOnlyColumnList',
	'consistencyCheckColumnList',
	'ignoredColumnList',
]);
const EVIDENCE_REFERENCE_LIST_NAME_LIST = Object.freeze(['evidenceOnlyColumnList', 'carriedRecordColumnList', 'sourceLabelColumnList']);
const SUBJECT_IDENTITY_KIND_LIST = Object.freeze(['columnTuple', 'forgedNode']);
const CONSISTENCY_DISPOSITION_LIST = Object.freeze(['refuse', 'report']);
const SEGMENT_RULE_APPLIES_TO_LIST = Object.freeze(['entity', 'segment', 'lastSegment']);
const SEGMENT_RULE_ACTION_LIST = Object.freeze(['stripSuffix', 'stripPrefix', 'invertDescriptor']);
const EVIDENCE_HOOK_NAME_LIST = Object.freeze(['nominate', 'walkEvidence', 'globalGuidance']);
// exactly the `config` keys build.js composes (SPEC §3.3; [code fact] build.js bridgeOnePairing config block)
const RUN_CONFIG_KEY_LIST = Object.freeze([
	'limit',
	'offset',
	'sourceStandard',
	'sourceStandardName',
	'sourceVersion',
	'hubVersion',
	'pairWith',
	'pairWithVersion',
	'familyStandards',
]);
// what run returns (SPEC §5.9) — MIRRORED as data in interfaces.js COMPONENT_SHAPES.bridgeMaker.run.resultKeys (BR-140)
const RUN_REPORT_RESULT_KEYS = Object.freeze([
	'inGraph',
	'bridge',
	'applyLabel',
	'producer',
	'decisionBlock',
	'blocks',
	'edgesWritten',
	'counts',
	'generation',
	'rendererVersion',
	'mode',
	'sssomExportPath',
	'note',
]);
// the walk assertion's forbidden keys — a plugin cannot set what the framework derives (BR-022)
const WALK_ASSERTION_FORBIDDEN_KEY_LIST = Object.freeze(['resolution', 'confidence', 'matchBasis', 'mappingJustification', 'objectStableId', 'stableId', 'cardStableId']);
const WALK_ASSERTION_KEY_LIST = Object.freeze([
	'channelKey',
	'subjectIdentity',
	'rawTargetList',
	'tupleFieldValues',
	'sourcePredicate',
	'sourceLabelByColumn',
	'sourceNoteByColumn',
	'carriedRecord',
	'evidence',
	'sourceLocator',
]);
const CHANNEL_REPORT_KEY_LIST = Object.freeze(['rowsRead', 'assertionsYielded', 'sentinelDropped', 'malformedRows', 'valueTierRows']);

// ---------------------------------------------------------------------
// FORBIDDEN SUBSTRATE — a plugin file that requires or defines any of these is refused at registration
// (SPEC §4.2 "struck, deliberately"; BR-111; HARVEST R-H12)
// ---------------------------------------------------------------------
const FORBIDDEN_REQUIRE_LIST = Object.freeze([
	'neo4j-driver',
	'sqlite',
	'better-sqlite3',
	'lib/decision-store',
	'lib/judgment-cache',
	'lib/match-forensics',
	'bridge-maker/lib/llmClient',
	'debugJudge',
	'@anthropic-ai/',
	'lib/embedding/',
	'lib/vector-store/',
	'lib/replay/',
]);
const FORBIDDEN_FUNCTION_NAME_LIST = Object.freeze(['resolveTarget', 'writeEdge', 'openDriver', 'rerank']);
const FORBIDDEN_SOURCE_TOKEN_LIST = Object.freeze(['addressSignature', 'HubReference', 'MERGE ', 'CREATE ', 'session.run']);

// ---------------------------------------------------------------------
// BRIDGE_DECLARATION_CONTRACT — one row per key, kind-checked by the registry below
// ---------------------------------------------------------------------
const BRIDGE_DECLARATION_CONTRACT = Object.freeze({
	bridgeName: Object.freeze({ required: true, kind: 'lowerCamelString' }),
	standardKey: Object.freeze({ required: true, kind: 'lowercaseString' }),
	pluginVersion: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	producerKind: Object.freeze({ required: true, kind: 'closedValue', allowedValueList: PRODUCER_KIND_LIST }),
	matchBasis: Object.freeze({ required: true, kind: 'closedValue', allowedValueList: MATCH_BASIS_LIST }),
	mappingProvider: Object.freeze({ required: true, kind: 'mappingProvider' }),
	sourceCuriePrefix: Object.freeze({ required: true, kind: 'curiePrefix' }),
	subjectCuriePrefix: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	sourceChannelList: Object.freeze({ required: true, kind: 'sourceChannelList' }),
	subjectIdentity: Object.freeze({ required: true, kind: 'subjectIdentity' }),
	tupleFieldColumnMap: Object.freeze({ required: true, kind: 'tupleFieldColumnMap' }),
	predicateSource: Object.freeze({ required: true, kind: 'predicateSource' }),
	evidenceColumnMap: Object.freeze({ required: true, kind: 'evidenceColumnMap' }),
	consistencyCheckColumnList: Object.freeze({ required: true, kind: 'consistencyCheckColumnList' }),
	segmentNormalisationRuleList: Object.freeze({ required: true, kind: 'segmentNormalisationRuleList' }),
	remodelTableRef: Object.freeze({ required: true, kind: 'stringOrNull' }),
	classSideRemodelTable: Object.freeze({ required: true, kind: 'classSideRemodelTable' }),
	blindingDeclaration: Object.freeze({ required: true, kind: 'stringList' }),
	evidenceHooksDeclared: Object.freeze({ required: true, kind: 'evidenceHooksDeclared' }),
	globalGuidanceList: Object.freeze({ required: true, kind: 'stringList' }),
	compatibilityDeclarationList: Object.freeze({ required: true, kind: 'compatibilityDeclarationList' }),
});

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
// walkChannelListOf — the declared WALK channels that carry a classification (the table walk validates
// sourceChannelList BEFORE every key that references it, so an unlisted/invalid list here is already refused;
// this reads the validated list — no default is manufactured, an invalid list yields no channels)
const walkChannelListOf = (bridgeDeclaration) => (Array.isArray(bridgeDeclaration.sourceChannelList) ? bridgeDeclaration.sourceChannelList : []).filter((oneChannel) => isPlainObject(oneChannel) && oneChannel.disposition === 'walk' && isPlainObject(oneChannel.columnClassification));
const isStringList = (value) => Array.isArray(value) && value.every((oneEntry) => typeof oneEntry === 'string');
const isUrl = (value) => typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value);
const listAsText = (list) => list.join(', ');

const closedValueReason = (value, allowedValueList, whatName) =>
	allowedValueList.indexOf(value) !== -1 ? '' : `${whatName} '${value}' is not one of: ${listAsText(allowedValueList)}`;

const labelTableReason = (table) => {
	if (!isPlainObject(table)) {
		return `table must be an object sourceLabel → { disposition, ... } (got ${JSON.stringify(table)})`;
	}
	const labelList = Object.keys(table);
	for (let labelIndex = 0; labelIndex < labelList.length; labelIndex++) {
		const oneLabel = labelList[labelIndex];
		const oneRow = table[oneLabel];
		if (!isPlainObject(oneRow)) {
			return `table['${oneLabel}'] is not an object`;
		}
		const dispositionReason = closedValueReason(oneRow.disposition, LABEL_DISPOSITION_LIST, `table['${oneLabel}'].disposition`);
		if (dispositionReason) {
			return dispositionReason;
		}
		const rowKeyList = Object.keys(oneRow);
		if (oneRow.disposition === 'predicate') {
			if (SKOS_PREDICATES.indexOf(oneRow.predicate) === -1) {
				return `table['${oneLabel}'].predicate '${oneRow.predicate}' is not a SKOS_PREDICATES member (${listAsText(SKOS_PREDICATES)}); an OWL predicate is never accepted`;
			}
			if (rowKeyList.length !== 2) {
				return `table['${oneLabel}'] with disposition 'predicate' carries exactly { disposition, predicate } (got ${listAsText(rowKeyList)})`;
			}
		} else if (oneRow.disposition === 'tentative') {
			if (SKOS_PREDICATES.indexOf(oneRow.predicateIfPicked) === -1) {
				return `table['${oneLabel}'].predicateIfPicked '${oneRow.predicateIfPicked}' is not a SKOS_PREDICATES member (${listAsText(SKOS_PREDICATES)})`;
			}
			if (rowKeyList.length !== 2) {
				return `table['${oneLabel}'] with disposition 'tentative' carries exactly { disposition, predicateIfPicked } (got ${listAsText(rowKeyList)})`;
			}
		} else if (oneRow.disposition === 'refused') {
			if (!isNonEmptyString(oneRow.reason) || rowKeyList.length !== 2) {
				return `table['${oneLabel}'] with disposition 'refused' carries exactly { disposition, reason (non-empty) }`;
			}
		} else if (rowKeyList.length !== 1) {
			return `table['${oneLabel}'] with disposition 'sentinelOnly' carries only { disposition }`;
		}
	}
	return '';
};

const columnClassificationReason = (columnClassification, channelKey) => {
	if (!isPlainObject(columnClassification)) {
		return `channel '${channelKey}' columnClassification must be an object of the seven lists (${listAsText(COLUMN_CLASSIFICATION_LIST_NAME_LIST)})`;
	}
	const unknownName = Object.keys(columnClassification).find((oneName) => COLUMN_CLASSIFICATION_LIST_NAME_LIST.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return `channel '${channelKey}' columnClassification carries unknown list '${unknownName}'`;
	}
	for (let listIndex = 0; listIndex < COLUMN_CLASSIFICATION_LIST_NAME_LIST.length; listIndex++) {
		const oneListName = COLUMN_CLASSIFICATION_LIST_NAME_LIST[listIndex];
		if (!isStringList(columnClassification[oneListName])) {
			return `channel '${channelKey}' columnClassification.${oneListName} must be a list of strings (absent is absent — declare [] to say "none")`;
		}
	}
	// a column in TWO lists is a double classification
	const seen = {};
	for (let listIndex = 0; listIndex < COLUMN_CLASSIFICATION_LIST_NAME_LIST.length; listIndex++) {
		const oneListName = COLUMN_CLASSIFICATION_LIST_NAME_LIST[listIndex];
		const columnList = columnClassification[oneListName];
		for (let columnIndex = 0; columnIndex < columnList.length; columnIndex++) {
			const oneColumn = columnList[columnIndex];
			if (seen[oneColumn]) {
				return `channel '${channelKey}' column '${oneColumn}' is classified twice (${seen[oneColumn]} and ${oneListName}); every column is in EXACTLY ONE list`;
			}
			seen[oneColumn] = oneListName;
		}
	}
	return '';
};

const classifiedColumnSetFor = (columnClassification) => {
	const columnSet = new Set();
	COLUMN_CLASSIFICATION_LIST_NAME_LIST.forEach((oneListName) => {
		(columnClassification[oneListName] || []).forEach((oneColumn) => columnSet.add(oneColumn));
	});
	return columnSet;
};

// the per-kind predicateSource validators — a registry, never a branch on kind (BG-COMPOSE c)
const tableKindValidator = (value, { walkChannelList }) => {
	if (!isNonEmptyString(value.column)) {
		return `kind '${value.kind}' needs a column`;
	}
	if (!walkChannelList.some((oneChannel) => (oneChannel.columnClassification.sourceLabelColumnList || []).indexOf(value.column) !== -1)) {
		return `predicateSource.column '${value.column}' is not classified in any walk channel's sourceLabelColumnList`;
	}
	if (value.table === undefined) {
		return `kind '${value.kind}' needs a table`;
	}
	return labelTableReason(value.table);
};
const PREDICATE_SOURCE_KIND_VALIDATOR_REGISTRY = Object.freeze({
	column: tableKindValidator,
	labelTable: tableKindValidator,
	channelAssertion: (value) => {
		if (SKOS_PREDICATES.indexOf(value.predicate) === -1) {
			return `channelAssertion predicate '${value.predicate}' is not a SKOS_PREDICATES member`;
		}
		if (!isPlainObject(value.assertedBy) || !isNonEmptyString(value.assertedBy.documentName) || !isNonEmptyString(value.assertedBy.citation)) {
			return `channelAssertion needs assertedBy: { documentName, citation } — a source-attributed claim with a citation, not a producer constant`;
		}
		if (value.table !== undefined || value.column !== undefined) {
			return `channelAssertion carries no table and no column`;
		}
		return '';
	},
});

// the per-kind subjectIdentity validators — a registry, never a branch on kind (BG-COMPOSE c)
const SUBJECT_IDENTITY_KIND_VALIDATOR_REGISTRY = Object.freeze({
	columnTuple: (value, { bridgeDeclaration }) => {
		if (!isStringList(value.columnList) || value.columnList.length === 0) {
			return `columnTuple needs a non-empty columnList`;
		}
		const walkChannelList = walkChannelListOf(bridgeDeclaration);
		const outside = value.columnList.find((oneColumn) => !walkChannelList.some((oneChannel) => (oneChannel.columnClassification.subjectIdentityColumnList || []).indexOf(oneColumn) !== -1));
		return outside !== undefined ? `columnList names '${outside}', which no walk channel classifies in subjectIdentityColumnList` : '';
	},
	forgedNode: (value) => (value.property === 'stableId' ? '' : `forgedNode subject identity property must be 'stableId' (got ${JSON.stringify(value.property)})`),
});

// ONE registry of kind checkers: (value, { propertyName, contractEntry, bridgeDeclaration }) → '' or a reason
const KIND_CHECKER_REGISTRY = Object.freeze({
	nonEmptyString: (value) => (isNonEmptyString(value) ? '' : `must be a non-empty string (got ${JSON.stringify(value)})`),
	stringOrNull: (value) => (value === null || isNonEmptyString(value) ? '' : `must be a non-empty string or null (got ${JSON.stringify(value)})`),
	lowercaseString: (value) =>
		isNonEmptyString(value) && value === value.toLowerCase() ? '' : `must be a non-empty lowercase string (got ${JSON.stringify(value)})`,
	lowerCamelString: (value) =>
		isNonEmptyString(value) && /^[a-z][A-Za-z0-9]*$/.test(value) ? '' : `must be a lowerCamel identifier (got ${JSON.stringify(value)})`,
	stringList: (value) => (isStringList(value) ? '' : `must be a list of strings (got ${JSON.stringify(value)}); [] means "none", absence is refused`),
	closedValue: (value, { contractEntry, propertyName }) => closedValueReason(value, contractEntry.allowedValueList, propertyName),
	mappingProvider: (value) => {
		if (!isPlainObject(value)) {
			return `must be { url, verifiedBy } (got ${JSON.stringify(value)})`;
		}
		if (!isUrl(value.url)) {
			return `url ${JSON.stringify(value.url)} is not a URL (http(s)://…)`;
		}
		if (value.verifiedBy !== null && !(isPlainObject(value.verifiedBy) && isNonEmptyString(value.verifiedBy.sessionName) && isNonEmptyString(value.verifiedBy.date) && isNonEmptyString(value.verifiedBy.note))) {
			return `verifiedBy must be null (not yet verified — export refuses) or { sessionName, date, note } (got ${JSON.stringify(value.verifiedBy)})`;
		}
		const extra = Object.keys(value).filter((oneName) => oneName !== 'url' && oneName !== 'verifiedBy');
		return extra.length ? `carries unknown key '${extra[0]}'; the shape is exactly { url, verifiedBy }` : '';
	},
	curiePrefix: (value) => {
		if (!isPlainObject(value) || !isNonEmptyString(value.prefix) || !isNonEmptyString(value.iri)) {
			return `must be { prefix, iri } (got ${JSON.stringify(value)})`;
		}
		return /^[A-Za-z][A-Za-z0-9]*$/.test(value.prefix) ? '' : `prefix '${value.prefix}' is not CURIE-safe (letters and digits only)`;
	},
	sourceChannelList: (value, { bridgeDeclaration }) => {
		if (!Array.isArray(value) || value.length === 0) {
			return `must be a NON-EMPTY list of channel objects (got ${JSON.stringify(value)})`;
		}
		const seenChannelKeys = {};
		for (let channelIndex = 0; channelIndex < value.length; channelIndex++) {
			const oneChannel = value[channelIndex];
			if (!isPlainObject(oneChannel) || !isNonEmptyString(oneChannel.channelKey)) {
				return `entry ${channelIndex} must be a channel object carrying channelKey`;
			}
			const channelKey = oneChannel.channelKey;
			if (seenChannelKeys[channelKey]) {
				return `channelKey '${channelKey}' is declared twice`;
			}
			seenChannelKeys[channelKey] = true;
			const kindReason = closedValueReason(oneChannel.sourceKind, SOURCE_KIND_LIST, `channel '${channelKey}' sourceKind`);
			if (kindReason) {
				return kindReason;
			}
			const tierReason = closedValueReason(oneChannel.tier, CHANNEL_TIER_LIST, `channel '${channelKey}' tier`);
			if (tierReason) {
				return tierReason;
			}
			const dispositionReason = closedValueReason(oneChannel.disposition, CHANNEL_DISPOSITION_LIST, `channel '${channelKey}' disposition`);
			if (dispositionReason) {
				return dispositionReason;
			}
			if (oneChannel.tier === 'value' && oneChannel.disposition !== 'refuseByNameAndCount') {
				return `channel '${channelKey}' is tier 'value' and MUST carry disposition 'refuseByNameAndCount' in v1 (BR-080, BR-134); got '${oneChannel.disposition}'`;
			}
			if (!isStringList(oneChannel.absentTargetSentinelList)) {
				return `channel '${channelKey}' absentTargetSentinelList must be a list of strings ([] to say "no sentinel")`;
			}
			if (oneChannel.sourceKind === 'document') {
				if (!isNonEmptyString(oneChannel.relativePathFromBundleRoot) || path.isAbsolute(oneChannel.relativePathFromBundleRoot)) {
					return `document channel '${channelKey}' needs a RELATIVE relativePathFromBundleRoot`;
				}
				if (!isNonEmptyString(oneChannel.checksumListRelativePathFromBundleRoot) || path.isAbsolute(oneChannel.checksumListRelativePathFromBundleRoot)) {
					return `document channel '${channelKey}' needs a RELATIVE checksumListRelativePathFromBundleRoot (the SHA256SUMS)`;
				}
				if (!isNonEmptyString(oneChannel.encoding)) {
					return `document channel '${channelKey}' must declare encoding (utf-8, latin1, …); no default`;
				}
				if (oneChannel.headerOverrideByIndex !== undefined) {
					if (!isPlainObject(oneChannel.headerOverrideByIndex) || Object.keys(oneChannel.headerOverrideByIndex).some((oneIndex) => !/^\d+$/.test(oneIndex) || !isNonEmptyString(oneChannel.headerOverrideByIndex[oneIndex]))) {
						return `document channel '${channelKey}' headerOverrideByIndex must map a column INDEX to a name`;
					}
				}
				if (oneChannel.channelPropertyList !== undefined) {
					return `document channel '${channelKey}' must not declare channelPropertyList (that is a forgedGraph channel's key)`;
				}
			} else {
				if (!isStringList(oneChannel.channelPropertyList) || oneChannel.channelPropertyList.length === 0) {
					return `forgedGraph channel '${channelKey}' MUST declare a non-empty channelPropertyList — the node properties the walk may read UNBLINDED and nothing else (RULING BF7)`;
				}
				if (oneChannel.relativePathFromBundleRoot !== undefined || oneChannel.checksumListRelativePathFromBundleRoot !== undefined || oneChannel.encoding !== undefined || oneChannel.headerOverrideByIndex !== undefined) {
					return `forgedGraph channel '${channelKey}' must not declare a document key (relativePathFromBundleRoot / checksumList… / encoding / headerOverrideByIndex)`;
				}
			}
			if (oneChannel.disposition === 'walk') {
				const classificationReason = columnClassificationReason(oneChannel.columnClassification, channelKey);
				if (classificationReason) {
					return classificationReason;
				}
				if (oneChannel.headerColumnList !== undefined) {
					return `walk channel '${channelKey}' must not declare headerColumnList (that is a refuseByNameAndCount channel's key; coverage comes from the header itself)`;
				}
			} else {
				if (!isStringList(oneChannel.headerColumnList)) {
					return `refuseByNameAndCount channel '${channelKey}' MUST list its header (headerColumnList) so the count is honest (RULING BF6)`;
				}
				if (oneChannel.columnClassification !== undefined) {
					return `refuseByNameAndCount channel '${channelKey}' is EXEMPT from coverage and must not carry columnClassification`;
				}
			}
			const knownChannelKeyList = ['channelKey', 'sourceKind', 'relativePathFromBundleRoot', 'checksumListRelativePathFromBundleRoot', 'encoding', 'headerOverrideByIndex', 'channelPropertyList', 'tier', 'disposition', 'absentTargetSentinelList', 'columnClassification', 'headerColumnList'];
			const unknownChannelKey = Object.keys(oneChannel).find((oneName) => knownChannelKeyList.indexOf(oneName) === -1);
			if (unknownChannelKey !== undefined) {
				return `channel '${channelKey}' carries unknown key '${unknownChannelKey}'`;
			}
		}
		const requiredWalkKind = WALK_CHANNEL_SOURCE_KIND_BY_MATCH_BASIS[bridgeDeclaration.matchBasis];
		if (requiredWalkKind !== undefined && !value.some((oneChannel) => oneChannel.sourceKind === requiredWalkKind && oneChannel.disposition === 'walk')) {
			return `matchBasis '${bridgeDeclaration.matchBasis}' needs at least one '${requiredWalkKind}' walk channel`;
		}
		return '';
	},
	subjectIdentity: (value, { bridgeDeclaration }) => {
		if (!isPlainObject(value)) {
			return `must be { kind: 'columnTuple', columnList } | { kind: 'forgedNode', property } (got ${JSON.stringify(value)})`;
		}
		const kindReason = closedValueReason(value.kind, SUBJECT_IDENTITY_KIND_LIST, 'subjectIdentity.kind');
		if (kindReason) {
			return kindReason;
		}
		return SUBJECT_IDENTITY_KIND_VALIDATOR_REGISTRY[value.kind](value, { bridgeDeclaration });
	},
	tupleFieldColumnMap: (value, { bridgeDeclaration }) => {
		if (!isPlainObject(value)) {
			return `must be an object tupleField → { column, transform } (got ${JSON.stringify(value)})`;
		}
		if (value.canonicalKey === undefined) {
			return `MUST name canonicalKey (the join key); nothing is inferred`;
		}
		const fieldList = Object.keys(value);
		const walkChannelList = walkChannelListOf(bridgeDeclaration);
		for (let fieldIndex = 0; fieldIndex < fieldList.length; fieldIndex++) {
			const oneField = fieldList[fieldIndex];
			if (TUPLE_FIELD_LIST.indexOf(oneField) === -1) {
				return `'${oneField}' is not a tuple field (${listAsText(TUPLE_FIELD_LIST)})`;
			}
			const oneEntry = value[oneField];
			if (!isPlainObject(oneEntry) || !isNonEmptyString(oneEntry.column) || !isNonEmptyString(oneEntry.transform)) {
				return `${oneField} must be { column, transform }`;
			}
			if (transformRegistryLib.TRANSFORM_NAME_LIST.indexOf(oneEntry.transform) === -1) {
				return `${oneField}.transform '${oneEntry.transform}' is not in TRANSFORM_REGISTRY (${listAsText(transformRegistryLib.TRANSFORM_NAME_LIST)})`;
			}
			if (!walkChannelList.some((oneChannel) => (oneChannel.columnClassification.tupleFieldColumnList || []).indexOf(oneEntry.column) !== -1)) {
				return `${oneField}.column '${oneEntry.column}' is not classified in any walk channel's tupleFieldColumnList`;
			}
		}
		return '';
	},
	predicateSource: (value, { bridgeDeclaration }) => {
		if (!isPlainObject(value)) {
			return `must be one of the closed kinds { kind: column | labelTable | channelAssertion, … } (got ${JSON.stringify(value)}); 'none' is not a kind — declare what the source asserts or do not register the channel`;
		}
		const kindReason = closedValueReason(value.kind, PREDICATE_SOURCE_KIND_LIST, 'predicateSource.kind');
		if (kindReason) {
			return kindReason;
		}
		const walkChannelList = walkChannelListOf(bridgeDeclaration);
		return PREDICATE_SOURCE_KIND_VALIDATOR_REGISTRY[value.kind](value, { walkChannelList });
	},
	evidenceColumnMap: (value, { bridgeDeclaration }) => {
		if (!isPlainObject(value) || !isStringList(value.subject) || !isStringList(value.assertion)) {
			return `must be { subject: [columns], assertion: [columns] } (either may be [])`;
		}
		const extra = Object.keys(value).filter((oneName) => oneName !== 'subject' && oneName !== 'assertion');
		if (extra.length) {
			return `carries unknown key '${extra[0]}'`;
		}
		const walkChannelList = walkChannelListOf(bridgeDeclaration);
		const isReferenceable = (oneColumn) => walkChannelList.some((oneChannel) => EVIDENCE_REFERENCE_LIST_NAME_LIST.some((oneListName) => (oneChannel.columnClassification[oneListName] || []).indexOf(oneColumn) !== -1));
		// a forgedGraph walk channel's evidence columns are the source NODE's own properties read through
		// forEvidence(); they are referenceable when the channel classifies them OR when the channel is a
		// forgedGraph channel (its record's remaining properties come from the node itself, SPEC §11)
		const hasForgedGraphWalk = walkChannelList.some((oneChannel) => oneChannel.sourceKind === 'forgedGraph');
		const outside = value.subject.concat(value.assertion).find((oneColumn) => !isReferenceable(oneColumn) && !hasForgedGraphWalk);
		return outside !== undefined ? `names '${outside}', which no walk channel classifies as evidenceOnly / carriedRecord / sourceLabel` : '';
	},
	consistencyCheckColumnList: (value, { bridgeDeclaration }) => {
		if (!Array.isArray(value)) {
			return `must be a list (may be []) of { column, transform, against, disposition }`;
		}
		const walkChannelList = walkChannelListOf(bridgeDeclaration);
		for (let entryIndex = 0; entryIndex < value.length; entryIndex++) {
			const oneEntry = value[entryIndex];
			if (!isPlainObject(oneEntry) || !isNonEmptyString(oneEntry.column) || !isNonEmptyString(oneEntry.transform) || !isNonEmptyString(oneEntry.against)) {
				return `entry ${entryIndex} must be { column, transform, against, disposition }`;
			}
			if (transformRegistryLib.TRANSFORM_NAME_LIST.indexOf(oneEntry.transform) === -1) {
				return `entry '${oneEntry.column}' transform '${oneEntry.transform}' is not in TRANSFORM_REGISTRY`;
			}
			if (oneEntry.against !== 'canonicalKey' && !/^card\.[A-Za-z]+$/.test(oneEntry.against)) {
				return `entry '${oneEntry.column}' against must be 'canonicalKey' or 'card.<property>' (got '${oneEntry.against}')`;
			}
			const dispositionReason = closedValueReason(oneEntry.disposition, CONSISTENCY_DISPOSITION_LIST, `entry '${oneEntry.column}' disposition`);
			if (dispositionReason) {
				return dispositionReason;
			}
			if (!walkChannelList.some((oneChannel) => (oneChannel.columnClassification.consistencyCheckColumnList || []).indexOf(oneEntry.column) !== -1)) {
				return `entry column '${oneEntry.column}' is not classified in any walk channel's consistencyCheckColumnList`;
			}
		}
		return '';
	},
	segmentNormalisationRuleList: (value) => {
		if (!Array.isArray(value)) {
			return `must be a list (may be []) of { appliesTo, match, action }`;
		}
		for (let entryIndex = 0; entryIndex < value.length; entryIndex++) {
			const oneEntry = value[entryIndex];
			if (!isPlainObject(oneEntry) || !isNonEmptyString(oneEntry.match)) {
				return `entry ${entryIndex} must be { appliesTo, match (non-empty), action }`;
			}
			const appliesReason = closedValueReason(oneEntry.appliesTo, SEGMENT_RULE_APPLIES_TO_LIST, `entry ${entryIndex} appliesTo`);
			if (appliesReason) {
				return appliesReason;
			}
			const actionReason = closedValueReason(oneEntry.action, SEGMENT_RULE_ACTION_LIST, `entry ${entryIndex} action`);
			if (actionReason) {
				return actionReason;
			}
		}
		return '';
	},
	classSideRemodelTable: (value) => {
		if (!Array.isArray(value)) {
			return `must be a list (may be []) of { canonicalKey, sourceDomainId, sourceSubjectQualifier?, targetDomainId }`;
		}
		for (let entryIndex = 0; entryIndex < value.length; entryIndex++) {
			const oneEntry = value[entryIndex];
			if (!isPlainObject(oneEntry) || !isNonEmptyString(oneEntry.canonicalKey) || !isNonEmptyString(oneEntry.sourceDomainId) || !isNonEmptyString(oneEntry.targetDomainId)) {
				return `entry ${entryIndex} must carry canonicalKey, sourceDomainId, targetDomainId`;
			}
		}
		return '';
	},
	evidenceHooksDeclared: (value) => {
		if (!isPlainObject(value)) {
			return `must be { nominate, walkEvidence, globalGuidance } booleans`;
		}
		const missing = EVIDENCE_HOOK_NAME_LIST.find((oneName) => typeof value[oneName] !== 'boolean');
		if (missing !== undefined) {
			return `${missing} must be a boolean (absent is absent, never defaulted)`;
		}
		const extra = Object.keys(value).find((oneName) => EVIDENCE_HOOK_NAME_LIST.indexOf(oneName) === -1);
		return extra !== undefined ? `carries unknown hook name '${extra}'` : '';
	},
	compatibilityDeclarationList: (value) => {
		if (!Array.isArray(value)) {
			return `must be a list (got ${JSON.stringify(value)})`;
		}
		return bridgeAllowanceRegistryLib.allowanceListReason(value);
	},
});

// ---------------------------------------------------------------------
// registration-time file resolution + header coverage (RULING BF6) — the ONE I/O in this module
// ---------------------------------------------------------------------

// a minimal RFC-4180 header-line reader: quotes, doubled quotes, commas — the framework parses ONLY the
// header row, for coverage; the plugin parses its own rows (SPEC §15.17)
const parseCsvHeaderLine = (headerLine) => {
	const cellList = [];
	let cell = '';
	let inQuotes = false;
	for (let charIndex = 0; charIndex < headerLine.length; charIndex++) {
		const oneChar = headerLine[charIndex];
		if (inQuotes) {
			if (oneChar === '"' && headerLine[charIndex + 1] === '"') {
				cell += '"';
				charIndex++;
			} else if (oneChar === '"') {
				inQuotes = false;
			} else {
				cell += oneChar;
			}
		} else if (oneChar === '"') {
			inQuotes = true;
		} else if (oneChar === ',') {
			cellList.push(cell);
			cell = '';
		} else {
			cell += oneChar;
		}
	}
	cellList.push(cell);
	return cellList;
};

const decodeBytes = ({ bytes, encoding, channelKey }) => {
	const decoder = new TextDecoder(encoding, { fatal: true });
	let text = '';
	let decodeFault = '';
	const attempt = () => {
		text = decoder.decode(bytes);
	};
	try {
		attempt();
	} catch (decodeError) {
		decodeFault = decodeError.message;
	}
	if (decodeFault) {
		return { error: `channel '${channelKey}' bytes do not decode as declared encoding '${encoding}' (${decodeFault})` };
	}
	return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
};

// documentChannelHeaderFor — resolve the file against bundleDirPath, read the header row, apply the
// index override, refuse a surviving duplicate → { headerColumnList } | { error }
const documentChannelHeaderFor = ({ oneChannel, bundleDirPath }) => {
	const filePath = path.join(bundleDirPath, oneChannel.relativePathFromBundleRoot);
	const checksumFilePath = path.join(bundleDirPath, oneChannel.checksumListRelativePathFromBundleRoot);
	if (!fs.existsSync(filePath)) {
		return { error: `document channel '${oneChannel.channelKey}' file is absent on disk: ${filePath}` };
	}
	if (!fs.existsSync(checksumFilePath)) {
		return { error: `document channel '${oneChannel.channelKey}' checksum list is absent on disk: ${checksumFilePath}` };
	}
	const bytes = fs.readFileSync(filePath);
	const decoded = decodeBytes({ bytes, encoding: oneChannel.encoding, channelKey: oneChannel.channelKey });
	if (decoded.error) {
		return { error: decoded.error };
	}
	const firstLine = decoded.text.split(/\r?\n/)[0];
	const rawHeaderList = parseCsvHeaderLine(firstLine).map((oneName) => oneName.trim());
	const override = oneChannel.headerOverrideByIndex || {};
	const headerColumnList = rawHeaderList.map((oneName, oneIndex) => (override[String(oneIndex)] !== undefined ? override[String(oneIndex)] : oneName));
	const badOverrideIndex = Object.keys(override).find((oneIndex) => Number(oneIndex) >= rawHeaderList.length);
	if (badOverrideIndex !== undefined) {
		return { error: `document channel '${oneChannel.channelKey}' headerOverrideByIndex names index ${badOverrideIndex} but the header has ${rawHeaderList.length} columns` };
	}
	const seen = {};
	for (let columnIndex = 0; columnIndex < headerColumnList.length; columnIndex++) {
		const oneName = headerColumnList[columnIndex];
		if (seen[oneName] !== undefined) {
			return { error: `document channel '${oneChannel.channelKey}' header name '${oneName}' is DUPLICATED at indexes ${seen[oneName]} and ${columnIndex} and no headerOverrideByIndex resolves it` };
		}
		seen[oneName] = columnIndex;
	}
	return { headerColumnList, filePath, checksumFilePath };
};

// coverageReason — every header column in EXACTLY ONE classification list; every classified column in the
// header (walk channels only; refuseByNameAndCount channels are exempt but must LIST their header)
const coverageReason = ({ oneChannel, headerColumnList }) => {
	const classifiedSet = classifiedColumnSetFor(oneChannel.columnClassification);
	const unclassified = headerColumnList.find((oneName) => !classifiedSet.has(oneName));
	if (unclassified !== undefined) {
		return `channel '${oneChannel.channelKey}' header column '${unclassified}' is UNCLASSIFIED — put it in exactly one of ${listAsText(COLUMN_CLASSIFICATION_LIST_NAME_LIST)} (ignoredColumnList names it so silence is not mistaken for coverage)`;
	}
	const absent = Array.from(classifiedSet).find((oneName) => headerColumnList.indexOf(oneName) === -1);
	if (absent !== undefined) {
		return `channel '${oneChannel.channelKey}' classifies column '${absent}', which is ABSENT from the header (${listAsText(headerColumnList)})`;
	}
	return '';
};

// resolveChannels — for every channel: document → header + paths; forgedGraph → channelPropertyList as
// header; walk → coverage; → { channelResolutionByKey } | { error }
const resolveChannels = ({ bridgeDeclaration, bundleDirPath }) => {
	const channelResolutionByKey = {};
	for (let channelIndex = 0; channelIndex < bridgeDeclaration.sourceChannelList.length; channelIndex++) {
		const oneChannel = bridgeDeclaration.sourceChannelList[channelIndex];
		let headerColumnList;
		let filePath = null;
		let checksumFilePath = null;
		if (oneChannel.sourceKind === 'document') {
			const resolved = documentChannelHeaderFor({ oneChannel, bundleDirPath });
			if (resolved.error) {
				return { error: resolved.error };
			}
			headerColumnList = resolved.headerColumnList;
			filePath = resolved.filePath;
			checksumFilePath = resolved.checksumFilePath;
		} else {
			headerColumnList = oneChannel.channelPropertyList.slice();
		}
		if (oneChannel.disposition === 'walk') {
			const reason = coverageReason({ oneChannel, headerColumnList });
			if (reason) {
				return { error: reason };
			}
		}
		channelResolutionByKey[oneChannel.channelKey] = Object.freeze({
			channelKey: oneChannel.channelKey,
			sourceKind: oneChannel.sourceKind,
			disposition: oneChannel.disposition,
			tier: oneChannel.tier,
			headerColumnList: Object.freeze(headerColumnList),
			filePath,
			checksumFilePath,
			snapshotDirPath: checksumFilePath === null ? null : path.dirname(checksumFilePath),
			relativePathFromSnapshotDir: filePath === null ? null : path.relative(path.dirname(checksumFilePath), filePath),
		});
	}
	return { channelResolutionByKey: Object.freeze(channelResolutionByKey) };
};

// ---------------------------------------------------------------------
// validateBridgeDeclaration({ bridgeDeclaration, bundleDirPath }) → { error: Error } | { channelResolutionByKey }
// ---------------------------------------------------------------------
const validateBridgeDeclaration = ({ bridgeDeclaration, bundleDirPath } = {}) => {
	const refuseWith = (what, where) => ({ error: refuse.byName({ moduleName, what, where }) });
	if (!isPlainObject(bridgeDeclaration)) {
		return refuseWith(`bridgeDeclaration is ${bridgeDeclaration === null ? 'null' : Array.isArray(bridgeDeclaration) ? 'an array' : `a ${typeof bridgeDeclaration}`}`, 'a plugin file exports { bridgeDeclaration, bridgeHooks }; the declaration is the DATA object of SPEC §4.1');
	}
	if (!isNonEmptyString(bundleDirPath) || !fs.existsSync(bundleDirPath)) {
		return refuseWith(`bundleDirPath ${JSON.stringify(bundleDirPath)} is not a directory on disk`, 'registerPlugin resolves document channels against the plugin bundle');
	}
	const contractNameList = Object.keys(BRIDGE_DECLARATION_CONTRACT);
	// unknown keys first — a typo must not become a silently ignored declaration
	const unknownName = Object.keys(bridgeDeclaration).find((oneName) => contractNameList.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return refuseWith(`bridgeDeclaration carries unknown key '${unknownName}'`, `BRIDGE_DECLARATION_CONTRACT names ${listAsText(contractNameList)}; remove or rename it`);
	}
	for (let nameIndex = 0; nameIndex < contractNameList.length; nameIndex++) {
		const propertyName = contractNameList[nameIndex];
		const contractEntry = BRIDGE_DECLARATION_CONTRACT[propertyName];
		const value = bridgeDeclaration[propertyName];
		if (value === undefined) {
			return refuseWith(`bridgeDeclaration is missing required key '${propertyName}'`, `declare ${propertyName} (${contractEntry.kind}); absent is absent, never defaulted (SPEC §4.1)`);
		}
		const reason = KIND_CHECKER_REGISTRY[contractEntry.kind](value, { propertyName, contractEntry, bridgeDeclaration });
		if (reason !== '') {
			return refuseWith(`bridgeDeclaration '${propertyName}' ${reason}`, `fix ${propertyName} in the plugin's declaration object`);
		}
	}
	// cross-key rules
	if (PRODUCER_KIND_BY_MATCH_BASIS[bridgeDeclaration.matchBasis] !== bridgeDeclaration.producerKind) {
		return refuseWith(`bridgeDeclaration producerKind '${bridgeDeclaration.producerKind}' disagrees with matchBasis '${bridgeDeclaration.matchBasis}' (which is '${PRODUCER_KIND_BY_MATCH_BASIS[bridgeDeclaration.matchBasis]}')`, 'declared AND checked so build.js can never infer the block suffix (RULING A1)');
	}
	if (bridgeDeclaration.globalGuidanceList.length > 0 && bridgeDeclaration.evidenceHooksDeclared.globalGuidance !== true) {
		return refuseWith(`bridgeDeclaration globalGuidanceList is non-empty (${bridgeDeclaration.globalGuidanceList.length}) while evidenceHooksDeclared.globalGuidance is false`, 'declare the hook true or empty the list (RULING BF18)');
	}
	const resolved = resolveChannels({ bridgeDeclaration, bundleDirPath });
	if (resolved.error) {
		return refuseWith(resolved.error, 'declared-but-broken is a refusal on every build (FF §5.4); fix the channel declaration or the bundle');
	}
	return { channelResolutionByKey: resolved.channelResolutionByKey };
};

// ---------------------------------------------------------------------
// BRIDGE_HOOK_CONTRACT + validateBridgeHooks({ bridgeHooks, bridgeDeclaration }) → Error | null
// ---------------------------------------------------------------------
const BRIDGE_HOOK_CONTRACT = Object.freeze({
	walkSourceAssertions: Object.freeze({ required: true, arity: 2 }),
	subjectStableIdFor: Object.freeze({ required: true, arity: 2 }),
	nominateCandidates: Object.freeze({ required: false, arity: 2, declaredBy: 'nominate' }),
	walkEvidence: Object.freeze({ required: false, arity: 2, declaredBy: 'walkEvidence' }),
});
const HOOK_NAME_LIST = Object.freeze(Object.keys(BRIDGE_HOOK_CONTRACT));

const validateBridgeHooks = ({ bridgeHooks, bridgeDeclaration } = {}) => {
	if (!isPlainObject(bridgeHooks)) {
		return refuse.byName({ moduleName, what: `bridgeHooks is ${bridgeHooks === null ? 'null' : `a ${typeof bridgeHooks}`}`, where: 'a plugin file exports { bridgeDeclaration, bridgeHooks }; bridgeHooks is { walkSourceAssertions, subjectStableIdFor, …optional evidence hooks }' });
	}
	const unknownHook = Object.keys(bridgeHooks).find((oneName) => HOOK_NAME_LIST.indexOf(oneName) === -1);
	if (unknownHook !== undefined) {
		return refuse.byName({ moduleName, what: `bridgeHooks carries unknown hook '${unknownHook}'`, where: `BRIDGE_HOOK_CONTRACT names ${listAsText(HOOK_NAME_LIST)}; no resolve/classify/judge/freeze/write/export/run hook exists (SPEC §4.2)` });
	}
	for (let hookIndex = 0; hookIndex < HOOK_NAME_LIST.length; hookIndex++) {
		const hookName = HOOK_NAME_LIST[hookIndex];
		const contractEntry = BRIDGE_HOOK_CONTRACT[hookName];
		const hook = bridgeHooks[hookName];
		const declaredTrue = contractEntry.declaredBy !== undefined && isPlainObject(bridgeDeclaration) && isPlainObject(bridgeDeclaration.evidenceHooksDeclared) && bridgeDeclaration.evidenceHooksDeclared[contractEntry.declaredBy] === true;
		if (hook === undefined) {
			if (contractEntry.required) {
				return refuse.byName({ moduleName, what: `bridgeHooks is missing required hook '${hookName}'`, where: `every plugin supplies ${hookName}(args, callback) — arity 2` });
			}
			if (declaredTrue) {
				return refuse.byName({ moduleName, what: `evidenceHooksDeclared.${contractEntry.declaredBy} is true but hook '${hookName}' is absent`, where: 'declare it false or supply the hook (BR-016)' });
			}
			continue;
		}
		if (!contractEntry.required && !declaredTrue) {
			return refuse.byName({ moduleName, what: `hook '${hookName}' is present but evidenceHooksDeclared.${contractEntry.declaredBy} is not true`, where: 'an undeclared hook is refused (BR-016); declare it true' });
		}
		if (typeof hook !== 'function') {
			return refuse.byName({ moduleName, what: `hook '${hookName}' is a ${typeof hook}, not a function`, where: `${hookName}(args, callback)` });
		}
		if (hook.length !== contractEntry.arity) {
			return refuse.byName({ moduleName, what: `hook '${hookName}' has arity ${hook.length}; the contract declares ${contractEntry.arity} (one named-argument object plus the callback)`, where: 'a positional signature looks exactly like this' });
		}
	}
	return null;
};

// ---------------------------------------------------------------------
// forbiddenSubstrateReason({ pluginFilePath }) → '' | reason — a static scan of the plugin's SOURCE TEXT
// ---------------------------------------------------------------------
const forbiddenSubstrateReason = ({ pluginFilePath }) => {
	if (!isNonEmptyString(pluginFilePath) || !fs.existsSync(pluginFilePath)) {
		return `pluginFilePath ${JSON.stringify(pluginFilePath)} is not on disk`;
	}
	const sourceText = fs.readFileSync(pluginFilePath, 'utf8');
	const requireHit = FORBIDDEN_REQUIRE_LIST.find((oneToken) => new RegExp(`require\\([^)]*${oneToken.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(sourceText));
	if (requireHit !== undefined) {
		return `plugin ${path.basename(pluginFilePath)} requires forbidden substrate '${requireHit}' (BR-111; SPEC §4.2)`;
	}
	const functionHit = FORBIDDEN_FUNCTION_NAME_LIST.find((oneName) => new RegExp(`(function\\s+${oneName}\\b|\\b${oneName}\\s*[:=]\\s*(\\(|function|async)|\\b${oneName}\\s*\\([^)]*\\)\\s*\\{)`).test(sourceText));
	if (functionHit !== undefined) {
		return `plugin ${path.basename(pluginFilePath)} defines forbidden function '${functionHit}' (SPEC §4.2)`;
	}
	const tokenHit = FORBIDDEN_SOURCE_TOKEN_LIST.find((oneToken) => sourceText.indexOf(oneToken) !== -1);
	if (tokenHit !== undefined) {
		return `plugin ${path.basename(pluginFilePath)} source carries forbidden token '${tokenHit.trim()}' (BG-CONTAIN)`;
	}
	return '';
};

// declarationDigest — sha256 over the CANONICAL declaration (sorted keys) — a changed label table or column
// map is a different generation (SPEC §7.1)
const canonicalJsonText = (value) => {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJsonText).join(',')}]`;
	}
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((oneName) => `${JSON.stringify(oneName)}:${canonicalJsonText(value[oneName])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
};

module.exports = {
	BRIDGE_DECLARATION_CONTRACT,
	BRIDGE_HOOK_CONTRACT,
	HOOK_NAME_LIST,
	KIND_CHECKER_REGISTRY,
	MATCH_BASIS_LIST,
	PRODUCER_KIND_LIST,
	PRODUCER_KIND_BY_MATCH_BASIS,
	WALK_CHANNEL_SOURCE_KIND_BY_MATCH_BASIS,
	PREDICATE_SOURCE_KIND_VALIDATOR_REGISTRY,
	RESOLUTION_LIST,
	PREDICATE_SOURCE_KIND_LIST,
	PREDICATE_ASSERTED_BY_LIST,
	PREDICATE_ASSERTED_BY_BY_SOURCE_KIND,
	LABEL_DISPOSITION_LIST,
	TUPLE_FIELD_LIST,
	TUPLE_LIST_FIELD_LIST,
	SOURCE_KIND_LIST,
	CHANNEL_TIER_LIST,
	CHANNEL_DISPOSITION_LIST,
	COLUMN_CLASSIFICATION_LIST_NAME_LIST,
	SUBJECT_IDENTITY_KIND_LIST,
	EVIDENCE_HOOK_NAME_LIST,
	RUN_CONFIG_KEY_LIST,
	RUN_REPORT_RESULT_KEYS,
	WALK_ASSERTION_FORBIDDEN_KEY_LIST,
	WALK_ASSERTION_KEY_LIST,
	CHANNEL_REPORT_KEY_LIST,
	FORBIDDEN_REQUIRE_LIST,
	FORBIDDEN_FUNCTION_NAME_LIST,
	FORBIDDEN_SOURCE_TOKEN_LIST,
	validateBridgeDeclaration,
	validateBridgeHooks,
	forbiddenSubstrateReason,
	resolveChannels,
	parseCsvHeaderLine,
	decodeBytes,
	canonicalJsonText,
	isPlainObject,
	moduleName,
};
