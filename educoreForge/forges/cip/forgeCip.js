'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCip.js — the CIP forge bundle. Parses the NCES CIP 2020 taxonomy CSV and emits the UNIVERSAL
// FORGE PROPERTY CONTRACT (the SAME contract forge-edfi/forge-sif/forge-ceds emit), so CIP lands in
// the validation graph interoperably. CSV family; mirrors forge-edfi/forgeEdfi.js structure exactly.
// HISTORICAL CITATION: the forgeEdfi.js this mirrors is the PRE-CAMPAIGN CSV-crosswalk forge,
// removed from HEAD at the forge-edfi round-trip closeout 2026-08-04 (git history holds it). The
// filename is now a MetaEd reimplementation; the UNIVERSAL CONTRACT cited above is unchanged.
//
// HARVESTED+ADAPTED from the OLD forge-cip (lib/parser.js navigation reused; node-shaping rewritten):
//   * the OLD tool emitted private CipDomain/CipSubdomain/CipProgram nodes with hand-rolled native
//     hierarchy edges (HAS_DOMAIN/HAS_SUBDOMAIN/HAS_PROGRAM) + CROSS_REFERENCES, and an older node
//     contract carrying its own searchText.
//   * THIS module maps EVERY native taxonomy node to the canonical DmeClass role (CIP is a PURE
//     3-level taxonomy: 2-digit domain -> 4-digit subdomain -> 6-digit program; the codes ARE
//     taxonomy classes, NOT option values). It builds searchText via the ONE shared 1C builder
//     (structural context only), assigns deterministic synthetic stableIds (cip:<kind>/<cipCode>),
//     and writes the canonical edges: the root owns each domain via HAS_CLASS; the class hierarchy is
//     SUBCLASS_OF FROM the child TO the parent (subdomain->domain, program->subdomain — the canonical
//     class-hierarchy edge, taken from the native HAS_CHILD _parentEdge); intra-CIP cross-references
//     are REFERENCES. ALL edges are stamped provenanceTier 'structural'.
//
// ROLE MAPPING DECISION (documented per the campaign): CIP is a pure taxonomy with NO codesets, so it
// emits ONLY DmeStandardRoot (1) + DmeClass (every CIP code) — and NO DmeProperty / DmeOptionSet /
// DmeOptionValue / DmeSupport. The three levels are not distinguished by role (all DmeClass); the
// LEVEL is carried as the scalar `cipLevel` + reflected in depth/path, and the level relationship is
// the SUBCLASS_OF hierarchy edge. There is therefore no orphan-option-set anchoring pass (no option
// sets exist).
//
// PURITY (forge is PURE/deterministic for (source, module)): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source. forge() runs parse -> buildContractGraph
// -> embedNodes. An R3 normalization miss or empty searchText (R4) THROWS — surfaced as a forge error.
//
// BRIDGE PURITY: this is a STANDARD-PURE CIP block — _source='CIP', CIP's own nodes + intra-CIP
// structural edges ONLY. The CIP CSV carries NO CEDS columns (the old forge's separate
// cip-to-ceds.json bridge is NOT part of the CSV source and is out of scope here): NO cross-standard
// edge is emitted, nothing is stashed for bridging. The intra-CIP CrossReferences are SAME-standard
// (CIP->CIP) REFERENCES edges, not cross-standard.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseCip = require('./lib/parser');
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

const STANDARD_KEY = 'cip';
const STANDARD_SOURCE = 'CIP'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'Classification of Instructional Programs (CIP 2020)';
const STABLE_URI_PROPERTY_NAME = 'cipStableId';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.

