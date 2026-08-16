#!/usr/bin/env node
'use strict';

// test-forgeEdfi.js — the HERMETIC suite for the forge-edfi forge (Phase 2, rulings
// R-WO-8..R-WO-11; renamed from test-forgeEdfiV2.js at the Phase 5 closeout when the forge took
// its RT-1 manifest name).
//
// NOTHING HERE TOUCHES THE REAL SNAPSHOT, DOCKER, THE NETWORK, OR ANY EMBEDDING PROVIDER.
// Every run builds a throwaway five-input snapshot under os.tmpdir() (MetaEd sources reusing
// the Phase 1 synthetic grammar fixture forms, descriptor code-value XMLs, authored crosswalk
// CSVs, SHA256SUMS, README_PROVENANCE.md peers) and runs the full forge with skipEmbedding.
//
// COVERAGE:
//   contract shape — role mapping per R-WO-9 (DmeClass/DmeProperty/DmeOptionSet/DmeOptionValue/
//     DmeSupport), root provenance block, stableId scheme (owner-typed property ids, trimmed
//     value identity with verbatim name), edge inventory (HAS_CLASS/HAS_SUPPORT/HAS_PROPERTY/
//     HAS_OPTION_SET/HAS_VALUE/SUBCLASS_OF/REFERENCES/REFERENCES_TYPE), absent-is-absent (RT-2),
//     crosswalk stash + R-WO-11 reporting, item-keyword drift census, determinism (two builds,
//     one canonical hash).
//   refusal twins (every negative uses harness.rejects with a SPECIFIC regex — observed-red
//     discipline): missing input folder (F3: README_PROVENANCE.md named), checksum mismatch,
//     manifest drift, R-WO-10 unknown-descriptor XML, conflicting duplicate code values,
//     missing crosswalk, unresolvable model reference, non-Descriptor record element, empty
//     CodeValue, duplicate stableId.
//
// Run: node forges/edfi/test/test-forgeEdfi.js [-verbose]

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic suite for the forge-edfi forge (Phase 2)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Builds throwaway five-input snapshots under os.tmpdir() and exercises the forge's
     contract shape, crosswalk carriage, determinism, and refusal doctrine. Touches no real
     snapshot bytes, no Docker, no network, no embedding provider.

EXIT
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

// the framework refuses an ABSENT embedder key by name; null = the spend knob is off (SPEC §3.2)
const forgeEdfi = require('../forgeEdfi.js')({ embedder: null });
const forgeEdfiContractGraph = require('../lib/forgeEdfiContractGraph')();
const edfiForgeDeclaration = require('../lib/edfiForgeDeclaration');
// the SAME kit the walk is handed, built from Ed-Fi's declaration (its cedsAnchorAbsentSentinelList) —
// the CEDS anchor normalizer moved into it at the F3b migration (kit.cedsAnchorValue, D14)
const { contractGraphKit } = require('../../../lib/forge-framework/contractGraphKit');

// =====================================================================
// scratch snapshot builder — a VALID five-input snapshot; tests mutate copies of it
// =====================================================================

