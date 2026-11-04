#!/usr/bin/env node
'use strict';

// test-uriKindTable.js — gate G1 of cardUriAnswers-110426: every kind in uriScheme.json, through the real resolver over the real store. A real URI answers 200 with its named
// fields; a URI naming nothing answers 404 by name. A kind added to the scheme with no row in uriKindTable.js fails, with or without a store. Reads the store read-only.
// The store is uriContractFilePath if given, else the dataStores directory beside this checkout; absent, the table's coverage still runs and the store part says it was skipped.
// Run: node lib/edc-uri/test/test-uriKindTable.js [--uriContractFilePath=<path>]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- every edc: kind, a real URI and one naming nothing, through the real resolver

SYNOPSIS
     ${moduleName} [--uriContractFilePath=<path>] [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const uriContractLib = require('../../uri-contract/uriContract');
const Database = require('better-sqlite3');
const { resolveEdcUri } = require('../stubResolver');
const edcUri = require('../edcUri');
const { URI_KIND_ROW_LIST } = require('./uriKindTable');

const RELATIONSHIP_BLOCK_KIND = 'relationship';
const MODEL_READABLE_BYTE_BOUND = 20000; // what a model can read in one answer, as the standards query's own size gate holds
const givenFilePath = (process.global.commandLineParameters.values.uriContractFilePath || [])[0];
const CHECKOUT_RELATIVE_STORE_LIST = [['..', '..', '..', '..', '..', 'dataStores'], ['..', '..', '..', '..', '..', '..', 'dataStores']].map((relativeList) => path.join(__dirname, ...relativeList, 'uriContract', 'uriContract.sqlite'));
const uriContractFilePath = givenFilePath || CHECKOUT_RELATIVE_STORE_LIST.find((oneFilePath) => fs.existsSync(oneFilePath));

harness.section('every kind in the scheme has a row, and every row a kind');
const rowKindList = URI_KIND_ROW_LIST.map((oneRow) => oneRow.kind);
harness.equal('no kind of the scheme lacks a row', JSON.stringify(edcUri.KIND_LIST.filter((oneKind) => !rowKindList.includes(oneKind))), '[]');
harness.equal('no row names a kind the scheme lacks', JSON.stringify(rowKindList.filter((oneKind) => !edcUri.KIND_LIST.includes(oneKind))), '[]');
harness.equal('no kind has two rows', rowKindList.length, new Set(rowKindList).size);
URI_KIND_ROW_LIST.forEach((oneRow) => {
	harness.ok(`${oneRow.kind}: the row says what absence answers, or why it has none`, oneRow.cannotBeAbsent !== undefined || (oneRow.absentPath !== undefined && oneRow.absentAnswersRefusal instanceof RegExp));
	harness.equal(`${oneRow.kind}: the real path parses as this kind`, edcUri.parse(`${edcUri.URI_SCHEME.baseIri}${oneRow.realPath}`).kind, oneRow.kind);
	if (oneRow.absentPath !== undefined) {
		harness.equal(`${oneRow.kind}: the absent path parses as this kind`, edcUri.parse(`${edcUri.URI_SCHEME.baseIri}${oneRow.absentPath}`).kind, oneRow.kind);
	}
});

if (uriContractFilePath === undefined) {
	harness.ok('the store part is SKIPPED, by name: no uriContract.sqlite beside this checkout and no --uriContractFilePath given', true);
	harness.report();
	return;
}

const opened = uriContractLib.uriContractReaderFor({ uriContractFilePath });
const loaded = opened.error ? opened : opened.uriContract.loadRegistry();
if (loaded.error) {
	harness.ok(`the store opens: ${loaded.error}`, false);
	harness.report();
	return;
}
// a question reads its manifest's relationship blocks and ignores the rest, whose 476 MB base would pass any heap: the blocks it would ignore are answered with their kind alone, as the API's child does (educore forgeAdapter.readerForRequest)
const blockKindStatement = new Database(uriContractFilePath, { readonly: true, fileMustExist: true }).prepare('SELECT kind FROM schemaBlocks WHERE refId = ?');
const uriContractReader = {
	...opened.uriContractReader,
	schemaBlockFor: (schemaBlockRefId, done) => {
		const blockKindRow = blockKindStatement.get(schemaBlockRefId);
		if (blockKindRow !== undefined && blockKindRow.kind !== RELATIONSHIP_BLOCK_KIND) {
			done('', { schemaBlockRefId, blockKind: blockKindRow.kind, subject: null, version: null, text: '' });
			return;
		}
		opened.uriContractReader.schemaBlockFor(schemaBlockRefId, done);
	},
};
const resolve = (requestPath, done) => resolveEdcUri({ uriOrPath: `/EDUcore/${requestPath}`, registry: loaded.registry, uriContractReader }, (resolveError, resolved) => done(resolveError ? { httpStatus: 500, body: { error: resolveError } } : resolved));

// every page of every card anything maps to stays small enough for a model to read
const mappedMeaningIriList = new Database(uriContractFilePath, { readonly: true, fileMustExist: true }).prepare('SELECT DISTINCT meaningIri FROM derivedAnswerEdges ORDER BY meaningIri').all().map((oneRow) => oneRow.meaningIri);
const answerByteCountOf = (resolved) => Buffer.byteLength(`${JSON.stringify(resolved.body, null, 2)}\n`);
const runCardSizes = (cardIndex, largest) => {
	if (cardIndex >= mappedMeaningIriList.length) {
		harness.ok(`every page of ${mappedMeaningIriList.length} mapped cards is within ${MODEL_READABLE_BYTE_BOUND} bytes (largest ${largest.byteCount})`, largest.byteCount <= MODEL_READABLE_BYTE_BOUND, largest.requestPath);
		harness.report();
		return;
	}
	const cardPath = mappedMeaningIriList[cardIndex].slice(edcUri.URI_SCHEME.baseIri.length);
	const runPage = (pageNumber, largestSoFar) => resolve(`${cardPath}?page=${pageNumber}`, (resolved) => {
		const byteCount = answerByteCountOf(resolved);
		const largestNow = byteCount > largestSoFar.byteCount ? { byteCount, requestPath: `${cardPath}?page=${pageNumber}` } : largestSoFar;
		if (resolved.body.next) {
			runPage(pageNumber + 1, largestNow);
			return;
		}
		setImmediate(() => runCardSizes(cardIndex + 1, largestNow));
	});
	runPage(1, largest);
};

const runRow = (rowIndex) => {
	if (rowIndex >= URI_KIND_ROW_LIST.length) {
		runCardSizes(0, { byteCount: 0 });
		return;
	}
	const oneRow = URI_KIND_ROW_LIST[rowIndex];
	if (rowIndex === 0) {
		harness.section(`every kind, through the real resolver, over ${uriContractFilePath}`);
	}
	resolve(oneRow.realPath, (realAnswer) => {
		harness.equal(`${oneRow.kind}: real answers 200`, realAnswer.httpStatus, 200);
		const absentFieldList = oneRow.realFieldList.filter((oneField) => realAnswer.body[oneField] === undefined);
		harness.equal(`${oneRow.kind}: real carries its named fields`, JSON.stringify(absentFieldList), '[]');
		harness.equal(`${oneRow.kind}: real says what kind it is`, realAnswer.body.kind, oneRow.kind);
		if (oneRow.absentPath === undefined) {
			runRow(rowIndex + 1);
			return;
		}
		resolve(oneRow.absentPath, (absentAnswer) => {
			harness.equal(`${oneRow.kind}: a URI naming nothing answers 404`, absentAnswer.httpStatus, 404);
			harness.match(`${oneRow.kind}: and says why, by name`, String(absentAnswer.body.error), oneRow.absentAnswersRefusal);
			runRow(rowIndex + 1);
		});
	});
};
runRow(0);
