# Validation certificate — CEDS

## Summary

**The graph is a faithful re-statement of the CEDS ontology.** Everything the ontology says, the graph
carries. Nothing the graph carries was invented. That was checked two independent ways — our own
comparator, and a third-party RDF implementation sharing no code with it — and they agree.
**This round trip validation supports the judgement that this graph is complete and usable.**

| | |
|---|---|
| standard | CEDS 14.0.0.0, read from `owl:versionInfo` in the ontology rather than from a filename |
| corpus | `forges/ceds/assets/standardSourceData/01/CEDS-Ontology.rdf` |
| recipe | `recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc` — `roundTripStage: true`, `hubs: []`, `bridges: []` |
| run | `fourWithNewPescRoundTripNoBridges_20260808-001444`, 2026-08-07 |
| commit | branch `architecture-improvement`; the recipe is committed at `a0a4a90` |
| graph | `DEV_FourWithNewPesc` — resolve the bolt port from the container, never from a document |

**What the graph holds, and what it deliberately does not.** The round trip reads Layer 1 only — CEDS as
CEDS states it.

| layer | what it is | in this graph? | in the round trip? |
|---|---|---|---|
| **Layer 1 — base** | the ontology's own statements: classes, properties, elements, option sets, edit history | yes, 25,202 nodes | **yes, and only this** |
| **Layer 2 — hub** | the `HubReference` matching index, our own invention rather than something CEDS published | **no — zero rows** | no |

A build that carries the hub holds roughly 119,805 CEDS nodes and some 94,602 additional cards; this
one holds 25,202. **Emitting a Layer 2 node would invent a statement CEDS never made**, which is why
the compiler ignores that layer by design. Any claim about hub completeness is out of scope here and
belongs to the hub gate suite.

This is also one island in a four-standard graph — 100,979 nodes total, CEDS 25,202, SIF 27,069,
PESC260805 42,372, Ed-Fi 6,336 — with zero cross-standard edges by design. The recipe carries no
hubs and no bridges, so nothing here speaks to how CEDS maps to anything.

---

## The counts

```
statements reproduced .......... 239,761
invented ....................... 0
lost ........................... 0
  contentGap ................... 0        real loss — counted in lost
  explicitlyOmitted ............ 0        deliberate non-carriage — not counted in lost
```

**explicitlyOmitted is zero because the manifest of exclusions is empty.** Nothing was argued at the
margin; there is no list of things the graph deliberately declines to carry. Zero loss means zero.

**Invention fails a build. Loss does not.** An invented statement is a claim the source never made; a
lost one is a claim the graph fails to repeat. No amount of coverage excuses a fabrication, so
invention is unconditional failure while loss is logged as the enrichment meter. No percentage
participates in acceptance — a tampered emission carrying four fabricated statements once reported
71.936% fidelity.

---

## Round Trip Validation

Two validation processes ran against the same build, and they used different code from end to end.

**The textual pass compares statements.** The compiler reads the materialized graph scoped
`_source='CEDS'` and writes it back out as RDF/XML. Both that emission and the source ontology are
reduced by `lib/roundTripCanonical.js` to canonical statement sets and compared by set membership.
This is where 239,761 / 0 / 0 (reproduced / missed / invented) comes from.

**The independent pass uses somebody else's RDF implementation.** `lib/rdf-independent-check/`
(rdflib 7.6.0), applying the RDF/XML specification's own parsing rules and sharing no code with our
compiler or canonicalizer, read the source ontology and the emitted file directly. Strict triple-set
comparison: **243,601 triples on each side, 0 in source but not emitted, 0 in emitted but not source,
identical.**

**The two instruments differ by exactly one documented decision, and by nothing else.** rdflib counts
243,601 where our canonicalizer counts 239,761. The difference of 3,840 is two triples — `rdf:first`
and `rdf:rest` — for each of the 1,920 `editHistoryEntry` Collection members that
`roundTripCanonical.js` documents itself as deliberately not expanding. **That is corroboration
rather than mere agreement:** the entire gap between the two instruments is accounted for by a ruling
that was written down in advance. *(The arithmetic is verified; the per-member mechanism is inferred
from the documented ruling.)*

**The zero was not accepted until the instrument had been watched failing.** A negative control was
built by taking the emitted artifact and replacing all 62 `&#13;` character references with raw
carriage returns, synthesizing an earlier emitter behaviour. The check went red in the predicted way —
strict 20/20 differing, identical false, with `whitespaceNormalized` 0/0, the module's documented
signature for *every difference is inside literal text*. A gate never observed failing is unproven;
this one has been observed.

**That 20-literal case is why the second instrument exists, and it is history rather than a live
fault.** CEDS writes 62 `&#13;` character references; an earlier emitter wrote raw carriage returns,
which XML 1.0 §2.11 requires every conformant parser to normalize away on the next read, so 20
literals changed while our comparator honestly reported zero under its own definition. **It was fixed
at commit `233017a` on 2026-08-02**, five days before this build emitted, and a byte census of the
emitted artifact confirms 62 character references and zero raw `0x0D` bytes, matching the source.
A tool cannot audit the assumption it is built on — hence rdflib.

