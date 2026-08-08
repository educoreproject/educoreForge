# Validation certificate — CEDS

**This is not a victory lap. Its job is to let you decide how far to trust this graph, which means the
limits below carry the same weight as the results above them.**

One of four, written to the same five headings so the four can be read side by side:
`forges/{ceds,edfi,sif,pesc260805}/README_ValidationCertificate.md`.

**READ THIS ALONGSIDE `README_roundTripContract.md`, WHICH IT DOES NOT REPLACE.** That document
describes the CONTRACT — what "faithful" means for CEDS and why. This one reports a RUN.

---

## 1. WHAT WAS VALIDATED

| | |
|---|---|
| **standard** | CEDS **14.0.0.0**, read from `owl:versionInfo` in the ontology rather than from a filename |
| **corpus** | `forges/ceds/assets/standardSourceData/01/CEDS-Ontology.rdf` |
| **recipe** | `recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc` — `roundTripStage: true`, `hubs: []`, `bridges: []` |
| **run** | `system/dataStores/buildLogs/fourWithNewPescRoundTripNoBridges_20260808-001444/` |
| **date** | 2026-08-07, session VIOLET_STONE |
| **commit** | branch `architecture-improvement`; the recipe is committed at `a0a4a90` |
| **graph** | `DEV_FourWithNewPesc` (built as `DEV_gb_materialize_82136_5`, renamed) |

```bash
docker inspect DEV_FourWithNewPesc --format \
  '{{range $p,$c := .NetworkSettings.Ports}}{{if eq $p "7687/tcp"}}{{(index $c 0).HostPort}}{{end}}{{end}}'
```

**Resolve the port from the container, never from this document.** On the evening this ran, one bolt
port served three different graphs in a few hours.

**THIS IS A FOUR-STANDARD GRAPH AND CEDS IS ONE ISLAND IN IT.** 100,979 nodes total —
**CEDS 25,202**, SIF 27,069, PESC260805 42,372, EdFi 6,336 — with **zero cross-standard edges** by
design. The recipe carries no hubs and no bridges.

**AND IT IS CEDS *BASE* ONLY. THERE IS NO HUB IN THIS GRAPH.** Queried through the DME:
`MATCH (n) WHERE n:HubReference OR n:HubDefinition RETURN count(n)` returns **zero rows**. A build
that carries the hub holds ~94,602 additional cards and roughly 119,805 CEDS nodes; this one holds
25,202. **Any statement about hub completeness is out of scope for this certificate**, and the
Layer-2 proof lives in the hub gate suite, not here.

---

## 2. WHAT THE VALIDATOR PROVES

```
roundTripClean ..... true
reproduced ......... 239,761
INVENTED ........... 0
LOST ............... 0
contentGap ......... 0
explicitlyOmitted .. 0
```

**Every statement CEDS makes, and no statement CEDS does not make.** The manifest of exclusions is
empty — zero loss means zero, with nothing argued at the margin.

**The mechanism.** The compiler reads the materialized graph, scoped `_source='CEDS'`, and writes it
back out as RDF/XML. Both that emission and the source ontology are reduced by
`lib/roundTripCanonical.js` to canonical statement sets, and compared by set membership.

### INVENTED > 0 FAILS A BUILD. LOST > 0 IS TOLERATED.

**An invented statement is a lie the graph tells. A lost statement is a truth it fails to tell.**

A gap is a coverage problem and a work order. A fabrication is an assertion about CEDS that CEDS never
made, and no amount of coverage elsewhere excuses one — so invention fails unconditionally while loss
is logged as the enrichment meter.

**No percentage participates in acceptance.** A tampered emission carrying four fabricated statements
still reported 71.936% fidelity, proven live during an audit. Acceptance is counts.

### The gate

```
graphBuilder: [goldEvalCheck] PASS — 4 declared validator(s) ran with inventedTotal=0     exit 0
```

---

## 3. WHAT IT DOES NOT PROVE

