#!/usr/bin/env node
'use strict';

// p2_measurementC.js — LUNAR_PRISM (P2), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// MEASUREMENT C, from REPORT-P0 §10: ARE THE MUTE SUBJECTS ALSO THE HARD ONES?
//
// A PESC declaration either carries prose or does not. The forge records which, per node, in the seat
// property `proseSource` — 'own' (documentation on the declaration itself), 'resolved' (borrowed across
// RESOLVES_TO), or 'none'. The C0/C2 split follows from it: a MUTE subject (proseSource 'none') gets
// `OwningType | ElementName`; a PROSE-BEARING subject gets `ElementName | effectiveDescription`.
//
// THE QUESTION IS WHETHER MUTENESS AND DIFFICULTY COINCIDE. If the subjects with no prose are ALSO the
// subjects the judge finds hardest, then those concepts are DOUBLY DISADVANTAGED — impoverished text
// AND an intrinsically harder match — and the deficit is concentrated rather than spread.
//
// ============================ THE STANDING BAR, AND IT BINDS THIS FILE ============================
// ⚠️ **C's RESULT MAY NOT BE RECRUITED FOR THE ENRICHMENT / COMPOSITION DECISION IN EITHER DIRECTION.**
// That bar is the supervisor's and it is not negotiable by whoever runs this. It exists because a
// measurement taken AFTER a decision, on a population the decision selected, cannot adjudicate the
// decision: the mute subjects are mute BECAUSE of the composition, so their difficulty is downstream of
// the thing it would be used to judge. THIS PROBE REPORTS AND DOES NOT RECOMMEND. It carries no verdict
// field for that reason, and a reader quoting it toward the composition question is misusing it.
//
// ============================ WHAT "HARD" MEANS HERE, STATED RATHER THAN ASSUMED ============================
// The frozen decision record carries NO cosine score — I dumped its keys rather than guessing at one, and
// a score field does not exist. So difficulty is measured by the three signals that DO exist:
//   • ABSTAINED — the judge was shown a pool and declined to assert. The most direct difficulty signal.
//   • RENDERED POOL SIZE — how many candidates survived the floor to be shown at all.
//   • ORPHAN — no pool at all (retrieval found nothing above the floor).
// Each is reported separately. THEY ARE NOT COMBINED INTO A SCORE, because a composite would invent a
// scale nobody has validated.
//
// Reads the frozen block from the decision store READ-ONLY and the live graph READ-ONLY. No write.
// Connection details go stale — pass P2_BOLT_URL / P2_BOLT_PASSWORD, or re-resolve with docker inspect.

const { spawnSync } = require('child_process');
const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');

