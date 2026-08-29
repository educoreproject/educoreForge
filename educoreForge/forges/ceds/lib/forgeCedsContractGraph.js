'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCedsContractGraph.js — H3, the CEDS walk, on the Forge Framework's kit
// (SPEC-forgeFramework-v1.md §5, §6.2; hub-kit-role Phase 1). Migrated from forgeCeds.js:131-811,
// which was a bespoke buildContractGraph that minted its own nodes and edges. The FRAMEWORK now
// owns the pipeline, the root, the universal property set, the embed pass, the integrity pass and
// the finalizers; this file owns only what is CEDS's: which entities exist, how they are addressed,
// what they own, and what searchText they carry.
//
// WHAT THIS FILE DELIBERATELY NO LONGER DOES, because the framework does it:
//   * mint the DmeStandardRoot          — rootNode.js, from cedsForgeDeclaration (rootStableIdFrom
//                                         'sourceUrl', which rootNode.js:44-55 names CEDS for)
//   * stamp _id / _source / role / uri / searchText / parentId / path  — kit.makeNode
//   * stamp provenanceTier on every edge — kit.addEdge
//   * call finalizeStructuralContract    — forge-framework.js step 6 (still LAST over structure, so
//                                         depth is still DERIVED and still supersedes any producer
//                                         stamp, and crossRefs is still filled with '[]' only where
//                                         a node harvested none)
//   * run the embedding pass             — embedPass.js, filtered by nonEmbeddableRoleList
//
// BYTE FIDELITY. The pre-migration block id is 09a5d658…487c33 at 419,649,468 and this file must
// reproduce it. Three facts make that achievable and all three were MEASURED at Phase 1 entry, not
// assumed:
//   1. PROPERTY ORDER IS NOT A BYTE. Harvest re-reads the loaded graph and emits properties with
//      SORTED keys (replay-engine.js shapeNode; visible directly in the block text). So the kit
//      assembling the same property SET in a different order is byte-neutral. What still matters is
//      which value WINS a collision — see the annotation note below.
//   2. _id IS NOT A BYTE AT ALL. replay-engine.js:353 excludes it from the harvested text (and :111
//      overwrites it at load). The string "_id" occurs ZERO times in the 420MB CEDS block. The
//      bespoke forge's `_id: 'ceds:<canonicalCedsId>'` therefore vanishes harmlessly.
//   3. DEPTH IS NOT PRODUCER-STATED. structural-contract.js:181 overwrites it. The bespoke walk
//      stamped depth 1/2/3 by hand; the kit's `structural` carries only { parentId, path } and the
//      derived value is identical.
//
// ⚠ THE ANNOTATION SPREAD IS ASYMMETRIC IN THE SOURCE AND THE ASYMMETRY IS REPRODUCED HERE.
// forgeCeds.js:222 spread `rawEntity.annotations` FIRST, so a curated field WINS a name contest
// ("the ordering is the difference between 'cannot happen' and 'cannot happen silently'"). But
// forgeCeds.js:424 spread `oneTerm.annotations` LAST on vocabulary terms, so there an annotation
// WINS. Those are opposite ends of the kit's node: `precedingProperties` is spread first,
// `carriedProperties` last. Mapping them the same way would silently change values on the 26
// vocabulary terms without changing any count — invisible to every census gate.

const path = require('path');
const normalize = require('./normalize');
const forgeDeclaration = require('./cedsForgeDeclaration'); // H1 — the constants live there, once

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const { DME_ROLES, EDGE_TYPES, CANONICAL_ADDRESS_PROPERTIES } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);

// canonical-address component property NAMES, from the registry (forgeCeds.js:62)
const A = CANONICAL_ADDRESS_PROPERTIES;

