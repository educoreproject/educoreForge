#!/usr/bin/env node
'use strict';

// =====================================================================
// pilotPhase3-gate-battery — Phase 3 STORE-PLANE leg for the forge-architecture
// pilot (SPECIFICATION v2 S5/S6/S8/S9 preamble; IMPLEMENTATION_PLAN v2 Phase 3;
// Builder C). The container leg (G2/G4/G7/G8 materialized) is
// pilotPhase3-container-leg.js, which consumes this battery's state file.
// =====================================================================
// What this leg does (container-free, scratch-store only):
//   0. preconditions (canonical hash, goldEval copy, frozen fixtures)
//   1. scratch store = SQLite-backup COPY of canonical (the Phase-3 store carries
//      the FULL history including the stale July-2 CTDL generations — the S6
//      ambiguity is REAL here, and the genesis manifest defeats it by pinning
//      explicit fresh blockIds)
//   2. fresh-forge ALL THREE standards from HEAD via the discovery roster
//      (CTDL 994 nodes / 135 crossRefs {ctdlasn 96, qdata 39} asserted; every
//      forge serialized twice and byte-compared — determinism before use)
//   3. save the three standard blocks to the scratch store (materializer-shaped
//      serialization: ref.source = properties._source; NO embedding envelope —
//      skipEmbedding run, divergence flagged in the DEVLOG, not hidden)
//   4. working manifest (3 standards) + the REAL edf-bridge-maker CLI run
//      (STAGE-then-POINT; banner-gated via EDF_FORGE_STORE_DB)
//   5. GENESIS-compose the pilot manifest: SIX explicit members (3 fresh
//      standards + 3 structuralBridge pairings). NO legacy CTDL block, NO
//      consolidated relationships block, NO legacy family bridge (S5 retirement,
//      licensed by the Phase-0.2 ZERO-OTHER census). Closure PASS asserted;
//      closure RED observed on an injected-fault manifest missing a standard.
//   6. G1 IDENTITY (the Leg-A F1 carry-forward, now a committed gate): old CTDL
//      block 020fb8aa… (fixture-c, read from the goldEval copy) vs the fresh
//      modern CTDL — new native stableId set ⊇ old native set; every drop
//      classified {ruledForeign (Leg-A #1-B LOCKED list) | familyReassigned
//      (schema:MonetaryAmount/QuantitativeValue, verified present in the fresh
//      CTDLQData block)}; ANY unclassified drop is RED. Comparator observed RED
//      on a synthetic missing-native injection. Diff artifact written to
//      baselines/pilotPhase3Artifacts/ (committed at sign-off).
//   7. G8 (store-plane half): canonical byte-identical at battery end.
//
// Async style: qtools taskListPlus/pipeRunner; no async/await; no try/catch for
// control flow (contained JSON.parse boundaries follow the phase-2 idiom).
// =====================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
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
const BRIDGE_MAKER_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'edf-bridge-maker', 'edfBridgeMaker.js');
const ARTIFACTS_DIR = path.join(__dirname, 'pilotPhase3Artifacts');
const STATE_PATH = '/tmp/pilotPhase3-state.json';

const FIXTURE_C = require(path.join(__dirname, 'ctdlPilotFixtures', 'fixture-c-legacyCarrierBlockIds.json'));
const OLD_CTDL_BLOCK_ID = FIXTURE_C.legacyCarriers.find(
	(oneCarrier) => oneCarrier.type === 'standard' && oneCarrier.subject === 'CTDL',
).blockId;
const LEGACY_CARRIER_IDS = FIXTURE_C.legacyCarriers.map((oneCarrier) => oneCarrier.blockId);

// the two STALE July-2 same-version CTDL generations (S6/DEVLOG Phase 2 — NEITHER
// may seed a genesis; the fresh forge is the only valid seed)
const STALE_CTDL_GENERATION_PREFIXES = ['d9ee61c9', 'dd0424a4'];

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const { roster } = require(path.join(CODE_ROOT, 'cli', 'lib.d', 'forger', 'lib', 'standard-discovery'));

