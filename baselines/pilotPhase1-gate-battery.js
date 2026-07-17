#!/usr/bin/env node
'use strict';

// pilotPhase1-gate-battery.js — Phase 1 gate suite for the forge-architecture pilot
// (SPECIFICATION.md v2 S1; IMPLEMENTATION_PLAN.md v2 Phase 1; gates G5 + G6 + the
// legacy 'bridge' regression + the S1.7 closure verification).
//
// Runs ENTIRELY against a throwaway temp sqlite store (never the canonical store,
// never a container — memory-safe, container-free). Mirrors the module-test harness
// (forge-store/test/test.js): PASS/FAIL asserts, exit 0 iff all green.
//
// RED-THEN-GREEN DOCTRINE: run this battery against the UNMODIFIED framework first —
// gates G5 (choke) and G6 (mint membership + group-swap) must be observed FAILING
// (the un-extended framework accepts a keyless structuralBridge and strands a stale
// structural member on pairing re-selection). Then apply the S1 changes and re-run:
// all green. The closure section carries its own injected fault (a structuralBridge
// with EMPTY requires shows closure stays silent without the S1.7 requires contract).
//
//   node baselines/pilotPhase1-gate-battery.js

const fs = require('fs');
const os = require('os');
const path = require('path');

process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: noop,
	error: (msg) => console.error(`xLog.error: ${msg}`),
	result: noop,
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const CORE_LIB = path.join(__dirname, '..', 'npm', 'qtools-graph-forge-core', 'lib');
const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const manifestEditorFactory = require(path.join(
	CORE_LIB,
	'manifest-editor',
	'manifest-editor',
));
const pairGroupMint = require(path.join(CORE_LIB, 'pair-group-mint', 'pair-group-mint'))(
	{},
);
const { deserializeBlock } = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const vocabulary = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

// -----
// assertion harness (the module-test pattern)
let passCount = 0;
let failCount = 0;
const failures = [];
const assert = (label, condition) => {
	if (condition) {
		passCount++;
		console.log(`  PASS  ${label}`);
	} else {
		failCount++;
		failures.push(label);
		console.log(`  FAIL  ${label}`);
	}
};
const section = (title) => console.log(`\n== ${title} ==`);

// -----
// temp scratch store
const dbPath = path.join(
	os.tmpdir(),
	`__TEST_pilotPhase1_${process.pid}_${Date.now()}.sqlite`,
);
const cleanup = () => {
	['', '-wal', '-shm'].forEach((suffix) => {
		const target = `${dbPath}${suffix}`;
		if (fs.existsSync(target)) {
			fs.unlinkSync(target);
		}
	});
};
const finish = (err) => {
	cleanup();
	console.log('');
	if (err) {
		console.log(`PIPELINE ERROR: ${err}`);
	}
	console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
	process.exit(failCount === 0 && !err ? 0 : 1);
};

// -----
// block-text builders (deterministic; __TEST_ content)
const PAIR_SUBJECT = 'CTDL::CTDLASN';
const VERSION_KEY = '(01,01)';

const structuralBridgeText = ({ omitField = null, marker = 'sb1' } = {}) => {
	const header = {
		kind: 'header',
		blockType: 'structuralBridge',
		serializerVersion: '1',
		pairA: 'CTDL',
		pairAVersion: '01',
		pairB: 'CTDLASN',
		pairBVersion: '01',
		publishedVersionA: '20260327',
		publishedVersionB: '20230929',
		producedByMarker: `__TEST_${marker}`,
	};
	if (omitField) {
		delete header[omitField];
	}
	const edgeLine = {
		kind: 'edge',
		type: 'HAS_PROPERTY',
		fromRef: { source: 'CTDLASN', id: `ceasn:__TEST_${marker}_from` },
		toRef: { source: 'CTDL', id: `ceterms:__TEST_${marker}_to` },
		properties: {
			provenanceTier: ['structural'],
			provenanceSource: ['uriBridge'],
			bridgeAuthored: [true],
		},
	};
	return `${JSON.stringify(header)}\n${JSON.stringify(edgeLine)}\n`;
};

