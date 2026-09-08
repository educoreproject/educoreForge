#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// nearMissPoolProbe.js — JOB 7's SECONDARY PROBE: does a judge decline a plausible near-miss?
// judgeProviderRegistry JOB 7, STEEL_SUMMIT, 2026-09-08. Supervisor DAWN_TOWER.
//
// THE QUESTION. Blind precision says how often a judge is right when it commits. It does not say whether the
// judge can tell that NOTHING in front of it is correct. A judge that always picks something scores well on
// a population where something usually is correct, and is worthless on one where nothing is. So: hand each
// provider the SAME source element twice — once with the candidates that were actually retrieved for it
// (POOL A, real), once with candidates retrieved for a structurally unrelated source (POOL B, no-match) —
// and compare abstention rates. A provider that abstains at the same rate on both is not reading the
// candidates.
//
// 🔴 POOL B IS NEVER NONSENSE AND NEVER EMPTY. Every Pool B prompt carries a real, well-formed, plausible
// pool of real CEDS hub cards in the real rendering, with a consistent ordinal enum. A model declining
// gibberish proves nothing about declining a plausible near-miss, which is the only interesting case.
//
// WHERE THE PROMPTS COME FROM, AND WHY NOT FROM THE RENDERER. Pool A prompts are read VERBATIM out of a run's
// forensics trail rather than re-rendered. Re-rendering would make this probe depend on renderer state and
// could drift from what was actually judged; the trail holds the exact bytes that were sent. It also makes
// G7-d free rather than argued: all three providers are handed THE SAME RECORDED STRING, so byte-identity is
// a property of the construction and not something to be checked afterwards.
//
// HOW POOL B IS BUILT. [code fact, read from the trail] a rendered userPrompt has exactly two sections and a
// trailing enum line:
//     SOURCE ELEMENT (what you are matching FROM):   … source fields …
//     CANDIDATES (N), in hub order:                  … N candidate cards …
//     Answer with one of: 1, 2, … N, or NONE.
// Pool B = source X's SOURCE section + source Y's CANDIDATES section INCLUDING its trailing enum line, so the
// enum always agrees with the pool actually shown. Y is chosen deterministically and then VERIFIED to share
// ZERO card stableIds with X's own pool — which is what makes "none of them is correct" a measured property
// rather than an assumption, because X's correct card, when retrieval found one at all, is in X's own pool.
// Y is additionally required to hang off a DIFFERENT owningConstructName, which is the structural half of
// "structurally unrelated".
//
// NO JUDGMENT HERE CAN BE A CACHE HIT. [code fact] the judgment cache lives in judgeComponent.js (its key is
// built at :242), one layer ABOVE the provider contract. This probe calls provider.rerank directly through
// the registry, so it never reaches the cache at all. That is a stronger statement than cacheHit === false
// and it is what G-F1-c actually needs: a differential over cache hits measures nothing.
//
// DETERMINISM IS THE POINT (G7-b). Selection is by sorted promptHash; the partner walk is a fixed offset with
// a forward scan; there is no clock and no random number anywhere in pool construction. -verifyPools rebuilds
// both pools FROM THE RECORDED IDS ALONE and asserts every prompt hash matches. If it cannot, the record is
// insufficient and the probe says so rather than trusting itself.
//
//   node apps/graph-builder/test/bridgeAcceptance/nearMissPoolProbe.js -buildPools \
//     --forensicsTrailFilePath=<trail.jsonl> --subjectCount=N --poolRecordFilePath=<out.json>
//   node apps/graph-builder/test/bridgeAcceptance/nearMissPoolProbe.js -judgePools \
//     --poolRecordFilePath=<record.json> --providerName=<anthropic|ollama|debug> --judgmentFilePath=<out.json>
//   node apps/graph-builder/test/bridgeAcceptance/nearMissPoolProbe.js -verifyPools \
//     --poolRecordFilePath=<record.json> --forensicsTrailFilePath=<trail.jsonl>
//
// EVERY PARAMETER IS REQUIRED AND REFUSED BY NAME. No defaults anywhere — not for the provider, not for the
// count, not for any path. A probe that quietly measured a provider nobody named would print a confident
// number about the wrong thing.

