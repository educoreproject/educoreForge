#!/usr/bin/env node
'use strict';

// =====================================================================
// ctdlCedsFinal-battery — CTDL→CEDS mapping campaign, FINAL store-plane
// gates over the fully-accumulated candidate manifest (EXACT tier +
// property/value/class INFERRED tiers). WORKORDER ctdlCedsMapping_071726;
// builder CRIMSON_STREAM; design authority FADED_FORGE.
// =====================================================================
// Gates:
//   0. preconditions (canonical sha intact; scratch store + state present)
//   1. final candidate membership: the class-run candidate manifest =
//      composed 81627d17 members + Block A + Block B + property-inferred +
//      value-inferred + class-inferred = 40 members; all five campaign
//      blocks present; zero legacy carriers
//   2. per-block census: edge counts and predicate histograms of all five
//      campaign blocks re-read FROM THE STORE (not from memory)
//   3. dedup census: ZERO (from,to,type) triple overlap across ALL SIX
//      CTDL→CEDS mapping blocks pairwise (f957b88c + the five campaign
//      blocks); RED = a synthetically injected duplicate is detected
//   4. delta-closure: final candidate violation set IDENTICAL to the
//      composed-base 81627d17 set (zero new, zero healed); campaign blocks
//      in no violation
//   5. preservation: f957b88c (24 EXACT) + three structuralBridge blocks
//      (311/178/17) remain members; G8 canonical + goldEval byte-identical
//   6. state file updated for the report
// Store-plane only; container-free; no LLM; no embedding calls.
// =====================================================================

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

process.global = {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const CODE_ROOT = path.join(__dirname, '..');
const PROJECT_ROOT = path.join(CODE_ROOT, '..');
const CORE_LIB = path.join(CODE_ROOT, 'npm', 'qtools-graph-forge-core', 'lib');
const CANONICAL_STORE = path.join(PROJECT_ROOT, 'dataStores', 'forgeStore.sqlite3');
const CANONICAL_SHA256 = '65a49a28dbfe6e393b8a97551197f61a512ce7462ff440ce7b42538cb43252ea';
const GOLDEVAL_COPY = '/tmp/goldEval260716.sqlite3';
const GOLDEVAL_SHA256 = 'c346fe25cf1965d06a2f4267332df61e9a0db763bf68bf2e0244728ca29c6abe';
const STATE_PATH = '/tmp/ctdlCedsCampaign-state.json';
const CLOSURE_PROBE = path.join(__dirname, 'pilotPhase4-closure-probe.js');

const EXISTING_EXACT_BLOCK_ID = 'f957b88c959005651e146214dffa1fef95ea6863070531f0692c4bf6a585ab7f';
const PHASE3_BRIDGE_BLOCK_IDS = [
	'1e4d1ac4538b6b5abcb45f1bebf52b2f8f771b93ff150491a7cb323f56fa91c2',
	'636801a60bf381304ed4c760fa2ffe8f2fafcff4382be1ee8e1028b887a19cad',
	'a0fff1fd5d777aeba0a464da7e5aafd515cc3117b2a7236021cd5ac3909c6142',
];
const FIXTURE_C = require(path.join(__dirname, 'ctdlPilotFixtures', 'fixture-c-legacyCarrierBlockIds.json'));
const LEGACY_CARRIER_IDS = FIXTURE_C.legacyCarriers.map((oneCarrier) => oneCarrier.blockId);

// ruled-provenance validator (review gap G2 — shared shape with ctdlCedsExact-battery.js)
const SOURCE_DECLARATION_BY_EDGE_TYPE = {
	NARROW_MATCH: 'skos:narrowMatch',
	RELATED_MATCH: 'skos:relatedMatch',
	EXACT_MATCH: 'owl:equivalentClass',
};
const validateRuledProvenance = ({ edges, expectAbstainLiftNote }) => {
	const v1Local = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);
	const violations = [];
	edges.forEach((oneEdge) => {
		const props = oneEdge.properties || {};
		if (v1Local(props.sourceDeclaration) !== SOURCE_DECLARATION_BY_EDGE_TYPE[oneEdge.type]) {
			violations.push(`${oneEdge.fromRef.id}: sourceDeclaration mismatch`);
		}
		if (!v1Local(props.resolutionJoin)) violations.push(`${oneEdge.fromRef.id}: resolutionJoin missing`);
		if (!v1Local(props.rawAnchor)) violations.push(`${oneEdge.fromRef.id}: rawAnchor missing`);
		if (v1Local(props.confidence) !== 1) violations.push(`${oneEdge.fromRef.id}: confidence != 1`);
		if (v1Local(props.mappingJustification) !== 'semapv:ManualMappingCuration') {
			violations.push(`${oneEdge.fromRef.id}: mappingJustification mismatch`);
		}
		if (expectAbstainLiftNote) {
			if (oneEdge.type !== 'EXACT_MATCH') violations.push(`${oneEdge.fromRef.id}: not EXACT_MATCH`);
			if (!v1Local(props.abstainLiftNote)) violations.push(`${oneEdge.fromRef.id}: abstainLiftNote missing`);
		} else if (v1Local(props.predicate) === 'exactMatch') {
			violations.push(`${oneEdge.fromRef.id}: support edge promoted to exactMatch — forbidden`);
		}
	});
	return violations;
};

