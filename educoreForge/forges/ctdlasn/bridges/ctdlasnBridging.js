'use strict';

// ctdlasnBridging.js (composes ctdlasnCtdlDeclaredCorrespondence; named so until deCeds R3; header corrected zeroBacklog lane D) — ⟪ctdlHub-101926 P6 step 5; rulings R6, R-2, R-5⟫ CTDL-ASN's published correspondences to
// CTDL terms: an ASN NATIVE term's crossRef whose locator is a CORRESPONDENCE locator of the family locator table and whose target is
// a ceterms: IRI becomes ONE DECLARED_CORRESPONDENCE edge to the CTDL BASE node, the predicate (the locator) verbatim. Measured
// 2026-10-21 (P0 declaredCorrespondenceCounts.json, and by owner over the forged crossRefs): exactly 4, all owl:equivalentProperty
// (ceasn:codedNotation, ceasn:conceptKeyword, ceasn:conceptTerm, ceasn:educationLevelType). Never a match edge (Q-T1).
//
// THE LOCATOR TABLE is the family's ONE table (forges/ctdl/bridgeData/ctdlFamilyLocatorTable.json), read here as data: a STRUCTURE
// locator (schema:domainIncludes, rangeIncludes, rdfs:subClassOf, meta:targetScheme, meta:domainFor) belongs to the family-structure
// producer and is not this bridge's (ASN's one rdfs:subClassOf to ceterms: is July's SUBCLASS_OF); a CORRESPONDENCE locator aimed at
// a ceterms: target is this bridge's; a locator in NEITHER list refuses the walk by name.
// Ruled out of this bridge (R-5): ASN's correspondence to CTDL-QData's schema:description, and the A5 foreign entries on the root
// (subjects are native terms only, Q-T8). The ceterms: namespace rule: a CTDL term's stableId IS its CURIE (ceterms:keyword).

const fs = require('fs');
const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const { DME_ROLES } = vocabularyLib;

const CHANNEL_CROSS_REF = 'crossRefCorrespondenceChannel';
const NODE_PROPERTY = Object.freeze({ crossRefs: 'crossRefs' });
const NATIVE_TERM_ROLE_LIST = Object.freeze([DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_SET, DME_ROLES.OPTION_VALUE]);
const LOCATOR_TABLE_PATH = path.join(__dirname, '..', '..', 'ctdl', 'bridgeData', 'ctdlFamilyLocatorTable.json');
const TARGET_PATTERN_TEXT = '^(ceterms:[A-Za-z][A-Za-z0-9_]*)$';

// ⟪hub-neutral bridge lane R3, 2026-10-21⟫ MIGRATED from ctdlasnCtdlDeclaredCorrespondence.js: this file now declares the STANDARD half of the
// bridge; the hub half comes from the hub's own bridging declaration (forges/<hub>/lib/<hub>HubBridging.js) and the two compose
// (lib/bridge-framework/bridgeComposer.js) into the SAME declaration, digest for digest (test-bridgeComposer (a), P-a1).
// The declared-target rule now comes from the CTDL hub declaration (forges/ctdl/lib/ctdlHubBridging.js); walkSourceAssertions still reads TARGET_PATTERN_TEXT below to pick the entries it asserts, and test-hubBridging (f) holds the two equal.

const declarationTemplate = Object.freeze({
	standardKey: 'ctdlasn',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'declared',
	mappingProvider: {
		url: 'https://credreg.net/ctdlasn/terms',
		verifiedBy: {
			sessionName: 'INDIGO_CASCADE',
			date: '2026-10-21',
			note: 'Credential Engine, publisher of CTDL-ASN. curl is refused by the credreg.net Cloudflare challenge; on 2026-10-21 (ctdlHub P10) the page was read through a real Chrome driven by Playwright and states "Release 20260626", "This is the June 2026 CTDL-ASN release". The assertions are read from the CTDL-ASN forge snapshot 02 (ctdlasn.json, version 20260626). Earlier verification (STERLING_PORTAL, 2026-10-21) was against snapshot 01, version 20230929.',
		},
	},
	sourceCuriePrefix: { prefix: 'ceasn', iri: 'https://purl.org/ctdlasn/terms/' },
	subjectCuriePrefix: 'ceasn',
	sourceChannelList: [
		{
			channelKey: CHANNEL_CROSS_REF,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: [''],
			channelPropertyList: [NODE_PROPERTY.crossRefs],
			columnClassification: {
				subjectIdentityColumnList: [],
				tupleFieldColumnList: [NODE_PROPERTY.crossRefs],
				sourceLabelColumnList: [],
				carriedRecordColumnList: [],
				evidenceOnlyColumnList: [],
				consistencyCheckColumnList: [],
				ignoredColumnList: [],
			},
		},
	],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	tupleFieldColumnMap: {
		canonicalKey: { column: NODE_PROPERTY.crossRefs, transform: 'identity' },
	},
	predicateSource: {
		kind: 'declaredPredicate',
		predicateList: ['owl:equivalentClass', 'owl:equivalentProperty', 'owl:sameAs', 'rdfs:subPropertyOf', 'skos:exactMatch', 'skos:closeMatch', 'skos:broadMatch', 'skos:narrowMatch', 'skos:relatedMatch'],
		assertedBy: {
			documentName: 'CTDL-ASN schema, version 20260626 (forges/ctdlasn/assets/standardSourceData/02/ctdlasn.json)',
			citation: "Each ASN term's own JSON-LD entry states its correspondences (owl:equivalentProperty, …) to terms of other vocabularies; the CTDL-ASN forge carries every non-native reference verbatim as a crossRef { raw, locator } (allowance A1). The locator IS the source's predicate, written on the edge unchanged.",
		},
	},
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

const standardBridging = Object.freeze({
	standardKey: 'ctdlasn',
	bridgeNameStem: 'ctdlasn',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			subjectRenderingAllowList: null,
			pairByHubToken: {
				ctdl: {
					candidateRetrieval: null,
					candidateRenderingAllowList: null,
					promptIdentifierScan: null,
					blindingOrder: ['crossRefs'],
					hubAnchorListLength: null,
					declaredTargetRuleList: 'fromHub',
					remodelTableRef: null,
					hubRemodelTableListLength: null,
				},
			},
		},
	],
});

