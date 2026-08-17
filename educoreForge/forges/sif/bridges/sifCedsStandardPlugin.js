'use strict';

// sifCedsStandardPlugin.js — the SIF → CEDS bridge PLUGIN on the Bridge Framework (SPEC-bridgeFramework-v1.md
// §11 — the sketch and THE COMPOSABILITY PROOF; RULINGS P5–P7, R9, R10, BF7, BF13; Profile v1.0.6). The SECOND
// real instance of the plugin shape, and the one whose whole point is that the framework did not move to admit
// it: this file, a recipe, and acceptance data are the entire diff. It exports EXACTLY
// { bridgeDeclaration, bridgeHooks } — a frozen declaration object (DATA) and the two hooks the
// SOURCE_ACQUISITION_REGISTRY's `standard` row requires.
//
// WHAT DIFFERS FROM THE Ed-Fi PLUGIN IS ALL DATA (SPEC §11, "what differs, what is shared"):
//   matchBasis 'standard' not 'crosswalk' — the STANDARD ITSELF names its CEDS target, in its own published
//   bytes, so there is no third-party crosswalk document; ONE forgedGraph channel instead of two document
//   channels; ONE tuple field (canonicalKey) instead of two; a channel ASSERTION with a citation instead of a
//   label table; subject identity is the forged node itself instead of a three-column walk. What is SHARED is
//   everything the framework owns — resolution, cardinality, the judge, freezing, materialising, writing, SSSOM
//   export — INCLUDING the hub-owned remodel table, which 34 SIF elements reach through the same reference the
//   Ed-Fi plugin uses (RULING P11: referenced, never copied).
//
// THE SOURCE. SIF's own Implementation Specification carries a 'CEDS ID' column (column index 6 of the literal
// eight-column header, [code fact] forges/sif/lib/parser.js:97 `cedsId: (columns[6] || '').trim()`). The forge
// canonicalises that native value to a CEDS property anchor P###### through normalize.normalizeCedsCrossRef
// ([code fact] forges/sif/lib/normalize.js:93-101, 'P' + digits padded to six) and stamps it on the SifField
// node as `cedsId`, alongside `crossRefs` — a JSON STRING ([code fact] forgeSif.js:355
// `crossRefs: JSON.stringify(...)`, stamped universally, '[]' where there is no annotation) — and
// `cedsOriginalAnchorPropertyName`, which is an ARRAY ['CEDS ID'] ([code fact] forgeSif.js:120, 442), not the
// bare string SPEC §11's prose implies. Because cedsId arrives ALREADY P-prefixed, the canonicalKey transform is
// `identity`; `globalIdToPrefixedKey` would yield PP000534 (RULING BF13, REVIEW C6).
//
// walkSourceAssertions — reads every SifField node (role DmeProperty, [code fact] forgeSif.js:132) through the
//   WALK view of the ONE reader, which is the SOLE blinding exemption and exposes exactly the declared
//   channelPropertyList (RULING BF7). Each node is one assertion; a node carrying no anchor yields the channel's
//   '' sentinel and the FRAMEWORK drops and counts it (the Ed-Fi plugin's convention: the plugin reports
//   sentinelDropped 0 on its own channel BY DESIGN and lets the framework do the dropping). No resolution, no
//   filtering, no dedupe here — values pass through untouched.
//
// subjectStableIdFor — IDENTITY. The SifField IS the subject, 1:1, so there is no BR-138 walk to do and the hook
//   returns the node's own stableId. A hook that resolved anything here would be answering a question nobody
//   asked. The framework still verifies every returned stableId against the declared subject nodes and still
//   counts many-to-one and refuses subjectCollision — identity simply never produces either.

const path = require('path');
// the vocabulary's role NAMES the walk reads off the forged graph — the same frozen registry the forge wrote
// them from (identity, not copies); no framework, seam or driver module is required here (BG-CONTAIN)
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const { DME_ROLES } = vocabularyLib;

const CHANNEL_CEDS_ID = 'cedsIdColumn';
// the SifField node properties this channel declares — the walk may read these UNBLINDED and nothing else on the
// blinding list (RULING BF7). Two names, and the classification below covers exactly these two.
const NODE_PROPERTY = Object.freeze({ cedsId: 'cedsId', crossRefs: 'crossRefs' });
const ABSENT_ANCHOR_SENTINEL = '';

