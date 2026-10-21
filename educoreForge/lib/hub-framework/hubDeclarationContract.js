'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hubDeclarationContract.js — the hub kit role's declaration contracts and their table-driven
// validators (SPEC-hubKitRole-082826.md §4.1 [R2 F5], §4.2). Deliberate sibling of
// lib/forge-framework/forgeDeclarationContract.js: one frozen CONTRACT TABLE, ONE registry of kind
// checkers, a walk that refuses an UNKNOWN key before it checks anything else, and messages composed
// in the house refusal form. Never a switch; never a silent default.
//
// PHASE 2c: THE SKELETON IS NOW COMPLETE. This file carries exactly what 2a uses and nothing more:
// Two contracts now live here, each with its own table, sharing ONE kind-checker registry:
//   HUB_DESCRIPTOR_CONTRACT    the parserDescriptor.ini hub keys that replaced the deleted forger
//                              registry HUB_FORGE_BY_STANDARD (Phase 2a)
//   HUB_DECLARATION_CONTRACT   the H1 DATA table of SPEC §4.4 (Phase 2c) — hubName, hubDisplayName,
//                              canonicalKeyName, canonicalKeyMinted, sourceIdFieldName,
//                              baseFieldNames, qualifiedReference, provenanceLabel; and since ctdlHub P3
//                              tierList, rangeAddressing, rootFieldNames, embedTextTemplateByTier; and since ctdlHub P4
//                              domainAddressing, hubVersionSegment
// The second was deliberately NOT declared in 2a, when nothing validated it: a contract entry nobody
// walks is dead surface, the same judgment RULING FB8 made when it deleted refuse.requiredKeys.
//
// WHY THE DESCRIPTOR AND NOT THE RECIPE. hubModule declares that a kit CAN be a hub; recipe.hubs
// decides whether it IS one in this build (SPEC §4.2). Both are required. This file validates the
// first; forger.foldHubIntoNodeEdges enforces the pairing and owns invariant I7's refusal.
//
// A KIT THAT DECLARES NO HUB KEY AT ALL IS LEGAL AND COMMON — edfi, sif and pesc260805 are all
// hubless today. So "required" here means REQUIRED ONCE THE KIT DECLARES ANY HUB KEY: a half-
// declared hub (hubModule with no hubNamespace, or the reverse) is a typo, and a typo must not
// become a silently ignored declaration.
//
// PURE: returns an Error or null. No I/O, no clock, no channel. The caller decides what to do with it.
//
// BOUNDARY NOTE (recorded, not resolved): refuse.js lives under lib/forge-framework/ and is
// described in its own header as "the ONE shape every framework refusal is built with". Requiring it
// from here reuses that one shape rather than duplicating it, at the cost of a hub-framework ->
// forge-framework edge. If a later phase gives the two frameworks a genuinely shared home, refuse.js
// is the first thing that should move there. It is NOT moved now: moving a file inside
// lib/forge-framework/ is a framework edit needing a ledger line, and 2a has no need of one.

