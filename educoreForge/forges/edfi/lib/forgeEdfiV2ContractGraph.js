'use strict';

// forgeEdfiV2ContractGraph.js — forge-edfi Phase 2 (R-WO-8/R-WO-9): the PURE, synchronous,
// deterministic shaping layer of the V2 forge. Consumes the Phase 1 parser's in-memory MetaEd
// model (the declared interface in metaEdParser.js), the descriptor code-value sets
// (descriptorCodeValueLoader.js), and the authored crosswalk registries (crosswalkCarrier.js),
// and emits the universal forge property contract: { nodes, edges, stats, crosswalkMatchReport }.
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
// REFUSALS (thrown; the forge orchestrator surfaces them as forge errors, mirroring the
// incumbent buildContractGraph seam):
//   - a code-value XML naming a descriptor absent from the model (R-WO-10: a contradiction
//     between two declared inputs of one snapshot)
//   - an unresolvable model-internal reference (property target, subclass base, extension
//     extendee, domain item, interchange component, subdomain parent)
//   - a duplicate stableId; a dangling edge endpoint; an unnormalizable CEDS cross-ref (R3)
// UNMATCHED CROSSWALK ROWS ARE NOT REFUSALS (R-WO-11): they are reported, per row, in
// crosswalkMatchReport — the honest partial match IS the census-delta evidence.
//
// This module is self-contained by design: it takes NO dependency on the incumbent forge's
// lib/ (parser.js, normalize.js), which is scheduled for closeout removal (R-WO-2).

const path = require('path');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);
const { finalizeStructuralContract } = require(
	path.join(CORE_LIB, 'structural-contract', 'structural-contract'),
);

const STANDARD_KEY = 'edfi';
const STANDARD_SOURCE = 'EdFi'; // === the registry standardName, EXACT
const STANDARD_DISPLAY = 'Ed-Fi Data Standard';
const STABLE_URI_PROPERTY_NAME = 'edfiStableId';
const ROOT_STABLE_ID = 'edfi:root';
const CEDS_ANCHOR_PROPERTY_NAME = 'CEDSGlobalId';
const CEDS_OPTION_ANCHOR_PROPERTY_NAME = 'CEDSOptionCode';
const CEDS_NO_MAPPING_SENTINEL = '000000';

// The mappingInstruction contract is UNCHANGED from the incumbent (the bridge resolves
// EdFi.cedsId == CedsProperty.cedsId in a later phase; same anchors, same resolver property).
const edfiMappingInstruction = {
	cedsOriginalAnchorPropertyName: [CEDS_ANCHOR_PROPERTY_NAME],
	cedsOptionOriginalAnchorPropertyName: [CEDS_OPTION_ANCHOR_PROPERTY_NAME],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: true,
	impliedTargets: ['CEDS'],
};

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

// =====================================================================
// normalization (self-contained; no dependency on the closeout-scheduled incumbent lib)
// =====================================================================

const EDFI_STABLE_ID_RE = /^edfi:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (candidateValue) =>
	typeof candidateValue === 'string' &&
	candidateValue.length > 0 &&
	candidateValue === candidateValue.trim() &&
	EDFI_STABLE_ID_RE.test(candidateValue);

const buildConstructStableId = ({ constructType, constructName }) => {
	const cleanName = constructName == null ? '' : `${constructName}`.trim();
	if (cleanName === '') {
		throw new Error(
			`forge-edfi-v2 R3 stableId miss: empty construct name for constructType '${constructType}'`,
		);
	}
	return `edfi:${constructType}/${cleanName}`;
};

