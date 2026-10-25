# Validation certificate — MedBiquitous (AAMC health professions education standards)

**MedBiquitous was built from the publisher's own XML Schema files: the repository github.com/medbiq/medbiq, master `8f5c74a5`.**
**The standard's part of the graph has 3,512 content nodes. It covers 37 schema files in fifteen schema sets, with every complex type, every field (element, attribute, element ref=), and every enumeration. Every QName reference to a forged definition is an edge.**

Accuracy was checked by round trip. The live graph was read back into source statements and compared, one by one, with an independent reading of the XSD files' element trees: every element at its locator, every attribute, every documentation text and every comment. Nothing was invented and nothing was lost. Ten files of the snapshot are deliberately not read (the SOAP service files, two request/response wrapper schemas and two unreachable duplicates); they are listed below.

| | |
|---|---|
| standard | MedBiquitous, the AAMC MedBiquitous Program's XML Schema portfolio, as ONE standard (bundle `medbiq`, `_source` `MedBiquitous`, family `MEDBIQ`) |
| source | `assets/standardSourceData/02/`: 47 publisher files at the repository's own paths, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/02/README_PROVENANCE.md` |
| source URL | `https://github.com/medbiq/medbiq` (commit `8f5c74a51bf6721fa1f0b57f2d9c4b51496bb566`, 2025-08-28) |
| version | `unknown` by design: a portfolio states no single version; each standard's version is in its namespace (`activityreport/v2`, `member/v2`, …) |
| graph | `DEV_nsIMedbiqBridged` (recipe `medbiqBridged`, kept running for the wave-3 assembly); the `medbiqOnlyRoundTrip` graphs were disposed by name |
| build | standardBase block, unvectorised: **`a02209506acaca7fe8f02beeee6848b43ba475f987dd36bf229bc3e9906c4607`**. Vectorised: **`25988d58fc05010d884b5af3284e7e40454e39ea99c75aa76e3eddcc0395d102`** (embeddingCacheOnly, 0 misses) |
| spend | Forge: $0.0023 of embeddings, 3,376 new vectors, in the wave-3 embed turn. Bridges: $0.7172 of judgment over 2,455 asked, in the one real run |
| commit | branch `ns/i-medbiq` (nextStandards wave 3 lane I), built at `c251d33a` from the pinned worktree `nsIbuild` |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the portfolio | DmeStandardRoot | `MedbiqRoot` | 1 |
| a forged schema file | DmeSupport | `MedbiqSchemaFile` | 37 |
| a named or anonymous `complexType` | DmeClass | `MedbiqComplexType` | 560 |
| a local element or attribute, an `element ref=` or an `attribute ref=` | DmeProperty | `MedbiqField` | 1,768 |
| a `simpleType` of enumerations | DmeOptionSet | `MedbiqOptionSet` | 146 |
| one enumeration | DmeOptionValue | `MedbiqOptionValue` | 624 |
| a global element, group, attribute group or other `simpleType` | DmeSupport | `MedbiqSupport` | 376 |
| a name, description or field path text (search) | DmeEmbedText | `MedbiqEmbedText` | 2,825 |

**Edges.**

| Edge | Count | What it joins |
|---|---:|---|
| `HAS_SUPPORT` | 37 | root to a schema file |
| `HAS_CLASS` | 536 | root to a named complexType |
| `HAS_DEFINITION` | 519 | file to its other definitions |
| `HAS_PROPERTY` | 1,768 | owner to a field |
| `HAS_VALUE` | 624 | option set to a value |
| `REFERENCES_TYPE` | 1,206 | a field or element to its type (including anonymous types) |
| `HAS_OPTION_SET` | 129 | a field to its enumeration type |
| `REFERENCES` | 504 | an element ref=, a group or attribute-group ref=, or a substitution group |
| `SUBCLASS_OF` | 180 | an extension or restriction base |

Every reference edge carries `referenceConstruct`, `writtenQName` and `atLocator`.

**Schema sets.** The fifteen sets are each standard's current version:

- Activity Report v2
- Competency Framework v1
- Competency Object v1
- Curriculum Inventory v2
- Educational Achievement v1
- Educational Trajectory v1
- Entrustment Scale v1
- Financial Interest v1
- Healthcare LOM v2
- Journal v1
- Medical Education Metrics v2
- Performance Framework v1
- Professional Profile v2
- Survey Items v1
- Virtual Patient v1

The legacy v1 libraries (member, address, name, activityreport, curriculuminventory) come in only because current standards import them. The IEEE LOM binding comes in because Healthcare LOM includes it. Its ids name IEEE's namespace (`ltsc.ieee.org/xsd/LOM`).

