# Validation certificate — Toy Standard (fixture)

**The Toy Standard was built from its authored model file. 16 nodes, 17 edges.**
**This graph is complete and usable for what it is: the Forge Framework's hermetic fixture.** Accuracy
was confirmed by round trip validation over the Docker-free graph double: statements from the graph
were compared against the source model. Nothing was missed in the modelled dimensions. Nothing was
invented.

| | |
|---|---|
| standard | Toy Standard 1.2.3 (a synthetic four-role model; no real publisher) |
| source | `assets/standardSourceData/01/toyModel.json` — 2 classes, 5 properties, 2 option sets, 5 values, 1 support note |
| graph | the hermetic double (`roundTripHarness.graphDoubleFrom`) over `forgeToy.js`'s result — no container |
| commit | branch `architecture-improvement`, F3a 2026-08-16 |

---

## Summary — what is in the graph

Every class, property, option set and option value the model states, each with its name, and: class
and property descriptions where the model states them, property `dataType`, option-value `code` and
label, the support note by name. Sibling ORDER of a class's properties is in the graph (`sequenceOrdinal`,
`siblingCount`, `orderSemantics: 'document'`).

**Not present:** any mapping to another standard (a forge emits no cross-standard edge).

---

## The counts

```
source statements .............. 20
graph statements ............... 19
invented (graph, not source) ... 0
content gaps (source, not graph) 0
explicitly omitted ............. 1   (the support note TEXT — declared unmodelled)
```

**Nothing was dropped in the modelled dimensions and nothing was invented.** The one loss is a
deliberate, declared omission (see `README_ERRATA.md` #1), reported as `explicitlyOmitted`, never as
fidelity. `roundTripClean: true` because `contentGapTotal === 0 && inventedTotal === 0` (the A13
identity).

---

## Round Trip Validation

The pair (`lib/toyRoundTripPair.js`) canonicalizes the source model into 20 statements and re-emits
19 from the graph double; the harness diffs the two Maps, labels the one loss `explicitlyOmitted`, and
asserts the A13 identity before writing `roundTripVerdict.json`. Every gate over it (G-RT) has a twin
observed RED: delete a fact → lostTotal moves; inject a statement → inventedTotal 1.

---

## Known issues

None in the model. The fixture is small by design; it exercises every framework path a real forge
uses (a single loader, both finalizers, an option-value expansion, a non-embeddable role) but does
not exercise scale.

---

## Provenance

No upstream: the model is authored in-tree (`assets/standardSourceData/01/README_PROVENANCE.md`),
pinned by `SHA256SUMS`, `publishedVersion 1.2.3` in `standardSourceLocation`. Nothing is open.

---

## For more information

`README_ValidationDetail.md` (the long argument), `README_ERRATA.md`, `README_PROVENANCE.md`.
Run `node lib/forge-framework/roundTripHarness/test/test-gRt.js -verbose` to see the verdict counts.
