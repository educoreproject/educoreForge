'use strict';

const path = require('path');

// Phase-7 standing gate (the schema-constraint FINISHER output). Asserts the golden carries the structural
// uniqueness constraints the schema-constraint finisher derives from the vocabulary registry's
// UNIQUENESS_KEYS: (:ForgedNode) stableId UNIQUE; (:HubReference) (hubName,addressSignature) UNIQUE;
// (:HubDefinition) hubName UNIQUE. (Neo4j Community = uniqueness-only; property-existence is enforced by the
// schema-validator gate 23, not a DB constraint.) The constraint set is read from the finisher itself, so
// this gate and the finisher cannot drift.
//
// ENFORCED (expectFail:false) at the Phase-7 re-freeze (GOLDEN_BEACON 2026-06-30): the baselines/targets were
// rebuilt WITH the finishing phase, so the golden now carries the 3 uniqueness constraints. Its build-time
// TWIN (inject a duplicate stableId upstream -> CREATE CONSTRAINT fails) is proven by the gate of record
// test/phase7Finishers.js (constraintViolationTwin). Flipped from expectFail:true, mirroring gates 18/22.

const CORE_LIB = path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');
const vocabulary = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const schemaConstraintFinisher = require(
	path.join(CORE_LIB, 'finishing', 'lib', 'schema-constraint-finisher'),
)({ lifecycle: null, vocabulary });

module.exports = () => ({
	name: 'finisher.schemaConstraintsPresent',
	phase: 'Phase7',
	kind: 'positive',
	expectFail: false, // ENFORCED at the Phase-7 re-freeze (targets rebuilt WITH the finishing phase)
	run: (ctx, callback) => {
		const expectedNames = schemaConstraintFinisher.constraintSpecs.map((oneSpec) => oneSpec.constraintName);
		ctx.resources.lifecycle.runCypher(
			{
				graphName: ctx.candidateGraphName,
				cypher: 'SHOW CONSTRAINTS YIELD name RETURN collect(name) AS names',
			},
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `SHOW CONSTRAINTS error: ${err}` });
					return;
				}
				const present = new Set((result.records[0] || {}).names || []);
				const missing = expectedNames.filter((oneName) => !present.has(oneName));
				const passed = missing.length === 0;
				callback('', {
					passed,
					detail: `constraints present=[${[...present].sort().join(',')}]; expected=[${expectedNames.join(',')}]; missing=[${missing.join(',')}] (REQUIRED: all present — finishing phase ran)`,
				});
			},
		);
	},
});
