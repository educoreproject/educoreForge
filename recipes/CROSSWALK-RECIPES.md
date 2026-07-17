# crosswalkRecipes — bridging standards, always version-specific

A **crosswalkRecipe** declares the connection between standards: which bridge
modules produce the cross-standard edges for one ordered pair of standards.

## What crosswalks are for

**Mainly: CEDS mapping.** CEDS is the canonical hub of the DME — most crosswalks
map a standard TO CEDS (the `CEDS__X` recipes), carrying the SSSOM-tiered
correspondence content: authored EXACT_MATCH (authority-based — a published
crosswalk, a cedsId anchor, a spec declaration), inferred CLOSE_MATCH
(embedding + abstain-first LLM judgment), and classification crosswalks
(e.g. CIP__SOC relatedness — never equivalence).

**But also: ANY other bridging between (or among) standards.** A crosswalk is not
limited to the hub. The CTDL family crosswalks (`CTDL__CTDLASN`,
`CTDL__CTDLQData`, `CTDLASN__CTDLQData`) carry pair-scoped STRUCTURAL bridges —
the domain/range/subclass/optionSet relationships the standards declare about
each other. Any future standard-to-standard bridge — structural, equivalence,
classification, or something new — is expressed the same way: one
crosswalkRecipe per ordered standard pair, naming the modules that produce it.
"Among" more than two standards decomposes into its pairs (the CTDL family's
three-way connection is exactly three pair recipes).

## Always version-specific — for EVERY standard mentioned

A crosswalk never connects "CTDL to CEDS" in the abstract. It connects
**CTDL @ Release 20260327 to CEDS @ 14.0.0.0** — and the store ENFORCES this:
every crosswalk block must carry the complete four-part version key
(pairA / pairAVersion / pairB / pairBVersion) or it is rejected at save.
Consequences:

- When ANY standard mentioned in a crosswalk changes version, that crosswalk
  must follow — re-keyed (edf-rekey, header-pair derivation) or re-produced by
  its modules against the new versions. Nothing follows silently.
- A golden selects which version-pair's crosswalk content is live (the
  pair-group CURRENT pointer / explicit manifest members). Version-switching a
  standard therefore switches exactly its crosswalks and nothing else.
- The recipe's `versionKey` (e.g. `(01,01)`) names the snapshot pair it
  declares; a different version pair is a DIFFERENT crosswalkRecipe (recipes
  are version-pure — never version-rich).

## Placement and naming

`cli/parserLib/forge-<firstKey>/crosswalks/<A>__<B>.crosswalkRecipe.jsonc` —
co-located with the FIRST standard of the ordered pair (hub-first for CEDS
pairs, family-root-first, else lexicographic). See recipes/README.md for the
full recipe-layer conventions and goldens/ for how a golden composes them.
