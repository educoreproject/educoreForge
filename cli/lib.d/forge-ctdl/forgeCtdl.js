'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCtdl.js — the CTDL forge bundle. Parses the Credential Engine CTDL JSON-LD vocabulary
// (ctdl-schema.json) and emits the UNIVERSAL FORGE PROPERTY CONTRACT (the SAME contract
// forge-ceds / forge-edfi / forge-openbadges emit), so CTDL lands in the validation graph
// interoperably. JSON-LD-family TRAILBLAZER (the template DCTAP will follow off of).
//
// JSON-LD ROLE-MAPPING DECISION (CODE FACT — verified against forge-ceds's RDF role mapping, the old
// forge-ctdl parser, and the real source; documented in forgeCampaignRunbook-JSONLD.md):
//   rdfs:Class        -> DmeClass          (138)
//   rdf:Property      -> DmeProperty       (396)
//   skos:ConceptScheme-> DmeOptionSet      (34)   (a controlled vocabulary = an option set)
//   skos:Concept      -> DmeOptionValue    (445)  (a vocabulary term = an option value)
//   schema root       -> DmeStandardRoot   (1)
//   (no DmeSupport — CTDL declares no datatype/support scaffolding worth a node.)
// JSON-LD is just another RDF serialization, so this is identical in spirit to forge-ceds's RDF
// mapping; the only difference is the native field names (skos:prefLabel/definition for concepts,
// meta:targetScheme for the option-set constraint).
//
// IDENTITY IS NATIVE-URI (DESIGN §D — the CEDS/URI model, NOT the structural-path model): every CTDL
// term carries a globally-unique CURIE in `@id` (e.g. ceterms:AcademicCertificate). The stableId IS
// that CURIE and stableUriPropertyName = 'uri'. No path minting is needed (unlike OpenBadges/SIF).
//
// EDGE CONVENTION (MANDATORY — from forge-sif:95 / forge-edfi; the property OWNS its option set):
//   native HAS_FIELD  (class<-property, from schema:domainIncludes) -> HAS_PROPERTY
//   native HAS_VALUE  (scheme<-concept, from skos:inScheme)         -> HAS_VALUE
//   native CONSTRAINED_BY (property->scheme, from meta:targetScheme) -> HAS_OPTION_SET
//        (FROM the DmeProperty TO the DmeOptionSet — the property owns its option set; NEVER REFERENCES)
//   native SUBCLASS_OF (class->class, from rdfs:subClassOf)          -> SUBCLASS_OF
//   native REFERENCES  (property->class, from schema:rangeIncludes)  -> REFERENCES
//   root synthesizes HAS_CLASS to every class. An option set (concept scheme) constrained by ZERO
//   properties is a true orphan -> anchored from the root via HAS_OPTION_SET (dedicated pass after
//   edge translation) so nothing is unreachable. Report the orphan-anchored count.
//
// STANDARD-PURE: CTDL carries 26 native CEDS anchors on skos:Concepts (owl:equivalentClass values
// like `ceds:000113#Assistantships`). These are BRIDGE data for a LATER phase — stashed as the
// `cedsId` (canonical OS<6-digit>, R3) + `crossRefs` JSON node properties; NO cross-standard edge is
// emitted here (cross-standard mapping is the downstream forgeManager bridge's job).
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

const parseCtdl = require('./lib/parser');
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

const STANDARD_KEY = 'ctdl';
const STANDARD_SOURCE = 'CTDL'; // === the registry standardName, EXACT (no toLower anywhere)
const STANDARD_DISPLAY = 'Credential Transparency Description Language';
const STABLE_URI_PROPERTY_NAME = 'uri';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.
const CEDS_ANCHOR_PROPERTY_NAME = 'owl:equivalentClass'; // native CEDS crosswalk locator (provenance)

// native per-standard label -> { role, kind }. Registry, not switch.
const roleSpecByNativeLabel = {
	CtdlClass: { role: DME_ROLES.CLASS, kind: 'class' },
	CtdlProperty: { role: DME_ROLES.PROPERTY, kind: 'property' },
	CtdlConceptScheme: { role: DME_ROLES.OPTION_SET, kind: 'optionSet' },
	CtdlConcept: { role: DME_ROLES.OPTION_VALUE, kind: 'optionValue' },
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-edfi:97 / forge-sif:95.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // class -> property (from the native _parentEdge / extra domains)
	HAS_VALUE: EDGE_TYPES.HAS_VALUE, // scheme -> concept (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // property -> scheme: the property's option set (SIF-canonical)
	SUBCLASS_OF: EDGE_TYPES.SUBCLASS_OF, // class -> class
	REFERENCES: EDGE_TYPES.REFERENCES, // property -> class (a genuine reference, schema:rangeIncludes)
};

// structural depth per kind (mirrors the forge-ceds/forge-edfi depth convention).
const depthByKind = {
	class: 1,
	property: 2,
	optionSet: 1,
	optionValue: 2,
};

