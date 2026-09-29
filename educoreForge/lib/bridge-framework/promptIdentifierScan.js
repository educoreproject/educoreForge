'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// promptIdentifierScan.js — the IN-RUN blinding scan (SPEC-sifStructuralBridge-replacement §9 A14/A19; PLAN
// small phases §3 B1). Before a judged subject's question reaches the judge, every text the judge would be shown
// is scanned for a CEDS identifier, and ONE hit refuses the whole run by name, naming the subject and the pattern.
//
//   TOOL_TEXT_RENDERER_BY_PREDICATE_RULE             predicateRule → ({ choiceEnum }) → the tool text for that rule
//   declarationReason(value)                         the contract row's shape check → '' | reason
//   identifierListFilePathFor({ identifierListPath, forgesDirPath, standardKey }) → absolute path
//   readIdentifierList({ filePath })                 → identifierList
//   compileScan({ scanDeclaration, identifierList }) → { compiledScan }
//   questionSurfaceTextByName({ predicateRule, question }) → { systemPrompt, userPrompt, toolText }
//   scanSurfaces({ compiledScan, surfaceTextByName })  → { hit: null } | { hit: { surfaceName, patternName, matchedText } }
//
// THE RE-ASK PROMPT IS SCANNED TOO (EBONY_DREAM, B1). The one bounded rationale re-ask (judgeComponent) sends the
// original user prompt plus a canned instruction plus the judge's own previous rationale; the caller scans that text
// as the surface 'reaskUserPrompt' before it is sent. Every prompt the judge is sent passes through scanSurfaces.
//
// WHAT IT BANS, AND WHAT IT DELIBERATELY DOES NOT. Identifiers only (TQ, 2026-09-28, A19): the plugin's declared
// patterns (a CEDS-hub plugin declares P\d{6} and C\d{6}) and the ids in its declared list file. There is no word list. The word
// "CEDS" reveals nothing about which card is the answer, and the shared tool description uses it legitimately.
//
// WHY THE TOOL TEXT IS RENDERED HERE RATHER THAN READ FROM THE CLIENT. The debug judge never builds a schema at all,
// so a scan that read "what the client sent" would scan nothing under the debug judge and something else under the
// real one: a debug run could be green and the paid run refused (front-gate review #6). The tool text is therefore
// taken from selectCandidateSchema's rendering for the run's DECLARED predicate rule, in EVERY
// dialect the schema module knows, so what is scanned does not depend on which provider is active.
//
// WHY A LIST ID MATCHES ONLY BETWEEN ALPHANUMERIC BOUNDARIES. A list may hold bare six-digit ids such as 000505.
// A bare substring match would also fire inside P000505 (which the P pattern already names correctly) and inside any
// longer run of digits, where it names nothing. The boundary makes a list hit mean "this id, standing alone".
//
// PURE and synchronous. It returns a hit or none; the orchestration side builds the refusal and hands it to its callback.

const path = require('path');
const fs = require('fs');
const { renderSelectCandidateSchema, renderSelectCandidateSchemaForPredicateRule, SCHEMA_DIALECT_NAME_LIST } = require(path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'selectCandidateSchema'));

const IDENTIFIER_LIST_PATTERN_NAME = 'identifierList';
const SCAN_DECLARATION_MEMBER_LIST = Object.freeze(['identifierPatternList', 'identifierListPath']);
const PATTERN_ROW_MEMBER_LIST = Object.freeze(['patternName', 'regexSource']);

// TOOL_TEXT_RENDERER_BY_PREDICATE_RULE — one row per predicate rule whose judge answers through a tool schema. The
// rule is the key because the schema is the rule's: judgeSlot-v1's schema carries the predicate slot. The text is
// every dialect's rendering, each on its own line under its dialect name. A rule with no row here fails at the first
// judged subject with a TypeError (B1 back-gate ruling: no guard), so a new rule adds its row with its schema.
const TOOL_TEXT_RENDERER_BY_PREDICATE_RULE = Object.freeze({
	'categoryTable-v1': ({ choiceEnum }) => SCHEMA_DIALECT_NAME_LIST.map((oneDialectName) => `${oneDialectName}: ${JSON.stringify(renderSelectCandidateSchema(oneDialectName, { choiceEnum }))}`).join('\n'),
	'judgeSlot-v1': ({ choiceEnum }) => SCHEMA_DIALECT_NAME_LIST.map((oneDialectName) => `${oneDialectName}: ${JSON.stringify(renderSelectCandidateSchemaForPredicateRule(oneDialectName, { choiceEnum, predicateRule: 'judgeSlot-v1' }))}`).join('\n'),
});

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const escapeRegexText = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const isPatternRow = (patternRow) =>
	isPlainObject(patternRow) && Object.keys(patternRow).length === PATTERN_ROW_MEMBER_LIST.length && PATTERN_ROW_MEMBER_LIST.every((oneName) => isNonEmptyString(patternRow[oneName]));

