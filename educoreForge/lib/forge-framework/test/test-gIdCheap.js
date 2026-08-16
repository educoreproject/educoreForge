#!/usr/bin/env node
'use strict';

// test-gIdCheap.js — G-ID-CHEAP (PROXY) and the SURFACE CONTRACTS (SPEC-forgeFramework-v1.md §9.3, §10.1,
// §10.2 G-ID-CHEAP; §3.3-3.4): fingerprint.pureLayerFingerprint over the toy's pure output EQUALS the
// frozen 64-hex (acceptance/expectedFingerprints.json), every report line says PROXY; a SEPARATE
// expectationLever entry DEMONSTRATES that the proxy and G-ID disagree on a duplicate stableId (the
// proxy hashes both copies; MERGE collapses them) — recorded, not counted; and the declared surface
// contracts are the truth a hook author and a test read: CONTRACT_GRAPH_KIT_SURFACE names exactly the
// kit's members, STANDARD_HOOK_CONTRACT exactly the four hooks, the vocabulary re-exports are the SAME
// objects as lib/vocabulary's, refuse.requiredKeys/closedValue behave as declared.
//
// Run: node lib/forge-framework/test/test-gIdCheap.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-ID-CHEAP (PROXY) + surface contracts

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, forgeConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const fingerprintLib = require('../fingerprint');
const vocabularyLib = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));
const expectedFingerprints = require('./acceptance/expectedFingerprints.json');

const PROXY_GATE_ID = 'G-ID-CHEAP';
const SURFACE_GATE_ID = 'G-SURFACE';
const twinRegistry = makeTwinRegistry();
const FROZEN_TOY_FINGERPRINT = expectedFingerprints.byStandardKey.toy;

const loadFingerprintLib = (scenario) => (scenario.frameworkMutationList.length ? require('./testSupport/moduleDouble').loadWithMutations({ modulePath: path.join(toyScenario.FRAMEWORK_DIR, 'fingerprint.js'), mutationList: scenario.frameworkMutationList }) : fingerprintLib);