const CORE_METAED_TEXT = [
	'Abstract Entity FixtureOrganization [9001]',
	'    documentation "An abstract fixture organization."',
	'    integer FixtureOrganizationId [9002]',
	'        documentation "The fixture organization identifier."',
	'        is part of identity',
	'',
	'Domain Entity FixtureStudent [9010]',
	'    documentation "A fixture student."',
	'    shared string FixtureUniqueId named FixtureStudentUniqueId [9011]',
	'        documentation "The fixture student unique identifier."',
	'        is part of identity',
	'    bool FixtureActiveIndicator [9012]',
	'        documentation inherited',
	'        is optional',
	'    descriptor FixtureLevel [9014]',
	'        documentation "A fixture level descriptor reference."',
	'        is optional collection',
	'    domain entity FixtureSchool [9015]',
	'        documentation "A fixture school reference."',
	'        is required',
	'',
	'Domain Entity FixtureSchool [9020]',
	'    documentation "A fixture school."',
	'    integer FixtureSchoolId [9021]',
	'        documentation "The fixture school identifier."',
	'        is part of identity',
	'    string FixtureSchoolName [9022]',
	'        documentation "The fixture school name."',
	'        is required',
	'        max length 75',
	'    string FixtureAddress [9023]',
	'        documentation "The fixture address with a role name."',
	'        is optional',
	'        role name Mailing',
	'        max length 150',
	'    enumeration FixtureSchoolYear [9024]',
	'        documentation "The fixture school year reference."',
	'        is optional',
	'',
	'Domain Entity FixtureCharterSchool based on FixtureSchool [9040]',
	'    documentation "A fixture charter school subclass."',
	'    integer FixtureCharterSchoolId [9041]',
	'        documentation "The renamed fixture charter school identifier."',
	'        renames identity property FixtureSchoolId',
	'',
	'Association FixtureStudentSchoolAssociation [9050]',
	'    documentation "Associates a fixture student with a fixture school."',
	'    domain entity FixtureStudent [9051]',
	'        documentation "The fixture student in the association."',
	'    domain entity FixtureSchool [9052]',
	'        documentation "The fixture school in the association."',
	'    date FixtureEntryDate [9053]',
	'        documentation "The fixture entry date."',
	'        is part of identity',
	'',
	'Descriptor FixtureLevel [9090]',
	'    documentation "A fixture level descriptor."',
	'',
	'Descriptor FixtureShade [9095]',
	'    documentation "A fixture shade descriptor with an optional map type."',
	'    with optional map type',
	'        documentation "The fixture shade map type."',
	'        item "Light"',
	'',
	'Enumeration FixtureSchoolYear [9100]',
	'    documentation "The fixture school year enumeration."',
	'    item "2025-2026" [9100-001]',
	'        documentation "The 2025-2026 fixture year."',
	'    item "2026-2027" [9100-002]',
	'',
	'Shared String FixtureUniqueId [9110]',
	'    documentation "A shared fixture unique identifier string."',
	'    min length 1',
	'    max length 32',
	'',
	'Domain FixtureLearning [9120]',
	'    documentation "A fixture domain."',
	'    domain entity FixtureStudent [9121]',
	'    domain entity FixtureStudentSchoolAssociation',
	'    descriptor FixtureLevel',
	'    footer documentation "The fixture domain footer."',
	'',
	'Subdomain FixtureEnrollment of FixtureLearning [9130]',
	'    documentation "A fixture subdomain."',
	'    domain entity FixtureStudent',
	'    position 2',
	'',
	'Interchange FixtureStudentRoster [9140]',
	'    documentation "The fixture student roster interchange."',
	'    domain entity identity FixtureSchool [9141]',
	'    domain entity FixtureStudent [9142]',
	'    descriptor FixtureLevel',
	'',
].join('\n');

const TPDM_METAED_TEXT = [
	'Domain Entity EdFi.FixtureStudent additions [9500]',
	'    date FixtureTpdmDate [9501]',
	'        documentation "A fixture TPDM extension date."',
	'        is optional',
	'',
	'Descriptor FixtureTpdmThing [9510]',
	'    documentation "A fixture TPDM descriptor."',
	'',
].join('\n');

// the drifted-filename case: the FILE is named FixtureShadeThing.xml but its record element is
// FixtureShadeDescriptor — the element joins the model, the filename does not (measured corpus
// behavior, TransportationPublicExpenseEligibility)
const CORE_XML_BY_FILE_NAME = {
	'FixtureLevelDescriptor.xml': [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<InterchangeDescriptors xmlns="http://ed-fi.org/fixture">',
		'\t<FixtureLevelDescriptor>',
		'\t\t<CodeValue>Alpha</CodeValue>',
		'\t\t<ShortDescription>Alpha level</ShortDescription>',
		'\t\t<Description>The alpha fixture level.</Description>',
		'\t\t<Namespace>uri://fixture/FixtureLevelDescriptor</Namespace>',
		'\t</FixtureLevelDescriptor>',
		'\t<FixtureLevelDescriptor>',
		'\t\t<CodeValue>Trailing Value </CodeValue>',
		'\t\t<ShortDescription>Trailing</ShortDescription>',
		'\t\t<Description>A code value with a trailing space, verbatim from source.</Description>',
		'\t\t<Namespace>uri://fixture/FixtureLevelDescriptor</Namespace>',
		'\t</FixtureLevelDescriptor>',
		'</InterchangeDescriptors>',
		'',
	].join('\n'),
	'FixtureShadeThing.xml': [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<InterchangeDescriptors xmlns="http://ed-fi.org/fixture">',
		'\t<FixtureShadeDescriptor>',
		'\t\t<CodeValue>Dark</CodeValue>',
		'\t\t<Namespace>uri://fixture/FixtureShadeDescriptor</Namespace>',
		'\t</FixtureShadeDescriptor>',
		'</InterchangeDescriptors>',
		'',
	].join('\n'),
};

