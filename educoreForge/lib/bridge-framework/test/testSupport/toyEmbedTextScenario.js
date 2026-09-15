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
// THE VECTORS live on eight named axes so every cosine can be done on paper:
//   0 telephone number · 1 person · 2 name · 3 organization · 4 status · 5 telephone type · 6 code list · 7 full legal name
// No HUB TEXT carries axis 7, so a subject text on axis 7 alone reaches no hub text at all and changes no vote or
// share; it can only win a card-text comparison (B1b, R-BR-14). Seven axes could not do that: every vector on them
// is at least 1/√7 = 0.378 from some one-axis hub text, above the floor.
// A cosine of 1/√2 is 0.7071, 1/2 is 0.5, 1/√5 is 0.4472, 2/√5 is 0.8944, 3/√10 is 0.9487, 1/√10 is 0.3162,
// 4/√17 is 0.9701, 1/√17 is 0.2425, 1/√3 is 0.5774. Settings: hitsPerText 3, minScore 0.30, k 15.
//
// WHAT THE TOY CARRIES (the brief's list, each one named where it is built):
//   a subject text shared by two of its properties ........ t1, propertyNameList ['description', 'name']
//   a card admitted through its property hit .............. Telephone.TelephoneType: h10 admits it; its class and
//                                                           option-set paths alone would not
//   cards reachable only through class or option-set hits . Organization.Name, Person.Name (class), Staff.PhoneType (option set)
//   a neighbour hitting an option-set base node ........... Applicant.PhoneKindCode (k1 → the TelephoneType option set)
//   an owner, three siblings, one referenced object ....... Applicant; Name, PhoneKindCode, Status; Telephone
//   ties resolved by stableId ............................. t4's third hit (h02 vs h11, both 0.5)
//   (B1b) card-text ordering, R-BR-14:
//   a NAME text winning one card, a DESCRIPTION text another  n1 wins Organization.Name; n2 wins Staff.Name
//   two texts tying EXACTLY on one card ................... t1 and t3 on Telephone.TelephoneType; t1 wins on textStableId
//   equal ownVotes and bestCosine, stableId order reversed  Organization.Name vs Staff.Name for Applicant.Name
//     from card-text order
//   equal score and share decided by card text ............ Organization.PhoneKind before Organization.Name (neighbour rank)

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
	['h01TelephoneNumber', [1, 0, 0, 0, 0, 0, 0, 0], [['property', 'TelephoneNumber']]],
	['h02HasTelephone', [1, 1, 0, 0, 0, 0, 0, 0], [['property', 'HasTelephone']]],
	['h03Person', [0, 1, 0, 0, 0, 0, 0, 0], [['class', 'Person']]],
	['h04Name', [0, 0, 1, 0, 0, 0, 0, 0], [['property', 'Name']]],
	['h05Organization', [0, 0, 0, 1, 0, 0, 0, 0], [['class', 'Organization']]],
	['h06Telephone', [1, 0, 0, 0, 0, 1, 0, 0], [['class', 'Telephone']]],
	['h07TelephoneTypeCodeList', [0, 0, 0, 0, 0, 1, 1, 0], [['optionSet', 'TelephoneType']]],
	// ONE hub text describing TWO base nodes, a property and an option set
	['h08Status', [0, 0, 0, 0, 1, 0, 0, 0], [['property', 'Status'], ['optionSet', 'StatusCode']]],
	['h09OrganizationEmail', [0, 0, 0, 4, 0, 1, 0, 0], [['property', 'Email']]],
	['h10TelephoneType', [0, 0, 0, 0, 0, 1, 0, 0], [['property', 'TelephoneType']]],
	['h11PhoneKind', [0, 0, 1, 0, 1, 0, 0, 0], [['property', 'PhoneKind']]],
];

