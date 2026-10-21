'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hub-literal-census.js — how often a hub's NAME appears in the tree outside that hub's own forge bundle, by class (R0 proof
// kit, 2026-10-21, step 9). The hub token is an ARGUMENT; nothing here names a hub. Each later phase of the lane must not
// raise the 'code' count; the last phase drives it to a justified residue.
//
// WHAT IS COUNTED: tracked files only (git ls-files), outside forges/<hubToken>/, binary files skipped. An OCCURRENCE is the
// token, case-insensitive, that STARTS a name: preceded by a non-letter, by the regex escape \b, or capitalised mid-word
// (edfiHubxDerived, for a hub token hubx). A lower-case run inside another word (referencedStableId, DisplacedStudent) is not the hub's name and is
// not counted; the few words that start with the token and are still not the hub are declared in the rules file.
//
// CLASSES: hubLiteralCensusRules.json classRuleList, first match wins over the tree-relative path. A .js file in class
// 'source' is split per occurrence: inside a // or /* */ comment → 'comments', anywhere else (code or a string literal,
// which is runtime text) → 'code'. The split is a character scan that tracks quotes, template literals and comments; a
// regular-expression literal containing a quote can mislead it (code estimation: none is known to sit near the token).
//
//   occurrenceIndexListIn({ lineText, hubToken, falsePositiveWordList }) → [index]
//   jsOccurrenceSplitFor({ fileText, hubToken, falsePositiveWordList })   → [{ lineNumber, codeCount, commentCount }]
//   classNameForPath({ relativePath, classRuleList })                     → className
//   censusOfTree({ treeRootPath, hubToken, rules })                       → { census } | { error }

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RULES_FILE_PATH = path.join(__dirname, 'hubLiteralCensusRules.json');
const SOURCE_CLASS_NAME = 'source';
const isLetter = (character) => /[A-Za-z]/.test(character || '');
const isWordCharacter = (character) => /[A-Za-z0-9_]/.test(character || '');

const wordAround = (lineText, index) => {
	let startIndex = index;
	while (startIndex > 0 && isWordCharacter(lineText[startIndex - 1])) {
		startIndex -= 1;
	}
	let endIndex = index;
	while (endIndex < lineText.length && isWordCharacter(lineText[endIndex])) {
		endIndex += 1;
	}
	return lineText.slice(startIndex, endIndex);
};

const occurrenceIndexListIn = ({ lineText, hubToken, falsePositiveWordList }) => {
	const lowerLine = lineText.toLowerCase();
	const lowerToken = hubToken.toLowerCase();
	const indexList = [];
	let searchFrom = lowerLine.indexOf(lowerToken);
	while (searchFrom !== -1) {
		const previousCharacter = lineText[searchFrom - 1];
		const startsName = !isLetter(previousCharacter) || lineText.slice(searchFrom - 2, searchFrom) === '\\b' || lineText[searchFrom] === lineText[searchFrom].toUpperCase();
		if (startsName && falsePositiveWordList.indexOf(wordAround(lineText, searchFrom)) === -1) {
			indexList.push(searchFrom);
		}
		searchFrom = lowerLine.indexOf(lowerToken, searchFrom + 1);
	}
	return indexList;
};

// the state each character of a .js text is read in; the scan carries it across lines (block comments, template literals)
const SCAN_STATE_CODE = 'code';
const SCAN_STATE_LINE_COMMENT = 'lineComment';
const SCAN_STATE_BLOCK_COMMENT = 'blockComment';
const QUOTE_STATE_BY_CHARACTER = { "'": 'singleQuote', '"': 'doubleQuote', '`': 'template' };
const QUOTE_CHARACTER_BY_STATE = { singleQuote: "'", doubleQuote: '"', template: '`' };
const COMMENT_STATE_LIST = [SCAN_STATE_LINE_COMMENT, SCAN_STATE_BLOCK_COMMENT];

const jsOccurrenceSplitFor = ({ fileText, hubToken, falsePositiveWordList }) => {
	const resultList = [];
	let state = SCAN_STATE_CODE;
	fileText.split('\n').forEach((lineText, lineIndex) => {
		const stateAtIndex = [];
		if (state === SCAN_STATE_LINE_COMMENT) {
			state = SCAN_STATE_CODE;
		}
		for (let characterIndex = 0; characterIndex < lineText.length; characterIndex++) {
			const character = lineText[characterIndex];
			const nextCharacter = lineText[characterIndex + 1];
			stateAtIndex[characterIndex] = state;
			if (state === SCAN_STATE_CODE) {
				if (character === '/' && nextCharacter === '/') {
					state = SCAN_STATE_LINE_COMMENT;
					stateAtIndex[characterIndex] = state;
				} else if (character === '/' && nextCharacter === '*') {
					state = SCAN_STATE_BLOCK_COMMENT;
					stateAtIndex[characterIndex] = state;
					characterIndex += 1;
					stateAtIndex[characterIndex] = state;
				} else if (QUOTE_STATE_BY_CHARACTER[character] !== undefined) {
					state = QUOTE_STATE_BY_CHARACTER[character];
				}
			} else if (state === SCAN_STATE_BLOCK_COMMENT) {
				if (character === '*' && nextCharacter === '/') {
					characterIndex += 1;
					stateAtIndex[characterIndex] = state;
					state = SCAN_STATE_CODE;
				}
			} else if (QUOTE_CHARACTER_BY_STATE[state] !== undefined) {
				if (character === '\\') {
					characterIndex += 1;
					stateAtIndex[characterIndex] = state;
				} else if (character === QUOTE_CHARACTER_BY_STATE[state]) {
					state = SCAN_STATE_CODE;
				}
			}
		}
		// an unterminated plain quote ends with its line; a template literal and a block comment carry on
		if (state === 'singleQuote' || state === 'doubleQuote') {
			state = SCAN_STATE_CODE;
		}
		const occurrenceIndexList = occurrenceIndexListIn({ lineText, hubToken, falsePositiveWordList });
		if (occurrenceIndexList.length === 0) {
			return;
		}
		const commentCount = occurrenceIndexList.filter((oneIndex) => COMMENT_STATE_LIST.indexOf(stateAtIndex[oneIndex]) !== -1).length;
		resultList.push({ lineNumber: lineIndex + 1, codeCount: occurrenceIndexList.length - commentCount, commentCount });
	});
	return resultList;
};

