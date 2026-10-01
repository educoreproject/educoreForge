'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// manifestEntryLoader.js — loader 2 of the PESC release forge, `pescReleaseManifestEntry`
// (DESIGN-pescForge.md §1.2; gate F2).
//
//   loadReleaseManifestEntry({ sourcePath, additionalSourceInputPathByName }, callback)
//     → callback('', loadedManifestEntry) | callback(refusalMessage)
//   checkManifestEntryAgainstFolder({ manifestEntryDocument, xsdFileShaByFileName, manifestEntryFileName })
//     → { loadedManifestEntry } | { refusalMessage }   (pure; the scaffold tool uses it too)
//
// The snapshot carries releaseManifestEntry.json: the expander's entry for this release, copied
// VERBATIM out of releaseManifest.json under `releaseEntry`, beside `copiedFromManifest`, the two
// manifest-level facts the release record needs (the manifest format and the source corpus). The
// scaffold tool writes it; nothing edits it.
//
// The check is a SECOND one, independent of SHA256SUMS: the entry's memberFiles must name exactly
// the .xsd files in the snapshot folder, each with the sha256 the folder's bytes have. SHA256SUMS
// proves the bytes are the ones the bundle recorded; this proves they are the ones the expander
// selected for this release. A disagreement refuses the forge by name.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { parseJsonText } = require('./jsonText');

// the forge declaration's additionalSourceInputList names the input by this
const MANIFEST_ENTRY_INPUT_NAME = 'releaseManifestEntry';
const MANIFEST_ENTRY_FILE_NAME = 'releaseManifestEntry.json';
const XSD_FILE_NAME_RE = /\.xsd$/i;
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+$/;
// the entry fields the forge reads; each must be present (absent is refused, never defaulted)
const REQUIRED_ENTRY_FIELD_NAME_LIST = Object.freeze([
	'releaseName',
	'standard',
	'version',
	'rootFilename',
	'verdict',
	'memberFiles',
	'closureDigest',
	'librariesNamed',
	'pinDecisionsApplied',
	'closureDate',
	'closureDateEvidence',
	'releaseReferenceCheck',
	'rootChangeLogLines',
	'selected',
	'folderName',
]);
const REQUIRED_MANIFEST_FIELD_NAME_LIST = Object.freeze(['manifestFormat', 'sourceCorpus']);

const refusal = (what, where) => ({ refusalMessage: refuse.byName({ moduleName, what, where }).message });

const sha256OfBuffer = (fileBuffer) => crypto.createHash('sha256').update(fileBuffer).digest('hex');

// ---- pure: the entry against the folder's .xsd files -------------------------------------------

