'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// standard-usage-tips.js — reads the per-standard metadata table the StandardDefinition finisher stamps onto each card:
// standardKind and standardUsageTips (lane P, mappingProvenance 2026-10-04; TQ via VIOLET_VALLEY; text owned by lane Q,
// SOLAR_CIPHER). The DME's askMilo prompt no longer carries standard-specific tips; it reads them from the card.
//
// ⟪TODO, 2026-10-04, TQ⟫ THIS IS THE ACKNOWLEDGED EASIEST HACK. Standard-specific metadata (kind + tips) belongs in each
// standard's FORGE DECLARATION, not in a side file read at finishing time. Move it there; then this module and the file go.
//
// THE FILE: system/configs/dmeStandardUsageTips.json — { "<standardName>": { standardKeyPrefixList, standardKind,
// standardUsageTips }, "_about": "…" }. Keys beginning '_' are commentary. A card matches an entry when its sourceKey starts,
// case-insensitively, with one of the entry's prefixes. A card no entry matches gets NO property: never invented text. A card
// two entries match is REFUSED by name: which text applies would be a guess.
//
//   readStandardMetadataEntryList({ filePath }) → { standardMetadataEntryList } | { error }
//   standardMetadataFor({ standardMetadataEntryList, sourceKey }) → { standardMetadata: { standardKind, standardUsageTips } | null } | { error }
//
// Async style: none needed (synchronous file read at construction). No try/catch for control flow: the one JSON.parse is a
// boundary translation of a malformed file into a named refusal.

const fs = require('fs');

const readStandardMetadataEntryList = ({ filePath, standardKindList } = {}) => {
	if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
		return { error: `${moduleName} REFUSED: the standard metadata file ${JSON.stringify(filePath)} does not exist; StandardDefinition cards would silently lose their usage tips` };
	}
	let parsedTable;
	// boundary translation: a file that does not parse is refused by name, never treated as empty
	try {
		parsedTable = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (parseError) {
		return { error: `${moduleName} REFUSED: ${filePath} does not parse (${parseError.message})` };
	}
	const standardNameList = Object.keys(parsedTable).filter((oneName) => oneName.indexOf('_') !== 0);
	const faultList = standardNameList.reduce((soFar, oneName) => {
		const oneEntry = parsedTable[oneName] || {};
		return soFar
			.concat(Array.isArray(oneEntry.standardKeyPrefixList) && oneEntry.standardKeyPrefixList.length && oneEntry.standardKeyPrefixList.every((onePrefix) => typeof onePrefix === 'string' && onePrefix.trim()) ? [] : [`${oneName}: standardKeyPrefixList is not a non-empty list of prefixes`])
			.concat(standardKindList.indexOf(oneEntry.standardKind) !== -1 ? [] : [`${oneName}: standardKind ${JSON.stringify(oneEntry.standardKind)} is not one of ${standardKindList.join(', ')}`])
			.concat(typeof oneEntry.standardUsageTips === 'string' && oneEntry.standardUsageTips.trim() ? [] : [`${oneName}: standardUsageTips is empty`]);
	}, []);
	if (faultList.length) {
		return { error: `${moduleName} REFUSED: ${filePath}: ${faultList.join('; ')}` };
	}
	return {
		standardMetadataEntryList: standardNameList.map((oneName) => ({
			standardName: oneName,
			standardKeyPrefixList: parsedTable[oneName].standardKeyPrefixList.map((onePrefix) => onePrefix.toLowerCase()),
			standardKind: parsedTable[oneName].standardKind,
			standardUsageTips: parsedTable[oneName].standardUsageTips,
		})),
	};
};

const standardMetadataFor = ({ standardMetadataEntryList, sourceKey }) => {
	const lowerSourceKey = String(sourceKey).toLowerCase();
	const matchingEntryList = standardMetadataEntryList.filter((oneEntry) => oneEntry.standardKeyPrefixList.some((onePrefix) => lowerSourceKey.indexOf(onePrefix) === 0));
	if (matchingEntryList.length > 1) {
		return { error: `${moduleName} REFUSED: standard '${sourceKey}' matches ${matchingEntryList.length} metadata entries (${matchingEntryList.map((oneEntry) => oneEntry.standardName).join(', ')}); which text applies would be a guess` };
	}
	return { standardMetadata: matchingEntryList.length ? { standardKind: matchingEntryList[0].standardKind, standardUsageTips: matchingEntryList[0].standardUsageTips } : null };
};

module.exports = { readStandardMetadataEntryList, standardMetadataFor, moduleName };
