#!/usr/bin/env node
'use strict';

// test-edfiCrosswalkExcluded.js — the CEDS-authored Ed-Fi crosswalk is OUT of the graph (BRIEF-F, goldJev
// campaign, 2026-10-02). TQ, 2026-09-10: "it will not be included in the graph and will not be used as a basis
// for evaluating our performance"; restated 2026-10-01: "When we create a new graph including the new PESC
// standards, I want that crosswalk excluded. It is known to be garbage." The bridge was retired in September
// but the FORGE kept reading the two CSVs and stamping their CEDS ids onto 3,045 Ed-Fi nodes (495 properties
// and 130 descriptors with a CEDSGlobalId crossRef, 2,420 option values with a CEDSOptionCode; measured on
// goldJev/A 937734f by forging snapshot 04). This suite holds the line at every layer that could read it.
//
// Forges the REAL Ed-Fi bundle over snapshot 04 with skipEmbedding true (no Docker, no Voyage, no network;
// reads the licence-gated MetaEd bytes, so it is ONE-MACHINE-ONLY like test-edfiEmbedTextOracle.js):
//   CARRIED    no forged node carries a non-empty crossRefs, and no node property name speaks of CEDS
//   DECLARED   the declaration makes no mapping claim (no CEDS anchor, no implied target, no crosswalk
//              sentinel) and the root's sourceFiles do not name the crosswalk
//   UNREAD     snapshot 04's SHA256SUMS lists no path under the retired folder, the old folder name is gone,
//              and the retired folder keeps its own SHA256SUMS whose bytes still verify (provenance kept)
//   DERIVED    the Ed-Fi derived (Jev) plugin is byte-identical to goldJev/A and still declares no channel
// TWINS, compiled in memory (nothing written into the tree), each observed RED:
//   plantedCrosswalkCrossRef  the walk stamps ONE crosswalk-sourced crossRef on one property node → the
//                             forge's own scan REFUSES BY NAME
//   plantedWithScanDisabled   the same plant with the scan cut out → CARRIED red (the judge bites on its own)
//
// Run: node forges/edfi/test/test-edfiCrosswalkExcluded.js [-verbose]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the CEDS-authored Ed-Fi crosswalk is excluded from the forge and the graph, with red twins

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every twin was observed RED;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);
const { xLog } = process.global;
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const FRAMEWORK_DIR_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework');
const moduleDouble = require(path.join(FRAMEWORK_DIR_PATH, 'test', 'testSupport', 'moduleDouble'));
const forgeFrameworkLib = require(path.join(FRAMEWORK_DIR_PATH, 'forge-framework'));
const edfiForgeDeclaration = require('../lib/edfiForgeDeclaration');

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const SNAPSHOT_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '04');
const HOOKS_FILE_PATH = path.join(BUNDLE_DIR_PATH, 'lib', 'edfiHooks.js');
const WALK_FILE_PATH = path.join(BUNDLE_DIR_PATH, 'lib', 'forgeEdfiContractGraph.js');
const DERIVED_PLUGIN_FILE_PATH = path.join(BUNDLE_DIR_PATH, 'bridges', 'edfiCedsDerivedPlugin.js');

const RETIRED_FOLDER_NAME = 'cedsAuthoredCrosswalk_DO_NOT_USE';
const FORMER_FOLDER_NAME = 'cedsAuthoredCrosswalk';
const RETIRED_CSV_FILE_NAME_LIST = Object.freeze(['EdFiEntityDescriptorsToCEDS.csv', 'EdFiEntityElementsToCEDS.csv']);
// sha256 of forges/edfi/bridges/edfiCedsDerivedPlugin.js (`shasum -a 256`). Pinned at goldJev/A 937734f (2026-10-02,
// dd4cd021…); RE-ANCHORED 2026-10-06 by campaign P3 (W-B-5, CARDINAL_HORIZON): the plugin gained exactly the two opt-ins
// its gold siblings declare (promptIdentifierScan with the hub id list, blockRecordsJudgeConfig) and nothing else — still
// no channel (the second DERIVED check). The bytes stay pinned rather than trusted.
const DERIVED_PLUGIN_SHA256_AT_GOLDJEV_A = '272dd5ac50b63aaf1710f17cb09b4616638845b6b91406192fffa45be04dd7f7';

