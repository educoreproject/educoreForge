'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// recipe-bridge-expansion.js — the NEW recipe bridge form (R3 of the hub-neutral bridge lane, 2026-10-21, work order step 4).
// A recipe names a standard and the hubs it bridges to; it no longer names a bridge, because a bridge is now a COMPOSITION
// (standard bridging file × hub bridging file, lib/bridge-framework/bridgeComposer.js) whose name is derived by rule:
//
//   new  { source, hubs: [<hub>, ...], dependencies, facet?, params? }        (and the structural pairWith / familyStandards forms, untouched)
//   old  { source, hub, bridge, dependencies, params? }   REFUSED BY NAME in recipe text (zeroBacklog lane D, D2-1 = deCeds R7-1,
//        2026-10-22): every recipe of record was converted at R3, so a recipe naming a bridge by hand is now an error, not a form.
//        The old SHAPE survives as the EXPANDED entry the downstream reads; only recipe TEXT may no longer be written in it.
//
// Expansion turns each new-form entry into one expanded entry per hub, in the recipe's order, so everything downstream (the
// schema, the referential layer, build.js, the frozen-block rule, the proof kit) reads exactly the entries it always read and a
// converted recipe builds the same pairs with the same names. Only the recipe TEXT changes, so its recipeHash changes: that is
// the one expected manifest difference (work order, R7 records it).
//
//   expandRecipeBridges({ recipe, standardBridgingFor }) → { recipe, expandedEntryCount } | { error }
//     standardBridgingFor(sourceToken) → { standardBridging } | { error }   (pluginRegistry.standardBridgingFor, bound to a tree)
//
// THE RULES, each refused by name:
//   - a new-form entry carries only NEW_FORM_KEY_LIST; an entry mixing hubs with hub/bridge is refused (it names a bridge twice)
//   - hubs is a non-empty list of distinct tokens
//   - facet may be omitted only when the standard has ONE facet; with several it is required, '' included (no silent pick)
//   - every hub must be declared by that facet's pairByHubToken (a pairing exists only when the standard declares it)
//   - each pair's dependencies are the entry's dependencies WITHOUT the entry's OTHER hubs (a pair depends on its own hub only)
// The derived name is still confirmed at run by the registry (lookupPlugin), exactly as a hand-written bridge name was.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const bridgeComposerLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'bridgeComposer'));

const NEW_FORM_MARKER_NAME = 'hubs';
const NEW_FORM_KEY_LIST = Object.freeze(['source', 'hubs', 'dependencies', 'facet', 'params']);

const OLD_FORM_MARKER_NAME = 'hub';

const isNewFormEntry = (bridgeEntry) => bridgeEntry !== null && typeof bridgeEntry === 'object' && Object.prototype.hasOwnProperty.call(bridgeEntry, NEW_FORM_MARKER_NAME);
// an old-form entry names a hub by hand (and, in its full shape, the bridge); a new-form entry naming hub is refused by its own rule
const isOldFormEntry = (bridgeEntry) => bridgeEntry !== null && typeof bridgeEntry === 'object' && !isNewFormEntry(bridgeEntry) && Object.prototype.hasOwnProperty.call(bridgeEntry, OLD_FORM_MARKER_NAME);

// oldFormRefusalText — one line per old-form entry: where it is, what it names, and the new-form entry to write instead
const oldFormRefusalText = ({ bridgeEntry, entryIndex }) =>
	refuse.byName({
		moduleName,
		what: `bridges[${entryIndex}] (source '${bridgeEntry.source}') uses the RETIRED recipe bridge form { source, hub, bridge } (hub '${bridgeEntry.hub}', bridge '${bridgeEntry.bridge}')`,
		where: `write { source: '${bridgeEntry.source}', hubs: ['${bridgeEntry.hub}'] }: the bridge name is derived from the standard's bridging file (zeroBacklog D2-1, deCeds R7-1)`,
	}).message;

