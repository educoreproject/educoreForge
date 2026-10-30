#!/usr/bin/env node
'use strict';

// test-bridgeComposer.js — R3 of the hub-neutral bridge lane (2026-10-21): bridges composed as standard × hub must be the
// SAME bridges. The migration gate for EVERY registered bridge (the recipes of record are P-a1's; this covers all fifteen,
// including the ones in no recipe of record), plus the composer's own refusals.
//
// PROVES:
//   (a) every bridge registered at the R3 start (graphBuilder.ini [noRebuildProof] baselineDirectoryPath/
//       pluginDigestsAtR3Start.json) is registered now under the same bridgeName, standardKey and target hub, with the SAME
//       declarationDigest and the same hook names — whether it still comes from a plugin file or is now composed
//       (⟪zeroBacklog lane C, 2026-10-23⟫ a departure is declared by name: ADDED_SINCE_R3_START, RE_KEYED_SINCE_R3_START; the
//       roster file itself is never edited)
//   (b) every bridgeName frozen in any decision store (R0 census) is registered now, or is named in the retired list below
//   (c) the composer refuses by name: a hub anchor referenced out of range; a hub anchor list whose length changed since the
//       pair row was written (SCARLET_ARROW's condition: no silent shift); the same for remodel tables; a template carrying a
//       composed key; a facet without hooks; an unknown pair key; a pair whose hub was not loaded
//   (d) derived strings: the bridgeName rule reproduces every registered composed name; the legacy id-list path rule too
//   (e) the composer and its contract name no hub
//   (g) a bridge created AFTER the refactor (Q-R6 revised, SCARLET_ARROW): blinding is the UNION over every hub the standard
//       pairs with (superset, ruled), and the identifier scan is the pair hub's own ('fromHub', its list resolved beside the hub)
//   (h) the P-c overlay seam (bridgingOverlayDirPath, test/scratch only): the fixture lays edfi→ctdl over the tree; it composes
//       with the union blinding and the CTDL hub's own scan; every shipped bridge is unchanged beside it; refusals by name
//   (i) ⟪zeroBacklog lane C3, 2026-10-22⟫ declaredTargetRuleList 'fromHubStableIdTemplateRules': a declared-identity pair takes the
//       hub's stableIdTemplate rules only, in hub order, the filter stated in the pair row; 'fromHub' over a hub whose list holds
//       another kind is still refused by name at registration; an unknown value is refused by name
//   (f) never-rendered names: RENDERING_NEVER_NAME_LIST names no hub's identifier properties; they reach each bridge through its
//       composed blindingDeclaration, and BOTH nets (the declaration contract, the renderer) refuse an allow-listed blinded name

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: composed bridges are the same bridges (R3), and the composer refuses by name
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
FILES
     graphBuilder.ini [noRebuildProof] baselineDirectoryPath — pluginDigestsAtR3Start.json, frozenPairKeyCensus/
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);
const { getConfig } = process.global;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const composerLib = require('../bridgeComposer');
const pluginRegistryLib = require('../pluginRegistry');
const hubBridgingLoaderLib = require('../hubBridgingLoader');

// frozen bridgeNames that are no longer registered, each with its reason (R0 census: 16 frozen names)
const RETIRED_FROZEN_BRIDGE_NAME_REASON = Object.freeze({
	edfiCedsCrosswalkPlugin: 'retired before this lane (forges/edfi/retiredBridges/); the AEM crosswalk was withdrawn as an answer key; no recipe names it',
	// ⟪zeroBacklog lane D, D3-6, 2026-10-22⟫
	sifCedsStandardPlugin: 'retired with the old SIF forge to codeAttic/forges/sif (TQ ruling Q-Z4 under the mandate); sif260928 replaced it; no recipe of record names it',
});

