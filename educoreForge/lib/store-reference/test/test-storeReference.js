#!/usr/bin/env node
'use strict';

// test-storeReference.js — gate for EC2/EC3 (build-store economy, VELVET_RIDGE for BRONZE_CROWN, 2026-10-25): a DELTA store over a
// read-only REFERENCE (lib/store-reference and the five family modules), and the fold that returns a delta's rows to the store of
// record (lib/store-fold). Hermetic: throwaway stores under the OS temp directory, a fixture embedding provider, no network.
//
// PROVES:
//   (a) a delta SERVES what only its reference holds, in every family: a block, a frozen vector, a decision block, a judgment and a
//       cached vector
//   (b) a write the reference already holds writes NOTHING to the delta (saveBlock alreadyPresent, putVector deduped,
//       saveDecisionBlock alreadyPresent, putJudgment alreadyPresent, putVectors stores no row)
//   (c) the reference connection is physically read-only: a write through it is refused by SQLite
//   (d) cache-only is exactly as strict: under cacheOnly, texts the reference holds are served with no provider call, and a text in
//       NEITHER layer is refused by name with no provider call (BRONZE_CROWN proof (b))
//   (e) ruling F: a delta's saveManifest refuses by name a member block held by neither layer, and saves one the reference holds
//   (f) a delta is never opened without its reference: a missing reference refuses the open (ruling F condition 4), and so does a
//       reference holding FEWER rows than when it was stamped
//   (g) a standalone store is unchanged: FOREIGN KEYs on, and a manifest naming a missing block refused by the key
//   (h) a delta has ONE reference: stamping it again with a different one is refused by name
//   (i) the fold conserves: the dry run counts the missing rows and writes nothing; --apply makes after = before + missing for
//       every table
//   (j) a fold with a CONFLICT (one address, another payload) is a STOP: refused, the target unchanged
//   (k) a folded row naming a parent the target lacks fails PRAGMA foreign_key_check and the whole fold ROLLS BACK
//   (l) a decision block for a pair the target already holds a LATER block for is an order conflict; one from a delta stamped after
//       every target block for its pair is not
// RED TWINS, each observed red: vectorCacheReferenceIgnored (a), blockWrittenAgain (b), referenceWritable (c),
// referenceIgnoredUnderCacheOnly and cacheOnlyStopRemoved (d), unionCheckRemoved (e), deltaOpenedWithoutReference and
// shrinkAccepted (f), foreignKeysOffForStandalone (g), secondReferenceAccepted (h), insertSkipped (i), conflictUncounted (j),
// foreignKeyUnchecked (k), orderUnchecked (l).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a delta store over a read-only reference, and the fold back into the store of record
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Hermetic: throwaway stores under the OS temp directory, a fixture embedding provider; nothing outside them is read or written.
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { loadWithMutations } = require('../../forge-framework/test/testSupport/moduleDouble');

const LIB_DIR = path.join(__dirname, '..', '..');
const MODULE_PATH_BY_NAME = Object.freeze({
	standardsDatabase: path.join(LIB_DIR, 'standards-database', 'standards-database.js'),
	vectorStore: path.join(LIB_DIR, 'vector-store', 'vector-store.js'),
	decisionStore: path.join(LIB_DIR, 'decision-store', 'decision-store.js'),
	judgmentCache: path.join(LIB_DIR, 'judgment-cache', 'judgment-cache.js'),
	vectorCache: path.join(LIB_DIR, 'embedding', 'vectorCache.js'),
	embeddingClient: path.join(LIB_DIR, 'embedding', 'embedding-client.js'),
	storeReference: path.join(LIB_DIR, 'store-reference', 'store-reference.js'),
	storeFold: path.join(LIB_DIR, 'store-fold', 'store-fold.js'),
});
// modulesFor — every module the gate drives, each compiled with the twin's mutations when one names it (a relative require inside
// it, such as embedding-client's ./vectorCache, is compiled through the same double), else the real one
const modulesFor = (mutationList) =>
	Object.keys(MODULE_PATH_BY_NAME).reduce((soFar, moduleRefName) => {
		const modulePath = MODULE_PATH_BY_NAME[moduleRefName];
		const relevantMutationList = mutationList.filter((oneMutation) => oneMutation.modulePath === modulePath || (moduleRefName === 'embeddingClient' && oneMutation.modulePath === MODULE_PATH_BY_NAME.vectorCache));
		// a module the double compiles must not open with a shebang line (embedding-client does): Node's wrapper cannot hold one
		const shebangMutationList = relevantMutationList.length > 0 && fs.readFileSync(modulePath, 'utf8').startsWith('#!') ? [{ modulePath, find: '#!/usr/bin/env node\n', replace: '' }] : [];
		return { ...soFar, [moduleRefName]: relevantMutationList.length > 0 ? loadWithMutations({ modulePath, mutationList: shebangMutationList.concat(relevantMutationList) }) : require(modulePath) };
	}, {});

