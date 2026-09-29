'use strict';

// sifFanoutAuditLib.js — phase D3 gate (c), M7 (restated by SPEC A23 / OI-1), and carried items 1 and 2. PURE and synchronous:
// it compares a frozen SIF decision block with what a live DEV graph holds, from rows the CLI (sifFanoutAudit.js) has read.
//
//   fanoutArithmetic        live fan-out edges = Σ instanceStableIdList.length over the block's non-abstained, carded units
//   edgeSetEqualsBlock      the live (Field, card, question) triples EQUAL the block's, one per instance of each picked unit, and
//                           each edge's type, predicate, confidence and decisionBlockHash equal its unit's — so every unit
//                           writes onto its own instances only, with its own card
//   instanceListsMatchGraph for every question, the union of its units' instance lists equals the graph's HAS_INSTANCE Fields,
//                           and no Field sits in two units of one question
//   noEdgeWithoutAnswer     an abstained unit's instances (and an orphan's) carry no edge from that question
//   studentStaffSeparated   the student identifier and the staff identifier Fields sit in DIFFERENT units whose partition labels
//                           are K12 Student Enrollment and K12 Staff Employment, each label equal to the domain file's row for the
//                           Field's own object
//
// A unit is one decision record: its question (subjectStableId) and its partition label.

const OBJECT_NAME_SEGMENT_INDEX = 2; // sif260928:field/<Plural>/<ObjectName>/… → split('/')[2]

const tripleIdentityFor = ({ fieldStableId, objectStableId, judgedSubjectStableId }) => `${fieldStableId}\t${objectStableId}\t${judgedSubjectStableId}`;
const objectNameOfField = (fieldStableId) => fieldStableId.split('/')[OBJECT_NAME_SEGMENT_INDEX];

// pickedRecordListOf — the units that write edges: not abstained, and carrying a card
const pickedRecordListOf = (decisionRecordList) => decisionRecordList.filter((oneRecord) => oneRecord.abstained === false && typeof oneRecord.objectStableId === 'string');

// expectedEdgeListFor — one expected edge per instance of every picked unit
const expectedEdgeListFor = ({ decisionRecordList, edgeTypeByPredicate, decisionBlockHash }) =>
	pickedRecordListOf(decisionRecordList).reduce(
		(soFar, oneRecord) =>
			soFar.concat(
				oneRecord.instanceStableIdList.map((fieldStableId) => ({
					fieldStableId,
					objectStableId: oneRecord.objectStableId,
					judgedSubjectStableId: oneRecord.subjectStableId,
					edgeType: edgeTypeByPredicate[oneRecord.predicate],
					predicate: oneRecord.predicate,
					confidence: oneRecord.confidence,
					decisionBlockHash,
					judgmentPartitionLabel: oneRecord.judgmentPartitionLabel,
				})),
			),
		[],
	);

const fanoutArithmetic = ({ decisionRecordList, liveEdgeList }) => {
	const expectedCount = pickedRecordListOf(decisionRecordList).reduce((soFar, oneRecord) => soFar + oneRecord.instanceStableIdList.length, 0);
	return { pass: expectedCount === liveEdgeList.length, detail: `live ${liveEdgeList.length} fan-out edge(s); Σ instanceCount over ${pickedRecordListOf(decisionRecordList).length} picked unit(s) = ${expectedCount}` };
};

const edgeSetEqualsBlock = ({ expectedEdgeList, liveEdgeList }) => {
	const expectedByTriple = new Map(expectedEdgeList.map((oneEdge) => [tripleIdentityFor(oneEdge), oneEdge]));
	const liveByTriple = new Map(liveEdgeList.map((oneEdge) => [tripleIdentityFor(oneEdge), oneEdge]));
	const missingList = expectedEdgeList.filter((oneEdge) => !liveByTriple.has(tripleIdentityFor(oneEdge)));
	const inventedList = liveEdgeList.filter((oneEdge) => !expectedByTriple.has(tripleIdentityFor(oneEdge)));
	const mismatchList = liveEdgeList
		.filter((oneEdge) => expectedByTriple.has(tripleIdentityFor(oneEdge)))
		.filter((oneEdge) => {
			const expected = expectedByTriple.get(tripleIdentityFor(oneEdge));
			return oneEdge.edgeType !== expected.edgeType || oneEdge.predicate !== expected.predicate || oneEdge.confidence !== expected.confidence || oneEdge.decisionBlockHash !== expected.decisionBlockHash;
		});
	const duplicateCount = liveEdgeList.length - liveByTriple.size;
	return {
		pass: missingList.length === 0 && inventedList.length === 0 && mismatchList.length === 0 && duplicateCount === 0,
		detail: `expected ${expectedEdgeList.length}, live ${liveEdgeList.length}; missing ${missingList.length}, invented ${inventedList.length}, property mismatch ${mismatchList.length}, duplicate triples ${duplicateCount}${missingList.length ? `; first missing ${tripleIdentityFor(missingList[0])}` : ''}${inventedList.length ? `; first invented ${tripleIdentityFor(inventedList[0])}` : ''}${mismatchList.length ? `; first mismatch ${JSON.stringify(mismatchList[0])}` : ''}`,
	};
};

