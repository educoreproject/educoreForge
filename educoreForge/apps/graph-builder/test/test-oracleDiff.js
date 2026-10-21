#!/usr/bin/env node
'use strict';

// test-oracleDiff.js — gate for apps/graph-builder/tools/oracleDiff.js (ctdlHub-101926 step 0b, SCARLET_ARROW's assignment from
// GARDEN_PORTAL's stand-down items a and d). Drives the REAL tool end to end over synthetic census and allowance files written to
// a temporary directory outside the tree (no graph, no docker).
//
// PROVES:
//   (a) the census's EXTERNAL edge sections (familyEdges, hubEdges, otherExternalEdges) are compared: an edge on one side only
//       FAILS the run unless a declared externalEdgeRuleList row of that side and section admits it, counted exactly
//   (b) a shared external edge whose properties differ FAILS the run
//   (c) a declared rule whose count is not met FAILS its own row
//   (d) the allowance's REQUIRED fields are refused by name when absent: a1.additionalReferenceCountByLocatorAndPrefix,
//       candidateOnlyEdgeRuleList, externalEdgeRuleList (no silent default)
//   (e) an externalEdgeRuleList row naming an unknown section or side is refused by name
//   (f) the clean case PASSES: every external difference declared, every count met
//   (g) ⟪ctdlHub P4 E14⟫ an addedPropertyCountRuleList row counts the nodes of a role carrying an added property and the
//       entries it holds, exactly; a wrong count FAILS its row; the field is REQUIRED like the other rule lists
// Each negative is a run of the real tool whose output names the specific defect (harness doctrine: a rejection for the
// wrong reason is a false green).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: oracleDiff compares external edges and refuses an incomplete allowance (ctdlHub-101926 step 0b)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL_PATH = path.join(__dirname, '..', 'tools', 'oracleDiff.js');
const STANDARD_SOURCE = 'TOYSTD';
const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'testOracleDiff-'));

// ---------------------------------------------------------------- fixtures
const rootNode = { stableId: 'toy:root', labels: ['DmeStandardRoot', 'ForgedNode'], role: 'DmeStandardRoot', properties: { name: 'Toy' } };
const classNode = { stableId: 'toy:Thing', labels: ['DmeClass', 'ForgedNode'], role: 'DmeClass', properties: { name: 'Thing' } };
const intraEdge = { type: 'HAS_CLASS', from: 'toy:root', fromSource: STANDARD_SOURCE, to: 'toy:Thing', toSource: STANDARD_SOURCE, properties: { provenanceTier: 'structural' } };
const definesEdge = { type: 'DEFINES', from: `standardDefinition:${STANDARD_SOURCE}`, fromSource: null, to: 'toy:root', toSource: STANDARD_SOURCE, properties: { provenanceTier: 'structural' } };
const hubEdge = { type: 'CLOSE_MATCH', from: 'toy:Thing', fromSource: STANDARD_SOURCE, to: 'cedsHubRef:abc', toSource: 'CEDS', properties: { confidence: 0.9 } };
const familyEdge = { type: 'HAS_OPTION_SET', from: 'other:prop', fromSource: 'OTHERSTD', to: 'toy:Thing', toSource: STANDARD_SOURCE, properties: { bridgeAuthored: true } };

const censusOf = ({ familyEdgeList, hubEdgeList, otherExternalEdgeList }) => ({
	sourceName: STANDARD_SOURCE,
	nodes: [classNode, rootNode],
	intraEdges: [intraEdge],
	familyEdges: familyEdgeList.length === 0 ? {} : { [`${STANDARD_SOURCE}::OTHERSTD`]: { count: familyEdgeList.length, edgeList: familyEdgeList } },
	hubEdges: hubEdgeList,
	otherExternalEdges: otherExternalEdgeList,
});
// the oracle carries July's bridge edges (one family, one hub); the candidate is a standard-only build with the framework's DEFINES
const ORACLE_CENSUS = censusOf({ familyEdgeList: [familyEdge], hubEdgeList: [hubEdge], otherExternalEdgeList: [] });
const CANDIDATE_CENSUS = censusOf({ familyEdgeList: [], hubEdgeList: [], otherExternalEdgeList: [definesEdge] });

