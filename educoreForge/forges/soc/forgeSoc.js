'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSoc.js — the SOC forge bundle. Parses the O*NET-SOC 2019 occupation taxonomy + O*NET Job
// Zones and emits the UNIVERSAL FORGE PROPERTY CONTRACT (the SAME contract forge-edfi/forge-sif/
// forge-ceds emit), so SOC lands in the validation graph interoperably. CSV family; mirrors
// forge-edfi/forgeEdfi.js exactly, adding the SUBCLASS_OF occupation taxonomy (as forge-ceds does
// for its class hierarchy).
//
// HARVESTED+ADAPTED from the OLD forge-soc (lib/parser.js navigation reused; node-shaping rewritten):
//   * the OLD tool used qtools-graph-forge-core/forgeRunner and emitted private Soc* nodes
//     (SocRoot/SocOccupation/SocJobZone) with hand-rolled native edges (HAS_OCCUPATION/HAS_JOB_ZONE/
//     AT_JOB_ZONE) and a soc-to-cip bridge that materialized CIP edges.
//   * THIS module maps each native node to a canonical Dme* role and emits a STANDARD-PURE SOC block:
//       SocRoot            -> DmeStandardRoot
//       SocGroup           -> DmeClass      (SUBCLASS_OF major<-minor<-broad, synthesized from codes)
//       SocOccupation      -> DmeClass      (SUBCLASS_OF its broad group)
//       SocJobZoneProperty -> DmeProperty   (one synthetic 'jobZone' property; owns the option set)
//       SocJobZoneSet      -> DmeOptionSet  (the single 'Job Zone' option set)
//       SocJobZone         -> DmeOptionValue (a preparation tier)
//     It builds searchText via the ONE shared 1C builder (structural context only), assigns
//     deterministic synthetic stableIds (soc:<kind>/<key>; SOC nodes have no native URI — a
//     code/path-based key, mirroring the EdFi STEEL_WHEEL ruling), and writes the canonical ownership
//     edges (HAS_CLASS/HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE) plus the SUBCLASS_OF taxonomy, all
//     stamped provenanceTier 'structural'.
//
// PURITY (forge is PURE/deterministic for (source, module)): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source. forge() runs parse -> buildContractGraph
// -> embedNodes. An R3 normalization miss or empty searchText (R4) THROWS — surfaced as a forge error.
//
// BRIDGE PURITY: this is a STANDARD-PURE SOC block — _source='SOC', SOC's own nodes + intra-SOC
// structural edges ONLY. The NCES CIP2020↔SOC2018 crosswalk is CROSS-STANDARD bridge data for a LATER
// phase: each occupation's cipMappings (raw CIP2020 codes) are stashed as a node property + crossRefs
// JSON, but NO CIP node and NO cross-standard mapping edge is emitted here. (The CIP code targets the
// CIP standard, not SOC, so it is never an in-standard resolver.)
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseSoc = require('./lib/parser');
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

const STANDARD_KEY = 'soc';
const STANDARD_SOURCE = 'SOC'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'Standard Occupational Classification / O*NET';
const STABLE_URI_PROPERTY_NAME = 'socStableId';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.
const CIP_ANCHOR_PROPERTY_NAME = 'cipMappings'; // the native crosswalk column source (origin, provenance)

