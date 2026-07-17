#!/usr/bin/env node
'use strict';

// =====================================================================
// pilotPhase2-gate-battery — Phase 2 gates for the forge-architecture pilot
// (SPECIFICATION v2 S2/S3/S4/S11; IMPLEMENTATION_PLAN v2 Phase 2; Builder B).
// =====================================================================
// Container-free, scratch-store only. Drives the REAL edf-bridge-maker CLI over a
// working manifest seeded per the FADED_FORGE ruling of 2026-07-16:
//   - CTDL forged FRESH in-process by the MODERN forge-ctdl at HEAD (the two July-2
//     store generations predate Leg-A and stash no generalized crossRefs — the S6
//     ambiguity was ruled NEITHER; see DEVLOG Phase 2).
//   - CTDLASN + CTDLQData block texts copied byte-identically (getBlock verify-on-read
//     -> saveBlock content re-address) from the Phase 0.2 store copy
//     /tmp/goldEval260716.sqlite3 (GOLD_260716's bytes; the container is never touched).
//
// Gates covered (each comparator observed RED before its GREEN is trusted):
//   - requires-check ERROR (never silent-skip) on a manifest missing a required standard
//   - module resolution ERROR on an unknown module name
//   - choke acceptance of all emitted blocks + choke RED on a mangled version key
//   - emissions-vs-inputs census per pairing vs the frozen fixture-a (229 authored
//     side reproduced: 147/65/17); census comparator RED on a synthetic miss
//   - G3 determinism: two fully independent seed+run cycles -> identical blockIds;
//     same-store re-run idempotent; determinism comparator RED on a mutated byte
//   - R2-7 zero-edge pairing emits NOTHING + reports (synthetic-reader unit tests,
//     both directions: the real data's third pairing is NON-empty by fixture)
//   - unresolved / unknown-locator / intra-standard reporting; R2-2 emission dedup
//   - zero direct graph writes (no graph-driver require in any Phase-2 file)
//   - G8 safety: canonical store byte-identical before/after
// =====================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ---- minimal process.global (battery convention) --------------------------------
const xLogStub = {
	status: () => {},
	error: (...a) => console.error(...a),
	result: () => {},
	verbose: () => {},
};
process.global = {
	xLog: xLogStub,
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const CODE_ROOT = path.join(__dirname, '..');
const CORE_LIB = path.join(CODE_ROOT, 'npm', 'qtools-graph-forge-core', 'lib');
const CANONICAL_STORE = path.join(CODE_ROOT, '..', 'dataStores', 'forgeStore.sqlite3');
const CANONICAL_SHA256 = '65a49a28dbfe6e393b8a97551197f61a512ce7462ff440ce7b42538cb43252ea' /* re-pinned 2026-07-17: FADED_FORGE incident ruling (Option A) — one inert pilotPhase4 CTDL block appended by the then-unpatched manifestEditor; prior sha 69cd3733… */;
const GOLDEVAL_COPY = '/tmp/goldEval260716.sqlite3';
const CTDLASN_BLOCK_ID = '98a5a6864978e2ac1a9ca0018291cb80896bbefb3bb5e2067c90028513906d97';
const CTDLQDATA_BLOCK_ID = '5b228ff8f9e9f0293af3afb5c2e2e2a97d8b35c53b5cc26a0f591a3be6caeebe';
const BRIDGE_MAKER_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'edf-bridge-maker', 'edfBridgeMaker.js');
const MODULE_FILE = path.join(CODE_ROOT, 'cli', 'parserLib', 'forge-ctdl', 'modules', 'ctdlFamilyStructure.js');
const READER_FILE = path.join(CORE_LIB, 'store-reader', 'store-reader.js');
const FIXTURE_A = require(path.join(CODE_ROOT, 'baselines', 'ctdlPilotFixtures', 'fixture-a-familyEndpointTriples.json'));

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const ctdlBundle = require(path.join(CODE_ROOT, 'cli', 'parserLib', 'forge-ctdl', 'forgeCtdl'))({ embedder: null });
const familyModule = require(MODULE_FILE);

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

