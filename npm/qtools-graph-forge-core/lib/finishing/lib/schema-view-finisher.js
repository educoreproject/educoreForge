'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// schema-view-finisher.js — the FINISHER that emits the self-describing in-graph SCHEMA VIEW (SPEC §3.3).
// It is a READ-ONLY generated projection of the vocabulary registry: one root node plus one member node per
// registry term (enum member / required-property-set / uniqueness-key), linked root -> member by
// HAS_SCHEMA_TERM. Consumers (askMilo, the resolve verb, doc generators) can QUERY the graph to introspect
// the schema — "code is truth; the in-graph copy is regenerated each build" (never authored in place).
//
// MODEL (confirmed WILD_FALCON):
//   - every node carries :ForgedNode (the view is DETERMINISTIC generated content -> belongs in fingerprint
//     scope, unlike the non-deterministic :GraphProvenance passport) PLUS :SchemaView (queryable, compound).
//   - enum-member-PER-NODE (NOT a JSON blob) so the view is queryable.
//   - member stableId = `schemaView:<kind>:<value>`; the root = SCHEMA_VIEW.ROOT_STABLE_ID.
//   - root -> member edge type HAS_SCHEMA_TERM, provenanceTier 'structural' (so every (:ForgedNode)-[r]->
//     (:ForgedNode) edge still carries a provenanceTier -> provenanceTierComplete stays true).
//   - SELF-DESCRIBING: the view's own label (:SchemaView) and edge type (HAS_SCHEMA_TERM) are themselves
//     registered in the registry (vocabulary.SCHEMA_VIEW) and ENUMERATED here, so the view describes itself.
//
// DETERMINISM: members are built from the frozen registry and SORTED by stableId before emission; MERGE is
// idempotent; no clock/randomness. Two builds against the same registry produce byte-identical view content.
//
// Runs BEFORE the schema-constraint finisher (registry order) so the uniqueness constraints cover the view
// nodes too. Emitted BEFORE ownerStamp+stampProvenance (graph-builder) so the view nodes are owner-stamped
// and counted in the passport automatically.
//
// Async style: qtools taskListPlus/pipeRunner; cypher at the leaf via the injected lifecycle. No async/await,
// no try/catch-for-control-flow. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle, vocabulary } = {}) => {
		const { xLog } = process.global;

		const {
			SCHEMA_VIEW,
			NODE_LABELS,
			EQUIVALENCE_NODE_LABELS,
			EDGE_TYPES,
			MAPPING_EDGE_TYPES,
			CLASSIFICATION_EDGE_TYPES,
			SKOS_EDGE_TYPES,
			HUB_DECOMPOSITION_EDGE_TYPES,
			CEDS_HUB_EDGE_TYPES,
			IN_HUB_EDGE_TYPE,
			PROVENANCE_TIERS,
			SKOS_PREDICATES,
			SSSOM_JUSTIFICATIONS,
			DME_ROLES,
			REFERENCE_TIERS,
			REQUIRED_PROPERTIES,
			UNIQUENESS_KEYS,
			RANGE_SHAPES,
			HUB_DECOMPOSITION_SLOTS,
			SELF_DOC,
			GRAPH_META,
			TERM_DEFINITIONS,
		} = vocabulary;

		const KINDS = SCHEMA_VIEW.KINDS;
		const uniq = (oneList) => [...new Set(oneList)];
		const asArray = (oneVal) => (Array.isArray(oneVal) ? oneVal : [oneVal]);

		// ----- buildMembers — derive the COMPLETE, deterministic member set from the registry. Each member is
		//   { stableId, kind, value, name, description, properties? }. SELF-DESCRIBING: the view's own label +
		//   edge type are folded into the nodeLabel / edgeType enumerations. Wave B readability bar: every
		//   member carries the human description from TERM_DEFINITIONS; a term with NO definition is collected
		//   into missingDefinitions and REFUSED by finish() — adding a registry term REQUIRES its definition.
		const buildMembers = () => {
			const members = [];
			const missingDefinitions = [];
			const add = (kind, value, extra = {}) => {
				const description = ((TERM_DEFINITIONS || {})[kind] || {})[value];
				if (!description) {
					missingDefinitions.push(`${kind}:${value}`);
				}
				members.push({
					stableId: `schemaView:${kind}:${value}`,
					kind,
					value: `${value}`,
					name: `${value}`,
					description: description || null,
					...extra,
				});
			};

			// node labels — the UNIVERSAL registry labels (NOT per-standard labels, which are producer-local),
			// including the view's own :SchemaView (self-describing) and the Wave-B self-doc/meta labels.
			uniq([
				...Object.values(NODE_LABELS),
				...Object.values(EQUIVALENCE_NODE_LABELS),
				SCHEMA_VIEW.LABEL,
				...Object.values(SELF_DOC.NODE_LABELS),
				GRAPH_META.LABEL,
			]).forEach((oneLabel) => add(KINDS.NODE_LABEL, oneLabel));

			// edge types — every structural/mapping/equivalence/decomposition edge type the registry declares,
			// including the view's own HAS_SCHEMA_TERM (self-describing) and the Wave-B self-doc edges.
			uniq([
				...Object.values(EDGE_TYPES),
				...Object.values(MAPPING_EDGE_TYPES),
				...Object.values(CLASSIFICATION_EDGE_TYPES),
				...Object.values(SKOS_EDGE_TYPES),
				...Object.values(HUB_DECOMPOSITION_EDGE_TYPES),
				...Object.values(CEDS_HUB_EDGE_TYPES),
				IN_HUB_EDGE_TYPE,
				SCHEMA_VIEW.EDGE_TYPE,
				...Object.values(SELF_DOC.EDGE_TYPES),
			]).forEach((oneType) => add(KINDS.EDGE_TYPE, oneType));

			// enums
			PROVENANCE_TIERS.forEach((oneTier) => add(KINDS.PROVENANCE_TIER, oneTier));
			SKOS_PREDICATES.forEach((oneP) => add(KINDS.SKOS_PREDICATE, oneP));
			SSSOM_JUSTIFICATIONS.forEach((oneJ) => add(KINDS.SSSOM_JUSTIFICATION, oneJ));
			Object.values(DME_ROLES).forEach((oneRole) => add(KINDS.DME_ROLE, oneRole));
			REFERENCE_TIERS.forEach((oneTier) => add(KINDS.REFERENCE_TIER, oneTier));
			// Wave B: the range shapes + hub tuple slots — the addressing model documents itself.
			RANGE_SHAPES.forEach((oneShape) => add(KINDS.RANGE_SHAPE, oneShape));
			HUB_DECOMPOSITION_SLOTS.forEach((oneSlot) => add(KINDS.TUPLE_SLOT, oneSlot));

			// required-property SETS — one member per set, carrying the set's property list (deterministic).
			Object.keys(REQUIRED_PROPERTIES).forEach((oneSetName) =>
				add(KINDS.REQUIRED_PROPERTY_SET, oneSetName, {
					properties: asArray(REQUIRED_PROPERTIES[oneSetName]),
				}),
			);

			// uniqueness KEYS — one member per key, carrying the key's property list.
			Object.keys(UNIQUENESS_KEYS).forEach((oneKeyName) =>
				add(KINDS.UNIQUENESS_KEY, oneKeyName, {
					properties: asArray(UNIQUENESS_KEYS[oneKeyName]),
				}),
			);

			// DETERMINISTIC order — sort by stableId (the unique key). The fingerprint is order-independent,
			// but a sorted emission keeps construction stable + auditable (WILD_FALCON).
			members.sort((a, b) => (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0));
			return { members, missingDefinitions };
		};

		// ----- finish — MERGE the root + all members + HAS_SCHEMA_TERM edges in one parameterized pass.
		//   Labels/edge-type are constants (cannot be parameterized) sourced from the frozen registry. props
		//   travel as a parameter list (injection-safe). The view edges carry provenanceTier 'structural'.
		const finish = ({ graphName } = {}, callback) => {
			const { members, missingDefinitions } = buildMembers();
			const rootStableId = SCHEMA_VIEW.ROOT_STABLE_ID;
			const viewTier = SCHEMA_VIEW.PROVENANCE_TIER;
			const viewLabel = SCHEMA_VIEW.LABEL; // 'SchemaView'
			const edgeType = SCHEMA_VIEW.EDGE_TYPE; // 'HAS_SCHEMA_TERM'

			// Wave B finisher validator (the plan's readability gate): a registry term with no human
			// definition REFUSES the build loudly — never emit a name==value term.
			if (missingDefinitions.length) {
				callback(
					`schema-view-finisher: ${missingDefinitions.length} registry term(s) have NO definition in ` +
						`vocabulary-definitions.js — refusing to emit an undocumented schema view. ` +
						`Missing: ${missingDefinitions.join(', ')}`,
				);
				return;
			}

			const taskList = new taskListPlus();

			// 1) MERGE the single root node.
			taskList.push((args, next) => {
				const cypher = `MERGE (root:ForgedNode:\`${viewLabel}\` { stableId: $rootStableId })
					SET root.kind = 'schemaViewRoot', root.value = 'root',
						root.name = 'educoreForge schema view (generated from the vocabulary registry)',
						root.description = 'The generated in-graph catalog of the vocabulary registry: one member node per schema term (labels, edge types, tiers, predicates, roles, shapes, slots, property contracts), each carrying its human definition. Regenerated every build; code is truth.'
					RETURN root.stableId AS id`;
				lifecycle.runCypher({ graphName, cypher, params: { rootStableId } }, (err) => {
					if (err) {
						next(`schema-view-finisher: root MERGE failed: ${err}`);
						return;
					}
					next('', args);
				});
			});

			// 2) MERGE every member + its root->member HAS_SCHEMA_TERM edge (provenanceTier='structural').
			taskList.push((args, next) => {
				const cypher = `MATCH (root:\`${viewLabel}\` { stableId: $rootStableId })
					UNWIND $members AS member
					MERGE (m:ForgedNode:\`${viewLabel}\` { stableId: member.stableId })
						SET m.kind = member.kind, m.value = member.value, m.name = member.name,
							m.description = member.description,
							m.properties = member.properties
					MERGE (root)-[e:\`${edgeType}\`]->(m)
						SET e.provenanceTier = $viewTier
					RETURN count(m) AS memberCount`;
				lifecycle.runCypher(
					{ graphName, cypher, params: { rootStableId, members, viewTier } },
					(err, result) => {
						if (err) {
							next(`schema-view-finisher: member emission failed: ${err}`);
							return;
						}
						next('', {
							...args,
							memberCount: Number(result.records[0].memberCount),
						});
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const nodeCount = args.memberCount + 1; // members + root
				callback('', {
					summary: `schema view: ${nodeCount} node(s) (1 root + ${args.memberCount} term(s)), ${args.memberCount} ${edgeType} edge(s)`,
					rootStableId,
					memberCount: args.memberCount,
					nodeCount,
					edgeCount: args.memberCount,
				});
			});
		};

		return { finish, buildMembers };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
