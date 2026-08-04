'use strict';

// authoredAnchorBridge — the GENERIC authored-anchor resolver ("item zero", P7 2026-07-30): the
// long-deferred "generic -specified bridge (a LATER phase)" that forges/edfi/forgeEdfi.js and
// forges/sedm/forgeSedm.js both name in their mappingInstruction comments. Any source standard whose
// forge STASHED canonical CEDS property anchors on its nodes (properties.cedsId = 'P######' and/or
// crossRefs entries { system: 'ceds', id: 'P######', locator }) gets those anchors RESOLVED here into
// mapping edges against the CEDS hub's HubReference set. Deterministic: no vectors, no LLM, no
// network — an identity join on the canonical P-form key, exactly the resolution the forges promised
// ("resolves <Standard>.cedsId == CedsProperty.cedsId").
//
// TWO ANCHOR SOURCES PER NODE, RECONCILED PER TQ'S RULING (2026-07-30):
//   * the AUTHORED CROSSWALK — the crossRefs JSON the forge harvested row-by-row from the curated
//     crosswalk source (EdFi: EdFiEntityElementsToCEDS.csv / EdFiEntityDescriptorsToCEDS.csv; SEDM:
//     the CEDS-Map CSV). This is the curated authority.
//   * the PER-NODE ANCHOR — the scalar properties.cedsId the forge stamped as its OWN single-anchor
//     summary (EdFi collapses a multi-id crosswalk row set to the FIRST canonicalizable id, so some
//     anchored fields carry fewer anchors in the scalar than the crosswalk asserts; SEDM's element
//     identity INCLUDES the Global ID, so its 230 anchors never diverge).
//     HISTORICAL CITATION: the counts here were once stated as '34 of 1,048 anchored fields / 43
//     crosswalk assignments with no scalar echo, forgeEdfi.js:359-361' — measured 2026-07-30 against
//     the PRE-CAMPAIGN CSV-crosswalk forge-edfi, which was removed from HEAD at the round-trip
//     closeout 2026-08-04. That line number points into git history, not into today's file. The
//     COLLAPSE BEHAVIOR the paragraph describes is unchanged and still measured; the live numbers
//     over the MetaEd forge (625 anchored nodes, 656 assignments, 31 with no scalar echo) are
//     asserted in test-authored-anchor-bridge.js section F, which is where numbers belong.
//   WHERE THEY AGREE (the same targetKey appears in both) -> ONE edge, DOUBLY ATTESTED: a single
//     EXACT_MATCH whose provenance records BOTH locators (anchorAttestation/anchorLocators below).
//   WHERE THEY DIVERGE -> BOTH edges, honestly tiered ("one exact and the other inferred" — TQ):
//     * every crosswalk assignment -> the authored EXACT_MATCH (spec-authoritative, confidence 1.0,
//       semapv:ManualMappingCuration), single- or double-attested as the scalar corroborates or not;
//     * a per-node anchor NOT corroborated by the crosswalk -> a distinct CLOSE_MATCH edge. The
//       provenance-tier vocabulary (lib/vocabulary/vocabulary.js PROVENANCE_TIERS) offers NO honest
//       lower tier for a spec-harvested-but-uncorroborated anchor (embedding-inferred would be a lie:
//       nothing was embedded), so the "honestly lower" standing is carried by the SKOS predicate
//       (closeMatch, never exactMatch) while provenanceTier stays spec-authoritative — the anchor IS
//       from the standard's own source. The vocabulary guard (relationshipWriter.js check 3) requires
//       every CLOSE_MATCH to carry decisionBlockHash + confidence; this bridge satisfies that
//       HONESTLY by freezing its divergent-anchor decisions into a deterministic, content-addressed
//       manifest saved to the decision store (pairKey '<HUB>::<SOURCE>::authoredAnchor' — its OWN key,
//       never colliding with an evidence bridge's '<HUB>::<SOURCE>' block) and stamping that hash.
//       Confidence is 1.0: the anchor assertion itself is deterministic — what is weaker is its
//       curation status, and that is what the predicate downgrade says.
//   AN UNRESOLVABLE ANCHOR (a cedsId matching no property-tier HubReference) is an ORPHAN — recorded
//     with its true reason in counts + result.unresolvedAnchors, NEVER a fabricated edge (the same
//     honest-abstention discipline as referenceIndex.js, which does the recording).
//
// MODE DISCIPLINE (genericBridge's rebridge/materialize dispatch, applied to a deterministic
// producer): this bridge spends nothing and judges nothing, so REBRIDGE and MATERIALIZE coincide —
// the identity join is recomputed from graph state on every run and is byte-identical every time
// (the same reasoning ctdlAuthoredBridge documents for its null decision block). The divergence
// manifest is saved idempotently on every run (decision-store saves are content-addressed no-ops on
// re-save), so the CLOSE_MATCH edges' decisionBlockHash is always dereferenceable regardless of
// mode. injectedTools.rebridge is deliberately not branched on; counts.mode says 'deterministic'.
//
// THE BRIDGE CONTRACT (interfaces.js @interface BridgeModule / BRIDGE_MODULE_SHAPE), unchanged:
//   bridgeModule({ ...injected library tools }) ({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, decisionBlock, producer, counts })
// GENERIC like genericBridge: config.sourceStandard names the source pair-by-pair (a generic plugin
// serves every pair; there is no default). Lives in the forges-shared scope (forges/bridges/) and
// resolves by name through bridgeMaker's three-directory search path.
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no
// async/await, no try/catch for control flow; refuse-by-value (polyArch2 §6); camelCase, compound
// names. All writes travel through the injected relationshipWriter (the guarded write seam) — this
// file never opens its own connection to the write substrate.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// content-address — 2 levels up from forges/bridges to the tree root (the exact depth genericBridge
// documents at its own require site). Used ONLY to content-address the divergence manifest.
const contentAddress = require(path.join(__dirname, '..', '..', 'lib', 'content-address', 'content-address'))();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// IDENTITY — this bridge's own choices.
// =====================================================================
const MAPPING_TOOL = 'authoredAnchorBridge';
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const PRODUCER = 'authored'; // vocabulary.js RELATIONSHIP_PRODUCER_SUFFIX: authored -> '_exact'

