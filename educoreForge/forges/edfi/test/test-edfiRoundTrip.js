#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     test-edfiRoundTrip.js — HERMETIC suite for the forge-edfi roundTripValidator (Phase 3)

DESCRIPTION
     RT-7 in full: builds throwaway five-input snapshots under os.tmpdir(), forges them with
     forgeEdfi (skipEmbedding), replays the forge output through the hermetic graph double,
     runs the REAL validator core (validateWithReader), and proves:
       - the CARRIABLE-vocabulary fixture round-trips CLEAN (zero loss, zero invention)
       - the FULL-vocabulary fixture (interchanges, per-item metaEdIds, qualified components)
         invents NOTHING and loses EXACTLY the ruled backlog classes (R-WO-15d + extension)
       - the cheating detector: deleting a REAL graph fact names it LOST; injecting one fires
         INVENTED — both through the double's adjustGraphRows seam, at the DATA level
       - the crosswalk invention guard bites at the DATA level (a doctored stash raw value)
       - refusals are BY NAME (intake, bolt resolution, reducer scope limits)
       - the canonicalizer is bounded BOTH directions (cosmetic variants collapse; adversarial
         pairs stay distinct)
       - the two independent readers agree (reducer census vs Phase 1 parser census — the
         parser is used HERE as the cross-check reader, never as the answer key)
       - the RT-10 gate suite: 16 gates evaluated green AND every twin observed RED
         (observations logged to test-artifacts/roundTripGateTwinObservations.log)

     Touches no real snapshot bytes, no Docker, no network, no embedding provider.

EXIT
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const harness = require('../../../test/testLib/harness')(moduleName);

const forgeEdfi = require('../forgeEdfi.js')({});
const metaEdParser = require('../lib/metaEdParser')(); // CROSS-CHECK reader only (G-8), never the answer key
const roundTripMetaEdCanonical = require('../lib/roundTripMetaEdCanonical')();
const roundTripEdfiCompiler = require('../lib/roundTripEdfiCompiler')();
const roundTripGraphDouble = require('../lib/roundTripGraphDouble')();
const roundTripValidator = require('../roundTripValidator')();
const roundTripGates = require('../lib/roundTripGates')();
const roundTripGateTwins = require('../lib/roundTripGateTwins')();

const GATES_FILE_PATH = path.join(__dirname, '..', 'gates', 'edfiRoundTripGates.jsonc');
const TEST_ARTIFACTS_PATH = path.join(__dirname, 'test-artifacts');
const TWIN_OBSERVATION_LOG_PATH = path.join(TEST_ARTIFACTS_PATH, 'roundTripGateTwinObservations.log');

// =====================================================================
// fixture texts — the CARRIABLE vocabulary (everything the graph carries losslessly)
// =====================================================================

const CORE_ENTITIES_METAED = [
	'Abstract Entity FixtureOrganization [9001]',
	'    documentation "An abstract fixture organization."',
	'    integer FixtureOrganizationId [9002]',
	'        documentation "The fixture organization identifier."',
	'        is part of identity',
	'        min value 1',
	'        max value 999999',
	'',
	'Domain Entity FixtureSchool [9020]',
	'    documentation "A fixture school."',
	'    allow primary key updates',
	'    integer FixtureSchoolId [9021]',
	'        documentation "The fixture school identifier."',
	'        is part of identity',
	'    string FixtureSchoolName [9022]',
	'        documentation "The fixture school name."',
	'        is required',
	'        min length 1',
	'        max length 75',
	'    shared decimal FixtureRate named FundingRate [9023]',
	'        documentation "The fixture funding rate."',
	'        is optional',
	'    year FixtureOpenedYear [9024]',
	'        documentation "The fixture year opened."',
	'        is optional',
	'        is queryable field',
	'',
	'Domain Entity FixtureStudent [9010]',
	'    deprecated "Use FixtureLearner in a future fixture."',
	'    documentation "A fixture student."',
	'    shared string FixtureName named StudentName [9011]',
	'        documentation "The fixture student name."',
	'        is part of identity',
	'    bool FixtureActiveIndicator [9012]',
	'        documentation inherited',
	'        is optional',
	'    descriptor FixtureLevel [9014]',
	'        documentation "A fixture level descriptor reference."',
	'        is required',
	'        is queryable field',
	'    domain entity FixtureSchool [9015]',
	'        documentation "A fixture home school reference."',
	'        is optional',
	'        role name Home',
	'        potentially logical',
	'        is weak',
	'        merge Home.FixtureSchoolId with FixtureStudent.FixtureSchoolId',
	'    domain entity FixtureSchool [9016]',
	'        documentation "A former fixture school reference."',
	'        is optional collection',
	'        role name Former',
	'    enumeration FixtureYear [9017]',
	'        documentation "A fixture year reference."',
	'        is optional',
	'    common FixtureAddress [9018]',
	'        documentation "A fixture address."',
	'        is optional collection',
	'    choice FixtureContactChoice [9019]',
	'        documentation "A fixture contact choice."',
	'        is optional',
	'    inline common FixtureGeo [9033]',
	'        documentation "A fixture geo block."',
	'        is optional',
	'    shared short FixtureRank [9034]',
	'        documentation "A fixture rank."',
	'        is optional',
	'    decimal FixtureGpa [9032]',
	'        documentation "A fixture GPA."',
	'        is optional',
	'        total digits 4',
	'        decimal places 2',
	'        min value 0',
	'        max value 5.0',
	'    date FixtureBirthDate [9030]',
	'        documentation "A fixture birth date."',
	'        is optional',
	'    time FixtureStartTime [9028]',
	'        documentation "A fixture start time."',
	'        is optional',
	'    datetime FixtureStamp [9029]',
	'        documentation "A fixture timestamp."',
	'        is optional',
	'    duration FixtureDuration [9025]',
	'        documentation "A fixture duration."',
	'        is optional',
	'    currency FixtureFee [9026]',
	'        documentation "A fixture fee."',
	'        is optional',
	'    percent FixtureEffort [9027]',
	'        documentation "A fixture effort."',
	'        is optional',
	'    short FixtureShortCode [9031]',
	'        documentation "A fixture short code."',
	'        is optional',
	'',
	'Domain Entity FixtureCharter based on FixtureSchool [9040]',
	'    documentation "A fixture charter school subclass."',
	'    integer FixtureCharterId [9041]',
	'        documentation "The fixture charter identifier."',
	'        renames identity property FixtureSchoolId',
	'    string FixtureAuthorizer [9042]',
	'        documentation "The fixture charter authorizer."',
	'        is queryable only',
	'        max length 40',
].join('\n');

