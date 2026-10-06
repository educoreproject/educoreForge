#!/usr/bin/env node
'use strict';

// test-judgment-cache.js — hermetic gate for lib/judgment-cache/judgment-cache.js
// (p9-judgmentPersistence, 2026-07-31).
//
// PROVES:
//   SECTION 1 — open refusals: no path, blank path, unprepared directory.
//   SECTION 2 — KEY-COMPLETENESS RED: a get/put missing ANY of the three key parts (promptHash,
//     model, rendererVersion) is refused BY NAME — the soundness invariant ("a hit is only valid
//     because identical rendered evidence + same model + same renderer version") is enforced at
//     the store's own front door, never left to caller discipline.
//   SECTION 3 — payload refusals: malformed judgment (missing choice/category/rationale/
//     chosenStableId) refused by name.
//   SECTION 4 — roundtrip: put then get returns the exact payload + generation; a get under a
//     DIFFERENT model or rendererVersion is a MISS (never served across the boundary); idempotent
//     re-put is a no-op and FIRST WRITE WINS (decided-time truth); each put REPORTS what it did,
//     { stored, alreadyPresent } (W-B-7, 2026-10-06).
//   SECTION 5 — DISK TRUTH: the row is visible to a FRESH connection on the same file immediately
//     after putJudgment's callback fires (the decided = persisted contract), and the database is
//     in WAL journal mode.
//
// Run: node lib/judgment-cache/test/test-judgment-cache.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for lib/judgment-cache (the decided = persisted checkpoint store)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the three-part key completeness refusals, payload refusals, roundtrip + cross-key miss
     behavior, first-write-wins idempotence, WAL mode, and the disk-truth contract (row visible to
     a fresh connection the moment put's callback fires). Runs against a throwaway temp database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const judgmentCacheModule = require('../judgment-cache')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfJudgmentCacheGate-'));
const databaseFilePath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);

const GOOD_KEY = {
	promptHash: 'a'.repeat(64),
	model: 'claude-opus-4-8',
	rendererVersion: 'evidenceRenderer-v2',
};
const GOOD_JUDGMENT = {
	choice: '3',
	chosenStableId: 'cedsHubRef:addr3',
	category: 'strong',
	rationale: "the candidate's tuple aligns on domain, range, and definition",
};

// =====================================================================
harness.section('SECTION 1 — open refusals');
// =====================================================================
judgmentCacheModule.open({}, (err) => {
	harness.match('opening with no path is REFUSED', err, /databaseFilePath is REQUIRED/);
});
judgmentCacheModule.open({ databaseFilePath: '' }, (err) => {
	harness.match('opening with a blank path is REFUSED', err, /databaseFilePath is REQUIRED/);
});
judgmentCacheModule.open({ databaseFilePath: '/no/such/directory/x.sqlite3' }, (err) => {
	harness.match('opening into an unprepared directory is REFUSED', err, /does not exist/);
});

