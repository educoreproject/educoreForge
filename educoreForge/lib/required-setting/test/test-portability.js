#!/usr/bin/env node
'use strict';

// test-portability.js — gates for Build 13 of the 2026-11-21 deep review (F-37): the /Users/tqwhite defaults are
// settings, refused by name when absent.
//
// Every config read here goes through a getConfig DOUBLE built from a scratch section map, never the real
// graphBuilder.ini: the point is to prove the refusal fires when a line is missing and the configured value is the
// one used when it is present, which a real ini (with or without TQ's new lines) can show only one of.
//
// Run: node lib/required-setting/test/test-portability.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const fs = require('fs');
const os = require('os');
const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- gates for the F-37 portability build: every former /Users/tqwhite default is a setting,
     refused by name when absent

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const treeRoot = path.join(__dirname, '..', '..', '..');
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfPortability-'));

// getConfigDouble — the getConfig shape startup.js loadConfig returns: a section name answers its object, or {}
const getConfigDouble = (sectionMap) => (sectionName) => sectionMap[sectionName] || {};
const NO_SETTINGS = getConfigDouble({});

const errorOf = (resolution) => (resolution && resolution.error) || '';
const valueOf = (resolution) => (resolution && resolution.value) || '';
const thrownMessageOf = (thunk) => {
	try {
		thunk();
		return '';
	} catch (thrownError) {
		return thrownError.message;
	}
};

// =====================================================================
harness.section('CENSUS — the fixed files carry no /Users/tqwhite path; the known remainder is named');
// =====================================================================
// A text census, deliberately: the finding IS the literal. FIXED rows must not contain it; OPEN rows are the ones left
// by ruling and are asserted to still contain it, so this list cannot silently drift from the code.

const CENSUS_ROW_LIST = [
	{ relativeFilePath: 'apps/graph-builder/lib/build.js', status: 'fixed' },
	{ relativeFilePath: 'apps/graph-builder/lib/actions.js', status: 'fixed' },
	{ relativeFilePath: 'lib/embedding/embedding-client.js', status: 'fixed' },
	{ relativeFilePath: 'lib/rdf-independent-check/rdf-independent-check.js', status: 'fixed' },
	{ relativeFilePath: 'forges/pesc260805/lib/xsd-independent-check/xsd-independent-check.js', status: 'fixed' },
	{ relativeFilePath: 'forges/ceds/lib/cedsRoundTripVerbs.js', status: 'fixed' },
	// OPEN by ruling (SINCERE_STATUETTE, 2026-11-21): inside the decision-block frameworkFingerprint, left for the next
	// fingerprint-moving build; build.js hands each provider its path, so graphBuilder never reaches these defaults
	{ relativeFilePath: 'apps/graph-builder/apps/bridge-maker/lib/llmClient.js', status: 'open' },
	{ relativeFilePath: 'apps/graph-builder/apps/bridge-maker/lib/jevJudgeClient.js', status: 'open' },
	{ relativeFilePath: 'apps/graph-builder/apps/bridge-maker/lib/jevOpusJudgeClient.js', status: 'open' },
	{ relativeFilePath: 'apps/graph-builder/apps/bridge-maker/lib/ollamaJudgeClient.js', status: 'open' },
	// OPEN by ruling: reads the EDUCORE project's schema-provider.js; a question for TQ
	{ relativeFilePath: 'forges/ceds/lib/roundTripGateMeasures.js', status: 'open' },
];
const USER_HOME_LITERAL = '/Users/tqwhite';
CENSUS_ROW_LIST.forEach((oneRow) => {
	const fileText = fs.readFileSync(path.join(treeRoot, oneRow.relativeFilePath), 'utf8');
	const literalCount = fileText.split(USER_HOME_LITERAL).length - 1;
	if (oneRow.status === 'fixed') {
		harness.equal(`${oneRow.relativeFilePath}: no ${USER_HOME_LITERAL} literal`, literalCount, 0);
	} else {
		harness.ok(`${oneRow.relativeFilePath}: still holds its default (OPEN, named in the DEVLOG)`, literalCount > 0, `count ${literalCount}`);
	}
});

