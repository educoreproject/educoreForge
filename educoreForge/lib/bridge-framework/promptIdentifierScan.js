'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// promptIdentifierScan.js — the IN-RUN blinding scan (SPEC-sifStructuralBridge-replacement §9 A14/A19; PLAN
// small phases §3 B1). Before a judged subject's question reaches the judge, every text the judge would be shown
// is scanned for a CEDS identifier, and ONE hit refuses the whole run by name, naming the subject and the pattern.
//
//   TOOL_TEXT_RENDERER_BY_PREDICATE_RULE             predicateRule → ({ choiceEnum }) → the tool text for that rule
//   declarationReason(value, { bridgeDeclaration })  the contract row's checker → '' | reason
//   identifierListFilePathFor({ identifierListPath, forgesDirPath, standardKey }) → absolute path
//   readIdentifierList({ filePath })                 → { identifierList } | { error }
//   compileScan({ scanDeclaration, identifierList }) → { compiledScan }  (the contract has already proven each pattern compiles)
//   questionSurfaceTextByName({ predicateRule, question }) → { systemPrompt, userPrompt, toolText }
//   scanSurfaces({ compiledScan, surfaceTextByName })  → { hit: null } | { hit: { surfaceName, patternName, matchedText } }
//
// THE RE-ASK PROMPT IS SCANNED TOO (EBONY_DREAM, B1). The one bounded rationale re-ask (judgeComponent) sends the
// original user prompt plus a canned instruction plus the judge's own previous rationale; the caller scans that text
// as the surface 'reaskUserPrompt' before it is sent. Every prompt the judge is sent passes through scanSurfaces.
//
// WHAT IT BANS, AND WHAT IT DELIBERATELY DOES NOT. Identifiers only (TQ, 2026-09-28, A19): the plugin's declared
// patterns (SIF declares P\d{6} and C\d{6}) and the ids in its declared list file. There is no word list. The word
// "CEDS" reveals nothing about which card is the answer, and the shared tool description uses it legitimately.
//
// WHY THE TOOL TEXT IS RENDERED HERE RATHER THAN READ FROM THE CLIENT. The debug judge never builds a schema at all,
// so a scan that read "what the client sent" would scan nothing under the debug judge and something else under the
// real one: a debug run could be green and the paid run refused (front-gate review #6). The tool text is therefore
// taken from selectCandidateSchema.renderSelectCandidateSchema for the run's DECLARED predicate rule, in EVERY
// dialect the schema module knows, so what is scanned does not depend on which provider is active.
//
// WHY A LIST ID MATCHES ONLY BETWEEN ALPHANUMERIC BOUNDARIES. The SIF list holds bare six-digit ids such as 000505.
// A bare substring match would also fire inside P000505 (which the P pattern already names correctly) and inside any
// longer run of digits, where it names nothing. The boundary makes a list hit mean "this id, standing alone".
//
// PURE and synchronous. Faults are RETURNED as values; the orchestration side hands them to its callback.

const path = require('path');
const fs = require('fs');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const decisionBlockLib = require('./decisionBlock');
const { renderSelectCandidateSchema, SCHEMA_DIALECT_NAME_LIST } = require(path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'selectCandidateSchema'));

const IDENTIFIER_LIST_PATTERN_NAME = 'identifierList';
const SCAN_DECLARATION_MEMBER_LIST = Object.freeze(['identifierPatternList', 'identifierListPath']);
const PATTERN_ROW_MEMBER_LIST = Object.freeze(['patternName', 'regexSource']);

// TOOL_TEXT_RENDERER_BY_PREDICATE_RULE — one row per predicate rule whose judge answers through a tool schema. The
// rule is the key because the schema is the rule's (B3a adds judgeSlot-v1 with its own schema). The text is every
// dialect's rendering, each on its own line under its dialect name.
const TOOL_TEXT_RENDERER_BY_PREDICATE_RULE = Object.freeze({
	'categoryTable-v1': ({ choiceEnum }) => SCHEMA_DIALECT_NAME_LIST.map((oneDialectName) => `${oneDialectName}: ${JSON.stringify(renderSelectCandidateSchema(oneDialectName, { choiceEnum }))}`).join('\n'),
});

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const escapeRegexText = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// compileRegexSource — the throw-to-value adapter for a plugin-declared pattern: RegExp throws on a bad source,
// and the declaration is data entering the framework, so the fault becomes a value here and a refusal upstream
const compileRegexSource = (regexSource) => {
	let regex = null;
	let compileFault = '';
	const attempt = () => {
		regex = new RegExp(regexSource);
	};
	try {
		attempt();
	} catch (compileError) {
		compileFault = compileError.message;
	}
	return compileFault ? { error: compileFault } : { regex };
};

