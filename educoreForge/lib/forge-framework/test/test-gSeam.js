#!/usr/bin/env node
'use strict';

// test-gSeam.js — G-SEAM (SPEC-forgeFramework-v1.md §10.1): the fixture entry module satisfies the
// forger's seam UNCHANGED (forger.js:816-828; interfaces.js:229-240). Every conjunct has a twin
// registered in DATA (gateId + conjunct, leverKind) and is OBSERVED RED by the sweep on every run.
//
// Run: node lib/forge-framework/test/test-gSeam.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-SEAM: the toy entry module satisfies the forger seam unchanged

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, forgeConjunct, injectConjunct, nameInRefusal, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');

const GATE_ID = 'G-SEAM';
const twinRegistry = makeTwinRegistry();

// =====================================================================
// the entry-module conjunct is evaluated against the REAL fixture entry file, not a scenario
// =====================================================================
const entryConjunct = {
	conjunctId: 'entryShape',
	title: 'require(fixtureEntry) is a function of { embedder } returning { forge, buildContractGraph, STANDARD_KEY, STANDARD_SOURCE, STABLE_URI_PROPERTY_NAME } (the house shape `({ embedder } = {}) =>` has Function.length 0, so the shape is asserted, not the arity)',
	twinNameList: ['renamePureExportP7'],
	evaluate: (scenario, callback) => {
		// the entry file is a wiring line over the framework; the twin faults the FRAMEWORK's bundle
		// return (P7 shape) and the entry inherits it — evaluated through the scenario so the mutation lands
		const outcome = toyScenario.injectOnly(scenario);
		if (outcome.injectionError) {
			callback('', { pass: false, detail: outcome.injectionError });
			return;
		}
		const entryFactory = require(toyScenario.TOY_ENTRY_PATH);
		const nameList = ['forge', 'buildContractGraph', 'STANDARD_KEY', 'STANDARD_SOURCE', 'STABLE_URI_PROPERTY_NAME'];
		const missingName = nameList.find((oneName) => outcome.bundle[oneName] === undefined);
		const entryBundle = typeof entryFactory === 'function' ? entryFactory({ embedder: null }) : undefined;
		const entryMissingName = entryBundle ? nameList.find((oneName) => entryBundle[oneName] === undefined) : 'the whole bundle';
		callback('', {
			pass: typeof entryFactory === 'function' && missingName === undefined && entryMissingName === undefined && typeof outcome.bundle.buildContractGraph === 'function',
			detail: missingName ? `bundle lacks '${missingName}' (has ${Object.keys(outcome.bundle).join(', ')})` : entryMissingName ? `the real entry's bundle lacks '${entryMissingName}'` : `entry is a function; bundle names ${Object.keys(outcome.bundle).join(', ')}`,
		});
	},
};
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'entryShape', twinName: 'renamePureExportP7', fileName: 'forge-framework.js', find: '\t\t\t\tforge,\n\t\t\t\tbuildContractGraph,', replace: '\t\t\t\tforge,\n\t\t\t\tbuildSourceTierGraph: buildContractGraph,' });

