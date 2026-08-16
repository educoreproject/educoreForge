'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sssomExporter.js — toSssomTsv (SPEC-bridgeFramework-v1.md §8; Profile §4; RULINGS P7, BF13, 12:05 #9;
// BR-041, BR-046, BR-052..058). A first-class member, run at the end of every re-judge (beside the block in
// the run's output dir; outputPath REQUIRED) and on demand.
//
//   toSssomTsv({ decisionBlock, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath }, cb)
//     → { outputPath, rowCount, subjectCount, setLevelSlots }
//   setLevelSlots = { mappingProvider: { url, verifiedBy }, subjectSource, subjectSourceVersion, objectSource,
//                     objectSourceVersion, subjectMatchField, objectMatchField, subjectCuriePrefix,
//                     labelTableProvenance | channelAssertionProvenance, authorId?, creatorId? }
//
// Rows: subject_id (subjectCuriePrefix:<forged id>), object_id (the card uri), predicate_id (skos:…),
// mapping_justification, object_label, confidence (judged only), subject_source/_version, object_source/
// _version, subject_match_field, object_match_field, mapping_tool (+version, judged only), predicate_asserted_by,
// source_label. mapping_date ONLY when a declared source column supplied it (none in v1 — a mapping_date is
// REFUSED). curie_map declares every non-built-in prefix; propagatable slots condensed to set level (the #
// header block). REFUSES BEFORE WRITING: an undeclared prefix; a banned justification; a mapping_provider not
// recorded as verified (verifiedBy null — never a placeholder); a mapping_date the source did not supply.
// The report carries the SUBJECT census beside the row count (82 same-target shared leaves → fewer rows than
// subjects, by design — RULING 12:05 #9). TSV only in v1.

const fs = require('fs');
const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { pickedRecordList } = require('./materialiser');
const { JUSTIFICATION_BY_RESOLUTION } = require('./materialiser');

const { sssomJustificationRefusal } = vocabularyLib;

const BUILT_IN_PREFIX_LIST = Object.freeze(['skos', 'semapv', 'owl', 'rdfs', 'sssom']);
const COLUMN_LIST = Object.freeze([
	'subject_id',
	'predicate_id',
	'object_id',
	'mapping_justification',
	'object_label',
	'confidence',
	'subject_source',
	'subject_source_version',
	'object_source',
	'object_source_version',
	'subject_match_field',
	'object_match_field',
	'mapping_tool',
	'mapping_tool_version',
	'predicate_asserted_by',
	'source_label',
]);
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const prefixOf = (curie) => (typeof curie === 'string' && curie.indexOf(':') > 0 ? curie.slice(0, curie.indexOf(':')) : null);
const tsvCell = (value) => (value === undefined || value === null ? '' : String(value).replace(/[\t\r\n]/g, ' '));