const PILOT_STANDARDS = ['CTDL', 'CTDLASN', 'CTDLQData'];

// ---- G1 drop classifier ----
// A drop from the old CTDL block is CORRECT in exactly two measured ways:
//   familyReassigned — the node SURVIVES in a sibling fresh genesis block
//     (Leg-A #1-C family ownership: ceasn:* -> CTDLASN; qdata:* plus the
//     schema.org value cluster and MonetaryAmount/QuantitativeValue -> CTDLQData)
//     — membership is MEASURED against the fresh forges, never assumed from a
//     prefix list;
//   ruledForeign — the Leg-A #1-B LOCKED no-family-owner drops (xsd/rdf/rdfs/
//     dct prefixes, the exact ids below) plus owl:* (owl:sameAs appears in the
//     old block's 20-node leak with no family owner — an observed extension of
//     the #1-B ruling, flagged in the artifact).
const FOREIGN_PREFIX_RULES = [/^xsd:/, /^rdf:/, /^rdfs:/, /^dct:/, /^owl:/];
const FOREIGN_EXACT_IDS = new Set([
	'skos:Concept',
	'rdfs:Resource',
	'schema:CreativeWork',
	'schema:Person',
	'schema:AlignmentObject',
	'schema:StructuredValue',
	'schema:EducationalOccupationalProgram',
	'schema:Intangible',
	'schema:subjectOf',
]);
// #1-C spec-anticipated pair, asserted explicitly in addition to the measured check
const FAMILY_REASSIGNED_IDS = new Set(['schema:MonetaryAmount', 'schema:QuantitativeValue']);

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

// 2GiB-safe hashing: shell out (the canonical store exceeds Buffer limits)
const sha256File = (filePath) =>
	`${spawnSync('shasum', ['-a', '256', filePath], { encoding: 'utf8' }).stdout}`.split(' ')[0];

// materializer-shaped standard-block serialization (forger/lib/materializer.js
// buildStandardBlock, minus the embedding envelope — this is a skipEmbedding run;
// the divergence is DECLARED, and blockIds are pinned explicitly downstream so
// non-identity with the golden's embedded blocks can never be a silent pick).
const toPgArrayProperties = (properties, { skipKeys = [] } = {}) => {
	const out = {};
	Object.keys(properties || {}).forEach((oneKey) => {
		if (skipKeys.indexOf(oneKey) !== -1) {
			return;
		}
		const value = properties[oneKey];
		if (value === undefined) {
			return;
		}
		out[oneKey] = Array.isArray(value) ? value : [value];
	});
	return out;
};

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
			ref: { source: oneNode.properties._source, id: oneNode.stableId },
			labels: oneNode.labels,
			stableId: oneNode.stableId,
			properties: toPgArrayProperties(oneNode.properties, {
				skipKeys: ['embedding', 'embeddingModelVersion'],
			}),
		})),
		edges: forgeResult.edges.map((oneEdge) => ({
			type: oneEdge.type,
			fromRef: oneEdge.fromRef,
			toRef: oneEdge.toRef,
			properties: toPgArrayProperties(oneEdge.properties),
		})),
	});

const runBridgeMaker = ({ dbPath, moduleName, manifestKey, reportPath }) =>
	spawnSync(
		'node',
		[
			BRIDGE_MAKER_CLI,
			'-run',
			`--module=${moduleName}`,
			`--manifest=${manifestKey}`,
			...(reportPath ? [`--reportOut=${reportPath}`] : []),
		],
		{
			env: { ...process.env, EDF_FORGE_STORE_DB: dbPath },
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
		},
	);

// =====================================================================
// the battery
// =====================================================================
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), '__TEST_pilotPhase3_'));
const scratchDbPath = path.join(scratchRoot, 'pilotP3-canonicalCopy.sqlite3');
const bridgeReportPath = path.join(scratchRoot, 'bridgeMakerReport.json');
const bridgeRerunReportPath = path.join(scratchRoot, 'bridgeMakerRerunReport.json');
const canonicalShaBefore = sha256File(CANONICAL_STORE);

const state = {};
const taskList = new taskListPlus();

