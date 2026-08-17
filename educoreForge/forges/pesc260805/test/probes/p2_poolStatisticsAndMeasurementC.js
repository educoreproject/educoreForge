#!/usr/bin/env node
'use strict';

// p2_poolStatisticsAndMeasurementC.js — LUNAR_PRISM (P2), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// SUPERSEDES p2_measurementC.js, WHICH IS LEFT UNEDITED AS THE RECORD OF A WEAKER MEASUREMENT AND OF A
// FALSE STATEMENT I PUT IN ITS HEADER.
//
// ============================ THE CORRECTION, FIRST, BECAUSE IT IS THE POINT ============================
// p2_measurementC.js's header says, in terms: "The frozen decision record carries NO cosine score — I
// dumped its keys rather than guessing at one, and a score field does not exist."
// **THAT IS FALSE.** Every record carries `retrievalSeatList`, an array of 15 seats, and EACH SEAT
// CARRIES `cosine` ALONGSIDE `rank` AND `stableId`. I dumped the record's TOP-LEVEL keys, saw no score
// among them, and reported a conclusion about the WHOLE RECORD. The score was one nesting level down.
//
// THIS IS THE THIRD APPEARANCE OF ONE GENUS IN THIS ORDER, and the repetition is the finding:
//   • p2_blockContentDiffVectorised.js compared only `parsed.properties` and returned a confident (A);
//     `embeddingRef` lives at ROW level and it could not see it. Caught by a byte count.
//   • F1 (p2_f1GraphVectorsVersusCache.js) parsed sqlite3 output on a separator that does not survive
//     the CLI, and every line collapsed to one field. Caught by a `comparedCount > 0` conjunct.
//   • THIS: top-level keys dumped, an array's interior never opened, "a score field does not exist"
//     written into a retained probe's header. Caught by opening the array for a different purpose.
// EACH TIME THE INSTRUMENT ANSWERED A NARROWER QUESTION THAN THE ONE ASKED, CONFIDENTLY. Dumping keys
// is not the discipline; dumping keys AT EVERY LEVEL THE ANSWER COULD LIVE AT is the discipline.
//
// ============================ WHAT ELSE CHANGES ============================
// (1) DIFFICULTY IS NOW MEASURED BY TOP-1 COSINE as well as by abstention. Abstention is the judge's
//     behaviour; cosine is the retrieval's. They are different questions and both are reported.
// (2) IT READS THE STANDARDS STORE INSTEAD OF A LIVE GRAPH. `proseSource` is a forge-stamped node
//     property and it sits in the block text, so no container is needed and the measurement is
//     reproducible after every scratch graph is disposed. p2_measurementC required a live graph and was
//     therefore only runnable in a window.
// (3) POOL STATISTICS FOR BOTH POPULATIONS, REPORTED SEPARATELY AND NEVER POOLED — the standing rule.
//     The two are embedded on differently-shaped strings and a combined figure has no referent.
//
// Reads two sqlite stores READ-ONLY. No graph, no container, no embedder, no write.
// Run with a large heap: node --max-old-space-size=8000 <thisFile>

const { spawnSync } = require('child_process');

const moduleName = 'p2_poolStatisticsAndMeasurementC';
const STORE_DIR = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/pescDerived';
const STANDARDS_STORE = `${STORE_DIR}/pescDerived.standardsDatabase.sqlite3`;
const DECISION_STORE = `${STORE_DIR}/pescDerived.decisions.sqlite3`;
const BASE_BLOCK_SUBJECT = 'pesc260805@aggregate_01_base';

// SELECT BY HASH, NEVER BY pairKey AND NEVER BY `LIMIT 1`. The store holds THREE blocks and TWO share
// the property-tier pairKey, differing only in declarationDigest. A probe whose answer can change with
// row order is not an instrument.
const POPULATION_REGISTRY = {
	propertyTier: {
		decisionBlockHash: '6e5a6aa0539a563101ceb7d408f484851feefc62a71193edce6964dfee5ffabf',
		subjectLabel: 'PescElementDecl',
		searchTextShape: "the ruled HYBRID composition (C2 'ElementName | effectiveDescription', C0 where there is no prose)",
	},
	optionSetTier: {
		decisionBlockHash: 'c8dbb1f9acd39fbb8d23d67ebe41dad20b189cd645e98917a529469eb692065d',
		subjectLabel: 'PescNamedDefinition',
		searchTextShape: "'Artifact vN | TypeName' — which REPORT-P0 4.1 called pure noise and the composition test measured as the losing arm",
	},
};

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const readOneColumn = (storePath, sqlText, maxBytes) => {
	const ran = spawnSync('sqlite3', [storePath], { encoding: 'utf8', input: sqlText, maxBuffer: maxBytes });
	if (ran.status !== 0 || ran.error) {
		return { error: `sqlite3 on ${storePath} exit ${ran.status}: ${ran.error ? ran.error.message : ran.stderr}` };
	}
	return { text: String(ran.stdout || '') };
};

