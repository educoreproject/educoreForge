'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// referenceIndex.js — the PURE, deterministic AUTHORED-CROSSWALK mapping derivation (design §3.7, the
// bridge library's `referenceIndex` component). It is the FAITHFUL PORT of the incumbent
// npm/qtools-graph-forge-core/lib/mapping-subgraph/mappingSubgraph.js (P2, implementationPlan_bridge_072426
// §7) into the recreation. The ONLY change from the incumbent is the single vocabulary `require`, repointed
// at the recreation's lib/vocabulary/vocabulary (all destructured constants resolve there unchanged) — the
// resolution logic, the reference-index construction, the dedup/order and the emitted edge shape are
// byte-for-byte the incumbent's. This is the twin of how forges/ceds/lib/referenceSubgraph.js was ported.
//
// ROW-DRIVEN: it converts the AUTHORED crosswalk itself (each authored mapping = a source element -> a CEDS
// target Global ID), NOT a producer's own per-node anchoring — the crosswalk is the authority. The caller
// resolves the source-element FROM endpoint to its graph stableId (standard-specific) and hands this PURE
// core a list of { fromStableId, targetKey } authored mappings; the core resolves each CEDS target Global ID
// to its materialized HubReference (directly by canonicalKey, or through the maintained VERSION-BRIDGE TABLE
// for the concepts the hub remodeled), dedups, and emits one typed (source)-[:EXACT_MATCH]->(HubReference)
// EDGE per distinct (fromStableId, ref) pair.
//
// Output: { edges, orphans, diagnostics, counts } in the standard edge shape ({type, fromRef, toRef,
// properties} with SCALAR property values). Mappings are EDGES by default (reify-on-demand): ZERO
// MappingAssertion nodes. Authored track is DETERMINISTIC: confidence 1.0, mappingJustification =
// semapv:ManualMappingCuration, NO LLM.
//
// RESOLUTION (each authored targetKey -> exactly one HubReference, or an orphan):
//   - DIRECT       : a property-tier HubReference whose canonicalKey == targetKey, unqualified, OR a
//                     value-tier HubReference whose composite '${propertyKey}|${valueCanonicalKey}' == targetKey.
//   - VERSION-BRIDGE: targetKey is a remodeled Global ID -> the directive's (targetPropertyKey, qualifierKey)
//                     resolves the QUALIFIED ref (qualifierKey set) or the unqualified base (null).
//   - else         : ORPHAN (authored but unresolvable target) — recorded, NEVER an edge to a missing ref.
// A fromStableId that is not a known source node is recorded (fromGap) and NEVER emitted as a dangling edge.
//
// A value-tier canonicalKey is the value's OV token (referenceSubgraph.js: value-tier canonicalKey =
// valueKey), a disjoint namespace from property canonicalKeys ('OV...' vs 'P...'). Because CEDS option SETS
// are shared across many properties, baseValueRef is keyed by the COMPOSITE (propertyKey, valueCanonicalKey)
// so every value-tier resolution is property-scoped; every value-tier targetKey a caller passes MUST be the
// composite string '${propertyKey}|${valueCanonicalKey}', never a bare OV token.
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM. camelCase only.
//
// @implements {ReferenceIndex} — design §3.7
// @concept: [[MappingSubgraph]]
// @concept: [[HubReference]]

const path = require('path');

const vocab = require(path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
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
		mappingTool = 'ctdlAuthoredBridge',
	} = {}) => {
		const edgeType = SKOS_EDGE_TYPES[predicate];

		// --- build the reference resolution index from the materialized HubReference nodes ---
		// basePropertyRef[canonicalKey]                     -> stableId   (property tier, UNQUALIFIED)
		// qualifiedRef[propertyKey '|' qualifierKey]         -> stableId   (property tier, ONE qualifier)
		// baseValueRef[propertyKey '|' valueCanonicalKey]    -> stableId   (value tier — COMPOSITE key; a
		//   value-tier HubReference's canonicalKey is the value's own OV token, INTENTIONALLY non-unique among
		//   value-tier refs because CEDS option SETS are shared across many properties. baseValueRef is keyed
		//   by the COMPOSITE (propertyKey, valueCanonicalKey) so every value-tier resolution is property-scoped.)
		const buildReferenceIndex = (referenceNodes) => {
			const basePropertyRef = {};
			const qualifiedRef = {};
			const baseValueRef = {};
			// value-tier refs that cannot be indexed (missing propertyKey/canonicalKey) are counted with the
			// TRUE reason so a malformed reference block is visible as itself, not misread as a missing ref.
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
		//                       targetKey is either a property Global ID token ('P...') or a composite value key
		//                       '${propertyKey}|${OVtoken}' — resolveTarget tries both index shapes so ONE
		//                       caller-agnostic path serves both tiers.)
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