const bridgeDeclaration = Object.freeze({
	bridgeName: 'sifCedsStandardPlugin',
	standardKey: 'sif',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'standard',
	// THE PROVIDER (SSSOM mapping_provider names the PROVIDER, not the artifact — the same reading the B3 ruling
	// applied to CEDS): Access 4 Learning (A4L), publisher of the SIF Data Model Implementation Specification for
	// North America, whose element tables carry the CEDS ID column this plugin reads. The URL was fetched and
	// observed to resolve; it is not a placeholder and the exporter refuses one.
	mappingProvider: {
		url: 'https://data.a4l.org/sif-specifications-north-america/',
		verifiedBy: {
			sessionName: 'TWILIGHT_VALLEY',
			date: '2026-08-17',
			note: "A4L SIF Specifications (North America) page, HTTP 200 verified by curl on 2026-08-17 by the B4 builder; https://www.a4l.org (200) and https://files.a4l.org/Implementation/NA/4.3/ImplementationSpecification.xlsx (200) also resolve, https://specification.sifassociation.org/Implementation/NA/4.3/ does NOT (connection failure) and is deliberately not used. The forge's own source is the flattened TSV snapshot ImplementationSpecification_031326.tsv, whose 159 table names are set-identical to the published NA 4.3 spreadsheet (README_PROVENANCE.md, measured 2026-08-03); A4L is the provider of that specification.",
		},
	},
	// the STANDARD's own IRI: SIF's published target namespace, taken verbatim from the generated schema
	// ([code fact] publishedXsdCrossCheck/01/SIF_Message.xsd targetNamespace, version 4.3). For matchBasis
	// 'standard' this is the standard's own prefix, not a document's (SPEC §4.1).
	sourceCuriePrefix: { prefix: 'sif', iri: 'http://www.sifassociation.org/datamodel/na/4.x#' },
	subjectCuriePrefix: 'sif',
	sourceChannelList: [
		{
			channelKey: CHANNEL_CEDS_ID,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: [ABSENT_ANCHOR_SENTINEL], // a SifField with no CEDS annotation asserts nothing
			channelPropertyList: [NODE_PROPERTY.cedsId, NODE_PROPERTY.crossRefs],
			columnClassification: {
				// coverage over channelPropertyList, EXACTLY ONE list each (RULING BF6): 1 + 1 = 2
				subjectIdentityColumnList: [], // the node IS the subject; no column names it
				tupleFieldColumnList: [NODE_PROPERTY.cedsId],
				sourceLabelColumnList: [], // the standard states no per-row label — the assertion is the channel's
				carriedRecordColumnList: [NODE_PROPERTY.crossRefs], // the raw annotation, carried BY NAME
				evidenceOnlyColumnList: [],
				consistencyCheckColumnList: [],
				ignoredColumnList: [],
			},
		},
	],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' }, // 1:1, no walk (RULING P2, IMPL §2.2)
	tupleFieldColumnMap: {
		canonicalKey: { column: NODE_PROPERTY.cedsId, transform: 'identity' }, // ALREADY P-prefixed (RULING BF13)
	},
	// THE PREDICATE (BR-012, RULING P5, R9). SIF names a target and states no relation word anywhere, so the
	// plugin declares the ONE predicate the whole channel asserts, as data, WITH A CITATION of the source's own
	// documented column semantics. The citation is verified rather than assumed, and what the verification found
	// is recorded honestly below: the standard asserts BY ANNOTATION, not by prose. See the CITATION note under
	// the declaration for the full evidence and what was searched.
	predicateSource: {
		kind: 'channelAssertion',
		predicate: 'exactMatch',
		assertedBy: {
			documentName: 'ImplementationSpecification_031326',
			citation: "The SIF Implementation Specification asserts its CEDS alignment by ANNOTATION rather than by prose: it publishes NO sentence defining the CEDS ID column, in 4.3 or in any version since the column appeared in 4.0 (searched 2026-08-17: Introduction.html section 2 Document Conventions and DataModel.html sections 3.1.1-3.1.3, which define the Char and Type columns explicitly and contain zero occurrences of 'CEDS', across 4.0/4.1/4.2/4.3; References.html Appendix K cites CEDS nowhere; the published ImplementationSpecification.xlsx has no legend sheet and its shared-string table holds 'CEDS' exactly twice; the column header markup carries no link, title, footnote or legend anchor; A4L's own reader's guide at https://data.a4l.org/understanding-the-sif-specification/ walks the element table column by column and skips this one). In the forge's source snapshot the assertion is therefore the eight-column table header 'Name / Mandatory / Characteristics / Type / Description / XPath / CEDS ID / Format', repeated once per object table (159 occurrences, the only occurrences of 'CEDS' in the file). WHAT THE STANDARD DOES ASSERT, machine-readably and unambiguously, is in its own GENERATED artifact: SIF_Message.xsd 4.3 (publishedXsdCrossCheck/01, generated from the canonical authoring spreadsheet per ruling R-SF-6) carries, per element, '<xs:appinfo><sifChar>O</sifChar><privacyRating /><cedsId>001490</cedsId><cedsURL>https://ceds.ed.gov/element/001490</cedsURL></xs:appinfo>' — 5,265 such cedsId/cedsURL pairs, each resolving one SIF element to exactly ONE CEDS element page, unqualified. exactMatch is declared on that evidence (RULED SABLE_RIVER 2026-08-17, option (a); downgrading on the ABSENCE of hedging language was rejected as backwards). PUBLISHED PROSE FOUND ALONGSIDE, added per that ruling and recorded in full because it does not agree with itself: A4L's fact sheet at https://files.a4l.org/home/FactSheets/Unity_and_CEDS_2022.pdf says 4.3 'has an element-to-element mapping to CEDS (v9 & v10)'; A4L's release announcements say elements are 'aligned to' and 'align with' CEDS; and ONE in-spec element description (EvaluationRecommendationType/Code, https://files.a4l.org/Implementation/NA/4.3/CommonTypes.html) reads 'This element corresponds to the global CEDS Id 000102' — the weaker verb the downgrade rule names, but written into a single element's free-text description rather than about the column, and on an element whose CEDS column cell is EMPTY, so it does not describe the annotation this plugin reads. None of it is a column definition, and A4L publishes no wording that is.",
		},
	},
	// the SifField node's OWN properties, shown to the judge through the blinded evidence view; names as forged
	// ([code fact] forgeSif.js stamps xpath and characteristics as scalars; description is the node's own)
	evidenceColumnMap: { subject: ['description', 'xpath', 'characteristics'], assertion: [] },
	consistencyCheckColumnList: [], // the standard supplies ONLY the join key — nothing to cross-check it against
	segmentNormalisationRuleList: [], // no path to normalise: subject identity is the node
	remodelTableRef: 'ceds14PropertyRemodel', // the HUB-owned table, by REFERENCE (RULING P11) — 34 SIF elements reach it
	classSideRemodelTable: [], // BR-036 SHOULD; empty in v1, as for Ed-Fi
	// the five specification-declared mapping properties of the source's nodes (BR-090). SIF stamps the first
	// three ([code fact] forgeSif.js:120, 355, 442) and stamps NEITHER option-value name — SPEC §11's citation of
	// forgeSif.js:81 for those two is a spec error, verified and reported to the supervisor 2026-08-17, ruled:
	// declare all five anyway. Blinding a property no node carries is a no-op, and the five stay uniform across
	// both plugins so the blinding list reads as one contract rather than two dialects.
	blindingDeclaration: ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	// globalGuidanceList is ABSENT because globalGuidance is false (RULING BR4: REQUIRED iff the hook is true,
	// FORBIDDEN otherwise) — the same conditional the Ed-Fi plugin satisfies by omission
	compatibilityDeclarationList: [],
});

