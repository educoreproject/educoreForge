'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// vocabularyProfileContract.js — the declared interface of the CTDL-family seam (ctdlHub-101926 P2 self-audit). A bundle
// plugs into lib/ctdl-family-forge ONLY through its vocabulary profile, so the profile's shape is the contract: every field
// below is REQUIRED (none is defaulted; a flag that is absent is not 'false'), its kind is checked, and a field the contract
// does not name is refused (a misspelt field must not become an ignored one). Validated once, by every factory that reads
// a profile (loader, walk, round-trip pair, hooks).

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
// the WORKORDER-P2b rows a profile may name in enrichmentKindList. E9 (scheme status) and E12 (usage notes on every role) are not
// rows here: they widen statusCarriedByTermKindList / usageNoteCarriedByTermKindList, which already say what they mean as data
const ENRICHMENT_KIND_LIST = Object.freeze(['E1', 'E1a', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E10', 'E11', 'E13']);
const isStringList = (candidate) => Array.isArray(candidate) && candidate.every((oneValue) => typeof oneValue === 'string');

const KIND_CHECK_BY_KIND = Object.freeze({
	nonEmptyString: (candidate) => typeof candidate === 'string' && candidate.length > 0,
	stringList: isStringList,
	nonEmptyStringList: (candidate) => isStringList(candidate) && candidate.length > 0,
	boolean: (candidate) => typeof candidate === 'boolean',
	termKindByType: (candidate) => isPlainObject(candidate) && Object.keys(candidate).length > 0 && Object.values(candidate).every(
		(oneSpec) => isPlainObject(oneSpec) && ['termKind', 'role', 'perStandardLabel', 'descriptionNoun'].every((oneName) => typeof oneSpec[oneName] === 'string'),
	),
	// ⟪P2b⟫ the WORKORDER-P2b E-rows a bundle has turned on; an unknown row name is refused, never ignored
	enrichmentKindList: (candidate) => isStringList(candidate) && candidate.every((oneKind) => ENRICHMENT_KIND_LIST.indexOf(oneKind) !== -1),
	predicateDispositionByName: (candidate) => isPlainObject(candidate) && Object.values(candidate).every((oneValue) => typeof oneValue === 'string'),
});

const VOCABULARY_PROFILE_FIELD_KIND = Object.freeze({
	profileNote: 'nonEmptyString',
	standardSource: 'nonEmptyString',
	sourceFileName: 'nonEmptyString',
	descriptionTemplateSubject: 'nonEmptyString',
	nativePrefixList: 'nonEmptyStringList',
	nativeTermIdList: 'stringList',
	seamTargetPrefixList: 'stringList',
	sourceStatedInversePredicateList: 'stringList',
	termKindByType: 'termKindByType',
	termKindOrder: 'nonEmptyStringList',
	labelPredicateList: 'nonEmptyStringList',
	descriptionPredicatePrecedenceList: 'nonEmptyStringList',
	languageTag: 'nonEmptyString',
	statusPredicate: 'nonEmptyString',
	statusValuePrefix: 'nonEmptyString',
	statusCarriedByTermKindList: 'stringList',
	usageNotePredicate: 'nonEmptyString',
	usageNoteCarriedByTermKindList: 'stringList',
	domainlessPropertyRootEdge: 'boolean',
	enrichmentKindList: 'enrichmentKindList',
	predicateDispositionByName: 'predicateDispositionByName',
});

// validateVocabularyProfile — throws a named Error on the first violation; returns the profile when it conforms
const validateVocabularyProfile = (vocabularyProfile) => {
	if (!isPlainObject(vocabularyProfile)) {
		throw new Error(`${moduleName} REFUSED: the vocabulary profile is not an object`);
	}
	const sourceText = typeof vocabularyProfile.standardSource === 'string' ? vocabularyProfile.standardSource : '(no standardSource)';
	const unknownFieldName = Object.keys(vocabularyProfile).find((fieldName) => VOCABULARY_PROFILE_FIELD_KIND[fieldName] === undefined);
	if (unknownFieldName !== undefined) {
		throw new Error(`${moduleName} REFUSED: the ${sourceText} profile carries '${unknownFieldName}', which the contract does not name (known: ${Object.keys(VOCABULARY_PROFILE_FIELD_KIND).join(', ')})`);
	}
	const violatingFieldName = Object.keys(VOCABULARY_PROFILE_FIELD_KIND).find((fieldName) => !KIND_CHECK_BY_KIND[VOCABULARY_PROFILE_FIELD_KIND[fieldName]](vocabularyProfile[fieldName]));
	if (violatingFieldName !== undefined) {
		throw new Error(`${moduleName} REFUSED: the ${sourceText} profile field '${violatingFieldName}' is ${vocabularyProfile[violatingFieldName] === undefined ? 'absent' : 'malformed'}; it must be a ${VOCABULARY_PROFILE_FIELD_KIND[violatingFieldName]} (there is no default)`);
	}
	return vocabularyProfile;
};

module.exports = { validateVocabularyProfile, VOCABULARY_PROFILE_FIELD_KIND, ENRICHMENT_KIND_LIST, moduleName };
