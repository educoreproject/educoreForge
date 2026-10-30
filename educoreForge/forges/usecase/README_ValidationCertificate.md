# Validation certificate — UseCase (EDUcore Enhanced Cockburn use cases)

**The EDUcore use cases, release 1.0, were built from their seven case documents. The graph has 191 nodes and 641 edges.**
**It holds the 7 cases with their 73 steps, the 55 user stories, actors, conditions, events, value drivers and subjects they share, and every citation they make, carried as written.**

Accuracy was checked two ways:

- **Against the source.** The live graph was turned back into the seven case documents and compared with them leaf by leaf. Nothing
  was invented and nothing was lost. Two kinds of source statement are deliberately not carried; they are listed below.
- **Against the standard's own rules.** Each violation class the standard's SHACL shapes were proven to catch is a refusal of this
  forge, each seen refusing a faulted copy of the corpus (table below). The SHACL file itself is not read here; it stays the
  independent oracle.

| | |
|---|---|
| standard | EDUcore Enhanced Cockburn Use Cases (bundle `usecase`, `_source` `UseCase`, family `UseCase`, kind `useCaseCorpus`) |
| source | `assets/standardSourceData/01/`: `cases/*.json` (7), `formats/v011-schema.json`, `resolutionRegistry.json`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | the published standard, `https://genericwhite.com/26/educore/useCaseV11/` |
| version | release `1.0` (the root `version`, from `standardSourceLocation`); every case is written to format `0.11`, read from the schema `$id` |
| graph | scratch graphs `DEV_gb_materialize_59409_2`, `DEV_gb_materialize_66853_2` (stage-on, unvectorised) and `DEV_gb_materialize_77300_2` (vectorised), built 2026-10-30 and disposed by name |
| build | recipe `recipes/usecaseOnlyRoundTrip.recipe.jsonc`. `--vectorize=false` standardBase block **`77ca92ef0e4b83a8a1ba347cf0daa3d076d86215eb1f748d3560d3f6058028a7`** (measured twice, two stores, identical; manifest `efbbef53…05d3bd`). Vectorised standardBase block **`c457ab5539d6624f2cdb91de12ded2654fd6be123f593894db4b831059488c6e`** (manifest `1cb1f059…44e3a2`) |
| certification | `graphBuilder -goldEvalCheck`: **PASS** (1 declared validator, inventedTotal 0; conservation 1 of 1 member; no bridge, no judged edge) |
| spend | $0.0004, embedding only (158 new vectors of 162 texts, 4 already cached); judge $0 |
| commit | branch `uc/build` (useCaseForge-102926 Phase 1) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the standard | DmeStandardRoot | `UcRoot` | 1 |
| a case document | DmeUseCase | `UcUseCase` | 7 |
| a user story (17 with an identifier, 38 anonymous) | DmeUserStory | `UcUserStory` | 55 |
| an actor or interested party | DmeActor | `UcActor` | 21 |
| a condition, assumed or guaranteed | DmeCondition | `UcCondition` | 30 |
| a triggering event | DmeEvent | `UcEvent` | 5 |
| a value driver | DmeValueDriver | `UcValueDriver` | 7 |
| a subject or declared constituent | DmeSubject | `UcSubject` | 6 |
| a citation of another standard's element (26 CEDS) or of a whole standard (OpenBadges, W3C-VC, W3C-DID) | DmeExternalReference | `UcDataReference` | 29 |
| an orphan element-to-be (7), an intermediate (8), a source artifact (6) | DmeDataReference | `UcDataReference` | 21 |
| a resource | DmeResource | `UcResource` | 9 |

The counts were taken from the JSON first, by a script that shares no code with the forge (`zNotesPlansDocs/useCaseForge-102926/evidence/P0/identityCensus.json`), and the forged graph equals them role for role.

| Edge | Count | | Edge | Count |
|---|---:|---|---|---:|
| `HAS_USE_CASE` (root → case) | 7 | | `HAS_STEP` | 73 |
| `DECLARES_SHARED_NODE` (root → shared node) | 183 | | `INVOKES` | 2 |
| `HAS_ACTOR` | 33 | | `PERFORMED_BY` | 55 |
| `HAS_INTERESTED_PARTY` | 10 | | `CONSUMES` | 66 |
| `HAS_PRIMARY_ACTOR` | 7 | | `PRODUCES` | 16 |
| `TRIGGERED_BY` | 7 | | `HAS_SUBJECT` | 7 |
| `ASSUMES` | 24 | | `HAS_CONSTITUENT` | 3 |
| `GUARANTEES` | 27 | | `COMPRISES` | 34 |
| `ALIGNS_WITH` | 19 | | `GOVERNS` | 2 |
| `HAS_RESOURCE` | 9 | | `REQUIRES` | 25 |
| `CHILD` | 2 | | `REQUIRES_ORPHAN` | 12 |
| `PARENT` | 2 | | `REQUIRES_STANDARD` | 2 |
| `SIBLING` | 8 | | `REQUIRES_ARTIFACT` | 2 |
| `DUPLICATE` | 2 | | `INCLUDES` | 2 |

