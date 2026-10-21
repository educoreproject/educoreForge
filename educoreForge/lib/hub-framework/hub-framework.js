'use strict';

// PHASE 2b — THE PROVENANCE RE-KEY, BY CONTROLLED EXPERIMENT (SPEC-hubKitRole-082826.md §4.9;
// values CONFIRMED by FROZEN_JOURNEY 2026-08-29T09:48:38Z before this edit was made).
//
// This line USED to derive the name from __filename:
//     const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
// which yields 'cedsHubForge'. That string is written into HubDefinition.sourceProvenance and
// sourceProvenance is a NODE PROPERTY, so IT IS A BLOCK BYTE (§3.3 [R2 F1]). In Phase 2c the emission
// moves to lib/hub-framework/hub-framework.js, whose own __filename derives 'hub-framework' — so the
// stamp WILL change when the code moves, and §4.9 chose to re-key by controlled experiment rather
// than pin a label that would name a module no longer doing the emitting.
//
// THE EXPERIMENT IS THIS FILE, OTHERWISE UNTOUCHED, WITH ONLY THIS ONE VALUE MOVED TO ITS
// POST-EXTRACTION TRUTH. FORGE_MODULE_VERSION at :57 is deliberately NOT touched: it is already
// '1.0.0', which is the hub framework's own first version, so it does not move. One field, one
// predicted line — if two fields moved and something unexpected appeared, neither could be blamed.
//
// PREDICTED, BEFORE RUNNING: exactly ONE differing line (119806, the HubDefinition node line),
// line count unchanged at 615,926, cmp's first differing byte 263,839,333, +1 byte (12 chars ->
// 13, both ASCII).
//
// ⚠ moduleName ALSO prefixes every refusal message in this module. Changing it changes those
// strings. It cannot reach the block, because a refusal message is emitted only when a refusal
// FIRES and none fires on a clean CEDS forge — SO A SECOND DIFFERING LINE WOULD MEAN A REFUSAL
// FIRED, AND THAT IS A STOP CONDITION, not a curiosity.
const moduleName = 'hub-framework';

// hub-framework.js — THE HUB KIT ROLE'S SHARED DERIVATION, extracted in Phase 2c from
// forges/ceds/lib/cedsHubForge.js (SPEC-hubKitRole-082826.md §4; the module it came from is deleted).
// Peer of lib/forge-framework and lib/bridge-framework: the third role a standard's kit can play.
//
// WHAT MOVED AND WHAT DID NOT. The DERIVATION moved here whole — card enumeration, addressSignature,
// embedText composition, the tier passes, the divergence and skip reports, slotProfile, HubDefinition
// minting, the canonical sort. The CEDS-SHAPED PARTS became DATA in the kit's hubDeclaration:
//   hubName · hubDisplayName · canonicalKeyName · canonicalKeyMinted   the four identity literals
//   sourceIdFieldName                the source's own id, used as report id AND divergence sort key
//   baseFieldNames                   the bare names this derivation reads off base nodes ([R1 Q2])
//   qualifiedReference               {typePropertyPattern, tokenNamesForStem} — DATA, not a hook ([R1 Q7])
//   provenanceLabel                  {forgeModule, forgeModuleVersion} — BLOCK BYTES ([R2 F1], §4.9)
// and, since ctdlHub P3 (2026-10-20), four more, each REQUIRED and each declared by CEDS as exactly its pre-P3 behaviour:
//   tierList                         which tiers the hub mints: term | property | value. The hub card field table is
//                                    FILTERED by it (hubCardFieldTable.hubFieldTableOf), so a hub without the term tier
//                                    serialises the pre-P3 slotProfile byte for byte
//   rangeAddressing                  singleRangeSlot (CEDS: one range, hashed) | rangeAsMeaning (ranges as list-valued
//                                    meaning, never hashed) — RANGE_ADDRESSING_REGISTRY below
//   rootFieldNames                   where on the root the five sourceProvenance fields are read (BLOCK BYTES)
//   embedTextTemplateByTier          embedText as declared slots, one template per tier
// and, since ctdlHub P4 (2026-10-20), one more, REQUIRED, declared by CEDS as exactly its pre-P4 behaviour:
//   domainAddressing                 domainFields (CEDS: allDomainIds, else domainId, read off the property node) |
//                                    hasPropertyEdges (CTDL: the classes with a HAS_PROPERTY edge to the property) —
//                                    DOMAIN_ADDRESSING_REGISTRY below
//
// ⚠ THE HONESTY CLAUSE, AND IT IS NOT A FORMALITY (SPEC §4.4). A FRAMEWORK EXTRACTED FROM ONE HUB IS
// PROVEN ON ONE, WHICH IS PROVEN ON NONE. The 2c clause named three CEDS-shaped places where the boundary would move
// when CTDL arrived. ctdlHub P3 moved them, and this is where each went:
//   * `canonicalKey` and `domainId` were read by bare name. They are now baseFieldNames entries; every base and root
//     read goes through a declared name except `role`, the graph contract's universal node field.
//   * the `domainListOf` scalarisation stays, and now also reads a rangeAsMeaning hub's datatype list. It is
//     shape-agnostic, so it was never CEDS-only; the 2,068-of-2,324 measurement is still why it exists.
//   * `composeEmbedText`'s "the range on the value tier IS an option set" is now CEDS's DECLARED value template
//     (embedTextTemplateByTier), not a framework rule.
// And two boundaries P3 ADDED: the term tier (one card per hub-native term, addressed by its IRI, with
// HAS_TERM_REFERENCE from each property card when both tiers are minted), and rangeAsMeaning (one property card per
// (domain, property), however many ranges it has).
// WHAT IS PROVEN, SAID PLAINLY: one REAL hub (CEDS: byte-identical across P3, by in-process sha of the derived hub and
// by its re-forged standardBase block id; GATEREPORT-P3-101926.md) plus one SYNTHETIC RDF-shaped fixture hub
// (test/fixtures/rdfShapedHub, 3 classes, 4 properties, 1 scheme of 3 concepts; test-rdfShapedFixtureHub.js). That
// is still NOT two real hubs: CTDL's real base (P1) has never been through this derivation, and two hubs in one build
// is untested (P5). The hooks seam remains proven only in the negative (HUB_HOOK_NAME_LIST is empty).
//
// The card contract is unchanged and is the reason the extraction could be byte-neutral: one card =
// one addressable idea = one tuple, SELF-SUFFICIENT (ADDRESS / IDENTITY / MEANING / PROVENANCE /
// DERIVED). Edges remain for traversal; no reader requires them.
//
// REFUSALS, NOT SUBSTITUTIONS: a domainId resolving to no class node, a property/value/qualifier with
// no name, an absent root, an absent factory argument, an invalid declaration — each refused BY NAME
// with the offending id. No degraded card is ever emitted. No a||b||c identity chains. Absent is
// absent: a slot the source gave no prose for gets NO field, never ''.
//
// R7: forgeHub is error-first callback-shaped even though the derivation is synchronous. PURE +
// deterministic: no I/O, no Neo4j, no network, no embedding calls, no Date/random. embedText is
// COMPOSED and STORED here; the vector is stamped at build time through the shared cache.
//
// @concept: [[HubReference]]
// @concept: [[HubFramework]]

const crypto = require('crypto');
const path = require('path');

const vocab = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const {
	NODE_LABELS,
	EQUIVALENCE_NODE_LABELS,
	REFERENCE_TIER,
	CANONICAL_ADDRESS_PROPERTIES: A,
	HUB_REFERENCE_PROPERTIES: HR,
	HUB_DEFINITION_PROPERTIES: HD,
	// the GENERIC generator, not a per-hub constant: hubEdgeType(hubName, slot) -> HAS_<HUB>_<SLOT>.
	// Byte-neutral against the CEDS_HUB_EDGE_TYPES constant it replaced (deleted from vocabulary.js in
	// the same commit, RULING FJ-P2-3) on all five slots, re-verified in Phase 2c
	// by calling both rather than by citing the earlier verification (SPEC §3.4, STANDDOWN-P1 A.1).
	hubEdgeType,
	HUB_DECOMPOSITION_SLOTS,
	HUB_TERM_DECOMPOSITION_SLOTS,
	// the base ownership edges this derivation walks — the constants, not the literals they used to be
	// (SPEC §4.8(4)).
	EDGE_TYPES,
	IN_HUB_EDGE_TYPE,
	HUB_TERM_REFERENCE_EDGE_TYPE,
	ADDRESS_SIGNATURE_FIELD_ORDER,
	TERM_ADDRESS_SIGNATURE_FIELD_ORDER,
	PROVENANCE_TIER,
	DME_ROLES,
} = vocab;
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const {
	validateHubDeclaration,
	validateHubHooks,
	RANGE_ADDRESSING_MODE_LIST,
	DOMAIN_ADDRESSING_MODE_LIST,
} = require(path.join(__dirname, 'hubDeclarationContract'));
// ⟪campaign P3, W-C-5⟫ the ONE declaration of a card's fields: it builds the slotProfile and checks every emitted card
const { HUB_CARD_FIELD_TABLE, HUB_CARD_STRUCTURE_VERSION, slotProfileFromFieldTable, cardFieldRefusal } = require(path.join(__dirname, 'hubCardFieldTable'));

