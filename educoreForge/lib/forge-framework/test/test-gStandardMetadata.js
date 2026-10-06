#!/usr/bin/env node
'use strict';

// test-gStandardMetadata.js — G-STDMETA (lane R, leftovers 2026-10-05; TQ): what kind of standard a bundle is
// (standardKind) and how to read it in the graph (standardUsageTips) are DECLARED by the bundle's own forge declaration,
// stamped on its root by the framework, and read from the root by the StandardDefinition finisher. They replace lane P's
// configs/dmeStandardUsageTips.json side file. Pure: the declaration validator and rootNode.build, no graph.
//   (a) a declaration without standardKind is REFUSED by name (required on every bundle: absent is never defaulted)
//   (b) a standardKind outside vocabulary.STANDARD_KIND_LIST is REFUSED by name
//   (c) an empty standardUsageTips is REFUSED by name ('' is not a declared absence; null is)
//   (d) the root carries the declared standardKind and standardUsageTips
//   (e) a declared standardUsageTips: null leaves the root WITHOUT the property (absent is absent, never invented text)
//   (f) every bundle of the gold recipe (CEDS, Ed-Fi, SIF260928, the seven PESC releases) is accepted and declares
//       dataStandard with non-empty tips, and the seven PESC releases share one text
//   ⟪campaign P3, W-C-4 (V1-C32, CONTRACTS §7)⟫ the FAMILY a standard belongs to and WHICH member of it this release is:
//   (g) a declaration without standardFamily is REFUSED by name; (h) a family outside vocabulary.STANDARD_FAMILY_LIST is
//   REFUSED; (i) a blank releaseLabel is REFUSED; (j) the root carries both; (k) the gold bundles declare a family in the
//   list — the seven PESC releases PESC with seven DISTINCT version-free labels, CEDS / EdFi / SIF one each.
// RED TWINS, each observed in memory: (a) the contract row made optional; (b) the closed-value check accepting anything;
// (c) the tips checker accepting ''; (d) the root dropping standardKind; (e) null stamped as a property; (f) the PESC release
// declaration builder forgetting the tips.
//
// Run: node lib/forge-framework/test/test-gStandardMetadata.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-STDMETA: standardKind + standardUsageTips declared by the forge, refused when malformed, stamped on the root
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const moduleDouble = require('./testSupport/moduleDouble');

const FRAMEWORK_DIR = path.join(__dirname, '..');
const TREE_DIR = path.join(FRAMEWORK_DIR, '..', '..');
const CONTRACT_PATH = path.join(FRAMEWORK_DIR, 'forgeDeclarationContract.js');
const ROOT_PATH = path.join(FRAMEWORK_DIR, 'rootNode.js');
const RELEASE_DECLARATION_PATH = path.join(TREE_DIR, 'lib', 'pesc-release-forge', 'releaseForgeDeclaration.js');
const toyForgeDeclaration = require('./fixtures/toyForge/lib/toyForgeDeclaration');

const loadFor = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : moduleDouble.loadWithMutations({ modulePath, mutationList }));
const validationMessageFor = (mutationList, forgeDeclaration) => {
	const refusal = loadFor(CONTRACT_PATH, mutationList).validateForgeDeclaration({ forgeDeclaration });
	return refusal ? refusal.message : '';
};
const withChange = (changeByName) => {
	const changed = { ...toyForgeDeclaration, ...changeByName };
	Object.keys(changeByName).filter((oneName) => changeByName[oneName] === undefined).forEach((oneName) => delete changed[oneName]);
	return changed;
};
const TOY_METADATA = { version: '1', sourceFormat: 'toy', sourceFiles: ['toy.txt'], sourceUrl: 'https://example.org/toy', snapshotKey: '01', publishedVersion: '1', versionSource: 'declared' };
const rootPropertiesFor = (mutationList, forgeDeclaration) => loadFor(ROOT_PATH, mutationList).build({ forgeDeclaration, metadata: TOY_METADATA, describedRoot: {} }).properties;

