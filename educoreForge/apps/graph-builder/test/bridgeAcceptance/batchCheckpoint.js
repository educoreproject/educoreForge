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

const recordList = block.decisionRecordList.slice().sort((leftRecord, rightRecord) => (leftRecord.subjectStableId < rightRecord.subjectStableId ? -1 : 1));
const isAbstained = (oneRecord) => oneRecord.abstained === true || typeof oneRecord.objectStableId !== 'string' || oneRecord.objectStableId === '';

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
const checklist = [
	{ name: `all ${recordList.length} subjects judged-or-abstained`, pass: judgedOrAbstainedCount === recordList.length, detail: `${judgedOrAbstainedCount}/${recordList.length}` },
	{ name: 'batch size equals the released window', pass: recordList.length === batchSize, detail: `${recordList.length} records, window ${batchSize}` },
	{ name: '0 framework refusals', pass: Array.isArray(block.refusalList) && block.refusalList.length === 0, detail: `${Array.isArray(block.refusalList) ? block.refusalList.length : '?'} refusal(s)` },
	{ name: '0 id-gate hits over every prompt in this generation', pass: idGateHitList.length === 0, detail: idGateHitList.length ? idGateHitList.slice(0, 3).join('; ') : 'zero' },
	{ name: '0 SECOND-violation re-asks (a first re-ask is lawful; a second kills the run)', pass: reaskCount === 0, detail: `${reaskCount} second violation(s); ${firstReaskCount} lawful first re-ask(s) recovered` },
	{ name: "every pick's ordinal maps to a rendered candidate", pass: unmappedPickList.length === 0, detail: `${unmappedPickList.length} unmapped` },
	{ name: 'forensics complete for every record', pass: forensicsMissingList.length === 0, detail: `${forensicsMissingList.length} record(s) without a forensic prompt` },
];
const mechanicallyClean = checklist.every((oneRow) => oneRow.pass);

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
checklist.forEach((oneRow) => lineList.push(`| ${oneRow.name} | ${oneRow.pass ? '**PASS**' : '**FAIL**'} | ${oneRow.detail} |`));
lineList.push('');
lineList.push(`### MECHANICALLY ${mechanicallyClean ? 'CLEAN' : 'NOT CLEAN'}`);
lineList.push('');
const correctList = recordList.filter((oneRecord) => !isAbstained(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId] !== undefined && truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
const wrongList = recordList.filter((oneRecord) => !isAbstained(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId] !== undefined && !truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
lineList.push(`**Re-ask cost:** ${firstReaskCount} of ${recordList.length} subjects needed one re-ask because the judge named its pick by ORDINAL — the hazard the D0 review flagged as most likely to inflate the bill. Each is one extra Opus call. Lawful (the framework allows exactly one) and recovered, but at this rate D4's 701 subjects would incur roughly ${Math.round((firstReaskCount / recordList.length) * 701)} extra calls; the declared ceiling of 1,600 covers it.`);
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
