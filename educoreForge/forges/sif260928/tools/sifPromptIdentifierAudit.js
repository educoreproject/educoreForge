#!/usr/bin/env node
'use strict';

// sifPromptIdentifierAudit.js — phase D3 gate (a), M4. Reads a SIF bridge run's forensic log (one JSON record per judged unit,
// carrying the system and user prompts actually rendered) and audits every surface for CEDS identifiers with the audit
// library's own patterns (sifPromptIdentifierAuditLib.js). Before trusting a green, it plants three identifiers into copies of the
// first record — P000505 in the system prompt, the bare listed id 000505 in a candidate card's text, C000001 in the subject text —
// and requires each to be found on its own surface by its own pattern (printed as RED-OBSERVED lines). READ-ONLY.
//
// Run: PATH=/usr/local/bin:$PATH node --max-old-space-size=8000 forges/sif260928/tools/sifPromptIdentifierAudit.js \
//        --forensicsFilePath=<…INVALID_DEBUG.jsonl> --hubIdentifierListFilePath=<json> --expectedRecordCount=<n> --outputFilePath=<report.json>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- audit every rendered SIF judge prompt, and the tool text, for CEDS identifiers

SYNOPSIS
     ${moduleName} --forensicsFilePath=<jsonl> --hubIdentifierListFilePath=<json> --expectedRecordCount=<n> --outputFilePath=<json>

     The hub identifier list is a JSON array of every P/C id the live hub's cards carry (runs/D3/hubCedsIdentifierList.json).

EXIT
     0 zero hits over every surface of every record, the record count as expected, every seat check equal, and all three
       planted controls found;  1 otherwise (the report says which).
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const auditLib = require(path.join(__dirname, 'sifPromptIdentifierAuditLib'));
const { bridgeDeclaration } = require(path.join(__dirname, '..', 'bridges', 'sif260928CedsDerivedPlugin'));

const refuseAndExit = (refusalText) => {
	xLog.error(`${moduleName}: REFUSED: ${refusalText}`);
	process.exit(1);
};
const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};

const forensicsFilePath = flagValueOf('forensicsFilePath');
const outputFilePath = flagValueOf('outputFilePath');
const hubIdentifierListFilePath = flagValueOf('hubIdentifierListFilePath');
const expectedRecordCount = Number(flagValueOf('expectedRecordCount'));
if (typeof forensicsFilePath !== 'string' || !fs.existsSync(forensicsFilePath)) {
	refuseAndExit(`--forensicsFilePath is required and must exist (got ${JSON.stringify(forensicsFilePath)})`);
}
if (typeof outputFilePath !== 'string' || !fs.existsSync(path.dirname(outputFilePath))) {
	refuseAndExit(`--outputFilePath is required and its directory must exist (got ${JSON.stringify(outputFilePath)})`);
}
if (typeof hubIdentifierListFilePath !== 'string' || !fs.existsSync(hubIdentifierListFilePath)) {
	refuseAndExit(`--hubIdentifierListFilePath is required and must exist (got ${JSON.stringify(hubIdentifierListFilePath)})`);
}
if (!Number.isInteger(expectedRecordCount) || expectedRecordCount <= 0) {
	refuseAndExit(`--expectedRecordCount must be a positive integer (got ${JSON.stringify(flagValueOf('expectedRecordCount'))})`);
}

const scanDeclaration = bridgeDeclaration.promptIdentifierScan;
const predicateRule = bridgeDeclaration.predicateSource.predicateRule;
const identifierList = JSON.parse(fs.readFileSync(path.join(__dirname, '..', scanDeclaration.identifierListPath), 'utf8'));
const hubIdentifierList = JSON.parse(fs.readFileSync(hubIdentifierListFilePath, 'utf8'));
const compiledScan = auditLib.compileAuditScan({ identifierPatternList: scanDeclaration.identifierPatternList, identifierList, hubIdentifierList });
const recordList = fs.readFileSync(forensicsFilePath, 'utf8').split('\n').filter((oneLine) => oneLine.length > 0).map((oneLine) => JSON.parse(oneLine));

const audit = auditLib.auditRecordList({ recordList, compiledScan, predicateRule });
if (audit.refusalText) {
	refuseAndExit(audit.refusalText);
}

