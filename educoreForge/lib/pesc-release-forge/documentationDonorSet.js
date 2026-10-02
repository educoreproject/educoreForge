'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// documentationDonorSet.js — phase F-B: which later-edition files a release borrows text from, and
// loader 3 of the PESC release forge, `pescDocumentationDonorSet` (DESIGN-pescForge.md §2.7).
//
//   donorFileListFor({ releaseName })           → the release's donor file names (documentationDonorTable.json)
//   donorSourceInputListFor({ releaseName })    → the forge declaration's additionalSourceInputList rows
//   loadDocumentationDonorSet({ sourcePath, additionalSourceInputPathByName }, callback)
//     → callback('', { donorArtifactList, donorRelativePathList }) | callback(refusalMessage)
//
// The table has a row for every release; a release absent from it is refused by name. The donors sit
// in the snapshot's DONOR_FOLDER_NAME folder, each declared as an additional source input, so the
// framework refuses one SHA256SUMS does not list and verifies every byte before this loader runs.
// The loader parses that folder with the release's own parser and refuses a folder whose files are
// not exactly the declared ones; a release that declares no donors must have no donor folder.
// Donor files are read for their text and structure only: they are never resolved, never censused
// and never minted (the release's graph is still exactly its own files).

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { parseJsonText } = require('./jsonText');
const { parsePescCorpus } = require('./xsdParser')();

const DONOR_TABLE_PATH = path.join(__dirname, 'documentationDonorTable.json');
const DONOR_FOLDER_NAME = 'donorLibraries';
const DONOR_INPUT_NAME_PREFIX = 'documentationDonor:';

const readDonorTable = () => {
	const parsedTable = parseJsonText(fs.readFileSync(DONOR_TABLE_PATH, 'utf8'));
	if (parsedTable.error || parsedTable.value.donorSetByReleaseName === null || typeof parsedTable.value.donorSetByReleaseName !== 'object') {
		throw refuse.byName({ moduleName, what: `${DONOR_TABLE_PATH} is not a donor table (${parsedTable.error || 'no donorSetByReleaseName'})`, where: 'the table is JSON: { tableNote, donorSetByReleaseName: { <releaseName>: { donorReason, donorFileList } } }' });
	}
	return parsedTable.value.donorSetByReleaseName;
};

const donorFileListFor = ({ releaseName }) => {
	const donorSet = readDonorTable()[releaseName];
	if (donorSet === undefined || !Array.isArray(donorSet.donorFileList)) {
		throw refuse.byName({ moduleName, what: `release '${releaseName}' has no row in ${path.basename(DONOR_TABLE_PATH)}`, where: 'every release the library forges declares its donors, an empty list included; add the row deliberately' });
	}
	return donorSet.donorFileList.slice();
};

const donorSourceInputListFor = ({ releaseName }) =>
	donorFileListFor({ releaseName }).map((oneFileName) => Object.freeze({ inputName: `${DONOR_INPUT_NAME_PREFIX}${oneFileName}`, relativePathFromSourcePath: path.join(DONOR_FOLDER_NAME, oneFileName) }));

const loadDocumentationDonorSet = ({ sourcePath, additionalSourceInputPathByName }, callback) => {
	const donorFolderPath = path.join(sourcePath, DONOR_FOLDER_NAME);
	const declaredDonorPathList = Object.keys(additionalSourceInputPathByName)
		.filter((oneInputName) => oneInputName.indexOf(DONOR_INPUT_NAME_PREFIX) === 0)
		.map((oneInputName) => additionalSourceInputPathByName[oneInputName]);
	if (declaredDonorPathList.length === 0) {
		if (fs.existsSync(donorFolderPath)) {
			callback(refuse.byName({ moduleName, what: `${donorFolderPath} exists but the release declares no donors`, where: 'a donor folder is read only when documentationDonorTable.json names its files' }).message);
			return;
		}
		callback('', { donorArtifactList: [], donorRelativePathList: [] });
		return;
	}
	const strayDonorPath = declaredDonorPathList.find((oneDonorPath) => path.dirname(oneDonorPath) !== donorFolderPath);
	if (strayDonorPath !== undefined) {
		callback(refuse.byName({ moduleName, what: `declared donor '${strayDonorPath}' is not in ${donorFolderPath}`, where: `every donor sits in the snapshot's ${DONOR_FOLDER_NAME} folder` }).message);
		return;
	}
	parsePescCorpus({ sourcePath: donorFolderPath }, (parseError, parsedDonors) => {
		if (parseError) {
			callback(parseError);
			return;
		}
		const parsedFileNameText = parsedDonors.artifacts.map((oneArtifact) => oneArtifact.filename).sort().join(', ');
		const declaredFileNameText = declaredDonorPathList.map((oneDonorPath) => path.basename(oneDonorPath)).sort().join(', ');
		if (parsedFileNameText !== declaredFileNameText) {
			callback(refuse.byName({ moduleName, what: `${donorFolderPath} holds ${parsedFileNameText}; the release declares ${declaredFileNameText}`, where: 'the donor folder holds exactly the declared donors' }).message);
			return;
		}
		callback('', {
			donorArtifactList: parsedDonors.artifacts,
			donorRelativePathList: parsedDonors.artifacts.map((oneArtifact) => path.join(DONOR_FOLDER_NAME, oneArtifact.filename)),
		});
	});
};

module.exports = { donorFileListFor, donorSourceInputListFor, loadDocumentationDonorSet, DONOR_FOLDER_NAME, DONOR_INPUT_NAME_PREFIX, DONOR_TABLE_PATH, moduleName };
