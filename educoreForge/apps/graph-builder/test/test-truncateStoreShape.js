#!/usr/bin/env node
'use strict';

// test-truncateStoreShape.js — F-20 gates (deep review 2026-11-21): -truncateStore works on TODAY'S store shape.
//
// The action used to empty a fixed list of seven tables, and it counted every one before writing anything. The vector cache
// moved to its own file on 2026-10-06, so the store of record has had no vectorCacheEntries table since, and the command
// failed on it with "no such table" before any write (the review measured it). The same list left out judgmentFillingSpend
// (the judgment cache's spend sidecar) and four *Ops logs, which it never mentioned at all.
//
// The fix, ruled by SINCERE_STATUETTE 2026-11-21: a declared registry of table -> { owningFamily, disposition } and the
// store's own sqlite_master decide what is emptied. A table the store holds and the registry does not name is REFUSED by
// name before any write. judgmentFillingSpend is emptied with the cache it belongs to; the *Ops logs and sqlite_sequence are
// retained. The command prints, before it writes, which tables it empties and which it retains, with row counts.
//
// The store is a throwaway built through the owning modules in today's shape: no vectorCache is opened on it, exactly as the
// configured store of record. Every table gets one seeded row, so "emptied" and "retained" are both observable.
//
// Run: node apps/graph-builder/test/test-truncateStoreShape.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- F-20 gates: -truncateStore on today's store shape, its registry and its refusal

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Builds a throwaway support store shaped like the store of record (no vectorCacheEntries), seeds a row into every
     table, and requires -truncateStore to: succeed; empty every registry 'truncate' table, judgmentFillingSpend included;
     keep every 'retain' table's rows; print its plan with counts before the backup is written. A second store carrying a
     table the registry does not name must be refused by name, with nothing emptied and no backup written. Then a scratch
     stand-in for the configured store of record: every blank or swallowed --standardsDatabaseFilePath must be refused by
     the verb before it reaches that store; an absent flag still resolves it (unchanged, a ruling is pending).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const actions = require('../lib/actions')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfTruncateShapeGate-'));

const EMPTIED_TABLE_NAME_LIST = ['blocks', 'manifests', 'manifestBlocks', 'decisionBlocks', 'vectors', 'judgmentCacheEntries', 'judgmentFillingSpend'];
const RETAINED_TABLE_NAME_LIST = ['standardsDatabaseOps', 'decisionStoreOps', 'vectorStoreOps', 'judgmentCacheOps'];
const STRANGER_TABLE_NAME = 'strangerTableNobodyDeclared';

const originalGlobal = process.global;

// process.global is FROZEN, so a parameter change replaces the whole object (as test-supportStore does). getConfig answers
// {} unless a case hands it a [stores] section naming a SCRATCH store, so the real store of record can never be resolved;
// otherwise the store travels by the explicit flag. xLog.status is
// recorded in order so the plan line's position before the backup line is observable.
const withStorePath = ({ storeFilePath, statusLineList, storesConfig = {}, commandLineValues }) => {
	const recordingXLog = Object.assign(Object.create(originalGlobal.xLog), {
		status: (oneLine) => {
			statusLineList.push(`${oneLine}`);
			originalGlobal.xLog.status(oneLine);
		},
	});
	delete process.global;
	process.global = {
		xLog: recordingXLog,
		getConfig: (sectionName) => (sectionName === 'stores' ? storesConfig : {}),
		commandLineParameters: { switches: {}, values: commandLineValues || { standardsDatabaseFilePath: [storeFilePath] }, fileList: [] },
		rawConfig: {},
	};
};

const restoreGlobal = () => {
	delete process.global;
	process.global = originalGlobal;
};

const rowCountByTableNameOf = (databaseFilePath, tableNameList) => {
	const oneConnection = new Database(databaseFilePath, { readonly: true });
	const rowCountByTableName = {};
	tableNameList.forEach((oneTableName) => {
		rowCountByTableName[oneTableName] = oneConnection.prepare(`SELECT count(*) AS n FROM ${oneTableName};`).get().n;
	});
	oneConnection.close();
	return rowCountByTableName;
};