const classNameForPath = ({ relativePath, classRuleList }) => {
	const matchedRule = classRuleList.find((oneRule) => oneRule.pathPatternList.some((onePattern) => new RegExp(onePattern).test(relativePath)));
	if (matchedRule === undefined) {
		throw new Error(`${moduleName}: no classRuleList row matches '${relativePath}'; the rules end with a catch-all row, so the rules file is malformed`);
	}
	return matchedRule.className;
};

const readRules = () => JSON.parse(fs.readFileSync(RULES_FILE_PATH, 'utf8'));

const emptyCount = () => ({ lineCount: 0, occurrenceCount: 0, fileCount: 0 });

const censusOfTree = ({ treeRootPath, hubToken, rules } = {}) => {
	if (typeof hubToken !== 'string' || !/^[a-z][a-z0-9]*$/.test(hubToken)) {
		return { error: `${moduleName}: hubToken ${JSON.stringify(hubToken)} is not a lower-case bundle token` };
	}
	if (typeof treeRootPath !== 'string' || !fs.existsSync(path.join(treeRootPath, 'forges', hubToken))) {
		return { error: `${moduleName}: ${JSON.stringify(treeRootPath)} holds no forges/${hubToken}/ — the census counts outside an EXISTING hub bundle` };
	}
	const listed = spawnSync('git', ['-C', treeRootPath, 'ls-files', '-z', '--', '.'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	if (listed.status !== 0) {
		return { error: `${moduleName}: git ls-files in ${treeRootPath} failed: ${listed.stderr}` };
	}
	const excludedPrefix = `forges/${hubToken}/`;
	const relativePathList = listed.stdout.split('\0').filter((onePath) => onePath !== '' && !onePath.startsWith(excludedPrefix)).sort();
	const countByClass = rules.countedClassNameList.reduce((soFar, className) => ({ ...soFar, [className]: emptyCount() }), {});
	const occurrenceListByClass = rules.countedClassNameList.reduce((soFar, className) => ({ ...soFar, [className]: [] }), {});
	const addTo = (className, relativePath, lineNumber, occurrenceCount) => {
		countByClass[className].lineCount += 1;
		countByClass[className].occurrenceCount += occurrenceCount;
		occurrenceListByClass[className].push(`${relativePath}:${lineNumber}`);
	};
	relativePathList.forEach((relativePath) => {
		const absolutePath = path.join(treeRootPath, relativePath);
		if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
			return;
		}
		const fileBytes = fs.readFileSync(absolutePath);
		if (fileBytes.indexOf(0) !== -1) {
			return;
		}
		const fileText = fileBytes.toString('utf8');
		if (fileText.toLowerCase().indexOf(hubToken) === -1) {
			return;
		}
		const pathClassName = classNameForPath({ relativePath, classRuleList: rules.classRuleList });
		const touchedClassSet = new Set();
		if (pathClassName === SOURCE_CLASS_NAME) {
			jsOccurrenceSplitFor({ fileText, hubToken, falsePositiveWordList: rules.falsePositiveWordList }).forEach((oneLine) => {
				if (oneLine.codeCount > 0) {
					addTo('code', relativePath, oneLine.lineNumber, oneLine.codeCount);
					touchedClassSet.add('code');
				}
				if (oneLine.commentCount > 0) {
					addTo('comments', relativePath, oneLine.lineNumber, oneLine.commentCount);
					touchedClassSet.add('comments');
				}
			});
		} else {
			fileText.split('\n').forEach((lineText, lineIndex) => {
				const occurrenceCount = occurrenceIndexListIn({ lineText, hubToken, falsePositiveWordList: rules.falsePositiveWordList }).length;
				if (occurrenceCount > 0) {
					addTo(pathClassName, relativePath, lineIndex + 1, occurrenceCount);
					touchedClassSet.add(pathClassName);
				}
			});
		}
		touchedClassSet.forEach((className) => {
			countByClass[className].fileCount += 1;
		});
	});
	return { census: { hubToken, excludedDirectory: excludedPrefix, trackedFileCount: relativePathList.length, countByClass, occurrenceListByClass } };
};

module.exports = { occurrenceIndexListIn, jsOccurrenceSplitFor, classNameForPath, censusOfTree, readRules, RULES_FILE_PATH, moduleName };
