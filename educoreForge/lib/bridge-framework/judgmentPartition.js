'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// judgmentPartition.js — judging one subject once per PARTITION of its instances (phase B4p, 2026-09-28).
//
// A subject (a question standing for many instances) may mean different things in different places. With the
// optional declaration key judgmentPartition, each subject's instances are split by a partition label read from a
// declared, checksummed file, and each (subject, partition) pair becomes one judgment unit: judged once, with its
// label stated in the prompt, and frozen with the list of instances that belong to it.
//
//   JUDGMENT_PARTITION_KIND_REGISTRY               kind → { memberNameList, readLabelByObjectName }
//   declarationReason(value)                       the contract row's shape check → '' | reason
//   partitionFilePathFor({ filePath, forgesDirPath, standardKey }) → absolute path
//   readPartitionFile({ partitionDeclaration, filePath }) → { labelByObjectName } | { error }
//   partitionLeafList({ leafList, partitionDeclaration, labelByObjectName, instanceEdgeList, subjectNodeByStableId })
//       → { leafList, unitCount, unpartitionedSubjectCount } | { error }
//
// HOW AN INSTANCE'S OBJECT IS LEARNED. The subject reaches its instances through the declared instanceEdgeType
// (subject → instance). Each instance names the object it sits in through the declared instanceObjectPropertyName.
// The partition file maps that object name to a label. Nothing else is consulted: no path is parsed and no name is
// guessed.
//
// THE UNPARTITIONED SUBJECT. A subject whose own property (unpartitionedSubjectRule.propertyName) holds one of the
// declared values is ONE unit, whatever objects its instances sit in. It carries the label null and all its instances.
// The rule is declared because a shared block copied into every object has instances in every object, so "sits in no
// partitioned object" cannot be observed from the graph.
//
// WHERE THE GUARDS ARE. The file and the graph it is applied to are data entering the framework, so these are refused
// by name here: a checksum other than the declared one, a blank cell, an object named twice, an object missing from the
// file, a subject with no instance, and a subject already carrying the rendered name. Each guard is the ONLY catcher of
// its fault (EBONY_DREAM, B4p back-gate): an absent file is the platform's ENOENT; a header lacking a declared column
// reads every cell of that column as blank; an instance naming no object is an object missing from the file. The
// declaration gets a shape check here; its cross-key rules (the acquisition row admitting it, the subject allow-list,
// the blinding) are in bridgePluginContract.js.
//
// WHAT READS THE FROZEN FIELDS. Each record carries judgmentPartitionLabel and judgmentPartitionInstanceStableIdList.
// The materialiser does not read them: it writes one subject → card edge per picked record, as it always has, so two
// units of one subject may write two edges from that subject.
//
// PURE and synchronous. It returns a result or an error; the orchestration side hands the error to its callback.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const OBJECT_PARTITION_FILE_KIND = 'objectPartitionFile';
const UNPARTITIONED_RULE_MEMBER_LIST = Object.freeze(['propertyName', 'valueList']);
const NAME_MEMBER_LIST = Object.freeze(['filePath', 'instanceEdgeType', 'instanceObjectPropertyName', 'objectColumnName', 'partitionLabelColumnName', 'renderedPropertyName']);
const TSV_FIELD_SEPARATOR = '\t';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const hasExactMembers = (candidate, memberNameList) => isPlainObject(candidate) && Object.keys(candidate).length === memberNameList.length && memberNameList.every((oneName) => Object.prototype.hasOwnProperty.call(candidate, oneName));
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const sha256HexOfBytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// declarationReason — the shape of { kind, filePath, sha256, instanceEdgeType, instanceObjectPropertyName,
// objectColumnName, partitionLabelColumnName, renderedPropertyName, unpartitionedSubjectRule }
const declarationReason = (value) => {
	if (!isPlainObject(value) || JUDGMENT_PARTITION_KIND_REGISTRY[value.kind] === undefined) {
		return `must be an object whose kind is one of ${Object.keys(JUDGMENT_PARTITION_KIND_REGISTRY).join(', ')} (got ${JSON.stringify(value)})`;
	}
	const memberNameList = JUDGMENT_PARTITION_KIND_REGISTRY[value.kind].memberNameList;
	if (!hasExactMembers(value, memberNameList)) {
		return `kind '${value.kind}' must be exactly { ${memberNameList.join(', ')} } (got ${JSON.stringify(Object.keys(value).sort())})`;
	}
	const blankMemberName = NAME_MEMBER_LIST.find((oneName) => !isNonEmptyString(value[oneName]));
	if (blankMemberName !== undefined) {
		return `${blankMemberName} must be a non-empty string (got ${JSON.stringify(value[blankMemberName])})`;
	}
	if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
		return `sha256 must be the file's 64-hex lowercase sha256 (got ${JSON.stringify(value.sha256)})`;
	}
	const rule = value.unpartitionedSubjectRule;
	if (rule !== null && !(hasExactMembers(rule, UNPARTITIONED_RULE_MEMBER_LIST) && isNonEmptyString(rule.propertyName) && Array.isArray(rule.valueList) && rule.valueList.length > 0 && rule.valueList.every(isNonEmptyString))) {
		return `unpartitionedSubjectRule must be null or { propertyName, valueList } with a non-empty list of non-empty strings (got ${JSON.stringify(rule)})`;
	}
	return '';
};

