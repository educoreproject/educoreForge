'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// reforge-compare.js — the pure half of reforgeCompare (lane REFORGE, forgeClean PLAN R3, 2026-10-08): is forging REPEATABLE?
// Two from-scratch builds of one recipe must produce identical schema blocks, an identical manifest, identical decision
// blocks and an identical graph. This module holds every rule that answers that, with no graph, no docker and no sqlite,
// so each rule is gated in memory (test-reforgeCompare). The tool (tools/reforgeCompare.js) only reads and writes.
//
// THE VOLATILE LIST IS DATA, AND IT IS NAMES, NEVER PATTERNS (work order R3). reforgeVolatileFieldList.json holds one row per
// excluded field: { scope, subjectName, propertyName, reason }. A row names ONE property of ONE label, edge type or store
// table; a name carrying a wildcard or regex character is refused by name, because a pattern excludes fields nobody looked
// at. Everything not on the list is compared, and every difference is a bug until a row with a reason says otherwise.
//
// THE FINGERPRINT. A node's record is its sorted labels and its properties (volatile ones removed), each value written in a
// TYPE-TAGGED canonical form (an Integer 1 and a Float 1.0 differ, as the graph contract says they do; a list keeps its
// order, so an unsorted Set iteration that reorders a list IS a difference). An edge's record is its type, its properties
// and its two endpoints, each named by the endpoint's IDENTITY (labels + stableId) when that identity is unique in the
// graph and by the endpoint's content hash when it is not — so one changed node is reported once, as a node, rather than
// once more for every edge that touches it. The graph fingerprint is sha256 over the sorted node hashes and the sorted
// edge hashes: the read order of the query cannot move it. Records are written RAW and the volatile list is applied when
// they are compared (see 'TWO STAGES' below).
//
// Async style: none needed — every function here is synchronous and pure.

const crypto = require('crypto');

const VOLATILE_SCOPE_LIST = Object.freeze(['graphNode', 'graphEdge', 'storeRow']);
// a field name is an identifier: anything else (*, ?, [, |, ., ^, $ ...) would read as a pattern and is refused
const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SUBJECT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FINGERPRINT_FORMAT = 'reforgeFingerprint-v2';
// the evidence file -summarize writes and -stampPromotion reads (promotion-evidence.js): one name, both sides
const REFORGE_EVIDENCE_FORMAT = 'reforgeEvidence-v1';
const NO_STABLE_ID_MARK = '(no stableId)';

const sha256Of = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ----- the volatile list -----------------------------------------------------------------------------------------------
// volatileFieldListFrom(parsedList) → { volatileFieldList, refusal } — refusal '' when every row is well formed
const volatileFieldListFrom = (parsedList) => {
	if (!Array.isArray(parsedList)) {
		return { volatileFieldList: [], refusal: `${moduleName}: the volatile field list is not an array (got ${typeof parsedList})` };
	}
	const faultList = parsedList.reduce((soFar, oneRow, rowIndex) => {
		const where = `volatile row ${rowIndex}`;
		const rowFaultList = []
			.concat(oneRow && VOLATILE_SCOPE_LIST.indexOf(oneRow.scope) !== -1 ? [] : [`${where}: scope ${JSON.stringify(oneRow && oneRow.scope)} is not one of ${VOLATILE_SCOPE_LIST.join(', ')}`])
			.concat(oneRow && SUBJECT_NAME_RE.test(String(oneRow.subjectName)) ? [] : [`${where}: subjectName ${JSON.stringify(oneRow && oneRow.subjectName)} is not ONE label, edge type or table name (no patterns)`])
			.concat(oneRow && FIELD_NAME_RE.test(String(oneRow.propertyName)) ? [] : [`${where}: propertyName ${JSON.stringify(oneRow && oneRow.propertyName)} is not ONE property name (no patterns)`])
			.concat(oneRow && typeof oneRow.reason === 'string' && oneRow.reason.trim().length >= 10 ? [] : [`${where}: reason is absent or too short to be a reason`]);
		return soFar.concat(rowFaultList);
	}, []);
	const seenRefIdList = parsedList.map((oneRow) => `${oneRow && oneRow.scope}/${oneRow && oneRow.subjectName}/${oneRow && oneRow.propertyName}`);
	const duplicateList = seenRefIdList.filter((oneRefId, index) => seenRefIdList.indexOf(oneRefId) !== index);
	const allFaultList = faultList.concat(duplicateList.map((oneRefId) => `volatile row ${oneRefId} is listed twice`));
	return allFaultList.length ? { volatileFieldList: [], refusal: `${moduleName} REFUSED: ${allFaultList.join('; ')}` } : { volatileFieldList: parsedList.map((oneRow) => Object.freeze({ ...oneRow })), refusal: '' };
};