// ⟪zeroBacklog lane C, 2026-10-23, ruled BRONZE_CROWN⟫ the R3-start roster (a shared baseline file) is never edited; a departure
// from it is declared here, by name, with what it is now and why. A bridge registered since the start:
// ⟪nextStandards-102326 lane B2, 2026-10-24 (SILVER_SPIRE)⟫ ADDED, in this lane's own table: JEDx's one judged facet
const ADDED_NEXT_STANDARDS_LANE_B = Object.freeze({
	jedxCedsDerivedPlugin: { standardKey: 'jedx', targetHub: 'ceds', declarationDigest: 'f7d74a99eb1b9243c007a3ea74e7c713b54e6d80cbd0eea43ec9b3eddb0aa208', hookNameList: [], reason: 'nextStandards B2: every JEDx property judged toward the CEDS hub (forges/jedx)' },
	jedxCtdlDerivedPlugin: { standardKey: 'jedx', targetHub: 'ctdl', declarationDigest: 'd912e3da76d3a2b0ec209b2c76a73dfd37e8f6a6402c16d4ae738609086b0043', hookNameList: [], reason: 'nextStandards B2: every JEDx property judged toward the CTDL hub (forges/jedx)' },
});
// ⟪nextStandards-102326 lane A2, 2026-10-23 (AZURE_MARBLE)⟫ ADDED, in this lane's own table: Open Badges 3.0's one judged facet
const ADDED_NEXT_STANDARDS_LANE_A = Object.freeze({
	openbadgesCedsDerivedPlugin: { standardKey: 'openbadges', targetHub: 'ceds', declarationDigest: '7811c14be1a42dcbe72aac9513a99068496849d58107bd4d4dfade44a8d6b202', hookNameList: [], reason: 'nextStandards A2: every Open Badges property judged toward the CEDS hub (forges/openbadges)' },
	openbadgesCtdlDerivedPlugin: { standardKey: 'openbadges', targetHub: 'ctdl', declarationDigest: '3b300c024608a79245c2112a26752696b0352aa5d756b3d51b2c4bd214e2bc5c', hookNameList: [], reason: 'nextStandards A2: every Open Badges property judged toward the CTDL hub (forges/openbadges)' },
});
// ⟪nextStandards-102326 lane C2, 2026-10-24 (STEEL_MIRROR)⟫ ADDED, in this lane's own table: LIF 2.0's one judged facet
const ADDED_NEXT_STANDARDS_LANE_C = Object.freeze({
	lifCedsDerivedPlugin: { standardKey: 'lif', targetHub: 'ceds', declarationDigest: '38acfdada0035b00617f3181224b210f212d44025766b1dc9e3ee52242ae59d7', hookNameList: [], reason: 'nextStandards C2: every LIF property judged toward the CEDS hub (forges/lif)' },
	lifCtdlDerivedPlugin: { standardKey: 'lif', targetHub: 'ctdl', declarationDigest: '8ed9604ab24a1d2c63e0ad49b62eb038b3e2e975a7fc0a6fb7f1894fa03613c9', hookNameList: [], reason: 'nextStandards C2: every LIF property judged toward the CTDL hub (forges/lif)' },
});
// ⟪nextStandards wave 2 lane E2, 2026-10-24 (HIDDEN_EMBER)⟫ ADDED, in this lane's own table: CASE 1.1's one judged facet
const ADDED_NEXT_STANDARDS_WAVE2_LANE_E = Object.freeze({
	caseCedsDerivedPlugin: { standardKey: 'case', targetHub: 'ceds', declarationDigest: '6d27c3b1a373d5714f48e1f5e5ea8f9bff1dd97b2ea717bcfaf81c494f14fd9a', hookNameList: [], reason: 'nextStandards wave 2 E2: every CASE property judged toward the CEDS hub (forges/case)' },
	caseCtdlDerivedPlugin: { standardKey: 'case', targetHub: 'ctdl', declarationDigest: '5bd23eefbc26fbb5add924eb9f6971282511a1763524fa0db82ae8811f47f20b', hookNameList: [], reason: 'nextStandards wave 2 E2: every CASE property judged toward the CTDL hub (forges/case)' },
});
// ⟪nextStandards-102326 wave 2 lane G, 2026-10-24 (RUBY_PORTAL)⟫ ADDED, in this lane's own table: SEDM's two facets, declared identity
// toward the CEDS hub (the working documents' Global ID column) and the judged Element facet toward the CTDL hub (forges/sedm)
const ADDED_NEXT_STANDARDS_WAVE2_LANE_G = Object.freeze({
	sedmCedsDeclaredIdentity: { standardKey: 'sedm', targetHub: 'ceds', declarationDigest: '290cd39cabbd9ffd19f26b9d5b954c4c120104f499a17073bb9b73bc2367eac5', hookNameList: ['subjectStableIdFor', 'walkSourceAssertions'], reason: 'nextStandards wave 2 G2: SEDM declared identity to the CEDS hub, its stableIdTemplate rules only (forges/sedm)' },
	sedmElementCtdlDerivedPlugin: { standardKey: 'sedm', targetHub: 'ctdl', declarationDigest: 'fac42e2028d37628aa5b5562990ca2277bf0a9f62a9d8c3e34afbdc916192f32', hookNameList: [], reason: 'nextStandards wave 2 G2: every SEDM element judged toward the CTDL hub (forges/sedm)' },
});
// ⟪nextStandards wave 2 lane F2, 2026-10-24 (OCEAN_SPIRE)⟫ ADDED, in this lane's own table: EduAPI 1.0's one judged facet
const ADDED_NEXT_STANDARDS_WAVE2_LANE_F = Object.freeze({
	eduapiCedsDerivedPlugin: { standardKey: 'eduapi', targetHub: 'ceds', declarationDigest: '9d8679e3673c256e837b9be7d0dea94a505aeb53d619595b21276760782b4182', hookNameList: [], reason: 'nextStandards F2: every EduAPI property judged toward the CEDS hub (forges/eduapi)' },
	eduapiCtdlDerivedPlugin: { standardKey: 'eduapi', targetHub: 'ctdl', declarationDigest: '276fbdc279f9e6759849fafd601e7f8f620aa7c90ca8ea40ad55623494d1cc86', hookNameList: [], reason: 'nextStandards F2: every EduAPI property judged toward the CTDL hub (forges/eduapi)' },
});
// ⟪nextStandards-102326 wave 2 lane D2, 2026-10-24 (QUIET_GATE)⟫ ADDED, in this lane's own table: CLR 2.0's one judged facet
const ADDED_NEXT_STANDARDS_WAVE2_LANE_D = Object.freeze({
	clrCedsDerivedPlugin: { standardKey: 'clr', targetHub: 'ceds', declarationDigest: 'b1a4f49be068eccb6d05483d99a5d7025bdd3ca7707f7d85f27e7515fd80f95e', hookNameList: [], reason: 'nextStandards wave 2 D2: every CLR property judged toward the CEDS hub (forges/clr)' },
	clrCtdlDerivedPlugin: { standardKey: 'clr', targetHub: 'ctdl', declarationDigest: '5f7cb5f7cc758785d5f1faf5585f73447b36b9b357af1feb366be5215c90e7c5', hookNameList: [], reason: 'nextStandards wave 2 D2: every CLR property judged toward the CTDL hub (forges/clr)' },
});
// ⟪nextStandards-102326 wave 3 lane H2, 2026-10-24 (MIDNIGHT_JOURNEY)⟫ ADDED, in this lane's own table: OneRoster 1.2's three standards
// (Rostering, Gradebook, Resources), each with one judged facet toward both hubs
const ADDED_NEXT_STANDARDS_WAVE3_LANE_H = Object.freeze({
	onerosterrosteringCedsDerivedPlugin: { standardKey: 'onerosterrostering', targetHub: 'ceds', declarationDigest: '6ef0d52131bdee633e372c7a35b6c655d7b68443703f62b6ae16e6120a588cf3', hookNameList: [], reason: 'nextStandards wave 3 H2: every OneRoster 1.2 Rostering property judged toward the CEDS hub (forges/onerosterrostering)' },
	onerosterrosteringCtdlDerivedPlugin: { standardKey: 'onerosterrostering', targetHub: 'ctdl', declarationDigest: '0bcb761129d5df0a6c597fab7ce019ac0f91a0d611b199966dbbb017fb675f4b', hookNameList: [], reason: 'nextStandards wave 3 H2: every OneRoster 1.2 Rostering property judged toward the CTDL hub (forges/onerosterrostering)' },
	onerostergradebookCedsDerivedPlugin: { standardKey: 'onerostergradebook', targetHub: 'ceds', declarationDigest: '2cab7ae2b7cb6d2e343ac8a5126f0c4da0f5f12f76939ea60ca29a227b70984e', hookNameList: [], reason: 'nextStandards wave 3 H2: every OneRoster 1.2 Gradebook property judged toward the CEDS hub (forges/onerostergradebook)' },
	onerostergradebookCtdlDerivedPlugin: { standardKey: 'onerostergradebook', targetHub: 'ctdl', declarationDigest: '04f59fa08b21dfbd6c2e5a4125c9728b64d1cde1902cda6c50f68454f477a27e', hookNameList: [], reason: 'nextStandards wave 3 H2: every OneRoster 1.2 Gradebook property judged toward the CTDL hub (forges/onerostergradebook)' },
	onerosterresourcesCedsDerivedPlugin: { standardKey: 'onerosterresources', targetHub: 'ceds', declarationDigest: '386b4d66fca6fb85c67996c44019d6e425d68faf0b8b476feff4147dbd6af7a2', hookNameList: [], reason: 'nextStandards wave 3 H2: every OneRoster 1.2 Resources property judged toward the CEDS hub (forges/onerosterresources)' },
	onerosterresourcesCtdlDerivedPlugin: { standardKey: 'onerosterresources', targetHub: 'ctdl', declarationDigest: '8015fc47a9128266bd24de9a2b8d8f44a1533943416c696e12496e36a4691b8b', hookNameList: [], reason: 'nextStandards wave 3 H2: every OneRoster 1.2 Resources property judged toward the CTDL hub (forges/onerosterresources)' },
});
// ⟪nextStandards-102326 wave 3 lane I2, 2026-10-25 (EBONY_TOWER)⟫ ADDED, in this lane's own table: MedBiquitous's one judged facet
const ADDED_NEXT_STANDARDS_WAVE3_LANE_I = Object.freeze({
	medbiqCedsDerivedPlugin: { standardKey: 'medbiq', targetHub: 'ceds', declarationDigest: 'ebf0fcf6c7cc951e1e3e5171eb65ada8bbc1ac8090d2ace415fce53ed4a37140', hookNameList: [], reason: 'nextStandards wave 3 I2: the current-version MedBiquitous fields judged toward the CEDS hub (forges/medbiq)' },
	medbiqCtdlDerivedPlugin: { standardKey: 'medbiq', targetHub: 'ctdl', declarationDigest: '999b5c318191559d45c92e5ba312fde22d39677f523e794d95c18f4f1ddbc57d', hookNameList: [], reason: 'nextStandards wave 3 I2: the current-version MedBiquitous fields judged toward the CTDL hub (forges/medbiq)' },
});
// ⟪useCaseForge-102926 Phase 2a, 2026-10-29 (RADIANT_HAVEN)⟫ the use-case standard's two DECLARED citation bridges (forges/usecase)
const ADDED_USE_CASE_FORGE = Object.freeze({
	usecaseCedsDeclaredCorrespondence: { standardKey: 'usecase', targetHub: 'ceds', declarationDigest: '9a997267e4dc0e7d829300c3488c3cb43f8bfc0917ecc8ae4af3c90a44957638', hookNameList: ['subjectStableIdFor', 'walkSourceAssertions'], reason: 'useCaseForge Phase 2a: the case authors\' CEDS element citations, declared (uc:cites), to the CEDS base nodes (forges/usecase)' },
	usecaseCtdlCitationCtdlDeclaredCorrespondence: { standardKey: 'usecase', targetHub: 'ctdl', declarationDigest: '7f888ad1c615f12776a6bedc986d999388c8584bfd961702ed857bd6d2f4ac79', hookNameList: ['subjectStableIdFor', 'walkSourceAssertions'], reason: 'useCaseForge Phase 2a: the case authors\' CTDL citations (none until the registry gains a CTDL key), declared, to the CTDL base nodes (forges/usecase)' },
});
const ADDED_SINCE_R3_START = Object.freeze({
	pescldCtdlDeclaredIdentity: { standardKey: 'pescld', targetHub: 'ctdl', declarationDigest: '61c6c9cda1b1f7cbca25ecf77f50bdf316c8f685d4447bcc9df5a418c7672ff7', hookNameList: ['subjectStableIdFor', 'walkSourceAssertions'], reason: 'lane C2: PESC_LD declared identity to the CTDL hub (forges/pescld)' },
	pescldCedsDeclaredIdentity: { standardKey: 'pescld', targetHub: 'ceds', declarationDigest: 'a5245e6b402c54d1c7572da75ecd7dde6589edb5353e65c04273dff483772595', hookNameList: ['subjectStableIdFor', 'walkSourceAssertions'], reason: 'lane C3: PESC_LD declared identity to the CEDS hub, its stableIdTemplate rules only (forges/pescld)' },
	// ⟪zeroBacklog lane C4, 2026-10-23, granted⟫ the four JUDGED PESC_LD bridges (the terms PESC_LD coins itself; derived, judgeSlot-v1)
	pescldPescTermRowCedsDerivedPlugin: { standardKey: 'pescld', targetHub: 'ceds', declarationDigest: 'cafd1ddf9af7be91d19976e287c89d6eb14913c7f838ca03263553a02c1bd8cf', hookNameList: [], reason: 'lane C4: the pesc: profile rows judged toward the CEDS hub' },
	pescldPescTermRowCtdlDerivedPlugin: { standardKey: 'pescld', targetHub: 'ctdl', declarationDigest: '418958d892d12f2bbec92aa9f920ef58f4f2a0303ada74ad6c464f79336046cc', hookNameList: [], reason: 'lane C4: the pesc: profile rows judged toward the CTDL hub' },
	pescldPescTermShapeCedsDerivedPlugin: { standardKey: 'pescld', targetHub: 'ceds', declarationDigest: '41cd786ec6a64f44f077047e7c0e9feff14b6be1e1ba8548a5802dfdeb116129', hookNameList: [], reason: 'lane C4: the pesc: shapes judged toward the CEDS hub' },
	pescldPescTermShapeCtdlDerivedPlugin: { standardKey: 'pescld', targetHub: 'ctdl', declarationDigest: 'c17102e43c1933c974b190c4e290b319876789f9d0c7f674b73ae58cf7329127', hookNameList: [], reason: 'lane C4: the pesc: shapes judged toward the CTDL hub' },
	...ADDED_NEXT_STANDARDS_LANE_A,
	...ADDED_NEXT_STANDARDS_LANE_B,
	...ADDED_NEXT_STANDARDS_LANE_C,
	...ADDED_NEXT_STANDARDS_WAVE2_LANE_E,
	...ADDED_NEXT_STANDARDS_WAVE2_LANE_G,
	...ADDED_NEXT_STANDARDS_WAVE2_LANE_F,
	...ADDED_NEXT_STANDARDS_WAVE2_LANE_D,
	...ADDED_NEXT_STANDARDS_WAVE3_LANE_H,
	...ADDED_NEXT_STANDARDS_WAVE3_LANE_I,
	...ADDED_USE_CASE_FORGE,
});
// a bridge whose declaration moved since the start: both digests, so the entry is anchored to the roster it departs from
const RE_KEYED_SINCE_R3_START = Object.freeze({
	ctdlCedsDeclaredCorrespondence: { fromDeclarationDigest: '8a65a6f3721ddf03ec3e45df13eabefbd0cd9d6b34aadae53f06d43c9573aefe', toDeclarationDigest: '044c7828adcb26c2920a641f18fe832fef3ab2bca0fa4f902eed5539271c1685', reason: 'lane C3: the CEDS hub gained three term-form rules after its two seam rules; this bridge takes the hub list whole, so its declaration re-keys with no judge (its 53 targets resolve as before)' },
});

