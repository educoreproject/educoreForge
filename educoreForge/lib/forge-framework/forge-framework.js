'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forge-framework.js — THE Forge Framework: the factory + the object (SPEC-forgeFramework-v1.md §3),
// injectStandardHooks (§5), forge() / buildContractGraph (§6), and the re-exports the surface names.
//
//   const forgeFramework = require('<lib>/forge-framework/forge-framework')({ embedder, xLog? });
//   const bundle = forgeFramework.injectStandardHooks({ forgeDeclaration, hooks });
//   bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, callback)   // the seam, unchanged
//
// ONE shared library so each of the Profile's choices is made once and observed red once. It
// satisfies the forger's seam UNCHANGED (forger.js:816-828 — `require(entryModule)({ embedder })`,
// `bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, cb)`, the return the forger
// reads at :835,881,925,942-956). The framework object holds NO per-build state: every node/edge
// array, duplicate-id registry and stats object lives inside one invocation of the pure layer, so
// one instance serves many builds.
//
// deps (§3.2): `embedder` — the KEY must be present (Embedder or null; null = the spend knob is
// off); `xLog` — optional as a dep, required as a capability (an explicit xLog wins, else
// process.global.xLog; neither → refused by name; no do-nothing logger is ever manufactured);
// `migratingBundleListOverride` — TEST-ONLY (SPEC §10 G-ORDER/G-COMPAT, shippedConfig:false): lets a
// suite put its fixture INSIDE the four to observe the allowance mechanism red; a sibling gate
// asserts no shipped entry module or hook passes it. Any other dep name is refused by name.
//
// Control flow (DOCTRINE, Profile §2.2): callback error-first on the orchestration side —
// taskListPlus/pipeRunner; the kit throws inside the pure layer; the ONE try/catch in the framework
// is the pure-layer ADAPTER in forge() step 5 ("the throw-to-callback adapter, not control flow",
// forgeEdfi.js:199-231). A forge author never writes `try`.

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const structuralContractLib = require(path.join(__dirname, '..', 'structural-contract', 'structural-contract'));
const sequenceContractLib = require(path.join(__dirname, '..', 'sequence-contract', 'sequence-contract'));
const { buildSearchText } = require(path.join(__dirname, '..', 'search-text', 'build-search-text'))();

const refuse = require('./refuse');
const forgeDeclarationContractLib = require('./forgeDeclarationContract');
const standardHookContractLib = require('./standardHookContract');
const migrationAllowanceRegistryLib = require('./migrationAllowanceRegistry');
const contractGraphKitLib = require('./contractGraphKit');
const rootNodeLib = require('./rootNode');
const embedPassLib = require('./embedPass');
const sourceVerificationLib = require('./sourceVerification');
const provenanceStampLib = require('./provenanceStamp');
const censusLib = require('./census');
const fingerprintLib = require('./fingerprint');
const rosterLib = require('./roster');

const { DME_ROLES, EDGE_TYPES, NODE_LABELS, PROVENANCE_TIER, STRUCTURAL_PROPERTIES } = vocabularyLib;
const { MIGRATION_ALLOWANCE_REGISTRY, MIGRATING_BUNDLE_LIST, EVALUATED_AT } = migrationAllowanceRegistryLib;

const DME_ROLE_VALUE_LIST = Object.freeze(Object.values(DME_ROLES));
const EDGE_TYPE_VALUE_LIST = Object.freeze(Object.values(EDGE_TYPES));

