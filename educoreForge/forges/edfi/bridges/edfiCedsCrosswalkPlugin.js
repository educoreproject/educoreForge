'use strict';

// edfiCedsCrosswalkPlugin.js — the Ed-Fi → CEDS bridge PLUGIN on the Bridge Framework (SPEC-bridgeFramework-v1.md
// §10 — the worked example; RULINGS P1–P4, P11, BF5, BF6, BF14, BF17, BR4; Profile v1.0.6). The FIRST real
// instance of the plugin shape the toy fixtures established (lib/bridge-framework/test/fixtures/toyBridge/…):
// it exports EXACTLY { bridgeDeclaration, bridgeHooks } — a frozen declaration object (DATA) and the two required
// hooks. matchBasis 'crosswalk', producerKind 'authored': the CEDS-authored Ed-Fi crosswalk (two CSVs under the
// forge's snapshot 04) is the SOURCE of the mapping assertions; the framework owns resolution, cardinality, the
// judge, freezing, materialising, writing and SSSOM export. This file mints nothing, addresses nothing, reads
// only what §10.1 declares (through the framework's channel paths and the walk view of ONE reader).
//
// A SIBLING of the forge under forges/edfi/bridges/ — it does not touch the forge (forgeEdfi.js, the declaration,
// the hooks, crosswalkCarrier.js stay as they are); it reads the crosswalk CSVs ITSELF (state-machine CSV parser
// handling quoted embedded newlines and doubled quotes; the framework parses only the header row for coverage).
//
// walkSourceAssertions — the property-tier Elements CSV (utf-8 with BOM, 27 columns, 1,666 rows) yields ONE
//   assertion per row, RAW: EVERY Global ID the row names (the crosswalk never packs two ids in one cell — the
//   cell is yielded verbatim as one target, never split), the sentinel rows (000000) INCLUDED — the framework
//   drops and counts them (sentinelDropped is 0 on this channel's report BY DESIGN, DEVLOG deviation (i)); the
//   subject triple AS READ; tuple values as read (an empty class-URI cell = the field ABSENT, never ''); the
//   confidence label raw; the notes and evidence columns; consistency-check values raw. The value-tier
//   Descriptors CSV (latin1, 18 columns after the index-8 header override, 8,310 rows) is walked ONLY to COUNT:
//   valueTierRows = the rows carrying a real CEDSGlobalId (5,970 [measured]), sentinelDropped = the rows whose
//   CEDSGlobalId is the blank sentinel (2,340) — refused by name and counted (BR-080, BR-134, RULING D-S9);
//   the plugin yields NO assertion from it. Reconciliation per channel:
//   rowsRead === assertionsYielded + sentinelDropped + malformedRows + valueTierRows.
//
// subjectStableIdFor — the BR-138 WALK (§10.3), ONCE per run over the distinct subject list, against the Ed-Fi
//   forged graph read through the walk view (constructs + properties + the SUBCLASS_OF / REFERENCES /
//   REFERENCES_TYPE / HAS_OPTION_SET edges among the source): entity construct → per path segment either a BASE
//   construct on the SUBCLASS_OF chain or the property `owningConstructName.segment` (on the last segment also
//   the element name minus 'Descriptor') → follow the reference edge when not last → the last property is the
//   LEAF; subjectStableId = leaf.stableId. The declared segmentNormalisationRuleList (§10.1) is CONSUMED HERE
//   as data (' (TPDM)' off the entity, ' - DEPRECATED' / ' (from TPDM)' off a segment, the Descriptor
//   inversion on the last segment) — the walk keeps the identity triple RAW so the rule is live, not dead.
//   Anything not exactly one → { unresolvable: 'entityUnresolved' | 'segmentUnresolved', detail }. Merged
//   subjects with DIFFERENT targets are refused by the FRAMEWORK as subjectCollision (§10.3 measured: 7 leaves /
//   31 subjects) — the hook returns the leaf, the framework compares target sets.

const fs = require('fs');
const path = require('path');
// the vocabulary's role / edge-type NAMES the walk reads off the forged graph — the same frozen registry the
// forge wrote them from (identity, not copies); no framework or driver module is required here (BG-CONTAIN)
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const { DME_ROLES, EDGE_TYPES } = vocabularyLib;

