'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// schema-validator.js — the PRODUCER-TIME schema validator (Phase 7; SPEC §3.1 "build-time validation").
// A PURE, synchronous module that validates a producer's emitted block (its nodes + edges) against the
// vocabulary registry (schema-as-code). It is the BUILD-TIME enforcement of the schema invariants that
// cannot be Neo4j constraints on Community edition (property EXISTENCE is Enterprise-only) — so on Community
// THIS is the existence enforcement, run as a STANDING cumulative-suite gate over the golden's blocks, and
// available for the (deferred) forge-store.saveBlock chokepoint wiring on a clean tree.
//
// No DI, no Neo4j, no async — a pure function of (parsed block, registry). Deterministic. The caller
// deserializes a block (replay-block.deserializeBlock) and passes { nodes, edges }; or passes a single
// element. Property values arrive PG-JSON ARRAY-WRAPPED (a scalar is a single-element array, e.g.
// provenanceTier: ["structural"]) — this module unwraps for scalar/enum checks.
//
// THE CONTRACT (each rule verified to hold on the conformant golden before being enforced — the registry is
// deliberately INCOMPLETE for per-standard labels and for the curation ASSERTS/REIFIED_AS edge types, so we
// check only registry-GOVERNED, universally-true invariants; we do NOT reject per-standard labels or
// unregistered-but-valid edge types):
//   N1 node carries the universal :ForgedNode label                       (NODE_LABELS.FORGED_NODE)
//   N2 node has a non-empty stableId                                       (UNIQUENESS_KEYS.STABLE_ID)
//   N3 a :HubReference node has all REQUIRED_PROPERTIES.HUB_REFERENCE
//   N4 a :HubDefinition node has all REQUIRED_PROPERTIES.HUB_DEFINITION
//   N5 enum: a node property named predicate/mappingJustification holds a value in its SKOS/SSSOM enum
//   E1 edge type is a syntactically valid relationship identifier         (isValidEdgeType / EDGE_TYPE_RE)
//   E2 edge has provenanceTier AND its value is in PROVENANCE_TIERS       (REQUIRED_PROPERTIES.EDGE + enum)
//   E3 enum: an edge property named predicate/mappingJustification holds a value in its SKOS/SSSOM enum
//
// camelCase only. Pure: returns a violations array; throws NOTHING for off-schema content (an off-schema
// element is a RETURNED violation, not an exception). It throws only on a programming error (no registry).

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		if (!vocabulary) {
			throw new Error('schema-validator: a vocabulary registry is required');
		}
		const {
			NODE_LABELS,
			EQUIVALENCE_NODE_LABELS,
			UNIQUENESS_KEYS,
			REQUIRED_PROPERTIES,
			PROVENANCE_TIERS,
			SKOS_PREDICATES,
			SSSOM_JUSTIFICATIONS,
			MAPPING_PROPERTIES,
			DME_ROLES,
			SCHEMA_VIEW,
			isValidEdgeType,
		} = vocabulary;

		// STRUCTURAL node labels — the universal materialized node TYPES that carry their OWN required-prop
		// sets (so they are NOT held to the base-content NODE set). MappingAssertion is not yet a registry
		// label constant (a noted vocabulary gap; reify-on-demand curation node from Phase 6); SchemaView is
		// finisher-emitted (never appears in a block) but is listed defensively.
		const STRUCTURAL_LABELS = new Set([
			EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
			EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
			'MappingAssertion',
			SCHEMA_VIEW.LABEL,
		]);

		// ▶ SPEC-vs-DATA (verified over the gating golden's 75,685 base content nodes; ratified WILD_FALCON
		// 2026-06-30 — the REGISTRY was corrected to match, dropping `uri` from REQUIRED_PROPERTIES.NODE).
		// At the BLOCK layer _id/_source are carried in node.ref{source,id} (the replay engine MATERIALIZES them
		// as graph properties — they are NOT block properties). name/role/searchText are universally present
		// block properties. So the block-layer existence contract for a base content node (NOT a structural
		// type) is: ref.source+ref.id present (the _id/_source provenance) + name/role/searchText present. (uri
		// is no longer required anywhere.) This filter naturally yields name/role/searchText from the corrected
		// NODE set (the ref-layer _id/_source are checked via N7, not as block properties).
		const BASE_NODE_REQUIRED_BLOCK_PROPS = REQUIRED_PROPERTIES.NODE.filter(
			(oneProp) => oneProp === 'name' || oneProp === 'role' || oneProp === 'searchText',
		);

		// PG-JSON values are array-wrapped; unwrap a scalar (single-element array -> its element).
		const scalar = (value) =>
			Array.isArray(value) ? (value.length === 1 ? value[0] : value) : value;
		const hasKey = (props, key) =>
			props != null && Object.prototype.hasOwnProperty.call(props, key);
		const labelsOf = (node) => (Array.isArray(node.labels) ? node.labels : []);

		// the enum policy for named scalar properties (applies to BOTH nodes and edges where the key exists).
		const ENUM_POLICY = [
			{ key: MAPPING_PROPERTIES.PREDICATE, allowed: SKOS_PREDICATES, name: 'SKOS predicate' },
			{
				key: MAPPING_PROPERTIES.MAPPING_JUSTIFICATION,
				allowed: SSSOM_JUSTIFICATIONS,
				name: 'SSSOM justification',
			},
		];

		const idOf = (node) =>
			node && node.stableId != null
				? node.stableId
				: node && node.ref
					? `${node.ref.source}:${node.ref.id}`
					: '(unknown)';

		// ----- validateNode(node) -> [violations]
		const validateNode = (node) => {
			const out = [];
			const labels = labelsOf(node);
			const props = node.properties || {};

			if (labels.indexOf(NODE_LABELS.FORGED_NODE) === -1) {
				out.push({
					code: 'N1_missingForgedNodeLabel',
					element: idOf(node),
					detail: `node labels [${labels.join(',')}] missing universal '${NODE_LABELS.FORGED_NODE}'`,
				});
			}

			const stableId = node.stableId;
			if (stableId == null || `${stableId}`.length === 0) {
				out.push({
					code: 'N2_missingStableId',
					element: idOf(node),
					detail: `node missing required '${UNIQUENESS_KEYS.STABLE_ID}'`,
				});
			}

			const requireProps = (labelName, reqList, code) => {
				if (labels.indexOf(labelName) === -1) {
					return;
				}
				reqList.forEach((oneProp) => {
					if (!hasKey(props, oneProp)) {
						out.push({
							code,
							element: idOf(node),
							detail: `:${labelName} node missing required property '${oneProp}'`,
						});
					}
				});
			};
			requireProps(
				EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
				REQUIRED_PROPERTIES.HUB_REFERENCE,
				'N3_hubReferenceMissingRequired',
			);
			requireProps(
				EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
				REQUIRED_PROPERTIES.HUB_DEFINITION,
				'N4_hubDefinitionMissingRequired',
			);

			// BASE CONTENT NODE existence (the SPEC §3.1 "required properties exist" enforcement on Community).
			// A base content node is a non-structural node (no HubReference/HubDefinition/MappingAssertion/
			// SchemaView label). Enforce the block-observable universal NODE props (name/role/searchText) + the
			// _id/_source PROVENANCE via node.ref{source,id}. uri is OPTIONAL (non-uniform, per the finding).
			const isStructural = labels.some((oneLabel) => STRUCTURAL_LABELS.has(oneLabel));
			if (!isStructural) {
				BASE_NODE_REQUIRED_BLOCK_PROPS.forEach((oneProp) => {
					if (!hasKey(props, oneProp)) {
						out.push({
							code: 'N6_baseNodeMissingRequired',
							element: idOf(node),
							detail: `base content node (labels [${labels.join(',')}]) missing required property '${oneProp}'`,
						});
					}
				});
				// _id/_source provenance: the block carries them as node.ref{source,id} (replay materializes
				// the _id/_source graph properties from them). A base node lacking ref identity is off-schema.
				const ref = node.ref || {};
				if (ref.source == null || `${ref.source}`.length === 0 || ref.id == null || `${ref.id}`.length === 0) {
					out.push({
						code: 'N7_missingRefIdentity',
						element: idOf(node),
						detail: `base content node missing ref identity {source,id} (the _source/_id provenance)`,
					});
				}
				// STANDARD_ROOT: a base node whose role is the standard-root role must carry the root contract.
				if (scalar(props.role) === DME_ROLES.STANDARD_ROOT) {
					REQUIRED_PROPERTIES.STANDARD_ROOT.forEach((oneProp) => {
						if (!hasKey(props, oneProp)) {
							out.push({
								code: 'N8_standardRootMissingRequired',
								element: idOf(node),
								detail: `standard-root node missing required property '${oneProp}'`,
							});
						}
					});
				}
			}

			ENUM_POLICY.forEach((onePolicy) => {
				if (hasKey(props, onePolicy.key)) {
					const value = scalar(props[onePolicy.key]);
					if (onePolicy.allowed.indexOf(value) === -1) {
						out.push({
							code: 'N5_badEnum',
							element: idOf(node),
							detail: `node property '${onePolicy.key}'='${value}' is not a valid ${onePolicy.name}`,
						});
					}
				}
			});

			return out;
		};

		// ----- validateEdge(edge) -> [violations]
		const edgeId = (edge) =>
			`${edge.fromRef ? edge.fromRef.id : '?'}-[${edge.type}]->${edge.toRef ? edge.toRef.id : '?'}`;
		const validateEdge = (edge) => {
			const out = [];
			const props = edge.properties || {};

			if (!isValidEdgeType(edge.type)) {
				out.push({
					code: 'E1_invalidEdgeType',
					element: edgeId(edge),
					detail: `edge type '${edge.type}' is not a valid relationship identifier`,
				});
			}

			const tierKey = REQUIRED_PROPERTIES.EDGE[0]; // 'provenanceTier'
			if (!hasKey(props, tierKey)) {
				out.push({
					code: 'E2_missingProvenanceTier',
					element: edgeId(edge),
					detail: `edge missing required '${tierKey}'`,
				});
			} else {
				const tier = scalar(props[tierKey]);
				if (PROVENANCE_TIERS.indexOf(tier) === -1) {
					out.push({
						code: 'E2_badProvenanceTier',
						element: edgeId(edge),
						detail: `edge '${tierKey}'='${tier}' is not a valid provenance tier`,
					});
				}
			}

			ENUM_POLICY.forEach((onePolicy) => {
				if (hasKey(props, onePolicy.key)) {
					const value = scalar(props[onePolicy.key]);
					if (onePolicy.allowed.indexOf(value) === -1) {
						out.push({
							code: 'E3_badEnum',
							element: edgeId(edge),
							detail: `edge property '${onePolicy.key}'='${value}' is not a valid ${onePolicy.name}`,
						});
					}
				}
			});

			return out;
		};

		// ----- validateBlock({ nodes, edges }) -> { ok, violations, counts }. The deserialized-block shape
		//   (replay-block.deserializeBlock returns { header, nodes, edges }).
		const validateBlock = ({ nodes = [], edges = [] } = {}) => {
			const violations = [];
			nodes.forEach((oneNode) => {
				validateNode(oneNode).forEach((oneV) => violations.push(oneV));
			});
			edges.forEach((oneEdge) => {
				validateEdge(oneEdge).forEach((oneV) => violations.push(oneV));
			});
			return {
				ok: violations.length === 0,
				violations,
				counts: { nodes: nodes.length, edges: edges.length, violations: violations.length },
			};
		};

		return { validateBlock, validateNode, validateEdge };
	};

module.exports = moduleFunction({ moduleName });
