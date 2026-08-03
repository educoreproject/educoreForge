#!/usr/bin/env node
'use strict';

// test-metaEdParser.js — the HERMETIC suite for the forge-edfi independent MetaEd parser
// (Phase 1, R-WO-3/R-WO-6/R-WO-7).
//
// NOTHING HERE TOUCHES THE REAL SNAPSHOT, DOCKER, THE NETWORK, OR ANY Ed-Fi TOOLCHAIN. Every
// source parsed is synthetic fixture content (inline or under fixtures/metaEdSynthetic/), and
// the loader tests build throwaway snapshot directories under os.tmpdir(). The real-snapshot
// census lives in runMetaEdSnapshotCensus.js, deliberately outside this suite.
//
// CONSTRUCT INVENTORY (R-WO-6 condition 1): the coverage list below is derived EXHAUSTIVELY
// from the reference grammar MetaEdGrammar.g4 (Apache-2.0, read-only reference). Every
// topLevelEntity alternative and every property rule has an assertion here:
//   topLevelEntity: abstractEntity, association, associationExtension, associationSubclass,
//     choice, sharedDecimal, sharedInteger, sharedShort, sharedString, common, commonExtension,
//     commonSubclass, descriptor, domainEntity, domainEntityExtension, domainEntitySubclass,
//     enumeration, inlineCommon, interchange, interchangeExtension, domain, subdomain
//   plus the namespace wrapper (Begin Namespace … End Namespace)
//   property: association, boolean, choice, common (incl. common extension override),
//     currency, date, datetime, decimal, descriptor, domainEntity, duration, enumeration,
//     inlineCommon, integer, percent, sharedDecimal, sharedInteger, sharedShort, sharedString,
//     short, string, time, year
//   clauses: metaEdId (both forms), deprecated, documentation (inline / next-line / inherited),
//     all six annotations + identityRename, role name (+ shorten to), is queryable field/only,
//     min/max value (incl. 'big'), decimal bounds, min/max length, total digits/decimal places,
//     allow primary key updates, merge directives, potentially logical, is weak,
//     with [optional] map type, enumeration items (+ ids + docs), domain items (5 kinds),
//     footer documentation, subdomain position, interchange element/identity (+ namespaced),
//     extended/use case documentation, TEXT "" escaping and multi-line strings
//
// REFUSAL DOCTRINE: every negative test uses harness.rejects with a SPECIFIC regex — a
// rejection for the wrong reason fails the suite (observed-red discipline built into the
// harness). The malformed FIXTURE FILE refusal is a Phase 1 proof obligation: refusing, not
// skipping, with file:line named.
//
// Run: node forges/edfi/test/test-metaEdParser.js [-verbose]

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic suite for the forge-edfi independent MetaEd parser (Phase 1)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Exercises the full MetaEdGrammar.g4 construct inventory against synthetic fixtures, the
     refusal-by-name doctrine (unclassifiable text, grammar violations, malformed fixture), and
     the snapshot loader's RT-3/F3 refusals (missing source naming README_PROVENANCE.md,
     checksum mismatch, manifest drift) against throwaway tmp snapshots. Touches no real
     snapshot bytes and no Ed-Fi toolchain.

EXIT
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const metaEdLexer = require('../lib/metaEdLexer')();
const metaEdParser = require('../lib/metaEdParser')();
const metaEdSourceLoader = require('../lib/metaEdSourceLoader')();

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'metaEdSynthetic');

// all lexer/parser callbacks in these modules resolve synchronously (code fact — the async
// shape is the R7 interface contract, not a scheduling reality), so the suite captures results
// through closure variables and asserts immediately after each call. The one exception is
// parseMetaEdSnapshot, whose file loop yields through setImmediate — those tests assert inside
// the callback and the suite chains them before report().

// tiny helpers -------------------------------------------------------------

const lexText = (sourceText) => {
	let capturedError = '';
	let capturedTokenList = null;
	metaEdLexer.tokenizeMetaEdSource(
		{ sourceText, sourceFileRelativePath: 'inline.metaed' },
		(lexerError, lexerResult) => {
			capturedError = lexerError || '';
			capturedTokenList = lexerResult ? lexerResult.tokenList : null;
		},
	);
	return { capturedError, capturedTokenList };
};

