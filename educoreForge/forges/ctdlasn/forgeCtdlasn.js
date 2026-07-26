'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCtdlasn.js — the CTDL-ASN forge bundle. Parses the Credential Engine CTDL Achievement Standards
// Network JSON-LD vocabulary (ctdlasn.json, plain encoding) and emits the UNIVERSAL FORGE PROPERTY
// CONTRACT (the SAME contract forge-ctdl / forge-ceds / forge-edfi emit), so CTDL-ASN lands in the
// validation graph interoperably. Clone-and-adapt of forge-ctdl (the JSON-LD-family trailblazer).
//
// JSON-LD ROLE-MAPPING (CODE FACT — identical to forge-ctdl):
//   rdfs:Class        -> DmeClass          (11)
//   rdf:Property      -> DmeProperty       (97, the 4 ceterms:* overlap properties FILTERED OUT)
//   skos:ConceptScheme-> DmeOptionSet      (2)
//   skos:Concept      -> DmeOptionValue    (8)
//   schema root       -> DmeStandardRoot   (1)
//
// IDENTITY IS NATIVE-URI (DESIGN §D — the CEDS/URI model): every CTDL-ASN term carries a globally-
// unique CURIE in `@id` (e.g. ceasn:competencyText). The stableId IS that CURIE and
// stableUriPropertyName = 'uri'. No path minting is needed.
//
// CROSS-STANDARD REFERENCES — FILTER-AND-REFERENCE (WORKORDER Phase 1, Decision 1; generalized per
// FADED_FORGE ruling 2026-07-15). CTDL-ASN's `ceterms:*` overlap terms emit NO nodes, and ASN also
// references `qdata:*` classes. Any native ASN term referencing a cross-standard term stashes a
// `{system, id, raw, locator}` crossRef on the referencing node (the parser sets `_crossRefs`; this
// forge merges it into the `crossRefs` JSON node property), keyed by target standard: ceterms ->
// system 'ctdl', qdata -> system 'qdata'. NOTHING is silently dropped and NO cross-standard node or
// edge is emitted — STANDARD-PURE, mirroring exactly how forge-ctdl stamps CEDS anchors
// (`forgeCtdl.js:182-206, 283, 370-378`). The bridges to CTDL's `ceterms:*` nodes and CTDL-QData's
// classes are separate additive phases (WORKORDER Phase 3.5), never authored here.
//
// NO CEDS ANCHORS: CTDL-ASN carries zero CEDS crosswalks, so this bundle authors NO CEDS bridge
// instructions (impliedTargets: []) and stamps no cedsId — never manufacturing an anchor the source
// does not supply (never-fabricate).
//
// PURITY: buildContractGraph is a PURE, synchronous, deterministic function of the parsed source.
// forge() runs parse -> buildContractGraph -> embedNodes. An R3 normalization miss, an empty
// searchText (R4), or an unresolved edge endpoint THROWS — surfaced as a forge error.
//
// Async style: qtools taskListPlus/pipeRunner. No async/await, no try/catch-for-control-flow.
// camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseCtdlasn = require('./lib/parser');
const normalize = require('./lib/normalize');

// PORTED (grand recreation): the substrate is vendored into the new tree's own lib/. Original
// incumbent climb was __dirname/../../../npm/qtools-graph-forge-core/lib; the new tree carries
// search-text, snapshot-provenance, vocabulary and structural-contract under educoreForge/lib/,
// reached from forges/ctdlasn/ as ../../lib. This is the ONE deliberate edit to an otherwise
// byte-faithful bundle (mirrors the forge-ctdl / forge-lif port). NOTE: the incumbent climb would
// STILL resolve from here (to code/npm/qtools-graph-forge-core/lib, which exists) — a silent
// wrong-substrate trap — so this correction is load-bearing, not cosmetic.
const CORE_LIB = path.join(__dirname, '..', '..', 'lib');
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

const STANDARD_KEY = 'ctdlasn';
const STANDARD_SOURCE = 'CTDLASN'; // === the registry standardName, EXACT (no toLower anywhere); distinct from 'CTDL'
const STANDARD_DISPLAY = 'Credential Transparency Description Language — Achievement Standards Network (CTDL-ASN)';
const STABLE_URI_PROPERTY_NAME = 'uri';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.

