#!/usr/bin/env node
'use strict';

// test-vectorCache.js — gates for the shared, content-addressed embedding cache (vectorCache).
//
// Everything runs against a throwaway database under the OS temp directory. runAllTests opens NO project
// database and never reaches Voyage/Docker — a temp sqlite and the required-path rule keep it hermetic,
// exactly as test-decision-store does. The stored "vectors" here are arbitrary base64 strings: the cache
// holds and returns them verbatim (it never decodes), so no real embeddings are needed to prove storage.
//
// What is proven:
//   * the database path is REQUIRED with no default, proven REFUSING;
//   * a vector ROUND-TRIPS: put an entry, get it back by (model, dims, textHash);
//   * a MISS is an ANSWER — an unknown hash is simply absent from byHash, not an error;
//   * PUT is IDEMPOTENT: re-storing the same address is a no-op success (INSERT OR IGNORE), read unchanged;
//   * THE MODEL IS IN THE ADDRESS — the SAME textHash under a different embeddingModelVersion, or a
//     different embeddingDims, is a cache MISS (the caveat that a naive text-only key would get wrong);
//   * bad identity (empty model, non-positive/ non-integer dims) is REFUSED by name;
//   * empty batches are no-op successes.
//
// Run: node lib/embedding/test/test-vectorCache.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the shared vector cache

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the database path is REQUIRED with no default, that a vector round-trips by
     (embeddingModelVersion, embeddingDims, textHash), that a miss is an answer, that put is idempotent,
     that the MODEL and DIMS are part of the address (same text under a different model/dims is a miss),
     and that bad identity is refused. Throwaway database under the OS temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const vectorCacheModule = require('../vectorCache')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfVectorCacheGate-'));
const databaseFilePath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);
const cleanup = () => fs.rmSync(scratchDir, { recursive: true, force: true });

const MODEL_A = 'voyage-4-large';
const MODEL_B = 'voyage-3-large';
const DIMS_A = 1024;
const DIMS_B = 512;

const TEXT_ONE = 'SOC | Major Group | 11-0000';
const HASH_ONE = vectorCacheModule.textHashOf(TEXT_ONE);
const VECTOR_ONE = 'QUJDRA=='; // arbitrary base64; the cache holds it verbatim
const TEXT_TWO = 'SOC | Detailed | 11-1011';
const HASH_TWO = vectorCacheModule.textHashOf(TEXT_TWO);
const VECTOR_TWO = 'RUZHSA==';

// =====================================================================
harness.section('THE PATH IS REQUIRED — proven REFUSING, the same safety story decision-store tells');
// =====================================================================

vectorCacheModule.open({}, (err) => {
	harness.match('opening with no path is REFUSED', err, /databaseFilePath is REQUIRED/);
	harness.match('  and says why there is no default', err, /can write anywhere/);
});
vectorCacheModule.open({ databaseFilePath: '/no/such/directory/x.sqlite3' }, (err) => {
	harness.match('a path in a directory nobody prepared is REFUSED', err, /does not exist.*Refusing/s);
});

vectorCacheModule.open({ databaseFilePath }, (openErr, cache) => {
	if (openErr) {
		harness.ok('a throwaway database opened', false, openErr);
		cleanup();
		harness.report();
		return;
	}
	harness.ok('a throwaway database opened', !!cache);
	harness.equal('  and reports its own path', cache.databaseFilePath, databaseFilePath);

	// =====================================================================
	harness.section('MISS IS AN ANSWER — an unknown hash is absent from byHash, not an error');
	// =====================================================================

	cache.getVectors({ embeddingModelVersion: MODEL_A, embeddingDims: DIMS_A, textHashes: [HASH_ONE] }, (missErr, miss) => {
		harness.ok('an unknown hash is not an error', !missErr, missErr);
		harness.ok('  and is simply absent from byHash', miss && miss.byHash && miss.byHash[HASH_ONE] === undefined);

		// =====================================================================
		harness.section('ROUND-TRIP — put an entry, get it back by (model, dims, textHash)');
		// =====================================================================

		cache.putVectors(
			{
				embeddingModelVersion: MODEL_A,
				embeddingDims: DIMS_A,
				entries: [
					{ textHash: HASH_ONE, sourceText: TEXT_ONE, vectorBase64: VECTOR_ONE },
					{ textHash: HASH_TWO, sourceText: TEXT_TWO, vectorBase64: VECTOR_TWO },
				],
			},
			(putErr, putResult) => {
				harness.ok('two vectors stored', !putErr, putErr);
				harness.equal('  and the store reports what it was asked to write', putResult.requested, 2);

				cache.getVectors(
					{ embeddingModelVersion: MODEL_A, embeddingDims: DIMS_A, textHashes: [HASH_ONE, HASH_TWO] },
					(getErr, got) => {
						harness.ok('both vectors read back', !getErr && !!got, getErr);
						harness.equal('  vector one is BYTE-IDENTICAL to what was stored', got.byHash[HASH_ONE], VECTOR_ONE);
						harness.equal('  vector two is BYTE-IDENTICAL to what was stored', got.byHash[HASH_TWO], VECTOR_TWO);

						idempotenceGates(cache);
					},
				);
			},
		);
	});
});

