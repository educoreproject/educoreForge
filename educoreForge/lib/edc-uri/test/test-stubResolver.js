#!/usr/bin/env node
'use strict';

// test-stubResolver.js — the local edc: stub resolver's answers (mappingLayers ML1 AMENDMENT, R-5; SPEC §5.3), over a STATED
// registry and an in-memory block reader: a floating layer follows its Standard version, a version answers by tag and by content,
// an assertion answers with its one record, an agent with its row; interpretation/question kinds are 501 by name; a path that
// names no kind is 400. Pure: no store, no socket. Run: node lib/edc-uri/test/test-stubResolver.js

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
const versionFor = ({ versionTag, registrationStatus, publishedAt }) => ({
	administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI, publishedAt, contentId, versionTag },
	registrationStatus,
	authorAgentIri: JUDGE_IRI,
	contentIdBasis: 'sortedMemberBlockHashList',
	memberBlockList,
});
const { registry } = registryFor({
	agentRegistry: { agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' }, { agentIri: JUDGE_IRI, agentKind: 'judge', displayName: 'the debug judge' }] },
	layerRegistry: {
		registrationAuthorityIri: ORGANISATION_IRI,
		registrarIri: ORGANISATION_IRI,
		layerList: [{ layerKey: 'toyJudge', displayName: 'a toy judge layer', layerKind: 'judge', authorAgentIri: JUDGE_IRI, standardList: [{ standardKey: 'toy', standardName: 'Toy', sourceIri: 'urn:educore:toy:' }], hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }], versionList: [versionFor({ versionTag: 'v1', registrationStatus: 'Standard', publishedAt: '2026-10-01T00:00:00Z' })] }],
	},
});
const fanOutAssertionId = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: 'toy:field/Two', subjectStandardName: 'Toy', subjectStandardVersion: '1.2.3', predicateCurie: 'skos:closeMatch', objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/bbbb', objectStandardName: 'ToyHub', objectStandardVersion: '1.0' }).assertionId;

const caseList = [
	{ label: 'a floating layer answers its Standard version', uriOrPath: '/EDUcore/layer/toyJudge', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.currentStandardVersion.administrationRecord.versionTag === 'v1' && resolved.body.currentStandardVersionUri === 'https://w3id.org/EDUcore/layer/toyJudge/v1' },
	{ label: 'a version answers by tag', uriOrPath: '/EDUcore/layer/toyJudge/v1', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.version.administrationRecord.contentId === contentId },
	{ label: 'a version answers by content', uriOrPath: `edc:layer/toyJudge/sha256/${contentId}`, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.version.administrationRecord.versionTag === 'v1' },
	{ label: 'an unknown version is 404 with its reason', uriOrPath: '/EDUcore/layer/toyJudge/v9', judge: (resolved) => resolved.httpStatus === 404 && /no version tagged "v9"/.test(resolved.body.error) },
	{ label: 'a fan-out assertion answers its instance and the judged subject', uriOrPath: fanOutAssertionId, judge: (resolved) => resolved.httpStatus === 200 && resolved.body.assertion.subjectStableId === 'toy:field/Two' && resolved.body.assertion.judgedSubjectStableId === 'toy:question/Q' },
	{ label: 'an assertion in a block the store lacks is 404', uriOrPath: `/EDUcore/assertion/${'c'.repeat(64)}/${'d'.repeat(64)}`, judge: (resolved) => resolved.httpStatus === 404 && /no decision block/.test(resolved.body.error) },
	{ label: 'an agent answers its registry row', uriOrPath: '/agent/judge/debug:digest', judge: (resolved) => resolved.httpStatus === 200 && resolved.body.agent.displayName === 'the debug judge' },
	{ label: 'an interpretation is 501 by name (ML5)', uriOrPath: '/EDUcore/Toy/1.2.3/toy:property%2FAlpha@toyJudge/v1', judge: (resolved) => resolved.httpStatus === 501 && /does not resolve kind 'interpretationPinned'/.test(resolved.body.error) },
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
	resolveEdcUri({ uriOrPath: oneCase.uriOrPath, registry, blockTextForHash }, (resolveError, resolved) => {
		harness.ok(oneCase.label, !resolveError && oneCase.judge(resolved), resolveError || JSON.stringify(resolved).slice(0, 400));
		runCase(caseIndex + 1);
	});
};
runCase(0);
