'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// schema-constraint-finisher.js — the FINISHER that creates Neo4j structural constraints from the
// vocabulary registry (SPEC-schemaEnforcementTenancy §3.1, "Structural constraints"). It reads the
// registry's UNIQUENESS_KEYS and emits the corresponding Neo4j constraints over the just-built graph —
// correct-by-construction over the MERGE the replay engine already does. NOTHING about the constraint set
// is hardcoded as a literal: the labels, properties, and node-role names all come from the registry.
//
// EDITION NOTE (code fact, verified this session): the forge graphs run Neo4j 5.26 COMMUNITY. Community
// supports UNIQUENESS constraints only (single + composite); property-EXISTENCE and NODE-KEY constraints
// are Enterprise-only. So this finisher creates UNIQUENESS constraints only; "required properties exist"
// (REQUIRED_PROPERTIES) is enforced by the producer-time schema validator (build-time validation,
// SPEC §3.1), not by a DB constraint here.
//
// The constraint set derived from the registry (UNIQUENESS_KEYS):
//   - (:ForgedNode) REQUIRE stableId IS UNIQUE                       (the forged-node MERGE key)
//   - (:HubReference) REQUIRE (hubName, addressSignature) IS UNIQUE  (WHITEPAPER §8 composite)
//   - (:HubDefinition) REQUIRE hubName IS UNIQUE                     (WHITEPAPER §8)
//
// Idempotent (CREATE CONSTRAINT ... IF NOT EXISTS). On a conformant graph creation succeeds with zero
// violations; on a graph carrying a duplicate the CREATE fails (the Phase-7 uniqueness-violation twin).
//
// Async style: qtools taskListPlus/pipeRunner; cypher at the leaf via the injected lifecycle. No
// async/await, no try/catch-for-control-flow. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// labels, property names, and constraint names are interpolated into Cypher (the label/identifier
// positions cannot be parameterized). Every value comes from the FROZEN registry, but we still validate
// each against a strict identifier regex so a future registry edit can never inject through that position.
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle, vocabulary } = {}) => {
		const { xLog } = process.global;
		const { UNIQUENESS_KEYS, NODE_LABELS, EQUIVALENCE_NODE_LABELS } = vocabulary;

		// derive the constraint specs FROM the registry (no hardcoded literals). props is always an array
		// (single-prop uniqueness is the one-element case); name is deterministic from label+props.
		const asArray = (oneKey) => (Array.isArray(oneKey) ? oneKey : [oneKey]);
		const constraintSpecs = [
			{
				label: NODE_LABELS.FORGED_NODE,
				props: asArray(UNIQUENESS_KEYS.STABLE_ID),
			},
			{
				label: EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
				props: asArray(UNIQUENESS_KEYS.HUB_REFERENCE),
			},
			{
				label: EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
				props: asArray(UNIQUENESS_KEYS.HUB_DEFINITION),
			},
		].map((oneSpec) => ({
			...oneSpec,
			// deterministic, registry-derived constraint name: unique_<label>_<prop1_prop2...>
			constraintName: `unique_${oneSpec.label}_${oneSpec.props.join('_')}`,
		}));

		// validate every interpolated token up front (defense; the values are frozen registry constants).
		const validateSpecIdentifiers = (oneSpec) => {
			if (!IDENTIFIER_RE.test(oneSpec.label)) {
				return `invalid label '${oneSpec.label}'`;
			}
			const badProp = oneSpec.props.find((oneProp) => !IDENTIFIER_RE.test(oneProp));
			if (badProp) {
				return `invalid property '${badProp}' on label '${oneSpec.label}'`;
			}
			if (!IDENTIFIER_RE.test(oneSpec.constraintName)) {
				return `invalid constraint name '${oneSpec.constraintName}'`;
			}
			return '';
		};

		// the REQUIRE clause: single-prop -> `n.prop`, composite -> `(n.p1, n.p2)`.
		const requireClause = (props) =>
			props.length === 1
				? `n.\`${props[0]}\``
				: `(${props.map((oneProp) => `n.\`${oneProp}\``).join(', ')})`;

		// Neo4j refuses to CREATE a uniqueness constraint while a STANDALONE index already covers the same
		// (label, properties) — and the replay engine creates a RANGE index (replay_reskey) on
		// (:ForgedNode {stableId}) for MERGE speed. So before creating each constraint, drop any standalone
		// index (owningConstraint IS NULL) on the exact (label, props): the constraint provides its OWN
		// equivalent backing index, so this REPLACES the replay range index with a uniqueness-enforcing one
		// (strictly better; lookups unaffected). Never touches constraint-backed or differently-keyed indexes
		// (e.g. the vector index on embedding, the LOOKUP indexes). replay-engine.js is NOT modified.
		const dropConflictingIndexes = (graphName, oneSpec, callback) => {
			const findCypher = `SHOW INDEXES YIELD name, labelsOrTypes, properties, owningConstraint
				WHERE labelsOrTypes = $labels AND properties = $props AND owningConstraint IS NULL
				RETURN collect(name) AS names`;
			lifecycle.runCypher(
				{ graphName, cypher: findCypher, params: { labels: [oneSpec.label], props: oneSpec.props } },
				(err, result) => {
					if (err) {
						callback(`finding conflicting index for '${oneSpec.constraintName}': ${err}`);
						return;
					}
					const names = ((result.records[0] || {}).names || []).filter((oneName) =>
						IDENTIFIER_RE.test(oneName),
					);
					const dropList = new taskListPlus();
					names.forEach((oneName) => {
						dropList.push((args, next) => {
							lifecycle.runCypher(
								{ graphName, cypher: `DROP INDEX \`${oneName}\` IF EXISTS` },
								(dropErr) => next(dropErr ? `dropping index '${oneName}': ${dropErr}` : '', args),
							);
						});
					});
					pipeRunner(dropList.getList(), {}, (dropErr) => callback(dropErr || '', names));
				},
			);
		};

		// ----- finish({ graphName }, cb) -> { summary, constraints:[names], specs }. Creates each constraint
		//   in registry order. A CREATE failure (e.g. a pre-existing uniqueness violation) surfaces as an
		//   error and aborts (NEVER swallowed) — that is exactly the uniqueness-violation twin's signal.
		const finish = ({ graphName } = {}, callback) => {
			const taskList = new taskListPlus();
			const created = [];

			constraintSpecs.forEach((oneSpec) => {
				taskList.push((args, next) => {
					const identErr = validateSpecIdentifiers(oneSpec);
					if (identErr) {
						next(`schema-constraint-finisher: ${identErr}`);
						return;
					}
					// drop any standalone index on the same (label, props) FIRST (the replay range index),
					// then create the uniqueness constraint (which supplies its own backing index).
					dropConflictingIndexes(graphName, oneSpec, (dropErr, dropped) => {
						if (dropErr) {
							next(`schema-constraint-finisher: ${dropErr}`);
							return;
						}
						if (dropped && dropped.length) {
							xLog.status(
								`[schema-constraint-finisher] dropped conflicting index/es [${dropped.join(', ')}] before '${oneSpec.constraintName}'`,
							);
						}
						const cypher = `CREATE CONSTRAINT \`${oneSpec.constraintName}\` IF NOT EXISTS FOR (n:\`${oneSpec.label}\`) REQUIRE ${requireClause(oneSpec.props)} IS UNIQUE`;
						lifecycle.runCypher({ graphName, cypher }, (err) => {
							if (err) {
								next(
									`schema-constraint-finisher: creating '${oneSpec.constraintName}' on (:${oneSpec.label}) failed: ${err}`,
								);
								return;
							}
							created.push(oneSpec.constraintName);
							next('', args);
						});
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					summary: `${created.length} uniqueness constraint(s): ${created.join(', ')}`,
					constraints: created,
					specs: constraintSpecs,
				});
			});
		};

		return { finish, constraintSpecs };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
