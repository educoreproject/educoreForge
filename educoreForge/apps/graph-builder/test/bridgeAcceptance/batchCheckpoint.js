#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// batchCheckpoint.js — the D3 BATCH CHECKPOINT document (PLAN-derivedBridge-v1.md §0; RULING §11.12).
//
// TQ: "Then demonstrate correct function on a --limit subset, maybe ten at a time." A batch is not a log
// line, it is a DOCUMENT a person reads before the next ten are released: for every subject, the exact prompt
// that was sent, the pool as it was rendered, the pick or the abstention, the judge's own rationale, the
// confidence, and THE TRUTH ANSWER BESIDE IT.
//
// It also computes the MECHANICAL CLEAN-CHECKLIST (§11.12), which is the falsifiable half of "clean batch":
//   all N judged-or-abstained · 0 framework refusals · 0 id-gate hits · 0 second-violation re-asks ·
//   every pick's ordinal maps to a rendered candidate · forensics complete
// The supervisor's semantic read — are these picks plausible? — is the ADVISORY half and is theirs, not this
// file's. A checklist that tried to judge quality would be a checklist nobody could argue with.
//
//   node .../batchCheckpoint.js --bridgeName=edfiCedsDerivedPlugin --offset=0 [--batchSize=10]
//
// READ-ONLY. Reads the derived block, the forensic trail and the truth block by path. Builds nothing.

const fs = require('fs');
const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- write the D3 batch checkpoint document for one released batch

SYNOPSIS
     ${moduleName} --bridgeName=<plugin> --offset=<n> [--batchSize=10] [--blockId=<64-hex|latest>]

EXIT STATUS
     0 written (the checklist verdict is IN the document);  1 refused by name.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const derivedEvalLib = require('./derivedEval');
const renderingAuditLib = require('./renderingAudit');
const recordDispositionLib = require(path.join(__dirname, 'recordDisposition'));

const ACCEPTANCE_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'acceptanceCommands.jsonc');
// THE REFERENCE BLOCK IS DECLARED DATA, NOT A MODULE CONSTANT (RULING BS-8, SABLE_RIVER 2026-08-17). It used
// to be two hardcoded paths, which made this document generator serve exactly one plugin. The acceptance entry
// now declares `referenceStoreFilePath`, `referenceBlockId` and `referenceRole`, and the module REFUSES BY NAME
// for a plugin that declares none — one instrument for every plugin instead of two instruments drifting apart
// about what "clean" means.
//
// THE ROLE IS THE POINT, and it is not cosmetic. For the DERIVED plugin the crosswalk is an ANSWER KEY: a human
// decided, and a differing pick is a disagreement with a decision. For the SIF standard-declared plugin THERE IS
// NO ANSWER KEY AT ALL — its judged cases are exactly where the standard names a CEDS property by id and several
// hub cards carry that property in different DOMAINS, so the standard names the property and not the class.
// Pointing this generator at the same block under the word "truth" would produce a document with the same
// columns and the same confident layout whose central claim had quietly changed meaning. So the role selects the
// VOCABULARY, from a table: `truth` says MATCHES/DIFFERS FROM TRUTH; `comparison` says AGREES WITH / DIFFERS
// FROM THE CROSSWALK and never once calls a differing pick wrong.
const REFERENCE_ROLE_LIST = Object.freeze(['truth', 'comparison']);
const REFERENCE_VOCABULARY_BY_ROLE = Object.freeze({
	truth: Object.freeze({
		columnHeading: 'truth says',
		absentText: '_no truth object — this subject is a NEW CLAIM, not a right or wrong answer_',
		agreesText: '**MATCHES TRUTH**',
		differsText: '**DIFFERS FROM TRUTH**',
		abstainedText: 'the judge abstained where truth names an object',
		orphanText: 'NO CANDIDATE CARD EXISTED for this subject — the judge was never asked, so this is a coverage gap and not reticence (RULING BS-13)',
		tieCardName: 'TRUTH card',
		tieAbsentText: ' — the truth card is NOT among them, so this did not cost the pick',
		tiePresentText: ' — **the TRUTH card is among them**; this pick could not have been made on the merits',
		summaryLead: "Against truth, for the supervisor's read only",
		agreeWord: 'matching truth',
		differWord: 'differing',
		tieSentence: "differing pick(s) whose TRUTH card was rendered byte-identically to another candidate in the same pool. These are not judge errors; the right answer was on the page wearing someone else's face.",
	}),
	comparison: Object.freeze({
		columnHeading: 'COMPARISON — the Ed-Fi crosswalk chose',
		absentText: '_no crosswalk row for this key — there is nothing to compare against, and that is NOT a mark against the pick_',
		agreesText: '**AGREES WITH THE CROSSWALK**',
		differsText: '**DIFFERS FROM THE CROSSWALK** (a disagreement, NOT an error — see the note at the head of this document)',
		abstainedText: 'the judge abstained where the crosswalk names an object',
		orphanText: 'NO CANDIDATE CARD EXISTED for this subject — the judge was never asked, so this is a coverage gap and not reticence (RULING BS-13)',
		tieCardName: "the crosswalk's card",
		tieAbsentText: " — the crosswalk's card is NOT among them, so this did not cost the pick",
		tiePresentText: " — **the crosswalk's card is among them**; this pick could not have been made on the merits",
		summaryLead: "Against the Ed-Fi crosswalk, for the supervisor's read only — THIS STANDARD HAS NO ANSWER KEY, so these are agreements and disagreements, never right and wrong",
		agreeWord: 'agreeing with the crosswalk',
		differWord: 'differing from it',
		tieSentence: "differing pick(s) whose CROSSWALK card was rendered byte-identically to another candidate in the same pool. These are not judge errors; the card it disagreed with was on the page wearing someone else's face.",
	}),
});
const DEFAULT_BATCH_SIZE = 10;

