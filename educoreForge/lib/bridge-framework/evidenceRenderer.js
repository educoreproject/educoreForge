'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// evidenceRenderer.js — RENDERER_VERSION + the Profile-shaped judged QUESTION (SPEC-bridgeFramework-v1.md
// §5.6 step 1; RULINGS R2, BF1; BR-067, BR-068, BR-092; HARVEST §1.14). PURE and DETERMINISTIC: the same
// inputs render the same bytes; the rendered text's sha256 is promptHash (the cache key half).
//
//   renderQuestion({ sourceElement, candidatePool, globalGuidanceList, perCandidateNoteByStableId,
//                    promptSegmentList })
//     → { systemPrompt, userPrompt, promptHash, renderedPoolStableIdList, choiceEnum } | { error }
//
// The SOURCE ELEMENT is rendered FIRST, by name, with its blinded material and its source's own labels/
// notes/evidence columns; a package without a NAMED source is refused (the 2026-07-31 blind-judge lesson).
// The candidate pool is rendered in the order HANDED (the framework sorts by stableId BEFORE calling —
// this module records that order as renderedPoolStableIdList, the ONE authority for mapping the judge's
// ordinal back to a card); each candidate carries its tuple, definitions and the REASON it is in the pool
// (representationPolicy). Global guidance and plugin prompt segments are candidate-BLIND: the A2 smuggling
// check (MIRRORED from apps/bridge-maker/lib/evidenceContracts.js — its evidencePackageViolation requires a
// per-candidate cosine and the old hub-module tuple presentation, neither of which a Profile-shaped package
// has; named DEVLOG deviation, RULING 12:20 (2)) refuses a segment naming a pool candidate.

const crypto = require('crypto');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const representationPolicyLib = require('./representationPolicy');

const RENDERER_VERSION = 'bridgeEvidenceRenderer-v1';
const ABSTAIN_TOKEN = 'NONE';
const MIN_IDENTIFYING_TOKEN_LENGTH = 4;

const SYSTEM_PROMPT =
	'You are matching ONE source element to AT MOST ONE candidate card from a hub of canonical properties. ' +
	'Every candidate shares the join key the source named; your job is to CHOOSE among them or ABSTAIN. ' +
	'Answer with the ordinal of the candidate that means the same thing as the source element, or NONE. ' +
	'Name your choice in the rationale by the candidate hub key and name, never by its ordinal.';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// candidateIdentifyingTokenList — the tokens a global segment must never mention (mirrors evidenceContracts)
const candidateIdentifyingTokenList = (oneCard) =>
	[oneCard.stableId, oneCard.canonicalKey, oneCard.name, oneCard.uri].filter((oneToken) => typeof oneToken === 'string' && oneToken.trim().length >= MIN_IDENTIFYING_TOKEN_LENGTH);

const renderKeyValueLines = (valueByName, indent) =>
	Object.keys(valueByName || {})
		.sort()
		.filter((oneName) => valueByName[oneName] !== undefined && valueByName[oneName] !== null && String(valueByName[oneName]) !== '')
		.map((oneName) => `${indent}${oneName}: ${typeof valueByName[oneName] === 'string' ? valueByName[oneName] : JSON.stringify(valueByName[oneName])}`);

