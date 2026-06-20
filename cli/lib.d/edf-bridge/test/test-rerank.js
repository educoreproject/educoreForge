#!/usr/bin/env node
'use strict';

// test-rerank.js — Phase-II gate for the -implied Stage-2 reranker.
//
// PART A (PURE unit tests, no graph): asserts each matcher sub-signal in ISOLATION (fixtures) AND the
// composite scorer assembly — tokenize/jaccard/cosine, element (nameJaccard/descriptionEmbed/
// datatypeMatch), path (pathDepthMatch/pathSegmentSim), neighborhood (parentTypeSim/siblingOverlap/
// childOverlap), and composeScore (weights sum to 1.0; all-1 -> 1.0; all-0.5 -> 0.5; neutral degrade).
//
// PART B (GOLDEN, read-only): bulk-loads neighborhoods generically and reranks the top-100 scoped
// pools for the 6 known LIF->CEDS SPECIFIED pairs, measuring true-target cosine-rank vs rerank-rank.
// Asserts the VERIFIED facts (the 4 surface-evident pairs rerank to rank 0 and are not regressed) and
// RECORDS the two hard cases (Credential.level, JobCode) — escalated to OBSIDIAN_FLAME, see IMCS.
//
// Calls the SAME library modules the reranker uses (no parallel init). qtools async; pure matchers
// are sync. Run: node test/test-rerank.js   (from the edf-bridge dir, or with an absolute path)

const path = require('path');
const fs = require('fs');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const verbose = process.argv.includes('-verbose');
process.global = {
	xLog: {
		status: verbose ? (...a) => console.error('  ·', ...a) : () => {},
		error: (...a) => console.error('  !', ...a),
		result: (...a) => console.log(...a),
		verbose: () => {},
	},
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');

const { tokenize, jaccard, cosine } = require('../lib/text-similarity');
const sm = require('../lib/score-match');
const rerankConfig = require('../lib/rerank-config.json');
const rerankerFactory = require('../lib/reranker');

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(CORE_LIB, 'credential-accessor', 'credential-accessor'))({
	forgeStore,
});
const dbPath = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

