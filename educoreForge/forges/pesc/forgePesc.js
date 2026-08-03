'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgePesc.js — the PESC forge bundle. Parses the PESC XML Schema (XSD) set and emits the UNIVERSAL
// FORGE PROPERTY CONTRACT (the SAME contract forge-sif/forge-edfi/forge-ceds emit), so PESC lands in
// the validation graph interoperably. XSD-family TRAILBLAZER; mirrors forge-sif/forge-edfi exactly in
// structure, adapted for an XML-Schema source.
//
// HARVESTED+ADAPTED from the OLD forge-pesc (lib/parser.js XSD navigation reused; node-shaping
// rewritten here):
//   * the OLD tool emitted private Pesc* nodes (PescComplexType/PescSimpleType/PescGroup/PescElement/
//     PescEnumValue/PescRootElement/PescSourceFile) with hand-rolled native edges (HAS_ELEMENT,
//     HAS_TYPE, INCLUDES_GROUP, HAS_ENUM_VALUE, DEFINES_TYPE, HAS_ROOT_ELEMENT) and an older contract.
//   * THIS module maps each native node to one of the canonical Dme* roles (the XSD ROLE MAPPING,
//     ruled for the XSD family and documented in forgeCampaignRunbook-XSD.md):
//       PescComplexType   -> DmeClass      (a structured type / inline-typed message element)
//       PescField         -> DmeProperty   (an xs:element OR xs:attribute within a type/group)
//       PescOptionSet     -> DmeOptionSet  (a simpleType WITH xs:enumeration)
//       PescOptionValue   -> DmeOptionValue (one enumeration value)
//       PescSupport       -> DmeSupport    (a named simpleType WITHOUT enumeration, or an xs:group —
//                                           reusable scaffolding referenced by complexTypes)
//       PescRoot          -> DmeStandardRoot
//   It builds searchText via the ONE shared 1C builder (structural context only), assigns
//   deterministic synthetic stableIds (pesc:<kind>/<source>/<name>; the source-file label
//   disambiguates the local type names that recur across XSD files — XSD types have per-file
//   namespace URIs, not clean per-element ones, so a path-based key, mirroring SIF/EdFi), and writes
//   the canonical edges, all stamped provenanceTier 'structural'.
//
// EDGE CONVENTION (mandatory — from forge-sif/forgeSif.js:95, asserted in its test):
//   * a class owns its elements/attributes via HAS_PROPERTY (native HAS_FIELD parent edge).
//   * a PROPERTY typed by an enumeration simpleType => HAS_OPTION_SET FROM the DmeProperty TO the
//     DmeOptionSet (native TYPED_BY whose target is an optionSet). The property OWNS its option set —
//     never REFERENCES. An option set referenced by ZERO properties (orphan) is anchored from the
//     root via HAS_OPTION_SET in a dedicated pass so nothing is unreachable.
//   * a complexType extension/restriction of another complexType => SUBCLASS_OF (native EXTENDS).
//   * use of a named type / group => REFERENCES (native TYPED_BY to a complexType, REFERENCES_TYPE
//     from a message element) OR HAS_SUPPORT for a group/support-type usage (native USES_SUPPORT).
//   * support usage from the root => HAS_SUPPORT; option set -> values => HAS_VALUE.
//
// PURITY: buildContractGraph is a PURE, synchronous, deterministic function of the parsed source.
// forge() runs parse -> buildContractGraph -> embedNodes. An R3 normalization miss or empty
// searchText (R4) THROWS — surfaced as a forge error.
//
// BRIDGE PURITY: STANDARD-PURE PESC block — _source='PESC', PESC's own nodes + intra-PESC structural
// edges ONLY. The OLD forge's separate bridges/*.json CEDS/CLR/CTDL/LIF crosswalks are NOT inside the
// XSD source and are a later-phase BRIDGE concern — NOT read here, NO cross-standard edge emitted.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parsePesc = require('./lib/parser');
const normalize = require('./lib/normalize');

const CORE_LIB = path.join(__dirname, '..', '..', 'lib'); // PORTED: recreation substrate
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { deriveVersionStamp } = require(
	path.join(CORE_LIB, 'snapshot-provenance', 'snapshot-provenance'),
);

// canonical vocabulary (Phase 1 registry). Values are byte-identical to the prior inline literals, so
// the emitted nodes/edges are unchanged.
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

