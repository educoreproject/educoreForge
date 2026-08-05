# PROVENANCE — forge-ceds snapshot 01

Written by the Round-Trip Perfection campaign, Phase 3.5 (builder GILDED_FALCON, 2026-08-04),
supervisor INDIGO_MIRROR, per the Round-Trip Forge Contract (RT-3/RT-9/RT-11;
`DOCTRINE-roundTripForgeContract-080326.md`).

---

## ⚠️ READ THIS BEFORE YOU TRUST ANYTHING ELSE IN THIS FILE

**The `SHA256SUMS` beside this file was minted on 2026-08-04, long after the bytes arrived. It
records the ontology AS IT IS NOW. It is a TAMPER DETECTOR GOING FORWARD; it is NOT evidence of
provenance.** It proves that the file has not changed since 2026-08-04. It proves nothing whatever
about where the file came from, who published it, or whether it matches anything upstream.

**The exact upstream download URL was never captured.** `standardSourceLocation` in this directory
records, verbatim:

```
upstreamUrl: unknown (publisher: US Department of Education CEDS — https://ceds.ed.gov;
             exact ontology download URL not recorded at harvest)
copiedFrom: /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/sourceData/forge-ceds-rdf
copiedDate: 2026-05-28
```

**There is therefore NO ACQUISITION RECIPE in this file, and none has been invented.** The sibling
snapshots (`forges/sif/.../01`, `forges/pesc/.../01`, `forges/edfi/.../04`) each carry a real
reacquisition procedure. This one cannot, because nobody wrote down where the bytes came from. A
provenance file that overstates what it knows is worse than the absence it replaces, because the
next reader will trust it.

**What a git-clone consumer should do:** nothing. Unlike the Ed-Fi snapshot, the CEDS ontology
bytes ARE committed (`git ls-files` confirms `CEDS-Ontology.rdf` is tracked), so a clone already
has the exact file this checksum describes. There is nothing to re-fetch and no gitignore
involvement.

**What a version-follower should do (doctrine RT-12):** a new upstream CEDS release is a NEW
directory under `assets/standardSourceData/`, with its own `README_PROVENANCE.md` that DOES record
the download URL, and `defaultSnapshot` in `forges/ceds/parserDescriptor.ini` is flipped
deliberately. Whoever performs that acquisition should record the URL at the moment of harvest —
this file exists partly as the record of what it costs not to.

---

## What this snapshot is

| file | bytes | sha256 | role |
|---|---|---|---|
| `CEDS-Ontology.rdf` | 20,247,983 | `26d782b6047236e8…` (see `SHA256SUMS`) | the whole of CEDS as RDF/XML — the ONE source input |
| `standardSourceLocation` | 466 | not checksummed | the 2026-05-28 harvest note, quoted above |

CEDS is a **single-file, file-bound** standard: `parserDescriptor.ini` names
`sourceFile=CEDS-Ontology.rdf`, so the forge reads exactly that path and never enumerates this
directory. (That is why adding this file and `SHA256SUMS` alongside the ontology cannot change what
CEDS forges — a claim that was OBSERVED rather than argued: the CEDS base block digest was recorded
from a build before these two files existed and re-checked from a build after. See the Phase 3.5
DEVLOG.)

## Version evidence

**CEDS version 14.0.0.0**, read from `<owl:versionInfo>14.0.0.0</owl:versionInfo>` inside the
ontology itself rather than from a filename, so the stamped version cannot drift from the file it
describes. This is the one provenance fact about this snapshot that is genuinely self-evidencing:
the document states its own version, and the checksum pins the document.

## Acquisition class (doctrine §2)

**Publisher artifact, unverified transfer.** The bytes are a publisher's document (US Department of
Education CEDS), but the transfer from publisher to this directory is not documented and cannot now
be reconstructed. It is NOT a human-authored artifact and NOT a generated derivative — it is the
real thing, arrived by an unrecorded path.

## Why this file exists

Until 2026-08-04 this directory carried no `SHA256SUMS` and no provenance note, while the three
sibling bundles carried both. That gap was found while giving CEDS a declared `roundTripValidator`:
every live validator verifies its snapshot's checksums at its own door before diffing anything
(RT-3), and CEDS's could not, because there was nothing to verify against. The choice was between
an instrument materially weaker than its three peers **and silently so**, or minting the checksums
and saying honestly what they do and do not prove. The second was authorized by the supervisor on
2026-08-04.

`forges/ceds/roundTripValidator.js` now REFUSES BY NAME if `SHA256SUMS` is absent, if a listed file
is missing, if a present `.rdf` is unlisted, if any digest fails, or if this directory holds
anything other than exactly one `.rdf`. None of those is a skip.