// =====================================================================
const gateDeclarationList = [
	{
		gateId: GATE_ID,
		title: 'the seam, unchanged',
		conjunctList: [
			entryConjunct,
			injectConjunct({
				conjunctId: 'forgeArity',
				title: 'forge.length === 2',
				twinNameList: ['forgeArityThree'],
				judge: (outcome) => (outcome.injectionError ? { pass: false, detail: outcome.injectionError } : { pass: outcome.bundle.forge.length === 2, detail: `forge.length ${outcome.bundle.forge.length}` }),
			}),
			forgeConjunct({
				conjunctId: 'callsBackEmptyString',
				title: "forge calls back ('', result)",
				twinNameList: ['callBackNullFirst'],
				judge: (outcome) => (outcome.forgeError === '' && outcome.result !== undefined ? { pass: true, detail: 'first arg is the empty string' } : { pass: false, detail: `first arg ${JSON.stringify(outcome.forgeError)}${outcome.thrownFromForge ? ` thrown: ${outcome.thrownFromForge}` : ''}` }),
			}),
			forgeConjunct({
				conjunctId: 'nodesEdgesArrays',
				title: 'the return carries nodes[] and edges[]',
				twinNameList: ['nodesAsObject'],
				judge: succeeded((result) => ({ pass: Array.isArray(result.nodes) && Array.isArray(result.edges), detail: `nodes ${Array.isArray(result.nodes) ? result.nodes.length : typeof result.nodes}, edges ${Array.isArray(result.edges) ? result.edges.length : typeof result.edges}` })),
			}),
			forgeConjunct({
				conjunctId: 'metadataFour',
				title: 'metadata.{version, snapshotKey, publishedVersion, versionSource} all present, version non-empty',
				twinNameList: ['dropSnapshotKey'],
				judge: succeeded((result) => {
					const missing = ['version', 'snapshotKey', 'publishedVersion', 'versionSource'].find((oneName) => result.metadata[oneName] === undefined || result.metadata[oneName] === '');
					return { pass: missing === undefined, detail: missing ? `metadata lacks ${missing}` : JSON.stringify(result.metadata) };
				}),
			}),
			forgeConjunct({
				conjunctId: 'embedCallCountNumeric',
				title: 'embedCallCount is a number',
				twinNameList: ['embedCallCountAsString'],
				judge: succeeded((result) => ({ pass: typeof result.embedCallCount === 'number', detail: `embedCallCount ${JSON.stringify(result.embedCallCount)} (${typeof result.embedCallCount})` })),
			}),
			forgeConjunct({
				conjunctId: 'standardKeyEqualsToken',
				title: "standardKey EQUALS the bundle token 'toy' (the declaration's standardKey)",
				twinNameList: ['standardKeyFromSource'],
				judge: succeeded((result, outcome) => ({ pass: result.standardKey === 'toy' && result.standardKey === outcome.bundle.STANDARD_KEY, detail: `standardKey ${JSON.stringify(result.standardKey)}` })),
			}),
			forgeConjunct({
				conjunctId: 'stableUriPropertyCarried',
				title: 'stableUriPropertyName names a property EVERY node carries equal to its stableId',
				twinNameList: ['stableUriPropertyNameMisnamed'],
				judge: succeeded((result) => {
					const offender = result.nodes.find((oneNode) => oneNode.properties[result.stableUriPropertyName] !== oneNode.stableId);
					return { pass: offender === undefined, detail: offender ? `'${offender.stableId}' lacks ${result.stableUriPropertyName}` : `${result.stableUriPropertyName} on all ${result.nodes.length} nodes` };
				}),
			}),
			forgeConjunct({
				conjunctId: 'modelVersionBesideEmbedding',
				title: 'embeddingModelVersion beside EVERY embedding (spy embedder, skipEmbedding false)',
				twinNameList: ['dropEmbeddingModelVersion'],
				judge: succeeded((result) => {
					const embedded = result.nodes.filter((oneNode) => oneNode.properties.embedding !== undefined);
					const offender = embedded.find((oneNode) => oneNode.embeddingModelVersion === undefined || oneNode.properties.embeddingModelVersion === undefined);
					return { pass: embedded.length > 0 && offender === undefined, detail: offender ? `'${offender.stableId}' has an embedding without embeddingModelVersion` : `${embedded.length} embedded nodes all carry embeddingModelVersion` };
				}),
			}),
			forgeConjunct({
				conjunctId: 'proxyReadsThreeOnly',
				title: 'a Proxy argument permitting reads of sourcePath, embedNodeLimit, skipEmbedding ONLY runs clean — owner is never read',
				twinNameList: ['frameworkReadsOwner'],
				judge: (outcome) => (outcome.forgeError === '' && outcome.result ? { pass: true, detail: 'no forbidden read' } : { pass: false, detail: outcome.forgeError || outcome.thrownFromForge || 'no result' }),
			}),
			forgeConjunct({
				conjunctId: 'fifthKeyRefused',
				title: 'a fifth key on the argument object is refused by name',
				twinNameList: ['disableUnknownArgCheck'],
				judge: nameInRefusal(/unknown argument 'resolutionMapPath'/),
			}),
			injectConjunct({
				conjunctId: 'absentEmbedderKeyRefused',
				title: 'an ABSENT embedder key at the factory is refused naming embedder',
				twinNameList: ['disableEmbedderKeyCheck'],
				judge: nameInRefusal(/'embedder' key is absent/),
			}),
			injectConjunct({
				conjunctId: 'driverDepRefused',
				title: 'a { embedder, driver } factory call is refused naming driver',
				twinNameList: ['allowDriverDep'],
				judge: nameInRefusal(/unknown dep 'driver'/),
			}),
		],
	},
];

