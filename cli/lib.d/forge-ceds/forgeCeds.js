'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCeds.js — the CEDS forge bundle. Parses CEDS-Ontology.rdf and emits the UNIVERSAL
// FORGE PROPERTY CONTRACT (DESIGN §A/§B/§C/§D/§E/§F, DECISIONS §6-§12, §23-R3/R4).
//
// HARVESTED+ADAPTED from trackA forge-ceds-rdf (parser reused; node-shaping rewritten):
//   * trackA emitted private Ceds* nodes with a hand-rolled `name: description` searchText and
//     PART_OF edges. THIS module emits the six canonical Dme* roles, builds searchText via the
//     ONE shared 1C builder, normalizes anchors to canonical cedsId (R3), captures crossRefs as
//     a JSON property, and writes the canonical ownership edges (HAS_CLASS/HAS_PROPERTY/
//     HAS_OPTION_SET/HAS_VALUE + SUBCLASS_OF/REFERENCES) all stamped provenanceTier 'structural'.
//
// PURITY (DESIGN "forge is PURE/deterministic for (source, module)"): buildContractGraph is a
// PURE, synchronous, deterministic function of the parsed source — same source -> identical
// nodes/edges (modulo embeddings, which are added in a separate embedNodes pass). The forge()
// orchestrator runs parse -> buildContractGraph -> embedNodes.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts.
// No async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { parseCeds } = require('./lib/parser');
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

// canonical vocabulary (Phase 1 registry). Values are byte-identical to the prior inline literals, so
// the emitted nodes/edges are unchanged (verified by the structural-fingerprint gate).
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER, CANONICAL_ADDRESS_PROPERTIES } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);
// canonical-address component property NAMES, now sourced from the registry (Phase 3 promotion of the
// Phase-2 local literals; HANDOFF (d)). Byte-identical: same key strings, proven by forgeStructuralFingerprint.
const A = CANONICAL_ADDRESS_PROPERTIES;

// the central structural-property authority (Wave-2 items 5/6; M7/M8): enforces the parentId ->
// member-stableId referent, derives depth (= parentId-chain length), stamps crossRefs universally,
// and aligns single-owner optionSet parenting. Called as buildContractGraph's LAST step.
const { finalizeStructuralContract } = require(
	path.join(CORE_LIB, 'structural-contract', 'structural-contract'),
);

const STANDARD_KEY = 'ceds';
const STABLE_URI_PROPERTY_NAME = 'uri';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.

// Phase 2 — CANONICAL ADDRESSING (WHITEPAPER §4.2 per-slot id table; §5 stratum 2: "hub nodes carry
// their canonical-address components + version"). PROPERTY-ONLY delta: adds address components to the
// CEDS hub structural nodes — NO node or edge is added or removed.
//   canonicalKey = the KIND-PREFIXED CEDS id (P-form for DmeProperty, OV-form for DmeOptionValue) — the
//     version-stable DURABLE join key. (The bare 6-digit Global ID is reused across a class and its
//     characterizing property — 201 C/P core collisions in the Ed-Fi crosswalk — so it is NOT unique
//     alone; the kind-prefixed form is. Clarified with WILD_FALCON 2026-06-29.)
//   domainId / rangeOptionSetId = version-scoped slot ids (the class id / the option-set id) — these are
//     this-version structure, NEVER durable keys, so they are NOT called canonicalKey (§4.2).
//   hubName / hubVersion tag every hub structural node (§8 "hub structural nodes tagged with hubName").
const HUB_NAME = 'CEDS';

