# README_source — published SIF XSDs, held as a cross-check corpus

**These are NOT forge input.** Nothing in `forgeSif.js`, `lib/parser.js` or `roundTripValidator.js`
reads this directory. The forge's only source is the TSV under
`assets/standardSourceData/<defaultSnapshot>/`, per ruling **R-SF-6**: the SIF Implementation
Specification **spreadsheet is canonical**, and every published artifact — the XSDs included — is
generated downstream from it by a tool John Lovell authors. Nothing here displaces that.

These files are kept so the bundle can **check its own source against an independent witness** without
a successor having to go find them.

## Where these bytes came from

Copied 2026-08-09 from a working copy in an unrelated client project on this machine:

```
/Users/tqwhite/Documents/webdev/A4L/unityObjectGenerator/system/code/cli/lib.d/assets/XSDs
```

Copied verbatim and verified byte-identical to that source. `.DS_Store` files were not carried over.

| file | bytes | role |
|---|---|---|
| `SIF_Message.xsd` | 2,661,383 | the **annotated** schema — carries `<sifChar>` per element; this is the one the S-1 investigation used |
| `SIF_Message_Relaxed.xsd` | 2,677,848 | the lax variant, same annotations |
| `imports/xml/xml.xsd` | 5,695 | the W3C `xml:` namespace import the above reference |

`SHA256SUMS` in this directory covers all three.

## Chain of custody — read this before citing these files to anyone outside

**VERIFIED — that `SIF_Message.xsd` is the artifact errata S-1 was written against.** Six independent
fingerprints, six exact matches against the figures S-1 records: 74,122 lines; `sifChar` distribution
`O` 2,928 · `M` 1,164 · `OR` 180 · `MR` 150 · `C` 116 · `CR` 2; and both `CR` sites at lines 46,490
and 49,224, the two line numbers S-1 cites.

**INFERRED, NOT VERIFIED — that these are the publisher's bytes.**
`../../standardSourceData/01/README_PROVENANCE.md` checksums the published **zip**
(`XSD/Schema_NoIncludes_Annotated_Strict.zip`, sha256 `e97c56ac…`), not the extracted file inside it.
No publisher checksum exists for these files to be compared against, and the 2026-08 work used no
network. The file dates from 2024-03-21 and reached this machine through the client project, not
through a recorded acquisition.

**The one task that would close this gap**, and it is worth doing: fetch
`https://files.a4l.org/Implementation/NA/4.3/XSD/Schema_NoIncludes_Annotated_Strict.zip`, confirm it
against the recorded zip checksum, extract, and compare `SIF_Message.xsd` byte-for-byte with the copy
here. If it matches, amend this section to **VERIFIED** and record the extracted-file checksum. Until
then the honest word is *inferred*.

## THE TRAP — do not add these to the snapshot's SHA256SUMS

**Do not move these files into `assets/standardSourceData/01/`, and do not add them to that
directory's `SHA256SUMS`.** The second is the dangerous one, because it is what a conscientious
maintainer would reach for.

`roundTripValidator.js` builds its file list by filtering the snapshot directory to `.tsv`
(line ~101), then **refuses by name for any SHA256SUMS entry not in that list** (lines ~170-178:
*"SHA256SUMS lists 'X' but the file is ABSENT from the snapshot"*). An `.xsd` listed there is absent
from a `.tsv`-only list by construction, so **adding these to the snapshot's SHA256SUMS breaks every
SIF round trip immediately.** `lib/parser.js` filters the same way (line ~472).

Keeping them in this sibling directory avoids the whole question: **no forge code scans
`assets/` recursively — only the pinned snapshot version directory is read** — so this directory is
inert to every build.

## What was found with them

`test/probes/s1SourceCompletenessAudit/` and `test/probes/s3CrossArtifactCharacteristics/` both read
`SIF_Message.xsd` from wherever you point them; pass `--xsdFilePath` at this directory now rather than
at the client project. The findings are errata **S-1** (the export omits every container element —
6,586 of them, 1,887 carrying `maxOccurs="unbounded"`), **Q-1** (resolved), and **S-3** (the two
artifacts contradict each other zero times in 15,620 rows).

## Versioning

`01` follows the snapshot convention (**RT-12**): a new upstream SIF version is a **new numbered
directory**, never an overwrite. These are **SIF NA 4.3** (release 2022-10-27). Nothing pins this
directory — no `defaultSnapshot` equivalent exists for it, because nothing reads it automatically.

---

*Placed 2026-08-09 by session QUIET_LOOM on TQ's direct instruction, which also settles the
disposition question `README_PROVENANCE.md` had recorded as fenced pending a ruling. Copy only; no
forge code, canonicalizer, emitter, `parserDescriptor.ini` or snapshot directory was modified.*
