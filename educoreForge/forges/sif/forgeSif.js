'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSif.js — the SIF forge bundle. Parses the SIF Implementation Specification TSV and emits the
// UNIVERSAL FORGE PROPERTY CONTRACT (DESIGN §A-§F, DECISIONS §6-§12, §23-R3/R4) — the SAME contract
// forge-ceds emits, so SIF lands in golden interoperably.
//
// HARVESTED+ADAPTED from trackA forge-sif-tsv (lib/parser.js reused VERBATIM as the harvest source;
// node-shaping rewritten here):
//   * trackA emitted private Sif* nodes (SifObject/SifField/SifComplexType/SifCodeset/SifSimpleType/
//     SifPrimitiveType/SifXmlElement) with hand-rolled searchText and native edges (HAS_FIELD,
//     CONSTRAINED_BY, MEMBER_OF, USES_COMPLEX_TYPE, CONTAINS, HAS_TYPE, REALIZED_BY, ...).
//   * THIS module maps each native node to one of the six canonical Dme* roles (ruling STEEL_WHEEL
//     2026-06-22): SifObject + SifComplexType -> DmeClass; SifField -> DmeProperty; SifCodeset ->
//     DmeOptionSet; codeset values (a native array property) are EXPANDED into DmeOptionValue nodes;
//     SifSimpleType/SifPrimitiveType/SifXmlElement -> DmeSupport. It builds searchText via the ONE
//     shared 1C builder (structural context only), assigns deterministic synthetic stableIds
//     (sif:<kind>/<naturalKey>; SIF RefId is instance-level, so a path-based key — confirmed with
//     STEEL_WHEEL), canonicalizes the native 'CEDS ID' annotation to cedsId='P######' (the property
//     the generic -specified bridge resolves on) + captures it raw in crossRefs JSON, and writes the
//     canonical ownership edges (HAS_CLASS/HAS_PROPERTY/HAS_OPTION_SET/HAS_VALUE/HAS_SUPPORT) plus
//     translated internal edges (REFERENCES), all stamped provenanceTier 'structural'.
//
// PURITY (DESIGN "forge is PURE/deterministic for (source, module)"): buildContractGraph is a PURE,
// synchronous, deterministic function of the parsed source — same source -> identical nodes/edges
// (modulo embeddings, added in a separate embedNodes pass). forge() runs parse -> buildContractGraph
// -> embedNodes. An R3 normalization miss or empty searchText (R4) THROWS — surfaced as a forge error.
//
// Async style: qtools taskListPlus/pipeRunner; the embedding pass batches via 1C embedTexts. No
// async/await, no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parseSif = require('./lib/parser');
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
// the central SEQUENCE-property authority (design-authority upgrade to the SIF sequence-capture work
// order, 2026-07-30): stamps sequenceOrdinal/siblingCount/orderSemantics uniformly, ADDITIVE only.
// SIF is the FIRST caller — see the SEQUENCE CAPTURE section below for the grounding (file:line) on
// why every group this forge declares is honestly 'document', never 'normative'. Called BEFORE
// finalizeStructuralContract (which must run LAST per its own contract).
const { finalizeSequence } = require(
	path.join(CORE_LIB, 'sequence-contract', 'sequence-contract'),
);

const STANDARD_KEY = 'sif';
const STANDARD_SOURCE = 'SIF'; // === the registry standardName, EXACT (no literals elsewhere, no toLower)
const STANDARD_DISPLAY = 'SIF Implementation Specification';
const STABLE_URI_PROPERTY_NAME = 'sifStableId';
const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload.
const CEDS_ANCHOR_PROPERTY_NAME = 'CEDS ID'; // the native annotation column (origin, recorded for provenance)

