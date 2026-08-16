#!/usr/bin/env node
'use strict';

// test-gShare.js — G-SHARE (SPEC-forgeFramework-v1.md §10.1; §3.4; FR20): static — no function named
// makeNode/addEdge/embedNodes in a hook file; no finalizeStructuralContract( / deriveVersionStamp( /
// embedTexts( / buildSearchText( / EMBED_BATCH_SIZE outside the framework; no hook requires a sibling
// forge's lib/ or qtools-asynchronous-pipe-plus (a hook is pure or a single loader); per migrated forge
// the frozen share ratio ≤ 0.5 and the measured ≤ frozen — per MIGRATED forge the entry module is
// re-measured LIVE (F3b froze edfi 33/280 = 0.1179; sif/pesc260805/ceds null = UNMEASURED BY DESIGN);
// every framework export has ≥1 caller across the MIGRATED forges' bundles (testSupport/
// migratedForgeRoster.js) OR a written justification (acceptance/callerJustifications.json, each citing
// the SPEC §3.3 surface row) — re-pointed in F3b from the F3a substitute corpus (FA6); a stale
// justification for a member that HAS a caller is refused, so the list shrinks as forges migrate.
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
const CALLER_JUSTIFICATION_FILE = path.join(__dirname, 'acceptance', 'callerJustifications.json');
const TREE_ROOT = path.resolve(toyScenario.FRAMEWORK_DIR, '..', '..');
const { migratedForgeHookSourceList, migratedForgeCallerCorpusPathList, MIGRATED_FORGE_ROSTER } = require('./testSupport/migratedForgeRoster');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// the hook files: the toy fixture's + every MIGRATED forge's H1/H2/H3 files (one roster, shared with G-NOSUB)
const hookSourceList = () => ['lib/toyHooks.js', 'lib/toyRoundTripPair.js', 'forgeToy.js'].map((oneRelative) => ({ fileName: `toyForge/${oneRelative}`, text: stripComments(fs.readFileSync(path.join(toyScenario.TOY_DIR, oneRelative), 'utf8')) }))
	.concat(migratedForgeHookSourceList().map((oneFile) => ({ fileName: oneFile.fileName, text: stripComments(oneFile.text) })));
// wc -l semantics: the number of newline characters
const lineCountOf = (text) => text.split('\n').length - 1;

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
// the caller corpus (FR20/FA6, re-pointed in F3b): the MIGRATED forges' bundles — entry, lib, tests
const callerCorpusText = () => migratedForgeCallerCorpusPathList().map((onePath) => fs.readFileSync(onePath, 'utf8')).join('\n');

