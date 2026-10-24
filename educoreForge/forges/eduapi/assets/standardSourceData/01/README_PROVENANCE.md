# EduAPI 1.0 snapshot 01: provenance (RECORD ONLY, superseded)

**What it is.** The 1EdTech Edu-API 1.0 OpenAPI 3.0 document as held since 2026-05-28 (`x-status Candidate Final`, 381,592 bytes, sha256
`bed37938b1126c7cea8bb0a114f7840d80b4449071aabd42baee6cd99c1fcd94`): what the July graph held (37 schemas). Not the pin; no hook reads it.
Superseded by snapshot 02 (the same purl, now `x-status Final`).

**Bytes not in git** (TQ 2026-10-24). Restore them from the pre-reset tree, where they were committed before the ruling:

```
git show 88336881:educoreForge/forges/eduapi/assets/standardSourceData/01/eduapi_v1p0_openapi3.json \
  > forges/eduapi/assets/standardSourceData/01/eduapi_v1p0_openapi3.json
(cd forges/eduapi/assets/standardSourceData/01 && shasum -a 256 -c SHA256SUMS)
```

Licence: as snapshot 02 (1EdTech Specification Document License).
