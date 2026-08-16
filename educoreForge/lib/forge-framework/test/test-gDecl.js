#!/usr/bin/env node
'use strict';

// test-gDecl.js — G-DECL (SPEC-forgeFramework-v1.md §10.1; §4): the declaration object is validated by
// a table walk at injectStandardHooks and every violation is refused BY NAME. One conjunct per
// required declaration key (drop it → refused naming it) plus the unknown-key, closed-value, kind,
// mappingInstruction-order, role, allowance-id, declarableBy, offline-probeEvidence, outside-the-four
// and stableIdPattern-shape refusals. Every conjunct's twin DISABLES the specific check in the
// framework (productionMutation) so the faulted input passes and the gate goes red.
//
// Run: node lib/forge-framework/test/test-gDecl.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-DECL: every declaration violation refused by name at injection

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const toyScenario = require('./testSupport/toyScenario');
const { refusalCase } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { FORGE_DECLARATION_CONTRACT } = require('../forgeDeclarationContract');

const GATE_ID = 'G-DECL';
const twinRegistry = makeTwinRegistry();
const CONTRACT_FILE = 'forgeDeclarationContract.js';

// the required-key check, disabled: `if (isRequiredHere) {` → never
const REQUIRED_CHECK_FIND = '\t\t\tif (isRequiredHere) {';
const REQUIRED_CHECK_REPLACE = '\t\t\tif (isRequiredHere && false) {';
// the kind-checker refusal, disabled: `if (reason !== '') {` → never
const KIND_CHECK_FIND = "\t\tif (reason !== '') {\n\t\t\treturn refuse.byName({\n\t\t\t\tmoduleName,\n\t\t\t\twhat: `forgeDeclaration '${propertyName}' ${reason}`,";
const KIND_CHECK_REPLACE = "\t\tif (reason !== '' && false) {\n\t\t\treturn refuse.byName({\n\t\t\t\tmoduleName,\n\t\t\t\twhat: `forgeDeclaration '${propertyName}' ${reason}`,";

const requiredKeyList = Object.keys(FORGE_DECLARATION_CONTRACT).filter((oneName) => FORGE_DECLARATION_CONTRACT[oneName].required);

const conjunctList = [];

