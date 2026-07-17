# forgeRecipes — the declarative build layer (v1, 2026-07-17)

Per the settled architecture (forgeArchitectureRefactor_071626/PROPOSAL.md + SPECIFICATION.md):
recipes are VERSION-PURE DECLARATIVE plans, in THREE kinds mirroring the store's three
version-keyed shapes. Recipes declare WHAT to build (standards, versions, modules,
dependencies) — never block ids (those are build OUTPUTS, recorded in manifests).

PLACEMENT (TQ ruling 2026-07-17 — co-location, like the structure-maker module):
- Standard recipes live IN the standard's forge directory:
  `cli/parserLib/forge-<key>/<key>.forgeRecipe.jsonc` — ONE standard @ ONE version.
- Crosswalk recipes (formerly "pairing" — TQ named them crosswalkRecipe 2026-07-17) live in the FIRST (hub/root) standard's forge directory:
  `cli/parserLib/forge-<firstKey>/crosswalks/<A>__<B>.crosswalkRecipe.jsonc` — an
  ordered version-pair + the bridge module(s) that produce its content.
  Pair ordering: hub-first (CEDS::X), else family-root-first, else lexicographic —
  so the ordering rule also decides the recipe's home.
- Golden recipes stay HERE (`goldens/<name>.goldenRecipe.jsonc`) — a golden spans
  every standard, so it has no single forge home. A golden = a LIST of standard
  recipes + crosswalk selections (+ reference blocks), composed EXPLICIT-MEMBER
  (S14: legacy carriers excluded by enumeration, never naive layering).
This README is the index; the runner discovers recipes by these conventions.
Crosswalk concept + rules: CROSSWALK-RECIPES.md (mainly CEDS mapping; also any
standard-to-standard bridging; ALWAYS version-specific for every standard mentioned).

STATUS: DECLARATIVE ONLY. The recipe RUNNER (manifestEditor recipe→manifest, the
full bridgeMaker loop) is a later work-order; these files are its future input and
today's authoritative documentation of the current golden's composition.

Provenance: authored from the live-verified roster of manifest 81627d17
(GOLD_EVAL_260717; scratchpad/recipe-roster.json, 2026-07-17). Known notes:
(1) the three ctdlFamilyStructure block TEXTS survive only in the GOLD_EVAL_260717
materialization — deterministically re-emittable (G3-proven identical blockIds);
(2) the three structural pairings are manifest-pinned, not yet pair-group-minted
(their CURRENT pointers await the runner); (3) six standards carry honest
publishedVersion=unknown — upgrading them to spec/provenance versions is a
per-standard source-provenance task, not a recipe defect.
