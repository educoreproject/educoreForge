#!/usr/bin/env node
'use strict';

// p2_f1GraphVectorsVersusCache.js — LUNAR_PRISM (P2), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// **F1 — THE LOAD-BEARING ASSUMPTION UNDER EVERY NUMBER IN REPORT-P0b §6a, AND UNTIL NOW UNOBSERVED.**
// P0b listed it first among the things it would do with another hour and could not: "read vectors out of
// a materialized graph, diff against the cache for the same text hashes."
//
// THE ASSUMPTION, STATED PLAINLY: that the vector sitting on a node IN THE GRAPH is the same vector the
// CACHE holds for that node's searchText. Every cosine figure P0/P0b computed was computed FROM THE
// CACHE. If the graph's vectors differ from the cache's, then those figures describe a population that
// the retrieval seam never actually sees, and the entire measurement chain is about the wrong object.
// NOBODY HAD CHECKED. It was assumed because the same embedder wrote both, which is a reason to expect
// it and not a reason to believe it.
//
// HOW THE TWO SIDES ARE ADDRESSED. The cache is keyed on plain sha256(text) ([code fact]
// lib/embedding/vectorCache.js `textHashOf`), deliberately so the forge and the bridge share entries. So
// a node's searchText hashes directly to its cache row; no id mapping is involved and nothing has to be
// trusted to line up.
//
// THE COMPARISON IS ELEMENTWISE, NOT A CHECKSUM OF A CHECKSUM. Base64 -> float32 little-endian (the
// encoding the block header declares) -> compare each of 1024 components against the graph's value.
// A vector equal in norm or in first-element is not equal; only every component is.
//
// ⚠️ THE SAMPLE IS BOUNDED AND THE BOUND IS DECLARED, NEVER SILENT. Reading 42,372 × 1024 floats from
// both sides at once is a large allocation for a question a deterministic sample answers. The selection
// rule is ORDER BY stableId (a stable, content-independent ordering — NOT random, so the run is
// reproducible) and the size is stated in the output beside the result. A sample that is not declared
// reads as a census, which is the failure this note exists to prevent.
//
// Reads the live graph READ-ONLY and the cache sqlite READ-ONLY. No write of any kind.
// Connection details go stale — pass P2_BOLT_URL / P2_BOLT_PASSWORD, or re-resolve with docker inspect.

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const neo4j = require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver');

const moduleName = 'p2_f1GraphVectorsVersusCache';
const CACHE_PATH = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3';
const BOLT_URL = process.env.P2_BOLT_URL || 'bolt://localhost:7811';
const BOLT_PASSWORD = process.env.P2_BOLT_PASSWORD || '';
const SAMPLE_SIZE = Number(process.env.P2_SAMPLE_SIZE || 1500);
// WRITTEN AS AN ESCAPE, DELIBERATELY. A literal control byte in source is invisible to a reader, does
// not survive copy-paste, and has already broken one shell invocation in this order. \u0001 cannot
// occur in base64 or in sha256 hex, so it is a safe field separator.
// CORRECTED - AND THIS IS THE THIRD TIME A FIELD SEPARATOR HAS GONE WRONG IN THIS ORDER. It was an
// EMPTY STRING once (split shatters every line into single characters), a LITERAL CONTROL BYTE once
// (broke a shell invocation), and then that byte as a JS escape - safe in JavaScript and STILL WRONG,
// because THE SEPARATOR DOES NOT SURVIVE THE sqlite3 CLI. MEASURED: a two-row query returned 11,074
// bytes of correct data and every line split into exactly ONE field, so no hash ever matched and all
// 1,500 sampled nodes were counted absent-from-cache.
//
// THE PROBE CALLED THAT A FAILURE TO MEASURE RATHER THAN AGREEMENT, which is the only reason the
// defect was visible: the verdict requires comparedCount > 0, so ZERO comparisons could not
// masquerade as zero differences. Without that one conjunct this file would have printed every-vector-
// identical on the strength of nothing at all.
//
// THE FIX IS TO STOP INVENTING A SEPARATOR. sqlite3 emits multiple columns with its OWN delimiter,
// and neither base64 (A-Za-z0-9+/=) nor sha256 hex (0-9a-f) nor the model version can contain a pipe.
const UNIT_SEPARATOR = '|';

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const textHashOf = (text) => crypto.createHash('sha256').update(`${text}`, 'utf8').digest('hex');

