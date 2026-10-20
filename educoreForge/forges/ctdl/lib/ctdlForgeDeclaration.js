'use strict';

// ctdlForgeDeclaration.js — H1 for the CTDL forge bundle (ctdlHub-101926 P1): DATA only. The byte-facing
// values reproduce the July oracle's root (GOLD_EVAL_260718, ctdl:root) except where the ratified A3 list
// says otherwise (oracle/A3-candidateList.md): mappingInstruction no longer names a CEDS anchor property
// (V1, ruling R6: the forge carries the ceds: declarations verbatim and resolves nothing), and the root
// gains the framework-built standardKind / standardFamily / releaseLabel / descriptionSource (N1-N4).

const path = require('path');
const { STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const vocabularyProfile = require('./ctdlVocabularyProfile.json');

const STABLE_URI_PROPERTY_NAME = 'uri';
const ROOT_STABLE_ID = 'ctdl:root';

const ctdlForgeDeclaration = Object.freeze({
	standardKey: 'ctdl',
	standardSource: vocabularyProfile.standardSource,
	standardDisplayName: 'Credential Transparency Description Language',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.CTDL,
	releaseLabel: 'CTDL',
	descriptionSource: "each term's dct:description, else rdfs:comment, else skos:definition (en-US) in the CTDL JSON-LD schema",
	standardUsageTips: null,
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// the native CURIE as written (the July identity rule); the prefix alternation is the profile's own allowlist
	stableIdPattern: Object.freeze({ pattern: `^(${ROOT_STABLE_ID}|(${vocabularyProfile.nativePrefixList.join('|')}):[A-Za-z0-9_]+)$`, trimmed: true }),
	rootStableIdFrom: 'declared',
	rootStableId: ROOT_STABLE_ID,
	rootLabel: 'CtdlRoot',
	parserVersion: '1',
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
		includeInImplied: true,
		impliedTargets: Object.freeze(['CEDS']),
	}),
	nonEmbeddableRoleList: Object.freeze([]),
	// ruling Q3: no DmeEmbedText nodes in P1/P2 (the oracle's node set holds); docketed for the hub phases
	embedTextDeclaration: null,
	cedsAnchorAbsentSentinelList: Object.freeze([]),
	additionalSourceInputList: Object.freeze([Object.freeze({ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' })]),
	compatibilityDeclarationList: Object.freeze([
		Object.freeze({
			allowanceId: 'CT1',
			rootExtraPropertyNameList: Object.freeze(['foreignTermEntryList']),
			probeEvidence: Object.freeze({
				probeName: 'jsonLdSourceCensus (apps/graph-builder/tools/jsonLdSourceCensus.js) over snapshot 01',
				probeDate: '2026-10-20',
				probeResult: 'ctdl-schema.json holds 20 @graph entries outside the native allowlist (ceasn 7, qdata 4, schema 8, owl 1): dataStores/ctdlHub_101926/oracle/A5-foreignTermCounts.json',
			}),
		}),
	]),
});

module.exports = ctdlForgeDeclaration;
