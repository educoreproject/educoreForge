'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// standard-discovery.js — parser-bundle AUTO-DISCOVERY (BINDING spec §3.5, pairwiseVersionSwitching).
// Replaces the central standard registry (deleted in the same change): the roster is the union of self-describing parser
// bundles, each carrying a parserDescriptor.ini. Adding a standard = dropping in a bundle with
// its descriptor and snapshots; no roster file, no code edit.
//
// Semantics (supervisor ruling of record, NOBLE_TRAIL 2026-07-10, PHASE-A-DEVLOG §9 Q1):
//   - The scan ALWAYS covers cli/parserLib/forge-* AND cli/parserLib/_test/forge-*; entries under
//     _test/ are flagged synthetic.
//   - resolveBundle (lookup by short bundle key, case-insensitive — the historical --standardName
//     CLI surface) resolves synthetics at ALL times: an explicit ask by key is deliberate, not
//     roster drift.
//   - ENUMERATION surfaces (roster, knownStandardNames) default to the production bundles;
//     synthetics appear only under an explicit { includeSynthetic: true } (test mode).
//   - standardName uniqueness is enforced among enabled PRODUCTION bundles only (the synthetic
//     p6hub deliberately mirrors 'CEDS' — spec §3.5).
//   - LOUD validation (binding): a discovered bundle that is malformed — descriptor missing or
//     unreadable, required key missing, entry module absent, declared sourceFile absent, no
//     snapshot present, defaultSnapshot naming no existing snapshot — FAILS the run with an error
//     naming the bundle. Discovery never silently skips. Validation runs for EVERY discovered
//     bundle, enabled or not (a disabled bundle may hide, but never rot unnoticed).
//
// Pure + synchronous (the registry's contract; consumers resolve synchronously). camelCase only.
//
// EAGER BY DESIGN (boundary-review condition C-2, 2026-07-10): the cedsHubStandardName IIFE at
// the bottom runs FULL discovery + validation at require time — deliberately, so loud validation
// reaches every consumer including a bare -help. Do NOT "fix" the eagerness into a lazy path;
// that would quietly create a way to load this module around its own validation.

const fs = require('fs');
const path = require('path');
const configFileProcessor = require('qtools-config-file-processor');

// parser bundles live in cli/parserLib/ (peer to lib.d, out of initCli's symlink scan);
// synthetic test bundles live under cli/parserLib/_test/.
const PARSER_LIB_DIR = path.join(__dirname, '..', '..', '..', 'parserLib');
const DESCRIPTOR_FILE_NAME = 'parserDescriptor.ini';
const REQUIRED_DESCRIPTOR_KEYS = ['standardName', 'displayName', 'entryModule', 'defaultSnapshot'];

// loud-validation voice: every failure names the bundle (spec §3.5, gate G-A3).
const discoveryFailure = (bundleDirName, problem) => {
	throw new Error(`standard-discovery: bundle '${bundleDirName}': ${problem}`);
};

const listForgeBundleDirs = (containerPath) =>
	fs.existsSync(containerPath)
		? fs
				.readdirSync(containerPath, { withFileTypes: true })
				.filter((dirent) => dirent.isDirectory() && dirent.name.startsWith('forge-'))
				.map((dirent) => dirent.name)
		: [];

// canonicalize the descriptor's defaultSnapshot against the ENUMERATED snapshot directory names.
// qtools-config-file-processor coerces `01` to the NUMBER 1 [code-fact, PHASE-A-DEVLOG D2]; the
// directory name is authoritative, so match numerically and return the canonical name ('01').
const canonicalDefaultSnapshot = (declaredValue, snapshotDirNames, bundleDirName) => {
	const matches = snapshotDirNames.filter(
		(dirName) => Number(dirName) === Number(declaredValue),
	);
	if (matches.length !== 1) {
		discoveryFailure(
			bundleDirName,
			`defaultSnapshot '${declaredValue}' matches ${
				matches.length === 0 ? 'no' : 'more than one'
			} snapshot directory (found: ${snapshotDirNames.join(', ') || 'none'})`,
		);
	}
	return matches[0];
};

