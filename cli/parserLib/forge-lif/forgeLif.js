'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeLif.js — the LIF forge bundle. Parses the LIF (Learner Information Framework) OpenAPI 3.0
// schema and emits the UNIVERSAL FORGE PROPERTY CONTRACT (DESIGN §A/§B/§C/§D/§E/§F, DECISIONS
// §6-§12, §23-R3/R4) — the IDENTICAL shape forge-ceds emits.
//
// HARVESTED+ADAPTED from trackA forge-lif (parser logic reused; node-shaping rewritten):
//   * trackA emitted private Lif* nodes (LifEntity/LifComposite/LifProperty/LifOptionSet/
//     LifOptionValue) with HAS_ENTITY/_parentEdge plumbing and a hand-rolled `|`-joined searchText.
//   * THIS module emits the six canonical Dme* roles with DmeStandardRoot on top, builds searchText
//     via the ONE shared 1C builder (R4: empty -> ValidationError), captures LIF's harvested
//     `cedsGlobalIds` into a crossRefs JSON property AND normalizes them to canonical CEDS `cedsId`
//     (R3) with origin recorded in `cedsOriginalAnchorPropertyName` — this is the LIF→CEDS bridge
//     fuel the specifiedBridgeMaker consumes at Phase-7 acceptance. Edges use the canonical
//     ownership names (HAS_CLASS/HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE) + REFERENCES, all stamped
//     provenanceTier 'structural'.
//
// LIF identity is STRUCTURAL (DESIGN §D case 3): stableUriPropertyName = 'lifPath', a clean dotted
// locator the forge mints (root / entity / entity.path / set / set.value). The stableId IS that
// lifPath value.
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

const { parseLif } = require('./lib/parser');
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

const STANDARD_KEY = 'lif';
const STANDARD_SOURCE = 'LIF';
const STABLE_URI_PROPERTY_NAME = 'lifPath';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.