const checkManifestEntryAgainstFolder = ({ manifestEntryDocument, xsdFileShaByFileName, manifestEntryFileName }) => {
	const missingManifestFieldName = REQUIRED_MANIFEST_FIELD_NAME_LIST.find((oneName) => !manifestEntryDocument.copiedFromManifest || manifestEntryDocument.copiedFromManifest[oneName] === undefined);
	if (missingManifestFieldName !== undefined) {
		return refusal(`${manifestEntryFileName} copiedFromManifest has no '${missingManifestFieldName}'`, `copiedFromManifest carries ${REQUIRED_MANIFEST_FIELD_NAME_LIST.join(', ')} from releaseManifest.json`);
	}
	if (typeof manifestEntryDocument.copiedFromManifest.sourceCorpus.corpusDigest !== 'string') {
		return refusal(`${manifestEntryFileName} copiedFromManifest.sourceCorpus has no corpusDigest string`, "sourceCorpus is the manifest's own record of the 64-file corpus, with its digest");
	}
	const releaseEntry = manifestEntryDocument.releaseEntry;
	if (releaseEntry === null || typeof releaseEntry !== 'object') {
		return refusal(`${manifestEntryFileName} has no releaseEntry object`, 'releaseEntry is the release\'s entry, copied verbatim from releaseManifest.json');
	}
	const missingEntryFieldName = REQUIRED_ENTRY_FIELD_NAME_LIST.find((oneName) => releaseEntry[oneName] === undefined);
	if (missingEntryFieldName !== undefined) {
		return refusal(`${manifestEntryFileName} releaseEntry has no '${missingEntryFieldName}'`, `a release entry carries ${REQUIRED_ENTRY_FIELD_NAME_LIST.join(', ')}`);
	}
	if (releaseEntry.selected !== true) {
		return refusal(`${manifestEntryFileName} names release '${releaseEntry.releaseName}', which the expander did not select`, 'the forge reads only selected releases, which the expander wrote as folders');
	}
	if (!RELEASE_VERSION_RE.test(releaseEntry.version)) {
		return refusal(`${manifestEntryFileName} release version is '${releaseEntry.version}'`, 'a PESC release version is three dot-separated integers');
	}
	if (!Array.isArray(releaseEntry.memberFiles) || releaseEntry.memberFiles.length === 0) {
		return refusal(`${manifestEntryFileName} memberFiles is not a non-empty list`, 'a release names its member files');
	}
	const entryShaByFileName = {};
	releaseEntry.memberFiles.forEach((oneMember) => {
		entryShaByFileName[oneMember.filename] = oneMember.sha256;
	});
	const entryFileNameList = Object.keys(entryShaByFileName).sort();
	const folderFileNameList = Object.keys(xsdFileShaByFileName).sort();
	if (JSON.stringify(entryFileNameList) !== JSON.stringify(folderFileNameList)) {
		return refusal(`${manifestEntryFileName} names the files ${entryFileNameList.join(', ')} and the folder holds ${folderFileNameList.join(', ')}`, 'the entry names exactly the folder\'s .xsd files');
	}
	const disagreeingFileName = entryFileNameList.find((oneFileName) => entryShaByFileName[oneFileName] !== xsdFileShaByFileName[oneFileName]);
	if (disagreeingFileName !== undefined) {
		return refusal(`${disagreeingFileName}: ${manifestEntryFileName} says sha256 ${entryShaByFileName[disagreeingFileName]}, the folder's bytes are ${xsdFileShaByFileName[disagreeingFileName]}`, 'the folder holds exactly the bytes the expander selected for this release');
	}
	if (entryShaByFileName[releaseEntry.rootFilename] === undefined) {
		return refusal(`${manifestEntryFileName} rootFilename '${releaseEntry.rootFilename}' is not a member file`, 'the release root is one of its member files');
	}
	return {
		loadedManifestEntry: Object.freeze({
			sourceFileName: manifestEntryFileName,
			expanderManifestFormat: manifestEntryDocument.copiedFromManifest.manifestFormat,
			sourceCorpusDigest: manifestEntryDocument.copiedFromManifest.sourceCorpus.corpusDigest,
			releaseEntry,
		}),
	};
};

// ---- the loader --------------------------------------------------------------------------------

const readXsdFileShaByFileName = ({ folderPath }) => {
	const xsdFileShaByFileName = {};
	fs.readdirSync(folderPath)
		.filter((oneFileName) => XSD_FILE_NAME_RE.test(oneFileName))
		.forEach((oneFileName) => {
			xsdFileShaByFileName[oneFileName] = sha256OfBuffer(fs.readFileSync(path.join(folderPath, oneFileName)));
		});
	return xsdFileShaByFileName;
};

const loadReleaseManifestEntry = ({ sourcePath, additionalSourceInputPathByName }, callback) => {
	const manifestEntryPath = additionalSourceInputPathByName[MANIFEST_ENTRY_INPUT_NAME];
	if (typeof manifestEntryPath !== 'string') {
		callback(refuse.byName({ moduleName, what: `no path for the additional source input '${MANIFEST_ENTRY_INPUT_NAME}'`, where: 'the forge declaration lists releaseManifestEntry.json in additionalSourceInputList' }).message);
		return;
	}
	fs.readFile(manifestEntryPath, 'utf8', (readError, manifestEntryText) => {
		if (readError) {
			callback(`${moduleName} could not read ${manifestEntryPath}: ${readError.message}`);
			return;
		}
		const parsedJson = parseJsonText(manifestEntryText);
		if (parsedJson.error) {
			callback(refuse.byName({ moduleName, what: `${MANIFEST_ENTRY_FILE_NAME} is not JSON: ${parsedJson.error}`, where: 'the scaffold tool writes it as JSON and nothing edits it' }).message);
			return;
		}
		const checked = checkManifestEntryAgainstFolder({
			manifestEntryDocument: parsedJson.value,
			xsdFileShaByFileName: readXsdFileShaByFileName({ folderPath: sourcePath }),
			manifestEntryFileName: MANIFEST_ENTRY_FILE_NAME,
		});
		if (checked.refusalMessage) {
			callback(checked.refusalMessage);
			return;
		}
		callback('', checked.loadedManifestEntry);
	});
};

module.exports = {
	loadReleaseManifestEntry,
	checkManifestEntryAgainstFolder,
	readXsdFileShaByFileName,
	MANIFEST_ENTRY_INPUT_NAME,
	MANIFEST_ENTRY_FILE_NAME,
	RELEASE_VERSION_RE,
	moduleName,
};
