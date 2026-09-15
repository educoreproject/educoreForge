'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// toyEmbedTextScenario.js — TEST SUPPORT: the hand-checkable toy for the text-node lookup (candidateRetrieval.js,
// embedTextVote-v1) and neighbour-vote scoring (neighbourVote.js), shared by test-bgEts.js and
// test-neighbourVote.js. No graph, no container, no embedder: every vector is a literal.
//
//   makeToyEmbedText()                      → a FRESH copy of the toy inputs (a fault may be written into it)
//   makeScenario() / cloneScenario(s)       → the gate subject: { frameworkMutationList, containmentSourceByFileName }
//   loadEmbedTextModules(scenario)          → the two modules, compiled through moduleDouble when a twin mutated them
//   runToyPipeline({ scenario, toy?, reverseInput?, neighbourVoteOverride?, subjectStableIdListOverride? })
//                                           → { resultBySubjectStableId, searchMemo, embedTextIndex, cardSlotIndex } | { error }
//   projectRun(run)                         → the run as canonical JSON (for byte-identity comparisons)
//   EXPECTED_BY_SUBJECT, EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID — DERIVED BY HAND, see below
//
// THE VECTORS live on seven named axes so every cosine can be done on paper:
//   0 telephone number · 1 person · 2 name · 3 organization · 4 status · 5 telephone type · 6 code list
// A cosine of 1/√2 is 0.7071, 1/2 is 0.5, 1/√5 is 0.4472, 2/√5 is 0.8944, 3/√10 is 0.9487, 1/√10 is 0.3162,
// 4/√17 is 0.9701, 1/√17 is 0.2425. Settings: hitsPerText 3, minScore 0.30, k 15.
//
// WHAT THE TOY CARRIES (the brief's list, each one named where it is built):
//   a subject text shared by two of its properties ........ t1, propertyNameList ['description', 'name']
//   a card admitted through its property hit .............. Telephone.TelephoneType: h10 admits it; its class and
//                                                           option-set paths alone would not
//   cards reachable only through class or option-set hits . Organization.Name, Person.Name (class), Staff.PhoneType (option set)
//   a neighbour hitting an option-set base node ........... Applicant.PhoneKindCode (k1 → the TelephoneType option set)
//   an owner, three siblings, one referenced object ....... Applicant; Name, PhoneKindCode, Status; Telephone
//   ties resolved by stableId ............................. t4's third hit (h02 vs h11, both 0.5); Applicant.Name's
//                                                           votes-only rank (three cards at 1 vote, cosine 1.0)

