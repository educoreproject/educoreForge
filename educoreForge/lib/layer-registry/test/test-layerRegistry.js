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
const memberBlockListFor = (letter) => [{ pairKey: `ceds@14.0.0.0::toy@1::layer.toyCurated::curated`, decisionBlockHash: letter.repeat(64) }];
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
harness.equal('layer jev carries the two Jev configurations of the gold, tagged by their cfg- tail', jevLayer.versionList.map((oneVersion) => oneVersion.administrationRecord.versionTag).sort().join(','), 'cfg-03f64470322c,cfg-cf8d41f82791');
jevLayer.versionList.forEach((oneVersion) => {
	harness.equal(`jev ${oneVersion.administrationRecord.versionTag}: contentId = sha256 of its ${oneVersion.memberBlockList.length} sorted member hashes (R-1)`, oneVersion.administrationRecord.contentId, contentIdForMemberBlockList(oneVersion.memberBlockList));
	harness.equal(`jev ${oneVersion.administrationRecord.versionTag}: status Standard`, oneVersion.registrationStatus, 'Standard');
});

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