const proofConfig = getConfig('noRebuildProof') || {};
const baselineDirectoryPath = proofConfig.baselineDirectoryPath;
const digestFilePath = typeof baselineDirectoryPath === 'string' ? path.join(baselineDirectoryPath, 'pluginDigestsAtR3Start.json') : '';
harness.ok('graphBuilder.ini [noRebuildProof] baselineDirectoryPath holds pluginDigestsAtR3Start.json', digestFilePath !== '' && fs.existsSync(digestFilePath), `got ${JSON.stringify(baselineDirectoryPath)}; there is no default and the gate does not skip`);

const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
// ⟪zeroBacklog B3⟫ the ten judged bridges toward the CTDL hub (one pair row per standard bridging file, added one commit at a time)
const ZERO_BACKLOG_B3_BRIDGE_NAME_LIST = Object.freeze(['edfi', 'sif260928', 'pescCollegeTranscript1v8v0', 'pescCollegeTranscript1v7v0', 'pescHighSchoolTranscript1v6v0', 'pescTestScoreReport1v1v0', 'pescLearningRecord1v0v0', 'pescDocumentRequest1v0v0', 'pescDocumentResponse1v0v0', 'pescAcademicEportfolio1v0v0'].map((bridgeNameStem) => `${bridgeNameStem}CtdlDerivedPlugin`));
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

