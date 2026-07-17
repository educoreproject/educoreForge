#!/usr/bin/env node
'use strict';

// =====================================================================
// ctdlCedsExact-battery — CTDL→CEDS mapping campaign, EXACT tier
// (WORKORDER ctdlCedsMapping_071726; builder CRIMSON_STREAM; design
// authority FADED_FORGE — predicate rulings granted 2026-07-17).
// =====================================================================
// What this battery does (store-plane only; container-free; scratch only):
//   0. preconditions (canonical sha 65a49a28 intact; goldEval copy intact;
//      CTDL JSON-LD source present; fixture-c loads)
//   1. scratch store: EDF_CAMPAIGN_SCRATCH_DB if present, else self-seeded
//      SQLite-backup copy of the goldEval260716 store (sqlite3 CLI, read-only
//      source URI)
//   2. base manifest d8606a1e… read FROM the scratch store (34 members, all
//      three legacy carriers present)
//   3. embedded modern CTDL 9767c883… installed into scratch BY BYTES: the
//      text is read byte-exact from the CANONICAL store's inert incident row
//      (read-only URI; the same bytes the phaseE recipe re-derives — G3-proven
//      deterministic) and saved through the in-process forgeStore API with the
//      row metadata replicated verbatim; the content-addressed blockId is
//      asserted BEFORE and AFTER the save
//   4. the three structuralBridge pairings re-staged via the REAL
//      edf-bridge-maker CLI over {embedded CTDL + golden CTDLASN/CTDLQData}
//      (STORE-OVERRIDE banner asserted; frozen 311/178/17; pilot blockIds)
//   5. S14 explicit-member composition re-derived → manifestKey asserted
//      == the pilot's 81627d17… (membership-only key, proven)
//   6. EXACT-tier census + emission (the 52-vs-26 anchor-gap campaign):
//      - harvest EVERY ceds: declaration from the CTDL JSON-LD source
//        (26 owl:equivalentClass / 22 skos:narrowMatch / 5 skos:relatedMatch)
//      - resolve against the golden's CEDS standard + reference blocks via
//        the SAME join discipline as anchor-strategies.osFragmentJoin
//        (OS|notation composite; unique-owner rule; ambiguity ABSTAINS)
//      - census: the 24 fragment-carrying equivalentClass anchors map 1:1
//        onto the existing authored block f957b88c… (preserved, NOT re-emitted)
//      - BLOCK A (tierScope value): 22 NARROW_MATCH + 5 RELATED_MATCH from the
//        support scheme — spec-declared authority, honest non-equivalence
//        predicates, per-edge provenance (sourceDeclaration, rawAnchor,
//        resolutionJoin) per the FADED_FORGE ruling conditions
//      - BLOCK B (tierScope property): 2 element-level EXACT_MATCH from the
//        set-level anchors (General→P000113, Military→P001610), per-edge
//        provenance recording the set-level source and the abstain-lift ruling
//      - determinism: build+serialize twice, byte-identical, same blockIds
//      - dedup gate: ZERO (from,to,type) triple overlap vs f957b88c…
//   7. candidate manifest = composed 81627d17 members + Block A + Block B
//   8. delta-closure via the subprocess-isolated closure probe: candidate
//      violation set IDENTICAL to the composed base (zero new, zero healed);
//      RED = candidate minus the CEDS standard block ADDS violations
//   9. preservation + G8: f957b88c member intact (24 EXACT), bridge blocks
//      intact (311/178/17), canonical + goldEval byte-identical; state file
// RED evidence is produced inline wherever a fault is injectable.
// No commits. No containers. No LLM. No embedding calls.
// =====================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

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
const PROJECT_ROOT = path.join(CODE_ROOT, '..');
const CORE_LIB = path.join(CODE_ROOT, 'npm', 'qtools-graph-forge-core', 'lib');
const CANONICAL_STORE = path.join(PROJECT_ROOT, 'dataStores', 'forgeStore.sqlite3');
const CANONICAL_SHA256 = '65a49a28dbfe6e393b8a97551197f61a512ce7462ff440ce7b42538cb43252ea';
const GOLDEVAL_COPY = '/tmp/goldEval260716.sqlite3';
const GOLDEVAL_SHA256 = 'c346fe25cf1965d06a2f4267332df61e9a0db763bf68bf2e0244728ca29c6abe';
const STATE_PATH = '/tmp/ctdlCedsCampaign-state.json';

const CTDL_SOURCE = path.join(
	CODE_ROOT, 'cli', 'parserLib', 'forge-ctdl', 'assets', 'standardSourceData', '01', 'ctdl-schema.json',
);
const BRIDGE_MAKER_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'edf-bridge-maker', 'edfBridgeMaker.js');
const CLOSURE_PROBE = path.join(__dirname, 'pilotPhase4-closure-probe.js');

const FIXTURE_C = require(path.join(__dirname, 'ctdlPilotFixtures', 'fixture-c-legacyCarrierBlockIds.json'));
const LEGACY_CARRIER_IDS = FIXTURE_C.legacyCarriers.map((oneCarrier) => oneCarrier.blockId);
const OLD_CTDL_BLOCK_ID = FIXTURE_C.legacyCarriers.find(
	(oneCarrier) => oneCarrier.type === 'standard' && oneCarrier.subject === 'CTDL',
).blockId;
const BASE_MANIFEST_KEY = 'd8606a1e51e198d073fe521e4279be13b7b2c65bf10d6f840b029a487ec650fc';
const COMPOSED_MANIFEST_KEY = '81627d173883ecf2223fd3e56b2d518e2d9ed9b6035a073c2fe8e7434fa48fc9';
const EMBEDDED_CTDL_BLOCK_ID = '9767c8835959ec4a22763e5997adfb6b6ca6e458cac360bef088acfd21b45af0';
const GOLDEN_CTDLASN_BLOCK_ID = '98a5a6864978e2ac1a9ca0018291cb80896bbefb3bb5e2067c90028513906d97';
const GOLDEN_CTDLQDATA_BLOCK_ID = '5b228ff8f9e9f0293af3afb5c2e2e2a97d8b35c53b5cc26a0f591a3be6caeebe';
const EXISTING_EXACT_BLOCK_ID = 'f957b88c959005651e146214dffa1fef95ea6863070531f0692c4bf6a585ab7f';
const PHASE3_BRIDGE_BLOCK_IDS = {
	'CTDL::CTDLASN': '1e4d1ac4538b6b5abcb45f1bebf52b2f8f771b93ff150491a7cb323f56fa91c2',
	'CTDL::CTDLQData': '636801a60bf381304ed4c760fa2ffe8f2fafcff4382be1ee8e1028b887a19cad',
	'CTDLASN::CTDLQData': 'a0fff1fd5d777aeba0a464da7e5aafd515cc3117b2a7236021cd5ac3909c6142',
};

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const contentAddress = require(path.join(CORE_LIB, 'content-address', 'content-address'))();
const mappingSubgraphFactory = require(path.join(CORE_LIB, 'mapping-subgraph', 'mappingSubgraph'));
const pairBindingFactory = require(path.join(CORE_LIB, 'pair-binding', 'pair-binding'));
const valueCrosswalk = require(path.join(CODE_ROOT, 'cli', 'bridge-maker', 'edf-mapping', 'lib', 'value-crosswalk'));
const { osFragmentJoin } = require(path.join(CODE_ROOT, 'cli', 'bridge-maker', 'edf-mapping', 'lib', 'anchor-strategies'));
const standardDiscovery = require(path.join(CODE_ROOT, 'cli', 'lib.d', 'forger', 'lib', 'standard-discovery'));
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