// ---- 0. preconditions -------------------------------------------------------------
taskList.push((args, next) => {
	section('preconditions');
	assert(
		`canonical store sha256 = ${CANONICAL_SHA256.slice(0, 8)}… at battery start`,
		canonicalShaBefore === CANONICAL_SHA256,
	);
	assert('goldEval store copy present (Phase 0.2 bytes, the G1 old-side source)', fs.existsSync(GOLDEVAL_COPY));
	assert('fixture-c legacy carrier ids loaded (3 carriers)', LEGACY_CARRIER_IDS.length === 3);
	next('', args);
});

// ---- 1. scratch store = SQLite-backup COPY of canonical -----------------------------
taskList.push((args, next) => {
	section('scratch store from canonical COPY (SQLite backup API, never cp)');
	console.error(
		`STORE OVERRIDE ACTIVE: every store contact below runs against the scratch copy ` +
			`${scratchDbPath} (EDF_FORGE_STORE_DB / explicit dbPath) — canonical is READ-ONLY this run`,
	);
	const backupRun = spawnSync('sqlite3', [CANONICAL_STORE, `.backup ${scratchDbPath}`], {
		encoding: 'utf8',
	});
	assert(
		'sqlite .backup of canonical -> scratch succeeded',
		backupRun.status === 0 && fs.existsSync(scratchDbPath),
	);
	assert(
		'canonical sha256 UNCHANGED by the backup read',
		sha256File(CANONICAL_STORE) === CANONICAL_SHA256,
	);
	next('', args);
});

// ---- 2. fresh-forge ALL THREE standards (roster-resolved, determinism x2) -----------
taskList.push((args, next) => {
	section('fresh forges from HEAD (the only valid genesis seeds — S6 ruling)');
	const rosterEntries = roster();
	const forgeOne = (standardName, callback) => {
		const entry = rosterEntries.find((oneEntry) => oneEntry.standardName === standardName);
		if (!entry) {
			callback(`no roster entry for '${standardName}'`);
			return;
		}
		const bundle = require(entry.bundleFactoryPath)({ embedder: null });
		bundle.forge({ sourcePath: entry.defaultSource, skipEmbedding: true }, (err, forgeResult) => {
			if (err) {
				callback(`${standardName} forge failed: ${err}`);
				return;
			}
			const firstText = standardBlockTextFromForge(forgeResult);
			bundle.forge({ sourcePath: entry.defaultSource, skipEmbedding: true }, (err2, forgeResult2) => {
				if (err2) {
					callback(`${standardName} second forge failed: ${err2}`);
					return;
				}
				assert(
					`${standardName}: forge BYTE-IDENTICAL across two runs (determinism before use)`,
					standardBlockTextFromForge(forgeResult2) === firstText,
				);
				callback('', { forgeResult, blockText: firstText });
			});
		});
	};
	const forged = {};
	const sub = new taskListPlus();
	PILOT_STANDARDS.forEach((oneStandard) => {
		sub.push((subArgs, subNext) => {
			forgeOne(oneStandard, (err, result) => {
				if (err) {
					subNext(err);
					return;
				}
				forged[oneStandard] = result;
				console.error(
					`[pilotPhase3] fresh ${oneStandard}: ${result.forgeResult.nodes.length} nodes, ` +
						`${result.forgeResult.edges.length} edges, crossRefTotal=${result.forgeResult.stats.crossRefTotal}`,
				);
				subNext('', subArgs);
			});
		});
	});
	pipeRunner(sub.getList(), {}, (err) => {
		if (err) {
			next(err);
			return;
		}
		const ctdl = forged.CTDL.forgeResult;
		assert('fresh CTDL: 994 nodes (Leg-A gate number)', ctdl.nodes.length === 994);
		assert(
			'fresh CTDL: 135 cross-standard crossRefs {ctdlasn 96, qdata 39}',
			ctdl.stats.crossRefTotal === 135 &&
				ctdl.stats.crossRefBySystem.ctdlasn === 96 &&
				ctdl.stats.crossRefBySystem.qdata === 39,
		);
		assert(
			`fresh CTDL: version stamp carries 20260327 (got '${ctdl.metadata.version}')`,
			/20260327/.test(`${ctdl.metadata.version}`),
		);
		state.forged = forged;
		next('', args);
	});
});

