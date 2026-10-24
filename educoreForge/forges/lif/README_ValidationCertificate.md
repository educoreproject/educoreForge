# Validation certificate — LIF 2.0 (LIF)

**LIF 2.0 was built from the LIF Initiative's OpenAPI 3.0 document `lif-schema.json` (lif-core). The standard's part of the graph has 3,430 content nodes.**
**It holds all 8 entities, the 132 objects nested inside them, all 1,393 properties, and the 23 enumerations with their 1,873 values.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. What LIF states as empty (an empty string, an
empty `required` list) and the one enum member it lists twice are not carried; each is listed below as a declared omission, not as loss.

| | |
|---|---|
| standard | LIF 2.0 (bundle `lif`, `_source` `LIF`, family `LIF`) |
| source | `assets/standardSourceData/02/lif-schema.json`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/02/README_PROVENANCE.md` |
| source URL | `https://github.com/LIF-Initiative/lif-core/blob/290987a08dd08c3a5a01a8833b9a768e3ded69e4/reference_data/schemas/lif-schema.json` |
| version | `2.0` (the document's `info.version`; it agrees with `standardSourceLocation`, versionSource `spec`) |
| licence | Apache License 2.0 (`assets/standardSourceData/02/LICENSE`); downloads are offered |
| graph | scratch graphs built 2026-10-24 from `recipes/lifOnlyRoundTrip.recipe.jsonc` and disposed by name; bridged graph `DEV_nsCLifBridged` (recipe `lifBridged`) kept |
| build | `--vectorize=false` standardBase block **`abadc9405c9999bc0f6044340361a632da42144be25e2d844e5cadea2d8c29a9`**; vectorised **`4e3b7f5707cc6231b7b7db7e5b491d7e39f325f7c90e4cea70a1f8a6c5163cc2`** (the first vectorised build embedded 3,205 new texts) |
| spend | forge: $0.0042, embedding only; bridges: judge $0.8036 over 2,774 asked (Jev `jev-1.13.0`) |
| commit | branch `ns/c-lif` (nextStandards-102326 lane C) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `LifRoot` | 1 |
| an entity of `components.schemas` | DmeClass | `LifSchema` | 8 |
| an object nested at a property (no title: named `<Owner>.<property>.inline`) | DmeClass | `LifSchema` | 132 |
| a property of an entity or nested object | DmeProperty | `LifProperty` | 1,393 |
| the enum in a property's shape | DmeOptionSet | `LifEnum` | 23 |
| an enum member | DmeOptionValue | `LifEnumValue` | 1,873 |
| a name or description text (search) | DmeEmbedText | `LifEmbedText` | 1,089 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → entity | (every entity) | 8 |
| `HAS_PROPERTY` | class → property | `properties` | 1,393 |
| `REFERENCES` | property → its nested object, `referenceConstruct` `inlineObject` | a property whose value is an object | 132 |
| `HAS_OPTION_SET` | property → enum | `enum` | 23 |
| `HAS_VALUE` | enum → member | each member | 1,873 |

- **Text.** A property carries its `description` verbatim: 1,082 do. 179 state an empty description and 132 (the object-valued ones)
  state none. LIF describes no entity, no nested object, no enum.
- **Guidance.** LIF's `use_recommendations` (usage and bias guidance) is carried as `useRecommendations` where it is non-empty: 549
  properties, 5 objects. It is not a definition: it is not embedded and the judge does not see it.
- **Types.** `dataType`, `dataFormat` (LIF often repeats the type here), `isRequired` from each object's `required` list (526 true).
- **Lists.** LIF types all 8 entities and 54 nested objects `array` while giving them `properties`: read it as "a list of these".
- **Members.** A member's id is percent-encoded (578 distinct members contain a space or other character outside the id alphabet, most of them tribal nation names such as `Arctic Village`); its `name` is verbatim.

## The counts

The round trip compared every scalar of `components.schemas` at its JSON pointer: **inventedTotal 0, lostTotal 0**, in the graph built
without vectors and in the graph built with them. Declared omissions, 3,423 in all:

| kind | what | count |
|---|---|---:|
| `outOfScopeByDeclaration` | the document's `openapi`, `info`, `paths` (the API around the data model) | 3 |
| `emptyValueStatement` | `example` `''` (every one of LIF's 1,261), `format` `''` 1,126, `use_recommendations` `''` 847, `description` `''` 179, `required` `[]` 6 | 3,419 |
| `repeatedEnumMember` | `Image`, listed twice in `Person.Consent.lifEntities` (carried once: 55 values) | 1 |

## Round Trip Validation

The validator (`roundTripValidator.js`, the OpenAPI kit's dereferenced pair through `lib/openapi-forge/openapiLayout.js`) reads the snapshot
and the materialised graph separately. The empties and the repeat it omits are the ones the profile's `statementOmissionDeclaration`
names, read by the pair itself: an empty value or repeat the profile does not name is a statement no graph can return, so it is lost and
the check goes red (proven on the real graph and on a synthetic one). `required` and enum members are compared as sets.

## Known issues

- **Six properties are not judged toward any hub.** `Assessment.subject`, `Credential.level`, `Position.JobCode.jobCodeValue` and three
  `Person.EmploymentLearningExperience` properties cite a CEDS element in LIF's own description (`ceds.ed.gov/element/NNNNNN`). The judge
  must never see a hub identifier, so they are out of the judged scope (`bridges/lifJudgedSubjects.json`, derived by rule). They are LIF's
  own declared CEDS correspondences, awaiting a declared bridge (open item).
- **LIF's by-name references are not linked.** 77 properties named `…Ref<Entity>` (`awardedByRefOrganization`, `InstanceOfRefCredential`)
  hold the target's identifier fields; nothing in the source states the reference, so no edge joins them to the entity (open item).
- `identifier` (a string) and `Identifier` (an object) are two properties of `Organization`, `Course` and
  `CompetencyFramework.Competency`; a case-insensitive reader would merge them.
- Every entity and every `…Ref` object repeats an identifier envelope (`identifier`, `informationSourceId`, `informationSourceOrganization`,
  ...): about 588 of the 1,393 properties. The judge read identical envelope fields differently in different places (e.g.
  `informationSourceId` NARROW 66 times, CLOSE 26 times, to the same CEDS card), and mapped `informationSourceOrganization` CLOSE to CEDS
  "Credential Award Issuer Name" 12 times, which looks wrong: it names where the data came from, not who issued an award.
- Abstention: CEDS 616 of 1,387 (44%), CTDL 937 of 1,387 (68%).

## Provenance

Fetched 2026-10-24 from lif-core (commit `290987a0`, unchanged at the repository head `34ca08a4`). `lif-data-model/lif.json` is older and is
not the source. The A4L export held earlier is kept as snapshot 01, record only.

## For more information

`README_identityRules.md` (identity), `README_ERRATA.md` (upstream observations, E1-E12), `assets/standardSourceData/02/README_PROVENANCE.md`,
`lib/openapi-forge/` (the kit) and `system/management/zNotesPlansDocs/nextStandards-102326/DESIGN-C0-lif-102326.md`.
