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
	sif: {
		standardName: 'SIF',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-sif', 'forgeSif'),
		// the parser accepts the version DIRECTORY (it resolves the ImplementationSpecification*.tsv
		// + the sibling refIdResolutionMap.tsv from inside it).
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-sif',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	case: {
		standardName: 'CASE',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-case', 'forgeCase'),
		// the IMS Global / 1EdTech CASE Service v1.1 OpenAPI 3.0 YAML schema (first YAML forge). The
		// parser accepts either the file or its containing version directory.
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-case',
			'assets',
			'standardSourceData',
			'01',
			'imscasev1p1_openapi3_v1p0.yaml.txt',
		),
	},
	edfi: {
		standardName: 'EdFi',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-edfi', 'forgeEdfi'),
		// the parser accepts the version DIRECTORY (it resolves both EdFi→CEDS crosswalk CSVs —
		// EdFiEntityElementsToCEDS.csv + EdFiEntityDescriptorsToCEDS.csv — from inside it).
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-edfi',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	// --- Wave-2 CSV-family standards (cloned from forge-sif/forge-edfi; CSV runbook) -------------
	// standardName === _source EXACT (forgeManager invariant: --subject/--scope === standardName ===
	// _source, no case transform). defaultSource is the version DIRECTORY; each forge resolves its
	// source file(s) from inside it (the SIF/EdFi pattern). The bundleFactory + source are populated
	// by each standard's Wave-2 forge agent at the path below.
	jedx: {
		standardName: 'JEDx',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-jedx', 'forgeJedx'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-jedx',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	sedm: {
		standardName: 'SEDM',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-sedm', 'forgeSedm'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-sedm',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	cip: {
		standardName: 'CIP',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-cip', 'forgeCip'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-cip',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	soc: {
		standardName: 'SOC',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-soc', 'forgeSoc'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-soc',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	// --- Wave-3 OpenAPI-family standards (cloned from forge-lif/forge-case; OpenAPI runbook) -----
	// defaultSource is the version DIRECTORY; the OpenAPI parser accepts the file OR its containing
	// directory (the CASE/LIF pattern). standardName === _source EXACT. Populated by each Wave-3 agent.
	clr: {
		standardName: 'CLR',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-clr', 'forgeClr'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-clr',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	openbadges: {
		standardName: 'OpenBadges',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-openbadges', 'forgeOpenbadges'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-openbadges',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	eduapi: {
		standardName: 'EduAPI',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-eduapi', 'forgeEduapi'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-eduapi',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	// --- Wave-4 XSD-family standards (new pattern; trailblazer PESC writes the XSD runbook) ------
	// defaultSource is the version DIRECTORY (multiple .xsd / .wsdl schema files resolved inside).
	// standardName === _source EXACT. Populated by each Wave-4 agent.
	pesc: {
		standardName: 'PESC',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-pesc', 'forgePesc'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-pesc',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	medbiquitous: {
		standardName: 'MedBiquitous',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-medbiquitous', 'forgeMedbiquitous'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-medbiquitous',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	// --- Wave-5 JSON-LD-family standards (new pattern; trailblazer CTDL writes the JSON-LD runbook)
	ctdl: {
		standardName: 'CTDL',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-ctdl', 'forgeCtdl'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-ctdl',
			'assets',
			'standardSourceData',
			'01',
		),
	},
	dctap: {
		standardName: 'DCTAP',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-dctap', 'forgeDctap'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-dctap',
			'assets',
			'standardSourceData',
			'01',
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