if (digestFilePath !== '' && fs.existsSync(digestFilePath)) {
	harness.section('(a) every bridge at the R3 start is the same bridge now');
	const atStart = JSON.parse(fs.readFileSync(digestFilePath, 'utf8')).pluginByBridgeName;
	Object.keys(atStart).sort().forEach((bridgeName) => {
		const entry = registry.entryByBridgeName[bridgeName];
		const was = atStart[bridgeName];
		const nowText = entry === undefined ? (RETIRED_FROZEN_BRIDGE_NAME_REASON[bridgeName] !== undefined ? `RETIRED: ${RETIRED_FROZEN_BRIDGE_NAME_REASON[bridgeName]}` : 'NOT REGISTERED') : `${entry.standardKey} → ${entry.targetHub} ${sha256Hex(entry.declarationCanonicalText)} hooks[${Object.keys(entry.bridgeHooks).sort().join(',')}]`;
		const reKeyed = RE_KEYED_SINCE_R3_START[bridgeName];
		const expectedDigest = reKeyed !== undefined ? reKeyed.toDeclarationDigest : was.declarationDigest;
		harness.equal(`${bridgeName}${entry !== undefined && entry.pluginFilePath !== path.join(TREE_ROOT, was.pluginFile) ? ' (now composed from ' + path.relative(TREE_ROOT, entry.pluginFilePath) + ')' : ''}${reKeyed !== undefined ? ' (re-keyed by name)' : ''}`, nowText, RETIRED_FROZEN_BRIDGE_NAME_REASON[bridgeName] !== undefined && entry === undefined ? `RETIRED: ${RETIRED_FROZEN_BRIDGE_NAME_REASON[bridgeName]}` : `${was.standardKey} → ${was.targetHub} ${expectedDigest} hooks[${was.hookNameList.join(',')}]`);
	});
	harness.equal('every re-keyed entry departs from the digest the roster froze', Object.keys(RE_KEYED_SINCE_R3_START).filter((bridgeName) => atStart[bridgeName] === undefined || atStart[bridgeName].declarationDigest !== RE_KEYED_SINCE_R3_START[bridgeName].fromDeclarationDigest).join(','), '');
	Object.keys(ADDED_SINCE_R3_START).sort().forEach((bridgeName) => {
		const entry = registry.entryByBridgeName[bridgeName];
		const added = ADDED_SINCE_R3_START[bridgeName];
		harness.equal(`${bridgeName} (added since the start by name)`, entry === undefined ? 'NOT REGISTERED' : `${entry.standardKey} → ${entry.targetHub} ${sha256Hex(entry.declarationCanonicalText)} hooks[${Object.keys(entry.bridgeHooks).sort().join(',')}]`, `${added.standardKey} → ${added.targetHub} ${added.declarationDigest} hooks[${added.hookNameList.join(',')}]`);
	});
	harness.equal('no added entry was already in the roster', Object.keys(ADDED_SINCE_R3_START).filter((bridgeName) => atStart[bridgeName] !== undefined).join(','), '');
	// ⟪zeroBacklog B3 + lane C, rebase 2026-10-23⟫ both lanes' named departures: lane C's ADDED_SINCE_R3_START, B3's judged bridges toward ctdl
	harness.equal('no bridge registered now that was not registered at the start, except those added by name and B3\'s derived bridges toward ctdl', Object.keys(registry.entryByBridgeName).filter((bridgeName) => atStart[bridgeName] === undefined && ADDED_SINCE_R3_START[bridgeName] === undefined && !(ZERO_BACKLOG_B3_BRIDGE_NAME_LIST.indexOf(bridgeName) !== -1 && registry.entryByBridgeName[bridgeName].targetHub === 'ctdl')).join(','), '');
}

harness.section('(a2) zeroBacklog B3: all ten judged bridges toward the CTDL hub are registered, each a derived bridge carrying the hub\'s prose rule');
harness.equal('every B3 bridge is registered, targets ctdl, is derived and carries the CTDL hub\'s renderedProseIdentifierRule', ZERO_BACKLOG_B3_BRIDGE_NAME_LIST.filter((bridgeName) => {
	const entry = registry.entryByBridgeName[bridgeName];
	return entry === undefined || entry.targetHub !== 'ctdl' || entry.bridgeDeclaration.matchBasis !== 'derived' || entry.bridgeDeclaration.renderedProseIdentifierRule === undefined;
}).join(','), '');