// =====================================================================
harness.section('items 8, 9 — embedding-client: the credentials ini and the vector cache are named by the caller');
// =====================================================================

const embeddingClientLib = require('../../embedding/embedding-client');
const scratchVoyageIniFilePath = path.join(scratchDir, 'voyageEmbedding.ini');
fs.writeFileSync(scratchVoyageIniFilePath, '[voyageEmbedding]\nmodel=voyage-context-3\nembeddingDims=1024\n');

harness.match('no configFilePath is REFUSED by name, naming the setting graphBuilder passes', thrownMessageOf(() => embeddingClientLib({ cacheFilePath: false })), /configFilePath[\s\S]*\[forger\] voyageConfigFilePath/);
harness.match('a blank configFilePath is REFUSED by name', thrownMessageOf(() => embeddingClientLib({ configFilePath: '  ', cacheFilePath: false })), /configFilePath is "  "/);
harness.match('no cacheFilePath is REFUSED by name, naming the setting (false disables)', thrownMessageOf(() => embeddingClientLib({ configFilePath: scratchVoyageIniFilePath })), /cacheFilePath[\s\S]*\[stores\] vectorCacheFilePath[\s\S]*false/);
harness.equal('a named ini and cacheFilePath false construct, and the identity is read from the named ini', thrownMessageOf(() => embeddingClientLib({ configFilePath: scratchVoyageIniFilePath, cacheFilePath: false }).resolveEmbeddingIdentity()), '');

// =====================================================================
harness.section('item 1 — build.js: the build-log home is [stores] buildLogsDirPath');
// =====================================================================

const buildStatics = require('../../../apps/graph-builder/lib/build');
const buildLogsDirPath = path.join(scratchDir, 'buildLogs');
harness.match('absent: REFUSED naming the section, the key and the file', errorOf(buildStatics.resolveBuildLogsDirPath({}, NO_SETTINGS)), /\[stores\] buildLogsDirPath is absent from graphBuilder\.ini/);
harness.equal('present: the configured home is the one used', valueOf(buildStatics.resolveBuildLogsDirPath({}, getConfigDouble({ stores: { buildLogsDirPath } }))), buildLogsDirPath);
harness.equal('an injected deps.buildLogsDirPath still wins over the setting', valueOf(buildStatics.resolveBuildLogsDirPath({ buildLogsDirPath: '/scratch/injected' }, getConfigDouble({ stores: { buildLogsDirPath } }))), '/scratch/injected');

// =====================================================================
harness.section('items 2, 4-7 — build.js hands EVERY judge provider its ini from [judgeProviderConfigFilePath]');
// =====================================================================

const judgeProviderRegistryLib = require('../../../apps/graph-builder/apps/bridge-maker/lib/judgeProviderRegistry');
const credentialProviderNameList = judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.map((oneRow) => oneRow.name).filter((providerName) => providerName !== judgeProviderRegistryLib.DEBUG_JUDGE_PROVIDER_NAME);
const fullJudgeSection = credentialProviderNameList.reduce((soFar, providerName) => ({ ...soFar, [providerName]: path.join(scratchDir, `${providerName}.ini`) }), {});
const resolveJudgeConfig = (selectedProviderName, getConfig, deps = {}) => (typeof buildStatics.resolveJudgeProviderConfigFilePathByProviderName === 'function' ? buildStatics.resolveJudgeProviderConfigFilePathByProviderName({ selectedProviderName, deps, getConfig }) : { error: 'resolveJudgeProviderConfigFilePathByProviderName is not exported' });

