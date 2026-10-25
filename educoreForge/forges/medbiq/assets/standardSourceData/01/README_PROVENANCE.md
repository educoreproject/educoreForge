# MedBiquitous snapshot 01: the held copy (a RECORD only; the forge reads snapshot 02)

**What it is.** The MedBiquitous files held since 2026-06-23 in the pre-reset tree (`git show 88336881:educoreForge/forges/medbiquitous/assets/standardSourceData/01/`), copied there from educoreForgeOLD. That copy holds 27 XSD files, 6 WSDL files, the July forge's own `manifest.json` and `standardSourceLocation`. Its directory names are the July forge's own (`activityReport/v2`, `shared/`, `healthcareLom/v2`, ...).

**How it relates to the publisher.** All 33 publisher files are byte-identical to the publisher's repository master `8f5c74a5`, at the paths the manifest's `path` field names (measured 2026-10-24, SHA-256). Snapshot 02 is that repository at its own paths, plus the 14 files this set imports but never held. The change record is `CHANGES-medbiq-01to02-102526.md`.

**Files.** The 33 publisher files are not in git (the repo-root `.gitignore` block). `manifest.json`, `standardSourceLocation`, `SHA256SUMS` and this file are tracked. To recover the bytes, copy each manifest `path` from the repository at `8f5c74a5` to its `localPath` here, then run `shasum -a 256 -c SHA256SUMS`.
