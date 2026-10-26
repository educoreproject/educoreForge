'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hubCardPublication.js — the CARD DOWNLOAD per hub release (mappingLayers ML3.1 Part C, TQ Q8, design note approved by AMBER_JOURNEY
// 2026-10-26). PURE and synchronous: captured cards in, file texts out; no store, no graph, no clock.
//
//   hubCardFileListFor({ cardList, hubBundleTokenByHubName, heldBundleTokenList }) → { hubFileList: [{ hubSegment, hubReleaseSegment,
//       hubName, hubVersion, cardCount, csvText, jsonLdText }] } | { error }
//       one file pair per hub release, every card a row: its meaning URI, tier, domain (the hub's own class, read verbatim), property,
//       range, value, term and definition, each read from the card as the hub framework wrote it (never composed; absent = empty)
//
// A hub whose forge bundle is on the licence-hold list is REFUSED by name (cards are hub content; CEDS and CTDL are offered today).
// A card whose hub has no bundleToken row (layerPublicationRules.json hubBundleTokenByHubName) is refused by name, never guessed.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));

// CARD_COLUMN_LIST — the columns, each with the card fields it reads in order (the first present wins: a CEDS property card names one
// range kind, a CTDL card lists several); a multivalued field is joined with MULTIVALUE_SEPARATOR
const MULTIVALUE_SEPARATOR = '|';
const CARD_COLUMN_LIST = Object.freeze([
	{ columnName: 'meaningUri', fieldNameList: ['uri'] },
	{ columnName: 'referenceTier', fieldNameList: ['referenceTier'] },
	{ columnName: 'domainId', fieldNameList: ['domainId'] },
	{ columnName: 'domainName', fieldNameList: ['domainName'] },
	{ columnName: 'propertyKey', fieldNameList: ['propertyKey'] },
	{ columnName: 'propertyName', fieldNameList: ['propertyName'] },
	{ columnName: 'range', fieldNameList: ['rangeOptionSetName', 'rangeClassName', 'rangeDatatype', 'rangeOptionSetNameList', 'rangeClassNameList', 'rangeDatatypeList'] },
	{ columnName: 'valueKey', fieldNameList: ['valueKey'] },
	{ columnName: 'valueName', fieldNameList: ['valueName'] },
	{ columnName: 'termIri', fieldNameList: ['termIri'] },
	{ columnName: 'termName', fieldNameList: ['termName'] },
	{ columnName: 'definition', fieldNameList: ['valueDefinition', 'propertyDefinition', 'termDefinition'] },
]);
// the JSON-LD names: the definition and label are SKOS; every other column is the extension base the published SSSOM sets already declare
const JSON_LD_CONTEXT = Object.freeze({
	skos: 'http://www.w3.org/2004/02/skos/core#',
	edcx: 'https://w3id.org/EDUcore/sssom/extension#',
	definition: 'skos:definition',
	...CARD_COLUMN_LIST.filter((oneColumn) => ['meaningUri', 'definition'].indexOf(oneColumn.columnName) === -1).reduce((soFar, oneColumn) => ({ ...soFar, [oneColumn.columnName]: `edcx:${oneColumn.columnName}` }), {}),
});

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const byCodePoint = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
const cellTextOf = (fieldValue) => (fieldValue === undefined || fieldValue === null ? '' : Array.isArray(fieldValue) ? fieldValue.join(MULTIVALUE_SEPARATOR) : String(fieldValue));
// RFC 4180: a cell holding a comma, a quote or a line break is quoted, its quotes doubled
const csvCellOf = (cellText) => (/[",\r\n]/.test(cellText) ? `"${cellText.replace(/"/g, '""')}"` : cellText);

const rowOfCard = (card) =>
	CARD_COLUMN_LIST.reduce((soFar, oneColumn) => {
		const fieldName = oneColumn.fieldNameList.find((oneFieldName) => cellTextOf(card[oneFieldName]) !== '');
		return { ...soFar, [oneColumn.columnName]: fieldName === undefined ? '' : cellTextOf(card[fieldName]) };
	}, {});

const hubCardFileListFor = ({ cardList, hubBundleTokenByHubName, heldBundleTokenList } = {}) => {
	if (!Array.isArray(cardList) || cardList.length === 0 || hubBundleTokenByHubName === null || typeof hubBundleTokenByHubName !== 'object' || !Array.isArray(heldBundleTokenList)) {
		return { error: refusalText('cardList (non-empty), hubBundleTokenByHubName and heldBundleTokenList are required', 'hubCardFileListFor({ cardList, hubBundleTokenByHubName, heldBundleTokenList })') };
	}
	const rowListByRelease = {};
	const releaseByName = {};
	for (let cardIndex = 0; cardIndex < cardList.length; cardIndex++) {
		const card = cardList[cardIndex];
		const parsed = edcUri.parse(card.uri);
		if (parsed.error || parsed.kind !== 'meaning') {
			return { error: refusalText(`card ${JSON.stringify(card.uri)} is not a meaning URI`, 'a hub card is addressed by its meaning URI (uriScheme.json kind meaning)') };
		}
		const bundleToken = hubBundleTokenByHubName[card.hubName];
		if (typeof bundleToken !== 'string') {
			return { error: refusalText(`hub '${card.hubName}' has no bundleToken`, 'layerPublicationRules.json hubBundleTokenByHubName (a hub is never matched to a bundle by guessing)') };
		}
		if (heldBundleTokenList.indexOf(bundleToken) !== -1) {
			return { error: refusalText(`hub '${card.hubName}' (bundle '${bundleToken}') is on the licence-hold list`, 'apps/graph-builder/lib/downloadArtifactsRules.json licenceHoldList: a held hub\'s cards are not offered') };
		}
		const releaseName = `${parsed.partByName.hubSegment}/${parsed.partByName.hubReleaseSegment}`;
		releaseByName[releaseName] = releaseByName[releaseName] || { hubSegment: parsed.partByName.hubSegment, hubReleaseSegment: parsed.partByName.hubReleaseSegment, hubName: card.hubName, hubVersion: cellTextOf(card.hubVersion) };
		rowListByRelease[releaseName] = rowListByRelease[releaseName] || [];
		rowListByRelease[releaseName].push(rowOfCard(card));
	}
	const columnNameList = CARD_COLUMN_LIST.map((oneColumn) => oneColumn.columnName);
	const hubFileList = Object.keys(rowListByRelease)
		.sort(byCodePoint)
		.map((releaseName) => {
			const rowList = rowListByRelease[releaseName].slice().sort((leftRow, rightRow) => byCodePoint(leftRow.meaningUri, rightRow.meaningUri));
			const csvText = `${[columnNameList.join(',')].concat(rowList.map((oneRow) => columnNameList.map((oneColumnName) => csvCellOf(oneRow[oneColumnName])).join(','))).join('\r\n')}\r\n`;
			const graphList = rowList.map((oneRow) => columnNameList.filter((oneColumnName) => oneColumnName !== 'meaningUri' && oneRow[oneColumnName] !== '').reduce((soFar, oneColumnName) => ({ ...soFar, [oneColumnName]: oneRow[oneColumnName] }), { '@id': oneRow.meaningUri }));
			const jsonLdText = `${JSON.stringify({ '@context': JSON_LD_CONTEXT, '@graph': graphList }, null, '\t')}\n`;
			return { ...releaseByName[releaseName], cardCount: rowList.length, csvText, jsonLdText };
		});
	return { hubFileList };
};

module.exports = { hubCardFileListFor, CARD_COLUMN_LIST, JSON_LD_CONTEXT, MULTIVALUE_SEPARATOR, moduleName };
