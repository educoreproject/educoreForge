'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// derivedEval.js — THE SCORING HARNESS (PLAN-derivedBridge-v1.md §6 + the §11 additions). App-level, never
// framework: the framework must not be able to see the truth set, and the only reader of the crosswalk store
// in this whole order is this file.
//
//   scoreDerivedRun({ truthStoreFilePath, truthBlockId, derivedStoreFilePath, derivedBlockId }) →
//     { score, markdownText } | { error }
//
// EVERY NUMBER IS MEASURED FROM THE TWO FROZEN BLOCKS. Nothing is recomputed, re-retrieved or re-judged: if a
// number cannot be derived from the blocks it is not reported. That is what makes the score checkable by
// someone who does not trust this file — they can open the blocks.
//
// THE TWO FAILURES ARE SEPARATED, and that separation is the point of the exercise:
//   RETRIEVAL failure — the truth card was never in the pool, so the judge could not have picked it however
//                       good it is. Measured by recall@K, which needs NO judge at all: the pool is recorded
//                       per subject with its rank, so the whole K = 1..25 curve is readable from ONE debug
//                       run and K can be re-ruled on evidence before a cent is spent (D0 review §D5).
//   JUDGMENT failure  — the truth card WAS in the pool and the judge picked another, or abstained. Scored
//                       only over subjects where retrieval succeeded, because scoring the judge on a pool
//                       that could not contain the answer measures the retriever and blames the judge.
//
// THE TRUTH SET IS NOT A GOLD STANDARD AND IS NOT TREATED AS ONE. It is what the Ed-Fi crosswalk authors
// said, plus what Opus chose among crosswalk candidates. A derived pick the crosswalk never considered is
// reported as a NEW CLAIM, not as a wrong answer — the 3 orphans, 31 collisions and 2 gaps have no truth to
// be wrong about, and neither do the 1,203 subjects the crosswalk never mentions.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

const RECALL_K_LIST = Object.freeze([1, 3, 5, 10, 15, 20, 25]);
const MAX_RECALL_K = 25;
const CONFIDENCE_BAND_LIST = Object.freeze([0.9, 0.7, 0.5]);

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const asPercent = (numerator, denominator) => (denominator === 0 ? '—' : `${((numerator / denominator) * 100).toFixed(1)}%`);
// entityOf — 'edfi:property/<construct>.<Entity>.<Element>' → the entity segment, for the per-entity table.
// A global number hides that (say) all of Assessment fails (D0 review §E6).
const entityOf = (subjectStableId) => {
	const tail = String(subjectStableId).split('/').slice(1).join('/');
	const segmentList = tail.split('.');
	return segmentList.length >= 2 ? segmentList[segmentList.length - 2] : tail;
};

