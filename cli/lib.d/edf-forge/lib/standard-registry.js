'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// standard-registry.js — the standardName -> forge-bundle REGISTRY (registry, not switch;
// DECISIONS §13, PSI cli briefing "registry pattern, NOT switch statements").
//
// Each row maps a standardName key to a forge-bundle resolver: the require path of the bundle's
// curried factory + the bundle's default source asset. The CLI resolves the bundle from
// --standardName, requires its factory, injects { embedder }, and calls bundle.forge(...). A new
// standard is added by adding ONE row — no CLI code changes.
//
// Pure + synchronous. camelCase only.

const path = require('path');

const FORGE_BUNDLE_DIR = path.join(__dirname, '..', '..');

// registry rows — keyed by the lowercased standardName for case-insensitive lookup.
const registry = {
	ceds: {
		standardName: 'CEDS',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-ceds', 'forgeCeds'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-ceds',
			'assets',
			'standardSourceData',
			'01',
			'CEDS-Ontology.rdf',
		),
	},
	lif: {
		standardName: 'LIF',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-lif', 'forgeLif'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-lif',
			'assets',
			'standardSourceData',
			'01',
			'data_model_1_bare_openapi_schema.1.json',
		),
	},
	// --- Phase-6 forgeManager TEST-GATE bundles (synthetic; not real standards) -----------------
	// These two rows let the forgeManager golden flow run fast and key-free. The hub bundle's
	// nodes carry _source 'CEDS' (canonical hub casing — mirrors the real forge-ceds hub so the
	// bridge's EXACT match resolves); the second carries _source 'synthstd' with cedsId crossRefs
	// into the hub, so -specified makes real SPECIFIED_MAPPING edges. standardName === the bundle's
	// emitted _source (the forgeManager invariant: --subject/--scope === the registry standardName
	// === _source, no case transform).
	p6hub: {
		standardName: 'CEDS',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-p6hub', 'forgeP6hub'),
		defaultSource: path.join(FORGE_BUNDLE_DIR, 'forge-p6hub', 'assets', 'source.json'),
	},
	p6second: {
		standardName: 'synthstd',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-p6second', 'forgeP6second'),
		defaultSource: path.join(FORGE_BUNDLE_DIR, 'forge-p6second', 'assets', 'source.json'),
	},
};

// resolveBundle — { standardName } -> { standardName, bundleFactory, defaultSource } or { error }.
const resolveBundle = ({ standardName } = {}) => {
	if (!standardName) {
		return { error: 'standard-registry: --standardName is required' };
	}
	const row = registry[`${standardName}`.toLowerCase()];
	if (!row) {
		return {
			error: `standard-registry: no forge bundle registered for standardName '${standardName}' (known: ${Object.keys(
				registry,
			).join(', ')})`,
		};
	}
	const bundleFactory = require(row.bundleFactoryPath);
	return {
		standardName: row.standardName,
		bundleFactory,
		defaultSource: row.defaultSource,
	};
};

const knownStandardNames = () => Object.values(registry).map((row) => row.standardName);

// cedsHubStandardName — the SINGLE source of truth for the CEDS hub's canonical _source casing
// ('CEDS'), sourced from the registry. specified-bridge matches the hub EXACTLY against this value
// (no toLower, no hardcoded literal). Both the real forge-ceds hub and the synthetic p6hub/test
// fixtures emit this exact casing, so the exact match resolves uniformly.
const cedsHubStandardName = registry.ceds.standardName;

module.exports = { resolveBundle, knownStandardNames, registry, cedsHubStandardName };
