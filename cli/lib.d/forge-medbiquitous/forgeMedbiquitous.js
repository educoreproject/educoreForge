'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeMedbiquitous.js — the MedBiquitous forge bundle. Parses the MedBiquitous XML Schema (XSD) set +
// WSDL service descriptions and emits the UNIVERSAL FORGE PROPERTY CONTRACT (the SAME contract
// forge-pesc/forge-sif/forge-edfi/forge-ceds emit), so MedBiquitous lands in the validation graph
// interoperably. XSD-family member; mirrors forge-pesc EXACTLY in structure, adapted for the
// MedBiquitous source (a nested multi-version XSD tree + 6 WSDL service files).
//
// HARVESTED+ADAPTED from the OLD forge-medbiquitous (lib/{parser,xsdParser,wsdlParser,importResolver}.js
// navigation reused; node-shaping rewritten here):
//   * the OLD tool emitted private MedBiq* nodes (MedBiqModel/MedBiqComplexType/MedBiqSimpleType/
//     MedBiqElement/MedBiqAttribute/MedBiqEnumValue/MedBiqSharedType/MedBiqWsdl{Message,Binding,
//     Operation}) with hand-rolled native edges (HAS_ELEMENT/TYPE_OF/REFERENCES_TYPE/IMPORTS_TYPE/
//     HAS_ENUM_VALUE/USES_MESSAGE/BINDS_TO/HAS_OPERATION...) plus per-standard model anchors and a
//     postLoadHook that wrote DmePublisher/BELONGS_TO_STANDARD cross-source edges.
//   * THIS module maps each native node to one of the canonical Dme* roles (the XSD ROLE MAPPING,
//     ruled for the XSD family and documented in forgeCampaignRunbook-XSD.md):
//       MedbiqComplexType  -> DmeClass      (a named complexType / inline-typed message element)
//       MedbiqField        -> DmeProperty   (an xs:element OR xs:attribute within a type/group)
//       MedbiqOptionSet    -> DmeOptionSet  (a simpleType WITH xs:enumeration)
//       MedbiqOptionValue  -> DmeOptionValue (one enumeration value)
//       MedbiqSupport      -> DmeSupport    (a named simpleType WITHOUT enumeration, an xs:group /
//                                            xs:attributeGroup, OR a WSDL message/binding/operation/
//                                            portType/service — operational scaffolding)
//       MedbiqRoot         -> DmeStandardRoot
//   It builds searchText via the ONE shared 1C builder (structural context only), assigns deterministic
//   synthetic stableIds (medbiq:<kind>/<source>/<name>; the directory-qualified source path
//   disambiguates the local type names that recur across files/standards/versions), and writes the
//   canonical edges, all stamped provenanceTier 'structural'.
//
// WSDL HANDLING DECISION (documented in the per-standard report + runbook §SOURCE NOTE): the OLD forge
// DID model the 6 WSDL service files (it emitted MedBiqWsdl* nodes). To preserve that coverage under the
// universal contract — which has no service-specific role — each WSDL construct is a MedbiqSupport node
// (supportKind 'wsdl*'), owned by the root via HAS_SUPPORT. WSDLs are operational/service definitions,
// not data model; modeling them as DmeSupport keeps them present + searchable without polluting the
// class/property data model, and stays standard-pure.
//
// EDGE CONVENTION (mandatory — identical to forge-pesc / forge-sif:95):
//   * a class owns its elements/attributes via HAS_PROPERTY (native HAS_FIELD parent edge).
//   * a PROPERTY typed by an enumeration simpleType => HAS_OPTION_SET FROM the DmeProperty TO the
//     DmeOptionSet (native TYPED_BY whose target is an optionSet). The property OWNS its option set —
//     never REFERENCES. An option set referenced by ZERO properties (orphan) is anchored from the root
//     via HAS_OPTION_SET in a dedicated pass so nothing is unreachable.
//   * a complexType extension/restriction of another complexType => SUBCLASS_OF (native EXTENDS).
//   * use of a named type => REFERENCES (native TYPED_BY / REFERENCES_TYPE to a complexType/support)
//     OR HAS_SUPPORT for a group/attributeGroup usage (native USES_SUPPORT).
//   * support usage from the root => HAS_SUPPORT; option set -> values => HAS_VALUE.
//
// PURITY: buildContractGraph is a PURE, synchronous, deterministic function of the parsed source.
// forge() runs parse -> buildContractGraph -> embedNodes. An R3 normalization miss or empty searchText
// (R4) THROWS — surfaced as a forge error.
//
// BRIDGE PURITY: STANDARD-PURE MedBiquitous block — _source='MedBiquitous', MedBiquitous's own nodes +
// intra-MedBiquitous structural edges ONLY. The OLD forge's crosswalk-engine + DmePublisher postLoadHook
// are NOT inside the XSD source and are a later-phase BRIDGE concern — NOT read here, NO cross-standard
// edge emitted.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseMedbiquitous = require('./lib/parser');
const normalize = require('./lib/normalize');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