// streaming-free but 2GiB-safe: shell out (the canonical store exceeds Buffer limits)
const sha256File = (filePath) =>
	`${spawnSync('shasum', ['-a', '256', filePath], { encoding: 'utf8' }).stdout}`.split(' ')[0];

const tripleKey = (type, fromId, toId) => `${type}|${fromId}|${toId}`;

// PG-array shaping for block serialization (the edf-* convention: every property a PG array)
const toPgArrayProperties = (properties) => {
	const out = {};
	Object.keys(properties || {}).forEach((oneKey) => {
		const value = properties[oneKey];
		if (value === undefined) {
			return;
		}
		out[oneKey] = Array.isArray(value) ? value : [value];
	});
	return out;
};

// serialize a FRESH-FORGED contract graph as a standard block (scratch seeding only)
const standardBlockTextFromForge = (forgeResult) =>
	replayBlock.serializeBlock({
		header: {
			blockType: 'standard',
			standardKey: forgeResult.standardKey,
			version: forgeResult.metadata.version,
			stableUriPropertyName: forgeResult.stableUriPropertyName,
			resolutionKey: forgeResult.stableUriPropertyName,
		},
		nodes: forgeResult.nodes.map((oneNode) => ({
			ref: { source: 'CTDL', id: oneNode.stableId },
			labels: oneNode.labels,
			stableId: oneNode.stableId,
			properties: toPgArrayProperties(oneNode.properties),
		})),
		edges: forgeResult.edges.map((oneEdge) => ({
			type: oneEdge.type,
			fromRef: oneEdge.fromRef,
			toRef: oneEdge.toRef,
			properties: toPgArrayProperties(oneEdge.properties),
		})),
	});

const runBridgeMaker = ({ dbPath, moduleName, manifestKey, reportPath, extraSwitches = [] }) =>
	spawnSync(
		'node',
		[
			BRIDGE_MAKER_CLI,
			'-run',
			`--module=${moduleName}`,
			`--manifest=${manifestKey}`,
			...(reportPath ? [`--reportOut=${reportPath}`] : []),
			...extraSwitches,
		],
		{
			env: { ...process.env, EDF_FORGE_STORE_DB: dbPath },
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
		},
	);

// seed one scratch store: fresh-forged CTDL + copied ASN/QData + working manifest.
// forgeResult is passed in so determinism of the forge itself is asserted separately.
const seedScratchStore = ({ dbPath, ctdlBlockText }, callback) => {
	const forgeStore = forgeStoreFactory();
	const copyStore = forgeStoreFactory();
	const seeded = {};
	const taskList = new taskListPlus();

	taskList.push((args, next) => forgeStore.init({ dbPath }, (err) => next(err, args)));
	taskList.push((args, next) => copyStore.init({ dbPath: GOLDEVAL_COPY }, (err) => next(err, args)));

	[
		{ key: 'asn', blockId: CTDLASN_BLOCK_ID },
		{ key: 'qdata', blockId: CTDLQDATA_BLOCK_ID },
	].forEach(({ key, blockId }) => {
		taskList.push((args, next) => {
			copyStore.getBlock({ blockId }, (err, row) => {
				if (err || !row) {
					next(err || `block ${blockId} not found in the goldEval copy`);
					return;
				}
				forgeStore.saveBlock(
					{
						type: row.type,
						subject: row.subject,
						version: row.version,
						requires: [],
						text: row.text,
						producedBy: row.producedBy,
					},
					(saveErr, result) => {
						if (saveErr) {
							next(saveErr);
							return;
						}
						seeded[key] = { blockId: result.blockId, expected: blockId };
						next('', args);
					},
				);
			});
		});
	});

	taskList.push((args, next) => {
		forgeStore.saveBlock(
			{
				type: 'standard',
				subject: 'CTDL',
				version: null,
				requires: [],
				text: ctdlBlockText,
				producedBy: '__TEST_pilotPhase2:freshForge-legA',
			},
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				seeded.ctdl = { blockId: result.blockId };
				next('', args);
			},
		);
	});

	taskList.push((args, next) => {
		forgeStore.saveManifest(
			{
				label: '__TEST_pilotP2_working',
				note: 'Phase 2 working manifest: fresh CTDL + copied CTDLASN/CTDLQData',
				members: [
					{ blockId: seeded.ctdl.blockId, position: null },
					{ blockId: seeded.asn.blockId, position: null },
					{ blockId: seeded.qdata.blockId, position: null },
				],
			},
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				seeded.workingManifestKey = result.manifestKey;
				next('', args);
			},
		);
	});

	// the RED-side manifest: CTDL deliberately absent (requires-check must ERROR)
	taskList.push((args, next) => {
		forgeStore.saveManifest(
			{
				label: '__TEST_pilotP2_missingCTDL',
				note: 'requires-check RED fixture',
				members: [
					{ blockId: seeded.asn.blockId, position: null },
					{ blockId: seeded.qdata.blockId, position: null },
				],
			},
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				seeded.missingCtdlManifestKey = result.manifestKey;
				next('', args);
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err) => callback(err, { forgeStore, seeded }));
};

