'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// releaseSourceUrl.js — a release's row of releaseSourceUrlTable.json, as the scaffold tool writes it into the release's
// standardSourceLocation (WORKORDER-sourceUrls-101526).
//
//   releaseSourceUrlFor({ releaseName }) -> { releaseSourceUrl: { upstreamUrlText, sourceUrlLineText } } | { refusalMessage }
//
// upstreamUrlText is the rest of the file's upstreamUrl line; sourceUrlLineText is the sourceUrl lines ('' when the row
// records no address). A release with no row, or a row that states half a relation, is refused by name: the table, not
// this module, decides what a release's provenance says.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { parseJsonText } = require('./jsonText');
const sourceUrlRecordLib = require(path.join(__dirname, '..', 'snapshot-provenance', 'source-url-record'));

const SOURCE_URL_TABLE_PATH = path.join(__dirname, 'releaseSourceUrlTable.json');
const PUBLISHER_TEXT = 'Postsecondary Electronic Standards Council, https://www.pesc.org';
const UPSTREAM_URL_TEXT_BY_RECORDING = Object.freeze({
	recorded: `recorded on the sourceUrl lines below (publisher: ${PUBLISHER_TEXT}; a release is our closure of PESC files, never a PESC artifact, so those lines say where PESC serves these files and how its bytes relate to ours)`,
	notRecorded: `unknown (publisher: ${PUBLISHER_TEXT}; a release is our closure of PESC files, never a PESC artifact, and has no URL of its own)`,
});

const refusalOf = (what, where) => refuse.byName({ moduleName, what, where }).message;

const releaseSourceUrlFor = ({ releaseName }) => {
	const parsedTable = parseJsonText(fs.readFileSync(SOURCE_URL_TABLE_PATH, 'utf8'));
	if (parsedTable.error || parsedTable.value.sourceUrlByReleaseName === null || typeof parsedTable.value.sourceUrlByReleaseName !== 'object') {
		return { refusalMessage: refusalOf(`${SOURCE_URL_TABLE_PATH} is not a source URL table (${parsedTable.error || 'no sourceUrlByReleaseName'})`, 'the table is JSON: { tableNote, sourceUrlByReleaseName: { <releaseName>: { sourceUrl, sourceUrlRelation, ... } } }') };
	}
	const sourceUrlRow = parsedTable.value.sourceUrlByReleaseName[releaseName];
	if (sourceUrlRow === undefined || sourceUrlRow === null || typeof sourceUrlRow !== 'object') {
		return { refusalMessage: refusalOf(`release '${releaseName}' has no row in ${path.basename(SOURCE_URL_TABLE_PATH)}`, 'every release the library forges says where its files came from, or says (sourceUrl null, notRecordedReason) that nobody recorded it; add the row deliberately') };
	}
	if (sourceUrlRow.sourceUrl === null) {
		if (typeof sourceUrlRow.notRecordedReason !== 'string' || sourceUrlRow.notRecordedReason.trim() === '') {
			return { refusalMessage: refusalOf(`release '${releaseName}' records sourceUrl null with no notRecordedReason`, 'a row without an address says why there is none') };
		}
		return { releaseSourceUrl: { upstreamUrlText: UPSTREAM_URL_TEXT_BY_RECORDING.notRecorded, sourceUrlLineText: '' } };
	}
	const written = sourceUrlRecordLib.sourceUrlLineTextFor({ sourceUrlRow, describedAs: `${path.basename(SOURCE_URL_TABLE_PATH)} row '${releaseName}'` });
	if (written.refusalMessage) {
		return written;
	}
	return { releaseSourceUrl: { upstreamUrlText: UPSTREAM_URL_TEXT_BY_RECORDING.recorded, sourceUrlLineText: written.sourceUrlLineText } };
};

module.exports = { releaseSourceUrlFor, SOURCE_URL_TABLE_PATH, moduleName };
