#!/usr/bin/env node
'use strict';

// test-gNograph.js — G-NOGRAPH / G-REQUIRE (SPEC-forgeFramework-v1.md §10.1; §3.2; §11.1; §12.1): static —
// no require in the framework tree or any hook file of neo4j-driver, lib/replay/**, replayManager, sqlite,
// apps/**, lib/embedding/**, lib/vector-store/**, forges/**; no entry module or hook requires the harness;
// graphReader.js is the ONE allow-listed bolt file (required LAZILY); no .ini read in the framework tree
// except roster.js's descriptor read (a gate helper, §3.3); dynamic — forge() runs to completion with the
// driver require stubbed to throw; the factory refuses an undeclared dep (proven in G-SEAM/driverDepRefused).
//
// Run: node lib/forge-framework/test/test-gNograph.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-NOGRAPH / G-REQUIRE: no graph access, no forbidden require, the ONE bolt file

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const Module = require('module');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');

const GATE_ID = 'G-NOGRAPH';
const twinRegistry = makeTwinRegistry();
const HARNESS_DIR = path.join(toyScenario.FRAMEWORK_DIR, 'roundTripHarness');
const FORBIDDEN_REQUIRE_RE = /require\(\s*['"`][^'"`]*(neo4j-driver|lib\/replay|replayManager|replay-manager|sqlite|apps\/|lib\/embedding|lib\/vector-store|forges\/)[^'"`]*['"`]/;
const HARNESS_REQUIRE_RE = /require\([^)]*roundTripHarness/;
const INI_READ_RE = /readFileSync\([^)]*\.ini/;
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const forgeTimeSourceList = () => fs.readdirSync(toyScenario.FRAMEWORK_DIR).filter((oneName) => /\.js$/.test(oneName)).map((oneName) => ({ fileName: `lib/forge-framework/${oneName}`, text: stripComments(fs.readFileSync(path.join(toyScenario.FRAMEWORK_DIR, oneName), 'utf8')) }));
const harnessSourceList = () => fs.readdirSync(HARNESS_DIR).filter((oneName) => /\.js$/.test(oneName)).map((oneName) => ({ fileName: `lib/forge-framework/roundTripHarness/${oneName}`, text: stripComments(fs.readFileSync(path.join(HARNESS_DIR, oneName), 'utf8')) }));
const hookAndEntrySourceList = () => ['forgeToy.js', 'lib/toyHooks.js', 'lib/toyForgeDeclaration.js', 'lib/toyRoundTripPair.js'].map((oneRelative) => ({ fileName: `toyForge/${oneRelative}`, text: stripComments(fs.readFileSync(path.join(toyScenario.TOY_DIR, oneRelative), 'utf8')) }));

const staticConjunct = ({ conjunctId, title, twinName, sourceList, regex, allowFileName }) => ({
	conjunctId,
	title,
	twinNameList: [twinName],
	evaluate: (scenario, callback) => {
		const offenderList = sourceList().concat(scenario.staticExtraSourceList || []).filter((oneFile) => oneFile.fileName !== allowFileName && regex.test(oneFile.text)).map((oneFile) => oneFile.fileName);
		callback('', { pass: offenderList.length === 0, detail: offenderList.length ? `found in: ${offenderList.join(', ')}` : `${sourceList().length} files clean` });
	},
});

const conjunctList = [
	staticConjunct({ conjunctId: 'frameworkTreeNoForbiddenRequire', title: 'static: the forge-time framework tree requires none of neo4j-driver / lib/replay / replayManager / sqlite / apps / lib/embedding / lib/vector-store / forges', twinName: 'requireDriverInFramework', sourceList: forgeTimeSourceList, regex: FORBIDDEN_REQUIRE_RE }),
	staticConjunct({ conjunctId: 'harnessOnlyGraphReaderRequiresDriver', title: 'static: in the harness, ONLY graphReader.js requires neo4j-driver (the ONE allow-listed bolt file)', twinName: 'requireDriverInAssembler', sourceList: harnessSourceList, regex: /require\(\s*['"`]neo4j-driver['"`]\s*\)/, allowFileName: 'lib/forge-framework/roundTripHarness/graphReader.js' }),
	staticConjunct({ conjunctId: 'hooksNoForbiddenRequire', title: 'static: no hook / entry / declaration file requires a forbidden module', twinName: 'requireDriverInHook', sourceList: hookAndEntrySourceList, regex: FORBIDDEN_REQUIRE_RE }),
	staticConjunct({ conjunctId: 'hooksDoNotRequireHarness', title: 'static: no entry module or hook requires roundTripHarness (only the validator file may)', twinName: 'requireHarnessInHook', sourceList: hookAndEntrySourceList, regex: HARNESS_REQUIRE_RE }),
	staticConjunct({ conjunctId: 'noIniReadInFramework', title: "static: no fs.readFileSync of a .ini path in the framework tree, except roster.js's parserDescriptor.ini read (a gate helper, SPEC §3.3)", twinName: 'iniReadInFramework', sourceList: forgeTimeSourceList, regex: INI_READ_RE, allowFileName: 'lib/forge-framework/roster.js' }),
	{
		conjunctId: 'forgeRunsWithDriverStubbedToThrow',
		title: "dynamic: forge() runs to completion with require('neo4j-driver') stubbed to throw (the forge-time path never touches the driver)",
		twinNameList: ['frameworkRequiresDriverAtLoad'],
		evaluate: (scenario, callback) => {
			const originalLoad = Module._load;
			Module._load = function stubbedLoad(request, parent, isMain) {
				if (request === 'neo4j-driver') {
					throw new Error('neo4j-driver is STUBBED to throw for G-NOGRAPH');
				}
				return originalLoad.apply(this, arguments);
			};
			toyScenario.runScenario(scenario, (runError, outcome) => {
				Module._load = originalLoad;
				const pass = !outcome.injectionError && !outcome.thrownFromForge && outcome.forgeError === '' && outcome.result.nodes.length === 16;
				callback('', { pass, detail: pass ? 'forged 16 nodes with the driver stubbed' : outcome.injectionError || outcome.thrownFromForge || outcome.forgeError || 'no result' });
			});
		},
	},
];

const extraSourceTwin = ({ conjunctId, twinName, fileName, text }) => scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId, twinName, leverKind: 'productionMutation', mutate: (scenario) => { scenario.staticExtraSourceList = (scenario.staticExtraSourceList || []).concat([{ fileName, text }]); } });
extraSourceTwin({ conjunctId: 'frameworkTreeNoForbiddenRequire', twinName: 'requireDriverInFramework', fileName: 'lib/forge-framework/extra.js (in-memory)', text: "const neo4j = require('neo4j-driver');\n" });
extraSourceTwin({ conjunctId: 'harnessOnlyGraphReaderRequiresDriver', twinName: 'requireDriverInAssembler', fileName: 'lib/forge-framework/roundTripHarness/verdictAssembler.js (in-memory double)', text: "const neo4j = require('neo4j-driver');\n" });
extraSourceTwin({ conjunctId: 'hooksNoForbiddenRequire', twinName: 'requireDriverInHook', fileName: 'toyForge/lib/toyHooks.js (in-memory double)', text: "const neo4j = require('neo4j-driver');\n" });
extraSourceTwin({ conjunctId: 'hooksDoNotRequireHarness', twinName: 'requireHarnessInHook', fileName: 'toyForge/lib/toyHooks.js (in-memory double)', text: "const harness = require('../../lib/forge-framework/roundTripHarness/roundTripHarness');\n" });
extraSourceTwin({ conjunctId: 'noIniReadInFramework', twinName: 'iniReadInFramework', fileName: 'lib/forge-framework/extra.js (in-memory)', text: "const iniText = fs.readFileSync('/etc/graphBuilder.ini', 'utf8');\n" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'forgeRunsWithDriverStubbedToThrow', twinName: 'frameworkRequiresDriverAtLoad', fileName: 'forge-framework.js', find: "const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();", replace: "const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();\nconst neo4jDriverForTwin = require('neo4j-driver');" });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'no graph access, no forbidden require', conjunctList }];
runGateFamily({ harness, familyName: 'G-NOGRAPH / G-REQUIRE', gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), staticExtraSourceList: (scenario.staticExtraSourceList || []).slice() }), expectedConjunctCount: 6, expectedTwinCount: 6 }, () => harness.report());