**Text.** A node's description is its own `xs:documentation`, carried verbatim. Only 34 complex types, one simple type and one global element have one. **No field does.**

Each field also carries:
- `contextText`: `<owning type>.<field>`, which is embedded beside its name;
- `optionValueNameList`: its enumeration's value names (113 fields);
- `owningTypeDescription`: its owning type's documentation (4 fields).

**Verbatim structure.** Compositors, facets, wildcards, imports, identity constraints and every comment ride verbatim on `xsdStructureList`. The comments include the publisher's copyright and licence notices.

## The counts

The round trip compared every element, attribute, documentation text and comment of the 37 forged files: **inventedTotal 0, lostTotal 0**. That held in the graph built without vectors, the graph built with them, and in every earlier build of this lane.

The declared omissions are 10, all of kind `excludedSchemaFile`:
- the six SOAP `.wsdl` files;
- `activityreport/service/v2/activityreporttypes.xsd` and `member/service/v2/membertypes.xsd`, which hold request/response/result wrappers only;
- `competencyobject/v1/competency_object.xsd` and `common/v2/attachment.xsd`, the unreachable duplicates (`README_ERRATA.md` E2).

**Bridges.** There is one judged facet, toward both hubs. It covers the 1,229 fields of the current-version files (`bridges/medbiqJudgedSubjects.json`). The judge was Jev `jev-1.13.0`.

| Hub | Subjects asked | No candidate | Abstained | EXACT | CLOSE | BROAD | NARROW | Edges |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CEDS | 1,227 | 2 | 993 (81%) | 46 | 129 | 16 | 43 | **234** |
| CTDL | 1,228 | 1 | 1,060 (86%) | 44 | 96 | 20 | 8 | **168** |

A replay over the real run's judgment cache asked 0. Its 402 edges are byte-identical to the real run's (sorted diff, empty).

## Round Trip Validation

The validator is `roundTripValidator.js`, using the XSD kit's pair `lib/xsd-forge/xsdRoundTripPair.js`. It reads the snapshot's bytes through the kit's element-tree reader, never through the walk. It reads the materialised graph separately.

A locator is the element's local tag and its index among same-tag siblings, so a prefix is not a statement. The `xmlns` bindings are statements.

A node property the reader cannot account for counts as invented. Several derived values are CHECKED rather than stated:
- descriptions;
- `contextText`;
- the option-value names;
- owning-type descriptions;
- reference names;
- ownership edges;
- every reference edge, which the reader re-resolves from the graph alone.

## Known issues

- **No field has documentation** (`README_ERRATA.md` E6). Both retrieval and the judge see names, paths, types and value names only. Abstention is therefore high: 81% toward CEDS and 86% toward CTDL. Some edges look wrong on sight, for example:
  - `AddressType.Organization` → CEDS "Has Address Type for Organization";
  - `CertificationInfoType.CertificationStatus` → CEDS "Has EDFacts Certification Status";
  - `ResourceUsedType.CollectionID` → CEDS "Source System Data Collection Identifier".
- **Types are copied across schemas** (E7, e.g. `RegulatoryInformationType`). Each copy is its own node. The judge view carries `schemaFile` so copies render distinctly.
- **The Educational Achievement schema extends a PESC AcademicRecord type.** That reference is carried as written, `AcRec:EducationTestScoresType`, and is never resolved: PESC is another standard of this graph.
- **The IEEE LOM binding is IEEE's**, carried as MedBiquitous ships it. It is not judged.
- `selfDescribedVersion` is null and the version is `unknown`: the portfolio has no single version.

## Provenance

Snapshot 02 is the publisher repository at commit `8f5c74a5`. Snapshot 01, the copy held since 2026-06-23, is byte-identical for all 33 of its files (`CHANGES-medbiq-01to02-102526.md`). The namespace site `ns.medbiq.org` serves older bytes and was not used (E5).

The licence is the MedBiquitous Standards Public License and Terms of Use (AAMC, 2020-06-03), https://www.medbiq.org/license. Both download facets are offered, with the notices in `assets/standardSourceData/02/LICENSE`. The graph is a derivative made by educoreForge, not an official MedBiquitous specification.

## For more information

- `README_identityRules.md` and `README_ERRATA.md`
- `assets/standardSourceData/02/README_PROVENANCE.md`
- `lib/xsd-forge/README.md`, the kit
- the lane's designs in `system/management/zNotesPlansDocs/nextStandards-102326/`: `DESIGN-K3-xsdKit-102426.md` and `DESIGN-I0-medbiq-102526.md`