const instanceListsMatchGraph = ({ decisionRecordList, hasInstanceRowList }) => {
	const graphFieldSetByQuestion = new Map();
	hasInstanceRowList.forEach((oneRow) => {
		(graphFieldSetByQuestion.get(oneRow.questionStableId) || graphFieldSetByQuestion.set(oneRow.questionStableId, new Set()).get(oneRow.questionStableId)).add(oneRow.fieldStableId);
	});
	const blockFieldListByQuestion = new Map();
	decisionRecordList.forEach((oneRecord) => {
		blockFieldListByQuestion.set(oneRecord.subjectStableId, (blockFieldListByQuestion.get(oneRecord.subjectStableId) || []).concat(oneRecord.instanceStableIdList));
	});
	const differingQuestionList = Array.from(new Set([...graphFieldSetByQuestion.keys(), ...blockFieldListByQuestion.keys()])).filter((oneQuestion) => {
		const blockFieldList = blockFieldListByQuestion.get(oneQuestion) || [];
		const graphFieldSet = graphFieldSetByQuestion.get(oneQuestion) || new Set();
		return blockFieldList.length !== graphFieldSet.size || new Set(blockFieldList).size !== blockFieldList.length || blockFieldList.some((fieldStableId) => !graphFieldSet.has(fieldStableId));
	});
	return { pass: differingQuestionList.length === 0, detail: `${blockFieldListByQuestion.size} question(s) in the block, ${graphFieldSetByQuestion.size} with HAS_INSTANCE on the graph (${hasInstanceRowList.length} edge(s)); ${differingQuestionList.length} differ${differingQuestionList.length ? `, first ${differingQuestionList[0]}` : ''}` };
};

const noEdgeWithoutAnswer = ({ decisionRecordList, liveEdgeList }) => {
	const livePairSet = new Set(liveEdgeList.map((oneEdge) => `${oneEdge.judgedSubjectStableId}\t${oneEdge.fieldStableId}`));
	const unansweredRecordList = decisionRecordList.filter((oneRecord) => oneRecord.abstained !== false || typeof oneRecord.objectStableId !== 'string');
	const offendingList = unansweredRecordList.reduce((soFar, oneRecord) => soFar.concat(oneRecord.instanceStableIdList.filter((fieldStableId) => livePairSet.has(`${oneRecord.subjectStableId}\t${fieldStableId}`)).map((fieldStableId) => `${oneRecord.subjectStableId} → ${fieldStableId}`)), []);
	const orphanCount = decisionRecordList.filter((oneRecord) => oneRecord.resolution === 'orphan').length;
	return { pass: offendingList.length === 0, detail: `${unansweredRecordList.length} unanswered unit(s) (${orphanCount} orphan), ${unansweredRecordList.reduce((soFar, oneRecord) => soFar + oneRecord.instanceStableIdList.length, 0)} instance(s); ${offendingList.length} carry an edge from their question${offendingList.length ? `, first ${offendingList[0]}` : ''}` };
};

const studentStaffSeparated = ({ decisionRecordList, domainNameByObjectName, studentFieldStableId, staffFieldStableId, studentDomainName, staffDomainName }) => {
	const unitOf = (fieldStableId) => decisionRecordList.find((oneRecord) => oneRecord.instanceStableIdList.indexOf(fieldStableId) !== -1);
	const studentUnit = unitOf(studentFieldStableId);
	const staffUnit = unitOf(staffFieldStableId);
	if (!studentUnit || !staffUnit) {
		return { pass: false, detail: `studentStaffSeparated: no unit holds ${!studentUnit ? studentFieldStableId : staffFieldStableId}` };
	}
	const studentFileDomainName = domainNameByObjectName[objectNameOfField(studentFieldStableId)];
	const staffFileDomainName = domainNameByObjectName[objectNameOfField(staffFieldStableId)];
	const separateUnits = studentUnit !== staffUnit;
	const labelsAsRuled = studentUnit.judgmentPartitionLabel === studentDomainName && staffUnit.judgmentPartitionLabel === staffDomainName;
	const labelsFromOwnObjectRow = studentUnit.judgmentPartitionLabel === studentFileDomainName && staffUnit.judgmentPartitionLabel === staffFileDomainName;
	return {
		pass: separateUnits && labelsAsRuled && labelsFromOwnObjectRow,
		detail: `studentStaffSeparated: student unit ${studentUnit.subjectStableId.slice(-12)} '${studentUnit.judgmentPartitionLabel}' (domain file row for ${objectNameOfField(studentFieldStableId)}: '${studentFileDomainName}'), staff unit ${staffUnit.subjectStableId.slice(-12)} '${staffUnit.judgmentPartitionLabel}' (row for ${objectNameOfField(staffFieldStableId)}: '${staffFileDomainName}'); separate ${separateUnits}; as ruled ${labelsAsRuled}; from own object row ${labelsFromOwnObjectRow}; cards ${studentUnit.objectStableId ? studentUnit.objectStableId.slice(-8) : 'none'} / ${staffUnit.objectStableId ? staffUnit.objectStableId.slice(-8) : 'none'}`,
	};
};

module.exports = { expectedEdgeListFor, fanoutArithmetic, edgeSetEqualsBlock, instanceListsMatchGraph, noEdgeWithoutAnswer, studentStaffSeparated, pickedRecordListOf, objectNameOfField };