const CHANNEL_ELEMENTS = 'elements';
const CHANNEL_DESCRIPTORS = 'descriptors';
const ELEMENTS_ENCODING = 'utf-8';
const DESCRIPTORS_ENCODING = 'latin1';
const ELEMENTS_SENTINEL_LIST = Object.freeze(['000000']);
const DESCRIPTORS_SENTINEL_LIST = Object.freeze(['']);
const PATH_SEGMENT_SEPARATOR = '.';
const DESCRIPTOR_SUFFIX = 'Descriptor';

// the descriptors CSV header AFTER headerOverrideByIndex { 8: 'EdFiElementDescription' } — the raw file carries
// `EdFiDescription` at index 4 AND 8 [measured]; the framework verifies this list against the file, count AND
// names, AFTER the override (RULING BR5; B2 holdings 13)
const DESCRIPTORS_HEADER_AFTER_OVERRIDE = Object.freeze([
	'EdFiVersionNumber',
	'EdFiNamespace',
	'EdFiCodeValue',
	'EdFiShortDescription',
	'EdFiDescription',
	'EdFiElementName',
	'EdFiEntity',
	'EdFiPath',
	'EdFiElementDescription',
	'CEDSElementName',
	'CEDSGlobalId',
	'CEDSOptionCode',
	'CEDSOptionDescription',
	'CEDSOptionDefinition',
	'CEDSDataType',
	'OptionSetMatchConfidence',
	'ElementMatchConfidence',
	'Notes',
]);

// the column names the walk reads — every one is classified in the elements channel below (coverage is the
// framework's check; these constants are the plugin's own references into that classification)
const COLUMN = Object.freeze({
	entity: 'EdFiEntity',
	entityPath: 'EdFiEntityPath',
	elementName: 'EdFiElementName',
	elementType: 'EdFiElementType',
	required: 'EdFiRequired',
	elementDescription: 'EdFiElementDescription',
	entityDescription: 'EdFiEntityDescription',
	cedsElementName: 'CEDSElementName',
	cedsElementType: 'CEDSElementType',
	cedsElementDefinition: 'CEDSElementDefinition',
	cedsGlobalId: 'CEDSGlobalId',
	cedsMappingNotes: 'CEDSMappingNotes',
	cedsMappingConfidence: 'CEDSMappingConfidence',
	classUri: 'CEDSOntologyClassURI',
	classLabel: 'CEDSOntologyClassLabel',
	conceptSchemeUri: 'CEDSOntologyConceptSchemeURI',
	conceptSchemeLabel: 'CEDSOntologyConceptSchemeLabel',
	propertyUri: 'CEDSOntologyPropertyURI',
	propertyLabel: 'CEDSOntologyPropertyLabel',
	propertyNotation: 'CEDSOntologyPropertyNotation',
	propertyRangeIncludes: 'CEDSOntologyPropertyRangeIncludes',
});
const DESCRIPTOR_COLUMN = Object.freeze({ cedsGlobalId: 'CEDSGlobalId', cedsOptionCode: 'CEDSOptionCode' });

