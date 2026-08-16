# Snapshot 04 — Provenance & Acquisition (forge-edfi round-trip snapshot)

**Created 2026-08-03 (Phase 0, forge-edfi round-trip campaign; builder INDIGO_DREAM,
supervisor AMBER_TOWER). Governing documents: DOCTRINE-roundTripForgeContract-080326.md
(RT-3, RT-9, RT-11), WORKORDER-edfiRoundTripForge-080326.md,
SCOUT-edfiCanonicalSource-080326.md — all in system/management/zNotesPlansDocs/.**

This snapshot holds the canonical machine-readable source of the **Ed-Fi Data Standard 5.2.0**
plus the **TPDM Community Model 1.2** extension and the **authored Ed-Fi→CEDS crosswalk**.
Provenance files (this README, `SHA256SUMS`, `standardSourceLocation`) are **peers** of the
source subfolders, per TQ's snapshot-handling ruling (2026-08-03).

## The five declared source inputs

| Subfolder | Content | Acquisition class (RT-9) | License | In git? |
|---|---|---|---|---|
| `metaEdModel/` | 653 `.metaed` + LICENSE + package.json — `@edfi/ed-fi-model-5.2` v3.0.1 | machine-canonical | Ed-Fi Alliance License Agreement | **NO — gitignored** |
| `descriptorCodeValues/` | 203 descriptor code-value XMLs + LICENSE | machine-canonical | Apache-2.0 | yes |
| `tpdmCommunityModel/` | 196 `.metaed` + LICENSE + package.json | machine-canonical | Apache-2.0 | yes |
| `tpdmDescriptorCodeValues/` | 27 TPDM descriptor XMLs + LICENSE | machine-canonical | Apache-2.0 | yes |
| `cedsAuthoredCrosswalk/` | 2 CSVs, byte-identical to old snapshot 01 | **human-artifact-snapshot** | (in-repo since 2026-06-23; ORIGIN SETTLED 2026-08-16 — see "Crosswalk provenance" below) | yes |

**Mixed acquisition classes, stated per input (RT-9):** the round trip against the four
machine-canonical inputs proves fidelity to the publisher's own artifacts. For
`cedsAuthoredCrosswalk/` the class is `human-artifact-snapshot`: the original harvest did not
record the upstream URL or artifact version, so the round trip proves losslessness against
THIS snapshot; fidelity to the publisher's intent is only as good as the snapshot, and this
README says so. (The artifact's ORIGIN was settled on 2026-08-16 — see "Crosswalk provenance"
below; there is still no public URL, so the class stays `human-artifact-snapshot`.) Version evidence for the crosswalk: every one of the 8,310 descriptor-CSV data
rows stamps `EdFiVersionNumber=DS5.2` (full-column sweep, 2026-08-03) — consistent with the
DS 5.2 model package beside it.

## Crosswalk provenance — SETTLED 2026-08-16 (SABLE_RIVER, RULINGS-supervisor-bridgeFramework.md "Ed-Fi crosswalk PROVENANCE — settled")

Both CSVs arrived as attachments on an email from **Nathan Clinton <nathan.clinton@aemcorp.com>** (AEM Corp,
the CEDS contractor), subject **"EdFi to CEDS Mapping"**, received **2026-03-25 11:59:07**, message-id
`DS5PR15MB7006050B2125F9034B27D4A09D49A@DS5PR15MB7006.namprd15.prod.outlook.com`, body verbatim:
*"Here is our mapping, both at the element level and enumeration level. This covers ALL of EdFi and maps to
CEDS Ontology V13."* Evidence: the oldest copy's mtimes 2026-03-25 11:59, macOS quarantine xattr = Mail, the
repo copy byte-identical (elements file md5 `79b5f0eb4df954b0977facab69eac3e9`). It is NOT part of any Ed-Fi
distribution and has NO public URL. Consequences recorded as data in the bridge plugin
(`forges/edfi/bridges/edfiCedsCrosswalkPlugin.js`): SSSOM `mapping_provider` = **CEDS** (`https://ceds.ed.gov/`
— the PROVIDER, "our mapping"; SSSOM names the provider, not the artifact), `verifiedBy` = this record; the
crosswalk is authored against **CEDS Ontology V13** while the hub is **CEDS 14**, so the class-URI drift the
bridge classifier reports (20 keys / 72 subjects `sourceSideMismatch`, B3 mover M3) is the V13→V14 remodel.

