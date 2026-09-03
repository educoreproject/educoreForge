'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSifContractGraph.js — H3, the SIF walk, on the Forge Framework's kit
// (SPEC-forgeFramework-v1.md §5, §6.2; hub-kit-role Phase 3). Migrated from forgeSif.js:230-689,
// which was a bespoke buildContractGraph that minted its own nodes and edges. The FRAMEWORK now
// owns the pipeline, the root, the universal property set, the embed pass, the integrity pass and
// the finalizers; this file owns only what is SIF's: which entities exist, how they are addressed,
// what they own, and which sibling groups carry document order.
//
// WHAT THIS FILE DELIBERATELY NO LONGER DOES, because the framework does it:
//   * mint the DmeStandardRoot          — rootNode.js, from sifForgeDeclaration (rootStableIdFrom
//                                         'declared', rootStableId 'sif:root')
//   * stamp _id / _source / role / sifStableId / searchText / parentId / path — kit.makeNode
//   * stamp provenanceTier on every edge — kit.addEdge
//   * call finalizeSequence              — forge-framework.js step 5, from the sequenceGroups this
//                                         walk RETURNS. Its own comment names the ordering reason:
//                                         "BEFORE the structural finalizer (SIF's order)".
//   * call finalizeStructuralContract    — forge-framework.js step 6, still LAST over structure
//   * refuse dangling edges              — the kit RECORDS a falsy endpoint and the framework
//                                         refuses ONCE at the end of the pure layer, naming the
//                                         count and the first offender (the bespoke throw at :677)
//   * run the embedding pass             — embedPass.js; SIF's nonEmbeddableRoleList is EMPTY, so
//                                         every node is embedded exactly as the bespoke pass did
//
// BYTE FIDELITY. The pre-migration block id is d393b040…a2330a at 56,395,535 and this file must
// reproduce it. Facts that make that achievable, each MEASURED at Phase 3 entry rather than assumed:
//
//   1. DEPTH IS NOT PRODUCER-STATED, AND SIF PROVES IT LOUDLY. The bespoke walk stamped depth from a
//      `depthByKind` table; structural-contract.js:181 overwrites it. Measured against the entry
//      block: SifCodeset emits depth 1 (×72) AND 3 (×68) against a stamped 2, and SifCodesetValue
//      emits 2 (×1,621) AND 4 (×2,443) against a stamped 3 — TWO of the nine labels emit values the
//      producer never stated, each SPLIT across two, because codesets are parented sometimes to the
//      root and sometimes to a field. No constant per kind could express that. So dropping the stamp
//      is byte-neutral, and this is a measurement of SIF's own block rather than a claim inherited
//      from CEDS.
//   2. THE KIT'S SEARCHTEXT LADDER IS SIF'S OWN LADDER. contractGraphKit.js:127-166 is a role-keyed
//      registry whose own comment says it reproduces "the SIF/Ed-Fi ladder", and whose default arm —
//      `{ role, name, owningName: owningName || standardSource, standardName: standardSource }` — is
//      character-for-character the bespoke default arm at forgeSif.js:227. All five arms were
//      compared before this file was written. So passing `structural.owningName` and letting the
//      ladder build the element reproduces the bespoke searchText exactly.
//   3. _id IS NOT A BYTE. replay-engine.js:353 excludes it from the harvested text. The bespoke
//      `_id: stableId` therefore vanishes harmlessly, as it did for CEDS.
//   4. crossRefs IS STAMPED UNIVERSALLY BY THE FINALIZER with '[]' where a node harvested none, so
//      this walk passes crossRefs ONLY for the annotated fields that actually have one, rather than
//      stamping '[]' by hand on all 27,069 as the bespoke did.
//
// ⚠ THE PER-STANDARD LABEL REGISTRY IS KEYED BY NATIVE KIND, NOT BY ROLE, AND THAT IS THE WHOLE
// POINT OF THIS FILE'S CARE. CEDS keys its labels by ROLE because for CEDS role→label is a
// FUNCTION. FOR SIF IT IS NOT: `DmeClass` carries BOTH SifObject (159) and SifComplexType (897), and
// `DmeSupport` carries SifPrimitiveType (15), SifSimpleType (301) AND SifXmlElement (5,872). NINE
// labels across SIX roles. A role-keyed registry is STRUCTURALLY INCAPABLE of expressing this and
// would collapse five labels into two, mislabelling up to 6,173 nodes — which is precisely the
// Phase 1 CEDS defect (it mislabelled 20,913 and moved the block by −58,397 bytes) at larger scale,
// and precisely why the docket said "GENERALISE IT RATHER THAN COPYING IT". A label is a block byte
// and no count can see it: all four CEDS suites were green on that defective build.
// The framework permits this: contractGraphKit.makeNode takes perStandardLabel VERBATIM and says so
// in its own refusal text ("pass the per-standard label verbatim; the framework derives no prefix"),
// so the key space is the forge's business. What this file owes is the REFUSAL, below.

