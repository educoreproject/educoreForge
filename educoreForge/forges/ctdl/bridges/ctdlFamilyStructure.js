'use strict';

// ctdlFamilyStructure.js — ⟪ctdlHub-101926 P6 step 5; rulings R-3, R-4; TQ ruling 2026-07-26 "refactor first"⟫ the CTDL family's
// STRUCTURAL producer, moved from the July forge layer (codeAttic/cli/parserLib/forge-ctdl/modules/ctdlFamilyStructure.js) into
// the bridge layer as pure DATA. The framework's structuralRunner does the work: a same-IRI identity join over the three family
// standards' own crossRefs, each STRUCTURE locator of the family's ONE locator table (bridgeData/ctdlFamilyLocatorTable.json)
// turned into its July edge type and direction, one pair-scoped, version-keyed block per family pair:
// CTDL::CTDLASN, CTDL::CTDLQData, CTDLASN::CTDLQData (root first, then lexicographic). No vectors, no judge, no hub.
// Correspondence locators are not this producer's (the declared bridges write them as DECLARED_CORRESPONDENCE).

const structuralDeclaration = Object.freeze({
	producerName: 'ctdlFamilyStructure',
	standardKey: 'ctdl',
	producerVersion: '2.0.0',
	familyStandardKeyList: Object.freeze(['ctdl', 'ctdlasn', 'ctdlqdata']),
	familyRootStandardKey: 'ctdl',
	locatorTablePath: 'bridgeData/ctdlFamilyLocatorTable.json',
});

module.exports = { structuralDeclaration };
