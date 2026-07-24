'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// ctdlAnchorHarvest.js — PURE, deterministic harvest of CTDL's NATIVE CEDS anchors into authored
// { fromStableId, targetKey } mappings for the pure referenceIndex core (P2). This is the FAITHFUL
// PORT of the incumbent CTDL authored mechanism — cli/bridge-maker/edf-mapping/lib/anchor-strategies.js
// `osFragmentJoin` + cli/bridge-maker/edf-mapping/lib/value-crosswalk.js `buildValueTargetIndex` — with
// ONE deliberate, golden-grounded UNIFICATION (see SET-LEVEL below).
//
// WHERE THE ANCHOR RIDES (code fact, forges/ctdl/forgeCtdl.js): the CTDL forge stamps each anchored
// DmeOptionValue with `cedsId` (canonical 'OS######') AND a `crossRefs` JSON array carrying
// { system:'ceds', id:'OS######', raw:'ceds:000113#Fragment', locator }. The RAW form (with its value
// fragment) is what resolution needs; `cedsId` alone has lost the fragment. This harvest reads `crossRefs`.
//
// RESOLUTION (both tiers resolve through the SAME pure referenceIndex; the harvest only produces targetKeys):
//   FRAGMENT-BEARING anchor ('ceds:000113#Assistantships') -> VALUE tier. The owning CEDS property of the
//     option set (unique unqualified property-tier hub that ranges OS######) gives propertyKey; the
//     OS+fragment -> notation (fallback name) join against the CEDS standard block's DmeOptionValue rows
//     gives the value OV token; targetKey = the COMPOSITE '${propertyKey}|${OVtoken}' the referenceIndex
//     baseValueRef requires. (This IS the incumbent osFragmentJoin.)
//   SET-LEVEL anchor ('ceds:000113', no fragment) -> PROPERTY tier. The incumbent osFragmentJoin ABSTAINS
//     here ("option-set equivalence is not a value mapping"), and a SEPARATE campaign producer
//     (ctdlCedsCampaign:specDeclarationJoin) authored these 2 property-tier edges in the golden. The
//     recreation's single unified authored producer resolves them itself: a set-level anchor maps to the
//     option set's UNIQUE owning property -> targetKey = the bare property token 'P######' the
//     referenceIndex basePropertyRef requires. VERIFIED against the live golden (code fact, 2026-07-24):
//     OS000113 and OS001610 are each ranged by exactly ONE unqualified property-tier hub (P000113, P001610),
//     so the unique-owner rule reproduces the golden's General->P000113 and Military->P001610 edges. The
//     24 fragment + 2 set-level = the golden's 26 CTDL EXACT_MATCH.
//
// L4b COLLISION DOCTRINE (ported verbatim): an ambiguous owning property (option set shared by >1 property),
// an ambiguous notation/name inside the set, an unowned set, or a fragment with no notation/name match all
// ABSTAIN into unresolvedRows with their TRUE reason — never a guess, never last-write-wins.
//
// PURE + synchronous + deterministic: no store, no network, no Date/random. The one JSON.parse guard turns a
// malformed crossRefs cell into a REPORTED row, not a crash. camelCase only.
//
// @concept: [[AuthoredCrosswalk]]
// @concept: [[HubReference]]

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

// -----
// buildValueTargetIndex — FAITHFUL PORT of value-crosswalk.buildValueTargetIndex. From the CEDS 'standard'
// block's DmeOptionValue nodes: index BY '<rangeOptionSetId>|<notation>' -> value OV token (canonicalKey),
// with a '<rangeOptionSetId>|<name>' fallback. A key that two DIFFERENT values share resolves to NOBODY —
// it is moved into ambiguousNotationKeys/ambiguousNameKeys and the caller reports the true reason.
const buildValueTargetIndex = (cedsStandardNodes) => {
	const byNotation = {};
	const byName = {};
	const ambiguousNotationKeys = {};
	const ambiguousNameKeys = {};
	const indexInto = (map, ambiguousMap, key, canonicalKey) => {
		if (ambiguousMap[key]) {
			if (ambiguousMap[key].indexOf(canonicalKey) === -1) {
				ambiguousMap[key].push(canonicalKey);
			}
			return;
		}
		if (map[key] !== undefined && map[key] !== canonicalKey) {
			ambiguousMap[key] = [map[key], canonicalKey];
			delete map[key];
			return;
		}
		map[key] = canonicalKey;
	};
	(cedsStandardNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		if (v1(props.role) !== 'DmeOptionValue') {
			return;
		}
		const rangeOptionSetId = v1(props.rangeOptionSetId);
		const notation = v1(props.notation);
		const name = v1(props.name);
		const canonicalKey = v1(props.canonicalKey);
		if (!rangeOptionSetId || !canonicalKey) {
			return;
		}
		if (notation && `${notation}`.trim() !== '') {
			indexInto(byNotation, ambiguousNotationKeys, `${rangeOptionSetId}|${notation}`, canonicalKey);
		}
		if (name && `${name}`.trim() !== '') {
			indexInto(byName, ambiguousNameKeys, `${rangeOptionSetId}|${name}`, canonicalKey);
		}
	});
	return { byNotation, byName, ambiguousNotationKeys, ambiguousNameKeys };
};

