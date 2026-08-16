#!/usr/bin/env node
'use strict';

// test-gId.js — G-ID (SPEC-forgeFramework-v1.md §9.3, §10.2; RULING FB4 2026-08-16): for each MIGRATED forge the
// block id the FROZEN COMMAND recorded (the `migrated` phase's scratch standardsDatabase named in
// acceptance/acceptanceCommands.jsonc — `blocks.refId WHERE kind='standardBase'`) EQUALS the id the SAME command
// recorded on the UNMIGRATED forge, frozen in acceptance/expectedBlockIds.json (measuredPreMigration); and the
// four-forge manifest the frozen `fourWithHub-baseline` run recorded EQUALS the reference `97c618c2…`.
//
// ONE-MACHINE-ONLY, LICENCE-GATED (SPEC §10.2, Profile §12): the artifacts are the scratch databases the frozen
// command wrote on THIS Mac (gitignored MetaEd bytes, Docker, Voyage). When an artifact is ABSENT this suite
// REFUSES BY NAME (exit 1) — it never reports green over a missing run. The build itself is not re-run here;
// the RED observation of the build (parserVersion '2'→'2a' → 8b8efba5…, §8.6 diff naming the root line) is
// recorded in DEVLOG-forgeFramework.md (F3b) and buildLogs/forgeFramework/edfi-gIdRedObservation/.
//
// Twins (inputFault): flip the frozen id / the reference manifest in a fixture double → the equality goes red.
//
// Run: node lib/forge-framework/test/test-gId.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-ID: the migrated forge's recorded block id EQUALS the frozen pre-migration id; the four-forge manifest EQUALS the reference (ONE-MACHINE-ONLY)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise, or an artifact the frozen command should have written is absent (refused by name).
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const toyScenario = require('./testSupport/toyScenario');
const { scenarioTwin } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { MIGRATED_FORGE_ROSTER } = require('./testSupport/migratedForgeRoster');

const GATE_ID = 'G-ID';
const twinRegistry = makeTwinRegistry();
const ACCEPTANCE_DIR = path.join(__dirname, 'acceptance');
const stripJsoncComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');
const acceptanceCommands = JSON.parse(stripJsoncComments(fs.readFileSync(path.join(ACCEPTANCE_DIR, 'acceptanceCommands.jsonc'), 'utf8')));
const expectedBlockIds = JSON.parse(fs.readFileSync(path.join(ACCEPTANCE_DIR, 'expectedBlockIds.json'), 'utf8'));

// the scratch database the frozen command wrote for a phase — parsed from the committed command line (data)
const standardsDatabasePathFor = ({ commandText, phaseToken }) => {
	const pathMatch = commandText.match(/--standardsDatabaseFilePath=(\S+)/);
	if (!pathMatch) {
		throw new Error(`${moduleName} REFUSED: the frozen command carries no --standardsDatabaseFilePath: ${commandText.slice(0, 120)}`);
	}
	return pathMatch[1].replace('<phase>', phaseToken);
};
const readRecordedStandardBaseId = (databasePath) => {
	if (!fs.existsSync(databasePath)) {
		throw new Error(`${moduleName} REFUSED (ONE-MACHINE-ONLY, SPEC §10.2): the frozen command's scratch standardsDatabase '${databasePath}' is not on disk — G-ID is licence-gated and reads the run the frozen command wrote on this machine; run acceptanceCommands.jsonc's line first`);
	}
	const database = new Database(databasePath, { readonly: true });
	const rowList = database.prepare("SELECT refId FROM blocks WHERE kind = 'standardBase'").all();
	database.close();
	if (rowList.length !== 1) {
		throw new Error(`${moduleName} REFUSED: '${databasePath}' holds ${rowList.length} standardBase block(s); the single-forge frozen command writes exactly ONE`);
	}
	return rowList[0].refId;
};
const readRecordedManifestId = (databasePath, recipeName) => {
	if (!fs.existsSync(databasePath)) {
		throw new Error(`${moduleName} REFUSED (ONE-MACHINE-ONLY, SPEC §10.2): the four-forge run's scratch standardsDatabase '${databasePath}' is not on disk — run fourWithHub-baseline under the frozen form first`);
	}
	const database = new Database(databasePath, { readonly: true });
	const rowList = database.prepare('SELECT refId FROM manifests WHERE recipeName = ?').all(recipeName);
	database.close();
	if (rowList.length !== 1) {
		throw new Error(`${moduleName} REFUSED: '${databasePath}' holds ${rowList.length} manifest(s) for recipe '${recipeName}'; expected exactly ONE`);
	}
	return rowList[0].refId;
};