// expandedEntryListFor — one new-form entry → its old-form entries, or { error }
const expandedEntryListFor = ({ bridgeEntry, entryIndex, standardBridgingFor }) => {
	const whereText = `bridges[${entryIndex}] (source '${bridgeEntry.source}')`;
	const unknownKeyList = Object.keys(bridgeEntry).filter((oneKey) => NEW_FORM_KEY_LIST.indexOf(oneKey) === -1);
	if (unknownKeyList.length) {
		return { error: refuse.byName({ moduleName, what: `${whereText} names hubs[] and also [${unknownKeyList.join(', ')}]`, where: `a new-form entry carries only { ${NEW_FORM_KEY_LIST.join(', ')} }; its bridge names are derived, so it never names hub or bridge` }) };
	}
	const hubTokenList = bridgeEntry.hubs;
	if (!Array.isArray(hubTokenList) || hubTokenList.length === 0 || !hubTokenList.every((oneHub) => typeof oneHub === 'string' && oneHub !== '') || new Set(hubTokenList).size !== hubTokenList.length) {
		return { error: refuse.byName({ moduleName, what: `${whereText} hubs ${JSON.stringify(hubTokenList)} is not a non-empty list of distinct hub tokens`, where: 'a new-form recipe entry' }) };
	}
	if (typeof bridgeEntry.source !== 'string' || bridgeEntry.source === '' || !Array.isArray(bridgeEntry.dependencies)) {
		return { error: refuse.byName({ moduleName, what: `${whereText} needs a source token and a dependencies list`, where: 'a new-form recipe entry' }) };
	}
	const found = standardBridgingFor(bridgeEntry.source);
	if (found.error) {
		return { error: new Error(`${found.error.message} [${whereText}]`) };
	}
	const { standardBridging } = found;
	const facetNameList = standardBridging.facetList.map((oneFacet) => oneFacet.facetName);
	if (bridgeEntry.facet === undefined && facetNameList.length !== 1) {
		return { error: refuse.byName({ moduleName, what: `${whereText} names no facet, and '${bridgeEntry.source}' declares ${facetNameList.length} [${facetNameList.map((oneName) => JSON.stringify(oneName)).join(', ')}]`, where: 'facet may be omitted only for a standard with one facet; state it ("" included)' }) };
	}
	const facetName = bridgeEntry.facet === undefined ? facetNameList[0] : bridgeEntry.facet;
	const oneFacet = standardBridging.facetList.find((candidateFacet) => candidateFacet.facetName === facetName);
	if (oneFacet === undefined) {
		return { error: refuse.byName({ moduleName, what: `${whereText} facet ${JSON.stringify(facetName)} is not declared by '${bridgeEntry.source}' [${facetNameList.map((oneName) => JSON.stringify(oneName)).join(', ')}]`, where: 'the standard bridging file\'s facetList' }) };
	}
	const undeclaredHubList = hubTokenList.filter((oneHub) => !Object.prototype.hasOwnProperty.call(oneFacet.pairByHubToken, oneHub));
	if (undeclaredHubList.length) {
		return { error: refuse.byName({ moduleName, what: `${whereText} facet ${JSON.stringify(facetName)} does not pair with hub(s) [${undeclaredHubList.join(', ')}]; it declares [${Object.keys(oneFacet.pairByHubToken).join(', ')}]`, where: 'a pairing exists only when the standard declares it (pairByHubToken)' }) };
	}
	const entryList = [];
	const nameErrorList = [];
	hubTokenList.forEach((hubToken) => {
		const bridgeName = bridgeComposerLib.derivedBridgeNameFor({ bridgeNameStem: standardBridging.bridgeNameStem, facetName, hubToken, matchBasis: oneFacet.declarationTemplate.matchBasis });
		if (bridgeName === undefined) {
			nameErrorList.push(`${hubToken}: matchBasis '${oneFacet.declarationTemplate.matchBasis}' has no name suffix`);
			return;
		}
		const pairEntry = {
			source: bridgeEntry.source,
			hub: hubToken,
			bridge: bridgeName,
			dependencies: bridgeEntry.dependencies.filter((oneDependency) => oneDependency === hubToken || hubTokenList.indexOf(oneDependency) === -1),
		};
		if (bridgeEntry.params !== undefined) {
			pairEntry.params = bridgeEntry.params;
		}
		entryList.push(pairEntry);
	});
	if (nameErrorList.length) {
		return { error: refuse.byName({ moduleName, what: `${whereText} ${nameErrorList.join('; ')}`, where: 'bridgeComposer.BASIS_NAME_SUFFIX_BY_MATCH_BASIS' }) };
	}
	return { entryList };
};

const expandRecipeBridges = ({ recipe, standardBridgingFor }) => {
	const oldFormRefusalList = (Array.isArray(recipe.bridges) ? recipe.bridges : []).map((bridgeEntry, entryIndex) => (isOldFormEntry(bridgeEntry) ? oldFormRefusalText({ bridgeEntry, entryIndex }) : '')).filter((oneText) => oneText !== '');
	if (oldFormRefusalList.length) {
		return { error: new Error(oldFormRefusalList.join('\n')) };
	}
	if (!Array.isArray(recipe.bridges) || !recipe.bridges.some(isNewFormEntry)) {
		return { recipe, expandedEntryCount: 0 };
	}
	if (typeof standardBridgingFor !== 'function') {
		return { error: refuse.byName({ moduleName, what: 'the recipe has new-form bridge entries (hubs[]) and no standardBridgingFor was supplied', where: 'the caller binds pluginRegistry.standardBridgingFor to the tree\'s forges directory' }) };
	}
	const bridgeList = [];
	const errorList = [];
	let expandedEntryCount = 0;
	recipe.bridges.forEach((bridgeEntry, entryIndex) => {
		if (!isNewFormEntry(bridgeEntry)) {
			bridgeList.push(bridgeEntry);
			return;
		}
		const expanded = expandedEntryListFor({ bridgeEntry, entryIndex, standardBridgingFor });
		if (expanded.error) {
			errorList.push(expanded.error.message);
			return;
		}
		expandedEntryCount += 1;
		bridgeList.push(...expanded.entryList);
	});
	if (errorList.length) {
		return { error: new Error(errorList.join('\n')) };
	}
	return { recipe: Object.assign({}, recipe, { bridges: bridgeList }), expandedEntryCount };
};

module.exports = { expandRecipeBridges, isNewFormEntry, isOldFormEntry, NEW_FORM_KEY_LIST, moduleName };
