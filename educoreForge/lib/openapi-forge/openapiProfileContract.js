'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiProfileContract.js — the declared interface of the OpenAPI kit's seam (nextStandards-102326 K0, K1). A bundle plugs into
// lib/openapi-forge ONLY through its openapi profile (a JSON file in the bundle), so the profile's shape is the contract: every field
// below is REQUIRED for its layout (none is defaulted), its kind is checked, and a field the contract does not name — or names for the
// other layout — is refused, so a misspelt field cannot become an ignored one. Validated once by every factory that reads a profile.
//
// sourceLayout (K1, ruled 2026-10-24) says what kind of document the bundle holds, and so which walk and pair read it:
//   referencedSingleFile   one file whose references are $refs and whose schemas are objects (K0; Open Badges)
//   dereferencedMultiFile  one data model over one or more files, every reference INLINED as a copy (JEDx's bundles; LIF's single file)
// The fields each layout requires are DATA (FIELD_NAME_LIST_BY_LAYOUT), not a branch.
//
// sourceFormat is a closed list. 'yaml' is refused by its own name (ruled 2026-10-23): CASE's lane adds the reader with its own twin.
//
// statementOmissionDeclaration (K1c, ruled by BRONZE_CROWN 2026-10-24 for LIF; dereferencedMultiFile only) names, BY NAME, the source
// statements the walk does not carry and the pair declares omitted, so they reach explicitlyOmittedTotal and never lostTotal:
//   emptyValueKeywordList  keywords whose EMPTY value ('' , or [] for a list) states nothing. An empty value of an unlisted keyword is
//                          still refused; a listed keyword the source never states empty is refused as stale.
//   enumMemberRepeatList   { enumObjectPointer: '<Schema><JSON pointer of the object holding the enum>', memberText }: one enum member the
//                          source lists twice, carried once. An unlisted repeat is still refused; a listed one the source lacks is stale.
// Both lists may be empty (JEDx states none); the field itself is required, so no bundle is silently given an empty declaration.

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const READABLE_SOURCE_FORMAT_LIST = Object.freeze(['json']);
const NOT_YET_READABLE_SOURCE_FORMAT_LIST = Object.freeze(['yaml']);
const SOURCE_LAYOUT = Object.freeze({ REFERENCED_SINGLE_FILE: 'referencedSingleFile', DEREFERENCED_MULTI_FILE: 'dereferencedMultiFile' });
const SOURCE_LAYOUT_LIST = Object.freeze(Object.values(SOURCE_LAYOUT));
const LABELLED_ROLE_LIST = Object.freeze([DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_SET, DME_ROLES.OPTION_VALUE]);
// a prefix is a standard token and a colon (openbadges:); a root id is that prefix and a name
const STABLE_ID_PREFIX_PATTERN = /^[a-z][a-z0-9]*:$/;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isStringList = (candidate) => Array.isArray(candidate) && candidate.every((oneValue) => typeof oneValue === 'string' && oneValue.length > 0);

const KIND_CHECK_BY_KIND = Object.freeze({
	nonEmptyString: (candidate) => typeof candidate === 'string' && candidate.length > 0,
	stringList: isStringList,
	distinctNonEmptyStringList: (candidate) => isStringList(candidate) && candidate.length > 0 && new Set(candidate).size === candidate.length,
	stableIdPrefix: (candidate) => typeof candidate === 'string' && STABLE_ID_PREFIX_PATTERN.test(candidate),
	sourceFormat: (candidate) => READABLE_SOURCE_FORMAT_LIST.indexOf(candidate) !== -1,
	sourceLayout: (candidate) => SOURCE_LAYOUT_LIST.indexOf(candidate) !== -1,
	statementOmissionDeclaration: (candidate) => isPlainObject(candidate)
		&& JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify(['emptyValueKeywordList', 'enumMemberRepeatList'])
		&& isStringList(candidate.emptyValueKeywordList) && new Set(candidate.emptyValueKeywordList).size === candidate.emptyValueKeywordList.length
		&& Array.isArray(candidate.enumMemberRepeatList)
		&& candidate.enumMemberRepeatList.every((oneRepeat) => isPlainObject(oneRepeat)
			&& JSON.stringify(Object.keys(oneRepeat).sort()) === JSON.stringify(['enumObjectPointer', 'memberText'])
			&& typeof oneRepeat.enumObjectPointer === 'string' && oneRepeat.enumObjectPointer.length > 0
			&& typeof oneRepeat.memberText === 'string' && oneRepeat.memberText.length > 0)
		&& new Set(candidate.enumMemberRepeatList.map((oneRepeat) => JSON.stringify([oneRepeat.enumObjectPointer, oneRepeat.memberText]))).size === candidate.enumMemberRepeatList.length,
	perStandardLabelByRole: (candidate) => isPlainObject(candidate)
		&& JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify(LABELLED_ROLE_LIST.slice().sort())
		&& Object.values(candidate).every((oneLabel) => typeof oneLabel === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(oneLabel)),
});

