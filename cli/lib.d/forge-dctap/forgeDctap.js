'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeDctap.js — the DCTAP forge bundle. Parses the Dublin Core Tabular Application Profile JSON-LD
// meta-vocabulary (dctap-elements.jsonld) and emits the UNIVERSAL FORGE PROPERTY CONTRACT (the SAME
// contract forge-ctdl / forge-ceds / forge-edfi emit), so DCTAP lands in the validation graph
// interoperably. JSON-LD family — follows the CTDL trailblazer + forgeCampaignRunbook-JSONLD.md.
//
// JSON-LD ROLE-MAPPING DECISION (CODE FACT — verified against the real source; a PER-STANDARD
// adjustment of the CTDL family mapping, documented in forgeReport-dctap.md). DCTAP's @types are
// dme:-namespaced (Standard/Component/Element/AllowedValueSet/AllowedValue/Concept), NOT the CTDL
// rdfs:Class/rdf:Property forms, so the mapping is by DCTAP @type:
//   Component        -> DmeClass        (2)   shape, statementTemplate — structural containers
//   Element          -> DmeProperty     (12)  the columns belonging to a component
//   AllowedValueSet  -> DmeOptionSet    (3)   a controlled enumeration = an option set
//   AllowedValue     -> DmeOptionValue  (15)  a vocabulary term = an option value
//   Concept          -> DmeClass        (3)   Profile/Shape/StatementTemplate — a SKOS broader
//                                             glossary hierarchy; broader -> SUBCLASS_OF. Modeled as
//                                             classes (term nodes with a subclass hierarchy), NOT as
//                                             option values (they are not members of any value set).
//   Standard         -> DmeStandardRoot (1)
//   (no DmeSupport — DCTAP declares no datatype/support scaffolding worth a node.)
//
// IDENTITY IS NATIVE-URI (DESIGN §D — the CEDS/URI model, the JSON-LD-family default): every DCTAP
// term carries a globally-unique CURIE in `@id` (e.g. dctap:shape, dctap:propertyID,
// dctap:_booleanValueSet). The stableId IS that CURIE and stableUriPropertyName = 'uri'. No path
// minting is needed.
//
// EDGE CONVENTION (MANDATORY — the property OWNS its option set):
//   native HAS_FIELD     (component<-element, from belongsToComponent) -> HAS_PROPERTY
//   native HAS_VALUE     (set<-value, from the set's hasValue list)     -> HAS_VALUE
//   native CONSTRAINED_BY(element->set, from constrainedBy)             -> HAS_OPTION_SET
//        (FROM the DmeProperty TO the DmeOptionSet — the property owns its option set; NEVER REFERENCES)
//   native SUBCLASS_OF   (concept->concept, from skos:broader)          -> SUBCLASS_OF
//   root synthesizes HAS_CLASS to every DmeClass (both Components AND Concepts). An option set
//   constrained by ZERO elements is a true orphan -> anchored from the root via HAS_OPTION_SET
//   (dedicated pass after edge translation) so nothing is unreachable. Report the orphan-anchored
//   count. (DCTAP has NO REFERENCES edges — there are no property->class references in the source.)
//
// STANDARD-PURE: DCTAP is a META-vocabulary for describing application profiles — it carries NO
// cross-standard (CEDS) anchors of any kind. Unlike forge-ctdl, this forge emits NO cedsId / crossRef
// stash and NO cross-standard edge. The mappingInstruction declares no implied targets.
//
// PURITY: buildContractGraph is a PURE, synchronous, deterministic function of the parsed source —
// same source -> identical nodes/edges (modulo embeddings, added in a separate embedNodes pass).
// forge() runs parse -> buildContractGraph -> embedNodes. An R3 normalization miss, an empty
// searchText (R4), or an unresolved edge endpoint THROWS — surfaced as a forge error.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseDctap = require('./lib/parser');
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

const STANDARD_KEY = 'dctap';
const STANDARD_SOURCE = 'DCTAP'; // === the registry standardName, EXACT (no toLower anywhere)
const STANDARD_DISPLAY = 'Dublin Core Tabular Application Profile';
const STABLE_URI_PROPERTY_NAME = 'uri';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.

// native per-standard label -> { role, kind }. Registry, not switch.
// NOTE the per-standard adjustment: DctapConcept -> DmeClass (a glossary subclass hierarchy), not an
// option value. DctapComponent is also a DmeClass.
const roleSpecByNativeLabel = {
	DctapComponent: { role: DME_ROLES.CLASS, kind: 'class' },
	DctapConcept: { role: DME_ROLES.CLASS, kind: 'class' },
	DctapElement: { role: DME_ROLES.PROPERTY, kind: 'property' },
	DctapAllowedValueSet: { role: DME_ROLES.OPTION_SET, kind: 'optionSet' },
	DctapAllowedValue: { role: DME_ROLES.OPTION_VALUE, kind: 'optionValue' },
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-ctdl / forge-edfi.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // component -> element (from the native _parentEdge)
	HAS_VALUE: EDGE_TYPES.HAS_VALUE, // set -> value (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // element -> set: the property's option set (the property owns it)
	SUBCLASS_OF: EDGE_TYPES.SUBCLASS_OF, // concept -> concept (from skos:broader)
	REFERENCES: EDGE_TYPES.REFERENCES, // (none in DCTAP, kept for family symmetry)
};

