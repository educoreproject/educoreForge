'use strict';

/** The stub implementations here conform to the SAME formal contracts as the real components
 *  ({ForgerComponent}, {ReplayManagerComponent}, {BridgeMakerComponent}, {ManifestEditorComponent}
 *  — declared in ../interfaces.js) except for return-value REALITY, not shape. test-interfaces
 *  enforces the conformance on both sides, so stub/real drift turns the suite red. */

// stub-components — the ORCHESTRATOR's stub-era scaffolding, gathered in one place.
//
// These stubs were born inside the component modules; they moved HERE (2026-07-21) the moment the
// components started growing real bodies. The stubs were always graphBuilder's scaffolding — a way
// to observe the pipeline's data flow before the components existed — not the components' identity.
// A real forger that provisions Docker and spends Voyage credit must NEVER run inside `npm test`;
// the pipeline keeps using these until EVERY component is real, at which point build.js flips its
// defaultComponents to the real modules and this file is deleted.
//
// bridgeMaker is still a stub IN its module, so it is required from there (one source of truth);
// forger, replayManager and manifestEditor have real bodies now, so their stub-era behaviors live
// here verbatim.

let graphSeq = 0;
let blockSeq = 0;
let forgeSeq = 0;
let manifestSeq = 0;

// stub forger — reports a placeholder result without parsing, embedding, or writing anything.
const forger = () => {
	const forge = (spec, callback) => {
		const { standard, version, source } = spec || {};
		forgeSeq += 1;
		// A stub that INVENTS content would let the orchestrator look correct while carrying
		// nothing, so it returns an honestly empty nodeEdges of the right SHAPE.
		callback('', {
			standard,
			version,
			source: source || '(bundle default)',
			nodeEdges: { nodes: [], edges: [], embeddingDims: null },
			nodeCount: 0,
			edgeCount: 0,
			note: `stub forge #${forgeSeq}`,
		});
	};
	return { forge };
};

// stub replayManager — mints deterministic placeholder bolt urls and schema block ids so the pipeline
// data-flow is observable.
const replayManager = () => {
	const create = (spec, callback) => {
		graphSeq += 1;
		const purpose = (spec && spec.purpose) || 'graph';
		callback('', `stub://graph/${purpose}/${graphSeq}`);
	};

	// stub init — reports what it was handed so the pipeline's data flow stays observable, and
	// counts nothing it was not given (a stub that invents numbers is worse than no stub).
	const init = (spec, callback) => {
		const { nodeEdges, schemaBlocks, applyLabels } = spec || {};
		callback('', {
			nodesMerged: nodeEdges ? nodeEdges.nodes.length : 0,
			edgesMerged: nodeEdges ? nodeEdges.edges.length : 0,
			schemaBlockCount: schemaBlocks ? schemaBlocks.length : 0,
			appliedLabels: applyLabels || [],
			note: 'stub init',
		});
	};

	const harvest = (spec, callback) => {
		const { inGraph, selectionLabels } = spec || {};
		blockSeq += 1;
		const tag = (selectionLabels || []).join('') || 'block';
		callback('', {
			blockId: `stub-block:${tag}:${blockSeq}`,
			selectionLabels,
			inGraph,
		});
	};

	const deleteGraph = (boltUrl, callback) => {
		callback('');
	};

	return { create, init, harvest, delete: deleteGraph };
};

// stub manifestEditor — the accumulator the orchestrator was built against, moved here VERBATIM
// (2026-07-22) when the module grew its real body. It keeps members in memory and mints a
// placeholder manifest id; the real one requires a store, demands a description on every member,
// and writes each schema block through on add. build.js still composes with block IDS rather than
// schema BLOCKS, so it cannot yet drive the real editor — flipping it is the end-to-end milestone,
// not this one, and a pipeline that half-flipped would prove less than either state.
const manifestEditor = () => {
	const init = (name, recipe) => {
		manifestSeq += 1;
		const manifestId = `stub-manifest:${name || 'unnamed'}:${manifestSeq}`;
		const members = [];
		const recipeName = recipe && recipe.recipeName ? recipe.recipeName : name;
		return {
			add: (key, kind, blockRef) => {
				members.push({ key, kind, blockRef });
				return members.length;
			},
			id: () => manifestId,
			members: () => members.slice(),
			recipeName: () => recipeName,
		};
	};

	// The real open() reads a stored manifest. A stub with no store has nothing to read, and a stub
	// that invented a membership would let a caller believe it had reopened something.
	const open = ({ manifestRefId }, callback) => {
		callback(
			`stub manifestEditor.open '${manifestRefId}': there is no store behind this stub, so ` +
				`there is nothing to open. Use the real manifestEditor.`,
		);
	};

	return { init, open };
};

module.exports = {
	forger,
	replayManager,
	bridgeMaker: require('../apps/bridge-maker'),
	manifestEditor,
};
