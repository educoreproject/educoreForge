'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeJedx.js — the JEDx forge bundle. Parses the JEDx CSV data model (one CSV per entity) and emits
// the UNIVERSAL FORGE PROPERTY CONTRACT (the SAME contract forge-sif/forge-edfi emit), so JEDx lands
// in the validation graph interoperably. CSV-family; mirrors forge-edfi/forgeEdfi.js exactly.
//
// HARVESTED+ADAPTED from the OLD forge-jedx (lib/parser.js navigation reused; node-shaping rewritten):
//   * the OLD tool emitted private Jedx* nodes (JedxEntity/JedxField/JedxCodeSet) with hand-rolled
//     native edges (HAS_ENTITY, HAS_FIELD, CONSTRAINED_BY, REFERENCES) and an older node contract.
//   * THIS module maps each native node to one of the canonical Dme* roles: JedxEntity -> DmeClass;
//     JedxField -> DmeProperty; JedxCodeSet -> DmeOptionSet (JEDx code sets have NO enumerated values
//     in the source, so there is NO DmeOptionValue role; JEDx uses no DmeSupport). It builds
//     searchText via the ONE shared 1C builder (structural context only), assigns deterministic
//     synthetic stableIds (jedx:<kind>/<naturalKey>; JEDx CSV elements have no native URI — a
//     path-based key, mirroring EdFi/SIF), and writes the canonical ownership edges
//     (HAS_CLASS/HAS_PROPERTY) plus translated internal edges (CONSTRAINED_BY -> HAS_OPTION_SET: a
//     field OWNS its code set; an entity FK REFERENCES another entity), all stamped provenanceTier
//     'structural'.
//
// PURITY (forge is PURE/deterministic for (source, module)): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source. forge() runs parse -> buildContractGraph
// -> embedNodes. An R3 normalization miss or empty searchText (R4) THROWS — surfaced as a forge error.
//
// BRIDGE PURITY: this is a STANDARD-PURE JEDx block — _source='JEDx', JEDx's own nodes + intra-JEDx
// structural edges ONLY. JEDx carries NO CEDS-crosswalk columns, so there is NOTHING to stash and NO
// cross-standard mapping edge is emitted (bridging is a LATER phase).
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseJedx = require('./lib/parser');
const normalize = require('./lib/normalize');

const CORE_LIB = path.join(__dirname, '..', '..', 'lib'); // PORTED: recreation substrate
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { deriveVersionStamp } = require(
	path.join(CORE_LIB, 'snapshot-provenance', 'snapshot-provenance'),
);
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
// the central structural-property authority (Wave-2 items 5/6; M7/M8): enforces the parentId ->
// member-stableId referent, derives depth (= parentId-chain length), stamps crossRefs universally,
// and aligns single-owner optionSet parenting. Called as buildContractGraph's LAST step.
const { finalizeStructuralContract } = require(
	path.join(CORE_LIB, 'structural-contract', 'structural-contract'),
);

const STANDARD_KEY = 'jedx';
const STANDARD_SOURCE = 'JEDx'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'JEDx Data Model';
const STABLE_URI_PROPERTY_NAME = 'jedxStableId';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.