const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edfStoreReference-'));
let scratchSequence = 0;
const freshDirPath = () => {
	scratchSequence += 1;
	const dirPath = path.join(scratchRootPath, `case${scratchSequence}`);
	fs.mkdirSync(dirPath);
	return dirPath;
};

const MODEL_VERSION = 'voyage-4-large';
const EMBEDDING_DIMS = 4;
const blockTextFor = (noteText) => `${JSON.stringify({ kind: 'header', blockType: 'standardBase', standardKey: 'GATE' })}\n${JSON.stringify({ kind: 'node', stableId: `urn:gate:${noteText}` })}\n`;
const JUDGMENT = Object.freeze({ choice: '1', category: 'EXACT', rationale: 'the gate says so', chosenStableId: 'urn:gate:chosen' });
const judgmentAddressFor = (promptHash) => ({ promptHash, model: 'gateModel', rendererVersion: 'gateRenderer-1' });
const vectorEntryFor = (vectorCacheModule, sourceText) => ({ textHash: vectorCacheModule.textHashOf(sourceText), sourceText, vectorBase64: Buffer.from(new Float32Array(EMBEDDING_DIMS).fill(0.25).buffer).toString('base64') });
// countRows — never throws: a test callback that threw inside sqlite-instance's own try/catch would be called AGAIN with the error
// (the store modules' callbacks run inside it), so an absent table answers -1 instead
const countRows = (filePath, tableName) => {
	const connection = new Database(filePath, { readonly: true, fileMustExist: true });
	const tableFound = connection.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).all(tableName).length > 0;
	const rowCount = tableFound ? connection.prepare(`SELECT COUNT(*) AS rowCount FROM ${tableName}`).get().rowCount : -1;
	connection.close();
	return rowCount;
};
// copyStore — a whole store, WAL included (a file copy of a WAL database misses every uncheckpointed page)
const copyStore = (sourceFilePath, copyFilePath) => {
	const connection = new Database(sourceFilePath, { readonly: true, fileMustExist: true });
	connection.prepare('VACUUM INTO ?').run(copyFilePath);
	connection.close();
};

// runSteps — a callback chain: each step (state, next) adds to state, or stops the chain with an error string
const runSteps = (stepList, finalCallback) => {
	const nextStep = (stepIndex, state) => {
		if (stepIndex >= stepList.length) {
			finalCallback('', state);
			return;
		}
		stepList[stepIndex](state, (stepErr, nextState) => (stepErr ? finalCallback(stepErr, state) : nextStep(stepIndex + 1, nextState)));
	};
	nextStep(0, {});
};

// buildReferencePair — a store of record in the SINGLE-FILE layout (standards, frozen vectors, decisions, judgments in one file)
// plus its vector cache, each holding one row per family; and an empty delta of each, stamped
const buildReferencePair = (modules, callback) => {
	const dirPath = freshDirPath();
	const referenceFilePath = path.join(dirPath, 'record.sqlite3');
	const referenceVectorCacheFilePath = path.join(dirPath, 'recordVectorCache.sqlite3');
	const deltaFilePath = path.join(dirPath, 'delta.sqlite3');
	const deltaVectorCacheFilePath = path.join(dirPath, 'deltaVectorCache.sqlite3');
	const real = modulesFor([]);
	runSteps(
		[
			(state, next) => real.standardsDatabase().open({ databaseFilePath: referenceFilePath }, (err, api) => (err ? next(err) : api.saveBlock({ text: blockTextFor('recordBlock'), kind: 'standardBase', subject: 'gate@1_base', version: '1' }, (saveErr, saved) => next(saveErr, { ...state, recordBlockRefId: saved && saved.refId })))),
			(state, next) => {
				const vectorStore = real.vectorStore({});
				vectorStore.init({ dbPath: referenceFilePath }, (err) => (err ? next(err) : vectorStore.putVector({ modelVersion: MODEL_VERSION, inputText: 'recordVectorText', vector: [0.1, 0.2, 0.3, 0.4], embeddingRefGrammar: 2 }, (putErr, put) => next(putErr, { ...state, recordVectorId: put && put.vectorId }))));
			},
			(state, next) => real.decisionStore().open({ databaseFilePath: referenceFilePath }, (err, api) => (err ? next(err) : api.saveDecisionBlock({ pairKey: 'gatePair', frozenText: 'frozen decision of record' }, (saveErr, saved) => next(saveErr, { ...state, recordDecisionBlockHash: saved && saved.decisionBlockHash })))),
			(state, next) => real.judgmentCache().open({ databaseFilePath: referenceFilePath }, (err, api) => (err ? next(err) : api.putJudgment({ ...judgmentAddressFor('recordPrompt'), judgment: JUDGMENT }, (putErr) => next(putErr, state)))),
			(state, next) => real.vectorCache().open({ databaseFilePath: referenceVectorCacheFilePath }, (err, api) => (err ? next(err) : api.putVectors({ embeddingModelVersion: MODEL_VERSION, embeddingDims: EMBEDDING_DIMS, entries: [vectorEntryFor(real.vectorCache(), 'alpha'), vectorEntryFor(real.vectorCache(), 'beta')] }, (putErr) => next(putErr, state)))),
			(state, next) => {
				const stampList = [
					['standardsDatabase', deltaFilePath, referenceFilePath],
					['vectorStore', deltaFilePath, referenceFilePath],
					['decisionStore', deltaFilePath, referenceFilePath],
					['judgmentCache', deltaFilePath, referenceFilePath],
					['vectorCache', deltaVectorCacheFilePath, referenceVectorCacheFilePath],
				];
				const stampNext = (stampIndex) => (stampIndex >= stampList.length ? next('', state) : real.storeReference.stampReference({ familyName: stampList[stampIndex][0], databaseFilePath: stampList[stampIndex][1], referenceDatabaseFilePath: stampList[stampIndex][2] }, (stampErr) => (stampErr ? next(stampErr) : stampNext(stampIndex + 1))));
				stampNext(0);
			},
		],
		(err, state) => callback(err, { ...state, dirPath, referenceFilePath, referenceVectorCacheFilePath, deltaFilePath, deltaVectorCacheFilePath }),
	);
};

