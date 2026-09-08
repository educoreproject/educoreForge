'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// judgeIdentityAliasTable.js — the DATED ALIAS TABLE for retired judge identities (JOB 6 of the judge
// provider registry order, gate G6-g; ruled by DAWN_TOWER 2026-09-08).
//
// ============================================================================================
// WHAT THIS IS FOR
// ============================================================================================
// The debug judge's identity was spelled three ways in eight days: `debugJudge-first-v1-INVALID_DEBUG`
// before JOB 1, `debugJudge:first-v1-INVALID_DEBUG` between JOB 1 and JOB 4, and `debug:<rule>` since
// JOB 4 unified `judgeKind` into one expression. A graph judged under an older spelling must enumerate at
// the promotion gate as ONE judge, not as two or three spellings of one rule — otherwise the gate itself
// manufactures the false signal it exists to prevent, and a promoter reads "two judges touched this graph"
// where only one ever did.
//
// ============================================================================================
// IT RENAMES; IT NEVER ADMITS OR EXCLUDES  (the load-bearing rule — DAWN_TOWER's words, 2026-09-08)
// ============================================================================================
// An unrecognised identity PASSES THROUGH UNTOUCHED. A refusal here would make this table a WHITELIST of
// judges — the "registry of what you expect to find" that the population rule forbids — and the unknown
// judge is exactly what this gate exists to SHOW the operator. Enumerate from the manifest; a population
// read from a registry of the expected cannot detect the thing nobody declared.
//
// ============================================================================================
// DATA, NOT A RULE. NO REGEX. NO GENERAL NORMALISER.
// ============================================================================================
// The lookup is EXACT and WHOLE-STRING. No prefix matching, no case folding, no separator rewriting. A
// normaliser would silently merge identities nobody decided were the same — and "these two strings mean
// one judge" is a HISTORICAL FACT about a specific migration on a specific date, not a property of their
// shape. Each row therefore carries its own dated reason, and a fourth spelling is a new row rather than a
// cleverer pattern. A gate asserts this file contains no regex at all.
//
//   currentModelIdentityFor(oneModelIdentity) → the current spelling, or the INPUT UNCHANGED when no row matches
//   JUDGE_IDENTITY_ALIAS_ROW_LIST             → frozen rows, so callers enumerate FROM the data
//
// This file lives beside gold-eval-bridge-sibling.js, its only consumer, and NOT under bridge-maker/lib —
// a new file there would move the decision-block content fingerprint (decisionBlock.js, recursive:false)
// for a reason unrelated to content, and would redden two acceptance conjuncts for a promotion-gate lookup
// table that no judge or client ever reads.

// ----- THE ROWS. Adding a retired spelling is one row here; no logic below changes.
const JUDGE_IDENTITY_ALIAS_ROW_LIST = Object.freeze([
	Object.freeze({
		historicalModelIdentity: 'debugJudge-first-v1-INVALID_DEBUG',
		currentModelIdentity: 'debug:first',
		retiredOn: '2026-09-07',
		reasonText:
			'the PRE-JOB-1 HYPHEN form. JOB 1 namespaced the debug identity on 2026-09-07 (commit eb79cfa); ' +
			'JOB 4 shortened it again to debug:<rule> so bridge-framework could build judgeKind with ONE ' +
			'expression. 2,957 judged edges on DEV_fiveBridgeSelfDoc_260901 carry this spelling and no other — ' +
			'measured read-only 2026-09-08, and it is the whole reason this table exists.',
	}),
	Object.freeze({
		historicalModelIdentity: 'debugJudge:first-v1-INVALID_DEBUG',
		currentModelIdentity: 'debug:first',
		retiredOn: '2026-09-07',
		reasonText:
			'the JOB 1-to-JOB 3 COLON form, produced between eb79cfa and f8297c5. JOB 4 made PROVIDER_NAME ' +
			'"debug" and dropped the -v1-INVALID_DEBUG tail. ZERO live edges carry this spelling — measured, ' +
			'not assumed (read-only, 2026-09-08). The row exists because the value was PRODUCED for a period, ' +
			'not because an artifact holding it has been found; a graph built in that window would carry it.',
	}),
]);

// ----- GUARDS ON THE DATA, at load, by name. Both are the shape a third row's author adds by accident,
//   and both are silent defects rather than loud ones: a no-op row reads as coverage that is not there,
//   and a contradictory pair makes the enumeration depend on row order.
const historicalIdentitySeenAt = {};
JUDGE_IDENTITY_ALIAS_ROW_LIST.forEach((oneRow, oneRowIndex) => {
	if (oneRow.historicalModelIdentity === oneRow.currentModelIdentity) {
		throw new Error(
			`${moduleName}: row ${oneRowIndex} aliases '${oneRow.historicalModelIdentity}' to ITSELF. A no-op row ` +
				`reads as coverage of a retired spelling while covering nothing. Remove it, or name the spelling it ` +
				`should actually map to.`,
		);
	}
	const priorRowIndex = historicalIdentitySeenAt[oneRow.historicalModelIdentity];
	if (priorRowIndex !== undefined && JUDGE_IDENTITY_ALIAS_ROW_LIST[priorRowIndex].currentModelIdentity !== oneRow.currentModelIdentity) {
		throw new Error(
			`${moduleName}: rows ${priorRowIndex} and ${oneRowIndex} both alias '${oneRow.historicalModelIdentity}' ` +
				`but to DIFFERENT identities ('${JUDGE_IDENTITY_ALIAS_ROW_LIST[priorRowIndex].currentModelIdentity}' and ` +
				`'${oneRow.currentModelIdentity}'). One historical spelling has one successor; two would make the ` +
				`enumeration depend on the order of this list, which is not a decision anyone made.`,
		);
	}
	historicalIdentitySeenAt[oneRow.historicalModelIdentity] = oneRowIndex;
});

// ----- currentModelIdentityFor — EXACT, WHOLE-STRING lookup over the rows.
//   An unmatched identity is returned UNCHANGED. That is not a tolerance; it is the contract.
const currentModelIdentityFor = (oneModelIdentity) => {
	const matchedRow = JUDGE_IDENTITY_ALIAS_ROW_LIST.filter((oneRow) => oneRow.historicalModelIdentity === oneModelIdentity)[0];
	return matchedRow === undefined ? oneModelIdentity : matchedRow.currentModelIdentity;
};

module.exports = Object.freeze({ JUDGE_IDENTITY_ALIAS_ROW_LIST, currentModelIdentityFor, moduleName });
