'use strict';

// p2_embeddingSpendPreflight.js — LUNAR_PRISM (P2), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// **MEASURE BEFORE YOU SPEND.** P2's census needs a graph WITH VECTORS, and the P1 block was built
// `--vectorize=false`, so the census build must run `--vectorize=true`. **EMBEDDING IS REAL MONEY AND
// P2 HAS NO EMBEDDING AUTHORISATION** — TQ authorised embedding for the PESC re-embed and nothing
// else. The reasoning that it "should" all be cached is exactly the kind this project distrusts:
// searchText is unchanged by the P1 seat stamp, so every text SHOULD hit the shared cache. SHOULD.
//
// THIS PROBE TURNS THAT INTO A MEASUREMENT AND COSTS NOTHING. The cache is keyed on plain
// sha256(text) ([code fact] lib/embedding/vectorCache.js:52 `textHashOf`), deliberately so that
// "anything embedded by the forge is a cache HIT for the bridge and vice versa". So the exact texts
// the build would submit can be hashed here and looked up, with no embedder involved at all.
//
// IT REPORTS; IT DOES NOT DECIDE. A non-zero miss count is a finding to escalate, not a licence to
// proceed — the whole point is that the supervisor rules on a number rather than on my confidence.
//
// Pure: runs the REAL forge in memory (skipEmbedding) and reads the cache sqlite READ-ONLY. No
// container, no store write, no embedder.

const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const moduleName = 'p2_embeddingSpendPreflight';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const CACHE_PATH = path.join(BUNDLE_DIR, '..', '..', '..', '..', 'dataStores', 'vectorCache', 'vectorCache.sqlite3');

const textHashOf = (text) => crypto.createHash('sha256').update(`${text}`, 'utf8').digest('hex');

const entryBundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

entryBundle.forge({ sourcePath: SNAPSHOT_DIR, owner: moduleName, skipEmbedding: true }, (forgeError, forged) => {
	if (forgeError) {
		process.stdout.write(`${JSON.stringify({ probe: moduleName, verdict: 'REFUSED', reason: `forge: ${forgeError}` }, null, 2)}\n`);
		process.exitCode = 1;
		return;
	}

	// EVERY node the forge emits carries a searchText — that is asserted by the shipped suite — and the
	// embed pass submits exactly those. Deduplicated, because the cache is content-addressed and the
	// embedder bills per DISTINCT text, not per node: collapsing them is what makes the figure a SPEND
	// figure rather than a node count.
	const textList = forged.nodes.map((oneNode) => oneNode.properties.searchText);
	const absentTextCount = textList.filter((oneText) => typeof oneText !== 'string' || oneText === '').length;
	const distinctTextList = [...new Set(textList.filter((oneText) => typeof oneText === 'string' && oneText !== ''))];
	const hashList = distinctTextList.map(textHashOf);

	// LOOK THEM UP IN ONE PASS. A temp table beats 42,372 round trips and, more importantly, lets the
	// answer be a single number nobody has to assemble by hand.
	const sqlText = [
		'CREATE TEMP TABLE preflightHash(textHash TEXT PRIMARY KEY);',
		'BEGIN;',
		hashList.map((oneHash) => `INSERT OR IGNORE INTO preflightHash VALUES('${oneHash}');`).join('\n'),
		'COMMIT;',
		"SELECT 'submitted', count(*) FROM preflightHash;",
		"SELECT 'cached', count(*) FROM preflightHash p JOIN vectorCacheEntries v ON v.textHash = p.textHash;",
		"SELECT 'cacheRowsTotal', count(*) FROM vectorCacheEntries;",
	].join('\n');

	// SQL ON STDIN, NOT AS AN ARGUMENT. The first version passed it as an argv element and spawnSync
	// failed outright — 42,372 INSERT statements is far past ARG_MAX. The probe REFUSED rather than
	// reporting a number, which is the behaviour that made the mechanism failure visible instead of
	// letting a truncated query answer a smaller question.
	const ran = spawnSync('sqlite3', [`file:${CACHE_PATH}?mode=ro`], { encoding: 'utf8', input: sqlText, maxBuffer: 256 * 1024 * 1024 });
	if (ran.status !== 0 || ran.error) {
		process.stdout.write(`${JSON.stringify({ probe: moduleName, verdict: 'REFUSED', reason: `sqlite3 exit ${ran.status}: ${ran.error ? ran.error.message : ran.stderr}` }, null, 2)}\n`);
		process.exitCode = 1;
		return;
	}
	const valueByName = {};
	String(ran.stdout || '')
		.trim()
		.split('\n')
		.forEach((oneLine) => {
			const [oneName, oneValue] = oneLine.split('|');
			valueByName[oneName] = Number(oneValue);
		});

	const submitted = valueByName.submitted;
	const cached = valueByName.cached;
	const wouldBill = submitted - cached;

	process.stdout.write(
		`${JSON.stringify(
			{
				probe: moduleName,
				measuredAgainst: { cachePath: CACHE_PATH, cacheRowsTotal: valueByName.cacheRowsTotal, forgeNodeCount: forged.nodes.length },
				nodesWithNoSearchText: absentTextCount,
				distinctTextsThatWouldBeSubmitted: submitted,
				alreadyInTheSharedCache: cached,
				WOULD_BILL: wouldBill,
				verdict:
					wouldBill === 0
						? 'ZERO BILLABLE TEXTS ON THE PESC SIDE. Every distinct text the census build would submit is already in the shared cache, so a --vectorize=true run costs nothing for this standard. MEASURED, not predicted.'
						: `${wouldBill} DISTINCT TEXTS WOULD BILL. This is a FINDING to escalate, not a licence to proceed — P2 carries no embedding authorisation.`,
				whatThisDoesNotCover:
					'The CEDS hub side. Its block is untouched by this order and its texts were embedded long ago, but this probe reads the PESC forge only and does not measure CEDS. Stated rather than implied.',
			},
			null,
			2,
		)}\n`,
	);
	process.exitCode = wouldBill === 0 ? 0 : 1;
});