harness.match('the selected provider (jev) absent from the section: REFUSED by name', errorOf(resolveJudgeConfig('jev', NO_SETTINGS)), /\[judgeProviderConfigFilePath\] jev is absent from graphBuilder\.ini/);
const fullResolution = resolveJudgeConfig('jev', getConfigDouble({ judgeProviderConfigFilePath: fullJudgeSection }));
harness.equal('present: every credential provider gets a defined path, so no client default is ever consulted on this path', credentialProviderNameList.filter((providerName) => typeof (fullResolution.value || {})[providerName] !== 'string').join(', '), '');
harness.equal('  and the selected provider gets exactly the configured path', (fullResolution.value || {}).jev, fullJudgeSection.jev);
harness.equal('the debug judge needs no credentials ini: no refusal with the section empty', errorOf(resolveJudgeConfig(judgeProviderRegistryLib.DEBUG_JUDGE_PROVIDER_NAME, NO_SETTINGS)), '');
harness.equal('an injected deps.judgeProviderConfigFilePathByProviderName still wins (the test seam)', (resolveJudgeConfig('jev', NO_SETTINGS, { judgeProviderConfigFilePathByProviderName: { jev: '/scratch/jev.ini' } }).value || {}).jev, '/scratch/jev.ini');

// =====================================================================
harness.section('item 3 — actions.js: the forensic match-log home is [stores] matchForensicsDirPath');
// =====================================================================

const actions = require('../../../apps/graph-builder/lib/actions')();
const matchForensicsDirPath = path.join(scratchDir, 'matchForensics');
const matchForensicsFor = (getConfig) => (typeof actions.matchForensicsDefaultDirPathFor === 'function' ? actions.matchForensicsDefaultDirPathFor(getConfig) : { error: 'matchForensicsDefaultDirPathFor is not exported' });
harness.match('absent: REFUSED by name', errorOf(matchForensicsFor(NO_SETTINGS)), /\[stores\] matchForensicsDirPath is absent from graphBuilder\.ini/);
harness.equal('present: the configured home', valueOf(matchForensicsFor(getConfigDouble({ stores: { matchForensicsDirPath } }))), matchForensicsDirPath);

// =====================================================================
harness.section('item 13 — the CEDS round-trip output home is [stores] cedsRoundTripDirPath');
// =====================================================================

const cedsRoundTripVerbs = require('../../../forges/ceds/lib/cedsRoundTripVerbs');
const cedsRoundTripDirPath = path.join(scratchDir, 'cedsRoundTrip');
const cedsDirFor = (getConfig) => (typeof cedsRoundTripVerbs.cedsRoundTripDirPathFor === 'function' ? cedsRoundTripVerbs.cedsRoundTripDirPathFor(getConfig) : { error: 'cedsRoundTripDirPathFor is not exported' });
harness.match('absent: REFUSED by name', errorOf(cedsDirFor(NO_SETTINGS)), /\[stores\] cedsRoundTripDirPath is absent from graphBuilder\.ini/);
harness.equal('present: the configured home', valueOf(cedsDirFor(getConfigDouble({ stores: { cedsRoundTripDirPath } }))), cedsRoundTripDirPath);

// =====================================================================
harness.section('items 10, 11 — the two Python environments are [independentCheck] settings');
// =====================================================================

const rdfIndependentCheckLib = require('../../rdf-independent-check/rdf-independent-check');
const xsdIndependentCheckLib = require('../../../forges/pesc260805/lib/xsd-independent-check/xsd-independent-check');
[
	{ label: 'rdf (lib/rdf-independent-check)', checkLib: rdfIndependentCheckLib, settingName: 'rdfVenvDirPath' },
	{ label: 'xsd (forges/pesc260805)', checkLib: xsdIndependentCheckLib, settingName: 'xsdVenvDirPath' },
].forEach(({ label, checkLib, settingName }) => {
	const venvFor = (getConfig) => (typeof checkLib.venvDirPathFor === 'function' ? checkLib.venvDirPathFor(getConfig) : { error: 'venvDirPathFor is not exported' });
	const venvDirPath = path.join(scratchDir, `${settingName}`);
	harness.match(`${label}: absent: REFUSED by name`, errorOf(venvFor(NO_SETTINGS)), new RegExp(`\\[independentCheck\\] ${settingName} is absent from graphBuilder\\.ini`));
	harness.equal(`${label}: present: the configured environment`, valueOf(venvFor(getConfigDouble({ independentCheck: { [settingName]: venvDirPath } }))), venvDirPath);
});

harness.report();