// the seam's four argument keys (interfaces.js:229-240; forger.js:827) — the framework READS three
const SEAM_ARGUMENT_NAME_LIST = Object.freeze(['sourcePath', 'owner', 'embedNodeLimit', 'skipEmbedding']);
const DEP_NAME_LIST = Object.freeze(['embedder', 'xLog', 'migratingBundleListOverride']);
const DESCRIBE_SOURCE_KEY_LIST = Object.freeze(['version', 'selfDescribedVersion', 'sourceFormat', 'sourceFiles', 'sourceUrl']);

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(deps = {}) => {
		// -----------------------------------------------------------------
		// deps — refuse by name; nothing is manufactured
		// -----------------------------------------------------------------
		if (!isPlainObject(deps)) {
			throw refuse.byName({ moduleName, what: `deps is ${deps === null ? 'null' : `a ${typeof deps}`}`, where: 'call the factory with { embedder, xLog? }' });
		}
		const unknownDepName = Object.keys(deps).find((oneName) => DEP_NAME_LIST.indexOf(oneName) === -1);
		if (unknownDepName !== undefined) {
			throw refuse.byName({ moduleName, what: `unknown dep '${unknownDepName}'`, where: `the factory accepts ${DEP_NAME_LIST.join(', ')}; a driver, a config or a bolt URL is never a framework dep (SPEC §3.2, §11.1)` });
		}
		if (!Object.prototype.hasOwnProperty.call(deps, 'embedder')) {
			throw refuse.byName({ moduleName, what: "the 'embedder' key is absent from deps", where: 'the seam passes { embedder } (Embedder or null); null means the spend knob is off — say so explicitly' });
		}
		const embedder = deps.embedder;
		if (embedder !== null && (!isPlainObject(embedder) || typeof embedder.embedTexts !== 'function')) {
			throw refuse.byName({ moduleName, what: `embedder is ${embedder === undefined ? 'undefined' : 'not an Embedder (no embedTexts function)'}`, where: 'pass an Embedder ({ embedTexts }) or null' });
		}
		const xLog = deps.xLog !== undefined ? deps.xLog : process.global && process.global.xLog;
		if (!xLog || typeof xLog.status !== 'function' || typeof xLog.error !== 'function') {
			throw refuse.byName({ moduleName, what: 'xLog is available neither as a dep nor as process.global.xLog', where: 'pass { xLog } or bootstrap process.global; no do-nothing logger is manufactured (Profile §5.3)' });
		}
		let migratingBundleList = MIGRATING_BUNDLE_LIST;
		if (deps.migratingBundleListOverride !== undefined) {
			if (!Array.isArray(deps.migratingBundleListOverride) || deps.migratingBundleListOverride.some((oneName) => typeof oneName !== 'string')) {
				throw refuse.byName({ moduleName, what: 'migratingBundleListOverride is not a list of strings', where: 'TEST-ONLY dep; a suite passes the fixture standardKey to observe the allowance mechanism red' });
			}
			migratingBundleList = Object.freeze(deps.migratingBundleListOverride.slice());
		}

		const provenanceStamp = provenanceStampLib({ xLog });
		const embedPass = embedPassLib({ embedder, xLog });

		// -----------------------------------------------------------------
		// activeAllowancesFor — the declaration's entries and their registry rows, keyed for the
		// kit / root / step-4 evaluators. Validation already proved every id is a row this bundle may declare.
		// -----------------------------------------------------------------
		const activeAllowancesFor = ({ forgeDeclaration }) => {
			const activeAllowanceById = {};
			const activeAllowanceRowList = [];
			forgeDeclaration.compatibilityDeclarationList.forEach((oneEntry) => {
				activeAllowanceById[oneEntry.allowanceId] = oneEntry;
				activeAllowanceRowList.push(MIGRATION_ALLOWANCE_REGISTRY[oneEntry.allowanceId]);
			});
			return { activeAllowanceById, activeAllowanceRowList };
		};

		// evaluateAllowancesAtStep — declared-but-unneeded → refused; undeclared-but-needed → refused
		// (grouped by rowRefId so the sourceUrl row keyed three ways is ONE behaviour). Returns Error | null.
		const evaluateAllowancesAtStep = ({ forgeDeclaration, evaluatedAt, context, activeAllowanceRowList }) => {
			for (let rowIndex = 0; rowIndex < activeAllowanceRowList.length; rowIndex++) {
				const oneRow = activeAllowanceRowList[rowIndex];
				if (oneRow.evaluatedAt !== evaluatedAt) {
					continue;
				}
				if (!oneRow.preconditionMet(context)) {
					return refuse.byName({
						moduleName,
						what: `allowance ${oneRow.allowanceId} active but its condition is not met (${oneRow.preconditionText})`,
						where: 'a declared-but-unneeded allowance is a stale no-op; retire the declaration in its own commit',
					});
				}
			}
			const activeRowRefIdList = activeAllowanceRowList.map((oneRow) => oneRow.rowRefId);
			const registryRowList = Object.keys(MIGRATION_ALLOWANCE_REGISTRY).map((oneId) => MIGRATION_ALLOWANCE_REGISTRY[oneId]);
			for (let rowIndex = 0; rowIndex < registryRowList.length; rowIndex++) {
				const oneRow = registryRowList[rowIndex];
				if (oneRow.evaluatedAt !== evaluatedAt || activeRowRefIdList.indexOf(oneRow.rowRefId) !== -1) {
					continue;
				}
				if (oneRow.preconditionMet(context)) {
					const idList = registryRowList.filter((otherRow) => otherRow.rowRefId === oneRow.rowRefId).map((otherRow) => `${otherRow.allowanceId} (${otherRow.declarableBy.join('/')})`);
					return refuse.byName({
						moduleName,
						what: `forge-${forgeDeclaration.standardKey} would need allowance ${idList.join(' / ')} — ${oneRow.preconditionText} — and did not declare it`,
						where: `the strict behaviour runs: ${oneRow.whileDeclared.replace(/^the framework /, '')} is permitted only while the allowance is declared by a migrating bundle`,
					});
				}
			}
			return null;
		};

		// -----------------------------------------------------------------
		// injectStandardHooks — validates DATA (H1) and METHODS (H2–H4) against the declared
		// contracts and returns the seam bundle SYNCHRONOUSLY (forger.js:816 requires it so)
		// -----------------------------------------------------------------
		const injectStandardHooks = ({ forgeDeclaration, hooks } = {}) => {
			const declarationError = forgeDeclarationContractLib.validateForgeDeclaration({ forgeDeclaration, migratingBundleList });
			if (declarationError) {
				throw declarationError;
			}
			const hookError = standardHookContractLib.validateHooks({ hooks });
			if (hookError) {
				throw hookError;
			}
			const { standardKey, standardSource, stableUriPropertyName, nonEmbeddableRoleList } = forgeDeclaration;
			const forgePrefix = `forge-${standardKey}`;

			// =============================================================
			// buildContractGraph — the PURE layer (§6.2). Synchronous, deterministic, no I/O, no
			// clock, no xLog. Throws named Errors; forge() step 5 is the ONE adapter.
			// =============================================================
			const buildContractGraph = ({ parsed, metadata } = {}) => {
				if (!isPlainObject(parsed)) {
					throw refuse.byName({ moduleName, what: `${forgePrefix} buildContractGraph: parsed is not an object`, where: 'pass { parsed, metadata } — parsed is { [loaderName]: loaded }' });
				}
				if (!isPlainObject(metadata)) {
					throw refuse.byName({ moduleName, what: `${forgePrefix} buildContractGraph: metadata is not an object`, where: 'pass the post-stamp metadata (forge() step 4)' });
				}
				const { activeAllowanceById, activeAllowanceRowList } = activeAllowancesFor({ forgeDeclaration });

				// 1. a fresh kit
				const { kit, kitInternals } = contractGraphKitLib.contractGraphKit({ forgeDeclaration, metadata, activeAllowanceById });

				// 2. the ROOT first, from declared data; registered so the walk can refer to kit.rootStableId
				const describedRoot = hooks.describeRoot({ parsed, metadata });
				const rootNode = rootNodeLib.build({ forgeDeclaration, metadata, describedRoot, activeAllowanceById, activeAllowanceRowList });
				kitInternals.originByStableId[rootNode.stableId] = 'root';
				kitInternals.nodeByStableId[rootNode.stableId] = rootNode;
				kitInternals.nodes.push(rootNode);
				kitInternals.stats.nodeCountByRole[DME_ROLES.STANDARD_ROOT] = 1;
				kitInternals.setRootStableId(rootNode.stableId);

				// 3. the walk
				const walkResult = hooks.emitContractGraph({ parsed, metadata, kit });

				// 4. the integrity pass
				if (!isPlainObject(walkResult)) {
					throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned ${walkResult === null ? 'null' : `a ${typeof walkResult}`}`, where: 'the walk returns { nodes, edges, stats, sequenceGroups?, ...reports }' });
				}
				const { nodes: returnedNodes, edges: returnedEdges, stats: walkStats, sequenceGroups, ...standardSpecificReports } = walkResult;
				if (!Array.isArray(returnedNodes) || !Array.isArray(returnedEdges)) {
					throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph must return nodes[] and edges[]`, where: 'return the kit\'s collected arrays (kit.nodes, kit.edges), possibly re-assembled by concatenation' });
				}
				if (!isPlainObject(walkStats)) {
					throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph must return stats as an object`, where: 'return kit.stats (extended by the walk if it counts its own)' });
				}
				const mintedNodeSet = new Set(kitInternals.nodes);
				const mintedEdgeSet = new Set(kitInternals.edges);
				const seenNodeSet = new Set();
				const seenEdgeSet = new Set();
				returnedNodes.forEach((oneNode, nodeIndex) => {
					if (!mintedNodeSet.has(oneNode)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned a node at index ${nodeIndex} the kit did not mint (${oneNode && oneNode.stableId !== undefined ? `stableId '${oneNode.stableId}'` : 'no stableId'})`, where: 'the kit is the only door for CREATION; mint every node with kit.makeNode' });
					}
					if (seenNodeSet.has(oneNode)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned node '${oneNode.stableId}' twice`, where: 'every minted node is returned exactly once' });
					}
					seenNodeSet.add(oneNode);
				});
				returnedEdges.forEach((oneEdge, edgeIndex) => {
					if (!mintedEdgeSet.has(oneEdge)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned an edge at index ${edgeIndex} the kit did not mint (${oneEdge && oneEdge.type !== undefined ? `type '${oneEdge.type}' from '${oneEdge.fromRef && oneEdge.fromRef.id}' (source '${oneEdge.fromRef && oneEdge.fromRef.source}')` : 'unshaped'})`, where: 'the kit is the only door for CREATION; add every edge with kit.addEdge — a cross-standard edge cannot be expressed' });
					}
					if (seenEdgeSet.has(oneEdge)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned an edge twice (${oneEdge.type} ${oneEdge.fromRef.id} → ${oneEdge.toRef.id})`, where: 'every added edge is returned exactly once' });
					}
					seenEdgeSet.add(oneEdge);
				});
				if (seenNodeSet.size !== mintedNodeSet.size) {
					const missingNode = kitInternals.nodes.find((oneNode) => !seenNodeSet.has(oneNode));
					throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned ${seenNodeSet.size} of ${mintedNodeSet.size} minted nodes (missing '${missingNode.stableId}')`, where: 'a minted node that is not returned is a silent loss; return kit.nodes whole (the root included)' });
				}
				if (seenEdgeSet.size !== mintedEdgeSet.size) {
					const missingEdge = kitInternals.edges.find((oneEdge) => !seenEdgeSet.has(oneEdge));
					throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned ${seenEdgeSet.size} of ${mintedEdgeSet.size} added edges (missing ${missingEdge.type} ${missingEdge.fromRef.id} → ${missingEdge.toRef.id})`, where: 'an added edge that is not returned is a silent loss; return kit.edges whole' });
				}
				const nodes = returnedNodes;
				const edges = returnedEdges;

				// dangling endpoints — the falsy ones the kit recorded plus any endpoint that resolves to
				// no member — refused ONCE naming the count and the first offender (C1 is not an F3a row)
				const unresolvedEdgeList = edges.filter(
					(oneEdge) => !kitInternals.nodeByStableId[oneEdge.fromRef.id] || !kitInternals.nodeByStableId[oneEdge.toRef.id],
				);
				const danglingCount = kitInternals.stats.danglingEdges.length + unresolvedEdgeList.length;
				if (danglingCount > 0) {
					const firstOffender = kitInternals.stats.danglingEdges.length
						? kitInternals.stats.danglingEdges[0]
						: { edgeType: unresolvedEdgeList[0].type, fromStableId: unresolvedEdgeList[0].fromRef.id, toStableId: unresolvedEdgeList[0].toRef.id };
					throw refuse.byName({ moduleName, what: `${forgePrefix}: ${danglingCount} edge(s) had an unresolved endpoint (first: ${JSON.stringify(firstOffender)})`, where: 'never emit a partial edge; every endpoint must be a minted member (Profile §11.3 5(b))' });
				}

				// the kit's universal-property checks RE-RUN over every node and edge POST-MUTATION (FR15)
				nodes.forEach((oneNode) => {
					const props = oneNode.properties;
					if (!isPlainObject(props)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' lost its properties object after minting`, where: 'a walk may write onto a minted node but not replace its properties' });
					}
					if (props._id !== oneNode.stableId) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' carries _id ${JSON.stringify(props._id)} after the walk`, where: 'the FRAMEWORK stamps _id: stableId; a hook MUST NOT set or overwrite it' });
					}
					if (props._source !== standardSource) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' carries _source ${JSON.stringify(props._source)}, not '${standardSource}'`, where: '_source is the declaration\'s standardSource on every node' });
					}
					if (DME_ROLE_VALUE_LIST.indexOf(oneNode.role) === -1 || props.role !== oneNode.role || oneNode.labels[2] !== oneNode.role) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' role is inconsistent after the walk (top-level ${JSON.stringify(oneNode.role)}, property ${JSON.stringify(props.role)}, label ${JSON.stringify(oneNode.labels[2])})`, where: 'role is a DME_ROLES member stamped by the kit; a hook MUST NOT rewrite it' });
					}
					if (props[stableUriPropertyName] !== oneNode.stableId) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' carries ${stableUriPropertyName} ${JSON.stringify(props[stableUriPropertyName])} after the walk`, where: `${stableUriPropertyName} equals the stableId on every node` });
					}
					const isEmbeddable = nonEmbeddableRoleList.indexOf(oneNode.role) === -1;
					if (isEmbeddable && (typeof props.searchText !== 'string' || props.searchText.length === 0)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' has ${props.searchText === undefined ? 'no' : 'an empty'} searchText after the walk`, where: 'searchText is present and non-empty on every embeddable node' });
					}
					if (props.name !== undefined && typeof props.name !== 'string') {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' name became a ${typeof props.name} after the walk`, where: 'a universal-name value is never overwritten to a non-string' });
					}
					if (oneNode.role !== DME_ROLES.STANDARD_ROOT && (typeof props.parentId !== 'string' || props.parentId.length === 0)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' parentId is ${JSON.stringify(props.parentId)}`, where: 'every non-root node names its parent by a member stableId' });
					}
					if (oneNode.labels[0] !== NODE_LABELS.FORGED_NODE || oneNode.labels.length !== 3) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: node '${oneNode.stableId}' label triple is ${JSON.stringify(oneNode.labels)}`, where: 'labels are [ForgedNode, perStandardLabel, role]' });
					}
				});
				const permittedEdgeTypeList = EDGE_TYPE_VALUE_LIST.concat(kitInternals.edgeTypeAllowList);
				edges.forEach((oneEdge) => {
					if (permittedEdgeTypeList.indexOf(oneEdge.type) === -1) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: edge type '${oneEdge.type}' (${oneEdge.fromRef.id} → ${oneEdge.toRef.id}) is not an EDGE_TYPES member after the walk`, where: 'a hook MUST NOT rewrite an edge type; the kit resolves the type at addEdge' });
					}
					if (!isPlainObject(oneEdge.properties) || oneEdge.properties.provenanceTier !== PROVENANCE_TIER.STRUCTURAL) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: edge ${oneEdge.type} ${oneEdge.fromRef.id} → ${oneEdge.toRef.id} carries provenanceTier ${JSON.stringify(oneEdge.properties && oneEdge.properties.provenanceTier)}`, where: `every forge edge is ${PROVENANCE_TIER.STRUCTURAL}` });
					}
					if (oneEdge.fromRef.source !== standardSource || oneEdge.toRef.source !== standardSource) {
						throw refuse.byName({ moduleName, what: `${forgePrefix}: edge ${oneEdge.type} has an endpoint source outside '${standardSource}'`, where: 'a cross-standard edge cannot be expressed by a forge (Profile §9)' });
					}
				});

				// allowance preconditions evaluated at the contract-graph step (S2, S6, …)
				const allowanceError = evaluateAllowancesAtStep({ forgeDeclaration, evaluatedAt: EVALUATED_AT.CONTRACT_GRAPH, context: { kitStats: kitInternals.stats }, activeAllowanceRowList });
				if (allowanceError) {
					throw allowanceError;
				}

				// 5. finalizeSequence — BEFORE the structural finalizer (SIF's order); callback-shaped, same-tick
				if (sequenceGroups !== undefined) {
					if (!isPlainObject(sequenceGroups) || !isPlainObject(sequenceGroups.orderingByParent)) {
						throw refuse.byName({ moduleName, what: `${forgePrefix} emitContractGraph returned sequenceGroups without an orderingByParent object`, where: 'sequenceGroups is { orderingByParent: { [groupKey]: { members, orderSemantics } } }' });
					}
					let sequenceError = '';
					sequenceContractLib.finalizeSequence({ nodes, orderingByParent: sequenceGroups.orderingByParent }, (finalizeError) => {
						sequenceError = finalizeError;
					});
					if (sequenceError) {
						throw refuse.byName({ moduleName, what: `${forgePrefix} finalizeSequence: ${sequenceError}`, where: 'fix the sequenceGroups the walk returned' });
					}
				}

				// 6. finalizeStructuralContract LAST over structure (derives depth, stamps crossRefs '[]',
				//    refuses ≠1 root / bad parentId / cycle) — P1 is not an F3a row, so it always runs
				structuralContractLib.finalizeStructuralContract({ nodes, edges });

				// 7. return — the walk's arrays in the walk's order, plus its reports and the compliance report
				const complianceReport = censusLib.complianceReport({ forgeDeclaration, nodes, kitStats: kitInternals.stats });
				return { nodes, edges, stats: walkStats, complianceReport, ...standardSpecificReports };
			};

			// =============================================================
			// forge — the seam (§6.1): ONE taskListPlus, ONE pipeRunner, callback error-first
			// =============================================================
			const forge = (forgeArgs, callback) => {
				if (typeof callback !== 'function') {
					throw refuse.byName({ moduleName, what: `${forgePrefix} forge: callback is not a function`, where: 'forge(args, callback) is arity 2 (Profile §2.2)' });
				}
				if (!isPlainObject(forgeArgs)) {
					callback(refuse.byName({ moduleName, what: `${forgePrefix} forge: the argument is ${forgeArgs === null ? 'null' : `a ${typeof forgeArgs}`}`, where: 'forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, callback)' }).message);
					return;
				}
				// an unknown fifth key is refused by name (D3); the KEYS are enumerated without READING any value
				const unknownArgName = Object.keys(forgeArgs).find((oneName) => SEAM_ARGUMENT_NAME_LIST.indexOf(oneName) === -1);
				if (unknownArgName !== undefined) {
					callback(refuse.byName({ moduleName, what: `${forgePrefix} forge: unknown argument '${unknownArgName}'`, where: `the seam passes exactly ${SEAM_ARGUMENT_NAME_LIST.join(', ')}; a per-standard input moves into a loader (SIF's resolutionMapPath) or the declaration` }).message);
					return;
				}
				// the framework READS three of the four; `owner` is accepted and NEVER read (FR12)
				const sourcePath = forgeArgs.sourcePath;
				const embedNodeLimit = forgeArgs.embedNodeLimit;
				const skipEmbedding = forgeArgs.skipEmbedding;

				const taskList = new taskListPlus();

				// STEP 1 — cheap refusals first: a refusal can never itself cost anything
				taskList.push((args, next) => {
					if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} forge: sourcePath is ${JSON.stringify(sourcePath)}`, where: 'sourcePath is the pinned snapshot directory or file, read as handed' }).message);
						return;
					}
					if (!fs.existsSync(sourcePath)) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} forge: sourcePath '${sourcePath}' is not on disk`, where: 'no newest-snapshot resolution; sourcePath is read as handed' }).message);
						return;
					}
					if (typeof skipEmbedding !== 'boolean') {
						next(refuse.byName({ moduleName, what: `${forgePrefix} forge: skipEmbedding is ${JSON.stringify(skipEmbedding)}, not a boolean`, where: "'I did not say' is not 'yes, bill me'; pass skipEmbedding: true|false" }).message);
						return;
					}
					if (skipEmbedding === false && embedder === null) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} forge: embedding requested (skipEmbedding: false) with embedder null`, where: 'silence is not consent to spend; inject an Embedder or pass skipEmbedding: true' }).message);
						return;
					}
					if (embedNodeLimit !== undefined && (typeof embedNodeLimit !== 'number' || !Number.isInteger(embedNodeLimit) || embedNodeLimit < 0)) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} forge: embedNodeLimit is ${JSON.stringify(embedNodeLimit)}`, where: 'embedNodeLimit is a non-negative integer or absent' }).message);
						return;
					}
					const sourceIsDirectory = fs.statSync(sourcePath).isDirectory();
					const snapshotDirPath = sourceIsDirectory ? sourcePath : path.dirname(sourcePath);
					const additionalSourceInputPathByName = {};
					forgeDeclaration.additionalSourceInputList.forEach((oneInput) => {
						additionalSourceInputPathByName[oneInput.inputName] = path.join(snapshotDirPath, oneInput.relativePathFromSourcePath);
					});
					next('', { ...args, sourceIsDirectory, snapshotDirPath, additionalSourceInputPathByName });
				});

				// STEP 2 — checksum verification of every file the loaders will consume: for a file-bound
				// parser the ONE file (+ declared additional inputs); for a directory parser every listed file
				taskList.push((args, next) => {
					const relativePathList = args.sourceIsDirectory
						? undefined
						: [path.basename(sourcePath)].concat(forgeDeclaration.additionalSourceInputList.map((oneInput) => oneInput.relativePathFromSourcePath));
					sourceVerificationLib.verifySnapshotChecksums({ snapshotDirPath: args.snapshotDirPath, relativePathList }, (verifyError, verified) => {
						if (verifyError) {
							next(`${forgePrefix} source verification: ${verifyError}`);
							return;
						}
						// a declared additional input must be LISTED (verified above when the list was
						// explicit; asserted here for the directory case) and on disk
						const unlistedInput = forgeDeclaration.additionalSourceInputList.find(
							(oneInput) => verified.verifiedFileList.indexOf(oneInput.relativePathFromSourcePath) === -1,
						);
						if (unlistedInput) {
							next(refuse.byName({ moduleName, what: `${forgePrefix}: declared additional source input '${unlistedInput.inputName}' (${unlistedInput.relativePathFromSourcePath}) is not listed in SHA256SUMS`, where: 'a declared input is provenanced like any consumed byte' }).message);
							return;
						}
						next('', { ...args, verifiedFileList: verified.verifiedFileList });
					});
				});

				// STEP 3 — load: run sourceLoaderList SERIALLY → parsed = { [loaderName]: loaded }
				taskList.push((args, next) => {
					const parsed = {};
					const loaderList = hooks.sourceLoaderList;
					let loaderIndex = 0;
					const nextLoader = () => {
						if (loaderIndex >= loaderList.length) {
							next('', { ...args, parsed });
							return;
						}
						const oneLoader = loaderList[loaderIndex];
						loaderIndex++;
						oneLoader.load({ sourcePath, additionalSourceInputPathByName: args.additionalSourceInputPathByName, xLog }, (loadError, loaded) => {
							if (loadError) {
								next(`${forgePrefix} ${oneLoader.loaderName}: ${loadError}`);
								return;
							}
							parsed[oneLoader.loaderName] = loaded;
							nextLoader();
						});
					};
					nextLoader();
				});

				// STEP 4 — describe + stamp
				taskList.push((args, next) => {
					const describedSource = hooks.describeSource({ parsed: args.parsed });
					const { activeAllowanceRowList } = activeAllowancesFor({ forgeDeclaration });
					if (!isPlainObject(describedSource)) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned ${describedSource === null ? 'null' : `a ${typeof describedSource}`}`, where: `describeSource({ parsed }) returns { ${DESCRIBE_SOURCE_KEY_LIST.join(', ')} }` }).message);
						return;
					}
					const permittedExtraKeyList = activeAllowanceRowList.reduce((soFar, oneRow) => soFar.concat(oneRow.describeSourceExtraKeyList || []), []);
					const unknownDescribedName = Object.keys(describedSource).find((oneName) => DESCRIBE_SOURCE_KEY_LIST.indexOf(oneName) === -1 && permittedExtraKeyList.indexOf(oneName) === -1);
					if (unknownDescribedName !== undefined) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned undeclared key '${unknownDescribedName}'`, where: `the five keys are ${DESCRIBE_SOURCE_KEY_LIST.join(', ')}; a stamp triple is returned only under allowance P2` }).message);
						return;
					}
					const missingDescribedName = DESCRIBE_SOURCE_KEY_LIST.find((oneName) => describedSource[oneName] === undefined);
					if (missingDescribedName !== undefined) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource is missing key '${missingDescribedName}'`, where: `ALL FIVE keys are required: ${DESCRIBE_SOURCE_KEY_LIST.join(', ')} (selfDescribedVersion null when the source does not self-describe; sourceUrl null when the standard has none)` }).message);
						return;
					}
					if (typeof describedSource.version !== 'string' || describedSource.version.length === 0) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned version ${JSON.stringify(describedSource.version)}`, where: "version is what the bundle READ or 'unknown', never '' and never the recipe token" }).message);
						return;
					}
					if (describedSource.selfDescribedVersion !== null && typeof describedSource.selfDescribedVersion !== 'string') {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned selfDescribedVersion of type ${typeof describedSource.selfDescribedVersion}`, where: 'selfDescribedVersion is the standard\'s OWN version string, or null' }).message);
						return;
					}
					if (typeof describedSource.sourceFormat !== 'string' || describedSource.sourceFormat.length === 0) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned sourceFormat ${JSON.stringify(describedSource.sourceFormat)}`, where: 'sourceFormat is a non-empty string' }).message);
						return;
					}
					if (!Array.isArray(describedSource.sourceFiles) || describedSource.sourceFiles.some((oneName) => typeof oneName !== 'string')) {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned sourceFiles ${JSON.stringify(describedSource.sourceFiles)}`, where: 'sourceFiles is an array of strings in the ORDER the standard states' }).message);
						return;
					}
					if (describedSource.sourceUrl !== null && typeof describedSource.sourceUrl !== 'string') {
						next(refuse.byName({ moduleName, what: `${forgePrefix} describeSource returned sourceUrl of type ${typeof describedSource.sourceUrl}`, where: 'sourceUrl is a string, or null when the standard has no source URL (then the root OMITS it)' }).message);
						return;
					}
					const allowanceError = evaluateAllowancesAtStep({ forgeDeclaration, evaluatedAt: EVALUATED_AT.DESCRIBE_SOURCE, context: { describedSource }, activeAllowanceRowList });
					if (allowanceError) {
						next(allowanceError.message);
						return;
					}
					provenanceStamp.deriveVersionStamp({ sourcePath, sourceVersion: describedSource.selfDescribedVersion }, (stampError, stamp) => {
						if (stampError) {
							next(`${forgePrefix} ${stampError}`);
							return;
						}
						const metadata = {
							version: describedSource.version,
							versionSource: stamp.versionSource,
							sourceFormat: describedSource.sourceFormat,
							sourceFiles: describedSource.sourceFiles,
							sourceUrl: describedSource.sourceUrl,
							snapshotKey: stamp.snapshotKey,
							publishedVersion: stamp.publishedVersion,
						};
						next('', { ...args, metadata });
					});
				});

				// STEP 5 — the pure layer under the ONE adapter: try/catch here is the throw-to-callback
				// ADAPTER, not control flow (forgeEdfi.js:199-231; Profile §2.2)
				taskList.push((args, next) => {
					let contractGraph;
					let buildError = '';
					try {
						contractGraph = buildContractGraph({ parsed: args.parsed, metadata: args.metadata });
					} catch (thrownError) {
						buildError = thrownError.message;
					}
					if (buildError) {
						next(`${forgePrefix} buildContractGraph: ${buildError}`);
						return;
					}
					xLog.status(`[${forgePrefix}] contract graph: ${contractGraph.nodes.length} nodes, ${contractGraph.edges.length} edges`);
					next('', { ...args, contractGraph });
				});

				// STEP 6 — embed (D7: skipEmbedding true → embedCallCount 0, no embedTexts call)
				taskList.push((args, next) => {
					if (skipEmbedding === true) {
						next('', { ...args, embedCallCount: 0 });
						return;
					}
					embedPass.embedNodes(
						{ nodes: args.contractGraph.nodes, nodeSubsetLimit: embedNodeLimit, nonEmbeddableRoleList, standardKey },
						(embedError, embedReport) => {
							if (embedError) {
								next(embedError);
								return;
							}
							next('', { ...args, embedCallCount: embedReport.embedCallCount });
						},
					);
				});

				// STEP 7 — return: the seam's declared keys + stats + complianceReport + the walk's reports
				pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
					if (pipelineError) {
						callback(pipelineError);
						return;
					}
					const { nodes, edges, stats, complianceReport, ...standardSpecificReports } = args.contractGraph;
					xLog.status(`[${forgePrefix}] forged ${nodes.length} nodes, ${edges.length} edges (${args.embedCallCount} embedding calls)`);
					callback('', {
						nodes,
						edges,
						metadata: args.metadata,
						stats,
						embedCallCount: args.embedCallCount,
						standardKey,
						stableUriPropertyName,
						complianceReport,
						...standardSpecificReports,
					});
				});
			};

			return {
				forge,
				buildContractGraph,
				STANDARD_KEY: standardKey,
				STANDARD_SOURCE: standardSource,
				STABLE_URI_PROPERTY_NAME: stableUriPropertyName,
			};
		};

		// -----------------------------------------------------------------
		// the public surface (§3.3)
		// -----------------------------------------------------------------
		return {
			injectStandardHooks,
			contracts: Object.freeze({
				FORGE_DECLARATION_CONTRACT: forgeDeclarationContractLib.FORGE_DECLARATION_CONTRACT,
				STANDARD_HOOK_CONTRACT: standardHookContractLib.STANDARD_HOOK_CONTRACT,
				MIGRATION_ALLOWANCE_REGISTRY,
				CONTRACT_GRAPH_KIT_SURFACE: contractGraphKitLib.CONTRACT_GRAPH_KIT_SURFACE,
				MIGRATING_BUNDLE_LIST: migratingBundleList,
			}),
			constants: Object.freeze({
				EMBED_BATCH_SIZE: embedPassLib.EMBED_BATCH_SIZE,
				CORE_VERSION: rootNodeLib.CORE_VERSION,
			}),
			vocabulary: Object.freeze({
				DME_ROLES,
				EDGE_TYPES,
				NODE_LABELS,
				PROVENANCE_TIER,
				STRUCTURAL_PROPERTIES,
			}),
			provenance: Object.freeze({
				verifySnapshotChecksums: sourceVerificationLib.verifySnapshotChecksums,
				deriveVersionStamp: provenanceStamp.deriveVersionStamp,
			}),
			embed: Object.freeze({ embedNodes: embedPass.embedNodes }),
			structural: Object.freeze({
				finalizeStructuralContract: structuralContractLib.finalizeStructuralContract,
				classifyParentReferent: structuralContractLib.classifyParentReferent,
			}),
			sequence: Object.freeze({ finalizeSequence: sequenceContractLib.finalizeSequence }),
			searchText: Object.freeze({ buildSearchText }),
			refuse: Object.freeze({
				byName: refuse.byName,
				requiredKeys: refuse.requiredKeys,
				closedValue: refuse.closedValue,
			}),
			census: Object.freeze({
				collisionCensus: censusLib.collisionCensus,
				complianceReport: censusLib.complianceReport,
			}),
			roster: Object.freeze({ assertUniqueStandardNames: rosterLib.assertUniqueStandardNames }),
			fingerprint: Object.freeze({
				pureLayerFingerprint: fingerprintLib.pureLayerFingerprint,
				canonicalText: fingerprintLib.canonicalText,
				PROXY_LABEL: fingerprintLib.PROXY_LABEL,
			}),
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