const mappingText = ({ marker = 'map1' } = {}) => {
	const header = {
		kind: 'header',
		blockType: 'mapping',
		serializerVersion: '1',
		pairA: 'CTDL',
		pairAVersion: '01',
		pairB: 'CTDLASN',
		pairBVersion: '01',
		publishedVersionA: '20260327',
		publishedVersionB: '20230929',
		producedByMarker: `__TEST_${marker}`,
	};
	const edgeLine = {
		kind: 'edge',
		type: 'EXACT_MATCH',
		fromRef: { source: 'CTDL', id: `ceterms:__TEST_${marker}_from` },
		toRef: { source: 'CTDLASN', id: `ceasn:__TEST_${marker}_to` },
		properties: { provenanceTier: ['spec-authoritative'] },
	};
	return `${JSON.stringify(header)}\n${JSON.stringify(edgeLine)}\n`;
};

// the legacy keyless family-bridge shape (edfCtdlUriBridge precedent: blockType
// 'bridge', NO pair fields) — must remain saveable/loadable/deserializable.
const legacyBridgeText = `${JSON.stringify({
	kind: 'header',
	blockType: 'bridge',
	serializerVersion: '1',
	stableUriPropertyName: 'uri',
	resolutionKey: 'uri',
})}\n${JSON.stringify({
	kind: 'edge',
	type: 'HAS_OPTION_SET',
	fromRef: { source: 'CTDLASN', id: 'ceasn:__TEST_legacy_from' },
	toRef: { source: 'CTDL', id: 'ceterms:__TEST_legacy_to' },
	properties: { provenanceTier: ['structural'] },
})}\n`;

// =====================================================================

const forgeStore = forgeStoreFactory();
const manifestEditor = manifestEditorFactory({ forgeStore });

const taskList = new taskListPlus();

// ---- vocabulary predicates exist and carve the right sets (S1.1/S1.2/S1.3a) ----
taskList.push((args, next) => {
	section('S1 vocabulary predicates');
	assert(
		`STRUCTURAL_BRIDGE_BLOCK_TYPE === 'structuralBridge'`,
		vocabulary.STRUCTURAL_BRIDGE_BLOCK_TYPE === 'structuralBridge',
	);
	assert(
		'isVersionKeyedBlockType: mapping/inferredDecision/pairGroup/structuralBridge in; standard/bridge out',
		typeof vocabulary.isVersionKeyedBlockType === 'function' &&
			vocabulary.isVersionKeyedBlockType('mapping') &&
			vocabulary.isVersionKeyedBlockType('inferredDecision') &&
			vocabulary.isVersionKeyedBlockType('pairGroup') &&
			vocabulary.isVersionKeyedBlockType('structuralBridge') &&
			!vocabulary.isVersionKeyedBlockType('standard') &&
			!vocabulary.isVersionKeyedBlockType('bridge'),
	);
	assert(
		'isPairGroupMemberType: mapping+structuralBridge in; inferredDecision/bridge out (rider preserved)',
		typeof vocabulary.isPairGroupMemberType === 'function' &&
			vocabulary.isPairGroupMemberType('mapping') &&
			vocabulary.isPairGroupMemberType('structuralBridge') &&
			!vocabulary.isPairGroupMemberType('inferredDecision') &&
			!vocabulary.isPairGroupMemberType('bridge'),
	);
	assert(
		'isRekeyableBlockType: mapping+inferredDecision+structuralBridge in; pairGroup/bridge out',
		typeof vocabulary.isRekeyableBlockType === 'function' &&
			vocabulary.isRekeyableBlockType('mapping') &&
			vocabulary.isRekeyableBlockType('inferredDecision') &&
			vocabulary.isRekeyableBlockType('structuralBridge') &&
			!vocabulary.isRekeyableBlockType('pairGroup') &&
			!vocabulary.isRekeyableBlockType('bridge'),
	);
	assert(
		'MAPPING_BLOCK_TYPES itself UNCHANGED (mapping-only consumers protected)',
		JSON.stringify(vocabulary.MAPPING_BLOCK_TYPES) ===
			JSON.stringify(['mapping', 'inferredDecision']),
	);
	next('', args);
});

// ---- init the scratch store ----
taskList.push((args, next) => {
	forgeStore.init({ dbPath }, (err) => next(err, args));
});

