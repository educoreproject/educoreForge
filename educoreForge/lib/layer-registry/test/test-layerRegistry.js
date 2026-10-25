#!/usr/bin/env node
'use strict';

// test-layerRegistry.js — the mapping-layer registry's refusals and its seed (mappingLayers ML1-b; SPEC §3.3, §4.5, §7; rulings
// R-1, R-2, R-3 of DESIGN-ML1a). Each named refusal is OBSERVED on a fixture that STATES its fault (it is built from a small
// literal registry here, never by spreading the production file, so a later change to recipes/layers.json cannot quietly heal a
// twin). The seeded recipes/layers.json loads, and each Jev version's content id re-derives from its member blocks.
//
// Run: node lib/layer-registry/test/test-layerRegistry.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/layer-registry

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the registry refuses by name: an unknown layerKey, a reassigned tag, a status outside the ISO/IEC 11179-6 lifecycle
     list, a version without a full administration record, a content id that does not match its basis, and an agent the agent
     registry does not list. Proves the seeded registry loads and that a floating layer follows its Standard version. Holds R-2
     (layer producer kinds are not sibling-conflict kinds) and R-3 (the Profile row for matchBasis curated exists).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const layerRegistryLib = require('../layerRegistry');
const vocabularyLib = require('../../vocabulary/vocabulary');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const { registryFor, loadRegistry, contentIdForMemberBlockList, LAYER_REGISTRY_SCHEMA } = layerRegistryLib;

// a small STATED world: one organisation, one person, one curated layer with one Candidate and one Standard version
const ORGANISATION_IRI = 'https://w3id.org/EDUcore/agent/org/educore';
const PERSON_IRI = 'https://w3id.org/EDUcore/agent/u-0005';
const agentRegistry = {
	agentList: [
		{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' },
		{ agentIri: PERSON_IRI, agentKind: 'person', displayName: 'rater 05, survey A' },
	],
};
const memberBlockListFor = (letter) => [{ pairKey: `toyhub@1.0::toy@1::layer.toyCurated::curated`, decisionBlockHash: letter.repeat(64) }];
const versionFor = ({ letter, versionTag, registrationStatus, publishedAt }) => ({
	administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: PERSON_IRI, publishedAt, contentId: letter.repeat(64), versionTag },
	registrationStatus,
	authorAgentIri: PERSON_IRI,
	contentIdBasis: 'frozenSetBytes',
	wholeSetBlock: { pairKey: 'layerSet::toyCurated', decisionBlockHash: letter.repeat(64) },
	memberBlockList: memberBlockListFor(letter),
});
const statedLayerRegistry = () => ({
	registrationAuthorityIri: ORGANISATION_IRI,
	registrarIri: ORGANISATION_IRI,
	layerList: [
		{
			layerKey: 'toyCurated',
			displayName: 'a toy curator',
			layerKind: 'curated',
			authorAgentIri: PERSON_IRI,
			standardList: [{ standardKey: 'toy', standardName: 'Toy', sourceIri: 'urn:educore:toy:' }],
			hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }],
			versionList: [
				versionFor({ letter: 'a', versionTag: 'r1', registrationStatus: 'Standard', publishedAt: '2026-10-01T00:00:00Z' }),
				versionFor({ letter: 'b', versionTag: 'r2', registrationStatus: 'Candidate', publishedAt: '2026-10-02T00:00:00Z' }),
			],
			statusChangeList: [],
		},
	],
});
// faultedRegistry(mutate) → a fresh stated registry with ONE fault applied by mutate(theOneLayer)
const faultedRegistry = (mutate) => {
	const layerRegistry = statedLayerRegistry();
	mutate(layerRegistry.layerList[0]);
	return registryFor({ layerRegistry, agentRegistry });
};

// =====================================================================
harness.section('the stated registry loads; a floating layer follows its Standard version, not its newest');
// =====================================================================

const stated = registryFor({ layerRegistry: statedLayerRegistry(), agentRegistry });
harness.ok('the stated registry is accepted', stated.error === undefined, stated.error);
harness.equal('currentStandardVersionFor follows the Standard r1, not the newer Candidate r2', stated.registry.currentStandardVersionFor('toyCurated').version.administrationRecord.versionTag, 'r1');
harness.equal('versionFor finds a version by tag', stated.registry.versionFor({ layerKey: 'toyCurated', versionTag: 'r2' }).version.registrationStatus, 'Candidate');

// =====================================================================
harness.section('each refusal, observed by name on a fixture that states its fault');
// =====================================================================

