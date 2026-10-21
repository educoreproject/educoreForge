'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// frozenDecisionBlockRule.js — trap T1 (R0 proof kit, 2026-10-21, step 8). A plain build that finds no frozen decision block for
// a pairing says so in one status line and writes ZERO edges (bridge-framework materialise; pinned for dev use by BG-MODES and
// BG-REPLAY e). In a recipe whose kind REQUIRES frozen blocks (RECIPE_KIND_RULE.frozenDecisionBlockRequired: golden) that
// silence would let a renamed or moved bridge look like a clean migration, so build.js refuses it by name through this rule.
//
// THE RULE LIVES IN A PURE MODULE so its gate exercises the rule rather than a copy (the bridgeCollisionRule.js precedent);
// build.js keeps only the wiring.
//
//   pairKeyFor({ hubToken, hubVersion, sourceToken, sourceVersion, bridgeName, producerKind }) → the decision store's lookup key
//     <hub>@<hubVersion>::<source>@<sourceVersion>::<bridgeName>::<producerKind>, versions being the standards' declared versions.
//     bridge-framework.js spells the same template inline (its two lines are the find-text of BG-REG g and BG-PAIRKEY twins, and a
//     framework edit moves every re-frozen block's frameworkFingerprint), so it is NOT rewritten to call this: test-
//     frozenDecisionBlockRule (d) pins the two spellings together, and the no-rebuild digest gate checks this composition against
//     every key frozen in the baseline stores.
//   refusalFor({ recipeName, recipeKind, kindRule, bridge, pairRebridges, runReport, pairKey }) → '' | refusal text
//     kindRule      RECIPE_KIND_RULE[recipeKind]; the kind is schema-required and enum-validated where a recipe enters -build
//     bridge        the recipe's bridges[] entry; a hubless (structural) pairing has no decision block by construction
//     pairRebridges true when the pair is in the --rebridge scope (it freezes, it does not materialise)
//     runReport     the bridge's run report; decisionBlock null means it materialised from no frozen block

const pairKeyFor = ({ hubToken, hubVersion, sourceToken, sourceVersion, bridgeName, producerKind }) => `${hubToken}@${hubVersion}::${sourceToken}@${sourceVersion}::${bridgeName}::${producerKind}`;

const refusalFor = ({ recipeName, recipeKind, kindRule, bridge, pairRebridges, runReport, pairKey }) => {
	if (kindRule === undefined || kindRule.frozenDecisionBlockRequired !== true) {
		return '';
	}
	if (bridge.hub === undefined || pairRebridges === true || runReport.decisionBlock !== null) {
		return '';
	}
	return (
		`no frozen decision block for ${pairKey} in ${recipeKind} recipe ${recipeName} — a ${recipeKind} recipe materialises every ` +
		'mapping bridge from a frozen block; a missing one would yield zero edges silently (a renamed or moved bridge looks clean). ' +
		'Freeze it with --rebridge=<source>, or correct the bridge name'
	);
};

module.exports = { pairKeyFor, refusalFor, moduleName };