// partitionFilePathFor — RELATIVE TO THE PLUGIN'S OWN FORGE BUNDLE, as the scope list and the identifier list are, so
// the declaration digest is not machine-specific; an absolute path is honoured for a file outside the bundle
const partitionFilePathFor = ({ filePath, forgesDirPath, standardKey }) => (path.isAbsolute(filePath) ? filePath : path.join(forgesDirPath, standardKey, filePath));

// readPartitionFile — a tab-separated file with a header row; the declared columns give each object its label
const readPartitionFile = ({ partitionDeclaration, filePath }) => {
	const refusalFor = (what, where) => ({ error: refuse.byName({ moduleName, what, where }) });
	const partitionFileWhere = 'the partition file is declared, checksummed data; fix the file or the declaration, never the check';
	const fileBytes = fs.readFileSync(filePath);
	const measuredSha256 = sha256HexOfBytes(fileBytes);
	if (measuredSha256 !== partitionDeclaration.sha256) {
		return refusalFor(`judgmentPartition file ${filePath} has sha256 ${measuredSha256} but the declaration states ${partitionDeclaration.sha256}`, 'the file changed after it was declared; re-review it and restate its sha256, never skip the check');
	}
	const lineList = fileBytes.toString('utf8').split(/\r?\n/);
	if (lineList[lineList.length - 1] === '') {
		lineList.pop();
	}
	const headerCellList = lineList[0].split(TSV_FIELD_SEPARATOR);
	const objectColumnIndex = headerCellList.indexOf(partitionDeclaration.objectColumnName);
	const labelColumnIndex = headerCellList.indexOf(partitionDeclaration.partitionLabelColumnName);
	const labelByObjectName = new Map();
	for (let lineIndex = 1; lineIndex < lineList.length; lineIndex++) {
		const cellList = lineList[lineIndex].split(TSV_FIELD_SEPARATOR);
		const objectName = cellList[objectColumnIndex] === undefined ? '' : cellList[objectColumnIndex].trim();
		const partitionLabel = cellList[labelColumnIndex] === undefined ? '' : cellList[labelColumnIndex].trim();
		if (objectName === '' || partitionLabel === '') {
			return refusalFor(`judgmentPartition file ${filePath} line ${lineIndex + 1} has a blank ${objectName === '' ? `'${partitionDeclaration.objectColumnName}'` : `'${partitionDeclaration.partitionLabelColumnName}'`} cell`, partitionFileWhere);
		}
		if (labelByObjectName.has(objectName)) {
			return refusalFor(`judgmentPartition file ${filePath} names object '${objectName}' twice (line ${lineIndex + 1})`, 'one object, one label; a second row is a disagreement the file must settle');
		}
		labelByObjectName.set(objectName, partitionLabel);
	}
	return { labelByObjectName };
};

// JUDGMENT_PARTITION_KIND_REGISTRY — one row per partition kind: its declaration members and the reader that turns its
// file into { labelByObjectName }. A new kind is a row here and its reader, never a branch in the orchestrator.
const JUDGMENT_PARTITION_KIND_REGISTRY = Object.freeze({
	[OBJECT_PARTITION_FILE_KIND]: Object.freeze({
		memberNameList: Object.freeze(['kind', 'filePath', 'sha256', 'instanceEdgeType', 'instanceObjectPropertyName', 'objectColumnName', 'partitionLabelColumnName', 'renderedPropertyName', 'unpartitionedSubjectRule']),
		readLabelByObjectName: readPartitionFile,
	}),
});

