#!/usr/bin/env node
'use strict';

// test-goldEvalInventory.js — the gates for -goldEvalCheck's STANDARD-INVENTORY PROMOTION GATE (ctdlHub-101926 P8,
// WORKORDER-P8 step 1; PLAN §5 risk 6: "a dev promotion drops CTDL from production again").
//
// PROVES, on FIXTURE inventories and a graph-reader DOUBLE (no container, no docker, no LLM, no Voyage):
//   (a) --supersedes is parsed BY NAME: one or more predecessor names, or the single word 'none'; an empty value,
//       'none' beside a name, and a repeated name are each REFUSED rather than corrected;
//   (b) a candidate holding everything its predecessor holds (standards AND hubs) yields NO refusal, and what it ADDS
//       is reported, never refused;
//   (c) a candidate MISSING standards and hubs is REFUSED, and the refusal NAMES EVERY missing standard and EVERY
//       missing hub (two of each, so a refusal naming only the first would fail);
//   (d) an inventory FILE is read by its declared shape: the gate's own shape (standardSourceList, hubNameList) and
//       P0's oracleCensus shape (nodeCountBySource, '(none)' excluded, NO hub list). A dimension the file does not
//       carry is UNMEASURED, and an unmeasured dimension REFUSES BY NAME — it is never read as 'empty';
//   (e) a file of no known shape, of BOTH shapes, or that does not parse is REFUSED by name;
//   (f) runInventoryGate reads the CANDIDATE live and refuses unless the graph holds EXACTLY ONE GraphProvenance whose
//       manifestRefId is the manifest under certification (an inventory of a different graph proves nothing);
//   (g) a predecessor is read LIVE by default, or from <dir>/<name>.inventory.json when an inventory directory is
//       named; an absent file is REFUSED naming its path (a production volume is never mounted to read it);
//   (h) THREE-STATE: the missing-member comparison disconnected (module double) lets the (c) candidate through →
//       the conjunct is observed RED.
//
// Run: node apps/graph-builder/test/test-goldEvalInventory.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for -goldEvalCheck's standard-inventory promotion gate (--supersedes)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves, on fixture inventories and a graph-reader double, that the inventory gate refuses BY NAME a candidate
     missing any standard or hub its predecessor holds, reports what the candidate adds, refuses an unmeasured
     dimension, reads predecessor inventory files by declared shape, and refuses a candidate graph whose passport
     does not name the manifest under certification. Touches no container and no store.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const inventoryModulePath = path.join(__dirname, '..', 'lib', 'gold-eval-inventory.js');
const inventoryGate = require(inventoryModulePath);

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfGoldEvalInventory-'));
const MANIFEST_REF_ID = 'a'.repeat(64);

// the graph-reader DOUBLE: one table per container, the rows each inventory query returns. The cypher is matched on
// the label it reads, so a query that read the wrong label would return nothing and fail the counts below.
const graphReaderDouble = (rowTableByContainerName) => ({ containerName }, callback) => {
	const rowTable = rowTableByContainerName[containerName];
	if (!rowTable) {
		callback(`graphReaderDouble: no container named '${containerName}'`);
		return;
	}
	const runCypher = ({ cypherText }, cypherCallback) => {
		const labelName = ['DmeStandardRoot', 'HubDefinition', 'GraphProvenance'].find((oneLabel) => cypherText.indexOf(`:${oneLabel}`) !== -1);
		cypherCallback('', (rowTable[labelName] || []).map((oneRow) => ({ ...oneRow })));
	};
	callback('', { runCypher, closeAll: (closeCallback) => closeCallback() });
};
const standardRowsOf = (sourceList) => sourceList.map((oneSource) => ({ inventoryName: oneSource }));
const hubRowsOf = (hubList) => hubList.map((oneHub) => ({ inventoryName: oneHub }));
const passportRowsOf = (manifestRefIdList) => manifestRefIdList.map((oneRefId) => ({ manifestRefId: oneRefId, graphName: 'DEV_fixtureCandidate' }));

