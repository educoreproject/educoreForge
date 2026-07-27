'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSif.js — the SIF forge bundle. Parses the SIF Implementation Specification TSV and emits the
// UNIVERSAL FORGE PROPERTY CONTRACT (DESIGN §A-§F, DECISIONS §6-§12, §23-R3/R4) — the SAME contract
// forge-ceds emits, so SIF lands in golden interoperably.
//
// HARVESTED+ADAPTED from trackA forge-sif-tsv (lib/parser.js reused VERBATIM as the harvest source;
// node-shaping rewritten here):
//   * trackA emitted private Sif* nodes (SifObject/SifField/SifComplexType/SifCodeset/SifSimpleType/
//     SifPrimitiveType/SifXmlElement) with hand-rolled searchText and native edges (HAS_FIELD,
//     CONSTRAINED_BY, MEMBER_OF, USES_COMPLEX_TYPE, CONTAINS, HAS_TYPE, REALIZED_BY, ...).
//   * THIS module maps each native node to one of the six canonical Dme* roles (ruling STEEL_WHEEL
//     2026-06-22): SifObject + SifComplexType -> DmeClass; SifField -> DmeProperty; SifCodeset ->
//     DmeOptionSet; codeset values (a native array property) are EXPANDED into DmeOptionValue nodes;
//     SifSimpleType/SifPrimitiveType/SifXmlElement -> DmeSupport. It builds searchText via the ONE
//     shared 1C builder (structural context only), assigns deterministic synthetic stableIds
//     (sif:<kind>/<naturalKey>; SIF RefId is instance-level, so a path-based key — confirmed with
//     STEEL_WHEEL), canonicalizes the native 'CEDS ID' annotation to cedsId='P######' (the property
//     the generic -specified bridge resolves on) + captures it raw in crossRefs JSON, and writes the
//     canonical ownership edges (HAS_CLASS/HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE/HAS_SUPPORT) plus
//     translated internal edges (REFERENCES), all stamped provenanceTier 'structural'.
//
// PURITY (DESIGN "forge is PURE/deterministic for (source, module)"): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source — same source -> identical nodes/edges
// (modulo embeddings, added in a separate embedNodes pass). forge() runs parse -> buildContractGraph
// -> embedNodes. An R3 normalization miss or empty searchText (R4) THROWS — surfaced as a forge error.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseSif = require('./lib/parser');
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

const STANDARD_KEY = 'sif';
const STANDARD_SOURCE = 'SIF'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'SIF Implementation Specification';
const STABLE_URI_PROPERTY_NAME = 'sifStableId';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.
const CEDS_ANCHOR_PROPERTY_NAME = 'CEDS ID'; // the native annotation column (origin, recorded for provenance)

