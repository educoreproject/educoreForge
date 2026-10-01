# README_PROVENANCE — PESC Academic Eportfolio v1.0.0

Written by `lib/pesc-release-forge/tools/scaffoldReleaseBundle.js` on 2026-10-01. Not machine-checked; the bytes are checked
by `SHA256SUMS` (the framework, before every forge) and by `releaseManifestEntry.json` (loader 2).

| what | value |
|---|---|
| release | AcademicEportfolio_v1.0.0 (standard AcademicEportfolio, version 1.0.0) |
| expander verdict | clean |
| closure digest | a7ece7c1dc1de4bcae4f9c162314bcd05d25381fd883c8e8875c98e24ddf3693 |
| closure date | 2016-03-22 |
| source corpus digest | a060538b87eda9644de043f56f6f7a3cb81e80765b4e8f19570e6662298fec66 |
| expander manifest format | pescReleaseExpander/1 |
| expander code | /Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code at commit b0811e1aca2f2cb3919022a496683c1d056beb38 (clean working tree) |
| copied from | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/AcademicEportfolio_v1.0.0` |
| manifest | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json` |

The release folder is pescReleaseExpander's closure of one PESC message schema over the exact library
files it names. It is ours, never a PESC artifact. Each .xsd file was copied byte for byte
(COPYFILE_EXCL) and never edited. `releaseManifestEntry.json` holds the release's entry from
`releaseManifest.json`, verbatim, under `releaseEntry`, and two manifest-level facts under
`copiedFromManifest`.

The command:

```
node lib/pesc-release-forge/tools/scaffoldReleaseBundle.js --releaseFolder=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/AcademicEportfolio_v1.0.0 --manifest=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json --outputRoot=forges --expanderCodeDir=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code
```

Files:

| sha256 | file |
|---|---|
| 5aeefa06cd2df8515d146a644814e59280a7d1076a727cf4a739a0dce1927f08 | AcademicEportfolio_v1.0.0.xsd |
| 87502be504916a0fcd47495bcf9156221b0320c8aa6e05fb48e2ed598486c283 | AcademicRecord_v1.10.0.xsd |
| 2a36221eec31eada4021717a2d16d356b9b75881efcdccfa66a02daabd696441 | AdmissionsRecord_v1.4.0.xsd |
| 870c35770ffd7daf68c270eef291c360a32dcc32bd952c439c175439b7bb04b6 | CoreMain_v1.16.0.xsd |
| f43228d05d073c89bc8c308b49ec3d1d707d94e7a597735c2949859cb73f7db0 | releaseManifestEntry.json |
