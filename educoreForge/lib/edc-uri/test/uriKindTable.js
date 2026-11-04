'use strict';

// uriKindTable — one row per kind in uriScheme.json: a URI the store really holds, what its answer must carry, and a URI naming nothing (cardUriAnswers-110426, gate G1).
// test-uriKindTable.js runs it through the resolver, and runs/runG1Http.js through a real URL. A row states `absentAnswersRefusal` when the kind can name something
// that is not there, or `cannotBeAbsent` with the reason it cannot. A kind added to the scheme with no row here fails the gate.
// The values are real rows of a write-once store, so they stay true for every later manifest.

const MANIFEST_LABEL = 'educore-2026-10-30';
const MANIFEST_REF_ID = '783aef401fafe0189b551972ba801b1dababf2fec2b7bd3e4653424d544e0999';
const ZERO_HASH = '0'.repeat(64);
const CARD_SIGNATURE = 'ab39501d8fb28c316fc72ba39c1658cc369796ffd35ec2a4a446e5eb0e0c013d';
const ELEMENT_PATH = 'JEDx/1.0.0/jedx:MilitaryServiceType/dischargeDate';
const ABSENT_ELEMENT_PATH = 'JEDx/1.0.0/jedx:NoSuchType/noSuchField';
const LAYER_KEY = 'jev';
const VERSION_TAG = 'cfg-cf8d41f82791.wave1-261024';
const CONTENT_ID = '6bf03499f9b21f3d24fbfff8ff65e58af84787c773a317152519a960daefeec3';
const DECISION_BLOCK_HASH = '03c14661ba2ad066f3253bea968bc85195964ecc450fd5061ed6bc37bd6ad0c8';
const ASSERTION_HASH = '005fbe4368192d72effc17869d5ea2ece5ef789438b672a49ae81c2daf97f4cc';
const SCHEMA_BLOCK_REF_ID = '6d9da54ab425042a4d4eaf0ba483c138de84ece3e7c4cf14cfd2441e0c3e0c61'; // the store's smallest
const SMALLEST_DECISION_BLOCK_HASH = 'bcdb2eb0168edb682b688d32ebf42d1643fe772f9d6373055801fd268d9bfc23';
const HUB_SEGMENT = 'CEDStandards';
const HUB_RELEASE = '14.0.0.0';
const DOMAIN_ID = 'C200296';
const CANNOT_BE_ABSENT_SINGLETON = 'one fixed name: this instance always has it';
const LISTING_FIELD_LIST = ['listing', 'totalCount', 'pageSize', 'pageNumber', 'pageCount'];

const manifestRowsFor = (labelKind, manifestPart) => [
	{ kind: labelKind('manifest'), realPath: manifestPart, realFieldList: ['manifestRefId', 'publicLabel', 'statusHistory'], absentPath: labelKind.absentManifest, absentAnswersRefusal: /no published manifest/ },
	{ kind: labelKind('manifestStandardList'), realPath: `${manifestPart}/standards`, realFieldList: ['listing', 'standardList'], absentPath: `${labelKind.absentManifest}/standards`, absentAnswersRefusal: /no published manifest/ },
	{ kind: labelKind('manifestElementList'), realPath: `${manifestPart}/standards/JEDx/1.0.0/elements`, realFieldList: [...LISTING_FIELD_LIST, 'elementList'], absentPath: `${manifestPart}/standards/NoSuch/1/elements`, absentAnswersRefusal: /lists NoSuch 1/ },
	{ kind: labelKind('manifestHubList'), realPath: `${manifestPart}/hubs`, realFieldList: ['listing', 'hubList'], absentPath: `${labelKind.absentManifest}/hubs`, absentAnswersRefusal: /no published manifest/ },
	{ kind: labelKind('hubDomainList'), realPath: `${manifestPart}/hubs/${HUB_SEGMENT}/${HUB_RELEASE}/domains`, realFieldList: [...LISTING_FIELD_LIST, 'domainList'], absentPath: `${manifestPart}/hubs/NoSuch/1/domains`, absentAnswersRefusal: /holds hub NoSuch 1/ },
	{ kind: labelKind('hubDomainCardList'), realPath: `${manifestPart}/hubs/${HUB_SEGMENT}/${HUB_RELEASE}/domains/${DOMAIN_ID}/cards`, realFieldList: [...LISTING_FIELD_LIST, 'cardList'], absentPath: `${manifestPart}/hubs/${HUB_SEGMENT}/${HUB_RELEASE}/domains/NoSuch/cards`, absentAnswersRefusal: /holds domain NoSuch/ },
	{ kind: labelKind('question'), realPath: `${manifestPart}/q/${ELEMENT_PATH}`, realFieldList: ['question', 'manifestRefId', 'element', 'answer', 'rowList'], absentPath: `${manifestPart}/q/${ABSENT_ELEMENT_PATH}`, absentAnswersRefusal: /no published schema block holds/ },
	{ kind: labelKind('questionForHub'), realPath: `${manifestPart}/q/hub/${HUB_SEGMENT}/${ELEMENT_PATH}`, realFieldList: ['question', 'hubSegment', 'answer', 'rowList'], absentPath: `${manifestPart}/q/hub/NoSuch/${ELEMENT_PATH}`, absentAnswersRefusal: /holds no hub NoSuch/ },
];
const byLabel = (kindName) => kindName;
byLabel.absentManifest = 'manifest/no-such-manifest';
const byContent = (kindName) => `${kindName}ByContent`;
byContent.absentManifest = `manifest/sha256/${ZERO_HASH}`;

