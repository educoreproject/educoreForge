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
const cedsHubForge = require('../../../forges/ceds/lib/referenceSubgraph');

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

const goodRecipe = (name) =>
	path.join(__dirname, '..', '..', '..', 'recipes', `${name}.recipe.jsonc`);

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
			harvest: ({ inGraph, selectionLabels, header }, cb) => {
				if (!header || !header.blockType || !header.standardKey) {
					cb(`replayManager.harvest: a header carrying blockType and standardKey is required`);
					return;
				}
				const blockText = doubleBlockText(header, selectionLabels);
				// the address is minted where the block is born, exactly as the real harvest does
				cb('', {
					blockText,
					blockId: contentAddress.blockIdForText(blockText),
					nodeCount: 1,
					edgeCount: 0,
					stableIdCoverage: 1,
					selectionLabels,
					inGraph,
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

const workingBridgeMaker = (overrides) => () =>
	Object.assign(
		{
			run: (spec, cb) => cb('', { ...spec, edgesWritten: 0 }),
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

// EVERY build in this suite goes through here, so no path can accidentally reach the real forger
// (Voyage) or the real replayManager (Docker). Overrides merge on top of the safe default set.
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
	buildLib.build(recipe, { xLog, standardsDatabase: standardsDatabase, components }, (err, result) =>
		callback({ err, result, xLog, standardsDatabase }),
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
		loadOrDie(goodRecipe('lifOnly')),
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
	runBuild(loadOrDie(goodRecipe('lifOnly')), ({ err, result, xLog }) => {
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
	runBuild(loadOrDie(goodRecipe('cedsLif')), ({ err, result, xLog }) => {
		harness.section('cedsLif — two standards, one hub, one bridge');

		harness.equal('build succeeds (no error)', err, '');
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
	const authoredBridgeMaker = () => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 26, decisionBlock: null, counts: { authored: 26 } }) });
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
		const inferredBridgeMaker = () => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 5, decisionBlock: { hash: 'frozen' }, counts: { inferred: 5 } }) });
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
					bridges: [{ source: 'ctdl', pairWith: 'ctdlasn', bridge: 'ctdlFamilyStructure', dependencies: ['ctdl', 'ctdlasn'], cacheMode: 'reuse' }],
				};
				const structuralBridgeMaker = () => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 4, decisionBlock: null, producer: 'structural', counts: { structural: 4 } }) });
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
				cacheMode: 'reuse',
			},
		],
	};
	// the coordinating producer's status, as a double: THREE pair-scoped blocks, each with its OWN distinct
	// applyLabel (what its edges were written under) and its pair's endpoint TOKENS root-first.
	const familyBridgeMaker = () => ({
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
	});
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
	const emptyInferredBridgeMaker = () => ({ run: (spec, cb) => cb('', { ...spec, edgesWritten: 0, decisionBlock: null, producer: 'inferred', counts: { inferred: 0 } }) });
	runBuildWith(cedsCtdlRecipe, { bridgeMaker: emptyInferredBridgeMaker }, ({ err: emptyErr, xLog: emptyLog }) => {
		harness.equal('an empty inferred block (no frozen decisions yet) still builds', emptyErr, '');
		harness.match('  build.js names it _close from producer=inferred (NOT _exact from the null decisionBlock)', emptyLog.text(), /-> relationship ceds@current_rel_ctdl@current_close /);

		continueRebridgeWiring();
	});
	};

	const continueRebridgeWiring = () => {
	const capturedSpecs = [];
	const captureBridgeMaker = () => ({ run: (spec, cb) => { capturedSpecs.push(spec); cb('', { ...spec, edgesWritten: 0, decisionBlock: null, counts: {} }); } });
	const fakeDecisionStore = { getDecisionBlock: (a, cb) => cb('', { frozenText: null }), saveDecisionBlock: (a, cb) => cb('') };
	// a deterministic STUB reranker — the hermetic suite's llmClient. Injected on inferenceConfig, it is the
	// real-vs-stub seam's STUB arm: with it present, resolveInferenceConfig NEVER mints the real Anthropic
	// client, so a --rebridge-scoped build stays hermetic (no key needed, no network — §3 hard line 2).
	const stubReranker = { model: 'stub-reranker', rerank: (a, cb) => cb('', { choice: 'NONE' }) };
	const runRebridge = (extraDeps, cb) => {
		const xLog = capturingXLog();
		const standardsDatabase = standardsDatabaseDouble();
		const components = { forger: workingForger(), replayManager: workingReplayManager(), bridgeMaker: captureBridgeMaker, manifestEditor: workingManifestEditor() };
		buildLib.build(cedsCtdlRecipe, { xLog, standardsDatabase, components, ...extraDeps }, (err, result) => cb({ err, result }));
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
		harness.section('FACTORY SELECTION — resolveInferenceConfig real-vs-stub reranker (§6 no-silent-default)');
		const sentinelClient = { model: 'sentinel', rerank: () => {} };
		let factoryCalls = 0;
		let lastFactoryArg = null;
		const fakeFactory = (opts) => { factoryCalls++; lastFactoryArg = opts; return sentinelClient; };
		const injectedStub = { model: 'injected-stub', rerank: () => {} };

		// 1. STUB injected -> used AS-IS; the factory is NOT consulted (the suite path).
		const stubRes = buildStatics.resolveInferenceConfig({ inferenceConfig: { llmClient: injectedStub }, llmClientFactory: fakeFactory }, ['ctdl']);
		harness.ok('an INJECTED llmClient is used as-is (the stub arm)', stubRes.value && stubRes.value.llmClient === injectedStub);
		harness.equal('  and the factory is NEVER called when a client is injected (suite never mints the real one)', factoryCalls, 0);

		// 2. active scope, NO injected client -> the REAL run mints via the factory (the real arm).
		const realRes = buildStatics.resolveInferenceConfig({ inferenceConfig: { topK: 15 }, llmClientFactory: fakeFactory }, 'all');
		harness.ok('an active --rebridge with no injected client MINTS via the factory (the real arm)', realRes.value && realRes.value.llmClient === sentinelClient);
		harness.equal('  the factory was called exactly once', factoryCalls, 1);
		harness.equal('  and pointed at the canonical [anthropicAi] config path', lastFactoryArg && /anthropicAi\.ini$/.test(lastFactoryArg.configFilePath), true);
		harness.equal('  operator inferenceConfig fields (topK) survive alongside the minted client', realRes.value && realRes.value.topK, 15);

		// 3. INACTIVE scope (plain build) -> mints nothing; no factory call.
		const plainRes = buildStatics.resolveInferenceConfig({ llmClientFactory: fakeFactory }, []);
		harness.ok('an inactive scope mints NO client (plain build materializes)', plainRes.value && plainRes.value.llmClient === undefined);
		harness.equal('  and does NOT call the factory', factoryCalls, 1);

		// 4. a factory that THROWS (a keyless real client refusing at construction) -> refused BY NAME, as an
		//    error-object routed through the build callback, never a throw past it or a silent no-op.
		const throwingFactory = () => { throw new Error('llmClient: no Anthropic API key resolved'); };
		const refusedRes = buildStatics.resolveInferenceConfig({ llmClientFactory: throwingFactory }, ['ctdl']);
		harness.match('a keyless mint on an active --rebridge is REFUSED by name (no silent no-op)', refusedRes.error, /Anthropic reranker could not be constructed[\s\S]*no Anthropic API key/);
		harness.ok('  and yields no value (the build is refused, not run with a broken client)', refusedRes.value === undefined);

		// rebridgeScopeIsActive — the active/inactive predicate, gated directly.
		harness.ok("rebridgeScopeIsActive: 'all' is active", buildStatics.rebridgeScopeIsActive('all') === true);
		harness.ok("rebridgeScopeIsActive: ['ctdl'] is active", buildStatics.rebridgeScopeIsActive(['ctdl']) === true);
		harness.ok('rebridgeScopeIsActive: [] (default) is NOT active', buildStatics.rebridgeScopeIsActive([]) === false);

		stageEdgeCases();
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
		bridges: [{ source: 'lif', hub: 'ceds', dependencies: ['lif'], cacheMode: 'reuse', ...bridgeEntry }],
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
		loadOrDie(goodRecipe('lifOnly')),
		{
			xLog,
			standardsDatabase: standardsDatabase,
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
	return {
		nodes: [
			node('cls:assessment', {
				role: arr('DmeClass'),
				domainId: arr('C-Assessment'),
				canonicalKey: arr('C-Assessment'),
				name: arr('Assessment'),
			}),
			node('prop:status', {
				role: arr('DmeProperty'),
				domainId: arr('C-Assessment'),
				canonicalKey: arr('P-Status'),
				name: arr('Assessment Status'),
			}),
			node('os:status', {
				role: arr('DmeOptionSet'),
				rangeOptionSetId: arr('OS-Status'),
			}),
			node('ov:active', {
				role: arr('DmeOptionValue'),
				canonicalKey: arr('OV-Active'),
				name: arr('Active'),
			}),
			node('ov:closed', {
				role: arr('DmeOptionValue'),
				canonicalKey: arr('OV-Closed'),
				name: arr('Closed'),
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
const hubFoldingForger = (baseNodeEdges) => () => ({
	forge: ({ standard, version, deriveHub }, cb) => {
		let nodeEdges = baseNodeEdges;
		if (deriveHub) {
			// the production forger routes the RESOLVED bundle version (what the bundle READ) to the hub,
			// not the recipe token; this synthetic base stands in for a bundle read at `version`, so
			// bundleVersion === version here (the ground-truth forgeHub above uses the same value).
			const folded = foldHubIntoNodeEdges({
				standard,
				bundleVersion: version,
				requestedVersion: version,
				baseNodeEdges,
				declaredEmbeddingDims: baseNodeEdges.embeddingDims,
			});
			if (folded.error) {
				cb(folded.error);
				return;
			}
			nodeEdges = folded.nodeEdges;
		}
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
		});
	},
});

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
	const blockResult = (blockText, nodeCount, edgeCount) => ({
		blockText,
		blockId: contentAddress.blockIdForText(blockText),
		nodeCount,
		edgeCount,
		stableIdCoverage: null,
	});
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
				cb('', blockResult(blockText, selected.length, rt.edges.length));
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
	// block's hub set must reproduce (a base-only block would not).
	const expected = cedsHubForge({ hubVersion: '2' }).forgeHub(syntheticCedsBaseNodeEdges);
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
				'  the block node total is base + derived hub (5 base + refs + definition)',
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
		loadOrDie(goodRecipe('cedsLif')),
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
					stageMonomorphicCreate();
					return;
				}
				const testCase = faultCases[index];
				runBuildWith(
					loadOrDie(goodRecipe('cedsLif')),
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
	const capturingForger = () => ({
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
	});
	const deps = {
		xLog,
		standardsDatabase,
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
	buildLib.build(loadOrDie(goodRecipe('lifOnly')), deps, (err, result) => done({ err, result, captured }));
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

	runBuildWith(loadOrDie(goodRecipe('lifOnly')), { replayManager: recordingReplay }, ({ err, result }) => {
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
				loadOrDie(goodRecipe('cedsLif')),
				{
					xLog: capturingXLog(),
					standardsDatabase,
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
									harness.report();
								},
							);
						});
					});
				});
			});
		});
	});
};

stagePreflight();
