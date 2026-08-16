# Bridge Documentation — index

Everything about writing and proving a **bridge plugin** (the code that declares how one
standard's elements map onto the CEDS hub, so the Data Model Explorer can show cross-standard
relationships) lives in this directory. It is the sibling of `../README_ForgeDocumentation/` and
is written to FEEL the same: declaration + hooks, a framework that owns everything else, a kit that
is the only door, gates with red twins, and acceptance that is measured rather than asserted.

| file | what it is | read it when |
|---|---|---|
| `README_BridgeCreationOverview.md` | The overview: the matchmaker metaphor, the terms, what a plugin supplies, what the framework does, how a bridge is proven, the real command lines. | First, always. |
| `README_BridgeProfile.md` | The **normative** profile: what a mapping IS — `matchBasis` × `resolution` × SKOS predicate, SSSOM-native, the filter rule, cardinality, conflict, the seven gates. Version in its header. | You need the rule about mappings, not the recipe. |
| `README_BridgeFrameworkSpecification.md` | The **normative** framework specification: the object, the plugin contract (declaration keys, hooks, refusals), the pipeline, the judge component, the decision block and replay, the SSSOM exporter, the registry, the Ed-Fi worked example, the SIF sketch, acceptance, the gate suite with red twins. Version in its header (v1.1.3 = the code at B2 CLEAR). | You are writing a plugin, changing the framework, or reading a gate. |
| `README_MILO_BridgeWorkOrientation.md` | Orientation for a Milo (or any engineer) picking this work up cold: where the truth lives, the acceptance discipline, the frozen commands, what never to touch. | You are the next one to work on bridges. |

A `README_HOWTO_BridgeCreationInstructions.md` (the step-by-step recipe) is written from the first
REAL plugin, the Ed-Fi crosswalk plugin, when it lands (order B3) — a HOWTO written before any real
plugin exists would be prose arithmetic, which is exactly what this discipline refuses.

## The one-paragraph version

A bridge plugin brings a **declaration** (data: which source column or graph property supplies each
hub tuple field — `canonicalKey`, `domainId`, `propertyKey`, `range` — the label→SKOS table, the
subject-identity rule, `matchBasis`, the channels and their columns) and **two hooks**
(`walkSourceAssertions`, `subjectStableIdFor`). The framework in `lib/bridge-framework/` owns
everything else: reading the source and the hub cards, grouping by subject, filtering the cards by
every tuple field the source supplies, classifying zero/one/many/conflict, calling the judge (a
framework component with a debug double — a plugin cannot reach it), freezing a content-addressed
**decision block**, materialising mapping edges through the writer (the kit-only door), exporting
SSSOM, and the census. A bridge is accepted when its per-subject census EQUALS the frozen fixture
for a named graph, every edge carries `matchBasis` + `resolution` + a SKOS predicate, the SSSOM
validates, the seven Profile gates are green with twins observed red, and a plain replay
reproduces the same block id with zero LLM calls.

## Where the code is

- Framework: `lib/bridge-framework/` (23 flat modules; the two bolt files `graphReader.js` /
  `graphWriter.js` are the only ones that touch a real Neo4j; `graphSeamRules.js` is the pure rule
  module they share with the test double).
- Seam face graphBuilder calls: `apps/graph-builder/apps/bridge-maker/bridgeMaker.js` (`run(spec, cb)`
  exactly as `lib/build.js` Phase C calls it; the plugin registry is data built by discovery over
  `forges/<std>/bridges/`).
- Gates: `lib/bridge-framework/test/test-bg*.js` (12 files at v1.1.3; every conjunct has a twin
  that turns it red; `UNMEASURED` is a failure); frozen census fixtures and acceptance commands in
  `lib/bridge-framework/test/acceptance/`; the toy plugins in `lib/bridge-framework/test/fixtures/`.
- Real plugins: `forges/edfi/bridges/` (Ed-Fi crosswalk, order B3), `forges/sif/bridges/` (SIF
  standard-declared cedsId, order B4 — the composability proof: zero framework diff).
- graphBuilder-wide control-flow doctrine: `../DOCTRINE.md`.

## What is NOT here

Process records — plans, briefs, supervisor rulings, adversarial reviews, stand-down holdings, the
DEVLOG — live under `system/management/zNotesPlansDocs/forgeDefinitionV2/` (`PLAN-bridgeSystem-v1.md`,
`RULINGS-supervisor-bridgeFramework.md`, `DEVLOG-bridgeFramework.md`, `reviews/REVIEW-B2-*.md`).
The forge side of the house is `../README_ForgeDocumentation/`.