const URI_KIND_ROW_LIST = Object.freeze([
	{ kind: 'root', realPath: '', realFieldList: ['root', 'entryPointList'], cannotBeAbsent: CANNOT_BE_ABSENT_SINGLETON },
	{ kind: 'scheme', realPath: 'scheme', realFieldList: ['scheme', 'uriScheme', 'reservedWordList'], cannotBeAbsent: CANNOT_BE_ABSENT_SINGLETON },
	{ kind: 'meaning', realPath: `${HUB_SEGMENT}/hub/${HUB_RELEASE}/${CARD_SIGNATURE}`, realFieldList: ['meaning', 'label', 'definition', 'propertyKey', 'referenceTier', 'domain', 'manifestList', 'mappedElementCount', 'distinctElementCount', 'countNote', 'mappingList', 'mappedElementList', 'totalCount', 'pageSize'], absentPath: `${HUB_SEGMENT}/hub/${HUB_RELEASE}/${ZERO_HASH}`, absentAnswersRefusal: /no published manifest holds a card/ },
	{ kind: 'element', realPath: ELEMENT_PATH, realFieldList: ['element', 'node', 'schemaBlock', 'interpretationList'], absentPath: ABSENT_ELEMENT_PATH, absentAnswersRefusal: /no published schema block holds/ },
	{ kind: 'layer', realPath: `layer/${LAYER_KEY}`, realFieldList: ['layerKey', 'versionList', 'currentStandardVersionTag'], absentPath: 'layer/noSuchLayer', absentAnswersRefusal: /not in uriContract/ },
	{ kind: 'layerVersion', realPath: `layer/${LAYER_KEY}/${VERSION_TAG}`, realFieldList: ['layerKey', 'versionTag', 'countByStandard'], absentPath: `layer/${LAYER_KEY}/noSuchVersion`, absentAnswersRefusal: /has no published version/ },
	{ kind: 'layerVersionByContent', realPath: `layer/${LAYER_KEY}/sha256/${CONTENT_ID}`, realFieldList: ['layerKey', 'versionTag'], absentPath: `layer/${LAYER_KEY}/sha256/${ZERO_HASH}`, absentAnswersRefusal: /has no published version with content/ },
	{ kind: 'assertion', realPath: `assertion/${DECISION_BLOCK_HASH}/${ASSERTION_HASH}`, realFieldList: ['assertionId', 'decisionBlockHash', 'assertion'], absentPath: `assertion/${DECISION_BLOCK_HASH}/${ZERO_HASH}`, absentAnswersRefusal: /no edge this block writes|no row of this set/ },
	{ kind: 'schemaBlock', realPath: `schemaBlock/sha256/${SCHEMA_BLOCK_REF_ID}`, realFieldList: ['schemaBlockRefId', 'blockKind', 'text'], absentPath: `schemaBlock/sha256/${ZERO_HASH}`, absentAnswersRefusal: /is not in uriContract/ },
	{ kind: 'decisionSchemaBlock', realPath: `decisionSchemaBlock/sha256/${SMALLEST_DECISION_BLOCK_HASH}`, realFieldList: ['decisionBlockHash', 'pairKey', 'text'], absentPath: `decisionSchemaBlock/sha256/${ZERO_HASH}`, absentAnswersRefusal: /is not in uriContract/ },
	{ kind: 'interpretationPinned', realPath: `${ELEMENT_PATH}@${LAYER_KEY}/${VERSION_TAG}`, realFieldList: ['element', 'layerVersion', 'answer', 'assertionList'], absentPath: `${ABSENT_ELEMENT_PATH}@${LAYER_KEY}/${VERSION_TAG}`, absentAnswersRefusal: /no published schema block holds/ },
	{ kind: 'interpretationFloating', realPath: `${ELEMENT_PATH}@${LAYER_KEY}`, realFieldList: ['element', 'layerVersion', 'answer', 'assertionList', 'followedVersionTag'], absentPath: `${ABSENT_ELEMENT_PATH}@${LAYER_KEY}`, absentAnswersRefusal: /no published schema block holds/ },
	...manifestRowsFor(byLabel, `manifest/${MANIFEST_LABEL}`),
	...manifestRowsFor(byContent, `manifest/sha256/${MANIFEST_REF_ID}`),
	{ kind: 'manifestList', realPath: 'manifests', realFieldList: [...LISTING_FIELD_LIST, 'manifestList'], cannotBeAbsent: CANNOT_BE_ABSENT_SINGLETON },
	{ kind: 'agentPerson', realPath: 'agent/i0PuAgVSbcP6P7YquytU', realFieldList: ['agentIri', 'agentKind', 'displayName'], absentPath: 'agent/noSuchPerson', absentAnswersRefusal: /is not in uriContract/ },
	{ kind: 'agentJudge', realPath: 'agent/judge/jev:jev-1.13.0:data:cfg-03f64470322c', realFieldList: ['agentIri', 'agentKind'], absentPath: 'agent/judge/noSuchJudge', absentAnswersRefusal: /is not in uriContract/ },
	{ kind: 'agentOrganisation', realPath: 'agent/org/educore', realFieldList: ['agentIri', 'agentKind'], absentPath: 'agent/org/noSuchOrganisation', absentAnswersRefusal: /is not in uriContract/ },
	{ kind: 'agentList', realPath: 'agents', realFieldList: [...LISTING_FIELD_LIST, 'agentList'], cannotBeAbsent: CANNOT_BE_ABSENT_SINGLETON },
	{ kind: 'siteLayerRegistry', realPath: 'registry/layers', realFieldList: ['registry', 'layerList'], cannotBeAbsent: CANNOT_BE_ABSENT_SINGLETON },
	{ kind: 'vocabularyTerm', realPath: 'bestMatch', realFieldList: ['term', 'termName', 'definition'], cannotBeAbsent: 'a closed list in uriScheme.json: any other word parses as no kind at all and answers 400 by name' },
]);

module.exports = { URI_KIND_ROW_LIST };