const path = require('path');
const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const { DME_ROLES, EDGE_TYPES } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const normalize = require('./normalize');
const forgeDeclaration = require('./sifForgeDeclaration');

// THE STANDARD'S OWN NAME IS DECLARED ONCE, IN H1, AND READ HERE — NEVER RE-TYPED. Same reasoning as
// forgeCedsContractGraph.js:104 and forgeEdfiContractGraph.js:64: a re-typed literal turns a value
// the contract ASSERTS to be equal into one that merely HAPPENS to be equal.
const STANDARD_SOURCE = forgeDeclaration.standardSource;

// the native annotation column, declared once in H1 and read here as the crossRef locator.
const CEDS_ANCHOR_PROPERTY_NAME = forgeDeclaration.mappingInstruction.cedsOriginalAnchorPropertyName[0];

// ---- CHARACTERISTICS: SIF's own cardinality-and-obligation statement (bespoke :110-116) ----------
//
// The TSV's Characteristics column is a CLOSED five-value vocabulary. Two distinct things happen to
// it and the distinction is the whole point: the cell is carried VERBATIM as `characteristics` (the
// SOURCE's statement, and the property NAME is required rather than chosen — roundTripSifCompiler.js
// reads exactly that name and roundTripSifCanonical.js maps exactly it to the fieldCharacteristics
// predicate), and TWO structural facts are DERIVED from it below.
//
// A TABLE AND NOT A REGEX ON THE 'R' SUFFIX: a regex would silently accept a value the source never
// stated. 'CR' is REAL in the published XSD (README_ERRATA.md S-1) and occurs ZERO times in this
// export. A table refuses an unlisted value BY NAME and forces a deliberate ruling. No silent
// default, ever.
const FIELD_CHARACTERISTICS_DERIVATION = Object.freeze({
	O: Object.freeze({ characteristicsRepeatable: false, characteristicsObligation: 'optional' }),
	M: Object.freeze({ characteristicsRepeatable: false, characteristicsObligation: 'mandatory' }),
	MR: Object.freeze({ characteristicsRepeatable: true, characteristicsObligation: 'mandatory' }),
	OR: Object.freeze({ characteristicsRepeatable: true, characteristicsObligation: 'optional' }),
	C: Object.freeze({ characteristicsRepeatable: false, characteristicsObligation: 'conditional' }),
});

// nativeLabel -> { role, kind, perStandardLabel }. Registry, not switch (ruling 2026-06-22).
const ROLE_SPEC_BY_NATIVE_LABEL = Object.freeze({
	SifObject: Object.freeze({ role: DME_ROLES.CLASS, kind: 'object', perStandardLabel: 'SifObject' }),
	SifComplexType: Object.freeze({ role: DME_ROLES.CLASS, kind: 'complexType', perStandardLabel: 'SifComplexType' }),
	SifField: Object.freeze({ role: DME_ROLES.PROPERTY, kind: 'field', perStandardLabel: 'SifField' }),
	SifCodeset: Object.freeze({ role: DME_ROLES.OPTION_SET, kind: 'codeset', perStandardLabel: 'SifCodeset' }),
	SifSimpleType: Object.freeze({ role: DME_ROLES.SUPPORT, kind: 'simpleType', perStandardLabel: 'SifSimpleType' }),
	SifPrimitiveType: Object.freeze({ role: DME_ROLES.SUPPORT, kind: 'primitiveType', perStandardLabel: 'SifPrimitiveType' }),
	SifXmlElement: Object.freeze({ role: DME_ROLES.SUPPORT, kind: 'xmlElement', perStandardLabel: 'SifXmlElement' }),
});

