'use strict';

// forgeEdfiContractGraph.js — forge-edfi's WALK (H3) on the Forge Framework (SPEC-forgeFramework-v1.md
// §5.1 emitContractGraph, §8.2; migrated F3b 2026-08-16 from the Phase 2 pure shaping layer,
// R-WO-8/R-WO-9). PURE, synchronous, deterministic. Consumes the Phase 1 parser's in-memory MetaEd
// model (the declared interface in metaEdParser.js), the descriptor code-value sets
// (descriptorCodeValueLoader.js), the authored crosswalk registries (crosswalkCarrier.js) and the
// framework's KIT, and returns { nodes, edges, stats, crosswalkMatchReport } — the kit's collected
// arrays in emission order plus this standard's report.
//
// WHAT MOVED TO THE FRAMEWORK (SPEC §8.2, byte-identical — block aea6d8dfe789…): the constants
// (→ lib/edfiForgeDeclaration.js), makeNode / addEdge / registerStableId / isCleanStableId /
// searchTextElementFor / normalizeCedsCrossRef / carriedScalars' scalar copy (→ kit.makeNode,
// kit.addEdge, kit.isCleanStableId, kit.searchTextElementFor, kit.cedsAnchorValue,
// kit.carriedProperties, kit.crossRefsJson, kit.emitOptionValue), the ROOT (→ rootNode.js from the
// declaration + describeRoot), the dangling-endpoint terminal check and the structural finalizer
// (→ buildContractGraph's integrity pass). What remains is Ed-Fi: the registries, the identity rule,
// the passes over constructs / properties / descriptors / option values / crosswalk annotation, and
// the per-standard refusals of malformed STANDARD content (Profile §7.2 keeps those in the hook).
//
// ROLE MAPPING (ruling R-WO-9, AMBER_TOWER 2026-08-03):
//   DmeClass      abstractEntity, association(+Extension/+Subclass), choice,
//                 common(+Extension/+Subclass), domainEntity(+Extension/+Subclass), inlineCommon
//   DmeProperty   every parsed property on every construct, including association
//                 defining-domain-entity slots (propertyType 'definingDomainEntity')
//   DmeOptionSet  descriptor, enumeration
//   DmeOptionValue descriptor code values (XML), enumeration items, map-type items
//   DmeSupport    sharedString/sharedInteger/sharedShort/sharedDecimal, domain, subdomain,
//                 interchange, interchangeExtension
//
// IDENTITY (R-WO-1: new source, new inventory, new identities where they fall):
//   root                edfi:root
//   construct           edfi:<constructType>/<constructName>
//   property            edfi:property/<ownerConstructType>.<ownerName>.<effectivePropertyName>
//                       (the owner constructType disambiguates a base construct from its
//                       extension, which shares the extendee's name)
//   option value        edfi:value/<optionSetName>.<codeValue>
//   A DUPLICATE stableId is a refusal naming both origins — never a silent overwrite.
//
// ABSENT IS ABSENT (RT-2): a field the source does not state is a field the node does not
// carry. No ''-as-value, no || defaults, no placeholder descriptions.
//
// REFUSALS (thrown; the framework's ONE adapter in forge() step 5 surfaces them as forge errors):
//   - a code-value XML naming a descriptor absent from the model (R-WO-10: a contradiction
//     between two declared inputs of one snapshot)
//   - an unresolvable model-internal reference (property target, subclass base, extension
//     extendee, domain item, interchange component, subdomain parent)
//   - an unnormalizable CEDS cross-ref (R3, kit.cedsAnchorValue); a duplicate stableId and a
//     dangling edge endpoint are the KIT's refusals now (same wording class, same three-state twins)
// UNMATCHED CROSSWALK ROWS ARE NOT REFUSALS (R-WO-11): they are reported, per row, in
// crosswalkMatchReport — the honest partial match IS the census-delta evidence.
//
// This module is self-contained by design: it takes NO dependency on the incumbent forge's
// lib/ (parser.js, normalize.js), which is scheduled for closeout removal (R-WO-2).

const path = require('path');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
// the vocabulary registry, required by path exactly as every forge does today (a tree lib; G-NOGRAPH permits it)
const { DME_ROLES, EDGE_TYPES } = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const forgeDeclaration = require('./edfiForgeDeclaration'); // H1 — the constants live there, once

const { standardSource: STANDARD_SOURCE, mappingInstruction } = forgeDeclaration;

// the authored-crosswalk anchor names the walk stashes as `locator` and as the nodes'
// cedsOriginalAnchorPropertyName / cedsOptionOriginalAnchorPropertyName lists ARE the declaration's
// original anchor property names (one source, no second literal); Ed-Fi declares exactly ONE of each
const anchorNameFrom = (anchorNameList, anchorKindLabel) => {
	if (!Array.isArray(anchorNameList) || anchorNameList.length !== 1 || typeof anchorNameList[0] !== 'string') {
		throw new Error(
			`forge-edfi REFUSED: mappingInstruction.${anchorKindLabel} must name exactly ONE anchor property ` +
				`(got ${JSON.stringify(anchorNameList)}) — the walk stashes that name as the crossRefs locator`,
		);
	}
	return anchorNameList[0];
};
const CEDS_ANCHOR_PROPERTY_NAME = anchorNameFrom(mappingInstruction.cedsOriginalAnchorPropertyName, 'cedsOriginalAnchorPropertyName');
const CEDS_OPTION_ANCHOR_PROPERTY_NAME = anchorNameFrom(mappingInstruction.cedsOptionOriginalAnchorPropertyName, 'cedsOptionOriginalAnchorPropertyName');

// =====================================================================
// REGISTRIES (house law: registry over switch, everywhere)
// =====================================================================