const fixtureProvider = () => ({
	sentTextCountList: [],
	embed(texts, resolvedConfig, callback) {
		this.sentTextCountList.push(texts.length);
		setImmediate(() => callback('', texts.map(() => new Array(resolvedConfig.dimension).fill(0.25)), { totalTokens: texts.length * 5 }));
	},
});

const conjunctJudgeByRefId = {
	a_referenceHitServedEveryFamily: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildReferencePair(modules, (setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			const resultList = [];
			runSteps(
				[
					(state, next) => modules.standardsDatabase().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.getBlock({ refId: pair.recordBlockRefId }, (getErr, row) => (resultList.push(`block ${row ? 'served' : 'MISSING'}`), next(getErr, state))))),
					(state, next) => {
						const vectorStore = modules.vectorStore({});
						vectorStore.init({ dbPath: pair.deltaFilePath }, (err) => (err ? next(err) : vectorStore.getVector({ vectorId: pair.recordVectorId }, (getErr, row) => (resultList.push(`frozen vector ${row ? 'served' : 'MISSING'}`), next(getErr, state)))));
					},
					(state, next) => modules.decisionStore().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.getDecisionBlock({ pairKey: 'gatePair' }, (getErr, got) => (resultList.push(`decision block ${got && got.frozenText ? 'served' : 'MISSING'}`), next(getErr, state))))),
					(state, next) => modules.judgmentCache().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.getJudgment(judgmentAddressFor('recordPrompt'), (getErr, got) => (resultList.push(`judgment ${got && got.judgment ? 'served' : 'MISSING'}`), next(getErr, state))))),
					(state, next) => modules.vectorCache().open({ databaseFilePath: pair.deltaVectorCacheFilePath }, (err, api) => (err ? next(err) : api.getVectors({ embeddingModelVersion: MODEL_VERSION, embeddingDims: EMBEDDING_DIMS, textHashes: [modules.vectorCache().textHashOf('alpha')] }, (getErr, got) => (resultList.push(`cached vector ${got && Object.keys(got.byHash).length === 1 ? 'served' : 'MISSING'}`), next(getErr, state))))),
				],
				(err) => done({ pass: !err && resultList.length === 5 && resultList.every((oneResult) => /served$/.test(oneResult)), detail: `${resultList.join('; ')}${err ? `; ERROR ${err}` : ''}` }),
			);
		});
	},
	b_heldAddressNotWritten: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildReferencePair(modules, (setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			const reportList = [];
			runSteps(
				[
					(state, next) => modules.standardsDatabase().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.saveBlock({ text: blockTextFor('recordBlock'), kind: 'standardBase', subject: 'gate@1_base', version: '1' }, (saveErr, saved) => (reportList.push(`saveBlock alreadyPresent ${saved && saved.alreadyPresent}`), next(saveErr, state))))),
					(state, next) => {
						const vectorStore = modules.vectorStore({});
						vectorStore.init({ dbPath: pair.deltaFilePath }, (err) => (err ? next(err) : vectorStore.putVector({ modelVersion: MODEL_VERSION, inputText: 'recordVectorText', vector: [0.1, 0.2, 0.3, 0.4], embeddingRefGrammar: 2 }, (putErr, put) => (reportList.push(`putVector deduped ${put && put.deduped}`), next(putErr, state)))));
					},
					(state, next) => modules.decisionStore().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.saveDecisionBlock({ pairKey: 'gatePair', frozenText: 'frozen decision of record' }, (saveErr, saved) => (reportList.push(`saveDecisionBlock alreadyPresent ${saved && saved.alreadyPresent}`), next(saveErr, state))))),
					(state, next) => modules.judgmentCache().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.putJudgment({ ...judgmentAddressFor('recordPrompt'), judgment: JUDGMENT }, (putErr, put) => (reportList.push(`putJudgment alreadyPresent ${put && put.alreadyPresent}`), next(putErr, state))))),
					(state, next) => modules.vectorCache().open({ databaseFilePath: pair.deltaVectorCacheFilePath }, (err, api) => (err ? next(err) : api.putVectors({ embeddingModelVersion: MODEL_VERSION, embeddingDims: EMBEDDING_DIMS, entries: [vectorEntryFor(modules.vectorCache(), 'alpha')] }, (putErr) => next(putErr, state)))),
				],
				(err) => {
					const deltaRowCountList = [['blocks', pair.deltaFilePath], ['vectors', pair.deltaFilePath], ['decisionBlocks', pair.deltaFilePath], ['judgmentCacheEntries', pair.deltaFilePath], ['vectorCacheEntries', pair.deltaVectorCacheFilePath]].map((oneTable) => `${oneTable[0]} ${countRows(oneTable[1], oneTable[0])}`);
					done({ pass: !err && reportList.every((oneReport) => / true$/.test(oneReport)) && deltaRowCountList.every((oneCount) => / 0$/.test(oneCount)), detail: `${reportList.join('; ')}; delta rows: ${deltaRowCountList.join(', ')}${err ? `; ERROR ${err}` : ''}` });
				},
			);
		});
	},
	c_referenceConnectionReadOnly: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildReferencePair(modulesFor([]), (setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			const deltaConnection = new Database(pair.deltaFilePath, { readonly: true });
			const getRows = (statement, rowsCallback) => rowsCallback(null, deltaConnection.prepare(statement).all());
			modules.storeReference.openReferenceLayer({ getRows, familyName: 'standardsDatabase', databaseFilePath: pair.deltaFilePath }, (openErr, referenceLayer) => {
				if (openErr || !referenceLayer) {
					done({ pass: false, detail: `the layer did not open: ${openErr}` });
					return;
				}
				referenceLayer.getReferenceRows('DELETE FROM blocks RETURNING refId;', (writeErr) => {
					const blockCount = countRows(pair.referenceFilePath, 'blocks');
					done({ pass: /readonly database/.test(String(writeErr)) && blockCount === 1, detail: `a DELETE through the reference: ${writeErr || 'ACCEPTED'}; reference blocks now ${blockCount}` });
				});
			});
		});
	},
	d_cacheOnlyMissInBothLayers: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildReferencePair(modulesFor([]), (setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			const iniFilePath = path.join(pair.dirPath, 'voyageEmbedding.ini');
			fs.writeFileSync(iniFilePath, `[voyageEmbedding]\napiKey=NOT-A-REAL-KEY\nmodel=${MODEL_VERSION}\nembeddingDims=${EMBEDDING_DIMS}\n`);
			const servedProvider = fixtureProvider();
			modules.embeddingClient({ configFilePath: iniFilePath, cacheFilePath: pair.deltaVectorCacheFilePath, cacheOnly: true, componentOverrides: { provider: servedProvider } }).embedTexts({ texts: ['alpha', 'beta'] }, (servedErr, servedResult) => {
				const stoppedProvider = fixtureProvider();
				modules.embeddingClient({ configFilePath: iniFilePath, cacheFilePath: pair.deltaVectorCacheFilePath, cacheOnly: true, componentOverrides: { provider: stoppedProvider } }).embedTexts({ texts: ['alpha', 'gamma'] }, (stoppedErr) => {
					const servedFromReference = !servedErr && servedResult && servedResult.vectors.length === 2 && servedProvider.sentTextCountList.length === 0;
					const refusedBothMiss = /REFUSED under cache-only.*1 distinct text\(s\) are not in the vector cache/.test(String(stoppedErr)) && stoppedProvider.sentTextCountList.length === 0;
					done({ pass: servedFromReference && refusedBothMiss, detail: `texts only the reference holds: ${servedErr ? `REFUSED (${String(servedErr).slice(0, 160)})` : `served, provider calls ${servedProvider.sentTextCountList.length}`}; a text in neither layer: ${stoppedErr ? String(stoppedErr).slice(0, 120) : 'NOT REFUSED'}, provider calls ${stoppedProvider.sentTextCountList.length}` });
				});
			});
		});
	},
	e_unionMembershipChecked: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildReferencePair(modulesFor([]), (setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			modules.standardsDatabase().open({ databaseFilePath: pair.deltaFilePath }, (openErr, api) => {
				if (openErr) {
					done({ pass: false, detail: `open: ${openErr}` });
					return;
				}
				api.saveBlock({ text: blockTextFor('deltaBlock'), kind: 'standardBase', subject: 'gateDelta@1_base', version: '1' }, (saveErr, deltaBlock) => {
					api.saveManifest({ name: 'held', members: [{ schemaBlockRefId: pair.recordBlockRefId, position: 0 }, { schemaBlockRefId: deltaBlock.refId, position: 1 }] }, (heldErr) => {
						api.saveManifest({ name: 'unheld', members: [{ schemaBlockRefId: pair.recordBlockRefId, position: 0 }, { schemaBlockRefId: 'f'.repeat(64), position: 1 }] }, (unheldErr) => {
							const manifestCount = countRows(pair.deltaFilePath, 'manifests');
							done({ pass: !saveErr && !heldErr && /REFUSED — 1 member block\(s\) are held by neither this DELTA nor its reference/.test(String(unheldErr)) && manifestCount === 1, detail: `members held by the delta and the reference: ${heldErr || 'saved'}; one held by neither: ${unheldErr || 'SAVED'}; delta manifests ${manifestCount}` });
						});
					});
				});
			});
		});
	},
	f_deltaNeverOpenedWithoutReference: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildReferencePair(modulesFor([]), (setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			fs.renameSync(pair.referenceFilePath, `${pair.referenceFilePath}.moved`);
			modules.standardsDatabase().open({ databaseFilePath: pair.deltaFilePath }, (missingErr) => {
				fs.renameSync(`${pair.referenceFilePath}.moved`, pair.referenceFilePath);
				// the shrunk case: the stamp says the reference held more rows than it does now
				const deltaConnection = new Database(pair.deltaFilePath);
				deltaConnection.prepare(`UPDATE storeReferenceStamps SET referenceRowCountAtStamp = referenceRowCountAtStamp + 5 WHERE familyName = 'standardsDatabase'`).run();
				const getRows = (statement, rowsCallback) => rowsCallback(null, deltaConnection.prepare(statement).all());
				modules.storeReference.openReferenceLayer({ getRows, familyName: 'standardsDatabase', databaseFilePath: pair.deltaFilePath }, (shrunkErr) => {
					deltaConnection.close();
					done({ pass: /REFUSED — .* is a standardsDatabase DELTA of .*does not exist/.test(String(missingErr)) && /fewer than the 6 it held when stamped/.test(String(shrunkErr)), detail: `reference missing: ${missingErr ? String(missingErr).slice(0, 200) : 'OPENED'}; reference smaller than stamped: ${shrunkErr ? String(shrunkErr).slice(-160) : 'OPENED'}` });
				});
			});
		});
	},
	g_standaloneUnchanged: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		const databaseFilePath = path.join(freshDirPath(), 'standalone.sqlite3');
		modules.standardsDatabase().open({ databaseFilePath }, (openErr, api) => {
			if (openErr) {
				done({ pass: false, detail: `a standalone store did not open: ${openErr}` });
				return;
			}
			api.saveManifest({ name: 'dangling', members: [{ schemaBlockRefId: 'e'.repeat(64), position: 0 }] }, (manifestErr) => {
				done({ pass: api.referenceDatabaseFilePath === null && api.membershipCheckedOverUnion === false && /FOREIGN KEY constraint failed/.test(String(manifestErr)) && countRows(databaseFilePath, 'manifests') === 0, detail: `reference ${api.referenceDatabaseFilePath}; a manifest naming a missing block: ${manifestErr || 'SAVED'}` });
			});
		});
	},
	h_oneReferencePerDelta: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildReferencePair(modulesFor([]), (setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			const otherReferenceFilePath = path.join(pair.dirPath, 'otherRecord.sqlite3');
			copyStore(pair.referenceFilePath, otherReferenceFilePath);
			modules.storeReference.stampReference({ familyName: 'standardsDatabase', databaseFilePath: pair.deltaFilePath, referenceDatabaseFilePath: pair.referenceFilePath }, (sameErr, sameReport) => {
				modules.storeReference.stampReference({ familyName: 'standardsDatabase', databaseFilePath: pair.deltaFilePath, referenceDatabaseFilePath: otherReferenceFilePath }, (otherErr) => {
					done({ pass: !sameErr && sameReport.alreadyStamped === true && /is already a standardsDatabase delta of .* A delta has ONE reference/.test(String(otherErr)), detail: `the same reference again: ${sameErr || `alreadyStamped ${sameReport.alreadyStamped}`}; a different one: ${otherErr || 'ACCEPTED'}` });
				});
			});
		});
	},
};