// The mappingInstruction fields are DECLARED on the DmeStandardRoot. JEDx carries no native CEDS
// anchor (anchor property arrays empty, so -specified emits nothing), but it DOES bridge TO the
// CEDS hub (impliedTargets ['CEDS']); its CEDS alignment comes entirely from the -implied tier,
// exactly like CASE (anchor-free, value from embeddings). includeInImplied:true keeps JEDx in the
// hub-and-spoke campaign that unifies all standards via CEDS.
const jedxMappingInstruction = {
	cedsOriginalAnchorPropertyName: [],
	cedsOptionOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch.
const roleSpecByNativeLabel = {
	JedxEntity: { role: DME_ROLES.CLASS, kind: 'entity', perStandardLabel: 'JedxEntity' },
	JedxField: { role: DME_ROLES.PROPERTY, kind: 'field', perStandardLabel: 'JedxField' },
	JedxCodeSet: { role: DME_ROLES.OPTION_SET, kind: 'codeset', perStandardLabel: 'JedxCodeSet' },
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
const naturalKeyByKind = {
	entity: (props) => props.name,
	field: (props) => props.fieldPath || `${props.entityName}.${props.name}`,
	codeset: (props) => props.name,
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-edfi/forge-sif EXACTLY:
// HAS_FIELD is canonical ownership reached through the native _parentEdge; CONSTRAINED_BY (a field's
// code-set constraint) becomes HAS_OPTION_SET FROM THE DmeProperty TO THE DmeOptionSet — the property
// OWNS its option set; a genuine entity->entity FK stays REFERENCES (class -> class).
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // entity -> field (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // field -> codeset: the property's option set (canonical)
	REFERENCES: EDGE_TYPES.REFERENCES, // entity -> entity FK references stay REFERENCES
};

// kinds the root owns directly (the synthesized ownership edges). Every entity is HAS_CLASS. A
// codeset (option set) is owned by its constraining field(s) via the CONSTRAINED_BY -> HAS_OPTION_SET
// translation — NOT blanket-owned by the root. ONLY a codeset referenced by ZERO fields (a true
// orphan) gets a HAS_OPTION_SET anchor from the root so nothing is unreachable; that orphan anchor is
// synthesized in a dedicated pass below (after edge translation), not via this table.
const ownershipEdgeForKind = {
	entity: EDGE_TYPES.HAS_CLASS,
};

// structural depth per role (mirrors the forge-edfi/forge-sif depth convention).
const depthByKind = {
	entity: 1,
	field: 2,
	codeset: 1,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'jedx:root';

		// stableId for a native node; throws on an empty/unknown key (R3 — never a silent malformed id).
		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-jedx R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-jedx: ${kind} produced an unclean stableId '${result.stableId}'`,
				);
			}
			return result.stableId;
		};

		// the searchText element for a role, built from structural context only.
		const searchTextElementFor = ({ role, name, owningName }) => {
			if (role === DME_ROLES.CLASS) {
				return { role, name, standardName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
			}
			if (role === DME_ROLES.PROPERTY) {
				return {
					role,
					name,
					owningClassName: owningName || STANDARD_SOURCE,
					owningName: owningName || STANDARD_SOURCE,
				};
			}
			if (role === DME_ROLES.OPTION_SET) {
				return { role, name, owningClassName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
			}
			if (role === DME_ROLES.OPTION_VALUE) {
				return {
					role,
					name,
					optionSetName: owningName,
					owningName,
					owningClassName: STANDARD_SOURCE,
				};
			}
			// DmeSupport (unused by JEDx, kept for parity with the shared builder).
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				fieldOptionSetEdges: 0, // field -> codeset HAS_OPTION_SET edges (the property's option set)
				entityReferences: 0, // entity -> entity REFERENCES edges (FK)
				orphanAnchoredCodeSets: 0, // codesets with 0 referencing fields, anchored from root
				danglingEdges: [],
			};

			// the set of codeset stableIds that a field constrains (gets HAS_OPTION_SET from a field);
			// populated during edge translation, consulted by the orphan-anchor pass.
			const constrainedCodeSetStableIds = new Set();

			// PASS 1 — index every native node and resolve its stableId + role.
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'JedxRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-jedx: unknown native JEDx label '${nativeNode.label}'`);
				}
				const key = naturalKeyByKind[spec.kind](nativeNode.properties || {});
				const stableId = stableIdFor({ kind: spec.kind, key });
				nativeIdToStable[nativeNode.id] = {
					stableId,
					role: spec.role,
					name: nativeNode.properties.name,
				};
			});

			// addEdge — canonical/reference edge, stamped structural. Resolves BOTH endpoints to
			// stableIds; an unresolved endpoint is recorded (dangling), never a partial edge.
			const addEdge = (type, fromStableId, toStableId, context) => {
				if (!fromStableId || !toStableId) {
					stats.danglingEdges.push({ type, fromStableId, toStableId, context });
					return;
				}
				edges.push({
					type,
					fromRef: { source: STANDARD_SOURCE, id: fromStableId },
					toRef: { source: STANDARD_SOURCE, id: toStableId },
					properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
				});
			};

			// makeNode — stamp the universal contract onto one node, building searchText via 1C (R4).
			const makeNode = ({ role, perStandardLabel, stableId, name, description, structural, extraProps }) => {
				const searchText = buildSearchText(
					searchTextElementFor({ role, name, owningName: structural.owningName }),
				);
				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: {
						_id: stableId, // JEDx _id === stableId (both deterministic from the natural key)
						_source: STANDARD_SOURCE,
						name: name == null ? '' : `${name}`,
						description: description || '',
						role,
						[STABLE_URI_PROPERTY_NAME]: stableId,
						searchText,
						crossRefs: JSON.stringify((extraProps && extraProps.crossRefs) || []),
						parentId: structural.parentId,
						depth: structural.depth,
						path: structural.path,
						...((extraProps && extraProps.scalar) || {}),
					},
				};
				nodes.push(node);
				return node;
			};

			// ---- DmeStandardRoot (provenance block + stableUriPropertyName + mappingInstruction) ----
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: STANDARD_SOURCE,
				standardName: STANDARD_DISPLAY,
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'JedxRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${metadata.entityCount} entities, ${metadata.fieldCount} fields, ${metadata.codesetCount} code sets`,
					role: DME_ROLES.STANDARD_ROOT,
					[STABLE_URI_PROPERTY_NAME]: ROOT_STABLE_ID,
					searchText: rootSearchText,
					// provenance block (DESIGN §B "Required on the DmeStandardRoot")
					standardKey: STANDARD_KEY,
					standardName: STANDARD_DISPLAY,
					version: metadata.version,
					// version-provenance stamp (spec §3.3, Phase A): always present post-stamping —
					// versionSource 'spec' | 'provenance-file' | 'unknown' per the precedence rule.
					snapshotKey: metadata.snapshotKey,
					publishedVersion: metadata.publishedVersion,
					versionSource: metadata.versionSource,
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles || [],
					sourceUrl: metadata.sourceUrl || '',
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism. The run timestamp lives in the store
					// row (blocks.createdAt), never in content-addressed block text.
					coreVersion: '2.0.0',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(jedxMappingInstruction),
				},
			});

			// ---- structural nodes (entities, fields, code sets) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'JedxRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning context + parent for searchText/path.
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (spec.kind === 'field' && nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// faithful native scalars (JEDx carries no CEDS columns -> no bridge stash, no crossRefs).
				const extraProps = { scalar: {}, crossRefs: [] };
				if (props.entityName) extraProps.scalar.entityName = props.entityName;
				if (props.elementType) extraProps.scalar.elementType = props.elementType;
				if (typeof props.isPrimaryKey === 'boolean') extraProps.scalar.isPrimaryKey = props.isPrimaryKey;
				if (typeof props.isForeignKey === 'boolean') extraProps.scalar.isForeignKey = props.isForeignKey;
				if (props.fieldPath) extraProps.scalar.fieldPath = props.fieldPath;
				if (props.annotation) extraProps.scalar.annotation = props.annotation;
				if (props.codeSet) extraProps.scalar.codeSet = props.codeSet;
				if (props.sourceFile) extraProps.scalar.sourceFile = props.sourceFile;
				if (typeof props.fieldCount === 'number') extraProps.scalar.fieldCount = props.fieldCount;
				if (typeof props.fkCount === 'number') extraProps.scalar.fkCount = props.fkCount;
				if (typeof props.hasPk === 'boolean') extraProps.scalar.hasPk = props.hasPk;
				if (typeof props.usedByFieldCount === 'number') extraProps.scalar.usedByFieldCount = props.usedByFieldCount;
				if (props.value) extraProps.scalar.value = props.value;

				const pathLabel =
					spec.kind === 'field' ? `${owningName}.${props.name}` : `${props.name}`;

				makeNode({
					role: spec.role,
					perStandardLabel: spec.perStandardLabel,
					stableId: self.stableId,
					name: props.name,
					description: props.description,
					structural: {
						parentId,
						depth: depthByKind[spec.kind],
						path: pathLabel,
						owningName,
					},
					extraProps,
				});

				// synthesized ownership edge from the root (HAS_CLASS for entities).
				const ownershipType = ownershipEdgeForKind[spec.kind];
				if (ownershipType) {
					addEdge(ownershipType, ROOT_STABLE_ID, self.stableId, `root->${spec.kind}`);
				}
			});

			// ---- translate native edges (the source node's own .edges and the _parentEdge) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}
				// the native _parentEdge (HAS_FIELD -> HAS_PROPERTY).
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-jedx: untranslated native parent edge type '${nativeNode._parentEdge.type}' (${nativeNode._parentEdge.fromId}->${nativeNode.id})`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}
				// the node's outgoing native edges:
				//   field CONSTRAINED_BY -> codeset  => HAS_OPTION_SET (the DmeProperty owns its DmeOptionSet)
				//   entity REFERENCES   -> entity    => REFERENCES (genuine class -> class)
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-jedx: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						stats.fieldOptionSetEdges++;
						if (target && target.stableId) {
							constrainedCodeSetStableIds.add(target.stableId);
						}
					}
					if (nativeEdge.type === 'REFERENCES') {
						stats.entityReferences++;
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			// ---- ORPHAN-ANCHOR pass: a code set (DmeOptionSet) referenced by ZERO fields would be
			// unreachable, since option sets are owned by their constraining field(s) (above), not by
			// the root. Anchor each true orphan from the DmeStandardRoot via HAS_OPTION_SET so nothing
			// is unreachable. (Mirrors EdFi/SIF reachability intent.)
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'JedxCodeSet') {
					return;
				}
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}
				if (!constrainedCodeSetStableIds.has(self.stableId)) {
					addEdge(EDGE_TYPES.HAS_OPTION_SET, ROOT_STABLE_ID, self.stableId, 'root->orphanOptionSet');
					stats.orphanAnchoredCodeSets++;
				}
			});

			if (stats.danglingEdges.length > 0) {
				throw new Error(
					`forge-jedx: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). Mirrors forge-edfi: stamps embedding +
		//   embeddingModelVersion on each node. Bounded by EMBED_BATCH_SIZE; serial batches.
		// =====================================================================
		const embedNodes = ({ nodes, nodeSubsetLimit }, callback) => {
			const targetNodes =
				nodeSubsetLimit && nodeSubsetLimit < nodes.length
					? nodes.slice(0, nodeSubsetLimit)
					: nodes;

			const batches = [];
			for (let i = 0; i < targetNodes.length; i += EMBED_BATCH_SIZE) {
				batches.push(targetNodes.slice(i, i + EMBED_BATCH_SIZE));
			}

			let embedCallCount = 0;
			let bi = 0;

			const nextBatch = () => {
				if (bi >= batches.length) {
					callback('', { embedCallCount, embeddedCount: targetNodes.length });
					return;
				}
				const batch = batches[bi];
				bi++;
				const texts = batch.map((oneNode) => oneNode.properties.searchText);
				embedder.embedTexts({ texts }, (err, result) => {
					if (err) {
						callback(`forge-jedx embedNodes batch ${bi} failed: ${err}`);
						return;
					}
					embedCallCount++;
					batch.forEach((oneNode, idx) => {
						oneNode.properties.embedding = Array.from(result.vectors[idx]);
						oneNode.embedding = oneNode.properties.embedding; // for serializeBlock
						oneNode.embeddingModelVersion = result.embeddingModelVersion;
						oneNode.properties.embeddingModelVersion = result.embeddingModelVersion;
					});
					if (xLog && xLog.status) {
						xLog.status(
							`[forge-jedx] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-edfi.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseJedx(sourcePath, {}, (err, parsed) => {
					if (err) {
						next(`forge-jedx parse: ${err}`);
						return;
					}
					// version-provenance stamp (BINDING spec §3.3, Phase A): snapshotKey +
					// publishedVersion + versionSource from the handed snapshot directory; a
					// self-described source version wins over the provenance file (disagreements
					// warned with both values named, never silently resolved).
					Object.assign(
						parsed.metadata,
						deriveVersionStamp({
							sourcePath,
							sourceVersion:
								parsed.metadata.versionSource === 'spec' ? parsed.metadata.version : null,
							warn: (message) => xLog.error(message),
						}),
					);
					next('', { ...args, parsed });
				});
			});

			// PURE deterministic shaping (throws on R3/R4 -> surfaced as forge error).
			taskList.push((args, next) => {
				let graph;
				let buildError = '';
				try {
					graph = buildContractGraph(args.parsed);
				} catch (err) {
					buildError = err.message;
				}
				if (buildError) {
					next(`forge-jedx buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-jedx] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.fieldOptionSetEdges} field->codeSet HAS_OPTION_SET, ${graph.stats.entityReferences} entity REFERENCES, ` +
						`${graph.stats.orphanAnchoredCodeSets} orphan-anchored code sets)`,
				);
				next('', { ...args, graph });
			});

			// embedding pass (skippable for the determinism comparison + cost-free structural checks).
			taskList.push((args, next) => {
				if (skipEmbedding) {
					next('', { ...args, embedCallCount: 0 });
					return;
				}
				embedNodes(
					{ nodes: args.graph.nodes, nodeSubsetLimit: embedNodeLimit },
					(err, result) => {
						if (err) {
							next(err);
							return;
						}
						next('', { ...args, embedCallCount: result.embedCallCount });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					nodes: args.graph.nodes,
					edges: args.graph.edges,
					metadata: args.parsed.metadata,
					stats: args.graph.stats,
					embedCallCount: args.embedCallCount,
					standardKey: STANDARD_KEY,
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
				});
			});
		};

		return {
			forge,
			buildContractGraph, // exported for the R3 / determinism test (pure layer)
			STANDARD_KEY,
			STANDARD_SOURCE,
			STABLE_URI_PROPERTY_NAME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
