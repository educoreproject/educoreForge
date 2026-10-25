# Validation certificate — SEDM (Special Education Data Model), working documents

**SEDM was built from the SEDM working group's working documents: the CEDS Map sheet of "SEDM Logical Model and Maps" (CSV) and the
domain structures extracted from the SEDM Conceptual Model (JSON). The standard's part of the graph has 2,112 content nodes.**
**It holds the 321 elements the sheet flags SEDM, the 28 entities they belong to, their 116 option sets with 1,518 values, one code list
the structures file declares (4 values), and 123 structure nodes (ontology classes, IDEA compliance categories and indicators, standard
event milestones, IEP components, the entity hierarchy, a use case and the 14 Generate ETL templates).**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the CSV and the JSON. Nothing was invented and nothing was lost. What the forge does not carry (the 4,139 rows of the sheet
that are not SEDM, the columns that restate CEDS's own metadata, a vendor extract block, a derived column) is listed below as declared
omissions, not as loss.

| | |
|---|---|
| standard | SEDM (bundle `sedm`, `_source` `SEDM`, family `SEDM`) |
| source | `assets/standardSourceData/01/` (`SEDM Logical Model and Maps - 6. CEDS Map.csv`, `sedm-domain-structures.json`), checked against `SHA256SUMS` at every build; the bytes are git-ignored. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | none recorded: working documents, held in this repository's history at commit `88336881` |
| version | `unknown`: SEDM has no published version (versionSource `unknown`). The JSON's `_meta.version` 1.0 is its extraction's |
| licence | none stated on the held files; downloads are WITHHELD, both facets |
| graph | scratch graphs built 2026-10-24 from `recipes/sedmOnlyRoundTrip.recipe.jsonc` and disposed by name; bridged graph `DEV_nsGSedmBridged` (recipe `sedmBridged`) kept |
| build | `--vectorize=false` standardBase block **`c24886dd6acf1c5267e9ec33c9e281ff638b2a00156de5c888b4096646144cfd`**; vectorised **`2d03411a4ce7b184d39bbfa4c5c058a517ca54b0cb193a6a7485ae90bcb916e0`** (the first vectorised build embedded 1,978 new texts) |
| spend | forge: $0.0033, embedding only; bridges: judge $0.0893 over 319 asked (Jev `jev-1.13.0`, the CTDL facet); the CEDS facet judges nothing |
| commit | branch `ns/g-sedm` (nextStandards-102326 wave 2, lane G) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the documents | DmeStandardRoot | `SedmRoot` | 1 |
| an Entity of the SEDM-flagged rows | DmeClass | `SedmEntity` | 28 |
| a SEDM-flagged element, one per (Entity, Category, Element Name) | DmeProperty | `SedmElement` | 321 |
| an element's inline Option Set; a JSON code list | DmeOptionSet | `SedmOptionSet` | 116 + 1 |
| a line of an option set ('CODE - Name', or a bare value); a JSON code-list value | DmeOptionValue | `SedmOptionValue` | 1,518 + 4 |
| a JSON structure (ontology class 24, compliance category 16, IDEA indicator 18, event milestone 23, IEP component 15, entity hierarchy 12, use case 1, ETL template 14) | DmeSupport | `SedmOntologyClass` … `SedmEtlTemplate` | 123 |
| a name or description text (search) | DmeEmbedText | `SedmEmbedText` | 707 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → entity | the record's Entity | 28 |
| `HAS_PROPERTY` | entity → element | the record | 321 |
| `HAS_OPTION_SET` | element → option set; root → JSON code list | Option Set; `optionSets` | 117 |
| `HAS_VALUE` | option set → value | each line / value | 1,522 |
| `HAS_SUPPORT` | root → structure node | each structure item | 123 |
| `REFERENCES` `etlTemplate` | element → ETL template | a `Y` in that template's column | 341 |
| `REFERENCES` `subtypeOf` / `subcomponentOf` | sub-item → item | `subtypes`, `subcomponents` | 18 + 5 |
| `REFERENCES` `complianceCategory` | indicator or milestone → compliance category | `complianceCategory` | 18 + 23 |

- **Scope.** A record is SEDM when its `SEDM` column is non-empty (326 records: `y` 231, `SC` 88, `?` 6, `D` 1); five pairs of records
  repeat one element in two domains and are one node each. The other 4,139 records of the sheet are the annotated CEDS element list.
- **Text.** An element carries its `Definition` verbatim as `description` (320 of 321); 53 structure nodes carry their own definition,
  description or note; entities and option sets carry none (the documents state none).
- **The Global ID column** (`Global ID (CEDS)`) is carried verbatim as `globalIdText` (230 six-digit, 3 `Proposed`, 88 absent) and
  resolved nowhere in the forge (FBB-001). The `Ed-Fi Map` column is carried verbatim as `edfiMapText` (111) and never resolved.
- **Flags carried verbatim:** `sedmFlag`, `ssemFlag`, `sedmComplianceFlag`, `sedmIepFlag` (95), `mwtmFlag`, `hiFlag`,
  `ideaIndicator9And10Flag`, the North and South Carolina flags, `sedmDataSource`, `sedmScopeList`, `domainList`, `format` (124), `category`.

## The counts

The round trip compared every carried cell, every option line, every ETL flag, and every structure field and reference:
**inventedTotal 0, lostTotal 0**, in the graph built without vectors and in the graph built with them. Declared omissions, 5,993 in all:

| kind | what | count |
|---|---|---:|
| `outOfScopeRecord` | a record whose SEDM cell is empty | 4,139 |
| `restatedMetadataColumn` | Use Case / Connection, Element Change Status, Change Notes, Usage Notes, Alternate Name, Data Model ID, New Association, URL, Technical Name: CEDS's own per-element metadata, restated on the sheet | 1,374 |
| `derivedColumn` | `In any ETL template?`, omitted only where it equals the OR of the 14 ETL columns (it does on every row) | 178 |
| `noOptionSetText` | the cell text `None` | 115 |
| `listTerminator` | an option-set cell's trailing line break | 113 |
| `vendorExtractColumn` | the PowerSchool / ECATS student-extract block (four records) | 60 |
| `whitespaceTrimmed` | the raw text of a trimmed cell | 7 |
| `restatedCsvElement` | the JSON's three proposed milestone elements (each is a CSV record) | 3 |
| `groupDescription`, `extractionMetadata` | the JSON's two section headers and its `_meta` | 2 + 1 |
| `restatedOptionSet` | the JSON's `primaryDisabilityType`: equal, code for code and name for name, to the Primary Disability Type element's own set | 1 |

The columns `TQ's IEP Model` and the unnamed column beside it, and `SC Provisioning`, are empty in all 4,465 records; the forge refuses
the snapshot if any of them gains content.

## Round Trip Validation

The validator (`roundTripValidator.js`, the pair `lib/sedmRoundTripPair.js`) reads the snapshot and the materialised graph separately; it
shares only the strict CSV tokenizer (`forges/pescld/lib/pescldCsvReader.js`) and the two profiles' names. A derived column that disagrees
with its 14 columns, a code list that differs from the element's set, or a proposed element the sheet lacks is a statement no graph can
return, so it is lost and the check goes red (`test/test-sedmForge.js`: 11 graph twins and 1 source twin observed red).

## Known issues

- **CEDS bridge (declared identity, zero judge).** 230 elements give a six-digit Global ID; 217 resolve to a CEDS property term card
  (169 distinct) as EXACT_MATCH. **13 do not (10 ids), and get no edge:** 001066 Address Type for Organization (K12 School, LEA: CEDS 14
  holds it only as the class C001066; a property is never mapped to a class card), 001071 Student Identifier (K12 Student, Parent/Guardian),
  001070 Staff Member Identifier, 000016 American Indian or Alaska Native, 000020 Asian, 000034 Black or African American (K12 Student,
  PS Student), 000192 Native Hawaiian or Other Pacific Islander, 000301 White, 000973 Demographic Race Two or More Races, 000144 Hispanic
  or Latino Ethnicity. None is a CEDS 14 property term.
- **Two names disagree** between the sheet and the CEDS card its Global ID names: 001943 Race (CEDS "Has Race And Ethnicity") and 000070
  Credential Issuance Date (CEDS "(Deprecated) Credential Issuance Date").
- **Scope by the SEDM column only.** 122 further K12 Student records have an empty `SEDM` cell but a non-empty `SEDM Compliance`,
  `SEDM IEP`, `MWTM` or `SSEM` cell (mostly `?`); they are not in the graph (BRONZE_CROWN ruling 1).
- **The 88 `SC` elements** (South Carolina state fields, entity names of SC's own system such as `Incidents`, `Users/Staff`) carry no
  Global ID and so have no CEDS edge.
- **CTDL bridge (judged).** 319 of 321 elements judged, 256 abstained (80%; IDEA compliance has almost no credential counterpart), 63
  edges: EXACT 6, CLOSE 25, BROAD 25, NARROW 7. Two elements had no candidate (`K12 Student / Discipline / Discipline Method for Firearms
  Incidents`, `… / IDEA Discipline Method for Firearms Incidents`). Edges that look wrong on sight: `Assessment Performance Level Label`
  CLOSE CTDL `At Level`; `Assessments / Assessment` CLOSE `Name`; the `Other First Name` / `Other Last Name` alias elements matched to
  CTDL's `Given Name` / `Family Name` (EXACT / CLOSE) as if they were the legal name; the LEA and school identifiers matched to CTDL
  `NCES ID` with CLOSE in some places and NARROW in others. The staff credential dates (Issuance, Expiration) were not matched.
- The JSON's three proposed milestone elements differ from their CSV records in two texts (Type's format, Description's definition); the
  CSV records are the elements.

## Provenance

Held working documents (TQ ruling 2026-10-23: "yes, attic"), recovered from commit `88336881` and checked against `SHA256SUMS`; the same
files are in `educoreForgeOLD`. When a published SEDM artefact appears it replaces them as a new snapshot.

## For more information

`assets/standardSourceData/01/README_PROVENANCE.md`, `lib/sedmSourceProfile.json` (every column's carriage), `lib/sedmStructuresProfile.json`,
`bridges/sedmHubPairing.json` (the CEDS identifier form) and `system/management/zNotesPlansDocs/nextStandards-102326/DESIGN-G0-sedm-102426.md`.