// census: staged structuralBridge blocks vs fixture-a, per pairing
const censusAgainstFixture = ({ emittedTriplesByPairing }) => {
	const verdict = {};
	Object.keys(FIXTURE_A.byPairing).forEach((onePairing) => {
		const fixtureTriples = FIXTURE_A.byPairing[onePairing].triples;
		const emitted = emittedTriplesByPairing[onePairing] || new Set();
		const authoredMissing = [];
		let authoredReproduced = 0;
		let gatheredOverlap = 0;
		const fixtureKeys = new Set();
		fixtureTriples.forEach((oneTriple) => {
			const key = tripleKey(oneTriple.type, oneTriple.fromStableId, oneTriple.toStableId);
			fixtureKeys.add(key);
			if (oneTriple.authored) {
				if (emitted.has(key)) {
					authoredReproduced++;
				} else {
					authoredMissing.push(key);
				}
			}
			if (oneTriple.gathered && emitted.has(key)) {
				gatheredOverlap++;
			}
		});
		let novel = 0;
		emitted.forEach((oneKey) => {
			if (!fixtureKeys.has(oneKey)) {
				novel++;
			}
		});
		verdict[onePairing] = {
			emitted: emitted.size,
			authoredReproduced,
			authoredMissing,
			gatheredOverlap,
			novel,
		};
	});
	return verdict;
};

// ---- synthetic reader for the module unit tests (R2-7 etc.) ---------------------
const makeSyntheticReader = () => {
	const syntheticNode = ({ stableId, source, crossRefs = [] }) => ({
		stableId,
		ref: { source, id: stableId },
		labels: ['ForgedNode'],
		properties: {},
		uris: [stableId],
		crossRefs,
		source,
	});
	const nodesByStandard = {
		CTDL: [syntheticNode({ stableId: 'ceterms:C1', source: 'CTDL' })],
		CTDLASN: [
			syntheticNode({
				stableId: 'ceasn:P1',
				source: 'CTDLASN',
				crossRefs: [
					// resolvable, family locator — the ONE real edge
					{ raw: 'ceterms:C1', system: 'ctdl', locator: 'schema:domainIncludes' },
					// EXACT duplicate — R2-2 dedup at emission
					{ raw: 'ceterms:C1', system: 'ctdl', locator: 'schema:domainIncludes' },
					// resolvable but NON-family locator (equivalence) — skipped + reported
					{ raw: 'ceterms:C1', system: 'ctdl', locator: 'owl:equivalentClass' },
					// unresolved — reported, never fabricated
					{ raw: 'ceds:notInUniverse', system: 'ceds', locator: 'schema:rangeIncludes' },
					// intra-standard resolution — counted, not emitted
					{ raw: 'ceasn:P2', system: 'ctdlasn', locator: 'schema:rangeIncludes' },
				],
			}),
			syntheticNode({ stableId: 'ceasn:P2', source: 'CTDLASN' }),
		],
		CTDLQData: [syntheticNode({ stableId: 'qdata:Q1', source: 'CTDLQData' })],
	};
	return {
		standardsPresent: () =>
			['CTDL', 'CTDLASN', 'CTDLQData'].map((oneKey) => ({
				standardKey: oneKey,
				blockId: `stub-${oneKey}`,
				headerVersion: 'stub',
			})),
		nodesFor: (standardKey) => nodesByStandard[standardKey] || [],
		edgesFor: () => [],
	};
};

