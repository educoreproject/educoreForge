'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// contractGraphKit.js — the kit, `contractGraphKit({ forgeDeclaration, metadata, activeAllowanceById })`
// (SPEC-forgeFramework-v1.md §3.4). Created by the framework at the top of EVERY buildContractGraph
// invocation and handed to the emission walk; the ONLY door through which a node or an edge is
// created. PURE: no xLog, no clock, no I/O; a hook cannot reach a channel through it. Its surface is
// declared as DATA (CONTRACT_GRAPH_KIT_SURFACE) so a hook author and a test read the same truth.
//
// WHY THE KIT THROWS (SPEC §3.3): the seam requires buildContractGraph to be synchronous
// (interfaces.js:241-242); the Profile §2.2 sanctions a throw INSIDE the pure layer under the
// framework's ONE adapter. Every refusal below is a named Error built by refuse.byName.
//
// Byte facts reproduced here (each is a `[code fact]` in the SPEC): the makeNode property set and
// order of forgeEdfiContractGraph.js:385-424 with the framework's own `_id: stableId` stamp; the
// SIF/Ed-Fi search-text ladder (forgeSif.js:214-229, cg:272-297) honouring a caller-supplied
// owningName (PESC's CLASS, forgePesc260805.js:494-499); Ed-Fi's addEdge shape and its dangling
// RECORD-not-throw (cg:353-382); the CEDS anchor regex /(\d+)(?!.*\d)/ and rolePrefixByKind
// (ceds/lib/normalize.js:20-65); the crossRefs key order { system, id, raw, locator }.

const path = require('path');
const {
	DME_ROLES,
	EDGE_TYPES,
	NODE_LABELS,
	PROVENANCE_TIER,
	MAPPING_EDGE_TYPES,
} = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { buildSearchText } = require(path.join(__dirname, '..', 'search-text', 'build-search-text'))();
const refuse = require('./refuse');

const DME_ROLE_VALUE_LIST = Object.freeze(Object.values(DME_ROLES));
const EDGE_TYPE_VALUE_LIST = Object.freeze(Object.values(EDGE_TYPES));
const RETIRED_MAPPING_EDGE_TYPE_LIST = Object.freeze(Object.values(MAPPING_EDGE_TYPES));

// the CEDS anchor normalizer's registry (ceds/lib/normalize.js:20-25) — one copy, framework-owned
const CEDS_ANCHOR_PREFIX_BY_KIND = Object.freeze({
	class: 'C',
	property: 'P',
	optionSet: 'OS',
	optionValue: 'OV',
});
const CEDS_ANCHOR_DIGIT_RE = /(\d+)(?!.*\d)/;

// the surface as data (SPEC §3.4): member name → arity, kind
const CONTRACT_GRAPH_KIT_SURFACE = Object.freeze({
	makeNode: Object.freeze({ arity: 1, kind: 'function', returns: 'node (LIVE, mutable)' }),
	addEdge: Object.freeze({ arity: 1, kind: 'function', returns: 'undefined' }),
	// the collected arrays, LIVE and in call order — what a walk returns as { nodes, edges } (or
	// re-assembles by concatenation); a walk never holds an edge object otherwise (addEdge returns
	// nothing), so exposing them is what makes "the kit's collected arrays" returnable at all
	nodes: Object.freeze({ kind: 'array' }),
	edges: Object.freeze({ kind: 'array' }),
	stats: Object.freeze({ kind: 'object' }),
	requiredStat: Object.freeze({ arity: 1, kind: 'function', returns: 'value' }),
	carriedProperties: Object.freeze({ arity: 1, kind: 'function', returns: 'object' }),
	crossRefsJson: Object.freeze({ arity: 1, kind: 'function', returns: 'string' }),
	searchTextElementFor: Object.freeze({ arity: 1, kind: 'function', returns: 'element' }),
	cedsAnchorValue: Object.freeze({ arity: 1, kind: 'function', returns: '{ cedsAnchorValue } | { absent: true }' }),
	isCleanStableId: Object.freeze({ arity: 1, kind: 'function', returns: 'boolean' }),
	rootStableId: Object.freeze({ kind: 'string' }),
	emitOptionValue: Object.freeze({ arity: 1, kind: 'function', returns: 'node' }),
});