const parseText = (sourceText, sourceFileRelativePath = 'inline.metaed') => {
	let capturedError = '';
	let capturedConstructList = null;
	metaEdParser.parseMetaEdSourceText(
		{ sourceText, sourceFileRelativePath },
		(parseError, parseResult) => {
			capturedError = parseError || '';
			capturedConstructList = parseResult ? parseResult.constructList : null;
		},
	);
	return { capturedError, capturedConstructList };
};

const constructOfType = (constructList, constructType) =>
	(constructList || []).filter((c) => c.constructType === constructType);

// =====================================================================
harness.section('LEXER — token classification');
// =====================================================================

{
	const { capturedError, capturedTokenList } = lexText(
		'domain entity identity FixtureThing [12] // trailing comment\nDomain Entity',
	);
	harness.accepts('maximal-munch source lexes clean', capturedError ? [capturedError] : []);
	harness.equal(
		'maximal munch: "domain entity identity" is ONE token',
		capturedTokenList[0].tokenType,
		'DOMAIN_ENTITY_IDENTITY',
	);
	harness.equal('ID follows', capturedTokenList[1].tokenType, 'ID');
	harness.equal('METAED_ID [12]', capturedTokenList[2].metaEdIdValue, '12');
	harness.equal(
		'comment is skipped; next token is the uppercase keyword',
		capturedTokenList[3].tokenType,
		'DOMAIN_ENTITY',
	);
	harness.equal('comment skipping leaves exactly 4 tokens', capturedTokenList.length, 4);
}

{
	const { capturedTokenList } = lexText('DomainX Domain');
	harness.equal(
		'word boundary: "DomainX" lexes as an ID, not keyword-plus-junk',
		capturedTokenList[0].tokenType,
		'ID',
	);
	harness.equal('bare "Domain" still lexes as the keyword', capturedTokenList[1].tokenType, 'DOMAIN');
}

{
	const { capturedTokenList } = lexText('"a ""quoted"" word\nacross lines" [231-001]');
	harness.equal(
		'TEXT: "" unescapes and newline survives',
		capturedTokenList[0].textValue,
		'a "quoted" word\nacross lines',
	);
	harness.equal('dashed METAED_ID form', capturedTokenList[1].metaEdIdValue, '231-001');
}

{
	const { capturedTokenList } = lexText('min value -1.5 max value 99 min value big');
	harness.equal("'min value' is ONE keyword token", capturedTokenList[0].tokenType, 'MIN_VALUE');
	harness.equal('negative decimal is one DECIMAL_VALUE token', capturedTokenList[1].tokenType, 'DECIMAL_VALUE');
	harness.equal('negative decimal text', capturedTokenList[1].tokenText, '-1.5');
	harness.equal('unsigned int token', capturedTokenList[3].tokenType, 'UNSIGNED_INT');
	harness.equal("literal 'big' token", capturedTokenList[5].tokenType, 'BIG');
}

{
	const { capturedError } = lexText('documentation "never closed');
	harness.rejects('unterminated string REFUSES by name', [capturedError].filter(Boolean), /unterminated string literal/);
}

{
	const { capturedError } = lexText('Domain Entity Fixture\n    @rogue');
	harness.rejects(
		'unclassifiable character REFUSES naming file:line:column',
		[capturedError].filter(Boolean),
		/inline\.metaed:2:5 — unclassifiable text: '@rogue'/,
	);
}

{
	const { capturedError } = lexText('[notdigits]');
	harness.rejects('malformed bracket id REFUSES', [capturedError].filter(Boolean), /does not open a well-formed MetaEd id/);
}

// =====================================================================
harness.section('CONSTRUCTS — the comprehensive synthetic fixture (18 g4 alternatives)');
// =====================================================================

const comprehensiveFixtureText = fs.readFileSync(
	path.join(FIXTURE_DIR, 'comprehensiveCoreConstructs.metaed'),
	'utf-8',
);
const comprehensiveParse = parseText(comprehensiveFixtureText, 'comprehensiveCoreConstructs.metaed');
harness.accepts(
	'comprehensive fixture parses clean',
	comprehensiveParse.capturedError ? [comprehensiveParse.capturedError] : [],
);