// the central structural-property authority (Wave-2 items 5/6; M7/M8): enforces the parentId ->
// member-stableId referent, derives depth (= parentId-chain length), stamps crossRefs universally,
// and aligns single-owner optionSet parenting. Called as buildContractGraph's LAST step.
const { finalizeStructuralContract } = require(
	path.join(CORE_LIB, 'structural-contract', 'structural-contract'),
);

const STANDARD_KEY = 'medbiquitous';
const STANDARD_SOURCE = 'MedBiquitous'; // === the registry standardName, EXACT (no toLower, no literals elsewhere)
const STANDARD_DISPLAY = 'MedBiquitous — Health Professions Education and Credentialing Standards Portfolio';
const STABLE_URI_PROPERTY_NAME = 'medbiquitousStableId';
const EMBED_BATCH_SIZE = 128;

// MedBiquitous has no in-schema CEDS crosswalk (anchor-free, like CASE), so -specified emits 0;
// it bridges to the CEDS hub entirely via -implied (impliedTargets ['CEDS']). DECISIONS §12.
const medbiqMappingInstruction = {
	cedsOriginalAnchorPropertyName: [],
	cedsOptionOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch.
const roleSpecByNativeLabel = {
	MedbiqComplexType: { role: DME_ROLES.CLASS, kind: 'complexType', perStandardLabel: 'MedbiqComplexType' },
	MedbiqField: { role: DME_ROLES.PROPERTY, kind: 'field', perStandardLabel: 'MedbiqField' },
	MedbiqOptionSet: { role: DME_ROLES.OPTION_SET, kind: 'optionSet', perStandardLabel: 'MedbiqOptionSet' },
	MedbiqOptionValue: { role: DME_ROLES.OPTION_VALUE, kind: 'optionValue', perStandardLabel: 'MedbiqOptionValue' },
	MedbiqSupport: { role: DME_ROLES.SUPPORT, kind: 'support', perStandardLabel: 'MedbiqSupport' },
};

// native key extractor per kind — source-qualified (local type names recur across files/standards).
const naturalKeyByKind = {
	complexType: (props) => `${props.sourceFile}/${props.name}`,
	field: (props) => `${props.sourceFile}/${props.owningTypeName}.${props.xsdKind}.${props.name}`,
	optionSet: (props) => `${props.sourceFile}/${props.name}`,
	optionValue: (props) => `${props.sourceFile}/${props.optionSetName}.${props.name}`,
	support: (props) => `${props.sourceFile}/${props.name}`,
};

// native edge type -> canonical (all stamped 'structural'). Identical to forge-pesc.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY,
	HAS_VALUE: EDGE_TYPES.HAS_VALUE,
	EXTENDS: EDGE_TYPES.SUBCLASS_OF,
	USES_SUPPORT: EDGE_TYPES.HAS_SUPPORT,
	REFERENCES: EDGE_TYPES.REFERENCES,
	// TYPED_BY and REFERENCES_TYPE are contextual (see translate block).
};