// The mappingInstruction fields are DECLARED on the DmeStandardRoot (DECISIONS §12). CTDL bridges TO
// the CEDS hub (impliedTargets ['CEDS']); its native CEDS anchor origin is the concept-level
// owl:equivalentClass. The generic -specified bridge (a LATER phase) resolves CTDL.cedsId ==
// CedsOptionSet.cedsId. (Only 26 concepts carry such an anchor; the declaration is always present.)
const ctdlMappingInstruction = {
	cedsOriginalAnchorPropertyName: [CEDS_ANCHOR_PROPERTY_NAME],
	cedsOptionOriginalAnchorPropertyName: [CEDS_ANCHOR_PROPERTY_NAME],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'ctdl:root';

		// -----
		// _id from natural keys (DESIGN §B "deterministic from natural keys"):
		//   <standardKey>:<curie-localName>. The CURIE is already namespaced + unique, so the _id is
		//   the standardKey followed by the full CURIE (which itself contains a ':'), keeping it
		//   deterministic and collision-free.
		const idFor = (stableId) => `${STANDARD_KEY}|${stableId}`;

		// resolve + validate the stableId for a native node; throws on a blank @id (R3, never silent).
		const stableIdFor = (rawId) => {
			const result = normalize.buildStableId({ id: rawId });
			if (result.error) {
				throw new Error(`forge-ctdl R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-ctdl: produced an unclean stableId '${result.stableId}' from @id '${rawId}'`,
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

		// crossRefsForCtdl — a concept's harvested CEDS anchors -> DESIGN §E crossRefs shape
		//   {system,id,raw,locator}. `id` is the canonical CEDS optionSet anchor (R3). A normalization
		//   MISS throws (never silent). Returns { crossRefs, canonicalCedsId } (canonical = first hit).
		const crossRefsForCtdl = (cedsAnchors) => {
			const crossRefs = [];
			let canonicalCedsId = null;
			(cedsAnchors || []).forEach((rawAnchor) => {
				const norm = normalize.normalizeCedsCrossRef({ rawValue: rawAnchor, kind: 'optionSet' });
				if (norm.absent) {
					return;
				}
				if (norm.error) {
					throw new Error(
						`forge-ctdl R3 CEDS cross-ref miss: ${norm.error} (anchor='${rawAnchor}')`,
					);
				}
				if (!canonicalCedsId) {
					canonicalCedsId = norm.cedsId;
				}
				crossRefs.push({
					system: 'ceds',
					id: norm.cedsId,
					raw: `${rawAnchor}`,
					locator: CEDS_ANCHOR_PROPERTY_NAME,
				});
			});
			return { crossRefs, canonicalCedsId };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				cedsAnnotatedConcepts: 0, // concepts carrying a canonical CEDS cross-ref (bridge stash)
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
				if (nativeNode.label === 'CtdlRoot') {
					nativeIdToSelf[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-ctdl: unknown native CTDL label '${nativeNode.label}'`);
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
				labels: [NODE_LABELS.FORGED_NODE, 'CtdlRoot', DME_ROLES.STANDARD_ROOT],
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
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles || [],
					sourceUrl: metadata.sourceUrl || '',
					publisher: 'Credential Engine',
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism. The run timestamp lives in the store
					// row (blocks.createdAt), never in content-addressed block text.
					coreVersion: '2.0.0',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(ctdlMappingInstruction),
					// anchorForm DECLARATION (WORKORDER-inferenceAndSelfDoc-070226 A0.2, CRIMSON condition 2):
					// CTDL's native CEDS anchors are option-SET-form references whose raw text carries a value
					// fragment (owl:equivalentClass 'ceds:000113#Assistantships' on concepts). The harvest above
					// stays raw/lossless; this per-standard AUTHORED datum tells the generic authored maker
					// (edf-mapping) to resolve them through its osFragmentJoin strategy. Declared on the
					// DmeStandardRoot NODE alongside the mapping instruction — never in the block header.
					anchorForm: 'osFragment',
				},
			});

			// ---- structural nodes (classes, properties, concept schemes, concepts) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'CtdlRoot') {
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
				if (props.status) extraProps.scalar.status = props.status;
				if (props.usageNote) extraProps.scalar.usageNote = props.usageNote;
				if (typeof props.domainCount === 'number') extraProps.scalar.domainCount = props.domainCount;

				// CONCEPT CEDS cross-ref (bridge stash — canonical OS######, NO edge; STANDARD-PURE).
				if (self.kind === 'optionValue' && Array.isArray(props._cedsAnchors) && props._cedsAnchors.length) {
					const { crossRefs, canonicalCedsId } = crossRefsForCtdl(props._cedsAnchors);
					if (canonicalCedsId) {
						extraProps.scalar.cedsId = canonicalCedsId;
						extraProps.scalar.cedsOriginalAnchorPropertyName = [CEDS_ANCHOR_PROPERTY_NAME];
						extraProps.crossRefs = crossRefs;
						stats.cedsAnnotatedConcepts++;
					}
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
							`forge-ctdl: untranslated native parent edge type '${nativeNode._parentEdge.type}'`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}

				// EXTRA owning classes for a shared property -> additional HAS_PROPERTY edges (so the
				// property is reachable from every owning class, not just the structural parent).
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
							`forge-ctdl: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
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
			// would be unreachable (option sets are property-owned via HAS_OPTION_SET, not root-owned).
			// Anchor each true orphan from the DmeStandardRoot via HAS_OPTION_SET. (Mirrors forge-edfi.)
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'CtdlConceptScheme') {
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
					`forge-ctdl: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// perStandardLabelFor — the native label that pairs with a role on a forged node.
		const perStandardLabelByRole = {
			[DME_ROLES.CLASS]: 'CtdlClass',
			[DME_ROLES.PROPERTY]: 'CtdlProperty',
			[DME_ROLES.OPTION_SET]: 'CtdlConceptScheme',
			[DME_ROLES.OPTION_VALUE]: 'CtdlConcept',
		};
		function perStandardLabelFor(role) {
			return perStandardLabelByRole[role] || 'CtdlTerm';
		}

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). IDENTICAL to forge-edfi/forge-ceds.
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
						callback(`forge-ctdl embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-ctdl] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-edfi/forge-ceds.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseCtdl({ sourcePath, xLog }, (err, parsed) => {
					if (err) {
						next(`forge-ctdl parse: ${err}`);
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
					next(`forge-ctdl buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-ctdl] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.cedsAnnotatedConcepts} CEDS-annotated concepts, ` +
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