const CORE_SUPPORT_METAED = [
	'Association FixtureEnrollment [9100]',
	'    documentation "A fixture enrollment association."',
	'    domain entity FixtureStudent [9101]',
	'        documentation "The enrolled fixture student."',
	'    domain entity FixtureSchool [9102]',
	'        documentation "The peer fixture school."',
	'        role name Peer',
	'    date FixtureBeginDate [9103]',
	'        documentation "The fixture enrollment begin date."',
	'        is part of identity',
	'',
	'Association FixtureSpecialEnrollment based on FixtureEnrollment [9110]',
	'    documentation "A fixture special enrollment subclass."',
	'    bool FixtureSpecialFlag [9111]',
	'        documentation "The fixture special flag."',
	'        is optional',
	'',
	'Choice FixtureContactChoice [9120]',
	'    documentation "A fixture contact choice."',
	'    shared string FixtureName named ContactName [9121]',
	'        documentation "A fixture contact name."',
	'        is required',
	'    inline common FixtureGeo [9122]',
	'        documentation "A fixture geo alternative."',
	'        is required',
	'',
	'Common FixtureAddress [9130]',
	'    documentation "A fixture address common."',
	'    string FixtureStreet [9131]',
	'        documentation "The fixture street."',
	'        is required',
	'        max length 150',
	'',
	'Common FixtureIntlAddress based on FixtureAddress [9135]',
	'    documentation "A fixture international address subclass."',
	'    string FixtureCountryCode [9136]',
	'        documentation "The fixture country code."',
	'        is required',
	'        max length 8',
	'',
	'Inline Common FixtureGeo [9140]',
	'    documentation "A fixture geo inline common."',
	'    decimal FixtureLatitude [9141]',
	'        documentation "The fixture latitude."',
	'        is required',
	'        total digits 9',
	'        decimal places 6',
	'',
	'Enumeration FixtureYear [9150]',
	'    documentation "A fixture school year enumeration."',
	'    item "2024-2025" [9150-001]',
	'    item "2025-2026" [9150-002]',
	'',
	'Descriptor FixtureLevel [9160]',
	'    documentation "A fixture level descriptor."',
	'',
	'Descriptor FixtureMode [9170]',
	'    documentation "A fixture mode descriptor with a map type."',
	'    with optional map type',
	'    documentation "The fixture mode map type."',
	'    item "ModeOne" [9170-001]',
	'    item "ModeTwo" [9170-002]',
	'',
	'Shared String FixtureName [9180]',
	'    documentation "A fixture name shared string."',
	'    min length 1',
	'    max length 60',
	'',
	'Shared Integer FixtureCount [9181]',
	'    documentation "A fixture count shared integer."',
	'    min value 0',
	'    max value big',
	'',
	'Shared Short FixtureRank [9182]',
	'    documentation "A fixture rank shared short."',
	'    min value 1',
	'    max value 10',
	'',
	'Shared Decimal FixtureRate [9183]',
	'    documentation "A fixture rate shared decimal."',
	'    total digits 5',
	'    decimal places 4',
	'    min value 0',
	'    max value 1',
	'',
	'Domain FixtureDomain [9190]',
	'    documentation "A fixture domain."',
	'    domain entity FixtureStudent',
	'    domain entity FixtureSchool',
	'    association FixtureEnrollment',
	'    footer documentation "A fixture domain footer."',
	'',
	'Subdomain FixtureSub of FixtureDomain [9195]',
	'    documentation "A fixture subdomain."',
	'    domain entity FixtureStudent',
	'    position 1',
].join('\n');

const TPDM_METAED = [
	'Domain Entity FixtureCandidate [9200]',
	'    documentation "A fixture TPDM candidate."',
	'    shared string EdFi.FixtureName named CandidateName [9201]',
	'        documentation "The fixture candidate name."',
	'        is part of identity',
	'    domain entity EdFi.FixtureStudent [9202]',
	'        documentation "The fixture student this candidate was."',
	'        is optional',
	'',
	'Association EdFi.FixtureEnrollment additions [9210]',
	'    shared decimal EdFi.FixtureRate named ExtensionRate [9211]',
	'        documentation "A fixture extension rate."',
	'        is optional',
	'',
	'Common EdFi.FixtureAddress additions [9220]',
	'    string FixtureRegionTag [9221]',
	'        documentation "A fixture region tag."',
	'        is optional',
	'        max length 30',
	'',
	'Descriptor FixtureBadge [9230]',
	'    documentation "A fixture TPDM badge descriptor."',
	'',
	'Domain Entity EdFi.FixtureSchool additions [9240]',
	'    descriptor FixtureBadge [9241]',
	'        documentation "A fixture badge on the extended school."',
	'        is optional',
].join('\n');

// the FULL-vocabulary additions: interchanges (componentKind), per-item metaEdIds, qualified
// components — the three ruled loss classes, and nothing else
const CORE_INTERCHANGE_METAED = [
	'Interchange FixtureInterchange [9300]',
	'    documentation "A fixture interchange."',
	'    extended documentation "Extended fixture interchange documentation."',
	'    use case documentation "Fixture use case documentation."',
	'    domain entity FixtureStudent [9300-001]',
	'    domain entity identity FixtureSchool [9300-002]',
	'    association FixtureEnrollment',
].join('\n');

const TPDM_INTERCHANGE_METAED = [
	'Interchange EdFi.FixtureInterchange additions [9310]',
	'    domain entity FixtureCandidate',
	'    domain entity EdFi.FixtureStudent [9310-001]',
].join('\n');

const CORE_LEVEL_XML = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<InterchangeDescriptors>',
	'  <FixtureLevelDescriptor>',
	'    <CodeValue>Alpha</CodeValue>',
	'    <ShortDescription>Alpha level</ShortDescription>',
	'    <Description>The alpha fixture level.</Description>',
	'    <Namespace>uri://fixture/FixtureLevelDescriptor</Namespace>',
	'  </FixtureLevelDescriptor>',
	'  <FixtureLevelDescriptor>',
	'    <CodeValue>Gamma </CodeValue>',
	'    <ShortDescription>Gamma level with a verbatim trailing space</ShortDescription>',
	'    <Description>The gamma fixture level.</Description>',
	'    <Namespace>uri://fixture/FixtureLevelDescriptor</Namespace>',
	'  </FixtureLevelDescriptor>',
	'</InterchangeDescriptors>',
].join('\n');

