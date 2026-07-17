# ctdlPilotFixtures — the frozen Phase 0.2 baseline (forge-architecture pilot)

**Produced by:** CRIMSON_MIRROR (Builder A), 2026-07-16, under IMPLEMENTATION_PLAN.md v2
Phase 0.2 (spec of record: `system/management/zNotesPlansDocs/forgeArchitectureRefactor_071626/`).
**Read-only measurement** — no store was written; the canonical store
(`system/dataStores/forgeStore.sqlite3`, sha256 `69cd37333d8dbec5f9ed08383fc4ac2720367acfa5342a61fc3daa75f87c659d`)
was untouched.

## Measurement provenance

- **Source:** the store copy `/tmp/goldEval260716.sqlite3`
  (sha256 `c346fe25cf1965d06a2f4267332df61e9a0db763bf68bf2e0244728ca29c6abe`), the same
  bytes evaluated and promoted as the live golden GOLD_260716.
- **Baseline manifest:** `d8606a1e51e198d073fe521e4279be13b7b2c65bf10d6f840b029a487ec650fc`
  (label `goldEval260716-ctdlFamilyUriBridge`, 34 members) — the manifest the live golden's
  graphs point at (`graphs.currentManifest`, three rows).
- **Plane:** store (block-text parsing), per the Phase 0.2 preference. No container queried.
- **Triple identity:** `(type, fromStableId, toStableId)`; stableId = ref.id VERBATIM
  (code fact, replay-engine.js:247-249). Replay MERGEs on type+endpoints
  (replay-engine.js:276-281), so this identity is exactly the graph's edge identity.
- **Tool:** `tools/measureBaselineFixtures.js` (deterministic; re-runnable against the same
  store copy → byte-identical fixtures).

## Headline verdicts

| Measure | Value |
|---|---|
| Gathered (merge-accident, NULL-provenance family cross-source) | **149** — exactly the remembered figure |
| Authored (ctdlFamilyUriBridge block edges) | **229** — exactly |
| Union (the G4 equivalence census target) | **378** (the two sets are fully DISJOINT — the old tool's alreadyBridged dedup guaranteed it) |
| Consolidated-block census | 19,211 edge lines, all distinct: **149 ctdl149 + 19,062 bridgeAuthoredDuplicate + 0 OTHER** |
| S5 retirement license | **GRANTED by measurement** — zero OTHER (no edge lacks a surviving carrier) |

### Per-pairing decomposition (R2-7 — asserted by Phase 2/3 gates)

| Pairing | union | gatheredOnly | authoredOnly | both |
|---|---|---|---|---|
| CTDL::CTDLASN | 215 | 68 | 147 | 0 |
| CTDL::CTDLQData | 146 | 81 | 65 | 0 |
| CTDLASN::CTDLQData | **17** | 0 | 17 | 0 |

`CTDLASN::CTDLQData` is **NOT empty** — 17 authored edges. The R2-7 "empty is a verdict"
provision is exercised in the other direction: Phase 2 must expect a non-empty third pairing.

### Pre-ruled delta identity — CONFIRMED (S9.3)

The gathered 149 decompose by type as HAS_CLASS 2, HAS_PROPERTY 113, REFERENCES 32,
SUBCLASS_OF 2. The 2 HAS_CLASS edges are exactly the anticipated correct losses:
`ctdl:root -[:HAS_CLASS]-> schema:MonetaryAmount` and
`ctdl:root -[:HAS_CLASS]-> schema:QuantitativeValue` (the old CTDL root claiming
CTDL-QData's schema classes; no locator maps to HAS_CLASS). Their identity is now
measured, satisfying S9.3's CONFIRM-then-rule requirement.

### Carrier cross-check (the two-carrier claim, measured)

All 149 gathered triples are ALSO carried inside the old CTDL standard block
(`inBoth: 149, onlyInConsolidated: 0`) — the F2a false-green mechanism is real: either
legacy carrier alone re-lays the population. The old CTDL block additionally carries 11
`HAS_PROPERTY` edges among CTDLQData-owned nodes (schema:MonetaryAmount /
schema:QuantitativeValue → their property nodes); these are SAME-source in the graph
(never swept, not cross-standard) and all 11 are independently carried by the CTDLQData
standard block — benign duplicates, not deltas.

## Files

| File | Content |
|---|---|
| `fixture-a-familyEndpointTriples.json` | The 378-triple gathered∪authored set, decomposed by pairing, each triple flagged gathered/authored |
| `fixture-b-consolidatedBlockCensus.json` | The S5 residue census: class counts, complete ctdl149 + OTHER lists, duplicate carrier histogram, old-CTDL-block overlap |
| `fixture-b-duplicates.jsonl` | Completeness sidecar: all 19,062 duplicate-class triples with carriers |
| `fixture-c-legacyCarrierBlockIds.json` | The three legacy carrier blockIds for the S14 Phase-4 membership assertion |
| `SHA256SUMS` | Fixture hashes (freeze seal) |
| `tools/measureBaselineFixtures.js` | The measurement tool (reproducibility) |
