# Snapshot 01 — EDUcore Enhanced Cockburn use cases, release 1.0 (format v0.11)

**What it is.** The seven vetted use-case documents of the EDUcore Enhanced Cockburn use-case standard, the JSON Schema of the
format they are written to (v0.11), and the standard's own resolution registry (the normative table of citable standards). The
release number is `1.0` (TQ, 2026-10-29: the corpus is a standard released by a committee; this is its first release). The format
number `0.11` is the version of the case structure, carried per case as `formatVersion`.

**Where it came from.** Copied 2026-10-29 by RADIANT_HAVEN (useCaseForge-102926 Phase 1) from the educore repository's working tree:
`/Users/tqwhite/Documents/webdev/educore/system/management/zNotesPlansDocs/educoreEnhancedCockburn-v.11/`. That folder is NOT a git
repository (measured), so this snapshot's provenance is the copy date plus the sha256 of every file, not a commit. Published form of
the standard: https://genericwhite.com/26/educore/useCaseV11/ (HTTP 200, 2026-10-29).

| snapshot path | copied from | sha256 |
|---|---|---|
| cases/fs002Compilation.json | cases/fs002Compilation.json | dfab11a8a4f31a6d943d5dd7e08092051175cc8594ea8dfaef4ca815ce756b82 |
| cases/fs002FederalReporting.json | cases/fs002FederalReporting.json | f1762b6229a211eeb9421441a3713cff09d9de838a59a5432d6f180f5b7df5ea |
| cases/fs002PackageSubmission.json | cases/fs002PackageSubmission.json | 1a06e645be5c08539d818095f6d8ec323b30f02c5dbe97fef3f08149ae914c1f |
| cases/fs5003Confirmation.json | cases/fs5003Confirmation.json | d154e07681e685a25ed8980ff79289234d60dbaeb251ff1fc0aea8b9e843dc00 |
| cases/lerIssuance.json | cases/lerIssuance.json | 6da0707d31913442504884cad2d9db842ccdded1a40c064158680ea34f6e488e |
| cases/lerIssuanceFromSLDS.json | cases/lerIssuanceFromSLDS.json | 9a6c055cd47d61b53f3215036ee84b1411e59509a11a74c7f98a5d74857f7e14 |
| cases/workplaceTrainingRecognition.json | cases/workplaceTrainingRecognition.json | cefdeeee2c1569e6ec8a118465d34a70255c8cdb45b49c25ecfcd7a55a6a1bed |
| formats/v011-schema.json | v011-schema.json | e67b5a677e66e66c7d57c19db3ae682c8f2571ec2ef3d1bfb961ce6740cb8779 |
| resolutionRegistry.json | resolutionRegistry.json | 2d007a3afea67f996deb341ebe5b46ce0dd402175f6dcb9a42f0fc386580324a |

Every file is byte-identical to its source at the copy (`cmp`, 2026-10-29). Acquisition class: `human-artifact-snapshot` for the case
documents (authored by people through the editor), `machine-canonical` for the schema and the registry (the standard's normative
artifacts).

**Acquisition recipe.** `cp -p <v.11>/cases/<the seven>.json cases/; cp -p <v.11>/v011-schema.json formats/; cp -p
<v.11>/resolutionRegistry.json .; shasum -a 256 cases/*.json formats/v011-schema.json resolutionRegistry.json > SHA256SUMS`, then
`shasum -c SHA256SUMS`.

**Not copied, on purpose:** `cases/resolutionReport.json` (a Layer-4 RUN record, rewritten by every run of `validateResolution.py`),
`cases/rendered/` (the HTML rendering), the Python tooling and its virtual environment, `v011-shapes.ttl` (the SHACL oracle; the forge
restates its violation classes as refusals and never reads it).

**Licence.** TQ's own standard (EDUcore); no licence hold. Downloads may carry it.

**A new release** is a NEW snapshot directory (`02`, …) holding the incumbent cases plus the new ones, pinned by `defaultSnapshot` in
`parserDescriptor.ini`; nothing changes until that pin moves (REVISION 1, R1).
