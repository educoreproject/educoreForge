'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// idsSource.js — the two CEDS IDS v14.0.0.0 files the `textRepair` layer reads, parsed to exactly what a repair needs
// (lane DES, 2026-10-12). PURE apart from the two reads.
//
//   readIdsSource({ ddlFilePath, populateFilePath }, callback(errString, { globalIdListByTableName, referenceRowList, skippedInsertList }))
//   referenceRowList = [{ tableName, code, valueByColumnName, lineNumberByColumnName, statementKindByColumnName }]
//
// A ROW IS WHAT THE SCRIPT LEAVES IN THE TABLE, not what its INSERT says. The script has three statement forms (measured):
// 16,814 plain `INSERT ... VALUES (...) END`; PART 1's `INSERT ... VALUES (...) ELSE IF @updateExisting = 1 UPDATE ...` (on
// a model database the INSERT runs, the guarded UPDATE does not); and PART 2's unconditional `UPDATE ... SET ... WHERE [Code]
// = '...'` (30), which REWRITES the Description or Definition of rows inserted earlier. So each column's value is the last
// one the executed statements set, and its line number is that statement's line: a repair cites the line that wrote it.
//
// ENCODINGS ARE A TRAP (lane INV): the DDL is UTF-8 and the populate script is Windows-1252; reading the populate script as
// UTF-8 would itself MANUFACTURE replacement characters. The DDL's table-level CEDS_GlobalId extended property ("000255" or
// a comma list) is what names the property a reference table enumerates. The SQL forms parsed are the ones these two files
// use (SSDT-style `@name = N'x'`, `INSERT INTO dbo.[Ref...](cols) VALUES (...) END`); a reference row whose column and value
// counts differ is refused by name rather than zipped short.

const fs = require('fs');