// ---- 3. save the three standard blocks to the scratch store -------------------------
taskList.push((args, next) => {
	section('save fresh standard blocks (scratch store; version stamped — S6 welcome fix-forward)');
	const forgeStore = forgeStoreFactory();
	const savedStandards = {};
	const sub = new taskListPlus();
	sub.push((subArgs, subNext) => forgeStore.init({ dbPath: scratchDbPath }, (err) => subNext(err, subArgs)));
	PILOT_STANDARDS.forEach((oneStandard) => {
		sub.push((subArgs, subNext) => {
			const { forgeResult, blockText } = state.forged[oneStandard];
			// subject = the DISCOVERY standardName (exact casing) — the reader keys
			// standardsPresent() off the store subject; the forge output's standardKey
			// is the lowercase registryKey (observed RED on the first battery run: the
			// F8 casing trap, live). The block HEADER keeps the materializer-verbatim
			// forge standardKey.
			forgeStore.saveBlock(
				{
					type: 'standard',
					subject: oneStandard,
					version: forgeResult.metadata.version,
					requires: [],
					text: blockText,
					producedBy: 'pilotPhase3:freshForge-genesisSeed',
				},
				(err, result) => {
					if (err) {
						subNext(`saveBlock(${oneStandard}) failed: ${err}`);
						return;
					}
					savedStandards[oneStandard] = result.blockId;
					console.error(`[pilotPhase3] saved fresh ${oneStandard}: ${result.blockId.slice(0, 12)}…`);
					subNext('', subArgs);
				},
			);
		});
	});
	pipeRunner(sub.getList(), {}, (err) => {
		if (err) {
			next(err);
			return;
		}
		assert(
			'fresh CTDL blockId is NEITHER stale July-2 generation NOR the old golden block (S6 made visible)',
			STALE_CTDL_GENERATION_PREFIXES.every(
				(onePrefix) => savedStandards.CTDL.indexOf(onePrefix) !== 0,
			) && savedStandards.CTDL !== OLD_CTDL_BLOCK_ID,
		);
		state.forgeStore = forgeStore;
		state.savedStandards = savedStandards;
		next('', args);
	});
});

// ---- 4. working manifest + the REAL bridgeMaker run (STAGE-then-POINT) --------------
taskList.push((args, next) => {
	section('working manifest + edf-bridge-maker (the accumulation leg of S8)');
	state.forgeStore.saveManifest(
		{
			label: '__TEST_pilotP3_working',
			note: 'Phase 3 working manifest: the three FRESH-FORGED genesis seeds',
			members: PILOT_STANDARDS.map((oneStandard) => ({
				blockId: state.savedStandards[oneStandard],
				position: null,
			})),
		},
		(err, manifestResult) => {
			if (err) {
				next(`working manifest save failed: ${err}`);
				return;
			}
			state.workingManifestKey = manifestResult.manifestKey;
			const greenRun = runBridgeMaker({
				dbPath: scratchDbPath,
				moduleName: 'ctdlFamilyStructure',
				manifestKey: state.workingManifestKey,
				reportPath: bridgeReportPath,
			});
			assert('bridgeMaker run exits 0 (banner-gated scratch store)', greenRun.status === 0);
			assert(
				'STORE OVERRIDE banner announced by the CLI',
				/STORE OVERRIDE ACTIVE/.test(`${greenRun.stderr}`),
			);
			if (greenRun.status !== 0) {
				next(`bridgeMaker run failed:\n${greenRun.stderr}`);
				return;
			}
			const report = JSON.parse(fs.readFileSync(bridgeReportPath, 'utf8'));
			state.bridgeReport = report;
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
			assert('THREE pairGroups minted (stage-then-point completed)', report.mintedGroups.length === 3);
			// frozen Phase-2 emission counts (DEVLOG Phase 2 census detail) — the same
			// module over the same three standards' crossRefs must land exactly here;
			// any drift = a fresh-forge surprise = STOP + escalate.
			const countsBySubject = {};
			report.stagedBlocks.forEach((oneBlock) => {
				countsBySubject[oneBlock.pairSubject] = oneBlock.counts.edges;
			});
			assert(
				`emission counts match the frozen Phase-2 expectations 311/178/17 ` +
					`(got ${countsBySubject['CTDL::CTDLASN']}/${countsBySubject['CTDL::CTDLQData']}/${countsBySubject['CTDLASN::CTDLQData']})`,
				countsBySubject['CTDL::CTDLASN'] === 311 &&
					countsBySubject['CTDL::CTDLQData'] === 178 &&
					countsBySubject['CTDLASN::CTDLQData'] === 17,
			);
			// idempotency (the Phase-2 G3 property re-observed on THIS store): a re-run
			// stages the SAME content-addressed blockIds.
			const rerun = runBridgeMaker({
				dbPath: scratchDbPath,
				moduleName: 'ctdlFamilyStructure',
				manifestKey: state.workingManifestKey,
				reportPath: bridgeRerunReportPath,
			});
			const rerunReport = rerun.status === 0 ? JSON.parse(fs.readFileSync(bridgeRerunReportPath, 'utf8')) : null;
			assert(
				'bridgeMaker re-run idempotent (same three blockIds, exit 0)',
				rerun.status === 0 &&
					JSON.stringify(rerunReport.stagedBlocks.map((oneBlock) => oneBlock.blockId)) ===
						JSON.stringify(report.stagedBlocks.map((oneBlock) => oneBlock.blockId)),
			);
			next('', args);
		},
	);
});

