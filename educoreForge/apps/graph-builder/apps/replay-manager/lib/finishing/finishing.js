'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// finishing.js — the replayManager FINISHER REGISTRY (graphSelfDoc campaign, 2026-08-31;
// ARCH-replayManager-083126.md §8; RULING GRANITE_ECHO 2026-08-31 on the finisher seam). It turns a
// materialized graph into a SELF-DESCRIBING one, and it is owned by replayManager's `finish` verb —
// build.js learns "run finish at materialize" and nothing about how any finisher works (the hub-fold
// precedent: build.js never learns hub construction at all).
//
// THE REGISTRY IS ORDERED DATA, NOT A SWITCH. Each entry is { name, mode, enabled, finisher }. Adding a
// finisher is a new file plus a row here; no dispatch logic changes. The contract each row satisfies is
// declared in apps/graph-builder/interfaces.js as FinisherComponent + FINISHER_MODULE_SHAPE.
//
// ORDER IS FORCED, NOT STYLISTIC, and this module is its ONLY home:
//   schemaView must emit its nodes BEFORE schemaConstraints creates constraints over them;
//   graphMeta must run LAST so every metadata node minted above it exists to be stamped and XOR-verified.
//
// TWO MODES, DECLARED AND DISPATCHED — NEVER SNIFFED (the ruling's core):
//   'emit'  -> emit({ readQuery, … }, cb) -> ('', { nodes, edges, summary })
//              Produces Channel-A material. The finisher NEVER writes; the caller assembles and writes.
//              `readQuery` is a READ-MODE session, which makes "an emitter never writes" MECHANICAL
//              rather than a promise in a comment. Emitters legitimately READ: standardDefinition
//              derives counts from the built graph, usagePattern must EXECUTE each exemplar and see rows
//              before that exemplar may be written.
//   'apply' -> apply({ runCypher, … }, cb) -> ('', { summary })
//              Acts on the graph because its product is not nodes — schemaConstraints creates DATABASE
//              OBJECTS, graphMeta stamps labels and verifies the XOR graph-wide.
// An absent or unrecognised mode is REFUSED BY NAME. Probing which method a module happens to expose
// would make the contract depend on an implementation accident, and a finisher that silently did nothing
// because neither method matched is the exact class of silent success this campaign exists to abolish.
//
// THE BATCHING RULE, general — not a two-write special case. applyFinishers walks the registry IN ORDER
// and batches MAXIMAL CONTIGUOUS RUNS OF EMITTERS into one writeBatch call each. It does NOT collapse all
// emitters into a single write: with the declared order (schemaView, schemaConstraints, then four
// emitters, then graphMeta) that would hoist schemaView's nodes past the constraints meant to cover them,
// or sink them behind later emitters — either way THE DECLARED ORDER WOULD SILENTLY STOP BEING THE
// EXECUTION ORDER while the registry still read as correct. Any future reordering just changes the
// batching, and nothing about ordering lives anywhere except this file.
//
// A FINISHER FAILURE ABORTS THE PHASE AND SURFACES — never swallowed (attic finishing.js:126 precedent).
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no
// try/catch-for-control-flow, no Promises surfaced. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'lib');
const vocabulary = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));
const { FINISHER_MODULE_SHAPE } = require(path.join(__dirname, '..', '..', '..', '..', 'interfaces'));