const comprehensiveConstructList = comprehensiveParse.capturedConstructList || [];

{
	const expectedConstructCounts = {
		abstractEntity: 1,
		domainEntity: 2,
		domainEntitySubclass: 1,
		association: 1,
		associationSubclass: 1,
		common: 1,
		commonSubclass: 1,
		inlineCommon: 1,
		choice: 1,
		descriptor: 3,
		enumeration: 1,
		sharedString: 1,
		sharedDecimal: 1,
		sharedInteger: 1,
		sharedShort: 1,
		domain: 1,
		subdomain: 1,
		interchange: 1,
	};
	Object.entries(expectedConstructCounts).forEach(([constructType, expectedCount]) => {
		harness.equal(
			`fixture carries ${expectedCount} × ${constructType}`,
			constructOfType(comprehensiveConstructList, constructType).length,
			expectedCount,
		);
	});
}

{
	const [abstractEntity] = constructOfType(comprehensiveConstructList, 'abstractEntity');
	harness.equal('abstract entity name', abstractEntity.entityName, 'FixtureOrganization');
	harness.equal('abstract entity metaEdId', abstractEntity.metaEdId, '9001');
	harness.equal("integer property min value 'big'", abstractEntity.propertyList[0].minValue, 'big');
	harness.equal('identity annotation', abstractEntity.propertyList[0].annotationKind, 'identity');
	harness.equal('queryable field flag', abstractEntity.propertyList[0].isQueryableField, true);
}

{
	const fixtureStudent = constructOfType(comprehensiveConstructList, 'domainEntity').find(
		(c) => c.entityName === 'FixtureStudent',
	);
	harness.ok('FixtureStudent found', Boolean(fixtureStudent));
	harness.match(
		'multi-line documentation with "" escape survives',
		fixtureStudent.documentationText,
		/embedded "quoted" word and a\nmulti-line/,
	);
	harness.equal('allow primary key updates captured', fixtureStudent.allowPrimaryKeyUpdates, true);

	const sharedStringProperty = fixtureStudent.propertyList[0];
	harness.equal('shared string property type', sharedStringProperty.propertyType, 'sharedString');
	harness.equal('shared type name', sharedStringProperty.sharedTypeName, 'FixtureUniqueId');
	harness.equal("'named' rename", sharedStringProperty.sharedPropertyName, 'FixtureStudentUniqueId');
	harness.equal('role name', sharedStringProperty.roleNameName, 'Fixture');
	harness.equal('shorten to', sharedStringProperty.shortenToName, 'Fix');

	const boolProperty = fixtureStudent.propertyList[1];
	harness.equal('boolean property type', boolProperty.propertyType, 'boolean');
	harness.equal('documentation inherited flag', boolProperty.documentationInherited, true);

	const dateProperty = fixtureStudent.propertyList[2];
	harness.match('property deprecated text', dateProperty.deprecatedText, /fixture birth calendar/);

	const referenceProperty = fixtureStudent.propertyList[4];
	harness.equal('domain entity reference property', referenceProperty.propertyType, 'domainEntity');
	harness.equal('potentially logical', referenceProperty.potentiallyLogical, true);
	harness.equal('is weak', referenceProperty.isWeakReference, true);
	harness.equal(
		'merge directive source path',
		referenceProperty.mergeDirectiveList[0].sourcePropertyPath,
		'FixtureSchool.FixtureSessionName',
	);
	harness.equal(
		'merge directive target path',
		referenceProperty.mergeDirectiveList[0].targetPropertyPath,
		'FixtureSession.FixtureSessionName',
	);
}