const readBundle = ({ bundleDirName, bundlePath, synthetic }) => {
	const descriptorPath = path.join(bundlePath, DESCRIPTOR_FILE_NAME);
	if (!fs.existsSync(descriptorPath)) {
		discoveryFailure(bundleDirName, `${DESCRIPTOR_FILE_NAME} missing (expected at ${descriptorPath})`);
	}
	const parsedConfig = configFileProcessor.getConfig(descriptorPath);
	const descriptor = parsedConfig && parsedConfig.parserDescriptor;
	if (!descriptor) {
		discoveryFailure(
			bundleDirName,
			`${DESCRIPTOR_FILE_NAME} unreadable or missing its [parserDescriptor] section`,
		);
	}
	REQUIRED_DESCRIPTOR_KEYS.forEach((requiredKey) => {
		if (descriptor[requiredKey] === undefined || descriptor[requiredKey] === '') {
			discoveryFailure(bundleDirName, `${DESCRIPTOR_FILE_NAME} is missing required key '${requiredKey}'`);
		}
	});
	const entryModulePath = path.join(bundlePath, `${descriptor.entryModule}`);
	if (!fs.existsSync(entryModulePath)) {
		discoveryFailure(
			bundleDirName,
			`entryModule '${descriptor.entryModule}' not found at ${entryModulePath}`,
		);
	}
	const snapshotContainerPath = path.join(bundlePath, 'assets', 'standardSourceData');
	const snapshotDirNames = fs.existsSync(snapshotContainerPath)
		? fs
				.readdirSync(snapshotContainerPath, { withFileTypes: true })
				.filter((dirent) => dirent.isDirectory())
				.map((dirent) => dirent.name)
				.sort()
		: [];
	if (snapshotDirNames.length === 0) {
		discoveryFailure(bundleDirName, 'no snapshot directory present under assets/standardSourceData/');
	}
	const defaultSnapshot = canonicalDefaultSnapshot(
		descriptor.defaultSnapshot,
		snapshotDirNames,
		bundleDirName,
	);
	const defaultSnapshotPath = path.join(snapshotContainerPath, defaultSnapshot);
	const sourceFile = descriptor.sourceFile !== undefined ? `${descriptor.sourceFile}` : null;
	if (sourceFile && !fs.existsSync(path.join(defaultSnapshotPath, sourceFile))) {
		discoveryFailure(
			bundleDirName,
			`declared sourceFile '${sourceFile}' not found in default snapshot ${defaultSnapshotPath}`,
		);
	}
	return {
		// the legacy short key (bundleDir minus 'forge-') — the CLI lookup surface and the
		// fingerprint report's per-standard key (naming pin, boundary-review C3(ii)).
		registryKey: bundleDirName.replace(/^forge-/, ''),
		bundleDir: bundleDirName,
		bundlePath,
		standardName: `${descriptor.standardName}`,
		displayName: `${descriptor.displayName}`,
		entryModule: `${descriptor.entryModule}`,
		bundleFactoryPath: entryModulePath,
		snapshots: snapshotDirNames,
		defaultSnapshot,
		sourceFile,
		defaultSource: sourceFile ? path.join(defaultSnapshotPath, sourceFile) : defaultSnapshotPath,
		synthetic,
		enabled: descriptor.enabled === undefined ? true : !!descriptor.enabled,
	};
};

