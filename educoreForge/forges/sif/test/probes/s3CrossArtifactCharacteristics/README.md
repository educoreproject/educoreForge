# s3CrossArtifactCharacteristics — do the spreadsheet and the XSD ever contradict each other?

**Answer: no. Not once in 15,620 rows.** Errata **S-3** records the result.

Companion to `../s1SourceCompletenessAudit/`. That probe established that the export omits 6,586
container elements. The natural misreading of a number that size is *"SIF's spreadsheet and SIF's XSD
disagree."* This probe tests that claim directly, on every export row where both artifacts speak, and
it does not survive.

## What it found (2026-08-09)

| | count |
|---|---|
| export rows | 15,620 |
| resolved in the XSD | 15,620 — zero unresolvable |
| identical value | 15,489 |
| spreadsheet silent, XSD speaks | 131 |
| **contradictions — different values stated** | **0** |

Every divergence has the same shape. The XSD is strictly richer and never in conflict. **The
spreadsheet is not wrong; it is less expressive.**

It also settles two things the errata had left open:

- **Q-1** — of the 119 rows asserting mandatory with a blank `Characteristics`, **89 carry a value in
  the XSD** (77 `M`, **12 `MR`**), and on 30 the XSD is silent too. The 12 `MR` are 12 further
  repeatability declarations missing from the export, on rows that *do* exist.
- **The `blank/blank` cross-tab cell** in the errata's 2026-08-04 correction block is **43, not 364**.
  The arithmetic decides it: 43 makes the eight cells total 15,620, exactly the data-row count.

## Why it exists — the mistake that produced it

The S-1 finding first claimed repeatability was corroborated by *"two independent encodings, the
spreadsheet's `R` suffix and the XSD's `maxOccurs`."* **That was false.** Those 6,586 containers have
no spreadsheet row — that is the whole finding — so both compared values came from the XSD's own
`<sifChar>` annotation. Every figure was accurate; the word *independent* was not.

TQ asked whether the spreadsheet and the XML disagree. The claim did not survive the question, and
this probe is the test that should have been run first.

**The lesson is in the code's design, not just this paragraph.** The probe counts *contradictions*
(both artifacts stating different non-empty values) separately from *spreadsheet silent* — because
reporting a single "disagreement" figure is precisely the conflation that caused the original error.

## The second input is NOT in this bundle

`assets/standardSourceData/01/` holds the TSV only; `README_PROVENANCE.md` records the published
schema zips as deliberately uncommitted. The annotated XSD used here was found at:

```
/Users/tqwhite/Documents/webdev/A4L/unityObjectGenerator/system/code/cli/lib.d/assets/XSDs/SIF_Message.xsd
```

An unrelated client project — read-only, never write there. sha256
`d376cbb5a9b8475eaf2a70ce8ab92f983fe890e05b638402a53f828df3112ffa`, 74,122 lines. Its chain of custody
is **INFERRED, not VERIFIED**: the provenance record checksums the published *zip*, not the extracted
file. See `../s1SourceCompletenessAudit/README.md` for the six matching fingerprints and the successor
task that would move it to verified.

## Running it

From `system/code/educoreForge`:

```bash
node forges/sif/test/probes/s3CrossArtifactCharacteristics/s3CrossArtifactCharacteristics.js \
  --tsvFilePath="$PWD/forges/sif/assets/standardSourceData/01/ImplementationSpecification_031326.tsv" \
  --xsdFilePath="<path to the annotated SIF_Message.xsd — see above>"
```

Both arguments required, neither defaulted; a missing one refuses by name and exits 1. Read-only —
two files in, a report to stdout, no database and no writes.

**It reuses `../s1SourceCompletenessAudit/lib/` for TSV and XSD reading**, deliberately rather than
reimplementing: two parsers for one format would be two things to keep true, and a divergence between
them would look like a finding about SIF. If you move or rename the sibling probe, this one breaks
loudly rather than silently — the require fails at startup.

---

*Placed 2026-08-09 by session QUIET_LOOM under CRYSTAL_ORBIT, authorized to this directory only. Run
from this location before placement was reported. No forge code, canonicalizer, emitter,
parserDescriptor or validation certificate touched. Not committed.*