// ---- G5 CHOKE: structuralBridge version-key ENFORCED --------------------------
['pairA', 'pairAVersion', 'pairB', 'pairBVersion'].forEach((oneField) => {
	taskList.push((args, next) => {
		if (oneField === 'pairA') section('G5 choke — structuralBridge version key');
		forgeStore.saveBlock(
			{
				type: 'structuralBridge',
				subject: PAIR_SUBJECT,
				version: VERSION_KEY,
				requires: [],
				text: structuralBridgeText({ omitField: oneField, marker: `g5_${oneField}` }),
				producedBy: '__TEST_battery',
			},
			(err) => {
				assert(
					`G5: structuralBridge missing ${oneField} => REJECTED at saveBlock`,
					!!err && `${err}`.indexOf('REJECTED') !== -1,
				);
				next('', args);
			},
		);
	});
});

taskList.push((args, next) => {
	forgeStore.saveBlock(
		{
			type: 'structuralBridge',
			subject: 'CTDLASN::CTDL', // header says CTDL::CTDLASN — canonical-form mismatch
			version: VERSION_KEY,
			requires: [],
			text: structuralBridgeText({ marker: 'g5_subject' }),
			producedBy: '__TEST_battery',
		},
		(err) => {
			assert(
				'G5: structuralBridge subject not matching header canonical pair form => REJECTED',
				!!err && `${err}`.indexOf('canonical') !== -1,
			);
			next('', args);
		},
	);
});

// ---- standards + complete structuralBridge saves (the working set) -------------
taskList.push((args, next) => {
	section('working set — standards + complete structuralBridge blocks');
	forgeStore.saveBlock(
		{
			type: 'standard',
			subject: 'CTDL',
			version: null,
			requires: [],
			text: '__TEST_ modern CTDL standard block bytes',
			producedBy: '__TEST_battery',
		},
		(err, result) => next(err, { ...args, stdA: result && result.blockId }),
	);
});
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{
			type: 'standard',
			subject: 'CTDLASN',
			version: null,
			requires: [],
			text: '__TEST_ CTDLASN standard block bytes',
			producedBy: '__TEST_battery',
		},
		(err, result) => next(err, { ...args, stdB: result && result.blockId }),
	);
});

// sb1 — complete key, requires = EXACTLY the two standard blockIds (S1.7)
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{
			type: 'structuralBridge',
			subject: PAIR_SUBJECT,
			version: VERSION_KEY,
			requires: [args.stdA, args.stdB],
			text: structuralBridgeText({ marker: 'sb1' }),
			producedBy: '__TEST_battery',
		},
		(err, result) => {
			assert('G5: structuralBridge with COMPLETE version key => ACCEPTED', !err);
			next('', { ...args, sb1: result && result.blockId });
		},
	);
});

// sb2 — a second-generation block for the same pairing (the swap payload)
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{
			type: 'structuralBridge',
			subject: PAIR_SUBJECT,
			version: VERSION_KEY,
			requires: [args.stdA, args.stdB],
			text: structuralBridgeText({ marker: 'sb2' }),
			producedBy: '__TEST_battery',
		},
		(err, result) => next(err, { ...args, sb2: result && result.blockId }),
	);
});

// mapping sibling under the same pairing (mixed-kind group + swap-of-both check)
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{
			type: 'mapping',
			subject: PAIR_SUBJECT,
			version: VERSION_KEY,
			requires: [],
			text: mappingText({ marker: 'map1' }),
			producedBy: '__TEST_battery',
		},
		(err, result) => next(err, { ...args, map1: result && result.blockId }),
	);
});

// ---- pair-group-mint membership (S1.2): structuralBridge members accepted ------
taskList.push((args, next) => {
	section('S1.2 pair-group-mint membership');
	pairGroupMint.mintPairGroupIntoStore(
		{
			forgeStore,
			pairA: 'CTDL',
			pairAVersion: '01',
			pairB: 'CTDLASN',
			pairBVersion: '01',
			publishedVersionA: '20260327',
			publishedVersionB: '20230929',
			pairSubject: PAIR_SUBJECT,
			versionKey: VERSION_KEY,
			members: [args.sb1, args.map1],
			displayName: '__TEST_ mixed-kind group g1 (deterministic)',
			producedBy: '__TEST_battery',
		},
		(err, minted) => {
			assert(
				'mint: mixed mapping+structuralBridge member list ACCEPTED',
				!err && minted && minted.memberCount === 2,
			);
			// on the RED (pre-change) run the mint refuses structuralBridge members;
			// substitute a synthetic descriptor so the G6 swap sections still execute
			// (combine only records groupBlockId in the manifest note).
			next('', {
				...args,
				group1: minted || { groupBlockId: '__TEST_syntheticGroupRef' },
			});
		},
	);
});