const TPDM_XML_BY_FILE_NAME = {
	'FixtureTpdmThingDescriptor.xml': [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<InterchangeDescriptors xmlns="http://ed-fi.org/fixture">',
		'\t<FixtureTpdmThingDescriptor>',
		'\t\t<CodeValue>TpdmOne</CodeValue>',
		'\t\t<Description>The first fixture TPDM value.</Description>',
		'\t\t<Namespace>uri://fixture/FixtureTpdmThingDescriptor</Namespace>',
		'\t</FixtureTpdmThingDescriptor>',
		'</InterchangeDescriptors>',
		'',
	].join('\n'),
};

const ELEMENTS_CSV_TEXT = [
	'EdFiEntity,EdFiEntityPath,EdFiElementName,EdFiElementType,EdFiRequired,EdFiElementDescription,EdFiEntityDescription,CEDSElementName,CEDSElementType,CEDSElementDefinition,CEDSGlobalId',
	'FixtureSchool,FixtureSchool,FixtureSchoolName,String,1,The fixture school name.,,Fixture Name,Element,The fixture name.,000123',
	'FixtureSchool,FixtureSchool,FixtureSchoolId,Integer,1,The fixture school id.,,Fixture Id,Element,The fixture id.,000000',
	'FixtureStudent,FixtureStudent,FixtureLevelDescriptor,Descriptor,0,The fixture level reference.,,Fixture Level,Element,The fixture level.,000321',
	'OldWorldEntity,OldWorldEntity,OldWorldElement,String,0,An old-world element with no new-model home.,,Old Thing,Element,The old thing.,000777',
	'',
].join('\n');

const DESCRIPTORS_CSV_TEXT = [
	'EdFiVersionNumber,EdFiNamespace,EdFiCodeValue,EdFiShortDescription,EdFiDescription,EdFiElementName,EdFiEntity,EdFiPath,EdFiDescription,CEDSElementName,CEDSGlobalId,CEDSOptionCode,CEDSOptionDescription',
	'DS5.2,uri://fixture/FixtureLevelDescriptor,Alpha,Alpha level,The alpha fixture level.,FixtureLevelDescriptor,FixtureStudent,FixtureLevel,The level element.,Fixture Level Type,000456,AlphaOption,The alpha option.',
	'DS5.2,uri://fixture/FixtureLevelDescriptor,Gone,Gone level,A value the new model does not carry.,FixtureLevelDescriptor,FixtureStudent,FixtureLevel,The level element.,Fixture Level Type,000456,GoneOption,The gone option.',
	'',
].join('\n');

const buildScratchSnapshot = () => {
	const scratchSnapshotPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edfiPhase2Snapshot-'));
	const fileMap = {
		'README_PROVENANCE.md': '# scratch provenance (hermetic Phase 2 test fixture)\n',
		standardSourceLocation: 'standard: forge-edfi\npublishedVersion: fixture\n',
		'metaEdModel/package.json': JSON.stringify({
			name: '@edfi/scratch-model',
			metaEdProject: { projectName: 'Ed-Fi', projectVersion: '5.2.0' },
		}),
		'metaEdModel/DomainEntity/FixtureCore.metaed': CORE_METAED_TEXT,
		'tpdmCommunityModel/package.json': JSON.stringify({
			description: 'scratch tpdm',
			metaEdProject: { projectName: 'TPDM', projectVersion: '1.2.0' },
		}),
		'tpdmCommunityModel/DomainEntity/FixtureTpdm.metaed': TPDM_METAED_TEXT,
		[`cedsAuthoredCrosswalk/EdFiEntityElementsToCEDS.csv`]: ELEMENTS_CSV_TEXT,
		[`cedsAuthoredCrosswalk/EdFiEntityDescriptorsToCEDS.csv`]: DESCRIPTORS_CSV_TEXT,
	};
	Object.entries(CORE_XML_BY_FILE_NAME).forEach(([fileName, xmlText]) => {
		fileMap[`descriptorCodeValues/${fileName}`] = xmlText;
	});
	Object.entries(TPDM_XML_BY_FILE_NAME).forEach(([fileName, xmlText]) => {
		fileMap[`tpdmDescriptorCodeValues/${fileName}`] = xmlText;
	});
	Object.entries(fileMap).forEach(([relativePath, fileText]) => {
		const absolutePath = path.join(scratchSnapshotPath, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, fileText);
	});
	writeScratchSha256Sums(scratchSnapshotPath);
	return scratchSnapshotPath;
};