const vectorFromBase64 = (base64Text) => {
	const rawBuffer = Buffer.from(base64Text, 'base64');
	const componentCount = rawBuffer.length / 4;
	const valueList = new Array(componentCount);
	let componentIndex = 0;
	while (componentIndex < componentCount) {
		valueList[componentIndex] = rawBuffer.readFloatLE(componentIndex * 4);
		componentIndex += 1;
	}
	return valueList;
};

const driver = neo4j.driver(BOLT_URL, neo4j.auth.basic('neo4j', BOLT_PASSWORD), { encrypted: false });
const session = driver.session();

session
	.run(
		'MATCH (n) WHERE n.embedding IS NOT NULL AND n.searchText IS NOT NULL ' +
			'RETURN n.stableId AS stableId, n.searchText AS searchText, n.embedding AS embedding ' +
			'ORDER BY n.stableId LIMIT $sampleSize',
		{ sampleSize: neo4j.int(SAMPLE_SIZE) },
	)
	.then((result) => {
		const graphRowList = result.records.map((oneRecord) => ({
			stableId: oneRecord.get('stableId'),
			searchText: oneRecord.get('searchText'),
			embedding: oneRecord.get('embedding'),
		}));

		return session
			.close()
			.then(() => driver.close())
			.then(() => graphRowList);
	})
	.then((graphRowList) => {
		if (graphRowList.length === 0) {
			report({
				probe: moduleName,
				verdict: 'REFUSED — NOT A CLEAN NEGATIVE',
				reason:
					'the graph returned ZERO nodes carrying both an embedding and a searchText. That is not a finding that the vectors agree; it is a query that found nothing to compare. Check that the container is a VECTORIZED materialize graph before concluding anything.',
			});
			process.exitCode = 1;
			return null;
		}

		// ONE sqlite round trip, via a temp table — 1,500 individual lookups would work and would also
		// make the runtime the interesting part of the measurement rather than the answer.
		const hashByStableId = {};
		const sqlLineList = ['CREATE TEMP TABLE wanted(textHash TEXT PRIMARY KEY);', 'BEGIN;'];
		graphRowList.forEach((oneRow) => {
			const oneHash = textHashOf(oneRow.searchText);
			hashByStableId[oneRow.stableId] = oneHash;
			sqlLineList.push(`INSERT OR IGNORE INTO wanted VALUES('${oneHash}');`);
		});
		sqlLineList.push('COMMIT;');
		sqlLineList.push(
			'SELECT v.textHash, v.vectorBase64, v.embeddingDims, v.embeddingModelVersion FROM vectorCacheEntries v JOIN wanted w ON w.textHash = v.textHash;',
		);

		const ran = spawnSync('sqlite3', [CACHE_PATH], { encoding: 'utf8', input: sqlLineList.join('\n'), maxBuffer: 1024 * 1024 * 1024 });
		if (ran.status !== 0 || ran.error) {
			report({ probe: moduleName, verdict: 'REFUSED', reason: `sqlite3 exit ${ran.status}: ${ran.error ? ran.error.message : ran.stderr}` });
			process.exitCode = 1;
			return null;
		}

		const cacheRowByHash = {};
		String(ran.stdout || '')
			.split('\n')
			.forEach((oneLine) => {
				if (!oneLine.trim()) {
					return;
				}
				const [oneHash, oneBase64, oneDims, oneModel] = oneLine.split(UNIT_SEPARATOR);
				cacheRowByHash[oneHash] = { vectorBase64: oneBase64, embeddingDims: Number(oneDims), embeddingModelVersion: oneModel };
			});

		let comparedCount = 0;
		let identicalCount = 0;
		let absentFromCacheCount = 0;
		let dimensionMismatchCount = 0;
		let maxAbsoluteDelta = 0;
		const mismatchExampleList = [];

		graphRowList.forEach((oneRow) => {
			const cacheRow = cacheRowByHash[hashByStableId[oneRow.stableId]];
			if (cacheRow === undefined) {
				absentFromCacheCount += 1;
				return;
			}
			const cacheVector = vectorFromBase64(cacheRow.vectorBase64);
			const graphVector = oneRow.embedding;
			if (cacheVector.length !== graphVector.length) {
				dimensionMismatchCount += 1;
				if (mismatchExampleList.length < 3) {
					mismatchExampleList.push({ stableId: oneRow.stableId, reason: `dimension ${graphVector.length} in graph vs ${cacheVector.length} in cache` });
				}
				return;
			}
			comparedCount += 1;
			let worstDelta = 0;
			let componentIndex = 0;
			while (componentIndex < cacheVector.length) {
				const oneDelta = Math.abs(Number(graphVector[componentIndex]) - cacheVector[componentIndex]);
				if (oneDelta > worstDelta) {
					worstDelta = oneDelta;
				}
				componentIndex += 1;
			}
			if (worstDelta > maxAbsoluteDelta) {
				maxAbsoluteDelta = worstDelta;
			}
			if (worstDelta === 0) {
				identicalCount += 1;
			} else if (mismatchExampleList.length < 3) {
				mismatchExampleList.push({ stableId: oneRow.stableId, worstComponentDelta: worstDelta, searchTextHead: `${oneRow.searchText}`.slice(0, 90) });
			}
		});

		const allIdentical = comparedCount > 0 && identicalCount === comparedCount && dimensionMismatchCount === 0;

		report({
			probe: moduleName,
			question:
				'F1 — is the vector ON A NODE IN THE GRAPH bit-identical to the vector THE CACHE holds for that node\'s searchText? Every cosine figure in REPORT-P0/P0b was computed from the CACHE; this asks whether those figures describe the graph the retrieval seam actually reads.',
			measuredAgainst: { boltUrl: BOLT_URL, cachePath: CACHE_PATH },
			sample: {
				requestedSize: SAMPLE_SIZE,
				graphRowsReturned: graphRowList.length,
				selectionRule: 'ORDER BY n.stableId LIMIT <size> — deterministic and reproducible, NOT random. THIS IS A SAMPLE AND NOT A CENSUS, and the bound is declared here rather than left to be inferred.',
			},
			comparedCount,
			identicalCount,
			absentFromCacheCount,
			dimensionMismatchCount,
			maxAbsoluteComponentDelta: maxAbsoluteDelta,
			mismatchExampleList,
			VERDICT: allIdentical
				? 'EVERY COMPARED VECTOR IS COMPONENTWISE IDENTICAL (max absolute delta 0 across all 1024 components of every sampled node). The graph carries exactly the cache\'s vectors, so the cosine figures computed from the cache DO describe the graph the retrieval seam reads. P0b\'s load-bearing assumption is now OBSERVED rather than assumed — for this sample, by this rule.'
				: comparedCount === 0
					? 'NOTHING WAS COMPARED — every sampled node was absent from the cache or dimension-mismatched. This is NOT a finding about agreement; it is a failure to measure. Investigate before concluding.'
					: `DISAGREEMENT FOUND: ${comparedCount - identicalCount} of ${comparedCount} compared vectors differ (max absolute component delta ${maxAbsoluteDelta}), plus ${dimensionMismatchCount} dimension mismatches. THIS IS A FINDING OF THE FIRST ORDER — it would mean the published cosine figures describe a different population than the graph. Escalate; do not work around it.`,
			whatThisDoesNotCover:
				'Nodes outside the sample, and any node carrying an embedding but no searchText (excluded by the query because such a node has no cache address). Stated rather than implied.',
		});
		process.exitCode = allIdentical ? 0 : 1;
		return null;
	})
	.catch((runError) => {
		report({ probe: moduleName, verdict: 'REFUSED', reason: runError.message });
		process.exitCode = 1;
	});
