# PESC_LD v0.0.2: observations about the upstream source

Evidence first; each item is measured over snapshot 01 (2026-10-21 and 2026-10-22) and each is carried by the forge under a
declared rule, never silently repaired. These are for the publisher (Phil Barker), through BRONZE_CROWN and TQ (plan Q-Z7: one
letter after the demo). The forge does not write to the publisher.

| # | observation | where | how the forge carries it |
|---|---|---|---|
| E1 | a term the profile cites is not defined by the vocabulary it names: `PersonIdentificationShape` row `P001075` ("hasStudentIdentificationSystem") and its four picklist values `NI001075173041`, `…046`, `…047`, `…048` are absent from that vocabulary's release 14 | `person-tap.csv` (the row), its picklist | carried verbatim (the E11 precedent); a bridge names them as orphans |
| E2 | `PersonShape pesc:hasSummary` is `mandatory FALSE` in `person-tap.csv` and `mandatory TRUE` in `summary-related-tap.csv`; the publisher's merged TTL takes TRUE, the combined JSON takes FALSE | the two TAP files | resolved TRUE under `conflictResolutionList`; both values carried in `sourceValueConflicts` |
| E3 | a trailing space on one picklist value (`…NI000057116841 `) and a leading space on one label (`" Has Course Grade Point Average Applicability"`) | `summary-related-tap.csv`, `course-related-tap.csv` | trimmed under the declared whitespace rule; both listed in the walk's stats and as round-trip omissions with their raw text |
| E4 | `pescCreditLevels:Undergraduate` is listed twice in 3 of the `academicSummaryLevel` picklists | `summary-related-tap.csv` | one value node with `listRepeatCount 2` |
| E5 | three picklists are empty (`CourseShape P001298`, `PersonShape pesc:birthCountry`, `pesc:birthStateProvinceCode`) | `course-related-tap.csv`, `person-tap.csv` | `valueConstraintDeclaredEmpty: true`, no option set |
| E6 | `cohortGraduationYear` states `maxLength` with an empty value | `person-tap.csv` | `valueConstraintDeclaredEmpty: true` |
| E7 | the package is named v0.0.2 but its files say v0.0.1 (`PESC Transcript TAP CSVs_v0.0.1.zip`, `CollegeTranscriptContext_v0.0.1.jsonld`); `about.csv` states a date and no version | the package | `publishedVersion 0.0.2` by TQ's naming ruling; the inner v0.0.1 recorded in `README_PROVENANCE.md` |
| E8 | `Severity` is a column of `summary-related-tap.csv` only; the other six files have no such column | the TAP headers | a file without a column states nothing in it (so `hasSummary`'s Severity is `Warning`, from the one file that states it) |

**Not a forge observation, recorded for the bridge report:** `TestScoreShape` row `P000369` draws its picklist from the value family
of a different element (`NI000027…`). Judging that is bridge work (FBB-001); the forge carries the cells as written.

**The combined JSON** (`Application Profile/PESC Transcript TAP_v0.0.1.json`) is lossy (no `note` column) and disagrees with the TTL
on E2. It is not a source.
