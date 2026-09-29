#!/usr/bin/env node
'use strict';

// test-bgPromptScan.js — BG-PROMPTSCAN: the in-run blinding scan that refuses (PLAN-sifReplacement-smallPhases §3 B1;
// SPEC-sifStructuralBridge-replacement §9 A19), plus the oracle conjuncts B1 owes (§1.6 R1, §1.7). Every run is the
// toy derived plugin over the graph double under the DEBUG judge (or a fake real client, for the re-ask): no container,
// no network, no spend.
//
//   BG-PROMPTSCAN   (a) P000505 injected into a subject description refuses the run, naming the subject and the pattern;
//                   (b) an id from the toy list file planted in a subject value refuses, naming the list; (c) the scanned,
//                   unplanted toy run passes — and the same run with a list id planted in the TOOL DESCRIPTION (which the
//                   debug judge never renders) is refused; (c') that refusal names the toolText surface; (d) with no scan
//                   declared, the toy derived block equals the branch-cut text with frameworkFingerprint masked; (m)
//                   unmasked, the two differ in exactly that one header key; (e) the one rationale re-ask prompt is
//                   scanned too (EBONY_DREAM), with (e0) its unplanted companion passing through the re-ask.
//   BG-PROMPTSCAN-DECL  the declaration and the list file are data entering the framework: a vacuous scan, a scan on a
//                   documentary predicate source, a pattern that does not compile, a pattern matching the empty string,
//                   a list file absent or malformed — each refused by name.
//   BG-PROMPTSCAN-ORACLE  (§1.7) the shipped Ed-Fi and PESC derived plugins register with the key absent; (R1) run E's
//                   frozen block parses unchanged and its block id is the frozen literal.
//
// Run: node lib/bridge-framework/test/test-bgPromptScan.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-PROMPTSCAN + BG-PROMPTSCAN-DECL + BG-PROMPTSCAN-ORACLE

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, nameInRefusal, refusalCase, frameworkMutationTwin, scenarioTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const decisionBlockLib = require('../decisionBlock');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const CROSSWALK_PLUGIN_NAME = 'toyCrosswalkPlugin';
const FRAMEWORK_FILE = 'bridge-framework.js';
const SCAN_FILE = 'promptIdentifierScan.js';
const JUDGE_COMPONENT_FILE = 'judgeComponent.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const SCHEMA_FILE = path.join('..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'selectCandidateSchema.js');
const TOY_EMBED_MODEL = 'toy-embed-v1';
const PLANTED_SUBJECT_STABLE_ID = 'toy:property/Student.FirstName';
const TOY_IDENTIFIER_LIST_PATH = 'bridgeData/toyPromptScanIdentifierList.json';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const cloneJson = scenarioLib.cloneJson;

// the frozen literals this phase is measured against
const BRANCH_CUT_BLOCK_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B1branchCut-6589694.frozenText.json');
const RUN_E_BLOCK_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfiEval', 'runE_091726', 'block.json');
const RUN_E_BLOCK_ID = '7e362cebe7bb74d572e643eed37944d2577eb850313028bc0b9eb11f245c8755';
const FRAMEWORK_FINGERPRINT_TEXT_RE = /"frameworkFingerprint":"[0-9a-f]{64}"/g;

// the plugins §1.7 says must stay byte-unchanged AND keep registering while the new key is absent
const SHIPPED_DERIVED_PLUGIN_LIST = [
	{ bridgeName: 'edfiCedsDerivedPlugin', bundleDirName: 'edfi', pluginPath: 'forges/edfi/bridges/edfiCedsDerivedPlugin.js' },
	{ bridgeName: 'edfiCedsCrosswalkPlugin', bundleDirName: 'edfi', pluginPath: 'forges/edfi/bridges/edfiCedsCrosswalkPlugin.js' },
	{ bridgeName: 'pescCedsDerivedPlugin', bundleDirName: 'pesc260805', pluginPath: 'forges/pesc260805/bridges/pescCedsDerivedPlugin.js' },
	{ bridgeName: 'pescOptionSetCedsDerivedPlugin', bundleDirName: 'pesc260805', pluginPath: 'forges/pesc260805/bridges/pescOptionSetCedsDerivedPlugin.js' },
];

