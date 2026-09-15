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
         invents NOTHING and CARRIES the three formerly-ruled loss classes — componentKind,
         itemMetaEdId, itemNamespaceQualifier — so it too round-trips CLEAN (R-WO-15(d)/(f),
         closed by the 2026-08 remediation). Carriage is asserted statement by statement against
         an answer key reduced from the fixture bytes, over a domain of a DECLARED EXACT SIZE:
         a "nothing was lost" measure is true on an empty domain and proves nothing.
       - items declared with NO metaEdId emit no itemMetaEdId statement — the invention seam
         that carrying more content opens, asserted by name rather than trusted
       - edge triples are DISTINCT: the replay engine MERGEs on (from, type, to), so duplicates
         collapse silently and become last-write-wins data loss once edges carry properties
       - the cheating detector: deleting a REAL graph fact names it LOST; injecting one fires
         INVENTED — both through the double's adjustGraphRows seam, at the DATA level
       - the crosswalk invention guard bites at the DATA level (a doctored stash raw value)
       - refusals are BY NAME (intake, bolt resolution, reducer scope limits, edge uniqueness)
       - the canonicalizer is bounded BOTH directions (cosmetic variants collapse; adversarial
         pairs stay distinct)
       - the two independent readers agree (reducer census vs Phase 1 parser census — the
         parser is used HERE as the cross-check reader, never as the answer key)
       - the RT-10 gate suite: 19 gates evaluated green AND every twin observed RED
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

const forgeEdfi = require('../forgeEdfi.js')({ embedder: null }); // the framework refuses an ABSENT embedder key by name (F3b)
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
const EMBED_TEXT_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'embedTextNode.json');
const EMBED_TEXT_ROLE = 'DmeEmbedText';

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

// =====================================================================
// the R-WO-15(d)/(f) carriage vocabulary — what the FULL fixture must now CARRY, not lose
// =====================================================================
//
// The three predicate families the interchange fixture files exercise. They were the ruled
// backlog classes; as of the 2026-08 remediation they are edge properties the graph carries, so
// this suite asserts their REPRODUCTION where it previously asserted their LOSS.

const RULED_CARRIAGE_PREDICATE_PREFIX_LIST = ['componentKind/', 'itemMetaEdId/', 'itemNamespace/'];

// the componentKind vocabulary, spoken identically by the parser (metaEdSyntaxParser.js:1219) and
// the canonicalizer (roundTripMetaEdCanonical.js:258-266) — no translation table exists between
// them by design (IMPL D-3), so this list is the whole domain, named here to stay greppable
const COMPONENT_KIND_VALUE_LIST = ['element', 'identityTemplate'];

// THE NON-VACUITY FLOOR. Derived by reducing the two interchange fixture texts with the real
// canonicalizer, never counted by hand:
//   componentKind/  5   (FixtureStudent, FixtureSchool, FixtureEnrollment on the core interchange;
//                        FixtureCandidate, FixtureStudent on the TPDM extension)
//   itemMetaEdId/   3   (9300-001, 9300-002, 9310-001)
//   itemNamespace/  1   (EdFi.FixtureStudent on the extension)
//
// These counts are load-bearing, not decoration. A carriage gate that says only "nothing was
// lost" is TRUE ON AN EMPTY DOMAIN — if the interchange files silently stopped reaching the
// forge, or the reducer stopped emitting these families, every loss-based measure would go green
// while proving nothing whatsoever. Requiring the domain to be exactly this size is what makes
// the claim unfakeable. (This suite has previously repaired a vacuous gate by building a
// differently-vacuous one; the floor exists so that cannot happen again here.)
const EXPECTED_RULED_CARRIAGE_COUNT_BY_PREFIX = {
	'componentKind/': 5,
	'itemMetaEdId/': 3,
	'itemNamespace/': 1,
};
const EXPECTED_RULED_CARRIAGE_TOTAL = 9;

// the two fixture items declared with NO bracketed metaEdId — `association FixtureEnrollment`
// (core interchange) and `domain entity FixtureCandidate` (TPDM extension). Carrying MORE content
// is exactly where an emitter can start manufacturing content; these two names are the
// invention seam and get their own named assertion rather than a comment.
const IDLESS_FIXTURE_ITEM_NAME_LIST = ['FixtureEnrollment', 'FixtureCandidate'];

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

// reduce the two interchange fixture texts with the REAL canonicalizer and hand back every
// statement belonging to the three ruled carriage families. This is the ANSWER KEY for carriage:
// the exact (subject, predicate, object) triples that must now be reproduced, derived from the
// fixture bytes rather than restated by hand.
const reduceRuledCarriageStatements = (callback) => {
	const sourceTextList = [
		{
			sourceText: CORE_INTERCHANGE_METAED,
			sourceFileRelativePath: 'metaEdModel/Interchange/FixtureInterchange.metaed',
		},
		{
			sourceText: TPDM_INTERCHANGE_METAED,
			sourceFileRelativePath: 'tpdmCommunityModel/Interchange/FixtureInterchangeExtension.metaed',
		},
	];
	const ruledStatementList = [];
	let sourceTextIndex = 0;
	const reduceNext = () => {
		if (sourceTextIndex >= sourceTextList.length) {
			callback('', { ruledStatementList });
			return;
		}
		const oneSourceText = sourceTextList[sourceTextIndex++];
		roundTripMetaEdCanonical.reduceMetaEdSourceText(oneSourceText, (reduceError, reduceResult) => {
			if (reduceError) {
				callback(reduceError);
				return;
			}
			reduceResult.statementList
				.filter((oneStatement) =>
					RULED_CARRIAGE_PREDICATE_PREFIX_LIST.some((onePrefix) =>
						oneStatement.predicate.startsWith(onePrefix),
					),
				)
				.forEach((oneStatement) => ruledStatementList.push(oneStatement));
			setImmediate(reduceNext);
		});
	};
	reduceNext();
};