// =====================================================================
// the async chain: open -> key refusals -> payload refusals -> roundtrip -> disk truth
// =====================================================================
judgmentCacheModule.open({ databaseFilePath }, (openErr, cache) => {
	harness.accepts('a real open succeeds', openErr ? [openErr] : []);
	if (openErr) {
		harness.report();
		return;
	}
	harness.equal('  and reports its own path', cache.databaseFilePath, databaseFilePath);

	// =====================================================================
	harness.section('SECTION 2 — KEY-COMPLETENESS RED: every missing key part refused by name');
	// =====================================================================
	['promptHash', 'model', 'rendererVersion'].forEach((oneMissingPart) => {
		const incompleteKey = { ...GOOD_KEY };
		delete incompleteKey[oneMissingPart];
		cache.getJudgment(incompleteKey, (err) => {
			harness.match(
				`RED: getJudgment missing ${oneMissingPart} is refused by name`,
				err,
				new RegExp(`${oneMissingPart} is required.*ALL THREE`, 's'),
			);
		});
		cache.putJudgment({ ...incompleteKey, judgment: GOOD_JUDGMENT }, (err) => {
			harness.match(
				`RED: putJudgment missing ${oneMissingPart} is refused by name`,
				err,
				new RegExp(`${oneMissingPart} is required.*ALL THREE`, 's'),
			);
		});
	});
	cache.getJudgment({ ...GOOD_KEY, rendererVersion: '   ' }, (err) => {
		harness.match('RED: a BLANK rendererVersion is as refused as an absent one', err, /rendererVersion is required/);
	});

	// =====================================================================
	harness.section('SECTION 3 — payload refusals');
	// =====================================================================
	cache.putJudgment({ ...GOOD_KEY }, (err) => {
		harness.match('RED: put with no judgment refused', err, /judgment is required and must be a plain object/);
	});
	cache.putJudgment({ ...GOOD_KEY, judgment: { ...GOOD_JUDGMENT, choice: '' } }, (err) => {
		harness.match('RED: a blank judgment.choice refused', err, /judgment\.choice is required/);
	});
	cache.putJudgment({ ...GOOD_KEY, judgment: { ...GOOD_JUDGMENT, category: undefined } }, (err) => {
		harness.match('RED: a missing judgment.category refused', err, /judgment\.category is required/);
	});
	cache.putJudgment({ ...GOOD_KEY, judgment: { ...GOOD_JUDGMENT, rationale: '  ' } }, (err) => {
		harness.match('RED: a blank judgment.rationale refused', err, /judgment\.rationale is required/);
	});
	(() => {
		const { chosenStableId, ...withoutChosen } = GOOD_JUDGMENT;
		void chosenStableId;
		cache.putJudgment({ ...GOOD_KEY, judgment: withoutChosen }, (err) => {
			harness.match('RED: a missing judgment.chosenStableId refused (null is the abstain form)', err, /chosenStableId is required/);
		});
	})();
	// W-B-3 (campaign P3): the judge's own numbers ride in the row; a summary of the wrong shape is refused by name
	cache.putJudgment({ ...GOOD_KEY, judgment: { ...GOOD_JUDGMENT, judgeSummary: { judgePickConfidence: 0.9 } } }, (err) => {
		harness.match('RED (W-B-3): a judgeSummary missing declared members is refused by name', err, /judgment\.judgeSummary carries \[judgePickConfidence\], not exactly JUDGE_SUMMARY_FIELD_LIST/);
	});
	cache.putJudgment({ ...GOOD_KEY, judgment: { ...GOOD_JUDGMENT, judgeSummary: { judgePickConfidence: 1.5, judgeTopProbability: 0.7, judgeRunnerUpMargin: 0.4, judgeProbabilityByChoice: { 1: 0.7, NONE: 0.3 }, judgeRelationConfidence: null, judgeRelationProbabilityByPredicate: null } } }, (err) => {
		harness.match('RED (W-B-3): a judgePickConfidence outside [0, 1] is refused by name', err, /judgePickConfidence 1\.5 .* must be numbers in \[0, 1\]/);
	});

	// =====================================================================
	harness.section('SECTION 4 — roundtrip, cross-key miss, first-write-wins idempotence');
	// =====================================================================
	cache.getJudgment(GOOD_KEY, (missErr, missResult) => {
		harness.accepts('a get before any put succeeds', missErr ? [missErr] : []);
		harness.equal('  and is a MISS ({ judgment: null }) — absence is an answer, not an error', missResult.judgment, null);

		cache.putJudgment({ ...GOOD_KEY, generation: 'testBridge-evidence-v1', judgment: GOOD_JUDGMENT }, (putErr, putReport) => {
			harness.accepts('the first put succeeds', putErr ? [putErr] : []);
			// W-B-7 (V1-C14): putJudgment REPORTS what it did — PUT_JUDGMENT_RESULT_NAME_LIST, read off the insert's own changes()
			harness.equal('  and REPORTS it stored the row: { stored: true, alreadyPresent: false }', JSON.stringify(putReport), JSON.stringify({ stored: true, alreadyPresent: false }));
			harness.equal('  and the report carries exactly the declared PUT_JUDGMENT_RESULT_NAME_LIST', JSON.stringify(Object.keys(putReport || {})), JSON.stringify(require('../judgment-cache').PUT_JUDGMENT_RESULT_NAME_LIST));

			cache.getJudgment(GOOD_KEY, (hitErr, hitResult) => {
				harness.accepts('the get after put succeeds', hitErr ? [hitErr] : []);
				harness.equal('  ROUNDTRIP: the stored payload comes back byte-equal', JSON.stringify(hitResult.judgment), JSON.stringify(GOOD_JUDGMENT));
				harness.equal('  and carries its generation metadata', hitResult.generation, 'testBridge-evidence-v1');
				harness.ok('  and a createdAt stamp', typeof hitResult.createdAt === 'string' && hitResult.createdAt.length > 0, hitResult.createdAt);

				cache.getJudgment({ ...GOOD_KEY, model: 'some-other-model' }, (e2, r2) => {
					harness.accepts('a get under a DIFFERENT model succeeds', e2 ? [e2] : []);
					harness.equal('  and is a MISS — a judgment is NEVER served across a model boundary', r2.judgment, null);
				});
				cache.getJudgment({ ...GOOD_KEY, rendererVersion: 'evidenceRenderer-v1' }, (e3, r3) => {
					harness.accepts('a get under a DIFFERENT rendererVersion succeeds', e3 ? [e3] : []);
					harness.equal('  and is a MISS — a judgment is NEVER served across a renderer boundary', r3.judgment, null);
				});

				// FIRST WRITE WINS: a second put under the same address with a DIFFERENT payload is a
				// no-op — the decided-time truth is what replays, never a later re-judgment.
				const contradictingJudgment = { ...GOOD_JUDGMENT, choice: 'NONE', chosenStableId: null, category: 'none', rationale: 'a later contradictory answer' };
				cache.putJudgment({ ...GOOD_KEY, judgment: contradictingJudgment }, (rePutErr, rePutReport) => {
					harness.accepts('an idempotent re-put succeeds (no error)', rePutErr ? [rePutErr] : []);
					harness.equal('  and REPORTS it stored nothing: { stored: false, alreadyPresent: true } (W-B-7; it used to claim stored: true)', JSON.stringify(rePutReport), JSON.stringify({ stored: false, alreadyPresent: true }));
					cache.getJudgment(GOOD_KEY, (e4, r4) => {
						harness.equal(
							'  FIRST WRITE WINS: the ORIGINAL decided-time payload is retained, the contradiction ignored',
							JSON.stringify(r4.judgment),
							JSON.stringify(GOOD_JUDGMENT),
						);

						// =====================================================================
						harness.section('SECTION 5 — DISK TRUTH: a FRESH connection sees the row immediately; WAL mode is on');
						// =====================================================================
						const freshKey = { ...GOOD_KEY, promptHash: 'b'.repeat(64) };
						cache.putJudgment({ ...freshKey, generation: 'testBridge-evidence-v1', judgment: GOOD_JUDGMENT }, (freshPutErr) => {
							harness.accepts('the disk-truth put succeeds', freshPutErr ? [freshPutErr] : []);
							// the put's callback has fired — the ruling says the row is now ON DISK. Prove it
							// through a COMPLETELY FRESH connection, not the one that wrote it.
							judgmentCacheModule.open({ databaseFilePath }, (freshOpenErr, freshCache) => {
								harness.accepts('a FRESH connection opens', freshOpenErr ? [freshOpenErr] : []);
								freshCache.getJudgment(freshKey, (freshGetErr, freshResult) => {
									harness.accepts('the fresh-connection get succeeds', freshGetErr ? [freshGetErr] : []);
									harness.equal(
										'DISK TRUTH: the row is visible to a fresh connection immediately after put\'s callback (decided = persisted)',
										JSON.stringify(freshResult.judgment),
										JSON.stringify(GOOD_JUDGMENT),
									);
									// WAL mode — read the journal mode off the raw file through better-sqlite3.
									const Database = require('better-sqlite3');
									const rawDb = new Database(databaseFilePath, { readonly: true });
									const journalMode = rawDb.pragma('journal_mode', { simple: true });
									rawDb.close();
									harness.equal('the database is in WAL journal mode', `${journalMode}`.toLowerCase(), 'wal');
									harness.report();
								});
							});
						});
					});
				});
			});
		});
	});
});