// ---- CHARACTERISTICS (Phase 4): SIF's own cardinality-and-obligation statement.
//
// The TSV's Characteristics column is a CLOSED five-value vocabulary. Phase 4 does two distinct
// things with it, and the distinction is the whole point:
//   1. carries the cell VERBATIM as `characteristics` — the SOURCE's statement, which is what
//      closes the 15,458-statement fieldCharacteristics round-trip gap. That property NAME is
//      required, not chosen: lib/roundTripSifCompiler.js reads exactly `characteristics` and
//      lib/roundTripSifCanonical.js maps exactly that name to the fieldCharacteristics predicate.
//   2. DERIVES two structural facts from it, below. Legitimate INTERPRETATION of a stated fact
//      (contrast: inventing an unstated one) — permitted because the verbatim value rides
//      alongside and the derivation is documented here, at the site.
//
// WHY THE 'Mandatory' COLUMN IS NOT ENOUGH (the reason this phase exists): Mandatory is a LOSSY
// projection of Characteristics — it collapses MR->M and OR->O. Without the derivation the graph
// cannot distinguish a single-valued element from a REPEATING COLLECTION anywhere in SIF (1,829
// repeatable and 96 conditional fields). The published XSD renders the R suffix as
// maxOccurs='unbounded': this is cardinality, not annotation.
//
// WHY A TABLE AND NOT A REGEX ON THE 'R' SUFFIX: a regex would silently accept a value the source
// never stated. 'CR' is REAL in the published XSD (2 occurrences; README_ERRATA.md S-1) and occurs
// ZERO times in this export. A table refuses an unlisted value BY NAME and forces a deliberate
// ruling; a regex would quietly invent a meaning for it. No silent default, ever.
//
// WHY THE DERIVED PAIR CANNOT MANUFACTURE AN INVENTION: neither derived name appears in the
// round-trip compiler's FIELD_PROPERTY_NAMES projection, and that compiler builds an explicit
// `RETURN oneNode.<name> AS <name>` list and iterates only that same list — so these properties
// are structurally invisible to the re-emission and can never mint a statement the source did not
// make. Their carrier of record is `characteristics` itself; reading them would re-prove this
// derivation rather than the source.
//
// THE INVENTION PATH, MEASURED RATHER THAN ASSUMED (Phase 4 experiment; both injections reverted
// byte-identically, logs in test/test-artifacts/): leaking a derived name into that projection
// ALONE is INERT — it reads an unused property and mints nothing. Invention needs a SECOND step: a
// mapping in the canonicalizer's GRAPH_FIELD_PREDICATE_REGISTRY. With BOTH steps in place the
// hermetic fixture reported INVENTED = 11, exactly one per field carrying a value, and G-1 fired.
// So G-17 guards the FIRST step as defense in depth, and G-1 is the backstop for the consequence.
// An earlier draft of this comment asserted the projection edit alone was the bug; the experiment
// showed otherwise and the claim is corrected here rather than left approximately true.
//
// PROPERTY NAMES AWAIT RATIFICATION by the campaign supervisor (proposed, unanswered at the time
// of writing; the supervisor was unreachable for 50 minutes and this phase proceeded under an
// announced dead-parent deadline). A rename is confined to this one table and gate G-16/G-17.
const FIELD_CHARACTERISTICS_DERIVATION = Object.freeze({
	O: Object.freeze({ characteristicsRepeatable: false, characteristicsObligation: 'optional' }),
	M: Object.freeze({ characteristicsRepeatable: false, characteristicsObligation: 'mandatory' }),
	MR: Object.freeze({ characteristicsRepeatable: true, characteristicsObligation: 'mandatory' }),
	OR: Object.freeze({ characteristicsRepeatable: true, characteristicsObligation: 'optional' }),
	C: Object.freeze({ characteristicsRepeatable: false, characteristicsObligation: 'conditional' }),
});

