#!/usr/bin/env node
'use strict';

// test-build.js — gates for the -build ORCHESTRATION (apps/graph-builder/lib/build.js) as it runs
// over the DECLARED component contracts (../interfaces.js). What is under test here is the
// PIPELINE, not the components: that the right phases run in the right order, that real recipe
// data (tokens, versions, pair keys) is threaded through rather than invented, and that a
// harvested SCHEMA BLOCK flows harvest -> manifest.add -> the standardsDatabase.
//
// NO DOCKER, NO VOYAGE, NO DATABASE. The orchestrator drives the real component modules in
// production; two of them (forger, replayManager) provision containers and spend embedding credit,
// so this suite injects TEST DOUBLES for those two through build()'s component seam and lets the
// other two run their real bodies. The doubles are not permissive stand-ins — they ENFORCE the
// declared contract, which is the point:
//
//   * replayManager.create is MONOMORPHIC. The double REFUSES any spec key beyond
//     { purpose, graphName }, so the polymorphic create({ purpose:'materialize', manifestId })
//     this orchestrator used to make turns the suite red instead of passing unnoticed.
//   * create returns a GraphHandle, an OBJECT. Not a bolt url string. Anything downstream that
//     treats the result as a string fails on the handle.
//   * manifestEditor.add takes ONE named-argument object carrying a schema BLOCK, and answers
//     through a callback. A positional add(key, kind, blockId) cannot satisfy it.
//
// And the strongest gate of all, in its own section: the pipeline is run once against the REAL
// manifestEditor with an in-memory standardsDatabase double, so what build.js passes to add() is validated by
// the actual module — content address recomputed from the block text and all.
//
// FAULT INJECTION: every error path in the orchestrator is exercised by a component that
// genuinely fails. No error message in build.js is asserted without having been WATCHED to fire.
//
// Run: node apps/graph-builder/test/test-build.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- gates for the -build orchestration (apps/graph-builder/lib/build.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives the build pipeline over contract-ENFORCING component doubles (no Docker, no Voyage,
     no database) and asserts SHAPE and SEQUENCE. Runs the pipeline once against the REAL
     manifestEditor with an in-memory standardsDatabase double so the named-argument add() contract is
     validated by the module itself. Then injects failing components through the deps.components
     seam so every error path in the orchestrator is watched firing -- including a positive
     control proving the seam itself changes nothing.

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
// the REAL block codec + the REAL ceds hub derivation — the hub round-trip stage drives forgeHub's
// ACTUAL output through the pipeline (not a placeholder), so it needs both, hermetically (pure, no
// docker/voyage/db).
const realReplayBlock = require('../../../lib/replay/replay-block')();
// Phase 2 of the hubReimplementation flipped the forger registry to cedsHubForge; Phase 2a of the
// hub-kit-role migration DELETED that registry and moved the declaration into the kit. The ground
// truth here is the module forges/ceds/parserDescriptor.ini names in hubModule= (factory takes
// { hubVersion, hubNamespace }; forgeHub is R7 callback-shaped). It is required by path rather than
// through the descriptor because THIS suite is the one that must fail if the two ever disagree.
const cedsHubForge = require('../../../forges/ceds/hubCeds'); // PHASE 2c: the kit's injection, was lib/cedsHubForge

// The REAL standards-database + a throwaway sqlite file — used by ONE stage (MANIFEST PERSISTED)
// that must prove a -build writes its manifest THROUGH to a store, not merely composes it. Every
// other stage uses the in-memory standardsDatabaseDouble, which never looks at its manifests table;
// this stage opens a real temp-file store (hermetic — the same throwaway-file discipline
// lib/standards-database's own suite uses; NO docker/voyage/llm) so the manifests and manifestBlocks
// tables are genuinely populated and can be read back. sqliteInstance is required for a raw COUNT
// read the store API does not expose.
const os = require('os');
const fs = require('fs');
const standardsDatabaseModule = require('../../../lib/standards-database/standards-database')();
const sqliteInstance = require('../../../lib/sqlite-instance/sqlite-instance')({});

// fixture — a recipe held under test/fixtures/ as DATA. Since Phase 3 of the root-and-branch reset
// (2026-08-15) the two recipes this suite builds from — cedsLif and lifOnly — live here: they name
// a removed forge/bridge and are NOT buildable, but every build in this suite runs against DOUBLES
// (workingForger, workingBridgeMaker …), so a recipe is only ever read, never forged.
const fixture = (name) => path.join(__dirname, 'fixtures', `${name}.recipe.jsonc`);

// sourceOf — a file's source with whole-line comments stripped, so a scan for a surviving in-code
// constant is not fooled by prose in the header (and is not defeated by it either).
const sourceOf = (filePath) =>
	require('fs')
		.readFileSync(filePath, 'utf8')
		.split('\n')
		.filter((oneLine) => !/^\s*(\/\/|\*|\/\*)/.test(oneLine))
		.join('\n');

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
// THE STORE DOUBLE — a plain object with the four methods manifestEditor uses. Deliberately in
// memory: this suite must never open a database, and a manifest's behaviour under test is
// composition and addressing, not sqlite.
// ---------------------------------------------------------------------

const standardsDatabaseDouble = () => {
	const savedBlocks = {};
	const savedManifests = [];
	return {
		savedBlocks,
		savedManifests,
		databaseFilePath: '(in-memory standardsDatabase double — no database is opened)',
		saveBlock: ({ text, kind, subject, producedBy }, cb) => {
			const refId = contentAddress.blockIdForText(text);
			const alreadyPresent = !!savedBlocks[refId];
			savedBlocks[refId] = { text, refId, kind, subject, producedBy };
			cb('', { refId, alreadyPresent });
		},
		getBlock: ({ refId }, cb) => cb('', savedBlocks[refId] || null),
		saveManifest: (spec, cb) => {
			savedManifests.push(spec);
			cb('', { refId: `manifestDouble:${savedManifests.length}`, memberCount: spec.members.length, alreadyPresent: false });
		},
		getManifest: (spec, cb) => cb('', null),
	};
};

// ---------------------------------------------------------------------
// COMPONENT DOUBLES — contract-ENFORCING. Each factory returns a WORKING component; pass
// overrides to break exactly one method.
// ---------------------------------------------------------------------

// the block text a harvest double hands back. Distinct per subject and label so two members of one
// manifest never collide on their content address, and shaped as a REAL PG-JSONL block (kind:'header'
// line first, then a kind:'node' line) — deserializable by replay-block, because build.js now
// deserializes the harvested base block to feed forgeHub, and a block that will not deserialize is
// not a schema block. embeddingDims is declared null (this double embeds nothing).
// ⟪JOB 6a⟫ doubleConservationRecord — the CONSERVATION RECORD the REAL replayManager.harvest returns,
// mirrored here because a double that omits part of the contract its seam calls does not isolate the
// test, it HIDES the seam. (That is this file's own rule, written about `finish` before JOB 6a added
// this field; the same reasoning applies unchanged.) build.js REFUSES a harvest that returns no usable
// record rather than skipping the artifact, so a double without one fails the build at phase A — which
// is exactly what it did, and correctly.
//
// REAL-SHAPED, NEVER A STUB THAT ALWAYS READS PASS: keyed by the blockId the double is already
// computing, and carrying counts consistent with the block it actually produced, so a suite gating on
// these values is gating on something the double genuinely did.
// THE VERDICT IS DERIVED, NOT DECLARED. An earlier form of this helper wrote `verdict: 'PASS'` as a
// LITERAL: the counts were honest and the one field that decides anything was a constant, so the double
// could not have said otherwise no matter what it served. The real verb's rule is that conservation
// holds when what was LOADED equals what was HARVESTED, so that rule is mirrored here rather than its
// usual answer. AND WHEN IT DOES NOT HOLD THE DOUBLE REFUSES BY NAME, exactly as the real verb does —
// it does NOT emit a FAIL verdict, because a failed comparison mints no block and 'FAILED' is
// unrepresentable by design. Returns { record } or { refusal }.
const doubleConservationRecord = ({ blockId, header, loadedNodeCount, loadedEdgeCount, harvestedNodeCount, harvestedEdgeCount }) => {
	if (loadedEdgeCount !== harvestedEdgeCount || loadedNodeCount !== harvestedNodeCount) {
		return { refusal: `doubleConservationRecord: CONSERVATION FAILED for '${blockId}' — loaded ${loadedNodeCount} nodes / ${loadedEdgeCount} edges, harvested ${harvestedNodeCount} / ${harvestedEdgeCount}. The real verb refuses here and mints no block; a double must not emit a verdict the real one cannot.` };
	}
	return {
		record: {
			verdict: 'PASS',
			graphName: 'doubleGraph',
			loadedEdgeTotal: loadedEdgeCount,
			loadedEdgeDistinct: loadedEdgeCount,
			harvestedEdgeDistinct: harvestedEdgeCount,
			loadedNodeDistinct: loadedNodeCount,
			harvestedNodeDistinct: harvestedNodeCount,
			duplicateEdgeCount: 0,
			duplicateNodeCount: 0,
			blockRefId: blockId,
			blockSubject: (header || {}).standardKey,
		},
	};
};

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

const CREATE_DECLARED_KEYS = ['purpose', 'graphName'];

const workingReplayManager = (overrides) => () => {
	let createSeq = 0;
	return Object.assign(
		{
			// MONOMORPHIC. create means "an empty graph", always — it takes no manifest, no
			// dependency list, and nothing else that would make it a second loader. An undeclared
			// key is refused BY NAME so the drift is legible rather than merely red.
			create: (spec, cb) => {
				const undeclared = Object.keys(spec || {}).filter(
					(oneKey) => !CREATE_DECLARED_KEYS.includes(oneKey),
				);
				if (undeclared.length) {
					cb(
						`replayManager.create is MONOMORPHIC — undeclared spec key(s) ${undeclared.join(
							', ',
						)}. All polymorphism about putting content into a graph lives in init.`,
					);
					return;
				}
				createSeq += 1;
				const graphName = `DEV_testDouble_${(spec || {}).purpose || 'graph'}_${createSeq}`;
				// a HANDLE, not a url string
				cb('', {
					graphName,
					containerName: graphName,
					boltUrl: `bolt://localhost:${7800 + createSeq}`,
					password: `testPassword${createSeq}`,
					boltPort: 7800 + createSeq,
					httpPort: 7900 + createSeq,
				});
			},
			init: (spec, cb) => {
				const { inGraph, nodeEdges, schemaBlocks, applyLabels } = spec || {};
				if (!inGraph || typeof inGraph !== 'object' || !inGraph.boltUrl) {
					cb(`replayManager.init: inGraph must be a GraphHandle carrying a boltUrl`);
					return;
				}
				if (nodeEdges !== undefined && schemaBlocks !== undefined) {
					cb(`replayManager.init: REFUSED — both CREATION and RESTORATION payloads supplied`);
					return;
				}
				if (schemaBlocks !== undefined && applyLabels !== undefined) {
					cb(
						`replayManager.init: REFUSED — applyLabels supplied with the RESTORATION payload`,
					);
					return;
				}
				cb('', {
					nodesMerged: nodeEdges ? nodeEdges.nodes.length : 0,
					edgesMerged: nodeEdges ? nodeEdges.edges.length : 0,
					schemaBlockCount: schemaBlocks ? schemaBlocks.length : 0,
				});
			},
			// ⟪graphSelfDoc Phase 5⟫ THE FIFTH VERB on the hermetic double. It is written to ENFORCE
			// the contract, not merely to tolerate the call: a stub that returned success unconditionally
			// would let build.js call finish with a missing storeReader or manifestRefId and this suite
			// would never notice — which is exactly how I discovered the gap, by adding a guard to
			// build.js that the crash then MASKED before it could fire.
			finish: (spec, cb) => {
				const { inGraph, manifestRefId, storeReader, gateResults } = spec || {};
				if (!inGraph || typeof inGraph !== 'object' || !inGraph.boltUrl) {
					cb(`replayManager.finish: inGraph must be a GraphHandle carrying a boltUrl`);
					return;
				}
				if (!manifestRefId) {
					cb(`replayManager.finish: a manifestRefId is REQUIRED — it is the passport's central claim`);
					return;
				}
				if (!storeReader || typeof storeReader.getManifest !== 'function') {
					cb(`replayManager.finish: a storeReader exposing getManifest is REQUIRED`);
					return;
				}
				if (!Array.isArray(gateResults)) {
					cb(`replayManager.finish: gateResults must be an array of verdicts (an absent entry means notRun)`);
					return;
				}
				cb('', {
					applied: [{ name: 'stubFinisher', summary: 'test double' }],
					writeCount: 2,
					passportElementId: 'stub:passport:1',
					xorVerified: true,
				});
			},
			harvest: ({ inGraph, selectionLabels, header }, cb) => {
				if (!header || !header.blockType || !header.standardKey) {
					cb(`replayManager.harvest: a header carrying blockType and standardKey is required`);
					return;
				}
				const blockText = doubleBlockText(header, selectionLabels);
				// the address is minted where the block is born, exactly as the real harvest does
				const doubleBlockId = contentAddress.blockIdForText(blockText);
				cb('', {
					blockText,
					blockId: doubleBlockId,
					nodeCount: 1,
					edgeCount: 0,
					stableIdCoverage: 1,
					selectionLabels,
					inGraph,
					conservationRecord: doubleConservationRecord({ blockId: doubleBlockId, header, loadedNodeCount: 1, loadedEdgeCount: 0, harvestedNodeCount: 1, harvestedEdgeCount: 0 }).record,
				});
			},
			delete: (handle, cb) => {
				if (!handle || typeof handle !== 'object' || !handle.graphName) {
					cb(`replayManager.delete: a GraphHandle is required, got ${typeof handle}`);
					return;
				}
				cb('');
			},
		},
		overrides || {},
	);
};