const patternRowReason = (patternRow, rowIndex) => {
	if (!isPlainObject(patternRow)) {
		return `identifierPatternList[${rowIndex}] must be { patternName, regexSource } (got ${JSON.stringify(patternRow)})`;
	}
	const extra = Object.keys(patternRow).filter((oneName) => PATTERN_ROW_MEMBER_LIST.indexOf(oneName) === -1);
	if (extra.length) {
		return `identifierPatternList[${rowIndex}] carries unknown member '${extra[0]}'; the shape is exactly { patternName, regexSource }`;
	}
	if (!isNonEmptyString(patternRow.patternName) || patternRow.patternName === IDENTIFIER_LIST_PATTERN_NAME) {
		return `identifierPatternList[${rowIndex}].patternName must be a non-empty string other than '${IDENTIFIER_LIST_PATTERN_NAME}' (which names the list file in a refusal)`;
	}
	if (!isNonEmptyString(patternRow.regexSource)) {
		return `identifierPatternList[${rowIndex}] ('${patternRow.patternName}') regexSource must be a non-empty string`;
	}
	const compiled = compileRegexSource(patternRow.regexSource);
	if (compiled.error) {
		return `identifierPatternList[${rowIndex}] ('${patternRow.patternName}') regexSource ${JSON.stringify(patternRow.regexSource)} does not compile (${compiled.error})`;
	}
	if (compiled.regex.test('')) {
		return `identifierPatternList[${rowIndex}] ('${patternRow.patternName}') regexSource ${JSON.stringify(patternRow.regexSource)} matches the empty string, so it would refuse every prompt`;
	}
	return '';
};

// declarationReason — the contract row's checker. The key is plain-optional (absent = no scan, behaviour unchanged);
// PRESENT, it must be able to find something, and the run must have a predicate rule whose tool text it can render.
const declarationReason = (value, { bridgeDeclaration }) => {
	if (!isPlainObject(value)) {
		return `must be { identifierPatternList, identifierListPath } (got ${JSON.stringify(value)})`;
	}
	const extra = Object.keys(value).filter((oneName) => SCAN_DECLARATION_MEMBER_LIST.indexOf(oneName) === -1);
	if (extra.length) {
		return `carries unknown member '${extra[0]}'; the shape is exactly { identifierPatternList, identifierListPath }`;
	}
	if (!Array.isArray(value.identifierPatternList)) {
		return 'identifierPatternList must be a list of { patternName, regexSource } ([] is valid when a list file is declared; absent is refused)';
	}
	for (let rowIndex = 0; rowIndex < value.identifierPatternList.length; rowIndex++) {
		const rowReason = patternRowReason(value.identifierPatternList[rowIndex], rowIndex);
		if (rowReason) {
			return rowReason;
		}
	}
	const patternNameList = value.identifierPatternList.map((onePatternRow) => onePatternRow.patternName);
	const duplicateName = patternNameList.find((oneName, nameIndex) => patternNameList.indexOf(oneName) !== nameIndex);
	if (duplicateName !== undefined) {
		return `identifierPatternList names pattern '${duplicateName}' twice; a refusal names its pattern, so each name is used once`;
	}
	if (value.identifierListPath !== null && !isNonEmptyString(value.identifierListPath)) {
		return 'identifierListPath must be a path to a JSON list of identifiers, or null to declare none (absent is refused)';
	}
	if (value.identifierPatternList.length === 0 && value.identifierListPath === null) {
		return 'declares no pattern and no identifier list, so it could never find anything; a scan that cannot fire is not a scan (declare patterns, a list, or omit the key)';
	}
	const predicateSource = bridgeDeclaration.predicateSource;
	const predicateRule = isPlainObject(predicateSource) ? predicateSource.predicateRule : undefined;
	if (TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule] === undefined) {
		return `needs the run's declared predicateSource.predicateRule to name a tool text it can scan, and ${JSON.stringify(predicateRule)} is not one of: ${Object.keys(TOOL_TEXT_RENDERER_BY_PREDICATE_RULE).join(', ')} (a documentary predicate source declares no rule)`;
	}
	return '';
};

// identifierListFilePathFor — RELATIVE TO THE PLUGIN'S OWN FORGE BUNDLE, exactly as subjectSource.scopeStableIdListPath
// is: the list travels with the plugin, and a machine-specific absolute path would make its declaration digest
// machine-specific. An absolute path is honoured for a list that genuinely lives outside the bundle.
const identifierListFilePathFor = ({ identifierListPath, forgesDirPath, standardKey }) =>
	path.isAbsolute(identifierListPath) ? identifierListPath : path.join(forgesDirPath, standardKey, identifierListPath);

// readIdentifierList — the list file is SOURCE DATA entering the framework, so its shape is checked here, once
const readIdentifierList = ({ filePath }) => {
	if (!fs.existsSync(filePath)) {
		return { error: refuse.byName({ moduleName, what: `promptIdentifierScan.identifierListPath names no file at ${filePath}`, where: 'the identifier list is DATA on disk beside the plugin; declared-but-broken refuses every build (FF §5.4)' }) };
	}
	const parsed = decisionBlockLib.parseJsonText(fs.readFileSync(filePath, 'utf8'));
	if (parsed.error || !Array.isArray(parsed.value) || parsed.value.length === 0 || parsed.value.some((oneIdentifier) => !isNonEmptyString(oneIdentifier))) {
		return { error: refuse.byName({ moduleName, what: `the identifier list at ${filePath} is not a non-empty JSON array of non-empty strings (${parsed.error || 'wrong shape'})`, where: 'the list names the identifiers the judge must never see, one string each' }) };
	}
	const duplicateIdentifier = parsed.value.find((oneIdentifier, identifierIndex) => parsed.value.indexOf(oneIdentifier) !== identifierIndex);
	if (duplicateIdentifier !== undefined) {
		return { error: refuse.byName({ moduleName, what: `the identifier list at ${filePath} names '${duplicateIdentifier}' twice`, where: 'a duplicated entry means the list was assembled carelessly; regenerate it rather than let the scan paper over it' }) };
	}
	return { identifierList: parsed.value.slice() };
};

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