// campaign block ids + the final candidate manifest are supplied via env (the
// run chain mints them; this battery VERIFIES from the store, trusting nothing)
const requiredEnv = [
	'CAMPAIGN_BLOCK_A', 'CAMPAIGN_BLOCK_B', 'CAMPAIGN_BLOCK_PROPERTY',
	'CAMPAIGN_BLOCK_VALUE', 'CAMPAIGN_BLOCK_CLASS',
	'CAMPAIGN_FINAL_MANIFEST', 'CAMPAIGN_COMPOSED_BASE', 'EDF_CAMPAIGN_SCRATCH_DB',
];
const missingEnv = requiredEnv.filter((oneName) => !process.env[oneName]);
if (missingEnv.length > 0) {
	console.error(`ctdlCedsFinal-battery: missing env: ${missingEnv.join(', ')}`);
	process.exit(2);
}
const BLOCK_A = process.env.CAMPAIGN_BLOCK_A;
const BLOCK_B = process.env.CAMPAIGN_BLOCK_B;
const BLOCK_PROPERTY = process.env.CAMPAIGN_BLOCK_PROPERTY;
const BLOCK_VALUE = process.env.CAMPAIGN_BLOCK_VALUE;
const BLOCK_CLASS = process.env.CAMPAIGN_BLOCK_CLASS;
const FINAL_MANIFEST = process.env.CAMPAIGN_FINAL_MANIFEST;
const COMPOSED_BASE = process.env.CAMPAIGN_COMPOSED_BASE;
const scratchDbPath = process.env.EDF_CAMPAIGN_SCRATCH_DB;

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
	if (cond) {
		pass++;
		console.log(`  PASS  ${label}`);
	} else {
		fail++;
		console.log(`  FAIL  ${label}`);
	}
};
const section = (title) => console.log(`\n== ${title} ==`);
const sha256File = (filePath) =>
	`${spawnSync('shasum', ['-a', '256', filePath], { encoding: 'utf8' }).stdout}`.split(' ')[0];
const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);
const edgeTripleKey = (oneEdge) => `${oneEdge.fromRef.id}|${oneEdge.toRef.id}|${oneEdge.type}`;