// FORMAL INTERFACE (polyArch2 — the seam's contract in one place). Phase 2a made the hub module a
// POLYMORPHIC SEAM: the forger no longer knows which module it is calling, only that a kit named one
// in hubModule=. A seam whose contract is enforced but never DECLARED is a seam nobody can implement
// against, so it is written out here, in the contract's own home, beside the descriptor keys that
// select it. (The CEDS implementation's matching @interface CedsHubForge block lives in
// lib/hub-framework/hub-framework.js, where Phase 2c moved it.)
//
// @typedef {Object} HubDescriptorDeclaration — the [parserDescriptor] hub keys.
// @property {string} hubModule     kit-relative path to the hub module, ending .js
// @property {string} hubNamespace  http(s) URI root, TRAILING SLASH REQUIRED
//
// @interface HubModule — what `require(<bundleDir>/<hubModule>)` MUST yield.
// @property {function({hubVersion: string, hubNamespace: string}): HubForge} (default export)
//     A FACTORY. It THROWS on an absent or empty hubVersion/hubNamespace (its documented refusal);
//     the forger contains that throw at its one boundary and routes it error-first.
//
// @interface HubForge — what the factory returns.
// @property {function(BaseNodeEdges, function(errString, HubForgeResult))} forgeHub — R7 error-first
//     callback even though the derivation is synchronous and pure.
// @property {function(Object): string} addressSignatureFor
// @property {function({termIri: string}): string} termAddressSignatureFor — ctdlHub P3, the term tier's signature
// @property {string} hubDefinitionStableId
//
// @typedef {Object} HubForgeResult
// @property {Array<Object>} nodes — HubReference cards (every tier the hub declares) + the one HubDefinition, sorted by stableId
// @property {Array<Object>} edges — HAS_<HUB>_* decomposition + IN_HUB (+ HAS_TERM_REFERENCE when the hub mints both
//     the term and property tiers), sorted
// @property {Array<Object>} divergenceReport   explicitly [] when there are none
// @property {Array<Object>} skipReport         explicitly [] when nothing was skipped
// @property {Object} counts
// @property {string} hubDefinitionStableId
// @property {Array<Object>} identificationPatterns
//
// WHAT IS AND IS NOT ENFORCED HERE, said plainly rather than implied: this file validates the
// DESCRIPTOR. That the named module loads, and that it exports a FUNCTION, is checked by the forger
// at the moment it resolves the seam and is refused by name there — because that is the first point
// at which the failure is real. The SHAPE of what the factory returns is not statically checked by
// anyone; it is proven by the CEDS re-forge reproducing its block id, which is the only oracle the
// hub role has (SPEC §3.8 [R2 F8]).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { REFERENCE_TIER } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { HUB_CARD_FIELD_TABLE, hubFieldTableOf } = require(path.join(__dirname, 'hubCardFieldTable'));

// ---- the contract table ----------------------------------------------------------------------
// Every hub key a parserDescriptor.ini may carry. A key matching /^hub/ that is not named here is
// REFUSED — the descriptor is the kit's whole registration, and an unrecognised registration key is
// a mistake the operator believes took effect.
const HUB_DESCRIPTOR_CONTRACT = Object.freeze({
	hubModule: Object.freeze({
		requiredOnceAnyHubKeyPresent: true,
		kind: 'bundleRelativeModulePath',
		whatItIs: 'the kit-relative path of the hub module, e.g. hubCeds.js',
	}),
	hubNamespace: Object.freeze({
		requiredOnceAnyHubKeyPresent: true,
		kind: 'namespaceUriRoot',
		whatItIs: 'the ONE declared home of this hub\'s URI root; every card uri is minted from it',
	}),
});

const HUB_DESCRIPTOR_KEY_LIST = Object.freeze(Object.keys(HUB_DESCRIPTOR_CONTRACT));
const HUB_KEY_PREFIX_RE = /^hub/;

// ---- ONE registry of kind checkers: (value, { contractEntry }) -> '' or a reason ---------------
const KIND_CHECKER_REGISTRY = Object.freeze({
	bundleRelativeModulePath: (value) => {
		if (typeof value !== 'string' || value.trim() === '') {
			return `must be a non-empty string (got ${JSON.stringify(value)})`;
		}
		if (path.isAbsolute(value)) {
			return `must be KIT-RELATIVE, not absolute (got '${value}') — it is resolved against the bundle directory`;
		}
		if (value.split('/').indexOf('..') !== -1) {
			return `must not climb out of the bundle with '..' (got '${value}') — a kit declares its OWN modules`;
		}
		if (!/\.js$/.test(value)) {
			return `must name a .js module (got '${value}')`;
		}
		return '';
	},
	// the trailing slash is LOAD-BEARING, not cosmetic: the hub module composes card uris as
	// `${hubNamespace}${hubVersion}/${addressSignature}` and the HubDefinition stableId as
	// `${hubNamespace}hubDefinition/${hubName}` (code fact, hub-framework.js). Without it
	// every uri in the block silently loses its separator, which moves the block id and nothing
	// else would say so.
	namespaceUriRoot: (value) => {
		if (typeof value !== 'string' || value.trim() === '') {
			return `must be a non-empty string (got ${JSON.stringify(value)})`;
		}
		if (!/^https?:\/\/\S+$/.test(value)) {
			return `must be an http(s) URI (got '${value}')`;
		}
		if (!/\/$/.test(value)) {
			return `must end with '/' (got '${value}') — card uris are composed by CONCATENATION onto it, so the trailing slash is load-bearing`;
		}
		return '';
	},
});

