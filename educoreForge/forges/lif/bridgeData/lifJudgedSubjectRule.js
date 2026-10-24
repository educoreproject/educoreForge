'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// lifJudgedSubjectRule.js — the rule that writes bridges/lifJudgedSubjects.json (nextStandards-102326 C2, 2026-10-24): a LifProperty is judged
// unless its judge-visible text (the facet's subjectRenderingAllowList fields) carries an identifier of a PAIRED hub, by that hub's OWN
// declared prompt identifier scan (lib/bridge-framework/promptIdentifierScan.js). The framework refuses such a subject at render time
// (SPEC A19); this rule finds the same subjects before a run, so the scope file is derived, never hand-kept, and a test can prove the
// committed file is the rule's output. It lives in bridgeData/, not bridges/: every .js under bridges/ must be a plugin (pluginRegistry
// refuses anything else, measured). PURE apart from reading each hub's declared identifier list file.

const path = require('path');

const FORGES_DIR_PATH = path.join(__dirname, '..', '..');
const scanLib = require(path.join(FORGES_DIR_PATH, '..', 'lib', 'bridge-framework', 'promptIdentifierScan'));
const hubPairing = require(path.join(__dirname, '..', 'bridges', 'lifHubPairing.json'));
const { standardBridging } = require(path.join(__dirname, '..', 'bridges', 'lifBridging'));

const renderedFieldList = standardBridging.facetList[0].subjectRenderingAllowList;

// compiledScanByHub — each paired hub's declared scan, compiled once
const compiledScanByHub = () => hubPairing.judgedHubTokenList.reduce((byHub, hubToken) => {
	const { hubBridging } = require(path.join(FORGES_DIR_PATH, hubToken, 'lib', `${hubToken}HubBridging.js`));
	const scanDeclaration = hubBridging.promptIdentifierScan;
	const identifierList = scanDeclaration.identifierListPath === null ? null : scanLib.readIdentifierList({ filePath: path.join(FORGES_DIR_PATH, hubToken, scanDeclaration.identifierListPath) });
	return { ...byHub, [hubToken]: scanLib.compileScan({ scanDeclaration, identifierList }).compiledScan };
}, {});

// judgedSubjectsOf — { judgedStableIdList (sorted), excludedList: [{ stableId, hubToken, patternName, matchedText }] } over forged nodes
const judgedSubjectsOf = ({ nodeList }) => {
	const scanByHub = compiledScanByHub();
	const excludedList = [];
	const judgedStableIdList = nodeList.filter((oneNode) => oneNode.role === 'DmeProperty').filter((oneNode) => {
		const surfaceTextByName = { subjectText: renderedFieldList.map((fieldName) => `${fieldName}: ${oneNode.properties[fieldName] === undefined ? '' : oneNode.properties[fieldName]}`).join('\n') };
		const hitList = Object.keys(scanByHub).map((hubToken) => ({ hubToken, hit: scanLib.scanSurfaces({ compiledScan: scanByHub[hubToken], surfaceTextByName }).hit })).filter((oneResult) => oneResult.hit !== null);
		hitList.forEach((oneResult) => excludedList.push({ stableId: oneNode.stableId, hubToken: oneResult.hubToken, patternName: oneResult.hit.patternName, matchedText: oneResult.hit.matchedText }));
		return hitList.length === 0;
	}).map((oneNode) => oneNode.stableId).sort();
	return { judgedStableIdList, excludedList };
};

module.exports = { judgedSubjectsOf, moduleName };
