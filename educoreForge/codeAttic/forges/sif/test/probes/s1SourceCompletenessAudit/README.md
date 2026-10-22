# s1SourceCompletenessAudit — the probe that settled errata S-1

**What it answers.** Does the SIF flattened TSV export systematically omit container-element rows, or
was `ValidMark` a special case? `README_ERRATA.md` entry S-1 recorded that question as *inferred, not
verified*, and noted that a systematic XSD-inventory-versus-export comparison would settle it and had
not been run. This is that comparison.

**What it found**, 2026-08-09, session QUIET_LOOM: 6,586 intermediate container elements have no row of
their own, 1,887 of them carry `maxOccurs="unbounded"`, and the rule is exceptionless in both
directions. The full argument is
`system/management/zNotesPlansDocs/FINDING-sifExportOmitsContainerElements-080926.md`; the full
enumeration is `DATA-sifOmittedContainerElements-080926.tsv` beside it.

**Read-only by construction.** It opens two files and writes JSON to a directory you name. No database,
no bolt port, no connection, no writes to the bundle. Its results cannot be disturbed by anything
happening to `DEV_FourWithNewPesc`, which is the configured DME golden and can be restarted by ordinary
DME use.

---

## The second input is NOT in this bundle. Read this before re-running.

`assets/standardSourceData/01/` holds the TSV and nothing else. `README_PROVENANCE.md` records the
published SIF 4.3 schema zips as deliberately uncommitted — a supervisor fence, pending a ruling on
their disposition that had not been made as of 2026-08-09.

The annotated XSD used for the 2026-08 run was found by searching the filesystem, at:

```
/Users/tqwhite/Documents/webdev/A4L/unityObjectGenerator/system/code/cli/lib.d/assets/XSDs/SIF_Message.xsd
```

That is an unrelated client project. Nothing in this bundle references it, and it may move or vanish.

**Why that file was accepted as the right artifact — VERIFIED.** Six independent fingerprints match
errata S-1's own figures exactly: 74,122 lines; `sifChar` distribution `O` 2,928 · `M` 1,164 · `OR` 180
· `MR` 150 · `C` 116 · `CR` 2; and both `CR` sites at XSD lines 46,490 and 49,224, the two line numbers
S-1 cites. sha256 `d376cbb5a9b8475eaf2a70ce8ab92f983fe890e05b638402a53f828df3112ffa`.

**Why the chain of custody is stated as INFERRED, not VERIFIED.** `README_PROVENANCE.md` checksums the
published *zip* (`Schema_NoIncludes_Annotated_Strict.zip`, `e97c56ac…`), not the extracted file inside
it. There is no publisher checksum for this file to be compared against. The 2026-08 run used no
network. Anyone defending this finding to A4L needs that sentence.

If you re-acquire the published zip, checksum the extracted `SIF_Message.xsd` and record it here. That
would move the chain of custody from inferred to verified and is the single most useful thing a
successor can do to this probe.

---

## Running it

From `system/code/educoreForge`:

```bash
node forges/sif/test/probes/s1SourceCompletenessAudit/s1SourceCompletenessAudit.js \
  --tsvFilePath="$PWD/forges/sif/assets/standardSourceData/01/ImplementationSpecification_031326.tsv" \
  --xsdFilePath="<path to the annotated SIF_Message.xsd — see above>" \
  --maximumExpansionDepth=25 \
  --outputDirPath="<a throwaway directory>"
```

Module resolution walks up to `educoreForge/node_modules`; nothing needs installing. Runtime is a few
seconds. Add `-verbose` for the inline-annotation carry count.

**Every argument is required and none is defaulted.** A missing one refuses by name and exits 1. That
is deliberate: silently substituting a corpus is the exact failure this probe exists to detect.

### Output

| file | contents |
|---|---|
| `omissionReport.json` | pass 1 — containers implied by row xpaths, the deciding cross-tab |
| `witnessReport.json` | pass 2 — each omitted container resolved through the XSD type graph |
| `inventoryDiff.json` | pass 3 — full XSD inventory vs export, both directions |
| `xsdInventorySummary.json` | what the XSD parse saw |

### Expected figures for the committed snapshot

```
omitted intermediate containers ......... 6,586
of those, maxOccurs="unbounded" ......... 1,887
cross-tab off-diagonal cells ................. 0 and 0
declared in XSD but no export row ....... 6,745   (all containers; 0 leaves, 0 attributes)
export rows with no XSD declaration ......... 0
```

**Any drift in these against the same two inputs means the probe changed, not SIF.**

---

## Two things a successor should not have to rediscover

**`--maximumExpansionDepth` matters and was checked.** The XSD type graph needs an explicit stopping
depth. At 13 — the export's deepest row — the expansion stops twice, both at depth rather than at a type
cycle. **Re-run at 25 and the stop count falls to 0 while every other figure is byte-identical**, so the
truncation was proven immaterial rather than assumed. Use 25. A shallower value undercounts by
construction, which is why the argument is required rather than defaulted.

**Three defects were found in this probe during its own run**, all of which ran in the direction of
understating the finding, and all fixed here:

1. The TSV is CRLF throughout. A `$`-anchored section regex matched nothing and the parse yielded zero
   rows. The refuse-on-empty guard in `containerOmissionReport` is the only reason it stopped instead of
   printing a confident *no omissions found*. **Do not remove that guard.**
2. Containers were first classified by their direct child *rows*, which misfiled a pure container whose
   children are also pure containers. Classification is over all element *paths*.
3. In `xsdElementInventory`: an inner `<xs:restriction base="xs:token">` inside an attribute's inline
   `simpleType` was overwriting the outer `<xs:extension base="…">`; and SIF places `<sifChar>` inside an
   *inline* complexType's annotation rather than the element's. Both are commented at their sites.

---

*Placed 2026-08-09 by session QUIET_LOOM under CRYSTAL_ORBIT, authorized to this directory only. No
forge code, canonicalizer, emitter, parserDescriptor or existing bundle file was modified. Not
committed.*