// ---- validateHubDescriptor({ descriptor, descriptorPath }) -> Error | null ---------------------
// A kit declaring NO hub key is not a hub, which is legal: returns null.
const validateHubDescriptor = ({ descriptor, descriptorPath } = {}) => {
	if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
		return refuse.byName({
			moduleName,
			what: `descriptor is ${descriptor === null ? 'null' : Array.isArray(descriptor) ? 'an array' : `a ${typeof descriptor}`}`,
			where: 'validateHubDescriptor({ descriptor, descriptorPath }) needs the [parserDescriptor] section object',
		});
	}

	const presentHubKeyList = Object.keys(descriptor).filter((oneName) => HUB_KEY_PREFIX_RE.test(oneName));
	if (!presentHubKeyList.length) {
		return null; // this kit is not a hub. Legal, and the common case.
	}

	// unknown key FIRST — a typo must not become a silently ignored declaration
	const unknownName = presentHubKeyList.find((oneName) => HUB_DESCRIPTOR_KEY_LIST.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return refuse.byName({
			moduleName,
			what: `[parserDescriptor] in ${descriptorPath} carries unknown hub key '${unknownName}'`,
			where: `HUB_DESCRIPTOR_CONTRACT names ${HUB_DESCRIPTOR_KEY_LIST.join(', ')}; remove or rename it`,
		});
	}

	for (let nameIndex = 0; nameIndex < HUB_DESCRIPTOR_KEY_LIST.length; nameIndex++) {
		const propertyName = HUB_DESCRIPTOR_KEY_LIST[nameIndex];
		const contractEntry = HUB_DESCRIPTOR_CONTRACT[propertyName];
		const value = descriptor[propertyName];
		if (value === undefined) {
			if (contractEntry.requiredOnceAnyHubKeyPresent) {
				return refuse.byName({
					moduleName,
					what:
						`[parserDescriptor] in ${descriptorPath} declares ${presentHubKeyList.join(', ')} ` +
						`but is missing required hub key '${propertyName}'`,
					where:
						`a kit declaring ANY hub key must declare ALL of ${HUB_DESCRIPTOR_KEY_LIST.join(', ')} — ` +
						`${propertyName} is ${contractEntry.whatItIs}. A half-declared hub is a typo, not a default.`,
				});
			}
			continue;
		}
		const reason = KIND_CHECKER_REGISTRY[contractEntry.kind](value, { propertyName, contractEntry, descriptor });
		if (reason !== '') {
			return refuse.byName({
				moduleName,
				what: `[parserDescriptor] hub key '${propertyName}' in ${descriptorPath} ${reason}`,
				where: `fix ${propertyName}= in the [parserDescriptor] section`,
			});
		}
	}
	return null;
};

