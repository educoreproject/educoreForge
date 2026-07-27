'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeOpenbadges.js — the OpenBadges forge bundle. Parses the 1EdTech Open Badges 3.0 OpenAPI 3.0
// JSON schema (JSON-LD aligned to the W3C Verifiable Credentials data model) and emits the UNIVERSAL
// FORGE PROPERTY CONTRACT (DESIGN §A/§B/§C/§D/§E/§F, DECISIONS §6-§12, §23-R3/R4) — the IDENTICAL
// shape forge-lif / forge-case / forge-ceds emit, so OpenBadges lands interoperably.
//
// HARVESTED+ADAPTED from trackA forge-openbadges (parser logic reused; node-shaping rewritten):
//   * trackA emitted private OpenBadges* nodes (OpenBadgesRoot/OpenBadgesClass/OpenBadgesProperty/
//     OpenBadgesOptionSet/OpenBadgesOptionValue) with HAS_CLASS/HAS_PROPERTY/_parentEdge plumbing and
//     a hand-rolled `|`-joined searchText, and carried a sibling bridges/ folder of cross-standard
//     crosswalk JSON (openbadges-to-ceds, openbadges-to-clr).
//   * THIS module emits the canonical Dme* roles with DmeStandardRoot on top, builds searchText via
//     the ONE shared 1C builder (R4: empty -> ValidationError), captures any harvested
//     `cedsGlobalIds` into a crossRefs JSON property AND normalizes them to canonical CEDS `cedsId`
//     (R3) with origin recorded in `cedsOriginalAnchorPropertyName`. Edges use the canonical
//     ownership names (HAS_CLASS/HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE) + REFERENCES (carrying
//     OpenBadges' anyOf/oneOf/allOf polymorphism tag), all stamped provenanceTier 'structural'.
//   * STANDARD-PURE: OpenBadges shares the VC data model with CLR; this forge emits NO cross-standard
//     edges. trackA's bridges/ crosswalks are NOT carried — cross-standard mapping is the downstream
//     forgeManager bridge's job (-derived/-implied/-specified), not the per-standard forge's.
//
// OpenBadges identity is STRUCTURAL (DESIGN §D case 3): stableUriPropertyName = 'openbadgesPath', a
// clean dotted locator the forge mints (root / class / class.property / class.property.optionSet /
// class.property.option.value). The stableId IS that openbadgesPath value.
//
// OpenBadges-distinctive shape (native scalars kept queryable): 1EdTech persistent ids
// (`persistentId` from x-class-pid on classes, x-srcprop-pid on properties — an external anchor
// stashed as a property, NOT a cross-standard edge), and polymorphic $ref edges (the VCDM 1.1-vs-2.0
// oneOf branch on credential @context).
//
// PURITY (DESIGN "forge is PURE/deterministic for (source, module)"): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source — same source -> identical nodes/edges
// (modulo embeddings, added in a separate embedNodes pass). forge() runs parse -> buildContractGraph
// -> embedNodes.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { parseOpenbadges } = require('./lib/parser');
const normalize = require('./lib/normalize');

const CORE_LIB = path.join(__dirname, '..', '..', 'lib'); // PORTED: recreation substrate (was npm/qtools-graph-forge-core)
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

const STANDARD_KEY = 'openbadges';
const STANDARD_SOURCE = 'OpenBadges'; // === the registry standardName, EXACT (no toLower anywhere)
const STANDARD_DISPLAY = 'Open Badges 3.0';
const STABLE_URI_PROPERTY_NAME = 'openbadgesPath';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.

