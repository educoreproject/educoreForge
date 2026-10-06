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
			hubEdgeType,
			PASSPORT_FIELD_LIST,
			ATTESTATION_FIELD_LIST,
			MANIFEST_RECIPE_FIELD_LIST,
			RECIPE_BLOCK_FIELD_LIST,
			STANDARD_DEFINITION_FIELD_LIST,
			USAGE_PATTERN_FIELD_LIST,
			LIST_VALUED_PROPERTY_NAME_LIST,
			INTEGER_VALUED_PROPERTY_NAME_LIST,
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
		//   THE HUB EDGE TYPES ARE GENERATED, NOT ENUMERATED (ruling G15, 2026-10-06, keeping RULING FJ-P2-3): there is no
		//   constant of HAS_CEDS_* names to enumerate (Phase 2c deleted it for the hubEdgeType(hub, slot) generator), so a
		//   member is generated per (hub present in the graph, declared slot) — buildMembers({ hubNameList }), the hub names
		//   read by emit from the graph's :HubDefinition. Called with no hubs (the pure completeness gate) it generates none.
		//   Their definitions are the kept HAS_CEDS_* texts (RULING FJ-P2-1), or a generated sentence for a hub that has none.
		//
		//   ⟪campaign P2, W-A-6 / V1-C20⟫ THE CONTRACT IS PROJECTED TOO: one member per declared passport, attestation and
		//   self-doc field (its description the contract row's own meaning), one per list-valued and integer-valued name, and
		//   a nodeLabel member per DME role label (the role definitions describe them), so every live label and edge type is
		//   a member or a declared producer-local pattern — which the schema-view coverage finisher proves at finish.
		const buildMembers = ({ hubNameList = [] } = {}) => {
			const members = [];
			const missingDefinitions = [];

			// add(kind, value, extra, descriptionText) — descriptionText, when given, is the description (the contract rows
			// carry their own meaning); otherwise TERM_DEFINITIONS[kind][value]. Empty either way is a missing definition.
			// extra: { properties?, memberPropertyByName? } — memberPropertyByName lands on the member node as properties.
			const add = (kind, value, extra = {}, descriptionText) => {
				const description = descriptionText !== undefined ? descriptionText : ((TERM_DEFINITIONS || {})[kind] || {})[value];
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

			// ⟪campaign P2, W-A-10⟫ NODE_BY_ROLE_CLASS is a map of lists: each class is its own member, NODE_<class>
			Object.keys(REQUIRED_PROPERTIES).filter((oneSetName) => oneSetName !== 'NODE_BY_ROLE_CLASS').forEach((oneSetName) =>
				add(KINDS.REQUIRED_PROPERTY_SET, oneSetName, {
					properties: asArray(REQUIRED_PROPERTIES[oneSetName]),
				}),
			);
			Object.keys(REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS).forEach((oneClassName) =>
				add(KINDS.REQUIRED_PROPERTY_SET, `NODE_${oneClassName}`, {
					properties: REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS[oneClassName].slice(),
				}),
			);
			Object.keys(UNIQUENESS_KEYS).forEach((oneKeyName) =>
				add(KINDS.UNIQUENESS_KEY, oneKeyName, {
					properties: asArray(UNIQUENESS_KEYS[oneKeyName]),
				}),
			);

			// ⟪G15⟫ the hub edge types, generated per hub present × declared slot
			uniq(hubNameList).forEach((oneHubName) =>
				HUB_DECOMPOSITION_SLOTS.forEach((oneSlot) => {
					const oneType = hubEdgeType(oneHubName, oneSlot);
					add(KINDS.EDGE_TYPE, oneType, {}, (TERM_DEFINITIONS.edgeType || {})[oneType] || `Hub card to the ${oneSlot} node it addresses in the ${oneHubName} hub (generated by hubEdgeType('${oneHubName}', '${oneSlot}')).`);
				}),
			);

			// ⟪W-A-6⟫ the DME role labels (every role is also a label on its nodes) not already enumerated as a node label
			const enumeratedLabelSet = new Set(members.filter((oneMember) => oneMember.kind === KINDS.NODE_LABEL).map((oneMember) => oneMember.value));
			valuesOf(DME_ROLES).filter((oneRole) => !enumeratedLabelSet.has(oneRole)).forEach((oneRole) => add(KINDS.NODE_LABEL, oneRole, {}, (TERM_DEFINITIONS.dmeRole || {})[oneRole]));

			// ⟪W-A-6⟫ the graph contract
			PASSPORT_FIELD_LIST.forEach((oneRow) => add(KINDS.PASSPORT_FIELD, oneRow.name, { memberPropertyByName: { fieldType: oneRow.type, required: oneRow.required, writer: oneRow.writer } }, oneRow.meaning));
			ATTESTATION_FIELD_LIST.forEach((oneRow) => add(KINDS.ATTESTATION_FIELD, oneRow.name, { memberPropertyByName: { fieldType: oneRow.type, channel: oneRow.channel, gateList: (oneRow.gateList || []).slice() } }, oneRow.meaning));
			[['ManifestRecipe', MANIFEST_RECIPE_FIELD_LIST], ['RecipeBlock', RECIPE_BLOCK_FIELD_LIST], ['StandardDefinition', STANDARD_DEFINITION_FIELD_LIST], ['UsagePattern', USAGE_PATTERN_FIELD_LIST]].forEach(([oneLabel, oneFieldList]) =>
				oneFieldList.forEach((oneRow) => add(KINDS.SELF_DOC_FIELD, `${oneLabel}.${oneRow.name}`, { memberPropertyByName: { fieldType: oneRow.type, required: oneRow.required } }, oneRow.meaning)),
			);
			LIST_VALUED_PROPERTY_NAME_LIST.forEach((oneName) => add(KINDS.LIST_VALUED_PROPERTY, oneName, {}, 'Declared list-valued: a list at every length on every node or edge that carries it (graph-contract §1).'));
			INTEGER_VALUED_PROPERTY_NAME_LIST.forEach((oneName) => add(KINDS.INTEGER_VALUED_PROPERTY, oneName, {}, 'Declared INTEGER: written with neo4j.int at replay (graph-contract §2).'));

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
		const HUB_NAME_CYPHER = 'MATCH (h:HubDefinition) RETURN DISTINCT h.hubName AS hubName ORDER BY hubName';
		const emit = ({ readQuery } = {}, callback) => {
			const refusal = definitionCompletenessRefusal();
			if (refusal) {
				callback(refusal);
				return;
			}
			if (typeof readQuery !== 'function') {
				callback(`schema-view-finisher: a readQuery is REQUIRED — the hub edge types are generated from the hubs the graph holds (ruling G15)`);
				return;
			}
			readQuery({ cypher: HUB_NAME_CYPHER }, (hubError, hubResult) => {
				if (hubError) {
					callback(`schema-view-finisher: reading the graph's hubs failed: ${hubError}`);
					return;
				}
				const hubNameList = ((hubResult && hubResult.records) || []).map((oneRecord) => `${oneRecord.get('hubName')}`);
				emitMembers({ hubNameList }, callback);
			});
		};

		const emitMembers = ({ hubNameList }, callback) => {
			const { members } = buildMembers({ hubNameList });

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
					...(oneMember.memberPropertyByName || {}),
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