// measureRuledCarriage — carriage measured from the diff's PER-PREDICATE rows
// (roundTripDiff.js:75-90, 176-178), NEVER from "this statement is absent from lostDetailList".
//
// THE DIFFERENCE IS THE ENTIRE POINT, and it is the second-order form of the vacuity this
// remediation exists to repair. lostDetailList contains only statements that WERE IN THE SOURCE
// and went unreproduced. A statement that never entered the run at all is therefore ALSO absent
// from it — so an absent-from-lost test reports success on a run that does not contain the
// vocabulary in the first place. Requiring each expected predicate to have a per-predicate row
// PRESENT, with its expected `source` count and `lost` of zero, makes presence-in-source part of
// the measurement instead of an assumption standing beside it. The suite proves this
// discrimination on real data by feeding this function the CARRIABLE run, which has no
// interchange vocabulary at all, and watching it refuse.
// restrictToObjectValue narrows WHICH predicates are in scope to those carrying that object. It
// deliberately does NOT narrow the expected COUNT: report.perPredicate rows are object-AGNOSTIC
// (roundTripDiff.js keys them on predicate text alone), so comparing an object-filtered count
// against an object-agnostic row would produce a FALSE RED the moment a fixture gave one local
// name two different kinds — source 2, expected 1, with no carriage defect anywhere. Counts are
// therefore taken over every statement bearing an in-scope predicate, and the assumption that
// makes an object-restricted question answerable at all is asserted below rather than assumed.
const measureRuledCarriage = ({ report, ruledStatementList, restrictToObjectValue }) => {
	const statementIsInScope = (oneStatement) =>
		restrictToObjectValue === undefined || oneStatement.object === restrictToObjectValue;
	const inScopePredicateNameList = Array.from(
		new Set(ruledStatementList.filter(statementIsInScope).map((oneStatement) => oneStatement.predicate)),
	);
	const shortfallList = [];
	const expectedCountByPredicate = {};
	inScopePredicateNameList.forEach((onePredicate) => {
		const predicateStatementList = ruledStatementList.filter(
			(oneStatement) => oneStatement.predicate === onePredicate,
		);
		expectedCountByPredicate[onePredicate] = predicateStatementList.length;
		if (restrictToObjectValue === undefined) {
			return;
		}
		const distinctObjectList = Array.from(
			new Set(predicateStatementList.map((oneStatement) => oneStatement.object)),
		);
		if (distinctObjectList.length > 1) {
			shortfallList.push(
				`${onePredicate}: carries ${distinctObjectList.length} distinct object values (${distinctObjectList.join(', ')}) — a per-predicate row cannot answer an object-restricted question about it, so this measure refuses rather than guessing`,
			);
		}
	});
	Object.entries(expectedCountByPredicate).forEach(([onePredicate, expectedCount]) => {
		const predicateRow = report.perPredicate.find((oneRow) => oneRow.predicate === onePredicate);
		if (!predicateRow) {
			shortfallList.push(
				`${onePredicate}: NO per-predicate row at all — this vocabulary is ABSENT from the run, not merely lost`,
			);
			return;
		}
		if (predicateRow.source !== expectedCount) {
			shortfallList.push(
				`${onePredicate}: source ${predicateRow.source}, expected ${expectedCount}`,
			);
			return;
		}
		if (predicateRow.lost !== 0 || predicateRow.reproduced !== expectedCount) {
			shortfallList.push(
				`${onePredicate}: reproduced ${predicateRow.reproduced}/${expectedCount}, lost ${predicateRow.lost}`,
			);
		}
	});
	const inScopeStatementCount = ruledStatementList.filter(statementIsInScope).length;
	return {
		distinctPredicateCount: inScopePredicateNameList.length,
		statementCount: inScopeStatementCount,
		everyRuledStatementReproduced: inScopeStatementCount > 0 && shortfallList.length === 0,
		shortfallList,
	};
};