// parsedJsonOf — a JSON text read as data; a malformed one is refused by name. JSON.parse throws on malformed text; the throw is
// translated ONCE, here (the single-site boundary dispensation of sifCedsStandardPlugin's crossRefsFrom), never control flow.
const parsedJsonOf = ({ text, whatText }) => {
	let parsed = null;
	let parseFault = null;
	try {
		parsed = JSON.parse(text);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	return parseFault === null ? { parsed } : { error: `ctdlasnCtdlDeclaredCorrespondence: ${whatText} is not parseable JSON (${parseFault})` };
};

const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file
	const tableRead = parsedJsonOf({ text: fs.readFileSync(LOCATOR_TABLE_PATH, 'utf8'), whatText: `the family locator table ${LOCATOR_TABLE_PATH}` });
	if (tableRead.error) {
		callback(tableRead.error);
		return;
	}
	const structureLocatorList = tableRead.parsed.structureLocatorList.map((oneRow) => oneRow.locator);
	const correspondenceLocatorList = tableRead.parsed.correspondenceLocatorList;
	const targetPattern = new RegExp(TARGET_PATTERN_TEXT);
	sourceReader.readSourceNodes({ roleList: NATIVE_TERM_ROLE_LIST }, (readError, nodeList) => {
		if (readError) {
			callback(`ctdlasnCtdlDeclaredCorrespondence walkSourceAssertions: readSourceNodes: ${readError}`);
			return;
		}
		const assertionList = [];
		const countByDisposition = { structure: 0, correspondenceToTarget: 0, correspondenceElsewhere: 0 };
		let refusal = null;
		nodeList.forEach((oneNode) => {
			const rawCrossRefs = oneNode.properties[NODE_PROPERTY.crossRefs];
			if (refusal !== null || rawCrossRefs === undefined || rawCrossRefs === null) {
				return;
			}
			const carried = parsedJsonOf({ text: rawCrossRefs, whatText: `node '${oneNode.stableId}' crossRefs` });
			if (carried.error) {
				refusal = carried.error;
				return;
			}
			carried.parsed.forEach((oneCrossRef, crossRefIndex) => {
				if (refusal !== null) {
					return;
				}
				if (structureLocatorList.indexOf(oneCrossRef.locator) !== -1) {
					countByDisposition.structure += 1;
					return;
				}
				if (correspondenceLocatorList.indexOf(oneCrossRef.locator) === -1) {
					refusal = `ctdlasnCtdlDeclaredCorrespondence: node '${oneNode.stableId}' crossRef ${JSON.stringify(oneCrossRef)} carries locator '${oneCrossRef.locator}', which the family locator table lists as neither structure nor correspondence — refused by name`;
					return;
				}
				if (!targetPattern.test(String(oneCrossRef.raw))) {
					countByDisposition.correspondenceElsewhere += 1;
					return;
				}
				countByDisposition.correspondenceToTarget += 1;
				assertionList.push({
					channelKey: CHANNEL_CROSS_REF,
					subjectIdentity: { stableId: oneNode.stableId },
					rawTargetList: [{ sourceColumnName: NODE_PROPERTY.crossRefs, rawValue: oneCrossRef.raw }],
					tupleFieldValues: { canonicalKey: oneCrossRef.raw },
					sourcePredicate: oneCrossRef.locator,
					sourceLabelByColumn: {},
					sourceNoteByColumn: {},
					carriedRecord: {},
					evidence: { subject: {}, assertion: {} },
					sourceLocator: { channelKey: CHANNEL_CROSS_REF, stableId: oneNode.stableId, rowNumber: crossRefIndex },
				});
			});
		});
		if (refusal !== null) {
			callback(refusal);
			return;
		}
		xLog.status(`[ctdlasnCtdlDeclaredCorrespondence] walked ${nodeList.length} ASN native term(s); crossRefs: structure ${countByDisposition.structure} (the family producer's), correspondence to ceterms: ${countByDisposition.correspondenceToTarget}, correspondence to other vocabularies ${countByDisposition.correspondenceElsewhere} (not this bridge's)`);
		callback('', { assertionList, channelReport: { [CHANNEL_CROSS_REF]: { rowsRead: assertionList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 } } });
	});
};

const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader;
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[ctdlasnCtdlDeclaredCorrespondence] subjectStableIdFor: identity over ${subjectIdentityList.length} subject(s)`);
	callback('', { resolutionBySubjectKey });
};

const bridgeHooks = { walkSourceAssertions, subjectStableIdFor };

// the TARGET STANDARD: CTDL's base nodes, never its hub cards (objectKind baseNode, ruling R-2)

const bridgeHooksByFacetName = { '': bridgeHooks };

module.exports = { standardBridging, bridgeHooksByFacetName };
