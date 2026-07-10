'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSedm.js — the SEDM forge bundle. Parses the SEDM CEDS-Map CSV + domain-structures JSON and
// emits the UNIVERSAL FORGE PROPERTY CONTRACT (the SAME contract forge-edfi/forge-sif emit), so SEDM
// lands in the validation graph interoperably. Mirrors forge-edfi/forgeEdfi.js exactly.
//
// HARVESTED+ADAPTED from the OLD forge-sedm (lib/parser.js navigation reused; node-shaping rewritten):
//   * the OLD tool emitted private Sedm* nodes (SedmRoot/SedmOntologyClass/SedmComplianceCategory/
//     SedmIndicator/SedmEventMilestone/SedmIepComponent/SedmEtlTemplate/SedmUseCase/SedmOptionSet/
//     SedmOptionValue/SedmElement) with hand-rolled native edges (HAS_CATEGORY, TRACKED_BY,
//     REQUIRES_ELEMENT, IN_ETL, ...) and an older node contract.
//   * THIS module maps each native node to one of the canonical Dme* roles:
//       SedmRoot -> DmeStandardRoot
//       SedmOntologyClass / SedmComplianceCategory -> DmeClass  (SEDM's organizing classes)
//       SedmElement -> DmeProperty  (the annotated CEDS data elements/fields)
//       SedmOptionSet -> DmeOptionSet ; SedmOptionValue -> DmeOptionValue
//       SedmIndicator / SedmEventMilestone / SedmIepComponent / SedmEtlTemplate / SedmUseCase
//         -> DmeSupport  (SEDM-specific governance constructs that are not class/property/codeset)
//     It builds searchText via the ONE shared 1C builder (structural context only), assigns
//     deterministic synthetic stableIds (sedm:<token>/<naturalKey>; SEDM constructs have no native
//     URI — a path-based key, mirroring EdFi), and writes the canonical ownership edges
//     (HAS_CLASS/HAS_SUPPORT/HAS_OPTION_SET/HAS_VALUE) plus translated references (REFERENCES), all
//     stamped provenanceTier 'structural'.
//
// PURITY (forge is PURE/deterministic for (source, module)): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source. forge() runs parse -> buildContractGraph
// -> embedNodes. An R3 normalization miss or empty searchText (R4) THROWS — surfaced as a forge error.
//
// BRIDGE PURITY: this is a STANDARD-PURE SEDM block — _source='SEDM', SEDM's own nodes + intra-SEDM
// structural edges ONLY. SEDM is a CEDS-Map (crosswalk-like): the CEDS target Global IDs on elements
// are BRIDGE data for a LATER phase — stashed as node properties (cedsId = P###### where present) for
// later bridging, but NO cross-standard mapping edge is emitted here.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseSedm = require('./lib/parser');
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
const { deriveVersionStamp } = require(
	path.join(CORE_LIB, 'snapshot-provenance', 'snapshot-provenance'),
);

// canonical vocabulary (Phase 1 registry). Values are byte-identical to the prior inline literals, so
// the emitted nodes/edges are unchanged.
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);

// the central structural-property authority (Wave-2 items 5/6; M7/M8): enforces the parentId ->
// member-stableId referent, derives depth (= parentId-chain length), stamps crossRefs universally,
// and aligns single-owner optionSet parenting. Called as buildContractGraph's LAST step.
const { finalizeStructuralContract } = require(
	path.join(CORE_LIB, 'structural-contract', 'structural-contract'),
);

const STANDARD_KEY = 'sedm';
const STANDARD_SOURCE = 'SEDM'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'Special Education Data Model';
const STABLE_URI_PROPERTY_NAME = 'sedmStableId';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.
const CEDS_ANCHOR_PROPERTY_NAME = 'CEDSGlobalId'; // the native crosswalk column (origin, recorded for provenance)