const path = require('path');
const moduleDouble = require(path.join(__dirname, '..', '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const FRAMEWORK_DIR = path.resolve(__dirname, '..', '..');
const CANDIDATE_RETRIEVAL_PATH = path.join(FRAMEWORK_DIR, 'candidateRetrieval.js');
const NEIGHBOUR_VOTE_PATH = path.join(FRAMEWORK_DIR, 'neighbourVote.js');

const TOY_EMBEDDING_MODEL_VERSION = 'toy-embed-text-v1';
const TOY_SETTINGS = Object.freeze({ hitsPerText: 3, minScore: 0.3, k: 15 });
const TOY_SLOT_NAME_BY_SLOT_KIND = Object.freeze({ property: 'HAS_TOYHUB_PROPERTY', domain: 'HAS_TOYHUB_DOMAIN', range: 'HAS_TOYHUB_RANGE' });
const TOY_BASE_ROLE_BY_BASE_KIND = Object.freeze({ class: 'ToyClassRole', property: 'ToyPropertyRole', optionSet: 'ToyOptionSetRole' });
const TOY_NEIGHBOUR_VOTE = Object.freeze({ method: 'neighbourVote-v1', owner: { kind: 'propertyValue', property: 'parentId' }, siblings: { kind: 'sameOwner' }, referencedObject: { kind: 'edgeTarget', edgeTypeList: ['REFERENCES'] }, earnRule: 'topShare' });

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------------------------------------
// THE HUB — base nodes, their text nodes, and the property-tier cards built from them
// ---------------------------------------------------------------------------------------------------------
const classId = (className) => `toyhub/class/${className}`;
const propertyId = (propertyName) => `toyhub/property/${propertyName}`;
const optionSetId = (optionSetName) => `toyhub/optionSet/${optionSetName}`;
const cardId = (cardName) => `toyhub/card/${cardName}`;
const baseIdByKind = { class: classId, property: propertyId, optionSet: optionSetId };

// [textName, vector, [[baseKind, baseName], ...]] — the hNN prefix fixes stableId order for the ties
const HUB_TEXT_ROW_LIST = [
	['h01TelephoneNumber', [1, 0, 0, 0, 0, 0, 0], [['property', 'TelephoneNumber']]],
	['h02HasTelephone', [1, 1, 0, 0, 0, 0, 0], [['property', 'HasTelephone']]],
	['h03Person', [0, 1, 0, 0, 0, 0, 0], [['class', 'Person']]],
	['h04Name', [0, 0, 1, 0, 0, 0, 0], [['property', 'Name']]],
	['h05Organization', [0, 0, 0, 1, 0, 0, 0], [['class', 'Organization']]],
	['h06Telephone', [1, 0, 0, 0, 0, 1, 0], [['class', 'Telephone']]],
	['h07TelephoneTypeCodeList', [0, 0, 0, 0, 0, 1, 1], [['optionSet', 'TelephoneType']]],
	// ONE hub text describing TWO base nodes, a property and an option set
	['h08Status', [0, 0, 0, 0, 1, 0, 0], [['property', 'Status'], ['optionSet', 'StatusCode']]],
	['h09OrganizationEmail', [0, 0, 0, 4, 0, 1, 0], [['property', 'Email']]],
	['h10TelephoneType', [0, 0, 0, 0, 0, 1, 0], [['property', 'TelephoneType']]],
	['h11PhoneKind', [0, 0, 1, 0, 1, 0, 0], [['property', 'PhoneKind']]],
];

// [cardName, domainClass, property, range: [baseKind, baseName] | null]. Staff.PhoneType's property has no text.
const CARD_ROW_LIST = [
	['Organization.Email', 'Organization', 'Email', null],
	['Organization.Name', 'Organization', 'Name', null],
	['Organization.PhoneKind', 'Organization', 'PhoneKind', ['optionSet', 'TelephoneType']],
	['Person.HasTelephone', 'Person', 'HasTelephone', ['class', 'Telephone']],
	['Person.Name', 'Person', 'Name', null],
	['Person.Status', 'Person', 'Status', ['optionSet', 'StatusCode']],
	['Staff.Name', 'Staff', 'Name', null],
	['Staff.PhoneType', 'Staff', 'StaffPhoneType', ['optionSet', 'TelephoneType']],
	['Telephone.TelephoneNumber', 'Telephone', 'TelephoneNumber', null],
	['Telephone.TelephoneType', 'Telephone', 'TelephoneType', ['optionSet', 'TelephoneType']],
];

// ---------------------------------------------------------------------------------------------------------
// THE SOURCE STANDARD — subjects, their owner and siblings, the referenced object, and their text nodes
// ---------------------------------------------------------------------------------------------------------
const SUBJECT_TELEPHONE = 'src/property/Applicant.Telephone';
const SUBJECT_NAME = 'src/property/Applicant.Name';
const OWNER_APPLICANT = 'src/class/Applicant';
const SIBLING_STATUS = 'src/property/Applicant.Status';
const SIBLING_PHONE_KIND_CODE = 'src/property/Applicant.PhoneKindCode';
const REFERENCED_TELEPHONE = 'src/class/Telephone';

// [textName, describedStableId, propertyNameList, vector]
const SOURCE_TEXT_ROW_LIST = [
	['t1Telephone', SUBJECT_TELEPHONE, ['description', 'name'], [1, 0, 0, 0, 0, 0, 0]],
	['t2ApplicantTelephone', SUBJECT_TELEPHONE, ['shortDescription'], [1, 2, 0, 0, 0, 0, 0]],
	['t3KindOfTelephone', SUBJECT_TELEPHONE, ['comment'], [0, 0, 0, 0, 0, 1, 0]],
	['t4ApplicantStatusTelephone', SUBJECT_TELEPHONE, ['documentation'], [0, 1, 0, 0, 1, 0, 0]],
	['t5OrganizationContact', SUBJECT_TELEPHONE, ['definition'], [0, 0, 0, 4, 0, 1, 0]],
	['o1Applicant', OWNER_APPLICANT, ['name'], [0, 1, 0, 0, 0, 0, 0]],
	['n1Name', SUBJECT_NAME, ['name'], [0, 0, 1, 0, 0, 0, 0]],
	['s1Status', SIBLING_STATUS, ['name'], [0, 0, 0, 0, 1, 0, 0]],
	['k1PhoneKindCode', SIBLING_PHONE_KIND_CODE, ['name'], [0, 0, 0, 0, 0, 0, 1]],
	['r1TelephoneCommon', REFERENCED_TELEPHONE, ['name'], [1, 0, 0, 0, 0, 1, 0]],
];

const makeToyEmbedText = () => {
	const hubTextRecordList = HUB_TEXT_ROW_LIST.reduce(
		(soFar, [textName, vector, baseRowList]) =>
			soFar.concat(baseRowList.map(([baseKind, baseName]) => ({ textStableId: `toyhub/embedText/${textName}`, vector: vector.slice(), embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION, sourceStableId: baseIdByKind[baseKind](baseName), propertyNameList: ['name'] }))),
		[],
	);
	const cardSlotEdgeList = CARD_ROW_LIST.reduce((soFar, [cardName, domainClassName, propertyName, rangeRow]) => {
		const edgeList = [
			{ cardStableId: cardId(cardName), slot: TOY_SLOT_NAME_BY_SLOT_KIND.domain, baseStableId: classId(domainClassName), baseRole: TOY_BASE_ROLE_BY_BASE_KIND.class },
			{ cardStableId: cardId(cardName), slot: TOY_SLOT_NAME_BY_SLOT_KIND.property, baseStableId: propertyId(propertyName), baseRole: TOY_BASE_ROLE_BY_BASE_KIND.property },
		];
		return soFar.concat(rangeRow === null ? edgeList : edgeList.concat([{ cardStableId: cardId(cardName), slot: TOY_SLOT_NAME_BY_SLOT_KIND.range, baseStableId: baseIdByKind[rangeRow[0]](rangeRow[1]), baseRole: TOY_BASE_ROLE_BY_BASE_KIND[rangeRow[0]] }]));
	}, []);
	const sourceTextRecordList = SOURCE_TEXT_ROW_LIST.map(([textName, describedStableId, propertyNameList, vector]) => ({ textStableId: `src/embedText/${textName}`, vector: vector.slice(), embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION, sourceStableId: describedStableId, propertyNameList: propertyNameList.slice() }));
	const propertyNode = (stableId, parentId) => ({ stableId, labels: ['ToySourceProperty'], properties: parentId === null ? { name: stableId } : { name: stableId, parentId } });
	const siblingPopulationByStableId = [
		propertyNode(SUBJECT_TELEPHONE, OWNER_APPLICANT),
		propertyNode(SUBJECT_NAME, OWNER_APPLICANT),
		propertyNode(SIBLING_STATUS, OWNER_APPLICANT),
		propertyNode(SIBLING_PHONE_KIND_CODE, OWNER_APPLICANT),
		propertyNode('src/property/Staffer.Name', 'src/class/Staffer'), // another owner: never a sibling here
		propertyNode('src/property/Unowned.Note', null), // no owner property at all: never a sibling, never a refusal
	].reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});
	return {
		embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION,
		settings: { ...TOY_SETTINGS },
		slotNameBySlotKind: { ...TOY_SLOT_NAME_BY_SLOT_KIND },
		baseRoleByBaseKind: { ...TOY_BASE_ROLE_BY_BASE_KIND },
		neighbourVote: cloneJson(TOY_NEIGHBOUR_VOTE),
		hubTextRecordList,
		cardSlotEdgeList,
		sourceTextRecordList,
		siblingPopulationByStableId,
		sourceStableIdList: Object.keys(siblingPopulationByStableId).concat([OWNER_APPLICANT, 'src/class/Staffer', REFERENCED_TELEPHONE]),
		referenceEdgeList: [
			{ fromStableId: SUBJECT_TELEPHONE, toStableId: REFERENCED_TELEPHONE, type: 'REFERENCES' },
			{ fromStableId: SUBJECT_TELEPHONE, toStableId: OWNER_APPLICANT, type: 'DESCRIBES' }, // not a declared reference type
			{ fromStableId: 'src/property/Staffer.Name', toStableId: REFERENCED_TELEPHONE, type: 'REFERENCES' }, // not from a subject here
		],
		subjectStableIdList: [SUBJECT_TELEPHONE, SUBJECT_NAME],
	};
};

