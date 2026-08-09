# Ed-Fi 349 remediation — Phase 1 and Phase 5 states 1–2, the evidence

Builder **CRIMSON_FALCON**, 2026-08-09. Design authority **OCEAN_DELTA**. Branch
`architecture-improvement`, baseline `469cc3b`. **Nothing committed by this builder.**

These four transcripts exist so that the RED in state 2 is EVIDENCE rather than a claim. A report
that says "the assertions went red" and a transcript that shows *which* assertions, on *what
measured values*, are not the same artifact, and only the second survives the session.

---

## The three-state method (TQ ruling 2026-07-23), and why this phase needs it

The suite being reworked here **encoded the defect as expected behaviour**. Before the rework it
asserted, and passed:

- `test-edfiRoundTrip.js:756` — `verdict.lost > 0` on the FULL-vocabulary fixture
- `:783-788` — a `componentKind/` loss with object `identityTemplate` EXISTS
- `:789-794` — the loss `itemNamespace/FixtureStudent = 'EdFi'` EXISTS

and gate **G-5** measured `probe.fullVocabularyLossesAllNamed`, whose expression reduces to
`0 === 0 && [].every(...)` — **true on an empty loss set**. Fix the forge first and three
assertions turn red for being right, while one gate goes green for a reason unrelated to its
claim. Hence: observe the old green, invert the tests with the code untouched, observe red, and
only then let a different builder fix the forge.

| state | what | who | artifact |
|---|---|---|---|
| 1 | old suite, unfixed forge — record the green about to be deleted | CRIMSON_FALCON | `…-state1-suiteGreen-preRework.txt` |
| 2 | reworked suite, **forge still unfixed** — observe RED | CRIMSON_FALCON | `…-state2-suiteRed-reworkedSuiteUnfixedForge.txt` |
| 3 | forge carries the classes; suite goes green | **a different builder** | not in this set |

---

## STATE 1 — `edfi349Remediation-state1-suiteGreen-preRework.txt`

`node forges/edfi/test/test-edfiRoundTrip.js -verbose` — **98/98 passed, 0 failed, exit 0.**
All 16 gates PASS, all 16 twins observed RED. The three defect-certifying assertions above are
visible passing by name.

## STATE 2 — `edfi349Remediation-state2-suiteRed-reworkedSuiteUnfixedForge.txt`

Same command, reworked suite, **forge untouched** — **108/120 passed, 12 failed, exit 1.**

> **Post-review revision.** The independent adversarial review returned SOUND-WITH-GAPS with five
> remediation items. One of them (G-18 had no non-vacuity floor — the campaign's own lesson turned
> back on us) necessarily MOVES this count, because the fix is deliberately unsatisfied until the
> forge carries the class. The change is fully accounted for: total assertions 119 → 120 (+1 new
> presence-floor control), passed 109 → 108 (+1 control passing, −2 newly failing), failed 10 → 12
> (+ the G-18 assertion and the G-18 gate). **The original ten failures are unchanged.**

Twelve failures, with their measured values:

| # | failing assertion / gate | measured |
|---|---|---|
| 1 | full fixture `roundTripClean === true` | reproduced 325, **lost 9**, inventedTotal 0 |
| 2 | full fixture LOST is zero | expected 0, got **9** |
| 3 | every ruled-carriage statement REPRODUCED | 9 statements across 7 predicates, **0 reproduced** |
| 4 | class `componentKind/` fully carried | 0/5 |
| 5 | class `itemMetaEdId/` fully carried | 0/3 |
| 6 | class `itemNamespace/` fully carried | 0/1 |
| 7 | every componentKind value REPRODUCED | element (4 stmt) and identityTemplate (1 stmt), none reproduced |
| 8 | items with no metaEdId emit nothing | presence floor unmet — **0** itemMetaEdId predicates reproduced |
| 9 | **G-5** (redefined) | `probe.fullVocabularyClean` = **false**, comparator isTrue |
| 10 | **G-17** (new) | `probe.componentKindBothKindsCarried` = **false**, comparator isTrue |
| 11 | **G-18** (new) | `probe.idlessItemsEmitNothing` = **false**, comparator isTrue |
| 12 | suite ACCEPTED | fail 3, unproven 0 |

**The 9 is the hermetic analogue of the production 349** — the same three classes, on a fixture
sized to exercise every case: 5 `componentKind/` (4 element, 1 identityTemplate), 3
`itemMetaEdId/`, 1 `itemNamespace/`. The transcript names all nine individually.

### What stayed GREEN in state 2, and why that is the substance of the proof

A red that could have been produced by anything proves nothing. These controls passed in the same
run:

- **the non-vacuity floor** — `{"componentKind/":5,"itemMetaEdId/":3,"itemNamespace/":1}`, total 9.
  So G-5 is red because the statements were **lost**, not because the domain went missing.
- **the anti-vacuity control** — the carriage measure was fed the CARRIABLE run, whose verdict is
  clean, lossless and invention-free but which ships no interchange vocabulary at all. It
  **refused**, and refused for the stated reason ("NO per-predicate row at all"). This is the
  shape the OLD G-5 would have called success.
- **G-18's three data-level controls**, each isolating one variable with the presence floor held
  satisfied in the first two: the detector REFUSES a doctored emission carrying
  `itemMetaEdId/FixtureEnrollment`; ACCEPTS `itemMetaEdId/FixtureStudent`, an item that does
  declare an id; and REFUSES when nothing is emitted at all, which proves the floor itself bites.
  (The G-18 *gate* is red — see the revision note above. Its detector is proven; its claim is
  simply not yet makeable.)
- **G-19 edge-triple uniqueness** — four data-level observations (below).
- **all 19 twins observed RED**; registry audit clean, no orphan twins.

## PHASE 1 — `edfi349Remediation-phase1-edgeUniquenessRealBlockProof.txt`

Four observations of `roundTripEdfiCompiler.findDuplicateEdgeTriples` against the **real forged
block**, all as expected:

1. **GREEN** real block — 8,171 edges / 8,171 distinct triples
2. **RED** one triple duplicated and a *different* edge dropped, so the total stays at exactly
   8,171 and the runner's count assertion still PASSES — uniqueness is the only thing that can
   fail
3. **GREEN** edge array reversed — order-independent
4. **GREEN** near-miss triples sharing TWO of the three components — the check keys on all three

Observations 1, 3 and 4 also run **hermetically on every suite execution** in the
`EDGE-TRIPLE UNIQUENESS` section, together with observation 2's synthetic form, feeding G-19.

## PHASE 1 — `edfi349Remediation-phase1-materializeRunWithUniquenessGate.log`

`node forges/edfi/test/runEdfiMaterialize.js`, end to end into `DEV_edfiRoundTrip_080326`:

```
[runEdfiMaterialize] forged 6336 nodes / 8171 edges
[runEdfiMaterialize] edge-triple uniqueness: 8171 edges / 8171 distinct (from, type, to) triples
...
MATERIALIZED AND COUNT-VERIFIED
```

---

## Why the uniqueness gate had to land BEFORE the forge fix

The replay engine writes edges with `MERGE ... SET r += e.props`, so two edges sharing a
`(from, type, to)` triple collapse into one relationship. Today every REFERENCES edge carries the
same single property, `provenanceTier`, so the collapse loses nothing. The moment edges carry
per-edge attributes the identical collapse becomes **last-write-wins data loss with no error
raised anywhere**: the loader reports success and the counts still reconcile, because a duplicated
triple does not change the forge-side edge count at all. Counting is structurally unable to see
it, which is why this check is orthogonal to the census assertion rather than a refinement of it.
