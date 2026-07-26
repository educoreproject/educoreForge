#!/usr/bin/env node
'use strict';

// test-replay.js — gates for the -replay verb: regenerate a graph FROM A STORED MANIFEST, with NO
// forging and NO bridge runs. A persisted manifest is a reproducibility artifact; -replay is the
// verb that turns it back into a graph. Given a standards database (blocks + manifest) and a
// manifest refId, it OPENS the manifest, RESOLVES its member schema blocks, and RESTORES them into a
// fresh DEV_ eval graph — the SAME materialize path a -build runs after it composes, and nothing
// else. No forger, no bridgeMaker, no decision store, no Voyage/LLM.
//
// HERMETIC. This suite opens a REAL temp-file standardsDatabase (the same throwaway-file discipline
// lib/standards-database's own suite and test-build's MANIFEST PERSISTED stage use) so the real
// open/getManifest/getBlock read path is genuinely exercised — but it NEVER provisions Docker or
// spends Voyage credit: the manifest is SEEDED by driving build() over contract-enforcing component
// doubles, and the replay itself drives a replayManager SPY through build()'s component seam. No
// docker, no voyage, no llm, no decision store.
//
// WHAT IS ASSERTED:
//   * replay of a stored manifest resolves EXACTLY its member schema blocks (memberCount correct,
//     and the resolved block set equals the manifest's stored membership);
//   * it drives the materialize/restore path with them — create({purpose:'materialize'}) then
//     init({schemaBlocks}) — and NEVER a forge/dependencyGraph create (no forging happened);
//   * every refusal fires BY NAME (polyArch2 §6): missing standardsDatabase, missing manifestRefId,
//     a refId absent from the manifests table, and a member block absent from the blocks table.
//   * the control surface: -replay is dispatched, its required parameters are refused by name, and
//     -help advertises it.
//
// Run: node apps/graph-builder/test/test-replay.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const helpText = () => `
NAME
     ${moduleName} -- gates for the -replay verb (regenerate a graph from a stored manifest)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Seeds a real temp-file standardsDatabase by driving build() over component doubles, then drives
     buildLib.replay over a replayManager SPY (no docker/voyage/llm/decision-store) and asserts the
     stored manifest resolves exactly its member blocks into the materialize path. Every refusal is
     watched firing, and the control surface is spawned to prove the verb is wired and advertised.

OPTIONS
     -verbose    Show every individual assertion, not just failures and the tally.
     -quiet      Failures and the tally only.
     -help       This message.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const recipeLib = require('../lib/recipe')();
const buildLib = require('../lib/build')();
const realManifestEditor = require('../apps/manifest-editor');
const contentAddress = require('../../../lib/content-address/content-address')();
const standardsDatabaseModule = require('../../../lib/standards-database/standards-database')();

const goodRecipe = (name) => path.join(__dirname, '..', '..', '..', 'recipes', `${name}.recipe.jsonc`);

const treeRoot = path.join(__dirname, '..', '..', '..');
const executable = path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js');

const loadOrDie = (filePath) => {
	const loaded = recipeLib.loadRecipe(filePath);
	if (loaded.error) {
		console.error(`test setup failure: could not load ${filePath} -- ${loaded.error}`);
		process.exit(1);
	}
	return loaded.recipe;
};

// a capturing xLog — the pipeline's progress lines ARE its observable behaviour
const capturingXLog = () => {
	const lines = [];
	return {
		lines,
		text: () => lines.join('\n'),
		status: (...args) => lines.push(args.join(' ')),
		error: (...args) => lines.push(args.join(' ')),
		result: (...args) => lines.push(args.join(' ')),
		verbose: () => {},
	};
};

// ---------------------------------------------------------------------
// SEED-side component doubles — the SAME contract-enforcing shape test-build uses to populate a real
// store without docker/voyage. They mint deterministic PG-JSONL blocks so a real standardsDatabase
// (and its content-address verify-on-read) accepts them.
// ---------------------------------------------------------------------

const CREATE_DECLARED_KEYS = ['purpose', 'graphName'];

const doubleBlockText = (header, selectionLabels) => {
	const stableId = `${header.standardKey}/${(selectionLabels || []).join('')}`;
	const headerLine = JSON.stringify({
		kind: 'header',
		blockType: header.blockType,
		standardKey: header.standardKey,
		version: header.version,
		embeddingDims: null,
		selectionLabels,
	});
	const nodeLine = JSON.stringify({
		kind: 'node',
		ref: { source: header.standardKey, id: stableId },
		labels: (selectionLabels || []).concat('ForgedNode'),
		stableId,
		properties: {},
	});
	return `${headerLine}\n${nodeLine}\n`;
};