// the option-value label, which has no native node to be keyed from: codeset values are a native
// ARRAY PROPERTY that this walk EXPANDS into DmeOptionValue nodes (bespoke :608).
const OPTION_VALUE_PER_STANDARD_LABEL = 'SifCodesetValue';

// refused by name rather than defaulted: an unlisted native label would otherwise silently take some
// other kind's label — or, worse under a role-keyed scheme, a SIBLING KIND'S label — and move the
// block id without moving any count. Same refusal shape as CEDS's perStandardLabelFor, keyed on the
// axis SIF actually varies along.
const roleSpecForNativeLabel = (nativeLabel) => {
	const roleSpec = ROLE_SPEC_BY_NATIVE_LABEL[nativeLabel];
	if (roleSpec === undefined) {
		throw new Error(
			`${moduleName}: no role/label declared for native SIF label '${nativeLabel}' — ` +
				`add it to ROLE_SPEC_BY_NATIVE_LABEL; the per-standard label is a block byte and is never defaulted`,
		);
	}
	return roleSpec;
};

// native key extractor per kind — the natural key that makes the synthetic stableId deterministic.
const NATURAL_KEY_BY_KIND = Object.freeze({
	object: (props) => props.tableName,
	complexType: (props) => props.name,
	field: (props) => props.xpath,
	codeset: (props) => props.fingerprint,
	simpleType: (props) => props.name,
	primitiveType: (props) => props.name,
	xmlElement: (props) => props.path,
});

// native edge type -> canonical/REFERENCES (the kit stamps 'structural' on every one).
// HAS_PROPERTY/HAS_OPTION_SET are canonical ownership; the rest are non-ownership internal
// references (DESIGN §F). Synthesized ownership edges (HAS_CLASS/HAS_SUPPORT/HAS_VALUE) are added
// directly, not via this table.
const EDGE_TYPE_TRANSLATION = Object.freeze({
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
});

// ⚠ REFUSING, WHERE THE BESPOKE _parentEdge PATH SILENTLY DEFAULTED. forgeSif.js:652 read
// `canonical || EDGE_TYPES.REFERENCES` for the parent edge while the outgoing-edge path THREW on an
// untranslated type — the same question answered two ways in one function. MEASURED by parsing the
// real snapshot in-process before this file was written: `_parentEdge.type` is 'HAS_FIELD' for ALL
// 15,620 parent edges, the only value that occurs, and all ten outgoing native types are in the
// table above. So the `||` alternative NEVER FIRES on this snapshot and refusing here is
// BYTE-NEUTRAL TODAY. It is a real behaviour change on some future snapshot that introduces a new
// native edge type: the bespoke forge would have silently recorded it as REFERENCES, and this
// refuses by name. That is deliberate and is the end state the framework's own S6 allowance row
// names ("retiredBy: refuse the unknown type → byte-neutral, its own commit"). Docketed, because it
// is a behaviour change no gate covers and only a future snapshot would reveal.
const canonicalEdgeTypeFor = ({ nativeEdgeType, edgeContext }) => {
	const canonicalEdgeType = EDGE_TYPE_TRANSLATION[nativeEdgeType];
	if (canonicalEdgeType === undefined) {
		throw new Error(
			`${moduleName}: untranslated native edge type '${nativeEdgeType}' (${edgeContext}) — ` +
				`add it to EDGE_TYPE_TRANSLATION deliberately; an edge type is a block byte and is never defaulted`,
		);
	}
	return canonicalEdgeType;
};