// volatileNameSetFor — the property names excluded from a record whose subjects (labels, or one edge type, or one table)
// are subjectNameList. Exact names only.
const volatileNameSetFor = ({ volatileFieldList, scope, subjectNameList }) =>
	new Set(volatileFieldList.filter((oneRow) => oneRow.scope === scope && subjectNameList.indexOf(oneRow.subjectName) !== -1).map((oneRow) => oneRow.propertyName));

// storeTableRuleByNameFrom(parsed) → { tableRuleByName, refusal } — reforgeStoreTableRules.json, validated
const storeTableRuleByNameFrom = (parsed) => {
	const ruleList = parsed && Array.isArray(parsed.tableRuleList) ? parsed.tableRuleList : null;
	if (!ruleList) {
		return { tableRuleByName: {}, refusal: `${moduleName} REFUSED: the store table rules carry no tableRuleList array` };
	}
	const isNameList = (oneList) => Array.isArray(oneList) && oneList.every((oneName) => FIELD_NAME_RE.test(String(oneName)));
	const faultList = ruleList.reduce(
		(soFar, oneRule, ruleIndex) =>
			soFar
				.concat(oneRule && SUBJECT_NAME_RE.test(String(oneRule.tableName)) ? [] : [`rule ${ruleIndex}: tableName ${JSON.stringify(oneRule && oneRule.tableName)}`])
				.concat(oneRule && isNameList(oneRule.identityColumnNameList) && oneRule.identityColumnNameList.length > 0 ? [] : [`rule ${ruleIndex}: identityColumnNameList must name at least one column`])
				.concat(oneRule && isNameList(oneRule.digestColumnNameList) ? [] : [`rule ${ruleIndex}: digestColumnNameList must be a list of column names`])
				.concat(!oneRule || oneRule.contentAddressColumnName === undefined || (FIELD_NAME_RE.test(String(oneRule.contentAddressColumnName)) && oneRule.digestColumnNameList.length > 0) ? [] : [`rule ${ruleIndex}: contentAddressColumnName needs a digest column to address`]),
		[],
	);
	return faultList.length
		? { tableRuleByName: {}, refusal: `${moduleName} REFUSED: store table rules: ${faultList.join('; ')}` }
		: { tableRuleByName: ruleList.reduce((soFar, oneRule) => Object.assign(soFar, { [oneRule.tableName]: Object.freeze({ ...oneRule }) }), {}), refusal: '' };
};

// ----- canonical values -------------------------------------------------------------------------------------------------
// canonicalValueOf — a JSON-able, TYPE-TAGGED form of one property value as the neo4j driver hands it over (or as sqlite does)
const canonicalValueOf = (oneValue) => {
	if (oneValue === null || oneValue === undefined) {
		return ['null'];
	}
	if (typeof oneValue === 'string') {
		return ['str', oneValue];
	}
	if (typeof oneValue === 'boolean') {
		return ['bool', oneValue];
	}
	if (typeof oneValue === 'number') {
		return ['float', Object.is(oneValue, -0) ? '-0' : String(oneValue)];
	}
	if (typeof oneValue === 'bigint') {
		return ['int', oneValue.toString()];
	}
	if (Array.isArray(oneValue)) {
		return ['list', oneValue.map(canonicalValueOf)];
	}
	if (Buffer.isBuffer(oneValue) || oneValue instanceof Uint8Array) {
		return ['bytes', Buffer.from(oneValue).toString('hex')];
	}
	// neo4j Integer: { low, high } with toNumber/toString (the driver's own type; never a plain object)
	if (typeof oneValue === 'object' && typeof oneValue.low === 'number' && typeof oneValue.high === 'number' && typeof oneValue.toString === 'function' && typeof oneValue.toNumber === 'function') {
		return ['int', oneValue.toString()];
	}
	// temporal and spatial driver types carry their own class name and an ISO/WKT toString
	if (typeof oneValue === 'object' && oneValue.constructor && oneValue.constructor !== Object && typeof oneValue.toString === 'function') {
		return [oneValue.constructor.name, oneValue.toString()];
	}
	if (typeof oneValue === 'object') {
		return ['map', Object.keys(oneValue).sort().map((oneName) => [oneName, canonicalValueOf(oneValue[oneName])])];
	}
	return ['unknown', typeof oneValue, String(oneValue)];
};
const canonicalValueTextOf = (oneValue) => JSON.stringify(canonicalValueOf(oneValue));
const valueDigestOf = (oneValue) => sha256Of(canonicalValueTextOf(oneValue)).slice(0, 16);