const renderQuestion = ({ sourceElement, candidatePool, globalGuidanceList, perCandidateNoteByStableId, promptSegmentList } = {}) => {
	if (!isPlainObject(sourceElement) || typeof sourceElement.name !== 'string' || sourceElement.name.trim() === '') {
		return { error: refuse.byName({ moduleName, what: 'the source element carries no name', where: 'the judge cannot be asked which candidate matches without being told WHAT it is matching (source-presence hardening)' }) };
	}
	if (!Array.isArray(candidatePool) || candidatePool.length === 0) {
		return { error: refuse.byName({ moduleName, what: 'candidatePool is empty or not a list', where: 'a judged question needs at least one candidate; zero is an orphan, not a judgment' }) };
	}
	for (let seatIndex = 0; seatIndex < candidatePool.length; seatIndex++) {
		const oneSeat = candidatePool[seatIndex];
		if (!isPlainObject(oneSeat) || !isPlainObject(oneSeat.card) || typeof oneSeat.card.stableId !== 'string') {
			return { error: refuse.byName({ moduleName, what: `candidatePool[${seatIndex}] is not { card, seatReason }`, where: 'every seat carries the card and the reason it is in the pool (BR-068)' }) };
		}
		const seatReasonRefusal = representationPolicyLib.seatReasonRefusal(oneSeat.seatReason);
		if (seatReasonRefusal) {
			return { error: refuse.byName({ moduleName, what: `candidatePool[${seatIndex}] ${seatReasonRefusal}`, where: 'per-seat provenance is DATA (representationPolicy.js)' }) };
		}
	}
	const guidanceList = globalGuidanceList === undefined ? [] : globalGuidanceList;
	const segmentList = promptSegmentList === undefined ? [] : promptSegmentList;
	if (!Array.isArray(guidanceList) || !Array.isArray(segmentList) || guidanceList.concat(segmentList).some((oneSegment) => typeof oneSegment !== 'string')) {
		return { error: refuse.byName({ moduleName, what: 'globalGuidanceList / promptSegmentList must be lists of strings', where: 'declaration data (globalGuidanceList) and walkEvidence promptSegmentList' }) };
	}
	const globalSegmentList = guidanceList.concat(segmentList);
	if (new Set(globalSegmentList).size !== globalSegmentList.length) {
		return { error: refuse.byName({ moduleName, what: 'global segments contain a duplicate', where: 'A2 requires global segments to be deduped before injection' }) };
	}
	for (let seatIndex = 0; seatIndex < candidatePool.length; seatIndex++) {
		const tokenList = candidateIdentifyingTokenList(candidatePool[seatIndex].card);
		for (let tokenIndex = 0; tokenIndex < tokenList.length; tokenIndex++) {
			const leaked = globalSegmentList.find((oneSegment) => oneSegment.indexOf(tokenList[tokenIndex]) !== -1);
			if (leaked !== undefined) {
				return { error: refuse.byName({ moduleName, what: `a global segment ${JSON.stringify(leaked)} references candidate-specific token '${tokenList[tokenIndex]}'`, where: 'per-candidate material rides WITH its candidate (perCandidateNoteByStableId), never in a global segment (A2 smuggling gate)' }) };
			}
		}
	}
	const noteByStableId = perCandidateNoteByStableId === undefined ? {} : perCandidateNoteByStableId;
	const renderedPoolStableIdList = candidatePool.map((oneSeat) => oneSeat.card.stableId);
	const lineList = [];
	lineList.push('SOURCE ELEMENT (what you are matching FROM):');
	lineList.push(`  name: ${sourceElement.name}`);
	if (typeof sourceElement.stableId === 'string') {
		lineList.push(`  stableId: ${sourceElement.stableId}`);
	}
	lineList.push(...renderKeyValueLines(sourceElement.material, '  '));
	if (isPlainObject(sourceElement.evidence)) {
		const subjectLineList = renderKeyValueLines(sourceElement.evidence.subject, '    ');
		if (subjectLineList.length) {
			lineList.push('  source-side evidence:', ...subjectLineList);
		}
		const assertionLineList = renderKeyValueLines(sourceElement.evidence.assertion, '    ');
		if (assertionLineList.length) {
			lineList.push('  assertion-side evidence:', ...assertionLineList);
		}
	}
	const labelLineList = renderKeyValueLines(sourceElement.sourceLabelByColumn, '    ');
	if (labelLineList.length) {
		lineList.push("  the source's own labels:", ...labelLineList);
	}
	const noteLineList = renderKeyValueLines(sourceElement.sourceNoteByColumn, '    ');
	if (noteLineList.length) {
		lineList.push("  the source's own notes:", ...noteLineList);
	}
	if (globalSegmentList.length) {
		lineList.push('GUIDANCE (candidate-blind):');
		globalSegmentList.forEach((oneSegment) => lineList.push(`  - ${oneSegment}`));
	}
	lineList.push(`CANDIDATES (${candidatePool.length}), in hub order:`);
	candidatePool.forEach((oneSeat, seatIndex) => {
		const oneCard = oneSeat.card;
		lineList.push(`  [${seatIndex + 1}] ${oneCard.canonicalKey} — ${oneCard.name}`);
		lineList.push(`      seat: ${oneSeat.seatReason}${oneSeat.nominatedBy ? ` (${oneSeat.nominatedBy}: ${oneSeat.nominationRationale})` : ''}`);
		lineList.push(...renderKeyValueLines({ domainId: oneCard.domainId, domainName: oneCard.domainName, propertyKey: oneCard.propertyKey, qualifierKeys: oneCard.qualifierKeys, range: oneCard.range, rangeDatatype: oneCard.rangeDatatype, propertyDefinition: oneCard.propertyDefinition, domainDefinition: oneCard.domainDefinition, propertyNotation: oneCard.propertyNotation }, '      '));
		if (typeof noteByStableId[oneCard.stableId] === 'string' && noteByStableId[oneCard.stableId] !== '') {
			lineList.push(`      note: ${noteByStableId[oneCard.stableId]}`);
		}
	});
	lineList.push(`Answer with one of: ${renderedPoolStableIdList.map((unused, seatIndex) => String(seatIndex + 1)).join(', ')}, or ${ABSTAIN_TOKEN}.`);
	const userPrompt = lineList.join('\n');
	const choiceEnum = renderedPoolStableIdList.map((unused, seatIndex) => String(seatIndex + 1)).concat([ABSTAIN_TOKEN]);
	return {
		systemPrompt: SYSTEM_PROMPT,
		userPrompt,
		promptHash: sha256Hex(`${RENDERER_VERSION}\n${SYSTEM_PROMPT}\n${userPrompt}`),
		renderedPoolStableIdList,
		choiceEnum,
	};
};

module.exports = { RENDERER_VERSION, SYSTEM_PROMPT, ABSTAIN_TOKEN, renderQuestion, candidateIdentifyingTokenList, sha256Hex, moduleName };
