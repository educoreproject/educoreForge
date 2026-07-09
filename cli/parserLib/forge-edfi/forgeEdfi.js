'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeEdfi.js — the EdFi forge bundle. Parses the Ed-Fi→CEDS crosswalk CSVs and emits the
// UNIVERSAL FORGE PROPERTY CONTRACT (the SAME contract forge-sif/forge-ceds emit), so EdFi lands in
// the validation graph interoperably. CSV-family trailblazer; mirrors forge-sif/forgeSif.js exactly.
//
// HARVESTED+ADAPTED from the OLD forge-edfi (lib/parser.js navigation reused; node-shaping rewritten):
//   * the OLD tool emitted private Edfi* nodes (EdfiEntity/EdfiField/EdfiDescriptor/
//     EdfiDescriptorValue) with hand-rolled native edges (HAS_ENTITY, HAS_FIELD, CONSTRAINED_BY,
//     HAS_VALUE) and an older node contract.
//   * THIS module maps each native node to one of the canonical Dme* roles: EdfiEntity -> DmeClass;
//     EdfiField -> DmeProperty; EdfiDescriptor -> DmeOptionSet; EdfiDescriptorValue -> DmeOptionValue
//     (EdFi has no DmeSupport role). It builds searchText via the ONE shared 1C builder (structural
//     context only), assigns deterministic synthetic stableIds (edfi:<kind>/<naturalKey>; EdFi
//     crosswalk elements have no native URI — a path-based key, mirroring SIF's STEEL_WHEEL ruling),
//     and writes the canonical ownership edges (HAS_CLASS/HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE) plus
//     a translated internal reference (REFERENCES: a Descriptor-typed property -> its option set),
//     all stamped provenanceTier 'structural'.
//
// PURITY (forge is PURE/deterministic for (source, module)): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source. forge() runs parse -> buildContractGraph
// -> embedNodes. An R3 normalization miss or empty searchText (R4) THROWS — surfaced as a forge error.
//
// BRIDGE PURITY: this is a STANDARD-PURE EdFi block — _source='EdFi', EdFi's own nodes + intra-EdFi
// structural edges ONLY. The CEDS target columns (cedsGlobalIds on fields, cedsGlobalId on
// descriptors, cedsOptionCode on values) are BRIDGE data for a LATER phase: stashed as node
// properties (and canonical cedsId where present) for later bridging, but NO cross-standard mapping
// edge is emitted here.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseEdfi = require('./lib/parser');
const normalize = require('./lib/normalize');

const CORE_LIB = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'npm',
	'qtools-graph-forge-core',
	'lib',
);
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
// the central structural-property authority (Wave-2 items 5/6; M7/M8): enforces the parentId ->
// member-stableId referent, derives depth (= parentId-chain length), stamps crossRefs universally,
// and aligns single-owner optionSet parenting. Called as buildContractGraph's LAST step.
const { finalizeStructuralContract } = require(
	path.join(CORE_LIB, 'structural-contract', 'structural-contract'),
);

const STANDARD_KEY = 'edfi';
const STANDARD_SOURCE = 'EdFi'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'Ed-Fi Data Standard';
const STABLE_URI_PROPERTY_NAME = 'edfiStableId';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.
const CEDS_ANCHOR_PROPERTY_NAME = 'CEDSGlobalId'; // the native crosswalk column (origin, recorded for provenance)
const CEDS_OPTION_ANCHOR_PROPERTY_NAME = 'CEDSOptionCode'; // the native option crosswalk column

