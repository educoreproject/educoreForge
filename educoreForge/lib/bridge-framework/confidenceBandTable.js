'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// confidenceBandTable.js — CONFIDENCE_BAND_TABLE: the judge's discrete CATEGORY → the DISCRETE confidence
// a judged mapping carries (SPEC-bridgeFramework-v1.md §5.6 step 3; BR-066; C1). DATA: `confidence` is
// never a float from the judge and never computed; a category outside the table is refused by name. The
// categories are exactly SELECT_CATEGORY_ENUM's picking members (apps/bridge-maker/lib/evidenceContracts.js
// — REUSED); 'none' is the abstention and carries no confidence.

const path = require('path');
const { SELECT_CATEGORY_ENUM } = require(path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'evidenceContracts'));

const CONFIDENCE_BAND_TABLE = Object.freeze({
	strong: 0.9,
	moderate: 0.7,
	weakButReal: 0.5,
});
const ABSTAIN_CATEGORY = 'none';
const PICK_CATEGORY_LIST = Object.freeze(SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== ABSTAIN_CATEGORY));

// every picking category has a band row and every band row is a picking category — asserted at load
if (PICK_CATEGORY_LIST.some((oneCategory) => CONFIDENCE_BAND_TABLE[oneCategory] === undefined) || Object.keys(CONFIDENCE_BAND_TABLE).some((oneCategory) => PICK_CATEGORY_LIST.indexOf(oneCategory) === -1)) {
	throw new Error(`${moduleName} REFUSED: CONFIDENCE_BAND_TABLE (${Object.keys(CONFIDENCE_BAND_TABLE).join(', ')}) and SELECT_CATEGORY_ENUM's picking members (${PICK_CATEGORY_LIST.join(', ')}) disagree`);
}

// confidenceForCategory(category) → { confidence } | { error }
const confidenceForCategory = (category) =>
	CONFIDENCE_BAND_TABLE[category] === undefined
		? { error: `${moduleName}: category ${JSON.stringify(category)} has no confidence band (${Object.keys(CONFIDENCE_BAND_TABLE).join(', ')}); a judge category is discrete data, never a float` }
		: { confidence: CONFIDENCE_BAND_TABLE[category] };

module.exports = { CONFIDENCE_BAND_TABLE, ABSTAIN_CATEGORY, PICK_CATEGORY_LIST, confidenceForCategory, moduleName };