// ---------------------------------------------------------------------------------------------------------
// EXPECTED — DERIVED BY HAND from the vectors above (the cosine arithmetic is in each comment), NOT captured
// from a run of the code under test. A disagreement between these literals and the modules is investigated,
// never resolved by pasting the modules' output here.
// ---------------------------------------------------------------------------------------------------------
// Hits per searched text (cap 3, floor 0.30):
//   t1 [h01 1.0, h02 .7071, h06 .7071]            ties h02/h06 by stableId
//   t2 [h02 .9487, h03 .8944, h01 .4472]          h06 .3162 is above the floor and CUT BY THE CAP
//   t3 [h10 1.0, h06 .7071, h07 .7071]            h09 .2425 is BELOW THE FLOOR
//   t4 [h03 .7071, h08 .7071, h02 .5]             h11 .5 ties h02 at the cap boundary and loses on stableId
//   t5 [h09 1.0, h05 .9701]
//   o1 [h03 1.0, h02 .7071]   n1 [h04 1.0, h11 .7071]   s1 [h08 1.0, h11 .7071]   k1 [h07 .7071]
//   r1 [h06 1.0, h01 .7071, h10 .7071]            h02 .5 and h07 .5 cut by the cap
const EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID = Object.freeze({
	'src/embedText/t1Telephone': 3,
	'src/embedText/t2ApplicantTelephone': 3,
	'src/embedText/t3KindOfTelephone': 3,
	'src/embedText/t4ApplicantStatusTelephone': 3,
	'src/embedText/t5OrganizationContact': 2,
	'src/embedText/o1Applicant': 2,
	'src/embedText/n1Name': 2,
	'src/embedText/s1Status': 2,
	'src/embedText/k1PhoneKindCode': 1,
	'src/embedText/r1TelephoneCommon': 3,
});

