'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerAssertions.js — one shape for the assertions of any layer version, whatever form it is frozen in (mappingLayers ML2-b). PURE.
//
//   assertionsFromSssomText({ sssomText, sourceLabel }) → { assertionList, predicateExpansionByPrefix } | { error }
//       a curated or imported set (the rater layer): one assertion per row
//   assertionsFromDecisionBlock({ decisionBlock, sourceLabel }) → { assertionList } | { error }
//       a judge layer's frozen decision block, read through the SAME pieces the exporter uses (materialiser.plannedEdgeList for the
//       mapped rows, edgeShapeRowFor for the predicate, one abstention per from-node of a card-less record), so the assertions equal
//       the rows sssomExporter.toSssomTsv would write (a parity test proves it on a real block's ML1 re-export)
//
//   assertion = { fromStableId, judgedSubjectStableId, predicateId, objectId, isAbstention, authorIri, standardKey, standardVersion }
//     fromStableId           the row's subject_id: the node the edge leaves (the INSTANCE under fan-out)
//     judgedSubjectStableId  the subject the producer judged (= fromStableId unless fanned out)
//     authorIri              the row's author_id ('' for a judge block: the block's judge is the author of every row)

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { parseSssomTsv, NO_TERM_FOUND_OBJECT_ID, NO_TERM_FOUND_PREDICATE_ID, JUDGED_SUBJECT_COLUMN } = require(path.join(__dirname, '..', 'bridge-framework', 'sssomExporter'));
const { plannedEdgeList, edgeShapeRowFor } = require(path.join(__dirname, '..', 'bridge-framework', 'materialiser'));

const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const standardKeyOf = (stableId) => (stableId.indexOf(':') > 0 ? stableId.slice(0, stableId.indexOf(':')) : '');
const curieMapOf = (headerLineList) =>
	headerLineList.reduce((soFar, oneLine) => {
		const matched = /^#  ([A-Za-z_][A-Za-z0-9_]*): (".*")$/.exec(oneLine);
		return matched ? { ...soFar, [matched[1]]: JSON.parse(matched[2]) } : soFar;
	}, {});

const assertionsFromSssomText = ({ sssomText, sourceLabel } = {}) => {
	const parsed = parseSssomTsv(sssomText);
	if (parsed.error) {
		return { error: refusalText(`${sourceLabel} fails parseSssomTsv: ${parsed.error}`, 'a layer version is read through the exporter\'s own reader') };
	}
	const assertionList = [];
	for (let rowIndex = 0; rowIndex < parsed.rowList.length; rowIndex++) {
		const oneRow = parsed.rowList[rowIndex];
		const standardVersion = isNonEmptyString(oneRow.subject_source_version) ? oneRow.subject_source_version : parsed.headerScalarOf('subject_source_version');
		if (!isNonEmptyString(oneRow.subject_id) || !isNonEmptyString(oneRow.predicate_id) || !isNonEmptyString(oneRow.object_id) || !isNonEmptyString(standardVersion)) {
			return { error: refusalText(`${sourceLabel} row ${rowIndex + 1} lacks subject_id, predicate_id, object_id or a subject_source_version`, 'every compared assertion names its subject, predicate, object and the subject\'s standard version') };
		}
		assertionList.push({
			fromStableId: oneRow.subject_id,
			judgedSubjectStableId: isNonEmptyString(oneRow[JUDGED_SUBJECT_COLUMN]) ? oneRow[JUDGED_SUBJECT_COLUMN] : oneRow.subject_id,
			predicateId: oneRow.predicate_id,
			objectId: oneRow.object_id,
			isAbstention: oneRow.object_id === NO_TERM_FOUND_OBJECT_ID,
			authorIri: isNonEmptyString(oneRow.author_id) ? oneRow.author_id : '',
			standardKey: standardKeyOf(oneRow.subject_id),
			standardVersion,
		});
	}
	return { assertionList, predicateExpansionByPrefix: curieMapOf(parsed.headerLineList) };
};

const assertionsFromDecisionBlock = ({ decisionBlock, sourceLabel } = {}) => {
	if (!decisionBlock || !decisionBlock.header || !Array.isArray(decisionBlock.decisionRecordList)) {
		return { error: refusalText(`${sourceLabel} is not a parsed decision block`, 'assertionsFromDecisionBlock({ decisionBlock, sourceLabel })') };
	}
	const shapeLookup = edgeShapeRowFor(decisionBlock);
	if (shapeLookup.error) {
		return { error: `${moduleName}: ${sourceLabel}: ${shapeLookup.error}` };
	}
	const standardVersion = decisionBlock.header.sourceVersion;
	if (!isNonEmptyString(standardVersion)) {
		return { error: refusalText(`${sourceLabel}'s header names no sourceVersion`, 'a decision block header carries its standard\'s version') };
	}
	const mappedList = plannedEdgeList(decisionBlock.decisionRecordList).map(({ record, fromStableId }) => ({
		fromStableId,
		judgedSubjectStableId: record.subjectStableId,
		predicateId: shapeLookup.edgeShapeRow.sssomPredicateIdFor(record.predicate),
		objectId: record.objectStableId,
		isAbstention: false,
		authorIri: '',
		standardKey: standardKeyOf(fromStableId),
		standardVersion,
	}));
	// the exporter's abstention rule (sssomExporter ML1-a): a record with no card yields one NoTermFound row per from-node
	const abstentionList = decisionBlock.decisionRecordList
		.filter((oneRecord) => !isNonEmptyString(oneRecord.objectStableId))
		.reduce((soFar, oneRecord) => soFar.concat((oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList).map((fromStableId) => ({ record: oneRecord, fromStableId }))), [])
		.map(({ record, fromStableId }) => ({
			fromStableId,
			judgedSubjectStableId: record.subjectStableId,
			predicateId: NO_TERM_FOUND_PREDICATE_ID,
			objectId: NO_TERM_FOUND_OBJECT_ID,
			isAbstention: true,
			authorIri: '',
			standardKey: standardKeyOf(fromStableId),
			standardVersion,
		}));
	return { assertionList: mappedList.concat(abstentionList) };
};

module.exports = { assertionsFromSssomText, assertionsFromDecisionBlock, moduleName };