**A gate proves the check actually ran.** `goldEvalCheck` reports PASS for this build.

The textual pass ran inside the build on 2026-08-07.
The independent pass was run separately on 2026-08-09, against this run's own persisted artifacts —
the same source ontology and the same emitted file, requiring no rebuild and no graph access.

---

## Known issues

Ordered by consequence. Full treatment of each in `README_ValidationDetail.md`.

1. **Blank nodes are not distinguished, by either instrument.** `rdfTripleCompare.py` keys every blank
   node as the literal string `_:BNODE`, disclosed in its own docstring as the one place it is
   deliberately not strict, and our canonicalizer subjects nested structure by content hash. CEDS
   carries 1,920 blank-node `editHistoryEntry` subjects, so **re-parenting an edit-history entry onto
   a different parent would be invisible to both instruments.** It is a smaller blind spot than the
   one the second instrument was built to cover, and it is disclosed rather than silent — but two
   instruments agreeing does not mean nothing can hide.

2. **This bundle declared no `semanticValidationLimit` at the time of this run**, so what the round
   trip does and does not model does not travel with the number into payloads that restate it. The
   qualifications in this certificate are therefore *derived* by reading `roundTripCanonical.js`, and
   a derived qualification drifts the moment someone edits the module. **The absence is recorded
   rather than merely missing:** this run's own stage summary carries the literal marker *"NONE
   DECLARED BY THIS BUNDLE"*, so a reader cannot mistake it for evidence that failed to be collected.

3. **Seven gates are UNMEASURED** — determinism across two forges, the hub-stripped compile, the
   source-absent compile, and others. In this project's taxonomy **unmeasured is a failure, never a
   skip**: it means nobody supplied the measure. Each is an unasked question rather than a suspicion,
   and each prints the work that would answer it.

4. **The build-failure path is implemented but unproven.** The fidelity gate's decision is proven 26
   ways and its passing path has been observed on a real build, but nobody has yet watched a
   deliberately broken forge actually kill a build. Treat the enforcement as implemented-but-unproven
   — this project's own standard, applied to its own gate.

5. **Four modelling decisions cannot register as differences**, by design ruling: literal whitespace
   is normalized, prefixes are expanded, statement order is discarded, and duplicate statements
   collapse. The collapse is counted and reported rather than hidden. A change in any of those
   dimensions is semantically null and correctly invisible.

6. **`rdf:parseType="Collection"` is not expanded** into `rdf:first`/`rdf:rest`. This is stated in the
   module rather than discovered later, and it is the entire difference between the two instruments'
   counts. Expanding it would bury 1,920 real edit-history facts under some 6,000 statements of list
   plumbing.

7. **Hub completeness is out of scope and absent from this graph** — see Summary. Nothing here speaks
   to Layer 2.

---

## Provenance

Publisher: the US Department of Education CEDS programme, `https://ceds.ed.gov`.

**The exact ontology download URL was never captured, and no acquisition recipe has been invented to
fill the hole.** `standardSourceLocation` records `upstreamUrl: unknown`, with the bytes copied on
2026-05-28 from a local `sourceData/forge-ceds-rdf` directory. The sibling snapshots for SIF, PESC and
Ed-Fi each carry a real reacquisition procedure; this one cannot, because nobody wrote down where the
bytes came from. A provenance file that overstates what it knows is worse than the absence it
replaces.

**The `SHA256SUMS` beside the ontology is a tamper detector, not evidence of origin.** It was minted
on 2026-08-04, long after the bytes arrived, and records the ontology as it was on that date. It
proves the file has not changed since; it proves nothing about who published it or whether it matches
anything upstream.

**A clone already has the exact file.** `CEDS-Ontology.rdf` is committed and tracked, so there is
nothing to re-fetch. Per doctrine RT-12, a new upstream CEDS release becomes a NEW directory under
`assets/standardSourceData/` whose provenance record *does* capture the download URL, with
`defaultSnapshot` in `forges/ceds/parserDescriptor.ini` flipped deliberately.

---

## For more information

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | the evidence behind every figure above, the derived reading of the validator source, the gate taxonomy, and the commands to reproduce this run |
| `README_roundTripContract.md` | what "faithful" means for CEDS and why — the contract, as distinct from this run of it |
| `system/management/zNotesPlansDocs/FINDINGS-cedsRoundTripIndependence-080926.md` | the independent-check run: method, evidence paths, negative control, and the scope of a future `semanticValidationLimit` declaration |
| `assets/standardSourceData/01/README_PROVENANCE.md` | the corpus record, including what it does not know |
| `forges/README_ValidationCertificateStandard.md` | how this document is meant to be written |

Certificate written 2026-08-07 by session VIOLET_STONE from a build it ran; restructured 2026-08-09 by
session CRYSTAL_ORBIT, which added the independent-check result obtained by session SILVER_DANCE.
Build figures unchanged. Revision history lives in `README_ValidationDetail.md`, not here.