const OPENAPI_PROFILE_FIELD_KIND = Object.freeze({
	profileNote: 'nonEmptyString',
	sourceLayout: 'sourceLayout',
	sourceFileName: 'nonEmptyString',
	sourceFileNameList: 'distinctNonEmptyStringList',
	sourceFormat: 'sourceFormat',
	stableIdPrefix: 'stableIdPrefix',
	rootStableId: 'nonEmptyString',
	perStandardLabelByRole: 'perStandardLabelByRole',
	schemaExclusionList: 'stringList',
	statementOmissionDeclaration: 'statementOmissionDeclaration',
});
const COMMON_FIELD_NAME_LIST = Object.freeze(['profileNote', 'sourceLayout', 'sourceFormat', 'stableIdPrefix', 'rootStableId', 'perStandardLabelByRole', 'schemaExclusionList']);
const FIELD_NAME_LIST_BY_LAYOUT = Object.freeze({
	[SOURCE_LAYOUT.REFERENCED_SINGLE_FILE]: Object.freeze(COMMON_FIELD_NAME_LIST.concat(['sourceFileName'])),
	[SOURCE_LAYOUT.DEREFERENCED_MULTI_FILE]: Object.freeze(COMMON_FIELD_NAME_LIST.concat(['sourceFileNameList', 'statementOmissionDeclaration'])),
});

const refused = (what) => new Error(`${moduleName} REFUSED: ${what} — the openapi profile is the kit's whole seam; see lib/openapi-forge/openapiProfileContract.js`);

// sourceFileNameListOf — the files a profile reads, whatever its layout (one for referencedSingleFile)
const sourceFileNameListOf = (openapiProfile) => (openapiProfile.sourceLayout === SOURCE_LAYOUT.REFERENCED_SINGLE_FILE ? [openapiProfile.sourceFileName] : openapiProfile.sourceFileNameList);

// validateOpenapiProfile — throws a named refusal, or returns the profile unchanged
const validateOpenapiProfile = (openapiProfile) => {
	if (!isPlainObject(openapiProfile)) {
		throw refused(`the profile is ${openapiProfile === null ? 'null' : typeof openapiProfile}, not an object`);
	}
	const unknownFieldName = Object.keys(openapiProfile).find((fieldName) => OPENAPI_PROFILE_FIELD_KIND[fieldName] === undefined);
	if (unknownFieldName !== undefined) {
		throw refused(`field '${unknownFieldName}' is not in the contract (known: ${Object.keys(OPENAPI_PROFILE_FIELD_KIND).join(', ')})`);
	}
	if (!KIND_CHECK_BY_KIND.sourceLayout(openapiProfile.sourceLayout)) {
		throw refused(`required field 'sourceLayout' is ${JSON.stringify(openapiProfile.sourceLayout)}, not one of ${SOURCE_LAYOUT_LIST.join(', ')}; no layout is defaulted`);
	}
	const layoutFieldNameList = FIELD_NAME_LIST_BY_LAYOUT[openapiProfile.sourceLayout];
	const foreignFieldName = Object.keys(openapiProfile).find((fieldName) => layoutFieldNameList.indexOf(fieldName) === -1);
	if (foreignFieldName !== undefined) {
		throw refused(`field '${foreignFieldName}' does not belong to sourceLayout '${openapiProfile.sourceLayout}' (its fields: ${layoutFieldNameList.join(', ')})`);
	}
	const missingFieldName = layoutFieldNameList.find((fieldName) => openapiProfile[fieldName] === undefined);
	if (missingFieldName !== undefined) {
		throw refused(`required field '${missingFieldName}' is absent; no field is defaulted`);
	}
	if (NOT_YET_READABLE_SOURCE_FORMAT_LIST.indexOf(openapiProfile.sourceFormat) !== -1) {
		throw refused(`sourceFormat '${openapiProfile.sourceFormat}' is not read by the K0 kit (readable: ${READABLE_SOURCE_FORMAT_LIST.join(', ')}); the YAML reader arrives with its own twin in the lane that needs it`);
	}
	const misKindedFieldName = layoutFieldNameList.find((fieldName) => !KIND_CHECK_BY_KIND[OPENAPI_PROFILE_FIELD_KIND[fieldName]](openapiProfile[fieldName]));
	if (misKindedFieldName !== undefined) {
		throw refused(`field '${misKindedFieldName}' is ${JSON.stringify(openapiProfile[misKindedFieldName])}, not a valid ${OPENAPI_PROFILE_FIELD_KIND[misKindedFieldName]}`);
	}
	if (!openapiProfile.rootStableId.startsWith(openapiProfile.stableIdPrefix)) {
		throw refused(`rootStableId '${openapiProfile.rootStableId}' does not begin with stableIdPrefix '${openapiProfile.stableIdPrefix}'`);
	}
	return openapiProfile;
};

module.exports = { validateOpenapiProfile, sourceFileNameListOf, OPENAPI_PROFILE_FIELD_KIND, FIELD_NAME_LIST_BY_LAYOUT, SOURCE_LAYOUT, READABLE_SOURCE_FORMAT_LIST, LABELLED_ROLE_LIST, moduleName };
