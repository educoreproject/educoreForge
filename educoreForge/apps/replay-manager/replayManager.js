'use strict';

// replayManager (STUB) — the single block<->graph boundary, both directions.
// In-process module; interface defined now, bodies stubbed. Async callback style.
//
//   replayManager() -> {
//     create(spec, callback)               -> ('', boltUrl)
//        spec.purpose: 'forge' (empty graph) | 'dependencyGraph' (spec.dependencies) |
//                      'materialize' (spec.manifestId)
//     extract(boltUrl, selector, callback) -> ('', { blockRef, selector, boltUrl })
//        selector: 'standardBase' | 'hub' | a relationship label (e.g. ':BRIDGEDRELATION:')
//     delete(boltUrl, callback)            -> ('')
//   }
//
// The real replayManager materializes graphs from blocks and harvests blocks from graphs. The stub
// mints deterministic placeholder bolt urls and block refs so the pipeline data-flow is observable.

let graphSeq = 0;
let blockSeq = 0;

const replayManager = () => {
	const create = (spec, callback) => {
		graphSeq += 1;
		const purpose = (spec && spec.purpose) || 'graph';
		callback('', `stub://graph/${purpose}/${graphSeq}`);
	};

	const extract = (boltUrl, selector, callback) => {
		blockSeq += 1;
		const tag = String(selector).replace(/[^A-Za-z0-9]+/g, '') || 'block';
		callback('', {
			blockRef: `stub-block:${tag}:${blockSeq}`,
			selector,
			boltUrl,
		});
	};

	const deleteGraph = (boltUrl, callback) => {
		callback('');
	};

	return { create, extract, delete: deleteGraph };
};

module.exports = replayManager;