// ---- THE H1 DECLARATION CONTRACT (SPEC §4.4) ---------------------------------------------------
// Same shape as forgeDeclarationContract's: a frozen table, the ONE kind-checker registry above, an
// unknown-key walk FIRST, then a required/kind walk. A hub author writes DATA; this decides whether
// the data is admissible before a single card is derived.
const BASE_FIELD_NAME_LIST = Object.freeze([
	'allDomainIds', 'rangeOptionSetId', 'rangeClassId', 'rangeDatatype',
	'textFormat', 'prefLabel', 'notation',
	// dataType and uri ADDED by review finding F6 (FROZEN_JOURNEY, 2026-08-29): both are read off base
	// nodes by BARE NAME and neither is a vocabulary constant, so both belong in the map. The published
	// §4.4 table omitted them; the omission was found by enumerating every `.properties.<name>` read in
	// the module rather than by reading the table.
	'dataType', 'uri',
	'name', 'definition', 'description',
	// ⟪ctdlHub P3 step 2; PLAN §2.4 H-a⟫ the last two base reads that were by BARE NAME (hub-framework.js:761, 767-769,
	// 822, 897 at 087550f9). allDomainIds was already declared; its scalar companion domainId and the lifted canonicalKey
	// were not, which made "every field the derivation reads is declared" false in exactly the two places a second hub
	// is likeliest to differ.
	'canonicalKey', 'domainId',
]);

// ⟪ctdlHub P3 step 2; PLAN §2.4 H-b⟫ the five ROOT fields read into HubDefinition.sourceProvenance — BLOCK BYTES. The
// provenance JSON keeps its own five output names (standardKey, snapshotKey, publishedVersion, sourceVersion,
// sourceUrl); this map says only where on the root each is READ.
const ROOT_FIELD_NAME_LIST = Object.freeze(['standardKey', 'snapshotKey', 'publishedVersion', 'version', 'sourceUrl']);

// ⟪ctdlHub P3 step 3⟫ how a property's range takes part in a card. The derivation behind each mode is the hub framework's
// RANGE_ADDRESSING_REGISTRY, which refuses at load unless it implements exactly these names.
//   singleRangeSlot  ONE range (option set XOR class XOR datatype), hashed into the address slot 'range' (CEDS)
//   rangeAsMeaning   every range the property declares, carried as LIST-VALUED meaning and never hashed; value cards
//                    are minted per option set the property targets (CTDL: schema:rangeIncludes is a hint, not a key)
const RANGE_ADDRESSING_MODE_LIST = Object.freeze(['singleRangeSlot', 'rangeAsMeaning']);

// ⟪ctdlHub P4⟫ where a property's DOMAINS are read. The derivation behind each mode is the hub framework's
// DOMAIN_ADDRESSING_REGISTRY, which refuses at load unless it implements exactly these names.
//   domainFields      the base FIELDS baseFieldNames.allDomainIds, else baseFieldNames.domainId (CEDS: the forge lifts them)
//   hasPropertyEdges  every DmeClass with a HAS_PROPERTY edge to the property (CTDL: its domains exist only as edges; a
//                     property whose only HAS_PROPERTY is from the root has no class domain and is skip-reported)
const DOMAIN_ADDRESSING_MODE_LIST = Object.freeze(['domainFields', 'hasPropertyEdges']);

// ⟪ctdlHub P4⟫ how the hubVersion becomes the PATH SEGMENT of every card IRI (SCARLET_ARROW ruling B). The IRIs become
// stableIds that bridges target for good, so the segment must be readable and valid. The derivation behind each rule is
// the hub framework's HUB_VERSION_SEGMENT_REGISTRY; after the rule, any character outside the IRI-unreserved set is refused.
//   verbatim                the hubVersion as it is (CEDS: '14.0.0.0')
//   whitespaceToUnderscore  each run of whitespace becomes one '_' (CTDL: 'Release 20260327' -> 'Release_20260327', the
//                           form the block key already uses)
const HUB_VERSION_SEGMENT_RULE_LIST = Object.freeze(['verbatim', 'whitespaceToUnderscore']);

// the tiers a hub may declare are the vocabulary's own (REFERENCE_TIER), never a list retyped here
const REFERENCE_TIER_VALUE_LIST = Object.freeze(Object.keys(REFERENCE_TIER).map((tierConstantName) => REFERENCE_TIER[tierConstantName]));

