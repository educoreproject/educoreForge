'use strict';

// relationshipWriter — the WRITE component of the bridge library (design §3.6). It is the ONE
// library component that gets a real body in P0, because it is the write-into-graph substrate the
// whole phase exists to lay: a bridge plugin composes it, and it drives the injected graphWriter.
// Everything upstream of it (walk / gather / select / freeze) is skeletoned in P0 and filled by
// P2/P3; the edge actually reaching the graph is proven now.
//
//   relationshipWriter({ graphWriter, edgePolicy }) ->
//       ({ decision, authoredMapping, applyLabel }, callback('', { edgeWritten, metadata }))
//
// It takes EITHER an authoredMapping (deterministic EXACT_MATCH producer) OR a frozen decision
// (inferred CLOSE_MATCH producer) — exactly one — plus the applyLabel handed down from the
// orchestrator. It shapes the bridging metadata and hands a single edge to graphWriter, then
// RETURNS status: it is never a pure side-effect, because an un-counted write cannot be gated
// (design §3.6).
//
// P0 SCOPE: the metadata assembled here is the minimum an edge needs to be written and harvested
// — endpoint stableIds, a relationship type, and the applyLabel. The full bridging stamp
// (predicate, confidence, provenanceTier, mappingJustification, decisionBlockHash, hub-anchor
// key) is authored by the producers; this seam carries whatever `properties` they supply straight
// through to graphWriter. It invents none of them (polyArch2 §6).
//
// THE VOCABULARY GUARD (hardening the write seam, forgeArchitectureRefactor follow-on). Everything
// above is a SYNTACTIC guard only (exactly-one-source, applyLabel present) — it never asks what the
// edge IS. neo4jGraphWriter separately guards relationshipType as a bare Cypher identifier (the
// injection guard); THIS guard is that check's SEMANTIC twin: it asks whether relationshipType is a
// type the vocabulary (lib/vocabulary/vocabulary.js) actually SANCTIONS, and whether `properties`
// carries the stamps that type requires. The vocabulary is the single source of truth; the injected
// `edgePolicy` is a DERIVED view of it (componentLibrary.deriveEdgePolicy), never a hand-copied
// duplicate — a writer built without one has no contract to enforce, so its absence is a
// construction-time refusal, exactly like a missing graphWriter (polyArch2 §6).
//
// GOLDEN-VERIFIED (design-authority correction, live-queried against GOLD_260718): the real,
// golden-canonical stamp is `properties.predicate` ('exactMatch' / 'closeMatch' / ...) — the SAME
// property the producers (referenceIndex.js, inferredIndex.js) already carry. An earlier draft of
// this guard checked an invented `matchType` property that exists nowhere in the golden; this
// version checks `predicate` instead, so no producer needs to change.
//
//   edgePolicy = {
//     sanctionedTypes         : Set<relationshipType> — structural ∪ mapping-predicate ∪ crosswalk
//     structuralTypes         : Set<relationshipType> — EDGE_TYPES values (HAS_PROPERTY, ...)
//     mappingTypeToPredicate  : { relationshipType -> SKOS predicate string ('exactMatch', ...) }
//     crosswalkTypes          : Set<relationshipType> — CLASSIFICATION_EDGE_TYPES values
//     requiredEdgeProperties  : string[] — REQUIRED_PROPERTIES.EDGE (['provenanceTier'])
//     structuralProvenanceTier: string — PROVENANCE_TIER.STRUCTURAL ('structural')
//     closeMatchType          : string — the CLOSE_MATCH relationshipType (SKOS_EDGE_TYPES.closeMatch)
//   }
//
// FOUR checks, in order, AFTER the existing exactly-one-source / applyLabel checks:
//   1. UNKNOWN TYPE      — relationshipType not in sanctionedTypes -> refused by name.
//   2. MISSING STAMP     — properties is missing any requiredEdgeProperties entry -> refused by name.
//   3. MAPPING AGREEMENT — relationshipType is a mapping predicate: properties.predicate MUST be
//      present and MUST equal the predicate string that type maps to (a present-but-disagreeing
//      predicate is refused, never silently corrected — a deliberate design-authority ruling).
//      CLOSE_MATCH additionally requires properties.decisionBlockHash and properties.confidence.
//      CROSSWALK types are sanctioned (checks 1/2 only) but are NOT a mapping predicate and carry no
//      predicate-agreement requirement — they never compose with the hub-resolution model (vocabulary.js).
//   4. STRUCTURAL TIER   — relationshipType is a structural EDGE_TYPE: properties.provenanceTier
//      MUST equal structuralProvenanceTier ('structural') exactly.
// A relationshipType that is neither structural, mapping, nor crosswalk never reaches checks 3/4
// (nothing further is asked of it beyond sanctioning + the universal required-property stamp).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ graphWriter, edgePolicy } = {}) => {
		if (!graphWriter) {
			throw new Error(
				`${moduleName}: constructed without a graphWriter. relationshipWriter is the write ` +
					`seam; it must be handed the graphWriter minted from the run's GraphHandle. There is ` +
					`no default — a writer with nowhere to write is not a writer.`,
			);
		}
		if (!edgePolicy) {
			throw new Error(
				`${moduleName}: constructed without an edgePolicy. relationshipWriter enforces the ` +
					`vocabulary's edge contract (sanctioned types, required stamps, mapping-predicate ` +
					`agreement); it must be handed the policy derived from lib/vocabulary/vocabulary.js ` +
					`(componentLibrary.deriveEdgePolicy). There is no default — a guard with nothing to ` +
					`check against is not a guard.`,
			);
		}

		const write = ({ decision, authoredMapping, applyLabel } = {}, callback) => {
			// EXACTLY ONE source of the edge. Neither is a fault; both at once is an ambiguous call
			// (which one's stableIds win?) and is refused rather than silently preferring one.
			if (!decision && !authoredMapping) {
				callback(
					`${moduleName}: an edge needs either an authoredMapping (EXACT_MATCH) or a frozen ` +
						`decision (CLOSE_MATCH); neither was given.`,
				);
				return;
			}
			if (decision && authoredMapping) {
				callback(
					`${moduleName}: both an authoredMapping and a decision were given for one edge; that ` +
						`is ambiguous. Pass exactly one.`,
				);
				return;
			}
			if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
				callback(
					`${moduleName}: applyLabel is ${
						applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
					}. It is the label the orchestrator stamps so the edge can be harvested; there is no ` +
						`default.`,
				);
				return;
			}

			const edgeSource = authoredMapping || decision;
			const { fromStableId, toStableId, relationshipType, properties } = edgeSource;
			const edgeProperties = properties || {};

			// 1. UNKNOWN TYPE — relationshipType must be one the vocabulary sanctions (structural ∪
			// mapping-predicate ∪ crosswalk). An edge whose type the vocabulary does not name is refused,
			// never guessed or let through unchecked (the semantic twin of neo4jGraphWriter's bare-
			// identifier syntax guard).
			if (!edgePolicy.sanctionedTypes.has(relationshipType)) {
				callback(
					`${moduleName}: relationshipType '${relationshipType}' is not a sanctioned edge type. ` +
						`Known types: ${[...edgePolicy.sanctionedTypes].sort().join(', ')}.`,
				);
				return;
			}

			// 2. MISSING STAMP — every edge carries the universal required properties (REQUIRED_PROPERTIES.
			// EDGE, currently just provenanceTier). Missing is a fault, never a silent write.
			const missingRequired = edgePolicy.requiredEdgeProperties.filter(
				(oneRequiredProperty) => edgeProperties[oneRequiredProperty] === undefined,
			);
			if (missingRequired.length) {
				callback(
					`${moduleName}: relationshipType '${relationshipType}' is missing required ` +
						`propert${missingRequired.length === 1 ? 'y' : 'ies'}: ${missingRequired.join(', ')}.`,
				);
				return;
			}

			// 3. MAPPING AGREEMENT — a mapping-predicate edge (EXACT_MATCH/CLOSE_MATCH/BROAD_MATCH/
			// NARROW_MATCH/RELATED_MATCH) must carry properties.predicate, and it must AGREE with the
			// type (the golden-canonical stamp — GOLD_260718 confirmed EXACT_MATCH/CLOSE_MATCH edges
			// carry `predicate`, never a `matchType`). CROSSWALK is sanctioned (checks 1/2 above) but is
			// NOT a mapping predicate and is deliberately exempt from this check (vocabulary.js: it
			// never composes with the hub-resolution model).
			const expectedPredicate = edgePolicy.mappingTypeToPredicate[relationshipType];
			if (expectedPredicate) {
				if (edgeProperties.predicate === undefined) {
					callback(
						`${moduleName}: relationshipType '${relationshipType}' is a mapping predicate — ` +
							`properties.predicate is required (expected '${expectedPredicate}'); none was given.`,
					);
					return;
				}
				if (edgeProperties.predicate !== expectedPredicate) {
					callback(
						`${moduleName}: relationshipType '${relationshipType}' expects properties.predicate ` +
							`'${expectedPredicate}', but got '${edgeProperties.predicate}'. A present-but-` +
							`disagreeing predicate is refused, never silently corrected.`,
					);
					return;
				}
				if (relationshipType === edgePolicy.closeMatchType) {
					const missingCloseMatchStamps = ['decisionBlockHash', 'confidence'].filter(
						(oneStamp) => edgeProperties[oneStamp] === undefined,
					);
					if (missingCloseMatchStamps.length) {
						callback(
							`${moduleName}: a CLOSE_MATCH edge additionally requires ` +
								`${missingCloseMatchStamps.join(' and ')}; missing here.`,
						);
						return;
					}
				}
			}

			// 4. STRUCTURAL TIER — a structural EDGE_TYPE (HAS_PROPERTY, HAS_OPTION_SET, SUBCLASS_OF,
			// REFERENCES, REFERENCES_TYPE, HAS_SUPPORT, ...) must carry provenanceTier === 'structural'
			// exactly — no other tier is honest for a structural edge.
			if (edgePolicy.structuralTypes.has(relationshipType)) {
				if (edgeProperties.provenanceTier !== edgePolicy.structuralProvenanceTier) {
					callback(
						`${moduleName}: relationshipType '${relationshipType}' is a structural edge type — ` +
							`properties.provenanceTier must be '${edgePolicy.structuralProvenanceTier}', got ` +
							`'${edgeProperties.provenanceTier}'.`,
					);
					return;
				}
			}

			graphWriter.writeRelationshipEdge(
				{ fromStableId, toStableId, relationshipType, applyLabel, properties: edgeProperties },
				(err, writeResult) => {
					if (err) {
						callback(`${moduleName}: ${err}`);
						return;
					}
					callback('', {
						edgeWritten: !!(writeResult && writeResult.edgeWritten),
						metadata: { fromStableId, toStableId, relationshipType, applyLabel },
					});
				},
			);
		};

		return write;
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
