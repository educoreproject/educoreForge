# PESC_LD snapshot 01: provenance

**What it is.** The PESC College Transcript in JSON-LD application profile, package "JSON-LD College Transcript_v0.0.2" (author Phil
Barker, `about.csv` date 2026-06-25). Named PESC_LD by TQ's ruling of 2026-10-20; "PESC_LD v0.0.2" means this package.

**Version.** `publishedVersion: 0.0.2` (the package's name). The files inside still say **v0.0.1**: the CSV zip is
`PESC Transcript TAP CSVs_v0.0.1.zip`, the context file `CollegeTranscriptContext_v0.0.1.jsonld`. `about.csv` states a date and no
version. Whether a newer work-in-progress version exists is an open question for the publisher (zeroBacklog plan Q-Z7: forge v0.0.2
now, ask after the demo).

**Acquisition class.** `human-artifact-snapshot`: the package reached us as a directory of files, not from a published URL.
`about.csv` names the Google spreadsheet the CSVs were exported from (`upstreamUrl` in `standardSourceLocation`).

## Files (byte copies; `SHA256SUMS` lists each)

| file | from the package | role |
|---|---|---|
| `shapes.csv`, `tap.csv`, `person-tap.csv`, `organization-tap.csv`, `contact-tap.csv`, `course-related-tap.csv`, `achieve-related-tap.csv`, `summary-related-tap.csv`, `namespaces.csv`, `about.csv` | extracted from `Application Profile/PESC Transcript TAP CSVs_v0.0.1.zip` (sha256 `294c3bc1150fa5594ba2ca1fa379d51f3def963c6d17b567d058edc068adc414`) | **the forge's source** |
| `JsonldCollegeTranscriptShacl.ttl` | `SHACL Specification/JsonldCollegeTranscriptShacl.ttl` | the round trip's **second oracle** (the publisher's merged SHACL); the forge never reads it |
| `CollegeTranscriptContext_v0.0.1.jsonld` | `Context File/CollegeTranscriptContext_v0.0.1.jsonld` | reference only: its prefixes equal `namespaces.csv` (measured 2026-10-21); the forge never reads it |

**Not copied, on purpose.** `Application Profile/PESC Transcript TAP_v0.0.1.json` is a lossy derivative (no `note` column; it
disagrees with the TTL on `PersonShape pesc:hasSummary`), so it is not a source (WORKORDER-C). The xlsx, the JSON Schema, the example
instance, the implementation-guide images and the Word documents are not inputs.

## Acquisition recipe

```
SRC="/Users/tqwhite/Downloads/JSON-LD College Transcript_v0.0.2"
DEST=forges/pescld/assets/standardSourceData/01
unzip -o "$SRC/Application Profile/PESC Transcript TAP CSVs_v0.0.1.zip" -d <an empty scratch directory>
cp <that scratch directory>/*.csv "$DEST"/
cp "$SRC/SHACL Specification/JsonldCollegeTranscriptShacl.ttl" "$SRC/Context File/CollegeTranscriptContext_v0.0.1.jsonld" "$DEST"/
cd "$DEST" && shasum -a 256 -c SHA256SUMS
```

The downloaded bytes are untrusted data: they are copied, never executed.

## Licence

Not stated in the package. Published by PESC for implementers; carried here as a snapshot for graph building.
