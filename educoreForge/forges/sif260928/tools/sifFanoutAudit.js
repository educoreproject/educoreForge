#!/usr/bin/env node
'use strict';

// sifFanoutAudit.js — phase D3 gate (c), M7 restated (SPEC A23 / OI-1), with carried items 1 (the live fan-out edges are correct)
// and 2 (abstained and orphan units write no edge). ONE read of a DEV_ graph (the Question → Field HAS_INSTANCE edges and every
// fan-out mapping edge), then the conjuncts of sifFanoutAuditLib.js against the frozen block and the domain file. Each conjunct is
// then re-run on an in-memory SCRATCH copy carrying its twin's fault, and must go red (printed as RED-OBSERVED lines):
//   detachOneHasInstance   one HAS_INSTANCE row removed from the read            → instanceListsMatchGraph refused
//   swapStudentStaffRows   the StudentPersonal and StaffPersonal domain rows swapped → studentStaffSeparated red by name
//   dropOneLiveEdge        one fan-out edge removed from the read                 → edgeSetEqualsBlock and fanoutArithmetic red
//   edgeOnAbstainedUnit    one edge planted on an abstained unit's instance        → noEdgeWithoutAnswer red
// READ-ONLY on the graph.
//
// Run: PATH=/usr/local/bin:$PATH node --max-old-space-size=16000 forges/sif260928/tools/sifFanoutAudit.js --containerName=DEV_… \
//        --decisionBlockFilePath=<block.json> --domainFilePath=<objectDomainAssignment.tsv> --outputFilePath=<report.json>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the live fan-out of a SIF decision block, checked unit by unit against the graph

SYNOPSIS
     ${moduleName} --containerName=<DEV_*> --decisionBlockFilePath=<json> --domainFilePath=<tsv> --outputFilePath=<json>

EXIT
     0 every conjunct PASSES and every twin went red;  1 otherwise, or refused.
`;

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const { SKOS_EDGE_TYPES } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const auditLib = require(path.join(__dirname, 'sifFanoutAuditLib'));

const SCRATCH_CONTAINER_PATTERN = /^DEV_[A-Za-z0-9_]+$/;
const QUESTION_PREFIX = 'sif260928:question/';
const STUDENT_FIELD_STABLE_ID = 'sif260928:field/StudentPersonals/StudentPersonal/LocalId';
const STAFF_FIELD_STABLE_ID = 'sif260928:field/StaffPersonals/StaffPersonal/LocalId';
const STUDENT_DOMAIN_NAME = 'K12 Student Enrollment';
const STAFF_DOMAIN_NAME = 'K12 Staff Employment';

const refuseAndExit = (refusalText) => {
	xLog.error(`${moduleName}: REFUSED: ${refusalText}`);
	process.exit(1);
};
const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};

const containerName = flagValueOf('containerName');
const decisionBlockFilePath = flagValueOf('decisionBlockFilePath');
const domainFilePath = flagValueOf('domainFilePath');
const outputFilePath = flagValueOf('outputFilePath');
if (typeof containerName !== 'string' || !SCRATCH_CONTAINER_PATTERN.test(containerName)) {
	refuseAndExit(`--containerName must name a DEV_ scratch graph (got ${JSON.stringify(containerName)})`);
}
[['decisionBlockFilePath', decisionBlockFilePath], ['domainFilePath', domainFilePath]].forEach(([flagName, filePath]) => {
	if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
		refuseAndExit(`--${flagName} is required and must exist (got ${JSON.stringify(filePath)})`);
	}
});
if (typeof outputFilePath !== 'string' || !fs.existsSync(path.dirname(outputFilePath))) {
	refuseAndExit(`--outputFilePath is required and its directory must exist (got ${JSON.stringify(outputFilePath)})`);
}

// the container's bolt port and password, read from docker itself
const inspectText = childProcess.execFileSync('docker', ['inspect', containerName, '--format', '{{range .Config.Env}}{{println .}}{{end}}']).toString();
const authLine = inspectText.split('\n').find((oneLine) => oneLine.startsWith('NEO4J_AUTH='));
const boltPortText = childProcess.execFileSync('docker', ['port', containerName, '7687']).toString().split('\n')[0];
if (!authLine || !boltPortText) {
	refuseAndExit(`${containerName} has no NEO4J_AUTH or no published bolt port`);
}
const password = authLine.split('/').slice(1).join('/');
const boltUrl = `bolt://localhost:${boltPortText.split(':').pop()}`;

const edgeTypeByPredicate = SKOS_EDGE_TYPES;
const edgeTypeList = Object.keys(SKOS_EDGE_TYPES).map((onePredicate) => SKOS_EDGE_TYPES[onePredicate]);

