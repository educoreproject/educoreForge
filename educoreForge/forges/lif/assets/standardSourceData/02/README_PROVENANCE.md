# LIF snapshot 02: provenance

**What it is.** The LIF Initiative's machine-readable LIF data model: an OpenAPI 3.0.0 document (`info.title` "Machine-Readable Schema
for LIF", `info.version` 2.0, `paths` empty) whose `components.schemas` holds the eight LIF entities (Assessment, CompetencyFramework,
Course, Credential, Organization, Person, Position, Program) with 1,393 nested property declarations. lif-core's own CLAUDE.md names
this file the "Source of truth".

**Acquisition class.** `published-url` (a public GitHub repository). Fetched 2026-10-24 by STEEL_MIRROR (nextStandards-102326 lane C)
with `curl` from GitHub's raw URLs; no account used.

## The bytes

| copy | commit | sha256 | bytes |
|---|---|---|---|
| `lif-core/reference_data/schemas/lif-schema.json` at the repository head | `34ca08a4c6b6c540e03dddcbe41da66cc5297567` (2026-10-23T23:50Z) | `b79598bbd3619d8d503828969f749e26238a1557e5fd66fba5baa2f07e36c3bc` | 640,493 |
| the same path at the file's last change | `290987a08dd08c3a5a01a8833b9a768e3ded69e4` (2026-09-08, "Issue #1207: fix truncated InstanceOfRefCredential key") | identical | 640,493 |

The forge reads these bytes. `standardSourceLocation` pins the file's own commit, `290987a0`.

**Not the source:** `LIF-Initiative/lif-data-model/lif.json` (640,493 bytes, sha256 `781cdb514a2fae889fde83e709131316ec85a3b6ccb564ebe2a86cdc2d02e023`,
last commit `e54b65ed2344f8cb76c7ebe084c9f541977937fc`, 2025-12-05). Same size, older: it still spells `instanceOfRefCredential` where
lif-core's 2026-09-08 fix reads `InstanceOfRefCredential` (that is the whole difference in property paths, measured). Recorded, not stored.

## Files (`SHA256SUMS` lists each)

| file | role |
|---|---|
| `lif-schema.json` | **the forge's source** |
| `LICENSE` | lif-core's Apache License 2.0, copied verbatim (sha256 `c71d239d…`, 11,357 bytes) |
| `standardSourceLocation` | the provenance record; its `upstreamUrl` is the root's `sourceUrl` (a declared additional input) |

## Licence

**Apache License 2.0** (`LICENSE` in both LIF-Initiative repositories; lif-core has **no NOTICE file**: its raw URL returns 404, measured
2026-10-24). Downloads of this standard are therefore AVAILABLE, carrying the licence and an attribution to the LIF Initiative
(TQ ruling 2026-10-23). The LICENSE names no copyright holder (its appendix template, `Copyright [yyyy] [name of copyright owner]`, is
unfilled), so the attribution names the publishing organisation and the source URL, and claims no copyright line the publisher did not write.

## Acquisition recipe

```
DEST=forges/lif/assets/standardSourceData/02
SHA=290987a08dd08c3a5a01a8833b9a768e3ded69e4
curl -sfL -o $DEST/lif-schema.json https://raw.githubusercontent.com/LIF-Initiative/lif-core/$SHA/reference_data/schemas/lif-schema.json
curl -sfL -o $DEST/LICENSE https://raw.githubusercontent.com/LIF-Initiative/lif-core/$SHA/LICENSE
(cd $DEST && shasum -a 256 lif-schema.json LICENSE standardSourceLocation > SHA256SUMS)
```
