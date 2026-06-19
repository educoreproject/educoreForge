#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const qt = require('qtools-functional-library');

const Database = require('better-sqlite3');

const { pipeRunner, taskListPlus, mergeArgs, forwardArgs } = new require(
	'qtools-asynchronous-pipe-plus',
)();

const sqlString = require('sqlstring-sqlite');

const newRefId = require('../new-refid')({
	excludedChars: ['0', 'O', '1', 'l'],
	digits: 20,
});

// START OF moduleFunction() ============================================================

const moduleFunction = function ({ unused }) {
	const { xLog, getConfig, rawConfig, commandLineParameters } = process.global;
	const localConfig = getConfig(`${moduleName}`);

	// =====================================================================
	// HELPERS
	// =====================================================================

	const jsonToTsv = (jsonData) => {
		const allKeys = Array.from(
			jsonData.reduce((keys, obj) => {
				Object.keys(obj).forEach((key) => keys.add(key));
				return keys;
			}, new Set()),
		);

		const headers = allKeys.join('\t');
		const rows = jsonData.map((obj) =>
			allKeys.map((key) => obj[key] ?? '').join('\t'),
		);
		const tsvData = `${headers}\n${rows.join('\n')}`;

		return tsvData;
	};

	// =====================================================================
	// DB ACCESS FUNCTIONS
	// =====================================================================

	// -----
	// runStatementActual — execute a SQL statement (CREATE, INSERT, UPDATE, ALTER, etc.)

	const runStatementActual =
		(db, tableName, defaultOptions) =>
		(statement, options = {}, callback) => {
			if (typeof options == 'function') {
				callback = options;
				options = defaultOptions;
			}
			Object.assign(defaultOptions, options);

			const { suppressStatementLog, noTableNameOk } = options;

			if (!noTableNameOk && !statement.match(/<!tableName!>/)) {
				xLog.error(
					`SQL statement has no <!tableName!> substitution tag. This is not allowed. [runStatementActual]`,
				);
				if (typeof callback == 'function') {
					callback(
						`SQL statement has no <!tableName!> substitution tag. This is not allowed. [runStatementActual]`,
						{},
					);
					return;
				} else {
					return '';
				}
			}
			const finalStatement = statement.qtTemplateReplace({ tableName });
			suppressStatementLog || xLog.status(finalStatement);

			if (typeof callback == 'function') {
				try {
					db.exec(finalStatement);
					callback(null);
				} catch (err) {
					xLog.error(
						`${''.padEnd(50, '-')}\nSQL Error; ${err.toString()}\nBad Statement:\n\t${finalStatement}\n${''.padEnd(50, '-')}\n`,
					);
					callback(err.toString());
				}
			} else {
				db.exec(finalStatement);
			}
		};

	// =====================================================================
	// WORKING FUNCTIONS
	// =====================================================================

	// -----
	// getDataActual — execute a SELECT query and return rows

	const getDataActual =
		(db, tableName, defaultOptions) =>
		(statement, options = {}, callback) => {
			if (typeof options == 'function') {
				callback = options;
				options = defaultOptions;
			}
			Object.assign(defaultOptions, options);

			const { suppressStatementLog, noTableNameOk } = options;
			if (!noTableNameOk && !statement.match(/<!tableName!>/)) {
				xLog.error(
					`SQL statement has no <!tableName!> substitution tag. This is not allowed. [getDataActual]`,
				);
				if (typeof callback == 'function') {
					callback(
						`SQL statement has no <!tableName!> substitution tag. This is not allowed. [getDataActual]`,
						{},
					);
					return;
				} else {
					return '';
				}
			}
			const finalStatement = statement.qtTemplateReplace({ tableName });
			suppressStatementLog || xLog.status(finalStatement);

			if (typeof callback == 'function') {
				try {
					const stmt = db.prepare(finalStatement);
					const result = stmt.all();
					callback(null, result);
				} catch (err) {
					callback(err.toString(), []);
				}
			} else {
				const stmt = db.prepare(finalStatement);
				return stmt.all();
			}
		};

	// -----
	// getFieldNames — extract column names from CREATE TABLE statement

	const getFieldNames = (createStatement, showCreateTableDebug) => {
		const tmp = createStatement.qtGetSurePath('[0].sql', '');

		if (showCreateTableDebug) {
			console.dir(
				{ ['createStatement']: createStatement },
				{ showHidden: false, depth: 4, colors: true },
			);
		}

		if (!createStatement) {
			return [];
		}

		const fieldNames = createStatement
			.qtGetSurePath('[0].sql', '')
			.replace(/\t+/g, '')
			.replace(/\n+/g, ' ')
			.split(/,/)
			.map((item) => item.match(/\[(?<fieldName>.*)\]/))
			.filter((item) => item)
			.map((item) => item.qtGetSurePath('groups.fieldName'));

		return fieldNames;
	};

	// -----
	// saveListActual — save an array of records sequentially

	const saveListActual =
		(saveObject) =>
		(inArray, options = {}, callback) => {
			const taskList = new taskListPlus();
			const resultList = [];

			inArray.forEach((record) => {
				taskList.push((args, next) => {
					const localCallback = (err, result) => {
						resultList.push(result);
						next(err, args);
					};

					saveObject(record, options, localCallback);
				});
			});

			const initialData = typeof inData != 'undefined' ? inData : {};
			pipeRunner(taskList.getList(), initialData, (err, args) => {
				callback(err, resultList);
			});
		};

	// -----
	// saveObjectActual — upsert a single record (INSERT or UPDATE based on refId)

	const saveObjectActual = ({
		runStatement,
		getData,
		tableName,
		defaultOptions,
		helpers,
	}) => {
		let counter = 0;

		return (inObj, options = {}, callback) => {
			const { saveList } = helpers;

			if (Array.isArray(inObj)) {
				saveList(inObj, options, callback);
				return;
			}

			if (typeof options == 'function') {
				callback = options;
				options = defaultOptions;
			}
			Object.assign(defaultOptions, options);
			const { showProgress, showCreateTableDebug } = defaultOptions;
			let logIncrement = showProgress;

			const taskList = new taskListPlus();

			const cleanObj = {};
			Object.keys(inObj).forEach((keyName) => {
				if (
					['boolean', 'number', 'string', 'bigint'].includes(
						typeof inObj[keyName],
					)
				) {
					cleanObj[keyName] =
						typeof inObj[keyName] == 'string'
							? inObj[keyName].trim().replace(/\'/g, "''")
							: inObj[keyName];
				}
			});

			taskList.push((args, next) => {
				const { runStatement, tableName, cleanObj } = args;
				const localCallback = (err, createStatement) => {
					const existingFieldNames = getFieldNames(
						createStatement,
						showCreateTableDebug,
					);
					const incomingFieldNames = Object.keys(cleanObj);

					if (showCreateTableDebug) {
						console.log(`\n=-=============   existingFieldNames ${tableName} ========================= [sqlite-instance.js.moduleFunction]\n`);
						console.dir({ ['existingFieldNames']: existingFieldNames }, { showHidden: false, depth: 4, colors: true });
						console.log(`\n=-=============   incomingFieldNames  ${tableName} ========================= [sqlite-instance.js.moduleFunction]\n`);
						console.dir({ ['incomingFieldNames']: incomingFieldNames }, { showHidden: false, depth: 4, colors: true });
					}

					const addColumnStatements = incomingFieldNames
						.filter(
							(item) =>
								!existingFieldNames
									.map((item) => item.toLowerCase())
									.includes(item.toLowerCase()),
						)
						.map(
							(name) =>
								`ALTER TABLE <!tableName!> ADD COLUMN [${name}] TEXT;\n`,
						);

					next(err, { ...args, addColumnStatements });
				};

				getData(
					`SELECT sql FROM sqlite_master WHERE type='table' AND name='<!tableName!>';`,
					options,
					localCallback,
				);
			});

			taskList.push((args, next) => {
				const { runStatement, tableName, addColumnStatements } = args;
				const localCallback = (err) => {
					next(err, args);
				};

				if (!addColumnStatements || !addColumnStatements.length) {
					localCallback();
					return;
				}

				const statements = addColumnStatements.join('\n');
				xLog.status(
					`Adding ${addColumnStatements.length} new columns to ${tableName} in ${moduleName}`,
				);
				runStatement(statements, localCallback);
			});

			taskList.push((args, next) => {
				const { runStatement, tableName, cleanObj } = args;
				const localCallback = (err, existingRecords) => {
					next(err, { ...args, existingRecords });
				};

				getData(
					`SELECT * from '<!tableName!>' where [refId]='${cleanObj.refId}';`,
					options,
					localCallback,
				);
			});

			taskList.push((args, next) => {
				const {
					runStatement,
					tableName,
					addColumnStatements,
					cleanObj,
					sqlString,
					existingRecords,
				} = args;

				cleanObj.refId = cleanObj.refId ? cleanObj.refId : newRefId();

				const localCallback = (err) => {
					if (err) {
						errorList.push(err);
					}
					const refId = cleanObj.refId;
					next('', { ...args, refId });
				};

				if (existingRecords.length > 0) {
					const assignmentPairs = Object.keys(cleanObj)
						.map((name) => `[${name}]=${sqlString.escape(cleanObj[name])}`)
						.join(', ');

					runStatement(
						`UPDATE <!tableName!> set ${assignmentPairs}  where [refId]='${cleanObj.refId}';`,
						options,
						localCallback,
					);
				} else {
					const fieldNames = Object.keys(cleanObj)
						.reduce((result, item) => `${result}[${item}], `, '')
						.replace(/, $/, '');

					const valueList = Object.keys(cleanObj)
						.map((name) => sqlString.escape(cleanObj[name]))
						.join(', ');

					runStatement(
						`INSERT INTO <!tableName!> (${fieldNames}) VALUES (${valueList});`,
						options,
						localCallback,
					);
				}

				counter++;

				if (showProgress && counter % logIncrement === 0) {
					xLog.status(`Wrote ${counter} records into ${tableName}`);
				}
			});
			const errorList = [];
			const initialData = {
				runStatement,
				tableName,
				cleanObj,
				jsonToTsv,
				sqlString,
				errorList,
			};
			pipeRunner(taskList.getList(), initialData, (err, args) => {
				const { refId } = args;
				if (err) {
					xLog.error(err);
				}

				callback(err, refId);
			});
		};
	};

	// =====================================================================
	// TABLE OBJECT
	// =====================================================================

	// -----
	// initTable — create the table with standard columns (refId, createdAt, updatedAt)

	const initTable = (runStatement, options, callback) => {
		if (typeof options == 'function') {
			callback = options;
			options = defaultOptions;
		}
		Object.assign(defaultOptions, options);

		const statement = `
			CREATE TABLE IF NOT EXISTS <!tableName!> (
				[refId] TEXT PRIMARY KEY,
				[createdAt] TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				[updatedAt] TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TRIGGER IF NOT EXISTS <!tableName!>UpdateTimestamp
				AFTER UPDATE ON <!tableName!>
				FOR EACH ROW
				BEGIN
				  UPDATE <!tableName!> SET [updatedAt] = CURRENT_TIMESTAMP;
				END;
			/* CREATE UNIQUE INDEX IF NOT EXISTS idx_<!tableName!>_refId ON <!tableName!>(refId)*/ /* instance */;`;
		runStatement(statement, options, callback);
	};

	// -----
	// getTableActual — create or access a table and return its API

	const getTableActual = (db, defaultOptions) => (owner, options, callback) => {
		if (typeof options == 'function') {
			callback = options;
			options = defaultOptions;
		}
		Object.assign(defaultOptions, options);

		const tableName = owner.replace(/\W/g, '_');

		const runStatement = runStatementActual(db, tableName, defaultOptions);
		const getData = getDataActual(db, tableName, defaultOptions);

		const helpers = {};
		const saveObject = saveObjectActual({
			runStatement,
			getData,
			tableName,
			defaultOptions,
			helpers,
		});
		helpers.saveList = saveListActual(saveObject);

		const localCallback = (err) => {
			const dbTable = { getData, saveObject, runStatement };
			callback(err, dbTable);
		};

		initTable(runStatement, options, localCallback);
	};

	// =====================================================================
	// CHECK TABLE EXISTS
	// =====================================================================

	const checkTableExistsActual = (db) => (tableName, callback) => {
		const query = "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?";

		try {
			const result = db.prepare(query).get(tableName);
			const exists = result && result.count > 0;

			if (callback) {
				callback(null, exists);
			} else {
				return exists;
			}
		} catch (err) {
			xLog.error(`Error checking table existence for ${tableName}: ${err.toString()}`);
			if (callback) {
				callback(err.toString(), false);
			} else {
				return false;
			}
		}
	};

	// =====================================================================
	// INITIALIZE
	// =====================================================================

	const defaultOptions = {
		suppressStatementLog: true,
		showCreateTableDebug: false,
		noTableNameOk: false,
	};

	const initDatabaseInstance = (dbFilePath, callback) => {
		const db = new Database(dbFilePath);
		db.pragma('journal_mode = WAL');
		const getTable = getTableActual(db, defaultOptions);
		const checkTableExists = checkTableExistsActual(db);

		callback('', { getTable, checkTableExists, jsonToTsv, accessPoints: {} });
	};

	return { initDatabaseInstance };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction;