// a node property naming CEDS, or a cross-reference of any kind, can only have come from a crosswalk:
// Ed-Fi's own MetaEd publishes no CEDS anchor (the walk's scan uses the same rule)
const CROSSWALK_CARRIED_PROPERTY_NAME_RE = /ceds/i;

// the plant: one crosswalk-sourced crossRef, in the exact D22 shape the retired PASS 5 stashed
const PLANT_FIND = '		// PASS 5 — THE CEDS-AUTHORED CROSSWALK IS EXCLUDED';
const PLANT_REPLACE =
	"		nodes.find((oneNode) => oneNode.role === DME_ROLES.PROPERTY).properties.crossRefs = kit.crossRefsJson([{ system: 'ceds', id: '000255', raw: '255', locator: 'CEDSGlobalId' }]);\n" +
	PLANT_FIND;
const SCAN_FIND = 'if (crosswalkPropertyName !== undefined) {';
const SCAN_REPLACE = 'if (crosswalkPropertyName !== undefined && false) {';
const SCAN_REFUSAL_RE = /forge-edfi[\s\S]*node '[^']+' carries property 'crossRefs'[\s\S]*crosswalk is excluded/;

const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

// forgeWith — the real framework, declaration and hooks; under a twin the hooks' emitContractGraph (a pure
// pass-through to the walk) is pointed at the WALK compiled in memory with the mutations. Only the walk goes
// through the double: compiling edfiHooks.js would recompile metaEdParser.js, whose `new require(...)` the
// double's require cannot be constructed by.
const forgeWith = ({ mutationList }, callback) => {
	const realHooks = require(HOOKS_FILE_PATH)();
	const mutatedWalk = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: WALK_FILE_PATH, mutationList })() : null;
	const hooks = mutatedWalk === null
		? realHooks
		: { ...realHooks, emitContractGraph: ({ parsed, kit }) => mutatedWalk.emitContractGraph({ metaEdModel: parsed.metaEdModel, descriptorCodeValues: parsed.descriptorCodeValues, kit }) };
	const bundle = forgeFrameworkLib({ embedder: null }).injectStandardHooks({ forgeDeclaration: edfiForgeDeclaration, hooks });
	bundle.forge({ sourcePath: SNAPSHOT_PATH, owner: moduleName, skipEmbedding: true }, callback);
};

// -----------------------------------------------------------------
// the judges: each returns a list of { label, pass, detail }
// -----------------------------------------------------------------
const judgeCarried = ({ forgeResult }) => {
	const crossRefNodeList = forgeResult.nodes.filter((oneNode) => oneNode.properties.crossRefs !== undefined && oneNode.properties.crossRefs !== '[]');
	const cedsNamedNodeList = forgeResult.nodes.filter((oneNode) => Object.keys(oneNode.properties).some((onePropertyName) => CROSSWALK_CARRIED_PROPERTY_NAME_RE.test(onePropertyName)));
	return [
		{ label: 'CARRIED: no forged node carries a non-empty crossRefs', pass: crossRefNodeList.length === 0, detail: `${crossRefNodeList.length} node(s), first ${crossRefNodeList[0] ? crossRefNodeList[0].stableId : 'none'}` },
		{ label: 'CARRIED: no forged node carries a property whose name speaks of CEDS', pass: cedsNamedNodeList.length === 0, detail: `${cedsNamedNodeList.length} node(s), first ${cedsNamedNodeList[0] ? cedsNamedNodeList[0].stableId : 'none'}` },
		{ label: 'CARRIED: the forge returns no crosswalk match report', pass: forgeResult.crosswalkMatchReport === undefined, detail: `crosswalkMatchReport ${forgeResult.crosswalkMatchReport === undefined ? 'absent' : 'PRESENT'}` },
	];
};

