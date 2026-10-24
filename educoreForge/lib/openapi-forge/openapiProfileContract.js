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
// sourceFormat is a closed list: the formats openapiSourceParser.js has a parser for (json; yaml since K2a, wave 2 lane E, CASE 1.1).
//
// statementOmissionDeclaration (K1c, ruled by BRONZE_CROWN 2026-10-24 for LIF; dereferencedMultiFile only) names, BY NAME, the source
// statements the walk does not carry and the pair declares omitted, so they reach explicitlyOmittedTotal and never lostTotal:
//   emptyValueKeywordList  keywords whose EMPTY value ('' , or [] for a list) states nothing. An empty value of an unlisted keyword is
//                          still refused; a listed keyword the source never states empty is refused as stale.
//   enumMemberRepeatList   { enumObjectPointer: '<Schema><JSON pointer of the object holding the enum>', memberText }: one enum member the
//                          source lists twice, carried once. An unlisted repeat is still refused; a listed one the source lacks is stale.
// Both lists may be empty (JEDx states none); the field itself is required, so no bundle is silently given an empty declaration.
//
// ⟪K2, wave 2 lane E, ruled by BRONZE_CROWN 2026-10-24 for CASE 1.1⟫ two fields REQUIRED in EVERY profile, whatever the layout:
//   listValuedVendorExtensionNameList  vendor extensions (x-…) the source states as a LIST of strings, by name: carried as JSON text and
//                                      read back by the pair through this declaration. An unlisted list is still refused; a listed
//                                      name the source never states as a list is refused as stale.
//   enumMemberTextDeclarationList      { enumObjectPointer: '<Schema><JSON pointer of the object holding the enum>', statedValue,
//                                      carriedText }: an enum member the source types as a NUMBER or BOOLEAN (YAML's unquoted 1.1),
//                                      carried as text. carriedText must be the stated scalar's own text (String(statedValue)): the
//                                      declaration restores a spelling, it can never rename a member. The pair counts the retyping as
//                                      a declared omission (declaredMemberText).
// The dereferencedMultiFile walk carries no vendor extension and reads no member text, so under that layout both must be empty
// (FIELD_REQUIRED_EMPTY_BY_LAYOUT): a non-empty one would otherwise be ignored in silence.

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { SOURCE_FORMAT_LIST } = require('./openapiSourceParser');
const keywordRegistry = require('./openapiKeywordRegistry.json');

const READABLE_SOURCE_FORMAT_LIST = SOURCE_FORMAT_LIST;
const VENDOR_EXTENSION_NAME_PATTERN = new RegExp(keywordRegistry.vendorExtensionRule.namePatternSource);
const MEMBER_TEXT_DECLARATION_FIELD_NAME_LIST = Object.freeze(['carriedText', 'enumObjectPointer', 'statedValue']);
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
	vendorExtensionNameList: (candidate) => Array.isArray(candidate) && candidate.every((oneName) => typeof oneName === 'string' && VENDOR_EXTENSION_NAME_PATTERN.test(oneName))
		&& new Set(candidate).size === candidate.length,
	enumMemberTextDeclarationList: (candidate) => Array.isArray(candidate)
		&& candidate.every((oneDeclaration) => isPlainObject(oneDeclaration)
			&& JSON.stringify(Object.keys(oneDeclaration).sort()) === JSON.stringify(MEMBER_TEXT_DECLARATION_FIELD_NAME_LIST)
			&& typeof oneDeclaration.enumObjectPointer === 'string' && oneDeclaration.enumObjectPointer.length > 0
			&& (typeof oneDeclaration.statedValue === 'number' || typeof oneDeclaration.statedValue === 'boolean')
			&& oneDeclaration.carriedText === String(oneDeclaration.statedValue))
		&& new Set(candidate.map((oneDeclaration) => JSON.stringify([oneDeclaration.enumObjectPointer, oneDeclaration.statedValue]))).size === candidate.length,
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
	listValuedVendorExtensionNameList: 'vendorExtensionNameList',
	enumMemberTextDeclarationList: 'enumMemberTextDeclarationList',
});
const COMMON_FIELD_NAME_LIST = Object.freeze(['profileNote', 'sourceLayout', 'sourceFormat', 'stableIdPrefix', 'rootStableId', 'perStandardLabelByRole', 'schemaExclusionList', 'listValuedVendorExtensionNameList', 'enumMemberTextDeclarationList']);
const FIELD_NAME_LIST_BY_LAYOUT = Object.freeze({
	[SOURCE_LAYOUT.REFERENCED_SINGLE_FILE]: Object.freeze(COMMON_FIELD_NAME_LIST.concat(['sourceFileName'])),
	[SOURCE_LAYOUT.DEREFERENCED_MULTI_FILE]: Object.freeze(COMMON_FIELD_NAME_LIST.concat(['sourceFileNameList', 'statementOmissionDeclaration'])),
});
// the K2 list fields a layout's walk does not read: required (as every field) but refused unless empty
const FIELD_REQUIRED_EMPTY_BY_LAYOUT = Object.freeze({
	[SOURCE_LAYOUT.REFERENCED_SINGLE_FILE]: Object.freeze([]),
	[SOURCE_LAYOUT.DEREFERENCED_MULTI_FILE]: Object.freeze(['listValuedVendorExtensionNameList', 'enumMemberTextDeclarationList']),
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
	const misKindedFieldName = layoutFieldNameList.find((fieldName) => !KIND_CHECK_BY_KIND[OPENAPI_PROFILE_FIELD_KIND[fieldName]](openapiProfile[fieldName]));
	if (misKindedFieldName !== undefined) {
		throw refused(`field '${misKindedFieldName}' is ${JSON.stringify(openapiProfile[misKindedFieldName])}, not a valid ${OPENAPI_PROFILE_FIELD_KIND[misKindedFieldName]}`);
	}
	const unreadFieldName = FIELD_REQUIRED_EMPTY_BY_LAYOUT[openapiProfile.sourceLayout].find((fieldName) => openapiProfile[fieldName].length !== 0);
	if (unreadFieldName !== undefined) {
		throw refused(`field '${unreadFieldName}' must be empty under sourceLayout '${openapiProfile.sourceLayout}': that layout's walk does not read it, so a non-empty one would be ignored in silence`);
	}
	if (!openapiProfile.rootStableId.startsWith(openapiProfile.stableIdPrefix)) {
		throw refused(`rootStableId '${openapiProfile.rootStableId}' does not begin with stableIdPrefix '${openapiProfile.stableIdPrefix}'`);
	}
	return openapiProfile;
};

module.exports = { validateOpenapiProfile, sourceFileNameListOf, OPENAPI_PROFILE_FIELD_KIND, FIELD_NAME_LIST_BY_LAYOUT, SOURCE_LAYOUT, READABLE_SOURCE_FORMAT_LIST, LABELLED_ROLE_LIST, moduleName };
