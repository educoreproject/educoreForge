# PROVENANCE — gate D oracle 01 (CEDS-Elements CEDS-V14.0.0.0.xlsx)

Pinned by lane DES (RADIANT_HORIZON), campaign cedsRichness-101226, 2026-10-12 (COPPER_RIVER ruling Q5). **Not forged.** An
independent rendering of the CEDS 14.0.0.0 release, held against the RDF compiled from every built graph, inside CEDS's own
round-trip verdict (`forges/ceds/roundTripValidator.js`, `lib/elementsWorkbookOracle.js`).

| file | bytes | sha256 | from |
|---|---|---|---|
| `CEDS-V14.0.0.0.xlsx` | 12,200,901 | a92c2d4239dc682ac408de94e728c368196d47b71199f78288db8414cdc1f523 | https://github.com/CEDStandards/CEDS-Elements, commit **b5937e8a0f19c1c660e1e122ad6561c200a1bcde** (2026-03-05), `CEDS-V14.0.0.0.xlsx` |

- **Licence: Apache-2.0** (CEDS-Elements LICENSE, copied verbatim beside this file).
- `oracleDescriptor.json` names the exact ontology bytes this workbook renders (CEDS-Ontology.rdf sha256 26d782b6...). The gate
  runs only against that release and reports itself NOT APPLICABLE against any other, by name: a new CEDS release needs a new
  workbook here, deliberately.
- The rendering rules (restriction blocks, generic rdf:types, empty literals) live in `gates/elementsWorkbookOracleLayout.json`;
  the five places the workbook and the ontology genuinely disagree are declared, each with its reason, in
  `gates/elementsWorkbookDeclaredDifferences.json`.
