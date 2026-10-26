#!/usr/bin/env node
'use strict';

// test-stubResolver.js — the local edc: stub resolver's answers (mappingLayers ML1 AMENDMENT, R-5; SPEC §5.3), over a STATED
// registry and an in-memory block reader: a floating layer follows its Standard version, a version answers by tag and by content,
// an assertion answers with its one record, an agent with its row; ⟪ML3.1⟫ questions answer from a manifest's own relationship
// schema blocks with provenance, schema blocks answer text or (held) 451 with the reason, all through a uriContractReader DOUBLE; a
// path that names no kind is 400. Pure: no store, no socket. Run: node lib/edc-uri/test/test-stubResolver.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/edc-uri/stubResolver

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const harness = require('../../../test/testLib/harness')(moduleName);
const { resolveEdcUri, edcIriFor } = require('../stubResolver');
const assertionIdentity = require('../assertionIdentity');
const { registryFor } = require('../../layer-registry/layerRegistry');

const ORGANISATION_IRI = 'https://w3id.org/EDUcore/agent/org/educore';
const JUDGE_IRI = 'https://w3id.org/EDUcore/agent/judge/debug:digest';
const block = {
	header: { matchBasis: 'derived', sourceStandardName: 'Toy', sourceVersion: '1.2.3', hubName: 'ToyHub', hubVersion: '1.0' },
	decisionRecordList: [
		{ subjectStableId: 'toy:property/Alpha', predicate: 'exactMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa', resolution: 'judged', confidence: 0.9, mappingMethod: 'semapv:CompositeMatching', judge: { judgeModel: 'debug:digest' } },
		{ subjectStableId: 'toy:question/Q', predicate: 'closeMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/bbbb', resolution: 'judged', confidence: 0.7, instanceStableIdList: ['toy:field/One', 'toy:field/Two'], judge: { judgeModel: 'debug:digest' } },
		{ subjectStableId: 'toy:property/Gamma', predicate: null, objectStableId: null, resolution: 'judged', abstained: true },
	],
};
const frozenText = JSON.stringify(block);
const decisionBlockHash = crypto.createHash('sha256').update(frozenText, 'utf8').digest('hex');
// ⟪ML3.1c⟫ a STORED curated set (no record_id column, as the rater sets are stored): its assertion URIs are recomputed (R-c')
const RATER_IRI = 'https://w3id.org/EDUcore/agent/raterPseudonym7';
const curatedSetText = ['#object_source_version: "1.0"', ['subject_id', 'predicate_id', 'object_id', 'subject_source_version', 'author_id'].join('\t'), ['toy:property/Alpha', 'edc:bestMatch', 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa', '1.2.3', RATER_IRI].join('\t')].join('\n') + '\n';
const curatedSetHash = crypto.createHash('sha256').update(curatedSetText, 'utf8').digest('hex');
const blockTextForHash = (requestedHash, done) => done('', requestedHash === decisionBlockHash ? frozenText : requestedHash === curatedSetHash ? curatedSetText : null);
const memberBlockList = [{ pairKey: 'toyhub@1.0::toy@1.2.3::toyDerivedPlugin::inferred', decisionBlockHash }];
const contentId = crypto.createHash('sha256').update(decisionBlockHash, 'utf8').digest('hex');
// v0 is an EARLIER version over another block (its own content); v1 is the block above
const earlierMemberBlockList = [{ pairKey: 'toyhub@1.0::toy@1.2.3::toyDerivedPlugin::inferred', decisionBlockHash: 'e'.repeat(64) }];
const versionFor = ({ versionTag, registrationStatus, publishedAt, versionMemberBlockList = memberBlockList }) => ({
	administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI, publishedAt, contentId: crypto.createHash('sha256').update(versionMemberBlockList.map((oneMember) => oneMember.decisionBlockHash).sort().join('\n'), 'utf8').digest('hex'), versionTag },
	registrationStatus,
	authorAgentIri: JUDGE_IRI,
	contentIdBasis: 'sortedMemberBlockHashList',
	memberBlockList: versionMemberBlockList,
});
const registryLoad = registryFor({
	agentRegistry: { agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' }, { agentIri: JUDGE_IRI, agentKind: 'judge', displayName: 'the debug judge' }, { agentIri: 'https://w3id.org/EDUcore/agent/raterPseudonym7', agentKind: 'person', displayName: 'rater 7' }] },
	layerRegistry: {
		registrationAuthorityIri: ORGANISATION_IRI,
		registrarIri: ORGANISATION_IRI,
		layerList: [{ layerKey: 'toyJudge', displayName: 'a toy judge layer', layerKind: 'judge', authorAgentIri: JUDGE_IRI, standardList: [{ standardKey: 'toy', standardName: 'Toy', sourceIri: 'urn:educore:toy:' }], hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }], versionList: [versionFor({ versionTag: 'v0', registrationStatus: 'Standard', publishedAt: '2026-09-01T00:00:00Z', versionMemberBlockList: earlierMemberBlockList }), versionFor({ versionTag: 'v1', registrationStatus: 'Standard', publishedAt: '2026-10-01T00:00:00Z' })], statusChangeList: [{ versionTag: 'v0', registrationStatus: 'Superseded', changedAt: '2026-10-02T00:00:00Z', changedBy: ORGANISATION_IRI, supersededByVersionTag: 'v1' }] }, { layerKey: 'toyRaters', displayName: 'toy raters', layerKind: 'curated', authorAgentIri: ORGANISATION_IRI, standardList: [{ standardKey: 'toy', standardName: 'Toy', sourceIri: 'urn:educore:toy:' }], hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }], versionList: [{ administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI, publishedAt: '2026-10-25T00:00:00Z', contentId: curatedSetHash, versionTag: 'r1' }, registrationStatus: 'Candidate', authorAgentIri: ORGANISATION_IRI, contentIdBasis: 'frozenSetBytes', wholeSetBlock: { pairKey: 'layerSet::toyRaters', decisionBlockHash: curatedSetHash }, memberBlockList: [{ pairKey: 'layerSet::toyRaters', decisionBlockHash: curatedSetHash }] }], statusChangeList: [] }],
	},
});
harness.ok('the stated registry (a judge layer and, ML3.1c, a curated layer) loads', registryLoad.error === undefined, registryLoad.error);
const { registry } = registryLoad;

