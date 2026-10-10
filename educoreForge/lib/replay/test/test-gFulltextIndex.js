#!/usr/bin/env node
'use strict';

// test-gFulltextIndex.js — G-FULLTEXT (lane BM25, 2026-10-10): replay builds the ONE fulltext index the search's keyword
// (BM25) leg reads, graph-contract §10b, beside the vector indexes. TQ: "No BM25/fulltext is a bug." The greenfield engine
// (63f6a143) built only the vector index; GOLD_EVAL_261009_ct17text carries no FULLTEXT index at all (measured).
//   a  on a capable kernel, writeShapedGraph runs EXACTLY ONE CREATE FULLTEXT INDEX, the statement
//      fulltextIndexCreateCypherFor gives <graphName>_fulltext, AFTER both vector indexes, then db.awaitIndexes; the report
//      names it as built
//   b  on an old kernel (5.12, no GA vector index) the vector indexes are recorded skipped and the fulltext index is STILL
//      built: it needs no kernel probe
//   c  a graph with no vectors (embeddingDims null) gets no index of either leg: the two legs are built together
// The live half (a real SHOW INDEXES on a replayed graph, every vector-searched node covered) is graph-structure-check
// fulltextIndex, run on each new gold (DEVLOG-BM25).
//
// RED TWINS, in memory (moduleDouble), each observed: capableArmSkipsFulltext -> a; oldKernelArmSkipsFulltext -> b;
// fulltextBuiltWithoutVectors -> c. Hermetic: a recording session, no docker, no Neo4j.
//
// Run: node lib/replay/test/test-gFulltextIndex.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- G-FULLTEXT: replay builds the declared fulltext index beside the vector indexes
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Drives writeShapedGraph over a recording session and checks the index statements it runs on a capable kernel, an
     old kernel and a vectorless graph. Every conjunct is observed RED under an in-memory module double. Hermetic.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const vocabulary = require('../../vocabulary/vocabulary');

const ENGINE_PATH = path.join(__dirname, '..', 'replay-engine.js');
// COMPILE ADAPTATION (as test-gVecProp): moduleDouble does not strip content-address.js's shebang
const CONTENT_ADDRESS_PATH = path.join(__dirname, '..', '..', 'content-address', 'content-address.js');
const COMPILE_ADAPTATION_MUTATION_LIST = [{ modulePath: CONTENT_ADDRESS_PATH, find: '#!/usr/bin/env node\n', replace: '' }];

// the ruled name, stated independently of the module it checks
const GRAPH_NAME = 'DEV_gFulltext';
const FULLTEXT_INDEX_NAME = 'DEV_gFulltext_fulltext';
const DECLARED_CREATE_CYPHER = vocabulary.fulltextIndexCreateCypherFor({ indexName: FULLTEXT_INDEX_NAME });

// a recording session: records every statement, answers the kernel probe, resolves the rest empty
const recordingSessionOf = (kernelVersion) => {
	const recordedStatementList = [];
	return {
		recordedStatementList,
		run: (statementText) => {
			recordedStatementList.push(statementText);
			return Promise.resolve(/dbms\.components\(\)/.test(statementText) ? { records: [{ get: () => kernelVersion }] } : { records: [] });
		},
	};
};

const writeThroughRecordingSession = ({ replayEngine, kernelVersion, embeddingDims }, done) => {
	const recordingSession = recordingSessionOf(kernelVersion);
	replayEngine.writeShapedGraph({ session: recordingSession, groups: [{ sourceLabel: 'G-FULLTEXT fixture', nodes: [], edges: [] }], embeddingDims, graphName: GRAPH_NAME }, (writeError, writeReport) =>
		// out of the engine's promise chain, so a later throw is not reported as a phase-3 failure
		setImmediate(() => done(writeError, { statementList: recordingSession.recordedStatementList, indexesBuilt: (writeReport || {}).indexesBuilt || [] })),
	);
};

const verdictOf = (checkList) => {
	const failedList = checkList.filter((oneCheck) => !oneCheck.pass);
	return { pass: failedList.length === 0, detail: failedList.length === 0 ? checkList.map((oneCheck) => oneCheck.checkName).join('; ') : failedList.map((oneCheck) => `${oneCheck.checkName}: ${oneCheck.detail}`).join(' | ') };
};
const fulltextStatementListOf = (statementList) => statementList.filter((oneText) => /CREATE FULLTEXT INDEX/.test(oneText));
const lastIndexOf = (statementList, pattern) => statementList.reduce((soFar, oneText, oneIndex) => (pattern.test(oneText) ? oneIndex : soFar), -1);