const fs = require('fs');
const crypto = require('crypto');

const helpText = () => `
NAME
     ${moduleName} -- build, judge and verify the Pool A / Pool B near-miss differential

SYNOPSIS
     ${moduleName} -buildPools  --forensicsTrailFilePath=<jsonl> --subjectCount=N --poolRecordFilePath=<json>
     ${moduleName} -judgePools  --poolRecordFilePath=<json> --providerName=<name> --judgmentFilePath=<json>
     ${moduleName} -verifyPools --poolRecordFilePath=<json> --forensicsTrailFilePath=<jsonl>

DESCRIPTION
     POOL A is the real retrieved pool for each source, read verbatim from a run's forensics trail.
     POOL B pairs each source with the pool retrieved for a structurally unrelated source: well-formed,
     plausible, and verified to contain none of the source's own candidates. Both pools are handed to
     every provider as byte-identical strings.

EXIT STATUS
     0 done;  1 refused by name.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const registryLib = require('../../apps/bridge-maker/lib/judgeProviderRegistry');

// [code fact, read from a rendered prompt] the two section markers and the trailing enum line. They are
// CONSTANTS of the derived renderer's output, matched literally rather than by pattern, so a renderer change
// that moved them makes this probe REFUSE rather than splice at the wrong place and report a number.
const SOURCE_SECTION_MARKER = 'SOURCE ELEMENT (what you are matching FROM):';
const CANDIDATE_SECTION_MARKER_PREFIX = 'CANDIDATES (';
const ABSTAIN_CHOICE_TOKEN = 'NONE';

const firstValue = (name) => (Array.isArray(commandLineParameters.values[name]) ? commandLineParameters.values[name][0] : commandLineParameters.values[name]);
const refuse = (what) => {
	xLog.error(`${moduleName} REFUSED: ${what}`);
	process.exit(1);
};
const sha256Of = (oneText) => crypto.createHash('sha256').update(oneText, 'utf8').digest('hex');

const requiredFilePath = (parameterName, whatItIs) => {
	const givenPath = firstValue(parameterName);
	if (typeof givenPath !== 'string' || givenPath === '') {
		refuse(`--${parameterName} is required; there is no default. ${whatItIs}`);
	}
	return givenPath;
};
const requiredExistingFilePath = (parameterName, whatItIs) => {
	const givenPath = requiredFilePath(parameterName, whatItIs);
	if (!fs.existsSync(givenPath)) {
		refuse(`--${parameterName} names no file on disk: ${givenPath}`);
	}
	return givenPath;
};

// ---------------------------------------------------------------------------------------------------------
// READING THE TRAIL
// ---------------------------------------------------------------------------------------------------------

// A trail line that will not parse is REFUSED BY NAME with its line number, never skipped. A probe that
// silently dropped malformed records would report a smaller pool as though it were the whole one.
const promptRecordListFrom = ({ forensicsTrailFilePath }) => {
	const lineList = fs.readFileSync(forensicsTrailFilePath, 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '');
	const recordList = [];
	let lineIndex = 0;
	while (lineIndex < lineList.length) {
		// the ONE sanctioned try/catch, isolated to the parse itself exactly as llmClient's header sanctions
		// it for the Ollama body: JSON.parse has no error-first form.
		let parsedRecord = null;
		try {
			parsedRecord = JSON.parse(lineList[lineIndex]);
		} catch (parseFault) {
			return { error: `${forensicsTrailFilePath} line ${lineIndex + 1} is not JSON: ${parseFault.message}` };
		}
		recordList.push(parsedRecord);
		lineIndex += 1;
	}
	return { recordList };
};

// SPLIT A PROMPT INTO ITS TWO PARTS. Refuses by name on anything it does not recognise — an unrecognised
// prompt shape must never be spliced on a guess.
const promptPartsFrom = ({ userPrompt, promptHash }) => {
	if (typeof userPrompt !== 'string' || !userPrompt.startsWith(SOURCE_SECTION_MARKER)) {
		return { error: `prompt ${promptHash} does not begin with the source-section marker; the renderer's shape has moved and this probe will not guess where to splice` };
	}
	const candidateMarkerIndex = userPrompt.indexOf(`\n${CANDIDATE_SECTION_MARKER_PREFIX}`);
	if (candidateMarkerIndex === -1) {
		return { error: `prompt ${promptHash} carries no '${CANDIDATE_SECTION_MARKER_PREFIX}' section; refusing to splice` };
	}
	return {
		sourceSectionText: userPrompt.slice(0, candidateMarkerIndex + 1),
		candidateSectionText: userPrompt.slice(candidateMarkerIndex + 1),
	};
};

