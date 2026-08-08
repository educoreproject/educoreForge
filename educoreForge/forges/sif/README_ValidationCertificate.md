# Validation certificate — SIF

**This is not a victory lap. Its job is to let you decide how far to trust this graph, which means the
limits below carry the same weight as the results above them.**

One of four, written to the same five headings so the four can be read side by side:
`forges/{ceds,edfi,sif,pesc260805}/README_ValidationCertificate.md`.

**READ THIS ALONGSIDE `README_ERRATA.md`, WHICH IT DOES NOT REPLACE.** That document records what we
believe is true about **SIF's own published artifacts** — someone else's work, held to a different
standard of care. This one reports a run of **our** instrument. §3 below leans on it, because for SIF
the two questions are unusually entangled.

---

## 1. WHAT WAS VALIDATED

| | |
|---|---|
| **standard** | SIF NA **4.3**, Access 4 Learning (release 2022-10-27); the graph stamps `version 1.0` |
| **corpus** | `forges/sif/assets/standardSourceData/01/ImplementationSpecification_031326.tsv` — a flattened export of the SIF NA Implementation Specification spreadsheet |
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

**THIS IS A FOUR-STANDARD GRAPH AND SIF IS ONE ISLAND IN IT.** 100,979 nodes total — **SIF 27,069**,
CEDS 25,202, PESC260805 42,372, EdFi 6,336 — with **zero cross-standard edges** by design. SIF carries
no mapping content here.

**THE SOURCE OF TRUTH IS THE SPREADSHEET, NOT THE XSD, AND THAT IS A RULING.** ⟪R-SF-6⟫ TQ's testimony
establishes that the spreadsheet is canonical and every published artifact is generated from it by a
tool John Lovell wrote. **That ruling is load-bearing for everything in §3.**

---

## 2. WHAT THE VALIDATOR PROVES

```
roundTripClean ..... true
reproduced ......... 97,888
INVENTED ........... 0
LOST ............... 0
contentGap ......... 0
explicitlyOmitted .. 0
orderMismatches .... 0
```

**The mechanism.** `lib/roundTripSifCanonical.js` mints a canonical statement set from **either**
side — `statementsFromTsvText` reads the committed TSV, `statementsFromSifGraph` reads the
materialized-graph payload — and the two sets are compared. Both minters live in one module so the
identity rules are shared code, **but the source minter never sees the graph and the graph minter
never opens a file.**

**AND NEITHER PATH TOUCHES THE FORGE'S OWN `lib/parser.js`.** That is deliberate: *a validator that
parses with the forge's parser can only prove the forge agrees with itself.*

### ORDER IS PART OF STATEMENT IDENTITY — which makes this zero stronger than most

⟪R-SF-1, TQ⟫ *"Element sequence is important."* Mechanism ⟪R-SF-7⟫: **all-pairs precedence** — for
every ordered pair X-before-Y in a sibling group, one `precedesInGroup` statement.

The calculus that buys:

- **A SWAP flips exactly the affected pairs** — the source pair LOST and the reversed pair INVENTED,
  naming the group and both members. The strongest legible red.
- **A MISSING member degrades to located LOST only** — never a false INVENTED. **The hard line
  (`invented = 0`) is never spent to express loss.**
- **`reproduced` therefore means relative order preserved**, not merely the same set of facts.

`orderMismatches 0` is a separate reported figure and it is also zero.

### INVENTED > 0 FAILS A BUILD. LOST > 0 IS TOLERATED.

**An invented statement is a lie the graph tells. A lost statement is a truth it fails to tell.** No
amount of coverage excuses a fabrication, so invention fails unconditionally; loss is logged as the
enrichment meter.

### The gate

```
graphBuilder: [goldEvalCheck] PASS — 4 declared validator(s) ran with inventedTotal=0     exit 0
```

---

## 3. WHAT IT DOES NOT PROVE