const backupFileNameListIn = () => fs.readdirSync(scratchDir).filter((oneEntry) => oneEntry.endsWith('.backup'));

// buildTodayShapedStore — the owning modules open the store (no vectorCache: its table lives in its own file since
// 2026-10-06), then one row is seeded into every table
const buildTodayShapedStore = ({ storeFilePath }, callback) => {
	const taskList = new taskListPlus();
	taskList.push((args, next) => require('../../../lib/standards-database/standards-database')().open({ databaseFilePath: storeFilePath }, (err) => next(err, args)));
	taskList.push((args, next) => require('../../../lib/decision-store/decision-store')().open({ databaseFilePath: storeFilePath }, (err) => next(err, args)));
	taskList.push((args, next) => require('../../../lib/vector-store/vector-store')({}).init({ dbPath: storeFilePath }, (err) => next(err, args)));
	taskList.push((args, next) => require('../../../lib/judgment-cache/judgment-cache')().open({ databaseFilePath: storeFilePath }, (err) => next(err, args)));
	pipeRunner(taskList.getList(), {}, (err) => {
		if (err) {
			callback(err);
			return;
		}
		const seed = new Database(storeFilePath);
		seed.prepare(`INSERT INTO blocks (refId, kind, text) VALUES ('seedRef','standardBase','seedText')`).run();
		seed.prepare(`INSERT INTO manifests (refId, name) VALUES ('seedManifest','seed')`).run();
		seed.prepare(`INSERT INTO manifestBlocks (manifestRefId, schemaBlockRefId) VALUES ('seedManifest','seedRef')`).run();
		seed.prepare(`INSERT INTO decisionBlocks (decisionBlockHash, pairKey, frozenText) VALUES ('h','p','t')`).run();
		seed.prepare(`INSERT INTO vectors (vectorId, modelVersion, dims, dtype, inputText, vector, vectorHash) VALUES ('v','m',1,'float32','t',X'00000000','h')`).run();
		seed.prepare(`INSERT INTO judgmentCacheEntries (promptHash, model, rendererVersion, judgmentJson) VALUES ('h','m','r','{}')`).run();
		seed.prepare(`INSERT INTO judgmentFillingSpend (promptHash, model, rendererVersion, fillingSpendCallListJson) VALUES ('h','m','r','[]')`).run();
		RETAINED_TABLE_NAME_LIST.forEach((oneTableName) => seed.prepare(`INSERT INTO ${oneTableName} (refId) VALUES ('seedOpsRow')`).run());
		seed.close();
		callback('');
	});
};

const taskList = new taskListPlus();

// ---------------------------------------------------------------------------------------------------------------------
taskList.push((args, next) => {
	harness.section("TODAY'S SHAPE — no vectorCacheEntries; judgmentFillingSpend and four *Ops logs present");
	const storeFilePath = path.join(scratchDir, 'todayShaped.sqlite');
	buildTodayShapedStore({ storeFilePath }, (err) => {
		if (err) {
			next(err, args);
			return;
		}
		const tableNameList = new Database(storeFilePath, { readonly: true }).prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((oneRow) => oneRow.name);
		harness.ok('FIXTURE: the store has no vectorCacheEntries table, as the store of record has none', tableNameList.indexOf('vectorCacheEntries') === -1, tableNameList.join(', '));
		harness.ok(
			'FIXTURE: every table to be emptied or retained holds one seeded row',
			Object.values(rowCountByTableNameOf(storeFilePath, EMPTIED_TABLE_NAME_LIST.concat(RETAINED_TABLE_NAME_LIST))).every((oneCount) => oneCount === 1),
		);
		next('', { ...args, storeFilePath });
	});
});