// ---------------------------------------------------------------------
// crossRefsFrom — the carried record. crossRefs is a JSON STRING on every forged node (RULING BF13), so the walk
// PARSES it. JSON.parse throws on malformed text; that throw is translated ONCE, here, into { error } for the
// callback channel — the same single-site boundary dispensation the Ed-Fi plugin's decodeBytes takes, and the
// only one in this file. A malformed carried record is a SOURCE fault: it is refused by name with the node that
// carries it, never quietly replaced with an empty list.
// ---------------------------------------------------------------------
const crossRefsFrom = ({ rawCrossRefs, stableId }) => {
	if (rawCrossRefs === undefined || rawCrossRefs === null) {
		// ABSENT IS ABSENT, AND IT IS COUNTED. The forge stamps crossRefs on every node it makes, so a node
		// without the property was forged by something older than that stamp. Yielding an empty list is the
		// honest reading of "no cross-references recorded" — but yielding it SILENTLY would let a whole graph
		// of unstamped nodes pass as a graph of nodes with nothing to say. The caller counts these and the run
		// says so out loud; the count is the difference between an absence and an unnoticed absence.
		return { crossRefList: [], propertyAbsent: true };
	}
	if (typeof rawCrossRefs !== 'string') {
		return { error: `sifCedsStandardPlugin: node '${stableId}' carries crossRefs as ${typeof rawCrossRefs}, not the JSON string the forge stamps — refused by name, never coerced` };
	}
	let parsed = null;
	let parseFault = null;
	try {
		parsed = JSON.parse(rawCrossRefs);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	if (parseFault !== null) {
		return { error: `sifCedsStandardPlugin: node '${stableId}' crossRefs is not parseable JSON (${parseFault}) — refused by name` };
	}
	if (!Array.isArray(parsed)) {
		return { error: `sifCedsStandardPlugin: node '${stableId}' crossRefs parsed to ${typeof parsed}, not the list the forge stamps — refused by name` };
	}
	return { crossRefList: parsed };
};

// rawAnchorTextOf — the anchor cell as the walk yields it: absent reads as the channel's '' sentinel, which the
// framework drops and counts. Never trimmed, never defaulted to anything but the DECLARED sentinel.
const rawAnchorTextOf = (anchorValue) => (anchorValue === undefined || anchorValue === null ? ABSENT_ANCHOR_SENTINEL : String(anchorValue));

// ---------------------------------------------------------------------
// walkSourceAssertions — the SOURCE WALK, once per run (§11)
// ---------------------------------------------------------------------
const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file — there is no path to be handed
	sourceReader.readSourceNodes({ roleList: [DME_ROLES.PROPERTY] }, (readError, nodeList) => {
		if (readError) {
			callback(`sifCedsStandardPlugin walkSourceAssertions: readSourceNodes: ${readError}`);
			return;
		}
		const assertionList = [];
		let anchoredCount = 0;
		let crossRefsPropertyAbsentCount = 0;
		let refusal = null;
		for (let nodeIndex = 0; nodeIndex < nodeList.length && refusal === null; nodeIndex++) {
			const oneNode = nodeList[nodeIndex];
			const carried = crossRefsFrom({ rawCrossRefs: oneNode.properties[NODE_PROPERTY.crossRefs], stableId: oneNode.stableId });
			if (carried.error) {
				refusal = carried.error;
				continue;
			}
			if (carried.propertyAbsent === true) {
				crossRefsPropertyAbsentCount += 1;
			}
			const rawAnchorText = rawAnchorTextOf(oneNode.properties[NODE_PROPERTY.cedsId]);
			if (rawAnchorText !== ABSENT_ANCHOR_SENTINEL) {
				anchoredCount += 1;
			}
			assertionList.push({
				channelKey: CHANNEL_CEDS_ID,
				subjectIdentity: { stableId: oneNode.stableId },
				rawTargetList: [{ sourceColumnName: NODE_PROPERTY.cedsId, rawValue: rawAnchorText }], // the standard names exactly one target per element
				tupleFieldValues: { canonicalKey: rawAnchorText }, // as READ; the identity transform is the declaration's
				sourcePredicate: null, // the predicate is the CHANNEL's declared assertion, not a per-row value
				sourceLabelByColumn: {}, // the standard states no per-row label
				sourceNoteByColumn: {},
				carriedRecord: { [NODE_PROPERTY.crossRefs]: carried.crossRefList },
				evidence: { subject: {}, assertion: {} }, // the node's own properties are read through the evidence view
				sourceLocator: { channelKey: CHANNEL_CEDS_ID, stableId: oneNode.stableId },
			});
		}
		if (refusal !== null) {
			callback(refusal);
			return;
		}
		xLog.status(`[sifCedsStandardPlugin] walked ${assertionList.length} SifField node(s) through forWalk(); ${anchoredCount} carry a CEDS anchor, ${assertionList.length - anchoredCount} carry none (the channel's '' sentinel — the framework drops and counts them); ${crossRefsPropertyAbsentCount} node(s) carry NO crossRefs property at all (the forge stamps it universally, so a non-zero count here means the graph predates that stamp — said out loud rather than read as "nothing to say")`);
		callback('', {
			assertionList,
			channelReport: {
				[CHANNEL_CEDS_ID]: { rowsRead: nodeList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 },
			},
		});
	});
};

// ---------------------------------------------------------------------
// subjectStableIdFor — IDENTITY: the forged SifField IS the subject (1:1, no BR-138 walk)
// ---------------------------------------------------------------------
const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader; // identity resolution opens nothing: the subject already names itself
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[sifCedsStandardPlugin] subjectStableIdFor: identity resolution over ${subjectIdentityList.length} distinct subject(s)`);
	callback('', { resolutionBySubjectKey });
};

const bridgeHooks = { walkSourceAssertions, subjectStableIdFor };

module.exports = { bridgeDeclaration, bridgeHooks };