const TPDM_BADGE_XML = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<InterchangeDescriptors>',
	'  <FixtureBadgeDescriptor>',
	'    <CodeValue>Bronze</CodeValue>',
	'    <ShortDescription>Bronze badge</ShortDescription>',
	'    <Description>The bronze fixture badge.</Description>',
	'    <Namespace>uri://fixture/FixtureBadgeDescriptor</Namespace>',
	'  </FixtureBadgeDescriptor>',
	'</InterchangeDescriptors>',
].join('\n');

const ELEMENTS_CSV_TEXT = [
	'EdFiEntity,EdFiEntityPath,EdFiElementName,EdFiElementType,EdFiRequired,EdFiElementDescription,EdFiEntityDescription,CEDSElementName,CEDSElementType,CEDSElementDefinition,CEDSGlobalId,CEDSMappingNotes,CEDSMappingConfidence,CEDSDWTable,CEDSDWColumn,CEDSDWElementType,CEDSStagingTable,CEDSStagingColumn,CEDSStagingElementType,CEDSOntologyClassURI,CEDSOntologyClassLabel,CEDSOntologyConceptSchemeURI,CEDSOntologyConceptSchemeLabel,CEDSOntologyPropertyURI,CEDSOntologyPropertyLabel,CEDSOntologyPropertyNotation,CEDSOntologyPropertyRangeIncludes',
	'FixtureStudent,FixtureStudent,FixtureLevel,descriptor,required,The level element.,A fixture student.,Fixture Level Type,option set,The fixture level.,000456,,High,,,,,,,,,,,,,,',
	'FixtureStudent,FixtureStudent,MissingElement,string,optional,An element the model does not carry.,A fixture student.,Fixture Missing,string,The missing one.,000457,,Low,,,,,,,,,,,,,,',
	'',
].join('\n');

const DESCRIPTORS_CSV_TEXT = [
	'EdFiVersionNumber,EdFiNamespace,EdFiCodeValue,EdFiShortDescription,EdFiDescription,EdFiElementName,EdFiEntity,EdFiPath,EdFiDescription,CEDSElementName,CEDSGlobalId,CEDSOptionCode,CEDSOptionDescription,CEDSOptionDefinition,CEDSDataType,OptionSetMatchConfidence,ElementMatchConfidence,Notes',
	'DS5.2,uri://fixture/FixtureLevelDescriptor,Alpha,Alpha level,The alpha fixture level.,FixtureLevelDescriptor,FixtureStudent,FixtureLevel,The level element.,Fixture Level Type,000456,AlphaOption,The alpha option.,,,High,High,',
	'',
].join('\n');

// =====================================================================
// scratch snapshot plumbing
// =====================================================================

const CARRIABLE_FILE_MAP = {
	'README_PROVENANCE.md': '# scratch provenance (hermetic Phase 3 round-trip fixture)\n',
	standardSourceLocation: 'standard: forge-edfi\npublishedVersion: fixture\n',
	'metaEdModel/package.json': JSON.stringify({
		name: '@edfi/scratch-model',
		metaEdProject: { projectName: 'Ed-Fi', projectVersion: '5.2.0' },
	}),
	'metaEdModel/DomainEntity/FixtureEntities.metaed': CORE_ENTITIES_METAED,
	'metaEdModel/Support/FixtureSupport.metaed': CORE_SUPPORT_METAED,
	'tpdmCommunityModel/package.json': JSON.stringify({
		description: 'scratch tpdm',
		metaEdProject: { projectName: 'TPDM', projectVersion: '1.2.0' },
	}),
	'tpdmCommunityModel/DomainEntity/FixtureTpdm.metaed': TPDM_METAED,
	'descriptorCodeValues/FixtureLevelDescriptor.xml': CORE_LEVEL_XML,
	'tpdmDescriptorCodeValues/FixtureBadgeDescriptor.xml': TPDM_BADGE_XML,
	'cedsAuthoredCrosswalk/EdFiEntityElementsToCEDS.csv': ELEMENTS_CSV_TEXT,
	'cedsAuthoredCrosswalk/EdFiEntityDescriptorsToCEDS.csv': DESCRIPTORS_CSV_TEXT,
};

const FULL_VOCABULARY_EXTRA_FILE_MAP = {
	'metaEdModel/Interchange/FixtureInterchange.metaed': CORE_INTERCHANGE_METAED,
	'tpdmCommunityModel/Interchange/FixtureInterchangeExtension.metaed': TPDM_INTERCHANGE_METAED,
};

const writeScratchSha256Sums = (scratchSnapshotPath) => {
	const sumLineList = [];
	const walkForSums = (relativeDirectory) => {
		const absoluteDirectory = path.join(scratchSnapshotPath, relativeDirectory);
		if (!fs.existsSync(absoluteDirectory)) {
			return;
		}
		fs.readdirSync(absoluteDirectory, { withFileTypes: true })
			.sort((leftEntry, rightEntry) => leftEntry.name.localeCompare(rightEntry.name))
			.forEach((directoryEntry) => {
				const relativePath = `${relativeDirectory}/${directoryEntry.name}`;
				if (directoryEntry.isDirectory()) {
					walkForSums(relativePath);
					return;
				}
				const fileHash = crypto
					.createHash('sha256')
					.update(fs.readFileSync(path.join(scratchSnapshotPath, relativePath)))
					.digest('hex');
				sumLineList.push(`${fileHash}  ${relativePath}`);
			});
	};
	['metaEdModel', 'descriptorCodeValues', 'tpdmCommunityModel', 'tpdmDescriptorCodeValues', 'cedsAuthoredCrosswalk'].forEach(
		walkForSums,
	);
	fs.writeFileSync(path.join(scratchSnapshotPath, 'SHA256SUMS'), `${sumLineList.join('\n')}\n`);
};

const buildScratchSnapshot = ({ includeFullVocabulary } = {}) => {
	const scratchSnapshotPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edfiRoundTripFixture-'));
	const fileMap = {
		...CARRIABLE_FILE_MAP,
		...(includeFullVocabulary ? FULL_VOCABULARY_EXTRA_FILE_MAP : {}),
	};
	Object.entries(fileMap).forEach(([relativePath, fileText]) => {
		const absolutePath = path.join(scratchSnapshotPath, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, fileText);
	});
	writeScratchSha256Sums(scratchSnapshotPath);
	return scratchSnapshotPath;
};