const HUB_DECLARATION_CONTRACT = Object.freeze({
	hubName: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	hubDisplayName: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	canonicalKeyName: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	canonicalKeyMinted: Object.freeze({ required: true, kind: 'boolean' }),
	sourceIdFieldName: Object.freeze({ required: true, kind: 'nonEmptyString' }),
	baseFieldNames: Object.freeze({ required: true, kind: 'baseFieldNameMap' }),
	// OPTIONAL BY DESIGN: a hub with no identification patterns declares nothing and pass 2 is skipped
	// entirely, returning identificationPatterns: []. Absent is absent, not zero-by-accident.
	qualifiedReference: Object.freeze({ required: false, kind: 'qualifiedReference' }),
	provenanceLabel: Object.freeze({ required: true, kind: 'provenanceLabel' }),
	// ⟪ctdlHub P3⟫ REQUIRED, never defaulted: a hub that forgot to say which tiers it mints must not silently get CEDS's.
	// tierList and rangeAddressing precede embedTextTemplateByTier because its checker reads both.
	tierList: Object.freeze({ required: true, kind: 'tierList' }),
	rangeAddressing: Object.freeze({ required: true, kind: 'rangeAddressing' }),
	// ⟪ctdlHub P4⟫ REQUIRED, never defaulted: a hub that forgot where its domains live must not silently read CEDS's fields
	domainAddressing: Object.freeze({ required: true, kind: 'domainAddressing' }),
	hubVersionSegment: Object.freeze({ required: true, kind: 'hubVersionSegment' }),
	rootFieldNames: Object.freeze({ required: true, kind: 'rootFieldNameMap' }),
	embedTextTemplateByTier: Object.freeze({ required: true, kind: 'embedTextTemplateByTier' }),
});
const HUB_DECLARATION_KEY_LIST = Object.freeze(Object.keys(HUB_DECLARATION_CONTRACT));

