#!/usr/bin/env node
'use strict';

// runMetaEdSnapshotCensus.js — the FULL-SNAPSHOT census proof for the forge-edfi independent
// MetaEd parser (Phase 1 proof obligation: "full-snapshot parse with entity/property/
// descriptor census stated", R-WO-6 condition 3: cross-checked against the scout counts with
// any variance explained, not absorbed).
//
// NOT part of the hermetic suite (test-metaEdParser.js) — this runner reads the REAL pinned
// snapshot 04 and therefore requires the license-gated MetaEd bytes to be present (working
// tree or reacquired per README_PROVENANCE.md; a fresh clone without them sees the RT-3/F3
// refusal, which is correct behavior, not a test failure — that refusal is itself a Phase 1
// proof, exercised hermetically in the suite).
//
// SCOPE STATEMENT (R-WO-7, AMBER_TOWER ruling 2026-08-03): this census covers the two .metaed
// source inputs ONLY (metaEdModel/ + tpdmCommunityModel/). Descriptor definitions ARE counted
// (they are .metaed constructs); descriptor code VALUES live in the descriptorCodeValues XML
// inputs, which are FORGE inputs (Phase 2) and are out of Phase 1 scope by that ruling.
//
// THE CROSS-CHECK REGISTRY below pins the scout-survey counts (SCOUT-edfiCanonicalSource-
// 080326.md + the 2026-08-03 pre-build survey cited in AMBER_TOWER's R-WO-6 ruling: 270
// Descriptor, 162 Shared String, 142 Domain Entity, 99 Common, 51 Association, 32
// Interchange, …). Those numbers are FILES-BY-LEADING-CONSTRUCT across both inputs, counted
// by keyword FAMILY (a 'Domain Entity … additions' extension file counts to the Domain Entity
// family, exactly as the survey's first-line grep counted it). The runner therefore compares
// at family level and separately reports the finer constructType census; files holding more
// than one top-level construct are enumerated so the family-vs-construct variance is
// mechanical, never absorbed.
//
// Run: node forges/edfi/test/runMetaEdSnapshotCensus.js [-verbose]
// Exit: 0 census matches the cross-check registry; 1 any variance or refusal.

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- full-snapshot census proof for the forge-edfi MetaEd parser (Phase 1)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Parses the entire pinned snapshot 04 MetaEd source (653 core + 196 TPDM .metaed files),
     prints the entity/property/descriptor census, and cross-checks the files-by-leading-
     construct counts against the scout survey registry. Requires the license-gated MetaEd
     bytes (README_PROVENANCE.md in the snapshot directory has the acquisition recipe).

EXIT
     0 full parse clean and census matches;  1 refusal or variance.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const metaEdParser = require('../lib/metaEdParser')();

// snapshot 04 is Phase 1's pinned target (the parserDescriptor defaultSnapshot pin still says
// 01 for the INCUMBENT forge and flips only in a later phase per RT-12 — this runner names its
// snapshot explicitly rather than reading the incumbent's pin, because the pin governs the old
// forge's builds, not this campaign's Phase 1 proof)
const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '04');

// files-by-leading-construct, by keyword family, both inputs combined — the scout survey
// numbers pinned as the cross-check registry (R-WO-6 condition 3)
const SCOUT_FAMILY_FILE_COUNT_REGISTRY = {
	'Descriptor': 270,
	'Shared String': 162,
	'Domain Entity': 142,
	'Common': 99,
	'Association': 51,
	'Interchange': 32,
	'Shared Decimal': 25,
	'Shared Integer': 19,
	'Inline Common': 11,
	'Subdomain': 9,
	'Choice': 5,
	'Enumeration': 1,
	'Abstract Entity': 1,
	'Domain': 22,
};

// scout §Candidate 1 also measured: 653 core files, 196 TPDM files
const EXPECTED_FILE_COUNT_BY_INPUT = { metaEdModel: 653, tpdmCommunityModel: 196 };

// constructType -> leading keyword family (extensions and subclasses share their family's
// leading keyword, which is how the survey's first-line grep counted them)
const CONSTRUCT_TYPE_TO_KEYWORD_FAMILY = {
	abstractEntity: 'Abstract Entity',
	association: 'Association',
	associationExtension: 'Association',
	associationSubclass: 'Association',
	choice: 'Choice',
	common: 'Common',
	commonExtension: 'Common',
	commonSubclass: 'Common',
	descriptor: 'Descriptor',
	domain: 'Domain',
	domainEntity: 'Domain Entity',
	domainEntityExtension: 'Domain Entity',
	domainEntitySubclass: 'Domain Entity',
	enumeration: 'Enumeration',
	inlineCommon: 'Inline Common',
	interchange: 'Interchange',
	interchangeExtension: 'Interchange',
	sharedDecimal: 'Shared Decimal',
	sharedInteger: 'Shared Integer',
	sharedShort: 'Shared Short',
	sharedString: 'Shared String',
	subdomain: 'Subdomain',
};

const xLog = process.global.xLog;