// ---- 5. GENESIS composition (S5 retirement enacted) + closure PASS/RED --------------
taskList.push((args, next) => {
	section('GENESIS composition (explicit ids pinned; S5: no legacy carriers)');
	const genesisMembers = [
		...PILOT_STANDARDS.map((oneStandard) => state.savedStandards[oneStandard]),
		...state.bridgeReport.stagedBlocks.map((oneBlock) => oneBlock.blockId),
	];
	assert(
		'genesis member list carries NO legacy carrier blockId (old CTDL / legacy bridge / consolidated)',
		genesisMembers.every((oneId) => LEGACY_CARRIER_IDS.indexOf(oneId) === -1),
	);
	state.forgeStore.saveManifest(
		{
			label: 'pilotP3-genesis-ctdlFamily',
			note:
				'Phase 3 GENESIS manifest (SPECIFICATION v2 S9): 3 fresh-forged standards + 3 pilot ' +
				'structuralBridge pairings; the legacy CTDL block, the consolidated relationships block, ' +
				'and the legacy family bridge are RETIRED from the spine (S5, Phase-0.2 zero-OTHER license)',
			members: genesisMembers.map((oneId) => ({ blockId: oneId, position: null })),
		},
		(err, manifestResult) => {
			if (err) {
				next(`genesis manifest save failed: ${err}`);
				return;
			}
			state.genesisManifestKey = manifestResult.manifestKey;
			console.error(`[pilotPhase3] genesis manifest: ${state.genesisManifestKey.slice(0, 12)}…`);
			state.forgeStore.validateManifestClosure({ manifestKey: state.genesisManifestKey }, (closureErr, verdict) => {
				assert(
					'genesis closure: wellFormed with ZERO violations (S1.7 requires-alignment live)',
					!closureErr && verdict && verdict.wellFormed === true && (verdict.violations || []).length === 0,
				);
				// closure RED: a genesis missing CTDLASN must FAIL closure (the bridges
				// require both standard blockIds — injected-fault manifest)
				const redMembers = genesisMembers.filter((oneId) => oneId !== state.savedStandards.CTDLASN);
				state.forgeStore.saveManifest(
					{
						label: '__TEST_pilotP3_closureRed',
						note: 'closure RED fixture: genesis minus the CTDLASN standard',
						members: redMembers.map((oneId) => ({ blockId: oneId, position: null })),
					},
					(redErr, redManifest) => {
						if (redErr) {
							next(`closure RED fixture save failed: ${redErr}`);
							return;
						}
						state.forgeStore.validateManifestClosure(
							{ manifestKey: redManifest.manifestKey },
							(redClosureErr, redVerdict) => {
								assert(
									'closure RED: genesis minus CTDLASN FAILS closure (missing requires named)',
									!redClosureErr &&
										redVerdict &&
										redVerdict.wellFormed === false &&
										(redVerdict.violations || []).some((oneViolation) => oneViolation.kind === 'missing'),
								);
								next('', args);
							},
						);
					},
				);
			});
		},
	);
});