const inventoryOf = ({ graphName, standardList, hubList, unmeasuredDimensionList = [] }) => ({
	graphName,
	inventoryOrigin: 'fixture',
	nameListByDimension: { standard: standardList, hub: hubList },
	unmeasuredDimensionList,
});

// ---------------------------------------------------------------------
harness.section('SECTION 1 — (a) --supersedes is parsed by name, never corrected');
// ---------------------------------------------------------------------
const noneParse = inventoryGate.parseSupersedesList(['none']);
harness.ok("(a) 'none' alone is accepted and says so", !noneParse.error && noneParse.supersedesNone === true && noneParse.predecessorNameList.length === 0, JSON.stringify(noneParse));
const twoParse = inventoryGate.parseSupersedesList(['GOLD_EVAL_A', ' GOLD_EVAL_B ']);
harness.equal('(a) two names → two predecessors, trimmed', JSON.stringify(twoParse.predecessorNameList), JSON.stringify(['GOLD_EVAL_A', 'GOLD_EVAL_B']));
harness.match('(a) ABSENT → REFUSED BY NAME (a promotion must say what it supersedes, or none)', inventoryGate.parseSupersedesList([]).error || '', /--supersedes=<containerName>.*REQUIRED/);
harness.match('(a) an EMPTY value → REFUSED BY NAME', inventoryGate.parseSupersedesList(['']).error || '', /empty/);
harness.match("(a) 'none' BESIDE a name → REFUSED BY NAME", inventoryGate.parseSupersedesList(['none', 'GOLD_EVAL_A']).error || '', /'none' .*alone/);
harness.match('(a) a REPEATED name → REFUSED BY NAME', inventoryGate.parseSupersedesList(['GOLD_EVAL_A', 'GOLD_EVAL_A']).error || '', /more than once.*GOLD_EVAL_A/);

// ---------------------------------------------------------------------
harness.section('SECTION 2 — (b)(c) the comparison: missing members refuse by name, added members are reported');
// ---------------------------------------------------------------------
const predecessorInventory = inventoryOf({ graphName: 'GOLD_EVAL_predecessor', standardList: ['CEDS', 'EdFi', 'SIF260928', 'PESC-CollegeTranscript-1.8.0'], hubList: ['CEDS', 'OLDHUB'] });
const supersetCandidate = inventoryOf({ graphName: 'DEV_candidate', standardList: ['CEDS', 'CTDL', 'EdFi', 'PESC-CollegeTranscript-1.8.0', 'SIF260928'], hubList: ['CEDS', 'CTDL', 'OLDHUB'] });
const supersetComparison = inventoryGate.compareInventories({ candidateInventory: supersetCandidate, predecessorInventory });
harness.equal('(b) a superset candidate: no refusal', inventoryGate.inventoryRefusalFor({ candidateInventory: supersetCandidate, predecessorInventory, comparison: supersetComparison }), '');
harness.equal('(b) … nothing missing (standards)', supersetComparison.missingNameListByDimension.standard.length, 0);
harness.equal('(b) … nothing missing (hubs)', supersetComparison.missingNameListByDimension.hub.length, 0);
harness.equal('(b) … the ADDED standard is reported', JSON.stringify(supersetComparison.addedNameListByDimension.standard), JSON.stringify(['CTDL']));
harness.equal('(b) … the ADDED hub is reported', JSON.stringify(supersetComparison.addedNameListByDimension.hub), JSON.stringify(['CTDL']));

const shortCandidate = inventoryOf({ graphName: 'DEV_shortCandidate', standardList: ['CEDS', 'PESC-CollegeTranscript-1.8.0'], hubList: ['CEDS'] });
const shortComparison = inventoryGate.compareInventories({ candidateInventory: shortCandidate, predecessorInventory });
const shortRefusal = inventoryGate.inventoryRefusalFor({ candidateInventory: shortCandidate, predecessorInventory, comparison: shortComparison });
harness.match('(c) a candidate missing members → REFUSED, naming candidate and predecessor', shortRefusal, /DEV_shortCandidate.*GOLD_EVAL_predecessor/s);
harness.match('(c) … naming the FIRST missing standard', shortRefusal, /EdFi/);
harness.match('(c) … and the SECOND missing standard (every one, not the first)', shortRefusal, /SIF260928/);
harness.match('(c) … and the missing hub', shortRefusal, /OLDHUB/);
harness.equal('(c) … the comparison lists exactly the two missing standards', JSON.stringify(shortComparison.missingNameListByDimension.standard), JSON.stringify(['EdFi', 'SIF260928']));