// THE FOLD — a delta holding novel rows in every family, folded into a COPY of the store of record (the target)
const ensureTargetSchemaFor = (modules, targetFilePath) => (familyNameList, schemaDone) => {
	const openerByFamilyName = {
		standardsDatabase: (cb) => modules.standardsDatabase().open({ databaseFilePath: targetFilePath }, cb),
		vectorStore: (cb) => modules.vectorStore({}).init({ dbPath: targetFilePath }, cb),
		decisionStore: (cb) => modules.decisionStore().open({ databaseFilePath: targetFilePath }, cb),
		judgmentCache: (cb) => modules.judgmentCache().open({ databaseFilePath: targetFilePath }, cb),
		vectorCache: (cb) => modules.vectorCache().open({ databaseFilePath: targetFilePath }, cb),
	};
	const openNext = (familyIndex) => (familyIndex >= familyNameList.length ? schemaDone('') : openerByFamilyName[familyNameList[familyIndex]]((err) => (err ? schemaDone(err) : openNext(familyIndex + 1))));
	openNext(0);
};
const buildDeltaWithNovelRows = (callback) => {
	const real = modulesFor([]);
	buildReferencePair(real, (setupErr, pair) => {
		if (setupErr) {
			callback(setupErr);
			return;
		}
		runSteps(
			[
				(state, next) => real.standardsDatabase().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.saveBlock({ text: blockTextFor('novelBlock'), kind: 'standardBase', subject: 'gateNovel@1_base', version: '1' }, (saveErr, saved) => (saveErr ? next(saveErr) : api.saveManifest({ name: 'novel', members: [{ schemaBlockRefId: pair.recordBlockRefId, position: 0 }, { schemaBlockRefId: saved.refId, position: 1 }] }, (manifestErr) => next(manifestErr, state)))))),
				(state, next) => {
					const vectorStore = real.vectorStore({});
					vectorStore.init({ dbPath: pair.deltaFilePath }, (err) => (err ? next(err) : vectorStore.putVector({ modelVersion: MODEL_VERSION, inputText: 'novelVectorText', vector: [0.5, 0.6, 0.7, 0.8], embeddingRefGrammar: 2 }, (putErr) => next(putErr, state))));
				},
				(state, next) => real.decisionStore().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.saveDecisionBlock({ pairKey: 'novelPair', frozenText: 'frozen novel decision' }, (saveErr) => next(saveErr, state)))),
				(state, next) => real.judgmentCache().open({ databaseFilePath: pair.deltaFilePath }, (err, api) => (err ? next(err) : api.putJudgment({ ...judgmentAddressFor('novelPrompt'), judgment: JUDGMENT }, (putErr) => next(putErr, state)))),
			],
			(err) => {
				if (err) {
					callback(err);
					return;
				}
				const targetFilePath = path.join(pair.dirPath, 'target.sqlite3');
				copyStore(pair.referenceFilePath, targetFilePath);
				callback('', { ...pair, targetFilePath });
			},
		);
	});
};
const tableCountsOf = (filePath) => ['blocks', 'manifests', 'manifestBlocks', 'vectors', 'decisionBlocks', 'judgmentCacheEntries'].map((tableName) => `${tableName} ${countRows(filePath, tableName)}`).join(', ');

