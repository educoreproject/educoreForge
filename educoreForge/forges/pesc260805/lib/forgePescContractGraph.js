'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgePescContractGraph.js — H3 for the PESC260805 forge bundle: THE WALK (SPEC-forgeFramework-v1.md
// §6.2; the PESC migration, hub-kit-role Phase 4). PURE and synchronous: no I/O, no clock, no xLog.
// It throws named Errors; forge() step 5 is the framework's ONE adapter.
//
// Written LAST, after the code settled and after the oracle passed, per the standing prose-last
// rule — and every figure below is MEASURED, never estimated.
//
// FOUR TIERS RUN HERE, IN THIS ORDER, AND THE ORDER IS LOAD-BEARING:
//   source     — the 484-line emission body ported from the bespoke module (see the note on HOW)
//   derived    — namespaces, resolution, sameness chains; computed from the source tier and nothing else
//   composition— the HYBRID searchText pass; MUST run after derived, because it reads each
//                declaration's EFFECTIVE description, its own prose or its type's reached over
//                RESOLVES_TO, and those edges do not exist until the derived tier has built them.
//                Composing at mint time would hand ~68% of declarations the bare element name — C1,
//                the arm the cosine guard DISQUALIFIED — and that failure PARSES, FORGES AND
//                ROUND-TRIPS CLEAN, which is why the pass is placed rather than inlined.
//   synthetic  — S-1 merges, S-1c merged children, the S-2 alias; ADDS ONLY, mutates nothing
//
// HOW THE SOURCE TIER WAS PORTED, because it is the reason this file can be trusted. The bespoke
// body was moved by CUTTING FOUR SPANS — its own nodes/edges arrays, its makeNode, its addEdge and
// its root push — and supplying kit-backed wrappers that carry THE BESPOKE SIGNATURES EXACTLY. The
// remaining 387 lines compiled unchanged (wc -l; the splice reported 388 array entries because
// the last is the empty trailing element — the measure is named because the two differ by one). In a byte-identity phase transcription is the largest
// avoidable risk, and the diff bears the method out: against the pre-migration block, exactly ONE
// line moved, and it is the root — the one node this file no longer builds.
//
// THE KIT IS THE ONLY DOOR FOR CREATION, AND CLOSING IT TOOK RECONCILING TWO CONTRACTS THAT
// CONTRADICT EACH OTHER ON THEIR FACE. The framework refuses any returned node the kit did not mint
// (identity, not equality). applyDerivedTier deliberately CLONES the nodes it is handed — its own
// comment records why: a caller once fed it a shared graph and the contamination masked FIVE gate
// failures. So the walk reconciles them explicitly rather than weakening either: the tier modules
// are UNTOUCHED and keep producing plain objects, the walk WRITES THE ANNOTATIONS BACK onto the
// kit's live nodes, and every genuinely new node and edge is minted through the kit. FOUR mint
// sites are routed this way (rulings FJ-P4-4 and its extension) — derivedTier.js:667 PescNamespace
// (63), syntheticTier.js:790 merged children (522), :1356 merged definitions (109), :1820 the alias
// namespace (1) — 695 of 42,372 nodes.
//
// ⚠ THE ONE UNIVERSAL THE KIT CANNOT SIMPLY RECOMPUTE IS searchText. The kit builds it from the
// plain ladder; PESC's merged children build theirs through the HYBRID composer, a different
// function with a different result. So mintRawNode takes the element the tier actually used and,
// where the tier composed something else, THE TIER'S TEXT WINS and is assigned onto the live node.
// That is not a bypass: the kit still mints, and PESC already mutates searchText in place through
// applySearchTextComposition for the entire source tier. Creation has one door; composition is a
// documented pass over already-minted nodes.
//
// ⚠ PESC'S LABEL AXIS IS THE NATIVE XSD CONSTRUCT KIND — a FOURTH axis, and the only one of the
// four where role -> label is NOT EVEN A FUNCTION. Measured: DmeSupport carries SIX labels and
// PescNamedDefinition appears under THREE roles. ceds keys by DME role, sif by native kind, edfi by
// MetaEd entity type. CEDS's role-keyed registry is structurally incapable of expressing this, and
// copying it would mislabel thousands of nodes with every count and every suite still green — the
// exact defect class G-LABEL-CENSUS exists to catch. Both registries below refuse by name.

const path = require('path');
const derivedTierFactory = require('./derivedTier');
const syntheticTierFactory = require('./syntheticTier');
const searchTextCompositionFactory = require('./searchTextComposition');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const { NODE_LABELS, DME_ROLES, EDGE_TYPES } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

const STANDARD_SOURCE = 'PESC260805';
const ROOT_STABLE_ID = 'pesc260805:root';

// pescTier — the bundle-local tier marker (design §2). 'meta' is the ROOT and its ownership edges;
// the framework stamps the root's copy through describeRoot.extraProperties under allowance P5.
const PESC_TIER = Object.freeze({ SOURCE: 'source', META: 'meta' });