- **Shared nodes.** A story, actor or condition stated once and reused by reference is one node reached from every case; a second
  inline definition must be identical or the forge refuses it.
- **Citations.** A citation of another standard is a reference node carrying `citedStandard`, `citedIdentifier` (verbatim),
  `citedStableId` (the expansion the standard's own registry gives) and `resolutionAnchor` (`graph` or `document`). The forge
  resolves nothing; the declared bridge (`bridges/usecaseBridging.js`) draws the edge to the cited node.
- **Derived, from closed rules:** a step's `position` (the integer prefix of `codedNotation`), its `derivedPrerequisiteListJson` (the
  steps of the same case that produce what it consumes), and the inverse of a declared `child`, `parent`, `sibling` or `duplicate`
  where the inverse is not itself declared (`edgeOrigin derivedInverse`).
- **Identity.** `README_identityRules.md`.

## The counts

The round trip compared all 1,637 leaves of the seven documents with the documents rebuilt from the graph: **inventedTotal 0,
lostTotal 0**. Order, ref-versus-inline and every optional field are statements, so a reordered, re-referenced or dropped field
turns it red. Declared omissions, 7 in all: the resolution registry's 6 top-level entries (applied as every reference's
`citedStableId` and `resolutionAnchor`, not carried as a table) and the 1 format schema (applied as validation).

## The integrity refusals, and the SHACL class each restates

| Forge refusal (by name) | v011-graph-validation.md violation class | Twin (in `test/test-usecaseForge.js`) |
|---|---|---|
| `duplicate name` | duplicate name (Name uniqueness) | two cases given one longName |
| `hierarchy cycle` | hierarchy cycle | two cases each the other's child |
| `unclaimed serves` | unclaimed serves (Alignment rolls up) | a story serving a driver its case does not align with |
| `identifier conflict` | identifier conflict (Dedup by identifier) | a condition identifier defined twice, differently |
| `ascending invocation` | ascending invocation | an invoked case raised to the caller's level |
| `empty step` | empty step | a step's story removed |
| `unresolvable branch point` | unresolvable branch point | a deviation branching from a step that does not exist |
| `non-extending deviation notation` | non-extending deviation notation | `7a` branching from `6` |
| `artifact-only grounding` | artifact-only grounding (Data-grounding) | a case whose only data is a source artifact |

Each twin was seen refused by name, and seen accepted (RED) when that refusal is disabled in a module double. The forge also refuses a
dangling ref, an invocation that resolves nowhere or cycles, a primary actor or story actor outside the case's cast, an intermediate
consumed but never produced in its case, a duplicate `codedNotation`, an unresolved `dependsOn`, a dependency cycle, a numbering that
is not a linearization, a scope in its object form, and an empty list. At load, a document that fails its format's schema is refused
naming the file and JSON pointer, and a case naming a format the snapshot holds no schema for is refused by name.

## Known problems

- **An empty list cannot be carried.** The round trip cannot tell `[]` from an absent field, so the loader refuses one by name.
  None occurs in snapshot 01.
- **No object-form scope.** A scope written as an object or a `ref` is refused (no Scope node in release 1.0's vocabulary); all
  seven scopes are strings.
- **An anonymous node's id is positional.** Reordering a file or renumbering a step moves it (`README_identityRules.md`).
- **The v0.11 schema forbids `formatVersion`.** A case cannot state its own format version until a later format admits it
  (`README_ERRATA.md` E1).

## How to re-run

```
node --max-old-space-size=8000 apps/graph-builder/graphBuilder.js -build --recipePath=recipes/usecaseOnlyRoundTrip.recipe.jsonc \
  --standardsDatabaseFilePath=<new store> --createStore=true --vectorize=false --embeddingCacheFilePath=false \
  --judgmentCacheFilePath=false --matchForensicsDirPath=false --buildLogsDirPath=<dir> < /dev/null
node apps/graph-builder/graphBuilder.js -goldEvalCheck --buildLogDirPath=<the run dir> --standardsDatabaseFilePath=<store> --manifestRefId=<manifest> < /dev/null
node forges/usecase/test/test-usecaseForge.js
```