const proxyConjunctList = [
	forgeConjunct({
		conjunctId: 'fingerprintEqualsFrozen',
		title: `PROXY: pureLayerFingerprint over the toy EQUALS the frozen ${FROZEN_TOY_FINGERPRINT.slice(0, 12)}… (report line says PROXY)`,
		twinNameList: ['rootLiteralParserVersionChanged'],
		judge: succeeded((result, outcome) => {
			const fingerprint = loadFingerprintLib({ frameworkMutationList: [] }).pureLayerFingerprint({ nodes: result.nodes, edges: result.edges });
			process.global.xLog.status(`  ${fingerprintLib.PROXY_LABEL}: toy pure-layer fingerprint ${fingerprint}`);
			return { pass: fingerprint === FROZEN_TOY_FINGERPRINT, detail: `${fingerprintLib.PROXY_LABEL} ${fingerprint} vs frozen ${FROZEN_TOY_FINGERPRINT}` };
		}),
	}),
	{
		conjunctId: 'proxyHashesDuplicateStableIdTwice',
		title: 'PROXY limit made visible: a duplicated stableId CHANGES the fingerprint (MERGE would collapse it — the proxy and G-ID DISAGREE there)',
		twinNameList: ['dedupeInsideProxy', 'demoProxyDisagreesWithGId'],
		evaluate: (scenario, callback) => {
			toyScenario.runScenario(scenario, (runError, outcome) => {
				if (outcome.forgeError || outcome.injectionError || outcome.thrownFromForge) {
					callback('', { pass: false, detail: outcome.forgeError || outcome.injectionError || outcome.thrownFromForge });
					return;
				}
				const fingerprintOf = loadFingerprintLib(scenario).pureLayerFingerprint;
				const baseline = fingerprintOf({ nodes: outcome.result.nodes, edges: outcome.result.edges });
				const duplicated = fingerprintOf({ nodes: outcome.result.nodes.concat([outcome.result.nodes[3]]), edges: outcome.result.edges });
				callback('', { pass: baseline !== duplicated, detail: baseline !== duplicated ? 'the proxy sees the duplicate (G-ID would not — MERGE collapses last-writer-wins)' : 'the proxy collapsed the duplicate — it no longer disagrees with G-ID' });
			});
		},
	},
	{
		conjunctId: 'proxyLabelIsProxy',
		title: "fingerprint.PROXY_LABEL EQUALS 'PROXY' — every report line carries it",
		twinNameList: ['relabelProxy'],
		evaluate: (scenario, callback) => { const label = loadFingerprintLib(scenario).PROXY_LABEL; callback('', { pass: label === 'PROXY', detail: `label ${JSON.stringify(label)}` }); },
	},
];
scenarioTwin({ registry: twinRegistry, gateId: PROXY_GATE_ID, conjunctId: 'fingerprintEqualsFrozen', twinName: 'rootLiteralParserVersionChanged', leverKind: 'inputFault', mutate: (scenario) => { scenario.forgeDeclaration.parserVersion = '1a'; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: PROXY_GATE_ID, conjunctId: 'proxyHashesDuplicateStableIdTwice', twinName: 'dedupeInsideProxy', fileName: 'fingerprint.js', find: '\tconst nodeLineList = nodes\n\t\t.slice()', replace: '\tconst seenStableIds = new Set();\n\tconst nodeLineList = nodes\n\t\t.filter((oneNode) => (seenStableIds.has(oneNode.stableId) ? false : (seenStableIds.add(oneNode.stableId), true)))' });
// the DEMONSTRATION entry (SPEC §10.2, FR20): an expectationLever twin — recorded, never counted toward observed-red
twinRegistry.register({ gateId: PROXY_GATE_ID, conjunctId: 'proxyHashesDuplicateStableIdTwice', twinName: 'demoProxyDisagreesWithGId', leverKind: 'expectationLever', shippedConfig: true, run: (scenario) => { scenario.demoNote = 'G-ID (block id) would be UNCHANGED by a duplicate stableId (MERGE collapses); the PROXY changes — the two disagree by design'; return scenario; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: PROXY_GATE_ID, conjunctId: 'proxyLabelIsProxy', twinName: 'relabelProxy', fileName: 'fingerprint.js', find: "PROXY_LABEL: 'PROXY'", replace: "PROXY_LABEL: 'BLOCK-ID'" });

const surfaceConjunctList = [
	{
		conjunctId: 'kitSurfaceEqualsKitMembers',
		title: "CONTRACT_GRAPH_KIT_SURFACE names EXACTLY the kit's members (captured from a walk)",
		twinNameList: ['kitGainsUndeclaredMember'],
		evaluate: (scenario, callback) => {
			let seenKit;
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => { seenKit = context.kit; return baseHooks.emitContractGraph(context); };
			toyScenario.runScenario(scenario, (runError, outcome) => {
				if (!seenKit) { callback('', { pass: false, detail: 'the walk never ran' }); return; }
				const declaredList = Object.keys(outcome.forgeFramework.contracts.CONTRACT_GRAPH_KIT_SURFACE).sort().join(',');
				const actualList = Object.keys(seenKit).sort().join(',');
				callback('', { pass: declaredList === actualList, detail: declaredList === actualList ? `${Object.keys(seenKit).length} members` : `declared [${declaredList}] vs actual [${actualList}]` });
			});
		},
	},
	{
		conjunctId: 'hookContractNamesFourHooks',
		title: 'STANDARD_HOOK_CONTRACT names exactly sourceLoaderList, describeSource, emitContractGraph, describeRoot',
		twinNameList: ['hookContractGainsFifth'],
		evaluate: (scenario, callback) => { const outcome = toyScenario.injectOnly(scenario); const nameList = Object.keys(outcome.forgeFramework.contracts.STANDARD_HOOK_CONTRACT).join(','); callback('', { pass: nameList === 'sourceLoaderList,describeSource,emitContractGraph,describeRoot', detail: nameList }); },
	},
	{
		conjunctId: 'vocabularyReExportsAreTheSameObjects',
		title: "vocabulary.{DME_ROLES, EDGE_TYPES, NODE_LABELS, PROVENANCE_TIER, STRUCTURAL_PROPERTIES} are the SAME objects lib/vocabulary exports (identity, not copies)",
		twinNameList: ['reExportACopy'],
		evaluate: (scenario, callback) => { const outcome = toyScenario.injectOnly(scenario); const offender = ['DME_ROLES', 'EDGE_TYPES', 'NODE_LABELS', 'PROVENANCE_TIER', 'STRUCTURAL_PROPERTIES'].find((oneName) => outcome.forgeFramework.vocabulary[oneName] !== vocabularyLib[oneName]); callback('', { pass: offender === undefined, detail: offender ? `${offender} is a copy` : 'five identities hold' }); },
	},
	{
		conjunctId: 'refuseHelpersBehave',
		title: 'refuse.requiredKeys refuses the FIRST missing key by name; refuse.closedValue names value and allowed list; both return null on clean input',
		twinNameList: ['requiredKeysNeverRefuses'],
		evaluate: (scenario, callback) => {
			const outcome = toyScenario.injectOnly(scenario);
			const { requiredKeys, closedValue } = outcome.forgeFramework.refuse;
			const missing = requiredKeys({ moduleName: 'probe', objectName: 'thing', object: { alpha: 1 }, requiredKeyList: ['alpha', 'beta', 'gamma'] });
			const clean = requiredKeys({ moduleName: 'probe', objectName: 'thing', object: { alpha: 1, beta: 2 }, requiredKeyList: ['alpha', 'beta'] });
			const closed = closedValue({ moduleName: 'probe', name: 'mode', value: 'newest', allowedValueList: ['declared', 'sourceUrl'] });
			const closedClean = closedValue({ moduleName: 'probe', name: 'mode', value: 'declared', allowedValueList: ['declared', 'sourceUrl'] });
			const pass = missing !== null && /missing required property 'beta'/.test(missing.message) && clean === null && closed !== null && /mode 'newest' is not one of: declared, sourceUrl/.test(closed.message) && closedClean === null;
			callback('', { pass, detail: pass ? 'requiredKeys/closedValue behave as declared' : `missing=${missing && missing.message} clean=${clean} closed=${closed && closed.message} closedClean=${closedClean}` });
		},
	},
];
frameworkMutationTwin({ registry: twinRegistry, gateId: SURFACE_GATE_ID, conjunctId: 'kitSurfaceEqualsKitMembers', twinName: 'kitGainsUndeclaredMember', fileName: 'contractGraphKit.js', find: '\t\temitOptionValue,\n\t};', replace: '\t\temitOptionValue,\n\t\tundeclaredHelper: () => {},\n\t};' });
frameworkMutationTwin({ registry: twinRegistry, gateId: SURFACE_GATE_ID, conjunctId: 'hookContractNamesFourHooks', twinName: 'hookContractGainsFifth', fileName: 'standardHookContract.js', find: "\tdescribeRoot: Object.freeze({\n\t\trequired: true,", replace: "\tsummarizeForgeStatus: Object.freeze({ required: false, kind: 'function', arity: 1, calledFrom: 'x', signature: 'x', returns: 'x' }),\n\tdescribeRoot: Object.freeze({\n\t\trequired: true," });
frameworkMutationTwin({ registry: twinRegistry, gateId: SURFACE_GATE_ID, conjunctId: 'vocabularyReExportsAreTheSameObjects', twinName: 'reExportACopy', fileName: 'forge-framework.js', find: '\t\t\tvocabulary: Object.freeze({\n\t\t\t\tDME_ROLES,', replace: '\t\t\tvocabulary: Object.freeze({\n\t\t\t\tDME_ROLES: { ...DME_ROLES },' });
frameworkMutationTwin({ registry: twinRegistry, gateId: SURFACE_GATE_ID, conjunctId: 'refuseHelpersBehave', twinName: 'requiredKeysNeverRefuses', fileName: 'refuse.js', find: '\tif (firstMissingName === undefined) {\n\t\treturn null;\n\t}', replace: '\tif (firstMissingName === undefined || true) {\n\t\treturn null;\n\t}' });

const gateDeclarationList = [
	{ gateId: PROXY_GATE_ID, title: 'the PROXY', conjunctList: proxyConjunctList },
	{ gateId: SURFACE_GATE_ID, title: 'the declared surface contracts', conjunctList: surfaceConjunctList },
];
runGateFamily({ harness, familyName: 'G-ID-CHEAP (PROXY) + G-SURFACE', gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 7, expectedTwinCount: 8 }, () => harness.report());