// slot NAME -> slot NAME, derived from the vocabulary's own roster so the five slot tokens are never
// re-typed here as literals. HUB_DECOMPOSITION_SLOTS is the single source of the slot vocabulary.
const HUB_DECOMPOSITION_SLOTS_BY_NAME = Object.freeze(
	HUB_DECOMPOSITION_SLOTS.concat(HUB_TERM_DECOMPOSITION_SLOTS).reduce(
		(soFar, oneSlot) => Object.assign(soFar, { [oneSlot]: oneSlot }),
		{},
	),
);

// ⟪ctdlHub P3 step 5⟫ a term card's termKind, by the DME role of the base node it addresses. A registry, not a branch:
// a role absent here mints no term card, and the term pass walks exactly these roles.
const TERM_KIND_BY_ROLE = Object.freeze({
	[DME_ROLES.CLASS]: 'class',
	[DME_ROLES.PROPERTY]: 'property',
	[DME_ROLES.OPTION_SET]: 'optionSet',
	[DME_ROLES.OPTION_VALUE]: 'value',
});

// ⟪ctdlHub P3 step 3⟫ RANGE_ADDRESSING_REGISTRY — THE POLYMORPHIC SEAM behind hubDeclaration.rangeAddressing.
//
// @interface RangeAddressingMode — (rangeIndexes) -> rangeShapeOf, where rangeIndexes is
//     { baseFieldNames, classByDomainId, optionSetNodeOfProperty, optionSetNodeListOfProperty,
//       referencedClassNodeListOfProperty, recordDerivationFault }
//   and rangeShapeOf(propertyNode) returns
//     { propertyCardRange, valueCardRangeList } | undefined (undefined: a refusal was recorded by name)
//   propertyCardRange  the range arguments of the property card's emitReference call
//                      ({ rangeOptionSetId, rangeClassId, rangeDatatype, optionSetNode, classRangeNode, rangeMeaning })
//   valueCardRangeList one { rangeOptionSetId, optionSetNode } per option set whose values become value cards
//
// The contract (hubDeclarationContract RANGE_ADDRESSING_MODE_LIST) names the admissible modes; this registry must
// implement exactly those, which is checked at load below rather than discovered at the first hub that names one.
const RANGE_ADDRESSING_REGISTRY = Object.freeze({
	// TODAY'S BEHAVIOUR, MOVED AND NOT CHANGED (CEDS). One range, the XOR of three shapes, hashed into 'range'. The
	// option set is the LAST HAS_OPTION_SET edge seen (optionSetNodeOfProperty); that is PLAN §2.4 H-c, and it stays
	// exactly as it was because it is block bytes for CEDS.
	singleRangeSlot: ({ baseFieldNames, classByDomainId, optionSetNodeOfProperty }) => (propertyNode) => {
		const propertyProps = propertyNode.properties;
		const optionSetNode = optionSetNodeOfProperty[propertyNode.stableId];
		const rangeOptionSetId = optionSetNode
			? v1(optionSetNode.properties[baseFieldNames.rangeOptionSetId])
			: undefined;
		const rangeClassId = optionSetNode
			? undefined
			: v1(propertyProps[baseFieldNames.rangeClassId]);
		const classRangeNode = rangeClassId
			? classByDomainId[rangeClassId]
			: undefined;
		const rangeDatatype =
			optionSetNode || rangeClassId
				? undefined
				: v1(propertyProps[baseFieldNames.rangeDatatype]);
		return {
			propertyCardRange: { rangeOptionSetId, rangeClassId, rangeDatatype, optionSetNode, classRangeNode },
			valueCardRangeList: optionSetNode ? [{ rangeOptionSetId, optionSetNode }] : [],
		};
	},
	// CTDL. Every declared range is MEANING: the property card's address carries no range at all (the 'range' slot
	// encodes empty), and its ranges ride as parallel, id-sorted lists. Classes come from the base's REFERENCES edges and
	// option sets from its HAS_OPTION_SET edges (all of them, not the last); datatypes from the declared rangeDatatype
	// base field read list-agnostically. Value cards: one per (domain, property, option set, value), with that option set
	// hashed into the value card's 'range' slot so a value two of the property's option sets share stays two cards.
	rangeAsMeaning: ({ baseFieldNames, optionSetNodeListOfProperty, referencedClassNodeListOfProperty, recordDerivationFault }) => (propertyNode) => {
		const propertyProps = propertyNode.properties;
		const rangeEntryListOf = ({ rangeNodeList, rangeIdFieldName, rangeKindLabel }) =>
			rangeNodeList.map((rangeNode) => ({
				rangeNode,
				rangeId: v1(rangeNode.properties[rangeIdFieldName]),
				rangeName: v1(rangeNode.properties[baseFieldNames.name]),
				rangeKindLabel,
			}));
		const classEntryList = rangeEntryListOf({ rangeNodeList: referencedClassNodeListOfProperty[propertyNode.stableId] || [], rangeIdFieldName: baseFieldNames.domainId, rangeKindLabel: 'range class' });
		const optionSetEntryList = rangeEntryListOf({ rangeNodeList: optionSetNodeListOfProperty[propertyNode.stableId] || [], rangeIdFieldName: baseFieldNames.rangeOptionSetId, rangeKindLabel: 'range option set' });
		// the lists are positionally parallel (ids and names), so an entry with no id or no name is refused by name,
		// never carried as a hole that would shift every later name onto the wrong id
		const faultyEntry = classEntryList.concat(optionSetEntryList).find((oneEntry) => !hasProse(oneEntry.rangeId) || !hasProse(oneEntry.rangeName));
		if (faultyEntry) {
			recordDerivationFault(
				`${moduleName}: REFUSED — ${faultyEntry.rangeKindLabel} '${faultyEntry.rangeNode.stableId}' of property ` +
					`'${propertyNode.stableId}' has ${hasProse(faultyEntry.rangeId) ? 'no name' : 'no id'}; rangeAsMeaning carries ` +
					`ids and names as parallel lists.`,
			);
			return undefined;
		}
		const byRangeId = (left, right) => compareText(left.rangeId, right.rangeId) || compareText(left.rangeNode.stableId, right.rangeNode.stableId);
		const sortedClassEntryList = uniqueByStableId(classEntryList).sort(byRangeId);
		const sortedOptionSetEntryList = uniqueByStableId(optionSetEntryList).sort(byRangeId);
		const rangeDatatypeList = domainListOf(propertyProps[baseFieldNames.rangeDatatype])
			.filter((oneDatatype, datatypeIndex, datatypeList) => datatypeList.indexOf(oneDatatype) === datatypeIndex)
			.sort(compareText);
		return {
			propertyCardRange: {
				rangeMeaning: {
					rangeClassIdList: sortedClassEntryList.map((oneEntry) => oneEntry.rangeId),
					rangeClassNameList: sortedClassEntryList.map((oneEntry) => oneEntry.rangeName),
					rangeOptionSetIdList: sortedOptionSetEntryList.map((oneEntry) => oneEntry.rangeId),
					rangeOptionSetNameList: sortedOptionSetEntryList.map((oneEntry) => oneEntry.rangeName),
					rangeDatatypeList,
					rangeNodeList: sortedClassEntryList.concat(sortedOptionSetEntryList).map((oneEntry) => oneEntry.rangeNode),
				},
			},
			valueCardRangeList: sortedOptionSetEntryList.map((oneEntry) => ({ rangeOptionSetId: oneEntry.rangeId, optionSetNode: oneEntry.rangeNode })),
		};
	},
});
const unimplementedModeList = RANGE_ADDRESSING_MODE_LIST.filter((modeName) => RANGE_ADDRESSING_REGISTRY[modeName] === undefined);
const unadmittedModeList = Object.keys(RANGE_ADDRESSING_REGISTRY).filter((modeName) => RANGE_ADDRESSING_MODE_LIST.indexOf(modeName) === -1);
if (unimplementedModeList.length || unadmittedModeList.length) {
	throw new Error(
		`${moduleName}: REFUSED AT LOAD — RANGE_ADDRESSING_REGISTRY implements [${Object.keys(RANGE_ADDRESSING_REGISTRY).join(', ')}] ` +
			`but the declaration contract admits [${RANGE_ADDRESSING_MODE_LIST.join(', ')}]; they must be the same list.`,
	);
}