// the universal names the kit itself stamps at mint; a carriedProperties collision with any of
// them is REFUSED (SPEC §3.4). depth/crossRefs are NOT here: the finalizer owns them and a walk MAY
// hand them through carriedProperties (P1; CEDS/SIF crossRefs via kit.crossRefsJson).
const universalMintPropertyNameListFor = ({ stableUriPropertyName }) =>
	Object.freeze(['_id', '_source', 'name', 'role', 'searchText', 'parentId', 'path', stableUriPropertyName]);

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const contractGraphKit = ({ forgeDeclaration, metadata, activeAllowanceById = {} } = {}) => {
	if (!isPlainObject(forgeDeclaration)) {
		throw refuse.byName({ moduleName, what: 'forgeDeclaration is not an object', where: 'the framework creates the kit from the validated H1 declaration' });
	}
	if (!isPlainObject(metadata)) {
		throw refuse.byName({ moduleName, what: 'metadata is not an object', where: 'the framework creates the kit after forge() step 4' });
	}
	const { standardSource, stableUriPropertyName, stableIdPattern, nonEmbeddableRoleList, cedsAnchorAbsentSentinelList } = forgeDeclaration;
	const stableIdRegex = new RegExp(stableIdPattern.pattern);
	const universalMintPropertyNameList = universalMintPropertyNameListFor({ stableUriPropertyName });

	// active allowances the KIT reads (data from the declaration, keyed by allowanceId)
	const emptyStringCoercionPropertyList = Object.keys(activeAllowanceById).reduce(
		(soFar, oneAllowanceId) =>
			soFar.concat(activeAllowanceById[oneAllowanceId].coerceEmptyStringPropertyList || []),
		[],
	);
	const parentEdgeSubstitutionTable = Object.keys(activeAllowanceById).reduce(
		(soFar, oneAllowanceId) => ({ ...soFar, ...(activeAllowanceById[oneAllowanceId].parentEdgeSubstitutionTable || {}) }),
		{},
	);
	const edgeTypeAllowList = Object.keys(activeAllowanceById).reduce(
		(soFar, oneAllowanceId) => soFar.concat(activeAllowanceById[oneAllowanceId].edgeTypeAllowList || []),
		[],
	);

	// per-build state — fresh on every kit
	const nodes = [];
	const edges = [];
	const originByStableId = {};
	const nodeByStableId = {};
	const stats = {
		nodeCountByRole: {},
		edgeCountByType: {},
		danglingEdges: [],
		namelessNodeCountByRole: {},
		emptyStringCoercionCount: 0,
		substitutionCount: 0,
		substitutionCountByNativeType: {},
		// allowListedEdgeCount — RULING FJ-P4-6 (hub-kit-role Phase 4). The MIRROR of substitutionCount,
		// for the other arm of the same decision: substitution TRANSLATES a native edge type into a
		// registry member, the allow list ADMITS one that stays outside the registry. Only substitution
		// was counted, so an admitted type was invisible to every census and allowance P4 had no
		// observable precondition to read — a declared-but-unneeded allow list could not have been
		// refused. COUNTER ONLY: no edge is admitted or refused differently by this edit.
		allowListedEdgeCount: 0,
		allowListedEdgeCountByType: {},
	};
	const kitState = { rootStableId: null };

	// ---------------------------------------------------------------
	// isCleanStableId — the declaration's { pattern, trimmed } applied; a refusal, never a repair
	// ---------------------------------------------------------------
	const isCleanStableId = ({ stableId } = {}) =>
		typeof stableId === 'string' &&
		stableId.length > 0 &&
		(!stableIdPattern.trimmed || stableId === stableId.trim()) &&
		stableIdRegex.test(stableId);

	// ---------------------------------------------------------------
	// searchTextElementFor — ONE role-keyed registry reproducing the SIF/Ed-Fi ladder (D13);
	// honours a caller-supplied owningName, defaults it to standardSource ONLY when none
	// (the `owningName || standardSource` here is a BYTE MANDATE, SPEC §11.5 carve-out)
	// ---------------------------------------------------------------
	const SEARCH_TEXT_ELEMENT_BUILDER_BY_ROLE = {
		[DME_ROLES.CLASS]: ({ role, name, owningName }) => ({
			role,
			name,
			standardName: standardSource,
			owningName: owningName || standardSource,
		}),
		[DME_ROLES.PROPERTY]: ({ role, name, owningName }) => ({
			role,
			name,
			owningClassName: owningName || standardSource,
			owningName: owningName || standardSource,
		}),
		[DME_ROLES.OPTION_SET]: ({ role, name, owningName }) => ({
			role,
			name,
			owningClassName: owningName || standardSource,
			owningName: owningName || standardSource,
		}),
		[DME_ROLES.OPTION_VALUE]: ({ role, name, owningName }) => ({
			role,
			name,
			optionSetName: owningName,
			owningName,
			owningClassName: standardSource,
		}),
	};
	const searchTextElementFor = ({ role, name, owningName } = {}) => {
		if (DME_ROLE_VALUE_LIST.indexOf(role) === -1) {
			throw refuse.byName({ moduleName, what: `searchTextElementFor: unknown role '${role}'`, where: `role must be a DME_ROLES member (${DME_ROLE_VALUE_LIST.join(', ')})` });
		}
		const builder = SEARCH_TEXT_ELEMENT_BUILDER_BY_ROLE[role];
		if (builder) {
			return builder({ role, name, owningName });
		}
		// every other role (DmeSupport and the rest of the ladder's tail): the SIF/Ed-Fi default arm
		return { role, name, owningName: owningName || standardSource, standardName: standardSource };
	};

	// ---------------------------------------------------------------
	// makeNode
	// ---------------------------------------------------------------
	const makeNode = ({
		role,
		perStandardLabel,
		stableId,
		name,
		description,
		structural,
		carriedProperties: carriedPropertiesArg,
		precedingProperties,
		searchTextElement,
		origin,
	} = {}) => {
		const originText = origin === undefined ? 'origin not given' : `${origin}`;
		if (DME_ROLE_VALUE_LIST.indexOf(role) === -1) {
			throw refuse.byName({ moduleName, what: `makeNode: unknown role '${role}' (from ${originText})`, where: `role must be a DME_ROLES member (${DME_ROLE_VALUE_LIST.join(', ')})` });
		}
		if (typeof perStandardLabel !== 'string' || perStandardLabel.length === 0) {
			throw refuse.byName({ moduleName, what: `makeNode: perStandardLabel is ${JSON.stringify(perStandardLabel)}, not a string (from ${originText})`, where: 'pass the per-standard label verbatim; the framework derives no prefix' });
		}
		if (!isCleanStableId({ stableId })) {
			throw refuse.byName({ moduleName, what: `makeNode: unclean stableId '${stableId}' under stableIdPattern ${JSON.stringify(stableIdPattern)} (from ${originText})`, where: 'a stableId is refused, never repaired; fix the identity rule in the walk' });
		}
		if (originByStableId[stableId] !== undefined) {
			throw refuse.byName({ moduleName, what: `makeNode: duplicate stableId '${stableId}' — first minted from ${originByStableId[stableId]}, minted again from ${originText}`, where: 'identity must be unique; a silent overwrite is a silent merge' });
		}
		if (!isPlainObject(structural)) {
			throw refuse.byName({ moduleName, what: `makeNode: structural is not an object (from ${originText})`, where: 'pass structural: { parentId, path, owningName? }' });
		}
		if (precedingProperties !== undefined && !isPlainObject(precedingProperties)) {
			throw refuse.byName({ moduleName, what: `makeNode: precedingProperties is not a plain object (from ${originText})`, where: 'precedingProperties is an object or omitted' });
		}
		if (carriedPropertiesArg !== undefined && !isPlainObject(carriedPropertiesArg)) {
			throw refuse.byName({ moduleName, what: `makeNode: carriedProperties is not a plain object (from ${originText})`, where: 'carriedProperties is an object or omitted' });
		}
		if (precedingProperties !== undefined && precedingProperties._id !== undefined) {
			throw refuse.byName({ moduleName, what: `makeNode: '_id' supplied by the caller in precedingProperties (from ${originText})`, where: 'the FRAMEWORK stamps _id: stableId; a hook MUST NOT set it' });
		}
		if (carriedPropertiesArg !== undefined) {
			if (carriedPropertiesArg._id !== undefined) {
				throw refuse.byName({ moduleName, what: `makeNode: '_id' supplied by the caller in carriedProperties (from ${originText})`, where: 'the FRAMEWORK stamps _id: stableId; a hook MUST NOT set it' });
			}
			const collidingName = Object.keys(carriedPropertiesArg).find(
				(oneName) => universalMintPropertyNameList.indexOf(oneName) !== -1 || (oneName === 'description' && description !== undefined),
			);
			if (collidingName !== undefined) {
				throw refuse.byName({ moduleName, what: `makeNode: carriedProperties name '${collidingName}' collides with a universal property (from ${originText})`, where: `the universal set (${universalMintPropertyNameList.join(', ')}) is the framework's; carry it under another name or through the makeNode input` });
			}
		}
		if (description === '') {
			if (emptyStringCoercionPropertyList.indexOf('description') === -1) {
				throw refuse.byName({ moduleName, what: `makeNode: description is '' on '${stableId}' (from ${originText})`, where: "an empty string never passes silently: omit the description or declare the coercion allowance (P9; S2-adjacent for SIF) that names 'description'" });
			}
			stats.emptyStringCoercionCount += 1;
		}
		if (searchTextElement !== undefined && structural.owningName !== undefined) {
			throw refuse.byName({ moduleName, what: `makeNode: searchTextElement and structural.owningName are both given (from ${originText})`, where: 'the two forms are exclusive per call: a literal element OR the ladder via owningName' });
		}

		// name — OPTIONAL at mint (FR4): string as given; absent/null → OMITTED and counted, unless a
		// declared coercion allowance (S2/P9) names 'name', in which case '' is stamped and counted
		let nameProperty = {};
		if (name === undefined || name === null) {
			if (emptyStringCoercionPropertyList.indexOf('name') !== -1) {
				nameProperty = { name: '' };
				stats.emptyStringCoercionCount += 1;
			} else {
				stats.namelessNodeCountByRole[role] = (stats.namelessNodeCountByRole[role] || 0) + 1;
			}
		} else if (typeof name === 'string') {
			// FA4: an EMPTY string is bytes — refused unless a coercion allowance (S2/P9) names 'name', then COUNTED
			if (name === '') {
				if (emptyStringCoercionPropertyList.indexOf('name') === -1) {
					throw refuse.byName({ moduleName, what: `makeNode: name is '' on '${stableId}' (from ${originText})`, where: "an empty string never passes silently: omit the name (absent is absent) or declare the coercion allowance (S2/P9) that reproduces the '' byte" });
				}
				stats.emptyStringCoercionCount += 1;
			}
			nameProperty = { name };
		} else {
			throw refuse.byName({ moduleName, what: `makeNode: name is a ${typeof name} on '${stableId}' (from ${originText})`, where: 'name is a string, or absent; the framework never coerces (probe #10 → an allowance row before migration)' });
		}

		// searchText — the ladder unless the role is non-embeddable (then NO searchText, CEDS's bytes)
		let searchTextProperty = {};
		if (nonEmbeddableRoleList.indexOf(role) === -1) {
			const element = searchTextElement !== undefined
				? searchTextElement
				: searchTextElementFor({ role, name: nameProperty.name, owningName: structural.owningName });
			// buildSearchText throws its own ValidationError on an empty result / unknown role — a pure-layer throw
			searchTextProperty = { searchText: buildSearchText(element) };
		}

		const node = {
			labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
			stableId,
			role,
			properties: {
				...(precedingProperties === undefined ? {} : precedingProperties),
				_id: stableId,
				_source: standardSource,
				...nameProperty,
				role,
				[stableUriPropertyName]: stableId,
				...searchTextProperty,
				parentId: structural.parentId,
				path: structural.path,
				...(description !== undefined ? { description } : {}),
				...(carriedPropertiesArg === undefined ? {} : carriedPropertiesArg),
			},
		};
		originByStableId[stableId] = originText;
		nodeByStableId[stableId] = node;
		nodes.push(node);
		stats.nodeCountByRole[role] = (stats.nodeCountByRole[role] || 0) + 1;
		return node;
	};

	// ---------------------------------------------------------------
	// addEdge
	// ---------------------------------------------------------------
	const addEdge = ({ edgeType, fromStableId, toStableId, edgeContext, edgeProperties } = {}) => {
		const contextText = edgeContext === undefined ? 'no edgeContext' : `${edgeContext}`;
		if (typeof edgeType !== 'string' || edgeType.length === 0) {
			throw refuse.byName({ moduleName, what: `addEdge: edgeType is ${JSON.stringify(edgeType)} (${contextText})`, where: 'edgeType is an EDGE_TYPES member' });
		}
		if (RETIRED_MAPPING_EDGE_TYPE_LIST.indexOf(edgeType) !== -1) {
			throw refuse.byName({ moduleName, what: `addEdge: '${edgeType}' is a RETIRED *_MAPPING edge type (${contextText})`, where: 'a forge emits no mapping edge, ever (Profile §9); bridges are a different producer' });
		}
		let resolvedEdgeType = edgeType;
		if (EDGE_TYPE_VALUE_LIST.indexOf(edgeType) === -1) {
			if (parentEdgeSubstitutionTable[edgeType] !== undefined) {
				resolvedEdgeType = parentEdgeSubstitutionTable[edgeType];
				if (EDGE_TYPE_VALUE_LIST.indexOf(resolvedEdgeType) === -1) {
					throw refuse.byName({ moduleName, what: `addEdge: parentEdgeSubstitutionTable maps '${edgeType}' to '${resolvedEdgeType}', which is not an EDGE_TYPES member (${contextText})`, where: 'a substitution target must be a registry edge type' });
				}
				stats.substitutionCount += 1;
				stats.substitutionCountByNativeType[edgeType] = (stats.substitutionCountByNativeType[edgeType] || 0) + 1;
			} else if (edgeTypeAllowList.indexOf(edgeType) !== -1) {
				// ADMITTED by the declared allow list (P4). Counted so the admission is observable: the
				// row that licenses it reads this counter as its precondition, exactly as S6 reads
				// substitutionCount, and the census gains a figure for a thing that was invisible.
				stats.allowListedEdgeCount += 1;
				stats.allowListedEdgeCountByType[edgeType] = (stats.allowListedEdgeCountByType[edgeType] || 0) + 1;
			} else {
				throw refuse.byName({ moduleName, what: `addEdge: edge type '${edgeType}' is not a member of EDGE_TYPES (${contextText})`, where: `use one of ${EDGE_TYPE_VALUE_LIST.join(', ')}; a name outside the registry needs an active P4 edgeTypeAllowList or S6 parentEdgeSubstitutionTable` });
			}
		}
		if (edgeProperties !== undefined && !isPlainObject(edgeProperties)) {
			throw refuse.byName({ moduleName, what: `addEdge('${edgeType}', ${contextText}): edgeProperties is ${Array.isArray(edgeProperties) ? 'an array' : `a ${typeof edgeProperties}`}`, where: 'edgeProperties is a plain object or omitted; anything else spreads to nothing and would discard declared edge content silently' });
		}
		// a falsy endpoint is RECORDED, not thrown (Ed-Fi's form, cg:353-382); the framework refuses
		// ONCE at the end of the pure layer, naming the count and the first offender
		if (!fromStableId || !toStableId) {
			stats.danglingEdges.push({ edgeType, fromStableId, toStableId, edgeContext });
			return;
		}
		edges.push({
			type: resolvedEdgeType,
			fromRef: { source: standardSource, id: fromStableId },
			toRef: { source: standardSource, id: toStableId },
			properties: {
				provenanceTier: PROVENANCE_TIER.STRUCTURAL,
				...(edgeProperties === undefined ? {} : edgeProperties),
			},
		});
		stats.edgeCountByType[resolvedEdgeType] = (stats.edgeCountByType[resolvedEdgeType] || 0) + 1;
	};

	// ---------------------------------------------------------------
	// requiredStat — PESC's guard lifted (forgePesc260805.js:710-719)
	// ---------------------------------------------------------------
	const requiredStat = (statName) => {
		if (stats[statName] === undefined) {
			throw refuse.byName({ moduleName, what: `requiredStat: unknown stat '${statName}'`, where: `known stats: ${Object.keys(stats).join(', ')}` });
		}
		return stats[statName];
	};

	// ---------------------------------------------------------------
	// carriedProperties — WHITELISTED fields whose value is !== undefined (Ed-Fi's filter, cg:428-432)
	// ---------------------------------------------------------------
	const carriedProperties = ({ parsedObject, carryList } = {}) => {
		if (!Array.isArray(carryList)) {
			throw refuse.byName({ moduleName, what: `carriedProperties: carryList is ${typeof carryList}, not an array`, where: 'pass the whitelist of field names to carry' });
		}
		if (!isPlainObject(parsedObject)) {
			throw refuse.byName({ moduleName, what: 'carriedProperties: parsedObject is not an object', where: 'pass the parsed record whose fields are carried' });
		}
		const carried = {};
		carryList.forEach((oneFieldName) => {
			if (parsedObject[oneFieldName] !== undefined) {
				carried[oneFieldName] = parsedObject[oneFieldName];
			}
		});
		return carried;
	};

	// ---------------------------------------------------------------
	// crossRefsJson — JSON of [{ system, id, raw, locator }] in EXACTLY that key order (D22)
	// ---------------------------------------------------------------
	const crossRefsJson = (crossRefList) => {
		if (!Array.isArray(crossRefList)) {
			throw refuse.byName({ moduleName, what: `crossRefsJson: crossRefList is ${typeof crossRefList}, not an array`, where: 'pass a list of { system, id, raw, locator }' });
		}
		const ordered = crossRefList.map((oneCrossRef, oneIndex) => {
			if (!isPlainObject(oneCrossRef) || typeof oneCrossRef.system !== 'string' || oneCrossRef.system.length === 0 || oneCrossRef.id === undefined || oneCrossRef.id === null || oneCrossRef.id === '') {
				throw refuse.byName({ moduleName, what: `crossRefsJson: entry ${oneIndex} is missing system or id`, where: 'every cross-reference names its system and id' });
			}
			return {
				system: oneCrossRef.system,
				id: oneCrossRef.id,
				raw: oneCrossRef.raw === undefined || oneCrossRef.raw === null ? null : oneCrossRef.raw,
				locator: oneCrossRef.locator,
			};
		});
		return JSON.stringify(ordered);
	};

	// ---------------------------------------------------------------
	// cedsAnchorValue — the ONE normalizer (D14); a JOIN-KEY value, never an address
	// ---------------------------------------------------------------
	const cedsAnchorValue = ({ rawValue, kind } = {}) => {
		const prefix = CEDS_ANCHOR_PREFIX_BY_KIND[kind];
		if (prefix === undefined) {
			throw refuse.byName({ moduleName, what: `cedsAnchorValue: unknown kind '${kind}'`, where: `kind is one of ${Object.keys(CEDS_ANCHOR_PREFIX_BY_KIND).join(', ')}` });
		}
		const trimmedValue = rawValue === undefined || rawValue === null ? '' : `${rawValue}`.trim();
		if (trimmedValue === '' || cedsAnchorAbsentSentinelList.indexOf(trimmedValue) !== -1) {
			return { absent: true };
		}
		const digitMatch = trimmedValue.match(CEDS_ANCHOR_DIGIT_RE);
		if (!digitMatch) {
			throw refuse.byName({ moduleName, what: `cedsAnchorValue: could not extract a numeric CEDS anchor from '${rawValue}' for kind '${kind}'`, where: 'a present-but-unnormalizable anchor is a refusal, never data (R3)' });
		}
		return { cedsAnchorValue: `${prefix}${digitMatch[1].padStart(6, '0')}` };
	};

	// ---------------------------------------------------------------
	// emitOptionValue — DERIVED from the three real expanders (cg:669-, forgeCeds.js:757-803,
	// forgeSif.js:598-623): each mints an OPTION_VALUE node parented on its set and joins it with
	// HAS_VALUE (set → value). Every per-standard byte stays a caller input: the value's stableId
	// (each forge's identity rule), perStandardLabel, name, description (SIF passes ''), path,
	// owningName / a literal searchTextElement (CEDS), carried/preceding properties, edgeContext.
	// ---------------------------------------------------------------
	const emitOptionValue = ({
		optionSetStableId,
		optionValueStableId,
		perStandardLabel,
		name,
		description,
		path: valuePath,
		owningName,
		searchTextElement,
		carriedProperties: valueCarriedProperties,
		precedingProperties: valuePrecedingProperties,
		edgeContext,
		origin,
	} = {}) => {
		if (typeof optionSetStableId !== 'string' || optionSetStableId.length === 0) {
			throw refuse.byName({ moduleName, what: `emitOptionValue: optionSetStableId is ${JSON.stringify(optionSetStableId)}`, where: 'name the owning option set by its stableId' });
		}
		const structural = { parentId: optionSetStableId, path: valuePath, ...(owningName === undefined ? {} : { owningName }) };
		const valueNode = makeNode({
			role: DME_ROLES.OPTION_VALUE,
			perStandardLabel,
			stableId: optionValueStableId,
			name,
			description,
			structural,
			carriedProperties: valueCarriedProperties,
			precedingProperties: valuePrecedingProperties,
			searchTextElement,
			origin,
		});
		addEdge({
			edgeType: EDGE_TYPES.HAS_VALUE,
			fromStableId: optionSetStableId,
			toStableId: optionValueStableId,
			edgeContext: edgeContext === undefined ? `${optionSetStableId}->${optionValueStableId}` : edgeContext,
		});
		return valueNode;
	};

	// ---------------------------------------------------------------
	// framework-internal accessors (NOT on the surface a hook sees) — the framework reads the
	// collected arrays and registries for the integrity pass; the hook holds `kit`, the framework
	// holds `kitInternals`
	// ---------------------------------------------------------------
	const kitInternals = {
		nodes,
		edges,
		originByStableId,
		nodeByStableId,
		stats,
		setRootStableId: (rootStableId) => {
			kitState.rootStableId = rootStableId;
		},
		universalMintPropertyNameList,
		edgeTypeAllowList,
		parentEdgeSubstitutionTable,
	};

	const kit = {
		makeNode,
		addEdge,
		nodes,
		edges,
		stats,
		requiredStat,
		carriedProperties,
		crossRefsJson,
		searchTextElementFor,
		cedsAnchorValue,
		isCleanStableId,
		get rootStableId() {
			return kitState.rootStableId;
		},
		emitOptionValue,
	};

	return { kit, kitInternals };
};

module.exports = { contractGraphKit, CONTRACT_GRAPH_KIT_SURFACE, CEDS_ANCHOR_PREFIX_BY_KIND, universalMintPropertyNameListFor, moduleName };