{
	const fixtureSchool = constructOfType(comprehensiveConstructList, 'domainEntity').find(
		(c) => c.entityName === 'FixtureSchool',
	);
	const propertyTypeList = fixtureSchool.propertyList.map((p) => p.propertyType);
	// every g4 property rule the FixtureSchool block declares, in order
	const expectedPropertyTypeList = [
		'integer', 'string', 'decimal', 'short', 'year', 'time', 'datetime', 'duration',
		'currency', 'percent', 'enumeration', 'common', 'inlineCommon', 'choice',
		'sharedDecimal', 'sharedInteger', 'sharedShort',
	];
	harness.equal(
		'FixtureSchool exercises the full simple/reference/shared property inventory',
		JSON.stringify(propertyTypeList),
		JSON.stringify(expectedPropertyTypeList),
	);
	const decimalProperty = fixtureSchool.propertyList[2];
	harness.equal('decimal total digits', decimalProperty.totalDigits, 5);
	harness.equal('decimal places', decimalProperty.decimalPlaces, 2);
	harness.equal('decimal min bound', decimalProperty.minValueDecimal, '-1.5');
	harness.equal('decimal max bound', decimalProperty.maxValueDecimal, '99.9');
	const stringProperty = fixtureSchool.propertyList[1];
	harness.equal('string min length', stringProperty.minLength, 1);
	harness.equal('string max length', stringProperty.maxLength, 75);
	const shortProperty = fixtureSchool.propertyList[3];
	harness.equal('short min value', shortProperty.minValue, '1');
	harness.equal('short max value', shortProperty.maxValue, '12');
}

{
	const [charterSubclass] = constructOfType(comprehensiveConstructList, 'domainEntitySubclass');
	harness.equal('subclass base name', charterSubclass.baseName, 'FixtureSchool');
	harness.equal(
		'identity rename annotation',
		charterSubclass.propertyList[0].annotationKind,
		'identityRename',
	);
	harness.equal(
		'renamed identity property name',
		charterSubclass.propertyList[0].renamesIdentityPropertyName,
		'FixtureSchoolId',
	);
	harness.equal(
		'is queryable only annotation',
		charterSubclass.propertyList[1].annotationKind,
		'queryableOnly',
	);
}

{
	const [fixtureAssociation] = constructOfType(comprehensiveConstructList, 'association');
	harness.equal('association cascade update', fixtureAssociation.allowPrimaryKeyUpdates, true);
	harness.equal(
		'two defining domain entities',
		fixtureAssociation.definingDomainEntityList.length,
		2,
	);
	harness.equal(
		'defining entity role name',
		fixtureAssociation.definingDomainEntityList[0].roleNameName,
		'Enrolled',
	);
	harness.equal(
		'defining entity merge directive',
		fixtureAssociation.definingDomainEntityList[1].mergeDirectiveList[0].targetPropertyPath,
		'FixtureStudent.FixtureOrganizationId',
	);
	harness.equal('association own property', fixtureAssociation.propertyList[0].propertyType, 'date');
}

{
	const [associationSubclass] = constructOfType(comprehensiveConstructList, 'associationSubclass');
	harness.equal(
		'association subclass base',
		associationSubclass.baseName,
		'FixtureStudentSchoolAssociation',
	);
	const [commonSubclass] = constructOfType(comprehensiveConstructList, 'commonSubclass');
	harness.equal('common subclass base', commonSubclass.baseName, 'FixtureAddress');
}

{
	const descriptorList = constructOfType(comprehensiveConstructList, 'descriptor');
	const plainDescriptor = descriptorList.find((d) => d.descriptorName === 'FixtureLevel');
	harness.equal('two-line descriptor has no properties', plainDescriptor.propertyList.length, 0);
	const mappedDescriptor = descriptorList.find((d) => d.descriptorName === 'FixtureCategory');
	harness.equal('descriptor with property', mappedDescriptor.propertyList[0].propertyName, 'FixtureCategoryNote');
	harness.equal('required map type flag', mappedDescriptor.mapTypeRequired, true);
	harness.equal('map type items', mappedDescriptor.mapTypeItemList.length, 2);
	harness.equal('map item metaEdId', mappedDescriptor.mapTypeItemList[0].metaEdId, '9093');
	const shadeDescriptor = descriptorList.find((d) => d.descriptorName === 'FixtureShade');
	harness.equal('optional map type flag', shadeDescriptor.mapTypeRequired, false);
}

{
	const [fixtureEnumeration] = constructOfType(comprehensiveConstructList, 'enumeration');
	harness.equal('enumeration items', fixtureEnumeration.enumerationItemList.length, 2);
	harness.equal(
		'enumeration item dashed id',
		fixtureEnumeration.enumerationItemList[0].metaEdId,
		'9100-001',
	);
	harness.match(
		'enumeration item documentation',
		fixtureEnumeration.enumerationItemList[0].documentationText,
		/2025-2026 fixture year/,
	);
}

