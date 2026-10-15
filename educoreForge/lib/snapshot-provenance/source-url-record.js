'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// source-url-record.js — where a snapshot's source came from, read from (and written into) the snapshot's
// standardSourceLocation provenance file (WORKORDER-sourceUrls-101526). The file is `name: value` lines; this module owns
// only the lines whose name starts with sourceUrl:
//
//   sourceUrl:             the address (https only)
//   sourceUrlRelation:     how that address relates to our bytes, one relationName of sourceUrlRelationTable.json
//   sourceUrlPage:         the publisher page the address is linked from (required by some relations)
//   sourceUrlNote:         the caveat a reader must see beside the link (required by some relations)
//   sourceUrlVerification: when and how the relation was checked
//
// A file with NONE of these lines records no address: the record is every field null, and readers say "not recorded"
// (notRecordedText). A file with SOME of them must state the whole relation or it is refused by name: a half-stated
// relation is never completed here. An unknown sourceUrl* name, or a name given twice, is refused (a typo must not
// silently drop a caveat). No other line of the file is read: deriveVersionStamp owns publishedVersion.
//
// PURE except readSourceUrlRecord's one synchronous file read. Answers { sourceUrlRecord } | { refusalMessage }.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const relationTable = require(path.join(__dirname, 'sourceUrlRelationTable.json'));

const PROVENANCE_FILE_NAME = 'standardSourceLocation';
const SOURCE_URL_FIELD_NAME_LIST = Object.freeze(['sourceUrl', 'sourceUrlRelation', 'sourceUrlPage', 'sourceUrlNote', 'sourceUrlVerification']);
const ALWAYS_REQUIRED_FIELD_NAME_LIST = Object.freeze(['sourceUrl', 'sourceUrlRelation', 'sourceUrlVerification']);
const ADDRESS_FIELD_NAME_LIST = Object.freeze(['sourceUrl', 'sourceUrlPage']);
const ADDRESS_PATTERN = /^https:\/\/\S+$/;
const SOURCE_URL_LINE_PATTERN = /^(sourceUrl[A-Za-z]*):[ \t]*(.*?)[ \t]*$/;
const SOURCE_URL_RELATION_BY_NAME = Object.freeze(
	relationTable.sourceUrlRelationList.reduce((soFar, oneRelation) => ({ ...soFar, [oneRelation.relationName]: Object.freeze({ ...oneRelation }) }), {}),
);
const NOT_RECORDED_TEXT = relationTable.notRecordedText;

const refusalOf = (what, where) => refuse.byName({ moduleName, what, where }).message;

// the record of a file that names no address: every field present, every one null
const notRecordedRecord = () =>
	Object.freeze({ sourceUrl: null, sourceUrlRelation: null, sourceUrlRelationText: null, sourceUrlPage: null, sourceUrlNote: null, sourceUrlVerification: null });

// sourceUrlRecordOf — PURE: { fieldValueByName } (the sourceUrl* lines, by name) -> { sourceUrlRecord } | { refusalMessage }
const sourceUrlRecordOf = ({ fieldValueByName, describedAs }) => {
	const givenFieldNameList = SOURCE_URL_FIELD_NAME_LIST.filter((fieldName) => fieldValueByName[fieldName] !== undefined && fieldValueByName[fieldName] !== null);
	if (givenFieldNameList.length === 0) {
		return { sourceUrlRecord: notRecordedRecord() };
	}
	const relation = SOURCE_URL_RELATION_BY_NAME[fieldValueByName.sourceUrlRelation];
	const requiredFieldNameList = ALWAYS_REQUIRED_FIELD_NAME_LIST.concat(relation ? relation.requiredFieldNameList : []);
	const missingFieldNameList = requiredFieldNameList.filter((fieldName) => typeof fieldValueByName[fieldName] !== 'string' || fieldValueByName[fieldName] === '');
	if (missingFieldNameList.length) {
		return { refusalMessage: refusalOf(`${describedAs} states ${givenFieldNameList.join(', ')} but not ${missingFieldNameList.join(', ')}`, `a recorded source URL states ${ALWAYS_REQUIRED_FIELD_NAME_LIST.join(', ')}${relation && relation.requiredFieldNameList.length ? `, and relation ${relation.relationName} also ${relation.requiredFieldNameList.join(', ')}` : ''}; to record no address, give none of the sourceUrl lines`) };
	}
	if (!relation) {
		return { refusalMessage: refusalOf(`${describedAs} names sourceUrlRelation '${fieldValueByName.sourceUrlRelation}'`, `the relations are ${Object.keys(SOURCE_URL_RELATION_BY_NAME).join(', ')} (sourceUrlRelationTable.json)`) };
	}
	const badAddressFieldNameList = ADDRESS_FIELD_NAME_LIST.filter((fieldName) => fieldValueByName[fieldName] !== undefined && fieldValueByName[fieldName] !== null && !ADDRESS_PATTERN.test(fieldValueByName[fieldName]));
	if (badAddressFieldNameList.length) {
		return { refusalMessage: refusalOf(`${describedAs} gives ${badAddressFieldNameList.map((fieldName) => `${fieldName} '${fieldValueByName[fieldName]}'`).join(', ')}`, 'an address is one https:// URL with no spaces; anything said about it belongs on sourceUrlNote') };
	}
	const valueOrNull = (fieldName) => (typeof fieldValueByName[fieldName] === 'string' && fieldValueByName[fieldName] !== '' ? fieldValueByName[fieldName] : null);
	return {
		sourceUrlRecord: Object.freeze({
			sourceUrl: fieldValueByName.sourceUrl,
			sourceUrlRelation: relation.relationName,
			sourceUrlRelationText: relation.displayText,
			sourceUrlPage: valueOrNull('sourceUrlPage'),
			sourceUrlNote: valueOrNull('sourceUrlNote'),
			sourceUrlVerification: fieldValueByName.sourceUrlVerification,
		}),
	};
};

