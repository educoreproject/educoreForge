#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// retrievalCeiling.js — the UNBOUNDED recall@K curve, measured by full cosine over the whole candidate space
// with NO K and NO floor. Read-only against a live graph and a frozen truth block.
//
// WHY THIS EXISTS SEPARATELY FROM derivedEval.js, and the distinction matters:
//
//   derivedEval.js measures recall FROM THE RECORDED POOLS — what the judge actually saw, K and floor
//   included. That is the honest number for "how did this run do".
//
//   It CANNOT answer "should K be higher?", because a pool capped at K=15 holds at most 15 seats, so
//   recall@20 and recall@25 computed from it cannot exceed recall@15. They do not measure anything; they
//   PLATEAU. A table showing @15 = @20 = @25 looks like a finding about retrieval and is actually a finding
//   about the ceiling that was declared. This module removes the ceiling so the question can be asked.
//
// It is DELIBERATELY independent of candidateRetrieval.js: its own cosine, its own sort, its own tie-break.
// A second implementation that agrees is evidence; the same implementation run twice is not. Measured
// 2026-08-17 against GOLD_EVAL_260816 it reproduced the D0 reviewer's independent figures EXACTLY, counts
// included — 272/395/453/503/534/562 of 655 at K = 1/3/5/10/15/25.
//
//   node apps/graph-builder/test/bridgeAcceptance/retrievalCeiling.js \
//     --boltUrl=bolt://localhost:7815 --password=<pw> [--subjectLabel=EdfiProperty] [--maxK=25]

