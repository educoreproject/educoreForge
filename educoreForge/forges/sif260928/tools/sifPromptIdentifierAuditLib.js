'use strict';

// sifPromptIdentifierAuditLib.js — phase D3 gate (a), M4: an INDEPENDENT after-the-run audit of every prompt the SIF
// bridge rendered for its judge, read from the run's forensic log. The in-run scan (lib/bridge-framework/
// promptIdentifierScan.js) refuses a run on its first hit; this audit re-reads what was actually rendered, with its own
// regexes, and reports every hit by record and surface, so a scan that silently scanned nothing cannot pass for green.
//
// SURFACES, per forensic record (each scanned in full):
//   systemPrompt          the fixed system wording
//   userPrompt            the whole user prompt: fixed wording, the SOURCE ELEMENT (subject) text and every CANDIDATE card's text
//   reaskUserPrompt       the one rationale re-ask, when one was sent (null under the debug judge)
//   toolTextEveryDialect  the tool schema for the declared predicate rule in every dialect the schema module knows (the same
//                         renderer the in-run scan uses, so the two cannot disagree about what the tool text is)
//   toolTextRealJudge     the tool definition the REAL judge's client sends (bridge-maker llmClient.buildTool) for the record's own
//                         choice list — the hermetic stand-in carrying the real judge's schema, with no client, key or network
// The user prompt is also split into its three parts (userFixedWording, subjectText, candidateText) so the report can show that
// candidate card text and fixed wording were present and scanned; a hit is attributed to the part it falls in.
//
// PATTERNS: the plugin's declared patterns (P\d{6}, C\d{6}) and its declared bare-id list, each id matched only between
// alphanumeric boundaries, compiled HERE (not through the framework's compileScan). Every bare six-digit token that is NOT a
// listed id is then looked up in the LIVE HUB's own identifier list (every P/C id the hub's cards carry, exported by the caller):
// a token the hub knows is a CEDS identifier the SIF list does not name, and is reported as a hub hit (a failure of its own
// conjunct); a token the hub does not know is counted as information only.
//
// PURE and synchronous. The CLI (sifPromptIdentifierAudit.js) reads files and writes the report.

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const { TOOL_TEXT_RENDERER_BY_PREDICATE_RULE } = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'promptIdentifierScan'));
const { ABSTAIN_TOKEN } = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'evidenceRenderer'));
const { buildTool } = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'llmClient'));

const IDENTIFIER_LIST_PATTERN_NAME = 'identifierList';
const BARE_SIX_DIGIT_REGEX_SOURCE = '(?<![A-Za-z0-9])\\d{6}(?![A-Za-z0-9])';
const SUBJECT_HEADING = 'SOURCE ELEMENT (what you are matching FROM):';
const CANDIDATE_HEADING_REGEX = /^CANDIDATE ELEMENTS \(\d+\)/;
const CANDIDATE_SEAT_LINE_REGEX = /^ {2}CANDIDATE INDEX NUMBER: \[\d+\]$/;
const ANSWER_LINE_REGEX = /^Answer with one of: /;
const SUBJECT_VALUE_LINE_REGEX = /^ {2}\S/;
const CANDIDATE_VALUE_LINE_REGEX = /^ {6}\S/;

const escapeRegexText = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// compileAuditScan — the declared patterns and one bounded alternation over the listed ids, all global
const compileAuditScan = ({ identifierPatternList, identifierList, hubIdentifierList }) => {
	const compiledPatternList = identifierPatternList.map((onePatternRow) => ({ patternName: onePatternRow.patternName, regex: new RegExp(onePatternRow.regexSource, 'g') }));
	const alternationText = identifierList.slice().sort((leftIdentifier, rightIdentifier) => rightIdentifier.length - leftIdentifier.length).map(escapeRegexText).join('|');
	compiledPatternList.push({ patternName: IDENTIFIER_LIST_PATTERN_NAME, regex: new RegExp(`(?<![A-Za-z0-9])(?:${alternationText})(?![A-Za-z0-9])`, 'g') });
	// a bare token is a hub id when the hub carries it under either prefix
	const hubBareIdentifierSet = new Set(hubIdentifierList.map((oneIdentifier) => oneIdentifier.slice(1)));
	return { compiledPatternList, listedIdentifierSet: new Set(identifierList), hubBareIdentifierSet, bareSixDigitRegex: new RegExp(BARE_SIX_DIGIT_REGEX_SOURCE, 'g') };
};

