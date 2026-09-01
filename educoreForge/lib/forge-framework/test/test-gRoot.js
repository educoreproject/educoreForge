#!/usr/bin/env node
'use strict';

// test-gRoot.js — G-ROOT (SPEC-forgeFramework-v1.md §10.1; §6.5; Profile §10.4): exactly one
// DmeStandardRoot; the eight + parserVersion + (snapshotKey, publishedVersion, versionSource,
// coreVersion) present non-empty, refused by name otherwise; extraProperties without an allowance
// refused; an allowance can never license omitting parserVersion (FR10). Where the SUBJECT itself must
// be a framework double (the declaration/describeSource checks fire first otherwise), the subject
// carries a mutation that OMITS a root property from the candidate and the conjunct asserts the
// root ENFORCEMENT refuses it; the twin disables the enforcement → red.
//
// Run: node lib/forge-framework/test/test-gRoot.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-ROOT: one root, the eight + five enforced by name, no unlicensed extra, parserVersion never omitted

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { refusalCase, shapedConjunct, frameworkMutationTwin, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { DME_ROLES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));

const GATE_ID = 'G-ROOT';
const twinRegistry = makeTwinRegistry();
const ROOT_FILE = 'rootNode.js';
const FRAMEWORK_FILE = 'forge-framework.js';
const REGISTRY_FILE = 'migrationAllowanceRegistry.js';
const rootFilePath = path.join(toyScenario.FRAMEWORK_DIR, ROOT_FILE);

const ENFORCEMENT_FIND = '\t\tif (isAbsent || (isEmpty && rootEmptyPermittedPropertyList.indexOf(oneName) === -1)) {';
const ENFORCEMENT_REPLACE = '\t\tif (false && (isAbsent || (isEmpty && rootEmptyPermittedPropertyList.indexOf(oneName) === -1))) {';

const omitFromCandidate = (scenario, candidateLine) => {
	scenario.frameworkMutationList.push({ modulePath: rootFilePath, find: candidateLine, replace: '' });
};

const withDescribeRoot = (scenario, describedRoot) => {
	scenario.hookOverrides.describeRoot = ({ parsed, metadata }) => describedRoot;
};

