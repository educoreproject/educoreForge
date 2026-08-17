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

const ACCEPTANCE_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'acceptanceCommands.jsonc');
const TRUTH_STORE_FILE_PATH = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/edfi/edfiBridge.decisions.sqlite3';
const TRUTH_BLOCK_ID = 'e15acd6b5a43df3ce11b4e3f3bb55d97441c14658908d3518a55494cf24a322c';
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

const truthRead = derivedEvalLib.readFrozenBlock({ storeFilePath: TRUTH_STORE_FILE_PATH, blockId: TRUTH_BLOCK_ID, roleName: 'truth' });
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
const isAbstained = (oneRecord) => oneRecord.abstained === true || typeof oneRecord.objectStableId !== 'string' || oneRecord.objectStableId === '';

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
	if (isAbstained(oneRecord)) {
		return false;
	}
	const countByText = poolTextCountFor(oneRecord);
	const pickText = renderedTextByStableId[oneRecord.objectStableId];
	return pickText !== undefined && countByText[pickText] > 1;
});
const renderingTieList = recordList.filter((oneRecord) => {
	const truthSet = truth.objectSetBySubject[oneRecord.subjectStableId];
	if (isAbstained(oneRecord) || truthSet === undefined || truthSet.has(oneRecord.objectStableId)) {
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
const idGateHitList = [];
forensicsRead.recordList.forEach((oneRecord) => {
	renderingAuditLib.ID_GATE_PATTERN_LIST.forEach((onePattern) => {
		if (onePattern.regex.test(oneRecord.userPrompt)) {
			idGateHitList.push(`${onePattern.patternName} in ${String(oneRecord.promptHash).slice(0, 12)}`);
		}
	});
});
const judgedOrAbstainedCount = recordList.filter((oneRecord) => oneRecord.classification === 'judged' || oneRecord.classification === 'orphan').length;
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
const unmappedPickList = recordList.filter((oneRecord) => !isAbstained(oneRecord) && Array.isArray(oneRecord.renderedPoolStableIdList) && oneRecord.renderedPoolStableIdList.indexOf(oneRecord.objectStableId) === -1);
const forensicsMissingList = recordList.filter((oneRecord) => oneRecord.judge === undefined || forensicByPromptHash[String(oneRecord.judge.promptHash)] === undefined);
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
	{ name: `all ${recordList.length} subjects judged-or-abstained`, pass: judgedOrAbstainedCount === recordList.length, detail: `${judgedOrAbstainedCount}/${recordList.length}` },
	{ name: 'batch size equals the released window', pass: recordList.length === batchSize, detail: `${recordList.length} records, window ${batchSize}` },
	{ name: '0 framework refusals', pass: Array.isArray(block.refusalList) && block.refusalList.length === 0, detail: `${Array.isArray(block.refusalList) ? block.refusalList.length : '?'} refusal(s)` },
	{ name: '0 id-gate hits over every prompt in this generation', pass: idGateHitList.length === 0, detail: idGateHitList.length ? idGateHitList.slice(0, 3).join('; ') : 'zero' },
	{ name: '0 SECOND-violation re-asks (a first re-ask is lawful; a second kills the run)', pass: reaskVerdictIsMeasurable ? reaskCount === 0 : null, detail: reaskVerdictIsMeasurable ? `${reaskCount} second violation(s); ${firstReaskCount} lawful first re-ask(s) recovered` : `UNMEASURED — the trail holds ${forensicsRead.recordList.length} record(s) for this generation against ${recordList.length} block record(s) + ${firstReaskCount} re-ask(s), so more than one run wrote to it and the count is not attributable to this block` },
	{ name: "every pick's ordinal maps to a rendered candidate", pass: unmappedPickList.length === 0, detail: `${unmappedPickList.length} unmapped` },
	{ name: 'forensics complete for every record', pass: forensicsMissingList.length === 0, detail: `${forensicsMissingList.length} record(s) without a forensic prompt` },
];
// an UNMEASURED row (pass === null) is NOT a pass. A checklist that treated "could not tell" as "fine" is the
// under-enforcement pattern this project has recorded three times; it is reported as its own state.
const unmeasuredRowList = checklist.filter((oneRow) => oneRow.pass === null);
const mechanicallyClean = checklist.every((oneRow) => oneRow.pass === true);

const lineList = [];
lineList.push(`# D3 batch ${offsetValue} — ${recordList.length} subjects, REAL judge`);
lineList.push('');
lineList.push(`- block: \`${blockRead.blockId}\` (**PARTIAL** — \`${header.sourceWindow}\`)`);
lineList.push(`- window: \`--limit=${batchSize} --offset=${offsetValue}\`, subjects sorted by stableId so the window is reproducible`);
lineList.push(`- judge: \`${header.judgeKind}\` · renderer \`${header.rendererVersion}\` · predicate rule \`${header.predicateRule}\``);
lineList.push(`- retrieval: K ${header.candidateRetrieval.k}, floor ${header.candidateRetrieval.floor}, \`${header.candidateRetrieval.embeddingModelVersion}\``);
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
	lineList.push('**TRAIL CONTAMINATION.** This window was judged more than once — a run that died and the re-run that froze');
	lineList.push(`this block — and the forensic trail is append-only per GENERATION, which is a function of (framework, plugin,`);
	lineList.push('renderer, window) and **not of the run**. Both runs\' records therefore sit in one file under identical');
	lineList.push('promptHashes, and the second-violation detector cannot tell them apart. No non-order-based discriminator');
	lineList.push('exists on disk: the forensic record carries no run id and no framework fingerprint. "The last N records" is');
	lineList.push('an assumption about append order, not a fact, so it is not used. The row is UNMEASURED.');
}
lineList.push('');
const correctList = recordList.filter((oneRecord) => !isAbstained(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId] !== undefined && truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
const wrongList = recordList.filter((oneRecord) => !isAbstained(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId] !== undefined && !truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
lineList.push(`**Re-ask cost:** ${firstReaskCount} of ${recordList.length} subjects needed one re-ask because the judge named its pick by ORDINAL — the hazard the D0 review flagged as most likely to inflate the bill. Each is one extra Opus call. Lawful (the framework allows exactly one) and recovered, but at this rate D4's 701 subjects would incur roughly ${Math.round((firstReaskCount / recordList.length) * 701)} extra calls; the declared ceiling of 1,600 covers it.`);
lineList.push('');
lineList.push(`**Re-ask cost, cumulative:** across ${cumulativeReask.windowCount} judged window(s) — ${cumulativeReask.firstReaskCount} lawful first re-ask(s) over ${cumulativeReask.promptCount} prompt(s), ${cumulativeReask.secondViolationCount} second violation(s)${cumulativeReask.contaminatedWindowCount > 0 ? `, with ${cumulativeReask.contaminatedWindowCount} window(s) EXCLUDED from the second-violation total because their trail was written by more than one run and the count is not attributable` : ''}. Counted from the forensic trails on disk, not a running total, so re-running a batch cannot drift it.`);
lineList.push('');
lineList.push('### Rendering ties — what the allow-list cost this batch');
lineList.push('');
lineList.push(`- **renderingTie: ${renderingTieList.length}** — differing pick(s) whose TRUTH card was rendered byte-identically to another candidate in the same pool. These are not judge errors; the right answer was on the page wearing someone else's face.`);
lineList.push(`- pools containing any identical pair: **${poolsWithTieList.length}** of ${recordList.length}`);
lineList.push(`- picks that were themselves one of >= 2 identical cards: **${tiedPickList.length}**`);
lineList.push(`- across every candidate rendered in this generation, ${Object.keys(renderedTextByStableId).length} distinct card(s) produced only ${Object.keys(corpusTextCount).length} distinct rendered text(s) — **${collapsedCardCount} card(s) carry a text that is not theirs alone**, and the largest identical group holds **${largestIdenticalGroupSize}** cards.`);
lineList.push('');
lineList.push('The whitelist hides qualifier and range BY DESIGN — they are the identifiers the bias audit exists to keep');
lineList.push('away from the judge. This number is the price of that, measured rather than assumed. It is an input to any');
lineList.push('future decision about the allow-list, not a reason to widen it now.');
lineList.push('');
lineList.push(`Against truth, for the supervisor's read only: **${correctList.length} matching truth · ${wrongList.length} differing · ${recordList.filter(isAbstained).length} abstained**. These are ${recordList.length} subjects; nothing here is a rate.`);
lineList.push('');
lineList.push('---');
lineList.push('');

recordList.forEach((oneRecord, recordIndex) => {
	const forensic = oneRecord.judge === undefined ? undefined : forensicByPromptHash[String(oneRecord.judge.promptHash)];
	const truthSet = truth.objectSetBySubject[oneRecord.subjectStableId];
	lineList.push(`## ${recordIndex + 1}. \`${oneRecord.subjectStableId}\``);
	lineList.push('');
	lineList.push(`- **the judge answered:** ${isAbstained(oneRecord) ? '**ABSTAINED**' : `picked \`${oneRecord.objectStableId}\``}`);
	if (!isAbstained(oneRecord)) {
		lineList.push(`- predicate \`${oneRecord.predicate}\` · confidence \`${oneRecord.confidence}\` · category \`${oneRecord.judge === undefined ? '—' : oneRecord.judge.category}\``);
	}
	lineList.push(`- **truth says:** ${truthSet === undefined ? '_no truth object — this subject is a NEW CLAIM, not a right or wrong answer_' : Array.from(truthSet).map((oneId) => `\`${oneId}\``).join(', ')}`);
	if (truthSet !== undefined) {
		lineList.push(`- **agreement:** ${isAbstained(oneRecord) ? 'the judge abstained where truth names an object' : truthSet.has(oneRecord.objectStableId) ? '**MATCHES TRUTH**' : '**DIFFERS FROM TRUTH**'}`);
	}
	const rowTextCount = poolTextCountFor(oneRecord);
	const rowTieSizeList = Object.keys(rowTextCount).filter((oneText) => rowTextCount[oneText] > 1).map((oneText) => rowTextCount[oneText]);
	if (rowTieSizeList.length > 0) {
		lineList.push(`- **rendering tie in this pool:** ${rowTieSizeList.map((oneSize) => `${oneSize} candidates rendered identically`).join('; ')}${renderingTieList.indexOf(oneRecord) === -1 ? ' — the truth card is NOT among them, so this did not cost the pick' : ' — **the TRUTH card is among them**; this pick could not have been made on the merits'}`);
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

const outPath = path.join(path.dirname(entry.decisionStoreFilePath), 'batches', `batch-${offsetValue}.md`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lineList.join('\n')}\n`);
xLog.status(`${moduleName}: ${outPath}`);
xLog.status(`  block ${blockRead.blockId} — MECHANICALLY ${mechanicallyClean ? 'CLEAN' : 'NOT CLEAN'}`);
checklist.forEach((oneRow) => xLog.status(`    ${oneRow.pass ? 'PASS' : 'FAIL'}  ${oneRow.name} (${oneRow.detail})`));
xLog.result(JSON.stringify({ blockId: blockRead.blockId, offset: Number(offsetValue), recordCount: recordList.length, mechanicallyClean, matchingTruth: correctList.length, differing: wrongList.length, abstained: recordList.filter(isAbstained).length }, null, '\t'));