// ⟪ctdlHub P4⟫ DOMAIN_ADDRESSING_REGISTRY — THE POLYMORPHIC SEAM behind hubDeclaration.domainAddressing: where pass 1 finds
// the domains of a property. One property card (and its value cards) is minted per domain id returned.
//
// @interface DomainAddressingMode — (domainIndexes) -> declaredDomainIdListOf, where domainIndexes is
//     { baseFieldNames, classNodeListOfProperty }
//   and declaredDomainIdListOf(propertyNode) returns the property's domain ids (an empty list: the property is
//   skip-reported zeroDeclaredDomains by the caller, never refused and never dropped)
//
// The contract (hubDeclarationContract DOMAIN_ADDRESSING_MODE_LIST) names the admissible modes; this registry must
// implement exactly those, checked at load below.
const DOMAIN_ADDRESSING_REGISTRY = Object.freeze({
	// TODAY'S BEHAVIOUR, MOVED AND NOT CHANGED (CEDS). The forge lifts the domains onto the property node: every id in
	// allDomainIds, else the single domainId. Field order is kept, because it is the order CEDS's cards were always minted in.
	domainFields: ({ baseFieldNames }) => (propertyNode) => {
		const allDeclaredDomainIds = domainListOf(propertyNode.properties[baseFieldNames.allDomainIds]);
		return allDeclaredDomainIds.length
			? allDeclaredDomainIds
			: domainListOf(propertyNode.properties[baseFieldNames.domainId]);
	},
	// CTDL. The domains exist only as HAS_PROPERTY edges (schema:domainIncludes, forged as class -> property). Every DmeClass
	// with such an edge is a domain; an edge from the root (a property no class declares) is not. Ids are read through
	// baseFieldNames.domainId, distinct and sorted, so the card order cannot follow the base's edge order.
	hasPropertyEdges: ({ baseFieldNames, classNodeListOfProperty }) => (propertyNode) =>
		(classNodeListOfProperty[propertyNode.stableId] || [])
			.map((classNode) => v1(classNode.properties[baseFieldNames.domainId]))
			.filter((domainId, domainIndex, domainIdList) => domainIdList.indexOf(domainId) === domainIndex)
			.sort(compareText),
});
const unimplementedDomainModeList = DOMAIN_ADDRESSING_MODE_LIST.filter((modeName) => DOMAIN_ADDRESSING_REGISTRY[modeName] === undefined);
const unadmittedDomainModeList = Object.keys(DOMAIN_ADDRESSING_REGISTRY).filter((modeName) => DOMAIN_ADDRESSING_MODE_LIST.indexOf(modeName) === -1);
if (unimplementedDomainModeList.length || unadmittedDomainModeList.length) {
	throw new Error(
		`${moduleName}: REFUSED AT LOAD — DOMAIN_ADDRESSING_REGISTRY implements [${Object.keys(DOMAIN_ADDRESSING_REGISTRY).join(', ')}] ` +
			`but the declaration contract admits [${DOMAIN_ADDRESSING_MODE_LIST.join(', ')}]; they must be the same list.`,
	);
}

// single-element PG-JSON array -> scalar. The replay engine scalarizes single-element arrays,
// so the same property reads back as an array from a fresh forge and as a bare value from a
// deserialized block; both shapes must land in the same place.
const v1 = (arrayOrScalar) =>
	Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar;

// every declared domain, whatever shape it was stored in. 2,068 of 2,324 property nodes hold
// allDomainIds as a bare string after scalarization; an Array.isArray() test would silently
// visit one domain for 89% of the corpus and look exactly like a fix.
const domainListOf = (value) =>
	[]
		.concat(value === undefined || value === null ? [] : value)
		.filter((one) => typeof one === 'string' && one.trim() !== '');

const sha256Hex = (text) =>
	crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const collapseWhitespace = (text) => String(text).replace(/\s+/g, ' ').trim();

// a prose/meaning slot value is CARRIED only when CEDS actually said something. '' is "no
// prose" (G-3: zero ''-valued properties on any card); absent stays absent so "CEDS has no
// definition" and "we failed to copy it" remain distinguishable.
const hasProse = (scalar) =>
	scalar !== undefined && scalar !== null && !(typeof scalar === 'string' && scalar === '');

const compareText = (left, right) => (String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0);

// one entry per base node: two base edges to the same range node are one range
const uniqueByStableId = (entryList) =>
	entryList.filter((oneEntry, entryIndex) => entryList.findIndex((otherEntry) => otherEntry.rangeNode.stableId === oneEntry.rangeNode.stableId) === entryIndex);