// ⟪ML3.1⟫ the uriContractReader DOUBLE (the interface lib/uri-contract implements): one manifest, one relationship schema block whose
// element toy:property/Alpha has an edge to a ToyHub card and one to a CTDL card, plus a licence-held standardBase and decision block
const sha256Of = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const relationshipEdgeLine = (hubCardIri, assertionHash) => JSON.stringify({ kind: 'edge', type: 'EXACT_MATCH', fromRef: { source: 'Toy', id: 'toy:property/Alpha' }, toRef: { source: 'X', id: hubCardIri }, properties: { assertionId: [`https://w3id.org/EDUcore/assertion/${decisionBlockHash}/${assertionHash}`], decisionBlockHash: [decisionBlockHash], judgeIdentity: ['debug:digest'], mappingSource: ['bridge-debug'], matchBasis: ['derived'], mappingKind: ['inferred'], predicate: ['exactMatch'], objectSource: ['X'], objectVersion: ['1.0'], subjectSource: ['Toy'], subjectVersion: ['1.2.3'] } });
const relationshipText = [JSON.stringify({ kind: 'header', blockType: 'relationship', pairA: 'toyhub', pairAVersion: '1.0', pairB: 'toy', pairBVersion: '1.2.3', producer: 'inferred' }), JSON.stringify({ kind: 'node', ref: { source: 'Toy', id: 'toy:property/Alpha' } }), relationshipEdgeLine('https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa', '1'.repeat(64)), relationshipEdgeLine('https://w3id.org/EDUcore/CTDL/hub/Release_20260927/cccc', '2'.repeat(64))].join('\n');
const relationshipRefId = sha256Of(relationshipText);
const heldText = JSON.stringify({ kind: 'header', blockType: 'standardBase', standardKey: 'edfi', version: '5.2.0' });
const heldRefId = sha256Of(heldText);
const heldFrozenText = JSON.stringify({ header: { sourceStandardName: 'EdFi' }, decisionRecordList: [{ subjectStableId: 'edfi:property/Student.Name', predicate: 'exactMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa' }] });
const heldDecisionBlockHash = sha256Of(heldFrozenText);
const toyManifestRefId = sha256Of('toy manifest');
const schemaBlockByRefId = { [relationshipRefId]: { schemaBlockRefId: relationshipRefId, blockKind: 'relationship', subject: 'toyhub@1_0_rel_toy@1_2_3_close', version: '1.0', text: relationshipText }, [heldRefId]: { schemaBlockRefId: heldRefId, blockKind: 'standardBase', subject: 'edfi@5_2_0_base', version: '5.2.0', text: heldText } };
const manifestFor = (publicLabel, defaultLayerByHub) => ({ manifestRefId: publicLabel === 'toyLabel' ? toyManifestRefId : sha256Of(publicLabel), publicLabel, publishedAt: '2026-10-27T00:00:00Z', latestStatus: { registrationStatus: 'Candidate', changedAt: '2026-10-27T00:00:00Z' }, memberList: [{ schemaBlockRefId: heldRefId, position: 0 }, { schemaBlockRefId: relationshipRefId, position: 1 }], defaultLayerByHub });
const manifestList = [manifestFor('toyLabel', null), manifestFor('settledLabel', { ToyHub: { decisionBlockHashList: ['9'.repeat(64)] } })];
const uriContractReader = {
	schemaBlockFor: (schemaBlockRefId, done) => done('', schemaBlockByRefId[schemaBlockRefId] === undefined ? null : schemaBlockByRefId[schemaBlockRefId]),
	decisionSchemaBlockFor: (requestedHash, done) => done('', requestedHash === decisionBlockHash ? { decisionBlockHash, pairKey: memberBlockList[0].pairKey, frozenText } : requestedHash === heldDecisionBlockHash ? { decisionBlockHash: heldDecisionBlockHash, pairKey: 'ceds@14.0.0.0::sif260928@4.3::firstUseOfThisBlock::inferred', frozenText: heldFrozenText } : null),
	agentRecordFor: (agentIri, done) => done('', agentIri === 'https://w3id.org/EDUcore/agent/raterPseudonym7' ? { profile: { agentIri, agentKind: 'person', displayName: 'rater 7', aliasIriList: ['https://orcid.org/0000-0000-0000-0007'], emailAddress: 'leak@example.org', userName: 'realName' }, layersAuthored: [{ layerKey: 'rater-07', versionTag: 'r1' }], scores: { agreementWithRaters: 0.8 } } : null),
	// ⟪ML3.1, Q4 / Q5⟫ the relation and discovery functions, as stated data
	elementRecordFor: (address, done) => done('', address.elementStableId === 'toy:property/Alpha' ? { schemaBlockRefId: heldRefId, node: { stableId: 'toy:property/Alpha', labels: ['DmeProperty'], properties: { name: 'Alpha' } }, parentStableId: 'toy:class/Root', siblingStableIdList: ['toy:property/Gamma'], definitionText: 'the alpha slot' } : null),
	publishedLayerVersionListForStandard: (address, done) => done('', address.standardName === 'Toy' ? [{ layerKey: 'toyJudge', versionTag: 'v1', registrationStatus: 'Standard' }] : []),
	mappingsToMeaningFor: (meaningIri, done) => done('', meaningIri === 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa' ? [{ manifestRefId: toyManifestRefId, standardName: 'Toy', standardVersion: '1.2.3', layerKey: 'toyJudge', versionTag: 'v1', relationType: 'exactMatch', elementCount: 2 }, { manifestRefId: toyManifestRefId, standardName: 'Toy', standardVersion: '1.2.3', layerKey: null, versionTag: null, relationType: 'closeMatch', elementCount: 1 }] : []),
	layerHistoryFor: (layerKey, done) => done('', layerKey === 'toyJudge' ? { layerKey, displayName: 'a toy judge layer', layerKind: 'judge', authorAgentIri: JUDGE_IRI, versionList: [{ versionTag: 'v0', contentId: 'e'.repeat(64), publishedAt: '2026-09-01T00:00:00Z', statusHistory: [{ registrationStatus: 'Standard', changedAt: '2026-09-01T00:00:00Z', changedBy: ORGANISATION_IRI }, { registrationStatus: 'Superseded', changedAt: '2026-10-02T00:00:00Z', changedBy: ORGANISATION_IRI }], scores: null }, { versionTag: 'v1', contentId, publishedAt: '2026-10-01T00:00:00Z', statusHistory: [{ registrationStatus: 'Standard', changedAt: '2026-10-01T00:00:00Z', changedBy: ORGANISATION_IRI }], scores: { agreementWithRaters: 0.7 } }] } : null),
	layerVersionRecordFor: (address, done) => done('', address.layerKey === 'toyJudge' && address.versionTag === 'v1' ? { authorAgentIri: JUDGE_IRI, publishedAt: '2026-10-01T00:00:00Z', latestStatus: { registrationStatus: 'Standard', changedAt: '2026-10-01T00:00:00Z' }, countByStandard: { toy: { rowCount: 3, mappedCount: 2, abstainedCount: 1 } }, countByHub: { ToyHub: { rowCount: 3, mappedCount: 2, abstainedCount: 1 } }, abstentionRate: 1 / 3, agreementScores: null } : null),
	manifestInventoryFor: (address, done) => done('', address.publicLabel === 'toyLabel' || address.manifestRefId === toyManifestRefId ? { manifestRefId: toyManifestRefId, publicLabel: 'toyLabel', publishedAt: '2026-10-27T00:00:00Z', latestStatus: { registrationStatus: 'Candidate', changedAt: '2026-10-27T00:00:00Z' }, standardList: [{ standardName: 'Toy', standardVersion: '1.2.3' }], hubList: [{ hubName: 'ToyHub', hubVersion: '1.0' }], layerVersionList: [{ layerKey: 'toyJudge', versionTag: 'v1' }], nodeCount: 12, edgeCount: 30 } : null),
	rootCountsFor: (done) => done('', { manifestCount: 2, layerCount: 1, layerVersionCount: 2, agentCount: 3 }),
	publishedManifestListFor: (paging, done) => done('', { totalCount: 2, manifestList: manifestList.slice((paging.pageNumber - 1) * paging.pageSize, paging.pageNumber * paging.pageSize).map((oneManifest) => ({ manifestRefId: oneManifest.manifestRefId, publicLabel: oneManifest.publicLabel, publishedAt: oneManifest.publishedAt, latestStatus: oneManifest.latestStatus })) }),
	manifestStandardListFor: (address, done) => done('', address.publicLabel === 'toyLabel' || address.manifestRefId === toyManifestRefId ? { manifestRefId: toyManifestRefId, publicLabel: 'toyLabel', standardList: [{ standardName: 'Toy', standardVersion: '1.2.3', standardKey: 'toy', elementCount: 1201, schemaBlockRefId: heldRefId }] } : null),
	// 1,201 stated elements: three pages at the scheme's fixed page size of 500
	manifestElementListFor: (address, query, done) => done('', query.standardName === 'Toy' ? { totalCount: 1201, elementList: Array.from({ length: 1201 }, (unused, elementIndex) => ({ elementStableId: `toy:property/E${String(elementIndex).padStart(4, '0')}`, role: 'DmeProperty' })).slice((query.pageNumber - 1) * query.pageSize, query.pageNumber * query.pageSize) } : null),
	agentListFor: (paging, done) => done('', { totalCount: 1, agentList: [{ profile: { agentIri: 'https://w3id.org/EDUcore/agent/raterPseudonym7', agentKind: 'person', displayName: 'rater 7', emailAddress: 'leak@example.org' } }] }),
	manifestHubListFor: (address, done) => done('', address.publicLabel === 'toyLabel' || address.manifestRefId === toyManifestRefId ? { manifestRefId: toyManifestRefId, publicLabel: 'toyLabel', hubList: [{ hubName: 'CTDL', hubVersion: 'Release 20260927', hubSegment: 'CTDL', hubReleaseSegment: 'Release_20260927', cardCount: 3, domainCount: 2 }] } : null),
	hubDomainListFor: (address, query, done) => done('', query.hubSegment === 'CTDL' ? { totalCount: 2, domainList: [{ domainId: 'ceterms:Diploma', domainName: 'Diploma', domainUri: 'ceterms:Diploma', domainDefinition: 'a diploma', cardCount: 2 }, { domainId: 'ceterms:ResearchDoctorate', domainName: 'Research Doctorate', domainUri: 'ceterms:ResearchDoctorate', domainDefinition: 'a doctorate', cardCount: 1 }] } : null),
	hubDomainCardListFor: (address, query, done) => done('', query.domainId === 'ceterms:Diploma' ? { totalCount: 2, cardList: [{ meaningIri: 'https://w3id.org/EDUcore/CTDL/hub/Release_20260927/00084cdd', label: 'Approved By', definition: 'Agent that pronounces favorable judgment for this resource.', propertyName: 'Approved By', propertyKey: 'ceterms:approvedBy', referenceTier: 'property' }, { meaningIri: 'https://w3id.org/EDUcore/CTDL/hub/Release_20260927/000ca7db', label: 'x', definition: 'y', propertyName: 'x', propertyKey: 'ceterms:x', referenceTier: 'property' }] } : null),
	layerListFor: (done) => done('', [{ layerKey: 'toyJudge', displayName: 'a toy judge layer', layerKind: 'judge', versionCount: 2, currentStandardVersionTag: 'v1' }]),
	publishedManifestFor: (address, done) => done('', manifestList.find((oneManifest) => (address.manifestRefId !== undefined ? oneManifest.manifestRefId === address.manifestRefId : oneManifest.publicLabel === address.publicLabel)) || null),
};
const curatedAssertionId = assertionIdentity.curatedAssertionIdFor({ decisionBlockHash: curatedSetHash, subjectStableId: 'toy:property/Alpha', subjectStandardName: 'Toy', subjectStandardVersion: '1.2.3', predicateCurie: 'edc:bestMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa', objectStandardName: 'ToyHub', objectStandardVersion: '1.0', authorIdList: [RATER_IRI] }).assertionId;
const fanOutAssertionId = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: 'toy:field/Two', subjectStandardName: 'Toy', subjectStandardVersion: '1.2.3', predicateCurie: 'skos:closeMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/bbbb', objectStandardName: 'ToyHub', objectStandardVersion: '1.0' }).assertionId;

