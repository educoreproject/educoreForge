'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// publicationIndex.js — the listing of a gold's PUBLISHED mapping sets and card downloads (mappingLayers ML3.1 Part C), which the
// educore downloads page reads (GATEREPORT-ML3 "Output shape"). PURE and synchronous: file facts and registry facts in, one JSON out.
//
//   publicationIndexFor({ graphName, publicLabel, manifestRefId, generatedAt, fileFactList, layerFactByLayerKey, hubFactByRelease })
//       → { publicationIndex } | { error }
//     fileFactList        [{ relativePath, byteSize, sha256 }] every file under <gold>/mappingLayers/ and <gold>/hubCards/
//     layerFactByLayerKey { <layerKey>: { displayName, statusByVersionTag: { <versionTag>: <effective ISO 11179 status> } } }
//     hubFactByRelease    { '<hubSegment>/<hubReleaseSegment>': { hubName, hubVersion, cardCount } }
//   Each file is classified by the FIRST pattern of layerPublicationRules.json publicationFileKindList it matches; a file that matches
//   none is REFUSED by name (nothing is listed that the page cannot explain), and so is a listed layer or release with no fact.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const PUBLICATION_RULES = require(path.join(__dirname, 'layerPublicationRules.json'));
const PUBLICATION_INDEX_FORMAT = 'educorePublicationDownloads/1';
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const byCodePoint = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);

const FILE_KIND_LIST = Object.freeze(PUBLICATION_RULES.publicationFileKindList.map((oneKind) => ({ ...oneKind, compiledPattern: new RegExp(oneKind.relativePathPattern) })));

const publicationIndexFor = ({ graphName, publicLabel, manifestRefId, generatedAt, fileFactList, layerFactByLayerKey, hubFactByRelease } = {}) => {
	const absentList = [['graphName', graphName], ['publicLabel', publicLabel], ['manifestRefId', manifestRefId], ['generatedAt', generatedAt]].filter(([, oneValue]) => typeof oneValue !== 'string' || oneValue === '').map(([oneName]) => oneName);
	if (absentList.length || !Array.isArray(fileFactList) || !layerFactByLayerKey || !hubFactByRelease) {
		return { error: refusalText(`absent: ${absentList.concat(Array.isArray(fileFactList) ? [] : ['fileFactList']).join(', ') || 'layerFactByLayerKey or hubFactByRelease'}`, 'publicationIndexFor({ graphName, publicLabel, manifestRefId, generatedAt, fileFactList, layerFactByLayerKey, hubFactByRelease })') };
	}
	const entryList = [];
	const sortedFactList = fileFactList.slice().sort((leftFact, rightFact) => byCodePoint(leftFact.relativePath, rightFact.relativePath));
	for (let factIndex = 0; factIndex < sortedFactList.length; factIndex++) {
		const fileFact = sortedFactList[factIndex];
		const fileKind = FILE_KIND_LIST.find((oneKind) => oneKind.compiledPattern.test(fileFact.relativePath));
		if (fileKind === undefined) {
			return { error: refusalText(`published file ${fileFact.relativePath} is of no declared kind`, 'layerPublicationRules.json publicationFileKindList (every listed file is explained)') };
		}
		const matched = fileKind.compiledPattern.exec(fileFact.relativePath).groups || {};
		const entry = { downloadId: fileFact.relativePath, kind: fileKind.kind, format: fileKind.format, relativePath: fileFact.relativePath, byteSize: fileFact.byteSize, sha256: fileFact.sha256, layerKey: matched.layerKey || null, versionTag: matched.versionTag || null, standardKey: matched.standardKey || null, hubSegment: matched.hubSegment || null, hubReleaseSegment: matched.hubReleaseSegment || null };
		if (entry.layerKey !== null) {
			const layerFact = layerFactByLayerKey[entry.layerKey];
			if (layerFact === undefined || (entry.versionTag !== null && typeof layerFact.statusByVersionTag[entry.versionTag] !== 'string')) {
				return { error: refusalText(`published file ${fileFact.relativePath} names layer '${entry.layerKey}'${entry.versionTag === null ? '' : ` version '${entry.versionTag}'`}, which the registry of record does not hold`, 'uriContract layerVersions') };
			}
			entry.layerTitle = layerFact.displayName;
			entry.registrationStatus = entry.versionTag === null ? null : layerFact.statusByVersionTag[entry.versionTag];
		}
		if (entry.hubSegment !== null) {
			const hubFact = hubFactByRelease[`${entry.hubSegment}/${entry.hubReleaseSegment}`];
			if (hubFact === undefined) {
				return { error: refusalText(`published file ${fileFact.relativePath} names hub release ${entry.hubSegment}/${entry.hubReleaseSegment}, which the card report does not hold`, 'hubCards/hubCards-report.json') };
			}
			entry.hubName = hubFact.hubName;
			entry.hubVersion = hubFact.hubVersion;
			entry.cardCount = hubFact.cardCount;
		}
		entryList.push(entry);
	}
	return { publicationIndex: { manifestFormat: PUBLICATION_INDEX_FORMAT, graphName, publicLabel, manifestRefId, generatedAt, entryList } };
};

module.exports = { publicationIndexFor, PUBLICATION_INDEX_FORMAT, FILE_KIND_LIST, moduleName };