// canonical CEDS property anchor (P<6-digit zero-padded>) — same rule the incumbent applied,
// restated here (R3: a present-but-unnormalizable annotation is a refusal, never data)
const normalizeCedsCrossRef = ({ rawValue }) => {
	const trimmedValue = rawValue == null ? '' : `${rawValue}`.trim();
	if (trimmedValue === '' || trimmedValue === CEDS_NO_MAPPING_SENTINEL) {
		return { absent: true };
	}
	const digitMatch = trimmedValue.match(/(\d+)(?!.*\d)/);
	if (!digitMatch) {
		return {
			error: `normalizeCedsCrossRef: could not extract a numeric CEDS anchor from '${rawValue}'`,
		};
	}
	return { cedsId: `P${digitMatch[1].padStart(6, '0')}` };
};

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
	const { buildSearchText } = buildSearchTextFactory();

	// the searchText element for a role, built from structural context only (1C, R4) —
	// mirrors the incumbent's searchTextElementFor including the SUPPORT branch
	const searchTextElementFor = ({ role, name, owningName }) => {
		if (role === DME_ROLES.CLASS) {
			return { role, name, standardName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
		}
		if (role === DME_ROLES.PROPERTY) {
			return {
				role,
				name,
				owningClassName: owningName || STANDARD_SOURCE,
				owningName: owningName || STANDARD_SOURCE,
			};
		}
		if (role === DME_ROLES.OPTION_SET) {
			return { role, name, owningClassName: STANDARD_SOURCE, owningName: STANDARD_SOURCE };
		}
		if (role === DME_ROLES.OPTION_VALUE) {
			return {
				role,
				name,
				optionSetName: owningName,
				owningName,
				owningClassName: STANDARD_SOURCE,
			};
		}
		return { role, name, owningName: STANDARD_SOURCE, standardName: STANDARD_SOURCE };
	};

	// =====================================================================
	// buildContractGraph — PURE, deterministic.
	//   { metaEdModel, descriptorCodeValues, authoredCrosswalk, metadata }
	//     -> { nodes, edges, stats, crosswalkMatchReport }
	// =====================================================================
	const buildContractGraph = ({
		metaEdModel,
		descriptorCodeValues,
		authoredCrosswalk,
		metadata,
	}) => {
		const nodes = [];
		const edges = [];
		const stats = {
			nodeCountByRole: {},
			constructCountByType: {},
			optionValueCountByOrigin: {},
			edgeCountByType: {},
			crossRefsAnnotatedProperties: 0,
			crossRefsAnnotatedDescriptors: 0,
			crossRefsAnnotatedOptionValues: 0,
			orphanAnchoredOptionSets: 0,
			itemKeywordMismatchList: [],
			danglingEdges: [],
		};

		// ---- indexes ----
		const nodeByStableId = {};
		const originByStableId = {}; // stableId -> human-locatable origin (duplicate refusals)
		const constructNodeByTypeAndName = {}; // `${constructType}/${name}` -> node
		const propertyNodeListByOwnerAndName = {}; // `${ownerName}.${effectiveName}` -> [node]
		const optionValueNodeBySetAndCode = {}; // `${optionSetName}.${codeValue}` -> node
		const optionSetConstrainedStableIds = new Set(); // sets owned by >=1 property

		const originFor = (parsedConstruct) =>
			`${parsedConstruct.sourceFileRelativePath || 'synthetic'}:${parsedConstruct.sourceLineNumber || '?'}`;

		const registerStableId = ({ stableId, origin }) => {
			if (originByStableId[stableId]) {
				throw new Error(
					`forge-edfi-v2 REFUSED: duplicate stableId '${stableId}' — first minted from ` +
						`${originByStableId[stableId]}, minted again from ${origin}. Identity must be ` +
						`unique; a silent overwrite is a silent merge.`,
				);
			}
			originByStableId[stableId] = origin;
		};

		const addEdge = (edgeType, fromStableId, toStableId, edgeContext) => {
			if (!fromStableId || !toStableId) {
				stats.danglingEdges.push({ edgeType, fromStableId, toStableId, edgeContext });
				return;
			}
			edges.push({
				type: edgeType,
				fromRef: { source: STANDARD_SOURCE, id: fromStableId },
				toRef: { source: STANDARD_SOURCE, id: toStableId },
				properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
			});
			stats.edgeCountByType[edgeType] = (stats.edgeCountByType[edgeType] || 0) + 1;
		};

		// makeNode — stamp the universal contract onto one node (1C searchText; RT-2 scalars)
		const makeNode = ({
			role,
			perStandardLabel,
			stableId,
			name,
			description,
			structural,
			scalarProps,
			origin,
		}) => {
			if (!isCleanStableId(stableId)) {
				throw new Error(`forge-edfi-v2: unclean stableId '${stableId}' (from ${origin})`);
			}
			registerStableId({ stableId, origin });
			const searchText = buildSearchText(
				searchTextElementFor({ role, name, owningName: structural.owningName }),
			);
			const node = {
				labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
				stableId,
				role,
				properties: {
					_id: stableId,
					_source: STANDARD_SOURCE,
					name: `${name}`,
					role,
					[STABLE_URI_PROPERTY_NAME]: stableId,
					searchText,
					parentId: structural.parentId,
					depth: structural.depth,
					path: structural.path,
					...(description !== undefined ? { description } : {}),
					...(scalarProps || {}),
				},
			};
			nodes.push(node);
			nodeByStableId[stableId] = node;
			stats.nodeCountByRole[role] = (stats.nodeCountByRole[role] || 0) + 1;
			return node;
		};

		// carry whitelisted native scalars that are PRESENT (RT-2)
		const carriedScalars = ({ parsedObject, carryList }) => {
			const scalarProps = {};
			carryList.forEach((fieldName) => {
				if (parsedObject[fieldName] !== undefined) {
					scalarProps[fieldName] = parsedObject[fieldName];
				}
			});
			if (parsedObject.mergeDirectiveList !== undefined) {
				scalarProps.mergeDirectives = JSON.stringify(parsedObject.mergeDirectiveList);
			}
			return scalarProps;
		};

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

		// =====================================================================
		// DmeStandardRoot (provenance block + stableUriPropertyName + mappingInstruction)
		// =====================================================================
		const rootSearchText = buildSearchText({
			role: DME_ROLES.STANDARD_ROOT,
			name: STANDARD_SOURCE,
			standardName: STANDARD_DISPLAY,
		});
		registerStableId({ stableId: ROOT_STABLE_ID, origin: 'root' });
		const totalCodeValueCount = Object.values(
			descriptorCodeValues.codeValueListByDescriptorName,
		).reduce((runningSum, oneList) => runningSum + oneList.length, 0);
		nodes.push({
			labels: [NODE_LABELS.FORGED_NODE, 'EdfiRoot', DME_ROLES.STANDARD_ROOT],
			stableId: ROOT_STABLE_ID,
			role: DME_ROLES.STANDARD_ROOT,
			properties: {
				_id: ROOT_STABLE_ID,
				_source: STANDARD_SOURCE,
				name: STANDARD_SOURCE,
				description:
					`${STANDARD_DISPLAY} — ${metaEdModel.census.totalConstructCount} MetaEd constructs, ` +
					`${metaEdModel.census.totalPropertyCount} properties, ` +
					`${totalCodeValueCount} descriptor code values`,
				role: DME_ROLES.STANDARD_ROOT,
				[STABLE_URI_PROPERTY_NAME]: ROOT_STABLE_ID,
				searchText: rootSearchText,
				standardKey: STANDARD_KEY,
				standardName: STANDARD_DISPLAY,
				version: metadata.version,
				snapshotKey: metadata.snapshotKey,
				publishedVersion: metadata.publishedVersion,
				versionSource: metadata.versionSource,
				sourceFormat: metadata.sourceFormat,
				sourceFiles: metadata.sourceFiles || [],
				sourceUrl: metadata.sourceUrl || '',
				parserVersion: '2',
				// ingestedAt deliberately NOT stamped (H5 determinism ruling, kept from incumbent)
				coreVersion: '2.0.0',
				stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
				mappingInstruction: JSON.stringify(edfiMappingInstruction),
			},
		});
		nodeByStableId[ROOT_STABLE_ID] = nodes[nodes.length - 1];
		stats.nodeCountByRole[DME_ROLES.STANDARD_ROOT] = 1;

		// =====================================================================
		// PASS 1 — construct nodes (all types), indexed for reference resolution
		// =====================================================================
		orderedConstructList.forEach(({ inputName, parsedConstruct }) => {
			const roleSpec = CONSTRUCT_ROLE_REGISTRY[parsedConstruct.constructType];
			if (!roleSpec) {
				throw new Error(
					`forge-edfi-v2 REFUSED: unknown constructType '${parsedConstruct.constructType}' ` +
						`(from ${originFor(parsedConstruct)}) — not in CONSTRUCT_ROLE_REGISTRY`,
				);
			}
			const constructName = parsedConstruct[roleSpec.nameField];
			const stableId = buildConstructStableId({
				constructType: parsedConstruct.constructType,
				constructName,
			});
			const scalarProps = {
				constructType: parsedConstruct.constructType,
				sourceInputName: inputName,
				...carriedScalars({ parsedObject: parsedConstruct, carryList: CONSTRUCT_SCALAR_CARRY_LIST }),
			};
			const constructNode = makeNode({
				role: roleSpec.role,
				perStandardLabel: perStandardLabelFor(parsedConstruct.constructType),
				stableId,
				name: constructName,
				description: parsedConstruct.documentationText,
				structural: {
					parentId: ROOT_STABLE_ID,
					depth: 1,
					path: constructName,
					owningName: STANDARD_SOURCE,
				},
				scalarProps,
				origin: originFor(parsedConstruct),
			});
			constructNodeByTypeAndName[`${parsedConstruct.constructType}/${constructName}`] =
				constructNode;
			stats.constructCountByType[parsedConstruct.constructType] =
				(stats.constructCountByType[parsedConstruct.constructType] || 0) + 1;
			if (roleSpec.ownershipEdgeType) {
				addEdge(roleSpec.ownershipEdgeType, ROOT_STABLE_ID, stableId, `root->${constructName}`);
			}
		});

		// resolve a (family, localName) reference to a construct node, or undefined
		const resolveFamilyReference = ({ targetFamily, targetLocalName }) => {
			const familyTypeList = REFERENCE_FAMILY_REGISTRY[targetFamily];
			if (!familyTypeList) {
				throw new Error(
					`forge-edfi-v2 REFUSED: unknown reference family '${targetFamily}' — not in ` +
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
				`forge-edfi-v2 REFUSED: ${referenceKindLabel} '${targetLocalName}' (family ` +
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
						`forge-edfi-v2 REFUSED: unknown propertyType '${parsedProperty.propertyType}' on ` +
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
				const propertyNode = makeNode({
					role: DME_ROLES.PROPERTY,
					perStandardLabel: 'EdfiProperty',
					stableId: propertyStableId,
					name: effectiveName,
					description: propertyDescription,
					structural: {
						parentId: constructStableId,
						depth: 2,
						path: `${constructName}.${effectiveName}`,
						owningName: constructName,
					},
					scalarProps: {
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

				addEdge(EDGE_TYPES.HAS_PROPERTY, constructStableId, propertyStableId, `${constructName}->${effectiveName}`);

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
					addEdge(
						referenceSpec.edgeType,
						propertyStableId,
						targetNode.stableId,
						`${constructName}.${effectiveName}->${targetLocalName}`,
					);
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
						`forge-edfi-v2 R3 stableId miss: empty (all-whitespace) code value on ` +
							`'${constructName}' (from ${origin})`,
					);
				}
				const optionValueStableId = `edfi:value/${constructName}.${trimmedCodeValue}`;
				const optionValueNode = makeNode({
					role: DME_ROLES.OPTION_VALUE,
					perStandardLabel: 'EdfiOptionValue',
					stableId: optionValueStableId,
					name: codeValueText,
					description: valueDescription,
					structural: {
						parentId: constructStableId,
						depth: 2,
						path: `${constructName}.${trimmedCodeValue}`,
						owningName: constructName,
					},
					scalarProps: { valueOrigin, ...valueScalars },
					origin,
				});
				optionValueNodeBySetAndCode[`${constructName}.${trimmedCodeValue}`] = optionValueNode;
				addEdge(EDGE_TYPES.HAS_VALUE, constructStableId, optionValueStableId, `${constructName}->${codeValueText}`);
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
					`forge-edfi-v2 REFUSED (R-WO-10): descriptor code-value source ` +
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
				addEdge(EDGE_TYPES.SUBCLASS_OF, constructStableId, baseNode.stableId, `${constructName} based on ${parsedConstruct.baseName}`);
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
				addEdge(EDGE_TYPES.REFERENCES, constructStableId, extendeeNode.stableId, `${constructName} additions -> ${parsedConstruct.extendeeName}`);
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
				addEdge(EDGE_TYPES.REFERENCES, constructStableId, itemNode.stableId, `${constructName} domain item ${oneDomainItem.localDomainItemName}`);
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
				addEdge(EDGE_TYPES.REFERENCES, constructStableId, componentNode.stableId, `${constructName} interchange ${oneComponent.componentKind} ${oneComponent.localInterchangeItemName}`);
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
				addEdge(EDGE_TYPES.REFERENCES, constructStableId, parentDomainNode.stableId, `${constructName} subdomain of ${parsedConstruct.parentDomainName}`);
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
				addEdge(EDGE_TYPES.HAS_OPTION_SET, ROOT_STABLE_ID, oneNode.stableId, 'root->orphanOptionSet');
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
			targetNode.properties.crossRefs = JSON.stringify(crossRefList);
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
				const normalized = normalizeCedsCrossRef({ rawValue: rawGlobalId });
				if (normalized.absent) {
					return;
				}
				if (normalized.error) {
					throw new Error(
						`forge-edfi-v2 R3 CEDS cross-ref miss on property ` +
							`'${matchRefId}': ${normalized.error}`,
					);
				}
				if (!canonicalCedsId) {
					canonicalCedsId = normalized.cedsId;
				}
				crossRefList.push({
					system: 'ceds',
					id: normalized.cedsId,
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
			const normalized = normalizeCedsCrossRef({ rawValue: oneRegistryEntry.cedsGlobalId });
			if (normalized.error) {
				throw new Error(
					`forge-edfi-v2 R3 CEDS cross-ref miss on descriptor ` +
						`'${oneRegistryEntry.descriptorName}': ${normalized.error}`,
				);
			}
			if (!normalized.absent) {
				stashCrossRefsOnNode({
					targetNode: descriptorNode,
					crossRefList: [
						{
							system: 'ceds',
							id: normalized.cedsId,
							raw: `${oneRegistryEntry.cedsGlobalId}`,
							locator: CEDS_ANCHOR_PROPERTY_NAME,
						},
					],
					canonicalCedsId: normalized.cedsId,
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
			optionValueNode.properties.crossRefs = JSON.stringify([
				{
					system: 'ceds',
					optionCode: `${oneRegistryEntry.cedsOptionCode}`,
					locator: CEDS_OPTION_ANCHOR_PROPERTY_NAME,
				},
			]);
			stats.crossRefsAnnotatedOptionValues += 1;
		});

		// =====================================================================
		// integrity + the shared contract finalizer
		// =====================================================================
		if (stats.danglingEdges.length > 0) {
			throw new Error(
				`forge-edfi-v2: ${stats.danglingEdges.length} edge(s) had an unresolved endpoint ` +
					`(first: ${JSON.stringify(stats.danglingEdges[0])}) — never emit a partial edge`,
			);
		}

		finalizeStructuralContract({ nodes, edges });
		return { nodes, edges, stats, crosswalkMatchReport };
	};

	return {
		buildContractGraph,
		effectivePropertyNameFor, // exported for the hermetic suite
		normalizeCedsCrossRef, // exported for the hermetic suite
		STANDARD_KEY,
		STANDARD_SOURCE,
		STANDARD_DISPLAY,
		STABLE_URI_PROPERTY_NAME,
	};
};

module.exports = moduleFunction;
