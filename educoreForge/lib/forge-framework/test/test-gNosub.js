#!/usr/bin/env node
'use strict';

// test-gNosub.js — G-NOSUB (SPEC-forgeFramework-v1.md §10.1; §11.5, §11.8): lexical — the f-word (any
// form) absent from framework and hook source, comments included; the stub-logger idioms absent from
// hook files; no per-standard branch (`standardKey === '<one of the four>'`) in framework code;
// behavioural — xLog absent from process.global and deps → refusal names xLog (child process); warn
// absent → refused; sourcePath absent / not on disk → refused; a coercion allowance on a non-migrating
// bundle → refused. (Unknown role / unknown edge type and the null-name behaviour are proven in G-KIT
// and not repeated here.) The forbidden word is never spelled in this file — the pattern is built.
//
// Run: node lib/forge-framework/test/test-gNosub.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-NOSUB: no silent substitution — lexical and behavioural

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, refusalCase } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const provenanceStampFactory = require('../provenanceStamp');

const GATE_ID = 'G-NOSUB';
const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'forge-framework.js';
const NO_XLOG_RUNNER = path.join(__dirname, 'testSupport', 'runFrameworkWithoutXlog.js');
const THE_WORD_RE = new RegExp(['f', 'all', 'back'].join(''), 'i');
const THE_WORD_HYPHENATED_RE = new RegExp(['f', 'all', '-', 'back'].join(''), 'i');
const STUB_LOGGER_RE = /\|\|\s*\(\(\)\s*=>\s*\{\}\)|\|\|\s*\{\s*status\s*\(\)|\|\|\s*\{\s*status\s*:\s*\(\)\s*=>/;
const PER_STANDARD_BRANCH_RE = /standardKey\s*===\s*'(ceds|edfi|sif|pesc260805)'/;

const HARNESS_DIR = path.join(toyScenario.FRAMEWORK_DIR, 'roundTripHarness');
const frameworkSourceList = () =>
	fs.readdirSync(toyScenario.FRAMEWORK_DIR).filter((oneName) => /\.js$/.test(oneName)).map((oneName) => ({ fileName: `lib/forge-framework/${oneName}`, text: fs.readFileSync(path.join(toyScenario.FRAMEWORK_DIR, oneName), 'utf8') }))
		.concat(fs.readdirSync(HARNESS_DIR).filter((oneName) => /\.js$/.test(oneName)).map((oneName) => ({ fileName: `lib/forge-framework/roundTripHarness/${oneName}`, text: fs.readFileSync(path.join(HARNESS_DIR, oneName), 'utf8') })))
		.concat([{ fileName: 'lib/forge-framework/README.md', text: fs.existsSync(path.join(toyScenario.FRAMEWORK_DIR, 'README.md')) ? fs.readFileSync(path.join(toyScenario.FRAMEWORK_DIR, 'README.md'), 'utf8') : '' }]);
const { migratedForgeHookSourceList } = require('./testSupport/migratedForgeRoster');
// the toy fixture's hook/entry/validator files + every MIGRATED forge's H1/H2/H3 files (one roster, F3b);
// a migrated forge's LOADER modules are not hook files (FR14: C7/E5 live there, not discharged by
// migration — Ed-Fi's metaEdParser.js:100 stub logger is E5's own later commit)
const hookSourceList = () => ['forgeToy.js', 'roundTripValidator.js', 'lib/toyHooks.js', 'lib/toyRoundTripPair.js', 'lib/toyForgeDeclaration.js'].map((oneRelative) => ({ fileName: `toyForge/${oneRelative}`, text: fs.readFileSync(path.join(toyScenario.TOY_DIR, oneRelative), 'utf8') }))
	.concat(migratedForgeHookSourceList());
const testSourceList = () => fs.readdirSync(__dirname).filter((oneName) => /\.js$/.test(oneName)).map((oneName) => ({ fileName: `test/${oneName}`, text: fs.readFileSync(path.join(__dirname, oneName), 'utf8') }))
	.concat(fs.readdirSync(path.join(__dirname, 'testSupport')).map((oneName) => ({ fileName: `test/testSupport/${oneName}`, text: fs.readFileSync(path.join(__dirname, 'testSupport', oneName), 'utf8') })));

const lexicalConjunct = ({ conjunctId, title, twinName, sourceList, regex }) => ({
	conjunctId,
	title,
	twinNameList: [twinName],
	evaluate: (scenario, callback) => {
		const offenderList = sourceList().concat(scenario.staticExtraSourceList || []).filter((oneFile) => regex.test(oneFile.text)).map((oneFile) => oneFile.fileName);
		callback('', { pass: offenderList.length === 0, detail: offenderList.length ? `found in: ${offenderList.join(', ')}` : `${sourceList().length} files clean` });
	},
});

const conjunctList = [
	lexicalConjunct({ conjunctId: 'theWordAbsentFramework', title: 'lexical: the f-word (any form, comments included) is absent from the framework tree, the harness and the README', twinName: 'theWordInFrameworkComment', sourceList: frameworkSourceList, regex: THE_WORD_RE }),
	lexicalConjunct({ conjunctId: 'theWordAbsentHooks', title: 'lexical: the f-word (any form incl. hyphenated) is absent from the fixture hook/entry/validator source', twinName: 'theWordInHook', sourceList: hookSourceList, regex: new RegExp(`${THE_WORD_RE.source}|${THE_WORD_HYPHENATED_RE.source}`, 'i') }),
	lexicalConjunct({ conjunctId: 'theWordAbsentTests', title: 'lexical: the f-word is absent from the framework test suite too (TQ taste rule: all new writing)', twinName: 'theWordInTest', sourceList: testSourceList, regex: THE_WORD_RE }),
	lexicalConjunct({ conjunctId: 'stubLoggerAbsentHooks', title: 'lexical: the stub-logger idioms (|| (() => {}), || { status(), || { status: () =>) are absent from hook files', twinName: 'stubLoggerInHook', sourceList: hookSourceList, regex: STUB_LOGGER_RE }),
	lexicalConjunct({ conjunctId: 'noPerStandardBranch', title: "lexical: no per-standard branch (standardKey === '<one of the four>') in framework code — every difference is data, a hook or an allowance id", twinName: 'perStandardBranchInFramework', sourceList: frameworkSourceList, regex: PER_STANDARD_BRANCH_RE }),
	{
		conjunctId: 'xLogAbsentRefusedNamingXlog',
		title: 'behavioural: with NO process.global and NO xLog dep, constructing the framework is refused naming xLog (child process); no do-nothing logger is manufactured',
		twinNameList: ['manufactureDoNothingLogger'],
		evaluate: (scenario, callback) => {
			const mutationsArg = scenario.frameworkMutationList.length ? [`--mutationsJson=${JSON.stringify(scenario.frameworkMutationList)}`] : [];
			const run = spawnSync(process.execPath, [NO_XLOG_RUNNER].concat(mutationsArg), { encoding: 'utf8' });
			const lastLine = String(run.stdout || '').trim().split('\n').pop();
			callback('', { pass: /^REFUSED .*xLog is available neither as a dep nor as process.global.xLog/.test(lastLine), detail: `${lastLine.slice(0, 200)}${run.stderr ? ` stderr: ${String(run.stderr).slice(0, 200)}` : ''}` });
		},
	},
	{
		conjunctId: 'warnAbsentRefused',
		title: 'behavioural: the provenance-stamp adapter refuses an xLog without an error() channel (the warn channel is mandated, never a do-nothing default)',
		twinNameList: ['disableWarnChannelCheck'],
		evaluate: (scenario, callback) => {
			const stampFactory = scenario.frameworkMutationList.length ? require('./testSupport/moduleDouble').loadWithMutations({ modulePath: path.join(toyScenario.FRAMEWORK_DIR, 'provenanceStamp.js'), mutationList: scenario.frameworkMutationList }) : provenanceStampFactory;
			let refusalText = '';
			try {
				stampFactory({ xLog: { status: () => {} } });
			} catch (constructError) {
				refusalText = constructError.message;
			}
			callback('', { pass: /xLog with an error\(\) channel is required/.test(refusalText), detail: refusalText || 'CONSTRUCTED without an error channel' });
		},
	},
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'sourcePathAbsentRefused',
		title: 'behavioural: an absent sourcePath is refused by name (no newest-snapshot resolution)',
		shape: (scenario) => { const { sourcePath, ...rest } = scenario.forgeArgs; scenario.forgeArgs = rest; },
		regex: /forge: sourcePath is undefined/,
		twinName: 'disableSourcePathCheck', fileName: FRAMEWORK_FILE,
		find: "\t\t\t\t\tif (typeof sourcePath !== 'string' || sourcePath.length === 0) {\n\t\t\t\t\t\tnext(refuse.byName({ moduleName, what: `${forgePrefix} forge: sourcePath is", replace: "\t\t\t\t\tif (false && (typeof sourcePath !== 'string' || sourcePath.length === 0)) {\n\t\t\t\t\t\tnext(refuse.byName({ moduleName, what: `${forgePrefix} forge: sourcePath is",
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'sourcePathNotOnDiskRefused',
		title: 'behavioural: a sourcePath that is not on disk is refused by name',
		shape: (scenario) => { scenario.forgeArgs = { ...scenario.forgeArgs, sourcePath: '/nowhere/standardSourceData/01' }; },
		regex: /sourcePath '\/nowhere\/standardSourceData\/01' is not on disk/,
		twinName: 'disableOnDiskCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (!fs.existsSync(sourcePath)) {', replace: '\t\t\t\t\tif (!fs.existsSync(sourcePath) && false) {\n\t\t\t\t\t\t// (twin)\n\t\t\t\t\t}\n\t\t\t\t\tif (!fs.existsSync(sourcePath)) {\n\t\t\t\t\t\tnext(`${forgePrefix} loader: no such path`);\n\t\t\t\t\t\treturn;\n\t\t\t\t\t}\n\t\t\t\t\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'coercionAllowanceOnNewForgeRefused',
		title: 'behavioural: a coercion allowance (S2) on a non-migrating bundle is refused', mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S2', coerceEmptyStringPropertyList: ['name'] }]; },
		regex: /is non-empty but standardKey 'toy' is not in MIGRATING_BUNDLE_LIST/,
		twinName: 'putToyInsideTheFour', leverKind: 'inputFault', shippedConfig: false,
		mutate: (scenario) => { scenario.deps = { ...scenario.deps, migratingBundleListOverride: ['toy'] }; },
	}),
];