// constructType -> { role, nameField, perStandardLabel, ownershipEdgeType }
// ownershipEdgeType null for option sets: they are owned by their constraining property
// (HAS_OPTION_SET, property -> set), with true orphans anchored from the root in a dedicated
// pass — the incumbent's reachability doctrine, kept.
const CONSTRUCT_ROLE_REGISTRY = {
	abstractEntity: { role: DME_ROLES.CLASS, nameField: 'entityName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	association: { role: DME_ROLES.CLASS, nameField: 'associationName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	associationExtension: { role: DME_ROLES.CLASS, nameField: 'extendeeName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	associationSubclass: { role: DME_ROLES.CLASS, nameField: 'associationName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	choice: { role: DME_ROLES.CLASS, nameField: 'choiceName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	common: { role: DME_ROLES.CLASS, nameField: 'commonName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	commonExtension: { role: DME_ROLES.CLASS, nameField: 'extendeeName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	commonSubclass: { role: DME_ROLES.CLASS, nameField: 'commonName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	descriptor: { role: DME_ROLES.OPTION_SET, nameField: 'descriptorName', ownershipEdgeType: null },
	domain: { role: DME_ROLES.SUPPORT, nameField: 'domainName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
	domainEntity: { role: DME_ROLES.CLASS, nameField: 'entityName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	domainEntityExtension: { role: DME_ROLES.CLASS, nameField: 'extendeeName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	domainEntitySubclass: { role: DME_ROLES.CLASS, nameField: 'entityName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	enumeration: { role: DME_ROLES.OPTION_SET, nameField: 'enumerationName', ownershipEdgeType: null },
	inlineCommon: { role: DME_ROLES.CLASS, nameField: 'inlineCommonName', ownershipEdgeType: EDGE_TYPES.HAS_CLASS },
	interchange: { role: DME_ROLES.SUPPORT, nameField: 'interchangeName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
	interchangeExtension: { role: DME_ROLES.SUPPORT, nameField: 'extendeeName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
	sharedDecimal: { role: DME_ROLES.SUPPORT, nameField: 'sharedDecimalName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
	sharedInteger: { role: DME_ROLES.SUPPORT, nameField: 'sharedIntegerName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
	sharedShort: { role: DME_ROLES.SUPPORT, nameField: 'sharedShortName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
	sharedString: { role: DME_ROLES.SUPPORT, nameField: 'sharedStringName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
	subdomain: { role: DME_ROLES.SUPPORT, nameField: 'subdomainName', ownershipEdgeType: EDGE_TYPES.HAS_SUPPORT },
};

// reference family -> the constructTypes a reference of that family may resolve to
const REFERENCE_FAMILY_REGISTRY = {
	abstractEntity: ['abstractEntity'],
	association: ['association', 'associationSubclass'],
	choice: ['choice'],
	domain: ['domain'],
	common: ['common', 'commonSubclass'],
	descriptor: ['descriptor'],
	domainEntity: ['domainEntity', 'domainEntitySubclass', 'abstractEntity'],
	enumeration: ['enumeration'],
	inlineCommon: ['inlineCommon'],
	interchange: ['interchange'],
	sharedDecimal: ['sharedDecimal'],
	sharedInteger: ['sharedInteger'],
	sharedShort: ['sharedShort'],
	sharedString: ['sharedString'],
	// domain items and interchange components: the canonical corpus uses the item KEYWORD
	// loosely (measured: Domain 'Assessment' declares 'domain entity
	// LearningStandardEquivalenceAssociation', which the model defines as an ASSOCIATION).
	// Resolution is therefore BY NAME across the item-capable families; the declared keyword is
	// preserved and every keyword-vs-actual mismatch is CENSUSED in
	// stats.itemKeywordMismatchList — visible drift, never silent substitution. A name that
	// resolves NOWHERE still refuses.
	itemReference: [
		'domainEntity', 'domainEntitySubclass', 'abstractEntity',
		'association', 'associationSubclass',
		'common', 'commonSubclass', 'inlineCommon', 'descriptor',
	],
};

// propertyType -> the reference edge it emits, or null for scalar types (no edge)
const PROPERTY_REFERENCE_EDGE_REGISTRY = {
	association: { edgeType: EDGE_TYPES.REFERENCES, targetFamily: 'association' },
	boolean: null,
	choice: { edgeType: EDGE_TYPES.REFERENCES, targetFamily: 'choice' },
	common: { edgeType: EDGE_TYPES.REFERENCES, targetFamily: 'common' },
	currency: null,
	date: null,
	datetime: null,
	decimal: null,
	definingDomainEntity: { edgeType: EDGE_TYPES.REFERENCES, targetFamily: 'domainEntity' },
	descriptor: { edgeType: EDGE_TYPES.HAS_OPTION_SET, targetFamily: 'descriptor' },
	domainEntity: { edgeType: EDGE_TYPES.REFERENCES, targetFamily: 'domainEntity' },
	duration: null,
	enumeration: { edgeType: EDGE_TYPES.HAS_OPTION_SET, targetFamily: 'enumeration' },
	inlineCommon: { edgeType: EDGE_TYPES.REFERENCES, targetFamily: 'inlineCommon' },
	integer: null,
	percent: null,
	sharedDecimal: { edgeType: EDGE_TYPES.REFERENCES_TYPE, targetFamily: 'sharedDecimal' },
	sharedInteger: { edgeType: EDGE_TYPES.REFERENCES_TYPE, targetFamily: 'sharedInteger' },
	sharedShort: { edgeType: EDGE_TYPES.REFERENCES_TYPE, targetFamily: 'sharedShort' },
	sharedString: { edgeType: EDGE_TYPES.REFERENCES_TYPE, targetFamily: 'sharedString' },
	short: null,
	string: null,
	time: null,
	year: null,
};

// subclass constructType -> the family its baseName resolves against (SUBCLASS_OF edges)
const SUBCLASS_BASE_FAMILY_REGISTRY = {
	associationSubclass: 'association',
	commonSubclass: 'common',
	domainEntitySubclass: 'domainEntity',
};

// extension constructType -> the family its extendeeName resolves against (REFERENCES edges)
const EXTENSION_EXTENDEE_FAMILY_REGISTRY = {
	associationExtension: 'association',
	commonExtension: 'common',
	domainEntityExtension: 'domainEntity',
	interchangeExtension: 'interchange',
};

// faithful native scalars carried onto CONSTRUCT nodes when present (RT-2: when absent, absent)
const CONSTRUCT_SCALAR_CARRY_LIST = [
	'metaEdId', 'deprecatedText', 'footerDocumentationText', 'extendedDocumentationText',
	'useCaseDocumentationText', 'allowPrimaryKeyUpdates', 'subdomainPosition', 'parentDomainName',
	'baseName', 'baseNamespace', 'extendeeName', 'extendeeNamespace', 'mapTypeRequired',
	'mapTypeDocumentationText', 'minValue', 'maxValue', 'minValueDecimal', 'maxValueDecimal',
	'minLength', 'maxLength', 'totalDigits', 'decimalPlaces', 'isBigInteger',
	'sourceFileRelativePath', 'sourceLineNumber',
];

// faithful native scalars carried onto PROPERTY nodes when present
const PROPERTY_SCALAR_CARRY_LIST = [
	'propertyType', 'metaEdId', 'deprecatedText', 'documentationInherited', 'annotationKind',
	'renamesIdentityPropertyName', 'roleNameName', 'shortenToName', 'isQueryableField',
	'propertyNamespace', 'sharedTypeName', 'sharedTypeNamespace', 'sharedPropertyName',
	'commonExtensionOverride', 'potentiallyLogical', 'isWeakReference', 'minValue', 'maxValue',
	'minValueDecimal', 'maxValueDecimal', 'minLength', 'maxLength', 'totalDigits',
	'decimalPlaces', 'sourceLineNumber',
];

// the interchange component KIND vocabulary, closed and shared. These are EXACTLY the two values
// the parser mints (metaEdSyntaxParser.js:1219) and EXACTLY the two the round-trip answer key
// emits (roundTripMetaEdCanonical.js:258-266). There is deliberately NO translation layer: a
// mapping table between two identical vocabularies is a pure drift seam, refused in the plan and
// refused in IMPL D-3. An unrecognised kind is REFUSED BY NAME rather than carried, defaulted or
// coerced — a kind that reached the graph unrecognised would round-trip as simultaneous LOSS and
// INVENTION, which is a far more expensive way to learn the same thing.
const INTERCHANGE_COMPONENT_KIND_REGISTRY = ['element', 'identityTemplate'];

// =====================================================================
// normalization (self-contained; no dependency on the closeout-scheduled incumbent lib)
// =====================================================================

// the stableId predicate is the declaration's stableIdPattern, applied by kit.isCleanStableId at mint

const buildConstructStableId = ({ constructType, constructName }) => {
	const cleanName = constructName == null ? '' : `${constructName}`.trim();
	if (cleanName === '') {
		throw new Error(
			`forge-edfi R3 stableId miss: empty construct name for constructType '${constructType}'`,
		);
	}
	return `edfi:${constructType}/${cleanName}`;
};

// the canonical CEDS property anchor (P<6-digit zero-padded>) is kit.cedsAnchorValue({ rawValue, kind:
// 'property' }) — the ONE normalizer (D14), the declaration's cedsAnchorAbsentSentinelList ('000000'),
// a present-but-unnormalizable annotation REFUSED by the kit (R3), never data
const CEDS_ANCHOR_KIND = 'property';

// the effective property name: MetaEd role-name context prefixes the base name (Ed-Fi naming
// semantics); 'named' overrides for shared properties; shared properties without 'named' take
// the shared type's local name
const effectivePropertyNameFor = (parsedProperty) => {
	const baseName =
		parsedProperty.sharedPropertyName ||
		parsedProperty.propertyName ||
		parsedProperty.sharedTypeName;
	if (parsedProperty.roleNameName && parsedProperty.roleNameName !== baseName) {
		return `${parsedProperty.roleNameName}${baseName}`;
	}
	return baseName;
};

// =====================================================================
// moduleFunction
// =====================================================================

const moduleFunction = () => {
	// =====================================================================
	// emitContractGraph — the WALK (H3). PURE, deterministic.
	//   { metaEdModel, descriptorCodeValues, authoredCrosswalk, kit }
	//     -> { nodes, edges, stats, crosswalkMatchReport }
	//   nodes / edges are the KIT's collected arrays (every creation went through kit.makeNode /
	//   kit.addEdge / kit.emitOptionValue); the ROOT is already minted when the walk starts
	//   (kit.rootStableId) and is the first member of kit.nodes.
	// =====================================================================
	const emitContractGraph = ({ metaEdModel, descriptorCodeValues, authoredCrosswalk, kit }) => {
		const { nodes, edges, stats } = kit;
		// this standard's own counters, added onto the kit's (nodeCountByRole / edgeCountByType /
		// danglingEdges are the kit's)
		Object.assign(stats, {
			constructCountByType: {},
			optionValueCountByOrigin: {},
			crossRefsAnnotatedProperties: 0,
			crossRefsAnnotatedDescriptors: 0,
			crossRefsAnnotatedOptionValues: 0,
			orphanAnchoredOptionSets: 0,
			itemKeywordMismatchList: [],
		});
		const rootStableId = kit.rootStableId;

		// ---- indexes ----
		const constructNodeByTypeAndName = {}; // `${constructType}/${name}` -> node
		const propertyNodeListByOwnerAndName = {}; // `${ownerName}.${effectiveName}` -> [node]
		const optionValueNodeBySetAndCode = {}; // `${optionSetName}.${codeValue}` -> node
		const optionSetConstrainedStableIds = new Set(); // sets owned by >=1 property

		const originFor = (parsedConstruct) =>
			`${parsedConstruct.sourceFileRelativePath || 'synthetic'}:${parsedConstruct.sourceLineNumber || '?'}`;

		// carry whitelisted native scalars that are PRESENT (RT-2) — kit.carriedProperties (the
		// `!== undefined` filter, SPEC §3.4) plus Ed-Fi's mergeDirectives: the walk composes that JSON
		// string itself and passes it in the carry object (its key order is the parser's — G-JSONKEYS)
		const carriedScalars = ({ parsedObject, carryList }) => ({
			...kit.carriedProperties({ parsedObject, carryList }),
			...(parsedObject.mergeDirectiveList !== undefined
				? { mergeDirectives: JSON.stringify(parsedObject.mergeDirectiveList) }
				: {}),
		});

		// per-standard label: Edfi + capitalized constructType (new inventory, R-WO-1)
		const perStandardLabelFor = (constructType) =>
			`Edfi${constructType.charAt(0).toUpperCase()}${constructType.slice(1)}`;

		// ---- flatten construct lists in deterministic parse order (core input first) ----
		const orderedConstructList = [];
		Object.entries(metaEdModel.constructsByInput).forEach(([inputName, constructList]) => {
			constructList.forEach((parsedConstruct) => {
				orderedConstructList.push({ inputName, parsedConstruct });
			});
		});

		// the DmeStandardRoot is FRAMEWORK-built from the declaration + describeRoot (rootNode.js) and
		// already minted: kit.rootStableId; the walk parents constructs on it and anchors orphan option
		// sets from it

		// =====================================================================
		// PASS 1 — construct nodes (all types), indexed for reference resolution
		// =====================================================================
		orderedConstructList.forEach(({ inputName, parsedConstruct }) => {
			const roleSpec = CONSTRUCT_ROLE_REGISTRY[parsedConstruct.constructType];
			if (!roleSpec) {
				throw new Error(
					`forge-edfi REFUSED: unknown constructType '${parsedConstruct.constructType}' ` +
						`(from ${originFor(parsedConstruct)}) — not in CONSTRUCT_ROLE_REGISTRY`,
				);
			}
			const constructName = parsedConstruct[roleSpec.nameField];
			const stableId = buildConstructStableId({
				constructType: parsedConstruct.constructType,
				constructName,
			});
			const constructCarriedProperties = {
				constructType: parsedConstruct.constructType,
				sourceInputName: inputName,
				...carriedScalars({ parsedObject: parsedConstruct, carryList: CONSTRUCT_SCALAR_CARRY_LIST }),
			};
			const constructNode = kit.makeNode({
				role: roleSpec.role,
				perStandardLabel: perStandardLabelFor(parsedConstruct.constructType),
				stableId,
				name: constructName,
				description: parsedConstruct.documentationText,
				structural: {
					parentId: rootStableId,
					path: constructName,
					owningName: STANDARD_SOURCE,
				},
				carriedProperties: constructCarriedProperties,
				origin: originFor(parsedConstruct),
			});
			constructNodeByTypeAndName[`${parsedConstruct.constructType}/${constructName}`] =
				constructNode;
			stats.constructCountByType[parsedConstruct.constructType] =
				(stats.constructCountByType[parsedConstruct.constructType] || 0) + 1;
			if (roleSpec.ownershipEdgeType) {
				kit.addEdge({ edgeType: roleSpec.ownershipEdgeType, fromStableId: rootStableId, toStableId: stableId, edgeContext: `root->${constructName}` });
			}
		});

		// resolve a (family, localName) reference to a construct node, or undefined
		const resolveFamilyReference = ({ targetFamily, targetLocalName }) => {
			const familyTypeList = REFERENCE_FAMILY_REGISTRY[targetFamily];
			if (!familyTypeList) {
				throw new Error(
					`forge-edfi REFUSED: unknown reference family '${targetFamily}' — not in ` +
						`REFERENCE_FAMILY_REGISTRY`,
				);
			}
			for (const oneConstructType of familyTypeList) {
				const targetNode = constructNodeByTypeAndName[`${oneConstructType}/${targetLocalName}`];
				if (targetNode) {
					return targetNode;
				}
			}
			return undefined;
		};

		const refuseUnresolvedReference = ({ referenceKindLabel, targetFamily, targetLocalName, origin }) => {
			throw new Error(
				`forge-edfi REFUSED: ${referenceKindLabel} '${targetLocalName}' (family ` +
					`'${targetFamily}') resolves to NO construct in the parsed model (from ${origin}). ` +
					`A model-internal reference that cannot be resolved is a broken model, not a skip.`,
			);
		};

		// =====================================================================
		// PASS 2 — property nodes + property reference edges + option values
		// =====================================================================
		orderedConstructList.forEach(({ inputName, parsedConstruct }) => {
			const roleSpec = CONSTRUCT_ROLE_REGISTRY[parsedConstruct.constructType];
			const constructName = parsedConstruct[roleSpec.nameField];
			const constructStableId = buildConstructStableId({
				constructType: parsedConstruct.constructType,
				constructName,
			});

			// -- properties (propertyList + association defining-domain-entity slots) --
			const parsedPropertyEntryList = [];
			(parsedConstruct.definingDomainEntityList || []).forEach((oneDefiningEntity) => {
				parsedPropertyEntryList.push({
					...oneDefiningEntity,
					propertyType: 'definingDomainEntity',
				});
			});
			(parsedConstruct.propertyList || []).forEach((oneProperty) => {
				parsedPropertyEntryList.push(oneProperty);
			});

			parsedPropertyEntryList.forEach((parsedProperty) => {
				const referenceSpec = PROPERTY_REFERENCE_EDGE_REGISTRY[parsedProperty.propertyType];
				if (referenceSpec === undefined) {
					throw new Error(
						`forge-edfi REFUSED: unknown propertyType '${parsedProperty.propertyType}' on ` +
							`${constructName} (from ${originFor(parsedConstruct)}) — not in ` +
							`PROPERTY_REFERENCE_EDGE_REGISTRY`,
					);
				}
				const effectiveName = effectivePropertyNameFor(parsedProperty);
				const propertyStableId = `edfi:property/${parsedConstruct.constructType}.${constructName}.${effectiveName}`;
				const propertyOrigin = `${parsedConstruct.sourceFileRelativePath || 'synthetic'}:${parsedProperty.sourceLineNumber || '?'}`;
				const propertyDescription =
					parsedProperty.documentationText !== undefined
						? parsedProperty.documentationText
						: undefined;
				const propertyNode = kit.makeNode({
					role: DME_ROLES.PROPERTY,
					perStandardLabel: 'EdfiProperty',
					stableId: propertyStableId,
					name: effectiveName,
					description: propertyDescription,
					structural: {
						parentId: constructStableId,
						path: `${constructName}.${effectiveName}`,
						owningName: constructName,
					},
					carriedProperties: {
						owningConstructName: constructName,
						owningConstructType: parsedConstruct.constructType,
						sourceInputName: inputName,
						sourceFileRelativePath: parsedConstruct.sourceFileRelativePath,
						...carriedScalars({ parsedObject: parsedProperty, carryList: PROPERTY_SCALAR_CARRY_LIST }),
					},
					origin: propertyOrigin,
				});
				(propertyNodeListByOwnerAndName[`${constructName}.${effectiveName}`] =
					propertyNodeListByOwnerAndName[`${constructName}.${effectiveName}`] || []).push(
					propertyNode,
				);

				kit.addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: constructStableId, toStableId: propertyStableId, edgeContext: `${constructName}->${effectiveName}` });

				if (referenceSpec !== null) {
					const targetLocalName =
						parsedProperty.sharedTypeName || parsedProperty.propertyName;
					const targetNode = resolveFamilyReference({
						targetFamily: referenceSpec.targetFamily,
						targetLocalName,
					});
					if (!targetNode) {
						refuseUnresolvedReference({
							referenceKindLabel: `property '${effectiveName}' of ${constructName} referencing`,
							targetFamily: referenceSpec.targetFamily,
							targetLocalName,
							origin: propertyOrigin,
						});
					}
					kit.addEdge({
						edgeType: referenceSpec.edgeType,
						fromStableId: propertyStableId,
						toStableId: targetNode.stableId,
						edgeContext: `${constructName}.${effectiveName}->${targetLocalName}`,
					});
					if (referenceSpec.edgeType === EDGE_TYPES.HAS_OPTION_SET) {
						optionSetConstrainedStableIds.add(targetNode.stableId);
					}
				}
			});

			// -- option values --
			// IDENTITY NORMALIZATION (house rule, incumbent normalize.js precedent): the stableId's
			// natural key is TRIMMED; the name/codeValue property carries the source-verbatim string
			// (snapshot 04 really does contain a trailing-space code value). Two values whose trimmed
			// identities collide hit the duplicate-stableId refusal — normalization never merges
			// silently.
			const emitOptionValue = ({ codeValueText, valueOrigin, valueScalars, valueDescription, origin }) => {
				const trimmedCodeValue = `${codeValueText}`.trim();
				if (trimmedCodeValue === '') {
					throw new Error(
						`forge-edfi R3 stableId miss: empty (all-whitespace) code value on ` +
							`'${constructName}' (from ${origin})`,
					);
				}
				const optionValueStableId = `edfi:value/${constructName}.${trimmedCodeValue}`;
				// the kit's helper mints the DmeOptionValue parented on its set and adds HAS_VALUE (set → value)
				const optionValueNode = kit.emitOptionValue({
					optionSetStableId: constructStableId,
					optionValueStableId,
					perStandardLabel: 'EdfiOptionValue',
					name: codeValueText,
					description: valueDescription,
					path: `${constructName}.${trimmedCodeValue}`,
					owningName: constructName,
					carriedProperties: { valueOrigin, ...valueScalars },
					edgeContext: `${constructName}->${codeValueText}`,
					origin,
				});
				optionValueNodeBySetAndCode[`${constructName}.${trimmedCodeValue}`] = optionValueNode;
				stats.optionValueCountByOrigin[valueOrigin] =
					(stats.optionValueCountByOrigin[valueOrigin] || 0) + 1;
			};

			if (parsedConstruct.constructType === 'descriptor') {
				(descriptorCodeValues.codeValueListByDescriptorName[constructName] || []).forEach(
					(oneCodeValue) => {
						emitOptionValue({
							codeValueText: oneCodeValue.codeValue,
							valueOrigin: 'descriptorCodeValueXml',
							valueDescription: oneCodeValue.description,
							valueScalars: {
								...(oneCodeValue.shortDescription !== undefined
									? { shortDescription: oneCodeValue.shortDescription }
									: {}),
								...(oneCodeValue.namespace !== undefined
									? { namespace: oneCodeValue.namespace }
									: {}),
								sourceInputName: oneCodeValue.sourceInputName,
								sourceFileRelativePath: oneCodeValue.sourceFileRelativePath,
							},
							origin: oneCodeValue.sourceFileRelativePath,
						});
					},
				);
				(parsedConstruct.mapTypeItemList || []).forEach((oneMapTypeItem) => {
					emitOptionValue({
						codeValueText: oneMapTypeItem.shortDescription,
						valueOrigin: 'mapTypeItem',
						valueDescription: oneMapTypeItem.documentationText,
						valueScalars: {
							sourceInputName: inputName,
							sourceFileRelativePath: parsedConstruct.sourceFileRelativePath,
							...(oneMapTypeItem.metaEdId !== undefined
								? { metaEdId: oneMapTypeItem.metaEdId }
								: {}),
						},
						origin: originFor(parsedConstruct),
					});
				});
			}
			if (parsedConstruct.constructType === 'enumeration') {
				(parsedConstruct.enumerationItemList || []).forEach((oneEnumerationItem) => {
					emitOptionValue({
						codeValueText: oneEnumerationItem.shortDescription,
						valueOrigin: 'enumerationItem',
						valueDescription: oneEnumerationItem.documentationText,
						valueScalars: {
							sourceInputName: inputName,
							sourceFileRelativePath: parsedConstruct.sourceFileRelativePath,
							...(oneEnumerationItem.metaEdId !== undefined
								? { metaEdId: oneEnumerationItem.metaEdId }
								: {}),
						},
						origin: originFor(parsedConstruct),
					});
				});
			}
		});

		// R-WO-10: a code-value XML naming a descriptor absent from the model is a contradiction
		// between two declared inputs of one snapshot — refusal by name
		Object.keys(descriptorCodeValues.codeValueListByDescriptorName).forEach((descriptorName) => {
			if (!constructNodeByTypeAndName[`descriptor/${descriptorName}`]) {
				const firstValueEntry =
					descriptorCodeValues.codeValueListByDescriptorName[descriptorName][0];
				throw new Error(
					`forge-edfi REFUSED (R-WO-10): descriptor code-value source ` +
						`'${firstValueEntry.sourceFileRelativePath}' names descriptor '${descriptorName}', ` +
						`which does not exist in the parsed MetaEd model. Two declared inputs of one ` +
						`snapshot contradict each other; a broken snapshot is refused, not repaired.`,
				);
			}
		});

		// =====================================================================
		// PASS 3 — construct-level structure edges
		// =====================================================================
		orderedConstructList.forEach(({ parsedConstruct }) => {
			const roleSpec = CONSTRUCT_ROLE_REGISTRY[parsedConstruct.constructType];
			const constructName = parsedConstruct[roleSpec.nameField];
			const constructStableId = buildConstructStableId({
				constructType: parsedConstruct.constructType,
				constructName,
			});
			const constructOrigin = originFor(parsedConstruct);

			const subclassBaseFamily = SUBCLASS_BASE_FAMILY_REGISTRY[parsedConstruct.constructType];
			if (subclassBaseFamily) {
				const baseNode = resolveFamilyReference({
					targetFamily: subclassBaseFamily,
					targetLocalName: parsedConstruct.baseName,
				});
				if (!baseNode) {
					refuseUnresolvedReference({
						referenceKindLabel: `subclass '${constructName}' based on`,
						targetFamily: subclassBaseFamily,
						targetLocalName: parsedConstruct.baseName,
						origin: constructOrigin,
					});
				}
				kit.addEdge({ edgeType: EDGE_TYPES.SUBCLASS_OF, fromStableId: constructStableId, toStableId: baseNode.stableId, edgeContext: `${constructName} based on ${parsedConstruct.baseName}` });
			}

			const extendeeFamily = EXTENSION_EXTENDEE_FAMILY_REGISTRY[parsedConstruct.constructType];
			if (extendeeFamily) {
				const extendeeNode = resolveFamilyReference({
					targetFamily: extendeeFamily,
					targetLocalName: parsedConstruct.extendeeName,
				});
				if (!extendeeNode) {
					refuseUnresolvedReference({
						referenceKindLabel: `extension of`,
						targetFamily: extendeeFamily,
						targetLocalName: parsedConstruct.extendeeName,
						origin: constructOrigin,
					});
				}
				kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: constructStableId, toStableId: extendeeNode.stableId, edgeContext: `${constructName} additions -> ${parsedConstruct.extendeeName}` });
			}

			// item resolution is BY NAME across the item-capable families (see the
			// REFERENCE_FAMILY_REGISTRY itemReference note); declared-vs-actual keyword drift is
			// censused, never silent
			const censusItemKeywordDrift = ({ itemKindLabel, declaredFamily, itemNode, itemName }) => {
				const declaredFamilyTypeList = REFERENCE_FAMILY_REGISTRY[declaredFamily] || [];
				if (!declaredFamilyTypeList.includes(itemNode.properties.constructType)) {
					stats.itemKeywordMismatchList.push({
						itemKindLabel,
						owningConstructName: constructName,
						itemName,
						declaredFamily,
						actualConstructType: itemNode.properties.constructType,
					});
				}
			};

			(parsedConstruct.domainItemList || []).forEach((oneDomainItem) => {
				const itemNode = resolveFamilyReference({
					targetFamily: 'itemReference',
					targetLocalName: oneDomainItem.localDomainItemName,
				});
				if (!itemNode) {
					refuseUnresolvedReference({
						referenceKindLabel: `domain item of '${constructName}'`,
						targetFamily: oneDomainItem.referenceType,
						targetLocalName: oneDomainItem.localDomainItemName,
						origin: constructOrigin,
					});
				}
				censusItemKeywordDrift({
					itemKindLabel: 'domainItem',
					declaredFamily: oneDomainItem.referenceType,
					itemNode,
					itemName: oneDomainItem.localDomainItemName,
				});
				// R-WO-15(d)/(f) carriage: the per-item metaEdId and the namespace qualifier are
				// EDGE content — they belong to this construct's use of the item, not to the item
				// node, which many constructs share. Presence is the test, mirroring the parser's
				// own construction (metaEdSyntaxParser.js:998-1004): the field exists iff the
				// source declared it, so an absent declaration carries NOTHING and the compiler
				// emits nothing for it.
				kit.addEdge({
					edgeType: EDGE_TYPES.REFERENCES,
					fromStableId: constructStableId,
					toStableId: itemNode.stableId,
					edgeContext: `${constructName} domain item ${oneDomainItem.localDomainItemName}`,
					edgeProperties: {
						...(oneDomainItem.metaEdId !== undefined ? { itemMetaEdId: oneDomainItem.metaEdId } : {}),
						...(oneDomainItem.baseNamespace !== undefined
							? { itemNamespaceQualifier: oneDomainItem.baseNamespace }
							: {}),
					},
				});
			});

			(parsedConstruct.interchangeComponentList || []).forEach((oneComponent) => {
				const componentNode = resolveFamilyReference({
					targetFamily: 'itemReference',
					targetLocalName: oneComponent.localInterchangeItemName,
				});
				if (!componentNode) {
					refuseUnresolvedReference({
						referenceKindLabel: `interchange component of '${constructName}'`,
						targetFamily: oneComponent.referenceType,
						targetLocalName: oneComponent.localInterchangeItemName,
						origin: constructOrigin,
					});
				}
				censusItemKeywordDrift({
					itemKindLabel: 'interchangeComponent',
					declaredFamily: oneComponent.referenceType,
					itemNode: componentNode,
					itemName: oneComponent.localInterchangeItemName,
				});
				// componentKind is ALWAYS present — the parser refuses a component whose lead token
				// is neither an element nor an identity token (metaEdSyntaxParser.js:1206-1208), so
				// there is no absent case to model here, only an invalid one.
				if (!INTERCHANGE_COMPONENT_KIND_REGISTRY.includes(oneComponent.componentKind)) {
					throw new Error(
						`forge-edfi REFUSED: interchange component '${oneComponent.localInterchangeItemName}' ` +
							`of '${constructName}' (${constructOrigin}) carries componentKind ` +
							`'${oneComponent.componentKind}', which is not one of: ` +
							`${INTERCHANGE_COMPONENT_KIND_REGISTRY.join(', ')}. The forge and the round-trip ` +
							`answer key share ONE vocabulary with no translation layer between them; an ` +
							`unrecognised kind means the parser and the answer key have diverged and it is ` +
							`never carried, defaulted or coerced.`,
					);
				}
				// R-WO-15(d)/(f) carriage — see the domain-item note above. componentKind is
				// unconditional; the other two are present iff declared.
				kit.addEdge({
					edgeType: EDGE_TYPES.REFERENCES,
					fromStableId: constructStableId,
					toStableId: componentNode.stableId,
					edgeContext: `${constructName} interchange ${oneComponent.componentKind} ${oneComponent.localInterchangeItemName}`,
					edgeProperties: {
						componentKind: oneComponent.componentKind,
						...(oneComponent.metaEdId !== undefined ? { itemMetaEdId: oneComponent.metaEdId } : {}),
						...(oneComponent.baseNamespace !== undefined
							? { itemNamespaceQualifier: oneComponent.baseNamespace }
							: {}),
					},
				});
			});

			if (parsedConstruct.constructType === 'subdomain') {
				const parentDomainNode = resolveFamilyReference({
					targetFamily: 'domain',
					targetLocalName: parsedConstruct.parentDomainName,
				});
				if (!parentDomainNode) {
					refuseUnresolvedReference({
						referenceKindLabel: `subdomain '${constructName}' parent domain`,
						targetFamily: 'domain',
						targetLocalName: parsedConstruct.parentDomainName,
						origin: constructOrigin,
					});
				}
				kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: constructStableId, toStableId: parentDomainNode.stableId, edgeContext: `${constructName} subdomain of ${parsedConstruct.parentDomainName}` });
			}
		});

		// =====================================================================
		// PASS 4 — orphan option-set anchoring (reachability doctrine, kept from incumbent):
		// an option set constrained by ZERO properties is anchored from the root
		// =====================================================================
		nodes.forEach((oneNode) => {
			if (oneNode.role !== DME_ROLES.OPTION_SET) {
				return;
			}
			if (!optionSetConstrainedStableIds.has(oneNode.stableId)) {
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: rootStableId, toStableId: oneNode.stableId, edgeContext: 'root->orphanOptionSet' });
				stats.orphanAnchoredOptionSets += 1;
			}
		});

		// =====================================================================
		// PASS 5 — authored crosswalk carriage (R-WO-4 stash; R-WO-11 reporting)
		// =====================================================================
		const crosswalkMatchReport = {
			propertyRows: {
				matchedCount: 0,
				matchedDirectCount: 0,
				matchedByDescriptorSuffixCount: 0,
				unmatchedList: [],
				ambiguousList: [],
			},
			descriptorRows: { matchedCount: 0, unmatchedList: [] },
			optionValueRows: { matchedCount: 0, unmatchedList: [] },
		};

		const stashCrossRefsOnNode = ({ targetNode, crossRefList, canonicalCedsId }) => {
			targetNode.properties.cedsId = canonicalCedsId;
			targetNode.properties.cedsOriginalAnchorPropertyName = [CEDS_ANCHOR_PROPERTY_NAME];
			// D22 shape [{ system, id, raw, locator }] in exactly that key order — kit.crossRefsJson
			targetNode.properties.crossRefs = kit.crossRefsJson(crossRefList);
		};

		// property-row matching, TWO mechanical tiers (both censused separately):
		//   tier 1 — exact (ownerName.elementName)
		//   tier 2 — the old world's ODS naming appends 'Descriptor' to descriptor-reference
		//     columns ('TermDescriptor' where MetaEd says 'Term'); when the element name ends in
		//     'Descriptor', the suffix-stripped name is tried, and the match is accepted ONLY if
		//     the candidate property is itself a descriptor reference (propertyType 'descriptor')
		//     — a naming-convention inversion, not a guess.
		Object.values(authoredCrosswalk.propertyCrossRefRegistry).forEach((oneRegistryEntry) => {
			// the old crosswalk names TPDM entities with a literal ' (TPDM)' suffix the MetaEd
			// model never carries — stripped from the OWNER side before either tier (same
			// mechanical inversion class as the element-side 'Descriptor' strip)
			const ownerName = oneRegistryEntry.edfiEntityName.replace(/ \(TPDM\)$/, '');
			const matchRefId = `${ownerName}.${oneRegistryEntry.edfiElementName}`;
			let matchTierName = 'direct';
			let candidateNodeList = propertyNodeListByOwnerAndName[matchRefId] || [];
			if (
				candidateNodeList.length === 0 &&
				oneRegistryEntry.edfiElementName.endsWith('Descriptor')
			) {
				const strippedElementName = oneRegistryEntry.edfiElementName.replace(/Descriptor$/, '');
				candidateNodeList = (
					propertyNodeListByOwnerAndName[`${ownerName}.${strippedElementName}`] || []
				).filter((oneNode) => oneNode.properties.propertyType === 'descriptor');
				matchTierName = 'descriptorSuffix';
			}
			if (candidateNodeList.length === 0) {
				crosswalkMatchReport.propertyRows.unmatchedList.push({
					edfiEntityName: oneRegistryEntry.edfiEntityName,
					edfiElementName: oneRegistryEntry.edfiElementName,
					carriesCedsData: oneRegistryEntry.cedsGlobalIdList.length > 0,
				});
				return;
			}
			if (candidateNodeList.length > 1) {
				crosswalkMatchReport.propertyRows.ambiguousList.push({
					edfiEntityName: oneRegistryEntry.edfiEntityName,
					edfiElementName: oneRegistryEntry.edfiElementName,
					candidateStableIds: candidateNodeList.map((oneNode) => oneNode.stableId),
				});
				return;
			}
			crosswalkMatchReport.propertyRows.matchedCount += 1;
			if (matchTierName === 'direct') {
				crosswalkMatchReport.propertyRows.matchedDirectCount += 1;
			} else {
				crosswalkMatchReport.propertyRows.matchedByDescriptorSuffixCount += 1;
			}
			if (!oneRegistryEntry.cedsGlobalIdList.length) {
				return; // matched, but the authored row carries no CEDS mapping — nothing to stash
			}
			const crossRefList = [];
			let canonicalCedsId = null;
			oneRegistryEntry.cedsGlobalIdList.forEach((rawGlobalId) => {
				// an unnormalizable anchor is REFUSED by the kit (R3), never data
				const normalized = kit.cedsAnchorValue({ rawValue: rawGlobalId, kind: CEDS_ANCHOR_KIND });
				if (normalized.absent) {
					return;
				}
				if (!canonicalCedsId) {
					canonicalCedsId = normalized.cedsAnchorValue;
				}
				crossRefList.push({
					system: 'ceds',
					id: normalized.cedsAnchorValue,
					raw: `${rawGlobalId}`,
					locator: CEDS_ANCHOR_PROPERTY_NAME,
				});
			});
			if (canonicalCedsId) {
				stashCrossRefsOnNode({
					targetNode: candidateNodeList[0],
					crossRefList,
					canonicalCedsId,
				});
				stats.crossRefsAnnotatedProperties += 1;
			}
		});

		Object.values(authoredCrosswalk.descriptorCrossRefRegistry).forEach((oneRegistryEntry) => {
			const descriptorNode =
				constructNodeByTypeAndName[`descriptor/${oneRegistryEntry.descriptorName}`];
			if (!descriptorNode) {
				crosswalkMatchReport.descriptorRows.unmatchedList.push({
					descriptorName: oneRegistryEntry.descriptorName,
				});
				return;
			}
			crosswalkMatchReport.descriptorRows.matchedCount += 1;
			// an unnormalizable anchor is REFUSED by the kit (R3), never data
			const normalized = kit.cedsAnchorValue({ rawValue: oneRegistryEntry.cedsGlobalId, kind: CEDS_ANCHOR_KIND });
			if (!normalized.absent) {
				stashCrossRefsOnNode({
					targetNode: descriptorNode,
					crossRefList: [
						{
							system: 'ceds',
							id: normalized.cedsAnchorValue,
							raw: `${oneRegistryEntry.cedsGlobalId}`,
							locator: CEDS_ANCHOR_PROPERTY_NAME,
						},
					],
					canonicalCedsId: normalized.cedsAnchorValue,
				});
				stats.crossRefsAnnotatedDescriptors += 1;
			}
		});

		Object.values(authoredCrosswalk.optionValueCrossRefRegistry).forEach((oneRegistryEntry) => {
			const optionValueNode =
				optionValueNodeBySetAndCode[
					`${oneRegistryEntry.descriptorName}.${oneRegistryEntry.codeValue}`
				];
			if (!optionValueNode) {
				crosswalkMatchReport.optionValueRows.unmatchedList.push({
					descriptorName: oneRegistryEntry.descriptorName,
					codeValue: oneRegistryEntry.codeValue,
				});
				return;
			}
			crosswalkMatchReport.optionValueRows.matchedCount += 1;
			optionValueNode.properties.cedsOptionCode = `${oneRegistryEntry.cedsOptionCode}`;
			optionValueNode.properties.cedsOptionOriginalAnchorPropertyName = [
				CEDS_OPTION_ANCHOR_PROPERTY_NAME,
			];
			// Ed-Fi's OWN option-value cross-ref shape { system, optionCode, locator } — not the D22
			// { system, id, raw, locator } shape kit.crossRefsJson serialises, so the walk composes it
			optionValueNode.properties.crossRefs = JSON.stringify([
				{
					system: 'ceds',
					optionCode: `${oneRegistryEntry.cedsOptionCode}`,
					locator: CEDS_OPTION_ANCHOR_PROPERTY_NAME,
				},
			]);
			stats.crossRefsAnnotatedOptionValues += 1;
		});

		// the dangling-endpoint terminal check and finalizeStructuralContract are the FRAMEWORK's
		// (buildContractGraph integrity pass, then the finalizer LAST over structure); the walk returns
		// the kit's collected arrays whole, in emission order, plus its own report
		return { nodes, edges, stats, crosswalkMatchReport };
	};

	return {
		emitContractGraph,
		effectivePropertyNameFor, // exported for the hermetic suite
	};
};

module.exports = moduleFunction;