const judgeDeclared = ({ forgeResult }) => {
	const mappingInstruction = edfiForgeDeclaration.mappingInstruction;
	const rootNode = forgeResult.nodes.find((oneNode) => oneNode.stableId === edfiForgeDeclaration.rootStableId);
	const rootSourceFileList = rootNode ? [].concat(rootNode.properties.sourceFiles || []) : [];
	const allowanceE8 = edfiForgeDeclaration.compatibilityDeclarationList.find((oneDeclaration) => oneDeclaration.allowanceId === 'E8');
	return [
		{
			label: 'DECLARED: mappingInstruction names no CEDS anchor and no implied target',
			pass: mappingInstruction.cedsOriginalAnchorPropertyName.length === 0 && mappingInstruction.cedsOptionOriginalAnchorPropertyName.length === 0 && mappingInstruction.includeInImplied === false && mappingInstruction.impliedTargets.length === 0,
			detail: JSON.stringify(mappingInstruction),
		},
		{ label: 'DECLARED: no crosswalk no-mapping sentinel is declared', pass: edfiForgeDeclaration.cedsAnchorAbsentSentinelList.length === 0, detail: JSON.stringify(edfiForgeDeclaration.cedsAnchorAbsentSentinelList) },
		{ label: 'DECLARED: allowance E8 lists no crosswalk logical source name', pass: allowanceE8 !== undefined && !allowanceE8.logicalSourceFileNameList.some((oneName) => /crosswalk/i.test(oneName)), detail: JSON.stringify(allowanceE8 && allowanceE8.logicalSourceFileNameList) },
		{ label: "DECLARED: the root's sourceFiles do not name the crosswalk", pass: rootNode !== undefined && !rootSourceFileList.some((oneName) => /crosswalk/i.test(oneName)), detail: JSON.stringify(rootSourceFileList) },
	];
};

const judgeUnread = () => {
	const sha256SumsText = fs.readFileSync(path.join(SNAPSHOT_PATH, 'SHA256SUMS'), 'utf8');
	const crosswalkListedLineList = sha256SumsText.split('\n').filter((lineText) => /crosswalk/i.test(lineText));
	const retiredFolderPath = path.join(SNAPSHOT_PATH, RETIRED_FOLDER_NAME);
	const retiredSumsPath = path.join(retiredFolderPath, 'SHA256SUMS');
	const retiredSumsText = fs.existsSync(retiredSumsPath) ? fs.readFileSync(retiredSumsPath, 'utf8') : '';
	const verifiedFileNameList = retiredSumsText
		.split('\n')
		.map((lineText) => lineText.match(/^([0-9a-f]{64})\s+\*?(.+)$/))
		.filter((lineMatch) => lineMatch && fs.existsSync(path.join(retiredFolderPath, lineMatch[2].trim())) && sha256OfFile(path.join(retiredFolderPath, lineMatch[2].trim())) === lineMatch[1])
		.map((lineMatch) => lineMatch[2].trim())
		.sort();
	return [
		{ label: "UNREAD: snapshot 04's SHA256SUMS lists no crosswalk path (the framework verifies, and so opens, every listed file)", pass: crosswalkListedLineList.length === 0, detail: crosswalkListedLineList.join(' | ') || 'none' },
		{ label: `UNREAD: the old folder name '${FORMER_FOLDER_NAME}/' is gone from the snapshot`, pass: !fs.existsSync(path.join(SNAPSHOT_PATH, FORMER_FOLDER_NAME)), detail: path.join(SNAPSHOT_PATH, FORMER_FOLDER_NAME) },
		{ label: `UNREAD: '${RETIRED_FOLDER_NAME}/' keeps both CSVs and its own SHA256SUMS verifies them (provenance kept)`, pass: JSON.stringify(verifiedFileNameList) === JSON.stringify(RETIRED_CSV_FILE_NAME_LIST), detail: `verified ${JSON.stringify(verifiedFileNameList)}` },
	];
};

