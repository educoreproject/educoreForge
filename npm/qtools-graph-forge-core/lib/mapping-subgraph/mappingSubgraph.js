'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// mappingSubgraph.js — PURE, deterministic derivation of the Phase-4 AUTHORED-CROSSWALK mapping subgraph
// (the deterministic track; WHITEPAPER §6.1/§6.2, PLAN §Phase 4). ROW-DRIVEN: it converts the AUTHORED
// crosswalk itself (each authored mapping = a source element -> a CEDS target Global ID), NOT a producer's
// own per-node anchoring — the crosswalk is the authority (PLAN §Phase 4 "convert each crosswalk row";
// WHITEPAPER §6.2 "converted, not inferred"). The caller resolves the source-element FROM endpoint to its
// graph stableId (standard-specific) and hands this PURE core a list of { fromStableId, targetKey } authored
// mappings; the core resolves each CEDS target Global ID to its materialized HubReference (directly by
// canonicalKey, or through the maintained VERSION-BRIDGE TABLE for the concepts the hub remodeled), dedups,
// and emits one typed (source)-[:EXACT_MATCH]->(HubReference) EDGE per distinct (fromStableId, ref) pair.
//
// Output: { edges, orphans, diagnostics, counts } in the standard edge shape ({type, fromRef, toRef,
// properties} with SCALAR property values — the CLI's toBlockEdge wraps them into PG-JSON arrays), so the
// existing block-serialization + replay path consumes it unchanged.
//
// Mappings are EDGES by default (reify-on-demand; §6.1): ZERO MappingAssertion nodes (none required — no
// curation/supersession/flag annotations to hang off a node). Authored track is DETERMINISTIC: confidence
// 1.0, mappingJustification = semapv:ManualMappingCuration, NO LLM.
//
// RESOLUTION (each authored targetKey -> exactly one HubReference, or an orphan):
//   - DIRECT       : a property-tier HubReference whose canonicalKey == targetKey, unqualified, OR a
//                     value-tier HubReference whose canonicalKey == targetKey (the value's OV token — see
//                     CODESET-VALUE extension below).
//   - VERSION-BRIDGE: targetKey is a remodeled Global ID -> the directive's (targetPropertyKey, qualifierKey)
//                     resolves the QUALIFIED ref (qualifierKey set) or the unqualified base (null).
//   - else         : ORPHAN (authored but unresolvable target) — recorded, NEVER an edge to a missing ref.
// A fromStableId that is not a known source node is recorded (fromGap) and NEVER emitted as a dangling edge.
//
// CODESET-VALUE extension (PLAN-codesetValueMatching-070126.md §4/§7): buildReferenceIndex now ALSO indexes
// value-tier HubReference nodes (referenceTier === 'value') by canonicalKey into a THIRD map, baseValueRef.
// This is additive only — property-tier behavior/shape is byte-for-byte unchanged. A value-tier canonicalKey
// is the value's OV token (referenceSubgraph.js emitReference: value-tier canonicalKey = valueKey), a
// disjoint namespace from property canonicalKeys ('OV......' vs 'P......'), so resolveTarget below can
// fall through basePropertyRef -> baseValueRef with zero collision risk and zero behavior change for
// existing property-tier callers. NOTE: notation/name are NOT stamped on the HubReference node itself (only
// canonicalKey/propertyKey/rangeOptionSetId/valueKey are) — a caller resolving the AUTHORED descriptor
// crosswalk (which supplies a CEDSOptionCode, not the OV token) must first join
// CEDSOptionCode == CedsOptionValue.notation against the CEDS STANDARD block (not this reference block) to
// obtain the OV token, THEN pass that token as targetKey here (see edf-mapping's loadAuthoredValueMappings).
// This was a deliberate choice over stamping notation onto the reference block: doing so would change the
// frozen reference block's content hash and force a Phase-3-through-5 rebuild cascade that this additive
// change does not want to trigger.
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM. camelCase only.
//
// @concept: [[MappingSubgraph]]
// @concept: [[HubReference]]

const path = require('path');

const vocab = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const {
	SKOS_EDGE_TYPES,
	MAPPING_PROPERTIES: MP,
	REFERENCE_TIER,
	PROVENANCE_TIER,
} = vocab;

// single-element PG-JSON array -> scalar (the engine does this at MERGE; the producer does it on read).
const v1 = (arrayOrScalar) =>
	Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar;