// The mappingInstruction fields are DECLARED present-but-unpopulated for LIF (DECISIONS §12) EXCEPT
// the CEDS-crossRef anchor fields, which LIF DOES populate: LIF's native CEDS reference is the CEDS
// element id harvested into cedsGlobalIds, normalized to canonical cedsId. That anchor is what makes
// LIF's specified bridge to CEDS resolve at Phase-7 acceptance.
const lifMappingInstruction = {
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
		// lifPath — mint the clean dotted structural stableId from ordered raw segments.
		//   Throws on a miss (R3-style: a node MUST have a clean stableId, never silent junk).
		const lifPathFor = (segments) => {
			const result = normalize.buildLifPath(segments);
			if (result.error) {
				throw new Error(`forge-lif lifPath miss: ${result.error}`);
			}
			return result.lifPath;
		};

		// -----
		// _id from natural keys (DESIGN §B "deterministic from natural keys"):
		//   <standardKey>:<lifPath-minus-prefix>. The root uses a fixed natural key.
		const idFor = (lifPath) => `${STANDARD_KEY}:${lifPath.replace(/^lif:/, '')}`;
		const ROOT_LIF_PATH = `${normalize.LIF_PATH_PREFIX}:root`;
		const ROOT_ID = `${STANDARD_KEY}:root`;

		// -----
		// crossRefsForLif — turn a property's harvested CEDS element ids into the DESIGN §E crossRefs
		//   shape {system,id,raw,locator}. `id` is the canonical cedsId (R3 normalization). A
		//   normalization MISS throws (never silent) — surfaced as a forge error.
		const crossRefsForLif = ({ cedsGlobalIds }) =>
			(cedsGlobalIds || []).map((rawId) => {
				const normalized = normalize.normalizeCedsId({ rawValue: rawId, kind: 'element' });
				if (normalized.error) {
					throw new Error(
						`forge-lif R3 normalization miss: ${normalized.error} (cedsGlobalId='${rawId}')`,
					);
				}
				return {
					system: 'ceds',
					id: normalized.cedsId,
					raw: `${rawId}`,
					locator: 'description|use_recommendations (ceds.ed.gov/element)',
				};
			});

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges }.
		//   Each node carries the universal contract MINUS embedding (added later). A lifPath miss,
		//   an R3 cedsId normalization miss, or an empty searchText (R4) throws -> forge error.
		// =====================================================================

		const buildContractGraph = ({ entities, maps, metadata }) => {
			const {
				entities: lifEntities,
				composites,
				properties,
				optionSets,
				optionValues,
			} = entities;

			const nodes = [];
			const edges = [];

			// stamp the universal contract onto one node, building searchText via 1C (R4).
			//   stableId IS the lifPath (LIF stableUriPropertyName). crossRefs / cedsId carried when
			//   the element supplies CEDS anchors.
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
						`forge-lif: ${role} '${name}' has no clean stableId (lifPath) — got '${stableId}'`,
					);
				}

				// searchText via the ONE shared builder — empty throws ValidationError (R4).
				const searchText = buildSearchText({ role, ...searchTextElement });

				const properties = {
					_id: idFor(stableId),
					_source: STANDARD_SOURCE,
					name,
					description: description || '',
					role,
					lifPath: stableId, // the stable identifier, under stableUriPropertyName
					searchText,
				};

				// crossRefs + canonical cedsId (R3) — only when the element harvested CEDS anchors.
				const crossRefs = crossRefsForLif({ cedsGlobalIds });
				if (crossRefs.length > 0) {
					properties.crossRefs = JSON.stringify(crossRefs);
					// canonical cedsId (R3): first harvested CEDS element id, canonicalized. Native
					// origin recorded in cedsOriginalAnchorPropertyName (the harvest field name).
					properties.cedsId = crossRefs[0].id;
					properties.cedsGlobalIds = cedsGlobalIds.slice();
					properties.cedsOriginalAnchorPropertyName = ['cedsGlobalIds'];
				}

				Object.keys(extraProps || {}).forEach((oneKey) => {
					properties[oneKey] = extraProps[oneKey];
				});

				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties,
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
			const addEdge = (type, fromStableId, toStableId) => {
				edges.push({
					type,
					fromRef: { source: STANDARD_SOURCE, id: fromStableId },
					toRef: { source: STANDARD_SOURCE, id: toStableId },
					properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
				});
			};

			// stableId minters (mirror the parser's path shapes so Ref/ownership endpoints resolve).
			const entityPath = (entityName) => lifPathFor([entityName]);
			const propPath = (entityName, fullPath) =>
				lifPathFor([entityName, ...`${fullPath}`.split('.')]);
			const compositePath = (entityName, fullPath) =>
				lifPathFor([entityName, ...`${fullPath}`.split('.')]);
			const optionSetPath = (entityName, fullPath) =>
				lifPathFor([entityName, ...`${fullPath}`.split('.'), 'optionSet']);
			const optionValuePath = (entityName, fullPath, value) =>
				lifPathFor([entityName, ...`${fullPath}`.split('.'), 'option', value]);

			// resolve a Ref target's stableId from its parser resolution (entity OR composite OR stub).
			const refTargetStableId = (refResolution) => {
				if (!refResolution) {
					return null;
				}
				if (refResolution.kind === 'entity' || refResolution.kind === 'stub') {
					return entityPath(refResolution.entityName);
				}
				// composite
				return compositePath(refResolution.entityName, refResolution.fullPath);
			};

			// ---- DmeStandardRoot (per-standard top; provenance block + stableUriPropertyName +
			//      mappingInstruction with the CEDS anchor fields populated, DECISIONS §6/§7/§12) ----
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: 'LIF',
				standardName: metadata.schemaTitle || 'Learner Information Framework',
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'LifRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_LIF_PATH,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_ID,
					_source: STANDARD_SOURCE,
					name: 'LIF',
					description: `${metadata.schemaTitle || 'Learner Information Framework'} OpenAPI ${metadata.openapiVersion} schema, version ${metadata.version}`,
					role: DME_ROLES.STANDARD_ROOT,
					lifPath: ROOT_LIF_PATH,
					searchText: rootSearchText,
					// provenance block (DESIGN §B "Required on the DmeStandardRoot")
					standardKey: STANDARD_KEY,
					standardName: metadata.schemaTitle || 'Learner Information Framework',
					version: metadata.version,
					// versionSource passthrough (2026-07-04): stamped ONLY when the parser traced the
					// version to the spec content; absent otherwise (finisher 'declared' covers honestly).
					...(metadata.versionSource ? { versionSource: metadata.versionSource } : {}),
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
					mappingInstruction: JSON.stringify(lifMappingInstruction),
				},
			});

			// ---- DmeClass nodes (LIF entities — real + stub) ----
			lifEntities.forEach((ent) => {
				const stableId = entityPath(ent.name);
				makeNode({
					role: DME_ROLES.CLASS,
					perStandardLabel: 'LifEntity',
					stableId,
					name: ent.name,
					description: ent.description,
					searchTextElement: {
						name: ent.name,
						standardName: 'LIF',
						owningName: 'LIF',
					},
					extraProps: {
						isStub: !!ent.isStub,
						requiredFields: ent.requiredFields || [],
						propertyCount: ent.propertyCount || 0,
					},
					structural: { parentId: ROOT_ID, depth: 1, path: ent.name },
				});
				// HAS_CLASS: root -> class (canonical ownership)
				addEdge(EDGE_TYPES.HAS_CLASS, ROOT_LIF_PATH, stableId);
			});

			// ---- DmeClass nodes for composites (array-of-object containers are structural classes) ----
			composites.forEach((comp) => {
				const stableId = compositePath(comp.entityName, comp.fullPath);
				// parent is the owning entity (top-level composite) or owning composite (nested)
				const parentStableId = comp.parentPath
					? compositePath(comp.entityName, comp.parentPath)
					: entityPath(comp.entityName);
				makeNode({
					role: DME_ROLES.CLASS,
					perStandardLabel: 'LifComposite',
					stableId,
					name: comp.name,
					description: comp.description,
					searchTextElement: {
						name: comp.name,
						standardName: 'LIF',
						owningName: comp.entityName,
					},
					extraProps: {
						requiredFields: comp.requiredFields || [],
						subPropertyCount: comp.subPropertyCount || 0,
						isComposite: true,
					},
					structural: {
						parentId: idFor(parentStableId),
						depth: 1 + (comp.pathDepth || 0) + 1,
						path: `${comp.entityName}.${comp.fullPath}`,
					},
				});
				// HAS_CLASS: owning entity/composite -> composite class (immediate containment)
				addEdge(EDGE_TYPES.HAS_CLASS, parentStableId, stableId);
			});

			// ---- DmeProperty nodes (carry owning entity/composite name in searchText) ----
			properties.forEach((prop) => {
				const stableId = propPath(prop.entityName, prop.fullPath);
				// owning parent: composite if nested under one, else the entity
				const owningName = prop.parentPath || prop.entityName;
				const parentStableId = prop.parentPath
					? compositePath(prop.entityName, prop.parentPath)
					: entityPath(prop.entityName);

				const extraProps = {
					dataType: prop.dataType || '',
					format: prop.format || '',
					required: !!prop.required,
					isRef: !!prop.isRef,
					refTargetName: prop.refTargetName || '',
					useRecommendations: prop.useRecommendations || '',
				};

				makeNode({
					role: DME_ROLES.PROPERTY,
					perStandardLabel: 'LifProperty',
					stableId,
					name: prop.name,
					description: prop.description,
					searchTextElement: {
						name: prop.name,
						owningClassName: owningName,
						owningName,
					},
					extraProps,
					structural: {
						parentId: idFor(parentStableId),
						depth: 2 + (prop.pathDepth || 0),
						path: `${prop.entityName}.${prop.fullPath}`,
					},
					cedsGlobalIds: prop.cedsGlobalIds,
				});

				// HAS_PROPERTY: owning entity/composite -> property (immediate containment)
				addEdge(EDGE_TYPES.HAS_PROPERTY, parentStableId, stableId);

				// REFERENCES: a Ref property points at its target entity/composite (DESIGN §F)
				if (prop.isRef) {
					const targetStableId = refTargetStableId(prop.refResolution);
					if (targetStableId) {
						addEdge(EDGE_TYPES.REFERENCES, stableId, targetStableId);
					}
				}
			});

			// ---- DmeOptionSet nodes (enum containers) ----
			optionSets.forEach((os) => {
				const stableId = optionSetPath(os.entityName, os.propertyPath);
				const propertyStableId = propPath(os.entityName, os.propertyPath);
				const setName = `${os.entityName}.${os.propertyPath}`;
				makeNode({
					role: DME_ROLES.OPTION_SET,
					perStandardLabel: 'LifOptionSet',
					stableId,
					name: setName,
					description: os.description,
					searchTextElement: {
						name: setName,
						owningName: os.entityName,
						owningClassName: os.entityName,
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
				const stableId = optionValuePath(ov.entityName, ov.propertyPath, ov.value);
				const owningSetStableId = optionSetPath(ov.entityName, ov.propertyPath);
				const optionSetName = `${ov.entityName}.${ov.propertyPath}`;
				makeNode({
					role: DME_ROLES.OPTION_VALUE,
					perStandardLabel: 'LifOptionValue',
					stableId,
					name: ov.value,
					description: '',
					searchTextElement: {
						name: ov.value,
						optionSetName,
						owningName: optionSetName,
						owningClassName: ov.entityName,
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
		// embedNodes — batched embedding pass over nodes (1C embedTexts). IDENTICAL to forge-ceds.
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
						callback(`forge-lif embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-lif] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. IDENTICAL shape to forge-ceds.
		//   callback(err, { nodes, edges, metadata, embedCallCount, standardKey, stableUriPropertyName }).
		// =====================================================================

		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseLif({ sourcePath, xLog }, (err, parsed) => {
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
					next(`forge-lif buildContractGraph: ${buildError}`);
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
			STANDARD_SOURCE,
			STABLE_URI_PROPERTY_NAME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
