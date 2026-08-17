'use strict';

// p2_orphanSubjectVerification.js — LUNAR_PRISM (P2), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// **SUSPECT THE INSTRUMENT BEFORE PUBLISHING THE FINDING.** The census reported ONE subject of 2,213
// with an empty candidate pool at floor 0.30. REPORT-P0 §4.2 measured ZERO empty pools at that floor
// and concluded "the floor discards nothing … the judged-subject count equals the subject count under
// any scope." So the census contradicts a published claim BY ONE, and that is exactly the shape of
// result to distrust until it is decomposed.
//
// **THE TWO EXPLANATIONS PRESENT IDENTICALLY FROM THE CENSUS LINE ALONE:**
//   (a) A GENUINE SUB-FLOOR SCORE — the subject's best card is below 0.30. That would be a real and
//       expected consequence of P0b's re-embed: P0 measured the floor against the PRE-re-embed
//       all-C0 vectors, and 11,939 declarations' text changed afterwards. Nobody re-measured the
//       floor after the change.
//   (b) A MISSING OR MALFORMED VECTOR — no embedding on the node, so nothing to score. That would be
//       an ARTEFACT and a defect, not a finding about the floor.
// One is a fact about retrieval; the other is a fault in the pipeline. **They must not be reported
// as the same thing, and the census line cannot tell them apart.**
//
// This reads the FROZEN BLOCK from the decision store — the artifact, not the log — finds the orphan
// record by name, and then goes to the graph for that subject's actual vector and its true top-1
// cosine against the same 2,777 property-tier cards. It REPORTS which explanation holds; it does not
// decide what to do about it.
//
// CONNECTION DETAILS GO STALE — pass P2_BOLT_URL / P2_BOLT_PASSWORD, or re-resolve with docker inspect.

const path = require('path');
const { spawnSync } = require('child_process');
const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');

const moduleName = 'p2_orphanSubjectVerification';
const DECISION_STORE = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/pescDerived/pescDerived.decisions.sqlite3';
const DECLARED_FLOOR = 0.3;

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

// ---- 1. the FROZEN BLOCK from the store, never the log
const ran = spawnSync('sqlite3', [`file:${DECISION_STORE}?mode=ro`, 'SELECT frozenText FROM decisionBlocks LIMIT 1;'], {
	encoding: 'utf8',
	maxBuffer: 512 * 1024 * 1024,
});
if (ran.status !== 0 || ran.error) {
	report({ probe: moduleName, verdict: 'REFUSED', reason: `sqlite3 ${ran.status}: ${ran.error ? ran.error.message : ran.stderr}` });
	process.exitCode = 1;
} else {
	const frozenText = String(ran.stdout || '');
	// ⚠️ CORRECTED. My first reader split the frozen text into LINES and looked for JSON records, found
	// exactly ONE line, and REFUSED rather than concluding "no orphan" — which would have been a
	// confident falsehood produced by a broken reader. THE BLOCK IS ONE JSON DOCUMENT:
	// {"header":{…},"decisionRecordList":[…]}. The refusal is why that mistake cost a re-run instead of
	// a wrong finding, and it is the same guard shape as everything else in this order.
	const parsedBlock = JSON.parse(frozenText);
	const recordLineList = Array.isArray(parsedBlock.decisionRecordList) ? parsedBlock.decisionRecordList : [];
	const orphanRecordList = recordLineList.filter((oneRecord) => oneRecord.resolution === 'orphan' || oneRecord.reason === 'noCandidate');

	if (orphanRecordList.length === 0) {
		report({
			probe: moduleName,
			verdict: 'REFUSED — NOT A CLEAN NEGATIVE',
			reason:
				`the census reported ONE orphan but this parse found NONE among ${recordLineList.length} decision records. ` +
				'An empty result from a parse I invented is NOT a measurement that there is no orphan — it is a parse that did not find what it was looking for. ' +
				'Fix the reader before concluding anything about the census.',
			recordLinesSeen: recordLineList.length,
		});
		process.exitCode = 1;
	} else {
		const orphanStableIdList = orphanRecordList.map((oneRecord) => oneRecord.subjectStableId);

		// ---- 2. the GRAPH: does that subject have a vector at all, and what is its true best score?
		const driver = neo4j.driver(process.env.P2_BOLT_URL || 'bolt://localhost:7811', neo4j.auth.basic('neo4j', process.env.P2_BOLT_PASSWORD || ''), { encrypted: false });
		const session = driver.session();
		session
			.run('MATCH (n) WHERE n.stableId IN $idList RETURN n.stableId AS stableId, n.searchText AS searchText, n.embedding IS NOT NULL AS hasEmbedding, size(coalesce(n.embedding,[])) AS vectorLength', {
				idList: orphanStableIdList,
			})
			.then((result) => {
				const rowList = result.records.map((oneRecord) => ({
					stableId: oneRecord.get('stableId'),
					searchText: oneRecord.get('searchText'),
					hasEmbedding: oneRecord.get('hasEmbedding'),
					vectorLength: neo4j.isInt(oneRecord.get('vectorLength')) ? oneRecord.get('vectorLength').toNumber() : oneRecord.get('vectorLength'),
				}));
				session.close().then(() => driver.close()).then(() =>
					report({
						probe: moduleName,
						declaredFloor: DECLARED_FLOOR,
						orphanCountInBlock: orphanRecordList.length,
						orphanRecordSummary: orphanRecordList.map((oneRecord) => ({
							subjectStableId: oneRecord.subjectStableId,
							resolution: oneRecord.resolution,
							reason: oneRecord.reason,
							renderedPoolSize: Array.isArray(oneRecord.renderedPoolStableIdList) ? oneRecord.renderedPoolStableIdList.length : null,
						})),
						graphSideOfTheSameSubject: rowList,
						HOW_TO_READ_THIS:
							rowList.length === 0
								? 'THE GRAPH ROW WAS NOT FOUND — most likely the scratch graph is gone (the build disposed it). That is NOT evidence either way; re-run against a live graph before concluding.'
								: rowList.every((oneRow) => oneRow.hasEmbedding && oneRow.vectorLength > 0)
									? 'THE SUBJECT HAS A VECTOR. So the empty pool is a GENUINE SUB-FLOOR SCORE, not a missing-embedding artefact — a real consequence of the re-embed changing which subjects clear 0.30, and REPORT-P0 §4.2 is superseded BY ONE.'
									: 'THE SUBJECT HAS NO USABLE VECTOR. The empty pool is an ARTEFACT and a DEFECT, not a finding about the floor. Escalate as a defect.',
					}),
				);
				return null;
			})
			.catch((runError) => {
				session
					.close()
					.then(() => driver.close())
					.then(() =>
						report({
							probe: moduleName,
							orphanCountInBlock: orphanRecordList.length,
							orphanRecordSummary: orphanRecordList.map((oneRecord) => ({ subjectStableId: oneRecord.subjectStableId, resolution: oneRecord.resolution, reason: oneRecord.reason })),
							graphSideUNAVAILABLE: runError.message,
							HOW_TO_READ_THIS:
								'THE BLOCK HALF IS MEASURED; THE GRAPH HALF IS NOT. The scratch graph the census ran against was disposed with the build, so the sub-floor-versus-missing-vector question is NOT ANSWERED HERE and must not be reported as though it were.',
						}),
					)
					.catch(() => {});
			});
	}
}