Object.assign(conjunctJudgeByRefId, {
	i_foldConserves: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildDeltaWithNovelRows((setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			const countsBefore = tableCountsOf(pair.targetFilePath);
			const planned = modules.storeFold.planFold({ sourceFilePath: pair.deltaFilePath, targetFilePath: pair.targetFilePath });
			if (planned.error) {
				done({ pass: false, detail: `plan: ${planned.error}` });
				return;
			}
			const missingByTable = planned.plan.tablePlanList.map((tablePlan) => `${tablePlan.tableName} ${tablePlan.missingCount}`).join(', ');
			const countsAfterDryRun = tableCountsOf(pair.targetFilePath);
			modules.storeFold.applyFold({ plan: planned.plan, ensureTargetSchema: ensureTargetSchemaFor(modulesFor([]), pair.targetFilePath) }, (applyErr, report) => {
				const countsAfter = tableCountsOf(pair.targetFilePath);
				const expectedAfter = 'blocks 2, manifests 1, manifestBlocks 2, vectors 2, decisionBlocks 2, judgmentCacheEntries 2';
				done({ pass: !applyErr && countsAfterDryRun === countsBefore && planned.plan.conflictTotal === 0 && countsAfter === expectedAfter && report.tableReportList.every((tableReport) => tableReport.conserved), detail: `missing ${missingByTable}; target before ${countsBefore}; after the dry run ${countsAfterDryRun}; after --apply ${countsAfter}${applyErr ? `; ERROR ${applyErr}` : ''}` });
			});
		});
	},
	j_foldConflictStops: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildDeltaWithNovelRows((setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			// plant a conflict: the target answers the delta's novel judgment's address with ANOTHER judgment
			const targetConnection = new Database(pair.targetFilePath);
			targetConnection.prepare(`INSERT INTO judgmentCacheEntries (promptHash, model, rendererVersion, judgmentJson) VALUES ('novelPrompt', 'gateModel', 'gateRenderer-1', '{"choice":"NONE"}')`).run();
			targetConnection.close();
			const countsBefore = tableCountsOf(pair.targetFilePath);
			const planned = modules.storeFold.planFold({ sourceFilePath: pair.deltaFilePath, targetFilePath: pair.targetFilePath });
			modules.storeFold.applyFold({ plan: planned.plan, ensureTargetSchema: ensureTargetSchemaFor(modulesFor([]), pair.targetFilePath) }, (applyErr) => {
				const countsAfter = tableCountsOf(pair.targetFilePath);
				done({ pass: planned.plan.conflictTotal === 1 && /REFUSED — the plan holds 1 conflict/.test(String(applyErr)) && countsAfter === countsBefore, detail: `plan conflicts ${planned.plan.conflictTotal}; apply: ${applyErr || 'APPLIED'}; target ${countsBefore} -> ${countsAfter}` });
			});
		});
	},
	k_foldForeignKeyRollsBack: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		buildDeltaWithNovelRows((setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			// a manifest row naming a block neither store holds, written past the union check (the source is corrupt)
			const deltaConnection = new Database(pair.deltaFilePath);
			deltaConnection.pragma('foreign_keys = OFF');
			deltaConnection.prepare(`INSERT INTO manifestBlocks (manifestRefId, schemaBlockRefId, position) SELECT refId, '${'d'.repeat(64)}', 9 FROM manifests LIMIT 1`).run();
			deltaConnection.close();
			const countsBefore = tableCountsOf(pair.targetFilePath);
			const planned = modules.storeFold.planFold({ sourceFilePath: pair.deltaFilePath, targetFilePath: pair.targetFilePath });
			modules.storeFold.applyFold({ plan: planned.plan, ensureTargetSchema: ensureTargetSchemaFor(modulesFor([]), pair.targetFilePath) }, (applyErr) => {
				const countsAfter = tableCountsOf(pair.targetFilePath);
				done({ pass: /ROLLED BACK — PRAGMA foreign_key_check found 1 row/.test(String(applyErr)) && countsAfter === countsBefore, detail: `apply: ${applyErr ? String(applyErr).slice(0, 220) : 'APPLIED'}; target ${countsBefore} -> ${countsAfter}` });
			});
		});
	},
	l_foldDecisionOrder: (mutationList, done) => {
		const modules = modulesFor(mutationList);
		const real = modulesFor([]);
		buildDeltaWithNovelRows((setupErr, pair) => {
			if (setupErr) {
				done({ pass: false, detail: `setup: ${setupErr}` });
				return;
			}
			// the target gains a LATER block for the delta's novel pair (another fold landed first)
			real.decisionStore().open({ databaseFilePath: pair.targetFilePath }, (openErr, targetDecisions) => {
				if (openErr) {
					done({ pass: false, detail: `the target did not open: ${openErr}` });
					return;
				}
				targetDecisions.saveDecisionBlock({ pairKey: 'novelPair', frozenText: 'a later decision another delta folded first' }, () => {
					const conflicted = modules.storeFold.planFold({ sourceFilePath: pair.deltaFilePath, targetFilePath: pair.targetFilePath });
					// a delta stamped over THIS target after every one of its blocks: no conflict
					const laterDeltaFilePath = path.join(pair.dirPath, 'laterDelta.sqlite3');
					real.storeReference.stampReference({ familyName: 'decisionStore', databaseFilePath: laterDeltaFilePath, referenceDatabaseFilePath: pair.targetFilePath }, (stampErr) => {
						real.decisionStore().open({ databaseFilePath: laterDeltaFilePath }, (laterOpenErr, laterDecisions) => {
							if (stampErr || laterOpenErr) {
								done({ pass: false, detail: `the later delta: ${stampErr || laterOpenErr}` });
								return;
							}
							laterDecisions.saveDecisionBlock({ pairKey: 'novelPair', frozenText: 'the latest decision of all' }, () => {
								const ordered = modules.storeFold.planFold({ sourceFilePath: laterDeltaFilePath, targetFilePath: pair.targetFilePath });
								const orderConflictOf = (planned) => (planned.plan ? planned.plan.tablePlanList.find((tablePlan) => tablePlan.tableName === 'decisionBlocks').orderConflictCount : `error ${planned.error}`);
								done({ pass: !stampErr && orderConflictOf(conflicted) === 1 && orderConflictOf(ordered) === 0, detail: `unstamped delta vs a target holding a block for its pair: ${orderConflictOf(conflicted)} order conflict(s); a delta stamped after: ${orderConflictOf(ordered)}` });
							});
						});
					});
				});
			});
		});
	},
});

