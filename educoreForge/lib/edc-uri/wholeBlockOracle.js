'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// wholeBlockOracle.js — THE ORACLE, kept for the tests only. These are the resolver's reads as they stood before the assertion index
// (assertionIndex-110226), moved here VERBATIM: each takes a decision block's WHOLE frozen text, parses it and scans it for one record,
// which on the largest block means 389 MB per request. The resolver answers from uriContract's derived rows instead; a test passes
// blockTextForHash to resolveEdcUri to reach this path, and gate G1 proves the two answer byte-identically over every published block.
// NO PRODUCTION CALLER REACHES THIS MODULE. It shares no code with lib/uri-contract/derivedIndexes.js on purpose: an oracle that called
// the code it judges would judge nothing.

const path = require('path');
const assertionIdentity = require(path.join(__dirname, 'assertionIdentity'));
const materialiserLib = require(path.join(__dirname, '..', 'bridge-framework', 'materialiser'));

// assertionRecordFor({ frozenText, assertionIri }) → { record } | { error }: a machine block is JSON; its records are matched by
// recomputing each planned edge's assertion id from the block header's standards and versions
const assertionRecordFor = ({ frozenText, assertionIri, decisionBlockHash, registry }) => {
	if (frozenText.charAt(0) !== '{') {
		// a layer set (SSSOM/TSV): the row whose record_id is this IRI
		const lineList = frozenText.split('\n').filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
		const columnList = lineList.length ? lineList[0].split('\t') : [];
		const recordIdIndex = columnList.indexOf('record_id');
		if (recordIdIndex === -1) {
			// ⟪ML3.1c⟫ a STORED curated set carries no record_id: its ids are computed by the R-c' recipe (s p o author, scoped by the
			// stored set's hash), as its published rendering wrote them; so each row's id is recomputed here and matched
			return curatedRecordFor({ frozenText, assertionIri, decisionBlockHash, registry });
		}
		const rowLine = lineList.slice(1).find((oneLine) => oneLine.split('\t')[recordIdIndex] === assertionIri);
		return rowLine === undefined ? { error: 'no row of this set carries that record_id' } : { record: columnList.reduce((soFar, oneColumn, columnIndex) => ({ ...soFar, [oneColumn]: rowLine.split('\t')[columnIndex] }), {}) };
	}
	const block = JSON.parse(frozenText);
	const header = block.header;
	// the block's own edge shape names its predicate_id, exactly as the materialiser and the exporter read it
	const shapeLookup = materialiserLib.edgeShapeRowFor(block);
	if (shapeLookup.error) {
		return { error: shapeLookup.error };
	}
	const predicateCurieFor = (oneRecord) => shapeLookup.edgeShapeRow.sssomPredicateIdFor(oneRecord.predicate);
	const plannedList = block.decisionRecordList
		.filter((oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0)
		.reduce((soFar, oneRecord) => soFar.concat((oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList).map((fromStableId) => ({ oneRecord, fromStableId }))), []);
	const found = plannedList.find(({ oneRecord, fromStableId }) => {
		const computed = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: fromStableId, subjectStandardName: header.sourceStandardName, subjectStandardVersion: String(header.sourceVersion), predicateCurie: predicateCurieFor(oneRecord), objectStableId: oneRecord.objectStableId, objectStandardName: header.hubName, objectStandardVersion: String(header.hubVersion) });
		return computed.assertionId === assertionIri;
	});
	return found === undefined ? { error: 'no edge this block writes has that assertion id' } : { record: { subjectStableId: found.fromStableId, judgedSubjectStableId: found.oneRecord.subjectStableId, predicate: found.oneRecord.predicate, objectStableId: found.oneRecord.objectStableId, resolution: found.oneRecord.resolution, confidence: found.oneRecord.confidence, mappingMethod: found.oneRecord.mappingMethod, judgeIdentity: found.oneRecord.judge && found.oneRecord.judge.judgeModel, subjectSource: header.sourceStandardName, subjectVersion: header.sourceVersion, objectSource: header.hubName, objectVersion: header.hubVersion } };
};

// ⟪ML3.1c⟫ curatedRecordFor — the curated layer version whose stored set IS this block (wholeSetBlock), each row's R-c' id recomputed
// (the same recipe layerPublication.curatedVersionSetText writes), the row whose id is this IRI answered
const curatedRecordFor = ({ frozenText, assertionIri, decisionBlockHash, registry }) => {
	const owner = registry.layerRegistry.layerList.reduce((soFar, oneLayer) => soFar || oneLayer.versionList.filter((oneVersion) => oneVersion.contentIdBasis === 'frozenSetBytes' && oneVersion.wholeSetBlock && oneVersion.wholeSetBlock.decisionBlockHash === decisionBlockHash).map((oneVersion) => ({ layer: oneLayer, version: oneVersion }))[0], undefined);
	if (owner === undefined) {
		return { error: 'no row of this set carries that record_id (the set has no record_id column and no curated layer version holds it)' };
	}
	const objectVersionLine = frozenText.split('\n').find((oneLine) => oneLine.startsWith('#object_source_version: '));
	const objectSourceVersion = objectVersionLine === undefined ? undefined : JSON.parse(objectVersionLine.slice('#object_source_version: '.length));
	const standardByStandardKey = owner.layer.standardList.reduce((soFar, oneStandard) => ({ ...soFar, [oneStandard.standardKey]: oneStandard }), {});
	const rowList = setRowListOf(frozenText);
	for (let rowIndex = 0; rowIndex < rowList.length; rowIndex++) {
		const oneRow = rowList[rowIndex];
		const standard = standardByStandardKey[oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':'))];
		if (standard === undefined) {
			continue;
		}
		const identity = assertionIdentity.curatedAssertionIdFor({ decisionBlockHash, subjectStableId: oneRow.subject_id, subjectStandardName: standard.standardName, subjectStandardVersion: oneRow.subject_source_version, predicateCurie: oneRow.predicate_id, objectStableId: oneRow.object_id, objectStandardName: owner.layer.hubList[0].hubName, objectStandardVersion: objectSourceVersion, authorIdList: (oneRow.author_id || '').split('|').filter((oneAuthor) => oneAuthor.length) });
		if (!identity.error && identity.assertionId === assertionIri) {
			return { record: { ...oneRow, layerKey: owner.layer.layerKey, versionTag: owner.version.administrationRecord.versionTag, sourceRowNumber: rowIndex + 1 } };
		}
	}
	return { error: 'no row of this set carries that record_id' };
};

