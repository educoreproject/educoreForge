'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// jsonLdVocabularyLoader.js — the H2 loaders for a JSON-LD vocabulary source (ctdlHub-101926 P1): the
// vocabulary itself, and the snapshot's standardSourceLocation (where sourceUrl is read from, never
// hard-coded). This is the ONE place external source data enters the forge, so it is the one place the
// forge refuses: an unknown @type, a missing or malformed @id, a predicate the profile does not name, a
// language map without the profile's language, a reference value that is not a string. Everything it
// returns has passed those checks; the walk downstream does not re-check (no guards between our modules).
//
// It partitions @graph into NATIVE entries (nativeIdentity.js: prefix or exact term listed by the profile) and FOREIGN
// entries, which are carried verbatim (plan §4.1 A5) and therefore only type-checked.

const fs = require('fs');
const { isNativeIriFor } = require('./nativeIdentity');
const { validateVocabularyProfile } = require('./vocabularyProfileContract');

const CURIE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*:\S+$/;
const LOCATION_URL_PATTERN = /^upstreamUrl:[ \t]*(\S+)[ \t]*$/m;
const PREDICATE_VALUE_SHAPE_BY_DISPOSITION = Object.freeze({
	identity: 'string',
	label: 'languageMap',
	description: 'languageMap',
	usageNote: 'languageMap',
	status: 'string',
	notCarried: 'string',
	reference: 'stringList',
});


// shapeProblemOf — '' when a predicate's value has the shape its disposition requires, else the problem
const shapeProblemOf = ({ valueShape, predicateValue, languageTag }) => {
	if (valueShape === 'string') {
		return typeof predicateValue === 'string' ? '' : `is a ${typeof predicateValue}, not a string`;
	}
	if (valueShape === 'stringList') {
		return Array.isArray(predicateValue) && predicateValue.every((oneValue) => typeof oneValue === 'string') ? '' : 'is not a list of strings';
	}
	const isLanguageMap = predicateValue !== null && typeof predicateValue === 'object' && !Array.isArray(predicateValue);
	return isLanguageMap && typeof predicateValue[languageTag] === 'string' ? '' : `is not a language map carrying '${languageTag}'`;
};

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabularyProfile }) => {
		validateVocabularyProfile(vocabularyProfile);
		const { termKindByType, predicateDispositionByName, languageTag, sourceFileName, labelPredicateList } = vocabularyProfile;
		const isNativeIri = isNativeIriFor(vocabularyProfile);

		// entryProblemOf — the first refusal reason for one @graph entry, or ''
		const entryProblemOf = (oneEntry, entryIndex) => {
			const entryId = oneEntry && oneEntry['@id'];
			if (typeof entryId !== 'string') {
				return `@graph entry ${entryIndex} has no string @id`;
			}
			if (!CURIE_PATTERN.test(entryId)) {
				return `@graph entry ${entryIndex} @id '${entryId}' is not a CURIE`;
			}
			if (termKindByType[oneEntry['@type']] === undefined) {
				return `'${entryId}' has @type ${JSON.stringify(oneEntry['@type'])}, which the profile does not map (known: ${Object.keys(termKindByType).join(', ')})`;
			}
			if (!isNativeIri(entryId)) {
				return '';
			}
			if (!labelPredicateList.some((predicateName) => oneEntry[predicateName] !== undefined)) {
				return `native '${entryId}' carries no label (${labelPredicateList.join(' or ')}); a name is read from the source, never made up`;
			}
			const unknownPredicateName = Object.keys(oneEntry).find((predicateName) => predicateDispositionByName[predicateName] === undefined);
			if (unknownPredicateName !== undefined) {
				return `native '${entryId}' carries predicate '${unknownPredicateName}', which the profile's predicateDispositionByName does not name`;
			}
			const misshapenPredicateName = Object.keys(oneEntry).find(
				(predicateName) => shapeProblemOf({ valueShape: PREDICATE_VALUE_SHAPE_BY_DISPOSITION[predicateDispositionByName[predicateName]], predicateValue: oneEntry[predicateName], languageTag }) !== '',
			);
			if (misshapenPredicateName !== undefined) {
				const valueShape = PREDICATE_VALUE_SHAPE_BY_DISPOSITION[predicateDispositionByName[misshapenPredicateName]];
				return `native '${entryId}' predicate '${misshapenPredicateName}' ${shapeProblemOf({ valueShape, predicateValue: oneEntry[misshapenPredicateName], languageTag })}`;
			}
			return '';
		};

		// loadVocabulary — the JSON-LD file named by sourcePath (descriptor sourceFile), validated and partitioned
		const loadVocabulary = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			const sourceFilePath = fs.statSync(sourcePath).isDirectory() ? `${sourcePath}/${sourceFileName}` : sourcePath;
			if (!fs.existsSync(sourceFilePath)) {
				callback(`${moduleName} REFUSED: the vocabulary source '${sourceFilePath}' is not on disk`);
				return;
			}
			let sourceDocument;
			try {
				sourceDocument = JSON.parse(fs.readFileSync(sourceFilePath, 'utf8'));
			} catch (parseError) {
				// localized parse boundary (house-sanctioned): the refusal, not the throw, is the flow
				callback(`${moduleName} REFUSED: '${sourceFilePath}' is not parseable JSON (${parseError.message}); reacquire per README_PROVENANCE.md`);
				return;
			}
			if (!sourceDocument || !Array.isArray(sourceDocument['@graph'])) {
				callback(`${moduleName} REFUSED: '${sourceFilePath}' has no @graph array`);
				return;
			}
			const graphEntryList = sourceDocument['@graph'];
			const entryProblem = graphEntryList.map(entryProblemOf).find((oneProblem) => oneProblem !== '');
			if (entryProblem !== undefined) {
				callback(`${moduleName} REFUSED: ${entryProblem}`);
				return;
			}
			const nativeEntryList = graphEntryList.filter((oneEntry) => isNativeIri(oneEntry['@id']));
			const foreignEntryList = graphEntryList.filter((oneEntry) => !isNativeIri(oneEntry['@id']));
			const nativeIdList = nativeEntryList.map((oneEntry) => oneEntry['@id']);
			const duplicateNativeId = nativeIdList.find((entryId, entryIndex) => nativeIdList.indexOf(entryId) !== entryIndex);
			if (duplicateNativeId !== undefined) {
				callback(`${moduleName} REFUSED: native @id '${duplicateNativeId}' is defined twice in '${sourceFilePath}'`);
				return;
			}
			xLog.status(`[${moduleName}] ${graphEntryList.length} @graph entries: ${nativeEntryList.length} native, ${foreignEntryList.length} foreign (carried verbatim)`);
			callback('', { sourceFileName: sourceFilePath.split('/').pop(), nativeEntryList, foreignEntryList });
		};

		// loadSourceLocation — the snapshot's standardSourceLocation, for the upstream URL the root states
		const loadSourceLocation = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			const locationFilePath = additionalSourceInputPathByName.sourceLocation;
			const locationMatch = fs.readFileSync(locationFilePath, 'utf8').match(LOCATION_URL_PATTERN);
			if (!locationMatch) {
				callback(`${moduleName} REFUSED: '${locationFilePath}' states no 'upstreamUrl:' line; the root's sourceUrl is read from it and never assumed`);
				return;
			}
			callback('', { upstreamUrl: locationMatch[1] });
		};

		return { loadVocabulary, loadSourceLocation };
	};

module.exports = moduleFunction({ moduleName });