// (re)generate SHA256SUMS over the source files of all five inputs — called after any mutation
// that is NOT supposed to trip the checksum gate
const writeScratchSha256Sums = (scratchSnapshotPath) => {
	const sumLineList = [];
	const walkForSums = (relativeDirectory) => {
		const absoluteDirectory = path.join(scratchSnapshotPath, relativeDirectory);
		if (!fs.existsSync(absoluteDirectory)) {
			return;
		}
		fs.readdirSync(absoluteDirectory, { withFileTypes: true })
			.sort((left, right) => left.name.localeCompare(right.name))
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
	[
		'metaEdModel',
		'descriptorCodeValues',
		'tpdmCommunityModel',
		'tpdmDescriptorCodeValues',
		'cedsAuthoredCrosswalk',
	].forEach(walkForSums);
	fs.writeFileSync(
		path.join(scratchSnapshotPath, 'SHA256SUMS'),
		`${sumLineList.join('\n')}\n`,
	);
};

const runForgeOn = (snapshotPath, runCallback) => {
	forgeEdfi.forge(
		{ sourcePath: snapshotPath, skipEmbedding: true },
		(forgeError, forged) => {
			runCallback(forgeError || '', forged || null);
		},
	);
};

const canonicalGraphHash = (forged) => {
	const canonicalText = JSON.stringify({
		nodes: forged.nodes.map((oneNode) => ({
			labels: oneNode.labels,
			stableId: oneNode.stableId,
			role: oneNode.role,
			properties: Object.keys(oneNode.properties)
				.sort()
				.reduce((ordered, propertyName) => {
					ordered[propertyName] = oneNode.properties[propertyName];
					return ordered;
				}, {}),
		})),
		edges: forged.edges,
	});
	return crypto.createHash('sha256').update(canonicalText).digest('hex');
};

const nodeById = (forged, stableId) =>
	forged.nodes.find((oneNode) => oneNode.stableId === stableId);
const edgesOfType = (forged, edgeType) =>
	forged.edges.filter((oneEdge) => oneEdge.type === edgeType);

// =====================================================================
// the suite — an explicit async step chain ending in harness.report()
// =====================================================================

const testStepList = [];
const pushStep = (stepFunction) => testStepList.push(stepFunction);
const runNextStep = () => {
	const nextStep = testStepList.shift();
	if (!nextStep) {
		harness.report();
		return;
	}
	nextStep(() => setImmediate(runNextStep));
};

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('CONTRACT SHAPE — full forge over a valid five-input scratch snapshot');
	const snapshotPath = buildScratchSnapshot();
	runForgeOn(snapshotPath, (forgeError, forged) => {
		harness.accepts('valid scratch snapshot forges without refusal', [forgeError].filter(Boolean));
		if (!forged) {
			done();
			return;
		}

		// role mapping (R-WO-9)
		const roleCounts = forged.stats.nodeCountByRole;
		harness.equal('exactly one DmeStandardRoot', roleCounts.DmeStandardRoot, 1);
		// classes: FixtureOrganization, FixtureStudent, FixtureSchool, FixtureCharterSchool,
		// FixtureStudentSchoolAssociation, FixtureStudent-additions (extension) = 6
		harness.equal('DmeClass count (incl. subclass + extension)', roleCounts.DmeClass, 6);
		// option sets: FixtureLevel, FixtureShade, FixtureTpdmThing, FixtureSchoolYear = 4
		harness.equal('DmeOptionSet count (descriptors + enumeration)', roleCounts.DmeOptionSet, 4);
		// supports: FixtureUniqueId, FixtureLearning, FixtureEnrollment, FixtureStudentRoster = 4
		harness.equal('DmeSupport count (shared type, domain, subdomain, interchange)', roleCounts.DmeSupport, 4);
		// option values: Alpha, 'Trailing Value ', Dark, TpdmOne (XML) + Light (map type) +
		// 2025-2026, 2026-2027 (enumeration) = 7
		harness.equal('DmeOptionValue count (XML + map type + enumeration items)', roleCounts.DmeOptionValue, 7);

		// root provenance block
		const rootNode = nodeById(forged, 'edfi:root');
		harness.ok('root node exists', Boolean(rootNode));
		harness.equal('root parserVersion is 2', rootNode.properties.parserVersion, '2');
		harness.equal(
			'root stableUriPropertyName',
			rootNode.properties.stableUriPropertyName,
			'edfiStableId',
		);
		harness.match(
			'root mappingInstruction carries the CEDS anchor contract',
			rootNode.properties.mappingInstruction,
			/CEDSGlobalId/,
		);

		// stableId scheme
		harness.ok(
			'construct stableId is edfi:<constructType>/<Name>',
			Boolean(nodeById(forged, 'edfi:domainEntity/FixtureStudent')),
		);
		harness.ok(
			'extension construct id is distinct from its extendee',
			Boolean(nodeById(forged, 'edfi:domainEntityExtension/FixtureStudent')),
		);
		harness.ok(
			'property stableId carries the owner constructType',
			Boolean(nodeById(forged, 'edfi:property/domainEntity.FixtureSchool.FixtureSchoolName')),
		);
		const roleNamedProperty = nodeById(
			forged,
			'edfi:property/domainEntity.FixtureSchool.MailingFixtureAddress',
		);
		harness.ok('role name prefixes the effective property name', Boolean(roleNamedProperty));

		// trimmed value identity, verbatim value name
		const trailingValueNode = nodeById(forged, 'edfi:value/FixtureLevel.Trailing Value');
		harness.ok('trailing-space code value: stableId uses TRIMMED identity', Boolean(trailingValueNode));
		harness.equal(
			'trailing-space code value: name property stays VERBATIM',
			trailingValueNode && trailingValueNode.properties.name,
			'Trailing Value ',
		);

		// the drifted-filename XML joined by ELEMENT name
		harness.ok(
			'drifted-filename XML joins by record element (FixtureShade gets Dark)',
			Boolean(nodeById(forged, 'edfi:value/FixtureShade.Dark')),
		);

		// edges
		harness.equal('HAS_CLASS count', edgesOfType(forged, 'HAS_CLASS').length, 6);
		harness.equal('HAS_SUPPORT count', edgesOfType(forged, 'HAS_SUPPORT').length, 4);
		harness.equal('SUBCLASS_OF count (FixtureCharterSchool)', edgesOfType(forged, 'SUBCLASS_OF').length, 1);
		const optionSetEdges = edgesOfType(forged, 'HAS_OPTION_SET');
		harness.ok(
			'descriptor property owns its option set (property -> FixtureLevel HAS_OPTION_SET)',
			optionSetEdges.some(
				(oneEdge) =>
					oneEdge.fromRef.id === 'edfi:property/domainEntity.FixtureStudent.FixtureLevel' &&
					oneEdge.toRef.id === 'edfi:descriptor/FixtureLevel',
			),
		);
		harness.ok(
			'orphan option sets are root-anchored (FixtureShade, FixtureTpdmThing)',
			optionSetEdges.some(
				(oneEdge) =>
					oneEdge.fromRef.id === 'edfi:root' && oneEdge.toRef.id === 'edfi:descriptor/FixtureShade',
			) && forged.stats.orphanAnchoredOptionSets >= 2,
		);
		harness.ok(
			'shared property emits REFERENCES_TYPE to its shared type',
			edgesOfType(forged, 'REFERENCES_TYPE').some(
				(oneEdge) => oneEdge.toRef.id === 'edfi:sharedString/FixtureUniqueId',
			),
		);
		harness.ok(
			'extension REFERENCES its extendee',
			edgesOfType(forged, 'REFERENCES').some(
				(oneEdge) =>
					oneEdge.fromRef.id === 'edfi:domainEntityExtension/FixtureStudent' &&
					oneEdge.toRef.id === 'edfi:domainEntity/FixtureStudent',
			),
		);

		// item keyword drift census: FixtureLearning declares 'domain entity
		// FixtureStudentSchoolAssociation' (actually an association)
		harness.equal(
			'domain item keyword drift is CENSUSED (declared domainEntity, actual association)',
			forged.stats.itemKeywordMismatchList.length,
			1,
		);

		// absent-is-absent (RT-2)
		const lightMapTypeValue = nodeById(forged, 'edfi:value/FixtureShade.Light');
		harness.ok(
			'map-type item without documentation carries NO description property',
			lightMapTypeValue && !('description' in lightMapTypeValue.properties),
		);
		const inheritedDocProperty = nodeById(
			forged,
			'edfi:property/domainEntity.FixtureStudent.FixtureActiveIndicator',
		);
		harness.ok(
			'documentation-inherited property: documentationInherited true, no description',
			inheritedDocProperty &&
				inheritedDocProperty.properties.documentationInherited === true &&
				!('description' in inheritedDocProperty.properties),
		);
		harness.ok(
			'no node carries an empty-string description (RT-2: no \'\'-as-value)',
			forged.nodes.every((oneNode) => oneNode.properties.description !== ''),
		);

		// crosswalk carriage (R-WO-4) + reporting (R-WO-11)
		const matchedProperty = nodeById(
			forged,
			'edfi:property/domainEntity.FixtureSchool.FixtureSchoolName',
		);
		harness.equal(
			'matched crosswalk property carries canonical cedsId',
			matchedProperty.properties.cedsId,
			'P000123',
		);
		harness.match(
			'matched crosswalk property carries crossRefs with the raw anchor',
			matchedProperty.properties.crossRefs,
			/"raw":"000123"/,
		);
		const alphaValueNode = nodeById(forged, 'edfi:value/FixtureLevel.Alpha');
		harness.equal(
			'matched crosswalk option value carries cedsOptionCode',
			alphaValueNode.properties.cedsOptionCode,
			'AlphaOption',
		);
		const report = forged.crosswalkMatchReport;
		harness.equal('sentinel-only crosswalk row still matches (FixtureSchoolId)', report.propertyRows.matchedCount, 3);
		harness.equal(
			'descriptor-suffix tier matched exactly one row (censused separately)',
			report.propertyRows.matchedByDescriptorSuffixCount,
			1,
		);
		const suffixMatchedProperty = nodeById(
			forged,
			'edfi:property/domainEntity.FixtureStudent.FixtureLevel',
		);
		harness.equal(
			"old-world 'FixtureLevelDescriptor' element lands on the descriptor-reference property",
			suffixMatchedProperty.properties.cedsId,
			'P000321',
		);
		harness.equal(
			'unmatched crosswalk property row is REPORTED, not refused, not invented',
			report.propertyRows.unmatchedList.length,
			1,
		);
		harness.equal(
			'unmatched property row names its old-world identity',
			report.propertyRows.unmatchedList[0].edfiEntityName,
			'OldWorldEntity',
		);
		harness.ok(
			'no node was invented for the unmatched row',
			!forged.nodes.some((oneNode) => `${oneNode.properties.name}`.includes('OldWorldElement')),
		);
		harness.equal(
			'unmatched crosswalk VALUE row (Gone) is reported',
			report.optionValueRows.unmatchedList.length,
			1,
		);

		// structural contract finalizer ran: crossRefs universal
		harness.ok(
			"crossRefs is present on every node ('[]' default from the finalizer)",
			forged.nodes.every((oneNode) => typeof oneNode.properties.crossRefs === 'string'),
		);

		done();
	});
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('DETERMINISM — two builds of the same snapshot, one canonical hash');
	const snapshotPath = buildScratchSnapshot();
	runForgeOn(snapshotPath, (firstError, firstForged) => {
		harness.accepts('first build succeeds', [firstError].filter(Boolean));
		runForgeOn(snapshotPath, (secondError, secondForged) => {
			harness.accepts('second build succeeds', [secondError].filter(Boolean));
			if (!firstForged || !secondForged) {
				done();
				return;
			}
			const firstHash = canonicalGraphHash(firstForged);
			const secondHash = canonicalGraphHash(secondForged);
			harness.equal(
				`canonical graph hash is STABLE across two builds (${firstHash.slice(0, 16)}…)`,
				firstHash,
				secondHash,
			);
			done();
		});
	});
});