// The mappingInstruction fields are DECLARED on the DmeStandardRoot (DECISIONS §12). SIF bridges TO
// the CEDS hub (impliedTargets ['CEDS']); its native CEDS anchor origin is the 'CEDS ID' column.
const sifMappingInstruction = {
	cedsOriginalAnchorPropertyName: [CEDS_ANCHOR_PROPERTY_NAME],
	cedsOptionOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch (ruling 2026-06-22).
const roleSpecByNativeLabel = {
	SifObject: { role: DME_ROLES.CLASS, kind: 'object', perStandardLabel: 'SifObject' },
	SifComplexType: { role: DME_ROLES.CLASS, kind: 'complexType', perStandardLabel: 'SifComplexType' },
	SifField: { role: DME_ROLES.PROPERTY, kind: 'field', perStandardLabel: 'SifField' },
	SifCodeset: { role: DME_ROLES.OPTION_SET, kind: 'codeset', perStandardLabel: 'SifCodeset' },
	SifSimpleType: { role: DME_ROLES.SUPPORT, kind: 'simpleType', perStandardLabel: 'SifSimpleType' },
	SifPrimitiveType: { role: DME_ROLES.SUPPORT, kind: 'primitiveType', perStandardLabel: 'SifPrimitiveType' },
	SifXmlElement: { role: DME_ROLES.SUPPORT, kind: 'xmlElement', perStandardLabel: 'SifXmlElement' },
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
const naturalKeyByKind = {
	object: (props) => props.tableName,
	complexType: (props) => props.name,
	field: (props) => props.xpath,
	codeset: (props) => props.fingerprint,
	simpleType: (props) => props.name,
	primitiveType: (props) => props.name,
	xmlElement: (props) => props.path,
};

// native edge type -> canonical/REFERENCES (all stamped 'structural'). HAS_PROPERTY/HAS_OPTION_SET
// are canonical ownership; the rest are non-ownership internal references (DESIGN §F). Synthesized
// ownership edges (HAS_CLASS/HAS_SUPPORT/HAS_VALUE) are added directly, not via this table.
const edgeTypeTranslation = {
	HAS_FIELD: EDGE_TYPES.HAS_PROPERTY, // object -> field (from the native _parentEdge)
	CONSTRAINED_BY: EDGE_TYPES.HAS_OPTION_SET, // field -> codeset (a property's option set)
	USES_COMPLEX_TYPE: EDGE_TYPES.REFERENCES,
	CONTAINS: EDGE_TYPES.REFERENCES,
	HAS_TYPE: EDGE_TYPES.REFERENCES,
	MEMBER_OF: EDGE_TYPES.REFERENCES,
	HAS_ROOT_ELEMENT: EDGE_TYPES.REFERENCES,
	CHILD_ELEMENT: EDGE_TYPES.REFERENCES,
	TYPED_AS: EDGE_TYPES.REFERENCES,
	REALIZED_BY: EDGE_TYPES.REFERENCES,
	REFERENCES: EDGE_TYPES.REFERENCES,
};

// kinds that the root owns directly (the synthesized HAS_CLASS / HAS_SUPPORT ownership edges).
const ownershipEdgeForKind = {
	object: EDGE_TYPES.HAS_CLASS,
	complexType: EDGE_TYPES.HAS_CLASS,
	simpleType: EDGE_TYPES.HAS_SUPPORT,
	primitiveType: EDGE_TYPES.HAS_SUPPORT,
	xmlElement: EDGE_TYPES.HAS_SUPPORT,
};

// structural depth per role (mirrors the forge-ceds depth convention).
const depthByKind = {
	object: 1,
	complexType: 1,
	field: 2,
	codeset: 2,
	optionValue: 3,
	simpleType: 1,
	primitiveType: 1,
	xmlElement: 1,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;
		const { buildSearchText } = buildSearchTextFactory();

		const ROOT_STABLE_ID = 'sif:root';

		// stableId (and _id, which equals it for SIF — both deterministic from the natural key) for a
		// native node; throws on an empty/unknown key (R3 — never a silent malformed id).
		const stableIdFor = ({ kind, key }) => {
			const result = normalize.buildStableId({ kind, key });
			if (result.error) {
				throw new Error(`forge-sif R3 stableId miss: ${result.error}`);
			}
			if (!normalize.isCleanStableId(result.stableId)) {
				throw new Error(
					`forge-sif: ${kind} produced an unclean stableId '${result.stableId}'`,
				);
			}
			return result.stableId;
		};

		// the searchText element for a role, built from structural context only (DECISIONS §8).
		const searchTextElementFor = ({ role, name, owningName }) => {
			if (role === DME_ROLES.CLASS) {
				return { role, name, standardName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
			}
			if (role === DME_ROLES.PROPERTY) {
				return { role, name, owningClassName: owningName || STANDARD_SOURCE, owningName: owningName || STANDARD_SOURCE };
			}
			if (role === DME_ROLES.OPTION_SET) {
				return { role, name, owningClassName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
			}
			if (role === DME_ROLES.OPTION_VALUE) {
				return { role, name, optionSetName: owningName, owningName, owningClassName: STANDARD_SOURCE };
			}
			// DmeSupport
			return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
		};

		// =====================================================================
		// buildContractGraph — PURE, deterministic. parsed -> { nodes, edges, stats }.
		// =====================================================================
		const buildContractGraph = ({ nodes: nativeNodes, metadata }) => {
			const nodes = [];
			const edges = [];

			// ---- SEQUENCE CAPTURE (Phase A, design-authority upgrade 2026-07-30) ----
			// GROUNDING (code fact, forges/sif/lib/parser.js): the SIF forge's ONLY source is a flattened
			// Implementation-Specification TSV whose columns are Name / Mandatory / Characteristics /
			// Type / Description / XPath / CEDS ID / Format (parser.js:60-72, the literal header row
			// asserted in forges/sif/test/... and visible in the raw asset) — there is NO compositor
			// column recording xs:sequence vs xs:choice anywhere in this source format. The parser only
			// ever sees TSV ROW / XPath order: parser.js:590-593's own comment on `sequenceInParent`
			// ("Source rows ... already arrive in XML-valid order"), and parser.js:638-645's
			// CHILD_ELEMENT `sequence` (an insertion-order Set) are BOTH pure document order, never a
			// verified schema compositor. This forge therefore NEVER stamps orderSemantics 'normative'
			// — it has no way to verify a schema-ordered group — every sibling group below is honestly
			// 'document' (the sequence-contract module refuses any forge that claims otherwise without
			// grounds; SIF has none).
			//
			// TWO DISJOINT sibling-group families, both reconstructed from data the parser ALREADY
			// computed and already carries on the native nodes/edges (no parser.js change needed):
			//   (1) FIELD groups — every SifField belongs to EXACTLY ONE group, OWNER-SCOPED to its
			//       SifObject: fields sharing the SAME immediate XML parent WITHIN THE SAME OBJECT
			//       (their leaf xmlElement's parent-element path, e.g. all of Prefix/FirstName/
			//       MiddleName/LastName under 'Name' inside ONE StudentPersonal record) when the field is
			//       nested; fields with NO intermediate element (direct children of the SifObject) group
			//       by their owning object, same as ever. This is the group Phase B's sibling-context
			//       feature reads. ⟪ADVERSARIAL-REVIEW FIX, 2026-07-30⟫: the nested-group key was
			//       originally keyed on pathSegments ALONE (object-relative by construction — see the
			//       fix comment at the field-group site below), so a shared nested shape reused across
			//       many SifObjects (e.g. 'SIF_Metadata/TimeElements/TimeElement', reused by 136 objects)
			//       silently merged into ONE cross-object group. Fixed by folding the owning object's own
			//       name into the key — see the full grounding + measured numbers at that site.
			//   (2) ELEMENT groups — every non-root SifXmlElement belongs to EXACTLY ONE group: the
			//       children of its own parent xmlElement (native CHILD_ELEMENT edges, already
			//       document-ordered), DELIBERATELY NOT owner-scoped (see the ASYMMETRY note at that
			//       site: an element node is already deduped to ONE per relativePath, so its children ARE
			//       the one merged tree the graph actually contains — unlike a field, which is a distinct
			//       node per object). Root elements (depth 1) are deliberately NOT grouped here: a
			//       depth-1 relativePath (e.g. 'Name') is GLOBAL across the parser's elementMap and can
			//       be the root of MULTIPLE distinct SifObjects with unrelated sibling sets (the same
			//       `isShared` collision structural-contract's own optionSet alignment stays honestly
			//       clear of for multi-owner sets) — forcing a single group there would silently pick a
			//       winner. Nested groups have no such collision: a non-root element's relativePath
			//       determines exactly one parent path by construction.
			const SEQUENCE_ORDER_SEMANTICS_HERE = 'document';
			const fieldGroups = {}; // groupKey -> { orderSemantics, members: [fieldStableId, ...] }
			const elementGroups = {}; // groupKey -> { orderSemantics, members: [elementStableId, ...] }

			// stats surfaced to the caller (counts, not silent): annotated/orphaned cross-refs,
			// field-less complex types (the flag STEEL_WHEEL asked for), expanded option values.
			const stats = {
				crossRefsAnnotated: 0,
				fieldlessComplexTypes: 0,
				optionValuesExpanded: 0,
				// codeset dedup surface (STEEL_WHEEL refinement): SIF codesets are unnamed inline
				// enumerations keyed by value-fingerprint, so value-identical enumerations across
				// different fields MERGE into one DmeOptionSet by design. codesetUnique = the merged
				// node count; codesetAssignments = how many fields point at a codeset. The difference
				// is the dedup/collision factor — surfaced so we can verify the merge is not wrong.
				codesetUnique: 0,
				codesetAssignments: 0,
				danglingEdges: [],
			};

			// PASS 1 — index every native node and resolve its stableId + role. nativeIdToStable maps a
			// native node id (e.g. 'siffield-<xpath>') to { stableId, role, name } for edge resolution.
			const nativeById = {};
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				nativeById[nativeNode.id] = nativeNode;
				if (nativeNode.label === 'SifRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: ROOT_STABLE_ID,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				if (!spec) {
					throw new Error(`forge-sif: unknown native SIF label '${nativeNode.label}'`);
				}
				const key = naturalKeyByKind[spec.kind](nativeNode.properties || {});
				const stableId = stableIdFor({ kind: spec.kind, key });
				nativeIdToStable[nativeNode.id] = {
					stableId,
					role: spec.role,
					name: nativeNode.properties.name,
				};
			});

			// addEdge — canonical/reference edge, stamped structural (DECISIONS §11). Resolves BOTH
			// endpoints to stableIds; an unresolved endpoint is recorded (dangling), never a partial edge.
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
				const searchText = buildSearchText(searchTextElementFor({ role, name, owningName: structural.owningName }));
				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: {
						_id: stableId, // SIF _id === stableId (both deterministic from the natural key)
						_source: STANDARD_SOURCE,
						name: name == null ? '' : `${name}`,
						description: description || '',
						role,
						[STABLE_URI_PROPERTY_NAME]: stableId, // the stable identifier, under stableUriPropertyName
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
			const rootSearchText = buildSearchText({
				role: DME_ROLES.STANDARD_ROOT,
				name: STANDARD_SOURCE,
				standardName: STANDARD_DISPLAY,
			});
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'SifRoot', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${metadata.objectCount} objects, ${metadata.fieldCount} fields`,
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
					mappingInstruction: JSON.stringify(sifMappingInstruction),
				},
			});

			// ---- structural nodes (objects, complexTypes, fields, codesets, support) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'SifRoot') {
					return;
				}
				const spec = roleSpecByNativeLabel[nativeNode.label];
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning class name (for a field's searchText/path) — its native parent object.
				let owningName = STANDARD_SOURCE;
				let parentId = ROOT_STABLE_ID;
				if (spec.kind === 'field' && nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// flag field-less complex types (potential DmeSupport refinement; kept DmeClass per ruling).
				if (spec.kind === 'complexType' && (props.fieldCount || 0) === 0) {
					stats.fieldlessComplexTypes++;
				}

				// CEDS cross-ref (annotated fields only): canonicalize to P###### (R3 — throw on a
				// present-but-unnormalizable annotation) and stamp the resolver property + crossRefs.
				const extraProps = { scalar: {}, crossRefs: [] };
				if (spec.kind === 'field' && props.cedsId != null && `${props.cedsId}`.trim() !== '') {
					const norm = normalize.normalizeCedsCrossRef({ rawValue: props.cedsId });
					if (norm.error) {
						throw new Error(
							`forge-sif R3 CEDS cross-ref miss on field '${props.xpath}': ${norm.error}`,
						);
					}
					extraProps.scalar.cedsId = norm.cedsId; // the property -specified resolves on
					extraProps.scalar.cedsOriginalAnchorPropertyName = [CEDS_ANCHOR_PROPERTY_NAME];
					extraProps.crossRefs = [
						{
							system: 'ceds',
							id: norm.cedsId,
							raw: `${props.cedsId}`,
							locator: CEDS_ANCHOR_PROPERTY_NAME,
						},
					];
					stats.crossRefsAnnotated++;
				}

				// a few faithful native scalars worth keeping queryable on the node.
				if (props.xpath) extraProps.scalar.xpath = props.xpath;
				if (props.tableName) extraProps.scalar.tableName = props.tableName;
				if (typeof props.mandatory === 'boolean') extraProps.scalar.mandatory = props.mandatory;
				if (props.category) extraProps.scalar.category = props.category;
				// the native XSD value type + format annotation (parser.js fieldProps.nativeType/format;
				// see that file's own comment) — a real "value-ish hint" signal for a consumer comparing
				// this field against a CEDS candidate's range slot (e.g. the SIF evidence bridge).
				if (props.nativeType) extraProps.scalar.nativeType = props.nativeType;
				if (props.format) extraProps.scalar.format = props.format;

				// ---- CHARACTERISTICS (Phase 4) — see FIELD_CHARACTERISTICS_DERIVATION at the top of
				// this file for the full rationale. The verbatim carry is what closes the round trip;
				// the derived pair is documented interpretation that rides alongside it.
				//
				// ABSENT IS ABSENT (RT-2), BY CONSTRUCTION: lib/parser.js trims the cell to '', so a
				// field whose Characteristics cell is empty falls through this guard carrying NOTHING —
				// not the verbatim value, and NOT a derived default. Emitting repeatable:false here
				// would assert "does not repeat" where the source is SILENT, which is the silent-default
				// class. The canonicalizer's graph-side mint skips ''/null/undefined for the same reason,
				// so the two sides are symmetric.
				if (props.characteristics) {
					extraProps.scalar.characteristics = props.characteristics;

					const derivedCharacteristics = FIELD_CHARACTERISTICS_DERIVATION[props.characteristics];
					if (!derivedCharacteristics) {
						throw new Error(
							`forge-sif: field '${props.xpath}' states Characteristics ` +
								`'${props.characteristics}', which is not in SIF's closed vocabulary ` +
								`(${Object.keys(FIELD_CHARACTERISTICS_DERIVATION).join('/')}) — refusing to derive ` +
								`repeatability or obligation from a value this forge does not understand. If the ` +
								`snapshot legitimately introduced a new value (e.g. 'CR', recorded in ` +
								`README_ERRATA.md S-1 as present in the published XSD and absent from this export), ` +
								`extend FIELD_CHARACTERISTICS_DERIVATION deliberately and have the addition ruled ` +
								`on — never defaulted.`,
						);
					}

					// A FUNCTION OF THIS COLUMN ALONE. It never consults the Mandatory column, which is
					// why the source's own subtlety survives instead of being flattened: the nine 'C'
					// rows that ALSO carry a mandatory '*' (README_ERRATA.md S-2 — members of an
					// xs:choice group that is itself required) keep obligation 'conditional' AND
					// mandatory true, side by side, exactly as the source states both. The apparent
					// tension is deliberately NOT reconciled here, and no choice-group concept is
					// invented, because the flattened export does not state one — the grouping is
					// inferable only from row adjacency, which is an inference, not a source fact.
					extraProps.scalar.characteristicsRepeatable = derivedCharacteristics.characteristicsRepeatable;
					extraProps.scalar.characteristicsObligation = derivedCharacteristics.characteristicsObligation;
				}

				// ---- SEQUENCE CAPTURE (Phase A) — FIELD groups. Every SifField belongs to EXACTLY ONE
				// group: nested under its leaf xmlElement's parent-element path (props.pathSegments, when
				// present) or, for a field with no intermediate element, at the root of its owning
				// SifObject. sequenceGroupKey/sequenceGroupLabel are SIF-local scalars (not part of the
				// canonical sequence-contract vocabulary) so Phase B's bridge can read a human-legible
				// group name without a graph walk.
				//
				// ⟪ADVERSARIAL-REVIEW FIX, 2026-07-30⟫ — the group key MUST be owner-scoped.
				// props.pathSegments is the xpath with the owning SifObject's own two path segments
				// ALREADY STRIPPED (parser.js's field.pathSegments = xpathParts.slice(3, -1), relative to
				// the object), so a SHARED nested shape (e.g. 'SIF_Metadata/TimeElements/TimeElement',
				// reused by 136 different SifObjects) collided into ONE cross-object group keyed on
				// pathSegments alone — 268 of 1,873 field groups merged, 10,933 of 15,620 fields (70%)
				// sat in a merged group, worst case 952 members from 136 objects (measured against the
				// real asset). owningName (the owning SifObject's own singular name, already resolved
				// above) is folded into the key so the group is scoped to ONE object's TSV rows, which
				// are contiguous for one parent within that object — per-owner ordinals are then correct
				// by construction. The root-field key form was ALREADY owner-scoped (props.tableName is
				// always undefined on a field node, so it always fell through to owningName) and is
				// unchanged.
				if (spec.kind === 'field') {
					const hasParentElement = !!props.pathSegments;
					const groupKey = hasParentElement
						? `sif:fieldGroup:${owningName}:${props.pathSegments}`
						: `sif:fieldGroup:root:${props.tableName || owningName}`;
					const groupLabel = hasParentElement ? props.pathSegments.split('/').pop() : owningName;
					extraProps.scalar.sequenceGroupKey = groupKey;
					extraProps.scalar.sequenceGroupLabel = groupLabel;
					(fieldGroups[groupKey] =
						fieldGroups[groupKey] || { orderSemantics: SEQUENCE_ORDER_SEMANTICS_HERE, members: [] }
					).members.push(self.stableId);
				}

				// ---- SEQUENCE CAPTURE (Phase A) — ELEMENT groups. A non-root SifXmlElement's CHILD
				// elements are already document-ordered on its OWN native CHILD_ELEMENT edges
				// (parser.js:638-645); one group per parent, computed in one shot from those edges.
				// ASYMMETRY, noted deliberately (adversarial review, 2026-07-30): element groups are NOT
				// owner-scoped the way field groups now are, and that is correct, not an oversight — a
				// SifXmlElement is ALREADY deduped to ONE node per relativePath (elementMap is global in
				// the parser; isShared marks exactly this), so its children ARE the one merged tree the
				// forged graph actually contains. A field, by contrast, is a distinct node PER OBJECT
				// even when it shares a relativePath with fields in other objects — grouping it at the
				// element's merged scope would misrepresent a per-document position as a standard-wide
				// one (the defect this fix corrects). Element-level siblingCount can therefore
				// legitimately exceed what any single document instance shows; field-level siblingCount
				// must not.
				if (spec.kind === 'xmlElement' && Array.isArray(nativeNode.edges) && nativeNode.edges.length) {
					const childEdges = nativeNode.edges
						.filter((oneEdge) => oneEdge.type === 'CHILD_ELEMENT')
						.slice()
						.sort((a, b) => (a.properties && a.properties.sequence) - (b.properties && b.properties.sequence));
					if (childEdges.length) {
						const members = childEdges
							.map((oneEdge) => nativeIdToStable[oneEdge.targetId])
							.filter(Boolean)
							.map((oneRef) => oneRef.stableId);
						if (members.length) {
							elementGroups[`sif:elementGroup:${props.path}`] = {
								orderSemantics: SEQUENCE_ORDER_SEMANTICS_HERE,
								members,
							};
						}
					}
				}

				const pathLabel =
					spec.kind === 'field' ? `${owningName}.${props.name}` : `${props.name}`;

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

				// synthesized ownership edge from the root (HAS_CLASS / HAS_SUPPORT).
				const ownershipType = ownershipEdgeForKind[spec.kind];
				if (ownershipType) {
					addEdge(ownershipType, ROOT_STABLE_ID, self.stableId, `root->${spec.kind}`);
				}

				if (spec.kind === 'codeset') {
					stats.codesetUnique++;
				}

				// ---- EXPAND codeset values into DmeOptionValue nodes + HAS_VALUE edges ----
				if (spec.kind === 'codeset' && Array.isArray(props.values)) {
					const setName = props.name;
					props.values.forEach((rawValue) => {
						const value = `${rawValue}`;
						const valueStableId = stableIdFor({
							kind: 'optionValue',
							key: `${props.fingerprint}/${value}`,
						});
						makeNode({
							role: DME_ROLES.OPTION_VALUE,
							perStandardLabel: 'SifCodesetValue',
							stableId: valueStableId,
							name: value,
							description: '',
							structural: {
								parentId: self.stableId,
								depth: depthByKind.optionValue,
								path: `${setName}.${value}`,
								owningName: setName,
							},
							extraProps: { scalar: {}, crossRefs: [] },
						});
						addEdge(EDGE_TYPES.HAS_VALUE, self.stableId, valueStableId, 'codeset->value');
						stats.optionValuesExpanded++;
					});
				}
			});

			// ---- SEQUENCE CAPTURE (Phase A) — stamp sequenceOrdinal/siblingCount/orderSemantics via
			// the shared sequence-contract module, over EVERY field group + element group collected
			// above. Callback-shaped (R7); this module is pure/synchronous so the callback resolves on
			// the same tick — converted to a throw here to match this function's own house style
			// (buildContractGraph throws; forge()'s ONE sanctioned try/catch, further below, is the
			// boundary that translates it to an error string, exactly as it already does for R3/R4).
			const sequenceOrderingByParent = { ...fieldGroups, ...elementGroups };
			let sequenceError = '';
			finalizeSequence({ nodes, orderingByParent: sequenceOrderingByParent }, (err) => {
				sequenceError = err;
			});
			if (sequenceError) {
				throw new Error(`forge-sif sequence capture: ${sequenceError}`);
			}

			// ---- translate native edges (the source node's own .edges and the field _parentEdge) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}
				// the field's HAS_FIELD reverse edge (object -> field) becomes HAS_PROPERTY.
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const canonical = edgeTypeTranslation[nativeNode._parentEdge.type];
					addEdge(
						canonical || EDGE_TYPES.REFERENCES,
						owner && owner.stableId,
						self.stableId,
						`${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`,
					);
				}
				// the node's outgoing native edges.
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					const canonical = edgeTypeTranslation[nativeEdge.type];
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						stats.codesetAssignments++;
					}
					if (!canonical) {
						throw new Error(
							`forge-sif: untranslated native edge type '${nativeEdge.type}' (${nativeNode.id} -> ${nativeEdge.targetId})`,
						);
					}
					addEdge(
						canonical,
						self.stableId,
						target && target.stableId,
						`${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`,
					);
				});
			});

			if (stats.danglingEdges.length > 0) {
				throw new Error(
					`forge-sif: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint (first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
				);
			}

			// the shared contract finalizer (M7/M8): parentId referent enforced, depth derived
			// (= chain length; supersedes the per-role stamps above), crossRefs universal,
			// single-owner optionSets re-parented to their owning property. Throws loudly.
			finalizeStructuralContract({ nodes, edges });
			return { nodes, edges, stats };
		};

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts). Mirrors forge-ceds: stamps embedding +
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
						callback(`forge-sif embedNodes batch ${bi} failed: ${err}`);
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
							`[forge-sif] embedded batch ${bi}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate parse -> buildContractGraph -> embedNodes. Mirrors forge-ceds.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding, resolutionMapPath } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				parseSif(sourcePath, { resolutionMapPath }, (err, parsed) => {
					if (err) {
						next(`forge-sif parse: ${err}`);
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
					next(`forge-sif buildContractGraph: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-sif] contract graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
						`(${graph.stats.crossRefsAnnotated} CEDS-annotated fields, ${graph.stats.optionValuesExpanded} option values, ` +
						`${graph.stats.fieldlessComplexTypes} field-less complex types; codesets ${graph.stats.codesetUnique} unique ` +
						`from ${graph.stats.codesetAssignments} field assignments = ${graph.stats.codesetAssignments - graph.stats.codesetUnique} merged)`,
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
					// parseAudit (Phase 1): the parser's formerly-silent paths, counted/recorded.
					// Rides on stats — run diagnostics, digest-EXCLUDED (the block fingerprint
					// covers nodes/edges/metadata only).
					stats: { ...args.graph.stats, parseAudit: args.parsed.parseAudit },
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
