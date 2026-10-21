'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// structuralProducerContract.js — ⟪ctdlHub-101926 P6, ruling R-3⟫ the contract of a STRUCTURAL producer: the second module shape
// pluginRegistry admits under forges/<standardKey>/bridges/, beside the bridge plugin. A structural producer relates the terms of
// a FAMILY of standards to one another structurally (HAS_PROPERTY, REFERENCES, SUBCLASS_OF, HAS_OPTION_SET across standards), by
// a same-IRI identity join over the family's own crossRefs and a declared LOCATOR TABLE. It judges nothing, maps toward no hub,
// freezes no decision block, and emits one pair-scoped block per family pair that has edges (TQ ruling 2026-07-26). It is pure
// DATA, like a derived plugin: the algorithm is the framework's (structuralRunner.js); the family and its table are the plugin's.
//
//   module.exports = { structuralDeclaration }
//   structuralDeclaration = {
//     producerName            lowerCamel; the recipe's bridges[].bridge, and the provenanceSource stamped on every edge
//     standardKey             the bundle it sits under (the family root's token), as a bridge plugin's standardKey is
//     producerVersion         non-empty
//     familyStandardKeyList   the family's recipe tokens, at least two, distinct, lowercase; the recipe's familyStandards
//                             must name exactly these
//     familyRootStandardKey   one of them: pairs are ordered root first, then lexicographically (S11)
//     locatorTablePath        a path RELATIVE to the bundle (e.g. bridgeData/ctdlFamilyLocatorTable.json) to the ONE locator table
//   }
//   validateStructuralDeclaration({ structuralDeclaration, bundleDirPath }) → { locatorTable } | { error }
//   locatorTableRefusal(locatorTable) → '' | the reason (a locator in both lists, an unknown edge type or direction, …)

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const STRUCTURAL_DECLARATION_KEY_LIST = Object.freeze(['producerName', 'standardKey', 'producerVersion', 'familyStandardKeyList', 'familyRootStandardKey', 'locatorTablePath']);
// the structural edge types a family table may name: the four July wrote across the CTDL family (oracle census), each a
// vocabulary EDGE_TYPES row, read at call time
const STRUCTURAL_EDGE_TYPE_NAME_LIST = Object.freeze(['HAS_PROPERTY', 'REFERENCES', 'SUBCLASS_OF', 'HAS_OPTION_SET']);
// which end of the crossRef the edge leaves from: the node that carries it (sourceToTarget) or the node it names (targetToSource)
const STRUCTURAL_DIRECTION_LIST = Object.freeze(['sourceToTarget', 'targetToSource']);
const LOCATOR_TABLE_KEY_LIST = Object.freeze(['tableNote', 'structureLocatorList', 'correspondenceLocatorList']);
const LOCATOR_PATTERN = /^[a-z][A-Za-z0-9]*:[A-Za-z][A-Za-z0-9]*$/;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const locatorTableRefusal = (locatorTable) => {
	if (!isPlainObject(locatorTable)) {
		return 'the locator table is not a JSON object';
	}
	const unknownKey = Object.keys(locatorTable).find((oneName) => LOCATOR_TABLE_KEY_LIST.indexOf(oneName) === -1);
	if (unknownKey !== undefined) {
		return `the locator table carries unknown key '${unknownKey}' (its keys are ${LOCATOR_TABLE_KEY_LIST.join(', ')})`;
	}
	const { structureLocatorList, correspondenceLocatorList } = locatorTable;
	if (!Array.isArray(structureLocatorList) || structureLocatorList.length === 0 || !Array.isArray(correspondenceLocatorList)) {
		return 'the locator table needs a non-empty structureLocatorList and a correspondenceLocatorList';
	}
	const { EDGE_TYPES } = vocabularyLib;
	const badRow = structureLocatorList.find((oneRow) => !isPlainObject(oneRow) || !LOCATOR_PATTERN.test(String(oneRow.locator)) || STRUCTURAL_EDGE_TYPE_NAME_LIST.indexOf(oneRow.edgeType) === -1 || EDGE_TYPES[oneRow.edgeType] !== oneRow.edgeType || STRUCTURAL_DIRECTION_LIST.indexOf(oneRow.direction) === -1);
	if (badRow !== undefined) {
		return `structure row ${JSON.stringify(badRow)} is not { locator: <CURIE>, edgeType: ${STRUCTURAL_EDGE_TYPE_NAME_LIST.join('|')}, direction: ${STRUCTURAL_DIRECTION_LIST.join('|')} }`;
	}
	const badCorrespondence = correspondenceLocatorList.find((oneLocator) => !LOCATOR_PATTERN.test(String(oneLocator)));
	if (badCorrespondence !== undefined) {
		return `correspondence locator ${JSON.stringify(badCorrespondence)} is not a CURIE`;
	}
	const structureLocatorNameList = structureLocatorList.map((oneRow) => oneRow.locator);
	if (new Set(structureLocatorNameList).size !== structureLocatorNameList.length || new Set(correspondenceLocatorList).size !== correspondenceLocatorList.length) {
		return 'a locator is listed twice in one list';
	}
	const inBoth = structureLocatorNameList.find((oneLocator) => correspondenceLocatorList.indexOf(oneLocator) !== -1);
	return inBoth === undefined ? '' : `locator '${inBoth}' is in BOTH lists; ONE table says which source keys are structure and which are correspondence`;
};

