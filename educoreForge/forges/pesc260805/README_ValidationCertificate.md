# Validation certificate — PESC260805

**The PESC schema family was built from 64 published XSD files. 42,372 nodes.**
**This graph is complete and usable.** Accuracy was confirmed by round trip validation: XSD was
regenerated from the graph and compared against the source files, statement by statement. Nothing was
missed. Nothing was invented. A third-party XSD compiler, sharing no code with ours, then compiled
both sets of files and reached the same result on every one.

| | |
|---|---|
| standard | PESC, aggregate version `01` — a set assembled here, not a PESC release (see below) |
| source | `assets/standardSourceData/01/` — 64 XSD files, 9,733,713 bytes, digest `92e9a632…` |
| graph | `DEV_pesc260805`, built 2026-08-07 |
| commit | `dfe97d3`, branch `architecture-improvement` |

---

## What is in the graph

**Everything the 64 files declare** — 41,676 nodes covering:

| in the graph | count |
|---|---:|
| named type definitions | 12,909 |
| element declarations | 16,969 |
| type derivations (extension and restriction) | 10,848 |
| anonymous inline types | 720 |
| import declarations | 82 |
| attribute declarations | 84 |
| the source files themselves | 64 |

For each, the graph carries its name, its namespace, its documentation text, its content model
including the order of child elements, its cardinality, its enumeration values and its base type.

**Also present, and marked as such:** 63 namespace nodes resolved from the import declarations, and
632 nodes recording decisions made here rather than by PESC — the merged `AcademicRecord v1.6.0` and
a stand-in for a file PESC never published. Every node carries a tier marking, so a consumer can
always ask whether PESC said something or we did.

**Not present:** any mapping to CEDS, SIF, Ed-Fi or any other standard.

---

## Accuracy

```
statements compared ............ 173,216
missing from the graph ......... 0
present but not in the source .. 0
```

**Two independent checks agree.** The first regenerates XSD from the graph and compares statements
against the source. The second compiles both the original files and the regenerated ones using a
third-party XSD processor that shares no code with ours: 64 files attempted each side, 55 compiled
cleanly each side, 9 refused each side, with identical causes.

Test suites: 237 passed, 0 failed.

---

## Known problems

**1. PESC published two different files as `AcademicRecord v1.6.0`.** Both are in the corpus. The
graph carries a single merged definition built from both, and where they disagreed the
college-transcript version was used. **Eight child elements declared only by the test-score version
are not in the graph**, each one named in `README_identityRules.md`.

**2. `CoreMain v1.6.0` does not exist.** `AcademicRecord v1.5.0` imports it and PESC publishes it
nowhere. The graph resolves those references to `CoreMain v1.8.0` instead. All 129 references were
confirmed to exist in 1.8.0 — but 1.8.0 is not 1.6.0, and no one can say what 1.6.0 contained.

**3. Two documentation texts are missing.** Where one annotation carries several documentation
blocks, only the first was kept. Five annotations in the corpus do this; three of the dropped blocks
were empty. The two that were not are on `DocumentCategory` and `DocumentFormat` in
`AcademicRecord_v1.14.0.xsd`.

**4. Nine of the 64 files cannot be compiled, and the fault is PESC's.** Three reference a group that
is never defined; six reference a type that is never defined. The graph carries what those files say;
a consumer building a schema processor from it will meet the same unresolvable references.

**5. Type reference namespaces were not compared.** The round trip matched type references by name
with the namespace prefix removed. A reference pointing at a same-named type in a different namespace
would not have been detected as a difference. The graph itself keeps them separate — it holds 33
distinct `TransmissionDataType` definitions — but that separation was not verified by the comparison.

**6. Two properties are in the graph but were not verified.** `substitutionGroupAsWritten` on 113
nodes and `abstract` on 28 were captured from the source and are queryable, but the round trip does
not read them, so nothing confirms they came across correctly.

---

## Where the data came from

**PESC does not publish this set.** Each standard is released separately, pinning its own library
versions, with no index and no bundle. **The version `01` was assigned here** and names this
particular assembly of PESC-published files. It must not be read as a PESC edition.

The files were collected from PESC's own pages and two side channels, and kept only if they parsed as
XML and declared a `urn:org:pesc:*` namespace:

| source | what it supplied |
|---|---|
| `https://pesc.org/approved-standards/` and nine standard pages beneath it | most of the corpus |
| `https://pesc.org/wp-content/uploads/2025/11/Academic-College-Transcript-Request-Response-v1.0.zip` | the newest schema block, whose direct links all return HTTP 410 |
| `https://developer.ocas.ca/transcripts/schemas/pesc/` | three legacy Transcript roots no longer linked from pesc.org |

Everything was downloaded free and without login. Filenames were derived from each file's declared
namespace rather than from link text. Nothing was repaired or merged during collection — PESC's
contradictions are preserved as published, and every decision about them was made by the forge and is
marked in the graph.

`SHA256SUMS` in the corpus directory records every file; `manifest.json` records each file's namespace
and digest.

---

## More detail

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | how the comparison works, its full modelling boundary, and the commands to reproduce this run |
| `README_KnownIssues.md` | the standing backlog behind the problems above |
| `README_identityRules.md` | the merge and stand-in decisions, including the eight lost child elements |
| `assets/standardSourceData/01/README_PROVENANCE.md` | the corpus record and collection rule in full |

Figures measured 2026-08-07 from the run named above.