// edge -> block serialization shape (mirror edf-mapping.toBlockEdge): every property a PG-JSON array
const toBlockEdge = (oneEdge) => {
	const properties = {};
	Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
		const value = oneEdge.properties[oneKey];
		properties[oneKey] = Array.isArray(value) ? value : [value];
	});
	return { type: oneEdge.type, fromRef: oneEdge.fromRef, toRef: oneEdge.toRef, properties };
};

// read one block's text BYTE-EXACT from a store db WITHOUT opening it writable
// (python3 sqlite3 read-only URI; the sqlite3 CLI's SELECT output is not byte-safe)
const readBlockTextReadOnly = ({ dbPath, blockId, outPath }) => {
	const script = [
		'import sqlite3, sys',
		"con = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)",
		"row = con.execute('SELECT text FROM blocks WHERE blockId=?', (sys.argv[2],)).fetchone()",
		'con.close()',
		'sys.exit(2) if row is None else open(sys.argv[3], "w").write(row[0])',
	].join('\n');
	return spawnSync('python3', ['-c', script, dbPath, blockId, outPath], { encoding: 'utf8' });
};

const runBridgeMaker = ({ dbPath, manifestKey, reportPath }) =>
	spawnSync(
		'node',
		[
			BRIDGE_MAKER_CLI, '-run',
			'--module=ctdlFamilyStructure',
			`--manifest=${manifestKey}`,
			`--reportOut=${reportPath}`,
		],
		{ env: { ...process.env, EDF_FORGE_STORE_DB: dbPath }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
	);

const closureProbe = ({ dbPath, manifestKey }) => {
	const probeRun = spawnSync(
		'node',
		['--max-old-space-size=8192', CLOSURE_PROBE, `--db=${dbPath}`, `--manifest=${manifestKey}`],
		{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
	);
	if (probeRun.status !== 0) {
		return { error: `closure probe failed (${manifestKey.slice(0, 12)}…): ${probeRun.stderr}` };
	}
	return JSON.parse(probeRun.stdout);
};

// --------------------------------------------------------------------------------
// the ceds: declaration harvest — every ceds:-prefixed value on a skos:Concept under
// the three declaring predicates, straight from the CTDL JSON-LD source (the spec's
// own assertions; the parser only ever captured owl:equivalentClass — parser.js:462)
// --------------------------------------------------------------------------------
const DECLARING_PREDICATES = ['owl:equivalentClass', 'skos:narrowMatch', 'skos:relatedMatch'];

const harvestCedsDeclarations = (sourceGraph) => {
	const declarations = [];
	sourceGraph.forEach((oneNode) => {
		DECLARING_PREDICATES.forEach((onePredicate) => {
			const rawValues = oneNode[onePredicate];
			const valueList = Array.isArray(rawValues) ? rawValues : rawValues == null ? [] : [rawValues];
			valueList.forEach((oneValue) => {
				if (typeof oneValue === 'string' && oneValue.startsWith('ceds:')) {
					declarations.push({
						fromStableId: oneNode['@id'],
						declaringPredicate: onePredicate,
						rawAnchor: oneValue,
					});
				}
			});
		});
	});
	return declarations;
};

// ceds:<digits>[/]#fragment -> { osId, fragment } (fragment null when set-level);
// the element id is the FIRST digit run (normalize.js convention), OS-prefixed zero-padded 6
const parseCedsAnchor = (rawAnchor) => {
	const digitsMatch = rawAnchor.match(/(\d+)/);
	if (!digitsMatch) {
		return null;
	}
	const osId = `OS${digitsMatch[1].padStart(6, '0')}`;
	const hashAt = rawAnchor.indexOf('#');
	const fragment = hashAt === -1 || hashAt === rawAnchor.length - 1 ? null : rawAnchor.slice(hashAt + 1);
	return { osId, fragment };
};

// resolve ONE fragment-carrying declaration against the CEDS context, with the SAME
// consult order as anchor-strategies.osFragmentJoin (ambiguous notation abstains BEFORE
// the name map is consulted; unique-owner rule on the option set)
const resolveFragmentDeclaration = ({ declaration, resolutionContext }) => {
	const { valueIndex, osOwnerIndex } = resolutionContext;
	const parsed = parseCedsAnchor(declaration.rawAnchor);
	if (!parsed || parsed.fragment == null) {
		return { abstain: { ...declaration, reason: 'set-level anchor (no value fragment)' } };
	}
	const owningProperties = osOwnerIndex[parsed.osId] || [];
	if (owningProperties.length !== 1) {
		return {
			abstain: {
				...declaration,
				reason: `owning property not unique for ${parsed.osId} (${owningProperties.length} owners)`,
			},
		};
	}
	const propertyKey = owningProperties[0];
	const joinKey = `${parsed.osId}|${parsed.fragment}`;
	const ambiguousHubs =
		(valueIndex.ambiguousNotationKeys || {})[joinKey] ||
		(valueIndex.byNotation[joinKey] === undefined
			? (valueIndex.ambiguousNameKeys || {})[joinKey]
			: undefined);
	if (ambiguousHubs) {
		return {
			abstain: { ...declaration, reason: `AMBIGUOUS notation/name in option set (${ambiguousHubs.length} hubs)` },
		};
	}
	const valueToken = valueIndex.byNotation[joinKey] || valueIndex.byName[joinKey];
	if (!valueToken) {
		return { abstain: { ...declaration, reason: 'no OS+notation/name match in CEDS standard block' } };
	}
	return {
		resolved: {
			fromStableId: declaration.fromStableId,
			targetKey: `${propertyKey}|${valueToken}`,
			rawAnchor: declaration.rawAnchor,
			declaringPredicate: declaration.declaringPredicate,
			resolutionJoin: `${parsed.osId}|${parsed.fragment}→${valueToken} (owner ${propertyKey} unique)`,
		},
	};
};

// stamp the FADED_FORGE-ruled provenance onto built edges (keyed fromStableId|cedsAnchorKey).
// LOUD on key-miss (review gap G2): an edge the stamp table cannot address is a defect in the
// battery's own bookkeeping — refuse to return a silently under-stamped edge set.
const stampProvenance = ({ edges, provenanceByKey }) => {
	const unstamped = [];
	edges.forEach((oneEdge) => {
		const lookupKey = `${oneEdge.fromRef.id}|${v1(oneEdge.properties.cedsAnchorKey)}`;
		const stamp = provenanceByKey[lookupKey];
		if (!stamp) {
			unstamped.push(lookupKey);
			return;
		}
		Object.keys(stamp).forEach((oneKey) => {
			oneEdge.properties[oneKey] = stamp[oneKey];
		});
	});
	if (unstamped.length > 0) {
		throw new Error(
			`stampProvenance: ${unstamped.length} edge(s) missing from the provenance table — first: ${unstamped[0]}`,
		);
	}
	return edges;
};

// validate the ruled provenance conditions over a block's edges (review gap G2). Every
// violation is returned with its true reason; callers assert zero and use a stripped copy
// to prove the validator actually fires (RED).
const SOURCE_DECLARATION_BY_EDGE_TYPE = {
	NARROW_MATCH: 'skos:narrowMatch',
	RELATED_MATCH: 'skos:relatedMatch',
	EXACT_MATCH: 'owl:equivalentClass',
};
const validateRuledProvenance = ({ edges, expectAbstainLiftNote }) => {
	const violations = [];
	edges.forEach((oneEdge) => {
		const props = oneEdge.properties || {};
		const expectDeclaration = SOURCE_DECLARATION_BY_EDGE_TYPE[oneEdge.type];
		if (v1(props.sourceDeclaration) !== expectDeclaration) {
			violations.push(`${oneEdge.fromRef.id}: sourceDeclaration '${v1(props.sourceDeclaration)}' != '${expectDeclaration}'`);
		}
		if (!v1(props.resolutionJoin)) {
			violations.push(`${oneEdge.fromRef.id}: resolutionJoin missing`);
		}
		if (!v1(props.rawAnchor)) {
			violations.push(`${oneEdge.fromRef.id}: rawAnchor missing`);
		}
		if (v1(props.confidence) !== 1) {
			violations.push(`${oneEdge.fromRef.id}: confidence ${v1(props.confidence)} != 1`);
		}
		if (v1(props.mappingJustification) !== 'semapv:ManualMappingCuration') {
			violations.push(`${oneEdge.fromRef.id}: mappingJustification '${v1(props.mappingJustification)}'`);
		}
		if (expectAbstainLiftNote) {
			if (oneEdge.type !== 'EXACT_MATCH') {
				violations.push(`${oneEdge.fromRef.id}: set-level edge type '${oneEdge.type}' != EXACT_MATCH`);
			}
			if (!v1(props.abstainLiftNote)) {
				violations.push(`${oneEdge.fromRef.id}: abstainLiftNote missing`);
			}
		} else if (v1(props.predicate) === 'exactMatch') {
			violations.push(`${oneEdge.fromRef.id}: support edge carries predicate exactMatch — promotion forbidden by ruling`);
		}
	});
	return violations;
};

const edgeTripleKey = (oneEdge) => `${oneEdge.fromRef.id}|${oneEdge.toRef.id}|${oneEdge.type}`;

const canonicalEdgeSort = (a, b) => {
	const ka = `${a.type}|${a.fromRef.id}|${a.toRef.id}`;
	const kb = `${b.type}|${b.fromRef.id}|${b.toRef.id}`;
	return ka < kb ? -1 : ka > kb ? 1 : 0;
};

// =====================================================================
// the battery
// =====================================================================
const suppliedScratchDb = process.env.EDF_CAMPAIGN_SCRATCH_DB || '';
const scratchRoot = suppliedScratchDb
	? path.dirname(suppliedScratchDb)
	: fs.mkdtempSync(path.join(os.tmpdir(), '__TEST_ctdlCedsExact_'));
const scratchDbPath = suppliedScratchDb || path.join(scratchRoot, 'ctdlCeds-scratchStore.sqlite3');
const bridgeReportPath = path.join(scratchRoot, 'ctdlCedsExact-bridgeReport.json');
const embeddedTextPath = path.join(scratchRoot, 'ctdlCedsExact-embeddedCtdl.block');
const canonicalShaBefore = sha256File(CANONICAL_STORE);
const goldEvalShaBefore = sha256File(GOLDEVAL_COPY);

const state = { scratchDbPath };
const forgeStore = forgeStoreFactory();
const pairBinding = pairBindingFactory({});
const taskList = new taskListPlus();

// ---- 0. preconditions ---------------------------------------------------------------
taskList.push((args, next) => {
	section('preconditions');
	assert('canonical store sha256 intact (65a49a28…)', canonicalShaBefore === CANONICAL_SHA256);
	assert('goldEval260716 store copy sha256 intact', goldEvalShaBefore === GOLDEVAL_SHA256);
	assert('CTDL JSON-LD source present', fs.existsSync(CTDL_SOURCE));
	assert('fixture-c carriers loaded (3)', LEGACY_CARRIER_IDS.length === 3);
	next('', args);
});

// ---- 1. scratch store ---------------------------------------------------------------
taskList.push((args, next) => {
	section('scratch store');
	if (fs.existsSync(scratchDbPath)) {
		console.log(`  (using supplied scratch store: ${scratchDbPath})`);
		next('', args);
		return;
	}
	const backupRun = spawnSync(
		'python3',
		[
			'-c',
			[
				'import sqlite3, sys',
				"src = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)",
				'dst = sqlite3.connect(sys.argv[2])',
				'src.backup(dst)',
				'dst.close(); src.close()',
			].join('\n'),
			GOLDEVAL_COPY,
			scratchDbPath,
		],
		{ encoding: 'utf8' },
	);
	assert('scratch store seeded via SQLite backup API (read-only source URI)', backupRun.status === 0);
	next(backupRun.status === 0 ? '' : `scratch seed failed: ${backupRun.stderr}`, args);
});

taskList.push((args, next) => {
	forgeStore.init({ dbPath: scratchDbPath }, (err) => next(err, args));
});

// ---- 2. base manifest ---------------------------------------------------------------
taskList.push((args, next) => {
	section('base manifest (d8606a1e…)');
	forgeStore.getManifest({ manifestKey: BASE_MANIFEST_KEY }, (err, manifest) => {
		if (err || !manifest) {
			next(err || 'base manifest unreadable');
			return;
		}
		state.baseMemberIds = (manifest.members || []).map((oneMember) => oneMember.blockId);
		assert(`base manifest carries 34 members (got ${state.baseMemberIds.length})`, state.baseMemberIds.length === 34);
		assert(
			'base manifest contains ALL THREE legacy carriers',
			LEGACY_CARRIER_IDS.every((oneId) => state.baseMemberIds.indexOf(oneId) !== -1),
		);
		assert(
			'base manifest contains the existing authored EXACT block f957b88c…',
			state.baseMemberIds.indexOf(EXISTING_EXACT_BLOCK_ID) !== -1,
		);
		next('', args);
	});
});

// ---- 3. embedded modern CTDL by bytes -----------------------------------------------
taskList.push((args, next) => {
	section('embedded modern CTDL 9767c883… (byte-exact from the canonical inert row)');
	const readRun = readBlockTextReadOnly({
		dbPath: CANONICAL_STORE,
		blockId: EMBEDDED_CTDL_BLOCK_ID,
		outPath: embeddedTextPath,
	});
	assert('embedded CTDL text read from canonical (read-only URI)', readRun.status === 0);
	if (readRun.status !== 0) {
		next(`embedded CTDL read failed: ${readRun.stderr}`);
		return;
	}
	const embeddedText = fs.readFileSync(embeddedTextPath, 'utf8');
	const preAssertId = contentAddress.blockIdForText(embeddedText);
	assert(
		'content address of the read bytes == 9767c883… BEFORE any save (byte fidelity proven)',
		preAssertId === EMBEDDED_CTDL_BLOCK_ID,
	);
	state.embeddedCtdlText = embeddedText;
	forgeStore.saveBlock(
		{
			type: 'standard',
			subject: 'CTDL',
			version: null,
			requires: [],
			text: embeddedText,
			producedBy: 'pilotPhase4:freshForge-embedded',
		},
		(err, result) => {
			if (err) {
				next(`embedded CTDL save failed: ${err}`);
				return;
			}
			assert('saveBlock returns the SAME content-addressed id (dedup-or-insert)', result.blockId === EMBEDDED_CTDL_BLOCK_ID);
			next('', args);
		},
	);
});

// ---- 4. re-stage the three pairings (real bridgeMaker CLI) --------------------------
taskList.push((args, next) => {
	section('re-stage pairings (real edf-bridge-maker; banner + frozen counts + pilot blockIds)');
	forgeStore.saveManifest(
		{
			label: '__TEST_ctdlCedsExact_working',
			note: 'campaign working manifest: embedded modern CTDL + golden CTDLASN/CTDLQData',
			members: [
				{ blockId: EMBEDDED_CTDL_BLOCK_ID, position: null },
				{ blockId: GOLDEN_CTDLASN_BLOCK_ID, position: null },
				{ blockId: GOLDEN_CTDLQDATA_BLOCK_ID, position: null },
			],
		},
		(err, manifestResult) => {
			if (err) {
				next(`working manifest save failed: ${err}`);
				return;
			}
			const bridgeRun = runBridgeMaker({
				dbPath: scratchDbPath,
				manifestKey: manifestResult.manifestKey,
				reportPath: bridgeReportPath,
			});
			assert('bridgeMaker exits 0', bridgeRun.status === 0);
			assert(
				'STORE OVERRIDE banner announced (scratch redirect verified, per-command)',
				`${bridgeRun.stderr}`.indexOf('STORE OVERRIDE ACTIVE') !== -1,
			);
			if (bridgeRun.status !== 0) {
				next(`bridgeMaker failed:\n${bridgeRun.stderr}`);
				return;
			}
			const report = JSON.parse(fs.readFileSync(bridgeReportPath, 'utf8'));
			state.bridgeBlocks = report.stagedBlocks.map((oneBlock) => ({
				pairSubject: oneBlock.pairSubject,
				blockId: oneBlock.blockId,
				versionKey: oneBlock.versionKey,
				edgeCount: oneBlock.counts.edges,
			}));
			const countsBySubject = {};
			report.stagedBlocks.forEach((oneBlock) => {
				countsBySubject[oneBlock.pairSubject] = oneBlock.counts.edges;
			});
			assert(
				`emissions = frozen 311/178/17 (got ${countsBySubject['CTDL::CTDLASN']}/${countsBySubject['CTDL::CTDLQData']}/${countsBySubject['CTDLASN::CTDLQData']})`,
				countsBySubject['CTDL::CTDLASN'] === 311 &&
					countsBySubject['CTDL::CTDLQData'] === 178 &&
					countsBySubject['CTDLASN::CTDLQData'] === 17,
			);
			assert(
				'staged blockIds IDENTICAL to the pilot (G3 determinism, re-proven)',
				report.stagedBlocks.every(
					(oneBlock) => PHASE3_BRIDGE_BLOCK_IDS[oneBlock.pairSubject] === oneBlock.blockId,
				),
			);
			next('', args);
		},
	);
});

// ---- 5. S14 composition re-derived --------------------------------------------------
taskList.push((args, next) => {
	section('S14 explicit-member composition (must re-derive 81627d17…)');
	const composedMembers = [];
	state.baseMemberIds.forEach((oneId) => {
		if (oneId === OLD_CTDL_BLOCK_ID) {
			composedMembers.push(EMBEDDED_CTDL_BLOCK_ID);
			return;
		}
		if (LEGACY_CARRIER_IDS.indexOf(oneId) !== -1) {
			return;
		}
		composedMembers.push(oneId);
	});
	state.bridgeBlocks.forEach((oneBridge) => composedMembers.push(oneBridge.blockId));
	assert(`composed member count = 35 (got ${composedMembers.length})`, composedMembers.length === 35);
	state.composedMembers = composedMembers;
	forgeStore.saveManifest(
		{
			label: 'ctdlCedsCampaign-composedBase',
			note: 'campaign re-derivation of the pilot S14 composition (membership-keyed; must equal 81627d17…)',
			members: composedMembers.map((oneId) => ({ blockId: oneId, position: null })),
		},
		(err, manifestResult) => {
			if (err) {
				next(`composed manifest save failed: ${err}`);
				return;
			}
			assert(
				`composed manifestKey == the pilot's 81627d17… (got ${manifestResult.manifestKey.slice(0, 12)}…)`,
				manifestResult.manifestKey === COMPOSED_MANIFEST_KEY,
			);
			state.composedManifestKey = manifestResult.manifestKey;
			next('', args);
		},
	);
});

// ---- 6a. harvest + census -----------------------------------------------------------
taskList.push((args, next) => {
	section('ceds: declaration harvest (the 52-vs-26 census, from the spec source)');
	const sourceDocument = JSON.parse(fs.readFileSync(CTDL_SOURCE, 'utf8'));
	const declarations = harvestCedsDeclarations(sourceDocument['@graph'] || []);
	const byPredicate = {};
	declarations.forEach((oneDeclaration) => {
		byPredicate[oneDeclaration.declaringPredicate] = (byPredicate[oneDeclaration.declaringPredicate] || 0) + 1;
	});
	assert(
		`53 declarations total (got ${declarations.length})`,
		declarations.length === 53,
	);
	assert(
		`26 owl:equivalentClass / 22 skos:narrowMatch / 5 skos:relatedMatch (got ${byPredicate['owl:equivalentClass']}/${byPredicate['skos:narrowMatch']}/${byPredicate['skos:relatedMatch']})`,
		byPredicate['owl:equivalentClass'] === 26 &&
			byPredicate['skos:narrowMatch'] === 22 &&
			byPredicate['skos:relatedMatch'] === 5,
	);
	const distinctConcepts = new Set(declarations.map((oneDeclaration) => oneDeclaration.fromStableId));
	assert(`52 distinct declaring concepts (got ${distinctConcepts.size})`, distinctConcepts.size === 52);
	state.declarations = declarations;
	next('', args);
});

// ---- 6b. load blocks + resolution context -------------------------------------------
taskList.push((args, next) => {
	section('resolution context (embedded CTDL + golden CEDS standard/reference blocks)');
	const sub = new taskListPlus();
	sub.push((subArgs, subNext) => {
		// locate the CEDS standard + reference member blockIds from the composed membership
		forgeStore.listBlocks((err, rows) => {
			if (err) {
				subNext(`listBlocks failed: ${err}`);
				return;
			}
			const memberSet = new Set(state.composedMembers);
			const cedsStandardRow = (rows || []).find(
				(oneRow) => memberSet.has(oneRow.blockId) && oneRow.type === 'standard' && oneRow.subject === 'CEDS',
			);
			const cedsReferenceRow = (rows || []).find(
				(oneRow) => memberSet.has(oneRow.blockId) && oneRow.type === 'reference' && oneRow.subject === 'CEDS',
			);
			assert('CEDS standard block located in composed membership', !!cedsStandardRow);
			assert('CEDS reference block located in composed membership', !!cedsReferenceRow);
			state.cedsStandardBlockId = cedsStandardRow && cedsStandardRow.blockId;
			state.cedsReferenceBlockId = cedsReferenceRow && cedsReferenceRow.blockId;
			subNext(cedsStandardRow && cedsReferenceRow ? '' : 'CEDS blocks missing', subArgs);
		});
	});
	sub.push((subArgs, subNext) => {
		forgeStore.getBlock({ blockId: EMBEDDED_CTDL_BLOCK_ID }, (err, blockRow) => {
			if (err) {
				subNext(err);
				return;
			}
			state.sourceBlock = replayBlock.deserializeBlock(blockRow.text);
			assert(`embedded CTDL deserializes (994 nodes; got ${state.sourceBlock.nodes.length})`, state.sourceBlock.nodes.length === 994);
			subNext('', subArgs);
		});
	});
	sub.push((subArgs, subNext) => {
		forgeStore.getBlock({ blockId: state.cedsStandardBlockId }, (err, blockRow) => {
			if (err) {
				subNext(err);
				return;
			}
			state.cedsNodes = replayBlock.deserializeBlock(blockRow.text).nodes;
			assert(`CEDS standard block deserializes (${state.cedsNodes.length} nodes)`, state.cedsNodes.length > 20000);
			subNext('', subArgs);
		});
	});
	sub.push((subArgs, subNext) => {
		forgeStore.getBlock({ blockId: state.cedsReferenceBlockId }, (err, blockRow) => {
			if (err) {
				subNext(err);
				return;
			}
			state.referenceNodes = replayBlock.deserializeBlock(blockRow.text).nodes;
			assert(`CEDS reference block deserializes (${state.referenceNodes.length} nodes)`, state.referenceNodes.length > 10000);
			subNext('', subArgs);
		});
	});
	sub.push((subArgs, subNext) => {
		state.resolutionContext = osFragmentJoin.buildResolutionContext({
			referenceNodes: state.referenceNodes,
			cedsStandardNodes: state.cedsNodes,
		});
		assert(
			'OS000273 has a UNIQUE owning property P000273',
			(state.resolutionContext.osOwnerIndex.OS000273 || []).join(',') === 'P000273',
		);
		subNext('', subArgs);
	});
	pipeRunner(sub.getList(), {}, (err) => next(err, args));
});

// ---- 6c. resolution (support + set-level) + census vs the existing 24 ----------------
taskList.push((args, next) => {
	section('resolution: 27 support declarations + 2 set-level anchors + 24-anchor census');
	const supportDeclarations = state.declarations.filter(
		(oneDeclaration) => oneDeclaration.declaringPredicate !== 'owl:equivalentClass',
	);
	const equivalenceDeclarations = state.declarations.filter(
		(oneDeclaration) => oneDeclaration.declaringPredicate === 'owl:equivalentClass',
	);
	const resolvedSupport = [];
	const abstainedSupport = [];
	supportDeclarations.forEach((oneDeclaration) => {
		const outcome = resolveFragmentDeclaration({
			declaration: oneDeclaration,
			resolutionContext: state.resolutionContext,
		});
		if (outcome.resolved) {
			resolvedSupport.push(outcome.resolved);
		} else {
			abstainedSupport.push(outcome.abstain);
		}
	});
	assert(`27/27 support declarations RESOLVE (got ${resolvedSupport.length}, abstained ${abstainedSupport.length})`, resolvedSupport.length === 27 && abstainedSupport.length === 0);

	// RED: a synthetic bogus declaration must ABSTAIN with its true reason, never resolve
	const redOutcome = resolveFragmentDeclaration({
		declaration: { fromStableId: '__TEST_bogus', declaringPredicate: 'skos:narrowMatch', rawAnchor: 'ceds:000273/#99999' },
		resolutionContext: state.resolutionContext,
	});
	assert(
		'RED: bogus notation ABSTAINS with reason (never a guess)',
		!!redOutcome.abstain && redOutcome.abstain.reason.indexOf('no OS+notation/name match') !== -1,
	);

	// set-level anchors: fragment-less equivalentClass declarations -> element-level target
	const setLevelDeclarations = equivalenceDeclarations.filter(
		(oneDeclaration) => parseCedsAnchor(oneDeclaration.rawAnchor) && parseCedsAnchor(oneDeclaration.rawAnchor).fragment == null,
	);
	assert(`exactly 2 set-level anchors (got ${setLevelDeclarations.length})`, setLevelDeclarations.length === 2);
	const resolvedSetLevel = [];
	setLevelDeclarations.forEach((oneDeclaration) => {
		const parsed = parseCedsAnchor(oneDeclaration.rawAnchor);
		const owners = state.resolutionContext.osOwnerIndex[parsed.osId] || [];
		assert(`${oneDeclaration.fromStableId}: ${parsed.osId} owner unique (${owners.join(',')})`, owners.length === 1);
		if (owners.length === 1) {
			resolvedSetLevel.push({
				fromStableId: oneDeclaration.fromStableId,
				targetKey: owners[0],
				rawAnchor: oneDeclaration.rawAnchor,
				declaringPredicate: oneDeclaration.declaringPredicate,
				resolutionJoin: `${parsed.osId}→owner ${owners[0]} unique (set-level anchor; element-level landing)`,
			});
		}
	});
	state.resolvedSupport = resolvedSupport;
	state.resolvedSetLevel = resolvedSetLevel;

	// census: the 24 fragment-carrying equivalentClass anchors resolve onto EXACTLY the
	// cedsAnchorKey set frozen in the existing authored block f957b88c… (trace, not re-emit)
	const fragmentEquivalence = equivalenceDeclarations.filter(
		(oneDeclaration) => parseCedsAnchor(oneDeclaration.rawAnchor) && parseCedsAnchor(oneDeclaration.rawAnchor).fragment != null,
	);
	assert(`24 fragment-carrying equivalentClass anchors (got ${fragmentEquivalence.length})`, fragmentEquivalence.length === 24);
	const resolvedFragmentKeys = new Set();
	fragmentEquivalence.forEach((oneDeclaration) => {
		const outcome = resolveFragmentDeclaration({
			declaration: oneDeclaration,
			resolutionContext: state.resolutionContext,
		});
		if (outcome.resolved) {
			resolvedFragmentKeys.add(outcome.resolved.targetKey);
		}
	});
	forgeStore.getBlock({ blockId: EXISTING_EXACT_BLOCK_ID }, (err, blockRow) => {
		if (err) {
			next(err);
			return;
		}
		const existingBlock = replayBlock.deserializeBlock(blockRow.text);
		state.existingExactEdges = existingBlock.edges;
		assert(`existing authored block carries 24 EXACT_MATCH edges (got ${existingBlock.edges.length})`, existingBlock.edges.length === 24);
		const existingAnchorKeys = new Set(
			existingBlock.edges.map((oneEdge) => v1(oneEdge.properties.cedsAnchorKey)),
		);
		const identical =
			existingAnchorKeys.size === resolvedFragmentKeys.size &&
			[...existingAnchorKeys].every((oneKey) => resolvedFragmentKeys.has(oneKey));
		assert(
			'EXACT census: the 24 fragment anchors resolve onto EXACTLY the frozen f957b88c cedsAnchorKey set (bijection — every authored EXACT edge traces to a named authority)',
			identical,
		);
		next('', args);
	});
});

// ---- 6d. build + serialize the two campaign blocks ----------------------------------
taskList.push((args, next) => {
	section('build Block A (support NARROW/RELATED, tierScope value) + Block B (set-level EXACT, tierScope property)');
	const emitPairBinding = pairBinding.resolvePairBinding({
		roster: standardDiscovery.roster({ includeSynthetic: true }),
		hubStandardName: standardDiscovery.cedsHubStandardName,
		spokeStandardName: 'CTDL',
		warn: (message) => console.error(message),
	});
	if (emitPairBinding.error) {
		next(`pair binding failed: ${emitPairBinding.error}`);
		return;
	}
	assert(
		`pair binding CEDS::CTDL @ (01,01) (got ${emitPairBinding.pairSubject} @ ${emitPairBinding.versionKey})`,
		emitPairBinding.pairSubject === 'CEDS::CTDL' && emitPairBinding.versionKey === '(01,01)',
	);
	state.emitPairBinding = emitPairBinding;

	const buildOnce = () => {
		const builderFor = (predicate) =>
			mappingSubgraphFactory({
				predicate,
				mappingJustification: 'semapv:ManualMappingCuration',
				subjectSource: 'CTDL',
				subjectVersion: state.sourceBlock.header.version || '',
				objectSource: 'CEDS',
				objectVersion: '',
				mappingTool: 'ctdlCedsCampaign:specDeclarationJoin',
			});
		const provenanceByKey = {};
		state.resolvedSupport.concat(state.resolvedSetLevel).forEach((oneResolved) => {
			provenanceByKey[`${oneResolved.fromStableId}|${oneResolved.targetKey}`] = {
				sourceDeclaration: oneResolved.declaringPredicate,
				rawAnchor: oneResolved.rawAnchor,
				resolutionJoin: oneResolved.resolutionJoin,
			};
		});
		state.resolvedSetLevel.forEach((oneResolved) => {
			provenanceByKey[`${oneResolved.fromStableId}|${oneResolved.targetKey}`].abstainLiftNote =
				'source declaration is scheme/set-level (fragment-less); the by-design value-tier abstain was lifted by FADED_FORGE ruling 2026-07-17 — element-level landing via the unique-owner join';
		});

		const narrowSubgraph = builderFor('narrowMatch').buildMappingSubgraph({
			authoredMappings: state.resolvedSupport
				.filter((oneResolved) => oneResolved.declaringPredicate === 'skos:narrowMatch')
				.map((oneResolved) => ({ fromStableId: oneResolved.fromStableId, targetKey: oneResolved.targetKey })),
			sourceNodes: state.sourceBlock.nodes,
			referenceNodes: state.referenceNodes,
			versionBridge: { entries: {} },
		});
		const relatedSubgraph = builderFor('relatedMatch').buildMappingSubgraph({
			authoredMappings: state.resolvedSupport
				.filter((oneResolved) => oneResolved.declaringPredicate === 'skos:relatedMatch')
				.map((oneResolved) => ({ fromStableId: oneResolved.fromStableId, targetKey: oneResolved.targetKey })),
			sourceNodes: state.sourceBlock.nodes,
			referenceNodes: state.referenceNodes,
			versionBridge: { entries: {} },
		});
		const exactSubgraph = builderFor('exactMatch').buildMappingSubgraph({
			authoredMappings: state.resolvedSetLevel.map((oneResolved) => ({
				fromStableId: oneResolved.fromStableId,
				targetKey: oneResolved.targetKey,
			})),
			sourceNodes: state.sourceBlock.nodes,
			referenceNodes: state.referenceNodes,
			versionBridge: { entries: {} },
		});

		const blockAEdges = stampProvenance({
			edges: narrowSubgraph.edges.concat(relatedSubgraph.edges).sort(canonicalEdgeSort),
			provenanceByKey,
		});
		const blockBEdges = stampProvenance({ edges: exactSubgraph.edges.sort(canonicalEdgeSort), provenanceByKey });

		const headerFor = (tierScope) => ({
			blockType: 'mapping',
			version: state.sourceBlock.header.version || null,
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
			pairA: emitPairBinding.pairA,
			pairAVersion: emitPairBinding.pairAVersion,
			pairB: emitPairBinding.pairB,
			pairBVersion: emitPairBinding.pairBVersion,
			publishedVersionA: emitPairBinding.publishedVersionA,
			publishedVersionB: emitPairBinding.publishedVersionB,
			tierScope,
		});
		return {
			orphanTotals:
				narrowSubgraph.orphans.length + relatedSubgraph.orphans.length + exactSubgraph.orphans.length +
				narrowSubgraph.diagnostics.fromGaps.length + relatedSubgraph.diagnostics.fromGaps.length +
				exactSubgraph.diagnostics.fromGaps.length,
			blockAEdges,
			blockBEdges,
			blockAText: replayBlock.serializeBlock({ header: headerFor('value'), nodes: [], edges: blockAEdges.map(toBlockEdge) }),
			blockBText: replayBlock.serializeBlock({ header: headerFor('property'), nodes: [], edges: blockBEdges.map(toBlockEdge) }),
		};
	};

	const firstBuild = buildOnce();
	const secondBuild = buildOnce();
	assert(`Block A carries 27 edges: 22 NARROW_MATCH + 5 RELATED_MATCH (got ${firstBuild.blockAEdges.length})`,
		firstBuild.blockAEdges.length === 27 &&
			firstBuild.blockAEdges.filter((oneEdge) => oneEdge.type === 'NARROW_MATCH').length === 22 &&
			firstBuild.blockAEdges.filter((oneEdge) => oneEdge.type === 'RELATED_MATCH').length === 5,
	);
	assert(`Block B carries 2 element-level EXACT_MATCH edges (got ${firstBuild.blockBEdges.length})`,
		firstBuild.blockBEdges.length === 2 &&
			firstBuild.blockBEdges.every((oneEdge) => oneEdge.type === 'EXACT_MATCH'),
	);
	assert('zero orphans / fromGaps across all three builders', firstBuild.orphanTotals === 0);
	assert(
		'determinism: two independent builds serialize BYTE-IDENTICAL (both blocks)',
		firstBuild.blockAText === secondBuild.blockAText && firstBuild.blockBText === secondBuild.blockBText,
	);
	// doctrine: emit acceptance includes a deserialize-back READ
	const readBackA = replayBlock.deserializeBlock(firstBuild.blockAText);
	const readBackB = replayBlock.deserializeBlock(firstBuild.blockBText);
	assert(
		'deserialize-back: edge counts and zero nodes on both blocks',
		readBackA.edges.length === 27 && readBackA.nodes.length === 0 &&
			readBackB.edges.length === 2 && readBackB.nodes.length === 0,
	);
	state.blockAText = firstBuild.blockAText;
	state.blockBText = firstBuild.blockBText;
	state.blockAEdges = firstBuild.blockAEdges;
	state.blockBEdges = firstBuild.blockBEdges;
	next('', args);
});

// ---- 6e. choke RED + saves ----------------------------------------------------------
taskList.push((args, next) => {
	section('saveBlock: choke RED (incomplete version key) then the two real saves');
	const strippedHeader = JSON.parse(state.blockAText.split('\n')[0]);
	delete strippedHeader.pairBVersion;
	const strippedText = [JSON.stringify(strippedHeader)]
		.concat(state.blockAText.split('\n').slice(1))
		.join('\n');
	forgeStore.saveBlock(
		{
			type: 'mapping',
			subject: state.emitPairBinding.pairSubject,
			version: state.emitPairBinding.versionKey,
			requires: [EMBEDDED_CTDL_BLOCK_ID, state.cedsReferenceBlockId, state.cedsStandardBlockId],
			text: strippedText,
			producedBy: 'ctdlCedsCampaign-071726',
		},
		(redErr) => {
			assert('RED: choke REJECTS a mapping save whose header lacks pairBVersion', !!redErr);
			const sub = new taskListPlus();
			sub.push((subArgs, subNext) => {
				forgeStore.saveBlock(
					{
						type: 'mapping',
						subject: state.emitPairBinding.pairSubject,
						version: state.emitPairBinding.versionKey,
						requires: [EMBEDDED_CTDL_BLOCK_ID, state.cedsReferenceBlockId, state.cedsStandardBlockId],
						text: state.blockAText,
						producedBy: 'ctdlCedsCampaign-071726',
					},
					(err, result) => {
						if (err) {
							subNext(`Block A save failed: ${err}`);
							return;
						}
						state.blockAId = result.blockId;
						assert(`Block A saved (${result.blockId.slice(0, 12)}…)`, !!result.blockId);
						subNext('', subArgs);
					},
				);
			});
			sub.push((subArgs, subNext) => {
				forgeStore.saveBlock(
					{
						type: 'mapping',
						subject: state.emitPairBinding.pairSubject,
						version: state.emitPairBinding.versionKey,
						requires: [EMBEDDED_CTDL_BLOCK_ID, state.cedsReferenceBlockId, state.cedsStandardBlockId],
						text: state.blockBText,
						producedBy: 'ctdlCedsCampaign-071726',
					},
					(err, result) => {
						if (err) {
							subNext(`Block B save failed: ${err}`);
							return;
						}
						state.blockBId = result.blockId;
						assert(`Block B saved (${result.blockId.slice(0, 12)}…)`, !!result.blockId);
						subNext('', subArgs);
					},
				);
			});
			pipeRunner(sub.getList(), {}, (err) => next(err, args));
		},
	);
});

// ---- 6f. dedup gate + ruled-provenance read-back ------------------------------------
taskList.push((args, next) => {
	section('dedup gate vs the existing 24 EXACT (f957b88c…) — genuine cross-block RED (review G1)');
	const existingTriples = new Set(state.existingExactEdges.map(edgeTripleKey));
	const campaignTriples = state.blockAEdges.concat(state.blockBEdges).map(edgeTripleKey);
	const overlap = campaignTriples.filter((oneTriple) => existingTriples.has(oneTriple));
	assert(`GREEN: ZERO (from,to,type) overlap between campaign blocks and f957b88c (got ${overlap.length})`, overlap.length === 0);
	// RED (review G1 — the prior form was a tautology): a SYNTHETIC campaign edge set carrying
	// a genuine duplicate of an f957b88c edge must be caught by the SAME cross-set census.
	const syntheticCampaign = state.blockAEdges.concat(state.blockBEdges).concat([state.existingExactEdges[0]]);
	const redOverlap = syntheticCampaign.map(edgeTripleKey).filter((oneTriple) => existingTriples.has(oneTriple));
	assert(
		`RED observed: the census DETECTS an injected f957b88c duplicate in a synthetic campaign set (got ${redOverlap.length} hit)`,
		redOverlap.length === 1,
	);
	// GREEN restored: the REAL campaign set remains clean after the RED probe
	const greenAgain = state.blockAEdges.concat(state.blockBEdges).map(edgeTripleKey).filter((oneTriple) => existingTriples.has(oneTriple));
	assert('GREEN restored: real campaign set still zero-overlap after the RED probe', greenAgain.length === 0);
	next('', args);
});

taskList.push((args, next) => {
	section('ruled-provenance READ-BACK from the store (review G2)');
	const sub = new taskListPlus();
	sub.push((subArgs, subNext) => {
		forgeStore.getBlock({ blockId: state.blockAId }, (err, row) => {
			if (err || !row) {
				subNext(err || 'Block A unreadable');
				return;
			}
			const storeEdges = replayBlock.deserializeBlock(row.text).edges;
			assert(`Block A read back from the store: 27 edges (got ${storeEdges.length})`, storeEdges.length === 27);
			const violations = validateRuledProvenance({ edges: storeEdges, expectAbstainLiftNote: false });
			assert(
				`Block A: ALL 27 store-read edges satisfy the ruled provenance conditions (violations: ${violations.length}${violations.length ? ' — ' + violations[0] : ''})`,
				violations.length === 0,
			);
			// RED: strip sourceDeclaration from ONE edge in a scratch COPY — the validator must fire
			const strippedCopy = JSON.parse(JSON.stringify(storeEdges));
			delete strippedCopy[0].properties.sourceDeclaration;
			const redViolations = validateRuledProvenance({ edges: strippedCopy, expectAbstainLiftNote: false });
			assert(
				`RED observed: stripping sourceDeclaration from one edge IS detected (got ${redViolations.length} violation)`,
				redViolations.length === 1,
			);
			subNext('', subArgs);
		});
	});
	sub.push((subArgs, subNext) => {
		forgeStore.getBlock({ blockId: state.blockBId }, (err, row) => {
			if (err || !row) {
				subNext(err || 'Block B unreadable');
				return;
			}
			const storeEdges = replayBlock.deserializeBlock(row.text).edges;
			assert(`Block B read back from the store: 2 edges (got ${storeEdges.length})`, storeEdges.length === 2);
			const violations = validateRuledProvenance({ edges: storeEdges, expectAbstainLiftNote: true });
			assert(
				`Block B: BOTH store-read edges are EXACT_MATCH with abstainLiftNote + full provenance (violations: ${violations.length}${violations.length ? ' — ' + violations[0] : ''})`,
				violations.length === 0,
			);
			const strippedCopy = JSON.parse(JSON.stringify(storeEdges));
			delete strippedCopy[0].properties.abstainLiftNote;
			const redViolations = validateRuledProvenance({ edges: strippedCopy, expectAbstainLiftNote: true });
			assert(
				`RED observed: stripping abstainLiftNote IS detected (got ${redViolations.length} violation)`,
				redViolations.length === 1,
			);
			subNext('', subArgs);
		});
	});
	pipeRunner(sub.getList(), {}, (err) => next(err, args));
});

// ---- 7. candidate manifest ----------------------------------------------------------
taskList.push((args, next) => {
	section('candidate manifest (81627d17 members + Block A + Block B)');
	const candidateMembers = state.composedMembers.concat([state.blockAId, state.blockBId]);
	assert(`candidate member count = 37 (got ${candidateMembers.length})`, candidateMembers.length === 37);
	assert(
		'candidate carries ALL 35 composed-base members BY ID (review G3 form)',
		state.composedMembers.every((oneId) => candidateMembers.indexOf(oneId) !== -1) &&
			state.composedMembers.length === 35,
	);
	assert(
		'candidate carries ZERO legacy carrier blockIds',
		candidateMembers.every((oneId) => LEGACY_CARRIER_IDS.indexOf(oneId) === -1),
	);
	forgeStore.saveManifest(
		{
			label: 'ctdlCedsCampaign-exactCandidate',
			note:
				'CTDL→CEDS mapping campaign EXACT tier: composed 81627d17 base + support-scheme ' +
				'NARROW/RELATED block + set-level element EXACT block (FADED_FORGE rulings 2026-07-17)',
			members: candidateMembers.map((oneId) => ({ blockId: oneId, position: null })),
		},
		(err, manifestResult) => {
			if (err) {
				next(`candidate manifest save failed: ${err}`);
				return;
			}
			state.candidateManifestKey = manifestResult.manifestKey;
			console.log(`  candidate manifest: ${state.candidateManifestKey.slice(0, 12)}…`);
			next('', args);
		},
	);
});

// ---- 8. delta-closure (subprocess-isolated probes) ----------------------------------
taskList.push((args, next) => {
	section('delta-closure (each probe subprocess-isolated; 4-6GB heap per call)');
	const violationKey = (oneViolation) => `${oneViolation.blockId}>${oneViolation.requiredBlockId}`;
	const baseVerdict = closureProbe({ dbPath: scratchDbPath, manifestKey: state.composedManifestKey });
	if (baseVerdict.error) {
		next(baseVerdict.error);
		return;
	}
	const candidateVerdict = closureProbe({ dbPath: scratchDbPath, manifestKey: state.candidateManifestKey });
	if (candidateVerdict.error) {
		next(candidateVerdict.error);
		return;
	}
	const baseSet = new Set((baseVerdict.violations || []).map(violationKey));
	const candidateSet = new Set((candidateVerdict.violations || []).map(violationKey));
	const newViolations = [...candidateSet].filter((oneKey) => !baseSet.has(oneKey));
	const healedViolations = [...baseSet].filter((oneKey) => !candidateSet.has(oneKey));
	assert(
		`delta-closure: candidate violations == composed-base violations (${candidateSet.size} == ${baseSet.size}; zero NEW, zero silently healed)`,
		newViolations.length === 0 && healedViolations.length === 0,
	);
	assert(
		'neither campaign block appears in ANY violation',
		(candidateVerdict.violations || []).every(
			(oneViolation) =>
				oneViolation.blockId !== state.blockAId &&
				oneViolation.blockId !== state.blockBId &&
				oneViolation.requiredBlockId !== state.blockAId &&
				oneViolation.requiredBlockId !== state.blockBId,
		),
	);
	// RED: candidate minus the CEDS standard block must ADD violations (requires contract live)
	const redMembers = state.composedMembers
		.filter((oneId) => oneId !== state.cedsStandardBlockId)
		.concat([state.blockAId, state.blockBId]);
	forgeStore.saveManifest(
		{
			label: '__TEST_ctdlCedsExact_closureRed',
			note: 'RED manifest: candidate minus the CEDS standard block',
			members: redMembers.map((oneId) => ({ blockId: oneId, position: null })),
		},
		(err, redManifest) => {
			if (err) {
				next(`closure RED manifest save failed: ${err}`);
				return;
			}
			const redVerdict = closureProbe({ dbPath: scratchDbPath, manifestKey: redManifest.manifestKey });
			if (redVerdict.error) {
				next(redVerdict.error);
				return;
			}
			const redSet = new Set((redVerdict.violations || []).map(violationKey));
			const redNew = [...redSet].filter((oneKey) => !baseSet.has(oneKey));
			assert(`RED: removing the CEDS standard block ADDS violations (got ${redNew.length} new)`, redNew.length > 0);
			next('', args);
		},
	);
});

// ---- 9. preservation + G8 + state ---------------------------------------------------
taskList.push((args, next) => {
	section('preservation + G8');
	assert(
		'candidate membership preserves f957b88c (the 24 legacy EXACT) and all three bridge blocks',
		[EXISTING_EXACT_BLOCK_ID].concat(Object.values(PHASE3_BRIDGE_BLOCK_IDS)).every(
			(oneId) => state.composedMembers.indexOf(oneId) !== -1,
		),
	);
	const bridgeEdgeTotal = state.bridgeBlocks.reduce((sum, oneBridge) => sum + oneBridge.edgeCount, 0);
	assert(`bridge population intact: 506 structural family edges (got ${bridgeEdgeTotal})`, bridgeEdgeTotal === 506);
	const canonicalShaAfter = sha256File(CANONICAL_STORE);
	const goldEvalShaAfter = sha256File(GOLDEVAL_COPY);
	assert('G8: canonical store BYTE-IDENTICAL after the whole leg', canonicalShaAfter === CANONICAL_SHA256);
	assert('G8: goldEval260716 copy BYTE-IDENTICAL after the whole leg', goldEvalShaAfter === GOLDEVAL_SHA256);
	fs.writeFileSync(
		STATE_PATH,
		JSON.stringify(
			{
				writtenBy: 'ctdlCedsExact-battery',
				scratchDbPath,
				composedManifestKey: state.composedManifestKey,
				candidateManifestKey: state.candidateManifestKey,
				exactBlocks: {
					supportNarrowRelated: { blockId: state.blockAId, edgeCount: 27, tierScope: 'value' },
					setLevelElementExact: { blockId: state.blockBId, edgeCount: 2, tierScope: 'property' },
					preservedLegacyExact: { blockId: EXISTING_EXACT_BLOCK_ID, edgeCount: 24 },
				},
				bridgeBlocks: state.bridgeBlocks,
				cedsStandardBlockId: state.cedsStandardBlockId,
				cedsReferenceBlockId: state.cedsReferenceBlockId,
				embeddedCtdlBlockId: EMBEDDED_CTDL_BLOCK_ID,
			},
			null,
			2,
		),
	);
	console.log(`  state written: ${STATE_PATH}`);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nBATTERY ERROR: ${err}`);
	}
	console.log(`\n=== ctdlCedsExact-battery: ${pass} passed / ${fail} failed ===`);
	process.exit(err || fail > 0 ? 1 : 0);
});