const seedReplayManager = () => () => {
	let createSeq = 0;
	return {
		create: (spec, cb) => {
			const undeclared = Object.keys(spec || {}).filter((k) => !CREATE_DECLARED_KEYS.includes(k));
			if (undeclared.length) {
				cb(`replayManager.create is MONOMORPHIC — undeclared spec key(s) ${undeclared.join(', ')}`);
				return;
			}
			createSeq += 1;
			const graphName = `DEV_seedDouble_${(spec || {}).purpose || 'graph'}_${createSeq}`;
			cb('', {
				graphName,
				containerName: graphName,
				boltUrl: `bolt://localhost:${7600 + createSeq}`,
				password: `seedPw${createSeq}`,
				boltPort: 7600 + createSeq,
				httpPort: 7700 + createSeq,
			});
		},
		init: (spec, cb) => cb('', { schemaBlockCount: (spec && spec.schemaBlocks) ? spec.schemaBlocks.length : 0 }),
		harvest: ({ header, selectionLabels }, cb) => {
			const blockText = doubleBlockText(header, selectionLabels);
			cb('', { blockText, blockId: contentAddress.blockIdForText(blockText), nodeCount: 1, edgeCount: 0, stableIdCoverage: 1 });
		},
		delete: (handle, cb) => cb(''),
	};
};

const seedForger = () => () => ({
	forge: ({ standard, version }, cb) =>
		cb('', { standard, version, nodeEdges: { nodes: [], edges: [], embeddingDims: null }, nodeCount: 0, edgeCount: 0, embedCallCount: 0 }),
});

const seedBridgeMaker = () => () => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 0, decisionBlock: null }) });

// ---------------------------------------------------------------------
// THE REPLAY SPY — the replayManager -replay drives to materialize. Records every call so the suite
// can prove ONLY create({purpose:'materialize'}) + init({schemaBlocks}) run: NO forge, NO
// dependencyGraph create, NO harvest.
// ---------------------------------------------------------------------

const makeReplaySpy = () => {
	const calls = { create: [], init: [], deleted: [] };
	let seq = 0;
	const factory = () => ({
		create: (spec, cb) => {
			calls.create.push(spec);
			seq += 1;
			const graphName = `DEV_replaySpy_${(spec || {}).purpose || 'graph'}_${seq}`;
			cb('', { graphName, containerName: graphName, boltUrl: `bolt://localhost:${7810 + seq}`, password: `pw${seq}`, boltPort: 7810 + seq, httpPort: 7910 + seq });
		},
		init: (spec, cb) => {
			calls.init.push(spec);
			cb('');
		},
		delete: (handle, cb) => {
			calls.deleted.push(handle && handle.graphName);
			cb('');
		},
		// forge/harvest deliberately ABSENT: if -replay ever tried to forge or harvest, it would throw
		// — which is a stronger proof than a passive spy that "no forging happened".
	});
	return { factory, calls };
};

// a PARTIAL-STORE double for the missing-member refusal. The real store's FOREIGN KEY (manifestBlocks
// -> blocks) PREVENTS a member block from being deleted while its membership row survives — the
// store's own integrity refuses to manufacture the fault. manifestEditor.schemaBlocks' refusal is the
// DEFENCE against exactly the case the FK normally forbids (a corrupted/hand-edited store), so it is
// injected here: getManifest returns the real membership, getBlock returns null for it, and the
// resolution refuses a partial membership by name. Hermetic — no store is touched.
const partialStoreDouble = (membershipRefIds) => ({
	databaseFilePath: '(missing-member fault double)',
	getManifest: ({ refId }, cb) =>
		cb('', {
			refId,
			name: 'seeded',
			description: 'seeded',
			members: membershipRefIds.map((schemaBlockRefId, index) => ({
				schemaBlockRefId,
				kind: 'standardBase',
				subjectRefId: `seed@current_base_${index}`,
				position: index,
				description: 'a seeded member',
			})),
		}),
	getBlock: ({ refId }, cb) => cb('', null), // the member block is absent — the fault under test
});

// ---------------------------------------------------------------------
// SEED — build a real store, once, then run every stage against it.
// ---------------------------------------------------------------------

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfReplay-'));
const databaseFilePath = path.join(scratchDir, `replayGate_${process.pid}.sqlite3`);

const runCli = (args) =>
	spawnSync(process.execPath, [executable, ...args], { input: '', encoding: 'utf8', cwd: treeRoot });

