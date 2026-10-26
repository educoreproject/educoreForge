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
//       hubCardRowList     one row per HubReference card (a base node whose stableId parses as a meaning): the hub and domain listings
//       answerEdgeRowList  one row per answer edge of a relationship block (a SKOS match or DECLARED_CORRESPONDENCE edge whose
//                          target is a meaning card): what mappingsToMeaningFor and a question URI read
//   derivedRowsForLayerVersion({ layer, version, blockTextFor }) → { countRowList } | { error }
//       per standard and per hub: rows, mapped, abstained, read from the version's own member decision blocks
//
// DEFINITION TEXT is the node's own property, verbatim, the first present of DEFINITION_PROPERTY_NAME_LIST (null if none).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const DEFINITION_PROPERTY_NAME_LIST = Object.freeze(['definition', 'description']);
const ANSWER_EDGE_TYPE_SET = new Set(Object.values(vocabularyLib.SKOS_EDGE_TYPES).concat([vocabularyLib.EDGE_TYPES.DECLARED_CORRESPONDENCE]));
const NO_TERM_FOUND_OBJECT_LIST = Object.freeze(['sssom:NoTermFound', 'https://w3id.org/sssom/NoTermFound']);
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
	const answerEdgeKeySet = new Set();
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
			const cardMeaning = edcUri.parse(record.stableId);
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
		const answerEdgeKey = [answerEdgeRow.subjectStableId, answerEdgeRow.meaningIri, answerEdgeRow.relationType, answerEdgeRow.decisionBlockHash].join('\u0000');
		if (!answerEdgeKeySet.has(answerEdgeKey)) {
			answerEdgeKeySet.add(answerEdgeKey);
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
		const scopeKey = `${countScope}\u0000${scopeName}`;
		const soFar = countByScope[scopeKey] || { layerKey: layer.layerKey, versionTag: version.administrationRecord.versionTag, countScope, scopeName, rowCount: 0, mappedCount: 0, abstainedCount: 0 };
		countByScope[scopeKey] = { ...soFar, rowCount: soFar.rowCount + counted.rowCount, mappedCount: soFar.mappedCount + counted.mappedCount, abstainedCount: soFar.abstainedCount + counted.abstainedCount };
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
	return { countRowList: Object.keys(countByScope).sort().map((scopeKey) => countByScope[scopeKey]) };
};

module.exports = { derivedRowsForSchemaBlock, derivedRowsForLayerVersion, countsOfDecisionText, DEFINITION_PROPERTY_NAME_LIST, ANSWER_EDGE_TYPE_SET, NO_TERM_FOUND_OBJECT_LIST, moduleName };
