#!/usr/bin/env node
'use strict';

// test-replay-entry.js — a STANDING gate for replay()'s own entry behavior.
//
// replay() is called from exactly one place and, until this suite, no discoverable test exercised
// it at all: its correctness rested entirely on the deliberate integration script, which
// runAllTests never runs. An adversarial review named that gap; this closes the part of it that
// can be closed without a database.
//
// Everything gated here happens BEFORE any bolt traffic — deserialize, then the shared write
// path's guards — so the bolt URI below points nowhere on purpose. neo4j-driver connects lazily
// (code fact), so a refusal that arrives without a connection is itself the proof that nothing
// was written.
//
// The per-block sourceLabel wiring is the thing that matters most here: replay() hands
// writeShapedGraph ONE GROUP PER BLOCK so that a guard failure in a fifty-block golden manifest
// names WHICH block offended. That is easy to break silently and invisible in unit tests of the
// validator alone.
//
// Run: node lib/replay/test/test-replay-entry.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for replay()'s deserialize + guard entry paths

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves replay() refuses a corrupt manifest entry by name, refuses a well-formed block whose
     content violates a pre-write guard, and that both refusals identify the offending block.
     No docker, no Neo4j -- the bolt URI is unreachable by design and never reached.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const { replay } = require('../replay-engine');
const replayBlock = require('../replay-block');

// deliberately unreachable: port 1 is not something we will ever be listening on
const NOWHERE = { boltUri: 'bolt://localhost:1', password: 'unused' };

const header = {
	blockType: 'standardBase',
	standardKey: 'LIF',
	version: '1',
	stableUriPropertyName: 'uri',
	resolutionKey: 'uri',
};

const blockTextWith = (nodes, edges) =>
	replayBlock.serializeBlock({ header, nodes: nodes || [], edges: edges || [] });

const shapedNode = (stableId, labels) => ({
	ref: { source: 'LIF', id: stableId },
	labels: labels || ['ForgedNode', 'DmeClass'],
	stableId,
	properties: { uri: [stableId] },
});

// =====================================================================
harness.section('CORRUPT MANIFEST ENTRY — refused by name, nothing written');
// =====================================================================

let corruptErr = null;
replay({ manifest: ['this is not a schema block'], ...NOWHERE }, (err) => {
	corruptErr = err;
});

const waitFor = (getValue, done) => {
	const poll = () => {
		if (getValue() !== null) {
			done();
			return;
		}
		setTimeout(poll, 5);
	};
	poll();
};

waitFor(
	() => corruptErr,
	() => {
		harness.match('a corrupt manifest entry is REFUSED', corruptErr, /deserialize failed/);
		harness.match('  naming which manifest entry', corruptErr, /manifest\[0\]/);
		harness.match('  and stating nothing was written', corruptErr, /No writes performed/);

		// ==============================================================
		harness.section('GUARD FAILURE THROUGH replay() — the offending BLOCK is named');
		// ==============================================================
		// The block is well-formed, so deserialize succeeds; its CONTENT violates the ForgedNode
		// guard. The refusal must travel out of the shared write path carrying replay()'s
		// per-block sourceLabel.

		let guardErr = null;
		replay(
			{
				manifest: [
					blockTextWith([shapedNode('urn:good')]),
					blockTextWith([shapedNode('urn:bad', ['DmeClass'])]),
				],
				...NOWHERE,
			},
			(err) => {
				guardErr = err;
			},
		);

		waitFor(
			() => guardErr,
			() => {
				harness.match(
					'a block whose node lacks ForgedNode is REFUSED',
					guardErr,
					/ForgedNode enforcement/,
				);
				harness.match('  naming the offending manifest index', guardErr, /manifest\[1\]/);
				harness.match('  naming the offending block', guardErr, /standardBase LIF v1/);
				harness.match('  naming the offending node', guardErr, /urn:bad/);
				harness.ok(
					'  and NOT naming the clean block',
					guardErr.indexOf('manifest[0]') === -1,
					guardErr,
				);
				harness.match('  and stating nothing was written', guardErr, /No writes performed/);

				harness.report();
			},
		);
	},
);