standardsDatabaseModule.open({ databaseFilePath }, (openErr, standardsDatabase) => {
	if (openErr) {
		harness.section('SEED');
		harness.ok('a throwaway standardsDatabase opened', false, openErr);
		harness.report();
		return;
	}

	// SEED: drive build() over doubles to populate blocks + manifests + manifestBlocks in the real store.
	buildLib.build(
		loadOrDie(goodRecipe('cedsLif')),
		{
			xLog: capturingXLog(),
			standardsDatabase,
			components: {
				forger: seedForger(),
				replayManager: seedReplayManager(),
				bridgeMaker: seedBridgeMaker(),
				manifestEditor: realManifestEditor,
			},
		},
		(seedErr, seedResult) => {
			harness.section('SEED — a real store populated with a known manifest + its member blocks');
			harness.equal('the seed build succeeded against the real store', seedErr, '');
			const storedManifestId = (seedResult || {}).manifestId;
			const storedMemberCount = (seedResult || {}).memberCount;
			harness.equal('  seeding a three-member manifest (cedsLif)', storedMemberCount, 3);
			harness.match('  addressed by manifestKeyForMembership', storedManifestId, /^[0-9a-f]{16,}$/);

			standardsDatabase.getManifest({ refId: storedManifestId }, (getErr, storedManifest) => {
				harness.equal('the seeded manifest is readable back', getErr, '');
				const membershipRefIds = ((storedManifest || {}).members || [])
					.map((m) => m.schemaBlockRefId)
					.sort();
				harness.equal('  its membership names three blocks', membershipRefIds.length, 3);

				stageReplaySuccess(standardsDatabase, storedManifestId, storedMemberCount, membershipRefIds);
			});
		},
	);

	// =====================================================================
	// SUCCESS — replay the stored manifest resolves exactly its members into the materialize path
	// =====================================================================
	// function DECLARATIONS, not const arrows: the component doubles call back SYNCHRONOUSLY, so the
	// whole seed -> replay chain runs inside the open() callback BEFORE these lines are reached. A
	// const would sit in the temporal dead zone (the exact trap makeManifest documents), and
	// sqlite-instance would swallow the ReferenceError and retry. Declarations hoist; consts do not.
	function stageReplaySuccess(standardsDatabase, storedManifestId, storedMemberCount, membershipRefIds) {
		harness.section('REPLAY — a stored manifest resolves exactly its members into the materialize/restore path');

		const spy = makeReplaySpy();
		const xLog = capturingXLog();
		buildLib.replay(
			{ manifestRefId: storedManifestId },
			{ xLog, standardsDatabase, components: { replayManager: spy.factory } },
			(err, result) => {
				harness.equal('replay of the stored manifest succeeds', err, '');
				harness.ok('  a result is returned', !!result, JSON.stringify(result));
				harness.equal(
					'  echoing the SAME manifestId the caller replayed',
					(result || {}).manifestId,
					storedManifestId,
				);
				harness.equal('  and the correct memberCount', (result || {}).memberCount, storedMemberCount);
				harness.match(
					"  the boltUrl is the fresh eval graph HANDLE's url",
					(result || {}).boltUrl,
					/^bolt:\/\/localhost:78\d\d$/,
				);

				// DROVE THE MATERIALIZE PATH — create(materialize) then init(schemaBlocks), nothing else.
				harness.equal('exactly one graph was created', spy.calls.create.length, 1);
				harness.equal(
					'  and it was created for purpose materialize (NOT forge, NOT dependencyGraph)',
					spy.calls.create[0] && spy.calls.create[0].purpose,
					'materialize',
				);
				harness.ok(
					'  no forge/dependencyGraph create ever ran (no forging, no bridge)',
					!spy.calls.create.some((s) => s.purpose === 'forge' || s.purpose === 'dependencyGraph'),
					JSON.stringify(spy.calls.create),
				);
				harness.equal('exactly one init (restore) ran', spy.calls.init.length, 1);

				// THE RESTORE PAYLOAD IS THE MANIFEST'S MEMBERSHIP — resolved blocks, in count and identity.
				const restored = (spy.calls.init[0] && spy.calls.init[0].schemaBlocks) || [];
				harness.equal(
					'  the restore payload carries exactly memberCount schema blocks',
					restored.length,
					storedMemberCount,
				);
				harness.ok(
					'  and the RESTORATION payload only (no applyLabels, no nodeEdges) — the materialize contract',
					spy.calls.init[0] &&
						spy.calls.init[0].applyLabels === undefined &&
						spy.calls.init[0].nodeEdges === undefined,
					JSON.stringify(Object.keys(spy.calls.init[0] || {})),
				);
				const restoredRefIds = restored.map((b) => b.refId).sort();
				harness.equal(
					'  the resolved block set EQUALS the manifest stored membership (exactly its members)',
					JSON.stringify(restoredRefIds),
					JSON.stringify(membershipRefIds),
				);
				harness.ok(
					'  the graph is KEPT (it is the product) — no delete on the success path',
					spy.calls.deleted.length === 0,
					JSON.stringify(spy.calls.deleted),
				);
				harness.match('the replay logs the materialize step', xLog.text(), /\[materialize\] -> bolt:\/\//);

				stageRefusals(standardsDatabase, storedManifestId, membershipRefIds);
			},
		);
	};

	// =====================================================================
	// REFUSALS — each fired BY NAME (polyArch2 §6), never a silent empty graph
	// =====================================================================
	function stageRefusals(standardsDatabase, storedManifestId, membershipRefIds) {
		harness.section('REFUSALS — missing store, missing refId, absent manifest, absent member block');

		const spy = makeReplaySpy();

		// (1) missing standardsDatabase
		buildLib.replay({ manifestRefId: storedManifestId }, { xLog: capturingXLog() }, (noStoreErr, noStoreResult) => {
			harness.match(
				'a replay with no standardsDatabase is REFUSED, saying so',
				noStoreErr,
				/standardsDatabase is REQUIRED/,
			);
			harness.ok('  and hands back no result', noStoreResult === undefined, JSON.stringify(noStoreResult));

			// (2) missing/blank manifestRefId
			buildLib.replay(
				{ manifestRefId: '   ' },
				{ xLog: capturingXLog(), standardsDatabase, components: { replayManager: spy.factory } },
				(blankErr, blankResult) => {
					harness.match(
						'a blank manifestRefId is REFUSED, naming the parameter',
						blankErr,
						/manifestRefId is REQUIRED/,
					);
					harness.ok('  and hands back no result', blankResult === undefined, JSON.stringify(blankResult));

					// (3) a refId absent from the manifests table
					buildLib.replay(
						{ manifestRefId: 'deadbeefNotAManifest' },
						{ xLog: capturingXLog(), standardsDatabase, components: { replayManager: spy.factory } },
						(absentErr, absentResult) => {
							harness.match(
								'a refId not present in the manifests table is REFUSED, naming it',
								absentErr,
								/there is no manifest 'deadbeefNotAManifest'/,
							);
							harness.ok('  and hands back no result', absentResult === undefined, JSON.stringify(absentResult));
							harness.ok(
								'  no graph was created for any refused replay (no silent empty graph)',
								spy.calls.create.length === 0,
								JSON.stringify(spy.calls.create),
							);

							// (4) a member block absent from the blocks table — the store's FK forbids manufacturing
							// this against the real store, so a partial-store double supplies the membership while
							// its member block resolves to null. The refusal lives in manifestEditor.schemaBlocks.
							const spy2 = makeReplaySpy();
							buildLib.replay(
								{ manifestRefId: storedManifestId },
								{
									xLog: capturingXLog(),
									standardsDatabase: partialStoreDouble(membershipRefIds),
									components: { replayManager: spy2.factory },
								},
								(missingErr, missingResult) => {
									harness.match(
										'a member block absent from the blocks table is REFUSED, refusing a partial membership',
										missingErr,
										/not in the standardsDatabase|Refusing to resolve a partial membership/,
									);
									harness.ok('  and hands back no result', missingResult === undefined, JSON.stringify(missingResult));
									harness.ok(
										'  and NO graph was materialized for the partial membership (no silent partial graph)',
										spy2.calls.create.length === 0,
										JSON.stringify(spy2.calls.create),
									);

									stageControlSurface();
								},
							);
						},
					);
				},
			);
		});
	};

	// =====================================================================
	// CONTROL SURFACE — the verb is dispatched, its parameters refused by name, and advertised. All
	// hermetic: these fail before any materialize, so no docker/voyage is touched.
	// =====================================================================
	function stageControlSurface() {
		harness.section('CONTROL SURFACE — -replay is dispatched, refuses missing params by name, and is advertised');

		const helpRun = runCli(['-help']);
		harness.match('-help advertises -replay', helpRun.stdout, /-replay/);
		harness.match('-help documents --manifestRefId', helpRun.stdout, /--manifestRefId/);

		const noStore = runCli(['-replay']);
		harness.equal('-replay without a standards database exits 1', noStore.status, 1);
		harness.match(
			'  naming the missing --standardsDatabaseFilePath',
			noStore.stderr,
			/--standardsDatabaseFilePath/,
		);
		harness.ok('  and writes nothing to stdout', noStore.stdout === '', noStore.stdout);

		const noRefId = runCli(['-replay', '--standardsDatabaseFilePath=' + databaseFilePath]);
		harness.equal('-replay without a manifest refId exits 1', noRefId.status, 1);
		harness.match('  naming the missing --manifestRefId', noRefId.stderr, /--manifestRefId/);

		// a real store + a refId that is not in it — the pipeline is genuinely entered and refuses by name
		const bogus = runCli([
			'-replay',
			'--standardsDatabaseFilePath=' + databaseFilePath,
			'--manifestRefId=deadbeefNotAManifest',
		]);
		harness.equal('-replay with an absent refId reaches the store and exits 1', bogus.status, 1);
		harness.match('  naming the absent manifest', bogus.stderr, /there is no manifest 'deadbeefNotAManifest'/);

		fs.rmSync(scratchDir, { recursive: true, force: true });
		harness.report();
	};
});
