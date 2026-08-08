# README_ERRATA — forge-sif: observations about the UPSTREAM SOURCE

**What this is.** Things we believe are true about SIF's own published artifacts, found by our
round-trip work. One of these lives in every forge bundle (doctrine RT-14, TQ ruling 2026-08-04):
errata about a standard belong beside the bundle that forges it, not in a central document —
they travel with the code that found them, they outlive any single snapshot, and the next person
to touch this bundle reads them without knowing to look elsewhere.

**Peer documents.** `assets/standardSourceData/<version>/README_PROVENANCE.md` says where the
bytes came from; this file says what we noticed about them.

**Why it is separate from the enrichment backlog.** The enrichment backlog (in each campaign's
DEVLOG and each bundle's round-trip verdict) lists what OUR graph does not yet carry — our work.
This document lists what we believe is true about the SOURCE — someone else's work, and therefore
held to a different standard of care: nothing goes in here unless it is verified against the
published bytes, and every entry states its evidence so a maintainer can check us in minutes.

**Discipline for entries.**
1. **Evidence first, characterization second.** Quote the artifact, cite the file and line.
2. **State what you VERIFIED versus what you INFER.** A finding relayed to a standards author
   with an inference dressed as a fact costs us the relationship, not just the point.
3. **A retracted entry stays, marked RETRACTED with the reason.** This file is a record of what
   we thought and why, not a tidy list of what survived. (The first entry below has a retraction
   already, from the same morning it was written.)
4. **Record the disposition**: reported to whom, when, and what came back.

---

## The standard: SIF NA 4.3, Access 4 Learning (release 2022-10-27)

Provenance of everything below: our committed snapshot
`forges/sif/assets/standardSourceData/01/ImplementationSpecification_031326.tsv` (a flattened
export of the SIF NA Implementation Specification spreadsheet, sha256 `68147277…4706`), checked
against the published 4.3 schema set from `https://files.a4l.org/Implementation/NA/4.3/`
(`Schema_NoIncludes_Annotated_Strict/SIF_Message.xsd`, 74,122 lines). TQ's testimony establishes
that the spreadsheet is canonical and every published artifact is generated from it by a tool
John Lovell wrote (ruling R-SF-6).

### S-1 — The flattened export omits container-element rows, and their `Characteristics` with them

**Status: OPEN. Verified. Not yet reported.**

The XSD annotates every element with its spreadsheet `Characteristics` value under its own tag,
`<sifChar>`. Values present in the XSD: `O` 2,928 · `M` 1,164 · `OR` 180 · `MR` 150 · `C` 116 ·
**`CR` 2**.

`CR` appears **zero times** in the flattened export. Both XSD occurrences are the same element:

```
SIF_Message.xsd:46490  (complexType MarkValueLetterType)
  <xs:element name="ValidMark" minOccurs="0" maxOccurs="unbounded" ...>
      <sifChar>CR</sifChar>
SIF_Message.xsd:49224  (complexType MarkValueLetterCleanType) — the same element
```

The export carries rows for ValidMark's CHILDREN — `/MarkValueInfos/MarkValueInfo/Letter/
ValidMark/@SIF_Action`, `/Code`, `/NumericEquivalent` (TSV lines 7769-7771) — but **no row for the
`ValidMark` container itself**. So its `CR` characteristic, and with it the fact that ValidMark
REPEATS (`maxOccurs="unbounded"`), is unavailable to any consumer reading the spreadsheet.

**Verified:** the counts, the two XSD sites, the three child rows, the absence of a ValidMark row,
and that `CR` occurs nowhere in the export.
**Inferred, not verified:** that this generalizes — i.e. that other intermediate containers are
also unrepresented. We checked this one because `CR` made it visible. A systematic comparison of
XSD element inventory against export rows would settle it and we have not run one.

### S-2 — The export cannot express choice-group membership; `C` + mandatory-flag is the only trace

**Status: OPEN as an OBSERVATION (not a defect). Verified.**

Nine export rows carry `Characteristics = C` together with a mandatory `*`, while 87 carry `C`
with a blank mandatory flag. The nine are three identical triples —
`XMLData` / `TextData` / `BinaryData` — under `AssessmentItem`'s `Stimulus`, `Stem`, and
`ResponseChoices/Choice/ChoiceContent`.

The XSD shows why, and it is not sloppiness:

```
SIF_Message.xsd:33269  (complexType AbstractContentElementType — the type of Stimulus/Stem/…)
    <xs:sequence>
      <xs:choice>                        <-- no minOccurs, so minOccurs=1: exactly one required
        <xs:element name="XMLData" …>  <sifChar>C</sifChar>
        <xs:element name="TextData" …> <sifChar>C</sifChar>
        <xs:element name="BinaryData" …>
```

So `C` + `*` is the export's way of saying *conditional, and the choice group is required* — the
mandatory flag is meaningful and correct. **The observation is that a consumer reading only the
spreadsheet cannot recover WHICH fields are alternatives to one another**: flattening drops the
`xs:choice` grouping, leaving the one-of relationship inferable only by someone who notices three
adjacent `C`-plus-star rows sharing a parent path. This is a limitation of flattening rather than
an error, and it is worth a standards author's attention only because consumers do build from the
spreadsheet.

> **RETRACTED CHARACTERIZATION (2026-08-04, same morning, AMBER_TOWER).** This was first reported
> to TQ as "a source inconsistency worth reporting upstream — those 96 C rows are marked `*` 9
> times and blank 87 times." That framing was WRONG: it called an intentional encoding an
> inconsistency, on the strength of a cross-tab, before anyone had opened the XSD. The XSD was
> then read and showed the `xs:choice`. Kept visible here because the lesson is the more useful
> artifact: a statistical anomaly in a flattened export is a QUESTION about the source, never yet
> a finding about it, and an errata entry is exactly where that distinction has to hold.

### Consequences for our own work (cross-references, not errata)

- The `Characteristics` column is where SIF states **cardinality** (`R` suffix → repeatable;
  the XSD renders it `maxOccurs="unbounded"`) and **conditionality** (`C`). Our forge carries the
  `Mandatory` flag but not `Characteristics`, so the graph cannot today distinguish a
  single-valued element from a repeating collection anywhere in SIF: 1,829 repeatable fields and
  96 conditional fields unrepresented. This is the 15,458-statement `fieldCharacteristics`
  contentGap in the SIF round-trip verdict, commissioned as forge-sif Phase 4.
- **CORRECTION (2026-08-04, found by the forge-sif Phase 4 builder).** This section previously
  called the `Mandatory` column "a LOSSY PROJECTION of Characteristics." That is WRONG. A full
  cross-tab (header rows excluded) shows **119 rows asserting a mandatory `*` while leaving
  Characteristics BLANK**. So `Mandatory` is an INDEPENDENT column that agrees with Characteristics
  on 15,362 rows and carries information Characteristics lacks on 119. It is not derived from it.
  The projection claim was made from a partial cross-tab that omitted the blank-Characteristics
  rows — the same error class as the S-2 retraction below, made by the same author on the same
  morning. Full distribution: M/`*` 6,072 · O/blank 7,461 · MR/`*` 1,194 · OR/blank 635 ·
  C/blank 87 · C/`*` 9 · **blank/`*` 119** · blank/blank 364.

### Q-1 — OPEN QUESTION (not a finding): what do the 119 mandatory-but-uncharacterized rows mean?

**Status: OPEN QUESTION. Deliberately NOT an errata finding.** 119 export rows assert mandatory
with an empty `Characteristics` cell. Every other row with a mandatory flag also carries a
Characteristics value. This *smells* like the S-1 class — the export omitting something the XSD
carries — but **nobody has opened the XSD for these rows**, and by the lesson of the S-2
retraction a cross-tab anomaly is a question about a source, never yet a finding about it.
Settling it means re-acquiring the published 8-zip schema corpus and checking those 119 elements'
`sifChar` annotations. Logged for a successor rather than chased; raised by the Phase 4 builder,
which applied the S-2 discipline to its own discovery without being asked.

- S-1 means the XSD is a strictly RICHER artifact than the export for container elements — worth
  remembering if we ever want cardinality for containers rather than leaf fields.