// recordOf — the compared content of one property map: sorted names, the volatile ones removed and listed
const recordOf = ({ propertyByName, excludedNameSet }) => {
	const nameList = Object.keys(propertyByName || {}).sort();
	const keptNameList = nameList.filter((oneName) => !excludedNameSet.has(oneName));
	return {
		keptNameList,
		excludedPropertyNameList: nameList.filter((oneName) => excludedNameSet.has(oneName)),
		propertyDigestByName: keptNameList.reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: valueDigestOf(propertyByName[oneName]) }), {}),
		canonicalPropertyText: JSON.stringify(keptNameList.map((oneName) => [oneName, canonicalValueOf(propertyByName[oneName])])),
	};
};

// ----- graph records ----------------------------------------------------------------------------------------------------
// TWO STAGES, AND WHY. A fingerprint is taken from a running graph, and the graph is then REMOVED (disk). The volatile list,
// though, is learned FROM the comparison: a row added after the first compare must not demand a rebuild. So -fingerprint
// writes RAW records (every property's digest, nothing excluded) and the comparison applies the list (comparableRecordFor).
// rawNodeRecordFor({ labelList, propertyByName }) → { recordKind, subjectNameList (sorted labels), identityText,
//   propertyDigestByName (EVERY property), contentHash (over every property; used only to name a non-unique endpoint) }
const rawNodeRecordFor = ({ labelList, propertyByName }) => {
	const sortedLabelList = labelList.slice().sort();
	const record = recordOf({ propertyByName, excludedNameSet: new Set() });
	const stableIdText = propertyByName && typeof propertyByName.stableId === 'string' ? propertyByName.stableId : NO_STABLE_ID_MARK;
	return {
		recordKind: 'node',
		subjectNameList: sortedLabelList,
		identityText: `${sortedLabelList.join(':')}|${stableIdText}`,
		propertyDigestByName: record.propertyDigestByName,
		contentHash: sha256Of(`node\n${JSON.stringify(sortedLabelList)}\n${record.canonicalPropertyText}`),
	};
};

// endpointNameFor — an endpoint's identity when unique in its graph, else identity + its RAW content hash (see the header).
// The raw hash is taken before the volatile list applies, so a volatile property on a node whose identity is NOT unique
// still separates that node's edges; with stableIds unique (as forged), the identity is used and the case does not arise.
const endpointNameFor = ({ rawNodeRecord, identityCountByText }) => (identityCountByText.get(rawNodeRecord.identityText) === 1 ? rawNodeRecord.identityText : `${rawNodeRecord.identityText}#${rawNodeRecord.contentHash.slice(0, 16)}`);

// rawEdgeRecordFor({ edgeType, startEndpointName, endEndpointName, propertyByName }) → { recordKind, subjectNameList ([type]),
//   identityText, propertyDigestByName (EVERY property) }
const rawEdgeRecordFor = ({ edgeType, startEndpointName, endEndpointName, propertyByName }) => ({
	recordKind: 'edge',
	subjectNameList: [edgeType],
	identityText: `${startEndpointName} -[${edgeType}]-> ${endEndpointName}`,
	propertyDigestByName: recordOf({ propertyByName, excludedNameSet: new Set() }).propertyDigestByName,
});