// AUTHORED_ANCHOR_GENERATION — the self-description stamp frozen into the divergence manifest (the
// same ⟪A6⟫ discipline the evidence bridges apply to their frozen blocks): a reader of the manifest
// never has to infer which pipeline produced it. A FIXED string, not a timestamp — the manifest is
// deterministic within one generation.
const AUTHORED_ANCHOR_GENERATION = 'authoredAnchorBridge-v1';

// CANONICAL_PROPERTY_ANCHOR_RE — the CEDS canonical P-form (property kind-prefix) this bridge joins
// on. The convention's source of truth is the CEDS forge's normalizer (forges/ceds/lib/normalize.js:
// rolePrefixByKind property -> 'P', CANONICAL_CEDS_ID_RE), restated here for the P-branch only
// because this generic bridge must not require a standard-local module. Anchors in other kind
// prefixes (OS/OV/C) are NOT property anchors and are deliberately ignored by this resolver (e.g.
// EdFi's raw descriptor-value cedsOptionCode carries no P-form and is out of scope).
const CANONICAL_PROPERTY_ANCHOR_RE = /^P\d{6,}$/;

// attestation vocabulary — the provenance stamps TQ's ruling asks for ("record both locators").
const ATTESTATION_AUTHORED = 'authoredCrossRef';
const ATTESTATION_NODE_ANCHOR = 'nodeAnchor';
const ATTESTATION_DUAL = `${ATTESTATION_AUTHORED}+${ATTESTATION_NODE_ANCHOR}`;
const NODE_ANCHOR_LOCATOR = 'cedsId'; // the scalar property the forges stamp the per-node anchor on

