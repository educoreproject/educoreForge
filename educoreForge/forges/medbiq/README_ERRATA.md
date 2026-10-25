# MedBiquitous: errata found while forging (snapshot 02, publisher repository master 8f5c74a5)

Each item is a publisher-side defect or oddity. Every one was measured, and each says how the forge carries it.

| | Finding | How the forge carries it |
|---|---|---|
| E1 | `lomv2/healthcare/healthcaremetadata.xsd` `repurposingContextType` lists `http://purl.org/meducator/repurposing#Different-Technology` twice (enumerations 7 and 9). | Declared in the profile's `enumerationRepeatList`. The second occurrence is carried verbatim on the option set; one value node. |
| E2 | `competencyobject/v1/competency_object.xsd` re-defines 5 names of `competencyobject.xsd` in the same namespace. `common/v2/attachment.xsd` re-defines 7 names of `common.xsd`. No import of the portfolio reaches either file. | Excluded by name, with the reason. |
| E3 | `entrustmentscale/v1/entrustmentscale.xsd` writes `../lom/healthcarelom.xsd` and `../common/v2/common.xsd`. Relative to `entrustmentscale/v1/` these reach no repository file (`../../` would). | Two `schemaLocationTable` rows. |
| E4 | `common/v2/common.xsd` imports the XML namespace with `schemaLocation="http://www.w3.org/2001/xml.xsd "`, which has a trailing space. | Foreign namespace; the location is carried as written. |
| E5 | `http://ns.medbiq.org/` serves OLDER bytes than the repository. Example: `member/v2/member.xsd` is the 2017 edition there and the 2025-03-31 edit here. | The repository is the source of record. |
| E6 | No element or attribute carries `xs:documentation`: 0 of 1,768 forged fields. Only 34 complex types and 2 other definitions are documented. MedBiquitous defines its terms in PDF specifications. | The judge view and the embed texts use the standard's structure (path, type, values) instead. |
| E7 | Types are copied between schemas in different namespaces. For example, `RegulatoryInformationType` appears in Activity Report v2 and Medical Education Metrics v2; 34 such groups cover 76 judged fields. | Each copy is its own node, keyed on its namespace. The judge view carries `schemaFile`, so the copies render distinctly. |
