#!/usr/bin/env node
'use strict';

// test-gShare.js — G-SHARE (SPEC-forgeFramework-v1.md §10.1; §3.4; FR20): static — no function named
// makeNode/addEdge/embedNodes in a hook file; no finalizeStructuralContract( / deriveVersionStamp( /
// embedTexts( / buildSearchText( / EMBED_BATCH_SIZE outside the framework; no hook requires a sibling
// forge's lib/ or qtools-asynchronous-pipe-plus (a hook is pure or a single loader); per migrated forge
// the frozen share ratio ≤ 0.5 and the measured ≤ frozen — F3a freezes NONE (every entry null, said by
// name); every framework export has ≥1 caller — in F3a the callers are the toy fixture and the
// framework's own suite (F3b re-points this at the four forges' tests, and its report line says so).
//
// Run: node lib/forge-framework/test/test-gShare.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-SHARE: shared code is not a lie — no re-implementation in hooks, ratios, callers

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { scenarioTwin } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');

const GATE_ID = 'G-SHARE';
const twinRegistry = makeTwinRegistry();
const RATIO_FILE = path.join(__dirname, 'acceptance', 'expectedShareRatios.json');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const hookSourceList = () => ['lib/toyHooks.js', 'lib/toyRoundTripPair.js', 'forgeToy.js'].map((oneRelative) => ({ fileName: `toyForge/${oneRelative}`, text: stripComments(fs.readFileSync(path.join(toyScenario.TOY_DIR, oneRelative), 'utf8')) }));

const staticConjunct = ({ conjunctId, title, twinName, regex }) => ({
	conjunctId,
	title,
	twinNameList: [twinName],
	evaluate: (scenario, callback) => {
		const offenderList = hookSourceList().concat(scenario.staticExtraSourceList || []).filter((oneFile) => regex.test(oneFile.text)).map((oneFile) => oneFile.fileName);
		callback('', { pass: offenderList.length === 0, detail: offenderList.length ? `found in: ${offenderList.join(', ')}` : `${hookSourceList().length} hook files clean` });
	},
});

// the framework's surface members, read from the REAL object (data, not a hand list)
const surfaceMemberList = () => {
	const forgeFramework = require(toyScenario.FRAMEWORK_MODULE_PATH)({ embedder: null });
	const memberList = ['injectStandardHooks'];
	['contracts', 'constants', 'vocabulary', 'provenance', 'embed', 'structural', 'sequence', 'searchText', 'refuse', 'census', 'roster', 'fingerprint'].forEach((oneGroupName) => {
		Object.keys(forgeFramework[oneGroupName]).forEach((oneMemberName) => memberList.push(`${oneGroupName}.${oneMemberName}`));
	});
	return memberList;
};
const callerCorpusText = () => {
	const fileList = [];
	const walk = (dirPath) => fs.readdirSync(dirPath, { withFileTypes: true }).forEach((oneEntry) => {
		const fullPath = path.join(dirPath, oneEntry.name);
		if (oneEntry.isDirectory()) { walk(fullPath); return; }
		if (/\.js$/.test(oneEntry.name)) { fileList.push(fullPath); }
	});
	walk(path.join(toyScenario.FRAMEWORK_DIR, 'test'));
	walk(path.join(toyScenario.FRAMEWORK_DIR, 'roundTripHarness'));
	return fileList.map((onePath) => fs.readFileSync(onePath, 'utf8')).join('\n');
};

