'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// equivalenceSubgraph.js — PURE Phase-6 EQUIVALENCE LAYER + CONSERVATIVITY + CURATION
// (WHITEPAPER §7, PLAN §Phase 6). The keystone the whole architecture exists for. Three pure functions,
// NO Neo4j / NO async / NO Date / NO random / NO LLM. camelCase only.
//
// (1) buildEquivalenceClusters — the DERIVED equivalence layer. Equivalence is computed by GROUPING the
//     sources whose EXACT_MATCH resolves to the SAME HubReference (WHITEPAPER §7.1/§7.2: "a HubReference
//     with >=2 exactMatch sources IS an equivalence cluster"). exactMatch ONLY composes — closeMatch /
//     narrow / broad NEVER join a cluster (§7.3, P5). NO separate Cluster node is materialized: the
//     HubReference (materialized in Phase 3) IS the cluster's anchor (WHITEPAPER §4.7 "obviating any
//     separate cluster node"). This is GROUPING, never path-finding over the mapping graph. (The
//     DESIGN-doc 'explicit Cluster nodes' recommendation, RESOLVED 2026-06-27, PREDATES the 2026-06-29
//     reify-on-demand reversal and is SUPERSEDED by the WHITEPAPER — see the DEVLOG Phase-6 build log.)
//
// (2) checkConservativity — the load-bearing SAFETY guarantee (WHITEPAPER §7.3, PLAN §Phase 6, Appendix-B
//     #4). The PINNED 'source-distinct / must-never-merge' rule (DEVLOG §6L-c): two source elements are
//     source-distinct (must NEVER share a cluster) when they resolve to person-identifier HubReferences
//     that share the same base property (Person Identifier P001572) but differ in the `Has Person
//     Identifier Type` QUALIFIER value — the canonical pair Student Identifier (OV002114100002) vs Staff
//     Member Identifier (OV002114100003). Because a cluster is exactly the sources holding EXACT_MATCH to
//     ONE HubReference (clusters never span references — the exactMatch-only construction guarantee), a
//     must-never-merge pair (R1,R2) is violated iff some SINGLE source holds EXACT_MATCH to BOTH R1 and R2
//     (it would bridge/equate the two role-distinct references — the classic conservativity violation).
//     THE CHECK: for every declared pair, the sources of R1 and the sources of R2 must be DISJOINT; a
//     non-empty intersection names the bridging element. PASS = zero violations. The closeMatch evidence
//     is NEVER consulted.
//
// (3) buildCurationSubgraph — reify-on-demand CURATION (the ONLY graph mutation Phase 6 makes; WHITEPAPER
//     §6.1). A vetted inferred closeMatch is PROMOTED by a curation input to a curated EXACT_MATCH at the
//     QUALIFIED reference, and — because that mapping must carry the curation relationship (CURATED_BY) —
//     it is REIFIED into a MappingAssertion node (the only thing that forces a node; a plain predicate
//     would not). Resolves Appendix-B #1: the qualified Student reference then carries >=2 DISTINCT
//     EXACT_MATCH sources (EdFi authored + SIF curated) => an equivalence cluster => gate 10 flips.
//     Curation is DURABLE fixture content, replayed deterministically (NO LLM). mappingJustification =
//     semapv:ManualMappingCuration; provenanceTier = user-asserted; confidence 1.0.
//
// REUSES the Phase-4 authored-track reference-resolution index (buildReferenceIndex) — the SAME resolver,
// not re-implemented: a curation target Global ID resolves to its QUALIFIED HubReference via qualifiedRef
// (propertyKey '|' qualifierKey), or to the base property via basePropertyRef when no qualifier is given.
//
// Output shapes match the existing producers ({type, fromRef, toRef, properties} edges with SCALAR
// property values; {ref, stableId, labels, properties} nodes) so the CLI's block-serialization + replay
// path consumes it unchanged.
//
// @concept: [[EquivalenceSubgraph]]
// @concept: [[Conservativity]]
// @concept: [[HubReference]]
// @concept: [[MappingAssertion]]

