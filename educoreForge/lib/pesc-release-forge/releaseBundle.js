'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// releaseBundle.js — reads one release bundle's two data files and assembles what its three-line
// modules hand the framework (DESIGN-pescForge.md §4.1).
//
//   readBundleData({ bundleDirPath })
//     → { releaseDeclarationData, releaseDeclarationName, frozenReleaseCensus, frozenCensusName }
//   readForgeDeclaration({ bundleDirPath })   → the frozen forge declaration (releaseForgeDeclaration.js)
//   makeBundleHooks({ bundleDirPath })        → the hook set (hooks.js), holding the bundle's frozen census
//
// The data files, both written once by the scaffold tool and never edited:
//   <bundle>/lib/releaseDeclaration.json   the release's names (releaseNames.js)
//   <bundle>/lib/releaseCensus.json        { censusNote, releaseName, census }: the frozen counts
//
// These run when a bundle module is required, so a missing or malformed data file is thrown as a
// named refusal at load time: a bundle that cannot say what it is does not load.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { parseJsonText } = require('./jsonText');
const { buildForgeDeclaration } = require('./releaseForgeDeclaration');
const { makeReleaseHooks } = require('./hooks');

const RELEASE_DECLARATION_RELATIVE_PATH = path.join('lib', 'releaseDeclaration.json');
const RELEASE_CENSUS_RELATIVE_PATH = path.join('lib', 'releaseCensus.json');

const readJsonFile = ({ bundleDirPath, relativePath }) => {
	const filePath = path.join(bundleDirPath, relativePath);
	if (!fs.existsSync(filePath)) {
		throw refuse.byName({ moduleName, what: `${filePath} is absent`, where: 'every release bundle carries the data files the scaffold tool wrote' });
	}
	const parsedJson = parseJsonText(fs.readFileSync(filePath, 'utf8'));
	if (parsedJson.error) {
		throw refuse.byName({ moduleName, what: `${filePath} is not JSON: ${parsedJson.error}`, where: 'the scaffold tool writes it as JSON; rescaffold rather than edit' });
	}
	return parsedJson.value;
};

const readBundleData = ({ bundleDirPath }) => {
	const releaseDeclarationData = readJsonFile({ bundleDirPath, relativePath: RELEASE_DECLARATION_RELATIVE_PATH });
	const censusDocument = readJsonFile({ bundleDirPath, relativePath: RELEASE_CENSUS_RELATIVE_PATH });
	const releaseCensusName = `${path.basename(bundleDirPath)}/${RELEASE_CENSUS_RELATIVE_PATH}`;
	if (censusDocument.releaseName !== releaseDeclarationData.releaseName || censusDocument.census === null || typeof censusDocument.census !== 'object') {
		throw refuse.byName({ moduleName, what: `${releaseCensusName} is for release '${censusDocument.releaseName}' (census ${typeof censusDocument.census}), the bundle declares '${releaseDeclarationData.releaseName}'`, where: 'a bundle\'s frozen census names its own release and carries a census object' });
	}
	return {
		releaseDeclarationData,
		releaseDeclarationName: `${path.basename(bundleDirPath)}/${RELEASE_DECLARATION_RELATIVE_PATH}`,
		frozenReleaseCensus: censusDocument.census,
		frozenCensusName: releaseCensusName,
	};
};

const readForgeDeclaration = ({ bundleDirPath }) => {
	const { releaseDeclarationData, releaseDeclarationName } = readBundleData({ bundleDirPath });
	return buildForgeDeclaration({ releaseDeclarationData, releaseDeclarationName });
};

const makeBundleHooks = ({ bundleDirPath }) => {
	const { releaseDeclarationData, frozenReleaseCensus, frozenCensusName } = readBundleData({ bundleDirPath });
	return makeReleaseHooks({ standardKey: releaseDeclarationData.standardKey, labelPrefix: releaseDeclarationData.labelPrefix, frozenReleaseCensus, frozenCensusName });
};

module.exports = { readBundleData, readForgeDeclaration, makeBundleHooks, RELEASE_DECLARATION_RELATIVE_PATH, RELEASE_CENSUS_RELATIVE_PATH, moduleName };