// The mappingInstruction fields are DECLARED on the DmeStandardRoot (DECISIONS §12). OpenBadges
// bridges TO the CEDS hub (impliedTargets ['CEDS']); its native CEDS anchor origin would be the CEDS
// element id harvested from a property's description prose into cedsGlobalIds, normalized to canonical
// cedsId. (THIS source carries 0 such anchors — the declaration + harvest path remain in place.)
const openbadgesMappingInstruction = {
	cedsOriginalAnchorPropertyName: ['cedsGlobalIds'],
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
		// openbadgesPath — mint the clean dotted structural stableId from ordered raw segments.
		//   Throws on a miss (R3-style: a node MUST have a clean stableId, never silent junk).
		const openbadgesPathFor = (segments) => {
			const result = normalize.buildOpenbadgesPath(segments);
			if (result.error) {
				throw new Error(`forge-openbadges openbadgesPath miss: ${result.error}`);
			}
			return result.openbadgesPath;
		};

		// -----
		// _id from natural keys (DESIGN §B "deterministic from natural keys"):
		//   <standardKey>:<openbadgesPath-minus-prefix>. The root uses a fixed natural key.
		const idFor = (openbadgesPath) =>
			`${STANDARD_KEY}:${openbadgesPath.replace(/^openbadges:/, '')}`;
		const ROOT_OPENBADGES_PATH = `${normalize.OPENBADGES_PATH_PREFIX}:root`;
		const ROOT_ID = `${STANDARD_KEY}:root`;

		// stableId minters (mirror the parser's structural shapes so Ref/ownership endpoints resolve).
		const classPath = (displayName) => openbadgesPathFor([displayName]);
		const propPath = (className, propertyName) => openbadgesPathFor([className, propertyName]);
		const optionSetPath = (className, propertyName) =>
			openbadgesPathFor([className, propertyName, 'optionSet']);
		const optionValuePath = (className, propertyName, value) =>
			openbadgesPathFor([className, propertyName, 'option', value]);

		// -----
		// crossRefsForOpenbadges — turn a property's harvested CEDS element ids into the DESIGN §E
		//   crossRefs shape {system,id,raw,locator}. `id` is the canonical cedsId (R3 normalization).
		//   A normalization MISS throws (never silent) — surfaced as a forge error.
		const crossRefsForOpenbadges = ({ cedsGlobalIds }) =>
			(cedsGlobalIds || []).map((rawId) => {
				const normalized = normalize.normalizeCedsId({ rawValue: rawId, kind: 'element' });
				if (normalized.error) {
					throw new Error(
						`forge-openbadges R3 normalization miss: ${normalized.error} (cedsGlobalId='${rawId}')`,
					);
				}
				return {
					system: 'ceds',
					id: normalized.cedsId,
					raw: `${rawId}`,
					locator: 'description (ceds.ed.gov/element)',
				};
			});

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges }.
		//   Each node carries the universal contract MINUS embedding (added later). An openbadgesPath
		//   miss, an R3 cedsId normalization miss, or an empty searchText (R4) throws -> forge error.
		// =====================================================================

		const buildContractGraph = ({ entities, metadata }) => {
			const { classes, properties, optionSets, optionValues, references } = entities;

			const nodes = [];
			const edges = [];

			// stamp the universal contract onto one node, building searchText via 1C (R4).
			//   stableId IS the openbadgesPath (OpenBadges stableUriPropertyName). crossRefs / cedsId
			//   carried when the element supplies CEDS anchors.
			const makeNode = ({
				role,
				perStandardLabel,
				stableId,
				name,
				description,
				searchTextElement,
				extraProps,
				structural,
				cedsGlobalIds,
			}) => {
				if (!normalize.isCleanStableId(stableId)) {
					throw new Error(
						`forge-openbadges: ${role} '${name}' has no clean stableId (openbadgesPath) — got '${stableId}'`,
					);
				}

				// searchText via the ONE shared builder — empty throws ValidationError (R4).
				const searchText = buildSearchText({ role, ...searchTextElement });

				const nodeProperties = {
					_id: idFor(stableId),
					_source: STANDARD_SOURCE,
					name,
					description: description || '',
					role,
					openbadgesPath: stableId, // the stable identifier, under stableUriPropertyName
					searchText,
				};

				// crossRefs + canonical cedsId (R3) — only when the element harvested CEDS anchors.
				const crossRefs = crossRefsForOpenbadges({ cedsGlobalIds });
				if (crossRefs.length > 0) {
					nodeProperties.crossRefs = JSON.stringify(crossRefs);
					// canonical cedsId (R3): first harvested CEDS element id, canonicalized. Native
					// origin recorded in cedsOriginalAnchorPropertyName (the harvest field name).
					nodeProperties.cedsId = crossRefs[0].id;
					nodeProperties.cedsGlobalIds = cedsGlobalIds.slice();
					nodeProperties.cedsOriginalAnchorPropertyName = ['cedsGlobalIds'];
				}

				Object.keys(extraProps || {}).forEach((oneKey) => {
					nodeProperties[oneKey] = extraProps[oneKey];
				});

				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: nodeProperties,
				};
				if (structural) {
					node.properties.parentId = structural.parentId;
					node.properties.depth = structural.depth;
					node.properties.path = structural.path;
				}
				nodes.push(node);
				return { node, stableId };
			};

			// edge — canonical ownership/reference edge, stamped structural (DECISIONS §11).
			const addEdge = (type, fromStableId, toStableId, extraEdgeProps) => {
				edges.push({
					type,
					fromRef: { source: STANDARD_SOURCE, id: fromStableId },
					toRef: { source: STANDARD_SOURCE, id: toStableId },
					properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL, ...(extraEdgeProps || {}) },
				});
			};

			// ---- DmeStandardRoot (per-standard top; provenance block + stableUriPropertyName +
			//      mappingInstruction with the CEDS anchor fields populated, DECISIONS §6/§7/§12) ----
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: STANDARD_SOURCE,
				standardName: metadata.schemaTitle || STANDARD_DISPLAY,
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'OpenBadgesRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_OPENBADGES_PATH,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${metadata.schemaTitle || STANDARD_DISPLAY} OpenAPI ${metadata.openapiVersion} schema, version ${metadata.version}`,
					role: DME_ROLES.STANDARD_ROOT,
					openbadgesPath: ROOT_OPENBADGES_PATH,
					searchText: rootSearchText,
					// provenance block (DESIGN §B "Required on the DmeStandardRoot")
					standardKey: STANDARD_KEY,
					standardName: metadata.schemaTitle || STANDARD_DISPLAY,
					version: metadata.version,
					// version-provenance stamp (spec §3.3, Phase A): always present post-stamping —
					// versionSource 'spec' | 'provenance-file' | 'unknown' per the precedence rule.
					snapshotKey: metadata.snapshotKey,
					publishedVersion: metadata.publishedVersion,
					versionSource: metadata.versionSource,
					sourceFormat: metadata.sourceFormat,
					sourceFiles: metadata.sourceFiles,
					sourceUrl: metadata.sourceUrl,
					publisher: metadata.publisher || 'IMS Global / 1EdTech',
					parserVersion: '1',
					// ingestedAt is intentionally NOT stamped (H5): a wall-clock inside hashed node props
					// broke same-source -> same-blockId determinism. The run timestamp lives in the store
					// row (blocks.createdAt), never in content-addressed block text.
					coreVersion: '2.0.0',
					// OpenBadges-distinctive native provenance (model-level persistent id)
					modelPid: metadata.modelPid || '',
					license: metadata.license || '',
					status: metadata.status || '',
					// stableUriPropertyName + mappingInstruction (DECISIONS §6/§12)
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(openbadgesMappingInstruction),
				},
			});

			// ---- DmeClass nodes (OpenBadges classes — real + stub) ----
			classes.forEach((cls) => {
				const stableId = classPath(cls.displayName);
				makeNode({
					role: DME_ROLES.CLASS,
					perStandardLabel: 'OpenBadgesClass',
					stableId,
					name: cls.displayName,
					description: cls.description,
					searchTextElement: {
						name: cls.displayName,
						standardName: STANDARD_SOURCE,
						owningName: STANDARD_SOURCE,
					},
					extraProps: {
						schemaName: cls.schemaName,
						isStub: !!cls.isStub,
						additionalProperties: !!cls.additionalProperties,
						requiredFields: cls.requiredFields || [],
						propertyCount: cls.propertyCount || 0,
						persistentId: cls.persistentId || '',
					},
					structural: { parentId: ROOT_ID, depth: 1, path: cls.displayName },
				});
				// HAS_CLASS: root -> class (canonical ownership)
				addEdge(EDGE_TYPES.HAS_CLASS, ROOT_OPENBADGES_PATH, stableId);
			});

			// ---- DmeProperty nodes (carry owning class name in searchText) ----
			properties.forEach((prop) => {
				const stableId = propPath(prop.className, prop.name);
				const parentStableId = classPath(prop.className);

				makeNode({
					role: DME_ROLES.PROPERTY,
					perStandardLabel: 'OpenBadgesProperty',
					stableId,
					name: prop.name,
					description: prop.description,
					searchTextElement: {
						name: prop.name,
						owningClassName: prop.className,
						owningName: prop.className,
					},
					extraProps: {
						className: prop.className,
						classSchemaName: prop.classSchemaName,
						dataType: prop.dataType || '',
						format: prop.format || '',
						pattern: prop.pattern || '',
						required: !!prop.required,
						refCount: prop.refCount || 0,
						isPolymorphic: !!prop.isPolymorphic,
						referencedSchemas: prop.referencedSchemas || [],
						persistentId: prop.persistentId || '',
					},
					structural: {
						parentId: idFor(parentStableId),
						depth: 2,
						path: `${prop.className}.${prop.name}`,
					},
					cedsGlobalIds: prop.cedsGlobalIds,
				});

				// HAS_PROPERTY: owning class -> property (immediate containment)
				addEdge(EDGE_TYPES.HAS_PROPERTY, parentStableId, stableId);
			});

			// ---- REFERENCES edges (property -> target class; OpenBadges polymorphism preserved) ----
			references.forEach((ref) => {
				const fromStableId = propPath(ref.className, ref.propertyName);
				const toStableId = classPath(ref.targetDisplayName);
				addEdge(EDGE_TYPES.REFERENCES, fromStableId, toStableId, { polymorphism: ref.polymorphism });
			});

			// ---- DmeOptionSet nodes (enum containers) ----
			optionSets.forEach((os) => {
				const stableId = optionSetPath(os.className, os.propertyName);
				const propertyStableId = propPath(os.className, os.propertyName);
				const setName = `${os.className}.${os.propertyName}`;
				makeNode({
					role: DME_ROLES.OPTION_SET,
					perStandardLabel: 'OpenBadgesOptionSet',
					stableId,
					name: setName,
					description: os.description,
					searchTextElement: {
						name: setName,
						owningName: os.className,
						owningClassName: os.className,
					},
					extraProps: { valueCount: os.valueCount || 0, propertyName: os.propertyName },
					structural: {
						parentId: idFor(propertyStableId),
						depth: 3,
						path: `${setName}.optionSet`,
					},
				});
				// HAS_OPTION_SET: property -> option set
				addEdge(EDGE_TYPES.HAS_OPTION_SET, propertyStableId, stableId);
			});

			// ---- DmeOptionValue nodes (each carries its set + owner in searchText) ----
			optionValues.forEach((ov) => {
				const stableId = optionValuePath(ov.className, ov.propertyName, ov.value);
				const owningSetStableId = optionSetPath(ov.className, ov.propertyName);
				const optionSetName = `${ov.className}.${ov.propertyName}`;
				makeNode({
					role: DME_ROLES.OPTION_VALUE,
					perStandardLabel: 'OpenBadgesOptionValue',
					stableId,
					name: ov.value,
					description: '',
					searchTextElement: {
						name: ov.value,
						optionSetName,
						owningName: optionSetName,
						owningClassName: ov.className,
					},
					extraProps: { propertyName: ov.propertyName },
					structural: {
						parentId: idFor(owningSetStableId),
						depth: 4,
						path: `${optionSetName}.${ov.value}`,
					},
				});
				// HAS_VALUE: option set -> value
				addEdge(EDGE_TYPES.HAS_VALUE, owningSetStableId, stableId);
			});

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			return finalizeStructuralContract({ nodes, edges });
		};

		// =====================================================================
		// embedNodes — batched embedding pass over nodes (1C embedTexts). IDENTICAL to forge-case/lif.
		//   Stamps embedding (number[]) + embeddingModelVersion on each node's properties.
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
						callback(`forge-openbadges embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-openbadges] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. IDENTICAL shape to forge-case.
		//   callback(err, { nodes, edges, metadata, embedCallCount, standardKey, stableUriPropertyName }).
		// =====================================================================

		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseOpenbadges({ sourcePath, xLog }, (err, parsed) => {
					if (err) {
						next(`forge-openbadges parse: ${err}`);
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
					next(`forge-openbadges buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-openbadges] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`,
				);
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
			STANDARD_SOURCE,
			STABLE_URI_PROPERTY_NAME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