// the gold recipe's ten bundles: each bundle's declaration module, by the path its entry module requires
const GOLD_BUNDLE_DECLARATION_PATH_LIST = [
	path.join(TREE_DIR, 'forges', 'ceds', 'lib', 'cedsForgeDeclaration.js'),
	path.join(TREE_DIR, 'forges', 'edfi', 'lib', 'edfiForgeDeclaration.js'),
	path.join(TREE_DIR, 'forges', 'sif260928', 'lib', 'sif260928ForgeDeclaration.js'),
].concat(
	['pesccollegetranscript1v8v0', 'peschighschooltranscript1v6v0', 'pesctestscorereport1v1v0', 'pesclearningrecord1v0v0', 'pescdocumentrequest1v0v0', 'pescdocumentresponse1v0v0', 'pescacademiceportfolio1v0v0'].map((oneBundleName) =>
		path.join(TREE_DIR, 'forges', oneBundleName, 'lib', 'declaration.js'),
	),
);
const PESC_RELEASE_BUNDLE_PREFIX = 'PESC-';
// the families the gold recipe's bundles declare (W-C-4): written here as literals so the gate states the contract it checks
const EXPECTED_GOLD_FAMILY_BY_SOURCE_PREFIX = Object.freeze({ CEDS: 'CEDS', EdFi: 'EdFi', SIF260928: 'SIF', 'PESC-': 'PESC' });
const familyExpectedFor = (standardSource) => EXPECTED_GOLD_FAMILY_BY_SOURCE_PREFIX[Object.keys(EXPECTED_GOLD_FAMILY_BY_SOURCE_PREFIX).find((onePrefix) => standardSource.indexOf(onePrefix) === 0)];