const taskList = new taskListPlus();

taskList.push((args, next) => {
	const neo4j = require(path.join(TREE_ROOT, 'node_modules', 'neo4j-driver'));
	const driver = neo4j.driver(boltUrl, neo4j.auth.basic('neo4j', password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const hasInstanceCypher = `MATCH (q:ForgedNode)-[:HAS_INSTANCE]->(f:ForgedNode) WHERE q.stableId STARTS WITH $questionPrefix RETURN q.stableId AS questionStableId, f.stableId AS fieldStableId`;
	const edgeCypher = `MATCH (f:ForgedNode)-[r]->(c:HubReference) WHERE type(r) IN $edgeTypeList AND r.judgedSubjectStableId IS NOT NULL RETURN f.stableId AS fieldStableId, c.stableId AS objectStableId, type(r) AS edgeType, r.predicate AS predicate, r.mappingConfidence AS confidence, r.judgedSubjectStableId AS judgedSubjectStableId, r.decisionBlockHash AS decisionBlockHash`;
	const startMilliseconds = Date.now();
	session
		.run(hasInstanceCypher, { questionPrefix: QUESTION_PREFIX })
		.then((hasInstanceResult) =>
			session.run(edgeCypher, { edgeTypeList }).then((edgeResult) => {
				const hasInstanceRowList = hasInstanceResult.records.map((oneRecord) => oneRecord.toObject());
				const liveEdgeList = edgeResult.records.map((oneRecord) => oneRecord.toObject());
				xLog.status(`${moduleName}: read ${hasInstanceRowList.length} HAS_INSTANCE and ${liveEdgeList.length} fan-out edge(s) from ${containerName} in ${((Date.now() - startMilliseconds) / 1000).toFixed(1)}s`);
				return session.close().then(() => driver.close()).then(() => next('', { ...args, hasInstanceRowList, liveEdgeList }));
			}),
		)
		.catch((runError) => {
			driver.close().then(() => next(`${moduleName}: graph read failed: ${runError.message}`));
		});
});

taskList.push((args, next) => {
	const blockText = fs.readFileSync(decisionBlockFilePath, 'utf8');
	// the block is content-addressed: the sha256 of its frozen text IS its decisionBlockHash, the value every edge carries
	const decisionBlockHash = crypto.createHash('sha256').update(blockText, 'utf8').digest('hex');
	const block = JSON.parse(blockText);
	const domainNameByObjectName = fs
		.readFileSync(domainFilePath, 'utf8')
		.split('\n')
		.slice(1)
		.filter((oneLine) => oneLine.length > 0)
		.reduce((soFar, oneLine) => {
			const cellList = oneLine.split('\t');
			return { ...soFar, [cellList[0]]: cellList[1] };
		}, {});
	next('', { ...args, decisionRecordList: block.decisionRecordList, decisionBlockHash, domainNameByObjectName });
});

taskList.push((args, next) => {
	// conjunctsFor — every conjunct over one (possibly faulted) view of the inputs
	const conjunctsFor = ({ decisionRecordList, liveEdgeList, hasInstanceRowList, domainNameByObjectName }) => {
		const expectedEdgeList = auditLib.expectedEdgeListFor({ decisionRecordList, edgeTypeByPredicate, decisionBlockHash: args.decisionBlockHash });
		return {
			fanoutArithmetic: auditLib.fanoutArithmetic({ decisionRecordList, liveEdgeList }),
			edgeSetEqualsBlock: auditLib.edgeSetEqualsBlock({ expectedEdgeList, liveEdgeList }),
			instanceListsMatchGraph: auditLib.instanceListsMatchGraph({ decisionRecordList, hasInstanceRowList }),
			noEdgeWithoutAnswer: auditLib.noEdgeWithoutAnswer({ decisionRecordList, liveEdgeList }),
			studentStaffSeparated: auditLib.studentStaffSeparated({ decisionRecordList, domainNameByObjectName, studentFieldStableId: STUDENT_FIELD_STABLE_ID, staffFieldStableId: STAFF_FIELD_STABLE_ID, studentDomainName: STUDENT_DOMAIN_NAME, staffDomainName: STAFF_DOMAIN_NAME }),
		};
	};
	const realView = { decisionRecordList: args.decisionRecordList, liveEdgeList: args.liveEdgeList, hasInstanceRowList: args.hasInstanceRowList, domainNameByObjectName: args.domainNameByObjectName };
	const conjunctByName = conjunctsFor(realView);
	const abstainedRecord = args.decisionRecordList.find((oneRecord) => oneRecord.abstained === true && oneRecord.instanceStableIdList.length > 0);
	const twinList = [
		{ twinName: 'detachOneHasInstance', conjunctNameList: ['instanceListsMatchGraph'], view: { ...realView, hasInstanceRowList: realView.hasInstanceRowList.slice(1) } },
		{ twinName: 'swapStudentStaffRows', conjunctNameList: ['studentStaffSeparated'], view: { ...realView, domainNameByObjectName: { ...realView.domainNameByObjectName, StudentPersonal: realView.domainNameByObjectName.StaffPersonal, StaffPersonal: realView.domainNameByObjectName.StudentPersonal } } },
		{ twinName: 'dropOneLiveEdge', conjunctNameList: ['edgeSetEqualsBlock', 'fanoutArithmetic'], view: { ...realView, liveEdgeList: realView.liveEdgeList.slice(1) } },
		{ twinName: 'edgeOnAbstainedUnit', conjunctNameList: ['noEdgeWithoutAnswer'], view: { ...realView, liveEdgeList: realView.liveEdgeList.concat(abstainedRecord ? [{ ...realView.liveEdgeList[0], fieldStableId: abstainedRecord.instanceStableIdList[0], judgedSubjectStableId: abstainedRecord.subjectStableId }] : []) } },
	];
	const twinResultList = twinList.map((oneTwin) => {
		const twinConjunctByName = conjunctsFor(oneTwin.view);
		return { twinName: oneTwin.twinName, redConjunctList: oneTwin.conjunctNameList.map((oneConjunctName) => ({ conjunctName: oneConjunctName, red: !twinConjunctByName[oneConjunctName].pass, detail: twinConjunctByName[oneConjunctName].detail })) };
	});
	next('', { ...args, conjunctByName, twinResultList });
});

taskList.push((args, next) => {
	Object.keys(args.conjunctByName).forEach((oneConjunctName) => xLog.status(`${args.conjunctByName[oneConjunctName].pass ? 'PASS' : 'FAIL'} ${oneConjunctName}: ${args.conjunctByName[oneConjunctName].detail}`));
	args.twinResultList.forEach((oneTwin) => oneTwin.redConjunctList.forEach((oneRed) => xLog.status(`${oneRed.red ? 'RED-OBSERVED' : 'TWIN STAYED GREEN'} ${oneRed.conjunctName} twin='${oneTwin.twinName}' lever=inputFault → ${oneRed.detail}`)));
	// carried item 1: three sample edges, beside their unit
	const sampleEdgeList = [0, Math.floor(args.liveEdgeList.length / 2), args.liveEdgeList.length - 1].map((edgeIndex) => args.liveEdgeList[edgeIndex]).filter((oneEdge) => oneEdge !== undefined);
	const sampleList = sampleEdgeList.map((oneEdge) => {
		const unit = args.decisionRecordList.find((oneRecord) => oneRecord.subjectStableId === oneEdge.judgedSubjectStableId && oneRecord.instanceStableIdList.indexOf(oneEdge.fieldStableId) !== -1);
		return { liveEdge: oneEdge, unit: unit ? { subjectStableId: unit.subjectStableId, judgmentPartitionLabel: unit.judgmentPartitionLabel, objectStableId: unit.objectStableId, predicate: unit.predicate, confidence: unit.confidence, instanceCount: unit.instanceStableIdList.length } : null };
	});
	sampleList.forEach((oneSample) => xLog.status(`SAMPLE ${oneSample.liveEdge.fieldStableId} -[${oneSample.liveEdge.edgeType} ${oneSample.liveEdge.confidence}]-> …${oneSample.liveEdge.objectStableId.slice(-8)} judged ${oneSample.liveEdge.judgedSubjectStableId.slice(-12)}; unit ${oneSample.unit ? `'${oneSample.unit.judgmentPartitionLabel}' card …${oneSample.unit.objectStableId.slice(-8)} ${oneSample.unit.predicate} ${oneSample.unit.confidence}` : 'NONE'}`));
	fs.writeFileSync(outputFilePath, JSON.stringify({ containerName, decisionBlockFilePath, decisionBlockHash: args.decisionBlockHash, domainFilePath, conjunctByName: args.conjunctByName, twinResultList: args.twinResultList, sampleList }, null, '\t'));
	xLog.status(`${moduleName}: report written to ${outputFilePath}`);
	const allGreen = Object.keys(args.conjunctByName).every((oneConjunctName) => args.conjunctByName[oneConjunctName].pass);
	const allTwinsRed = args.twinResultList.every((oneTwin) => oneTwin.redConjunctList.every((oneRed) => oneRed.red));
	next('', { ...args, exitCode: allGreen && allTwinsRed ? 0 : 1 });
});

pipeRunner(taskList.getList(), {}, (runError, args) => {
	if (runError) {
		refuseAndExit(runError);
	}
	process.exit(args.exitCode);
});