// the planted controls: each on a copy of the first record, each expected on its own surface under its own pattern
const plantControlList = [
	{ controlName: 'systemPromptPropertyId', expectedSurfaceName: 'systemPrompt', expectedPatternName: 'cedsPropertyId', plant: (record) => ({ ...record, systemPrompt: `${record.systemPrompt} P000505` }) },
	{ controlName: 'candidateBareListedId', expectedSurfaceName: 'candidateText', expectedPatternName: auditLib.IDENTIFIER_LIST_PATTERN_NAME, plant: (record) => ({ ...record, userPrompt: record.userPrompt.replace(/\n( {6}name: )/, '\n$1000505 ') }) },
	{ controlName: 'subjectClassId', expectedSurfaceName: 'subjectText', expectedPatternName: 'cedsClassId', plant: (record) => ({ ...record, userPrompt: record.userPrompt.replace(/\n( {2}name: )/, '\n$1C000001 ') }) },
];
const controlResultList = plantControlList.map((oneControl) => {
	const planted = auditLib.auditRecord({ record: oneControl.plant(recordList[0]), compiledScan, predicateRule });
	const foundOnTarget = !planted.refusalText && planted.hitList.some((oneHit) => oneHit.surfaceName === oneControl.expectedSurfaceName && oneHit.patternName === oneControl.expectedPatternName);
	return { controlName: oneControl.controlName, foundOnTarget, hitList: planted.hitList || [], refusalText: planted.refusalText || '' };
});

const conjunctList = [
	{ conjunctName: 'recordCountAsExpected', pass: audit.recordCount === expectedRecordCount, detail: `${audit.recordCount} record(s), expected ${expectedRecordCount}` },
	{ conjunctName: 'zeroIdentifierHits', pass: audit.hitRecordList.length === 0, detail: `${audit.hitRecordList.length} record(s) with a hit${audit.hitRecordList.length ? `; first ${JSON.stringify(audit.hitRecordList[0])}` : ''}` },
	{ conjunctName: 'zeroHubIdentifierHits', pass: audit.hubHitRecordList.length === 0, detail: `${audit.hubHitRecordList.length} record(s) carrying a bare CEDS id the hub knows but the SIF list does not name${audit.hubHitRecordList.length ? `: ${audit.hubHitRecordList.map((oneHit) => `record ${oneHit.recordIndex} ${oneHit.hubHitList.map((oneEntry) => `${oneEntry.token} in ${oneEntry.surfaceName}`).join(', ')}`).join('; ')}` : ''}` },
	{ conjunctName: 'everySurfaceCovered', pass: ['systemPrompt', 'userFixedWording', 'subjectText', 'candidateText', 'toolTextEveryDialect', 'toolTextRealJudge'].every((oneSurfaceName) => audit.nonEmptyRecordCountBySurfaceName[oneSurfaceName] === audit.recordCount), detail: JSON.stringify(audit.nonEmptyRecordCountBySurfaceName) },
	{ conjunctName: 'everyCandidateSeatRendered', pass: audit.seatMismatchList.length === 0, detail: `${audit.seatMismatchList.length} record(s) whose candidate headings differ from the rendered pool` },
	{ conjunctName: 'plantedControlsFound', pass: controlResultList.every((oneResult) => oneResult.foundOnTarget), detail: controlResultList.map((oneResult) => `${oneResult.controlName} ${oneResult.foundOnTarget ? 'found' : 'MISSED'}`).join('; ') },
];
conjunctList.forEach((oneConjunct) => xLog.status(`${oneConjunct.pass ? 'PASS' : 'FAIL'} ${oneConjunct.conjunctName}: ${oneConjunct.detail}`));
controlResultList.forEach((oneResult) => xLog.status(`${oneResult.foundOnTarget ? 'RED-OBSERVED' : 'CONTROL MISSED'} zeroIdentifierHits control='${oneResult.controlName}' → ${oneResult.hitList.map((oneHit) => `${oneHit.patternName} '${oneHit.matchedText}' in ${oneHit.surfaceName}`).join(', ') || oneResult.refusalText || 'no hit'}`));
const unlistedTokenList = Object.keys(audit.unlistedSixDigitCountByToken).sort();
xLog.status(`INFO bare six-digit tokens that are NOT listed CEDS ids: ${unlistedTokenList.length} distinct${unlistedTokenList.length ? ` (first ${unlistedTokenList.slice(0, 10).join(', ')})` : ''}`);

fs.writeFileSync(outputFilePath, JSON.stringify({ forensicsFilePath, predicateRule, identifierListLength: identifierList.length, hubIdentifierListLength: hubIdentifierList.length, patternNameList: compiledScan.compiledPatternList.map((onePattern) => onePattern.patternName), conjunctList, controlResultList, audit }, null, '\t'));
xLog.status(`${moduleName}: report written to ${outputFilePath}`);
process.exit(conjunctList.every((oneConjunct) => oneConjunct.pass) ? 0 : 1);