// resolveBundle is a STATIC on the real forger module (token -> declared standardName from
// parserDescriptor.ini); build.js's bridge phase consults it for exact `_source` matching (the
// EXACT-NAME RULE, 2026-07-30). The double answers uppercase — matching these fixtures' forged
// `_source` values — attached to the factory exactly where the real module carries it.
const forgerRegistryDouble = ({ standard }) => ({ standardName: String(standard).toUpperCase() });
const workingForger = (overrides) =>
	Object.assign(
		() =>
			Object.assign(
				{
					forge: ({ standard, version }, cb) =>
						cb('', {
							standard,
							version,
							snapshotKey: '01',
							publishedVersion: version,
							versionSource: 'spec',
							nodeEdges: { nodes: [], edges: [], embeddingDims: null },
							nodeCount: 0,
							edgeCount: 0,
							embedCallCount: 0,
						}),
				},
				overrides || {},
			),
		{ resolveBundle: forgerRegistryDouble },
	);

// withDescribeBridge — every bridgeMaker double in this suite must expose the DECLARED component surface,
// which gained describeBridge in Phase 7 (apps/graph-builder/interfaces.js COMPONENT_SHAPES.bridgeMaker).
// Wrapping the doubles rather than editing each one means a SEVENTH double cannot arrive missing it. Without
// it, build.js's pre-spend check refuses the component by name — correctly, but every scenario in the suite
// would then be red for a reason that has nothing to do with what the scenario is testing.
//
// It reports producerKind 'authored' for every bridge, which is inert in this suite because no scenario here
// declares two MAPPING bridges (one hub each) in a single recipe — the structural pairings carry pairWith and
// no hub, and the pre-spend check excludes those. A future scenario that DID declare two would need a double
// answering per bridgeName; it would announce itself as a false collision refusal rather than pass quietly.
const withDescribeBridge = (oneDoubleFactory) => (...factoryArgumentList) => ({
	describeBridge: ({ bridgeName, source }) => ({
		description: Object.freeze({ bridgeName, source, producerKind: 'authored', subjectDiscriminator: undefined }),
	}),
	...oneDoubleFactory(...factoryArgumentList),
});

const workingBridgeMaker = (overrides) => () =>
	Object.assign(
		{
			run: (spec, cb) => cb('', { ...spec, edgesWritten: 0 }),
			// describeBridge JOINED THE DECLARED COMPONENT INTERFACE in Phase 7 (apps/graph-builder/interfaces.js
			// COMPONENT_SHAPES.bridgeMaker.describeBridge), so a double that omits it is NON-CONFORMING and
			// build.js's pre-spend check refuses it by name. Added here because a double's job is to conform to
			// the contract, not to be the reason a contract cannot be enforced.
			describeBridge: ({ bridgeName, source }) => ({
				description: Object.freeze({ bridgeName, source, producerKind: 'authored', subjectDiscriminator: undefined }),
			}),
		},
		overrides || {},
	);

// A manifestEditor double that holds build.js to the DECLARED contract: init takes named
// arguments, add takes ONE named-argument object carrying a schema BLOCK and answers through a
// callback, and the composed address comes from refId() -- never id().
const workingManifestEditor = (overrides) => ({ standardsDatabase } = {}) =>
	Object.assign(
		{
			init: ({ name, description, recipe }) => {
				if (typeof name !== 'string' || name.trim() === '') {
					throw new Error(`manifestEditor double init: a name is REQUIRED (got ${typeof name})`);
				}
				if (typeof description !== 'string' || description.trim() === '') {
					throw new Error(`manifestEditor double init '${name}': a description is REQUIRED`);
				}
				if (!standardsDatabase || typeof standardsDatabase.saveBlock !== 'function') {
					throw new Error(`manifestEditor double init '${name}': a standardsDatabase is REQUIRED`);
				}
				const members = [];
				return {
					add: (spec, cb) => {
						if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
							cb(`manifestEditor.add takes ONE named-argument object, got ${typeof spec}`);
							return;
						}
						const { subject, kind, description: memberDescription, schemaBlock } = spec;
						if (typeof subject !== 'string' || subject.trim() === '') {
							cb(`manifestEditor.add: a subject is REQUIRED`);
							return;
						}
						if (typeof kind !== 'string' || kind.trim() === '') {
							cb(`manifestEditor.add '${subject}': a kind is REQUIRED`);
							return;
						}
						if (typeof memberDescription !== 'string' || memberDescription.trim() === '') {
							cb(`manifestEditor.add '${subject}': a description is REQUIRED`);
							return;
						}
						if (!schemaBlock || typeof schemaBlock.blockText !== 'string') {
							cb(
								`manifestEditor.add '${subject}': a schemaBlock carrying blockText is ` +
									`REQUIRED — an id is not a schema block`,
							);
							return;
						}
						members.push({
							subject,
							kind,
							schemaBlockRefId: schemaBlock.blockId,
							position: members.length,
							description: memberDescription,
						});
						cb('', {
							memberCount: members.length,
							schemaBlockRefId: schemaBlock.blockId,
							alreadyPresent: false,
						});
					},
					members: () => members.map((oneMember) => ({ ...oneMember })),
					refId: () => {
						if (members.length === 0) {
							throw new Error('manifestEditor double refId: refusing to address an empty manifest');
						}
						return `manifestDouble:${members.length}:${members[0].schemaBlockRefId.slice(0, 8)}`;
					},
					schemaBlocks: (cb) =>
						cb(
							'',
							members.map((oneMember) => ({
								text: `restored ${oneMember.subject}`,
								refId: oneMember.schemaBlockRefId,
							})),
						),
					save: (cb) => cb('', { manifestRefId: 'manifestDouble:saved', memberCount: members.length }),
					recipeName: () => (recipe && recipe.recipeName) || '',
				};
			},
			open: ({ manifestRefId }, cb) =>
				cb(`manifestEditor double open '${manifestRefId}': not used by the build pipeline`),
		},
		overrides || {},
	);

// ⟪R-P2-1, 2026-08-03⟫ the SELF-ANNOUNCING hermetic double for the R-1 in-build fidelity gate.
// The REAL gate (build.js runCedsFidelityGate, the production default) reaches a LIVE graph over
// bolt via `docker inspect`, which no hermetic double provides — so from R-1's in-build landing
// (92aecda) until this seam existed, every ceds-recipe stage here died at materialize. The stub
// ANNOUNCES ITSELF in the captured xLog (asserted below), because a gate that quietly does not
// run is indistinguishable from one that passed — the exact masking R-1's own doctrine forbids.
const announcedFidelityGateStub = ({ xLog, graphName }, cb) => {
	xLog.status(
		`  [fidelity] HERMETIC STUB — R-1 NOT RUN for '${graphName}' (this suite has no live ` +
			`graph; the production default is the real gate, byte-unchanged)`,
	);
	cb('');
};

// the RT-13 stage arrives as the same kind of SELF-ANNOUNCING stub (never a silent skip): the
// real runner writes the stage summary into the canonical dataStores/buildLogs home on every
// build, which a hermetic suite must not touch. The real runner is proven in its own suite
// (test-round-trip-stage.js) against tmp directories.
const announcedRoundTripStageStub = ({ stageSpec, xLog }, cb) => {
	xLog.status(
		`  [roundTrip] HERMETIC STUB — stage NOT RUN (spec mode '${(stageSpec || {}).mode}'; ` +
			`the production default is the real runner, byte-unchanged)`,
	);
	cb('', { stageRan: false, disposition: 'hermeticStub' });
};


// ⟪RULING FJ-P7-1⟫ THE PRE-SPEND DECLARATION-COLLISION REFUSAL, AND WHERE IT FIRES.
// Two MAPPING bridges whose declarations agree on (hub, source, producerKind, subjectDiscriminator)
// would compose ONE relationship subject, which manifestEditor.add refuses — but only after the second
// bridge's entire judge run. build.js answers it from the DECLARATIONS, and under FJ-P7-1 it does so
// BEFORE PHASE A, so a colliding recipe costs neither a forge nor a judge.
//
// THE ASSERTION THAT MAKES THIS A GATE RATHER THAN A MESSAGE CHECK is the pair of invocation flags:
// NO forge ran and NO bridge ran. A refusal with the right words that fired after phase A would still
// pass a text match, and would have spent exactly what the check exists to save.
const preSpendCollisionRefusal = (whenDone) => {
	harness.section('⟪FJ-P7-1⟫ PRE-SPEND — a colliding pair of bridge DECLARATIONS is refused BEFORE phase A');
	let forgeInvoked = false;
	let bridgeRunInvoked = false;
	const flaggingForger = Object.assign(
		() => ({ forge: (spec, cb) => { forgeInvoked = true; cb('', { standard: spec.standard, version: spec.version, nodeEdges: { nodes: [], edges: [], embeddingDims: null }, nodeCount: 0, edgeCount: 0, embedCallCount: 0 }); } }),
		{ resolveBundle: ({ standard }) => ({ standardName: String(standard).toUpperCase() }) },
	);
	// BOTH bridges describe to the SAME tuple — the pescCedsDerived / pescOptionSetCedsDerived shape.
	const collidingBridgeMaker = () => ({
		run: (spec, cb) => { bridgeRunInvoked = true; cb('', { ...spec, edgesWritten: 0, decisionBlock: null, counts: {} }); },
		describeBridge: ({ bridgeName, source }) => ({
			description: Object.freeze({ bridgeName, source, producerKind: 'inferred', subjectDiscriminator: undefined }),
		}),
	});
	const collidingRecipe = {
		recipeName: 'twoTiersOnePair',
		description: 'two derived tiers on ONE standard pair, neither declaring a discriminator',
		standards: [{ token: 'ceds', version: 'current' }, { token: 'ctdl', version: 'current' }],
		hubs: [{ standard: 'ceds' }],
		bridges: [
			{ source: 'ctdl', hub: 'ceds', bridge: 'ctdlDerivedBridge' },
			{ source: 'ctdl', hub: 'ceds', bridge: 'ctdlOptionSetDerivedBridge' },
		],
	};
	runBuildWith(collidingRecipe, { forger: flaggingForger, bridgeMaker: collidingBridgeMaker }, ({ err }) => {
		harness.match('OBSERVED RED: the colliding pair is REFUSED, naming BOTH bridges and quoting the shared tuple', err || '', /ctdlDerivedBridge and ctdlOptionSetDerivedBridge share \(hub, source, producerKind, subjectDiscriminator\)/);
		harness.match('  and the refusal states the remedy rather than only the fault', err || '', /Declare a distinct subjectDiscriminator/);
		harness.equal('  NO FORGE EVER RAN — the refusal precedes phase A (RULING FJ-P7-1)', forgeInvoked, false);
		harness.equal('  NO BRIDGE EVER RAN — it precedes phase C too', bridgeRunInvoked, false);

		// THE OTHER HALF OF THE THREE STATES: the SAME recipe, with ONE bridge declaring a discriminator,
		// builds. Without this the conjunct above would pass equally well against a check that refuses
		// every two-bridge recipe, which is a different (and wrong) rule.
		let clearedForgeInvoked = false;
		const clearedForger = Object.assign(
			() => ({ forge: (spec, cb) => { clearedForgeInvoked = true; cb('', { standard: spec.standard, version: spec.version, nodeEdges: { nodes: [], edges: [], embeddingDims: null }, nodeCount: 0, edgeCount: 0, embedCallCount: 0 }); } }),
			{ resolveBundle: ({ standard }) => ({ standardName: String(standard).toUpperCase() }) },
		);
		const discriminatedBridgeMaker = () => ({
			run: (spec, cb) => cb('', { ...spec, edgesWritten: 0, decisionBlock: null, counts: {} }),
			describeBridge: ({ bridgeName, source }) => ({
				description: Object.freeze({ bridgeName, source, producerKind: 'inferred', subjectDiscriminator: bridgeName === 'ctdlOptionSetDerivedBridge' ? 'optionSet' : undefined }),
			}),
		});
		runBuildWith(collidingRecipe, { forger: clearedForger, bridgeMaker: discriminatedBridgeMaker }, ({ err: clearedErr }) => {
			harness.equal('  the SAME recipe builds once ONE bridge declares a discriminator', clearedErr, '');
			harness.equal('  and the forge DID run that time (the check refuses collisions, not two-bridge recipes)', clearedForgeInvoked, true);

			// ⟪REVIEW FINDING C-3, RULING FJ-P7-2 item 2⟫ THE UNREGISTERED-BRIDGE PATH, WHICH MOVED.
			// Before Phase 7 this recipe forged every base and then failed inside bridgeMaker.run in phase C.
			// The declaration read now happens before phase A, so it is refused with NO forge at all. That is
			// a deliberate behaviour change outside the byte-identity claim, and it is gated here rather than
			// left as a paragraph: the flag is what proves the refusal moved, exactly as in the collision case.
			let unregisteredForgeInvoked = false;
			const unregisteredFlaggingForger = Object.assign(
				() => ({ forge: (spec, cb) => { unregisteredForgeInvoked = true; cb('', { standard: spec.standard, version: spec.version, nodeEdges: { nodes: [], edges: [], embeddingDims: null }, nodeCount: 0, edgeCount: 0, embedCallCount: 0 }); } }),
				{ resolveBundle: ({ standard }) => ({ standardName: String(standard).toUpperCase() }) },
			);
			const refusingBridgeMaker = () => ({
				run: (spec, cb) => cb('', { ...spec, edgesWritten: 0, decisionBlock: null, counts: {} }),
				// the registry's own refusal shape, carried through describeBridge
				describeBridge: ({ bridgeName, source }) => ({ error: `pluginRegistry REFUSED: bridge '${bridgeName}' is REFUSED — no registered plugin declares it; registered names: (none registered) — a recipe names a plugin under forges/<standardKey>/bridges/ by its bridgeName (BR-003); nothing is substituted [source ${source}]` }),
			});
			runBuildWith(cedsCtdlRecipe, { forger: unregisteredFlaggingForger, bridgeMaker: refusingBridgeMaker }, ({ err: unregErr }) => {
				harness.match('OBSERVED RED: an UNREGISTERED bridge is refused NAMING the bridge and the source it was looked up under', unregErr || '', /names bridge 'ctdlAuthoredBridge', which is not registered for source 'ctdl'/);
				harness.match('  and the registry\'s OWN message is carried VERBATIM, not paraphrased (test-bgReg pins that text)', unregErr || '', /is REFUSED — no registered plugin declares it/);
				harness.equal('  NO FORGE EVER RAN for the unregistered recipe either (the behaviour change C-3 names)', unregisteredForgeInvoked, false);
				whenDone();
			});
		});
	});
};

