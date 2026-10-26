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
const blockTextForHash = (requestedHash, done) => done('', requestedHash === decisionBlockHash ? frozenText : null);
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
const { registry } = registryFor({
	agentRegistry: { agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' }, { agentIri: JUDGE_IRI, agentKind: 'judge', displayName: 'the debug judge' }] },
	layerRegistry: {
		registrationAuthorityIri: ORGANISATION_IRI,
		registrarIri: ORGANISATION_IRI,
		layerList: [{ layerKey: 'toyJudge', displayName: 'a toy judge layer', layerKind: 'judge', authorAgentIri: JUDGE_IRI, standardList: [{ standardKey: 'toy', standardName: 'Toy', sourceIri: 'urn:educore:toy:' }], hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }], versionList: [versionFor({ versionTag: 'v0', registrationStatus: 'Standard', publishedAt: '2026-09-01T00:00:00Z', versionMemberBlockList: earlierMemberBlockList }), versionFor({ versionTag: 'v1', registrationStatus: 'Standard', publishedAt: '2026-10-01T00:00:00Z' })], statusChangeList: [{ versionTag: 'v0', registrationStatus: 'Superseded', changedAt: '2026-10-02T00:00:00Z', changedBy: ORGANISATION_IRI, supersededByVersionTag: 'v1' }] }],
	},
});
// ⟪ML3.1⟫ the uriContractReader DOUBLE (the interface lib/uri-contract implements): one manifest, one relationship schema block whose
// element toy:property/Alpha has an edge to a ToyHub card and one to a CTDL card, plus a licence-held standardBase and decision block
const sha256Of = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const relationshipEdgeLine = (hubCardIri, assertionHash) => JSON.stringify({ kind: 'edge', type: 'EXACT_MATCH', fromRef: { source: 'Toy', id: 'toy:property/Alpha' }, toRef: { source: 'X', id: hubCardIri }, properties: { assertionId: [`https://w3id.org/EDUcore/assertion/${decisionBlockHash}/${assertionHash}`], decisionBlockHash: [decisionBlockHash], judgeIdentity: ['debug:digest'], mappingSource: ['bridge-debug'], matchBasis: ['derived'], mappingKind: ['inferred'], predicate: ['exactMatch'], objectSource: ['X'], objectVersion: ['1.0'], subjectSource: ['Toy'], subjectVersion: ['1.2.3'] } });
const relationshipText = [JSON.stringify({ kind: 'header', blockType: 'relationship', pairA: 'toyhub', pairAVersion: '1.0', pairB: 'toy', pairBVersion: '1.2.3', producer: 'inferred' }), JSON.stringify({ kind: 'node', ref: { source: 'Toy', id: 'toy:property/Alpha' } }), relationshipEdgeLine('https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa', '1'.repeat(64)), relationshipEdgeLine('https://w3id.org/EDUcore/CTDL/hub/Release_20260927/cccc', '2'.repeat(64))].join('\n');
const relationshipRefId = sha256Of(relationshipText);
const heldText = JSON.stringify({ kind: 'header', blockType: 'standardBase', standardKey: 'edfi', version: '5.2.0' });
const heldRefId = sha256Of(heldText);
const heldFrozenText = JSON.stringify({ header: { sourceStandardName: 'EdFi' }, decisionRecordList: [] });
const heldDecisionBlockHash = sha256Of(heldFrozenText);
const toyManifestRefId = sha256Of('toy manifest');
const schemaBlockByRefId = { [relationshipRefId]: { schemaBlockRefId: relationshipRefId, blockKind: 'relationship', subject: 'toyhub@1_0_rel_toy@1_2_3_close', version: '1.0', text: relationshipText }, [heldRefId]: { schemaBlockRefId: heldRefId, blockKind: 'standardBase', subject: 'edfi@5_2_0_base', version: '5.2.0', text: heldText } };
const manifestFor = (publicLabel, defaultLayerByHub) => ({ manifestRefId: publicLabel === 'toyLabel' ? toyManifestRefId : sha256Of(publicLabel), publicLabel, publishedAt: '2026-10-27T00:00:00Z', latestStatus: { registrationStatus: 'Candidate', changedAt: '2026-10-27T00:00:00Z' }, memberList: [{ schemaBlockRefId: heldRefId, position: 0 }, { schemaBlockRefId: relationshipRefId, position: 1 }], defaultLayerByHub });
const manifestList = [manifestFor('toyLabel', null), manifestFor('settledLabel', { ToyHub: { decisionBlockHashList: ['9'.repeat(64)] } })];
const uriContractReader = {
	schemaBlockFor: (schemaBlockRefId, done) => done('', schemaBlockByRefId[schemaBlockRefId] === undefined ? null : schemaBlockByRefId[schemaBlockRefId]),
	decisionSchemaBlockFor: (requestedHash, done) => done('', requestedHash === decisionBlockHash ? { decisionBlockHash, pairKey: memberBlockList[0].pairKey, frozenText } : requestedHash === heldDecisionBlockHash ? { decisionBlockHash: heldDecisionBlockHash, pairKey: 'ceds@14.0.0.0::edfi@5.2.0::edfiBridging::inferred', frozenText: heldFrozenText } : null),
	agentRecordFor: (agentIri, done) => done('', agentIri === 'https://w3id.org/EDUcore/agent/raterPseudonym7' ? { profile: { agentIri, agentKind: 'person', displayName: 'rater 7', emailAddress: 'leak@example.org', userName: 'realName' }, layersAuthored: [{ layerKey: 'rater-07', versionTag: 'r1' }], scores: { agreementWithRaters: 0.8 } } : null),
	publishedManifestFor: (address, done) => done('', manifestList.find((oneManifest) => (address.manifestRefId !== undefined ? oneManifest.manifestRefId === address.manifestRefId : oneManifest.publicLabel === address.publicLabel)) || null),
};
const fanOutAssertionId = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: 'toy:field/Two', subjectStandardName: 'Toy', subjectStandardVersion: '1.2.3', predicateCurie: 'skos:closeMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/bbbb', objectStandardName: 'ToyHub', objectStandardVersion: '1.0' }).assertionId;