harness.section('(b) every frozen bridgeName is registered or retired by name');
const distinctBridgeNameFilePath = typeof baselineDirectoryPath === 'string' ? path.join(baselineDirectoryPath, 'frozenPairKeyCensus', 'distinctBridgeNameAndKind.txt') : '';
if (distinctBridgeNameFilePath !== '' && fs.existsSync(distinctBridgeNameFilePath)) {
	const frozenBridgeNameList = fs.readFileSync(distinctBridgeNameFilePath, 'utf8').split('\n').map((oneLine) => oneLine.trim().split(/\s+/).pop()).filter(Boolean).map((oneText) => oneText.split('::')[0]);
	harness.equal('the R0 census names sixteen frozen bridges', frozenBridgeNameList.length, 16);
	harness.equal('each is registered or retired with a reason', frozenBridgeNameList.filter((bridgeName) => registry.entryByBridgeName[bridgeName] === undefined && RETIRED_FROZEN_BRIDGE_NAME_REASON[bridgeName] === undefined).join(','), '');
} else {
	harness.ok('the R0 frozen bridgeName census is at baselineDirectoryPath/frozenPairKeyCensus', false, 'absent; the gate does not skip');
}

harness.section('(c) the composer refuses by name');
const toyHubBridging = {
	hubToken: 'hubx',
	candidateRenderingAllowList: ['name'],
	promptIdentifierScan: { identifierPatternList: [{ patternName: 'hubxId', regexSource: 'X\\d{3}' }], identifierListPath: null },
	sourceAnchorBlindingNameList: ['hubxId', 'hubxCode'],
	judgeWording: { toolCandidateNoun: 'hubx candidate' },
	declaredTargetRuleList: [],
	termKeyForm: 'curie',
	embeddingModelVersion: 'toy-model',
	remodelTableRefList: ['hubxRemodel'],
	retrievalTier: 'property',
};
const toyPairRow = () => ({
	candidateRetrieval: { method: 'cosineTopK-v1', k: 5, floor: 0.3 },
	candidateRenderingAllowList: null,
	promptIdentifierScan: 'fromHubWithLegacyListPath',
	blindingOrder: [{ hubAnchor: 0 }, 'crossRefs', { hubAnchor: 1 }],
	hubAnchorListLength: 2,
	declaredTargetRuleList: null,
	remodelTableRef: { hubRemodelTable: 0 },
	hubRemodelTableListLength: 1,
});
const toyStandardBridging = (pairRowOverride, facetOverride) => ({
	standardKey: 'toy',
	bridgeNameStem: 'toy',
	facetList: [{ facetName: '', declarationTemplate: { standardKey: 'toy', matchBasis: 'derived' }, subjectRenderingAllowList: ['name'], pairByHubToken: { hubx: { ...toyPairRow(), ...(pairRowOverride || {}) } }, ...(facetOverride || {}) }],
});
const composeToy = ({ standardBridging, hubBridging, bridgeHooksByFacetName }) => composerLib.composePluginModuleList({ standardBridging, bridgeHooksByFacetName: bridgeHooksByFacetName || { '': {} }, hubBridgingByToken: hubBridging === null ? {} : { hubx: hubBridging || toyHubBridging }, bundleDirName: 'toy' });
const composedToy = composeToy({ standardBridging: toyStandardBridging() });
harness.ok('the clean toy composes', composedToy.error === undefined, composedToy.error && composedToy.error.message);
const toyDeclaration = composedToy.pluginModuleList[0].bridgeDeclaration;
harness.equal('bridgeName by rule', toyDeclaration.bridgeName, 'toyHubxDerivedPlugin');
harness.equal('blinding in the pair\'s order, anchors resolved by position', JSON.stringify(toyDeclaration.blindingDeclaration), JSON.stringify(['hubxId', 'crossRefs', 'hubxCode']));
harness.equal('the hub\'s embedding model joins the pair\'s retrieval', toyDeclaration.candidateRetrieval.embeddingModelVersion, 'toy-model');
harness.equal('the legacy id-list path by rule', toyDeclaration.promptIdentifierScan.identifierListPath, 'bridges/toyHubxIdList.json');
harness.equal('the remodel table resolved by position', toyDeclaration.remodelTableRef, 'hubxRemodel');
harness.equal('the target hub is the pair\'s hub', composedToy.pluginModuleList[0].bridgeTarget.targetHub, 'hubx');
const errorTextOf = (composed) => String((composed.error || {}).message);
harness.match('a hub anchor out of range is refused by name', errorTextOf(composeToy({ standardBridging: toyStandardBridging({ blindingOrder: [{ hubAnchor: 5 }] }) })), /references hub anchor 5, outside the hubx hub's 2 anchor name/);
harness.match('RED TWIN (condition): the hub\'s anchor list changed length → refused, never a silent shift', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), hubBridging: { ...toyHubBridging, sourceAnchorBlindingNameList: ['hubxId', 'hubxNewName', 'hubxCode'] } })), /reads the hubx hub's sourceAnchorBlindingNameList by position, written when it had 2 entr\(ies\); it now has 3/);
harness.match('the same for the remodel list', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), hubBridging: { ...toyHubBridging, remodelTableRefList: [] } })), /reads the hubx hub's remodelTableRefList by position, written when it had 1 entr\(ies\); it now has 0/);
harness.match('an anchor referenced without its declared length is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging({ hubAnchorListLength: null }) })), /hubAnchorListLength is null but blindingOrder references hub anchor/);
harness.match('a template carrying a composed key is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging(null, { declarationTemplate: { standardKey: 'toy', matchBasis: 'derived', bridgeName: 'x' } }) })), /declarationTemplate carries 'bridgeName', which the composer writes/);
harness.match('a facet without hooks is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), bridgeHooksByFacetName: {} })), /bridgeHooksByFacetName names \[\] but the facets are \[""\]/);
harness.match('an unknown pair key is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging({ colour: 'blue' }) })), /carries unknown key 'colour'/);
harness.match('a pair whose hub was not loaded is refused', errorTextOf(composeToy({ standardBridging: toyStandardBridging(), hubBridging: null })), /pairs with hub 'hubx', whose bridging declaration was not loaded/);

harness.section('(d) the derived strings reproduce every composed bridge');
const composedEntryList = Object.values(registry.entryByBridgeName).filter((oneEntry) => /Bridging\.js$/.test(oneEntry.pluginFilePath));
harness.note(`${composedEntryList.length} bridge(s) are composed so far`);
composedEntryList.forEach((oneEntry) => {
	const bridgingModule = require(oneEntry.pluginFilePath);
	const facet = bridgingModule.standardBridging.facetList.find((oneFacet) => composerLib.derivedBridgeNameFor({ bridgeNameStem: bridgingModule.standardBridging.bridgeNameStem, facetName: oneFacet.facetName, hubToken: oneEntry.targetHub, matchBasis: oneFacet.declarationTemplate.matchBasis }) === oneEntry.bridgeName);
	harness.ok(`${oneEntry.bridgeName}: the name rule reproduces it from its facet`, facet !== undefined);
	harness.ok(`${oneEntry.bridgeName}: its hub's declaration loads`, hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: oneEntry.targetHub }).error === undefined);
});

harness.section('(e) no hub literal');
harness.equal('the composer and its contract name no hub', [require.resolve('../bridgeComposer'), require.resolve('../standardBridgingContract')].filter((filePath) => /ceds|ctdl/i.test(fs.readFileSync(filePath, 'utf8'))).map((filePath) => path.basename(filePath)).join(','), '');

harness.section('(g) new-bridge forms: union blinding over the paired hubs, the hub\'s own identifier scan');
const toyHubyBridging = { ...toyHubBridging, hubToken: 'huby', sourceAnchorBlindingNameList: ['hubyId', 'hubxCode'], promptIdentifierScan: { identifierPatternList: [{ patternName: 'hubyCurie', regexSource: 'hy:[a-z]+' }], identifierListPath: 'lib/hubyIdList.json' }, remodelTableRefList: [] };
const unionPairRow = { candidateRetrieval: { method: 'cosineTopK-v1', k: 5, floor: 0.3 }, candidateRenderingAllowList: null, promptIdentifierScan: 'fromHub', blindingOrder: { standardBlindingNameList: ['crossRefs'], pairedHubAnchors: 'union' }, hubAnchorListLength: null, declaredTargetRuleList: null, remodelTableRef: null, hubRemodelTableListLength: null };
const twoHubStandardBridging = { standardKey: 'toy', bridgeNameStem: 'toy', facetList: [{ facetName: '', declarationTemplate: { standardKey: 'toy', matchBasis: 'derived' }, subjectRenderingAllowList: ['name'], pairByHubToken: { hubx: toyPairRow(), huby: unionPairRow } }] };
const composedTwoHub = composerLib.composePluginModuleList({ standardBridging: twoHubStandardBridging, bridgeHooksByFacetName: { '': {} }, hubBridgingByToken: { hubx: toyHubBridging, huby: toyHubyBridging }, bundleDirName: 'toy' });
harness.ok('a standard pairing two hubs, one by the union form, composes', composedTwoHub.error === undefined, composedTwoHub.error && composedTwoHub.error.message);
const hubyDeclaration = ((composedTwoHub.pluginModuleList || []).find((oneModule) => oneModule.bridgeTarget.targetHub === 'huby') || { bridgeDeclaration: {} }).bridgeDeclaration;
harness.equal('union blinding: the standard\'s names, then every paired hub\'s anchors in hub-token order, each once', JSON.stringify(hubyDeclaration.blindingDeclaration), JSON.stringify(['crossRefs', 'hubxId', 'hubxCode', 'hubyId']));
harness.equal('the legacy pair beside it keeps its exact list', JSON.stringify(((composedTwoHub.pluginModuleList || []).find((oneModule) => oneModule.bridgeTarget.targetHub === 'hubx') || { bridgeDeclaration: {} }).bridgeDeclaration.blindingDeclaration), JSON.stringify(['hubxId', 'crossRefs', 'hubxCode']));
harness.equal('fromHub: the pair hub\'s own patterns', JSON.stringify((hubyDeclaration.promptIdentifierScan || {}).identifierPatternList), JSON.stringify(toyHubyBridging.promptIdentifierScan.identifierPatternList));
harness.equal('fromHub: the hub\'s list, resolved beside the hub bundle (no per-plugin list file)', (hubyDeclaration.promptIdentifierScan || {}).identifierListPath, '../huby/lib/hubyIdList.json');
const noListComposed = composerLib.composePluginModuleList({ standardBridging: twoHubStandardBridging, bridgeHooksByFacetName: { '': {} }, hubBridgingByToken: { hubx: toyHubBridging, huby: { ...toyHubyBridging, promptIdentifierScan: { identifierPatternList: [], identifierListPath: null } } }, bundleDirName: 'toy' });
harness.equal('fromHub: a hub declaring no list gives none', ((noListComposed.pluginModuleList || []).find((oneModule) => oneModule.bridgeTarget.targetHub === 'huby') || { bridgeDeclaration: { promptIdentifierScan: {} } }).bridgeDeclaration.promptIdentifierScan.identifierListPath, null);
const unionWithLength = composerLib.composePluginModuleList({ standardBridging: { ...twoHubStandardBridging, facetList: [{ ...twoHubStandardBridging.facetList[0], pairByHubToken: { huby: { ...unionPairRow, hubAnchorListLength: 2 } } }] }, bridgeHooksByFacetName: { '': {} }, hubBridgingByToken: { huby: toyHubyBridging }, bundleDirName: 'toy' });
harness.match('the union form with a positional length stated is refused', String((unionWithLength.error || {}).message), /hubAnchorListLength is 2 but blindingOrder references no hub anchor/);
const badUnion = composerLib.composePluginModuleList({ standardBridging: { ...twoHubStandardBridging, facetList: [{ ...twoHubStandardBridging.facetList[0], pairByHubToken: { huby: { ...unionPairRow, blindingOrder: { standardBlindingNameList: ['crossRefs'], pairedHubAnchors: 'some' } } } }] }, bridgeHooksByFacetName: { '': {} }, hubBridgingByToken: { huby: toyHubyBridging }, bundleDirName: 'toy' });
harness.match('an unknown union mode is refused by name', String((badUnion.error || {}).message), /blindingOrder must be/);

harness.section('(h) the P-c overlay: a pairing nobody shipped, laid over the tree for a debug run');
const PC_OVERLAY_DIR_PATH = path.join(TREE_ROOT, 'apps', 'graph-builder', 'test', 'fixtures', 'deCedsPcOverlay');
const overlaidRegistry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH, bridgingOverlayDirPath: PC_OVERLAY_DIR_PATH });
const pcEntry = overlaidRegistry.entryByBridgeName.edfiCtdlDerivedPlugin;
harness.ok('the overlay registers edfiCtdlDerivedPlugin, targeting ctdl', pcEntry !== undefined && pcEntry.targetHub === 'ctdl');
// ⟪zeroBacklog B3⟫ the pairing ships now; the overlay's own ctdl row (cosine retrieval, a narrowed allow-list) stays the fixture's
harness.ok('the shipped registry has it too, since B3 (its own row, not the overlay\'s)', registry.entryByBridgeName.edfiCtdlDerivedPlugin !== undefined && registry.entryByBridgeName.edfiCtdlDerivedPlugin.declarationCanonicalText !== pcEntry.declarationCanonicalText);
const cedsAnchorList = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'ceds' }).hubBridging.sourceAnchorBlindingNameList;
const ctdlAnchorList = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'ctdl' }).hubBridging.sourceAnchorBlindingNameList;
harness.equal('its blinding is the union: crossRefs, then every hub edfi pairs with (ceds, ctdl)', JSON.stringify(pcEntry && pcEntry.bridgeDeclaration.blindingDeclaration), JSON.stringify(['crossRefs'].concat(cedsAnchorList, ctdlAnchorList)));
harness.equal('its identifier scan is the CTDL hub\'s own', JSON.stringify(pcEntry && pcEntry.bridgeDeclaration.promptIdentifierScan), JSON.stringify({ identifierPatternList: hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'ctdl' }).hubBridging.promptIdentifierScan.identifierPatternList, identifierListPath: null }));
harness.equal('every other shipped bridge is byte-identical beside it (the overlay copy keeps edfi→ceds exact)', Object.keys(registry.entryByBridgeName).filter((bridgeName) => bridgeName !== 'edfiCtdlDerivedPlugin' && (overlaidRegistry.entryByBridgeName[bridgeName] === undefined || overlaidRegistry.entryByBridgeName[bridgeName].declarationCanonicalText !== registry.entryByBridgeName[bridgeName].declarationCanonicalText)).join(','), '');
const overlayRefusalFor = (bridgingOverlayDirPath) => {
	try {
		pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH, bridgingOverlayDirPath });
		return '';
	} catch (registryError) {
		return registryError.message;
	}
};
harness.match('a relative overlay directory is refused', overlayRefusalFor('apps/graph-builder/test/fixtures/deCedsPcOverlay'), /is not an absolute directory/);
const strayOverlayDirPath = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pcOverlay-'));
fs.mkdirSync(path.join(strayOverlayDirPath, 'edfi', 'bridges'), { recursive: true });
fs.writeFileSync(path.join(strayOverlayDirPath, 'edfi', 'bridges', 'edfiExtraBridging.js'), "module.exports = {};\n");
harness.match('an overlay file with no tree counterpart is refused (an overlay never adds a file)', overlayRefusalFor(strayOverlayDirPath), /has no tree counterpart/);
fs.rmSync(strayOverlayDirPath, { recursive: true, force: true });