// NAMED DETECTOR, deliberately separate from the run that uses it, so the SAME function can be
// shown refusing a doctored emission (data-level RED) and accepting an honest one
// (data-level NOT-OVER-BROAD). A detector only ever fed the healthy path is unproven.
const detectIdlessItemsEmitNothing = ({ report, inventedTotal }) => {
	const offendingPredicateList = IDLESS_FIXTURE_ITEM_NAME_LIST.map(
		(oneItemName) => `itemMetaEdId/${oneItemName}`,
	).filter((onePredicate) =>
		report.perPredicate.some((oneRow) => oneRow.predicate === onePredicate),
	);
	// THE PRESENCE FLOOR — the same medicine G-5 got, applied here, because this gate had exactly
	// the defect G-5 was redefined to cure and I did not notice until the independent review said
	// so. "No itemMetaEdId row exists for an id-less item" is TRUE ON AN EMPTY DOMAIN: while the
	// forge emits no itemMetaEdId statements AT ALL, that absence says nothing whatever about
	// non-emission, and the gate's green means nothing. Worse, a future regression that removed
	// itemMetaEdId emission entirely would leave this gate GREEN while G-5 went red.
	//
	// So require that emission is actually HAPPENING before concluding that id-less items were
	// correctly skipped. This is deliberately UNSATISFIED until the forge carries the class: the
	// gate then reports honestly that it cannot yet make its claim, rather than making it
	// vacuously. It self-resolves at state 3, which is precisely why it would never be fixed
	// later if it were allowed to pass now.
	const emittedItemMetaEdIdRowList = report.perPredicate.filter(
		(oneRow) => oneRow.predicate.startsWith('itemMetaEdId/') && oneRow.reproduced > 0,
	);
	return {
		idlessItemsEmitNothing:
			offendingPredicateList.length === 0 &&
			inventedTotal === 0 &&
			emittedItemMetaEdIdRowList.length > 0,
		offendingPredicateList,
		emittedItemMetaEdIdPredicateCount: emittedItemMetaEdIdRowList.length,
	};
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
	fullForge: undefined,
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
	harness.section('FULL-vocabulary fixture — CARRIES the R-WO-15(d)/(f) classes and round-trips CLEAN');
	forgeScratchSnapshot({ includeFullVocabulary: true }, (forgeError, forged) => {
		harness.accepts('full-vocabulary fixture forges without refusal', [forgeError].filter(Boolean));
		if (forgeError) {
			done();
			return;
		}
		suiteState.fullForge = forged;
		reduceRuledCarriageStatements((reduceError, reduced) => {
			harness.accepts(
				'the interchange fixture texts reduce without fault',
				[reduceError].filter(Boolean),
			);
			if (reduceError) {
				done();
				return;
			}
			const { ruledStatementList } = reduced;

			// ---- THE NON-VACUITY FLOOR, established BEFORE any carriage claim is made ----
			const ruledCountByPrefix = {};
			RULED_CARRIAGE_PREDICATE_PREFIX_LIST.forEach((onePrefix) => {
				ruledCountByPrefix[onePrefix] = ruledStatementList.filter((oneStatement) =>
					oneStatement.predicate.startsWith(onePrefix),
				).length;
			});
			const domainSizedAsExpected =
				ruledStatementList.length === EXPECTED_RULED_CARRIAGE_TOTAL &&
				RULED_CARRIAGE_PREDICATE_PREFIX_LIST.every(
					(onePrefix) =>
						ruledCountByPrefix[onePrefix] === EXPECTED_RULED_CARRIAGE_COUNT_BY_PREFIX[onePrefix],
				);
			harness.ok(
				`the ruled-carriage domain is NON-EMPTY and exactly sized — ${JSON.stringify(ruledCountByPrefix)}, total ${ruledStatementList.length}`,
				domainSizedAsExpected,
				`expected ${JSON.stringify(EXPECTED_RULED_CARRIAGE_COUNT_BY_PREFIX)}, total ${EXPECTED_RULED_CARRIAGE_TOTAL}`,
			);

			validateDouble(forged, (validateError, verdict) => {
				harness.accepts(
					'full-vocabulary fixture validates without fault',
					[validateError].filter(Boolean),
				);
				if (validateError) {
					done();
					return;
				}
				suiteState.fullVerdict = verdict;

				// ---- the fixture now round-trips CLEAN (this replaces the old `lost > 0`) ----
				harness.ok(
					`full fixture roundTripClean === true (reproduced ${verdict.reproduced}, lost ${verdict.lost}, inventedTotal ${verdict.inventedTotal})`,
					verdict.roundTripClean === true,
				);
				harness.equal('full fixture LOST is zero', verdict.lost, 0);
				harness.equal('full fixture inventedTotal is zero', verdict.inventedTotal, 0);

				// ---- carriage, measured against the reduced answer key ----
				const overallCarriage = measureRuledCarriage({
					report: verdict.report,
					ruledStatementList,
				});
				harness.ok(
					`every ruled-carriage statement REPRODUCED (${ruledStatementList.length} statements across ${overallCarriage.distinctPredicateCount} predicates)`,
					overallCarriage.everyRuledStatementReproduced,
					overallCarriage.shortfallList.join('\n'),
				);

				// per class, so partial carriage names WHICH class fell short
				RULED_CARRIAGE_PREDICATE_PREFIX_LIST.forEach((onePrefix) => {
					const classCarriage = measureRuledCarriage({
						report: verdict.report,
						ruledStatementList: ruledStatementList.filter((oneStatement) =>
							oneStatement.predicate.startsWith(onePrefix),
						),
					});
					harness.ok(
						`class '${onePrefix}' fully carried (${classCarriage.statementCount} statements)`,
						classCarriage.everyRuledStatementReproduced,
						classCarriage.shortfallList.join('\n'),
					);
				});

				// ---- THE ANTI-VACUITY CONTROL, on real data ----
				// The CARRIABLE fixture ships no interchange files whatsoever, so its run is clean,
				// lossless and invention-free — precisely the shape that a vacuously-green carriage
				// gate accepts, and precisely what the OLD G-5 measure would have called success.
				// Feeding the same carriage measure that run must REFUSE, and refuse for the stated
				// reason: the predicate rows are absent, not merely lossless. This is what makes
				// G-5's green mean "carriage happened" rather than "nothing went wrong".
				const vacuityControlCarriage = measureRuledCarriage({
					report: suiteState.carriableVerdict.report,
					ruledStatementList,
				});
				harness.ok(
					'the carriage measure REFUSES the carriable run, whose verdict is clean but whose ruled vocabulary is absent (anti-vacuity control)',
					vacuityControlCarriage.everyRuledStatementReproduced === false &&
						vacuityControlCarriage.shortfallList.length ===
							overallCarriage.distinctPredicateCount &&
						vacuityControlCarriage.shortfallList.every((oneShortfall) =>
							/NO per-predicate row at all/.test(oneShortfall),
						),
					vacuityControlCarriage.shortfallList.join('\n'),
				);

				// ---- both componentKind object values, not merely the common one ----
				const carriageByComponentKind = {};
				COMPONENT_KIND_VALUE_LIST.forEach((oneComponentKind) => {
					carriageByComponentKind[oneComponentKind] = measureRuledCarriage({
						report: verdict.report,
						ruledStatementList: ruledStatementList.filter((oneStatement) =>
							oneStatement.predicate.startsWith('componentKind/'),
						),
						restrictToObjectValue: oneComponentKind,
					});
				});
				const bothComponentKindsCarried = COMPONENT_KIND_VALUE_LIST.every(
					(oneComponentKind) =>
						carriageByComponentKind[oneComponentKind].everyRuledStatementReproduced,
				);
				suiteState.probe.componentKindBothKindsCarried = bothComponentKindsCarried;
				harness.ok(
					`every componentKind value REPRODUCED — ${COMPONENT_KIND_VALUE_LIST.map((oneComponentKind) => `${oneComponentKind} (${carriageByComponentKind[oneComponentKind].statementCount} stmt)`).join(' AND ')}`,
					bothComponentKindsCarried,
					COMPONENT_KIND_VALUE_LIST.flatMap(
						(oneComponentKind) => carriageByComponentKind[oneComponentKind].shortfallList,
					).join('\n'),
				);

				// ---- the invention seam: items declared without an id must emit NOTHING ----
				const nonEmissionResult = detectIdlessItemsEmitNothing({
					report: verdict.report,
					inventedTotal: verdict.inventedTotal,
				});
				suiteState.probe.idlessItemsEmitNothing = nonEmissionResult.idlessItemsEmitNothing;
				harness.ok(
					`items declared with NO metaEdId emit no itemMetaEdId statement (${IDLESS_FIXTURE_ITEM_NAME_LIST.join(', ')}), inventedTotal stays 0, and itemMetaEdId emission is actually happening (${nonEmissionResult.emittedItemMetaEdIdPredicateCount} predicate(s) reproduced)`,
					nonEmissionResult.idlessItemsEmitNothing,
					nonEmissionResult.offendingPredicateList.length
						? `offending: ${nonEmissionResult.offendingPredicateList.join(', ')}`
						: `no offending predicate; the presence floor is unmet — 0 itemMetaEdId predicates reproduced, so non-emission cannot yet be claimed`,
				);

				// DATA-LEVEL proof that the detector BITES, and bites on the RIGHT thing. Three
				// controls, each isolating ONE variable, with the presence floor SATISFIED in the
				// first two so that only the offending-predicate logic can move them.
				harness.ok(
					'non-emission detector REFUSES a doctored emission for an id-less item (data-level RED)',
					detectIdlessItemsEmitNothing({
						report: {
							perPredicate: [
								{ predicate: 'itemMetaEdId/FixtureStudent', reproduced: 1 },
								{ predicate: 'itemMetaEdId/FixtureEnrollment', reproduced: 1 },
							],
						},
						inventedTotal: 0,
					}).idlessItemsEmitNothing === false,
				);
				harness.ok(
					'non-emission detector ACCEPTS an itemMetaEdId for an item that DOES declare one (not over-broad)',
					detectIdlessItemsEmitNothing({
						report: { perPredicate: [{ predicate: 'itemMetaEdId/FixtureStudent', reproduced: 1 }] },
						inventedTotal: 0,
					}).idlessItemsEmitNothing === true,
				);
				harness.ok(
					'non-emission detector REFUSES when NOTHING is emitted — the presence floor bites, so this gate cannot go vacuously green on an empty domain',
					detectIdlessItemsEmitNothing({
						report: { perPredicate: [{ predicate: 'itemMetaEdId/FixtureStudent', reproduced: 0 }] },
						inventedTotal: 0,
					}).idlessItemsEmitNothing === false,
				);

				// ---- G-5, redefined. The domain-size term is INSIDE the measure, not merely an
				// assertion standing beside it: a clean-and-lossless measure alone is TRUE ON AN
				// EMPTY DOMAIN, which is the exact vacuity this redefinition exists to repair.
				suiteState.probe.fullVocabularyClean =
					verdict.roundTripClean === true &&
					verdict.lost === 0 &&
					verdict.inventedTotal === 0 &&
					domainSizedAsExpected &&
					overallCarriage.everyRuledStatementReproduced;

				// ---- G-6 / G-7 keep their conditional-universal form (D-5) ----
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
				harness.note(
					`G-6 and G-7 are conditional-universal guards — "IF a loss exists, it is located and ` +
						`labelled". Their domain here is ${verdict.report.lostDetailList.length} record(s). ` +
						`Once carriage is complete that domain is EXPECTED TO BE EMPTY and both measures ` +
						`are then vacuously satisfied. They are kept as REGRESSION detectors — a future ` +
						`forge change that drops a property repopulates them under its ruled backlog name ` +
						`— and must never be read as coverage.`,
				);
				done();
			});
		});
	});
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('EDGE-TRIPLE UNIQUENESS — the Phase 1 prerequisite, proven at the DATA level');

	// WHY THIS LIVES IN THE SUITE AND NOT ONLY IN THE MATERIALIZE RUNNER: the runner needs Docker,
	// so it cannot run on every suite execution, and the twin registry can only prove a gate's
	// COMPARISON bites (twins inject at the measure boundary — roundTripGateTwins.js:9-16). The
	// proof that the CHECK ITSELF bites has to be data-level, run against real forge blocks, which
	// is exactly what this step does. Same shape as the cheating-detector and invention probes.
	//
	// WHAT THE REPLAY ENGINE DOES, restated because it is the whole reason: it writes edges with
	// `MERGE ... SET r += e.props`, so two edges sharing (from, type, to) become ONE relationship.
	// Harmless today; last-write-wins data loss the moment edges carry per-edge attributes.

	const carriableForged = suiteState.carriableForge;
	const fullForged = suiteState.fullForge;
	if (!carriableForged || !fullForged) {
		harness.ok('both fixture forge results available for the uniqueness probe', false);
		done();
		return;
	}

	// throw-to-error adapter at a DECLARED refusal seam — the same idiom the compiler uses for its
	// one JSON.parse (roundTripEdfiCompiler.js:290-294). This is not try/catch as control flow;
	// the refusal IS the thing under test and has to be captured to be asserted.
	const captureRefusalMessageList = (riskyFunction) => {
		let refusalMessage = '';
		try {
			riskyFunction();
		} catch (thrownError) {
			refusalMessage = thrownError.message;
		}
		return refusalMessage ? [refusalMessage] : [];
	};

	// ---- refusal by name: an unreadable input is refused, never quietly accepted ----
	harness.rejects(
		'findDuplicateEdgeTriples REFUSES a missing edgeList BY NAME',
		captureRefusalMessageList(() => roundTripEdfiCompiler.findDuplicateEdgeTriples({})),
		/edgeList \(array\) is REQUIRED and has no default/,
	);
	harness.rejects(
		'findDuplicateEdgeTriples REFUSES an edge missing its endpoints BY NAME',
		captureRefusalMessageList(() =>
			roundTripEdfiCompiler.findDuplicateEdgeTriples({
				edgeList: [{ type: 'REFERENCES', fromRef: { id: 'edfi:domain/A' } }],
			}),
		),
		/is missing fromRef\.id, type or toRef\.id/,
	);

	// ---- OBSERVATION 1 — RED on a synthetic block carrying one duplicated triple ----
	const syntheticEdge = {
		type: 'REFERENCES',
		fromRef: { source: 'EdFi', id: 'edfi:interchange/FixtureInterchange' },
		toRef: { source: 'EdFi', id: 'edfi:domainEntity/FixtureStudent' },
		properties: { provenanceTier: 'STRUCTURAL' },
	};
	const duplicateBearingAudit = roundTripEdfiCompiler.findDuplicateEdgeTriples({
		edgeList: [syntheticEdge, JSON.parse(JSON.stringify(syntheticEdge))],
	});
	harness.ok(
		`a duplicated (from, type, to) triple is REFUSED and NAMED — ${duplicateBearingAudit.duplicateList.length} duplicate(s), ${duplicateBearingAudit.distinctCount} distinct of 2 edges`,
		duplicateBearingAudit.duplicateList.length === 1 &&
			duplicateBearingAudit.distinctCount === 1 &&
			duplicateBearingAudit.duplicateList[0].occurrenceCount === 2 &&
			duplicateBearingAudit.duplicateList[0].fromStableId === syntheticEdge.fromRef.id &&
			duplicateBearingAudit.duplicateList[0].edgeType === syntheticEdge.type &&
			duplicateBearingAudit.duplicateList[0].toStableId === syntheticEdge.toRef.id,
	);

	// ---- OBSERVATION 2 — GREEN on both real fixture blocks ----
	const carriableAudit = roundTripEdfiCompiler.findDuplicateEdgeTriples({
		edgeList: carriableForged.forgeResult.edges,
	});
	const fullAudit = roundTripEdfiCompiler.findDuplicateEdgeTriples({
		edgeList: fullForged.forgeResult.edges,
	});
	const bothRealBlocksDistinct =
		carriableAudit.duplicateList.length === 0 &&
		carriableAudit.distinctCount === carriableForged.forgeResult.edges.length &&
		fullAudit.duplicateList.length === 0 &&
		fullAudit.distinctCount === fullForged.forgeResult.edges.length;
	harness.ok(
		`both real fixture blocks are triple-distinct — carriable ${carriableAudit.distinctCount}/${carriableForged.forgeResult.edges.length}, full ${fullAudit.distinctCount}/${fullForged.forgeResult.edges.length}`,
		bothRealBlocksDistinct,
	);

	// ---- OBSERVATION 3 — NOT-OVER-BROAD: reordering is not a duplicate ----
	const reorderedAudit = roundTripEdfiCompiler.findDuplicateEdgeTriples({
		edgeList: fullForged.forgeResult.edges.slice().reverse(),
	});
	const reorderStillAccepted =
		reorderedAudit.duplicateList.length === 0 &&
		reorderedAudit.distinctCount === fullAudit.distinctCount;
	harness.ok(
		'a REORDERED edge array is still accepted — the check is order-independent',
		reorderStillAccepted,
	);

	// ---- OBSERVATION 4 — NOT-OVER-BROAD, sharper: near-miss triples sharing TWO of three ----
	// A check keyed on any two components (from+to, or from+type) would wrongly refuse these. That
	// is a failure mode reordering cannot expose, and it is the one an implementation is most
	// likely to have: the reorder control proves order-independence, this proves the KEY is right.
	const sampleFixtureEdge = fullForged.forgeResult.edges[0];
	const nearMissAudit = roundTripEdfiCompiler.findDuplicateEdgeTriples({
		edgeList: fullForged.forgeResult.edges.concat([
			{
				// same from, same type, DIFFERENT to
				type: sampleFixtureEdge.type,
				fromRef: { ...sampleFixtureEdge.fromRef },
				toRef: { ...sampleFixtureEdge.toRef, id: `${sampleFixtureEdge.toRef.id}__nearMissTarget` },
				properties: { ...sampleFixtureEdge.properties },
			},
			{
				// same from, same to, DIFFERENT type
				type: `${sampleFixtureEdge.type}_NEAR_MISS`,
				fromRef: { ...sampleFixtureEdge.fromRef },
				toRef: { ...sampleFixtureEdge.toRef },
				properties: { ...sampleFixtureEdge.properties },
			},
		]),
	});
	const nearMissStillAccepted =
		nearMissAudit.duplicateList.length === 0 &&
		nearMissAudit.distinctCount === fullAudit.distinctCount + 2;
	harness.ok(
		'near-miss triples sharing TWO of the three components are still accepted — the check keys on all THREE',
		nearMissStillAccepted,
	);

	suiteState.probe.forgeEdgeTriplesDistinct =
		duplicateBearingAudit.duplicateList.length === 1 &&
		bothRealBlocksDistinct &&
		reorderStillAccepted &&
		nearMissStillAccepted;
	done();
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
// PHASE P5 (embedText-091426, R-ET-5 / R-ET-20) — a TEXT NODE is excluded from the round trip.
//
// The text node and its EMBEDS_TEXT_OF edge are appended to the CARRIABLE fixture's REAL forge
// result — the same { nodes, edges } the double replays — so they enter at the double's input
// exactly as the forge's own output does. The double's selection (roundTripGraphDouble.js:71-107)
// admits nodes by role through CONSTRUCT_ROLES and three literal roles; the edge loop keeps only
// REFERENCES (:112). The RED TWIN widens CONSTRUCT_ROLES — the one list the double shares with the
// real reader (roundTripEdfiCompiler.js:55, exported at :942) — for the duration of the double's
// SYNCHRONOUS readAll only, then restores it, so the widening touches the selection step and
// nothing downstream.
//
// WHAT THIS PROVES: THE DIFF. It does NOT prove the production Cypher allowlist
// (roundTripEdfiCompiler.js:378-381); only P7's live run does.
const embedTextStatementSetOf = (graphRows) => {
	const emission = roundTripEdfiCompiler.emitGraphStatements({ graphRows });
	if (emission.fault) {
		return { error: emission.fault };
	}
	// the validator's own STAGE 5 identity (roundTripValidator.js:221-223)
	const statementKeyList = Array.from(
		roundTripMetaEdCanonical.assembleStatementMap({ statementList: emission.statementList }).statementMap.keys(),
	).sort();
	const statementSetText = statementKeyList.join('\n');
	return {
		statementCount: statementKeyList.length,
		statementSetText,
		statementSetSha256: crypto.createHash('sha256').update(statementSetText).digest('hex'),
	};
};

// measureEdfiEmbedTextRun — one validation over the double, with the rows the double served captured
// (deep-cloned at selection time) so the emitted statement set is computed from exactly that input.
// admitEmbedTextRole: true widens CONSTRUCT_ROLES for the selection step only.
const measureEdfiEmbedTextRun = ({ forgeResult, snapshotPath, admitEmbedTextRole }, callback) => {
	const doubleReader = roundTripGraphDouble.makeGraphDouble({ forgeResult });
	const constructRoleList = roundTripEdfiCompiler.CONSTRUCT_ROLES;
	let servedGraphRows = null;
	const reader = {
		readAll: (readCallback) => {
			if (admitEmbedTextRole) {
				constructRoleList.push(EMBED_TEXT_ROLE);
			}
			doubleReader.readAll((readError, graphRows) => {
				if (admitEmbedTextRole) {
					constructRoleList.splice(constructRoleList.indexOf(EMBED_TEXT_ROLE), 1);
				}
				servedGraphRows = readError ? null : JSON.parse(JSON.stringify(graphRows));
				readCallback(readError, graphRows);
			});
		},
		close: doubleReader.close,
	};
	roundTripValidator.validateWithReader(
		{ reader, snapshotPath, graphIdentity: { containerName: '(hermetic graph double)', boltUrl: '(none)' } },
		(validateError, verdict) => {
			if (validateError) {
				// the served rows travel WITH the refusal, so a caller can still prove what the
				// selection let through before emission refused it
				callback(validateError, { servedGraphRows });
				return;
			}
			if (!servedGraphRows) {
				callback('measureEdfiEmbedTextRun: the double served no rows, so no statement set can be measured');
				return;
			}
			const statementSet = embedTextStatementSetOf(servedGraphRows);
			if (statementSet.error) {
				callback(statementSet.error);
				return;
			}
			callback('', { verdict, servedGraphRows, ...statementSet });
		},
	);
};

// embedTextExcludedFromEmission — gate G-20's conjunct; every clause an equality with a measured value.
// A run that issued NO verdict (emission refused) cannot satisfy it.
const embedTextExcludedFromEmission = ({ candidateRun, baselineRun }) =>
	Boolean(candidateRun && candidateRun.verdict) &&
	candidateRun.verdict.inventedTotal === 0 &&
	candidateRun.verdict.lostTotal === baselineRun.verdict.lostTotal &&
	candidateRun.statementSetText === baselineRun.statementSetText;

// checkEdfiEmbedTextFixture — identity RE-DERIVED from the text and the REAL forge's root, never
// trusted; a drifted fixture proves nothing and is refused by name.
const checkEdfiEmbedTextFixture = ({ embedTextFixture, forgeResult }) => {
	const { textNode, embedsTextOfEdge } = embedTextFixture || {};
	if (!textNode || !embedsTextOfEdge) {
		return [`${EMBED_TEXT_FIXTURE_PATH}: textNode and embedsTextOfEdge are REQUIRED`];
	}
	const rootNode = forgeResult.nodes.find((oneNode) => oneNode.role === 'DmeStandardRoot');
	const rootStableId = rootNode ? rootNode.stableId : '(no DmeStandardRoot in the forge result)';
	const textProperties = textNode.properties || {};
	const textSha256 = crypto.createHash('sha256').update(String(textProperties.text)).digest('hex');
	const expectedStableId = `${rootStableId}/embedText/${textSha256}`;
	const propertyNameList = (embedsTextOfEdge.properties || {}).propertyNameList || [];
	return [
		[textNode.role === EMBED_TEXT_ROLE, `role is '${textNode.role}'`],
		[
			['ForgedNode', 'EdfiEmbedText', EMBED_TEXT_ROLE].every((oneLabel) => (textNode.labels || []).includes(oneLabel)),
			`labels ${JSON.stringify(textNode.labels)} lack the [ForgedNode, EdfiEmbedText, DmeEmbedText] triple`,
		],
		[textNode.stableId === expectedStableId, `stableId '${textNode.stableId}' is not '${expectedStableId}'`],
		[textProperties.edfiStableId === expectedStableId, 'edfiStableId is not the stableId'],
		[textProperties.parentId === rootStableId, `parentId '${textProperties.parentId}' is not the forge root '${rootStableId}'`],
		[textProperties._source === forgeResult.nodes[0].properties._source, `_source '${textProperties._source}' is not the forge's`],
		[textProperties.path === `embedText/${textSha256}`, 'path is not embedText/<sha256(text)>'],
		[textProperties.name === undefined, 'a text node carries no name'],
		[textProperties.searchText === undefined, 'a text node carries no searchText'],
		[embedsTextOfEdge.type === 'EMBEDS_TEXT_OF', `edge type is '${embedsTextOfEdge.type}'`],
		[embedsTextOfEdge.fromRef.id === expectedStableId, 'the edge does not leave the text node'],
		[
			forgeResult.nodes.some((oneNode) => oneNode.stableId === embedsTextOfEdge.toRef.id),
			`the edge's target '${embedsTextOfEdge.toRef.id}' is not in the forge result`,
		],
		[
			propertyNameList.length > 0 && JSON.stringify(propertyNameList) === JSON.stringify(propertyNameList.slice().sort()),
			`propertyNameList ${JSON.stringify(propertyNameList)} is not a non-empty sorted list`,
		],
	]
		.filter(([holds]) => !holds)
		.map(([, complaint]) => `${EMBED_TEXT_FIXTURE_PATH}: ${complaint}`);
};

pushStep((done) => {
	harness.section(
		"PHASE P5 — a TEXT NODE and its EMBEDS_TEXT_OF edge are excluded from the round trip (proves the DIFF; the production allowlist is P7's)",
	);
	const forged = suiteState.carriableForge;
	if (!forged) {
		harness.ok('carriable forge available for the embed-text proof', false);
		done();
		return;
	}
	if (!fs.existsSync(EMBED_TEXT_FIXTURE_PATH)) {
		harness.ok('the embed-text fixture exists', false, `${EMBED_TEXT_FIXTURE_PATH} is REQUIRED`);
		done();
		return;
	}
	const embedTextFixture = JSON.parse(fs.readFileSync(EMBED_TEXT_FIXTURE_PATH, 'utf8'));
	const fixtureComplaintList = checkEdfiEmbedTextFixture({ embedTextFixture, forgeResult: forged.forgeResult });
	harness.equal('the text node and edge have the R-ET-1/R-ET-4 shape (identity re-derived)', fixtureComplaintList.length, 0);
	if (fixtureComplaintList.length) {
		harness.note(fixtureComplaintList.join('\n'));
		done();
		return;
	}
	const { textNode, embedsTextOfEdge } = embedTextFixture;
	const forgeResultWithText = {
		...forged.forgeResult,
		nodes: forged.forgeResult.nodes.concat([textNode]),
		edges: forged.forgeResult.edges.concat([embedsTextOfEdge]),
	};
	const originalConstructRoleText = JSON.stringify(roundTripEdfiCompiler.CONSTRUCT_ROLES);

	measureEdfiEmbedTextRun({ forgeResult: forged.forgeResult, snapshotPath: forged.snapshotPath }, (baselineError, baselineRun) => {
		harness.accepts('the run WITHOUT the text node measures', [baselineError].filter(Boolean));
		if (baselineError) {
			done();
			return;
		}
		harness.equal(
			'the fresh baseline agrees with the RT-7 carriable verdict (lostTotal)',
			baselineRun.verdict.lostTotal,
			suiteState.carriableVerdict.lostTotal,
		);
		measureEdfiEmbedTextRun({ forgeResult: forgeResultWithText, snapshotPath: forged.snapshotPath }, (withTextError, withTextRun) => {
			harness.accepts('the run WITH the text node measures', [withTextError].filter(Boolean));
			if (withTextError) {
				done();
				return;
			}
			harness.equal('WITH the text node: inventedTotal is 0', withTextRun.verdict.inventedTotal, 0);
			harness.equal(
				`WITH the text node: lostTotal EQUALS the run without it (${baselineRun.verdict.lostTotal})`,
				withTextRun.verdict.lostTotal,
				baselineRun.verdict.lostTotal,
			);
			harness.ok(
				`the emitted statement set is byte-identical (${baselineRun.statementCount} statements, sha256 ${baselineRun.statementSetSha256})`,
				withTextRun.statementSetText === baselineRun.statementSetText,
				`with the text node: ${withTextRun.statementCount} statements, sha256 ${withTextRun.statementSetSha256}`,
			);
			harness.equal(
				'the served rows are identical with and without the text node (the selection dropped it)',
				JSON.stringify(withTextRun.servedGraphRows.constructRowList.concat(withTextRun.servedGraphRows.propertyRowList, withTextRun.servedGraphRows.optionValueRowList, withTextRun.servedGraphRows.itemEdgeRowList)),
				JSON.stringify(baselineRun.servedGraphRows.constructRowList.concat(baselineRun.servedGraphRows.propertyRowList, baselineRun.servedGraphRows.optionValueRowList, baselineRun.servedGraphRows.itemEdgeRowList)),
			);
			// RECORDED, NOT GATED (brief): the diagnostic census now lists the new role and edge type.
			// roundTripValidator.js places nodeCountByRole / edgeCountByType only under verdict.graph
			// (:389-390); inventedTotal is headline.invented + crosswalk guard violations (:270).
			const nodeCountByRole = withTextRun.verdict.graph.nodeCountByRole;
			const edgeCountByType = withTextRun.verdict.graph.edgeCountByType;
			harness.ok(
				`census (recorded, not gated): verdict.graph.nodeCountByRole lists DmeEmbedText (${nodeCountByRole[EMBED_TEXT_ROLE]}) and edgeCountByType lists EMBEDS_TEXT_OF (${edgeCountByType.EMBEDS_TEXT_OF})`,
				nodeCountByRole[EMBED_TEXT_ROLE] === 1 && edgeCountByType.EMBEDS_TEXT_OF === 1,
			);
			const exclusionHolds = embedTextExcludedFromEmission({ candidateRun: withTextRun, baselineRun });
			harness.ok('gate G-20 conjunct holds over the real runs', exclusionHolds);

			measureEdfiEmbedTextRun(
				{ forgeResult: forgeResultWithText, snapshotPath: forged.snapshotPath, admitEmbedTextRole: true },
				(admittedError, admittedRun) => {
					harness.equal(
						'CONSTRUCT_ROLES is restored after the widened selection',
						JSON.stringify(roundTripEdfiCompiler.CONSTRUCT_ROLES),
						originalConstructRoleText,
					);
					// MEASURED 2026-09-14: on Ed-Fi an admitted text node is NOT counted as invention. The row
					// reaches emitGraphStatements, which REFUSES a construct row lacking constructType or name
					// (roundTripEdfiCompiler.js:670-671), and the validator issues no verdict. The kit mints a
					// text node with neither (R-ET-2), so inventedTotal > 0 is unobservable here without
					// fabricating fields no text node carries. The RED is therefore the named refusal OR an
					// invention — never a silent pass — and the observed outcome is recorded verbatim.
					harness.equal(
						'the widening reached the selection: one more construct row was served',
						((admittedRun || {}).servedGraphRows || { constructRowList: [] }).constructRowList.length,
						baselineRun.servedGraphRows.constructRowList.length + 1,
					);
					const admittedOutcomeText = admittedError
						? `REFUSED BY NAME at emission, no verdict issued: ${admittedError}`
						: `inventedTotal ${admittedRun.verdict.inventedTotal}, lostTotal ${admittedRun.verdict.lostTotal}, invented subjects ${JSON.stringify(Array.from(new Set(admittedRun.verdict.report.inventedDetailList.map((one) => one.subject))))}`;
					harness.ok(
						`RED TWIN admitEmbedTextRole (data level): the admitted text node does NOT pass silently (${admittedOutcomeText})`,
						admittedError
							? /emitGraphStatements FAULT/.test(String(admittedError))
							: admittedRun.verdict.inventedTotal > 0,
					);
					harness.equal(
						'gate G-20 conjunct goes FALSE over the admitting run',
						embedTextExcludedFromEmission({ candidateRun: admittedRun, baselineRun }),
						false,
					);
					harness.note(
						`P5 evidence (Ed-Fi): baseline inventedTotal ${baselineRun.verdict.inventedTotal}, lostTotal ${baselineRun.verdict.lostTotal}, ` +
							`${baselineRun.statementCount} statements sha256 ${baselineRun.statementSetSha256}; ` +
							`with text node inventedTotal ${withTextRun.verdict.inventedTotal}, lostTotal ${withTextRun.verdict.lostTotal}, ` +
							`sha256 ${withTextRun.statementSetSha256}; census DmeEmbedText ${nodeCountByRole[EMBED_TEXT_ROLE]}, EMBEDS_TEXT_OF ${edgeCountByType.EMBEDS_TEXT_OF}; ` +
							`admitting twin: ${admittedOutcomeText}`,
					);
					suiteState.probe.embedTextExcludedFromEmission = exclusionHolds;
					done();
				},
			);
		});
	});
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('RT-10 — gate suite: all 20 green AND every twin observed RED');

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