const conjunctJudgeByRefId = {
	a_missingKindRefused: (mutationList) => {
		const message = validationMessageFor(mutationList, withChange({ standardKind: undefined }));
		return { pass: /forgeDeclaration is missing required property 'standardKind'/.test(message), detail: message || 'accepted a declaration with no standardKind' };
	},
	b_kindOutsideVocabularyRefused: (mutationList) => {
		const message = validationMessageFor(mutationList, withChange({ standardKind: 'vibes' }));
		return { pass: /forgeDeclaration 'standardKind' 'vibes' is not one of: dataStandard, classificationTaxonomy/.test(message), detail: message || "accepted standardKind 'vibes'" };
	},
	c_emptyTipsRefused: (mutationList) => {
		const message = validationMessageFor(mutationList, withChange({ standardUsageTips: '  ' }));
		const nullMessage = validationMessageFor(mutationList, withChange({ standardUsageTips: null }));
		return { pass: /forgeDeclaration 'standardUsageTips' must be a non-empty string or null/.test(message) && nullMessage === '', detail: `blank: ${message || 'accepted'}; null: ${nullMessage || 'accepted'}` };
	},
	d_rootCarriesDeclaredValues: (mutationList) => {
		const properties = rootPropertiesFor(mutationList, toyForgeDeclaration);
		return { pass: properties.standardKind === 'dataStandard' && properties.standardUsageTips === 'Toy usage tips.', detail: `root standardKind ${JSON.stringify(properties.standardKind)}, standardUsageTips ${JSON.stringify(properties.standardUsageTips)}` };
	},
	e_nullTipsLeaveNoProperty: (mutationList) => {
		const properties = rootPropertiesFor(mutationList, withChange({ standardUsageTips: null }));
		return { pass: properties.standardKind === 'dataStandard' && !('standardUsageTips' in properties), detail: `root keys standardUsageTips present: ${'standardUsageTips' in properties} (${JSON.stringify(properties.standardUsageTips)})` };
	},
	f_goldBundlesDeclareKindAndTips: (mutationList) => {
		// the PESC release declarations are BUILT by the shared library; a twin mutates that builder, so each release's
		// declaration is rebuilt here through the (possibly mutated) builder from its own releaseDeclaration.json
		const releaseBuilder = loadFor(RELEASE_DECLARATION_PATH, mutationList);
		const declarationList = GOLD_BUNDLE_DECLARATION_PATH_LIST.map((oneDeclarationPath) =>
			path.basename(oneDeclarationPath) === 'declaration.js'
				? releaseBuilder.buildForgeDeclaration({ releaseDeclarationData: require(path.join(path.dirname(oneDeclarationPath), 'releaseDeclaration.json')), releaseDeclarationName: oneDeclarationPath })
				: require(oneDeclarationPath),
		);
		const faultList = declarationList.reduce((soFar, oneDeclaration) => {
			const refusal = require(CONTRACT_PATH).validateForgeDeclaration({ forgeDeclaration: oneDeclaration });
			return soFar
				.concat(refusal ? [`${oneDeclaration.standardSource}: ${refusal.message.slice(0, 200)}`] : [])
				.concat(oneDeclaration.standardKind === 'dataStandard' ? [] : [`${oneDeclaration.standardSource}: standardKind ${JSON.stringify(oneDeclaration.standardKind)}`])
				.concat(typeof oneDeclaration.standardUsageTips === 'string' && oneDeclaration.standardUsageTips.trim() ? [] : [`${oneDeclaration.standardSource}: no tips`]);
		}, []);
		const pescTipsList = declarationList.filter((oneDeclaration) => oneDeclaration.standardSource.indexOf(PESC_RELEASE_BUNDLE_PREFIX) === 0).map((oneDeclaration) => oneDeclaration.standardUsageTips);
		const pescShareOneText = pescTipsList.length === 7 && pescTipsList.every((oneTips) => oneTips === pescTipsList[0]);
		return { pass: faultList.length === 0 && pescShareOneText, detail: faultList.length ? faultList.join('; ') : `${declarationList.length} bundles declare dataStandard + tips; PESC releases share one text: ${pescShareOneText}` };
	},
	g_missingFamilyRefused: (mutationList) => {
		const message = validationMessageFor(mutationList, withChange({ standardFamily: undefined }));
		return { pass: /forgeDeclaration is missing required property 'standardFamily'/.test(message), detail: message || 'accepted a declaration with no standardFamily' };
	},
	h_familyOutsideVocabularyRefused: (mutationList) => {
		const message = validationMessageFor(mutationList, withChange({ standardFamily: 'Pesc' }));
		return { pass: /forgeDeclaration 'standardFamily' 'Pesc' is not one of: /.test(message), detail: message || "accepted standardFamily 'Pesc'" };
	},
	i_blankReleaseLabelRefused: (mutationList) => {
		const message = validationMessageFor(mutationList, withChange({ releaseLabel: ' ' }));
		return { pass: /forgeDeclaration 'releaseLabel'/.test(message), detail: message || 'accepted a blank releaseLabel' };
	},
	j_rootCarriesFamilyAndLabel: (mutationList) => {
		// a root builder that drops the family is refused by its own REQUIRED_PROPERTIES.STANDARD_ROOT check: that refusal is
		// the conjunct failing, not the suite crashing
		let properties = {};
		let buildRefusal = '';
		try {
			properties = rootPropertiesFor(mutationList, toyForgeDeclaration);
		} catch (buildError) {
			buildRefusal = buildError.message;
		}
		if (buildRefusal) {
			return { pass: false, detail: `the root build refused: ${buildRefusal.slice(0, 200)}` };
		}
		return { pass: typeof properties.standardFamily === 'string' && properties.standardFamily === toyForgeDeclaration.standardFamily && typeof properties.releaseLabel === 'string' && properties.releaseLabel === toyForgeDeclaration.releaseLabel, detail: `root standardFamily ${JSON.stringify(properties.standardFamily)}, releaseLabel ${JSON.stringify(properties.releaseLabel)}` };
	},
	k_goldBundlesDeclareFamilyAndLabel: (mutationList) => {
		const releaseBuilder = loadFor(RELEASE_DECLARATION_PATH, mutationList);
		const declarationList = GOLD_BUNDLE_DECLARATION_PATH_LIST.map((oneDeclarationPath) =>
			path.basename(oneDeclarationPath) === 'declaration.js'
				? releaseBuilder.buildForgeDeclaration({ releaseDeclarationData: require(path.join(path.dirname(oneDeclarationPath), 'releaseDeclaration.json')), releaseDeclarationName: oneDeclarationPath })
				: require(oneDeclarationPath),
		);
		const faultList = declarationList.filter((oneDeclaration) => oneDeclaration.standardFamily !== familyExpectedFor(oneDeclaration.standardSource) || typeof oneDeclaration.releaseLabel !== 'string' || !oneDeclaration.releaseLabel.trim() || /\d+\.\d+/.test(oneDeclaration.releaseLabel)).map((oneDeclaration) => `${oneDeclaration.standardSource}: ${JSON.stringify(oneDeclaration.standardFamily)} / ${JSON.stringify(oneDeclaration.releaseLabel)}`);
		const pescLabelList = declarationList.filter((oneDeclaration) => oneDeclaration.standardFamily === 'PESC').map((oneDeclaration) => oneDeclaration.releaseLabel);
		const distinctPescLabelCount = new Set(pescLabelList).size;
		return { pass: faultList.length === 0 && pescLabelList.length === 7 && distinctPescLabelCount === 7, detail: faultList.length ? faultList.join('; ') : `${declarationList.length} bundles; PESC labels ${distinctPescLabelCount} distinct of ${pescLabelList.length} (${pescLabelList.join(', ')})` };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_missingKindRefused', twinName: 'kindOptional', modulePath: CONTRACT_PATH, find: "standardKind: Object.freeze({ required: true, kind: 'closedValue'", replace: "standardKind: Object.freeze({ required: false, kind: 'closedValue'" },
	{ conjunctRefId: 'b_kindOutsideVocabularyRefused', twinName: 'closedValueAcceptsAnything', modulePath: CONTRACT_PATH, find: '\t\tcontractEntry.allowedValueList.indexOf(value) !== -1\n', replace: '\t\ttrue\n' },
	{ conjunctRefId: 'c_emptyTipsRefused', twinName: 'blankTipsAccepted', modulePath: CONTRACT_PATH, find: "(typeof value === 'string' && value.trim().length > 0)", replace: "(typeof value === 'string')" },
	{ conjunctRefId: 'd_rootCarriesDeclaredValues', twinName: 'rootDropsKind', modulePath: ROOT_PATH, find: '\t\tstandardKind,\n\t\t...(standardUsageTips', replace: '\t\t...(standardUsageTips' },
	{ conjunctRefId: 'e_nullTipsLeaveNoProperty', twinName: 'nullStampedAsProperty', modulePath: ROOT_PATH, find: '...(standardUsageTips === null ? {} : { standardUsageTips }),', replace: 'standardUsageTips,' },
	{ conjunctRefId: 'f_goldBundlesDeclareKindAndTips', twinName: 'releaseBuilderForgetsTips', modulePath: RELEASE_DECLARATION_PATH, find: '\t\tstandardUsageTips: PESC_RELEASE_STANDARD_USAGE_TIPS,\n', replace: '\t\tstandardUsageTips: null,\n' },
	{ conjunctRefId: 'g_missingFamilyRefused', twinName: 'familyOptional', modulePath: CONTRACT_PATH, find: "standardFamily: Object.freeze({ required: true, kind: 'closedValue'", replace: "standardFamily: Object.freeze({ required: false, kind: 'closedValue'" },
	{ conjunctRefId: 'h_familyOutsideVocabularyRefused', twinName: 'familyAnyString', modulePath: CONTRACT_PATH, find: "standardFamily: Object.freeze({ required: true, kind: 'closedValue', allowedValueList: STANDARD_FAMILY_LIST }),", replace: "standardFamily: Object.freeze({ required: true, kind: 'nonEmptyString' })," },
	{ conjunctRefId: 'i_blankReleaseLabelRefused', twinName: 'labelOptional', modulePath: CONTRACT_PATH, find: "releaseLabel: Object.freeze({ required: true, kind: 'nonBlankString' }),", replace: "releaseLabel: Object.freeze({ required: true, kind: 'nonEmptyString' })," },
	{ conjunctRefId: 'j_rootCarriesFamilyAndLabel', twinName: 'rootDropsFamily', modulePath: ROOT_PATH, find: '\t\tstandardFamily,\n\t\treleaseLabel,\n', replace: '\t\treleaseLabel,\n' },
	{ conjunctRefId: 'k_goldBundlesDeclareFamilyAndLabel', twinName: 'releaseBuilderLabelsByFamily', modulePath: RELEASE_DECLARATION_PATH, find: '\t\treleaseLabel: releaseDeclarationData.standard,\n', replace: "\t\treleaseLabel: 'PESC',\n" },
];

harness.section('BASELINE — the real contract, root builder and bundle declarations pass every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a module double (in memory)');
harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(conjunctJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	moduleDouble.assertMutationApplies({ modulePath: oneTwin.modulePath, find: oneTwin.find });
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ modulePath: oneTwin.modulePath, find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
harness.report();