// THE SOURCE'S IDENTITY. [code fact] the forensic record carries NO source stableId — its id fields are
// chosenCardStableId and renderedPoolStableIdList, both about CANDIDATES. So the source is identified two
// ways, and which is which is stated rather than blurred:
//   promptHash            — AUTHORITATIVE. It is what -verifyPools rebuilds against.
//   sourceIdentityText    — DERIVED from the prompt's own owningConstructType and path, for a human reading
//                           the record. It is not read back by anything.
const sourceIdentityFrom = ({ sourceSectionText }) => {
	const fieldValueFor = (fieldName) => {
		const matchList = sourceSectionText.split('\n').filter((oneLine) => oneLine.trim().startsWith(`${fieldName}:`));
		return matchList.length === 0 ? '' : matchList[0].trim().slice(fieldName.length + 1).trim();
	};
	const owningConstructTypeText = fieldValueFor('owningConstructType');
	const pathText = fieldValueFor('path');
	const owningConstructNameText = fieldValueFor('owningConstructName');
	return {
		sourceIdentityText: owningConstructTypeText === '' || pathText === '' ? '' : `edfi:property/${owningConstructTypeText}.${pathText}`,
		owningConstructNameText,
		sourceNameText: fieldValueFor('name'),
	};
};

const choiceEnumFor = ({ renderedPoolStableIdList }) =>
	renderedPoolStableIdList.map((oneStableId, oneIndex) => `${oneIndex + 1}`).concat([ABSTAIN_CHOICE_TOKEN]);

// ---------------------------------------------------------------------------------------------------------
// -buildPools
// ---------------------------------------------------------------------------------------------------------