harness.match('an unknown layerKey is refused by name', stated.registry.layerFor('raters').error, /layerKey "raters" is not in the registry/);
harness.match('a REASSIGNED tag is refused', faultedRegistry((oneLayer) => { oneLayer.versionList[1].administrationRecord.versionTag = 'r1'; }).error, /tag 'r1' is REASSIGNED/);
harness.match('a status outside the ISO/IEC 11179 lifecycle list is refused', faultedRegistry((oneLayer) => { oneLayer.versionList[0].registrationStatus = 'Approved'; }).error, /registrationStatus "Approved" is not an ISO\/IEC 11179-6 lifecycle status/);
harness.match('a documentation status (Historical) is not a lifecycle status either', faultedRegistry((oneLayer) => { oneLayer.versionList[0].registrationStatus = 'Historical'; }).error, /"Historical" is not an ISO\/IEC 11179-6 lifecycle status/);
// STATED, not read from the schema: a field dropped from the schema must turn this red, not shrink the loop (WORKORDER ML1-b)
const ADMINISTRATION_RECORD_FIELD_LIST = ['registrationAuthority', 'registrar', 'submitter', 'publishedAt', 'contentId', 'versionTag'];
harness.equal('the schema requires exactly the six administration-record fields the order names', LAYER_REGISTRY_SCHEMA.administrationRecordFieldList.join(','), ADMINISTRATION_RECORD_FIELD_LIST.join(','));
ADMINISTRATION_RECORD_FIELD_LIST.forEach((oneField) => {
	harness.match(`a version whose administration record lacks '${oneField}' is refused`, faultedRegistry((oneLayer) => { delete oneLayer.versionList[0].administrationRecord[oneField]; }).error, new RegExp(`administration record lacks '${oneField}'`));
});
harness.match('a version with no administration record at all is refused', faultedRegistry((oneLayer) => { delete oneLayer.versionList[0].administrationRecord; }).error, /a version has no administrationRecord/);
harness.match('a content id that does not match its basis is refused', faultedRegistry((oneLayer) => { oneLayer.versionList[0].wholeSetBlock.decisionBlockHash = 'c'.repeat(64); }).error, /does not match its basis 'frozenSetBytes'/);
harness.match('an agent the agent registry does not list is refused', faultedRegistry((oneLayer) => { oneLayer.versionList[0].administrationRecord.registrar = 'https://w3id.org/EDUcore/agent/u-9999'; }).error, /agent "https:\/\/w3id.org\/EDUcore\/agent\/u-9999" is not in the agent registry/);
harness.match('two tags naming the same content are refused (one version, one tag)', faultedRegistry((oneLayer) => { oneLayer.versionList[1] = versionFor({ letter: 'a', versionTag: 'r2', registrationStatus: 'Candidate', publishedAt: '2026-10-02T00:00:00Z' }); }).error, /tags 'r1' and 'r2' name the same content/);
harness.match('a layerKind naming no producer kind is refused', faultedRegistry((oneLayer) => { oneLayer.layerKind = 'oracle'; }).error, /layerKind "oracle" names no decision-block producer kind/);
harness.match('a hub list without sourceIri is refused (R-4 splits a set by it)', faultedRegistry((oneLayer) => { delete oneLayer.hubList[0].sourceIri; }).error, /hubList must list/);
harness.match('an agent whose stated kind is not its IRI kind is refused', registryFor({ layerRegistry: statedLayerRegistry(), agentRegistry: { agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'person', displayName: 'x' }] } }).error, /says agentKind 'person', its IRI is a 'organisation'/);
harness.match('a missing registry file is refused, never defaulted', loadRegistry({ layerRegistryFilePath: '/nonexistent/layers.json', agentRegistryFilePath: '/nonexistent/agents.json' }).error, /does not exist/);
const appended = stated.registry.withAppendedVersion({ layerKey: 'toyCurated', version: versionFor({ letter: 'd', versionTag: 'r1', registrationStatus: 'Candidate', publishedAt: '2026-10-03T00:00:00Z' }) });
harness.match('withAppendedVersion refuses a reused tag and mutates nothing', appended.error, /tag 'r1' is REASSIGNED/);
harness.equal('  …the registry it was called on still has two versions', stated.registry.layerRegistry.layerList[0].versionList.length, 2);

// =====================================================================
harness.section('the seeded registry (recipes/layers.json, recipes/agents.json)');
// =====================================================================

