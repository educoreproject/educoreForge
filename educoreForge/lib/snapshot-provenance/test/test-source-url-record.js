#!/usr/bin/env node
'use strict';

// test-source-url-record.js — the sourceUrl lines of a snapshot's standardSourceLocation (WORKORDER-sourceUrls-101526).
//
// Pure, apart from reading the committed forge snapshots in the last section: no network, no docker, no database.
// Proves: a file with no sourceUrl lines records no address (every field null); each relation is read with its own
// wording; a half-stated relation, an unknown relation, a non-https address, an unknown or doubled sourceUrl line are
// refused by name; the writer's lines read back to the same record; every committed snapshot reads cleanly, and each
// PESC release's committed lines are exactly what releaseSourceUrlTable.json writes.
//
// Run: node lib/snapshot-provenance/test/test-source-url-record.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the sourceUrl lines of standardSourceLocation, read and written

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const sourceUrlRecordLib = require('../source-url-record');
const { releaseSourceUrlFor } = require('../../pesc-release-forge/releaseSourceUrl');

const FORGES_DIR_PATH = path.join(__dirname, '..', '..', '..', 'forges');
const recordOf = (provenanceText) => sourceUrlRecordLib.sourceUrlRecordOfText({ provenanceText, describedAs: 'fixture' });
const linesOf = (fieldValueByName) =>
	Object.keys(fieldValueByName)
		.map((fieldName) => `${fieldName}: ${fieldValueByName[fieldName]}\n`)
		.join('');
const COMMON_LINE_TEXT = 'standard: forge-fixture\npublishedVersion: 1.0.0\nupstreamUrl: unknown (fixture)\n';
const VERIFICATION_TEXT = '2026-10-15, fixture';

// -----
harness.section('a file with no sourceUrl lines records no address');
{
	const read = recordOf(COMMON_LINE_TEXT);
	harness.ok('it is not refused', !read.refusalMessage, read.refusalMessage);
	const recordFieldNameList = ['sourceUrl', 'sourceUrlRelation', 'sourceUrlRelationText', 'sourceUrlPage', 'sourceUrlNote', 'sourceUrlVerification'];
	harness.equal('every field is present', Object.keys(read.sourceUrlRecord).sort().join(','), recordFieldNameList.slice().sort().join(','));
	harness.ok('every field is null', recordFieldNameList.every((fieldName) => read.sourceUrlRecord[fieldName] === null), JSON.stringify(read.sourceUrlRecord));
	harness.ok('the not-recorded wording is stated, not a publisher home page', /not recorded/.test(sourceUrlRecordLib.NOT_RECORDED_TEXT) && !/https?:/.test(sourceUrlRecordLib.NOT_RECORDED_TEXT), sourceUrlRecordLib.NOT_RECORDED_TEXT);
}

// -----
harness.section('each relation is read, with its own wording');
{
	const caseList = [
		{ relationName: 'downloadedFrom', displayText: 'Downloaded from', extra: {} },
		{ relationName: 'publishedOn', displayText: 'Published on', extra: {} },
		{ relationName: 'derivedFrom', displayText: 'Derived from', extra: { sourceUrlNote: 'flattened here' } },
		{ relationName: 'republishedAs', displayText: 'Re-published by the publisher as', extra: { sourceUrlPage: 'https://example.org/page/', sourceUrlNote: 'comments differ' } },
	];
	harness.equal('the table holds exactly these relations', Object.keys(sourceUrlRecordLib.SOURCE_URL_RELATION_BY_NAME).sort().join(','), caseList.map((oneCase) => oneCase.relationName).sort().join(','));
	caseList.forEach((oneCase) => {
		const read = recordOf(COMMON_LINE_TEXT + linesOf({ sourceUrl: 'https://example.org/file.zip', sourceUrlRelation: oneCase.relationName, ...oneCase.extra, sourceUrlVerification: VERIFICATION_TEXT }));
		harness.ok(`${oneCase.relationName}: read`, !read.refusalMessage, read.refusalMessage);
		if (read.sourceUrlRecord) {
			harness.equal(`${oneCase.relationName}: worded "${oneCase.displayText}"`, read.sourceUrlRecord.sourceUrlRelationText, oneCase.displayText);
			harness.equal(`${oneCase.relationName}: the address`, read.sourceUrlRecord.sourceUrl, 'https://example.org/file.zip');
			harness.equal(`${oneCase.relationName}: the note, or null`, read.sourceUrlRecord.sourceUrlNote, oneCase.extra.sourceUrlNote || null);
			harness.equal(`${oneCase.relationName}: the page, or null`, read.sourceUrlRecord.sourceUrlPage, oneCase.extra.sourceUrlPage || null);
		}
	});
	const wordingList = caseList.map((oneCase) => sourceUrlRecordLib.SOURCE_URL_RELATION_BY_NAME[oneCase.relationName].displayText);
	harness.equal('no two relations share a wording', new Set(wordingList).size, wordingList.length);
}

