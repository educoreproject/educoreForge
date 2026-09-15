'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridge-framework.js — THE Bridge Framework: the factory + the object (SPEC-bridgeFramework-v1.md §3), the
// pipeline run(spec, callback) (§5), and the re-exports the surface names (§3.3).
//
//   const bridgeFramework = require('<lib>/bridge-framework/bridge-framework')({ graphReaderFactory, graphWriterFactory,
//                                                                                pluginRegistry, xLog?, conflictDetector? });
//   bridgeFramework.run(spec, callback)      // EXACTLY as build.js Phase C calls bridgeMaker.run
//   bridgeFramework.describeBridge({ bridgeName, source }) -> { description } | { error }   // SYNCHRONOUS
//       READS a registered plugin's declaration WITHOUT running it: { bridgeName, source, producerKind,
//       subjectDiscriminator }. It exists so build.js can refuse a recipe whose bridges would compose ONE
//       relationship subject BEFORE PHASE A (RULING FJ-P7-1), so the collision costs neither a forge nor a
//       judge — rather than learning it from manifestEditor.add after the colliding bridge's whole run.
//       `source` is REQUIRED because lookupPlugin refuses a bridge
//       whose registered standardKey differs from the pairing's source (BR-009). subjectDiscriminator is
//       JS `undefined` when the plugin declares none, NEVER null — the caller compares it as a tuple term
//       and "declared nothing" must not equal "declared null". Touches no graph, spends nothing.
//
// ONE shared library so each of the Bridge Profile's choices is made once and observed red once. It holds NO
// per-run state: every index, census counter and decision list lives inside one run invocation. deps (§3.2):
// the reader/writer FACTORIES (the seam face passes the two bolt files; a suite passes graphDouble's), the
// discovery-built plugin REGISTRY (a suite passes a fixture registry), xLog (explicit wins, else
// process.global.xLog, else REFUSED — never a do-nothing logger), and the seam face's conflictDetector (the
// store-side sibling lookup, RULING 12:05 #1; a suite passes the same module with a fixture registry).
// judgeBudgetOverride is TEST-ONLY (proves the budget halt red; shippedConfig false — a sibling gate greps it
// absent from the seam face). Any other dep name is refused by name.
//
// The pipeline is orchestration-side end to end: taskListPlus + pipeRunner, callback error-first, every
// refusal a NAMED string; refuse.byName RETURNS an Error and each module stringifies at its callback boundary
// (RULING BF12); no async/await; no try/catch as control flow (the THREE sanctioned throw-to-value adapters:
// decisionBlock.js — canonicalText's throw and JSON.parse; bridgePluginContract.js — TextDecoder's fatal decode).
// A cheap refusal precedes a costly step.

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const sourceVerificationLib = require(path.join(__dirname, '..', 'forge-framework', 'sourceVerification'));
const contentAddress = require(path.join(__dirname, '..', 'content-address', 'content-address'))();
const BRIDGE_MAKER_LIB_DIR = path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');
const sourceWindowLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'sourceWindow'));
const debugJudgeLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'debugJudge'));

const bridgePluginContractLib = require('./bridgePluginContract');
const bridgeAllowanceRegistryLib = require('./bridgeAllowanceRegistry');
const pluginRegistryLib = require('./pluginRegistry');
const transformRegistryLib = require('./transformRegistry');
const predicateSourceLib = require('./predicateSource');
const classificationLib = require('./classification');
const subjectGroupingLib = require('./subjectGrouping');
const censusLib = require('./census');
const judgeComponentLib = require('./judgeComponent');
const evidenceRendererLib = require('./evidenceRenderer');
const representationPolicyLib = require('./representationPolicy');
const confidenceBandTableLib = require('./confidenceBandTable');
const decisionBlockLib = require('./decisionBlock');
const candidateRetrievalLib = require('./candidateRetrieval');
const neighbourVoteLib = require('./neighbourVote');
const materialiserLib = require('./materialiser');
const sssomExporterLib = require('./sssomExporter');
const boundedRunnerLib = require('./boundedRunner');
const conflictDetectorLib = require('./conflictDetector');
const graphSeamRulesLib = require('./graphSeamRules');

const { RELATIONSHIP_PRODUCER_SUFFIX, SKOS_EDGE_TYPES, MAPPING_PROPERTIES, DME_ROLES, HUB_DECOMPOSITION_SLOTS, SSSOM_JUSTIFICATIONS, hubEdgeType } = vocabularyLib;
const {
	MATCH_BASIS_LIST,
	PRODUCER_KIND_LIST,
	RESOLUTION_LIST,
	PREDICATE_SOURCE_KIND_LIST,
	PREDICATE_ASSERTED_BY_LIST,
	LABEL_DISPOSITION_LIST,
	RUN_CONFIG_KEY_LIST,
	RUN_REPORT_RESULT_KEYS,
	WALK_ASSERTION_KEY_LIST,
	WALK_ASSERTION_FORBIDDEN_KEY_LIST,
	CHANNEL_REPORT_KEY_LIST,
	TUPLE_FIELD_LIST,
} = bridgePluginContractLib;