const bridgeDeclaration = Object.freeze({
	bridgeName: 'edfiCedsCrosswalkPlugin',
	standardKey: 'edfi',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'crosswalk',
	// the PROVIDER (SSSOM mapping_provider names the provider, not the artifact): CEDS. The crosswalk has NO public URL —
	// it arrived by email from CEDS staff (Nathan Clinton, AEM Corp — the CEDS contractor), subject "EdFi to CEDS
	// Mapping", 2026-03-25 11:59:07, and is recorded as such in snapshot 04's README_PROVENANCE.md (RULING SABLE_RIVER
	// 2026-08-16 19:21 CDT, "Ed-Fi crosswalk PROVENANCE — settled"). It maps to CEDS Ontology V13 (the sender's own
	// words); the hub is CEDS 14 — the class-URI drift the classifier reports (M3, 20 keys) is the V13→V14 remodel.
	mappingProvider: {
		url: 'https://ceds.ed.gov/',
		verifiedBy: {
			sessionName: 'SABLE_RIVER',
			date: '2026-08-16',
			note: 'artifact received by email from CEDS staff (Nathan Clinton, AEM Corp), 2026-03-25 11:59:07, subject "EdFi to CEDS Mapping", message-id DS5PR15MB7006050B2125F9034B27D4A09D49A@DS5PR15MB7006.namprd15.prod.outlook.com, body verbatim: "Here is our mapping, both at the element level and enumeration level. This covers ALL of EdFi and maps to CEDS Ontology V13." — repo copy byte-identical (elements file md5 79b5f0eb4df954b0977facab69eac3e9); not part of any Ed-Fi distribution; CEDS is the PROVIDER',
		},
	},
	// the crosswalk DOCUMENT's IRI: the snapshot we actually read (a URN naming the forge's own snapshot 04 input),
	// never a guessed publisher URL — this is what `subject_match_field` prefixes name (Profile §4.5, amendment 13)
	sourceCuriePrefix: { prefix: 'edfiCedsCrosswalk', iri: 'urn:educore:edfi:standardSourceData:04:cedsAuthoredCrosswalk#' },
	subjectCuriePrefix: 'edfi',
	sourceChannelList: [
		{
			channelKey: CHANNEL_ELEMENTS,
			sourceKind: 'document',
			tier: 'property',
			disposition: 'walk',
			relativePathFromBundleRoot: 'assets/standardSourceData/04/cedsAuthoredCrosswalk/EdFiEntityElementsToCEDS.csv',
			checksumListRelativePathFromBundleRoot: 'assets/standardSourceData/04/SHA256SUMS',
			encoding: ELEMENTS_ENCODING,
			absentTargetSentinelList: ELEMENTS_SENTINEL_LIST.slice(), // 27 columns, 1,666 rows, 1,179 real ids, 487 sentinel [measured]
			columnClassification: {
				// EVERY one of the 27 header columns in EXACTLY ONE list (RULING BF6): 3 + 2 + 1 + 7 + 6 + 2 + 6 = 27
				subjectIdentityColumnList: [COLUMN.entity, COLUMN.entityPath, COLUMN.elementName],
				tupleFieldColumnList: [COLUMN.cedsGlobalId, COLUMN.classUri],
				sourceLabelColumnList: [COLUMN.cedsMappingConfidence],
				carriedRecordColumnList: [COLUMN.elementType, COLUMN.required, COLUMN.cedsElementType, COLUMN.cedsMappingNotes, COLUMN.conceptSchemeUri, COLUMN.conceptSchemeLabel, COLUMN.propertyRangeIncludes],
				evidenceOnlyColumnList: [COLUMN.elementDescription, COLUMN.entityDescription, COLUMN.cedsElementName, COLUMN.cedsElementDefinition, COLUMN.classLabel, COLUMN.propertyLabel],
				consistencyCheckColumnList: [COLUMN.propertyUri, COLUMN.propertyNotation],
				ignoredColumnList: ['CEDSDWTable', 'CEDSDWColumn', 'CEDSDWElementType', 'CEDSStagingTable', 'CEDSStagingColumn', 'CEDSStagingElementType'],
			},
		},
		{
			channelKey: CHANNEL_DESCRIPTORS,
			sourceKind: 'document',
			tier: 'value',
			disposition: 'refuseByNameAndCount', // EXEMPT from coverage; the header listed (after the override) for the count
			relativePathFromBundleRoot: 'assets/standardSourceData/04/cedsAuthoredCrosswalk/EdFiEntityDescriptorsToCEDS.csv',
			checksumListRelativePathFromBundleRoot: 'assets/standardSourceData/04/SHA256SUMS',
			encoding: DESCRIPTORS_ENCODING,
			absentTargetSentinelList: DESCRIPTORS_SENTINEL_LIST.slice(),
			headerOverrideByIndex: { 8: 'EdFiElementDescription' }, // `EdFiDescription` at index 4 AND 8 [measured]; crosswalkCarrier.js precedent
			headerColumnList: DESCRIPTORS_HEADER_AFTER_OVERRIDE.slice(), // 8,310 rows; 5,970 value-tier assertions counted and refused (BR-134)
		},
	],
	subjectIdentity: { kind: 'columnTuple', columnList: [COLUMN.entity, COLUMN.entityPath, COLUMN.elementName] }, // 1,146 subjects (BR-136)
	tupleFieldColumnMap: {
		canonicalKey: { column: COLUMN.cedsGlobalId, transform: 'globalIdToPrefixedKey' }, // 'P' + id (RULING BF14)
		domainId: { column: COLUMN.classUri, transform: 'uriFragment' }, // fragment after '#'; populated on 1,103 of 1,179 (BR-131)
	},
	predicateSource: {
		kind: 'labelTable',
		column: COLUMN.cedsMappingConfidence,
		table: {
			Yes: { disposition: 'predicate', predicate: 'exactMatch' }, // 1,046 rows
			Partial: { disposition: 'predicate', predicate: 'closeMatch' }, // 1
			Derived: { disposition: 'predicate', predicate: 'closeMatch' }, // 15 real-id (+10 sentinel, counted); matchBasis stays crosswalk (BR-047)
			Maybe: { disposition: 'tentative', predicateIfPicked: 'closeMatch' }, // 117 real-id (+4 sentinel) → JUDGED (RULING P3, D-S3)
			'Not in CEDS': { disposition: 'sentinelOnly' }, // 473 rows, ALL on the 000000 sentinel; on a real-target row the run is refused (RULING BF5)
		},
	},
	evidenceColumnMap: {
		subject: [COLUMN.elementDescription, COLUMN.entityDescription],
		assertion: [COLUMN.cedsElementName, COLUMN.cedsElementDefinition, COLUMN.cedsMappingNotes, COLUMN.classLabel, COLUMN.propertyLabel],
	},
	consistencyCheckColumnList: [
		{ column: COLUMN.propertyUri, transform: 'uriFragment', against: 'canonicalKey', disposition: 'refuse' }, // agrees 1,103/1,103 [measured]
		{ column: COLUMN.propertyNotation, transform: 'verbatim', against: 'card.propertyNotation', disposition: 'report' }, // 1,065 agree / 9 disagree (D-S10)
	],
	segmentNormalisationRuleList: [
		// consumed by subjectStableIdFor below (RULING BF17)
		{ appliesTo: 'entity', match: ' (TPDM)', action: 'stripSuffix' },
		{ appliesTo: 'segment', match: ' - DEPRECATED', action: 'stripSuffix' },
		{ appliesTo: 'segment', match: ' (from TPDM)', action: 'stripSuffix' },
		{ appliesTo: 'lastSegment', match: DESCRIPTOR_SUFFIX, action: 'invertDescriptor' },
	],
	remodelTableRef: 'ceds14PropertyRemodel', // hub-owned six-entry table, by REFERENCE (RULING P11, D-S5): forges/ceds/bridgeData/
	classSideRemodelTable: [], // BR-036 SHOULD; empty in v1 — the 27 P000590/P000591 @ C200257 subjects stay judged
	blindingDeclaration: ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'], // property nodes + option-value nodes [code fact] forgeEdfiContractGraph.js (RULING BF17, REVIEW C9)
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	// globalGuidanceList is ABSENT because globalGuidance is false (RULING BR4: REQUIRED iff the hook is true, FORBIDDEN otherwise)
	compatibilityDeclarationList: [],
});