const conjunctList = [
	staticConjunct({ conjunctId: 'noMakeNodeAddEdgeEmbedNodesInHooks', title: 'static: no function named makeNode / addEdge / embedNodes is DEFINED in a hook file', twinName: 'embedNodesCopiedIntoHook', regex: /(const|function)\s+(makeNode|addEdge|embedNodes)\s*[=(]/ }),
	staticConjunct({ conjunctId: 'noFrameworkOwnedCallsInHooks', title: 'static: no finalizeStructuralContract( / deriveVersionStamp( / embedTexts( / buildSearchText( / EMBED_BATCH_SIZE in a hook file', twinName: 'finalizerCalledInHook', regex: /finalizeStructuralContract\(|deriveVersionStamp\(|embedTexts\(|buildSearchText\(|EMBED_BATCH_SIZE/ }),
	staticConjunct({ conjunctId: 'noSiblingLibOrPipeRequireInHooks', title: "static: no hook requires a sibling forge's lib/ or qtools-asynchronous-pipe-plus", twinName: 'hookRequiresPipePlus', regex: /require\([^)]*(forges\/[a-z0-9]+\/lib|qtools-asynchronous-pipe-plus)/ }),
	{
		conjunctId: 'shareRatiosWithinCeiling',
		title: 'per migrated forge: frozen ratio ≤ 0.5 and measured ≤ frozen — F3a: every entry null (UNMEASURED BY DESIGN — F3b freezes edfi), the rule is applied to whatever entries exist',
		twinNameList: ['frozenRatioZeroForMeasuredForge'],
		evaluate: (scenario, callback) => {
			const ratioData = scenario.ratioDataOverride || JSON.parse(fs.readFileSync(RATIO_FILE, 'utf8'));
			const nameList = Object.keys(ratioData.byStandardKey);
			const nullList = nameList.filter((oneName) => ratioData.byStandardKey[oneName] === null);
			const offenderList = nameList.filter((oneName) => {
				const oneEntry = ratioData.byStandardKey[oneName];
				return oneEntry !== null && !(typeof oneEntry.frozenRatio === 'number' && typeof oneEntry.measuredRatio === 'number' && oneEntry.frozenRatio <= ratioData.ratioCeiling && oneEntry.measuredRatio <= oneEntry.frozenRatio);
			});
			callback('', { pass: offenderList.length === 0 && ratioData.ratioCeiling === 0.5, detail: `${nameList.length - nullList.length} frozen, ${nullList.length} UNMEASURED BY DESIGN (${nullList.join(', ')} — frozen by F3b/F3c/F3d)${offenderList.length ? `; VIOLATIONS: ${offenderList.join(', ')}` : ''}` });
		},
	},
	{
		conjunctId: 'everyExportHasACaller',
		title: "every framework surface export has ≥1 caller in the F3a corpus (the toy fixture + the framework's own suite + harness) — F3b re-points this at the four migrated forges' tests",
		twinNameList: ['surfaceGainsUncalledExport'],
		evaluate: (scenario, callback) => {
			const corpusText = callerCorpusText();
			const memberList = surfaceMemberList().concat(scenario.extraSurfaceMemberList || []);
			const uncalledList = memberList.filter((oneMember) => {
				const leafName = oneMember.split('.').pop();
				return !new RegExp(`\\b${leafName}\\b`).test(corpusText);
			});
			callback('', { pass: uncalledList.length === 0, detail: uncalledList.length ? `no caller for: ${uncalledList.join(', ')}` : `${memberList.length} surface members each have ≥1 caller in the F3a corpus` });
		},
	},
];

const extraSourceTwin = ({ conjunctId, twinName, text }) => scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId, twinName, leverKind: 'productionMutation', mutate: (scenario) => { scenario.staticExtraSourceList = (scenario.staticExtraSourceList || []).concat([{ fileName: 'toyForge/lib/toyHooks.js (in-memory double)', text }]); } });
extraSourceTwin({ conjunctId: 'noMakeNodeAddEdgeEmbedNodesInHooks', twinName: 'embedNodesCopiedIntoHook', text: 'const embedNodes = ({ nodes }, callback) => { callback(\'\', { embedCallCount: 0 }); };\n' });
extraSourceTwin({ conjunctId: 'noFrameworkOwnedCallsInHooks', twinName: 'finalizerCalledInHook', text: 'finalizeStructuralContract({ nodes, edges });\n' });
extraSourceTwin({ conjunctId: 'noSiblingLibOrPipeRequireInHooks', twinName: 'hookRequiresPipePlus', text: "const { pipeRunner } = new (require('qtools-asynchronous-pipe-plus'))();\n" });
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'shareRatiosWithinCeiling', twinName: 'frozenRatioZeroForMeasuredForge', leverKind: 'productionMutation', mutate: (scenario) => { scenario.ratioDataOverride = { ratioCeiling: 0.5, byStandardKey: { edfi: { frozenRatio: 0.0, measuredRatio: 0.31 }, sif: null, pesc260805: null, ceds: null } }; } });
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'everyExportHasACaller', twinName: 'surfaceGainsUncalledExport', leverKind: 'productionMutation', mutate: (scenario) => { scenario.extraSurfaceMemberList = ['census.' + ['orphaned', 'Export', 'Nobody', 'Calls'].join('')]; } }); // the name is built at run time so this file is not its own caller

const gateDeclarationList = [{ gateId: GATE_ID, title: 'shared code is not a lie', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), staticExtraSourceList: (scenario.staticExtraSourceList || []).slice(), ratioDataOverride: scenario.ratioDataOverride, extraSurfaceMemberList: scenario.extraSurfaceMemberList }), expectedConjunctCount: 5, expectedTwinCount: 5 }, () => harness.report());
