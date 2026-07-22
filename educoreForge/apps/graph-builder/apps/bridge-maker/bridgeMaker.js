'use strict';

/** @implements {BridgeMakerComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js; enforced by test-interfaces. */

// bridgeMaker (STUB) — runs a bridge module over a materialized dependency graph, writing new
// (labeled) relationships INTO the graph. In-process module; body stubbed. Async callback style.
//
//   bridgeMaker() -> { run({ inGraph, mapper, applyLabel }, callback) }
//     callback('', { inGraph, mapper, applyLabel, edgesWritten, note })
//
// The real bridgeMaker loads the mapper (source extractor + hub candidate finder + shared
// adjudicator, or a bespoke module) and labels the edges it authors with `label` so replayManager
// can harvest exactly those. The stub reports a placeholder result.

let seq = 0;

const bridgeMaker = () => {
	const run = ({ inGraph, mapper, applyLabel }, callback) => {
		seq += 1;
		callback('', {
			inGraph,
			mapper,
			applyLabel,
			edgesWritten: 0,
			note: `stub bridge #${seq}`,
		});
	};
	return { run };
};

module.exports = bridgeMaker;
