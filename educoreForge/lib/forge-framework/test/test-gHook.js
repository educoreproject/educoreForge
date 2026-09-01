#!/usr/bin/env node
'use strict';

// test-gHook.js — G-HOOK (SPEC-forgeFramework-v1.md §10.1; §5): the hook set is validated by a table
// walk at injection and its RETURNS are validated at first run — each violation refused by name.
// Every conjunct's twin DISABLES the specific check (productionMutation) so the fault passes → red.
//
// Run: node lib/forge-framework/test/test-gHook.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-HOOK: every hook-set violation refused by name at inject or first run

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

const GATE_ID = 'G-HOOK';
const twinRegistry = makeTwinRegistry();
const HOOK_CONTRACT_FILE = 'standardHookContract.js';
const FRAMEWORK_FILE = 'forge-framework.js';

const HOOK_KIND_CHECK_FIND = "\t\tconst reason = KIND_CHECKER_REGISTRY[contractEntry.kind](value, { contractEntry });\n\t\tif (reason !== '') {";
const HOOK_KIND_CHECK_REPLACE = "\t\tconst reason = KIND_CHECKER_REGISTRY[contractEntry.kind](value, { contractEntry });\n\t\tif (reason !== '' && false) {";

const withDescribeSource = (scenario, transform) => {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.describeSource = ({ parsed }) => transform(baseHooks.describeSource({ parsed }));
};

const conjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'missingHook',
		title: 'a missing required hook (describeRoot) is refused naming it', mode: 'inject',
		shape: (scenario) => { scenario.hookOverrides.describeRoot = undefined; },
		regex: /missing required hook 'describeRoot'/,
		twinName: 'disableRequiredHookCheck', fileName: HOOK_CONTRACT_FILE,
		find: '\t\t\tif (contractEntry.required) {', replace: '\t\t\tif (contractEntry.required && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'unknownHookName',
		title: "an unknown hook name ('parseV2') is refused naming it", mode: 'inject',
		shape: (scenario) => { scenario.hookOverrides.parseV2 = () => {}; },
		regex: /unknown hook 'parseV2'/,
		twinName: 'disableUnknownHookCheck', fileName: HOOK_CONTRACT_FILE,
		find: '\tif (unknownName !== undefined) {\n\t\treturn refuse.byName({\n\t\t\tmoduleName,\n\t\t\twhat: `hooks carries unknown hook', replace: '\tif (unknownName !== undefined && false) {\n\t\treturn refuse.byName({\n\t\t\tmoduleName,\n\t\t\twhat: `hooks carries unknown hook',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'wrongArity',
		title: 'describeSource with arity 2 is refused naming the arity', mode: 'inject',
		shape: (scenario) => { scenario.hookOverrides.describeSource = (parsedArg, extraArg) => ({}); },
		regex: /hook 'describeSource' must have arity 1 \(got 2\)/,
		twinName: 'disableHookKindCheck', fileName: HOOK_CONTRACT_FILE, find: HOOK_KIND_CHECK_FIND, replace: HOOK_KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'loaderArity',
		title: 'a loader whose load has arity 1 is refused', mode: 'inject',
		shape: (scenario) => { scenario.hookOverrides.sourceLoaderList = [{ loaderName: 'toyModel', load: (args) => {} }]; },
		regex: /entry 'toyModel' load must have arity 2/,
		twinName: 'disableHookKindCheck', fileName: HOOK_CONTRACT_FILE, find: HOOK_KIND_CHECK_FIND, replace: HOOK_KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'duplicateLoaderName',
		title: 'a duplicate loaderName is refused naming it', mode: 'inject',
		shape: (scenario) => {
			const [oneLoader] = toyScenario.toyHooksFactory().sourceLoaderList;
			scenario.hookOverrides.sourceLoaderList = [oneLoader, { loaderName: oneLoader.loaderName, load: oneLoader.load }];
		},
		regex: /loaderName 'toyModel' is declared twice/,
		twinName: 'disableHookKindCheck', fileName: HOOK_CONTRACT_FILE, find: HOOK_KIND_CHECK_FIND, replace: HOOK_KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'loaderNameNotCamelCase',
		title: 'a loaderName that is not lowerCamelCase is refused naming it', mode: 'inject',
		shape: (scenario) => {
			const [oneLoader] = toyScenario.toyHooksFactory().sourceLoaderList;
			scenario.hookOverrides.sourceLoaderList = [{ loaderName: 'Toy_Model', load: oneLoader.load }];
		},
		regex: /loaderName 'Toy_Model' is not lowerCamelCase/,
		twinName: 'disableHookKindCheck', fileName: HOOK_CONTRACT_FILE, find: HOOK_KIND_CHECK_FIND, replace: HOOK_KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'loaderNameMetadata',
		title: "loaderName 'metadata' is refused as reserved", mode: 'inject',
		shape: (scenario) => {
			const [oneLoader] = toyScenario.toyHooksFactory().sourceLoaderList;
			scenario.hookOverrides.sourceLoaderList = [{ loaderName: 'metadata', load: oneLoader.load }];
		},
		regex: /loaderName 'metadata' is reserved/,
		twinName: 'disableHookKindCheck', fileName: HOOK_CONTRACT_FILE, find: HOOK_KIND_CHECK_FIND, replace: HOOK_KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'loaderEntryMissingLoad',
		title: 'a sourceLoaderList entry without load is refused', mode: 'inject',
		shape: (scenario) => { scenario.hookOverrides.sourceLoaderList = [{ loaderName: 'toyModel' }]; },
		regex: /entry 'toyModel' is missing load/,
		twinName: 'disableHookKindCheck', fileName: HOOK_CONTRACT_FILE, find: HOOK_KIND_CHECK_FIND, replace: HOOK_KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'describeSourceFourOfFive',
		title: 'describeSource returning four keys of five is refused naming the missing key',
		shape: (scenario) => withDescribeSource(scenario, (described) => { const { sourceFormat, ...rest } = described; return rest; }),
		regex: /describeSource is missing key 'sourceFormat'/,
		twinName: 'disableMissingKeyCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (missingDescribedName !== undefined) {', replace: '\t\t\t\t\tif (missingDescribedName !== undefined && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'describeSourceUndeclaredKey',
		title: 'describeSource returning an undeclared key is refused naming it',
		shape: (scenario) => withDescribeSource(scenario, (described) => ({ ...described, publisher: 'Toy Inc' })),
		regex: /describeSource returned undeclared key 'publisher'/,
		twinName: 'disableUndeclaredKeyCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (unknownDescribedName !== undefined) {\n\t\t\t\t\t\tnext(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned undeclared key', replace: '\t\t\t\t\tif (unknownDescribedName !== undefined && false) {\n\t\t\t\t\t\tnext(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned undeclared key',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'declaredVersionDisagreesWithStamp',
		// ⟪versionFromStamp, 2026-09-01⟫ REWRITTEN FROM 'versionDisagreesWithoutS3'. The invariant is
		// UNCHANGED and TRANSFERRED: a version disagreement that nothing evidences is refused BY NAME.
		// What changed is what enforces it. It used to be the undeclared-but-needed sweep naming
		// allowance S3; S3 and P17 are RETIRED, and refuseVersionDisagreement now refuses the same
		// condition outright — STRICTER, because no allowance can permit it any more. Rewritten in the
		// SAME phase the rows died, so the invariant is never unguarded.
		title: 'a DECLARED version differing from the resolved stamp is refused by name, and no allowance can permit it',
		shape: (scenario) => withDescribeSource(scenario, (described) => ({ ...described, version: '9.9.9' })),
		regex: /DECLARES version '9\.9\.9' but the provenance stamp resolves/,
		twinName: 'disableDisagreementGuard', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\tif (disagreementRefusal) {', replace: '\t\t\t\t\t\tif (false && disagreementRefusal) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'sourceFilesEmptyWithoutS7',
		title: 'sourceFiles [] without S7 is refused naming S7',
		shape: (scenario) => withDescribeSource(scenario, (described) => ({ ...described, sourceFiles: [] })),
		regex: /would need allowance S7 \(sif\)/,
		twinName: 'disableUndeclaredNeededAllowanceCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (oneRow.preconditionMet(context)) {\n\t\t\t\t\tconst idList', replace: '\t\t\t\tif (false && oneRow.preconditionMet(context)) {\n\t\t\t\t\tconst idList',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'versionEmptyString',
		title: "describeSource version '' is refused (the seam would refuse it later; the cheap refusal belongs here)",
		shape: (scenario) => withDescribeSource(scenario, (described) => ({ ...described, version: '', selfDescribedVersion: null })),
		regex: /describeSource returned version ""/,
		twinName: 'disableVersionCheck', fileName: FRAMEWORK_FILE,
		find: "\t\t\t\t\tif (describedSource.version !== undefined && (typeof describedSource.version !== 'string' || describedSource.version.length === 0)) {", replace: "\t\t\t\t\tif (false && describedSource.version !== undefined && (typeof describedSource.version !== 'string' || describedSource.version.length === 0)) {",
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'sourceFilesUnverifiedRefused',
		title: 'describeSource.sourceFiles naming a file the framework did NOT verify against SHA256SUMS is refused by name (FA5)',
		shape: (scenario) => withDescribeSource(scenario, (described) => ({ ...described, sourceFiles: described.sourceFiles.concat(['neverExisted.json']) })),
		regex: /describeSource names sourceFiles entry 'neverExisted.json' that is neither verified against SHA256SUMS \(verified: toyModel.json\) nor a declared logical name \(declared: none — no logical-name allowance active\)/,
		twinName: 'disableSourceFilesCrossCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (unverifiedSourceFile !== undefined) {', replace: '\t\t\t\t\tif (unverifiedSourceFile !== undefined && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'additionalInputAbsentOnDisk',
		title: 'a declared additionalSourceInputList entry absent on disk / unlisted is refused naming it',
		shape: (scenario) => { scenario.forgeDeclaration.additionalSourceInputList = [{ inputName: 'refIdResolutionMap', relativePathFromSourcePath: 'refIdResolutionMap.tsv' }]; },
		regex: /declared additional source input 'refIdResolutionMap' \(refIdResolutionMap.tsv\) is not listed in SHA256SUMS/,
		twinName: 'disableAdditionalInputCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\tif (unlistedInput) {', replace: '\t\t\t\t\t\tif (unlistedInput && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'walkReturnsForeignNode',
		title: 'a walk returning a node object the kit did not mint is refused ("the kit is the only door")',
		shape: (scenario) => {
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => {
				const walkResult = baseHooks.emitContractGraph(context);
				const foreignNode = { labels: ['ForgedNode', 'ToyClass', 'DmeClass'], stableId: 'toy:class/Smuggled', role: 'DmeClass', properties: { _id: 'toy:class/Smuggled', _source: 'Toy', name: 'Smuggled', role: 'DmeClass', toyStableId: 'toy:class/Smuggled', searchText: 'Toy | Toy | Smuggled', parentId: 'toy:root', path: 'Smuggled' } };
				return { ...walkResult, nodes: walkResult.nodes.concat([foreignNode]) };
			};
		},
		regex: /returned a node at index \d+ the kit did not mint \(stableId 'toy:class\/Smuggled'\)/,
		twinName: 'disableOriginCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (!mintedNodeSet.has(oneNode)) {', replace: '\t\t\t\t\tif (!mintedNodeSet.has(oneNode) && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'walkDropsMintedNode',
		title: 'a walk that omits a minted node from its return is refused (silent loss)',
		shape: (scenario) => {
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => {
				const walkResult = baseHooks.emitContractGraph(context);
				return { ...walkResult, nodes: walkResult.nodes.slice(1) };
			};
		},
		regex: /returned 15 of 16 minted nodes \(missing 'toy:root'\)/,
		twinName: 'disableCompletenessCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (seenNodeSet.size !== mintedNodeSet.size) {', replace: '\t\t\t\tif (seenNodeSet.size !== mintedNodeSet.size && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'loaderErrorPrefixed',
		title: "a loader's error is surfaced prefixed 'forge-toy <loaderName>:'",
		shape: (scenario) => { scenario.hookOverrides.sourceLoaderList = [{ loaderName: 'toyModel', load: (args, callback) => callback('the loader broke') }]; },
		regex: /^forge-toy toyModel: the loader broke/,
		twinName: 'dropLoaderErrorPrefix', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\t\t\tnext(`${forgePrefix} ${oneLoader.loaderName}: ${loadError}`);', replace: '\t\t\t\t\t\t\t\tnext(`${loadError}`);',
	}),
];

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the hook set, validated by name', conjunctList }];

runGateFamily(
	{ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 18, expectedTwinCount: 18 },
	() => harness.report(),
);
