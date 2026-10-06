'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// candidateRetrievalMethodRegistry.js — WHO GETS ON THE JUDGE'S SHORTLIST, DECIDED BY DATA (lane C, 2026-10-01,
// DESIGN-C-candidateRegistry.md; supervisor QUIET_ORBIT). The judge's AI has been a registry since
// judgeProviderRegistry JOB 4; candidate retrieval already was one too, but it was buried in bridge-framework.js and
// its field lists were stated a second time in bridgePluginContract.js. This file is now the ONE home of every
// retrieval method. A new method is A NEW ROW HERE, and nothing else: the contract reads its field list from the
// row, and the orchestrator runs it through the row.
//
//   CANDIDATE_RETRIEVAL_METHOD_ROW_LIST        ordered rows; the row IS the method
//   KNOWN_METHOD_NAME_LIST                     derived from the rows, never restated
//   methodRowFor(retrievalDeclaration)         → { methodRow } | { error }   absent and unregistered methods refused by name
//   poolForSubjectChecked({ methodRow, ...})   → the row's pool, VALIDATED (the shape below) | { error }
//   registryViolation()                        → null | Error   the rows' own contract, checked at framework construction
//
// ⟪CANDIDATE_RETRIEVAL_METHOD_ROW_SHAPE⟫ — what a method implements. Every row carries EXACTLY these members:
//   methodName                 the string a plugin declares as candidateRetrieval.method; unique across rows
//   fieldNameList              the declared parameters, in the order the block header freezes them (R-BR-7). EVERY
//                              field is required (the contract refuses absence; there are no defaults) and each has
//                              a value rule in the contract's CANDIDATE_RETRIEVAL_FIELD_RULE_REGISTRY
//   recordTraceFieldNameList   the trace fields every record of this method carries, SORTED; a pool whose trace
//                              names any other set is refused
//   settingsPairListFor(retrievalDeclaration) → [[label, value], …] what the run log prints
//   prepareRetrieval(retrievalContext, callback)  every read, index and (for a method that asks an AI) every call,
//                              ONCE per run, error-first → callback(errorText, retrievalState); the state always
//                              carries hubVectorIndex. retrievalContext = { retrievalView, evidenceView,
//                              retrievalDeclaration, hubName, sourceStandardName, subjectLabel, subjectNodeList,
//                              windowedNodeList }
//   mappingMethodFor({ retrievalState }) → the SSSOM justification a judged record carries (a vocabulary one)
//   poolForSubject({ retrievalState, retrievalDeclaration, subjectStableId, hubName })
//                              SYNCHRONOUS and pure over the state → { seatStableIdList, recordTraceByFieldName } |
//                              { error }: one subject's seats in RANK order (the framework re-sorts them by stableId
//                              before rendering, so rank never reaches the judge), and its frozen trace
//
// WHY poolForSubject IS SYNCHRONOUS, and stays so for a method that asks an AI (the class-tree method, design §4):
// everything that waits happens in prepareRetrieval, over the run's whole window, so the per-subject step is a lookup.
// That keeps one call protocol for every row and keeps the orchestrator's per-subject loop free of concurrency.
//
// The two rows below MOVED here verbatim from bridge-framework.js (the members renamed only: headerFieldNameList is
// now fieldNameList, because it is the contract's list too; methodName and recordTraceFieldNameList are new). Their
// pools, traces and prompts are byte-identical to before; test/candidateRegistryIdentity proves it over the toy, and
// the lane C DEVLOG records the real-standard comparison.

const path = require('path');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const candidateRetrievalLib = require('./candidateRetrieval');
const neighbourVoteLib = require('./neighbourVote');

const { DME_ROLES, HUB_DECOMPOSITION_SLOTS, SSSOM_JUSTIFICATIONS, REFERENCE_TIER, hubEdgeType } = vocabularyLib;
// the card tier every method reads: the 3-slot property cards (vocabulary.REFERENCE_TIER)
const PROPERTY_TIER = REFERENCE_TIER.PROPERTY;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonBlank = (value) => typeof value === 'string' && value.trim() !== '';
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);