const toSssomTsv = ({ decisionBlock, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath } = {}, callback) => {
	const refuseWith = (what, where) => callback(refuse.byName({ moduleName, what, where }).message);
	if (!decisionBlock || !decisionBlock.header || !Array.isArray(decisionBlock.decisionRecordList)) {
		refuseWith('decisionBlock is not a parsed block', 'toSssomTsv({ decisionBlock, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath })');
		return;
	}
	if (!isNonEmptyString(outputPath)) {
		refuseWith('outputPath is required', 'the TSV lands beside the block in the run output dir; there is no default path');
		return;
	}
	if (!isPlainObject(curieMap) || !isPlainObject(setLevelSlots) || !isPlainObject(cardByStableId)) {
		refuseWith('curieMap, setLevelSlots and cardByStableId must be objects', 'declare every non-built-in prefix and the set-level slots');
		return;
	}
	const provider = setLevelSlots.mappingProvider;
	if (!isPlainObject(provider) || !isNonEmptyString(provider.url)) {
		refuseWith('setLevelSlots.mappingProvider.url is absent', 'mapping_provider is a set-level slot (BR-041)');
		return;
	}
	if (provider.verifiedBy === null || provider.verifiedBy === undefined) {
		refuseWith(`mappingProvider ${provider.url} is not recorded as verified-to-resolve (verifiedBy null)`, 'the builder verifies the URL and records { sessionName, date, note }; the export refuses until then — never a placeholder (RULING P7)');
		return;
	}
	if (setLevelSlots.mappingDate !== undefined && setLevelSlots.mappingDate !== null) {
		refuseWith('a mapping_date was supplied but no source column supplies one in v1', 'mapping_date is DATA from the source only, never minted (BR-053, Profile §4.6)');
		return;
	}
	const requiredSlotList = ['subjectSource', 'subjectSourceVersion', 'objectSource', 'objectSourceVersion', 'subjectMatchField', 'objectMatchField', 'subjectCuriePrefix'];
	const missingSlot = requiredSlotList.find((oneName) => !isNonEmptyString(setLevelSlots[oneName]));
	if (missingSlot !== undefined) {
		refuseWith(`setLevelSlots.${missingSlot} is absent`, 'every propagatable slot is stated once at set level');
		return;
	}
	const declaredPrefixSet = new Set(Object.keys(curieMap));
	const prefixRefusal = (curie, slotName) => {
		const prefix = prefixOf(curie);
		if (prefix === null) {
			return `${slotName} '${curie}' is not a CURIE`;
		}
		return BUILT_IN_PREFIX_LIST.indexOf(prefix) === -1 && !declaredPrefixSet.has(prefix) ? `${slotName} prefix '${prefix}' is not declared in curie_map (${Array.from(declaredPrefixSet).join(', ')})` : '';
	};
	const subjectPrefixRefusal = declaredPrefixSet.has(setLevelSlots.subjectCuriePrefix) ? '' : `subjectCuriePrefix '${setLevelSlots.subjectCuriePrefix}' is not declared in curie_map`;
	if (subjectPrefixRefusal) {
		refuseWith(subjectPrefixRefusal, 'curie_map declares every non-built-in prefix (Profile §4.6)');
		return;
	}
	const matchFieldPrefixList = String(setLevelSlots.subjectMatchField).split('|').concat(String(setLevelSlots.objectMatchField).split('|'));
	const undeclaredMatchField = matchFieldPrefixList.map((oneField) => prefixRefusal(oneField, 'match_field')).find((oneReason) => oneReason !== '');
	if (undeclaredMatchField !== undefined) {
		refuseWith(undeclaredMatchField, 'subject_match_field / object_match_field prefixes are declared in curie_map');
		return;
	}
	const rowList = [];
	const subjectSet = new Set();
	const picked = pickedRecordList(decisionBlock.decisionRecordList);
	for (let recordIndex = 0; recordIndex < picked.length; recordIndex++) {
		const oneRecord = picked[recordIndex];
		const justification = JUSTIFICATION_BY_RESOLUTION[oneRecord.resolution];
		const justificationRefusal = sssomJustificationRefusal(justification);
		if (justificationRefusal) {
			refuseWith(justificationRefusal, 'Profile §4.2');
			return;
		}
		const card = cardByStableId[oneRecord.objectStableId];
		if (!card || !isNonEmptyString(card.uri) || !isNonEmptyString(card.name)) {
			refuseWith(`objectStableId ${oneRecord.objectStableId} has no card with uri and name`, 'object_id is the card uri and object_label its name (MUST)');
			return;
		}
		subjectSet.add(oneRecord.subjectStableId);
		rowList.push({
			subject_id: `${setLevelSlots.subjectCuriePrefix}:${oneRecord.subjectStableId}`,
			predicate_id: `skos:${oneRecord.predicate}`,
			object_id: card.uri,
			mapping_justification: justification,
			object_label: card.name,
			confidence: oneRecord.resolution === 'judged' ? oneRecord.confidence : '',
			subject_source: setLevelSlots.subjectSource,
			subject_source_version: setLevelSlots.subjectSourceVersion,
			object_source: setLevelSlots.objectSource,
			object_source_version: setLevelSlots.objectSourceVersion,
			subject_match_field: setLevelSlots.subjectMatchField,
			object_match_field: setLevelSlots.objectMatchField,
			mapping_tool: oneRecord.resolution === 'judged' ? oneRecord.judge.judgeModel : '',
			mapping_tool_version: oneRecord.resolution === 'judged' ? oneRecord.judge.rendererVersion : '',
			predicate_asserted_by: oneRecord.predicateAssertedBy,
			source_label: oneRecord.sourceLabel === null || oneRecord.sourceLabel === undefined ? '' : oneRecord.sourceLabel,
		});
	}
	const headerLineList = [
		'#curie_map:',
		...Object.keys(curieMap)
			.sort()
			.map((onePrefix) => `#  ${onePrefix}: ${curieMap[onePrefix]}`),
		`#mapping_provider: ${provider.url}`,
		`#mapping_provider_verified_by: ${provider.verifiedBy.sessionName} ${provider.verifiedBy.date} — ${provider.verifiedBy.note}`,
		`#mapping_set_id: ${decisionBlockHash}`,
		`#subject_source: ${setLevelSlots.subjectSource}`,
		`#subject_source_version: ${setLevelSlots.subjectSourceVersion}`,
		`#object_source: ${setLevelSlots.objectSource}`,
		`#object_source_version: ${setLevelSlots.objectSourceVersion}`,
		`#subject_match_field: ${setLevelSlots.subjectMatchField}`,
		`#object_match_field: ${setLevelSlots.objectMatchField}`,
	];
	if (isNonEmptyString(setLevelSlots.authorId)) {
		headerLineList.push(`#author_id: ${setLevelSlots.authorId}`);
	}
	if (isNonEmptyString(setLevelSlots.creatorId)) {
		headerLineList.push(`#creator_id: ${setLevelSlots.creatorId}`);
	}
	if (setLevelSlots.labelTableProvenance !== undefined) {
		headerLineList.push(`#label_table: ${JSON.stringify(setLevelSlots.labelTableProvenance)}`);
	}
	if (setLevelSlots.channelAssertionProvenance !== undefined) {
		headerLineList.push(`#channel_assertion: ${JSON.stringify(setLevelSlots.channelAssertionProvenance)}`);
	}
	headerLineList.push(`#subject_census: ${JSON.stringify({ subjectCount: subjectSet.size, rowCount: rowList.length, note: 'rows are per (subject stableId, predicate, object); several source subjects sharing one leaf yield ONE row' })}`);
	const text = `${headerLineList.join('\n')}\n${COLUMN_LIST.join('\t')}\n${rowList.map((oneRow) => COLUMN_LIST.map((oneColumn) => tsvCell(oneRow[oneColumn])).join('\t')).join('\n')}${rowList.length ? '\n' : ''}`;
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFile(outputPath, text, 'utf8', (writeError) => {
		if (writeError) {
			callback(`${moduleName}: writing ${outputPath}: ${writeError.message}`);
			return;
		}
		callback('', { outputPath, rowCount: rowList.length, subjectCount: subjectSet.size, setLevelSlots });
	});
};