// The mappingInstruction fields are DECLARED on the DmeStandardRoot. EdFi bridges TO the CEDS hub
// (impliedTargets ['CEDS']); its native CEDS anchor origin is the crosswalk global-id column. The
// generic -specified bridge (a LATER phase) resolves EdFi.cedsId == CedsProperty.cedsId.
const edfiMappingInstruction = {
	cedsOriginalAnchorPropertyName: [CEDS_ANCHOR_PROPERTY_NAME],
	cedsOptionOriginalAnchorPropertyName: [CEDS_OPTION_ANCHOR_PROPERTY_NAME],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch.
const roleSpecByNativeLabel = {
	EdfiEntity: { role: DME_ROLES.CLASS, kind: 'entity', perStandardLabel: 'EdfiEntity' },
	EdfiField: { role: DME_ROLES.PROPERTY, kind: 'field', perStandardLabel: 'EdfiField' },
	EdfiDescriptor: { role: DME_ROLES.OPTION_SET, kind: 'descriptor', perStandardLabel: 'EdfiDescriptor' },
	EdfiDescriptorValue: {
		role: DME_ROLES.OPTION_VALUE,
		kind: 'descriptorValue',
		perStandardLabel: 'EdfiDescriptorValue',
	},
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
const naturalKeyByKind = {
	entity: (props) => props.tableName || props.name,
	field: (props) => `${props.entityName}.${props.name}`,
	descriptor: (props) => props.name,
	descriptorValue: (props) => `${props.descriptorName}.${props.name}`,
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-sif/forgeSif.js:95 EXACTLY:
// HAS_FIELD/HAS_VALUE are canonical ownership reached through the native _parentEdge; CONSTRAINED_BY
// (a Descriptor-typed field's codeset constraint) becomes HAS_OPTION_SET FROM THE DmeProperty TO THE
// DmeOptionSet — the property OWNS its option set, exactly like SIF's CONSTRAINED_BY -> HAS_OPTION_SET.
// A genuine entity->entity reference (should EdFi ever carry one natively) stays REFERENCES.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // entity -> field (from the native _parentEdge)
	HAS_VALUE: EDGE_TYPES.HAS_VALUE, // descriptor -> value (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // field -> descriptor: the property's option set (SIF-canonical)
	REFERENCES: EDGE_TYPES.REFERENCES, // genuine entity -> entity references stay REFERENCES
};

// kinds the root owns directly (the synthesized ownership edges). Every entity is HAS_CLASS. A
// descriptor (option set) is owned by its constraining field(s) via the CONSTRAINED_BY ->
// HAS_OPTION_SET translation — NOT blanket-owned by the root. ONLY a descriptor referenced by ZERO
// fields (a true orphan) gets a HAS_OPTION_SET anchor from the root so nothing is unreachable; that
// orphan anchor is synthesized in a dedicated pass below (after edge translation), not via this table.
const ownershipEdgeForKind = {
	entity: EDGE_TYPES.HAS_CLASS,
};

// structural depth per role (mirrors the forge-sif/forge-ceds depth convention).
const depthByKind = {
	entity: 1,
	field: 2,
	descriptor: 1,
	descriptorValue: 2,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'edfi:root';

		// stableId for a native node; throws on an empty/unknown key (R3 — never a silent malformed id).
		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-edfi R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-edfi: ${kind} produced an unclean stableId '${result.stableId}'`,
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
			// DmeSupport (unused by EdFi, kept for parity with the shared builder).
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				crossRefsAnnotated: 0, // fields carrying a canonical CEDS cross-ref (bridge stash)
				descriptorCrossRefs: 0, // descriptors carrying a canonical CEDS cross-ref (bridge stash)
				optionValuesEmitted: 0,
				fieldOptionSetEdges: 0, // field -> descriptor HAS_OPTION_SET edges (the property's option set)
				orphanAnchoredDescriptors: 0, // descriptors with 0 referencing fields, anchored from root
				danglingEdges: [],
			};

			// the set of descriptor stableIds that a field constrains (gets HAS_OPTION_SET from a field);
			// populated during edge translation, consulted by the orphan-anchor pass.
			const constrainedDescriptorStableIds = new Set();

			// PASS 1 — index every native node and resolve its stableId + role.
			const nativeById = {};
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				nativeById[nativeNode.id] = nativeNode;
				if (nativeNode.label === 'EdfiRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-edfi: unknown native EdFi label '${nativeNode.label}'`);
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
						_id: stableId, // EdFi _id === stableId (both deterministic from the natural key)
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
			const rootNative = nativeNodes.find((n) => n.label === 'EdfiRoot');
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: STANDARD_SOURCE,
				standardName: STANDARD_DISPLAY,
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'EdfiRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${metadata.entityCount} entities, ${metadata.fieldCount} fields, ${metadata.descriptorCount} descriptors, ${metadata.descriptorValueCount} descriptor values`,
					role: DME_ROLES.STANDARD_ROOT,
					[STABLE_URI_PROPERTY_NAME]: ROOT_STABLE_ID,
					searchText: rootSearchText,
					// provenance block (DESIGN §B "Required on the DmeStandardRoot")
					standardKey: STANDARD_KEY,
					standardName: STANDARD_DISPLAY,
					version: metadata.version,
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles || [],
					sourceUrl: metadata.sourceUrl || '',
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism. The run timestamp lives in the store
					// row (blocks.createdAt), never in content-addressed block text.
					coreVersion: '2.0.0',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(edfiMappingInstruction),
				},
			});

			// ---- structural nodes (entities, fields, descriptors, descriptor values) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'EdfiRoot') {
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
				if (spec.kind === 'descriptorValue' && nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// faithful native scalars + BRIDGE-stash cross-refs (stashed, NOT edged).
				const extraProps = { scalar: {}, crossRefs: [] };
				if (props.entityName) extraProps.scalar.entityName = props.entityName;
				if (props.elementType) extraProps.scalar.elementType = props.elementType;
				if (typeof props.required === 'boolean') extraProps.scalar.required = props.required;
				if (props.entityPath) extraProps.scalar.entityPath = props.entityPath;
				if (props.namespace) extraProps.scalar.namespace = props.namespace;
				if (props.tableName) extraProps.scalar.tableName = props.tableName;
				if (props.shortDescription) extraProps.scalar.shortDescription = props.shortDescription;

				// FIELD cross-ref to a CEDS *property* (bridge stash): canonicalize the FIRST present
				// global-id to P###### (R3 — throw on a present-but-unnormalizable annotation), stash
				// the resolver property + crossRefs. NO edge is emitted (pure EdFi block).
				if (spec.kind === 'field' && Array.isArray(props.cedsGlobalIds) && props.cedsGlobalIds.length) {
					const crossRefs = [];
					let canonicalCedsId = null;
					props.cedsGlobalIds.forEach((rawId) => {
						const norm = normalize.normalizeCedsCrossRef({ rawValue: rawId });
						if (norm.absent) {
							return;
						}
						if (norm.error) {
							throw new Error(
								`forge-edfi R3 CEDS cross-ref miss on field '${props.entityName}.${props.name}': ${norm.error}`,
							);
						}
						if (!canonicalCedsId) {
							canonicalCedsId = norm.cedsId;
						}
						crossRefs.push({
							system: 'ceds',
							id: norm.cedsId,
							raw: `${rawId}`,
							locator: CEDS_ANCHOR_PROPERTY_NAME,
						});
					});
					if (canonicalCedsId) {
						extraProps.scalar.cedsId = canonicalCedsId; // the property -specified resolves on
						extraProps.scalar.cedsOriginalAnchorPropertyName = [CEDS_ANCHOR_PROPERTY_NAME];
						extraProps.crossRefs = crossRefs;
						stats.crossRefsAnnotated++;
					}
				}

				// DESCRIPTOR cross-ref to a CEDS element (bridge stash).
				if (spec.kind === 'descriptor' && props.cedsGlobalId != null && `${props.cedsGlobalId}`.trim() !== '') {
					const norm = normalize.normalizeCedsCrossRef({ rawValue: props.cedsGlobalId });
					if (norm.error) {
						throw new Error(
							`forge-edfi R3 CEDS cross-ref miss on descriptor '${props.name}': ${norm.error}`,
						);
					}
					if (!norm.absent) {
						extraProps.scalar.cedsId = norm.cedsId;
						extraProps.scalar.cedsOriginalAnchorPropertyName = [CEDS_ANCHOR_PROPERTY_NAME];
						extraProps.crossRefs = [
							{
								system: 'ceds',
								id: norm.cedsId,
								raw: `${props.cedsGlobalId}`,
								locator: CEDS_ANCHOR_PROPERTY_NAME,
							},
						];
						stats.descriptorCrossRefs++;
					}
				}

				// DESCRIPTOR VALUE cross-ref to a CEDS option code (bridge stash — kept raw, no P-form).
				if (spec.kind === 'descriptorValue' && props.cedsOptionCode != null && `${props.cedsOptionCode}`.trim() !== '') {
					extraProps.scalar.cedsOptionCode = `${props.cedsOptionCode}`;
					extraProps.scalar.cedsOptionOriginalAnchorPropertyName = [CEDS_OPTION_ANCHOR_PROPERTY_NAME];
					extraProps.crossRefs = [
						{
							system: 'ceds',
							optionCode: `${props.cedsOptionCode}`,
							locator: CEDS_OPTION_ANCHOR_PROPERTY_NAME,
						},
					];
				}

				const pathLabel =
					spec.kind === 'field'
						? `${owningName}.${props.name}`
						: spec.kind === 'descriptorValue'
							? `${owningName}.${props.name}`
							: `${props.name}`;

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

				if (spec.kind === 'descriptorValue') {
					stats.optionValuesEmitted++;
				}

				// synthesized ownership edge from the root (HAS_CLASS / HAS_OPTION_SET).
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
				// the native _parentEdge (HAS_FIELD -> HAS_PROPERTY; HAS_VALUE -> HAS_VALUE).
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-edfi: untranslated native parent edge type '${nativeNode._parentEdge.type}' (${nativeNode._parentEdge.fromId}->${nativeNode.id})`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}
				// the node's outgoing native edges (field CONSTRAINED_BY -> descriptor => HAS_OPTION_SET:
				// the DmeProperty owns its DmeOptionSet, SIF-canonical).
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-edfi: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						stats.fieldOptionSetEdges++;
						if (target && target.stableId) {
							constrainedDescriptorStableIds.add(target.stableId);
						}
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			// ---- ORPHAN-ANCHOR pass: a descriptor (DmeOptionSet) referenced by ZERO fields would be
			// unreachable, since option sets are owned by their constraining field(s) (above), not by
			// the root. Anchor each true orphan from the DmeStandardRoot via HAS_OPTION_SET so nothing
			// is unreachable. (Mirrors SIF's reachability intent; SIF codesets are always field-owned,
			// so SIF had no orphans — EdFi descriptors can exist with no constraining field.)
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'EdfiDescriptor') {
					return;
				}
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}
				if (!constrainedDescriptorStableIds.has(self.stableId)) {
					addEdge(EDGE_TYPES.HAS_OPTION_SET, ROOT_STABLE_ID, self.stableId, 'root->orphanOptionSet');
					stats.orphanAnchoredDescriptors++;
				}
			});

			if (stats.danglingEdges.length > 0) {
				throw new Error(
					`forge-edfi: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). Mirrors forge-sif: stamps embedding +
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
						callback(`forge-edfi embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-edfi] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-sif.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseEdfi(sourcePath, {}, (err, parsed) => {
					if (err) {
						next(`forge-edfi parse: ${err}`);
						return;
					}
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
					next(`forge-edfi buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-edfi] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.crossRefsAnnotated} CEDS-annotated fields, ${graph.stats.descriptorCrossRefs} CEDS-annotated descriptors, ` +
						`${graph.stats.optionValuesEmitted} option values, ${graph.stats.fieldOptionSetEdges} field->optionSet HAS_OPTION_SET, ` +
						`${graph.stats.orphanAnchoredDescriptors} orphan-anchored descriptors)`,
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