metaEdParser.parseMetaEdSnapshot({ snapshotPath: SNAPSHOT_PATH, xLog }, (parseError, metaEdInMemoryModel) => {
	harness.section('FULL-SNAPSHOT PARSE');
	harness.accepts('snapshot 04 parses with ZERO refusals', parseError ? [parseError] : []);
	if (parseError) {
		harness.report();
		return;
	}

	const { metadata, census, constructsByInput } = metaEdInMemoryModel;

	harness.section('FILE COUNTS vs SCOUT');
	metadata.sourceInputs.forEach((sourceInput) => {
		harness.equal(
			`${sourceInput.inputName} file count (${sourceInput.projectName} ${sourceInput.projectVersion})`,
			sourceInput.fileCount,
			EXPECTED_FILE_COUNT_BY_INPUT[sourceInput.inputName],
		);
	});

	harness.section('FILES-BY-LEADING-CONSTRUCT vs SCOUT REGISTRY (family level)');
	const familyFileCounts = {};
	const multiConstructFileList = [];
	Object.values(constructsByInput).forEach((constructList) => {
		const constructsByFile = {};
		constructList.forEach((parsedConstruct) => {
			(constructsByFile[parsedConstruct.sourceFileRelativePath] =
				constructsByFile[parsedConstruct.sourceFileRelativePath] || []).push(parsedConstruct);
		});
		Object.entries(constructsByFile).forEach(([sourceFileRelativePath, fileConstructList]) => {
			const leadingFamily =
				CONSTRUCT_TYPE_TO_KEYWORD_FAMILY[fileConstructList[0].constructType];
			familyFileCounts[leadingFamily] = (familyFileCounts[leadingFamily] || 0) + 1;
			if (fileConstructList.length > 1) {
				multiConstructFileList.push(
					`${sourceFileRelativePath}: ${fileConstructList.map((c) => c.constructType).join(', ')}`,
				);
			}
		});
	});
	Object.entries(SCOUT_FAMILY_FILE_COUNT_REGISTRY).forEach(([familyName, expectedFileCount]) => {
		harness.equal(
			`${familyName} files (scout registry: ${expectedFileCount})`,
			familyFileCounts[familyName] || 0,
			expectedFileCount,
		);
	});
	const unexpectedFamilyList = Object.keys(familyFileCounts).filter(
		(familyName) => !(familyName in SCOUT_FAMILY_FILE_COUNT_REGISTRY),
	);
	harness.accepts(
		'no keyword family outside the scout registry',
		unexpectedFamilyList.map((familyName) => `unexpected family: ${familyName} (${familyFileCounts[familyName]} files)`),
	);

	harness.section('CENSUS (the Phase 1 statement of record)');
	xLog.status(`  snapshot: ${metadata.snapshotPath}`);
	metadata.sourceInputs.forEach((sourceInput) => {
		xLog.status(
			`  input ${sourceInput.inputName}: ${sourceInput.projectName} ${sourceInput.projectVersion}, ${sourceInput.fileCount} files`,
		);
	});
	xLog.status('  construct census (constructType: combined / core / tpdm):');
	Object.keys(census.constructCounts)
		.sort()
		.forEach((constructType) => {
			const coreCount = (census.constructCountsByInput.metaEdModel || {})[constructType] || 0;
			const tpdmCount = (census.constructCountsByInput.tpdmCommunityModel || {})[constructType] || 0;
			xLog.status(
				`    ${constructType}: ${census.constructCounts[constructType]} / ${coreCount} / ${tpdmCount}`,
			);
		});
	xLog.status('  property census (propertyType: count):');
	Object.keys(census.propertyCounts)
		.sort()
		.forEach((propertyType) => {
			xLog.status(`    ${propertyType}: ${census.propertyCounts[propertyType]}`);
		});
	xLog.status(`  totals: ${census.totalConstructCount} constructs, ${census.totalPropertyCount} properties, ` +
		`${census.enumerationItemCount} enumeration/map-type items, ${census.domainItemCount} domain items, ` +
		`${census.interchangeComponentCount} interchange components`);
	xLog.status(
		`  descriptor DEFINITIONS: ${census.constructCounts.descriptor || 0} (.metaed constructs). ` +
			`Descriptor code VALUES are out of Phase 1 scope by ruling R-WO-7 (they are Phase 2 forge inputs).`,
	);
	if (multiConstructFileList.length) {
		xLog.status(
			`  files holding more than one top-level construct (${multiConstructFileList.length}) — this is the ` +
				`mechanical explanation of any family-vs-construct count variance:`,
		);
		multiConstructFileList.forEach((fileDescription) => xLog.status(`    ${fileDescription}`));
	} else {
		xLog.status('  every file holds exactly one top-level construct.');
	}

	harness.section('INTERNAL CONSISTENCY');
	const totalFileCount = Object.values(constructsByInput).reduce((runningTotal, constructList) => {
		return runningTotal + new Set(constructList.map((c) => c.sourceFileRelativePath)).size;
	}, 0);
	harness.equal('every loaded file produced at least one construct', totalFileCount, 653 + 196);
	harness.ok(
		'construct total >= file total (multi-construct files only add)',
		census.totalConstructCount >= totalFileCount,
		`constructs ${census.totalConstructCount} < files ${totalFileCount}`,
	);

	harness.report();
});