// the central structural-property authority (Wave-2 items 5/6; M7/M8): enforces the parentId ->
// member-stableId referent, derives depth (= parentId-chain length), stamps crossRefs universally,
// and aligns single-owner optionSet parenting. Called as buildContractGraph's LAST step.
const { finalizeStructuralContract } = require(
	path.join(CORE_LIB, 'structural-contract', 'structural-contract'),
);

const STANDARD_KEY = 'pesc';
const STANDARD_SOURCE = 'PESC'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'PESC XML Schema (Postsecondary Electronic Standards Council)';
const STABLE_URI_PROPERTY_NAME = 'pescStableId';
const EMBED_BATCH_SIZE = 128;

// PESC carries no in-schema CEDS crosswalk, so it has no native CEDS anchor and -specified emits 0.
// That does NOT mean "no implied bridge": anchor-free education-data standards still bridge entirely
// via -implied (the CASE precedent). PESC therefore declares includeInImplied:true with the CEDS hub
// as its implied target (impliedTargets ['CEDS']), matching forge-clr/forge-case house style.
const pescMappingInstruction = {
	cedsOriginalAnchorPropertyName: [],
	cedsOptionOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch.
const roleSpecByNativeLabel = {
	PescComplexType: { role: DME_ROLES.CLASS, kind: 'complexType', perStandardLabel: 'PescComplexType' },
	PescField: { role: DME_ROLES.PROPERTY, kind: 'field', perStandardLabel: 'PescField' },
	PescOptionSet: { role: DME_ROLES.OPTION_SET, kind: 'optionSet', perStandardLabel: 'PescOptionSet' },
	PescOptionValue: {
		role: DME_ROLES.OPTION_VALUE,
		kind: 'optionValue',
		perStandardLabel: 'PescOptionValue',
	},
	PescSupport: { role: DME_ROLES.SUPPORT, kind: 'support', perStandardLabel: 'PescSupport' },
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
// All PESC keys are source-qualified (the local type name recurs across XSD files).
const naturalKeyByKind = {
	complexType: (props) => `${props.sourceFile}/${props.name}`,
	field: (props) => `${props.sourceFile}/${props.owningTypeName}.${props.xsdKind}.${props.name}`,
	optionSet: (props) => `${props.sourceFile}/${props.name}`,
	optionValue: (props) => `${props.sourceFile}/${props.optionSetName}.${props.name}`,
	support: (props) => `${props.sourceFile}/${props.name}`,
};

// native edge type -> canonical (all stamped 'structural'). Mirrors forge-sif:95 / forge-edfi:97.
//   HAS_FIELD/HAS_VALUE reached through the native _parentEdge are canonical ownership.
//   TYPED_BY is RESOLVED CONTEXTUALLY at translation time (target kind decides HAS_OPTION_SET vs
//   REFERENCES) — it is NOT a fixed entry here; see translateContextualEdge.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // type/group -> field (native _parentEdge)
	HAS_VALUE: EDGE_TYPES.HAS_VALUE, // optionSet -> value (native _parentEdge)
	EXTENDS: EDGE_TYPES.SUBCLASS_OF, // complexType extension/restriction base (-> base complexType)
	USES_SUPPORT: EDGE_TYPES.HAS_SUPPORT, // complexType -> group (reusable scaffolding)
	// TYPED_BY and REFERENCES_TYPE are contextual (see below); REFERENCES passes through.
	REFERENCES: EDGE_TYPES.REFERENCES,
};

// kinds the root owns directly (synthesized ownership edges). Every complexType is HAS_CLASS; every
// support node is HAS_SUPPORT. An option set is owned by its constraining property via the TYPED_BY
// -> HAS_OPTION_SET translation — NOT blanket-owned by the root. ONLY an option set referenced by
// ZERO properties (a true orphan) gets a HAS_OPTION_SET anchor from the root (dedicated pass below).
const ownershipEdgeForKind = {
	complexType: EDGE_TYPES.HAS_CLASS,
	support: EDGE_TYPES.HAS_SUPPORT,
};

// structural depth per role (mirrors the forge-sif/forge-edfi depth convention).
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

		const ROOT_STABLE_ID = 'pesc:root';

		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-pesc R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-pesc: ${kind} produced an unclean stableId '${result.stableId}'`,
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
				propertyOptionSetEdges: 0, // property -> optionSet HAS_OPTION_SET (the property's option set)
				subclassEdges: 0, // complexType -> base complexType SUBCLASS_OF
				supportUsageEdges: 0, // complexType -> group HAS_SUPPORT
				referencesEdges: 0, // class/element -> named type REFERENCES
				orphanAnchoredOptionSets: 0, // option sets with 0 referencing properties, anchored from root
				danglingEdges: [],
			};

			// option-set stableIds that a property types against (gets HAS_OPTION_SET from a property);
			// populated during edge translation, consulted by the orphan-anchor pass.
			const constrainedOptionSetStableIds = new Set();

			// PASS 1 — index every native node and resolve its stableId + role + kind.
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'PescRoot') {
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
					throw new Error(`forge-pesc: unknown native PESC label '${nativeNode.label}'`);
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

			// addEdge — canonical edge, stamped structural. Resolves BOTH endpoints to stableIds; an
			// unresolved endpoint is recorded (dangling), never a partial edge.
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
						_id: stableId, // PESC _id === stableId (both deterministic from the natural key)
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
				labels: [NODE_LABELS.FORGED_NODE, 'PescRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${metadata.complexTypeCount} complex types, ${metadata.simpleTypeCount} simple types, ${metadata.groupCount} groups across ${metadata.sourceFileCount} XSD files`,
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
					mappingInstruction: JSON.stringify(pescMappingInstruction),
				},
			});

			// ---- structural nodes (complexTypes, fields, option sets, option values, support) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'PescRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning context + parent for searchText/path (a field's owning type; a value's set).
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// faithful native scalars worth keeping queryable.
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

				// synthesized ownership edge from the root (HAS_CLASS / HAS_SUPPORT).
				const ownershipType = ownershipEdgeForKind[spec.kind];
				if (ownershipType) {
					addEdge(ownershipType, ROOT_STABLE_ID, self.stableId, `root->${spec.kind}`);
				}
			});

			// ---- translate native edges (the _parentEdge and each node's outgoing .edges) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}

				// native _parentEdge (HAS_FIELD -> HAS_PROPERTY; HAS_VALUE -> HAS_VALUE).
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-pesc: untranslated native parent edge type '${nativeNode._parentEdge.type}' (${nativeNode._parentEdge.fromId}->${nativeNode.id})`,
						);
					}
					addEdge(
						canonical,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}

				// the node's outgoing native edges.
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const targetKind = nativeEdge.targetKind || (target && target.kind);

					// CONTEXTUAL: a property/element TYPED_BY (or a message element REFERENCES_TYPE):
					//   target is an option set  => HAS_OPTION_SET (the property OWNS its option set)
					//   target is anything else  => REFERENCES (use of a named type)
					if (nativeEdge.type === 'TYPED_BY' || nativeEdge.type === 'REFERENCES_TYPE') {
						let canonical;
						if (targetKind === 'optionSet') {
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

					// fixed translations (EXTENDS -> SUBCLASS_OF; USES_SUPPORT -> HAS_SUPPORT; ...).
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-pesc: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					if (nativeEdge.type === 'EXTENDS') {
						stats.subclassEdges++;
					}
					if (nativeEdge.type === 'USES_SUPPORT') {
						stats.supportUsageEdges++;
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			// ---- ORPHAN-ANCHOR pass: an option set typed against by ZERO properties would be
			// unreachable (option sets are owned by their typing property, not the root). Anchor each
			// true orphan from the DmeStandardRoot via HAS_OPTION_SET. (Mirrors forge-edfi:484.)
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label !== 'PescOptionSet') {
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
					`forge-pesc: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). Mirrors forge-sif/forge-edfi.
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
						callback(`forge-pesc embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-pesc] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-sif/forge-edfi.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parsePesc(sourcePath, {}, (err, parsed) => {
					if (err) {
						next(`forge-pesc parse: ${err}`);
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
					next(`forge-pesc buildContractGraph: ${buildError}`);
					return;
				}
				// the parser's silent-source audit ledger (Phase 1, R-PW-4) rides in stats — run
				// diagnostics, digest-excluded — never in metadata, which is block content.
				graph.stats.parseAudit = args.parsed.parseAudit;
				xLog.status(
					`[forge-pesc] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.fieldCount} fields, ${graph.stats.optionValuesEmitted} option values, ` +
						`${graph.stats.propertyOptionSetEdges} property->optionSet HAS_OPTION_SET, ` +
						`${graph.stats.subclassEdges} SUBCLASS_OF, ${graph.stats.supportUsageEdges} HAS_SUPPORT-usage, ` +
						`${graph.stats.referencesEdges} REFERENCES, ${graph.stats.orphanAnchoredOptionSets} orphan-anchored option sets)`,
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