const conjunctList = [
	shapedConjunct({
		conjunctId: 'exactlyOneRoot',
		title: 'exactly one DmeStandardRoot in the output, framework-built (count EQUALS 1)',
		twinNameList: ['walkMintsSecondRoot'],
		judge: succeeded((result) => {
			const rootCount = result.nodes.filter((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT).length;
			return { pass: rootCount === 1, detail: `root count ${rootCount}` };
		}),
	}),
	shapedConjunct({
		conjunctId: 'eightPlusFivePresent',
		title: 'the eight + parserVersion + snapshotKey/publishedVersion/versionSource/coreVersion are present and non-empty on the root',
		twinNameList: ['dropCoreVersionFromCandidateAndEnforcement'],
		judge: succeeded((result) => {
			const rootNode = result.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
			const nameList = ['standardKey', 'standardName', 'version', 'sourceFormat', 'sourceFiles', 'sourceUrl', 'stableUriPropertyName', 'mappingInstruction', 'snapshotKey', 'publishedVersion', 'versionSource', 'parserVersion', 'coreVersion'];
			const missing = nameList.find((oneName) => rootNode.properties[oneName] === undefined || rootNode.properties[oneName] === '' || (Array.isArray(rootNode.properties[oneName]) && rootNode.properties[oneName].length === 0));
			return { pass: missing === undefined && rootNode.properties.coreVersion === '2.0.0', detail: missing ? `root lacks ${missing}` : `all thirteen present; coreVersion ${rootNode.properties.coreVersion}` };
		}),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'missingMappingInstructionRefused',
		title: "a root candidate lacking mappingInstruction is refused naming it (subject: the candidate line removed)",
		shape: (scenario) => omitFromCandidate(scenario, '\t\tmappingInstruction: JSON.stringify(mappingInstruction),\n'),
		regex: /the root is missing required property 'mappingInstruction'/,
		twinName: 'disableRootEnforcement', fileName: ROOT_FILE, find: ENFORCEMENT_FIND, replace: ENFORCEMENT_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'missingSnapshotKeyRefused',
		title: 'a root candidate lacking snapshotKey (no P5) is refused naming it',
		shape: (scenario) => omitFromCandidate(scenario, '\t\tsnapshotKey: metadata.snapshotKey,\n'),
		regex: /the root is missing required property 'snapshotKey'/,
		twinName: 'disableRootEnforcement', fileName: ROOT_FILE, find: ENFORCEMENT_FIND, replace: ENFORCEMENT_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'missingParserVersionRefused',
		title: 'a root candidate lacking parserVersion is refused naming it',
		shape: (scenario) => omitFromCandidate(scenario, '\t\tparserVersion,\n\t\tcoreVersion: CORE_VERSION,'),
		regex: /the root is missing required property 'parserVersion'/,
		twinName: 'disableRootEnforcement', fileName: ROOT_FILE, find: ENFORCEMENT_FIND, replace: ENFORCEMENT_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'extraPropertiesUnlicensed',
		title: 'describeRoot returning extraProperties without an allowance is refused naming the key',
		shape: (scenario) => withDescribeRoot(scenario, { extraProperties: { pescTier: 'meta' } }),
		regex: /describeRoot.extraProperties carries 'pescTier' and no active allowance names it/,
		twinName: 'disableExtraPropertyCheck', fileName: ROOT_FILE,
		find: '\tif (unlicensedExtraName !== undefined) {', replace: '\tif (unlicensedExtraName !== undefined && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'describeRootUnknownKey',
		title: 'describeRoot returning an unknown key is refused (a root field is framework-built)',
		shape: (scenario) => withDescribeRoot(scenario, { description: 'x', coreVersion: '9' }),
		regex: /describeRoot returned unknown property 'coreVersion'/,
		twinName: 'disableDescribedRootKeyCheck', fileName: ROOT_FILE,
		find: '\tif (unknownDescribedName !== undefined) {', replace: '\tif (unknownDescribedName !== undefined && false) {',
	}),
	shapedConjunct({
		conjunctId: 'descriptionAbsentOmitted',
		title: 'an absent describeRoot.description → the root carries NO description property (never a template)',
		twinNameList: ['templateDescriptionWhenAbsent'],
		shape: (scenario) => withDescribeRoot(scenario, {}),
		judge: succeeded((result) => {
			const rootNode = result.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
			return { pass: !Object.prototype.hasOwnProperty.call(rootNode.properties, 'description'), detail: `description ${JSON.stringify(rootNode.properties.description)}` };
		}),
	}),
	// FR10 — an allowance row that tried to license omitting parserVersion is refused BY THE FRAMEWORK:
	// the subject carries a REGISTRY DOUBLE giving S7 an allowanceData rootOmitPropertyList, the toy
	// declares S7 as 'sif' with rootOmitPropertyList ['parserVersion'] (S7's own precondition made true)
	// ⟪versionFromStamp, 2026-09-01⟫ VEHICLE SWAPPED S3 -> S7. THE INVARIANT IS UNCHANGED — FR10 says
	// parserVersion is NEVER licensable for omission, whatever row tries. S3 was only the carrier and it
	// is RETIRED with P17 and their shared factory. S7 is a live sif row with the same empty
	// allowanceDataContract and a precondition this shape can satisfy (sourceFiles []).
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'parserVersionNeverLicensed',
		title: 'an allowance licensing omission of parserVersion is refused (FR10) — registry double: S7 carries rootOmitPropertyList',
		shape: (scenario) => {
			scenario.frameworkMutationList.push({ modulePath: path.join(toyScenario.FRAMEWORK_DIR, REGISTRY_FILE), find: "\t\tallowanceDataContract: Object.freeze({}),\n\t\trootEmptyPermittedPropertyList: Object.freeze(['sourceFiles']),", replace: "\t\tallowanceDataContract: Object.freeze({ rootOmitPropertyList: Object.freeze({ kind: 'stringList' }) }),\n\t\trootEmptyPermittedPropertyList: Object.freeze(['sourceFiles'])," });
			scenario.forgeDeclaration.standardKey = 'sif';
			scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S7', rootOmitPropertyList: ['parserVersion'] }];
			const baseHooks = toyScenario.toyHooksFactory();
			// S7's precondition made true: sourceFiles []
			scenario.hookOverrides.describeSource = ({ parsed }) => ({ ...baseHooks.describeSource({ parsed }), sourceFiles: [] });
		},
		regex: /an allowance licenses omitting root 'parserVersion' — parserVersion is never licensed for omission \(FR10\)/,
		twinName: 'disableNeverOmittableCheck', fileName: ROOT_FILE,
		find: '\tif (forbiddenOmission !== undefined) {', replace: '\tif (forbiddenOmission !== undefined && false) {',
	}),
];

// twins for the success-judged conjuncts
frameworkMutationTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'exactlyOneRoot', twinName: 'walkMintsSecondRoot', fileName: FRAMEWORK_FILE,
	// the framework itself minting a second root: the toy walk cannot (the finalizer refuses two roots by
	// name), so the fault is a framework double that pushes the root twice — the count gate must see 2
	find: '\t\t\t\tkitInternals.nodes.push(rootNode);', replace: '\t\t\t\tkitInternals.nodes.push(rootNode); kitInternals.nodes.push({ ...rootNode, stableId: rootNode.stableId + ":again", properties: { ...rootNode.properties } });',
});
frameworkMutationTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'eightPlusFivePresent', twinName: 'dropCoreVersionFromCandidateAndEnforcement', fileName: ROOT_FILE,
	find: '\t\tparserVersion,\n\t\tcoreVersion: CORE_VERSION,', replace: '\t\tparserVersion,',
});
frameworkMutationTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'descriptionAbsentOmitted', twinName: 'templateDescriptionWhenAbsent', fileName: ROOT_FILE,
	find: '\t\t...(describedRoot.description !== undefined ? { description: describedRoot.description } : {}),', replace: '\t\t...(describedRoot.description !== undefined ? { description: describedRoot.description } : { description: `${standardDisplayName} — a template` }),',
});

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the root, framework-built from declared data', conjunctList }];

runGateFamily(
	{ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 9, expectedTwinCount: 9 },
	() => harness.report(),
);