const CLEAN_EXTERNAL_EDGE_RULE_LIST = [
	{ ruleName: 'X1', section: 'otherExternalEdges', side: 'candidateOnly', edgeType: 'DEFINES', fromStableId: `standardDefinition:${STANDARD_SOURCE}`, expectedCount: 1 },
	{ ruleName: 'X2', section: 'hubEdges', side: 'oracleOnly', edgeType: 'CLOSE_MATCH', expectedCount: 1 },
	{ ruleName: 'X3', section: 'familyEdges', side: 'oracleOnly', edgeType: 'HAS_OPTION_SET', expectedCount: 1 },
];
const allowanceOf = (overrideByName) => ({
	standardSource: STANDARD_SOURCE,
	ignoredOracleLabelList: [],
	ignoredCandidateLabelList: [],
	ignoredOracleEdgePropertyList: [],
	a4OracleOnlyPropertyList: [],
	a3RemovedPropertyListByRole: {},
	a3AddedPropertyListByRole: {},
	v1DeclaredValueByRole: {},
	m1ListWrappedPropertyListByRole: {},
	a1: { crossRefsPropertyName: 'crossRefs', seamPrefixList: [], nonNativeReferenceCensusPath: 'sourceReferenceCensus.json', additionalReferenceCountByLocatorAndPrefix: {} },
	a2: { seamPropertyName: 'seamRefs', seamRole: 'DmeClass', expectedEntryTotal: 0, expectedNodeTotal: 0, expectedOracleAnchorTotal: 0 },
	a5: { propertyName: 'foreignTerms', foreignTermCountsPath: 'foreignTermCounts.json' },
	candidateOnlyEdgeRuleList: [],
	externalEdgeRuleList: CLEAN_EXTERNAL_EDGE_RULE_LIST,
	addedPropertyCountRuleList: [],
	...overrideByName,
});

const writeJson = (fileName, fileContent) => {
	const filePath = path.join(scratchDirectoryPath, fileName);
	fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 1));
	return filePath;
};
writeJson('sourceReferenceCensus.json', { bySource: { [STANDARD_SOURCE]: { referenceCountByPredicateAndPrefix: {} } } });
writeJson('foreignTermCounts.json', { bySource: { [STANDARD_SOURCE]: { foreignEntryCount: 0, foreignEntryIdList: [] } } });
const oracleCensusPath = writeJson('oracle.census.json', ORACLE_CENSUS);

let runSequence = 0;
const runTool = ({ allowanceSpec, candidateCensus }) => {
	runSequence += 1;
	const allowanceSpecPath = writeJson(`allowance-${runSequence}.json`, allowanceSpec);
	const candidateCensusPath = writeJson(`candidate-${runSequence}.census.json`, candidateCensus);
	const run = spawnSync(process.execPath, [TOOL_PATH, `--oracleCensusPath=${oracleCensusPath}`, `--candidateCensusPath=${candidateCensusPath}`, `--allowanceSpecPath=${allowanceSpecPath}`], { encoding: 'utf8' });
	return { exitCode: run.status, outputText: `${run.stdout || ''}${run.stderr || ''}` };
};
const withoutA1Field = (fieldName) => {
	const a1 = { ...allowanceOf({}).a1 };
	delete a1[fieldName];
	return allowanceOf({ a1 });
};
const withoutTopField = (fieldName) => {
	const allowanceSpec = allowanceOf({});
	delete allowanceSpec[fieldName];
	return allowanceSpec;
};

// ---------------------------------------------------------------- (f) the clean case
harness.section('(f) every external difference declared, every count met: PASS');
const cleanRun = runTool({ allowanceSpec: allowanceOf({}), candidateCensus: CANDIDATE_CENSUS });
harness.equal('(f) clean run exits 0', cleanRun.exitCode, 0);
harness.match('(f) the externalEdges row is reported and passes', cleanRun.outputText, /\[externalEdges\] PASS/);
harness.match('(f) a declared external rule reports its count', cleanRun.outputText, /\[X1\] PASS — 1 candidateOnly otherExternalEdges DEFINES/);