const EXTENDED_PROPERTY_PATTERN = /sp_addextendedproperty @name = N'([^']+)', @value = N'((?:[^']|'')*)', @level0type = N'SCHEMA', @level0name = N'([^']+)', @level1type = N'([^']+)', @level1name = N'([^']+)'(?:, @level2type = N'([^']+)', @level2name = N'([^']+)')?/g;
// two INSERT shapes: `VALUES (...)` (16,830) and, for a reference table carrying a foreign key to another reference table,
// `SELECT <literals>, [FkColumn] FROM dbo.<OtherRef> WHERE ...` (471); the FK column's value is not a literal and is kept as
// its token text. A third form exists only in comments ('INSERT INTO @OptionSetChange', a table variable) and is not a row.
const INSERT_PATTERN = /INSERT INTO dbo\.\[([^\]]+)\]\(([^)]*)\)\s*(?:VALUES \(([\s\S]*?)\)\s*(?=END\b|ELSE IF @updateExisting)|SELECT ([\s\S]*?)\s+FROM dbo\.\S+ WHERE [\s\S]*?\s*(?=END\b))/g;
const UPDATE_PATTERN = /UPDATE dbo\.\[([^\]]+)\]\s*SET ([\s\S]*?)\s*WHERE \[Code\] = '((?:[^']|'')*)'/g;
const GUARDED_UPDATE_PREFIX_PATTERN = /ELSE IF @updateExisting = 1(?:\s+BEGIN)?\s*$/;
// every INSERT is guarded by IF NOT EXISTS (SELECT 1 FROM dbo.[T] WHERE <condition>): a second INSERT with the SAME condition
// does nothing on execution (the script declares @updateExisting = 0), so the FIRST one is the row (measured: RefAllergyType
// '420140004' is inserted three times, as 'Allergy to alcohol', 'ethanol' and 'ethyl alcohol'; the table holds 'alcohol')
const INSERT_GUARD_PATTERN = /IF NOT EXISTS \(SELECT 1 FROM dbo\.\[([^\]]+)\]((?:[^()']|'(?:[^']|'')*')*)\)\s*(?:BEGIN\s*)?$/;
const ASSIGNMENT_PATTERN = /\[([^\]]+)\]\s*=\s*/y;

// sqlLiteralListOf — a VALUES list: N'..' / '..' strings ('' is an escaped quote), NULL, and bare tokens (numbers)
const sqlLiteralListOf = (valueText) => {
	const literalList = [];
	let position = 0;
	while (position < valueText.length) {
		const character = valueText[position];
		if (character === "'" || (character === 'N' && valueText[position + 1] === "'")) {
			let cursor = position + (character === 'N' ? 2 : 1);
			const pieceList = [];
			while (cursor < valueText.length) {
				if (valueText[cursor] === "'" && valueText[cursor + 1] === "'") {
					pieceList.push("'");
					cursor += 2;
					continue;
				}
				if (valueText[cursor] === "'") {
					break;
				}
				pieceList.push(valueText[cursor]);
				cursor++;
			}
			literalList.push(pieceList.join(''));
			position = cursor + 1;
		} else if (character === ',' || /\s/.test(character)) {
			position++;
		} else {
			const tokenMatch = /^[^,]+/.exec(valueText.slice(position));
			const tokenText = tokenMatch[0].trim();
			literalList.push(tokenText.toUpperCase() === 'NULL' ? null : tokenText);
			position += tokenMatch[0].length;
		}
	}
	return literalList;
};

// literalEndOf — the index just past one SQL literal starting at position (a quoted string with '' escapes, or a bare token)
const literalEndOf = (text, position) => {
	if (text[position] === "'" || (text[position] === 'N' && text[position + 1] === "'")) {
		let cursor = position + (text[position] === 'N' ? 2 : 1);
		while (cursor < text.length) {
			if (text[cursor] === "'" && text[cursor + 1] === "'") {
				cursor += 2;
				continue;
			}
			if (text[cursor] === "'") {
				return cursor + 1;
			}
			cursor++;
		}
		return cursor;
	}
	const tokenMatch = /^[^,]+/.exec(text.slice(position));
	return position + tokenMatch[0].length;
};

const readIdsSource = ({ ddlFilePath, populateFilePath }, callback) => {
	fs.readFile(ddlFilePath, (ddlError, ddlBytes) => {
		if (ddlError) {
			callback(`${moduleName}: cannot read ${ddlFilePath}: ${ddlError.message}`);
			return;
		}
		fs.readFile(populateFilePath, (populateError, populateBytes) => {
			if (populateError) {
				callback(`${moduleName}: cannot read ${populateFilePath}: ${populateError.message}`);
				return;
			}
			const ddlText = new TextDecoder('utf-8', { fatal: true }).decode(ddlBytes).replace(/\r\n/g, '\n');
			const populateText = new TextDecoder('windows-1252').decode(populateBytes).replace(/\r\n/g, '\n');
			const globalIdListByTableName = {};
			for (const propertyMatch of ddlText.matchAll(EXTENDED_PROPERTY_PATTERN)) {
				const [, propertyName, propertyValue, schemaName, , objectName, , subObjectName] = propertyMatch;
				if (propertyName === 'CEDS_GlobalId' && schemaName === 'dbo' && subObjectName === undefined) {
					globalIdListByTableName[objectName] = propertyValue.replace(/''/g, "'").split(',').map((oneId) => oneId.trim()).filter((oneId) => oneId !== '');
				}
			}
			const referenceRowList = [];
			const lineStartIndexList = [0];
			for (let characterIndex = 0; characterIndex < populateText.length; characterIndex++) {
				if (populateText[characterIndex] === '\n') {
					lineStartIndexList.push(characterIndex + 1);
				}
			}
			const lineNumberOfIndex = (characterIndex) => {
				let low = 0;
				let high = lineStartIndexList.length - 1;
				while (low < high) {
					const middle = Math.ceil((low + high) / 2);
					if (lineStartIndexList[middle] <= characterIndex) {
						low = middle;
					} else {
						high = middle - 1;
					}
				}
				return low + 1;
			};
			const rowListByTableAndCode = new Map();
			const seenGuardIdentitySet = new Set();
			const skippedInsertList = [];
			for (const insertMatch of populateText.matchAll(INSERT_PATTERN)) {
				const columnNameList = insertMatch[2].split(',').map((oneName) => oneName.trim().replace(/^\[|\]$/g, ''));
				const literalList = sqlLiteralListOf(insertMatch[3] !== undefined ? insertMatch[3] : insertMatch[4]);
				const lineNumber = lineNumberOfIndex(insertMatch.index);
				if (literalList.length !== columnNameList.length) {
					callback(`${moduleName}: ${populateFilePath} line ${lineNumber} (${insertMatch[1]}) names ${columnNameList.length} columns and supplies ${literalList.length} values`);
					return;
				}
				const valueByColumnName = columnNameList.reduce((soFar, columnName, columnIndex) => ({ ...soFar, [columnName]: literalList[columnIndex] }), {});
				const guardMatch = INSERT_GUARD_PATTERN.exec(populateText.slice(Math.max(0, insertMatch.index - 600), insertMatch.index));
				if (!guardMatch || guardMatch[1] !== insertMatch[1]) {
					callback(`${moduleName}: ${populateFilePath} line ${lineNumber} inserts into ${insertMatch[1]} with no IF NOT EXISTS guard on that table before it — the script's statement form has changed`);
					return;
				}
				const guardIdentity = `${insertMatch[1]}\u241f${guardMatch[2].trim()}`;
				if (seenGuardIdentitySet.has(guardIdentity)) {
					skippedInsertList.push({ tableName: insertMatch[1], code: valueByColumnName.Code, lineNumber });
					continue;
				}
				seenGuardIdentitySet.add(guardIdentity);
				const rowIdentity = `${insertMatch[1]}\u241f${valueByColumnName.Code}`;
				const row = { tableName: insertMatch[1], code: valueByColumnName.Code, valueByColumnName, lineNumberByColumnName: {}, statementKindByColumnName: {} };
				columnNameList.forEach((columnName) => {
					row.lineNumberByColumnName[columnName] = lineNumber;
					row.statementKindByColumnName[columnName] = 'insert';
				});
				(rowListByTableAndCode.get(rowIdentity) || rowListByTableAndCode.set(rowIdentity, []).get(rowIdentity)).push(row);
				referenceRowList.push(row);
			}
			for (const updateMatch of populateText.matchAll(UPDATE_PATTERN)) {
				if (GUARDED_UPDATE_PREFIX_PATTERN.test(populateText.slice(Math.max(0, updateMatch.index - 60), updateMatch.index))) {
					continue; // the @updateExisting branch: not executed on the model database the script populates
				}
				const lineNumber = lineNumberOfIndex(updateMatch.index);
				const code = updateMatch[3].replace(/''/g, "'");
				const matchedRowList = rowListByTableAndCode.get(`${updateMatch[1]}\u241f${code}`);
				if (!matchedRowList) {
					callback(`${moduleName}: ${populateFilePath} line ${lineNumber} updates ${updateMatch[1]} code ${JSON.stringify(code)}, which no INSERT created`);
					return;
				}
				const assignmentText = updateMatch[2];
				let position = 0;
				while (position < assignmentText.length) {
					if (/[\s,]/.test(assignmentText[position])) {
						position++;
						continue;
					}
					ASSIGNMENT_PATTERN.lastIndex = position;
					const assignmentMatch = ASSIGNMENT_PATTERN.exec(assignmentText);
					if (!assignmentMatch) {
						callback(`${moduleName}: ${populateFilePath} line ${lineNumber}: cannot read the SET list at ${JSON.stringify(assignmentText.slice(position, position + 40))}`);
						return;
					}
					position = ASSIGNMENT_PATTERN.lastIndex;
					const literalEnd = literalEndOf(assignmentText, position);
					const [literalValue] = sqlLiteralListOf(assignmentText.slice(position, literalEnd));
					matchedRowList.forEach((row) => {
						row.valueByColumnName[assignmentMatch[1]] = literalValue;
						row.lineNumberByColumnName[assignmentMatch[1]] = lineNumber;
						row.statementKindByColumnName[assignmentMatch[1]] = 'update';
					});
					position = literalEnd;
				}
			}
			callback('', { globalIdListByTableName, referenceRowList, skippedInsertList });
		});
	});
};

module.exports = { readIdsSource, sqlLiteralListOf };