// comparableRecordFor({ rawRecord, volatileFieldList }) → { hash, identityText, propertyDigestByName (kept), excludedPropertyNameList }
//   the volatile list applied: a property is dropped only when a row names this record's scope, one of its subjects (a
//   label, or the edge type) and the property itself
const SCOPE_BY_RECORD_KIND = Object.freeze({ node: 'graphNode', edge: 'graphEdge' });
const comparableRecordFor = ({ rawRecord, volatileFieldList }) => {
	const excludedNameSet = volatileNameSetFor({ volatileFieldList, scope: SCOPE_BY_RECORD_KIND[rawRecord.recordKind], subjectNameList: rawRecord.subjectNameList });
	const nameList = Object.keys(rawRecord.propertyDigestByName).sort();
	const keptNameList = nameList.filter((oneName) => !excludedNameSet.has(oneName));
	const propertyDigestByName = keptNameList.reduce((soFar, oneName) => Object.assign(soFar, { [oneName]: rawRecord.propertyDigestByName[oneName] }), {});
	return {
		hash: sha256Of(JSON.stringify([rawRecord.recordKind, rawRecord.subjectNameList, rawRecord.identityText, keptNameList.map((oneName) => [oneName, propertyDigestByName[oneName]])])),
		identityText: rawRecord.identityText,
		propertyDigestByName,
		excludedPropertyNameList: nameList.filter((oneName) => excludedNameSet.has(oneName)),
	};
};

// nodeRecordFor / edgeRecordFor — the two stages composed, for a caller holding the whole graph in hand
const nodeRecordFor = ({ labelList, propertyByName, volatileFieldList }) => {
	const comparable = comparableRecordFor({ rawRecord: rawNodeRecordFor({ labelList, propertyByName }), volatileFieldList });
	return { nodeHash: comparable.hash, identityText: comparable.identityText, propertyDigestByName: comparable.propertyDigestByName, excludedPropertyNameList: comparable.excludedPropertyNameList };
};
const edgeRecordFor = ({ edgeType, startEndpointName, endEndpointName, propertyByName, volatileFieldList }) => {
	const comparable = comparableRecordFor({ rawRecord: rawEdgeRecordFor({ edgeType, startEndpointName, endEndpointName, propertyByName }), volatileFieldList });
	return { edgeHash: comparable.hash, identityText: comparable.identityText, propertyDigestByName: comparable.propertyDigestByName, excludedPropertyNameList: comparable.excludedPropertyNameList };
};

// storeRowRecordFor({ tableName, identityText, rowByColumnName, volatileFieldList }) → { rowHash, identityText, propertyDigestByName, excludedPropertyNameList }
const storeRowRecordFor = ({ tableName, identityText, rowByColumnName, volatileFieldList }) => {
	const excludedNameSet = volatileNameSetFor({ volatileFieldList, scope: 'storeRow', subjectNameList: [tableName] });
	const record = recordOf({ propertyByName: rowByColumnName, excludedNameSet });
	return { rowHash: sha256Of(`row\n${tableName}\n${record.canonicalPropertyText}`), identityText: `${tableName}|${identityText}`, propertyDigestByName: record.propertyDigestByName, excludedPropertyNameList: record.excludedPropertyNameList };
};

// setDigestOf — sha256 over a SORTED hash list: order-free by construction
const setDigestOf = (hashList) => sha256Of(hashList.slice().sort().join('\n'));

// ----- comparison -------------------------------------------------------------------------------------------------------
// countByHashOf — a multiset: identical records (two nodes with equal content) count, they do not collapse. Loops with push
// throughout this section: a reduce-with-concat over 700k edges is quadratic.
const countByHashOf = (hashList) => {
	const countByHash = new Map();
	hashList.forEach((oneHash) => countByHash.set(oneHash, (countByHash.get(oneHash) || 0) + 1));
	return countByHash;
};
// surplusHashListOf — the hashes A holds more often than B, one entry per surplus copy
const surplusHashListOf = (countByHashA, countByHashB) => {
	const surplusList = [];
	countByHashA.forEach((countA, oneHash) => {
		for (let copyIndex = countByHashB.get(oneHash) || 0; copyIndex < countA; copyIndex += 1) {
			surplusList.push(oneHash);
		}
	});
	return surplusList;
};
const byIdentityText = (left, right) => (left.identityText < right.identityText ? -1 : left.identityText > right.identityText ? 1 : 0);

