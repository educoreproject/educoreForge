'use strict';

// toyCrosswalkPlugin.js — the TOY crosswalk plugin (matchBasis 'crosswalk', document channel): the first
// instance of the plugin shape the Bridge Framework's gate suite runs hermetically (SPEC-bridgeFramework-v1.md
// §4, §13). It exports EXACTLY { bridgeDeclaration, bridgeHooks }: a declaration object (DATA) and the two
// required hooks. It parses its OWN verified bytes (a state-machine CSV reader that handles quoted embedded
// newlines and doubled quotes — the framework parses only the header row for coverage), yields EVERY row RAW
// (every id a row names, in row order; sentinel rows included — the framework drops and counts them), and
// resolves subjects by composing the forged stableId and CHECKING it exists through sourceReader.forWalk().
// It requires nothing forbidden, mints nothing, addresses nothing.

const fs = require('fs');

const CHANNEL_CROSSWALK = 'crosswalk';
const CHANNEL_DESCRIPTORS = 'descriptors';
const TARGET_SEPARATOR = ';';

const bridgeDeclaration = Object.freeze({
	bridgeName: 'toyCrosswalkPlugin',
	standardKey: 'toy',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'crosswalk',
	mappingProvider: { url: 'https://toy.example/crosswalk/v1', verifiedBy: { sessionName: 'FROZEN_STREAM', date: '2026-08-16', note: 'toy fixture — declared verified so the export path runs; a twin nulls it' } },
	sourceCuriePrefix: { prefix: 'toyCrosswalk', iri: 'https://toy.example/crosswalk/v1#' },
	subjectCuriePrefix: 'toy',
	sourceChannelList: [
		{
			channelKey: CHANNEL_CROSSWALK,
			sourceKind: 'document',
			tier: 'property',
			disposition: 'walk',
			relativePathFromBundleRoot: 'assets/standardSourceData/01/toyCrosswalk.csv',
			checksumListRelativePathFromBundleRoot: 'assets/standardSourceData/01/SHA256SUMS',
			encoding: 'utf-8',
			absentTargetSentinelList: ['000000'],
			columnClassification: {
				subjectIdentityColumnList: ['ToyEntity', 'ToyPath', 'ToyElementName'],
				tupleFieldColumnList: ['HubGlobalId', 'HubClassURI'],
				sourceLabelColumnList: ['MappingConfidence'],
				carriedRecordColumnList: ['MappingNotes'],
				evidenceOnlyColumnList: ['ElementDescription'],
				consistencyCheckColumnList: ['HubPropertyURI'],
				ignoredColumnList: ['LegacyColumn'],
			},
		},
		{
			channelKey: CHANNEL_DESCRIPTORS,
			sourceKind: 'document',
			tier: 'value',
			disposition: 'refuseByNameAndCount',
			relativePathFromBundleRoot: 'assets/standardSourceData/01/toyDescriptors.csv',
			checksumListRelativePathFromBundleRoot: 'assets/standardSourceData/01/SHA256SUMS',
			encoding: 'utf-8',
			absentTargetSentinelList: [''],
			headerColumnList: ['ToyEntity', 'ToyDescriptor', 'HubOptionId', 'Confidence'],
		},
	],
	subjectIdentity: { kind: 'columnTuple', columnList: ['ToyEntity', 'ToyPath', 'ToyElementName'] },
	tupleFieldColumnMap: {
		canonicalKey: { column: 'HubGlobalId', transform: 'globalIdToPrefixedKey' },
		domainId: { column: 'HubClassURI', transform: 'uriFragment' },
	},
	predicateSource: {
		kind: 'labelTable',
		column: 'MappingConfidence',
		table: {
			Yes: { disposition: 'predicate', predicate: 'exactMatch' },
			Partial: { disposition: 'predicate', predicate: 'closeMatch' },
			Maybe: { disposition: 'tentative', predicateIfPicked: 'closeMatch' },
			Skip: { disposition: 'refused', reason: 'the toy author decided not to map this row' },
			'Not in Hub': { disposition: 'sentinelOnly' },
		},
	},
	evidenceColumnMap: { subject: ['ElementDescription'], assertion: ['MappingNotes'] },
	consistencyCheckColumnList: [{ column: 'HubPropertyURI', transform: 'uriFragment', against: 'canonicalKey', disposition: 'refuse' }],
	segmentNormalisationRuleList: [{ appliesTo: 'entity', match: ' (TOY)', action: 'stripSuffix' }],
	remodelTableRef: 'toyRemodel',
	classSideRemodelTable: [],
	blindingDeclaration: ['hubAnchorId', 'crossRefs', 'hubAnchorOriginalPropertyName', 'hubOptionCode', 'hubOptionOriginalPropertyName'],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	globalGuidanceList: [],
	compatibilityDeclarationList: [],
});