// THE PER-STANDARD LABEL IS PER-ROLE, NOT PER-STANDARD, AND THAT IS A BLOCK BYTE.
// A registry keyed by role, never a branch. The four ENTITY roles each carry their own label
// (forgeCeds.js:508 'CedsClass', :665 'CedsProperty', :715 'CedsOptionSet', :774 'CedsOptionValue');
// the three ANONYMOUS/derived roles and the root carry 'CedsOntology' (:319, :367, :429, :468).
//
// ⚠ THIS COST ONE FAILED ORACLE RUN AND IS WRITTEN DOWN SO IT COSTS NOBODY ANOTHER. The first
// Phase 1 re-forge collapsed all seven to 'CedsOntology' — the name of the CONSTANT invited it —
// and produced b7351c60… at 419,591,071 against the expected 09a5d658… at 419,649,468. The node and
// edge COUNTS were identical (119,805 / 496,119) and every CEDS suite was green, because a label is
// not a count and no suite asserted it. The whole −58,397 delta reconciled to the character from the
// role census alone: CedsClass(9)→(12) +3×402 = +1,206; CedsProperty(12)→(12) 0×2,324 = 0;
// CedsOptionSet(13)→(12) −1×965 = −965; CedsOptionValue(15)→(12) −3×19,546 = −58,638. Sum −58,397.
// Only byte-identity caught it, which is precisely why this campaign uses byte-identity as its oracle.
const PER_STANDARD_LABEL_BY_ROLE = Object.freeze({
	[DME_ROLES.CLASS]: 'CedsClass',
	[DME_ROLES.PROPERTY]: 'CedsProperty',
	[DME_ROLES.OPTION_SET]: 'CedsOptionSet',
	[DME_ROLES.OPTION_VALUE]: 'CedsOptionValue',
	[DME_ROLES.EDIT_HISTORY_ENTRY]: 'CedsOntology',
	[DME_ROLES.RESTRICTION]: 'CedsOntology',
	[DME_ROLES.VOCABULARY_TERM]: 'CedsOntology',
});
// refused by name rather than defaulted: an unlisted role would otherwise silently take some other
// standard's label and move the block id without moving any count (Profile: absent is a fault)
const perStandardLabelFor = (role) => {
	const perStandardLabel = PER_STANDARD_LABEL_BY_ROLE[role];
	if (perStandardLabel === undefined) {
		throw new Error(
			`${moduleName}: no per-standard label declared for role '${role}' — ` +
				`add it to PER_STANDARD_LABEL_BY_ROLE; the label is a block byte and is never defaulted`,
		);
	}
	return perStandardLabel;
};
// THE STANDARD'S OWN NAME IS DECLARED ONCE, IN H1, AND READ HERE — NEVER RE-TYPED.
// It is the same string in four distinct roles, and having it as a literal here made a value that
// invariant I12 asserts must be EQUAL into a value that merely HAPPENED to be equal:
//   * _source on every node            — stamped by the kit from forgeDeclaration.standardSource
//   * hubName on every structural node  — stamped below (WHITEPAPER §8; forgeCeds.js:85)
//   * hubName on the hub's own cards    — lib/cedsHubDeclaration.js, outside this file (Phase 2c);
//     the hub framework now ASSERTS it equals this declaration's standardSource by name (I12)
//   * the searchText ladder's standardName / owningName default — the SPEC §11.5 BYTE MANDATE,
//     whose own phrasing is `owningName || standardSource`, not `|| 'CEDS'`
// Raised by the independent Phase 1 review (S3): a triply-declared value turns an I12 assertion into
// something that merely happens to hold. Byte-neutral by construction — the same string — and PROVEN
// so by a full CEDS re-forge after the change (I1 must remain 09a5d658…487c33 at 419,649,468).
// Precedent: forgeEdfiContractGraph.js:64 requires its own declaration for exactly this reason.
const STANDARD_SOURCE = forgeDeclaration.standardSource;

