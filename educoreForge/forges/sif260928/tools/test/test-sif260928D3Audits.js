#!/usr/bin/env node
'use strict';

// test-sif260928D3Audits.js — phase D3's hermetic checks on the two audit libraries (sifPromptIdentifierAuditLib.js, M4;
// sifFanoutAuditLib.js, M7). Small hand-built fixtures in the renderer's and the block's own shapes; every conjunct is paired with
// the same fixture carrying the fault it exists to catch, and the pair must disagree. No Docker, no network, no spend.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/tools/test/test-sif260928D3Audits.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: `${moduleName} -- phase D3 audit libraries, hermetic` });
const harness = require('../../../../test/testLib/harness')(moduleName);

const path = require('path');
const promptAuditLib = require(path.join(__dirname, '..', 'sifPromptIdentifierAuditLib'));
const fanoutAuditLib = require(path.join(__dirname, '..', 'sifFanoutAuditLib'));

// ---- M4: the prompt audit ----
const PATTERN_LIST = [
	{ patternName: 'cedsPropertyId', regexSource: 'P\\d{6}' },
	{ patternName: 'cedsClassId', regexSource: 'C\\d{6}' },
];
const compiledScan = promptAuditLib.compileAuditScan({ identifierPatternList: PATTERN_LIST, identifierList: ['000505'], hubIdentifierList: ['P000505', 'P000102', 'C200291'] });
const userPromptFor = ({ subjectName, candidateName }) =>
	[
		'Find the best possible match for this SOURCE ELEMENT:',
		'',
		'SOURCE ELEMENT (what you are matching FROM):',
		`  name: ${subjectName}`,
		'',
		'Selected from this CANDIDATE ELEMENTS list:',
		'',
		'CANDIDATE ELEMENTS (1), in hub order:',
		'  CANDIDATE INDEX NUMBER: [1]',
		`      name: ${candidateName}`,
		'Answer with one of: 1, or NONE, as well as a RATIONALE.',
	].join('\n');
const recordFor = (overrides) => ({ promptHash: 'h', systemPrompt: 'You are a data standards expert.', userPrompt: userPromptFor({ subjectName: 'LocalId', candidateName: 'Person Identifier' }), reaskUserPrompt: null, renderedPoolStableIdList: ['card1'], ...overrides });
const auditOf = (record) => promptAuditLib.auditRecord({ record, compiledScan, predicateRule: 'judgeSlot-v1' });

harness.section('M4 — the prompt audit');
const cleanAudit = auditOf(recordFor({}));
harness.equal('a clean record carries no hit', cleanAudit.hitList.length, 0);
harness.ok('every part of the user prompt is non-empty', cleanAudit.charCountBySurfaceName.subjectText > 0 && cleanAudit.charCountBySurfaceName.candidateText > 0 && cleanAudit.charCountBySurfaceName.userFixedWording > 0, JSON.stringify(cleanAudit.charCountBySurfaceName));
harness.ok('both tool texts are rendered and scanned', cleanAudit.charCountBySurfaceName.toolTextEveryDialect > 0 && cleanAudit.charCountBySurfaceName.toolTextRealJudge > 0, JSON.stringify(cleanAudit.charCountBySurfaceName));
[
	{ label: 'P000505 in the system prompt', record: recordFor({ systemPrompt: 'You are a data standards expert. P000505' }), surfaceName: 'systemPrompt', patternName: 'cedsPropertyId' },
	{ label: 'the bare listed id in a candidate card', record: recordFor({ userPrompt: userPromptFor({ subjectName: 'LocalId', candidateName: 'Person Identifier 000505' }) }), surfaceName: 'candidateText', patternName: 'identifierList' },
	{ label: 'C200291 in the subject text', record: recordFor({ userPrompt: userPromptFor({ subjectName: 'LocalId C200291', candidateName: 'Person Identifier' }) }), surfaceName: 'subjectText', patternName: 'cedsClassId' },
	{ label: 'P000505 in the re-ask prompt', record: recordFor({ reaskUserPrompt: 'Please give a rationale. P000505' }), surfaceName: 'reaskUserPrompt', patternName: 'cedsPropertyId' },
].forEach((oneCase) => {
	const planted = auditOf(oneCase.record);
	harness.ok(`RED on ${oneCase.label}`, planted.hitList.some((oneHit) => oneHit.surfaceName === oneCase.surfaceName && oneHit.patternName === oneCase.patternName), JSON.stringify(planted.hitList));
});
harness.equal('a listed id inside a longer digit run is not a list hit', auditOf(recordFor({ userPrompt: userPromptFor({ subjectName: 'LocalId 10005051', candidateName: 'Person Identifier' }) })).hitList.length, 0);
const hubTokenAudit = promptAuditLib.auditRecordList({ recordList: [recordFor({ userPrompt: userPromptFor({ subjectName: 'LocalId corresponds to the global CEDS Id 000102', candidateName: 'Person Identifier' }) })], compiledScan, predicateRule: 'judgeSlot-v1' });
harness.equal('a bare id the hub knows but the list does not is a hub hit', hubTokenAudit.hubHitRecordList.length, 1);
harness.equal('…and is not a list hit', hubTokenAudit.hitRecordList.length, 0);
const unknownTokenAudit = promptAuditLib.auditRecordList({ recordList: [recordFor({ userPrompt: userPromptFor({ subjectName: 'LocalId zip 123456', candidateName: 'Person Identifier' }) })], compiledScan, predicateRule: 'judgeSlot-v1' });
harness.ok('a bare six-digit token the hub does not know is information only', unknownTokenAudit.hubHitRecordList.length === 0 && unknownTokenAudit.unlistedSixDigitCountByToken['123456'] === 1, JSON.stringify(unknownTokenAudit.unlistedSixDigitCountByToken));
harness.match('a prompt without the renderer headings is refused by name', auditOf(recordFor({ userPrompt: 'no headings here' })).refusalText, /lacks, or misorders, the subject heading/);

