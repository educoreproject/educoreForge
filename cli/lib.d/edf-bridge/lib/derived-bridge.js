'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// derived-bridge.js — the -derived mode of bridgeMaker. STUB per DECISIONS-firstApp §18.
//
// We do not yet know the DESM crosswalk, so -derived is a STUB that NO-OPs. It wires the mode and
// its flags (--crosswalk, --source), reads --scope, and discovers NOTHING — it invents no crosswalk
// (§18: "the stub needs to discover nothing") and changes the graph by NOTHING. It logs a single
// stub line so the operator knows the tier ran and was intentionally inert.
//
// DELIBERATELY NOT ADDED (premature optimization, §18): a derivedCrosswalks declarative field on
// DmeStandardRoot. How a crosswalk's existence is signaled is [STILL-OPEN], to be answered WHEN
// derived bridging is actually built. The stub must not attempt to read or guess it.
//
// Async style: callback contract identical to the other makers (so the orchestrator's registry
// dispatch is uniform). No graph mutation, no neo4j calls at all.

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		const { xLog } = process.global;

		// bridge — { graphName, scope, owner, crosswalk?, source? } ->
		//   { stubbed: true, edgesMerged: 0, note }. NO-OP: no graph mutation, discovers nothing.
		const bridge = ({ graphName, scope, crosswalk, source }, callback) => {
			const note = 'derived: stubbed (DESM unknown)';
			xLog.status(
				`[derived-bridge] ${note} — scope='${scope}' graph='${graphName}' (no-op; crosswalk=${crosswalk || '(none)'}, source=${source || '(none)'}); discovers nothing, mutates nothing (DECISIONS-firstApp §18)`,
			);
			callback('', { stubbed: true, edgesMerged: 0, note });
		};

		return { bridge };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