// =====================================================================
// the battery
// =====================================================================
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), '__TEST_pilotPhase2_'));
const dbPath1 = path.join(scratchRoot, 'run1.sqlite3');
const dbPath2 = path.join(scratchRoot, 'run2.sqlite3');
const report1Path = path.join(scratchRoot, 'report1.json');
const report2Path = path.join(scratchRoot, 'report2.json');
const canonicalShaBefore = sha256File(CANONICAL_STORE);

const state = {};
const taskList = new taskListPlus();

// ---- 0. preconditions -----------------------------------------------------------
taskList.push((args, next) => {
	section('preconditions');
	assert('goldEval store copy present (Phase 0.2 bytes)', fs.existsSync(GOLDEVAL_COPY));
	assert(
		`canonical store sha256 = ${CANONICAL_SHA256.slice(0, 8)}… at battery start`,
		canonicalShaBefore === CANONICAL_SHA256,
	);
	next('', args);
});

// ---- 1. Leg-A verification: r3 suite + fresh forge numbers (the FADED_FORGE ruling) ----
taskList.push((args, next) => {
	section('Leg-A verification before seeding (ruling of 2026-07-16)');
	const r3 = spawnSync(
		'node',
		[path.join(CODE_ROOT, 'cli', 'parserLib', 'forge-ctdl', 'test', 'test-r3-canonical.js')],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	const r3Output = `${r3.stdout || ''}${r3.stderr || ''}`;
	assert('test-r3-canonical: zero FAIL lines', r3.status === 0 || !/ FAIL /.test(r3Output));
	next('', args);
});

taskList.push((args, next) => {
	const assetDir = path.join(CODE_ROOT, 'cli', 'parserLib', 'forge-ctdl', 'assets', 'standardSourceData', '01');
	ctdlBundle.forge({ sourcePath: assetDir, skipEmbedding: true }, (err, forgeResult) => {
		if (err) {
			next(`fresh CTDL forge failed: ${err}`);
			return;
		}
		assert('fresh forge: 994 nodes (Leg-A gate number)', forgeResult.nodes.length === 994);
		assert(
			'fresh forge: 135 cross-standard crossRefs {ctdlasn 96, qdata 39}',
			forgeResult.stats.crossRefTotal === 135 &&
				forgeResult.stats.crossRefBySystem.ctdlasn === 96 &&
				forgeResult.stats.crossRefBySystem.qdata === 39,
		);
		assert(
			`fresh forge: version stamp carries 20260327 (got '${forgeResult.metadata.version}')`,
			/20260327/.test(`${forgeResult.metadata.version}`),
		);
		state.ctdlBlockText = standardBlockTextFromForge(forgeResult);
		// forge determinism (feeds G3): a second forge must serialize byte-identically
		ctdlBundle.forge({ sourcePath: assetDir, skipEmbedding: true }, (err2, forgeResult2) => {
			if (err2) {
				next(`second CTDL forge failed: ${err2}`);
				return;
			}
			const secondText = standardBlockTextFromForge(forgeResult2);
			assert('fresh forge: BYTE-IDENTICAL across two runs (forge determinism)', secondText === state.ctdlBlockText);
			next('', args);
		});
	});
});

// ---- 2. seed scratch store 1 ------------------------------------------------------
taskList.push((args, next) => {
	section('seed scratch store 1 (fresh CTDL + copied CTDLASN/CTDLQData)');
	seedScratchStore({ dbPath: dbPath1, ctdlBlockText: state.ctdlBlockText }, (err, seededState) => {
		if (err) {
			next(`seeding store 1 failed: ${err}`);
			return;
		}
		state.store1 = seededState;
		assert(
			'copied CTDLASN block re-addresses to the SAME blockId (byte fidelity)',
			seededState.seeded.asn.blockId === CTDLASN_BLOCK_ID,
		);
		assert(
			'copied CTDLQData block re-addresses to the SAME blockId (byte fidelity)',
			seededState.seeded.qdata.blockId === CTDLQDATA_BLOCK_ID,
		);
		assert('working manifest minted', !!seededState.seeded.workingManifestKey);
		next('', args);
	});
});

// ---- 3. RED: requires-check ERROR + unknown-module ERROR --------------------------
taskList.push((args, next) => {
	section('bridgeMaker refusal paths (ERROR, never silent-skip)');
	const missingRun = runBridgeMaker({
		dbPath: dbPath1,
		moduleName: 'ctdlFamilyStructure',
		manifestKey: state.store1.seeded.missingCtdlManifestKey,
	});
	assert(
		'requires-check: manifest missing CTDL => non-zero exit naming CTDL',
		missingRun.status !== 0 && /CTDL/.test(`${missingRun.stderr}`),
	);
	const unknownRun = runBridgeMaker({
		dbPath: dbPath1,
		moduleName: '__TEST_noSuchModule',
		manifestKey: state.store1.seeded.workingManifestKey,
	});
	assert(
		'module resolution: unknown module name => non-zero exit naming the search',
		unknownRun.status !== 0 && /no module '__TEST_noSuchModule'/.test(`${unknownRun.stderr}`),
	);
	next('', args);
});

// ---- 4. GREEN: the real run -------------------------------------------------------
taskList.push((args, next) => {
	section('bridgeMaker GREEN run (store 1)');
	const greenRun = runBridgeMaker({
		dbPath: dbPath1,
		moduleName: 'ctdlFamilyStructure',
		manifestKey: state.store1.seeded.workingManifestKey,
		reportPath: report1Path,
	});
	assert('run exits 0', greenRun.status === 0);
	if (greenRun.status !== 0) {
		next(`bridgeMaker run failed:\n${greenRun.stderr}`);
		return;
	}
	const report = JSON.parse(fs.readFileSync(report1Path, 'utf8'));
	state.report1 = report;
	assert('THREE structuralBridge blocks staged', report.stagedBlocks.length === 3);
	assert(
		'pairings in S11 order (root-first, then lexicographic)',
		JSON.stringify(report.stagedBlocks.map((oneBlock) => oneBlock.pairSubject)) ===
			JSON.stringify(['CTDL::CTDLASN', 'CTDL::CTDLQData', 'CTDLASN::CTDLQData']),
	);
	assert(
		'every staged block versionKey = (01,01) (default snapshots)',
		report.stagedBlocks.every((oneBlock) => oneBlock.versionKey === '(01,01)'),
	);
	assert(
		'third pairing CTDLASN::CTDLQData is NON-empty (fixture expectation)',
		report.stagedBlocks[2].counts.edges > 0,
	);
	assert('THREE pairGroups minted (stage-then-point completed)', report.mintedGroups.length === 3);
	assert(
		'unresolved-crossRef report PRESENT in the module report',
		report.moduleReport && typeof report.moduleReport.unresolvedByStandard === 'object',
	);
	assert(
		'zero empty pairings reported on the real data',
		Array.isArray(report.moduleReport.emptyPairings) && report.moduleReport.emptyPairings.length === 0,
	);
	next('', args);
});

// ---- 5. choke acceptance + choke RED ----------------------------------------------
taskList.push((args, next) => {
	section('choke: acceptance of emitted blocks + RED on a mangled key');
	const { forgeStore } = state.store1;
	const emittedTriplesByPairing = {};
	const sub = new taskListPlus();
	state.report1.stagedBlocks.forEach((oneStaged) => {
		sub.push((subArgs, subNext) => {
			forgeStore.getBlockMeta({ blockId: oneStaged.blockId }, (err, blockMeta) => {
				assert(
					`staged ${oneStaged.pairSubject} saved as type structuralBridge at (01,01)`,
					!err &&
						blockMeta &&
						blockMeta.type === 'structuralBridge' &&
						blockMeta.subject === oneStaged.pairSubject &&
						blockMeta.version === '(01,01)',
				);
				subNext(err, subArgs);
			});
		});
		sub.push((subArgs, subNext) => {
			forgeStore.getBlock({ blockId: oneStaged.blockId }, (err, row) => {
				if (err || !row) {
					subNext(err || `staged block ${oneStaged.blockId} unreadable`);
					return;
				}
				const block = replayBlock.deserializeBlock(row.text);
				const tripleSet = new Set(
					block.edges.map((oneEdge) => tripleKey(oneEdge.type, oneEdge.fromRef.id, oneEdge.toRef.id)),
				);
				assert(
					`${oneStaged.pairSubject}: block edges are UNIQUE triples (R2-2 dedup held)`,
					tripleSet.size === block.edges.length,
				);
				// the module's canonical sort key is SPACE-joined (edgeKey, the uriBridge
				// lineage) — the comparator must collate with the same key or prefix-sharing
				// ids order differently (observed RED on the first battery run).
				const sortKeys = block.edges.map(
					(oneEdge) => `${oneEdge.type} ${oneEdge.fromRef.id} ${oneEdge.toRef.id}`,
				);
				assert(
					`${oneStaged.pairSubject}: edges SORTED canonically`,
					JSON.stringify(sortKeys) === JSON.stringify([...sortKeys].sort()),
				);
				assert(
					`${oneStaged.pairSubject}: every edge carries full provenance (uriBridge/structural/bridgeAuthored/locator)`,
					block.edges.every(
						(oneEdge) =>
							`${(oneEdge.properties.provenanceSource || [])[0]}` === 'uriBridge' &&
							`${(oneEdge.properties.provenanceTier || [])[0]}` === 'structural' &&
							(oneEdge.properties.bridgeAuthored || [])[0] === true &&
							!!(oneEdge.properties.crossRefLocator || [])[0],
					),
				);
				emittedTriplesByPairing[oneStaged.pairSubject] = tripleSet;
				if (oneStaged.pairSubject === 'CTDL::CTDLASN') {
					// choke RED: strip pairBVersion from this block's header, try to save
					const lines = row.text.split('\n');
					const header = JSON.parse(lines[0]);
					delete header.pairBVersion;
					const mangled = [JSON.stringify(header), ...lines.slice(1)].join('\n');
					forgeStore.saveBlock(
						{
							type: 'structuralBridge',
							subject: oneStaged.pairSubject,
							version: '(01,01)',
							requires: [],
							text: mangled,
							producedBy: '__TEST_chokeRed',
						},
						(chokeErr) => {
							assert(
								'choke RED: structuralBridge missing pairBVersion => REJECTED at saveBlock',
								!!chokeErr && /incomplete version key/.test(`${chokeErr}`),
							);
							subNext('', subArgs);
						},
					);
					return;
				}
				subNext('', subArgs);
			});
		});
	});
	pipeRunner(sub.getList(), {}, (err) => {
		state.emittedTriplesByPairing = emittedTriplesByPairing;
		next(err, args);
	});
});

// ---- 6. the emissions-vs-inputs census (fixture-a) --------------------------------
taskList.push((args, next) => {
	section('emissions-vs-inputs census vs frozen fixture-a (Phase 0.2)');
	const verdict = censusAgainstFixture({ emittedTriplesByPairing: state.emittedTriplesByPairing });
	const expectedAuthored = { 'CTDL::CTDLASN': 147, 'CTDL::CTDLQData': 65, 'CTDLASN::CTDLQData': 17 };
	Object.keys(expectedAuthored).forEach((onePairing) => {
		const pairingVerdict = verdict[onePairing];
		assert(
			`${onePairing}: ALL ${expectedAuthored[onePairing]} authored baseline triples REPRODUCED ` +
				`(missing: ${pairingVerdict.authoredMissing.length})`,
			pairingVerdict.authoredReproduced === expectedAuthored[onePairing] &&
				pairingVerdict.authoredMissing.length === 0,
		);
		console.log(
			`        ${onePairing}: emitted=${pairingVerdict.emitted} authoredReproduced=${pairingVerdict.authoredReproduced} ` +
				`gatheredOverlap=${pairingVerdict.gatheredOverlap} novel=${pairingVerdict.novel} ` +
				`(surplus over authored = ${pairingVerdict.emitted - pairingVerdict.authoredReproduced}; ` +
				`full-149 equivalence is Phase 3's genesis gate)`,
		);
	});

	// census comparator RED: remove one authored triple from a COPY -> exactly one miss
	const redCopy = {};
	Object.keys(state.emittedTriplesByPairing).forEach((onePairing) => {
		redCopy[onePairing] = new Set(state.emittedTriplesByPairing[onePairing]);
	});
	const firstAuthored = FIXTURE_A.byPairing['CTDL::CTDLASN'].triples.find((oneTriple) => oneTriple.authored);
	redCopy['CTDL::CTDLASN'].delete(
		tripleKey(firstAuthored.type, firstAuthored.fromStableId, firstAuthored.toStableId),
	);
	const redVerdict = censusAgainstFixture({ emittedTriplesByPairing: redCopy });
	assert(
		'census comparator RED: a synthetically-removed authored triple IS DETECTED as missing',
		redVerdict['CTDL::CTDLASN'].authoredMissing.length === 1,
	);
	next('', args);
});

// ---- 7. pairGroup minting: union-with-current + determinism of displayName --------
taskList.push((args, next) => {
	section('pairGroup pointer state (union-with-current mint)');
	const { forgeStore } = state.store1;
	const sub = new taskListPlus();
	state.report1.stagedBlocks.forEach((oneStaged) => {
		sub.push((subArgs, subNext) => {
			forgeStore.resolveCurrentPairGroup(
				{ pairSubject: oneStaged.pairSubject, versionKey: oneStaged.versionKey },
				(err, current) => {
					const contentLine = current ? `${current.block.text}`.split('\n')[1] : '';
					const members = contentLine ? JSON.parse(contentLine).members : [];
					assert(
						`${oneStaged.pairSubject}: CURRENT pairGroup carries the staged block`,
						!err && members.indexOf(oneStaged.blockId) !== -1,
					);
					const headerLine = current ? JSON.parse(`${current.block.text}`.split('\n')[0]) : {};
					assert(
						`${oneStaged.pairSubject}: displayName is runner-supplied deterministic (no mint date)`,
						/bridgeMaker:ctdlFamilyStructure/.test(`${headerLine.displayName}`) &&
							!/minted \d{4}-\d{2}-\d{2}/.test(`${headerLine.displayName}`),
					);
					subNext(err, subArgs);
				},
			);
		});
	});
	pipeRunner(sub.getList(), {}, (err) => next(err, args));
});

// ---- 8. G3 determinism: independent second seed+run, and same-store idempotency ---
taskList.push((args, next) => {
	section('G3 determinism');
	seedScratchStore({ dbPath: dbPath2, ctdlBlockText: state.ctdlBlockText }, (err, seededState2) => {
		if (err) {
			next(`seeding store 2 failed: ${err}`);
			return;
		}
		const run2 = runBridgeMaker({
			dbPath: dbPath2,
			moduleName: 'ctdlFamilyStructure',
			manifestKey: seededState2.seeded.workingManifestKey,
			reportPath: report2Path,
		});
		assert('independent store-2 run exits 0', run2.status === 0);
		const report2 = JSON.parse(fs.readFileSync(report2Path, 'utf8'));
		assert(
			'G3: THREE blockIds IDENTICAL across independent seed+run cycles',
			JSON.stringify(report2.stagedBlocks.map((oneBlock) => oneBlock.blockId)) ===
				JSON.stringify(state.report1.stagedBlocks.map((oneBlock) => oneBlock.blockId)),
		);
		// same-store re-run: content addressing dedups to the same ids (idempotent)
		const rerun = runBridgeMaker({
			dbPath: dbPath1,
			moduleName: 'ctdlFamilyStructure',
			manifestKey: state.store1.seeded.workingManifestKey,
			reportPath: report2Path,
		});
		const rerunReport = rerun.status === 0 ? JSON.parse(fs.readFileSync(report2Path, 'utf8')) : null;
		assert(
			'G3: same-store re-run is idempotent (same blockIds, exit 0)',
			rerun.status === 0 &&
				JSON.stringify(rerunReport.stagedBlocks.map((oneBlock) => oneBlock.blockId)) ===
					JSON.stringify(state.report1.stagedBlocks.map((oneBlock) => oneBlock.blockId)),
		);
		// determinism comparator RED: a single mutated byte MUST flip the comparison
		const mutatedIds = state.report1.stagedBlocks.map((oneBlock) => oneBlock.blockId);
		mutatedIds[0] = `${mutatedIds[0].slice(0, 63)}${mutatedIds[0].slice(63) === '0' ? '1' : '0'}`;
		assert(
			'G3 comparator RED: a mutated blockId IS detected as a mismatch',
			JSON.stringify(mutatedIds) !==
				JSON.stringify(state.report1.stagedBlocks.map((oneBlock) => oneBlock.blockId)),
		);
		next('', args);
	});
});

// ---- 9. module unit tests on a SYNTHETIC reader (R2-7 both directions, R2-2, honesty) ----
taskList.push((args, next) => {
	section('module unit tests (synthetic reader: zero-edge pairings, dedup, honesty reports)');
	const emissions = [];
	const emitBlock = (oneEmission) => emissions.push(oneEmission);
	familyModule.run({ reader: makeSyntheticReader(), emitBlock, log: () => {} }, (err, moduleReport) => {
		assert('synthetic run: no error', !err);
		assert('synthetic: ONE pairing emitted (CTDL::CTDLASN)', emissions.length === 1 && emissions[0].pairA === 'CTDL' && emissions[0].pairB === 'CTDLASN');
		assert(
			'R2-7: BOTH zero-edge pairings emit NOTHING and are reported explicitly',
			JSON.stringify(moduleReport.emptyPairings) === JSON.stringify(['CTDL::CTDLQData', 'CTDLASN::CTDLQData']),
		);
		assert('R2-2: duplicate crossRef DEDUPED at emission (1 edge, 1 counted)', emissions[0].edges.length === 1 && emissions[0].counts.dedupedAtEmission === 1);
		const onlyEdge = emissions[0].edges[0];
		assert(
			'LOCATOR direction: domainIncludes -> HAS_PROPERTY targetToSource ((target)->(source))',
			onlyEdge.type === 'HAS_PROPERTY' && onlyEdge.fromRef.id === 'ceterms:C1' && onlyEdge.toRef.id === 'ceasn:P1',
		);
		assert(
			'equivalence locator NOT emitted, reported under skippedUnknownLocator',
			moduleReport.skippedUnknownLocator['owl:equivalentClass'] === 1,
		);
		assert(
			'unresolved crossRef REPORTED, never fabricated',
			JSON.stringify(moduleReport.unresolvedByStandard.CTDLASN) === JSON.stringify(['ceds:notInUniverse']),
		);
		assert('intra-standard resolution counted, not emitted', moduleReport.intraStandardCount === 1);
		// module determinism at the unit level: identical emission bytes across two runs
		const secondEmissions = [];
		familyModule.run(
			{ reader: makeSyntheticReader(), emitBlock: (oneEmission) => secondEmissions.push(oneEmission), log: () => {} },
			(err2) => {
				assert(
					'module determinism: two synthetic runs emit IDENTICAL content',
					!err2 && JSON.stringify(secondEmissions) === JSON.stringify(emissions),
				);
				next('', args);
			},
		);
	});
});

// ---- 10. zero direct graph writes + G8 safety --------------------------------------
taskList.push((args, next) => {
	section('zero direct graph writes + G8 safety');
	[
		{ label: 'store-reader', file: READER_FILE },
		{ label: 'ctdlFamilyStructure', file: MODULE_FILE },
		{ label: 'edf-bridge-maker', file: BRIDGE_MAKER_CLI },
	].forEach(({ label, file }) => {
		const source = fs.readFileSync(file, 'utf8');
		assert(
			`${label}: NO graph-driver require (neo4j/bolt) — store-plane only`,
			!/neo4j|bolt:|neode/i.test(source),
		);
	});
	assert(
		'G8: canonical store BYTE-IDENTICAL after the battery',
		sha256File(CANONICAL_STORE) === canonicalShaBefore,
	);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nBATTERY ABORTED: ${err}`);
		fail++;
	}
	// scratch cleanup (the stores are throwaway; the goldEval copy is never ours to remove)
	try {
		fs.rmSync(scratchRoot, { recursive: true, force: true });
	} catch (cleanupErr) {
		console.error(`  (scratch cleanup skipped: ${cleanupErr.message})`);
	}
	console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
});