taskList.push((args, next) => {
	const statusLineList = [];
	withStorePath({ storeFilePath: args.storeFilePath, statusLineList });
	actions.truncateStore((truncateErr, truncateOutcome) => {
		restoreGlobal();
		harness.accepts("-truncateStore succeeds on today's store shape", truncateErr ? [truncateErr] : []);
		const emptiedAfter = rowCountByTableNameOf(args.storeFilePath, EMPTIED_TABLE_NAME_LIST);
		const retainedAfter = rowCountByTableNameOf(args.storeFilePath, RETAINED_TABLE_NAME_LIST);
		harness.ok('  every registry truncate table is now empty, judgmentFillingSpend included', Object.values(emptiedAfter).every((oneCount) => oneCount === 0), JSON.stringify(emptiedAfter));
		harness.ok('  every retained *Ops log keeps its row', Object.values(retainedAfter).every((oneCount) => oneCount === 1), JSON.stringify(retainedAfter));

		const planLineIndex = statusLineList.findIndex((oneLine) => /will EMPTY/.test(oneLine));
		const backupLineIndex = statusLineList.findIndex((oneLine) => /backup written to/.test(oneLine));
		const planLine = statusLineList[planLineIndex] || '';
		harness.ok('  the plan is printed BEFORE the backup is written', planLineIndex !== -1 && backupLineIndex !== -1 && planLineIndex < backupLineIndex, statusLineList.join('\n'));
		harness.ok('  the plan names every emptied table with its count', EMPTIED_TABLE_NAME_LIST.every((oneTableName) => planLine.indexOf(`${oneTableName}=1`) !== -1), planLine);
		harness.ok('  the plan names every retained table with its count', RETAINED_TABLE_NAME_LIST.every((oneTableName) => planLine.indexOf(`${oneTableName}=1`) !== -1) && /RETAIN/.test(planLine), planLine);

		const outcome = truncateOutcome ? JSON.parse(truncateOutcome.resultText) : {};
		harness.equal('  the outcome lists exactly the emptied tables', JSON.stringify((outcome.tablesEmptied || []).slice().sort()), JSON.stringify(EMPTIED_TABLE_NAME_LIST.slice().sort()));
		harness.ok(
			'  and the verified backup still holds every emptied row',
			!!outcome.backupFilePath && Object.values(rowCountByTableNameOf(outcome.backupFilePath, EMPTIED_TABLE_NAME_LIST)).every((oneCount) => oneCount === 1),
			outcome.backupFilePath,
		);
		next('', args);
	});
});

