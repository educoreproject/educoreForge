'use strict';

// lifBridging.js — TEST FIXTURE (zeroBacklog lane D, D2-1, 2026-10-22). The doubles-only recipe fixtures (cedsLif and the bad-*
// fixtures) name 'lif', a REMOVED forge with no bridging file in the tree. When the old recipe bridge form { source, hub, bridge }
// was refused by name, they moved to the new form { source: 'lif', hubs: ['ceds'] }, whose bridge name is DERIVED from the
// standard's bridging file. This file is that bridging file, and nothing more: the tests load those fixtures with
// forgesDirPath = lifFixtureForges, so the expansion derives lifCedsDerivedPlugin (facet '') and lifCodesCedsDeclaredCorrespondence
// (facet 'Codes', for the two-bridges-on-one-pair fixture). No build ever registers a plugin from it.

const standardBridging = Object.freeze({
	standardKey: 'lif',
	bridgeNameStem: 'lif',
	facetList: [
		{ facetName: '', declarationTemplate: { matchBasis: 'derived' }, subjectRenderingAllowList: null, pairByHubToken: { ceds: {} } },
		{ facetName: 'Codes', declarationTemplate: { matchBasis: 'declared' }, subjectRenderingAllowList: null, pairByHubToken: { ceds: {} } },
	],
});

module.exports = { standardBridging };