// ---- 6. G1 IDENTITY — old-vs-new stableId superset diff (committed gate) ------------
taskList.push((args, next) => {
	section('G1 identity: old CTDL block vs fresh modern CTDL (superset, foreign-only drops)');
	const goldEvalStore = forgeStoreFactory();
	const sub = new taskListPlus();
	sub.push((subArgs, subNext) => goldEvalStore.init({ dbPath: GOLDEVAL_COPY }, (err) => subNext(err, subArgs)));
	sub.push((subArgs, subNext) => {
		goldEvalStore.getBlock({ blockId: OLD_CTDL_BLOCK_ID }, (err, row) => {
			if (err || !row) {
				subNext(err || `old CTDL block ${OLD_CTDL_BLOCK_ID} not found in the goldEval copy`);
				return;
			}
			let guardError = null;
			const oldBlock = (() => {
				try {
					return replayBlock.deserializeBlock(row.text);
				} catch (deserializeErr) {
					guardError = deserializeErr;
					return null;
				}
			})();
			if (guardError) {
				subNext(`old CTDL block failed to deserialize: ${guardError.message}`);
				return;
			}
			subNext('', { ...subArgs, oldBlock });
		});
	});
	sub.push((subArgs, subNext) => {
		const oldIds = new Set(subArgs.oldBlock.nodes.map((oneNode) => oneNode.stableId));
		const freshCtdlIds = new Set(state.forged.CTDL.forgeResult.nodes.map((oneNode) => oneNode.stableId));
		const freshAsnIds = new Set(state.forged.CTDLASN.forgeResult.nodes.map((oneNode) => oneNode.stableId));
		const freshQdataIds = new Set(state.forged.CTDLQData.forgeResult.nodes.map((oneNode) => oneNode.stableId));

		const classifyDrop = (oneId) => {
			// measured family reassignment first: the node survives in a sibling
			// fresh genesis block (ownership moved, nothing lost from the graph)
			if (freshAsnIds.has(oneId)) {
				return 'familyReassigned:CTDLASN';
			}
			if (freshQdataIds.has(oneId)) {
				return 'familyReassigned:CTDLQData';
			}
			if (FOREIGN_EXACT_IDS.has(oneId) || FOREIGN_PREFIX_RULES.some((oneRule) => oneRule.test(oneId))) {
				return 'ruledForeign';
			}
			return 'UNCLASSIFIED';
		};

		const drops = Array.from(oldIds)
			.filter((oneId) => !freshCtdlIds.has(oneId))
			.sort()
			.map((oneId) => ({ stableId: oneId, class: classifyDrop(oneId) }));
		const adds = Array.from(freshCtdlIds).filter((oneId) => !oldIds.has(oneId)).sort();
		const dropClassCounts = {};
		drops.forEach((oneDrop) => {
			dropClassCounts[oneDrop.class] = (dropClassCounts[oneDrop.class] || 0) + 1;
		});
		const badDrops = drops.filter((oneDrop) => oneDrop.class === 'UNCLASSIFIED');

		assert(
			`G1: every old->new drop is ruledForeign or familyReassigned ` +
				`(drops=${drops.length} ${JSON.stringify(dropClassCounts)}; bad=${badDrops.length})`,
			drops.length > 0 && badDrops.length === 0,
		);
		assert(
			`G1: new ⊇ old-native (old ${oldIds.size} nodes; ${drops.length} classified drops; ` +
				`${adds.length} adds — the Leg-A coverage gain)`,
			Array.from(oldIds).every((oneId) => freshCtdlIds.has(oneId) || classifyDrop(oneId) !== 'UNCLASSIFIED'),
		);
		assert(
			'G1: both family-reassigned classes PRESENT in the fresh CTDLQData block',
			Array.from(FAMILY_REASSIGNED_IDS).every((oneId) => freshQdataIds.has(oneId)),
		);

		// comparator RED: inject a synthetic old-native id absent from fresh — MUST
		// be caught as UNCLASSIFIED by the same classifier.
		const syntheticOldNative = 'ceterms:__TEST_g1RedInjectedNativeTerm';
		const redVerdict = freshCtdlIds.has(syntheticOldNative)
			? 'inFresh'
			: classifyDrop(syntheticOldNative);
		assert(
			'G1 comparator RED: a synthetic missing NATIVE id is detected as UNCLASSIFIED',
			redVerdict === 'UNCLASSIFIED',
		);

		if (!fs.existsSync(ARTIFACTS_DIR)) {
			fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
		}
		const artifact = {
			gate: 'G1-identity',
			spec: 'SPECIFICATION.md v2 S10 G1 (the Leg-A F1 carry-forward, committed)',
			classifierNotes: [
				'familyReassigned:* is MEASURED membership in a sibling fresh genesis block (Leg-A #1-C ownership), not a prefix list',
				'owl:* added to the ruled-foreign prefixes beyond the #1-B LOCKED list — owl:sameAs observed in the old block leak with no family owner (flagged for design-authority ratification)',
			],
			oldBlock: {
				blockId: OLD_CTDL_BLOCK_ID,
				source: 'goldEval260716 store copy (fixture-c legacy carrier)',
				nodeCount: oldIds.size,
			},
			freshBlock: {
				blockId: state.savedStandards.CTDL,
				producedBy: 'pilotPhase3:freshForge-genesisSeed',
				nodeCount: freshCtdlIds.size,
			},
			verdict: {
				supersetHolds: badDrops.length === 0,
				dropCount: drops.length,
				dropClassCounts,
				addCount: adds.length,
			},
			drops,
			adds,
		};
		fs.writeFileSync(
			path.join(ARTIFACTS_DIR, 'pilotPhase3-g1-identityDiff.json'),
			JSON.stringify(artifact, null, 2),
		);
		console.error(
			`[pilotPhase3] G1 artifact written: ${drops.length} drops ${JSON.stringify(dropClassCounts)}, ${adds.length} adds`,
		);
		subNext('', subArgs);
	});
	pipeRunner(sub.getList(), {}, (err) => next(err, args));
});

