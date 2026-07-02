'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// finishing.js — the replayManager FINISHER REGISTRY (Phase 7; SPEC-schemaEnforcementTenancy §3.1/§3.3,
// PLAN Phase 7). A modular, ORDERED, pluggable set of finisher steps that run AFTER the generic graph
// BUILD (replay) and are owned by replayManager. The manifest carries NOTHING schema-related; schema is
// sourced from the vocabulary registry (schema-as-code, single source of truth). graph-builder.js calls
// applyFinishers() in its buildGraph pipeline AFTER replay and BEFORE ownerStamp+stampProvenance, so any
// :ForgedNode a finisher emits is naturally owner-stamped and counted in the provenance passport, and any
// finisher-emitted edge (carrying provenanceTier) keeps provenanceTierComplete true — every existing build
// invariant is preserved automatically. replay-engine.js is NOT touched.
//
// THE REGISTRY is an ORDERED ARRAY (not a switch): each entry is one pluggable finisher module with its
// own enabled toggle. A GLOBAL skip switch (skipFinishing) yields a raw/unconstrained graph (no finisher
// output at all). A per-finisher disabled list switches individual finishers off.
//
// Each finisher module exposes: finish({ graphName }, callback) -> callback(err, { summary, ... }). Finishers
// are DETERMINISTIC functions of the vocabulary registry + the built graph (no clock, no randomness), so two
// builds with the same registry + content produce byte-identical finisher output.
//
// Async style: qtools taskListPlus/pipeRunner; cypher resolves at the leaf via the injected lifecycle. No
// async/await, no try/catch-for-control-flow, no Promises surfaced. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const CORE_LIB = path.join(__dirname, '..');
const vocabulary = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		const { xLog } = process.global;

		// ----- instantiate the pluggable finisher modules (registry members). Each receives the injected
		//   lifecycle (its cypher chokepoint) and the frozen vocabulary registry (schema-as-code). NEW
		//   finishers are added to the ORDERED array below; nothing else changes.
		const schemaViewFinisher = require('./lib/schema-view-finisher')({
			lifecycle,
			vocabulary,
		});
		const schemaConstraintFinisher = require('./lib/schema-constraint-finisher')({
			lifecycle,
			vocabulary,
		});

		// ----- THE ORDERED REGISTRY. Order is significant and explicit (top-to-bottom run order). `enabled`
		//   is the per-finisher toggle. The self-describing schema-VIEW finisher runs FIRST so its emitted
		//   :ForgedNode:SchemaView nodes exist before the schema-CONSTRAINT finisher creates the uniqueness
		//   constraints (which then cover the view nodes too).
		const REGISTRY = [
			{
				name: 'schemaView',
				enabled: true,
				finisher: schemaViewFinisher,
			},
			{
				name: 'schemaConstraints',
				enabled: true,
				finisher: schemaConstraintFinisher,
			},
		];

		// ----- applyFinishers({ graphName, skipFinishing?, disabled? }, cb) -> { skipped, applied:[{name,...}] }.
		//   Runs each ENABLED, non-disabled finisher IN REGISTRY ORDER. The GLOBAL skip switch short-circuits
		//   the whole phase (a raw graph). A finisher error aborts the phase and surfaces (NEVER swallowed).
		const applyFinishers = ({ graphName, skipFinishing, disabled = [] } = {}, callback) => {
			if (skipFinishing) {
				xLog.status(
					`[finishing] SKIPPED (global skip switch) — raw/unconstrained graph '${graphName}'`,
				);
				callback('', { skipped: true, applied: [] });
				return;
			}

			const active = REGISTRY.filter(
				(oneEntry) => oneEntry.enabled && disabled.indexOf(oneEntry.name) === -1,
			);

			const taskList = new taskListPlus();
			const applied = [];

			active.forEach((oneEntry) => {
				taskList.push((args, next) => {
					oneEntry.finisher.finish({ graphName }, (err, result) => {
						if (err) {
							next(`[finishing] finisher '${oneEntry.name}' failed: ${err}`);
							return;
						}
						applied.push({ name: oneEntry.name, ...result });
						xLog.status(
							`[finishing] applied '${oneEntry.name}': ${(result && result.summary) || ''}`,
						);
						next('', args);
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', { skipped: false, applied });
			});
		};

		return {
			applyFinishers,
			// exposed for the gate of record / introspection (the ordered registry + its toggles)
			REGISTRY,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