taskList.push((args, next) => {
	pairGroupMint.mintPairGroupIntoStore(
		{
			forgeStore,
			pairA: 'CTDL',
			pairAVersion: '01',
			pairB: 'CTDLASN',
			pairBVersion: '01',
			publishedVersionA: '20260327',
			publishedVersionB: '20230929',
			pairSubject: PAIR_SUBJECT,
			versionKey: VERSION_KEY,
			members: [args.stdA],
			displayName: '__TEST_ bad group (standard member)',
			producedBy: '__TEST_battery',
		},
		(err) => {
			assert(
				'mint: a standard-typed member still REFUSED (membership predicate is not a free-for-all)',
				!!err,
			);
			next('', args);
		},
	);
});

// ---- G6 COMPOSABILITY: re-selecting a structural pairing SWAPS old members out --
taskList.push((args, next) => {
	section('G6 composability — group-swap over structuralBridge members');
	manifestEditor.combine(
		{
			base: null,
			set: [args.stdA, args.stdB],
			groups: [
				{
					pairSubject: PAIR_SUBJECT,
					versionKey: VERSION_KEY,
					groupBlockId: args.group1.groupBlockId,
					displayName: '__TEST_ g1',
					members: [args.sb1, args.map1],
				},
			],
			label: '__TEST_ manifest1',
			note: '__TEST_',
		},
		(err, result) => next(err, { ...args, manifest1: result && result.manifestKey }),
	);
});

taskList.push((args, next) => {
	forgeStore.getManifest({ manifestKey: args.manifest1 }, (err, manifest) => {
		if (err) {
			next(err, args);
			return;
		}
		const ids = (manifest.members || []).map((oneMember) => oneMember.blockId);
		assert(
			'G6 setup: manifest1 carries stdA+stdB+sb1+map1',
			ids.indexOf(args.stdA) !== -1 &&
				ids.indexOf(args.stdB) !== -1 &&
				ids.indexOf(args.sb1) !== -1 &&
				ids.indexOf(args.map1) !== -1,
		);
		next('', args);
	});
});

// re-select the SAME pairing with a new group carrying only sb2: BOTH old members
// (mapping map1 AND structuralBridge sb1) must be swapped OUT.
taskList.push((args, next) => {
	manifestEditor.combine(
		{
			base: args.manifest1,
			set: [],
			groups: [
				{
					pairSubject: PAIR_SUBJECT,
					versionKey: VERSION_KEY,
					groupBlockId: args.group1.groupBlockId,
					displayName: '__TEST_ g2',
					members: [args.sb2],
				},
			],
			label: '__TEST_ manifest2',
			note: '__TEST_',
		},
		(err, result) => next(err, { ...args, manifest2: result && result.manifestKey }),
	);
});

taskList.push((args, next) => {
	forgeStore.getManifest({ manifestKey: args.manifest2 }, (err, manifest) => {
		if (err) {
			next(err, args);
			return;
		}
		const ids = (manifest.members || []).map((oneMember) => oneMember.blockId);
		assert(
			'G6: stale structuralBridge member sb1 SWAPPED OUT on pairing re-selection',
			ids.indexOf(args.sb1) === -1,
		);
		assert('G6: stale mapping member map1 swapped out too', ids.indexOf(args.map1) === -1);
		assert('G6: new structuralBridge member sb2 present', ids.indexOf(args.sb2) !== -1);
		assert(
			'G6: standard members untouched by the swap',
			ids.indexOf(args.stdA) !== -1 && ids.indexOf(args.stdB) !== -1,
		);
		next('', args);
	});
});

// ---- S1.7 CLOSURE: requires = the two standard blockIds enforces version alignment
taskList.push((args, next) => {
	section('S1.7 closure — pairing without both standards fails');
	manifestEditor.combine(
		{
			base: null,
			set: [args.stdA], // stdB deliberately ABSENT
			groups: [
				{
					pairSubject: PAIR_SUBJECT,
					versionKey: VERSION_KEY,
					groupBlockId: args.group1.groupBlockId,
					displayName: '__TEST_ closure-fault manifest',
					members: [args.sb2],
				},
			],
			label: '__TEST_ manifestClosureFault',
			note: '__TEST_',
		},
		(err, result) =>
			next(err, { ...args, manifestClosureFault: result && result.manifestKey }),
	);
});

