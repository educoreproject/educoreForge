'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// derivedIndexes.js — the DERIVED rows of uriContract: pure functions of write-once rows, so a resolver answers "computed
// relations" (TQ rulings Q3-Q5, 2026-10-26) without re-reading hundreds of megabytes per request (MEASURED: the goldWave3
// relationship and base blocks take ~6 s to scan whole; one CEDS base block is 475 MB). AMBER_JOURNEY's rule: derived tables are
// allowed when written from the immutable rows they summarise, marked derived, and rebuildable with a gate that the rebuild gives
// identical rows. They are written in the SAME transaction as their source rows, are write-once like every other table, and
// -rebuildUriContractIndexes recomputes them and REFUSES any difference (it fills a source that was never indexed; it never
// changes or removes a row).
//
//   derivedRowsForSchemaBlock(schemaBlock) → { elementRowList, hubCardRowList, answerEdgeRowList } | { error }
//       elementRowList     one row per standardBase node: where an element URI resolves, its parent, its definition text
//       hubCardRowList     one row per HubReference card (a base node labelled HubReference): the hub and domain listings
//       answerEdgeRowList  one row per answer edge of a relationship block (a SKOS match or DECLARED_CORRESPONDENCE edge whose
//                          target is a meaning card): what mappingsToMeaningFor and a question URI read
//   derivedRowsForLayerVersion({ layer, version, blockTextFor }) → { countRowList } | { error }
//       per standard and per hub: rows, mapped, abstained, read from the version's own member decision blocks
//   derivedRowsForDecisionBlock({ decisionBlockHash, frozenText }) → { blockFormRow, assertionRowList } | { error }
//       blockFormRow       what the resolver needs of the block as a whole: its form, its subject standard, its edge-shape fault
//       assertionRowList   one row per record the resolver can return from this block, abstentions included; depends on the block ALONE
//   derivedRowsForCuratedVersion({ decisionBlockHash, frozenText, layerKey, versionTag, standardList, hubList }) → { curatedAssertionIdRowList } | { error }
//       the R-c' id of each row of a stored curated set: these ids DEPEND ON THE LAYER VERSION, whose own standardList and hubList name
//       the standards, so they are keyed by it (zero rows for a set that carries record_id: its ids are its own)
//
// DEFINITION TEXT is the node's own property, verbatim, the first present of DEFINITION_PROPERTY_NAME_LIST (null if none).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));
const assertionIdentity = require(path.join(__dirname, '..', 'edc-uri', 'assertionIdentity'));
const materialiserLib = require(path.join(__dirname, '..', 'bridge-framework', 'materialiser'));

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const isPlainRecord = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const DEFINITION_PROPERTY_NAME_LIST = Object.freeze(['definition', 'description']);
const ANSWER_EDGE_TYPE_SET = new Set(Object.values(vocabularyLib.SKOS_EDGE_TYPES).concat([vocabularyLib.EDGE_TYPES.DECLARED_CORRESPONDENCE]));
const NO_TERM_FOUND_OBJECT_LIST = Object.freeze(['sssom:NoTermFound', 'https://w3id.org/sssom/NoTermFound']);
const NO_TERM_FOUND_OBJECT_ID = 'sssom:NoTermFound';
const NO_TERM_FOUND_PREDICATE_ID = 'skos:mappingRelation';
const OBJECT_SOURCE_VERSION_LINE_PREFIX = '#object_source_version: ';
const URI_CONTRACT_RULES = require(path.join(__dirname, 'uriContractRules.json'));
const NODE_JSON_DROPPED_FIELD_LIST = Object.freeze(['embedding', 'embeddingRef', 'embeddingModelVersion']);

const firstValueOf = (propertyValue) => (Array.isArray(propertyValue) ? propertyValue[0] : propertyValue);