// (h) THREE-STATE: the missing-member comparison DISCONNECTED in a module double lets the short candidate through.
const disconnectedText = fs.readFileSync(inventoryModulePath, 'utf8');
const mutationFindText = 'const missingNameList = predecessorNameList.filter((oneName) => candidateNameList.indexOf(oneName) === -1);';
harness.equal('(h) the mutation find-text occurs EXACTLY ONCE in the module (a twin that cannot apply is blind)', disconnectedText.split(mutationFindText).length - 1, 1);
// compiled IN MEMORY under the real module's own path, so its requires resolve exactly as the real module's do and no
// file is written into the tree
const Module = require('module');
const disconnectedModule = new Module(inventoryModulePath, module);
disconnectedModule.filename = inventoryModulePath;
disconnectedModule.paths = Module._nodeModulePaths(path.dirname(inventoryModulePath));
disconnectedModule._compile(disconnectedText.replace(mutationFindText, 'const missingNameList = [];'), inventoryModulePath);
const disconnectedGate = disconnectedModule.exports;
const disconnectedComparison = disconnectedGate.compareInventories({ candidateInventory: shortCandidate, predecessorInventory });
harness.equal('(h) RED-OBSERVED — with the comparison disconnected the SAME short candidate is NOT refused', disconnectedGate.inventoryRefusalFor({ candidateInventory: shortCandidate, predecessorInventory, comparison: disconnectedComparison }), '');

// ---------------------------------------------------------------------
harness.section('SECTION 3 — (d)(e) inventory files are read by DECLARED shape; an unmeasured dimension refuses');
// ---------------------------------------------------------------------
const oracleFileText = JSON.stringify({ graphLabel: 'GOLD_EVAL_260718', containerName: 'DEV_ctdlOracle260718', nodeCountBySource: { '(none)': 143, CEDS: 53027, CTDL: 994, SOC: 2011 } });
const oracleRead = inventoryGate.inventoryFromFileText({ inventoryFilePath: '/fixture/GOLD_EVAL_260718.inventory.json', fileText: oracleFileText });
harness.ok('(d) the P0 oracleCensus shape is read', !oracleRead.error, oracleRead.error);
harness.equal("(d) … its standards are the nodeCountBySource names, '(none)' excluded", JSON.stringify(oracleRead.inventory && oracleRead.inventory.nameListByDimension.standard), JSON.stringify(['CEDS', 'CTDL', 'SOC']));
harness.equal('(d) … its graph is named by graphLabel', oracleRead.inventory && oracleRead.inventory.graphName, 'GOLD_EVAL_260718');
harness.equal('(d) … and its HUB dimension is UNMEASURED (the file carries none), never empty', JSON.stringify(oracleRead.inventory && oracleRead.inventory.unmeasuredDimensionList), JSON.stringify(['hub']));
const oracleComparison = inventoryGate.compareInventories({ candidateInventory: supersetCandidate, predecessorInventory: oracleRead.inventory });
const oracleRefusal = inventoryGate.inventoryRefusalFor({ candidateInventory: supersetCandidate, predecessorInventory: oracleRead.inventory, comparison: oracleComparison });
harness.match('(d) against it, the missing standard SOC is named', oracleRefusal, /SOC/);
harness.match('(d) … and the UNMEASURED hub dimension is named, not passed', oracleRefusal, /hub.*UNMEASURED/s);
const completeOracleText = JSON.stringify({ graphLabel: 'GOLD_EVAL_small', nodeCountBySource: { CEDS: 1 } });
const completeOracleRead = inventoryGate.inventoryFromFileText({ inventoryFilePath: '/fixture/small.json', fileText: completeOracleText });
const completeOracleRefusal = inventoryGate.inventoryRefusalFor({ candidateInventory: supersetCandidate, predecessorInventory: completeOracleRead.inventory, comparison: inventoryGate.compareInventories({ candidateInventory: supersetCandidate, predecessorInventory: completeOracleRead.inventory }) });
harness.match('(d) EVERY standard present but hubs unmeasured → STILL REFUSED (an unmeasured dimension never passes)', completeOracleRefusal, /UNMEASURED/);