// scan once per process; the roster is stable for a process lifetime (registry parity).
let discoveredRosterCache = null;
const discoverAll = () => {
	if (discoveredRosterCache) {
		return discoveredRosterCache;
	}
	const productionBundles = listForgeBundleDirs(PARSER_LIB_DIR).map((bundleDirName) => ({
		bundleDirName,
		bundlePath: path.join(PARSER_LIB_DIR, bundleDirName),
		synthetic: false,
	}));
	const syntheticBundles = listForgeBundleDirs(path.join(PARSER_LIB_DIR, '_test')).map(
		(bundleDirName) => ({
			bundleDirName,
			bundlePath: path.join(PARSER_LIB_DIR, '_test', bundleDirName),
			synthetic: true,
		}),
	);
	const allEntries = [...productionBundles, ...syntheticBundles].map(readBundle);
	// bundleDir is the roster key (filesystem-unique per tree); a cross-tree duplicate is a defect.
	const entryByBundleDir = {};
	allEntries.forEach((entry) => {
		if (entryByBundleDir[entry.bundleDir]) {
			discoveryFailure(
				entry.bundleDir,
				`duplicate bundle directory name (production and _test trees both carry '${entry.bundleDir}')`,
			);
		}
		entryByBundleDir[entry.bundleDir] = entry;
	});
	const enabledEntries = allEntries.filter((entry) => entry.enabled);
	// standardName uniqueness among enabled PRODUCTION bundles only (synthetics exempt — spec §3.5).
	const productionBundleByStandardName = {};
	enabledEntries
		.filter((entry) => !entry.synthetic)
		.forEach((entry) => {
			if (productionBundleByStandardName[entry.standardName]) {
				throw new Error(
					`standard-discovery: duplicate standardName '${entry.standardName}' among enabled production bundles: '${
						productionBundleByStandardName[entry.standardName]
					}' and '${entry.bundleDir}'`,
				);
			}
			productionBundleByStandardName[entry.standardName] = entry.bundleDir;
		});
	// canonical order: sorted by bundleDir.
	enabledEntries.sort((a, b) => (a.bundleDir < b.bundleDir ? -1 : a.bundleDir > b.bundleDir ? 1 : 0));
	discoveredRosterCache = enabledEntries;
	return discoveredRosterCache;
};

// roster — the enumeration surface. Default = production bundles only (ruling of record).
const roster = ({ includeSynthetic = false } = {}) =>
	discoverAll().filter((entry) => includeSynthetic || !entry.synthetic);

// resolveBundle — { standardName } -> { standardName, bundleFactory, defaultSource } or { error }.
// The parameter name is the historical CLI surface (--standardName=<key>); the semantic is the
// SHORT BUNDLE KEY (bundleDir minus 'forge-'), case-insensitive — behavior-compatible with the
// registry it replaces. Synthetics resolve at all times (explicit ask, not drift).
const resolveBundle = ({ standardName } = {}) => {
	if (!standardName) {
		return { error: 'standard-discovery: --standardName is required' };
	}
	const wantedKey = `${standardName}`.toLowerCase();
	const entry = discoverAll().find(
		(candidate) => candidate.registryKey.toLowerCase() === wantedKey,
	);
	if (!entry) {
		return {
			error: `standard-discovery: no forge bundle discovered for standardName '${standardName}' (known: ${discoverAll()
				.map((candidate) => candidate.registryKey)
				.join(', ')})`,
		};
	}
	const bundleFactory = require(entry.bundleFactoryPath);
	return {
		standardName: entry.standardName,
		bundleFactory,
		defaultSource: entry.defaultSource,
	};
};

const knownStandardNames = ({ includeSynthetic = false } = {}) =>
	roster({ includeSynthetic }).map((entry) => entry.standardName);

// cedsHubStandardName — the SINGLE source of truth for the CEDS hub's canonical _source casing
// ('CEDS'), rehomed here from the deleted registry (spec §3.5); derived from the forge-ceds
// descriptor. Hub-side exact matching resolves uniformly against this value.
const cedsHubStandardName = (() => {
	const entry = discoverAll().find((candidate) => candidate.bundleDir === 'forge-ceds');
	if (!entry) {
		throw new Error(
			'standard-discovery: forge-ceds bundle not discovered — cedsHubStandardName unavailable',
		);
	}
	return entry.standardName;
})();

module.exports = { resolveBundle, knownStandardNames, roster, cedsHubStandardName };
