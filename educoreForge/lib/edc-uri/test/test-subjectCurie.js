#!/usr/bin/env node
'use strict';

// test-subjectCurie.js — the encoded subject CURIE (mappingLayers ML3-a, R-a) and the curated assertion recipe (R-c'). PURE.
// Proves: plain CURIE expansion of the encoded subject IS the minted element IRI, for the stableIds the gold actually holds ('/', '@',
// ' ', ',', ':' in local parts); decoding is lossless; a prefix the encoding would alter is refused; the machine recipe is untouched by
// the curated one, and the curated hash is sha256(s \n p \n o \n author), pinned by a known answer computed outside the module.
//
// Run: node lib/edc-uri/test/test-subjectCurie.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the encoded subject CURIE and the curated assertion recipe

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const harness = require('../../../test/testLib/harness')(moduleName);
const { subjectCurieFor, stableIdOfSubjectCurie } = require('../subjectCurie');
const assertionIdentity = require('../assertionIdentity');
const edcUri = require('../edcUri');

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// real stableId shapes from the gold (DESIGN-ML1a §1): '/', a space and a comma, an '@', and PESC's ':'-bearing local parts
const caseList = [
	{ stableId: 'edfi:property/abstractEntity.EducationOrganization.Address', standardName: 'EdFi', standardVersion: '5.2.0', expectedCurie: 'edfi:property/abstractEntity.EducationOrganization.Address' },
	{ stableId: 'edfi:value/AbsenceEventCategory.Jury duty, civic', standardName: 'EdFi', standardVersion: '5.2.0', expectedCurie: 'edfi:value/AbsenceEventCategory.Jury%20duty%2C%20civic' },
	{ stableId: 'sif260928:field/StudentPersonal/@RefId', standardName: 'SIF260928', standardVersion: '4.3', expectedCurie: 'sif260928:field/StudentPersonal/%40RefId' },
	{ stableId: 'pescacademiceportfolio1v0v0:group/urn:org:pesc:core:CoreMain:v1.16.0#X/el/1:Y', standardName: 'PESC-AcademicEportfolio-1.0.0', standardVersion: '1.0.0', expectedCurie: 'pescacademiceportfolio1v0v0:group/urn:org:pesc:core:CoreMain:v1.16.0%23X/el/1:Y' },
	{ stableId: 'ctdl:property/ceterms:name', standardName: 'CTDL', standardVersion: 'Release 20260927', expectedCurie: 'ctdl:property/ceterms:name' },
];

// =====================================================================
harness.section('the encoded subject CURIE: plain expansion IS the element IRI; decoding is lossless');
// =====================================================================

caseList.forEach((oneCase) => {
	const identity = subjectCurieFor(oneCase);
	harness.equal(`${oneCase.stableId}: the encoded CURIE`, identity.subjectCurie, oneCase.expectedCurie);
	const minted = edcUri.mint({ kind: 'element', standardName: oneCase.standardName, standardVersion: oneCase.standardVersion, elementStableId: oneCase.stableId });
	harness.equal(`${oneCase.stableId}: expansion + local part = the minted element IRI, byte for byte`, `${identity.expansion}${identity.subjectCurie.slice(identity.prefix.length + 1)}`, minted.uri);
	harness.equal(`${oneCase.stableId}: decodes back to the stableId`, stableIdOfSubjectCurie(identity.subjectCurie).stableId, oneCase.stableId);
});
harness.equal('the expansion depends only on prefix and standard version', subjectCurieFor(caseList[0]).expansion, subjectCurieFor({ ...caseList[0], stableId: 'edfi:anything/else' }).expansion);
harness.match('a stableId with no prefix is refused', subjectCurieFor({ stableId: 'noPrefixHere', standardName: 'EdFi', standardVersion: '5.2.0' }).error, /is not '<prefix>:<local part>'/);
harness.match('a prefix the encoding would alter is refused', subjectCurieFor({ stableId: 'ed-fi:property/X', standardName: 'EdFi', standardVersion: '5.2.0' }).error, /does not match/);
harness.match('a malformed escape does not decode', stableIdOfSubjectCurie('edfi:property%2fX').error, /malformed escape/);
harness.match('an unencoded "@" does not decode (a verbatim subject is not an encoded one)', stableIdOfSubjectCurie('sif260928:field/X/@RefId').error, /unencoded character '@'/);
harness.equal("⟪ML3.1⟫ a real '/' decodes as itself", stableIdOfSubjectCurie('edfi:property/X').stableId, 'edfi:property/X');
harness.match("⟪ML3.1⟫ an empty piece is refused ('a//b')", subjectCurieFor({ stableId: 'edfi:a//b', standardName: 'EdFi', standardVersion: '5.2.0' }).error, /is forbidden/);

// =====================================================================
harness.section("the curated recipe (R-c'): s p o author; the machine recipe untouched");
// =====================================================================

const blockHash = 'b'.repeat(64);
const rowParts = { decisionBlockHash: blockHash, subjectStableId: caseList[0].stableId, subjectStandardName: 'EdFi', subjectStandardVersion: '5.2.0', predicateCurie: 'edc:bestMatch', objectStableId: 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/f00d', objectStandardName: 'CEDS', objectStandardVersion: '14.0.0.0' };
const subjectIri = 'https://w3id.org/EDUcore/EdFi/5.2.0/edfi:property/abstractEntity.EducationOrganization.Address';
const authorIri = 'https://w3id.org/EDUcore/agent/raterA';
const curated = assertionIdentity.curatedAssertionIdFor({ ...rowParts, authorIdList: [authorIri] });
harness.equal('the curated hash is sha256(s \\n p \\n o \\n author) over the expanded IRIs (known answer)', curated.assertionHash, sha256Hex([subjectIri, 'https://w3id.org/EDUcore/bestMatch', rowParts.objectStableId, authorIri].join('\n')));
harness.equal('…its id is the SAME assertion kind, scoped by the block hash', curated.assertionId, `https://w3id.org/EDUcore/assertion/${blockHash}/${curated.assertionHash}`);
const machine = assertionIdentity.assertionIdFor(rowParts);
harness.equal('the machine hash is still sha256(s \\n p \\n o) (known answer)', machine.assertionHash, sha256Hex([subjectIri, 'https://w3id.org/EDUcore/bestMatch', rowParts.objectStableId].join('\n')));
harness.ok('two authors of one triple: two curated ids, one machine id', assertionIdentity.curatedAssertionIdFor({ ...rowParts, authorIdList: ['https://w3id.org/EDUcore/agent/raterB'] }).assertionId !== curated.assertionId);
harness.match('zero authors is refused by name', assertionIdentity.curatedAssertionIdFor({ ...rowParts, authorIdList: [] }).error, /not exactly one absolute IRI/);
harness.match('several authors is refused by name', assertionIdentity.curatedAssertionIdFor({ ...rowParts, authorIdList: [authorIri, 'https://w3id.org/EDUcore/agent/raterB'] }).error, /not exactly one absolute IRI/);
harness.match('a CURIE author is refused (the hash takes full IRIs)', assertionIdentity.curatedAssertionIdFor({ ...rowParts, authorIdList: ['edc:agent/raterA'] }).error, /not exactly one absolute IRI/);

harness.report();