// ---- proseSource per stableId, read out of the BLOCK TEXT rather than a graph.
const proseSourceRead = readOneColumn(STANDARDS_STORE, `SELECT text FROM blocks WHERE subject = '${BASE_BLOCK_SUBJECT}';`, 1024 * 1024 * 1024);
if (proseSourceRead.error) {
	report({ probe: moduleName, verdict: 'REFUSED', reason: proseSourceRead.error });
	process.exitCode = 1;
} else {
	const proseSourceByStableId = {};
	let rowsParsed = 0;
	proseSourceRead.text.split('\n').forEach((oneLine) => {
		if (oneLine.indexOf('"stableId"') === -1) {
			return;
		}
		let parsed = null;
		try {
			parsed = JSON.parse(oneLine);
		} catch (parseError) {
			return;
		}
		// ⚠️ THE FOURTH INSTANCE OF ONE GENUS IN THIS ORDER, and I walked into it while writing the probe
		// whose header documents the other three. `stableId` is a ROW-LEVEL key; it is NOT inside
		// `properties` (DUMPED: row keys are kind, ref, labels, stableId, properties, embeddingRef,
		// embeddingModelVersion). My first reader looked only inside `properties`, found nothing on all
		// 42,372 rows, and the probe REFUSED — which is the only reason this cost a re-run rather than a
		// wrong finding. READ BOTH LEVELS EXPLICITLY rather than assuming which one holds the key.
		const properties = (parsed && parsed.properties) || {};
		const stableId = typeof parsed.stableId === 'string' ? parsed.stableId : properties.stableId;
		if (typeof stableId !== 'string') {
			return;
		}
		rowsParsed += 1;
		// ⚠️ AND THE FIFTH. In the BLOCK, proseSource is stored as a ONE-ELEMENT ARRAY — ["none"] — because
		// the shaping wraps scalars for loading; over BOLT the same property arrives as the scalar "none".
		// So `proseSource === 'none'` is FALSE for every block row, and the first version of this probe put
		// all 2,213 property-tier subjects in the prose-bearing bucket and reported ZERO mute.
		// IT WAS CAUGHT ONLY BECAUSE IT CONTRADICTED THE EARLIER GRAPH-BASED RUN (1,669 / 544). Two of my
		// own measurements disagreeing is the third time in this order that has been the thing that saved a
		// finding — and the ONLY reason a disagreement was available is that the same question had already
		// been answered by a different route. A single instrument, however careful, would have shipped it.
		const rawProseSource = properties.proseSource;
		proseSourceByStableId[stableId] = Array.isArray(rawProseSource) ? rawProseSource[0] : rawProseSource;
	});

	if (rowsParsed === 0) {
		report({
			probe: moduleName,
			verdict: 'REFUSED — NOT A CLEAN NEGATIVE',
			reason: 'parsed ZERO node rows out of the base block. That is a reader that found nothing, not a measurement that nothing is there. Fix the reader before concluding.',
		});
		process.exitCode = 1;
	} else {
		const resultByPopulation = {};
		let refusal = '';

		Object.keys(POPULATION_REGISTRY).forEach((onePopulationName) => {
			if (refusal) {
				return;
			}
			const populationRow = POPULATION_REGISTRY[onePopulationName];
			const blockRead = readOneColumn(
				DECISION_STORE,
				`SELECT frozenText FROM decisionBlocks WHERE decisionBlockHash = '${populationRow.decisionBlockHash}';`,
				512 * 1024 * 1024,
			);
			if (blockRead.error) {
				refusal = blockRead.error;
				return;
			}
			if (!blockRead.text.trim()) {
				refusal = `no decision block with hash ${populationRow.decisionBlockHash} — the query SUCCEEDED and returned nothing, which is a real absence but not a measurement.`;
				return;
			}
			const recordList = JSON.parse(blockRead.text).decisionRecordList || [];

			const topCosineList = [];
			const poolSizeList = [];
			let abstainedCount = 0;
			let orphanCount = 0;
			let seatlessCount = 0;
			const bucket = {
				proseBearing: { subjectCount: 0, abstainedCount: 0, topCosineTotal: 0, topCosineCount: 0 },
				mute: { subjectCount: 0, abstainedCount: 0, topCosineTotal: 0, topCosineCount: 0 },
				proseSourceUnknown: { subjectCount: 0 },
			};

			recordList.forEach((oneRecord) => {
				const seatList = Array.isArray(oneRecord.retrievalSeatList) ? oneRecord.retrievalSeatList : [];
				const poolSize = Array.isArray(oneRecord.renderedPoolStableIdList) ? oneRecord.renderedPoolStableIdList.length : 0;
				poolSizeList.push(poolSize);
				if (oneRecord.abstained === true) {
					abstainedCount += 1;
				}
				if (oneRecord.judgedReason === 'noCandidate' || oneRecord.resolution === 'orphan') {
					orphanCount += 1;
				}
				// THE TOP-1 COSINE IS TAKEN AS THE MAXIMUM OVER THE SEATS, not as seat[0]. Rank ordering is
				// stated by the data and I am not going to depend on it silently.
				let topCosine = null;
				seatList.forEach((oneSeat) => {
					if (typeof oneSeat.cosine === 'number' && (topCosine === null || oneSeat.cosine > topCosine)) {
						topCosine = oneSeat.cosine;
					}
				});
				if (topCosine === null) {
					seatlessCount += 1;
				} else {
					topCosineList.push(topCosine);
				}

				const proseSource = proseSourceByStableId[oneRecord.subjectStableId];
				const bucketName = proseSource === undefined ? 'proseSourceUnknown' : proseSource === 'none' ? 'mute' : 'proseBearing';
				bucket[bucketName].subjectCount += 1;
				if (bucketName !== 'proseSourceUnknown') {
					if (oneRecord.abstained === true) {
						bucket[bucketName].abstainedCount += 1;
					}
					if (topCosine !== null) {
						bucket[bucketName].topCosineTotal += topCosine;
						bucket[bucketName].topCosineCount += 1;
					}
				}
			});

			const sortedCosineList = topCosineList.slice().sort((valueA, valueB) => valueA - valueB);
			const quantileOf = (fraction) =>
				sortedCosineList.length === 0 ? null : Number(sortedCosineList[Math.min(sortedCosineList.length - 1, Math.floor(fraction * sortedCosineList.length))].toFixed(4));
			const meanOf = (total, count) => (count === 0 ? null : Number((total / count).toFixed(4)));
			const rateOf = (numerator, denominator) => (denominator === 0 ? null : Number((numerator / denominator).toFixed(4)));

			resultByPopulation[onePopulationName] = {
				subjectLabel: populationRow.subjectLabel,
				decisionBlockHash: populationRow.decisionBlockHash,
				searchTextShape: populationRow.searchTextShape,
				subjectCount: recordList.length,
				POOL_STATISTICS: {
					meanRenderedPoolSize: poolSizeList.length === 0 ? null : Number((poolSizeList.reduce((a, b) => a + b, 0) / poolSizeList.length).toFixed(3)),
					minRenderedPoolSize: poolSizeList.length === 0 ? null : Math.min(...poolSizeList),
					maxRenderedPoolSize: poolSizeList.length === 0 ? null : Math.max(...poolSizeList),
					emptyPoolCount: poolSizeList.filter((oneSize) => oneSize === 0).length,
					orphanCount,
					subjectsWithNoSeatScores: seatlessCount,
				},
				TOP1_COSINE: {
					measuredOn: topCosineList.length,
					mean: meanOf(topCosineList.reduce((a, b) => a + b, 0), topCosineList.length),
					p10: quantileOf(0.1),
					median: quantileOf(0.5),
					p90: quantileOf(0.9),
					min: sortedCosineList.length === 0 ? null : Number(sortedCosineList[0].toFixed(4)),
					max: sortedCosineList.length === 0 ? null : Number(sortedCosineList[sortedCosineList.length - 1].toFixed(4)),
				},
				abstainedCount,
				abstentionRate: rateOf(abstainedCount, recordList.length),
				MEASUREMENT_C: {
					proseBearing: {
						subjectCount: bucket.proseBearing.subjectCount,
						abstentionRate: rateOf(bucket.proseBearing.abstainedCount, bucket.proseBearing.subjectCount),
						meanTop1Cosine: meanOf(bucket.proseBearing.topCosineTotal, bucket.proseBearing.topCosineCount),
					},
					mute: {
						subjectCount: bucket.mute.subjectCount,
						abstentionRate: rateOf(bucket.mute.abstainedCount, bucket.mute.subjectCount),
						meanTop1Cosine: meanOf(bucket.mute.topCosineTotal, bucket.mute.topCosineCount),
					},
					subjectsWithNoProseSourceInTheBlock: bucket.proseSourceUnknown.subjectCount,
				},
			};
		});

		// ---- THE REPRODUCTION CHECK. This probe reads the STORE; p2_measurementC read the LIVE GRAPH by a
		// different route and got 1,669 prose-bearing / 544 mute on the property tier. A new instrument that
		// cannot reproduce a value a different instrument already measured has no business reporting a new
		// one — the same rule the manifest composition tool is held to. This exists because the FIRST
		// version of this reader silently disagreed (2,213 / 0) and only the earlier answer caught it.
		const KNOWN_PROPERTY_TIER_PROSE_BEARING = 1669;
		const KNOWN_PROPERTY_TIER_MUTE = 544;
		const measuredC = resultByPopulation.propertyTier && resultByPopulation.propertyTier.MEASUREMENT_C;
		const reproductionCheck = !measuredC
			? { pass: false, reason: 'the property tier produced no MEASUREMENT_C block at all' }
			: measuredC.proseBearing.subjectCount === KNOWN_PROPERTY_TIER_PROSE_BEARING && measuredC.mute.subjectCount === KNOWN_PROPERTY_TIER_MUTE
				? { pass: true, reason: `reproduces the graph-measured split exactly: ${KNOWN_PROPERTY_TIER_PROSE_BEARING} prose-bearing / ${KNOWN_PROPERTY_TIER_MUTE} mute` }
				: {
						pass: false,
						reason: `DISAGREES WITH THE GRAPH-MEASURED SPLIT. Expected ${KNOWN_PROPERTY_TIER_PROSE_BEARING} prose-bearing / ${KNOWN_PROPERTY_TIER_MUTE} mute; got ${measuredC.proseBearing.subjectCount} / ${measuredC.mute.subjectCount}. TWO ROUTES TO ONE ANSWER DISAGREE — do not report either until the reader is fixed.`,
					};

		if (refusal || !reproductionCheck.pass) {
			report({ probe: moduleName, verdict: 'REFUSED', reason: refusal || reproductionCheck.reason, reproductionCheck });
			process.exitCode = 1;
		} else {
			report({
				probe: moduleName,
				measuredAgainst: { standardsStore: STANDARDS_STORE, decisionStore: DECISION_STORE, baseBlockNodeRowsParsed: rowsParsed },
				THE_TWO_POPULATIONS_ARE_REPORTED_SEPARATELY_AND_ARE_NEVER_POOLED:
					'They are embedded on DIFFERENTLY-SHAPED STRINGS, so no combined mean, median or rate across them has a referent. This is a standing rule of this order and it has bitten it in three different forms. The two blocks also came from TWO SEPARATE RUNS since RULING P2-R5, so any figure quoted across them must name its run.',
				reproductionCheck,
				...resultByPopulation,
				HOW_TO_READ_MEASUREMENT_C:
					'Compare abstentionRate AND meanTop1Cosine between proseBearing and mute WITHIN one population. Abstention is the JUDGE\'s behaviour; cosine is RETRIEVAL\'s. A lower abstention rate on mute subjects is NOT automatically good news — it can equally mean the judge asserted on thinner evidence, which is a risk signal rather than a health signal. The two numbers are reported side by side for that reason and are not combined into a score.',
				THE_STANDING_BAR:
					"MEASUREMENT C's RESULT MAY NOT BE RECRUITED FOR THE ENRICHMENT/COMPOSITION DECISION IN EITHER DIRECTION. The mute subjects are mute BECAUSE of the composition, so their difficulty is downstream of the very thing it would be used to judge. This probe reports and carries no verdict field.",
			});
		}
	}
}
