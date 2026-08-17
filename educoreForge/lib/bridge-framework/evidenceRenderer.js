'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// evidenceRenderer.js — RENDERER_VERSION + the Profile-shaped judged QUESTION (SPEC-bridgeFramework-v1.md
// §5.6 step 1; RULINGS R2, BF1, §11.1, §11.4; BR-067, BR-068, BR-092; HARVEST §1.14). PURE and
// DETERMINISTIC: the same inputs render the same bytes; the rendered text's sha256 is promptHash (the cache
// key half).
//
//   renderQuestion({ sourceElement, candidatePool, globalGuidanceList, perCandidateNoteByStableId,
//                    promptSegmentList, judgePromptVariant, renderingAllowList })
//     → { systemPrompt, userPrompt, promptHash, renderedPoolStableIdList, choiceEnum, rendererVersion } | { error }
//
// TWO REGISTERED VARIANTS, one row each (RULING §11.1) — never a branch on the variant name:
//
//   crosswalk  the shipped rendering, BYTE-FROZEN. Every candidate is headlined by its canonicalKey and the
//              subject prints its stableId, because for a key-filtered pool those ARE the shared join key the
//              question is about. Its RENDERER_VERSION is unchanged, so the 152 judgments already paid for on
//              the Ed-Fi crosswalk keep hitting the judgment cache (§11.8). Nothing in this row may move.
//
//   derived    the RETRIEVED rendering. The pool does NOT share a key — it was assembled by meaning — so the
//              system prompt says so, and the rendered blocks carry ONLY the plugin's declared
//              renderingAllowList for that side. This is an ALLOW-list, enforced here by construction: the
//              renderer builds each block by walking the declared names, so a property nobody thought to
//              forbid cannot appear. It has its OWN renderer version (bridgeEvidenceRenderer-derived-v1), which
//              is why bumping it cannot orphan the crosswalk's cache.
//
// WHY THE DERIVED SYSTEM PROMPT SAYS "by name". BR-067 tells the judge to cite its choice by the candidate's
// hub key, and judgeComponent's ORDINAL_RATIONALE_RE refuses a rationale that names an ordinal instead —
// with exactly ONE re-ask before the run dies. Under blinding there IS no key to cite, so the crosswalk
// sentence would instruct the judge to name something the prompt does not contain, and every such answer
// would cost a second Opus call (the B3 run died on this at ~16/152 WITH the key present). The derived
// variant therefore tells the judge to name its choice by the candidate's NAME (RULING §11.1).

const crypto = require('crypto');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const representationPolicyLib = require('./representationPolicy');
const graphSeamRulesLib = require('./graphSeamRules');
const { JUDGE_PROMPT_VARIANT_LIST, RENDERING_NEVER_NAME_LIST } = require('./bridgePluginContract');

const RENDERER_VERSION = 'bridgeEvidenceRenderer-v1';
const DERIVED_RENDERER_VERSION = 'bridgeEvidenceRenderer-derived-v1';
const ABSTAIN_TOKEN = 'NONE';
const MIN_IDENTIFYING_TOKEN_LENGTH = 4;

const SYSTEM_PROMPT =
	'You are matching ONE source element to AT MOST ONE candidate card from a hub of canonical properties. ' +
	'Every candidate shares the join key the source named; your job is to CHOOSE among them or ABSTAIN. ' +
	'Answer with the ordinal of the candidate that means the same thing as the source element, or NONE. ' +
	'Name your choice in the rationale by the candidate hub key and name, never by its ordinal.';

const DERIVED_SYSTEM_PROMPT =
	'You are matching ONE source element to AT MOST ONE candidate card from a hub of canonical properties. ' +
	'The candidates were RETRIEVED BY MEANING: they do not share any key or identifier with the source element, ' +
	'and several of them may be unrelated to it. It is entirely possible that NONE of them means the same thing ' +
	'as the source element; abstaining is a correct and expected answer, not a failure. ' +
	'Answer with the ordinal of the candidate that means the same thing as the source element, or NONE. ' +
	'Name your choice in the rationale by the candidate NAME, never by its ordinal.';

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

// ---------------------------------------------------------------------
// crosswalk variant — BYTE-FROZEN. These two builders reproduce the shipped text exactly; changing a space
// here re-keys every crosswalk prompt and orphans 152 paid judgments (§11.8). They take renderingAllowList
// and ignore it BY CONTRACT: the crosswalk basis forbids the key, so it is always undefined here.
// ---------------------------------------------------------------------
const crosswalkSubjectLineList = ({ sourceElement }) => {
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
	return lineList;
};

