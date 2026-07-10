'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// anchor-strategies.js — the ANCHOR-FORM STRATEGY REGISTRY (WORKORDER-inferenceAndSelfDoc-070226 A0.2,
// CRIMSON condition 2). A standard's forge harvests its native CEDS anchors RAW/lossless and DECLARES
// their form as data — the `anchorForm` property on the DmeStandardRoot NODE (per-standard authored
// data, alongside the mapping instruction; NOT the block header). This GENERIC maker owns the registry
// of resolution strategies selected by that declaration:
//
//   pFormDirect   (the default — anchorForm absent or 'pForm'): the anchor IS a CEDS property Global
//                 ID token ('P######'); targetKey = the token, resolved by the pure core directly
//                 (basePropertyRef / version-bridge). This is the existing SIF/EdFi/SEDM behavior —
//                 the native-crossRef harvest below is EXTRACTED VERBATIM from the standards-campaign
//                 emit (LUNAR_FORGE 070226, emitAuthoredMapping.js), whose blocks it must re-emit
//                 BYTE-IDENTICALLY (the retrofit red test).
//
//   osFragmentJoin (anchorForm 'osFragment' — CTDL's declaration): the anchor is an option-SET-form
//                 reference whose raw text carries a value fragment (e.g. 'ceds:000113#Assistantships',
//                 owl:equivalentClass on a DmeOptionValue). Resolution is the OS+fragment→notation
//                 join against the CEDS STANDARD block's own DmeOptionValue rows (the maker has that
//                 block at mapping time; a forge never should — the GEN/EDU seam doctrine), then the
//                 owning CEDS property via the reference block's unqualified property-tier hubs
//                 (rangeOptionSetId → propertyKey; the composite '${propertyKey}|${OVtoken}' targetKey
//                 the core's property-scoped baseValueRef index requires). L4b collision rules apply
//                 throughout: an ambiguous notation/name key, an option set with zero or several
//                 owning properties, and a fragment-less (set-level) anchor all ABSTAIN into
//                 unresolvedRows with their TRUE reason — never a guess, never last-write-wins.
//
// A future new anchor format = ONE new registered strategy here — never a new module, never a
// generated per-standard bridge (rejected alternatives recorded in the work order).
//
// mappingTool stamps are DATA owned by the strategies (they land in frozen edge properties, so
// re-derivability pins them): the native-pForm path carries 'standardsCampaign-nativeCrossRef'
// verbatim — the stamp frozen into the SEDM/SIF blocks that any re-derivation must reproduce
// byte-identically.
//
// PURE + synchronous + deterministic: no store, no network, no Date/random. Callers hand in
// deserialized block nodes. camelCase only; no async/await; no try/catch for control flow (the one
// JSON.parse guard below converts a malformed crossRefs cell into a REPORTED row, not a crash).
//
// @concept: [[AnchorFormStrategyRegistry]]
// @concept: [[HubReference]]

const path = require('path');

const valueCrosswalk = require(path.join(__dirname, 'value-crosswalk'));

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// --------------------------------------------------------------------------------
// pFormDirect — anchorForm 'pForm' (the default when the DmeStandardRoot declares nothing).
// Harvest EXTRACTED VERBATIM from the standards-campaign emitAuthoredMapping.js: every source node
// carrying a P-form cedsId contributes one pair {fromStableId, targetKey}; non-P-form anchors are
// reported (nonPForm); anchors CEDS itself does not know are classified (unknownToCeds) but STILL
// handed to the core — they land there as orphans, and the classification tells the ledger WHY.
const pFormDirect = {
	strategyName: 'pFormDirect',
	nativeMappingTool: 'standardsCampaign-nativeCrossRef',
	buildResolutionContext: ({ cedsStandardNodes } = {}) => {
		const cedsKnownIds = new Set();
		(cedsStandardNodes || []).forEach((oneNode) => {
			const cedsId = v1((oneNode.properties || {}).cedsId);
			if (cedsId != null && /^P\d+$/.test(`${cedsId}`)) {
				cedsKnownIds.add(`${cedsId}`);
			}
		});
		return { cedsKnownIds };
	},
	harvestNativeAnchors: ({ sourceNodes, resolutionContext } = {}) => {
		const { cedsKnownIds } = resolutionContext;
		const authoredMappings = [];
		const nonPForm = [];
		const unknownToCeds = [];
		(sourceNodes || []).forEach((oneNode) => {
			const cedsId = v1((oneNode.properties || {}).cedsId);
			if (cedsId == null || `${cedsId}`.trim() === '') {
				return;
			}
			if (!/^P\d+$/.test(`${cedsId}`)) {
				nonPForm.push({ stableId: oneNode.stableId, cedsId: `${cedsId}` });
				return;
			}
			if (!cedsKnownIds.has(`${cedsId}`)) {
				unknownToCeds.push({ stableId: oneNode.stableId, cedsId: `${cedsId}` });
			}
			// still handed to the core: an id CEDS doesn't know lands as an orphan there too —
			// the classification above tells the ledger WHY it orphaned
			authoredMappings.push({ fromStableId: oneNode.stableId, targetKey: `${cedsId}` });
		});
		return {
			authoredMappings,
			unresolvedRows: [],
			report: { nonPForm, unknownToCeds },
		};
	},
	// the anchor IS the targetKey (P-form direct); the pure core does the actual hub resolution
	resolveTargetKey: (rawAnchorToken) =>
		/^P\d+$/.test(`${rawAnchorToken}`) ? `${rawAnchorToken}` : null,
};