> ⚠️ **THE QUALIFICATIONS IN THIS SECTION ARE MINE, NOT THE BUNDLE'S.**
>
> **This bundle declares no `semanticValidationLimit`.** The builder's `-goldEvalCheck` payload says
> so: *"NONE DECLARED BY THIS BUNDLE… what this round-trip does and does not model is UNSTATED — read
> the validator before treating lostTotal as a measure of fidelity."*
>
> **So I read the validator.** Everything below was derived from
> `forges/sif/lib/roundTripSifCanonical.js` and `forges/sif/README_ERRATA.md` on **2026-08-07**. **A
> derived qualification is far more useful than a bare zero and far less trustworthy than a declared
> one** — it drifts silently the moment someone edits the module.
>
> **RECOMMENDED (not implemented — outside this pass's authorization): this bundle should declare a
> `semanticValidationLimit` in its verdict, the way `pesc260805` now does.**

### THE ONE THAT MATTERS MOST: A PERFECT ROUND TRIP AGAINST A SOURCE THAT IS ITSELF INCOMPLETE

**`lost 0` says the graph carries everything the TSV states. It says nothing about what the TSV
omits — and the TSV demonstrably omits things.**

`README_ERRATA.md` entry **S-1**, verified against the published bytes: **the flattened export omits
container-element rows, and their `Characteristics` with them.** The XSD annotates every element with
its spreadsheet `Characteristics` value; the value `CR` appears **twice in the XSD and zero times in
the export**. Both occurrences are the element `ValidMark`. The export carries rows for ValidMark's
*children* but **no row for the `ValidMark` container itself** — so its `CR` characteristic, and with
it **the fact that ValidMark REPEATS (`maxOccurs="unbounded"`), is unavailable to any consumer reading
the spreadsheet.**

**That fact is not in this graph, and `lostTotal 0` is still correct.** The round trip measures
fidelity to the ingested snapshot; it cannot see what was never in it. The errata itself is careful
here — it records as **verified** the counts, the two XSD sites, the three child rows and the absence
of a ValidMark row, and as **inferred, not verified**, that the pattern generalizes to other
intermediate containers. **A systematic XSD-inventory-versus-export comparison would settle it and has
not been run.**

### The modelling boundary of the instrument itself

Derived from `roundTripSifCanonical.js`:

- **ORDER SEMANTICS ARE DOCUMENT-ORDER-ONLY** ⟪R-SF-8⟫. The source states row order and nothing else.
  **The instrument never consults the published XSD for compositor facts** — normativity, if ever
  wanted, is forge-side enrichment through a ruled, checksummed input, never an instrument
  side-channel.
- **ABSOLUTE ORDINALS ARE DELIBERATELY NOT STATEMENTS.** Rank is derivable as a predecessor count.
  Rival forms (ordinal-in-identity, group-level tuple) were considered and rejected on the record.
- **ABSENT IS ABSENT.** An empty cell mints **no** statement (RT-2 symmetry) — so "this field has no
  description" and "this field's description was lost" are not distinguished by the presence of a
  statement. They are distinguished only by the source having no cell there.
- **CELL VALUES ARE TRIMMED.** Leading and trailing whitespace in a cell is not a statement.
- **THE STATEMENT VOCABULARY IS THE COLUMN SET.** One predicate per source column — `fieldName`,
  `fieldMandatory`, `fieldCharacteristics`, `fieldType`, `fieldDescription`, `fieldCedsId`,
  `fieldFormat` — **so anything the spreadsheet does not have a column for is not modelled at all.**
  §2's choice-group observation (errata **S-2**) is exactly this: the export cannot express
  choice-group membership, and `C` plus the mandatory flag is the only trace.
- **GRAMMAR YES, DATA NO** (RT-5). The module knows the TSV's grammar — the `<TableName>: Table N`
  section delimiter whose numeric suffix is export pagination apparatus and is **recognized but not
  minted as a statement**, the literal 8-column header row, cell-trim, the xpath grammar — and
  **contains no source value.** Every object comes from the input handed in.

### What is out of scope entirely

**Mapping and cross-standard content.** SIF is base-only in this graph — no CEDS hub, no bridges,
**zero cross-standard edges by design.** Nothing here speaks to how well SIF maps to anything.

---

## 4. KNOWN GAPS AND BACKLOGS

**There is no loss backlog for SIF in this run. `lost 0`, `contentGap 0`, `explicitlyOmitted 0`,
`orderMismatches 0`.**

What is open is not loss:

| item | status |
|---|---|
| no declared `semanticValidationLimit` | **open** — §3 is derived by reading code, not declared |
| **errata S-1 — the export omits container rows** | **OPEN. Verified. Not yet reported to A4L.** `CR` × 2 in the XSD, × 0 in the export; `ValidMark` has no row of its own |
| whether S-1 generalizes to other containers | **INFERRED, NOT VERIFIED.** The settling comparison has not been run |
| errata S-2 — choice-group membership inexpressible in the export | **OPEN as an OBSERVATION, not a defect.** Verified |
| mapping / bridge content | **absent by design in this graph** |

**The errata's own discipline is worth honoring when you add to it:** evidence first and
characterization second; state what you **verified** versus what you **infer**; a retracted entry
stays, marked RETRACTED with the reason; record the disposition — reported to whom, when, and what
came back. **A finding relayed to a standards author with an inference dressed as a fact costs us the
relationship, not just the point.**

---

## 5. HOW TO REPRODUCE IT

**Every command below was run from
`/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge` on 2026-08-07.**

```bash
# the build that produced this certificate — SIF IS THE FLEET'S LARGEST CORPUS AND ITS BUILD
# REFUSES BY NAME AT DEFAULT HEAP, naming 5510 as the remedy. Run nohup-detached.
jq -nc --arg recipePath "$PWD/recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc" \
       --arg storePath  "<a throwaway>.standardsDatabase.sqlite3" \
  '{switches:{build:true},values:{recipePath:[$recipePath],standardsDatabaseFilePath:[$storePath],vectorize:["false"]}}' \
  | node --max-old-space-size=5510 apps/graph-builder/graphBuilder.js

# the certification gate
jq -nc '{switches:{goldEvalCheck:true},values:{buildLogDirPath:["<the run dir>"]}}' \
  | node apps/graph-builder/graphBuilder.js       # PASS, exit 0

# this standard's verdict
jq '{roundTripClean,reproduced,lostTotal,contentGapTotal,explicitlyOmittedTotal,inventedTotal,orderMismatches}' \
  <runDir>/roundTrip/sif/roundTripVerdict.json
```

**The SIF gate suite and its fault-injection twins were NOT run in this pass** — named rather than
omitted. They live in `forges/sif/test/`.

---

**Written 2026-08-07 by session VIOLET_STONE, from a build it ran and artifacts it opened. Section 3
is derived from the validator's source and from `README_ERRATA.md`, and is labelled as such
throughout.**