// ---------------------------------------------------------------------------------------------
// PESC'S LABEL AXIS IS THE NATIVE XSD CONSTRUCT KIND, AND IT IS A FOURTH AXIS. Measured across the
// four kits: ceds keys per-standard labels by DME ROLE (5 labels, role -> label is a function),
// sif by NATIVE KIND (9 labels across 6 roles), edfi by METAED ENTITY TYPE (22), and PESC by NATIVE
// XSD CONSTRUCT KIND — 9 labels where role -> label is NOT EVEN A FUNCTION: DmeSupport carries SIX
// of them, and PescNamedDefinition appears under THREE different roles (DmeClass for complexTypes
// and message-root elements, DmeOptionSet for enumeration-carrying simpleTypes, DmeSupport for
// groups and plain simpleTypes). A role-keyed registry like CEDS's PER_STANDARD_LABEL_BY_ROLE is
// structurally incapable of expressing that, so copying it would mislabel thousands of nodes with
// every count and every suite still green — the exact defect class G-LABEL-CENSUS exists to catch.
// The census is frozen in test/acceptance/expectedLabelCensus.json and sums to nodeTotal.
// ---------------------------------------------------------------------------------------------
const PESC_NATIVE_KIND = Object.freeze({
	ARTIFACT: 'artifact',
	IMPORT_DECL: 'importDecl',
	ELEMENT_DECL: 'elementDecl',
	ATTRIBUTE_DECL: 'attributeDecl',
	DERIVATION: 'derivation',
	ANONYMOUS_TYPE: 'anonymousType',
	NAMED_DEFINITION: 'namedDefinition',
	NAMESPACE: 'namespace',
});

const PER_STANDARD_LABEL_BY_NATIVE_KIND = Object.freeze({
	[PESC_NATIVE_KIND.ARTIFACT]: 'PescArtifact',
	[PESC_NATIVE_KIND.IMPORT_DECL]: 'PescImportDecl',
	[PESC_NATIVE_KIND.ELEMENT_DECL]: 'PescElementDecl',
	[PESC_NATIVE_KIND.ATTRIBUTE_DECL]: 'PescAttributeDecl',
	[PESC_NATIVE_KIND.DERIVATION]: 'PescDerivation',
	[PESC_NATIVE_KIND.ANONYMOUS_TYPE]: 'PescAnonymousType',
	[PESC_NATIVE_KIND.NAMED_DEFINITION]: 'PescNamedDefinition',
	[PESC_NATIVE_KIND.NAMESPACE]: 'PescNamespace',
});

// a REFUSING lookup, never a bare table read: an unlisted native kind is a walk defect and must say
// so by name rather than mint a node whose per-standard label is `undefined`.
const labelForNativeKind = (nativeKind) => {
	const perStandardLabel = PER_STANDARD_LABEL_BY_NATIVE_KIND[nativeKind];
	if (perStandardLabel === undefined) {
		throw new Error(
			`${moduleName} REFUSED: no per-standard label declared for native PESC kind '${nativeKind}' — ` +
				`known kinds are ${Object.keys(PER_STANDARD_LABEL_BY_NATIVE_KIND).sort().join(', ')}`,
		);
	}
	return perStandardLabel;
};

// the DME role of a named top-level definition, by its XSD kind (design §3.4). A REGISTRY rather
// than the bespoke object literal rebuilt inside the loop: message roots (top-level elements) and
// named complexTypes -> CLASS; groups and plain simpleTypes -> SUPPORT; an enumeration-carrying
// simpleType -> OPTION_SET, which is why the row carries a flag rather than a bare role.
const ROLE_SPEC_BY_DEFINITION_KIND = Object.freeze({
	complexType: Object.freeze({ role: DME_ROLES.CLASS, optionSetWhenEnumerated: false }),
	element: Object.freeze({ role: DME_ROLES.CLASS, optionSetWhenEnumerated: false }),
	group: Object.freeze({ role: DME_ROLES.SUPPORT, optionSetWhenEnumerated: false }),
	simpleType: Object.freeze({ role: DME_ROLES.SUPPORT, optionSetWhenEnumerated: true }),
});

// REFUSING: the bespoke read `roleByKind[oneDefinition.kind]` and would have handed the kit
// `undefined` for an unknown XSD kind. The kit refuses an unknown role, so the build stopped either
// way — but it stopped naming the ROLE rather than the KIND, which is the wrong end of the fault.
const definitionRoleFor = ({ definitionKind, carriesEnumerations }) => {
	const roleSpec = ROLE_SPEC_BY_DEFINITION_KIND[definitionKind];
	if (roleSpec === undefined) {
		throw new Error(
			`${moduleName} REFUSED: no DME role declared for native PESC definition kind '${definitionKind}' — ` +
				`known kinds are ${Object.keys(ROLE_SPEC_BY_DEFINITION_KIND).sort().join(', ')}`,
		);
	}
	return roleSpec.optionSetWhenEnumerated && carriesEnumerations ? DME_ROLES.OPTION_SET : roleSpec.role;
};

