# Validation detail — Toy Standard (fixture)

## The instrument

Two halves held apart on purpose (Profile §8.5): `lib/toyRoundTripPair.js` `canonicalizeSource`
reads ONLY the snapshot bytes (verified against `SHA256SUMS` by the harness intake) and yields
`Map<statementKey, statement>`; `emitFromGraph` reads ONLY a `GraphReader` (`readAll` → nodes/edges)
and yields the same shape. The harness (`lib/forge-framework/roundTripHarness/`) diffs the two Maps
(invented = graph − source; lost = source − graph, each lost item labelled `explicitlyOmitted` when
the source side declared it so, else `contentGap`), assembles the verdict with the five normative
names, ASSERTS the A13 identity, and writes `roundTripVerdict.json` under the caller's `outputPath`.

## The statement vocabulary

```
class|<Name>                          { name }
class|<Name>|description              { text }
property|<Class>.<Name>|dataType      { dataType }
property|<Class>.<Name>|description   { text }
optionSet|<Name>                      { name }
value|<Set>.<Code>|label              { label }
support|<Name>                        { name }
support|<Name>|text                   { text, explicitlyOmitted: true }   ← declared unmodelled
```

## semanticValidationLimit

Stated in `lib/toyRoundTripPair.js` and carried into every verdict: names at declaration precision,
descriptions/labels/dataType verbatim; NOT modelled — the support note text (declared, reported as
explicitlyOmitted), option-set descriptions, ordering, whitespace, the model-level version/sourceUrl
(the root's, checked by the framework).

## Evidence

The verdict of the last hermetic run (F3a build, 2026-08-16): source 20, graph 19, invented 0,
contentGap 0, explicitlyOmitted 1, `roundTripClean: true`. G-RT's twins observed red: delete one fact
from the double → lostTotal moves; inject one invented statement → inventedTotal 1; delete the limit →
refused; a verdict claiming clean with contentGap 1 → refused; a lost item without lostCategory →
refused; a synchronous emitter → refused.