// The mappingInstruction fields are DECLARED on the DmeStandardRoot (DECISIONS §12). SIF bridges TO
// the CEDS hub (impliedTargets ['CEDS']); its native CEDS anchor origin is the 'CEDS ID' column.
const sifMappingInstruction = {
	cedsOriginalAnchorPropertyName: [CEDS_ANCHOR_PROPERTY_NAME],
	cedsOptionOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch (ruling 2026-06-22).
const roleSpecByNativeLabel = {
	SifObject: { role: DME_ROLES.CLASS, kind: 'object', perStandardLabel: 'SifObject' },
	SifComplexType: { role: DME_ROLES.CLASS, kind: 'complexType', perStandardLabel: 'SifComplexType' },
	SifField: { role: DME_ROLES.PROPERTY, kind: 'field', perStandardLabel: 'SifField' },
	SifCodeset: { role: DME_ROLES.OPTION_SET, kind: 'codeset', perStandardLabel: 'SifCodeset' },
	SifSimpleType: { role: DME_ROLES.SUPPORT, kind: 'simpleType', perStandardLabel: 'SifSimpleType' },
	SifPrimitiveType: { role: DME_ROLES.SUPPORT, kind: 'primitiveType', perStandardLabel: 'SifPrimitiveType' },
	SifXmlElement: { role: DME_ROLES.SUPPORT, kind: 'xmlElement', perStandardLabel: 'SifXmlElement' },
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
const naturalKeyByKind = {
	object: (props) => props.tableName,
	complexType: (props) => props.name,
	field: (props) => props.xpath,
	codeset: (props) => props.fingerprint,
	simpleType: (props) => props.name,
	primitiveType: (props) => props.name,
	xmlElement: (props) => props.path,
};

// native edge type -> canonical/REFERENCES (all stamped 'structural'). HAS_PROPERTY/HAS_OPTION_SET
// are canonical ownership; the rest are non-ownership internal references (DESIGN §F). Synthesized
// ownership edges (HAS_CLASS/HAS_SUPPORT/HAS_VALUE) are added directly, not via this table.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // object -> field (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // field -> codeset (a property's option set)
	USES_COMPLEX_TYPE: EDGE_TYPES.REFERENCES,
	CONTAINS: EDGE_TYPES.REFERENCES,
	HAS_TYPE: EDGE_TYPES.REFERENCES,
	MEMBER_OF: EDGE_TYPES.REFERENCES,
	HAS_ROOT_ELEMENT: EDGE_TYPES.REFERENCES,
	CHILD_ELEMENT: EDGE_TYPES.REFERENCES,
	TYPED_AS: EDGE_TYPES.REFERENCES,
	REALIZED_BY: EDGE_TYPES.REFERENCES,
	REFERENCES: EDGE_TYPES.REFERENCES,
};

// kinds that the root owns directly (the synthesized HAS_CLASS / HAS_SUPPORT ownership edges).
const ownershipEdgeForKind = {
	object: EDGE_TYPES.HAS_CLASS,
	complexType: EDGE_TYPES.HAS_CLASS,
	simpleType: EDGE_TYPES.HAS_SUPPORT,
	primitiveType: EDGE_TYPES.HAS_SUPPORT,
	xmlElement: EDGE_TYPES.HAS_SUPPORT,
};

// structural depth per role (mirrors the forge-ceds depth convention).
const depthByKind = {
	object: 1,
	complexType: 1,
	field: 2,
	codeset: 2,
	optionValue: 3,
	simpleType: 1,
	primitiveType: 1,
	xmlElement: 1,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'sif:root';

		// stableId (and _id, which equals it for SIF — both deterministic from the natural key) for a
		// native node; throws on an empty/unknown key (R3 — never a silent malformed id).
		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-sif R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-sif: ${kind} produced an unclean stableId '${result.stableId}'`,
				);
			}
			return result.stableId;
		};

		// the searchText element for a role, built from structural context only (DECISIONS §8).
		const searchTextElementFor = ({ role, name, owningName }) => {
			if (role === DME_ROLES.CLASS) {
				return { role, name, standardName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
			}
			if (role === DME_ROLES.PROPERTY) {
				return { role, name, owningClassName: owningName || STANDARD_SOURCE, owningName: owningName || STANDARD_SOURCE };
			}
			if (role === DME_ROLES.OPTION_SET) {
				return { role, name, owningClassName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
			}
			if (role === DME_ROLES.OPTION_VALUE) {
				return { role, name, optionSetName: owningName, owningName, owningClassName: STANDARD_SOURCE };
			}
			// DmeSupport
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			// stats surfaced to the caller (counts, not silent): annotated/orphaned cross-refs,
			// field-less complex types (the flag STEEL_WHEEL asked for), expanded option values.
			const stats = {
				crossRefsAnnotated: 0,
				fieldlessComplexTypes: 0,
				optionValuesExpanded: 0,
				// codeset dedup surface (STEEL_WHEEL refinement): SIF codesets are unnamed inline
				// enumerations keyed by value-fingerprint, so value-identical enumerations across
				// different fields MERGE into one DmeOptionSet by design. codesetUnique = the merged
				// node count; codesetAssignments = how many fields point at a codeset. The difference
				// is the dedup/collision factor — surfaced so we can verify the merge is not wrong.
				codesetUnique: 0,
				codesetAssignments: 0,
				danglingEdges: [],
			};

			// PASS 1 — index every native node and resolve its stableId + role. nativeIdToStable maps a
			// native node id (e.g. 'siffield-<xpath>') to { stableId, role, name } for edge resolution.
			const nativeById = {};
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				nativeById[nativeNode.id] = nativeNode;
				if (nativeNode.label === 'SifRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-sif: unknown native SIF label '${nativeNode.label}'`);
				}
				const key = naturalKeyByKind[spec.kind](nativeNode.properties || {});
				const stableId = stableIdFor({ kind: spec.kind, key });
				nativeIdToStable[nativeNode.id] = {
					stableId,
					role: spec.role,
					name: nativeNode.properties.name,
				};
			});

			// addEdge — canonical/reference edge, stamped structural (DECISIONS §11). Resolves BOTH
			// endpoints to stableIds; an unresolved endpoint is recorded (dangling), never a partial edge.
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
				const searchText = buildSearchText(searchTextElementFor({ role, name, owningName: structural.owningName }));
				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: {
						_id: stableId, // SIF _id === stableId (both deterministic from the natural key)
						_source: STANDARD_SOURCE,
						name: name == null ? '' : `${name}`,
						description: description || '',
						role,
						[STABLE_URI_PROPERTY_NAME]: stableId, // the stable identifier, under stableUriPropertyName
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
				labels: [NODE_LABELS.FORGED_NODE, 'SifRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${metadata.objectCount} objects, ${metadata.fieldCount} fields`,
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
					mappingInstruction: JSON.stringify(sifMappingInstruction),
				},
			});

			// ---- structural nodes (objects, complexTypes, fields, codesets, support) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'SifRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning class name (for a field's searchText/path) — its native parent object.
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (spec.kind === 'field' && nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// flag field-less complex types (potential DmeSupport refinement; kept DmeClass per ruling).
				if (spec.kind === 'complexType' && (props.fieldCount || 0) === 0) {
					stats.fieldlessComplexTypes++;
				}

				// CEDS cross-ref (annotated fields only): canonicalize to P###### (R3 — throw on a
				// present-but-unnormalizable annotation) and stamp the resolver property + crossRefs.
				const extraProps = { scalar: {}, crossRefs: [] };
				if (spec.kind === 'field' && props.cedsId != null && `${props.cedsId}`.trim() !== '') {
					const norm = normalize.normalizeCedsCrossRef({ rawValue: props.cedsId });
					if (norm.error) {
						throw new Error(
							`forge-sif R3 CEDS cross-ref miss on field '${props.xpath}': ${norm.error}`,
						);
					}
					extraProps.scalar.cedsId = norm.cedsId; // the property -specified resolves on
					extraProps.scalar.cedsOriginalAnchorPropertyName = [CEDS_ANCHOR_PROPERTY_NAME];
					extraProps.crossRefs = [
						{
							system: 'ceds',
							id: norm.cedsId,
							raw: `${props.cedsId}`,
							locator: CEDS_ANCHOR_PROPERTY_NAME,
						},
					];
					stats.crossRefsAnnotated++;
				}

				// a few faithful native scalars worth keeping queryable on the node.
				if (props.xpath) extraProps.scalar.xpath = props.xpath;
				if (props.tableName) extraProps.scalar.tableName = props.tableName;
				if (typeof props.mandatory === 'boolean') extraProps.scalar.mandatory = props.mandatory;
				if (props.category) extraProps.scalar.category = props.category;

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

				// synthesized ownership edge from the root (HAS_CLASS / HAS_SUPPORT).
				const ownershipType = ownershipEdgeForKind[spec.kind];
				if (ownershipType) {
					addEdge(ownershipType, ROOT_STABLE_ID, self.stableId, `root->${spec.kind}`);
				}

				if (spec.kind === 'codeset') {
					stats.codesetUnique++;
				}

				// ---- EXPAND codeset values into DmeOptionValue nodes + HAS_VALUE edges ----
				if (spec.kind === 'codeset' && Array.isArray(props.values)) {
					const setName = props.name;
					props.values.forEach((rawValue) => {
						const value = `${rawValue}`;
						const valueStableId = stableIdFor({
							kind: 'optionValue',
							key: `${props.fingerprint}/${value}`,
						});
						makeNode({
							role: DME_ROLES.OPTION_VALUE,
							perStandardLabel: 'SifCodesetValue',
							stableId: valueStableId,
							name: value,
							description: '',
							structural: {
								parentId: self.stableId,
								depth: depthByKind.optionValue,
								path: `${setName}.${value}`,
								owningName: setName,
							},
							extraProps: { scalar: {}, crossRefs: [] },
						});
						addEdge(EDGE_TYPES.HAS_VALUE, self.stableId, valueStableId, 'codeset->value');
						stats.optionValuesExpanded++;
					});
				}
			});

			// ---- translate native edges (the source node's own .edges and the field _parentEdge) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}
				// the field's HAS_FIELD reverse edge (object -> field) becomes HAS_PROPERTY.
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					addEdge(
						canonical || EDGE_TYPES.REFERENCES,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}
				// the node's outgoing native edges.
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						stats.codesetAssignments++;
					}
					if (!canonical) {
						throw new Error(
							`forge-sif: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			if (stats.danglingEdges.length > 0) {
				throw new Error(
					`forge-sif: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). Mirrors forge-ceds: stamps embedding +
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
						callback(`forge-sif embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-sif] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-ceds.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding, resolutionMapPath } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseSif(sourcePath, { resolutionMapPath }, (err, parsed) => {
					if (err) {
						next(`forge-sif parse: ${err}`);
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
					next(`forge-sif buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-sif] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.crossRefsAnnotated} CEDS-annotated fields, ${graph.stats.optionValuesExpanded} option values, ` +
						`${graph.stats.fieldlessComplexTypes} field-less complex types; codesets ${graph.stats.codesetUnique} unique ` +
						`from ${graph.stats.codesetAssignments} field assignments = ${graph.stats.codesetAssignments - graph.stats.codesetUnique} merged)`,
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