const helpText = () => `
NAME
     ${moduleName} -- the UNBOUNDED recall@K ceiling (no K, no floor), for re-ruling K on evidence

SYNOPSIS
     ${moduleName} --boltUrl=<url> --password=<pw> [--subjectLabel=<label>] [--maxK=<n>] [--truthStoreFilePath=<p>] [--truthBlockId=<id>]

EXIT STATUS
     0 measured;  1 refused by name.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const path = require('path');
const PAGE_SIZE = 5000;
const DEFAULT_TRUTH_STORE = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/edfi/edfiBridge.decisions.sqlite3';
const DEFAULT_TRUTH_BLOCK_ID = 'e15acd6b5a43df3ce11b4e3f3bb55d97441c14658908d3518a55494cf24a322c';
const REPORT_K_LIST = Object.freeze([1, 3, 5, 10, 15, 20, 25, 50]);

const firstValue = (name) => (Array.isArray(commandLineParameters.values[name]) ? commandLineParameters.values[name][0] : commandLineParameters.values[name]);
const refuse = (what, where) => {
	xLog.error(`${moduleName} REFUSED: ${what} — ${where}`);
	process.exit(1);
};

const boltUrl = firstValue('boltUrl');
const password = firstValue('password');
if (typeof boltUrl !== 'string' || typeof password !== 'string') {
	refuse('--boltUrl and --password are both required', 'the ceiling is measured against a NAMED graph; there is no default graph and guessing one would silently measure the wrong population');
}
const subjectLabel = firstValue('subjectLabel') === undefined ? 'EdfiProperty' : firstValue('subjectLabel');
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(subjectLabel)) {
	refuse(`--subjectLabel ${JSON.stringify(subjectLabel)} is not a graph label`, 'the label reaches cypher by interpolation and cannot be a bound parameter');
}
const maxK = firstValue('maxK') === undefined ? 25 : Number(firstValue('maxK'));
const truthStoreFilePath = firstValue('truthStoreFilePath') === undefined ? DEFAULT_TRUTH_STORE : firstValue('truthStoreFilePath');
const truthBlockId = firstValue('truthBlockId') === undefined ? DEFAULT_TRUTH_BLOCK_ID : firstValue('truthBlockId');

const Database = require('better-sqlite3');
const neo4j = require('neo4j-driver');

const db = new Database(truthStoreFilePath, { readonly: true });
const truthRow = db.prepare('SELECT frozenText FROM decisionBlocks WHERE decisionBlockHash = ?').get(truthBlockId);
db.close();
if (truthRow === undefined) {
	refuse(`the truth store holds no block ${truthBlockId}`, 'the ceiling is measured against a NAMED frozen block, never the latest');
}
const truthBlock = JSON.parse(truthRow.frozenText);
const truthObjectSetBySubject = {};
truthBlock.decisionRecordList.forEach((oneRecord) => {
	if (typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0) {
		(truthObjectSetBySubject[oneRecord.subjectStableId] = truthObjectSetBySubject[oneRecord.subjectStableId] || new Set()).add(oneRecord.objectStableId);
	}
});
const subjectWithTruthList = Object.keys(truthObjectSetBySubject).sort();

const driver = neo4j.driver(boltUrl, neo4j.auth.basic('neo4j', password), { encrypted: false });
const session = driver.session();
const pagedRead = (cypher, done) => {
	const collected = [];
	const readPage = (skip) => {
		session
			.run(`${cypher} SKIP ${skip} LIMIT ${PAGE_SIZE}`)
			.then((result) => {
				result.records.forEach((oneRecord) => collected.push({ stableId: oneRecord.get('sid'), embedding: oneRecord.get('emb') }));
				if (result.records.length < PAGE_SIZE) {
					done(collected);
					return;
				}
				readPage(skip + PAGE_SIZE);
			})
			.catch((runError) => refuse(`graph read failed: ${runError.message}`, `bolt ${boltUrl}`));
	};
	readPage(0);
};

pagedRead("MATCH (n:HubReference) WHERE n.referenceTier='property' RETURN n.stableId AS sid, n.embedding AS emb ORDER BY n.stableId", (cardList) => {
	pagedRead(`MATCH (n:${subjectLabel}) RETURN n.stableId AS sid, n.embedding AS emb ORDER BY n.stableId`, (subjectList) => {
		session.close().then(() => driver.close()).then(() => {
			if (cardList.length === 0 || subjectList.length === 0) {
				refuse(`the graph yielded ${cardList.length} card(s) and ${subjectList.length} '${subjectLabel}' node(s)`, 'an empty population is refused by name, never reported as a ceiling of zero');
			}
			const dimension = cardList[0].embedding.length;
			const matrix = new Float64Array(cardList.length * dimension);
			const normList = new Float64Array(cardList.length);
			cardList.forEach((oneCard, cardIndex) => {
				matrix.set(oneCard.embedding, cardIndex * dimension);
				let sumOfSquares = 0;
				for (let oneIndex = 0; oneIndex < dimension; oneIndex++) sumOfSquares += oneCard.embedding[oneIndex] * oneCard.embedding[oneIndex];
				normList[cardIndex] = Math.sqrt(sumOfSquares);
			});
			const subjectByStableId = subjectList.reduce((soFar, oneSubject) => ({ ...soFar, [oneSubject.stableId]: oneSubject }), {});
			const hitCountByK = {};
			for (let oneK = 1; oneK <= maxK; oneK++) hitCountByK[oneK] = 0;
			let measuredCount = 0;
			const absentList = [];
			subjectWithTruthList.forEach((oneSubjectId) => {
				const subject = subjectByStableId[oneSubjectId];
				if (subject === undefined) {
					absentList.push(oneSubjectId);
					return;
				}
				measuredCount += 1;
				let subjectNorm = 0;
				for (let oneIndex = 0; oneIndex < dimension; oneIndex++) subjectNorm += subject.embedding[oneIndex] * subject.embedding[oneIndex];
				subjectNorm = Math.sqrt(subjectNorm);
				const scored = new Array(cardList.length);
				for (let cardIndex = 0; cardIndex < cardList.length; cardIndex++) {
					const base = cardIndex * dimension;
					let dotProduct = 0;
					for (let oneIndex = 0; oneIndex < dimension; oneIndex++) dotProduct += matrix[base + oneIndex] * subject.embedding[oneIndex];
					scored[cardIndex] = { stableId: cardList[cardIndex].stableId, cosine: dotProduct / (normList[cardIndex] * subjectNorm) };
				}
				// cosine DESC then stableId ASC — the SAME tie-break candidateRetrieval declares, so the two are
				// comparable; everything else here is deliberately its own implementation
				scored.sort((leftSeat, rightSeat) => (rightSeat.cosine - leftSeat.cosine) || (leftSeat.stableId < rightSeat.stableId ? -1 : leftSeat.stableId > rightSeat.stableId ? 1 : 0));
				const truthSet = truthObjectSetBySubject[oneSubjectId];
				let firstHitRank = 0;
				for (let rankIndex = 0; rankIndex < scored.length && firstHitRank === 0; rankIndex++) {
					if (truthSet.has(scored[rankIndex].stableId)) firstHitRank = rankIndex + 1;
				}
				if (firstHitRank !== 0) {
					for (let oneK = firstHitRank; oneK <= maxK; oneK++) hitCountByK[oneK] += 1;
				}
			});
			const curve = [];
			for (let oneK = 1; oneK <= maxK; oneK++) curve.push({ k: oneK, hitCount: hitCountByK[oneK], subjectCount: measuredCount, recall: hitCountByK[oneK] / measuredCount });
			xLog.status(`${moduleName}: ${cardList.length} property-tier card(s), ${subjectList.length} '${subjectLabel}' node(s), ${measuredCount} subject(s) with a picked truth object${absentList.length ? `, ${absentList.length} named by truth but ABSENT from this graph` : ''}`);
			xLog.status('  UNBOUNDED recall@K — no K, no floor; this is the CEILING any judge is capped by');
			REPORT_K_LIST.filter((oneK) => oneK <= maxK).forEach((oneK) => {
				xLog.status(`    K=${String(oneK).padStart(2)}  ${String(hitCountByK[oneK]).padStart(4)}/${measuredCount}  ${((hitCountByK[oneK] / measuredCount) * 100).toFixed(2)}%`);
			});
			xLog.result(JSON.stringify({ boltUrl, subjectLabel, truthBlockId, cardCount: cardList.length, subjectCount: subjectList.length, measuredCount, absentCount: absentList.length, curve }, null, '\t'));
			process.exit(0);
		});
	});
});
