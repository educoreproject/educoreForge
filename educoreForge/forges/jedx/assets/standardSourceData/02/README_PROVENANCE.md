# Snapshot 02: the JEDx Open API Specification (provenance, acquisition, licence)

Created 2026-10-23 by SILVER_SPIRE (Programmer B, nextStandards-102326 lane B; supervisor BRONZE_CROWN). Work order: `system/management/zNotesPlansDocs/nextStandards-102326/WORKORDER-jedx-102326.md`; acquisition report: `GATEREPORT-B0-102326.md` in the same folder.

## Copyright and licence notices (HR Open License Agreement §2.c, §2.d, §2.e)

> Copyright © The HR Open Standards Consortium. All Rights Reserved. http://www.hropenstandards.org

> This product implements and complies with the JEDx Open API Specification Version 1.0.0 (HR Open Standards schema types 4.3.0 and 4.5.0) as published by the HR Open Standards Consortium at http://www.hropenstandards.org

A copy of the HR Open License Agreement (May 1, 2014) is carried beside these bytes in `licence/HR_Open_Standards_License_Agreement-cf2ff5d3.pdf`, fetched 2026-10-23 from the publisher's public asset URL `https://assets.noviams.com/novi-file-uploads/hropen/pdfs-and-documents/Legal_Terms/HR_Open_Standards_License_Agreement-cf2ff5d3.pdf` (sha256 in `licence/SHA256SUMS`). The PDF renders the © sign as "(0"; the notice above restores it.

**Licence points awaiting TQ** (recorded here so nobody offers these bytes before they are read): §2.f forbids facilitating any other HR-technology Standards Organization in distributing, publishing or using the Work, and creating a derivative for publishing by or attribution to any Standards Organization or similar entity, without HR Open's written approval; the preamble asserts that obtaining or using the Work constitutes acceptance; §7 attaches an indemnity to commercial product offerings. The public GitHub repository these bytes come from states no licence of its own.

## What is here

| path | content | read by the forge? | committed? |
|---|---|---|---|
| `openApiBundles/` | the four self-contained OpenAPI 3.1.0 bundles: organizations, workers, worker-compensation-reports, worker-paid-hours-reports (`info.version` 1.0.0) | YES: `components.schemas` of each | **NO** (git-ignored: the workers bundle is 273,864,811 bytes, over GitHub's per-file limit) |
| `transportObjects/` | the JEDx transport-object JSON Schemas (job, organization, worker, worker_compensation_report, worker_paid_hours_report), `code-sets.json`, `schema_properties.xlsx`; own `SHA256SUMS` | no: provenance, and the bridge between snapshot 01 and these bundles in the change record | yes |
| `licence/` | the HR Open License Agreement PDF; own `SHA256SUMS` | no | yes |
| `SHA256SUMS` | checksums of the four bundle files (the forge's declared inputs) | verified by the framework | yes |
| `standardSourceLocation` | version, upstream URL, commit, acquisition facts | yes (provenance stamp) | yes |

## Source

- Repository: `https://github.com/HROpen/APISpecifications`, branch `development`, commit **`707ec7d3741df46f6973411e5dd75c756cf3d7d7`** (2026-02-12, Vince Paredes, "adding new sample data"). Public, anonymous clone; no account, no click-through.
- The bundles' own last changes: organizations, worker-compensation-reports, worker-paid-hours-reports 2025-05-27 ("Updated schema per requirements gap analysis"); workers 2025-06-12 ("Updated workers openapi bundle"; it exists upstream only as a zip). The `jedx-project-1` branch the JEDx proposal names was merged into `development` by PR #1 on 2025-10-02 and no longer exists.
- The publisher's landing page `https://www.hropenstandards.org/jedx-open-api-specifications` says "Finalized 10/15/2024" and offers the same four file names behind a free HR Open Community account and the IP Agreement. That route was NOT used. The repository carries later commits to the same files, so it is the latest artefact.

## Acquisition recipe (the bundle bytes are not in git)

Run from any scratch directory; the bytes are untrusted data (nothing is executed from them).

```bash
git clone --no-checkout https://github.com/HROpen/APISpecifications.git hropen && cd hropen
git -c core.hooksPath=/dev/null checkout 707ec7d3741df46f6973411e5dd75c756cf3d7d7
DEST=<this directory>/openApiBundles && mkdir -p "$DEST"
cp organizations/v1/organizations-openapi-bundle_v1.json \
   worker-compensation-reports/v1/worker-compensation-reports-openapi-bundle_v1.json \
   worker-paid-hours-reports/v1/worker-paid-hours-reports-openapi-bundle_v1.json "$DEST"/
unzip -o -q workers/v1/workers-openapi-bundle_v1.json.zip -x '__MACOSX/*' -d "$DEST"
cd <this directory> && shasum -a 256 -c SHA256SUMS
```

The workers zip itself: sha256 `b6ce01f05ef6aa82866db9c045323362e945c89919ff2a25f7c1426811dd12b0`.

## Measured at acquisition (2026-10-23)

Union of the four files' `components.schemas`: 191 schemas (0 names with different content in different files), 665 direct properties, 42 code lists carrying 1,201 values, 66 property-local enums. `$ref` count 0: the bundles are fully dereferenced; every inlined copy keeps its HR Open `title`. Detail and the inline-fidelity figures: `GATEREPORT-B0-102326.md` §2.