// FORMAL INTERFACE (polyArch2 — the seam's contract in one place).
//
// @typedef {Object} BaseNodeEdges — the forged (or deserialized) CEDS base.
// @property {Array<{stableId:string, role:string, properties:Object}>} nodes
// @property {Array<{type:string, fromRef:{id:string}, toRef:{id:string}}>} edges
//
// @typedef {Object} HubForgeResult
// @property {Array<{labels:string[], stableId:string, role:string, properties:Object}>} nodes —
//     HubReference cards + the one HubDefinition, sorted by stableId. stableId === uri ===
//     hubNamespace + hubVersion + '/' + addressSignature. NO _id (the replay engine stamps it).
// @property {Array<{type:string, fromRef:Object, toRef:Object, properties:Object}>} edges —
//     HAS_<HUB>_* decomposition (HAS_<HUB>_TERM on term cards) + IN_HUB + HAS_TERM_REFERENCE (property card -> term
//     card, only when the hub mints both tiers), sorted by (type, from, to).
// @property {Array<{role:string, [sourceIdFieldName]:string, name:string, description:string, definition:string}>}
//     divergenceReport — one row per source node whose description and definition both carry
//     prose (hasProse) and differ (§5). Explicitly [] when there are none.
// @property {Array<{reason:string, role:string, [sourceIdFieldName]:string, propertyKey:string, name:string}>}
//     skipReport — one row per DmeProperty skipped BY NAME (S-3: zeroDeclaredDomains — no
//     declared domain means no tuple). Explicitly [] when nothing was skipped.
// @property {Object} counts — { hubDefinition, termTier, propertyTier, valueTier, qualified,
//     hubReferenceTotal, nodeTotal, edgeTotal }.
// @property {Array<Object>} identificationPatterns — every §4.3 pattern examined.
//
// @interface CedsHubForge
// @property {function(BaseNodeEdges, function(errString, HubForgeResult))} forgeHub — R7
//     error-first callback; refuses malformed input and unresolvable slots BY NAME.
// @property {function(Object): string} addressSignatureFor — the R-P1-1 incumbent signature (property/value tiers).
// @property {function({termIri:string}): string} termAddressSignatureFor — the term-tier signature (ctdlHub P3).
// @property {string} hubDefinitionStableId

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ hubDeclaration, hooks, forgeStandardSource } = {}) =>
	({ hubVersion, hubNamespace } = {}) => {
		// H1 CONTRACT FIRST — an invalid declaration is refused before a single factory argument is
		// looked at, so the operator hears about the declaration rather than about its symptom.
		const declarationFault = validateHubDeclaration({ hubDeclaration });
		if (declarationFault) {
			throw declarationFault;
		}
		const hooksFault = validateHubHooks({ hooks });
		if (hooksFault) {
			throw hooksFault;
		}

		const absentFactoryArgs = [];
		if (typeof hubVersion !== 'string' || hubVersion.trim() === '') {
			absentFactoryArgs.push('hubVersion');
		}
		if (typeof hubNamespace !== 'string' || hubNamespace.trim() === '') {
			absentFactoryArgs.push('hubNamespace');
		}
		if (absentFactoryArgs.length) {
			throw new Error(
				`${moduleName}: REFUSED — required factory argument(s) absent or empty: ` +
					`${absentFactoryArgs.join(', ')}. Both hubVersion and hubNamespace are required; ` +
					`there is no default.`,
			);
		}

		const {
			hubName,
			hubDisplayName,
			canonicalKeyName,
			canonicalKeyMinted,
			sourceIdFieldName,
			baseFieldNames,
			qualifiedReference,
			provenanceLabel,
			tierList,
			rangeAddressing,
			domainAddressing,
			rootFieldNames,
			embedTextTemplateByTier,
		} = hubDeclaration;
		const mintsTermTier = tierList.indexOf(REFERENCE_TIER.TERM) !== -1;
		const mintsPropertyTier = tierList.indexOf(REFERENCE_TIER.PROPERTY) !== -1;
		const mintsValueTier = tierList.indexOf(REFERENCE_TIER.VALUE) !== -1;

		// INVARIANT I12 ([R2 F6]) — ASSERTED BY NAME, not assumed. Hub cards carry `_source: hubName`
		// while base nodes carry the forge's `standardSource`; before Phase 2c those were TWO
		// declarations of the same value with NO cross-check between them, in two different files. The
		// hub declaration is now the only place hubName is written, and the framework refuses a
		// mismatch against the forge declaration when one is supplied to compare against.
		// ⚠ ABSENT forgeStandardSource IS REFUSED, NOT SKIPPED (RULING on the 2c review). The first cut of
		// this check read `forgeStandardSource !== undefined && …`, which made I12 A BYPASS BY OMISSION:
		// a kit that simply forgot to pass it got NO cross-check and no complaint, and the invariant
		// would have reported itself satisfied by never running. Every kit passes it — hubCeds.js reads
		// it from the forge declaration — so absence is a wiring fault, not an optional case.
		if (typeof forgeStandardSource !== 'string' || forgeStandardSource.trim() === '') {
			throw refuse.byName({
				moduleName,
				what: `I12 CANNOT BE CHECKED — forgeStandardSource is ${forgeStandardSource === undefined ? 'absent' : JSON.stringify(forgeStandardSource)}`,
				where:
					`the kit must pass forgeDeclaration.standardSource so hubName can be cross-checked ` +
					`against it. An unrunnable invariant is not a satisfied one, so this is refused rather ` +
					`than skipped.`,
			});
		}
		if (String(forgeStandardSource) !== String(hubName)) {
			throw refuse.byName({
				moduleName,
				what:
					`I12 VIOLATED — hubDeclaration.hubName '${hubName}' does not equal ` +
					`forgeDeclaration.standardSource '${forgeStandardSource}'`,
				where:
					`hub cards are stamped _source: hubName while base nodes carry standardSource, so a ` +
					`mismatch silently splits one standard into two sources. Make them equal in ` +
					`the kit's hub declaration.`,
			});
		}

		const hubDefinitionStableId = `${hubNamespace}hubDefinition/${hubName}`;

		// the three range shapes are mutually exclusive (XOR, G-12); the signature folds the one
		// present shape into the single 'range' slot. Stated fold rule, not an identity chain.
		const rangeSlotOf = ({ rangeOptionSetId, rangeClassId, rangeDatatype }) => {
			if (hasProse(rangeOptionSetId)) {
				return rangeOptionSetId;
			}
			if (hasProse(rangeClassId)) {
				return rangeClassId;
			}
			if (hasProse(rangeDatatype)) {
				return rangeDatatype;
			}
			return '';
		};

		// an empty hash slot encodes as '' (the registered encoding rule, not a default value).
		const encodeSignatureSlot = (slotValue) =>
			slotValue === undefined || slotValue === null ? '' : String(slotValue);

		// addressSignature — R-P1-1: the incumbent computation over EXACTLY
		// ADDRESS_SIGNATURE_FIELD_ORDER. Ids only; prose never participates (G-2).
		const addressSignatureFor = ({
			canonicalKey,
			domainId,
			propertyKey,
			rangeOptionSetId,
			rangeClassId,
			rangeDatatype,
			valueKey,
			qualifierKeys,
		}) => {
			const fieldValues = {
				hubName,
				canonicalKey: encodeSignatureSlot(canonicalKey),
				domainId: encodeSignatureSlot(domainId),
				propertyKey: encodeSignatureSlot(propertyKey),
				range: encodeSignatureSlot(
					rangeSlotOf({ rangeOptionSetId, rangeClassId, rangeDatatype }),
				),
				valueKey: encodeSignatureSlot(valueKey),
				// absence encodes as the empty slot — the registered encoding rule, made
				// explicit rather than an || chain
				qualifierKeys: (Array.isArray(qualifierKeys) ? qualifierKeys : [])
					.slice()
					.sort()
					.join(','),
				hubVersion,
			};
			const encoded = ADDRESS_SIGNATURE_FIELD_ORDER.map(
				(oneField) => fieldValues[oneField],
			).join('|');
			return sha256Hex(encoded);
		};

		// ⟪ctdlHub P3 step 5⟫ the TERM-tier signature: the same encoding over TERM_ADDRESS_SIGNATURE_FIELD_ORDER
		// (hubName · termIri · hubVersion). A term card's address is the term's own IRI and nothing else.
		const termAddressSignatureFor = ({ termIri }) => {
			const fieldValues = {
				hubName,
				termIri: encodeSignatureSlot(termIri),
				hubVersion,
			};
			return sha256Hex(
				TERM_ADDRESS_SIGNATURE_FIELD_ORDER.map((oneField) => fieldValues[oneField]).join('|'),
			);
		};

		// =====================================================================
		// embedText composition — §4, every tier, one scheme. Composed from the CARD's own
		// fields so what was embedded is recomputable byte-for-byte from the card (G-6).
		// ⟪ctdlHub P3 step 4⟫ The slots are DECLARED (hubDeclaration.embedTextTemplateByTier), not written here: a slot's
		// carried fields are joined ' · ' (a list-valued field contributes its items, joined ' · '), empty slots drop
		// out, slots are joined ' · '. CEDS's declared templates reproduce the pre-P3 composition exactly, including
		// "the value tier's context is its option set", which is now CEDS's statement rather than the framework's.
		// =====================================================================
		const composeEmbedText = ({ referenceTier, cardProperties }) => {
			const slotTextList = embedTextTemplateByTier[referenceTier].map((slotFieldNameList) =>
				slotFieldNameList
					.map((fieldName) =>
						Array.isArray(cardProperties[fieldName])
							? cardProperties[fieldName].join(' · ')
							: cardProperties[fieldName],
					)
					.filter(hasProse)
					.join(' · '),
			);
			return collapseWhitespace(slotTextList.filter(hasProse).join(' · '));
		};

		// the hub's view of the field table: what its slotProfile serialises and what every card is checked against
		const hubFieldScope = { tierList, rangeAddressing };

		// =====================================================================
		// forgeHub — R7 callback shape; pure, deterministic, no I/O.
		// =====================================================================
		const forgeHub = (baseNodeEdges, callback) => {
			if (
				!baseNodeEdges ||
				!Array.isArray(baseNodeEdges.nodes) ||
				!Array.isArray(baseNodeEdges.edges)
			) {
				callback(
					`${moduleName}.forgeHub: REFUSED — requires { nodes: [], edges: [] }; ` +
						`got ${JSON.stringify(baseNodeEdges).slice(0, 200)}`,
				);
				return;
			}
			const baseNodes = baseNodeEdges.nodes;
			const baseEdges = baseNodeEdges.edges;

			const derivationFaults = [];
			// NAMED derivationFault, not `refuse` — it USED to shadow the imported refuse module for the
			// whole of forgeHub, so `refuse.byName` inside this scope would have thrown TypeError rather
			// than composing a refusal. Nothing called it that way, which is exactly why the shadow was
			// worth removing before something did.
			const recordDerivationFault = (message) => {
				derivationFaults.push(message);
			};

			const nodes = [];
			const edges = [];

			// ---- index the hub structural nodes ----
			const nodeByStableId = {};
			const nodesByRole = {
				[DME_ROLES.CLASS]: [],
				[DME_ROLES.PROPERTY]: [],
				[DME_ROLES.OPTION_SET]: [],
				[DME_ROLES.OPTION_VALUE]: [],
			};
			const classByDomainId = {};
			let rootNode = null;
			baseNodes.forEach((oneNode) => {
				nodeByStableId[oneNode.stableId] = oneNode;
				const role = v1(oneNode.properties.role);
				if (nodesByRole[role]) {
					nodesByRole[role].push(oneNode);
				}
				if (role === DME_ROLES.CLASS) {
					classByDomainId[v1(oneNode.properties[baseFieldNames.domainId])] = oneNode;
				}
				if (role === DME_ROLES.STANDARD_ROOT) {
					rootNode = oneNode;
				}
			});

			if (!rootNode) {
				callback(
					`${moduleName}.forgeHub: REFUSED — no ${DME_ROLES.STANDARD_ROOT} node in ` +
						`baseNodeEdges; sourceProvenance cannot be populated (SPEC §2).`,
				);
				return;
			}

			// ---- structural maps from the base ownership edges ----
			const optionSetNodeOfProperty = {};
			const valueNodesOfOptionSet = {};
			const propertyNodesOfClass = {};
			// ⟪ctdlHub P3⟫ read only by rangeAsMeaning: EVERY option set a property targets (not the last edge's), and
			// every native class it REFERENCES. Building them for a singleRangeSlot hub changes nothing it emits.
			const optionSetNodeListOfProperty = {};
			const referencedClassNodeListOfProperty = {};
			// ⟪ctdlHub P4⟫ read only by domainAddressing hasPropertyEdges: the CLASSES that declare each property
			const classNodeListOfProperty = {};
			baseEdges.forEach((oneEdge) => {
				const fromNode = nodeByStableId[oneEdge.fromRef.id];
				const toNode = nodeByStableId[oneEdge.toRef.id];
				if (!fromNode || !toNode) {
					return;
				}
				if (oneEdge.type === EDGE_TYPES.HAS_PROPERTY) {
					(propertyNodesOfClass[fromNode.stableId] =
						propertyNodesOfClass[fromNode.stableId] || []).push(toNode);
					if (v1(fromNode.properties.role) === DME_ROLES.CLASS) {
						(classNodeListOfProperty[toNode.stableId] = classNodeListOfProperty[toNode.stableId] || []).push(fromNode);
					}
				} else if (oneEdge.type === EDGE_TYPES.HAS_OPTION_SET) {
					optionSetNodeOfProperty[fromNode.stableId] = toNode;
					(optionSetNodeListOfProperty[fromNode.stableId] =
						optionSetNodeListOfProperty[fromNode.stableId] || []).push(toNode);
				} else if (oneEdge.type === EDGE_TYPES.HAS_VALUE) {
					(valueNodesOfOptionSet[fromNode.stableId] =
						valueNodesOfOptionSet[fromNode.stableId] || []).push(toNode);
				} else if (oneEdge.type === EDGE_TYPES.REFERENCES && v1(toNode.properties.role) === DME_ROLES.CLASS) {
					(referencedClassNodeListOfProperty[fromNode.stableId] =
						referencedClassNodeListOfProperty[fromNode.stableId] || []).push(toNode);
				}
			});

			const rangeShapeOf = RANGE_ADDRESSING_REGISTRY[rangeAddressing]({
				baseFieldNames,
				classByDomainId,
				optionSetNodeOfProperty,
				optionSetNodeListOfProperty,
				referencedClassNodeListOfProperty,
				recordDerivationFault,
			});
			const declaredDomainIdListOf = DOMAIN_ADDRESSING_REGISTRY[domainAddressing]({ baseFieldNames, classNodeListOfProperty });

			// ---- MEANING copy: carried only when CEDS said something (absent stays absent) ----
			const carryProseField = ({ cardProperties, cardFieldName, sourceValue }) => {
				const scalar = v1(sourceValue);
				if (!hasProse(scalar)) {
					return;
				}
				cardProperties[cardFieldName] = scalar;
			};

			// ---- emit one HubReference card + its decomposition edges ----
			const emitReference = ({
				referenceTier,
				canonicalKey,
				domainId,
				propertyKey,
				rangeOptionSetId,
				rangeClassId,
				rangeDatatype,
				valueKey,
				qualifierPairs,
				classNode,
				propertyNode,
				optionSetNode,
				classRangeNode,
				valueNode,
				rangeMeaning,
			}) => {
				if (!Array.isArray(qualifierPairs)) {
					recordDerivationFault(
						`${moduleName}: REFUSED — emitReference requires qualifierPairs as an ` +
							`array (property '${propertyKey}', domain '${domainId}'); an absent ` +
							`list must be stated as [], never implied.`,
					);
					return;
				}
				const propertyName = v1(propertyNode.properties[baseFieldNames.name]);
				if (!hasProse(canonicalKey)) {
					recordDerivationFault(
						`${moduleName}: REFUSED — ${referenceTier}-tier card for property ` +
							`'${propertyKey}' in domain '${domainId}' has no canonicalKey.`,
					);
					return;
				}
				if (!classNode) {
					recordDerivationFault(
						`${moduleName}: REFUSED — domainId '${domainId}' resolves to no ` +
							`${DME_ROLES.CLASS} node (property '${propertyKey}').`,
					);
					return;
				}
				if (!hasProse(propertyName)) {
					recordDerivationFault(
						`${moduleName}: REFUSED — property '${propertyKey}' has no name ` +
							`(domain '${domainId}').`,
					);
					return;
				}
				const valueName = valueNode ? v1(valueNode.properties[baseFieldNames.name]) : undefined;
				if (valueNode && !hasProse(valueName)) {
					recordDerivationFault(
						`${moduleName}: REFUSED — value '${valueKey}' has no name ` +
							`(property '${propertyKey}', domain '${domainId}').`,
					);
					return;
				}
				const namelessQualifier = qualifierPairs.find(
					(onePair) => !hasProse(onePair.qualifierName),
				);
				if (namelessQualifier) {
					recordDerivationFault(
						`${moduleName}: REFUSED — qualifier '${namelessQualifier.qualifierKey}' has ` +
							`no name (property '${propertyKey}', domain '${domainId}'); qualifierNames ` +
							`must stay positionally parallel to qualifierKeys.`,
					);
					return;
				}

				// qualifierKeys are SORTED; qualifierNames stay positionally parallel by sorting
				// the PAIRS on the key
				const sortedQualifierPairs = qualifierPairs
					.slice()
					.sort((left, right) =>
						left.qualifierKey < right.qualifierKey
							? -1
							: left.qualifierKey > right.qualifierKey
								? 1
								: 0,
					);
				const sortedQualifierKeys = sortedQualifierPairs.map(
					(onePair) => onePair.qualifierKey,
				);

				const addressSignature = addressSignatureFor({
					canonicalKey,
					domainId,
					propertyKey,
					rangeOptionSetId,
					rangeClassId,
					rangeDatatype,
					valueKey,
					qualifierKeys: sortedQualifierKeys,
				});
				const cardUri = `${hubNamespace}${hubVersion}/${addressSignature}`;

				// name (§1.2): the card's display/matching name — value tier the value's own name,
				// property tier (qualified included) the property's own name; NO " [qualifier]"
				// suffix (qualifier names carry their own field)
				const cardName = valueNode ? valueName : propertyName;

				const cardProperties = {
					_source: hubName,
					role: EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					name: cardName,

					// ---- ADDRESS (§1.1) — ids only; the only inputs to addressSignature ----
					[A.HUB_NAME]: hubName,
					[HR.HUB_VERSION]: hubVersion,
					[HR.REFERENCE_TIER]: referenceTier,
					[A.DOMAIN_ID]: domainId,
					propertyKey,
					[HR.QUALIFIER_KEYS]: sortedQualifierKeys,

					// ---- IDENTITY (§1.2) — derived from the address ----
					[HR.ADDRESS_SIGNATURE]: addressSignature,
					uri: cardUri,
					[HR.CANONICAL_KEY]: canonicalKey,
				};
				if (hasProse(rangeOptionSetId)) {
					cardProperties[A.RANGE_OPTION_SET_ID] = rangeOptionSetId;
				}
				if (hasProse(rangeClassId)) {
					cardProperties[A.RANGE_CLASS_ID] = rangeClassId;
				}
				if (hasProse(rangeDatatype)) {
					cardProperties[HR.RANGE_DATATYPE] = rangeDatatype;
				}
				if (valueNode) {
					cardProperties.valueKey = valueKey;
				}
				// ⟪ctdlHub P3⟫ rangeAsMeaning only: the property's ranges as meaning, each list carried only when non-empty
				// (absent is absent, never [])
				if (rangeMeaning) {
					[
						[HR.RANGE_CLASS_ID_LIST, rangeMeaning.rangeClassIdList],
						[HR.RANGE_CLASS_NAME_LIST, rangeMeaning.rangeClassNameList],
						[HR.RANGE_OPTION_SET_ID_LIST, rangeMeaning.rangeOptionSetIdList],
						[HR.RANGE_OPTION_SET_NAME_LIST, rangeMeaning.rangeOptionSetNameList],
						[HR.RANGE_DATATYPE_LIST, rangeMeaning.rangeDatatypeList],
					]
						.filter(([, rangeValueList]) => rangeValueList.length > 0)
						.forEach(([cardFieldName, rangeValueList]) => {
							cardProperties[cardFieldName] = rangeValueList;
						});
				}

				// ---- MEANING (§1.3) — every tuple slot carries its name and its prose ----
				carryProseField({
					cardProperties,
					cardFieldName: 'domainName',
					sourceValue: classNode.properties[baseFieldNames.name],
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'domainDefinition',
					sourceValue: classNode.properties[baseFieldNames.definition],
				});
				cardProperties.propertyName = propertyName;
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyDefinition',
					sourceValue: propertyNode.properties[baseFieldNames.definition],
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyNotation',
					sourceValue: propertyNode.properties[baseFieldNames.notation],
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyDataType',
					sourceValue: propertyNode.properties[baseFieldNames.dataType],
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyTextFormat',
					sourceValue: propertyNode.properties[baseFieldNames.textFormat],
				});
				if (classRangeNode) {
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeClassName',
						sourceValue: classRangeNode.properties[baseFieldNames.name],
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeClassDefinition',
						sourceValue: classRangeNode.properties[baseFieldNames.definition],
					});
				}
				if (optionSetNode) {
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeOptionSetName',
						sourceValue: optionSetNode.properties[baseFieldNames.name],
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeOptionSetDefinition',
						sourceValue: optionSetNode.properties[baseFieldNames.definition],
					});
				}
				if (valueNode) {
					cardProperties.valueName = valueName;
					carryProseField({
						cardProperties,
						cardFieldName: 'valueDefinition',
						sourceValue: valueNode.properties[baseFieldNames.definition],
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'valueNotation',
						sourceValue: valueNode.properties[baseFieldNames.notation],
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'valuePrefLabel',
						sourceValue: valueNode.properties[baseFieldNames.prefLabel],
					});
				}
				if (sortedQualifierPairs.length) {
					cardProperties.qualifierNames = sortedQualifierPairs.map(
						(onePair) => onePair.qualifierName,
					);
				}

				// ---- PROVENANCE (§1.4) — the always-fields are REQUIRED: a source node with
				// no uri is refused by name, never stamped as an undefined-valued key ----
				const provenanceUriOf = ({ sourceNode, sourceRoleLabel }) => {
					const sourceUri = v1(sourceNode.properties[baseFieldNames.uri]);
					if (!hasProse(sourceUri)) {
						recordDerivationFault(
							`${moduleName}: REFUSED — ${sourceRoleLabel} node ` +
								`'${sourceNode.stableId}' has no uri (property '${propertyKey}', ` +
								`domain '${domainId}'); §1.4 provenance cannot be stamped.`,
						);
						return undefined;
					}
					return sourceUri;
				};
				const domainUri = provenanceUriOf({
					sourceNode: classNode,
					sourceRoleLabel: 'domain class',
				});
				const propertyUri = provenanceUriOf({
					sourceNode: propertyNode,
					sourceRoleLabel: 'property',
				});
				const valueUri = valueNode
					? provenanceUriOf({ sourceNode: valueNode, sourceRoleLabel: 'value' })
					: undefined;
				const rangeUri = optionSetNode
					? provenanceUriOf({
							sourceNode: optionSetNode,
							sourceRoleLabel: 'range option set',
						})
					: classRangeNode
						? provenanceUriOf({
								sourceNode: classRangeNode,
								sourceRoleLabel: 'range class',
							})
						: undefined;
				if (
					domainUri === undefined ||
					propertyUri === undefined ||
					(valueNode && valueUri === undefined) ||
					((optionSetNode || classRangeNode) && rangeUri === undefined)
				) {
					return; // refusal already recorded; no degraded card
				}
				cardProperties[HR.ANCHOR_URI] = valueNode ? valueUri : propertyUri; // ⟪campaign P2, W-A-12⟫ the registry's name, same bytes
				cardProperties.domainUri = domainUri;
				cardProperties.propertyUri = propertyUri;
				if (rangeUri !== undefined) {
					cardProperties.rangeUri = rangeUri;
				}
				if (valueNode) {
					cardProperties.valueUri = valueUri;
				}

				// ---- DERIVED (§1.5) — composed last so it reads the card's own fields ----
				cardProperties.embedText = composeEmbedText({
					referenceTier,
					cardProperties,
				});

				// ⟪campaign P3, W-C-5⟫ the drift gate AT THE PRODUCER: a card carrying a field the table does not declare for
				// its tier, or lacking an 'always' one, is refused by name — no degraded card, as the provenance refusal above
				const cardFieldFaultText = cardFieldRefusal({ fieldTable: HUB_CARD_FIELD_TABLE, referenceTier, cardPropertyNameList: Object.keys(cardProperties), ...hubFieldScope });
				if (cardFieldFaultText) {
					recordDerivationFault(`${moduleName}: REFUSED — card '${cardUri}' (property '${propertyKey}', domain '${domainId}') ${cardFieldFaultText}`);
					return;
				}

				// ⟪ctdlHub P3 step 5a⟫ a property card of a hub that also mints terms points at the term card of its own
				// property IRI. Both tiers are minted from the same base, so a miss is a bug, refused by name before the
				// card is emitted.
				const termCardStableId =
					mintsTermTier && referenceTier === REFERENCE_TIER.PROPERTY
						? termCardStableIdByTermIri[propertyUri]
						: undefined;
				if (mintsTermTier && referenceTier === REFERENCE_TIER.PROPERTY && termCardStableId === undefined) {
					recordDerivationFault(
						`${moduleName}: REFUSED — property card '${cardUri}' (property '${propertyKey}', domain ` +
							`'${domainId}') has no term card for its property IRI '${propertyUri}'; both tiers come from ` +
							`the same base, so this is a derivation bug, not a gap in the source.`,
					);
					return;
				}

				nodes.push({
					labels: [
						NODE_LABELS.FORGED_NODE,
						EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					],
					stableId: cardUri,
					role: EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					properties: cardProperties,
				});

				const addEdge = (edgeType, toStableId) => {
					edges.push({
						type: edgeType,
						fromRef: { source: hubName, id: cardUri },
						toRef: { source: hubName, id: toStableId },
						properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
					});
				};
				addEdge(hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.DOMAIN), classNode.stableId);
				addEdge(hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.PROPERTY), propertyNode.stableId);
				if (optionSetNode) {
					addEdge(hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.RANGE), optionSetNode.stableId);
				} else if (classRangeNode) {
					addEdge(hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.RANGE), classRangeNode.stableId);
				}
				if (rangeMeaning) {
					rangeMeaning.rangeNodeList.forEach((rangeNode) => {
						addEdge(hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.RANGE), rangeNode.stableId);
					});
				}
				if (valueNode) {
					addEdge(hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.VALUE), valueNode.stableId);
				}
				sortedQualifierPairs.forEach((onePair) => {
					addEdge(hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.QUALIFIER), onePair.qualifierNode.stableId);
				});
				addEdge(IN_HUB_EDGE_TYPE, hubDefinitionStableId);
				if (termCardStableId !== undefined) {
					addEdge(HUB_TERM_REFERENCE_EDGE_TYPE, termCardStableId);
				}

				return { stableId: cardUri, addressSignature };
			};

			// ---- ⟪ctdlHub P3 step 5⟫ emit one TERM-tier card: one per hub-native class, property, option set and value,
			//      addressed by the term's own IRI (the base node's declared uri field) ----
			const termCardStableIdByTermIri = {};
			const emitTermReference = ({ baseNode, termKind }) => {
				const termIri = v1(baseNode.properties[baseFieldNames.uri]);
				const termName = v1(baseNode.properties[baseFieldNames.name]);
				if (!hasProse(termIri) || !hasProse(termName)) {
					recordDerivationFault(
						`${moduleName}: REFUSED — ${termKind} node '${baseNode.stableId}' has no ` +
							`${hasProse(termIri) ? 'name' : 'uri'}; a term card is addressed by the term's IRI and named by its name.`,
					);
					return undefined;
				}
				if (termCardStableIdByTermIri[termIri] !== undefined) {
					recordDerivationFault(
						`${moduleName}: REFUSED — two base nodes carry the term IRI '${termIri}' (the second is ` +
							`'${baseNode.stableId}'); a term card is one per IRI, so the base is not one term per node.`,
					);
					return undefined;
				}
				const addressSignature = termAddressSignatureFor({ termIri });
				const cardUri = `${hubNamespace}${hubVersion}/${addressSignature}`;
				const cardProperties = {
					_source: hubName,
					role: EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					name: termName,
					[A.HUB_NAME]: hubName,
					[HR.HUB_VERSION]: hubVersion,
					[HR.REFERENCE_TIER]: REFERENCE_TIER.TERM,
					[HR.TERM_IRI]: termIri,
					[HR.ADDRESS_SIGNATURE]: addressSignature,
					uri: cardUri,
					[HR.TERM_NAME]: termName,
					[HR.TERM_KIND]: termKind,
					[HR.ANCHOR_URI]: termIri,
				};
				carryProseField({
					cardProperties,
					cardFieldName: HR.TERM_DEFINITION,
					sourceValue: baseNode.properties[baseFieldNames.definition],
				});
				cardProperties.embedText = composeEmbedText({
					referenceTier: REFERENCE_TIER.TERM,
					cardProperties,
				});
				const cardFieldFaultText = cardFieldRefusal({ fieldTable: HUB_CARD_FIELD_TABLE, referenceTier: REFERENCE_TIER.TERM, cardPropertyNameList: Object.keys(cardProperties), ...hubFieldScope });
				if (cardFieldFaultText) {
					recordDerivationFault(`${moduleName}: REFUSED — term card '${cardUri}' (term '${termIri}') ${cardFieldFaultText}`);
					return undefined;
				}
				nodes.push({
					labels: [NODE_LABELS.FORGED_NODE, EQUIVALENCE_NODE_LABELS.HUB_REFERENCE],
					stableId: cardUri,
					role: EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					properties: cardProperties,
				});
				[
					[hubEdgeType(hubName, HUB_DECOMPOSITION_SLOTS_BY_NAME.TERM), baseNode.stableId],
					[IN_HUB_EDGE_TYPE, hubDefinitionStableId],
				].forEach(([edgeType, toStableId]) => {
					edges.push({
						type: edgeType,
						fromRef: { source: hubName, id: cardUri },
						toRef: { source: hubName, id: toStableId },
						properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
					});
				});
				termCardStableIdByTermIri[termIri] = cardUri;
				return cardUri;
			};

			// ---- PASS 0 ⟪ctdlHub P3⟫: the term tier, FIRST, so the property pass can point at it ----
			let termTierCount = 0;
			const termRoleList = mintsTermTier ? Object.keys(TERM_KIND_BY_ROLE) : [];
			termRoleList.forEach((oneRole) => {
				nodesByRole[oneRole].forEach((baseNode) => {
					if (emitTermReference({ baseNode, termKind: TERM_KIND_BY_ROLE[oneRole] })) {
						termTierCount++;
					}
				});
			});

			// ---- PASS 1: property tier (one card per declared domain) + value tier ----
			// skipReport (RULING S-3): a DmeProperty with ZERO declared domains has no tuple —
			// it is SKIPPED BY NAME into an explicit report (like the divergence report), never
			// silently dropped and never refused (forge totality is preserved).
			const skipReport = [];
			let propertyTierCount = 0;
			let valueTierCount = 0;
			// ⟪ctdlHub P3⟫ the tuple tiers run only for a hub that mints one of them; a term-only hub has no tuples to skip
			const tuplePropertyNodeList = mintsPropertyTier || mintsValueTier ? nodesByRole[DME_ROLES.PROPERTY] : [];
			tuplePropertyNodeList.forEach((propertyNode) => {
				const propertyProps = propertyNode.properties;
				const propertyKey = v1(propertyProps[baseFieldNames.canonicalKey]);

				// EVERY DECLARED DOMAIN, as the hub's declared domainAddressing mode finds them (the incumbent's
				// multi-domain rule: each declared domain is a different idea; addressSignature includes domainId so
				// the per-domain cards are distinct by construction)
				const declaredDomainIds = declaredDomainIdListOf(propertyNode);
				if (!declaredDomainIds.length) {
					skipReport.push({
						reason: 'zeroDeclaredDomains',
						role: DME_ROLES.PROPERTY,
						[sourceIdFieldName]: v1(propertyProps[sourceIdFieldName]),
						propertyKey,
						name: v1(propertyProps[baseFieldNames.name]),
					});
					return;
				}

				// ⟪ctdlHub P3 step 3⟫ the range, as the hub's declared rangeAddressing mode reads it
				const rangeShape = rangeShapeOf(propertyNode);
				if (!rangeShape) {
					return; // refusal already recorded by name; no degraded card
				}
				const { propertyCardRange, valueCardRangeList } = rangeShape;

				declaredDomainIds.forEach((domainId) => {
					const classNode = classByDomainId[domainId];

					if (mintsPropertyTier) {
						const emittedPropertyCard = emitReference({
							referenceTier: REFERENCE_TIER.PROPERTY,
							canonicalKey: propertyKey,
							domainId,
							propertyKey,
							rangeOptionSetId: propertyCardRange.rangeOptionSetId,
							rangeClassId: propertyCardRange.rangeClassId,
							rangeDatatype: propertyCardRange.rangeDatatype,
							valueKey: '',
							qualifierPairs: [],
							classNode,
							propertyNode,
							optionSetNode: propertyCardRange.optionSetNode,
							classRangeNode: propertyCardRange.classRangeNode,
							rangeMeaning: propertyCardRange.rangeMeaning,
						});
						if (emittedPropertyCard) {
							propertyTierCount++;
						}
					}

					const valueCardRangeListForTier = mintsValueTier ? valueCardRangeList : [];
					valueCardRangeListForTier.forEach(({ rangeOptionSetId, optionSetNode }) => {
						const valueNodes =
							valueNodesOfOptionSet[optionSetNode.stableId] || [];
						valueNodes.forEach((valueNode) => {
							const valueKey = v1(valueNode.properties[baseFieldNames.canonicalKey]);
							const emittedValueCard = emitReference({
								referenceTier: REFERENCE_TIER.VALUE,
								canonicalKey: valueKey,
								domainId,
								propertyKey,
								rangeOptionSetId,
								rangeClassId: undefined,
								rangeDatatype: undefined,
								valueKey,
								qualifierPairs: [],
								classNode,
								propertyNode,
								optionSetNode,
								valueNode,
							});
							if (emittedValueCard) {
								valueTierCount++;
							}
						});
					});
				});
			});

			// ---- PASS 2: qualified references (§4.3 identification pattern, stem-matched —
			//      the incumbent's enumeration verbatim) ----
			// A hub that declares NO qualifiedReference has no identification patterns to find: pass 2
			// is skipped ENTIRELY and identificationPatterns is explicitly [] (SPEC §4.4 [R1 Q7]).
			// ABSENT IS ABSENT — this is a declared capability, not a default that silently produces
			// zero because the loop happened to match nothing.
			let qualifiedCount = 0;
			const identificationPatterns = [];
			// ⟪ctdlHub P3⟫ qualified cards are PROPERTY-tier cards, so a hub that does not mint that tier has no pass 2
			const classStableIdListForPass2 =
				qualifiedReference === undefined || !mintsPropertyTier ? [] : Object.keys(propertyNodesOfClass);
			classStableIdListForPass2.forEach((classStableId) => {
				const classNode = nodeByStableId[classStableId];
				const memberPropertyNodes = propertyNodesOfClass[classStableId];
				memberPropertyNodes.forEach((typePropertyNode) => {
					const typePropertyName = v1(typePropertyNode.properties[baseFieldNames.name]);
					const stemMatch = qualifiedReference.typePropertyPattern.exec(
						typeof typePropertyName === 'string' ? typePropertyName : '',
					);
					if (!stemMatch) {
						return;
					}
					const typeOptionSetNode =
						optionSetNodeOfProperty[typePropertyNode.stableId];
					if (!typeOptionSetNode) {
						return; // qualifier must be enumerated to supply qualifier values
					}
					const stem = stemMatch[1];
					// expand the declared TEMPLATES. `{stem}` is the one substitution, and it is a literal
					// replace rather than a regex so a stem containing regex metacharacters cannot change
					// the shape of the name it produces.
					const tokenCandidateNames = qualifiedReference.tokenNamesForStem.map((oneTemplate) =>
						oneTemplate.split('{stem}').join(stem),
					);
					const tokenNodes = memberPropertyNodes.filter(
						(onePropertyNode) =>
							tokenCandidateNames.indexOf(v1(onePropertyNode.properties[baseFieldNames.name])) !==
							-1,
					);
					if (tokenNodes.length !== 1) {
						// ambiguous or absent token — record and SKIP (never fabricate a pairing)
						identificationPatterns.push({
							className: v1(classNode.properties[baseFieldNames.name]),
							typeProperty: typePropertyName,
							stem,
							tokenMatchCount: tokenNodes.length,
							skipped: true,
						});
						return;
					}
					const tokenNode = tokenNodes[0];
					const tokenProps = tokenNode.properties;
					const tokenDomainId = v1(tokenProps[baseFieldNames.domainId]);
					const tokenRangeClassId = v1(tokenProps[baseFieldNames.rangeClassId]);
					const tokenRangeClassNode = tokenRangeClassId
						? classByDomainId[tokenRangeClassId]
						: undefined;
					const qualifierValueNodes =
						valueNodesOfOptionSet[typeOptionSetNode.stableId] || [];
					qualifierValueNodes.forEach((qualifierValueNode) => {
						const emittedQualifiedCard = emitReference({
							referenceTier: REFERENCE_TIER.PROPERTY,
							canonicalKey: v1(tokenProps[baseFieldNames.canonicalKey]),
							domainId: tokenDomainId,
							propertyKey: v1(tokenProps[baseFieldNames.canonicalKey]),
							rangeOptionSetId: undefined,
							rangeClassId: tokenRangeClassId,
							rangeDatatype: tokenRangeClassId
								? undefined
								: v1(tokenProps[baseFieldNames.rangeDatatype]),
							valueKey: '',
							qualifierPairs: [
								{
									qualifierKey: v1(qualifierValueNode.properties[baseFieldNames.canonicalKey]),
									qualifierName: v1(qualifierValueNode.properties[baseFieldNames.name]),
									qualifierNode: qualifierValueNode,
								},
							],
							classNode: classByDomainId[tokenDomainId],
							propertyNode: tokenNode,
							classRangeNode: tokenRangeClassNode,
						});
						if (emittedQualifiedCard) {
							qualifiedCount++;
						}
					});
					identificationPatterns.push({
						className: v1(classNode.properties[baseFieldNames.name]),
						typeProperty: typePropertyName,
						stem,
						tokenProperty: v1(tokenProps[baseFieldNames.name]),
						tokenKey: v1(tokenProps[baseFieldNames.canonicalKey]),
						qualifierValueCount: qualifierValueNodes.length,
						skipped: false,
					});
				});
			});

			if (derivationFaults.length) {
				const shownFaults = derivationFaults.slice(0, 10).join('\n');
				callback(
					`${moduleName}.forgeHub: REFUSED — ${derivationFaults.length} derivation ` +
						`fault(s); no degraded card is emitted. First ${Math.min(
							derivationFaults.length,
							10,
						)}:\n${shownFaults}`,
				);
				return;
			}

			// ---- the divergence report (§5): description vs definition on the source nodes ----
			const divergenceReport = [];
			[
				DME_ROLES.CLASS,
				DME_ROLES.PROPERTY,
				DME_ROLES.OPTION_SET,
				DME_ROLES.OPTION_VALUE,
			].forEach((oneRole) => {
				nodesByRole[oneRole].forEach((oneNode) => {
					const sourceDescription = v1(oneNode.properties[baseFieldNames.description]);
					const sourceDefinition = v1(oneNode.properties[baseFieldNames.definition]);
					// 'both exist' means both carry PROSE (hasProse, the module's one existence
					// rule — S-5): null and '' are not prose and cannot diverge from anything
					if (
						hasProse(sourceDescription) &&
						hasProse(sourceDefinition) &&
						String(sourceDescription) !== String(sourceDefinition)
					) {
						divergenceReport.push({
							role: oneRole,
							[sourceIdFieldName]: v1(oneNode.properties[sourceIdFieldName]),
							name: v1(oneNode.properties[baseFieldNames.name]),
							description: sourceDescription,
							definition: sourceDefinition,
						});
					}
				});
			});
			divergenceReport.sort((left, right) => {
				const leftSortKey = `${left.role}|${left[sourceIdFieldName]}`;
				const rightSortKey = `${right.role}|${right[sourceIdFieldName]}`;
				return leftSortKey < rightSortKey ? -1 : leftSortKey > rightSortKey ? 1 : 0;
			});

			// ---- the HubDefinition card (§2) — the namespace authority ----
			// ⟪campaign P3, W-C-5⟫ the profile IS the field table, serialised (cardStructureVersion 3: the five hand-kept lists of
			// version 2 are gone; a reader keyed on addressSlots must read fieldList)
			// ⟪ctdlHub P3⟫ the hub's VIEW of the table (hubFieldTableOf: its tierList and rangeAddressing), so a hub without
			// the term tier serialises exactly the pre-P3 profile
			const slotProfile = slotProfileFromFieldTable({
				cardStructureVersion: HUB_CARD_STRUCTURE_VERSION,
				fieldTable: HUB_CARD_FIELD_TABLE,
				addressSignatureFieldOrder: ADDRESS_SIGNATURE_FIELD_ORDER,
				termAddressSignatureFieldOrder: TERM_ADDRESS_SIGNATURE_FIELD_ORDER,
				...hubFieldScope,
			});
			const rootProps = rootNode.properties;
			// ⟪ctdlHub P3 step 2; PLAN §2.4 H-b⟫ READ through rootFieldNames; the five output names are unchanged
			const sourceProvenance = JSON.stringify({
				standardKey: v1(rootProps[rootFieldNames.standardKey]),
				snapshotKey: v1(rootProps[rootFieldNames.snapshotKey]),
				publishedVersion: v1(rootProps[rootFieldNames.publishedVersion]),
				sourceVersion: v1(rootProps[rootFieldNames.version]),
				sourceUrl: v1(rootProps[rootFieldNames.sourceUrl]),
				forgeModule: provenanceLabel.forgeModule,
				forgeModuleVersion: provenanceLabel.forgeModuleVersion,
			});
			nodes.push({
				labels: [
					NODE_LABELS.FORGED_NODE,
					EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
				],
				stableId: hubDefinitionStableId,
				role: EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
				properties: {
					_source: hubName,
					role: EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
					name: hubDisplayName,
					uri: hubDefinitionStableId,
					[HD.HUB_NAME]: hubName,
					[HD.DISPLAY_NAME]: hubDisplayName,
					[HD.VERSION]: hubVersion,
					[HD.NAMESPACE]: hubNamespace,
					[HD.CANONICAL_KEY_NAME]: canonicalKeyName,
					[HD.CANONICAL_KEY_MINTED]: canonicalKeyMinted,
					[HD.SLOT_PROFILE]: JSON.stringify(slotProfile),
					[HD.SOURCE_PROVENANCE]: sourceProvenance,
				},
			});

			// ---- deterministic ordering for a byte-stable block ----
			nodes.sort((left, right) =>
				left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0,
			);
			edges.sort((left, right) => {
				const leftSortKey = `${left.type}|${left.fromRef.id}|${left.toRef.id}`;
				const rightSortKey = `${right.type}|${right.fromRef.id}|${right.toRef.id}`;
				return leftSortKey < rightSortKey ? -1 : leftSortKey > rightSortKey ? 1 : 0;
			});

			callback('', {
				nodes,
				edges,
				divergenceReport,
				skipReport,
				hubDefinitionStableId,
				counts: {
					hubDefinition: 1,
					termTier: termTierCount,
					propertyTier: propertyTierCount,
					valueTier: valueTierCount,
					qualified: qualifiedCount,
					hubReferenceTotal: termTierCount + propertyTierCount + valueTierCount + qualifiedCount,
					nodeTotal: nodes.length,
					edgeTotal: edges.length,
				},
				identificationPatterns,
			});
		};

		return { forgeHub, addressSignatureFor, termAddressSignatureFor, hubDefinitionStableId };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