taskList.push((args, next) => {
	forgeStore.validateManifestClosure(
		{ manifestKey: args.manifestClosureFault },
		(err, verdict) => {
			if (err) {
				next(err, args);
				return;
			}
			const missingViolation = (verdict.violations || []).some(
				(oneViolation) =>
					oneViolation.kind === 'missing' && oneViolation.blockId === args.sb2,
			);
			assert(
				'closure: structuralBridge pairing WITHOUT its second standard => closure FAILS (missing)',
				verdict.wellFormed === false && missingViolation,
			);
			next('', args);
		},
	);
});

taskList.push((args, next) => {
	forgeStore.validateManifestClosure({ manifestKey: args.manifest2 }, (err, verdict) => {
		if (err) {
			next(err, args);
			return;
		}
		assert(
			'closure: pairing WITH both standard members => closure PASSES',
			verdict.wellFormed === true,
		);
		next('', args);
	});
});

// injected fault: a structuralBridge with EMPTY requires — closure stays SILENT
// (this is the RED that proves S1.7's requires contract is load-bearing: the gate
// only bites when producers stamp requires = the two standard blockIds).
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{
			type: 'structuralBridge',
			subject: PAIR_SUBJECT,
			version: VERSION_KEY,
			requires: [],
			text: structuralBridgeText({ marker: 'sbNoRequires' }),
			producedBy: '__TEST_battery',
		},
		(err, result) => next(err, { ...args, sbNoRequires: result && result.blockId }),
	);
});
taskList.push((args, next) => {
	manifestEditor.combine(
		{
			base: null,
			set: [],
			groups: [
				{
					pairSubject: PAIR_SUBJECT,
					versionKey: VERSION_KEY,
					groupBlockId: args.group1.groupBlockId,
					displayName: '__TEST_ empty-requires fault',
					members: [args.sbNoRequires],
				},
			],
			label: '__TEST_ manifestEmptyRequires',
			note: '__TEST_',
		},
		(err, result) =>
			next(err, { ...args, manifestEmptyRequires: result && result.manifestKey }),
	);
});
taskList.push((args, next) => {
	forgeStore.validateManifestClosure(
		{ manifestKey: args.manifestEmptyRequires },
		(err, verdict) => {
			if (err) {
				next(err, args);
				return;
			}
			assert(
				'closure FAULT-INJECTION: empty requires => closure silent (proves S1.7 contract is load-bearing)',
				verdict.wellFormed === true,
			);
			next('', args);
		},
	);
});

// ---- LEGACY REGRESSION: keyless type='bridge' blocks still save/load/deserialize
taskList.push((args, next) => {
	section('legacy regression — keyless bridge blocks stay loadable');
	forgeStore.saveBlock(
		{
			type: 'bridge',
			subject: 'ctdlFamilyUriBridge',
			version: null,
			requires: [],
			text: legacyBridgeText,
			producedBy: '__TEST_battery',
		},
		(err, result) => {
			assert('legacy: keyless type=bridge block still ACCEPTED at saveBlock', !err);
			next('', { ...args, legacyBridge: result && result.blockId });
		},
	);
});
taskList.push((args, next) => {
	forgeStore.getBlock({ blockId: args.legacyBridge }, (err, row) => {
		assert(
			'legacy: keyless bridge block loads back byte-identically',
			!err && row && row.text === legacyBridgeText,
		);
		// replay-plane invariance: the PURE deserializer still parses the legacy shape
		// (a live-graph replay is deliberately out of this battery — container-free).
		let deserialized = null;
		let deserializeError = null;
		try {
			deserialized = deserializeBlock(legacyBridgeText);
		} catch (caughtErr) {
			deserializeError = caughtErr;
		}
		assert(
			'legacy: replay-block.deserializeBlock still parses the keyless bridge shape',
			!deserializeError &&
				deserialized &&
				deserialized.edges.length === 1 &&
				deserialized.header.blockType === 'bridge',
		);
		next('', args);
	});
});

// structuralBridge deserialize invariance (the new type rides the same replay path
// 'bridge' blocks do — edge-only, generic).
taskList.push((args, next) => {
	let deserialized = null;
	let deserializeError = null;
	try {
		deserialized = deserializeBlock(structuralBridgeText({ marker: 'sb1' }));
	} catch (caughtErr) {
		deserializeError = caughtErr;
	}
	assert(
		'structuralBridge: replay-block.deserializeBlock parses the new shape (edge-only)',
		!deserializeError && deserialized && deserialized.edges.length === 1,
	);
	next('', args);
});

