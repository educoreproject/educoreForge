# SEDM snapshot 01: provenance

**What it is.** Two working documents of the SEDM (Special Education Data Model) working group, NOT a published release. SEDM has no
published version; TQ ruled on 2026-10-23 that it is forged from these held files ("yes, attic", PLAN-nextStandards-102326 section 12).
When a published SEDM artefact appears, it replaces them as a new snapshot.

| file | role | bytes | sha256 |
|---|---|---|---|
| `SEDM Logical Model and Maps - 6. CEDS Map.csv` | the forge's element source: the CEDS Map sheet, 4,465 records x 67 columns; a record is in SEDM when its `SEDM` column is non-empty (326 records) | 3,130,303 | `c58d04ddb0b36d3eacda0028fe355d3f1e4039e64311cc14ca3852f600ac8f52` |
| `sedm-domain-structures.json` | the forge's structure source: ontology classes, compliance categories, IDEA indicators, event milestones, IEP components, entity hierarchy, declared option sets, use cases, Generate ETL templates, extracted from "SEDM Conceptual Model.md" (its `_meta`: extractedDate 2026-04-01, version 1.0 of the extraction) | 22,794 | `dbcaa689b00064f5316288003a38f03f761584225f8c5c112cb3bf1e8c47f15c` |
| `standardSourceLocation` | the provenance record | | (in `SHA256SUMS`) |

**The column "TQ's IEP Model"** (column 22 of the CSV) is EMPTY in all 4,465 records, as is the unnamed column beside it (measured
2026-10-24); nothing of either is carried.

**Licence.** None stated: the held files carry no licence line. The A4L decks mark SEDM artefacts CC BY 4.0 (web), but no published
artefact exists. Downloads of this standard are WITHHELD, both facets (`apps/graph-builder/lib/downloadArtifactsRules.json`).

**Not in git** (TQ 2026-10-24: "Leave it out of git"). The two source files are git-ignored (repo-root `.gitignore`, the forge-sedm block).

## Acquisition recipe

The bytes are recoverable from this repository's own history, at the commit before the 2026-08-15 reset:

```
DEST=educoreForge/forges/sedm/assets/standardSourceData/01      # from the git root, system/code
for f in "SEDM Logical Model and Maps - 6. CEDS Map.csv" sedm-domain-structures.json; do
  git show "88336881:educoreForge/forges/sedm/assets/standardSourceData/01/$f" > "$DEST/$f"
done
(cd $DEST && shasum -a 256 -c SHA256SUMS)
```

The same two files are also held at `educoreForgeOLD/system/code/cli/lib.d/forge-sedm/assets/standardSourceData/01/` (with three
Markdown working documents this snapshot does not include: `SEDM Conceptual Model.md`, `FS002 Data Requirements.md`, `Use Case FS002.md`).