const seeded = loadRegistry({ layerRegistryFilePath: path.join(TREE_ROOT, 'recipes', 'layers.json'), agentRegistryFilePath: path.join(TREE_ROOT, 'recipes', 'agents.json') });
harness.ok('the seeded registry loads', seeded.error === undefined, seeded.error);
const jevLayer = seeded.registry.layerFor('jev').layer;
// the seed (the zeroBacklog gold's two configurations) and the wave-1 append (BRONZE_CROWN 2026-10-24): JEDx, LIF and Open Badges were
// judged under cfg-cf8d…, so a new version spans its 12 blocks and the 6-block one is Superseded by an APPENDED change, its row untouched.
// The wave-2 append (W2A, WORKORDER-assembly-wave2-102426 W2A-1.6): CLR, CASE, EduAPI and SEDM were judged under the same cfg-cf8d…, so a
// fourth version spans 19 blocks and the wave-1 version is Superseded by a second appended change, its row untouched too.
// The wave-3 append (W3A, WORKORDER-assembly-wave3-102526 W3A-1.6): OneRoster's three standards and MedBiquitous were judged under the same
// cfg-cf8d…, so a fifth version spans 27 blocks and the wave-2 version is Superseded by a third appended change, its row untouched too
harness.equal('layer jev carries five versions: the two seeded configurations and the wave-1, wave-2 and wave-3 appends', jevLayer.versionList.map((oneVersion) => oneVersion.administrationRecord.versionTag).join(','), 'cfg-03f64470322c,cfg-cf8d41f82791,cfg-cf8d41f82791.wave1-261024,cfg-cf8d41f82791.wave2-261025,cfg-cf8d41f82791.wave3-261025');
jevLayer.versionList.forEach((oneVersion) => {
	harness.equal(`jev ${oneVersion.administrationRecord.versionTag}: contentId = sha256 of its ${oneVersion.memberBlockList.length} sorted member hashes (R-1)`, oneVersion.administrationRecord.contentId, contentIdForMemberBlockList(oneVersion.memberBlockList));
	harness.equal(`jev ${oneVersion.administrationRecord.versionTag}: the row keeps the status it was published with (Standard)`, oneVersion.registrationStatus, 'Standard');
});
harness.equal('jev cfg-cf8d41f82791 is EFFECTIVELY Superseded, by the appended change', seeded.registry.effectiveStatusFor({ layerKey: 'jev', versionTag: 'cfg-cf8d41f82791' }).registrationStatus, 'Superseded');
harness.equal('…and its successor is the wave-1 version', jevLayer.statusChangeList[0].supersededByVersionTag, 'cfg-cf8d41f82791.wave1-261024');
harness.ok('the wave-1 version holds every one of the superseded version\'s blocks, plus six', (() => { const oldSet = new Set(jevLayer.versionList[1].memberBlockList.map((oneMember) => oneMember.decisionBlockHash)); const newList = jevLayer.versionList[2].memberBlockList.map((oneMember) => oneMember.decisionBlockHash); return newList.length === oldSet.size + 6 && Array.from(oldSet).every((oneHash) => newList.indexOf(oneHash) !== -1); })());
harness.equal('jev cfg-cf8d41f82791.wave1-261024 is EFFECTIVELY Superseded, by the second appended change', seeded.registry.effectiveStatusFor({ layerKey: 'jev', versionTag: 'cfg-cf8d41f82791.wave1-261024' }).registrationStatus, 'Superseded');
harness.equal('…and its successor is the wave-2 version', (jevLayer.statusChangeList[1] || {}).supersededByVersionTag, 'cfg-cf8d41f82791.wave2-261025');
harness.ok('the wave-2 version holds every one of the wave-1 version\'s blocks, plus seven', (() => { const oldSet = new Set(jevLayer.versionList[2].memberBlockList.map((oneMember) => oneMember.decisionBlockHash)); const newList = (jevLayer.versionList[3] || { memberBlockList: [] }).memberBlockList.map((oneMember) => oneMember.decisionBlockHash); return newList.length === oldSet.size + 7 && Array.from(oldSet).every((oneHash) => newList.indexOf(oneHash) !== -1); })());
harness.equal('jev cfg-cf8d41f82791.wave2-261025 is EFFECTIVELY Superseded, by the third appended change', seeded.registry.effectiveStatusFor({ layerKey: 'jev', versionTag: 'cfg-cf8d41f82791.wave2-261025' }).registrationStatus, 'Superseded');
harness.equal('…and its successor is the wave-3 version', (jevLayer.statusChangeList[2] || {}).supersededByVersionTag, 'cfg-cf8d41f82791.wave3-261025');
harness.ok('the wave-3 version holds every one of the wave-2 version\'s blocks, plus eight', (() => { const oldSet = new Set(jevLayer.versionList[3].memberBlockList.map((oneMember) => oneMember.decisionBlockHash)); const newList = (jevLayer.versionList[4] || { memberBlockList: [] }).memberBlockList.map((oneMember) => oneMember.decisionBlockHash); return newList.length === oldSet.size + 8 && Array.from(oldSet).every((oneHash) => newList.indexOf(oneHash) !== -1); })());
harness.equal('the floating jev layer follows the wave-3 version (the effective Standard of cfg-cf8d…)', seeded.registry.effectiveStatusFor({ layerKey: 'jev', versionTag: 'cfg-cf8d41f82791.wave3-261025' }).registrationStatus, 'Standard');

