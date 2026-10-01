'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// releaseForgeDeclaration.js — H1 for every PESC release bundle: the framework's declared shape
// (SPEC-forgeFramework-v1.md §4), built from the bundle's own data file.
//
//   buildForgeDeclaration({ releaseDeclarationData, releaseDeclarationName }) → frozen declaration
//
// releaseDeclarationData is the bundle's lib/releaseDeclaration.json, written by the scaffold tool:
// { releaseName, standard, version, standardKey, standardSource, standardDisplayName, labelPrefix,
//   stableUriPropertyName, rootStableId, rootLabel, stableIdPatternText, embedTextLabel }.
// Every name in it must equal what releaseNames.js derives from its standard and version; one that
// differs is refused by name, so a hand edit cannot quietly rename a release.
//
// THE FORGE DOES NO BRIDGING (FBB-001): mappingInstruction is empty, as the SIF rebuild's is.
// Texts and vectors follow DESIGN-pescForge.md §2.1: classes and properties get node vectors;
// support nodes (occurrences included), code lists and codes do not; the code list's own prose
// still reaches the vectors as a text node.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { DME_ROLES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { deriveReleaseNames } = require('./releaseNames');
const { MANIFEST_ENTRY_INPUT_NAME, MANIFEST_ENTRY_FILE_NAME } = require('./manifestEntryLoader');
const { donorSourceInputListFor } = require('./documentationDonorSet');

// the names the data file carries that the rule derives; each must agree
const DERIVED_NAME_LIST = Object.freeze([
	'standardKey',
	'standardSource',
	'standardDisplayName',
	'labelPrefix',
	'stableUriPropertyName',
	'rootStableId',
	'rootLabel',
	'stableIdPatternText',
	'embedTextLabel',
]);
const DATA_FIELD_NAME_LIST = Object.freeze(['releaseName', 'standard', 'version'].concat(DERIVED_NAME_LIST));

const buildForgeDeclaration = ({ releaseDeclarationData, releaseDeclarationName }) => {
	const dataFieldNameList = Object.keys(releaseDeclarationData);
	if (JSON.stringify(dataFieldNameList) !== JSON.stringify(DATA_FIELD_NAME_LIST)) {
		throw refuse.byName({ moduleName, what: `${releaseDeclarationName} names the fields ${dataFieldNameList.join(', ')}`, where: `a release declaration names exactly ${DATA_FIELD_NAME_LIST.join(', ')}, in that order` });
	}
	const derived = deriveReleaseNames({ standard: releaseDeclarationData.standard, version: releaseDeclarationData.version });
	if (derived.refusalMessage) {
		throw new Error(`${releaseDeclarationName}: ${derived.refusalMessage}`);
	}
	const disagreeingName = DERIVED_NAME_LIST.find((oneName) => releaseDeclarationData[oneName] !== derived.releaseNames[oneName]);
	if (disagreeingName !== undefined) {
		throw refuse.byName({ moduleName, what: `${releaseDeclarationName} ${disagreeingName} is '${releaseDeclarationData[disagreeingName]}', the naming rule gives '${derived.releaseNames[disagreeingName]}'`, where: 'release names follow releaseNames.js (DESIGN-pescForge.md §2.5); rescaffold rather than edit' });
	}

	const { standardKey, stableUriPropertyName } = releaseDeclarationData;
	return Object.freeze({
		standardKey,
		standardSource: releaseDeclarationData.standardSource,
		standardDisplayName: releaseDeclarationData.standardDisplayName,
		stableUriPropertyName,
		stableIdPattern: Object.freeze({ pattern: releaseDeclarationData.stableIdPatternText, trimmed: true }),
		rootStableIdFrom: 'declared',
		rootStableId: releaseDeclarationData.rootStableId,
		rootLabel: releaseDeclarationData.rootLabel,
		parserVersion: '1',
		// six keys in the framework's order: the stringified object is a block byte
		mappingInstruction: Object.freeze({
			cedsOriginalAnchorPropertyName: Object.freeze([]),
			cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
			crosswalkPrefix: Object.freeze([]),
			crosswalkResolveProperty: stableUriPropertyName,
			includeInImplied: false,
			impliedTargets: Object.freeze([]),
		}),
		nonEmbeddableRoleList: Object.freeze([DME_ROLES.SUPPORT, DME_ROLES.OPTION_SET, DME_ROLES.OPTION_VALUE]),
		embedTextDeclaration: Object.freeze({
			embedTextLabel: releaseDeclarationData.embedTextLabel,
			textPropertyListByRole: Object.freeze({
				[DME_ROLES.CLASS]: Object.freeze(['name', 'documentation']),
				[DME_ROLES.PROPERTY]: Object.freeze(['name', 'documentation', 'effectiveDocumentation', 'contextText']),
				[DME_ROLES.OPTION_SET]: Object.freeze(['name', 'documentation']),
			}),
		}),
		cedsAnchorAbsentSentinelList: Object.freeze([]),
		// the manifest entry is the snapshot's declared second input: the framework verifies it against
		// SHA256SUMS like the .xsd files and hands its path to loader 2 under this inputName. Then the
		// release's documentation donors (phase F-B, documentationDonorTable.json; none for most
		// releases), each verified the same way and handed to loader 3
		additionalSourceInputList: Object.freeze([Object.freeze({ inputName: MANIFEST_ENTRY_INPUT_NAME, relativePathFromSourcePath: MANIFEST_ENTRY_FILE_NAME })].concat(donorSourceInputListFor({ releaseName: releaseDeclarationData.releaseName }))),
		// EMPTY: a new bundle may declare no migration allowance
		compatibilityDeclarationList: Object.freeze([]),
	});
};

module.exports = { buildForgeDeclaration, DATA_FIELD_NAME_LIST, DERIVED_NAME_LIST, moduleName };