// ⟪R-WO-16 red twin, supervisor-directed⟫ declared-but-missing refuses on a STAGE-OFF build —
// the unconditional OBSERVED, not asserted. The recipe opts nothing in (lifOnly carries no
// roundTripStage), yet a forger whose descriptor declares a validator file that does not exist
// must fail the build at roster composition, before any forge runs.
const stageDeclaredMissingUnconditional = (whenDone) => {
	harness.section(
		'R-WO-16 — declared-but-missing refuses EVEN ON A STAGE-OFF BUILD (composition is unconditional)',
	);
	const xLog = capturingXLog();
	let forgeInvoked = false;
	const lyingForger = Object.assign(
		() => ({
			forge: (spec, cb) => {
				forgeInvoked = true;
				cb('', {});
			},
		}),
		{
			resolveBundle: ({ standard }) => ({
				bundleDir: '/definitely/not/a/real/bundle',
				standardName: String(standard).toUpperCase(),
				entryPath: '/definitely/not/a/real/bundle/forge.js',
				defaultSource: null,
				snapshotDirPath: '/definitely/not/a/real/bundle/assets/standardSourceData/01',
				roundTripValidatorFileName: 'ghostValidator.js',
			}),
		},
	);
	buildLib.build(
		loadOrDie(fixture('lifOnly')),
		{
			xLog,
			standardsDatabase: standardsDatabaseDouble(),
			components: {
				forger: lyingForger,
				replayManager: workingReplayManager(),
				bridgeMaker: workingBridgeMaker(),
				manifestEditor: workingManifestEditor(),
			},
		},
		(err) => {
			harness.match(
				'OBSERVED RED: the stage-OFF build refuses at composition, naming file + RT-13.3 + R-WO-16',
				err || '',
				/ghostValidator\.js.*does not\s+EXIST.*RT-13\.3.*R-WO-16.*stage on or off/s,
			);
			harness.equal('  and NO forge ever ran (refused before any spend)', forgeInvoked, false);
			whenDone();
		},
	);
};

// EVERY build in this suite goes through here, so no path can accidentally reach the real forger
// (Voyage) or the real replayManager (Docker). Overrides merge on top of the safe default set.
// The R-1 gate arrives as the self-announcing hermetic stub (⟪R-P2-1⟫ seam).
const runBuildWith = (recipe, componentOverrides, callback) => {
	const xLog = capturingXLog();
	const standardsDatabase = standardsDatabaseDouble();
	const components = {
		forger: workingForger(),
		replayManager: workingReplayManager(),
		bridgeMaker: workingBridgeMaker(),
		manifestEditor: workingManifestEditor(),
		...(componentOverrides || {}),
	};
	buildLib.build(
		recipe,
		{
			xLog,
			standardsDatabase: standardsDatabase,
			components,
			cedsFidelityGateRunner: announcedFidelityGateStub, roundTripStageRunner: announcedRoundTripStageStub,
		},
		(err, result) => callback({ err, result, xLog, standardsDatabase }),
	);
};

const runBuild = (recipe, callback) => runBuildWith(recipe, {}, callback);

// a replayManager whose create() fails for ONE purpose and works for the others
const replayFailingCreateFor = (purpose, message) => {
	const working = workingReplayManager()();
	return () =>
		Object.assign({}, working, {
			create: (spec, cb) => (spec.purpose === purpose ? cb(message) : working.create(spec, cb)),
		});
};

// a replayManager whose harvest() fails for ONE label selection — the seam exists so the
// orchestrator's error paths can be OBSERVED firing, and a path never observed is a path unproven.
const replayFailingHarvestFor = (label, message) => {
	const working = workingReplayManager()();
	return () =>
		Object.assign({}, working, {
			harvest: (spec, cb) =>
				(spec.selectionLabels || []).join('') === label
					? cb(message)
					: working.harvest(spec, cb),
		});
};

// a replayManager whose delete() fails for graphs created under ONE purpose. Phase A and phase C
// both dispose a scratch graph, and an undifferentiated failure could not tell them apart.
const replayFailingDeleteFor = (purpose, message) => {
	const working = workingReplayManager()();
	return () =>
		Object.assign({}, working, {
			delete: (handle, cb) =>
				String(handle.graphName).includes(purpose) ? cb(message) : working.delete(handle, cb),
		});
};

// a manifestEditor whose add() fails for ONE kind of member
const manifestFailingAddFor = (kind, message) => ({ standardsDatabase } = {}) => {
	const working = workingManifestEditor()({ standardsDatabase });
	return {
		open: working.open,
		init: (spec) => {
			const handle = working.init(spec);
			return {
				...handle,
				add: (addSpec, cb) => (addSpec.kind === kind ? cb(message) : handle.add(addSpec, cb)),
			};
		},
	};
};

// a manifestEditor whose composed handle fails on a chosen verb
const manifestWithHandleOverride = (handleOverrides) => ({ standardsDatabase } = {}) => {
	const working = workingManifestEditor()({ standardsDatabase });
	return {
		open: working.open,
		init: (spec) => Object.assign({}, working.init(spec), handleOverrides),
	};
};

// =====================================================================
// The suite is a small sequence of async builds; each stage asserts, then triggers the next.
// =====================================================================

const stagePreflight = () => {
	harness.section("PRE-FLIGHT — the orchestrator's own inputs, refused before any component runs");

	// The standardsDatabase gate is also the safety interlock: every component below is the real thing in
	// production, and a build that has not said where its schema blocks go must never reach them.
	const xLog = capturingXLog();
	buildLib.build(
		loadOrDie(fixture('lifOnly')),
		{ xLog, components: { forger: workingForger(), replayManager: workingReplayManager() } },
		(err, result) => {
			harness.match(
				'a build with no standardsDatabase is REFUSED, saying so',
				err,
				/standardsDatabase is REQUIRED in deps and has no default/,
			);
			harness.ok('  and hands back no result', result === undefined, JSON.stringify(result));
			harness.ok(
				'  before any component is driven (no progress was logged)',
				xLog.lines.length === 0,
				xLog.text(),
			);

			runBuild(
				{ recipeName: '   ', description: 'has a description', standards: [], hubs: [], bridges: [] },
				({ err: nameErr }) => {
					harness.match(
						'a recipe with a blank recipeName is REFUSED, naming the field',
						nameErr,
						/recipeName/,
					);

					runBuild(
						{ recipeName: 'unDescribed', standards: [], hubs: [], bridges: [] },
						({ err: descErr }) => {
							harness.match(
								'a recipe with no description is REFUSED — the manifest requires one',
								descErr,
								/recipe 'unDescribed' has no description/,
							);
							harness.match(
								'  and says how to fix it',
								descErr,
								/Add a "description" to the recipe/,
							);
							stageLifOnly();
						},
					);
				},
			);
		},
	);
};

const stageLifOnly = () => {
	runBuild(loadOrDie(fixture('lifOnly')), ({ err, result, xLog }) => {
		harness.section('lifOnly — one standard, no hubs, no bridges');

		harness.equal('build succeeds (no error)', err, '');
		harness.equal('memberCount is 1 (one standardBase)', result.memberCount, 1);
		harness.ok('a manifestId is returned', !!result.manifestId, JSON.stringify(result));
		harness.ok('a boltUrl is returned', !!result.boltUrl, JSON.stringify(result));
		harness.match(
			'the boltUrl is the eval golden HANDLE\'s url, not a string create invented',
			result.boltUrl,
			/^bolt:\/\/localhost:78\d\d$/,
		);

		harness.match(
			'phase A forges the standard under its versioned key',
			xLog.text(),
			/\[A\] forge lif@current_base -> standardBase /,
		);
		harness.ok(
			'no hub phase runs when no hub is declared',
			!/\[B\]/.test(xLog.text()),
			xLog.text(),
		);
		harness.ok(
			'no bridge phase runs when no bridge is declared',
			!/\[C\]/.test(xLog.text()),
			xLog.text(),
		);
		harness.match('the manifest is composed', xLog.text(), /\[compose\] manifest /);
		harness.match('the graph is materialized', xLog.text(), /\[materialize\] -> bolt:\/\//);

		stageCedsLif();
	});
};

const stageCedsLif = () => {
	runBuild(loadOrDie(fixture('cedsLif')), ({ err, result, xLog }) => {
		harness.section('cedsLif — two standards, one hub, one bridge');

		harness.equal('build succeeds (no error)', err, '');
		harness.match(
			'the R-1 gate ran as the SELF-ANNOUNCING hermetic stub — visible in the output, never a silent skip (R-P2-1)',
			xLog.text(),
			/\[fidelity\] HERMETIC STUB — R-1 NOT RUN/,
		);
		harness.equal(
			'memberCount is 3 (2 standardBase + 1 relationship) — the ceds hub FOLDS into its base block, not a 4th member',
			result.memberCount,
			3,
		);

		harness.match('ceds is forged', xLog.text(), /\[A\] forge ceds@current_base -> standardBase /);
		harness.match('lif is forged', xLog.text(), /\[A\] forge lif@current_base -> standardBase /);
		harness.ok(
			'the declared hub yields NO separate hub block — it is folded into the ceds base block',
			!/\[B\]/.test(xLog.text()),
			xLog.text(),
		);
		harness.match(
			'the bridge is keyed by its source::hub pairing',
			xLog.text(),
			/\[C\] bridge lif::ceds /,
		);
		harness.match(
			'the bridge names the bridge it ran',
			xLog.text(),
			/\[C\] bridge lif::ceds \(bridge=/,
		);
		// THE POSITIVE CONTROL. `bridge.bridge || 'defaultSemantic'` also satisfied the assertion
		// above, which is exactly why it survived: "names A bridge" and "names THE RECIPE'S
		// bridge" are different claims. cedsLif names its bridge now, and this insists the
		// build ran that one.
		harness.match(
			'the bridge it ran is the one THE RECIPE named, not one the code chose',
			xLog.text(),
			/\[C\] bridge lif::ceds \(bridge=semanticBridge\)/,
		);
		harness.ok(
			'no in-code bridge name survives in build.js to stand behind the recipe key',
			!/defaultSemantic/.test(sourceOf(path.join(__dirname, '..', 'lib', 'build.js'))),
			(sourceOf(path.join(__dirname, '..', 'lib', 'build.js')).match(/.*defaultSemantic.*/g) || []).join(
				'\n',
			),
		);
		harness.match(
			'the bridge yields a relationship block',
			xLog.text(),
			/\[C\] bridge lif::ceds .*-> relationship /,
		);

		const order = xLog.lines.map((l) => (l.match(/\[(A|B|C|compose|materialize)\]/) || [])[1]);
		const sequence = order.filter(Boolean).join(',');
		harness.equal(
			'phases run in order: A, A, C, compose, materialize (no B — the hub folds into A)',
			sequence,
			'A,A,C,compose,materialize',
		);

		harness.ok(
			'a schema block address harvested in a phase is what reaches the manifest (addresses are threaded, not invented)',
			/-> standardBase (\S+)/.test(xLog.text()) && /-> relationship (\S+)/.test(xLog.text()),
			xLog.text(),
		);

		stageRelationshipBlockNaming();
	});
};

// =====================================================================
// RELATIONSHIP BLOCK NAMING (P2 Phase C) — the version-keyed, producer-suffixed subject
// =====================================================================
// A bridge's relationship block is named '<hub>@<hubVer>_rel_<source>@<sourceVer>_exact|_close' — pair-
// scoped, version-keyed on BOTH endpoints with the REAL resolved versions (the a4a0da2 rule), and
// producer-suffixed (authored -> _exact from decisionBlock null; inferred -> _close from a frozen
// decision block). Proven both ways through bridgeMaker doubles, plus the dependency-restore refusal.
const cedsCtdlRecipe = {
	recipeName: 'cedsCtdl',
	description: 'CTDL bridged into the CEDS hub — the authored EXACT_MATCH pairing',
	standards: [{ token: 'ceds', version: 'current' }, { token: 'ctdl', version: 'current' }],
	hubs: [{ standard: 'ceds' }],
	bridges: [{ source: 'ctdl', hub: 'ceds', bridge: 'ctdlAuthoredBridge' }],
};

const stageRelationshipBlockNaming = () => {
	harness.section('RELATIONSHIP BLOCK NAMING — version-keyed, producer-suffixed (authored _exact / inferred _close)');

	// authored: the bridgeMaker double returns decisionBlock null -> _exact.
	const authoredBridgeMaker = withDescribeBridge(() => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 26, decisionBlock: null, counts: { authored: 26 } }) }));
	runBuildWith(cedsCtdlRecipe, { bridgeMaker: authoredBridgeMaker }, ({ err, result, xLog }) => {
		harness.equal('the authored CTDL pairing builds', err, '');
		harness.equal('  3 members (ceds base w/ folded hub + ctdl base + 1 relationship)', result.memberCount, 3);
		harness.match(
			'  the relationship block is named ceds@current_rel_ctdl@current_exact (version-keyed, _exact)',
			xLog.text(),
			/-> relationship ceds@current_rel_ctdl@current_exact /,
		);
		harness.match('  the bridge threads hub=ceds and ran the authored bridge', xLog.text(), /\[C\] bridge ctdl::ceds \(bridge=ctdlAuthoredBridge\)/);

		// inferred: a frozen decisionBlock -> _close (the SAME pair, a DIFFERENT producer block).
		const inferredBridgeMaker = withDescribeBridge(() => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 5, decisionBlock: { hash: 'frozen' }, counts: { inferred: 5 } }) }));
		runBuildWith(cedsCtdlRecipe, { bridgeMaker: inferredBridgeMaker }, ({ err: inferErr, xLog: inferLog }) => {
			harness.equal('the inferred producer variant also builds', inferErr, '');
			harness.match(
				'  a frozen decisionBlock names the block ..._close (producer-derived, not pair-derived)',
				inferLog.text(),
				/-> relationship ceds@current_rel_ctdl@current_close /,
			);

			// dependency-restore refusal: a bridge whose hub is not forged has no HubReferences to author against.
			const hublessRecipe = {
				recipeName: 'ctdlNoHub',
				description: 'a CTDL bridge whose hub standard is not forged',
				standards: [{ token: 'ctdl', version: 'current' }],
				hubs: [],
				bridges: [{ source: 'ctdl', hub: 'ceds', bridge: 'ctdlAuthoredBridge' }],
			};
			runBuildWith(hublessRecipe, {}, ({ err: restoreErr, result: restoreResult }) => {
				harness.match(
					'a bridge whose hub base is not forged is REFUSED at restore, naming the missing dependency',
					restoreErr,
					/restore deps ctdl::ceds: dependency base block\(s\) not forged in this build: ceds/,
				);
				harness.ok('  and hands back no result', restoreResult === undefined, JSON.stringify(restoreResult));

				// STRUCTURAL PAIRING — a HUB-LESS bridge names its sibling endpoint in `pairWith`. build.js
				// threads pairWith as the SECOND endpoint through pairKey, dependency restore, config, and the
				// version-keyed subject, and honours a producer:'structural' -> _struct suffix. The block is
				// keyed on BOTH endpoints (source + pairWith) so it never collides with a mapping pair's block.
				const ctdlFamilyRecipe = {
					recipeName: 'ctdlFamily',
					description: 'CTDL family intra-family structural pairing ctdl::ctdlasn',
					standards: [{ token: 'ctdl', version: 'current' }, { token: 'ctdlasn', version: 'current' }],
					hubs: [],
					bridges: [{ source: 'ctdl', pairWith: 'ctdlasn', bridge: 'ctdlFamilyStructure', dependencies: ['ctdl', 'ctdlasn'] }],
				};
				const structuralBridgeMaker = withDescribeBridge(() => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 4, decisionBlock: null, producer: 'structural', counts: { structural: 4 } }) }));
				runBuildWith(ctdlFamilyRecipe, { bridgeMaker: structuralBridgeMaker }, ({ err: structErr, result: structResult, xLog: structLog }) => {
					harness.equal('a STRUCTURAL pairing (hub-less, pairWith names the sibling) builds', structErr, '');
					harness.equal('  3 members (ctdl base + ctdlasn base + 1 structural relationship)', structResult.memberCount, 3);
					harness.match('  the pairing label is source::pairWith', structLog.text(), /\[C\] bridge ctdl::ctdlasn \(bridge=ctdlFamilyStructure\)/);
					harness.match(
						'  the block is version-keyed on BOTH endpoints, _struct-suffixed, ROOT-FIRST (source before pairWith)',
						structLog.text(),
						/-> relationship ctdl@current_rel_ctdlasn@current_struct /,
					);
					stageMultiBlockFamily();
				});
			});
		});
	});
};

