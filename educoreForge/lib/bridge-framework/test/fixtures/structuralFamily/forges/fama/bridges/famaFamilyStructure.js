'use strict';

// famaFamilyStructure.js — ⟪ctdlHub P6⟫ the FIXTURE structural producer test-bgStructural runs: a three-standard toy family
// (fama root, famb, famc), its locator table beside it in bridgeData/. Pure data, like every structural producer.

const structuralDeclaration = Object.freeze({
	producerName: 'famaFamilyStructure',
	standardKey: 'fama',
	producerVersion: '1.0.0',
	familyStandardKeyList: Object.freeze(['fama', 'famb', 'famc']),
	familyRootStandardKey: 'fama',
	locatorTablePath: 'bridgeData/famaLocatorTable.json',
});

module.exports = { structuralDeclaration };