// The mappingInstruction fields are DECLARED present-but-unpopulated for CEDS (DECISIONS §12).
const emptyMappingInstruction = {
	cedsOriginalAnchorPropertyName: [],
	cedsOptionOriginalAnchorPropertyName: [],
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

		// -----
		// deterministic _id from natural keys (DESIGN §B: "deterministic from natural keys").
		//   <standardKey>:<canonical cedsId>; the root uses a fixed natural key.
		const idFor = (canonicalCedsId) => `${STANDARD_KEY}:${canonicalCedsId}`;
		const ROOT_ID = `${STANDARD_KEY}:root`;

		// -----
		// crossRefsForCeds — a CEDS node's own native cross-reference: its canonical cedsId in
		//   the `ceds` system (DESIGN §E shape {system,id,raw,locator}). CEDS is the hub, so its
		//   only native self-reference is its own canonical id; this is the raw input the
		//   specifiedBridgeMaker later turns into edges. crossRefs is stored as a JSON property.
		const crossRefsForCeds = ({ canonicalCedsId, rawAnchor }) => [
			{
				system: 'ceds',
				id: canonicalCedsId,
				raw: rawAnchor == null ? null : `${rawAnchor}`,
				locator: 'dc:identifier',
			},
		];

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges }.
		//   Each node carries the universal contract MINUS embedding (added later). A
		//   normalization miss (R3) or empty searchText (R4) throws — surfaced as a forge error.
		// =====================================================================

		const buildContractGraph = ({ entities, maps, metadata }) => {
			const { classes, properties, optionSets, optionValues } = entities;
			const { classByUri, optionSetByUri } = maps;

			const nodes = [];
			const edges = [];

			// resolve canonical cedsId for a raw entity; throws on a miss (R3, never silent).
			const canonicalFor = (rawCedsId, kind, uri) => {
				const result = normalize.normalizeCedsId({ rawValue: rawCedsId, kind });
				if (result.error) {
					// try the uri as a second native anchor form before failing
					const fromUri = normalize.normalizeCedsId({ rawValue: uri, kind });
					if (!fromUri.error) {
						return fromUri.cedsId;
					}
					throw new Error(
						`forge-ceds R3 normalization miss: ${result.error} (uri='${uri}')`,
					);
				}
				return result.cedsId;
			};

			// stamp the universal contract onto one node, building searchText via 1C (R4).
			const makeNode = ({
				role,
				perStandardLabel,
				rawEntity,
				kind,
				searchTextElement,
				extraProps,
				structural,
				addressSlots,
			}) => {
				const canonicalCedsId = canonicalFor(rawEntity.cedsId, kind, rawEntity.uri);

				// Phase 2 canonical-address components (per-slot id table, §4.2). The node stamps the slot
				// it IS (a property/value carries the durable canonicalKey; a class is the domain slot; an
				// option set is the range slot); the caller supplies the OTHER slots it points at
				// (a property's owning class + range; a value's owning set) via addressSlots.
				const addressProps = { [A.HUB_NAME]: HUB_NAME, [A.HUB_VERSION]: metadata.version };
				if (kind === 'property' || kind === 'optionValue') {
					addressProps[A.CANONICAL_KEY] = canonicalCedsId; // durable join key (P-form / OV-form)
				}
				if (kind === 'class') {
					addressProps[A.DOMAIN_ID] = canonicalCedsId; // the class IS the domain slot (version-scoped)
				}
				if (kind === 'optionSet') {
					addressProps[A.RANGE_OPTION_SET_ID] = canonicalCedsId; // the set IS the range slot (version-scoped)
				}
				if (addressSlots) {
					if (addressSlots.domainId) {
						addressProps[A.DOMAIN_ID] = addressSlots.domainId;
					}
					if (addressSlots.rangeOptionSetId) {
						addressProps[A.RANGE_OPTION_SET_ID] = addressSlots.rangeOptionSetId;
					}
					if (addressSlots.rangeClassId) {
						addressProps[A.RANGE_CLASS_ID] = addressSlots.rangeClassId;
					}
					if (addressSlots.rangeDatatype) {
						addressProps[A.RANGE_DATATYPE] = addressSlots.rangeDatatype;
					}
				}
				const stableId = rawEntity.uri; // CEDS stableUriPropertyName = 'uri'
				if (!normalize.isCleanStableId(stableId)) {
					throw new Error(
						`forge-ceds: ${role} ${canonicalCedsId} has no clean stableId (uri) — got '${stableId}'`,
					);
				}

				// searchText via the ONE shared builder — empty throws ValidationError (R4).
				const searchText = buildSearchText({ role, ...searchTextElement });

				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: {
						_id: idFor(canonicalCedsId),
						_source: 'CEDS',
						name: searchTextElement.name,
						description: rawEntity.description || '',
						role,
						uri: stableId, // the stable identifier, under stableUriPropertyName
						cedsId: canonicalCedsId, // canonical anchor (R3)
						cedsOriginalAnchorPropertyName: ['dc:identifier'], // native anchor forms (R3)
						searchText,
						crossRefs: JSON.stringify(
							crossRefsForCeds({ canonicalCedsId, rawAnchor: rawEntity.cedsId }),
						),
						...addressProps, // Phase 2 canonical-address components
						...(extraProps || {}),
					},
				};
				if (structural) {
					node.properties.parentId = structural.parentId;
					node.properties.depth = structural.depth;
					node.properties.path = structural.path;
				}
				nodes.push(node);
				return { node, canonicalCedsId, stableId };
			};

			// edge — canonical ownership/reference edge, stamped structural (DECISIONS §11).
			const addEdge = (type, fromStableId, toStableId) => {
				edges.push({
					type,
					fromRef: { source: 'CEDS', id: fromStableId },
					toRef: { source: 'CEDS', id: toStableId },
					properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
				});
			};

			// ---- DmeStandardRoot (the per-standard top; provenance block + stableUriPropertyName
			//      + DECLARED-but-unpopulated mappingInstruction, DECISIONS §6/§7/§12) ----
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: 'CEDS',
				standardName: 'Common Education Data Standards',
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'CedsOntology', DME_ROLES.STANDARD_ROOT],
				stableId: metadata.sourceUrl,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_ID,
					_source: 'CEDS',
					name: 'CEDS',
					description: `Common Education Data Standards ontology, version ${metadata.version}`,
					role: DME_ROLES.STANDARD_ROOT,
					uri: metadata.sourceUrl,
					searchText: rootSearchText,
					// provenance block (DESIGN §B "Required on the DmeStandardRoot")
					standardKey: STANDARD_KEY,
					standardName: 'Common Education Data Standards',
					version: metadata.version,
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles,
					sourceUrl: metadata.sourceUrl,
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism. The run timestamp lives in the store
					// row (blocks.createdAt), never in content-addressed block text.
					coreVersion: '2.0.0',
					// stableUriPropertyName + mappingInstruction (DECISIONS §6/§12)
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(emptyMappingInstruction),
				},
			});

			// ---- DmeClass nodes ----
			const classCanonicalByUri = {};
			classes.forEach((cls) => {
				const className = cls.label || cls.cedsId;
				const built = makeNode({
					role: DME_ROLES.CLASS,
					perStandardLabel: 'CedsClass',
					rawEntity: cls,
					kind: 'class',
					searchTextElement: {
						name: className,
						standardName: 'CEDS',
						owningName: 'CEDS',
					},
					extraProps: { notation: cls.notation || '' },
					// parentId referent = MEMBER stableId (M7) — the root's stableId, not the _id-form ROOT_ID
					structural: { parentId: metadata.sourceUrl, depth: 1, path: className },
				});
				classCanonicalByUri[cls.uri] = { className, stableId: built.stableId };
				// HAS_CLASS: root -> class (canonical ownership)
				addEdge(EDGE_TYPES.HAS_CLASS, metadata.sourceUrl, built.stableId);
			});

			// SUBCLASS_OF (after all classes exist so the parent stableId is resolvable)
			classes.forEach((cls) => {
				if (cls.parentRef && classByUri[cls.parentRef]) {
					addEdge(EDGE_TYPES.SUBCLASS_OF, cls.uri, cls.parentRef);
				}
			});

			// ---- DmeProperty nodes (carry owning Class name in searchText — the CEDS hub fix) ----
			properties.forEach((prop) => {
				const propName = prop.label || prop.cedsId;
				// owning class: first CEDS domain ref
				const owningClassUri = (prop.domainRefs || []).find((u) => classByUri[u]);
				const owningClassName = owningClassUri
					? classCanonicalByUri[owningClassUri] &&
						classCanonicalByUri[owningClassUri].className
					: undefined;
				const parentStableId = owningClassUri || metadata.sourceUrl;

				const extraProps = {};
				if (prop.dataType) {
					extraProps.dataType = prop.dataType;
				}
				if (prop.textFormat) {
					extraProps.textFormat = prop.textFormat;
				}
				if (prop.maxLength) {
					extraProps.maxLength = prop.maxLength;
				}
				extraProps.notation = prop.notation || '';

				// Phase 2 address slots: the property's owning-class domain id + its range. domainId is the
				// owning class's canonical C-id (version-scoped). The range slot is the first rangeRef that
				// resolves to an option set (its OS-id) ELSE the first rangeRef that resolves to a CEDS
				// class (its C-id) ELSE the property's scalar datatype (§4.2/070126 update: range = option-
				// set id OR class id OR datatype — three mutually exclusive first-class shapes).
				const domainSlotId = owningClassUri
					? normalize.normalizeCedsId({
							rawValue: classByUri[owningClassUri].cedsId,
							kind: 'class',
						}).cedsId
					: undefined;
				let rangeOptionSetSlotId;
				(prop.rangeRefs || []).forEach((rangeUri) => {
					if (!rangeOptionSetSlotId && optionSetByUri[rangeUri]) {
						const resolved = normalize.normalizeCedsId({
							rawValue: optionSetByUri[rangeUri].cedsId,
							kind: 'optionSet',
						});
						if (!resolved.error) {
							rangeOptionSetSlotId = resolved.cedsId;
						}
					}
				});
				// Range slot has THREE first-class source shapes, mutually exclusive in source (confirmed
				// INVESTIGATION-rangelessHubs-070126.md: an object/association property carries no dataType
				// signal, and vice versa): an option set (rangeOptionSetSlotId, above), a CEDS CLASS
				// reference (rangeClassSlotId — an object/association property whose range IS another CEDS
				// class, e.g. 'Has Assessment' -> Assessment; §schema:rangeIncludes -> C-class), or an XSD
				// scalar datatype. A class range was previously either dropped entirely (2-slot tuple) or
				// (interim conservative fix) flattened into a 'reference' rangeDatatype marker; it is now
				// modeled as its own address slot — the class's canonical (version-scoped) id — mirroring
				// rangeOptionSetId exactly. This also feeds a real HAS_CEDS_RANGE -> CedsClass edge at the
				// HubReference layer (referenceSubgraph.js), parallel to HAS_CEDS_RANGE -> DmeOptionSet.
				// Pure/deterministic (classByUri is built from source), so addressSignature stays stable
				// per input (though its VALUE differs from both the pre-fix and the interim-marker forge —
				// expected, see DEVLOG-pureGraph3Build-070126.md).
				let rangeClassSlotId;
				if (!rangeOptionSetSlotId) {
					(prop.rangeRefs || []).forEach((rangeUri) => {
						if (!rangeClassSlotId && classByUri[rangeUri]) {
							const resolved = normalize.normalizeCedsId({
								rawValue: classByUri[rangeUri].cedsId,
								kind: 'class',
							});
							if (!resolved.error) {
								rangeClassSlotId = resolved.cedsId;
							}
						}
					});
				}
				// 'unspecified' is reserved for the genuinely-empty case (source: P001396 — no option set,
				// no class, no datatype). It is NEVER stamped when a class range was found.
				const rangeDatatypeSlot =
					rangeOptionSetSlotId || rangeClassSlotId
						? undefined
						: prop.dataType
							? prop.dataType
							: 'unspecified';

				const built = makeNode({
					role: DME_ROLES.PROPERTY,
					perStandardLabel: 'CedsProperty',
					rawEntity: prop,
					kind: 'property',
					searchTextElement: {
						name: propName,
						owningClassName: owningClassName || 'CEDS',
						owningName: owningClassName || 'CEDS',
					},
					extraProps,
					addressSlots: {
						domainId: domainSlotId,
						rangeOptionSetId: rangeOptionSetSlotId,
						rangeClassId: rangeClassSlotId,
						rangeDatatype: rangeDatatypeSlot,
					},
					structural: {
						// parentId referent = MEMBER stableId (M7): the owning class's uri (its stableId),
						// or the root's stableId — the same value the HAS_PROPERTY edge uses (parentStableId).
						parentId: parentStableId,
						depth: owningClassUri ? 2 : 1,
						path: `${owningClassName || 'CEDS'}.${propName}`,
					},
				});

				// HAS_PROPERTY: owning class -> property (immediate containment, DESIGN §F)
				addEdge(EDGE_TYPES.HAS_PROPERTY, parentStableId, built.stableId);

				// HAS_OPTION_SET: property -> option set (range that is itself an option set)
				(prop.rangeRefs || []).forEach((rangeUri) => {
					if (optionSetByUri[rangeUri]) {
						addEdge(EDGE_TYPES.HAS_OPTION_SET, built.stableId, rangeUri);
					} else if (classByUri[rangeUri]) {
						// range pointing at a class is a REFERENCE (DESIGN §F)
						addEdge(EDGE_TYPES.REFERENCES, built.stableId, rangeUri);
					}
				});
			});

			// ---- DmeOptionSet nodes ----
			const optionSetCanonicalByUri = {};
			optionSets.forEach((os) => {
				const setName = os.label || os.cedsId;
				const built = makeNode({
					role: DME_ROLES.OPTION_SET,
					perStandardLabel: 'CedsOptionSet',
					rawEntity: os,
					kind: 'optionSet',
					searchTextElement: {
						name: setName,
						owningName: 'CEDS',
						owningClassName: 'CEDS',
					},
					extraProps: { notation: os.notation || '' },
					// parentId referent = MEMBER stableId (M7); single-owner sets are re-parented to their
					// owning property by the shared structural-contract finalizer (M8).
					structural: { parentId: metadata.sourceUrl, depth: 2, path: setName },
				});
				optionSetCanonicalByUri[os.uri] = { setName, stableId: built.stableId };
			});

			// ---- DmeOptionValue nodes (each carries its set + owner in searchText) ----
			optionValues.forEach((ov) => {
				const valueName = ov.label || ov.cedsId;
				const owningSetUri = ov.inSchemeRef;
				const owningSet = owningSetUri ? optionSetCanonicalByUri[owningSetUri] : undefined;
				const optionSetName = owningSet ? owningSet.setName : 'CEDS';

				// Phase 2 address slot: the value's range is its owning option set's canonical OS-id.
				const owningSetRangeId =
					owningSetUri && optionSetByUri[owningSetUri]
						? normalize.normalizeCedsId({
								rawValue: optionSetByUri[owningSetUri].cedsId,
								kind: 'optionSet',
							}).cedsId
						: undefined;

				const built = makeNode({
					role: DME_ROLES.OPTION_VALUE,
					perStandardLabel: 'CedsOptionValue',
					rawEntity: ov,
					kind: 'optionValue',
					searchTextElement: {
						name: valueName,
						optionSetName,
						owningName: optionSetName,
						owningClassName: 'CEDS',
					},
					extraProps: { notation: ov.notation || '' },
					addressSlots: { rangeOptionSetId: owningSetRangeId },
					structural: {
						// parentId referent = MEMBER stableId (M7); the orphan branch anchors to the root's
						// stableId, not the _id-form ROOT_ID.
						parentId: owningSet ? owningSet.stableId : metadata.sourceUrl,
						depth: 3,
						path: `${optionSetName}.${valueName}`,
					},
				});

				// HAS_VALUE: option set -> value (immediate containment)
				if (owningSet) {
					addEdge(EDGE_TYPES.HAS_VALUE, owningSet.stableId, built.stableId);
				}
			});

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			return finalizeStructuralContract({ nodes, edges });
		};

		// =====================================================================
		// embedNodes — batched embedding pass over nodes (1C embedTexts).
		//   Stamps embedding (number[]) + embeddingModelVersion on each node's properties.
		//   Bounded by EMBED_BATCH_SIZE; serial batches keep memory + rate in check.
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
						callback(`forge-ceds embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-ceds] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes.
		//   options: { sourcePath, owner, embedNodeLimit }. embedNodeLimit bounds the embedding
		//   pass for cost-managed iteration; the gate's full run leaves it unset.
		//   callback(err, { nodes, edges, metadata, embedCallCount }).
		// =====================================================================

		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseCeds({ sourcePath, xLog }, (err, parsed) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, parsed });
				});
			});

			// PURE deterministic shaping (throws on R3/R4 violations -> surfaced as forge error).
			taskList.push((args, next) => {
				let graph;
				let buildError = '';
				try {
					graph = buildContractGraph(args.parsed);
				} catch (err) {
					buildError = err.message;
				}
				if (buildError) {
					next(`forge-ceds buildContractGraph: ${buildError}`);
					return;
				}
				next('', { ...args, graph });
			});

			// embedding pass (skippable for the determinism comparison).
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
					embedCallCount: args.embedCallCount,
					standardKey: STANDARD_KEY,
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
				});
			});
		};

		return {
			forge,
			buildContractGraph, // exported for the determinism test (pure layer)
			STANDARD_KEY,
			STABLE_URI_PROPERTY_NAME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