// differencesFor — the property-level account of one A record against one B record of the same identity
const differencesFor = (recordA, recordB) => {
	const nameList = Array.from(new Set(Object.keys(recordA.propertyDigestByName).concat(Object.keys(recordB.propertyDigestByName)))).sort();
	return nameList
		.filter((oneName) => recordA.propertyDigestByName[oneName] !== recordB.propertyDigestByName[oneName])
		.map((oneName) => ({ propertyName: oneName, digestA: recordA.propertyDigestByName[oneName] === undefined ? '(absent)' : recordA.propertyDigestByName[oneName], digestB: recordB.propertyDigestByName[oneName] === undefined ? '(absent)' : recordB.propertyDigestByName[oneName] }));
};

// compareRecordSets({ kindName, recordListA, recordListB, hashFieldName, detailLimit }) → the comparison of one kind
//   identical iff the two multisets of hashes are equal. Every surplus record is COUNTED; the first detailLimit are shown,
//   and a surplus A record whose identity has a surplus B twin is shown as a property-level difference (changed), the rest
//   as only-A / only-B. Totals are always complete; only the samples are capped.
const compareRecordSets = ({ kindName, recordListA, recordListB, hashFieldName, detailLimit }) => {
	const countByHashA = countByHashOf(recordListA.map((oneRecord) => oneRecord[hashFieldName]));
	const countByHashB = countByHashOf(recordListB.map((oneRecord) => oneRecord[hashFieldName]));
	const surplusAList = surplusHashListOf(countByHashA, countByHashB);
	const surplusBList = surplusHashListOf(countByHashB, countByHashA);
	const recordByHashA = new Map(recordListA.map((oneRecord) => [oneRecord[hashFieldName], oneRecord]));
	const recordByHashB = new Map(recordListB.map((oneRecord) => [oneRecord[hashFieldName], oneRecord]));
	const surplusRecordListA = surplusAList.map((oneHash) => recordByHashA.get(oneHash)).sort(byIdentityText);
	const surplusRecordListB = surplusBList.map((oneHash) => recordByHashB.get(oneHash)).sort(byIdentityText);
	// B's surplus records by identity, consumed in order as A's surplus is paired against them
	const unpairedBListByIdentity = new Map();
	surplusRecordListB.forEach((oneRecordB) => unpairedBListByIdentity.set(oneRecordB.identityText, (unpairedBListByIdentity.get(oneRecordB.identityText) || []).concat([oneRecordB])));
	const changedList = [];
	const onlyAList = [];
	surplusRecordListA.forEach((oneRecordA) => {
		const twinList = unpairedBListByIdentity.get(oneRecordA.identityText);
		if (!twinList || twinList.length === 0) {
			onlyAList.push(oneRecordA);
			return;
		}
		changedList.push({ identityText: oneRecordA.identityText, differenceList: differencesFor(oneRecordA, twinList.shift()) });
	});
	// what pairing left behind, in identity order (the map was filled in that order)
	const onlyBList = [];
	unpairedBListByIdentity.forEach((twinList) => twinList.forEach((oneRecordB) => onlyBList.push(oneRecordB)));
	const changedPropertyCountByName = {};
	changedList.forEach((oneChange) => oneChange.differenceList.forEach((oneDifference) => {
		changedPropertyCountByName[oneDifference.propertyName] = (changedPropertyCountByName[oneDifference.propertyName] || 0) + 1;
	}));
	return {
		kindName,
		countA: recordListA.length,
		countB: recordListB.length,
		digestA: setDigestOf(recordListA.map((oneRecord) => oneRecord[hashFieldName])),
		digestB: setDigestOf(recordListB.map((oneRecord) => oneRecord[hashFieldName])),
		identical: surplusAList.length === 0 && surplusBList.length === 0,
		changedCount: changedList.length,
		onlyACount: onlyAList.length,
		onlyBCount: onlyBList.length,
		changedPropertyCountByName,
		changedSampleList: changedList.slice(0, detailLimit),
		onlyASampleList: onlyAList.slice(0, detailLimit).map((oneRecord) => oneRecord.identityText),
		onlyBSampleList: onlyBList.slice(0, detailLimit).map((oneRecord) => oneRecord.identityText),
	};
};