// readFrozenBlock — one read-only open of a decision store, by path. better-sqlite3 is required LAZILY so
// this module's static require graph stays driver-free for anything that merely imports its helpers.
const readFrozenBlock = ({ storeFilePath, blockId, roleName }) => {
	if (!isNonEmptyString(storeFilePath) || !fs.existsSync(storeFilePath)) {
		return { error: refuse.byName({ moduleName, what: `the ${roleName} decision store is absent at ${storeFilePath}`, where: 'the harness reads BOTH blocks by path, read-only; it never builds and never re-judges' }) };
	}
	const Database = require('better-sqlite3');
	const db = new Database(storeFilePath, { readonly: true });
	const row = isNonEmptyString(blockId)
		? db.prepare('SELECT decisionBlockHash, frozenText FROM decisionBlocks WHERE decisionBlockHash = ?').get(blockId)
		: db.prepare('SELECT decisionBlockHash, frozenText FROM decisionBlocks ORDER BY seq DESC LIMIT 1').get();
	db.close();
	if (row === undefined) {
		return { error: refuse.byName({ moduleName, what: `the ${roleName} store ${storeFilePath} holds no block ${blockId === undefined ? '(latest)' : blockId}`, where: 'a score over a block that is not there would be a score over nothing; the id is named, never guessed' }) };
	}
	let parsed = null;
	let parseFault = '';
	try {
		parsed = JSON.parse(row.frozenText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	if (parseFault) {
		return { error: refuse.byName({ moduleName, what: `the ${roleName} block ${row.decisionBlockHash} is not JSON (${parseFault})`, where: 'a frozen block is its own evidence; an unreadable one is refused, never partially interpreted' }) };
	}
	return { block: parsed, blockId: row.decisionBlockHash };
};

// truthViewOf — what the crosswalk block SAYS, per subject. Three distinct populations, kept distinct:
//   picked   — ≥1 truth object. The only subjects a pick can be scored against.
//   abstained— named by the block with NO picked object (the crosswalk judge abstained, or it orphaned).
//   noTruth  — collision / gap subjects: named, but with nothing to be right or wrong about.
const truthViewOf = (truthBlock) => {
	const objectSetBySubject = {};
	const subjectSet = new Set();
	truthBlock.decisionRecordList.forEach((oneRecord) => {
		subjectSet.add(oneRecord.subjectStableId);
		if (isNonEmptyString(oneRecord.objectStableId)) {
			(objectSetBySubject[oneRecord.subjectStableId] = objectSetBySubject[oneRecord.subjectStableId] || new Set()).add(oneRecord.objectStableId);
		}
	});
	const collisionSubjectSet = new Set();
	truthBlock.refusalList.filter((oneRefusal) => oneRefusal.kind === 'subjectCollision' && isNonEmptyString(oneRefusal.subjectStableId)).forEach((oneRefusal) => {
		collisionSubjectSet.add(oneRefusal.subjectStableId);
		subjectSet.add(oneRefusal.subjectStableId);
	});
	return {
		objectSetBySubject,
		subjectStableIdList: Array.from(subjectSet).sort(compareStrings),
		pickedSubjectList: Object.keys(objectSetBySubject).sort(compareStrings),
		collisionSubjectSet,
		// a sourceGap carries NO subjectStableId — it is BY DEFINITION a subject that did not resolve to a node,
		// so it contributes ZERO to a population of graph nodes. 694 records + 7 collisions = 701, disjoint.
		sourceGapCount: truthBlock.refusalList.filter((oneRefusal) => oneRefusal.kind === 'sourceGap').length,
	};
};

const scoreDerivedRun = ({ truthStoreFilePath, truthBlockId, derivedStoreFilePath, derivedBlockId, ceilingRecallByK } = {}) => {
	const truthRead = readFrozenBlock({ storeFilePath: truthStoreFilePath, blockId: truthBlockId, roleName: 'truth' });
	if (truthRead.error) {
		return { error: truthRead.error };
	}
	const derivedRead = readFrozenBlock({ storeFilePath: derivedStoreFilePath, blockId: derivedBlockId, roleName: 'derived' });
	if (derivedRead.error) {
		return { error: derivedRead.error };
	}
	if (truthRead.blockId === derivedRead.blockId) {
		return { error: refuse.byName({ moduleName, what: `the truth block and the derived block are the SAME block (${truthRead.blockId})`, where: 'scoring a block against itself reports a perfect result and means nothing; the two stores are separate for exactly this reason (RULING §11.5)' }) };
	}
	if (derivedRead.block.header.producerKind !== 'inferred') {
		return { error: refuse.byName({ moduleName, what: `the block named as derived (${derivedRead.blockId}) carries producerKind '${derivedRead.block.header.producerKind}'`, where: 'this harness scores an INFERRED producer against an authored one; the roles are checked, never assumed from the argument order' }) };
	}
	const truth = truthViewOf(truthRead.block);
	const derivedRecordList = derivedRead.block.decisionRecordList;

	// ---- RETRIEVAL: recall@K, measured from the recorded pools. No judge involved. ----
	const scorableRecordList = derivedRecordList.filter((oneRecord) => truth.objectSetBySubject[oneRecord.subjectStableId] !== undefined);
	const recallByK = {};
	RECALL_K_LIST.concat([MAX_RECALL_K]).forEach((oneK) => {
		recallByK[oneK] = 0;
	});
	const fullRecallCurve = [];
	for (let oneK = 1; oneK <= MAX_RECALL_K; oneK++) {
		const hitCount = scorableRecordList.filter((oneRecord) => {
			const seatList = Array.isArray(oneRecord.retrievalSeatList) ? oneRecord.retrievalSeatList : [];
			const truthSet = truth.objectSetBySubject[oneRecord.subjectStableId];
			return seatList.slice().sort((leftSeat, rightSeat) => leftSeat.rank - rightSeat.rank).slice(0, oneK).some((oneSeat) => truthSet.has(oneSeat.stableId));
		}).length;
		fullRecallCurve.push({ k: oneK, hitCount, subjectCount: scorableRecordList.length, recall: scorableRecordList.length === 0 ? null : hitCount / scorableRecordList.length });
		if (recallByK[oneK] !== undefined) {
			recallByK[oneK] = scorableRecordList.length === 0 ? null : hitCount / scorableRecordList.length;
		}
	}

	// ---- JUDGMENT: only over subjects whose truth card was actually IN the pool ----
	const inPoolRecordList = scorableRecordList.filter((oneRecord) => {
		const truthSet = truth.objectSetBySubject[oneRecord.subjectStableId];
		return (Array.isArray(oneRecord.retrievalSeatList) ? oneRecord.retrievalSeatList : []).some((oneSeat) => truthSet.has(oneSeat.stableId));
	});
	const isAbstained = (oneRecord) => oneRecord.abstained === true || !isNonEmptyString(oneRecord.objectStableId);
	const correctList = inPoolRecordList.filter((oneRecord) => !isAbstained(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
	const wrongList = inPoolRecordList.filter((oneRecord) => !isAbstained(oneRecord) && !truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId));
	const abstainedInPoolList = inPoolRecordList.filter(isAbstained);

	// ---- ABSTENTION QUALITY: does derived abstain where the truth set also had nothing? ----
	const truthAbstainedSubjectSet = new Set(truth.subjectStableIdList.filter((oneId) => truth.objectSetBySubject[oneId] === undefined));
	const derivedOnTruthAbstained = derivedRecordList.filter((oneRecord) => truthAbstainedSubjectSet.has(oneRecord.subjectStableId));
	const abstentionQuality = {
		truthAbstainedSubjectCount: truthAbstainedSubjectSet.size,
		derivedAlsoAbstainedCount: derivedOnTruthAbstained.filter(isAbstained).length,
		derivedClaimedAnywayCount: derivedOnTruthAbstained.filter((oneRecord) => !isAbstained(oneRecord)).length,
	};

	// ---- MULTI-TARGET: a subject the crosswalk gave 2–3 objects. A single pick is CORRECT if it is in the set.
	const multiTargetSubjectList = truth.pickedSubjectList.filter((oneId) => truth.objectSetBySubject[oneId].size > 1);
	// ---- NEW CLAIMS: a derived pick on a subject with no truth at all. Reported, never scored. ----
	const newClaimList = derivedRecordList
		.filter((oneRecord) => !isAbstained(oneRecord) && truth.objectSetBySubject[oneRecord.subjectStableId] === undefined)
		.map((oneRecord) => ({ subjectStableId: oneRecord.subjectStableId, objectStableId: oneRecord.objectStableId, predicate: oneRecord.predicate, confidence: oneRecord.confidence }));

	// ---- CALIBRATION: exactly three points, because confidence is fully determined by category (0.9/0.7/0.5).
	// Reported as a 3×2 contingency table and NOT as a curve — implying a curve over three values would be a
	// picture of a resolution this data does not have (D0 review §B, §E6).
	const calibrationRowList = CONFIDENCE_BAND_LIST.map((oneBand) => {
		const atBand = inPoolRecordList.filter((oneRecord) => !isAbstained(oneRecord) && oneRecord.confidence === oneBand);
		const rightCount = atBand.filter((oneRecord) => truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId)).length;
		return { confidence: oneBand, pickCount: atBand.length, correctCount: rightCount, wrongCount: atBand.length - rightCount };
	});

	// ---- PER ENTITY ----
	const perEntityByName = {};
	inPoolRecordList.forEach((oneRecord) => {
		const entityName = entityOf(oneRecord.subjectStableId);
		const row = (perEntityByName[entityName] = perEntityByName[entityName] || { entityName, inPoolCount: 0, correctCount: 0, wrongCount: 0, abstainedCount: 0 });
		row.inPoolCount += 1;
		if (isAbstained(oneRecord)) {
			row.abstainedCount += 1;
		} else if (truth.objectSetBySubject[oneRecord.subjectStableId].has(oneRecord.objectStableId)) {
			row.correctCount += 1;
		} else {
			row.wrongCount += 1;
		}
	});

	// RETRIEVAL LOSS, REPORTED EXPLICITLY (RULING SABLE_RIVER 2026-08-17). Subjects whose truth card was never
	// in the pool cannot be got right by ANY judge, so counting them against the judge measures the retriever
	// and blames the model. They are named here as their own quantity, and the CEILING GAP beside them says how
	// many of them a larger K would have recovered — so "the judge missed it" and "retrieval never offered it"
	// can never be read as the same number. ceilingRecallByK is optional: pass the curve from
	// retrievalCeiling.js and the gap is computed; omit it and the gap is reported as null rather than guessed.
	const retrievalLossCount = scorableRecordList.length - inPoolRecordList.length;
	const declaredK = derivedRead.block.header.candidateRetrieval === null || derivedRead.block.header.candidateRetrieval === undefined ? null : derivedRead.block.header.candidateRetrieval.k;
	const ceilingAtMaxK = ceilingRecallByK === undefined || ceilingRecallByK === null ? null : ceilingRecallByK[MAX_RECALL_K];
	const retrievalLoss = {
		scorableSubjectCount: scorableRecordList.length,
		truthCardInPoolCount: inPoolRecordList.length,
		// the honest headline of the retrieval half: subjects the judge was never given a chance on
		neverOfferedCount: retrievalLossCount,
		neverOfferedShare: scorableRecordList.length === 0 ? null : retrievalLossCount / scorableRecordList.length,
		declaredK,
		// how many of the never-offered a LARGER K would have reached, measured without K and without the floor
		recoverableByLargerKCount: ceilingAtMaxK === null || scorableRecordList.length === 0 ? null : Math.round(ceilingAtMaxK * scorableRecordList.length) - inPoolRecordList.length,
		ceilingK: ceilingAtMaxK === null ? null : MAX_RECALL_K,
		note: 'a subject whose truth card was never in the pool cannot be got right by any judge; this is retrieval loss, never judgment loss',
	};

	const score = {
		truthBlockId: truthRead.blockId,
		retrievalLoss,
		derivedBlockId: derivedRead.blockId,
		retrievalParameters: derivedRead.block.header.candidateRetrieval,
		predicateRule: derivedRead.block.header.predicateRule,
		population: {
			truthSubjectCount: truth.subjectStableIdList.length,
			truthPickedSubjectCount: truth.pickedSubjectList.length,
			truthAbstainedSubjectCount: truthAbstainedSubjectSet.size,
			truthSourceGapCount: truth.sourceGapCount,
			derivedRecordCount: derivedRecordList.length,
			scorableCount: scorableRecordList.length,
			truthCardInPoolCount: inPoolRecordList.length,
		},
		retrieval: { recallByK, fullRecallCurve },
		judgment: {
			correctCount: correctList.length,
			wrongCount: wrongList.length,
			abstainedCount: abstainedInPoolList.length,
			precisionOnNonAbstain: correctList.length + wrongList.length === 0 ? null : correctList.length / (correctList.length + wrongList.length),
			recallOnInPool: inPoolRecordList.length === 0 ? null : correctList.length / inPoolRecordList.length,
			// the END-TO-END number, over every scorable subject including those retrieval never reached. It is
			// ALWAYS the smaller number and it is the one that answers "how good is this producer?"
			endToEndAccuracy: scorableRecordList.length === 0 ? null : correctList.length / scorableRecordList.length,
		},
		abstentionQuality,
		multiTargetSubjectCount: multiTargetSubjectList.length,
		newClaimCount: newClaimList.length,
		newClaimSample: newClaimList.slice(0, 20),
		calibration: calibrationRowList,
		perEntity: Object.keys(perEntityByName).sort(compareStrings).map((oneName) => perEntityByName[oneName]),
		wrongPickSample: wrongList.slice(0, 25).map((oneRecord) => ({ subjectStableId: oneRecord.subjectStableId, pickedObjectStableId: oneRecord.objectStableId, truthObjectStableIdList: Array.from(truth.objectSetBySubject[oneRecord.subjectStableId]).sort(compareStrings), confidence: oneRecord.confidence })),
	};

	const lineList = [];
	lineList.push(`# Derived bridge score — block \`${score.derivedBlockId}\``);
	lineList.push('');
	lineList.push(`Scored BLIND against the frozen Ed-Fi crosswalk block \`${score.truthBlockId}\`, which the derived`);
	lineList.push('producer cannot reach: it declares no channel, opens no file, and runs against its own decision store.');
	lineList.push('Every number below is measured from those two blocks and nothing else.');
	lineList.push('');
	lineList.push(`Retrieval: K = ${score.retrievalParameters ? score.retrievalParameters.k : '—'}, floor = ${score.retrievalParameters ? score.retrievalParameters.floor : '—'}, model \`${score.retrievalParameters ? score.retrievalParameters.embeddingModelVersion : '—'}\`. Predicate rule: \`${score.predicateRule}\`.`);
	lineList.push('');
	lineList.push('## Population');
	lineList.push('');
	lineList.push(`- truth block names **${score.population.truthSubjectCount}** subjects (${score.population.truthPickedSubjectCount} with a picked object, ${score.population.truthAbstainedSubjectCount} without; ${score.population.truthSourceGapCount} sourceGap refusals name no subject node at all and contribute zero)`);
	lineList.push(`- derived block holds **${score.population.derivedRecordCount}** records, of which **${score.population.scorableCount}** have something to be scored against`);
	lineList.push(`- of those, the truth card was actually IN the pool for **${score.population.truthCardInPoolCount}**`);
	lineList.push('');
	lineList.push('## Retrieval — recall@K');
	lineList.push('');
	lineList.push('This is the CEILING on judge accuracy. A subject whose truth card is not in the pool cannot be got');
	lineList.push('right by any judge, however good. It needs no judge to measure, which is why the whole curve is');
	lineList.push('readable from one free debug run and K can be re-ruled before a cent is spent.');
	lineList.push('');
	lineList.push('| K | truth card in pool | recall |');
	lineList.push('|---:|---:|---:|');
	RECALL_K_LIST.forEach((oneK) => {
		const row = score.retrieval.fullRecallCurve[oneK - 1];
		lineList.push(`| ${oneK} | ${row.hitCount} / ${row.subjectCount} | ${asPercent(row.hitCount, row.subjectCount)} |`);
	});
	lineList.push('');
	lineList.push('### Retrieval LOSS — the subjects the judge was never given a chance on');
	lineList.push('');
	lineList.push(`**${score.retrievalLoss.neverOfferedCount} of ${score.retrievalLoss.scorableSubjectCount}** scorable subjects (${asPercent(score.retrievalLoss.neverOfferedCount, score.retrievalLoss.scorableSubjectCount)}) had their truth card`);
	lineList.push(`OUTSIDE the pool at the declared K = ${score.retrievalLoss.declaredK}. No judge, however good, could have got these right.`);
	lineList.push('They are counted here and NOT against the judge below — counting them against the judge would measure the');
	lineList.push('retriever and blame the model.');
	if (score.retrievalLoss.recoverableByLargerKCount !== null) {
		lineList.push('');
		lineList.push(`Of those, **${score.retrievalLoss.recoverableByLargerKCount}** would have been reached at K = ${score.retrievalLoss.ceilingK} (measured with no K and no floor).`);
		lineList.push('That is the price of the declared ceiling, stated as a number rather than left implicit.');
	}
	lineList.push('');
	lineList.push('## Judgment — over the subjects retrieval actually reached');
	lineList.push('');
	lineList.push(`- correct: **${score.judgment.correctCount}** · wrong: **${score.judgment.wrongCount}** · abstained: **${score.judgment.abstainedCount}**`);
	lineList.push(`- precision on non-abstain: **${score.judgment.precisionOnNonAbstain === null ? '—' : asPercent(score.judgment.correctCount, score.judgment.correctCount + score.judgment.wrongCount)}**`);
	lineList.push(`- recall over in-pool subjects: **${score.judgment.recallOnInPool === null ? '—' : asPercent(score.judgment.correctCount, score.population.truthCardInPoolCount)}**`);
	lineList.push(`- **end-to-end accuracy over ALL scorable subjects: ${score.judgment.endToEndAccuracy === null ? '—' : asPercent(score.judgment.correctCount, score.population.scorableCount)}** — the honest headline; it includes the subjects retrieval never reached.`);
	lineList.push('');
	lineList.push('## Abstention quality');
	lineList.push('');
	lineList.push(`Of the **${score.abstentionQuality.truthAbstainedSubjectCount}** subjects the truth set has no object for, derived also abstained on **${score.abstentionQuality.derivedAlsoAbstainedCount}** and claimed a mapping anyway on **${score.abstentionQuality.derivedClaimedAnywayCount}**.`);
	lineList.push('');
	lineList.push('## Calibration — three points, not a curve');
	lineList.push('');
	lineList.push('Confidence is fully determined by the judge category (0.9 / 0.7 / 0.5), so there are exactly three');
	lineList.push('values. A curve drawn through three points would imply a resolution this data does not have.');
	lineList.push('');
	lineList.push('| confidence | picks | correct | wrong |');
	lineList.push('|---:|---:|---:|---:|');
	score.calibration.forEach((oneRow) => lineList.push(`| ${oneRow.confidence} | ${oneRow.pickCount} | ${oneRow.correctCount} | ${oneRow.wrongCount} |`));
	lineList.push('');
	lineList.push(`## New claims — ${score.newClaimCount}, reported and NOT scored`);
	lineList.push('');
	lineList.push('A derived pick on a subject the crosswalk never resolved. There is no truth for it to disagree with,');
	lineList.push('so counting it as an error would punish the producer for answering a question nobody else answered.');
	lineList.push('');
	score.newClaimSample.forEach((oneClaim) => lineList.push(`- \`${oneClaim.subjectStableId}\` → \`${oneClaim.objectStableId}\` (${oneClaim.predicate}, confidence ${oneClaim.confidence})`));
	lineList.push('');
	lineList.push('## Per entity — where it fails, not just how often');
	lineList.push('');
	lineList.push('| entity | in pool | correct | wrong | abstained |');
	lineList.push('|---|---:|---:|---:|---:|');
	score.perEntity.forEach((oneRow) => lineList.push(`| ${oneRow.entityName} | ${oneRow.inPoolCount} | ${oneRow.correctCount} | ${oneRow.wrongCount} | ${oneRow.abstainedCount} |`));
	lineList.push('');
	lineList.push('## Wrong picks — with both cards named');
	lineList.push('');
	score.wrongPickSample.forEach((oneRow) => lineList.push(`- \`${oneRow.subjectStableId}\`: picked \`${oneRow.pickedObjectStableId}\` (confidence ${oneRow.confidence}); truth said ${oneRow.truthObjectStableIdList.map((oneId) => `\`${oneId}\``).join(', ')}`));
	lineList.push('');
	return { score, markdownText: lineList.join('\n') };
};

module.exports = { scoreDerivedRun, readFrozenBlock, truthViewOf, entityOf, RECALL_K_LIST, MAX_RECALL_K, moduleName };