const buildPools = () => {
	const forensicsTrailFilePath = requiredExistingFilePath('forensicsTrailFilePath', 'Name the .jsonl trail to draw Pool A from.');
	const poolRecordFilePath = requiredFilePath('poolRecordFilePath', 'Name the JSON file the pool record is written to.');
	const askedSubjectCount = firstValue('subjectCount');
	if (askedSubjectCount === undefined || !/^[0-9]+$/.test(`${askedSubjectCount}`) || Number(askedSubjectCount) < 2) {
		refuse(`--subjectCount is required and must be an integer of at least 2 (got ${JSON.stringify(askedSubjectCount)}); there is no default`);
	}
	const subjectCount = Number(askedSubjectCount);

	const trailRead = promptRecordListFrom({ forensicsTrailFilePath });
	if (trailRead.error) {
		refuse(trailRead.error);
	}

	// ONE RECORD PER DISTINCT promptHash. An append-only trail holds the same prompt many times (JOB 7
	// measured 1,451 records collapsing to 701 distinct hashes on the 08-17 trail); a probe that counted
	// duplicates would weight some sources more than others without saying so.
	const recordByPromptHash = {};
	trailRead.recordList.forEach((oneRecord) => {
		if (typeof oneRecord.promptHash === 'string' && recordByPromptHash[oneRecord.promptHash] === undefined) {
			recordByPromptHash[oneRecord.promptHash] = oneRecord;
		}
	});
	// SORTED, so selection is reproducible from the trail alone. Object.keys is insertion order, which is a
	// property of how the file was read, not of the data (JOB 6 trap 7).
	const distinctPromptHashList = Object.keys(recordByPromptHash).sort();
	if (distinctPromptHashList.length < subjectCount) {
		refuse(`the trail holds ${distinctPromptHashList.length} distinct prompt(s); --subjectCount=${subjectCount} cannot be drawn from it`);
	}

	// Build the candidate entry list first, refusing on any prompt whose shape is unrecognised.
	const entryList = [];
	let buildIndex = 0;
	while (buildIndex < distinctPromptHashList.length) {
		const onePromptHash = distinctPromptHashList[buildIndex];
		const oneRecord = recordByPromptHash[onePromptHash];
		const parts = promptPartsFrom({ userPrompt: oneRecord.userPrompt, promptHash: onePromptHash });
		if (parts.error) {
			refuse(parts.error);
		}
		if (!Array.isArray(oneRecord.renderedPoolStableIdList) || oneRecord.renderedPoolStableIdList.length === 0) {
			refuse(`prompt ${onePromptHash} carries no renderedPoolStableIdList; an empty pool is exactly what Pool B must never be`);
		}
		entryList.push(Object.assign({ promptHash: onePromptHash, record: oneRecord }, parts, sourceIdentityFrom({ sourceSectionText: parts.sourceSectionText })));
		buildIndex += 1;
	}

	const selectedEntryList = entryList.slice(0, subjectCount);

	// THE PARTNER WALK. A fixed offset of half the selection, then a FORWARD SCAN over the whole entry list
	// until a partner is found that (a) hangs off a different owningConstructName — the structural half of
	// "structurally unrelated" — and (b) shares ZERO card stableIds with this source's own pool, which is
	// what makes "none of them is correct" measured rather than assumed. No clock, no random number: the
	// same trail and the same subjectCount produce the same pairing every time.
	const halfOffset = Math.floor(subjectCount / 2);
	const poolEntryList = [];
	let pairIndex = 0;
	while (pairIndex < selectedEntryList.length) {
		const sourceEntry = selectedEntryList[pairIndex];
		const ownPoolStableIdList = sourceEntry.record.renderedPoolStableIdList;
		let scanOffset = 0;
		let partnerEntry = null;
		while (scanOffset < entryList.length && partnerEntry === null) {
			const candidateEntry = entryList[(pairIndex + halfOffset + scanOffset) % entryList.length];
			const sharesNoCard = candidateEntry.record.renderedPoolStableIdList.every((oneStableId) => ownPoolStableIdList.indexOf(oneStableId) === -1);
			const differentOwner = candidateEntry.owningConstructNameText !== sourceEntry.owningConstructNameText;
			if (candidateEntry.promptHash !== sourceEntry.promptHash && sharesNoCard && differentOwner) {
				partnerEntry = candidateEntry;
			}
			scanOffset += 1;
		}
		if (partnerEntry === null) {
			refuse(`no structurally unrelated, zero-overlap partner exists for prompt ${sourceEntry.promptHash} anywhere in ${entryList.length} candidates; Pool B cannot be built honestly for it`);
		}
		const poolBUserPrompt = `${sourceEntry.sourceSectionText}${partnerEntry.candidateSectionText}`;
		poolEntryList.push({
			sourceIdentityText: sourceEntry.sourceIdentityText,
			sourceNameText: sourceEntry.sourceNameText,
			owningConstructNameText: sourceEntry.owningConstructNameText,
			poolA: {
				promptHash: sourceEntry.promptHash,
				userPromptSha256: sha256Of(sourceEntry.record.userPrompt),
				systemPromptSha256: sha256Of(sourceEntry.record.systemPrompt),
				renderedPoolStableIdList: sourceEntry.record.renderedPoolStableIdList,
				poolSize: sourceEntry.record.renderedPoolStableIdList.length,
			},
			poolB: {
				poolBorrowedFromPromptHash: partnerEntry.promptHash,
				poolBorrowedFromSourceIdentityText: partnerEntry.sourceIdentityText,
				poolBorrowedFromOwningConstructNameText: partnerEntry.owningConstructNameText,
				userPromptSha256: sha256Of(poolBUserPrompt),
				systemPromptSha256: sha256Of(sourceEntry.record.systemPrompt),
				renderedPoolStableIdList: partnerEntry.record.renderedPoolStableIdList,
				poolSize: partnerEntry.record.renderedPoolStableIdList.length,
				sharedCardCountWithOwnPool: partnerEntry.record.renderedPoolStableIdList.filter((oneStableId) => ownPoolStableIdList.indexOf(oneStableId) !== -1).length,
			},
			// the BYTES, carried so -judgePools hands every provider the identical string and G7-d is a
			// property of the construction rather than a later comparison
			poolAUserPrompt: sourceEntry.record.userPrompt,
			poolBUserPrompt,
			systemPrompt: sourceEntry.record.systemPrompt,
		});
		pairIndex += 1;
	}

	const poolRecord = {
		builtBy: `${moduleName} -buildPools`,
		forensicsTrailFilePath,
		forensicsTrailSha256: sha256Of(fs.readFileSync(forensicsTrailFilePath, 'utf8')),
		trailRecordCount: trailRead.recordList.length,
		distinctPromptCount: distinctPromptHashList.length,
		subjectCount,
		selectionRuleText: 'distinct promptHash values sorted ascending; the first subjectCount taken. No clock, no random number.',
		partnerRuleText: 'partner = index + floor(subjectCount/2), then a forward scan until a partner is found with a DIFFERENT owningConstructName and ZERO shared card stableIds with the source own pool.',
		poolEntryList,
	};
	fs.writeFileSync(poolRecordFilePath, `${JSON.stringify(poolRecord, null, '\t')}\n`);

	const totalSharedCardCount = poolEntryList.reduce((soFar, oneEntry) => soFar + oneEntry.poolB.sharedCardCountWithOwnPool, 0);
	xLog.status(`${moduleName}: pool record → ${poolRecordFilePath}`);
	xLog.status(`  trail          : ${trailRead.recordList.length} record(s), ${distinctPromptHashList.length} distinct prompt(s)`);
	xLog.status(`  selected       : ${poolEntryList.length} source(s)`);
	xLog.status(`  Pool B overlap : ${totalSharedCardCount} shared card(s) across all ${poolEntryList.length} pairs (MUST be 0)`);
	xLog.result(JSON.stringify({ poolRecordFilePath, subjectCount: poolEntryList.length, distinctPromptCount: distinctPromptHashList.length, totalSharedCardCount }, null, '\t'));
};