// ---------------------------------------------------------------------
// refusal twins — each mutates a fresh scratch snapshot and must go RED for the RIGHT reason
// ---------------------------------------------------------------------

const pushRefusalStep = ({ sectionLabel, mutateSnapshot, expectedRegex }) => {
	pushStep((done) => {
		harness.section(`REFUSAL — ${sectionLabel}`);
		const snapshotPath = buildScratchSnapshot();
		mutateSnapshot(snapshotPath);
		runForgeOn(snapshotPath, (forgeError) => {
			harness.rejects(sectionLabel, [forgeError].filter(Boolean), expectedRegex);
			done();
		});
	});
};

pushRefusalStep({
	sectionLabel: 'missing descriptorCodeValues folder refuses naming README_PROVENANCE.md (F3)',
	mutateSnapshot: (snapshotPath) => {
		fs.rmSync(path.join(snapshotPath, 'descriptorCodeValues'), { recursive: true });
		// SHA256SUMS deliberately NOT regenerated: the folder refusal must fire on the FOLDER,
		// and the manifest still names the folder's files — either way the refusal names the
		// provenance README; the folder-missing arm fires first
	},
	// since the F3b migration the FRAMEWORK verifies every SHA256SUMS-listed file BEFORE any loader
	// runs (forge() step 2; P11/C5 discharged) — the refusal names the first listed file missing
	// on disk and the acquisition recipe (README_PROVENANCE.md); the loader's own folder refusal
	// (F3) still stands behind it and fires when the manifest itself lists no such file
	expectedRegex: /listed file 'descriptorCodeValues\/[^']+' is missing on disk[\s\S]*README_PROVENANCE\.md/,
});