const judgeDerived = () => {
	const derivedPlugin = require(DERIVED_PLUGIN_FILE_PATH);
	const actualSha256 = sha256OfFile(DERIVED_PLUGIN_FILE_PATH);
	return [
		{ label: 'DERIVED: edfiCedsDerivedPlugin.js is byte-identical to its pinned bytes (campaign P3 W-B-5 re-anchor)', pass: actualSha256 === DERIVED_PLUGIN_SHA256_AT_GOLDJEV_A, detail: `sha256 ${actualSha256}` },
		{ label: 'DERIVED: edfiCedsDerivedPlugin declares no source channel (it opens no file)', pass: Array.isArray(derivedPlugin.bridgeDeclaration.sourceChannelList) && derivedPlugin.bridgeDeclaration.sourceChannelList.length === 0, detail: JSON.stringify(derivedPlugin.bridgeDeclaration.sourceChannelList) },
	];
};

const reportCheckList = (checkList) => checkList.forEach((oneCheck) => harness.ok(oneCheck.label, oneCheck.pass, oneCheck.detail));

// -----------------------------------------------------------------
// the run
// -----------------------------------------------------------------
const taskList = new taskListPlus();

taskList.push((args, next) => {
	harness.section('REAL: the shipped Ed-Fi bundle, forged over snapshot 04 with skipEmbedding true');
	forgeWith({ mutationList: [] }, (forgeError, forgeResult) => {
		harness.accepts('the real Ed-Fi forge succeeds', forgeError ? [forgeError] : []);
		if (forgeError) {
			next(`real forge refused: ${forgeError}`);
			return;
		}
		reportCheckList(judgeCarried({ forgeResult }));
		reportCheckList(judgeDeclared({ forgeResult }));
		next('', args);
	});
});

taskList.push((args, next) => {
	harness.section('UNREAD and DERIVED: the retired folder, the snapshot manifest, the derived plugin');
	reportCheckList(judgeUnread());
	reportCheckList(judgeDerived());
	next('', args);
});

taskList.push((args, next) => {
	harness.section('TWIN plantedCrosswalkCrossRef: one crosswalk-sourced crossRef planted in the walk must be REFUSED BY NAME');
	const mutationList = [{ modulePath: WALK_FILE_PATH, find: PLANT_FIND, replace: PLANT_REPLACE }];
	mutationList.forEach((oneMutation) => moduleDouble.assertMutationApplies(oneMutation));
	forgeWith({ mutationList }, (forgeError) => {
		harness.ok('twin plantedCrosswalkCrossRef observed RED: the forge refused', Boolean(forgeError), 'the forge accepted a planted crosswalk crossRef');
		harness.match('… and the refusal names the node, the property and the exclusion', `${forgeError || ''}`, SCAN_REFUSAL_RE);
		next('', args);
	});
});

taskList.push((args, next) => {
	harness.section('TWIN plantedWithScanDisabled: the same plant with the scan cut out must turn CARRIED red');
	const mutationList = [
		{ modulePath: WALK_FILE_PATH, find: PLANT_FIND, replace: PLANT_REPLACE },
		{ modulePath: WALK_FILE_PATH, find: SCAN_FIND, replace: SCAN_REPLACE },
	];
	mutationList.forEach((oneMutation) => moduleDouble.assertMutationApplies(oneMutation));
	forgeWith({ mutationList }, (forgeError, forgeResult) => {
		// a twin the forge REFUSES proved nothing about the judge: the red must come from the judge
		harness.accepts('twin plantedWithScanDisabled forges (its red is the judge\'s, not a refusal)', forgeError ? [forgeError] : []);
		if (forgeError) {
			next('', args);
			return;
		}
		const failingCheckList = judgeCarried({ forgeResult }).filter((oneCheck) => !oneCheck.pass);
		harness.ok('twin plantedWithScanDisabled observed CARRIED RED', failingCheckList.length > 0, 'no CARRIED check failed under the twin');
		xLog.verbose(`       red because: ${failingCheckList.map((oneCheck) => `${oneCheck.label} [${oneCheck.detail}]`).join(' | ')}`);
		next('', args);
	});
});

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to completion', false, pipeError);
	}
	harness.report();
});
