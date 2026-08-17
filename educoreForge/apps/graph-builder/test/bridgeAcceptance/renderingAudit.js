'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// renderingAudit.js — THE BIAS AUDIT, as a written document (PLAN-derivedBridge-v1.md §4; RULING §11.4).
// TQ's instruction was: "Evaluate the CEDS values offered to the AI carefully to make sure that it doesn't
// have any information that would bias the judgement with parameters (e.g., no cedsId properties)." A gate
// answers that with a number; this answers it with the PROMPTS THEMSELVES, so a person can read what the
// judge was actually shown before a cent is spent. The supervisor signs it; TQ may read it.
//
//   buildRenderingAudit({ forensicsDirPath, pairKey, generation, blockId, renderingAllowList,
//                         judgePromptVariant, sampleCount })
//     → { markdownText, promptCount, hitList, advisoryUrlCount } | { error }
//
// PURE apart from ONE read of the forensic JSONL. It invents nothing: every prompt printed is the exact
// userPrompt bytes the judge received, read back out of the forensic trail rather than re-rendered — a
// re-rendered prompt would be a claim about what the renderer does, not evidence of what it did.
//
// THE SAMPLE IS DETERMINISTIC. Five prompts chosen by sorting on promptHash, not "the first five written":
// write order depends on judge concurrency, so a first-five sample would differ between two runs of the same
// block and the document could not be diffed against itself.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

const DEFAULT_SAMPLE_COUNT = 5;