// =====================================================================
// MULTI-BLOCK FAMILY (contract change 2026-07-26) — ONE bridge invocation may emit SEVERAL pair-scoped
// blocks. build.js Phase C must harvest EACH into its OWN version-keyed, _struct-suffixed manifest member.
// A bridgeMaker double returns blocks[] with three pair-scoped entries (distinct labels + endpoint TOKENS);
// build.js version-keys each on its OWN two endpoints and adds three relationship members, not one.
// =====================================================================
const stageMultiBlockFamily = () => {
	harness.section('MULTI-BLOCK FAMILY — one invocation, three pair-scoped version-keyed blocks harvested');

	const familyRecipe = {
		recipeName: 'ctdlFamily',
		description: 'CTDL family — one coordinating structural bridge emitting three pair-scoped blocks',
		standards: [
			{ token: 'ctdl', version: 'current' },
			{ token: 'ctdlasn', version: 'current' },
			{ token: 'ctdlqdata', version: 'current' },
		],
		hubs: [],
		bridges: [
			{
				source: 'ctdl',
				bridge: 'ctdlFamilyStructure',
				familyStandards: ['ctdl', 'ctdlasn', 'ctdlqdata'],
				dependencies: ['ctdl', 'ctdlasn', 'ctdlqdata'],
			},
		],
	};
	// the coordinating producer's status, as a double: THREE pair-scoped blocks, each with its OWN distinct
	// applyLabel (what its edges were written under) and its pair's endpoint TOKENS root-first.
	const familyBridgeMaker = withDescribeBridge(() => ({
		run: (spec, cb) =>
			cb('', {
				...spec,
				edgesWritten: 4,
				decisionBlock: null,
				producer: 'structural',
				counts: { structural: 4 },
				blocks: [
					{ applyLabel: 'BridgedRelation_CTDL_CTDLASN', firstStandard: 'ctdl', secondStandard: 'ctdlasn', producer: 'structural', decisionBlock: null, emptyPairing: false, edgesWritten: 2, counts: {} },
					{ applyLabel: 'BridgedRelation_CTDL_CTDLQDATA', firstStandard: 'ctdl', secondStandard: 'ctdlqdata', producer: 'structural', decisionBlock: null, emptyPairing: false, edgesWritten: 1, counts: {} },
					{ applyLabel: 'BridgedRelation_CTDLASN_CTDLQDATA', firstStandard: 'ctdlasn', secondStandard: 'ctdlqdata', producer: 'structural', decisionBlock: null, emptyPairing: false, edgesWritten: 1, counts: {} },
				],
			}),
	}));
	runBuildWith(familyRecipe, { bridgeMaker: familyBridgeMaker }, ({ err: famErr, result: famResult, xLog: famLog }) => {
		harness.equal('the ONE-entry family builds', famErr, '');
		harness.equal('  6 members (3 base + 3 pair-scoped structural relationships)', famResult && famResult.memberCount, 6);
		harness.match('  ctdl::ctdlasn block is version-keyed + _struct-suffixed, root-first', famLog.text(), /-> relationship ctdl@current_rel_ctdlasn@current_struct /);
		harness.match('  ctdl::ctdlqdata block is version-keyed + _struct-suffixed, root-first', famLog.text(), /-> relationship ctdl@current_rel_ctdlqdata@current_struct /);
		harness.match('  ctdlasn::ctdlqdata block (the cross-pair) is version-keyed + _struct-suffixed', famLog.text(), /-> relationship ctdlasn@current_rel_ctdlqdata@current_struct /);
		stageRebridgeWiring();
	});
};

// =====================================================================
// REBRIDGE WIRING (P3a §5.5) — build.js reads --rebridge with §6 discipline and threads the inferred
// inputs (rebridge boolean, decisionStore, config) into bridgeMaker.run for the SCOPED pair.
// =====================================================================
const buildStatics = require('../lib/build');