const firstValue = (name) => (Array.isArray(commandLineParameters.values[name]) ? commandLineParameters.values[name][0] : commandLineParameters.values[name]);
const refuse = (what) => {
	xLog.error(`${moduleName} REFUSED: ${what}`);
	process.exit(1);
};

const bridgeName = firstValue('bridgeName');
const offsetValue = firstValue('offset');
if (typeof bridgeName !== 'string' || bridgeName === '' || !/^\d+$/.test(String(offsetValue))) {
	refuse('--bridgeName and --offset=<non-negative integer> are both required; a batch document names the batch it documents');
}
const batchSize = firstValue('batchSize') === undefined ? DEFAULT_BATCH_SIZE : Number(firstValue('batchSize'));
const acceptanceCommands = JSON.parse(fs.readFileSync(ACCEPTANCE_FILE_PATH, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const entry = acceptanceCommands[bridgeName];
if (entry === undefined) {
	refuse(`acceptanceCommands.jsonc names no bridge '${bridgeName}'`);
}
// THE REFERENCE DECLARATION IS CHECKED HERE, before ANY block is read, for two reasons. It is a
// CONFIGURATION fault and configuration faults belong before I/O. And it is the only position from which the
// refusal is REACHABLE: checked later, the downstream "block is not a partial window" guard fires first and
// this one can never be observed red — an unproven gate wearing the appearance of a proven one.
if (typeof entry.referenceStoreFilePath !== 'string' || typeof entry.referenceBlockId !== 'string' || REFERENCE_ROLE_LIST.indexOf(entry.referenceRole) === -1) {
	refuse(`'${bridgeName}' declares no reference block for its batch document — acceptanceCommands.jsonc must carry referenceStoreFilePath, referenceBlockId and referenceRole (one of ${REFERENCE_ROLE_LIST.join(', ')}). A batch document without a reference column is not a shorter document, it is a document that stopped asking the question (RULING BS-8)`);
}
const referenceVocabulary = REFERENCE_VOCABULARY_BY_ROLE[entry.referenceRole];
const bridgeDeclaration = require(path.join(__dirname, '..', '..', '..', '..', 'forges', entry.standardKey, 'bridges', `${bridgeName}.js`)).bridgeDeclaration;

const askedBlockId = firstValue('blockId');
const blockRead = derivedEvalLib.readFrozenBlock({
	storeFilePath: entry.decisionStoreFilePath,
	blockId: askedBlockId === undefined || askedBlockId === 'latest' ? undefined : askedBlockId,
	roleName: 'derived',
});
if (blockRead.error) {
	refuse(blockRead.error.message);
}
const block = blockRead.block;
const header = block.header;

// ⟪SILENT WRONG ARTIFACT — caught in the act, GRANITE_VALLEY 2026-08-17⟫ --blockId defaults to LATEST, so
// `--offset=0` run after a later window had been frozen cheerfully documented the LATEST block and wrote it
// over batch-0.md. Nothing errored; the file simply became a document about a different window wearing the
// old window's name. The offset the caller asked for is a CLAIM about which window this document describes,
// and it is now CHECKED against the block's own sourceWindow rather than trusted.
const declaredWindowText = String(header.sourceWindow === undefined ? '' : header.sourceWindow);
const offsetMatch = declaredWindowText.match(/offset[=_]?(\d+)/i);
if (offsetMatch === null) {
	refuse(`the block's sourceWindow ${JSON.stringify(declaredWindowText)} names no offset — a batch document may only be written for a PARTIAL windowed block`);
}
if (Number(offsetMatch[1]) !== Number(offsetValue)) {
	refuse(`--offset=${offsetValue} was asked for but block ${blockRead.blockId} is the window at offset ${offsetMatch[1]} (${declaredWindowText}); pass --blockId=<the block for offset ${offsetValue}> explicitly — the default resolves to the LATEST block, never to the offset`);
}

// A BATCH DOCUMENT MUST DOCUMENT A PARTIAL BLOCK. If the block carries no window mark it is a FULL freeze and
// documenting it as "batch n" would misdescribe what was judged — the exact confusion §11.12's PARTIAL guard
// exists to prevent one layer down.
if (typeof header.sourceWindow !== 'string' || header.sourceWindow.indexOf('PARTIAL_WINDOW') === -1) {
	refuse(`block ${blockRead.blockId} carries sourceWindow ${JSON.stringify(header.sourceWindow)} — a batch checkpoint documents a WINDOWED (PARTIAL) block; this one is a full freeze`);
}

const truthRead = derivedEvalLib.readFrozenBlock({ storeFilePath: entry.referenceStoreFilePath, blockId: entry.referenceBlockId, roleName: entry.referenceRole });
if (truthRead.error) {
	refuse(truthRead.error.message);
}
const truth = derivedEvalLib.truthViewOf(truthRead.block);

const forensicsRead = renderingAuditLib.readPromptRecordList({
	forensicsDirPath: entry.matchForensicsDirPath,
	pairKey: `${header.hubName.toLowerCase()}@${header.hubVersion}::${header.sourceStandardName.toLowerCase()}@${header.sourceVersion}::${header.bridgeName}::${header.producerKind}`,
	generation: header.generation,
});
if (forensicsRead.error) {
	refuse(forensicsRead.error.message);
}
const forensicByPromptHash = forensicsRead.recordList.reduce((soFar, oneRecord) => ({ ...soFar, [String(oneRecord.promptHash)]: oneRecord }), {});

// ⟪RENDERING TIE + CUMULATIVE RE-ASK — RULING SABLE_RIVER 2026-08-17⟫
//
// The ruled class: a pick that DIFFERS from truth, where the TRUTH card was rendered byte-identically to at
// least one other candidate IN THE SAME POOL, is a renderingTie rather than a wrong pick. The judge was shown
// the right answer and an indistinguishable twin and asked to choose; getting it wrong is luck, not error, and
// the number measures what the allow-list costs.
//
// SCOPED TO THE POOL, deliberately. Two cards with identical text that never appeared in the same prompt were
// never a choice anyone had to make; counting them would inflate the number with pairs the judge never saw.
// The corpus-wide collapse is reported separately below as context, not as cost.
//
// TWO NEIGHBOURING NUMBERS ARE REPORTED ALONGSIDE, because the ruled class alone cannot see them:
//   poolsWithTieCount    — pools containing ANY identical pair. Non-zero here with renderingTie zero means the
//                          blinding is collapsing cards, just not (yet) onto a truth card.
//   tiedPickCount        — the judge's OWN pick was one of >= 2 identical cards, so it cannot have been chosen
//                          on the merits even when it happens to be right.
// Both are observations for the supervisor, not additions to the ruled class.
const renderedTextIndex = renderingAuditLib.renderedCandidateTextIndexFrom({ recordList: forensicsRead.recordList });
if (renderedTextIndex.error) {
	refuse(renderedTextIndex.error.message);
}
const renderedTextByStableId = renderedTextIndex.textByStableId;

const recordList = block.decisionRecordList.slice().sort((leftRecord, rightRecord) => (leftRecord.subjectStableId < rightRecord.subjectStableId ? -1 : 1));
// RULING BS-13: the rule lives in recordDisposition.js so the suite tests THIS rule rather than a copy of it.
// isAbstained no longer absorbs orphans, and `hasObjectPick` — NOT `!isAbstained` — guards every pick-analysis
// site, because the two stopped being complements the moment orphan became its own outcome.
const isAbstained = (oneRecord) => recordDispositionLib.isAbstained(oneRecord);
const isOrphan = (oneRecord) => recordDispositionLib.isOrphan(oneRecord);
const hasObjectPick = (oneRecord) => recordDispositionLib.hasObjectPick(oneRecord);

const poolTextCountFor = (oneRecord) => {
	const countByText = {};
	(Array.isArray(oneRecord.renderedPoolStableIdList) ? oneRecord.renderedPoolStableIdList : []).forEach((oneStableId) => {
		const oneText = renderedTextByStableId[oneStableId];
		if (oneText !== undefined) {
			countByText[oneText] = (countByText[oneText] || 0) + 1;
		}
	});
	return countByText;
};
const hasPoolTie = (oneRecord) => {
	const countByText = poolTextCountFor(oneRecord);
	return Object.keys(countByText).some((oneText) => countByText[oneText] > 1);
};
const poolsWithTieList = recordList.filter(hasPoolTie);
const tiedPickList = recordList.filter((oneRecord) => {
	if (!hasObjectPick(oneRecord)) {
		return false;
	}
	const countByText = poolTextCountFor(oneRecord);
	const pickText = renderedTextByStableId[oneRecord.objectStableId];
	return pickText !== undefined && countByText[pickText] > 1;
});
const renderingTieList = recordList.filter((oneRecord) => {
	const truthSet = truth.objectSetBySubject[oneRecord.subjectStableId];
	if (!hasObjectPick(oneRecord) || truthSet === undefined || truthSet.has(oneRecord.objectStableId)) {
		return false;
	}
	// the predicate itself is derivedEval's, so the batch document and the score can never disagree on the class
	return derivedEvalLib.isRenderingTieRecord({ decisionRecord: oneRecord, truthObjectSet: truthSet, renderedTextByStableId });
});
const corpusTextCount = {};
Object.keys(renderedTextByStableId).forEach((oneStableId) => {
	const oneText = renderedTextByStableId[oneStableId];
	corpusTextCount[oneText] = (corpusTextCount[oneText] || 0) + 1;
});
const collapsedCardCount = Object.keys(renderedTextByStableId).length - Object.keys(corpusTextCount).length;
const largestIdenticalGroupSize = Object.keys(corpusTextCount).reduce((soFar, oneText) => Math.max(soFar, corpusTextCount[oneText]), 0);

// CUMULATIVE re-asks across every batch window judged so far. Read from the forensic trails on disk rather
// than carried in a running total: a counter written by each batch would drift the moment a batch was re-run,
// and the trails are the record. Windows are recognised by the PARTIAL_WINDOW generation naming.
const cumulativeReask = (() => {
	const pairDirPath = path.join(entry.matchForensicsDirPath, `${header.hubName.toLowerCase()}@${header.hubVersion}::${header.sourceStandardName.toLowerCase()}@${header.sourceVersion}::${header.bridgeName}::${header.producerKind}`);
	if (!fs.existsSync(pairDirPath)) {
		return { windowCount: 0, firstReaskCount: 0, secondViolationCount: 0, contaminatedWindowCount: 0, promptCount: 0 };
	}
	const windowFileList = fs.readdirSync(pairDirPath).filter((oneName) => oneName.indexOf('PARTIAL_WINDOW') !== -1 && oneName.endsWith('.jsonl'));
	return windowFileList.reduce((soFar, oneName) => {
		const oneRead = renderingAuditLib.readPromptRecordList({ forensicsDirPath: entry.matchForensicsDirPath, pairKey: path.basename(pairDirPath), generation: oneName.replace(/\.jsonl$/, '') });
		if (oneRead.error) {
			refuse(oneRead.error.message);
		}
		const countByHash = oneRead.recordList.reduce((innerSoFar, oneRecord) => ({ ...innerSoFar, [String(oneRecord.promptHash)]: (innerSoFar[String(oneRecord.promptHash)] || 0) + 1 }), {});
		// a window whose trail holds more records than distinct prompts + its own re-asks was written by more
		// than one run; its second-violation count is not attributable and is reported as such, never summed in
		const distinctPromptCount = Object.keys(countByHash).length;
		const oneFirstReaskCount = oneRead.recordList.filter((oneRecord) => oneRecord.reaskFollows === true).length;
		const oneIsContaminated = oneRead.recordList.length > distinctPromptCount + oneFirstReaskCount;
		return {
			windowCount: soFar.windowCount + 1,
			firstReaskCount: soFar.firstReaskCount + oneFirstReaskCount,
			secondViolationCount: soFar.secondViolationCount + (oneIsContaminated ? 0 : Object.keys(countByHash).filter((oneHash) => countByHash[oneHash] > 2).length),
			contaminatedWindowCount: soFar.contaminatedWindowCount + (oneIsContaminated ? 1 : 0),
			promptCount: soFar.promptCount + oneRead.recordList.length,
		};
	}, { windowCount: 0, firstReaskCount: 0, secondViolationCount: 0, contaminatedWindowCount: 0, promptCount: 0 });
})();

// ---- THE MECHANICAL CLEAN-CHECKLIST (§11.12) ----
// THE ID GATE IS BASIS-CONDITIONAL (RULING BS-11). The red set comes from the plugin's OWN matchBasis and
// blindingDeclaration, so a key-filtered pool is not audited by a rule written for a vector-retrieved one.
const idGateSpec = renderingAuditLib.idGateSpecFor({ matchBasis: bridgeDeclaration.matchBasis, blindingDeclaration: bridgeDeclaration.blindingDeclaration });
if (idGateSpec.error) {
	refuse(idGateSpec.error.message);
}
const idGateHitList = [];
forensicsRead.recordList.forEach((oneRecord) => {
	idGateSpec.patternList.forEach((onePattern) => {
		if (onePattern.regex.test(oneRecord.userPrompt)) {
			idGateHitList.push(`${onePattern.patternName} in ${String(oneRecord.promptHash).slice(0, 12)}`);
		}
	});
});
// For a key-filtered basis the shared-key assertion REPLACES hub-identifier-as-answer, and it is reported as
// its own checklist row rather than folded into the hit list: they answer different questions, and a reader
// must be able to see that the extractor saw keys at all before reading "they agree" as evidence.
const sharedKeyRefusalList = [];
let sharedKeyOccurrenceCount = 0;
if (idGateSpec.assertsSingleSharedKey) {
	forensicsRead.recordList.forEach((oneRecord) => {
		sharedKeyOccurrenceCount += renderingAuditLib.sharedKeyReadFor({ userPrompt: oneRecord.userPrompt, keyFieldName: idGateSpec.sharedKeyFieldName }).occurrenceCount;
		const refusalText = renderingAuditLib.sharedKeyRefusalFor({ userPrompt: oneRecord.userPrompt, keyFieldName: idGateSpec.sharedKeyFieldName });
		if (refusalText !== '') {
			sharedKeyRefusalList.push(`${String(oneRecord.promptHash).slice(0, 12)}: ${refusalText}`);
		}
	});
}
// RULING BS-12: the clean-checklist runs over the JUDGED SUBSET. Written for the derived order, whose blocks
// are 100 per cent classification 'judged', it silently assumed every record had been through a judge. A
// standard-declared plugin's block is mostly channel-asserted: SIF's CP3 batch-1 is 58 specified / 11 judged /
// 1 orphan, so "all 70 subjects judged-or-abstained" asked a question about 59 rows that no judge ever saw.
const judgedRecordList = recordList.filter((oneRecord) => oneRecord.classification === 'judged');
const specifiedRecordList = recordList.filter((oneRecord) => oneRecord.classification === 'specified');
const orphanRecordList = recordList.filter((oneRecord) => isOrphan(oneRecord));
// every JUDGED record reached a verdict — a pick or an abstention. A judged record in neither state is a
// record the judge was asked about and no answer was recorded for, which is the thing this row exists to find.
const judgedResolvedCount = judgedRecordList.filter((oneRecord) => hasObjectPick(oneRecord) || isAbstained(oneRecord)).length;

// THE RELEASED WINDOW, FROM THREE INDEPENDENT SOURCES (RULING BS-12). The block's own header says what was
// actually run; the runner's per-bridge table says what the supervisor released; --batchSize says what the
// caller believes. A document is only trustworthy when all three agree, and a disagreement is a REFUSAL rather
// than a preference for whichever number happens to be nearest to hand.
const declaredWindowLimitMatch = declaredWindowText.match(/PARTIAL_WINDOW_limit(\d+)_offset(\d+)/);
if (declaredWindowLimitMatch === null) {
	refuse(`the block's sourceWindow ${JSON.stringify(declaredWindowText)} does not parse as PARTIAL_WINDOW_limit<n>_offset<n> — the window is READ from the block, never inferred from the record count (a short last page would make that inference wrong exactly when it mattered)`);
}
const blockWindowLimit = Number(declaredWindowLimitMatch[1]);
const RUNNER_FILE_PATH = path.join(__dirname, 'runBridgeAcceptanceCommand.js');
const runnerTableMatch = fs.readFileSync(RUNNER_FILE_PATH, 'utf8').match(/D3_BATCH_SIZE_BY_BRIDGE_NAME = Object\.freeze\(\{([\s\S]*?)\}\)/);
const runnerRowMatch = runnerTableMatch === null ? null : runnerTableMatch[1].match(new RegExp(`${bridgeName}:\\s*(\\d+)`));
if (runnerRowMatch === null) {
	refuse(`runBridgeAcceptanceCommand.js declares no released batch size for '${bridgeName}' — the released window is reconstructed from the RUNNER, independently of the acceptance file and of this caller (RULING BS-9); a document cannot certify a batch size nobody released`);
}
const releasedWindowLimit = Number(runnerRowMatch[1]);

// --documentName is validated HERE, with the other configuration, because the document's TITLE uses it and a
// configuration fault belongs before any of the document is built.
const documentNameValue = firstValue('documentName');
if (documentNameValue !== undefined && !/^[A-Za-z0-9_-]+$/.test(documentNameValue)) {
	refuse(`--documentName must be a token of [A-Za-z0-9_-] (got ${JSON.stringify(documentNameValue)})`);
}
// RE-ASKS: THE RULING COUNTS SECOND VIOLATIONS, NOT FIRST ONES, and the difference is the whole point.
// judgeComponent permits EXACTLY ONE re-ask when a rationale names its pick by ordinal (BR-067); the run dies
// on a SECOND violation. So a first re-ask that recovers is LAWFUL and expected — §11.12's clean-checklist
// says "0 second-violation re-asks", not "0 re-asks".
//
// My first implementation counted first re-asks and declared a lawful batch NOT CLEAN. Detection of the real
// thing: a subject whose promptHash appears more than TWICE in the trail had a first attempt refused, a
// re-ask ALSO refused, and therefore killed the run.
//
// The first-re-ask count is still computed and reported PROMINENTLY, because it is not a failure but it IS a
// cost: it is an extra Opus call per occurrence, and the D0 review named this as the hazard most likely to
// double D4's bill.
const firstReaskCount = forensicsRead.recordList.filter((oneRecord) => oneRecord.reaskFollows === true).length;
const attemptCountByPromptHash = forensicsRead.recordList.reduce((soFar, oneRecord) => ({ ...soFar, [String(oneRecord.promptHash)]: (soFar[String(oneRecord.promptHash)] || 0) + 1 }), {});
const secondViolationList = Object.keys(attemptCountByPromptHash).filter((oneHash) => attemptCountByPromptHash[oneHash] > 2);
const reaskCount = secondViolationList.length;
const unmappedPickList = recordList.filter((oneRecord) => hasObjectPick(oneRecord) && Array.isArray(oneRecord.renderedPoolStableIdList) && oneRecord.renderedPoolStableIdList.indexOf(oneRecord.objectStableId) === -1);
// RULING BS-12: forensics are expected for JUDGED records only. A channel-asserted row has no judge event, so
// demanding a forensic prompt for it reports a defect where the design says there is nothing to record.
const forensicsMissingList = judgedRecordList.filter((oneRecord) => oneRecord.judge === undefined || forensicByPromptHash[String(oneRecord.judge.promptHash)] === undefined);
// ⟪TRAIL CONTAMINATION — found by batch 1's own checklist, GRANITE_VALLEY 2026-08-17⟫ The forensic trail is
// APPEND-ONLY per generation, and the generation name is a function of (framework, plugin, renderer, window)
// — NOT of the run. So a window that was judged twice (a run that DIED and the re-run that froze the block)
// leaves BOTH runs' records in one file, under identical promptHashes.
//
// That silently BREAKS the second-violation detector, which counts a promptHash appearing more than twice.
// Batch 1 measured it exactly: whole trail 2 "second violations"; the run that froze the block had ZERO
// (10 records, 10 distinct prompts, 0 first re-asks), and the 2 came from the dead run's records colliding
// with the live run's on the same hashes.
//
// NO NON-ORDER-BASED DISCRIMINATOR EXISTS ON DISK. The forensic record carries no run id and no framework
// fingerprint (the fingerprint DID change between those two runs and is on the BLOCK, but not on the record),
// so "the last N records" is the only separator available and that is an ASSUMPTION about append order, not
// a fact. This harness will not make it.
//
// What IS a fact: the trail holds more records for this generation than the block holds decision records,
// therefore more than one run wrote to it, therefore the re-ask numbers are NOT ATTRIBUTABLE to this block.
// The verdict is UNMEASURED — never PASS (which would claim a check that did not happen) and never FAIL
// (which would report a violation this block did not commit). Both errors are worse than saying so.
const trailIsContaminated = forensicsRead.recordList.length > recordList.length + firstReaskCount;
const reaskVerdictIsMeasurable = !trailIsContaminated;

const checklist = [
	{ name: `all ${judgedRecordList.length} JUDGED subjects reached a verdict (pick or abstention)`, pass: judgedResolvedCount === judgedRecordList.length, detail: `${judgedResolvedCount}/${judgedRecordList.length} judged · ${specifiedRecordList.length} channel-asserted (no judge) · ${orphanRecordList.length} orphan (no candidate card) · ${recordList.length} subjects in the window` },
	// The row stays FAIL in every disagreement — it is not relaxed — but it NAMES which disagreement, because
	// the two mean different things to a reader. A block whose window no longer matches the released one is
	// SUPERSEDED (batch-0 ran at limit 10 before BS-9 released 70); a caller whose --batchSize disagrees with
	// the block is documenting a window it has mis-stated. Reporting both as one undifferentiated FAIL would
	// make an obsolete document look like a defective batch.
	{ name: 'the window agrees across all three independent sources (block header · runner row · --batchSize)', pass: blockWindowLimit === releasedWindowLimit && blockWindowLimit === batchSize, detail: `block header ${blockWindowLimit} · runner released ${releasedWindowLimit} · --batchSize ${batchSize}${blockWindowLimit === batchSize && blockWindowLimit !== releasedWindowLimit ? ' — SUPERSEDED WINDOW: this block ran under a window the supervisor has since replaced; the block and the caller agree, and it is the RELEASED size that has moved' : blockWindowLimit !== batchSize ? ' — CALLER DISAGREES WITH THE BLOCK: --batchSize does not describe the window this block actually ran' : ''}` },
	{ name: '0 framework refusals', pass: Array.isArray(block.refusalList) && block.refusalList.length === 0, detail: `${Array.isArray(block.refusalList) ? block.refusalList.length : '?'} refusal(s)` },
	{ name: `0 id-gate hits over every prompt in this generation (matchBasis '${bridgeDeclaration.matchBasis}')`, pass: idGateHitList.length === 0, detail: idGateHitList.length ? idGateHitList.slice(0, 3).join('; ') : 'zero' },
	...(idGateSpec.assertsSingleSharedKey ? [{ name: `every rendered pool carries ONE shared '${idGateSpec.sharedKeyFieldName}' (the key-filtered basis assertion that replaces hub-identifier-as-answer)`, pass: sharedKeyRefusalList.length === 0 && sharedKeyOccurrenceCount > 0, detail: sharedKeyRefusalList.length ? sharedKeyRefusalList.slice(0, 2).join('; ') : sharedKeyOccurrenceCount === 0 ? 'UNMEASURED: the extractor found NO hub identifier in any prompt, so "the keys agree" would be a statement about silence' : `zero disagreements over ${sharedKeyOccurrenceCount} rendered '${idGateSpec.sharedKeyFieldName}' occurrence(s)` }] : []),
	{ name: '0 SECOND-violation re-asks (a first re-ask is lawful; a second kills the run)', pass: reaskVerdictIsMeasurable ? reaskCount === 0 : null, detail: reaskVerdictIsMeasurable ? `${reaskCount} second violation(s); ${firstReaskCount} lawful first re-ask(s) recovered` : `UNMEASURED — the trail holds ${forensicsRead.recordList.length} record(s) for this generation against ${recordList.length} block record(s) + ${firstReaskCount} re-ask(s), so more than one run wrote to it and the count is not attributable to this block` },
	{ name: "every pick's ordinal maps to a rendered candidate", pass: unmappedPickList.length === 0, detail: `${unmappedPickList.length} unmapped` },
	{ name: `forensics complete for every JUDGED record (${judgedRecordList.length} of ${recordList.length} subjects; a channel-asserted row has no judge event to record)`, pass: forensicsMissingList.length === 0, detail: `${forensicsMissingList.length} judged record(s) without a forensic prompt` },
];
// an UNMEASURED row (pass === null) is NOT a pass. A checklist that treated "could not tell" as "fine" is the
// under-enforcement pattern this project has recorded three times; it is reported as its own state.
const unmeasuredRowList = checklist.filter((oneRow) => oneRow.pass === null);
const mechanicallyClean = checklist.every((oneRow) => oneRow.pass === true);

const lineList = [];
// RULING BS-12: the document is TITLED by the name it was asked for and states its window from the BLOCK's own
// header. Titling it "batch <offset>" made two different windows at the same offset indistinguishable — which
// is exactly the CP3 case: batch-0 and batch-1 are both offset 0 and differ only in limit.
lineList.push(`# ${documentNameValue === undefined ? `D3 batch ${offsetValue}` : documentNameValue} — window ${blockWindowLimit} at offset ${offsetValue}, ${recordList.length} subjects, REAL judge`);
lineList.push('');
lineList.push(`**Of these ${recordList.length} subjects, ${judgedRecordList.length} went to the judge.** ${specifiedRecordList.length} are CHANNEL-ASSERTED — the plugin's own declared channel supplied the match and no judge was ever involved — and ${orphanRecordList.length} ${orphanRecordList.length === 1 ? 'is an orphan' : 'are orphans'}, for which no candidate card existed. Read every judge-facing number below as being about the ${judgedRecordList.length}, not the ${recordList.length}.`);
lineList.push('');
lineList.push(`- block: \`${blockRead.blockId}\` (**PARTIAL** — \`${header.sourceWindow}\`)`);
lineList.push(`- window: \`--limit=${batchSize} --offset=${offsetValue}\`, subjects sorted by stableId so the window is reproducible`);
lineList.push(`- judge: \`${header.judgeKind}\` · renderer \`${header.rendererVersion}\` · predicate rule \`${header.predicateRule}\``);
// candidateRetrieval is NULL FOR A KEY-FILTERED POOL and that is not a defect — it is the declared shape for
// a plugin whose candidates come from the canonicalKey index rather than from vector retrieval (SIF's pool
// producer is canonicalKeyIndex; the derived plugin's is vectorRetrieval). This line used to read
// header.candidateRetrieval.k unconditionally and CRASHED on the first standard-declared plugin to reach it.
// The absence is STATED rather than skipped: a missing "retrieval:" line would read as an omission, whereas
// naming the key-filtered pool tells the reader there is no K, no floor and no embedding model BY DESIGN.
lineList.push(header.candidateRetrieval === null || header.candidateRetrieval === undefined
	? '- retrieval: NONE — this plugin\'s candidate pool is KEY-FILTERED (pool producer `canonicalKeyIndex`), so there is no K, no cosine floor and no embedding model to report. The pool is every hub card carrying the declared canonicalKey, which is why a "retrieval miss" is not a possible outcome here and a rendering tie is the only way the page can mislead the judge.'
	: `- retrieval: K ${header.candidateRetrieval.k}, floor ${header.candidateRetrieval.floor}, \`${header.candidateRetrieval.embeddingModelVersion}\``);
lineList.push('');
lineList.push('## Mechanical clean-checklist');
lineList.push('');
lineList.push('This is the FALSIFIABLE half of "clean batch". The semantic half — are these picks plausible? — is');
lineList.push('the supervisor\'s and is deliberately not computed here.');
lineList.push('');
lineList.push('| check | verdict | detail |');
lineList.push('|---|---|---|');
checklist.forEach((oneRow) => lineList.push(`| ${oneRow.name} | ${oneRow.pass === null ? '**UNMEASURED**' : oneRow.pass ? '**PASS**' : '**FAIL**'} | ${oneRow.detail} |`));
lineList.push('');
lineList.push(`### MECHANICALLY ${mechanicallyClean ? 'CLEAN' : unmeasuredRowList.length > 0 && checklist.every((oneRow) => oneRow.pass !== false) ? 'CLEAN EXCEPT ' + unmeasuredRowList.length + ' UNMEASURED ROW(S) — NOT a clean verdict' : 'NOT CLEAN'}`);
if (trailIsContaminated) {
	lineList.push('');
	// ⟪DR-5, ratified 2026-08-17 in the review's words⟫ The release condition was "three consecutive clean
	// batches", and this document declares itself NOT clean. Both facts stand, and the reconciliation is the
	// supervisor's, recorded here rather than left for a reader to infer from two documents that disagree.
	lineList.push('> **SUPERVISOR-RATIFIED (SABLE_RIVER, 2026-08-17):** this window\'s FIRST attempt was not clean; the');
	lineList.push('> RE-RUN was clean, and the re-run is what the supervisor counted toward the three-consecutive-clean-batch');
	lineList.push('> release condition. The UNMEASURED row below is contamination from the dead first attempt sharing this');
	lineList.push('> generation, not a defect of the block this document describes.');
	lineList.push('');
	lineList.push('**TRAIL CONTAMINATION.** This window was judged more than once — a run that died and the re-run that froze');
	lineList.push(`this block — and the forensic trail is append-only per GENERATION, which is a function of (framework, plugin,`);
	lineList.push('renderer, window) and **not of the run**. Both runs\' records therefore sit in one file under identical');
	lineList.push('promptHashes, and the second-violation detector cannot tell them apart. No non-order-based discriminator');
	lineList.push('exists on disk: the forensic record carries no run id and no framework fingerprint. "The last N records" is');
	lineList.push('an assumption about append order, not a fact, so it is not used. The row is UNMEASURED.');
}
lineList.push('');
const correctList = recordList.filter((oneRecord) => hasObjectPick(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId] !== undefined && truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
const wrongList = recordList.filter((oneRecord) => hasObjectPick(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId] !== undefined && !truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
// the FIRST-re-ask count is drawn from the same contaminated trail as the second-violation count, so on a
// re-judged window it is an UPPER BOUND, not this block's cost. Reported as a bound rather than silently — a
// projection of D4's bill is a decision input, and an inflated one argues for a ceiling nobody needs.
lineList.push(`**Re-ask cost:** ${trailIsContaminated ? `AT MOST ${firstReaskCount}` : `${firstReaskCount}`} of ${recordList.length} subjects needed one re-ask because the judge named ITS OWN pick by ORDINAL — the hazard the D0 review flagged as most likely to inflate the bill. Each is one extra Opus call. Lawful (the framework allows exactly one) and recovered.${trailIsContaminated ? ` **This window was judged more than once, so ${firstReaskCount} counts BOTH runs' re-asks and is an UPPER BOUND on this block's cost, not its cost.**` : ''} At ${trailIsContaminated ? 'that bound' : 'this rate'} D4's 701 subjects would incur at most roughly ${Math.round((firstReaskCount / recordList.length) * 701)} extra calls; the declared ceiling of 1,600 covers it.`);
lineList.push('');
lineList.push(`**Re-ask cost, cumulative:** across ${cumulativeReask.windowCount} judged window(s) — ${cumulativeReask.firstReaskCount} lawful first re-ask(s) over ${cumulativeReask.promptCount} prompt(s), ${cumulativeReask.secondViolationCount} second violation(s)${cumulativeReask.contaminatedWindowCount > 0 ? `, with ${cumulativeReask.contaminatedWindowCount} window(s) EXCLUDED from the second-violation total because their trail was written by more than one run and the count is not attributable` : ''}. Counted from the forensic trails on disk, not a running total, so re-running a batch cannot drift it.`);
lineList.push('');
lineList.push('### Rendering ties — what the allow-list cost this batch');
lineList.push('');
lineList.push(`- **renderingTie: ${renderingTieList.length}** — ${referenceVocabulary.tieSentence}`);
lineList.push(`- pools containing any identical pair: **${poolsWithTieList.length}** of ${recordList.length}`);
lineList.push(`- picks that were themselves one of >= 2 identical cards: **${tiedPickList.length}**`);
lineList.push(`- across every candidate rendered in this generation, ${Object.keys(renderedTextByStableId).length} distinct card(s) produced only ${Object.keys(corpusTextCount).length} distinct rendered text(s) — **${collapsedCardCount} card(s) carry a text that is not theirs alone**, and the largest identical group holds **${largestIdenticalGroupSize}** cards.`);
lineList.push('');
lineList.push('The whitelist hides qualifier and range BY DESIGN — they are the identifiers the bias audit exists to keep');
lineList.push('away from the judge. This number is the price of that, measured rather than assumed. It is an input to any');
lineList.push('future decision about the allow-list, not a reason to widen it now.');
lineList.push('');
// RULING BS-13: orphan is REPORTED SEPARATELY, never folded into abstained. The two look identical from the
// objectStableId field and mean opposite things about coverage: an abstention is the judge declining among
// candidates, an orphan is a subject that never reached a judge at all.
lineList.push(`${referenceVocabulary.summaryLead}: **${correctList.length} ${referenceVocabulary.agreeWord} · ${wrongList.length} ${referenceVocabulary.differWord} · ${recordList.filter(isAbstained).length} abstained · ${recordList.filter(isOrphan).length} orphan (no candidate card existed)**. These are ${recordList.length} subjects; nothing here is a rate.`);
lineList.push('');
lineList.push('---');
lineList.push('');

// RULING BS-12: the SPECIFIED rows are listed as what they are — a count and a list — rather than rendered as
// judge picks. The previous document printed all 58 of batch-1's channel-asserted rows under "the judge
// answered: picked …" with `confidence undefined`, so a reader would conclude the judge answered 69 subjects.
// It answered 11. That is not a formatting complaint: it is the document's central claim being wrong.
if (specifiedRecordList.length > 0) {
	lineList.push('## SPECIFIED (channel-asserted; no judge)');
	lineList.push('');
	lineList.push(`**${specifiedRecordList.length} subject(s).** The plugin's declared channel asserted these matches directly from the source standard. No prompt was rendered, no judgment was made, and no confidence or category exists for them — a "confidence" printed here would be an invention. They are listed so the window is fully accounted for.`);
	lineList.push('');
	specifiedRecordList.forEach((oneRecord) => {
		lineList.push(`- \`${oneRecord.subjectStableId}\` → \`${oneRecord.objectStableId}\``);
	});
	lineList.push('');
	lineList.push('---');
	lineList.push('');
}
if (orphanRecordList.length > 0) {
	lineList.push('## ORPHAN (no candidate card existed)');
	lineList.push('');
	lineList.push(`**${orphanRecordList.length} subject(s).** No candidate was available to judge, so the judge was never asked. This is a COVERAGE gap, not reticence, and it is counted separately from abstention for that reason (RULING BS-13).`);
	lineList.push('');
	orphanRecordList.forEach((oneRecord) => {
		lineList.push(`- \`${oneRecord.subjectStableId}\``);
	});
	lineList.push('');
	lineList.push('---');
	lineList.push('');
}
lineList.push(`## THE JUDGED SUBJECTS (${judgedRecordList.length})`);
lineList.push('');
judgedRecordList.forEach((oneRecord, recordIndex) => {
	const forensic = oneRecord.judge === undefined ? undefined : forensicByPromptHash[String(oneRecord.judge.promptHash)];
	const truthSet = truth.objectSetBySubject[oneRecord.subjectStableId];
	lineList.push(`## ${recordIndex + 1}. \`${oneRecord.subjectStableId}\``);
	lineList.push('');
	lineList.push(`- **the judge answered:** ${isOrphan(oneRecord) ? '**NO CANDIDATE CARD EXISTED** — the judge was never asked (ORPHAN, not an abstention)' : isAbstained(oneRecord) ? '**ABSTAINED**' : `picked \`${oneRecord.objectStableId}\``}`);
	if (hasObjectPick(oneRecord)) {
		lineList.push(`- predicate \`${oneRecord.predicate}\` · confidence \`${oneRecord.confidence}\` · category \`${oneRecord.judge === undefined ? '—' : oneRecord.judge.category}\``);
	}
	lineList.push(`- **${referenceVocabulary.columnHeading}:** ${truthSet === undefined ? referenceVocabulary.absentText : Array.from(truthSet).map((oneId) => `\`${oneId}\``).join(', ')}`);
	if (truthSet !== undefined) {
		lineList.push(`- **agreement:** ${isOrphan(oneRecord) ? referenceVocabulary.orphanText : isAbstained(oneRecord) ? referenceVocabulary.abstainedText : truthSet.has(oneRecord.objectStableId) ? referenceVocabulary.agreesText : referenceVocabulary.differsText}`);
	}
	const rowTextCount = poolTextCountFor(oneRecord);
	const rowTieSizeList = Object.keys(rowTextCount).filter((oneText) => rowTextCount[oneText] > 1).map((oneText) => rowTextCount[oneText]);
	if (rowTieSizeList.length > 0) {
		lineList.push(`- **rendering tie in this pool:** ${rowTieSizeList.map((oneSize) => `${oneSize} candidates rendered identically`).join('; ')}${renderingTieList.indexOf(oneRecord) === -1 ? referenceVocabulary.tieAbsentText : referenceVocabulary.tiePresentText}`);
	}
	lineList.push('');
	lineList.push('**The judge\'s own rationale**');
	lineList.push('');
	lineList.push('> ' + String(forensic === undefined || forensic.rationale === undefined ? '(absent from the trail)' : forensic.rationale).replace(/\n/g, '\n> '));
	lineList.push('');
	lineList.push('<details><summary>The prompt exactly as sent, and the pool as rendered</summary>');
	lineList.push('');
	lineList.push('```text');
	lineList.push(forensic === undefined ? '(no forensic record)' : String(forensic.userPrompt));
	lineList.push('```');
	lineList.push('');
	lineList.push('</details>');
	lineList.push('');
});

// ⟪THE SAME SILENT-WRONG-ARTIFACT HAZARD, ON A SECOND AXIS — TWILIGHT_VALLEY 2026-08-17⟫ The guard above
// checks the OFFSET the caller claimed against the block's own sourceWindow, which is right and caught a real
// defect. It does NOT catch two windows at the SAME offset that differ by LIMIT — and B4 has exactly that:
// PARTIAL_WINDOW_limit10_offset0 and PARTIAL_WINDOW_limit70_offset0 are different windows, different blocks,
// different judgments, and both name themselves "offset 0". Writing the second over the first would leave a
// file that "simply became a document about a different window wearing the old window's name", which is the
// hazard this file already records in its own words one screen above.
//
// So: --documentName lets the caller NAME the document (the supervisor asked for batch-0.md and batch-1.md,
// which are two windows at one offset), and an existing file that documents a DIFFERENT block is REFUSED BY
// NAME rather than overwritten. Re-running the same block over its own document is still allowed — that is a
// regeneration, not a collision.
const outPath = path.join(path.dirname(entry.decisionStoreFilePath), 'batches', `${documentNameValue === undefined ? `batch-${offsetValue}` : documentNameValue}.md`);
if (fs.existsSync(outPath)) {
	const existingText = fs.readFileSync(outPath, 'utf8');
	const existingBlockMatch = existingText.match(/block: `([0-9a-f]{64})`/);
	if (existingBlockMatch !== null && existingBlockMatch[1] !== blockRead.blockId) {
		refuse(`'${outPath}' already documents block ${existingBlockMatch[1].slice(0, 12)}… and this run documents ${String(blockRead.blockId).slice(0, 12)}… — two different windows must not share one document name; pass --documentName=<something else>. Overwriting would leave a document about one window wearing another window's name (the hazard recorded above, on the LIMIT axis rather than the offset axis)`);
	}
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lineList.join('\n')}\n`);
xLog.status(`${moduleName}: ${outPath}`);
xLog.status(`  block ${blockRead.blockId} — MECHANICALLY ${mechanicallyClean ? 'CLEAN' : 'NOT CLEAN'}`);
checklist.forEach((oneRow) => xLog.status(`    ${oneRow.pass ? 'PASS' : 'FAIL'}  ${oneRow.name} (${oneRow.detail})`));
xLog.result(JSON.stringify({ blockId: blockRead.blockId, offset: Number(offsetValue), recordCount: recordList.length, mechanicallyClean, matchingTruth: correctList.length, differing: wrongList.length, abstained: recordList.filter(isAbstained).length, orphan: recordList.filter(isOrphan).length }, null, '\t'));