// ---- 7. state file for the container leg + G8 (store-plane half) --------------------
taskList.push((args, next) => {
	section('state hand-off + G8 (store-plane)');
	const stateOut = {
		writtenBy: 'pilotPhase3-gate-battery',
		scratchDbPath,
		scratchRoot,
		savedStandards: state.savedStandards,
		bridgeBlocks: state.bridgeReport.stagedBlocks.map((oneBlock) => ({
			pairSubject: oneBlock.pairSubject,
			blockId: oneBlock.blockId,
			versionKey: oneBlock.versionKey,
			edgeCount: oneBlock.counts.edges,
		})),
		workingManifestKey: state.workingManifestKey,
		genesisManifestKey: state.genesisManifestKey,
		moduleReport: state.bridgeReport.moduleReport,
	};
	fs.writeFileSync(STATE_PATH, JSON.stringify(stateOut, null, 2));
	assert(`state file written for the container leg (${STATE_PATH})`, fs.existsSync(STATE_PATH));
	assert(
		'G8 (store-plane): canonical store BYTE-IDENTICAL after the battery',
		sha256File(CANONICAL_STORE) === canonicalShaBefore,
	);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nBATTERY ABORTED: ${err}`);
		fail++;
	}
	// the scratch store is NOT removed here — the container leg consumes it; the
	// run-end cleanup is the container leg's (authorized) business.
	console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
	console.log(`scratch store retained for the container leg: ${scratchDbPath}`);
	process.exit(fail ? 1 : 0);
});
