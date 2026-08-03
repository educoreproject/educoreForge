# Snapshot 01 — Provenance & Acquisition (forge-pesc round-trip snapshot)

**Created 2026-08-03 (Phase 0, forge-pesc round-trip retrofit campaign; builder COBALT_CROWN,
supervisor AMBER_TOWER). Governing documents: DOCTRINE-roundTripForgeContract-080326.md
(RT-3, RT-9, RT-11, RT-12), WORKORDER-pescRoundTripForge-080326.md — in
system/management/zNotesPlansDocs/.**

This snapshot holds the PESC XML Schema (XSD) set the forge-pesc bundle reads: **11 `.xsd`
files, 1,220,940 bytes total**. Provenance files (this README, `SHA256SUMS`,
`standardSourceLocation`) are peers of the source bytes. The source bytes are loose in this
directory — per the supervisor's RT-11 amendment (2026-08-03), a source subfolder is required
only where gitignore scoping (license) demands it, which does not apply to PESC: every byte
here is freely committable and committed, and the incumbent parser reads the version
directory itself.

## The source set

| File | Document | Declared version |
|---|---|---|
| `CoreMain_v1.19.1.xsd` | Core Main common element dictionary | v1.19.1 |
| `AcademicRecord_v1.14.0.xsd` | Academic Record sector library | v1.14.0 |
| `iso_3166-1_v1.0.0.xsd` | ISO 3166-1 country-code list (PESC packaging) | v1.0.0 |
| `AdmissionsRecord_v1.4.0.xsd` | Admissions Record sector library | v1.4.0 |
| `CollegeTranscript_v1.8.0.xsd` | College Transcript message schema | v1.8.0 |
| `HighSchoolTranscript_v1.6.0.xsd` | High School Transcript message schema | v1.6.0 |
| `TestScoreReport_v1.1.0.xsd` | Test Score Report message schema | v1.1.0 |
| `EducationCourseInventory_v1.0.0.xsd` | Education Course Inventory message schema | v1.0.0 |
| `LearningRecord_v1.0.0.xsd` | Learning Record message schema | v1.0.0 |
| `DocumentRequest_v1.0.0.xsd` | Document Order Request message schema | v1.0.0 |
| `DocumentResponse_v1.0.0.xsd` | Document Order Response message schema | v1.0.0 |

There is no single suite version: each document carries its own version (this is why
`standardSourceLocation` declares `publishedVersion: unknown` and the forge stamps `unknown`
honestly, versionSource `unknown`).

**The set is a curated working assembly, not a coherent published release.** Several message
schemas declare `xs:import` of core/sector versions that are NOT in this snapshot:

| Schema | Declares import of | Present instead |
|---|---|---|
| `AdmissionsRecord_v1.4.0` | CoreMain v1.16.0 | CoreMain v1.19.1 |
| `CollegeTranscript_v1.8.0` | CoreMain v1.19.0, AcademicRecord v1.13.0 | v1.19.1, v1.14.0 |
| `HighSchoolTranscript_v1.6.0` | CoreMain v1.17.0, AcademicRecord v1.11.0 | v1.19.1, v1.14.0 |
| `EducationCourseInventory_v1.0.0` | CoreMain v1.13.0, AcademicRecord v1.8.0 | v1.19.1, v1.14.0 |
| `LearningRecord_v1.0.0` | CoreMain v1.18.0, AcademicRecord v1.12.0 | v1.19.1, v1.14.0 |
| `TestScoreReport_v1.1.0` | AcademicRecord v1.11.0 | v1.14.0 |

The parser's namespace resolution is version-insensitive (code fact: the namespace prefix maps
to the type name and the source label strips the version suffix), so type references resolve
against whichever version is present. Recorded here so the round-trip work reads the snapshot
for what it is.

**Known parser silent-drop (recorded 2026-08-03, Phase 0 review; fix is Phase 1 workload):**
the source defines **9** `xs:group` blocks in CoreMain; the incumbent parser emits only **6**.
`DomesticAddressGroup`, `InternationalAddressGroup`, and `GeneralAddressGroup` (CoreMain lines
6963–6992) are silently dropped: their members are self-closing `<xs:group ref="…"/>`
elements, which unbalance the block extractor's depth counter (`lib/parser.js` ~93–116), and
unresolved group references are then skipped without record (~634–645). Any consumer counting
this snapshot's groups against the forge's output should expect 9 in source, 6 emitted, until
the Phase 1 fix lands as a deliberate, reported delta.

## Acquisition class (RT-9): `human-artifact-snapshot`

The files' CONTENT is machine-canonical in character — they are PESC's own published XSD
artifacts (`urn:org:pesc:` namespaces, embedded PESC change logs) — but the committed bytes'
chain of custody does not reach the publisher:

- The bytes were copied 2026-05-28 from a local project directory
  (`A4L/unityObjectGenerator/.../databaseDefinitionss/PESC/schemas`; recorded in
  `standardSourceLocation`). The upstream download URLs were not recorded at harvest.
- pesc.org today (checked 2026-08-03) exposes implementation guides and some bundle zips on
  its approved-standards pages but no direct XSD downloads for these exact vintages, so
  byte-level verification against the publisher was not possible.

The round trip therefore proves the forge is lossless against THIS snapshot; fidelity to
PESC's published intent is only as good as the snapshot, and this README says so. No invented
provenance: nothing above claims a verification that did not happen.

## Acquisition recipe

There is no rerunnable upstream recipe for these exact bytes. The recorded acquisition is the
local copy noted above. To acquire fresh PESC schemas from the publisher, start at
https://pesc.org/approved-standards/ (per-standard pages link current artifacts); a fresh
acquisition is a NEW sibling snapshot directory (02, …) per RT-12 — never an in-place
mutation of 01.

Verify this snapshot:

```bash
cd 01 && shasum -a 256 -c SHA256SUMS --quiet && echo CLEAN
```

## License posture

PESC approved standards are published openly: *"Use, access and downloading of PESC APPROVED
STANDARDS are provided openly and free of charge"*, and derivative products are permitted
(https://pesc.org/approved-standards/, checked 2026-08-03). The XSD files carry no embedded
license text. The bytes are freely committable: all 11 files are committed in git, and as of
2026-08-03 no gitignore entry touches this bundle.

## Version-following (RT-12)

A new upstream PESC vintage is a NEW sibling snapshot directory acquired and checksummed
fresh. Nothing changes until `defaultSnapshot` in `parserDescriptor.ini` deliberately flips.