// START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName } = {}) => () => {
	const { buildDerivedTier, applyDerivedTier } = derivedTierFactory();
	const { buildSyntheticTier } = syntheticTierFactory();
	const { applySearchTextComposition } = searchTextCompositionFactory();

	// =====================================================================
	// emitContractGraph — the walk. PURE and synchronous (SPEC §6.2): no I/O, no clock, no xLog.
	// It throws named Errors; forge() step 5 is the framework's ONE adapter.
	// =====================================================================
	const emitContractGraph = ({ pescCorpus, kit }) => {
		const { artifacts, parseAudit } = pescCorpus;

		// the kit's LIVE collected arrays. The bespoke walk owned these; the kit owns them now, and
		// they are what the walk hands back.
		const nodes = kit.nodes;
		const edges = kit.edges;

		// -------------------------------------------------------------------------------------
		// makeNode / addEdge — KIT-BACKED WRAPPERS CARRYING THE BESPOKE SIGNATURES EXACTLY.
		//
		// The 484-line source-tier body below is ported UNCHANGED except for four excised spans
		// (its own nodes/edges arrays, its makeNode, its addEdge, and its root push). Keeping the
		// bespoke call signatures here is deliberate: it makes the port mechanical rather than
		// transcribed, and transcription is the largest avoidable risk in a byte-identity phase.
		//
		// THREE PROPERTIES THE BESPOKE STAMPED ARE DELIBERATELY NOT PASSED, each because the
		// framework owns it and each MEASURED byte-neutral rather than assumed:
		//   depth      — CARRIED through carriedProperties (see the site below): the finalizer
		//                overwrites it at step 6 and, measured on the entry block, all 42,371 stamped
		//                depths already EQUAL their parent-chain depth so the overwrite moves nothing
		//                — but the value must still EXIST during the walk, because the synthetic tier
		//                reads and overrides it. Dropping it is byte-neutral and build-fatal.
		//   crossRefs  — the finalizer stamps '[]' where absent; the bespoke stamped
		//                JSON.stringify([]), which is the same two bytes.
		//   provenanceTier — kit.addEdge stamps PROVENANCE_TIER.STRUCTURAL on every edge, which is
		//                what the bespoke addEdge stamped.
		//
		// `documentation` rides as a CARRIED property: it is bundle-local, not a universal, so the
		// kit does not guard it — unlike `description`, whose '' the kit refuses without allowance
		// P9. Both are stamped from the same source value, as the bespoke did on adjacent lines.
		// -------------------------------------------------------------------------------------
		const makeNode = ({ role, perStandardLabel, stableId, name, documentation, searchTextElement, structural, scalar }) => {
			const node = kit.makeNode({
				role,
				perStandardLabel,
				stableId,
				// the bespoke coercion, kept verbatim. MEASURED: ZERO of the 42,372 nodes carry
				// name '', so this arm never fires on this corpus — and if a null name ever did
				// arrive, allowance P9 names 'description' ONLY, so the kit REFUSES BY NAME rather
				// than stamping a silent ''. That is the strict behaviour, kept on purpose.
				name: name == null ? '' : `${name}`,
				description: documentation || '',
				structural: { parentId: structural.parentId, path: structural.path },
				searchTextElement,
				carriedProperties: {
					documentation: documentation || '',
					pescTier: PESC_TIER.SOURCE,
					// depth — CARRIED, not omitted, and the kit sanctions exactly this
					// (contractGraphKit.js:67-68: "the finalizer owns them and a walk MAY hand them
					// through carriedProperties"). An earlier draft of this wrapper dropped it on the
					// grounds that structural-contract overwrites it anyway. TRUE OF THE BYTES AND
					// FALSE OF THE BUILD: the synthetic tier runs INSIDE the walk, before the
					// finalizer, and S-1c REFUSES BY NAME when a source child it is duplicating has
					// no depth to override. Caught by the in-process forge in seconds.
					depth: structural.depth,
					...(scalar || {}),
				},
				origin: `pesc source tier ${perStandardLabel} '${stableId}'`,
			});
			// sourceSearchTextElement — carried OUTSIDE properties (so it reaches neither the graph
			// nor the fingerprint) for the hybrid composition pass to re-delegate the C0 arm
			// byte-identically. The pass DELETES this key when it is done. Bespoke behaviour, kept.
			node.sourceSearchTextElement = searchTextElement;
			return node;
		};

		const addEdge = (edgeType, fromStableId, toStableId, extraProperties, pescTier) =>
			kit.addEdge({
				edgeType,
				fromStableId,
				toStableId,
				edgeContext: `pesc ${edgeType} ${fromStableId} -> ${toStableId}`,
				edgeProperties: { pescTier: pescTier || PESC_TIER.SOURCE, ...(extraProperties || {}) },
			});

	const buildSourceTierGraph = ({ artifacts, parseAudit }) => {
		const stats = {
			artifacts: 0,
			importDecls: 0,
			namedDefinitions: 0,
			elementDecls: 0,
			anonymousTypes: 0,
			derivations: 0,
			attributeDecls: 0,
			enumerationValuesCarried: 0,
			contestedNamespaces: [],
			parseAudit,
		};

		// ---- D-1 precomputation: a namespace is CONTESTED when >=2 artifacts with DIFFERENT
		// bytes claim it. The discriminator applies exactly there and nowhere else.
		const shaSetByNamespace = {};
		artifacts.forEach((oneArtifact) => {
			(shaSetByNamespace[oneArtifact.targetNamespace] =
				shaSetByNamespace[oneArtifact.targetNamespace] || []).push(oneArtifact.sha256);
		});
		const contestedNamespaces = Object.keys(shaSetByNamespace)
			.filter((oneNamespace) => shaSetByNamespace[oneNamespace].length > 1)
			.sort();
		stats.contestedNamespaces = contestedNamespaces;




		// =====================================================================
		// per-artifact emission
		// =====================================================================
		artifacts.forEach((oneArtifact) => {
			const isCollisionMember = contestedNamespaces.indexOf(oneArtifact.targetNamespace) !== -1;
			const collisionDiscriminator = isCollisionMember
				? `@${oneArtifact.sha256.substring(0, 12)}`
				: '';
			const artifactStableId = `pescArtifact:${oneArtifact.sha256}`;
			const owningName = `${oneArtifact.standardToken} ${oneArtifact.versionToken}`;

			makeNode({
				role: DME_ROLES.SUPPORT,
				perStandardLabel: labelForNativeKind(PESC_NATIVE_KIND.ARTIFACT),
				stableId: artifactStableId,
				name: oneArtifact.filename,
				documentation: oneArtifact.documentation,
				searchTextElement: {
					role: DME_ROLES.SUPPORT,
					name: oneArtifact.filename,
					owningName,
					standardName: STANDARD_SOURCE,
				},
				structural: {
					parentId: ROOT_STABLE_ID,
					depth: 1,
					path: oneArtifact.filename,
				},
				scalar: {
					filename: oneArtifact.filename,
					targetNamespace: oneArtifact.targetNamespace,
					sha256: oneArtifact.sha256,
					byteCount: oneArtifact.byteCount,
					collisionMember: isCollisionMember,
					prefixBindings: JSON.stringify(oneArtifact.prefixBindings),
					schemaAttributes: JSON.stringify(oneArtifact.schemaAttributes),
					elementFormDefault: oneArtifact.schemaAttributes.elementFormDefault || '',
					attributeFormDefault: oneArtifact.schemaAttributes.attributeFormDefault || '',
					schemaVersionAttribute: oneArtifact.schemaAttributes.version || '',
					layer: oneArtifact.layer,
					standardToken: oneArtifact.standardToken,
					versionToken: oneArtifact.versionToken,
				},
			});
			addEdge(EDGE_TYPES.HAS_SUPPORT, ROOT_STABLE_ID, artifactStableId, {}, PESC_TIER.META);
			stats.artifacts++;

			// ---- import declarations (source rows; the resolved IMPORTS edge is Phase 3's)
			oneArtifact.imports.forEach((oneImport) => {
				const importStableId = `${artifactStableId}/import/${oneImport.documentPosition}`;
				makeNode({
					role: DME_ROLES.SUPPORT,
					perStandardLabel: labelForNativeKind(PESC_NATIVE_KIND.IMPORT_DECL),
					stableId: importStableId,
					name: oneImport.namespaceAsWritten,
					documentation: '',
					searchTextElement: {
						role: DME_ROLES.SUPPORT,
						name: oneImport.namespaceAsWritten,
						owningName: oneArtifact.filename,
						standardName: STANDARD_SOURCE,
					},
					structural: {
						parentId: artifactStableId,
						depth: 2,
						path: `${oneArtifact.filename}.import[${oneImport.documentPosition}]`,
					},
					scalar: {
						namespaceAsWritten: oneImport.namespaceAsWritten,
						schemaLocationAsWritten: oneImport.schemaLocationAsWritten,
						documentPosition: oneImport.documentPosition,
					},
				});
				addEdge('DECLARES', artifactStableId, importStableId, {
					documentPosition: oneImport.documentPosition,
				});
				stats.importDecls++;
			});

			// ---- containment emission, recursive over the parsed container model ----
			// container = a node that owns elements/attributes/derivations. Elements declared
			// inside a derivation (extension/restriction) hang off the CONTAINER — uniform
			// HAS_PROPERTY — while the PescDerivation child records the wrapper the emitter
			// must rebuild (contentStyle + derivationVariety).
			const emitContainerContents = ({
				containerStableId,
				containerName,
				containerPath,
				content,
				depth,
			}) => {
				content.elements.forEach((oneElement) => {
					const elementStableId = `${containerStableId}/el/${oneElement.sequencePosition}:${oneElement.name}`;
					makeNode({
						role: DME_ROLES.PROPERTY,
						perStandardLabel: labelForNativeKind(PESC_NATIVE_KIND.ELEMENT_DECL),
						stableId: elementStableId,
						name: oneElement.name,
						documentation: oneElement.documentation,
						searchTextElement: {
							role: DME_ROLES.PROPERTY,
							name: oneElement.name,
							owningClassName: containerName,
						},
						structural: {
							parentId: containerStableId,
							depth: depth + 1,
							path: `${containerPath}.${oneElement.name}`,
						},
						scalar: {
							typeAsWritten: oneElement.typeAsWritten,
							minOccurs: oneElement.minOccursAsWritten,
							maxOccurs: oneElement.maxOccursAsWritten,
							nillable: oneElement.nillableAsWritten,
							fixedAsWritten: oneElement.fixedAsWritten,
							defaultAsWritten: oneElement.defaultAsWritten,
							sequencePosition: oneElement.sequencePosition,
						},
					});
					addEdge(EDGE_TYPES.HAS_PROPERTY, containerStableId, elementStableId, {
						sequencePosition: oneElement.sequencePosition,
					});
					stats.elementDecls++;
					if (oneElement.anonymousType) {
						emitAnonymousType({
							ownerStableId: elementStableId,
							ownerName: `${containerName}.${oneElement.name}`,
							ownerPath: `${containerPath}.${oneElement.name}`,
							anonymousType: oneElement.anonymousType,
							depth: depth + 1,
						});
					}
				});

				content.attributes.forEach((oneAttribute) => {
					const attributeStableId = `${containerStableId}/attr/${oneAttribute.attributePosition}:${oneAttribute.name}`;
					makeNode({
						role: DME_ROLES.PROPERTY,
						perStandardLabel: labelForNativeKind(PESC_NATIVE_KIND.ATTRIBUTE_DECL),
						stableId: attributeStableId,
						name: oneAttribute.name,
						documentation: oneAttribute.documentation,
						searchTextElement: {
							role: DME_ROLES.PROPERTY,
							name: oneAttribute.name,
							owningClassName: containerName,
						},
						structural: {
							parentId: containerStableId,
							depth: depth + 1,
							path: `${containerPath}.@${oneAttribute.name}`,
						},
						scalar: {
							typeAsWritten: oneAttribute.typeAsWritten,
							use: oneAttribute.useAsWritten,
							attributePosition: oneAttribute.attributePosition,
						},
					});
					addEdge(EDGE_TYPES.HAS_PROPERTY, containerStableId, attributeStableId, {
						attributePosition: oneAttribute.attributePosition,
						declKind: 'attribute',
					});
					stats.attributeDecls++;
					if (oneAttribute.anonymousType) {
						emitAnonymousType({
							ownerStableId: attributeStableId,
							ownerName: `${containerName}.@${oneAttribute.name}`,
							ownerPath: `${containerPath}.@${oneAttribute.name}`,
							anonymousType: oneAttribute.anonymousType,
							depth: depth + 1,
						});
					}
				});

				content.derivations.forEach((oneDerivation, derivationIndex) => {
					// R-P2-4: node kind renamed PescRestriction -> PescDerivation (it carries
					// xs:extension too; a Restriction label holding extensions is a lie in a graph
					// built for comprehension). The stableId segment '/restriction/' is IDENTITY,
					// not vocabulary, and stays — renaming keys is not a mechanical fixup.
					const derivationStableId = `${containerStableId}/restriction/${derivationIndex + 1}`;
					// facet scalars land under the DESIGN's names (pattern, minLength, ...,
					// totalDigits, fractionDigits) — G-E's fidelity lives in these properties.
					const facetScalars = {};
					Object.keys(oneDerivation.facets).forEach((oneFacetName) => {
						facetScalars[oneFacetName] = oneDerivation.facets[oneFacetName];
					});
					makeNode({
						role: DME_ROLES.SUPPORT,
						perStandardLabel: labelForNativeKind(PESC_NATIVE_KIND.DERIVATION),
						stableId: derivationStableId,
						name: `${containerName} ${oneDerivation.variety} of ${oneDerivation.baseAsWritten}`,
						documentation: oneDerivation.documentation,
						searchTextElement: {
							role: DME_ROLES.SUPPORT,
							name: `${oneDerivation.variety} of ${oneDerivation.baseAsWritten}`,
							owningName: containerName,
							standardName: STANDARD_SOURCE,
						},
						structural: {
							parentId: containerStableId,
							depth: depth + 1,
							path: `${containerPath}.${oneDerivation.variety}`,
						},
						scalar: {
							derivationVariety: oneDerivation.variety,
							contentStyle: oneDerivation.contentStyle,
							baseAsWritten: oneDerivation.baseAsWritten,
							enumerationValues: JSON.stringify(oneDerivation.enumerationValues),
							enumerationCount: oneDerivation.enumerationValues.length,
							...facetScalars,
						},
					});
					// edge type stays EDGE_TYPES.HAS_RESTRICTION: it is the SHARED vocabulary enum
					// (lib/vocabulary), out of this bundle's rename authority.
					addEdge(EDGE_TYPES.HAS_RESTRICTION, containerStableId, derivationStableId, {
						derivationPosition: derivationIndex + 1,
					});
					stats.derivations++;
					stats.enumerationValuesCarried += oneDerivation.enumerationValues.length;
				});
			};

			const emitAnonymousType = ({ ownerStableId, ownerName, ownerPath, anonymousType, depth }) => {
				// one inline type per owner (XSD's rule, parser-enforced), so position is 1.
				const anonStableId = `${ownerStableId}/anon/1`;
				makeNode({
					role: DME_ROLES.SUPPORT,
					perStandardLabel: labelForNativeKind(PESC_NATIVE_KIND.ANONYMOUS_TYPE),
					stableId: anonStableId,
					name: `${ownerName} (inline ${anonymousType.typeVariety})`,
					documentation: anonymousType.body.documentation,
					searchTextElement: {
						role: DME_ROLES.SUPPORT,
						name: `inline ${anonymousType.typeVariety}`,
						owningName: ownerName,
						standardName: STANDARD_SOURCE,
					},
					structural: {
						parentId: ownerStableId,
						depth: depth + 1,
						path: `${ownerPath}(anon)`,
					},
					scalar: {
						typeVariety: anonymousType.typeVariety,
						contentModelShape: anonymousType.body.contentModelShape
							? JSON.stringify(anonymousType.body.contentModelShape)
							: null,
					},
				});
				addEdge(EDGE_TYPES.HAS_SUPPORT, ownerStableId, anonStableId, { anonPosition: 1 });
				stats.anonymousTypes++;
				emitContainerContents({
					containerStableId: anonStableId,
					containerName: ownerName,
					containerPath: `${ownerPath}(anon)`,
					content: anonymousType.body,
					depth: depth + 1,
				});
			};

			// ---- named top-level definitions ----
			oneArtifact.definitions.forEach((oneDefinition) => {
				const definitionStableId =
					`${oneArtifact.targetNamespace}#${oneDefinition.kind}/${oneDefinition.name}` +
					collisionDiscriminator;

				// DME role (design §3.4): message roots (top-level elements) and named
				// complexTypes -> CLASS; enumeration-carrying simpleTypes -> OPTION_SET; other
				// simpleTypes and groups -> SUPPORT.
				const carriesEnumerations =
					oneDefinition.content &&
					oneDefinition.content.derivations.some(
						(oneDerivation) => oneDerivation.enumerationValues.length > 0,
					);
				// the bespoke rebuilt this table INSIDE the loop, once per definition, and read it with
				// a bare lookup that yielded `undefined` for an unknown XSD kind — the kit then refused
				// the undefined ROLE, which stops the build at the wrong end of the fault. The registry is
				// frozen at module scope and its lookup REFUSES BY NAME on the KIND. Byte-neutral: the same
				// four kinds resolve to the same four roles, enumeration-sensitivity included.
				const definitionRole = definitionRoleFor({
					definitionKind: oneDefinition.kind,
					carriesEnumerations,
				});
				const definitionPath = `${owningName} ${oneDefinition.name}`;

				const searchTextElement =
					definitionRole === DME_ROLES.CLASS
						? {
								role: definitionRole,
								name: oneDefinition.name,
								standardName: STANDARD_SOURCE,
								owningName,
							}
						: definitionRole === DME_ROLES.OPTION_SET
							? {
									role: definitionRole,
									name: oneDefinition.name,
									owningClassName: owningName,
								}
							: {
									role: definitionRole,
									name: oneDefinition.name,
									owningName,
									standardName: STANDARD_SOURCE,
								};

				makeNode({
					role: definitionRole,
					perStandardLabel: labelForNativeKind(PESC_NATIVE_KIND.NAMED_DEFINITION),
					stableId: definitionStableId,
					name: oneDefinition.name,
					documentation: oneDefinition.documentation,
					searchTextElement,
					structural: {
						parentId: artifactStableId,
						depth: 2,
						path: definitionPath,
					},
					scalar: {
						kind: oneDefinition.kind,
						documentPosition: oneDefinition.documentPosition,
						typeAsWritten: oneDefinition.typeAsWritten,
						substitutionGroupAsWritten: oneDefinition.substitutionGroupAsWritten,
						abstract: oneDefinition.abstractAsWritten,
						nillable: oneDefinition.nillableAsWritten,
						declaringArtifactSha256: oneArtifact.sha256,
						declaringFilename: oneArtifact.filename,
						contentModelShape:
							oneDefinition.content && oneDefinition.content.contentModelShape
								? JSON.stringify(oneDefinition.content.contentModelShape)
								: null,
					},
				});
				addEdge('DECLARES', artifactStableId, definitionStableId, {
					documentPosition: oneDefinition.documentPosition,
				});
				stats.namedDefinitions++;

				if (oneDefinition.content) {
					emitContainerContents({
						containerStableId: definitionStableId,
						containerName: oneDefinition.name,
						containerPath: definitionPath,
						content: oneDefinition.content,
						depth: 2,
					});
				}
				if (oneDefinition.anonymousType) {
					emitAnonymousType({
						ownerStableId: definitionStableId,
						ownerName: oneDefinition.name,
						ownerPath: definitionPath,
						anonymousType: oneDefinition.anonymousType,
						depth: 2,
					});
				}
			});
		});

		return { nodes, edges, stats };
	};
		// -------------------------------------------------------------------------------------
		// mintRawNode — THE FOURTH DOOR CLOSED (rulings FJ-P4-4 and its extension).
		//
		// The derived and synthetic tiers each build node OBJECTS of their own. The framework
		// refuses any returned node the kit did not mint ("the kit is the only door for CREATION"),
		// so those FOUR mint sites are routed through kit.makeNode HERE, in the walk, rather than by
		// giving the framework a pre-minted-node channel:
		//     derivedTier.js:667    PescNamespace          63 nodes
		//     syntheticTier.js:790  merged child (clone)  522 nodes
		//     syntheticTier.js:1356 merged definition     109 nodes
		//     syntheticTier.js:1820 alias PescNamespace     1 node
		//                                                 --- 695 of 42,372
		// ⚠ I told the supervisor twice that derivedTier created ZERO nodes. That was FALSE, and it
		// came from a grep that never ran: derivedTier.js carries raw NUL bytes as composite-key
		// separators, so `file` calls it data and grep skips it silently without -a. The census
		// arithmetic (63 + 109 + 522 + 1 = 695, and PescNamespace 64 = 63 + 1) is what reconciles.
		//
		// THE BAG IS SPLIT, NOT HANDED OVER WHOLE: the universals the kit stamps itself become
		// makeNode ARGUMENTS, everything else travels as carriedProperties. Handing the kit a bag
		// containing a universal is REFUSED BY NAME (contractGraphKit.js:214-217), which is the
		// collision the supervisor asked me to report if it appeared — it does not appear, because
		// the split is done here.
		//
		// AND searchText IS THE ONE UNIVERSAL THE KIT CANNOT SIMPLY RECOMPUTE. The kit builds it
		// from the plain ladder; PESC's merged children build theirs through the HYBRID composer
		// (searchTextComposition.composeOneSearchText), which is a different function with a
		// different result. So the tier passes the element it actually used — the kit's value then
		// matches for the three plain-ladder sites — and where the tier composed something else, the
		// TIER'S TEXT WINS and is assigned onto the live node. That is not a bypass of the kit: the
		// kit still mints, and PESC already mutates searchText in place through
		// applySearchTextComposition for the whole source tier. Creation has one door; composition
		// is a documented pass over already-minted nodes.
		// -------------------------------------------------------------------------------------
		const UNIVERSAL_MINT_PROPERTY_NAME_LIST = Object.freeze([
			'_id',
			'_source',
			'name',
			'role',
			'searchText',
			'parentId',
			'path',
			'pesc260805StableId',
		]);

		const mintRawNode = ({ rawNode, searchTextElement, describedBy }) => {
			const rawProperties = rawNode.properties;
			const perStandardLabel = rawNode.labels.find(
				(oneLabel) => oneLabel !== NODE_LABELS.FORGED_NODE && oneLabel.indexOf('Dme') !== 0,
			);
			if (perStandardLabel === undefined) {
				throw new Error(
					`${moduleName} REFUSED: ${describedBy} carries no per-standard label — labels are ` +
						`[${rawNode.labels.join(', ')}]; every PESC node carries exactly one label that is ` +
						`neither the framework pair nor a Dme* role`,
				);
			}
			labelForNativeKind(
				Object.keys(PER_STANDARD_LABEL_BY_NATIVE_KIND).find(
					(oneKind) => PER_STANDARD_LABEL_BY_NATIVE_KIND[oneKind] === perStandardLabel,
				),
			);
			const carriedProperties = {};
			Object.keys(rawProperties).forEach((oneName) => {
				if (UNIVERSAL_MINT_PROPERTY_NAME_LIST.indexOf(oneName) === -1 && oneName !== 'description') {
					carriedProperties[oneName] = rawProperties[oneName];
				}
			});
			const node = kit.makeNode({
				role: rawNode.role,
				perStandardLabel,
				stableId: rawNode.stableId,
				name: rawProperties.name,
				description: rawProperties.description,
				structural: { parentId: rawProperties.parentId, path: rawProperties.path },
				searchTextElement,
				carriedProperties,
				origin: describedBy,
			});
			if (
				rawProperties.searchText !== undefined &&
				node.properties.searchText !== rawProperties.searchText
			) {
				node.properties.searchText = rawProperties.searchText;
			}
			return node;
		};

		const mintRawEdge = ({ rawEdge }) =>
			kit.addEdge({
				edgeType: rawEdge.type,
				fromStableId: rawEdge.fromRef.id,
				toStableId: rawEdge.toRef.id,
				edgeContext: `pesc ${rawEdge.type} ${rawEdge.fromRef.id} -> ${rawEdge.toRef.id}`,
				edgeProperties: Object.keys(rawEdge.properties || {}).reduce((soFar, oneName) => {
					// provenanceTier is the kit's to stamp; passing it back would be a redundant
					// re-declaration of a byte the framework owns.
					if (oneName !== 'provenanceTier') {
						soFar[oneName] = rawEdge.properties[oneName];
					}
					return soFar;
				}, {}),
			});

		// =====================================================================
		// THE FOUR TIERS, IN THE BESPOKE ORDER — and the order is load-bearing, not incidental.
		// The searchText composition reads each declaration's EFFECTIVE description: its own prose,
		// or its type's reached over RESOLVES_TO. Those edges do not exist until the DERIVED tier has
		// run, so composing at mint time would resolve to the element's own description only and hand
		// ~68% of declarations the bare element name — C1, the arm the cosine guard DISQUALIFIED.
		// That failure PARSES, FORGES AND ROUND-TRIPS CLEAN, which is why the pass is placed rather
		// than inlined. And it runs BEFORE the synthetic tier, whose merged children compose at their
		// own seat inside syntheticTier.
		//
		// ⚠ WHY ALL THE ROUTING IS HERE AND NEITHER TIER MODULE IS EDITED. applyDerivedTier does not
		// mutate the nodes it is handed — it CLONES them, deliberately, because a caller once fed it
		// a shared graph and the contamination masked five gate failures (its own comment records
		// this). The framework's integrity pass, meanwhile, checks node IDENTITY: every returned node
		// must be an object the kit itself minted. Those two contracts are incompatible on their
		// face — the clone is a different object — so the walk reconciles them explicitly rather than
		// weakening either: the tiers keep producing plain objects exactly as they do today, and the
		// walk WRITES THE ANNOTATIONS BACK onto the kit's live nodes and MINTS every genuinely new
		// node and edge through the kit. Neither derivedTier.js nor syntheticTier.js is touched.
		// =====================================================================
		const sourceGraph = buildSourceTierGraph({ artifacts, parseAudit });

		const kitNodeByStableId = {};
		kit.nodes.forEach((oneNode) => {
			kitNodeByStableId[oneNode.stableId] = oneNode;
		});
		const edgeCountBeforeTiers = kit.edges.length;

		const derivedOutput = buildDerivedTier({ nodes: kit.nodes, edges: kit.edges });
		const combinedGraph = applyDerivedTier({
			nodes: kit.nodes,
			edges: kit.edges,
			derivedOutput,
		});

		// write-back + mint, in ONE pass over what the derived tier returned. A node whose stableId
		// the kit already minted is an ANNOTATED CLONE: its properties are copied onto the live node
		// and the clone is discarded. A node whose stableId is new is a genuine derived-tier mint
		// (the 63 PescNamespace nodes) and goes through the kit.
		combinedGraph.nodes.forEach((oneReturnedNode) => {
			const liveNode = kitNodeByStableId[oneReturnedNode.stableId];
			if (liveNode === undefined) {
				const mintedNode = mintRawNode({
					rawNode: oneReturnedNode,
					searchTextElement: { role: oneReturnedNode.role, name: oneReturnedNode.properties.name },
					describedBy: `pesc derived tier '${oneReturnedNode.stableId}'`,
				});
				kitNodeByStableId[mintedNode.stableId] = mintedNode;
				return;
			}
			Object.keys(oneReturnedNode.properties).forEach((oneName) => {
				liveNode.properties[oneName] = oneReturnedNode.properties[oneName];
			});
		});
		combinedGraph.edges.slice(edgeCountBeforeTiers).forEach((oneReturnedEdge) => {
			mintRawEdge({ rawEdge: oneReturnedEdge });
		});

		const compositionOutput = applySearchTextComposition({
			nodes: kit.nodes,
			edges: kit.edges,
		});

		const syntheticOutput = buildSyntheticTier({
			nodes: kit.nodes,
			edges: kit.edges,
		});
		syntheticOutput.nodes.forEach((oneSyntheticNode) => {
			mintRawNode({
				rawNode: oneSyntheticNode,
				searchTextElement: { role: oneSyntheticNode.role, name: oneSyntheticNode.properties.name },
				describedBy: `pesc synthetic tier '${oneSyntheticNode.stableId}'`,
			});
		});
		syntheticOutput.edges.forEach((oneSyntheticEdge) => {
			mintRawEdge({ rawEdge: oneSyntheticEdge });
		});
		// The walk hands back THE KIT'S OWN ARRAYS. Every node and edge in them was minted through
		// the kit — source tier through the wrappers above, the four tier sites through mintRawNode
		// — so the framework's integrity pass finds no stranger. Emission ORDER differs from the
		// bespoke module's and cannot reach the block id: harvest re-reads the loaded graph ORDER BY
		// stableId (replay-engine.js:709-840), which is why order-insensitivity is a property of the
		// oracle rather than a hope (SPEC §3.7 consequence 1).
		return {
			nodes: kit.nodes,
			edges: kit.edges,
			// stats — the bespoke shape, EXACTLY. parseAudit rides inside sourceGraph.stats and is
			// carried deliberately: it is DIGEST-EXCLUDED run diagnostics, so a byte-perfect block id
			// is compatible with its total absence. Phase 3 dropped SIF's and nine assertions in
			// test-r3-canonical went red together while I3 stayed exact. A bundle's contract is
			// larger than its block.
			stats: {
				...sourceGraph.stats,
				derived: derivedOutput.stats,
				synthetic: syntheticOutput.stats,
				searchTextComposition: compositionOutput.stats,
			},
			// the S-1 merge report rides out with the graph through the framework's declared
			// standard-specific reports channel (forge-framework.js:203, 327, 562-574). Four
			// assertions in test-pesc260805SyntheticTier read it, so it is load-bearing rather than
			// decorative.
			syntheticMergeReport: syntheticOutput.mergeReport,
		};
	};

	return { emitContractGraph, PESC_TIER, PESC_NATIVE_KIND, PER_STANDARD_LABEL_BY_NATIVE_KIND, labelForNativeKind, definitionRoleFor };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
