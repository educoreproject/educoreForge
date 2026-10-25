'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// medbiqJudgedSubjectRule.js — the rule that writes bridges/medbiqJudgedSubjects.json (nextStandards wave 3 lane I2, 2026-10-25; the LIF C2
// lifJudgedSubjectRule.js form). A MedbiqField is judged when two things hold:
//   1. its schemaFile is on bridgeData/medbiqJudgedScope.json (Phase 0 ruling 6: the current-version files; not the legacy v1 libraries,
//      not the IEEE LOM binding, not journaltypes);
//   2. its judge-visible text (the facet's subjectRenderingAllowList fields) carries no identifier of a PAIRED hub, by that hub's OWN declared
//      prompt identifier scan (lib/bridge-framework/promptIdentifierScan.js). The framework refuses such a subject at render time (SPEC A19);
//      this rule finds the same subjects before a run.
// So the scope file is derived, never hand-kept, and a test proves the committed file is the rule's output. It lives in bridgeData/, not
// bridges/: every .js under bridges/ must be a plugin. PURE apart from reading each hub's declared identifier list file.

const path = require('path');

const FORGES_DIR_PATH = path.join(__dirname, '..', '..');
const scanLib = require(path.join(FORGES_DIR_PATH, '..', 'lib', 'bridge-framework', 'promptIdentifierScan'));
const hubPairing = require(path.join(__dirname, '..', 'bridges', 'medbiqHubPairing.json'));
const judgedScope = require(path.join(__dirname, 'medbiqJudgedScope.json'));
const { standardBridging } = require(path.join(__dirname, '..', 'bridges', 'medbiqBridging'));

const renderedFieldList = standardBridging.facetList[0].subjectRenderingAllowList;

// compiledScanByHub — each paired hub's declared scan, compiled once
const compiledScanByHub = () => hubPairing.judgedHubTokenList.reduce((byHub, hubToken) => {
	const { hubBridging } = require(path.join(FORGES_DIR_PATH, hubToken, 'lib', `${hubToken}HubBridging.js`));
	const scanDeclaration = hubBridging.promptIdentifierScan;
	const identifierList = scanDeclaration.identifierListPath === null ? null : scanLib.readIdentifierList({ filePath: path.join(FORGES_DIR_PATH, hubToken, scanDeclaration.identifierListPath) });
	return { ...byHub, [hubToken]: scanLib.compileScan({ scanDeclaration, identifierList }).compiledScan };
}, {});

// judgedSubjectsOf — { judgedStableIdList (sorted), outOfScopeCount, excludedList: [{ stableId, hubToken, patternName, matchedText }] }
const judgedSubjectsOf = ({ nodeList }) => {
	const scanByHub = compiledScanByHub();
	const excludedList = [];
	const fieldNodeList = nodeList.filter((oneNode) => oneNode.role === 'DmeProperty');
	const scopedNodeList = fieldNodeList.filter((oneNode) => judgedScope.judgedSchemaFileList.indexOf(oneNode.properties.schemaFile) !== -1);
	const judgedStableIdList = scopedNodeList.filter((oneNode) => {
		const surfaceTextByName = { subjectText: renderedFieldList.map((fieldName) => `${fieldName}: ${oneNode.properties[fieldName] === undefined ? '' : oneNode.properties[fieldName]}`).join('\n') };
		const hitList = Object.keys(scanByHub).map((hubToken) => ({ hubToken, hit: scanLib.scanSurfaces({ compiledScan: scanByHub[hubToken], surfaceTextByName }).hit })).filter((oneResult) => oneResult.hit !== null);
		hitList.forEach((oneResult) => excludedList.push({ stableId: oneNode.stableId, hubToken: oneResult.hubToken, patternName: oneResult.hit.patternName, matchedText: oneResult.hit.matchedText }));
		return hitList.length === 0;
	}).map((oneNode) => oneNode.stableId).sort();
	return { judgedStableIdList, outOfScopeCount: fieldNodeList.length - scopedNodeList.length, excludedList };
};

module.exports = { judgedSubjectsOf, moduleName };
