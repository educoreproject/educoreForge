# The CEDS forge bundle

**What it does:** reads `CEDS-Ontology.rdf` and produces the CEDS half of an educoreForge graph.

**What "correct" means here:** the graph reproduces the source ontology **exactly** — every
statement CEDS makes, and no statement CEDS does not make.

```
statements in source .......  239,761
MATCHED ....................  239,761
LOST .......................        0
INVENTED ...................        0
```

CEDS version **14.0.0.0**, read from `owl:versionInfo` in the ontology rather than from a
filename, so the stamped version cannot drift from the file.

---

## Run it

```bash
cd .../educoreForge/system/code/educoreForge

node --max-old-space-size=24576 apps/graph-builder/graphBuilder.js -build \
  --recipePath=recipes/cedsHub.recipe.jsonc \
  --standardsDatabaseFilePath=<somewhere>/myTest.standardsDatabase.sqlite
```

The heap flag is required for a vectorized hub build (94,602 embedded cards; an in-code
heap gate refuses a load the process cannot hold and names this flag as the remedy). The
first vectorized run embeds every card once (~7M tokens); every later run is served from
the shared vector cache. It forges, loads a fresh Docker graph, **and checks its own
fidelity.**
Watch for:

```
[materialize] -> bolt://localhost:7819
[fidelity] source 239761, matched 239761, LOST 0, INVENTED 0
[fidelity] PASSED -- zero lost, zero invented
```

**If those are not zero the build stops and exits nonzero.** Nobody has to remember to check.
The last lines print the container name — that is your graph.

### Looking closer

```bash
# per-predicate attribution: what is missing and where
node apps/graph-builder/graphBuilder.js -cedsRoundTrip --containerName=<name>

# the 46-gate suite (add --sourcePath/--emittedPath to include the independent rdflib check)
node apps/graph-builder/graphBuilder.js -cedsGates --containerName=<name> \
  --reportJsonPath=<the .json the round trip wrote>
```

---

## The HubReference card (Layer 2)

Forged by `lib/cedsHubForge.js` (2026-08, hubReimplementation campaign). It replaced the
retired `referenceSubgraph.js`, which was deleted at the campaign's closeout after the new
module proved signature-for-signature parity with it over the same base. One card = one
addressable idea = one (domain · property [· value] [· qualifier]) tuple — **one card per
declared domain** — and the card is self-sufficient: everything needed to embed, render,
and judge it rides on the card. Five field groups:

| group | carries |
|---|---|
| **ADDRESS** | ids only — hubName, hubVersion, referenceTier, domainId, propertyKey, exactly one range field (rangeDatatype \| rangeClassId \| rangeOptionSetId), valueKey (value tier), qualifierKeys[]. Prose never enters `addressSignature`: a CEDS wording fix churns zero ids |
| **IDENTITY** | `addressSignature` · `uri` = `https://w3id.org/EDUcore/CEDStandards/hub/<version>/<addressSignature>`, minted from the HubDefinition's `namespace` (the one place the root lives) · `stableId` (= uri) · `canonicalKey` (P…/OV…) · `name` |
| **MEANING** | every tuple slot's name AND prose: domainName/domainDefinition, propertyName/propertyDefinition (+ notation, dataType, textFormat as CEDS has them), range prose per shape, value prose, qualifierNames[] parallel to qualifierKeys[]. Absent stays absent — never `''` |
| **PROVENANCE** | anchorUri, domainUri, propertyUri, rangeUri, valueUri — the CEDS term URIs of the slots |
| **DERIVED** | `embedText` (the composed retrieval string, stored exactly as embedded) · `embedding` (1024-dim) · `embeddingModelVersion` |

Vectors ride a **sidecar**, not the block text: the block carries an `embeddingRef` plus a
per-node `embedSourceProperty` declaration (`embedText` on cards), and the raw vectors live
in the per-standard store `dataStores/vectorStores/CEDS.sqlite3` (shared between producers
by design — content-addressed, verify-on-read, first-write-wins). Materialize/replay stamps
the vectors back onto the graph nodes, so readers see `embedding` as an ordinary property —
and block identity is embedding-excluded by design. A deployment that transports the
standardsDatabase must transport `CEDS.sqlite3` beside it.

Exactly one `HubDefinition` card anchors the hub (namespace authority, slotProfile,
sourceProvenance). Every card's `IN_HUB` edge targets it, and the five `HAS_CEDS_*`
decomposition edges land on the exact base nodes the card's address names.

The proof lives in `test/test-cedsHubForge.js` — 13 card-local gates declared as data in
`gates/hubGates.jsonc`, every one with a fault-injection twin observed red in the suite's
own output — plus the build-scoped gates (vectors present, two-forge determinism) in
`test/test-cedsHubBuildGates.js`.

---

## The other documents, and when you need them

| read this | when |
|---|---|
| **README_roundTripContract.md** | before changing anything about what "faithful" means, or before believing a fidelity number |
| **README_addingAField.md** | before carrying a new predicate. **Four lists must agree; missing one fails silently.** Read it first — it costs an afternoon otherwise |
| **README_identityRules.md** | before touching ids. Some are the source's, some are rewritten, some are derived, some are minted — and one of them is load-bearing in a way that is easy to destroy |
| **README_sourceExceptions.md** | when CEDS does something that looks like a bug. It probably isn't; there are eleven documented cases |

---

## What this bundle does NOT prove

**Hub completeness.** The round trip reads **Layer 1 only** — CEDS as CEDS states it. The
`HubReference` matching index is Layer 2, our own invention, and the compiler deliberately
ignores it: emitting a HubReference into RDF would *invent* a statement CEDS never made.

So "zero lost, zero invented" is a claim about the **representation**, not about the
**matching index**. The matching index carries its own proof instead: the hub gate suite
derives the expected tuple population from the base and asserts closure — 2,750 property
tuples + 91,825 value triples + 27 qualified tuples = **94,602 cards**, one per declared
domain. (The 2026-08-02 measurement of "roughly 400 declared contexts have no card" was
closed by the hubReimplementation campaign.)

**The build-failure path end to end.** The fidelity gate's decision is proven 26 ways
(`lib/ceds-fidelity-judgment/test/`), and its passing path has been observed on a real build.
Nobody has yet watched a deliberately broken forge actually kill a build. Until someone has,
treat the enforcement as implemented-but-unproven — that is this project's own standard
applied to its own gate.