// =====================================================================
// twins — DATA: gateId + conjunct + leverKind + the injected fault
// =====================================================================
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'forgeArity', twinName: 'forgeArityThree', fileName: 'forge-framework.js', find: 'const forge = (forgeArgs, callback) => {', replace: 'const forge = (forgeArgs, callback, extraArg) => {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'callsBackEmptyString', twinName: 'callBackNullFirst', fileName: 'forge-framework.js', find: "\t\t\t\t\tcallback('', {\n\t\t\t\t\t\tnodes,", replace: '\t\t\t\t\tcallback(null, {\n\t\t\t\t\t\tnodes,' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'nodesEdgesArrays', twinName: 'nodesAsObject', fileName: 'forge-framework.js', find: "\t\t\t\t\tcallback('', {\n\t\t\t\t\t\tnodes,\n\t\t\t\t\t\tedges,", replace: "\t\t\t\t\tcallback('', {\n\t\t\t\t\t\tnodes: { list: nodes },\n\t\t\t\t\t\tedges," });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'metadataFour', twinName: 'dropSnapshotKey', fileName: 'forge-framework.js', find: '\t\t\t\t\t\t\tsnapshotKey: stamp.snapshotKey,\n', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'embedCallCountNumeric', twinName: 'embedCallCountAsString', fileName: 'forge-framework.js', find: '\t\t\t\t\t\tembedCallCount: args.embedCallCount,', replace: '\t\t\t\t\t\tembedCallCount: String(args.embedCallCount),' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'standardKeyEqualsToken', twinName: 'standardKeyFromSource', fileName: 'forge-framework.js', find: '\t\t\t\t\t\tstandardKey,\n\t\t\t\t\t\tstableUriPropertyName,\n\t\t\t\t\t\tcomplianceReport,', replace: '\t\t\t\t\t\tstandardKey: standardSource,\n\t\t\t\t\t\tstableUriPropertyName,\n\t\t\t\t\t\tcomplianceReport,' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'stableUriPropertyCarried', twinName: 'stableUriPropertyNameMisnamed', fileName: 'forge-framework.js', find: '\t\t\t\t\t\tstableUriPropertyName,\n\t\t\t\t\t\tcomplianceReport,', replace: "\t\t\t\t\t\tstableUriPropertyName: stableUriPropertyName + 'X',\n\t\t\t\t\t\tcomplianceReport," });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'modelVersionBesideEmbedding', twinName: 'dropEmbeddingModelVersion', fileName: 'embedPass.js', find: '\t\t\t\t\t\toneNode.embeddingModelVersion = embedResult.embeddingModelVersion;\n', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'proxyReadsThreeOnly', twinName: 'frameworkReadsOwner', fileName: 'forge-framework.js', find: '\t\t\t\tconst skipEmbedding = forgeArgs.skipEmbedding;\n', replace: '\t\t\t\tconst skipEmbedding = forgeArgs.skipEmbedding;\n\t\t\t\tconst ownerRead = forgeArgs.owner;\n' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'fifthKeyRefused', twinName: 'disableUnknownArgCheck', fileName: 'forge-framework.js', find: '\t\t\t\tif (unknownArgName !== undefined) {', replace: '\t\t\t\tif (unknownArgName === undefined && false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'absentEmbedderKeyRefused', twinName: 'disableEmbedderKeyCheck', fileName: 'forge-framework.js', find: "\t\tif (!Object.prototype.hasOwnProperty.call(deps, 'embedder')) {", replace: "\t\tif (false && !Object.prototype.hasOwnProperty.call(deps, 'embedder')) {" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'driverDepRefused', twinName: 'allowDriverDep', fileName: 'forge-framework.js', find: "const DEP_NAME_LIST = Object.freeze(['embedder', 'xLog', 'migratingBundleListOverride']);", replace: "const DEP_NAME_LIST = Object.freeze(['embedder', 'xLog', 'migratingBundleListOverride', 'driver']);" });

// =====================================================================
// the SUBJECT: per-conjunct scenario shaping (the baseline is the same toy scenario; three conjuncts
// need a shaped argument object or deps — that shaping is the conjunct's INPUT, not its expectation)
// =====================================================================
const readOnlyProxyArgs = (plainArgs) =>
	new Proxy(plainArgs, {
		get: (target, propertyName) => {
			if (['sourcePath', 'embedNodeLimit', 'skipEmbedding'].indexOf(propertyName) === -1 && typeof propertyName === 'string') {
				throw new Error(`G-SEAM Proxy: the framework READ forbidden argument '${propertyName}'`);
			}
			return target[propertyName];
		},
	});

const makeSubject = () => {
	const scenario = toyScenario.makeScenario();
	// per-conjunct shaping is done INSIDE the conjunct evaluate via scenario fields the conjunct
	// reads; here we install the shaping table the conjuncts consult
	return scenario;
};

// conjunct-specific input shaping, applied through a wrapper around evaluate (baseline AND twin runs)
const shapeByConjunctId = {
	modelVersionBesideEmbedding: (scenario) => {
		scenario.deps = { ...scenario.deps, embedder: toyScenario.makeSpyEmbedder() };
		scenario.forgeArgs = { ...scenario.forgeArgs, skipEmbedding: false };
	},
	proxyReadsThreeOnly: (scenario) => {
		scenario.forgeArgs = readOnlyProxyArgs({ sourcePath: scenario.forgeArgs.sourcePath, owner: ':golden', embedNodeLimit: undefined, skipEmbedding: true });
	},
	fifthKeyRefused: (scenario) => {
		scenario.forgeArgs = { ...scenario.forgeArgs, resolutionMapPath: '/nowhere/refIdResolutionMap.tsv' };
	},
	absentEmbedderKeyRefused: (scenario) => {
		scenario.deps = {};
	},
	driverDepRefused: (scenario) => {
		scenario.deps = { embedder: null, driver: { session: () => ({}) } };
	},
};
gateDeclarationList[0].conjunctList.forEach((oneConjunct) => {
	const shape = shapeByConjunctId[oneConjunct.conjunctId];
	if (!shape) {
		return;
	}
	const innerEvaluate = oneConjunct.evaluate;
	oneConjunct.evaluate = (scenario, callback) => {
		shape(scenario);
		innerEvaluate(scenario, callback);
	};
});

runGateFamily(
	{
		harness,
		familyName: GATE_ID,
		gateDeclarationList,
		twinRegistry,
		makeSubject,
		cloneSubject: toyScenario.cloneScenario,
		expectedConjunctCount: 13,
		expectedTwinCount: 13,
	},
	() => harness.report(),
);