// ---- M7: the fan-out audit ----
const EDGE_TYPE_BY_PREDICATE = { exactMatch: 'EXACT_MATCH', closeMatch: 'CLOSE_MATCH' };
const BLOCK_HASH = 'b'.repeat(64);
const STUDENT_FIELD = 'sif260928:field/StudentPersonals/StudentPersonal/LocalId';
const STAFF_FIELD = 'sif260928:field/StaffPersonals/StaffPersonal/LocalId';
const recordList = [
	{ subjectStableId: 'q1', judgmentPartitionLabel: 'K12 Student Enrollment', abstained: false, objectStableId: 'cardStudent', predicate: 'exactMatch', confidence: 0.7, resolution: 'judged', instanceStableIdList: [STUDENT_FIELD] },
	{ subjectStableId: 'q2', judgmentPartitionLabel: 'K12 Staff Employment', abstained: false, objectStableId: 'cardStaff', predicate: 'closeMatch', confidence: 0.5, resolution: 'judged', instanceStableIdList: [STAFF_FIELD] },
	{ subjectStableId: 'q3', judgmentPartitionLabel: 'Learner Activity', abstained: true, objectStableId: null, predicate: null, confidence: null, resolution: 'judged', instanceStableIdList: ['sif260928:field/Activitys/Activity/Name'] },
];
const hasInstanceRowList = recordList.reduce((soFar, oneRecord) => soFar.concat(oneRecord.instanceStableIdList.map((fieldStableId) => ({ questionStableId: oneRecord.subjectStableId, fieldStableId }))), []);
const expectedEdgeList = fanoutAuditLib.expectedEdgeListFor({ decisionRecordList: recordList, edgeTypeByPredicate: EDGE_TYPE_BY_PREDICATE, decisionBlockHash: BLOCK_HASH });
const liveEdgeList = expectedEdgeList.map((oneEdge) => ({ fieldStableId: oneEdge.fieldStableId, objectStableId: oneEdge.objectStableId, edgeType: oneEdge.edgeType, predicate: oneEdge.predicate, confidence: oneEdge.confidence, judgedSubjectStableId: oneEdge.judgedSubjectStableId, decisionBlockHash: oneEdge.decisionBlockHash }));
const domainNameByObjectName = { StudentPersonal: 'K12 Student Enrollment', StaffPersonal: 'K12 Staff Employment', Activity: 'Learner Activity' };
const separationOf = (domainMap) => fanoutAuditLib.studentStaffSeparated({ decisionRecordList: recordList, domainNameByObjectName: domainMap, studentFieldStableId: STUDENT_FIELD, staffFieldStableId: STAFF_FIELD, studentDomainName: 'K12 Student Enrollment', staffDomainName: 'K12 Staff Employment' });

harness.section('M7 — the fan-out audit');
harness.ok('fanoutArithmetic: 2 picked instances, 2 edges', fanoutAuditLib.fanoutArithmetic({ decisionRecordList: recordList, liveEdgeList }).pass);
harness.ok('RED fanoutArithmetic on a dropped edge', !fanoutAuditLib.fanoutArithmetic({ decisionRecordList: recordList, liveEdgeList: liveEdgeList.slice(1) }).pass);
harness.ok('edgeSetEqualsBlock', fanoutAuditLib.edgeSetEqualsBlock({ expectedEdgeList, liveEdgeList }).pass);
harness.ok('RED edgeSetEqualsBlock on an edge moved to the other unit\'s card', !fanoutAuditLib.edgeSetEqualsBlock({ expectedEdgeList, liveEdgeList: [{ ...liveEdgeList[0], objectStableId: 'cardStaff' }, liveEdgeList[1]] }).pass);
harness.ok('RED edgeSetEqualsBlock on a changed confidence', !fanoutAuditLib.edgeSetEqualsBlock({ expectedEdgeList, liveEdgeList: [{ ...liveEdgeList[0], confidence: 0.9 }, liveEdgeList[1]] }).pass);
harness.ok('instanceListsMatchGraph', fanoutAuditLib.instanceListsMatchGraph({ decisionRecordList: recordList, hasInstanceRowList }).pass);
harness.ok('RED instanceListsMatchGraph on a detached HAS_INSTANCE', !fanoutAuditLib.instanceListsMatchGraph({ decisionRecordList: recordList, hasInstanceRowList: hasInstanceRowList.slice(1) }).pass);
harness.ok('noEdgeWithoutAnswer', fanoutAuditLib.noEdgeWithoutAnswer({ decisionRecordList: recordList, liveEdgeList }).pass);
harness.ok('RED noEdgeWithoutAnswer on an edge from an abstained unit', !fanoutAuditLib.noEdgeWithoutAnswer({ decisionRecordList: recordList, liveEdgeList: liveEdgeList.concat([{ ...liveEdgeList[0], fieldStableId: 'sif260928:field/Activitys/Activity/Name', judgedSubjectStableId: 'q3' }]) }).pass);
harness.ok('studentStaffSeparated', separationOf(domainNameByObjectName).pass, separationOf(domainNameByObjectName).detail);
const swapped = separationOf({ ...domainNameByObjectName, StudentPersonal: 'K12 Staff Employment', StaffPersonal: 'K12 Student Enrollment' });
harness.ok('RED studentStaffSeparated on swapped domain rows, by name', !swapped.pass && /^studentStaffSeparated:/.test(swapped.detail), swapped.detail);

harness.report();