const gateShapeText = JSON.stringify({ graphName: 'GOLD_EVAL_gateShape', standardSourceList: ['CEDS', 'EdFi'], hubNameList: ['CEDS'] });
const gateShapeRead = inventoryGate.inventoryFromFileText({ inventoryFilePath: '/fixture/gateShape.json', fileText: gateShapeText });
harness.equal("(d) the gate's own shape is read with both dimensions measured", JSON.stringify(gateShapeRead.inventory && gateShapeRead.inventory.unmeasuredDimensionList), JSON.stringify([]));
harness.equal('(d) … standards as listed', JSON.stringify(gateShapeRead.inventory && gateShapeRead.inventory.nameListByDimension.standard), JSON.stringify(['CEDS', 'EdFi']));
harness.match('(e) a file of NO known shape → REFUSED BY NAME', inventoryGate.inventoryFromFileText({ inventoryFilePath: '/fixture/odd.json', fileText: '{"graphName":"X","something":1}' }).error || '', /matches no declared inventory file shape/);
harness.match('(e) a file of BOTH shapes → REFUSED BY NAME', inventoryGate.inventoryFromFileText({ inventoryFilePath: '/fixture/both.json', fileText: JSON.stringify({ graphName: 'X', graphLabel: 'X', standardSourceList: [], hubNameList: [], nodeCountBySource: {} }) }).error || '', /matches 2 declared inventory file shapes/);
harness.match('(e) a file that does not parse → REFUSED BY NAME', inventoryGate.inventoryFromFileText({ inventoryFilePath: '/fixture/broken.json', fileText: '{ not json' }).error || '', /does not parse/);
harness.match('(e) a file with no graph name → REFUSED BY NAME', inventoryGate.inventoryFromFileText({ inventoryFilePath: '/fixture/noName.json', fileText: JSON.stringify({ standardSourceList: [], hubNameList: [] }) }).error || '', /names no graph/);

// ---------------------------------------------------------------------
harness.section('SECTION 4 — (f)(g) runInventoryGate: the candidate is read live and must be the manifest under certification');
// ---------------------------------------------------------------------
const candidateTable = { DmeStandardRoot: standardRowsOf(['CEDS', 'CTDL', 'EdFi', 'PESC-CollegeTranscript-1.8.0', 'SIF260928']), HubDefinition: hubRowsOf(['CEDS', 'CTDL']), GraphProvenance: passportRowsOf([MANIFEST_REF_ID]) };
const livePredecessorTable = { DmeStandardRoot: standardRowsOf(['CEDS', 'EdFi', 'PESC-CollegeTranscript-1.8.0', 'SIF260928']), HubDefinition: hubRowsOf(['CEDS']), GraphProvenance: passportRowsOf(['b'.repeat(64)]) };
const readerTable = {
	DEV_candidate: candidateTable,
	GOLD_EVAL_live: livePredecessorTable,
	DEV_noPassport: { ...candidateTable, GraphProvenance: [] },
	DEV_otherManifest: { ...candidateTable, GraphProvenance: passportRowsOf(['c'.repeat(64)]) },
	DEV_twoPassports: { ...candidateTable, GraphProvenance: passportRowsOf([MANIFEST_REF_ID, MANIFEST_REF_ID]) },
	DEV_short: { ...candidateTable, DmeStandardRoot: standardRowsOf(['CEDS']) },
};
const inventoryDirectoryPath = path.join(scratchDir, 'inventories');
fs.mkdirSync(inventoryDirectoryPath);
fs.writeFileSync(path.join(inventoryDirectoryPath, 'GOLD_EVAL_filed.inventory.json'), JSON.stringify({ graphName: 'GOLD_EVAL_filed', standardSourceList: ['CEDS', 'EdFi'], hubNameList: ['CEDS'] }));
const gateArgsFor = (overrideMap) => ({ rawSupersedesList: ['GOLD_EVAL_live'], candidateContainerName: 'DEV_candidate', manifestRefId: MANIFEST_REF_ID, inventoryDirectoryPath: undefined, openGraphReader: graphReaderDouble(readerTable), ...overrideMap });