// forge a scratch snapshot and hand back { forgeResult, snapshotPath }
const forgeScratchSnapshot = ({ includeFullVocabulary }, callback) => {
	const snapshotPath = buildScratchSnapshot({ includeFullVocabulary });
	forgeEdfi.forge({ sourcePath: snapshotPath, skipEmbedding: true }, (forgeError, forgeResult) => {
		if (forgeError) {
			callback(forgeError);
			return;
		}
		callback('', { forgeResult, snapshotPath });
	});
};

// run the REAL validator core over a graph double of a forge result
const validateDouble = ({ forgeResult, snapshotPath, adjustGraphRows }, callback) => {
	const reader = roundTripGraphDouble.makeGraphDouble({ forgeResult, adjustGraphRows });
	roundTripValidator.validateWithReader(
		{
			reader,
			snapshotPath,
			graphIdentity: { containerName: '(hermetic graph double)', boltUrl: '(none)' },
		},
		callback,
	);
};

// =====================================================================
// the suite — explicit async step chain ending in harness.report()
// =====================================================================

const testStepList = [];
const pushStep = (oneStep) => testStepList.push(oneStep);
const runNextStep = () => {
	const nextStep = testStepList.shift();
	if (!nextStep) {
		harness.report();
		return;
	}
	nextStep(() => setImmediate(runNextStep));
};

