'use strict';

//START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ tsvFilePath }) => {
		const fs = require('fs');
		const { xLog } = process.global;

		//the export's literal column header, per README_PROVENANCE.md. The audit refuses
		//if the file does not present exactly this, rather than guessing column positions.
		const expectedHeaderColumnList = [
			'Name',
			'Mandatory',
			'Characteristics',
			'Type',
			'Description',
			'XPath',
			'CEDS ID',
			'Format',
		];

		const sectionDelimiterPattern = /^(.+): Table (\d+)$/;

		// --------------------------------------------------------------------------
		// readRowInventory(): the TSV half of the pathInventoryProducer interface.
		//   returns { rowList, tableNameList, headerRowCount, sectionCount }
		//   rowList entries: { rowXpath, fieldName, mandatoryFlag, characteristics,
		//                      fieldType, tableName, sourceLineNumber }
		// --------------------------------------------------------------------------
		const readRowInventory = (callback) => {
			if (!fs.existsSync(tsvFilePath)) {
				callback(
					`[${moduleName}] the TSV export was not found at '${tsvFilePath}'. There is no alternative location; supply the correct path.`,
				);
				return;
			}

			const fileText = fs.readFileSync(tsvFilePath, 'utf8');

			//The snapshot is CRLF-terminated on all 16,100 lines. The carriage return
			//is line-ending grammar, not cell content, and is removed at the line
			//level so that a '$'-anchored section match and a last-column value are
			//both read correctly.
			const lineList = fileText.split('\n').map((lineText) =>
				lineText.endsWith('\r') ? lineText.slice(0, -1) : lineText,
			);

			const rowList = [];
			const tableNameList = [];
			const malformedLineList = [];
			let headerRowCount = 0;
			let currentTableName = '';

			lineList.forEach((lineText, lineIndex) => {
				const sourceLineNumber = lineIndex + 1;

				if (lineText.trim() === '') {
					return;
				}

				const sectionMatch = lineText.match(sectionDelimiterPattern);
				if (sectionMatch) {
					currentTableName = sectionMatch[1];
					tableNameList.push(currentTableName);
					return;
				}

				const cellList = lineText.split('\t');

				//the literal header row, recognized as grammar and not minted as a row
				if (cellList[0] === 'Name' && cellList[5] === 'XPath') {
					const headerMatches = expectedHeaderColumnList.every(
						(columnName, columnIndex) =>
							(cellList[columnIndex] || '').trim() === columnName,
					);
					if (!headerMatches) {
						malformedLineList.push({
							sourceLineNumber,
							reason: `header row does not match the declared column set; got [${cellList.join(', ')}]`,
						});
						return;
					}
					headerRowCount = headerRowCount + 1;
					return;
				}

				if (currentTableName === '') {
					malformedLineList.push({
						sourceLineNumber,
						reason: 'data row appeared before any section delimiter',
					});
					return;
				}

				//An absent trailing cell is legitimately optional: Mandatory, CEDS ID and
				//Format are blank on most rows and the export simply stops emitting tabs.
				//Reading an absent optional cell as empty is the documented behavior for
				//those columns. XPath is NOT optional and is validated below.
				const rowXpath = (cellList[5] || '').trim();
				if (rowXpath === '') {
					malformedLineList.push({
						sourceLineNumber,
						reason: `row has an empty XPath cell; first cell was '${(cellList[0] || '').trim()}'`,
					});
					return;
				}

				//The XPath column is absolute by the export's own grammar. A relative or
				//otherwise malformed path is refused by name here rather than being
				//coerced downstream, where ancestor derivation would either throw out of
				//the pipeline or, worse, silently mis-root the path.
				if (rowXpath.charAt(0) !== '/') {
					malformedLineList.push({
						sourceLineNumber,
						reason: `XPath '${rowXpath}' does not begin with '/'; the export's XPath column is absolute and a relative path is not interpretable`,
					});
					return;
				}

				rowList.push({
					rowXpath,
					fieldName: (cellList[0] || '').trim(),
					mandatoryFlag: (cellList[1] || '').trim(),
					characteristics: (cellList[2] || '').trim(),
					fieldType: (cellList[3] || '').trim(),
					tableName: currentTableName,
					sourceLineNumber,
				});
			});

			//A malformed line is never skipped silently. It is surfaced with its line
			//number so a reader can check the claim against the bytes.
			if (malformedLineList.length) {
				xLog.status(
					`[${moduleName}] ${malformedLineList.length} line(s) could not be read as rows or grammar; they are reported, not discarded:`,
				);
				malformedLineList.slice(0, 20).forEach((item) => {
					xLog.status(
						`[${moduleName}]   line ${item.sourceLineNumber}: ${item.reason}`,
					);
				});
			}

			callback('', {
				rowList,
				tableNameList,
				headerRowCount,
				sectionCount: tableNameList.length,
				malformedLineList,
			});
		};

		return { readRowInventory };
	};

//END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName: 'tsvRowInventory' });