// The mappingInstruction fields are DECLARED on the DmeStandardRoot. SEDM bridges TO the CEDS hub
// (impliedTargets ['CEDS']); its native CEDS anchor origin is the CEDS-Map Global ID column. The
// generic -specified bridge (a LATER phase) resolves SEDM.cedsId == CedsProperty.cedsId.
const sedmMappingInstruction = {
	cedsOriginalAnchorPropertyName: [CEDS_ANCHOR_PROPERTY_NAME],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch.
//   kind drives the stableId token (normalize.kindTokenByKind), depth, and ownership.
const roleSpecByNativeLabel = {
	SedmOntologyClass: { role: DME_ROLES.CLASS, kind: 'class', perStandardLabel: 'SedmOntologyClass' },
	SedmComplianceCategory: {
		role: DME_ROLES.CLASS,
		kind: 'class',
		perStandardLabel: 'SedmComplianceCategory',
	},
	SedmElement: { role: DME_ROLES.PROPERTY, kind: 'element', perStandardLabel: 'SedmElement' },
	SedmOptionSet: { role: DME_ROLES.OPTION_SET, kind: 'optionSet', perStandardLabel: 'SedmOptionSet' },
	SedmOptionValue: {
		role: DME_ROLES.OPTION_VALUE,
		kind: 'optionValue',
		perStandardLabel: 'SedmOptionValue',
	},
	SedmIndicator: { role: DME_ROLES.SUPPORT, kind: 'support', perStandardLabel: 'SedmIndicator' },
	SedmEventMilestone: {
		role: DME_ROLES.SUPPORT,
		kind: 'support',
		perStandardLabel: 'SedmEventMilestone',
	},
	SedmIepComponent: { role: DME_ROLES.SUPPORT, kind: 'support', perStandardLabel: 'SedmIepComponent' },
	SedmEtlTemplate: { role: DME_ROLES.SUPPORT, kind: 'support', perStandardLabel: 'SedmEtlTemplate' },
	SedmUseCase: { role: DME_ROLES.SUPPORT, kind: 'support', perStandardLabel: 'SedmUseCase' },
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
// Every native node carries an explicit properties.naturalKey from the parser, so the extractor is a
// single shared accessor (option values key on naturalKey too).
const naturalKeyByKind = {
	class: (props) => props.naturalKey,
	element: (props) => props.naturalKey,
	optionSet: (props) => props.naturalKey,
	optionValue: (props) => props.naturalKey,
	support: (props) => props.naturalKey,
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-edfi:
//   HAS_VALUE (option set -> value, from the native _parentEdge) stays HAS_VALUE.
//   CONSTRAINED_BY (an element's inline option set) becomes HAS_OPTION_SET FROM the DmeProperty TO the
//     DmeOptionSet — the property OWNS its option set (SIF/EdFi-canonical).
//   REFERENCES (class->class, support->class, element->support) stays REFERENCES.
const edgeTypeTranslation = {
	HAS_VALUE: EDGE_TYPES.HAS_VALUE, // option set -> value (native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // element -> option set: the property's option set
	REFERENCES: EDGE_TYPES.REFERENCES, // genuine references stay REFERENCES
};

// kinds the root owns directly (the synthesized ownership edges). Every DmeClass is HAS_CLASS; every
// DmeSupport is HAS_SUPPORT. An option set is owned by its constraining element(s) via CONSTRAINED_BY
// -> HAS_OPTION_SET — NOT blanket-owned by the root. ONLY an option set referenced by ZERO elements (a
// declared-but-unused set) gets a HAS_OPTION_SET anchor from the root so nothing is unreachable; that
// orphan anchor is synthesized in a dedicated pass below (after edge translation), not via this table.
const ownershipEdgeForKind = {
	class: EDGE_TYPES.HAS_CLASS,
	support: EDGE_TYPES.HAS_SUPPORT,
};

// structural depth per role (mirrors the forge-edfi depth convention).
const depthByKind = {
	class: 1,
	element: 2,
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

		const ROOT_STABLE_ID = 'sedm:root';

		// stableId for a native node; throws on an empty/unknown key (R3 — never a silent malformed id).
		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-sedm R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-sedm: ${kind} produced an unclean stableId '${result.stableId}'`,
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
				return {
					role,
					name,
					owningClassName: owningName || STANDARD_SOURCE,
					owningName: owningName || STANDARD_SOURCE,
				};
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
			// DmeSupport — standardName + owner + name.
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				crossRefsAnnotated: 0, // elements carrying a canonical CEDS cross-ref (bridge stash)
				optionValuesEmitted: 0,
				elementOptionSetEdges: 0, // element -> option set HAS_OPTION_SET edges (property's option set)
				orphanAnchoredOptionSets: 0, // option sets with 0 referencing elements, anchored from root
				referenceEdges: 0,
				danglingEdges: [],
			};

			// the set of option-set stableIds that an element constrains (gets HAS_OPTION_SET from an
			// element); populated during edge translation, consulted by the orphan-anchor pass.
			const constrainedOptionSetStableIds = new Set();

			// PASS 1 — index every native node and resolve its stableId + role.
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'SedmRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-sedm: unknown native SEDM label '${nativeNode.label}'`);
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
			const makeNode = ({
				role,
				perStandardLabel,
				stableId,
				name,
				description,
				structural,
				extraProps,
			}) => {
				const searchText = buildSearchText(
					searchTextElementFor({ role, name, owningName: structural.owningName }),
				);
				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: {
						_id: stableId, // SEDM _id === stableId (both deterministic from the natural key)
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
				labels: [NODE_LABELS.FORGED_NODE, 'SedmRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — IDEA compliance domain model over CEDS (${metadata.totalNodes} native source constructs)`,
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
					mappingInstruction: JSON.stringify(sedmMappingInstruction),
				},
			});

			// ---- structural nodes ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'SedmRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning context + parent for searchText/path. Option values own their set; elements,
				// option sets, classes and support nodes hang off the root by default.
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (spec.kind === 'optionValue' && nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}
				if (spec.kind === 'optionSet' && props.owningElementName) {
					owningName = props.owningElementName;
				}

				// faithful native scalars + BRIDGE-stash cross-refs (stashed, NOT edged).
				const extraProps = { scalar: {}, crossRefs: [] };
				const stashScalar = (key) => {
					if (props[key] != null && `${props[key]}`.trim() !== '') {
						extraProps.scalar[key] = props[key];
					}
				};
				const stashBoolean = (key) => {
					if (typeof props[key] === 'boolean') {
						extraProps.scalar[key] = props[key];
					}
				};
				stashScalar('domain');
				stashScalar('entity');
				stashScalar('category');
				stashScalar('sedmFlag');
				stashScalar('scope');
				stashScalar('sedmCompliance');
				stashScalar('sedmIep');
				stashScalar('ssem');
				stashScalar('format');
				stashScalar('edfiMap');
				stashScalar('number');
				stashScalar('abbreviation');
				stashScalar('dataSource');
				stashScalar('dataNeeded');
				stashScalar('ideaStatuteRef');
				stashScalar('ideaIndicatorNumbers');
				stashScalar('complianceCategoryNumber');
				stashScalar('parentClass');
				stashScalar('parentComponent');
				stashScalar('subtypeCount');
				stashScalar('valueCount');
				stashScalar('csvColumn');
				stashScalar('edFactsCode');
				stashScalar('dataGroup');
				stashScalar('code');
				stashScalar('owningElementName');
				stashBoolean('ideaRequired');

				// ELEMENT cross-ref to a CEDS *property* (bridge stash): canonicalize the Global ID to
				// P###### (R3 — throw on a present-but-unnormalizable annotation), stash the resolver
				// property + crossRefs. NO edge is emitted (pure SEDM block).
				if (spec.kind === 'element' && props.cedsGlobalId != null && `${props.cedsGlobalId}`.trim() !== '') {
					const norm = normalize.normalizeCedsCrossRef({ rawValue: props.cedsGlobalId });
					if (norm.error) {
						throw new Error(
							`forge-sedm R3 CEDS cross-ref miss on element '${props.name}': ${norm.error}`,
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
						stats.crossRefsAnnotated++;
					}
				}

				makeNode({
					role: spec.role,
					perStandardLabel: spec.perStandardLabel,
					stableId: self.stableId,
					name: props.name,
					description: props.description,
					structural: {
						parentId,
						depth: depthByKind[spec.kind],
						path: props.naturalKey,
						owningName,
					},
					extraProps,
				});

				if (spec.kind === 'optionValue') {
					stats.optionValuesEmitted++;
				}

				// synthesized ownership edge from the root (HAS_CLASS / HAS_SUPPORT).
				const ownershipType = ownershipEdgeForKind[spec.kind];
				if (ownershipType) {
					addEdge(ownershipType, ROOT_STABLE_ID, self.stableId, `root->${spec.kind}`);
				}
			});

			// ---- translate native edges (the source node's own .edges, _referenceEdges, _parentEdge) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}

				// the native _parentEdge (option set -> value: HAS_VALUE).
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-sedm: untranslated native parent edge type '${nativeNode._parentEdge.type}' (${nativeNode._parentEdge.fromId}->${nativeNode.id})`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}

				// the node's outgoing native edges (element CONSTRAINED_BY -> option set => HAS_OPTION_SET;
				// element/support REFERENCES -> stays REFERENCES).
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-sedm: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						stats.elementOptionSetEdges++;
						if (target && target.stableId) {
							constrainedOptionSetStableIds.add(target.stableId);
						}
					}
					if (canonical === 'REFERENCES') {
						stats.referenceEdges++;
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});

				// the node's _referenceEdges (class->class, support->class subtype/category refs).
				(nativeNode._referenceEdges || []).forEach((refEdge) => {
					const target = nativeIdToStable[refEdge.targetId];
					stats.referenceEdges++;
					addEdge(
						EDGE_TYPES.REFERENCES,
						self.stableId,
						target && target.stableId,
						`REFERENCES:${nativeNode.id}->${refEdge.targetId}`,
					);
				});
			});

			// ---- ORPHAN-ANCHOR pass: an option set (DmeOptionSet) referenced by ZERO elements would be
			// unreachable, since option sets are owned by their constraining element(s) (above), not by
			// the root. Anchor each true orphan from the DmeStandardRoot via HAS_OPTION_SET so nothing is
			// unreachable. (SEDM's declared JSON option sets may be unreferenced -> orphans.)
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'SedmOptionSet') {
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
					`forge-sedm: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
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
						callback(`forge-sedm embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-sedm] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
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
				parseSedm(sourcePath, {}, (err, parsed) => {
					if (err) {
						next(`forge-sedm parse: ${err}`);
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
					next(`forge-sedm buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-sedm] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.crossRefsAnnotated} CEDS-annotated elements, ${graph.stats.optionValuesEmitted} option values, ` +
						`${graph.stats.elementOptionSetEdges} element->optionSet HAS_OPTION_SET, ${graph.stats.orphanAnchoredOptionSets} orphan-anchored option sets, ` +
						`${graph.stats.referenceEdges} REFERENCES)`,
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