// ---------------------------------------------------------------------------------------------------------------------
taskList.push((args, next) => {
	harness.section('A TABLE THE REGISTRY DOES NOT NAME — refused by name, before any write');
	const storeFilePath = path.join(scratchDir, 'withStranger.sqlite');
	buildTodayShapedStore({ storeFilePath }, (err) => {
		if (err) {
			next(err, args);
			return;
		}
		const addStranger = new Database(storeFilePath);
		addStranger.prepare(`CREATE TABLE ${STRANGER_TABLE_NAME} (strangerText TEXT)`).run();
		addStranger.prepare(`INSERT INTO ${STRANGER_TABLE_NAME} (strangerText) VALUES ('mine')`).run();
		addStranger.close();
		const backupCountBefore = backupFileNameListIn().length;
		withStorePath({ storeFilePath, statusLineList: [] });
		actions.truncateStore((strangerErr, strangerOutcome) => {
			restoreGlobal();
			harness.ok('a store with an undeclared table is REFUSED, with no outcome', !!strangerErr && !strangerOutcome, `err='${strangerErr}'`);
			harness.match('  refused BY NAME, naming the table', strangerErr || '', new RegExp(`${STRANGER_TABLE_NAME}`));
			const afterCounts = rowCountByTableNameOf(storeFilePath, EMPTIED_TABLE_NAME_LIST.concat(RETAINED_TABLE_NAME_LIST, [STRANGER_TABLE_NAME]));
			harness.ok('  NOTHING WAS EMPTIED', Object.values(afterCounts).every((oneCount) => oneCount === 1), JSON.stringify(afterCounts));
			harness.equal('  and no backup was written (the refusal comes before any write)', backupFileNameListIn().length, backupCountBefore);
			next('', args);
		});
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// THE ORDER HAZARD (pass 2 T0 3.2). [stores] names a scratch stand-in for the store of record. Each blank or swallowed
// flag below would, through the shared resolver, read as ABSENT and resolve to it; with the table list now right, that
// would empty it. The verb's own guard must refuse each by name before anything is read or written.
const BLANK_FLAG_CASE_LIST = [
	{ caseLabel: 'a blank --standardsDatabaseFilePath= as the LAST argument (the parser gives true)', givenValue: true },
	{ caseLabel: "a blank flag that SWALLOWED the next argument (['-truncateStore'])", givenValue: ['-truncateStore'] },
	{ caseLabel: "a blank flag that swallowed another flag (['--createStore=true'])", givenValue: ['--createStore=true'] },
	{ caseLabel: "an empty string on the stdin channel ([''])", givenValue: [''] },
	{ caseLabel: "a space on the stdin channel ([' '])", givenValue: [' '] },
	{ caseLabel: 'an empty list on the stdin channel ([])', givenValue: [] },
	{ caseLabel: 'a non-list string on the stdin channel', givenValue: '/some/path' },
];

taskList.push((args, next) => {
	harness.section('THE ORDER HAZARD — a blank or swallowed store flag never reaches the configured store');
	const configuredStoreFilePath = path.join(scratchDir, 'standInForStoreOfRecord.sqlite');
	buildTodayShapedStore({ storeFilePath: configuredStoreFilePath }, (err) => next(err, { ...args, configuredStoreFilePath }));
});

BLANK_FLAG_CASE_LIST.forEach((oneCase) => {
	taskList.push((args, next) => {
		const backupCountBefore = backupFileNameListIn().length;
		withStorePath({ statusLineList: [], storesConfig: { graphBuilderSupportFilePath: args.configuredStoreFilePath }, commandLineValues: { standardsDatabaseFilePath: oneCase.givenValue } });
		actions.truncateStore((blankErr, blankOutcome) => {
			restoreGlobal();
			harness.ok(`${oneCase.caseLabel}: REFUSED, no outcome`, !!blankErr && !blankOutcome, `err='${blankErr}'`);
			harness.match('  refused BY NAME, by this verb', blankErr || '', /-truncateStore: REFUSED — --standardsDatabaseFilePath is/);
			const afterCounts = rowCountByTableNameOf(args.configuredStoreFilePath, EMPTIED_TABLE_NAME_LIST);
			harness.ok('  the configured store keeps every row', Object.values(afterCounts).every((oneCount) => oneCount === 1), JSON.stringify(afterCounts));
			harness.equal('  and no backup was written', backupFileNameListIn().length, backupCountBefore);
			next('', args);
		});
	});
});

// CONTROL, and a pin of the narrow reading: an ABSENT flag still resolves from [stores], as before F-20. Whether the verb
// should refuse a configured store or require a confirmation is put to TQ (SINCERE_STATUETTE, 2026-11-21); change this
// case with that ruling.
taskList.push((args, next) => {
	withStorePath({ statusLineList: [], storesConfig: { graphBuilderSupportFilePath: args.configuredStoreFilePath }, commandLineValues: {} });
	actions.truncateStore((absentErr) => {
		restoreGlobal();
		harness.accepts('CONTROL: an ABSENT flag resolves the configured store and truncates it (unchanged; ruling pending)', absentErr ? [absentErr] : []);
		const afterCounts = rowCountByTableNameOf(args.configuredStoreFilePath, EMPTIED_TABLE_NAME_LIST);
		harness.ok('  and the configured store is emptied', Object.values(afterCounts).every((oneCount) => oneCount === 0), JSON.stringify(afterCounts));
		next('', args);
	});
});

pipeRunner(taskList.getList(), {}, (err) => {
	restoreGlobal();
	if (err) {
		harness.ok('the gate fixture ran to completion', false, err);
	}
	fs.rmSync(scratchDir, { recursive: true, force: true });
	harness.report();
});