## Acquisition recipe (exact, pinned, rerunnable)

```bash
# 1. Core model (.metaed), DS 5.2.0 — anonymous download, no auth required
curl -L "https://pkgs.dev.azure.com/ed-fi-alliance/Ed-Fi-Alliance-OSS/_packaging/EdFi/npm/registry/@edfi/ed-fi-model-5.2/-/ed-fi-model-5.2-3.0.1.tgz" \
  -o ed-fi-model-5.2-3.0.1.tgz
# expected tarball sha256: 03e1620f21a27a7a1c72756b83b1c830cf98bbc7f59a2179621d82a8bd8cb0f5
mkdir -p metaEdModel && tar -xzf ed-fi-model-5.2-3.0.1.tgz -C metaEdModel --strip-components=1

# 2. Descriptor code values — Ed-Fi-Data-Standard, pinned tag (Apache-2.0)
#    pinned commit: bb65fc2e95f71cc7111a43b3a0ac9c6bc787cdaa
git clone --depth 1 --branch v5.2.0 https://github.com/Ed-Fi-Alliance-OSS/Ed-Fi-Data-Standard
#    -> Descriptors/*.xml (203 files) + LICENSE = descriptorCodeValues/

# 3. TPDM Community Model, pinned tag (Apache-2.0)
#    pinned commit: a43d2a1de2e8c88b62e4fd52e8770078453a85b4
git clone --depth 1 --branch v1.2 https://github.com/Ed-Fi-Exchange-OSS/Ed-Fi-TPDM-Community-Model
#    -> Association/ Common/ Descriptor/ Domain/ DomainEntity/ Interchange/ Shared/
#       + LICENSE + package.json = tpdmCommunityModel/

# 4. TPDM descriptor code values (Apache-2.0) — no release tag upstream, so the pin is an
#    explicit checkout of the exact commit (full clone; a depth-1 clone cannot check out
#    an arbitrary commit)
git clone https://github.com/Ed-Fi-Alliance-OSS/Ed-Fi-TPDM-Artifacts
cd Ed-Fi-TPDM-Artifacts && git checkout de6f7c27f31e8032321dd8bc860c76dc847699e3 && cd ..
#    -> Descriptors/*.xml (27 files) + LICENSE = tpdmDescriptorCodeValues/

# 5. cedsAuthoredCrosswalk/ needs no acquisition — its two CSVs are committed in this snapshot.

# Verify the whole snapshot (gitignored bytes included):
cd 04 && shasum -c SHA256SUMS --quiet && echo CLEAN
```

Acquisition performed 2026-08-03; tarball sha256 verified
`03e1620f21a27a7a1c72756b83b1c830cf98bbc7f59a2179621d82a8bd8cb0f5`; version binding verified in
`metaEdModel/package.json` (`metaEdProject.projectVersion = "5.2.0"`).

## License posture

- **`metaEdModel/` — Ed-Fi Alliance License Agreement** (the 603-line LICENSE inside the
  subfolder; referenced here, not reproduced). Non-exclusive, revocable, royalty-free grant for
  charitable/educational Permitted Use; public re-hosting of the bytes is doubtful, so the
  subfolder is **gitignored and never committed**. Internal use, ingestion, and graph
  derivation sit comfortably inside the Permitted Use (scout's analysis; estimation, not legal
  advice).
- **Everything else — Apache-2.0** (LICENSE files carried inside each subfolder), committed
  normally.
- **`cedsAuthoredCrosswalk/`** — carried in-repo since 2026-06-23 (old snapshot 01); carrying
  it forward verbatim raises no new exposure.

## For git-clone consumers (the RT-3 refusal story)

A fresh `git clone` lacks `metaEdModel/` — that is the ONLY subfolder the gitignore names
(no negation patterns; the ignore line lives in the repo-root `.gitignore` at
`system/code/.gitignore`). The forge's missing-source refusal names what is absent and points
here: **run the acquisition recipe above (step 1 only) before forging Ed-Fi.** `SHA256SUMS`
then proves the reacquired bytes are the pinned bytes. Local working trees and rsync'd deploys
carry the folder along and are unaffected.

## Version-following (RT-12)

A new upstream Ed-Fi version is a NEW sibling snapshot directory (05, 06, …) acquired by this
recipe with updated pins — never an in-place mutation of 04. Nothing changes until
`defaultSnapshot` in `parserDescriptor.ini` deliberately flips.
