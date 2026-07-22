'use strict';

// stub-components — the ORCHESTRATOR's stub-era scaffolding, gathered in one place.
//
// These stubs were born inside the component modules; they moved HERE (2026-07-21) the moment the
// components started growing real bodies. The stubs were always graphBuilder's scaffolding — a way
// to observe the pipeline's data flow before the components existed — not the components' identity.
// A real forger that provisions Docker and spends Voyage credit must NEVER run inside `npm test`;
// the pipeline keeps using these until EVERY component is real, at which point build.js flips its
// defaultComponents to the real modules and this file is deleted.
//
// bridgeMaker and manifestEditor are still stubs IN their modules, so they are required from there
// (one source of truth); forger and replayManager have real bodies now, so their stub-era
// behaviors live here verbatim.

let graphSeq = 0;
let blockSeq = 0;
let forgeSeq = 0;

// stub forger — reports a placeholder result without parsing, embedding, or writing anything.
const forger = () => {
	const forge = ({ standard, version, source, destination }, callback) => {
		forgeSeq += 1;
		callback('', {
			standard,
			version,
			source: source || '(bundle default)',
			destination,
			nodeCount: 0,
			edgeCount: 0,
			note: `stub forge #${forgeSeq}`,
		});
	};
	return { forge };
};

// stub replayManager — mints deterministic placeholder bolt urls and block refs so the pipeline
// data-flow is observable.
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

module.exports = {
	forger,
	replayManager,
	bridgeMaker: require('../apps/bridge-maker'),
	manifestEditor: require('../apps/manifest-editor'),
};