// ---------------------------------------------------------------------
// CSV — an RFC-4180 state machine: quotes, doubled quotes, embedded newlines, CRLF; blank trailing line ignored
// ---------------------------------------------------------------------
const parseCsvText = (text) => {
	const rowList = [];
	let cellList = [];
	let cell = '';
	let inQuotes = false;
	const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	for (let charIndex = 0; charIndex < body.length; charIndex++) {
		const oneChar = body[charIndex];
		if (inQuotes) {
			if (oneChar === '"' && body[charIndex + 1] === '"') {
				cell += '"';
				charIndex++;
			} else if (oneChar === '"') {
				inQuotes = false;
			} else {
				cell += oneChar;
			}
		} else if (oneChar === '"') {
			inQuotes = true;
		} else if (oneChar === ',') {
			cellList.push(cell);
			cell = '';
		} else if (oneChar === '\n' || oneChar === '\r') {
			if (oneChar === '\r' && body[charIndex + 1] === '\n') {
				charIndex++;
			}
			cellList.push(cell);
			rowList.push(cellList);
			cellList = [];
			cell = '';
		} else {
			cell += oneChar;
		}
	}
	if (cell !== '' || cellList.length) {
		cellList.push(cell);
		rowList.push(cellList);
	}
	// a wholly empty line (a trailing newline's ghost) is not a data row
	return rowList.filter((oneRow) => !(oneRow.length === 1 && oneRow[0] === ''));
};