const caseList = [
	{ label: 'a floating layer answers its Standard version', uriOrPath: '/EDUcore/layer/toyJudge', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.currentStandardVersion.administrationRecord.versionTag === 'v1' && resolved.body.currentStandardVersionUri === 'https://w3id.org/EDUcore/layer/toyJudge/v1' },
	{ label: 'a version answers by tag, with its effective status', uriOrPath: '/EDUcore/layer/toyJudge/v1', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.version.administrationRecord.contentId === contentId && resolved.body.effectiveRegistrationStatus === 'Standard' },
	{ label: 'a superseded version answers its EFFECTIVE status (Superseded) beside the row it was published with (Standard)', uriOrPath: '/EDUcore/layer/toyJudge/v0', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.effectiveRegistrationStatus === 'Superseded' && resolved.body.version.registrationStatus === 'Standard' },
	{ label: 'a version answers by content', uriOrPath: `edc:layer/toyJudge/sha256/${contentId}`, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.version.administrationRecord.versionTag === 'v1' },
	{ label: 'an unknown version is 404 with its reason', uriOrPath: '/EDUcore/layer/toyJudge/v9', judge: (resolved) => resolved.httpStatus === 404 && /no version tagged "v9"/.test(resolved.body.error) },
	{ label: 'a fan-out assertion answers its instance and the judged subject', uriOrPath: fanOutAssertionId, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.assertion.subjectStableId === 'toy:field/Two' && resolved.body.assertion.judgedSubjectStableId === 'toy:question/Q' },
	{ label: 'ML3.1c: a CURATED assertion URI (stored set, no record_id column) answers its row, its id recomputed by the R-c\' recipe', uriOrPath: curatedAssertionId, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.assertion.subject_id === 'toy:property/Alpha' && resolved.body.assertion.layerKey === 'toyRaters' && resolved.body.assertion.versionTag === 'r1' },
	{ label: 'ML3.1c: …and a curated assertion URI no row recomputes to is 404 by name', uriOrPath: `/EDUcore/assertion/${curatedSetHash}/${'0'.repeat(64)}`, judge: (resolved) => resolved.httpStatus === 404 && /no row of this set carries that record_id/.test(resolved.body.error) },
	{ label: 'an assertion in a block the store lacks is 404', uriOrPath: `/EDUcore/assertion/${'c'.repeat(64)}/${'d'.repeat(64)}`, judge: (resolved) => resolved.httpStatus === 404 && /no decision block/.test(resolved.body.error) },
	{ label: 'an agent answers its registry row', uriOrPath: '/agent/judge/debug:digest', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.agent.displayName === 'the debug judge' },
	// ⟪ML3⟫ interpretations resolve (SPEC §5.3): the version's assertions for the element, an explicit NoTermFound, never another layer's answer
	{ label: 'ML3: a pinned interpretation answers the version\'s assertion for the element', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property/Alpha@toyJudge/v1', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.answer === 'assertionList' && resolved.body.assertionList.length === 1 && resolved.body.assertionList[0].predicate === 'skos:exactMatch' && resolved.body.assertionList[0].assertionId === assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: 'toy:property/Alpha', subjectStandardName: 'Toy', subjectStandardVersion: '1.2.3', predicateCurie: 'skos:exactMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa', objectStandardName: 'ToyHub', objectStandardVersion: '1.0' }).assertionId },
	{ label: 'ML3: a floating interpretation follows the Standard version (v1), not merely the newest', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property/Alpha@toyJudge', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.followedVersionTag === 'v1' && resolved.body.assertionList.length === 1 },
	{ label: 'ML3: an abstained element answers NoTermFound, with its abstention row', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property/Gamma@toyJudge/v1', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.answer === 'sssom:NoTermFound' && resolved.body.assertionList.length === 1 && /abstained/.test(resolved.body.answerNote) },
	{ label: 'ML3: an element the layer never saw answers NoTermFound, holding no row', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property/Never@toyJudge/v1', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.answer === 'sssom:NoTermFound' && resolved.body.assertionList.length === 0 },
	{ label: 'ML3: a fan-out instance answers through its judged subject', uriOrPath: '/EDUcore/Toy/1.2.3/toy:field/Two@toyJudge/v1', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.assertionList.length === 1 && resolved.body.assertionList[0].judgedSubjectStableId === 'toy:question/Q' && resolved.body.assertionList[0].assertionId === fanOutAssertionId },
	{ label: 'ML3: an interpretation of an unknown version is 404 by name', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property/Alpha@toyJudge/v9', judge: (resolved) => resolved.httpStatus === 404 && /no version tagged "v9"/.test(resolved.body.error) },
	{ label: 'ML3: a declared predicate answers its definition', uriOrPath: '/EDUcore/bestMatch', judge: (resolved) => resolved.httpStatus === 200 && /chose this meaning/.test(resolved.body.definition) },
	{ label: "ML3.1: the retired '%2F' spelling of an element path is 400 (one spelling per element)", uriOrPath: '/EDUcore/Toy/1.2.3/toy:property%2FAlpha@toyJudge/v1', judge: (resolved) => resolved.httpStatus === 400 && /matches no kind/.test(resolved.body.error) },
	{ label: 'ML3.1: a question answers the manifest\'s own relationship rows for the element, with provenance', uriOrPath: '/EDUcore/manifest/toyLabel/q/Toy/1.2.3/toy:property/Alpha', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.rowList.length === 2 && resolved.body.rowList.every((oneRow) => oneRow.provenance.schemaBlockRefId === relationshipRefId && oneRow.provenance.producer === 'inferred' && oneRow.provenance.decisionBlockHash !== null) },
	{ label: 'ML3.1: the same question by manifest hash answers the same rows', uriOrPath: `/EDUcore/manifest/sha256/${toyManifestRefId}/q/Toy/1.2.3/toy:property/Alpha`, withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.rowList.length === 2 && resolved.body.manifestRefId === toyManifestRefId && resolved.body.manifestLatestStatus.registrationStatus === 'Candidate' },
	{ label: 'ML3.1: a hub question keeps only that hub\'s rows (hub segment equal to a standard name: CTDL)', uriOrPath: '/EDUcore/manifest/toyLabel/q/hub/CTDL/Toy/1.2.3/toy:property/Alpha', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.rowList.length === 1 && resolved.body.rowList[0].hubSegment === 'CTDL' },
	{ label: 'ML3.1: a hub the manifest settles by defaultLayerByHub keeps only the named producer\'s rows', uriOrPath: '/EDUcore/manifest/settledLabel/q/hub/ToyHub/Toy/1.2.3/toy:property/Alpha', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.rowList.length === 0 && resolved.body.answer === 'sssom:NoTermFound' },
	{ label: 'ML3.1: an element no relationship block maps answers NoTermFound', uriOrPath: '/EDUcore/manifest/toyLabel/q/Toy/1.2.3/toy:property/Never', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.answer === 'sssom:NoTermFound' },
	{ label: 'ML3.1: an unpublished manifest is 404 by name', uriOrPath: '/EDUcore/manifest/nobody/q/Toy/1.2.3/toy:property/Alpha', withReader: true, judge: (resolved) => resolved.httpStatus === 404 && /no published manifest/.test(resolved.body.error) },
	{ label: 'ML3.1: a schema block of an unheld standard answers its text', uriOrPath: `/EDUcore/schemaBlock/sha256/${relationshipRefId}`, withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.text === relationshipText && resolved.body.standardKeyList.join(',') === 'toyhub,toy' },
	{ label: 'ML3.1: a schema block naming a licence-held standard (edfi) is 451 with metadata and the reason, never a bare 404', uriOrPath: `/EDUcore/schemaBlock/sha256/${heldRefId}`, withReader: true, judge: (resolved) => resolved.httpStatus === 451 && resolved.body.text === undefined && resolved.body.blockKind === 'standardBase' && resolved.body.version === '5.2.0' && /Ed-Fi Alliance License/.test(resolved.body.withheldReasonList[0].unavailableReason) },
	{ label: 'ML3.1: a decision schema block of an unheld pair answers its text', uriOrPath: `/EDUcore/decisionSchemaBlock/sha256/${decisionBlockHash}`, withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.text === frozenText },
	{ label: 'ML3.1: a decision schema block whose own subjects are a held standard (edfi) is 451, whatever its stored first-use pairKey says (ruling c)', uriOrPath: `/EDUcore/decisionSchemaBlock/sha256/${heldDecisionBlockHash}`, withReader: true, judge: (resolved) => resolved.httpStatus === 451 && resolved.body.standardKeyList.join(',') === 'edfi' && resolved.body.withheldReasonList.length === 1 },
	{ label: 'ML3.1: a schema block uriContract lacks is 404 by name', uriOrPath: `/EDUcore/schemaBlock/sha256/${'f'.repeat(64)}`, withReader: true, judge: (resolved) => resolved.httpStatus === 404 && /not in uriContract/.test(resolved.body.error) },
	{ label: 'ML3.1: without a uriContract reader a question is 501 by name', uriOrPath: '/EDUcore/manifest/toyLabel/q/Toy/1.2.3/toy:property/Alpha', judge: (resolved) => resolved.httpStatus === 501 && /without a uriContract reader/.test(resolved.body.error) },
	{ label: 'ML3.1 (Q3): a person answers a profile plus a computed record, and ONLY the declared fields (no e-mail, no username)', uriOrPath: '/EDUcore/agent/raterPseudonym7', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.kind === 'agentPerson' && resolved.body.displayName === 'rater 7' && (resolved.body.aliasIriList || [])[0] === 'https://orcid.org/0000-0000-0000-0007' && resolved.body.layersAuthored.length === 1 && resolved.body.scores.agreementWithRaters === 0.8 && resolved.body.emailAddress === undefined && resolved.body.userName === undefined },
	{ label: 'ML3.1 (Q3): an agent uriContract lacks is 404 by name', uriOrPath: '/EDUcore/agent/judge/nobody', withReader: true, judge: (resolved) => resolved.httpStatus === 404 && /not in uriContract/.test(resolved.body.error) },
	{ label: 'ML3.1: without a uriContract reader a manifest is 501 by name', uriOrPath: '/EDUcore/manifest/toyLabel', judge: (resolved) => resolved.httpStatus === 501 && /without a uriContract reader/.test(resolved.body.error) },
	// ⟪ML3.1, TQ Q4⟫ every URI answers the thing PLUS its relations
	{ label: 'Q4: an element answers its definition, parent, siblings and an interpretation URI per published layer', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property/Alpha', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.definitionText === 'the alpha slot' && resolved.body.parent === 'https://w3id.org/EDUcore/Toy/1.2.3/toy:class/Root' && resolved.body.siblingList[0] === 'https://w3id.org/EDUcore/Toy/1.2.3/toy:property/Gamma' && resolved.body.interpretationList[0].pinned === 'https://w3id.org/EDUcore/Toy/1.2.3/toy:property/Alpha@toyJudge/v1' && resolved.body.interpretationList[0].floating === 'https://w3id.org/EDUcore/Toy/1.2.3/toy:property/Alpha@toyJudge' },
	{ label: 'Q4: an element no published schema block holds is 404 by name', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property/Nowhere', withReader: true, judge: (resolved) => resolved.httpStatus === 404 && /no published schema block holds/.test(resolved.body.error) },
	{ label: 'Q4: a meaning answers who maps to it (counts by standard, layer and relation)', uriOrPath: '/EDUcore/ToyHub/hub/1.0/aaaa', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.mappedElementCount === 3 && resolved.body.mappingList[0].layerVersion === 'https://w3id.org/EDUcore/layer/toyJudge/v1' && resolved.body.mappingList[1].layerVersion === null },
	{ label: 'Q4: a floating layer answers its full history and follows its latest Standard version (v1, not the superseded v0)', uriOrPath: '/EDUcore/layer/toyJudge', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.currentStandardVersionTag === 'v1' && resolved.body.versionList.length === 2 && resolved.body.versionList[0].statusHistory.length === 2 && resolved.body.versionList[1].scores.agreementWithRaters === 0.7 },
	{ label: 'Q4: a layer version answers its counts, abstention rate and author', uriOrPath: '/EDUcore/layer/toyJudge/v1', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.countByStandard.toy.mappedCount === 2 && Math.abs(resolved.body.abstentionRate - 1 / 3) < 1e-9 && resolved.body.authorAgentIri === JUDGE_IRI },
	{ label: 'Q4: a layer version by content answers the same record', uriOrPath: `/EDUcore/layer/toyJudge/sha256/${contentId}`, withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.versionTag === 'v1' && resolved.body.countByHub.ToyHub.rowCount === 3 },
	{ label: 'Q4: a manifest answers its inventory (standards, hubs, layers, counts, status)', uriOrPath: '/EDUcore/manifest/toyLabel', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.nodeCount === 12 && resolved.body.edgeCount === 30 && resolved.body.latestStatus.registrationStatus === 'Candidate' && resolved.body.layerVersionList[0].uri === 'https://w3id.org/EDUcore/layer/toyJudge/v1' },
	{ label: 'Q4: the same inventory by manifest hash', uriOrPath: `/EDUcore/manifest/sha256/${toyManifestRefId}`, withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.publicLabel === 'toyLabel' },
	// ⟪ML3.1, TQ Q5⟫ discovery
	{ label: 'Q5: the root answers its entry points with counts', uriOrPath: '/EDUcore/', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.entryPointList.map((oneEntry) => oneEntry.kind).join(',') === 'scheme,manifestList,siteLayerRegistry,agentList' && resolved.body.entryPointList[1].count === 2 },
	{ label: 'Q5: the scheme answers itself, the very object the parser compiled (no reader needed)', uriOrPath: '/EDUcore/scheme', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.uriScheme === require('../uriScheme.json') && resolved.body.reservedWordList.indexOf('standards') !== -1 },
	{ label: 'Q5: the manifest listing is paged', uriOrPath: '/EDUcore/manifests', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.totalCount === 2 && resolved.body.pageCount === 1 && resolved.body.next === null && resolved.body.manifestList[0].manifest === 'https://w3id.org/EDUcore/manifest/toyLabel' },
	{ label: "Q5: a manifest's standards carry element counts and their element-listing URIs", uriOrPath: '/EDUcore/manifest/toyLabel/standards', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.standardList[0].elementCount === 1201 && resolved.body.standardList[0].elementListing === 'https://w3id.org/EDUcore/manifest/toyLabel/standards/Toy/1.2.3/elements' },
	{ label: 'Q5: …and by manifest hash the listing URIs stay in the hash form', uriOrPath: `/EDUcore/manifest/sha256/${toyManifestRefId}/standards`, withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.standardList[0].elementListing === `https://w3id.org/EDUcore/manifest/sha256/${toyManifestRefId}/standards/Toy/1.2.3/elements` },
	{ label: 'Q5: an element listing, page 1 of 3, links its next page and mints element and question URIs', uriOrPath: '/EDUcore/manifest/toyLabel/standards/Toy/1.2.3/elements', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.pageCount === 3 && resolved.body.elementList.length === 500 && resolved.body.next === 'https://w3id.org/EDUcore/manifest/toyLabel/standards/Toy/1.2.3/elements?page=2' && resolved.body.previous === null && resolved.body.elementList[0].question === 'https://w3id.org/EDUcore/manifest/toyLabel/q/Toy/1.2.3/toy:property/E0000' },
	{ label: 'Q5: page 3 holds the last 201 and has no next', uriOrPath: '/EDUcore/manifest/toyLabel/standards/Toy/1.2.3/elements?page=3', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.elementList.length === 201 && resolved.body.next === null && resolved.body.previous === 'https://w3id.org/EDUcore/manifest/toyLabel/standards/Toy/1.2.3/elements?page=2' },
	{ label: 'Q5: a page past the end is 400 by name, never clamped', uriOrPath: '/EDUcore/manifest/toyLabel/standards/Toy/1.2.3/elements?page=4', withReader: true, judge: (resolved) => resolved.httpStatus === 400 && /past the end/.test(resolved.body.error) },
	{ label: 'Q5: page 0 is 400 by name', uriOrPath: '/EDUcore/manifests?page=0', withReader: true, judge: (resolved) => resolved.httpStatus === 400 && /not \?page=N/.test(resolved.body.error) },
	{ label: 'Q5: a client page size is refused (the size is fixed)', uriOrPath: '/EDUcore/manifests?page=1&pageSize=5', withReader: true, judge: (resolved) => resolved.httpStatus === 400 && /not \?page=N/.test(resolved.body.error) },
	{ label: 'Q5: a query on a kind that is not a listing is 400 by name', uriOrPath: '/EDUcore/layer/toyJudge?page=1', withReader: true, judge: (resolved) => resolved.httpStatus === 400 && /takes no query/.test(resolved.body.error) },
	{ label: 'Q5: the agent listing shows profiles only (no e-mail)', uriOrPath: '/EDUcore/agents', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.agentList.length === 1 && resolved.body.agentList[0].displayName === 'rater 7' && resolved.body.agentList[0].emailAddress === undefined },
	// ⟪ML3.1, TQ Q7⟫ card listings
	{ label: "Q7: a manifest's hubs carry card and domain counts and their domain-listing URI (release in the URI)", uriOrPath: '/EDUcore/manifest/toyLabel/hubs', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.hubList[0].cardCount === 3 && resolved.body.hubList[0].domainListing === 'https://w3id.org/EDUcore/manifest/toyLabel/hubs/CTDL/Release_20260927/domains' },
	{ label: 'Q7: a hub release lists its own domains (CTDL classes), each with its card-listing URI', uriOrPath: '/EDUcore/manifest/toyLabel/hubs/CTDL/Release_20260927/domains', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.totalCount === 2 && resolved.body.domainList[0].cardListing === 'https://w3id.org/EDUcore/manifest/toyLabel/hubs/CTDL/Release_20260927/domains/ceterms:Diploma/cards' },
	{ label: "Q7: a domain's cards carry meaning URI, label and definition (paged)", uriOrPath: '/EDUcore/manifest/toyLabel/hubs/CTDL/Release_20260927/domains/ceterms:Diploma/cards', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.cardList.length === 2 && resolved.body.cardList[0].label === 'Approved By' && resolved.body.pageCount === 1 },
	{ label: 'Q7: by manifest hash the domain-listing URIs stay in the hash form', uriOrPath: `/EDUcore/manifest/sha256/${toyManifestRefId}/hubs`, withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.hubList[0].domainListing === `https://w3id.org/EDUcore/manifest/sha256/${toyManifestRefId}/hubs/CTDL/Release_20260927/domains` },
	{ label: 'Q7: a domain the hub does not hold is 404 by name', uriOrPath: '/EDUcore/manifest/toyLabel/hubs/CTDL/Release_20260927/domains/ceterms:Nothing/cards', withReader: true, judge: (resolved) => resolved.httpStatus === 404 && /holds domain ceterms:Nothing/.test(resolved.body.error) },
	{ label: 'Q7: a card listing past its end is 400, never clamped', uriOrPath: '/EDUcore/manifest/toyLabel/hubs/CTDL/Release_20260927/domains/ceterms:Diploma/cards?page=2', withReader: true, judge: (resolved) => resolved.httpStatus === 400 && /past the end/.test(resolved.body.error) },
	{ label: 'the site registry lists the layers with their URIs', uriOrPath: '/EDUcore/registry/layers', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.layerList[0].layer === 'https://w3id.org/EDUcore/layer/toyJudge' },
	{ label: 'a path naming no kind is 400', uriOrPath: '/EDUcore/a/b', judge: (resolved) => resolved.httpStatus === 400 && /matches no kind/.test(resolved.body.error) },
	{ label: 'every answer says it came from the local stub', uriOrPath: '/EDUcore/layer/toyJudge', judge: (resolved) => /LOCAL STUB/.test(resolved.body.stubNote) },
];

harness.section('the stub answers by SPEC §5.3, for the kinds ML1 resolves');
harness.equal('⟪ML3.1⟫ every kind of the scheme has a resolution (none answers 501 for want of a row)', require('../edcUri').KIND_LIST.filter((oneKind) => require('../stubResolver').RESOLUTION_BY_KIND[oneKind] === undefined).join(','), '');
harness.equal('a w3id-spelled request path maps to the edc IRI', edcIriFor('/EDUcore/layer/jev'), 'https://w3id.org/EDUcore/layer/jev');
const runCase = (caseIndex) => {
	if (caseIndex >= caseList.length) {
		resolveEdcUri({ uriOrPath: '/EDUcore/layer/jev' }, (refusal) => {
			harness.match('the resolver refuses to run without its injected lookups', refusal, /registry and blockTextForHash are required/);
			harness.report();
		});
		return;
	}
	const oneCase = caseList[caseIndex];
	resolveEdcUri({ uriOrPath: oneCase.uriOrPath, registry, blockTextForHash, uriContractReader: oneCase.withReader ? uriContractReader : undefined }, (resolveError, resolved) => {
		harness.ok(oneCase.label, !resolveError && oneCase.judge(resolved), resolveError || JSON.stringify(resolved).slice(0, 400));
		runCase(caseIndex + 1);
	});
};
runCase(0);