pushRefusalStep({
	sectionLabel: 'corrupt descriptor XML refuses with BOTH hashes named',
	mutateSnapshot: (snapshotPath) => {
		fs.appendFileSync(
			path.join(snapshotPath, 'descriptorCodeValues', 'FixtureLevelDescriptor.xml'),
			' ',
		);
	},
	// the framework's forge-time verification (step 2) names BOTH hashes, as the loader did
	expectedRegex: /'descriptorCodeValues\/FixtureLevelDescriptor\.xml' sha256 MISMATCH — SHA256SUMS says [0-9a-f]{64}, disk has [0-9a-f]{64}/,
});

pushRefusalStep({
	sectionLabel: 'manifest drift (unlisted file on disk) refuses',
	mutateSnapshot: (snapshotPath) => {
		fs.writeFileSync(
			path.join(snapshotPath, 'tpdmDescriptorCodeValues', 'FixtureSneaky.xml'),
			'<InterchangeDescriptors></InterchangeDescriptors>',
		);
	},
	expectedRegex: /'tpdmDescriptorCodeValues\/FixtureSneaky\.xml' exists on disk but is NOT listed in SHA256SUMS/,
});

pushRefusalStep({
	sectionLabel: 'code-value XML naming an unknown descriptor refuses (R-WO-10)',
	mutateSnapshot: (snapshotPath) => {
		fs.writeFileSync(
			path.join(snapshotPath, 'descriptorCodeValues', 'FixtureUnknownThingDescriptor.xml'),
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<InterchangeDescriptors>',
				'\t<FixtureUnknownThingDescriptor>',
				'\t\t<CodeValue>Ghost</CodeValue>',
				'\t</FixtureUnknownThingDescriptor>',
				'</InterchangeDescriptors>',
			].join('\n'),
		);
		writeScratchSha256Sums(snapshotPath);
	},
	expectedRegex: /R-WO-10[\s\S]*names descriptor 'FixtureUnknownThing', which does not exist in the parsed MetaEd model/,
});

