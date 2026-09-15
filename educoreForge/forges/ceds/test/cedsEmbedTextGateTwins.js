'use strict';

// cedsEmbedTextGateTwins.js — the fault injection that proves gate E-1 of
// gates/cedsEmbedTextGates.jsonc BITES (PHASE P5, embedText-091426).
//
// WHY A SEPARATE REGISTRY (R-ET-34): the E-1 declaration lives outside cedsFidelityGates.jsonc so
// the live -cedsGates action never reads it, and lib/roundTripGateTwins.js is audited for orphans
// against the fidelity file alone (test-cedsGates.js). A twin for E-1 added there would read as an
// orphan. So E-1's twin lives beside the only test that reads E-1.
//
// WHAT THE TWIN PROVES, STATED HONESTLY (the lib/roundTripGateTwins.js caveat, kept): it injects at
// the MEASURE BOUNDARY, so it proves only that E-1's comparison bites. That the measure itself goes
// false when a text node reaches emission is proven at the DATA level in test-cedsRoundTrip.js,
// which admits DmeEmbedText through the selection double and watches the real diff report the
// invention. Neither proves the production Cypher allowlist; P7's live run does.
//
// Same contract as lib/roundTripGates.js runTwins: ({ measurements, gate }) -> measurements, over
// a deep clone. Pure, synchronous, no I/O.

const path = require('path');

const moduleName = path.basename(__filename).replace(/\.js$/, '');

const moduleFunction = () => {
	const twinRegistry = {
		// E-1: the selection admits the text node's role, so the text node is emitted as a class,
		// its statements read as invention and the with/without runs stop being identical.
		admitEmbedTextRole: ({ measurements }) => {
			if (measurements && measurements.probe) {
				measurements.probe.embedTextExcludedFromEmission = false;
			}
			return measurements;
		},
	};

	// auditRegistryAgainst — every declared twin exists here; nothing here outlives its gate.
	const auditRegistryAgainst = ({ declarations } = {}, callback) => {
		if (!declarations || !Array.isArray(declarations.gates)) {
			callback(`${moduleName}.auditRegistryAgainst: declarations are REQUIRED.`);
			return;
		}
		const missing = declarations.gates
			.filter((oneGate) => typeof twinRegistry[oneGate.twin] !== 'function')
			.map((oneGate) => `${oneGate.id} -> '${oneGate.twin}'`);
		const declaredTwinNameList = declarations.gates.map((oneGate) => oneGate.twin);
		const orphaned = Object.keys(twinRegistry).filter(
			(oneTwinName) => declaredTwinNameList.indexOf(oneTwinName) === -1,
		);
		callback('', { missing, orphaned });
	};

	return { twinRegistry, auditRegistryAgainst };
};

module.exports = moduleFunction;