// ---------------------------------------------------------------------------------------------------------
// -verifyPools  (G7-b's twin: rebuild from the record, not from memory)
// ---------------------------------------------------------------------------------------------------------

const verifyPools = () => {
	const poolRecordFilePath = requiredExistingFilePath('poolRecordFilePath', 'Name the pool record to verify.');
	const forensicsTrailFilePath = requiredExistingFilePath('forensicsTrailFilePath', 'Name the trail the record was built from.');
	const poolRecord = JSON.parse(fs.readFileSync(poolRecordFilePath, 'utf8'));

	const trailRead = promptRecordListFrom({ forensicsTrailFilePath });
	if (trailRead.error) {
		refuse(trailRead.error);
	}
	const recordByPromptHash = {};
	trailRead.recordList.forEach((oneRecord) => {
		if (typeof oneRecord.promptHash === 'string' && recordByPromptHash[oneRecord.promptHash] === undefined) {
			recordByPromptHash[oneRecord.promptHash] = oneRecord;
		}
	});

	// REBUILD FROM THE RECORDED IDS ALONE. Nothing below reads poolAUserPrompt or poolBUserPrompt out of the
	// record; both are reconstructed from the two prompt hashes and compared by sha256. If the record did not
	// carry enough to do that, this refuses — which is exactly what G7-b asks to be demonstrated.
	const failureList = [];
	poolRecord.poolEntryList.forEach((oneEntry) => {
		const sourceRecord = recordByPromptHash[oneEntry.poolA.promptHash];
		const partnerRecord = recordByPromptHash[oneEntry.poolB.poolBorrowedFromPromptHash];
		if (sourceRecord === undefined) {
			failureList.push(`source prompt ${oneEntry.poolA.promptHash} is not in the trail`);
			return;
		}
		if (partnerRecord === undefined) {
			failureList.push(`partner prompt ${oneEntry.poolB.poolBorrowedFromPromptHash} is not in the trail`);
			return;
		}
		const sourceParts = promptPartsFrom({ userPrompt: sourceRecord.userPrompt, promptHash: oneEntry.poolA.promptHash });
		const partnerParts = promptPartsFrom({ userPrompt: partnerRecord.userPrompt, promptHash: oneEntry.poolB.poolBorrowedFromPromptHash });
		if (sourceParts.error || partnerParts.error) {
			failureList.push(sourceParts.error || partnerParts.error);
			return;
		}
		const rebuiltPoolAUserPrompt = sourceRecord.userPrompt;
		const rebuiltPoolBUserPrompt = `${sourceParts.sourceSectionText}${partnerParts.candidateSectionText}`;
		if (sha256Of(rebuiltPoolAUserPrompt) !== oneEntry.poolA.userPromptSha256) {
			failureList.push(`Pool A rebuild differs for ${oneEntry.poolA.promptHash}`);
		}
		if (sha256Of(rebuiltPoolBUserPrompt) !== oneEntry.poolB.userPromptSha256) {
			failureList.push(`Pool B rebuild differs for ${oneEntry.poolA.promptHash} (borrowed from ${oneEntry.poolB.poolBorrowedFromPromptHash})`);
		}
		if (oneEntry.poolB.sharedCardCountWithOwnPool !== 0) {
			failureList.push(`Pool B for ${oneEntry.poolA.promptHash} shares ${oneEntry.poolB.sharedCardCountWithOwnPool} card(s) with its own pool`);
		}
	});

	xLog.status(`${moduleName}: rebuilt ${poolRecord.poolEntryList.length} pair(s) from recorded ids alone`);
	if (failureList.length > 0) {
		refuse(`${failureList.length} rebuild failure(s): ${failureList.slice(0, 5).join(' | ')}`);
	}
	xLog.status(`  every Pool A and Pool B prompt reproduced BYTE-IDENTICALLY from the record. G7-b satisfied.`);
	xLog.result(JSON.stringify({ pairCount: poolRecord.poolEntryList.length, rebuildFailureCount: 0 }, null, '\t'));
};

