# PESC source corpus — aggregate version 01

**Cut:** 2026-08-05 (session VELVET_COMPASS)
**Bundle:** `pesc260805`
**Contents:** 64 XSD files, 9,733,713 bytes

---

## THIS AGGREGATE VERSION IS OURS

PESC publishes **no coherent whole-family release**. Each standard is published separately, each
pinning its own library versions, with no index, no changelog and no bundle. The number `01` above
is an *educoreForge* aggregate version, cut by us on the date shown. **It must never be read as a
PESC edition.** Every constituent is recorded in `manifest.json` at its real published version.

## Composition rule

Every artifact linked from the PESC standards pages, plus the published Request/Response ZIP and the
OCAS legacy mirror, retained **if and only if** it parses as XML and declares a `urn:org:pesc:*`
targetNamespace.

**Filenames are derived from the `targetNamespace`, never from anchor text.** PESC's CDN serves
`application/octet-stream` with no `content-disposition` header and no filename anywhere in the HTTP
response; the anchor label on the linking page is the only human-readable identity. Deriving the
name from the namespace means the file names itself and a mislabelled link cannot produce a misnamed
file.

## Repair policy: NONE

**This corpus is a faithful mirror of what PESC published, including its contradictions.**

All merging, aliasing and synthesis belongs to the **forge**, and is recorded in forge output. No
repaired, merged or substituted artifact appears here. If you find one, it is a defect.

## The recorded contradiction

Two different files both declare `urn:org:pesc:sector:AcademicRecord:v1.6.0`, both carrying
`version="v1.6.0"`:

| filename | bytes | complexTypes | imports CoreMain | carries |
|---|---:|---:|---|---|
| `AcademicRecord_v1.6.0.collision-<hash>.xsd` | 61,549 | 49 | 1.10.0 | `RequestType`, `ResponseType`, `TranscriptHoldType` |
| `AcademicRecord_v1.6.0.collision-<hash>.xsd` | 71,232 | 62 | 1.7.0 | `TestScoreReportType`, `EducationTestScoresType` |

(The `<hash>` is the first twelve characters of each file's sha256 — see `manifest.json`.)

**Six substandards import that namespace and NEITHER file satisfies all six.**
`TestScoreReport v1.0.0` references exactly one type in its entire file, `AcRec:TestScoreReportType`,
which exists only in the larger copy; the three legacy Transcript roots and two transcript standards
need `RequestType`/`ResponseType`, which exist only in the smaller.

This is PESC's defect. **Both files are members. Acquisition chooses neither.**

## Known open item, NOT repaired here

`CoreMain v1.6.0` is required by `AcademicRecord v1.5.0` and is linked from no PESC page found. It
is the only unresolved import in the corpus. Two old roots depend on it — College Transcript 1.2.0
and High School Transcript 1.1.0. Substitution is a forge decision, recorded in forge output.

## Acquisition hazards, recorded so they are not rediscovered

- **Hrefs carry entity-encoded ampersands.** Left unescaped, the CDN's `AccessKeyId` query string
  arrives malformed and **every request returns HTTP 401**. This cost one complete failed run
  (112 false refusals) before diagnosis.
- **Five CDN links return HTTP 410 Gone**, and they are exactly the newest schema block — CoreMain
  1.19.1, AcademicRecord 1.14.0, ISO 3166, Request, Response. That block appears on *every*
  academic-record standard page and is dead on all of them. Those files survive only inside
  `https://pesc.org/wp-content/uploads/2025/11/Academic-College-Transcript-Request-Response-v1.0.zip`.
- **An earlier ad hoc harvest saved four HTTP error bodies** — 27 bytes of
  `{"error":"asset-not-found"}` — under schema filenames. The acquisition refuses any artifact that
  does not parse as XML and declare a PESC namespace, so this cannot recur.
- **The three legacy Transcript roots** (Request, Response, Acknowledgment 1.1.0) are no longer
  linked from pesc.org at all and come from the OCAS mirror at `developer.ocas.ca`.

## Access

Everything here is **free and ungated** — downloaded anonymously, no login, no membership. PESC's
stated policy is that use and download of approved standards are "provided openly and free of
charge," including derivative works. The one genuine paywall in PESC's estate is the EDI transaction
sets, which come from ANSI and are not represented here.

## What this corpus replaced

The incumbent `forges/pesc/` snapshot is **11 files, 1,220,940 bytes**, whose own provenance record
describes it as *"a curated working assembly, not a coherent published release"* with upstream URLs
unrecorded. It holds **one** CoreMain where the family pins **fourteen**, and is missing three of the
twelve message standards entirely.

Governing documents:
`system/management/zNotesPlansDocs/pescForgeRebuild-080526/SPEC-pescForgeRebuild-080526.md`
and `WORKORDER-pescForgeRebuild-080526.md`.