const moduleName = 'p2_measurementC';
const DECISION_STORE = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/pescDerived/pescDerived.decisions.sqlite3';
// THE PROPERTY-TIER BLOCK THE CENSUS REPORTED, NAMED EXPLICITLY. The store holds THREE blocks and two of
// them share this pairKey, so selecting by pairKey alone would silently pick one of two. Selecting by
// HASH is the only unambiguous address.
const CENSUS_BLOCK_HASH = '6e5a6aa0539a563101ceb7d408f484851feefc62a71193edce6964dfee5ffabf';
const BOLT_URL = process.env.P2_BOLT_URL || 'bolt://localhost:7811';
const BOLT_PASSWORD = process.env.P2_BOLT_PASSWORD || '';

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const ran = spawnSync(
	'sqlite3',
	[`file:${DECISION_STORE}?mode=ro`, `SELECT frozenText FROM decisionBlocks WHERE decisionBlockHash = '${CENSUS_BLOCK_HASH}';`],
	{ encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
);

if (ran.status !== 0 || ran.error) {
	report({ probe: moduleName, verdict: 'REFUSED', reason: `sqlite3 exit ${ran.status}: ${ran.error ? ran.error.message : ran.stderr}` });
	process.exitCode = 1;
} else if (!String(ran.stdout || '').trim()) {
	report({
		probe: moduleName,
		verdict: 'REFUSED',
		reason: `no decision block with hash ${CENSUS_BLOCK_HASH}. The query SUCCEEDED and returned nothing, which is a REAL ABSENCE rather than a parse miss — but it is still not a measurement of anything, so nothing is reported.`,
	});
	process.exitCode = 1;
} else {
	const parsedBlock = JSON.parse(String(ran.stdout));
	const recordList = Array.isArray(parsedBlock.decisionRecordList) ? parsedBlock.decisionRecordList : [];

	if (recordList.length === 0) {
		report({ probe: moduleName, verdict: 'REFUSED — NOT A CLEAN NEGATIVE', reason: 'the block parsed but carries no decisionRecordList. Fix the reader before concluding.' });
		process.exitCode = 1;
	} else {
		const subjectStableIdList = recordList.map((oneRecord) => oneRecord.subjectStableId);

		const driver = neo4j.driver(BOLT_URL, neo4j.auth.basic('neo4j', BOLT_PASSWORD), { encrypted: false });
		const session = driver.session();

		// DUMP-FIRST DISCIPLINE: this query asks for proseSource BY NAME on nodes selected by stableId. If
		// the property were misspelled it would return null on every row, which is INDISTINGUISHABLE from
		// a genuine absence — so the report counts `absentProseSource` explicitly and refuses to interpret
		// a run where every row is null.
		session
			.run(
				'MATCH (n) WHERE n.stableId IN $idList RETURN n.stableId AS stableId, n.proseSource AS proseSource, n.searchText AS searchText',
				{ idList: subjectStableIdList },
			)
			.then((result) => {
				const proseSourceByStableId = {};
				result.records.forEach((oneRecord) => {
					proseSourceByStableId[oneRecord.get('stableId')] = oneRecord.get('proseSource');
				});

				const bucket = {
					proseBearing: { subjectCount: 0, abstainedCount: 0, orphanCount: 0, poolSizeTotal: 0, emptyPoolCount: 0 },
					mute: { subjectCount: 0, abstainedCount: 0, orphanCount: 0, poolSizeTotal: 0, emptyPoolCount: 0 },
				};
				let absentProseSource = 0;
				let notFoundInGraph = 0;
				const proseSourceValueTally = {};

				recordList.forEach((oneRecord) => {
					const proseSource = proseSourceByStableId[oneRecord.subjectStableId];
					if (!(oneRecord.subjectStableId in proseSourceByStableId)) {
						notFoundInGraph += 1;
						return;
					}
					proseSourceValueTally[`${proseSource}`] = (proseSourceValueTally[`${proseSource}`] || 0) + 1;
					if (proseSource === null || proseSource === undefined) {
						absentProseSource += 1;
						return;
					}
					const bucketName = proseSource === 'none' ? 'mute' : 'proseBearing';
					const poolSize = Array.isArray(oneRecord.renderedPoolStableIdList) ? oneRecord.renderedPoolStableIdList.length : 0;
					bucket[bucketName].subjectCount += 1;
					bucket[bucketName].poolSizeTotal += poolSize;
					if (oneRecord.abstained === true) {
						bucket[bucketName].abstainedCount += 1;
					}
					if (oneRecord.resolution === 'orphan' || oneRecord.judgedReason === 'noCandidate') {
						bucket[bucketName].orphanCount += 1;
					}
					if (poolSize === 0) {
						bucket[bucketName].emptyPoolCount += 1;
					}
				});

				const rateOf = (numerator, denominator) => (denominator === 0 ? null : Number((numerator / denominator).toFixed(4)));
				const summaryFor = (bucketName) => ({
					subjectCount: bucket[bucketName].subjectCount,
					abstainedCount: bucket[bucketName].abstainedCount,
					abstentionRate: rateOf(bucket[bucketName].abstainedCount, bucket[bucketName].subjectCount),
					orphanCount: bucket[bucketName].orphanCount,
					emptyPoolCount: bucket[bucketName].emptyPoolCount,
					meanRenderedPoolSize: bucket[bucketName].subjectCount === 0 ? null : Number((bucket[bucketName].poolSizeTotal / bucket[bucketName].subjectCount).toFixed(3)),
				});

				const measurable = bucket.proseBearing.subjectCount > 0 && bucket.mute.subjectCount > 0;

				session
					.close()
					.then(() => driver.close())
					.then(() =>
						report({
							probe: moduleName,
							question: 'MEASUREMENT C — are the MUTE subjects (proseSource none) also the HARD ones?',
							measuredAgainst: { boltUrl: BOLT_URL, decisionBlockHash: CENSUS_BLOCK_HASH, decisionRecordCount: recordList.length },
							instrumentHealth: {
								subjectsNotFoundInGraph: notFoundInGraph,
								subjectsWithNullProseSource: absentProseSource,
								proseSourceValuesSeen: proseSourceValueTally,
								howToReadThis:
									absentProseSource === recordList.length
										? 'EVERY row returned a null proseSource. That is what a MISSPELLED PROPERTY NAME looks like and it is indistinguishable from a genuine absence. DO NOT INTERPRET THE BUCKETS BELOW — fix the reader first.'
										: 'proseSource resolved on the rows counted below; the value tally above is the evidence that the property name is live rather than silently null.',
							},
							PROSE_BEARING: summaryFor('proseBearing'),
							MUTE: summaryFor('mute'),
							HOW_TO_READ_THIS: !measurable
								? 'ONE OF THE TWO BUCKETS IS EMPTY, so no comparison exists. This is not a finding that the populations are alike; it is an absence of data.'
								: 'Compare abstentionRate between the two buckets. A HIGHER rate among MUTE subjects supports the doubly-disadvantaged reading; an equal or lower rate does not. meanRenderedPoolSize is reported beside it because a difference in how many candidates were shown is an alternative explanation for a difference in abstention, and conflating the two would be the easy mistake.',
							THE_STANDING_BAR:
								"C's result MAY NOT be recruited for the enrichment/composition decision in either direction. The mute subjects are mute BECAUSE of the composition, so their difficulty is downstream of the very thing it would be used to judge. This probe reports; it carries no verdict field and recommends nothing.",
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
							verdict: 'REFUSED — GRAPH SIDE UNAVAILABLE',
							reason: runError.message,
							note: 'The block half is readable but the graph half is not, so Measurement C is NOT ANSWERED and must not be reported as though it were. The materialize graph may have been disposed; re-run against a live one.',
						}),
					)
					.catch(() => {});
			});
	}
}