// the four-forge proof's scratch database: the frozen form with the F3b phase label (SPEC §9 / BRIEF-F3b step 5)
const FOUR_FORGE_DATABASE_PATH = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/forgeFramework_fourWithHub_postEdfi.standardsDatabase.sqlite3';

const migratedForgeConjunctList = MIGRATED_FORGE_ROSTER.map((oneForge) => ({
	conjunctId: `${oneForge.standardKey}MigratedIdEqualsFrozenPreMigration`,
	title: `${oneForge.standardKey}: the block id the frozen command recorded on the MIGRATED forge EQUALS the frozen pre-migration id (expectedBlockIds.json measuredPreMigration.${oneForge.standardKey}) — and the reference under fourWithHub-baseline`,
	twinNameList: [`${oneForge.standardKey}FrozenIdFlipped`],
	evaluate: (scenario, callback) => {
		const frozenIds = scenario.expectedBlockIdsOverride || expectedBlockIds;
		const frozenId = frozenIds.measuredPreMigration[oneForge.standardKey];
		const referenceId = frozenIds.referenceUnderFourWithHubBaseline[oneForge.standardKey];
		if (typeof frozenId !== 'string' || !/^[0-9a-f]{64}$/.test(frozenId)) {
			callback('', { pass: false, detail: `expectedBlockIds.json measuredPreMigration.${oneForge.standardKey} is ${JSON.stringify(frozenId)}, not a frozen 64-hex id — measure the unmigrated forge first (FR9)` });
			return;
		}
		const commandText = acceptanceCommands.byStandardKey[oneForge.standardKey].command;
		const recordedId = readRecordedStandardBaseId(standardsDatabasePathFor({ commandText, phaseToken: 'migrated' }));
		const pass = recordedId === frozenId && recordedId === referenceId;
		callback('', { pass, detail: `recorded ${recordedId.slice(0, 12)}… ${recordedId === frozenId ? '==' : '!='} frozen ${frozenId.slice(0, 12)}…; ${recordedId === referenceId ? '==' : '!='} reference ${String(referenceId).slice(0, 12)}…` });
	},
}));

const conjunctList = migratedForgeConjunctList.concat([
	{
		conjunctId: 'fourForgeManifestEqualsReference',
		title: 'the manifest the frozen fourWithHub-baseline run recorded (after Ed-Fi alone; the other three untouched) EQUALS acceptanceCommands.finalProof.expectedManifest 97c618c2…',
		twinNameList: ['referenceManifestFlipped'],
		evaluate: (scenario, callback) => {
			const expectedManifest = scenario.expectedManifestOverride || acceptanceCommands.finalProof.expectedManifest;
			const recordedManifest = readRecordedManifestId(FOUR_FORGE_DATABASE_PATH, 'fourWithHub-baseline');
			callback('', { pass: recordedManifest === expectedManifest, detail: `recorded ${recordedManifest.slice(0, 12)}… ${recordedManifest === expectedManifest ? '==' : '!='} expected ${expectedManifest.slice(0, 12)}…` });
		},
	},
]);

MIGRATED_FORGE_ROSTER.forEach((oneForge) => {
	scenarioTwin({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: `${oneForge.standardKey}MigratedIdEqualsFrozenPreMigration`, twinName: `${oneForge.standardKey}FrozenIdFlipped`, leverKind: 'inputFault',
		mutate: (scenario) => {
			const flipped = JSON.parse(JSON.stringify(expectedBlockIds));
			flipped.measuredPreMigration[oneForge.standardKey] = '0'.repeat(64);
			scenario.expectedBlockIdsOverride = flipped;
		},
	});
});
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'fourForgeManifestEqualsReference', twinName: 'referenceManifestFlipped', leverKind: 'inputFault', mutate: (scenario) => { scenario.expectedManifestOverride = '0'.repeat(64); } });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the migrated forge reproduces its frozen block id; the four-forge manifest reproduces the reference (ONE-MACHINE-ONLY)', conjunctList }];
runGateFamily({
	harness, familyName: GATE_ID, gateDeclarationList, twinRegistry,
	makeSubject: toyScenario.makeScenario,
	cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), expectedBlockIdsOverride: scenario.expectedBlockIdsOverride, expectedManifestOverride: scenario.expectedManifestOverride }),
	expectedConjunctCount: MIGRATED_FORGE_ROSTER.length + 1, expectedTwinCount: MIGRATED_FORGE_ROSTER.length + 1,
}, () => harness.report());
