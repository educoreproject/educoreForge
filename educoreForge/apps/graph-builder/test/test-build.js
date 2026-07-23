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
		saveBlock: ({ text, kind, subjectRefId, producedBy }, cb) => {
			const refId = contentAddress.blockIdForText(text);
			const alreadyPresent = !!savedBlocks[refId];
			savedBlocks[refId] = { text, refId, kind, subjectRefId, producedBy };
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
// manifest never collide on their content address, and shaped as PG-JSONL (header line first)
// because that is what a schema block IS.
const doubleBlockText = (header, selectionLabels) =>
	`${JSON.stringify({ ...header, selectionLabels })}\n` +
	`{"stableId":"${header.standardKey}/${(selectionLabels || []).join('')}","labels":${JSON.stringify(selectionLabels || [])}}\n`;

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

const workingForger = (overrides) => () =>
	Object.assign(
		{
			forge: ({ standard, version }, cb) =>
				cb('', {
					standard,
					version,
					nodeEdges: { nodes: [], edges: [], embeddingDims: null },
					nodeCount: 0,
					edgeCount: 0,
					embedCallCount: 0,
				}),
		},
		overrides || {},
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
const workingManifestEditor = (overrides) => () =>
	Object.assign(
		{
			init: ({ name, description, recipe, standardsDatabase }) => {
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
						const { subjectRefId, kind, description: memberDescription, schemaBlock } = spec;
						if (typeof subjectRefId !== 'string' || subjectRefId.trim() === '') {
							cb(`manifestEditor.add: a subjectRefId is REQUIRED`);
							return;
						}
						if (typeof kind !== 'string' || kind.trim() === '') {
							cb(`manifestEditor.add '${subjectRefId}': a kind is REQUIRED`);
							return;
						}
						if (typeof memberDescription !== 'string' || memberDescription.trim() === '') {
							cb(`manifestEditor.add '${subjectRefId}': a description is REQUIRED`);
							return;
						}
						if (!schemaBlock || typeof schemaBlock.blockText !== 'string') {
							cb(
								`manifestEditor.add '${subjectRefId}': a schemaBlock carrying blockText is ` +
									`REQUIRED — an id is not a schema block`,
							);
							return;
						}
						members.push({
							subjectRefId,
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
								text: `restored ${oneMember.subjectRefId}`,
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
const manifestFailingAddFor = (kind, message) => () => {
	const working = workingManifestEditor()();
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
const manifestWithHandleOverride = (handleOverrides) => () => {
	const working = workingManifestEditor()();
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
			/\[A\] forge lif@current -> standardBase /,
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
			'memberCount is 4 (2 standardBase + 1 hub + 1 relationship)',
			result.memberCount,
			4,
		);

		harness.match('ceds is forged', xLog.text(), /\[A\] forge ceds@current -> standardBase /);
		harness.match('lif is forged', xLog.text(), /\[A\] forge lif@current -> standardBase /);
		harness.match('the declared hub yields a hub block', xLog.text(), /\[B\] hub block ceds -> /);
		harness.match(
			'the bridge is keyed by its source::hub pairing',
			xLog.text(),
			/\[C\] bridge lif::ceds /,
		);
		harness.match(
			'the bridge names the mapper it ran',
			xLog.text(),
			/\[C\] bridge lif::ceds \(mapper=/,
		);
		// THE POSITIVE CONTROL. `bridge.mapper || 'defaultSemantic'` also satisfied the assertion
		// above, which is exactly why it survived: "names A mapper" and "names THE RECIPE'S
		// mapper" are different claims. cedsLif authors its mapper now, and this insists the
		// build ran that one.
		harness.match(
			'the mapper it ran is the one THE RECIPE named, not one the code chose',
			xLog.text(),
			/\[C\] bridge lif::ceds \(mapper=lifIntoCedsSemantic\)/,
		);
		harness.ok(
			'no in-code mapper name survives in build.js to stand behind the recipe key',
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
			'phases run in order: A, B(hub), A, C, compose, materialize',
			sequence,
			'A,B,A,C,compose,materialize',
		);

		harness.ok(
			'a schema block address harvested in a phase is what reaches the manifest (addresses are threaded, not invented)',
			/-> standardBase (\S+)/.test(xLog.text()) && /-> relationship (\S+)/.test(xLog.text()),
			xLog.text(),
		);

		stageEdgeCases();
	});
};

const stageEdgeCases = () => {
	harness.section('EDGE CASES — degenerate and hostile recipe shapes');

	// build() is reachable with a recipe object that never went through validateRecipe — this
	// suite does it on every line below — so the schema's `required: mapper` is not the only
	// place the absence can arrive. A bridge with no mapper used to run 'defaultSemantic' here.
	const bridgeRecipe = (bridge) => ({
		recipeName: 'bridgeMapperProbe',
		description: 'one bridge, whatever mapper it was given',
		standards: [{ token: 'lif', version: 'current' }],
		hubs: [],
		bridges: [{ source: 'lif', hub: 'ceds', dependencies: ['lif'], cacheMode: 'reuse', ...bridge }],
	});

	runBuild(bridgeRecipe({}), ({ err }) => {
		harness.match(
			'a bridge with NO mapper is refused by name — nothing is substituted',
			err,
			/bridge lif::ceds: mapper is not named[\s\S]*no default/,
		);

		runBuild(bridgeRecipe({ mapper: '   ' }), ({ err: blankErr }) => {
			harness.match(
				'a BLANK mapper is refused too, quoting what was given',
				blankErr,
				/bridge lif::ceds: mapper is "   "/,
			);

			runBuild(bridgeRecipe({ mapper: 'bespokeMapper' }), ({ err: goodErr, xLog: goodLog }) => {
				harness.equal('a NAMED mapper builds — the positive control', goodErr, '');
				harness.match(
					'and the build ran exactly the mapper it was handed',
					goodLog.text(),
					/\[C\] bridge lif::ceds \(mapper=bespokeMapper\)/,
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
				'  keyed by the subject, resolved standardName@version',
				standardsDatabase.savedBlocks[storedRefIds[0]].subjectRefId,
				'lif@current',
			);
			harness.equal(
				'  and the stored address IS sha256 of the block text (harvest minted it, add re-derived it)',
				storedRefIds[0],
				contentAddress.blockIdForText(standardsDatabase.savedBlocks[storedRefIds[0]].text),
			);

			harness.note(
				'DECLARED GAP — a hub contributes a SECOND schema block under the SAME subject key\n' +
					'(targetArchitectureDesign §2/§4.4: both are keyed standardName@version), and the real\n' +
					'manifestEditor refuses a repeated subjectRefId. A hub recipe therefore cannot compose\n' +
					'against the real editor today. The hub step is out of scope for this remediation\n' +
					'(implementationPlan_remediation_072326 §11); the collision is recorded, not papered over.',
			);

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
		pattern: /phase A \(forge\) failed: add standardBase ceds@current: standardsDatabase write refused/,
	},
	{
		label: 'phase A: harvesting the HUB schema block fails',
		components: { replayManager: replayFailingHarvestFor('HubReference', 'no hub subgraph present') },
		pattern: /phase A \(forge\) failed: harvest hub ceds: no hub subgraph present/,
	},
	{
		label: 'phase A: recording the HUB member fails',
		components: { manifestEditor: manifestFailingAddFor('hub', 'subject already present') },
		pattern: /phase A \(forge\) failed: add hub ceds@current: subject already present/,
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
		components: { bridgeMaker: workingBridgeMaker({ run: (spec, cb) => cb('mapper not found') }) },
		pattern: /phase C \(bridge\) failed: bridge lif::ceds: mapper not found/,
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
							spec.schemaBlocks !== undefined
								? cb('content address verification failed')
								: working.init(spec, cb),
					});
			})(),
		},
		pattern: /materialize failed: loading 4 schema block\(s\): content address verification failed/,
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
			harness.equal('  and still produce 4 members', result.memberCount, 4);

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

			harness.report();
		});
	});
};

stagePreflight();