harness.section('(i) a declared-identity pair takes the hub\'s stableIdTemplate rules, the filter stated in the pair row');
{
	const pluginRegistryForRuleFilter = require('../pluginRegistry');
	const FIXTURE_PLUGIN_PATH = path.join(__dirname, 'fixtures', 'declaredBridge', 'forges', 'pescldfixture', 'bridges', 'pescLdFixtureCtdlDeclaredIdentityPlugin.js');
	const fixtureLoaded = require(FIXTURE_PLUGIN_PATH);
	const { bridgeName: unusedName, blindingDeclaration: unusedBlinding, remodelTableRef: unusedRemodel, declaredTargetRuleList: unusedRules, ...identityTemplate } = fixtureLoaded.bridgeDeclaration;
	// a hub whose list holds a member rule FIRST, then two template rules: the real seam shape
	const mixedRuleHubBridging = {
		...toyHubBridging,
		hubToken: 'hubm',
		declaredTargetRuleList: [
			{ ruleKind: 'memberByNotation', pattern: '^hm:(\\d{6})#(.+)$', containerStableIdTemplate: 'hm:C{1}', memberEdgeType: 'HAS_VALUE', memberMatchProperty: 'notation', memberMatchGroup: 2 },
			{ ruleKind: 'stableIdTemplate', pattern: '^hm:(P\\d{6})$', stableIdTemplate: 'https://hm.example/terms/{1}' },
			{ ruleKind: 'stableIdTemplate', pattern: '^hm:(C\\d{6})$', stableIdTemplate: 'https://hm.example/terms/{1}' },
		],
	};
	const identityBridgingWith = (ruleListValue) => ({
		standardKey: 'pescldfixture',
		bridgeNameStem: 'pescldfixture',
		facetList: [{ facetName: '', declarationTemplate: identityTemplate, subjectRenderingAllowList: null, pairByHubToken: { hubm: { candidateRetrieval: null, candidateRenderingAllowList: null, promptIdentifierScan: null, blindingOrder: { standardBlindingNameList: ['termIri'], pairedHubAnchors: 'union' }, hubAnchorListLength: null, declaredTargetRuleList: ruleListValue, remodelTableRef: null, hubRemodelTableListLength: null } } }],
	});
	const composeAndRegister = (ruleListValue) => {
		const composed = composerLib.composePluginModuleList({ standardBridging: identityBridgingWith(ruleListValue), bridgeHooksByFacetName: { '': fixtureLoaded.bridgeHooks }, hubBridgingByToken: { hubm: mixedRuleHubBridging }, bundleDirName: 'pescldfixture' });
		if (composed.error) {
			return { composeError: composed.error.message };
		}
		const pluginModule = composed.pluginModuleList[0];
		const registered = pluginRegistryForRuleFilter.registerPlugin({ pluginModule, pluginFilePath: FIXTURE_PLUGIN_PATH, bundleDirPath: path.dirname(path.dirname(FIXTURE_PLUGIN_PATH)) });
		return { pluginModule, registerError: registered.error ? registered.error.message : '' };
	};
	const fromHubOutcome = composeAndRegister('fromHub');
	harness.match("'fromHub' over a hub whose list holds a memberByNotation rule is refused by name at registration", String(fromHubOutcome.registerError), /rule 0 ruleKind 'memberByNotation', which matchBasis 'declaredIdentity' does not admit/);
	const templateOutcome = composeAndRegister('fromHubStableIdTemplateRules');
	harness.equal("'fromHubStableIdTemplateRules' composes and registers", String(templateOutcome.composeError || templateOutcome.registerError), '');
	harness.equal('the composed list is the hub\'s template rules only, in hub order', JSON.stringify(templateOutcome.pluginModule ? templateOutcome.pluginModule.bridgeDeclaration.declaredTargetRuleList : null), JSON.stringify(mixedRuleHubBridging.declaredTargetRuleList.slice(1)));
	const unknownOutcome = composeAndRegister('fromHubSomeRules');
	harness.match('an unknown declaredTargetRuleList value is refused by name', String(unknownOutcome.composeError), /declaredTargetRuleList must be null or one of/);
	const noTemplateOutcome = composerLib.composePluginModuleList({ standardBridging: identityBridgingWith('fromHubStableIdTemplateRules'), bridgeHooksByFacetName: { '': fixtureLoaded.bridgeHooks }, hubBridgingByToken: { hubm: { ...mixedRuleHubBridging, declaredTargetRuleList: mixedRuleHubBridging.declaredTargetRuleList.slice(0, 1) } }, bundleDirName: 'pescldfixture' });
	harness.match('a hub with no template rule left to take is refused by name, never an empty list', String((noTemplateOutcome.error || {}).message), /holds no stableIdTemplate rule/);
}