let passCount = 0;
let failCount = 0;
const check = (label, condition) => {
	if (condition) {
		passCount++;
		console.log(`  PASS  ${label}`);
	} else {
		failCount++;
		console.log(`  FAIL  ${label}`);
	}
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------
// PART A — pure unit tests (synchronous)
// ---------------------------------------------------------------------------------------------
const partA = () => {
	console.log('\n========== PART A — pure matcher + scorer unit tests ==========');

	// tokenizer: camelCase split, stop-token + short-token drop, de-dupe.
	check('A tokenize camelCase split + stop-drop ("firstName" -> ["first"])', JSON.stringify(tokenize('firstName')) === JSON.stringify(['first']));
	check('A tokenize path/snake split ("Assessment.AssessmentLevel")', JSON.stringify(tokenize('Assessment.AssessmentLevel')) === JSON.stringify(['assessment', 'level']));
	check('A tokenize empty/non-string -> []', tokenize('').length === 0 && tokenize(null).length === 0);

	// jaccard
	check('A jaccard identical sets -> 1', jaccard(['a', 'b'], ['a', 'b']) === 1);
	check('A jaccard disjoint -> 0', jaccard(['a'], ['b']) === 0);
	check('A jaccard half overlap (a,b vs a,c) -> 1/3', near(jaccard(['a', 'b'], ['a', 'c']), 1 / 3));
	check('A jaccard empty vs empty -> 0 (not 0.5)', jaccard([], []) === 0);

	// cosine
	check('A cosine identical vector -> 1', near(cosine([1, 2, 3], [1, 2, 3]), 1));
	check('A cosine orthogonal -> 0', cosine([1, 0], [0, 1]) === 0);
	check('A cosine opposite clamps to 0', cosine([1, 1], [-1, -1]) === 0);
	check('A cosine missing/mismatched -> 0', cosine(null, [1]) === 0 && cosine([1, 2], [1]) === 0);

	// datatype family
	check('A datatype same family -> 1.0', sm.compareDatatypes('string', 'xs:string') === 1.0);
	check('A datatype soft pair string/identifier -> 0.7', sm.compareDatatypes('string', 'identifier') === 0.7);
	check('A datatype unknown (null) -> 0.5', sm.compareDatatypes('string', null) === 0.5);
	check('A datatype incompatible integer/boolean -> 0.0', sm.compareDatatypes('integer', 'boolean') === 0.0);

	// element signals
	const el = sm.elementSignals(
		{ name: 'firstName', embedding: [1, 0, 0], dataType: 'string' },
		{ name: 'First Name', embedding: [1, 0, 0], dataType: 'string' },
	);
	check('A elementSignals nameJaccard("firstName","First Name") = 1', el.nameJaccard === 1);
	check('A elementSignals descriptionEmbed identical -> 1', near(el.descriptionEmbed, 1));
	check('A elementSignals datatypeMatch string/string -> 1', el.datatypeMatch === 1);

	// path signals
	const p1 = sm.pathSignals({ path: 'Person.Address.Street', depth: 3 }, { path: 'Person.Address.Street', depth: 3 });
	check('A pathDepthMatch equal depth -> 1', p1.pathDepthMatch === 1);
	check('A pathSegmentSim identical path -> 1', near(p1.pathSegmentSim, 1));
	const p2 = sm.pathSignals({ path: 'Person.Address', depth: 2 }, { path: 'Person.Address.City.Zip', depth: 4 });
	check('A pathDepthMatch depth 2 vs 4 -> 0.5 (1 - 2/4)', near(p2.pathDepthMatch, 0.5));
	const p3 = sm.pathSignals({ path: null, depth: null }, { path: null, depth: null });
	check('A pathSegmentSim empty segments -> 0.5', p3.pathSegmentSim === 0.5);

	// neighborhood signals
	const nbBoth = sm.neighborhoodSignals(
		{ parent: { name: 'Person', embedding: [1, 0] }, siblings: [{ name: 'lastName' }], children: [] },
		{ parent: { name: 'Person', embedding: [1, 0] }, siblings: [{ name: 'lastName' }], children: [] },
	);
	check('A parentTypeSim matching parent (name+emb) high (>0.9)', nbBoth.parentTypeSim > 0.9);
	check('A siblingOverlap identical sibling names > 0', nbBoth.siblingOverlap > 0);
	check('A childOverlap empty children -> 0.5', nbBoth.childOverlap === 0.5);
	const nbAbsent = sm.neighborhoodSignals({ parent: null, siblings: [], children: [] }, { parent: null, siblings: [], children: [] });
	check('A parentTypeSim absent parent -> 0.5', nbAbsent.parentTypeSim === 0.5);
	check('A siblingOverlap empty -> 0.5', nbAbsent.siblingOverlap === 0.5);

	// composite scorer
	const wsum =
		rerankConfig.weights.element.nameJaccard +
		rerankConfig.weights.element.descriptionEmbed +
		rerankConfig.weights.element.datatypeMatch +
		rerankConfig.weights.path.pathDepthMatch +
		rerankConfig.weights.path.pathSegmentSim +
		rerankConfig.weights.neighborhood.parentTypeSim +
		rerankConfig.weights.neighborhood.siblingOverlap +
		rerankConfig.weights.neighborhood.childOverlap;
	check('A weights sum to 1.0', near(wsum, 1.0, 1e-9));
	check('A layer totals sum to 1.0', near(rerankConfig.weights.element.total + rerankConfig.weights.path.total + rerankConfig.weights.neighborhood.total, 1.0));

	const allOne = {
		nameJaccard: 1, descriptionEmbed: 1, datatypeMatch: 1, pathDepthMatch: 1,
		pathSegmentSim: 1, parentTypeSim: 1, siblingOverlap: 1, childOverlap: 1,
	};
	const allHalf = {
		nameJaccard: 0.5, descriptionEmbed: 0.5, datatypeMatch: 0.5, pathDepthMatch: 0.5,
		pathSegmentSim: 0.5, parentTypeSim: 0.5, siblingOverlap: 0.5, childOverlap: 0.5,
	};
	check('A composeScore all-1.0 -> confidence 1.0', near(sm.composeScore(allOne, rerankConfig).confidence, 1.0));
	check('A composeScore all-0.5 -> confidence 0.5', near(sm.composeScore(allHalf, rerankConfig).confidence, 0.5));
	const partial = sm.composeScore({ ...allHalf, nameJaccard: 1, descriptionEmbed: 1 }, rerankConfig);
	check('A composeScore confidence in [0,1] and rises with stronger element signals', partial.confidence > 0.5 && partial.confidence <= 1);
	check('A composeScore semanticScore/structuralScore in [0,1]', partial.semanticScore >= 0 && partial.semanticScore <= 1 && partial.structuralScore >= 0 && partial.structuralScore <= 1);
};

// ---------------------------------------------------------------------------------------------
// PART B — golden rerank measurement (read-only)
// ---------------------------------------------------------------------------------------------
const SURFACE_STRONG = [
	'lif:Assessment.subject',
	'lif:Person.EmploymentLearningExperience.employedAfterExit',
	'lif:Person.EmploymentLearningExperience.employedPriorToEnrollment',
	'lif:Person.EmploymentLearningExperience.militaryEnlistmentAfterExit',
];

const sectionGolden = (lifecycle, sectionDone) => {
	const taskList = new taskListPlus();

	// retrieve top-100 scoped pools for the 6 known pairs (they are covered, so probe directly).
	taskList.push((args, next) => {
		lifecycle.runCypher(
			{
				graphName: 'golden',
				cypher: `
					MATCH (s)-[:SPECIFIED_MAPPING]->(t) WHERE s._source='LIF' AND s.role='DmeProperty'
					CALL {
						WITH s
						CALL db.index.vector.queryNodes('forgeVec_CEDS_'+s.role, toInteger(200), s.embedding) YIELD node, score
						WHERE node._source='CEDS' AND node.role=s.role AND node.stableId <> s.stableId
						WITH node, score ORDER BY score DESC LIMIT toInteger(100)
						RETURN collect({stableId: node.stableId, score: score}) AS candidates
					}
					RETURN s.stableId AS lif, t.stableId AS ceds, candidates
				`,
				params: {},
			},
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				const pairs = (result.records || []).map((r) => ({
					lif: r.lif,
					ceds: r.ceds,
					candidates: (r.candidates || []).map((c) => ({
						stableId: c.stableId,
						score: c.score && c.score.toNumber ? c.score.toNumber() : c.score,
					})),
				}));
				next('', { ...args, pairs });
			},
		);
	});

	// rerank all 6 in one batch (bulk neighborhood load).
	taskList.push((args, next) => {
		const reranker = rerankerFactory({ lifecycle });
		const items = args.pairs.map((p) => ({ srcStableId: p.lif, candidates: p.candidates }));
		reranker.rerankBatch({ graphName: 'golden', items }, (err, out) => {
			if (err) {
				next(err);
				return;
			}
			const rerankById = {};
			out.items.forEach((it) => {
				rerankById[it.srcStableId] = it.reranked;
			});
			next('', { ...args, rerankById });
		});
	});

	taskList.push((args, next) => {
		const rows = args.pairs.map((p) => {
			const cosineRank = p.candidates.findIndex((c) => c.stableId === p.ceds);
			const rr = args.rerankById[p.lif] || [];
			const rerankRank = rr.findIndex((c) => c.stableId === p.ceds);
			return { lif: p.lif, cosineRank, rerankRank };
		});
		console.log('  lif\tcosineRank\trerankRank');
		rows.forEach((r) => console.log(`  ${r.lif.replace('lif:', '')}\t${r.cosineRank}\t${r.rerankRank}`));

		check('B 6 known pairs evaluated', rows.length === 6);

		// the 4 surface-evident pairs rerank to rank 0 (and were not regressed off the top).
		SURFACE_STRONG.forEach((id) => {
			const row = rows.find((r) => r.lif === id);
			check(`B ${id.replace('lif:', '')} reranks to rank 0`, !!row && row.rerankRank === 0);
		});

		// RECORDED hard cases (escalated to OBSIDIAN_FLAME — NOT asserted as a rescue):
		const cred = rows.find((r) => r.lif === 'lif:Credential.level');
		const job = rows.find((r) => r.lif === 'lif:Position.JobCode.jobCodeValue');
		console.log(`  RECORDED hard case Credential.level: cosineRank=${cred ? cred.cosineRank : '?'} rerankRank=${cred ? cred.rerankRank : '?'} (surface-evidence-poor; not rescuable without overfitting — escalated)`);
		console.log(`  RECORDED hard case JobCode.jobCodeValue: cosineRank=${job ? job.cosineRank : '?'} (out of pool — retrieval miss awaiting hybrid channel — escalated)`);
		check('B Credential.level is in-pool (retrieval reached it at K=100)', !!cred && cred.cosineRank >= 0);
		check('B JobCode is the out-of-pool documented miss', !!job && job.cosineRank === -1);
		next('', args);
	});

	pipeRunner(taskList.getList(), {}, (err) => sectionDone(err));
};