// sourceUrlRecordOfText — PURE: a standardSourceLocation's text -> { sourceUrlRecord } | { refusalMessage }
const sourceUrlRecordOfText = ({ provenanceText, describedAs }) => {
	const fieldValueByName = {};
	const faultList = [];
	provenanceText.split('\n').forEach((oneLine) => {
		const lineMatch = SOURCE_URL_LINE_PATTERN.exec(oneLine);
		if (!lineMatch) {
			return;
		}
		const fieldName = lineMatch[1];
		if (!SOURCE_URL_FIELD_NAME_LIST.includes(fieldName)) {
			faultList.push(`an unknown line '${fieldName}'`);
			return;
		}
		if (fieldValueByName[fieldName] !== undefined) {
			faultList.push(`'${fieldName}' twice`);
			return;
		}
		fieldValueByName[fieldName] = lineMatch[2];
	});
	if (faultList.length) {
		return { refusalMessage: refusalOf(`${describedAs} has ${faultList.join(', ')}`, `the sourceUrl lines are ${SOURCE_URL_FIELD_NAME_LIST.join(', ')}, each at most once`) };
	}
	return sourceUrlRecordOf({ fieldValueByName, describedAs });
};

// readSourceUrlRecord — the snapshot directory's standardSourceLocation -> { sourceUrlRecord, provenancePath } | { refusalMessage }
const readSourceUrlRecord = ({ snapshotDirPath }) => {
	const provenancePath = path.join(snapshotDirPath, PROVENANCE_FILE_NAME);
	if (!fs.existsSync(provenancePath)) {
		return { refusalMessage: refusalOf(`${provenancePath} does not exist`, `every snapshot carries a ${PROVENANCE_FILE_NAME} beside its bytes`) };
	}
	const read = sourceUrlRecordOfText({ provenanceText: fs.readFileSync(provenancePath, 'utf8'), describedAs: provenancePath });
	return read.refusalMessage ? read : { ...read, provenancePath };
};

// sourceUrlLineTextFor — PURE: a row { sourceUrl, sourceUrlRelation, sourceUrlPage?, sourceUrlNote?, sourceUrlVerification }
// -> { sourceUrlLineText } (the lines, each ending in a newline, in SOURCE_URL_FIELD_NAME_LIST order) | { refusalMessage }.
// The text is parsed back before it is returned, so a writer can never produce lines this module would refuse to read.
const sourceUrlLineTextFor = ({ sourceUrlRow, describedAs }) => {
	const embeddedNewlineFieldName = SOURCE_URL_FIELD_NAME_LIST.find((fieldName) => typeof sourceUrlRow[fieldName] === 'string' && /[\r\n]/.test(sourceUrlRow[fieldName]));
	if (embeddedNewlineFieldName) {
		return { refusalMessage: refusalOf(`${describedAs} gives ${embeddedNewlineFieldName} with a line break in it`, 'each sourceUrl field is one line') };
	}
	const sourceUrlLineText = SOURCE_URL_FIELD_NAME_LIST.filter((fieldName) => typeof sourceUrlRow[fieldName] === 'string' && sourceUrlRow[fieldName] !== '')
		.map((fieldName) => `${fieldName}: ${sourceUrlRow[fieldName]}\n`)
		.join('');
	const readBack = sourceUrlRecordOfText({ provenanceText: sourceUrlLineText, describedAs });
	if (readBack.refusalMessage) {
		return readBack;
	}
	if (readBack.sourceUrlRecord.sourceUrl === null) {
		return { refusalMessage: refusalOf(`${describedAs} gives no sourceUrl`, 'a row that records no address writes no sourceUrl lines; do not ask for them') };
	}
	return { sourceUrlLineText };
};

module.exports = {
	sourceUrlRecordOfText,
	readSourceUrlRecord,
	sourceUrlLineTextFor,
	SOURCE_URL_FIELD_NAME_LIST,
	SOURCE_URL_RELATION_BY_NAME,
	NOT_RECORDED_TEXT,
	PROVENANCE_FILE_NAME,
	moduleName,
};