// --------------------------------------------------------------------------------
// osFragmentJoin — anchorForm 'osFragment' (declared by forge-ctdl on ctdl:root). The raw anchor
// lives in the node's crossRefs JSON ({system:'ceds', id:'OS######', raw:'ceds:#######Fragment'});
// the harvest here READS it losslessly, and resolution is entirely this maker's business.
const osFragmentJoin = {
	strategyName: 'osFragmentJoin',
	nativeMappingTool: 'edf-mapping:osFragmentJoin',
	buildResolutionContext: ({ referenceNodes, cedsStandardNodes } = {}) => {
		// the SAME collision-tracked value index the authored EdFi descriptor join uses (L4b lives there)
		const valueIndex = valueCrosswalk.buildValueTargetIndex(cedsStandardNodes);
		// option set -> owning CEDS properties, from the reference block's UNQUALIFIED property-tier
		// hubs (the only tier that carries the property's own base range). Several CEDS properties CAN
		// share one option set (measured graph-wide: e.g. 'Grade Level' is reused by 12 properties) —
		// a shared set makes the owning property ambiguous and the anchor ABSTAINS (unique-owner rule).
		const osOwnerIndex = {};
		(referenceNodes || []).forEach((oneNode) => {
			const props = oneNode.properties || {};
			const qualifierKeys = Array.isArray(props.qualifierKeys)
				? props.qualifierKeys
				: props.qualifierKeys
					? [props.qualifierKeys]
					: [];
			if (
				v1(props.role) !== 'HubReference' ||
				v1(props.referenceTier) !== 'property' ||
				qualifierKeys.length > 0
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
		return { valueIndex, osOwnerIndex };
	},
	harvestNativeAnchors: ({ sourceNodes, resolutionContext } = {}) => {
		const { valueIndex, osOwnerIndex } = resolutionContext;
		const authoredMappings = [];
		const unresolvedRows = []; // every abstain carries its TRUE reason (L4b doctrine)
		let anchorsSeen = 0;
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
					const hashAt = rawAnchor.indexOf('#');
					if (hashAt === -1 || hashAt === rawAnchor.length - 1) {
						unresolvedRows.push({
							stableId: oneNode.stableId,
							rawAnchor,
							reason: 'set-level anchor (no value fragment) — option-set equivalence is not a value mapping; abstained',
						});
						return;
					}
					const fragment = rawAnchor.slice(hashAt + 1);
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
					// the SAME consult order as the authored descriptor join (value-crosswalk.js): an
					// ambiguous notation key abstains BEFORE the name map is consulted (consulting name
					// when notation was ambiguous would mask the ambiguity).
					const joinKey = `${osId}|${fragment}`;
					const ambiguousHubs =
						(valueIndex.ambiguousNotationKeys || {})[joinKey] ||
						(valueIndex.byNotation[joinKey] === undefined
							? (valueIndex.ambiguousNameKeys || {})[joinKey]
							: undefined);
					if (ambiguousHubs) {
						unresolvedRows.push({
							stableId: oneNode.stableId,
							rawAnchor,
							osId,
							fragment,
							reason: `AMBIGUOUS notation/name in option set — ${ambiguousHubs.length} distinct CEDS value hubs share it (${ambiguousHubs.join(', ')}); abstained for human curation, never guessed`,
						});
						return;
					}
					const valueToken = valueIndex.byNotation[joinKey] || valueIndex.byName[joinKey];
					if (!valueToken) {
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
						targetKey: `${propertyKey}|${valueToken}`,
					});
				});
		});
		return {
			authoredMappings,
			unresolvedRows,
			report: { anchorsSeen },
		};
	},
};

// --------------------------------------------------------------------------------
// the registry — anchorForm declaration (DmeStandardRoot node data) -> strategy
const strategyRegistry = {
	pForm: pFormDirect,
	osFragment: osFragmentJoin,
};

// read the declaration off the source block's DmeStandardRoot node; absent -> the pForm default
const anchorFormOf = (sourceNodes) => {
	const rootNode = (sourceNodes || []).find(
		(oneNode) => v1((oneNode.properties || {}).role) === 'DmeStandardRoot',
	);
	const declared = rootNode ? v1((rootNode.properties || {}).anchorForm) : null;
	return declared && `${declared}`.trim() !== '' ? `${declared}` : 'pForm';
};

// -> { strategy, anchorForm } or { error } (the caller fails its pipe loudly — never a silent default
// for an UNRECOGNIZED declaration; only ABSENCE means pForm)
const strategyForSourceNodes = (sourceNodes) => {
	const anchorForm = anchorFormOf(sourceNodes);
	const strategy = strategyRegistry[anchorForm];
	if (!strategy) {
		return {
			error: `unrecognized anchorForm '${anchorForm}' on the DmeStandardRoot node — registered strategies: ${Object.keys(strategyRegistry).join(', ')}`,
		};
	}
	return { strategy, anchorForm };
};

module.exports = { strategyRegistry, strategyForSourceNodes, anchorFormOf, pFormDirect, osFragmentJoin };