const crosswalkCandidateLineList = ({ oneSeat, seatIndex, noteByStableId }) => {
	const oneCard = oneSeat.card;
	const lineList = [];
	lineList.push(`  [${seatIndex + 1}] ${oneCard.canonicalKey} — ${oneCard.name}`);
	lineList.push(`      seat: ${oneSeat.seatReason}${oneSeat.nominatedBy ? ` (${oneSeat.nominatedBy}: ${oneSeat.nominationRationale})` : ''}`);
	lineList.push(...renderKeyValueLines({ domainId: oneCard.domainId, domainName: oneCard.domainName, propertyKey: oneCard.propertyKey, qualifierKeys: oneCard.qualifierKeys, range: oneCard.range, rangeDatatype: oneCard.rangeDatatype, propertyDefinition: oneCard.propertyDefinition, domainDefinition: oneCard.domainDefinition, propertyNotation: oneCard.propertyNotation }, '      '));
	if (typeof noteByStableId[oneCard.stableId] === 'string' && noteByStableId[oneCard.stableId] !== '') {
		lineList.push(`      note: ${noteByStableId[oneCard.stableId]}`);
	}
	return lineList;
};

// ---------------------------------------------------------------------
// derived variant — ALLOW-LISTED. The blocks are BUILT from the declared names, never filtered after the
// fact. Neither block prints a stableId, a canonicalKey, an ordinal-bearing key or a seat reason: the seat
// reason for a retrieved pool is always 'retrieval' and printing it, or the rank, would leak the retrieval
// order the neutral stableId sort exists to hide (§11.3, §11.4).
// ---------------------------------------------------------------------
const derivedSubjectLineList = ({ sourceElement, renderingAllowList }) => {
	const lineList = [];
	lineList.push('SOURCE ELEMENT (what you are matching FROM):');
	lineList.push(...renderKeyValueLines(graphSeamRulesLib.allowListedPropertiesFor({ properties: sourceElement.material || {}, allowNameList: renderingAllowList.subject }), '  '));
	return lineList;
};

const derivedCandidateLineList = ({ oneSeat, seatIndex, renderingAllowList }) => {
	const lineList = [];
	lineList.push(`  [${seatIndex + 1}]`);
	lineList.push(...renderKeyValueLines(graphSeamRulesLib.allowListedPropertiesFor({ properties: oneSeat.card, allowNameList: renderingAllowList.candidate }), '      '));
	return lineList;
};

// CROSSWALK_SUBJECT_MATERIAL_NAME_LIST — the subject-node properties the crosswalk variant lifts into
// sourceElement.material. BYTE-FROZEN with the rest of that variant: this list decides what appears in the
// prompt, so adding a name here re-keys every crosswalk prompt.
const CROSSWALK_SUBJECT_MATERIAL_NAME_LIST = Object.freeze(['description', 'definition', 'path', 'xpath', 'characteristics', 'role', 'perStandardLabel']);

// subjectMaterialNameListFor — WHICH subject-node properties become material, per variant. The crosswalk
// variant names them as a constant; the derived variant takes them FROM THE DECLARED ALLOW-LIST, because an
// allow-list that the material step can silently overrule is not an allow-list. This is the seam where the
// bias audit would have leaked in the other direction: a constant list would have quietly DROPPED
// propertyType / owningConstructName from the derived prompt no matter what the plugin declared.
const JUDGE_PROMPT_VARIANT_REGISTRY = Object.freeze({
	crosswalk: Object.freeze({
		rendererVersion: RENDERER_VERSION,
		systemPrompt: SYSTEM_PROMPT,
		requiresRenderingAllowList: false,
		subjectLineList: crosswalkSubjectLineList,
		candidateLineList: crosswalkCandidateLineList,
		subjectMaterialNameListFor: () => CROSSWALK_SUBJECT_MATERIAL_NAME_LIST,
	}),
	derived: Object.freeze({
		rendererVersion: DERIVED_RENDERER_VERSION,
		systemPrompt: DERIVED_SYSTEM_PROMPT,
		requiresRenderingAllowList: true,
		subjectLineList: derivedSubjectLineList,
		candidateLineList: derivedCandidateLineList,
		subjectMaterialNameListFor: ({ bridgeDeclaration }) => bridgeDeclaration.renderingAllowList.subject,
	}),
});

