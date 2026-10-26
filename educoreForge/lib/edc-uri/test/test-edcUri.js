#!/usr/bin/env node
'use strict';

// test-edcUri.js — G-URI (parse half) and the assertion-identity recipe (mappingLayers ML1-a; SPEC §12; DESIGN-ML1a §2-§3).
// Every kind of uriScheme.json mints from a REAL gold value (fixtures/goldUriFixture.json, captured read-only from
// GOLD_EVAL_261023_zeroBacklog by the lane M tool captureGoldUriFixture.js) and parses back to the same parts; the meaning
// kind mints BYTE-IDENTICAL to the card uri the hub framework stored; a stableId carrying ':' '/' '@' ' ' '#' round-trips;
// an unlisted kind, a reserved first segment, a stray part and a malformed escape are each refused by name; the MSI and the
// assertion hash are PINNED by known answers computed outside the module (shasum over the literal strings).
//
// PURE: no graph, no file other than the fixture. Run: node lib/edc-uri/test/test-edcUri.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- G-URI and assertion-identity gates for lib/edc-uri

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Mints every uriScheme.json kind from real gold values and parses each back; proves the segment encoding round-trips the
     stableIds the gold actually holds; proves each refusal by name; pins the MSI (the ts4nfdi page's own Example 1) and the
     assertion hash by known answers.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const edcUri = require('../edcUri');
const assertionIdentity = require('../assertionIdentity');
const goldUriFixture = require('./fixtures/goldUriFixture.json');

const { mint, parse, encodeSegment, decodeSegment, encodeElementPath, schemeLoadRefusalFor, KIND_LIST, RESERVED_WORD_LIST, URI_SCHEME } = edcUri;

// the parts each kind is minted from: real gold values where the gold has the thing, labelled examples where it does not yet
const meaningRow = goldUriFixture.meaningList[0];
const sifAtEdge = goldUriFixture.edgeClassList.find((oneClass) => oneClass.hasAt).oneEdge;
// no MAPPED subject carries a space (measured); the value nodes do, so the space case takes an Ed-Fi value node and the
// Ed-Fi version from an Ed-Fi edge
const edfiSpaceStableId = goldUriFixture.oddStableIdList.find((oneRow) => oneRow.oneCharacter === ' ').stableId;
const edfiVersion = goldUriFixture.edgeClassList.find((oneClass) => oneClass.subjectSource === 'EdFi').oneEdge.subjectVersion;
const fanOutEdge = goldUriFixture.edgeClassList.find((oneClass) => oneClass.isFanOut).oneEdge;
const declaredCurieEdge = goldUriFixture.edgeClassList.find((oneClass) => oneClass.edgeType === 'DECLARED_CORRESPONDENCE' && !/^https?:\/\//.test(oneClass.oneEdge.objectStableId)).oneEdge;
const hubSegmentOf = (namespace) => namespace.slice(URI_SCHEME.baseIri.length).split('/')[0];
const hubReleaseSegmentOf = (cardUri, namespace) => cardUri.slice(namespace.length).split('/')[0];
const manifestRefId = goldUriFixture.capturedFrom.manifestRefId;
const judgeIdentity = goldUriFixture.judgeIdentityList[0];
// ⟪ML3.1⟫ a real schema block id: goldWave3's SIF 260928 standardBase block (measured on the store copy, 2026-10-26)
const sifStandardBaseRefId = '4002ade8ba2d8c3297bf17ec8008a622c6bd46d35205302d1beddd4c242afed3';

const PART_BY_NAME_BY_KIND = {
	meaning: { hubSegment: hubSegmentOf(meaningRow.namespace), hubReleaseSegment: hubReleaseSegmentOf(meaningRow.uri, meaningRow.namespace), addressSignature: meaningRow.addressSignature },
	element: { standardName: sifAtEdge.subjectSource, standardVersion: sifAtEdge.subjectVersion, elementStableId: sifAtEdge.subjectStableId },
	layer: { layerKey: 'jev' },
	layerVersion: { layerKey: 'jev', versionTag: judgeIdentity.slice(judgeIdentity.lastIndexOf(':') + 1) },
	layerVersionByContent: { layerKey: 'jev', contentId: sifAtEdge.decisionBlockHash },
	assertion: { decisionBlockHash: sifAtEdge.decisionBlockHash, assertionHash: sifAtEdge.matchId },
	interpretationPinned: { standardName: 'EdFi', standardVersion: edfiVersion, elementStableId: edfiSpaceStableId, layerKey: 'jev', versionTag: 'cfg-03f64470322c' },
	interpretationFloating: { standardName: fanOutEdge.subjectSource, standardVersion: fanOutEdge.subjectVersion, elementStableId: fanOutEdge.subjectStableId, layerKey: 'jev' },
	manifest: { publicLabel: 'zeroBacklog-261023' },
	manifestByContent: { manifestRefId },
	question: { publicLabel: 'zeroBacklog-261023', standardName: sifAtEdge.subjectSource, standardVersion: sifAtEdge.subjectVersion, elementStableId: sifAtEdge.subjectStableId },
	questionForHub: { publicLabel: 'zeroBacklog-261023', hubSegment: hubSegmentOf(meaningRow.namespace), standardName: sifAtEdge.subjectSource, standardVersion: sifAtEdge.subjectVersion, elementStableId: sifAtEdge.subjectStableId },
	questionByContent: { manifestRefId, standardName: sifAtEdge.subjectSource, standardVersion: sifAtEdge.subjectVersion, elementStableId: sifAtEdge.subjectStableId }, // ⟪ML3.1, Q43⟫
	questionForHubByContent: { manifestRefId, hubSegment: hubSegmentOf(meaningRow.namespace), standardName: sifAtEdge.subjectSource, standardVersion: sifAtEdge.subjectVersion, elementStableId: sifAtEdge.subjectStableId },
	schemaBlock: { schemaBlockRefId: sifStandardBaseRefId }, // ⟪ML3.1, Q51⟫
	decisionSchemaBlock: { decisionBlockHash: sifAtEdge.decisionBlockHash },
	agentPerson: { userRefId: 'f3c1a9e0-0000-4000-8000-000000000005' },
	agentJudge: { judgeIdentity },
	agentOrganisation: { organisationSlug: 'educore' },
	siteLayerRegistry: {}, // ⟪ML3-b⟫ the site registry: a template of literals only
	vocabularyTerm: { termName: 'bestMatch' }, // ⟪ML3-a⟫ the r1 rater sets' own predicate, spelled as already registered
	// ⟪ML3.1, Q5⟫ the discovery forms
	root: {},
	scheme: {},
	manifestList: {},
	manifestStandardList: { publicLabel: 'zeroBacklog-261023' },
	manifestStandardListByContent: { manifestRefId },
	manifestElementList: { publicLabel: 'zeroBacklog-261023', standardName: sifAtEdge.subjectSource, standardVersion: sifAtEdge.subjectVersion },
	manifestElementListByContent: { manifestRefId, standardName: sifAtEdge.subjectSource, standardVersion: sifAtEdge.subjectVersion },
	agentList: {},
};

// =====================================================================
harness.section('G-URI: every kind of uriScheme.json mints and parses back to the same parts');
// =====================================================================

harness.equal('every kind in the scheme has a mint case here (none skipped, none invented)', Object.keys(PART_BY_NAME_BY_KIND).sort().join(','), KIND_LIST.slice().sort().join(','));
KIND_LIST.forEach((oneKind) => {
	const minted = mint({ kind: oneKind, ...PART_BY_NAME_BY_KIND[oneKind] });
	harness.ok(`${oneKind}: mints`, minted.error === undefined, minted.error);
	if (minted.error) {
		return;
	}
	const fromUri = parse(minted.uri);
	const fromCurie = parse(minted.curie);
	harness.equal(`${oneKind}: the IRI parses back as ${oneKind}`, fromUri.kind, oneKind);
	harness.equal(`${oneKind}: …with the same parts`, JSON.stringify(fromUri.partByName), JSON.stringify(PART_BY_NAME_BY_KIND[oneKind]));
	harness.equal(`${oneKind}: the edc: CURIE parses to the same thing`, JSON.stringify(fromCurie), JSON.stringify(fromUri));
});
harness.equal('meaning: mints BYTE-IDENTICAL to the card uri the hub framework stored (gold)', mint({ kind: 'meaning', ...PART_BY_NAME_BY_KIND.meaning }).uri, meaningRow.uri);
goldUriFixture.meaningList.forEach((oneMeaning) => {
	const parsed = parse(oneMeaning.uri);
	harness.equal(`meaning: the ${oneMeaning.hubName} card uri parses, and its addressSignature is the card's`, parsed.partByName && parsed.partByName.addressSignature, oneMeaning.addressSignature);
});

// =====================================================================
harness.section('G-URI: the segment encoding round-trips the stableIds the gold holds');
// =====================================================================

const stableIdCaseList = goldUriFixture.edgeClassList.map((oneClass) => oneClass.oneEdge.subjectStableId).concat(goldUriFixture.oddStableIdList.map((oneRow) => oneRow.stableId)).concat([declaredCurieEdge.objectStableId, 'x:a/b:c/d', 'café:naïve/Ωmega', 'emoji:😀/tail']);
stableIdCaseList.forEach((oneStableId) => {
	const encoded = encodeSegment(oneStableId);
	const decoded = decodeSegment(encoded.segmentText);
	harness.ok(`round-trips ${JSON.stringify(oneStableId).slice(0, 90)}`, decoded.text === oneStableId.normalize('NFC') && !/[/@ ]/.test(encoded.segmentText), JSON.stringify({ encoded, decoded }));
});
harness.equal("':' stays literal and '/' is encoded", encodeSegment('ceterms:a/b').segmentText, 'ceterms:a%2Fb');
harness.equal("'@' is encoded, so an interpretation's '@' is unambiguous", encodeSegment('x:@RefId').segmentText, 'x:%40RefId');
harness.equal('NFC: a decomposed é encodes as the composed one', encodeSegment('café').segmentText, encodeSegment('café').segmentText);

// =====================================================================
harness.section('Refusals, each by name');
// =====================================================================

harness.match('an unlisted kind is refused by name', mint({ kind: 'mappingRegistry', layerKey: 'jev' }).error, /kind "mappingRegistry" is not in the scheme/);
harness.match('a stray part is refused by name', mint({ kind: 'layer', layerKey: 'jev', versionTag: 'r1' }).error, /kind 'layer' has no part 'versionTag'/);
harness.match('an absent part is refused, never defaulted', mint({ kind: 'layerVersion', layerKey: 'jev' }).error, /needs part 'versionTag'/);
harness.match("a standard named like a reserved word ('agent') is refused", mint({ kind: 'element', standardName: 'agent', standardVersion: 'judge', elementStableId: 'x:y' }).error, /may not be the reserved word 'agent'/);
harness.match("a forbidden segment ('..') is refused", mint({ kind: 'layer', layerKey: '..' }).error, /is forbidden/);
harness.match('a lower-case escape is refused (one spelling per value)', decodeSegment('a%2fb').error, /malformed escape/);
harness.match('an unencoded character is refused', decodeSegment('a b').error, /unencoded character ' '/);
harness.match('an escape that is not UTF-8 is refused', decodeSegment('%FF').error, /does not decode to a text that encodes back/);
harness.match('a verbatim part that is not already encoded is refused', mint({ kind: 'meaning', hubSegment: 'CTDL', hubReleaseSegment: 'Release 20260927', addressSignature: 'ab' }).error, /is not an already-encoded segment/);
harness.match('a URI outside the base is refused', parse('https://example.org/x').error, /neither under/);
harness.match('a path that names no kind is refused', parse('edc:layer/jev/sha256/x/y').error, /matches no kind/);

// =====================================================================
harness.section('ML3.1 (Q41-Q43, Q51): real slashes, the element path ends the URI, reserved words, the hub ahead of the standard');
// =====================================================================

const sifElement = mint({ kind: 'element', ...PART_BY_NAME_BY_KIND.element });
harness.ok("the element path keeps '/' and still encodes '@' (no %2F anywhere in it)", sifElement.uri.indexOf('%2F') === -1 && sifElement.uri.indexOf('%40') !== -1 && sifElement.uri.split('/').length > 6, sifElement.uri);
harness.equal("encodeElementPath encodes piece by piece and keeps '/'", encodeElementPath('sedm:entity/Parent%2FGuardian/element/Telephone N').pathText, 'sedm:entity/Parent%252FGuardian/element/Telephone%20N');
const sedmElement = mint({ kind: 'element', standardName: 'SEDM', standardVersion: 'unknown_01', elementStableId: 'sedm:entity/Parent%2FGuardian/element/Telephone N' });
harness.equal("a stableId that already holds a literal '%' round-trips ('%25' inside, measured on SEDM)", parse(sedmElement.uri).partByName.elementStableId, 'sedm:entity/Parent%2FGuardian/element/Telephone N');
// THE AMBIGUITY THE WORK ORDER NAMED: CTDL is a hub segment AND a standard name; the reserved literal 'hub' decides, no lookup
const ctdlAsBoth = { publicLabel: 'educore-2026-10', hubSegment: 'CTDL', standardName: 'CTDL', standardVersion: 'Release 20260927', elementStableId: 'financialAid:AcademicAssistantship/x y' };
const ctdlHubQuestion = mint({ kind: 'questionForHub', ...ctdlAsBoth });
harness.equal('a hub question whose hub segment equals its standard name (CTDL) parses back as questionForHub', JSON.stringify(parse(ctdlHubQuestion.uri)), JSON.stringify({ kind: 'questionForHub', partByName: ctdlAsBoth }));
const { hubSegment: ctdlHubSegment, ...ctdlNoHub } = ctdlAsBoth;
harness.equal('…and the same question without a hub parses as question, with the standard first', JSON.stringify(parse(mint({ kind: 'question', ...ctdlNoHub }).uri)), JSON.stringify({ kind: 'question', partByName: ctdlNoHub }));
harness.equal('the hub question is spelled hub-ahead: manifest/<label>/q/hub/<hub>/<standard>/<version>/<path>', ctdlHubQuestion.curie, `edc:manifest/educore-2026-10/q/hub/${ctdlHubSegment}/CTDL/Release%2020260927/financialAid:AcademicAssistantship/x%20y`);
harness.match("a standard named 'hub' is refused (it would read as the hub literal)", mint({ kind: 'question', ...ctdlNoHub, standardName: 'hub' }).error, /reserved word 'hub'/);
harness.match("'sha256' is never a manifest label (Q43)", mint({ kind: 'manifest', publicLabel: 'sha256' }).error, /reserved word 'sha256'/);
harness.match('a manifest hash that is not 64 lowercase hex is refused', mint({ kind: 'manifestByContent', manifestRefId: 'educore-2026-10' }).error, /does not match/);
harness.match('a schema block id that is not 64 lowercase hex is refused', mint({ kind: 'schemaBlock', schemaBlockRefId: sifStandardBaseRefId.toUpperCase() }).error, /does not match/);
harness.match("an element path with an empty piece is refused ('a//b')", mint({ kind: 'element', standardName: 'EdFi', standardVersion: '5.2.0', elementStableId: 'edfi:a//b' }).error, /is forbidden/);
harness.match("an element path with a '..' piece is refused", mint({ kind: 'element', standardName: 'EdFi', standardVersion: '5.2.0', elementStableId: 'edfi:a/../b' }).error, /is forbidden/);
harness.match('an element path with a trailing slash is refused', mint({ kind: 'element', standardName: 'EdFi', standardVersion: '5.2.0', elementStableId: 'edfi:a/' }).error, /is forbidden/);
// R-1 (a): BR2 is NOT edcUri's to check (subjectCurie.js and the exporter refuse it by name); disjointness rests on the reserved words
harness.equal('R-1 (a): a prefixless element path mints and parses back (BR2 is enforced in subjectCurie and the exporter, not here)', parse(mint({ kind: 'element', standardName: 'EdFi', standardVersion: '5.2.0', elementStableId: 'property/x' }).uri).partByName.elementStableId, 'property/x');
harness.match("R-1 (a): …but an element whose version is the reserved word 'hub' is refused, so a meaning can never read as an element", mint({ kind: 'element', standardName: 'CEDStandards', standardVersion: 'hub', elementStableId: '14.0.0.0/abc' }).error, /reserved word 'hub'/);
harness.match("the retired edc-uri-1 spelling ('%2F' inside the path) is refused: one spelling per element", parse('https://w3id.org/EDUcore/EdFi/5.2.0/edfi:property%2FabstractEntity.EducationOrganization.Address').error, /matches no kind/);
harness.match("decodeElementPath names the escaped '/'", edcUri.decodeElementPath('edfi:property%2FX').error, /carries an escaped '\/'/);
harness.match("a parsed '.' piece is refused, never normalised away", parse('edc:EdFi/5.2.0/edfi:a/./b').error, /matches no kind/);
// O-5 (finding, left alone): the CEDS forge mints its own IRIs under the base; the parser must keep refusing them
['https://w3id.org/EDUcore/CEDStandards/layer/guide/14/concept/Resource', 'https://w3id.org/EDUcore/CEDStandards/layer/textRepair/14_0_0_0/repair/OV000050129949%2Fname%2F0'].forEach((oneForgeIri) => {
	harness.match(`a CEDS-forge IRI is not read as any kind: ${oneForgeIri.slice(25, 70)}…`, parse(oneForgeIri).error, /matches no kind/);
});
const pinnedWithSlash = { standardName: 'SIF260928', standardVersion: '4.3', elementStableId: 'sif260928:field/A/B/@RefId', layerKey: 'jev', versionTag: 'cfg-cf8d41f82791.wave3-261025' };
harness.equal("a pinned interpretation of a slash path parses back (the first '@' ends the path)", JSON.stringify(parse(mint({ kind: 'interpretationPinned', ...pinnedWithSlash }).uri)), JSON.stringify({ kind: 'interpretationPinned', partByName: pinnedWithSlash }));
harness.equal('the reserved words are exactly the scheme\'s whole-segment literals (Q5 adds agents, elements, manifests, scheme, standards)', RESERVED_WORD_LIST.join(','), 'agent,agents,assertion,decisionSchemaBlock,elements,hub,judge,layer,layers,manifest,manifests,org,q,registry,schemaBlock,scheme,sha256,standards');
harness.equal('Q5: the base IRI itself is the root kind', JSON.stringify(parse('https://w3id.org/EDUcore/')), JSON.stringify({ kind: 'root', partByName: {} }));
harness.equal("Q5: 'edc:' alone is the root too", parse('edc:').kind, 'root');
harness.match("Q5: a standard named 'elements' is refused (a listing literal)", mint({ kind: 'manifestElementList', publicLabel: 'educore-2026-10', standardName: 'elements', standardVersion: '1.0' }).error, /reserved word 'elements'/);
harness.equal("Q5: a standards listing and a question differ at the reserved literal ('standards' vs 'q')", [parse('edc:manifest/educore-2026-10/standards').kind, parse('edc:manifest/educore-2026-10/q/SIF260928/4.3/sif260928:field/A').kind].join(','), 'manifestStandardList,question');
harness.ok('Q5: the paging rule is data in the scheme (fixed page size, query parameter, listing kinds that exist)', URI_SCHEME.listingPaging.queryParameterName === 'page' && Number.isInteger(URI_SCHEME.listingPaging.pageSize) && URI_SCHEME.listingPaging.listingKindList.every((oneKind) => KIND_LIST.indexOf(oneKind) !== -1));
// THE LOAD-TIME SELF-CHECK and its twins: the shipped scheme passes; a planted bad one is refused by name
const plantedScheme = (kindRowEdit) => ({ ...URI_SCHEME, kindList: URI_SCHEME.kindList.map((oneRow) => (oneRow.kind === kindRowEdit.kind ? { ...oneRow, ...kindRowEdit } : oneRow)) });
harness.equal('the shipped uriScheme.json passes its own load check', schemeLoadRefusalFor(URI_SCHEME), '');
harness.match('TWIN: a template with a segment after {elementStableId} is refused at load', schemeLoadRefusalFor(plantedScheme({ kind: 'question', template: 'manifest/{publicLabel}/q/{standardName}/{standardVersion}/{elementStableId}/{hubSegment}', verbatimPartList: ['hubSegment'] })), /an element path ends a URI/);
harness.match('TWIN: a path part declared verbatim is refused at load', schemeLoadRefusalFor(plantedScheme({ kind: 'element', verbatimPartList: ['elementStableId'] })), /path-valued part 'elementStableId' as verbatim/);
harness.match('TWIN: a closed value equal to a reserved word is refused at load', schemeLoadRefusalFor(plantedScheme({ kind: 'vocabularyTerm', closedValueListByPartName: { termName: ['bestMatch', 'hub'] } })), /reserved word 'hub'/);
harness.match('TWIN (Q5): a paging rule naming a kind the scheme lacks is refused at load', schemeLoadRefusalFor({ ...URI_SCHEME, listingPaging: { ...URI_SCHEME.listingPaging, listingKindList: ['manifestList', 'ghostList'] } }), /names 'ghostList'/);
harness.match('TWIN (Q5): a page size of 0 is refused at load', schemeLoadRefusalFor({ ...URI_SCHEME, listingPaging: { ...URI_SCHEME.listingPaging, pageSize: 0 } }), /listingPaging is absent or malformed/);
harness.match('TWIN: a hash pattern for a part no template carries is refused at load', schemeLoadRefusalFor({ ...URI_SCHEME, partPatternByPartName: { ...URI_SCHEME.partPatternByPartName, ghostRefId: '^x$' } }), /names 'ghostRefId'/);

// =====================================================================
harness.section('assertionIdentity: the recipe, pinned');
// =====================================================================

// KNOWN ANSWERS, computed OUTSIDE the module (printf '<text>' | shasum -a 256), so a change to the recipe's bytes is caught
const MSI_EXAMPLE_ONE = 'mapping:95a088082ab2b2a68638aebbcc3fe3e0f229da75a8b5bdbb9f3f8cd5e1e4286e'; // the MSI page's own Example 1
const MSI_EXAMPLE_TWO = 'mapping:424e7a86ea29d5a0aaf1d3d7da9a864b48121ac465c67163aef56f6f87bb1ba8~'; // Example 2: negative, two subjects
harness.equal('MSI reproduces the ts4nfdi page Example 1', assertionIdentity.mappingSamenessIdFor({ subjectIriList: ['http://example.org/feline'], predicateIri: 'http://www.w3.org/2002/07/owl#sameAs', objectIriList: ['http://example.com/cat'], isNegative: false }).mappingSamenessId, MSI_EXAMPLE_ONE);
harness.equal('MSI reproduces Example 2 (negative; subjects given out of order are sorted)', assertionIdentity.mappingSamenessIdFor({ subjectIriList: ['http://example.org/red', 'http://example.org/blue'], predicateIri: 'http://www.w3.org/2004/02/skos/core#closeMatch', objectIriList: ['http://example.com/green'], isNegative: true }).mappingSamenessId, MSI_EXAMPLE_TWO);
harness.match('MSI refuses a CURIE (it hashes full IRIs)', assertionIdentity.mappingSamenessIdFor({ subjectIriList: ['edfi:x'], predicateIri: 'http://www.w3.org/2004/02/skos/core#exactMatch', objectIriList: ['http://example.com/x'], isNegative: false }).error, /absolute IRIs/);
harness.match('MSI refuses an unstated negativity', assertionIdentity.mappingSamenessIdFor({ subjectIriList: ['http://a.org/x'], predicateIri: 'http://b.org/p', objectIriList: ['http://c.org/y'] }).error, /isNegative undefined is not a boolean/);

const KNOWN_TRIPLE = {
	decisionBlockHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	subjectStableId: 'edfi:value/AbsenceEventCategory.Jury duty',
	subjectStandardName: 'EdFi',
	subjectStandardVersion: '5.2.0',
	predicateCurie: 'skos:exactMatch',
	objectStableId: 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa',
	objectStandardName: 'ToyHub',
	objectStandardVersion: '1.0',
};
// ⟪ML3.1⟫ re-pinned for the respelled element IRI (real '/', Q42); the edc-uri-1 answer was 8cb3a7dd…af022 over '%2F'
// printf 'https://w3id.org/EDUcore/EdFi/5.2.0/edfi:value/AbsenceEventCategory.Jury%%20duty\nhttp://www.w3.org/2004/02/skos/core#exactMatch\nhttps://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa' | shasum -a 256
const KNOWN_ASSERTION_HASH = 'b800fc6e53390b057ec24653c1f7e50753cc6cacb7ca7568e9f3970e4c4d6226';
const knownAnswer = assertionIdentity.assertionIdFor(KNOWN_TRIPLE);
harness.equal("subject expands to the edc element IRI ('/' real, space encoded)", knownAnswer.subjectIri, 'https://w3id.org/EDUcore/EdFi/5.2.0/edfi:value/AbsenceEventCategory.Jury%20duty');
harness.equal('predicate expands through predicatePrefixExpansion', knownAnswer.predicateIri, 'http://www.w3.org/2004/02/skos/core#exactMatch');
harness.equal('an object that is already an IRI is its own IRI', knownAnswer.objectIri, KNOWN_TRIPLE.objectStableId);
harness.equal('assertionHash = sha256(subjectIri \\n predicateIri \\n objectIri) (known answer)', knownAnswer.assertionHash, KNOWN_ASSERTION_HASH);
harness.equal('assertionId is the edc assertion IRI over (decisionBlockHash, assertionHash)', knownAnswer.assertionId, `https://w3id.org/EDUcore/assertion/${KNOWN_TRIPLE.decisionBlockHash}/${KNOWN_ASSERTION_HASH}`);
harness.equal('the declared CURIE object (ceterms:) expands to an element IRI of its standard version', assertionIdentity.nodeIriFor({ stableId: declaredCurieEdge.objectStableId, standardName: declaredCurieEdge.objectSource, standardVersion: declaredCurieEdge.objectVersion }).iri, `https://w3id.org/EDUcore/CTDL/Release%2020260927/${declaredCurieEdge.objectStableId}`);
harness.equal('an abstention object (sssom:NoTermFound) is its declared vocabulary IRI, never an element', assertionIdentity.nodeIriFor({ stableId: 'sssom:NoTermFound', standardName: 'ToyHub', standardVersion: '1.0' }).iri, 'https://w3id.org/sssom/NoTermFound');
harness.equal('owl:equivalentClass expands verbatim', assertionIdentity.predicateIriFor('owl:equivalentClass').iri, 'http://www.w3.org/2002/07/owl#equivalentClass');
harness.match('an unexpandable predicate prefix is refused by name', assertionIdentity.predicateIriFor('rdfs:seeAlso').error, /predicate prefix 'rdfs' .* has no expansion/);
// ⟪ML3-a⟫ the edc predicates now expand (a curated row's record_id hashes them), to the spelling the r1 sets' curie_map already gives
harness.equal('ML3-a: edc:bestMatch expands to the registered spelling', assertionIdentity.predicateIriFor('edc:bestMatch').iri, 'https://w3id.org/EDUcore/bestMatch');
harness.equal('ML3-a: edc:alsoAcceptable expands to the registered spelling', assertionIdentity.predicateIriFor('edc:alsoAcceptable').iri, 'https://w3id.org/EDUcore/alsoAcceptable');
harness.match('ML3-a: an undeclared vocabulary term is refused at mint', mint({ kind: 'vocabularyTerm', termName: 'worstMatch' }).error, /takes only bestMatch, alsoAcceptable/);
harness.match('ML3-a: an undeclared vocabulary term matches no kind at parse', parse('https://w3id.org/EDUcore/worstMatch').error, /matches no kind/);
harness.equal('ML3-a: every closed term has a definition, and every definition a closed term', Object.keys(URI_SCHEME.vocabularyTermDefinitionByName).filter((oneName) => oneName !== 'about').sort().join(','), URI_SCHEME.kindList.find((oneRow) => oneRow.kind === 'vocabularyTerm').closedValueListByPartName.termName.slice().sort().join(','));
harness.match('a non-hex block hash is refused', assertionIdentity.assertionIdFor({ ...KNOWN_TRIPLE, decisionBlockHash: 'abc' }).error, /not a 64-hex id/);
harness.ok('a different block gives a different assertionId for the same triple, the same assertionHash', (() => {
	const other = assertionIdentity.assertionIdFor({ ...KNOWN_TRIPLE, decisionBlockHash: 'b'.repeat(64) });
	return other.assertionId !== knownAnswer.assertionId && other.assertionHash === knownAnswer.assertionHash;
})());
goldUriFixture.edgeClassList.forEach((oneClass) => {
	const oneEdge = oneClass.oneEdge;
	const computed = assertionIdentity.assertionIdFor({ decisionBlockHash: oneEdge.decisionBlockHash, subjectStableId: oneEdge.subjectStableId, subjectStandardName: oneEdge.subjectSource, subjectStandardVersion: oneEdge.subjectVersion, predicateCurie: oneEdge.predicateCurie, objectStableId: oneEdge.objectStableId, objectStandardName: oneEdge.objectSource, objectStandardVersion: oneEdge.objectVersion });
	harness.ok(`gold edge class ${oneClass.subjectSource} ${oneClass.edgeType}${oneClass.isFanOut ? ' fan-out' : ''}${oneClass.hasAt ? ' @' : ''}${oneClass.hasSpace ? ' space' : ''}: an assertion id is computed and parses as an assertion`, computed.error === undefined && parse(computed.assertionId).kind === 'assertion', computed.error);
});

harness.report();