const TWIN_LIST = [
	{ conjunctRefId: 'a_referenceHitServedEveryFamily', twinName: 'vectorCacheReferenceIgnored', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.vectorCache, find: 'if (ownErr || !referenceLayer || missedHashList.length === 0) {', replace: 'if (true) {' }] },
	{ conjunctRefId: 'b_heldAddressNotWritten', twinName: 'blockWrittenAgain', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.standardsDatabase, find: 'getRowsFromLayers(`SELECT refId FROM blocks WHERE refId=${esc(refId)};`', replace: 'getRows(`SELECT refId FROM blocks WHERE refId=${esc(refId)};`' }] },
	{ conjunctRefId: 'c_referenceConnectionReadOnly', twinName: 'referenceWritable', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.storeReference, find: 'connection = new Database(referenceDatabaseFilePath, { readonly: true, fileMustExist: true });', replace: 'connection = new Database(referenceDatabaseFilePath, { fileMustExist: true });' }] },
	{ conjunctRefId: 'd_cacheOnlyMissInBothLayers', twinName: 'referenceIgnoredUnderCacheOnly', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.vectorCache, find: 'if (ownErr || !referenceLayer || missedHashList.length === 0) {', replace: 'if (true) {' }] },
	{ conjunctRefId: 'd_cacheOnlyMissInBothLayers', twinName: 'cacheOnlyStopRemoved', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.embeddingClient, find: '						if (cacheOnlyInForce) {', replace: '						if (false) {' }] },
	{ conjunctRefId: 'e_unionMembershipChecked', twinName: 'unionCheckRemoved', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.standardsDatabase, find: '			if (!membershipCheckedOverUnion) {', replace: '			if (true) {' }] },
	{ conjunctRefId: 'f_deltaNeverOpenedWithoutReference', twinName: 'deltaOpenedWithoutReference', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.standardsDatabase, find: "storeReference.openReferenceLayer({ getRows, familyName: 'standardsDatabase', databaseFilePath }, (referenceErr, referenceLayer) => {", replace: "((unusedSpec, layerCallback) => layerCallback('', null))({ getRows, familyName: 'standardsDatabase', databaseFilePath }, (referenceErr, referenceLayer) => {" }] },
	{ conjunctRefId: 'f_deltaNeverOpenedWithoutReference', twinName: 'shrinkAccepted', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.storeReference, find: 'if (shape.rowCount < Number(stampRow.referenceRowCountAtStamp)) {', replace: 'if (false) {' }] },
	{ conjunctRefId: 'g_standaloneUnchanged', twinName: 'foreignKeysOffForStandalone', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.standardsDatabase, find: "const turnForeignKeysOffForDelta = (done) => (referenceLayer ? runSql('PRAGMA foreign_keys = OFF;', done) : done(''));", replace: "const turnForeignKeysOffForDelta = (done) => runSql('PRAGMA foreign_keys = OFF;', done);" }] },
	{ conjunctRefId: 'h_oneReferencePerDelta', twinName: 'secondReferenceAccepted', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.storeReference, find: 'if (existingStamp.referenceDatabaseFilePath !== absoluteReferenceFilePath) {', replace: 'if (false) {' }] },
	{ conjunctRefId: 'i_foldConserves', twinName: 'insertSkipped', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.storeFold, find: '		if (presentStatement.get(...addressColumnList.map((columnName) => sourceRow[columnName]))) {', replace: '		if (true) {' }] },
	{ conjunctRefId: 'j_foldConflictStops', twinName: 'conflictUncounted', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.storeFold, find: '		if (differingColumnList.length > 0) {', replace: '		if (false) {' }] },
	{ conjunctRefId: 'k_foldForeignKeyRollsBack', twinName: 'foreignKeyUnchecked', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.storeFold, find: "const foreignKeyViolationList = targetConnection.prepare('PRAGMA foreign_key_check').all();", replace: 'const foreignKeyViolationList = [];' }] },
	{ conjunctRefId: 'l_foldDecisionOrder', twinName: 'orderUnchecked', mutationList: [{ modulePath: MODULE_PATH_BY_NAME.storeFold, find: 'if (latestTargetRow && (orderThreshold === null || Number(latestTargetRow.seq) > orderThreshold)) {', replace: 'if (false) {' }] },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
// runSequence — each step's completion is taken ONCE and continued on a fresh tick: a step's callback runs inside sqlite-instance's
// own try/catch, and anything the NEXT step threw would otherwise be caught there and the callback invoked again
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => {
		if (stepIndex >= stepList.length) {
			setImmediate(whenDone);
			return;
		}
		let stepFinished = false;
		stepList[stepIndex](() => {
			if (stepFinished) {
				throw new Error(`${moduleName}: step ${stepIndex} completed TWICE`);
			}
			stepFinished = true;
			setImmediate(() => nextStep(stepIndex + 1));
		});
	};
	nextStep(0);
};
harness.section('BASELINE — the real modules pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); harness.note(`${oneRefId}: ${verdict.detail}`); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED (the module compiled in memory with one named mutation)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				conjunctJudgeByRefId[oneTwin.conjunctRefId](oneTwin.mutationList, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				});
			}),
			() => {
				fs.rmSync(scratchRootPath, { recursive: true, force: true });
				harness.report();
			},
		);
	},
);