// ---------------------------------------------------------------------
// scenario shaping
// ---------------------------------------------------------------------
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
const pluginPathFor = (pluginName) => path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${pluginName}.js`);
const overrideDeclaration = (scenario, pluginName, mutate) => {
	const current = scenario.pluginModuleOverrides[pluginName] && scenario.pluginModuleOverrides[pluginName].bridgeDeclaration ? scenario.pluginModuleOverrides[pluginName].bridgeDeclaration : require(pluginPathFor(pluginName)).bridgeDeclaration;
	const bridgeDeclaration = cloneJson(current);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides[pluginName] = { ...(scenario.pluginModuleOverrides[pluginName] || {}), bridgeDeclaration };
};
const TOY_SCAN_DECLARATION = Object.freeze({
	identifierPatternList: [
		{ patternName: 'cedsPropertyId', regexSource: 'P\\d{6}' },
		{ patternName: 'cedsClassId', regexSource: 'C\\d{6}' },
	],
	identifierListPath: TOY_IDENTIFIER_LIST_PATH,
});
const scannedShape = (scenario, scanDeclaration = TOY_SCAN_DECLARATION) => {
	derivedShape(scenario);
	overrideDeclaration(scenario, DERIVED_PLUGIN_NAME, (declaration) => {
		declaration.promptIdentifierScan = cloneJson(scanDeclaration);
	});
};
const plantInSubject = (scenario, propertyName, plantedText) => {
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) => (oneNode.stableId === PLANTED_SUBJECT_STABLE_ID ? { ...oneNode, properties: { ...oneNode.properties, [propertyName]: `${oneNode.properties[propertyName]} ${plantedText}` } } : oneNode));
};
const TOOL_DESCRIPTION_FIND = "'THEN record the single best matching CEDS candidate by its number, or NONE if no candidate is a ' +";
const plantInToolDescription = (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, SCHEMA_FILE), find: TOOL_DESCRIPTION_FIND, replace: "'THEN record the single best matching CEDS candidate (see 007777) by its number, or NONE if no candidate is a ' +" });
};
const captureLog = (scenario) => {
	scenario.reportLineList = [];
	scenario.deps.xLog = { status: (text) => { scenario.reportLineList.push(text); }, error: (text) => { scenario.reportLineList.push(`ERR ${text}`); } };
};
// a fake REAL client (no debug mark, so the ordinal-rationale re-ask fires) whose FIRST rationale is ordinal-only;
// plantedText, when given, rides inside that first rationale — which the re-ask prompt quotes back to the judge
const useReaskingClient = (scenario, plantedText) => {
	const client = scenarioLib.makeFakeRealClient({ pickOrdinal: '1', rationaleMode: 'ordinalThenKeyAndName' });
	const baseRerank = client.rerank;
	client.rerank = (rerankOptions, callback) => {
		baseRerank(rerankOptions, (rerankError, clientReturn) => {
			const isReask = /RESTATE YOUR RATIONALE/.test(rerankOptions.userPrompt);
			callback(rerankError, plantedText === undefined || isReask || rerankError ? clientReturn : { ...clientReturn, rationale: `${clientReturn.rationale} (${plantedText})` });
		});
	};
	scenario.judgeClientOverride = client;
};

// ---------------------------------------------------------------------
// the masked comparison (§1.7, round-2 N2)
// ---------------------------------------------------------------------
const branchCutText = fs.readFileSync(BRANCH_CUT_BLOCK_PATH, 'utf8');
const maskedTextOf = (frozenText) => {
	const fingerprintMatchList = frozenText.match(FRAMEWORK_FINGERPRINT_TEXT_RE) || [];
	return fingerprintMatchList.length === 1 ? { maskedText: frozenText.replace(FRAMEWORK_FINGERPRINT_TEXT_RE, '"frameworkFingerprint":"MASKED"') } : { error: `frameworkFingerprint occurs ${fingerprintMatchList.length} times in the frozen text (must be exactly once)` };
};
const frozenTextOf = (outcome) => {
	const block = blockOf(outcome);
	if (block === null) {
		return null;
	}
	const row = outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash);
	return row.frozenText;
};
const differingHeaderNameList = (leftBlock, rightBlock) => {
	const nameList = Array.from(new Set(Object.keys(leftBlock.header).concat(Object.keys(rightBlock.header)))).sort();
	return nameList.filter((oneName) => JSON.stringify(leftBlock.header[oneName]) !== JSON.stringify(rightBlock.header[oneName]));
};
// the abstention flip: forces every abstained record's field, so the masked comparison has something real to see
const ABSTAINED_FIND = 'confidence: null, abstained: true, judge: judgeRecord';
const ABSTAINED_REPLACE = 'confidence: null, abstained: false, judge: judgeRecord';

// ---------------------------------------------------------------------
// BG-PROMPTSCAN
// ---------------------------------------------------------------------
const promptScanConjunctList = [
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN',
		conjunctId: 'a_injectedPropertyIdRefused',
		title: 'P000505 injected into one subject description refuses the run, naming the subject and the pattern',
		shape: (scenario) => { scannedShape(scenario); plantInSubject(scenario, 'description', 'See P000505.'); },
		regex: /prompt identifier scan hit for subject toy:property\/Student\.FirstName: pattern 'cedsPropertyId' matched 'P000505' in the userPrompt/,
		twinName: 'questionScanRefusalIgnored',
		fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\t\tif (questionScanRefusal) {',
		replace: '\t\t\t\t\t\t\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN',
		conjunctId: 'b_listedIdentifierInSubjectValueRefused',
		title: 'an id from the toy list file planted in a subject value refuses the run, naming the subject and the list',
		shape: (scenario) => { scannedShape(scenario); plantInSubject(scenario, 'name', '004242'); },
		regex: /prompt identifier scan hit for subject toy:property\/Student\.FirstName: pattern 'identifierList' matched '004242' in the userPrompt/,
		twinName: 'listPatternNeverCompiled',
		fileName: SCAN_FILE,
		find: 'compiledPatternList.push({ patternName: IDENTIFIER_LIST_PATTERN_NAME',
		replace: '[].push({ patternName: IDENTIFIER_LIST_PATTERN_NAME',
	}),
	runConjunct({
		conjunctId: 'c_unplantedScannedToyRunPasses',
		title: 'the scanned toy run with nothing planted PASSES — the scan is live (announced, every subject judged) and finds nothing',
		twinNameList: ['listIdPlantedInToolDescription'],
		shape: (scenario) => { scannedShape(scenario); captureLog(scenario); },
		judge: succeeded((runReport, outcome, scenario) => {
			const announced = scenario.reportLineList.some((oneLine) => /prompt identifier scan: cedsPropertyId, cedsClassId, identifierList \(2 listed identifier\(s\)\)/.test(oneLine));
			const block = blockOf(outcome);
			const judgedCount = block === null ? 0 : block.header.cardinalityCensus.perSubject.judgedSubjectCount;
			return { pass: announced && judgedCount > 0, detail: `scan announced ${announced}; ${judgedCount} subject(s) judged under the scan` };
		}),
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN',
		conjunctId: 'cPrime_toolTextPlantRefusedUnderDebugJudge',
		title: "a list id planted in the tool DESCRIPTION is refused under the debug judge (which never renders the schema), naming the toolText",
		shape: (scenario) => { scannedShape(scenario); plantInToolDescription(scenario); },
		regex: /prompt identifier scan hit for subject toy:[^:]+: pattern 'identifierList' matched '007777' in the toolText/,
		twinName: 'toolTextNotScanned',
		fileName: SCAN_FILE,
		find: '\ttoolText: TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule]({ choiceEnum: question.choiceEnum }),\n',
		replace: '',
	}),
	runConjunct({
		conjunctId: 'd_undeclaredToyBlockMaskedIdentical',
		title: 'with no scan declared, the toy derived block equals the branch-cut text with frameworkFingerprint masked',
		twinNameList: ['abstainedForcedFalse'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const frozenText = frozenTextOf(outcome);
			if (frozenText === null) {
				return { pass: false, detail: 'no block was frozen' };
			}
			const now = maskedTextOf(frozenText);
			const then = maskedTextOf(branchCutText);
			if (now.error || then.error) {
				return { pass: false, detail: now.error || then.error };
			}
			return { pass: now.maskedText === then.maskedText, detail: `masked texts ${now.maskedText === then.maskedText ? 'EQUAL' : 'DIFFER'} (${now.maskedText.length} vs ${then.maskedText.length} bytes)` };
		}),
	}),
	runConjunct({
		conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint',
		title: 'unmasked, the toy derived block and the branch-cut text differ in exactly one header key, frameworkFingerprint',
		twinNameList: ['abstainedForcedFalseUnmasked'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const frozenText = frozenTextOf(outcome);
			if (frozenText === null) {
				return { pass: false, detail: 'no block was frozen' };
			}
			const nowBlock = JSON.parse(frozenText);
			const thenBlock = JSON.parse(branchCutText);
			const headerDiffList = differingHeaderNameList(nowBlock, thenBlock);
			const bodyEqual = JSON.stringify(nowBlock.decisionRecordList) === JSON.stringify(thenBlock.decisionRecordList) && JSON.stringify(nowBlock.refusalList) === JSON.stringify(thenBlock.refusalList);
			return { pass: headerDiffList.length === 1 && headerDiffList[0] === 'frameworkFingerprint' && bodyEqual, detail: `differing header keys [${headerDiffList.join(', ')}]; records and refusals ${bodyEqual ? 'equal' : 'DIFFER'}` };
		}),
	}),
	runConjunct({
		conjunctId: 'e0_unplantedReaskPasses',
		title: 'the scanned toy run under a fake real client that is re-asked once for its rationale PASSES when nothing is planted',
		twinNameList: ['listIdPlantedInFirstRationale'],
		// the twin sets reaskPlantedText BEFORE this shape runs, so the shape reads it rather than building a clean client over it
		shape: (scenario) => { scannedShape(scenario); useReaskingClient(scenario, scenario.reaskPlantedText); },
		judge: succeeded((runReport) => ({ pass: runReport.counts.judgeSpend.rationaleReaskCount > 0, detail: `${runReport.counts.judgeSpend.rationaleReaskCount} re-ask(s), all scanned and clean` })),
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN',
		conjunctId: 'e_reaskPromptScanned',
		title: 'a list id carried into the rationale RE-ASK prompt (quoted from the first answer) refuses before the re-ask is sent',
		shape: (scenario) => { scannedShape(scenario); useReaskingClient(scenario, 'cf. 004242'); },
		regex: /prompt identifier scan hit for subject toy:[^:]+: pattern 'identifierList' matched '004242' in the reaskUserPrompt/,
		twinName: 'reaskPromptNotScanned',
		fileName: JUDGE_COMPONENT_FILE,
		find: "const reaskRefusal = reaskCount > 0 ? reaskPromptRefusalFor(userPrompt) : '';",
		replace: "const reaskRefusal = '';",
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PROMPTSCAN', conjunctId: 'c_unplantedScannedToyRunPasses', twinName: 'listIdPlantedInToolDescription', leverKind: 'productionMutation', mutate: plantInToolDescription });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PROMPTSCAN', conjunctId: 'd_undeclaredToyBlockMaskedIdentical', twinName: 'abstainedForcedFalse', fileName: FRAMEWORK_FILE, find: ABSTAINED_FIND, replace: ABSTAINED_REPLACE });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PROMPTSCAN', conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint', twinName: 'abstainedForcedFalseUnmasked', fileName: FRAMEWORK_FILE, find: ABSTAINED_FIND, replace: ABSTAINED_REPLACE });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PROMPTSCAN', conjunctId: 'e0_unplantedReaskPasses', twinName: 'listIdPlantedInFirstRationale', leverKind: 'inputFault', mutate: (scenario) => { scenario.reaskPlantedText = 'cf. 004242'; } });

// ---------------------------------------------------------------------
// BG-PROMPTSCAN-DECL — the declaration and the list file, refused by name at the edge where they enter
// ---------------------------------------------------------------------
const withScanDeclaration = (scanDeclaration) => (scenario) => scannedShape(scenario, scanDeclaration);
const withScratchList = (listText) => (scenario) => {
	const scratchForgesDir = scenarioLib.makeScratchForgesCopy();
	fs.writeFileSync(path.join(scratchForgesDir, 'toy', TOY_IDENTIFIER_LIST_PATH), listText);
	scenario.forgesDirOverride = scratchForgesDir;
	scannedShape(scenario);
};
const declConjunctList = [
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN-DECL',
		conjunctId: 'a_vacuousScanRefused',
		title: 'a scan declaring no pattern and no list is refused at registration — it could never fire',
		shape: withScanDeclaration({ identifierPatternList: [], identifierListPath: null }),
		regex: /bridgeDeclaration 'promptIdentifierScan' declares no pattern and no identifier list/,
		twinName: 'vacuousScanAccepted',
		fileName: SCAN_FILE,
		find: 'if (value.identifierPatternList.length === 0 && value.identifierListPath === null) {',
		replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN-DECL',
		conjunctId: 'b_documentaryPredicateSourceRefused',
		title: 'a scan on a documentary predicate source (no predicateRule, so no tool text to name) is refused at registration',
		shape: (scenario) => overrideDeclaration(scenario, CROSSWALK_PLUGIN_NAME, (declaration) => { declaration.promptIdentifierScan = cloneJson(TOY_SCAN_DECLARATION); }),
		regex: /bridgeDeclaration 'promptIdentifierScan' needs the run's declared predicateSource\.predicateRule to name a tool text it can scan, and undefined is not one of: categoryTable-v1/,
		twinName: 'documentaryRuleAccepted',
		fileName: SCAN_FILE,
		find: '\tif (TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule] === undefined) {',
		replace: '\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN-DECL',
		conjunctId: 'c_uncompilablePatternRefused',
		title: 'a declared pattern that does not compile is refused at registration, naming the pattern',
		shape: withScanDeclaration({ identifierPatternList: [{ patternName: 'broken', regexSource: 'P(\\d{6}' }], identifierListPath: null }),
		regex: /identifierPatternList\[0\] \('broken'\) regexSource "P\(\\\\d\{6\}" does not compile/,
		twinName: 'compileFaultIgnored',
		fileName: SCAN_FILE,
		find: '\tif (compiled.error) {\n\t\treturn `identifierPatternList',
		replace: '\tif (false) {\n\t\treturn `identifierPatternList',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN-DECL',
		conjunctId: 'd_emptyStringPatternRefused',
		title: 'a declared pattern that matches the empty string (it would refuse every prompt) is refused at registration',
		shape: withScanDeclaration({ identifierPatternList: [{ patternName: 'everything', regexSource: 'P?' }], identifierListPath: null }),
		regex: /identifierPatternList\[0\] \('everything'\) regexSource "P\?" matches the empty string/,
		twinName: 'emptyStringPatternAccepted',
		fileName: SCAN_FILE,
		find: "\tif (compiled.regex.test('')) {",
		replace: '\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN-DECL',
		conjunctId: 'e_absentListFileRefused',
		title: 'a declared list path naming no file refuses the run by name',
		shape: withScanDeclaration({ identifierPatternList: [], identifierListPath: 'bridgeData/noSuchList.json' }),
		regex: /promptIdentifierScan\.identifierListPath names no file at .*noSuchList\.json/,
		twinName: 'absentListFileRead',
		fileName: SCAN_FILE,
		find: '\tif (!fs.existsSync(filePath)) {\n\t\treturn { error: refuse.byName({ moduleName, what: `promptIdentifierScan.identifierListPath',
		replace: '\tif (false) {\n\t\treturn { error: refuse.byName({ moduleName, what: `promptIdentifierScan.identifierListPath',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN-DECL',
		conjunctId: 'f_emptyListFileRefused',
		title: 'a list file holding an empty array refuses the run by name (a list that names nothing is not a list)',
		shape: withScratchList('[]\n'),
		regex: /the identifier list at .*toyPromptScanIdentifierList\.json is not a non-empty JSON array of non-empty strings/,
		twinName: 'emptyListAccepted',
		fileName: SCAN_FILE,
		find: 'parsed.value.length === 0 || ',
		replace: '',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PROMPTSCAN-DECL',
		conjunctId: 'g_duplicatedListEntryRefused',
		title: 'a list file naming one id twice refuses the run by name',
		shape: withScratchList('["004242", "004242"]\n'),
		regex: /the identifier list at .*toyPromptScanIdentifierList\.json names '004242' twice/,
		twinName: 'duplicateListEntryAccepted',
		fileName: SCAN_FILE,
		find: '\tif (duplicateIdentifier !== undefined) {\n\t\treturn { error:',
		replace: '\tif (false) {\n\t\treturn { error:',
	}),
];