// decodeBytes — the declared encoding, FATAL on a byte that does not decode (the framework refused the channel
// earlier if the header failed to decode; the plugin holds the same line for the body: no U+FFFD substitution)
const decodeBytes = ({ filePath, encoding }) => new TextDecoder(encoding, { fatal: true }).decode(fs.readFileSync(filePath));

// rowRecordsFrom — header (with the channel's index override applied) + row objects; a row whose cell count
// differs from the header's is MALFORMED (counted, never guessed at)
const rowRecordsFrom = ({ text, headerOverrideByIndex }) => {
	const rowList = parseCsvText(text);
	const rawHeaderList = rowList[0].map((oneName) => oneName.trim());
	const headerList = rawHeaderList.map((oneName, oneIndex) => (headerOverrideByIndex[String(oneIndex)] === undefined ? oneName : headerOverrideByIndex[String(oneIndex)]));
	const recordList = [];
	let malformedRowCount = 0;
	rowList.slice(1).forEach((oneRow, rowIndex) => {
		if (oneRow.length !== headerList.length) {
			malformedRowCount += 1;
			return;
		}
		recordList.push({ rowNumber: rowIndex + 2, cellByColumnName: headerList.reduce((soFar, oneName, columnIndex) => ({ ...soFar, [oneName]: oneRow[columnIndex] }), {}) });
	});
	return { headerList, recordList, malformedRowCount };
};

const channelByKey = bridgeDeclaration.sourceChannelList.reduce((soFar, oneChannel) => ({ ...soFar, [oneChannel.channelKey]: oneChannel }), {});
const pickColumns = (cellByColumnName, columnNameList) => columnNameList.reduce((soFar, oneName) => ({ ...soFar, [oneName]: cellByColumnName[oneName] }), {});