// userPromptPartsFor — the user prompt's lines sorted into its three parts by the renderer's own headings. A prompt without the
// subject heading, the candidate heading or the answer line is refused by name: the audit does not guess at a shape it was not built for.
const userPromptPartsFor = (userPrompt) => {
	const lineList = userPrompt.split('\n');
	const subjectHeadingIndex = lineList.indexOf(SUBJECT_HEADING);
	const candidateHeadingIndex = lineList.findIndex((oneLine) => CANDIDATE_HEADING_REGEX.test(oneLine));
	const answerLineIndex = lineList.findIndex((oneLine) => ANSWER_LINE_REGEX.test(oneLine));
	if (subjectHeadingIndex === -1 || candidateHeadingIndex === -1 || answerLineIndex === -1 || !(subjectHeadingIndex < candidateHeadingIndex && candidateHeadingIndex < answerLineIndex)) {
		return { refusalText: `the user prompt lacks, or misorders, the subject heading (line ${subjectHeadingIndex}), the candidate heading (line ${candidateHeadingIndex}) or the answer line (line ${answerLineIndex})` };
	}
	const linesByPartName = { userFixedWording: [], subjectText: [], candidateText: [] };
	lineList.forEach((oneLine, lineIndex) => {
		const inSubjectZone = lineIndex > subjectHeadingIndex && lineIndex < candidateHeadingIndex;
		const inCandidateZone = lineIndex > candidateHeadingIndex && lineIndex < answerLineIndex;
		if (inSubjectZone && SUBJECT_VALUE_LINE_REGEX.test(oneLine)) {
			linesByPartName.subjectText.push(oneLine);
			return;
		}
		if (inCandidateZone && CANDIDATE_VALUE_LINE_REGEX.test(oneLine)) {
			linesByPartName.candidateText.push(oneLine);
			return;
		}
		// a continuation line of a multi-line value lands here too; it is scanned either way, only its attribution is coarser
		linesByPartName.userFixedWording.push(oneLine);
	});
	const candidateSeatCount = lineList.filter((oneLine) => CANDIDATE_SEAT_LINE_REGEX.test(oneLine)).length;
	return { partTextByName: Object.keys(linesByPartName).reduce((soFar, onePartName) => ({ ...soFar, [onePartName]: linesByPartName[onePartName].join('\n') }), {}), candidateSeatCount };
};

// choiceEnumFor — the renderer's own choice list for a rendered pool: seats 1..N, then the abstain token
const choiceEnumFor = (renderedPoolStableIdList) => renderedPoolStableIdList.map((unused, seatIndex) => String(seatIndex + 1)).concat([ABSTAIN_TOKEN]);

// surfaceTextByNameFor — every surface of one record, in scan order
const surfaceTextByNameFor = ({ record, predicateRule, partTextByName }) => {
	const choiceEnum = choiceEnumFor(record.renderedPoolStableIdList);
	const surfaceTextByName = {
		systemPrompt: record.systemPrompt,
		userFixedWording: partTextByName.userFixedWording,
		subjectText: partTextByName.subjectText,
		candidateText: partTextByName.candidateText,
		toolTextEveryDialect: TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule]({ choiceEnum }),
		toolTextRealJudge: JSON.stringify(buildTool({ choiceEnum, predicateRule })),
	};
	if (record.reaskUserPrompt !== null) {
		surfaceTextByName.reaskUserPrompt = record.reaskUserPrompt;
	}
	return surfaceTextByName;
};

// hitListIn — every match of every pattern in one text
const hitListIn = ({ compiledScan, surfaceName, text }) =>
	compiledScan.compiledPatternList.reduce((soFar, onePattern) => soFar.concat((text.match(onePattern.regex) || []).map((matchedText) => ({ surfaceName, patternName: onePattern.patternName, matchedText }))), []);