// native per-standard label -> { role, kind }. Registry, not switch.
const roleSpecByNativeLabel = {
	CtdlasnClass: { role: DME_ROLES.CLASS, kind: 'class' },
	CtdlasnProperty: { role: DME_ROLES.PROPERTY, kind: 'property' },
	CtdlasnConceptScheme: { role: DME_ROLES.OPTION_SET, kind: 'optionSet' },
	CtdlasnConcept: { role: DME_ROLES.OPTION_VALUE, kind: 'optionValue' },
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-ctdl:93-99.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // class -> property (from the native _parentEdge / extra domains)
	HAS_VALUE: EDGE_TYPES.HAS_VALUE, // scheme -> concept (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // property -> scheme: the property's option set (SIF-canonical)
	SUBCLASS_OF: EDGE_TYPES.SUBCLASS_OF, // class -> class
	REFERENCES: EDGE_TYPES.REFERENCES, // property -> class (schema:rangeIncludes)
};

// structural depth per kind (mirrors the forge-ctdl depth convention).
const depthByKind = {
	class: 1,
	property: 2,
	optionSet: 1,
	optionValue: 2,
};

// The mappingInstruction fields are DECLARED on the DmeStandardRoot (DECISIONS §12). CTDL-ASN is an
// ISLAND at the forge layer: it carries NO CEDS anchors, so impliedTargets is empty and no CEDS anchor
// property names are declared (never-fabricate). Its overlap with CTDL is handled by the ceterms
// crossRef stash and promoted to EXACT_MATCH edges in the separate additive bridge phase (Phase 3.5),
// never by an implied bridge here.
const ctdlasnMappingInstruction = {
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

		const ROOT_STABLE_ID = 'ctdlasn:root';

		// -----
		// _id from natural keys: <standardKey>|<curie>. The CURIE is already namespaced + unique.
		const idFor = (stableId) => `${STANDARD_KEY}|${stableId}`;

		// resolve + validate the stableId for a native node; throws on a blank @id (R3, never silent).
		const stableIdFor = (rawId) => {
			const result = normalize.buildStableId({ id: rawId });
			if (result.error) {
				throw new Error(`forge-ctdlasn R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-ctdlasn: produced an unclean stableId '${result.stableId}' from @id '${rawId}'`,
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
				crossRefNodes: 0, // native nodes carrying >=1 cross-standard crossRef (filter-and-reference stash)
				crossRefTotal: 0, // total cross-standard crossRefs stashed across all nodes
				crossRefBySystem: {}, // per-target-standard tally (ctdl + qdata)
				propertyOptionSetEdges: 0, // property -> scheme HAS_OPTION_SET edges
				orphanAnchoredOptionSets: 0, // schemes constrained by 0 properties, anchored from root
				referencesEdges: 0, // property -> class REFERENCES
				subClassOfEdges: 0,
				danglingEdges: [],
			};

			// option-set stableIds that received a property->optionset edge (consulted by orphan pass).
			const constrainedOptionSetStableIds = new Set();

			// PASS 1 — index every native node, resolve its stableId + role + display name.
			const nativeIdToSelf = {};
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'CtdlasnRoot') {
					nativeIdToSelf[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-ctdlasn: unknown native CTDL-ASN label '${nativeNode.label}'`);
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
				labels: [NODE_LABELS.FORGED_NODE, 'CtdlasnRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: idFor(ROOT_STABLE_ID),
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} (Credential Engine) — ${metadata.classCount} classes, ${metadata.propertyCount} properties, ${metadata.conceptSchemeCount} concept schemes, ${metadata.conceptCount} concepts`,
					role: DME_ROLES.STANDARD_ROOT,
					[STABLE_URI_PROPERTY_NAME]: ROOT_STABLE_ID,
					searchText: rootSearchText,
					// provenance block (DESIGN §B "Required on the DmeStandardRoot")
					standardKey: STANDARD_KEY,
					standardName: STANDARD_DISPLAY,
					version: metadata.version,
					// version-provenance stamp (spec §3.3, Phase A): always present post-stamping. CTDL-ASN's
					// source does not self-describe a version, so publishedVersion/versionSource are derived
					// from the snapshot's standardSourceLocation (versionSource 'provenance-file').
					snapshotKey: metadata.snapshotKey,
					publishedVersion: metadata.publishedVersion,
					versionSource: metadata.versionSource,
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles || [],
					sourceUrl: metadata.sourceUrl || '',
					publisher: 'Credential Engine',
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism.
					coreVersion: '2.0.0',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(ctdlasnMappingInstruction),
					// NOTE: no anchorForm and no cedsOriginalAnchorPropertyName — CTDL-ASN carries no CEDS
					// anchors, so no anchor form is declared (never-fabricate). The ceterms overlap is handled
					// by node-level crossRefs and the additive Phase 3.5 bridge, not by a root anchor form.
				},
			});

			// ---- structural nodes (classes, properties, concept schemes, concepts) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'CtdlasnRoot') {
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

				// faithful native scalars (honest-empty: an absent status/usageNote is simply not stamped).
				const extraProps = { scalar: {}, crossRefs: [] };
				if (props.status) extraProps.scalar.status = props.status;
				if (props.usageNote) extraProps.scalar.usageNote = props.usageNote;
				if (typeof props.domainCount === 'number') extraProps.scalar.domainCount = props.domainCount;

				// cross-standard crossRefs (Decision 1, generalized): merge the parser's ceterms + qdata
				// references into the node's crossRefs. STANDARD-PURE — NO cross-standard node, NO edge.
				if (Array.isArray(props._crossRefs) && props._crossRefs.length) {
					extraProps.crossRefs = props._crossRefs;
					stats.crossRefNodes++;
					stats.crossRefTotal += props._crossRefs.length;
					props._crossRefs.forEach((cr) => {
						stats.crossRefBySystem[cr.system] = (stats.crossRefBySystem[cr.system] || 0) + 1;
					});
				}

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

				// synthesized ownership edge from the root for every class (HAS_CLASS).
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
							`forge-ctdlasn: untranslated native parent edge type '${nativeNode._parentEdge.type}'`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}

				// EXTRA owning classes for a shared property -> additional HAS_PROPERTY edges.
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
							`forge-ctdlasn: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
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

			// ---- ORPHAN-ANCHOR pass: a concept scheme (DmeOptionSet) constrained by ZERO properties
			// would be unreachable. Anchor each true orphan from the DmeStandardRoot via HAS_OPTION_SET.
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'CtdlasnConceptScheme') {
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
					`forge-ctdlasn: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived,
			// crossRefs universal, single-owner optionSets re-parented to their owning property.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// perStandardLabelFor — the native label that pairs with a role on a forged node.
		const perStandardLabelByRole = {
			[DME_ROLES.CLASS]: 'CtdlasnClass',
			[DME_ROLES.PROPERTY]: 'CtdlasnProperty',
			[DME_ROLES.OPTION_SET]: 'CtdlasnConceptScheme',
			[DME_ROLES.OPTION_VALUE]: 'CtdlasnConcept',
		};
		function perStandardLabelFor(role) {
			return perStandardLabelByRole[role] || 'CtdlasnTerm';
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
						callback(`forge-ctdlasn embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-ctdlasn] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
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
				parseCtdlasn({ sourcePath, xLog }, (err, parsed) => {
					if (err) {
						next(`forge-ctdlasn parse: ${err}`);
						return;
					}
					// version-provenance stamp (BINDING spec §3.3, Phase A). CTDL-ASN's source does not
					// self-describe a version (parser sets no versionSource), so sourceVersion is null and
					// publishedVersion is taken from the snapshot's standardSourceLocation.
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
					next(`forge-ctdlasn buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-ctdlasn] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.crossRefTotal} cross-standard crossRefs on ${graph.stats.crossRefNodes} nodes ${JSON.stringify(graph.stats.crossRefBySystem)}, ` +
						`${graph.stats.propertyOptionSetEdges} property->optionSet HAS_OPTION_SET, ` +
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