// ---------------------------------------------------------------- (a) one-sided external edges must be declared
harness.section('(a) an external edge on one side only fails unless a rule of that side and section admits it');
const undeclaredCandidateRun = runTool({ allowanceSpec: allowanceOf({ externalEdgeRuleList: CLEAN_EXTERNAL_EDGE_RULE_LIST.filter((oneRule) => oneRule.ruleName !== 'X1') }), candidateCensus: CANDIDATE_CENSUS });
harness.equal('(a) candidate-only DEFINES with no rule: exit 1', undeclaredCandidateRun.exitCode, 1);
harness.match('(a) candidate-only DEFINES is named as unexplained', undeclaredCandidateRun.outputText, /UNEXPLAINED .*external edge absent from oracle.*otherExternalEdges\|DEFINES\|standardDefinition:TOYSTD\|toy:root/);
const undeclaredHubRun = runTool({ allowanceSpec: allowanceOf({ externalEdgeRuleList: CLEAN_EXTERNAL_EDGE_RULE_LIST.filter((oneRule) => oneRule.ruleName !== 'X2') }), candidateCensus: CANDIDATE_CENSUS });
harness.equal('(a) oracle-only hub edge with no rule: exit 1', undeclaredHubRun.exitCode, 1);
harness.match('(a) oracle-only hub edge is named as unexplained', undeclaredHubRun.outputText, /UNEXPLAINED .*external edge absent from candidate.*hubEdges\|CLOSE_MATCH\|toy:Thing\|cedsHubRef:abc/);
const wrongSideRun = runTool({ allowanceSpec: allowanceOf({ externalEdgeRuleList: CLEAN_EXTERNAL_EDGE_RULE_LIST.map((oneRule) => (oneRule.ruleName === 'X3' ? { ...oneRule, side: 'candidateOnly' } : oneRule)) }), candidateCensus: CANDIDATE_CENSUS });
harness.match('(a) a rule of the WRONG side does not admit the edge', wrongSideRun.outputText, /UNEXPLAINED .*external edge absent from candidate.*familyEdges\|HAS_OPTION_SET/);
const undeclaredFamilyCandidateRun = runTool({ allowanceSpec: allowanceOf({}), candidateCensus: censusOf({ familyEdgeList: [familyEdge, { ...familyEdge, from: 'other:secondProp' }], hubEdgeList: [], otherExternalEdgeList: [definesEdge] }) });
harness.match('(a) a candidate family edge the oracle lacks is named', undeclaredFamilyCandidateRun.outputText, /UNEXPLAINED .*external edge absent from oracle.*familyEdges\|HAS_OPTION_SET\|other:secondProp/);

// ---------------------------------------------------------------- (b) shared external edges compare properties
harness.section('(b) a shared external edge whose properties differ fails');
const changedHubEdgeCensus = censusOf({ familyEdgeList: [], hubEdgeList: [{ ...hubEdge, properties: { confidence: 0.5 } }], otherExternalEdgeList: [definesEdge] });
const changedPropertiesRun = runTool({ allowanceSpec: allowanceOf({ externalEdgeRuleList: CLEAN_EXTERNAL_EDGE_RULE_LIST.filter((oneRule) => oneRule.ruleName !== 'X2') }), candidateCensus: changedHubEdgeCensus });
harness.equal('(b) changed hub edge properties: exit 1', changedPropertiesRun.exitCode, 1);
harness.match('(b) the property difference is named', changedPropertiesRun.outputText, /UNEXPLAINED .*external edge properties differ.*hubEdges\|CLOSE_MATCH/);

// ---------------------------------------------------------------- (c) counts are exact
harness.section('(c) a declared rule whose count is not met fails its row');
const wrongCountRun = runTool({ allowanceSpec: allowanceOf({ externalEdgeRuleList: CLEAN_EXTERNAL_EDGE_RULE_LIST.map((oneRule) => (oneRule.ruleName === 'X2' ? { ...oneRule, expectedCount: 2 } : oneRule)) }), candidateCensus: CANDIDATE_CENSUS });
harness.equal('(c) wrong count: exit 1', wrongCountRun.exitCode, 1);
harness.match('(c) the rule row names its count', wrongCountRun.outputText, /\[X2\] FAIL — 1 oracleOnly hubEdges CLOSE_MATCH edge\(s\) \(expected 2\)/);