const stageRebridgeWiring = () => {
	// ⟪Phase 4 K3b⟫ the build-log ROOT resolver: deps wins, then --buildLogsDirPath, then the DOCUMENTED
	// default (the canonical dataStores/buildLogs home); an empty value is refused by name. This is
	// what lets the suite keep every real build OUT of the canonical home. (Observed red by inverting
	// the default expectation — DEVLOG Phase 4 K3b.)
	harness.section('BUILD-LOG ROOT — deps > --buildLogsDirPath > documented default; empty refused by name');
	harness.equal('resolveBuildLogsDirPath: nothing supplied -> the documented canonical home', buildStatics.resolveBuildLogsDirPath({}).value, buildStatics.BUILD_LOGS_DIR_PATH);
	harness.match('  and that home is dataStores/buildLogs (the help text names it)', buildStatics.BUILD_LOGS_DIR_PATH, /\/system\/dataStores\/buildLogs$/);
	harness.equal('resolveBuildLogsDirPath: deps.buildLogsDirPath wins', buildStatics.resolveBuildLogsDirPath({ buildLogsDirPath: '/scratch/root' }).value, '/scratch/root');
	harness.match('resolveBuildLogsDirPath: an EMPTY deps value is REFUSED by name (not corrected to the default)', buildStatics.resolveBuildLogsDirPath({ buildLogsDirPath: '' }).error, /buildLogsDirPath is ""[\s\S]*not corrected silently/);
	harness.match('resolveBuildLogsDirPath: a non-string deps value is REFUSED by name', buildStatics.resolveBuildLogsDirPath({ buildLogsDirPath: 7 }).error, /buildLogsDirPath is 7/);
	// THE CLI BRANCH (Phase 4 review V2): --buildLogsDirPath is read off process.global.commandLineParameters,
	// which the resolver reads live (the resolveEmbeddingCacheFilePath idiom). process.global is frozen but its
	// commandLineParameters.values object is not, so the probe stages the flag there, asserts, and RESTORES —
	// no build, no spend. Order of precedence under test: deps > CLI > documented default.
	(() => {
		const cliValues = process.global.commandLineParameters.values;
		const hadFlag = Object.prototype.hasOwnProperty.call(cliValues, 'buildLogsDirPath');
		const priorFlag = cliValues.buildLogsDirPath;
		cliValues.buildLogsDirPath = ['/cli/root'];
		harness.equal('resolveBuildLogsDirPath: --buildLogsDirPath WINS over the documented default', buildStatics.resolveBuildLogsDirPath({}).value, '/cli/root');
		harness.equal('resolveBuildLogsDirPath: deps.buildLogsDirPath WINS over --buildLogsDirPath', buildStatics.resolveBuildLogsDirPath({ buildLogsDirPath: '/deps/root' }).value, '/deps/root');
		cliValues.buildLogsDirPath = [''];
		harness.match('resolveBuildLogsDirPath: an EMPTY --buildLogsDirPath is REFUSED by name (not corrected)', buildStatics.resolveBuildLogsDirPath({}).error, /buildLogsDirPath is ""/);
		if (hadFlag) {
			cliValues.buildLogsDirPath = priorFlag;
		} else {
			delete cliValues.buildLogsDirPath;
		}
		harness.equal('  and after restoring the CLI, the documented default is back', buildStatics.resolveBuildLogsDirPath({}).value, buildStatics.BUILD_LOGS_DIR_PATH);
	})();

	harness.section('REBRIDGE WIRING — --rebridge scope resolution + per-pair threading (§6 no-silent-default)');

	// the PURE helpers (resolveRebridge / pairInRebridgeScope) — no build pipeline needed.
	harness.equal('resolveRebridge: deps.rebridge=[] -> none (default plain build MATERIALIZES)', JSON.stringify(buildStatics.resolveRebridge({ rebridge: [] }).value), '[]');
	harness.equal("resolveRebridge: deps.rebridge='all' -> all", buildStatics.resolveRebridge({ rebridge: 'all' }).value, 'all');
	harness.equal("resolveRebridge: deps.rebridge=['ctdl'] -> ['ctdl']", JSON.stringify(buildStatics.resolveRebridge({ rebridge: ['ctdl'] }).value), '["ctdl"]');
	harness.match('resolveRebridge: a WRONG-typed deps.rebridge is REFUSED by name (not corrected)', buildStatics.resolveRebridge({ rebridge: 5 }).error, /deps\.rebridge must be an array of source tokens or the string 'all'[\s\S]*NOT corrected/);
	harness.ok("pairInRebridgeScope: 'all' rebridges every pair", buildStatics.pairInRebridgeScope('all', { source: 'ctdl' }) === true);
	harness.ok("pairInRebridgeScope: ['ctdl'] rebridges the ctdl pair", buildStatics.pairInRebridgeScope(['ctdl'], { source: 'ctdl' }) === true);
	harness.ok("pairInRebridgeScope: ['lif'] does NOT rebridge the ctdl pair", buildStatics.pairInRebridgeScope(['lif'], { source: 'ctdl' }) === false);
	harness.ok('pairInRebridgeScope: [] (default) rebridges NOTHING', buildStatics.pairInRebridgeScope([], { source: 'ctdl' }) === false);

	// THE PRODUCER DECLARES ITS KIND: an inferred producer that wrote NO edges (no frozen block yet) still
	// returns producer:'inferred', so build.js names the empty block _close — NOT _exact, which would collide
	// with the authored pair's _exact for the SAME pair (the two-producers-per-pair design). Proven via a
	// double so no docker/graph is needed.
	const emptyInferredBridgeMaker = withDescribeBridge(() => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 0, decisionBlock: null, producer: 'inferred', counts: { inferred: 0 } }) }));
	runBuildWith(cedsCtdlRecipe, { bridgeMaker: emptyInferredBridgeMaker }, ({ err: emptyErr, xLog: emptyLog }) => {
		harness.equal('an empty inferred block (no frozen decisions yet) still builds', emptyErr, '');
		harness.match('  build.js names it _close from producer=inferred (NOT _exact from the null decisionBlock)', emptyLog.text(), /-> relationship ceds@current_rel_ctdl@current_close /);

		continueRebridgeWiring();
	});
	};

	const continueRebridgeWiring = () => {
	const capturedSpecs = [];
	const captureBridgeMaker = withDescribeBridge(() => ({ run: (spec, cb) => { capturedSpecs.push(spec); cb('', { ...spec, edgesWritten: 0, decisionBlock: null, counts: {} }); } }));
	const fakeDecisionStore = { getDecisionBlock: (a, cb) => cb('', { frozenText: null }), saveDecisionBlock: (a, cb) => cb('') };
	// a deterministic STUB reranker — the hermetic suite's llmClient. Injected on inferenceConfig, it is the
	// real-vs-stub seam's STUB arm: with it present, resolveInferenceConfig NEVER mints the real Anthropic
	// client, so a --rebridge-scoped build stays hermetic (no key needed, no network — §3 hard line 2).
	const stubReranker = { model: 'stub-reranker', rerank: (a, cb) => cb('', { choice: 'NONE' }) };
	const runRebridge = (extraDeps, cb) => {
		const xLog = capturingXLog();
		const standardsDatabase = standardsDatabaseDouble();
		const components = { forger: workingForger(), replayManager: workingReplayManager(), bridgeMaker: captureBridgeMaker, manifestEditor: workingManifestEditor() };
		buildLib.build(cedsCtdlRecipe, { xLog, standardsDatabase, components, cedsFidelityGateRunner: announcedFidelityGateStub, roundTripStageRunner: announcedRoundTripStageStub, ...extraDeps }, (err, result) => cb({ err, result }));
	};

	// scoped --rebridge WITH a stub llmClient injected: the build runs the (doubled) pre-pass path hermetically.
	runRebridge({ rebridge: ['ctdl'], decisionStore: fakeDecisionStore, inferenceConfig: { llmClient: stubReranker } }, ({ err }) => {
		harness.equal('scoped --rebridge=ctdl build succeeds', err, '');
		const spec = capturedSpecs[capturedSpecs.length - 1];
		harness.ok('  build.js passed rebridge=TRUE for the scoped ctdl pair', spec && spec.rebridge === true);
		harness.equal('  and threaded config.sourceStandard=ctdl (the a4a0da2 real versions)', spec && spec.config && spec.config.sourceStandard, 'ctdl');
		harness.equal('  and config.hubVersion=current (resolved, not the recipe token)', spec && spec.config && spec.config.hubVersion, 'current');
		harness.ok('  and threaded the injected decisionStore through', spec && spec.decisionStore === fakeDecisionStore);
		// FACTORY SELECTION — STUB arm: the injected stub is what reaches bridgeMaker.run, never the real client.
		harness.ok('  the INJECTED STUB llmClient is threaded to bridgeMaker.run (never the real client under test)', spec && spec.inferenceConfig && spec.inferenceConfig.llmClient === stubReranker);

		runRebridge({ decisionStore: fakeDecisionStore }, ({ err: plainErr }) => {
			harness.equal('a plain build (no --rebridge) succeeds', plainErr, '');
			const plainSpec = capturedSpecs[capturedSpecs.length - 1];
			harness.ok('  build.js passed rebridge=FALSE (plain build MATERIALIZES, never a silent spend)', plainSpec && plainSpec.rebridge === false);
			// FACTORY SELECTION — a plain build's INACTIVE scope mints NO client (no key touched, no construction).
			harness.ok('  a plain build carries NO llmClient (nothing minted when not rebridging)', plainSpec && plainSpec.inferenceConfig && plainSpec.inferenceConfig.llmClient === undefined);

			runRebridge({ rebridge: 7 }, ({ err: badErr }) => {
				harness.match('a WRONG-typed deps.rebridge refuses the whole build by name', badErr, /deps\.rebridge must be an array of source tokens or the string 'all'/);
				stageFactorySelection();
			});
		});
	});
	};

	// =====================================================================
	// FACTORY SELECTION (P3b) — resolveInferenceConfig picks the real vs stub reranker with §6 discipline. The
	// core P3b-wire proof: a real --rebridge run mints the REAL client via the (injected/default) factory; the
	// suite's injected STUB is used as-is and the real factory is never consulted; a keyless mint is REFUSED by
	// name; a plain build mints nothing. All hermetic — a FAKE factory stands in for the real one, so no key
	// and no network are ever touched here.
	// =====================================================================
	const stageFactorySelection = () => {
		harness.section('FACTORY SELECTION — resolveInferenceConfig real-vs-stub judge provider (§6 no-silent-default)');
		// ⟪JOB 4, 2026-09-07⟫ THESE ELEVEN ASSERTIONS MOVED TO THE CALLBACK SHAPE, SAME SUBJECTS. Provider
		// construction became error-first because the Ollama row's identity carries a model digest that can
		// only be read over HTTP, so every row constructs through a callback (docket vi). Two things changed
		// besides the shape: `deps.llmClientFactory` is gone — a per-provider factory override was a second
		// construction path, which is what this job removes — so the double is now a registry ROW injected
		// through the registry's own componentOverrides; and the client the run receives is FROZEN, which is
		// asserted here as well because it is new and load-bearing (docket vii).
		const sentinelProvider = {
			name: 'anthropic',
			wireModel: 'sentinel',
			model: 'anthropic:sentinel',
			maxConcurrency: 4,
			rerank: () => {},
			describe: () => ({ provider: 'anthropic', model: 'anthropic:sentinel', version: 'sentinel-v1' }),
		};
		let factoryCalls = 0;
		let lastFactoryArg = null;
		const countingAnthropicRow = {
			name: 'anthropic',
			enabled: true,
			construct: (rowConstructionOptions, rowCallback) => {
				factoryCalls++;
				lastFactoryArg = rowConstructionOptions;
				rowCallback('', { ...sentinelProvider });
			},
		};
		const withRow = (deps, rowList) => ({ ...deps, judgeProviderComponentOverrides: { judgeProviderRowList: rowList || [countingAnthropicRow] } });
		const injectedStub = { model: 'injected-stub', rerank: () => {} };

		// 1. STUB injected -> used AS-IS; the row is NOT constructed (the suite path).
		buildStatics.resolveInferenceConfig(withRow({ inferenceConfig: { llmClient: injectedStub } }), ['ctdl'], null, (stubError, stubValue) => {
			harness.ok('an INJECTED llmClient is used as-is (the stub arm)', stubValue && stubValue.llmClient === injectedStub);
			harness.equal('  and the provider row is NEVER constructed when a client is injected (suite never mints the real one)', factoryCalls, 0);

			// 2. active scope, NO injected client -> the REAL run constructs through the registry (the real arm).
			buildStatics.resolveInferenceConfig(withRow({ inferenceConfig: { topK: 15 }, judgeProviderName: 'anthropic' }), 'all', null, (realError, realValue) => {
				harness.ok('an active --rebridge with no injected client CONSTRUCTS through the registry (the real arm)', realValue && realValue.llmClient.model === 'anthropic:sentinel');
				harness.equal('  the row was constructed exactly once', factoryCalls, 1);
				harness.equal('  and pointed at the canonical [anthropicAi] config path', lastFactoryArg && /anthropicAi\.ini$/.test(lastFactoryArg.configFilePath), true);
				harness.equal('  operator inferenceConfig fields (topK) survive alongside the constructed client', realValue && realValue.topK, 15);
				harness.ok('  and the client handed on is FROZEN — one identity in the cache key and on the edge', Object.isFrozen(realValue.llmClient));

				// 3. INACTIVE scope (plain build) -> constructs nothing.
				buildStatics.resolveInferenceConfig(withRow({ judgeProviderName: 'anthropic' }), [], null, (plainError, plainValue) => {
					harness.ok('an inactive scope constructs NO client (plain build materializes)', plainValue && plainValue.llmClient === undefined);
					harness.equal('  and does NOT construct the row', factoryCalls, 1);

					// 4. a row that THROWS (a keyless real client refusing at construction) -> refused BY NAME,
					//    routed through the callback, never a throw past it or a silent no-op.
					const throwingRow = {
						name: 'anthropic',
						enabled: true,
						construct: () => {
							throw new Error('llmClient: no Anthropic API key resolved');
						},
					};
					buildStatics.resolveInferenceConfig(withRow({ judgeProviderName: 'anthropic' }, [throwingRow]), ['ctdl'], null, (refusedError, refusedValue) => {
						harness.match('a keyless construction on an active --rebridge is REFUSED by name (no silent no-op)', refusedError, /judge provider could not be constructed[\s\S]*no Anthropic API key/);
						harness.ok('  and yields no value (the build is refused, not run with a broken client)', refusedValue === undefined || refusedValue === null);

						// rebridgeScopeIsActive — the active/inactive predicate, gated directly.
						harness.ok("rebridgeScopeIsActive: 'all' is active", buildStatics.rebridgeScopeIsActive('all') === true);
						harness.ok("rebridgeScopeIsActive: ['ctdl'] is active", buildStatics.rebridgeScopeIsActive(['ctdl']) === true);
						harness.ok('rebridgeScopeIsActive: [] (default) is NOT active', buildStatics.rebridgeScopeIsActive([]) === false);

						stageEdgeCases();
					});
				});
			});
		});
	};

const stageEdgeCases = () => {
	harness.section('EDGE CASES — degenerate and hostile recipe shapes');

	// build() is reachable with a recipe object that never went through validateRecipe — this
	// suite does it on every line below — so the schema's `required: bridge` is not the only
	// place the absence can arrive. A bridge with no name used to run 'defaultSemantic' here.
	// BOTH endpoints are forged: a bridge RESTORES its source and hub base blocks into the dependency
	// graph before it runs (P2 Phase C), so the hub standard must be forged too — a bridge whose hub is
	// not in the build has no HubReferences to author against.
	const bridgeRecipe = (bridgeEntry) => ({
		recipeName: 'bridgeNameProbe',
		description: 'one bridge, whatever bridge name it was given',
		standards: [{ token: 'lif', version: 'current' }, { token: 'ceds', version: 'current' }],
		hubs: [{ standard: 'ceds' }],
		bridges: [{ source: 'lif', hub: 'ceds', dependencies: ['lif'], ...bridgeEntry }],
	});

	runBuild(bridgeRecipe({}), ({ err }) => {
		harness.match(
			'a bridge with NO name is refused by name — nothing is substituted',
			err,
			/bridge lif::ceds: bridge is not named[\s\S]*no default/,
		);

		runBuild(bridgeRecipe({ bridge: '   ' }), ({ err: blankErr }) => {
			harness.match(
				'a BLANK bridge name is refused too, quoting what was given',
				blankErr,
				/bridge lif::ceds: bridge is "   "/,
			);

			runBuild(bridgeRecipe({ bridge: 'bespokeBridge' }), ({ err: goodErr, xLog: goodLog }) => {
				harness.equal('a NAMED bridge builds — the positive control', goodErr, '');
				harness.match(
					'and the build ran exactly the bridge it was handed',
					goodLog.text(),
					/\[C\] bridge lif::ceds \(bridge=bespokeBridge\)/,
				);
				stageEdgeCasesRest();
			});
		});
	});
};

const stageEdgeCasesRest = () => {

	// A recipe that produces nothing can no longer report success: a manifest with no members has
	// no address (its address would be the constant every empty manifest shares) and there is
	// nothing to materialize. Under the stub contract this "built" cleanly and returned zero
	// members, which is the silent failure the real contract refuses.
	runBuild(
		{ recipeName: 'empty', description: 'a recipe with nothing in it', standards: [], hubs: [], bridges: [] },
		({ err, result }) => {
			harness.match(
				'a recipe that produces no schema blocks is REFUSED, not reported as a build',
				err,
				/compose failed: recipe 'empty' produced no schema blocks/,
			);
			harness.ok('  and hands back no result', result === undefined, JSON.stringify(result));

			// wrong-typed collections must not crash the orchestrator (it guards with Array.isArray)
			runBuild(
				{ recipeName: 'junk', description: 'hostile shapes', standards: 'nope', hubs: null, bridges: { x: 1 } },
				({ err: junkErr }) => {
					harness.match(
						'wrong-typed collections do not crash the pipeline — they reach the same refusal',
						junkErr,
						/compose failed: recipe 'junk' produced no schema blocks/,
					);

					// a hub declared for a standard that is not forged: the hub block simply never appears
					runBuild(
						{
							recipeName: 'hubWithoutItsStandard',
							description: 'a hub declared for a standard that is not forged',
							standards: [{ token: 'lif', version: 'current' }],
							hubs: [{ standard: 'ceds', candidateFinder: 'x' }],
							bridges: [],
						},
						({ err: hubErr, result: hubResult, xLog }) => {
							harness.equal('builds without error', hubErr, '');
							harness.equal(
								'no hub block is produced for an unforged hub standard',
								hubResult.memberCount,
								1,
							);
							harness.ok('no [B] line appears', !/\[B\]/.test(xLog.text()), xLog.text());

							// NOTE (hub-fold design): the registry that refuses a declared-but-unregistered
							// hub forge now lives in the FORGER (foldHubIntoNodeEdges), not in build.js — a
							// working forger double here never consults it. That refusal is proven where it
							// now lives, in test-forger.js. build.js's job is only to SET deriveHub from
							// recipe.hubs; the fault path it still owns (a forge that fails) is exercised in
							// FAULT INJECTION below.
							stageRealManifestEditor();
						},
					);
				},
			);
		},
	);
};

// =====================================================================
// THE REAL MANIFEST EDITOR — the contract validated by the module itself, not by a double.
// =====================================================================
// A double proves build.js calls what this suite believes the contract to be. Only the real
// module proves it calls what the contract IS: named arguments, a member description, a schema
// block whose text hashes to the address it claims, and a subject that is not already present.
// The standardsDatabase is an in-memory double, so no database is opened.