// -----
harness.section('refused by name');
{
	const refusalCaseList = [
		{ label: 'an address with no relation', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /states sourceUrl, sourceUrlVerification but not sourceUrlRelation/ },
		{ label: 'a relation with no address', text: linesOf({ sourceUrlRelation: 'publishedOn', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /but not sourceUrl\b/ },
		{ label: 'an address with no verification', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'publishedOn' }), refusalRe: /but not sourceUrlVerification/ },
		{ label: 'republishedAs without its page', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'republishedAs', sourceUrlNote: 'n', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /but not sourceUrlPage/ },
		{ label: 'republishedAs without its caveat', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'republishedAs', sourceUrlPage: 'https://example.org/p', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /but not sourceUrlNote/ },
		{ label: 'derivedFrom without its caveat', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'derivedFrom', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /but not sourceUrlNote/ },
		{ label: 'an unknown relation', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'foundNear', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /names sourceUrlRelation 'foundNear'/ },
		{ label: 'an address that is not https', text: linesOf({ sourceUrl: 'http://example.org/a', sourceUrlRelation: 'publishedOn', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /gives sourceUrl 'http:\/\/example.org\/a'/ },
		{ label: 'a page that is not an address', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'publishedOn', sourceUrlPage: 'the PESC page', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /gives sourceUrlPage 'the PESC page'/ },
		{ label: 'an unknown sourceUrl line (a typo)', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'publishedOn', sourceUrlNotes: 'x', sourceUrlVerification: VERIFICATION_TEXT }), refusalRe: /an unknown line 'sourceUrlNotes'/ },
		{ label: 'a sourceUrl line given twice', text: linesOf({ sourceUrl: 'https://example.org/a', sourceUrlRelation: 'publishedOn', sourceUrlVerification: VERIFICATION_TEXT }) + 'sourceUrl: https://example.org/b\n', refusalRe: /'sourceUrl' twice/ },
	];
	refusalCaseList.forEach((oneCase) => {
		const read = recordOf(COMMON_LINE_TEXT + oneCase.text);
		harness.ok(`${oneCase.label}: refused`, Boolean(read.refusalMessage) && !read.sourceUrlRecord, JSON.stringify(read));
		harness.match(`${oneCase.label}: by name`, read.refusalMessage || '', oneCase.refusalRe);
	});
	const missingRead = sourceUrlRecordLib.readSourceUrlRecord({ snapshotDirPath: path.join(__dirname, 'no-such-snapshot') });
	harness.match('a snapshot with no standardSourceLocation: refused', missingRead.refusalMessage || '', /standardSourceLocation does not exist/);
}