const DECLARATION_KIND_CHECKER_REGISTRY = Object.freeze({
	nonEmptyString: (value) =>
		typeof value === 'string' && value.trim() !== ''
			? ''
			: `must be a non-empty string (got ${JSON.stringify(value)})`,
	boolean: (value) =>
		typeof value === 'boolean' ? '' : `must be a boolean (got ${JSON.stringify(value)})`,
	// EVERY name the framework reads off a base node must be declared. A MISSING one would read
	// `properties[undefined]`, which is silently undefined — a dropped prose field that no count can
	// see. This is the check that makes baseFieldNames worth having.
	baseFieldNameMap: (value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return `must be an object mapping logical field name -> base property name (got ${JSON.stringify(value)})`;
		}
		const missing = BASE_FIELD_NAME_LIST.filter((oneName) => value[oneName] === undefined);
		if (missing.length) {
			return `is missing required base field name(s): ${missing.join(', ')} — every field the derivation reads must be declared, or it reads properties[undefined] and drops prose silently`;
		}
		const unknown = Object.keys(value).filter((oneName) => BASE_FIELD_NAME_LIST.indexOf(oneName) === -1);
		if (unknown.length) {
			return `carries unknown base field name '${unknown[0]}' — the derivation reads ${BASE_FIELD_NAME_LIST.join(', ')} and nothing else`;
		}
		const notAString = Object.keys(value).find(
			(oneName) => typeof value[oneName] !== 'string' || value[oneName].trim() === '',
		);
		if (notAString !== undefined) {
			return `base field name '${notAString}' must map to a non-empty string (got ${JSON.stringify(value[notAString])})`;
		}
		return '';
	},
	qualifiedReference: (value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return `must be an object { typePropertyPattern, tokenNamesForStem } (got ${JSON.stringify(value)})`;
		}
		if (!(value.typePropertyPattern instanceof RegExp)) {
			return `typePropertyPattern must be a RegExp whose first capture group is the stem (got ${typeof value.typePropertyPattern})`;
		}
		// DATA, NOT A FUNCTION (RULING on the 2c review; SPEC §4.4 [R1 Q7]). A function here would be a
		// hook wearing a declaration's clothes — unreadable to this contract, uncomparable between hubs,
		// and free to read anything in its closure. Templates can be inspected and refused.
		if (!Array.isArray(value.tokenNamesForStem) || value.tokenNamesForStem.length === 0) {
			return `tokenNamesForStem must be a NON-EMPTY array of name templates (got ${typeof value.tokenNamesForStem}) — it is DATA, not a function`;
		}
		const badTemplate = value.tokenNamesForStem.find(
			(oneTemplate) => typeof oneTemplate !== 'string' || oneTemplate.indexOf('{stem}') === -1,
		);
		if (badTemplate !== undefined) {
			return `token name template ${JSON.stringify(badTemplate)} must be a string containing '{stem}' — a template with no substitution point would match the same name for every pattern`;
		}
		const unknown = Object.keys(value).filter(
			(oneName) => ['typePropertyPattern', 'tokenNamesForStem'].indexOf(oneName) === -1,
		);
		if (unknown.length) {
			return `carries unknown key '${unknown[0]}' — it declares typePropertyPattern and tokenNamesForStem only`;
		}
		return '';
	},
	// ⟪ctdlHub P3⟫ a non-empty list of distinct vocabulary tiers. Order is not meaning here, so it is not checked.
	tierList: (value) => {
		if (!Array.isArray(value) || value.length === 0) {
			return `must be a non-empty array of reference tiers drawn from ${REFERENCE_TIER_VALUE_LIST.join(', ')} (got ${JSON.stringify(value)})`;
		}
		const unknownTier = value.find((oneTier) => REFERENCE_TIER_VALUE_LIST.indexOf(oneTier) === -1);
		if (unknownTier !== undefined) {
			return `names tier ${JSON.stringify(unknownTier)}, which is not one of ${REFERENCE_TIER_VALUE_LIST.join(', ')}`;
		}
		const repeatedTier = value.find((oneTier, tierIndex) => value.indexOf(oneTier) !== tierIndex);
		if (repeatedTier !== undefined) {
			return `names tier '${repeatedTier}' twice`;
		}
		return '';
	},
	rangeAddressing: (value) =>
		RANGE_ADDRESSING_MODE_LIST.indexOf(value) !== -1
			? ''
			: `must be one of ${RANGE_ADDRESSING_MODE_LIST.join(', ')} (got ${JSON.stringify(value)})`,
	domainAddressing: (value) =>
		DOMAIN_ADDRESSING_MODE_LIST.indexOf(value) !== -1
			? ''
			: `must be one of ${DOMAIN_ADDRESSING_MODE_LIST.join(', ')} (got ${JSON.stringify(value)})`,
	hubVersionSegment: (value) =>
		HUB_VERSION_SEGMENT_RULE_LIST.indexOf(value) !== -1
			? ''
			: `must be one of ${HUB_VERSION_SEGMENT_RULE_LIST.join(', ')} (got ${JSON.stringify(value)})`,
	// the same discipline as baseFieldNameMap: every root field the derivation reads is declared, and nothing else
	rootFieldNameMap: (value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return `must be an object mapping provenance field name -> root property name (got ${JSON.stringify(value)})`;
		}
		const missing = ROOT_FIELD_NAME_LIST.filter((oneName) => value[oneName] === undefined);
		if (missing.length) {
			return `is missing required root field name(s): ${missing.join(', ')} — each is read into sourceProvenance, which is block bytes`;
		}
		const unknown = Object.keys(value).filter((oneName) => ROOT_FIELD_NAME_LIST.indexOf(oneName) === -1);
		if (unknown.length) {
			return `carries unknown root field name '${unknown[0]}' — the derivation reads ${ROOT_FIELD_NAME_LIST.join(', ')} and nothing else`;
		}
		const notAString = Object.keys(value).find((oneName) => typeof value[oneName] !== 'string' || value[oneName].trim() === '');
		if (notAString !== undefined) {
			return `root field name '${notAString}' must map to a non-empty string (got ${JSON.stringify(value[notAString])})`;
		}
		return '';
	},
	// ⟪ctdlHub P3 step 4; PLAN §2.4 H-e⟫ embedText as DECLARED DATA, one template per declared tier. A template is a list of
	// SLOTS; a slot is a non-empty list of card MEANING field names whose carried values are joined ' · ' (a list-valued
	// field contributes its items). Empty slots drop out; the slots are joined ' · '. What "the value tier's context is
	// its option set" used to assume in code is now CEDS's declared template.
	embedTextTemplateByTier: (value, { hubDeclaration }) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return `must be an object mapping each declared tier to its template (got ${JSON.stringify(value)})`;
		}
		const declaredTierList = hubDeclaration.tierList;
		const templateTierList = Object.keys(value);
		const missingTier = declaredTierList.find((oneTier) => templateTierList.indexOf(oneTier) === -1);
		if (missingTier !== undefined) {
			return `has no template for declared tier '${missingTier}' — every tier the hub mints composes embedText from its own declared template`;
		}
		const undeclaredTier = templateTierList.find((oneTier) => declaredTierList.indexOf(oneTier) === -1);
		if (undeclaredTier !== undefined) {
			return `has a template for tier '${undeclaredTier}', which tierList does not declare`;
		}
		const hubFieldTable = hubFieldTableOf({ fieldTable: HUB_CARD_FIELD_TABLE, tierList: declaredTierList, rangeAddressing: hubDeclaration.rangeAddressing });
		for (let tierIndex = 0; tierIndex < templateTierList.length; tierIndex++) {
			const oneTier = templateTierList[tierIndex];
			const slotList = value[oneTier];
			if (!Array.isArray(slotList) || slotList.length === 0) {
				return `template for tier '${oneTier}' must be a non-empty array of slots (got ${JSON.stringify(slotList)})`;
			}
			const badSlot = slotList.find((oneSlot) => !Array.isArray(oneSlot) || oneSlot.length === 0);
			if (badSlot !== undefined) {
				return `template for tier '${oneTier}' has slot ${JSON.stringify(badSlot)}; a slot is a non-empty array of card field names`;
			}
			const meaningNameList = hubFieldTable
				.filter((fieldRow) => fieldRow.group === 'meaning' && fieldRow.tierList.indexOf(oneTier) !== -1)
				.map((fieldRow) => fieldRow.fieldName);
			const strangerName = [].concat(...slotList).find((fieldName) => meaningNameList.indexOf(fieldName) === -1);
			if (strangerName !== undefined) {
				return `template for tier '${oneTier}' names '${strangerName}', which is not a meaning field of a ${oneTier} card in this hub (${meaningNameList.join(', ')})`;
			}
		}
		return '';
	},
	// ⚠ THESE TWO VALUES ARE BLOCK BYTES. They are stamped into HubDefinition.sourceProvenance, and the
	// CEDS block id depends on them character for character (SPEC §4.9; re-keyed by controlled
	// experiment in Phase 2b, commit 4ce39b8, which proved the change moves exactly one block line).
	provenanceLabel: (value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return `must be an object { forgeModule, forgeModuleVersion } (got ${JSON.stringify(value)})`;
		}
		const missing = ['forgeModule', 'forgeModuleVersion'].filter(
			(oneName) => typeof value[oneName] !== 'string' || value[oneName].trim() === '',
		);
		if (missing.length) {
			return `${missing.join(' and ')} must be (a) non-empty string(s) — these are BLOCK BYTES; an absent one would stamp undefined into every hub block`;
		}
		const unknown = Object.keys(value).filter(
			(oneName) => ['forgeModule', 'forgeModuleVersion'].indexOf(oneName) === -1,
		);
		if (unknown.length) {
			return `carries unknown key '${unknown[0]}' — it declares forgeModule and forgeModuleVersion only`;
		}
		return '';
	},
});