// parseCsvText — RFC-4180 state machine: quotes, doubled quotes, embedded newlines, CRLF; returns rows of cells
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
	return rowList;
};

const rowObjectsFrom = (text) => {
	const rowList = parseCsvText(text);
	const headerList = rowList[0].map((oneName) => oneName.trim());
	return { headerList, rowObjectList: rowList.slice(1).map((oneRow) => headerList.reduce((soFar, oneName, columnIndex) => ({ ...soFar, [oneName]: oneRow[columnIndex] === undefined ? '' : oneRow[columnIndex] }), {})) };
};

// walkSourceAssertions — the SOURCE WALK, once per run
const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceReader; // a document walk opens nothing on the graph
	const crosswalkText = fs.readFileSync(sourceChannelPathByKey[CHANNEL_CROSSWALK], 'utf8');
	const descriptorText = fs.readFileSync(sourceChannelPathByKey[CHANNEL_DESCRIPTORS], 'utf8');
	const crosswalk = rowObjectsFrom(crosswalkText);
	const descriptors = rowObjectsFrom(descriptorText);
	const assertionList = [];
	let malformedRows = 0;
	crosswalk.rowObjectList.forEach((oneRow, rowIndex) => {
		if (crosswalk.headerList.some((oneName) => oneRow[oneName] === undefined)) {
			malformedRows += 1;
			return;
		}
		const rawTargetList = String(oneRow.HubGlobalId)
			.split(TARGET_SEPARATOR)
			.map((oneRaw) => oneRaw.trim())
			.filter((oneRaw, oneIndex, list) => oneRaw !== '' || list.length === 1)
			.map((oneRaw) => ({ sourceColumnName: 'HubGlobalId', rawValue: oneRaw }));
		const tupleFieldValues = { canonicalKey: oneRow.HubGlobalId };
		if (oneRow.HubClassURI !== '') {
			tupleFieldValues.domainId = oneRow.HubClassURI; // an empty cell is ABSENT (the key is omitted)
		}
		assertionList.push({
			channelKey: CHANNEL_CROSSWALK,
			subjectIdentity: { ToyEntity: oneRow.ToyEntity, ToyPath: oneRow.ToyPath, ToyElementName: oneRow.ToyElementName },
			rawTargetList,
			tupleFieldValues,
			sourcePredicate: null,
			sourceLabelByColumn: { MappingConfidence: oneRow.MappingConfidence },
			sourceNoteByColumn: { MappingNotes: oneRow.MappingNotes },
			carriedRecord: { MappingNotes: oneRow.MappingNotes },
			evidence: { subject: { ElementDescription: oneRow.ElementDescription }, assertion: { MappingNotes: oneRow.MappingNotes } },
			consistencyCheckValueByColumn: { HubPropertyURI: oneRow.HubPropertyURI },
			sourceLocator: { channelKey: CHANNEL_CROSSWALK, rowNumber: rowIndex + 2 },
		});
	});
	xLog.status(`[toyCrosswalkPlugin] walked ${assertionList.length} crosswalk row(s), ${descriptors.rowObjectList.length} descriptor row(s) (value tier, counted only)`);
	callback('', {
		assertionList,
		channelReport: {
			[CHANNEL_CROSSWALK]: { rowsRead: crosswalk.rowObjectList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows, valueTierRows: 0 },
			[CHANNEL_DESCRIPTORS]: { rowsRead: descriptors.rowObjectList.length, assertionsYielded: 0, sentinelDropped: 0, malformedRows: 0, valueTierRows: descriptors.rowObjectList.length },
		},
	});
};

// subjectStableIdFor — ONCE per run with the distinct subject list; composes the forged id from the identity
// (entity.element; a path through 'CourseOffering' walks to the Course leaf) and CHECKS it exists among the
// source nodes through the reader — a subject that names no node is unresolvable
const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	sourceReader.readSourceNodes({ roleList: ['property'] }, (readError, nodeList) => {
		if (readError) {
			callback(readError);
			return;
		}
		const knownStableIdSet = new Set(nodeList.map((oneNode) => oneNode.stableId));
		const resolutionBySubjectKey = {};
		subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
			const entity = String(subjectIdentity.ToyEntity).replace(/ \(TOY\)$/, '');
			const composed = `toy:property/${entity}.${subjectIdentity.ToyElementName}`;
			resolutionBySubjectKey[subjectKey] = knownStableIdSet.has(composed) ? { subjectStableId: composed } : { unresolvable: 'entityUnresolved', detail: `no forged node ${composed}` };
		});
		xLog.status(`[toyCrosswalkPlugin] resolved ${Object.keys(resolutionBySubjectKey).length} subject(s) against ${nodeList.length} property node(s)`);
		callback('', { resolutionBySubjectKey });
	});
};

const bridgeHooks = { walkSourceAssertions, subjectStableIdFor };

module.exports = { bridgeDeclaration, bridgeHooks };