// native-edge properties CARRIED onto the canonical edge (WORKORDER-sifViaConservation-090226).
//
// EDGE_TYPE_TRANSLATION above folds ten native types into three canonical ones and, until this
// change, the canonical edge recorded NOTHING of what it was folded from. `nativeEdgeType` is
// stamped on EVERY translated edge so the fold is recoverable without touching the canonical
// vocabulary (the DME's traversal.cypher declares a fixed edge set; this adds a property, not a type).
//
// `via` and `mandatory` exist ONLY on the edges the parser emits from its object-to-object
// REFERENCES resolution. There they are edge IDENTITY, not decoration: the parser's
// deduplicateEdges keys on `sourceTable|targetTable|via`, so two references A->B through DIFFERENT
// fields are MEANT to survive as two edges. Dropping `via` made them byte-identical and the graph write
// collapsed them -- four opposed privacy references on PersonPrivacyObligationDocument
// (ShareWithRefId, DoNotShareWithRefId, NeverShareWithRefId, PermissionGranteeRefId) became one
// undifferentiated edge.
//
// CARRIED ONLY WHEN PRESENT. An edge stamped `via: undefined` is a different block byte from an edge
// carrying no `via` at all, so an absent native property must leave no trace whatsoever.
const CARRIED_NATIVE_EDGE_PROPERTY_NAME_LIST = Object.freeze(['via', 'mandatory']);

const carriedEdgePropertiesFor = ({ nativeEdgeType, nativeEdgeProperties, edgeContext }) => {
	const propertiesAreShaped =
		nativeEdgeProperties === undefined ||
		(typeof nativeEdgeProperties === 'object' &&
			nativeEdgeProperties !== null &&
			!Array.isArray(nativeEdgeProperties));
	if (!propertiesAreShaped) {
		throw new Error(
			`${moduleName}: native edge '${nativeEdgeType}' (${edgeContext}) carries properties that are ` +
				`${Array.isArray(nativeEdgeProperties) ? 'an array' : `a ${typeof nativeEdgeProperties}`} -- ` +
				`a native edge's properties are a plain object or absent; anything else would read as ` +
				`no properties at all and discard declared edge content silently`,
		);
	}
	const carriedProperties = { nativeEdgeType };
	CARRIED_NATIVE_EDGE_PROPERTY_NAME_LIST.forEach((oneNativePropertyName) => {
		const nativeValue =
			nativeEdgeProperties === undefined ? undefined : nativeEdgeProperties[oneNativePropertyName];
		if (nativeValue !== undefined) {
			carriedProperties[oneNativePropertyName] = nativeValue;
		}
	});
	return carriedProperties;
};

// kinds that the root owns directly (the synthesized HAS_CLASS / HAS_SUPPORT ownership edges).
const OWNERSHIP_EDGE_FOR_KIND = Object.freeze({
	object: EDGE_TYPES.HAS_CLASS,
	complexType: EDGE_TYPES.HAS_CLASS,
	simpleType: EDGE_TYPES.HAS_SUPPORT,
	primitiveType: EDGE_TYPES.HAS_SUPPORT,
	xmlElement: EDGE_TYPES.HAS_SUPPORT,
});

// SIF's ONLY source is a FLATTENED Implementation-Specification TSV whose columns are Name /
// Mandatory / Characteristics / Type / Description / XPath / CEDS ID / Format (parser.js:60-72).
// There is NO compositor column recording xs:sequence vs xs:choice anywhere in this source format —
// the parser only ever sees TSV ROW / XPath order. This forge therefore NEVER stamps orderSemantics
// 'normative'; every sibling group it declares is honestly 'document'. The sequence-contract module
// refuses a forge that claims otherwise without grounds, and SIF has none.
const SEQUENCE_ORDER_SEMANTICS_HERE = 'document';

