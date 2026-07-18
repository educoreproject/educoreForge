'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// manifestPreservation.js — the reusable PRESERVATION comparator (standing gate support).
//
// Generalized out of the CTDL→CEDS campaign battery (baselines/ctdlCedsFinal-battery.js, the
// "preservation" section: every base manifest member — f957b88c + the three structuralBridge blocks
// — survives composition). That battery hard-coded the campaign's block ids; this comparator is
// standard-agnostic: it answers "is a NAMED/EXPECTED set of members (blocks OR edges) that is present
// in a BASE still present after COMPOSITION?" for ANY base + expected set.
//
// assertPreservation({ base, expected, composed, keyOf }) -> verdict. PURE, synchronous.
//   base      — the base manifest's member set (array of ids, or objects reduced by keyOf).
//   expected  — the NAMED subset that must survive (array); defaults to the ENTIRE base (every base
//               member must be preserved — the campaign's "all pilot members BY ID" assertion).
//   composed  — the composed manifest's member set (array) after composition.
//   keyOf     — optional (element -> string key); lets the SAME comparator serve blocks or edges
//               (e.g. an edge (from,to,type) triple key). Defaults to identity (ids are strings).
//
// WELL-FORMED GUARD (the nonEmpty-guard analogue, guards a vacuous GREEN): a verdict is well-formed
// only when the expected set is NON-EMPTY and every expected key is actually DRAWN FROM the base
// ("present in a base"). An empty expected set, or an expected key absent from the base, can never
// report a meaningful preservation — wellFormed=false forces preserved=false so an empty/miscited
// expectation cannot masquerade as GREEN.
//
// Async style: PURE synchronous comparator (no I/O). camelCase only.
//
// @concept: [[ManifestPreservation]]
// @concept: [[StandingGate]]

const moduleFunction = ({ moduleName } = {}) => () => {
	const identity = (element) => element;
	const toKeySet = (list, keyOf) => new Set((list || []).map(keyOf));

	const assertPreservation = ({ base, expected, composed, keyOf = identity } = {}) => {
		const baseSet = toKeySet(base, keyOf);
		// expected defaults to the ENTIRE base set (every base member must survive composition)
		const expectedList = expected != null ? expected : base || [];
		const expectedSet = toKeySet(expectedList, keyOf);
		const composedSet = toKeySet(composed, keyOf);

		const expectedKeys = [...expectedSet];
		// the expected set must actually be drawn from the base — "present in a base"
		const expectedNotInBase = expectedKeys.filter((oneKey) => !baseSet.has(oneKey));
		// the preservation failure: expected members absent from the composed manifest
		const missing = expectedKeys.filter((oneKey) => !composedSet.has(oneKey));

		const wellFormed = expectedSet.size > 0 && expectedNotInBase.length === 0;
		const preserved = wellFormed && missing.length === 0;

		return {
			preserved,
			wellFormed,
			missing,
			expectedNotInBase,
			baseCount: baseSet.size,
			expectedCount: expectedSet.size,
			composedCount: composedSet.size,
		};
	};

	return { assertPreservation };
};

module.exports = moduleFunction({ moduleName });