const path = require('path');
const crypto = require('crypto');

const vocab = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const {
	SKOS_EDGE_TYPES,
	MAPPING_PROPERTIES: MP,
	PROVENANCE_TIER,
} = vocab;

// REUSE the Phase-4 authored-track reference-resolution index (basePropertyRef + qualifiedRef).
const mappingSubgraphFactory = require(path.join(__dirname, '..', 'mapping-subgraph', 'mappingSubgraph'));

// single PG-JSON array element -> scalar; list-valued property -> array (the engine collapses [x]->x at MERGE;
// the producer/checks do it on read). Reference nodes arrive with PG-JSON array property values.
const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({
		curationPredicate = 'exactMatch',
		mappingJustification = 'semapv:ManualMappingCuration',
		provenanceTier = PROVENANCE_TIER.USER_ASSERTED,
		subjectSource,
		subjectVersion = '',
		objectSource = 'CEDS',
		objectVersion = '',
		mappingTool = 'edf-equivalence',
	} = {}) => {
		const curationEdgeType = SKOS_EDGE_TYPES[curationPredicate];
		const referenceResolver = mappingSubgraphFactory({});

		// ---------------------------------------------------------------
		// (1) buildEquivalenceClusters — DERIVED equivalence: group EXACT_MATCH by shared HubReference.
		//   exactMatchEdges : [{ fromId, toId }]  (source stableId -> HubReference stableId; EXACT_MATCH only)
		//   -> { clusters: [{ refStableId, sources:[fromId…] (sorted, distinct) }] (>=2 sources, sorted), counts }
		// PURE grouping, NEVER path-finding. A HubReference with >=2 distinct exactMatch sources is a cluster.
		const buildEquivalenceClusters = ({ exactMatchEdges } = {}) => {
			const sourcesByRef = new Map(); // refStableId -> Set(fromId)
			(exactMatchEdges || []).forEach((oneEdge) => {
				const { fromId, toId } = oneEdge;
				if (fromId === undefined || toId === undefined || fromId === null || toId === null) {
					return;
				}
				if (!sourcesByRef.has(toId)) {
					sourcesByRef.set(toId, new Set());
				}
				sourcesByRef.get(toId).add(fromId);
			});
			const clusters = [];
			sourcesByRef.forEach((sourceSet, refStableId) => {
				if (sourceSet.size >= 2) {
					clusters.push({
						refStableId,
						sources: [...sourceSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
					});
				}
			});
			clusters.sort((a, b) => (a.refStableId < b.refStableId ? -1 : a.refStableId > b.refStableId ? 1 : 0));
			return {
				clusters,
				counts: {
					referencesWithExactMatch: sourcesByRef.size,
					equivalenceClusters: clusters.length,
				},
			};
		};

		// build refStableId -> Set(fromId) over EXACT_MATCH edges (the shared primitive of both checks).
		const sourcesByRefIndex = (exactMatchEdges) => {
			const sourcesByRef = new Map();
			(exactMatchEdges || []).forEach((oneEdge) => {
				const { fromId, toId } = oneEdge;
				if (fromId === undefined || toId === undefined || fromId === null || toId === null) {
					return;
				}
				if (!sourcesByRef.has(toId)) {
					sourcesByRef.set(toId, new Set());
				}
				sourcesByRef.get(toId).add(fromId);
			});
			return sourcesByRef;
		};
		const sortStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

		// ---------------------------------------------------------------
		// (2a) checkQualifierConservativity — the GENERAL STRUCTURAL INVARIANT (the general form of the
		//   studentId != staffId thesis; WILD_FALCON 2026-06-30). NO hand-list: assert that NO source holds
		//   EXACT_MATCH to two HubReferences that share a base PROPERTY (same propertyKey) but DIFFER in the
		//   qualifier (different sorted qualifierKeys signature). That single rule covers student/staff AND
		//   every future qualifier-distinct identifier pair. A source claiming to be exactly two different
		//   qualified senses of one property is the conservativity violation (it would equate them).
		//   referenceNodes : the materialized HubReference nodes (carry propertyKey + qualifierKeys).
		//   -> { pass, violations:[{ source, propertyKey, qualifierSignatures:[…], refs:[…] }], counts }
		const checkQualifierConservativity = ({ exactMatchEdges, referenceNodes } = {}) => {
			const refMeta = new Map(); // refStableId -> { propertyKey, qualifierSig }
			(referenceNodes || []).forEach((oneNode) => {
				const props = oneNode.properties || {};
				if (v1(props.role) !== 'HubReference') {
					return;
				}
				const propertyKey = v1(props.propertyKey);
				const qualifierSig = asList(props.qualifierKeys).slice().sort(sortStrings).join(',');
				refMeta.set(oneNode.stableId, { propertyKey, qualifierSig });
			});
			const refsBySource = new Map(); // fromId -> Set(toId)
			(exactMatchEdges || []).forEach((oneEdge) => {
				const { fromId, toId } = oneEdge;
				if (!fromId || !toId || !refMeta.has(toId)) {
					return; // only EXACT_MATCH edges that resolve to a known HubReference participate
				}
				if (!refsBySource.has(fromId)) {
					refsBySource.set(fromId, new Set());
				}
				refsBySource.get(fromId).add(toId);
			});
			const violations = [];
			refsBySource.forEach((refSet, source) => {
				const byProperty = new Map(); // propertyKey -> Map(qualifierSig -> [refStableId])
				refSet.forEach((refStableId) => {
					const { propertyKey, qualifierSig } = refMeta.get(refStableId);
					if (!byProperty.has(propertyKey)) {
						byProperty.set(propertyKey, new Map());
					}
					const sigMap = byProperty.get(propertyKey);
					if (!sigMap.has(qualifierSig)) {
						sigMap.set(qualifierSig, []);
					}
					sigMap.get(qualifierSig).push(refStableId);
				});
				byProperty.forEach((sigMap, propertyKey) => {
					if (sigMap.size >= 2) {
						// the SAME source is EXACT_MATCH to >=2 refs of this property with DIFFERENT qualifier sigs.
						const refs = [];
						sigMap.forEach((refList) => refList.forEach((r) => refs.push(r)));
						violations.push({
							source,
							propertyKey,
							qualifierSignatures: [...sigMap.keys()].sort(sortStrings),
							refs: refs.sort(sortStrings),
						});
					}
				});
			});
			violations.sort((a, b) =>
				a.source < b.source ? -1 : a.source > b.source ? 1 : sortStrings(a.propertyKey, b.propertyKey),
			);
			return {
				pass: violations.length === 0,
				violations,
				counts: { sourcesChecked: refsBySource.size, violationCount: violations.length },
			};
		};

		// ---------------------------------------------------------------
		// (2b) checkConservativity — EXPLICIT must-never-merge pairs the general invariant does NOT cover:
		//   DIFFERENT-PROPERTY pairs (e.g. School Operational Status P000533 vs LEA Operational Status P000174 —
		//   distinct properties under distinct classes; a source must never be exactly both). Handles
		//   MULTIPLICITY (Fix 3): each side is a SET of refStableIds (all refs carrying that property), so a
		//   property realized by >1 HubReference cannot hide a bridge.
		//   exactMatchEdges    : [{ fromId, toId }]  (EXACT_MATCH only — closeMatch NEVER consulted)
		//   mustNeverMergePairs: [{ label, refsA:[…], refsB:[…] }]  (sets of HubReference stableIds)
		//   -> { pass, violations:[{ label, bridgingSources:[…] }], counts }
		const checkConservativity = ({ exactMatchEdges, mustNeverMergePairs } = {}) => {
			const sourcesByRef = sourcesByRefIndex(exactMatchEdges);
			const unionSources = (refIds) => {
				const out = new Set();
				(refIds || []).forEach((refId) => {
					(sourcesByRef.get(refId) || new Set()).forEach((s) => out.add(s));
				});
				return out;
			};
			const violations = [];
			(mustNeverMergePairs || []).forEach((onePair) => {
				const setA = unionSources(onePair.refsA);
				const setB = unionSources(onePair.refsB);
				const bridging = [...setA].filter((oneSource) => setB.has(oneSource));
				if (bridging.length > 0) {
					violations.push({
						label: onePair.label || 'unlabeled must-never-merge pair',
						refsA: (onePair.refsA || []).slice().sort(sortStrings),
						refsB: (onePair.refsB || []).slice().sort(sortStrings),
						bridgingSources: bridging.sort(sortStrings),
					});
				}
			});
			violations.sort((a, b) => sortStrings(a.label, b.label));
			return {
				pass: violations.length === 0,
				violations,
				counts: {
					pairsChecked: (mustNeverMergePairs || []).length,
					violationCount: violations.length,
				},
			};
		};

		// ---------------------------------------------------------------
		// (3) buildCurationSubgraph — reify-on-demand promotion of a vetted closeMatch to a curated
		//     EXACT_MATCH at the QUALIFIED reference + a reified MappingAssertion node carrying the curation
		//     relationship. -> { nodes, edges, orphans, diagnostics, counts }.
		//   curationInputs : [{ fromStableId, targetPropertyKey, qualifierKey?, annotation?, note? }]
		//        targetPropertyKey + qualifierKey -> the QUALIFIED ref (qualifiedRef); qualifierKey omitted ->
		//        the base property (basePropertyRef). A curation input that does not resolve (unknown source
		//        OR unknown ref) materializes NOTHING (recorded as an orphan/fromGap; never a dangling edge).
		//   sourceNodes    : source-standard nodes (for fromStableId existence validation)
		//   referenceNodes : the materialized HubReference nodes (the resolution targets)
		const buildCurationSubgraph = ({ curationInputs, sourceNodes, referenceNodes } = {}) => {
			const { basePropertyRef, qualifiedRef } = referenceResolver.buildReferenceIndex(referenceNodes);
			const sourceStableIds = new Set((sourceNodes || []).map((oneNode) => oneNode.stableId));

			const resolveCurationTarget = ({ targetPropertyKey, qualifierKey }) => {
				if (qualifierKey) {
					const refStableId = qualifiedRef[`${targetPropertyKey}|${qualifierKey}`];
					return refStableId ? { refStableId, mode: 'curatedQualified' } : null;
				}
				const refStableId = basePropertyRef[targetPropertyKey];
				return refStableId ? { refStableId, mode: 'curatedBase' } : null;
			};

			const edgeByPair = new Map(); // `${fromStableId}|${refStableId}` -> edge (dedup; MERGE semantics)
			const nodeByAssertion = new Map(); // assertionId -> node (dedup)
			const reifyEdges = [];
			const orphans = [];
			const fromGaps = [];

			(curationInputs || []).forEach((oneInput) => {
				const { fromStableId, targetPropertyKey, qualifierKey } = oneInput;
				if (!sourceStableIds.has(fromStableId)) {
					fromGaps.push({
						fromStableId,
						targetPropertyKey,
						qualifierKey: qualifierKey || null,
						reason: 'curation source element not materialized as a node',
					});
					return;
				}
				const resolved = resolveCurationTarget({ targetPropertyKey, qualifierKey });
				if (!resolved) {
					orphans.push({
						fromStableId,
						targetPropertyKey,
						qualifierKey: qualifierKey || null,
						reason: qualifierKey
							? 'no qualified HubReference for (propertyKey|qualifierKey)'
							: 'no base-property HubReference with this propertyKey',
					});
					return;
				}
				const { refStableId } = resolved;
				const pairKey = `${fromStableId}|${refStableId}`;
				if (edgeByPair.has(pairKey)) {
					return; // same (source, reference) curated more than once -> ONE edge
				}
				const cedsAnchorKey = qualifierKey || targetPropertyKey;
				// the curated EXACT_MATCH edge (the promotion). carries provenanceTier (replay-required).
				edgeByPair.set(pairKey, {
					type: curationEdgeType,
					fromRef: { source: subjectSource, id: fromStableId },
					toRef: { source: objectSource, id: refStableId },
					properties: {
						[MP.PREDICATE]: curationPredicate,
						[MP.CONFIDENCE]: 1.0,
						[MP.MAPPING_JUSTIFICATION]: mappingJustification,
						[MP.PROVENANCE_TIER]: provenanceTier,
						[MP.SUBJECT_SOURCE]: subjectSource,
						[MP.SUBJECT_VERSION]: subjectVersion,
						[MP.OBJECT_SOURCE]: objectSource,
						[MP.OBJECT_VERSION]: objectVersion,
						[MP.MAPPING_TOOL]: mappingTool,
						cedsAnchorKey,
						resolution: resolved.mode,
					},
				});
				// reify-on-demand: the curation MUST carry the CURATED_BY relationship -> a MappingAssertion node.
				const assertionId = `mappingAssertion:${crypto
					.createHash('sha256')
					.update(`${fromStableId}|${refStableId}|${curationPredicate}`, 'utf8')
					.digest('hex')}`;
				if (!nodeByAssertion.has(assertionId)) {
					nodeByAssertion.set(assertionId, {
						ref: { source: subjectSource, id: assertionId },
						stableId: assertionId,
						labels: ['MappingAssertion', 'ForgedNode'],
						properties: {
							role: 'MappingAssertion',
							[MP.PREDICATE]: curationPredicate,
							[MP.MAPPING_JUSTIFICATION]: mappingJustification,
							[MP.PROVENANCE_TIER]: provenanceTier,
							[MP.SUBJECT_SOURCE]: subjectSource,
							[MP.OBJECT_SOURCE]: objectSource,
							[MP.MAPPING_TOOL]: mappingTool,
							cedsAnchorKey,
							curationAnnotation: oneInput.annotation || 'CURATED_BY',
							curator: oneInput.curator || '', // WHITEPAPER §6.1: the attributed actor (the WHO)
							curationNote: oneInput.note || '',
						},
					});
					reifyEdges.push({
						type: 'REIFIED_AS',
						fromRef: { source: subjectSource, id: fromStableId },
						toRef: { source: subjectSource, id: assertionId },
						properties: { [MP.PREDICATE]: curationPredicate, [MP.PROVENANCE_TIER]: provenanceTier },
					});
					reifyEdges.push({
						type: 'ASSERTS',
						fromRef: { source: subjectSource, id: assertionId },
						toRef: { source: objectSource, id: refStableId },
						properties: { [MP.PREDICATE]: curationPredicate, [MP.PROVENANCE_TIER]: provenanceTier },
					});
				}
			});

			const exactMatchEdges = [...edgeByPair.values()];
			// deterministic ordering for a byte-stable block.
			const sortByTuple = (a, b) => {
				const ka = `${a.type}|${a.fromRef.id}|${a.toRef.id}`;
				const kb = `${b.type}|${b.fromRef.id}|${b.toRef.id}`;
				return ka < kb ? -1 : ka > kb ? 1 : 0;
			};
			exactMatchEdges.sort(sortByTuple);
			reifyEdges.sort(sortByTuple);
			const nodes = [...nodeByAssertion.values()].sort((a, b) =>
				a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0,
			);
			orphans.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
			fromGaps.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));

			return {
				nodes,
				edges: exactMatchEdges.concat(reifyEdges),
				orphans,
				diagnostics: { fromGaps },
				counts: {
					curatedExactMatchEdges: exactMatchEdges.length,
					reifiedAssertionNodes: nodes.length,
					reifyEdges: reifyEdges.length,
					orphans: orphans.length,
					fromGaps: fromGaps.length,
					curationInputsConsidered: (curationInputs || []).length,
				},
			};
		};

		return {
			buildEquivalenceClusters,
			checkQualifierConservativity,
			checkConservativity,
			buildCurationSubgraph,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
