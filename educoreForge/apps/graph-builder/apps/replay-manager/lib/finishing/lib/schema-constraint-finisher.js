'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// schema-constraint-finisher.js — registry member 2, mode 'apply'.
// REWRITTEN 2026-08-31 on GRANITE_ECHO's B1 ruling, which was made ON MEASUREMENTS, not on the attic.
//
// WHY THIS FINISHER EXISTS AT ALL, AND WHY IT IS AN 'apply': its product is DATABASE OBJECTS, not nodes.
// There is nothing to emit and no batch to join. That is the reason "finisher" needed a declared seam.
//
// =====================================================================================================
// THE DROP IS MANDATORY. IT IS NOT A STYLE CHOICE, AND IT IS NOT THE ATTIC BEING CARELESS.
// =====================================================================================================
// My first draft created the constraint WITHOUT dropping the engine's resolution-key index, on the
// assumption that a range index and a uniqueness constraint could coexist. MEASURED 2026-08-31 on a scratch
// DEV graph, Neo4j refuses, verbatim:
//
//     "There already exists an index (:ForgedNode {stableId}). A constraint cannot be created until the
//      index has been dropped."
//
// So the incumbent's drop-and-constrain shape was OBEYING THE DATABASE. Two further measurements decided
// the design around it:
//   * With the constraint in place, the engine's own `CREATE INDEX replay_reskey IF NOT EXISTS` on a later
//     write is a SILENT NO-OP — it does not refuse and does not duplicate. So this finisher can sit at
//     REGISTRY POSITION 2, mid-order, without breaking the next emit batch's write. The declared order
//     stays; nothing had to be reordered around it.
//   * The constraint-backed index SERVES the stableId MERGE with a STRONGER plan than the range index did:
//     `NodeUniqueIndexSeek(Locking)` where the standalone index gave `NodeIndexSeek`. The upgrade is a
//     measured BENEFIT, not a tolerated cost. (ARCH §10 amended to match; the resolution-key index is
//     UPGRADED to a constraint-backed one, and that is finish's ONE documented index change.)
//
// =====================================================================================================
// THE FAILURE PATH RESTORES WHAT IT DROPPED — GRANITE_ECHO'S ADDITION, AND IT IS A GATE
// =====================================================================================================
// Between the DROP and the successful CREATE there is a window in which the graph has NO resolution-key
// index at all. If the constraint creation fails in that window — the realistic cause being duplicate
// stableIds already in the graph, which is exactly the condition a uniqueness constraint exists to find —
// then abandoning the error there would leave the graph INDEX-LESS, and every subsequent stableId MERGE
// would fall back to a label scan on a graph with ~195,000 nodes.
// So: ON FAILURE, RECREATE THE INDEX BEFORE SURFACING THE ERROR, AND REPORT BOTH FACTS. A restoration that
// happened silently is nearly as bad as one that did not happen, because the next reader cannot tell which.
// If the restoration ITSELF fails, say THAT too, loudly, because then the graph really is index-less and
// the operator needs to know it rather than infer it.
//
// ROUND-TRIP-OR-REFUSE: after creating, re-query SHOW CONSTRAINTS and refuse if a constraint reported
// created is not actually there. "No error" is the instrument's claim; SHOW CONSTRAINTS is the artifact.
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no
// try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// The engine's resolution-key index name, replay-engine.js `resKeyIndexName()` (a module-local const, not
// exported — so this is a LITERAL COUPLED BY NAME, cited here rather than silently retyped). If the engine
// ever renames it, this finisher drops nothing and the constraint creation then refuses BY NAME with the
// message quoted above, which is a loud failure rather than a silent one. Noted as a known coupling.
const ENGINE_RESOLUTION_KEY_INDEX_NAME = 'replay_reskey';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { UNIQUENESS_KEYS, NODE_LABELS } = vocabulary;

		const asList = (oneValue) => (Array.isArray(oneValue) ? oneValue : [oneValue]);

		// ----- the constraint specs, derived from the registry so a uniqueness rule stated once cannot
		//   disagree with the constraint enforcing it. `blockingIndexName` names the STANDALONE index that
		//   must be dropped first, or null when nothing blocks — only ForgedNode(stableId) is covered by an
		//   engine-created index, so only that spec drops anything.
		const CONSTRAINT_SPEC_LIST = [
			{
				constraintName: 'forgedNodeStableIdUnique',
				label: NODE_LABELS.FORGED_NODE,
				propertyList: asList(UNIQUENESS_KEYS.STABLE_ID),
				registryEntry: 'STABLE_ID',
				blockingIndexName: ENGINE_RESOLUTION_KEY_INDEX_NAME,
			},
			{
				constraintName: 'hubReferenceAddressUnique',
				label: 'HubReference',
				propertyList: asList(UNIQUENESS_KEYS.HUB_REFERENCE),
				registryEntry: 'HUB_REFERENCE',
				blockingIndexName: null,
			},
			{
				constraintName: 'hubDefinitionNameUnique',
				label: 'HubDefinition',
				propertyList: asList(UNIQUENESS_KEYS.HUB_DEFINITION),
				registryEntry: 'HUB_DEFINITION',
				blockingIndexName: null,
			},
		];

		// single-property -> `n.prop`; composite -> `(n.p1, n.p2)`.
		const requireClause = (propertyList) =>
			propertyList.length === 1
				? `n.\`${propertyList[0]}\``
				: `(${propertyList.map((oneProperty) => `n.\`${oneProperty}\``).join(', ')})`;

		const createIndexCypher = (oneSpec) =>
			`CREATE INDEX \`${oneSpec.blockingIndexName}\` IF NOT EXISTS ` +
			`FOR (n:\`${oneSpec.label}\`) ON (${oneSpec.propertyList.map((oneProperty) => `n.\`${oneProperty}\``).join(', ')})`;

		// ----- applyOneSpec — drop (if something blocks), constrain, and RESTORE ON FAILURE.
		const applyOneSpec = (runCypher, oneSpec, callback) => {
			const constrain = (droppedIndexName) => {
				const cypher =
					`CREATE CONSTRAINT \`${oneSpec.constraintName}\` IF NOT EXISTS ` +
					`FOR (n:\`${oneSpec.label}\`) REQUIRE ${requireClause(oneSpec.propertyList)} IS UNIQUE`;

				runCypher({ cypher }, (constrainErr) => {
					if (!constrainErr) {
						callback('', { constraintName: oneSpec.constraintName, droppedIndexName });
						return;
					}

					// nothing was dropped -> nothing to restore; surface plainly.
					if (!droppedIndexName) {
						callback(
							`schema-constraint-finisher: creating '${oneSpec.constraintName}' ` +
								`(registry ${oneSpec.registryEntry}) failed: ${constrainErr}`,
						);
						return;
					}

					// THE RESTORATION. The graph is index-less right now; put it back BEFORE reporting.
					runCypher({ cypher: createIndexCypher(oneSpec) }, (restoreErr) => {
						if (restoreErr) {
							callback(
								`schema-constraint-finisher: creating '${oneSpec.constraintName}' ` +
									`(registry ${oneSpec.registryEntry}) failed: ${constrainErr} — AND THE RESTORATION OF ` +
									`index '${droppedIndexName}' ALSO FAILED: ${restoreErr}. THE GRAPH IS LEFT WITHOUT A ` +
									`RESOLUTION-KEY INDEX; every stableId MERGE will fall back to a label scan until it is ` +
									`recreated by hand.`,
							);
							return;
						}
						callback(
							`schema-constraint-finisher: creating '${oneSpec.constraintName}' ` +
								`(registry ${oneSpec.registryEntry}) failed: ${constrainErr} — index '${droppedIndexName}' ` +
								`WAS RESTORED, so the graph keeps its resolution-key index and is no worse off than before ` +
								`this finisher ran.`,
						);
					});
				});
			};

			if (!oneSpec.blockingIndexName) {
				constrain(null);
				return;
			}

			// The drop is Neo4j-mandated: a constraint cannot be created while a standalone index covers the
			// same (label, property). IF EXISTS so a graph that never had one is not an error.
			runCypher(
				{ cypher: `DROP INDEX \`${oneSpec.blockingIndexName}\` IF EXISTS` },
				(dropErr) => {
					if (dropErr) {
						callback(
							`schema-constraint-finisher: dropping index '${oneSpec.blockingIndexName}' before ` +
								`constraint '${oneSpec.constraintName}' failed: ${dropErr}. Nothing was changed.`,
						);
						return;
					}
					constrain(oneSpec.blockingIndexName);
				},
			);
		};

		// ----- apply — mode 'apply'.
		const apply = ({ runCypher } = {}, callback) => {
			if (typeof runCypher !== 'function') {
				callback(
					`schema-constraint-finisher: no runCypher was injected. An 'apply' finisher acts on the ` +
						`graph directly and cannot proceed without its session-bearing door.`,
				);
				return;
			}

			const taskList = new taskListPlus();
			const created = [];
			const droppedIndexes = [];

			CONSTRAINT_SPEC_LIST.forEach((oneSpec) => {
				taskList.push((args, next) => {
					applyOneSpec(runCypher, oneSpec, (err, result) => {
						if (err) {
							next(err);
							return;
						}
						created.push(result.constraintName);
						if (result.droppedIndexName) {
							droppedIndexes.push(result.droppedIndexName);
						}
						next('', args);
					});
				});
			});

			// ROUND-TRIP-OR-REFUSE: ask the database what it actually holds.
			taskList.push((args, next) => {
				runCypher(
					{ cypher: 'SHOW CONSTRAINTS YIELD name RETURN collect(name) AS nameList' },
					(err, result) => {
						if (err) {
							next(`schema-constraint-finisher: SHOW CONSTRAINTS verification failed: ${err}`);
							return;
						}
						const firstRecord = result && result.records && result.records[0];
						const presentList = (
							(firstRecord
								? firstRecord.get
									? firstRecord.get('nameList')
									: firstRecord.nameList
								: []) || []
						).map((oneName) => `${oneName}`);
						const absent = created.filter((oneName) => presentList.indexOf(oneName) === -1);
						if (absent.length) {
							next(
								`schema-constraint-finisher: ${absent.length} constraint(s) reported created but ABSENT ` +
									`from SHOW CONSTRAINTS: ${absent.join(', ')}. Present: [${presentList.join(', ')}]`,
							);
							return;
						}
						next('', { ...args, presentList });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					summary:
						`${created.length} uniqueness constraint(s) verified present: ${created.join(', ')}` +
						(droppedIndexes.length
							? ` (upgraded from standalone index: ${droppedIndexes.join(', ')})`
							: ''),
					constraints: created,
					constraintCount: created.length,
					droppedIndexes,
					presentCount: (args.presentList || []).length,
				});
			});
		};

		return { apply, CONSTRAINT_SPEC_LIST, requireClause, createIndexCypher };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
