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

node apps/graph-builder/graphBuilder.js -build \
  --recipePath=recipes/cedsHub.recipe.jsonc \
  --standardsDatabaseFilePath=<somewhere>/myTest.standardsDatabase.sqlite
```

About four minutes. It forges, loads a fresh Docker graph, **and checks its own fidelity.**
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
**matching index**. Measured 2026-08-02: CEDS declares **2,750** domain-tuples across 2,324
properties, and there are **2,351** property-tier hub cards — roughly 400 declared contexts
have no card, with a larger corresponding gap at the value tier. That is a known open item,
not a defect in this bundle, and it is a projection problem: Layer 1 now carries every domain
declaration, so the cards can be derived without re-parsing anything.

**The build-failure path end to end.** The fidelity gate's decision is proven 26 ways
(`lib/ceds-fidelity-judgment/test/`), and its passing path has been observed on a real build.
Nobody has yet watched a deliberately broken forge actually kill a build. Until someone has,
treat the enforcement as implemented-but-unproven — that is this project's own standard
applied to its own gate.