const conjunctList = [
	staticConjunct({ conjunctId: 'noMakeNodeAddEdgeEmbedNodesInHooks', title: 'static: no function named makeNode / addEdge / embedNodes is DEFINED in a hook file', twinName: 'embedNodesCopiedIntoHook', regex: /(const|function)\s+(makeNode|addEdge|embedNodes)\s*[=(]/ }),
	staticConjunct({ conjunctId: 'noFrameworkOwnedCallsInHooks', title: 'static: no finalizeStructuralContract( / deriveVersionStamp( / embedTexts( / buildSearchText( / EMBED_BATCH_SIZE in a hook file', twinName: 'finalizerCalledInHook', regex: /finalizeStructuralContract\(|deriveVersionStamp\(|embedTexts\(|buildSearchText\(|EMBED_BATCH_SIZE/ }),
	staticConjunct({ conjunctId: 'noSiblingLibOrPipeRequireInHooks', title: "static: no hook requires a sibling forge's lib/ or qtools-asynchronous-pipe-plus", twinName: 'hookRequiresPipePlus', regex: /require\([^)]*(forges\/[a-z0-9]+\/lib|qtools-asynchronous-pipe-plus)/ }),
	{
		conjunctId: 'shareRatiosWithinCeiling',
		title: 'per migrated forge: frozen ratio ≤ 0.5 and the entry module re-measured LIVE ≤ frozen (edfi frozen 33/280 in F3b); unmigrated entries null (UNMEASURED BY DESIGN — F3c/F3d freeze them), the rule is applied to whatever entries exist',
		twinNameList: ['frozenRatioZeroForMeasuredForge'],
		evaluate: (scenario, callback) => {
			const ratioData = scenario.ratioDataOverride || JSON.parse(fs.readFileSync(RATIO_FILE, 'utf8'));
			const nameList = Object.keys(ratioData.byStandardKey);
			const nullList = nameList.filter((oneName) => ratioData.byStandardKey[oneName] === null);
			const measuredRatioFor = (oneEntry) => {
				if (oneEntry.entryModuleRelativePath === undefined) {
					return oneEntry.measuredRatio; // a test double's literal
				}
				const entryModulePath = path.join(TREE_ROOT, oneEntry.entryModuleRelativePath);
				return lineCountOf(fs.readFileSync(entryModulePath, 'utf8')) / oneEntry.originalEntryModuleLineCount;
			};
			const detailList = [];
			const offenderList = nameList.filter((oneName) => {
				const oneEntry = ratioData.byStandardKey[oneName];
				if (oneEntry === null) {
					return false;
				}
				const measuredRatio = measuredRatioFor(oneEntry);
				detailList.push(`${oneName} measured ${measuredRatio.toFixed(4)} ≤ frozen ${oneEntry.frozenRatio} ≤ ${ratioData.ratioCeiling}`);
				return !(typeof oneEntry.frozenRatio === 'number' && typeof measuredRatio === 'number' && oneEntry.frozenRatio <= ratioData.ratioCeiling && measuredRatio <= oneEntry.frozenRatio);
			});
			callback('', { pass: offenderList.length === 0 && ratioData.ratioCeiling === 0.5, detail: `${nameList.length - nullList.length} frozen (${detailList.join('; ')}), ${nullList.length} UNMEASURED BY DESIGN (${nullList.join(', ')} — frozen by F3c/F3d)${offenderList.length ? `; VIOLATIONS: ${offenderList.join(', ')}` : ''}` });
		},
	},
	{
		conjunctId: 'everyExportHasACaller',
		title: `every framework surface export has ≥1 caller across the MIGRATED forges' bundles (${MIGRATED_FORGE_ROSTER.map((oneForge) => oneForge.standardKey).join(', ')}: entry, lib, tests) OR a written justification in acceptance/callerJustifications.json; a justification for a member that HAS a caller is STALE and refused (re-pointed in F3b from the F3a substitute corpus, FA6)`,
		twinNameList: ['surfaceGainsUncalledExport'],
		evaluate: (scenario, callback) => {
			const corpusText = callerCorpusText();
			const justificationByMember = scenario.callerJustificationOverride || JSON.parse(fs.readFileSync(CALLER_JUSTIFICATION_FILE, 'utf8')).justificationByMember;
			const memberList = surfaceMemberList().concat(scenario.extraSurfaceMemberList || []);
			const hasCaller = (oneMember) => new RegExp(`\\b${oneMember.split('.').pop()}\\b`).test(corpusText);
			const calledList = memberList.filter(hasCaller);
			const justifiedList = memberList.filter((oneMember) => !hasCaller(oneMember) && typeof justificationByMember[oneMember] === 'string' && justificationByMember[oneMember].length > 0);
			const uncalledUnjustifiedList = memberList.filter((oneMember) => !hasCaller(oneMember) && justifiedList.indexOf(oneMember) === -1);
			const staleJustificationList = Object.keys(justificationByMember).filter((oneMember) => memberList.indexOf(oneMember) === -1 || hasCaller(oneMember));
			callback('', {
				pass: uncalledUnjustifiedList.length === 0 && staleJustificationList.length === 0,
				detail: `${memberList.length} surface members: ${calledList.length} called in the migrated bundles, ${justifiedList.length} justified in writing${uncalledUnjustifiedList.length ? `; NO CALLER AND NO JUSTIFICATION: ${uncalledUnjustifiedList.join(', ')}` : ''}${staleJustificationList.length ? `; STALE justification (member has a caller or does not exist): ${staleJustificationList.join(', ')}` : ''}`,
			});
		},
	},
];

const extraSourceTwin = ({ conjunctId, twinName, text }) => scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId, twinName, leverKind: 'productionMutation', mutate: (scenario) => { scenario.staticExtraSourceList = (scenario.staticExtraSourceList || []).concat([{ fileName: 'toyForge/lib/toyHooks.js (in-memory double)', text }]); } });
extraSourceTwin({ conjunctId: 'noMakeNodeAddEdgeEmbedNodesInHooks', twinName: 'embedNodesCopiedIntoHook', text: 'const embedNodes = ({ nodes }, callback) => { callback(\'\', { embedCallCount: 0 }); };\n' });
extraSourceTwin({ conjunctId: 'noFrameworkOwnedCallsInHooks', twinName: 'finalizerCalledInHook', text: 'finalizeStructuralContract({ nodes, edges });\n' });
extraSourceTwin({ conjunctId: 'noSiblingLibOrPipeRequireInHooks', twinName: 'hookRequiresPipePlus', text: "const { pipeRunner } = new (require('qtools-asynchronous-pipe-plus'))();\n" });
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'shareRatiosWithinCeiling', twinName: 'frozenRatioZeroForMeasuredForge', leverKind: 'productionMutation', mutate: (scenario) => { scenario.ratioDataOverride = { ratioCeiling: 0.5, byStandardKey: { edfi: { frozenRatio: 0.0, measuredRatio: 0.31 }, sif: null, pesc260805: null, ceds: null } }; } });
// F3b: the corpus IS the one FR20 names (the migrated forges' bundles) — the twin COUNTS: a surface
// member no migrated bundle calls and no justification names → red
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'everyExportHasACaller', twinName: 'surfaceGainsUncalledExport', leverKind: 'inputFault', mutate: (scenario) => { scenario.extraSurfaceMemberList = ['census.' + ['orphaned', 'Export', 'Nobody', 'Calls'].join('')]; } }); // the name is built at run time so this file is not its own caller

const gateDeclarationList = [{ gateId: GATE_ID, title: 'shared code is not a lie', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), staticExtraSourceList: (scenario.staticExtraSourceList || []).slice(), ratioDataOverride: scenario.ratioDataOverride, extraSurfaceMemberList: scenario.extraSurfaceMemberList, callerJustificationOverride: scenario.callerJustificationOverride }), expectedConjunctCount: 5, expectedTwinCount: 5, expectedUnprovenConjunctList: [] }, () => harness.report());
