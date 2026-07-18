'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// closureDelta.js — the reusable DELTA-CLOSURE comparator (standing gate support).
//
// Generalized out of the CTDL→CEDS campaign battery (baselines/ctdlCedsFinal-battery.js, the
// "delta-closure" section, which subprocess-isolated a validateManifestClosure over the composed BASE
// and the FINAL candidate, keyed each violation `blockId>requiredBlockId`, and asserted
// newViolations==0 AND healedViolations==0). That battery wired in the campaign's specific manifest
// keys; this comparator is standard-agnostic: given the base manifest's KNOWN violation set and the
// composed manifest's violation set, it answers "does the composed closure equal EXACTLY the base's
// known set — zero NEW violations, zero silently healed?" for ANY pair of violation lists.
//
// assertDeltaClosure({ baseViolations, composedViolations, keyOf }) -> verdict. PURE, synchronous.
//   baseViolations     — the base manifest's KNOWN closure violations (the legitimate legacy debt).
//   composedViolations — the composed manifest's closure violations.
//   keyOf              — optional (violation -> string key). Defaults to the battery's key,
//                        `${v.blockId}>${v.requiredBlockId}`.
//
// A NEW violation (in composed, not in base) is the fault composition must never introduce. A HEALED
// violation (in base, not in composed) is surfaced too: the base's debt is EXACT, and a silently
// vanished violation means the closure changed in a way that was not declared. `clean` (the GREEN
// condition) requires BOTH sets empty — composed == base's known set exactly. `noNewViolations` is
// exposed separately for callers whose contract is only "introduce no new violations".
//
// Note: an empty base debt is legitimate (a base with zero closure debt), so — unlike preservation —
// there is no nonEmpty guard: empty composed == empty base is a valid GREEN (debt stayed at zero).
//
// Async style: PURE synchronous comparator (no I/O). camelCase only.
//
// @concept: [[DeltaClosure]]
// @concept: [[StandingGate]]

const moduleFunction = ({ moduleName } = {}) => () => {
	const defaultKeyOf = (oneViolation) =>
		`${oneViolation.blockId}>${oneViolation.requiredBlockId}`;
	const toKeySet = (list, keyOf) => new Set((list || []).map(keyOf));

	const assertDeltaClosure = ({
		baseViolations,
		composedViolations,
		keyOf = defaultKeyOf,
	} = {}) => {
		const baseSet = toKeySet(baseViolations, keyOf);
		const composedSet = toKeySet(composedViolations, keyOf);

		const newViolations = [...composedSet].filter((oneKey) => !baseSet.has(oneKey));
		const healedViolations = [...baseSet].filter((oneKey) => !composedSet.has(oneKey));

		const noNewViolations = newViolations.length === 0;
		const identical = noNewViolations && healedViolations.length === 0;

		return {
			clean: identical,
			identical,
			noNewViolations,
			newViolations,
			healedViolations,
			baseCount: baseSet.size,
			composedCount: composedSet.size,
		};
	};

	return { assertDeltaClosure };
};

module.exports = moduleFunction({ moduleName });