// renderedBlockRefusal — the POSITIVE half of the id gate, applied to the bytes actually produced. The
// allow-list makes a leak structurally impossible; this asserts it anyway, because "impossible by
// construction" is a claim about code I just wrote and the gate has to be able to catch me being wrong.
const renderedBlockRefusal = ({ lineList, variantRow }) => {
	if (!variantRow.requiresRenderingAllowList) {
		return null;
	}
	const renderedNameList = lineList
		.map((oneLine) => /^\s+([A-Za-z_][A-Za-z0-9_]*):/.exec(oneLine))
		.filter((oneMatch) => oneMatch !== null)
		.map((oneMatch) => oneMatch[1]);
	const leaked = renderedNameList.find((oneName) => RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1);
	return leaked === undefined ? null : refuse.byName({ moduleName, what: `the rendered prompt carries property '${leaked}', which is on RENDERING_NEVER_NAME_LIST`, where: 'an identifier never reaches the judge under a retrieved basis (§4 the bias audit); the allow-list should have made this unreachable — reaching it is a defect in the renderer, not in the declaration' });
};

const renderQuestion = ({ sourceElement, candidatePool, globalGuidanceList, perCandidateNoteByStableId, promptSegmentList, judgePromptVariant, renderingAllowList } = {}) => {
	if (JUDGE_PROMPT_VARIANT_REGISTRY[judgePromptVariant] === undefined) {
		return { error: refuse.byName({ moduleName, what: `judgePromptVariant ${JSON.stringify(judgePromptVariant)} names no rendering variant`, where: `the framework passes the variant named by the run's SOURCE_ACQUISITION_REGISTRY row; the registered variants are ${JUDGE_PROMPT_VARIANT_LIST.join(', ')} — there is no default renderer` }) };
	}
	const variantRow = JUDGE_PROMPT_VARIANT_REGISTRY[judgePromptVariant];
	if (variantRow.requiresRenderingAllowList && !(isPlainObject(renderingAllowList) && Array.isArray(renderingAllowList.subject) && Array.isArray(renderingAllowList.candidate) && renderingAllowList.subject.length > 0 && renderingAllowList.candidate.length > 0)) {
		return { error: refuse.byName({ moduleName, what: `variant '${judgePromptVariant}' requires a renderingAllowList { subject: [...], candidate: [...] } and got ${JSON.stringify(renderingAllowList)}`, where: 'a retrieved pool is rendered by ALLOW-LIST or not at all; there is no unblinded path' }) };
	}
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
	lineList.push(...variantRow.subjectLineList({ sourceElement, renderingAllowList }));
	if (globalSegmentList.length) {
		lineList.push('GUIDANCE (candidate-blind):');
		globalSegmentList.forEach((oneSegment) => lineList.push(`  - ${oneSegment}`));
	}
	lineList.push(`CANDIDATES (${candidatePool.length}), in hub order:`);
	candidatePool.forEach((oneSeat, seatIndex) => {
		lineList.push(...variantRow.candidateLineList({ oneSeat, seatIndex, noteByStableId, renderingAllowList }));
	});
	lineList.push(`Answer with one of: ${renderedPoolStableIdList.map((unused, seatIndex) => String(seatIndex + 1)).join(', ')}, or ${ABSTAIN_TOKEN}.`);
	const blockRefusal = renderedBlockRefusal({ lineList, variantRow });
	if (blockRefusal) {
		return { error: blockRefusal };
	}
	const userPrompt = lineList.join('\n');
	const choiceEnum = renderedPoolStableIdList.map((unused, seatIndex) => String(seatIndex + 1)).concat([ABSTAIN_TOKEN]);
	return {
		systemPrompt: variantRow.systemPrompt,
		userPrompt,
		promptHash: sha256Hex(`${variantRow.rendererVersion}\n${variantRow.systemPrompt}\n${userPrompt}`),
		renderedPoolStableIdList,
		choiceEnum,
		rendererVersion: variantRow.rendererVersion,
	};
};

module.exports = {
	RENDERER_VERSION,
	DERIVED_RENDERER_VERSION,
	SYSTEM_PROMPT,
	DERIVED_SYSTEM_PROMPT,
	JUDGE_PROMPT_VARIANT_REGISTRY,
	ABSTAIN_TOKEN,
	renderQuestion,
	candidateIdentifyingTokenList,
	sha256Hex,
	moduleName,
};