// -----
harness.section('the writer: its lines read back to the same record, and it never writes what the reader refuses');
{
	const sourceUrlRow = { sourceUrl: 'https://example.org/z.zip', sourceUrlRelation: 'republishedAs', sourceUrlPage: 'https://example.org/', sourceUrlNote: 'differs in comments only', sourceUrlVerification: VERIFICATION_TEXT };
	const written = sourceUrlRecordLib.sourceUrlLineTextFor({ sourceUrlRow, describedAs: 'row' });
	harness.ok('written', !written.refusalMessage, written.refusalMessage);
	const readBack = recordOf(COMMON_LINE_TEXT + (written.sourceUrlLineText || ''));
	harness.ok('read back field for field', readBack.sourceUrlRecord && ['sourceUrl', 'sourceUrlRelation', 'sourceUrlPage', 'sourceUrlNote', 'sourceUrlVerification'].every((fieldName) => readBack.sourceUrlRecord[fieldName] === sourceUrlRow[fieldName]), JSON.stringify(readBack));
	harness.match('a half-stated row is refused before it is written', sourceUrlRecordLib.sourceUrlLineTextFor({ sourceUrlRow: { ...sourceUrlRow, sourceUrlPage: undefined }, describedAs: 'row' }).refusalMessage || '', /but not sourceUrlPage/);
	harness.match('a value with a line break is refused', sourceUrlRecordLib.sourceUrlLineTextFor({ sourceUrlRow: { ...sourceUrlRow, sourceUrlNote: 'one\nsourceUrl: https://evil.example/' }, describedAs: 'row' }).refusalMessage || '', /line break/);
	harness.match('a PESC release with no table row is refused by name', releaseSourceUrlFor({ releaseName: 'NoSuchRelease_v9.9.9' }).refusalMessage || '', /release 'NoSuchRelease_v9\.9\.9' has no row in releaseSourceUrlTable\.json/);
}

// -----
harness.section('the committed snapshots');
{
	const expectedRelationByBundle = {
		ceds: 'downloadedFrom',
		pescdocumentrequest1v0v0: 'downloadedFrom',
		pescdocumentresponse1v0v0: 'downloadedFrom',
		pesccollegetranscript1v7v0: 'publishedOn',
		pescacademiceportfolio1v0v0: 'publishedOn',
		pesclearningrecord1v0v0: 'publishedOn',
		pesctestscorereport1v1v0: 'publishedOn',
		pesccollegetranscript1v8v0: 'republishedAs',
		peschighschooltranscript1v6v0: 'republishedAs',
		pesc260805: 'derivedFrom',
		sif260928: 'derivedFrom',
		edfi: null,
	};
	Object.keys(expectedRelationByBundle).forEach((bundleName) => {
		const snapshotContainerPath = path.join(FORGES_DIR_PATH, bundleName, 'assets', 'standardSourceData');
		const snapshotKeyList = fs.readdirSync(snapshotContainerPath).filter((oneName) => fs.existsSync(path.join(snapshotContainerPath, oneName, sourceUrlRecordLib.PROVENANCE_FILE_NAME)));
		const pinnedSnapshotKey = snapshotKeyList[snapshotKeyList.length - 1];
		const read = sourceUrlRecordLib.readSourceUrlRecord({ snapshotDirPath: path.join(snapshotContainerPath, pinnedSnapshotKey) });
		harness.ok(`${bundleName}/${pinnedSnapshotKey}: reads cleanly`, !read.refusalMessage, read.refusalMessage);
		harness.equal(`${bundleName}: relation ${expectedRelationByBundle[bundleName]}`, read.sourceUrlRecord && read.sourceUrlRecord.sourceUrlRelation, expectedRelationByBundle[bundleName]);
		if (read.sourceUrlRecord && read.sourceUrlRecord.sourceUrl) {
			harness.ok(`${bundleName}: never a CDN address`, !/nebula\.wsimg\.com/.test(read.sourceUrlRecord.sourceUrl), read.sourceUrlRecord.sourceUrl);
		}
	});
	fs.readdirSync(FORGES_DIR_PATH)
		.filter((oneName) => /^pesc[a-z]+\d+v\d+v\d+$/.test(oneName))
		.forEach((bundleName) => {
			const snapshotDirPath = path.join(FORGES_DIR_PATH, bundleName, 'assets', 'standardSourceData', '01');
			const releaseName = JSON.parse(fs.readFileSync(path.join(snapshotDirPath, 'releaseManifestEntry.json'), 'utf8')).releaseEntry.releaseName;
			const lookup = releaseSourceUrlFor({ releaseName });
			const committedText = fs.readFileSync(path.join(snapshotDirPath, sourceUrlRecordLib.PROVENANCE_FILE_NAME), 'utf8');
			harness.ok(`${bundleName}: the committed file carries exactly the table's lines`, Boolean(lookup.releaseSourceUrl) && committedText.includes(`upstreamUrl: ${lookup.releaseSourceUrl.upstreamUrlText}\n${lookup.releaseSourceUrl.sourceUrlLineText}copiedFrom:`), lookup.refusalMessage);
		});
}

harness.report();