// ---------------------------------------------------------------- (d) required allowance fields
harness.section('(d) the allowance\'s required fields are refused by name when absent');
const absentAdditionalRun = runTool({ allowanceSpec: withoutA1Field('additionalReferenceCountByLocatorAndPrefix'), candidateCensus: CANDIDATE_CENSUS });
harness.equal('(d) absent a1.additionalReferenceCountByLocatorAndPrefix: exit 1', absentAdditionalRun.exitCode, 1);
harness.match('(d) absent a1.additionalReferenceCountByLocatorAndPrefix is refused by name', absentAdditionalRun.outputText, /REFUSED: .*a1\.additionalReferenceCountByLocatorAndPrefix/);
const absentCandidateOnlyRun = runTool({ allowanceSpec: withoutTopField('candidateOnlyEdgeRuleList'), candidateCensus: CANDIDATE_CENSUS });
harness.match('(d) absent candidateOnlyEdgeRuleList is refused by name', absentCandidateOnlyRun.outputText, /REFUSED: .*candidateOnlyEdgeRuleList/);
const absentExternalRun = runTool({ allowanceSpec: withoutTopField('externalEdgeRuleList'), candidateCensus: CANDIDATE_CENSUS });
harness.match('(d) absent externalEdgeRuleList is refused by name', absentExternalRun.outputText, /REFUSED: .*externalEdgeRuleList/);
const absentAddedCountRun = runTool({ allowanceSpec: withoutTopField('addedPropertyCountRuleList'), candidateCensus: CANDIDATE_CENSUS });
harness.match('(d) absent addedPropertyCountRuleList is refused by name', absentAddedCountRun.outputText, /REFUSED: .*addedPropertyCountRuleList/);

// ---------------------------------------------------------------- (g) added-property counts
harness.section('(g) an added property is counted exactly, by nodes and by entries');
const taggedClassNode = { ...classNode, properties: { ...classNode.properties, tagList: ['a', 'b'] } };
const taggedCandidateCensus = { ...CANDIDATE_CENSUS, nodes: [taggedClassNode, rootNode] };
const tagAllowanceOf = (ruleOverride) => allowanceOf({
	a3AddedPropertyListByRole: { DmeClass: ['tagList'] },
	addedPropertyCountRuleList: [{ ruleName: 'G1', role: 'DmeClass', propertyName: 'tagList', expectedNodeCount: 1, expectedEntryCount: 2, ...ruleOverride }],
});
const countPassRun = runTool({ allowanceSpec: tagAllowanceOf({}), candidateCensus: taggedCandidateCensus });
harness.equal('(g) exact counts: exit 0', countPassRun.exitCode, 0);
harness.match('(g) the row reports both counts', countPassRun.outputText, /\[G1\] PASS — tagList on 1 DmeClass node\(s\) \(expected 1\), 2 entries \(expected 2\)/);
const entryCountRun = runTool({ allowanceSpec: tagAllowanceOf({ expectedEntryCount: 3 }), candidateCensus: taggedCandidateCensus });
harness.equal('(g) wrong entry count: exit 1', entryCountRun.exitCode, 1);
harness.match('(g) the wrong entry count is named', entryCountRun.outputText, /\[G1\] FAIL — tagList on 1 DmeClass node\(s\) \(expected 1\), 2 entries \(expected 3\)/);
const nodeCountRun = runTool({ allowanceSpec: tagAllowanceOf({ expectedNodeCount: 0 }), candidateCensus: taggedCandidateCensus });
harness.match('(g) the wrong node count is named', nodeCountRun.outputText, /\[G1\] FAIL — tagList on 1 DmeClass node\(s\) \(expected 0\)/);
const malformedCountRun = runTool({ allowanceSpec: tagAllowanceOf({ expectedEntryCount: 'two' }), candidateCensus: taggedCandidateCensus });
harness.match('(g) a count rule without integer counts is refused by name', malformedCountRun.outputText, /REFUSED: .*addedPropertyCountRuleList.*G1/);

// ---------------------------------------------------------------- (e) malformed rule rows
harness.section('(e) an external rule naming an unknown section or side is refused by name');
const badSectionRun = runTool({ allowanceSpec: allowanceOf({ externalEdgeRuleList: [{ ...CLEAN_EXTERNAL_EDGE_RULE_LIST[0], section: 'bridgeEdges' }] }), candidateCensus: CANDIDATE_CENSUS });
harness.match('(e) unknown section is refused', badSectionRun.outputText, /REFUSED: .*X1.*section 'bridgeEdges'/);
const badSideRun = runTool({ allowanceSpec: allowanceOf({ externalEdgeRuleList: [{ ...CLEAN_EXTERNAL_EDGE_RULE_LIST[0], side: 'both' }] }), candidateCensus: CANDIDATE_CENSUS });
harness.match('(e) unknown side is refused', badSideRun.outputText, /REFUSED: .*X1.*side 'both'/);

fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
harness.report();
