'use strict';

// ctdlqdataForgeDeclaration.js — H1 for the CTDLQData forge bundle (ctdlHub-101926 P2): DATA only. The byte-facing values
// reproduce the July oracle's root (GOLD_EVAL_260718, ctdlqdata:root) except where the ratified allowance says otherwise
// (oracle/A3-candidateList.md and oracleAllowance.CTDLQData.json).

const path = require('path');
const { STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const vocabularyProfile = require('./ctdlqdataVocabularyProfile.json');

const STABLE_URI_PROPERTY_NAME = 'uri';
const ROOT_STABLE_ID = 'ctdlqdata:root';

const ctdlqdataForgeDeclaration = Object.freeze({
	standardKey: 'ctdlqdata',
	standardSource: vocabularyProfile.standardSource,
	standardDisplayName: 'Credential Transparency Description Language — Quantitative Data (CTDL-QData)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.CTDLQDATA,
	releaseLabel: 'CTDLQData',
	descriptionSource: "each term's dct:description, else rdfs:comment, else skos:definition (en-US) in the CTDL-QData JSON-LD schema",
	standardUsageTips: null,
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// the native CURIE as written (the July identity rule); the prefix alternation is the profile's own allowlist
	stableIdPattern: Object.freeze({ pattern: `^(${ROOT_STABLE_ID}|(${vocabularyProfile.nativePrefixList.concat(vocabularyProfile.nativeTermIdList.map((termId) => termId.split(':')[0])).join('|')}):[A-Za-z0-9_]+)$`, trimmed: true }),
	rootStableIdFrom: 'declared',
	rootStableId: ROOT_STABLE_ID,
	rootLabel: 'CtdlqdataRoot',
	parserVersion: '1',
	mappingInstruction: Object.freeze({
		hubAnchorPropertyNameByHub: Object.freeze({}),
		hubOptionAnchorPropertyNameByHub: Object.freeze({}),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	}),
	nonEmbeddableRoleList: Object.freeze([]),
	// ruling Q3: no DmeEmbedText nodes in P1/P2 (the oracle's node set holds); docketed for the hub phases
	embedTextDeclaration: null,
	hubAnchorAbsentSentinelList: Object.freeze([]),
	additionalSourceInputList: Object.freeze([Object.freeze({ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' })]),
	compatibilityDeclarationList: Object.freeze([
		Object.freeze({
			allowanceId: 'CT1',
			rootExtraPropertyNameList: Object.freeze(['foreignTermEntryList']),
			probeEvidence: Object.freeze({
				probeName: 'jsonLdSourceCensus (apps/graph-builder/tools/jsonLdSourceCensus.js) over snapshot 01',
				probeDate: '2026-10-20',
				probeResult: 'qdata.json holds 31 @graph entries outside the native allowlist (ceterms 31): dataStores/ctdlHub_101926/oracle/A5-foreignTermCounts.json',
			}),
		}),
	]),
});

module.exports = ctdlqdataForgeDeclaration;
