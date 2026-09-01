'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// schema-view-finisher.js — registry member 1, mode 'emit' (graphSelfDoc, 2026-08-31).
//
// Emits the VOCABULARY REGISTRY MATERIALIZED IN-GRAPH: one root node plus one member per registry term,
// each carrying its HUMAN DEFINITION, so a consumer holding nothing but a bolt connection can learn what
// this graph's labels, edge types, tiers, predicates, roles, shapes and property contracts MEAN before
// using them. Code is truth; this is its queryable projection, regenerated every build.
//
// THIS MODULE OWNS THE ENUMERATION. buildMembers() is the SINGLE list of what the schema view contains,
// and the Phase 0 definition-completeness gate CONSUMES it rather than mirroring it — GRANITE_ECHO made
// that binding for Phase 1, and the reason is the campaign's founding defect: FINDING 0-A was two lists
// that drifted (the registry grew; the definitions grew into a bucket the enumerator did not read), and
// answering it with a second enumeration would have rebuilt the defect while fixing its symptom.
//
// THE REFUSAL. A term with no human definition REFUSES the phase, naming every offender as kind:value.
// The readability bar is that a term SAYS WHAT IT MEANS — a member reading `name == value` documents
// nothing. That promise has been in vocabulary-definitions.js's header all along and was UNENFORCED for
// the whole life of the recreation, because the finisher that enforces it was never ported. THE FIRST
// THING PORTING AN ENFORCEMENT DOES IS REFUSE ON THE DEBT THAT ACCUMULATED WHILE IT WAS ABSENT: on
// 2026-08-31 its first run named four pre-existing undefined terms, closed under ruling before this file
// existed. Expect the pattern at every finisher this campaign ports.
//
// MODE 'emit' — IT WRITES NOTHING. It returns { nodes, edges, summary }; the registry walker assembles a
// contiguous emit batch and the verb writes it through the shared writeShapedGraph path. Every node it
// emits carries :ForgedNode and a stableId (engine guards 1 and 2) and every edge carries a
// provenanceTier (guard 3), so this material passes all three natively — Channel A by construction, not
// by exemption.
//
// DETERMINISM: a pure function of the frozen registry. No clock, no randomness, no store, no graph read.
// Members are emitted sorted by stableId so twin builds produce identical bytes.
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const {
			NODE_LABELS,
			EQUIVALENCE_NODE_LABELS,
			SCHEMA_VIEW,
			SELF_DOC,
			GRAPH_META,
			EDGE_TYPES,
			MAPPING_EDGE_TYPES,
			CLASSIFICATION_EDGE_TYPES,
			SKOS_EDGE_TYPES,
			HUB_DECOMPOSITION_EDGE_TYPES,
			IN_HUB_EDGE_TYPE,
			PROVENANCE_TIERS,
			SKOS_PREDICATES,
			SSSOM_JUSTIFICATIONS,
			DME_ROLES,
			REFERENCE_TIERS,
			RANGE_SHAPES,
			HUB_DECOMPOSITION_SLOTS,
			REQUIRED_PROPERTIES,
			UNIQUENESS_KEYS,
			TERM_DEFINITIONS,
		} = vocabulary;

		const KINDS = SCHEMA_VIEW.KINDS;
		const viewLabel = SCHEMA_VIEW.LABEL;
		const forgedLabel = NODE_LABELS.FORGED_NODE;
		const metaLabel = GRAPH_META.LABEL;
		const edgeType = SCHEMA_VIEW.EDGE_TYPE;
		const viewTier = SCHEMA_VIEW.PROVENANCE_TIER;
		const rootStableId = SCHEMA_VIEW.ROOT_STABLE_ID;

		const uniq = (oneList) =>
			oneList.filter((oneValue, onePosition) => oneList.indexOf(oneValue) === onePosition);
		const valuesOf = (oneObject) => Object.keys(oneObject).map((oneKey) => oneObject[oneKey]);
		const asArray = (oneValue) => (Array.isArray(oneValue) ? oneValue : [oneValue]);

		// ----- buildMembers — THE enumeration. Returns { members, missingDefinitions }. Each member is
		//   { stableId, kind, value, name, description, properties? }. The view is SELF-DESCRIBING: its own
		//   label and edge type are folded into the nodeLabel/edgeType enumerations, so the catalog
		//   documents the catalog.
		//
		//   NOTE on what is NOT enumerated: the five HAS_CEDS_* edge types. Phase 2c deleted the
		//   CEDS_HUB_EDGE_TYPES constant (RULING FJ-P2-3) in favour of the hubEdgeType(hub, slot) generator,
		//   so there is no constant to enumerate. Their DEFINITIONS are deliberately KEPT (RULING FJ-P2-1:
		//   "a definition describing a live thing is documentation, not dead weight" — those names are still
		//   stamped on ~94,602 edges each). An orphan definition is therefore EXPECTED here and is not a
		//   defect; only a MISSING definition refuses.
		const buildMembers = () => {
			const members = [];
			const missingDefinitions = [];

			const add = (kind, value, extra = {}) => {
				const description = ((TERM_DEFINITIONS || {})[kind] || {})[value];
				if (typeof description !== 'string' || description.trim() === '') {
					missingDefinitions.push(`${kind}:${value}`);
				}
				members.push({
					// ⟪N7⟫ the prefix is REGISTRY DATA, not a literal retyped here.
					stableId: `${SCHEMA_VIEW.MEMBER_STABLE_ID_PREFIX}${kind}:${value}`,
					kind,
					value: `${value}`,
					name: `${value}`,
					description: description || null,
					...extra,
				});
			};

			uniq([
				...valuesOf(NODE_LABELS),
				...valuesOf(EQUIVALENCE_NODE_LABELS),
				viewLabel,
				...valuesOf(SELF_DOC.NODE_LABELS),
				metaLabel,
			]).forEach((oneLabel) => add(KINDS.NODE_LABEL, oneLabel));

			uniq([
				...valuesOf(EDGE_TYPES),
				...valuesOf(MAPPING_EDGE_TYPES),
				...valuesOf(CLASSIFICATION_EDGE_TYPES),
				...valuesOf(SKOS_EDGE_TYPES),
				...valuesOf(HUB_DECOMPOSITION_EDGE_TYPES),
				IN_HUB_EDGE_TYPE,
				edgeType,
				...valuesOf(SELF_DOC.EDGE_TYPES),
			]).forEach((oneType) => add(KINDS.EDGE_TYPE, oneType));

			PROVENANCE_TIERS.forEach((oneTier) => add(KINDS.PROVENANCE_TIER, oneTier));
			SKOS_PREDICATES.forEach((onePredicate) => add(KINDS.SKOS_PREDICATE, onePredicate));
			SSSOM_JUSTIFICATIONS.forEach((oneJustification) =>
				add(KINDS.SSSOM_JUSTIFICATION, oneJustification),
			);
			valuesOf(DME_ROLES).forEach((oneRole) => add(KINDS.DME_ROLE, oneRole));
			REFERENCE_TIERS.forEach((oneTier) => add(KINDS.REFERENCE_TIER, oneTier));
			RANGE_SHAPES.forEach((oneShape) => add(KINDS.RANGE_SHAPE, oneShape));
			HUB_DECOMPOSITION_SLOTS.forEach((oneSlot) => add(KINDS.TUPLE_SLOT, oneSlot));

			Object.keys(REQUIRED_PROPERTIES).forEach((oneSetName) =>
				add(KINDS.REQUIRED_PROPERTY_SET, oneSetName, {
					properties: asArray(REQUIRED_PROPERTIES[oneSetName]),
				}),
			);
			Object.keys(UNIQUENESS_KEYS).forEach((oneKeyName) =>
				add(KINDS.UNIQUENESS_KEY, oneKeyName, {
					properties: asArray(UNIQUENESS_KEYS[oneKeyName]),
				}),
			);

			// DETERMINISTIC order — sorted by stableId. The fingerprint is order-independent, but a sorted
			// emission keeps construction stable and auditable.
			members.sort((leftMember, rightMember) =>
				leftMember.stableId < rightMember.stableId
					? -1
					: leftMember.stableId > rightMember.stableId
						? 1
						: 0,
			);
			return { members, missingDefinitions };
		};

		// ----- definitionCompletenessRefusal — the gate, as a refusal STRING (the sssomJustificationRefusal
		//   idiom: the boolean is defined by the refusal). NAMES every undefined term as kind:value, because
		//   a refusal that says only "something is undefined" cannot be acted on.
		const definitionCompletenessRefusal = () => {
			const { missingDefinitions } = buildMembers();
			if (missingDefinitions.length === 0) {
				return '';
			}
			return (
				`schema-view-finisher: ${missingDefinitions.length} registry term(s) have NO definition in ` +
				`vocabulary-definitions.js — refusing to emit an undocumented schema view. ` +
				`Undefined: ${missingDefinitions.join(', ')}`
			);
		};

		// ----- emit — mode 'emit'. Returns ENGINE-SHAPED material and writes nothing. Node shape is
		//   { stableId, labels, properties } (replay-engine buildNodeRow reads stableId at top level);
		//   edge shape is { type, fromRef:{id}, toRef:{id}, properties } with the tier on properties.
		const emit = ({ readQuery } = {}, callback) => {
			const refusal = definitionCompletenessRefusal();
			if (refusal) {
				callback(refusal);
				return;
			}

			const { members } = buildMembers();

			// ⟪N1, adversarial review 2026-08-31⟫ EVERY emitted node MUST carry `ref`. replay-engine's
			// buildNodeRow dereferences it unconditionally — `props._source = node.ref.source;
			// props._id = node.ref.id;` (replay-engine.js:110-111) — so a node without one does not get
			// refused, it CRASHES with a TypeError, which is a worse failure than a refusal because it
			// names nothing.
			//
			// AND THE DEEPER POINT, which is why `source` is NULL and not a token: buildNodeRow sets
			// `_source` on EVERYTHING it writes, but a metadata node must carry NO `_source` — that is the
			// entire XOR invariant (`_source` XOR `:GraphMeta`, never both, never neither). A metadata node
			// written with a real `_source` would be a both-sides violation the moment graphMeta stamps it.
			// Cypher's `SET n += {…}` REMOVES a property whose value is null rather than storing null, which
			// is what makes a null source the honest expression of "computed by the build, parsed from
			// nothing". THAT REMOVAL SEMANTIC IS MEASURED, NOT ASSUMED — see the DEVLOG's Phase 1
			// measurement batch; if it stores null instead of removing, Channel A cannot satisfy the XOR
			// through writeShapedGraph and the design needs GRANITE_ECHO's ruling, not a workaround here.
			const metadataRef = (oneStableId) => ({ source: null, id: oneStableId });

			const rootNode = {
				stableId: rootStableId,
				ref: metadataRef(rootStableId),
				labels: [forgedLabel, viewLabel],
				properties: {
					stableId: rootStableId,
					kind: 'schemaViewRoot',
					value: 'root',
					name: 'educoreForge schema view (generated from the vocabulary registry)',
					description:
						'The generated in-graph catalog of the vocabulary registry: one member node per schema term (labels, edge types, tiers, predicates, roles, shapes, slots, property contracts), each carrying its human definition. Regenerated every build; code is truth.',
				},
			};

			const memberNodes = members.map((oneMember) => ({
				stableId: oneMember.stableId,
				ref: metadataRef(oneMember.stableId),
				labels: [forgedLabel, viewLabel],
				properties: {
					stableId: oneMember.stableId,
					kind: oneMember.kind,
					value: oneMember.value,
					name: oneMember.name,
					description: oneMember.description,
					...(oneMember.properties ? { properties: oneMember.properties } : {}),
				},
			}));

			const memberEdges = members.map((oneMember) => ({
				type: edgeType,
				fromRef: { id: rootStableId },
				toRef: { id: oneMember.stableId },
				properties: { provenanceTier: viewTier },
			}));

			callback('', {
				nodes: [rootNode].concat(memberNodes),
				edges: memberEdges,
				summary: `schema view: ${memberNodes.length + 1} node(s) (1 root + ${memberNodes.length} term(s)), ${memberEdges.length} ${edgeType} edge(s)`,
				memberCount: memberNodes.length,
				rootStableId,
			});
		};

		return {
			emit,
			// exposed as THE enumeration of record: the Phase 0 completeness gate consumes these rather than
			// mirroring them, so the gate and the finisher cannot enumerate different sets.
			buildMembers,
			definitionCompletenessRefusal,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