// shared across steps (assembled as the suite runs)
const suiteState = {
	probe: {},
	carriableVerdict: undefined,
	fullVerdict: undefined,
	carriableForge: undefined,
};

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('UNIT — canonical primitives and mechanical inversions');

	harness.ok(
		'statementKey joins with NUL (space-bearing objects cannot alias)',
		roundTripMetaEdCanonical.statementKey({ subject: 'a b', predicate: 'c', object: 'd' }) ===
			`a b c d`,
	);
	harness.equal(
		'collapseWhitespace collapses runs and trims',
		roundTripMetaEdCanonical.collapseWhitespace('  a\n\t b  c '),
		'a b c',
	);
	harness.equal(
		'roleName prefix inversion recovers the base name',
		roundTripEdfiCompiler.invertEffectivePropertyName({
			effectiveName: 'HomeFixtureSchool',
			roleNameName: 'Home',
		}),
		'FixtureSchool',
	);
	harness.equal(
		'roleName === base name inverts to itself (no prefix was applied)',
		roundTripEdfiCompiler.invertEffectivePropertyName({
			effectiveName: 'Mailing',
			roleNameName: 'Mailing',
		}),
		'Mailing',
	);
	harness.equal(
		'no roleName passes the name through',
		roundTripEdfiCompiler.invertEffectivePropertyName({ effectiveName: 'Plain' }),
		'Plain',
	);
	harness.ok(
		'an uninvertible effective name is undefined (a fault upstream, never a guess)',
		roundTripEdfiCompiler.invertEffectivePropertyName({
			effectiveName: 'Odd',
			roleNameName: 'Home',
		}) === undefined,
	);
	harness.ok(
		'construct stableId parses to type and name',
		(() => {
			const parsedRef = roundTripEdfiCompiler.parseConstructStableId('edfi:descriptor/FixtureLevel');
			return parsedRef.constructType === 'descriptor' && parsedRef.constructName === 'FixtureLevel';
		})(),
	);
	harness.ok(
		'a non-scheme parentId refuses to parse',
		roundTripEdfiCompiler.parseConstructStableId('nonsense') === undefined,
	);
	done();
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('REDUCER — scope refusals observed BY NAME');
	roundTripMetaEdCanonical.reduceMetaEdSourceText(
		{
			sourceText: 'Begin Namespace EdFi core\nEnd Namespace',
			sourceFileRelativePath: 'scratch/wrapped.metaed',
		},
		(wrapperError) => {
			harness.rejects(
				'Begin Namespace wrapper refuses by name (stated scope limit)',
				[wrapperError].filter(Boolean),
				/Begin\/End Namespace.*declared scope/,
			);
			roundTripMetaEdCanonical.reduceMetaEdSourceText(
				{
					sourceText: 'Domain Entity Fixture [1]\n    documentation "x"\n    gibberish here',
					sourceFileRelativePath: 'scratch/gibberish.metaed',
				},
				(gibberishError) => {
					harness.rejects(
						'unclassifiable text is a canonicalization FAULT naming file:line',
						[gibberishError].filter(Boolean),
						/FAULT scratch\/gibberish\.metaed:3/,
					);
					roundTripMetaEdCanonical.reduceMetaEdSourceText(
						{
							sourceText: 'Domain Entity Fixture [1]\n    documentation "unterminated',
							sourceFileRelativePath: 'scratch/unterminated.metaed',
						},
						(untermError) => {
							harness.rejects(
								'an unterminated string is a scanner FAULT',
								[untermError].filter(Boolean),
								/unterminated quoted string/,
							);
							done();
						},
					);
				},
			);
		},
	);
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('CANONICALIZER BOUNDS — cosmetic variants collapse; adversarial pairs stay distinct');

	const reduceToKeySet = ({ sourceText }, keySetCallback) => {
		roundTripMetaEdCanonical.reduceMetaEdSourceText(
			{ sourceText, sourceFileRelativePath: 'scratch/pair.metaed' },
			(reduceError, reduceResult) => {
				if (reduceError) {
					keySetCallback(reduceError);
					return;
				}
				const { statementMap } = roundTripMetaEdCanonical.assembleStatementMap({
					statementList: reduceResult.statementList,
				});
				keySetCallback('', new Set(statementMap.keys()));
			},
		);
	};

	const keySetsEqual = (leftSet, rightSet) =>
		leftSet.size === rightSet.size && [...leftSet].every((oneKey) => rightSet.has(oneKey));

	const cosmeticA = 'Domain Entity Fx [1]\n    documentation "A fixture   with   spaces."\n    integer FxId [2]\n        documentation "The id."\n        is part of identity\n';
	const cosmeticB = '// a comment the grammar skips\nDomain Entity Fx [1]\n    documentation "A fixture\n    with spaces."\n\n\n    integer FxId [2]\n        documentation "The id."\n        is part of identity';

	const adversarialPairList = [
		{
			pairName: 'annotation differs (required vs optional)',
			leftText: 'Domain Entity Fx [1]\n    documentation "d"\n    integer FxId [2]\n        documentation "i"\n        is required',
			rightText: 'Domain Entity Fx [1]\n    documentation "d"\n    integer FxId [2]\n        documentation "i"\n        is optional',
		},
		{
			pairName: 'documentation differs by one word',
			leftText: 'Domain Entity Fx [1]\n    documentation "the red fixture"',
			rightText: 'Domain Entity Fx [1]\n    documentation "the blue fixture"',
		},
		{
			pairName: 'enumeration item text trailing space is semantic (verbatim value)',
			leftText: 'Enumeration Fx [1]\n    documentation "d"\n    item "Alpha"',
			rightText: 'Enumeration Fx [1]\n    documentation "d"\n    item "Alpha "',
		},
		{
			pairName: 'role name present vs absent',
			leftText: 'Domain Entity Fx [1]\n    documentation "d"\n    domain entity Fx [2]\n        documentation "r"\n        is optional\n        role name Peer',
			rightText: 'Domain Entity Fx [1]\n    documentation "d"\n    domain entity Fx [2]\n        documentation "r"\n        is optional',
		},
		{
			pairName: 'bound sign is semantic',
			leftText: 'Shared Integer Fx [1]\n    documentation "d"\n    min value 1',
			rightText: 'Shared Integer Fx [1]\n    documentation "d"\n    min value -1',
		},
	];

	reduceToKeySet({ sourceText: cosmeticA }, (cosmeticErrorA, cosmeticSetA) => {
		reduceToKeySet({ sourceText: cosmeticB }, (cosmeticErrorB, cosmeticSetB) => {
			harness.accepts('cosmetic pair reduces without fault', [cosmeticErrorA, cosmeticErrorB].filter(Boolean));
			const cosmeticCollapsed = keySetsEqual(cosmeticSetA, cosmeticSetB);
			harness.ok(
				'cosmetic variants (whitespace, comments, blank lines) collapse to ONE statement set',
				cosmeticCollapsed,
			);
			suiteState.probe.cosmeticVariantsCollapse = cosmeticCollapsed;

			let adversarialAllDistinct = true;
			let pairIndex = 0;
			const nextPair = () => {
				if (pairIndex >= adversarialPairList.length) {
					suiteState.probe.adversarialPairsAllDistinct = adversarialAllDistinct;
					harness.ok('every adversarial pair stays DISTINCT', adversarialAllDistinct);
					done();
					return;
				}
				const onePair = adversarialPairList[pairIndex++];
				reduceToKeySet({ sourceText: onePair.leftText }, (leftError, leftSet) => {
					reduceToKeySet({ sourceText: onePair.rightText }, (rightError, rightSet) => {
						harness.accepts(`pair '${onePair.pairName}' reduces without fault`, [leftError, rightError].filter(Boolean));
						const pairDistinct = !keySetsEqual(leftSet, rightSet);
						harness.ok(`adversarial pair DISTINCT — ${onePair.pairName}`, pairDistinct);
						if (!pairDistinct) {
							adversarialAllDistinct = false;
						}
						setImmediate(nextPair);
					});
				});
			};
			nextPair();
		});
	});
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('RT-7 — the CARRIABLE-vocabulary fixture round-trips CLEAN');
	forgeScratchSnapshot({ includeFullVocabulary: false }, (forgeError, forged) => {
		harness.accepts('carriable fixture forges without refusal', [forgeError].filter(Boolean));
		if (forgeError) {
			done();
			return;
		}
		suiteState.carriableForge = forged;
		validateDouble(forged, (validateError, verdict) => {
			harness.accepts('carriable fixture validates without fault', [validateError].filter(Boolean));
			if (validateError) {
				done();
				return;
			}
			suiteState.carriableVerdict = verdict;
			harness.ok(
				`carriable fixture roundTripClean === true (reproduced ${verdict.reproduced}, lost ${verdict.lost}, inventedTotal ${verdict.inventedTotal})`,
				verdict.roundTripClean === true,
			);
			harness.equal('carriable fixture LOST is zero', verdict.lost, 0);
			harness.equal('carriable fixture inventedTotal is zero', verdict.inventedTotal, 0);
			harness.equal(
				'crosswalk guard sees stash and zero violations',
				verdict.crosswalkGuard.violationCount,
				0,
			);
			harness.ok(
				'crosswalk stash is nonempty (the guard guarded something real)',
				verdict.crosswalkGuard.stashRawValueCount > 0,
			);
			harness.ok(
				'the verbatim trailing-space code value REPRODUCED (house line: trimmed identity, verbatim value)',
				(() => {
					const gammaKey = roundTripMetaEdCanonical.statementKey({
						subject: 'edfi://descriptor/FixtureLevel/value/Gamma',
						predicate: 'codeValue',
						object: 'Gamma ',
					});
					return verdict.report.headline.invented === 0 && verdict.reproduced > 0 &&
						!verdict.report.lostDetailList.some((oneLost) => oneLost.subject === 'edfi://descriptor/FixtureLevel/value/Gamma');
				})(),
			);

			// verdict shape probe (G-14)
			const shapeComplete =
				verdict.verdictVersion === roundTripValidator.VERDICT_VERSION &&
				typeof verdict.roundTripClean === 'boolean' &&
				typeof verdict.reproduced === 'number' &&
				typeof verdict.lost === 'number' &&
				typeof verdict.explicitlyOmittedTotal === 'number' &&
				typeof verdict.notReproducedTotal === 'number' &&
				// A13: lostTotal is contentGap ALONE, never the sum.
				verdict.lostTotal === verdict.contentGapTotal &&
				verdict.contentGapTotal + verdict.explicitlyOmittedTotal ===
					verdict.notReproducedTotal &&
				typeof verdict.contentGapTotal === 'number' &&
				typeof verdict.inventedTotal === 'number' &&
				Boolean(verdict.snapshot && verdict.snapshot.combinedDigest && verdict.snapshot.perInput) &&
				Boolean(verdict.graph && verdict.graph.nodeCountByRole) &&
				Boolean(verdict.explicitlyOmittedOutOfDomainCensus) &&
				Boolean(verdict.crosswalkGuard);
			suiteState.probe.verdictShapeComplete = shapeComplete;
			harness.ok('verdict carries the complete RT-6 shape', shapeComplete);
			done();
		});
	});
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('FULL-vocabulary fixture — loses EXACTLY the ruled backlog classes, invents nothing');
	forgeScratchSnapshot({ includeFullVocabulary: true }, (forgeError, forged) => {
		harness.accepts('full-vocabulary fixture forges without refusal', [forgeError].filter(Boolean));
		if (forgeError) {
			done();
			return;
		}
		validateDouble(forged, (validateError, verdict) => {
			harness.accepts('full-vocabulary fixture validates without fault', [validateError].filter(Boolean));
			if (validateError) {
				done();
				return;
			}
			suiteState.fullVerdict = verdict;
			harness.equal('full fixture inventedTotal is zero', verdict.inventedTotal, 0);
			harness.ok('full fixture HAS loss (the ruled classes exist in it)', verdict.lost > 0);

			const ruledLabelList = [
				'interchangeComponentKind (R-WO-15d)',
				'itemMetaEdId (R-WO-15d extension)',
				'itemNamespaceQualifier (R-WO-15d extension)',
			];
			const lossesAllNamed =
				verdict.report.lostDetailList.length === verdict.lost &&
				verdict.report.lostDetailList.every(
					(oneLost) => oneLost.backlogLabel && ruledLabelList.includes(oneLost.backlogLabel),
				);
			suiteState.probe.fullVocabularyLossesAllNamed = lossesAllNamed && verdict.invented === 0;
			harness.ok('every full-fixture loss carries one of the three ruled backlog labels', lossesAllNamed);

			const unlabeledContentGapCount = verdict.report.lostDetailList.filter(
				(oneLost) => oneLost.bucketName === 'contentGap' && !oneLost.backlogLabel,
			).length;
			suiteState.probe.fullVocabularyUnlabeledContentGapCount = unlabeledContentGapCount;
			harness.equal('no anonymous contentGap loss', unlabeledContentGapCount, 0);

			const allLocatedAndBucketed = verdict.report.lostDetailList.every(
				(oneLost) => oneLost.located && oneLost.bucketName,
			);
			suiteState.probe.lostAllLocatedAndBucketed = allLocatedAndBucketed;
			harness.ok('every LOST record is located (file:line) and bucketed', allLocatedAndBucketed);

			harness.ok(
				'componentKind loss includes the identityTemplate kind (both kinds exercised)',
				verdict.report.lostDetailList.some(
					(oneLost) => oneLost.predicate.startsWith('componentKind/') && oneLost.object === 'identityTemplate',
				),
			);
			harness.ok(
				'itemNamespace loss names the qualified component (EdFi.FixtureStudent)',
				verdict.report.lostDetailList.some(
					(oneLost) => oneLost.predicate === 'itemNamespace/FixtureStudent' && oneLost.object === 'EdFi',
				),
			);
			done();
		});
	});
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('CHEATING DETECTOR + INVENTION ALARM — data-level injections through the double');
	const forged = suiteState.carriableForge;
	if (!forged) {
		harness.ok('carriable forge available for injections', false);
		done();
		return;
	}

	// delete a REAL graph fact: the FixtureSchool construct documentation
	validateDouble(
		{
			...forged,
			adjustGraphRows: (graphRows) => {
				const schoolRow = graphRows.constructRowList.find((oneRow) => oneRow.name === 'FixtureSchool' && oneRow.constructType === 'domainEntity');
				delete schoolRow.description;
				return graphRows;
			},
		},
		(deleteError, deleteVerdict) => {
			harness.accepts('deleted-fact run validates', [deleteError].filter(Boolean));
			const deletedFactShowsLost =
				!deleteError &&
				deleteVerdict.lost === 1 &&
				deleteVerdict.report.lostDetailList.some(
					(oneLost) =>
						oneLost.subject === 'edfi://domainEntity/FixtureSchool' &&
						oneLost.predicate === 'documentation' &&
						oneLost.object === 'A fixture school.',
				);
			suiteState.probe.deletedFactShowsLost = deletedFactShowsLost;
			harness.ok(
				'a deleted graph fact is named LOST — the validator did not know data it should not (RT-5)',
				deletedFactShowsLost,
			);

			// inject a fact the source never stated
			validateDouble(
				{
					...forged,
					adjustGraphRows: (graphRows) => {
						const studentRow = graphRows.constructRowList.find((oneRow) => oneRow.name === 'FixtureStudent' && oneRow.constructType === 'domainEntity');
						studentRow.footerDocumentationText = 'A footer the source never wrote.';
						return graphRows;
					},
				},
				(injectError, injectVerdict) => {
					harness.accepts('injected-fact run validates', [injectError].filter(Boolean));
					const injectedFactShowsInvented =
						!injectError &&
						injectVerdict.invented === 1 &&
						injectVerdict.report.inventedDetailList.some(
							(oneInvented) =>
								oneInvented.subject === 'edfi://domainEntity/FixtureStudent' &&
								oneInvented.predicate === 'footerDocumentation' &&
								oneInvented.object === 'A footer the source never wrote.',
						);
					suiteState.probe.injectedFactShowsInvented = injectedFactShowsInvented;
					harness.ok('an injected graph fact fires INVENTED by name', injectedFactShowsInvented);

					// doctor a stash raw value: the crosswalk guard must bite at the DATA level
					validateDouble(
						{
							...forged,
							adjustGraphRows: (graphRows) => {
								const annotatedValueRow = graphRows.optionValueRowList.find((oneRow) => oneRow.cedsOptionCode !== undefined);
								annotatedValueRow.cedsOptionCode = 'DoctoredOption';
								return graphRows;
							},
						},
						(doctorError, doctorVerdict) => {
							harness.accepts('doctored-stash run validates', [doctorError].filter(Boolean));
							harness.ok(
								'a stash raw value absent from the CSVs is a guard VIOLATION (counts INVENTED)',
								!doctorError &&
									doctorVerdict.crosswalkGuard.violationCount === 1 &&
									doctorVerdict.inventedTotal === 1 &&
									doctorVerdict.roundTripClean === false,
							);

							// malformed graph data: a non-boolean in a boolean-registry field must FAULT,
							// never coerce (polyArch2 §6; the boolText strictness observed firing)
							validateDouble(
								{
									...forged,
									adjustGraphRows: (graphRows) => {
										const anyPropertyRow = graphRows.propertyRowList.find(
											(oneRow) => oneRow.isQueryableField !== undefined,
										);
										anyPropertyRow.isQueryableField = 'maybe';
										return graphRows;
									},
								},
								(malformedError) => {
									harness.rejects(
										'a non-boolean in a boolean field is a named FAULT, never coerced',
										[malformedError].filter(Boolean),
										/'isQueryableField' holds "maybe".*transform refuses/,
									);
									done();
								},
							);
						},
					);
				},
			);
		},
	);
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('REFUSAL BATTERY — every refusal BY NAME; intact input not over-refused');
	let refusalsAllNamed = true;
	const noteRefusal = (label, errorValue, expectedRegex) => {
		const matched = Boolean(errorValue) && expectedRegex.test(errorValue);
		harness.rejects(label, [errorValue].filter(Boolean), expectedRegex);
		if (!matched) {
			refusalsAllNamed = false;
		}
	};

	const scratchPath = buildScratchSnapshot({});

	// missing input directory
	fs.rmSync(path.join(scratchPath, 'descriptorCodeValues'), { recursive: true });
	roundTripValidator.validateWithReader(
		{
			reader: roundTripGraphDouble.makeGraphDouble({ forgeResult: suiteState.carriableForge.forgeResult }),
			snapshotPath: scratchPath,
		},
		(missingDirError) => {
			noteRefusal(
				'missing input directory refuses naming README_PROVENANCE.md',
				missingDirError,
				/descriptorCodeValues.*missing[\s\S]*README_PROVENANCE\.md/,
			);

			// corrupt bytes
			const corruptPath = buildScratchSnapshot({});
			fs.appendFileSync(path.join(corruptPath, 'metaEdModel', 'DomainEntity', 'FixtureEntities.metaed'), 'x');
			roundTripValidator.validateWithReader(
				{
					reader: roundTripGraphDouble.makeGraphDouble({ forgeResult: suiteState.carriableForge.forgeResult }),
					snapshotPath: corruptPath,
				},
				(corruptError) => {
					noteRefusal(
						'corrupt bytes refuse with checksum MISMATCH naming the file',
						corruptError,
						/FixtureEntities\.metaed' checksum MISMATCH[\s\S]*README_PROVENANCE\.md/,
					);

					// manifest drift: a file on disk not in SHA256SUMS
					const driftPath = buildScratchSnapshot({});
					fs.writeFileSync(path.join(driftPath, 'metaEdModel', 'DomainEntity', 'Sneaky.metaed'), 'Domain Entity Sneaky [1]\n    documentation "sneak"');
					roundTripValidator.validateWithReader(
						{
							reader: roundTripGraphDouble.makeGraphDouble({ forgeResult: suiteState.carriableForge.forgeResult }),
							snapshotPath: driftPath,
						},
						(driftError) => {
							noteRefusal(
								'manifest drift refuses (file on disk, absent from SHA256SUMS)',
								driftError,
								/Sneaky\.metaed' exists on disk but is ABSENT from SHA256SUMS/,
							);

							// validate() with neither bolt triple nor containerName
							roundTripValidator.validate({ snapshotPath: scratchPath }, (noEndpointError) => {
								noteRefusal(
									'no bolt triple and no containerName refuses by name',
									noEndpointError,
									/either boltUrl\+user\+password or containerName is REQUIRED/,
								);

								// resolveContainerBolt against a container with no 7687 binding (docker double)
								roundTripEdfiCompiler.resolveContainerBolt(
									{
										containerName: 'DEV_fixtureNoPort',
										runDockerCommand: (argList, runnerCallback) =>
											runnerCallback(null, JSON.stringify([{ NetworkSettings: { Ports: {} }, Config: { Env: [] } }])),
									},
									(noPortError) => {
										noteRefusal(
											'container without a published 7687 port refuses (nothing guessed)',
											noPortError,
											/publishes no host port for 7687\/tcp/,
										);
										roundTripEdfiCompiler.resolveContainerBolt(
											{
												containerName: 'DEV_fixtureNoAuth',
												runDockerCommand: (argList, runnerCallback) =>
													runnerCallback(
														null,
														JSON.stringify([
															{
																NetworkSettings: { Ports: { '7687/tcp': [{ HostPort: '7999' }] } },
																Config: { Env: [] },
															},
														]),
													),
											},
											(noAuthError) => {
												noteRefusal(
													'container without NEO4J_AUTH refuses (credential never assumed)',
													noAuthError,
													/declares no NEO4J_AUTH/,
												);
												roundTripEdfiCompiler.resolveContainerBolt(
													{
														containerName: 'DEV_fixtureGood',
														runDockerCommand: (argList, runnerCallback) =>
															runnerCallback(
																null,
																JSON.stringify([
																	{
																		NetworkSettings: { Ports: { '7687/tcp': [{ HostPort: '7999' }] } },
																		Config: { Env: ['NEO4J_AUTH=neo4j/fixturePw'] },
																	},
																]),
															),
													},
													(goodError, boltTriple) => {
														harness.accepts('an intact container inspection is NOT over-refused', [goodError].filter(Boolean));
														harness.ok(
															'bolt triple parsed from the container record',
															Boolean(boltTriple) &&
																boltTriple.boltUrl === 'bolt://localhost:7999' &&
																boltTriple.user === 'neo4j' &&
																boltTriple.password === 'fixturePw',
														);
														if (goodError) {
															refusalsAllNamed = false;
														}
														suiteState.probe.refusalsAllNamed = refusalsAllNamed;
														done();
													},
												);
											},
										);
									},
								);
							});
						},
					);
				},
			);
		},
	);
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('G-8 — two independent readers agree (reducer census vs Phase 1 parser census)');
	const fullSnapshotPath = buildScratchSnapshot({ includeFullVocabulary: true });
	metaEdParser.parseMetaEdSnapshot({ snapshotPath: fullSnapshotPath }, (parseError, parsedModel) => {
		harness.accepts('Phase 1 parser reads the full fixture (cross-check reader)', [parseError].filter(Boolean));
		if (parseError) {
			suiteState.probe.censusCrossCheckAgreed = false;
			done();
			return;
		}
		// reduce the same .metaed files with the independent reducer
		const reducerTotals = {
			constructCountByType: {},
			propertyCount: 0,
			enumerationItemCount: 0,
			domainItemCount: 0,
			interchangeComponentCount: 0,
		};
		const metaEdFileList = [];
		['metaEdModel', 'tpdmCommunityModel'].forEach((inputName) => {
			const walk = (dirPath) => {
				fs.readdirSync(dirPath, { withFileTypes: true }).forEach((oneEntry) => {
					const fullPath = path.join(dirPath, oneEntry.name);
					if (oneEntry.isDirectory()) {
						walk(fullPath);
						return;
					}
					if (oneEntry.name.endsWith('.metaed')) {
						metaEdFileList.push(fullPath);
					}
				});
			};
			walk(path.join(fullSnapshotPath, inputName));
		});
		let fileIndex = 0;
		const reduceNext = () => {
			if (fileIndex >= metaEdFileList.length) {
				const parsedCensus = parsedModel.census;
				const constructCountsAgree =
					JSON.stringify(
						Object.fromEntries(Object.entries(reducerTotals.constructCountByType).sort()),
					) ===
					JSON.stringify(Object.fromEntries(Object.entries(parsedCensus.constructCounts).sort()));
				const agreed =
					constructCountsAgree &&
					reducerTotals.propertyCount === parsedCensus.totalPropertyCount &&
					reducerTotals.enumerationItemCount === parsedCensus.enumerationItemCount &&
					reducerTotals.domainItemCount === parsedCensus.domainItemCount &&
					reducerTotals.interchangeComponentCount === parsedCensus.interchangeComponentCount;
				suiteState.probe.censusCrossCheckAgreed = agreed;
				harness.ok(
					`the two independent readers agree — constructs/properties/items (${JSON.stringify(reducerTotals.constructCountByType)} vs parser)`,
					agreed,
				);
				done();
				return;
			}
			const oneFilePath = metaEdFileList[fileIndex++];
			roundTripMetaEdCanonical.reduceMetaEdSourceText(
				{
					sourceText: fs.readFileSync(oneFilePath, 'utf8'),
					sourceFileRelativePath: path.relative(fullSnapshotPath, oneFilePath),
				},
				(reduceError, reduceResult) => {
					if (reduceError) {
						harness.accepts('reducer reads the fixture file', [reduceError]);
						suiteState.probe.censusCrossCheckAgreed = false;
						done();
						return;
					}
					Object.entries(reduceResult.reducerCensus.constructCountByType).forEach(([constructType, typeCount]) => {
						reducerTotals.constructCountByType[constructType] =
							(reducerTotals.constructCountByType[constructType] || 0) + typeCount;
					});
					reducerTotals.propertyCount += reduceResult.reducerCensus.propertyCount;
					reducerTotals.enumerationItemCount += reduceResult.reducerCensus.enumerationItemCount;
					reducerTotals.domainItemCount += reduceResult.reducerCensus.domainItemCount;
					reducerTotals.interchangeComponentCount += reduceResult.reducerCensus.interchangeComponentCount;
					setImmediate(reduceNext);
				},
			);
		};
		reduceNext();
	});
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('RT-10 — gate suite: all 16 green AND every twin observed RED');

	roundTripGates.loadGateDeclarations({ gatesFilePath: GATES_FILE_PATH }, (loadError, loaded) => {
		harness.accepts('gate declarations load', [loadError].filter(Boolean));
		if (loadError) {
			done();
			return;
		}
		const { declarations } = loaded;
		const registryAudit = roundTripGateTwins.auditRegistryAgainst({ declarations });
		harness.equal('every declared twin exists in the registry', registryAudit.missingList.length, 0);
		harness.equal('no orphan twins (dead proof-code)', registryAudit.orphanList.length, 0);

		const measurements = {
			verdict: suiteState.carriableVerdict,
			report: suiteState.carriableVerdict.report,
			probe: suiteState.probe,
			suite: {
				gatesUsingPercentInAcceptance: roundTripGates.countGatesUsingPercentInAcceptance({ declarations }),
			},
		};

		roundTripGates.evaluateGates({ declarations, measurements }, (evaluateError, evaluated) => {
			harness.accepts('gate evaluation runs', [evaluateError].filter(Boolean));
			if (evaluateError) {
				done();
				return;
			}
			evaluated.gateResults.forEach((oneResult) => {
				harness.ok(
					`${oneResult.id} ${oneResult.state} — ${oneResult.title.slice(0, 70)}${oneResult.detail ? ` (${oneResult.detail})` : ''}`,
					oneResult.state === 'PASS',
				);
			});

			// twins: each must turn ITS gate red on a corrupted clone
			const twinRedByGateId = {};
			const twinObservationLineList = [];
			let gateIndex = 0;
			const runNextTwin = () => {
				if (gateIndex >= declarations.gates.length) {
					fs.mkdirSync(TEST_ARTIFACTS_PATH, { recursive: true });
					fs.writeFileSync(TWIN_OBSERVATION_LOG_PATH, `${twinObservationLineList.join('\n')}\n`);
					harness.ok(
						`twin observations logged to ${path.relative(path.join(__dirname, '..'), TWIN_OBSERVATION_LOG_PATH)}`,
						fs.existsSync(TWIN_OBSERVATION_LOG_PATH),
					);
					roundTripGates.judgeSuite(
						{ gateResults: evaluated.gateResults, twinRedByGateId },
						(judgeError, judged) => {
							harness.accepts('suite judgment runs', [judgeError].filter(Boolean));
							harness.ok(
								`suite ACCEPTED (fail ${judged.failingGateIds.length}, unproven ${judged.unprovenGateIds.length})`,
								judged.accepted === true,
							);
							done();
						},
					);
					return;
				}
				const oneGate = declarations.gates[gateIndex++];
				const corruptedMeasurements = roundTripGateTwins.twinRegistry[oneGate.twin](
					JSON.parse(JSON.stringify(measurements)),
				);
				roundTripGates.evaluateGates(
					{ declarations: { gates: [oneGate] }, measurements: corruptedMeasurements },
					(twinError, twinEvaluated) => {
						const twinState = twinError ? 'HARNESS-ERROR' : twinEvaluated.gateResults[0].state;
						const wentRed = twinState === 'FAIL' || twinState === 'UNMEASURED';
						twinRedByGateId[oneGate.id] = wentRed;
						twinObservationLineList.push(
							`${new Date().toISOString()} ${oneGate.id} twin '${oneGate.twin}' -> ${twinState}${wentRed ? ' (RED observed — gate proven)' : ' (STAYED GREEN — DEFECT IN THE GATE)'}`,
						);
						harness.ok(`${oneGate.id} twin '${oneGate.twin}' observed RED`, wentRed);
						setImmediate(runNextTwin);
					},
				);
			};
			runNextTwin();
		});
	});
});

runNextStep();