// v1 — PG-JSON single-element collapse guard (the SAME local helper referenceIndex.js and the other
// readers of possibly-list node properties define).
const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// =====================================================================
// harvestAuthoredAnchors — PURE. Walk the source nodes and split their stashed anchors into the two
// reconciliation channels. Exported for the unit test ONLY.
//
//   ({ sourceNodes }) -> {
//     authoredMappings          [{ fromStableId, targetKey }]  every distinct crosswalk assignment
//     divergentAnchorMappings   [{ fromStableId, targetKey }]  per-node anchors the crosswalk does
//                                                              NOT corroborate (incl. anchors on
//                                                              nodes with no crosswalk entry at all)
//     attestationByPair         { 'from|target': { anchorAttestation, anchorLocators } }
//     counts                    { nodesSeen, anchoredNodes, authoredAnchors, dualAttested,
//                                 authoredOnly, nodeAnchorDivergent }
//   }
//
// crossRefs is the forge-stamped JSON string ('[]' universal, structural-contract finalizer); it is
// parsed bare, the same way ctdlAnchorHarvest reads it — a malformed crossRefs is a forge defect
// upstream of this bridge, not caller input.
// =====================================================================
const harvestAuthoredAnchors = ({ sourceNodes } = {}) => {
	const authoredMappings = [];
	const divergentAnchorMappings = [];
	const attestationByPair = {};
	const counts = {
		nodesSeen: 0,
		anchoredNodes: 0,
		authoredAnchors: 0,
		dualAttested: 0,
		authoredOnly: 0,
		nodeAnchorDivergent: 0,
	};

	(sourceNodes || []).forEach((oneNode) => {
		counts.nodesSeen++;
		const props = oneNode.properties || {};

		// the authored crosswalk channel: distinct P-form ceds ids, with their source locators.
		const crossRefs = JSON.parse(v1(props.crossRefs) || '[]');
		const locatorsByAnchor = {};
		crossRefs
			.filter((oneRef) => oneRef && oneRef.system === 'ceds' && CANONICAL_PROPERTY_ANCHOR_RE.test(`${oneRef.id}`))
			.forEach((oneRef) => {
				const anchorId = `${oneRef.id}`;
				if (!locatorsByAnchor[anchorId]) {
					locatorsByAnchor[anchorId] = [];
				}
				const locator = oneRef.locator ? `${oneRef.locator}` : 'crossRefs';
				if (locatorsByAnchor[anchorId].indexOf(locator) === -1) {
					locatorsByAnchor[anchorId].push(locator);
				}
			});
		const authoredIds = Object.keys(locatorsByAnchor).sort();

		// the per-node anchor channel: the forge's own scalar summary anchor.
		const nodeAnchorRaw = v1(props.cedsId);
		const nodeAnchor = CANONICAL_PROPERTY_ANCHOR_RE.test(`${nodeAnchorRaw}`) ? `${nodeAnchorRaw}` : null;

		if (authoredIds.length === 0 && !nodeAnchor) {
			return; // no anchor of either kind — not this bridge's node
		}
		counts.anchoredNodes++;

		authoredIds.forEach((oneAnchorId) => {
			counts.authoredAnchors++;
			const isDual = oneAnchorId === nodeAnchor;
			if (isDual) {
				counts.dualAttested++;
			} else {
				counts.authoredOnly++;
			}
			authoredMappings.push({ fromStableId: oneNode.stableId, targetKey: oneAnchorId });
			attestationByPair[`${oneNode.stableId}|${oneAnchorId}`] = {
				anchorAttestation: isDual ? ATTESTATION_DUAL : ATTESTATION_AUTHORED,
				anchorLocators: isDual
					? `${locatorsByAnchor[oneAnchorId].join('+')}+${NODE_ANCHOR_LOCATOR}`
					: locatorsByAnchor[oneAnchorId].join('+'),
			};
		});

		if (nodeAnchor && authoredIds.indexOf(nodeAnchor) === -1) {
			counts.nodeAnchorDivergent++;
			divergentAnchorMappings.push({ fromStableId: oneNode.stableId, targetKey: nodeAnchor });
			attestationByPair[`${oneNode.stableId}|${nodeAnchor}`] = {
				anchorAttestation: ATTESTATION_NODE_ANCHOR,
				anchorLocators: NODE_ANCHOR_LOCATOR,
			};
		}
	});

	// deterministic order (the manifest and every diff of the harvest depend on it).
	const byPair = (a, b) => {
		const ka = `${a.fromStableId}|${a.targetKey}`;
		const kb = `${b.fromStableId}|${b.targetKey}`;
		return ka < kb ? -1 : ka > kb ? 1 : 0;
	};
	authoredMappings.sort(byPair);
	divergentAnchorMappings.sort(byPair);

	return { authoredMappings, divergentAnchorMappings, attestationByPair, counts };
};