// declarationReason — the contract row's SHAPE check, the same as any other optional key's (absent = no scan, behaviour
// unchanged). It does not second-guess the values: this is our own declaration, and a pattern that does not compile or a
// list file that is not there fails loudly on its own the first time the run reaches it (EBONY_DREAM, B1 back-gate).
const declarationReason = (value) => {
	if (!isPlainObject(value) || Object.keys(value).length !== SCAN_DECLARATION_MEMBER_LIST.length || !SCAN_DECLARATION_MEMBER_LIST.every((oneName) => Object.prototype.hasOwnProperty.call(value, oneName))) {
		return `must be exactly { identifierPatternList, identifierListPath } (got ${JSON.stringify(value)})`;
	}
	if (!Array.isArray(value.identifierPatternList) || !value.identifierPatternList.every(isPatternRow)) {
		return `identifierPatternList must be a list of { patternName, regexSource }, both non-empty strings (got ${JSON.stringify(value.identifierPatternList)})`;
	}
	if (value.identifierListPath !== null && !isNonEmptyString(value.identifierListPath)) {
		return `identifierListPath must be a path to a JSON list of identifiers, or null to declare none (got ${JSON.stringify(value.identifierListPath)})`;
	}
	return '';
};

// identifierListFilePathFor — RELATIVE TO THE PLUGIN'S OWN FORGE BUNDLE, exactly as subjectSource.scopeStableIdListPath
// is: the list travels with the plugin, and a machine-specific absolute path would make its declaration digest
// machine-specific. An absolute path is honoured for a list that genuinely lives outside the bundle.
const identifierListFilePathFor = ({ identifierListPath, forgesDirPath, standardKey }) =>
	path.isAbsolute(identifierListPath) ? identifierListPath : path.join(forgesDirPath, standardKey, identifierListPath);

// readIdentifierList — the list file is a JSON array of identifier strings, read once per run
const readIdentifierList = ({ filePath }) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

// compileScan — the declared patterns (already proven to compile by the contract) plus ONE alternation over the list
// ids, bounded on both sides by a non-alphanumeric (see the header). identifierList is null when no list is declared.
const compileScan = ({ scanDeclaration, identifierList }) => {
	const compiledPatternList = scanDeclaration.identifierPatternList.map((onePatternRow) => ({ patternName: onePatternRow.patternName, regex: new RegExp(onePatternRow.regexSource) }));
	if (identifierList !== null) {
		const alternationText = identifierList
			.slice()
			.sort((leftIdentifier, rightIdentifier) => rightIdentifier.length - leftIdentifier.length)
			.map(escapeRegexText)
			.join('|');
		compiledPatternList.push({ patternName: IDENTIFIER_LIST_PATTERN_NAME, regex: new RegExp(`(?<![A-Za-z0-9])(?:${alternationText})(?![A-Za-z0-9])`) });
	}
	return { compiledScan: { compiledPatternList } };
};

// questionSurfaceTextByName — the three texts a rendered question shows the judge, in scan order
const questionSurfaceTextByName = ({ predicateRule, question }) => ({
	systemPrompt: question.systemPrompt,
	userPrompt: question.userPrompt,
	toolText: TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule]({ choiceEnum: question.choiceEnum }),
});

// scanSurfaces — the first hit, walking the surfaces in the map's own order and the patterns in declared order
const scanSurfaces = ({ compiledScan, surfaceTextByName }) => {
	const surfaceNameList = Object.keys(surfaceTextByName);
	for (let surfaceIndex = 0; surfaceIndex < surfaceNameList.length; surfaceIndex++) {
		const surfaceName = surfaceNameList[surfaceIndex];
		for (let patternIndex = 0; patternIndex < compiledScan.compiledPatternList.length; patternIndex++) {
			const onePattern = compiledScan.compiledPatternList[patternIndex];
			const match = onePattern.regex.exec(surfaceTextByName[surfaceName]);
			if (match !== null) {
				return { hit: { surfaceName, patternName: onePattern.patternName, matchedText: match[0] } };
			}
		}
	}
	return { hit: null };
};

module.exports = {
	IDENTIFIER_LIST_PATTERN_NAME,
	TOOL_TEXT_RENDERER_BY_PREDICATE_RULE,
	declarationReason,
	identifierListFilePathFor,
	readIdentifierList,
	compileScan,
	questionSurfaceTextByName,
	scanSurfaces,
	moduleName,
};