// list-valued PG-JSON property -> array (qualifierKeys is genuinely list-valued; never collapse via v1).
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({
		predicate = 'exactMatch',
		mappingJustification = 'semapv:ManualMappingCuration',
		provenanceTier = PROVENANCE_TIER.SPEC_AUTHORITATIVE,
		subjectSource,
		subjectVersion = '',
		objectSource = 'CEDS',
		objectVersion = '',
		mappingTool = 'edf-mapping',
	} = {}) => {
		const edgeType = SKOS_EDGE_TYPES[predicate];

		// --- build the reference resolution index from the materialized HubReference nodes ---
		// basePropertyRef[canonicalKey]                     -> stableId   (property tier, UNQUALIFIED)
		// qualifiedRef[propertyKey '|' qualifierKey]         -> stableId   (property tier, ONE qualifier)
		// baseValueRef[propertyKey '|' valueCanonicalKey]    -> stableId   (value tier — COMPOSITE key.
		//   CORRECTNESS NOTE (found live, gf_pureGraph4 first build): a value-tier HubReference's canonicalKey
		//   is the value's own OV token, but referenceSubgraph.js emits ONE HubReference per (property, value)
		//   PAIR and its own header says "canonicalKey is therefore INTENTIONALLY non-unique among value-tier
		//   refs; uniqueness is the composite (hubName, addressSignature)". CEDS option SETS are routinely
		//   shared across many properties (measured: 1,796 value canonicalKeys shared across >1 property,
		//   9,687 HubReference instances — e.g. the 'Grade Level' option set alone is reused by 12 different
		//   CEDS properties). A bare canonicalKey index therefore picks an ARBITRARY property when a value
		//   token is shared — a real, silent mis-resolution bug caught by live sampling. baseValueRef is keyed
		//   by the COMPOSITE (propertyKey, valueCanonicalKey) so every value-tier resolution is property-
		//   scoped; every value-tier targetKey a caller passes MUST be the composite string
		//   '${propertyKey}|${valueCanonicalKey}', never a bare OV token.
		const buildReferenceIndex = (referenceNodes) => {
			const basePropertyRef = {};
			const qualifiedRef = {};
			const baseValueRef = {};
			// L1: value-tier refs that cannot be indexed (missing propertyKey/canonicalKey) were
			// previously dropped in silence — every resolution against them then surfaced as an
			// orphan with the MISLEADING reason 'no HubReference with this canonicalKey'. They are
			// now counted with the TRUE reason so a malformed reference block is visible as itself.
			const skippedValueRefs = [];
			(referenceNodes || []).forEach((oneNode) => {
				const props = oneNode.properties || {};
				if (v1(props.role) !== 'HubReference') {
					return;
				}
				const tier = v1(props.referenceTier);
				if (tier === REFERENCE_TIER.VALUE) {
					const valueCanonicalKey = v1(props.canonicalKey);
					const valuePropertyKey = v1(props.propertyKey);
					if (valueCanonicalKey && valuePropertyKey) {
						baseValueRef[`${valuePropertyKey}|${valueCanonicalKey}`] = oneNode.stableId;
					} else {
						skippedValueRefs.push({
							stableId: oneNode.stableId,
							reason: !valuePropertyKey
								? 'value-tier HubReference has no propertyKey — cannot form the composite baseValueRef key'
								: 'value-tier HubReference has no canonicalKey — cannot form the composite baseValueRef key',
						});
					}
					return;
				}
				if (tier !== REFERENCE_TIER.PROPERTY) {
					return; // qualified / unrecognized tiers: out of scope for this resolver
				}
				const qualifierKeys = asList(props.qualifierKeys);
				const canonicalKey = v1(props.canonicalKey);
				const propertyKey = v1(props.propertyKey);
				if (qualifierKeys.length === 0) {
					basePropertyRef[canonicalKey] = oneNode.stableId;
				} else {
					qualifierKeys.forEach((oneQualifier) => {
						qualifiedRef[`${propertyKey}|${oneQualifier}`] = oneNode.stableId;
					});
				}
			});
			return { basePropertyRef, qualifiedRef, baseValueRef, skippedValueRefs };
		};

		// buildMappingSubgraph — PURE, ROW-DRIVEN. -> { edges, orphans, diagnostics, counts }.
		//   authoredMappings : [{ fromStableId, targetKey }]  (the authored crosswalk, FROM already resolved;
		//                       targetKey is either a property Global ID token ('P......') or, for the
		//                       CODESET-VALUE extension, a composite value key '${propertyKey}|${OVtoken}'
		//                       (NEVER a bare OV token — see buildReferenceIndex's baseValueRef comment above
		//                       for why) — resolveTarget below
		//                       tries both index shapes so ONE caller-agnostic path serves both tiers.)
		//   sourceNodes      : the source-standard nodes (for fromStableId existence validation)
		//   referenceNodes   : the materialized HubReference nodes
		//   versionBridge    : { entries: { oldKey: { targetPropertyKey, qualifierKey } } }
		const buildMappingSubgraph = ({
			authoredMappings,
			sourceNodes,
			referenceNodes,
			versionBridge,
		} = {}) => {
			const { basePropertyRef, qualifiedRef, baseValueRef, skippedValueRefs } =
				buildReferenceIndex(referenceNodes);
			const bridgeEntries = (versionBridge && versionBridge.entries) || {};
			const sourceStableIds = new Set(
				(sourceNodes || []).map((oneNode) => oneNode.stableId),
			);

			// resolve a CEDS target (property token OR composite '${propertyKey}|${OVtoken}' value key) -> { refStableId, mode } or null.
			const resolveTarget = (targetKey) => {
				if (Object.prototype.hasOwnProperty.call(bridgeEntries, targetKey)) {
					const directive = bridgeEntries[targetKey];
					const refStableId = directive.qualifierKey
						? qualifiedRef[`${directive.targetPropertyKey}|${directive.qualifierKey}`]
						: basePropertyRef[directive.targetPropertyKey];
					return refStableId ? { refStableId, mode: 'versionBridge' } : null;
				}
				const propertyStableId = basePropertyRef[targetKey];
				if (propertyStableId) {
					return { refStableId: propertyStableId, mode: 'direct' };
				}
				const valueStableId = baseValueRef[targetKey];
				if (valueStableId) {
					return { refStableId: valueStableId, mode: 'directValue' };
				}
				return null;
			};

			const edgeByPair = new Map(); // `${fromStableId}|${refStableId}` -> edge (dedup; MERGE semantics)
			const orphans = [];
			const fromGaps = [];
			let directCount = 0;
			let bridgeCount = 0;
			let directValueCount = 0;

			(authoredMappings || []).forEach((oneMapping) => {
				const { fromStableId, targetKey } = oneMapping;
				if (!sourceStableIds.has(fromStableId)) {
					fromGaps.push({ fromStableId, targetKey, reason: 'source element not materialized as a node' });
					return;
				}
				const resolved = resolveTarget(targetKey);
				if (!resolved) {
					orphans.push({
						fromStableId,
						targetKey,
						reason: Object.prototype.hasOwnProperty.call(bridgeEntries, targetKey)
							? 'version-bridge target reference not found'
							: 'no property-tier or value-tier HubReference with this canonicalKey',
					});
					return;
				}
				const pairKey = `${fromStableId}|${resolved.refStableId}`;
				if (edgeByPair.has(pairKey)) {
					return; // same (source, reference) authored by more than one row -> ONE edge
				}
				if (resolved.mode === 'versionBridge') {
					bridgeCount++;
				} else if (resolved.mode === 'directValue') {
					directValueCount++;
				} else {
					directCount++;
				}
				edgeByPair.set(pairKey, {
					type: edgeType,
					fromRef: { source: subjectSource, id: fromStableId },
					toRef: { source: objectSource, id: resolved.refStableId },
					properties: {
						[MP.PREDICATE]: predicate,
						[MP.CONFIDENCE]: 1.0,
						[MP.MAPPING_JUSTIFICATION]: mappingJustification,
						[MP.PROVENANCE_TIER]: provenanceTier,
						[MP.SUBJECT_SOURCE]: subjectSource,
						[MP.SUBJECT_VERSION]: subjectVersion,
						[MP.OBJECT_SOURCE]: objectSource,
						[MP.OBJECT_VERSION]: objectVersion,
						[MP.MAPPING_TOOL]: mappingTool,
						cedsAnchorKey: targetKey,
						resolution: resolved.mode,
					},
				});
			});

			const edges = [...edgeByPair.values()];
			// deterministic ordering for a byte-stable block (sort edges by tuple).
			edges.sort((a, b) => {
				const ka = `${a.type}|${a.fromRef.id}|${a.toRef.id}`;
				const kb = `${b.type}|${b.fromRef.id}|${b.toRef.id}`;
				return ka < kb ? -1 : ka > kb ? 1 : 0;
			});
			orphans.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
			fromGaps.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));

			return {
				edges,
				orphans,
				diagnostics: { fromGaps, skippedValueRefs },
				counts: {
					edgesTotal: edges.length,
					direct: directCount,
					directValue: directValueCount,
					versionBridge: bridgeCount,
					orphans: orphans.length,
					fromGaps: fromGaps.length,
					skippedValueRefs: skippedValueRefs.length,
					authoredMappingsConsidered: (authoredMappings || []).length,
				},
			};
		};

		return { buildMappingSubgraph, buildReferenceIndex };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