const extraSourceTwin = ({ conjunctId, twinName, fileName, text }) =>
	scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId, twinName, leverKind: 'productionMutation', mutate: (scenario) => { scenario.staticExtraSourceList = (scenario.staticExtraSourceList || []).concat([{ fileName, text }]); } });
extraSourceTwin({ conjunctId: 'theWordAbsentFramework', twinName: 'theWordInFrameworkComment', fileName: 'lib/forge-framework/extra.js (in-memory)', text: `// a ${['f', 'all', 'back'].join('')} to the default\n` });
extraSourceTwin({ conjunctId: 'theWordAbsentHooks', twinName: 'theWordInHook', fileName: 'toyForge/lib/extraHook.js (in-memory)', text: `const value = read() || ${['f', 'all', 'back'].join('')}Value;\n` });
extraSourceTwin({ conjunctId: 'theWordAbsentTests', twinName: 'theWordInTest', fileName: 'test/test-extra.js (in-memory)', text: `harness.note('${['f', 'all', 'back'].join('')} case');\n` });
extraSourceTwin({ conjunctId: 'stubLoggerAbsentHooks', twinName: 'stubLoggerInHook', fileName: 'toyForge/lib/extraHook.js (in-memory)', text: 'const log = xLog || { status() {} };\n' });
extraSourceTwin({ conjunctId: 'noPerStandardBranch', twinName: 'perStandardBranchInFramework', fileName: 'lib/forge-framework/extra.js (in-memory)', text: "if (standardKey === 'ceds') { skipFinalizer(); }\n" });
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'xLogAbsentRefusedNamingXlog', twinName: 'manufactureDoNothingLogger', leverKind: 'productionMutation', mutate: (scenario) => { scenario.frameworkMutationList.push({ modulePath: path.join(toyScenario.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\tconst xLog = deps.xLog !== undefined ? deps.xLog : process.global && process.global.xLog;', replace: '\t\tconst xLog = (deps.xLog !== undefined ? deps.xLog : process.global && process.global.xLog) || { status() {}, error() {} };' }); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'warnAbsentRefused', twinName: 'disableWarnChannelCheck', fileName: 'provenanceStamp.js', find: "\t\tif (!xLog || typeof xLog.error !== 'function') {", replace: "\t\tif (false && (!xLog || typeof xLog.error !== 'function')) {" });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'no silent substitution', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), staticExtraSourceList: (scenario.staticExtraSourceList || []).slice() }), expectedConjunctCount: 10, expectedTwinCount: 10 }, () => harness.report());