// validateHubDeclaration({ hubDeclaration }) -> Error | null
const validateHubDeclaration = ({ hubDeclaration } = {}) => {
	if (hubDeclaration === null || typeof hubDeclaration !== 'object' || Array.isArray(hubDeclaration)) {
		return refuse.byName({
			moduleName,
			what: `hubDeclaration is ${hubDeclaration === null ? 'null' : Array.isArray(hubDeclaration) ? 'an array' : `a ${typeof hubDeclaration}`}`,
			where: 'the hub framework needs the H1 declaration object (SPEC §4.4)',
		});
	}
	// unknown properties FIRST — a typo must not become a silently ignored declaration
	const unknownName = Object.keys(hubDeclaration).find(
		(oneName) => HUB_DECLARATION_KEY_LIST.indexOf(oneName) === -1,
	);
	if (unknownName !== undefined) {
		return refuse.byName({
			moduleName,
			what: `hubDeclaration carries unknown property '${unknownName}'`,
			where: `HUB_DECLARATION_CONTRACT names ${HUB_DECLARATION_KEY_LIST.join(', ')}; remove or rename it`,
		});
	}
	for (let nameIndex = 0; nameIndex < HUB_DECLARATION_KEY_LIST.length; nameIndex++) {
		const propertyName = HUB_DECLARATION_KEY_LIST[nameIndex];
		const contractEntry = HUB_DECLARATION_CONTRACT[propertyName];
		const value = hubDeclaration[propertyName];
		if (value === undefined) {
			if (contractEntry.required) {
				return refuse.byName({
					moduleName,
					what: `hubDeclaration is missing required property '${propertyName}'`,
					where: `declare ${propertyName} (${contractEntry.kind}) in the kit's hub declaration; absent is absent, never defaulted`,
				});
			}
			continue;
		}
		const reason = DECLARATION_KIND_CHECKER_REGISTRY[contractEntry.kind](value, {
			propertyName,
			contractEntry,
			hubDeclaration,
		});
		if (reason !== '') {
			return refuse.byName({
				moduleName,
				what: `hubDeclaration '${propertyName}' ${reason}`,
				where: `fix ${propertyName} in the kit's hub declaration`,
			});
		}
	}
	return null;
};