{
	const [sharedString] = constructOfType(comprehensiveConstructList, 'sharedString');
	harness.equal('shared string bounds', `${sharedString.minLength}-${sharedString.maxLength}`, '1-32');
	const [sharedDecimal] = constructOfType(comprehensiveConstructList, 'sharedDecimal');
	harness.equal('shared decimal digits', `${sharedDecimal.totalDigits}.${sharedDecimal.decimalPlaces}`, '6.3');
	harness.equal('shared decimal min', sharedDecimal.minValueDecimal, '0.0');
	const [sharedInteger] = constructOfType(comprehensiveConstructList, 'sharedInteger');
	harness.equal("shared integer 'big' max", sharedInteger.maxValue, 'big');
	const [sharedShort] = constructOfType(comprehensiveConstructList, 'sharedShort');
	harness.equal('shared short max', sharedShort.maxValue, '100');
}

{
	const [fixtureDomain] = constructOfType(comprehensiveConstructList, 'domain');
	harness.match(
		'next-line documentation string parsed',
		fixtureDomain.documentationText,
		/opens on the following line/,
	);
	harness.equal('domain items', fixtureDomain.domainItemList.length, 6);
	harness.equal(
		'domain item reference kinds',
		JSON.stringify(fixtureDomain.domainItemList.map((i) => i.referenceType)),
		JSON.stringify(['domainEntity', 'domainEntity', 'association', 'common', 'inlineCommon', 'descriptor']),
	);
	harness.match('footer documentation', fixtureDomain.footerDocumentationText, /fixture domain footer/);

	const [fixtureSubdomain] = constructOfType(comprehensiveConstructList, 'subdomain');
	harness.equal('subdomain parent', fixtureSubdomain.parentDomainName, 'FixtureLearning');
	harness.equal('subdomain position', fixtureSubdomain.subdomainPosition, 2);
}

{
	const [fixtureInterchange] = constructOfType(comprehensiveConstructList, 'interchange');
	harness.match('extended documentation', fixtureInterchange.extendedDocumentationText, /Extended fixture/);
	harness.match('use case documentation', fixtureInterchange.useCaseDocumentationText, /Exchange fixture rosters/);
	harness.equal('interchange component count', fixtureInterchange.interchangeComponentList.length, 5);
	harness.equal(
		'identity template kinds',
		JSON.stringify(fixtureInterchange.interchangeComponentList.map((c) => c.componentKind)),
		JSON.stringify(['identityTemplate', 'element', 'element', 'element', 'identityTemplate']),
	);
}

// =====================================================================
harness.section('CONSTRUCTS — extension (additions) forms and the namespace wrapper');
// =====================================================================

{
	const extensionFixtureText = `
Domain Entity EdFi.FixtureStudent additions [9500]
    date FixtureExtensionDate [9501]
        documentation "A fixture extension date."
        is optional
    common extension FixtureAddress [9502]
        documentation "A fixture common-extension override property."
        is optional

Association EdFi.FixtureStudentSchoolAssociation additions
    descriptor FixtureLevel [9503]
        documentation "A fixture extension descriptor reference."
        is optional

Common EdFi.FixtureAddress additions
    string FixtureExtensionNote [9504]
        documentation "A fixture extension note."
        is optional
        max length 20

Interchange EdFi.FixtureStudentRoster additions
    domain entity EdFi.FixtureNewEntity [9505]
    domain entity identity TPDM.FixtureCandidate
`;
	const { capturedError, capturedConstructList } = parseText(extensionFixtureText, 'extensions.metaed');
	harness.accepts('extension fixture parses clean', capturedError ? [capturedError] : []);

	const [domainEntityExtension] = constructOfType(capturedConstructList, 'domainEntityExtension');
	harness.equal('domain entity extension extendee namespace', domainEntityExtension.extendeeNamespace, 'EdFi');
	harness.equal('domain entity extension extendee name', domainEntityExtension.extendeeName, 'FixtureStudent');
	harness.equal(
		'common-extension override property flag',
		domainEntityExtension.propertyList[1].commonExtensionOverride,
		true,
	);

	const [associationExtension] = constructOfType(capturedConstructList, 'associationExtension');
	harness.equal('association extension extendee', associationExtension.extendeeName, 'FixtureStudentSchoolAssociation');

	const [commonExtension] = constructOfType(capturedConstructList, 'commonExtension');
	harness.equal('common extension extendee', commonExtension.extendeeName, 'FixtureAddress');

	const [interchangeExtension] = constructOfType(capturedConstructList, 'interchangeExtension');
	harness.equal(
		'interchange extension namespaced component',
		interchangeExtension.interchangeComponentList[0].baseNamespace,
		'EdFi',
	);
	harness.equal(
		'interchange extension cross-namespace identity',
		interchangeExtension.interchangeComponentList[1].baseNamespace,
		'TPDM',
	);
}