const NO_TERM_FOUND_OBJECT_ID = 'sssom:NoTermFound';
const NO_TERM_FOUND_PREDICATE_ID = 'skos:mappingRelation';
const setRowListOf = (frozenText) => {
	const lineList = frozenText.split('\n').filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
	const columnList = lineList.length ? lineList[0].split('\t') : [];
	return lineList.slice(1).map((oneLine) => oneLine.split('\t').reduce((soFar, oneCell, cellIndex) => ({ ...soFar, [columnList[cellIndex]]: oneCell }), {}));
};
const machineAssertionListFor = ({ frozenText, decisionBlockHash, elementStableId, standardName, standardVersion }) => {
	const block = JSON.parse(frozenText);
	const { header } = block;
	if (header.sourceStandardName !== standardName || String(header.sourceVersion) !== standardVersion) {
		return { assertionList: [] };
	}
	const shapeLookup = materialiserLib.edgeShapeRowFor(block);
	if (shapeLookup.error) {
		return { error: shapeLookup.error };
	}
	const assertionList = [];
	for (let recordIndex = 0; recordIndex < block.decisionRecordList.length; recordIndex++) {
		const oneRecord = block.decisionRecordList[recordIndex];
		const fromStableIdList = oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList;
		if (fromStableIdList.indexOf(elementStableId) === -1) {
			continue;
		}
		const isAbstention = !(typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0);
		const predicateCurie = isAbstention ? NO_TERM_FOUND_PREDICATE_ID : shapeLookup.edgeShapeRow.sssomPredicateIdFor(oneRecord.predicate);
		const identity = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: elementStableId, subjectStandardName: standardName, subjectStandardVersion: standardVersion, predicateCurie, objectStableId: isAbstention ? NO_TERM_FOUND_OBJECT_ID : oneRecord.objectStableId, objectStandardName: header.hubName, objectStandardVersion: String(header.hubVersion) });
		if (identity.error) {
			return { error: identity.error };
		}
		assertionList.push({ assertionId: identity.assertionId, predicate: predicateCurie, object: isAbstention ? NO_TERM_FOUND_OBJECT_ID : oneRecord.objectStableId, hubName: header.hubName, hubVersion: String(header.hubVersion), resolution: oneRecord.resolution === undefined ? null : oneRecord.resolution, confidence: oneRecord.confidence === undefined ? null : oneRecord.confidence, judgedSubjectStableId: oneRecord.subjectStableId });
	}
	return { assertionList };
};
const setAssertionListFor = ({ frozenText, decisionBlockHash, elementStableId, elementIri, standardName, standardVersion, layer, version }) => {
	const prefixExpansion = version.importRecord !== undefined ? version.importRecord.prefixExpansion : undefined;
	const objectVersionLine = frozenText.split('\n').find((oneLine) => oneLine.startsWith('#object_source_version: '));
	const objectSourceVersion = objectVersionLine === undefined ? undefined : JSON.parse(objectVersionLine.slice('#object_source_version: '.length));
	const assertionList = [];
	const rowList = setRowListOf(frozenText);
	for (let rowIndex = 0; rowIndex < rowList.length; rowIndex++) {
		const oneRow = rowList[rowIndex];
		if (prefixExpansion !== undefined) {
			const prefix = oneRow.subject_id.slice(0, Math.max(oneRow.subject_id.indexOf(':'), 0));
			const subjectIri = /^https?:\/\//.test(oneRow.subject_id) ? oneRow.subject_id : prefixExpansion[prefix] === undefined ? '' : `${prefixExpansion[prefix]}${oneRow.subject_id.slice(prefix.length + 1)}`;
			if (subjectIri === elementIri) {
				assertionList.push({ assertionId: oneRow.record_id || null, predicate: oneRow.predicate_id, object: oneRow.object_id, authorId: oneRow.author_id || null, sourceRowNumber: rowIndex + 1 });
			}
			continue;
		}
		if (oneRow.subject_id !== elementStableId) {
			continue;
		}
		const identity = assertionIdentity.curatedAssertionIdFor({ decisionBlockHash, subjectStableId: elementStableId, subjectStandardName: standardName, subjectStandardVersion: standardVersion, predicateCurie: oneRow.predicate_id, objectStableId: oneRow.object_id, objectStandardName: layer.hubList[0].hubName, objectStandardVersion: objectSourceVersion, authorIdList: (oneRow.author_id || '').split('|').filter((oneAuthor) => oneAuthor.length) });
		if (identity.error) {
			return { error: identity.error };
		}
		assertionList.push({ assertionId: identity.assertionId, predicate: oneRow.predicate_id, object: oneRow.object_id, authorId: oneRow.author_id });
	}
	return { assertionList };
};

module.exports = { assertionRecordFor, machineAssertionListFor, setAssertionListFor, setRowListOf, moduleName };
