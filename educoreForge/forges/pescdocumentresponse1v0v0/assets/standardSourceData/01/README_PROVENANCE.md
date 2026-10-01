# README_PROVENANCE — PESC Document Response v1.0.0

Written by `lib/pesc-release-forge/tools/scaffoldReleaseBundle.js` on 2026-10-01. Not machine-checked; the bytes are checked
by `SHA256SUMS` (the framework, before every forge) and by `releaseManifestEntry.json` (loader 2).

| what | value |
|---|---|
| release | DocumentResponse_v1.0.0 (standard DocumentResponse, version 1.0.0) |
| expander verdict | clean |
| closure digest | c44773cda85aaf8188f50c22f872c0a0f1d537fe7b183497bd4306791c137658 |
| closure date | 2016-09-09 |
| source corpus digest | a060538b87eda9644de043f56f6f7a3cb81e80765b4e8f19570e6662298fec66 |
| expander manifest format | pescReleaseExpander/1 |
| expander code | /Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code at commit b0811e1aca2f2cb3919022a496683c1d056beb38 (clean working tree) |
| copied from | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/DocumentResponse_v1.0.0` |
| manifest | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json` |

The release folder is pescReleaseExpander's closure of one PESC message schema over the exact library
files it names. It is ours, never a PESC artifact. Each .xsd file was copied byte for byte
(COPYFILE_EXCL) and never edited. `releaseManifestEntry.json` holds the release's entry from
`releaseManifest.json`, verbatim, under `releaseEntry`, and two manifest-level facts under
`copiedFromManifest`.

The command:

```
node lib/pesc-release-forge/tools/scaffoldReleaseBundle.js --releaseFolder=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/DocumentResponse_v1.0.0 --manifest=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json --outputRoot=forges --expanderCodeDir=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code
```

Files:

| sha256 | file |
|---|---|
| 592054a062bd43bda7f1fe80b754874bd8e0271f9899e44c0fe8368cad5e5299 | AcademicRecord_v1.14.0.xsd |
| 5ade556046aabf40296db71d57ca7e8a3e633774898e7d44c256847138de34ec | CoreMain_v1.19.1.xsd |
| 5fd61aadcef00e8ae9014b66726267c07722f2c6a3c246d094632ab8fa3840bd | DocumentResponse_v1.0.0.xsd |
| 3634b533ecc9db84190abb5648840ad54967a0474941f3de6a3f638f70c29772 | iso_3166-1_v1.0.0.xsd |
| 55aed8fb2570692125e0c52d6537d608e5bddabd981b1128f196dcf58fa42a9b | releaseManifestEntry.json |