const validateStructuralDeclaration = ({ structuralDeclaration, bundleDirPath } = {}) => {
	const refuseWith = (what) => ({ error: refuse.byName({ moduleName, what, where: 'structuralProducerContract: { producerName, standardKey, producerVersion, familyStandardKeyList, familyRootStandardKey, locatorTablePath }' }) });
	if (!isPlainObject(structuralDeclaration)) {
		return refuseWith(`structuralDeclaration is ${structuralDeclaration === null ? 'null' : `a ${typeof structuralDeclaration}`}`);
	}
	const unknownKey = Object.keys(structuralDeclaration).find((oneName) => STRUCTURAL_DECLARATION_KEY_LIST.indexOf(oneName) === -1);
	if (unknownKey !== undefined) {
		return refuseWith(`structuralDeclaration carries unknown key '${unknownKey}'`);
	}
	const missingKey = STRUCTURAL_DECLARATION_KEY_LIST.find((oneName) => structuralDeclaration[oneName] === undefined);
	if (missingKey !== undefined) {
		return refuseWith(`structuralDeclaration is missing '${missingKey}'; nothing is defaulted`);
	}
	const { producerName, standardKey, producerVersion, familyStandardKeyList, familyRootStandardKey, locatorTablePath } = structuralDeclaration;
	if (!/^[a-z][A-Za-z0-9]*$/.test(String(producerName)) || !isNonEmptyString(producerVersion) || !isNonEmptyString(standardKey) || standardKey !== standardKey.toLowerCase()) {
		return refuseWith(`producerName must be lowerCamel, standardKey lowercase, producerVersion non-empty (got ${JSON.stringify({ producerName, standardKey, producerVersion })})`);
	}
	if (!Array.isArray(familyStandardKeyList) || familyStandardKeyList.length < 2 || new Set(familyStandardKeyList).size !== familyStandardKeyList.length || familyStandardKeyList.some((oneKey) => !isNonEmptyString(oneKey) || oneKey !== oneKey.toLowerCase())) {
		return refuseWith(`familyStandardKeyList must list at least two distinct lowercase tokens (got ${JSON.stringify(familyStandardKeyList)})`);
	}
	if (familyStandardKeyList.indexOf(familyRootStandardKey) === -1 || familyRootStandardKey !== standardKey) {
		return refuseWith(`familyRootStandardKey '${familyRootStandardKey}' must be a family member and the bundle the producer sits under ('${standardKey}')`);
	}
	if (!isNonEmptyString(locatorTablePath) || path.isAbsolute(locatorTablePath)) {
		return refuseWith(`locatorTablePath must be a path relative to the bundle (got ${JSON.stringify(locatorTablePath)}); an absolute path would make the producer machine-specific`);
	}
	const tableFilePath = path.join(bundleDirPath, locatorTablePath);
	if (!fs.existsSync(tableFilePath)) {
		return refuseWith(`locatorTablePath names no file at ${tableFilePath}`);
	}
	// JSON.parse throws on malformed text; the throw is translated ONCE, here, into a refusal by name (the boundary
	// dispensation the plugin files take for JSON.parse), never used as control flow
	let locatorTable = null;
	let parseFault = '';
	try {
		locatorTable = JSON.parse(fs.readFileSync(tableFilePath, 'utf8'));
	} catch (parseError) {
		parseFault = parseError.message;
	}
	if (parseFault !== '') {
		return refuseWith(`the locator table at ${tableFilePath} is not parseable JSON (${parseFault})`);
	}
	const tableReason = locatorTableRefusal(locatorTable);
	return tableReason === '' ? { locatorTable, locatorTableFilePath: tableFilePath } : refuseWith(`${tableFilePath}: ${tableReason}`);
};

module.exports = { validateStructuralDeclaration, locatorTableRefusal, STRUCTURAL_DECLARATION_KEY_LIST, STRUCTURAL_EDGE_TYPE_NAME_LIST, STRUCTURAL_DIRECTION_LIST, moduleName };
