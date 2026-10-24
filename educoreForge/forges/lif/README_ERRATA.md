# LIF 2.0 — upstream observations (ERRATA)

Observations about the publisher's document `lif-schema.json` (snapshot 02, lif-core `290987a0`, sha256 `b79598bb…36c3bc`), each with its
evidence. The forge carries every one of them as written or omits it BY DECLARATION (`lib/lifOpenapiProfile.json`
`statementOmissionDeclaration`); none is repaired. Measured 2026-10-24 by STEEL_MIRROR (nextStandards-102326 C0/C1) with `python3 -I` over
the snapshot and on the forged output.

| # | observation | evidence | how the forge carries it |
|---|---|---|---|
| E1 | empty strings stand for "nothing stated" | `example` is `''` on all 1,261 leaf properties; `format` `''` on 1,126; `use_recommendations` `''` on 847; `description` `''` on 179 | declared omitted (`emptyValueStatement`), counted per keyword; never carried as text |
| E2 | `required: []` on six objects | six inline objects state an empty required list | declared omitted; `isRequired` false on their properties |
| E3 | an enum lists a member twice | `Person.Consent.lifEntities` (56 members): `Image` twice | declared repeat: carried once (55 values), the repeat omitted (`repeatedEnumMember`) |
| E4 | a class holds `identifier` and `Identifier` | `Organization`, `Course`, `CompetencyFramework.Competency`: `identifier` a string, `Identifier` an object (the identifier envelope) | two properties, distinct case-sensitive ids |
| E5 | arrays with properties | all 8 entities and 54 nested objects are `type: array` with `properties` and no `items`; JSON Schema applies `properties` to objects only | carried as written: the class's `dataType` is `array` (read "a list of these") |
| E6 | `format` repeats the type | `format: "string"` 129, `"boolean"` 4, `"number"` 2 | verbatim as `dataFormat` |
| E7 | references by NAME, not by `$ref` | 77 properties named `...Ref<Entity>` (`awardedByRefOrganization`, `InstanceOfRefCredential`, `RefCourse`), each an inline object of the target's identifier fields; 36 name an entity, 41 a nested object | carried as inline classes; NO edge to the named entity (ruled 2026-10-24: no name inference). Open item |
| E8 | six descriptions cite a CEDS element | `ceds.ed.gov/element/NNNNNN` in `Assessment.subject` (000021), `Credential.level` (001301), `Position.JobCode.jobCodeValue` (000731) and three `Person.EmploymentLearningExperience` properties (000988, 001342, 001412) | verbatim in the description; the forge reads nothing in it (FBB-001) |
| E9 | spelling in `use_recommendations` | "accidentaly" (26 occurrences), "useage" (28) | verbatim |
| E10 | `info.description` is "OpenAPI Spec" | `info` | the root's description, verbatim (it describes the format, not LIF) |
| E11 | lif-data-model's `lif.json` lags lif-core | same size, older (2025-12-05); spells `instanceOfRefCredential` where lif-core's fix of 2026-09-08 reads `InstanceOfRefCredential` | not the source (snapshot 02 README_PROVENANCE.md) |
| E12 | the held A4L export (snapshot 01) carried two test entities | `TammieEntity`, `Frank Test Entity`; otherwise the same 1,393 property paths | record only; not forged |
