# MedBiquitous snapshot 02: provenance

**What it is.** The 47 XSD and WSDL files of the MedBiquitous portfolio that the forge reads or excludes by name. They come from the publisher's own GitHub repository, https://github.com/medbiq/medbiq, master at commit `8f5c74a51bf6721fa1f0b57f2d9c4b51496bb566` (2025-08-28). Each file sits at its repository path.

**Acquisition class.** `repository-commit`. Cloned anonymously on 2026-10-24 by EBONY_TOWER (nextStandards wave 3, lane I). No account was used and no licence click-through was accepted.

## How it relates to snapshot 01, the held copy of 2026-06-23

| | count |
|---|---|
| Files held in 01 that are byte-identical in 02 (SHA-256 compared, `k3/` evidence) | 33 of 33 |
| Files new in 02 | 14 |

Snapshot 01 renamed the directories (`activityReport/v2`, `shared/`, `healthcareLom/v2`). Snapshot 02 keeps the publisher's own paths.

**The new files.** The held set was not closed under its own imports: its XSDs import files its manifest left out. Snapshot 02 adds those files:

- `member/v1/member.xsd`, `address/v1/address.xsd`, `name/v1/name.xsd`;
- the IEEE LOM binding that `lomv2/healthcarelom.xsd` includes: `lomv2/common/*.xsd` (7 files), `lomv2/extend/custom.xsd`, `lomv2/unique/strict.xsd`, `lomv2/vocab/custom.xsd`;
- Entrustment Scale v1 (`entrustmentscale/v1/entrustmentscale.xsd`), a current standard the held manifest omitted.

The change record is `system/management/zNotesPlansDocs/nextStandards-102326/CHANGES-medbiq-01to02-102526.md`.

**Why not ns.medbiq.org.** The namespace site serves OLDER bytes than the repository. This was measured on 2026-10-25:

- `http://ns.medbiq.org/member/v2/member.xsd` is the 2017 edition. The repository has the edit "Modified Mar 31, 2025".
- `http://ns.medbiq.org/lom/healthcare/healthcaremetadata.xsd` matches neither of the repository's two copies.

So the repository is the latest publisher artefact (BRONZE_CROWN ruling, 2026-10-25).

## Files

`SHA256SUMS` lists every file.

- The 47 publisher files (`*.xsd`, `*.wsdl`) are NOT in git (TQ ruling 2026-10-24: "Leave it out of git"; see the repo-root `.gitignore` block).
- This file, `SHA256SUMS` and `standardSourceLocation` are tracked.

## Licence

The licence is the MedBiquitous Standards Public License and Terms of Use (AAMC, last updated 2020-06-03), https://www.medbiq.org/license. The repository README says: "Standards, software, documentation, and other items in the MedBiquitous Repository are subject to the MedBiquitous Consortium XML Public License and Terms of Use". The XSDs themselves carry the notice "Users are bound by the terms of the MedBiquitous Consortium XML Public License and Terms of Use".

The licence grants a perpetual licence to copy, use, modify, make derivative works and redistribute, with no fee. Every copy must include three things:

1. the pre-existing notices;
2. notice of any change;
3. notice that users are bound by the licence, with a reference to its full text.

The licence also says the AAMC's name and trademarks, "MedBiquitous" included, may not be used in advertising or publicity without permission.

Downloads are AVAILABLE on both facets, with these notices (`apps/graph-builder/lib/downloadArtifactsRules.json`).

## Acquisition recipe

```
git clone https://github.com/medbiq/medbiq.git /tmp/medbiqRepo && git -C /tmp/medbiqRepo checkout 8f5c74a51bf6721fa1f0b57f2d9c4b51496bb566
DEST=forges/medbiq/assets/standardSourceData/02
(cd /tmp/medbiqRepo && grep -v -E '^#|SHA256SUMS|standardSourceLocation|README_PROVENANCE' "$OLDPWD/$DEST/SHA256SUMS" | awk '{print $2}' | while read p; do mkdir -p "$OLDPWD/$DEST/$(dirname $p)"; cp "$p" "$OLDPWD/$DEST/$p"; done)
(cd $DEST && shasum -a 256 -c SHA256SUMS)
```