const stageRealManifestEditor = () => {
	harness.section('REAL manifestEditor — build.js validated by the module, not by a double');

	const xLog = capturingXLog();
	const standardsDatabase = standardsDatabaseDouble();
	buildLib.build(
		loadOrDie(fixture('lifOnly')),
		{
			xLog,
			standardsDatabase: standardsDatabase,
			cedsFidelityGateRunner: announcedFidelityGateStub, roundTripStageRunner: announcedRoundTripStageStub,
			components: {
				forger: workingForger(),
				replayManager: workingReplayManager(),
				bridgeMaker: workingBridgeMaker(),
				manifestEditor: realManifestEditor,
			},
		},
		(err, result) => {
			harness.equal('the real manifestEditor accepts what build.js passes to add()', err, '');
			harness.equal('  composing a one-member manifest', (result || {}).memberCount, 1);
			harness.match(
				'  addressed by manifestKeyForMembership, not by an invented id',
				(result || {}).manifestId,
				/^[0-9a-f]{16,}$/,
			);

			const storedRefIds = Object.keys(standardsDatabase.savedBlocks);
			harness.equal('add() wrote the schema block THROUGH to the standardsDatabase', storedRefIds.length, 1);
			harness.equal(
				'  under the kind the orchestrator declared',
				standardsDatabase.savedBlocks[storedRefIds[0]].kind,
				'standardBase',
			);
			harness.equal(
				'  keyed by the subject, resolved standardName@version with its _base role marker',
				standardsDatabase.savedBlocks[storedRefIds[0]].subject,
				'lif@current_base',
			);
			harness.equal(
				'  and the stored address IS sha256 of the block text (harvest minted it, add re-derived it)',
				storedRefIds[0],
				contentAddress.blockIdForText(standardsDatabase.savedBlocks[storedRefIds[0]].text),
			);

			harness.note(
				'HUB FOLDS INTO BASE (design 2026-07-24) — a hub standard yields ONE [StandardBase]\n' +
					'block that already carries its hub; there is NO separate hub member. The next stage\n' +
					'proves that one block, composed against the REAL editor, holds base + derived hub.',
			);

			stageHubFoldedIntoBase();
		},
	);
};

// =====================================================================
// HUB FOLDED INTO BASE — one [StandardBase] block carries base + hub, composed against the REAL editor
// =====================================================================
// The whole hub-fold design (TQ 2026-07-24), end to end, against the REAL manifestEditor (so the ONE-
// member composition is validated by the module, not a double). The FORGER folds the hub in: this
// stage's forger double returns a RICH synthetic CEDS base as nodeEdges and, when deriveHub is set,
// runs it through the REAL foldHubIntoNodeEdges so the returned nodeEdges genuinely carry base + hub.
// The replayManager double mirrors the real engine: init UNIONS applyLabels onto every loaded node
// (so hub nodes gain StandardBase beside their intrinsic HubReference/HubDefinition), and the ONE
// [StandardBase] harvest serializes them all back out as a single block. No docker, no voyage, no
// database — foldHubIntoNodeEdges, shapeForgedGraph and the block codec are all pure.
//
// STATE 2 for this stage: while foldHubIntoNodeEdges is the base-only pass-through, the forger returns
// base-only nodeEdges, the harvested [StandardBase] block carries NO hub, and the "block contains the
// derived hub" assertions go RED. Implement the real fold and they compose.

const forgerModule = require('../apps/forger');
const { foldHubIntoNodeEdges } = forgerModule;

// A minimal but non-trivial CEDS base, in ENGINE shape (what the forger returns): one class, one
// ENUMERATED property (option set + two values), and the HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE
// structural edges forgeHub reads. Properties are PG-JSON single-element arrays; nodes carry their
// own [ForgedNode] label (build.js's init is what stamps StandardBase, exactly as in production).
const syntheticCedsBaseNodeEdges = (() => {
	const arr = (scalar) => [scalar];
	const node = (stableId, properties) => ({
		ref: { source: 'CEDS', id: stableId },
		labels: ['ForgedNode'],
		stableId,
		properties,
	});
	const edge = (type, fromId, toId) => ({
		type,
		fromRef: { source: 'CEDS', id: fromId },
		toRef: { source: 'CEDS', id: toId },
		properties: { provenanceTier: arr('structural') },
	});
	// the Phase-2 module (cedsHubForge) REFUSES a base with no DmeStandardRoot (sourceProvenance,
	// SPEC §2) and refuses any tuple slot whose node lacks a uri (§1.4 provenance) — the fixture
	// carries both so this stage stays about the FOLD-into-block path, not the refusals (which
	// are proven in test-forger.js and the module's own suite).
	return {
		nodes: [
			node('root:ceds', {
				role: arr('DmeStandardRoot'),
				standardKey: arr('ceds'),
				snapshotKey: arr('testSnapshot'),
				publishedVersion: arr('2'),
				version: arr('2'),
				sourceUrl: arr('https://example.test/ceds'),
				uri: arr('https://example.test/ceds'),
			}),
			node('cls:assessment', {
				role: arr('DmeClass'),
				domainId: arr('C-Assessment'),
				canonicalKey: arr('C-Assessment'),
				name: arr('Assessment'),
				uri: arr('https://example.test/ceds/cls/assessment'),
			}),
			node('prop:status', {
				role: arr('DmeProperty'),
				domainId: arr('C-Assessment'),
				canonicalKey: arr('P-Status'),
				name: arr('Assessment Status'),
				uri: arr('https://example.test/ceds/prop/status'),
			}),
			node('os:status', {
				role: arr('DmeOptionSet'),
				rangeOptionSetId: arr('OS-Status'),
				uri: arr('https://example.test/ceds/os/status'),
			}),
			node('ov:active', {
				role: arr('DmeOptionValue'),
				canonicalKey: arr('OV-Active'),
				name: arr('Active'),
				uri: arr('https://example.test/ceds/ov/active'),
			}),
			node('ov:closed', {
				role: arr('DmeOptionValue'),
				canonicalKey: arr('OV-Closed'),
				name: arr('Closed'),
				uri: arr('https://example.test/ceds/ov/closed'),
			}),
		],
		edges: [
			edge('HAS_PROPERTY', 'cls:assessment', 'prop:status'),
			edge('HAS_OPTION_SET', 'prop:status', 'os:status'),
			edge('HAS_VALUE', 'os:status', 'ov:active'),
			edge('HAS_VALUE', 'os:status', 'ov:closed'),
		],
		embeddingDims: null,
	};
})();

// the forger double for the fold stage: returns the synthetic CEDS base and, when the standard is a
// hub (deriveHub), runs the REAL foldHubIntoNodeEdges over it so the returned nodeEdges carry base +
// hub — exactly what the production forger does. This is where the fold is genuinely exercised
// through the orchestrator (the fold LOGIC itself is unit-proven in test-forger.js).
// resolveBundle rides EVERY forger double (the component contract): build()'s RT-13 roster
// composition consults it for every recipe standard on every build, not only the bridge phase.
const hubFoldingForger = (baseNodeEdges) => Object.assign(() => ({
	forge: ({ standard, version, deriveHub }, cb) => {
		const answerWith = (nodeEdges) =>
			cb('', {
				standard,
				version,
				// snapshot-provenance triple: this double simulates a source whose declared version equals the
				// recipe token, so explicitVersionFrom yields `version` and it flows to subject/header/column.
				snapshotKey: '01',
				publishedVersion: version,
				versionSource: 'spec',
				nodeEdges,
				nodeCount: nodeEdges.nodes.length,
				edgeCount: nodeEdges.edges.length,
				embedCallCount: 0,
				// deliberately NO hubDivergenceReport/hubSkipReport on this double's report: build.js
				// writes those to the real dataStores/buildLogs when present, and this suite is
				// hermetic — the report-write path is not this stage's subject.
			});
		if (deriveHub) {
			// the production forger routes the RESOLVED bundle version (what the bundle READ) to the hub,
			// not the recipe token; this synthetic base stands in for a bundle read at `version`, so
			// bundleVersion === version here (the ground-truth forgeHub above uses the same value).
			// No embedder handed in (hermetic): cards carry embedText only, exactly the
			// --vectorize=false path.
			foldHubIntoNodeEdges(
				{
					standard,
					bundleVersion: version,
					requestedVersion: version,
					baseNodeEdges,
					declaredEmbeddingDims: baseNodeEdges.embeddingDims,
				},
				(foldError, folded) => {
					if (foldError) {
						cb(foldError);
						return;
					}
					answerWith(folded.nodeEdges);
				},
			);
			return;
		}
		answerWith(baseNodeEdges);
	},
}), { resolveBundle: forgerRegistryDouble });

// the replayManager double that mirrors the real engine's label-union on CREATION and serializes the
// retained material on the [StandardBase] harvest. init UNIONS applyLabels into every node's labels
// (replayManager withAppliedLabels, code fact), retaining the result; the [StandardBase] harvest
// serializes exactly that back out as one block.
const retainingReplayManager = () => () => {
	const working = workingReplayManager()();
	let retained = null; // { nodes, edges } after applyLabels union, captured from the CREATION init
	const unionLabels = (nodes, applyLabels) =>
		(nodes || []).map((oneNode) => {
			const existing = oneNode.labels || [];
			const additions = (applyLabels || []).filter((one) => existing.indexOf(one) === -1);
			return additions.length === 0 ? oneNode : { ...oneNode, labels: existing.concat(additions) };
		});
	const blockResult = (blockText, nodeCount, edgeCount, header) => {
		const blockId = contentAddress.blockIdForText(blockText);
		return {
			blockText,
			blockId,
			nodeCount,
			edgeCount,
			stableIdCoverage: null,
			conservationRecord: doubleConservationRecord({ blockId, header, loadedNodeCount: nodeCount, loadedEdgeCount: edgeCount, harvestedNodeCount: nodeCount, harvestedEdgeCount: edgeCount }).record,
		};
	};
	return Object.assign({}, working, {
		init: (spec, cb) => {
			if (spec && spec.nodeEdges) {
				retained = {
					nodes: unionLabels(spec.nodeEdges.nodes, spec.applyLabels),
					edges: spec.nodeEdges.edges,
				};
			}
			working.init(spec, cb);
		},
		harvest: (spec, cb) => {
			const labels = (spec && spec.selectionLabels) || [];
			if (labels.indexOf('StandardBase') !== -1) {
				const rt = retained || { nodes: [], edges: [] };
				const selected = rt.nodes.filter((oneNode) => (oneNode.labels || []).indexOf('StandardBase') !== -1);
				const blockText = realReplayBlock.serializeBlock({
					header: {
						blockType: (spec.header && spec.header.blockType) || 'standardBase',
						standardKey: (spec.header && spec.header.standardKey) || 'ceds',
						version: (spec.header && spec.header.version) || '2',
						embeddingDims: null,
					},
					nodes: selected,
					edges: rt.edges,
				});
				cb('', blockResult(blockText, selected.length, rt.edges.length, spec.header));
				return;
			}
			working.harvest(spec, cb);
		},
	});
};

const labelCount = (nodes, label) =>
	nodes.filter((oneNode) => (oneNode.labels || []).indexOf(label) !== -1).length;

const stageHubFoldedIntoBase = () => {
	harness.section('HUB FOLDED INTO BASE — one [StandardBase] block carries base + hub, composed against the REAL editor');

	// what forgeHub INDEPENDENTLY derives from the same synthetic base — the ground truth the folded
	// block's hub set must reproduce (a base-only block would not). Factory args come from the KIT'S
	// OWN DESCRIPTOR (Phase 2a: the registry is deleted; hubNamespace= in forges/ceds/
	// parserDescriptor.ini is the namespace's ONE home, invariant I8); forgeHub calls back synchronously.
	let expected;
	cedsHubForge({
		hubVersion: '2',
		hubNamespace: forgerModule.resolveBundle({ standard: 'ceds' }).hubNamespace,
	}).forgeHub(syntheticCedsBaseNodeEdges, (expectedError, expectedResult) => {
		if (expectedError) {
			throw new Error(`ground-truth forgeHub refused: ${expectedError}`);
		}
		expected = expectedResult;
	});
	const baseNodeCount = syntheticCedsBaseNodeEdges.nodes.length;

	const xLog = capturingXLog();
	const standardsDatabase = standardsDatabaseDouble();
	buildLib.build(
		{
			recipeName: 'cedsHubOnly',
			description: 'ceds forged as a hub, no bridge — the hub folds into its base block',
			standards: [{ token: 'ceds', version: '2' }],
			hubs: [{ standard: 'ceds' }],
			bridges: [],
		},
		{
			xLog,
			standardsDatabase,
			cedsFidelityGateRunner: announcedFidelityGateStub, roundTripStageRunner: announcedRoundTripStageStub,
			components: {
				forger: hubFoldingForger(syntheticCedsBaseNodeEdges),
				replayManager: retainingReplayManager(),
				bridgeMaker: workingBridgeMaker(),
				manifestEditor: realManifestEditor,
			},
		},
		(err, result) => {
			harness.equal('the hub recipe builds without error against the real editor', err, '');
			harness.equal(
				'memberCount is 1 — ONE [StandardBase] member, NO separate hub member',
				(result || {}).memberCount,
				1,
			);

			const saved = Object.values(standardsDatabase.savedBlocks);
			harness.equal('exactly one schema block reached the store', saved.length, 1);
			const only = saved[0];
			harness.equal('  and its kind is standardBase (there is no hub-kind block)', only.kind, 'standardBase');
			harness.equal(
				'  keyed by the base subject ceds@2_base with its _base marker',
				only.subject,
				'ceds@2_base',
			);
			harness.ok(
				'  no block of kind hub was composed at all',
				!saved.some((oneBlock) => oneBlock.kind === 'hub'),
				JSON.stringify(saved.map((b) => b.kind)),
			);

			// parse the ONE block and prove it carries base AND the derived hub — this is the assertion
			// observed RED in State 2 (base-only pass-through) before the forger folded the hub in.
			const block = realReplayBlock.deserializeBlock(only.text);
			harness.equal(
				'the ONE block carries the HubReferences forgeHub derived, folded in beside the base',
				labelCount(block.nodes, 'HubReference'),
				expected.counts.hubReferenceTotal,
			);
			harness.equal(
				'  and its ONE HubDefinition (folded in, not dropped)',
				labelCount(block.nodes, 'HubDefinition'),
				1,
			);
			harness.equal(
				'  the block node total is base + derived hub (root + 5 base structural + refs + definition)',
				block.nodes.length,
				baseNodeCount + expected.counts.nodeTotal,
			);
			harness.equal(
				'  and every base structural node still carries StandardBase (the base is not displaced)',
				labelCount(block.nodes, 'StandardBase'),
				block.nodes.length,
			);
			harness.ok(
				'  the hub nodes gained StandardBase while KEEPING their intrinsic HubReference/HubDefinition',
				block.nodes
					.filter((oneNode) => (oneNode.labels || []).indexOf('HubReference') !== -1)
					.every((oneNode) => (oneNode.labels || []).indexOf('StandardBase') !== -1),
				JSON.stringify(
					block.nodes.map((oneNode) => oneNode.labels).filter((ls) => ls.indexOf('HubReference') !== -1)[0],
				),
			);
			harness.equal(
				'  and every derived decomposition/IN_HUB edge is present in the same block as the base edges',
				block.edges.length,
				syntheticCedsBaseNodeEdges.edges.length + expected.counts.edgeTotal,
			);
			harness.ok(
				'  the decomposition edges (HAS_CEDS_* onto base stableIds) and IN_HUB are there',
				['HAS_CEDS_DOMAIN', 'HAS_CEDS_PROPERTY', 'HAS_CEDS_RANGE', 'HAS_CEDS_VALUE', 'IN_HUB'].every(
					(oneType) => block.edges.some((oneEdge) => oneEdge.type === oneType),
				),
				JSON.stringify([...new Set(block.edges.map((e) => e.type))]),
			);
			// the WHOLE POINT of folding: the hub's HAS_CEDS_* edges resolve WITHIN this one block,
			// because both endpoints (a hub node and a base node) are present in it.
			const stableIdsInBlock = new Set(block.nodes.map((oneNode) => oneNode.stableId));
			harness.ok(
				'  every hub edge endpoint resolves within the one block — no cross-boundary edge is dropped',
				block.edges.every(
					(oneEdge) => stableIdsInBlock.has(oneEdge.fromRef.id) && stableIdsInBlock.has(oneEdge.toRef.id),
				),
				JSON.stringify(
					block.edges
						.filter((oneEdge) => !stableIdsInBlock.has(oneEdge.fromRef.id) || !stableIdsInBlock.has(oneEdge.toRef.id))
						.slice(0, 3),
				),
			);
			// sanity that the ground truth is non-trivial — a green here must mean the derivation RAN,
			// not that both sides were empty.
			harness.ok(
				'  (ground-truth is non-trivial: forgeHub derived at least 3 references)',
				expected.counts.hubReferenceTotal >= 3,
				JSON.stringify(expected.counts),
			);

			harness.ok('the log shows NO [B] line — nothing minted a separate hub block', !/\[B\]/.test(xLog.text()), xLog.text());

			stageFaultInjection();
		},
	);
};