// structural depth per kind (mirrors the forge-ctdl depth convention).
const depthByKind = {
	class: 1,
	property: 2,
	optionSet: 1,
	optionValue: 2,
};

// The mappingInstruction is DECLARED on the DmeStandardRoot (DECISIONS §12). DCTAP is a META-
// vocabulary and STANDARD-PURE: it bridges to NOTHING, so no implied targets and no crosswalk anchor.
const dctapMappingInstruction = {
	cedsOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: false,
	impliedTargets: [],
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'dctap:DCTAP'; // the source's own Standard @id is the root stableId.

		// -----
		// _id from natural keys (DESIGN §B "deterministic from natural keys"):
		//   <standardKey>|<stableId>. The CURIE already contains a ':', so use a '|' joiner to keep
		//   _id parseable (matches forge-ctdl: `dctap|dctap:shape`).
		const idFor = (stableId) => `${STANDARD_KEY}|${stableId}`;

		// resolve + validate the stableId for a native node; throws on a blank @id (R3, never silent).
		const stableIdFor = (rawId) => {
			const result = normalize.buildStableId({ id: rawId });
			if (result.error) {
				throw new Error(`forge-dctap R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-dctap: produced an unclean stableId '${result.stableId}' from @id '${rawId}'`,
				);
			}
			return result.stableId;
		};

		// the searchText element for a role, built from structural context only (the 1C builder).
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
			// DmeOptionValue
			return {
				role,
				name,
				optionSetName: owningName,
				owningName,
				owningClassName: STANDARD_SOURCE,
			};
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				propertyOptionSetEdges: 0, // element -> set HAS_OPTION_SET edges
				orphanAnchoredOptionSets: 0, // sets constrained by 0 elements, anchored from root
				subClassOfEdges: 0, // concept -> concept SUBCLASS_OF
				referencesEdges: 0, // none in DCTAP
				danglingEdges: [],
			};

			// option-set stableIds that received a property->optionset edge (consulted by orphan pass).
			const constrainedOptionSetStableIds = new Set();

			// PASS 1 — index every native node, resolve its stableId + role + display name.
			const nativeIdToSelf = {};
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'DctapRoot') {
					nativeIdToSelf[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-dctap: unknown native DCTAP label '${nativeNode.label}'`);
				}
				const stableId = stableIdFor(nativeNode.id);
				nativeIdToSelf[nativeNode.id] = {
					stableId,
					role: spec.role,
					kind: spec.kind,
					name: nativeNode.properties.name,
				};
			});

			// addEdge — canonical edge, stamped structural. Resolves BOTH endpoints to stableIds; an
			//   unresolved endpoint is recorded (dangling), never a partial edge.
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
			const makeNode = ({ self, name, description, owningName, extraProps, structural }) => {
				const searchText = buildSearchText(
					searchTextElementFor({ role: self.role, name, owningName }),
				);
				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabelFor(self.role), self.role],
					stableId: self.stableId,
					role: self.role,
					properties: {
						_id: idFor(self.stableId),
						_source: STANDARD_SOURCE,
						name: name == null ? '' : `${name}`,
						description: description || '',
						role: self.role,
						[STABLE_URI_PROPERTY_NAME]: self.stableId,
						searchText,
						crossRefs: JSON.stringify((extraProps && extraProps.crossRefs) || []),
						...((extraProps && extraProps.scalar) || {}),
					},
				};
				if (structural) {
					node.properties.parentId = structural.parentId;
					node.properties.depth = structural.depth;
					node.properties.path = structural.path;
				}
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
				labels: [NODE_LABELS.FORGED_NODE, 'DctapRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: idFor(ROOT_STABLE_ID),
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} (Dublin Core Metadata Initiative) — ${metadata.componentCount} components, ${metadata.elementCount} elements, ${metadata.conceptCount} concepts, ${metadata.allowedValueSetCount} allowed-value sets, ${metadata.allowedValueCount} allowed values`,
					role: DME_ROLES.STANDARD_ROOT,
					[STABLE_URI_PROPERTY_NAME]: ROOT_STABLE_ID,
					searchText: rootSearchText,
					crossRefs: JSON.stringify([]),
					// provenance block (DESIGN §B "Required on the DmeStandardRoot")
					standardKey: STANDARD_KEY,
					standardName: STANDARD_DISPLAY,
					version: metadata.version,
					// versionSource passthrough (2026-07-04): stamped ONLY when the parser traced the
					// version to the spec content; absent otherwise (finisher 'declared' covers honestly).
					...(metadata.versionSource ? { versionSource: metadata.versionSource } : {}),
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles || [],
					sourceUrl: metadata.sourceUrl || '',
					publisher: 'Dublin Core Metadata Initiative',
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism. The run timestamp lives in the store
					// row (blocks.createdAt), never in content-addressed block text.
					coreVersion: '2.0.0',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(dctapMappingInstruction),
				},
			});

			// ---- structural nodes (components, concepts, elements, value sets, values) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'DctapRoot') {
					return;
				}
				const self = nativeIdToSelf[nativeNode.id];
				const props = nativeNode.properties || {};

				// owning context + parent for searchText/path (from the native _parentEdge).
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (nativeNode._parentEdge) {
					const owner = nativeIdToSelf[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// faithful native scalars.
				const extraProps = { scalar: {}, crossRefs: [] };
				if (props.cardinality) extraProps.scalar.cardinality = props.cardinality;
				if (props.definition) extraProps.scalar.definition = props.definition;
				if (typeof props.valueCount === 'number') extraProps.scalar.valueCount = props.valueCount;

				const pathLabel =
					self.kind === 'property' || self.kind === 'optionValue'
						? `${owningName}.${props.name}`
						: `${props.name}`;

				makeNode({
					self,
					name: props.name,
					description: props.description,
					owningName,
					extraProps,
					structural: {
						parentId,
						depth: depthByKind[self.kind],
						path: pathLabel,
					},
				});

				// synthesized ownership edge from the root for every class (HAS_CLASS) — both Components
				// AND Concepts are DmeClass, so both are root-owned.
				if (self.kind === 'class') {
					addEdge(EDGE_TYPES.HAS_CLASS, ROOT_STABLE_ID, self.stableId, 'root->class');
				}
			});

			// ---- translate native edges (the node's own .edges, extra domains, and _parentEdge) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToSelf[nativeNode.id];
				if (!self) {
					return;
				}

				// the native _parentEdge (HAS_FIELD -> HAS_PROPERTY; HAS_VALUE -> HAS_VALUE).
				if (nativeNode._parentEdge) {
					const owner = nativeIdToSelf[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-dctap: untranslated native parent edge type '${nativeNode._parentEdge.type}'`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}

				// EXTRA owning components for a shared element -> additional HAS_PROPERTY edges (so the
				// element is reachable from every owning component, not just the structural parent).
				if (Array.isArray(nativeNode._owningClassIds) && nativeNode._owningClassIds.length > 1) {
					nativeNode._owningClassIds.slice(1).forEach((classRawId) => {
						const owner = nativeIdToSelf[classRawId];
						addEdge(EDGE_TYPES.HAS_PROPERTY, owner && owner.stableId, self.stableId, `extraDomain->${nativeNode.id}`);
					});
				}

				// the node's outgoing native edges.
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToSelf[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-dctap: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						stats.propertyOptionSetEdges++;
						if (target && target.stableId) {
							constrainedOptionSetStableIds.add(target.stableId);
						}
					}
					if (nativeEdge.type === 'REFERENCES') {
						stats.referencesEdges++;
					}
					if (nativeEdge.type === 'SUBCLASS_OF') {
						stats.subClassOfEdges++;
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			// ---- ORPHAN-ANCHOR pass: an AllowedValueSet (DmeOptionSet) constrained by ZERO elements
			// would be unreachable (option sets are property-owned via HAS_OPTION_SET, not root-owned).
			// Anchor each true orphan from the DmeStandardRoot via HAS_OPTION_SET. (Mirrors forge-ctdl.)
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'DctapAllowedValueSet') {
					return;
				}
				const self = nativeIdToSelf[nativeNode.id];
				if (!self) {
					return;
				}
				if (!constrainedOptionSetStableIds.has(self.stableId)) {
					addEdge(EDGE_TYPES.HAS_OPTION_SET, ROOT_STABLE_ID, self.stableId, 'root->orphanOptionSet');
					stats.orphanAnchoredOptionSets++;
				}
			});

			if (stats.danglingEdges.length > 0) {
				throw new Error(
					`forge-dctap: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// perStandardLabelFor — the native label that pairs with a role on a forged node.
		// NOTE: DmeClass covers BOTH Components and Concepts; the native DmeClass label is reported as
		// DctapComponent (the structural-container sense). Concepts retain their semantics via stableId
		// + searchText; the role label is shared by design (both are classes in the contract).
		const perStandardLabelByRole = {
			DmeClass: 'DctapComponent',
			DmeProperty: 'DctapElement',
			DmeOptionSet: 'DctapAllowedValueSet',
			DmeOptionValue: 'DctapAllowedValue',
		};
		function perStandardLabelFor(role) {
			return perStandardLabelByRole[role] || 'DctapTerm';
		}

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). IDENTICAL to forge-ctdl.
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
						callback(`forge-dctap embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-dctap] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-ctdl.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseDctap({ sourcePath, xLog }, (err, parsed) => {
					if (err) {
						next(`forge-dctap parse: ${err}`);
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
					next(`forge-dctap buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-dctap] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.propertyOptionSetEdges} element->optionSet HAS_OPTION_SET, ` +
						`${graph.stats.orphanAnchoredOptionSets} orphan-anchored option sets, ` +
						`${graph.stats.subClassOfEdges} SUBCLASS_OF, ${graph.stats.referencesEdges} REFERENCES)`,
				);
				next('', { ...args, graph });
			});

			// embedding pass (skippable for the determinism comparison + free structural checks).
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