// excludedCensusOf — how many times each volatile property was actually removed, so the report shows the list was USED
const excludedCensusOf = (recordList) => {
	const excludedCountByName = {};
	recordList.forEach((oneRecord) => oneRecord.excludedPropertyNameList.forEach((oneName) => {
		excludedCountByName[oneName] = (excludedCountByName[oneName] || 0) + 1;
	}));
	return excludedCountByName;
};

// verdictFor — pass only when every comparison ran and is identical; an empty comparison list is a refusal, never a pass
const verdictFor = (comparisonList) => {
	if (!Array.isArray(comparisonList) || comparisonList.length === 0) {
		return { verdict: 'fail', detail: `${moduleName}: no comparison ran — nothing was proven repeatable` };
	}
	const differingList = comparisonList.filter((oneComparison) => !oneComparison.identical);
	return differingList.length === 0
		? { verdict: 'pass', detail: `${comparisonList.length} comparison(s) identical: ${comparisonList.map((oneComparison) => `${oneComparison.kindName} ${oneComparison.countA}`).join(', ')}` }
		: { verdict: 'fail', detail: `${differingList.length} of ${comparisonList.length} comparison(s) DIFFER: ${differingList.map((oneComparison) => `${oneComparison.kindName} (changed ${oneComparison.changedCount}, only-A ${oneComparison.onlyACount}, only-B ${oneComparison.onlyBCount}${Object.keys(oneComparison.changedPropertyCountByName).length ? `; properties ${Object.keys(oneComparison.changedPropertyCountByName).map((oneName) => `${oneName} ×${oneComparison.changedPropertyCountByName[oneName]}`).join(', ')}` : ''})`).join('; ')}` };
};

// reportLineListFor — the readable report: the verdict, then per kind its counts and its first samples
const reportLineListFor = ({ comparisonList, verdict }) =>
	[`[reforgeCompare] ${verdict.verdict.toUpperCase()} — ${verdict.detail}`].concat(
		comparisonList.reduce(
			(soFar, oneComparison) =>
				soFar
					.concat([`  ${oneComparison.identical ? 'IDENTICAL' : 'DIFFERENT'} ${oneComparison.kindName}: A ${oneComparison.countA} (${oneComparison.digestA.slice(0, 12)}), B ${oneComparison.countB} (${oneComparison.digestB.slice(0, 12)}); changed ${oneComparison.changedCount}, only-A ${oneComparison.onlyACount}, only-B ${oneComparison.onlyBCount}`])
					.concat(oneComparison.changedSampleList.map((oneChange) => `    changed ${oneChange.identityText}: ${oneChange.differenceList.map((oneDifference) => `${oneDifference.propertyName} ${oneDifference.digestA}→${oneDifference.digestB}`).join(', ')}`))
					.concat(oneComparison.onlyASampleList.map((oneIdentityText) => `    only in A: ${oneIdentityText}`))
					.concat(oneComparison.onlyBSampleList.map((oneIdentityText) => `    only in B: ${oneIdentityText}`)),
			[],
		),
	);

module.exports = {
	moduleName,
	FINGERPRINT_FORMAT,
	REFORGE_EVIDENCE_FORMAT,
	VOLATILE_SCOPE_LIST,
	NO_STABLE_ID_MARK,
	sha256Of,
	volatileFieldListFrom,
	volatileNameSetFor,
	storeTableRuleByNameFrom,
	canonicalValueOf,
	canonicalValueTextOf,
	rawNodeRecordFor,
	rawEdgeRecordFor,
	comparableRecordFor,
	nodeRecordFor,
	endpointNameFor,
	edgeRecordFor,
	storeRowRecordFor,
	setDigestOf,
	compareRecordSets,
	excludedCensusOf,
	verdictFor,
	reportLineListFor,
};