// ---------------------------------------------------------------------------------------------
const main = () => {
	partA();

	let lifecycle = null;
	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		const storeDir = path.dirname(dbPath);
		if (!fs.existsSync(storeDir)) {
			fs.mkdirSync(storeDir, { recursive: true });
		}
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
			forgeStore,
			credentialAccessor,
		})((err, built) => {
			if (err) {
				next(err);
				return;
			}
			lifecycle = built;
			next('', args);
		});
	});
	taskList.push((args, next) => {
		console.log('\n========== PART B — golden rerank measurement (read-only) ==========');
		sectionGolden(lifecycle, (err) => {
			if (err) {
				check('PART B ran without a fatal error', false);
				console.log(`  ! ${err}`);
			}
			next('', args);
		});
	});

	pipeRunner(taskList.getList(), {}, (runErr) => {
		if (runErr) {
			console.log(`\n!!! SUITE INIT ERROR: ${runErr}`);
			failCount++;
		}
		console.log(`\n==================== RESULT ====================`);
		console.log(`  PASS: ${passCount}   FAIL: ${failCount}`);
		console.log(`  ${failCount === 0 ? 'GREEN' : 'RED'}`);
		console.log(`================================================\n`);
		process.exit(failCount === 0 ? 0 : 1);
	});
};

main();