// the justification a RETRIEVED mapping carries (RULING §11.7 (b), adopted into vocabulary.SSSOM_JUSTIFICATIONS
// as a recorded specification change). Named here rather than inlined so the exporter and the edge builder
// cannot drift apart.
const SEMANTIC_SIMILARITY_JUSTIFICATION = 'semapv:SemanticSimilarityThresholdMatching';
// the members CANDIDATE_RETRIEVAL_METHOD_ROW_SHAPE names (header above); registryViolation holds every row to exactly these
const RETRIEVAL_METHOD_ROW_MEMBER_LIST = Object.freeze(['methodName', 'fieldNameList', 'recordTraceFieldNameList', 'settingsPairListFor', 'prepareRetrieval', 'mappingMethodFor', 'poolForSubject']);
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
		mappingMethod: SEMANTIC_SIMILARITY_JUSTIFICATION,
		readReferenceEdgeList: (unusedReadArguments, callback) => callback('', []),
		frozenTraceFor: (neighbourTrace) => (neighbourTrace === null ? { neighbourTrace: null } : { error: refuse.byName({ moduleName, what: 'a votes-only rank returned a neighbourTrace', where: 'neighbourVote: null ranks by votes alone and names no neighbour (SPEC-bridgeRevision §5, invariant 7)' }) }),
	}),
	'neighbourVote-v1': Object.freeze({
		mappingMethod: COMPOSITE_MATCHING_JUSTIFICATION,
		readReferenceEdgeList: ({ neighbourVote, evidenceView }, callback) => REFERENCE_EDGE_READ_BY_KIND[neighbourVote.referencedObject.kind]({ referencedObjectDeclaration: neighbourVote.referencedObject, evidenceView }, callback),
		frozenTraceFor: frozenNeighbourTraceFor,
	}),
});
const neighbourScoringRowFor = (neighbourVote) => {
	const scoringRowName = neighbourScoringRowNameOf(neighbourVote);
	return hasOwn(NEIGHBOUR_SCORING_REGISTRY, scoringRowName)
		? { scoringRow: NEIGHBOUR_SCORING_REGISTRY[scoringRowName] }
		: { error: refuse.byName({ moduleName, what: `candidateRetrieval.neighbourVote names method ${JSON.stringify(scoringRowName)}, which has no NEIGHBOUR_SCORING_REGISTRY row`, where: 'a neighbour scoring method is a row in candidateRetrievalMethodRegistry.js plus its gate (SPEC-bridgeRevision §5)' }) };
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

const CANDIDATE_RETRIEVAL_METHOD_ROW_LIST = Object.freeze([
	// cosineTopK-v1 — the subject's own vector against every card, top K at or above the floor. Byte-unchanged in
	// behaviour from before the registry existed: the same two reads in the same order, the same pool, the same trace.
	Object.freeze({
		methodName: 'cosineTopK-v1',
		fieldNameList: Object.freeze(['method', 'k', 'floor', 'embeddingModelVersion']),
		recordTraceFieldNameList: Object.freeze(['retrievalSeatList']),
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
		mappingMethodFor: () => SEMANTIC_SIMILARITY_JUSTIFICATION,
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
	Object.freeze({
		methodName: 'embedTextVote-v1',
		fieldNameList: Object.freeze(['method', 'hitsPerText', 'minScore', 'k', 'embeddingModelVersion', 'neighbourVote']),
		recordTraceFieldNameList: Object.freeze(['neighbourTrace', 'retrievalVoteList']),
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
		mappingMethodFor: ({ retrievalState }) => retrievalState.scoringRow.mappingMethod,
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
]);
// KNOWN_METHOD_NAME_LIST — DERIVED. Every refusal that lists the methods reads this.
const KNOWN_METHOD_NAME_LIST = Object.freeze(CANDIDATE_RETRIEVAL_METHOD_ROW_LIST.map((oneRow) => oneRow.methodName));

// methodRowFor — the declared method's row. NO DEFAULT: a declaration that names no method is refused by name rather
// than read as one of the rows (the contract refuses it first in a real run; this is the registry's own guard).
const methodRowFor = (retrievalDeclaration) => {
	if (!isPlainObject(retrievalDeclaration) || !isNonBlank(retrievalDeclaration.method)) {
		return { error: refuse.byName({ moduleName, what: `no candidate retrieval method is named (candidateRetrieval is ${JSON.stringify(retrievalDeclaration)})`, where: `declare candidateRetrieval.method as one of: ${KNOWN_METHOD_NAME_LIST.join(', ')}; there is no default` }) };
	}
	const methodRow = CANDIDATE_RETRIEVAL_METHOD_ROW_LIST.find((oneRow) => oneRow.methodName === retrievalDeclaration.method);
	return methodRow !== undefined
		? { methodRow }
		: { error: refuse.byName({ moduleName, what: `candidateRetrieval.method ${JSON.stringify(retrievalDeclaration.method)} is not a registered candidate retrieval method (registered: ${KNOWN_METHOD_NAME_LIST.join(', ')})`, where: 'a method is a row in candidateRetrievalMethodRegistry.js; it is refused by name, never run as another row' }) };
};

// poolViolation — '' when a row's poolForSubject result has the declared shape, else what is wrong. It never repairs:
// a malformed pool is a defective method, and the run refuses rather than judging a list nobody can account for.
const POOL_RESULT_FIELD_NAME_LIST = Object.freeze(['recordTraceByFieldName', 'seatStableIdList']);
const poolViolation = ({ methodRow, pooled }) => {
	if (!isPlainRecord(pooled)) {
		return `returned ${pooled === null ? 'null' : Array.isArray(pooled) ? 'an array' : `a ${typeof pooled}`}, not a plain { ${POOL_RESULT_FIELD_NAME_LIST.join(', ')} } record`;
	}
	if (fieldNameTextOf(pooled) !== POOL_RESULT_FIELD_NAME_LIST.join(', ')) {
		return `returned { ${fieldNameTextOf(pooled)} }, not { ${POOL_RESULT_FIELD_NAME_LIST.join(', ')} }`;
	}
	const { seatStableIdList, recordTraceByFieldName } = pooled;
	if (!Array.isArray(seatStableIdList)) {
		return `returned seatStableIdList ${JSON.stringify(seatStableIdList)}, not a list`;
	}
	const blankSeatIndex = seatStableIdList.findIndex((oneSeatStableId) => !isNonBlank(oneSeatStableId));
	if (blankSeatIndex !== -1) {
		return `returned seatStableIdList[${blankSeatIndex}] ${JSON.stringify(seatStableIdList[blankSeatIndex])}, not a card stableId`;
	}
	const duplicatedSeatStableId = seatStableIdList.find((oneSeatStableId, seatIndex) => seatStableIdList.indexOf(oneSeatStableId) !== seatIndex);
	if (duplicatedSeatStableId !== undefined) {
		return `seats card ${duplicatedSeatStableId} twice; one card holds at most one seat in a pool`;
	}
	if (!isPlainRecord(recordTraceByFieldName)) {
		return 'returned a recordTraceByFieldName that is not a plain record (a Map would freeze as {})';
	}
	if (fieldNameTextOf(recordTraceByFieldName) !== methodRow.recordTraceFieldNameList.join(', ')) {
		return `returned trace fields { ${fieldNameTextOf(recordTraceByFieldName)} } where its row declares { ${methodRow.recordTraceFieldNameList.join(', ')} }`;
	}
	return '';
};

// poolForSubjectChecked — the ONE way the orchestrator asks a row for a pool. The row's own refusal passes through.
const poolForSubjectChecked = ({ methodRow, retrievalState, retrievalDeclaration, subjectStableId, hubName }) => {
	const pooled = methodRow.poolForSubject({ retrievalState, retrievalDeclaration, subjectStableId, hubName });
	if (isPlainObject(pooled) && pooled.error !== undefined) {
		return { error: pooled.error };
	}
	const violation = poolViolation({ methodRow, pooled });
	return violation === ''
		? pooled
		: { error: refuse.byName({ moduleName, what: `candidate retrieval method '${methodRow.methodName}' ${violation} for subject ${subjectStableId}`, where: 'CANDIDATE_RETRIEVAL_METHOD_ROW_SHAPE: poolForSubject returns { seatStableIdList, recordTraceByFieldName } with distinct card stableIds and exactly its declared trace fields' }) };
};

// registryViolation — the rows' own contract, checked ONCE at framework construction, beside producerSuffixRefusal: a
// malformed row is a framework defect, refused before any run can reach it
const registryViolation = () => {
	const refuseRegistry = (what, where) => refuse.byName({ moduleName, what, where });
	const memberListText = RETRIEVAL_METHOD_ROW_MEMBER_LIST.slice().sort(compareStrings).join(', ');
	if (!Array.isArray(CANDIDATE_RETRIEVAL_METHOD_ROW_LIST) || CANDIDATE_RETRIEVAL_METHOD_ROW_LIST.length === 0) {
		return refuseRegistry('CANDIDATE_RETRIEVAL_METHOD_ROW_LIST is empty or not a list', 'a derived basis needs at least one retrieval method');
	}
	const malformedRowIndex = CANDIDATE_RETRIEVAL_METHOD_ROW_LIST.findIndex((oneRow) => !isPlainObject(oneRow) || fieldNameTextOf(oneRow) !== memberListText);
	if (malformedRowIndex !== -1) {
		return refuseRegistry(`CANDIDATE_RETRIEVAL_METHOD_ROW_LIST[${malformedRowIndex}] carries { ${isPlainObject(CANDIDATE_RETRIEVAL_METHOD_ROW_LIST[malformedRowIndex]) ? fieldNameTextOf(CANDIDATE_RETRIEVAL_METHOD_ROW_LIST[malformedRowIndex]) : String(CANDIDATE_RETRIEVAL_METHOD_ROW_LIST[malformedRowIndex])} }`, `every method row carries exactly { ${memberListText} }`);
	}
	const memberKindFaultList = CANDIDATE_RETRIEVAL_METHOD_ROW_LIST.reduce((soFar, oneRow, rowIndex) => {
		const rowLabel = isNonBlank(oneRow.methodName) ? `'${oneRow.methodName}'` : `[${rowIndex}]`;
		const listFault = ['fieldNameList', 'recordTraceFieldNameList'].find((oneMemberName) => !Array.isArray(oneRow[oneMemberName]) || oneRow[oneMemberName].length === 0 || !oneRow[oneMemberName].every(isNonBlank));
		const functionFault = ['settingsPairListFor', 'prepareRetrieval', 'mappingMethodFor', 'poolForSubject'].find((oneMemberName) => typeof oneRow[oneMemberName] !== 'function');
		return soFar
			.concat(isNonBlank(oneRow.methodName) ? [] : [`row ${rowLabel} methodName is not a non-empty string`])
			.concat(listFault === undefined ? [] : [`row ${rowLabel} ${listFault} is not a non-empty list of names`])
			.concat(functionFault === undefined ? [] : [`row ${rowLabel} ${functionFault} is not a function`])
			.concat(Array.isArray(oneRow.fieldNameList) && oneRow.fieldNameList[0] !== 'method' ? [`row ${rowLabel} fieldNameList does not begin with 'method'`] : [])
			.concat(Array.isArray(oneRow.recordTraceFieldNameList) && oneRow.recordTraceFieldNameList.join(', ') !== oneRow.recordTraceFieldNameList.slice().sort(compareStrings).join(', ') ? [`row ${rowLabel} recordTraceFieldNameList is not sorted`] : []);
	}, []);
	if (memberKindFaultList.length) {
		return refuseRegistry(memberKindFaultList.join('; '), 'CANDIDATE_RETRIEVAL_METHOD_ROW_SHAPE in candidateRetrievalMethodRegistry.js');
	}
	const duplicatedMethodName = KNOWN_METHOD_NAME_LIST.find((oneMethodName, nameIndex) => KNOWN_METHOD_NAME_LIST.indexOf(oneMethodName) !== nameIndex);
	if (duplicatedMethodName !== undefined) {
		return refuseRegistry(`CANDIDATE_RETRIEVAL_METHOD_ROW_LIST names method '${duplicatedMethodName}' twice`, 'one declared method name, one row; two rows sharing a name would run whichever was found first');
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


module.exports = Object.freeze({
	CANDIDATE_RETRIEVAL_METHOD_ROW_LIST,
	KNOWN_METHOD_NAME_LIST,
	RETRIEVAL_METHOD_ROW_MEMBER_LIST,
	HUB_SLOT_BY_SLOT_KIND,
	BASE_ROLE_BY_BASE_KIND,
	methodRowFor,
	poolForSubjectChecked,
	registryViolation,
	moduleName,
});
