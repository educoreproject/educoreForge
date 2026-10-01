# README_PROVENANCE — PESC Academic ePortfolio v1.0.0

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

Phase F-B (2026-10-01, DAWN_CHORUS): the snapshot gained `donorLibraries/`, the eight later CoreMain and
AcademicRecord editions `documentationDonorTable.json` names, copied byte for byte from pescReleaseExpander's
sourceCorpus by the scaffold tool (run into a scratch root; its donor files, SHA256SUMS and this file were
copied into the bundle; every other file it wrote is byte-identical to the committed bundle). They are read
for borrowed element text only and are never part of the release's graph.

The command:

```
node lib/pesc-release-forge/tools/scaffoldReleaseBundle.js --releaseFolder=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/AcademicEportfolio_v1.0.0 --manifest=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json --outputRoot=forges --expanderCodeDir=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code --donorCorpus=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/sourceCorpus
```

Files:

| sha256 | file |
|---|---|
| 5aeefa06cd2df8515d146a644814e59280a7d1076a727cf4a739a0dce1927f08 | AcademicEportfolio_v1.0.0.xsd |
| 87502be504916a0fcd47495bcf9156221b0320c8aa6e05fb48e2ed598486c283 | AcademicRecord_v1.10.0.xsd |
| 2a36221eec31eada4021717a2d16d356b9b75881efcdccfa66a02daabd696441 | AdmissionsRecord_v1.4.0.xsd |
| 870c35770ffd7daf68c270eef291c360a32dcc32bd952c439c175439b7bb04b6 | CoreMain_v1.16.0.xsd |
| 76ef93896303b613c2000bb1b565c433d021bec0a2c31e9f91389af3e3ad4487 | donorLibraries/AcademicRecord_v1.11.0.xsd |
| 92d58d21dc538699bc38ab44735063f807cf4bae7911dd0082375cdd0b439f75 | donorLibraries/AcademicRecord_v1.12.0.xsd |
| 971970f7ff62de32fe3c1e36df32ff81f111ee703439bd4c7e4ba32a28a1dcb0 | donorLibraries/AcademicRecord_v1.13.0.xsd |
| 592054a062bd43bda7f1fe80b754874bd8e0271f9899e44c0fe8368cad5e5299 | donorLibraries/AcademicRecord_v1.14.0.xsd |
| f4b05efd5839528d316dc6f58c3dfd3d623767b53c82d918198c57fa25f840c7 | donorLibraries/CoreMain_v1.17.0.xsd |
| a50f5029f53c7e9d06a589b1631a3f8f94e8177a984b1d554b339d092f135fe3 | donorLibraries/CoreMain_v1.18.0.xsd |
| d9ded3484f893672cdb9fff07f5401231661e33870f9427489bcc02188c3d60a | donorLibraries/CoreMain_v1.19.0.xsd |
| 5ade556046aabf40296db71d57ca7e8a3e633774898e7d44c256847138de34ec | donorLibraries/CoreMain_v1.19.1.xsd |
| f43228d05d073c89bc8c308b49ec3d1d707d94e7a597735c2949859cb73f7db0 | releaseManifestEntry.json |
