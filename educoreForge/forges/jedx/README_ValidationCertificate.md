# Validation certificate — Jobs and Employment Data Exchange (JEDx)

**JEDx was built from the JEDx Open API Specification 1.0.0. The HR Open Standards Consortium publishes it for the JEDx Working Group as four OpenAPI 3.1.0 bundles. The standard's part of the graph has 2,213 content nodes.**
**The graph holds all 191 schemas of the four bundles as one model: 149 classes and 42 code lists with 1,201 values. It also holds their 665 properties, 16 inline objects that copy no schema, and 15 enumerations local to a property. Each place where a bundle copies a schema in full is kept as one reference to that schema.**

Accuracy was checked by round trip. Each bundle's `components.schemas` was read back out of the live graph and compared, statement by statement, with an independent reading of that bundle. Nothing was invented and nothing was lost. The rest of each document is deliberately not carried and is listed below: its API (paths, servers, tags, info, externalDocs) and its non-schema components.

| | |
|---|---|
| standard | JEDx (bundle `jedx`, `_source` `JEDx`, family `JEDx`) |
| source | `assets/standardSourceData/02/openApiBundles/` (four files, checked against `SHA256SUMS` at every build; the bytes are git-ignored, so the acquisition recipe is in `02/README_PROVENANCE.md`) |
| source URL | `https://github.com/HROpen/APISpecifications/tree/707ec7d3741df46f6973411e5dd75c756cf3d7d7` (branch `development`, 2026-02-12) |
| version | `1.0.0`: every bundle's `info.version`, which agrees with `standardSourceLocation` (versionSource `spec`). The inlined HR Open types carry their own versions, 4.3.0 and 4.5.0. |
| graph | scratch graphs built 2026-10-24 from `recipes/jedxOnlyRoundTrip.recipe.jsonc` and disposed by name |
| build | `--vectorize=false` standardBase block **`350c87c9ab304caef95a9b8d9105611beba6b253679be2c8284531fb1a32815c`**; vectorised **`004d803ebfcc3b9466fc7b9075b18efd377825aed74777edb0b21598afdc0a73`** (the first vectorised build embedded 3,479 new texts) |
| certification | `graphBuilder -goldEvalCheck --manifestRefId=e8a56ed3…7339`: **PASS** (1 of 1 manifest member certified; 1 validator, inventedTotal 0) |
| spend | $0.0047, embedding only; judge $0 |
| commit | branch `ns/b-jedx` (nextStandards-102326 lane B), head `ac7873a8` at the builds |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the specification | DmeStandardRoot | `JedxRoot` | 1 |
| a `components.schemas` member that is not a code list | DmeClass | `JedxSchema` | 149 |
| an inline object that equals no schema (16 sites) | DmeClass | `JedxSchema` | 16 |
| a property of a schema or of an inline object | DmeProperty | `JedxProperty` | 694 |
| a code-list component (an HR Open `…CodeList`) | DmeOptionSet, owned by the root | `JedxEnum` | 42 |
| an enumeration written at a property | DmeOptionSet, owned by the property | `JedxEnum` | 15 |
| a code-list or enumeration member | DmeOptionValue | `JedxEnumValue` | 1,296 |
| a name or description text (search) | DmeEmbedText | `JedxEmbedText` | 1,381 |

| Edge | From → to | Count |
|---|---|---:|
| `HAS_CLASS` | root → component schema | 149 |
| `HAS_PROPERTY` | schema → property | 694 |
| `REFERENCES` | property or schema → the schema or code list it copies, with `referenceConstruct` and `locator` | 625 |
| `HAS_OPTION_SET` | root or property → code list / enumeration | 57 |
| `HAS_VALUE` | code list → member | 1,296 |

REFERENCES by construct: `inline` 402, `inlineItems` 128, `allOf` 52, `definitions` 28, `anyOf` 9, `items` 5, `inlineObject` 1.

- **One model, four files.** A schema appears once however many bundles hold it; `bundleMembership` lists them.
- **References recovered by content.** The bundles are fully dereferenced and contain 0 `$ref`. An inline copy that equals exactly one component, setting aside its top-level `description`, is a REFERENCES edge to that component. That accounts for 609 sites, 6 of which are ties broken by `title`.
- **Text.** Each schema and property carries its JSON Schema `description` verbatim: 180 of 191 schemas and 652 of 694 properties have one. A property's description is the text written at that property, not the description of the type it copies.
- **Carried keywords.** Carried as data: the HR Open `title` (as `schemaTitle`), `version` (`schemaVersion`), `$schema`, `enumNames`, `hropenFormat`, `links`, `pattern`, `format`, `minimum`/`maximum`/`exclusiveMinimum`, `minProperties`, `minItems`, and `required` (as `isRequired`).

## The counts

The round trip compared every statement of each bundle's `components.schemas`: **inventedTotal 0, lostTotal 0, contentGapTotal 0**. That held in the graph built without vectors and in the graph built with them. A recovered reference counts as one statement (`$match` of the component) plus the site's own description. The copy's body is stated once, under the component. Declared omissions, 292 in all: each bundle's `openapi`, `info`, `servers`, `tags`, `externalDocs` and `paths`, and its `components.responses`, `.parameters`, `.headers` and `.requestBodies`.

## Round Trip Validation

The validator (`roundTripValidator.js`) uses the kit's pair for this layout (`lib/openapi-forge/openapiDereferencedRoundTripPair.js`, reached through `openapiLayout.roundTripPairFor`). It reads the snapshot and the materialised graph separately, each with its own canonical-JSON function. Enum members and `required` are compared as sets. A node property the reader cannot account for counts as invented. `test/test-jedxForge.js` (29 assertions) drives the same validator over an in-memory graph. Four perturbations each turn it red: a recovered reference dropped, a code-list value dropped, a description altered, and a schema's file membership narrowed.

## Known issues

- Some components carry another type's title. `CompetencyTypeCodeList` is titled `WeekdayCodeList` and described as days of the week (README_ERRATA E10). Titles are carried as published and are never used for identity.
- The bundles mix HR Open 4.3 and 4.5 types and use non-standard version strings ("4.3.x", "4.5") (E3).
- **Coverage gap toward both hubs: the compensation and paid-hours reports.** The ten report schemas (WorkerCompensationReportNounType, WorkerPaidHoursReportNounType, DirectCompensationType, WorkedHoursType, TimeOffHoursType, TaxableCompensationType, WorkerWithholdingType and their amounts) hold 60 properties. The judged bridges (DEV_nsBJedxBridged, 2026-10-24) give them 17 CEDS edges and 7 CTDL edges, and 38 of the 60 have no edge to either hub. This reflects what the hubs contain, not a forge defect: CEDS carries little payroll and CTDL is a credential vocabulary. Overall abstention was CEDS 436 of 694 (63%) and CTDL 554 of 693 (80%).
- Twelve schemas are API message envelopes (`*-schema_v1`, `ConfirmMessageType`, `MetaType`, …). They are in the graph and in bridge retrieval.
- Downloads are withheld until TQ reads §2.f of the HR Open License Agreement (the Standards Organization clause). The graph itself is unaffected.

## Provenance

Acquired 2026-10-23 by an anonymous public clone; no account was created and no licence was accepted. The publisher's website calls 2024-10-15 "Final", but the repository carries later changes to the same files. The newer transport objects (`02/transportObjects/`) are kept beside the snapshot and are not read. The July CSV (snapshot 01) is an export of an earlier version of those transport objects (`CHANGES-jedx-01to02-102326.md`). Notices required by the HR Open License Agreement: `02/README_PROVENANCE.md`.