{
	const namespaceFixtureText = `
Begin Namespace EdFi core
Domain Entity FixtureThing [9600]
    documentation "A fixture thing inside an explicit namespace block."
    bool FixtureFlag [9601]
        documentation "A fixture flag."
        is required
End Namespace
`;
	const { capturedError, capturedConstructList } = parseText(namespaceFixtureText, 'namespaced.metaed');
	harness.accepts('namespace wrapper parses clean', capturedError ? [capturedError] : []);
	harness.equal('construct carries namespaceName', capturedConstructList[0].namespaceName, 'EdFi');
	harness.equal("construct carries namespaceType 'core'", capturedConstructList[0].namespaceType, 'core');
}

// =====================================================================
harness.section('REFUSALS — grammar violations refuse by name, never skip');
// =====================================================================

{
	const { capturedError } = parseText('Domain Entity FixtureNoDoc [1]\n    bool FixtureFlag [2]\n        documentation "x"\n        is required');
	harness.rejects(
		'missing construct documentation REFUSES',
		[capturedError].filter(Boolean),
		/expected DOCUMENTATION .*Domain Entity FixtureNoDoc/,
	);
}

{
	const { capturedError } = parseText(
		'Domain Entity FixtureThing [1]\n    documentation "d"\n    string FixtureName [2]\n        documentation "n"\n        is required\n',
	);
	harness.rejects(
		'string property without max length REFUSES',
		[capturedError].filter(Boolean),
		/'MAX_LENGTH' clause required for string property/,
	);
}

{
	const { capturedError } = parseText(
		'Association FixtureLonely [1]\n    documentation "d"\n    domain entity FixtureOne [2]\n        documentation "one"\n    date FixtureWhen [3]\n        documentation "w"\n        is required\n',
	);
	harness.rejects(
		'association with one defining domain entity REFUSES',
		[capturedError].filter(Boolean),
		/expected DOMAIN_ENTITY_KEYWORD \(defining 'domain entity' for Association FixtureLonely\)/,
	);
}

{
	const { capturedError } = parseText('Enumeration FixtureEmpty [1]\n    documentation "d"\n');
	harness.rejects(
		'enumeration with no items REFUSES',
		[capturedError].filter(Boolean),
		/requires at least 1 'item' entry/,
	);
}

{
	const { capturedError } = parseText('// only a comment\n');
	harness.rejects('comment-only file REFUSES', [capturedError].filter(Boolean), /no MetaEd tokens/);
}

{
	const { capturedError } = parseText('Widget FixtureThing [1]\n');
	harness.rejects(
		'unknown top-level word REFUSES naming the expectation',
		[capturedError].filter(Boolean),
		/expected a top-level MetaEd construct keyword/,
	);
}

{
	// THE MALFORMED FIXTURE FILE — Phase 1 proof obligation: observed REFUSING, not skipping
	const malformedFixtureText = fs.readFileSync(
		path.join(FIXTURE_DIR, 'malformedUnclassifiableLine.metaed'),
		'utf-8',
	);
	const { capturedError, capturedConstructList } = parseText(
		malformedFixtureText,
		'malformedUnclassifiableLine.metaed',
	);
	harness.rejects(
		'malformed fixture REFUSES naming file, line, and offending text',
		[capturedError].filter(Boolean),
		/malformedUnclassifiableLine\.metaed:7:5 — unclassifiable text: 'thisisnotmetaed at all'/,
	);
	harness.equal('malformed fixture yields NO constructs (refusal, not partial parse)', capturedConstructList, null);
}

