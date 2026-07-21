'use strict';

// forger (STUB) — forges ONE standard's source into a materialized graph.
// In-process module; interface defined now, body stubbed. Async callback style (err-string, result).
//
//   forger() -> { forge({ standard, version, source?, destination }, callback) }
//     callback('', { standard, version, destination, nodeCount, edgeCount, note })
//
// The real forger resolves the per-standard bundle (forges/<STD>/forge.js), parses the source,
// and materializes the standardBase graph at `destination`. The stub reports a placeholder result.

let seq = 0;

const forger = () => {
	const forge = ({ standard, version, source, destination }, callback) => {
		seq += 1;
		callback('', {
			standard,
			version,
			source: source || '(bundle default)',
			destination,
			nodeCount: 0,
			edgeCount: 0,
			note: `stub forge #${seq}`,
		});
	};
	return { forge };
};

module.exports = forger;