// kinds the root owns directly (synthesized ownership edges).
const ownershipEdgeForKind = {
	complexType: EDGE_TYPES.HAS_CLASS,
	support: EDGE_TYPES.HAS_SUPPORT,
};

// structural depth per role.
const depthByKind = {
	complexType: 1,
	field: 2,
	optionSet: 2,
	optionValue: 3,
	support: 1,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'medbiq:root';

		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-medbiquitous R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-medbiquitous: ${kind} produced an unclean stableId '${result.stableId}'`,
				);
			}
			return result.stableId;
		};

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
			// DmeSupport
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				fieldCount: 0,
				optionValuesEmitted: 0,
				propertyOptionSetEdges: 0,
				subclassEdges: 0,
				supportUsageEdges: 0,
				referencesEdges: 0,
				orphanAnchoredOptionSets: 0,
				danglingEdges: [],
			};

			const constrainedOptionSetStableIds = new Set();

			// PASS 1 — index every native node and resolve its stableId + role + kind.
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'MedbiqRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						kind: 'root',
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-medbiquitous: unknown native MedBiquitous label '${nativeNode.label}'`);
				}
				const key = naturalKeyByKind[spec.kind](nativeNode.properties || {});
				const stableId = stableIdFor({ kind: spec.kind, key });
				nativeIdToStable[nativeNode.id] = {
					stableId,
					role: spec.role,
					kind: spec.kind,
					name: nativeNode.properties.name,
				};
			});

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

			const makeNode = ({ role, perStandardLabel, stableId, name, description, structural, extraProps }) => {
				const searchText = buildSearchText(
					searchTextElementFor({ role, name, owningName: structural.owningName }),
				);
				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: {
						_id: stableId,
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

			// ---- DmeStandardRoot ----
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: STANDARD_SOURCE,
				standardName: STANDARD_DISPLAY,
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'MedbiqRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${metadata.complexTypeCount} complex types, ${metadata.simpleTypeCount} simple types, ${metadata.groupCount} groups across ${metadata.xsdFileCount} XSD + ${metadata.wsdlFileCount} WSDL files`,
					role: DME_ROLES.STANDARD_ROOT,
					[STABLE_URI_PROPERTY_NAME]: ROOT_STABLE_ID,
					searchText: rootSearchText,
					standardKey: STANDARD_KEY,
					standardName: STANDARD_DISPLAY,
					version: metadata.version,
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles || [],
					sourceUrl: metadata.sourceUrl || 'https://github.com/medbiq/medbiq',
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism. The run timestamp lives in the store
					// row (blocks.createdAt), never in content-addressed block text.
					coreVersion: '2.0.0',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(medbiqMappingInstruction),
				},
			});

			// ---- structural nodes ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'MedbiqRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				const extraProps = { scalar: {}, crossRefs: [] };
				if (props.sourceFile) extraProps.scalar.sourceFile = props.sourceFile;
				if (props.xsdKind) extraProps.scalar.xsdKind = props.xsdKind;
				if (props.typeName) extraProps.scalar.typeName = props.typeName;
				if (props.minOccurs != null) extraProps.scalar.minOccurs = `${props.minOccurs}`;
				if (props.maxOccurs != null) extraProps.scalar.maxOccurs = `${props.maxOccurs}`;
				if (props.baseType) extraProps.scalar.baseType = props.baseType;
				if (props.derivation) extraProps.scalar.derivation = props.derivation;
				if (props.restrictionBase) extraProps.scalar.restrictionBase = props.restrictionBase;
				if (props.supportKind) extraProps.scalar.supportKind = props.supportKind;
				if (typeof props.isRootElement === 'boolean') extraProps.scalar.isRootElement = props.isRootElement;

				const pathLabel =
					spec.kind === 'field' || spec.kind === 'optionValue'
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

				if (spec.kind === 'field') {
					stats.fieldCount++;
				}
				if (spec.kind === 'optionValue') {
					stats.optionValuesEmitted++;
				}

				const ownershipType = ownershipEdgeForKind[spec.kind];
				if (ownershipType) {
					addEdge(ownershipType, ROOT_STABLE_ID, self.stableId, `root->${spec.kind}`);
				}
			});

			// ---- translate native edges ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}

				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-medbiquitous: untranslated native parent edge type '${nativeNode._parentEdge.type}' (${nativeNode._parentEdge.fromId}->${nativeNode.id})`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}

				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const targetKind = nativeEdge.targetKind || (target && target.kind);

					if (nativeEdge.type === 'TYPED_BY' || nativeEdge.type === 'REFERENCES_TYPE') {
						// CONTEXTUAL: HAS_OPTION_SET is emitted ONLY when the OWNER is a DmeProperty (a
						// field's TYPED_BY to an enum simpleType — the property OWNS its option set). A
						// DmeClass (a complexType / message-root element) typed-by/referencing an enum
						// simpleType is NOT an owner — it gets REFERENCES (the option set then becomes an
						// orphan anchored from the root). This keeps the HAS_OPTION_SET-origin-is-DmeProperty
						// invariant the runbook mandates. (PESC never hit this because no PESC message root
						// was typed by an enum; MedBiquitous's healthcareLom message roots are.)
						let canonical;
						if (targetKind === 'optionSet' && self.role === DME_ROLES.PROPERTY) {
							canonical = EDGE_TYPES.HAS_OPTION_SET;
							stats.propertyOptionSetEdges++;
							if (target && target.stableId) {
								constrainedOptionSetStableIds.add(target.stableId);
							}
						} else {
							canonical = EDGE_TYPES.REFERENCES;
							stats.referencesEdges++;
						}
						addEdge(
							canonical,
							self.stableId,
							target && target.stableId,
							`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
						);
						return;
					}

					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-medbiquitous: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					if (nativeEdge.type === 'EXTENDS') {
						stats.subclassEdges++;
					}
					if (nativeEdge.type === 'USES_SUPPORT') {
						stats.supportUsageEdges++;
					}
					if (nativeEdge.type === 'REFERENCES') {
						stats.referencesEdges++;
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			// ---- ORPHAN-ANCHOR pass: anchor each option set typed against by ZERO properties from root.
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'MedbiqOptionSet') {
					return;
				}
				const self = nativeIdToStable[nativeNode.id];
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
					`forge-medbiquitous: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). Mirrors forge-pesc.
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
						callback(`forge-medbiquitous embedNodes batch ${bi} failed: ${err}`);
						return;
					}
					embedCallCount++;
					batch.forEach((oneNode, idx) => {
						oneNode.properties.embedding = Array.from(result.vectors[idx]);
						oneNode.embedding = oneNode.properties.embedding;
						oneNode.embeddingModelVersion = result.embeddingModelVersion;
						oneNode.properties.embeddingModelVersion = result.embeddingModelVersion;
					});
					if (xLog && xLog.status) {
						xLog.status(
							`[forge-medbiquitous] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-pesc.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseMedbiquitous(sourcePath, {}, (err, parsed) => {
					if (err) {
						next(`forge-medbiquitous parse: ${err}`);
						return;
					}
					next('', { ...args, parsed });
				});
			});

			taskList.push((args, next) => {
				let graph;
				let buildError = '';
				try {
					graph = buildContractGraph(args.parsed);
				} catch (err) {
					buildError = err.message;
				}
				if (buildError) {
					next(`forge-medbiquitous buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-medbiquitous] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.fieldCount} fields, ${graph.stats.optionValuesEmitted} option values, ` +
						`${graph.stats.propertyOptionSetEdges} property->optionSet HAS_OPTION_SET, ` +
						`${graph.stats.subclassEdges} SUBCLASS_OF, ${graph.stats.supportUsageEdges} HAS_SUPPORT-usage, ` +
						`${graph.stats.referencesEdges} REFERENCES, ${graph.stats.orphanAnchoredOptionSets} orphan-anchored option sets)`,
				);
				next('', { ...args, graph });
			});

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
			buildContractGraph,
			STANDARD_KEY,
			STANDARD_SOURCE,
			STABLE_URI_PROPERTY_NAME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