// =====================================================================
// FAULT INJECTION — every error path in the orchestrator, watched firing.
// =====================================================================
// Each case breaks exactly ONE component method and asserts (a) the build reports an error,
// (b) the error names the phase AND the failing operation AND the subject (which standard,
// which pairing) — a bare "it failed" would leave an operator nowhere to start — and (c) no
// result is handed back, so a caller cannot mistake a broken build for a finished one.

const faultCases = [
	{
		label: 'phase A: forger.forge fails',
		components: { forger: workingForger({ forge: (spec, cb) => cb('source bundle unreadable') }) },
		pattern: /phase A \(forge\) failed: forge ceds: source bundle unreadable/,
	},
	{
		label: 'phase A: replay.create(forge) fails',
		components: { replayManager: replayFailingCreateFor('forge', 'no scratch graph available') },
		pattern: /phase A \(forge\) failed: create\(forge\) for ceds: no scratch graph available/,
	},
	{
		label: 'phase A: loading the forged material fails',
		components: {
			replayManager: (() => {
				const working = workingReplayManager()();
				return () => Object.assign({}, working, { init: (spec, cb) => cb('write path refused the nodes') });
			})(),
		},
		pattern: /phase A \(forge\) failed: init ceds: write path refused the nodes/,
	},
	{
		label: 'phase A: harvesting the standardBase schema block fails',
		components: { replayManager: replayFailingHarvestFor('StandardBase', 'harvest returned nothing') },
		pattern: /phase A \(forge\) failed: harvest standardBase ceds: harvest returned nothing/,
	},
	{
		label: 'phase A: recording the standardBase member fails',
		components: { manifestEditor: manifestFailingAddFor('standardBase', 'standardsDatabase write refused') },
		pattern: /phase A \(forge\) failed: add standardBase ceds@current_base: standardsDatabase write refused/,
	},
	{
		label: 'phase A: disposing the scratch graph fails',
		components: { replayManager: replayFailingDeleteFor('forge', 'container still running') },
		pattern: /phase A \(forge\) failed: container still running/,
	},
	{
		label: 'phase C: replay.create(dependencyGraph) fails',
		components: {
			replayManager: replayFailingCreateFor('dependencyGraph', 'dependency set unsatisfiable'),
		},
		pattern: /phase C \(bridge\) failed: create\(dep\) lif::ceds: dependency set unsatisfiable/,
	},
	{
		label: 'phase C: bridgeMaker.run fails',
		components: { bridgeMaker: workingBridgeMaker({ run: (spec, cb) => cb('bridge not found') }) },
		pattern: /phase C \(bridge\) failed: bridge lif::ceds: bridge not found/,
	},
	{
		label: 'phase C: harvesting the labeled relationship schema block fails',
		components: {
			replayManager: replayFailingHarvestFor('BridgedRelation', 'no labeled edges to harvest'),
		},
		pattern: /phase C \(bridge\) failed: harvest relationships lif::ceds: no labeled edges to harvest/,
	},
	{
		label: 'phase C: recording the relationship member fails',
		components: { manifestEditor: manifestFailingAddFor('relationship', 'kind not in the taxonomy') },
		pattern: /phase C \(bridge\) failed: add relationship lif::ceds: kind not in the taxonomy/,
	},
	{
		label: 'phase C: disposing the dependency graph fails',
		components: { replayManager: replayFailingDeleteFor('dependencyGraph', 'dep container wedged') },
		pattern: /phase C \(bridge\) failed: dep container wedged/,
	},
	{
		label: 'compose: resolving the manifest members fails',
		components: {
			manifestEditor: manifestWithHandleOverride({
				schemaBlocks: (cb) => cb('member names a block that is not in the standardsDatabase'),
			}),
		},
		pattern: /compose failed: member names a block that is not in the standardsDatabase/,
	},
	{
		label: 'materialize: the eval golden cannot be created',
		components: { replayManager: replayFailingCreateFor('materialize', 'out of disk') },
		pattern: /materialize failed: creating the eval golden: out of disk/,
	},
	{
		label: 'materialize: loading the schema blocks into the eval golden fails',
		components: {
			replayManager: (() => {
				const working = workingReplayManager()();
				return () =>
					Object.assign({}, working, {
						init: (spec, cb) =>
							spec.schemaBlocks !== undefined && spec.inGraph && String(spec.inGraph.graphName).includes('materialize')
								? cb('content address verification failed')
								: working.init(spec, cb),
					});
			})(),
		},
		pattern: /materialize failed: loading 3 schema block\(s\): content address verification failed/,
	},
];

const stageFaultInjection = () => {
	harness.section('FAULT INJECTION — the seam itself must not change behaviour');

	// positive control FIRST: with fully WORKING injected components the build still succeeds and
	// still produces 4 members. Without this, a later red could mean "the fault fired" or merely
	// "injection breaks everything", and those are not the same discovery.
	runBuildWith(
		loadOrDie(fixture('cedsLif')),
		{
			forger: workingForger(),
			replayManager: workingReplayManager(),
			bridgeMaker: workingBridgeMaker(),
			manifestEditor: workingManifestEditor(),
		},
		({ err, result }) => {
			harness.equal('working injected components build without error', err, '');
			harness.equal('  and still produce 3 members (2 base incl. folded hub + 1 relationship)', result.memberCount, 3);

			harness.section('FAULT INJECTION — every orchestrator error path, watched firing');

			const runCase = (index) => {
				if (index >= faultCases.length) {
					stageStoreReaderRefusal();
					return;
				}
				const testCase = faultCases[index];
				runBuildWith(
					loadOrDie(fixture('cedsLif')),
					testCase.components,
					({ err: caseErr, result: caseResult }) => {
						harness.match(testCase.label, caseErr, testCase.pattern);
						harness.ok(
							`  no result is returned (${testCase.label})`,
							caseResult === undefined,
							`result was ${JSON.stringify(caseResult)}`,
						);
						runCase(index + 1);
					},
				);
			};

			runCase(0);
		},
	);
};

// =====================================================================
// ⟪graphSelfDoc Phase 5⟫ THE storeReader REFUSAL, PROVEN IN THE FAILURE DIRECTION.
// =====================================================================
// This exists because the guard was ADDED and then NEVER SEEN TO FIRE: my first run of this suite
// crashed with `replay.finish is not a function` from a stale double, and THE CRASH MASKED THE
// GUARD. A 197/197 green afterwards proves the SATISFIED path only. A guard never observed failing
// is unproven — that is this project's oldest rule and it applies to guards I write myself.
//
// THE INJECTION IS AIMED, and the aim matters. Two upstream guards check DIFFERENT methods:
// build.js:1014 (the build path) requires `saveBlock`; build.js:2174 (the replay path) requires
// `getManifest`. So a standardsDatabase carrying saveBlock but NOT getManifest CLEARS 1014 and
// reaches materialize — where the Phase 5 refusal is the only thing between it and a graph whose
// recipe cannot be read. On the REPLAY path the same refusal is SHADOWED by 2174 and can never
// fire; naming that asymmetry is the difference between "my guard protects both paths" (false) and
// "my guard is redundant" (also false).
const stageStoreReaderRefusal = () => {
	harness.section('storeReader REFUSAL — the Phase 5 guard, watched firing on the BUILD path');

	const xLog = capturingXLog();
	const crippledStore = standardsDatabaseDouble();
	// saveBlock stays (so build.js:1014 passes); getManifest is removed (so mine must bite).
	delete crippledStore.getManifest;

	buildLib.build(
		loadOrDie(fixture('cedsLif')),
		{
			xLog,
			standardsDatabase: crippledStore,
			components: {
				forger: workingForger(),
				replayManager: workingReplayManager(),
				bridgeMaker: workingBridgeMaker(),
				manifestEditor: workingManifestEditor(),
			},
			cedsFidelityGateRunner: announcedFidelityGateStub,
			roundTripStageRunner: announcedRoundTripStageStub,
		},
		(err, result) => {
			harness.match(
				'a storeReader without getManifest is REFUSED BY NAME at materialize',
				err,
				/a storeReader exposing getManifest is REQUIRED/,
			);
			harness.ok(
				'  and the refusal is MINE, not a neighbouring guard firing first',
				/graphSelfDoc Phase 5|materialize failed/.test(String(err || '')),
				`refusal text was: ${String(err || '(none)')}`,
			);
			harness.ok('  and no result is returned', result === undefined, JSON.stringify(result));
			stageMonomorphicCreate();
		},
	);
};

// =====================================================================
// THE DOCTRINE GATE — create is monomorphic, and the double that says so genuinely bites.
// =====================================================================
// The defect this phase repaired was a create() called with { purpose:'materialize', manifestId }
// and read as a bolt url. Nothing above would turn red if that came back unless the double
// enforcing monomorphism actually refuses an undeclared key — so it is proven in the failure
// direction, on its own, exactly like every other gate in this tree.

const stageMonomorphicCreate = () => {
	harness.section('MONOMORPHIC create — the gate is proven in the failure direction');

	const doubleUnderTest = workingReplayManager()();
	doubleUnderTest.create({ purpose: 'materialize', manifestId: 'someManifest' }, (err, handle) => {
		harness.match(
			'a create() carrying a manifestId is refused, naming the undeclared key',
			err,
			/create is MONOMORPHIC — undeclared spec key\(s\) manifestId/,
		);
		harness.ok('  and mints no graph', handle === undefined, JSON.stringify(handle));

		doubleUnderTest.create({ purpose: 'materialize' }, (okErr, okHandle) => {
			harness.equal('the declared shape is still accepted', okErr, '');
			harness.ok(
				'  and returns a GraphHandle OBJECT, not a bolt url string',
				!!okHandle && typeof okHandle === 'object' && typeof okHandle.boltUrl === 'string',
				JSON.stringify(okHandle),
			);
			harness.match('  whose graphName is DEV_* scratch tier', okHandle.graphName, /^DEV_/);

			stageVectorize();
		});
	});
};

// =====================================================================
// VECTORIZE — the spend knob is a real operator switch now, threaded to forge()
// =====================================================================
// build.js:166 used to hardcode `vectorize: true`, and its own comment recorded that the operator
// had no off-switch ("RECORDED, NOT FIXED ... the next honest step"). It is now settable:
// deps.vectorize (the explicit dependency the orchestrator hands down, and the test seam here)
// overrides; absent, it reads --vectorize through the production optional reader with a DOCUMENTED
// default of true (polyArch2 §6: a default is permitted for a legitimately-optional input that
// -help documents). Both directions are honored down to the forge call, and an INVALID value is
// refused by name rather than silently corrected.