// the faithful native scalars worth keeping queryable on a node, carried only when present.
const OPTIONAL_NATIVE_SCALAR_NAME_LIST = Object.freeze([
	'xpath',
	'tableName',
	'category',
	'nativeType',
	'format',
]);

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// =====================================================================
		// emitContractGraph — PURE, deterministic. { sifSpecification, kit } -> the walk's arrays, its
		// stats, and the sibling groups the framework's finalizeSequence consumes.
		//
		// NO `metadata` PARAMETER, deliberately. The framework hands the HOOK
		// `({ parsed, metadata, kit })` and sifHooks passes on only what this walk actually reads —
		// the loader's own payload and the kit. SIF's walk needs no post-stamp metadata at all: the
		// root (the only node built from it) is minted by the framework before the walk runs, and the
		// root description's objectCount/fieldCount come from the PARSER's metadata inside `parsed`,
		// which describeRoot reads. Accepting a parameter nothing reads would misdeclare the seam.
		// =====================================================================
		const emitContractGraph = ({ sifSpecification, kit }) => {
			const nativeNodes = sifSpecification.nodes;
			const rootStableId = kit.rootStableId;

			// SIF's OWN run counters, held locally rather than written onto kit.stats. The kit's stats
			// object is the framework's — its substitutionCount and emptyStringCoercionCount are read by
			// the allowance evaluator as `kitStats` — so a forge that scribbled its own keys onto it
			// would be writing into the evidence the framework judges the build by. These are merged
			// into the RETURNED stats, which is where a walk's own reports belong.
			const sifWalkStats = {
				crossRefsAnnotated: 0,
				fieldlessComplexTypes: 0,
				optionValuesExpanded: 0,
				codesetUnique: 0,
				codesetAssignments: 0,
			};

			// stableId for a native node; refuses on an empty/unknown key (R3 — never a silent
			// malformed id). The kit ALSO refuses an unclean stableId at makeNode against the declared
			// stableIdPattern, so identity is checked on both sides of the seam.
			// `naturalKey`, never the bare word `key` (developmentPractices §2a): this parameter carries
			// the SOURCE-side natural key a stableId is minted FROM — an xpath, a tableName, a codeset
			// fingerprint — which is a different thing from the stableId it produces and from a record's
			// own refId; `key` alone could mean any of the three. The bare `key:` in the call below is
			// normalize.js's EXISTING parameter name and is deliberately left alone: that is SIF's own
			// pre-migration lib, outside this phase's scope, and renaming across a module I am not
			// otherwise touching would put a gratuitous edit inside a watched seam path.
			const stableIdFor = ({ kind, naturalKey }) => {
				const result = normalize.buildStableId({ kind, key: naturalKey });
				if (result.error) {
					throw new Error(`${moduleName}: R3 stableId miss: ${result.error}`);
				}
				return result.stableId;
			};

			// ---- SEQUENCE CAPTURE — two DISJOINT sibling-group families ----------------------------
			// (1) FIELD groups — every SifField belongs to EXACTLY ONE group, OWNER-SCOPED to its
			//     SifObject. props.pathSegments is the xpath with the owning object's own two segments
			//     ALREADY STRIPPED (parser.js field.pathSegments = xpathParts.slice(3, -1)), so keying
			//     on pathSegments ALONE merged a shared nested shape reused across many objects into
			//     ONE cross-object group — 268 of 1,873 groups merged, 10,933 of 15,620 fields in a
			//     merged group, worst case 952 members from 136 objects. owningName is folded into the
			//     key so the group is scoped to ONE object's TSV rows, which are contiguous for one
			//     parent within that object, making per-owner ordinals correct by construction.
			// (2) ELEMENT groups — the children of a non-root SifXmlElement's own parent, from the
			//     native CHILD_ELEMENT edges. DELIBERATELY NOT owner-scoped: an element node is already
			//     deduped to ONE per relativePath, so its children ARE the one merged tree the graph
			//     contains — unlike a field, which is a distinct node per object. Root elements are
			//     deliberately NOT grouped: a depth-1 relativePath is GLOBAL across the parser's
			//     elementMap and can root MULTIPLE distinct objects with unrelated sibling sets, so
			//     forcing a single group there would silently pick a winner.
			const fieldGroups = {}; // groupKey -> { orderSemantics, members: [fieldStableId, ...] }
			const elementGroups = {}; // groupKey -> { orderSemantics, members: [elementStableId, ...] }

			// PASS 1 — index every native node and resolve its stableId + role.
			const nativeById = {};
			const nativeIdToStable = {};
			nativeNodes.forEach((nativeNode) => {
				nativeById[nativeNode.id] = nativeNode;
				if (nativeNode.label === 'SifRoot') {
					nativeIdToStable[nativeNode.id] = {
						stableId: rootStableId,
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
					};
					return;
				}
				const roleSpec = roleSpecForNativeLabel(nativeNode.label);
				const naturalKey = NATURAL_KEY_BY_KIND[roleSpec.kind](nativeNode.properties || {});
				nativeIdToStable[nativeNode.id] = {
					stableId: stableIdFor({ kind: roleSpec.kind, naturalKey }),
					role: roleSpec.role,
					name: nativeNode.properties.name,
				};
			});

			// ---- structural nodes (objects, complexTypes, fields, codesets, support) ----
			nativeNodes.forEach((nativeNode) => {
				if (nativeNode.label === 'SifRoot') {
					return;
				}
				const roleSpec = roleSpecForNativeLabel(nativeNode.label);
				const props = nativeNode.properties || {};
				const self = nativeIdToStable[nativeNode.id];

				// owning class name (for a field's searchText/path) — its native parent object.
				let owningName = STANDARD_SOURCE;
				let parentId = rootStableId;
				if (roleSpec.kind === 'field' && nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					if (owner) {
						owningName = owner.name || STANDARD_SOURCE;
						parentId = owner.stableId;
					}
				}

				// flag field-less complex types (potential DmeSupport refinement; kept DmeClass per ruling).
				if (roleSpec.kind === 'complexType' && (props.fieldCount || 0) === 0) {
					sifWalkStats.fieldlessComplexTypes += 1;
				}

				const carriedProperties = {};
				let crossRefsForNode;

				// CEDS cross-ref (annotated fields only): canonicalize to P###### through the KIT's own
				// cedsAnchorValue, which is byte-identical to the bespoke normalize.normalizeCedsCrossRef
				// — VERIFIED by reading both before this file was written: the same last-digit-run regex
				// /(\d+)(?!.*\d)/, the same 'P' prefix for kind 'property', the same padStart(6, '0').
				// The kit REFUSES a present-but-unnormalizable anchor by name where the bespoke threw
				// its own R3 error; both refuse, and the kit's names the kind and the raw value.
				if (roleSpec.kind === 'field' && props.cedsId != null && `${props.cedsId}`.trim() !== '') {
					const anchor = kit.cedsAnchorValue({ kind: 'property', rawValue: props.cedsId });
					if (!anchor.absent) {
						carriedProperties.cedsId = anchor.cedsAnchorValue; // the property -specified resolves on
						carriedProperties.cedsOriginalAnchorPropertyName = [CEDS_ANCHOR_PROPERTY_NAME];
						crossRefsForNode = kit.crossRefsJson([
							{
								system: 'ceds',
								id: anchor.cedsAnchorValue,
								raw: `${props.cedsId}`,
								locator: CEDS_ANCHOR_PROPERTY_NAME,
							},
						]);
						sifWalkStats.crossRefsAnnotated += 1;
					}
				}

				OPTIONAL_NATIVE_SCALAR_NAME_LIST.forEach((oneName) => {
					if (props[oneName]) {
						carriedProperties[oneName] = props[oneName];
					}
				});
				if (typeof props.mandatory === 'boolean') {
					carriedProperties.mandatory = props.mandatory;
				}

				// ---- CHARACTERISTICS — see FIELD_CHARACTERISTICS_DERIVATION above for the rationale.
				// ABSENT IS ABSENT (RT-2), BY CONSTRUCTION: parser.js trims the cell to '', so a field
				// whose Characteristics cell is empty falls through this guard carrying NOTHING — not
				// the verbatim value, and NOT a derived default. Emitting repeatable:false here would
				// assert "does not repeat" where the source is SILENT, which is the silent-default class.
				if (props.characteristics) {
					carriedProperties.characteristics = props.characteristics;
					const derivedCharacteristics = FIELD_CHARACTERISTICS_DERIVATION[props.characteristics];
					if (!derivedCharacteristics) {
						throw new Error(
							`${moduleName}: field '${props.xpath}' states Characteristics ` +
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
					// why the source's own subtlety survives instead of being flattened: the nine 'C' rows
					// that ALSO carry a mandatory '*' (README_ERRATA.md S-2) keep obligation 'conditional'
					// AND mandatory true, side by side, exactly as the source states both.
					carriedProperties.characteristicsRepeatable = derivedCharacteristics.characteristicsRepeatable;
					carriedProperties.characteristicsObligation = derivedCharacteristics.characteristicsObligation;
				}

				// ---- SEQUENCE CAPTURE — FIELD groups. sequenceGroupKey/sequenceGroupLabel are
				// SIF-local scalars (not part of the canonical sequence-contract vocabulary) so a
				// consumer can read a human-legible group name without a graph walk.
				if (roleSpec.kind === 'field') {
					const hasParentElement = !!props.pathSegments;
					const groupKey = hasParentElement
						? `sif:fieldGroup:${owningName}:${props.pathSegments}`
						: `sif:fieldGroup:root:${props.tableName || owningName}`;
					const groupLabel = hasParentElement ? props.pathSegments.split('/').pop() : owningName;
					carriedProperties.sequenceGroupKey = groupKey;
					carriedProperties.sequenceGroupLabel = groupLabel;
					(fieldGroups[groupKey] =
						fieldGroups[groupKey] || { orderSemantics: SEQUENCE_ORDER_SEMANTICS_HERE, members: [] }
					).members.push(self.stableId);
				}

				// ---- SEQUENCE CAPTURE — ELEMENT groups, computed in one shot from the parent's own
				// already-document-ordered native CHILD_ELEMENT edges.
				if (roleSpec.kind === 'xmlElement' && Array.isArray(nativeNode.edges) && nativeNode.edges.length) {
					const childEdgeList = nativeNode.edges
						.filter((oneEdge) => oneEdge.type === 'CHILD_ELEMENT')
						.slice()
						.sort((a, b) => (a.properties && a.properties.sequence) - (b.properties && b.properties.sequence));
					if (childEdgeList.length) {
						const memberList = childEdgeList
							.map((oneEdge) => nativeIdToStable[oneEdge.targetId])
							.filter(Boolean)
							.map((oneRef) => oneRef.stableId);
						if (memberList.length) {
							elementGroups[`sif:elementGroup:${props.path}`] = {
								orderSemantics: SEQUENCE_ORDER_SEMANTICS_HERE,
								members: memberList,
							};
						}
					}
				}

				const pathLabel =
					roleSpec.kind === 'field' ? `${owningName}.${props.name}` : `${props.name}`;

				kit.makeNode({
					role: roleSpec.role,
					perStandardLabel: roleSpec.perStandardLabel,
					stableId: self.stableId,
					name: props.name,
					description: props.description,
					// NO depth: structural-contract derives it from the parentId chain and overwrites any
					// producer stamp — measured on SIF's own block, see the header.
					structural: { parentId, path: pathLabel, owningName },
					carriedProperties: {
						...carriedProperties,
						...(crossRefsForNode === undefined ? {} : { crossRefs: crossRefsForNode }),
					},
					origin: `${nativeNode.label}:${nativeNode.id}`,
				});

				// synthesized ownership edge from the root (HAS_CLASS / HAS_SUPPORT).
				const ownershipEdgeType = OWNERSHIP_EDGE_FOR_KIND[roleSpec.kind];
				if (ownershipEdgeType) {
					kit.addEdge({
						edgeType: ownershipEdgeType,
						fromStableId: rootStableId,
						toStableId: self.stableId,
						edgeContext: `root->${roleSpec.kind}`,
					});
				}

				if (roleSpec.kind === 'codeset') {
					sifWalkStats.codesetUnique += 1;
				}

				// ---- EXPAND codeset values into DmeOptionValue nodes + HAS_VALUE edges ----
				// SIF codesets are unnamed inline enumerations keyed by value-fingerprint, so
				// value-identical enumerations across different fields MERGE into one DmeOptionSet by
				// design. codesetUnique is the merged node count; codesetAssignments is how many fields
				// point at a codeset; the difference is the dedup factor, surfaced so the merge can be
				// verified rather than assumed.
				if (roleSpec.kind === 'codeset' && Array.isArray(props.values)) {
					const setName = props.name;
					props.values.forEach((rawValue) => {
						const value = `${rawValue}`;
						const valueStableId = stableIdFor({
							kind: 'optionValue',
							naturalKey: `${props.fingerprint}/${value}`,
						});
						kit.makeNode({
							role: DME_ROLES.OPTION_VALUE,
							perStandardLabel: OPTION_VALUE_PER_STANDARD_LABEL,
							stableId: valueStableId,
							name: value,
							description: '',
							structural: { parentId: self.stableId, path: `${setName}.${value}`, owningName: setName },
							origin: `SifCodesetValue:${props.fingerprint}/${value}`,
						});
						kit.addEdge({
							edgeType: EDGE_TYPES.HAS_VALUE,
							fromStableId: self.stableId,
							toStableId: valueStableId,
							edgeContext: 'codeset->value',
						});
						sifWalkStats.optionValuesExpanded += 1;
					});
				}
			});

			// ---- translate native edges (the source node's own .edges and the field _parentEdge) ----
			nativeNodes.forEach((nativeNode) => {
				const self = nativeIdToStable[nativeNode.id];
				if (!self) {
					return;
				}
				// the field's HAS_FIELD reverse edge (object -> field) becomes HAS_PROPERTY.
				if (nativeNode._parentEdge) {
					const owner = nativeIdToStable[nativeNode._parentEdge.fromId];
					const edgeContext = `${nativeNode._parentEdge.type}:${nativeNode._parentEdge.fromId}->${nativeNode.id}`;
					kit.addEdge({
						edgeType: canonicalEdgeTypeFor({ nativeEdgeType: nativeNode._parentEdge.type, edgeContext }),
						fromStableId: owner && owner.stableId,
						toStableId: self.stableId,
						edgeContext,
						edgeProperties: carriedEdgePropertiesFor({
							nativeEdgeType: nativeNode._parentEdge.type,
							nativeEdgeProperties: nativeNode._parentEdge.properties,
							edgeContext,
						}),
					});
				}
				// the node's outgoing native edges.
				(nativeNode.edges || []).forEach((nativeEdge) => {
					const target = nativeIdToStable[nativeEdge.targetId];
					if (nativeEdge.type === 'CONSTRAINED_BY') {
						sifWalkStats.codesetAssignments += 1;
					}
					const edgeContext = `${nativeEdge.type}:${nativeNode.id}->${nativeEdge.targetId}`;
					kit.addEdge({
						edgeType: canonicalEdgeTypeFor({ nativeEdgeType: nativeEdge.type, edgeContext }),
						fromStableId: self.stableId,
						toStableId: target && target.stableId,
						edgeContext,
						edgeProperties: carriedEdgePropertiesFor({
							nativeEdgeType: nativeEdge.type,
							nativeEdgeProperties: nativeEdge.properties,
							edgeContext,
						}),
					});
				});
			});

			// the framework refuses dangling edges, runs finalizeSequence over the groups returned
			// here, then finalizeStructuralContract LAST. The walk hands back the kit's collected
			// arrays in emission order.
			return {
				nodes: kit.nodes,
				edges: kit.edges,
				// parseAudit rides on stats — the parser's formerly-silent paths, counted and recorded.
				// It is DIGEST-EXCLUDED run diagnostics (the block text covers nodes/edges/metadata only),
				// which is exactly why it must be carried DELIBERATELY: the bespoke module attached it in
				// forge() (`stats: { ...graph.stats, parseAudit: parsed.parseAudit }`) and the first
				// migrated draft dropped it. ⚠ THE BYTE-IDENTITY ORACLE DID NOT NOTICE — I3 reproduced
				// EXACTLY with parseAudit missing, because a digest-excluded field cannot move a block
				// id by construction. test-r3-canonical caught it with nine named failures. The oracle
				// sees everything IN THE BLOCK; a bundle's contract is larger than its block.
				stats: { ...kit.stats, ...sifWalkStats, parseAudit: sifSpecification.parseAudit },
				sequenceGroups: { orderingByParent: { ...fieldGroups, ...elementGroups } },
			};
		};

		return { emitContractGraph };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