// =====================================================================
harness.section('status changes: appended, never edited into a version; each refusal by name');
// =====================================================================

const changeFor = (overrides) => ({ versionTag: 'r1', registrationStatus: 'Superseded', changedAt: '2026-10-03T00:00:00Z', changedBy: ORGANISATION_IRI, supersededByVersionTag: 'r2', ...overrides });
const promoted = registryFor({ layerRegistry: { ...statedLayerRegistry(), layerList: statedLayerRegistry().layerList.map((oneLayer) => ({ ...oneLayer, statusChangeList: [changeFor({ versionTag: 'r2', registrationStatus: 'Standard', supersededByVersionTag: undefined }), changeFor({ changedAt: '2026-10-04T00:00:00Z' })] })) }, agentRegistry });
harness.ok('a promotion and a supersession, appended in time order, are accepted', promoted.error === undefined, promoted.error);
harness.equal('the floating layer now follows the promoted r2, not the superseded r1', promoted.registry.currentStandardVersionFor('toyCurated').version.administrationRecord.versionTag, 'r2');
harness.equal("…while r1's row still says the status it was published with", promoted.registry.versionFor({ layerKey: 'toyCurated', versionTag: 'r1' }).version.registrationStatus, 'Standard');
harness.match('a layer with no statusChangeList is refused (stated, never assumed)', faultedRegistry((oneLayer) => { delete oneLayer.statusChangeList; }).error, /has no statusChangeList/);
harness.match('a change naming a version the layer lacks is refused', faultedRegistry((oneLayer) => { oneLayer.statusChangeList = [changeFor({ versionTag: 'r9' })]; }).error, /names version "r9", which the layer does not have/);
harness.match('Superseded without a successor is refused', faultedRegistry((oneLayer) => { oneLayer.statusChangeList = [changeFor({ supersededByVersionTag: undefined })]; }).error, /a Superseded version names its successor/);
harness.match('a change to a status outside the 11179 list is refused', faultedRegistry((oneLayer) => { oneLayer.statusChangeList = [changeFor({ registrationStatus: 'Deprecated' })]; }).error, /"Deprecated" is not an ISO\/IEC 11179-6 lifecycle status/);
harness.match('a change out of time order is refused', faultedRegistry((oneLayer) => { oneLayer.statusChangeList = [changeFor({ changedAt: '2026-10-05T00:00:00Z' }), changeFor({ changedAt: '2026-10-04T00:00:00Z' })]; }).error, /dated before the change above it/);
harness.match('a change by an unregistered agent is refused', faultedRegistry((oneLayer) => { oneLayer.statusChangeList = [changeFor({ changedBy: 'https://w3id.org/EDUcore/agent/u-9999' })]; }).error, /changedBy a registered agent/);

// =====================================================================
harness.section('R-2 and R-3: the vocabulary rows this registry relies on');
// =====================================================================

const { LAYER_PRODUCER_KIND_LIST, MAPPING_PRODUCER_KIND_LIST, DECISION_BLOCK_PRODUCER_KIND_LIST, LAYER_MATCH_BASIS } = vocabularyLib;
harness.ok('R-2: no layer producer kind is a bridge sibling kind (the conflict detector never reads a layer as a conflict)', LAYER_PRODUCER_KIND_LIST.every((oneKind) => MAPPING_PRODUCER_KIND_LIST.indexOf(oneKind) === -1));
harness.equal('R-2: the decision store may hold exactly the bridge kinds and the layer kinds', DECISION_BLOCK_PRODUCER_KIND_LIST.join(','), MAPPING_PRODUCER_KIND_LIST.concat(LAYER_PRODUCER_KIND_LIST).join(','));
harness.ok('every human/curated/imported layer kind maps to a layer producer kind', ['human', 'curated', 'imported'].every((oneKind) => LAYER_PRODUCER_KIND_LIST.indexOf(LAYER_REGISTRY_SCHEMA.producerKindByLayerKind[oneKind]) !== -1));
const profileText = fs.readFileSync(path.join(TREE_ROOT, 'apps', 'graph-builder', 'README_BridgeDocumentation', 'README_BridgeProfile.md'), 'utf8');
harness.ok(`R-3: the Bridge Profile §3.1 carries the matchBasis row \`${LAYER_MATCH_BASIS.CURATED}\` with its date`, new RegExp(`\\n\\| \`${LAYER_MATCH_BASIS.CURATED}\` \\| [^\\n]*2026-10-24`).test(profileText));

harness.report();
