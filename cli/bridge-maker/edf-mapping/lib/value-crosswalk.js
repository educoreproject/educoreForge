'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// value-crosswalk.js — CODESET-VALUE (PLAN-codesetValueMatching-070126.md Phase A/B) shared, PURE helpers
// for the AUTHORED descriptor ("codeset value") crosswalk. Factored out of edfMapping.js so BOTH the
// Phase-4 authored-value producer (edf-mapping -build) and the Phase-5 value gold harness
// (bridgeMaker's gold-harness.js, for -accuracy --tier=value) read the SAME join logic — one source of
// truth for how a source EdFi descriptor value resolves to a CEDS value hub.
//
// Pure + synchronous. No async/await, no try/catch for control flow, no network/graph access — reads only
// the fixed CSV asset (via edf-gate's groundTruth loader) and in-memory deserialized block nodes handed in
// by the caller. camelCase only.
//
// @concept: [[CodesetValueMatching]]
// @concept: [[AuthoredValueCrosswalk]]

const path = require('path');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const GROUND_TRUTH = path.join(
	findProjectRoot(),
	'code',
	'npm',
	'qtools-graph-forge-core',
	'lib',
	'ground-truth',
	'groundTruth',
);

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// buildValueTargetIndex — from the DESERIALIZED CEDS 'standard' block's own nodes (NOT the reference
// block — notation/rangeOptionSetId live on the raw DmeOptionValue node; forgeCeds.js stamps both
// directly, ~line 434-468). Index BY '<rangeOptionSetId>|<notation>' -> value OV token (canonicalKey),
// falling to '<rangeOptionSetId>|<name>' when a value's notation is blank. PURE + sync.
// L4 — collision tracking: the maps were last-write-wins when two DIFFERENT values in ONE option
// set share a notation (or name). A colliding key now resolves to NOBODY — it is moved out of the
// map into ambiguousNotationKeys/ambiguousNameKeys (key -> every distinct canonicalKey seen), and
// loadAuthoredValueMappings reports the TRUE reason instead of silently minting an arbitrary
// EXACT_MATCH. Same-canonicalKey restatements are not collisions.
const buildValueTargetIndex = (cedsNodes) => {
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
	(cedsNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		const role = v1(props.role);
		if (role !== 'DmeOptionValue') {
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

// buildPropertyRangeOptionSetIndex — from the DESERIALIZED CEDS reference block's property-tier
// HubReference nodes: propertyKey ('P######') -> rangeOptionSetId ('OS######'). CORRECTNESS NOTE (found
// live, gf_pureGraph3): the descriptor CSV's CEDSGlobalId identifies the PROPERTY, NOT the option set — a
// property's own numeric Global ID does NOT generally equal its option set's Global ID (e.g. property
// P000051 'Country of Birth Code' has rangeOptionSetId OS000050, an option set SHARED with other country
// properties). The PLAN's stated join key ('OS' + CEDSGlobalId) only happened to work for its one verified
// example (P000624/OS000624 coincide). This index makes the join go through the property's ACTUAL range,
// not an assumed numeric identity.
const buildPropertyRangeOptionSetIndex = (referenceNodes) => {
	const index = {};
	(referenceNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		const role = v1(props.role);
		const tier = v1(props.referenceTier);
		const qualifierKeys = Array.isArray(props.qualifierKeys)
			? props.qualifierKeys
			: props.qualifierKeys
				? [props.qualifierKeys]
				: [];
		if (role !== 'HubReference' || tier !== 'property' || qualifierKeys.length > 0) {
			return; // only the UNQUALIFIED property-tier ref carries the property's own base range
		}
		const propertyKey = v1(props.propertyKey);
		const rangeOptionSetId = v1(props.rangeOptionSetId);
		if (propertyKey && rangeOptionSetId) {
			index[propertyKey] = rangeOptionSetId;
		}
	});
	return index;
};

// loadAuthoredValueMappings — the AUTHORED descriptor ("codeset value") crosswalk row-driven producer.
// Converts EdFiEntityDescriptorsToCEDS.csv (8,310 rows; loaded as fixtures.descriptors, previously
// IGNORED — PLAN §3) into { fromStableId, targetKey } pairs exactly like edfMapping's loadAuthoredMappings
// does for the property tier, so the SAME pure core (mappingSubgraph.buildMappingSubgraph) resolves them.
// ALSO returns `negatives` (ElementMatchConfidence === 'Not in CEDS' rows -> { fromStableId }), the value
// gold harness's abstention-accuracy frame (mirrors gold-harness.js's property-tier negatives).
//
//   FROM: `edfi:value/${EdFiElementName}.${EdFiCodeValue}` — the descriptorValue stableId convention
//         (forgeEdfi.js: `descriptorValue: (props) => \`${props.descriptorName}.${props.name}\``, and the
//         Ed-Fi source's own value `name` is the EdFiCodeValue text — verified live against gf_pureGraph3
//         for 7/7 sampled rows).
//   TARGET: normalize CEDSGlobalId -> 'P' + zero-padded 6 digits (the PROPERTY token — the descriptor
//         CSV's CEDSGlobalId identifies the property, not the option set directly); resolve that
//         property's ACTUAL rangeOptionSetId via propertyRangeOptionSetIndex (NOT an assumed
//         'OS'+CEDSGlobalId identity, which is only true by coincidence for some properties); then join
//         `${rangeOptionSetId}|${CEDSOptionCode}` against valueIndex.byNotation (fallback byName) -> the
//         value OV token. Requires BOTH OptionSetMatchConfidence AND ElementMatchConfidence === 'Yes' (the
//         dual-confidence gate — PLAN §6 risk 4). MEASURED (gf_pureGraph3, post property-range fix):
//         5,920 Yes/Yes rows -> 5,870 resolved (99.2%); 50 unresolved (properties with no known
//         rangeOptionSetId at the property tier — genuine coverage gaps, reported not guessed).
//
// AMBIGUITY (PLAN §6 risk 4 / escalated design fork, see DEVLOG-codesetMatching-070126.md): because the
// EdFi DmeOptionValue node is per-descriptor (shared across ALL EdFiEntity/path contexts that reuse it),
// while the crosswalk's Yes/Yes correctness is genuinely context-specific by EdFiEntity/path, a FROM key
// CAN carry multiple distinct authored targets. MEASURED after resolution (not just raw CSV grouping):
// 105/2,374 distinct FROM keys (4.4%), 447/5,870 resolved rows (7.6%) — much lower than the raw-CSV upper
// bound (847/2,401 FROM keys, 57.5% of rows) once non-resolving rows are excluded. RESOLVED BY PRECEDENT:
// the property-tier authored track already exhibits the identical phenomenon at a comparable rate
// (22/936 FROM keys, ~2.3%) and has ALWAYS emitted one EXACT_MATCH edge per distinct (fromStableId,
// target) pair with no ambiguity-abstain special-casing (mappingSubgraph.js dedups only IDENTICAL pairs).
// The value track follows the SAME rule for consistency — every resolvable Yes/Yes row becomes its own
// edge; a source value that legitimately equals several CEDS value hubs (different properties, not a
// same-property/different-qualifier conflict) gets several EXACT_MATCH edges. Ambiguity is measured and
// reported here (ambiguousFromKeys/ambiguousRowCount), never silently smoothed over.
const loadAuthoredValueMappings = ({ sourceStandard, valueIndex, propertyRangeOptionSetIndex } = {}) => {
	const groundTruth = require(GROUND_TRUTH)();
	const fx = groundTruth.loadFixtures();
	const header = fx.descriptors.header;
	const entityNameCol = header.find((c) => /^EdFiElementName$/i.test(c));
	const codeValueCol = header.find((c) => /^EdFiCodeValue$/i.test(c));
	const globalIdCol = header.find((c) => /^CEDSGlobalId$/i.test(c));
	const optionCodeCol = header.find((c) => /^CEDSOptionCode$/i.test(c));
	const optionConfCol = header.find((c) => /^OptionSetMatchConfidence$/i.test(c));
	const elementConfCol = header.find((c) => /^ElementMatchConfidence$/i.test(c));

	const fromStableIdFor = (elementName, codeValue) => {
		if (`${sourceStandard}` === 'EdFi') {
			return `edfi:value/${elementName}.${codeValue}`;
		}
		return null;
	};
	const propertyTokenOf = (rawGlobalId) => {
		const trimmed = `${rawGlobalId}`.trim();
		if (trimmed === '') {
			return null;
		}
		return `P${trimmed.padStart(6, '0')}`;
	};

	const authoredMappings = [];
	const negatives = []; // ElementMatchConfidence === 'Not in CEDS' -> { fromStableId } (gold-harness abstention frame)
	const unresolvedRows = []; // Yes/Yes rows whose join found no value hub (orphan-like; reported, never guessed)
	const ambiguousJoinRows = []; // L4: Yes/Yes rows abstaining on an ambiguous notation/name key
	let totalYesYesRows = 0;
	const byFrom = {}; // fromStableId -> Set(targetKey) — ambiguity measurement/reporting

	fx.descriptors.records.forEach((oneRecord) => {
		const optionConf = `${oneRecord[optionConfCol]}`.trim().toLowerCase();
		const elementConf = `${oneRecord[elementConfCol]}`.trim();
		const elementName = `${oneRecord[entityNameCol]}`.trim();
		const codeValue = `${oneRecord[codeValueCol]}`.trim();
		if (elementConf === 'Not in CEDS') {
			const fromStableId = fromStableIdFor(elementName, codeValue);
			if (fromStableId) {
				negatives.push({ fromStableId });
			}
			return;
		}
		if (optionConf !== 'yes' || elementConf.toLowerCase() !== 'yes') {
			return;
		}
		totalYesYesRows++;
		const fromStableId = fromStableIdFor(elementName, codeValue);
		const propertyToken = propertyTokenOf(oneRecord[globalIdCol]);
		const optionCode = `${oneRecord[optionCodeCol]}`.trim();
		if (!fromStableId || !propertyToken || optionCode === '') {
			unresolvedRows.push({ elementName, codeValue, reason: 'missing FROM/propertyToken/optionCode field' });
			return;
		}
		const rangeOptionSetId = propertyRangeOptionSetIndex[propertyToken];
		if (!rangeOptionSetId) {
			unresolvedRows.push({
				elementName,
				codeValue,
				propertyToken,
				reason: 'property has no known rangeOptionSetId (not matched at property tier / not enumerated)',
			});
			return;
		}
		// L4: an ambiguous key (several distinct CEDS value hubs share the notation/name inside
		// this option set) resolves to NOBODY — the row abstains into unresolvedRows with the
		// TRUE reason for human curation, never a last-write-wins guess. The name join is not
		// consulted when the notation join was ambiguous (that would mask the ambiguity).
		const joinKey = `${rangeOptionSetId}|${optionCode}`;
		const ambiguousHubs =
			(valueIndex.ambiguousNotationKeys || {})[joinKey] ||
			(valueIndex.byNotation[joinKey] === undefined
				? (valueIndex.ambiguousNameKeys || {})[joinKey]
				: undefined);
		if (ambiguousHubs) {
			ambiguousJoinRows.push({ elementName, codeValue, rangeOptionSetId, optionCode });
			unresolvedRows.push({
				elementName,
				codeValue,
				rangeOptionSetId,
				optionCode,
				reason: `AMBIGUOUS notation/name in option set — ${ambiguousHubs.length} distinct CEDS value hubs share it (${ambiguousHubs.join(', ')}); abstained for human curation, never guessed`,
			});
			return;
		}
		const valueToken = valueIndex.byNotation[joinKey] || valueIndex.byName[joinKey];
		if (!valueToken) {
			unresolvedRows.push({
				elementName,
				codeValue,
				rangeOptionSetId,
				optionCode,
				reason: 'no OS+notation/name match in CEDS standard block',
			});
			return;
		}
		// targetKey is the COMPOSITE '${propertyKey}|${valueToken}' — REQUIRED by mappingSubgraph.js's
		// property-scoped value resolution (a bare OV token is ambiguous: option SETS are shared across many
		// CEDS properties — see mappingSubgraph.js buildReferenceIndex's baseValueRef comment). valueToken
		// (the bare OV token) is kept alongside for gold-frame / accuracy comparisons that need to compare
		// against a raw CEDS candidate's own cedsId (e.g. bridgeMaker's -accuracy --tier=value).
		const targetKey = `${propertyToken}|${valueToken}`;
		authoredMappings.push({ fromStableId, targetKey, valueToken, rangeOptionSetId, elementName, codeValue });
		(byFrom[fromStableId] = byFrom[fromStableId] || new Set()).add(targetKey);
	});

	const ambiguousFromKeys = Object.keys(byFrom).filter((k) => byFrom[k].size > 1);
	const ambiguousRowCount = authoredMappings.filter((m) => byFrom[m.fromStableId].size > 1).length;

	return {
		authoredMappings,
		negatives,
		totalYesYesRows,
		unresolvedRows,
		ambiguousJoinRows,
		ambiguousIndexKeyCounts: {
			notation: Object.keys(valueIndex.ambiguousNotationKeys || {}).length,
			name: Object.keys(valueIndex.ambiguousNameKeys || {}).length,
		},
		distinctFromKeys: Object.keys(byFrom).length,
		ambiguousFromKeys: ambiguousFromKeys.length,
		ambiguousRowCount,
	};
};

module.exports = { buildValueTargetIndex, buildPropertyRangeOptionSetIndex, loadAuthoredValueMappings };