// [cardName, domainClass, property, range: [baseKind, baseName] | null, whole-card embedding]. Staff.PhoneType's
// property has no text. The embedding is what readHubVectors returns for the card; cardTextCosineFor reads it.
const CARD_ROW_LIST = [
	['Organization.Email', 'Organization', 'Email', null, [0, 0, 0, 1, 0, 0, 0, 0]],
	['Organization.Name', 'Organization', 'Name', null, [0, 0, 1, 2, 0, 0, 0, 0]],
	['Organization.PhoneKind', 'Organization', 'PhoneKind', ['optionSet', 'TelephoneType'], [0, 0, 1, 1, 0, 1, 0, 0]],
	['Person.HasTelephone', 'Person', 'HasTelephone', ['class', 'Telephone'], [1, 1, 0, 0, 0, 0, 0, 0]],
	['Person.Name', 'Person', 'Name', null, [0, 2, 1, 0, 0, 0, 0, 0]],
	['Person.Status', 'Person', 'Status', ['optionSet', 'StatusCode'], [0, 1, 0, 0, 3, 0, 0, 0]],
	['Staff.Name', 'Staff', 'Name', null, [0, 0, 1, 0, 0, 0, 0, 2]],
	['Staff.PhoneType', 'Staff', 'StaffPhoneType', ['optionSet', 'TelephoneType'], [0, 0, 0, 0, 0, 1, 1, 0]],
	['Telephone.TelephoneNumber', 'Telephone', 'TelephoneNumber', null, [1, 0, 0, 0, 0, 0, 0, 0]],
	['Telephone.TelephoneType', 'Telephone', 'TelephoneType', ['optionSet', 'TelephoneType'], [1, 0, 0, 0, 0, 1, 0, 0]],
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

// the described node's role, as readEmbedTextVectors returns it (R-BR-15)
const SOURCE_PROPERTY_ROLE = 'ToySourcePropertyRole';
const SOURCE_CLASS_ROLE = 'ToySourceClassRole';

// [textName, describedStableId, describedRole, propertyNameList, vector]
const SOURCE_TEXT_ROW_LIST = [
	['t1Telephone', SUBJECT_TELEPHONE, SOURCE_PROPERTY_ROLE, ['description', 'name'], [1, 0, 0, 0, 0, 0, 0, 0]],
	['t2ApplicantTelephone', SUBJECT_TELEPHONE, SOURCE_PROPERTY_ROLE, ['shortDescription'], [1, 2, 0, 0, 0, 0, 0, 0]],
	['t3KindOfTelephone', SUBJECT_TELEPHONE, SOURCE_PROPERTY_ROLE, ['comment'], [0, 0, 0, 0, 0, 1, 0, 0]],
	['t4ApplicantStatusTelephone', SUBJECT_TELEPHONE, SOURCE_PROPERTY_ROLE, ['documentation'], [0, 1, 0, 0, 1, 0, 0, 0]],
	['t5OrganizationContact', SUBJECT_TELEPHONE, SOURCE_PROPERTY_ROLE, ['definition'], [0, 0, 0, 4, 0, 1, 0, 0]],
	['o1Applicant', OWNER_APPLICANT, SOURCE_CLASS_ROLE, ['name'], [0, 1, 0, 0, 0, 0, 0, 0]],
	['n1Name', SUBJECT_NAME, SOURCE_PROPERTY_ROLE, ['name'], [0, 0, 1, 0, 0, 0, 0, 0]],
	// axis 7 only: no hub text within the floor, so NO hit, NO vote, NO named class; it acts only through card text
	['n2FullLegalName', SUBJECT_NAME, SOURCE_PROPERTY_ROLE, ['description'], [0, 0, 0, 0, 0, 0, 0, 1]],
	['s1Status', SIBLING_STATUS, SOURCE_PROPERTY_ROLE, ['name'], [0, 0, 0, 0, 1, 0, 0, 0]],
	['k1PhoneKindCode', SIBLING_PHONE_KIND_CODE, SOURCE_PROPERTY_ROLE, ['name'], [0, 0, 0, 0, 0, 0, 1, 0]],
	['r1TelephoneCommon', REFERENCED_TELEPHONE, SOURCE_CLASS_ROLE, ['name'], [1, 0, 0, 0, 0, 1, 0, 0]],
];

const makeToyEmbedText = () => {
	const hubTextRecordList = HUB_TEXT_ROW_LIST.reduce(
		(soFar, [textName, vector, baseRowList]) =>
			soFar.concat(baseRowList.map(([baseKind, baseName]) => ({ textStableId: `toyhub/embedText/${textName}`, vector: vector.slice(), embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION, sourceStableId: baseIdByKind[baseKind](baseName), sourceRole: TOY_BASE_ROLE_BY_BASE_KIND[baseKind], propertyNameList: ['name'] }))),
		[],
	);
	const hubCardVectorRecordList = CARD_ROW_LIST.map(([cardName, , , , embedding]) => ({ stableId: cardId(cardName), embedding: embedding.slice(), embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION }));
	const cardSlotEdgeList = CARD_ROW_LIST.reduce((soFar, [cardName, domainClassName, propertyName, rangeRow]) => {
		const edgeList = [
			{ cardStableId: cardId(cardName), slot: TOY_SLOT_NAME_BY_SLOT_KIND.domain, baseStableId: classId(domainClassName), baseRole: TOY_BASE_ROLE_BY_BASE_KIND.class },
			{ cardStableId: cardId(cardName), slot: TOY_SLOT_NAME_BY_SLOT_KIND.property, baseStableId: propertyId(propertyName), baseRole: TOY_BASE_ROLE_BY_BASE_KIND.property },
		];
		return soFar.concat(rangeRow === null ? edgeList : edgeList.concat([{ cardStableId: cardId(cardName), slot: TOY_SLOT_NAME_BY_SLOT_KIND.range, baseStableId: baseIdByKind[rangeRow[0]](rangeRow[1]), baseRole: TOY_BASE_ROLE_BY_BASE_KIND[rangeRow[0]] }]));
	}, []);
	const sourceTextRecordList = SOURCE_TEXT_ROW_LIST.map(([textName, describedStableId, describedRole, propertyNameList, vector]) => ({ textStableId: `src/embedText/${textName}`, vector: vector.slice(), embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION, sourceStableId: describedStableId, sourceRole: describedRole, propertyNameList: propertyNameList.slice() }));
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
		hubCardVectorRecordList,
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
//   n2 []                                          axis 7 only; every hub text is 0 there, so cosine 0 < .30 everywhere
const EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID = Object.freeze({
	'src/embedText/t1Telephone': 3,
	'src/embedText/t2ApplicantTelephone': 3,
	'src/embedText/t3KindOfTelephone': 3,
	'src/embedText/t4ApplicantStatusTelephone': 3,
	'src/embedText/t5OrganizationContact': 2,
	'src/embedText/o1Applicant': 2,
	'src/embedText/n1Name': 2,
	'src/embedText/n2FullLegalName': 0,
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
//   n2 has no hit (above), so it adds no vote and names no class: every vote and share above is unchanged by it.
//
// CARD TEXT (B1b, R-BR-14): cardTextCosine = the highest RAW cosine between the subject's OWN texts and the card
// embedding in CARD_ROW_LIST; an exact tie goes to the lower textStableId. Norms: t1 1, t2 √5, t3 1, t4 √2, t5 √17,
// n1 1, n2 1.
// Applicant.Telephone (t1 t2 t3 t4 t5):
//   Organization.Email        [0,0,0,1,0,0,0,0] |1|    0, 0, 0, 0, 4/√17                         → t5 4/√17  .9701
//   Person.HasTelephone       [1,1,0,0,0,0,0,0] |√2|   1/√2, 3/√10, 0, 1/2, 0                    → t2 3/√10  .9487
//   Person.Status             [0,1,0,0,3,0,0,0] |√10|  0, 2/√50, 0, 4/√20 = 2/√5, 0              → t4 2/√5   .8944
//   Telephone.TelephoneNumber [1,0,0,0,0,0,0,0] |1|    1, 1/√5, 0, 0, 0                          → t1 1
//   Telephone.TelephoneType   [1,0,0,0,0,1,0,0] |√2|   1/√2, 1/√10, 1/√2, 0, 1/√34               → t1 1/√2   .7071
//     t1 and t3 TIE EXACTLY (dot 1 over 1·√2 both) and t1 wins on textStableId
// Applicant.Name (n1 n2):
//   Organization.Name         [0,0,1,2,0,0,0,0] |√5|   1/√5, 0                                   → n1 1/√5   .4472
//   Organization.PhoneKind    [0,0,1,1,0,1,0,0] |√3|   1/√3, 0                                   → n1 1/√3   .5774
//   Person.Name               [0,2,1,0,0,0,0,0] |√5|   1/√5, 0                                   → n1 1/√5   .4472
//   Staff.Name                [0,0,1,0,0,0,0,2] |√5|   1/√5, 2/√5                                → n2 2/√5   .8944
//     the NAME text n1 wins Organization.Name; the DESCRIPTION text n2 wins Staff.Name
//     Organization.Name and Person.Name TIE EXACTLY on card text (dot 1 over 1·√5 both, √5 from 1+4 either way) and
//     on bestCosine (1.0), so stableId still decides one pair: the stableId tie-break stays under a twin (BG-ETS h)
//
// RANKS (R-BR-14). Votes only: ownVotes DESC, cardTextCosine DESC, bestCosine DESC, stableId ASC.
//   Applicant.Telephone: HasTelephone 4 · TelephoneNumber 3 · then at 2 votes Person.Status (.8944) before
//     Telephone.TelephoneType (.7071), although TelephoneType has the better bestCosine (1.0 vs .8944) · Organization.Email 1
//   Applicant.Name: all at 1 vote, so card text decides: Staff.Name .8944 · Organization.PhoneKind .5774 · then
//     Organization.Name and Person.Name tied at .4472 and at bestCosine 1.0, so stableId: Organization.Name, Person.Name.
//     Organization.Name and Staff.Name share ownVotes 1 AND bestCosine 1.0; stableId would put Organization.Name first,
//     card text puts Staff.Name first (the tie the old order got wrong).
// Neighbour: score DESC, domainShare + rangeShare DESC, cardTextCosine DESC, bestCosine DESC, stableId ASC.
//   Applicant.Telephone: unchanged, no pair ties on score and share.
//   Applicant.Name: Person.Name 2 · then at score 1, share .5: Organization.PhoneKind (.5774) before Organization.Name
//     (.4472), although Organization.Name has the better bestCosine (1.0 vs .7071) · Staff.Name 1 at share 0.
const ROOT_2 = Math.sqrt(2);
const ROOT_3 = Math.sqrt(3);
const ROOT_5 = Math.sqrt(5);
const ROOT_10 = Math.sqrt(10);
const ROOT_17 = Math.sqrt(17);
const cardText = (winningTextName, cardTextCosine) => Object.freeze({ cardTextCosine, cardTextWinningTextStableId: `src/embedText/${winningTextName}` });
const landing =(domainVote, rangeVote, domainShare, rangeShare, score) => Object.freeze({ domainVote, rangeVote, domainShare, rangeShare, score });
const EXPECTED_BY_SUBJECT = Object.freeze({
	[SUBJECT_TELEPHONE]: Object.freeze({
		admittedStableIdList: [cardId('Organization.Email'), cardId('Person.HasTelephone'), cardId('Person.Status'), cardId('Telephone.TelephoneNumber'), cardId('Telephone.TelephoneType')],
		ownVotesByCardStableId: { [cardId('Organization.Email')]: 1, [cardId('Person.HasTelephone')]: 4, [cardId('Person.Status')]: 2, [cardId('Telephone.TelephoneNumber')]: 3, [cardId('Telephone.TelephoneType')]: 2 },
		reachedNotAdmittedStableIdList: [cardId('Organization.Name'), cardId('Organization.PhoneKind'), cardId('Person.Name'), cardId('Staff.PhoneType')],
		votesOnlyRankStableIdList: [cardId('Person.HasTelephone'), cardId('Telephone.TelephoneNumber'), cardId('Person.Status'), cardId('Telephone.TelephoneType'), cardId('Organization.Email')],
		cardTextByCardStableId: {
			[cardId('Organization.Email')]: cardText('t5OrganizationContact', 4 / ROOT_17),
			[cardId('Person.HasTelephone')]: cardText('t2ApplicantTelephone', 3 / ROOT_10),
			[cardId('Person.Status')]: cardText('t4ApplicantStatusTelephone', 2 / ROOT_5),
			[cardId('Telephone.TelephoneNumber')]: cardText('t1Telephone', 1),
			[cardId('Telephone.TelephoneType')]: cardText('t1Telephone', 1 / ROOT_2),
		},
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
		// R-BR-16: the trace's copy of the map above, keys in stableId ORDER (src/class/* before src/property/*)
		traceNamedClassEntryList: [
			[OWNER_APPLICANT, [classId('Person')]],
			[REFERENCED_TELEPHONE, [classId('Telephone')]],
			[SUBJECT_NAME, [classId('Organization'), classId('Person'), classId('Staff')]],
			[SIBLING_PHONE_KIND_CODE, []],
			[SIBLING_STATUS, [classId('Organization'), classId('Person')]],
		],
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
		votesOnlyRankStableIdList: [cardId('Staff.Name'), cardId('Organization.PhoneKind'), cardId('Organization.Name'), cardId('Person.Name')],
		cardTextByCardStableId: {
			[cardId('Organization.Name')]: cardText('n1Name', 1 / ROOT_5),
			[cardId('Organization.PhoneKind')]: cardText('n1Name', 1 / ROOT_3),
			[cardId('Person.Name')]: cardText('n1Name', 1 / ROOT_5),
			[cardId('Staff.Name')]: cardText('n2FullLegalName', 2 / ROOT_5),
		},
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
		traceNamedClassEntryList: [
			[OWNER_APPLICANT, [classId('Person')]],
			[SIBLING_PHONE_KIND_CODE, []],
			[SIBLING_STATUS, [classId('Organization'), classId('Person')]],
			[SUBJECT_TELEPHONE, [classId('Organization'), classId('Person'), classId('Telephone')]],
		],
		landingByCardStableId: {
			[cardId('Organization.Name')]: landing(0, 0, 0.5, 0, 1),
			[cardId('Organization.PhoneKind')]: landing(0, 0, 0.5, 0, 1),
			[cardId('Person.Name')]: landing(1, 0, 0.75, 0, 2),
			[cardId('Staff.Name')]: landing(0, 0, 0, 0, 1),
		},
		neighbourRankStableIdList: [cardId('Person.Name'), cardId('Organization.PhoneKind'), cardId('Organization.Name'), cardId('Staff.Name')],
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
// the text index, memo, card slot index and hub card vector index once, then for each subject vote, add card
// text (R-BR-14), rank votes-only, resolve neighbours, share, and rank. reverseInput reverses EVERY input list
// (and the subject order) to expose order dependence.
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
	const hubIndexed = candidateRetrievalLib.buildHubVectorIndex({ vectorRecordList: orderOf(toyInput.hubCardVectorRecordList), embeddingModelVersion: toyInput.embeddingModelVersion });
	if (hubIndexed.error) {
		return { error: hubIndexed.error.message };
	}
	const { hubVectorIndex } = hubIndexed;
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
		const subjectTextRecordList = textRecordListBySourceStableId.has(subjectStableId) ? textRecordListBySourceStableId.get(subjectStableId) : [];
		const voted = candidateRetrievalLib.voteCandidatePool({ searchMemo, cardSlotIndex, subjectStableId, subjectTextRecordList });
		if (voted.error) {
			return { error: voted.error.message };
		}
		const cardTexted = candidateRetrievalLib.cardTextCosineFor({ admittedList: voted.admittedList, subjectTextRecordList, hubVectorIndex });
		if (cardTexted.error) {
			return { error: cardTexted.error.message };
		}
		const votesOnly = candidateRetrievalLib.rankVotedCandidates({ admittedList: cardTexted.admittedList, k });
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
		const ranked = neighbourVoteLib.rankCandidatePool({ admittedList: cardTexted.admittedList, neighbourVote, neighbourInput, searchMemo, cardSlotIndex, k });
		if (ranked.error) {
			return { error: ranked.error.message };
		}
		resultBySubjectStableId[subjectStableId] = { admittedList: voted.admittedList, cardTextAdmittedList: cardTexted.admittedList, votesOnlyRankedList: votesOnly.rankedList, neighbourSet, neighbourShares, neighbourInput, rankedList: ranked.rankedList, neighbourTrace: ranked.neighbourTrace };
	}
	return { resultBySubjectStableId, searchMemo, embedTextIndex: indexed.embedTextIndex, cardSlotIndex, hubVectorIndex, modules: { candidateRetrievalLib, neighbourVoteLib } };
};

const projectRun = (run) =>
	JSON.stringify(
		Object.keys(run.resultBySubjectStableId)
			.sort()
			.map((oneStableId) => {
				const oneResult = run.resultBySubjectStableId[oneStableId];
				return { subjectStableId: oneStableId, admittedList: oneResult.admittedList, cardTextAdmittedList: oneResult.cardTextAdmittedList, votesOnlyRankedList: oneResult.votesOnlyRankedList, rankedList: oneResult.rankedList, neighbourTrace: oneResult.neighbourTrace };
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
	TOY_EMBEDDING_MODEL_VERSION,
	SUBJECT_TELEPHONE,
	SUBJECT_NAME,
	CANDIDATE_RETRIEVAL_PATH,
	NEIGHBOUR_VOTE_PATH,
	FRAMEWORK_DIR,
	cardId,
	classId,
	moduleName,
};