// ---------------------------------------------------------------------
// walkSourceAssertions — the SOURCE WALK, once per run (§10.2)
// ---------------------------------------------------------------------
const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceReader; // a document walk opens nothing on the graph (the descriptor channel is counted, not resolved)
	const elementsChannel = channelByKey[CHANNEL_ELEMENTS];
	const descriptorsChannel = channelByKey[CHANNEL_DESCRIPTORS];
	const elements = rowRecordsFrom({ text: decodeBytes({ filePath: sourceChannelPathByKey[CHANNEL_ELEMENTS], encoding: elementsChannel.encoding }), headerOverrideByIndex: {} });
	const descriptors = rowRecordsFrom({ text: decodeBytes({ filePath: sourceChannelPathByKey[CHANNEL_DESCRIPTORS], encoding: descriptorsChannel.encoding }), headerOverrideByIndex: descriptorsChannel.headerOverrideByIndex });

	const assertionList = elements.recordList.map(({ rowNumber, cellByColumnName }) => {
		const tupleFieldValues = { canonicalKey: cellByColumnName[COLUMN.cedsGlobalId] };
		if (cellByColumnName[COLUMN.classUri] !== '') {
			tupleFieldValues.domainId = cellByColumnName[COLUMN.classUri]; // an empty cell is ABSENT (the key is omitted), never ''
		}
		return {
			channelKey: CHANNEL_ELEMENTS,
			subjectIdentity: pickColumns(cellByColumnName, bridgeDeclaration.subjectIdentity.columnList), // AS READ — the entity rule is applied in subjectStableIdFor
			rawTargetList: [{ sourceColumnName: COLUMN.cedsGlobalId, rawValue: cellByColumnName[COLUMN.cedsGlobalId] }], // the cell verbatim; the crosswalk never packs two ids in one cell [measured]
			tupleFieldValues,
			sourcePredicate: null, // the predicate comes from the declared label table
			sourceLabelByColumn: { [COLUMN.cedsMappingConfidence]: cellByColumnName[COLUMN.cedsMappingConfidence] },
			sourceNoteByColumn: { [COLUMN.cedsMappingNotes]: cellByColumnName[COLUMN.cedsMappingNotes] },
			carriedRecord: pickColumns(cellByColumnName, elementsChannel.columnClassification.carriedRecordColumnList),
			evidence: {
				subject: pickColumns(cellByColumnName, bridgeDeclaration.evidenceColumnMap.subject),
				assertion: pickColumns(cellByColumnName, bridgeDeclaration.evidenceColumnMap.assertion),
			},
			consistencyCheckValueByColumn: pickColumns(cellByColumnName, elementsChannel.columnClassification.consistencyCheckColumnList),
			sourceLocator: { channelKey: CHANNEL_ELEMENTS, rowNumber },
		};
	});

	// the VALUE tier: counted, never resolved (BR-080, BR-134). A row whose CEDSGlobalId is the blank sentinel is
	// sentinelDropped; every other row is a value-tier assertion, refused and counted by the framework
	const isDescriptorSentinel = (cellByColumnName) => descriptorsChannel.absentTargetSentinelList.indexOf(cellByColumnName[DESCRIPTOR_COLUMN.cedsGlobalId]) !== -1;
	const descriptorSentinelCount = descriptors.recordList.filter(({ cellByColumnName }) => isDescriptorSentinel(cellByColumnName)).length;
	const valueTierRowCount = descriptors.recordList.length - descriptorSentinelCount;
	const valueTierRowsLackingOptionCode = descriptors.recordList.filter(({ cellByColumnName }) => !isDescriptorSentinel(cellByColumnName) && cellByColumnName[DESCRIPTOR_COLUMN.cedsOptionCode] === '').length;

	xLog.status(`[edfiCedsCrosswalkPlugin] walked ${assertionList.length} elements row(s) (${elements.malformedRowCount} malformed); descriptors: ${descriptors.recordList.length} row(s) = ${valueTierRowCount} value-tier (refused by name, counted; ${valueTierRowsLackingOptionCode} of them lack a CEDSOptionCode) + ${descriptorSentinelCount} blank-target sentinel (${descriptors.malformedRowCount} malformed)`);
	callback('', {
		assertionList,
		channelReport: {
			[CHANNEL_ELEMENTS]: { rowsRead: elements.recordList.length + elements.malformedRowCount, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: elements.malformedRowCount, valueTierRows: 0 },
			[CHANNEL_DESCRIPTORS]: { rowsRead: descriptors.recordList.length + descriptors.malformedRowCount, assertionsYielded: 0, sentinelDropped: descriptorSentinelCount, malformedRows: descriptors.malformedRowCount, valueTierRows: valueTierRowCount },
		},
	});
};

// ---------------------------------------------------------------------
// subjectStableIdFor — the BR-138 walk (§10.3), ONCE per run
// ---------------------------------------------------------------------

// the property-bearing construct families the entity rule searches (§10.3 rule 1) — DATA; extension constructs
// are EXCLUDED by name (their properties already carry the extendee's owningConstructName), as are the
// domain / subdomain / interchange support constructs
const ENTITY_CONSTRUCT_TYPE_LIST = Object.freeze(['domainEntity', 'domainEntitySubclass', 'association', 'associationSubclass', 'abstractEntity', 'common', 'commonSubclass', 'inlineCommon', 'choice']);
const WALK_EDGE_TYPE_LIST = Object.freeze([EDGE_TYPES.SUBCLASS_OF, EDGE_TYPES.REFERENCES, EDGE_TYPES.REFERENCES_TYPE, EDGE_TYPES.HAS_OPTION_SET]);
const REFERENCE_EDGE_TYPE_LIST = Object.freeze([EDGE_TYPES.REFERENCES, EDGE_TYPES.REFERENCES_TYPE, EDGE_TYPES.HAS_OPTION_SET]);