> ⚠️ **THE QUALIFICATIONS IN THIS SECTION ARE MINE, NOT THE BUNDLE'S.**
>
> **This bundle declares no `semanticValidationLimit`.** The builder's own `-goldEvalCheck` payload
> says so in as many words: *"NONE DECLARED BY THIS BUNDLE. Its verdict carries no
> semanticValidationLimit, so what this round-trip does and does not model is UNSTATED — read the
> validator before treating lostTotal as a measure of fidelity."*
>
> **So I read the validator.** Everything below was derived from
> `forges/ceds/lib/roundTripCanonical.js` on **2026-08-07** and is cited to file and line. **A derived
> qualification is far more useful than a bare zero and far less trustworthy than a declared one: it
> can drift from the code the moment someone edits the module, and nothing will notice.**
>
> **RECOMMENDED (not implemented — outside this pass's authorization): this bundle should declare a
> `semanticValidationLimit` in its verdict, the way `pesc260805` now does**, so the qualification
> travels with the number into every payload that restates it.

**CEDS is unusually well served here**, because the canonicalizer documents its own rulings in a
header comment. What follows is that header, verified against the code beneath it.

### The comparison is SEMANTIC. Four things cannot register as differences.

⟪design ruling, 2026-08-02⟫ *whitespace, attribute order, element order and prefix choice MUST NOT
count as differences; a missing or extra STATEMENT MUST.*

- **LITERAL WHITESPACE IS NORMALIZED** — trim, then every internal run collapsed to one space
  (`roundTripCanonical.js:65`), applied identically to both sides.
- **PREFIXES ARE EXPANDED** through the document's own `xmlns` declarations.
- **ORDER IS DISCARDED.** The result is a SET keyed by
  `(subject, predicate, objectKind, object, datatype, lang)`.
- **DUPLICATE STATEMENTS COLLAPSE** — and the collapse is **counted and reported** rather than hidden.

### Three modelling decisions a reader would not guess

- **Nested structure is canonicalized by CONTENT, not position.** A nested element with no
  `rdf:about` gets the structural subject `<parent>#/rtStruct/<sha1 of its own content>`. Two
  deliberate consequences: **reordering two `editHistoryEntry` blocks is NOT a difference**, and
  **two byte-identical entries under one parent collapse into one.**
- **This is NOT full RDF blank-node semantics.** An `rdf:parseType="Collection"` is *not* expanded
  into `rdf:first`/`rdf:rest`, because that scaffolding would bury 1,920 real edit-history facts
  under some 6,000 statements of list plumbing. Stated in the module rather than discovered later.
- **The element name of a node element is itself a statement.** `<rdfs:Class rdf:about="X">` asserts
  `(X, rdf:type, rdfs:Class)`; `rdf:Description` asserts nothing and is the one exception.

### THE STORY THAT SHOWS WHY THE BARE ZERO IS NOT ENOUGH

The whitespace normalization above is correct for its job — and it once made a real difference
structurally invisible.

**CEDS writes 62 `&#13;` character references. The emitter wrote raw carriage returns.** XML 1.0
§2.11 *requires* every conformant parser to normalize those away on the next read, so 20 literals
quietly changed. Under strict RDF those are different statements. **Our instrument reported zero,
honestly, under its own definition.** Only a parser sharing no code with ours could see it.

> **A tool cannot audit the assumption it is built on.**

### AND THE INDEPENDENT INSTRUMENT DID NOT RUN IN THIS BUILD

`lib/rdf-independent-check/` (rdflib, applying the RDF/XML spec's own parsing rules) is **not part of
the RT-13 round-trip stage.** It is reached through `graphBuilder -cedsRoundTrip` / `-cedsGates`, and
this run produced **no independent-check artifact for CEDS** — the only bundle in this build that
produced one is `pesc260805`.

**So the zero above rests on a single instrument, and the story immediately above it is precisely the
case where a single instrument was not enough.** Not a defect in the result; a boundary on what this
run establishes. **Run the independent check before treating this as an acceptance.**

### And what is out of scope entirely

**Hub completeness.** The round trip reads **Layer 1 only** — CEDS as CEDS states it. The
`HubReference` matching index is Layer 2, our own invention, and the compiler deliberately ignores it:
emitting one would *invent* a statement CEDS never made. **In this graph there is no Layer 2 at all**
(§1).

**The build-failure path end to end.** The fidelity gate's decision is proven 26 ways and its passing
path has been observed on a real build. **Nobody has yet watched a deliberately broken forge actually
kill a build.** Until someone has, treat the enforcement as implemented-but-unproven — this project's
own standard, applied to its own gate.

---

## 4. KNOWN GAPS AND BACKLOGS

**There is no loss backlog for CEDS. `lost 0`, `contentGap 0`, `explicitlyOmitted 0`, and the manifest
of exclusions is empty.** That is a real and unusual result and it is the reason CEDS is the hub
standard.

What is open is not loss:

| item | status |
|---|---|
| no declared `semanticValidationLimit` | **open** — §3 is derived by reading code, not declared by the bundle |
| the independent rdflib check | **not run in this build** — separate verb; run before treating this as acceptance |
| gates currently UNMEASURED | **7** — determinism across two forges, the hub-stripped compile, the source-absent compile, and others. **Each is an unasked question, not a suspicion**; each prints the work that would answer it |
| the build-failure path | **implemented, unproven** |
| Layer 2 / hub | **out of scope here, and absent from this graph** |

**Three ways a passing comparison is still not a pass**, and they are worth knowing before quoting any
CEDS gate result: `UNPROVEN` (passed, but nobody has watched it fail); `UNMEASURED` (nobody supplied
the measure — **a failure, never a skip**); and masked, which deliberately does not exist as a state.

---

## 5. HOW TO REPRODUCE IT

**Every command below was run from
`/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge` on 2026-08-07.**

```bash
# the build that produced this certificate (nohup-detached; SIF in the same recipe needs the heap)
jq -nc --arg recipePath "$PWD/recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc" \
       --arg storePath  "<a throwaway>.standardsDatabase.sqlite3" \
  '{switches:{build:true},values:{recipePath:[$recipePath],standardsDatabaseFilePath:[$storePath],vectorize:["false"]}}' \
  | node --max-old-space-size=5510 apps/graph-builder/graphBuilder.js

# the certification gate
jq -nc '{switches:{goldEvalCheck:true},values:{buildLogDirPath:["<the run dir>"]}}' \
  | node apps/graph-builder/graphBuilder.js       # PASS, exit 0

# this standard's verdict
jq '{roundTripClean,reproduced,lostTotal,contentGapTotal,explicitlyOmittedTotal,inventedTotal}' \
  <runDir>/roundTrip/ceds/roundTripVerdict.json
```

**NOT run in this pass, and named rather than omitted** — the per-predicate attribution, the 46-gate
suite, and the independent rdflib check:

```bash
node apps/graph-builder/graphBuilder.js -cedsRoundTrip --containerName=<name>
node apps/graph-builder/graphBuilder.js -cedsGates --containerName=<name> --reportJsonPath=<the .json>
```

---

**Written 2026-08-07 by session VIOLET_STONE, from a build it ran and artifacts it opened. Section 3
is derived from the validator's source and is labelled as such throughout.**