// parseSssomTsv(text) → { headerLineList, columnList, rowList } | { error } — the framework's own PROXY validator (BG-P7 a)
const parseSssomTsv = (text) => {
	if (typeof text !== 'string' || text.length === 0) {
		return { error: 'empty text' };
	}
	const lineList = text.split('\n');
	const headerLineList = lineList.filter((oneLine) => oneLine.startsWith('#'));
	const bodyLineList = lineList.filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
	if (bodyLineList.length === 0) {
		return { error: 'no column header line' };
	}
	const columnList = bodyLineList[0].split('\t');
	const missingColumn = ['subject_id', 'predicate_id', 'object_id', 'mapping_justification'].find((oneName) => columnList.indexOf(oneName) === -1);
	if (missingColumn !== undefined) {
		return { error: `mandatory column '${missingColumn}' is absent` };
	}
	const rowList = bodyLineList.slice(1).map((oneLine) => {
		const cellList = oneLine.split('\t');
		return columnList.reduce((soFar, oneColumn, columnIndex) => ({ ...soFar, [oneColumn]: cellList[columnIndex] === undefined ? '' : cellList[columnIndex] }), {});
	});
	const badWidth = bodyLineList.slice(1).find((oneLine) => oneLine.split('\t').length !== columnList.length);
	if (badWidth !== undefined) {
		return { error: `a row has ${badWidth.split('\t').length} cells; the header has ${columnList.length}` };
	}
	return { headerLineList, columnList, rowList };
};

module.exports = { toSssomTsv, parseSssomTsv, COLUMN_LIST, BUILT_IN_PREFIX_LIST, moduleName };