// ---- A1 (BR1-1): edf-rekey -transform EXECUTES end-to-end on a structuralBridge --
// The source is stamped at versionKey (00,00); the transform must derive the pair
// from the HEADER (the edges are bidirectional — endpoint uniformity can never
// describe a structural block), re-key to the roster's CURRENT default snapshots
// (a genuinely NEW versionKey), preserve the edge region byte-identically, and
// produce a block the choke ACCEPTS. Drives the REAL CLI against this battery's
// scratch store via EDF_FORGE_STORE_DB.
taskList.push((args, next) => {
	section('A1 — edf-rekey transform on a structuralBridge (real CLI, scratch store)');
	const sb3Text = structuralBridgeText({ marker: 'a1_rekey' })
		.replace('"pairAVersion":"01"', '"pairAVersion":"00"')
		.replace('"pairBVersion":"01"', '"pairBVersion":"00"');
	forgeStore.saveBlock(
		{
			type: 'structuralBridge',
			subject: PAIR_SUBJECT,
			version: '(00,00)',
			requires: [args.stdA, args.stdB],
			text: sb3Text,
			producedBy: '__TEST_battery',
		},
		(err, result) =>
			next(err, { ...args, sb3: result && result.blockId, sb3Text }),
	);
});
taskList.push((args, next) => {
	const { execFileSync } = require('child_process');
	const edfRekeyPath = path.join(
		__dirname,
		'..',
		'cli',
		'lib.d',
		'edf-rekey',
		'edfRekey.js',
	);
	let cliStdout = null;
	let cliError = null;
	try {
		cliStdout = execFileSync(
			'node',
			[edfRekeyPath, '-transform', `--sourceBlock=${args.sb3}`],
			{ env: { ...process.env, EDF_FORGE_STORE_DB: dbPath }, encoding: 'utf8' },
		);
	} catch (caughtErr) {
		cliError = caughtErr;
	}
	let rekeyVerdict = null;
	if (!cliError) {
		try {
			rekeyVerdict = JSON.parse(cliStdout);
		} catch (parseErr) {
			cliError = parseErr;
		}
	}
	assert(
		'A1: transform on a structuralBridge RUNS (header-pair derivation reached)',
		!cliError && rekeyVerdict && rekeyVerdict.action === 'transform',
	);
	if (!rekeyVerdict) {
		next('', args);
		return;
	}
	assert(
		'A1: derived pair = the header pair, order preserved',
		rekeyVerdict.pairSubject === PAIR_SUBJECT,
	);
	assert(
		'A1: re-keyed to a NEW versionKey (roster defaults, not the stamped (00,00))',
		rekeyVerdict.versionKey !== '(00,00)' &&
			/^\([^,()]+,[^,()]+\)$/.test(rekeyVerdict.versionKey),
	);
	assert('A1: tierScope = structural', rekeyVerdict.tierScope === 'structural');
	next('', { ...args, rekeyVerdict });
});
taskList.push((args, next) => {
	if (!args.rekeyVerdict) {
		next('', args);
		return;
	}
	forgeStore.getBlock({ blockId: args.rekeyVerdict.newBlockId }, (err, row) => {
		assert(
			'A1: output ACCEPTED by the choke — saved as structuralBridge at the new key',
			!err &&
				row &&
				row.type === 'structuralBridge' &&
				row.version === args.rekeyVerdict.versionKey,
		);
		const sourceEdgeRegion = args.sb3Text.slice(args.sb3Text.indexOf('\n') + 1);
		const newEdgeRegion = row
			? `${row.text}`.slice(`${row.text}`.indexOf('\n') + 1)
			: null;
		assert('A1: edge region BYTE-IDENTICAL after re-key', newEdgeRegion === sourceEdgeRegion);
		next('', args);
	});
});

// ---- listBlocks catalog (S1.4): structuralBridge visible; legacy bridge still not
taskList.push((args, next) => {
	section('S1.4 listBlocks catalog');
	manifestEditor.listBlocks((err, blocks) => {
		if (err) {
			next(err, args);
			return;
		}
		const types = new Set(blocks.map((oneBlock) => oneBlock.type));
		assert('catalog: structuralBridge blocks are LISTED', types.has('structuralBridge'));
		assert('catalog: legacy bridge blocks remain internal (not listed)', !types.has('bridge'));
		next('', args);
	});
});

pipeRunner(taskList.getList(), {}, (err) => finish(err));