// Applicant.Telephone, walked:
//   Person.HasTelephone      t1 (property h02, range h06) t2 (property h02 .9487, domain h03) t3 (range h06) t4 (domain h03, property h02) → 4 votes, best .9487
//   Telephone.TelephoneNumber t1 (property h01 1.0 AND domain h06: one text, two paths, two property names) t2 (property h01) t3 (domain h06) → 3, best 1.0
//   Telephone.TelephoneType  t1 (domain h06) t3 (property h10 1.0, domain h06, range h07) → 2, best 1.0
//   Person.Status            t2 (domain h03 .8944) t4 (domain h03, property h08, range h08's option set) → 2, best .8944
//   Organization.Email       t5 (property h09, domain h05) → 1, best 1.0
//   NOT admitted: Organization.Name (t5 domain h05), Person.Name (t2/t4 domain h03), Organization.PhoneKind (t3 range h07,
//   t5 domain h05), Staff.PhoneType (t3 range h07 only)
// Neighbours: owner Applicant + siblings Name, PhoneKindCode, Status = 4 domain neighbours; Telephone = 1 range neighbour.
//   o1 names Person (h03 class; h02 → HasTelephone → Person). n1 names Organization, Person, Staff (h04 → the three
//   Name cards; h11 → PhoneKind → Organization). s1 names Organization, Person (h08 → Status → Person, and the
//   StatusCode option set names nothing; h11 → Organization). k1 names NOTHING (h07 is an option set).
//   r1 names Telephone (h06 class; h01 and h10 → cards whose domain is Telephone).
//   domain shares: Person 3/4, Organization 2/4, Staff 1/4; range shares: Telephone 1/1. topShare → Person; Telephone.
// Scores (own + domain + range; shares are the card's own domain and range class):
//   Person.HasTelephone 4+1+1=6 · Person.Status 2+1+0=3 (share .75) · Telephone.TelephoneNumber 3+0+0=3 (share 0, cosine 1.0)
//   · Telephone.TelephoneType 2 · Organization.Email 1 (Organization .5 is not the top share)
// Applicant.Name: n1 alone → the three Name cards (property h04, 1.0) and Organization.PhoneKind (property h11, .7071), 1 vote each.
//   Neighbours: owner Applicant + siblings PhoneKindCode, Status, Telephone; no reference edge leaves Applicant.Name.
//   Telephone (t1..t5 together) names Organization, Person, Telephone. domain shares: Person 3/4, Organization 2/4, Telephone 1/4.
//   Scores: Person.Name 2 · Organization.Name 1 (.5, 1.0) · Organization.PhoneKind 1 (.5, .7071) · Staff.Name 1 (0, 1.0)
const landing = (domainVote, rangeVote, domainShare, rangeShare, score) => Object.freeze({ domainVote, rangeVote, domainShare, rangeShare, score });
const EXPECTED_BY_SUBJECT = Object.freeze({
	[SUBJECT_TELEPHONE]: Object.freeze({
		admittedStableIdList: [cardId('Organization.Email'), cardId('Person.HasTelephone'), cardId('Person.Status'), cardId('Telephone.TelephoneNumber'), cardId('Telephone.TelephoneType')],
		ownVotesByCardStableId: { [cardId('Organization.Email')]: 1, [cardId('Person.HasTelephone')]: 4, [cardId('Person.Status')]: 2, [cardId('Telephone.TelephoneNumber')]: 3, [cardId('Telephone.TelephoneType')]: 2 },
		reachedNotAdmittedStableIdList: [cardId('Organization.Name'), cardId('Organization.PhoneKind'), cardId('Person.Name'), cardId('Staff.PhoneType')],
		votesOnlyRankStableIdList: [cardId('Person.HasTelephone'), cardId('Telephone.TelephoneNumber'), cardId('Telephone.TelephoneType'), cardId('Person.Status'), cardId('Organization.Email')],
		ownerStableId: OWNER_APPLICANT,
		siblingStableIdList: [SUBJECT_NAME, SIBLING_PHONE_KIND_CODE, SIBLING_STATUS],
		referencedObjectStableIdList: [REFERENCED_TELEPHONE],
		domainShareEntryList: [[classId('Organization'), 0.5], [classId('Person'), 0.75], [classId('Staff'), 0.25]],
		rangeShareEntryList: [[classId('Telephone'), 1]],
		namedClassStableIdListByNeighbourStableId: {
			[OWNER_APPLICANT]: [classId('Person')],
			[SUBJECT_NAME]: [classId('Organization'), classId('Person'), classId('Staff')],
			[SIBLING_PHONE_KIND_CODE]: [],
			[SIBLING_STATUS]: [classId('Organization'), classId('Person')],
			[REFERENCED_TELEPHONE]: [classId('Telephone')],
		},
		landingByCardStableId: {
			[cardId('Organization.Email')]: landing(0, 0, 0.5, 0, 1),
			[cardId('Person.HasTelephone')]: landing(1, 1, 0.75, 1, 6),
			[cardId('Person.Status')]: landing(1, 0, 0.75, 0, 3),
			[cardId('Telephone.TelephoneNumber')]: landing(0, 0, 0, 0, 3),
			[cardId('Telephone.TelephoneType')]: landing(0, 0, 0, 0, 2),
		},
		neighbourRankStableIdList: [cardId('Person.HasTelephone'), cardId('Person.Status'), cardId('Telephone.TelephoneNumber'), cardId('Telephone.TelephoneType'), cardId('Organization.Email')],
	}),
	[SUBJECT_NAME]: Object.freeze({
		admittedStableIdList: [cardId('Organization.Name'), cardId('Organization.PhoneKind'), cardId('Person.Name'), cardId('Staff.Name')],
		ownVotesByCardStableId: { [cardId('Organization.Name')]: 1, [cardId('Organization.PhoneKind')]: 1, [cardId('Person.Name')]: 1, [cardId('Staff.Name')]: 1 },
		reachedNotAdmittedStableIdList: [],
		votesOnlyRankStableIdList: [cardId('Organization.Name'), cardId('Person.Name'), cardId('Staff.Name'), cardId('Organization.PhoneKind')],
		ownerStableId: OWNER_APPLICANT,
		siblingStableIdList: [SIBLING_PHONE_KIND_CODE, SIBLING_STATUS, SUBJECT_TELEPHONE],
		referencedObjectStableIdList: [],
		domainShareEntryList: [[classId('Organization'), 0.5], [classId('Person'), 0.75], [classId('Telephone'), 0.25]],
		rangeShareEntryList: [],
		namedClassStableIdListByNeighbourStableId: {
			[OWNER_APPLICANT]: [classId('Person')],
			[SIBLING_PHONE_KIND_CODE]: [],
			[SIBLING_STATUS]: [classId('Organization'), classId('Person')],
			[SUBJECT_TELEPHONE]: [classId('Organization'), classId('Person'), classId('Telephone')],
		},
		landingByCardStableId: {
			[cardId('Organization.Name')]: landing(0, 0, 0.5, 0, 1),
			[cardId('Organization.PhoneKind')]: landing(0, 0, 0.5, 0, 1),
			[cardId('Person.Name')]: landing(1, 0, 0.75, 0, 2),
			[cardId('Staff.Name')]: landing(0, 0, 0, 0, 1),
		},
		neighbourRankStableIdList: [cardId('Person.Name'), cardId('Organization.Name'), cardId('Organization.PhoneKind'), cardId('Staff.Name')],
	}),
});