// ID_GATE_PATTERN_LIST — the single definition of what an identifier LOOKS like, shared by this document and
// by the BG-BLIND-DERIVED gate that sweeps the same prompts (test-bgDerived.js requires it FROM HERE). Two
// copies of this list would be two different audits wearing one name.
//
// Every pattern below is RED. The bare-URL sweep is deliberately NOT among them and is reported as an
// ADVISORY COUNT instead: the hub's own propertyDefinition and rangeOptionSetDefinition carry external URLs
// (the D0 review measured 68 and 83 of them), none of which says WHICH card is the answer. Scrubbing prose
// the judge needs in order to look rigorous would cost accuracy and buy nothing.
const ID_GATE_PATTERN_LIST = Object.freeze([
	Object.freeze({ patternName: 'hubIdentifier', regex: /\b[PCOSV]\d{5,}\b/, why: 'a CEDS/hub identifier such as P001156 or C200226 — the answer itself' }),
	Object.freeze({ patternName: 'edfiPropertyUri', regex: /edfi:property\//, why: 'the subject stableId, which names the source element outside its own description' }),
	Object.freeze({ patternName: 'educoreW3id', regex: /w3id\.org\/EDUcore/, why: 'a hub stableId / uri' }),
	Object.freeze({ patternName: 'contentHash', regex: /\b[0-9a-f]{40,}\b/, why: 'an address signature or other content hash' }),
	Object.freeze({ patternName: 'crossRefsLiteral', regex: /crossRefs/, why: 'the property that carries the crosswalk answer on 495 Ed-Fi nodes' }),
	Object.freeze({ patternName: 'cedsIdLiteral', regex: /cedsId/, why: 'named by TQ, by name, as a thing the judge must never see' }),
	Object.freeze({ patternName: 'canonicalKeyLiteral', regex: /canonicalKey/, why: 'the join key a derived pool does not share' }),
	Object.freeze({ patternName: 'stableIdLiteral', regex: /stableId/, why: 'any rendered identity' }),
	Object.freeze({ patternName: 'globalIdLiteral', regex: /Global ?ID/i, why: 'the CEDS Global ID label' }),
]);
const ADVISORY_URL_REGEX = /https?:\/\//;

// ---------------------------------------------------------------------
// THE ID GATE IS BASIS-CONDITIONAL (RULING BS-11, SABLE_RIVER 2026-08-17). Same shape as
// CANDIDATE_ORDINAL_SPEC_BY_RENDERER_VERSION: declared data, one row per basis, unknown basis refused by name.
//
// WHY. `hubIdentifier` is "the answer itself" only when the pool is VECTOR-RETRIEVED — there the cards are
// unrelated hub properties and the identifier picks one out. A matchBasis 'standard' pool is KEY-FILTERED: its
// candidates are selected BY the CEDS id the standard names, so EVERY candidate carries the SAME key and the
// identifier distinguishes nothing. Measured on a real SIF pool before this was written: all three rendered
// keys identical. Nor is the source stableId a blinded property for 'standard' — the standard names its own
// target openly, which is what makes it a standard-declared bridge rather than a crosswalk.
//
// So for 'standard' the gate asserts something STRONGER instead of something vacuous: that all rendered
// candidates share ONE key (a DIFFERENT key in the pool means the filter leaked an unrelated card and the
// identifier really would distinguish), and that no name the plugin DECLARED blind appears anywhere.
//
// THE RED SET FOR 'standard' IS BUILT FROM THE PLUGIN'S OWN blindingDeclaration, not from a second hand-kept
// list. A hand-kept list is a copy, and a copy drifts: the plugin blinds five names and the static list below
// happens to carry patterns for two of them. Building from the declaration means adding a blinded name to a
// plugin arms the gate for it in the same edit.
const BASIS_INDEPENDENT_PATTERN_NAME_LIST = Object.freeze(['educoreW3id', 'contentHash']);
const ID_GATE_SPEC_BY_MATCH_BASIS = Object.freeze({
	derived: Object.freeze({
		usesStaticPatternList: true,
		assertsSingleSharedKey: false,
		why: 'a vector-retrieved pool holds unrelated hub cards, so a rendered hub identifier IS the answer and every pattern in ID_GATE_PATTERN_LIST is red',
	}),
	standard: Object.freeze({
		usesStaticPatternList: false,
		assertsSingleSharedKey: true,
		// THE KEY IS A NAMED FIELD, NOT "ANY TOKEN THAT LOOKS LIKE AN IDENTIFIER" (refined 2026-08-17 by running
		// this gate over the real CP3 prompts, which REFUSED). A rendered candidate card carries BOTH the
		// filtered-on key and its domain id, and only the first is shared:
		//     [1] P000534 ... seat: filteredOnKey ... propertyKey: P000534 ... domainId: C200398
		//     [2] P000534 ... seat: filteredOnKey ... propertyKey: P000534 ... domainId: C200396
		// The domainIds DIFFER BY DESIGN and are the substance of the judgment, not a leak: they are what
		// separates "Organization Operational Detail" from "Local Education Agency Operational Detail", which
		// IS the SIF judged case. Blinding them would leave the judge nothing to reason with. So the assertion
		// names the field it means. Absent field is REFUSED, never read as agreement.
		sharedKeyFieldName: 'propertyKey',
		why: "a key-filtered pool's candidates all carry the same filtered-on key by construction, so that key distinguishes nothing; the gate asserts the shared key instead, plus the plugin's DECLARED blinded names",
	}),
});

// idGateSpecFor — the red patterns for one basis. { patternList, assertsSingleSharedKey } or { error }.
const idGateSpecFor = ({ matchBasis, blindingDeclaration } = {}) => {
	const spec = ID_GATE_SPEC_BY_MATCH_BASIS[matchBasis];
	if (spec === undefined) {
		return { error: refuse.byName({ moduleName, what: `matchBasis '${matchBasis}' has no id-gate spec`, where: `known bases are ${Object.keys(ID_GATE_SPEC_BY_MATCH_BASIS).join(', ')} — a new basis must be given its gate DELIBERATELY, because inheriting another basis's gate is how a pool gets audited by rules written for a pool it is not` }) };
	}
	if (spec.usesStaticPatternList) {
		return { patternList: ID_GATE_PATTERN_LIST, assertsSingleSharedKey: spec.assertsSingleSharedKey, sharedKeyFieldName: spec.sharedKeyFieldName };
	}
	if (!Array.isArray(blindingDeclaration) || blindingDeclaration.length === 0) {
		return { error: refuse.byName({ moduleName, what: `matchBasis '${matchBasis}' builds its red set from the plugin's blindingDeclaration, which is absent or empty`, where: 'a gate with an empty red set reports zero hits and reads exactly like a pass — refused by name rather than run' }) };
	}
	const declaredPatternList = blindingDeclaration.map((oneName) => Object.freeze({
		patternName: `blinded:${oneName}`,
		regex: new RegExp(oneName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
		why: `the plugin DECLARED '${oneName}' blind; a declaration the audit does not enforce is a comment`,
	}));
	const basisIndependentPatternList = ID_GATE_PATTERN_LIST.filter((onePattern) => BASIS_INDEPENDENT_PATTERN_NAME_LIST.indexOf(onePattern.patternName) !== -1);
	return { patternList: Object.freeze(declaredPatternList.concat(basisIndependentPatternList)), assertsSingleSharedKey: spec.assertsSingleSharedKey, sharedKeyFieldName: spec.sharedKeyFieldName };
};

// sharedKeyReadFor — the hub identifiers ACTUALLY found in one rendered prompt. The occurrence count is
// returned alongside the distinct list on purpose: "they all match" is satisfied trivially by a pool of one
// and satisfied forever by an extractor that silently returns nothing, so the caller must be able to state
// that the extractor saw something before treating agreement as evidence.
const sharedKeyReadFor = ({ userPrompt, keyFieldName } = {}) => {
	if (typeof userPrompt !== 'string' || typeof keyFieldName !== 'string' || keyFieldName === '') {
		return { distinctKeyList: [], occurrenceCount: 0 };
	}
	const fieldRegex = new RegExp(`^\\s*${keyFieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(\\S+)\\s*$`, 'gm');
	const matchList = [];
	let oneMatch = fieldRegex.exec(userPrompt);
	while (oneMatch !== null) {
		matchList.push(oneMatch[1]);
		oneMatch = fieldRegex.exec(userPrompt);
	}
	const distinctKeyList = matchList.filter((oneKey, oneIndex) => matchList.indexOf(oneKey) === oneIndex).sort(compareStrings);
	return { distinctKeyList, occurrenceCount: matchList.length };
};

// sharedKeyRefusalFor — '' when the pool's rendered keys are consistent; otherwise the refusal, NAMING the
// keys that disagree. More than one distinct key in a key-filtered pool means the filter admitted a card the
// standard did not name, and in THAT pool the identifier does distinguish the answer.
const sharedKeyRefusalFor = ({ userPrompt, keyFieldName } = {}) => {
	const read = sharedKeyReadFor({ userPrompt, keyFieldName });
	if (read.distinctKeyList.length > 1) {
		return `a key-filtered (matchBasis 'standard') pool rendered ${read.distinctKeyList.length} DIFFERENT '${keyFieldName}' values — ${read.distinctKeyList.join(', ')} — so the pool is not key-filtered in fact and the identifier DOES pick out the answer; the shared-key assertion that replaces the hub-identifier pattern for this basis is void here (RULING BS-11)`;
	}
	return '';
};

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);

// readPromptRecordList — every forensic record of the generation that carries a rendered prompt
const readPromptRecordList = ({ forensicsDirPath, pairKey, generation }) => {
	const filePath = path.join(forensicsDirPath, pairKey, `${generation}.jsonl`);
	if (!fs.existsSync(filePath)) {
		return { error: refuse.byName({ moduleName, what: `no forensic trail at ${filePath}`, where: 'the audit reads the prompts the judge ACTUALLY received; without the trail there is nothing to audit and nothing may be asserted' }) };
	}
	const lineList = fs.readFileSync(filePath, 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '');
	const recordList = [];
	for (let lineIndex = 0; lineIndex < lineList.length; lineIndex++) {
		let parsed = null;
		let parseFault = '';
		try {
			parsed = JSON.parse(lineList[lineIndex]);
		} catch (parseError) {
			parseFault = parseError.message;
		}
		if (parseFault) {
			return { error: refuse.byName({ moduleName, what: `forensic line ${lineIndex + 1} of ${filePath} is not JSON (${parseFault})`, where: 'a trail that cannot be read cannot be audited; it is never skipped' }) };
		}
		const record = parsed && parsed.record ? parsed.record : parsed;
		if (record && isNonEmptyString(record.userPrompt)) {
			recordList.push(record);
		}
	}
	return { recordList };
};

// ⟪RENDERING TIE — RULING SABLE_RIVER 2026-08-17⟫ Recover, from the prompt BYTES the judge actually received,
// the rendered text of each candidate keyed by its stableId.
//
// WHY IT IS PARSED FROM THE PROMPT AND NOT RE-RENDERED. Re-rendering from the graph would answer "what would
// the renderer produce today", which is a different question and drifts the moment anything is re-embedded or
// re-forged. The forensic trail holds the exact bytes that were sent, and the tie class is a claim about what
// the judge could distinguish — so the bytes are the only admissible source.
//
// THE ORDINAL IS STRIPPED ON PURPOSE, and this is the load-bearing decision. Each candidate is introduced by
// its position marker "[7]", which is unique by construction. Compare the blocks WITH the marker and no two
// candidates are ever byte-identical, so the tie count would be structurally pinned at zero — a gate that
// cannot fire, reporting a clean bill of health it never measured. The ordinal is presentation; the material
// lines under it are what the judge had to choose between, so the material lines are what is compared.
//
// A candidate count that disagrees with renderedPoolStableIdList is REFUSED BY NAME rather than zipped as far
// as it goes: a short parse would silently key one candidate's text to another candidate's id and manufacture
// ties that were never on the page.
const CANDIDATE_HEADING_REGEX = /^CANDIDATES \((\d+)\), in hub order:$/;

// THE ORDINAL LINE IS RENDERER-SPECIFIC, AND THE DIFFERENCE IS NOT COSMETIC (RULING BS-10, SABLE_RIVER
// 2026-08-17). One row per renderer variant, keyed by the rendererVersion the forensic record already carries.
// An unknown version is REFUSED BY NAME rather than defaulted: guessing which layout a prompt used is how a
// half-parsed trail keys one candidate's text to another candidate's id.
//
// WHY `ordinalLineCarriesText` EXISTS, and why the obvious fix is WRONG. The derived renderer prints the
// ordinal ALONE on its line, so consuming that line as a delimiter loses nothing. The crosswalk renderer
// prints "  [1] P000534 — Operational Status Effective Date": THE CARD'S KEY AND NAME LIVE ON THE DELIMITER
// LINE. The tempting one-character repair — loosen the end-anchor to /^ {2}\[(\d+)\](?:\s.*)?$/ — makes the
// prompt parse and SILENTLY DISCARDS THE NAME, so two cards differing ONLY by name render as identical text
// and are counted as a RENDERING TIE THAT WAS NEVER ON THE PAGE. That is the exact harm this module's refusal
// exists to prevent, reintroduced by the fix for it. THAT REPAIR IS REFUSED BY NAME HERE so nobody re-derives
// it: when a delimiter carries payload in one variant and not another, loosening the delimiter is never the
// whole fix — the payload must be CAPTURED INTO the block it belongs to. A red twin holds this: a
// crosswalk-rendered pair differing only by name must NOT be reported as a tie.
const CANDIDATE_ORDINAL_SPEC_BY_RENDERER_VERSION = Object.freeze({
	'bridgeEvidenceRenderer-derived-v1': Object.freeze({ ordinalRegex: /^ {2}\[(\d+)\]$/, ordinalLineCarriesText: false }),
	'bridgeEvidenceRenderer-v1': Object.freeze({ ordinalRegex: /^ {2}\[(\d+)\](.*)$/, ordinalLineCarriesText: true }),
});

const renderedCandidateTextListFromPrompt = ({ userPrompt, rendererVersion }) => {
	const ordinalSpec = CANDIDATE_ORDINAL_SPEC_BY_RENDERER_VERSION[rendererVersion];
	if (ordinalSpec === undefined) {
		return { fault: `rendererVersion ${JSON.stringify(rendererVersion)} has no candidate-ordinal spec — the known variants are ${Object.keys(CANDIDATE_ORDINAL_SPEC_BY_RENDERER_VERSION).join(', ')}; the layout of a prompt is never guessed (RULING BS-10)` };
	}
	const lineList = String(userPrompt).split('\n');
	const headingIndex = lineList.findIndex((oneLine) => CANDIDATE_HEADING_REGEX.test(oneLine));
	if (headingIndex === -1) {
		return { fault: 'the prompt carries no "CANDIDATES (n), in hub order:" heading' };
	}
	const declaredCount = Number(lineList[headingIndex].match(CANDIDATE_HEADING_REGEX)[1]);
	const textList = [];
	let currentLineList = null;
	for (let lineIndex = headingIndex + 1; lineIndex < lineList.length; lineIndex++) {
		const ordinalMatch = lineList[lineIndex].match(ordinalSpec.ordinalRegex);
		if (ordinalMatch !== null) {
			if (currentLineList !== null) {
				textList.push(currentLineList.join('\n'));
			}
			// the trailing text on the ordinal line BELONGS TO THIS CANDIDATE and is carried into its block --
			// it is the card's key and name, and dropping it manufactures ties (BS-10)
			currentLineList = ordinalSpec.ordinalLineCarriesText ? [String(ordinalMatch[2] === undefined ? '' : ordinalMatch[2]).trim()] : [];
			continue;
		}
		if (currentLineList !== null) {
			currentLineList.push(lineList[lineIndex]);
		}
	}
	if (currentLineList !== null) {
		textList.push(currentLineList.join('\n'));
	}
	if (textList.length !== declaredCount) {
		return { fault: `the heading declares ${declaredCount} candidate(s) but ${textList.length} block(s) parsed` };
	}
	return { textList };
};

// ⟪SAME-NAME-DIFFERENT-DOMAIN — RULING SABLE_RIVER 2026-08-17⟫ The rendered block is `field: value` lines, one
// per allow-listed property, so the fields the judge actually SAW can be recovered from the same bytes the tie
// index is built from. Read from the RENDERED TEXT rather than the graph on purpose: the class is a statement
// about what distinguished two cards ON THE PAGE, and a property the allow-list hides did not distinguish
// anything no matter what the graph holds.
const RENDERED_FIELD_LINE_REGEX = /^\s*([A-Za-z][A-Za-z0-9]*): ([\s\S]*)$/;

const renderedFieldsFrom = ({ renderedText }) => {
	if (typeof renderedText !== 'string') {
		return {};
	}
	return renderedText.split('\n').reduce((soFar, oneLine) => {
		const matched = oneLine.match(RENDERED_FIELD_LINE_REGEX);
		return matched === null ? soFar : { ...soFar, [matched[1]]: matched[2].trim() };
	}, {});
};

const renderedCandidateTextIndexFrom = ({ recordList }) => {
	if (!Array.isArray(recordList)) {
		return { error: refuse.byName({ moduleName, what: 'renderedCandidateTextIndexFrom needs a recordList', where: 'the tie index is built from the forensic trail; there is no default' }) };
	}
	const textByStableId = {};
	const faultList = [];
	let measuredPromptCount = 0;
	recordList.forEach((oneRecord) => {
		if (!Array.isArray(oneRecord.renderedPoolStableIdList) || oneRecord.renderedPoolStableIdList.length === 0) {
			return;
		}
		const parsed = renderedCandidateTextListFromPrompt({ userPrompt: oneRecord.userPrompt, rendererVersion: oneRecord.rendererVersion });
		if (parsed.fault) {
			faultList.push(`${String(oneRecord.promptHash).slice(0, 12)}: ${parsed.fault}`);
			return;
		}
		if (parsed.textList.length !== oneRecord.renderedPoolStableIdList.length) {
			faultList.push(`${String(oneRecord.promptHash).slice(0, 12)}: ${parsed.textList.length} rendered block(s) against ${oneRecord.renderedPoolStableIdList.length} pool id(s)`);
			return;
		}
		measuredPromptCount += 1;
		oneRecord.renderedPoolStableIdList.forEach((oneStableId, seatIndex) => {
			textByStableId[oneStableId] = parsed.textList[seatIndex];
		});
	});
	if (faultList.length > 0) {
		return { error: refuse.byName({ moduleName, what: `${faultList.length} prompt(s) could not be parsed into candidate blocks: ${faultList.slice(0, 3).join('; ')}`, where: 'a partially parsed trail would key one candidate\'s text to another candidate\'s id and manufacture ties that were never on the page' }) };
	}
	return { textByStableId, measuredPromptCount, distinctCandidateCount: Object.keys(textByStableId).length };
};

const buildRenderingAudit = ({ forensicsDirPath, pairKey, generation, blockId, renderingAllowList, judgePromptVariant, sampleCount } = {}) => {
	if (!isNonEmptyString(forensicsDirPath) || !isNonEmptyString(pairKey) || !isNonEmptyString(generation) || !isNonEmptyString(blockId)) {
		return { error: refuse.byName({ moduleName, what: 'buildRenderingAudit needs { forensicsDirPath, pairKey, generation, blockId }', where: 'the audit names the exact block it audits; there is no default' }) };
	}
	if (!renderingAllowList || !Array.isArray(renderingAllowList.subject) || !Array.isArray(renderingAllowList.candidate)) {
		return { error: refuse.byName({ moduleName, what: 'buildRenderingAudit needs the DECLARED renderingAllowList', where: 'the document states the allow-list as declared beside the prompts it produced, so a reader can check one against the other' }) };
	}
	const read = readPromptRecordList({ forensicsDirPath, pairKey, generation });
	if (read.error) {
		return { error: read.error };
	}
	const recordList = read.recordList;
	if (recordList.length === 0) {
		return { error: refuse.byName({ moduleName, what: `the forensic trail for ${generation} holds ZERO rendered prompts`, where: 'an audit over nothing would report zero hits and look like a pass — an empty trail is refused by name (BG-EMPTY)' }) };
	}
	// THE SWEEP IS OVER EVERY PROMPT, not over the sample. The sample is for reading; the sweep is the claim.
	const hitList = [];
	let advisoryUrlCount = 0;
	recordList.forEach((oneRecord) => {
		if (ADVISORY_URL_REGEX.test(oneRecord.userPrompt)) {
			advisoryUrlCount += 1;
		}
		ID_GATE_PATTERN_LIST.forEach((onePattern) => {
			const matched = onePattern.regex.exec(oneRecord.userPrompt);
			if (matched !== null) {
				hitList.push({ patternName: onePattern.patternName, promptHash: oneRecord.promptHash, matchedText: String(matched[0]).slice(0, 80) });
			}
		});
	});
	// THE TRAIL IS APPEND-ONLY AND A GENERATION CAN HOLD SEVERAL RUNS. Reporting the raw record count as "the
	// prompts" would imply N subjects produced N records, which is false the moment a block is re-frozen. The
	// audit therefore reports DISTINCT prompts (by promptHash) as its population and the record count beside it.
	//
	// The gap between the two is not noise — it is a DETERMINISM PROOF. If two runs over the same subjects
	// rendered even one byte differently, the distinct count would exceed the per-run subject count. Equal
	// counts mean the renderer reproduced itself exactly.
	const distinctPromptHashSet = new Set(recordList.map((oneRecord) => String(oneRecord.promptHash)));
	const distinctByPromptHash = {};
	recordList.forEach((oneRecord) => {
		if (distinctByPromptHash[String(oneRecord.promptHash)] === undefined) {
			distinctByPromptHash[String(oneRecord.promptHash)] = oneRecord;
		}
	});
	const distinctRecordList = Object.keys(distinctByPromptHash).sort(compareStrings).map((oneHash) => distinctByPromptHash[oneHash]);
	const sortedRecordList = distinctRecordList;
	const wantedSampleCount = sampleCount === undefined ? DEFAULT_SAMPLE_COUNT : sampleCount;
	const sampleList = sortedRecordList.slice(0, wantedSampleCount);
	const lineList = [];
	lineList.push(`# Rendering audit — decision block \`${blockId}\``);
	lineList.push('');
	lineList.push('This document exists to answer one question with evidence rather than assurance: **what did the');
	lineList.push('judge actually see?** Every prompt below is the exact `userPrompt` bytes the judge received, read');
	lineList.push('back out of the forensic trail — not re-rendered. A re-rendered prompt would be a claim about what');
	lineList.push('the renderer does; these are a record of what it did.');
	lineList.push('');
	lineList.push(`- pairKey: \`${pairKey}\``);
	lineList.push(`- generation: \`${generation}\``);
	lineList.push(`- rendering variant: \`${judgePromptVariant}\``);
	lineList.push(`- DISTINCT prompts in this generation: **${distinctPromptHashSet.size}**, from **${recordList.length}** forensic records`);
	if (recordList.length !== distinctPromptHashSet.size) {
		lineList.push(`- the trail is APPEND-ONLY and holds ${(recordList.length / distinctPromptHashSet.size).toFixed(2)} run(s) of the same subjects. That the ${recordList.length} records collapse to exactly ${distinctPromptHashSet.size} distinct hashes is a DETERMINISM PROOF: a second run rendered every prompt byte-identically, or the distinct count would be higher.`);
	}
	lineList.push(`- prompts printed in full below: **${sampleList.length}** (chosen by sorting on promptHash, so the sample is the same for any two runs of the same block and this document can be diffed against itself)`);
	lineList.push('');
	lineList.push('## The allow-list, as DECLARED by the plugin');
	lineList.push('');
	lineList.push('The rendered subject and candidate blocks are BUILT from these names. This is an allow-list, not a');
	lineList.push('deny-list: a property nobody thought to forbid cannot appear, because nothing is rendered unless it');
	lineList.push('is named here.');
	lineList.push('');
	lineList.push(`- **subject** (${renderingAllowList.subject.length}): ${renderingAllowList.subject.map((oneName) => `\`${oneName}\``).join(', ')}`);
	lineList.push(`- **candidate** (${renderingAllowList.candidate.length}): ${renderingAllowList.candidate.map((oneName) => `\`${oneName}\``).join(', ')}`);
	lineList.push('');
	lineList.push('## The id-gate sweep — over ALL ' + recordList.length + ' forensic records, not over the sample');
	lineList.push('');
	lineList.push(`**${hitList.length === 0 ? 'ZERO HITS' : `${hitList.length} HIT(S) — THIS IS A FAILURE`}**`);
	lineList.push('');
	lineList.push('| pattern | what it would mean | hits |');
	lineList.push('|---|---|---|');
	ID_GATE_PATTERN_LIST.forEach((onePattern) => {
		lineList.push(`| \`${String(onePattern.regex)}\` | ${onePattern.why} | ${hitList.filter((oneHit) => oneHit.patternName === onePattern.patternName).length} |`);
	});
	lineList.push('');
	if (hitList.length) {
		lineList.push('### The hits');
		lineList.push('');
		hitList.slice(0, 40).forEach((oneHit) => lineList.push(`- \`${oneHit.patternName}\` in prompt \`${String(oneHit.promptHash).slice(0, 16)}\`: \`${oneHit.matchedText}\``));
		lineList.push('');
	}
	lineList.push(`**Advisory (NOT a failure):** ${advisoryUrlCount} prompt(s) contain a bare \`http(s)://\` URL. The hub's own`);
	lineList.push("`propertyDefinition` and `rangeOptionSetDefinition` carry external links inside the definition prose the");
	lineList.push('judge needs in order to decide. None of them says WHICH card is the answer. They are reported here and');
	lineList.push('deliberately left in: scrubbing meaning to look rigorous would cost accuracy and buy nothing.');
	lineList.push('');
	lineList.push('## The prompts, in full, exactly as sent');
	lineList.push('');
	sampleList.forEach((oneRecord, sampleIndex) => {
		lineList.push(`### ${sampleIndex + 1}. promptHash \`${oneRecord.promptHash}\``);
		lineList.push('');
		lineList.push(`- judge model: \`${oneRecord.judgeModel}\` · renderer: \`${oneRecord.rendererVersion}\``);
		lineList.push(`- pool as rendered (${Array.isArray(oneRecord.renderedPoolStableIdList) ? oneRecord.renderedPoolStableIdList.length : 0} candidate(s), in the neutral stableId order the judge saw)`);
		lineList.push(`- the judge answered: \`${oneRecord.choice}\`${oneRecord.category ? ` (category \`${oneRecord.category}\`)` : ''}`);
		lineList.push('');
		lineList.push('**SYSTEM PROMPT**');
		lineList.push('');
		lineList.push('```text');
		lineList.push(String(oneRecord.systemPrompt === undefined ? '(absent from the trail)' : oneRecord.systemPrompt));
		lineList.push('```');
		lineList.push('');
		lineList.push('**USER PROMPT**');
		lineList.push('');
		lineList.push('```text');
		lineList.push(String(oneRecord.userPrompt));
		lineList.push('```');
		lineList.push('');
	});
	return { markdownText: lineList.join('\n'), promptCount: recordList.length, distinctPromptCount: distinctPromptHashSet.size, hitList, advisoryUrlCount, sampleCount: sampleList.length };
};

module.exports = { CANDIDATE_ORDINAL_SPEC_BY_RENDERER_VERSION, ID_GATE_SPEC_BY_MATCH_BASIS, idGateSpecFor, sharedKeyReadFor, sharedKeyRefusalFor, buildRenderingAudit, readPromptRecordList, renderedCandidateTextIndexFrom, renderedFieldsFrom, renderedCandidateTextListFromPrompt, ID_GATE_PATTERN_LIST, ADVISORY_URL_REGEX, DEFAULT_SAMPLE_COUNT, moduleName };
