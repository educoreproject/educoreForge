'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// decisionBlock.js — the canonical freeze text, the header, blockIdFor, frameworkFingerprint and the
// parse+verify used on materialise (SPEC-bridgeFramework-v1.md §7; RULINGS R1, R4, R7, BF12; BR-070..075).
//
// FROZEN TEXT = CANONICAL JSON: header keys in the DECLARED order (HEADER_KEY_ORDER); decisionRecordList
// sorted by (subjectStableId, objectStableId, predicate, targetKey); inside a record keys sorted; every list of
// stableIds sorted; no undefined / NaN / Infinity (REFUSED); no timestamps, run ids or paths (a document is
// named by channelKey + sha256); evidence BY REFERENCE (promptHash, rendererVersion, judgeModel). The
// predicate and the remodel resolution are FROZEN INTO THE RECORD; the census is a MEMBER of the text.
// blockIdFor = contentAddress.blockIdForText(frozenText) — the same function decision-store verifies on read.
//
// frameworkFingerprint() — NEW code (lib/forge-framework/fingerprint.js hashes a GRAPH result and is not
// reused, RULING BF12): sha256 over the sorted, path-labelled contents of lib/bridge-framework/**/*.js
// (excluding test/), apps/graph-builder/apps/bridge-maker/bridgeMaker.js and bridge-maker/lib/*.js (D-S7);
// computed by the framework ABOUT ITSELF at freeze time and written into every block's header. Content-
// derived, never settable — what makes "zero framework change" checkable on the artifacts alone.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const contentAddress = require(path.join(__dirname, '..', 'content-address', 'content-address'))();
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const FRAMEWORK_GENERATION = 'bridgeFramework-v1';
const HEADER_KEY_ORDER = Object.freeze([
	'frameworkGeneration',
	'frameworkFingerprint',
	'rendererVersion',
	'bridgeName',
	'pluginVersion',
	'declarationDigest',
	'labelTableDigest',
	'remodelTableDigest',
	'matchBasis',
	'producerKind',
	'judgeKind',
	// predicateRule — NAMES the rule that turned a judgment into a relation. null for the three documentary
	// predicate sources (the SOURCE ROW names the relation there). 'categoryTable-v1' for a judge-sourced
	// predicate: a NAMED, TIME-BOXED v1 approximation (RULING §11.7 (a)) stamped INSIDE the content address, so
	// a later judge with a real predicate slot produces a visibly different block rather than silently
	// different edges under the same story.
	'predicateRule',
	// candidateRetrieval — K, the cosine floor and the embedding model, or null for a key-filtered pool. These
	// are the parameters that DECIDE WHICH CANDIDATES THE JUDGE EVER SAW, so they belong inside the content
	// address and inside the census-fixture key (RULING §11.3/§11.10): changing K must re-key the block, not
	// quietly invalidate a fixture that still compares equal.
	'candidateRetrieval',
	// subjectScopeDigest — sha256 over the sorted evaluation-scope stableId list, or null when the subject
	// population is not narrowed. Two runs over DIFFERENT subject sets must not be able to produce the same id.
	'subjectScopeDigest',
	'sourceWindow',
	'blindingDeclaration',
	'sourceStandardName',
	'sourceVersion',
	'hubName',
	'hubVersion',
	'sourceChannelDigestByKey',
	'contentionCensus',
	'cardinalityCensus',
	'generation',
]);
const STABLE_ID_LIST_KEY_LIST = Object.freeze(['renderedPoolStableIdList', 'filteredPoolStableIdList', 'keyPoolStableIdList', 'assertingSubjectList']);
const FINGERPRINT_ROOT_LIST = Object.freeze([
	{ label: 'lib/bridge-framework', dirPath: __dirname, recursive: true, excludeDirNameList: ['test'] },
	{ label: 'apps/graph-builder/apps/bridge-maker', dirPath: path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker'), recursive: false, excludeDirNameList: [] },
	{ label: 'apps/graph-builder/apps/bridge-maker/lib', dirPath: path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib'), recursive: false, excludeDirNameList: [] },
]);

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// canonicalText — sorted keys, refuses undefined / NaN / Infinity anywhere (throws a named Error)
const canonicalText = (value, keyPath) => {
	const here = keyPath === undefined ? '$' : keyPath;
	if (value === undefined) {
		throw refuse.byName({ moduleName, what: `undefined at ${here}`, where: 'the frozen text admits no undefined; omit the key or freeze null' });
	}
	if (typeof value === 'number' && !Number.isFinite(value)) {
		throw refuse.byName({ moduleName, what: `${String(value)} at ${here}`, where: 'the frozen text admits no NaN / Infinity' });
	}
	if (Array.isArray(value)) {
		return `[${value.map((oneEntry, oneIndex) => canonicalText(oneEntry, `${here}[${oneIndex}]`)).join(',')}]`;
	}
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((oneName) => `${JSON.stringify(oneName)}:${canonicalText(value[oneName], `${here}.${oneName}`)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
};

const sortStableIdLists = (record) => {
	const sorted = {};
	Object.keys(record).forEach((oneName) => {
		sorted[oneName] = STABLE_ID_LIST_KEY_LIST.indexOf(oneName) !== -1 && Array.isArray(record[oneName]) ? record[oneName].slice().sort(compareStrings) : record[oneName];
	});
	return sorted;
};

const compareRecords = (leftRecord, rightRecord) =>
	compareStrings(String(leftRecord.subjectStableId), String(rightRecord.subjectStableId)) ||
	compareStrings(String(leftRecord.objectStableId === null || leftRecord.objectStableId === undefined ? '' : leftRecord.objectStableId), String(rightRecord.objectStableId === null || rightRecord.objectStableId === undefined ? '' : rightRecord.objectStableId)) ||
	compareStrings(String(leftRecord.predicate === null || leftRecord.predicate === undefined ? '' : leftRecord.predicate), String(rightRecord.predicate === null || rightRecord.predicate === undefined ? '' : rightRecord.predicate)) ||
	compareStrings(String(leftRecord.targetKey === undefined ? '' : leftRecord.targetKey), String(rightRecord.targetKey === undefined ? '' : rightRecord.targetKey));

// frozenTextFor({ header, decisionRecordList, refusalList }) → { frozenText } | { error }
// (the census is a header member — cardinalityCensus/contentionCensus — per RULING R7 D-2)
const frozenTextFor = ({ header, decisionRecordList, refusalList } = {}) => {
	if (!isPlainObject(header)) {
		return { error: refuse.byName({ moduleName, what: 'header is not an object', where: 'frozenTextFor({ header, decisionRecordList, refusalList })' }) };
	}
	const missingHeaderKey = HEADER_KEY_ORDER.find((oneName) => !Object.prototype.hasOwnProperty.call(header, oneName));
	if (missingHeaderKey !== undefined) {
		return { error: refuse.byName({ moduleName, what: `header lacks '${missingHeaderKey}'`, where: `every block header carries ${HEADER_KEY_ORDER.join(', ')} (BR-071, BG-GEN)` }) };
	}
	const unknownHeaderKey = Object.keys(header).find((oneName) => HEADER_KEY_ORDER.indexOf(oneName) === -1);
	if (unknownHeaderKey !== undefined) {
		return { error: refuse.byName({ moduleName, what: `header carries unknown key '${unknownHeaderKey}'`, where: 'the header key set is closed' }) };
	}
	if (!Array.isArray(decisionRecordList) || !Array.isArray(refusalList)) {
		return { error: refuse.byName({ moduleName, what: 'decisionRecordList and refusalList must be arrays', where: 'frozenTextFor' }) };
	}
	let frozenText = '';
	let freezeFault = null;
	const attempt = () => {
		const headerText = `{${HEADER_KEY_ORDER.map((oneName) => `${JSON.stringify(oneName)}:${canonicalText(header[oneName], `header.${oneName}`)}`).join(',')}}`;
		const recordText = `[${decisionRecordList
			.map(sortStableIdLists)
			.sort(compareRecords)
			.map((oneRecord, oneIndex) => canonicalText(oneRecord, `decisionRecordList[${oneIndex}]`))
			.join(',')}]`;
		const refusalText = `[${refusalList
			.map(sortStableIdLists)
			.sort((leftRefusal, rightRefusal) => compareStrings(canonicalText(leftRefusal), canonicalText(rightRefusal)))
			.map((oneRefusal, oneIndex) => canonicalText(oneRefusal, `refusalList[${oneIndex}]`))
			.join(',')}]`;
		frozenText = `{"header":${headerText},"decisionRecordList":${recordText},"refusalList":${refusalText}}`;
	};
	// one of the TWO throw-to-value adapters in this module (the other wraps JSON.parse in parseJsonText):
	// canonicalText THROWS a named refusal (undefined/NaN/Infinity) and this is
	// the throw-to-value adapter — a freeze fault is a VALUE to the orchestration side, not control flow
	try {
		attempt();
	} catch (freezeError) {
		freezeFault = freezeError;
	}
	if (freezeFault) {
		return { error: freezeFault };
	}
	return { frozenText };
};

const blockIdFor = ({ frozenText } = {}) => contentAddress.blockIdForText(frozenText);

// parseJsonText(text) → { value } | { error: string } — the ONE accepted JSON.parse try in the framework,
// converted to a value; the frozen block AND the hub-owned remodel table are read through it
const parseJsonText = (text) => {
	let value = null;
	let parseFault = '';
	const attempt = () => {
		value = JSON.parse(text);
	};
	try {
		attempt();
	} catch (parseError) {
		parseFault = parseError.message;
	}
	return parseFault ? { error: parseFault } : { value };
};

// parseFrozenText(frozenText) → { block } | { error }
const parseFrozenText = (frozenText) => {
	const parsed = parseJsonText(frozenText);
	if (parsed.error) {
		return { error: refuse.byName({ moduleName, what: `the frozen text is not valid JSON (${parsed.error})`, where: 'a decision block that does not parse is corrupt; refuse, never repair' }) };
	}
	const block = parsed.value;
	if (!isPlainObject(block) || !isPlainObject(block.header) || !Array.isArray(block.decisionRecordList) || !Array.isArray(block.refusalList)) {
		return { error: refuse.byName({ moduleName, what: 'the frozen text lacks header / decisionRecordList / refusalList', where: 'not a bridge decision block' }) };
	}
	const missingHeaderKey = HEADER_KEY_ORDER.find((oneName) => !Object.prototype.hasOwnProperty.call(block.header, oneName));
	if (missingHeaderKey !== undefined) {
		return { error: refuse.byName({ moduleName, what: `the block header lacks '${missingHeaderKey}'`, where: 'BG-GEN: every header member is required on read as on freeze' }) };
	}
	return { block };
};

// frameworkFingerprint() → 64-hex over the framework's own tree (label + relative path + contents, sorted)
const listJsFiles = ({ dirPath, recursive, excludeDirNameList }) => {
	if (!fs.existsSync(dirPath)) {
		return [];
	}
	const entryList = fs.readdirSync(dirPath, { withFileTypes: true });
	const fileList = entryList.filter((oneEntry) => oneEntry.isFile() && /\.js$/.test(oneEntry.name)).map((oneEntry) => path.join(dirPath, oneEntry.name));
	const deeper = recursive
		? entryList
				.filter((oneEntry) => oneEntry.isDirectory() && excludeDirNameList.indexOf(oneEntry.name) === -1 && oneEntry.name !== 'node_modules')
				.reduce((soFar, oneEntry) => soFar.concat(listJsFiles({ dirPath: path.join(dirPath, oneEntry.name), recursive, excludeDirNameList })), [])
		: [];
	return fileList.concat(deeper);
};

const frameworkFingerprint = () => {
	const labelledFileList = FINGERPRINT_ROOT_LIST.reduce(
		(soFar, oneRoot) => soFar.concat(listJsFiles(oneRoot).map((oneFilePath) => ({ label: `${oneRoot.label}/${path.relative(oneRoot.dirPath, oneFilePath)}`, filePath: oneFilePath }))),
		[],
	)
		.sort((leftFile, rightFile) => compareStrings(leftFile.label, rightFile.label));
	if (labelledFileList.length === 0) {
		throw refuse.byName({ moduleName, what: 'no framework files found to fingerprint', where: 'FINGERPRINT_ROOT_LIST names the framework tree and the seam face' });
	}
	const hash = crypto.createHash('sha256');
	labelledFileList.forEach((oneFile) => {
		hash.update(`${oneFile.label}\n`, 'utf8');
		hash.update(fs.readFileSync(oneFile.filePath));
		hash.update('\n', 'utf8');
	});
	return hash.digest('hex');
};

const frameworkFingerprintFileList = () =>
	FINGERPRINT_ROOT_LIST.reduce((soFar, oneRoot) => soFar.concat(listJsFiles(oneRoot).map((oneFilePath) => `${oneRoot.label}/${path.relative(oneRoot.dirPath, oneFilePath)}`)), []).sort();

module.exports = {
	FRAMEWORK_GENERATION,
	HEADER_KEY_ORDER,
	STABLE_ID_LIST_KEY_LIST,
	FINGERPRINT_ROOT_LIST,
	canonicalText,
	frozenTextFor,
	blockIdFor,
	parseFrozenText,
	parseJsonText,
	frameworkFingerprint,
	frameworkFingerprintFileList,
	sha256Hex,
	compareRecords,
	moduleName,
};