const MODE_EMIT = 'emit';
const MODE_APPLY = 'apply';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ readQuery, runCypher, writeBatch, storeReader, manifestRefId, gateResults } = {}) => {
		const { xLog } = process.global;

		// ----- the finisher modules. Each receives ONLY what its mode entitles it to: an emitter gets the
		//   frozen registry (its content source) and reads through the injected readQuery handed to emit();
		//   an applier gets nothing at construction and acts through the runCypher handed to apply(). The
		//   asymmetry is the point — an emitter that wanted runCypher would have to ask for it in writing.
		const schemaViewFinisher = require('./lib/schema-view-finisher')({ vocabulary });
		const schemaConstraintFinisher = require('./lib/schema-constraint-finisher')({ vocabulary });
		const manifestRecipeFinisher = require('./lib/manifest-recipe-finisher')({ vocabulary });
		const standardDefinitionFinisher = require('./lib/standard-definition-finisher')({ vocabulary });
		const buildAttestationFinisher = require('./lib/build-attestation-finisher')({ vocabulary });
		const usagePatternFinisher = require('./lib/usage-pattern-finisher')({ vocabulary });
		const graphMetaFinisher = require('./lib/graph-meta-finisher')({ vocabulary });

		// ----- THE ORDERED REGISTRY. Top-to-bottom IS run order. `mode` is DATA the walker dispatches on.
		//   Phase 1 populates the first two rows; manifestRecipe, standardDefinition, buildAttestation,
		//   COMPLETE as of Phase 4: all seven members are present. The write plan this order produces is
		//   [schemaView] | constraints | [recipe+standardDefinition+buildAttestation+usagePattern] | graphMeta
		//   — TWO writes, because graphMeta is an APPLIER and closes the contiguous emit run. That falls
		//   out of the maximal-contiguous rule; it was not arranged for.
		const REGISTRY = [
			{
				name: 'schemaView',
				mode: MODE_EMIT,
				enabled: true,
				finisher: schemaViewFinisher,
			},
			{
				name: 'schemaConstraints',
				mode: MODE_APPLY,
				enabled: true,
				finisher: schemaConstraintFinisher,
			},
			// ⟪Phase 2⟫ THE ONLY STORE-READING FINISHER. It sits AFTER schemaConstraints, which means it
			// opens a NEW contiguous emit run — so today's plan is two writes: [schemaView], constraints,
			// [manifestRecipe]. That falls out of the batching rule; nothing about ordering was special-cased.
			{
				name: 'manifestRecipe',
				mode: MODE_EMIT,
				enabled: true,
				finisher: manifestRecipeFinisher,
			},
			// ⟪Phase 3⟫ three more EMITTERS, contiguous with manifestRecipe — so the batching rule folds
			// all four into ONE write. Today's plan is therefore still 2 writes: [schemaView], constraints,
			// [recipe + standardDefinition + buildAttestation + usagePattern]. That is exactly the plan
			// ARCH §8 predicted, arrived at by the general rule rather than by arranging for it.
			{
				name: 'standardDefinition',
				mode: MODE_EMIT,
				enabled: true,
				finisher: standardDefinitionFinisher,
			},
			{
				name: 'buildAttestation',
				mode: MODE_EMIT,
				enabled: true,
				finisher: buildAttestationFinisher,
			},
			{
				name: 'usagePattern',
				mode: MODE_EMIT,
				enabled: true,
				finisher: usagePatternFinisher,
			},
			// ⟪Phase 4⟫ graphMeta is an APPLIER and it is LAST, both deliberately. Last because everything
			// it stamps must already exist — a finisher added below it would emit nodes the sweep has
			// already passed, and they would sit unstamped until the XOR caught them. An APPLIER because it
			// mints nothing: it labels what the emitters produced and then verifies the invariant over the
			// whole graph. Being an applier also CLOSES the contiguous emit run above it, so the plan is
			// still 2 writes — [schemaView], constraints, [recipe + standardDefinition + buildAttestation +
			// usagePattern], graphMeta — which again falls out of the batching rule rather than being
			// arranged for. NOTE: the passport is NOT covered by this sweep; it does not exist yet
			// (Channel B) and the verb re-runs graphMetaFinisher.verifyXor as its LAST act (gate (g)).
			{
				name: 'graphMeta',
				mode: MODE_APPLY,
				enabled: true,
				finisher: graphMetaFinisher,
			},
		];

		// ----- modeRefusal — the no-silent-default guard, as a refusal STRING so the boolean gate is
		//   defined by the refusal (the sssomJustificationRefusal idiom). Names the offending entry, the
		//   value it declared, and the modes that ARE accepted: a refusal a reader cannot act on is not a
		//   refusal. Also refuses a row whose declared mode has no matching method — a declaration that
		//   does not match its module is a lie the registry must not carry.
		const modeRefusal = (oneEntry) => {
			const declaredMode = oneEntry.mode;

			if (declaredMode === undefined || declaredMode === null || `${declaredMode}`.trim() === '') {
				return (
					`finishing: registry entry '${oneEntry.name}' declares NO mode. ` +
					`Every entry must declare one of: ${FINISHER_MODULE_SHAPE.MODE_TOKENS.join(', ')}. ` +
					`The mode is data on the registry row and is never inferred from which method the module exposes.`
				);
			}

			if (FINISHER_MODULE_SHAPE.MODE_TOKENS.indexOf(declaredMode) === -1) {
				return (
					`finishing: registry entry '${oneEntry.name}' declares an unrecognised mode '${declaredMode}'. ` +
					`Accepted modes: ${FINISHER_MODULE_SHAPE.MODE_TOKENS.join(', ')}.`
				);
			}

			const requiredMethod = FINISHER_MODULE_SHAPE[declaredMode].method;
			if (typeof (oneEntry.finisher || {})[requiredMethod] !== 'function') {
				return (
					`finishing: registry entry '${oneEntry.name}' declares mode '${declaredMode}' but its module ` +
					`exposes no '${requiredMethod}' function. The declaration and the module disagree.`
				);
			}

			return '';
		};

		// ----- emitResultRefusal — THE WALKER VALIDATES EMITTED SHAPE, ONCE, FOR EVERY EMITTER
		//   (RULING GRANITE_ECHO 2026-08-31 on N1). It lives HERE and not inside each finisher for two
		//   reasons that decided it: a finisher checking its own output is a finisher grading its own
		//   homework, and a per-finisher check leaves every FUTURE emitter uncovered until someone
		//   remembers to add it. One check at the seam covers emitters that do not exist yet.
		//
		//   WHAT IT IS PROTECTING AGAINST, measured rather than imagined: replay-engine's buildNodeRow
		//   dereferences `node.ref.source` unconditionally, so a node without a well-formed ref does not get
		//   refused — it CRASHES, and the TypeError surfaces MISATTRIBUTED as "phase1 resolution-key index
		//   failed", pointing a reader at the index code instead of at the malformed node. This refusal
		//   exists so that crash path is UNREACHABLE from finish.
		//
		//   It names the FINISHER and the OFFENDING stableId, because "some node was malformed" cannot be
		//   acted on, and the whole point of moving the check here is that the owner is knowable.
		const emitResultRefusal = (finisherName, result) => {
			const nodeShape = FINISHER_MODULE_SHAPE.EMITTED_NODE_SHAPE;
			const edgeShape = FINISHER_MODULE_SHAPE.EMITTED_EDGE_SHAPE;
			const faultList = [];

			const nodeList = (result || {}).nodes;
			const edgeList = (result || {}).edges;

			if (!Array.isArray(nodeList) || !Array.isArray(edgeList)) {
				return (
					`finishing: emitter '${finisherName}' returned a malformed result — an 'emit' finisher must ` +
					`return { nodes, edges, summary } with nodes and edges as ARRAYS (got nodes=${typeof nodeList}, ` +
					`edges=${typeof edgeList}).`
				);
			}

			nodeList.forEach((oneNode, onePosition) => {
				const nodeLabel =
					oneNode && oneNode.stableId ? `stableId '${oneNode.stableId}'` : `node at index ${onePosition}`;

				nodeShape.requiredKeys.forEach((oneKey) => {
					if (!oneNode || oneNode[oneKey] === undefined || oneNode[oneKey] === null) {
						faultList.push(`${nodeLabel}: missing required key '${oneKey}'`);
					}
				});

				if (oneNode && oneNode.ref) {
					nodeShape.refRequiredKeys.forEach((oneKey) => {
						const isNullable = nodeShape.nullableRefKeys.indexOf(oneKey) !== -1;
						const isPresent = Object.prototype.hasOwnProperty.call(oneNode.ref, oneKey);
						if (!isPresent) {
							faultList.push(
								`${nodeLabel}: ref is missing '${oneKey}'` +
									(isNullable
										? ` (it may be null — for metadata it MUST be — but the key must be present)`
										: ''),
							);
							return;
						}
						if (!isNullable && (oneNode.ref[oneKey] === null || oneNode.ref[oneKey] === undefined)) {
							faultList.push(`${nodeLabel}: ref.${oneKey} is null, which is not permitted`);
						}
					});
				}

				if (oneNode && oneNode.labels !== undefined && !Array.isArray(oneNode.labels)) {
					faultList.push(`${nodeLabel}: labels must be an ARRAY`);
				}
			});

			edgeList.forEach((oneEdge, onePosition) => {
				const edgeLabel =
					oneEdge && oneEdge.type ? `edge '${oneEdge.type}' at index ${onePosition}` : `edge at index ${onePosition}`;

				edgeShape.requiredKeys.forEach((oneKey) => {
					if (!oneEdge || oneEdge[oneKey] === undefined || oneEdge[oneKey] === null) {
						faultList.push(`${edgeLabel}: missing required key '${oneKey}'`);
					}
				});
				['fromRef', 'toRef'].forEach((oneEndpoint) => {
					if (oneEdge && oneEdge[oneEndpoint]) {
						edgeShape.endpointRequiredKeys.forEach((oneKey) => {
							if (oneEdge[oneEndpoint][oneKey] === undefined || oneEdge[oneEndpoint][oneKey] === null) {
								faultList.push(`${edgeLabel}: ${oneEndpoint} is missing '${oneKey}'`);
							}
						});
					}
				});
				if (oneEdge && oneEdge.properties) {
					edgeShape.requiredProperties.forEach((oneProperty) => {
						if (oneEdge.properties[oneProperty] === undefined || oneEdge.properties[oneProperty] === null) {
							faultList.push(
								`${edgeLabel}: properties.${oneProperty} is required — engine GUARD 3 refuses to write ` +
									`ANY edge in a block when one lacks it`,
							);
						}
					});
				}
			});

			if (faultList.length === 0) {
				return '';
			}
			return (
				`finishing: emitter '${finisherName}' produced ${faultList.length} malformed item(s) and the ` +
				`batch was REFUSED before reaching the write path. ${faultList.join('; ')}`
			);
		};

		// ----- runOneEmitter / runOneApplier — the two dispatch leaves. Each hands the finisher EXACTLY the
		//   access its mode entitles it to, and nothing else.
		const runOneEmitter = (oneEntry, callback) => {
			oneEntry.finisher.emit({ readQuery, storeReader, manifestRefId, gateResults }, (err, result) => {
				if (err) {
					callback(`finishing: finisher '${oneEntry.name}' failed: ${err}`);
					return;
				}
				const shapeRefusal = emitResultRefusal(oneEntry.name, result);
				if (shapeRefusal) {
					callback(shapeRefusal);
					return;
				}
				callback('', result || {});
			});
		};

		const runOneApplier = (oneEntry, callback) => {
			oneEntry.finisher.apply({ runCypher, readQuery }, (err, result) => {
				if (err) {
					callback(`finishing: finisher '${oneEntry.name}' failed: ${err}`);
					return;
				}
				callback('', result || {});
			});
		};

		// ----- batchPlan — split the ACTIVE registry into an ordered list of steps, each either one
		//   { kind:'emitBatch', entryList:[…] } (a MAXIMAL CONTIGUOUS run of emitters) or one
		//   { kind:'apply', entry } . This function is the whole of the ordering rule and it is PURE, so a
		//   test can assert the plan for any registry shape without running a finisher or touching a graph.
		const batchPlan = (activeList) =>
			activeList.reduce((stepList, oneEntry) => {
				if (oneEntry.mode === MODE_APPLY) {
					return stepList.concat([{ kind: 'apply', entry: oneEntry }]);
				}
				const lastStep = stepList[stepList.length - 1];
				if (lastStep && lastStep.kind === 'emitBatch') {
					lastStep.entryList.push(oneEntry);
					return stepList;
				}
				return stepList.concat([{ kind: 'emitBatch', entryList: [oneEntry] }]);
			}, []);

		// ----- applyFinishers({ disabled? }, cb) -> ('', { applied:[{name, mode, summary, …}], writeCount }).
		//   Walks the registry in order. Refuses EVERY active entry's mode BEFORE running any of them, so a
		//   mis-declared row cannot be discovered halfway through a partially-finished graph.
		const applyFinishers = ({ disabled = [] } = {}, callback) => {
			const activeList = REGISTRY.filter(
				(oneEntry) => oneEntry.enabled && disabled.indexOf(oneEntry.name) === -1,
			);

			const refusalList = activeList.map(modeRefusal).filter((oneRefusal) => oneRefusal !== '');
			if (refusalList.length) {
				callback(refusalList.join(' | '));
				return;
			}

			const taskList = new taskListPlus();
			const applied = [];
			let writeCount = 0;

			batchPlan(activeList).forEach((oneStep) => {
				if (oneStep.kind === 'apply') {
					taskList.push((args, next) => {
						runOneApplier(oneStep.entry, (err, result) => {
							if (err) {
								next(err);
								return;
							}
							applied.push({ name: oneStep.entry.name, mode: oneStep.entry.mode, ...result });
							xLog.status(
								`[finishing] applied '${oneStep.entry.name}': ${(result && result.summary) || ''}`,
							);
							next('', args);
						});
					});
					return;
				}

				// an emit BATCH: run each emitter in order, accumulate its material, then ONE write.
				oneStep.entryList.forEach((oneEntry) => {
					taskList.push((args, next) => {
						runOneEmitter(oneEntry, (err, result) => {
							if (err) {
								next(err);
								return;
							}
							applied.push({ name: oneEntry.name, mode: oneEntry.mode, ...result });
							xLog.status(
								`[finishing] emitted '${oneEntry.name}': ${(result && result.summary) || ''}`,
							);
							next('', {
								...args,
								pendingNodes: (args.pendingNodes || []).concat(result.nodes || []),
								pendingEdges: (args.pendingEdges || []).concat(result.edges || []),
							});
						});
					});
				});

				taskList.push((args, next) => {
					const nodeList = args.pendingNodes || [];
					const edgeList = args.pendingEdges || [];
					const batchNames = oneStep.entryList.map((oneEntry) => oneEntry.name).join(', ');

					// metadata carries NO vectors — the honest-null branch of embeddingDims, not an omission.
					writeBatch(
						{ nodes: nodeList, edges: edgeList, embeddingDims: null },
						(err, writeReport) => {
							if (err) {
								next(`finishing: write of emit batch [${batchNames}] failed: ${err}`);
								return;
							}
							writeCount = writeCount + 1;
							xLog.status(
								`[finishing] wrote batch [${batchNames}]: ${nodeList.length} node(s), ${edgeList.length} edge(s)`,
							);
							next('', { ...args, pendingNodes: [], pendingEdges: [], lastWriteReport: writeReport });
						},
					);
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', { applied, writeCount });
			});
		};

		return {
			applyFinishers,
			// exposed for the gate of record: the ordered registry, the pure ordering rule, and the refusal
			// — so a test can assert ORDER and REFUSAL without provisioning a graph.
			REGISTRY,
			batchPlan,
			modeRefusal,
			// the emitted-shape validator, exposed for the same reason as the two above: a gate must be able
			// to drive the REFUSAL directly — including with a deliberately-broken double — without
			// provisioning a graph. A refusal that can only be observed by crashing something is not
			// a refusal anyone can test.
			emitResultRefusal,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