// one conjunct PER required key: drop it → refused naming it
requiredKeyList.forEach((oneKeyName) => {
	conjunctList.push(
		refusalCase({
			registry: twinRegistry,
			gateId: GATE_ID,
			conjunctId: `drop_${oneKeyName}`,
			title: `dropping required '${oneKeyName}' is refused naming it`,
			mode: 'inject',
			shape: (scenario) => {
				delete scenario.forgeDeclaration[oneKeyName];
			},
			regex: new RegExp(`missing required property '${oneKeyName}'`),
			twinName: 'disableRequiredKeyCheck',
			fileName: CONTRACT_FILE,
			find: REQUIRED_CHECK_FIND,
			replace: REQUIRED_CHECK_REPLACE,
		}),
	);
});
// rootStableId is required WHEN rootStableIdFrom === 'declared'
conjunctList.push(
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'drop_rootStableId_whenDeclared',
		title: "dropping rootStableId while rootStableIdFrom is 'declared' is refused naming it",
		mode: 'inject',
		shape: (scenario) => { delete scenario.forgeDeclaration.rootStableId; },
		regex: /missing required property 'rootStableId'/,
		twinName: 'disableRequiredKeyCheck', fileName: CONTRACT_FILE, find: REQUIRED_CHECK_FIND, replace: REQUIRED_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'rootStableId_forbiddenWithSourceUrl',
		title: "rootStableId present with rootStableIdFrom 'sourceUrl' is refused",
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.rootStableIdFrom = 'sourceUrl'; },
		regex: /'rootStableId' is present but forbidden/,
		twinName: 'disableForbiddenCheck', fileName: CONTRACT_FILE,
		find: '\t\tif (isForbiddenHere) {', replace: '\t\tif (isForbiddenHere && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'unknownKey',
		title: 'an UNKNOWN declaration key (a typo) is refused naming it',
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.stableUriPropertyNmae = 'oops'; },
		regex: /unknown property 'stableUriPropertyNmae'/,
		twinName: 'disableUnknownKeyCheck', fileName: CONTRACT_FILE,
		find: '\tif (unknownName !== undefined) {\n\t\treturn refuse.byName({\n\t\t\tmoduleName,\n\t\t\twhat: `forgeDeclaration carries unknown property', replace: '\tif (unknownName !== undefined && false) {\n\t\treturn refuse.byName({\n\t\t\tmoduleName,\n\t\t\twhat: `forgeDeclaration carries unknown property',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'closedValue_rootStableIdFrom',
		title: "rootStableIdFrom 'newest' is refused as outside the closed enumeration",
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.rootStableIdFrom = 'newest'; },
		regex: /'rootStableIdFrom' 'newest' is not one of: declared, sourceUrl/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'wrongKind_standardKeyUppercase',
		title: "standardKey 'TOY' (not lowercase) is refused as the wrong kind",
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.standardKey = 'TOY'; },
		regex: /'standardKey' must be a non-empty lowercase string/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'mappingInstruction_permuted',
		title: 'a mappingInstruction with the six keys in the WRONG order is refused naming the position',
		mode: 'inject',
		shape: (scenario) => {
			const { cedsOriginalAnchorPropertyName, ...rest } = scenario.forgeDeclaration.mappingInstruction;
			scenario.forgeDeclaration.mappingInstruction = { ...rest, cedsOriginalAnchorPropertyName };
		},
		regex: /'mappingInstruction' key 1 must be 'cedsOriginalAnchorPropertyName'/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'mappingInstruction_missingKey',
		title: 'a mappingInstruction missing a key is refused naming the six',
		mode: 'inject',
		shape: (scenario) => { delete scenario.forgeDeclaration.mappingInstruction.impliedTargets; },
		regex: /'mappingInstruction' must carry exactly the six keys/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'mappingInstruction_extraKey',
		title: 'a mappingInstruction with a seventh key is refused',
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.mappingInstruction.seventh = true; },
		regex: /'mappingInstruction' must carry exactly the six keys/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'nonEmbeddableRole_notDmeRole',
		title: 'a non-DME_ROLES member in nonEmbeddableRoleList is refused naming it',
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.nonEmbeddableRoleList = ['DmeGadget']; },
		regex: /'nonEmbeddableRoleList' 'DmeGadget' is not a DME_ROLES member/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'stableIdPattern_shape',
		title: 'a stableIdPattern that is not { pattern, trimmed } is refused',
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.stableIdPattern = '^toy:.*$'; },
		regex: /'stableIdPattern' must be \{ pattern, trimmed \}/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'stableIdPattern_trimmedNotBoolean',
		title: 'a stableIdPattern whose trimmed is not a boolean is refused',
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.stableIdPattern = { pattern: '^toy:.*$', trimmed: 'yes' }; },
		regex: /'stableIdPattern' trimmed must be a boolean/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'unknownAllowanceId',
		title: 'an unknown allowance id is refused naming the known rows',
		mode: 'inject',
		shape: (scenario) => {
			scenario.deps = { ...scenario.deps, migratingBundleListOverride: ['toy'] };
			scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'Z9' }];
		},
		regex: /allowanceId 'Z9' is not a MIGRATION_ALLOWANCE_REGISTRY row/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'allowanceOutsideDeclarableBy',
		title: "an allowance id outside declarableBy (edfi declaring S2, a sif row) is refused naming both",
		mode: 'inject',
		shape: (scenario) => {
			scenario.forgeDeclaration.standardKey = 'edfi';
			scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S2', coerceEmptyStringPropertyList: ['name'] }];
		},
		regex: /allowanceId 'S2' is declarable only by sif, not by 'edfi'/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e8DeclarableOnlyByEdfi',
		title: "E8 (root sourceFiles may name logical loader names) is declarable by edfi ONLY — sif declaring it is refused naming both",
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.standardKey = 'sif'; scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E8' }]; },
		regex: /allowanceId 'E8' is declarable only by edfi, not by 'sif'/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'nonEmptyAllowanceOutsideTheFour',
		title: "a non-empty allowance list on a standardKey outside MIGRATING_BUNDLE_LIST ('toy' declaring E6) is refused",
		mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E6' }]; },
		regex: /is non-empty but standardKey 'toy' is not in MIGRATING_BUNDLE_LIST/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'allowanceDataMissing',
		title: "S2 declared without its allowanceData coerceEmptyStringPropertyList is refused (sif, inside the four)",
		mode: 'inject',
		shape: (scenario) => {
			scenario.forgeDeclaration.standardKey = 'sif';
			scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S2' }];
		},
		regex: /allowanceId 'S2' must carry allowanceData 'coerceEmptyStringPropertyList'/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	// the offline-precondition PRESENCE check: no F3a row is offline, so the SUBJECT carries a REGISTRY
	// DOUBLE that flips S3 to the offline kind (a productionMutation of DATA); the conjunct then asserts
	// that S3 declared without probeEvidence is refused naming probeEvidence
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'offlineRowWithoutProbeEvidence',
		title: 'an offline-precondition row declared without probeEvidence is refused naming probeEvidence (registry double: S3 flipped to offline)',
		mode: 'inject',
		shape: (scenario) => {
			scenario.frameworkMutationList.push({ modulePath: require('path').join(toyScenario.FRAMEWORK_DIR, 'migrationAllowanceRegistry.js'), find: "\t\tallowanceId: 'S3',\n\t\trowRefId: 'S3',\n\t\tdeclarableBy: Object.freeze(['sif']),\n\t\tkind: ALLOWANCE_KIND.FORGE_TIME,", replace: "\t\tallowanceId: 'S3',\n\t\trowRefId: 'S3',\n\t\tdeclarableBy: Object.freeze(['sif']),\n\t\tkind: ALLOWANCE_KIND.OFFLINE," });
			scenario.forgeDeclaration.standardKey = 'sif';
			scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S3' }];
		},
		regex: /allowanceId 'S3' is an offline-precondition row and must carry probeEvidence/,
		twinName: 'disableProbeEvidenceCheck', fileName: CONTRACT_FILE,
		find: '\t\t\tif (registryRow.kind === ALLOWANCE_KIND.OFFLINE && !isPlainObject(oneEntry.probeEvidence)) {', replace: '\t\t\tif (false && registryRow.kind === ALLOWANCE_KIND.OFFLINE && !isPlainObject(oneEntry.probeEvidence)) {',
	}),
);

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the declaration object, validated by name', conjunctList }];

runGateFamily(
	{
		harness,
		familyName: GATE_ID,
		gateDeclarationList,
		twinRegistry,
		makeSubject: toyScenario.makeScenario,
		cloneSubject: toyScenario.cloneScenario,
		expectedConjunctCount: requiredKeyList.length + 17,
		expectedTwinCount: requiredKeyList.length + 17,
	},
	() => harness.report(),
);