pushRefusalStep({
	sectionLabel: 'duplicate code value with DIFFERING fields refuses (input contradiction)',
	mutateSnapshot: (snapshotPath) => {
		fs.writeFileSync(
			path.join(snapshotPath, 'tpdmDescriptorCodeValues', 'FixtureLevelDescriptor.xml'),
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<InterchangeDescriptors>',
				'\t<FixtureLevelDescriptor>',
				'\t\t<CodeValue>Alpha</CodeValue>',
				'\t\t<Description>A CONTRADICTING alpha description.</Description>',
				'\t</FixtureLevelDescriptor>',
				'</InterchangeDescriptors>',
			].join('\n'),
		);
		writeScratchSha256Sums(snapshotPath);
	},
	expectedRegex: /duplicate code value 'Alpha' for descriptor 'FixtureLevel' with DIFFERING fields/,
});

pushRefusalStep({
	sectionLabel: 'missing crosswalk folder refuses naming README_PROVENANCE.md',
	mutateSnapshot: (snapshotPath) => {
		fs.rmSync(path.join(snapshotPath, 'cedsAuthoredCrosswalk'), { recursive: true });
	},
	// framework step 2 again (see the descriptorCodeValues folder case above)
	expectedRegex: /listed file 'cedsAuthoredCrosswalk\/[^']+' is missing on disk[\s\S]*README_PROVENANCE\.md/,
});

pushRefusalStep({
	sectionLabel: 'unresolvable model reference refuses by name',
	mutateSnapshot: (snapshotPath) => {
		fs.writeFileSync(
			path.join(snapshotPath, 'metaEdModel', 'DomainEntity', 'FixtureBroken.metaed'),
			[
				'Domain Entity FixtureBrokenReferencer [9900]',
				'    documentation "A fixture entity referencing nowhere."',
				'    domain entity FixtureNowhere [9901]',
				'        documentation "A reference to nothing."',
				'        is required',
				'',
			].join('\n'),
		);
		writeScratchSha256Sums(snapshotPath);
	},
	expectedRegex: /'FixtureNowhere' \(family 'domainEntity'\) resolves to NO construct/,
});