// partitionLeafList — each leaf becomes one leaf per distinct label of its instances (sorted by label), carrying
// judgmentPartitionLabel and judgmentPartitionInstanceStableIdList; an unpartitioned subject stays one leaf with label null
const partitionLeafList = ({ leafList, partitionDeclaration, labelByObjectName, instanceEdgeList, subjectNodeByStableId }) => {
	const refusalFor = (what, where) => ({ error: refuse.byName({ moduleName, what, where }) });
	const instanceStableIdListBySubject = new Map();
	instanceEdgeList
		.filter((oneEdge) => oneEdge.type === partitionDeclaration.instanceEdgeType)
		.forEach((oneEdge) => {
			if (!instanceStableIdListBySubject.has(oneEdge.fromStableId)) {
				instanceStableIdListBySubject.set(oneEdge.fromStableId, []);
			}
			instanceStableIdListBySubject.get(oneEdge.fromStableId).push(oneEdge.toStableId);
		});
	const rule = partitionDeclaration.unpartitionedSubjectRule;
	const partitionedLeafList = [];
	let unpartitionedSubjectCount = 0;
	for (let leafIndex = 0; leafIndex < leafList.length; leafIndex++) {
		const oneLeaf = leafList[leafIndex];
		const subjectProperties = subjectNodeByStableId[oneLeaf.subjectStableId].properties;
		if (Object.prototype.hasOwnProperty.call(subjectProperties, partitionDeclaration.renderedPropertyName)) {
			return refusalFor(`subject ${oneLeaf.subjectStableId} already carries a property named '${partitionDeclaration.renderedPropertyName}', the name the partition label renders under`, 'choose a renderedPropertyName no subject carries, so the rendered line says one thing');
		}
		const instanceStableIdList = (instanceStableIdListBySubject.get(oneLeaf.subjectStableId) || []).slice().sort(compareStrings);
		if (instanceStableIdList.length === 0) {
			return refusalFor(`subject ${oneLeaf.subjectStableId} has no '${partitionDeclaration.instanceEdgeType}' instance`, 'a partitioned run judges a subject for the instances it stands for; a subject with none cannot be partitioned');
		}
		if (rule !== null && rule.valueList.indexOf(subjectProperties[rule.propertyName]) !== -1) {
			unpartitionedSubjectCount += 1;
			partitionedLeafList.push({ ...oneLeaf, judgmentPartitionLabel: null, judgmentPartitionInstanceStableIdList: instanceStableIdList });
			continue;
		}
		const instanceStableIdListByLabel = new Map();
		for (let instanceIndex = 0; instanceIndex < instanceStableIdList.length; instanceIndex++) {
			const instanceStableId = instanceStableIdList[instanceIndex];
			const objectName = subjectNodeByStableId[instanceStableId].properties[partitionDeclaration.instanceObjectPropertyName];
			const partitionLabel = labelByObjectName.get(objectName);
			if (partitionLabel === undefined) {
				return refusalFor(`object '${objectName}' (instance ${instanceStableId} of subject ${oneLeaf.subjectStableId}) is missing from the judgment partition file`, 'every object an instance sits in has a line in the file; add the line, never skip the instance');
			}
			if (!instanceStableIdListByLabel.has(partitionLabel)) {
				instanceStableIdListByLabel.set(partitionLabel, []);
			}
			instanceStableIdListByLabel.get(partitionLabel).push(instanceStableId);
		}
		Array.from(instanceStableIdListByLabel.keys())
			.sort(compareStrings)
			.forEach((partitionLabel) => partitionedLeafList.push({ ...oneLeaf, judgmentPartitionLabel: partitionLabel, judgmentPartitionInstanceStableIdList: instanceStableIdListByLabel.get(partitionLabel) }));
	}
	return { leafList: partitionedLeafList, unitCount: partitionedLeafList.length, unpartitionedSubjectCount };
};

module.exports = {
	OBJECT_PARTITION_FILE_KIND,
	JUDGMENT_PARTITION_KIND_REGISTRY,
	declarationReason,
	partitionFilePathFor,
	readPartitionFile,
	partitionLeafList,
	moduleName,
};