// ---------------------------------------------------------------------------------------------------------
// THE SUBJECT AND THE RUNNER
// ---------------------------------------------------------------------------------------------------------
const makeScenario = () => ({ frameworkMutationList: [], containmentSourceByFileName: {} });
const cloneScenario = (scenario) => ({ frameworkMutationList: scenario.frameworkMutationList.slice(), containmentSourceByFileName: { ...scenario.containmentSourceByFileName } });

const loadEmbedTextModules = (scenario) =>
	scenario.frameworkMutationList.length === 0
		? { candidateRetrievalLib: require(CANDIDATE_RETRIEVAL_PATH), neighbourVoteLib: require(NEIGHBOUR_VOTE_PATH) }
		: {
				candidateRetrievalLib: moduleDouble.loadWithMutations({ modulePath: CANDIDATE_RETRIEVAL_PATH, mutationList: scenario.frameworkMutationList }),
				neighbourVoteLib: moduleDouble.loadWithMutations({ modulePath: NEIGHBOUR_VOTE_PATH, mutationList: scenario.frameworkMutationList }),
			};

// runToyPipeline — the ORCHESTRATOR'S job done by hand over the toy, the way B4 will do it over a graph: build
// the index, memo and card slot index once, then for each subject vote, rank votes-only, resolve neighbours,
// share, and rank. reverseInput reverses EVERY input list (and the subject order) to expose order dependence.
const runToyPipeline = ({ scenario, toy, reverseInput, neighbourVoteOverride, subjectStableIdListOverride } = {}) => {
	const toyInput = toy === undefined ? makeToyEmbedText() : toy;
	const { candidateRetrievalLib, neighbourVoteLib } = loadEmbedTextModules(scenario);
	const orderOf = (list) => (reverseInput === true ? list.slice().reverse() : list.slice());
	const neighbourVote = neighbourVoteOverride === undefined ? toyInput.neighbourVote : neighbourVoteOverride;
	const { hitsPerText, minScore, k } = toyInput.settings;
	const indexed = candidateRetrievalLib.buildEmbedTextIndex({ textRecordList: orderOf(toyInput.hubTextRecordList), embeddingModelVersion: toyInput.embeddingModelVersion });
	if (indexed.error) {
		return { error: indexed.error.message };
	}
	const memoised = candidateRetrievalLib.makeSearchMemo({ embedTextIndex: indexed.embedTextIndex, hitsPerText, minScore });
	if (memoised.error) {
		return { error: memoised.error.message };
	}
	const slotted = candidateRetrievalLib.buildCardSlotIndex({ cardSlotEdgeList: orderOf(toyInput.cardSlotEdgeList), slotNameBySlotKind: toyInput.slotNameBySlotKind, baseRoleByBaseKind: toyInput.baseRoleByBaseKind });
	if (slotted.error) {
		return { error: slotted.error.message };
	}
	const { searchMemo } = memoised;
	const { cardSlotIndex } = slotted;
	const textRecordListBySourceStableId = new Map();
	orderOf(toyInput.sourceTextRecordList).forEach((oneRecord) => {
		if (!textRecordListBySourceStableId.has(oneRecord.sourceStableId)) {
			textRecordListBySourceStableId.set(oneRecord.sourceStableId, []);
		}
		textRecordListBySourceStableId.get(oneRecord.sourceStableId).push(oneRecord);
	});
	const siblingPopulationByStableId = orderOf(Object.keys(toyInput.siblingPopulationByStableId)).reduce((soFar, oneStableId) => ({ ...soFar, [oneStableId]: toyInput.siblingPopulationByStableId[oneStableId] }), {});
	const sourceStableIdSet = new Set(orderOf(toyInput.sourceStableIdList));
	const referenceEdgeList = orderOf(toyInput.referenceEdgeList);
	const subjectStableIdList = orderOf(subjectStableIdListOverride === undefined ? toyInput.subjectStableIdList : subjectStableIdListOverride);
	const resultBySubjectStableId = {};
	for (let subjectIndex = 0; subjectIndex < subjectStableIdList.length; subjectIndex++) {
		const subjectStableId = subjectStableIdList[subjectIndex];
		const voted = candidateRetrievalLib.voteCandidatePool({ searchMemo, cardSlotIndex, subjectStableId, subjectTextRecordList: textRecordListBySourceStableId.has(subjectStableId) ? textRecordListBySourceStableId.get(subjectStableId) : [] });
		if (voted.error) {
			return { error: voted.error.message };
		}
		const votesOnly = candidateRetrievalLib.rankVotedCandidates({ admittedList: voted.admittedList, k });
		if (votesOnly.error) {
			return { error: votesOnly.error.message };
		}
		const neighbourInput = { subjectStableId, siblingPopulationByStableId, sourceStableIdSet, referenceEdgeList, textRecordListBySourceStableId };
		let neighbourSet = null;
		let neighbourShares = null;
		if (neighbourVote !== null) {
			const resolved = neighbourVoteLib.neighbourSetFor({ subjectStableId, siblingPopulationByStableId, sourceStableIdSet, referenceEdgeList, neighbourVote });
			if (resolved.error) {
				return { error: resolved.error.message };
			}
			const shared = neighbourVoteLib.neighbourSharesFor({ neighbourSet: resolved.neighbourSet, textRecordListBySourceStableId, searchMemo, cardSlotIndex });
			if (shared.error) {
				return { error: shared.error.message };
			}
			neighbourSet = resolved.neighbourSet;
			neighbourShares = shared.neighbourShares;
		}
		const ranked = neighbourVoteLib.rankCandidatePool({ admittedList: voted.admittedList, neighbourVote, neighbourInput, searchMemo, cardSlotIndex, k });
		if (ranked.error) {
			return { error: ranked.error.message };
		}
		resultBySubjectStableId[subjectStableId] = { admittedList: voted.admittedList, votesOnlyRankedList: votesOnly.rankedList, neighbourSet, neighbourShares, rankedList: ranked.rankedList, neighbourTrace: ranked.neighbourTrace };
	}
	return { resultBySubjectStableId, searchMemo, embedTextIndex: indexed.embedTextIndex, cardSlotIndex, modules: { candidateRetrievalLib, neighbourVoteLib } };
};

const projectRun = (run) =>
	JSON.stringify(
		Object.keys(run.resultBySubjectStableId)
			.sort()
			.map((oneStableId) => {
				const oneResult = run.resultBySubjectStableId[oneStableId];
				return { subjectStableId: oneStableId, admittedList: oneResult.admittedList, votesOnlyRankedList: oneResult.votesOnlyRankedList, rankedList: oneResult.rankedList, neighbourTrace: oneResult.neighbourTrace };
			}),
	);

module.exports = {
	makeToyEmbedText,
	makeScenario,
	cloneScenario,
	loadEmbedTextModules,
	runToyPipeline,
	projectRun,
	cloneJson,
	EXPECTED_BY_SUBJECT,
	EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID,
	TOY_SETTINGS,
	TOY_NEIGHBOUR_VOTE,
	SUBJECT_TELEPHONE,
	SUBJECT_NAME,
	CANDIDATE_RETRIEVAL_PATH,
	NEIGHBOUR_VOTE_PATH,
	FRAMEWORK_DIR,
	cardId,
	classId,
	moduleName,
};