const conjunctJudgeByRefId = {
	a_capableKernelBuildsTheDeclaredFulltextIndexAfterTheVectors: (replayEngine, done) =>
		writeThroughRecordingSession({ replayEngine, kernelVersion: '5.26.0', embeddingDims: 8 }, (writeError, written) => {
			if (writeError) {
				done({ pass: false, detail: `writeShapedGraph refused: ${writeError}` });
				return;
			}
			const fulltextStatementList = fulltextStatementListOf(written.statementList);
			const fulltextAt = written.statementList.indexOf(DECLARED_CREATE_CYPHER);
			done(verdictOf([
				{ checkName: 'exactly one CREATE FULLTEXT INDEX', pass: fulltextStatementList.length === 1, detail: `${fulltextStatementList.length}` },
				{ checkName: `it is the declared statement for ${FULLTEXT_INDEX_NAME}`, pass: fulltextAt !== -1, detail: fulltextStatementList.join(' || ') },
				{ checkName: 'after both vector indexes', pass: fulltextAt > lastIndexOf(written.statementList, /CREATE VECTOR INDEX/) && lastIndexOf(written.statementList, /CREATE VECTOR INDEX/) !== -1, detail: `fulltext at ${fulltextAt}` },
				{ checkName: 'awaited', pass: fulltextAt !== -1 && /CALL db\.awaitIndexes/.test(written.statementList[fulltextAt + 1] || ''), detail: `${written.statementList[fulltextAt + 1]}` },
				{ checkName: 'the report names it as built', pass: written.indexesBuilt.includes(FULLTEXT_INDEX_NAME), detail: JSON.stringify(written.indexesBuilt) },
			]));
		}),
	b_oldKernelStillBuildsTheFulltextIndex: (replayEngine, done) =>
		writeThroughRecordingSession({ replayEngine, kernelVersion: '5.12.0', embeddingDims: 8 }, (writeError, written) => {
			if (writeError) {
				done({ pass: false, detail: `writeShapedGraph refused: ${writeError}` });
				return;
			}
			done(verdictOf([
				{ checkName: 'no vector index on 5.12.0', pass: lastIndexOf(written.statementList, /CREATE VECTOR INDEX/) === -1, detail: '' },
				{ checkName: 'the declared fulltext statement runs', pass: written.statementList.includes(DECLARED_CREATE_CYPHER), detail: fulltextStatementListOf(written.statementList).join(' || ') },
				{ checkName: 'the report names it as built beside the two skipped vector indexes', pass: written.indexesBuilt.includes(FULLTEXT_INDEX_NAME) && written.indexesBuilt.filter((oneName) => /:skipped\(/.test(oneName)).length === 2, detail: JSON.stringify(written.indexesBuilt) },
			]));
		}),
	c_vectorlessGraphGetsNeitherLeg: (replayEngine, done) =>
		writeThroughRecordingSession({ replayEngine, kernelVersion: '5.26.0', embeddingDims: null }, (writeError, written) => {
			if (writeError) {
				done({ pass: false, detail: `writeShapedGraph refused: ${writeError}` });
				return;
			}
			done(verdictOf([
				{ checkName: 'no CREATE FULLTEXT INDEX and no CREATE VECTOR INDEX', pass: fulltextStatementListOf(written.statementList).length === 0 && lastIndexOf(written.statementList, /CREATE VECTOR INDEX/) === -1, detail: written.statementList.filter((oneText) => /CREATE/.test(oneText)).join(' || ') },
			]));
		}),
};

const TWIN_LIST = [
	{
		conjunctRefId: 'a_capableKernelBuildsTheDeclaredFulltextIndexAfterTheVectors',
		twinName: 'capableArmSkipsFulltext',
		find: 'indexesBuilt.push(embedTextVectorIndex);\n\t\t\t\t\tbuildFulltextIndex(indexesBuilt);',
		replace: "indexesBuilt.push(embedTextVectorIndex);\n\t\t\t\t\tnext('', { ...args, indexesBuilt });",
	},
	{
		conjunctRefId: 'b_oldKernelStillBuildsTheFulltextIndex',
		twinName: 'oldKernelArmSkipsFulltext',
		find: '< 5.13)`);\n\t\t\t\tbuildFulltextIndex(indexesBuilt);',
		replace: "< 5.13)`);\n\t\t\t\tnext('', { ...args, indexesBuilt });",
	},
	{
		conjunctRefId: 'c_vectorlessGraphGetsNeitherLeg',
		twinName: 'fulltextBuiltWithoutVectors',
		find: "\t\tif (!embeddingDims) {\n\t\t\tnext('', { ...args, indexesBuilt });",
		replace: "\t\tif (!embeddingDims) {\n\t\t\tsession.run(fulltextIndexCreateCypherFor({ indexName: fulltextIndexNameFor({ graphName }) })).then(() => next('', { ...args, indexesBuilt }));",
	},
];

const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => setImmediate(() => nextStep(stepIndex + 1))));
	nextStep(0);
};
const refIdList = Object.keys(conjunctJudgeByRefId);
const realEngine = require('../replay-engine')();

harness.section('G-FULLTEXT — every conjunct GREEN on the real engine');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId](realEngine, (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a module double (in memory)');
		harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), refIdList.slice().sort().join(','));
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				moduleDouble.assertMutationApplies({ modulePath: ENGINE_PATH, find: oneTwin.find });
				const doubledEngine = moduleDouble.loadWithMutations({ modulePath: ENGINE_PATH, mutationList: COMPILE_ADAPTATION_MUTATION_LIST.concat([{ modulePath: ENGINE_PATH, find: oneTwin.find, replace: oneTwin.replace }]) })();
				conjunctJudgeByRefId[oneTwin.conjunctRefId](doubledEngine, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				});
			}),
			() => harness.report(),
		);
	},
);