const caseList = [
	{ label: 'a floating layer answers its Standard version', uriOrPath: '/EDUcore/layer/toyJudge', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.currentStandardVersion.administrationRecord.versionTag === 'v1' && resolved.body.currentStandardVersionUri === 'https://w3id.org/EDUcore/layer/toyJudge/v1' },
	{ label: 'a version answers by tag, with its effective status', uriOrPath: '/EDUcore/layer/toyJudge/v1', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.version.administrationRecord.contentId === contentId && resolved.body.effectiveRegistrationStatus === 'Standard' },
	{ label: 'a superseded version answers its EFFECTIVE status (Superseded) beside the row it was published with (Standard)', uriOrPath: '/EDUcore/layer/toyJudge/v0', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.effectiveRegistrationStatus === 'Superseded' && resolved.body.version.registrationStatus === 'Standard' },
	{ label: 'a version answers by content', uriOrPath: `edc:layer/toyJudge/sha256/${contentId}`, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.version.administrationRecord.versionTag === 'v1' },
	{ label: 'an unknown version is 404 with its reason', uriOrPath: '/EDUcore/layer/toyJudge/v9', judge: (resolved) => resolved.httpStatus === 404 && /no version tagged "v9"/.test(resolved.body.error) },
	{ label: 'a fan-out assertion answers its instance and the judged subject', uriOrPath: fanOutAssertionId, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.assertion.subjectStableId === 'toy:field/Two' && resolved.body.assertion.judgedSubjectStableId === 'toy:question/Q' },
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
	{ label: 'ML3.1: a decision schema block of a held pair (edfi) is 451 with the reason', uriOrPath: `/EDUcore/decisionSchemaBlock/sha256/${heldDecisionBlockHash}`, withReader: true, judge: (resolved) => resolved.httpStatus === 451 && resolved.body.pairKey.indexOf('edfi@') !== -1 && resolved.body.withheldReasonList.length === 1 },
	{ label: 'ML3.1: a schema block uriContract lacks is 404 by name', uriOrPath: `/EDUcore/schemaBlock/sha256/${'f'.repeat(64)}`, withReader: true, judge: (resolved) => resolved.httpStatus === 404 && /not in uriContract/.test(resolved.body.error) },
	{ label: 'ML3.1: without a uriContract reader a question is 501 by name', uriOrPath: '/EDUcore/manifest/toyLabel/q/Toy/1.2.3/toy:property/Alpha', judge: (resolved) => resolved.httpStatus === 501 && /without a uriContract reader/.test(resolved.body.error) },
	{ label: 'ML3.1 (Q3): a person answers a profile plus a computed record, and ONLY the declared fields (no e-mail, no username)', uriOrPath: '/EDUcore/agent/raterPseudonym7', withReader: true, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.kind === 'agentPerson' && resolved.body.displayName === 'rater 7' && resolved.body.layersAuthored.length === 1 && resolved.body.scores.agreementWithRaters === 0.8 && resolved.body.emailAddress === undefined && resolved.body.userName === undefined },
	{ label: 'ML3.1 (Q3): an agent uriContract lacks is 404 by name', uriOrPath: '/EDUcore/agent/judge/nobody', withReader: true, judge: (resolved) => resolved.httpStatus === 404 && /not in uriContract/.test(resolved.body.error) },
	{ label: 'a manifest is 501 by name (ML5)', uriOrPath: '/EDUcore/manifest/toyLabel', judge: (resolved) => resolved.httpStatus === 501 && /does not resolve kind 'manifest'/.test(resolved.body.error) },
	{ label: 'a path naming no kind is 400', uriOrPath: '/EDUcore/a/b/c/d/e/f/g', judge: (resolved) => resolved.httpStatus === 400 && /matches no kind/.test(resolved.body.error) },
	{ label: 'every answer says it came from the local stub', uriOrPath: '/EDUcore/layer/toyJudge', judge: (resolved) => /LOCAL STUB/.test(resolved.body.stubNote) },
];

harness.section('the stub answers by SPEC §5.3, for the kinds ML1 resolves');
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