// =====================================================================
// Function DECLARATIONS (not const arrows): called from inside the callback nest above, where a const
// would sit in the temporal dead zone (the hoisting discipline test-decision-store documents).
function idempotenceGates(cache) {
	harness.section('IDEMPOTENCE — re-storing the same address is a no-op success (INSERT OR IGNORE)');

	cache.putVectors(
		{
			embeddingModelVersion: MODEL_A,
			embeddingDims: DIMS_A,
			// same address, DIFFERENT payload — INSERT OR IGNORE must keep the FIRST and not error
			entries: [{ textHash: HASH_ONE, sourceText: TEXT_ONE, vectorBase64: 'WlpaWg==' }],
		},
		(reErr) => {
			harness.ok('a re-put of an existing address succeeds', !reErr, reErr);
			cache.getVectors(
				{ embeddingModelVersion: MODEL_A, embeddingDims: DIMS_A, textHashes: [HASH_ONE] },
				(getErr, got) => {
					harness.equal('  and the ORIGINAL vector is unchanged (no rewrite)', got.byHash[HASH_ONE], VECTOR_ONE);
					modelInAddressGates(cache);
				},
			);
		},
	);
}

// =====================================================================
function modelInAddressGates(cache) {
	harness.section('THE MODEL IS IN THE ADDRESS — same text, different model or dims, is a MISS');

	// same textHash, DIFFERENT model — must not return the model-A vector.
	cache.getVectors(
		{ embeddingModelVersion: MODEL_B, embeddingDims: DIMS_A, textHashes: [HASH_ONE] },
		(mErr, mGot) => {
			harness.ok('the same text under a DIFFERENT model is not an error', !mErr, mErr);
			harness.ok('  and is a MISS (the model is part of the address)', mGot.byHash[HASH_ONE] === undefined);

			// same textHash, same model, DIFFERENT dims — also a miss.
			cache.getVectors(
				{ embeddingModelVersion: MODEL_A, embeddingDims: DIMS_B, textHashes: [HASH_ONE] },
				(dErr, dGot) => {
					harness.ok('the same text under DIFFERENT dims is a MISS too', dGot.byHash[HASH_ONE] === undefined, dErr);

					// and the original address still hits — the others did not disturb it.
					cache.getVectors(
						{ embeddingModelVersion: MODEL_A, embeddingDims: DIMS_A, textHashes: [HASH_ONE] },
						(oErr, oGot) => {
							harness.equal('  while the ORIGINAL address still HITS', oGot.byHash[HASH_ONE], VECTOR_ONE);
							badIdentityGates(cache);
						},
					);
				},
			);
		},
	);
}

// =====================================================================
function badIdentityGates(cache) {
	harness.section('BAD IDENTITY is REFUSED by name; empty batches are no-op successes');

	cache.getVectors({ embeddingModelVersion: '', embeddingDims: DIMS_A, textHashes: [HASH_ONE] }, (e1) => {
		harness.match('an empty model is REFUSED', e1, /embeddingModelVersion is required/);
		cache.getVectors({ embeddingModelVersion: MODEL_A, embeddingDims: 0, textHashes: [HASH_ONE] }, (e2) => {
			harness.match('a non-positive dims is REFUSED', e2, /embeddingDims must be a positive whole number/);
			cache.putVectors({ embeddingModelVersion: MODEL_A, embeddingDims: 3.5, entries: [] }, (e3) => {
				harness.match('a non-integer dims is REFUSED', e3, /positive whole number/);
				cache.putVectors({ embeddingModelVersion: MODEL_A, embeddingDims: DIMS_A, entries: [] }, (e4, r4) => {
					harness.ok('an empty put batch is a no-op success', !e4 && r4 && r4.requested === 0, e4);
					cache.getVectors({ embeddingModelVersion: MODEL_A, embeddingDims: DIMS_A, textHashes: [] }, (e5, r5) => {
						harness.ok('an empty get batch returns an empty map', !e5 && r5 && Object.keys(r5.byHash).length === 0, e5);
						cleanup();
						harness.report();
					});
				});
			});
		});
	});
}