// =====================================================================
harness.section('LOADER — RT-3/F3 refusals and the hermetic snapshot round trip');
// =====================================================================

// build a throwaway snapshot directory: peers + two .metaed inputs with correct checksums
const buildScratchSnapshot = () => {
	const scratchSnapshotPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edfiPhase1Snapshot-'));
	const coreModelText = [
		'Domain Entity ScratchThing [7000]',
		'    documentation "A scratch thing."',
		'    integer ScratchThingId [7001]',
		'        documentation "The scratch thing identifier."',
		'        is part of identity',
		'',
	].join('\n');
	const tpdmModelText = [
		'Domain Entity EdFi.ScratchThing additions [7100]',
		'    date ScratchExtensionDate [7101]',
		'        documentation "A scratch extension date."',
		'        is optional',
		'',
	].join('\n');

	const fileMap = {
		'README_PROVENANCE.md': '# scratch provenance (hermetic test fixture)\n',
		'standardSourceLocation': 'scratch\n',
		'metaEdModel/package.json': JSON.stringify({
			name: '@edfi/scratch-model',
			metaEdProject: { projectName: 'Ed-Fi', projectVersion: '5.2.0' },
		}),
		'metaEdModel/DomainEntity/ScratchThing.metaed': coreModelText,
		'tpdmCommunityModel/package.json': JSON.stringify({
			description: 'scratch tpdm',
			metaEdProject: { projectName: 'TPDM', projectVersion: '1.2.0' },
		}),
		'tpdmCommunityModel/DomainEntity/ScratchThingExtension.metaed': tpdmModelText,
	};
	Object.entries(fileMap).forEach(([relativePath, fileText]) => {
		const absolutePath = path.join(scratchSnapshotPath, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, fileText);
	});
	const sha256SumsText = Object.entries(fileMap)
		.filter(([relativePath]) => relativePath.endsWith('.metaed'))
		.map(
			([relativePath, fileText]) =>
				`${crypto.createHash('sha256').update(Buffer.from(fileText)).digest('hex')}  ${relativePath}`,
		)
		.join('\n');
	fs.writeFileSync(path.join(scratchSnapshotPath, 'SHA256SUMS'), `${sha256SumsText}\n`);
	return scratchSnapshotPath;
};

const loadScratch = (snapshotPath) => {
	let capturedError = '';
	let capturedResult = null;
	metaEdSourceLoader.loadMetaEdSourceFiles({ snapshotPath }, (loaderError, loaderResult) => {
		capturedError = loaderError || '';
		capturedResult = loaderResult || null;
	});
	return { capturedError, capturedResult };
};

{
	const { capturedError } = loadScratch(path.join(os.tmpdir(), 'edfiPhase1DoesNotExist'));
	harness.rejects('nonexistent snapshot REFUSES', [capturedError].filter(Boolean), /snapshot directory not found/);
}

{
	// F3 — THE BINDING REFUSAL: fresh-clone shape (peers present, metaEdModel absent) must
	// refuse TEXTUALLY naming README_PROVENANCE.md and its path
	const cloneShapedSnapshotPath = buildScratchSnapshot();
	fs.rmSync(path.join(cloneShapedSnapshotPath, 'metaEdModel'), { recursive: true });
	const { capturedError } = loadScratch(cloneShapedSnapshotPath);
	harness.rejects(
		'F3: missing metaEdModel REFUSES naming README_PROVENANCE.md',
		[capturedError].filter(Boolean),
		/README_PROVENANCE\.md/,
	);
	harness.match(
		'F3: the refusal carries the full README path',
		capturedError,
		new RegExp(
			`${cloneShapedSnapshotPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/README_PROVENANCE\\.md`,
		),
	);
	harness.match('F3: the refusal names the missing input', capturedError, /metaEdModel/);
	harness.match('F3: the refusal cites RT-3', capturedError, /RT-3/);
}

