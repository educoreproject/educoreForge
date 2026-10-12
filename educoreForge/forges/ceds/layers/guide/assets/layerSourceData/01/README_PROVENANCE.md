# PROVENANCE — CEDS layer `guide` snapshot 01 (CEDS Ontology Guide Version 14, Appendix A)

Pinned by lane DES (RADIANT_HORIZON), campaign cedsRichness-101226, 2026-10-12, from lane INV's harvest
(`educoreForge/system/dataStores/sourceData/cedsPublications-101226/`).

| file | sha256 | what |
|---|---|---|
| `CEDS_Ontology_Guide_Version_14.pdf` | a58690b6a0d60a18587c18740722997c66d63ee4d463dff3ac6cf428d7eac244 | https://github.com/CEDStandards/CEDS-Ontology, commit **77e1ef1774842ed8d5236530c3149b66783682cc** (2026-06-01), `doc/CEDS_Ontology_Guide_Version_14.pdf` |
| `ontologyGuideV14-conceptualModelConcept.tsv` | see SHA256SUMS | the eight concepts and their definitions (guide p. 6), order checked against Appendix A's numbered list (p. 24) |
| `ontologyGuideV14-tableA1-classConcept.tsv` | see SHA256SUMS | Table A-1: 400 classes -> primary / secondary concept |
| `ontologyGuideV14-tableA2-dateEventProperty.tsv` | see SHA256SUMS | Table A-2: 204 date properties that are Events |

- **TRAP: the V14 guide is NOT at the CEDS-Ontology tag V14.0.0.0** (15b964d, 2026-03-11; `doc/` there holds the Version 12
  guide). It was committed three months later, at 77e1ef1. Pin the commit, not the tag.
- **Licence: Apache-2.0** (CEDS-Ontology LICENSE, copied verbatim beside this file).
- **The TSVs are DERIVED** from the PDF by `forges/ceds/layers/guide/tools/extractGuideAppendixA.py` (pdfplumber, word positions
  against each table's own header; re-run it with lane INV's venv `dataStores/sourceData/cedsPublications-101226/zTools/venv`).
  **Checked by eye** against the rendered PDF pages 6, 24, 25, 40 and 49 on 2026-10-12. That check caught a real defect in the
  first, line-based extraction: 106 Table A-2 property names and 15 Table A-1 class names had lost their wrapped second line.
- The layer forges the TSVs; the PDF is checksummed beside them so the derivation can always be re-run and compared.