// validateHubHooks({ hooks }) -> Error | null. CEDS declares none; the seam exists so a second hub
// can add one without a framework change (SPEC §4.4). No hook NAME is admitted yet, so any key is
// unknown — which is the honest state: an unimplemented hook must refuse, not be ignored.
const HUB_HOOK_NAME_LIST = Object.freeze([]);
const validateHubHooks = ({ hooks } = {}) => {
	if (hooks === undefined) {
		return null; // hooks are optional in their entirety
	}
	if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
		return refuse.byName({
			moduleName,
			what: `hubHooks is ${hooks === null ? 'null' : Array.isArray(hooks) ? 'an array' : `a ${typeof hooks}`}`,
			where: 'the hub framework needs an object of hook methods, or nothing at all',
		});
	}
	const unknownName = Object.keys(hooks).find((oneName) => HUB_HOOK_NAME_LIST.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return refuse.byName({
			moduleName,
			what: `hubHooks carries unknown hook '${unknownName}'`,
			where: `the hub framework admits ${HUB_HOOK_NAME_LIST.length ? HUB_HOOK_NAME_LIST.join(', ') : 'NO hooks yet'} — an unimplemented hook is refused rather than ignored, so a hub author learns at injection instead of wondering why nothing happened`,
		});
	}
	return null;
};

module.exports = {
	HUB_DESCRIPTOR_CONTRACT,
	HUB_DESCRIPTOR_KEY_LIST,
	KIND_CHECKER_REGISTRY,
	validateHubDescriptor,
	HUB_DECLARATION_CONTRACT,
	HUB_DECLARATION_KEY_LIST,
	BASE_FIELD_NAME_LIST,
	ROOT_FIELD_NAME_LIST,
	RANGE_ADDRESSING_MODE_LIST,
	DOMAIN_ADDRESSING_MODE_LIST,
	HUB_VERSION_SEGMENT_RULE_LIST,
	validateHubDeclaration,
	validateHubHooks,
	moduleName,
};
