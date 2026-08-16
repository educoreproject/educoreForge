# PROVENANCE — toyForge snapshot 01

Written by the Forge Framework F3a builder (SHADOW_GATE, 2026-08-16) under supervisor SABLE_RIVER,
per SPEC-forgeFramework-v1.md §10 and the Profile §10.1 (RT-9/RT-11).

## What this snapshot is

The **Toy Standard** — a deliberately tiny, fully synthetic four-role data model authored IN-TREE so
that every framework unit gate can run hermetically (no licensed bytes, no container, no network).
It is not a real education standard and models no real publisher.

| file | role | acquisition class |
|---|---|---|
| `toyModel.json` | the whole model: two classes, five properties, two option sets, five values, one support note; self-describes `version` and `sourceUrl` | authored (committed) |

## Acquisition recipe

There is no upstream. The bytes are authored once and PINNED by `SHA256SUMS`. To "re-acquire", check
out the committed file. A change to the model is a NEW snapshot directory (`02/`) with its own
`SHA256SUMS`, never an edit of `01/` — every gate in `lib/forge-framework/test/` freezes values
against these exact bytes.

## License posture

Public domain fixture; no license restriction.

## Files beside the bytes

`SHA256SUMS` (the pin), `standardSourceLocation` (publishedVersion 1.2.3, read by
`lib/snapshot-provenance`), this file. None of the three is listed in `SHA256SUMS`; the framework's
`verifySnapshotChecksums` ignores files the list does not name (SPEC §3.3, FR8).