{
	const corruptSnapshotPath = buildScratchSnapshot();
	const corruptTargetPath = path.join(
		corruptSnapshotPath,
		'metaEdModel/DomainEntity/ScratchThing.metaed',
	);
	fs.appendFileSync(corruptTargetPath, '\n// silently appended line\n');
	const { capturedError } = loadScratch(corruptSnapshotPath);
	harness.rejects(
		'corrupt source REFUSES with checksum mismatch naming the file',
		[capturedError].filter(Boolean),
		/checksum MISMATCH for metaEdModel\/DomainEntity\/ScratchThing\.metaed/,
	);
	harness.match('corruption refusal points at README_PROVENANCE.md', capturedError, /README_PROVENANCE\.md/);
}

{
	const driftedSnapshotPath = buildScratchSnapshot();
	fs.writeFileSync(
		path.join(driftedSnapshotPath, 'metaEdModel/DomainEntity/RogueThing.metaed'),
		'Domain Entity RogueThing [1]\n    documentation "rogue"\n    bool RogueFlag [2]\n        documentation "r"\n        is required\n',
	);
	const { capturedError } = loadScratch(driftedSnapshotPath);
	harness.rejects(
		'on-disk file absent from SHA256SUMS REFUSES (manifest drift)',
		[capturedError].filter(Boolean),
		/RogueThing\.metaed is present on disk but has NO entry in SHA256SUMS/,
	);
}

{
	const missingSumsSnapshotPath = buildScratchSnapshot();
	fs.rmSync(path.join(missingSumsSnapshotPath, 'SHA256SUMS'));
	const { capturedError } = loadScratch(missingSumsSnapshotPath);
	harness.rejects('missing SHA256SUMS REFUSES', [capturedError].filter(Boolean), /SHA256SUMS peer file is missing/);
}

{
	const unversionedSnapshotPath = buildScratchSnapshot();
	fs.writeFileSync(
		path.join(unversionedSnapshotPath, 'metaEdModel/package.json'),
		JSON.stringify({ name: 'no-binding-here' }),
	);
	const { capturedError } = loadScratch(unversionedSnapshotPath);
	harness.rejects(
		'package.json without metaEdProject binding REFUSES (no invented version)',
		[capturedError].filter(Boolean),
		/no metaEdProject \{ projectName, projectVersion \} binding/,
	);
}

// =====================================================================
harness.section('FULL PIPELINE — scratch snapshot through parseMetaEdSnapshot, then report');
// =====================================================================

{
	const pipelineSnapshotPath = buildScratchSnapshot();
	metaEdParser.parseMetaEdSnapshot({ snapshotPath: pipelineSnapshotPath }, (pipelineError, metaEdInMemoryModel) => {
		harness.accepts('pipeline parses the scratch snapshot clean', pipelineError ? [pipelineError] : []);
		if (!pipelineError) {
			harness.equal(
				'metadata carries both source inputs with versions',
				JSON.stringify(metaEdInMemoryModel.metadata.sourceInputs.map((i) => `${i.inputName}@${i.projectVersion}`)),
				JSON.stringify(['metaEdModel@5.2.0', 'tpdmCommunityModel@1.2.0']),
			);
			harness.equal(
				'census: one domainEntity in the core input',
				metaEdInMemoryModel.census.constructCountsByInput.metaEdModel.domainEntity,
				1,
			);
			harness.equal(
				'census: one domainEntityExtension in the TPDM input',
				metaEdInMemoryModel.census.constructCountsByInput.tpdmCommunityModel.domainEntityExtension,
				1,
			);
			harness.equal('census: total constructs', metaEdInMemoryModel.census.totalConstructCount, 2);
			harness.equal('census: total properties', metaEdInMemoryModel.census.totalPropertyCount, 2);
			harness.equal(
				'name index carries the extension extendee',
				JSON.stringify(metaEdInMemoryModel.constructNamesByType.domainEntityExtension),
				JSON.stringify(['ScratchThing']),
			);
			harness.ok(
				'constructs carry sourceFileRelativePath',
				metaEdInMemoryModel.constructsByInput.metaEdModel[0].sourceFileRelativePath ===
					'metaEdModel/DomainEntity/ScratchThing.metaed',
			);
		}
		harness.report();
	});
}