// =====================================================================
// composeDivergenceManifest — PURE. The deterministic, content-addressed record of the divergent
// per-node-anchor decisions (the CLOSE_MATCH channel's frozen block). Exported for the unit test
// ONLY. Same decisions -> byte-identical text -> identical hash, which is what makes the stamped
// decisionBlockHash replayable across builds.
// =====================================================================
const composeDivergenceManifest = ({ pairStamp, divergentAnchorMappings } = {}) => {
	const frozenText = JSON.stringify(
		{
			blockType: 'authoredAnchorDivergence',
			generation: AUTHORED_ANCHOR_GENERATION,
			pairStamp,
			divergentDecisions: (divergentAnchorMappings || []).map(({ fromStableId, targetKey }) => ({
				fromStableId,
				targetKey,
			})),
		},
		null,
		1,
	);
	return { frozenText, decisionBlockHash: contentAddress.blockIdForText(frozenText) };
};

// START OF the produced BridgeModule callable ============================================

const moduleFunction =
	(injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		const { graphReader, referenceIndex, relationshipWriter, decisionStore } = injectedTools;

		// EVERY injected tool this producer composes is stated, or it does not run (polyArch2 §6).
		const missingTool = ['graphReader', 'referenceIndex', 'relationshipWriter'].find(
			(oneName) => typeof injectedTools[oneName] !== 'function',
		);
		if (missingTool) {
			callback(
				`${moduleName}: injected tool '${missingTool}' is not a function — the component library did not supply it.`,
			);
			return;
		}
		if (!inGraph) {
			callback(`${moduleName}: inGraph is not given — there is no graph to read the source/${HUB_STANDARD} nodes from.`);
			return;
		}
		if (hub !== null && hub !== undefined && `${hub}`.toUpperCase() !== HUB_STANDARD) {
			callback(`${moduleName}: hub is '${hub}', but this producer resolves authored anchors toward the ${HUB_STANDARD} hub only.`);
			return;
		}
		if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
			callback(
				`${moduleName}: applyLabel is ${
					applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
				} — it is the label harvest selects the written edges by; there is no default.`,
			);
			return;
		}

		// GENERIC-producer discipline (genericBridge's own): the recipe names the source standard.
		const config = injectedTools.config || {};
		const sourceStandard = config.sourceStandard || config.source;
		if (typeof sourceStandard !== 'string' || sourceStandard.trim() === '') {
			callback(
				`${moduleName}: config.sourceStandard is not set — the generic authored-anchor producer must be ` +
					`told which source standard it resolves (a generic plugin serves every pair); there is no default.`,
			);
			return;
		}
		// THE EXACT-NAME RULE (supersedes the old CASE RULE here, 2026-07-30): forged `_source` carries
		// the bundle's declared standardName VERBATIM — and it is NOT always the uppercased recipe token
		// (EdFi stamps 'EdFi'; 'edfi'.toUpperCase() === 'EDFI' matched NOTHING and this bridge silently
		// produced an empty block on its first live run). build.js resolves the declared name from
		// parserDescriptor.ini (the one canonical authority) and passes it as config.sourceStandardName;
		// this producer matches it EXACTLY — one canonical source, exact comparison, no normalization at
		// the comparison site, and no default: a missing name is refused, never guessed from the token.
		const sourceStandardKey = config.sourceStandardName;
		if (typeof sourceStandardKey !== 'string' || sourceStandardKey.trim() === '') {
			callback(
				`${moduleName}: config.sourceStandardName is not set — the EXACT declared standardName ` +
					`(parserDescriptor.ini) is required for _source matching; the recipe token's case is ` +
					`not trustworthy (EdFi != EDFI). There is no default.`,
			);
			return;
		}
		const subjectVersion = config.sourceVersion || '';
		const objectVersion = config.hubVersion || '';
		const pairKey = `${HUB_STANDARD}::${sourceStandardKey}::authoredAnchor`;
		const pairStamp = {
			subjectSource: sourceStandardKey,
			subjectVersion,
			objectSource: HUB_STANDARD,
			objectVersion,
		};

		const reader = graphReader({ inGraph });
		const taskList = new taskListPlus();

		// 1. WALK — the source standard's forged nodes (ALL roles: a property anchor may sit on a
		// DmeProperty, a DmeOptionSet, or any node the forge chose to anchor) and the hub's
		// HubReference set.
		taskList.push((args, next) => {
			reader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: sourceStandardKey } }, (err, out) => {
				if (err) {
					next(`${moduleName}: reading ${sourceStandardKey} source nodes: ${err}`);
					return;
				}
				const sourceNodes = (out || {}).nodes || [];
				// ZERO SOURCES IS A REFUSAL, not a success (added 2026-07-30 — the EdFi case-mismatch run
				// wrote an EMPTY relationship block and reported green). A recipe named this pair; a graph
				// containing not one node of the named source standard means the name is wrong or the
				// dependency graph is — either way this producer refuses BY NAME rather than materialize
				// silence as an empty block.
				if (sourceNodes.length === 0) {
					next(
						`${moduleName}: found ZERO nodes with _source '${sourceStandardKey}' in the dependency ` +
							`graph — the named source standard is absent (wrong sourceStandardName, or the recipe's ` +
							`dependencies do not include it). An empty source set is refused, never written as an ` +
							`empty relationship block.`,
					);
					return;
				}
				next('', { ...args, sourceNodes });
			});
		});
		taskList.push((args, next) => {
			reader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) => {
				next(err ? `${moduleName}: reading ${HUB_STANDARD} ${HUB_REFERENCE_LABEL} nodes: ${err}` : '', {
					...args,
					referenceNodes: (out || {}).nodes || [],
				});
			});
		});

		// 2/3. HARVEST the two anchor channels, then RESOLVE each through the pure referenceIndex.
		taskList.push((args, next) => {
			const harvest = harvestAuthoredAnchors({ sourceNodes: args.sourceNodes });

			// the authored EXACT_MATCH channel — the curated crosswalk assignments.
			const exactBuilder = referenceIndex({
				predicate: 'exactMatch',
				mappingJustification: 'semapv:ManualMappingCuration',
				subjectSource: sourceStandardKey,
				subjectVersion,
				objectSource: HUB_STANDARD,
				objectVersion,
				mappingTool: MAPPING_TOOL,
			});
			const exactSubgraph = exactBuilder.buildMappingSubgraph({
				authoredMappings: harvest.authoredMappings,
				sourceNodes: args.sourceNodes,
				referenceNodes: args.referenceNodes,
			});

			// the divergent per-node-anchor CLOSE_MATCH channel (see the file header for the tiering
			// rationale). Resolved through the SAME pure core, only the predicate differs.
			const closeBuilder = referenceIndex({
				predicate: 'closeMatch',
				mappingJustification: 'semapv:ManualMappingCuration',
				subjectSource: sourceStandardKey,
				subjectVersion,
				objectSource: HUB_STANDARD,
				objectVersion,
				mappingTool: MAPPING_TOOL,
			});
			const closeSubgraph = closeBuilder.buildMappingSubgraph({
				authoredMappings: harvest.divergentAnchorMappings,
				sourceNodes: args.sourceNodes,
				referenceNodes: args.referenceNodes,
			});

			// stamp the attestation provenance onto every resolved edge (the edge's cedsAnchorKey is the
			// harvest targetKey, so the pair lookup is exact).
			const stampAttestation = (oneEdge) => {
				const attestation = harvest.attestationByPair[`${oneEdge.fromRef.id}|${oneEdge.properties.cedsAnchorKey}`];
				if (attestation) {
					oneEdge.properties.anchorAttestation = attestation.anchorAttestation;
					oneEdge.properties.anchorLocators = attestation.anchorLocators;
				}
			};
			exactSubgraph.edges.forEach(stampAttestation);
			closeSubgraph.edges.forEach(stampAttestation);

			next('', { ...args, harvest, exactSubgraph, closeSubgraph });
		});

		// 3b. FREEZE the divergence manifest (only when the divergent channel produced decisions). The
		// vocabulary guard requires decisionBlockHash + confidence on every CLOSE_MATCH; the manifest is
		// the deterministic, dereferenceable thing that hash points at. Refusing to run without a
		// decision store when divergent decisions exist is the same no-silent-default discipline every
		// bridge in this tree applies to its required run resources.
		taskList.push((args, next) => {
			if (args.harvest.divergentAnchorMappings.length === 0) {
				next('', { ...args, divergenceManifest: null });
				return;
			}
			if (!decisionStore || typeof decisionStore.saveDecisionBlock !== 'function') {
				next(
					`${moduleName}: ${args.harvest.divergentAnchorMappings.length} divergent per-node anchor(s) ` +
						`need a CLOSE_MATCH decisionBlockHash, but injectedTools.decisionStore ` +
						`(saveDecisionBlock) is not available — a CLOSE_MATCH edge whose hash dereferences to ` +
						`nothing would be a false stamp; there is no default.`,
				);
				return;
			}
			const divergenceManifest = composeDivergenceManifest({
				pairStamp,
				divergentAnchorMappings: args.harvest.divergentAnchorMappings,
			});
			args.closeSubgraph.edges.forEach((oneEdge) => {
				oneEdge.properties.decisionBlockHash = divergenceManifest.decisionBlockHash;
			});
			decisionStore.saveDecisionBlock(
				{
					pairKey,
					frozenText: divergenceManifest.frozenText,
					decisionBlockHash: divergenceManifest.decisionBlockHash,
				},
				(err) =>
					next(err ? `${moduleName}: saving the divergence manifest for ${pairKey}: ${err}` : '', {
						...args,
						divergenceManifest,
					}),
			);
		});

		// 4. WRITE — every resolved edge through the guarded relationshipWriter: exact channel through
		// the authoredMapping slot, divergent channel through the decision slot (the writer's two edge
		// sources, named honestly for what each channel is).
		taskList.push((args, next) => {
			let edgesWritten = 0;
			const writeList = new taskListPlus();
			const queueWrites = (edges, slotName) => {
				edges.forEach((oneEdge) => {
					writeList.push((a2, n2) => {
						relationshipWriter(
							{
								[slotName]: {
									fromStableId: oneEdge.fromRef.id,
									toStableId: oneEdge.toRef.id,
									relationshipType: oneEdge.type,
									properties: oneEdge.properties,
								},
								applyLabel,
							},
							(err, writeResult) => {
								if (err) {
									n2(`${moduleName}: writing ${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}: ${err}`);
									return;
								}
								if (writeResult && writeResult.edgeWritten) {
									edgesWritten++;
								}
								n2('', a2);
							},
						);
					});
				});
			};
			queueWrites(args.exactSubgraph.edges, 'authoredMapping');
			queueWrites(args.closeSubgraph.edges, 'decision');
			pipeRunner(writeList.getList(), {}, (err) => {
				next(err || '', { ...args, edgesWritten });
			});
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			// close the reader whether or not the run succeeded (the writer is closed by bridgeMaker).
			reader.close((closeErr) => {
				if (err) {
					callback(closeErr ? `${err} (and the graph reader also failed to close: ${closeErr})` : err);
					return;
				}
				if (closeErr) {
					callback(`${moduleName}: resolved ${args.edgesWritten} edge(s) but the graph reader failed to close: ${closeErr}`);
					return;
				}
				const unresolvedAnchors = args.exactSubgraph.orphans.concat(args.closeSubgraph.orphans);
				callback('', {
					edgesWritten: args.edgesWritten,
					// the divergence manifest hash when the CLOSE channel ran; null on the pure-authored
					// path (the same null ctdlAuthoredBridge returns — nothing non-deterministic to freeze).
					decisionBlock: args.divergenceManifest ? args.divergenceManifest.decisionBlockHash : null,
					producer: PRODUCER,
					counts: {
						authored: args.exactSubgraph.counts.edgesTotal,
						inferred: 0, // nothing here is LLM-inferred; the CLOSE channel is counted by its own name
						divergentAnchorClose: args.closeSubgraph.counts.edgesTotal,
						anchoredNodes: args.harvest.counts.anchoredNodes,
						authoredAnchors: args.harvest.counts.authoredAnchors,
						dualAttested: args.harvest.counts.dualAttested,
						authoredOnly: args.harvest.counts.authoredOnly,
						nodeAnchorDivergent: args.harvest.counts.nodeAnchorDivergent,
						orphans: args.exactSubgraph.counts.orphans + args.closeSubgraph.counts.orphans,
						fromGaps: args.exactSubgraph.counts.fromGaps + args.closeSubgraph.counts.fromGaps,
						mode: 'deterministic', // rebridge and materialize coincide — see MODE DISCIPLINE above
					},
					// the honest-abstention record: every anchor that resolved to NO HubReference, with the
					// true reason referenceIndex recorded. Additive to the declared result keys.
					unresolvedAnchors,
				});
			});
		});
	};

// END OF the produced BridgeModule callable ==============================================

module.exports = moduleFunction;
module.exports.MAPPING_TOOL = MAPPING_TOOL;
module.exports.HUB_STANDARD = HUB_STANDARD;
module.exports.AUTHORED_ANCHOR_GENERATION = AUTHORED_ANCHOR_GENERATION;
// exported for the unit test ONLY (the same discipline as the other bridges' helper exports).
module.exports.harvestAuthoredAnchors = harvestAuthoredAnchors;
module.exports.composeDivergenceManifest = composeDivergenceManifest;