const buildCapturingVectorize = (vectorizeDep, done) => {
	const captured = [];
	const xLog = capturingXLog();
	const standardsDatabase = standardsDatabaseDouble();
	const capturingForger = Object.assign(
		() => ({
			forge: ({ standard, version, vectorize }, fcb) => {
				captured.push(vectorize);
				fcb('', {
					standard,
					version,
					snapshotKey: '01',
					publishedVersion: version,
					versionSource: 'spec',
					nodeEdges: { nodes: [], edges: [], embeddingDims: null },
					nodeCount: 0,
					edgeCount: 0,
					embedCallCount: 0,
				});
			},
		}),
		// the component contract: RT-13 roster composition consults resolveBundle on every build
		{ resolveBundle: forgerRegistryDouble },
	);
	const deps = {
		xLog,
		standardsDatabase,
		// hermetic: the real R-1 gate no-ops here (no ceds token) but the real RT-13 runner
		// would write its stage summary into the canonical buildLogs home — stubbed, announced.
		roundTripStageRunner: announcedRoundTripStageStub,
		components: {
			forger: capturingForger,
			replayManager: workingReplayManager(),
			bridgeMaker: workingBridgeMaker(),
			manifestEditor: workingManifestEditor(),
		},
	};
	if (vectorizeDep !== 'OMIT') {
		deps.vectorize = vectorizeDep;
	}
	buildLib.build(loadOrDie(fixture('lifOnly')), deps, (err, result) => done({ err, result, captured }));
};

const stageVectorize = () => {
	harness.section('VECTORIZE — threaded to forge(), honored both ways, default documented, invalid refused');

	buildCapturingVectorize(false, ({ err, captured }) => {
		harness.equal('vectorize=false builds without error', err, '');
		harness.equal(
			'and forge() is called with vectorize=false — the OFF direction actually reaches the forger',
			JSON.stringify(captured),
			JSON.stringify([false]),
		);

		buildCapturingVectorize(true, ({ err: errTrue, captured: capturedTrue }) => {
			harness.equal('vectorize=true builds without error', errTrue, '');
			harness.equal(
				'and forge() is called with vectorize=true — the ON direction, the positive control',
				JSON.stringify(capturedTrue),
				JSON.stringify([true]),
			);

			buildCapturingVectorize('OMIT', ({ err: errDefault, captured: capturedDefault }) => {
				harness.equal('an omitted vectorize builds without error', errDefault, '');
				harness.equal(
					'and forge() receives the DOCUMENTED default of true when nothing is supplied',
					JSON.stringify(capturedDefault),
					JSON.stringify([true]),
				);

				buildCapturingVectorize('no', ({ err: errInvalid, result: resultInvalid, captured: capturedInvalid }) => {
					harness.match(
						"an INVALID deps.vectorize is refused by name, not silently corrected to a default",
						errInvalid,
						/vectorize must be a boolean/,
					);
					harness.ok('  and hands back no result', resultInvalid === undefined, JSON.stringify(resultInvalid));
					harness.ok(
						'  and forge() is never reached (nothing captured)',
						capturedInvalid.length === 0,
						JSON.stringify(capturedInvalid),
					);

					stageDisposeOnFailure();
				});
			});
		});
	});
};

// =====================================================================
// DISPOSE-ON-FAILURE — a mid-pipeline failure disposes the DEV_* graph it created (Item 4)
// =====================================================================
// replay.delete was scheduled ONLY as the last task of each per-standard taskList, and pipeRunner
// aborts the list on the first error — so any failure after replay.create (init, harvest, add) left
// a live DEV_* container with no cleanup. Here a replayManager double records every create and
// delete and FAILS the standardBase harvest; the orchestrator must dispose the graph it created
// before the error propagates. No docker: the double is a spy.

const stageDisposeOnFailure = () => {
	harness.section('DISPOSE-ON-FAILURE — a mid-pipeline failure disposes the scratch graph it created');

	const created = [];
	const deleted = [];
	const recordingReplay = () => {
		const working = workingReplayManager()();
		return Object.assign({}, working, {
			create: (spec, cb) =>
				working.create(spec, (err, handle) => {
					if (!err) {
						created.push(handle.graphName);
					}
					cb(err, handle);
				}),
			// fail the standardBase harvest — a failure AFTER create, BEFORE the trailing delete task
			harvest: (spec, cb) => cb('harvest returned nothing'),
			delete: (handle, cb) => {
				deleted.push(handle && handle.graphName);
				cb('');
			},
		});
	};

	runBuildWith(loadOrDie(fixture('lifOnly')), { replayManager: recordingReplay }, ({ err, result }) => {
		harness.match('the build fails at the mid-pipeline harvest', err, /phase A \(forge\) failed: harvest standardBase/);
		harness.ok('  and hands back no result', result === undefined, JSON.stringify(result));
		harness.equal('  a scratch graph WAS created', created.length, 1);
		harness.ok(
			'  and that exact created graph was DISPOSED before the error propagated — no leak',
			deleted.includes(created[0]),
			`created=${JSON.stringify(created)} deleted=${JSON.stringify(deleted)}`,
		);

		stageManifestPersistedToStore();
	});
};

// =====================================================================
// MANIFEST PERSISTED — a -build writes the manifest + its membership THROUGH to a real store
// =====================================================================
// THE PRINCIPLE (TQ, 2026-07-25): a -build must ALWAYS persist a manifest that regenerates the graph
// it just built. Composing the manifest and materializing from it is not enough — if the manifest is
// never SAVED, the manifests and manifestBlocks tables stay empty and the graph cannot be
// regenerated. Every other stage uses the in-memory standardsDatabaseDouble and never inspects its
// manifests table, so the gap was invisible. This stage opens a REAL temp-file standardsDatabase
// (hermetic; no docker/voyage/llm) and proves:
//   * the manifests table holds EXACTLY ONE row whose refId EQUALS the composed manifestId;
//   * manifestBlocks holds memberCount rows for it;
//   * ROUND TRIP — the stored membership (schemaBlockRefIds + positions) re-hashes, through the ONE
//     addressing rule, back to the composed manifestId, so "this manifest regenerates this graph" is
//     provable from storage alone;
//   * IDEMPOTENCE — a second build over the same blocks does not error and does not duplicate the
//     manifest or its membership (saveManifest dedups on the membership hash).
//
// STATE 1 (RED): with no manifest.save() in composeAndMaterialize, the build still SUCCEEDS (err is
// '') but the manifests table is EMPTY — every assertion below the build goes red. STATE 2 (GREEN):
// add manifest.save(cb) at compose time and they pass.

const stageManifestPersistedToStore = () => {
	harness.section('MANIFEST PERSISTED — a -build writes its manifest + membership to a real store');

	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfBuildManifest-'));
	const databaseFilePath = path.join(scratchDir, `manifestGate_${process.pid}.sqlite3`);

	// a raw COUNT read the store API does not expose — opened READ-side against the same file, exactly
	// as lib/standards-database's own suite reads behind the store to prove verify-on-read.
	const RAW = { noTableNameOk: true, suppressStatementLog: true };
	const countRows = (sql, cb) => {
		sqliteInstance.initDatabaseInstance(databaseFilePath, (initErr, dbInstance) => {
			if (initErr) {
				cb(initErr);
				return;
			}
			dbInstance.getTable('manifestRowCounter', RAW, (tableErr, tableRef) => {
				if (tableErr) {
					cb(tableErr);
					return;
				}
				tableRef.getData(sql, RAW, (queryErr, rows) =>
					cb(queryErr || '', (rows && rows[0] && rows[0].n) || 0),
				);
			});
		});
	};

	standardsDatabaseModule.open({ databaseFilePath }, (openErr, standardsDatabase) => {
		if (openErr) {
			harness.ok('a throwaway standardsDatabase opened', false, openErr);
			harness.report();
			return;
		}

		// cedsLif composes THREE members (2 standardBase + 1 relationship) — a manifest with real
		// membership, so positions 0..2 and a multi-member round trip are exercised, not a trivial one.
		const runBuild = (whenDone) =>
			buildLib.build(
				loadOrDie(fixture('cedsLif')),
				{
					xLog: capturingXLog(),
					standardsDatabase,
					cedsFidelityGateRunner: announcedFidelityGateStub, roundTripStageRunner: announcedRoundTripStageStub,
					components: {
						forger: workingForger(),
						replayManager: workingReplayManager(),
						bridgeMaker: workingBridgeMaker(),
						manifestEditor: realManifestEditor,
					},
				},
				whenDone,
			);

		runBuild((err, result) => {
			harness.equal('the build succeeded against the real store', err, '');
			const composedManifestId = (result || {}).manifestId;
			const memberCount = (result || {}).memberCount;
			harness.equal('  composing a three-member manifest', memberCount, 3);
			harness.match('  addressed by manifestKeyForMembership', composedManifestId, /^[0-9a-f]{16,}$/);

			countRows('SELECT count(*) AS n FROM manifests;', (countErr, manifestCount) => {
				harness.equal('RED PROOF: the manifests table holds EXACTLY ONE row after a build', manifestCount, 1);
				if (countErr) {
					harness.ok('  the manifests table could be counted', false, countErr);
				}

				standardsDatabase.getManifest({ refId: composedManifestId }, (getErr, storedManifest) => {
					harness.equal('the ONE manifest is keyed by the composed manifestId', getErr, '');
					harness.ok(
						'  the composed manifestId names a stored manifest (not null)',
						!!storedManifest,
						JSON.stringify(storedManifest),
					);
					const storedMembers = (storedManifest && storedManifest.members) || [];
					harness.equal('manifestBlocks holds memberCount rows for it', storedMembers.length, memberCount);

					// ROUND TRIP — the stored membership regenerates the composed graph's identity. If the
					// stored (schemaBlockRefId, position) pairs re-hash through the ONE addressing rule back to
					// the composed manifestId, the manifest genuinely regenerates the graph it was built from.
					const regeneratedKey = contentAddress.manifestKeyForMembership(
						storedMembers.map((oneMember) => ({
							blockId: oneMember.schemaBlockRefId,
							position: oneMember.position,
						})),
					);
					harness.equal(
						'ROUND TRIP: the stored membership re-hashes to the composed manifestId',
						regeneratedKey,
						composedManifestId,
					);
					harness.equal(
						'  positions are the total 0..memberCount-1 ordering',
						storedMembers.map((oneMember) => oneMember.position).join(','),
						'0,1,2',
					);

					// IDEMPOTENCE — a second build over the same blocks must not error and must not duplicate
					// the manifest or its membership (saveManifest dedups on the membership hash).
					runBuild((secondErr, secondResult) => {
						harness.equal('IDEMPOTENCE: a second identical build does not error', secondErr, '');
						harness.equal(
							'  and composes the SAME manifestId',
							(secondResult || {}).manifestId,
							composedManifestId,
						);
						countRows('SELECT count(*) AS n FROM manifests;', (reCountErr, manifestCount2) => {
							harness.equal('  the manifests table STILL holds exactly one row (no duplicate)', manifestCount2, 1);
							countRows(
								'SELECT count(*) AS n FROM manifestBlocks;',
								(mbErr, manifestBlockCount) => {
									harness.equal(
										'  manifestBlocks STILL holds exactly memberCount rows (no duplicate membership)',
										manifestBlockCount,
										memberCount,
									);
									fs.rmSync(scratchDir, { recursive: true, force: true });
									stageDeclaredMissingUnconditional(() => preSpendCollisionRefusal(() => harness.report()));
								},
							);
						});
					});
				});
			});
		});
	});
};

// =====================================================================
// ⟪P2-review S-1/S-2⟫ seam guards — the report-pair refusal and the heap gate
// =====================================================================
const stageP2ReviewGuards = () => {
	harness.section('P2-REVIEW GUARDS — report-pair refusal (S-1) and the heap gate (S-2)');

	// S-2: the heap gate, proven with INJECTED limits (never by shrinking a real heap).
	// RED first: the calibration case (119,805 nodes × 1024 dims) against the 8GB limit that
	// really did OOM — the gate must refuse and name the remedy.
	const heapRefusal = require('../lib/build').resolveHeapAdequacy({
		nodeCount: 119805,
		embeddingDims: 1024,
		heapSizeLimitBytes: 8 * 1024 * 1024 * 1024,
	});
	harness.match(
		'S-2 OBSERVED RED: the calibration load against an 8GB limit is refused naming --max-old-space-size',
		heapRefusal.error || '',
		/REFUSED before provisioning[\s\S]*--max-old-space-size=\d+/,
	);
	harness.ok(
		'  GREEN: the same load passes a 32GB limit',
		!require('../lib/build').resolveHeapAdequacy({
			nodeCount: 119805,
			embeddingDims: 1024,
			heapSizeLimitBytes: 32 * 1024 * 1024 * 1024,
		}).error,
		'refused at 32GB',
	);
	harness.ok(
		'  GREEN: an un-vectorized payload (embeddingDims null) is never heap-gated',
		!require('../lib/build').resolveHeapAdequacy({
			nodeCount: 119805,
			embeddingDims: null,
			heapSizeLimitBytes: 1024 * 1024,
		}).error,
		'gated an un-vectorized payload',
	);

	// S-1: a forge report carrying ONE hub report without its pair is refused by name —
	// never a JSON.stringify(undefined) crash inside the write callback.
	runBuildWith(
		loadOrDie(fixture('cedsLif')),
		{
			forger: workingForger({
				forge: ({ standard, version }, cb) =>
					cb('', {
						standard,
						version,
						snapshotKey: '01',
						publishedVersion: version,
						versionSource: 'spec',
						nodeEdges: { nodes: [], edges: [], embeddingDims: null },
						nodeCount: 0,
						edgeCount: 0,
						embedCallCount: 0,
						hubDivergenceReport: [], // present WITHOUT its pair — malformed by contract
					}),
			}),
		},
		({ err }) => {
			harness.match(
				'S-1 OBSERVED RED: a divergence report without its skip-report pair is refused by name',
				err || '',
				/NO hubSkipReport[\s\S]*half a pair is a malformed report/,
			);
			stagePreflight();
		},
	);
};

stageP2ReviewGuards();
