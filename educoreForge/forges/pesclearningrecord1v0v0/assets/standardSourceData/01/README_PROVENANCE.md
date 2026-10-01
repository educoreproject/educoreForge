# README_PROVENANCE — PESC Learning Record v1.0.0

Written by `lib/pesc-release-forge/tools/scaffoldReleaseBundle.js` on 2026-10-01. Not machine-checked; the bytes are checked
by `SHA256SUMS` (the framework, before every forge) and by `releaseManifestEntry.json` (loader 2).

| what | value |
|---|---|
| release | LearningRecord_v1.0.0 (standard LearningRecord, version 1.0.0) |
| expander verdict | clean |
| closure digest | 360fc1fb06d6b0850bcd3c7480e90943f57b6a2643d2e5630ebb6a999e19e12a |
| closure date | 2016-11-29 |
| source corpus digest | a060538b87eda9644de043f56f6f7a3cb81e80765b4e8f19570e6662298fec66 |
| expander manifest format | pescReleaseExpander/1 |
| expander code | /Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code at commit b0811e1aca2f2cb3919022a496683c1d056beb38 (clean working tree) |
| copied from | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/LearningRecord_v1.0.0` |
| manifest | `/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json` |

The release folder is pescReleaseExpander's closure of one PESC message schema over the exact library
files it names. It is ours, never a PESC artifact. Each .xsd file was copied byte for byte
(COPYFILE_EXCL) and never edited. `releaseManifestEntry.json` holds the release's entry from
`releaseManifest.json`, verbatim, under `releaseEntry`, and two manifest-level facts under
`copiedFromManifest`.

The command:

```
node lib/pesc-release-forge/tools/scaffoldReleaseBundle.js --releaseFolder=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/LearningRecord_v1.0.0 --manifest=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/dataStores/releases/releaseManifest.json --outputRoot=forges --expanderCodeDir=/Users/tqwhite/Documents/webdev/pescReleaseExpander/system/code
```

Files:

| sha256 | file |
|---|---|
| 92d58d21dc538699bc38ab44735063f807cf4bae7911dd0082375cdd0b439f75 | AcademicRecord_v1.12.0.xsd |
| a50f5029f53c7e9d06a589b1631a3f8f94e8177a984b1d554b339d092f135fe3 | CoreMain_v1.18.0.xsd |
| 62b74c155eb8bf2435ce6a0d0cc4f69f6de286835ddc235b71add8d3d8ed33c6 | LearningRecord_v1.0.0.xsd |
| 3634b533ecc9db84190abb5648840ad54967a0474941f3de6a3f638f70c29772 | iso_3166-1_v1.0.0.xsd |
| 22583496076745ef5488eb44bbd2b8484b107ddc12705b274c9d2fdd5ccbe7d4 | releaseManifestEntry.json |