// The mappingInstruction fields are DECLARED on the DmeStandardRoot. SOC bridges TO the CIP standard
// (impliedTargets ['CIP']); its native cross-anchor origin is the cipMappings crosswalk codes. The
// generic -specified bridge (a LATER phase) resolves SOC.cipMappings against CIP program codes.
const socMappingInstruction = {
	cipOriginalAnchorPropertyName: [CIP_ANCHOR_PROPERTY_NAME],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CIP'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch.
const roleSpecByNativeLabel = {
	SocGroup: { role: DME_ROLES.CLASS, kind: 'group', perStandardLabel: 'SocGroup' },
	SocOccupation: { role: DME_ROLES.CLASS, kind: 'occupation', perStandardLabel: 'SocOccupation' },
	SocJobZoneProperty: { role: DME_ROLES.PROPERTY, kind: 'property', perStandardLabel: 'SocJobZoneProperty' },
	SocJobZoneSet: { role: DME_ROLES.OPTION_SET, kind: 'optionSet', perStandardLabel: 'SocJobZoneSet' },
	SocJobZone: { role: DME_ROLES.OPTION_VALUE, kind: 'optionValue', perStandardLabel: 'SocJobZone' },
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
const naturalKeyByKind = {
	group: (props) => props.socCode,
	occupation: (props) => props.socCode,
	property: (props) => props.name, // the single synthetic 'jobZone' property
	optionSet: (props) => props.name, // 'Job Zone' -> soc:optionset/Job Zone
	optionValue: (props) => `jobZone.${props.zoneNumber}`,
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-edfi/forge-sif:
//   HAS_OCCUPATION/HAS_VALUE are canonical ownership reached through the native _parentEdge;
//   CONSTRAINED_BY (the jobZone property's codeset constraint) becomes HAS_OPTION_SET FROM THE
//   DmeProperty TO THE DmeOptionSet (the property OWNS its option set, SIF-canonical);
//   SUBCLASS_OF (occupation/group taxonomy) stays SUBCLASS_OF (as forge-ceds emits for its class
//   hierarchy). A genuine class->class reference (none in SOC's source) would stay REFERENCES.
const edgeTypeTranslation = {
	HAS_OCCUPATION: EDGE_TYPES.HAS_CLASS, // root -> occupation (from the native _parentEdge)
	HAS_VALUE: EDGE_TYPES.HAS_VALUE, // option set -> option value (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // jobZone property -> option set (the property's option set)
	SUBCLASS_OF: EDGE_TYPES.SUBCLASS_OF, // occupation/group -> parent group (taxonomy)
	REFERENCES: EDGE_TYPES.REFERENCES, // genuine class -> class references stay REFERENCES
};

// kinds the root owns directly via a SYNTHESIZED ownership edge. Groups have no native _parentEdge,
// so the root owns each group as a DmeClass via HAS_CLASS here; the synthetic jobZone property is
// HAS_PROPERTY. Occupations are DELIBERATELY ABSENT: each occupation already carries a native
// _parentEdge (HAS_OCCUPATION -> HAS_CLASS, translated below), so synthesizing a second HAS_CLASS
// here would emit a DUPLICATE root->occupation edge that the replay engine silently MERGEs (a
// collision the runbook warns against). The Job Zone option set is owned by its constraining property
// via the CONSTRAINED_BY -> HAS_OPTION_SET translation — NOT blanket-owned by the root. (The
// orphan-anchor pass below covers the contingency of an option set referenced by ZERO properties.)
const ownershipEdgeForKind = {
	group: EDGE_TYPES.HAS_CLASS,
	property: EDGE_TYPES.HAS_PROPERTY,
};

// structural depth per role (mirrors the forge-edfi/forge-ceds depth convention).
const depthByKind = {
	group: 1,
	occupation: 1,
	property: 1,
	optionSet: 1,
	optionValue: 2,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'soc:root';

		// stableId for a native node; throws on an empty/unknown key (R3 — never a silent malformed id).
		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-soc R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(`forge-soc: ${kind} produced an unclean stableId '${result.stableId}'`);
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
			// DmeSupport (unused by SOC, kept for parity with the shared builder).
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				occupationsAnnotatedWithCip: 0, // occupations carrying CIP cross-refs (bridge stash)
				totalCipCrossRefs: 0,
				subclassEdges: 0, // SUBCLASS_OF taxonomy edges
				optionValuesEmitted: 0,
				propertyOptionSetEdges: 0, // jobZone property -> option set HAS_OPTION_SET edges
				orphanAnchoredOptionSets: 0, // option sets referenced by 0 properties, anchored from root
				danglingEdges: [],
			};

			// option-set stableIds that a property constrains (gets HAS_OPTION_SET from a property);
			// populated during edge translation, consulted by the orphan-anchor pass.
			const constrainedOptionSetStableIds = new Set();

			// PASS 1 — index every native node and resolve its stableId + role.
			const nativeById = {};
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				nativeById[nativeNode.id] = nativeNode;
				if (nativeNode.label === 'SocRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-soc: unknown native SOC label '${nativeNode.label}'`);
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
						_id: stableId, // SOC _id === stableId (both deterministic from the natural key)
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
			const rootNative = nativeNodes.find((n) => n.label === 'SocRoot');
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: STANDARD_SOURCE,
				standardName: STANDARD_DISPLAY,
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'SocRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description:
						(rootNative && rootNative.properties && rootNative.properties.description) ||
						`${STANDARD_DISPLAY} — ${metadata.occupationCount} occupations, ${metadata.groupCount} groups, ${metadata.jobZoneCount} job zones`,
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
					mappingInstruction: JSON.stringify(socMappingInstruction),
				},
			});

			// ---- structural nodes (groups, occupations, the jobZone property, option set, values) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'SocRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning context + parent for searchText/path.
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (spec.kind === 'optionValue' && nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}
				// a group's structural parent is its SUBCLASS_OF target (for path/parentId clarity).
				if (spec.kind === 'group' || spec.kind === 'occupation') {
					const subclassEdge = (nativeNode.edges || []).find((e) => e.type === 'SUBCLASS_OF');
					if (subclassEdge) {
						const owner = nativeIdToStable[subclassEdge.targetId];
						if (owner) {
							parentId = owner.stableId;
						}
					}
				}

				// faithful native scalars + BRIDGE-stash cross-refs (stashed, NOT edged).
				const extraProps = { scalar: {}, crossRefs: [] };
				if (props.socCode) extraProps.scalar.socCode = props.socCode;
				if (props.socBaseCode) extraProps.scalar.socBaseCode = props.socBaseCode;
				if (props.socLevel) extraProps.scalar.socLevel = props.socLevel;
				if (props.zoneNumber != null) extraProps.scalar.zoneNumber = props.zoneNumber;
				if (props.zoneName) extraProps.scalar.zoneName = props.zoneName;
				if (props.experience) extraProps.scalar.experience = props.experience;
				if (props.education) extraProps.scalar.education = props.education;
				if (props.training) extraProps.scalar.training = props.training;
				if (props.examples) extraProps.scalar.examples = props.examples;
				if (props.svpRange) extraProps.scalar.svpRange = props.svpRange;
				if (props.valueCount != null) extraProps.scalar.valueCount = props.valueCount;
				if (props.jobZone != null) extraProps.scalar.jobZone = props.jobZone;
				if (Array.isArray(props.alternateTitles) && props.alternateTitles.length) {
					extraProps.scalar.alternateTitles = props.alternateTitles;
				}

				// OCCUPATION cross-ref to CIP *programs* (CROSS-STANDARD bridge stash): the raw CIP2020
				// codes mapped to this SOC base code. Stashed as cipMappings + crossRefs; NO edge emitted
				// (standard-pure SOC block — the CIP code targets the CIP standard, not SOC).
				if (
					spec.kind === 'occupation' &&
					Array.isArray(props.cipMappings) &&
					props.cipMappings.length
				) {
					const crossRefs = [];
					const cleanCipCodes = [];
					props.cipMappings.forEach((rawCip) => {
						const norm = normalize.normalizeCipCode({ rawValue: rawCip });
						if (norm.absent) {
							return;
						}
						cleanCipCodes.push(norm.cipCode);
						crossRefs.push({
							system: 'cip',
							id: norm.cipCode,
							raw: `${rawCip}`,
							locator: CIP_ANCHOR_PROPERTY_NAME,
						});
					});
					if (cleanCipCodes.length) {
						extraProps.scalar.cipMappings = cleanCipCodes;
						extraProps.scalar.cipOriginalAnchorPropertyName = [CIP_ANCHOR_PROPERTY_NAME];
						extraProps.crossRefs = crossRefs;
						stats.occupationsAnnotatedWithCip++;
						stats.totalCipCrossRefs += cleanCipCodes.length;
					}
				}

				const pathLabel =
					spec.kind === 'optionValue' ? `${owningName}.${props.name}` : `${props.name}`;

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

				if (spec.kind === 'optionValue') {
					stats.optionValuesEmitted++;
				}

				// synthesized ownership edge from the root (HAS_CLASS / HAS_PROPERTY).
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
				// the native _parentEdge (HAS_OCCUPATION -> HAS_CLASS; HAS_VALUE -> HAS_VALUE).
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-soc: untranslated native parent edge type '${nativeNode._parentEdge.type}' (${nativeNode._parentEdge.fromId}->${nativeNode.id})`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}
				// the node's outgoing native edges (SUBCLASS_OF taxonomy; jobZone property
				// CONSTRAINED_BY -> option set => HAS_OPTION_SET: the DmeProperty owns its DmeOptionSet).
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-soc: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						stats.propertyOptionSetEdges++;
						if (target && target.stableId) {
							constrainedOptionSetStableIds.add(target.stableId);
						}
					}
					if (nativeEdge.type === 'SUBCLASS_OF') {
						stats.subclassEdges++;
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			// ---- ORPHAN-ANCHOR pass: an option set (DmeOptionSet) referenced by ZERO properties would
			// be unreachable, since option sets are owned by their constraining property (above), not by
			// the root. Anchor each true orphan from the DmeStandardRoot via HAS_OPTION_SET so nothing
			// is unreachable. (Mirrors forge-edfi. SOC's single Job Zone set IS property-constrained, so
			// the count is expected 0 — but the pass is mandatory per the runbook EDGE CONVENTION.)
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'SocJobZoneSet') {
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
					`forge-soc: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
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
						callback(`forge-soc embedNodes batch ${bi} failed: ${err}`);
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
						xLog.status(`[forge-soc] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`);
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
				parseSoc(sourcePath, {}, (err, parsed) => {
					if (err) {
						next(`forge-soc parse: ${err}`);
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
					next(`forge-soc buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-soc] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.subclassEdges} SUBCLASS_OF, ${graph.stats.propertyOptionSetEdges} property->optionSet HAS_OPTION_SET, ` +
						`${graph.stats.optionValuesEmitted} option values, ${graph.stats.occupationsAnnotatedWithCip} CIP-annotated occupations (${graph.stats.totalCipCrossRefs} pairs, bridge stash), ` +
						`${graph.stats.orphanAnchoredOptionSets} orphan-anchored option sets)`,
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