// ---------------------------------------------------------------------
// BG-PROMPTSCAN-ORACLE — §1.7 (new key absent disturbs no shipped plugin) and R1 (run E's block, hermetic)
// ---------------------------------------------------------------------
const contractFor = (scenario) => (scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), mutationList: scenario.frameworkMutationList }) : require('../bridgePluginContract'));
let runEBlockText = null;
const runEBlockTextFor = (scenario) => {
	if (runEBlockText === null) {
		runEBlockText = fs.readFileSync(RUN_E_BLOCK_PATH, 'utf8');
	}
	return scenario.runEBlockTextTransform === undefined ? runEBlockText : scenario.runEBlockTextTransform(runEBlockText);
};
const oracleConjunctList = [
	pureConjunct({
		conjunctId: 'a_shippedPluginsRegisterWithKeyAbsent',
		title: '§1.7: the shipped Ed-Fi and PESC plugins declare no promptIdentifierScan and every one still registers',
		twinNameList: ['scanKeyMadeRequired'],
		judge: (scenario) => {
			const contractLib = contractFor(scenario);
			const resultList = SHIPPED_DERIVED_PLUGIN_LIST.map((onePlugin) => {
				const bridgeDeclaration = require(path.join(TREE_ROOT, onePlugin.pluginPath)).bridgeDeclaration;
				const validated = contractLib.validateBridgeDeclaration({ bridgeDeclaration, bundleDirPath: path.join(TREE_ROOT, 'forges', onePlugin.bundleDirName) });
				return { bridgeName: onePlugin.bridgeName, declares: bridgeDeclaration.promptIdentifierScan !== undefined, refusal: validated.error ? validated.error.message : '' };
			});
			const faultList = resultList.filter((oneResult) => oneResult.declares || oneResult.refusal);
			return { pass: faultList.length === 0, detail: faultList.length ? faultList.map((oneResult) => `${oneResult.bridgeName}: ${oneResult.declares ? 'DECLARES the key' : oneResult.refusal.slice(0, 200)}`).join(' | ') : `${resultList.length} shipped plugins register with the key absent` };
		},
	}),
	pureConjunct({
		conjunctId: 'b_runEBlockParsesAndKeepsItsId',
		title: 'R1: run E\'s frozen block parses unchanged and blockIdFor equals the frozen literal',
		twinNameList: ['runEBlockOneByteChanged'],
		judge: (scenario) => {
			const frozenText = runEBlockTextFor(scenario);
			const parsed = decisionBlockLib.parseFrozenText(frozenText);
			const blockId = decisionBlockLib.blockIdFor({ frozenText });
			return { pass: !parsed.error && blockId === RUN_E_BLOCK_ID, detail: `${parsed.error ? `parse REFUSED: ${parsed.error.message.slice(0, 160)}` : 'parses'}; blockIdFor ${blockId}` };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PROMPTSCAN-ORACLE', conjunctId: 'a_shippedPluginsRegisterWithKeyAbsent', twinName: 'scanKeyMadeRequired', fileName: CONTRACT_FILE, find: "promptIdentifierScan: Object.freeze({ optional: true, kind: 'promptIdentifierScan' }),", replace: "promptIdentifierScan: Object.freeze({ kind: 'promptIdentifierScan' })," });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PROMPTSCAN-ORACLE', conjunctId: 'b_runEBlockParsesAndKeepsItsId', twinName: 'runEBlockOneByteChanged', leverKind: 'inputFault', mutate: (scenario) => { scenario.runEBlockTextTransform = (frozenText) => frozenText.replace('"frameworkGeneration":"', '"frameworkGeneration":"x'); } });

const gateDeclarationList = [
	{ gateId: 'BG-PROMPTSCAN', title: 'the in-run blinding scan refuses on a CEDS identifier in anything the judge is shown', conjunctList: promptScanConjunctList },
	{ gateId: 'BG-PROMPTSCAN-DECL', title: 'the scan declaration and its list file are refused by name when broken', conjunctList: declConjunctList },
	{ gateId: 'BG-PROMPTSCAN-ORACLE', title: 'the new key disturbs no shipped plugin, and run E still replays hermetically', conjunctList: oracleConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-PROMPTSCAN+BG-PROMPTSCAN-DECL+BG-PROMPTSCAN-ORACLE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 8 + 7 + 2 },
	() => harness.report(),
);
