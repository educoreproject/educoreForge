#!/usr/bin/env node
'use strict';

// test-gVersion.js — G-VERSION (SPEC-forgeFramework-v1.md §10.1; §6.1 step 4; Profile §10.1-10.2):
// metadata.version EQUALS the fixture's declared root version ('1.2.3', frozen) and the stamp used the
// self-described version (publishedVersion '1.2.3', versionSource 'spec'); never '' and never the recipe
// token; versionSource ∈ {spec, provenance-file, unknown}; S3 declared on a fresh fixture is refused.
//
// Run: node lib/forge-framework/test/test-gVersion.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-VERSION: version EQUALS the source's value; the stamp is honest; S3 refused on a fresh forge

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, refusalCase, forgeConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');

const GATE_ID = 'G-VERSION';
const twinRegistry = makeTwinRegistry();
const FROZEN_TOY_VERSION = '1.2.3';
const VERSION_SOURCE_LIST = ['spec', 'provenance-file', 'unknown'];

const withDescribeSource = (scenario, transform) => {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.describeSource = ({ parsed }) => transform(baseHooks.describeSource({ parsed }));
};

const conjunctList = [
	forgeConjunct({
		conjunctId: 'versionEqualsFrozenAndStampSpec',
		title: `metadata.version EQUALS '${FROZEN_TOY_VERSION}' and the stamp used the self-described version (publishedVersion '${FROZEN_TOY_VERSION}', versionSource 'spec', snapshotKey '01')`,
		twinNameList: ['selfDescribedNullWhileRootSays123'],
		judge: succeeded((result) => {
			const { version, publishedVersion, versionSource, snapshotKey } = result.metadata;
			const pass = version === FROZEN_TOY_VERSION && publishedVersion === FROZEN_TOY_VERSION && versionSource === 'spec' && snapshotKey === '01';
			return { pass, detail: JSON.stringify({ version, publishedVersion, versionSource, snapshotKey }) };
		}),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'recipeTokenRefused',
		title: "describeSource returning the recipe token 'current' as version is REFUSED by name (FA2) — the framework, not the gate, holds the line",
		shape: (scenario) => withDescribeSource(scenario, (described) => ({ ...described, version: 'current', selfDescribedVersion: 'current' })),
		regex: /describeSource returned the recipe token 'current' as a version/,
		twinName: 'disableRecipeTokenCheck', fileName: 'forge-framework.js',
		find: '\t\t\t\t\tif (RECIPE_VERSION_TOKEN_LIST.indexOf(describedSource.version) !== -1 || RECIPE_VERSION_TOKEN_LIST.indexOf(describedSource.selfDescribedVersion) !== -1) {', replace: '\t\t\t\t\tif (false) {',
	}),
	forgeConjunct({
		conjunctId: 'versionSourceClosed',
		title: 'versionSource is one of spec | provenance-file | unknown',
		twinNameList: ['stampAggregateManifest'],
		judge: succeeded((result) => ({ pass: VERSION_SOURCE_LIST.indexOf(result.metadata.versionSource) !== -1, detail: `versionSource ${JSON.stringify(result.metadata.versionSource)}` })),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 's3OnFreshFixtureRefused',
		title: 'S3 declared on a fresh fixture (outside the four) is refused naming MIGRATING_BUNDLE_LIST', mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S3' }]; },
		regex: /is non-empty but standardKey 'toy' is not in MIGRATING_BUNDLE_LIST/,
		twinName: 'putToyInsideTheFour', leverKind: 'inputFault', shippedConfig: false,
		mutate: (scenario) => { scenario.deps = { ...scenario.deps, migratingBundleListOverride: ['toy'] }; },
	}),
];

scenarioTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'versionEqualsFrozenAndStampSpec', twinName: 'selfDescribedNullWhileRootSays123', leverKind: 'inputFault',
	// the fixture provenance says 1.2.3; the hook now says the source does NOT self-describe → the
	// stamp comes from the provenance file, root version '1.2.3' disagrees with (null ?? 'unknown') → S3 needed → refused
	mutate: (scenario) => withDescribeSource(scenario, (described) => ({ ...described, selfDescribedVersion: null })),
});
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'versionSourceClosed', twinName: 'stampAggregateManifest', fileName: 'forge-framework.js', find: '\t\t\t\t\t\t\tversionSource: stamp.versionSource,', replace: "\t\t\t\t\t\t\tversionSource: 'aggregate-manifest'," });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the version stamp', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 4, expectedTwinCount: 4 }, () => harness.report());