const closureProbe = ({ manifestKey }) => {
	const probeRun = spawnSync(
		'node',
		['--max-old-space-size=8192', CLOSURE_PROBE, `--db=${scratchDbPath}`, `--manifest=${manifestKey}`],
		{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
	);
	if (probeRun.status !== 0) {
		return { error: `closure probe failed (${manifestKey.slice(0, 12)}…): ${probeRun.stderr}` };
	}
	return JSON.parse(probeRun.stdout);
};

const forgeStore = forgeStoreFactory();
const state = { blocks: {} };
const taskList = new taskListPlus();

taskList.push((args, next) => {
	section('preconditions');
	assert('canonical store sha256 intact (65a49a28…)', sha256File(CANONICAL_STORE) === CANONICAL_SHA256);
	assert('scratch store present', fs.existsSync(scratchDbPath));
	forgeStore.init({ dbPath: scratchDbPath }, (err) => next(err, args));
});

taskList.push((args, next) => {
	section('final candidate membership (40 members; five campaign blocks; zero carriers)');
	forgeStore.getManifest({ manifestKey: FINAL_MANIFEST }, (err, manifest) => {
		if (err || !manifest) {
			next(err || `final candidate manifest ${FINAL_MANIFEST} unreadable`);
			return;
		}
		const memberIds = (manifest.members || []).map((oneMember) => oneMember.blockId);
		state.memberIds = memberIds;
		assert(`final candidate carries 40 members (got ${memberIds.length})`, memberIds.length === 40);
		assert(
			'all five campaign blocks are members',
			[BLOCK_A, BLOCK_B, BLOCK_PROPERTY, BLOCK_VALUE, BLOCK_CLASS].every(
				(oneId) => memberIds.indexOf(oneId) !== -1,
			),
		);
		assert(
			'f957b88c + all three structuralBridge blocks are members (preservation)',
			[EXISTING_EXACT_BLOCK_ID].concat(PHASE3_BRIDGE_BLOCK_IDS).every(
				(oneId) => memberIds.indexOf(oneId) !== -1,
			),
		);
		// review G3: EVERY pilot member asserted by id (not just count + spot ids)
		forgeStore.getManifest({ manifestKey: COMPOSED_BASE }, (baseErr, baseManifest) => {
			if (baseErr || !baseManifest) {
				next(baseErr || `composed base ${COMPOSED_BASE} unreadable`);
				return;
			}
			const baseIds = (baseManifest.members || []).map((oneMember) => oneMember.blockId);
			assert(`composed base carries 35 members (got ${baseIds.length})`, baseIds.length === 35);
			assert(
				'G3: final candidate carries ALL 35 pilot members BY ID',
				baseIds.every((oneId) => memberIds.indexOf(oneId) !== -1),
			);
			assert(
				'G3: final candidate == pilot 35 ∪ the 5 campaign blocks EXACTLY (no stray member)',
				memberIds.every(
					(oneId) =>
						baseIds.indexOf(oneId) !== -1 ||
						[BLOCK_A, BLOCK_B, BLOCK_PROPERTY, BLOCK_VALUE, BLOCK_CLASS].indexOf(oneId) !== -1,
				),
			);
			assert(
				'G3: final candidate carries ZERO legacy carrier blockIds',
				memberIds.every((oneId) => LEGACY_CARRIER_IDS.indexOf(oneId) === -1),
			);
			next('', args);
		});
	});
});

taskList.push((args, next) => {
	section('per-block census (re-read from the store)');
	const expectations = [
		{ label: 'legacy authored EXACT', blockId: EXISTING_EXACT_BLOCK_ID, edges: 24, histogram: { EXACT_MATCH: 24 } },
		{ label: 'Block A support NARROW/RELATED', blockId: BLOCK_A, edges: 27, histogram: { NARROW_MATCH: 22, RELATED_MATCH: 5 } },
		{ label: 'Block B set-level element EXACT', blockId: BLOCK_B, edges: 2, histogram: { EXACT_MATCH: 2 } },
		{ label: 'property inferred CLOSE', blockId: BLOCK_PROPERTY, edges: 113, histogram: { CLOSE_MATCH: 113 } },
		{ label: 'value inferred CLOSE', blockId: BLOCK_VALUE, edges: 33, histogram: { CLOSE_MATCH: 33 } },
		{ label: 'class inferred CLOSE', blockId: BLOCK_CLASS, edges: null, histogram: null }, // measured, not asserted (reported)
	];
	const sub = new taskListPlus();
	expectations.forEach((oneExpectation) => {
		sub.push((subArgs, subNext) => {
			forgeStore.getBlock({ blockId: oneExpectation.blockId }, (err, row) => {
				if (err || !row) {
					subNext(err || `block ${oneExpectation.blockId.slice(0, 12)}… unreadable`);
					return;
				}
				const block = replayBlock.deserializeBlock(row.text);
				const histogram = {};
				block.edges.forEach((oneEdge) => {
					histogram[oneEdge.type] = (histogram[oneEdge.type] || 0) + 1;
				});
				state.blocks[oneExpectation.blockId] = {
					label: oneExpectation.label,
					edges: block.edges,
					histogram,
					tierScope: (block.header || {}).tierScope || null,
				};
				if (oneExpectation.edges != null) {
					assert(
						`${oneExpectation.label}: ${oneExpectation.edges} edges, histogram ${JSON.stringify(oneExpectation.histogram)} (got ${block.edges.length}, ${JSON.stringify(histogram)})`,
						block.edges.length === oneExpectation.edges &&
							JSON.stringify(histogram) === JSON.stringify(oneExpectation.histogram),
					);
				} else {
					console.log(
						`  MEASURED  ${oneExpectation.label}: ${block.edges.length} edges ${JSON.stringify(histogram)} tierScope=${state.blocks[oneExpectation.blockId].tierScope}`,
					);
				}
				subNext('', subArgs);
			});
		});
	});
	pipeRunner(sub.getList(), {}, (err) => next(err, args));
});

taskList.push((args, next) => {
	section('dedup census: pairwise triple overlap across all six CTDL→CEDS mapping blocks');
	const blockIds = Object.keys(state.blocks);
	let overlapTotal = 0;
	for (let i = 0; i < blockIds.length; i++) {
		for (let j = i + 1; j < blockIds.length; j++) {
			const setI = new Set(state.blocks[blockIds[i]].edges.map(edgeTripleKey));
			const overlap = state.blocks[blockIds[j]].edges
				.map(edgeTripleKey)
				.filter((oneTriple) => setI.has(oneTriple));
			if (overlap.length > 0) {
				console.log(
					`  OVERLAP ${state.blocks[blockIds[i]].label} × ${state.blocks[blockIds[j]].label}: ${overlap.length}`,
				);
			}
			overlapTotal += overlap.length;
		}
	}
	assert(`GREEN: ZERO pairwise (from,to,type) overlap across all six blocks (got ${overlapTotal})`, overlapTotal === 0);
	// RED (review G1 — the prior form was a tautology): inject a duplicate of an f957b88c
	// edge into a SYNTHETIC COPY of Block A's edge list and re-run the SAME pairwise census
	// over the synthetic collection — the cross-block overlap must be detected.
	const syntheticBlocks = {};
	blockIds.forEach((oneId) => {
		syntheticBlocks[oneId] = { edges: state.blocks[oneId].edges };
	});
	syntheticBlocks[BLOCK_A] = {
		edges: state.blocks[BLOCK_A].edges.concat([state.blocks[EXISTING_EXACT_BLOCK_ID].edges[0]]),
	};
	let redOverlapTotal = 0;
	for (let i = 0; i < blockIds.length; i++) {
		for (let j = i + 1; j < blockIds.length; j++) {
			const setI = new Set(syntheticBlocks[blockIds[i]].edges.map(edgeTripleKey));
			redOverlapTotal += syntheticBlocks[blockIds[j]].edges
				.map(edgeTripleKey)
				.filter((oneTriple) => setI.has(oneTriple)).length;
		}
	}
	assert(
		`RED observed: the pairwise census DETECTS an injected cross-block duplicate (got ${redOverlapTotal} hit)`,
		redOverlapTotal === 1,
	);
	// GREEN restored: the real collection re-censused clean
	let greenAgainTotal = 0;
	for (let i = 0; i < blockIds.length; i++) {
		for (let j = i + 1; j < blockIds.length; j++) {
			const setI = new Set(state.blocks[blockIds[i]].edges.map(edgeTripleKey));
			greenAgainTotal += state.blocks[blockIds[j]].edges
				.map(edgeTripleKey)
				.filter((oneTriple) => setI.has(oneTriple)).length;
		}
	}
	assert('GREEN restored: real collection still zero-overlap after the RED probe', greenAgainTotal === 0);
	next('', args);
});

taskList.push((args, next) => {
	section('ruled-provenance READ-BACK over the store-read campaign blocks (review G2)');
	const blockAViolations = validateRuledProvenance({
		edges: state.blocks[BLOCK_A].edges,
		expectAbstainLiftNote: false,
	});
	assert(
		`Block A: ALL 27 store-read edges satisfy the ruled provenance conditions (violations: ${blockAViolations.length}${blockAViolations.length ? ' — ' + blockAViolations[0] : ''})`,
		state.blocks[BLOCK_A].edges.length === 27 && blockAViolations.length === 0,
	);
	const blockBViolations = validateRuledProvenance({
		edges: state.blocks[BLOCK_B].edges,
		expectAbstainLiftNote: true,
	});
	assert(
		`Block B: BOTH store-read edges are EXACT_MATCH with abstainLiftNote + full provenance (violations: ${blockBViolations.length}${blockBViolations.length ? ' — ' + blockBViolations[0] : ''})`,
		state.blocks[BLOCK_B].edges.length === 2 && blockBViolations.length === 0,
	);
	// RED: strip one provenance key in a scratch copy — the validator must fire
	const strippedCopy = JSON.parse(JSON.stringify(state.blocks[BLOCK_A].edges));
	delete strippedCopy[0].properties.sourceDeclaration;
	const redViolations = validateRuledProvenance({ edges: strippedCopy, expectAbstainLiftNote: false });
	assert(
		`RED observed: stripping sourceDeclaration from one edge IS detected (got ${redViolations.length} violation)`,
		redViolations.length === 1,
	);
	next('', args);
});

taskList.push((args, next) => {
	section('delta-closure (final candidate vs composed base; subprocess-isolated)');
	const violationKey = (oneViolation) => `${oneViolation.blockId}>${oneViolation.requiredBlockId}`;
	const baseVerdict = closureProbe({ manifestKey: COMPOSED_BASE });
	if (baseVerdict.error) {
		next(baseVerdict.error);
		return;
	}
	const finalVerdict = closureProbe({ manifestKey: FINAL_MANIFEST });
	if (finalVerdict.error) {
		next(finalVerdict.error);
		return;
	}
	const baseSet = new Set((baseVerdict.violations || []).map(violationKey));
	const finalSet = new Set((finalVerdict.violations || []).map(violationKey));
	const newViolations = [...finalSet].filter((oneKey) => !baseSet.has(oneKey));
	const healedViolations = [...baseSet].filter((oneKey) => !finalSet.has(oneKey));
	assert(
		`delta-closure: final == base (${finalSet.size} == ${baseSet.size}; zero NEW, zero silently healed)`,
		newViolations.length === 0 && healedViolations.length === 0,
	);
	const campaignIds = [BLOCK_A, BLOCK_B, BLOCK_PROPERTY, BLOCK_VALUE, BLOCK_CLASS];
	assert(
		'no campaign block appears in ANY violation',
		(finalVerdict.violations || []).every(
			(oneViolation) =>
				campaignIds.indexOf(oneViolation.blockId) === -1 &&
				campaignIds.indexOf(oneViolation.requiredBlockId) === -1,
		),
	);
	state.violationCount = finalSet.size;
	next('', args);
});

taskList.push((args, next) => {
	section('G8 + state');
	assert('G8: canonical store BYTE-IDENTICAL after the whole campaign', sha256File(CANONICAL_STORE) === CANONICAL_SHA256);
	assert('G8: goldEval260716 copy BYTE-IDENTICAL', sha256File(GOLDEVAL_COPY) === GOLDEVAL_SHA256);
	const priorState = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
	fs.writeFileSync(
		STATE_PATH,
		JSON.stringify(
			{
				...priorState,
				finalGates: {
					writtenBy: 'ctdlCedsFinal-battery',
					finalCandidateManifestKey: FINAL_MANIFEST,
					memberCount: state.memberIds.length,
					blockCensus: Object.keys(state.blocks).map((oneId) => ({
						blockId: oneId,
						label: state.blocks[oneId].label,
						edgeCount: state.blocks[oneId].edges.length,
						histogram: state.blocks[oneId].histogram,
						tierScope: state.blocks[oneId].tierScope,
					})),
					closureViolations: state.violationCount,
				},
			},
			null,
			2,
		),
	);
	console.log(`  state updated: ${STATE_PATH}`);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nBATTERY ERROR: ${err}`);
	}
	console.log(`\n=== ctdlCedsFinal-battery: ${pass} passed / ${fail} failed ===`);
	process.exit(err || fail > 0 ? 1 : 0);
});