const runSequence = (stepList, finishCallback) => {
	if (stepList.length === 0) {
		finishCallback();
		return;
	}
	stepList[0](() => runSequence(stepList.slice(1), finishCallback));
};
runSequence(
	[
		(next) => inventoryGate.runInventoryGate(gateArgsFor({}), (gateError, gateReport) => {
			harness.ok('(g) live predecessor, superset candidate → no refusal', !gateError, gateError);
			harness.equal('(g) … the report names the predecessor read', gateReport && gateReport.predecessorReportList[0].predecessorInventory.graphName, 'GOLD_EVAL_live');
			harness.equal('(g) … read LIVE', gateReport && gateReport.predecessorReportList[0].predecessorInventory.inventoryOrigin, 'liveGraph:GOLD_EVAL_live');
			harness.equal('(g) … the candidate standards read from the roots', gateReport && gateReport.candidateInventory.nameListByDimension.standard.length, 5);
			harness.equal('(g) … what the candidate ADDS is reported (CTDL standard)', JSON.stringify(gateReport && gateReport.predecessorReportList[0].comparison.addedNameListByDimension.standard), JSON.stringify(['CTDL']));
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ rawSupersedesList: ['none'] }), (gateError, gateReport) => {
			harness.ok("(a) --supersedes=none → no refusal, and the report SAYS none", !gateError && gateReport && gateReport.supersedesNone === true, gateError);
			harness.equal("(a) … and with 'none' NO graph is opened (no candidate inventory is claimed)", gateReport && gateReport.candidateInventory, null);
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ candidateContainerName: undefined }), (gateError) => {
			harness.match('(f) a predecessor named but no candidate container → REFUSED BY NAME', gateError || '', /--containerName=<the candidate's running container> is REQUIRED/);
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ candidateContainerName: 'DEV_noPassport' }), (gateError) => {
			harness.match('(f) a candidate with NO GraphProvenance → REFUSED BY NAME', gateError || '', /holds 0 GraphProvenance/);
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ candidateContainerName: 'DEV_twoPassports' }), (gateError) => {
			harness.match('(f) a candidate with TWO passports → REFUSED BY NAME', gateError || '', /holds 2 GraphProvenance/);
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ candidateContainerName: 'DEV_otherManifest' }), (gateError) => {
			harness.match('(f) a candidate whose passport names ANOTHER manifest → REFUSED, naming both', gateError || '', new RegExp(`${'c'.repeat(64)}.*${MANIFEST_REF_ID}`, 's'));
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ candidateContainerName: 'DEV_short' }), (gateError) => {
			harness.match('(c) through the runner: a short candidate → REFUSED naming each missing standard', gateError || '', /EdFi.*SIF260928/s);
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ rawSupersedesList: ['GOLD_EVAL_filed'], inventoryDirectoryPath }), (gateError, gateReport) => {
			harness.ok('(g) a predecessor read from <dir>/<name>.inventory.json → no refusal', !gateError, gateError);
			harness.match('(g) … its origin names the FILE', (gateReport && gateReport.predecessorReportList[0].predecessorInventory.inventoryOrigin) || '', /^file:.*GOLD_EVAL_filed\.inventory\.json$/);
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ rawSupersedesList: ['GOLD_EVAL_absent'], inventoryDirectoryPath }), (gateError) => {
			harness.match('(g) an inventory directory WITHOUT the named file → REFUSED, naming the path', gateError || '', /GOLD_EVAL_absent\.inventory\.json/);
			next();
		}),
		(next) => inventoryGate.runInventoryGate(gateArgsFor({ rawSupersedesList: ['GOLD_EVAL_notRunning'] }), (gateError) => {
			harness.match('(g) a live predecessor that cannot be opened → REFUSED, naming it', gateError || '', /GOLD_EVAL_notRunning/);
			next();
		}),
	],
	() => harness.report(),
);
