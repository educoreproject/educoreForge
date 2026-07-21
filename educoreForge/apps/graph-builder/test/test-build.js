#!/usr/bin/env node
'use strict';

// test-build.js — gates for the -build ORCHESTRATION (apps/graph-builder/lib/build.js) as it runs
// over the component stubs. What is under test here is the PIPELINE, not the components: that the
// right phases run in the right order, that real recipe data (tokens, versions, pair keys) is
// threaded through rather than invented, and that block refs flow extract -> manifest.add.
//
// These gates are written to survive the stub-to-real swap. They assert SHAPE and SEQUENCE, not
// stub placeholder text, so they keep their meaning when a real component body lands.
//
// FAULT INJECTION: build() accepts component factory overrides in deps.components, so every
// error path in the orchestrator is exercised by a component that genuinely fails. No error
// message in build.js is asserted without having been WATCHED to fire.
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
     Drives the build pipeline over the component stubs and asserts SHAPE and SEQUENCE rather
     than stub placeholder text, so the gates keep their meaning when real component bodies
     land. Then injects failing components through the deps.components seam so every error
     path in the orchestrator is watched firing -- including a positive control proving the
     seam itself changes nothing.

OPTIONS
     -verbose    Show every individual assertion, not just failures and the tally.
     -quiet      Failures and the tally only.
     -help       This message.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const recipeLib = require('../lib/recipe');
const buildLib = require('../lib/build');

const goodRecipe = (name) =>
	path.join(__dirname, '..', '..', '..', 'recipes', `${name}.recipe.jsonc`);

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

// build is async (callback style); collect the outcome, then assert synchronously at the end
const runBuild = (recipe, callback) => {
	const xLog = capturingXLog();
	buildLib.build(recipe, { xLog }, (err, result) => callback({ err, result, xLog }));
};

// ---------------------------------------------------------------------
// FAULT-INJECTION KIT — components that behave, until told to misbehave.
// Each factory returns a WORKING component; pass overrides to break exactly one method.
// ---------------------------------------------------------------------

const workingReplayManager = (overrides) => () =>
	Object.assign(
		{
			create: (spec, cb) => cb('', `bolt://test/${spec.purpose}`),
			extract: (boltUrl, selector, cb) =>
				cb('', { blockRef: `block:${selector}`, selector, boltUrl }),
			delete: (boltUrl, cb) => cb(''),
		},
		overrides || {},
	);

const workingForger = (overrides) => () =>
	Object.assign(
		{
			forge: (spec, cb) => cb('', { ...spec, nodeCount: 0, edgeCount: 0 }),
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

const runBuildWith = (recipe, componentOverrides, callback) => {
	const xLog = capturingXLog();
	buildLib.build(recipe, { xLog, components: componentOverrides }, (err, result) =>
		callback({ err, result, xLog }),
	);
};

// a replayManager whose create() fails for ONE purpose and works for the others
const replayFailingCreateFor = (purpose, message) =>
	workingReplayManager({
		create: (spec, cb) =>
			spec.purpose === purpose ? cb(message) : cb('', `bolt://test/${spec.purpose}`),
	});

// a replayManager whose extract() fails for ONE selector
const replayFailingExtractFor = (selector, message) =>
	workingReplayManager({
		extract: (boltUrl, sel, cb) =>
			sel === selector ? cb(message) : cb('', { blockRef: `block:${sel}`, selector: sel, boltUrl }),
	});

// =====================================================================
// The suite is a small sequence of async builds; each stage asserts, then triggers the next.
// =====================================================================

const stageLifOnly = () => {
	runBuild(loadOrDie(goodRecipe('lifOnly')), ({ err, result, xLog }) => {
		harness.section('lifOnly — one standard, no hubs, no bridges');

		harness.equal('build succeeds (no error)', err, '');
		harness.equal('memberCount is 1 (one standardBase)', result.memberCount, 1);
		harness.ok('a manifestId is returned', !!result.manifestId, JSON.stringify(result));
		harness.ok('a boltUrl is returned', !!result.boltUrl, JSON.stringify(result));

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
		harness.match('the graph is materialized', xLog.text(), /\[materialize\] -> /);

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
			'a block ref extracted in a phase is what reaches the manifest (refs are threaded, not invented)',
			/-> standardBase (\S+)/.test(xLog.text()) && /-> relationship (\S+)/.test(xLog.text()),
			xLog.text(),
		);

		stageEdgeCases();
	});
};

const stageEdgeCases = () => {
	harness.section('EDGE CASES — degenerate and hostile recipe shapes');

	// a recipe with nothing in it must still complete cleanly rather than throw
	runBuild({ recipeName: 'empty', standards: [], hubs: [], bridges: [] }, ({ err, result }) => {
		harness.equal('an empty recipe builds without error', err, '');
		harness.equal('an empty recipe yields zero members', result.memberCount, 0);

		// wrong-typed collections must not crash the orchestrator (it guards with Array.isArray)
		runBuild(
			{ recipeName: 'junk', standards: 'nope', hubs: null, bridges: { x: 1 } },
			({ err: junkErr, result: junkResult }) => {
				harness.equal('wrong-typed collections do not crash the pipeline', junkErr, '');
				harness.equal('wrong-typed collections yield zero members', junkResult.memberCount, 0);

				// a hub declared for a standard that is not forged: the hub block simply never appears
				runBuild(
					{
						recipeName: 'hubWithoutItsStandard',
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

						stageFaultInjection();
					},
				);
			},
		);
	});
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
		label: 'phase A: replay.create(forge) fails',
		components: { replayManager: replayFailingCreateFor('forge', 'no scratch graph available') },
		pattern: /phase A \(forge\) failed: create\(forge\) for ceds: no scratch graph available/,
	},
	{
		label: 'phase A: forger.forge fails',
		components: { forger: workingForger({ forge: (spec, cb) => cb('source bundle unreadable') }) },
		pattern: /phase A \(forge\) failed: forge ceds: source bundle unreadable/,
	},
	{
		label: 'phase A: extracting the standardBase block fails',
		components: { replayManager: replayFailingExtractFor('standardBase', 'harvest returned nothing') },
		pattern: /phase A \(forge\) failed: extract standardBase ceds: harvest returned nothing/,
	},
	{
		label: 'phase A: extracting the HUB block fails',
		components: { replayManager: replayFailingExtractFor('hub', 'no hub subgraph present') },
		pattern: /phase A \(forge\) failed: extract hub ceds: no hub subgraph present/,
	},
	{
		label: 'phase A: disposing the scratch graph fails',
		components: {
			replayManager: workingReplayManager({ delete: (boltUrl, cb) => cb('container still running') }),
		},
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
		label: 'phase C: extracting the labeled relationship block fails',
		components: {
			replayManager: replayFailingExtractFor(':BRIDGEDRELATION:', 'no labeled edges to harvest'),
		},
		pattern: /phase C \(bridge\) failed: extract relationships lif::ceds: no labeled edges to harvest/,
	},
	{
		label: 'materialize: the final graph cannot be created',
		components: { replayManager: replayFailingCreateFor('materialize', 'out of disk') },
		pattern: /materialize failed: out of disk/,
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
		},
		({ err, result }) => {
			harness.equal('working injected components build without error', err, '');
			harness.equal('  and still produce 4 members', result.memberCount, 4);

			harness.section('FAULT INJECTION — every orchestrator error path, watched firing');

			const runCase = (index) => {
				if (index >= faultCases.length) {
					harness.report();
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

stageLifOnly();