// attemptParse — the ONE boundary where JSON.parse's throw becomes an error string
const attemptParse = (lineText) => {
	let parsed = null;
	let parseFault = '';
	try {
		parsed = JSON.parse(lineText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	return parseFault ? { error: parseFault } : { parsed };
};

const derivedRowsForSchemaBlock = (schemaBlock) => {
	const lineList = schemaBlock.text.split('\n').filter((oneLine) => oneLine.length > 0);
	const headerParse = attemptParse(lineList[0]);
	if (headerParse.error) {
		return { error: refusalText(`schema block ${schemaBlock.refId}: the header line is not JSON (${headerParse.error})`, 'derivedRowsForSchemaBlock') };
	}
	const header = headerParse.parsed;
	const elementRowList = [];
	const hubCardRowList = [];
	const answerEdgeIdentitySet = new Set();
	const answerEdgeRowList = [];
	const isBase = header.blockType === vocabularyLib.SCHEMA_BLOCK_KIND.STANDARD_BASE;
	const isRelationship = header.blockType === vocabularyLib.SCHEMA_BLOCK_KIND.RELATIONSHIP;
	if (!isBase && !isRelationship) {
		return { elementRowList, hubCardRowList, answerEdgeRowList };
	}
	const versionByStandardKey = isRelationship ? { [header.pairA]: String(header.pairAVersion), [header.pairB]: String(header.pairBVersion) } : {};
	for (let lineIndex = 1; lineIndex < lineList.length; lineIndex++) {
		const oneLine = lineList[lineIndex];
		const isNodeLine = isBase && oneLine.indexOf('"kind":"node"') !== -1;
		const isEdgeLine = isRelationship && oneLine.indexOf('"kind":"edge"') !== -1;
		if (!isNodeLine && !isEdgeLine) {
			continue;
		}
		const lineParse = attemptParse(oneLine);
		if (lineParse.error) {
			return { error: refusalText(`schema block ${schemaBlock.refId} line ${lineIndex + 1} is not JSON (${lineParse.error})`, 'derivedRowsForSchemaBlock') };
		}
		const record = lineParse.parsed;
		if (isNodeLine) {
			const properties = record.properties || {};
			const definitionName = DEFINITION_PROPERTY_NAME_LIST.find((propertyName) => isNonEmptyString(firstValueOf(properties[propertyName])));
			const parentStableId = firstValueOf(properties.parentId);
			const nodeForIndex = Object.keys(record).filter((fieldName) => NODE_JSON_DROPPED_FIELD_LIST.indexOf(fieldName) === -1 && fieldName !== 'kind').reduce((soFar, fieldName) => ({ ...soFar, [fieldName]: record[fieldName] }), {});
			// a CARD is a node LABELLED HubReference (lib/vocabulary EQUIVALENCE_NODE_LABELS), never "a stableId that parses as a meaning":
			// the HubDefinition node's id parses as one too (measured on goldWave3: .../CEDStandards/hub/hubDefinition/CEDS)
			const cardMeaning = Array.isArray(record.labels) && record.labels.indexOf(vocabularyLib.EQUIVALENCE_NODE_LABELS.HUB_REFERENCE) !== -1 ? edcUri.parse(record.stableId) : { error: 'not a HubReference card' };
			if (!cardMeaning.error && cardMeaning.kind === 'meaning') {
				const referenceTier = firstValueOf(properties.referenceTier);
				const definitionPropertyList = URI_CONTRACT_RULES.hubCardDefinitionPropertyListByTier[referenceTier];
				if (!Array.isArray(definitionPropertyList)) {
					return { error: refusalText(`schema block ${schemaBlock.refId}: card ${record.stableId} has referenceTier ${JSON.stringify(referenceTier)}, which hubCardDefinitionPropertyListByTier does not list`, 'lib/uri-contract/uriContractRules.json') };
				}
				const definitionPropertyName = definitionPropertyList.find((propertyName) => isNonEmptyString(firstValueOf(properties[propertyName])));
				const textOf = (propertyName) => (isNonEmptyString(firstValueOf(properties[propertyName])) ? firstValueOf(properties[propertyName]) : null);
				hubCardRowList.push({ schemaBlockRefId: schemaBlock.refId, meaningIri: record.stableId, hubSegment: cardMeaning.partByName.hubSegment, hubReleaseSegment: cardMeaning.partByName.hubReleaseSegment, hubName: textOf('hubName'), hubVersion: textOf('hubVersion'), label: textOf('name'), definition: definitionPropertyName === undefined ? null : firstValueOf(properties[definitionPropertyName]), propertyName: textOf('propertyName'), propertyKey: textOf('propertyKey'), referenceTier, domainId: textOf('domainId'), domainName: textOf('domainName'), domainUri: textOf('domainUri'), domainDefinition: textOf('domainDefinition') });
			}
			elementRowList.push({ schemaBlockRefId: schemaBlock.refId, standardName: record.ref.source, standardVersion: String(header.version), standardKey: header.standardKey, elementStableId: record.stableId, parentStableId: isNonEmptyString(parentStableId) ? parentStableId : null, definitionText: definitionName === undefined ? null : firstValueOf(properties[definitionName]), nodeJson: JSON.stringify(nodeForIndex) });
			continue;
		}
		if (!ANSWER_EDGE_TYPE_SET.has(record.type)) {
			continue;
		}
		const meaning = edcUri.parse(record.toRef.id);
		if (meaning.error || meaning.kind !== 'meaning') {
			continue;
		}
		const subjectStandardKey = record.fromRef.id.slice(0, record.fromRef.id.indexOf(':'));
		const decisionBlockHashValue = record.properties && Array.isArray(record.properties.decisionBlockHash) ? record.properties.decisionBlockHash[0] : null;
		const answerEdgeRow = { schemaBlockRefId: schemaBlock.refId, subjectStableId: record.fromRef.id, subjectStandardName: record.fromRef.source, subjectStandardVersion: versionByStandardKey[subjectStandardKey] === undefined ? null : versionByStandardKey[subjectStandardKey], meaningIri: record.toRef.id, hubSegment: meaning.partByName.hubSegment, hubName: record.toRef.source, hubVersion: meaning.partByName.hubReleaseSegment, relationType: record.type, decisionBlockHash: isNonEmptyString(decisionBlockHashValue) ? decisionBlockHashValue : null };
		const answerEdgeIdentityText = [answerEdgeRow.subjectStableId, answerEdgeRow.meaningIri, answerEdgeRow.relationType, answerEdgeRow.decisionBlockHash].join('\u0000');
		if (!answerEdgeIdentitySet.has(answerEdgeIdentityText)) {
			answerEdgeIdentitySet.add(answerEdgeIdentityText);
			answerEdgeRowList.push(answerEdgeRow);
		}
	}
	return { elementRowList, hubCardRowList, answerEdgeRowList };
};

// countsOfDecisionText(frozenText) → { rowCount, mappedCount, abstainedCount }: a judged block's records (mapped = it names an
// object), or a set's rows (abstained = sssom:NoTermFound)
const countsOfDecisionText = (frozenText) => {
	if (frozenText.charAt(0) === '{') {
		const recordList = JSON.parse(frozenText).decisionRecordList;
		const mappedCount = recordList.filter((oneRecord) => isNonEmptyString(oneRecord.objectStableId)).length;
		return { rowCount: recordList.length, mappedCount, abstainedCount: recordList.length - mappedCount };
	}
	const lineList = frozenText.split('\n').filter((oneLine) => oneLine.length > 0 && !oneLine.startsWith('#'));
	const objectIndex = lineList.length ? lineList[0].split('\t').indexOf('object_id') : -1;
	const rowList = lineList.slice(1);
	const abstainedCount = rowList.filter((oneLine) => NO_TERM_FOUND_OBJECT_LIST.indexOf(oneLine.split('\t')[objectIndex]) !== -1).length;
	return { rowCount: rowList.length, mappedCount: rowList.length - abstainedCount, abstainedCount };
};

const derivedRowsForLayerVersion = ({ layer, version, blockTextFor } = {}) => {
	const hubNameByHubKey = layer.hubList.reduce((soFar, oneHub) => ({ ...soFar, [oneHub.hubKey]: oneHub.hubName }), {});
	const countByScope = {};
	const addTo = (countScope, scopeName, counted) => {
		const scopeSlotText = `${countScope}\u0000${scopeName}`;
		const soFar = countByScope[scopeSlotText] || { layerKey: layer.layerKey, versionTag: version.administrationRecord.versionTag, countScope, scopeName, rowCount: 0, mappedCount: 0, abstainedCount: 0 };
		countByScope[scopeSlotText] = { ...soFar, rowCount: soFar.rowCount + counted.rowCount, mappedCount: soFar.mappedCount + counted.mappedCount, abstainedCount: soFar.abstainedCount + counted.abstainedCount };
	};
	for (let memberIndex = 0; memberIndex < version.memberBlockList.length; memberIndex++) {
		const { pairKey, decisionBlockHash } = version.memberBlockList[memberIndex];
		const [hubSide, standardSide] = pairKey.split('::');
		const hubKey = hubSide.slice(0, hubSide.indexOf('@'));
		const standardKey = standardSide.slice(0, standardSide.indexOf('@'));
		if (hubNameByHubKey[hubKey] === undefined || !isNonEmptyString(standardKey)) {
			return { error: refusalText(`layer '${layer.layerKey}' version '${version.administrationRecord.versionTag}' member ${pairKey} names hub '${hubKey}', which the layer's hubList does not list`, 'a member pairKey is <hubKey>@<version>::<standardKey>@<version>::...') };
		}
		const read = blockTextFor(decisionBlockHash);
		if (read.error || read.frozenText === null) {
			return { error: read.error || refusalText(`decision schema block ${decisionBlockHash} is not held`, 'a layer version\'s blocks are copied with it') };
		}
		const counted = countsOfDecisionText(read.frozenText);
		addTo('standard', standardKey, counted);
		addTo('hub', hubNameByHubKey[hubKey], counted);
	}
	return { countRowList: Object.keys(countByScope).sort().map((scopeSlotText) => countByScope[scopeSlotText]) };
};

// ---------------------------------------------------------------------
// THE ASSERTION INDEX (assertionIndex-110226): what the resolver reads instead of a whole decision block
// ---------------------------------------------------------------------

const hasMappedObject = (oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0;

const machineRowsFor = ({ decisionBlockHash, frozenText }) => {
	const blockParse = attemptParse(frozenText);
	if (blockParse.error) {
		return { error: refusalText(`decision schema block ${decisionBlockHash} is not JSON (${blockParse.error})`, 'derivedRowsForDecisionBlock') };
	}
	const block = blockParse.parsed;
	if (!isPlainRecord(block.header) || !Array.isArray(block.decisionRecordList)) {
		return { error: refusalText(`decision schema block ${decisionBlockHash} has no header and decisionRecordList`, 'a machine block is { header, decisionRecordList }') };
	}
	const { header } = block;
	const subjectStandardVersion = String(header.sourceVersion);
	const hubVersion = String(header.hubVersion);
	const blockFormRow = { decisionBlockHash, blockForm: 'machine', subjectStandardName: isNonEmptyString(header.sourceStandardName) ? header.sourceStandardName : null, subjectStandardVersion, edgeShapeFault: null, objectSourceVersionJson: null };
	const shapeLookup = materialiserLib.edgeShapeRowFor(block);
	if (shapeLookup.error) {
		return { blockFormRow: { ...blockFormRow, edgeShapeFault: shapeLookup.error }, assertionRowList: [] };
	}
	const assertionRowList = [];
	for (let recordIndex = 0; recordIndex < block.decisionRecordList.length; recordIndex++) {
		const oneRecord = block.decisionRecordList[recordIndex];
		const isMapped = hasMappedObject(oneRecord);
		const predicateCurie = isMapped ? shapeLookup.edgeShapeRow.sssomPredicateIdFor(oneRecord.predicate) : NO_TERM_FOUND_PREDICATE_ID;
		const objectStableId = isMapped ? oneRecord.objectStableId : NO_TERM_FOUND_OBJECT_ID;
		const subjectStableIdList = Array.from(new Set(oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList));
		for (let subjectIndex = 0; subjectIndex < subjectStableIdList.length; subjectIndex++) {
			const subjectStableId = subjectStableIdList[subjectIndex];
			const identity = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId, subjectStandardName: header.sourceStandardName, subjectStandardVersion, predicateCurie, objectStableId, objectStandardName: header.hubName, objectStandardVersion: hubVersion });
			if (identity.error) {
				return { error: refusalText(`decision schema block ${decisionBlockHash} record ${recordIndex}: no assertion id for subject ${JSON.stringify(subjectStableId)} (${identity.error})`, 'every subject a machine block holds can name its assertion') };
			}
			assertionRowList.push({
				decisionBlockHash,
				rowOrdinal: assertionRowList.length + 1,
				subjectStableId,
				assertionId: identity.assertionId,
				assertionRecordJson: isMapped ? JSON.stringify({ subjectStableId, judgedSubjectStableId: oneRecord.subjectStableId, predicate: oneRecord.predicate, objectStableId: oneRecord.objectStableId, resolution: oneRecord.resolution, confidence: oneRecord.confidence, mappingMethod: oneRecord.mappingMethod, judgeIdentity: oneRecord.judge && oneRecord.judge.judgeModel, subjectSource: header.sourceStandardName, subjectVersion: header.sourceVersion, objectSource: header.hubName, objectVersion: header.hubVersion }) : null,
				interpretationEntryJson: JSON.stringify({ assertionId: identity.assertionId, predicate: predicateCurie, object: objectStableId, hubName: header.hubName, hubVersion, resolution: oneRecord.resolution === undefined ? null : oneRecord.resolution, confidence: oneRecord.confidence === undefined ? null : oneRecord.confidence, judgedSubjectStableId: oneRecord.subjectStableId }),
			});
		}
	}
	return { blockFormRow, assertionRowList };
};

// setPartsOf(frozenText) → { columnList, lineList, objectSourceVersionText } | { error }: a stored set's table, its comment lines set aside
const setPartsOf = ({ decisionBlockHash, frozenText }) => {
	const allLineList = frozenText.split('\n');
	const objectVersionLine = allLineList.find((oneLine) => oneLine.startsWith(OBJECT_SOURCE_VERSION_LINE_PREFIX));
	const objectSourceVersionText = objectVersionLine === undefined ? null : objectVersionLine.slice(OBJECT_SOURCE_VERSION_LINE_PREFIX.length);
	const versionParse = objectSourceVersionText === null ? {} : attemptParse(objectSourceVersionText);
	if (versionParse.error) {
		return { error: refusalText(`decision schema block ${decisionBlockHash}: its object_source_version line is not JSON (${versionParse.error})`, 'derivedRowsForDecisionBlock') };
	}
	const tableLineList = allLineList.filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
	return { columnList: tableLineList.length ? tableLineList[0].split('\t') : [], lineList: tableLineList.slice(1), objectSourceVersionText };
};
// setRowOf — one row as the resolver serves it. Reduced over the COLUMNS when the set carries record_id and over the CELLS when it does
// not, as the two whole-block reads did: they differ only for a row with more cells than columns
const setRowOf = ({ columnList, oneLine, hasRecordId }) => {
	const cellList = oneLine.split('\t');
	return hasRecordId ? columnList.reduce((soFar, oneColumn, columnIndex) => ({ ...soFar, [oneColumn]: cellList[columnIndex] }), {}) : cellList.reduce((soFar, oneCell, cellIndex) => ({ ...soFar, [columnList[cellIndex]]: oneCell }), {});
};

const setRowsFor = ({ decisionBlockHash, frozenText }) => {
	const parts = setPartsOf({ decisionBlockHash, frozenText });
	if (parts.error) {
		return parts;
	}
	const hasRecordId = parts.columnList.indexOf('record_id') !== -1;
	const assertionRowList = [];
	for (let lineIndex = 0; lineIndex < parts.lineList.length; lineIndex++) {
		const oneRow = setRowOf({ columnList: parts.columnList, oneLine: parts.lineList[lineIndex], hasRecordId });
		if (!isNonEmptyString(oneRow.subject_id)) {
			return { error: refusalText(`decision schema block ${decisionBlockHash} row ${lineIndex + 1} has no subject_id`, 'every row of a stored set names its subject') };
		}
		assertionRowList.push({ decisionBlockHash, rowOrdinal: lineIndex + 1, subjectStableId: oneRow.subject_id, assertionId: isNonEmptyString(oneRow.record_id) ? oneRow.record_id : null, assertionRecordJson: JSON.stringify(oneRow), interpretationEntryJson: null });
	}
	return { blockFormRow: { decisionBlockHash, blockForm: hasRecordId ? 'setWithRecordId' : 'setWithoutRecordId', subjectStandardName: null, subjectStandardVersion: null, edgeShapeFault: null, objectSourceVersionJson: parts.objectSourceVersionText }, assertionRowList };
};

const derivedRowsForDecisionBlock = ({ decisionBlockHash, frozenText } = {}) => (frozenText.charAt(0) === '{' ? machineRowsFor({ decisionBlockHash, frozenText }) : setRowsFor({ decisionBlockHash, frozenText }));

const derivedRowsForCuratedVersion = ({ decisionBlockHash, frozenText, layerKey, versionTag, standardList, hubList } = {}) => {
	const parts = frozenText.charAt(0) === '{' ? { columnList: ['record_id'] } : setPartsOf({ decisionBlockHash, frozenText });
	if (parts.error) {
		return parts;
	}
	if (parts.columnList.indexOf('record_id') !== -1) {
		return { curatedAssertionIdRowList: [] };
	}
	const objectStandardVersion = parts.objectSourceVersionText === null ? undefined : JSON.parse(parts.objectSourceVersionText);
	const standardByStandardKey = standardList.reduce((soFar, oneStandard) => ({ ...soFar, [oneStandard.standardKey]: oneStandard }), {});
	const curatedAssertionIdRowList = [];
	for (let lineIndex = 0; lineIndex < parts.lineList.length; lineIndex++) {
		const oneRow = setRowOf({ columnList: parts.columnList, oneLine: parts.lineList[lineIndex], hasRecordId: false });
		const standard = isNonEmptyString(oneRow.subject_id) ? standardByStandardKey[oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':'))] : undefined;
		const identity = standard === undefined ? { error: 'a subject of no listed standard' } : assertionIdentity.curatedAssertionIdFor({ decisionBlockHash, subjectStableId: oneRow.subject_id, subjectStandardName: standard.standardName, subjectStandardVersion: oneRow.subject_source_version, predicateCurie: oneRow.predicate_id, objectStableId: oneRow.object_id, objectStandardName: hubList[0].hubName, objectStandardVersion, authorIdList: (oneRow.author_id || '').split('|').filter((oneAuthor) => oneAuthor.length) });
		if (!identity.error) {
			curatedAssertionIdRowList.push({ layerKey, versionTag, decisionBlockHash, rowOrdinal: lineIndex + 1, assertionId: identity.assertionId });
		}
	}
	return { curatedAssertionIdRowList };
};

module.exports = { derivedRowsForSchemaBlock, derivedRowsForLayerVersion, derivedRowsForDecisionBlock, derivedRowsForCuratedVersion, countsOfDecisionText, DEFINITION_PROPERTY_NAME_LIST, ANSWER_EDGE_TYPE_SET, NO_TERM_FOUND_OBJECT_LIST, NO_TERM_FOUND_OBJECT_ID, NO_TERM_FOUND_PREDICATE_ID, moduleName };