// the fields one change record may carry, named exactly as the SOURCE names them, which is what the
// round-trip compiler's EDIT_HISTORY_ENTRY_FIELDS expects (forgeCeds.js:52-59)
const EDIT_HISTORY_ENTRY_PROPERTY_NAMES = [
	'changeDescription',
	'changeVersion',
	'changeNew',
	'changeUpdated',
	'changePropertyAddedToClass',
	'issueLink',
];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// emitContractGraph — the H3 hook. PURE, synchronous, deterministic; throws named Errors
		// (the framework's step-5 adapter is the ONE try/catch). Returns the kit's collected arrays.
		const emitContractGraph = ({ parsed, metadata, kit }) => {
			const { entities, maps } = parsed.cedsOntology;
			const { classes, properties, optionSets, optionValues } = entities;
			const { classByUri, optionSetByUri } = maps;

			// the root's stableId. rootStableIdFrom is 'sourceUrl', so this is metadata.sourceUrl by
			// construction; read from the kit so there is ONE statement of the root's identity.
			const rootStableId = kit.rootStableId;

			// -----------------------------------------------------------------
			// canonicalFor — resolve a raw entity's canonical cedsId; THROWS on a miss (R3, never
			// silent). CEDS is the hub, so an unnormalizable anchor is a refusal, not an absence —
			// which is why the declaration's cedsAnchorAbsentSentinelList is empty and why this uses
			// CEDS's own normalize rather than kit.cedsAnchorValue (whose contract returns
			// { absent: true } for an empty value). forgeCeds.js:139-153, verbatim behaviour.
			// -----------------------------------------------------------------
			const canonicalFor = (rawCedsId, kind, uri) => {
				const result = normalize.normalizeCedsId({ rawValue: rawCedsId, kind });
				if (!result.error) {
					return result.cedsId;
				}
				const fromUri = normalize.normalizeCedsId({ rawValue: uri, kind });
				if (!fromUri.error) {
					return fromUri.cedsId;
				}
				throw new Error(
					`${moduleName}: cannot normalize cedsId for ${kind} '${uri}' ` +
						`(raw '${rawCedsId}'): ${result.error}`,
				);
			};

			// -----------------------------------------------------------------
			// crossRefsForCeds — a CEDS node's own native cross-reference: its canonical cedsId in
			// the `ceds` system (DESIGN §E shape). CEDS is the hub, so its only native
			// self-reference is its own canonical id. Rendered through kit.crossRefsJson, which
			// fixes the { system, id, raw, locator } key order (D22) — the JSON string is a byte.
			// -----------------------------------------------------------------
			const crossRefsJsonForCeds = ({ canonicalCedsId, rawAnchor }) =>
				kit.crossRefsJson([
					{
						system: 'ceds',
						id: canonicalCedsId,
						raw: rawAnchor === undefined || rawAnchor === null ? null : `${rawAnchor}`,
						locator: 'dc:identifier',
					},
				]);

			// -----------------------------------------------------------------
			// addressPropertiesFor — the Phase 2 canonical-address components (per-slot id table,
			// §4.2). The node stamps the slot it IS; the caller supplies the OTHER slots it points
			// at. forgeCeds.js:171-190, verbatim.
			// -----------------------------------------------------------------
			const addressPropertiesFor = ({ kind, canonicalCedsId, addressSlots }) => {
				const addressProperties = {
					[A.HUB_NAME]: STANDARD_SOURCE,
					[A.HUB_VERSION]: metadata.version,
				};
				if (kind === 'property' || kind === 'optionValue') {
					addressProperties[A.CANONICAL_KEY] = canonicalCedsId; // durable join key
				}
				if (kind === 'class') {
					addressProperties[A.DOMAIN_ID] = canonicalCedsId; // the class IS the domain slot
				}
				if (kind === 'optionSet') {
					addressProperties[A.RANGE_OPTION_SET_ID] = canonicalCedsId; // the set IS the range slot
				}
				if (addressSlots) {
					if (addressSlots.domainId) {
						addressProperties[A.DOMAIN_ID] = addressSlots.domainId;
					}
					if (addressSlots.rangeOptionSetId) {
						addressProperties[A.RANGE_OPTION_SET_ID] = addressSlots.rangeOptionSetId;
					}
					if (addressSlots.rangeClassId) {
						addressProperties[A.RANGE_CLASS_ID] = addressSlots.rangeClassId;
					}
					if (addressSlots.rangeDatatype) {
						addressProperties[A.RANGE_DATATYPE] = addressSlots.rangeDatatype;
					}
				}
				return addressProperties;
			};

			// -----------------------------------------------------------------
			// makeEntityNode — the four ordinary CEDS kinds through the kit's ONE door.
			// annotations go to precedingProperties (spread FIRST — a curated field wins).
			// -----------------------------------------------------------------
			const makeEntityNode = ({
				role,
				rawEntity,
				kind,
				searchTextElement,
				extraProperties,
				structural,
				addressSlots,
				origin,
			}) => {
				const canonicalCedsId = canonicalFor(rawEntity.cedsId, kind, rawEntity.uri);
				const stableId = rawEntity.uri; // CEDS stableUriPropertyName = 'uri'
				const node = kit.makeNode({
					role,
					perStandardLabel: perStandardLabelFor(role),
					stableId,
					name: searchTextElement.name,
					// NO '' DEFAULT. An absent description must stay ABSENT so the round trip can tell
					// "CEDS said nothing" from "CEDS said nothing useful". (The pre-migration comment
					// here claimed 27 option values carry a blank description; MEASURED at Phase 1
					// entry against the emitted block text, that count is ZERO, which is why this
					// bundle declares no coercion allowance. The false comment is not carried forward.)
					description: rawEntity.description,
					structural,
					precedingProperties: rawEntity.annotations || {},
					carriedProperties: {
						...(rawEntity.declaredTypes ? { declaredTypes: rawEntity.declaredTypes } : {}),
						...(rawEntity.foreignRangeRefs
							? { foreignRangeRefs: rawEntity.foreignRangeRefs }
							: {}),
						cedsId: canonicalCedsId, // canonical anchor (R3)
						cedsOriginalAnchorPropertyName: ['dc:identifier'], // native anchor forms (R3)
						crossRefs: crossRefsJsonForCeds({
							canonicalCedsId,
							rawAnchor: rawEntity.cedsId,
						}),
						...addressPropertiesFor({ kind, canonicalCedsId, addressSlots }),
						...(extraProperties || {}),
					},
					searchTextElement: { role, ...searchTextElement },
					origin,
				});
				return { node, canonicalCedsId, stableId };
			};

			// -----------------------------------------------------------------
			// addEditHistoryNodes — one node per change record, ORDERED BY FILE POSITION.
			// Identity is DERIVED (`<ownerUri>#editHistory/<sequence>`) because the records are
			// ANONYMOUS in the source; reproducible from the source alone, so forging twice yields
			// the same ids. SEQUENCE IS FILE ORDER, NEVER CHRONOLOGY. No searchText and no
			// embedding — the role is declared non-embeddable, and the kit omits searchText for it.
			// -----------------------------------------------------------------
			const addEditHistoryNodes = ({ ownerStableId, ownerCedsId, editHistory }) => {
				if (!editHistory || !editHistory.length) {
					return;
				}
				editHistory.forEach((oneEntry) => {
					const stableId = `${ownerStableId}#editHistory/${oneEntry.sequence}`;
					const carriedProperties = { sequence: oneEntry.sequence, ownerCedsId };
					EDIT_HISTORY_ENTRY_PROPERTY_NAMES.forEach((oneName) => {
						if (oneEntry[oneName] !== undefined && oneEntry[oneName] !== '') {
							carriedProperties[oneName] = oneEntry[oneName];
						}
					});
					kit.makeNode({
						role: DME_ROLES.EDIT_HISTORY_ENTRY,
						perStandardLabel: perStandardLabelFor(DME_ROLES.EDIT_HISTORY_ENTRY),
						stableId,
						name: `${ownerCedsId} change ${oneEntry.sequence}`,
						structural: {
							parentId: ownerStableId,
							path: `${ownerCedsId}.editHistory[${oneEntry.sequence}]`,
						},
						carriedProperties,
						origin: `editHistory of ${ownerCedsId}`,
					});
					kit.addEdge({
						edgeType: EDGE_TYPES.HAS_EDIT_HISTORY,
						fromStableId: ownerStableId,
						toStableId: stableId,
						edgeContext: `editHistory of ${ownerCedsId}`,
					});
				});
			};

			// -----------------------------------------------------------------
			// addRestrictionNodes — owl:Restriction blocks, ORDERED BY FILE POSITION. Identical
			// treatment to addEditHistoryNodes and for identical reasons. The two resource
			// references are carried as PROPERTIES rather than edges: a HAS_RESTRICTION -> onProperty
			// edge chain would assert a traversal CEDS does not make.
			// -----------------------------------------------------------------
			const addRestrictionNodes = ({ ownerStableId, ownerCedsId, restrictions }) => {
				if (!restrictions || !restrictions.length) {
					return;
				}
				restrictions.forEach((oneRestriction) => {
					const stableId = `${ownerStableId}#restriction/${oneRestriction.sequence}`;
					const carriedProperties = { sequence: oneRestriction.sequence, ownerCedsId };
					if (oneRestriction.onProperty) {
						carriedProperties.onProperty = oneRestriction.onProperty;
					}
					if (oneRestriction.allValuesFrom) {
						carriedProperties.allValuesFrom = oneRestriction.allValuesFrom;
					}
					kit.makeNode({
						role: DME_ROLES.RESTRICTION,
						perStandardLabel: perStandardLabelFor(DME_ROLES.RESTRICTION),
						stableId,
						name: `${ownerCedsId} restriction ${oneRestriction.sequence}`,
						structural: {
							parentId: ownerStableId,
							path: `${ownerCedsId}.restriction[${oneRestriction.sequence}]`,
						},
						carriedProperties,
						origin: `restriction of ${ownerCedsId}`,
					});
					kit.addEdge({
						edgeType: EDGE_TYPES.HAS_RESTRICTION,
						fromStableId: ownerStableId,
						toStableId: stableId,
						edgeContext: `restriction of ${ownerCedsId}`,
					});
				});
			};

			// -----------------------------------------------------------------
			// addVocabularyTermNodes — CEDS's own vocabulary, with MINTED identity (`VT<localName>`),
			// a pure function of the source URI's local name so it is stable across re-forges.
			// sourceElementName is carried because these arrive in FOUR different source shapes and
			// the round trip must re-emit each in the shape the source used; reconstructing it from
			// the role would be guessing.
			//
			// ⚠ NEVER SUBSTITUTE localName FOR A MISSING LABEL. The four FOREIGN declarations carry
			// only rdfs:isDefinedBy, and synthesising a name made the compiler emit 4 rdfs:label
			// statements CEDS never made — INVENTED, the category that matters most. So `name` is
			// passed only when the source states it; the kit OMITS an absent name and COUNTS it
			// (ruling FR4), which is exactly the four nameless nodes measured at Phase 1 entry.
			//
			// ⚠ ANNOTATIONS ARE SPREAD LAST HERE, unlike makeEntityNode. See the file header.
			// -----------------------------------------------------------------
			const addVocabularyTermNodes = (terms) => {
				(terms || []).forEach((oneTerm) => {
					const mintedCedsId = `VT${oneTerm.localName}`;
					kit.makeNode({
						role: DME_ROLES.VOCABULARY_TERM,
						perStandardLabel: perStandardLabelFor(DME_ROLES.VOCABULARY_TERM),
						stableId: oneTerm.uri,
						...(oneTerm.label ? { name: oneTerm.label } : {}),
						...(oneTerm.description ? { description: oneTerm.description } : {}),
						structural: {
							parentId: rootStableId,
							path: `CEDS.vocabulary.${oneTerm.localName}`,
						},
						carriedProperties: {
							cedsId: mintedCedsId,
							cedsIdIsMinted: true, // never confuse a minted id with one CEDS assigned
							isMetaVocabulary: true, // what gate D-2 selects on
							sourceElementName: oneTerm.sourceElementName,
							localName: oneTerm.localName,
							...(oneTerm.notation ? { notation: oneTerm.notation } : {}),
							...(oneTerm.domainRefs && oneTerm.domainRefs.length
								? { allDomainIds: oneTerm.domainRefs, domainId: oneTerm.domainRefs[0] }
								: {}),
							...(oneTerm.rangeRefs && oneTerm.rangeRefs.length
								? { vocabularyRangeRefs: oneTerm.rangeRefs }
								: {}),
							...(oneTerm.annotations || {}),
						},
						origin: `vocabularyTerm ${mintedCedsId}`,
					});
					kit.addEdge({
						edgeType: EDGE_TYPES.HAS_SUPPORT,
						fromStableId: rootStableId,
						toStableId: oneTerm.uri,
						edgeContext: `vocabularyTerm ${mintedCedsId}`,
					});
					addEditHistoryNodes({
						ownerStableId: oneTerm.uri,
						ownerCedsId: mintedCedsId,
						editHistory: oneTerm.editHistory,
					});
					addRestrictionNodes({
						ownerStableId: oneTerm.uri,
						ownerCedsId: mintedCedsId,
						restrictions: oneTerm.restrictions,
					});
				});
			};

			// ---- DmeClass nodes ----
			const classCanonicalByUri = {};
			classes.forEach((cls) => {
				const className = cls.label || cls.cedsId;
				const built = makeEntityNode({
					role: DME_ROLES.CLASS,
					rawEntity: cls,
					kind: 'class',
					searchTextElement: { name: className, standardName: STANDARD_SOURCE, owningName: STANDARD_SOURCE },
					extraProperties: cls.notation !== undefined ? { notation: cls.notation } : {},
					// parentId referent = MEMBER stableId (M7) — the root's stableId
					structural: { parentId: rootStableId, path: className },
					origin: `class ${className}`,
				});
				classCanonicalByUri[cls.uri] = { className, stableId: built.stableId };
				// HAS_CLASS: root -> class (canonical ownership)
				kit.addEdge({
					edgeType: EDGE_TYPES.HAS_CLASS,
					fromStableId: rootStableId,
					toStableId: built.stableId,
					edgeContext: `class ${className}`,
				});
				addEditHistoryNodes({
					ownerStableId: built.stableId,
					ownerCedsId: built.canonicalCedsId,
					editHistory: cls.editHistory,
				});
				addRestrictionNodes({
					ownerStableId: built.stableId,
					ownerCedsId: built.canonicalCedsId,
					restrictions: cls.restrictions,
				});
			});

			// SUBCLASS_OF (after all classes exist so the parent stableId is resolvable)
			classes.forEach((cls) => {
				if (cls.parentRef && classByUri[cls.parentRef]) {
					kit.addEdge({
						edgeType: EDGE_TYPES.SUBCLASS_OF,
						fromStableId: cls.uri,
						toStableId: cls.parentRef,
						edgeContext: `subclassOf ${cls.uri}`,
					});
				}
			});

			// ---- DmeProperty nodes (carry owning Class name in searchText — the CEDS hub fix) ----
			properties.forEach((prop) => {
				const propertyName = prop.label || prop.cedsId;
				// owning class: first CEDS domain ref
				const owningClassUri = (prop.domainRefs || []).find((u) => classByUri[u]);
				const owningClassName = owningClassUri
					? classCanonicalByUri[owningClassUri] && classCanonicalByUri[owningClassUri].className
					: undefined;
				const parentStableId = owningClassUri || rootStableId;

				// ⟪P4 FIX — ADDITIVE ONLY⟫ domainSlotId (below) stays EXACTLY the first-resolvable
				// schema:domainIncludes reference, byte-unchanged. 256/2324 (11%) CEDS properties
				// carry MORE than one resolvable domainRefs entry, and every one after the first was
				// silently dropped. allDomainIds/allDomainNames is a NEW, ADDITIONAL property with
				// the FULL resolvable list — never read by domainSlotId, addressSlots or the
				// HAS_PROPERTY edge, so every existing consumer sees byte-identical output.
				// allDomainIds[0] === domainSlotId always, by construction.
				const allDomainUris = (prop.domainRefs || []).filter((u) => classByUri[u]);
				const allDomainIds = [];
				const allDomainNames = [];
				allDomainUris.forEach((oneDomainUri) => {
					const resolved = normalize.normalizeCedsId({
						rawValue: classByUri[oneDomainUri].cedsId,
						kind: 'class',
					});
					if (resolved.error) {
						return; // same silent-skip discipline domainSlotId's own resolution applies
					}
					allDomainIds.push(resolved.cedsId);
					allDomainNames.push(
						(classCanonicalByUri[oneDomainUri] && classCanonicalByUri[oneDomainUri].className) ||
							null,
					);
				});

				const extraProperties = {};
				if (prop.dataType) {
					extraProperties.dataType = prop.dataType;
				}
				// ⟪P4 FIX⟫ stamped ONLY when at least one domain resolved — never an empty-array
				// placeholder for a property with zero resolvable domains.
				if (allDomainIds.length > 0) {
					extraProperties.allDomainIds = allDomainIds;
					extraProperties.allDomainNames = allDomainNames;
				}
				if (prop.textFormat) {
					extraProperties.textFormat = prop.textFormat;
				}
				if (prop.maxLength) {
					extraProperties.maxLength = prop.maxLength;
				}
				if (prop.notation !== undefined) {
					extraProperties.notation = prop.notation;
				}

				// Phase 2 address slots. The range slot has THREE first-class source shapes, mutually
				// exclusive in source: an option set, a CEDS CLASS reference, or an XSD scalar datatype.
				const domainSlotId = owningClassUri
					? normalize.normalizeCedsId({
							rawValue: classByUri[owningClassUri].cedsId,
							kind: 'class',
						}).cedsId
					: undefined;
				let rangeOptionSetSlotId;
				(prop.rangeRefs || []).forEach((rangeUri) => {
					if (!rangeOptionSetSlotId && optionSetByUri[rangeUri]) {
						const resolved = normalize.normalizeCedsId({
							rawValue: optionSetByUri[rangeUri].cedsId,
							kind: 'optionSet',
						});
						if (!resolved.error) {
							rangeOptionSetSlotId = resolved.cedsId;
						}
					}
				});
				let rangeClassSlotId;
				if (!rangeOptionSetSlotId) {
					(prop.rangeRefs || []).forEach((rangeUri) => {
						if (!rangeClassSlotId && classByUri[rangeUri]) {
							const resolved = normalize.normalizeCedsId({
								rawValue: classByUri[rangeUri].cedsId,
								kind: 'class',
							});
							if (!resolved.error) {
								rangeClassSlotId = resolved.cedsId;
							}
						}
					});
				}
				// 'unspecified' is reserved for the genuinely-empty case (source: P001396 — no option
				// set, no class, no datatype). NEVER stamped when a class range was found.
				const rangeDatatypeSlot =
					rangeOptionSetSlotId || rangeClassSlotId
						? undefined
						: prop.dataType
							? prop.dataType
							: 'unspecified';

				const built = makeEntityNode({
					role: DME_ROLES.PROPERTY,
					rawEntity: prop,
					kind: 'property',
					searchTextElement: {
						name: propertyName,
						owningClassName: owningClassName || STANDARD_SOURCE,
						owningName: owningClassName || STANDARD_SOURCE,
					},
					extraProperties,
					addressSlots: {
						domainId: domainSlotId,
						rangeOptionSetId: rangeOptionSetSlotId,
						rangeClassId: rangeClassSlotId,
						rangeDatatype: rangeDatatypeSlot,
					},
					structural: {
						// parentId referent = MEMBER stableId (M7): the owning class's uri, or the
						// root's stableId — the same value the HAS_PROPERTY edge uses.
						parentId: parentStableId,
						path: `${owningClassName || STANDARD_SOURCE}.${propertyName}`,
					},
					origin: `property ${propertyName}`,
				});

				// HAS_PROPERTY: owning class -> property (immediate containment, DESIGN §F)
				kit.addEdge({
					edgeType: EDGE_TYPES.HAS_PROPERTY,
					fromStableId: parentStableId,
					toStableId: built.stableId,
					edgeContext: `property ${propertyName}`,
				});
				addEditHistoryNodes({
					ownerStableId: built.stableId,
					ownerCedsId: built.canonicalCedsId,
					editHistory: prop.editHistory,
				});

				// HAS_OPTION_SET: property -> option set (range that is itself an option set);
				// a range pointing at a class is a REFERENCE (DESIGN §F)
				(prop.rangeRefs || []).forEach((rangeUri) => {
					if (optionSetByUri[rangeUri]) {
						kit.addEdge({
							edgeType: EDGE_TYPES.HAS_OPTION_SET,
							fromStableId: built.stableId,
							toStableId: rangeUri,
							edgeContext: `range of ${propertyName}`,
						});
					} else if (classByUri[rangeUri]) {
						kit.addEdge({
							edgeType: EDGE_TYPES.REFERENCES,
							fromStableId: built.stableId,
							toStableId: rangeUri,
							edgeContext: `range of ${propertyName}`,
						});
					}
				});
			});

			// ---- DmeOptionSet nodes ----
			const optionSetCanonicalByUri = {};
			const optionSetParentRefByUri = {};
			optionSets.forEach((os) => {
				const setName = os.label || os.cedsId;
				const built = makeEntityNode({
					role: DME_ROLES.OPTION_SET,
					rawEntity: os,
					kind: 'optionSet',
					searchTextElement: { name: setName, owningName: STANDARD_SOURCE, owningClassName: STANDARD_SOURCE },
					extraProperties: os.notation !== undefined ? { notation: os.notation } : {},
					// parentId referent = MEMBER stableId (M7); single-owner sets are re-parented to
					// their owning property by the shared structural-contract finalizer (M8).
					structural: { parentId: rootStableId, path: setName },
					origin: `optionSet ${setName}`,
				});
				optionSetCanonicalByUri[os.uri] = { setName, stableId: built.stableId };
				optionSetParentRefByUri[os.uri] = os.parentRef;
				addEditHistoryNodes({
					ownerStableId: built.stableId,
					ownerCedsId: built.canonicalCedsId,
					editHistory: os.editHistory,
				});
			});

			// SUBCLASS_OF for OPTION SETS — the 965 the forge used to drop on the floor. MEASURED:
			// all 965 declare a parent and every one resolves to an entity CLASS (963 to C000000,
			// 2 to C200407); none points at another option set. Emitted after the option-set nodes
			// exist so the parent is resolvable, the same ordering the class loop uses.
			optionSets.forEach((os) => {
				const parentRef = optionSetParentRefByUri[os.uri];
				if (parentRef && classCanonicalByUri[parentRef]) {
					kit.addEdge({
						edgeType: EDGE_TYPES.SUBCLASS_OF,
						fromStableId: os.uri,
						toStableId: parentRef,
						edgeContext: `optionSet subclassOf ${os.uri}`,
					});
				}
			});

			// ---- DmeOptionValue nodes (each carries its set + owner in searchText) ----
			optionValues.forEach((ov) => {
				const valueName = ov.label || ov.cedsId;
				const owningSetUri = ov.inSchemeRef;
				const owningSet = owningSetUri ? optionSetCanonicalByUri[owningSetUri] : undefined;
				const optionSetName = owningSet ? owningSet.setName : STANDARD_SOURCE;

				// the value's range slot is its owning option set's canonical OS-id
				const owningSetRangeId =
					owningSetUri && optionSetByUri[owningSetUri]
						? normalize.normalizeCedsId({
								rawValue: optionSetByUri[owningSetUri].cedsId,
								kind: 'optionSet',
							}).cedsId
						: undefined;

				const built = makeEntityNode({
					role: DME_ROLES.OPTION_VALUE,
					rawEntity: ov,
					kind: 'optionValue',
					searchTextElement: {
						name: valueName,
						optionSetName,
						owningName: optionSetName,
						owningClassName: STANDARD_SOURCE,
					},
					extraProperties: ov.notation !== undefined ? { notation: ov.notation } : {},
					addressSlots: { rangeOptionSetId: owningSetRangeId },
					structural: {
						// the orphan branch anchors to the root's stableId (M7)
						parentId: owningSet ? owningSet.stableId : rootStableId,
						path: `${optionSetName}.${valueName}`,
					},
					origin: `optionValue ${valueName}`,
				});

				// HAS_VALUE: option set -> value (immediate containment)
				if (owningSet) {
					kit.addEdge({
						edgeType: EDGE_TYPES.HAS_VALUE,
						fromStableId: owningSet.stableId,
						toStableId: built.stableId,
						edgeContext: `optionValue ${valueName}`,
					});
				}
				addEditHistoryNodes({
					ownerStableId: built.stableId,
					ownerCedsId: built.canonicalCedsId,
					editHistory: ov.editHistory,
				});
			});

			addVocabularyTermNodes(entities.vocabularyTerms);

			// the framework runs finalizeStructuralContract (and the integrity pass) after this
			// returns; the walk hands back the kit's collected arrays in emission order.
			return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
		};

		return { emitContractGraph };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