const DEP_NAME_LIST = Object.freeze(['graphReaderFactory', 'graphWriterFactory', 'pluginRegistry', 'xLog', 'conflictDetector', 'judgeBudgetOverride']);
const SEAM_SPEC_KEY_LIST = Object.freeze(['inGraph', 'bridge', 'source', 'hub', 'applyLabel', 'rebridge', 'decisionStore', 'judgmentCache', 'matchForensics', 'inferenceConfig', 'config']);
const PROPERTY_TIER = 'property';
// the justification a RETRIEVED mapping carries (RULING §11.7 (b), adopted into vocabulary.SSSOM_JUSTIFICATIONS
// as a recorded specification change). Named here rather than inlined so the exporter and the edge builder
// cannot drift apart.
const SEMANTIC_SIMILARITY_JUSTIFICATION = 'semapv:SemanticSimilarityThresholdMatching';
// ⟪JOB 4, 2026-09-07⟫ the ceiling is DERIVED from its one home rather than restated. It used to be a
// literal here and a second literal in debugJudge.js; where you can derive, you do not assert.
const { JUDGE_CONCURRENCY } = require('./judgeConcurrency');
const MAX_JUDGMENT_COUNT_PER_RUN = 20000; // the DECLARED per-run ceiling (BR-069, BR-120); the budget guard halts by name
const MODE_MATERIALISE = 'materialise';
const MODE_REJUDGE = 'rejudge';
const RUN_KIND_NONE = 'none';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonBlank = (value) => typeof value === 'string' && value.trim() !== '';
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const canonicalJson = bridgePluginContractLib.canonicalJsonText;
const locatorTextFor = (oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? String(oneAssertion.sourceLocator.rowNumber).padStart(9, '0') : oneAssertion.sourceLocator.stableId}`;

// producer suffix sanity (BG-PRODUCER d): every PRODUCER_KIND_LIST entry has a NON-EMPTY suffix — asserted at
// framework construction, because build.js guards on the suffix's TRUTHINESS
const producerSuffixRefusal = () => {
	const bad = PRODUCER_KIND_LIST.find((oneKind) => typeof RELATIONSHIP_PRODUCER_SUFFIX[oneKind] !== 'string' || RELATIONSHIP_PRODUCER_SUFFIX[oneKind].length === 0);
	return bad === undefined ? null : refuse.byName({ moduleName, what: `PRODUCER_KIND '${bad}' has no NON-EMPTY suffix in vocabulary.RELATIONSHIP_PRODUCER_SUFFIX (got ${JSON.stringify(RELATIONSHIP_PRODUCER_SUFFIX[bad])})`, where: 'build.js guards on the suffix\'s truthiness; an empty suffix would silently fall through to the decisionBlock-inference branch (RULING BF18, REVIEW A1)' });
};

// =========================================================================================================
// CANDIDATE RETRIEVAL METHODS (SPEC-bridgeRevision-091426 §4-§7; §13 R-BR-7, R-BR-9, R-BR-14, R-BR-15, R-BR-16).
// The retrieved basis looks the DECLARED candidateRetrieval.method up in CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY
// and never compares a method name, so a new method is a row plus its gate, never a branch. Every row carries
// exactly RETRIEVAL_METHOD_ROW_MEMBER_LIST (asserted at construction by retrievalRegistryRefusal):
//   headerFieldNameList                                  the declared fields the block header freezes, in the ruled
//                                                        order (R-BR-7)
//   settingsPairListFor(retrievalDeclaration)            → [[label, value], …] what the retrieval log lines print
//   prepareRetrieval(retrievalContext, callback)         every read and index the method needs, ONCE per run →
//                                                        callback(errorText, retrievalState); retrievalState always
//                                                        carries hubVectorIndex
//   mappingJustificationFor({ retrievalState })          the SSSOM justification a judged record carries
//   poolForSubject({ retrievalState, retrievalDeclaration, subjectStableId, hubName })
//                                                        → { seatStableIdList, recordTraceByFieldName } | { error }:
//                                                        one subject's seats in RANK order, and the trace fields its
//                                                        frozen record carries
//   retrievalContext = { retrievalView, evidenceView, retrievalDeclaration, hubName, sourceStandardName, subjectLabel,
//                        subjectNodeList, windowedNodeList }
// =========================================================================================================
const RETRIEVAL_METHOD_ROW_MEMBER_LIST = Object.freeze(['headerFieldNameList', 'settingsPairListFor', 'prepareRetrieval', 'mappingJustificationFor', 'poolForSubject']);
// the justification a retrieved mapping carries when neighbour votes helped order its pool: several signals were
// composed (SPEC-bridgeRevision §7, R-SN-4). Checked against vocabulary.SSSOM_JUSTIFICATIONS at construction.
const COMPOSITE_MATCHING_JUSTIFICATION = 'semapv:CompositeMatching';
const hasOwn = (container, propertyName) => Object.prototype.hasOwnProperty.call(container, propertyName);
// isPlainRecord — a JSON-shaped object. Stricter than isPlainObject on purpose: decisionBlock.canonicalText reads
// Object.keys, so a Map would freeze SILENTLY as {}; a value headed for the frozen text is refused unless it is this.
const isPlainRecord = (candidate) => isPlainObject(candidate) && (Object.getPrototypeOf(candidate) === Object.prototype || Object.getPrototypeOf(candidate) === null);
const fieldNameTextOf = (candidate) => Object.keys(candidate).sort(compareStrings).join(', ');

// the logical slot kinds of the pure modules, each resolved to the hub's slot edge type through hubEdgeType (R-BR-9):
// the ONE table both the card slot index and the frozen path entry read, so a slot cannot be named two ways
const HUB_SLOT_BY_SLOT_KIND = Object.freeze({ property: 'PROPERTY', domain: 'DOMAIN', range: 'RANGE' });
// the base node kinds by role constant. The same three roles bound the hub text search population (R-BR-9).
const BASE_ROLE_BY_BASE_KIND = Object.freeze({ class: DME_ROLES.CLASS, property: DME_ROLES.PROPERTY, optionSet: DME_ROLES.OPTION_SET });

// readHubVectorIndex — the card vectors, flattened ONCE per run under the DECLARED model. Every method needs it:
// cosineTopK-v1 retrieves against it; embedTextVote-v1 orders the admitted cards by it (cardTextCosine, R-BR-14).
const readHubVectorIndex = ({ retrievalView, retrievalDeclaration }, callback) => {
	retrievalView.readHubVectors({ referenceTier: PROPERTY_TIER }, (hubVectorError, hubVectorRecordList) => {
		if (hubVectorError) {
			callback(`${moduleName}: readHubVectors: ${hubVectorError}`);
			return;
		}
		const built = candidateRetrievalLib.buildHubVectorIndex({ vectorRecordList: hubVectorRecordList, embeddingModelVersion: retrievalDeclaration.embeddingModelVersion });
		if (built.error) {
			callback(built.error.message);
			return;
		}
		callback('', built.hubVectorIndex);
	});
};

// readEmbedTextRecordList — one standard's text records exactly as the reader returns them (R-BR-15: never reshaped).
// A read that matches nothing is refused naming the standardName it was given (R-BR-B4c), never searched empty.
const readEmbedTextRecordList = ({ retrievalView, standardName, standardRoleText }, callback) => {
	retrievalView.readEmbedTextVectors({ standardName }, (readError, textRecordList) => {
		if (readError) {
			callback(`${moduleName}: readEmbedTextVectors (${standardRoleText} '${standardName}'): ${readError}`);
			return;
		}
		if (textRecordList.length === 0) {
			callback(refuse.byName({ moduleName, what: `readEmbedTextVectors({ standardName: '${standardName}' }) matched no text node (the ${standardRoleText})`, where: 'embedTextVote-v1 searches the hub texts with the source texts; a standard with none cannot take part (R-BR-1, R-BR-B4c)' }).message);
			return;
		}
		callback('', textRecordList);
	});
};

// REFERENCE_EDGE_READ_BY_KIND — which among-source edges name a subject's referenced objects, one row per
// neighbourVote.js REFERENCED_OBJECT_KIND_REGISTRY kind (equality asserted at construction). 'none' reads nothing:
// an UNTYPED readEdgesAmongSource returns every edge, so an empty type list is never sent.
const REFERENCE_EDGE_READ_BY_KIND = Object.freeze({
	edgeTarget: ({ referencedObjectDeclaration, evidenceView }, callback) => evidenceView.readEdgesAmongSource({ edgeTypeList: referencedObjectDeclaration.edgeTypeList.slice() }, callback),
	none: (unusedReadArguments, callback) => callback('', []),
});

// FROZEN NEIGHBOUR TRACE (SPEC-bridgeRevision §7, R-BR-16): rankCandidatePool's neighbourTrace, projected by its exact
// field set. The per-neighbour named-class map must be a plain record of class stableId lists (see isPlainRecord).
const NEIGHBOUR_TRACE_FIELD_NAME_LIST = Object.freeze(['namedClassStableIdListByNeighbourStableId', 'ownerStableId', 'referencedObjectCount', 'siblingCount', 'topDomainClassList', 'topRangeClassList']);
const TRACE_CLASS_SHARE_FIELD_NAME_LIST = Object.freeze(['classStableId', 'share']);
const frozenNeighbourTraceFor = (neighbourTrace) => {
	const refuseTrace = (what) => ({ error: refuse.byName({ moduleName, what: `neighbourTrace ${what}`, where: 'the frozen neighbourTrace is rankCandidatePool\'s, projected by name (SPEC-bridgeRevision §7, R-BR-16); a new field is a projection row, never an omission' }) });
	if (!isPlainRecord(neighbourTrace)) {
		return refuseTrace(`is ${neighbourTrace === null ? 'null' : `a ${typeof neighbourTrace}`}, not a plain record`);
	}
	if (fieldNameTextOf(neighbourTrace) !== NEIGHBOUR_TRACE_FIELD_NAME_LIST.join(', ')) {
		return refuseTrace(`carries { ${fieldNameTextOf(neighbourTrace)} }, not { ${NEIGHBOUR_TRACE_FIELD_NAME_LIST.join(', ')} }`);
	}
	const namedClassMap = neighbourTrace.namedClassStableIdListByNeighbourStableId;
	if (!isPlainRecord(namedClassMap)) {
		return refuseTrace('namedClassStableIdListByNeighbourStableId is not a plain record (a Map would freeze as {})');
	}
	const malformedNeighbourStableId = Object.keys(namedClassMap).find((oneNeighbourStableId) => !Array.isArray(namedClassMap[oneNeighbourStableId]) || !namedClassMap[oneNeighbourStableId].every(isNonBlank));
	if (malformedNeighbourStableId !== undefined) {
		return refuseTrace(`namedClassStableIdListByNeighbourStableId['${malformedNeighbourStableId}'] is not a list of class stableIds`);
	}
	const malformedClassListName = ['topDomainClassList', 'topRangeClassList'].find((oneListName) => !Array.isArray(neighbourTrace[oneListName]) || neighbourTrace[oneListName].some((oneEntry) => !isPlainRecord(oneEntry) || fieldNameTextOf(oneEntry) !== TRACE_CLASS_SHARE_FIELD_NAME_LIST.join(', ')));
	if (malformedClassListName !== undefined) {
		return refuseTrace(`${malformedClassListName} is not a list of { ${TRACE_CLASS_SHARE_FIELD_NAME_LIST.join(', ')} }`);
	}
	const classShareListOf = (classShareList) => classShareList.map((oneEntry) => ({ classStableId: oneEntry.classStableId, share: oneEntry.share }));
	return {
		neighbourTrace: {
			ownerStableId: neighbourTrace.ownerStableId,
			siblingCount: neighbourTrace.siblingCount,
			referencedObjectCount: neighbourTrace.referencedObjectCount,
			topDomainClassList: classShareListOf(neighbourTrace.topDomainClassList),
			topRangeClassList: classShareListOf(neighbourTrace.topRangeClassList),
			namedClassStableIdListByNeighbourStableId: Object.keys(namedClassMap)
				.sort(compareStrings)
				.reduce((soFar, oneNeighbourStableId) => Object.assign(soFar, { [oneNeighbourStableId]: namedClassMap[oneNeighbourStableId].slice() }), {}),
		},
	};
};

// NEIGHBOUR SCORING — what a declared neighbourVote needs from the run and what its record carries. A null
// neighbourVote is the DECLARED votes-only rank (SPEC-bridgeRevision §5) and is named here as a row, so no use site
// tests it again.
const VOTES_ONLY_SCORING_ROW_NAME = 'votesOnly';
const neighbourScoringRowNameOf = (neighbourVote) => (neighbourVote === null ? VOTES_ONLY_SCORING_ROW_NAME : neighbourVote.method);
const NEIGHBOUR_SCORING_REGISTRY = Object.freeze({
	[VOTES_ONLY_SCORING_ROW_NAME]: Object.freeze({
		mappingJustification: SEMANTIC_SIMILARITY_JUSTIFICATION,
		readReferenceEdgeList: (unusedReadArguments, callback) => callback('', []),
		frozenTraceFor: (neighbourTrace) => (neighbourTrace === null ? { neighbourTrace: null } : { error: refuse.byName({ moduleName, what: 'a votes-only rank returned a neighbourTrace', where: 'neighbourVote: null ranks by votes alone and names no neighbour (SPEC-bridgeRevision §5, invariant 7)' }) }),
	}),
	'neighbourVote-v1': Object.freeze({
		mappingJustification: COMPOSITE_MATCHING_JUSTIFICATION,
		readReferenceEdgeList: ({ neighbourVote, evidenceView }, callback) => REFERENCE_EDGE_READ_BY_KIND[neighbourVote.referencedObject.kind]({ referencedObjectDeclaration: neighbourVote.referencedObject, evidenceView }, callback),
		frozenTraceFor: frozenNeighbourTraceFor,
	}),
});
const neighbourScoringRowFor = (neighbourVote) => {
	const scoringRowName = neighbourScoringRowNameOf(neighbourVote);
	return hasOwn(NEIGHBOUR_SCORING_REGISTRY, scoringRowName)
		? { scoringRow: NEIGHBOUR_SCORING_REGISTRY[scoringRowName] }
		: { error: refuse.byName({ moduleName, what: `candidateRetrieval.neighbourVote names method ${JSON.stringify(scoringRowName)}, which has no NEIGHBOUR_SCORING_REGISTRY row`, where: 'a neighbour scoring method is a row in bridge-framework.js plus its gate (SPEC-bridgeRevision §5)' }) };
};

// FROZEN VOTE ENTRIES (B1 stand-down item 1; R-BR-14). The ranked entries come in two shapes, named here by their exact
// field sets and projected explicitly; a third shape is refused by name. Each path entry's LOGICAL slotKind is frozen
// as the graph's edgeType through hubEdgeType, and its propertyNameList is kept.
const RANKED_ENTRY_SHAPE_REGISTRY = Object.freeze({
	votesOnly: Object.freeze({ fieldNameList: Object.freeze(['bestCosine', 'cardTextCosine', 'cardTextWinningTextStableId', 'ownVotes', 'pathList', 'stableId']) }),
	neighbourVote: Object.freeze({ fieldNameList: Object.freeze(['bestCosine', 'cardTextCosine', 'cardTextWinningTextStableId', 'domainShare', 'domainVote', 'ownVotes', 'pathList', 'rangeShare', 'rangeVote', 'score', 'stableId']) }),
});
const RANKED_PATH_FIELD_NAME_LIST = Object.freeze(['baseKind', 'baseStableId', 'cosine', 'embedTextStableId', 'hitTextStableId', 'propertyNameList', 'slotKind']);
const frozenRetrievalVoteListFor = ({ rankedList, hubName }) => {
	const retrievalVoteList = [];
	for (let rankIndex = 0; rankIndex < rankedList.length; rankIndex++) {
		const oneEntry = rankedList[rankIndex];
		const entryFieldText = isPlainObject(oneEntry) ? fieldNameTextOf(oneEntry) : String(oneEntry);
		const shapeName = Object.keys(RANKED_ENTRY_SHAPE_REGISTRY).find((oneShapeName) => RANKED_ENTRY_SHAPE_REGISTRY[oneShapeName].fieldNameList.join(', ') === entryFieldText);
		if (shapeName === undefined) {
			return { error: refuse.byName({ moduleName, what: `ranked entry ${rankIndex} carries { ${entryFieldText} }, which is none of the ranked entry shapes (${Object.keys(RANKED_ENTRY_SHAPE_REGISTRY).join(', ')})`, where: 'the frozen retrievalVoteList projects each known shape by name; a new field is a registry row, never an omission' }) };
		}
		const frozenPathList = [];
		for (let pathIndex = 0; pathIndex < oneEntry.pathList.length; pathIndex++) {
			const onePath = oneEntry.pathList[pathIndex];
			if (!isPlainObject(onePath) || fieldNameTextOf(onePath) !== RANKED_PATH_FIELD_NAME_LIST.join(', ')) {
				return { error: refuse.byName({ moduleName, what: `card ${oneEntry.stableId} path ${pathIndex} carries { ${isPlainObject(onePath) ? fieldNameTextOf(onePath) : String(onePath)} }, not { ${RANKED_PATH_FIELD_NAME_LIST.join(', ')} }`, where: 'the frozen path entry is projected by name' }) };
			}
			if (!hasOwn(HUB_SLOT_BY_SLOT_KIND, onePath.slotKind)) {
				return { error: refuse.byName({ moduleName, what: `card ${oneEntry.stableId} path ${pathIndex} names slot kind ${JSON.stringify(onePath.slotKind)}, none of ${Object.keys(HUB_SLOT_BY_SLOT_KIND).join(', ')}`, where: 'a path is frozen with its graph edge type, hubEdgeType(hubName, slot) (R-BR-9)' }) };
			}
			frozenPathList.push({ embedTextStableId: onePath.embedTextStableId, propertyNameList: onePath.propertyNameList.slice(), hitTextStableId: onePath.hitTextStableId, baseStableId: onePath.baseStableId, baseKind: onePath.baseKind, edgeType: hubEdgeType(hubName, HUB_SLOT_BY_SLOT_KIND[onePath.slotKind]), cosine: onePath.cosine });
		}
		const frozenEntry = RANKED_ENTRY_SHAPE_REGISTRY[shapeName].fieldNameList.filter((oneFieldName) => oneFieldName !== 'pathList').reduce((soFar, oneFieldName) => Object.assign(soFar, { [oneFieldName]: oneEntry[oneFieldName] }), {});
		retrievalVoteList.push({ ...frozenEntry, pathList: frozenPathList });
	}
	return { retrievalVoteList };
};

const CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY = Object.freeze({
	// cosineTopK-v1 — the subject's own vector against every card, top K at or above the floor. Byte-unchanged in
	// behaviour from before the registry existed: the same two reads in the same order, the same pool, the same trace.
	'cosineTopK-v1': Object.freeze({
		headerFieldNameList: Object.freeze(['method', 'k', 'floor', 'embeddingModelVersion']),
		settingsPairListFor: (retrievalDeclaration) => [['K', retrievalDeclaration.k], ['floor', retrievalDeclaration.floor]],
		prepareRetrieval: (retrievalContext, callback) => {
			readHubVectorIndex(retrievalContext, (indexError, hubVectorIndex) => {
				if (indexError) {
					callback(indexError);
					return;
				}
				retrievalContext.retrievalView.readSubjectVectors({ label: retrievalContext.subjectLabel }, (subjectVectorError, subjectVectorRecordList) => {
					if (subjectVectorError) {
						callback(`${moduleName}: readSubjectVectors: ${subjectVectorError}`);
						return;
					}
					const subjectVectorByStableId = subjectVectorRecordList.reduce((soFar, oneRecord) => ({ ...soFar, [oneRecord.stableId]: oneRecord }), {});
					const vectorlessSubject = retrievalContext.windowedNodeList.find((oneNode) => subjectVectorByStableId[oneNode.stableId] === undefined);
					if (vectorlessSubject !== undefined) {
						callback(refuse.byName({ moduleName, what: `subject ${vectorlessSubject.stableId} carries no embedding`, where: 'a vectorless subject cannot be retrieved for; the framework never re-embeds (BR-123)' }).message);
						return;
					}
					callback('', { hubVectorIndex, subjectVectorByStableId });
				});
			});
		},
		mappingJustificationFor: () => SEMANTIC_SIMILARITY_JUSTIFICATION,
		poolForSubject: ({ retrievalState, retrievalDeclaration, subjectStableId }) => {
			const { k, floor } = retrievalDeclaration;
			const retrieved = candidateRetrievalLib.retrieveCandidatePool({ hubVectorIndex: retrievalState.hubVectorIndex, subjectStableId, subjectVector: retrievalState.subjectVectorByStableId[subjectStableId].embedding, k, floor });
			if (retrieved.error) {
				return { error: retrieved.error };
			}
			// the retrieval trace: rank and cosine per seat, in RANK order. Forensics inside the frozen text — it is what
			// makes recall@K measurable from the block alone, with no judge and no re-run.
			return { seatStableIdList: retrieved.seatList.map((oneSeat) => oneSeat.stableId), recordTraceByFieldName: { retrievalSeatList: retrieved.seatList.map((oneSeat) => ({ stableId: oneSeat.stableId, rank: oneSeat.rank, cosine: oneSeat.cosine })) } };
		},
	}),
	// embedTextVote-v1 — the subject's TEXT NODES search the hub's text nodes; a hit walks to cards through the slot
	// edges; a card is admitted only through a property-slot vote; the admitted cards take cardTextCosine (the subject's
	// own texts against the whole-card vector) and are ranked with or without neighbour votes (SPEC-embedTextSearch §4,
	// SPEC-bridgeRevision §4, R-BR-14). Reader records reach every pure module UNMODIFIED (R-BR-15).
	'embedTextVote-v1': Object.freeze({
		headerFieldNameList: Object.freeze(['method', 'hitsPerText', 'minScore', 'k', 'embeddingModelVersion', 'neighbourVote']),
		settingsPairListFor: (retrievalDeclaration) => [['hitsPerText', retrievalDeclaration.hitsPerText], ['minScore', retrievalDeclaration.minScore], ['K', retrievalDeclaration.k], ['neighbourVote', neighbourScoringRowNameOf(retrievalDeclaration.neighbourVote)]],
		prepareRetrieval: (retrievalContext, callback) => {
			const { retrievalView, evidenceView, retrievalDeclaration, hubName, sourceStandardName } = retrievalContext;
			const scoringLookup = neighbourScoringRowFor(retrievalDeclaration.neighbourVote);
			if (scoringLookup.error) {
				callback(scoringLookup.error.message);
				return;
			}
			const taskList = new taskListPlus();
			taskList.push((args, next) => readHubVectorIndex(retrievalContext, (indexError, hubVectorIndex) => (indexError ? next(indexError) : next('', { ...args, hubVectorIndex }))));
			// the SOURCE standard's texts, filed under the node each describes: a subject's own records, and every neighbour's
			taskList.push((args, next) => {
				readEmbedTextRecordList({ retrievalView, standardName: sourceStandardName, standardRoleText: 'source standard' }, (readError, sourceTextRecordList) => {
					if (readError) {
						next(readError);
						return;
					}
					const textRecordListBySourceStableId = new Map();
					sourceTextRecordList.forEach((oneRecord) => {
						if (!textRecordListBySourceStableId.has(oneRecord.sourceStableId)) {
							textRecordListBySourceStableId.set(oneRecord.sourceStableId, []);
						}
						textRecordListBySourceStableId.get(oneRecord.sourceStableId).push(oneRecord);
					});
					next('', { ...args, textRecordListBySourceStableId });
				});
			});
			// the HUB's texts that describe a class, a property or an option set (R-BR-9): indexed and memoised ONCE, so each
			// distinct text node is searched at most once per run (invariant 6). The memo is owned here.
			taskList.push((args, next) => {
				readEmbedTextRecordList({ retrievalView, standardName: hubName, standardRoleText: 'hub' }, (readError, hubTextRecordList) => {
					if (readError) {
						next(readError);
						return;
					}
					const searchedRoleList = Object.keys(BASE_ROLE_BY_BASE_KIND).map((oneBaseKind) => BASE_ROLE_BY_BASE_KIND[oneBaseKind]);
					const searchPopulationRecordList = hubTextRecordList.filter((oneRecord) => searchedRoleList.indexOf(oneRecord.sourceRole) !== -1);
					if (searchPopulationRecordList.length === 0) {
						next(refuse.byName({ moduleName, what: `readEmbedTextVectors({ standardName: '${hubName}' }) returned ${hubTextRecordList.length} text record(s) and none describes a node whose role is ${searchedRoleList.join(', ')}`, where: 'the search population is the hub texts of classes, properties and option sets (R-BR-9, R-BR-B4c)' }).message);
						return;
					}
					const indexed = candidateRetrievalLib.buildEmbedTextIndex({ textRecordList: searchPopulationRecordList, embeddingModelVersion: retrievalDeclaration.embeddingModelVersion });
					if (indexed.error) {
						next(indexed.error.message);
						return;
					}
					const memoMade = candidateRetrievalLib.makeSearchMemo({ embedTextIndex: indexed.embedTextIndex, hitsPerText: retrievalDeclaration.hitsPerText, minScore: retrievalDeclaration.minScore });
					if (memoMade.error) {
						next(memoMade.error.message);
						return;
					}
					next('', { ...args, searchMemo: memoMade.searchMemo });
				});
			});
			// the card slot edges: each read edge type is the module's slot name, and each slot resolves through hubEdgeType
			taskList.push((args, next) => {
				retrievalView.readCardBaseEdges({ referenceTier: PROPERTY_TIER }, (readError, cardBaseEdgeList) => {
					if (readError) {
						next(`${moduleName}: readCardBaseEdges: ${readError}`);
						return;
					}
					const slotNameBySlotKind = Object.keys(HUB_SLOT_BY_SLOT_KIND).reduce((soFar, oneSlotKind) => Object.assign(soFar, { [oneSlotKind]: hubEdgeType(hubName, HUB_SLOT_BY_SLOT_KIND[oneSlotKind]) }), {});
					const cardSlotEdgeList = cardBaseEdgeList.map((oneEdge) => ({ cardStableId: oneEdge.cardStableId, slot: oneEdge.edgeType, baseStableId: oneEdge.baseStableId, baseRole: oneEdge.baseRole }));
					const slotted = candidateRetrievalLib.buildCardSlotIndex({ cardSlotEdgeList, slotNameBySlotKind, baseRoleByBaseKind: { ...BASE_ROLE_BY_BASE_KIND } });
					if (slotted.error) {
						next(slotted.error.message);
						return;
					}
					next('', { ...args, cardSlotIndex: slotted.cardSlotIndex });
				});
			});
			// the neighbours' structure: the declared reference edges, and the subject-label nodes of the FULL source
			// population with every source stableId beside them — never the run window (invariant 5, B1 stand-down)
			taskList.push((args, next) => {
				scoringLookup.scoringRow.readReferenceEdgeList({ neighbourVote: retrievalDeclaration.neighbourVote, evidenceView }, (readError, referenceEdgeList) => {
					if (readError) {
						next(`${moduleName}: reference edges: ${readError}`);
						return;
					}
					const siblingPopulationByStableId = {};
					retrievalContext.subjectNodeList.filter((oneNode) => oneNode.labels.indexOf(retrievalContext.subjectLabel) !== -1).forEach((oneNode) => {
						siblingPopulationByStableId[oneNode.stableId] = oneNode;
					});
					const sourceStableIdSet = new Set(retrievalContext.subjectNodeList.map((oneNode) => oneNode.stableId));
					next('', { ...args, neighbourInputBase: { siblingPopulationByStableId, sourceStableIdSet, referenceEdgeList, textRecordListBySourceStableId: args.textRecordListBySourceStableId } });
				});
			});
			pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
				if (pipelineError) {
					callback(pipelineError);
					return;
				}
				callback('', { hubVectorIndex: args.hubVectorIndex, searchMemo: args.searchMemo, cardSlotIndex: args.cardSlotIndex, textRecordListBySourceStableId: args.textRecordListBySourceStableId, neighbourInputBase: args.neighbourInputBase, scoringRow: scoringLookup.scoringRow });
			});
		},
		mappingJustificationFor: ({ retrievalState }) => retrievalState.scoringRow.mappingJustification,
		poolForSubject: ({ retrievalState, retrievalDeclaration, subjectStableId, hubName }) => {
			const { searchMemo, cardSlotIndex, hubVectorIndex, textRecordListBySourceStableId, neighbourInputBase, scoringRow } = retrievalState;
			// the subject's OWN text records; a subject the forge gave no text node has none, and votes with an empty list
			const subjectTextRecordList = textRecordListBySourceStableId.has(subjectStableId) ? textRecordListBySourceStableId.get(subjectStableId) : [];
			// ORDER (brief §1.3, binding wiring rule 2): vote, then cardTextCosine over the subject's OWN text records, then rank
			const voted = candidateRetrievalLib.voteCandidatePool({ searchMemo, cardSlotIndex, subjectStableId, subjectTextRecordList });
			if (voted.error) {
				return { error: voted.error };
			}
			// NO POOL (binding wiring rule 1, PRISM_COMPASS 14:52Z). A subject whose texts admitted no card has no seats and is
			// an orphan (noCandidate) in the shared tail. It is routed there BEFORE cardTextCosineFor, which refuses an empty
			// text list by name, so one textless subject never refuses the run. A subject with no text records votes with an
			// empty list and so lands here too (voteCandidatePool admits nothing without a text). No rank ran, so no trace.
			if (voted.admittedList.length === 0) {
				return { seatStableIdList: [], recordTraceByFieldName: { retrievalVoteList: [], neighbourTrace: null } };
			}
			const ordered = candidateRetrievalLib.cardTextCosineFor({ admittedList: voted.admittedList, subjectTextRecordList, hubVectorIndex });
			if (ordered.error) {
				return { error: ordered.error };
			}
			const ranked = neighbourVoteLib.rankCandidatePool({ admittedList: ordered.admittedList, neighbourVote: retrievalDeclaration.neighbourVote, neighbourInput: { subjectStableId, ...neighbourInputBase }, searchMemo, cardSlotIndex, k: retrievalDeclaration.k });
			if (ranked.error) {
				return { error: ranked.error };
			}
			const frozenVotes = frozenRetrievalVoteListFor({ rankedList: ranked.rankedList, hubName });
			if (frozenVotes.error) {
				return { error: frozenVotes.error };
			}
			const frozenTrace = scoringRow.frozenTraceFor(ranked.neighbourTrace);
			if (frozenTrace.error) {
				return { error: frozenTrace.error };
			}
			return { seatStableIdList: ranked.rankedList.map((oneEntry) => oneEntry.stableId), recordTraceByFieldName: { retrievalVoteList: frozenVotes.retrievalVoteList, neighbourTrace: frozenTrace.neighbourTrace } };
		},
	}),
});

const retrievalMethodRowFor = (retrievalDeclaration) =>
	hasOwn(CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY, retrievalDeclaration.method)
		? { methodRow: CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY[retrievalDeclaration.method] }
		: { error: refuse.byName({ moduleName, what: `candidateRetrieval.method ${JSON.stringify(retrievalDeclaration.method)} has no CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY row (rows: ${Object.keys(CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY).join(', ')})`, where: 'the contract admits a method only with its fields; the orchestrator runs it only with its row' }) };

// candidateRetrievalHeaderValueFor — the header's candidateRetrieval value (R-BR-7): the DECLARED object, canonicalised
// by its method row's field list; a basis that declares no retrieval freezes null. The contract already refuses an
// unknown or absent field; the field SET is compared again here so the row and the contract cannot drift apart silently.
const candidateRetrievalHeaderValueFor = (retrievalDeclaration) => {
	if (retrievalDeclaration === undefined) {
		return { headerValue: null };
	}
	const methodLookup = retrievalMethodRowFor(retrievalDeclaration);
	if (methodLookup.error) {
		return { error: methodLookup.error };
	}
	const rowFieldNameText = methodLookup.methodRow.headerFieldNameList.slice().sort(compareStrings).join(', ');
	if (fieldNameTextOf(retrievalDeclaration) !== rowFieldNameText) {
		return { error: refuse.byName({ moduleName, what: `candidateRetrieval (method ${retrievalDeclaration.method}) declares { ${fieldNameTextOf(retrievalDeclaration)} } but its header row freezes { ${rowFieldNameText} }`, where: 'CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY headerFieldNameList and the contract\'s method field list must name the same fields (R-BR-7)' }) };
	}
	return { headerValue: methodLookup.methodRow.headerFieldNameList.reduce((soFar, oneFieldName) => Object.assign(soFar, { [oneFieldName]: JSON.parse(canonicalJson(retrievalDeclaration[oneFieldName])) }), {}) };
};

// retrievalRegistryRefusal — the retrieval registries checked ONCE at framework construction, beside
// producerSuffixRefusal: a malformed row is a framework defect, refused before any run can reach it
const retrievalRegistryRefusal = () => {
	const refuseRegistry = (what, where) => refuse.byName({ moduleName, what, where });
	const memberListText = RETRIEVAL_METHOD_ROW_MEMBER_LIST.slice().sort(compareStrings).join(', ');
	const malformedMethodName = Object.keys(CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY).find((oneMethodName) => fieldNameTextOf(CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY[oneMethodName]) !== memberListText);
	if (malformedMethodName !== undefined) {
		return refuseRegistry(`CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY['${malformedMethodName}'] carries { ${fieldNameTextOf(CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY[malformedMethodName])} }`, `every method row carries exactly { ${memberListText} }`);
	}
	const undeclaredSlot = Object.keys(HUB_SLOT_BY_SLOT_KIND).map((oneSlotKind) => HUB_SLOT_BY_SLOT_KIND[oneSlotKind]).find((oneSlot) => HUB_DECOMPOSITION_SLOTS.indexOf(oneSlot) === -1);
	if (undeclaredSlot !== undefined) {
		return refuseRegistry(`HUB_SLOT_BY_SLOT_KIND names slot '${undeclaredSlot}', which is not in vocabulary.HUB_DECOMPOSITION_SLOTS (${HUB_DECOMPOSITION_SLOTS.join(', ')})`, 'slot edge types are hubEdgeType(hubName, slot) over declared slots (R-BR-9)');
	}
	const unnamedBaseKind = Object.keys(BASE_ROLE_BY_BASE_KIND).find((oneBaseKind) => !isNonBlank(BASE_ROLE_BY_BASE_KIND[oneBaseKind]));
	if (unnamedBaseKind !== undefined) {
		return refuseRegistry(`BASE_ROLE_BY_BASE_KIND['${unnamedBaseKind}'] names no role`, 'the base roles are vocabulary.DME_ROLES constants');
	}
	const unknownJustification = [SEMANTIC_SIMILARITY_JUSTIFICATION, COMPOSITE_MATCHING_JUSTIFICATION].find((oneJustification) => SSSOM_JUSTIFICATIONS.indexOf(oneJustification) === -1);
	if (unknownJustification !== undefined) {
		return refuseRegistry(`justification '${unknownJustification}' is not in vocabulary.SSSOM_JUSTIFICATIONS`, 'a record carries only a vocabulary justification');
	}
	const readKindText = Object.keys(REFERENCE_EDGE_READ_BY_KIND).sort(compareStrings).join(', ');
	const moduleKindText = Object.keys(neighbourVoteLib.REFERENCED_OBJECT_KIND_REGISTRY).sort(compareStrings).join(', ');
	if (readKindText !== moduleKindText) {
		return refuseRegistry(`REFERENCE_EDGE_READ_BY_KIND covers { ${readKindText} } but neighbourVote.js REFERENCED_OBJECT_KIND_REGISTRY declares { ${moduleKindText} }`, 'every referenced-object kind the scoring module admits needs its edge read here');
	}
	return null;
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(deps = {}) => {
		if (!isPlainObject(deps)) {
			throw refuse.byName({ moduleName, what: `deps is ${deps === null ? 'null' : `a ${typeof deps}`}`, where: 'call the factory with { graphReaderFactory, graphWriterFactory, pluginRegistry, xLog?, conflictDetector? }' });
		}
		const unknownDepName = Object.keys(deps).find((oneName) => DEP_NAME_LIST.indexOf(oneName) === -1);
		if (unknownDepName !== undefined) {
			throw refuse.byName({ moduleName, what: `unknown dep '${unknownDepName}'`, where: `the factory accepts ${DEP_NAME_LIST.join(', ')}; a driver, a config, a store or a bolt URL is never a framework dep (SPEC §3.2)` });
		}
		if (typeof deps.graphReaderFactory !== 'function') {
			throw refuse.byName({ moduleName, what: 'graphReaderFactory is absent', where: 'the ONLY way any framework module reads the dependency graph (SPEC §3.2)' });
		}
		if (typeof deps.graphWriterFactory !== 'function') {
			throw refuse.byName({ moduleName, what: 'graphWriterFactory is absent', where: 'the ONLY door an edge goes through (SPEC §6)' });
		}
		if (!isPlainObject(deps.pluginRegistry) || !isPlainObject(deps.pluginRegistry.entryByBridgeName)) {
			throw refuse.byName({ moduleName, what: 'pluginRegistry is absent or not { entryByBridgeName }', where: 'the seam face builds it by discovery (pluginRegistry.buildRegistryFromDirectory); a suite passes a fixture registry' });
		}
		const xLog = deps.xLog !== undefined ? deps.xLog : process.global && process.global.xLog;
		if (!xLog || typeof xLog.status !== 'function' || typeof xLog.error !== 'function') {
			throw refuse.byName({ moduleName, what: 'xLog is available neither as a dep nor as process.global.xLog', where: 'pass { xLog } or bootstrap process.global; no do-nothing logger is manufactured' });
		}
		const conflictDetector = deps.conflictDetector === undefined ? conflictDetectorLib.detectSiblingConflicts : deps.conflictDetector;
		if (typeof conflictDetector !== 'function') {
			throw refuse.byName({ moduleName, what: 'conflictDetector is not a function', where: 'the seam face hosts the store-side sibling lookup (conflictDetector.detectSiblingConflicts)' });
		}
		let maxJudgmentCount = MAX_JUDGMENT_COUNT_PER_RUN;
		if (deps.judgeBudgetOverride !== undefined) {
			if (!Number.isInteger(deps.judgeBudgetOverride) || deps.judgeBudgetOverride < 1) {
				throw refuse.byName({ moduleName, what: 'judgeBudgetOverride must be a positive integer', where: 'TEST-ONLY dep; a suite lowers the ceiling to observe the budget halt red' });
			}
			maxJudgmentCount = deps.judgeBudgetOverride;
		}
		const suffixRefusal = producerSuffixRefusal();
		if (suffixRefusal) {
			throw suffixRefusal;
		}
		const retrievalRefusal = retrievalRegistryRefusal();
		if (retrievalRefusal) {
			throw retrievalRefusal;
		}
		const registry = deps.pluginRegistry;
		const { graphReaderFactory, graphWriterFactory } = deps;

		// -----------------------------------------------------------------
		// helpers over the declaration (pure)
		// -----------------------------------------------------------------
		const labelTableOf = (bridgeDeclaration) => predicateSourceLib.PREDICATE_SOURCE_KIND_REGISTRY[bridgeDeclaration.predicateSource.kind].provenanceOf(bridgeDeclaration.predicateSource);
		const walkChannelPropertyList = (bridgeDeclaration) => Array.from(new Set(bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.sourceKind === 'forgedGraph').reduce((soFar, oneChannel) => soFar.concat(oneChannel.channelPropertyList), []))).sort();
		// A match FIELD is the field the two sides were matched ON. A derived mapping was matched on no field at
		// all — it was matched on MEANING — so subject_match_field is NULL and is OMITTED from the export
		// entirely (RULING §11.7 (d); Profile §4.5 never defines the slot for derived). object_match_field is
		// still emitted because the exporter derives object_source from its CURIE prefix, and it names the
		// mechanism honestly rather than borrowing a key that was never consulted.
		const SEMANTIC_MATCH_FIELD_NAME = 'semanticSimilarity';
		const subjectMatchFieldFor = (bridgeDeclaration) => {
			if (bridgeDeclaration.tupleFieldColumnMap === undefined) {
				return null;
			}
			const prefix = bridgeDeclaration.sourceCuriePrefix.prefix;
			return TUPLE_FIELD_LIST.filter((oneField) => bridgeDeclaration.tupleFieldColumnMap[oneField] !== undefined)
				.map((oneField) => `${prefix}:${bridgeDeclaration.tupleFieldColumnMap[oneField].column}`)
				.join('|');
		};
		const OBJECT_MATCH_FIELD_HUB_PREFIX = 'EDUcoreHub'; // the hub's CURIE prefix for object_match_field (Profile §4.5); the hub NAME rides in object_source
		const objectMatchFieldFor = (bridgeDeclaration) => (bridgeDeclaration.tupleFieldColumnMap === undefined ? `${OBJECT_MATCH_FIELD_HUB_PREFIX}:${SEMANTIC_MATCH_FIELD_NAME}` : TUPLE_FIELD_LIST.filter((oneField) => bridgeDeclaration.tupleFieldColumnMap[oneField] !== undefined).map((oneField) => `${OBJECT_MATCH_FIELD_HUB_PREFIX}:${oneField}`).join('|'));
		const isSentinelRawValue = ({ channel, rawValue }) => channel.absentTargetSentinelList.indexOf(rawValue === undefined || rawValue === null ? '' : String(rawValue)) !== -1;

		// -----------------------------------------------------------------
		// run — the seam (§5): ONE taskListPlus, ONE pipeRunner, callback error-first
		// -----------------------------------------------------------------
		const run = (spec, callback) => {
			if (typeof callback !== 'function') {
				throw refuse.byName({ moduleName, what: 'run: callback is not a function', where: 'run(spec, callback) is arity 2' });
			}
			const refuseRun = (what, where) => callback(refuse.byName({ moduleName, what, where }).message);
			if (!isPlainObject(spec)) {
				refuseRun(`run: spec is ${spec === null ? 'null' : `a ${typeof spec}`}`, 'run({ inGraph, bridge, source, hub, applyLabel, rebridge, decisionStore, judgmentCache, matchForensics, inferenceConfig, config }, callback)');
				return;
			}
			const { inGraph, bridge, applyLabel } = spec;
			// the stub's own three, kept verbatim (SPEC §5.0)
			if (!inGraph) {
				callback(`${moduleName}: inGraph is not given. It is the materialized dependency GraphHandle the bridge writes into; there is no default.`);
				return;
			}
			if (typeof bridge !== 'string' || bridge.trim() === '') {
				callback(`${moduleName}: bridge is ${bridge === undefined ? 'not named' : JSON.stringify(bridge)}. It is the name that resolves the bridge implementation; there is no default.`);
				return;
			}
			if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
				callback(`${moduleName}: applyLabel is ${applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)}. It is the label harvest selects the written edges by; there is no default.`);
				return;
			}
			const unknownSpecKey = Object.keys(spec).find((oneName) => SEAM_SPEC_KEY_LIST.indexOf(oneName) === -1);
			if (unknownSpecKey !== undefined) {
				refuseRun(`run: spec carries unknown key '${unknownSpecKey}'`, `build.js Phase C passes exactly ${SEAM_SPEC_KEY_LIST.join(', ')}`);
				return;
			}
			// an unregistered bridge is refused FIRST, listing the registered names (SPEC §5.0, BG-REG b)
			if (registry.entryByBridgeName[bridge] === undefined) {
				const looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: bridge, standardKey: spec.source });
				callback(`${moduleName}: ${looked.error.message}`);
				return;
			}
			if (!isNonBlank(spec.source)) {
				refuseRun('run: spec.source is absent', 'the recipe pairing\'s source token selects the plugin standardKey');
				return;
			}
			const looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: bridge, standardKey: spec.source });
			if (looked.error) {
				callback(`${moduleName}: ${looked.error.message}`);
				return;
			}
			const pluginEntry = looked.entry;
			const bridgeDeclaration = pluginEntry.bridgeDeclaration;
			const bridgeHooks = pluginEntry.bridgeHooks;
			if (!isNonBlank(spec.hub)) {
				refuseRun('run: spec.hub is absent', 'a mapping plugin without a hub is a category error (BR-017 mirror); the recipe pairing names its hub');
				return;
			}
			if (!isPlainObject(spec.config)) {
				refuseRun('run: spec.config is absent', 'build.js composes config { limit, offset, sourceStandard, sourceStandardName, sourceVersion, hubVersion, pairWith, pairWithVersion, familyStandards }');
				return;
			}
			const unknownConfigKey = Object.keys(spec.config).find((oneName) => RUN_CONFIG_KEY_LIST.indexOf(oneName) === -1);
			if (unknownConfigKey !== undefined) {
				refuseRun(`run: spec.config carries key '${unknownConfigKey}', outside RUN_CONFIG_KEY_LIST (${RUN_CONFIG_KEY_LIST.join(', ')})`, 'the recipe\'s bridges[].params channel is CLOSED — nothing a recipe param says reaches the framework (RULING BF11, A6)');
				return;
			}
			const { sourceStandardName, sourceVersion, hubVersion } = spec.config;
			const missingVersion = [
				['sourceStandardName', sourceStandardName],
				['sourceVersion', sourceVersion],
				['hubVersion', hubVersion],
			].find(([, oneValue]) => !isNonBlank(oneValue === undefined || oneValue === null ? '' : String(oneValue)));
			if (missingVersion !== undefined) {
				refuseRun(`run: config.${missingVersion[0]} is absent or blank`, 'a block that cannot name both versions has no address (BR-056, Profile §4.7) — refused here, before the spend');
				return;
			}
			if (typeof spec.rebridge !== 'boolean') {
				refuseRun(`run: rebridge is ${JSON.stringify(spec.rebridge)}, not a boolean`, 'build.js passes rebridge true iff the pair is in the --rebridge scope; "I did not say" is not a mode');
				return;
			}
			if (!spec.decisionStore || typeof spec.decisionStore.getDecisionBlock !== 'function' || typeof spec.decisionStore.saveDecisionBlock !== 'function') {
				refuseRun('run: decisionStore is absent', 'the framework opens NO store of its own; build.js hands the decision store in (BR-021 converse)');
				return;
			}
			if (spec.rebridge && (!spec.judgmentCache || typeof spec.judgmentCache.getJudgment !== 'function')) {
				refuseRun('run: judgmentCache is absent on a re-judge', 'rebridge: true needs decisionStore, judgmentCache and matchForensics (SPEC §3.2)');
				return;
			}
			if (spec.rebridge && (!spec.matchForensics || typeof spec.matchForensics.appendRecord !== 'function')) {
				refuseRun('run: matchForensics is absent on a re-judge', 'rebridge: true needs decisionStore, judgmentCache and matchForensics (SPEC §3.2)');
				return;
			}
			if (spec.rebridge && !isPlainObject(spec.inferenceConfig)) {
				refuseRun('run: inferenceConfig is absent on a re-judge', 'build.js resolveInferenceConfig hands { llmClient } (the real client or the debug judge)');
				return;
			}
			const limitResolution = sourceWindowLib.parsePositiveInteger({ value: spec.config.limit, name: 'limit', minimum: 1 });
			if (limitResolution.error) {
				callback(`${moduleName}: ${limitResolution.error}`);
				return;
			}
			const offsetResolution = sourceWindowLib.parsePositiveInteger({ value: spec.config.offset, name: 'offset', minimum: 0 });
			if (offsetResolution.error) {
				callback(`${moduleName}: ${offsetResolution.error}`);
				return;
			}
			if (bridgeDeclaration.standardKey !== spec.source) {
				refuseRun(`run: plugin '${bridge}' declares standardKey '${bridgeDeclaration.standardKey}' but spec.source is '${spec.source}'`, 'BR-009');
				return;
			}

			// identity of this run
			const sourceToken = spec.source;
			const hubToken = spec.hub;
			const pairScopedLabel = `${applyLabel}_${sourceToken.toUpperCase()}_${hubToken.toUpperCase()}`;
			const pairKeyPrefix = `${hubToken}@${hubVersion}::${sourceToken}@${sourceVersion}`;
			const pairKey = `${pairKeyPrefix}::${bridgeDeclaration.bridgeName}::${bridgeDeclaration.producerKind}`;
			const mode = spec.rebridge ? MODE_REJUDGE : MODE_MATERIALISE;
			const judgeClient = spec.rebridge && spec.inferenceConfig && spec.inferenceConfig.llmClient ? spec.inferenceConfig.llmClient : null;
			const debugMark = spec.rebridge ? debugJudgeLib.debugMarkFromLlmClient({ inferenceConfig: spec.inferenceConfig }) : undefined;
			// ⟪2026-09-10⟫ ONE DOOR: sourceSelectionMarkFor answers for whichever selector was asked for — the
			// debug window or the named subject set — and refuses the combination inside the pure module. The
			// generation, the judgment-cache key and the frozen block's sourceWindow header all take this one value,
			// so a third selector added later cannot be wired into one of them and forgotten in another.
			const windowMark = sourceWindowLib.sourceSelectionMarkFor({ limit: spec.config.limit, offset: spec.config.offset, subjectStableIdList: spec.config.subjectStableIdList });
			const declarationDigest = sha256Hex(pluginEntry.declarationCanonicalText);
			const labelTableDigest = sha256Hex(canonicalJson(labelTableOf(bridgeDeclaration)));
			const subjectMatchField = subjectMatchFieldFor(bridgeDeclaration);
			const objectMatchField = objectMatchFieldFor(bridgeDeclaration);
			// THE ACQUISITION ROW — resolved ONCE per run and consulted everywhere below. Nothing in this file
			// tests the basis NAME; every behaviour that differs between a documentary basis and a retrieved one
			// reads a member of this row (RULING §11.9/§11.11, approved SABLE_RIVER 2026-08-17; BG-NOSUB (h)
			// proves the orchestrator carries no basis-name comparison).
			const acquisitionRow = bridgePluginContractLib.SOURCE_ACQUISITION_REGISTRY[bridgeDeclaration.matchBasis];
			if (acquisitionRow === undefined) {
				callback(refuse.byName({ moduleName, what: `matchBasis '${bridgeDeclaration.matchBasis}' names no SOURCE_ACQUISITION_REGISTRY row`, where: 'the row declares how a basis acquires subjects and pools; a basis without one cannot be run' }).message);
				return;
			}
			const judgePromptVariant = acquisitionRow.judgePromptVariant;
			const runRendererVersion = evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[judgePromptVariant].rendererVersion;
			// WHICH subject-node properties become rendered material is a member of the VARIANT row, not a constant
			// in this file: the crosswalk variant names its seven by name (byte-frozen), the derived variant takes
			// the plugin's declared renderingAllowList.subject. A constant here would silently overrule a declared
			// allow-list, which is the bias audit failing in the quiet direction (RULING §11.1/§11.4).
			const subjectMaterialNameList = evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[judgePromptVariant].subjectMaterialNameListFor({ bridgeDeclaration });
			const baseGeneration = `${decisionBlockLib.FRAMEWORK_GENERATION}:${bridgeDeclaration.bridgeName}@${bridgeDeclaration.pluginVersion}:${runRendererVersion}`;
			const generation = debugJudgeLib.generationWithDebugMark(sourceWindowLib.generationWithWindowMark(baseGeneration, windowMark), debugMark);
			const runPrefix = `[bridge ${bridgeDeclaration.bridgeName} ${sourceToken}→${hubToken}]`;
			const report = { refusalList: [], conflictCount: 0, conflictList: [], judgeSpend: { asked: 0, servedFromCache: 0, abstained: 0, rationaleReaskCount: 0, usd: null }, blindingDeclarationEcho: bridgeDeclaration.blindingDeclaration.slice(), consistencyReport: [], subjectNodeReport: null, labelTableDigest, discardedPredicateKeyCount: 0, note: '' };
			const say = (text) => xLog.status(`${runPrefix} ${text}`);
			say(`mode ${mode}; pairKey ${pairKey}; pair-scoped label ${pairScopedLabel}; blindingDeclaration [${bridgeDeclaration.blindingDeclaration.join(', ')}]`);

			// PICK_PREDICATE_RESOLVER_BY_SOURCE_KIND — one row per predicateSource kind (RULING §11.7 (a)). The
			// three documentary kinds share the source-row resolver they have always used; 'judge' reads the
			// declared table. Adding a future predicate source is a row here, not an edit inside STEP 7.
			const sourceRowPickPredicate = ({ judged, oneTask, orderedAssertionList }) => {
				const pickedCard = oneTask.pool.find((oneCard) => oneCard.stableId === judged.chosenCardStableId);
				const namingAssertion = orderedAssertionList.find((oneAssertion) => oneAssertion.targetKeyList.indexOf(pickedCard.canonicalKey) !== -1 || Object.keys(oneTask.baseRecord.suppliedTupleByTarget).some((oneRawKey) => oneTask.baseRecord.suppliedTupleByTarget[oneRawKey].canonicalKey === pickedCard.canonicalKey && oneAssertion.targetKeyList.indexOf(oneRawKey) !== -1)) || oneTask.groupAssertionList[0];
				const labelRow = namingAssertion.labelRow;
				return { predicate: labelRow.disposition === 'tentative' ? labelRow.predicateIfPicked : labelRow.predicate, predicateAssertedBy: labelRow.predicateAssertedBy, sourceLabel: labelRow.sourceLabel };
			};
			const PICK_PREDICATE_RESOLVER_BY_SOURCE_KIND = Object.freeze({
				column: sourceRowPickPredicate,
				labelTable: sourceRowPickPredicate,
				channelAssertion: sourceRowPickPredicate,
				judge: ({ judged }) => {
					const predicate = bridgeDeclaration.predicateByCategory[judged.category];
					if (predicate === undefined) {
						return { error: refuse.byName({ moduleName, what: `the judge returned category '${judged.category}' and predicateByCategory names no predicate for it`, where: 'the declaration validator refuses a table that does not cover every judge category, so reaching this names a framework defect, not a declaration one' }) };
					}
					return { predicate, predicateAssertedBy: bridgePluginContractLib.PREDICATE_ASSERTED_BY_BY_SOURCE_KIND.judge, sourceLabel: null };
				},
			});

			const undiscriminatedRunReportFor = ({ decisionBlockHash, blocksDecisionBlock, edgesWritten, counts, sssomExportPath, note }) => ({
				inGraph,
				bridge,
				applyLabel,
				producer: bridgeDeclaration.producerKind, // ALWAYS explicit (RULING A1)
				decisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },
				blocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: bridgeDeclaration.producerKind, decisionBlock: blocksDecisionBlock }],
				edgesWritten,
				counts,
				generation,
				rendererVersion: runRendererVersion,
				mode,
				sssomExportPath,
				note,
			});

			// THE OPT-IN SUBJECT DISCRIMINATOR (Phase 7), ATTACHED IN A SEPARATE STATEMENT ON PURPOSE.
			// The object literal above is the verbatim `find` text of three BG-PRODUCER mutation twins and,
			// on its `producer:` line alone, of BG-REG (f)'s. moduleDouble.assertMutationApplies is EAGER and
			// THROWS when its find-text no longer matches, so a key added inside that literal would not make
			// those twins fail loudly — it would make them fail to construct, and a twin that cannot run is a
			// gate that has stopped watching. Hence: compose the literal untouched, then add the key here.
			//
			// UNDECLARED IS JS `undefined`, NEVER `null`, and the key is not added at all — the report a
			// plugin without a discriminator produces is the object it produced before this phase, key for
			// key. `subjectDiscriminator` is deliberately NOT added to RUN_REPORT_RESULT_KEYS: BG-NOSUB (i)
			// pins `COMPONENT_SHAPES.bridgeMaker.run.resultKeys.length === 13`, and BG-REG (f) checks
			// CONTAINMENT of that list rather than exact key-set equality (measured, Phase 7 entry), so an
			// extra key on the runtime report is admitted while the declared list stays at 13.
			const runReportFor = (oneReportArgumentSet) => {
				const undiscriminatedRunReport = undiscriminatedRunReportFor(oneReportArgumentSet);
				// ⟪JOB 5b⟫ ADDED HERE AND NOT IN THE LITERAL ABOVE, for the reason the note above states:
				// that literal is the verbatim find-text of three BG-PRODUCER twins and BG-REG (f), and
				// moduleDouble.assertMutationApplies is EAGER — a key added inside it would not make those
				// twins fail loudly, it would make them fail to CONSTRUCT, which is a gate that has quietly
				// stopped watching. ON EACH BLOCK ENTRY TOO, because build.js harvests PER EMITTED BLOCK and
				// reads the expectation there. The declared RUN_REPORT_RESULT_KEYS list stays at 13 and
				// BG-REG (f) checks CONTAINMENT, so a runtime key is admitted.
				const conservationBearingRunReport = {
					...undiscriminatedRunReport,
					loadedConservationSummary: oneReportArgumentSet.loadedConservationSummary,
					blocks: undiscriminatedRunReport.blocks.map((oneBlock) => ({ ...oneBlock, loadedConservationSummary: oneReportArgumentSet.loadedConservationSummary })),
				};
				if (bridgeDeclaration.subjectDiscriminator === undefined) {
					return conservationBearingRunReport;
				}
				return {
					...conservationBearingRunReport,
					subjectDiscriminator: bridgeDeclaration.subjectDiscriminator,
					// ON EACH BLOCK ENTRY TOO, because build.js composes a subject PER EMITTED BLOCK and reads
					// `oneBlock.subjectDiscriminator` there. Measured at Phase 7 entry: no suite anywhere pins the
					// key SET of a blocks[] entry, so a key added here turns nothing red for the wrong reason.
					blocks: conservationBearingRunReport.blocks.map((oneBlock) => ({ ...oneBlock, subjectDiscriminator: bridgeDeclaration.subjectDiscriminator })),
				};
			};

			// -----------------------------------------------------------------
			// channel digests + verification (shared by both modes): every document channel verified against
			// SHA256SUMS before a byte is read; digest = sha256 of the verified bytes; a forgedGraph channel is
			// digested later from the subject nodes' channel properties
			// -----------------------------------------------------------------
			const verifyDocumentChannels = (verifyCallback) => {
				const channelList = bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.sourceKind === 'document');
				const sourceChannelDigestByKey = {};
				const sourceChannelPathByKey = {};
				let channelIndex = 0;
				const nextChannel = () => {
					if (channelIndex >= channelList.length) {
						verifyCallback('', { sourceChannelDigestByKey, sourceChannelPathByKey });
						return;
					}
					const oneChannel = channelList[channelIndex];
					channelIndex += 1;
					const resolution = pluginEntry.channelResolutionByKey[oneChannel.channelKey];
					sourceVerificationLib.verifySnapshotChecksums({ snapshotDirPath: resolution.snapshotDirPath, relativePathList: [resolution.relativePathFromSnapshotDir] }, (verifyError) => {
						if (verifyError) {
							verifyCallback(`${moduleName}: channel '${oneChannel.channelKey}': ${verifyError}`);
							return;
						}
						const bytes = fs.readFileSync(resolution.filePath);
						const decoded = bridgePluginContractLib.decodeBytes({ bytes, encoding: oneChannel.encoding, channelKey: oneChannel.channelKey });
						if (decoded.error) {
							verifyCallback(refuse.byName({ moduleName, what: decoded.error, where: 'a declared encoding the bytes fail to decode is refused (BG-INPUT f)' }).message);
							return;
						}
						sourceChannelDigestByKey[oneChannel.channelKey] = crypto.createHash('sha256').update(bytes).digest('hex');
						sourceChannelPathByKey[oneChannel.channelKey] = resolution.filePath;
						nextChannel();
					});
				};
				nextChannel();
			};

			// =================================================================
			// MATERIALISE (rebridge: false)
			// =================================================================
			const materialiseMode = () => {
				spec.decisionStore.getDecisionBlock({ pairKey }, (getError, stored) => {
					if (getError) {
						callback(`${moduleName}: decisionStore.getDecisionBlock: ${getError}`);
						return;
					}
					if (!stored || stored.frozenText === null || stored.frozenText === undefined) {
						const note = `no frozen decision block for ${pairKey}; zero edges; nothing judged`;
						say(note);
						callback('', runReportFor({ decisionBlockHash: null, blocksDecisionBlock: null, edgesWritten: 0, counts: null, sssomExportPath: null, note }));
						return;
					}
					const parsed = decisionBlockLib.parseFrozenText(stored.frozenText);
					if (parsed.error) {
						callback(`${moduleName}: ${parsed.error.message}`);
						return;
					}
					const block = parsed.block;
					const recomputedId = decisionBlockLib.blockIdFor({ frozenText: stored.frozenText });
					if (recomputedId !== stored.decisionBlockHash) {
						refuseRun(`the stored block for ${pairKey} hashes to ${recomputedId}, not its address ${stored.decisionBlockHash}`, 'content-address verification on read');
						return;
					}
					const taskList = new taskListPlus();
					taskList.push((args, next) => {
						verifyDocumentChannels((verifyError, verified) => (verifyError ? next(verifyError) : next('', { ...args, ...verified })));
					});
					taskList.push((args, next) => {
						// RE-VERIFY the block against the run: a drifted document, a re-versioned endpoint or a changed
						// declaration is refused by name ("re-judge required"), never replayed onto the wrong graph
						const driftList = [];
						Object.keys(args.sourceChannelDigestByKey).forEach((oneKey) => {
							if (block.header.sourceChannelDigestByKey[oneKey] !== args.sourceChannelDigestByKey[oneKey]) {
								driftList.push(`sourceChannelDigestByKey.${oneKey}`);
							}
						});
						if (block.header.hubVersion !== String(hubVersion)) {
							driftList.push(`hubVersion (block ${block.header.hubVersion}, run ${hubVersion})`);
						}
						if (block.header.sourceVersion !== String(sourceVersion)) {
							driftList.push(`sourceVersion (block ${block.header.sourceVersion}, run ${sourceVersion})`);
						}
						if (block.header.declarationDigest !== declarationDigest) {
							driftList.push('declarationDigest');
						}
						if (driftList.length) {
							next(refuse.byName({ moduleName, what: `the frozen block for ${pairKey} does not match this run: ${driftList.join('; ')}`, where: 're-judge required (--rebridge); a block is never replayed onto a drifted source, endpoint or declaration (BG-REPLAY f)' }).message);
							return;
						}
						next('', args);
					});
					taskList.push((args, next) => materialiseAndReport({ block, decisionBlockHash: stored.decisionBlockHash, exportSssom: false }, next));
					pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
						if (pipelineError) {
							callback(pipelineError);
							return;
						}
						callback('', args.runReport);
					});
				});
			};

			// -----------------------------------------------------------------
			// materialiseAndReport — shared tail: conflict lookup → writer → export? → runReport
			// -----------------------------------------------------------------
			const materialiseAndReport = ({ block, decisionBlockHash, exportSssom, cardByStableId }, tailCallback) => {
				const blockDebugMark = debugJudgeLib.debugMarkFromGeneration(block.header.generation);
				const siblingPairKeyList = conflictDetectorLib.siblingPairKeyListFor({ registry, thisBridgeName: bridgeDeclaration.bridgeName, standardKey: bridgeDeclaration.standardKey, pairKeyPrefix, producerKind: bridgeDeclaration.producerKind });
				conflictDetector({ decisionStore: spec.decisionStore, siblingPairKeyList, thisBlock: block }, (conflictError, conflicts) => {
					if (conflictError) {
						tailCallback(conflictError);
						return;
					}
					const conflictedSubjectSet = new Set(conflicts.conflictList.map((oneConflict) => oneConflict.subjectStableId));
					report.conflictCount = conflicts.conflictList.length;
					report.conflictList = conflicts.conflictList;
					// BR7: the sibling list spans every (bridge × producerKind) key on the pairing, so it is never empty; "one plugin
					// on this pairing" means no OTHER registered bridgeName — the same bridge under another producerKind is still looked up
					const otherBridgeNameList = Array.from(new Set(siblingPairKeyList.map((oneSibling) => oneSibling.siblingBridgeName).filter((oneName) => oneName !== bridgeDeclaration.bridgeName))).sort();
					if (otherBridgeNameList.length === 0) {
						say(`0 conflicts (one plugin on this pairing — detector exercised by fixture only; ${siblingPairKeyList.length} sibling key(s) looked up under other producerKinds, ${conflicts.siblingBlockCount} found)`);
					} else {
						say(`${conflicts.conflictList.length} conflict(s) against ${conflicts.siblingBlockCount} sibling block(s) (${siblingPairKeyList.map((oneSibling) => `${oneSibling.siblingBridgeName}::${oneSibling.siblingProducerKind}`).join(', ')})`);
					}
					const materialisableBlock = { ...block, decisionRecordList: block.decisionRecordList.filter((oneRecord) => !conflictedSubjectSet.has(oneRecord.subjectStableId)) };
					const writerArgs = { inGraph, applyLabel: pairScopedLabel, sourceStandardName };
					const writerRefusal = graphSeamRulesLib.writerConstructionRefusal(writerArgs);
					if (writerRefusal) {
						tailCallback(writerRefusal.message);
						return;
					}
					const writer = graphWriterFactory(writerArgs);
					materialiserLib.materialiseBlock(
						{ block: materialisableBlock, decisionBlockHash, writer, sourceStandardName, sourceVersion: String(sourceVersion), hubName: block.header.hubName, hubVersion: String(hubVersion), mappingProviderUrl: bridgeDeclaration.mappingProvider === undefined ? null : bridgeDeclaration.mappingProvider.url, subjectMatchField, objectMatchField, debugMark: blockDebugMark, runWindowMark: windowMark },
						(materialiseError, materialised) => {
							// ⟪JOB 5b⟫ close's SECOND argument carries the bridge door's loaded conservation
							// summary — what this writer actually merged, accumulated as it went. It must be
							// read HERE: the depGraph is destroyed after harvest, so a set re-derived later
							// would measure the graph twice and the written set never.
							writer.close((closeError, closeReport) => {
								const loadedConservationSummary = closeReport === undefined || closeReport === null
									? undefined
									: closeReport.loadedConservationSummary;
								if (materialiseError) {
									tailCallback(materialiseError);
									return;
								}
								if (closeError) {
									tailCallback(closeError);
									return;
								}
								const conflictRecordWrite = (afterConflicts) => {
									if (!conflicts.conflictList.length || !spec.matchForensics || typeof spec.matchForensics.appendRecord !== 'function') {
										afterConflicts('');
										return;
									}
									spec.matchForensics.appendRecord({ pairKey, generation: block.header.generation, record: { kind: 'MappingReview', conflictList: conflicts.conflictList } }, afterConflicts);
								};
								conflictRecordWrite((reviewError) => {
									if (reviewError) {
										tailCallback(`${moduleName}: MappingReview trail: ${reviewError}`);
										return;
									}
									const finish = (sssomExportPath) => {
										const counts = { cardinalityCensus: block.header.cardinalityCensus, contentionCensus: block.header.contentionCensus, edgesWritten: materialised.edgesWritten, conflictCount: report.conflictCount, judgeSpend: report.judgeSpend, refusalCount: report.refusalList.length, discardedPredicateKeyCount: report.discardedPredicateKeyCount };
										say(`materialised ${materialised.edgesWritten} edge(s) under ${pairScopedLabel} from block ${decisionBlockHash.slice(0, 12)}… (${mode})`);
										const note = mode === MODE_MATERIALISE ? `replayed frozen block ${decisionBlockHash} for ${pairKey}` : `re-judged and froze block ${decisionBlockHash} for ${pairKey}`;
										tailCallback('', { runReport: runReportFor({ decisionBlockHash, blocksDecisionBlock: { decisionBlockHash, pairKey, generation: block.header.generation }, edgesWritten: materialised.edgesWritten, counts, sssomExportPath, note, loadedConservationSummary }), writtenEdgeList: materialised.writtenEdgeList, report });
									};
									if (!exportSssom) {
										finish(null);
										return;
									}
									const outputPath = path.join(spec.matchForensics.baseDirPath, pairKey, `${decisionBlockHash}.sssom.tsv`);
									// mappingProvider and mappingTool are mutually exclusive at set level, by producerKind: the
									// exporter refuses a provider on an inferred set and refuses a missing tool on one
									// (RULING §11.7 (c), amended 2026-08-17). Neither is defaulted — an undeclared key is
									// simply not put in the object.
									const setLevelSlots = {
										...(bridgeDeclaration.mappingProvider === undefined ? {} : { mappingProvider: bridgeDeclaration.mappingProvider }),
										...(bridgeDeclaration.mappingTool === undefined ? {} : { mappingTool: `${bridgeDeclaration.mappingTool.name} ${bridgeDeclaration.mappingTool.version}` }),
										subjectSource: sourceStandardName,
										subjectSourceVersion: String(sourceVersion),
										objectSource: block.header.hubName,
										objectSourceVersion: String(hubVersion),
										...(subjectMatchField === null ? {} : { subjectMatchField }),
										objectMatchField,
										subjectCuriePrefix: bridgeDeclaration.subjectCuriePrefix,
										[predicateSourceLib.PREDICATE_SOURCE_KIND_REGISTRY[bridgeDeclaration.predicateSource.kind].provenanceSlotName]: labelTableOf(bridgeDeclaration),
									};
									const curieMap = { [bridgeDeclaration.subjectCuriePrefix]: `urn:educore:${bridgeDeclaration.standardKey}:`, [bridgeDeclaration.sourceCuriePrefix.prefix]: bridgeDeclaration.sourceCuriePrefix.iri, [OBJECT_MATCH_FIELD_HUB_PREFIX]: `urn:educore:hub:${block.header.hubName}:` };
									sssomExporterLib.toSssomTsv({ decisionBlock: block, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath }, (exportError, exported) => {
										if (exportError) {
											tailCallback(exportError);
											return;
										}
										say(`SSSOM/TSV ${exported.rowCount} row(s) over ${exported.subjectCount} subject(s) → ${exported.outputPath}`);
										finish(exported.outputPath);
									});
								});
							});
						},
					);
				});
			};

			// =================================================================
			// RE-JUDGE (rebridge: true): §5.2–§5.6 → freeze → save → materialise → export → report
			// =================================================================
			const rejudgeMode = () => {
				const taskList = new taskListPlus();

				// STEP 1 — the reader (ONE flatten, two views); cards; subjects
				taskList.push((args, next) => {
					const readerArgs = { inGraph, dependencyStandardNameList: [sourceStandardName, hubToken], sourceStandardName, blindingDeclaration: bridgeDeclaration.blindingDeclaration };
					const readerRefusal = graphSeamRulesLib.readerConstructionRefusal(readerArgs);
					if (readerRefusal) {
						next(readerRefusal.message);
						return;
					}
					const reader = graphReaderFactory(readerArgs);
					say(`blinding declaration echoed by name before the first read: [${bridgeDeclaration.blindingDeclaration.join(', ')}]`);
					reader.readHubCards({ referenceTier: PROPERTY_TIER }, (cardError, cardList) => {
						if (cardError) {
							next(`${moduleName}: readHubCards: ${cardError}`);
							return;
						}
						if (cardList.length === 0) {
							next(refuse.byName({ moduleName, what: 'the hub double / graph carries ZERO property-tier cards', where: 'an empty pool is never a mapping run (BG-EMPTY)' }).message);
							return;
						}
						const hubNameSet = new Set(cardList.map((oneCard) => oneCard.hubName));
						if (hubNameSet.size !== 1) {
							next(refuse.byName({ moduleName, what: `the cards name ${hubNameSet.size} hubs (${Array.from(hubNameSet).join(', ')})`, where: 'a pairing has ONE hub' }).message);
							return;
						}
						const hubName = cardList[0].hubName;
						const hubVersionOnCards = new Set(cardList.map((oneCard) => String(oneCard.hubVersion)));
						if (hubVersionOnCards.size !== 1 || !hubVersionOnCards.has(String(hubVersion))) {
							next(refuse.byName({ moduleName, what: `the cards carry hubVersion ${Array.from(hubVersionOnCards).join(', ')} but config.hubVersion is ${hubVersion}`, where: 'a re-versioned endpoint is refused, never guessed' }).message);
							return;
						}
						const cardListByCanonicalKey = classificationLib.makeCardListByCanonicalKey({ cardList });
						const contention = censusLib.contentionCensus({ cardListByCanonicalKey, tier: PROPERTY_TIER });
						const cardByStableId = cardList.reduce((soFar, oneCard) => ({ ...soFar, [oneCard.stableId]: oneCard }), {});
						say(`cards: ${contention.cardCount} / distinct keys ${contention.distinctKeyCount} / contended ${contention.contendedKeyCount} / worst ${contention.worstContention} (measured this run)`);
						reader.readSubjectNodes((subjectError, subjectNodeList) => {
							if (subjectError) {
								next(`${moduleName}: readSubjectNodes: ${subjectError}`);
								return;
							}
							if (subjectNodeList.length === 0) {
								next(refuse.byName({ moduleName, what: `the source standard '${sourceStandardName}' has ZERO forged nodes in the dependency graph`, where: 'the source scope is EXACT (BR-023); nothing to map' }).message);
								return;
							}
							const subjectNodeByStableId = subjectNodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});
							next('', { ...args, reader, cardList, cardListByCanonicalKey, contention, cardByStableId, hubName, subjectNodeList, subjectNodeByStableId });
						});
					});
				});

				// STEP 2 — verify document channels; digest forgedGraph channels from the subject nodes
				taskList.push((args, next) => {
					verifyDocumentChannels((verifyError, verified) => {
						if (verifyError) {
							next(verifyError);
							return;
						}
						next('', { ...args, sourceChannelDigestByKey: { ...verified.sourceChannelDigestByKey }, sourceChannelPathByKey: verified.sourceChannelPathByKey });
					});
				});

				// STEP 2b — a forgedGraph channel is digested from its UNBLINDED channel values, read through forWalk
				// (the blinded readSubjectNodes view lacks them by design): channelKey + sha256 over the sorted rows
				taskList.push((args, next) => {
					const forgedChannelList = bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.sourceKind === 'forgedGraph');
					if (forgedChannelList.length === 0) {
						next('', args);
						return;
					}
					const walkView = args.reader.forWalk({ channelPropertyList: walkChannelPropertyList(bridgeDeclaration) });
					walkView.readSourceNodes({}, (readError, walkRecordList) => {
						if (readError) {
							next(`${moduleName}: forgedGraph digest read: ${readError}`);
							return;
						}
						const sourceChannelDigestByKey = { ...args.sourceChannelDigestByKey };
						forgedChannelList.forEach((oneChannel) => {
							const rowText = walkRecordList
								.slice()
								.sort((leftNode, rightNode) => compareStrings(leftNode.stableId, rightNode.stableId))
								.map((oneNode) => canonicalJson([oneNode.stableId].concat(oneChannel.channelPropertyList.map((oneName) => (oneNode.properties[oneName] === undefined ? null : oneNode.properties[oneName])))))
								.join('\n');
							sourceChannelDigestByKey[oneChannel.channelKey] = `forgedGraph:${sha256Hex(rowText)}`;
						});
						next('', { ...args, sourceChannelDigestByKey });
					});
				});

				// STEP 3 — the WALK (once per run) + assertion validation + channelReport reconciliation
				// A basis whose acquisition row names NO walkChannelSourceKind walks nothing: there is no document and
				// no forged-graph channel to read, so there are no assertions and the walk hook is FORBIDDEN for it
				// (RULING §11.9/§11.11). The step yields the empty walk explicitly rather than being deleted, so the
				// reconciliation members downstream exist and read honestly as zero instead of undefined.
				taskList.push((args, next) => {
					if (acquisitionRow.walkChannelSourceKind === null) {
						next('', { ...args, assertionList: [], channelReport: {}, refusedValueTierAssertionCount: 0 });
						return;
					}
					const walkView = args.reader.forWalk({ channelPropertyList: walkChannelPropertyList(bridgeDeclaration) });
					// the argument object handed to a hook is a CLOSED shape: a Proxy throws by name on any other read (BG-CONTAIN)
					const hookArgs = graphSeamRulesLib.closedHookArgs({ sourceChannelPathByKey: { ...args.sourceChannelPathByKey }, sourceReader: walkView, xLog });
					bridgeHooks.walkSourceAssertions(hookArgs, (walkError, walked) => {
						if (walkError) {
							next(`${moduleName}: walkSourceAssertions: ${walkError}`);
							return;
						}
						if (!isPlainObject(walked) || !Array.isArray(walked.assertionList) || !isPlainObject(walked.channelReport)) {
							next(refuse.byName({ moduleName, what: 'walkSourceAssertions returned no { assertionList, channelReport }', where: 'the walk contract (SPEC §4.2)' }).message);
							return;
						}
						if (walked.assertionList.length === 0) {
							next(refuse.byName({ moduleName, what: 'the walk yielded an EMPTY assertion set', where: 'an empty source is refused by name, never frozen green (BR-094, BG-EMPTY)' }).message);
							return;
						}
						const channelKeyList = bridgeDeclaration.sourceChannelList.map((oneChannel) => oneChannel.channelKey);
						// channelReport per declared channel, every term present, reconciliation at zero
						for (let channelIndex = 0; channelIndex < channelKeyList.length; channelIndex++) {
							const oneKey = channelKeyList[channelIndex];
							const oneReport = walked.channelReport[oneKey];
							if (!isPlainObject(oneReport)) {
								next(refuse.byName({ moduleName, what: `channelReport lacks channel '${oneKey}'`, where: 'every declared channel reports rowsRead, assertionsYielded, sentinelDropped, malformedRows, valueTierRows' }).message);
								return;
							}
							const missingTerm = CHANNEL_REPORT_KEY_LIST.find((oneTerm) => !Number.isInteger(oneReport[oneTerm]));
							if (missingTerm !== undefined) {
								next(refuse.byName({ moduleName, what: `channelReport['${oneKey}'].${missingTerm} is not an integer`, where: 'reconciliation needs every term' }).message);
								return;
							}
							if (oneReport.rowsRead !== oneReport.assertionsYielded + oneReport.sentinelDropped + oneReport.malformedRows + oneReport.valueTierRows) {
								next(refuse.byName({ moduleName, what: `channel '${oneKey}' does not reconcile: rowsRead ${oneReport.rowsRead} ≠ assertionsYielded ${oneReport.assertionsYielded} + sentinelDropped ${oneReport.sentinelDropped} + malformedRows ${oneReport.malformedRows} + valueTierRows ${oneReport.valueTierRows}`, where: 'reconciliation at zero per channel (BG-INPUT e)' }).message);
								return;
							}
						}
						const yieldedByChannel = {};
						for (let assertionIndex = 0; assertionIndex < walked.assertionList.length; assertionIndex++) {
							const oneAssertion = walked.assertionList[assertionIndex];
							if (!isPlainObject(oneAssertion)) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} is not an object`, where: 'the walk yields assertion objects' }).message);
								return;
							}
							const forbidden = WALK_ASSERTION_FORBIDDEN_KEY_LIST.find((oneName) => Object.prototype.hasOwnProperty.call(oneAssertion, oneName));
							if (forbidden !== undefined) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} (${JSON.stringify(oneAssertion.sourceLocator)}) carries '${forbidden}'`, where: 'a plugin never sets resolution / confidence / matchBasis / mappingJustification / objectStableId / a card stableId (BR-022)' }).message);
								return;
							}
							const unknownKey = Object.keys(oneAssertion).find((oneName) => WALK_ASSERTION_KEY_LIST.indexOf(oneName) === -1 && oneName !== 'consistencyCheckValueByColumn');
							if (unknownKey !== undefined) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} carries unknown key '${unknownKey}'`, where: `the assertion shape is ${WALK_ASSERTION_KEY_LIST.join(', ')} (+ consistencyCheckValueByColumn)` }).message);
								return;
							}
							if (channelKeyList.indexOf(oneAssertion.channelKey) === -1) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} names channel '${oneAssertion.channelKey}', which is not declared`, where: 'sourceChannelList' }).message);
								return;
							}
							if (!Array.isArray(oneAssertion.rawTargetList) || oneAssertion.rawTargetList.length === 0 || oneAssertion.rawTargetList.some((oneTarget) => !isPlainObject(oneTarget) || typeof oneTarget.sourceColumnName !== 'string' || oneTarget.rawValue === undefined)) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} rawTargetList is not a non-empty list of { sourceColumnName, rawValue }`, where: 'EVERY id the row names, in row order (BR-133)' }).message);
								return;
							}
							if (!isPlainObject(oneAssertion.tupleFieldValues) || !isPlainObject(oneAssertion.subjectIdentity) || !isPlainObject(oneAssertion.sourceLocator)) {
								next(refuse.byName({ moduleName, what: `assertion ${assertionIndex} lacks tupleFieldValues / subjectIdentity / sourceLocator objects`, where: 'the assertion shape (SPEC §4.2)' }).message);
								return;
							}
							yieldedByChannel[oneAssertion.channelKey] = (yieldedByChannel[oneAssertion.channelKey] || 0) + 1;
						}
						channelKeyList.forEach((oneKey) => {
							if ((yieldedByChannel[oneKey] || 0) !== walked.channelReport[oneKey].assertionsYielded) {
								report.refusalList.push({ kind: 'channelReportDrift', channelKey: oneKey, detail: `assertionsYielded ${walked.channelReport[oneKey].assertionsYielded} but ${yieldedByChannel[oneKey] || 0} assertions carry this channelKey` });
							}
						});
						const drift = report.refusalList.find((oneRefusal) => oneRefusal.kind === 'channelReportDrift');
						if (drift) {
							next(refuse.byName({ moduleName, what: `channel '${drift.channelKey}': ${drift.detail}`, where: 'assertionsYielded EQUALS the assertions carrying that channelKey' }).message);
							return;
						}
						const refusedValueTierAssertionCount = bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.tier === 'value').reduce((soFar, oneChannel) => soFar + walked.channelReport[oneChannel.channelKey].valueTierRows, 0);
						say(`walk: ${walked.assertionList.length} assertion(s) over ${channelKeyList.length} channel(s); value-tier rows refused and counted: ${refusedValueTierAssertionCount}`);
						next('', { ...args, assertionList: walked.assertionList, channelReport: walked.channelReport, refusedValueTierAssertionCount });
					});
				});

				// STEP 4 — targets: sentinel drop, transforms (empty cell = ABSENT), consistency checks, label census, refused rows
				// Every one of these operates on WALK ASSERTIONS (sentinels, tuple transforms, the label table). With no
				// assertions there is nothing to prepare; the counters are yielded at zero by name.
				taskList.push((args, next) => {
					if (acquisitionRow.walkChannelSourceKind === null) {
						next('', { ...args, preparedList: [], sentinelDroppedCount: 0, sentinelLabelledRowCount: 0, labelRefusedCount: 0 });
						return;
					}
					const channelByKey = bridgeDeclaration.sourceChannelList.reduce((soFar, oneChannel) => ({ ...soFar, [oneChannel.channelKey]: oneChannel }), {});
					const preparedList = [];
					let sentinelDroppedCount = 0;
					const consistencyReport = [];
					const consistencyRefusalList = [];
					const isSentinelAssertion = (oneAssertion) => oneAssertion.rawTargetList.every((oneTarget) => isSentinelRawValue({ channel: channelByKey[oneAssertion.channelKey], rawValue: oneTarget.rawValue }));
					const census = predicateSourceLib.labelCensus({ predicateSource: bridgeDeclaration.predicateSource, assertionList: args.assertionList, isSentinelAssertion, subjectKeyFor: (oneAssertion) => subjectGroupingLib.subjectKeyFor({ subjectIdentity: bridgeDeclaration.subjectIdentity, assertion: oneAssertion }) });
					if (census.error) {
						next(census.error.message);
						return;
					}
					for (let assertionIndex = 0; assertionIndex < args.assertionList.length; assertionIndex++) {
						const oneAssertion = args.assertionList[assertionIndex];
						const channel = channelByKey[oneAssertion.channelKey];
						if (isSentinelAssertion(oneAssertion)) {
							sentinelDroppedCount += 1;
							continue;
						}
						if (census.refusedRowIndexSet.has(assertionIndex)) {
							const labelRow = predicateSourceLib.labelRowFor({ predicateSource: bridgeDeclaration.predicateSource, assertion: oneAssertion });
							report.refusalList.push({ kind: 'labelRefused', sourceLocator: oneAssertion.sourceLocator, sourceLabel: labelRow.sourceLabel, reason: labelRow.reason });
							continue;
						}
						// tuple fields other than canonicalKey: an empty cell is ABSENT; '' is refused by name
						const suppliedTupleFields = {};
						let fieldFault = null;
						Object.keys(bridgeDeclaration.tupleFieldColumnMap)
							.filter((oneField) => oneField !== 'canonicalKey')
							.forEach((oneField) => {
								const rawValue = oneAssertion.tupleFieldValues[oneField];
								if (rawValue === undefined || rawValue === null) {
									return;
								}
								if (rawValue === '') {
									fieldFault = refuse.byName({ moduleName, what: `assertion ${JSON.stringify(oneAssertion.sourceLocator)} carries tuple field '${oneField}' as '' (empty string)`, where: 'an empty cell is ABSENT (omit the key), never \'\' and never defaulted (BG-INPUT c)' });
									return;
								}
								const transformed = transformRegistryLib.applyTransform({ transformName: bridgeDeclaration.tupleFieldColumnMap[oneField].transform, rawValue: String(rawValue) });
								if (transformed.error) {
									fieldFault = refuse.byName({ moduleName, what: `assertion ${JSON.stringify(oneAssertion.sourceLocator)} tuple field '${oneField}': ${transformed.error}`, where: 'TRANSFORM_REGISTRY' });
									return;
								}
								suppliedTupleFields[oneField] = transformed.value;
							});
						if (fieldFault) {
							next(fieldFault.message);
							return;
						}
						// every raw target → canonicalKey through the declared transform; sentinel targets dropped
						const targetKeyList = [];
						let targetFault = null;
						oneAssertion.rawTargetList.forEach((oneTarget) => {
							if (isSentinelRawValue({ channel, rawValue: oneTarget.rawValue })) {
								return;
							}
							const transformed = transformRegistryLib.applyTransform({ transformName: bridgeDeclaration.tupleFieldColumnMap.canonicalKey.transform, rawValue: String(oneTarget.rawValue) });
							if (transformed.error) {
								targetFault = refuse.byName({ moduleName, what: `assertion ${JSON.stringify(oneAssertion.sourceLocator)} target ${JSON.stringify(oneTarget.rawValue)}: ${transformed.error}`, where: 'the canonicalKey transform' });
								return;
							}
							targetKeyList.push(transformed.value);
						});
						if (targetFault) {
							next(targetFault.message);
							return;
						}
						// consistency checks against canonicalKey (refuse | report); card.<property> checks are settled after resolution
						let rowRefused = false;
						bridgeDeclaration.consistencyCheckColumnList.forEach((oneCheck) => {
							const rawValue = oneAssertion.consistencyCheckValueByColumn === undefined ? undefined : oneAssertion.consistencyCheckValueByColumn[oneCheck.column];
							if (rawValue === undefined || rawValue === null || rawValue === '') {
								return;
							}
							const transformed = transformRegistryLib.applyTransform({ transformName: oneCheck.transform, rawValue: String(rawValue) });
							if (oneCheck.against === 'canonicalKey') {
								const agrees = !transformed.error && targetKeyList.indexOf(transformed.value) !== -1;
								if (!agrees) {
									if (oneCheck.disposition === 'refuse') {
										rowRefused = true;
										consistencyRefusalList.push({ kind: 'consistencyRefused', sourceLocator: oneAssertion.sourceLocator, column: oneCheck.column, rawValue: String(rawValue), against: 'canonicalKey', targetKeyList: targetKeyList.slice() });
									} else {
										consistencyReport.push({ sourceLocator: oneAssertion.sourceLocator, column: oneCheck.column, rawValue: String(rawValue), against: 'canonicalKey', disagrees: true });
									}
								}
							}
						});
						if (rowRefused) {
							continue;
						}
						const labelRow = predicateSourceLib.labelRowFor({ predicateSource: bridgeDeclaration.predicateSource, assertion: oneAssertion });
						preparedList.push({ ...oneAssertion, suppliedTupleFields, targetKeyList, labelRow, valueTier: channel.tier === 'value' || oneAssertion.tupleFieldValues.valueKey !== undefined, lossyEcho: targetKeyList.length > 1 });
					}
					report.refusalList.push(...consistencyRefusalList);
					report.consistencyReport = consistencyReport;
					if (preparedList.length === 0) {
						next(refuse.byName({ moduleName, what: 'after sentinel drop and row refusals, NO assertion remains', where: 'never an empty block frozen green (BG-EMPTY)' }).message);
						return;
					}
					next('', { ...args, preparedList, sentinelDroppedCount, sentinelLabelledRowCount: census.sentinelLabelledRowCount, labelRefusedCount: census.labelRefusedCount });
				});

				// STEP 5 — SUBJECT GROUPS. Which producer builds them is a member of the acquisition row (RULING
				// §11.11, approved SABLE_RIVER 2026-08-17). The two rows below are the whole difference between a
				// documentary bridge and a retrieved one at this step; nothing here tests a matchBasis NAME.
				const subjectGroupProducerByKind = Object.freeze({
					// walkAssertion — subjects come from the WALK: group assertions, window, resolve identity through the
					// plugin's subjectStableIdFor hook, merge, collide. Byte-unchanged from before the registry existed.
					walkAssertion: (args, next) => {
					const grouped = subjectGroupingLib.groupBySubject({ assertionList: args.preparedList, subjectIdentity: bridgeDeclaration.subjectIdentity });
					if (grouped.error) {
						next(grouped.error.message);
						return;
					}
					const sortedGroupList = grouped.subjectGroupList.slice().sort((leftGroup, rightGroup) => compareStrings(leftGroup.subjectKey, rightGroup.subjectKey));
					const windowed = sourceWindowLib.applySourceSelection(sortedGroupList.map((oneGroup) => ({ stableId: oneGroup.subjectKey, group: oneGroup })), { limit: spec.config.limit, offset: spec.config.offset, subjectStableIdList: spec.config.subjectStableIdList });
					if (windowed.error) {
						next(`${moduleName}: ${windowed.error}`);
						return;
					}
					const subjectGroupList = windowed.sourceNodes.map((oneEntry) => oneEntry.group);
					if (windowed.window) {
						say(sourceWindowLib.describeWindow(windowed.window));
					}
					const walkView = args.reader.forWalk({ channelPropertyList: walkChannelPropertyList(bridgeDeclaration) });
					let hookCallCount = 0;
					const subjectIdentityList = subjectGroupList.map((oneGroup) => ({ subjectKey: oneGroup.subjectKey, subjectIdentity: { ...oneGroup.subjectIdentity } }));
					hookCallCount += 1;
					bridgeHooks.subjectStableIdFor(graphSeamRulesLib.closedHookArgs({ subjectIdentityList, sourceReader: walkView, xLog }), (resolveError, resolved) => {
						if (resolveError) {
							next(`${moduleName}: subjectStableIdFor: ${resolveError}`);
							return;
						}
						if (!isPlainObject(resolved) || !isPlainObject(resolved.resolutionBySubjectKey)) {
							next(refuse.byName({ moduleName, what: 'subjectStableIdFor returned no { resolutionBySubjectKey }', where: 'the hook contract (SPEC §4.2)' }).message);
							return;
						}
						const merged = subjectGroupingLib.verifyResolutionAndMerge({ subjectGroupList, resolutionBySubjectKey: resolved.resolutionBySubjectKey, subjectNodeStableIdSet: new Set(Object.keys(args.subjectNodeByStableId)) });
						merged.sourceGapList.forEach((oneGap) => report.refusalList.push({ kind: 'sourceGap', subjectKey: oneGap.subjectKey, reason: oneGap.reason, detail: oneGap.detail }));
						merged.subjectCollisionList.forEach((oneCollision) => report.refusalList.push({ kind: 'subjectCollision', subjectStableId: oneCollision.subjectStableId, assertingSubjectList: oneCollision.assertingSubjectList, targetSetBySubjectKey: oneCollision.targetSetBySubjectKey }));
						report.subjectNodeReport = { subjectCount: subjectGroupList.length, resolved: merged.leafList.length + merged.subjectCollisionList.length, refused: merged.sourceGapList.length, leaves: merged.leafList.length, manyToOneSubjectCount: merged.manyToOneSubjectCount, collisions: merged.subjectCollisionList.length, hookCallCount };
						say(`subjects: ${subjectGroupList.length} distinct; leaves ${merged.leafList.length}; sourceGap ${merged.sourceGapList.length}; subjectCollision ${merged.subjectCollisionList.length} (subjectStableIdFor called ${hookCallCount}×)`);
						next('', { ...args, subjectGroupList, leafList: merged.leafList, sourceGapList: merged.sourceGapList, subjectCollisionList: merged.subjectCollisionList, manyToOneSubjectCount: merged.manyToOneSubjectCount, windowMark });
					});
					},
					// graphLabel — subjects ARE graph nodes carrying the declared label, narrowed to a declared evaluation
					// scope. There is no walk, so there are no assertions, no identity resolution (a node IS its stableId —
					// this is what "subjectStableIdFor = identity" means, and it is why the hook is FORBIDDEN on this
					// basis), no merge and no collision: two distinct nodes are two distinct subjects by construction.
					// The retrieval reads happen HERE, once for the whole run, through the DECLARED method's row
					// (CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY): the purpose-scoped forRetrieval() view for vectors, the evidence
					// view for the structure a neighbour vote needs.
					graphLabel: (args, next) => {
						const subjectSource = bridgeDeclaration.subjectSource;
						const labelledNodeList = args.subjectNodeList.filter((oneNode) => oneNode.labels.indexOf(subjectSource.label) !== -1);
						if (labelledNodeList.length === 0) {
							next(refuse.byName({ moduleName, what: `subjectSource names label '${subjectSource.label}' and the source standard '${sourceStandardName}' carries ZERO nodes with it`, where: 'an empty subject population is refused by name, never frozen green (BG-EMPTY)' }).message);
							return;
						}
						const labelledByStableId = labelledNodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});
						let inScopeNodeList = labelledNodeList;
						let scopeDigest = null;
						if (subjectSource.scopeStableIdListPath !== null) {
							// RESOLVED RELATIVE TO THE PLUGIN'S OWN FORGE BUNDLE when the declared path is relative,
							// exactly as remodelTableRef is (STEP 5b). A committed declaration must not carry an
							// absolute path: the evaluation scope travels WITH the plugin, and a machine-specific
							// string in a content-addressed declaration would make the block id machine-specific too.
							// An absolute path is still honoured, for a scope that genuinely lives outside the bundle.
							if (typeof registry.forgesDirPath !== 'string') {
								next(refuse.byName({ moduleName, what: `plugin declares scopeStableIdListPath '${subjectSource.scopeStableIdListPath}' but the registry names no forgesDirPath`, where: 'a relative scope path is resolved under the registry\'s forges directory, beside the plugin that declares it' }).message);
								return;
							}
							const scopeFilePath = path.isAbsolute(subjectSource.scopeStableIdListPath) ? subjectSource.scopeStableIdListPath : path.join(registry.forgesDirPath, bridgeDeclaration.standardKey, subjectSource.scopeStableIdListPath);
							if (!fs.existsSync(scopeFilePath)) {
								next(refuse.byName({ moduleName, what: `subjectSource.scopeStableIdListPath names no file at ${scopeFilePath}`, where: 'the evaluation scope is DATA on disk; declared-but-broken refuses every build (FF §5.4)' }).message);
								return;
							}
							const scopeBytes = fs.readFileSync(scopeFilePath);
							const parsedScope = decisionBlockLib.parseJsonText(scopeBytes.toString('utf8'));
							if (parsedScope.error || !Array.isArray(parsedScope.value) || parsedScope.value.length === 0 || parsedScope.value.some((oneId) => typeof oneId !== 'string' || oneId === '')) {
								next(refuse.byName({ moduleName, what: `the scope list at ${scopeFilePath} is not a non-empty JSON array of stableId strings (${parsedScope.error || 'wrong shape'})`, where: 'the evaluation scope is an explicit list, never a filter expression' }).message);
								return;
							}
							// EVERY named id must be a node carrying the label. A scope naming something that is not there is a
							// scope that has drifted from its graph, and silently running the intersection would report a smaller
							// population as a complete one — the same shape of lie as a gate that shrinks (RULING BR3-6).
							const absentList = parsedScope.value.filter((oneId) => labelledByStableId[oneId] === undefined);
							if (absentList.length > 0) {
								next(refuse.byName({ moduleName, what: `the scope list names ${absentList.length} stableId(s) that are not '${subjectSource.label}' nodes in this graph (sample: ${absentList.slice(0, 3).join(' | ')})`, where: 'the scope and the graph disagree; re-derive the scope against THIS graph or fix the forge — never silently intersect' }).message);
								return;
							}
							const scopeSet = new Set(parsedScope.value);
							inScopeNodeList = labelledNodeList.filter((oneNode) => scopeSet.has(oneNode.stableId));
							scopeDigest = sha256Hex(canonicalJson(parsedScope.value.slice().sort(compareStrings)));
						}
						const sortedNodeList = inScopeNodeList.slice().sort((leftNode, rightNode) => compareStrings(leftNode.stableId, rightNode.stableId));
						const windowed = sourceWindowLib.applySourceSelection(sortedNodeList.map((oneNode) => ({ stableId: oneNode.stableId, node: oneNode })), { limit: spec.config.limit, offset: spec.config.offset, subjectStableIdList: spec.config.subjectStableIdList });
						if (windowed.error) {
							next(`${moduleName}: ${windowed.error}`);
							return;
						}
						if (windowed.window) {
							say(sourceWindowLib.describeWindow(windowed.window));
						}
						if (windowed.namedSet) {
							say(sourceWindowLib.describeNamedSet(windowed.namedSet));
						}
						const windowedNodeList = windowed.sourceNodes.map((oneEntry) => oneEntry.node);
						// one node = one subject = one leaf, with NO asserting subject: nothing asserted it, which is exactly
						// what a derived mapping means. The census weights an empty assertingSubjectList as 1 (census.js).
						const leafList = windowedNodeList.map((oneNode) => ({ subjectKey: oneNode.stableId, subjectStableId: oneNode.stableId, assertingSubjectList: [], assertionList: [] }));
						// WHICH reads and indexes retrieval needs is a member of the DECLARED method's row
						// (CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY): read ONCE per run here, used per subject in STEP 6.
						const retrievalDeclaration = bridgeDeclaration.candidateRetrieval;
						const methodLookup = retrievalMethodRowFor(retrievalDeclaration);
						if (methodLookup.error) {
							next(methodLookup.error.message);
							return;
						}
						const retrievalMethodRow = methodLookup.methodRow;
						const retrievalContext = { retrievalView: args.reader.forRetrieval(), evidenceView: args.reader.forEvidence(), retrievalDeclaration, hubName: args.hubName, sourceStandardName, subjectLabel: subjectSource.label, subjectNodeList: args.subjectNodeList, windowedNodeList };
						retrievalMethodRow.prepareRetrieval(retrievalContext, (prepareError, retrievalState) => {
							if (prepareError) {
								next(prepareError);
								return;
							}
							report.subjectNodeReport = { subjectCount: leafList.length, resolved: leafList.length, refused: 0, leaves: leafList.length, manyToOneSubjectCount: 0, collisions: 0, hookCallCount: 0 };
							const settingsText = retrievalMethodRow.settingsPairListFor(retrievalDeclaration).map(([settingLabel, settingValue]) => `${settingLabel} ${settingValue}`).join(' ');
							say(`subjects: ${leafList.length} '${subjectSource.label}' node(s) in scope (of ${labelledNodeList.length} labelled); retrieval index ${retrievalState.hubVectorIndex.recordCount} card(s) × ${retrievalState.hubVectorIndex.dimension}d (${retrievalState.hubVectorIndex.embeddingModelVersion}); ${settingsText}`);
							next('', { ...args, subjectGroupList: leafList, leafList, sourceGapList: [], subjectCollisionList: [], manyToOneSubjectCount: 0, windowMark, retrievalMethodRow, retrievalState, scopeDigest });
						});
					},
				});
				taskList.push((args, next) => subjectGroupProducerByKind[acquisitionRow.subjectGroupProducerKind](args, next));

				// STEP 5b — the HUB-owned remodel table, by REFERENCE (RULING P11, D-S5): forges/<hubToken>/bridgeData/
				// <remodelTableRef>.json keyed hubName@hubVersion, read as data (never required as code), digested into
				// the header; a declared ref with no table, or a table without this hub@version, is refused by name
				taskList.push((args, next) => {
					if (bridgeDeclaration.remodelTableRef === null) {
						next('', { ...args, remodelTable: null, remodelTableDigest: null });
						return;
					}
					if (typeof registry.forgesDirPath !== 'string') {
						next(refuse.byName({ moduleName, what: `plugin declares remodelTableRef '${bridgeDeclaration.remodelTableRef}' but the registry names no forgesDirPath`, where: 'the hub bundle is resolved under the registry\'s forges directory' }).message);
						return;
					}
					const tablePath = path.join(registry.forgesDirPath, hubToken, 'bridgeData', `${bridgeDeclaration.remodelTableRef}.json`);
					if (!fs.existsSync(tablePath)) {
						next(refuse.byName({ moduleName, what: `remodelTableRef '${bridgeDeclaration.remodelTableRef}' names no table at ${tablePath}`, where: 'the property-side remodel table is HUB-OWNED data under forges/<hub>/bridgeData/ (RULING P11)' }).message);
						return;
					}
					const tableBytes = fs.readFileSync(tablePath);
					const parsedTable = decisionBlockLib.parseJsonText(tableBytes.toString('utf8'));
					if (parsedTable.error || !isPlainObject(parsedTable.value)) {
						next(refuse.byName({ moduleName, what: `remodel table ${tablePath} is not a JSON object (${parsedTable.error || 'not an object'})`, where: 'keyed hubName@hubVersion → rawCanonicalKey → tuple' }).message);
						return;
					}
					const remodelTable = parsedTable.value;
					const tableKey = `${args.hubName}@${hubVersion}`;
					if (!isPlainObject(remodelTable[tableKey])) {
						next(refuse.byName({ moduleName, what: `remodel table ${tablePath} carries no entry for ${tableKey} (keys: ${Object.keys(remodelTable).join(', ')})`, where: 'the table is keyed hubName@hubVersion' }).message);
						return;
					}
					next('', { ...args, remodelTable, remodelTableDigest: crypto.createHash('sha256').update(tableBytes).digest('hex') });
				});

				// STEP 6 — CANDIDATE POOLS + classification → decision records. Which producer builds the pool is a
				// member of the acquisition row, exactly as the subject producer is. A key-filtered pool is assembled
				// from the canonicalKey multimap; a retrieved pool is assembled by the declared retrieval method's row. Both
				// hand STEP 7 the SAME two outputs, so the judge, the freeze, the materialiser and the census below are
				// shared byte-for-byte between the two bases.
				const poolProducerByKind = Object.freeze({
					canonicalKeyIndex: (args, next) => {
					const remodelTable = args.remodelTable;
					const decisionRecordList = [];
					const judgedTaskList = [];
					let buildFault = null;
					args.leafList.forEach((oneLeaf) => {
						if (buildFault) {
							return;
						}
						// distinct targets of the leaf, each with its remodel + supplied tuple, and the rows naming it
						const targetByKey = {};
						const targetOrder = [];
						oneLeaf.assertionList.forEach((oneAssertion) => {
							oneAssertion.targetKeyList.forEach((oneCanonicalKey) => {
								const remodelled = subjectGroupingLib.applyRemodel({ target: { canonicalKey: oneCanonicalKey, ...oneAssertion.suppliedTupleFields }, remodelTable, hubName: args.hubName, hubVersion: String(hubVersion), classSideRemodelTable: bridgeDeclaration.classSideRemodelTable });
								const targetKey = canonicalJson(remodelled.target);
								if (targetByKey[targetKey] === undefined) {
									targetByKey[targetKey] = { targetKey, target: remodelled.target, rawCanonicalKey: oneCanonicalKey, remodelApplied: remodelled.remodelApplied, sourceDomainSuperseded: remodelled.sourceDomainSuperseded, assertionList: [], valueTier: false, lossyEcho: false };
									targetOrder.push(targetKey);
								}
								targetByKey[targetKey].assertionList.push(oneAssertion);
								targetByKey[targetKey].valueTier = targetByKey[targetKey].valueTier || oneAssertion.valueTier;
								targetByKey[targetKey].lossyEcho = targetByKey[targetKey].lossyEcho || oneAssertion.lossyEcho;
							});
						});
						const dispositionList = oneLeaf.assertionList.map((oneAssertion) => oneAssertion.labelRow.disposition);
						const allPredicate = dispositionList.every((oneDisposition) => oneDisposition === 'predicate');
						const anyLossyEcho = oneLeaf.assertionList.some((oneAssertion) => oneAssertion.lossyEcho);
						// union grouping: a lossy echo (one row, several ids) or MIXED / all-tentative labels over several
						// targets → ONE (subject, union-target) record; all-predicate rows → N per-target records
						const nonValueTargetKeyList = targetOrder.filter((oneKey) => !targetByKey[oneKey].valueTier);
						const unionAll = nonValueTargetKeyList.length > 1 && (!allPredicate || anyLossyEcho);
						const groupList = unionAll ? [nonValueTargetKeyList] : nonValueTargetKeyList.map((oneKey) => [oneKey]);
						// value-tier targets: refused and counted, never grouped
						targetOrder
							.filter((oneKey) => targetByKey[oneKey].valueTier)
							.forEach((oneKey) => {
								const oneTarget = targetByKey[oneKey];
								decisionRecordList.push({ subjectStableId: oneLeaf.subjectStableId, assertingSubjectList: oneLeaf.assertingSubjectList, targetKey: oneKey, targetCanonicalKeyList: [oneTarget.target.canonicalKey], classification: 'valueTierRefused', resolution: null, objectStableId: null, predicate: null, rawForm: oneTarget.assertionList.map((oneAssertion) => oneAssertion.rawTargetList.map((oneRaw) => String(oneRaw.rawValue))), attestationChannelList: oneTarget.assertionList.map((oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? oneAssertion.sourceLocator.rowNumber : oneAssertion.sourceLocator.stableId}`).sort() });
							});
						groupList.forEach((oneGroupKeyList) => {
							if (buildFault) {
								return;
							}
							const groupTargetList = oneGroupKeyList.map((oneKey) => targetByKey[oneKey]);
							const groupAssertionList = Array.from(new Set(groupTargetList.reduce((soFar, oneTarget) => soFar.concat(oneTarget.assertionList), [])));
							const groupDispositionList = groupAssertionList.map((oneAssertion) => oneAssertion.labelRow.disposition);
							const allLabelsTentative = groupDispositionList.every((oneDisposition) => oneDisposition === 'tentative');
							const allLabelsPredicate = groupDispositionList.every((oneDisposition) => oneDisposition === 'predicate');
							const labelsMixed = !allLabelsTentative && !allLabelsPredicate;
							// key pools and filtered pools, per target then unioned; seat reasons per card
							let keyPoolCardList = [];
							let filteredCardList = [];
							const seatReasonByStableId = {};
							const mismatchByField = {};
							groupTargetList.forEach((oneTarget) => {
								const keyPool = args.cardListByCanonicalKey.get(oneTarget.target.canonicalKey);
								const suppliedTupleFields = { ...oneTarget.target };
								const filtered = classificationLib.filterPoolByTuple({ keyPool, suppliedTupleFields });
								keyPool.forEach((oneCard) => {
									if (!keyPoolCardList.some((soFarCard) => soFarCard.stableId === oneCard.stableId)) {
										keyPoolCardList.push(oneCard);
									}
								});
								filtered.filteredPool.forEach((oneCard) => {
									if (!filteredCardList.some((soFarCard) => soFarCard.stableId === oneCard.stableId)) {
										filteredCardList.push(oneCard);
									}
									seatReasonByStableId[oneCard.stableId] = filtered.filterFieldList.length ? 'filteredOnKeyAndTuple' : 'filteredOnKey';
								});
								Object.keys(filtered.mismatchByField).forEach((oneField) => {
									mismatchByField[oneField] = { suppliedValue: suppliedTupleFields[oneField], eliminated: filtered.mismatchByField[oneField] };
								});
							});
							keyPoolCardList = classificationLib.sortByStableId(keyPoolCardList);
							filteredCardList = classificationLib.sortByStableId(filteredCardList);
							const context = { subjectUnresolvable: false, subjectCollision: false, valueTier: false, allLabelsTentative, allLabelsPredicate, labelsMixed, keyPoolSize: keyPoolCardList.length, filteredPoolSize: filteredCardList.length };
							const classified = classificationLib.classifyTarget(context);
							if (classified.error) {
								buildFault = classified.error;
								return;
							}
							const attestationChannelList = groupAssertionList.map((oneAssertion) => `${oneAssertion.sourceLocator.channelKey}:${oneAssertion.sourceLocator.rowNumber !== undefined ? oneAssertion.sourceLocator.rowNumber : oneAssertion.sourceLocator.stableId}`).sort();
							const targetKey = oneGroupKeyList.length === 1 ? oneGroupKeyList[0] : `union:${oneGroupKeyList.slice().sort().join('|')}`;
							const baseRecord = {
								subjectStableId: oneLeaf.subjectStableId,
								assertingSubjectList: oneLeaf.assertingSubjectList,
								targetKey,
								targetCanonicalKeyList: groupTargetList.map((oneTarget) => oneTarget.target.canonicalKey).sort(),
								suppliedTupleByTarget: groupTargetList.reduce((soFar, oneTarget) => ({ ...soFar, [oneTarget.target.canonicalKey]: oneTarget.target }), {}),
								remodelApplied: groupTargetList.map((oneTarget) => oneTarget.remodelApplied).find((oneRemodel) => oneRemodel !== null) || null,
								sourceDomainSuperseded: groupTargetList.map((oneTarget) => oneTarget.sourceDomainSuperseded).find((oneSuperseded) => oneSuperseded !== null) || null,
								sourceLabelList: Array.from(new Set(groupAssertionList.map((oneAssertion) => oneAssertion.labelRow.sourceLabel === null ? '(channelAssertion)' : oneAssertion.labelRow.sourceLabel))).sort(),
								attestationChannelList,
								keyPoolStableIdList: keyPoolCardList.map((oneCard) => oneCard.stableId),
								filteredPoolStableIdList: filteredCardList.map((oneCard) => oneCard.stableId),
								classification: classified.classification,
								judgedReason: classified.reason,
								lossyEcho: groupTargetList.some((oneTarget) => oneTarget.lossyEcho),
							};
							if (classified.classification === 'orphan') {
								decisionRecordList.push({ ...baseRecord, resolution: null, objectStableId: null, predicate: null, reason: baseRecord.remodelApplied ? 'remodelTargetAbsent' : 'noCardUnderKey' });
								return;
							}
							if (classified.classification === 'specified') {
								const predicateSet = new Set(groupAssertionList.map((oneAssertion) => oneAssertion.labelRow.predicate));
								if (predicateSet.size > 1) {
									buildFault = refuse.byName({ moduleName, what: `subject ${oneLeaf.subjectStableId} → ${filteredCardList[0].stableId} is asserted with TWO predicates (${Array.from(predicateSet).sort().join(', ')}) by rows ${attestationChannelList.join(', ')}`, where: 'ONE edge per (subject, predicate, object); a pair with two predicates is refused at freeze (BG-EDGE-UNIQUE b)' });
									return;
								}
								const oneRow = groupAssertionList.slice().sort((leftAssertion, rightAssertion) => compareStrings(locatorTextFor(leftAssertion), locatorTextFor(rightAssertion)))[0].labelRow;
								decisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].stableId, predicate: oneRow.predicate, predicateAssertedBy: oneRow.predicateAssertedBy, sourceLabel: oneRow.sourceLabel, mappingJustification: 'semapv:ManualMappingCuration' });
								return;
							}
							// judged: the pool is the filtered pool, or the KEY pool on a source-side mismatch (BR-062)
							const pool = classified.reason === 'sourceSideMismatch' ? keyPoolCardList : filteredCardList;
							const seatReason = classified.reason === 'sourceSideMismatch' ? 'keyPoolOnSourceSideMismatch' : null;
							judgedTaskList.push({
								baseRecord: {
									...baseRecord,
									resolution: 'judged',
									mappingJustification: 'semapv:CompositeMatching',
									sourceSideMismatch: classified.reason === 'sourceSideMismatch' ? { mismatchByField, survivingCandidateCount: keyPoolCardList.length } : null,
								},
								pool,
								seatReason,
								seatReasonByStableId,
								groupAssertionList,
							});
						});
					});
					if (buildFault) {
						next(buildFault.message);
						return;
					}
					say(`classified: ${decisionRecordList.length} settled record(s) (specified/orphan/valueTier), ${judgedTaskList.length} to judge`);
					next('', { ...args, decisionRecordList, judgedTaskList });
					},
					// vectorRetrieval — one subject, one pool, one judged task. There is no target grouping, no union and
					// no remodel: those exist to reconcile several document rows naming one subject, and a derived subject
					// has no rows. The METHOD ROW decides the seats and names the trace (the cosineTopK-v1 rank and cosine; the
					// embedTextVote-v1 votes, paths, cardTextCosine and neighbour trace); the trace is recorded on the record as
					// forensics and never rendered — the pool reaches the judge sorted by stableId, which is what makes the order neutral.
					vectorRetrieval: (args, next) => {
						const retrievalDeclaration = bridgeDeclaration.candidateRetrieval;
						const { retrievalMethodRow, retrievalState } = args;
						const attestationChannelList = [`retrieval:${bridgeDeclaration.subjectSource.label}`];
						const mappingJustification = retrievalMethodRow.mappingJustificationFor({ retrievalState });
						const decisionRecordList = [];
						const judgedTaskList = [];
						let buildFault = null;
						args.leafList.forEach((oneLeaf) => {
							if (buildFault) {
								return;
							}
							// the DECLARED method's pool for this subject, in RANK order, with its trace fields (CANDIDATE_RETRIEVAL_METHOD_RUNNER_REGISTRY)
							const pooled = retrievalMethodRow.poolForSubject({ retrievalState, retrievalDeclaration, subjectStableId: oneLeaf.subjectStableId, hubName: args.hubName });
							if (pooled.error) {
								buildFault = pooled.error;
								return;
							}
							const missingSeatStableId = pooled.seatStableIdList.find((oneSeatStableId) => args.cardByStableId[oneSeatStableId] === undefined);
							if (missingSeatStableId !== undefined) {
								buildFault = refuse.byName({ moduleName, what: `retrieval named card ${missingSeatStableId}, which is not in the card index read this run`, where: 'the vector view and the card view must describe the SAME population; a card with a vector and no card row is a forge defect' });
								return;
							}
							const poolCardList = classificationLib.sortByStableId(pooled.seatStableIdList.map((oneSeatStableId) => args.cardByStableId[oneSeatStableId]));
							const classified = classificationLib.classifyTarget({ poolOrigin: 'retrieval', filteredPoolSize: poolCardList.length, keyPoolSize: 0, subjectUnresolvable: false, subjectCollision: false, valueTier: false, allLabelsTentative: false, allLabelsPredicate: false, labelsMixed: false });
							if (classified.error) {
								buildFault = classified.error;
								return;
							}
							const baseRecord = {
								subjectStableId: oneLeaf.subjectStableId,
								assertingSubjectList: [],
								targetKey: `retrieval:${oneLeaf.subjectStableId}`,
								targetCanonicalKeyList: [],
								suppliedTupleByTarget: {},
								remodelApplied: null,
								sourceDomainSuperseded: null,
								sourceLabelList: [],
								attestationChannelList,
								keyPoolStableIdList: [],
								filteredPoolStableIdList: poolCardList.map((oneCard) => oneCard.stableId),
								// the retrieval trace, in RANK order, under the field names its method row gives it: retrievalSeatList for
								// cosineTopK-v1; retrievalVoteList and neighbourTrace for embedTextVote-v1. Forensics inside the frozen text —
								// what makes recall@K measurable from the block alone — and never rendered: the pool above is sorted by stableId.
								...pooled.recordTraceByFieldName,
								classification: classified.classification,
								judgedReason: classified.reason,
								lossyEcho: false,
							};
							if (classified.classification === 'orphan') {
								decisionRecordList.push({ ...baseRecord, resolution: null, objectStableId: null, predicate: null, reason: classified.reason });
								return;
							}
							judgedTaskList.push({
								baseRecord: { ...baseRecord, resolution: 'judged', mappingJustification, sourceSideMismatch: null },
								pool: poolCardList,
								seatReason: 'retrieval',
								seatReasonByStableId: {},
								groupAssertionList: [],
							});
						});
						if (buildFault) {
							next(buildFault.message);
							return;
						}
						const settingsText = retrievalMethodRow.settingsPairListFor(retrievalDeclaration).map(([settingLabel, settingValue]) => `${settingLabel} ${settingValue}`).join(', ');
						say(`retrieved: ${judgedTaskList.length} subject(s) with a pool, ${decisionRecordList.length} with none (noCandidate) — ${settingsText}`);
						next('', { ...args, decisionRecordList, judgedTaskList });
					},
				});
				taskList.push((args, next) => poolProducerByKind[acquisitionRow.poolProducerKind](args, next));

				// STEP 7 — the JUDGE (bounded runner, index-collecting); the debug double is the only judge in B2
				taskList.push((args, next) => {
					if (args.judgedTaskList.length === 0) {
						next('', { ...args, judgedRecordList: [], judgeKind: RUN_KIND_NONE });
						return;
					}
					if (!judgeClient || typeof judgeClient.rerank !== 'function') {
						const firstJudged = args.judgedTaskList[0];
						next(refuse.byName({ moduleName, what: `a judged decision is needed for subject ${firstJudged.baseRecord.subjectStableId} (${firstJudged.baseRecord.targetKey}) and inferenceConfig.llmClient is absent`, where: 'a re-judge with judged subjects needs the real client or the debug judge (build.js resolveInferenceConfig); a specified-only run needs no judge' }).message);
						return;
					}
					// ⟪JOB 1, 2026-09-07, ruled by DAWN_TOWER⟫ the REAL arm stopped prepending a hard-coded provider
					// name: since the split, judgeClient.model IS the namespaced identity ('anthropic:claude-opus-4-8'),
					// so 'anthropic:' + that would have read 'anthropic:anthropic:claude-opus-4-8' in a FROZEN block
					// header. JOB 1 left the DEBUG arm alone and handed the unification to JOB 4.
					//
					// ⟪JOB 4, 2026-09-07⟫ THE TERNARY IS GONE AND THAT IS THE POINT OF THE WHOLE ORDER. What stood
					// here asked WHICH PROVIDER THE FRAMEWORK WAS HOLDING and built the identity two different ways
					// depending on the answer — a switch on provider type, in the one place the registry order says
					// there must never be one. It is now the single expression `judgeClient.model`, which every
					// provider supplies because JUDGE_PROVIDER_SHAPE requires it.
					//
					// THIS EDIT IS BYTE-PRESERVING FOR BOTH ARMS, which is the only reason it is safe to make.
					// The real arm already read judgeClient.model. The debug arm read `debug:${ruleName}`, and
					// debugJudge's identity was changed IN THE SAME COMMIT to be exactly that — 'debug:<rule>' —
					// so the string a frozen block header carries does not move for either provider.
					// test-bgProducer's conjunct a_generationEndsInDebugMarkAndJudgeKind asserts
					// `judgeKind === 'debug:digest'`; it is UNCHANGED and passing, and it is
					// the proof: it is the one assertion that would fail if this unification had shifted the value.
					const judgeKind = judgeClient.model;
					const budget = { maxJudgmentCount, judgmentCountSoFar: 0 };
					const evidenceView = args.reader.forEvidence();
					// the key is PRESENT iff the hook is declared (contract, RULING BR4); with the hook off there is no guidance to render
					const globalGuidanceList = bridgeDeclaration.evidenceHooksDeclared.globalGuidance ? bridgeDeclaration.globalGuidanceList.slice() : [];
					const judgeOneTask = (oneTask, taskIndex, taskDone) => {
						const subjectNode = args.subjectNodeByStableId[oneTask.baseRecord.subjectStableId];
						// the source's own material is MERGED over every row of the group in LOCATOR order (never walk order —
						// BG-DET c): per column, the distinct values sorted and joined, so the rendered question is order-free
						const orderedAssertionList = oneTask.groupAssertionList.slice().sort((leftAssertion, rightAssertion) => compareStrings(locatorTextFor(leftAssertion), locatorTextFor(rightAssertion)));
						const mergedByColumn = (pick) => {
							const valueListByColumn = {};
							orderedAssertionList.forEach((oneAssertion) => {
								const valueByColumn = pick(oneAssertion);
								Object.keys(valueByColumn === undefined || valueByColumn === null ? {} : valueByColumn).forEach((oneColumn) => {
									const oneValue = valueByColumn[oneColumn];
									if (oneValue === undefined || oneValue === null || String(oneValue) === '') {
										return;
									}
									(valueListByColumn[oneColumn] = valueListByColumn[oneColumn] || []).push(String(oneValue));
								});
							});
							return Object.keys(valueListByColumn).reduce((soFar, oneColumn) => ({ ...soFar, [oneColumn]: Array.from(new Set(valueListByColumn[oneColumn])).sort().join(' | ') }), {});
						};
						const sourceElement = {
							name: typeof subjectNode.properties.name === 'string' && subjectNode.properties.name.trim() !== '' ? subjectNode.properties.name : subjectNode.stableId,
							stableId: subjectNode.stableId,
							material: Object.keys(subjectNode.properties)
								.filter((oneName) => subjectMaterialNameList.indexOf(oneName) !== -1)
								.reduce((soFar, oneName) => ({ ...soFar, [oneName]: subjectNode.properties[oneName] }), {}),
							evidence: { subject: mergedByColumn((oneAssertion) => (oneAssertion.evidence ? oneAssertion.evidence.subject : {})), assertion: mergedByColumn((oneAssertion) => (oneAssertion.evidence ? oneAssertion.evidence.assertion : {})) },
							sourceLabelByColumn: mergedByColumn((oneAssertion) => oneAssertion.sourceLabelByColumn),
							sourceNoteByColumn: mergedByColumn((oneAssertion) => oneAssertion.sourceNoteByColumn),
						};
						const candidatePool = oneTask.pool.map((oneCard) => ({ card: oneCard, seatReason: oneTask.seatReason === null ? oneTask.seatReasonByStableId[oneCard.stableId] : oneTask.seatReason }));
						const withEvidenceHooks = (hooksDone) => {
							const hookState = { perCandidateNoteByStableId: {}, promptSegmentList: [], nominatedByStableId: {} };
							const afterNominate = () => {
								if (!bridgeDeclaration.evidenceHooksDeclared.walkEvidence) {
									hooksDone('', hookState);
									return;
								}
								bridgeHooks.walkEvidence({ sourceElement: { ...sourceElement }, candidatePool: candidatePool.map((oneSeat) => ({ ...oneSeat.card })), sourceReader: evidenceView }, (walkError, walkedEvidence) => {
									if (walkError) {
										hooksDone(`walkEvidence: ${walkError}`);
										return;
									}
									if (!isPlainObject(walkedEvidence) || !isPlainObject(walkedEvidence.perCandidateNoteByStableId) || !Array.isArray(walkedEvidence.promptSegmentList)) {
										hooksDone(refuse.byName({ moduleName, what: 'walkEvidence returned no { perCandidateNoteByStableId, promptSegmentList }', where: 'the hook contract' }).message);
										return;
									}
									hookState.perCandidateNoteByStableId = walkedEvidence.perCandidateNoteByStableId;
									hookState.promptSegmentList = walkedEvidence.promptSegmentList;
									hooksDone('', hookState);
								});
							};
							if (!bridgeDeclaration.evidenceHooksDeclared.nominate) {
								afterNominate();
								return;
							}
							bridgeHooks.nominateCandidates({ sourceElement: { ...sourceElement }, candidatePool: candidatePool.map((oneSeat) => ({ ...oneSeat.card })) }, (nominateError, nominationList) => {
								if (nominateError) {
									hooksDone(`nominateCandidates: ${nominateError}`);
									return;
								}
								if (!Array.isArray(nominationList)) {
									hooksDone(refuse.byName({ moduleName, what: 'nominateCandidates returned no list', where: '[{ candidateStableId, rationale }]' }).message);
									return;
								}
								for (let nominationIndex = 0; nominationIndex < nominationList.length; nominationIndex++) {
									const oneNomination = nominationList[nominationIndex];
									if (!isPlainObject(oneNomination) || typeof oneNomination.rationale !== 'string' || oneNomination.rationale.trim() === '') {
										hooksDone(refuse.byName({ moduleName, what: `nomination ${nominationIndex} carries no rationale`, where: 'a nomination without rationale is refused (BR-016)' }).message);
										return;
									}
									if (!candidatePool.some((oneSeat) => oneSeat.card.stableId === oneNomination.candidateStableId)) {
										hooksDone(refuse.byName({ moduleName, what: `nomination ${nominationIndex} names stableId ${JSON.stringify(oneNomination.candidateStableId)}, which is not in the filtered pool`, where: 'the hook adds EVIDENCE, never a candidate' }).message);
										return;
									}
									hookState.nominatedByStableId[oneNomination.candidateStableId] = oneNomination.rationale;
								}
								afterNominate();
							});
						};
						withEvidenceHooks((hookError, hookState) => {
							if (hookError) {
								taskDone(`${moduleName}: ${hookError}`);
								return;
							}
							const decoratedPool = candidatePool.map((oneSeat) => (hookState.nominatedByStableId[oneSeat.card.stableId] !== undefined ? { ...oneSeat, nominatedBy: bridgeDeclaration.bridgeName, nominationRationale: hookState.nominatedByStableId[oneSeat.card.stableId] } : oneSeat));
							const question = evidenceRendererLib.renderQuestion({ sourceElement, candidatePool: decoratedPool, globalGuidanceList, perCandidateNoteByStableId: hookState.perCandidateNoteByStableId, promptSegmentList: hookState.promptSegmentList, judgePromptVariant, renderingAllowList: bridgeDeclaration.renderingAllowList });
							if (question.error) {
								taskDone(question.error.message);
								return;
							}
							judgeComponentLib.judgeOne({ question, judgeClient, judgmentCache: spec.judgmentCache, matchForensics: spec.matchForensics, budget, pairKey, generation, debugMark }, (judgeError, judged, judgeFault) => {
								if (judgeError) {
									// ⟪RULING 14:55 (a) THE NET⟫ a rationale-FORM refusal after its one re-ask names the SUBJECT in
									// refusalList and the run CARRIES ON. No edge, no default, and explicitly NOT recorded as an
									// abstention — the judge HAD an opinion and it is preserved in forensics; filing it as "no
									// opinion" would put a falsehood in the graph. Every other judge error still stops the run.
									if (isPlainObject(judgeFault) && judgeFault.kind === 'rationaleFormRefusedTwice') {
										report.refusalList.push({ kind: 'rationaleFormRefusedTwice', subjectStableId: oneTask.baseRecord.subjectStableId, promptHash: question.promptHash, detail: judgeError });
										taskDone('');
										return;
									}
									taskDone(judgeError);
									return;
								}
								report.discardedPredicateKeyCount += judged.discardedPredicateKeyCount;
								if (judged.cacheHit) {
									report.judgeSpend.servedFromCache += 1;
								} else {
									report.judgeSpend.asked += 1;
									if (Number.isInteger(judged.reaskCount) && judged.reaskCount > 0) {
										report.judgeSpend.rationaleReaskCount += judged.reaskCount;
									}
								}
								// the FROZEN judge record: evidence BY REFERENCE (promptHash, rendererVersion, judgeModel) + the ordinal and
								// category — never cacheHit / usage / attempts (run-variable; they live in the report and forensics)
								const judgeRecord = { promptHash: judged.promptHash, rendererVersion: runRendererVersion, judgeModel: judged.judgeModel, choice: judged.choice, category: judged.category };
								// a real abstention's SCHEMA-FORCED category rides in the frozen record only when present (RULING 2026-08-16, judgeComponent)
								if (judged.reportedCategoryOnAbstain !== undefined && judged.reportedCategoryOnAbstain !== null) {
									judgeRecord.reportedCategoryOnAbstain = judged.reportedCategoryOnAbstain;
								}
								if (judged.chosenCardStableId === null) {
									report.judgeSpend.abstained += 1;
									taskDone('', { ...oneTask.baseRecord, objectStableId: null, predicate: null, predicateAssertedBy: null, sourceLabel: null, confidence: null, abstained: true, judge: judgeRecord, renderedPoolStableIdList: question.renderedPoolStableIdList });
									return;
								}
								// WHERE A PICK'S PREDICATE COMES FROM is a registry keyed by the declared predicateSource.kind —
								// never a branch on matchBasis. For the three documentary kinds it comes from the SOURCE ROW
								// that named the picked card (a tentative row's predicateIfPicked, a predicate row's
								// predicate); the judge never names the relation. For kind 'judge' there IS no source row,
								// so the plugin's declared predicateByCategory table maps the judge's CATEGORY to a relation
								// — a v1 approximation, NAMED as such in the block header (predicateRule 'categoryTable-v1',
								// RULING §11.7 (a)) so a later judge with a real predicate slot re-measures rather than
								// silently differing. The mapping is total by construction: predicateByCategory is refused
								// at declaration time unless it names every judge category.
								const pickPredicateResolved = PICK_PREDICATE_RESOLVER_BY_SOURCE_KIND[bridgeDeclaration.predicateSource.kind]({ judged, oneTask, orderedAssertionList });
								if (pickPredicateResolved.error) {
									taskDone(pickPredicateResolved.error.message);
									return;
								}
								taskDone('', { ...oneTask.baseRecord, objectStableId: judged.chosenCardStableId, predicate: pickPredicateResolved.predicate, predicateAssertedBy: pickPredicateResolved.predicateAssertedBy, sourceLabel: pickPredicateResolved.sourceLabel, confidence: judged.confidence, abstained: false, judge: judgeRecord, renderedPoolStableIdList: question.renderedPoolStableIdList });
							});
						});
					};
					// ⟪JOB 1, 2026-09-07⟫ THE JUDGE RUNS AT THE SLOWER OF TWO CEILINGS. JUDGE_CONCURRENCY is what this
					// FRAMEWORK will drive; maxConcurrency is what THIS PROVIDER declares it can take (JUDGE_PROVIDER_SHAPE,
					// apps/graph-builder/interfaces.js). min(), never max(): a local model serving one request at a time must
					// BOUND the framework rather than be drowned by it. Refused BY NAME when absent or not a positive integer
					// — Math.min(4, undefined) is NaN, and a NaN concurrency is a defect that surfaces far from its cause.
					if (!Number.isInteger(judgeClient.maxConcurrency) || judgeClient.maxConcurrency < 1) {
						next(refuse.byName({ moduleName, what: `judge provider '${judgeClient.model}' declares maxConcurrency ${JSON.stringify(judgeClient.maxConcurrency)}`, where: 'every judge provider declares a positive-integer maxConcurrency (JUDGE_PROVIDER_SHAPE); the run drives the judge at min(JUDGE_CONCURRENCY, maxConcurrency) and there is no default' }).message);
						return;
					}
					boundedRunnerLib.runBounded({ itemList: args.judgedTaskList, concurrency: Math.min(JUDGE_CONCURRENCY, judgeClient.maxConcurrency), oneItem: judgeOneTask }, (runnerError, judgedRecordList) => {
						if (runnerError) {
							next(runnerError);
							return;
						}
						// ⟪RULING 14:55 (a)⟫ a subject refused for rationale FORM yields NO decision record — it is named in
						// refusalList instead — so the runner's slot for it is empty. Drop the empty slots BY NAME here
						// rather than letting an undefined ride into decisionRecordList, where it reaches the freeze and
						// the materialiser as a record with no fields. The count is reconciled against refusalList so a
						// hole from any OTHER cause cannot hide in this filter.
						const yieldedRecordList = judgedRecordList.filter((oneRecord) => oneRecord !== undefined && oneRecord !== null);
						const namedRefusalCount = report.refusalList.filter((oneRefusal) => oneRefusal.kind === 'rationaleFormRefusedTwice').length;
						if (judgedRecordList.length - yieldedRecordList.length !== namedRefusalCount) {
							next(refuse.byName({ moduleName, what: `${judgedRecordList.length - yieldedRecordList.length} judged task(s) yielded no record but only ${namedRefusalCount} subject(s) are named in refusalList`, where: 'every missing decision record must be accounted for by a NAMED refusal; an unexplained hole is refused, never filtered away' }).message);
							return;
						}
						say(`judged: ${yieldedRecordList.length} (asked ${report.judgeSpend.asked}, cache ${report.judgeSpend.servedFromCache}, abstained ${report.judgeSpend.abstained}, rationaleForm refused ${namedRefusalCount}; judge ${judgeKind})`);
						next('', { ...args, judgedRecordList: yieldedRecordList, judgeKind });
					});
				});

				// STEP 8 — FREEZE: header + census; save; then materialise from the block JUST FROZEN; export
				taskList.push((args, next) => {
					const decisionRecordList = args.decisionRecordList.concat(args.judgedRecordList);
					const uniquenessRefusal = materialiserLib.edgeUniquenessRefusal(decisionRecordList);
					if (uniquenessRefusal) {
						next(uniquenessRefusal.message);
						return;
					}
					const provisionalCensus = censusLib.cardinalityCensus({
						decisionRecordList,
						subjectCollisionList: args.subjectCollisionList,
						sourceGapList: args.sourceGapList,
						sentinelDroppedCount: args.sentinelDroppedCount,
						sentinelLabelledRowCount: args.sentinelLabelledRowCount,
						labelRefusedCount: args.labelRefusedCount,
						manyToOneSubjectCount: args.manyToOneSubjectCount,
						refusedValueTierAssertionCount: args.refusedValueTierAssertionCount,
						edgeCount: materialiserLib.pickedRecordList(decisionRecordList).length,
						contentionCensus: args.contention,
						indexCollisionCount: args.contention.contendedKeyCount,
					});
					const retrievalHeader = candidateRetrievalHeaderValueFor(bridgeDeclaration.candidateRetrieval);
					if (retrievalHeader.error) {
						next(retrievalHeader.error.message);
						return;
					}
					const header = {
						frameworkGeneration: decisionBlockLib.FRAMEWORK_GENERATION,
						frameworkFingerprint: decisionBlockLib.frameworkFingerprint(),
						rendererVersion: runRendererVersion,
						bridgeName: bridgeDeclaration.bridgeName,
						pluginVersion: bridgeDeclaration.pluginVersion,
						declarationDigest,
						labelTableDigest,
						remodelTableDigest: args.remodelTableDigest,
						matchBasis: bridgeDeclaration.matchBasis,
						producerKind: bridgeDeclaration.producerKind,
						judgeKind: args.judgeKind,
						// absent is absent: a documentary run stamps null rather than inventing a rule or a K
						predicateRule: bridgeDeclaration.predicateSource.predicateRule === undefined ? null : bridgeDeclaration.predicateSource.predicateRule,
						// the DECLARED object canonicalised by its method row (R-BR-7), or null for a basis that declares no retrieval
						candidateRetrieval: retrievalHeader.headerValue,
						subjectScopeDigest: args.scopeDigest === undefined ? null : args.scopeDigest,
						sourceWindow: args.windowMark === undefined ? null : args.windowMark,
						blindingDeclaration: bridgeDeclaration.blindingDeclaration.slice(),
						sourceStandardName,
						sourceVersion: String(sourceVersion),
						hubName: args.hubName,
						hubVersion: String(hubVersion),
						sourceChannelDigestByKey: args.sourceChannelDigestByKey,
						contentionCensus: args.contention,
						cardinalityCensus: provisionalCensus,
						generation,
					};
					const refusalList = report.refusalList.map((oneRefusal) => ({ ...oneRefusal }));
					const frozen = decisionBlockLib.frozenTextFor({ header, decisionRecordList, refusalList });
					if (frozen.error) {
						next(frozen.error.message);
						return;
					}
					const decisionBlockHash = decisionBlockLib.blockIdFor({ frozenText: frozen.frozenText });
					spec.decisionStore.saveDecisionBlock({ pairKey, frozenText: frozen.frozenText, decisionBlockHash }, (saveError, saved) => {
						if (saveError) {
							next(`${moduleName}: saveDecisionBlock FAILED (FATAL, never a warning — BR-069): ${saveError}`);
							return;
						}
						say(`froze decision block ${decisionBlockHash} (${saved.alreadyPresent ? 'already present — idempotent' : 'saved'}); census per subject ${JSON.stringify(provisionalCensus.perSubject)}`);
						const parsed = decisionBlockLib.parseFrozenText(frozen.frozenText);
						if (parsed.error) {
							next(parsed.error.message);
							return;
						}
						next('', { ...args, frozenBlock: parsed.block, decisionBlockHash });
					});
				});
				taskList.push((args, next) => {
					args.reader.close((closeError) => {
						if (closeError) {
							next(closeError);
							return;
						}
						materialiseAndReport({ block: args.frozenBlock, decisionBlockHash: args.decisionBlockHash, exportSssom: true, cardByStableId: args.cardByStableId }, (tailError, tail) => (tailError ? next(tailError) : next('', { ...args, ...tail })));
					});
				});
				pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
					if (pipelineError) {
						callback(pipelineError);
						return;
					}
					callback('', args.runReport);
				});
			};

			if (mode === MODE_MATERIALISE) {
				materialiseMode();
			} else {
				rejudgeMode();
			}
		};

		// -----------------------------------------------------------------
		// the public surface (§3.3)
		// -----------------------------------------------------------------
		// describeBridge — READ a registered plugin's declaration WITHOUT running it, so build.js can refuse a
		// colliding recipe BEFORE PHASE A (RULING FJ-P7-1), so it costs neither a forge nor a judge. It exists
		// because the orchestrator never
		// sees a declaration: it passes a bridge NAME to run() and the lookup happens in here.
		//
		// IT TAKES `source` BECAUSE lookupPlugin REQUIRES IT — a plugin runs only for the standard it sits
		// under (BR-009), and the recipe entry's source is the value the run itself would be checked against.
		// Resolving without it would let this pre-check pass on a pairing that run() would later refuse, which
		// is worse than not checking at all.
		//
		// Returns { description } or { error }. Never throws, and never substitutes a default for an
		// unregistered name — the refusal names the bridge and lists what IS registered.
		const describeBridge = ({ bridgeName, source } = {}) => {
			const looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName, standardKey: source });
			if (looked.error) {
				return { error: looked.error.message };
			}
			const declaration = looked.entry.bridgeDeclaration;
			return {
				description: Object.freeze({
					bridgeName: declaration.bridgeName,
					source: declaration.standardKey,
					producerKind: declaration.producerKind,
					// UNDECLARED IS `undefined`, carried through as-is. A `null` here would read as "declared
					// nothing" and compare equal between two plugins that had each declared nothing — which is
					// exactly the tuple comparison the caller performs, so the distinction is load-bearing.
					subjectDiscriminator: declaration.subjectDiscriminator,
				}),
			};
		};

		return {
			run,
			describeBridge,
			registerPlugin: pluginRegistryLib.registerPlugin,
			contracts: Object.freeze({
				BRIDGE_DECLARATION_CONTRACT: bridgePluginContractLib.BRIDGE_DECLARATION_CONTRACT,
				BRIDGE_HOOK_CONTRACT: bridgePluginContractLib.BRIDGE_HOOK_CONTRACT,
				MATCH_BASIS_LIST,
				PRODUCER_KIND_LIST,
				RESOLUTION_LIST,
				CLASSIFICATION_REGISTRY: classificationLib.CLASSIFICATION_REGISTRY,
				CLASSIFICATION_LIST: classificationLib.CLASSIFICATION_LIST,
				PREDICATE_SOURCE_KIND_LIST,
				PREDICATE_ASSERTED_BY_LIST,
				LABEL_DISPOSITION_LIST,
				TRANSFORM_REGISTRY: transformRegistryLib.TRANSFORM_REGISTRY,
				RUN_CONFIG_KEY_LIST,
				RUN_REPORT_RESULT_KEYS,
				CONFIDENCE_BAND_TABLE: confidenceBandTableLib.CONFIDENCE_BAND_TABLE,
				BRIDGE_ALLOWANCE_REGISTRY: bridgeAllowanceRegistryLib.BRIDGE_ALLOWANCE_REGISTRY,
				SEAT_REASON_LIST: representationPolicyLib.SEAT_REASON_LIST,
				SEAM_SPEC_KEY_LIST,
				DEP_NAME_LIST,
			}),
			constants: Object.freeze({
				FRAMEWORK_GENERATION: decisionBlockLib.FRAMEWORK_GENERATION,
				RENDERER_VERSION: evidenceRendererLib.RENDERER_VERSION,
				JUDGE_CONCURRENCY,
				MAX_JUDGMENT_COUNT_PER_RUN,
				PROPERTY_TIER,
			}),
			census: Object.freeze({ cardinalityCensus: censusLib.cardinalityCensus, contentionCensus: censusLib.contentionCensus }),
			decisionBlock: Object.freeze({ frozenTextFor: decisionBlockLib.frozenTextFor, blockIdFor: decisionBlockLib.blockIdFor, parseFrozenText: decisionBlockLib.parseFrozenText, canonicalText: decisionBlockLib.canonicalText, HEADER_KEY_ORDER: decisionBlockLib.HEADER_KEY_ORDER }),
			frameworkFingerprint: decisionBlockLib.frameworkFingerprint,
			refuse: Object.freeze({ byName: refuse.byName }),
			judge: Object.freeze({ judgeOne: judgeComponentLib.judgeOne }),
			exporter: Object.freeze({ toSssomTsv: sssomExporterLib.toSssomTsv, parseSssomTsv: sssomExporterLib.parseSssomTsv }),
			renderer: Object.freeze({ renderQuestion: evidenceRendererLib.renderQuestion }),
			vocabulary: Object.freeze({ SKOS_EDGE_TYPES, MAPPING_PROPERTIES }),
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