// CIP carries no native CEDS crosswalk column (no CEDS columns in the CSV), so it is anchor-free:
// -specified legitimately emits 0. But anchor-free is NOT the same as no implied bridge — like CASE,
// CIP bridges to the CEDS hub entirely via the -implied pass. The mappingInstruction therefore
// DECLARES participation in the implied bridge (impliedTargets ['CEDS']); the empty anchor arrays
// reflect only the absence of a deterministic crosswalk, not opting out of bridging (DECISIONS §12).
const cipMappingInstruction = {
	cedsOriginalAnchorPropertyName: [],
	cedsOptionOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch. EVERY CIP taxonomy level is
// a DmeClass (pure taxonomy); the kind distinguishes depth/path/stableId token only.
const roleSpecByNativeLabel = {
	CipDomain: { role: DME_ROLES.CLASS, kind: 'domain', perStandardLabel: 'CipDomain' },
	CipSubdomain: { role: DME_ROLES.CLASS, kind: 'subdomain', perStandardLabel: 'CipSubdomain' },
	CipProgram: { role: DME_ROLES.CLASS, kind: 'program', perStandardLabel: 'CipProgram' },
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
// For CIP the natural key is the CIP code itself.
const naturalKeyByKind = {
	domain: (props) => props.cipCode,
	subdomain: (props) => props.cipCode,
	program: (props) => props.cipCode,
};

// native edge type -> canonical (all stamped 'structural'). The native HAS_CHILD parent edge
// (parent -> child in the source) is emitted by the main module as SUBCLASS_OF FROM child TO parent
// (the canonical class-hierarchy edge). A native CROSS_REFERENCES (CIP code -> CIP code) is a genuine
// class -> class reference and stays REFERENCES.
const edgeTypeTranslation = {
	HAS_CHILD: EDGE_TYPES.SUBCLASS_OF, // parent->child native; emitted as child->parent SUBCLASS_OF (see below)
	CROSS_REFERENCES: EDGE_TYPES.REFERENCES, // intra-CIP code cross-reference (same standard)
	REFERENCES: EDGE_TYPES.REFERENCES,
};

// kinds the root owns directly (the synthesized ownership edges). Only the top-level domains are
// owned by the root via HAS_CLASS; subdomains/programs reach the root transitively through the
// SUBCLASS_OF hierarchy, exactly as a class hierarchy should.
const ownershipEdgeForKind = {
	domain: EDGE_TYPES.HAS_CLASS,
};

// structural depth per kind (root=0; domain=1; subdomain=2; program=3 — the taxonomy depth).
const depthByKind = {
	domain: 1,
	subdomain: 2,
	program: 3,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'cip:root';

		// stableId for a native node; throws on an empty/unknown key (R3 — never a silent malformed id).
		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-cip R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-cip: ${kind} produced an unclean stableId '${result.stableId}'`,
				);
			}
			return result.stableId;
		};

		// the searchText element for a role, built from structural context only. CIP nodes are all
		// DmeClass; a class carries its standard + owning context + name. The owningName is the parent
		// class name (domain/subdomain) for sub-levels, the standard for top-level domains.
		const searchTextElementFor = ({ role, name, owningName }) => {
			if (role === DME_ROLES.CLASS) {
				return {
					role,
					name,
					standardName: STANDARD_SOURCE,
					owningName: owningName || STANDARD_SOURCE,
				};
			}
			// no other roles exist for CIP, but keep parity with the shared builder.
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			const stats = {
				domainsEmitted: 0,
				subdomainsEmitted: 0,
				programsEmitted: 0,
				subclassEdges: 0, // child -> parent SUBCLASS_OF edges
				referenceEdges: 0, // intra-CIP CROSS_REFERENCES -> REFERENCES edges
				rootAnchoredOrphans: 0, // non-domain classes whose ancestors were all pruned; root-anchored
				danglingEdges: [],
			};

			// PASS 1 — index every native node and resolve its stableId + role + name.
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'CipRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-cip: unknown native CIP label '${nativeNode.label}'`);
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
						_id: stableId, // CIP _id === stableId (both deterministic from the CIP code)
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
			const rootNative = nativeNodes.find((n) => n.label === 'CipRoot');
			const rootProps = (rootNative && rootNative.properties) || {};
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: STANDARD_SOURCE,
				standardName: STANDARD_DISPLAY,
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'CipRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${metadata.domainCount} domains, ${metadata.subdomainCount} subdomains, ${metadata.programCount} programs`,
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
					mappingInstruction: JSON.stringify(cipMappingInstruction),
				},
			});

			// ---- structural nodes (every CIP taxonomy code -> a DmeClass) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'CipRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning context + parent for searchText/path: the parent class (via _parentEdge), or
				// the root for top-level domains.
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// faithful native scalars (CIP carries no cross-standard data — nothing stashed).
				const extraProps = { scalar: {}, crossRefs: [] };
				if (props.cipCode) extraProps.scalar.cipCode = props.cipCode;
				if (props.cipFamily) extraProps.scalar.cipFamily = props.cipFamily;
				if (props.cipLevel) extraProps.scalar.cipLevel = props.cipLevel;
				if (props.examples) extraProps.scalar.examples = props.examples;

				// path: the CIP code itself is the canonical, human-meaningful hierarchical path.
				const pathLabel = props.cipCode || props.name;

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

				if (spec.kind === 'domain') stats.domainsEmitted++;
				if (spec.kind === 'subdomain') stats.subdomainsEmitted++;
				if (spec.kind === 'program') stats.programsEmitted++;

				// synthesized ownership edge from the root (HAS_CLASS for top-level domains). A
				// non-domain class whose entire ancestor chain was pruned (every ancestor was a
				// 'Moved to'/'Deleted' artifact) carries no _parentEdge; anchor it to the root via
				// HAS_CLASS so it is reachable (mirrors the orphan-anchor reachability intent). Such a
				// node also gets NO SUBCLASS_OF below (there is no surviving parent), so the root
				// HAS_CLASS is its only ownership edge — never double-owned.
				const ownershipType = ownershipEdgeForKind[spec.kind];
				if (ownershipType) {
					addEdge(ownershipType, ROOT_STABLE_ID, self.stableId, `root->${spec.kind}`);
				} else if (!nativeNode._parentEdge) {
					addEdge(EDGE_TYPES.HAS_CLASS, ROOT_STABLE_ID, self.stableId, `root->orphan-${spec.kind}`);
					stats.rootAnchoredOrphans++;
				}
			});

			// ---- translate native edges (the _parentEdge hierarchy + each node's CROSS_REFERENCES) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}
				// the native _parentEdge (HAS_CHILD parent->child) becomes SUBCLASS_OF child->parent:
				// the canonical class-hierarchy edge, FROM the child class TO its parent class.
				if (nativeNode._parentEdge) {
					const parent = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-cip: untranslated native parent edge type '${nativeNode._parentEdge.type}' (${nativeNode._parentEdge.fromId}->${nativeNode.id})`,
						);
					}
					addEdge(
						canonical,
						self.stableId, // FROM the child
						parent && parent.stableId, // TO the parent
						`${nativeNode._parentEdge.type}(child->parent):${nativeNode.id}->${nativeNode._parentEdge.fromId}`,
					);
					stats.subclassEdges++;
				}
				// the node's outgoing native edges (CROSS_REFERENCES -> REFERENCES, intra-CIP).
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (!canonical) {
						throw new Error(
							`forge-cip: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
					if (canonical === EDGE_TYPES.REFERENCES) {
						stats.referenceEdges++;
					}
				});
			});

			if (stats.danglingEdges.length > 0) {
				throw new Error(
					`forge-cip: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
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
						callback(`forge-cip embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-cip] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
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
				parseCip(sourcePath, {}, (err, parsed) => {
					if (err) {
						next(`forge-cip parse: ${err}`);
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
					next(`forge-cip buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-cip] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.domainsEmitted} domains, ${graph.stats.subdomainsEmitted} subdomains, ` +
						`${graph.stats.programsEmitted} programs, ${graph.stats.subclassEdges} SUBCLASS_OF, ` +
						`${graph.stats.referenceEdges} REFERENCES, ${graph.stats.rootAnchoredOrphans} root-anchored orphans)`,
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