// -----
// buildOsOwnerIndex — FAITHFUL PORT of osFragmentJoin.buildResolutionContext's owner index. From the CEDS
// reference block's UNQUALIFIED property-tier HubReference nodes: rangeOptionSetId -> [owning propertyKey].
// A shared option set (several ranging properties) makes the owner AMBIGUOUS and its anchors abstain.
const buildOsOwnerIndex = (referenceNodes) => {
	const osOwnerIndex = {};
	(referenceNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		if (
			v1(props.role) !== 'HubReference' ||
			v1(props.referenceTier) !== 'property' ||
			asList(props.qualifierKeys).length > 0
		) {
			return;
		}
		const propertyKey = v1(props.propertyKey);
		const rangeOptionSetId = v1(props.rangeOptionSetId);
		if (!propertyKey || !rangeOptionSetId) {
			return;
		}
		(osOwnerIndex[rangeOptionSetId] = osOwnerIndex[rangeOptionSetId] || []).push(propertyKey);
	});
	return osOwnerIndex;
};

// -----
// buildResolutionContext — the two indices a harvest consults, built once from the two CEDS blocks.
const buildResolutionContext = ({ referenceNodes, cedsStandardNodes } = {}) => ({
	osOwnerIndex: buildOsOwnerIndex(referenceNodes),
	valueIndex: buildValueTargetIndex(cedsStandardNodes),
});

// START OF moduleFunction() ============================================================

// harvestAuthoredMappings — walk the CTDL source nodes' crossRefs; emit authored { fromStableId, targetKey }
// pairs (value-tier composite for fragment anchors, property-tier bare token for set-level anchors); abstain
// with true reasons. -> { authoredMappings, unresolvedRows, counts }.
const harvestAuthoredMappings = ({ sourceNodes, resolutionContext } = {}) => {
	const { osOwnerIndex, valueIndex } = resolutionContext || {};
	const authoredMappings = [];
	const unresolvedRows = []; // every abstain carries its TRUE reason (L4b doctrine)
	let anchorsSeen = 0;
	let valueTier = 0;
	let propertyTier = 0;

	// the SAME consult order the incumbent uses: an ambiguous notation key abstains BEFORE the name map is
	// consulted (consulting name when notation was ambiguous would mask the ambiguity).
	const resolveValueToken = (osId, fragment) => {
		const joinKey = `${osId}|${fragment}`;
		const ambiguousHubs =
			(valueIndex.ambiguousNotationKeys || {})[joinKey] ||
			(valueIndex.byNotation[joinKey] === undefined
				? (valueIndex.ambiguousNameKeys || {})[joinKey]
				: undefined);
		if (ambiguousHubs) {
			return { ambiguousHubs };
		}
		const valueToken = valueIndex.byNotation[joinKey] || valueIndex.byName[joinKey];
		return valueToken ? { valueToken } : {};
	};

	(sourceNodes || []).forEach((oneNode) => {
		const rawCrossRefs = v1((oneNode.properties || {}).crossRefs);
		if (!rawCrossRefs || rawCrossRefs === '[]') {
			return;
		}
		let crossRefList = null;
		try {
			crossRefList = JSON.parse(rawCrossRefs);
		} catch (parseErr) {
			unresolvedRows.push({
				stableId: oneNode.stableId,
				reason: `crossRefs cell is not valid JSON (${parseErr.message}) — anchor unreadable, reported not guessed`,
			});
			return;
		}
		if (!Array.isArray(crossRefList)) {
			return;
		}
		crossRefList
			.filter((oneCrossRef) => oneCrossRef && oneCrossRef.system === 'ceds')
			.forEach((oneCrossRef) => {
				anchorsSeen++;
				const osId = `${oneCrossRef.id}`;
				const rawAnchor = `${oneCrossRef.raw}`;
				const owningProperties = osOwnerIndex[osId] || [];
				if (owningProperties.length === 0) {
					unresolvedRows.push({
						stableId: oneNode.stableId,
						rawAnchor,
						osId,
						reason: 'no unqualified property-tier hub ranges this option set — owning property unresolvable',
					});
					return;
				}
				if (owningProperties.length > 1) {
					unresolvedRows.push({
						stableId: oneNode.stableId,
						rawAnchor,
						osId,
						reason: `AMBIGUOUS owning property — ${owningProperties.length} CEDS properties share this option set (${owningProperties.join(', ')}); abstained for human curation, never guessed`,
					});
					return;
				}
				const propertyKey = owningProperties[0];

				const hashAt = rawAnchor.indexOf('#');
				const setLevel = hashAt === -1 || hashAt === rawAnchor.length - 1;
				if (setLevel) {
					// SET-LEVEL -> PROPERTY tier: the unique owning property IS the target (the unified rule).
					authoredMappings.push({ fromStableId: oneNode.stableId, targetKey: `${propertyKey}` });
					propertyTier++;
					return;
				}

				const fragment = rawAnchor.slice(hashAt + 1);
				const resolved = resolveValueToken(osId, fragment);
				if (resolved.ambiguousHubs) {
					unresolvedRows.push({
						stableId: oneNode.stableId,
						rawAnchor,
						osId,
						fragment,
						reason: `AMBIGUOUS notation/name in option set — ${resolved.ambiguousHubs.length} distinct CEDS value hubs share it (${resolved.ambiguousHubs.join(', ')}); abstained for human curation, never guessed`,
					});
					return;
				}
				if (!resolved.valueToken) {
					unresolvedRows.push({
						stableId: oneNode.stableId,
						rawAnchor,
						osId,
						fragment,
						reason: 'no OS+notation/name match in CEDS standard block',
					});
					return;
				}
				authoredMappings.push({
					fromStableId: oneNode.stableId,
					targetKey: `${propertyKey}|${resolved.valueToken}`,
				});
				valueTier++;
			});
	});

	return {
		authoredMappings,
		unresolvedRows,
		counts: { anchorsSeen, valueTier, propertyTier, abstains: unresolvedRows.length },
	};
};

// END OF moduleFunction() ============================================================

module.exports = {
	buildValueTargetIndex,
	buildOsOwnerIndex,
	buildResolutionContext,
	harvestAuthoredMappings,
};