// ---------------------------------------------------------------------------------------------------------
// -judgePools
// ---------------------------------------------------------------------------------------------------------

const judgePools = () => {
	const poolRecordFilePath = requiredExistingFilePath('poolRecordFilePath', 'Name the pool record to judge.');
	const judgmentFilePath = requiredFilePath('judgmentFilePath', 'Name the JSON file the judgments are written to.');
	const providerName = firstValue('providerName');
	if (typeof providerName !== 'string' || providerName === '') {
		refuse(`--providerName is required; there is no default. Known: ${registryLib.KNOWN_PROVIDER_NAME_LIST.join(', ')}`);
	}
	const poolRecord = JSON.parse(fs.readFileSync(poolRecordFilePath, 'utf8'));

	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		const constructionStartMs = Date.now();
		registryLib.constructJudgeProvider(
			{ providerName, debugJudgeRuleName: providerName === registryLib.DEBUG_JUDGE_PROVIDER_NAME ? registryLib.DEBUG_JUDGE_DEFAULT_RULE_NAME : undefined },
			(constructionError, constructedProvider) => {
				if (constructionError) {
					next(constructionError);
					return;
				}
				xLog.status(`${moduleName}: provider '${providerName}' constructed in ${Date.now() - constructionStartMs} ms — model ${constructedProvider.model}, maxConcurrency ${constructedProvider.maxConcurrency}`);
				next('', Object.assign({}, args, { judgeProvider: constructedProvider, judgmentList: [] }));
			},
		);
	});

	// ONE TASK PER JUDGMENT, PUSHED UP FRONT — the whole sequence is visible in the list rather than hidden
	// in a recursive helper. Both pools for one source sit adjacent so a reader of the log sees the pair.
	// SERIALISED regardless of provider: the ollama provider declares maxConcurrency 1, and running the
	// providers at different concurrencies would put a second variable into a differential that exists to
	// measure one.
	poolRecord.poolEntryList.forEach((oneEntry, oneEntryIndex) => {
		['poolA', 'poolB'].forEach((onePoolName) => {
			taskList.push((args, next) => {
				const userPromptText = onePoolName === 'poolA' ? oneEntry.poolAUserPrompt : oneEntry.poolBUserPrompt;
				const judgmentStartMs = Date.now();
				args.judgeProvider.rerank(
					{
						systemPrompt: oneEntry.systemPrompt,
						userPrompt: userPromptText,
						choiceEnum: choiceEnumFor({ renderedPoolStableIdList: oneEntry[onePoolName].renderedPoolStableIdList }),
					},
					(rerankError, rerankResult) => {
						const elapsedMs = Date.now() - judgmentStartMs;
						// A REFUSAL IS A RESULT AND IS RECORDED AS ONE. Dropping it would quietly shrink the
						// denominator, which is the species of error G7-a exists to prevent.
						args.judgmentList.push({
							sourceIdentityText: oneEntry.sourceIdentityText,
							poolName: onePoolName,
							promptHash: oneEntry.poolA.promptHash,
							poolBorrowedFromPromptHash: onePoolName === 'poolB' ? oneEntry.poolB.poolBorrowedFromPromptHash : null,
							userPromptSha256: oneEntry[onePoolName].userPromptSha256,
							poolSize: oneEntry[onePoolName].poolSize,
							elapsedMs,
							refusal: rerankError ? String(rerankError) : null,
							choice: rerankError ? null : rerankResult.choice,
							category: rerankError ? null : rerankResult.category,
							rationale: rerankError ? null : rerankResult.rationale,
							model: rerankError ? null : rerankResult.model,
							attempts: rerankError ? null : rerankResult.attempts,
							evalCount: rerankError ? null : rerankResult.evalCount === undefined ? null : rerankResult.evalCount,
							doneReason: rerankError ? null : rerankResult.doneReason === undefined ? null : rerankResult.doneReason,
							// ⟪JOB 7⟫ retryReasons is recorded because the FORENSIC record does not carry it:
							// a trail shows `attempts: 2` and gives a reader no way to learn whether that was a
							// malformed body or a transport timeout. Measured on 2026-09-08 they were transport
							// timeouts at requestTimeoutMs, which is a completely different fact about the
							// provider, and it was invisible until it was asked for by name.
							retryReasons: rerankError || rerankResult.retryReasons === undefined ? null : rerankResult.retryReasons,
							// the cache lives in judgeComponent, one layer ABOVE this contract; calling
							// rerank directly cannot reach it. Recorded as a fact of the path, not a reading.
							cacheConsulted: false,
						});
						xLog.status(`  [${oneEntryIndex + 1}/${poolRecord.poolEntryList.length}] ${onePoolName} ${rerankError ? 'REFUSED' : `choice ${rerankResult.choice} (${rerankResult.category === undefined ? '-' : rerankResult.category})`} ${elapsedMs} ms`);
						next('', args);
					},
				);
			});
		});
	});

	pipeRunner(taskList.getList(), {}, (pipeError, args) => {
		if (pipeError) {
			refuse(String(pipeError));
		}
		const abstainCountFor = (onePoolName) => args.judgmentList.filter((oneJudgment) => oneJudgment.poolName === onePoolName && oneJudgment.choice === ABSTAIN_CHOICE_TOKEN).length;
		const totalFor = (onePoolName) => args.judgmentList.filter((oneJudgment) => oneJudgment.poolName === onePoolName).length;
		const refusalCount = args.judgmentList.filter((oneJudgment) => oneJudgment.refusal !== null).length;
		const evalCountList = args.judgmentList.filter((oneJudgment) => typeof oneJudgment.evalCount === 'number').map((oneJudgment) => oneJudgment.evalCount).sort((leftCount, rightCount) => leftCount - rightCount);
		const judgmentDocument = {
			providerName,
			providerModel: args.judgeProvider.model,
			providerDescribe: args.judgeProvider.describe(),
			poolRecordFilePath,
			forensicsTrailSha256: poolRecord.forensicsTrailSha256,
			subjectCount: poolRecord.poolEntryList.length,
			callCount: args.judgmentList.length,
			refusalCount,
			totalElapsedMs: args.judgmentList.reduce((soFar, oneJudgment) => soFar + oneJudgment.elapsedMs, 0),
			poolAAbstainCount: abstainCountFor('poolA'),
			poolATotalCount: totalFor('poolA'),
			poolBAbstainCount: abstainCountFor('poolB'),
			poolBTotalCount: totalFor('poolB'),
			evalCountDistribution:
				evalCountList.length === 0
					? null
					: { n: evalCountList.length, min: evalCountList[0], median: evalCountList[Math.floor((evalCountList.length - 1) / 2)], max: evalCountList[evalCountList.length - 1] },
			judgmentList: args.judgmentList,
		};
		fs.writeFileSync(judgmentFilePath, `${JSON.stringify(judgmentDocument, null, '\t')}\n`);
		xLog.status(`${moduleName}: judgments → ${judgmentFilePath}`);
		xLog.status(`  provider ${providerName} (${args.judgeProvider.model}): ${args.judgmentList.length} call(s), ${refusalCount} refusal(s)`);
		xLog.status(`  Pool A abstained ${judgmentDocument.poolAAbstainCount} of ${judgmentDocument.poolATotalCount}; Pool B abstained ${judgmentDocument.poolBAbstainCount} of ${judgmentDocument.poolBTotalCount}`);
		xLog.result(
			JSON.stringify(
				{
					providerName,
					providerModel: judgmentDocument.providerModel,
					callCount: judgmentDocument.callCount,
					refusalCount,
					poolAAbstainCount: judgmentDocument.poolAAbstainCount,
					poolATotalCount: judgmentDocument.poolATotalCount,
					poolBAbstainCount: judgmentDocument.poolBAbstainCount,
					poolBTotalCount: judgmentDocument.poolBTotalCount,
					totalElapsedMs: judgmentDocument.totalElapsedMs,
					evalCountDistribution: judgmentDocument.evalCountDistribution,
				},
				null,
				'\t',
			),
		);
	});
};

// ---------------------------------------------------------------------------------------------------------
// VERB SELECTION — a DATA map, not a switch. Adding a verb is a row.
// ---------------------------------------------------------------------------------------------------------

const VERB_HANDLER_BY_SWITCH_NAME = Object.freeze({
	buildPools,
	verifyPools,
	judgePools,
});

const namedVerbList = Object.keys(VERB_HANDLER_BY_SWITCH_NAME).filter((oneVerbName) => commandLineParameters.switches[oneVerbName]);
if (namedVerbList.length === 0) {
	refuse(`name exactly one verb: ${Object.keys(VERB_HANDLER_BY_SWITCH_NAME).map((oneVerbName) => `-${oneVerbName}`).join(', ')}. There is no default verb.`);
}
if (namedVerbList.length > 1) {
	refuse(`name exactly ONE verb; ${namedVerbList.map((oneVerbName) => `-${oneVerbName}`).join(', ')} were all given. Two verbs in one command is an ambiguity, not a convenience.`);
}
VERB_HANDLER_BY_SWITCH_NAME[namedVerbList[0]]();