pushRefusalStep({
	sectionLabel: "record element not ending 'Descriptor' refuses",
	mutateSnapshot: (snapshotPath) => {
		fs.writeFileSync(
			path.join(snapshotPath, 'descriptorCodeValues', 'FixtureOddity.xml'),
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<InterchangeDescriptors>',
				'\t<FixtureOddity>',
				'\t\t<CodeValue>Odd</CodeValue>',
				'\t</FixtureOddity>',
				'</InterchangeDescriptors>',
			].join('\n'),
		);
		writeScratchSha256Sums(snapshotPath);
	},
	expectedRegex: /record element <FixtureOddity> does not end in 'Descriptor'/,
});

pushRefusalStep({
	sectionLabel: 'code-value record with no CodeValue refuses',
	mutateSnapshot: (snapshotPath) => {
		fs.writeFileSync(
			path.join(snapshotPath, 'descriptorCodeValues', 'FixtureLevelDescriptor.xml'),
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<InterchangeDescriptors>',
				'\t<FixtureLevelDescriptor>',
				'\t\t<ShortDescription>No identity here</ShortDescription>',
				'\t</FixtureLevelDescriptor>',
				'</InterchangeDescriptors>',
			].join('\n'),
		);
		writeScratchSha256Sums(snapshotPath);
	},
	expectedRegex: /record has no CodeValue; a code value without an identity cannot be carried/,
});

pushRefusalStep({
	sectionLabel: 'duplicate construct name (same type, two inputs) refuses as duplicate stableId',
	mutateSnapshot: (snapshotPath) => {
		fs.writeFileSync(
			path.join(snapshotPath, 'tpdmCommunityModel', 'DomainEntity', 'FixtureDupe.metaed'),
			['Descriptor FixtureLevel [9950]', '    documentation "A duplicate fixture level."', ''].join(
				'\n',
			),
		);
		writeScratchSha256Sums(snapshotPath);
	},
	expectedRegex: /duplicate stableId 'edfi:descriptor\/FixtureLevel'/,
});

// ---------------------------------------------------------------------
pushStep((done) => {
	harness.section('PURE HELPERS — effective property name + CEDS cross-ref normalization');
	harness.equal(
		'role name prefixes the base name',
		forgeEdfiContractGraph.effectivePropertyNameFor({
			propertyName: 'Address',
			roleNameName: 'Mailing',
		}),
		'MailingAddress',
	);
	harness.equal(
		"shared 'named' override wins as the base name",
		forgeEdfiContractGraph.effectivePropertyNameFor({
			sharedTypeName: 'FixtureUniqueId',
			sharedPropertyName: 'FixtureStudentUniqueId',
		}),
		'FixtureStudentUniqueId',
	);
	harness.equal(
		'shared property without a name takes the shared type name',
		forgeEdfiContractGraph.effectivePropertyNameFor({ sharedTypeName: 'FixtureCount' }),
		'FixtureCount',
	);
	harness.equal(
		'identical role name does not double the prefix',
		forgeEdfiContractGraph.effectivePropertyNameFor({
			propertyName: 'Mailing',
			roleNameName: 'Mailing',
		}),
		'Mailing',
	);
	const { kit } = contractGraphKit({ forgeDeclaration: edfiForgeDeclaration, metadata: {} });
	harness.ok(
		"CEDS sentinel '000000' (the declaration's cedsAnchorAbsentSentinelList) is ABSENT, not data",
		kit.cedsAnchorValue({ rawValue: '000000', kind: 'property' }).absent === true,
	);
	harness.equal(
		'CEDS global-id canonicalizes to P-form',
		kit.cedsAnchorValue({ rawValue: '123', kind: 'property' }).cedsAnchorValue,
		'P000123',
	);
	let nonNumericRefusal = '';
	try {
		kit.cedsAnchorValue({ rawValue: 'not-a-number', kind: 'property' });
	} catch (thrownError) {
		nonNumericRefusal = thrownError.message; // the kit THROWS inside the pure layer (SPEC §3.3) — this is the observation, not control flow
	}
	harness.match(
		'non-numeric CEDS global-id is REFUSED by name, never silent (R3)',
		nonNumericRefusal,
		/could not extract a numeric CEDS anchor from 'not-a-number'/,
	);
	done();
});

runNextStep();