// auditRecord — the hits and the per-surface character counts of one forensic record, plus the bare six-digit tokens that are not listed ids
const auditRecord = ({ record, compiledScan, predicateRule }) => {
	const parts = userPromptPartsFor(record.userPrompt);
	if (parts.refusalText) {
		return { refusalText: `record ${record.promptHash}: ${parts.refusalText}` };
	}
	const surfaceTextByName = surfaceTextByNameFor({ record, predicateRule, partTextByName: parts.partTextByName });
	const hitList = Object.keys(surfaceTextByName).reduce((soFar, oneSurfaceName) => soFar.concat(hitListIn({ compiledScan, surfaceName: oneSurfaceName, text: surfaceTextByName[oneSurfaceName] })), []);
	const unlistedSixDigitList = Object.keys(surfaceTextByName).reduce((soFar, oneSurfaceName) => soFar.concat((surfaceTextByName[oneSurfaceName].match(compiledScan.bareSixDigitRegex) || []).filter((oneToken) => !compiledScan.listedIdentifierSet.has(oneToken)).map((oneToken) => ({ surfaceName: oneSurfaceName, token: oneToken, hubKnowsToken: compiledScan.hubBareIdentifierSet.has(oneToken) }))), []);
	const charCountBySurfaceName = Object.keys(surfaceTextByName).reduce((soFar, oneSurfaceName) => ({ ...soFar, [oneSurfaceName]: surfaceTextByName[oneSurfaceName].length }), {});
	return { hitList, unlistedSixDigitList, charCountBySurfaceName, candidateSeatCount: parts.candidateSeatCount, renderedPoolSize: record.renderedPoolStableIdList.length };
};

// auditRecordList — the whole log: hits by record, surface coverage (how many records had non-empty text on each surface),
// and the seat check (every record's candidate headings number exactly its rendered pool)
const auditRecordList = ({ recordList, compiledScan, predicateRule }) => {
	const hitRecordList = [];
	const hubHitRecordList = [];
	const nonEmptyRecordCountBySurfaceName = {};
	const charTotalBySurfaceName = {};
	const unlistedSixDigitCountByToken = {};
	const seatMismatchList = [];
	for (let recordIndex = 0; recordIndex < recordList.length; recordIndex++) {
		const oneRecord = recordList[recordIndex];
		const audited = auditRecord({ record: oneRecord, compiledScan, predicateRule });
		if (audited.refusalText) {
			return { refusalText: audited.refusalText };
		}
		if (audited.hitList.length > 0) {
			hitRecordList.push({ recordIndex, promptHash: oneRecord.promptHash, hitList: audited.hitList });
		}
		if (audited.candidateSeatCount !== audited.renderedPoolSize) {
			seatMismatchList.push({ recordIndex, promptHash: oneRecord.promptHash, candidateSeatCount: audited.candidateSeatCount, renderedPoolSize: audited.renderedPoolSize });
		}
		Object.keys(audited.charCountBySurfaceName).forEach((oneSurfaceName) => {
			const charCount = audited.charCountBySurfaceName[oneSurfaceName];
			charTotalBySurfaceName[oneSurfaceName] = (charTotalBySurfaceName[oneSurfaceName] || 0) + charCount;
			nonEmptyRecordCountBySurfaceName[oneSurfaceName] = (nonEmptyRecordCountBySurfaceName[oneSurfaceName] || 0) + (charCount > 0 ? 1 : 0);
		});
		const hubHitList = audited.unlistedSixDigitList.filter((oneEntry) => oneEntry.hubKnowsToken);
		if (hubHitList.length > 0) {
			hubHitRecordList.push({ recordIndex, promptHash: oneRecord.promptHash, hubHitList });
		}
		audited.unlistedSixDigitList.filter((oneEntry) => !oneEntry.hubKnowsToken).forEach((oneEntry) => {
			unlistedSixDigitCountByToken[oneEntry.token] = (unlistedSixDigitCountByToken[oneEntry.token] || 0) + 1;
		});
	}
	return { recordCount: recordList.length, hitRecordList, hubHitRecordList, seatMismatchList, nonEmptyRecordCountBySurfaceName, charTotalBySurfaceName, unlistedSixDigitCountByToken };
};

module.exports = { compileAuditScan, userPromptPartsFor, choiceEnumFor, auditRecord, auditRecordList, IDENTIFIER_LIST_PATTERN_NAME };
