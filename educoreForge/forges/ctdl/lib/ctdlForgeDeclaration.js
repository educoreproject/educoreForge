'use strict';

// ctdlForgeDeclaration.js — H1 for the CTDL forge bundle (ctdlHub-101926 P1): DATA only. The byte-facing
// values reproduce the July oracle's root (GOLD_EVAL_260718, ctdl:root) except where the ratified A3 list
// says otherwise (oracle/A3-candidateList.md): mappingInstruction no longer names a CEDS anchor property
// (V1, ruling R6: the forge carries the ceds: declarations verbatim and resolves nothing), and the root
// gains the framework-built standardKind / standardFamily / releaseLabel / descriptionSource (N1-N4).

const path = require('path');
const { STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const vocabularyProfile = require('./ctdlVocabularyProfile.json');
const { EMBED_TEXT_PATH_SEGMENT } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'embedTextDerivation'));

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
	// the native CURIE as written (the July identity rule); the prefix alternation is the profile's own allowlist. ⟪zeroBacklog
	// B1⟫ the root also admits the framework's embed-text ids under it (embedTextDerivation: root + '/' + 'embedText/' + sha256),
	// and nothing looser: a walk node still matches only a native CURIE.
	stableIdPattern: Object.freeze({ pattern: `^(${ROOT_STABLE_ID}(/${EMBED_TEXT_PATH_SEGMENT}[0-9a-f]{64})?|(${vocabularyProfile.nativePrefixList.join('|')}):[A-Za-z0-9_]+)$`, trimmed: true }),
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
	// ⟪zeroBacklog B1, R3-F1⟫ the CTDL hub's search population for embedTextVote-v1 (R-BR-9: the hub's texts of classes,
	// properties and option sets). P1/P2 declared none (ruling Q3, the oracle's node set); the text nodes are framework nodes
	// outside the round trip, as every embed-text forge's are. name + description only: description already IS the July fallback chain
	// (dct:description, else rdfs:comment, else skos:definition — descriptionSource above), so rdfsComment would re-embed a
	// secondary text and usageNote is carried on too few nodes to be a search text. DmeOptionValue is left out: embedTextVote-v1
	// searches classes, properties and option sets only, so value texts would be embedded and never searched.
	// Declaring this MOVES the CTDL base block id (named in the B1 gate report).
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'CtdlEmbedText',
		textPropertyListByRole: Object.freeze({
			DmeClass: Object.freeze(['name', 'description']),
			DmeProperty: Object.freeze(['name', 'description']),
			DmeOptionSet: Object.freeze(['name', 'description']),
		}),
	}),
	hubAnchorAbsentSentinelList: Object.freeze([]),
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