harness.section('(f) a hub\'s identifier names are never rendered, supplied through the composer');
const bridgePluginContractLib = require('../bridgePluginContract');
const evidenceRendererLib = require('../evidenceRenderer');
const shippedHubTokenList = Array.from(new Set(Object.keys(registry.entryByBridgeName).map((bridgeName) => registry.entryByBridgeName[bridgeName].targetHub))).sort();
const hubAnchorNameList = [].concat(...shippedHubTokenList.map((hubToken) => {
	const loaded = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken });
	return loaded.error ? [`(${hubToken}: ${loaded.error.message})`] : loaded.hubBridging.sourceAnchorBlindingNameList;
}));
harness.ok('the shipped hubs declare identifier names to blind', hubAnchorNameList.length > 0 && hubAnchorNameList.every((oneName) => !/^\(/.test(oneName)), hubAnchorNameList.join(', '));
harness.equal('RENDERING_NEVER_NAME_LIST names none of them (it is hub-neutral)', hubAnchorNameList.filter((oneName) => bridgePluginContractLib.RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1).join(','), '');
const derivedEntryList = Object.keys(registry.entryByBridgeName).map((bridgeName) => registry.entryByBridgeName[bridgeName]).filter((oneEntry) => oneEntry.bridgeDeclaration.renderingAllowList !== undefined);
harness.equal('every rendering bridge blinds its hub\'s identifier names, so its never-rendered list holds them', derivedEntryList.filter((oneEntry) => {
	const anchorLoaded = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: oneEntry.targetHub });
	const neverRenderedNameList = bridgePluginContractLib.neverRenderedNameListFor(oneEntry.bridgeDeclaration.blindingDeclaration);
	return anchorLoaded.error || !anchorLoaded.hubBridging.sourceAnchorBlindingNameList.every((oneName) => neverRenderedNameList.indexOf(oneName) !== -1);
}).map((oneEntry) => oneEntry.bridgeName).join(','), '');
const edfiEntry = registry.entryByBridgeName.edfiCedsDerivedPlugin;
const blindedName = edfiEntry.bridgeDeclaration.blindingDeclaration.find((oneName) => bridgePluginContractLib.RENDERING_NEVER_NAME_LIST.indexOf(oneName) === -1);
const leakyDeclaration = JSON.parse(JSON.stringify(edfiEntry.bridgeDeclaration));
leakyDeclaration.renderingAllowList.candidate.push(blindedName);
const leakyValidated = bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration: leakyDeclaration, bundleDirPath: edfiEntry.bundleDirPath });
harness.match(`the contract refuses a blinded name ('${blindedName}') in the allow-list`, (leakyValidated.error && leakyValidated.error.message) || '', new RegExp(`renderingAllowList\\.candidate names '${blindedName}', which is on RENDERING_NEVER_NAME_LIST or the bridge's blindingDeclaration`));
const rendererInput = {
	sourceElement: { name: 'FirstName', material: { name: 'FirstName' } },
	candidatePool: [{ card: { stableId: 'hub:card/1', name: 'First Name', [blindedName]: 'X000001' }, seatReason: 'retrieval' }],
	globalGuidanceList: [],
	perCandidateNoteByStableId: {},
	promptSegmentList: [],
	judgePromptVariant: 'derived',
	renderingAllowList: { subject: ['name'], candidate: ['name', blindedName] },
};
harness.match('the renderer refuses an allow-list with no blindingNameList', ((evidenceRendererLib.renderQuestion(rendererInput).error) || {}).message || '', /requires blindingNameList/);
harness.match(`the renderer's own net refuses rendering the blinded name ('${blindedName}')`, ((evidenceRendererLib.renderQuestion({ ...rendererInput, blindingNameList: edfiEntry.bridgeDeclaration.blindingDeclaration }).error) || {}).message || '', new RegExp(`carries property '${blindedName}', which is on RENDERING_NEVER_NAME_LIST or the bridge's blindingDeclaration`));
harness.ok('without the name in the allow-list the same question renders', !evidenceRendererLib.renderQuestion({ ...rendererInput, renderingAllowList: { subject: ['name'], candidate: ['name'] }, blindingNameList: edfiEntry.bridgeDeclaration.blindingDeclaration }).error);

const evidenceContractsLib = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'evidenceContracts'));
const toyCandidate = { stableId: 'hub:card/1', name: 'First Name', hubCode: 'P000123' };
harness.ok('the evidence gate\'s smuggling tokens include the hub\'s named identifier property', evidenceContractsLib.candidateIdentifyingTokens(toyCandidate, ['hubCode']).indexOf('P000123') !== -1);
harness.ok('and only the hub\'s: an undeclared identifier property is not a token', evidenceContractsLib.candidateIdentifyingTokens(toyCandidate, []).indexOf('P000123') === -1);
harness.match('the evidence gate refuses with no hubIdentifierNameList (no default hub)', evidenceContractsLib.evidencePackageViolation({ sourceElement: { name: 'X' }, pool: [], promptSegments: [] }), /hubIdentifierNameList undefined is not a list of names/);
harness.equal('the evidence contracts name no hub identifier property', /\bcandidate\.cedsId\b/.test(fs.readFileSync(require.resolve(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'evidenceContracts')), 'utf8')), false);

harness.report();