// the segment-rule ACTIONS as a registry (never a branch on the action name): each takes the text and the rule,
// returns the rewritten text
const SEGMENT_RULE_ACTION_REGISTRY = Object.freeze({
	stripSuffix: (text, rule) => (text.endsWith(rule.match) ? text.slice(0, text.length - rule.match.length) : text),
	stripPrefix: (text, rule) => (text.startsWith(rule.match) ? text.slice(rule.match.length) : text),
	// invertDescriptor is applied to the ELEMENT NAME on the last segment (the carrier's inversion): the alternative
	// property name to try is the element name without its trailing 'Descriptor'
	invertDescriptor: (text, rule) => (text.endsWith(rule.match) ? text.slice(0, text.length - rule.match.length) : text),
});
const applyRulesFor = (appliesTo, text) =>
	bridgeDeclaration.segmentNormalisationRuleList.filter((oneRule) => oneRule.appliesTo === appliesTo).reduce((soFar, oneRule) => SEGMENT_RULE_ACTION_REGISTRY[oneRule.action](soFar, oneRule), text);

const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	sourceReader.readSourceNodes({ roleList: [DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_SET, DME_ROLES.SUPPORT] }, (nodeError, nodeList) => {
		if (nodeError) {
			callback(`edfiCedsCrosswalkPlugin subjectStableIdFor: readSourceNodes: ${nodeError}`);
			return;
		}
		sourceReader.readEdgesAmongSource({ edgeTypeList: WALK_EDGE_TYPE_LIST.slice() }, (edgeError, edgeList) => {
			if (edgeError) {
				callback(`edfiCedsCrosswalkPlugin subjectStableIdFor: readEdgesAmongSource: ${edgeError}`);
				return;
			}
			// indexes over the walk view (declared, unblinded properties only: role, name, constructType, owningConstructName)
			const nodeByStableId = {};
			const constructListByName = {};
			const propertyListByOwnerAndName = {};
			nodeList.forEach((oneNode) => {
				nodeByStableId[oneNode.stableId] = oneNode;
				const role = oneNode.properties.role;
				if (role === DME_ROLES.PROPERTY) {
					const ownerAndName = `${oneNode.properties.owningConstructName}${PATH_SEGMENT_SEPARATOR}${oneNode.properties.name}`;
					(propertyListByOwnerAndName[ownerAndName] = propertyListByOwnerAndName[ownerAndName] || []).push(oneNode);
				} else if (role === DME_ROLES.CLASS || role === DME_ROLES.OPTION_SET || role === DME_ROLES.SUPPORT) {
					(constructListByName[oneNode.properties.name] = constructListByName[oneNode.properties.name] || []).push(oneNode);
				}
			});
			const subclassBaseListByStableId = {};
			const referenceTargetListByStableId = {};
			edgeList.forEach((oneEdge) => {
				if (oneEdge.type === EDGE_TYPES.SUBCLASS_OF) {
					(subclassBaseListByStableId[oneEdge.fromStableId] = subclassBaseListByStableId[oneEdge.fromStableId] || []).push(oneEdge.toStableId);
				} else if (REFERENCE_EDGE_TYPE_LIST.indexOf(oneEdge.type) !== -1) {
					(referenceTargetListByStableId[oneEdge.fromStableId] = referenceTargetListByStableId[oneEdge.fromStableId] || []).push(oneEdge.toStableId);
				}
			});
			// the SUBCLASS_OF chain of a construct: base, base's base, … (a chain that loops is cut at the first repeat)
			const baseChainOf = (constructStableId) => {
				const chain = [];
				const seen = new Set([constructStableId]);
				let frontier = subclassBaseListByStableId[constructStableId] || [];
				while (frontier.length) {
					const nextFrontier = [];
					frontier.forEach((oneBaseStableId) => {
						if (!seen.has(oneBaseStableId)) {
							seen.add(oneBaseStableId);
							chain.push(oneBaseStableId);
							(subclassBaseListByStableId[oneBaseStableId] || []).forEach((oneFurther) => nextFrontier.push(oneFurther));
						}
					});
					frontier = nextFrontier;
				}
				return chain;
			};

			const resolutionBySubjectKey = {};
			const tally = { resolved: 0, entityUnresolved: 0, segmentUnresolved: 0, ownedByEntity: 0, underReferencedConstruct: 0 };
			subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
				const entityName = applyRulesFor('entity', String(subjectIdentity[COLUMN.entity]));
				const elementName = String(subjectIdentity[COLUMN.elementName]);
				const segmentList = String(subjectIdentity[COLUMN.entityPath])
					.split(PATH_SEGMENT_SEPARATOR)
					.map((oneSegment) => applyRulesFor('segment', oneSegment));
				// rule 1 — the entity construct: exactly one property-bearing construct of that name
				const entityCandidateList = (constructListByName[entityName] || []).filter((oneNode) => ENTITY_CONSTRUCT_TYPE_LIST.indexOf(oneNode.properties.constructType) !== -1);
				if (entityCandidateList.length !== 1) {
					resolutionBySubjectKey[subjectKey] = { unresolvable: 'entityUnresolved', detail: `entity '${entityName}' names ${entityCandidateList.length} property-bearing construct(s) (${entityCandidateList.map((oneNode) => oneNode.stableId).join(', ') || 'none'})` };
					tally.entityUnresolved += 1;
					return;
				}
				// rule 2 — walk the segments
				let currentConstruct = entityCandidateList[0];
				let leafProperty = null;
				let failure = null;
				for (let segmentIndex = 0; segmentIndex < segmentList.length && failure === null; segmentIndex++) {
					const oneSegment = segmentList[segmentIndex];
					const isLast = segmentIndex === segmentList.length - 1;
					const baseOnChain = baseChainOf(currentConstruct.stableId).filter((oneBaseStableId) => nodeByStableId[oneBaseStableId] !== undefined && nodeByStableId[oneBaseStableId].properties.name === oneSegment);
					if (baseOnChain.length === 1) {
						currentConstruct = nodeByStableId[baseOnChain[0]];
						if (isLast) {
							failure = `last segment '${oneSegment}' names a base construct, not a property`;
						}
						continue;
					}
					const ownerName = currentConstruct.properties.name;
					let candidateList = propertyListByOwnerAndName[`${ownerName}${PATH_SEGMENT_SEPARATOR}${oneSegment}`] || [];
					if (isLast && candidateList.length !== 1) {
						const invertedName = applyRulesFor('lastSegment', elementName);
						const invertedList = invertedName === elementName ? [] : propertyListByOwnerAndName[`${ownerName}${PATH_SEGMENT_SEPARATOR}${invertedName}`] || [];
						candidateList = candidateList.length === 0 ? invertedList : candidateList;
					}
					if (candidateList.length !== 1) {
						failure = `segment '${oneSegment}' (${segmentIndex + 1} of ${segmentList.length}) under '${ownerName}' names ${candidateList.length} property node(s)${candidateList.length ? ` (${candidateList.map((oneNode) => oneNode.stableId).join(', ')})` : ''}`;
						continue;
					}
					const property = candidateList[0];
					if (isLast) {
						leafProperty = property;
						continue;
					}
					const targetList = (referenceTargetListByStableId[property.stableId] || []).filter((oneTargetStableId) => nodeByStableId[oneTargetStableId] !== undefined);
					if (targetList.length !== 1) {
						failure = `segment '${oneSegment}' resolved to ${property.stableId}, which references ${targetList.length} construct(s) — a non-last segment must reference exactly one`;
						continue;
					}
					currentConstruct = nodeByStableId[targetList[0]];
				}
				if (failure !== null || leafProperty === null) {
					resolutionBySubjectKey[subjectKey] = { unresolvable: 'segmentUnresolved', detail: failure === null ? 'the path yielded no leaf property' : failure };
					tally.segmentUnresolved += 1;
					return;
				}
				// rule 3 — the leaf
				resolutionBySubjectKey[subjectKey] = { subjectStableId: leafProperty.stableId };
				tally.resolved += 1;
				if (leafProperty.properties.owningConstructName === entityName) {
					tally.ownedByEntity += 1;
				} else {
					tally.underReferencedConstruct += 1;
				}
			});
			xLog.status(`[edfiCedsCrosswalkPlugin] subjectStableIdFor: ${subjectIdentityList.length} subject(s) → ${tally.resolved} resolved (${tally.ownedByEntity} owned by the entity, ${tally.underReferencedConstruct} under a referenced construct), ${tally.entityUnresolved} entityUnresolved, ${tally.segmentUnresolved} segmentUnresolved — over ${nodeList.length} source node(s), ${edgeList.length} walk edge(s)`);
			callback('', { resolutionBySubjectKey });
		});
	});
};

const bridgeHooks = { walkSourceAssertions, subjectStableIdFor };

module.exports = { bridgeDeclaration, bridgeHooks };
