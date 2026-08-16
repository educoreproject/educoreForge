# README_ERRATA — Toy Standard (fixture)

Observations about the UPSTREAM SOURCE, evidence-first, verified vs inferred separated per entry,
retractions kept visible (Profile §10.5, doctrine RT-14).

The Toy Standard has no upstream: `assets/standardSourceData/01/toyModel.json` is authored in-tree as
the Forge Framework's hermetic fixture. There is therefore no publisher erratum to record.

## Entries

| # | observation | verified / inferred | evidence | status |
|---|---|---|---|---|
| 1 | The support note text (`supports[].text`) is NOT modelled by the round-trip emitter; the canonicalizer declares it `explicitlyOmitted` so the verdict reports it as an explicitlyOmitted loss, never as fidelity. | verified | `lib/toyRoundTripPair.js` `semanticValidationLimit`; verdict `explicitlyOmittedTotal: 1` | by design — a deliberate demonstration of the A13 partition |
| 2 | Option-set descriptions (`optionSets[].description`) are carried on the DmeOptionSet node but not modelled by the round-trip pair. | verified | same | by design |

No retractions.
